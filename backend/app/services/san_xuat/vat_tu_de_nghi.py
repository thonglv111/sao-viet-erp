"""Tổ trưởng đề nghị cấp vật tư cho công đoạn của mình (spec-de-nghi-cap-vat-tu-cong-doan §5).

Ranh giới an ninh THỰC nằm ở đây, không ở router: router chỉ gác "có quyền Kho ở một tổ nào đó",
còn "đúng tổ nào" thì chỉ tầng này biết — hỏi quyền Kho trên tổ của công đoạn (`thuc_thi._gate`).

BA thang đơn vị chạy song song trong `tao()` — xem docstring của hàm đó.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ...models.san_xuat_vat_tu import (
    DN_BO_SUNG, DN_LAN_DAU, SanXuatVatTuDeNghi, SanXuatVatTuDeNghiDong,
)
from ...models.stock_request import REQ_CANCELLED, REQ_XUAT
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.employee_repo import EmployeeRepository
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from ...repositories.san_xuat_vat_tu_repo import SanXuatVatTuRepository
from ...repositories.stock_request_repo import StockRequestRepository
from ...doi_tuong_nhan import kem_ban_to
from ...realtime import hub
from ..ke_hoach_vat_tu_service import KeHoachVatTuError
from ..kho_giay import DON_VI_TO_KHO, co_don_vi_goc, don_vi_goc_to, khoa_dong
from ..quyen_to import VIEC_KHO
from .thuc_thi import _gate

_EPS = 0.0005      # cùng dung sai làm tròn với `san_luong.tao_batch`
# Việt Nam không có giờ mùa hè (DST) → offset cố định là đủ, không cần `ZoneInfo`. Cùng quy ước với
# `stock_voucher_service.py:436`.
_VN_TZ = timezone(timedelta(hours=7))


class VatTuDeNghiError(Exception):
    """Lỗi NGHIỆP VỤ (400) — khác `PermissionError` (403)."""


def _ngay_vn(can_luc: datetime) -> date:
    """Ngày mà `can_luc` rơi vào, theo lịch mà NGƯỜI DÙNG hai đầu cùng nhìn thấy.

    `can_luc` NAIVE = giờ nhà máy (wall-clock), KHÔNG phải UTC. Nó đi ra từ ô `datetime-local`
    ở màn Thực hiện SX, và cả phân hệ sản xuất ghi/đọc naive theo quy ước wall-clock — nói rõ
    ở `xep_lich_service._naive`: "bỏ tzinfo để serialize dạng WALL-CLOCK (giờ nhà máy) — FE
    `new Date(iso)` KHÔNG dịch múi (tránh lệch +7h)". Bản trước coi naive = UTC rồi +7h: tổ
    trưởng gõ 31/08 17:56 mà kho lưu `ngay_can = 01/09` — lùi hạn của thủ kho đi một ngày,
    đúng cái ca chiều mà `can_luc` sinh ra để diễn đạt. Lọc theo ngày cũng trượt luôn.

    AWARE (client gửi ISO kèm offset) thì quy về giờ VN rồi mới lấy ngày — `.date()` trên một
    datetime aware lấy ngày theo múi ĐÃ GẮN, để nguyên là ra ngày UTC.
    """
    if can_luc.tzinfo is None:
        return can_luc.date()
    return can_luc.astimezone(_VN_TZ).date()


def _can_luc_luu(can_luc: datetime) -> datetime:
    """Khuôn LƯU của `can_luc`: wall-clock giờ nhà máy, gắn NHÃN UTC — đúng khuôn `_aware()` mà cả
    phân hệ sản xuất đang dùng cho `start_at`/`bat_dau`/`ket_thuc`.

    Cột là `DateTime(timezone=True)`. Gán thẳng một datetime NAIVE vào đó chạy êm trên SQLite
    (naive vào, naive ra) nhưng trên Postgres `timestamptz` thì đo thật: ghi 31/08 17:56 naive,
    đọc lại ra `2026-08-31T17:56:00+00:00`, FE `new Date(...)` ở VN hiện 00:56 ngày 01/09 — lệch
    +7h, và lệch NGƯỢC hướng với `ngay_can` mà `_ngay_vn` vừa tính ra (31/08). Gắn nhãn ngay lúc
    ghi thì `can_luc_hien_thi()` gỡ nhãn ra là về lại đúng con số tổ trưởng gõ.

    Client gửi AWARE (ISO kèm offset) thì quy về giờ VN TRƯỚC rồi mới gỡ nhãn — cùng đúng một
    phép mà `_ngay_vn` làm để lấy ngày, nếu không thì giờ lưu và ngày lưu nói hai chuyện khác nhau.
    """
    if can_luc.tzinfo is not None:
        can_luc = can_luc.astimezone(_VN_TZ).replace(tzinfo=None)
    return can_luc.replace(tzinfo=timezone.utc)


def can_luc_hien_thi(dt: datetime | None) -> datetime | None:
    """Khuôn TRẢ RA của `can_luc` — bỏ tzinfo để serialize dạng wall-clock, giống
    `xep_lich_service._naive`. FE (`ngayGio`, `fmtGioCan`, `isOverdue`) đọc naive = giờ nhà máy;
    để nguyên `+00:00` là nó dịch múi thêm +7h. CHỈ cho ĐẦU RA, không cho tính toán."""
    return dt.replace(tzinfo=None) if dt is not None else None


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _ve_goc_dong(kh_svc, k, k_row, dvt, sl):
    """Quy số tổ khai về đơn vị gốc. Trả `(sl_goc, dvt_goc, theo_goc: bool)`. `k` = `khoa_dong`.

    Ba nhánh:
      (1) VẬT TƯ KHÁC, tổ giữ NGUYÊN đơn vị kế hoạch ⇒ nội suy theo TỈ LỆ engine vừa tính cho ĐÚNG
          lệnh này: `sl * sl_goc_kh / sl_kh`. GIẤY không đi nhánh này (spec giấy đếm tờ × khổ):
          dòng đếm tờ quy về "tờ", dòng kg/tấn quy về đơn vị giá của mã — đều là cầu quy đổi tĩnh,
          đơn vị gốc là phần thứ ba của khoá (`k[2]`).
      (2) giấy, tổ ĐỔI đơn vị, hoặc dòng ngoài kế hoạch ⇒ cầu quy đổi tĩnh (`ve_don_vi_goc`).
      (3) không quy được: nếu tổ đang xin số DƯƠNG thì NỔ lỗi nghiệp vụ — ta không thể xin kho
          một lượng không diễn đạt được bằng đơn vị kho nhận (`create` sẽ chặn y hệt). Nếu tổ xin
          0 thì không cần số gốc: trả 0 + `theo_goc=False`.
    Ca `kh_row["sl_goc"] == 0` là có thật: mặt hàng chưa khai công thức lượng thì chính bảng cân
    đối cũng để `nhu_cau = 0` và gắn cảnh báo. Nó rơi vào nhánh (2)→(3) đúng như trên.
    """
    kh_sl = _f((k_row or {}).get("sl"))
    kh_goc = _f((k_row or {}).get("sl_goc"))
    giay = k[0] == "giay"
    # Giấy + vật tư mang đơn vị gốc trong khoá (vật tư từ mg 0390: keo kg và keo thùng hai dòng).
    co_goc = co_don_vi_goc(k[0]) and bool(k[2])
    cung_dvt = k_row is not None and (dvt or "") == (k_row.get("dvt") or "")
    if not giay and cung_dvt and kh_sl > _EPS and kh_goc > _EPS:
        return sl * kh_goc / kh_sl, (k[2] if co_goc else k_row.get("dvt_goc")) or "", True
    try:
        sl_goc, dvt_goc = kh_svc.ve_don_vi_goc(k[0], k[1], dvt, sl,
                                               goc=k[2] if co_goc else None)
    except KeHoachVatTuError as e:
        if sl > _EPS:
            raise VatTuDeNghiError(str(e)) from None
        return 0.0, (k[2] if co_goc else (k_row or {}).get("dvt_goc")) or "", False
    # Giấy / vật tư: `dvt_goc` lưu MÃ gốc của khoá (cột này nằm trong unique của dòng, mg 0388) —
    # không lưu tên đơn vị trả về để hiển thị.
    return sl_goc, (k[2] if co_goc else dvt_goc), True


def _chuan_hoa(kh_svc, cv, lines: list[dict]) -> list[dict]:
    """Trộn kế hoạch với số tổ khai và QUY ĐỔI LẠI ở BE (§3, §4). Không còn bắt lý do chênh lệch
    (gỡ 09/10/2026): lệch kế hoạch vẫn gửi được, `ly_do_chenh_lech` không ghi mới.

    Không tin đơn vị/số của client: nó chỉ nói "xin 3 ram" — quy 3 ram ra bao nhiêu kg là việc của
    engine đơn vị, và phải là CÙNG engine mà bảng cân đối dùng, không thì hai bên đếm hai kiểu.
    """
    # Khoá dòng = `khoa_dong`: giấy cùng mã khác khổ / khác đơn vị gốc là hai dòng (spec 2026-10-01
    # §4.5; bỏ dạng cuộn/tờ 10/10/2026). Đơn vị gốc của dòng client gửi do máy chủ SUY từ `dvt`.
    kh = {khoa_dong(k["hang_loai"], k["hang_id"], k.get("don_vi_goc"),
                    k.get("kho_rong"), k.get("kho_dai")): k
          for k in kh_svc.nhu_cau_cua_cong_viec(cv)}
    khai: dict[tuple, dict] = {}
    for ln in lines:
        goc = (kh_svc.goc_cua_dvt(ln["hang_loai"], ln["hang_id"], ln.get("dvt"))
               if co_don_vi_goc(ln["hang_loai"]) and (ln.get("dvt") or "").strip() else None)
        k = khoa_dong(ln["hang_loai"], ln["hang_id"], goc, ln.get("kho_rong"), ln.get("kho_dai"))
        if co_don_vi_goc(ln["hang_loai"]) and not goc:
            # Dòng giấy / vật tư không có ĐVT: bám dòng kế hoạch DUY NHẤT cùng mã + khổ (nếu có).
            ung = [x for x in kh if x[:2] == k[:2] and x[3:] == k[3:]]
            if len(ung) == 1:
                k = ung[0]
        if k in khai:
            raise VatTuDeNghiError("Một mặt hàng cùng khổ, cùng đơn vị chỉ được khai một dòng — "
                                   "gộp số lượng lại.")
        khai[k] = ln

    ra: list[dict] = []
    for k in list(kh) + [k for k in khai if k not in kh]:
        k_row = kh.get(k)
        ln = khai.get(k)
        ten = (k_row or {}).get("ten") or f"#{k[1]}"
        sl = _f((ln or {}).get("sl_yeu_cau"))
        # Số âm không có nghĩa cho "xin cấp" — chặn NGAY, đừng để lọt vào bản đối chiếu rồi mới
        # bị `_lines_kho` âm thầm loại (bảng sản xuất khi đó ghi được "−50 tờ").
        if sl < 0:
            raise VatTuDeNghiError(f"«{ten}» không nhận số âm.")
        # Dòng NGOÀI kế hoạch mà xin 0 là vô nghĩa — không lưu (§4).
        if k_row is None and (ln is None or sl <= _EPS):
            continue
        # `k_row` là None cho dòng NGOÀI kế hoạch, nên `(k_row or {})["dvt"]` là KeyError ⇒ 500
        # ngay khi client gửi một dòng khai thêm với `dvt` rỗng (mặt hàng chưa khai đơn vị gốc thì
        # ô đơn vị trên form hiện "—" và FE không có gì để điền vào đây). Đó là lỗi NGHIỆP VỤ, phải
        # trả câu đọc được nêu đích danh mặt hàng chứ không phải một 500 câm.
        #
        # Nhưng CHỈ ném khi tổ THẬT SỰ đang xin dòng này (`sl > _EPS`) — cùng nguyên tắc "soi theo
        # cái tổ khai" như luật bỏ qua dòng ngoài kế hoạch số 0 ngay trên. Ném vô điều kiện là để MỘT món thiếu đơn vị khoá chết cả công đoạn — tổ trưởng
        # không gửi nổi cái gì, kể cả những món chẳng liên quan.
        #
        # `dvt` rỗng KHÔNG đồng nghĩa "danh mục chưa khai đơn vị gốc" — có ÍT NHẤT BA nguyên nhân,
        # nên câu lỗi dưới đây cố ý KHÔNG chỉ đích danh một chỗ sửa duy nhất:
        #   · danh mục thật sự chưa khai `don_vi_gia` (đơn vị gốc nullable từ 2026-08-08);
        #   · snapshot ĐÔNG CỨNG: `lsx_service.py` chốt `don_vi_snapshot = mat.don_vi_gia or ""`
        #     LÚC tạo bước (cột snapshot NOT NULL) — kỹ thuật khai `don_vi_gia` SAU đó thì snapshot
        #     vẫn rỗng dù danh mục nay đã đủ;
        #   · dòng GIẤY: `_dv_giay` (`ke_hoach_vat_tu_service.py:382-399`) đọc đơn vị đếm giấy từ
        #     ROUTING và cố ý trả `None` khi danh mục có nhiều hơn một khả năng ⇒ `k_row["dvt"]`
        #     rỗng dù tờ giấy có `don_vi_gia` đầy đủ; chỗ phải sửa là routing / danh mục Đơn vị.
        # Với hai ca sau, bảo tổ trưởng "khai đơn vị gốc cho mặt hàng" là chỉ SAI CHỖ. Câu lỗi vì
        # thế chỉ nói NHỜ AI (kỹ thuật) LÀM GÌ (kiểm lại đơn vị) + đường thoát tại chỗ (để dòng đó
        # ở 0, gửi phần còn lại) — tổ trưởng không có quyền vào bất kỳ chỗ nào trong ba chỗ trên.
        # GIỮ NGUYÊN cụm "báo kỹ thuật": hai test assert đúng cụm đó để có răng
        # (`test_dong_ngoai_ke_hoach_thieu_don_vi_ra_loi_doc_duoc`,
        # `test_xin_so_duong_cho_mat_hang_thieu_don_vi_van_bao_loi_doc_duoc`) — đổi là gỡ răng.
        dvt = (ln or {}).get("dvt") or (k_row or {}).get("dvt") or ""
        if not dvt and sl > _EPS:
            raise VatTuDeNghiError(
                f"«{ten}» chưa có đơn vị tính nên chưa xin được — báo kỹ thuật kiểm lại đơn vị "
                f"của mặt hàng này rồi xin lại. Trong lúc chờ, để dòng này ở 0 rồi gửi những "
                f"món còn lại."
            )
        # Giấy đếm TỜ ngoài kế hoạch phải nói khổ: kho soạn theo lô đúng khổ, thiếu một cạnh là kho
        # không biết lấy lô nào. Đơn vị khác (kg…) khổ tuỳ chọn như giấy cuộn trước đây.
        if k_row is None and k[0] == "giay" and k[2] == DON_VI_TO_KHO and not (k[3] and k[4]):
            raise VatTuDeNghiError(f"«{ten}» đếm theo tờ — khai đủ hai cạnh khổ (mm).")
        sl_goc, dvt_goc, _theo_goc = _ve_goc_dong(kh_svc, k, k_row, dvt, sl)
        kh_goc = _f((k_row or {}).get("sl_goc"))
        ra.append({
            "hang_loai": k[0], "hang_id": k[1],
            "don_vi_goc": k[2] or "", "kho_rong": k[3], "kho_dai": k[4],
            "ten": ten,
            "dvt": dvt, "dvt_goc": dvt_goc,
            "sl_ke_hoach": _f((k_row or {}).get("sl")), "sl_ke_hoach_goc": kh_goc,
            "sl_yeu_cau": sl, "sl_yeu_cau_goc": sl_goc,
        })
    return ra


def moi_dong_deu_0(dn) -> bool:
    """Mọi dòng của lần đề nghị này đều xin 0 ⇒ yêu cầu kho (nếu đang `cancelled`) là do CHÍNH SẢN
    XUẤT tự đưa về 0, không phải kho hủy. Hai bên đọc cùng một vị ngữ: `sua()` dùng nó để chọn
    đường khôi phục (`khoi_phuc_tu_san_xuat` so với `dong_bo_tu_san_xuat`), `board._vat_tu_cap`
    dùng nó để biết có mở ô "sửa lần cuối" cho tổ hay không (Task 7 — ruling task-7 27: kho ĐÃ hủy
    thì `sua()` sẽ ném lỗi, mời tổ bấm sửa để rồi ăn 400 là lỗi giao diện)."""
    return all(float(d.sl_yeu_cau or 0) <= _EPS for d in (dn.dongs or []))


def lan_con_mo(dn, *, co_voucher: bool, trang_thai_kho: str | None) -> bool:
    """Lần đề nghị `dn` còn ĐANG MỞ — tức còn sửa được, và vì thế CHƯA được mở lần bổ sung.

    Ba trạng thái, đừng gộp hai cái sau làm một:
      · kho đã lập phiếu ⇒ ĐÓNG (sửa nữa là sửa sau lưng chứng từ);
      · KHO hủy ⇒ ĐÓNG (`sua()` ném, và chính câu lỗi của nó bảo hãy tạo lần bổ sung);
      · TỔ tự đưa mọi dòng về 0 ⇒ vẫn MỞ (nhập lại số dương là khôi phục, giữ nguyên mã).

    Hàm THUẦN: người gọi tự đưa vào hai dữ kiện họ đã có sẵn, để board không phải hỏi DB thêm lần
    nào (ruling 25/36). `tao()` và board dùng CHUNG hàm này (vòng sửa 1, Important 1) — hai bên
    lệch nhau đúng một số hạng là đẻ ra nút bấm-rồi-báo-lỗi, đó chính là lỗi vòng đó đã sửa."""
    if dn is None:
        return False
    if co_voucher:
        return False
    if trang_thai_kho == REQ_CANCELLED and not moi_dong_deu_0(dn):
        return False
    return True


def _don_vi_gui_kho(hang, hang_loai, hang_id, sl_goc: float,
                    goc: str | None = None) -> tuple[str, float]:
    """Chọn đơn vị gửi kho cho một lượng đã quy về gốc. Trả `(dvt, so_luong_theo_dvt)`.

    Giấy đếm tờ (`goc="to"`) gửi thẳng đơn vị kho "tờ" — đúng đơn vị lô tờ đếm (spec giấy đếm tờ × khổ).
    Luật dò dưới đây cho vật tư khác và giấy đơn vị gốc khác (kg/tấn — dò trong ĐÚNG họ của `goc`).

    KHÔNG mặc định dùng đơn vị gốc: `StockRequestLine.sl_de_nghi` là `Numeric(14, 2)` kèm
    `CheckConstraint("> 0")`, nên với giấy (gốc = "tấn") một đề nghị 10 tờ ≈ 0.003 tấn bị ép về
    0.00 và vỡ ràng buộc ngay lúc commit — SQLite của test không ép scale nên test không thấy.
    Cả khi không về 0 thì bước lượng tử 0.01 tấn cũng ≈ 33 tờ giấy, đủ để số kho lệch số tổ khai.

    Luật chọn: chỉ được đi TỪ ĐƠN VỊ GỐC XUỐNG MỊN HƠN, không bao giờ lên thô hơn. Trong các đơn
    vị mịn-hơn-hoặc-bằng gốc, lấy cái THÔ NHẤT mà lượng vẫn ≥ 1. Vật tư đếm bằng "cái"/"kg" giữ
    nguyên đơn vị gốc như trước (50 cái vẫn là "cái"); chỉ khi đơn vị gốc biến lượng thành số lẻ
    dưới 1 mới bước xuống đơn vị mịn hơn (0.335 tấn → 335.14 kg). Không đơn vị nào đạt ≥ 1 thì
    lấy đơn vị mịn nhất.

    Cái trần "không lên thô hơn gốc" là bắt buộc, không phải cho gọn: danh mục THẬT khai giấy gốc
    = "kg" (`seed_rebuild`, mọi dòng `don_vi_gia="kg"`) và có cạnh `("tan","kg",1000)`, nên bản
    trước — vốn dò từ đơn vị thô nhất xuống — chọn "tấn" cho mọi đề nghị ≥ 1.000 kg: 2 314,5 kg
    thành 2,31 tấn = 2 310 kg, kho soạn thiếu 4,5 kg mà không ai thấy con số nào sai. Lên thô hơn
    gốc CHỈ làm mất số ở cột `Numeric(14, 2)`, không bao giờ cứu được gì.
    """
    if hang_loai == "giay" and goc == DON_VI_TO_KHO:
        return don_vi_goc_to(), float(sl_goc)
    ra = (hang.don_vi_cua_mat_hang(hang_loai, hang_id, goc=goc) if co_don_vi_goc(hang_loai) and goc
          else hang.don_vi_cua_mat_hang(hang_loai, hang_id))
    ds = [d for d in (ra.get("ds") or []) if float(d.get("he_so_ve_goc") or 0) > 0]
    if not ds:
        return (ra.get("don_vi_goc") or ""), float(sl_goc)
    # `sl_goc = so_luong_theo_dvt * he_so_ve_goc` ⇒ đảo lại để ra số theo từng đơn vị.
    # `he_so_ve_goc <= 1` = mịn hơn hoặc CHÍNH LÀ gốc; > 1 là thô hơn gốc, loại thẳng (xem docstring).
    cap = sorted(((float(d["he_so_ve_goc"]), d) for d in ds if float(d["he_so_ve_goc"]) <= 1.0),
                 key=lambda x: -x[0])
    if not cap:
        # Danh mục không khai nổi CHÍNH đơn vị gốc trong `ds` (dữ liệu cũ) — về nước đi an toàn.
        return (ra.get("don_vi_goc") or ""), float(sl_goc)
    for he_so, d in cap:                      # gốc → mịn dần
        sl = float(sl_goc) / he_so
        if sl >= 1.0:
            return d["ma"], sl
    he_so, d = cap[-1]                        # mịn nhất
    return d["ma"], float(sl_goc) / he_so


def _lines_kho(hang, cv, dongs: list[dict]) -> list[dict]:
    """Dòng yêu cầu kho = phần DƯƠNG của bản đối chiếu, quy sang đơn vị kho ghi được.

    Bản đối chiếu (bảng sản xuất) giữ NGUYÊN đơn vị tổ khai để tổ đọc đúng thứ họ gõ; chỉ ảnh
    chiếu sang kho mới đổi thang — xem `_don_vi_gui_kho` để biết vì sao không dùng thẳng đơn vị gốc.

    Lọc "có xin hay không" phải xét theo `sl_yeu_cau` (đơn vị TỔ KHAI — đúng thang với ô tổ gõ),
    KHÔNG phải `sl_yeu_cau_goc` (đơn vị GỐC, có thể lệch thang cả nghìn lần: 0.0005 tấn ≈ 1.6 tờ).
    Trước fix (ruling 14), lọc theo `sl_yeu_cau_goc` khiến tổ xin 1 tờ bị loại IM LẶNG — nếu đó là
    dòng dương duy nhất thì không yêu cầu kho nào được đẻ ra mà tổ không hề biết. Sau fix, mọi dòng
    tổ thật sự xin (`sl_yeu_cau > _EPS`) đều đi qua `_don_vi_gui_kho`; nếu lượng quy đổi vẫn quá
    nhỏ để kho ghi được thì rơi vào chốt chặn `round(sl, 2) <= 0` bên dưới — NỔ lỗi đọc được, không
    còn đường thứ ba nào âm thầm bỏ dòng.
    """
    ra = []
    for d in dongs:
        if d["sl_yeu_cau"] <= _EPS:
            continue
        dvt, sl = _don_vi_gui_kho(hang, d["hang_loai"], d["hang_id"], d["sl_yeu_cau_goc"],
                                  d.get("don_vi_goc") or None)
        # Cột kho là `Numeric(14, 2)` + `CHECK > 0`: lượng nhỏ hơn nửa đơn vị làm tròn sẽ thành
        # 0.00 và vỡ ràng buộc lúc commit. Chặn ở đây, có câu người dùng đọc được, thay vì để
        # `IntegrityError` thoát ra thành 500.
        if round(sl, 2) <= 0:
            raise VatTuDeNghiError(
                f"«{d['ten']}» xin quá ít so với đơn vị kho ghi được ({sl:g} {dvt}) — "
                f"gộp vào lần cấp sau hoặc đổi đơn vị."
            )
        ra.append({
            # Đơn vị gốc dòng kho máy chủ kho tự suy từ `dvt` — không gửi.
            "hang_loai": d["hang_loai"], "hang_id": d["hang_id"], "dvt": dvt,
            "kho_rong": d.get("kho_rong") or 0,
            "kho_dai": d.get("kho_dai") or 0,
            "sl_de_nghi": sl, "lsx_id": cv.lsx_id, "bai_ghep_id": cv.bai_ghep_id,
        })
    return ra


def _hang_service(db: Session):
    """`VatLieuKhoService` DÙNG CHUNG cho cả `_kh_service` lẫn `_req_service`.

    Hai nơi trước đây tự dựng riêng — cùng repo, cùng `db`, dựng hai lần vô ích. `tao()` dựng
    MỘT LẦN rồi truyền vào cả hai.
    """
    from ...repositories.don_vi_do_repo import DonViDoRepository
    from ...repositories.vat_lieu_kho_repo import VatLieuKhoRepository
    from ..vat_lieu_kho_service import VatLieuKhoService

    return VatLieuKhoService(VatLieuKhoRepository(db), DonViDoRepository(db))


def _kh_service(db: Session, hang):
    """Dựng `KeHoachVatTuService` đúng bộ repo như `routers/ke_hoach_vat_tu.py::get_service()`.

    Ghép THIẾU một repo là engine im lặng trả rỗng — copy nguyên danh sách, không tự rút gọn.
    """
    from ...repositories.bai_ghep_repo import BaiGhepRepository
    from ...repositories.don_vi_do_repo import DonViDoRepository
    from ...repositories.lsx_repo import LsxRepository
    from ...repositories.purchase_repo import PurchaseRequestRepository, SupplierRepository
    from ...repositories.stock_lot_repo import StockLotRepository
    from ...repositories.stock_request_repo import StockRequestRepository
    from ..ke_hoach_vat_tu_service import KeHoachVatTuService

    return KeHoachVatTuService(
        db,
        lsx_repo=LsxRepository(db),
        bai_ghep_repo=BaiGhepRepository(db),
        hang=hang,
        lots=StockLotRepository(db),
        requests=StockRequestRepository(db),
        purchases=PurchaseRequestRepository(db),
        suppliers=SupplierRepository(db),
        don_vi=DonViDoRepository(db),
    )


def _req_service(db: Session, hang):
    """Dựng `StockRequestService` đúng bộ repo như `routers/kho_request.py::get_service()`.

    `_validate_lines` cần `self.hang`; thiếu nó là mọi dòng lọt qua không kiểm.
    """
    from ...repositories.document_sequence_repo import DocumentSequenceRepository
    from ...repositories.stock_lot_repo import StockLotRepository, StockThresholdRepository
    from ...repositories.stock_request_repo import StockRequestRepository
    from ..sequence_service import SequenceService
    from ..stock_request_service import StockRequestService

    return StockRequestService(
        StockRequestRepository(db),
        StockLotRepository(db),
        StockThresholdRepository(db),
        SequenceService(DocumentSequenceRepository(db)),
        hang=hang,
    )


def _bao_de_nghi_doi(cv) -> None:
    """Đề nghị cấp vật tư của MỘT công việc đổi. FE chỉ nghe ở bàn tổ (gác `coQuyenBanTo`, đếm theo
    `cong_viec_id` cho drawer đang mở, không nhích nhóm nào) ⇒ chỉ bàn của tổ giữ việc; phía kho
    nhận tin riêng của yêu cầu kho."""
    hub.gui({"type": "san_xuat_vat_tu_de_nghi_changed", "cong_viec_id": cv.id},
            **kem_ban_to((), [cv.department_id]))


def _lap_lan(db: Session, *, cv, nguoi, bo_phan_id: int | None, can_luc: datetime,
             dongs: list[dict], ghi_chu: str | None, tu_lap: bool, req_svc, hang):
    """Ghi MỘT lần đề nghị + yêu cầu kho ảnh chiếu. Trả `(dn, req)`; `req` là None khi mọi dòng
    bằng 0. `dongs` là output của `_chuan_hoa`.

    KHÔNG commit, KHÔNG gate, KHÔNG báo tin: người gọi lo khoá, quyền, chốt giao dịch và báo SAU
    commit. Tổ bấm (`tao`) và tự lập lúc phát hành (`vat_tu_tu_lap`) dùng chung.

    `req_svc.create(commit=False)` là điều kiện sống còn của khoá ở `tao()`: mặc định repo kho tự
    `commit()` trên chính session này, mà commit là NHẢ khoá hàng. Nhả xong thì lượt bấm trùng
    chen vào, đọc `cac_de_nghi` vẫn rỗng, lấy cùng `lan_so`, đẻ yêu cầu kho thứ hai rồi vỡ
    `UniqueConstraint("cong_viec_id","lan_so")` — thủ kho ôm một yêu cầu MỒ CÔI. Thứ tự "kho
    trước, SX sau" chỉ vì `dn.stock_request_id` cần `req.id` (ruling minor-5).
    """
    vt_repo = SanXuatVatTuRepository(db)
    lan_so = vt_repo.lan_ke_tiep(cv.id)
    loai = DN_LAN_DAU if lan_so == 1 else DN_BO_SUNG
    kho_lines = _lines_kho(hang, cv, dongs)

    req = None
    if kho_lines:
        req = req_svc.create(
            user=nguoi, loai=REQ_XUAT, lines=kho_lines, commit=False,
            bo_phan_id=bo_phan_id,
            ngay_can=_ngay_vn(can_luc), can_luc=_can_luc_luu(can_luc),
            # Tổ gõ ghi chú thì thủ kho đọc đúng chữ đó; để trống thì giữ câu mặc định.
            ghi_chu=((ghi_chu or "").strip()[:1000]
                     or f"Cấp vật tư công đoạn «{cv.ten_cong_doan}» (lần {lan_so})."),
        )

    dn = SanXuatVatTuDeNghi(
        cong_viec_id=cv.id, lan_so=lan_so, loai=loai, can_luc=_can_luc_luu(can_luc),
        stock_request_id=(req.id if req is not None else None), tu_lap=tu_lap,
        # Tự lập: `updated_by_id` để trống tới khi tổ sửa lần đề nghị — phát hành cập nhật nhìn
        # cột này để biết còn được dời giờ cần theo lịch hay tổ đã chốt giờ của mình.
        created_by_id=getattr(nguoi, "id", None),
        updated_by_id=None if tu_lap else getattr(nguoi, "id", None),
    )
    db.add(dn)
    db.flush()
    for d in dongs:
        db.add(SanXuatVatTuDeNghiDong(de_nghi_id=dn.id, **{
            k: v for k, v in d.items() if k not in ("ten", "don_vi_goc")
        }))

    AuditLogRepository(db).create(
        actor_user_id=getattr(nguoi, "id", None), action="san_xuat_de_nghi_vat_tu",
        target=f"san_xuat_cong_viec:{cv.id}",
        detail=f"lần {lan_so} · {len(kho_lines)} dòng gửi kho",
        commit=False,
    )
    return dn, req



def _to_nguoi_bam(db: Session, user) -> int | None:
    """Tổ của người bấm gửi = tổ trên HỒ SƠ NHÂN VIÊN của họ (L-VAI-47, giữ luật 11/10/2026). Tài
    khoản có thể trỏ phòng / tổ cha (một nhóm, không nhận việc) — hồ sơ mới nói người đó ở tổ nào.
    Không có hồ sơ (hoặc hồ sơ chưa có tổ) thì dùng phòng của tài khoản như trước."""
    emp = EmployeeRepository(db).get_by_user_id(user.id) if getattr(user, "id", None) else None
    return emp.department_id if emp is not None and emp.department_id else user.department_id

def tao(db: Session, *, user, cong_viec_id: int, can_luc: datetime,
        lines: list[dict], ghi_chu: str | None = None, kh_svc=None, req_svc=None) -> dict:
    """Tạo một LẦN đề nghị. Lần 1 = `lan_dau`, từ lần 2 trở đi = `bo_sung`.

    BA thang đơn vị chạy song song ở đây:
      · `SanXuatVatTuDeNghiDong.sl_yeu_cau`/`dvt` — đơn vị TỔ KHAI (tờ, ram…), giữ để bản đối
        chiếu hiện đúng chữ tổ gõ (ruling 10).
      · `sl_yeu_cau_goc`/`dvt_goc` — đơn vị GỐC, dùng để SO LỆCH kế hoạch. Giấy tờ: "tờ" (`to`);
        giấy cuộn + vật tư khác: đơn vị gốc của mã. Không quy được thì `ve_don_vi_goc` ném lỗi.
      · `StockRequestLine.sl_de_nghi`/`dvt` — đơn vị GỬI KHO, do `_don_vi_gui_kho` chọn từ
        `sl_yeu_cau_goc` (ruling 11b). Giấy tờ gửi thẳng "tờ"; hàng gốc thô (tấn) bước xuống
        đơn vị mịn hơn vì `sl_de_nghi` là `Numeric(14, 2)` kèm `CHECK > 0`. Dòng kho mang dạng +
        khổ của dòng đề nghị.
    So sánh giữa `SanXuatVatTuDeNghiDong` và `StockRequestLine` vì thế PHẢI đi qua
    `sl_yeu_cau_goc`/`dvt_goc`, không phải `sl_yeu_cau`/`dvt` lẫn `sl_de_nghi`/`dvt` của dòng kho.
    """
    repo = SanXuatRepository(db)
    cv = repo.cong_viec(cong_viec_id)
    if cv is None:
        raise ValueError("Không tìm thấy công việc.")
    from .dong_lenh import chan_neu_da_dong

    chan_neu_da_dong(db, cv)
    # Khoá công đoạn TRƯỚC khi đọc bất cứ thứ gì mình sắp ghi đè lên (`cac_de_nghi`, `lan_ke_tiep`).
    # `sua()` đã có khoá của nó (`StockRequestRepository.lock_for_update`), `tao()` thì trước đây
    # không khoá gì: tổ trưởng bấm "Gửi đề nghị" hai lần lúc mạng chậm là hai lượt cùng đọc
    # `lan_ke_tiep = 1`, cả hai gọi `req_svc.create()` (repo kho TỰ COMMIT) rồi một lượt vỡ
    # `UniqueConstraint("cong_viec_id", "lan_so")` — thủ kho ôm một yêu cầu kho MỒ CÔI mà
    # `boi_canh_san_xuat` không trả nổi công đoạn/giờ cần, và vẫn soạn giấy lần thứ hai.
    # Khoá ở đây thì lượt sau chờ, đọc lại, thấy lần trước còn mở và ăn đúng câu lỗi nghiệp vụ
    # ngay bên dưới. Khoá này CHỈ có tác dụng nhờ `commit=False` ở lời gọi `req_svc.create` bên
    # dưới — bất kỳ `commit()` nào chen vào giữa cũng nhả khoá và mở lại nguyên ca đua trên.
    repo.khoa_cong_viec(cong_viec_id)
    _gate(db, user, cv, VIEC_KHO)

    vt_repo = SanXuatVatTuRepository(db)
    cac = vt_repo.cac_de_nghi(cong_viec_id)
    if cac:
        cuoi = cac[-1]
        # `yeu_cau_tom_tat` là hàm GỘP đã viết ở Task 7 (`SanXuatSanLuongRepository`) — tái dùng,
        # không đẻ thêm phương thức repo mới chỉ để đọc một trạng thái (vòng sửa 1, Important 1).
        tt = SanXuatSanLuongRepository(db).yeu_cau_tom_tat([cuoi.stock_request_id]).get(
            cuoi.stock_request_id, {}).get("trang_thai")
        if lan_con_mo(cuoi, co_voucher=StockRequestRepository(db).co_voucher(cuoi.stock_request_id),
                      trang_thai_kho=tt):
            raise VatTuDeNghiError(
                "Đang có đề nghị chưa được kho lập phiếu — hãy sửa đề nghị đó thay vì tạo lần mới.")

    hang = _hang_service(db)
    kh_svc = kh_svc or _kh_service(db, hang)
    dongs = _chuan_hoa(kh_svc, cv, lines)
    req_svc = req_svc or _req_service(db, hang)

    # `_lap_lan` KHÔNG commit (audit đi `commit=False`): toàn bộ `tao()` là MỘT giao dịch, khoá
    # `khoa_cong_viec` ở trên giữ liên tục tới `db.commit()` dưới đây. Lượt bấm trùng chờ thật,
    # đọc lại thật và dừng ở câu "Đang có đề nghị chưa được kho lập phiếu". Muốn thêm lệnh ghi vào
    # giao dịch này thì đặt TRƯỚC `db.commit()`.
    dn, req = _lap_lan(
        db, cv=cv, nguoi=user,
        # Bộ phận = của NGƯỜI bấm gửi (11/10/2026 — chủ xưởng: yêu cầu "phải theo người và tổ của
        # người yêu cầu"). Tổ của công đoạn đọc ở công việc, không mượn ô bộ phận.
        bo_phan_id=_to_nguoi_bam(db, user),
        can_luc=can_luc, dongs=dongs, ghi_chu=ghi_chu, tu_lap=False, req_svc=req_svc, hang=hang,
    )
    lan_so = dn.lan_so
    db.commit()
    # Báo kho SAU khi giao dịch đã chốt, không sớm hơn: `create(commit=False)` cố ý IM LẶNG vì tin
    # bắn lúc hàng chưa commit sẽ khiến trình duyệt refetch trên một connection khác mà không thấy
    # gì — badge bỏ nhịp và SSE không tự thử lại (xem `StockRequestService.thong_bao_yeu_cau_moi`).
    if req is not None:
        req_svc.thong_bao_yeu_cau_moi(req)
    _bao_de_nghi_doi(cv)
    return {"de_nghi_id": dn.id, "stock_request_id": dn.stock_request_id, "lan_so": lan_so}


def sua(db: Session, *, user, cong_viec_id: int, de_nghi_id: int,
        can_luc: datetime, lines: list[dict], ghi_chu: str | None = None,
        kh_svc=None, req_svc=None) -> dict:
    """Sửa một lần đề nghị CHƯA bị kho lập phiếu (spec §5.2–§5.4).

    Kiểm khoá phải chạy TRONG transaction, ngay trước khi ghi — kiểm ở router rồi mới vào service
    là mở đúng khe cho kho bấm "lập phiếu" ở giữa hai thời điểm đó (`co_voucher` bên dưới đọc lại
    ngay trước khi ghi bảng SX).

    Ba nhánh đích cho yêu cầu kho, theo đúng combo (đã-có-yêu-cầu?, còn-dòng-dương?):
      · CHƯA có `stock_request_id`, giờ có dòng dương ⇒ lần đầu toàn 0 nay xin lại — mới đẻ
        chứng từ kho (giống `tao()`).
      · ĐÃ có `stock_request_id`, còn dòng dương, VÀ bản TRƯỚC KHI SỬA toàn 0 ⇒ chính sản xuất đã
        hủy yêu cầu đó — khôi phục qua `khoi_phuc_tu_san_xuat`.
      · ĐÃ có `stock_request_id`, còn dòng dương, nhưng bản TRƯỚC KHI SỬA còn dòng dương (sản xuất
        chưa hủy gì) ⇒ đồng bộ thường qua `dong_bo_tu_san_xuat`; nếu yêu cầu đang `cancelled` thì
        đó là KHO hủy (ruling task-4 important-2) và hàm này tự chặn, không cho lật quyết định
        của kho.
      · ĐÃ có `stock_request_id`, hết dòng dương ⇒ huỷ yêu cầu (`huy_tu_san_xuat`), giữ mã + link
        để tổ nhập lại số dương sau này khôi phục đúng chứng từ đó.
    """
    repo = SanXuatRepository(db)
    cv = repo.cong_viec(cong_viec_id)
    if cv is None:
        raise ValueError("Không tìm thấy công việc.")
    _gate(db, user, cv, VIEC_KHO)

    vt_repo = SanXuatVatTuRepository(db)
    dn = vt_repo.de_nghi(de_nghi_id)
    if dn is None or dn.cong_viec_id != cong_viec_id:
        raise ValueError("Không tìm thấy đề nghị của công đoạn này.")
    if StockRequestRepository(db).co_voucher(dn.stock_request_id):
        raise VatTuDeNghiError("Kho đã lập phiếu cho đề nghị này — hãy tạo yêu cầu bổ sung.")

    # Chụp TRƯỚC khi xoá dòng cũ: dùng để biết cái `cancelled` (nếu có) là do sản xuất tự đưa về 0
    # hay do kho hủy. Xoá xong mới hỏi là mất luôn câu trả lời (ruling task-4 important-2).
    truoc_do_toan_0 = moi_dong_deu_0(dn)

    hang = _hang_service(db)
    kh_svc = kh_svc or _kh_service(db, hang)
    dongs = _chuan_hoa(kh_svc, cv, lines)
    kho_lines = _lines_kho(hang, cv, dongs)

    # KHÁC `tao()`: `sua()` KHÔNG chạy trọn trong một giao dịch, và cố ý dừng ở đó. Ba nhánh đồng
    # bộ/hủy bên dưới kết bằng `requests.save()` mặc định — tức TỰ COMMIT giữa hàm, nhả luôn cái
    # `lock_for_update` mà chính chúng vừa lấy. Gỡ được chỗ đó phải đưa `commit=False` xuyên qua cả
    # ba hàm `*_tu_san_xuat` VÀ hoãn phần đẩy tin của chúng; đó là một việc riêng, chưa làm.
    #
    # Vì thế khối `req_svc` phải chạy TRƯỚC khi đụng `dn.dongs` (ruling task-4 minor-5, cùng lý do
    # `tao()` đã vá): nếu `dn.dongs` đã bị xoá/dựng lại ở phía TRÊN thì một commit nội bộ giữa chừng
    # của `req_svc` ghi luôn phần dở đó vào DB. Làm req_svc trước thì chết giữa chừng chỉ để lại
    # đúng NỬA đầu (yêu cầu kho), `dn.dongs` của lần sửa vẫn chưa động tới — tổ gọi lại `sua()` với
    # cùng số là xong, không mồ côi.
    #
    # RIÊNG nhánh ĐẺ MỚI thì đi `commit=False` được ngay và có lợi thật: nó không cầm
    # `lock_for_update` nào để mà nhả, còn `create` tự commit ở đó lại đẻ đúng con MỒ CÔI mà `tao()`
    # vừa bịt — yêu cầu kho nằm trong hộp thư thủ kho mà không `SanXuatVatTuDeNghi` nào trỏ tới,
    # nếu phần ghi bảng SX ngay dưới đổ. Đổi lại, tin báo kho phải dời xuống sau `db.commit()`.
    req_svc = req_svc or _req_service(db, hang)
    ghi_chu_tay = (ghi_chu or "").strip()[:1000] or None      # None = giữ ghi chú đang có
    req_id_moi = None
    req_moi = None       # yêu cầu kho vừa đẻ — báo kho ở CUỐI hàm, sau khi đã chốt giao dịch
    if dn.stock_request_id is None:
        # Lần đầu toàn 0, nay có số dương ⇒ giờ mới đẻ chứng từ kho.
        if kho_lines:
            req_moi = req_svc.create(
                user=user, loai=REQ_XUAT, lines=kho_lines, commit=False,
                bo_phan_id=_to_nguoi_bam(db, user),  # tổ của người bấm — xem `tao()`
                ngay_can=_ngay_vn(can_luc), can_luc=_can_luc_luu(can_luc),
                ghi_chu=(ghi_chu_tay
                         or f"Cấp vật tư công đoạn «{cv.ten_cong_doan}» (lần {dn.lan_so})."),
            )
            req_id_moi = req_moi.id
    elif kho_lines:
        if truoc_do_toan_0:
            req_svc.khoi_phuc_tu_san_xuat(dn.stock_request_id, kho_lines,
                                          user=user, ngay_can=_ngay_vn(can_luc),
                                          can_luc=_can_luc_luu(can_luc), ghi_chu=ghi_chu_tay)
        else:
            # Trước đó vẫn còn dòng dương ⇒ sản xuất chưa hủy gì. Đi đường đồng bộ thường; nếu
            # yêu cầu đang `cancelled` thì đó là kho hủy và `dong_bo_tu_san_xuat` sẽ chặn.
            req_svc.dong_bo_tu_san_xuat(dn.stock_request_id, kho_lines,
                                        user=user, ngay_can=_ngay_vn(can_luc),
                                        can_luc=_can_luc_luu(can_luc), ghi_chu=ghi_chu_tay)
    else:
        req_svc.huy_tu_san_xuat(dn.stock_request_id, user=user)

    dn.dongs.clear()
    db.flush()
    for d in dongs:
        db.add(SanXuatVatTuDeNghiDong(de_nghi_id=dn.id, **{
            k: v for k, v in d.items() if k not in ("ten", "don_vi_goc")
        }))
    dn.can_luc = _can_luc_luu(can_luc)
    dn.updated_by_id = getattr(user, "id", None)
    if req_id_moi is not None:
        dn.stock_request_id = req_id_moi

    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None), action="san_xuat_sua_de_nghi_vat_tu",
        target=f"san_xuat_vat_tu_de_nghi:{dn.id}",
        detail=f"{len(kho_lines)} dòng gửi kho",
    )
    db.commit()
    # Nhánh đẻ mới đi `commit=False` nên `create` KHÔNG tự đẩy tin — báo kho ở đây, sau khi chốt.
    if req_moi is not None:
        req_svc.thong_bao_yeu_cau_moi(req_moi)
    _bao_de_nghi_doi(cv)
    # KHÔNG broadcast thêm `stock_request_pending_changed` toàn hệ ở đây (ruling task-4 minor-6):
    # ba nhánh đồng bộ/hủy đã tự `_notify(..., targeted=False)` bên trong, nhánh đẻ mới thì
    # `thong_bao_yeu_cau_moi` ngay trên — mà `_notify` cố ý đẩy THEO PHẠM VI (xem
    # `stock_request_service.py`), không broadcast toàn hệ. `tao()` cũng không có dòng này.
    return {"de_nghi_id": dn.id, "stock_request_id": dn.stock_request_id}
