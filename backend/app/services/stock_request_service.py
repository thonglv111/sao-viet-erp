"""Service — Yêu cầu kho: vòng đời, duyệt, và mức tồn (spec-kho-de-nghi §3–§4, §7–§8).

Ba luật nghiệp vụ sống ở đây (router chỉ điều phối):

1. **Kho không duyệt.** Duyệt là việc bộ phận yêu cầu; kho chỉ tiếp nhận yêu cầu đã duyệt.
2. **Đã duyệt là khoá.** Từ `approved` trở đi không sửa được nữa (BRD §1.5).
3. **Đèn tín hiệu thay cho con số.** Người không có `can_view_stock` chỉ nhận 1 trong 5 mức
   (`STOCK_LEVELS`), không bao giờ nhận số tồn thật.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .kho_giay import DON_VI_TO_KHO, chuan_kho, co_don_vi_goc, khoa_dong, khoa_ton_cua
from .thong_bao_man import bao
from ..models.document_sequence import (
    SEQ_DOC_TYPE_STOCK_REQUEST_IN,
    SEQ_DOC_TYPE_STOCK_REQUEST_OUT,
)
from ..models.stock_lot import (
    STOCK_ALERT_LEVELS,
    STOCK_CRITICAL,
    STOCK_OK,
    STOCK_OUT,
    STOCK_OVER,
)
from ..models.stock_request import (
    PRIORITIES,
    PRIORITY_NORMAL,
    REQ_APPROVED,
    REQ_CANCELLED,
    REQ_DONE,
    REQ_DRAFT,
    REQ_NHAP,
    REQ_PARTIAL,
    REQ_PENDING,
    REQ_PREPARING,
    REQ_RECEIVED,
    REQ_REJECTED,
    REQ_XUAT,
    REQUEST_EDITABLE,
    REQUEST_KINDS,
    StockRequest,
)
from ..realtime import hub
from ..repositories.notification_repo import NotificationRepository
from ..repositories.rbac_repo import DepartmentRepository, RoleRepository
from ..repositories.user_repo import UserRepository


class StockRequestError(Exception):
    """Lỗi nghiệp vụ yêu cầu kho — router dịch thành HTTP 400/403."""


class StockRequestConflict(StockRequestError):
    """Trùng việc đã có (vd đợt giao đã có yêu cầu nhập kho) — router trả 409."""


def stock_level(on_hand: float, threshold) -> str:
    """Quy tồn khả dụng về 1 trong 5 mức (spec §7).

    `threshold` là StockThreshold hoặc None. Chưa khai ngưỡng thì chỉ phân biệt được
    "hết" với "còn" — không bịa cảnh báo cho vật tư chưa ai đặt ngưỡng.
    """
    if on_hand <= 0:
        return STOCK_OUT
    if threshold is None:
        return STOCK_OK
    nguong_ton = float(threshold.nguong_ton or 0)
    toi_da = threshold.nguong_toi_da
    # Bỏ mức "cận tồn" (2026-07-29): chỉ còn Cần mua (≤ ngưỡng tồn) · Dư (> tối đa) · Đủ (giữa).
    if on_hand <= nguong_ton:
        return STOCK_CRITICAL
    if toi_da is not None and on_hand > float(toi_da):
        return STOCK_OVER
    return STOCK_OK


def needs_alert(level: str) -> bool:
    """Mức này có đáng đẩy nhắc cho người có quyền yêu cầu không (spec §8)."""
    return level in STOCK_ALERT_LEVELS


class StockRequestService:
    def __init__(self, requests, lots, thresholds, sequence, audit=None, hang=None) -> None:
        self.requests = requests
        self.lots = lots
        self.thresholds = thresholds
        self.sequence = sequence
        self.audit = audit
        # `VatLieuKhoService` — cửa duy nhất tra danh mục gốc + quy đổi đơn vị. Không có nó thì
        # không siết được (mặt hàng lạ, đơn vị không đổi được vẫn lọt), nên router LUÔN truyền.
        self.hang = hang

    # --- Tạo / sửa ---------------------------------------------------------

    # Cùng người, cùng nội dung trong khoảng này = một lần bấm "Gửi" bị gửi lại (máy chủ chậm, bấm
    # thêm; mạng tự thử lại). Trước đây ra HAI yêu cầu y hệt, kho cấp hàng hai lần.
    CHONG_GUI_LAI_GIAY = 30

    def _yeu_cau_trung(self, *, user, loai: str, lines: list[dict], header: dict) -> StockRequest | None:
        def so(x):
            return None if x in (None, "") else round(float(x), 3)

        def chu(x):
            return (x or "").strip() or None

        def dau_van(kho_id, ghi_chu, dong) -> tuple:
            return (kho_id, chu(ghi_chu), tuple(sorted((
                (khoa_dong(d["hang_loai"], int(d["hang_id"]), d.get("don_vi_goc"),
                           d.get("kho_rong"), d.get("kho_dai")),
                 (d.get("dvt") or "").strip(),
                 so(d["sl_de_nghi"]), d.get("lsx_id"), d.get("bai_ghep_id"),
                 so(d.get("don_gia")) if loai == "NHAP" else None,
                 so(d.get("don_gia_ban")) if loai == "NHAP" else None, chu(d.get("ghi_chu")))
                for d in dong
            ), key=repr)))

        can_tim = dau_van(header.get("kho_id"), header.get("ghi_chu"), lines)
        if self.CHONG_GUI_LAI_GIAY <= 0:
            return None
        tu_luc = datetime.now(timezone.utc) - timedelta(seconds=self.CHONG_GUI_LAI_GIAY)
        for req in self.requests.vua_tao_boi(nguoi_tao_id=user.id, loai=loai, tu_luc=tu_luc):
            co = dau_van(req.kho_id, req.ghi_chu, [
                {"hang_loai": ln.hang_loai, "hang_id": ln.hang_id, "dvt": ln.dvt,
                 "don_vi_goc": ln.don_vi_goc, "kho_rong": ln.kho_rong, "kho_dai": ln.kho_dai,
                 "sl_de_nghi": ln.sl_de_nghi, "lsx_id": ln.lsx_id, "bai_ghep_id": ln.bai_ghep_id,
                 "don_gia": ln.don_gia, "don_gia_ban": ln.don_gia_ban, "ghi_chu": ln.ghi_chu}
                for ln in req.lines
            ])
            if co == can_tim:
                return req
        return None

    def create(self, *, user, loai: str, lines: list[dict], ma: str | None = None,
               commit: bool = True, chong_gui_lai: bool = False, kho_to_bat_buoc: bool = False,
               **header) -> StockRequest:
        """`commit=False` = KHÔNG tự chốt giao dịch, chỉ `flush()` xuống DB.

        Dành cho người gọi đang ôm một giao dịch lớn hơn (`san_xuat/vat_tu_de_nghi.tao()` khoá công
        đoạn bằng `SELECT … FOR UPDATE` rồi mới ghi hai bảng SX; một `commit()` ở đây là nhả khoá
        giữa chừng). Khai TƯỜNG MINH thành tham số keyword, KHÔNG để lọt vào `**header` — `header`
        đi thẳng xuống repo và chỉ được chứa cột của `StockRequest`.

        Đẩy tin thì KHÔNG chạy khi `commit=False` — xem `thong_bao_yeu_cau_moi`, người gọi phải tự
        gọi nó SAU khi chốt giao dịch. Với `commit=True` (mọi cửa cũ) hành vi y như trước.

        `chong_gui_lai=True` (chỉ cửa tạo từ MÀN HÌNH): yêu cầu y hệt của cùng người trong
        `CHONG_GUI_LAI_GIAY` giây ⇒ trả lại yêu cầu đó, không tạo thêm. Luồng nội bộ (đề nghị vật tư
        của xưởng, giao hàng…) không bật — chúng tự quyết số yêu cầu cần sinh.
        """
        if loai not in REQUEST_KINDS:
            raise StockRequestError("Loại yêu cầu không hợp lệ (chỉ NHAP hoặc XUAT).")
        self._validate_lines(lines, kho_to_bat_buoc=kho_to_bat_buoc)
        if header.get("uu_tien") and header["uu_tien"] not in PRIORITIES:
            raise StockRequestError("Mức ưu tiên không hợp lệ.")
        header.setdefault("uu_tien", PRIORITY_NORMAL)
        # Bộ phận mặc định = bộ phận người tạo, để scope `department` và ô "Bộ phận" trên
        # bản in luôn có dữ liệu mà không bắt người dùng chọn lại.
        header.setdefault("bo_phan_id", user.department_id)
        # MỘT ĐỢT GIAO MUA HÀNG CHỈ NHẬP KHO MỘT LẦN (07/10/2026) — chặn ở máy chủ, không chỉ ẩn nút.
        # Yêu cầu cũ bị huỷ / từ chối thì nhập lại được. Kiểm TRƯỚC lớp chống gửi lại: form nhập từ
        # đợt bị khoá nên lần mở thứ hai (tab khác) gửi y hệt nội dung, lớp đó sẽ lặng lẽ trả yêu cầu
        # cũ (201) và người dùng tưởng vừa tạo mới — phải nói thẳng đợt đã có yêu cầu nào.
        dot_id = header.get("purchase_delivery_id")
        if dot_id:
            cu = self.requests.tim_theo_purchase_delivery(int(dot_id), khoa=True)
            if cu is not None:
                raise StockRequestConflict(f"Đợt giao này đã có yêu cầu nhập kho {cu.ma}.")
        if chong_gui_lai and not (ma or "").strip():
            self.requests.khoa_nguoi_tao(user.id)
            da_co = self._yeu_cau_trung(user=user, loai=loai, lines=lines, header=header)
            if da_co is not None:
                return da_co

        doc_type = (
            SEQ_DOC_TYPE_STOCK_REQUEST_IN if loai == REQ_NHAP
            else SEQ_DOC_TYPE_STOCK_REQUEST_OUT
        )
        # Số tự nhập (tuỳ chọn): chuẩn hoá HOA, chặn trùng. Bỏ trống → hệ thống tự sinh.
        ma_clean = (ma or "").strip().upper() or None
        if ma_clean is not None:
            if self.requests.get_by_ma(ma_clean) is not None:
                raise StockRequestError(f"Số yêu cầu '{ma_clean}' đã tồn tại.")
        else:
            ma_clean = self.sequence.generate_flat_code(doc_type)
        req = self.requests.create(
            ma=ma_clean, loai=loai, nguoi_tao_id=user.id, lines=lines, commit=commit, **header
        )
        # BỎ BƯỚC DUYỆT (chủ 06/08/2026): tạo yêu cầu là DUYỆT LUÔN — bộ phận xin là kho cấp ngay,
        # không còn "Chờ duyệt". `approved` cũng là trạng thái KHOÁ (BRD §1.5) nên yêu cầu vừa tạo
        # đã chốt, đúng ý "tạo xong khoá luôn". KHÔNG tái dùng self.approve(): nó chặn tự-duyệt
        # (approver == người tạo) và đòi trạng thái pending — ở đây người tạo CHÍNH là người duyệt,
        # nên set thẳng cho đúng ngữ nghĩa. Mỗi dòng duyệt nguyên số đã xin (sl_duyet = sl_de_nghi).
        for line in req.lines:
            line.sl_duyet = line.sl_de_nghi
        req.trang_thai = REQ_APPROVED
        req.nguoi_duyet_id = user.id
        req.duyet_luc = datetime.now(timezone.utc)
        req = self.requests.save(req, commit=commit)
        # `commit=True`: hàng đã nằm trong DB ⇒ đẩy tin ngay tại chỗ, y như trước.
        # `commit=False`: giao dịch còn đang mở ⇒ IM LẶNG. Người gọi tự gọi `thong_bao_yeu_cau_moi`
        # sau khi chốt (xem docstring hàm đó để biết vì sao không được bắn sớm).
        if commit:
            self.thong_bao_yeu_cau_moi(req)
        return req

    def thong_bao_yeu_cau_moi(self, req: StockRequest) -> None:
        """Báo kho có yêu cầu MỚI: toast real-time (badge nhảy, không bắt F5) + tin vào chuông thủ kho.

        Tách khỏi `create` để người gọi đang ôm một giao dịch lớn hơn (`create(commit=False)`) đẩy
        được tin ĐÚNG NHỊP — tức SAU `commit()` của chính họ. Bắn sớm là bắn vào khoảng trống: trình
        duyệt nhận SSE rồi refetch trên một CONNECTION KHÁC, connection đó chưa thấy hàng chưa
        commit nên trả về rỗng; SSE chỉ báo một lần nên badge bỏ nhịp luôn, không tự thử lại. Tệ hơn
        nữa là giao dịch ngoài đổ: tin đã đi rồi mà yêu cầu thì không bao giờ tồn tại.

        Gọi hàm này khi và chỉ khi giao dịch đã chốt và yêu cầu chắc chắn còn sống.
        """
        self._notify(req, "Yêu cầu mới — chờ kho cấp", targeted=False)
        self._notif_kho_moi(req)  # lưu vào chuông thủ kho

    def thong_bao_da_huy(self, req: StockRequest) -> None:
        """Yêu cầu bị huỷ TỪ NGOÀI luồng kho (mở lại / huỷ gia công ngoài…) → badge "chờ cấp" của
        thủ kho tụt NGAY, không đợi F5. Chỉ tín hiệu refetch (targeted=False): số giảm thì FE không
        toast. Thiếu nó thì badge đứng số cũ, và lần tạo lại kế tiếp không làm số TĂNG so với mốc cũ
        ⇒ mất luôn toast "có việc mới" (E2E 27/09/2026). Gọi SAU commit."""
        self._notify(req, "Yêu cầu đã bị hủy", targeted=False)

    def thong_bao_da_doi(self, req: StockRequest) -> None:
        """Giờ hẹn / ghi chú của yêu cầu vừa đổi TỪ NGOÀI luồng kho (bước gửi kho của Giao hàng,
        12/10/2026) ⇒ màn kho refetch NGAY, cột Cần lúc nhảy giờ mới. Chỉ tín hiệu (targeted=False):
        số chờ cấp không đổi nên FE không toast. Gọi SAU commit."""
        self._notify(req, "Yêu cầu đã đổi giờ hẹn", targeted=False)

    # --- ĐỒNG BỘ TỪ ĐỢT GIAO MUA HÀNG (20/10/2026) --------------------------------------------
    # Lưu đợt giao là tạo luôn yêu cầu NHẬP của đợt (`purchase_service.ghi_dot_giao`), nên sửa / xoá
    # đợt phải kéo yêu cầu theo. Cùng luật với đường của sản xuất: kho đã lập phiếu (kể cả nháp,
    # kể cả đã huỷ) thì thôi — số đã vào tay người soạn. Cả hai CHỈ `flush()`: người gọi đang ôm
    # giao dịch của đơn mua, tự commit rồi mới gọi `thong_bao_da_doi` / `thong_bao_da_huy`.

    def kho_da_lap_phieu(self, req: StockRequest) -> bool:
        return self.requests.co_voucher(req.id)

    def dong_bo_tu_dot_giao(self, req: StockRequest, lines: list[dict], *, ngay_can) -> StockRequest:
        self.requests.lock_for_update(req.id)
        if self.requests.co_voucher(req.id):
            raise StockRequestConflict(
                f"Kho đã lập phiếu cho yêu cầu nhập {req.ma}, không sửa được đợt giao nữa."
            )
        dang_co = {(ln.hang_loai, int(ln.hang_id))
                   for ln in (req.lines or []) if ln.hang_loai and ln.hang_id}
        self._validate_lines(lines, dang_co, kho_to_bat_buoc=True)
        self.requests.replace_lines(req, lines)
        # `sl_duyet` mặc định 0 ⇒ phải đặt lại, nếu không yêu cầu tự thành "Hoàn tất" (xem
        # `dong_bo_tu_san_xuat`). Kho đã tiếp nhận thì về lại "chờ cấp" để họ xem số mới.
        for ln in req.lines:
            ln.sl_duyet = ln.sl_de_nghi
        req.ngay_can = ngay_can
        req.trang_thai = REQ_APPROVED
        return self.requests.save(req, commit=False)

    def huy_tu_dot_giao(self, req: StockRequest) -> StockRequest:
        self.requests.lock_for_update(req.id)
        if self.requests.co_voucher(req.id):
            raise StockRequestConflict(
                f"Kho đã lập phiếu cho yêu cầu nhập {req.ma}, không xoá được đợt giao nữa."
            )
        req.trang_thai = REQ_CANCELLED
        req.ly_do_huy = "Đợt giao đã bị xoá ở đơn mua"
        return self.requests.save(req, commit=False)

    def create_dieu_chuyen(self, *, user, loai: str, kho_id: int, lines: list[dict],
                           dieu_chuyen: bool = True, kho_nguon_id: int | None = None,
                           xuat_voucher_id: int | None = None, ghi_chu: str | None = None,
                           doc_type: str | None = None, notify: bool = False) -> StockRequest:
        """Tạo yêu cầu cho ĐIỀU CHUYỂN KHO (mô hình 2 yêu cầu — spec-dieu-chuyen-kho §4).

        Nhận NHIỀU dòng (điều chuyển hàng loạt gộp vào 1 yêu cầu). Dùng cho CẢ HAI vế: vế XUẤT ở kho
        nguồn (nội bộ, `notify=False`) và vế NHẬP ở kho đích (yêu cầu điều chuyển thấy được,
        `notify=True`). Tạo là DUYỆT LUÔN (giống `create`): `sl_duyet = sl_de_nghi`, trạng thái
        `approved` để lập phiếu được ngay. `_validate_lines` vẫn chạy (mặt hàng có thật + đơn vị
        quy được về gốc + không trùng mặt hàng)."""
        if loai not in REQUEST_KINDS:
            raise StockRequestError("Loại yêu cầu không hợp lệ (chỉ NHAP hoặc XUAT).")
        self._validate_lines(lines)
        # Vế NHẬP đích (đầu mối "Phiếu điều chuyển") lấy số DC… — caller truyền `doc_type`. Vế XUẤT
        # nguồn (ẩn) giữ mã đề nghị xuất mặc định.
        doc_type = doc_type or (
            SEQ_DOC_TYPE_STOCK_REQUEST_IN if loai == REQ_NHAP
            else SEQ_DOC_TYPE_STOCK_REQUEST_OUT
        )
        req = self.requests.create(
            ma=self.sequence.generate_flat_code(doc_type), loai=loai,
            nguoi_tao_id=user.id, lines=lines,
            bo_phan_id=user.department_id, kho_id=kho_id, ghi_chu=ghi_chu,
            dieu_chuyen=dieu_chuyen, kho_nguon_id=kho_nguon_id, xuat_voucher_id=xuat_voucher_id,
        )
        for ln in req.lines:
            ln.sl_duyet = ln.sl_de_nghi
        req.trang_thai = REQ_APPROVED
        req.nguoi_duyet_id = user.id
        req.duyet_luc = datetime.now(timezone.utc)
        req = self.requests.save(req)
        # Vế NHẬP đích = yêu cầu điều chuyển THẤY ĐƯỢC → báo kho như yêu cầu mới. Vế XUẤT nguồn là
        # bút toán nội bộ (tự lập + ghi sổ ngay) → im lặng, khỏi spam "yêu cầu xuất mới chờ cấp".
        if notify:
            self._notify(req, "Yêu cầu điều chuyển mới — chờ nhập kho", targeted=False)
            self._notif_kho_moi(req)
        return req

    def update(self, req: StockRequest, *, lines: list[dict] | None = None,
               kho_to_bat_buoc: bool = False, **header) -> StockRequest:
        self._require_editable(req)
        if lines is not None:
            # Mặt hàng vốn đã có trên đề nghị thì giữ lại được kể cả khi danh mục đã ngừng nó.
            dang_co = {(ln.hang_loai, int(ln.hang_id))
                       for ln in (req.lines or []) if ln.hang_loai and ln.hang_id}
            self._validate_lines(lines, dang_co, kho_to_bat_buoc=kho_to_bat_buoc)
            self.requests.replace_lines(req, lines)
        self.requests.update_header(req, header)
        return self.requests.save(req)

    def _validate_lines(self, lines: list[dict], dang_co: set[tuple] | None = None, *,
                        kho_to_bat_buoc: bool = False) -> None:
        """SIẾT (chủ chốt 2026-08-08): mỗi dòng phải trỏ một mặt hàng CÓ THẬT trong danh mục gốc,
        và đơn vị phải đổi được về đơn vị gốc của chính mặt hàng đó.

        Không còn đường "gõ tên hàng mới rồi kho gắn mã sau" — đó là nguồn đẻ mã trùng/tên lệch,
        đúng thứ làm kho và mua hàng không nối được với nhau.

        GIẤY + VẬT TƯ: ghi `don_vi_goc` vào CHÍNH dict dòng — suy từ ĐVT (`quy_ve_goc`: đơn vị đã khai
        ở danh mục mà nhóm của nó chứa ĐVT dòng; chưa khai ⇒ lỗi) để repo ghi xuống dòng; người gọi
        gửi gì ở khoá này cũng bị đè.

        `kho_to_bat_buoc` (cửa người gõ trên màn kho): giấy đếm TỜ phải đủ khổ hai cạnh — tờ không
        khổ thì không biết lấy lô nào, không ghép được với bảng cân đối. Luồng nội bộ (điều chuyển lô
        cũ chưa có khổ, đề nghị của xưởng) không bật để không chặn hàng đã nằm sẵn trong kho.
        """
        if not lines:
            raise StockRequestError("Yêu cầu phải có ít nhất 1 dòng vật tư.")
        seen: set = set()
        for ln in lines:
            if float(ln.get("sl_de_nghi") or 0) <= 0:
                raise StockRequestError("Số lượng đề nghị phải lớn hơn 0.")
            loai, hid = ln.get("hang_loai"), ln.get("hang_id")
            if not loai or not hid:
                raise StockRequestError(
                    "Mỗi dòng phải chọn một mặt hàng trong danh mục Giấy / Vật tư khác."
                )
            # Khoá trùng gồm CẢ lệnh/bài (mg 0175): cùng một loại giấy xin cho HAI lệnh khác nhau
            # là hai dòng hợp lệ — gộp lại thì mất luôn thông tin "phần nào cho lệnh nào", mà đó
            # đúng là thứ bảng cân đối cần để trừ đã-cấp vào đúng chỗ.
            goc = self._kiem_hang_va_don_vi(loai, int(hid), ln.get("dvt"), ln["sl_de_nghi"],
                                            giu_duoc=(loai, int(hid)) in (dang_co or set()))
            ln["don_vi_goc"] = goc if co_don_vi_goc(loai) else ""
            if kho_to_bat_buoc and loai == "giay" and goc == DON_VI_TO_KHO:
                kr, kd = chuan_kho(ln.get("kho_rong"), ln.get("kho_dai"))
                if not (kr and kd):
                    raise StockRequestError(
                        "Giấy đếm theo tờ phải khai đủ khổ (rộng × dài, mm).")
            # Giấy: cùng mã khác khổ / khác đơn vị gốc là hai dòng hợp lệ.
            # Hàng trả về tách dòng theo LÔ GỐC (mg 0401) — cùng mặt hàng hai lô gốc là hai dòng.
            key = (khoa_dong(loai, int(hid), ln["don_vi_goc"],
                             ln.get("kho_rong"), ln.get("kho_dai")),
                   ln.get("lsx_id"), ln.get("bai_ghep_id"), ln.get("lo_goc_id"))
            if key in seen:
                raise StockRequestError(
                    "Một mặt hàng cho cùng một lệnh chỉ được xuất hiện 1 dòng — gộp số lượng lại."
                )
            seen.add(key)
            self._kiem_lenh(ln.get("lsx_id"), ln.get("bai_ghep_id"))

    def _kiem_lenh(self, lsx_id, bai_ghep_id) -> None:
        """Lệnh / bài ghép được gắn phải CÓ THẬT (mg 0175).

        Cả hai để trống là hợp lệ — xin lặt vặt không thuộc lệnh nào. Nhưng gắn một id KHÔNG tồn
        tại thì phải báo lỗi, tuyệt đối không im lặng bỏ: dòng đó sẽ mãi không khớp lệnh nào trong
        bảng cân đối, và triệu chứng duy nhất là "sao lệnh này cấp rồi mà vẫn báo thiếu".
        """
        co_lsx, co_bg = self.requests.lenh_ton_tai(lsx_id, bai_ghep_id)
        if not co_lsx:
            raise StockRequestError(f"Lệnh sản xuất #{lsx_id} không tồn tại — chọn lại.")
        if not co_bg:
            raise StockRequestError(f"Bài ghép #{bai_ghep_id} không tồn tại — chọn lại.")

    def _kiem_hang_va_don_vi(self, hang_loai: str, hang_id: int, dvt, so_luong,
                             *, giu_duoc: bool = False) -> str:
        """Mặt hàng còn dùng được + đơn vị quy được về gốc; trả MÃ đơn vị gốc của dòng (giấy: gốc của
        họ ĐVT — "to" hoặc đơn vị giá). Lỗi trả nguyên văn lý do của danh mục
        (vd "chưa chọn đơn vị tính", "không đổi được từ tờ về kg") để người khai biết sửa ở đâu.

        `giu_duoc` = dòng này vốn đã có trên đề nghị. Mặt hàng ngừng dùng sau khi đề nghị được lập
        thì vẫn phải sửa được đề nghị (đổi số lượng, bỏ bớt dòng khác) — chặn cứng là nhốt luôn
        cái đề nghị đó, không ai gỡ ra được.
        """
        if self.hang is None:
            raise StockRequestError("Thiếu danh mục mặt hàng — không kiểm được dòng đề nghị.")
        from .vat_lieu_kho_service import VatLieuKhoError

        try:
            obj = self.hang.get(hang_loai, hang_id)
            if not getattr(obj, "active", True) and not giu_duoc:
                raise StockRequestError(f"“{obj.ten}” đã ngừng dùng — chọn mặt hàng khác.")
            return (self.hang.quy_ve_goc(hang_loai, hang_id, dvt, so_luong)["don_vi_goc"] or "").lower()
        except VatLieuKhoError as e:
            raise StockRequestError(str(e)) from None

    def _require_editable(self, req: StockRequest) -> None:
        if req.trang_thai not in REQUEST_EDITABLE:
            raise StockRequestError(
                "Yêu cầu đã duyệt không sửa được. Hãy hủy và tạo yêu cầu mới."
            )

    # --- ĐỒNG BỘ TỪ SẢN XUẤT (spec-de-nghi-cap-vat-tu-cong-doan §5.2–§5.3) -------------------
    # KHÔNG tái dùng `update()`: nó chạy `_require_editable`, mà yêu cầu do sản xuất tạo đã ở
    # `approved` ngay từ đầu (create tự duyệt). Ba hàm dưới là đường RIÊNG, chỉ tầng
    # `services/san_xuat/vat_tu_de_nghi.py` được gọi — mọi cửa khác vẫn giữ luật "đã duyệt là khoá".

    def dong_bo_tu_san_xuat(self, req_id: int, lines: list[dict], *, user, ngay_can,
                            can_luc: datetime | None = None, ghi_chu: str | None = None,
                            cho_phep_khoi_phuc: bool = False) -> StockRequest:
        """Thay TOÀN BỘ dòng bằng dữ liệu mới, giữ nguyên mã và id.

        Khoá + đọc lại TRONG transaction, ngay trước khi ghi: kiểm ở router rồi mới vào service là
        mở đúng khe cho kho bấm "lập phiếu" ở giữa hai thời điểm đó.

        `user` giữ chỗ cho móc audit sau này (Task 6 sẽ truyền theo chữ ký đã chốt) — chưa dùng
        trong thân hàm, không phải tham số sót lại.
        """
        self.requests.lock_for_update(req_id)
        req = self.requests.get_with_lines(req_id)
        if req is None:
            raise StockRequestError("Không tìm thấy yêu cầu.")
        if self.requests.co_voucher(req.id):
            raise StockRequestError("Kho đã lập phiếu cho yêu cầu này — không sửa được nữa.")
        if req.trang_thai == REQ_CANCELLED and not cho_phep_khoi_phuc:
            # Yêu cầu này do KHO hủy (sản xuất chỉ hủy khi chính nó đưa mọi dòng về 0, và lúc đó
            # `sua()` gọi qua `khoi_phuc_tu_san_xuat`). `cancel_by_kho` đã ghi thành văn rằng hủy
            # là KẾT THÚC, không trả về "chờ cấp" — lật nó ở đây còn xoá luôn `ly_do_huy`, ô duy
            # nhất nói vì sao kho từ chối.
            raise StockRequestError(
                "Kho đã hủy yêu cầu này — không sửa lại được. Hãy tạo đề nghị bổ sung."
            )
        # Nương tay với mặt hàng vốn đã có trên đề nghị nhưng danh mục đã ngừng dùng — cùng luật
        # `update()` áp cho cửa kho thường.
        dang_co = {(ln.hang_loai, int(ln.hang_id))
                   for ln in (req.lines or []) if ln.hang_loai and ln.hang_id}
        self._validate_lines(lines, dang_co)
        self.requests.replace_lines(req, lines)
        # Đặt lại `sl_duyet` cho MỌI dòng mới: bỏ bước này là `sl_duyet = 0` (giá trị mặc định của
        # cột), và `refresh_fulfillment` sẽ thấy `sl_da_ung (=0) >= sl_duyet (=0)` đúng ngay lập
        # tức rồi đóng yêu cầu thành "Hoàn tất" dù kho chưa cấp gì.
        for ln in req.lines:
            ln.sl_duyet = ln.sl_de_nghi
        req.ngay_can = ngay_can
        # Giờ cần (mg 0384) + ghi chú tổ gõ: chỉ ghi khi tổ có gửi — không có thì giữ nguyên cái cũ.
        if can_luc is not None:
            req.can_luc = can_luc
        if ghi_chu:
            req.ghi_chu = ghi_chu
        if req.trang_thai == REQ_CANCELLED:
            req.ly_do_huy = None      # đang khôi phục đúng cái sản xuất đã hủy (đã qua chốt trên)
        # `co_voucher` ở trên đã bảo đảm chưa có phiếu nào nên `sl_da_ung` toàn 0 — set thẳng
        # `approved` mà không cần tính lại. Đúng cho CẢ BA ca: yêu cầu đang `approved` được sửa số,
        # yêu cầu đang `cancelled` do CHÍNH sản xuất hủy được khôi phục (`cho_phep_khoi_phuc`), và
        # yêu cầu đang `received`/`preparing` (kho đã đọc/đã nhận) — nội dung vừa đổi nên trạng
        # thái "đã xử lý" đó thành cũ, đẩy về `approved` là CỐ Ý để kho biết cần xem lại; `_notify`
        # ngay dưới đây báo lại cho đúng thủ kho đang cầm yêu cầu này.
        req.trang_thai = REQ_APPROVED
        req = self.requests.save(req)
        # Hộp yêu cầu kho phải thấy con số mới NGAY — số cũ đang nằm trên màn của thủ kho.
        self._notify(req, "Yêu cầu vừa được cập nhật", targeted=False)
        return req

    def huy_tu_san_xuat(self, req_id: int, *, user) -> StockRequest:
        """Tổ xác nhận không cần cấp gì: xoá dòng, chuyển `cancelled`, GIỮ mã và link.

        `user` giữ chỗ cho móc audit sau này (Task 6 sẽ truyền theo chữ ký đã chốt) — chưa dùng
        trong thân hàm, không phải tham số sót lại.
        """
        self.requests.lock_for_update(req_id)
        req = self.requests.get_with_lines(req_id)
        if req is None:
            raise StockRequestError("Không tìm thấy yêu cầu.")
        if req.trang_thai == REQ_CANCELLED:
            # Lũy đẳng: tổ sửa lần hai mà vẫn để 0 thì trạng thái đích đã đạt rồi. Ném lỗi ở đây là
            # biến "sửa lý do trên một đề nghị đã về 0" thành ngõ cụt — rollback luôn cả phần ghi
            # bảng SX mà lần sửa đó thực sự muốn ghi.
            return req
        if req.trang_thai == REQ_DONE:
            raise StockRequestError("Yêu cầu đã cấp xong — không hủy được.")
        if self.requests.co_voucher(req.id):
            raise StockRequestError("Kho đã lập phiếu cho yêu cầu này — không hủy được nữa.")
        req.lines.clear()
        req.trang_thai = REQ_CANCELLED
        req.ly_do_huy = "Tổ xác nhận không cần cấp"
        req = self.requests.save(req)
        self._notify(req, "Tổ xác nhận không cần cấp", targeted=False)
        return req

    def khoi_phuc_tu_san_xuat(self, req_id: int, lines: list[dict], *, user, ngay_can,
                              can_luc: datetime | None = None,
                              ghi_chu: str | None = None) -> StockRequest:
        """Tổ nhập lại số dương sau khi đã về 0 — dựng lại dòng trên CHÍNH yêu cầu đó.

        Không đẻ mã mới: một lần đề nghị của tổ là một chứng từ, tổ đổi ý ba lần trước khi kho
        động tay không phải là ba chứng từ. Chỉ hồi sinh yêu cầu mà CHÍNH sản xuất đã hủy — gọi
        `cho_phep_khoi_phuc=True` để `dong_bo_tu_san_xuat` bỏ qua chốt chặn "kho đã hủy".
        """
        return self.dong_bo_tu_san_xuat(req_id, lines, user=user, ngay_can=ngay_can,
                                        can_luc=can_luc, ghi_chu=ghi_chu, cho_phep_khoi_phuc=True)

    # --- Vòng đời ----------------------------------------------------------

    def submit(self, req: StockRequest) -> StockRequest:
        if req.trang_thai != REQ_DRAFT:
            raise StockRequestError("Chỉ yêu cầu ở trạng thái Nháp mới trình duyệt được.")
        req.trang_thai = REQ_PENDING
        req = self.requests.save(req)
        self._notify(req, "Yêu cầu chờ duyệt")
        return req

    def approve(self, req: StockRequest, *, approver, approved_qty: dict[int, float] | None = None) -> StockRequest:
        """Duyệt yêu cầu. `approved_qty` map line_id → SL duyệt; thiếu thì duyệt nguyên SL yêu cầu.

        Người duyệt được cắt bớt số lượng (duyệt 8 khi yêu cầu 10) nhưng KHÔNG được duyệt
        nhiều hơn yêu cầu — muốn thêm thì bộ phận phải yêu cầu lại, để dấu vết luôn khớp
        với cái đã xin.
        """
        if req.trang_thai != REQ_PENDING:
            raise StockRequestError("Chỉ yêu cầu đang Chờ duyệt mới duyệt được.")
        if approver.id == req.nguoi_tao_id:
            raise StockRequestError("Không thể tự duyệt yêu cầu của chính mình.")

        for line in req.lines:
            qty = float(line.sl_de_nghi)
            if approved_qty and line.id in approved_qty:
                qty = float(approved_qty[line.id])
            if qty < 0:
                raise StockRequestError("Số lượng duyệt không được âm.")
            if qty > float(line.sl_de_nghi):
                raise StockRequestError(
                    "Không duyệt vượt số lượng yêu cầu — bộ phận phải yêu cầu lại."
                )
            line.sl_duyet = qty

        if all(float(ln.sl_duyet) == 0 for ln in req.lines):
            raise StockRequestError("Duyệt 0 cho tất cả các dòng — hãy Từ chối thay vì duyệt.")

        req.trang_thai = REQ_APPROVED
        req.nguoi_duyet_id = approver.id
        req.duyet_luc = datetime.now(timezone.utc)
        req = self.requests.save(req)
        self._notify(req, "Yêu cầu đã được duyệt")
        return req

    def reject(self, req: StockRequest, *, approver, ly_do: str) -> StockRequest:
        if req.trang_thai != REQ_PENDING:
            raise StockRequestError("Chỉ yêu cầu đang Chờ duyệt mới từ chối được.")
        if not (ly_do or "").strip():
            raise StockRequestError("Phải nhập lý do từ chối.")
        req.trang_thai = REQ_REJECTED
        req.nguoi_duyet_id = approver.id
        req.duyet_luc = datetime.now(timezone.utc)
        req.ly_do_tu_choi = ly_do.strip()
        req = self.requests.save(req)
        self._notify(req, "Yêu cầu bị từ chối")
        self._notif_nguoi_tao(req, loai="kho_huy", tieu_de="Yêu cầu bị từ chối")
        return req

    def cancel(self, req: StockRequest) -> StockRequest:
        if req.trang_thai not in REQUEST_EDITABLE:
            raise StockRequestError("Chỉ hủy được yêu cầu khi còn Nháp hoặc Chờ duyệt.")
        req.trang_thai = REQ_CANCELLED
        return self.requests.save(req)

    def mark_received(self, req: StockRequest) -> StockRequest:
        """Kho bấm 'Tiếp nhận' — chỉ đổi trạng thái, chưa đụng tồn."""
        if req.trang_thai != REQ_APPROVED:
            raise StockRequestError("Chỉ tiếp nhận được yêu cầu đã duyệt.")
        req.trang_thai = REQ_RECEIVED
        req = self.requests.save(req)
        self._notify(req, "Kho đã tiếp nhận yêu cầu")
        return req

    def mark_preparing(self, req: StockRequest) -> StockRequest:
        if req.trang_thai not in (REQ_APPROVED, REQ_RECEIVED):
            raise StockRequestError("Yêu cầu không ở trạng thái chuẩn bị được.")
        req.trang_thai = REQ_PREPARING
        req = self.requests.save(req)
        self._notify(req, "Kho đang chuẩn bị hàng")
        return req

    def mark_in_progress(self, req: StockRequest) -> StockRequest:
        """LẬP PHIẾU (nháp) cho yêu cầu → rời 'Cần cấp' sang 'Đang cấp' (Đang chuẩn bị). Idempotent:
        chỉ đẩy khi còn approved/received; partial/done/preparing giữ nguyên. Gọi từ voucher.create."""
        # Vế XUẤT nguồn của điều chuyển: phiếu tự lập + ghi sổ ngay trong 1 nhịp → bỏ qua bước
        # 'đang chuẩn bị' và toast của nó (bút toán nội bộ, không phải việc kho phải theo dõi).
        if getattr(req, "dieu_chuyen", False) and req.loai == REQ_XUAT:
            return req
        if req.trang_thai in (REQ_APPROVED, REQ_RECEIVED):
            req.trang_thai = REQ_PREPARING
            req = self.requests.save(req)
            self._notify(req, "Kho đã lập phiếu — đang chuẩn bị")
        return req

    def cancel_by_kho(self, req: StockRequest, ly_do: str) -> StockRequest:
        """Kho HỦY yêu cầu (hủy phiếu nháp, HOẶC quyết định không lập phiếu) — yêu cầu KẾT THÚC ở
        'Đã hủy' kèm lý do (KHÔNG trả về 'Chờ cấp', không cấp lại). Số đã cấp bởi phiếu ĐÃ GHI SỔ
        trước đó (nếu có) vẫn nằm ở kho — phiếu ghi sổ không đảo; yêu cầu vẫn đóng."""
        if req.trang_thai in (REQ_DONE, REQ_CANCELLED):
            raise StockRequestError("Yêu cầu đã kết thúc — không hủy được.")
        req.trang_thai = REQ_CANCELLED
        req.ly_do_huy = ly_do
        req = self.requests.save(req)  # save() tự cập nhật updated_at = mốc phản hồi cho badge người tạo
        self._notify(req, "Yêu cầu đã bị hủy")
        self._notif_nguoi_tao(req, loai="kho_huy", tieu_de="Yêu cầu đã bị hủy")
        return req

    # --- Tồn & đèn tín hiệu -------------------------------------------------

    def levels_for(self, hangs: list[tuple[str, int]], kho_id: int) -> dict[tuple[str, int], str]:
        """Mức tồn (đèn) của từng mã hàng — an toàn để trả cho MỌI vai, kể cả người
        không có `can_view_stock`, vì không kèm con số nào."""
        return self.levels_and_on_hand(hangs, kho_id)[0]

    def levels_and_on_hand(
        self, hangs: list[tuple[str, int]], kho_id: int
    ) -> tuple[dict[tuple[str, int], str], dict[tuple[str, int], float]]:
        """Trả CẢ mức tồn lẫn tồn khả dụng trong MỘT lượt (2 query) — router cần cả hai, tránh
        gọi `on_hand_map` hai lần. Khoá là cặp `(hang_loai, hang_id)` hoặc khoá tồn 5 phần tử (giấy)."""
        hangs = [tuple(h) for h in hangs]
        on_hand = self.lots.on_hand_map(hangs, kho_id)
        th = self.thresholds.map_for(hangs, kho_id)
        levels = {h: stock_level(on_hand.get(h, 0.0), th.get(h)) for h in hangs}
        return levels, on_hand

    def goi_y_kho_xuat(self, req) -> int | None:
        """Gợi ý "Kho (xuất từ)" khi lập phiếu XUẤT: chọn kho có NHIỀU hàng nhất theo THỨ TỰ
        dòng của yêu cầu — kho nào tồn mặt hàng ĐẦU tiên nhiều nhất thì chọn; hoà thì xét mặt
        hàng thứ 2, thứ 3… (so sánh từ điển). Không kho nào còn lô của các mặt hàng này → None
        (giữ nguyên kho đang chọn, không ép bừa). Chỉ đọc — không đụng tồn."""
        hangs = [khoa_ton_cua(l) for l in (req.lines or []) if l.hang_loai and l.hang_id]
        if not hangs:
            return None
        by_kho = self.lots.on_hand_by_kho(hangs)
        kho_ids = {k for per in by_kho.values() for k in per}
        if not kho_ids:
            return None

        def vector(kho_id: int) -> tuple[float, ...]:
            return tuple(by_kho.get(h, {}).get(kho_id, 0.0) for h in hangs)

        # Vector tồn theo đúng thứ tự dòng: lớn hơn (so từ điển) = ưu tiên. Hoà tất cả → kho_id
        # nhỏ nhất cho ổn định (−k để max chọn số nhỏ). Toàn 0 ⇒ coi như không gợi ý được.
        best = max(kho_ids, key=lambda k: (vector(k), -k))
        if not any(v > 0 for v in vector(best)):
            return None
        return best

    def suggest_quantity(self, hang: tuple[str, int], department_id: int | None) -> float | None:
        """Gợi ý số lượng = trung bình 3 lần đề nghị gần nhất cùng mặt hàng + cùng bộ phận.

        Chưa có bảng định mức nên đây là nguồn rule-based duy nhất lấy được từ data sẵn có
        (spec §8). Chưa đủ lịch sử thì trả None — thà không gợi ý còn hơn gợi ý bừa.
        """
        rows, _ = self.requests.list(bo_phan_id=department_id, size=200)
        qtys = [
            float(ln.sl_de_nghi)
            for r in rows for ln in r.lines
            if (ln.hang_loai, ln.hang_id) == tuple(hang)
        ][:3]
        if not qtys:
            return None
        return round(sum(qtys) / len(qtys), 2)

    # --- Đẩy realtime -------------------------------------------------------

    def _notify(self, req: StockRequest, message: str, *, targeted: bool = True) -> None:
        """Đẩy real-time (badge nhảy + toast ngay). Kèm `loai` để FE toast đúng chiều nhập/xuất.

        `targeted=False` (dùng lúc TẠO): CHỈ broadcast — mọi người có quyền kho nhận ĐÚNG 1 toast
        "có việc mới"; người tạo (cũng là kho) không nhận thêm toast đích danh → tránh 2 toast trùng.
        `targeted=True` (duyệt/từ chối/hủy/cấp…): thêm tin ĐÍCH DANH cho người tạo + người duyệt.
        Các bước này KHÔNG làm tăng số 'chờ cấp' nên broadcast không toast lại → vẫn 1 toast."""
        # Yêu cầu tự lập lúc phát hành: người bấm phát hành chỉ đứng tên (tạo lẫn duyệt), không chờ
        # kho trả lời — tổ nghe tin qua bàn tổ (`phat_su_kien_kho`) và chuông tổ (`_notif_nguoi_tao`).
        if targeted and self._to_tu_lap(req) is None:
            event = {
                "type": "stock_request",
                "request_id": req.id,
                "ma": req.ma,
                "trang_thai": req.trang_thai,
                "loai": req.loai,
                "message": message,
            }
            for uid in {req.nguoi_tao_id, req.nguoi_duyet_id}:
                if uid:
                    hub.publish(uid, event)
        # Tín hiệu 'danh sách chờ đổi' + chiều → FE refetch số đếm; toast "việc mới" khi số TĂNG.
        # ĐẨY THEO PHẠM VI (không broadcast toàn hệ): chỉ tới người XỬ LÝ kho mà PHÒNG của yêu
        # cầu nằm trong scope của họ (all → mọi phòng; department → khớp phòng; own → người tạo).
        # ⇒ "phòng nào thấy phòng đó"; kho trung tâm scope=all vẫn nhận mọi phòng.
        # Kèm TÊN người tạo + PHÒNG BAN để toast "việc mới" nói rõ đến từ ai (thủ kho biết ngay
        # nguồn yêu cầu, không phải mở màn dò).
        db = self.requests.db
        creator = UserRepository(db).get_by_id(req.nguoi_tao_id) if req.nguoi_tao_id else None
        dept = DepartmentRepository(db).get_by_id(req.bo_phan_id) if req.bo_phan_id else None
        signal = {
            "type": "stock_request_pending_changed",
            "code": req.ma, "loai": req.loai, "nguoi_tao_id": req.nguoi_tao_id,
            "nguoi_tao_ten": getattr(creator, "name", None),
            "bo_phan_ten": getattr(dept, "name", None),
        }
        for uid in RoleRepository(db).kho_notify_user_ids(
            bo_phan_id=req.bo_phan_id, creator_id=req.nguoi_tao_id,
        ):
            hub.publish(uid, signal)
        # Yêu cầu nhập TỪ ĐỢT GIAO của đơn mua: màn Mua hàng / Kế toán bày nấc kho của đợt (Chờ gửi
        # kho → Kho chưa nhập → Đã nhập kho, 11/10/2026) ⇒ kho đổi trạng thái là hai màn đó phải
        # nhảy ngay, không đợi người mua hàng tải lại.
        if getattr(req, "purchase_delivery_id", None):
            from ..doi_tuong_nhan import MAN_KHVT, MAN_MUA_KE_TOAN, hop

            hub.gui(
                {"type": "purchase_changed", "code": req.ma},
                quyen=hop(MAN_MUA_KE_TOAN, MAN_KHVT),
            )

    # --- Thông báo lưu vào chuông (trung tâm thông báo) — song song với toast SSE ---------------
    def _notif_kho_moi(self, req: StockRequest) -> None:
        """Lưu thông báo 'yêu cầu mới chờ cấp' cho THỦ KHO trong phạm vi (trừ người tạo) + đẩy SSE
        để badge chuông nhảy ngay. Bấm → mở Hộp yêu cầu tại đúng yêu cầu (link_loai='kho_inbox').

        `add_many` TỰ COMMIT trên CÙNG session người gọi, nên hàm này CHỈ được chạy khi giao dịch
        nghiệp vụ đã chốt — nếu không, commit của nó nhả luôn khoá `SELECT … FOR UPDATE` mà người
        gọi đang giữ. Đó là lý do `create(commit=False)` không gọi tới đây; cửa duy nhất đi vào là
        `thong_bao_yeu_cau_moi`, và nó chỉ được gọi sau `commit()`."""
        db = self.requests.db
        creator = UserRepository(db).get_by_id(req.nguoi_tao_id) if req.nguoi_tao_id else None
        dept = DepartmentRepository(db).get_by_id(req.bo_phan_id) if req.bo_phan_id else None
        who = " · ".join(x for x in [getattr(creator, "name", None), getattr(dept, "name", None)] if x)
        dir_ = "xuất" if req.loai == REQ_XUAT else "nhập"
        uids = [
            u for u in RoleRepository(db).kho_notify_user_ids(
                bo_phan_id=req.bo_phan_id, creator_id=req.nguoi_tao_id,
            ) if u != req.nguoi_tao_id
        ]
        if not uids:
            return
        # Chấm đỏ mục Kho cho đúng những người xử lý nhận chuông (commit cùng lượt chuông bên dưới).
        bao(db, kenh="kho", loai="kho_yeu_cau_moi", actor_id=req.nguoi_tao_id, nguoi_nhan=uids,
            ma=req.ma, commit=False)
        NotificationRepository(db).add_many(
            uids, loai="kho_moi",
            tieu_de=f"Yêu cầu {dir_} mới chờ cấp",
            noi_dung=f"{req.ma}{' — ' + who if who else ''}",
            link_loai="kho_inbox", link_id=req.id,
        )
        for uid in uids:
            hub.publish(uid, {"type": "notification_new"})

    def _to_tu_lap(self, req: StockRequest) -> int | None:
        """Tổ của bước nếu yêu cầu là lần đề nghị TỰ LẬP lúc phát hành lệnh, không thì None."""
        from ..models.san_xuat import SanXuatCongViec
        from ..models.san_xuat_vat_tu import SanXuatVatTuDeNghi

        if req.id is None:
            return None
        return self.requests.db.query(SanXuatCongViec.department_id).join(
            SanXuatVatTuDeNghi, SanXuatVatTuDeNghi.cong_viec_id == SanXuatCongViec.id,
        ).filter(SanXuatVatTuDeNghi.stock_request_id == req.id,
                 SanXuatVatTuDeNghi.tu_lap.is_(True)).scalar()

    def _notif_nguoi_tao(self, req: StockRequest, *, loai: str, tieu_de: str) -> None:
        """Lưu thông báo phản hồi kho cho NGƯỜI TẠO (hoàn tất/hủy/từ chối) + đẩy SSE. Bấm → mở màn
        Yêu cầu tại đúng yêu cầu (link_loai='kho_mine').

        Yêu cầu tự lập lúc phát hành thì người đợi là TỔ của bước, không phải người bấm phát hành:
        chấm vào kênh của tổ (spec 2026-10-18 §6)."""
        to_id = self._to_tu_lap(req)
        if to_id is not None:
            from .thong_bao_man import kenh_to

            # Tự commit như nhánh người tạo (`NotificationRepository.add`): caller đã `save()` xong,
            # sau đây không còn ai commit nữa.
            bao(self.requests.db, kenh=kenh_to(to_id), loai="kho_phan_hoi", actor_id=None,
                ma=req.ma, commit=True)
            return
        if not req.nguoi_tao_id:
            return
        # Chấm đỏ mục Kho của người tạo (phản hồi kho) — đi chung commit của chuông bên dưới.
        bao(self.requests.db, kenh="kho", loai="kho_phan_hoi", actor_id=None,
            nguoi_nhan=req.nguoi_tao_id, ma=req.ma, commit=False)
        NotificationRepository(self.requests.db).add(
            user_id=req.nguoi_tao_id, loai=loai,
            tieu_de=tieu_de, noi_dung=req.ma,
            link_loai="kho_mine", link_id=req.id,
        )
        hub.publish(req.nguoi_tao_id, {"type": "notification_new"})

    def notify_low_stock(self, *, user_ids: list[int], material_name: str,
                         level: str, suggest: float | None) -> None:
        """Đẩy thẻ nhắc 'vật tư cần bổ sung' cho người có quyền yêu cầu (spec §8).

        Cố tình KHÔNG kèm số tồn — người yêu cầu chỉ cần biết "cần bổ sung" và "nên xin bao
        nhiêu"; số tồn thật vẫn nằm trong kho.
        """
        if not needs_alert(level):
            return
        event = {
            "type": "stock_alert",
            "material": material_name,
            "level": level,
            "suggest": suggest,
            "message": f"Vật tư {material_name} cần bổ sung",
        }
        for uid in user_ids:
            hub.publish(uid, event)

    # --- Đồng bộ trạng thái theo tiến độ ứng phiếu ---------------------------

    @staticmethod
    def muc_tieu_hieu_luc(ln) -> float:
        """Mục tiêu HIỆU LỰC của một dòng: kho đã chốt thực xuất thì lấy số chốt, chưa thì `sl_duyet`.

        NULL ≠ 0: NULL là "kho chưa điều chỉnh lần nào", 0 là "chốt rằng không xuất gì".
        """
        chot = ln.sl_chot_thuc_xuat
        return float(chot) if chot is not None else float(ln.sl_duyet)

    @staticmethod
    def con_lai(ln) -> float:
        return max(StockRequestService.muc_tieu_hieu_luc(ln) - float(ln.sl_da_ung), 0.0)

    def refresh_fulfillment(self, req: StockRequest) -> StockRequest:
        """Tính lại trạng thái sau khi 1 phiếu ghi sổ: ứng đủ hết → Hoàn tất, còn dở →
        Đã cấp một phần. Gọi từ `stock_voucher_service` sau khi cộng `sl_da_ung`."""
        if not req.lines:
            return req
        truoc = req.trang_thai
        done = all(float(ln.sl_da_ung) >= self.muc_tieu_hieu_luc(ln) for ln in req.lines)
        any_issued = any(float(ln.sl_da_ung) > 0 for ln in req.lines)
        if done:
            req.trang_thai = REQ_DONE
        elif any_issued:
            req.trang_thai = REQ_PARTIAL
        req = self.requests.save(req)
        # Vế XUẤT nguồn của điều chuyển: chốt trạng thái (Hoàn tất) nhưng KHÔNG đẩy toast/chuông —
        # người ấn điều chuyển không cần thông báo "yêu cầu xuất đã hoàn tất" cho bút toán nội bộ.
        if getattr(req, "dieu_chuyen", False) and req.loai == REQ_XUAT:
            return req
        self._notify(req, "Hoàn tất yêu cầu" if done else "Kho đã cấp một phần")
        # Chỉ reo chuông ở lượt CHUYỂN sang hoàn tất — điều chỉnh xuất (100→70) trên yêu cầu ĐÃ
        # `done` từ trước thì `done` vẫn đúng nhưng trạng thái không đổi, không reo lại.
        if done and truoc != REQ_DONE:
            self._notif_nguoi_tao(req, loai="kho_hoan_tat", tieu_de="Yêu cầu đã hoàn tất")
        return req
