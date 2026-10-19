"""Service — Phiếu nhập/xuất kho: ứng theo yêu cầu, phân bổ lô, ghi sổ, giá vốn.

docs/spec-kho-de-nghi.md §5–§6. Bốn luật cứng sống ở đây:

1. **Không có yêu cầu đã duyệt thì không lập được phiếu** (§5).
2. **Không cho ứng vượt `sl_duyet`** — muốn thêm phải yêu cầu mới (BRD §2.5 b8).
3. **Nhập = tạo lô mới, mỗi lần nhập một lô riêng với giá riêng** (§6). Không gộp lô.
4. **Xuất phải chỉ định lô**; ăn nhiều lô thì tách nhiều dòng, mỗi dòng một giá vốn.

Chỉ khi phiếu chuyển sang `posted` thì tồn mới đổi — phiếu nháp không đụng gì tới kho.
"""
from __future__ import annotations

import re
import secrets
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from ..models.document_sequence import (
    SEQ_DOC_TYPE_STOCK_TRANSFER,
    SEQ_DOC_TYPE_STOCK_VOUCHER_IN,
    SEQ_DOC_TYPE_STOCK_VOUCHER_OUT,
)
from ..models.stock_request import REQUEST_FULFILLABLE
from ..models.stock_voucher import (
    VOUCHER_CANCELLED,
    VOUCHER_DRAFT,
    VOUCHER_KINDS,
    VOUCHER_NHAP,
    VOUCHER_POSTED,
    VOUCHER_XUAT,
    StockVoucher,
    StockVoucherAttachment,
)

from ..repositories.audit_repo import AuditLogRepository
from ..repositories.kho_khoa_so_repo import KhoKhoaSoRepository
from ..repositories.kho_ky_ton_repo import KhoKyTonRepository
from ..repositories.stock_lot_repo import goc_cua
from .kho_giay import chuan_kho, co_don_vi_goc, khoa_dong, khoa_ton, nhan_kho
from ..storage import get_storage, key_from_url, url_from_key

# Đính kèm phiếu kho: byte đi qua storage.py (LocalStorage <backend>/static hoặc MinIO) rồi phục vụ
# qua /api/files/<key> (đăng nhập mới đọc) — KHÔNG dùng mount /static (đã gỡ vì lộ file). key = "kho/<id>/..".
_ATTACHMENT_SUBDIR = "kho"
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENTS_PER_VOUCHER = 20


def _safe_attachment_name(file_name: str | None) -> str:
    """Chặn traversal (kể cả Windows "\\") + thay ký tự cấm; cắt 180 ký tự."""
    name = Path((file_name or "file").replace("\\", "/")).name
    return re.sub(r'[<>:"|?*\x00-\x1f]', "_", name)[:180].strip(" .") or "file"


class StockVoucherError(Exception):
    """Lỗi nghiệp vụ phiếu kho — router dịch thành HTTP 400."""


class StockVoucherService:
    def __init__(self, vouchers, requests, lots, sequence, request_service, hang,
                 giu_cho=None, hen_nhat_them=None) -> None:
        self.vouchers = vouchers
        self.requests = requests
        self.lots = lots
        self.sequence = sequence
        self.request_service = request_service
        # `GiuChoService` — TUỲ CHỌN (17/08/2026). Vắng thì kho chạy y như trước: mọi chỗ dựng
        # service cũ không phải sửa, và test kho không phải kéo theo cả bảng cân đối.
        #
        # Có mặt thì kho gánh thêm hai việc:
        #   · XUẤT — không cho lấn vào phần lệnh khác đang giữ (`kiem_xuat`);
        #   · GHI SỔ — xuất xong thì nhả phần giữ tương ứng, nhập xong thì tự nhặt thêm cho lệnh
        #     đang chờ (`tieu_thu` / `nhat_them`).
        self.giu_cho = giu_cho
        # Hẹn chạy `nhat_them()` SAU khi phản hồi đã trả (router gắn BackgroundTasks, session mới).
        # Vắng ⇒ chạy ngay sau commit, trong cùng lượt gọi — `nhat_them` dựng cả bảng cân đối toàn
        # xưởng, nên chỉ để vậy ở chỗ không có người đứng chờ (script, test).
        self.hen_nhat_them = hen_nhat_them
        # `VatLieuKhoService` — tra danh mục gốc + quy đổi đơn vị.
        #
        # GỠ 2026-08-08: `materials` + `material_service` + `_create_new_material()`. Phiếu từng tự
        # đẻ mặt hàng mới (mã HH###) khi dòng đề nghị là hàng gõ tay. Nay siết: mọi thứ nhập kho
        # phải có sẵn trong danh mục Giấy / Vật tư khác, nên cửa đẻ hàng đó đóng hẳn.
        self.hang = hang

    def _assert_period_open(self, kho_id, ngay) -> None:
        """Chặn thao tác vào KỲ ĐÃ KHÓA (kế toán chốt sổ, spec-bao-cao-kho §6).

        Mốc = NGÀY NHẬP/XUẤT KHO ghi trên phiếu (`v.ngay` — ô thủ kho nhập), KHÔNG phải ngày tạo /
        ngày ghi sổ / hôm nay. Nhờ vậy: nhập kho lùi ngày vào kỳ đã khóa thì BỊ CHẶN dù hôm nay kỳ
        đang mở; và phiếu ghi ngày thuộc kỳ còn mở vẫn ghi sổ được dù hôm nay rơi vào kỳ đã khóa.
        Khóa xét theo KHOẢNG đã khóa (toàn kho hoặc kho này)."""
        if kho_id is None or ngay is None:
            return
        if KhoKhoaSoRepository(self.vouchers.db).is_locked(kho_id, ngay):
            raise StockVoucherError(
                f"Kỳ kế toán chứa ngày {ngay.strftime('%d/%m/%Y')} đã khóa sổ — "
                f"không thao tác được phiếu này."
            )

    def _assert_chua_tinh_gia(self, kho_id, ngay, *, viec: str, them: str = "") -> None:
        """Chặn thao tác vào kỳ đã bấm "Tính giá kỳ" — 11/10/2026. N-X-T kỳ sau đọc đầu kỳ từ số đã
        chốt và BỎ QUA phiếu có ngày nằm trong kỳ đó: ghi sổ lùi ngày hay sửa số ở đây là tồn đầu kỳ
        sau lệch ngầm. Từ 13/10/2026 chỉ tính được kỳ đã khóa (khóa chặn trước ở `_assert_period_open`),
        nên chốt này còn gác số đã tính trên kỳ CHƯA khóa từ trước đó. Lối thoát: khoá rồi mở lại kỳ
        (mở sổ xoá số đã tính)."""
        if kho_id is None or ngay is None:
            return
        ky = KhoKyTonRepository(self.vouchers.db).ky_da_tinh_tu(kho_id, ngay)
        if ky is not None:
            raise StockVoucherError(
                f"Phiếu ngày {ngay.strftime('%d/%m/%Y')} nằm trong kỳ đã tính giá "
                f"({ky[0].strftime('%d/%m/%Y')}–{ky[1].strftime('%d/%m/%Y')}) — {viec} lúc này làm lệch "
                f"số đã chốt. Đổi ngày phiếu sang sau kỳ đó, hoặc nhờ kế toán khoá rồi mở lại kỳ để bỏ "
                f"số đã tính, xong thì tính giá lại.{them}"
            )

    def _quy_doi(self, rl, qty: float) -> dict:
        """Số trên phiếu (theo `dvt` của dòng đề nghị) → số theo ĐƠN VỊ GỐC để ghi vào lô.
        Giấy + vật tư: gốc của CHÍNH dòng đề nghị (`rl.don_vi_goc` — một đơn vị đã khai ở danh mục);
        dòng cũ chưa có thì suy từ ĐVT (`don_vi_goc` trong kết quả nói gốc nào)."""
        from .vat_lieu_kho_service import VatLieuKhoError

        goc = (rl.don_vi_goc or None) if co_don_vi_goc(rl.hang_loai) else None
        try:
            return self.hang.quy_ve_goc(rl.hang_loai, rl.hang_id, rl.dvt, qty, goc=goc)
        except VatLieuKhoError as e:
            raise StockVoucherError(str(e)) from None

    # --- Nhật ký ------------------------------------------------------------

    def _nhat_ky(self, user, action: str, v: StockVoucher, *, them: str = "",
                 commit: bool = True) -> None:
        """Một dòng nhật ký cho thao tác lập / ghi sổ / huỷ phiếu (lỗi E2E #49, 18/10/2026: ba việc
        này không để lại dấu vết, màn Nhật ký trống đúng lúc kho làm việc nhiều nhất).

        `target = voucher:<id>` — cùng khoá với dòng "điều chỉnh phiếu xuất" nên tab lịch sử của
        phiếu đọc chung được. `commit=False` cho chỗ đang đóng một giao dịch lớn (ghi sổ): dòng
        nhật ký sống/chết cùng sổ kho. `user=None` (tác vụ nền) ⇒ actor rỗng, vẫn ghi."""
        from ..models.kho_hang import KhoHang

        kho = self.vouchers.db.get(KhoHang, v.kho_id) if v.kho_id else None
        loai = "nhập" if v.loai == VOUCHER_NHAP else "xuất"
        detail = f"Phiếu {loai} {v.ma}" + (f" tại {kho.ten}" if kho is not None else "")
        if them:
            detail += f": {them}"
        AuditLogRepository(self.vouchers.db).create(
            actor_user_id=getattr(user, "id", None), action=action, target=f"voucher:{v.id}",
            detail=detail, commit=commit,
        )

    # --- Lập phiếu ----------------------------------------------------------

    def create(self, *, user, request_id: int, kho_id: int, lines: list[dict],
               ngay: date | None = None, ma: str | None = None,
               _dc_dest: bool = False, ghi_so: bool = False, **header) -> StockVoucher:
        req = self.requests.get_with_lines(request_id)
        if req is None:
            raise StockVoucherError("Không tìm thấy yêu cầu.")
        # Luật 1: mọi phiếu phải ứng theo một yêu cầu ĐÃ DUYỆT.
        if req.trang_thai not in REQUEST_FULFILLABLE:
            raise StockVoucherError(
                "Chỉ lập phiếu cho yêu cầu đã duyệt (và chưa hoàn tất)."
            )
        if not lines:
            raise StockVoucherError("Phiếu phải có ít nhất 1 dòng.")
        # Lập phiếu NHÁP chưa vào sổ → không xét khóa kỳ ở đây (chỉ xét lúc GHI SỔ). Trừ khi người
        # dùng bấm "Tạo và ghi sổ" (`ghi_so`): xét ngay, không thì lượt ghi sổ sau bị chặn mà phiếu
        # nháp đã nằm lại, bấm lại là đẻ thêm phiếu (#45, 18/10/2026).
        if ghi_so:
            self._assert_period_open(kho_id, ngay or date.today())

        loai = req.loai
        if loai not in VOUCHER_KINDS:
            raise StockVoucherError("Loại yêu cầu không hợp lệ.")

        # ĐIỀU CHUYỂN: phiếu NHẬP đích do HỆ dựng sẵn lúc ấn điều chuyển (giá vốn + HSD khoá đích danh
        # theo lô nguồn). Kho đích CHỈ ghi sổ — không tự lập phiếu, chặn để không đẻ phiếu trùng nhập đôi.
        if loai == VOUCHER_NHAP and getattr(req, "dieu_chuyen", False) and not _dc_dest:
            raise StockVoucherError(
                "Phiếu nhập điều chuyển đã được dựng sẵn — vào yêu cầu điều chuyển để ghi sổ."
            )

        self._chan_thanh_pham_ngoai_kho(req, loai, kho_id)

        lines_by_id = {ln.id: ln for ln in req.lines}
        prepared: list[dict] = []
        lo_xuat: list = []
        # Cộng dồn theo dòng yêu cầu để chặn cả trường hợp 1 phiếu có nhiều dòng cùng ứng
        # vào một dòng yêu cầu (phân bổ nhiều lô) — kiểm từng dòng lẻ sẽ lọt.
        wanted: dict[int, float] = {}
        # Lý do CẤP/NHẬP THIẾU theo từng dòng yêu cầu (kho phản hồi). Lấy từ dòng phiếu đầu có lý do.
        ly_do_by_rl: dict[int, str] = {}

        for ln in lines:
            rl = lines_by_id.get(ln.get("request_line_id"))
            if rl is None:
                raise StockVoucherError("Dòng phiếu không thuộc yêu cầu đã chọn.")
            qty = float(ln.get("so_luong") or 0)
            if qty <= 0:
                raise StockVoucherError("Số lượng trên phiếu phải lớn hơn 0.")
            wanted[rl.id] = wanted.get(rl.id, 0.0) + qty
            ld = (ln.get("ly_do") or "").strip()
            if ld and rl.id not in ly_do_by_rl:
                ly_do_by_rl[rl.id] = ld

            # Mặt hàng KẾ THỪA từ dòng đề nghị, kho không đổi được: đề nghị đã duyệt là khoá, đổi
            # mặt hàng ở phiếu tức là cấp thứ khác với thứ người ta duyệt.
            hang = (rl.hang_loai, rl.hang_id)
            # GIẤY: khổ của dòng phiếu — NHẬP được khai lại, mặc định kế thừa dòng yêu cầu; XUẤT luôn
            # theo dòng yêu cầu (lô chọn phải khớp, xem `_require_lot`). Đơn vị gốc LUÔN theo dòng yêu
            # cầu (ĐVT dòng đã chốt ở yêu cầu — phiếu không đổi được đơn vị).
            kr, kd = self._kho_cua_dong(rl, ln, loai)
            # Chốt hệ số quy đổi NGAY LÚC NÀY (xem `StockVoucherLine.sl_goc`).
            qd = self._quy_doi(rl, qty)
            dv_goc = (qd.get("don_vi_goc") or "").lower() if co_don_vi_goc(rl.hang_loai) else ""

            item = {
                "request_line_id": rl.id,
                "hang_loai": hang[0],
                "hang_id": hang[1],
                "so_luong": qty,
                "sl_goc": qd["sl_goc"],
                "ghi_chu": ln.get("ghi_chu"),
                "don_vi_goc": dv_goc, "kho_rong": kr, "kho_dai": kd,
                # Vị trí cất lô — CHỈ phiếu NHẬP; ghi sổ chép sang lô. XUẤT không tạo lô → None.
                "vi_tri": ((ln.get("vi_tri") or "").strip() or None) if loai == VOUCHER_NHAP else None,
            }
            if loai == VOUCHER_NHAP:
                if _dc_dest:
                    # ĐIỀU CHUYỂN: phiếu nhập đích dựng theo TỪNG LÔ nguồn — khoá giá vốn + HSD ĐÚNG
                    # lô nguồn (đích danh, KHÔNG bình quân) để kho đích chạy FEFO/giá vốn như nguồn.
                    item["don_gia"] = int(ln.get("don_gia") or 0)
                    item["hsd"] = ln.get("hsd")
                    # Điều chuyển giấy / vật tư: lô mới ở kho đích mang đơn vị gốc + khổ ĐÚNG lô nguồn.
                    if co_don_vi_goc(rl.hang_loai):
                        item["don_vi_goc"] = (ln.get("don_vi_goc") or dv_goc).strip().lower()
                    item["kho_rong"] = int(ln.get("kho_rong") or 0) or kr
                    item["kho_dai"] = int(ln.get("kho_dai") or 0) or kd
                    # Lô GỐC đi theo hàng: lô mới ở kho đích vẫn đọc được đơn / khách / giá bán và nhận
                    # giá gốc sửa sau (design nhập kho thành phẩm §5). Ghi sổ chép sang lô.
                    item["lo_goc_id"] = ln.get("lo_goc_id")
                else:
                    # Giá của lô sắp tạo = ĐƠN GIÁ KHAI Ở YÊU CẦU (người yêu cầu nhập). Kho KHÔNG sửa
                    # giá — bỏ qua `don_gia` client gửi. Lô chưa tồn tại nên `lot_id` trống tới ghi sổ.
                    item["don_gia"] = int(rl.don_gia or 0)
                    # Hạn sử dụng khai ở dòng (tách lô theo hạn) — ghi sổ chép sang lô. None = không hạn.
                    item["hsd"] = ln.get("hsd")
                    # Hàng khách trả về (mg 0401): lô mới thuộc họ lô gốc đã xuất ra nó.
                    item["lo_goc_id"] = getattr(rl, "lo_goc_id", None)
            else:
                lot = self._require_lot(ln.get("lot_id"), hang, kho_id, rl)
                item["lot_id"] = lot.id
                lo_xuat.append(lot)
            prepared.append(item)

        if lo_xuat:
            self._chan_lo_khac_khach(req.id, lo_xuat)

        # Luật 2: không ứng vượt số đã duyệt. + Cấp/nhập THIẾU (SL < còn phải cấp) phải có LÝ DO.
        for rl_id, qty in wanted.items():
            rl = lines_by_id[rl_id]
            con_lai = self.request_service.con_lai(rl)
            if qty > con_lai + 1e-9:
                raise StockVoucherError(
                    "Ứng vượt số đã duyệt. Muốn cấp thêm thì phải tạo yêu cầu mới."
                )
            if qty < con_lai - 1e-9:
                ld = ly_do_by_rl.get(rl_id)
                if not ld:
                    raise StockVoucherError(
                        f"Cấp ít hơn số còn phải cấp ({qty:g}/{con_lai:g}) — phải nhập LÝ DO."
                    )
                rl.ly_do_thieu = ld  # kho phản hồi: vì sao cấp thiếu
            else:
                rl.ly_do_thieu = None  # cấp đủ đợt này → xoá lý do thiếu cũ (nếu có)

        doc_type = (
            SEQ_DOC_TYPE_STOCK_VOUCHER_IN if loai == VOUCHER_NHAP
            else SEQ_DOC_TYPE_STOCK_VOUCHER_OUT
        )
        # Số phiếu tự nhập (tuỳ chọn): chuẩn hoá HOA, chặn trùng. Bỏ trống → hệ thống tự sinh.
        ma_clean = (ma or "").strip().upper() or None
        if ma_clean is not None:
            if self.vouchers.get_by_ma(ma_clean) is not None:
                raise StockVoucherError(f"Số phiếu '{ma_clean}' đã tồn tại.")
        else:
            ma_clean = self.sequence.generate_flat_code(doc_type)
        # ĐIỀU CHUYỂN: phiếu KẾ THỪA cờ từ yêu cầu — cả phiếu XUẤT nguồn (tự lập) lẫn phiếu NHẬP đích
        # (kho đích lập từ yêu cầu điều chuyển) đều bật `dieu_chuyen` để báo cáo gắn nhãn + loại khỏi
        # tổng mua/bán. Nhập/xuất thường: yêu cầu `dieu_chuyen=False` → phiếu cũng false. mig 0203.
        header.setdefault("dieu_chuyen", bool(getattr(req, "dieu_chuyen", False)))
        # Người giao/nhận hàng = NGƯỜI YÊU CẦU, server chốt từ tài khoản — không nhận chữ gõ tay.
        from ..models.user import User
        nguoi_yc = self.vouchers.db.get(User, req.nguoi_tao_id) if req.nguoi_tao_id else None
        header["nguoi_giao_nhan"] = getattr(nguoi_yc, "name", None)
        # Phiếu của CHUYẾN GIAO (12/10/2026): người cầm hàng ở cửa kho là TÀI XẾ của chuyến — nhận
        # hàng đi giao (xuất) hay mang hàng trả về (nhập) — không phải người lên đơn ở văn phòng.
        if getattr(req, "delivery_trip_id", None):
            from ..models.delivery import DeliveryTrip
            from ..models.employee import Employee

            trip = self.vouchers.db.get(DeliveryTrip, req.delivery_trip_id)
            tx = self.vouchers.db.get(Employee, trip.employee_id) if trip is not None else None
            if tx is not None:
                header["nguoi_giao_nhan"] = tx.full_name
        voucher = self.vouchers.create(
            ma=ma_clean, loai=loai, request_id=req.id, nguoi_lap_id=user.id,
            kho_id=kho_id, ngay=ngay or date.today(), lines=prepared, **header
        )
        # Đã lập phiếu (nháp) → yêu cầu rời "Cần cấp" sang "Đang cấp" (Đang chuẩn bị).
        self.request_service.mark_in_progress(req)
        self._nhat_ky(user, "kho_phieu_lap", voucher)
        return voucher

    def _chan_thanh_pham_ngoai_kho(self, req, loai: str, kho_id: int) -> None:
        """Thành phẩm chỉ vào / ra Kho thành phẩm (12/10/2026, `kho_thanh_pham`).

        NHẬP thành phẩm vào kho khác ⇒ chặn — gồm cả vế nhập đích của điều chuyển, nên thành phẩm
        không điều chuyển ra khỏi Kho thành phẩm được. XUẤT thành phẩm từ kho khác ⇒ chặn, trừ vế xuất
        nguồn của điều chuyển (đường đưa thành phẩm còn sót ở kho khác VỀ Kho thành phẩm)."""
        from .kho_thanh_pham import hang_thanh_pham, id_kho_thanh_pham

        if loai == VOUCHER_XUAT and getattr(req, "dieu_chuyen", False):
            return
        tp = hang_thanh_pham(self.vouchers.db, [(rl.hang_loai, rl.hang_id) for rl in req.lines])
        kho_tp = id_kho_thanh_pham(self.vouchers.db)
        if not tp or kho_tp is None or int(kho_id) == kho_tp:
            return
        raise StockVoucherError("Thành phẩm chỉ nhập vào Kho thành phẩm." if loai == VOUCHER_NHAP
                                else "Thành phẩm chỉ xuất từ Kho thành phẩm.")

    def _chan_lo_khac_khach(self, request_id: int, lots) -> None:
        """Xuất cho Giao hàng đơn X: lô thành phẩm sản xuất cho KHÁCH KHÁC ⇒ chặn — cùng mã (danh mục gộp
        theo tên) nhưng có thể khác file in. Lô đơn khác cùng khách / lô không nguồn vẫn cho xuất (design
        nhập kho thành phẩm §6)."""
        dich = self.requests.don_giao_cua_yeu_cau(request_id)
        if not dich:
            return
        nguon = self.lots.nguon_lo([l.id for l in lots])
        for lot in lots:
            n = nguon.get(lot.id) or {}
            if n.get("order_id") is not None and n.get("customer_id") != dich["customer_id"]:
                raise StockVoucherError(
                    f"Lô {lot.ma_lo} sản xuất cho khách {n.get('khach_hang') or 'khác'} (đơn "
                    f"{n.get('order_ma')}) — không xuất cho đơn {dich['order_ma']} của khách "
                    f"{dich['khach_hang'] or 'khác'}."
                )

    @staticmethod
    def _kho_cua_dong(rl, ln: dict, loai: str) -> tuple[int, int]:
        """Khổ hiệu lực của dòng phiếu. Phiếu NHẬP giấy khai khổ thì lấy khổ đó, bỏ trống ⇒ kế thừa dòng
        yêu cầu. Hàng không phải giấy: 0 · 0."""
        if rl.hang_loai != "giay":
            return 0, 0
        if loai == VOUCHER_NHAP:
            kr, kd = chuan_kho(ln.get("kho_rong"), ln.get("kho_dai"))
            if kr:
                return kr, kd
        return int(rl.kho_rong or 0), int(rl.kho_dai or 0)

    def _require_lot(self, lot_id, hang: tuple[str, int], kho_id: int, rl=None):
        if not lot_id:
            raise StockVoucherError(
                "Phiếu xuất phải chọn lô — giá vốn tính đích danh theo lô."
            )
        lot = self.lots.get(lot_id)
        if lot is None:
            raise StockVoucherError("Không tìm thấy lô.")
        if (lot.hang_loai, lot.hang_id) != tuple(hang):
            raise StockVoucherError("Lô đã chọn không thuộc mặt hàng của dòng đề nghị.")
        if lot.kho_id != kho_id:
            raise StockVoucherError("Lô đã chọn không nằm trong kho xuất.")
        # GIẤY + VẬT TƯ: dòng xin đơn vị gốc nào thì chỉ lấy lô đếm đúng đơn vị đó (tờ và kg, thùng
        # và kg không quy đổi). GIẤY: dòng có khổ thì lô phải đúng khổ (khổ chỉ-rộng không khớp khổ hai
        # cạnh). Dòng chưa có khổ ⇒ không xét khổ — cùng luật lọc gợi ý lô (`StockLotRepository._loc_kho`).
        if rl is not None and co_don_vi_goc(rl.hang_loai):
            goc_dong = (rl.don_vi_goc or "").strip().lower()
            if goc_dong and (lot.don_vi_goc or "") != goc_dong:
                raise StockVoucherError(
                    f"Lô {lot.ma_lo} đếm theo {self._ten_dv(lot.don_vi_goc)}, "
                    f"dòng xin theo {self._ten_dv(goc_dong)}.")
        if rl is not None and rl.hang_loai == "giay":
            kr, kd = chuan_kho(rl.kho_rong, rl.kho_dai)
            if kr and (int(lot.kho_rong or 0), int(lot.kho_dai or 0)) != (kr, kd):
                raise StockVoucherError(
                    f"Lô {lot.ma_lo} là {nhan_kho(lot.kho_rong, lot.kho_dai)}, "
                    f"dòng xin {nhan_kho(kr, kd)}.")
        return lot

    def _ten_dv(self, ma: str | None) -> str:
        """Tên hiển thị của mã đơn vị ("to" ⇒ "tờ") cho câu lỗi; tra không được thì trả chính mã."""
        from ..repositories.don_vi_do_repo import nhan_don_vi

        bang: dict = {}
        try:
            bang = self.hang.don_vi.ten_theo_ma()
        except AttributeError:
            pass
        return "“" + (nhan_don_vi(bang, ma) if ma else "chưa rõ đơn vị") + "”"

    def _goc_dieu_chuyen(self, hang_loai: str, hang_id: int, kho_nguon_id: int, it: dict,
                         kr: int, kd: int) -> str:
        """Đơn vị gốc của dòng điều chuyển giấy / vật tư: lấy `don_vi_goc` người gửi (dòng tồn đã có
        sẵn); bỏ trống thì suy từ lô còn hàng ở kho nguồn đúng khổ — chỉ khi chúng cùng MỘT đơn vị gốc.
        Hai đơn vị (lô tờ + lô kg cùng khổ, lô thùng + lô kg) ⇒ chặn: cộng lẫn là cộng tờ với kg."""
        goc = (it.get("don_vi_goc") or "").strip().lower()
        if goc:
            return goc
        gocs = {(lo.don_vi_goc or "") for lo in self.lots.list_lots(
            hang=(hang_loai, hang_id), kho_id=kho_nguon_id, con_hang=True, goc=None)
            if not kr or (int(lo.kho_rong or 0), int(lo.kho_dai or 0)) == (kr, kd)}
        if len(gocs) == 1:
            return gocs.pop()
        if hang_loai == "giay":
            raise StockVoucherError(
                "Điều chuyển giấy phải chọn đúng dòng tồn (khổ + đơn vị) — mỗi khổ, mỗi đơn vị một dòng.")
        raise StockVoucherError(
            "Điều chuyển phải chọn đúng dòng tồn theo đơn vị — mỗi đơn vị một dòng.")

    # --- Ghi sổ -------------------------------------------------------------

    def _apply_post(self, v: StockVoucher, user=None) -> StockRequest:
        """Ghi sổ MỘT phiếu vào tồn — KHÔNG commit (chỉ mutate + flush qua repo). Tách ra để GHÉP
        nhiều phiếu (điều chuyển: xuất nguồn + nhập đích) vào MỘT giao dịch. Trả yêu cầu gốc để
        caller gọi `refresh_fulfillment` sau khi commit. Kiểm hết điều kiện TRƯỚC, ghi SAU."""
        if v.trang_thai != VOUCHER_DRAFT:
            raise StockVoucherError("Chỉ ghi sổ được phiếu đang ở trạng thái Nháp.")
        # NGÀY HẠCH TOÁN = NGÀY NHẬP/XUẤT KHO ghi trên phiếu (`v.ngay`, thủ kho nhập), KHÔNG phải
        # hôm nay. Nhập kho lùi ngày vào kỳ đã khóa → chặn; ngược lại phiếu ngày cũ (kỳ còn mở) vẫn
        # ghi sổ được dù hôm nay rơi vào kỳ đã khóa.
        self._assert_period_open(v.kho_id, v.ngay or date.today())
        self._assert_chua_tinh_gia(v.kho_id, v.ngay or date.today(), viec="ghi sổ")

        req = self.requests.get_with_lines(v.request_id)
        if req is None:
            raise StockVoucherError("Không tìm thấy yêu cầu của phiếu.")
        lines_by_id = {ln.id: ln for ln in req.lines}

        # --- Pha 1: kiểm tra toàn bộ, chưa ghi gì ---
        wanted: dict[int, float] = {}
        for ln in v.lines:
            wanted[ln.request_line_id] = wanted.get(ln.request_line_id, 0.0) + float(ln.so_luong)
        for rl_id, qty in wanted.items():
            rl = lines_by_id.get(rl_id)
            if rl is None:
                raise StockVoucherError("Dòng phiếu trỏ vào yêu cầu khác.")
            con_lai = self.request_service.con_lai(rl)
            if qty > con_lai + 1e-9:
                raise StockVoucherError("Ứng vượt số đã duyệt — không ghi sổ được.")

        if v.loai == VOUCHER_XUAT:
            # Gộp theo lô: 2 dòng cùng ăn một lô thì phải cộng lại mới biết có đủ không.
            # Cộng theo `sl_goc`: lô lưu ở ĐƠN VỊ GỐC, còn `so_luong` ở đơn vị người ta khai.
            # So hai thang khác nhau là cho xuất âm mà không hay (xuất "10 ram" khỏi lô 100 kg).
            per_lot: dict[int, float] = {}
            for ln in v.lines:
                if not ln.lot_id:
                    raise StockVoucherError("Dòng xuất thiếu lô.")
                per_lot[ln.lot_id] = per_lot.get(ln.lot_id, 0.0) + float(ln.sl_goc)
            for lot_id, qty in per_lot.items():
                lot = self.lots.get(lot_id)
                if lot is None:
                    raise StockVoucherError("Không tìm thấy lô của dòng xuất.")
                if qty > float(lot.sl_con_lai) + 1e-9:
                    # Hiện TÊN sản phẩm cho dễ nhận biết thay vì mã lô khó đọc (LOT-VT-KEM-74-…);
                    # fallback về mã lô nếu không tra được tên (mất danh mục gốc).
                    m = self.hang.map_theo_cap(
                        [(lot.hang_loai, lot.hang_id)]
                    ).get((lot.hang_loai, lot.hang_id))
                    ten = getattr(m, "ten", None) or lot.ma_lo
                    raise StockVoucherError(
                        f"{ten} chỉ còn {float(lot.sl_con_lai):g} — không đủ để xuất. "
                        "Kho không cho xuất âm."
                    )

            # Cửa thứ hai (17/08/2026): không lấn vào phần LỆNH KHÁC đang giữ chỗ.
            #
            # Kiểm trên TỔNG theo mặt hàng, không theo lô: giữ chỗ cố ý không neo lô nào (kho vẫn
            # nhập-trước-xuất-trước). Kiểm ở đây chứ không ở lúc lập phiếu — lập phiếu là nháp, còn
            # ghi sổ mới là lúc hàng thật rời kho, và giữa hai mốc đó tồn tự do có thể đã đổi.
            if self.giu_cho is not None:
                # Gom MỘT lần, pha 3 dùng lại: khi có dòng thuộc bài ghép, hàm này dựng cả bảng
                # cân đối — trước đây chạy hai lần trong cùng lượt ghi sổ, đang giữ khoá phiếu.
                gom_xuat = self._gom_theo_hang_va_chu_the(v, lines_by_id)
                for (hang, chu), sl in gom_xuat.items():
                    loi = self.giu_cho.kiem_xuat(
                        hang=hang, so_luong=sl, lsx_id=chu[0], bai_ghep_id=chu[1])
                    if loi:
                        raise StockVoucherError(loi)

        # --- Pha 2: ghi ---
        if v.loai == VOUCHER_NHAP:
            for ln in v.lines:
                mh = self.hang.get(ln.hang_loai, ln.hang_id)
                sl_goc = float(ln.sl_goc)
                # Đơn giá khai theo ĐƠN VỊ NGƯỜI NHẬP (đ/ram), lô lưu theo đơn vị gốc (đ/kg) —
                # quy theo đúng tỉ lệ của chính dòng này: 1.020.000 đ/ram ÷ 41,93 kg/ram ≈ 24.325 đ/kg.
                gia_goc = round(float(ln.don_gia or 0) * float(ln.so_luong) / sl_goc) if sl_goc else 0
                # Lô thuộc họ lô gốc (điều chuyển, hàng trả về): cả họ MỘT giá — đọc giá gốc HIỆN TẠI
                # của lô gốc, vì kế toán có thể đã gõ giá gốc sau lúc lập yêu cầu (mg 0401).
                goc_lo = self.lots.get(ln.lo_goc_id) if ln.lo_goc_id else None
                if goc_lo is not None and not getattr(req, "dieu_chuyen", False):
                    gia_goc = int(goc_lo.don_gia_nhap or 0)
                    ln.don_gia = round(gia_goc * sl_goc / float(ln.so_luong)) if ln.so_luong else gia_goc
                lot = self.lots.create(
                    ma_lo=self.lots.next_ma_lo(mh.ma, v.ngay),
                    hang_loai=ln.hang_loai,
                    hang_id=ln.hang_id,
                    voucher_id=v.id,
                    kho_id=v.kho_id,
                    ngay_nhap=v.ngay,
                    don_gia_nhap=gia_goc,
                    sl_ban_dau=sl_goc,
                    sl_con_lai=sl_goc,
                    vi_tri=ln.vi_tri,
                    hsd=ln.hsd,
                    lo_goc_id=ln.lo_goc_id,
                    # Lô mang ĐƠN VỊ GỐC của dòng phiếu (đơn vị đã khai) — khoá tồn tách theo nó.
                    don_vi_goc=(ln.don_vi_goc or "") if co_don_vi_goc(ln.hang_loai) else "",
                    kho_rong=int(ln.kho_rong or 0),
                    kho_dai=int(ln.kho_dai or 0),
                )
                ln.lot_id = lot.id
        else:
            for ln in v.lines:
                self.lots.consume(self.lots.get(ln.lot_id), float(ln.sl_goc))

        for rl_id, qty in wanted.items():
            rl = lines_by_id[rl_id]
            rl.sl_da_ung = float(rl.sl_da_ung) + qty

        # --- Pha 3: báo cho GIỮ CHỖ (17/08/2026) ---
        #
        # XUẤT ⇒ phần giữ của chính lệnh đó HOÁ THÀNH phần đã cấp, nhả khỏi bảng giữ chỗ. Không nhả
        # là đếm hai lần: tồn đã giảm khi ghi sổ, mà chỗ giữ vẫn trừ tiếp vào tồn tự do ⇒ mọi lệnh
        # khác báo thiếu oan.
        #
        # NHẬP ⇒ hàng vừa vào kho, lệnh nào đang bật công tắc mà còn thiếu thì được bù NGAY
        # (`nhat_them`). Đây là toàn bộ ý nghĩa của "bật = đăng ký, không phải chụp một lần" —
        # không ai phải nhớ quay lại bấm đúng lúc hàng nhập. `nhat_them` chạy SAU commit (`post`),
        # không ở đây: nó dựng cả bảng cân đối toàn xưởng.
        #
        # `commit=False`: cả lượt ghi sổ là MỘT giao dịch. Commit con ở đây từng nhả khoá dòng phiếu
        # khi phiếu còn NHÁP ⇒ lượt ghi sổ thứ hai đang chờ khoá đọc thấy NHÁP và ghi sổ lần nữa.
        if self.giu_cho is not None:
            if v.loai == VOUCHER_XUAT:
                for (hang, chu), sl in gom_xuat.items():
                    if chu != (None, None):
                        self.giu_cho.tieu_thu(hang=hang, so_luong=sl,
                                              lsx_id=chu[0], bai_ghep_id=chu[1], commit=False)
            else:
                # Hàng vừa vào kho: TRƯỚC hết, phần đang giữ HỨA của đúng mặt hàng này (nếu có)
                # phải chuyển thành giữ THẬT — không thì lệnh bị khoá lịch theo một ngày về đã
                # thành quá khứ dù hàng đã nằm trong kho (xem `chuyen_dang_ve_sang_kho`).
                for hang, sl in self._gom_theo_hang_nhap(v).items():
                    self.giu_cho.chuyen_dang_ve_sang_kho(hang, sl, commit=False)

        v.trang_thai = VOUCHER_POSTED
        v.ghi_so_luc = datetime.now(timezone.utc)
        if user is not None:
            v.nguoi_ghi_so_id = user.id
        return req

    def post(self, voucher_id: int, user=None):
        """Ghi sổ phiếu — điểm DUY NHẤT tồn kho đổi.

        MỘT giao dịch, MỘT commit — kể cả phần giữ chỗ (nhả khi xuất, chuyển đang-về → kho khi
        nhập). Nhặt thêm giữ chỗ cho lệnh đang chờ (`nhat_them`) chạy SAU commit, ngoài khoá phiếu.

        ĐIỀU CHUYỂN (mô hình 2 yêu cầu): phiếu XUẤT nguồn được tạo NHÁP lúc ấn điều chuyển, CHƯA trừ
        tồn. Khi kho đích ghi sổ phiếu NHẬP → ghi sổ LUÔN phiếu xuất nguồn (draft) trong CÙNG một
        giao dịch: **trừ nguồn RỒI cộng đích cùng một nhịp** (không trừ trước lúc chưa ghi sổ)."""
        # Chặn ghi sổ 2 lần: khóa dòng phiếu TRƯỚC khi đọc trạng thái. Hai request /post song song
        # (double-click) sẽ tuần tự — request sau chờ request đầu commit rồi đọc thấy 'posted' → dừng
        # ở guard dưới, không tạo lô/trừ tồn lần hai.
        self.vouchers.lock_for_update(voucher_id)
        v = self.vouchers.get_with_lines(voucher_id)
        if v is None:
            raise StockVoucherError("Không tìm thấy phiếu.")
        if v.trang_thai != VOUCHER_DRAFT:
            raise StockVoucherError("Chỉ ghi sổ được phiếu đang ở trạng thái Nháp.")

        dest_req = self.requests.get_with_lines(v.request_id)
        # Phiếu XUẤT nguồn của điều chuyển KHÔNG ghi sổ riêng — nó tự ghi sổ khi kho đích nhập.
        if (dest_req is not None and getattr(dest_req, "dieu_chuyen", False)
                and v.loai == VOUCHER_XUAT):
            raise StockVoucherError(
                "Phiếu xuất điều chuyển tự ghi sổ khi kho đích nhập — không ghi sổ riêng."
            )

        # ĐIỀU CHUYỂN: phiếu NHẬP đích ghi sổ → ghép phiếu XUẤT nguồn (draft) vào cùng giao dịch.
        src_v: StockVoucher | None = None
        if (dest_req is not None and getattr(dest_req, "dieu_chuyen", False)
                and v.loai == VOUCHER_NHAP and getattr(dest_req, "xuat_voucher_id", None)):
            cand = self.vouchers.get_with_lines(dest_req.xuat_voucher_id)
            if cand is None or cand.trang_thai == VOUCHER_CANCELLED:
                raise StockVoucherError(
                    "Phiếu xuất nguồn của điều chuyển không còn — không nhập kho đích được."
                )
            if cand.trang_thai == VOUCHER_DRAFT:
                src_v = cand  # sẽ ghi sổ CÙNG LÚC (trừ nguồn); đã posted thì bỏ qua (nguồn đã trừ).

        src_req = self._apply_post(src_v, user) if src_v is not None else None  # trừ nguồn
        req = self._apply_post(v, user)                                          # cộng đích
        # Nhật ký cùng giao dịch với sổ kho: phiếu đã vào sổ thì dòng này có, rollback thì mất theo.
        # Điều chuyển ghi sổ CẢ CẶP một nhịp nên mỗi phiếu một dòng, để tab lịch sử phiếu nào cũng đủ.
        if src_v is not None:
            self._nhat_ky(user, "kho_phieu_ghi_so", src_v, them=f"cùng phiếu điều chuyển {v.ma}",
                          commit=False)
        self._nhat_ky(user, "kho_phieu_ghi_so", v, commit=False)
        self.vouchers.db.commit()  # MỘT commit → trừ nguồn + cộng đích cùng nhịp (atomic)
        AuditLogRepository.bao_co_dong_moi()   # `commit=False` ở trên không tự báo màn Nhật ký
        self.vouchers.db.refresh(v)
        if self.giu_cho is not None:
            self.giu_cho.sau_ghi_so()
            if v.loai == VOUCHER_NHAP:
                self._nhat_them_sau_commit()
        # Yêu cầu tự chuyển Hoàn tất / Đã cấp một phần + đẩy realtime (vế xuất nguồn im lặng).
        if src_req is not None:
            self.request_service.refresh_fulfillment(src_req)
        self.request_service.refresh_fulfillment(req)
        return v

    def dieu_chinh_xuat(self, voucher_id: int, so_luong_moi: dict[int, float], user=None):
        """SỬA SỐ XUẤT NHẦM trên phiếu XUẤT đã ghi sổ (xuất 10 → đúng ra 7). Từ 11/10/2026 hàng sản
        xuất dùng thừa trả về bằng YÊU CẦU NHẬP KHO của tổ (phiếu nhập, giá bình quân lô đã xuất) —
        nút này chỉ để kho sửa khi xuất nhầm số.

        Sửa THẲNG dòng phiếu (giảm `so_luong`/`sl_goc`), TRẢ phần dư về LÔ nguồn (`sl_con_lai +=`),
        và GIẢM `sl_da_ung` của dòng yêu cầu tương ứng → yêu cầu quay lại 'còn N chưa cấp'
        (Option 2 chốt 2026-08-28). CỐ Ý phá nguyên tắc phiếu-đã-ghi-sổ-bất-biến (BRD §1.5) cho ĐÚNG
        ca này; mọi thay đổi khác của phiếu posted vẫn cấm ở `cancel`/`set_*`.

        Chặn: chỉ phiếu XUẤT thường (không điều chuyển), đã ghi sổ, kỳ chưa khóa; mỗi dòng chỉ được
        GIẢM (0 < mới ≤ hiện tại) và phải có ÍT NHẤT một dòng giảm thật. `so_luong_moi`: line_id →
        số lượng mới (theo ĐVT người khai, như `so_luong` trên dòng).
        """
        # Khóa dòng phiếu trước khi đọc trạng thái — chặn điều chỉnh chồng lấn (như `post`).
        self.vouchers.lock_for_update(voucher_id)
        v = self.vouchers.get_with_lines(voucher_id)
        if v is None:
            raise StockVoucherError("Không tìm thấy phiếu.")
        if v.loai != VOUCHER_XUAT:
            raise StockVoucherError("Chỉ điều chỉnh được phiếu XUẤT.")
        if v.trang_thai != VOUCHER_POSTED:
            raise StockVoucherError("Chỉ điều chỉnh được phiếu đã ghi sổ.")
        req = self.requests.get_with_lines(v.request_id)
        if req is None:
            raise StockVoucherError("Không tìm thấy yêu cầu của phiếu.")
        # Điều chuyển: vế xuất nguồn là bút toán nội bộ cặp đôi (trừ nguồn ↔ cộng đích) — sửa lệch một
        # vế sẽ vỡ cân đối 2 kho. Muốn sai khác thì điều chuyển ngược lại.
        if getattr(req, "dieu_chuyen", False) or self.requests.by_xuat_voucher_id(v.id) is not None:
            raise StockVoucherError(
                "Phiếu điều chuyển không điều chỉnh trực tiếp — hãy điều chuyển ngược lại.")
        # Điều chỉnh SỬA THẲNG dòng phiếu → chặn nếu KỲ CỦA PHIẾU đã khóa sổ. Mốc = NGÀY NHẬP/XUẤT
        # KHO trên phiếu (`v.ngay`) — cùng mốc với lúc ghi sổ, không phải ngày ghi sổ hay hôm nay.
        self._assert_period_open(v.kho_id, v.ngay or date.today())
        self._assert_chua_tinh_gia(
            v.kho_id, v.ngay or date.today(), viec="sửa số",
            them=" Hàng sản xuất dùng thừa thì để tổ trả bằng Yêu cầu nhập kho.")

        lines_by_vid = {ln.id: ln for ln in v.lines}
        rlines = {rl.id: rl for rl in req.lines}
        # Màn ĐỌC gộp các dòng lô lẻ theo `request_line_id` thành 1 dòng/mặt hàng (đơn giá bình quân),
        # `id` = dòng ĐẦU nhóm. Nên `so_luong_moi` khoá theo id dòng đầu = TỔNG MỚI của cả nhóm →
        # phải gom lại theo nhóm rồi PHÂN BỔ phần giảm xuống từng dòng lô (không thì so 12 với 1 lô 9
        # rồi báo "tăng"). Giữ thứ tự lô để trả DÒNG CUỐI trước (undo phân bổ gần nhất).
        groups: dict[int, list] = {}
        for ln in v.lines:
            groups.setdefault(ln.request_line_id, []).append(ln)

        # --- Pha 1: kiểm tra TOÀN BỘ, chưa ghi gì ---
        ke_hoach: list[tuple] = []   # (grp, rl, tong_cu, moi)
        co_giam = False
        for ln_id, moi in so_luong_moi.items():
            head = lines_by_vid.get(ln_id)
            if head is None:
                raise StockVoucherError("Dòng điều chỉnh không thuộc phiếu này.")
            grp = groups[head.request_line_id]
            tong_cu = sum(float(l.so_luong) for l in grp)
            moi = float(moi)
            if moi <= 0:
                raise StockVoucherError(
                    "Số lượng mới phải lớn hơn 0 — muốn bỏ hẳn thì đây không phải chỗ.")
            if moi > tong_cu + 1e-9:
                raise StockVoucherError("Chỉ được GIẢM số đã xuất, không tăng.")
            if moi < tong_cu - 1e-9:
                co_giam = True
            rl = rlines.get(head.request_line_id)
            if rl is None:
                raise StockVoucherError("Dòng phiếu trỏ vào yêu cầu khác.")
            ke_hoach.append((grp, rl, tong_cu, moi))
        if not co_giam:
            raise StockVoucherError("Chưa có dòng nào giảm — không có gì để điều chỉnh.")

        # --- Pha 2: ghi + gom tóm tắt thay đổi (nhật ký đọc được: "tên: tổng cũ → tổng mới") ---
        changes: list[str] = []
        for grp, rl, tong_cu, moi in ke_hoach:
            con_bo = tong_cu - moi          # tổng cần BỎ (đơn vị người khai)
            if con_bo <= 1e-9:
                continue
            mh = self.hang.get(rl.hang_loai, rl.hang_id)
            ten = getattr(mh, "ten", None) or f"#{rl.hang_id}"
            changes.append(f"{ten}: {tong_cu:g} → {moi:g}")
            # Phân bổ phần giảm: trừ từ dòng lô CUỐI về đầu, trả `sl_goc` dư về đúng lô của dòng đó.
            remaining = con_bo
            for ln in reversed(grp):
                if remaining <= 1e-9:
                    break
                cur_ln = float(ln.so_luong)
                giam = min(cur_ln, remaining)
                if giam <= 1e-9:
                    continue
                new_ln = cur_ln - giam
                new_goc = float(ln.sl_goc) * new_ln / cur_ln if cur_ln else 0.0
                lot = self.lots.get(ln.lot_id) if ln.lot_id else None
                if lot is not None:
                    self.lots.restore(lot, float(ln.sl_goc) - new_goc)
                if new_ln <= 1e-9:
                    # Dòng lô này trả HẾT → xoá dòng (constraint so_luong/sl_goc > 0, không để 0).
                    self.vouchers.db.delete(ln)
                else:
                    ln.so_luong = new_ln
                    ln.sl_goc = new_goc
                remaining -= giam
            # Chụp TRƯỚC khi trừ: chỉ dòng đã cấp ĐỦ mới được chốt. Kho đang cấp dở (xin 100 mới
            # xuất 60) mà điều chỉnh 60→50 thì "còn lại" phải vẫn là 50, không được thành 0 rồi
            # đóng yêu cầu — 50 tờ kia chưa hề xuất. So với mục tiêu HIỆU LỰC chứ không `sl_duyet`,
            # để điều chỉnh lần hai (100→80→60) vẫn chốt tiếp được.
            da_cap_du = float(rl.sl_da_ung) >= self.request_service.muc_tieu_hieu_luc(rl) - 1e-9
            rl.sl_da_ung = max(0.0, float(rl.sl_da_ung) - con_bo)  # yêu cầu: 'còn N chưa cấp'
            if da_cap_du:
                # CHỐT = TỔNG đã xuất hiện tại của dòng yêu cầu, không phải hiệu của riêng lần
                # điều chỉnh cuối — 100→80→60 phải ra 60, không ra 20. Ghi cột riêng thay vì hạ
                # `sl_duyet`: hạ `sl_duyet` thì xin-100-xuất-70 và xin-70-xuất-70 hoá ra không
                # phân biệt được (spec §2.3).
                rl.sl_chot_thuc_xuat = float(rl.sl_da_ung)

        self.vouchers.db.commit()
        self.vouchers.db.refresh(v)
        # Trả hàng về tồn tự do → lệnh khác đang chờ (giữ chỗ) nhặt thêm — SAU commit, không giữ
        # khoá phiếu + dòng lô suốt lúc dựng bảng cân đối.
        if self.giu_cho is not None:
            self.giu_cho.sau_ghi_so()
            self._nhat_them_sau_commit()
        self.request_service.refresh_fulfillment(req)
        return v, changes

    def _nhat_them_sau_commit(self) -> None:
        if self.hen_nhat_them is not None:
            self.hen_nhat_them()
        else:
            self.giu_cho.nhat_them()

    @staticmethod
    def _gom_theo_hang_nhap(v) -> dict[tuple, float]:
        """`{khoá tồn: Σ sl_goc}` của MỘT phiếu NHẬP — vào kho bao nhiêu, theo mặt hàng (giấy: mã +
        khổ + đơn vị gốc), không cần biết chủ thể (nhập kho không gắn lệnh nào)."""
        ra: dict[tuple, float] = {}
        for ln in v.lines:
            h = khoa_ton(ln.hang_loai, ln.hang_id, goc=ln.don_vi_goc,
                         kho_rong=ln.kho_rong or 0, kho_dai=ln.kho_dai or 0)
            ra[h] = ra.get(h, 0.0) + float(ln.sl_goc)
        return ra

    def _gom_theo_hang_va_chu_the(self, v, lines_by_id: dict) -> dict[tuple, float]:
        """`{(khoá tồn, (lsx_id, bai_ghep_id)): Σ sl_goc}` của phiếu — giấy khoá theo mã + khổ + đơn vị gốc.

        Gộp theo ĐƠN VỊ GỐC (`sl_goc`) vì giữ chỗ đếm bằng đơn vị gốc — so `so_luong` (đơn vị người
        khai) với chỗ giữ là so hai thang khác nhau, đúng bẫy mà cửa kiểm lô ngay trên đã dặn.

        Chủ thể lấy từ DÒNG YÊU CẦU: phiếu kho không tự biết xuất cho lệnh nào, `stock_request_lines`
        mới là chỗ khai.

        [MỚI 30/08/2026] Dòng yêu cầu có thể khai `lsx_id` từ lúc lệnh còn ĐỘC LẬP, nhưng lệnh đó
        SAU ĐÓ bị cuốn vào bài ghép. Giữ chỗ theo NHU CẦU THẬT (`can_doi()`), KHÔNG theo cấu trúc
        bảng ghép: vật tư RIÊNG bước của LSX thành viên vẫn thuộc LSX dù đã ghép (spec §2); chỉ vật
        tư CHUNG (giấy + vật tư bước chung) mới thuộc bài. Vì vậy CHỈ quy `(lsx_id, None)` sang
        `(None, bai_ghep_id)` khi `can_doi()` KHÔNG còn nhu cầu riêng của đúng LSX cho đúng mặt hàng
        này — nếu vẫn còn, giữ nguyên chủ thể LSX (không quy nhầm vật tư riêng sang bài). Mơ hồ
        (không khớp nhu cầu riêng LẪN nhu cầu bài) → chặn ghi sổ, không đoán (spec §2). Chỉ chạy khi
        có `self.giu_cho` — không giữ chỗ thì không có gì phải bảo vệ, giữ hành vi CŨ (đọc thẳng
        `lsx_id`/`bai_ghep_id` từ dòng yêu cầu).
        """
        from sqlalchemy import select

        from ..models.bai_ghep import BaiGhep, BaiGhepThanhVien
        from ..models.lsx import Lsx

        nhu_cau = None
        ghep_cua: dict[int, int] = {}
        if self.giu_cho is not None:
            lsx_can_tra = {
                getattr(rl, "lsx_id", None)
                for rl in lines_by_id.values()
                if getattr(rl, "lsx_id", None) is not None
                and getattr(rl, "bai_ghep_id", None) is None
            }
            if lsx_can_tra:
                ghep_cua = dict(self.vouchers.db.execute(
                    select(BaiGhepThanhVien.lsx_id, BaiGhepThanhVien.bai_ghep_id)
                    .where(BaiGhepThanhVien.lsx_id.in_(lsx_can_tra))
                ).all())
            if ghep_cua:
                nhu_cau = self.giu_cho._nhu_cau_theo_chu_the(self.giu_cho.kh.can_doi())

        ra: dict[tuple, float] = {}
        for ln in v.lines:
            rl = lines_by_id.get(ln.request_line_id)
            lsx_id = getattr(rl, "lsx_id", None)
            bg_id = getattr(rl, "bai_ghep_id", None)
            hang = khoa_ton(ln.hang_loai, ln.hang_id, goc=ln.don_vi_goc,
                            kho_rong=ln.kho_rong or 0, kho_dai=ln.kho_dai or 0)
            if nhu_cau is not None and lsx_id is not None and bg_id is None and lsx_id in ghep_cua:
                if hang not in nhu_cau.get((lsx_id, None), {}):
                    bid = ghep_cua[lsx_id]
                    if hang in nhu_cau.get((None, bid), {}):
                        lsx_id, bg_id = None, bid
                    else:
                        # Hiện TÊN/MÃ dễ đọc thay vì id thô — cùng lý do cửa kiểm lô ngay trên đã
                        # dặn (dòng ~279): người xem lỗi này là kho, họ đọc mã "LSX-A"/"GB-1", không
                        # đọc id nội bộ. Fallback về id khi không tra được (danh mục/lệnh đã mất).
                        cap = (hang[0], hang[1])
                        ten_hang = getattr(
                            self.hang.map_theo_cap([cap]).get(cap), "ten", None
                        ) or f"{hang[0]}#{hang[1]}"
                        ma_lsx = getattr(
                            self.vouchers.db.get(Lsx, lsx_id), "ma", None
                        ) or f"lệnh #{lsx_id}"
                        ma_bai = getattr(
                            self.vouchers.db.get(BaiGhep, bid), "ma", None
                        ) or f"bài ghép #{bid}"
                        raise StockVoucherError(
                            f"Không xác định được {ten_hang} thuộc {ma_lsx} riêng hay {ma_bai} — "
                            "vào Kế hoạch vật tư kiểm lại trước khi ghi sổ."
                        )
            khoa = (hang, (lsx_id, bg_id))
            ra[khoa] = ra.get(khoa, 0.0) + float(ln.sl_goc)
        return ra

    # --- Điều chuyển kho (tái dùng nhập/xuất — spec-dieu-chuyen-kho) ---------

    def dieu_chuyen(self, *, user, kho_nguon_id: int, kho_den_id: int,
                    items: list[dict], ghi_chu: str | None = None) -> dict:
        """Ấn ĐIỀU CHUYỂN 1 HAY NHIỀU mặt hàng kho nguồn → kho đích (gộp vào MỘT nhịp).

        Tái dùng TRỌN cơ chế nhập/xuất, CHỈ TRỪ TỒN KHI GHI SỔ (spec §2):
          1) MỘT yêu cầu XUẤT nội bộ ở nguồn + MỘT phiếu XUẤT NHÁP (FEFO→FIFO đích danh mỗi mặt
             hàng) — CHƯA trừ tồn.
          2) MỘT yêu cầu NHẬP ở đích (yêu cầu điều chuyển) + phiếu NHẬP đích DỰNG SẴN theo TỪNG LÔ
             nguồn (giá vốn + HSD khoá đích danh từng lô, KHÔNG bình quân). Kho đích chỉ ghi sổ →
             trừ nguồn + cộng đích cùng nhịp (xem `post`).
        Trả `{yeu_cau, phieu_xuat, phieu_nhap, gia_von}` (gia_von = tổng giá vốn điều chuyển)."""
        if kho_nguon_id == kho_den_id:
            raise StockVoucherError("Kho nguồn và kho đích phải khác nhau.")
        if not items:
            raise StockVoucherError("Chưa chọn mặt hàng để điều chuyển.")
        # Thành phẩm nằm cố định ở Kho thành phẩm (12/10/2026): chỉ chuyển VỀ kho đó, không chuyển đi.
        # Vế nhập đích (`create(_dc_dest=True)`) cũng chặn — kiểm sớm để báo trước khi dựng gì.
        from .kho_thanh_pham import hang_thanh_pham, id_kho_thanh_pham
        kho_tp = id_kho_thanh_pham(self.vouchers.db)
        if (kho_tp is not None and kho_den_id != kho_tp
                and hang_thanh_pham(self.vouchers.db, [(it["hang_loai"], it["hang_id"]) for it in items])):
            raise StockVoucherError("Thành phẩm nằm ở Kho thành phẩm — không điều chuyển sang kho khác.")

        # (1) Duyệt từng mặt hàng: đơn vị gốc + FIFO đích danh ở nguồn + giá vốn bình quân.
        # Điều chuyển theo ĐƠN VỊ GỐC (spec §13) → dòng yêu cầu lấy dvt = đơn vị gốc, hệ số quy đổi
        # = 1: số trên phiếu = số vào lô, giá vốn (đ/gốc) khớp thẳng.
        prepared: list[dict] = []
        seen: set = set()
        for it in items:
            hang_loai, hang_id = it["hang_loai"], int(it["hang_id"])
            key = (hang_loai, hang_id)
            # GIẤY chuyển theo NHÓM LÔ (khổ, đơn vị gốc), VẬT TƯ theo đơn vị gốc: mỗi nhóm một dòng,
            # số theo đơn vị gốc đó.
            kr, kd = (chuan_kho(it.get("kho_rong"), it.get("kho_dai"))
                      if hang_loai == "giay" else (0, 0))
            dv_goc = (self._goc_dieu_chuyen(hang_loai, hang_id, kho_nguon_id, it, kr, kd)
                      if co_don_vi_goc(hang_loai) else None)
            kd_key = khoa_dong(hang_loai, hang_id, dv_goc, kr, kd)
            if kd_key in seen:
                raise StockVoucherError("Một mặt hàng chỉ được điều chuyển 1 dòng — gộp số lượng lại.")
            seen.add(kd_key)
            qty = float(it.get("so_luong") or 0)
            if qty <= 0:
                raise StockVoucherError("Số lượng điều chuyển phải lớn hơn 0.")
            from .vat_lieu_kho_service import VatLieuKhoError
            try:
                dv = self.hang.don_vi_cua_mat_hang(hang_loai, hang_id, goc=dv_goc)
            except VatLieuKhoError as e:
                raise StockVoucherError(str(e)) from None
            dvt_goc = dv.get("don_vi_goc")
            ten = dv.get("ten") or "Mặt hàng"
            if not dvt_goc:
                raise StockVoucherError(f"“{ten}” chưa khai đơn vị tính — không điều chuyển được.")
            alloc, thieu = self.suggest_allocation(
                key, kho_nguon_id, qty, goc=dv_goc, kho_rong=kr, kho_dai=kd)
            if thieu > 1e-9:
                raise StockVoucherError(
                    f"“{ten}”: kho nguồn không đủ tồn để điều chuyển (thiếu {thieu:g} {dvt_goc})."
                )
            tong_tien = sum(float(a["so_luong"]) * int(a["don_gia_nhap"] or 0) for a in alloc)
            prepared.append({
                "hang_loai": hang_loai, "hang_id": hang_id, "dvt_goc": dvt_goc,
                "kho_rong": kr, "kho_dai": kd, "khoa": kd_key,
                "qty": qty, "alloc": alloc, "gia_von": int(round(tong_tien / qty)) if qty else 0,
                # Vị trí kho đích khai lúc ấn (tuỳ chọn) — áp cho MỌI lô của mặt hàng này.
                "vi_tri": (str(it.get("vi_tri") or "").strip() or None),
            })

        # Điều chuyển rồi sẽ ghi sổ ở kho nguồn (lúc đích nhập) → chặn SỚM nếu kỳ nguồn đã khóa sổ.
        # Phiếu điều chuyển không có ô ngày riêng nên mốc = hôm nay (= `v.ngay` mặc định của phiếu
        # sắp tạo); `_apply_post` kiểm lại theo đúng `v.ngay` khi ghi sổ.
        self._assert_period_open(kho_nguon_id, date.today())

        # (2) MỘT yêu cầu XUẤT nội bộ ở nguồn (im lặng) — mỗi mặt hàng 1 dòng.
        src_req = self.request_service.create_dieu_chuyen(
            user=user, loai=VOUCHER_XUAT, kho_id=kho_nguon_id, ghi_chu=ghi_chu, notify=False,
            lines=[
                {"hang_loai": p["hang_loai"], "hang_id": p["hang_id"],
                 "kho_rong": p["kho_rong"], "kho_dai": p["kho_dai"],
                 "dvt": p["dvt_goc"], "sl_de_nghi": p["qty"]}
                for p in prepared
            ],
        )
        # Nối dòng yêu cầu ↔ mặt hàng theo khoá dòng (mã [+ khổ + đơn vị gốc với giấy]) — không dựa
        # thứ tự. Dòng yêu cầu lấy ĐVT = đơn vị gốc nên `_validate_lines` suy lại đúng gốc đó.
        def khoa_rl(rl):
            return khoa_dong(rl.hang_loai, rl.hang_id, rl.don_vi_goc, rl.kho_rong, rl.kho_dai)

        src_by_hang = {khoa_rl(rl): rl for rl in src_req.lines}
        xuat_lines: list[dict] = []
        for p in prepared:
            rl = src_by_hang[p["khoa"]]
            for a in p["alloc"]:
                xuat_lines.append({
                    "request_line_id": rl.id, "so_luong": float(a["so_luong"]),
                    "lot_id": a["lot_id"],
                })
        # Phiếu xuất nguồn để NHÁP — CHƯA trừ tồn. Nó tự ghi sổ (trừ nguồn) khi kho đích ghi sổ
        # phiếu nhập (xem `post`): trừ nguồn RỒI cộng đích cùng một nhịp, không trừ trước.
        xuat = self.create(
            user=user, request_id=src_req.id, kho_id=kho_nguon_id, ghi_chu=ghi_chu, lines=xuat_lines,
        )

        # (3) MỘT yêu cầu NHẬP ở đích = yêu cầu điều chuyển (THẤY ĐƯỢC): đơn giá dòng = giá vốn bình
        # quân (chỉ để HIỂN THỊ mức giá của yêu cầu); kho nguồn + phiếu xuất để truy cặp đi–đến.
        dest_req = self.request_service.create_dieu_chuyen(
            user=user, loai=VOUCHER_NHAP, kho_id=kho_den_id,
            kho_nguon_id=kho_nguon_id, xuat_voucher_id=xuat.id, ghi_chu=ghi_chu, notify=True,
            doc_type=SEQ_DOC_TYPE_STOCK_TRANSFER,   # số phiếu điều chuyển DC… (đầu mối mặt tiền)
            lines=[
                {"hang_loai": p["hang_loai"], "hang_id": p["hang_id"], "dvt": p["dvt_goc"],
                 "kho_rong": p["kho_rong"], "kho_dai": p["kho_dai"],
                 "sl_de_nghi": p["qty"], "don_gia": p["gia_von"]}
                for p in prepared
            ],
        )
        # (4) DỰNG SẴN phiếu NHẬP đích (nháp) — MỖI LÔ nguồn 1 dòng, khoá GIÁ VỐN + HSD ĐÍCH DANH
        # theo lô (không bình quân) để kho đích chạy FEFO/giá vốn y như nguồn. Điều chuyển theo đơn
        # vị gốc (hệ số 1) ⇒ so_luong = sl_goc. Kho đích chỉ xem lại + ghi sổ (trừ nguồn + cộng đích).
        dest_rl_by_hang = {khoa_rl(rl): rl for rl in dest_req.lines}
        nhap_lines: list[dict] = []
        for p in prepared:
            rl = dest_rl_by_hang[p["khoa"]]
            for a in p["alloc"]:
                nhap_lines.append({
                    "request_line_id": rl.id,
                    "so_luong": float(a["so_luong"]),
                    "don_gia": int(a["don_gia_nhap"] or 0),  # giá vốn ĐÚNG lô nguồn
                    "hsd": a.get("hsd"),                      # HSD đi theo lô
                    "vi_tri": p.get("vi_tri"),                # vị trí kho đích (khai lúc ấn, nếu có)
                    "lo_goc_id": a["lo_goc_id"],              # A → B → C vẫn trỏ về MỘT lô gốc
                    # Giấy: đơn vị gốc + khổ đi theo lô nguồn sang lô mới ở kho đích.
                    "don_vi_goc": a.get("don_vi_goc"), "kho_rong": a.get("kho_rong"),
                    "kho_dai": a.get("kho_dai"),
                })
        nhap = self.create(
            user=user, request_id=dest_req.id, kho_id=kho_den_id, ghi_chu=ghi_chu,
            lines=nhap_lines, _dc_dest=True,
        )
        tong_gia_von = sum(int(round(p["gia_von"] * p["qty"])) for p in prepared)
        return {"yeu_cau": dest_req, "phieu_xuat": xuat, "phieu_nhap": nhap,
                "gia_von": tong_gia_von}

    def cancel(self, voucher_id: int, ly_do: str, user=None):
        """Hủy phiếu khi CÒN NHÁP — BẮT BUỘC lý do; yêu cầu chuyển 'Đã hủy' kèm lý do (KẾT THÚC,
        không cấp lại). Phiếu đã ghi sổ không hủy được — muốn sửa thì lập phiếu điều chỉnh
        (BRD §1.5: chứng từ đã ghi không sửa trực tiếp)."""
        # Khoá dòng phiếu TRƯỚC khi đọc trạng thái, như `post`: huỷ và ghi sổ cùng lúc thì lượt sau
        # chờ lượt đầu commit rồi đọc lại — không có phiếu vừa ghi sổ vừa "đã huỷ".
        self.vouchers.lock_for_update(voucher_id)
        v = self.vouchers.get(voucher_id)
        if v is None:
            raise StockVoucherError("Không tìm thấy phiếu.")
        if v.trang_thai != VOUCHER_DRAFT:
            raise StockVoucherError(
                "Phiếu đã ghi sổ không hủy được — hãy lập phiếu điều chỉnh."
            )
        # ĐIỀU CHUYỂN đi theo CẶP (xuất nguồn + nhập đích). KHÔNG hủy riêng bất kỳ vế nào qua đây:
        # hủy riêng vế XUẤT thì kho đích không nhập được; hủy riêng vế NHẬP đích thì phiếu xuất nguồn
        # mồ côi (không ghi sổ / không hủy được) — phải hủy CẢ CẶP qua `huy_dieu_chuyen`.
        req0 = self.requests.get(v.request_id)
        if req0 is not None and getattr(req0, "dieu_chuyen", False):
            raise StockVoucherError(
                "Phiếu điều chuyển không hủy riêng — dùng chức năng Hủy điều chuyển (hủy cả cặp)."
            )
        # Hủy phiếu NHÁP chưa vào sổ → không xét khóa kỳ (phiếu đã ghi sổ vốn không hủy được).
        v.trang_thai = VOUCHER_CANCELLED
        v = self.vouchers.save(v)
        # Không còn phiếu active nào cho yêu cầu → yêu cầu chuyển 'Đã hủy' kèm lý do (kết thúc).
        # Còn phiếu ĐÃ GHI SỔ (đã cấp một phần) → giữ nguyên trạng thái, không đóng yêu cầu.
        req = self.requests.get_with_lines(v.request_id)
        if req is not None:
            rows, _ = self.vouchers.list(request_id=req.id)
            if not any(x.trang_thai != VOUCHER_CANCELLED for x in rows):
                self.request_service.cancel_by_kho(req, ly_do)
        self._nhat_ky(user, "kho_phieu_huy", v, them=f"lý do {ly_do}")
        return v

    def huy_dieu_chuyen(self, dest_req_id: int, ly_do: str, user=None):
        """Hủy CẢ phiếu điều chuyển khi CHƯA ghi sổ (spec-phieu-dieu-chuyen §5). Nhờ (ii) trừ-khi-ghi-
        sổ nên trước ghi sổ CHƯA trừ gì → hủy sạch: phiếu NHẬP đích (nháp) + phiếu XUẤT nguồn (nháp)
        + đóng 2 yêu cầu, KHÔNG đụng tồn. Đã ghi sổ → chặn (sửa sai bằng điều chuyển ngược)."""
        dest_req = self.requests.get_with_lines(dest_req_id)
        if (dest_req is None or not getattr(dest_req, "dieu_chuyen", False)
                or dest_req.loai != VOUCHER_NHAP):
            raise StockVoucherError("Không tìm thấy phiếu điều chuyển.")
        if not (ly_do or "").strip():
            raise StockVoucherError("Hủy phiếu điều chuyển phải có lý do.")
        # Phiếu NHẬP đích còn NHÁP mới hủy được. `draft_ids_by_request` CHỈ trả phiếu nháp → đã ghi
        # sổ (posted) thì trả rỗng ⇒ chặn đúng mà không phải tự dò trạng thái.
        dest_v_id = self.vouchers.draft_ids_by_request([dest_req.id]).get(dest_req.id)
        if dest_v_id is None:
            raise StockVoucherError(
                "Điều chuyển đã ghi sổ — không hủy được, hãy điều chuyển ngược lại."
            )
        dest_v = self.vouchers.get(dest_v_id)
        dest_v.trang_thai = VOUCHER_CANCELLED
        self.vouchers.save(dest_v)
        # Phiếu XUẤT nguồn (nháp) gắn cặp — hủy luôn + đóng yêu cầu xuất nội bộ (nếu còn nháp).
        src_v = self.vouchers.get(dest_req.xuat_voucher_id) if dest_req.xuat_voucher_id else None
        src_huy_luc_nay = False     # chỉ ghi nhật ký "huỷ" cho phiếu mà CHÍNH lần này huỷ
        if src_v is not None and src_v.trang_thai == VOUCHER_DRAFT:
            src_huy_luc_nay = True
            src_v.trang_thai = VOUCHER_CANCELLED
            self.vouchers.save(src_v)
            src_req = self.requests.get_with_lines(src_v.request_id)
            if src_req is not None:
                self.request_service.cancel_by_kho(src_req, ly_do)
        self.request_service.cancel_by_kho(dest_req, ly_do)
        # Hai phiếu con bị huỷ cùng nhịp: mỗi phiếu một dòng để tab lịch sử phiếu nào cũng đủ.
        self._nhat_ky(user, "kho_phieu_huy", dest_v, them=f"huỷ cả cặp điều chuyển, lý do {ly_do}",
                      commit=False)
        if src_huy_luc_nay:
            self._nhat_ky(user, "kho_phieu_huy", src_v,
                          them=f"huỷ cả cặp điều chuyển, lý do {ly_do}", commit=False)
        self.vouchers.db.commit()
        AuditLogRepository.bao_co_dong_moi()
        return dest_req

    def dc_request_id_for_voucher(self, voucher_id: int) -> int | None:
        """Từ MỘT phiếu điều chuyển → id yêu cầu ĐIỀU CHUYỂN (mặt tiền DC), để FE mở đúng PHIẾU ĐIỀU
        CHUYỂN thay vì mẫu nhập/xuất. Phiếu NHẬP-đích = chính `request_id`; phiếu XUẤT-nguồn = yêu cầu
        DC đích có `xuat_voucher_id` = phiếu. None nếu KHÔNG phải phiếu điều chuyển / không truy được."""
        v = self.vouchers.get(voucher_id)
        if v is None or not getattr(v, "dieu_chuyen", False):
            return None
        if v.loai == VOUCHER_NHAP:
            return v.request_id
        dest = self.requests.by_xuat_voucher_id(v.id)
        return dest.id if dest else None

    def set_lot_vi_tri(self, lot_id: int, vi_tri: str | None):
        """Thủ kho sửa VỊ TRÍ cất lô (kệ/ô) trong kho — người cầm hàng quản vị trí vật lý."""
        lot = self.lots.set_vi_tri(lot_id, (vi_tri or "").strip() or None)
        if lot is None:
            raise StockVoucherError("Không tìm thấy lô.")
        return lot

    def bo_sung_kho_lo(self, lot_id: int, *, user, kho_rong: int, kho_dai: int = 0):
        """Kho bổ sung KHỔ cho lô giấy CŨ chưa có khổ (`kho_rong == 0`). Giấy không còn dạng cuộn/tờ
        (10/10/2026) nên CHỈ ghi khổ: số lượng, đơn vị gốc và đơn giá nhập giữ NGUYÊN — tờ và kg không
        quy đổi với nhau, máy không tự đổi khối lượng ra tờ. Khổ một cạnh ⇒ khổ chỉ-rộng `(r, 0)`."""
        lot = self.lots.get_for_update(lot_id)   # khoá dòng rồi mới kiểm lại khổ
        if lot is None:
            raise StockVoucherError("Không tìm thấy lô.")
        if lot.hang_loai != "giay":
            raise StockVoucherError("Chỉ lô giấy mới có khổ.")
        if int(lot.kho_rong or 0):
            raise StockVoucherError("Lô đã có khổ.")
        kr, kd = chuan_kho(kho_rong, kho_dai)
        if not kr:
            raise StockVoucherError("Nhập khổ (mm) — ít nhất cạnh rộng.")
        ma_nhap = self.lots.ma_phieu_xuat_nhap_tro_vao(lot.id)
        if ma_nhap:
            raise StockVoucherError(
                f"Lô đang nằm trong phiếu xuất nháp {ma_nhap}, hoàn tất hoặc huỷ phiếu trước.")
        self.lots.ghi_kho_goc(lot, goc=lot.don_vi_goc or "", kho_rong=kr, kho_dai=kd,
                              sl_ban_dau=lot.sl_ban_dau, sl_con_lai=lot.sl_con_lai)
        AuditLogRepository(self.lots.db).create(
            actor_user_id=user.id, action="kho_bo_sung_kho_lo", target=f"stock_lot:{lot.id}",
            detail=f"{lot.ma_lo}: chưa có khổ → {nhan_kho(kr, kd)} · số lượng, đơn vị, đơn giá giữ nguyên",
            commit=False,
        )
        self.lots.db.commit()
        self.lots.db.refresh(lot)
        return lot

    def set_draft_line_vi_tri(self, voucher_id: int, items: list[dict]):
        """Khai VỊ TRÍ cất lô cho DÒNG phiếu NHẬP còn NHÁP (ghi sổ sẽ chép sang lô). Dùng cho phiếu
        ĐIỀU CHUYỂN đích dựng sẵn — thủ kho đích khai chỗ cất TRƯỚC khi ghi sổ. Chỉ sửa khi phiếu
        còn nháp; đã ghi sổ thì sửa ở LÔ (`set_lot_vi_tri`)."""
        v = self.vouchers.get_with_lines(voucher_id)
        if v is None:
            raise StockVoucherError("Không tìm thấy phiếu.")
        if v.loai != VOUCHER_NHAP:
            raise StockVoucherError("Chỉ phiếu nhập mới khai vị trí cất lô.")
        if v.trang_thai != VOUCHER_DRAFT:
            raise StockVoucherError("Phiếu đã ghi sổ — sửa vị trí ở lô, không sửa trên phiếu.")
        by_id = {ln.id: ln for ln in v.lines}
        for it in items:
            ln = by_id.get(int(it["line_id"]))
            if ln is not None:
                ln.vi_tri = (it.get("vi_tri") or "").strip() or None
        return self.vouchers.save(v)

    # --- Gợi ý phân bổ lô ----------------------------------------------------

    def suggest_allocation(
        self, hang: tuple[str, int], kho_id: int, qty: float, *, request_id: int | None = None,
        goc: str | None = None, kho_rong: int = 0, kho_dai: int = 0,
    ) -> tuple[list[dict], float]:
        """Gợi ý lấy `qty` (ĐƠN VỊ GỐC) từ những lô nào (FEFO → FIFO): `(dòng phân bổ, còn thiếu)`.

        Chỉ là GỢI Ý: thủ kho sửa được, vì BRD §3.19 chốt giá xuất đích danh — người cầm
        hàng mới biết lô nào đang ở đầu kệ. Không đủ hàng thì trả phần lấy được kèm
        `thieu` > 0 để UI báo thiếu thay vì âm thầm cấp non.

        `request_id` là yêu cầu XUẤT do Giao hàng gửi (đơn X): lô của chính đơn X trước → lô không nguồn
        → lô đơn khác cùng khách (kèm `canh_bao`); lô của khách khác bị bỏ. Trong mỗi nhóm giữ FEFO →
        FIFO (design nhập kho thành phẩm §6). Không có đơn ⇒ thứ tự như cũ.

        `goc` (giấy / vật tư): chỉ lô đếm đúng đơn vị gốc đó (+ đúng khổ khi có khổ); None ⇒ không lọc.
        """
        lots = self.lots.issuable_lots(hang, kho_id, goc=goc, kho_rong=kho_rong, kho_dai=kho_dai)
        nguon = self.lots.nguon_lo([l.id for l in lots])
        dich = self.requests.don_giao_cua_yeu_cau(request_id) if request_id else None
        canh_bao: dict[int, str] = {}
        if dich:
            hang_doi = []
            for lot in lots:
                n = nguon.get(lot.id) or {}
                if n.get("order_id") is None:
                    hang_doi.append((1, lot))
                elif n["order_id"] == dich["order_id"]:
                    hang_doi.append((0, lot))
                elif n.get("customer_id") == dich["customer_id"]:
                    canh_bao[lot.id] = f"Lô này sản xuất cho đơn {n.get('order_ma')}"
                    hang_doi.append((2, lot))
            lots = [lot for _, lot in sorted(hang_doi, key=lambda x: x[0])]  # sort ổn định
        remaining = float(qty)
        out: list[dict] = []
        for lot in lots:
            if remaining <= 0:
                break
            take = min(remaining, float(lot.sl_con_lai))
            n = nguon.get(lot.id) or {}
            out.append({
                "lot_id": lot.id,
                "ma_lo": lot.ma_lo,
                "ngay_nhap": lot.ngay_nhap,
                "hsd": lot.hsd,
                "sl_con_lai": float(lot.sl_con_lai),
                "so_luong": take,
                "don_gia_nhap": int(lot.don_gia_nhap or 0),
                "lo_goc_id": goc_cua(lot),
                "don_vi_goc": lot.don_vi_goc or "", "kho_rong": lot.kho_rong, "kho_dai": lot.kho_dai,
                "order_ma": n.get("order_ma"),
                "khach_hang": n.get("khach_hang"),
                "canh_bao": canh_bao.get(lot.id),
                "chua_gia_goc": bool(n.get("tu_kcs")) and not lot.don_gia_nhap,
            })
            remaining -= take
        return out, max(0.0, round(remaining, 2))

    # --- Giá vốn ------------------------------------------------------------

    def cost_of(self, voucher: StockVoucher) -> int:
        """Giá vốn phiếu. NHẬP dùng `don_gia` trên dòng; XUẤT lấy giá ĐÍCH DANH của lô.

        Router chỉ gọi khi người dùng có `can_view_cost` — thiếu quyền thì không những ẩn
        cột mà còn không tính, để số không lọt ra qua response.
        """
        total = 0
        for ln in voucher.lines:
            if voucher.loai == VOUCHER_NHAP:
                # NHẬP: đơn giá và số lượng CÙNG ở đơn vị người khai — nhân thẳng, khỏi quy đổi.
                total += int(round(int(ln.don_gia or 0) * float(ln.so_luong)))
            else:
                # XUẤT: giá của lô theo ĐƠN VỊ GỐC nên phải nhân với `sl_goc`, không phải
                # `so_luong` — nhân nhầm là giá vốn lệch đúng bằng hệ số quy đổi.
                lot = self.lots.get(ln.lot_id) if ln.lot_id else None
                unit = int(lot.don_gia_nhap or 0) if lot else 0
                total += int(round(unit * float(ln.sl_goc)))
        return total

    # --- Đính kèm hóa đơn/chứng từ gốc (mirror accounting) ------------------
    def _voucher_or_raise(self, voucher_id: int) -> StockVoucher:
        v = self.vouchers.get(voucher_id)
        if v is None:
            raise StockVoucherError("Không tìm thấy phiếu.")
        return v

    def list_attachments(self, voucher_id: int) -> list[dict]:
        self._voucher_or_raise(voucher_id)
        return [self._attachment_out(r) for r in self.vouchers.list_attachments(voucher_id)]

    def add_attachment(self, voucher_id: int, *, actor, file_name: str | None,
                       content_type: str | None, data: bytes) -> dict:
        v = self._voucher_or_raise(voucher_id)
        if v.trang_thai == VOUCHER_CANCELLED:
            raise StockVoucherError("Phiếu đã hủy — không đính kèm thêm.")
        ct = (content_type or "").lower()
        if not (ct.startswith("image/") or ct == "application/pdf"):
            raise StockVoucherError("Chỉ nhận ảnh (image/*) hoặc PDF.")
        if not data:
            raise StockVoucherError("Tệp rỗng.")
        if len(data) > MAX_ATTACHMENT_BYTES:
            raise StockVoucherError("Tệp vượt quá 10 MB.")
        if len(self.vouchers.list_attachments(v.id)) >= MAX_ATTACHMENTS_PER_VOUCHER:
            raise StockVoucherError(
                f"Mỗi phiếu tối đa {MAX_ATTACHMENTS_PER_VOUCHER} file đính kèm."
            )
        safe_name = _safe_attachment_name(file_name)
        key = f"{_ATTACHMENT_SUBDIR}/{v.id}/{secrets.token_hex(4)}_{safe_name}"
        get_storage().save(key, data, content_type)
        row = StockVoucherAttachment(
            stock_voucher_id=v.id,
            file_name=safe_name,
            file_url=url_from_key(key),  # "/api/files/kho/<id>/.." — đọc qua router có đăng nhập
            file_type=content_type,
            uploaded_by=getattr(actor, "id", None),
        )
        return self._attachment_out(self.vouchers.save_attachment(row))

    def delete_attachment(self, voucher_id: int, attachment_id: int, *, actor) -> None:
        self._voucher_or_raise(voucher_id)
        att = self.vouchers.get_attachment(attachment_id)
        if att is None or att.stock_voucher_id != voucher_id:
            raise StockVoucherError("Không tìm thấy file đính kèm.")
        key = key_from_url(att.file_url)
        if key:
            get_storage().delete(key)  # best-effort; row vẫn phải xoá dù file đã mất
        self.vouchers.delete_attachment(att)

    @staticmethod
    def _attachment_out(row: StockVoucherAttachment) -> dict:
        return {
            "id": row.id,
            "stock_voucher_id": row.stock_voucher_id,
            "file_name": row.file_name,
            "file_url": row.file_url,
            "file_type": row.file_type,
            "uploaded_by": row.uploaded_by,
            "uploaded_at": row.uploaded_at,
        }
