"""Service Lệnh sản xuất (LSX) — Kế hoạch nhận đơn Sale đã bàn giao → bung lệnh dự kiến → tạo lệnh.

Ba tầng như print MIS: Job (`orders`) → Part (`lsx`) → Operation (`lsx_cong_doan`).

Nguyên tắc:
- **Nguồn sinh lệnh là DÒNG ĐƠN** (`order_lines`), không quét thẳng phiếu tính giá — vì khách có thể
  chốt MỘT PHẦN báo giá, và đơn mới là bản cam kết bán.
- **Số lượng lấy từ ĐƠN**: chạy lại engine (hàm THUẦN) với `so_luong = order_lines.qty` để ra số tờ
  đúng cam kết. KHÔNG gọi `compute_phieu_snapshot` (hàm đó ghi đè ảnh chụp lên phiếu tính giá).
- **Máy chỉ đề xuất**: routing/đơn vị/số lượng vào-ra copy sang lệnh là MẶC ĐỊNH, kế hoạch sửa hết.
- **Snapshot**: quy cách + routing chụp lúc tạo; sửa phiếu tính giá về sau không lay lệnh đã tạo.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from math import ceil, floor

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased, selectinload

from ..models.bai_ghep import BaiGhep, BaiGhepThanhVien
from ..models.bai_ghep_cong_doan import BaiGhepCongDoan, BaiGhepCongDoanMap
from ..models.cong_doan import CD_BOI, CD_CAT_CUON, CD_TE_GIAY_IN, CD_TE_SONG, CongDoan, CongDoanMay
from ..models.customer import Customer
from ..models.lsx import (
    DV_CAI,
    DV_CON,
    DV_KEM,
    DV_TAY,
    DV_TO,
    DV_TO_NGUYEN,
    LB_MAY,
    LB_THUE_NGOAI,
    LB_TO,
    LOAI_BUOC,
    LOAI_MOI,
    NHAN_TRANG_THAI,
    TT_CHO_BO_SUNG,
    TT_DA_DONG,
    TT_DA_LAP_KE_HOACH,
    TT_DA_PHAT_HANH,
    TT_NHAP,
    TT_SAN_SANG,
    TEN_BUOC_TRONG,
    TRANG_THAI_LSX,
    Lsx,
    LsxCongDoan,
    LsxCongDoanPhuThuoc,
    LsxCongDoanVatTu,
)
from ..models.may_thiet_bi import MayThietBi, ma_don_vi_goc
from ..models.order import STATUS_CANCELLED, STATUS_ORDERED, Order, OrderLine
from ..models.phieu_tinh_gia import PhieuThanhPhan, PhieuThanhPham, PhieuTinhGia
from ..models.quotation import QuoteVersion
from ..models.user import User
from ..models.vat_lieu_kho import HANG_GIAY, HANG_VAT_TU, LOAI_GIAY, GiayNguyen, VatTuInAn
from .may_to import cap_lech, loi_cap, to_khong_may
from .ptg_giay_buoc import bang_giay, id_giay_cua_rows, loi_tran_giay
from .chuan_bi_giay import (
    CUON_DU_TOI_DA_MM, NGUON_GIAY, DauVaoGiay, NguonChon, chon_nguon, dong_giay_buoc_dau, dong_song,
    kho_nguyen_dung_duoc, khoa_ung_vien, ma_buoc_giay,
)
from ..repositories.cong_doan_repo import id_cong_doan_he_thong
from ..repositories.gia_cong_ngoai_repo import GiaCongNgoaiRepository
from .gia_cong_ngoai import lan_can_hoi_xuat_giay, tom_tat_theo_lenh as tom_tat_gcn_theo_lenh
from ..services.bu_hao_engine import hao_buoc
from ..models.don_vi_do import (
    TRAM_CAI, TRAM_CON, TRAM_TAY, TRAM_TO, TRAM_TO_NGUYEN,
)
from ..services.dong_giay import (
    ban_do_tram, dich_chuoi, don_vi_chuoi, ma_cua_tram, tram_cua, tren_dong_giay,
)
from ..models.don_vi_do import DonViDo
from ..services.kho_giay import DON_VI_TO_KHO, GocMatHang, don_vi_khai, dong_giay_theo_dau_vao
from ..services.bien_cong_thuc import MAC_DINH_TANG_LENH, ngu_canh_lenh, quy_cach_bien
from ..services.don_vi_do_service import cong_thuc_chu, cong_thuc_the_so
from ..services.lsx_danh_muc_doi import vat_tu_lech
from ..services.quy_doi_service import (
    _so as _so_vn, bien_trong, doi_theo_quy_cach, don_vi_map,
)
from ..services.thanh_phan_engine import safe_eval
from ..services.thanh_phan_engine import cau_to_sang_cai, chua_theo_chieu, compute_phieu
from ..services.tinh_gia_service import _resolve_thanh_phan

# Công đoạn sau xén → đếm bằng CON (thành phẩm); còn lại đếm bằng TỜ. Heuristic theo tên để điền
# MẶC ĐỊNH cho kế hoạch, không phải luật — mọi dòng sửa được.


# Trường KHÔNG chép sang quy cách lệnh sản xuất: toàn bộ là TIỀN (lệnh xuống xưởng không mang
# giá vốn) + số lượng (đã có `so_luong_dat` của ĐƠN, chép lại chỉ gây mâu thuẫn).
_QC_BO_QUA = frozenset({
    "don_gia_giay", "don_gia_don_vi", "don_gia_cong_in", "che_ban_don_gia",
    "cong_thuc_gia", "gia_von_tp", "so_luong",
})


# Chặng vào có cầu tới Thành phẩm trong `_he_so_cau` — chỉ bước cuối vào từ những chặng này mới
# ép ra Thành phẩm được (xem LƯỢT 3 của `_ap_chuoi_nguoc`).
_CO_CAU_TOI_THANH_PHAM = frozenset({TRAM_TO, TRAM_CON, TRAM_TAY, TRAM_CAI})

# Dụng cụ mà bước ở LỆNH phải chốt MỘT CON cụ thể trong kho (`khuon_be_id`). `kem` KHÔNG có mặt
# (bản kẽm là vật tư tiêu hao, mỗi bài phơi một bản mới nên không có gì để "đi lấy ở kệ").
#
# 01/10/2026: CHỈ còn `khuon_be`. Ép kim / khung lụa đã gỡ — công đoạn cũ còn mang hai mã đó là
# bước BÌNH THƯỜNG ở lệnh (không thẻ "Khuôn của bước", không chặn "Sẵn sàng").
TOOLING_CO_KHO = frozenset({"khuon_be"})


def can_chot_khuon(requires_tooling, tooling_type) -> bool:
    """Bước ở lệnh có phải chốt một con khuôn trong kho không.

    MỘT chỗ quyết cho mọi màn của lệnh — drawer bước, cửa "Sẵn sàng lập kế hoạch", hồ sơ lệnh,
    điều độ. Các màn đó đọc cờ `requires_tooling` server trả về chứ không tự suy, nên chỉ cần cờ ấy
    đi qua đây là cả hệ nói cùng một câu.
    """
    return bool(requires_tooling) and tooling_type in TOOLING_CO_KHO


def _don_vi_theo_buoc(cd_obj, *, con: int = 1, xa: int = 1,
                      cau: dict | None = None,
                      tram: dict[str, str] | None = None) -> tuple[str, str, float]:
    """Đơn vị VÀO/RA + hệ số quy đổi của 1 bước — ĐỌC KHAI BÁO ở danh mục công đoạn.

    `cong_doan.don_vi_vao/ra` là KHAI BÁO, cả tầng lệnh lẫn tầng tính giá cùng đọc — một nguồn sự
    thật. Không suy đơn vị từ tên bước: tên là chữ người dùng gõ.

    Bảng cầu (`cau`) khoá theo **TRẠM**, còn `don_vi_vao/ra` là **MÃ** do xưởng đặt — nên phải dịch
    một nhịp qua `tram` trước khi tra. Bỏ `tram` là rơi về so mã: chạy đúng với dữ liệu seed (mã
    trùng trạm) rồi im lặng trả hệ số 1.0 ngay khi xưởng khai `to_chay` thay cho `to`.

    Hệ số KHÔNG lưu ở danh mục: nó thuộc về PHIẾU (`con` từ bình bài, `xa` = số mảnh xả từ khổ
    giấy). Caller truyền vào.
    """
    dv_vao = getattr(cd_obj, "don_vi_vao", None) or None
    dv_ra = getattr(cd_obj, "don_vi_ra", None) or None
    if dv_vao is None or dv_ra is None:
        return None, None, 1.0
    if dv_vao == dv_ra:
        return dv_vao, dv_ra, 1.0
    # `tram=None` = nơi gọi chưa có bản đồ ⇒ coi mã chính là trạm (dữ liệu seed mặc định). Đây là
    # lối lùi, KHÔNG phải cách dùng đúng — mọi nơi gọi thật đều truyền `self._tram()`.
    tv = tram_cua(dv_vao, tram) if tram else dv_vao
    tr = tram_cua(dv_ra, tram) if tram else dv_ra
    # Có BẢNG CẦU của lệnh thì tra thẳng ở đó — nó là nguồn sự thật, biết cả cầu `tay` của sách
    # (`to→cai` sách nhỏ hơn 1, `con` không suy ra được). Hai nhánh tay dưới chỉ còn để phục vụ
    # lúc TẠO bước, khi lệnh chưa tồn tại nên chưa có bảng; số đó bị `_ap_chuoi_nguoc` ghi đè ngay.
    if cau is not None:
        return dv_vao, dv_ra, float(cau.get((tv, tr), 1.0) or 1.0)
    if (tv, tr) == (TRAM_TO, TRAM_CAI):
        return dv_vao, dv_ra, float(max(con, 1))
    if (tv, tr) == (TRAM_TO_NGUYEN, TRAM_TO):
        return dv_vao, dv_ra, float(max(xa, 1))
    return dv_vao, dv_ra, 1.0


def tu_khai_don_vi(buoc, cd_obj) -> bool:
    """Bước NGOÀI dòng giấy mà người kế hoạch TỰ KHAI đơn vị ngay tại lệnh (10/09/2026).

    Ghi kẽm là ca điển hình: số bản kẽm đổi theo số màu / số mặt / số bài của TỪNG đơn, mà công
    đoạn thì dùng chung cho mọi lệnh — không công thức chung nào nói hộ được. Nên drawer mở hai ô
    đơn vị + hai ô số, và bước nào đã khai thì danh mục thôi kéo lại đơn vị. Công thức sản lượng
    ra ở danh mục GỠ 18/09/2026 (mg `0324`): đây là đường DUY NHẤT để bước ngoài dòng có số.

    Dấu hiệu DẪN XUẤT từ chính cặp đơn vị — bước có, danh mục để trống — nên KHÔNG cần cột cờ:
    xoá một trong hai ô đơn vị ở drawer là bước trả ngay về cho danh mục. Danh mục có khai đơn vị
    thì bước vẫn kế thừa như cũ; đây chỉ mở đúng chỗ danh mục im lặng.

    Đòi ĐỦ CẢ HAI ô mới tính là khai tay. Nửa cặp không phải một lời khai mà là ô còn dở: bước tự
    thêm giữa chuỗi vốn chỉ mang `don_vi_vao` rồi để LƯỢT 2 của `_ap_chuoi_nguoc` nối vế RA theo
    bước trước — nhận nửa cặp là bước ấy đứng lại ngoài dòng giấy và hao của nó biến mất khỏi số
    giấy phải mua, im lặng.
    """
    if not (getattr(buoc, "don_vi_vao", None) and getattr(buoc, "don_vi_ra", None)):
        return False
    return _don_vi_theo_buoc(cd_obj)[:2] == (None, None)


# ⚠️ `_dinh_muc_snapshot()` GỠ 18/09/2026 (mg `0320`): ảnh chụp năng suất người-giờ + kíp chuẩn
#    của một đầu việc. Công đoạn thôi khai đầu việc, và thời lượng bước TỔ nay là SỐ GIỜ KẾ
#    HOẠCH người lập lệnh gõ tay (`so_gio_ke_hoach`) — không còn phép chia nào cần năng suất.


def ma_don_vi_toc_do(may) -> str | None:
    """Mã ĐƠN VỊ mà tốc độ của máy đếm: `to_gio` → `to`. None khi máy chưa khai.

    Máy lưu mã dạng `<đơn vị>_gio` (`may_thiet_bi.don_vi_toc_do`), sinh từ chính danh mục Đơn vị &
    quy đổi. Phép cắt hậu tố nằm ở `models.may_thiet_bi.ma_don_vi_goc` — ĐÚNG một chỗ, để nơi khác
    khỏi tự cắt mỗi nơi một kiểu (danh mục Máy tra TÊN đơn vị cũng gọi nó).
    """
    return ma_don_vi_goc(getattr(may, "don_vi_toc_do", None))


# ⚠️ `dich_gio_cua_khoan()` GỠ 18/09/2026 (mg `0321`): nó dịch ảnh chụp đầu việc ra cặp
#    (đơn vị đích, công thức) để QUY ĐỔI SL vào rồi chia năng suất. Bước TỔ thôi tính giờ theo
#    sản lượng — người lập lệnh gõ thẳng SỐ GIỜ KẾ HOẠCH — nên cả phép quy đổi ấy không còn
#    khách. Bước MÁY vẫn quy đổi, nhưng đích của nó là `ma_don_vi_toc_do(may)`, đường riêng.
# LOẠI BƯỚC (Máy / Tổ / Thuê ngoài) CHỈ do người kế hoạch chọn, ở ô "Loại bước" trong drawer bước.
# Máy KHÔNG suy nó từ tên công đoạn — tên là chữ người dùng gõ nên mọi phép suy đều gãy khi xưởng
# đặt tên khác đi (gỡ 12/08/2026). Mặc định của bước mới là `may`, trùng đúng mặc định FE dùng cho
# bước tự thêm (`lsxBuoc.emptyRow`) nên hai đầu không lệch nhau.

# Số giờ làm việc quy ước 1 ngày, dùng quy đổi lead-time phút → ngày. CHƯA đấu `work_calendar`
# (nghỉ lễ/ca kíp) — lát này chỉ cần con số thô để cảnh báo "có nguy cơ trễ hạn giao".
GIO_LAM_MOI_NGAY = 8.0


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _so_luot_chay(comp: dict) -> int:
    """Số lượt tờ chạy qua máy in (1 mặt = 1, in trở = 2).

    Engine chỉ xuất `so_luot` = TỔNG lượt tờ (`to_dau_vao × số mặt`) chứ không xuất số mặt, nên
    chia ngược ra. Lấy nhầm `so_luot` sẽ nhân thời gian chạy lên hàng nghìn lần.
    """
    to_vao = _f(comp.get("to_dau_vao"))
    tong_luot = _f(comp.get("so_luot"))
    if to_vao <= 0 or tong_luot <= 0:
        return 1
    return max(round(tong_luot / to_vao), 1)


def _routing_van_tay(cong_doans) -> list[dict]:
    """Vân tay routing để so "đã đổi so với bài tính giá" — chỉ giữ phần CẤU TRÚC (bước nào, làm
    ở đâu). Cố tình KHÔNG chụp số lượng/thời gian: sửa số là việc thường ngày của kế hoạch, chỉ
    thêm/bớt/đổi-thứ-tự/đổi-thuê-ngoài mới đáng cảnh báo."""
    return [
        {"ten": cd.ten, "nhom": cd.nhom, "loai_buoc": cd.loai_buoc}
        for cd in sorted(cong_doans, key=lambda c: c.thu_tu)
    ]


def khoan_chuan_bi_cua_may(may) -> list[dict]:
    """Các khoản chuẩn bị của máy (đổi kẽm · canh màu · lên giấy · pha mực…) để drawer XỔ CHI TIẾT
    thay vì chỉ hiện một cục tổng. Sống trong `may_thiet_bi.fields_theo_loai['chuan_bi_khoan']`;
    form Máy tự cộng lại rồi ghi tổng vào `makeready_time_default` — cột mà engine đọc."""
    if may is None:
        return []
    rows = (getattr(may, "fields_theo_loai", None) or {}).get("chuan_bi_khoan")
    if not isinstance(rows, list):
        return []
    return [
        {"ten": str(r.get("ten") or ""), "phut": round(_f(r.get("phut")), 2)}
        for r in rows if isinstance(r, dict)
    ]


class _BuocThu:
    """Bản sao CHỈ ĐỌC của một bước, thay vài thuộc tính để tính THỬ.

    Dùng cho `xem_truoc_may`: gán thẳng lên đối tượng ORM thì autoflush ghi luôn xuống DB, trong
    khi người dùng mới chỉ đang so hai máy trên form. Thuộc tính không đè thì đọc từ bước thật.
    """

    def __init__(self, goc, **thay):
        self._goc = goc
        self._thay = thay

    def __getattr__(self, ten):
        thay = object.__getattribute__(self, "_thay")
        if ten in thay:
            return thay[ten]
        return getattr(object.__getattribute__(self, "_goc"), ten)


class _BuocAo:
    """Bước CHƯA LƯU, dựng từ bộ số đang hiện trên drawer — dùng cho `xem_truoc_buoc`.

    Khác `_BuocThu` ở chỗ không có bước gốc nào để đọc ké: người dùng vừa chèn công đoạn, chưa bấm
    "Lưu công đoạn", nên trong DB không có dòng `lsx_cong_doan` tương ứng. Chỉ khai đúng những
    thuộc tính mà `thoi_luong_buoc` + `sl_tinh_cua_buoc` đọc; thiếu cái nào là 0 / None chứ không
    lùi về số của một bước khác.

    `phat_sinh_phut` để 0: bước mới chèn chưa có khoản phát sinh nào, và số ấy cộng THẲNG vào thời
    gian chiếm máy nên đoán bừa là bày sai.
    """

    phat_sinh_phut = 0.0
    department_id = None
    khoan_json: dict | None = None

    def __init__(self, **kw) -> None:
        for k, v in kw.items():
            setattr(self, k, v)


def thoi_luong_buoc(cd, may=None, sl_tinh=None) -> dict:
    """Thời lượng 1 bước, tính TẠI CHỖ (không lưu cột) — nguồn số cho Gantt.

    CÔNG THỨC (chốt 2026-08-04, chỉ áp cho bước loại MÁY)::

        thời lượng = thời gian khác + chuẩn bị (từ MÁY) + SL đầu vào × 60 ÷ tốc độ × số lượt

    Trả về BA con số bằng cách thay `tốc độ` bằng max / trung bình / min của máy:
    - `chiem_may_phut`      — theo tốc độ TRUNG BÌNH → Gantt ĐẶT THANH bằng số này.
    - `chiem_may_phut_min`  — theo tốc độ TỐI ĐA (chạy nhanh nhất ⇒ thời lượng nhỏ nhất).
    - `chiem_may_phut_max`  — theo tốc độ TỐI THIỂU.
    Máy chưa khai min/max thì cả ba bằng nhau (râu co về một điểm) — ĐỪNG vẽ râu 0 như thể
    máy chạy chính xác tuyệt đối, UI phải nói rõ là chưa khai dải.

    `may` là MÁY ĐANG GÁN, đọc SỐNG chứ không dùng snapshot trên bước: tốc độ và chuẩn bị nay
    KẾ THỪA từ module Máy và người kế hoạch KHÔNG sửa được tại bước. Không truyền `may` (hoặc
    bước chưa gán máy) ⇒ tốc độ 0 ⇒ chạy 0 + cảnh báo, chuẩn bị 0.

    Bước TỔ KHÔNG tính gì — nó ĐỌC số người lập kế hoạch gõ (18/09/2026, mg `0319`)::

        thời lượng = thời gian khác + SỐ GIỜ KẾ HOẠCH × 60

    Ba con số bằng nhau (râu co về một điểm): một con số gõ tay không có dải nhanh–chậm. Để 0 là
    HỢP LỆ và KHÔNG có cảnh báo — chủ xưởng 18/09/2026: *"không cần cảnh báo, bản chất nó là số giờ
    kế hoạch, nếu thiếu thì cứ để 0"*.

    ⚠️ Công thức cũ (`SL vào ÷ (năng suất khoán × kíp chuẩn) × 60`) GỠ cùng ngày với tầng đầu việc
    của công đoạn (mg `0320`) và logic kíp (mg `0321`). Nó đòi ba thứ khai trước ở danh mục — năng
    suất người-giờ, kíp chuẩn, cách đo giờ — mà xưởng không khai nổi cho từng việc tay; kết quả là
    mọi bước tổ ra 0 phút kèm một cảnh báo không ai chữa được. Gõ tay một con số thì luôn có số.
    Bước THUÊ NGOÀI = 0 phút, không cảnh báo (spec gia công ngoài §8).

    **`sl_tinh` — SL vào ĐÃ QUY ĐỔI về đơn vị của tốc độ** (15/08/2026), dạng
    `(số, tên đơn vị, câu diễn giải)`. Nơi gọi dựng bằng `LsxService._sl_theo_don_vi`, tức đúng
    cơ chế tiền khoán: cầu quy đổi → công thức của đơn vị.

    - có   ⇒ chia số ĐÃ ĐỔI cho tốc độ. Máy khai `m²/giờ` mà bước đếm tờ thì tờ được quy ra m².
    - None ⇒ **chạy = 0** + `phuong_phap = "chua_quy_doi"` + cảnh báo. KHÔNG lùi về chia số thô:
      chia số tờ cho `500 kg/h` ra con số trông như thật, và số trông-như-thật thì không ai đi kiểm.

    None là mặc định nên MỌI nơi gọi phải truyền — sót một chỗ là bước đó im lặng về 0 phút.
    Sáu nơi gọi trong hệ (lệnh · bài ghép · xếp lịch · kế hoạch vật tư) đều đã nối.

    `sl_tinh` KHÔNG áp cho bước TỔ nữa: giờ của tổ là số gõ tay, chẳng chia cho gì, nên `None` ở
    bước tổ là BÌNH THƯỜNG chứ không phải "quy đổi tịt".

    ĐÃ GỠ khỏi công thức (cột còn trong DB, dormant): `setup_phut` · `chay_phut` (nhập đè) ·
    `di_chuyen_phut` · `ve_sinh_phut`.

    **CHỜ KỸ THUẬT ĐÃ GỠ 13/08/2026** (`cho_phut` — mực khô · keo đông · màng nguội) nên
    `tong_phut == chiem_may_phut`. Hai khoá vẫn tách vì bàn xếp lịch lấy HIỆU của chúng làm độ trễ
    giữa hai bước; hiệu = 0 ⇒ bước sau bắt đầu ngay khi máy nhả tờ.
    """
    canh_bao: list[str] = []
    loai = getattr(cd, "loai_buoc", LB_MAY) or LB_MAY
    # SL đưa vào phép chia là số ĐÃ QUY ĐỔI về đơn vị của tốc độ. `so_luong_vao` thô chỉ còn dùng
    # để hiển thị "bước này nhận bao nhiêu", không tham gia tính giờ nữa.
    vao = _f(sl_tinh[0]) if sl_tinh else 0.0
    dv_tinh = sl_tinh[1] if sl_tinh else None
    quy_doi_dien_giai = sl_tinh[2] if sl_tinh else None
    luot = max(int(getattr(cd, "so_luot_chay", 1) or 1), 1)
    # Bước THUÊ NGOÀI không có thời lượng (spec gia công ngoài §8) — kể cả "thời gian khác".
    khac = 0.0 if loai == LB_THUE_NGOAI else _f(getattr(cd, "phat_sinh_phut", 0))
    gio_ke_hoach = _f(getattr(cd, "so_gio_ke_hoach", 0))

    # THUÊ NGOÀI KHÔNG đi đường máy nữa (26/09/2026): nhà gia công chọn từ danh mục Nhà cung cấp,
    # không còn là "máy giả" trong danh mục Máy — không tốc độ, không chuẩn bị, không lượt.
    theo_may = loai == LB_MAY
    khoan = khoan_chuan_bi_cua_may(may) if theo_may else []
    setup = _f(getattr(may, "makeready_time_default", None)) if (theo_may and may) else 0.0
    may_dung_duoc = may if theo_may else None
    # Bước TỔ không có "năng suất" nào nữa — ô đó và cả dải min/max đã gỡ khỏi bước (mg `0321`).
    ns = _f(getattr(may_dung_duoc, "toc_do", None)) if theo_may else 0.0

    def _chay(toc_do: float) -> float:
        return (vao * 60.0 / toc_do * luot) if toc_do > 0 and vao > 0 else 0.0

    if loai == LB_TO:
        # Giờ của tổ = SỐ GIỜ KẾ HOẠCH người lập lệnh gõ (§5.1). Ba mức bằng nhau: một con số gõ
        # tay không có dải nhanh–chậm, và bịa ra ±x% là dựng một khoảng chẳng ai khai.
        chay = chay_nhanh = chay_cham = gio_ke_hoach * 60.0
        phuong_phap = "to"
    elif loai == LB_THUE_NGOAI:
        # Nhà gia công chạy theo lịch của họ; xưởng không dựng ngày hẹn về (chủ chốt 26/09/2026).
        chay = chay_nhanh = chay_cham = 0.0
        phuong_phap = "thue_ngoai"
    else:
        # Máy chưa khai dải thì min/max rơi về tốc độ TB — ba số bằng nhau, không bịa khoảng.
        toc_do_cao = _f(getattr(may_dung_duoc, "toc_do_max", None)) if may_dung_duoc else 0.0
        toc_do_thap = _f(getattr(may_dung_duoc, "toc_do_min", None)) if may_dung_duoc else 0.0
        chay = _chay(ns)
        chay_nhanh = _chay(toc_do_cao) if toc_do_cao > 0 else chay
        chay_cham = _chay(toc_do_thap) if toc_do_thap > 0 else chay
        phuong_phap = "may" if ns > 0 else "thieu_nang_suat"

    # QUY ĐỔI TỊT thắng mọi lý do khác: có tốc độ mà không biết bước nhận bao nhiêu THEO ĐƠN VỊ ĐÓ
    # thì phép chia vô nghĩa. Nói "chưa quy đổi" chứ đừng nói "chưa khai năng suất" — sai chỗ khai.
    if sl_tinh is None and theo_may:
        chay = chay_nhanh = chay_cham = 0.0
        phuong_phap = "chua_quy_doi"
        canh_bao.append(
            # CHƯA GÁN MÁY là lý do khác hẳn, phải nói khác (09/09/2026). Bước máy chưa có máy thì
            # `sl_tinh_cua_buoc` trả None vì KHÔNG CÓ ĐÍCH để quy về — cả cách đo giờ
            # (`cong_doan_may.cong_thuc_gio`) lẫn tốc độ đều treo ở CẶP (công đoạn × máy). Dán câu
            # "chưa quy đổi" vào ca này là chỉ người dùng đi khai cầu quy đổi trong khi chỉ cần
            # chọn máy — mà khai xong cũng chẳng cứu được gì.
            #
            # Mã `phuong_phap` vẫn giữ `chua_quy_doi`: xếp lịch
            # (`xep_lich_service`) phân nhánh theo mã này, đẻ mã mới là phải sửa cả bên đó cho
            # một câu chữ. Câu là thứ người đọc, mã là thứ máy đọc — chỉ câu cần đổi.
            "Bước chưa gán máy nên chưa biết chạy trên máy nào — chọn máy ở tab Phân công & "
            "Thiết bị. Cách đo giờ chạy và tốc độ đều khai theo cặp (công đoạn × máy)."
            if theo_may and may_dung_duoc is None else
            # Chỉ về ô "Cách đo giờ chạy" chứ không về Đơn vị & quy đổi: màn đó chỉ còn hệ số CỐ
            # ĐỊNH (quy đổi động gỡ 14/08/2026), nên ca hay gặp nhất — bước đếm tờ, máy chạy m²/h —
            # khai ở đó không bao giờ ra số.
            "Chưa đổi được số lượng vào sang đơn vị tốc độ của máy nên không tính được thời gian "
            "chạy. Khai ô \"Cách đo giờ chạy\" của máy này ở Cấu hình danh mục → Công đoạn → "
            "bảng máy của công đoạn."
        )
    elif phuong_phap == "thieu_nang_suat":
        # Chỉ còn bước MÁY vào được nhánh này. Bước TỔ để 0 giờ là hợp lệ, KHÔNG cảnh báo (§5.1).
        canh_bao.append(
            "Máy đang gán chưa khai tốc độ (hoặc bước chưa gán máy) nên không tính được thời gian chạy."
        )

    chiem_may = khac + setup + chay
    tong = chiem_may
    co_dai = round(chay_nhanh, 2) != round(chay_cham, 2)
    dien_giai = {
        "phuong_phap": phuong_phap,
        # `so_luong_vao` ở đây là số ĐÃ QUY ĐỔI (thứ thật sự đem chia), `don_vi_vao` là đơn vị của
        # nó — KHÔNG phải đơn vị bước. Frontend đọc thẳng hai khoá này để bản preview không phải
        # dựng lại phép quy đổi (nó không có bảng cặp trong tay).
        "so_luong_vao": round(vao, 2),
        "don_vi_vao": dv_tinh or getattr(cd, "don_vi_vao", None),
        "so_luong_vao_goc": round(_f(getattr(cd, "so_luong_vao", 0)), 2),
        "don_vi_vao_goc": getattr(cd, "don_vi_vao", None),
        "quy_doi_dien_giai": quy_doi_dien_giai,
        "nguon_nang_suat": {LB_TO: "gio_ke_hoach", LB_THUE_NGOAI: "thue_ngoai"}.get(loai, "may"),
        "nang_suat_co_so": round(ns, 2) if ns > 0 else None,
        "nang_suat_hieu_dung": round(ns, 2) if ns > 0 else None,
        # 06/09/2026: MỌI loại bước đều có số lượt, mặc định 1. Trước đó bước tổ bị ép `None` —
        # nhưng công thức tiền công (chỉ chạy ở bước tổ) cần chip `so_luot_chay` có số thật.
        "so_luot_chay": luot,
        # SỐ GIỜ KẾ HOẠCH của bước tổ — bày ra để drawer dựng lại được đúng phép cộng, và để bảng
        # bóc tách thời gian nói rõ giờ này từ đâu ra (gõ tay, không phải máy tính).
        "so_gio_ke_hoach": round(gio_ke_hoach, 2),
        # Chuẩn bị KẾ THỪA từ máy — kèm chi tiết từng khoản để drawer xổ ra, không hiện cục tổng.
        "setup_phut": round(setup, 2),
        "chuan_bi_khoan": khoan,
        "phat_sinh_phut": round(khac, 2),
        "chay_phut": round(chay, 2),
        "chay_phut_min": round(chay_nhanh, 2),
        "chay_phut_max": round(chay_cham, 2),
        # Ba tốc độ của máy gửi kèm để CLIENT tính lại được y hệt khi người dùng đổi số lượt /
        # thời gian khác (drawer cập nhật ngay, không phải lưu rồi mới thấy). Client KHÔNG tự
        # đi lấy máy — công thức chỉ có một bản, số gốc do server phát.
        "toc_do": round(ns, 2) if ns > 0 else None,
        "toc_do_min": round(_f(getattr(may_dung_duoc, "toc_do_min", None)), 2) if may_dung_duoc else None,
        "toc_do_max": round(_f(getattr(may_dung_duoc, "toc_do_max", None)), 2) if may_dung_duoc else None,
        "co_dai_toc_do": co_dai,
        "chiem_tai_nguyen_phut": round(chiem_may, 2),
        "tong_phut": round(tong, 2),
        "canh_bao": canh_bao,
    }
    return {
        "chay_phut": round(chay, 2),
        "chiem_may_phut": round(chiem_may, 2),
        "chiem_may_phut_min": round(khac + setup + chay_nhanh, 2),
        "chiem_may_phut_max": round(khac + setup + chay_cham, 2),
        "tong_phut": round(tong, 2),
        "dien_giai": dien_giai,
    }


# Nhãn nguồn giấy cho nhật ký (spec 2026-10-24-chuan-bi-giay §7) — cùng chữ với ô "Nguồn giấy" màn lệnh.
_NHAN_NGUON = {"to_in": "Tờ đúng khổ in", "to_nguyen": "Tờ khổ nguyên", "cuon": "Cuộn", "mua": "Mua mới"}


class LsxError(Exception):
    """Lỗi nghiệp vụ LSX (router map sang HTTP)."""


class LsxNotFound(LsxError):
    pass


class LsxValidationError(LsxError):
    pass


class LsxConflict(LsxError):
    pass


def canh_bao_lech_khuon(nguon: str | None, phi: float | None, tinh_trang: str | None) -> str | None:
    """Sale định một đằng, kế hoạch chốt một nẻo → MỘT câu nhắc. KHÔNG chặn.

    Máy chỉ ghi nhận: nó không biết xưởng sẽ báo lại khách hay tự nuốt chi phí, nên nó nói ra chỗ
    lệch rồi để người quyết. Chưa chọn nguồn (phiếu cũ) hoặc chưa trỏ dao → không có gì để so, im.
    """
    if not nguon or not tinh_trang:
        return None
    if nguon == "co_san" and tinh_trang == "dang_dat_lam":
        return "Sale báo dùng khuôn có sẵn, nhưng khuôn của bước này đang đặt làm."
    if nguon == "lam_moi" and tinh_trang == "dang_dung" and float(phi or 0) > 0:
        tien = f"{float(phi or 0):,.0f}".replace(",", ".")
        return f"Sale đã tính {tien} đồng tiền làm khuôn, nhưng bước này dùng khuôn có sẵn."
    return None


class LsxService:
    def __init__(self, db: Session, repo, audit, sequence) -> None:
        self.db = db
        self.repo = repo
        self.audit = audit
        self.sequence = sequence
        self._tram_cache: dict | None = None     # cờ trạm dòng giấy (xem `_tram`)
        self._dv_cache: dict | None = None      # danh mục đơn vị (xem `_don_vis`)
        self._cap_cache: dict | None = None     # đồ thị cặp quy đổi (xem `_cap_quy_doi`)
        self._ma_dv_cache: dict | None = None   # tên đơn vị → mã (xem `_ma_don_vi`)
        self._mon_cache: dict | None = None     # giấy + vật tư đang dùng (xem `_mon_active`)
        self._vt_theo_id_cache: dict | None = None
        self._loai_giay_cache: dict[int, str] | None = None   # id giấy → loại (xem `_loai_giay`)
        # Tổ của máy nạp sẵn cho cả trang (`lsx_tong_quan._den_danh_muc`) — `_soi_danh_muc` đọc
        # thay cho một câu `may_to` mỗi bước. None = tự hỏi theo bước (mở một lệnh).
        self._to_cua_may_nap: dict[int, list[int]] | None = None
        self._vt_theo_id_nguon: dict | None = None
        self._cd_giu: list = []                 # công đoạn đã nạp sẵn (xem `_nap_cd`)

    def _nap_cd(self, ids) -> None:
        """Nạp TRƯỚC các công đoạn (kèm tổ phụ trách · máy · vật tư) bằng vài câu `IN (...)`.

        Mọi vòng bước sau đó gọi `db.get(CongDoan, id)` + đọc `to_mac_dinh_id`/`may_lam_duoc`/
        `vat_tus` đều trúng identity map — không thì mỗi bước tốn 1 + 3 câu SQL, tăng tuyến tính
        theo số bước. Identity map của Session chỉ giữ THAM CHIẾU YẾU nên phải cầm các đối tượng
        trong `_cd_giu` cho tới lần nạp kế tiếp (không giữ thì nạp xong là bị dọn ngay).
        """
        can = {int(i) for i in ids if i}
        if not can:
            self._cd_giu = []
            return
        self._cd_giu = list(self.db.execute(
            select(CongDoan).where(CongDoan.id.in_(can)).options(
                selectinload(CongDoan.to_phu_trach), selectinload(CongDoan.may_lam_duoc),
                selectinload(CongDoan.vat_tus),
            )
        ).scalars())

    # ================= tra cứu phụ trợ =================

    def _tram(self) -> dict[str, str]:
        """Bản đồ `{mã đơn vị: trạm dòng giấy}` — CACHE theo service.

        `tinh_nguoc_routing` chạy một lần mỗi lệnh, mà màn danh sách bung cả trăm lệnh: hỏi lại
        danh mục từng lệnh là đúng bài N+1 đã dính một lần ở màn đơn hàng.
        """
        if self._tram_cache is None:
            self._tram_cache = ban_do_tram(self.db)
        return self._tram_cache

    def _mon_active(self) -> dict[tuple[str, int], object]:
        """Mọi MÓN đang dùng, khoá `(hang_loai, id)` — CACHE theo service, như `_piece_rates`.

        GỘP hai danh mục (08/09/2026): từ khi bước chọn được NVL chính, khối vật tư của bước ăn cả
        `giay_nguyen` lẫn `vat_tu_in_an`. Hỏi rời hai bảng ở ba nơi (`_vat_tu_bung`,
        `_goi_y_luong_vat_tu`, `_soi_danh_muc`) cho MỖI bước là đúng bài N+1 đã dính một lần ở màn
        đơn hàng — cả hai bảng đều vài chục dòng nên nạp trọn một lượt rẻ hơn hẳn.
        """
        if self._mon_cache is None:
            ra: dict[tuple[str, int], object] = {}
            for m in self.db.execute(
                    select(VatTuInAn).where(VatTuInAn.active.is_(True))).scalars():
                ra[(HANG_VAT_TU, m.id)] = m
            for g in self.db.execute(
                    select(GiayNguyen).where(GiayNguyen.active.is_(True))).scalars():
                ra[(HANG_GIAY, g.id)] = g
            self._mon_cache = ra
        return self._mon_cache

    def _loai_giay(self, gid: int) -> str:
        """Loại Giấy/Sóng của mã giấy (kể cả mã đã ngừng dùng) — dựng MỘT lần cho cả service."""
        if self._loai_giay_cache is None:
            self._loai_giay_cache = {int(i): (l or LOAI_GIAY) for i, l in self.db.execute(
                select(GiayNguyen.id, GiayNguyen.loai))}
        return self._loai_giay_cache.get(int(gid), LOAI_GIAY)

    def _vat_tu_theo_id(self) -> dict:
        """`{id: vật tư}` của vật tư đang dùng — dựng MỘT lần cùng `_mon_cache`, không dựng lại mỗi bước."""
        mon = self._mon_active()
        if self._vt_theo_id_cache is None or self._vt_theo_id_nguon is not mon:
            self._vt_theo_id_cache = {i: m for (hl, i), m in mon.items() if hl == HANG_VAT_TU}
            self._vt_theo_id_nguon = mon
        return self._vt_theo_id_cache

    def _vat_tu_active(self) -> list:
        """Chỉ VẬT TƯ KHÁC — đường của ĐẦU VIỆC, vốn không bao giờ khai giấy.

        Giấy tuỳ TỪNG ĐƠN ("chạy sóng" hôm nay ăn kraft, mai ăn duplex) nên không khai trước ở danh
        mục công đoạn được — nó chỉ vào bước qua cửa người lập lệnh tự chọn.
        """
        return [m for (hl, _i), m in self._mon_active().items() if hl == HANG_VAT_TU]

    def _don_vis(self) -> dict:
        if self._dv_cache is None:
            from ..models.don_vi_do import DonViDo

            # KHÔNG lọc `active` — xem `DonViDoRepository.all_rows`. Đơn vị ngừng dùng mà lệnh cũ
            # còn trỏ tới thì `don_vi_map` mất khoá ⇒ đích quy đổi tịt ⇒ thời lượng của lệnh
            # lịch sử hiện RỖNG. Ô chọn lọc ở router, không phải ở bảng tra.
            rows = self.db.execute(select(DonViDo)).scalars()
            self._dv_cache = don_vi_map(list(rows))
        return self._dv_cache

    def _ma_don_vi(self, ten: str) -> str | None:
        """TÊN đơn vị (`"cuốn"`) → MÃ danh mục (`"cuon"`). Nhận cả khi đã là mã sẵn.

        `piece_rates.unit` lưu TÊN vì ô đó chọn từ danh mục theo tên; nhãn năng suất lưu MÃ theo
        khuôn `<mã>_gio`. Cầu nối để không nơi nào phải tự đoán.
        """
        if self._ma_dv_cache is None:
            from ..models.don_vi_do import DonViDo

            # KHÔNG lọc `active`: `piece_rates.unit` lưu TÊN, cầu TÊN→MÃ này là đường DUY NHẤT
            # để lệnh cũ tra ra đơn vị của mình. Đơn vị ngừng dùng mà lọc ở đây là đứt cầu.
            self._ma_dv_cache = {}
            for r in self.db.execute(select(DonViDo)).scalars():
                self._ma_dv_cache[(r.ten or "").strip().lower()] = r.ma
                self._ma_dv_cache[(r.ma or "").strip().lower()] = r.ma
        return self._ma_dv_cache.get((ten or "").strip().lower())

    def _cap_quy_doi(self) -> list:
        """DÒNG cặp quy đổi — nguồn chân lý của mọi phép đổi (bảng `don_vi_quy_doi`).

        Giữ nguyên dòng chứ không dẹp sẵn thành đồ thị: dòng quy đổi động ("1 tờ = định lượng ×
        dài × rộng" kg) chỉ ra hệ số sau khi thay quy cách của chính bước đang tính.
        """
        if self._cap_cache is None:
            from ..repositories.don_vi_do_repo import DonViDoRepository

            self._cap_cache = DonViDoRepository(self.db).cap_rows()
        return self._cap_cache

    def _may_mac_dinh(self, cd_obj, may_phieu: int | None) -> int | None:
        """MÁY điền sẵn cho một bước máy: máy của phiếu tính giá, NHƯNG phải chạy được.

        MỌI bước máy, không riêng bước IN (09/09/2026). Trước đó chỉ nhóm `print` được điền, nên
        một bước như Cắt tờ luôn ra đời với máy trống — mà cả cách đo giờ (`cong_doan_may.
        cong_thuc_gio`) lẫn tốc độ đều treo ở CẶP (công đoạn × máy), nên bảng bóc tách thời gian
        của nó không bao giờ ra số cho tới khi có người vào chọn máy bằng tay. Công đoạn khai đúng
        MỘT máy còn dùng thì không có lựa chọn thứ hai để mà đoán sai — điền luôn.
        `may_phieu` chỉ có nghĩa với bước IN (ô "Máy in" của phiếu); nơi gọi truyền None cho nhóm
        khác chứ hàm này không tự đoán hộ.

        Ô "Máy in" của phiếu tính giá mời HỢP của `may_lam_duoc` trên MỌI công đoạn nhóm In
        (`PhieuTinhGiaDetailView.mayIn`), chứ không riêng công đoạn In mà chính phiếu ấy xếp vào
        routing. Nên máy sale chọn hoàn toàn có thể là máy công đoạn kia khai — chép thẳng xuống
        thì bước sinh ra đã sai từ lúc chào đời: `cong_thuc_gio` treo ở cặp (công đoạn × máy), cặp
        không tồn tại ⇒ thời lượng ra "—" và băng "Danh mục đã đổi" kêu ngay ở lệnh vừa tạo.

        Ba nhánh:
          · Công đoạn CHƯA khai máy nào ⇒ không có gì để đối chiếu, tin phiếu.
          · Phiếu chọn máy nằm trong danh sách ⇒ dùng máy đó.
          · Còn lại (phiếu bỏ trống, hoặc chọn máy công đoạn không nhận) ⇒ MÁY MẶC ĐỊNH của công
            đoạn = máy còn dùng đứng ĐẦU bảng "Máy chạy được công đoạn này" (theo `thu_tu`), cùng
            luật với tổ mặc định (`CongDoan.to_mac_dinh_id`). Trước 12/10/2026 chỉ điền khi công đoạn
            khai đúng MỘT máy — Cắt tờ khai hai máy là bước nào cũng trống máy, phải chọn tay.
        """
        cho_phep = [int(m.may_id) for m in (getattr(cd_obj, "may_lam_duoc", None) or [])
                    if m.may_id is not None]
        if not cho_phep:
            return int(may_phieu) if may_phieu else None
        if may_phieu and int(may_phieu) in cho_phep:
            return int(may_phieu)
        return self.may_dau_con_dung(cho_phep)

    def _to_va_may_mac_dinh(self, cd_obj, may_phieu: int | None,
                            nhom: str | None) -> tuple[int | None, int | None]:
        """(TỔ, MÁY) điền sẵn cho một bước máy — máy thuộc tổ (spec 2026-10-22-may-thuoc-to §4.6).

        Bước IN có máy phiếu nằm trong máy của công đoạn ⇒ máy = máy phiếu, tổ đi theo máy (tổ mặc
        định nếu máy thuộc nó, không thì tổ đầu có máy đó) — ca LSX26-0003: phiếu chọn IN-02 mà bước
        ra đời với tổ 2 màu. Còn lại ⇒ tổ mặc định + máy mặc định CỦA TỔ ĐÓ. Công đoạn chưa tick tổ
        nào ⇒ không ràng buộc, giữ `_may_mac_dinh`.
        """
        from .may_to import may_mac_dinh, rang_buoc_to, to_cho_may

        if cd_obj is None:
            return None, None
        phieu = may_phieu if nhom == "print" else None
        if not rang_buoc_to(cd_obj):
            return cd_obj.to_mac_dinh_id, self._may_mac_dinh(cd_obj, phieu)
        if phieu and int(phieu) in {int(m.may_id) for m in cd_obj.may_lam_duoc}:
            to = to_cho_may(self.db, cd_obj, int(phieu), uu_tien=cd_obj.to_mac_dinh_id)
            if to is not None:
                return to, int(phieu)
        to = cd_obj.to_mac_dinh_id
        return to, may_mac_dinh(self.db, cd_obj, to)

    def may_dau_con_dung(self, may_ids: list[int]) -> int | None:
        """Máy CÒN DÙNG đầu tiên theo đúng thứ tự truyền vào — máy mặc định của công đoạn."""
        return next((mid for mid in may_ids
                     if getattr(self.db.get(MayThietBi, mid), "active", False)), None)

    # ⚠️ `_khoan_mac_dinh()` + `_dau_viec_cua_cong_doan()` GỠ 18/09/2026 (mg `0320`): bước lệnh
    #    thôi chọn đầu việc, nên không còn gì để điền sẵn hay để lọc theo (công đoạn ∩ tổ). Việc
    #    khoán chọn LÚC GHI MẺ ở bàn tổ, lọc theo ĐÚNG MỘT chiều — tổ của bước
    #    (`san_xuat/viec_khoan.danh_sach_cua_to`).

    def _vat_tu_bung(self, cd_obj, buoc, quy_cach: dict | None,
                     dong_nguon: list[tuple[int, dict]] | None = None) -> tuple[list[dict], list[str]]:
        """Vật tư của MỘT BƯỚC, kèm số lượng tính cho ĐÚNG bước này — nền BOM.

        01/10/2026 (spec Đ5): danh sách + chip do PHIẾU TÍNH GIÁ chốt (`dong_nguon` = [(vat_tu_id,
        {mã chip: số})]); `dong_nguon=None` (lệnh không có phiếu, bài ghép, đổi công đoạn) ⇒ lấy danh
        sách vật tư của `cd_obj` trong danh mục với chip rỗng. Định mức tính bằng CÔNG THỨC CỦA CHÍNH
        VẬT TƯ (`vat_tu_in_an.cong_thuc_dinh_muc`) với ngữ cảnh lệnh + `sl_vao`/`sl_ra`/`so_luot_chay`
        của bước + chip. (Trước đó công thức treo ở dòng công đoạn × vật tư, `cong_doan_vat_tu.
        cong_thuc_luong` — nay ngưng đọc.)

        KHÔNG ĐOÁN: chưa khai công thức thì bỏ dòng đó ra khỏi kết quả và trả câu lý do. Chip chưa có
        số mà công thức dùng tới ⇒ trả cảnh báo nêu đúng chip. Trả `([], [])` khi chưa đủ ngữ cảnh.

        Không chặn khi bước chưa có số lượng: công thức nhiều món chẳng đụng `sl_vao`; món nào thật sự
        cần thì `_luong_vat_tu` đã trả "ra 0 — thiếu sl_vao".
        """
        if buoc is None:
            return [], []
        if dong_nguon is None:
            dong_nguon = [(v.vat_tu_id, {})
                          for v in (getattr(cd_obj, "vat_tus", None) or [])] if cd_obj is not None else []
        if not dong_nguon:
            return [], []
        sl = _f(getattr(buoc, "so_luong_vao", 0))
        can = {vid for vid, _ in dong_nguon}
        mats = {i: m for i, m in self._vat_tu_theo_id().items() if i in can}
        # Bơm SỐ CỦA CHÍNH BƯỚC lên trên ngữ cảnh lệnh — `sl_vao`/`sl_ra` chỉ tồn tại ở tầng này.
        # Bơm SAU `ngu_canh_lenh` vì hàm đó assert bộ khoá của nó phải khớp `MA_NGU_CANH_PHIEU`.
        base = {**ngu_canh_lenh(quy_cach or {}), **MAC_DINH_TANG_LENH,
                "sl_vao": sl, "sl_ra": _f(getattr(buoc, "so_luong_ra", 0)),
                "so_luot_chay": float(max(int(getattr(buoc, "so_luot_chay", 1) or 1), 1))}
        ra: list[dict] = []
        canh_bao: list[str] = []
        for vid, chip_val in dong_nguon:
            mat = mats.get(vid)
            if mat is None:
                continue        # đã ngừng dùng — danh mục là nguồn sống
            dvt = (mat.don_vi_gia or "").strip()
            if not dvt:
                canh_bao.append(f"{mat.ten}: chưa chọn đơn vị tính ở danh mục Vật tư khác.")
                continue
            chip_val = dict(chip_val or {})
            ct = mat.cong_thuc_dinh_muc or ""
            dung = set(bien_trong(ct)) if ct.strip() else set()
            ctx = {**base, **{c.ma: _f(chip_val.get(c.ma)) for c in mat.chips}}
            for c in mat.chips:
                if c.ma in dung and _f(chip_val.get(c.ma)) == 0:
                    canh_bao.append(
                        f"{mat.ten}: chip '{c.ten}' chưa có số (nhập ở phiếu tính giá) — tính theo 0.")
            so_luong, dien_giai, ly_do = self._luong_vat_tu(dvt, ctx, mat=mat, cong_thuc=ct)
            if so_luong is None:
                canh_bao.append(f"{mat.ten}: {ly_do}")
                continue
            ra.append({
                # Đường BƯỚC chỉ đẻ ra vật tư khác — giấy vào bước bằng cửa người lập lệnh tự chọn.
                "hang_loai": HANG_VAT_TU,
                "vat_tu_id": mat.id, "ma": mat.ma, "ten": mat.ten, "don_vi": dvt,
                "so_luong": round(so_luong, 3), "dien_giai": dien_giai,
                "gia_tri_chip": chip_val,
            })
        return ra, canh_bao

    def _goi_y_luong_vat_tu(self, buoc, quy_cach: dict | None) -> list[dict]:
        """`[{vat_tu_id, so_luong, dien_giai, ly_do}]` cho MỌI vật tư đang dùng, theo bước này.

        Vì sao server tính hộ (13/08/2026): người kế hoạch chọn "Keo vào gáy" từ dropdown thì số
        phải hiện ra NGAY. Frontend không tự tính được: nó không có công thức, không có bảng quy
        đổi, và cũng không nên có — công thức chỉ được có MỘT bản, ở server.

        Định mức khai theo DÒNG VẬT TƯ của CÔNG ĐOẠN (mg `0316`), nên một món công đoạn không khai
        thì không có công thức nào để gợi ý — trả `so_luong=None` kèm lý do chỉ thẳng chỗ khai. Món
        ĐANG nằm trong danh sách vật tư của công đoạn thì mượn công thức của dòng đó, để chọn lại
        đúng món đã khai vẫn ra số ngay.

        Món chưa tính ra được vẫn CÓ trong danh sách, `so_luong=None` kèm `ly_do` (18/08/2026):
        trước đó nó biến mất im lặng, drawer để ô trống mà không ai biết vì sao — người dùng chỉ
        thấy "chỗ này không tự tính" và đoán là hỏng. Ô vẫn trống để tự gõ, đúng luật "không đoán",
        nhưng câu lý do chỉ thẳng chỗ khai công thức.

        Danh mục vật tư là bảng nhỏ (đơn vị chục dòng) nên quét hết rẻ hơn hẳn đẻ thêm một endpoint
        chỉ để hỏi từng món.
        """
        # Bước chưa có SL vẫn gợi ý — cùng lý do gỡ chặn ở `_vat_tu_bung`: công thức của dòng vật
        # tư có thể chẳng đụng `sl_vao`. Món nào thật sự cần thì xuống dưới ra `ly_do`, ô để trống.
        sl = _f(getattr(buoc, "so_luong_vao", 0))
        # Bơm SỐ CỦA CHÍNH BƯỚC lên trên ngữ cảnh lệnh — `sl_vao`/`sl_ra` chỉ tồn tại ở tầng này.
        # Bơm SAU `ngu_canh_lenh` vì hàm đó assert bộ khoá của nó phải khớp `MA_NGU_CANH_PHIEU`.
        # Ba ô khuôn mặc định 0 — tầng lệnh không có nguồn tương đương phiếu tính giá.
        ctx = {**ngu_canh_lenh(quy_cach or {}), **MAC_DINH_TANG_LENH,
               "sl_vao": sl, "sl_ra": _f(getattr(buoc, "so_luong_ra", 0)),
               "so_luot_chay": float(max(int(getattr(buoc, "so_luot_chay", 1) or 1), 1))}
        # Chip đã nhập của các dòng vật tư ĐANG có ở bước (cùng `vat_tu_id`) — món khác thì chip = 0.
        chip_co_san: dict[int, dict] = {
            v.vat_tu_id: dict(getattr(v, "gia_tri_chip", None) or {})
            for v in (getattr(buoc, "vat_tus", None) or [])
            if getattr(v, "hang_loai", HANG_VAT_TU) == HANG_VAT_TU
        }
        ra: list[dict] = []
        # Giấy không có công thức (spec 2026-10-01 dong-giay-theo-dau-vao §4): số + khổ + đơn vị gốc
        # suy từ ĐẦU VÀO của chính bước, đổi sang đơn vị của từng mã.
        qc_giay = quy_cach or {}
        for (hang_loai, mon_id), mat in self._mon_active().items():
            if hang_loai == HANG_GIAY:
                d = self._dong_giay_cho_ma(buoc, qc_giay, mon_id)
                dien_giai = None
                if d["so_luong"] is not None:
                    # Chỉ nói NGUỒN của số — khổ đã in ngay dưới tên giấy ở ngăn bước, nhắc lại trong
                    # bong bóng là lặp; không nối mẩu bằng dấu chấm giữa.
                    dien_giai = d.get("dien_giai_nguon") or (
                        ("Số tờ và khổ" if d["don_vi_goc"] == DON_VI_TO_KHO
                         else "Số kg") + " lấy theo đầu vào của bước")
                ra.append({
                    "hang_loai": HANG_GIAY, "vat_tu_id": mon_id, "don_vi_goc": d["don_vi_goc"],
                    "so_luong": (round(d["so_luong"], 3) if d["so_luong"] is not None else None),
                    "kho_rong": d["kho_rong"], "kho_dai": d["kho_dai"], "don_vi": d["don_vi"],
                    "dien_giai": dien_giai, "ly_do": d["ly_do"],
                })
                continue
            dvt = (mat.don_vi_gia or "").strip()
            if not dvt:
                continue
            chip_val = chip_co_san.get(mon_id, {})
            ctx_mon = {**ctx, **{c.ma: _f(chip_val.get(c.ma)) for c in mat.chips}}
            so_luong, dien_giai, ly_do = self._luong_vat_tu(
                dvt, ctx_mon, mat=mat, cong_thuc=(mat.cong_thuc_dinh_muc or ""))
            ra.append({
                "hang_loai": hang_loai,
                "vat_tu_id": mon_id,
                "so_luong": None if so_luong is None else round(so_luong, 3),
                "dien_giai": dien_giai,
                "ly_do": ly_do or None,
            })
        return ra

    # `_cach_do` / `_cach_do_lan` GỠ 17/08/2026 cùng cột `don_vi_do.cong_thuc` (mg `0215`).
    # "Cách đo" treo ở ĐƠN VỊ là thứ dùng chung cho mọi ai đếm bằng đơn vị đó, trong khi câu hỏi
    # thật luôn thuộc về một MÓN / MÁY / ĐẦU VIỆC cụ thể — và cả ba nay đều có ô riêng
    # (`cong_thuc_luong` của giấy · vật tư · máy · đầu việc khoán). Đừng dựng lại: mượn-trong-cụm
    # của hàm cũ là chỗ hai đơn vị cùng cụm tranh nhau trả lời.

    def _luong_vat_tu(self, dvt: str, ctx: dict, *, mat=None,
                      cong_thuc: str = "") -> tuple[float | None, str | None, str]:
        """Số lượng một vật tư đo bằng `dvt`. Trả `(số, diễn giải, lý do nếu tịt)`.

        MỘT đường duy nhất: công thức của DÒNG VẬT TƯ của công đoạn
        (`cong_doan_vat_tu.cong_thuc_luong`, mg `0316`) — nơi gọi truyền vào qua `cong_thuc`. Trước
        đó công thức treo ở CHÍNH MÓN HÀNG (`vat_tu_in_an.cong_thuc_luong`), nên
        mọi công đoạn dùng món đó lĩnh chung một con số: cùng "Mực Cyan" mà In khổ 79×109 ăn 1 kg /
        8.000 tờ, In khổ 11×11 ăn 1 kg / 40.000 tờ.

        Đường "quy đổi từ đơn vị của BƯỚC sang đơn vị vật tư" (BFS trên cầu quy đổi) GỠ 18/08/2026.
        Cầu quy đổi chỉ được chở quan hệ BẤT BIẾN (`1 ram = 500 tờ`, `1 tấn = 1.000 kg`). Còn "một
        tờ ăn mấy kg keo / mấy m² màng" thì đổi theo từng món và từng quy cách — hỏi cầu quy đổi câu
        đó là ép người dùng khai một cạnh sai bản chất, rồi MỌI món cùng đo bằng `kg` lĩnh chung một
        đáp án. Đúng thứ ô `cong_thuc_luong` sinh ra để thay.

        KHÔNG có ngoại lệ cho ca "trùng đơn vị" (bước đo `m²`, màng đo `m²`): trùng đơn vị KHÔNG có
        nghĩa là 1 m² chạy máy ăn đúng 1 m² màng — vẫn còn bù hao, còn phần không phủ. Một luật gọn
        (mọi món đều phải khai) dễ nhớ hơn hẳn một luật có ngoại lệ mà không ai đoán được lúc nào nó
        bật. Đo trước khi gỡ: 0/5 dòng vật tư đang sống nhờ đường này.

        KHÔNG ĐOÁN: chưa khai thì trả lý do kèm chỗ khai, drawer để ô trống cho người kế hoạch.
        """
        ten = getattr(mat, "ten", None) or dvt
        dv_ten = (self._don_vis().get(dvt.strip().lower()) or {}).get("ten") or dvt
        rieng = (cong_thuc or "").strip()
        # Giấy không đi qua đây — xem `dong_giay_theo_dau_vao` (dòng giấy dẫn xuất từ đầu vào của bước).
        if not rieng:
            return None, None, (
                f"chưa khai công thức định mức. Mở danh mục Vật tư khác → “{ten}” → tab "
                f"“Công thức định mức” (ra {dv_ten}).")
        try:
            gt = float(safe_eval(rieng, dict(ctx)))
        except (ValueError, ZeroDivisionError) as e:
            return None, None, f"công thức lượng không chạy được ({e})."
        if gt <= 0:
            thieu = [b for b in bien_trong(rieng) if _f(ctx.get(b)) <= 0]
            return None, None, (
                f"công thức lượng ra 0 — thiếu {', '.join(thieu)}." if thieu
                else "công thức lượng ra 0.")
        # Cùng khuôn diễn giải với `_sl_theo_don_vi`: công thức chữ = thay số = kết quả.
        # Chip RIÊNG của vật tư không nằm trong từ điển biến chung nên hai hàm trên để nguyên mã
        # (`dai_support × rong_support = dai_support × rong_support`) — tự đọc nhãn + thay số ở đây.
        chu = cong_thuc_chu(rieng)
        the_so = cong_thuc_the_so(rieng, ctx)
        for c in sorted(getattr(mat, "chips", None) or [], key=lambda x: -len(x.ma)):
            mau = rf"\b{re.escape(c.ma)}\b"
            chu = re.sub(mau, lambda _m, t=c.ten: t, chu)
            the_so = re.sub(mau, lambda _m, v=_so_vn(_f(ctx.get(c.ma))): v, the_so)
        dau = "" if the_so == _so_vn(gt) else f"{the_so} = "
        return gt, f"{chu} = {dau}{_so_vn(gt)} {dv_ten}", ""

    # ⚠️ `_dau_viec_option_dicts()` · `dau_viec_options()` · `_khoan_thu()` GỠ 18/09/2026 (mg
    #    `0320`): cả ba chỉ phục vụ ô "Đầu việc thợ làm" của drawer bước, nay đã biến. Vật tư của
    #    bước bung từ CÔNG ĐOẠN (`_bung_vat_tu_cong_doan`) nên không cần đi kèm từng lựa chọn nữa.

    def xem_truoc_buoc(
        self, *, lsx_id: int, step_key: str, may_id: int | None,
        loai_buoc: str | None = None, so_luot_chay: int | None = None,
        so_gio_ke_hoach: float | None = None,
        so_luong_vao: float | None = None, so_luong_ra: float | None = None,
        cong_doan_id: int | None = None, don_vi_vao: str | None = None,
    ) -> dict:
        """Giờ chạy của MỘT bước theo ĐÚNG những gì đang hiện trên form — KHÔNG ghi DB.

        Vì sao drawer phải hỏi server (chủ chốt 20/08/2026 — *"chọn máy thì thời gian không thay
        đổi, phải nhấn Lưu mới đổi"*): số đem chia cho tốc độ không phải số tờ thô mà là SL vào ĐÃ
        QUY ĐỔI về đơn vị ĐÍCH của bước (`sl_tinh_cua_buoc`) — Yawa 1050 đo bằng `kem_gio` và còn
        có công thức riêng `so_kem`. Cầu quy đổi và bộ chạy công thức chỉ có ở server, nên client
        đành xài lại con số của LẦN LƯU TRƯỚC nếu không hỏi.

        Ba tham số đè thêm — vắng cái nào thì lấy theo bản đã lưu, nên caller cũ vẫn chạy y như trước:
          · `loai_buoc` — Máy quy đổi SL vào sang đơn vị tốc độ của máy, Tổ thì KHÔNG quy đổi gì
            (giờ là số gõ tay). Bấm Máy→Tổ mà không hỏi lại thì câu quy đổi CỦA MÁY nằm nguyên
            dưới nhãn "Tổ";
          · `so_luot_chay` — chip dùng được trong ô đo giờ của máy (`sl_ra * so_luot_chay`);
          · `so_gio_ke_hoach` — số giờ người lập lệnh vừa gõ cho bước TỔ (§5.1). Nhận đè vì nó là
            TOÀN BỘ giờ chạy của bước tổ: không đè thì xem trước bày số của lần lưu trước;
          · `so_luong_vao` / `so_luong_ra` — hai ô "Dòng chảy số lượng" người dùng đang gõ, vào
            THẲNG hai chip `sl_vao` / `sl_ra` của cách đo giờ (20/09/2026). Trước đó cửa này không
            nhận chúng: máy khai đo bằng `sl_ra` mà số ra mới gõ không được gửi lên, nên engine
            chạy công thức với số ra của LẦN LƯU TRƯỚC — số đó là 0 thì bậc công thức riêng bị bỏ
            (luật `gt <= 0` của `_ct_rieng`), engine tụt xuống cầu quy đổi từ SL VÀO rồi báo "chưa
            quy đổi được" trong khi cặp (công đoạn × máy) đã khai cách đo đầy đủ. Ô trống = 0.
          · `cong_doan_id` / `don_vi_vao` — chỉ dùng cho bước CHƯA LƯU (xem dưới).

        Bước chưa lưu cũng tính được (20/09/2026): người dùng vừa chèn "Cắt cuộn", gõ số ra, mở tab
        Tiến độ — trước đây màn không hỏi cửa này vì bước chưa có trong DB, nên tab bày 0′ kèm đúng
        câu "chưa quy đổi". Không tìm thấy `step_key` trong lệnh thì dựng bước ẢO từ tham số gửi
        lên; `cong_doan_id` là thứ bắt buộc vì cách đo giờ treo ở CẶP (công đoạn × máy).

        ⚠️ `piece_rate_id` GỠ 18/09/2026 (mg `0320`) — bước thôi chọn đầu việc.
        """
        lsx = self.get(lsx_id)
        cd = next((r for r in lsx.cong_doans if r.step_key == step_key), None)
        if cd is None and not cong_doan_id:
            raise LsxNotFound("Không tìm thấy bước trong lệnh")
        may = self.db.get(MayThietBi, may_id) if may_id else None
        if may_id and may is None:
            raise LsxNotFound("Không tìm thấy máy")
        # Bản SAO ĐỌC của bước: KHÔNG gán `cd.may_id = ...` — gán vào ORM là autoflush ghi thẳng
        # xuống DB một lựa chọn người dùng mới chỉ rê chuột qua.
        thay: dict = {"may_id": may_id}
        if loai_buoc:
            thay["loai_buoc"] = loai_buoc
        if so_luot_chay is not None:
            thay["so_luot_chay"] = max(int(so_luot_chay), 1)
        if so_gio_ke_hoach is not None:
            thay["so_gio_ke_hoach"] = max(float(so_gio_ke_hoach), 0.0)
        # Ô trống = 0, KHÔNG phải "giữ số đã lưu": người dùng xoá số ra thì giờ chạy phải về 0 ngay,
        # chứ không được âm thầm tính bằng số cũ. Router đã đổi ô trống thành 0 trước khi tới đây.
        if so_luong_vao is not None:
            thay["so_luong_vao"] = max(float(so_luong_vao), 0.0)
        if so_luong_ra is not None:
            thay["so_luong_ra"] = max(float(so_luong_ra), 0.0)
        if cd is None:
            thu = _BuocAo(
                cong_doan_id=cong_doan_id,
                don_vi_vao=don_vi_vao,
                so_luong_vao=thay.get("so_luong_vao", 0.0),
                so_luong_ra=thay.get("so_luong_ra", 0.0),
                loai_buoc=thay.get("loai_buoc") or LB_MAY,
                may_id=may_id,
                so_luot_chay=thay.get("so_luot_chay", 1),
                so_gio_ke_hoach=thay.get("so_gio_ke_hoach", 0.0),
            )
        else:
            thu = _BuocThu(cd, **thay)
        quy_cach = quy_cach_bien(lsx)
        t = thoi_luong_buoc(thu, may, self.sl_tinh_cua_buoc(thu, may, quy_cach))
        return {
            "step_key": step_key,
            "may_id": may_id,
            "chiem_may_phut": t["chiem_may_phut"],
            "thoi_luong_dien_giai": t["dien_giai"],
        }

    def _ct_gio_cua_may(self, cong_doan_id, may_id) -> str:
        """Công thức GIỜ CHẠY của cặp (công đoạn, máy) — `""` khi cặp chưa khai.

        Nhớ lại trong `_ct_gio_cache` vì `sl_tinh_cua_buoc` bị gọi cho TỪNG bước trong vòng lặp của
        bốn service ngoài (bài ghép · xếp lịch · kế hoạch vật tư); hỏi DB mỗi bước là N+1.
        """
        if not cong_doan_id or not may_id:
            return ""
        khoa = (int(cong_doan_id), int(may_id))
        if not hasattr(self, "_ct_gio_cache"):
            self._ct_gio_cache: dict[tuple[int, int], str] = {}
        if khoa not in self._ct_gio_cache:
            ct = self.db.execute(
                select(CongDoanMay.cong_thuc_gio).where(
                    CongDoanMay.cong_doan_id == khoa[0], CongDoanMay.may_id == khoa[1])
            ).scalar()
            self._ct_gio_cache[khoa] = (ct or "").strip()
        return self._ct_gio_cache[khoa]

    def nap_ct_gio(self, cap) -> None:
        """Nạp sẵn `_ct_gio_cua_may` cho cả lô cặp `(cong_doan_id, may_id)` — MỘT truy vấn.

        Nhớ lại theo cặp chỉ chặn hỏi LẠI; lượt đầu vẫn là một câu mỗi cặp. Cột Trạng thái của màn
        Máy trải mọi lệnh đã xếp nên số câu chạy theo số máy khác nhau trong lịch (đo dev
        14/09/2026: 11 câu `cong_doan_may` cho 2 lệnh). Service ngoài có cả routing trong tay thì
        gọi hàm này TRƯỚC vòng lặp. Cặp chưa khai nhận `""`, y như `_ct_gio_cua_may`.
        """
        if not hasattr(self, "_ct_gio_cache"):
            self._ct_gio_cache = {}
        thieu = {(int(a), int(b)) for a, b in cap if a and b} - self._ct_gio_cache.keys()
        if not thieu:
            return
        rows = self.db.execute(
            select(CongDoanMay.cong_doan_id, CongDoanMay.may_id, CongDoanMay.cong_thuc_gio).where(
                CongDoanMay.cong_doan_id.in_(sorted({a for a, _ in thieu})),
                CongDoanMay.may_id.in_(sorted({b for _, b in thieu})),
            )
        ).all()
        for cd_id, may_id, ct in rows:
            if (cd_id, may_id) in thieu:
                self._ct_gio_cache[(cd_id, may_id)] = (ct or "").strip()
        for khoa in thieu:
            self._ct_gio_cache.setdefault(khoa, "")

    def sl_tinh_cua_buoc(self, cd, may, quy_cach: dict | None) -> tuple[float, str, str] | None:
        """SL vào của bước quy về đơn vị của TỐC ĐỘ — đầu vào `sl_tinh` của `thoi_luong_buoc`.

        Đích: bước MÁY → đơn vị TỐC ĐỘ của máy đang gán. Bước THUÊ NGOÀI và bước TỔ trả `None`.

        Public vì bốn service ngoài (bài ghép · xếp lịch · kế hoạch vật tư) phải dựng cùng một số —
        mỗi nơi tự suy đích là mở đường cho Gantt và drawer lệch nhau.
        """
        loai = getattr(cd, "loai_buoc", LB_MAY) or LB_MAY
        if loai == LB_MAY:
            dich = ma_don_vi_toc_do(may)
            # 06/09/2026: cách đo lấy từ cặp (CÔNG ĐOẠN × MÁY), không còn từ `may.cong_thuc_luong`.
            # Cùng một máy chạy hai công đoạn thì đo khác nhau — In khổ 79×109 và In khổ 11×11
            # không thể chung một công thức. Đọc SỐNG (không ghim): đổi máy là đổi cách đo.
            ct_rieng = self._ct_gio_cua_may(
                getattr(cd, "cong_doan_id", None), getattr(may, "id", None))
        else:
            return None
        return self._sl_theo_don_vi(cd, dich, quy_cach, ct_rieng=ct_rieng) if dich else None

    def _sl_theo_don_vi(self, cd, dv_dich: str | None,
                        quy_cach: dict | None, *,
                        ct_rieng: str = "") -> tuple[float, str, str] | None:
        """SL VÀO của bước quy về `dv_dich`. Trả `(số, tên đơn vị, câu diễn giải)` — None nếu tịt.

        Đường đi của THỜI LƯỢNG (chủ chốt 15/08/2026):

            SL vào → đơn vị TỐC ĐỘ / NĂNG SUẤT → ÷ tốc độ → phút

        Trước 11/09/2026 tiền khoán cũng đi qua đây (SL vào → đơn vị ĐƠN GIÁ → × đơn giá). Nay sản
        xuất chỉ ghi số lượng nên chỉ còn một khách duy nhất: phép đo giờ.

        HAI đường, theo đúng thứ tự RIÊNG → CHUNG (cùng luật với `_luong_vat_tu`):
          ⓿ `ct_rieng` — công thức của CHÍNH cặp việc-và-nơi-làm: `cong_doan_may.cong_thuc_gio` cho
             bước máy (06/09/2026, trước đó là `may_thiet_bi.cong_thuc_luong`),
             `khoan_json["cong_thuc_gio"]` (ảnh chụp của đầu việc) cho bước tổ. Riêng nhất nên
             thắng: lượt in của máy 5 màu khác máy 2 màu, mà cả hai cùng đo bằng `to_gio`.
          ① `doi_theo_quy_cach` — cầu quy đổi đã khai (kể cả đi vòng qua trung gian).

        Bậc "công thức của ĐƠN VỊ ĐÍCH" GỠ 17/08/2026 (mg `0215`) — bậc ⓿ thay đúng chỗ nó: cùng bộ
        chip `sl_vao`/`sl_ra`, nhưng khai trên chính cái máy / đầu việc cần nó thay vì trên đơn vị
        dùng chung.

        Tịt cả hai ⇒ None. Nơi gọi tự quyết, hàm này KHÔNG đoán và KHÔNG lùi về số thô.

        ⚠️ Công thức riêng ra thẳng số theo `dv_dich` — KHÔNG quy đổi tiếp. Nó được khai ĐỂ trả lời
        đúng câu "bằng bao nhiêu <đơn vị đích>", nên nhân thêm một hệ số nào nữa là tính hai lần.

        Đừng chép phép đổi này ra chỗ khác: hai bản chép tay là hai cơ hội lệch, mà lệch giữa hai
        màn cùng đọc thời lượng của một bước thì không ai soi ra.
        """
        ma_dich = (self._don_vis().get(str(dv_dich or "").strip().lower()) or {}).get("ma")
        if not ma_dich:
            return None
        sl = _f(cd.so_luong_vao)
        ten_dich = (self._don_vis().get(ma_dich) or {}).get("ten") or ma_dich

        # ⓿ công thức RIÊNG của máy / của đầu việc khoán.
        #
        # Ra 0 (hoặc không chạy được) thì RƠI XUỐNG hai đường sau chứ không tịt hẳn: công thức
        # thiếu biến là chuyện của một lệnh cụ thể (chưa khai số màu, chưa có khổ), mà cầu quy
        # đổi vẫn có thể trả lời được. Tịt luôn ở đây là làm mất số giờ vốn đang tính ra.
        if (r0 := self._ct_rieng(cd, ct_rieng, quy_cach)) is not None:
            gt0, chu0, the_so0 = r0
            dau0 = "" if the_so0 == _so_vn(gt0) else f"{the_so0} = "
            return gt0, ten_dich, f"{chu0} = {dau0}{_so_vn(gt0)} {ten_dich}"

        # ① cầu quy đổi. Cùng đơn vị cũng đi lối này (`doi` trả thẳng, hệ số 1).
        #
        # ĐẦU NGUỒN của phép đổi là `don_vi_vao` của BƯỚC. Bước NGOÀI dòng giấy (ghi kẽm) để trống ở
        # danh mục, nên ô này chỉ có khi người lập lệnh tự khai ở bước (`tu_khai_don_vi`); chưa
        # khai thì tịt ⇒ 0 phút chạy, xếp lịch bày "chưa quy đổi được". Lối lùi về đơn vị sản lượng
        # của công đoạn GỠ 18/09/2026 cùng cột ấy (mg `0324`).
        kq = doi_theo_quy_cach(sl, cd.don_vi_vao, ma_dich, quy_cach or {},
                               self._don_vis(), self._cap_quy_doi())
        if "gia_tri" in kq:
            return float(kq["gia_tri"]), kq["don_vi"], kq["dien_giai"]
        return None

    def _ct_rieng(self, cd, ct: str, quy_cach: dict | None) -> tuple[float, str, str] | None:
        """Chạy công thức RIÊNG của bước → `(giá trị, công thức bằng chữ, công thức đã thế số)`.

        Tách khỏi `_sl_theo_don_vi` ngày 08/09/2026 vì lúc ấy có nơi thứ hai cần ĐÚNG bộ ngữ cảnh và
        đúng cách thế số này mà KHÔNG quy đổi gì cả (công thức tiền công ra thẳng tiền). Nơi ấy đã
        gỡ 11/09/2026 cùng tiền khoán; hàm vẫn đứng riêng vì đọc được một mình, và bậc ⓿ của
        `_sl_theo_don_vi` gọi nó.

        Trả `None` khi công thức rỗng, chạy lỗi, hoặc ra ≤ 0 — nơi gọi tự quyết đi tiếp hay tịt.
        Chỉ trả nguyên liệu, KHÔNG ghép câu: nơi gọi tự đóng nhãn đuôi.

        Chip `don_gia_khoan` vẫn nằm trong ngữ cảnh nhưng LUÔN 0 (`MAC_DINH_TANG_LENH`): ô "Cách đo
        giờ chạy" dùng chung bộ chip nên gõ tay được, và gõ tay thì phải ra 0 chứ không NameError.
        """
        if not (ct := (ct or "").strip()):
            return None
        ctx = {**ngu_canh_lenh(quy_cach or {}), **MAC_DINH_TANG_LENH,
               "sl_vao": _f(cd.so_luong_vao), "sl_ra": _f(cd.so_luong_ra),
               "so_luot_chay": float(max(int(getattr(cd, "so_luot_chay", 1) or 1), 1))}
        try:
            gt = float(safe_eval(ct, dict(ctx)))
        except (ValueError, ZeroDivisionError):
            return None
        if gt <= 0:
            return None
        return gt, cong_thuc_chu(ct), cong_thuc_the_so(ct, ctx)

    def _customer_name(self, order: Order) -> str | None:
        if not order.customer_id:
            return None
        c = self.db.get(Customer, order.customer_id)
        return c.name if c else None

    def _customer_names(self, ids: set[int]) -> dict[int, str]:
        """customer_id → tên, MỘT truy vấn cho cả danh sách.

        `_customer_name` ở trên tra từng đơn một; gọi nó trong vòng lặp dựng bảng là N+1 — với
        100.000 lệnh thì đó là 100.000 lượt `SELECT`. Danh sách/hàng chờ phải dùng hàm này.
        """
        if not ids:
            return {}
        rows = self.db.execute(select(Customer.id, Customer.name).where(Customer.id.in_(ids))).all()
        return {i: n for i, n in rows}

    def _user_names(self, ids: set[int]) -> dict[int, str]:
        """user_id → tên hiển thị, MỘT truy vấn (bản gộp của `_user_name`, xem lý do ở trên)."""
        if not ids:
            return {}
        rows = self.db.execute(select(User.id, User.name, User.username).where(User.id.in_(ids))).all()
        return {i: (n or u) for i, n, u in rows}

    def _user_name(self, user_id: int | None) -> str | None:
        if not user_id:
            return None
        u = self.db.get(User, user_id)
        return (u.name or u.username) if u else None

    def _dept_names(self, ids: set[int]) -> dict[int, str]:
        from ..models.department import Department

        if not ids:
            return {}
        rows = self.db.execute(select(Department.id, Department.name).where(Department.id.in_(ids))).all()
        return {i: n for i, n in rows}

    def _may_names(self, ids: set[int]) -> dict[int, str]:
        if not ids:
            return {}
        rows = self.db.execute(
            select(MayThietBi.id, MayThietBi.ten).where(MayThietBi.id.in_(ids))
        ).all()
        return {i: n for i, n in rows}

    def khuon_chon_duoc(self, lsx: Lsx, *, loai: str | None, dang_chon: int | None) -> list[dict]:
        """Dao mà bước của lệnh này CHỌN ĐƯỢC — đã lọc sẵn hai chiều: khách của lệnh + loại của bước.

        Vì sao có endpoint riêng thay vì gọi danh mục Khuôn rồi lọc: (1) lọc ở client là điều chủ
        dự án đã bác thẳng một lần; (2) nền chung của 10 màn danh mục chỉ nhận ĐÚNG MỘT bộ lọc
        riêng (`loc`), nới nó ra cho một màn là sửa nền của cả 10.

        Lọc theo khách là thứ làm nhánh "dùng dao có sẵn" DÙNG ĐƯỢC: kho vài trăm dao mà bày hết
        thì người ta tìm không ra, bấm "làm dao mới", rồi đặt lại con dao đã có — mất tiền thật.

        `dang_chon` LUÔN được giữ trong danh sách dù không khớp bộ lọc: dao đã gán từ trước có thể
        khai thiếu loại/khách, mà rơi khỏi danh sách thì ô chọn nhảy về rỗng và cú Lưu kế tiếp gỡ
        mất dao của bước — đúng bẫy đã gặp ở ô chọn khuôn đời cũ.
        """
        from ..models.khuon_be import KhuonBe

        order = self.db.get(Order, lsx.order_id) if lsx.order_id else None
        khach_id = getattr(order, "customer_id", None) if order else None

        dk = [KhuonBe.active.is_(True)]
        if khach_id:
            dk.append(KhuonBe.khach_hang_id == khach_id)
        if loai:
            dk.append(KhuonBe.loai == loai)
        rows = list(self.db.execute(
            select(KhuonBe).where(*dk).order_by(KhuonBe.ma)
        ).scalars())
        if dang_chon and not any(k.id == dang_chon for k in rows):
            if (cu := self.db.get(KhuonBe, dang_chon)) is not None:
                rows.insert(0, cu)
        return [
            # `loai` phải trả về: màn lọc tiếp theo loại của TỪNG BƯỚC trên danh sách đã rút gọn
            # này (một lệnh có thể vừa có bước bế vừa có bước ép nhũ), nên nạp một lần dùng chung.
            {"id": k.id, "ma": k.ma, "ten": k.ten, "loai": k.loai, "so_ke": k.so_ke,
             "tinh_trang": k.tinh_trang}
            for k in rows
        ]

    def tao_khuon_cho_lenh(self, lsx: Lsx, *, ten: str, loai: str | None, actor) -> dict:
        """Nhánh "làm dao mới": đẻ một dòng trong danh mục Khuôn ở tình trạng `dang_dat_lam`.

        KHÁCH lấy từ chính lệnh, LOẠI lấy từ cờ của bước — không hỏi lại người dùng thứ hệ thống
        đã biết. Đó là toàn bộ lý do nhánh này nằm ở đây chứ không bắt họ mở màn Khuôn khai tay
        rồi quay lại chọn: ba lần chuyển màn cho một việc là ba lần người ta bỏ dở.

        Dựng qua `KhuonBeService` chứ không `db.add` thẳng: service giữ luật riêng của danh mục
        (sinh mã KB-####) và ghi nhật ký — bỏ qua nó là dao mới lọt vào kho không mã, không vết.

        KHÔNG hỏi ngày dự kiến có dao (mg `0293` gỡ `ngay_ve_du_kien`): ô đó chỉ bắt người lập lệnh
        đoán một ngày mà không phép tính nào đọc. `dang_dat_lam` đã chặn bước.
        """
        from ..repositories.khuon_be_repo import KhuonBeRepository
        from ..services.khuon_be_service import KhuonBeService

        order = self.db.get(Order, lsx.order_id) if lsx.order_id else None
        svc = KhuonBeService(KhuonBeRepository(self.db), self.audit)
        k = svc.create(
            {
                "ten": ten,
                "loai": loai,
                "khach_hang_id": getattr(order, "customer_id", None) if order else None,
                "tinh_trang": "dang_dat_lam",
            },
            getattr(actor, "id", None),
        )
        return {"id": k.id, "ma": k.ma, "ten": k.ten, "loai": k.loai, "so_ke": k.so_ke,
                "tinh_trang": k.tinh_trang}

    def _khuon_map(self, ids: set[int]) -> dict[int, dict]:
        """Dao của các bước — nạp LÔ, không tra từng bước (routing 10 bước = 10 query thừa).

        Trả đủ thứ bước cần bày cho thợ: mã · tên ấn phẩm · SỐ KỆ (thứ thợ thật sự cần để đi lấy)
        · tình trạng.
        """
        from ..models.khuon_be import KhuonBe

        ids = {int(i) for i in ids if i}
        if not ids:
            return {}
        rows = self.db.execute(select(KhuonBe).where(KhuonBe.id.in_(ids))).scalars()
        return {
            k.id: {
                "khuon_be_ma": k.ma,
                "khuon_be_ten": k.ten,
                "khuon_be_so_ke": k.so_ke,
                "khuon_be_tinh_trang": k.tinh_trang,
            }
            for k in rows
        }

    def _thanh_phan(self, tp_id: int | None) -> PhieuThanhPhan | None:
        if not tp_id:
            return None
        return self.db.execute(
            select(PhieuThanhPhan)
            .where(PhieuThanhPhan.id == tp_id)
            .options(
                selectinload(PhieuThanhPhan.thanh_phams).selectinload(PhieuThanhPham.vat_tus),
            )
        ).scalar_one_or_none()

    # ================= HÀNG CHỜ =================

    def hang_cho(self, *, page: int = 1, size: int = 50,
                 chi_dem: bool = False, **loc) -> tuple[list[dict], int]:
        """`(đơn của TRANG này, TỔNG số đơn còn nợ lệnh)`.

        Điều kiện "còn dòng chưa lên lệnh" đã chuyển xuống SQL (`repo.orders_ban_giao`) — ở đây
        chỉ còn đếm để HIỆN "x/y dòng đã lên lệnh". `chi_dem` ⇒ chỉ đếm (badge menu): `([], total)`,
        không nạp dòng đơn / tên khách / tên sale.
        """
        # `loc` = thanh lọc của hàng chờ (06/10/2026): `customer_id`, `tu_ngay`/`den_ngay`/`moc`,
        # cộng `owner_ids` — phạm vi theo chủ đơn (14/10/2026).
        orders, total = self.repo.orders_ban_giao(page=page, size=size, chi_dem=chi_dem, **loc)
        if not orders:
            return [], total
        line_ids = [ln.id for o in orders for ln in o.lines]
        da_co = self.repo.by_order_lines(line_ids)
        khach = self._customer_names({o.customer_id for o in orders if o.customer_id})
        nguoi = self._user_names({o.sale_user_id for o in orders if o.sale_user_id})
        out: list[dict] = []
        for o in orders:
            so_dong = len(o.lines)
            so_co = sum(1 for ln in o.lines if ln.id in da_co)
            # Tóm tắt tên các sản phẩm/hạng mục trong đơn (OrderLine.description)
            sp_names = list(dict.fromkeys((ln.description or "").strip() for ln in o.lines if (ln.description or "").strip()))
            san_pham_tom_tat = ", ".join(sp_names) if sp_names else None
            out.append({
                "order_id": o.id,
                "order_no": o.order_no,
                "customer_name": khach.get(o.customer_id),
                "sale_name": nguoi.get(o.sale_user_id),
                "delivery_committed_date": o.delivery_committed_date,
                "is_rush": bool(o.is_rush),
                "production_note": o.production_note,
                "san_xuat_released_at": o.san_xuat_released_at,
                "created_at": o.created_at,
                "so_dong": so_dong,
                "so_dong_co_lsx": so_co,
                "san_pham_tom_tat": san_pham_tom_tat,
            })
        return out, total

    # ================= tính số cho 1 dòng đơn =================

    def _tinh_dong(self, line: OrderLine, tp: PhieuThanhPhan | None) -> dict:
        """Chạy engine (hàm thuần) cho 1 dòng đơn với SL CỦA ĐƠN → số tờ / bù hao / kẽm / lượt.

        Trả `{comp, quy_cach, routing, sl_ptg}`. `tp=None` (đơn nhập giá tay) → số 0, routing rỗng.
        """
        qty = int(line.qty or 0)
        if tp is None:
            return {"comp": {}, "quy_cach": None, "routing": [], "sl_ptg": None}

        self._nap_cd(r.cong_doan_id for r in tp.thanh_phams)
        resolved = _resolve_thanh_phan(self.db, tp)
        sl_ptg = int(resolved.get("so_luong") or 0)
        # ÉP số lượng theo ĐƠN: engine ưu tiên `tp["so_luong"]` nếu > 0, nên phải ghi đè.
        resolved["so_luong"] = qty
        result = compute_phieu(so_luong=qty, thanh_phans=[resolved])
        comps = result.get("meta", {}).get("components") or []
        comp = comps[0] if comps else {}

        # QUY CÁCH = KẾ THỪA TRỌN từ bài tính giá: chép NGUYÊN cụm trường của sản phẩm thay vì
        # liệt kê tay — thêm trường mới ở phiếu tính giá là lệnh nhận được ngay, không phải nhớ
        # sửa thêm chỗ này (đó là lý do màu pha / bleed / khe cắt / máy từng bị rơi mất).
        # Chỉ BỎ tiền và dữ liệu lồng: lệnh xuống xưởng không mang giá vốn.
        quy_cach = {
            k: v
            for k, v in resolved.items()
            if k not in _QC_BO_QUA and not isinstance(v, (list, dict))
        }
        quy_cach.update({
            "giay_ten": resolved.get("giay_ten") or resolved.get("kho_nguyen"),
            "kho_nguyen_dai": resolved.get("kho_dai") or resolved.get("kho_nguyen_dai"),
            "kho_nguyen_rong": resolved.get("kho_rong") or resolved.get("kho_nguyen_rong"),
            # Nhãn nhóm + ghi chú kỹ thuật không nằm trong bộ field engine → lấy thẳng từ ORM.
            "nhom_bao_gia": getattr(tp, "nhom_bao_gia", None),
            "ghi_chu_ky_thuat": getattr(tp, "ghi_chu_ky_thuat", None),
            # Vật tư in ấn (mực · màng · keo): tên + lượng, KHÔNG kèm đơn giá. Giấy của bước là NVL
            # chính, màn lệnh kể ở ô "Giấy" — để lọt vào đây là xếp giấy thành "vật tư khác".
            "vat_tus": [
                {"ten": vt.get("ten"), "so_luong": None}
                for row in (resolved.get("thanh_phams") or [])
                for vt in (row.get("vat_tus") or [])
                if vt.get("hang_loai") != "giay"
            ],
            # MỰC: hai trường này là LIST nên bộ lọc `not isinstance(v, (list, dict))` ở trên
            # nuốt mất — phải chép tay. Không có chúng thì bản lệnh chỉ biết "4/1 màu" mà không
            # biết cái "1" là K hay Pantone, và ai tính lại kẽm từ hai con số sẽ ra sai đúng ca
            # tự trở `|A ∪ B| ≠ max`. Lấy từ ENGINE (đã chuẩn hoá) chứ không lấy thẳng cột.
            "muc_a": comp.get("muc_a") or [],
            "muc_b": comp.get("muc_b") or [],
            "kem_moi_tay": comp.get("kem_moi_tay"),
            # Số DẪN XUẤT của engine (chạy lại theo SL đơn).
            "so_kem": comp.get("so_kem"),
            "so_luot": comp.get("so_luot"),
            "so_con": comp.get("con"),
            "so_manh_xa": comp.get("so_manh_xa"),
        })

        # Máy in của phiếu — cùng nguồn với `lsx.may_id` lúc tạo lệnh — để tổ của bước In đi theo máy.
        may_phieu = quy_cach.get("may_id") or getattr(tp, "may_id", None)
        routing: list[dict] = []
        for i, row in enumerate(resolved.get("thanh_phams") or []):
            cd = row.get("cong_doan") or {}
            cd_id = row.get("cong_doan_id")
            if not cd and cd_id:
                obj = self.db.get(CongDoan, cd_id)
                if obj is not None:
                    cd = {"nhom": obj.nhom, "ten": obj.ten,
                          "department_id": self._to_va_may_mac_dinh(obj, may_phieu, obj.nhom)[0],
                          "requires_tooling": obj.requires_tooling,
                          "tooling_type": obj.tooling_type,
                          "don_vi_vao": obj.don_vi_vao, "don_vi_ra": obj.don_vi_ra}
            else:
                # `_cong_doan_to_dict` không bơm department_id + cờ dụng cụ → lấy thêm.
                if cd_id:
                    obj = self.db.get(CongDoan, cd_id)
                    if obj is not None:
                        cd = {**cd,
                              "department_id": self._to_va_may_mac_dinh(obj, may_phieu, obj.nhom)[0],
                              "requires_tooling": obj.requires_tooling,
                              "tooling_type": obj.tooling_type,
                              "don_vi_vao": obj.don_vi_vao, "don_vi_ra": obj.don_vi_ra}
            ten = row.get("ten") or cd.get("ten") or "Công đoạn"
            nhom = cd.get("nhom")
            routing.append({
                "thu_tu": i,
                "cong_doan_id": cd_id,
                "ten": ten,
                "nhom": nhom,
                "department_id": cd.get("department_id"),
                # Cờ dụng cụ của DANH MỤC — nguồn duy nhất cho checklist "thiếu khuôn".
                "requires_tooling": can_chot_khuon(cd.get("requires_tooling"), cd.get("tooling_type")),
                "tooling_type": cd.get("tooling_type"),
                # Đặt loại bước NGAY TỪ ĐÂY để màn "lệnh dự kiến" và màn lệnh đã tạo nói cùng một
                # thứ tiếng — trước đó preview chỉ có cờ thuê-ngoài nên hai màn hiển thị lệch nhau.
                # Công đoạn mà mọi tổ đã tick đều chưa có máy chạy nó ⇒ bước loại TỔ (23/10/2026).
                "loai_buoc": (LB_THUE_NGOAI if row.get("nha_cung_cap")
                              else LB_TO if to_khong_may(self.db, self.db.get(CongDoan, cd_id)
                                                         if cd_id else None)
                              else LB_MAY),
                "nha_cung_cap": row.get("nha_cung_cap"),
                # Ý ĐỊNH của sale về khuôn — chép nguyên si, KHÔNG diễn giải. Kế hoạch vẫn tự chốt
                # con dao (`khuon_be_id`); hai thứ đứng cạnh nhau để so ra chỗ lệch.
                "khuon_nguon": row.get("khuon_nguon"),
                "khuon_phi": float(row.get("phi_khuon") or 0),
                # Đơn vị KHAI ở danh mục — bảng "lệnh dự kiến" cần chúng để nói số tờ bằng đúng
                # tên xưởng đặt. Chỉ là NHÃN ở đây; hệ số quy đổi vẫn do `_don_vi_theo_buoc` lo.
                "don_vi_vao": cd.get("don_vi_vao"),
                "don_vi_ra": cd.get("don_vi_ra"),
                # Vật tư + chip của bước theo PHIẾU (01/10/2026) — nguồn BOM lúc tạo lệnh.
                # 18/10/2026: kèm `hang_loai` — giấy chọn ở bước phiếu đi xuống đúng bước lệnh.
                "vat_tus": [
                    {"hang_loai": v.get("hang_loai") or HANG_VAT_TU, "vat_tu_id": v["vat_tu_id"],
                     "gia_tri_chip": dict(v.get("gia_tri_chip") or {})}
                    for v in (row.get("vat_tus") or [])
                ],
            })
        return {"comp": comp, "quy_cach": quy_cach, "routing": routing, "sl_ptg": sl_ptg}

    # Checklist "job readiness" chấm ở tầng DÒNG ĐƠN (`_thieu`) đã GỠ 07/09/2026: bảng lệnh dự kiến
    # không còn cột Thiếu, và lệnh mới luôn sinh ra ở NHÁP. Cửa duy nhất còn gác là `thieu_cua` —
    # checklist của LỆNH đã có routing, chặn nút "Sẵn sàng lập kế hoạch".

    # ================= PREVIEW =================

    def preview(self, order_id: int) -> dict:
        order = self.repo.order_with_lines(order_id)
        if order is None:
            raise LsxNotFound("Không tìm thấy đơn hàng")
        if order.status != STATUS_ORDERED or order.san_xuat_released_at is None:
            raise LsxConflict("Đơn chưa được chuyển xuống sản xuất")

        da_co = self.repo.by_order_lines([ln.id for ln in order.lines])
        ton_dong = self._ton_san_theo_dong(order)
        lines: list[dict] = []
        for line in order.lines:
            tp = self._thanh_phan(line.phieu_thanh_phan_id)
            calc = self._tinh_dong(line, tp)
            comp = calc["comp"]
            existing = da_co.get(line.id)
            ptg_ma = None
            if tp is not None:
                ptg = self.db.get(PhieuTinhGia, tp.phieu_id)
                ptg_ma = ptg.ma if ptg else None
            dept_ids = {r["department_id"] for r in calc["routing"] if r.get("department_id")}
            dept_names = self._dept_names(dept_ids)
            lines.append({
                "order_line_id": line.id,
                "ten": line.description or (tp.ten if tp else "") or "Sản phẩm",
                "so_luong_dat": int(line.qty or 0),
                "don_vi_tinh": line.don_vi_tinh or "cái",
                "phieu_thanh_phan_id": line.phieu_thanh_phan_id,
                "ptg_ma": ptg_ma,
                # Nhãn nhóm chỉ để GOM HIỂN THỊ ở màn kế hoạch — vẫn 1 lệnh / 1 dòng đơn.
                "nhom": getattr(line, "nhom", None),
                # Chưa có bài tính giá → comp rỗng, các số dẫn xuất là "chưa tính được" → None
                # (UI hiện "—"), KHÔNG ép 0/1 giả. Có PTG mà số thật = 0 thì vẫn hiện 0.
                # Chỉ còn bù hao MÁY TỰ TRA — ô "+ Bù thêm" của phiếu tính giá đã bỏ 15/08/2026.
                "bu_hao_to": (
                    int(round(float(comp.get("bu_hao_auto") or 0))) if tp is not None else None
                ),
                "so_to_ke_hoach": int(round(float(comp.get("to_dau_vao") or 0))) if tp is not None else None,
                "so_to_nguyen": int(comp.get("to_nguyen") or 0) if tp is not None else None,
                "so_con": int(comp.get("con") or 1) if tp is not None else None,
                "so_kem": int(comp.get("so_kem") or 0) if tp is not None else None,
                "so_luot": int(round(float(comp.get("so_luot") or 0))) if tp is not None else None,
                # MÃ đơn vị từng chặng (client tra tên ở danh mục). Bảng này liệt kê NHIỀU dòng đơn,
                # mỗi dòng một bộ đơn vị riêng — nên đơn vị phải đi theo dòng, không nằm ở tiêu đề.
                **{f"don_vi_{k}": v for k, v in
                   don_vi_chuoi(calc["routing"], self._tram()).items()},
                "routing": [
                    {**r, "department_ten": dept_names.get(r.get("department_id"))}
                    for r in calc["routing"]
                ],
                "quy_cach": calc["quy_cach"],
                "sl_ptg": calc["sl_ptg"] if calc["sl_ptg"] and calc["sl_ptg"] != int(line.qty or 0) else None,
                "lsx_id": existing.id if existing else None,
                "lsx_ma": existing.ma if existing else None,
                **ton_dong.get(line.id, {}),
            })
        return {
            "order_id": order.id,
            "order_no": order.order_no,
            "customer_name": self._customer_name(order),
            "sale_name": self._user_name(order.sale_user_id),
            "delivery_committed_date": order.delivery_committed_date,
            "is_rush": bool(order.is_rush),
            "production_note": order.production_note,
            "lines": lines,
        }

    def _ton_san_theo_dong(self, order) -> dict[int, dict]:
        """`{order_line_id: {ton_san, ton_dvt}}` — kho đang có bao nhiêu sản phẩm bán của khách để
        KHSX quyết làm đủ hay làm bù (đơn trước làm dư thì đơn này chỉ cần làm phần thiếu)."""
        from ..repositories.delivery_repo import DeliveryRepository
        from ..repositories.order_repo import OrderRepository
        from .delivery_service import DeliveryService
        from .thanh_pham_khai_bao import cum_ban, thanh_pham_cua_cum

        cums = [(c, thanh_pham_cua_cum(self.db, order, c)) for c in cum_ban(order)]
        kd = DeliveryService(DeliveryRepository(self.db), OrderRepository(self.db), None, None, None)             .kha_dung_theo_ma({tp.id for _c, tp in cums if tp is not None})
        ra: dict[int, dict] = {}
        for c, tp in cums:
            if tp is None:
                continue
            v = kd.get(tp.id)
            con = max(0.0, v["ton"] - sum(v["giu"].values())) if v else 0.0
            for ln in c.dong:
                ra[ln.id] = {"ton_san": round(con, 3), "ton_dvt": c.dvt}
        return ra

    # ================= TẠO LỆNH =================

    def _default_buoc(self, r: dict, *, comp: dict, lsx_may_id: int | None) -> dict:
        """Toàn bộ giá trị MẶC ĐỊNH của 1 bước khi bung routing từ bài tính giá.

        "Kế thừa" ở đây = GIÁ TRỊ KHỞI ĐIỂM; năng suất là snapshot chỉ đọc, còn thời gian chạy có
        thể nhập đè. Công đoạn chỉ cấp tổ/đơn vị/setup; loại bước do KHSX chọn. Riêng máy in đã
        chọn trên phiếu tính giá được mang xuống bước in làm gợi ý ban đầu — nhưng phải là máy
        công đoạn ấy chạy được, xem `_may_mac_dinh`. Danh mục thiếu thì để TRỐNG, KHÔNG đoán
        bừa — thời lượng hiện "—" là tín hiệu đúng để đi khai danh mục, số 0 giả thì không.
        """
        nhom, ten = r.get("nhom"), r.get("ten")
        cd_obj = self.db.get(CongDoan, r["cong_doan_id"]) if r.get("cong_doan_id") else None
        # Loại là thuộc tính của BƯỚC KHSX, không phải của danh mục Công đoạn. Routing từ phiếu có
        # thể đưa gợi ý ban đầu; sau đó kế hoạch đổi tự do trong drawer.
        loai_buoc = (LB_THUE_NGOAI if r.get("nha_cung_cap") else
                     r.get("loai_buoc") or LB_MAY)
        # Máy của PHIẾU chỉ mang xuống bước IN (ô đó là "Máy in"); tổ đi theo máy — xem
        # `_to_va_may_mac_dinh`. Bước không phải máy giữ tổ của routing, không máy.
        dept, may_id = r.get("department_id"), None
        if loai_buoc == LB_MAY and cd_obj is not None:
            dept, may_id = self._to_va_may_mac_dinh(cd_obj, lsx_may_id, nhom)

        con = max(int(comp.get("con") or 1), 1)

        # --- Đơn vị vào/ra + hệ số: KẾ THỪA từ danh mục, không suy từ tên ---
        dv_vao, dv_ra, he_so = _don_vi_theo_buoc(
            cd_obj, con=con, xa=max(int(comp.get("so_manh_xa") or 1), 1), tram=self._tram())
        # Số lượng để 0 cho MỌI bước — `_ap_chuoi_nguoc` ghi đè ngay sau khi tạo, cả bước trên dòng
        vao = ra = 0.0

        # ⚠️ Bốn ô nhân-lực-và-năng-suất GỠ 18/09/2026: `nang_suat` · `don_vi_nang_suat` (cột bỏ,
        #    mg `0321`) · `so_nhan_cong_tieu_chuan` (kíp chuẩn, mg `0321`) · `khoan_json` (đầu việc
        #    ghim ở bước, mg `0320`). Bước TỔ nay chỉ có SỐ GIỜ KẾ HOẠCH, và bước mới sinh ra bằng
        #    0 — người lập lệnh gõ vào, không có nguồn danh mục nào để kế thừa.
        return {
            "loai_buoc": loai_buoc,
            "so_luong_vao": vao,
            "so_luong_ra": ra,
            "don_vi_vao": dv_vao,
            "don_vi_ra": dv_ra,
            "he_so_quy_doi": he_so,
            # Hao để 0 ở đây: `_ap_chuoi_nguoc` tra theo quy tắc bù hao của DANH MỤC công đoạn,
            # ở ĐÚNG đơn vị của từng bước. Bản cũ dồn cả cục bù hao vào một bước (bước in đầu) —
            # đó chính là con số 131 tờ mồ côi trong khi 6 bước đều hao 0.
            "hao_hut": 0.0,
            "hao_hut_pct": 0.0,
            # CẨN THẬN: `comp["so_luot"]` của engine là TỔNG LƯỢT TỜ (`to_dau_vao × số mặt`),
            # KHÔNG phải số lượt chạy. Số lượt chạy = so_luot ÷ số tờ (in trở 2 mặt → 2).
            "so_luot_chay": _so_luot_chay(comp) if nhom == "print" else 1,
            "setup_phut": _f(cd_obj.setup_time) if cd_obj else 0.0,
            # Giờ kế hoạch của bước TỔ — 0 là hợp lệ và KHÔNG cảnh báo (§5.1). Bước máy bỏ qua ô
            # này (giờ của nó chia theo tốc độ máy), nhưng cột vẫn sinh 0 cho mọi bước để đổi
            # Máy→Tổ ở drawer không gặp `None`.
            "so_gio_ke_hoach": 0.0,
            # Vệ sinh/rửa mực đã BỎ khỏi hệ — bước mới luôn sinh 0, cột giữ cho dữ liệu cũ.
            "ve_sinh_phut": 0.0,
            # CHỜ KỸ THUẬT kế thừa từ MÁY (bước máy) hoặc ĐẦU VIỆC (bước tổ) — mực khô · màng nguội
            # · keo đông. Là GIÁ TRỊ KHỞI ĐIỂM, kế hoạch sửa đè được ở drawer bước; kế thừa nghĩa là
            # mặc định, không phải read-only.
            "may_id": may_id,
            "department_id": dept,
        }

    def _bung_lai_vat_tu(self, lsx: Lsx, buocs: list[LsxCongDoan]) -> None:
        """Bước mới / vừa đổi công đoạn: thay dòng MÁY BUNG bằng vật tư của công đoạn MỚI.

        Vật tư đi theo CÔNG ĐOẠN (mg `0316`): đổi "Cán màng bóng" sang "Cán màng mờ" mà vẫn giữ
        màng bóng của công đoạn cũ là lệnh đi mua nhầm hàng. Chỉ thay dòng `tu_dong=True`; dòng
        người tự thêm/sửa giữ nguyên, trùng món thì dòng người thắng (không bung đè).

        THUÊ NGOÀI không bung — cùng luật với `_soi_danh_muc`: nhà thầu tự lo vật tư của họ.
        Chỉ gọi cho bước ĐỔI công đoạn: bước giữ nguyên thì danh mục đổi sau đi qua băng "Danh
        mục đã đổi" + nút Cập nhật, không âm thầm đổi số dưới chân người lập lệnh.
        """
        if not buocs:
            return
        quy_cach = quy_cach_bien(lsx)
        for cd in buocs:
            cd_obj = self.db.get(CongDoan, cd.cong_doan_id) if cd.cong_doan_id else None
            if cd_obj is None:
                continue
            for v in [v for v in cd.vat_tus if v.tu_dong]:
                cd.vat_tus.remove(v)
            # FLUSH giữa xoá và thêm: UNIQUE (lsx_cong_doan_id, hang_loai, vat_tu_id) — công đoạn
            # mới dùng lại đúng món của công đoạn cũ là xoá rồi thêm chính cặp đó.
            self.db.flush()
            if cd.loai_buoc == LB_THUE_NGOAI:
                continue
            co = {(v.hang_loai, int(v.vat_tu_id)) for v in cd.vat_tus if v.vat_tu_id}
            thu_tu = max((v.thu_tu for v in cd.vat_tus), default=-1)
            # Chỉ gọi cho bước ĐỔI công đoạn ⇒ danh sách = vật tư của công đoạn MỚI, chip rỗng.
            rows, _canh_bao = self._vat_tu_bung(cd_obj, cd, quy_cach)
            for v in rows:
                cap = (v.get("hang_loai") or HANG_VAT_TU, int(v["vat_tu_id"]))
                if cap in co:
                    continue
                co.add(cap)
                thu_tu += 1
                cd.vat_tus.append(LsxCongDoanVatTu(
                    hang_loai=cap[0], vat_tu_id=cap[1], vat_tu_ma_snapshot=v["ma"],
                    vat_tu_ten_snapshot=v["ten"], don_vi_snapshot=v["don_vi"] or "",
                    so_luong=float(v["so_luong"]), thu_tu=thu_tu, tu_dong=True,
                    gia_tri_chip=v.get("gia_tri_chip") or {},
                ))
        self.db.flush()

    def _bung_vat_tu_cong_doan(self, lsx: Lsx, quy_cach: dict, nguon: list[dict] | None = None) -> None:
        """Bung VẬT TƯ của CÔNG ĐOẠN vào từng bước, ngay lúc tạo lệnh.

        Vì sao ở SERVER chứ không đợi frontend (13/08/2026): frontend chỉ bung vật tư khi người
        dùng TỰ TAY mở drawer bước. Không điền sẵn ⇒ lệnh tạo xong khối "Vật tư cần dùng" trống
        trơn, và kế hoạch vật tư không thấy gì để đi mua. Điền ở đây thì mọi lệnh đều có.

        `tu_dong=True` để lần bung sau (đồng bộ danh mục) thay được — dòng người tự thêm vẫn chừa
        ra. Vật tư nào chưa quy đổi ra lượng được thì BỎ QUA, không ghi số đoán: `_vat_tu_bung` đã
        trả lý do, drawer hiện cảnh báo cho người kế hoạch tự thêm.

        ⚠️ 18/09/2026 (mg `0316`): trước đây chỉ bung khi bước đã GHIM một đầu việc khoán
        (`khoan_json.rate_id`) — tầng ấy đã gỡ. Nay MỌI bước gắn công đoạn đều bung, nên lệnh
        không còn cảnh trống vật tư chỉ vì tổ khớp hai đầu việc nên máy không dám chọn hộ.

        01/10/2026: `nguon` = `calc["routing"]` (lệnh có phiếu) ⇒ danh sách + chip của bước LẤY TỪ
        PHIẾU, khớp theo VỊ TRÍ `thu_tu`; phiếu đã xoá vật tư thì lệnh KHÔNG đẻ lại từ danh mục công
        đoạn. `nguon=None` (không có phiếu) ⇒ danh mục công đoạn, chip rỗng.
        """
        theo_vi_tri = {r["thu_tu"]: r.get("vat_tus") or [] for r in (nguon or [])}
        for cd in lsx.cong_doans:
            # THUÊ NGOÀI không bung — nhà gia công tự lo vật tư (tiền nằm trong đơn giá, spec §3).
            if cd.loai_buoc == LB_THUE_NGOAI:
                continue
            if not cd.cong_doan_id:
                continue
            cd_obj = self.db.get(CongDoan, cd.cong_doan_id)
            if cd_obj is None:
                continue
            cua_buoc = theo_vi_tri.get(cd.thu_tu, [])
            dong_nguon = (
                [(v["vat_tu_id"], v["gia_tri_chip"]) for v in cua_buoc
                 if (v.get("hang_loai") or HANG_VAT_TU) == HANG_VAT_TU]
                if nguon is not None else None)
            # Giấy/sóng KHÔNG chép từ bước phiếu (24/10/2026): phiếu chọn ở sản phẩm, lệnh tự gắn vào
            # bước đầu của khâu chuẩn bị giấy — xem `_dung_khau_chuan_bi`.
            rows, _canh_bao = self._vat_tu_bung(cd_obj, cd, quy_cach, dong_nguon=dong_nguon)
            for pos, v in enumerate(rows):
                cd.vat_tus.append(LsxCongDoanVatTu(
                    hang_loai=v.get("hang_loai") or HANG_VAT_TU,
                    vat_tu_id=v["vat_tu_id"], vat_tu_ma_snapshot=v["ma"],
                    vat_tu_ten_snapshot=v["ten"], don_vi_snapshot=v["don_vi"] or "",
                    so_luong=float(v["so_luong"]), thu_tu=pos, tu_dong=v.get("tu_dong", True),
                    gia_tri_chip=v.get("gia_tri_chip") or {},
                ))

    def tao(self, *, order_id: int, order_line_ids: list[int], actor) -> list[Lsx]:
        order = self.repo.order_with_lines(order_id)
        if order is None:
            raise LsxNotFound("Không tìm thấy đơn hàng")
        if order.status != STATUS_ORDERED:
            raise LsxConflict("Đơn chưa chốt / đã hủy — không tạo lệnh sản xuất")
        if order.san_xuat_released_at is None:
            raise LsxConflict("Sale chưa chuyển đơn xuống sản xuất")

        by_id = {ln.id: ln for ln in order.lines}
        chosen = [by_id[i] for i in order_line_ids if i in by_id]
        if not chosen:
            raise LsxValidationError("Chưa chọn dòng nào của đơn để tạo lệnh")
        if len(chosen) != len(set(order_line_ids)):
            raise LsxValidationError("Có dòng không thuộc đơn hàng này")

        da_co = self.repo.by_order_lines([ln.id for ln in chosen])
        trung = [ln.id for ln in chosen if ln.id in da_co]
        if trung:
            raise LsxConflict("Dòng đã có lệnh sản xuất — không tạo trùng")

        quote_version_id = order.quotation_id and self._quote_version_id(order.quotation_id)
        created: list[Lsx] = []
        for line in chosen:
            tp = self._thanh_phan(line.phieu_thanh_phan_id)
            calc = self._tinh_dong(line, tp)
            comp = calc["comp"]
            so_luong_dat = int(line.qty or 0)
            lsx = Lsx(
                ma=self.sequence.generate_code("job"),
                loai=LOAI_MOI,
                # Nhận diện sản phẩm (tên · ĐVT) lấy từ PHIẾU TÍNH GIÁ — đó là nơi khai quy cách,
                # nên nó là nguồn. Dòng đơn chỉ là đường lui khi lệnh không gắn phiếu.
                # SỐ LƯỢNG thì ngược lại: lấy từ ĐƠN (`line.qty`) — đơn đặt đợt nào làm đợt đó,
                # phiếu báo giá cho cả lô lớn.
                ten=(tp.ten if tp else "") or line.description or "Sản phẩm",
                order_id=order.id,
                order_line_id=line.id,
                quote_version_id=quote_version_id or None,
                phieu_thanh_phan_id=line.phieu_thanh_phan_id,
                so_luong_dat=so_luong_dat,
                don_vi_tinh=(getattr(tp, "don_vi_tinh", None) or line.don_vi_tinh or "cái"),
                # Hai mốc số tờ để 0 — `_ap_chuoi_nguoc` ở dưới đọc ra từ chuỗi rồi ghi đè.
                so_to_ke_hoach=0,
                so_to_nguyen=0,
                so_con=int(comp.get("con") or 1),
                ban_giao_at=order.san_xuat_released_at,
                han_giao_khach=order.delivery_committed_date,
                is_rush=bool(order.is_rush),
                quy_cach_json=calc["quy_cach"],
                may_id=(calc["quy_cach"] or {}).get("may_id") or (tp.may_id if tp else None),
                # Lệnh mới LUÔN ở Nháp (07/09/2026): checklist chấm dòng đơn đã gỡ. Thiếu gì thì
                # `thieu_cua` nói ở màn lệnh, và lệnh tự rơi về Chờ bổ sung khi kế hoạch sửa routing.
                trang_thai=TT_NHAP,
                nguoi_phu_trach_id=actor.id,
                created_by=actor.id,
            )
            for r in calc["routing"]:
                d = self._default_buoc(r, comp=comp, lsx_may_id=lsx.may_id)
                lsx.cong_doans.append(LsxCongDoan(
                    thu_tu=r["thu_tu"],
                    cong_doan_id=r.get("cong_doan_id"),
                    ten=r.get("ten") or "Công đoạn",
                    nhom=r.get("nhom"),
                    nha_cung_cap=r.get("nha_cung_cap"),
                    khuon_nguon=r.get("khuon_nguon"),
                    khuon_phi=r.get("khuon_phi") or 0,
                    # Khởi tạo rỗng: không thì `cur.phu_thuoc.append` ở dưới lazy-load từng bước (1 câu/bước).
                    phu_thuoc=[],
                    **d,
                ))
            # Số lượng từng bước là DẪN XUẤT — chạy chuỗi ngược ngay sau khi dựng đủ routing.
            self._ap_chuoi_nguoc(lsx)
            # ...rồi mới bung VẬT TƯ của công đoạn: `_vat_tu_bung` cần `so_luong_vao` của bước để
            # quy ra lượng, mà số đó chỉ có sau chuỗi ngược.
            # `quy_cach_bien` chứ KHÔNG phải `calc["quy_cach"]` thô: năm biến dẫn xuất (SL đặt ·
            # con/tờ · tờ in · tờ nguyên · tờ sau in) nằm ở CỘT của lệnh. Thiếu chúng thì công thức
            # nào dùng `so_luong`/`to_dau_vao` cũng ra 0 ⇒ bị coi là thiếu biến và không bung gì.
            self._bung_vat_tu_cong_doan(
                lsx, quy_cach_bien(lsx), nguon=(calc["routing"] if tp is not None else None))
            self.repo.add(lsx)
            # Giữ hành vi tuyến tính hiện tại làm mặc định; sau đó kế hoạch có thể bỏ/thêm cạnh
            # để tạo nhánh song song hoặc điểm ghép xuyên LSX.
            ordered_steps = sorted(lsx.cong_doans, key=lambda x: x.thu_tu)
            for prev, cur in zip(ordered_steps, ordered_steps[1:]):
                cur.phu_thuoc.append(LsxCongDoanPhuThuoc(buoc_truoc_id=prev.id))
            # KHÂU CHUẨN BỊ GIẤY (24/10/2026): nguồn chọn theo SL vào In vừa tính ở chuỗi ngược trên,
            # chèn bước rồi tính ngược lại; vật tư định mức của bước mới bung sau khi có số.
            moi = self._dung_khau_chuan_bi(lsx, self._chon_nguon_giay(lsx))
            self._ap_chuoi_nguoc(lsx)
            self._bung_lai_vat_tu(lsx, moi)
            lsx.routing_goc_json = _routing_van_tay(lsx.cong_doans)
            created.append(lsx)
            self.audit.create(
                actor_user_id=actor.id, action="create_lsx", target=f"lsx:{lsx.id}",
                detail=f"Tạo lệnh {lsx.ma} — {lsx.ten} (đơn {order.order_no}, "
                       f"{so_luong_dat:,} {lsx.don_vi_tinh})".replace(",", "."),
            )
        self.repo.commit()
        return created

    def _quote_version_id(self, quotation_id: int) -> int | None:
        from ..models.quotation import Quote

        q = self.db.get(Quote, quotation_id)
        return q.current_version_id if q else None

    # ================= ĐỌC / SỬA =================

    def get(self, lsx_id: int) -> Lsx:
        lsx = self.repo.get(lsx_id)
        if lsx is None:
            raise LsxNotFound("Không tìm thấy lệnh sản xuất")
        self._nap_cd(c.cong_doan_id for c in lsx.cong_doans)
        return lsx

    def thieu_cua(self, lsx: Lsx) -> list[str]:
        """Checklist CHẶN — còn mã nào thì không cho đánh dấu "Sẵn sàng lập kế hoạch" (§12)."""
        return self.kiem_thieu(lsx)[0]

    def kiem_thieu(self, lsx: Lsx) -> tuple[list[str], dict[str, list[int]]]:
        """`(mã thiếu, {mã thiếu cấp BƯỚC: [id bước dính]})`.

        Vế hai cho màn lệnh nói ĐÍCH DANH bước nào (07/10/2026): trước đó chỉ có câu "Có công đoạn
        chưa gán tổ / máy", người dùng phải mở từng bước ra dò mới biết bước nào chặn nút Sẵn sàng.
        """
        order = self.db.get(Order, lsx.order_id)
        tp = self._thanh_phan(lsx.phieu_thanh_phan_id)
        # Nạp cờ dụng cụ theo LÔ (1 query) — bước của lệnh chỉ giữ `cong_doan_id`, mà hỏi lẻ từng
        # bước là N+1 trên màn danh sách lệnh.
        cd_ids = [cd.cong_doan_id for cd in lsx.cong_doans if cd.cong_doan_id]
        co_dung_cu: dict[int, tuple[bool, str | None]] = {}
        if cd_ids:
            co_dung_cu = {
                r.id: (bool(r.requires_tooling), r.tooling_type)
                for r in self.db.query(CongDoan)
                .filter(CongDoan.id.in_(set(cd_ids)))
                .all()
            }
        routing = [
            {
                "ten": cd.ten,
                "nhom": cd.nhom,
                "requires_tooling": can_chot_khuon(*co_dung_cu.get(cd.cong_doan_id, (False, None))),
                "tooling_type": co_dung_cu.get(cd.cong_doan_id, (False, None))[1],
            }
            for cd in lsx.cong_doans
        ]
        thieu: list[str] = []
        qc = lsx.quy_cach_json or {}
        if lsx.phieu_thanh_phan_id is None:
            thieu.append("khong_co_ptg")
        else:
            # Thiếu giấy = KHÔNG công đoạn nào có dòng giấy (18/10/2026) — giấy chọn ở bước, bước
            # nào cũng được, không riêng bước In. `qc.giay_id` là giấy chính phiếu dẫn xuất từ chính
            # các bước đó; vẫn đọc nó cho lệnh lập trước 18/10 (giấy chỉ nằm ở quy cách).
            if not qc.get("giay_id") and not any(
                    v.hang_loai == HANG_GIAY for cd in lsx.cong_doans for v in cd.vat_tus):
                thieu.append("thieu_giay")
            if not (qc.get("dai_thanh_pham") and qc.get("rong_thanh_pham")):
                thieu.append("thieu_kho")
            # Lệnh có nguồn giấy mà thiếu khổ nguyên / mảnh xả (24/10/2026): máy không dựng được khâu
            # Tề/Cắt cuộn, chỉ dò được tờ khổ in — báo để người lập lệnh khai.
            if lsx.nguon_giay and qc.get("giay_id") and not (
                    _f(qc.get("so_manh_xa")) > 0 and kho_nguyen_dung_duoc(
                        (_f(qc.get("kho_nguyen_rong")), _f(qc.get("kho_nguyen_dai"))),
                        (_f(qc.get("kho_in_rong")), _f(qc.get("kho_in_dai"))))):
                thieu.append("thieu_kho_nguyen")
            if not routing:
                thieu.append("thieu_routing")
        if (order.delivery_committed_date if order else None) is None and lsx.han_giao_khach is None:
            thieu.append("thieu_ngay_giao")

        # --- Điều kiện "sẵn sàng xếp lịch" của từng bước (§12) ---
        from ..models.gia_cong_ngoai import KIEU_TRON_GOI, GiaCongNgoai
        tron_goi = self.db.query(GiaCongNgoai.id).filter(
            GiaCongNgoai.lsx_id == lsx.id, GiaCongNgoai.kieu == KIEU_TRON_GOI,
            GiaCongNgoai.huy_luc.is_(None),
        ).first() is not None
        buoc: dict[str, list[int]] = {}
        for cd in lsx.cong_doans:
            # Bước MÁY/TỔ phải biết ai/máy nào làm thì Gantt mới có chỗ đặt. Bước THUÊ NGOÀI không
            # tổ, không máy — nó phải có NHÀ GIA CÔNG chọn từ danh mục (spec 2026-09-26 §7); tên
            # gõ tay kiểu cũ (`nha_cung_cap` có chữ mà không có id) không tính.
            if cd.loai_buoc == LB_THUE_NGOAI:
                if cd.nha_cung_cap_id is None:
                    buoc.setdefault("thieu_nha_gia_cong", []).append(cd.id)
            elif (cd.loai_buoc in (LB_MAY, LB_TO)
                    and not (cd.department_id or cd.may_id)):
                buoc.setdefault("thieu_to_may", []).append(cd.id)
            # Bước cần dụng cụ lưu kho mà chưa trỏ con dao nào → chưa chạy được, chặn Y NHƯ
            # thiếu nhà gia công. Trước 04/09/2026 cửa này im lặng: lệnh qua cửa ngon lành rồi tới
            # lúc thợ ra máy mới biết không có dao. Danh sách dụng cụ đọc từ CỜ của công đoạn
            # (`co_dung_cu` nạp theo lô ở trên), KHÔNG ghi cứng tên bước.
            # Bước THUÊ NGOÀI: nhà gia công tự lo dao/khuôn (hộp bước ẩn luôn thẻ khuôn) ⇒ không
            # đòi — đòi thì lệnh kẹt "Còn thiếu 1 mục" mà không còn chỗ nào để chọn (E2E 27/09/2026).
            # Lệnh GIA CÔNG TRỌN GÓI (18/10/2026, lỗi #16): cả lệnh giao nhà gia công, họ lo khuôn
            # cho MỌI bước — cùng lẽ với bước thuê ngoài lẻ ở trên.
            can_dc, loai_dc = co_dung_cu.get(cd.cong_doan_id, (False, None))
            if (cd.loai_buoc != LB_THUE_NGOAI and not tron_goi and can_chot_khuon(can_dc, loai_dc)
                    and cd.khuon_be_id is None):
                buoc.setdefault("thieu_khuon", []).append(cd.id)
        # Thứ tự mã giữ như trước: nhà gia công → tổ/máy → khuôn, theo bước đầu tiên dính.
        thieu.extend(buoc)
        # Thiếu NGUỒN của hệ số quy đổi — hai cầu, hai nguồn khác nhau. KHÔNG kiểm `he_so <= 1`
        # như bản cũ: hệ số 1 HỢP LỆ ở cả hai cầu (1 tờ nguyên ra 1 tờ in là chuyện thường; 1
        # con/tờ hiếm nhưng có — poster bằng khổ tờ). Chỉ 0/thiếu mới là chưa khai.
        # So theo TRẠM, KHÔNG theo mã. `don_vi_vao/ra` là mã xưởng tự đặt (`to_chay`, `sp_xong`);
        # so thẳng với `("to","cai")` thì chỉ khớp trên dữ liệu seed, còn xưởng nào đổi tên đơn vị
        # là ba cảnh báo dưới đây IM LẶNG và nút "Sẵn sàng" mở toang dù thiếu Con/tờ (12/08/2026).
        tram_bd = self._tram()
        cau = {(tram_cua(c.don_vi_vao, tram_bd), tram_cua(c.don_vi_ra, tram_bd))
               for c in lsx.cong_doans if c.don_vi_vao and c.don_vi_ra}
        qc_kt = lsx.quy_cach_json or {}
        # Sách gấp tay lấy hệ số từ TRANG MỖI TAY, không phải số con — đòi `so_con` ở lệnh sách là
        # bắt khai một số không vào công thức, rồi chặn phát hành vì thiếu thứ vô dụng.
        la_sach = _f(qc_kt.get("trang_moi_tay")) > 1
        if (TRAM_TO, TRAM_CAI) in cau and not la_sach and int(lsx.so_con or 0) <= 0:
            thieu.append("thieu_con_tren_to")
        # Cầu `tay → cuốn` chỉ có nghĩa khi biết một cuốn mấy tay = số trang / trang mỗi tay.
        if (TRAM_TAY, TRAM_CAI) in cau and (la_sach is False or _f(qc_kt.get("so_trang")) <= 0):
            thieu.append("thieu_trang_moi_tay")
        if (TRAM_TO_NGUYEN, TRAM_TO) in cau and _f(qc_kt.get("so_manh_xa")) <= 0:
            thieu.append("thieu_manh_xa")
        # tp chỉ dùng để xác nhận nguồn còn sống — lệnh vẫn chạy được khi PTG đã đổi/xoá.
        del tp
        return thieu, buoc

    # ================= TÍNH NGƯỢC · LEAD TIME =================

    def mac_dinh_buoc(self, *, lsx_id: int, cong_doan_id: int) -> dict:
        """Thuộc tính công việc khi kế hoạch ĐỔI công đoạn giữa chừng.

        Công đoạn chỉ quyết định tên, tổ, đơn vị và setup. Loại Máy/Tổ/Thuê ngoài, máy cụ thể và
        nguồn năng suất thuộc chính bước KHSX nên tuyệt đối không được endpoint này ghi đè —
        `may_id_goi_y` là GỢI Ý cho ô đang trống, không phải lệnh gán (xem chú thích ở khoá đó).

        KHÔNG trả số lượng vào/ra: chúng thuộc CHUỖI (bước trước giao bao nhiêu thì bước này nhận
        bấy nhiêu), không thuộc công đoạn — người kế hoạch giữ số đang cân, lệch thì đã có cảnh báo
        `dut_chuyen` và nút "Tính ngược từ SL thành phẩm".
        """
        lsx = self.get(lsx_id)
        cd = self.db.get(CongDoan, cong_doan_id)
        if cd is None:
            raise LsxNotFound("Không tìm thấy công đoạn")

        dv_vao, dv_ra, he_so = _don_vi_theo_buoc(
            cd, cau=self._he_so_cau(lsx), tram=self._tram())
        to_md, may_md = self._to_va_may_mac_dinh(cd, lsx.may_id, cd.nhom)
        return {
            "cong_doan_id": cd.id,
            "ten": cd.ten,
            "nhom": cd.nhom,
            # Công đoạn NHIỀU tổ (mg `0312`): tổ đầu là mặc định, kèm cả danh sách để client biết
            # ô chọn tổ của bước được chọn những tổ nào.
            # Tổ đi theo máy phiếu ở bước In (spec máy thuộc tổ §4.6) — cùng luật tạo lệnh.
            "department_id": to_md,
            "department_ids": cd.department_ids,
            "don_vi_vao": dv_vao,
            "don_vi_ra": dv_ra,
            "he_so_quy_doi": he_so,
            # Cờ dòng giấy phải đi CÙNG cặp đơn vị mới. Client áp `don_vi_vao`/`don_vi_ra` của công
            # đoạn vừa chọn lên dòng đang sửa; không trả kèm cờ thì nó giữ cờ của công đoạn CŨ, và
            # FE không tự suy lại được (trạm là cờ trên danh mục Đơn vị, không đọc ra từ mã).
            # Đổi bước in → ghi kẽm là dòng đó mang cặp `m² → bài in` mà vẫn tự nhận "trên dòng
            # giấy" cho tới lúc lưu.
            "tren_dong_giay": tren_dong_giay(dv_vao, dv_ra, self._tram()),
            # Cờ DỤNG CỤ cũng phải đi kèm, cùng một lẽ với cờ dòng giấy: ô chọn khuôn của bước lọc
            # kho theo `tooling_type`, mà FE không suy ra được nó từ tên công đoạn. Không trả kèm
            # thì đổi bước Bế sang một công đoạn cần KHUÔN ÉP KIM vẫn thấy thẻ "Khuôn của bước (khuôn
            # bế)" và ô chọn vẫn bày dao bế — sai loại, im lặng, cho tới lúc lưu rồi nạp lại màn.
            "requires_tooling": can_chot_khuon(cd.requires_tooling, cd.tooling_type),
            "tooling_type": cd.tooling_type,
            "setup_phut": _f(cd.setup_time),
            # GỢI Ý máy, không phải lệnh gán (09/09/2026): máy mặc định của công đoạn (máy còn dùng
            # đứng đầu danh sách, 12/10/2026), và client chỉ áp khi dòng đang TRỐNG máy. Máy người
            # ta đã chọn vẫn bất khả xâm phạm — đó là ranh giới mà docstring trên vẫn giữ. Có nó vì
            # cách đo giờ và tốc độ đều treo ở cặp (công đoạn × máy): để trống thì bảng thời gian
            # của bước ra "—" cho tới khi có người vào chọn máy.
            "may_id_goi_y": may_md,
        }

    def _he_so_cau(self, lsx: Lsx, *, so_con: int | None = None) -> dict:
        """Hệ số của HAI CẦU quy đổi — hai nguồn KHÁC NHAU, đừng gộp.

        `to→cai` lấy cột `lsx.so_con`; `to_nguyen→to` lấy `quy_cach_json["so_manh_xa"]` — số mảnh
        xả KHÔNG có cột riêng trên `lsx`, `getattr(lsx, "so_manh_xa")` sẽ luôn ra None.

        `so_con` truyền vào để BÀI GHÉP hỏi "nếu xếp 2 con/tờ thì cần bao nhiêu tờ" mà không phải
        ghi đè cột của lệnh — bố cục ghép khác bố cục in riêng.

        LỆNH ĐÃ GHÉP thì cả hai cầu đọc theo BÀI: bài mới là chủ của tờ giấy (số con trên tờ ghép,
        khổ tờ in, giấy). Giữ số của bài tính giá ở đây là ra hai con số tờ đá nhau giữa hai màn.
        """
        qc = lsx.quy_cach_json or {}
        ghep = self._ghep_cua(lsx)
        con = so_con if so_con is not None else (
            (ghep and ghep[1].so_con_tren_to) or lsx.so_con
        )
        xa = _f(qc.get("so_manh_xa"))
        if ghep is not None and (xa_bai := self._manh_xa_theo_bai(qc, ghep[0])):
            xa = xa_bai
        # Cầu `to → cai` KHÔNG phải lúc nào cũng là số con: sách gấp tay thì nhiều TỜ mới gom
        # thành MỘT cuốn (hệ số `1/so_tay`, nhỏ hơn 1), và `con` không vào công thức giấy.
        # Dùng chung hàm với engine tính giá — trước đây tầng này trả thẳng `con` nên lệnh sách
        # cấp thiếu giấy đúng `con × so_tay` lần, một chiều, không ai báo.
        to_sang_cai = cau_to_sang_cai(
            trang_moi_tay=qc.get("trang_moi_tay"), so_trang=qc.get("so_trang"), con=con,
        )
        so_con = float(max(int(con or 0), 1))
        # Khoá là cặp TRẠM, KHÔNG phải cặp mã đơn vị — `dich_chuoi` tra bằng `TRAM_*`, và mọi nơi
        # tra bằng mã phải dịch qua `tram_cua` trước. Trước 12/08/2026 chỗ này viết bằng hằng `DV_*`
        # (cùng chuỗi "to"/"cai" nên chạy đúng) khiến người đọc tưởng khoá theo mã rồi tra bằng mã —
        # đúng cái bẫy làm ba cảnh báo `thieu_*` chết câm khi xưởng đổi tên đơn vị.
        return {
            (TRAM_TO, TRAM_CAI): to_sang_cai,
            (TRAM_TO_NGUYEN, TRAM_TO): float(max(int(xa or 0), 1)),
            # Đường DÀI qua `con`, cho bước thật sự đếm mảnh cắt. Tích hai cầu phải bằng đúng cầu
            # đi tắt `to → cai`, không thì hai lối cho ra hai số giấy khác nhau trên cùng một lệnh.
            (TRAM_TO, TRAM_CON): so_con,
            (TRAM_CON, TRAM_CAI): to_sang_cai / so_con,
            # Đường DÀI của SÁCH: gấp (tờ in → tay) rồi bắt tay + vào keo (tay → cuốn). Gấp không
            # sinh không mất tờ nên cầu đầu là 1, cầu sau gánh trọn — cùng luật bảo toàn tích.
            (TRAM_TO, TRAM_TAY): 1.0,
            (TRAM_TAY, TRAM_CAI): to_sang_cai,
        }

    def nap_ghep_cua(self, ghep: dict, lsx_ids) -> None:
        """Nạp sẵn kết quả `_ghep_cua` cho một lô lệnh — `ghep` = `BaiGhepRepository.ghep_theo_lsx`.

        Engine bài ghép hỏi câu này 4–6 lần cho MỖI thành viên (cầu quy đổi, chuỗi ngược, chuỗi
        xuôi…). Chỉ đường ĐỌC nhiều bài mới nạp (xem `BaiGhepService.nap_truoc`); lệnh ngoài lô vẫn
        hỏi DB như cũ.
        """
        nap = dict(getattr(self, "_ghep_nap", None) or {})
        nap.update({int(i): ghep.get(int(i)) for i in lsx_ids if i})
        self._ghep_nap = nap

    def _ghep_cua(self, lsx: Lsx):
        """(BaiGhep, BaiGhepThanhVien) nếu lệnh đang trong một bài ghép, không thì None."""
        if not getattr(lsx, "id", None):
            return None
        nap = getattr(self, "_ghep_nap", None)
        if nap is not None and lsx.id in nap:
            return nap[lsx.id]
        return self.db.execute(
            select(BaiGhep, BaiGhepThanhVien)
            .join(BaiGhepThanhVien, BaiGhepThanhVien.bai_ghep_id == BaiGhep.id)
            .where(BaiGhepThanhVien.lsx_id == lsx.id)
        ).first()

    @staticmethod
    def _manh_xa_theo_bai(qc: dict, bg) -> int | None:
        """Số mảnh xả tính lại theo KHỔ TỜ IN CỦA BÀI (giấy nguyên vẫn của lệnh).

        Ghép bài đổi khổ tờ in mà giữ nguyên `so_manh_xa` của bài tính giá thì số giấy nguyên
        phải mua sai theo. Xếp thử cả hai hướng, lấy nhiều hơn — giống `_fit` bên engine tính giá.
        """
        ng_d, ng_r = _f(qc.get("kho_nguyen_dai")), _f(qc.get("kho_nguyen_rong"))
        in_d, in_r = _f(bg.kho_in_dai), _f(bg.kho_in_rong)
        if min(ng_d, ng_r, in_d, in_r) <= 0:
            return None
        thang = int(ng_d // in_d) * int(ng_r // in_r)
        xoay = int(ng_d // in_r) * int(ng_r // in_d)
        return max(thang, xoay) or None

    def tinh_nguoc_routing(
        self, lsx: Lsx, *, so_con: int | None = None, bo_hao_step_keys: set[str] | None = None,
    ) -> list[dict]:
        """Chạy NGƯỢC chuỗi công đoạn từ SL thành phẩm → SL vào/ra của từng bước.

        Đúng chiều tư duy xưởng và đúng mô hình BC (`Input = Output × (1 + Scrap%) + FixedScrap`,
        cộng dồn từ bước CUỐI về bước ĐẦU): *cần 20.500 hộp tốt thì phải in bao nhiêu tờ*.

        Dòng giấy có BA đơn vị và HAI cầu (`to_nguyen → to → cai`):
        - Bước **NGOÀI dòng giấy đứng ngoài chuỗi** — nhận ra bằng ô đơn vị BỎ TRỐNG (06/09/2026;
          giữa 11/08 và 06/09 nó khai đơn vị thật `bai → kem` và phải hỏi cờ `tram_dong_giay`).
          Hàm này KHÔNG trả gì cho nó: số của bước ấy do người lập lệnh tự khai ở bước
          (`tu_khai_don_vi`), duyệt cả bước này là "Tính ngược" ghi đè kẽm bằng số tờ. Công thức
          sản lượng ra ở danh mục công đoạn GỠ 18/09/2026 (mg `0324`).
        - Đích = đơn vị RA của bước cuối SAU KHI LỌC: ra `cai` thì đích là SL đặt.
        - Hao lấy từ DANH MỤC công đoạn (`bu_hao_engine.hao_buoc`) ở ĐÚNG đơn vị của bước, không
          đọc `cd.hao_hut` nữa. Hao thêm của kế hoạch (`lsx.bu_hao_to`) cộng vào bước CUỐI.
        - `%` đo trên số RA của bước (chốt 06/09/2026): ra 100 hao 10% ⇒ vào 110, KHÔNG phải
          111,11. Cùng một nghĩa với `bu_hao_engine.chuoi_nguoc_dv` — hai tầng phải ra một số.

        Hàm THUẦN — chỉ trả số, KHÔNG ghi DB (`_ap_chuoi_nguoc` mới ghi). `so_con` cho phép hỏi
        "nếu xếp N con/tờ thì cần bao nhiêu tờ" mà không đụng cột của lệnh — bài ghép cần đúng thế.
        """
        buoc = sorted(lsx.cong_doans, key=lambda c: c.thu_tu)
        tram = self._tram()
        # Tề sóng (24/10/2026) đếm tờ nhưng KHÔNG nằm trên dòng giấy: nó nhánh song song nhả vào bồi,
        # tính riêng ở cuối hàm.
        idx = [i for i, c in enumerate(buoc)
               if tren_dong_giay(c.don_vi_vao, c.don_vi_ra, tram) and not self._la_te_song(c)]
        he_so = self._he_so_cau(lsx, so_con=so_con)
        cd_cache: dict[int, dict] = {}

        def _quy_tac_bu_hao(cong_doan_id) -> dict:
            """Quy tắc bù hao của DANH MỤC công đoạn — `hao_buoc` chỉ cần 3 khoá này."""
            if not cong_doan_id:
                return {}
            if cong_doan_id not in cd_cache:
                obj = self.db.get(CongDoan, cong_doan_id)
                cd_cache[cong_doan_id] = {} if obj is None else {
                    "kieu_bu_hao": obj.kieu_bu_hao,
                    "bac_bu_hao": obj.bac_bu_hao,
                    "so_to_bu_hao": obj.so_to_bu_hao,
                }
            return cd_cache[cong_doan_id]

        out: list[dict] = [{} for _ in buoc]
        # Bước NGOÀI dòng giấy (ghi kẽm, phơi bản…) không có dòng nào ở đây: số của nó do người lập
        # lệnh tự khai ở bước. `buoc_ngoai_dong` (tính từ `cong_thuc_san_luong`) GỠ 18/09/2026.
        # `idx` để áp ngược, KHÔNG khớp theo `id` (lúc `tao()` id còn None).
        if not idx:
            return [o for o in out if o]

        # Đích = SL đặt QUY VỀ đơn vị ra của bước cuối. Bản cũ luôn lấy thẳng SL đặt, nên routing
        # kết ở `con` (bế xong là hết) bị hiểu là "cần ngần ấy CON" trong khi khách đặt ngần ấy CÁI
        # — lệch đúng số con/cái. Dùng chung công thức với engine tính giá, xem `dich_chuoi`.
        can_ra = dich_chuoi(
            float(lsx.so_luong_dat or 0),
            tram_ra_cuoi=tram_cua(buoc[idx[-1]].don_vi_ra, tram),
            cai_moi_to=he_so.get((TRAM_TO, TRAM_CAI)) or 1.0,
            he_so=he_so,
        )
        for pos in range(len(idx) - 1, -1, -1):
            i = idx[pos]
            cd = buoc[i]
            tram_vao, tram_ra = tram_cua(cd.don_vi_vao, tram), tram_cua(cd.don_vi_ra, tram)
            if bo_hao_step_keys and cd.step_key in bo_hao_step_keys:
                # Bước đã CHUYỂN TẦNG hao lên bài ghép: một lượt in chung thì chỉ canh máy một lần,
                # để hao ở đây nữa là mỗi lệnh trong bài cộng thêm một bộ hao cho cùng lượt in đó.
                fixed, pct = 0.0, 0.0
            else:
                fixed, pct = hao_buoc(_quy_tac_bu_hao(cd.cong_doan_id), sl=can_ra)
            hs = he_so.get((tram_vao, tram_ra), 1.0) if tram_vao != tram_ra else 1.0
            pct = max(pct, 0.0)
            vao = float(ceil(can_ra / hs * (1.0 + pct / 100.0) + fixed))
            out[i] = {
                # `idx` = vị trí trong danh sách đã sort — dùng để áp ngược. KHÔNG khớp theo `id`:
                # lúc `tao()` các bước chưa flush nên `id` còn None, khớp theo id là trượt sạch.
                "idx": i,
                "id": cd.id, "thu_tu": cd.thu_tu, "ten": cd.ten,
                "so_luong_vao": vao,
                "so_luong_ra": float(ceil(can_ra)),
                "don_vi_vao": cd.don_vi_vao, "don_vi_ra": cd.don_vi_ra,
                "he_so_quy_doi": hs, "hao_hut": fixed, "hao_hut_pct": pct,
            }
            can_ra = vao  # bước trước phải GIAO đủ chừng này
        # TỀ SÓNG: ra = SL vào bước bồi đầu (đã tính ở trên); vào = ra + hao của chính nó.
        id_boi = self._id_boi()
        boi = next((out[i] for i, c in enumerate(buoc) if c.cong_doan_id in id_boi and out[i]), None)
        for i, cd in enumerate(buoc):
            if boi is None or not self._la_te_song(cd):
                continue
            ra = float(boi["so_luong_vao"])
            fixed, pct = ((0.0, 0.0) if bo_hao_step_keys and cd.step_key in bo_hao_step_keys
                          else hao_buoc(_quy_tac_bu_hao(cd.cong_doan_id), sl=ra))
            pct = max(pct, 0.0)
            out[i] = {
                "idx": i, "id": cd.id, "thu_tu": cd.thu_tu, "ten": cd.ten,
                "so_luong_vao": float(ceil(ra * (1.0 + pct / 100.0) + fixed)), "so_luong_ra": ra,
                "don_vi_vao": cd.don_vi_vao, "don_vi_ra": cd.don_vi_ra,
                "he_so_quy_doi": 1.0, "hao_hut": fixed, "hao_hut_pct": pct,
            }
        return [o for o in out if o]

    def tinh_xuoi_tu_to(
        self, lsx: Lsx, *, tu_step_key: str, so_to: float, so_con: int | None = None,
    ) -> list[dict]:
        """Chạy XUÔI từ số tờ THẬT giao cho lệnh → sản lượng thật ở từng bước sau đó.

        Lượt về trả lời "cần bao nhiêu tờ để đủ hàng". Ghép bài thì câu hỏi ngược lại: bài in
        `so_to` tờ chung cho mọi lệnh, vậy TỪNG lệnh thật sự ra bao nhiêu? Không có lượt đi thì
        chỗ đó phải đoán bằng `so_to × con` — tức bỏ qua toàn bộ hao của các bước sau in, và số
        dư báo lên gấp cả chục lần thực tế.

        Nghịch đảo đúng công thức của lượt về (`vào = ra/hs × (1 + %) + tờ`):
            `ra = (vào − tờ) ÷ (1 + %) × hs`

        `tu_step_key` là ĐIỂM TOẢ — bước chạy chung cuối cùng. Bài giao `so_to` TỜ vào bước đó, và
        chính bước đó có thể đổi đơn vị (bế: 1 tờ → N con). Nên phải áp HỆ SỐ của bước toả trước
        khi chạy tiếp, nếu không thì bước kế nhận số tờ mà tưởng là số con — sản lượng hụt đúng
        `con` lần. HAO của bước toả thì KHÔNG áp: nó đã đếm một lần ở tầng bài.
        """
        buoc = sorted(lsx.cong_doans, key=lambda c: c.thu_tu)
        tram = self._tram()
        idx = [i for i, c in enumerate(buoc)
               if tren_dong_giay(c.don_vi_vao, c.don_vi_ra, tram)]
        try:
            bat_dau = next(p for p, i in enumerate(idx) if buoc[i].step_key == tu_step_key)
        except StopIteration:
            return []

        he_so = self._he_so_cau(lsx, so_con=so_con)
        cd_cache: dict[int, dict] = {}

        def _quy_tac(cong_doan_id) -> dict:
            if not cong_doan_id:
                return {}
            if cong_doan_id not in cd_cache:
                obj = self.db.get(CongDoan, cong_doan_id)
                cd_cache[cong_doan_id] = {} if obj is None else {
                    "kieu_bu_hao": obj.kieu_bu_hao,
                    "bac_bu_hao": obj.bac_bu_hao,
                    "so_to_bu_hao": obj.so_to_bu_hao,
                }
            return cd_cache[cong_doan_id]

        def _hs(cd) -> float:
            """Hệ số cầu của bước — tra theo TRẠM, không theo mã đơn vị (xem `tinh_nguoc_routing`)."""
            tv, tr = tram_cua(cd.don_vi_vao, tram), tram_cua(cd.don_vi_ra, tram)
            return he_so.get((tv, tr), 1.0) if tv != tr else 1.0

        cd_toa = buoc[idx[bat_dau]]
        out: list[dict] = []
        dang_co = float(so_to) * _hs(cd_toa)   # đã ở ĐƠN VỊ VÀO của bước kế tiếp
        for pos in range(bat_dau + 1, len(idx)):
            i = idx[pos]
            cd = buoc[i]
            fixed, pct = hao_buoc(_quy_tac(cd.cong_doan_id), sl=dang_co)
            pct = max(pct, 0.0)
            hs = _hs(cd)
            ra = (dang_co - fixed) / (1.0 + pct / 100.0) * hs
            ra = max(0.0, floor(ra))
            out.append({
                "idx": i, "step_key": cd.step_key, "thu_tu": cd.thu_tu, "ten": cd.ten,
                "so_luong_vao": dang_co, "so_luong_ra": ra,
                "don_vi_vao": cd.don_vi_vao, "don_vi_ra": cd.don_vi_ra,
                "he_so_quy_doi": hs, "hao_hut": fixed, "hao_hut_pct": pct,
            })
            dang_co = ra
        return out

    def _bo_hao_do_ghep(self, lsx: Lsx) -> set[str] | None:
        """Bước của lệnh đang bị bài ghép ĐÈ → hao đã đếm một lần ở tầng bài, đừng cộng lại.

        Không có chỗ nối này thì `lsx_cong_doan` vẫn LƯU hao riêng của từng lệnh cho bước chạy
        chung: bài ghép hiển thị một bộ hao, mà DB giữ hai bộ — hai nguồn sự thật lệch nhau ngay
        ở con số quan trọng nhất (số giấy phải mua).
        """
        if not lsx.id:
            return None
        keys = set(self.db.execute(
            select(BaiGhepCongDoanMap.lsx_step_key)
            .where(BaiGhepCongDoanMap.lsx_id == lsx.id)
        ).scalars())
        return keys or None

    def _la_lenh_di_kem(self, lsx: Lsx) -> bool:
        """Lệnh có bước nào nhả hàng sang bước của LỆNH KHÁC (bìa nhập vào bước vào keo của ruột)."""
        if lsx.id is None:
            return False
        Truoc, Sau = aliased(LsxCongDoan), aliased(LsxCongDoan)
        return self.db.execute(
            select(LsxCongDoanPhuThuoc.id)
            .join(Truoc, LsxCongDoanPhuThuoc.buoc_truoc_id == Truoc.id)
            .join(Sau, LsxCongDoanPhuThuoc.buoc_sau_id == Sau.id)
            .where(Truoc.lsx_id == lsx.id, Sau.lsx_id != lsx.id).limit(1)
        ).first() is not None

    def _lenh_nguon_cheo(self, lsx_id: int) -> set[int]:
        """Lệnh khác có bước nhả hàng vào bước của lệnh `lsx_id` — tức các lệnh đi kèm của nó."""
        Truoc, Sau = aliased(LsxCongDoan), aliased(LsxCongDoan)
        return set(self.db.scalars(
            select(Truoc.lsx_id).select_from(LsxCongDoanPhuThuoc)
            .join(Truoc, LsxCongDoanPhuThuoc.buoc_truoc_id == Truoc.id)
            .join(Sau, LsxCongDoanPhuThuoc.buoc_sau_id == Sau.id)
            .where(Sau.lsx_id == lsx_id, Truoc.lsx_id != lsx_id)
        ))

    def _ap_chuoi_nguoc(self, lsx: Lsx) -> None:
        """GHI kết quả chuỗi ngược vào từng bước + hai mốc số tờ của lệnh. KHÔNG commit.

        Gọi ở MỌI cửa làm số đổi (`tao`, `update`, `replace_routing`) — số lượng bước nay là dẫn
        xuất, không phải thứ client gửi lên. Cũng làm luôn việc **kế thừa lại đơn vị từ danh mục**:
        đơn vị không sửa được ở lệnh nên giữ bản sao chỉ tổ lệch khi danh mục đổi.
        """
        buoc = sorted(lsx.cong_doans, key=lambda c: c.thu_tu)
        tram = self._tram()
        # LƯỢT 1 — kế thừa lại đơn vị từ DANH MỤC. Phải xong hết lượt này rồi mới đọc được "chặng
        # tờ in của lệnh": chính lượt này là nơi đơn vị được ghi, đọc trước là đọc trạng thái cũ.
        # `khai_tay` = bước ngoài dòng giấy có đơn vị do người kế hoạch khai TẠI LỆNH (xem
        # `tu_khai_don_vi`). Cả hai lượt dưới đều phải chừa nó ra, nếu không thì gõ xong bấm Lưu
        # phát nữa là bay sạch — đó đúng là lý do ô ghi kẽm đứng im ở `0 –` bấy lâu.
        # Chọn nhầm hai mã CHẶNG (`to → cai`) thì bước nhập hẳn vào dòng giấy: lúc ấy không còn là
        # khai tay nữa mà là một bước trên chuỗi, để chuỗi ngược tính như mọi bước khác.
        tu_danh_muc: dict[int, bool] = {}
        khai_tay: dict[int, bool] = {}
        for i, cd in enumerate(buoc):
            obj = self.db.get(CongDoan, cd.cong_doan_id) if cd.cong_doan_id else None
            tu_danh_muc[i] = obj is not None or cd.nhom == "prepress"
            khai_tay[i] = (tu_khai_don_vi(cd, obj)
                           and not tren_dong_giay(cd.don_vi_vao, cd.don_vi_ra, tram))
            if khai_tay[i]:
                continue
            if obj is not None:
                cd.don_vi_vao, cd.don_vi_ra, _hs = _don_vi_theo_buoc(obj)
            elif cd.nhom == "prepress":
                cd.don_vi_vao = cd.don_vi_ra = None
        # Đơn vị chặng TỜ IN của CHÍNH lệnh này — cho bước tự thêm đứng ĐẦU chuỗi (không có bước
        # trước để nối tiếp). Trước đây chỗ đó đóng đinh mã `to`: xưởng khai `to_chay` thì mã `to`
        # không có trong danh mục ⇒ bước rớt khỏi dòng giấy và hao của nó biến mất khỏi số giấy phải
        # mua, không một dòng cảnh báo. Lệnh chưa có bước nào nối danh mục ⇒ hỏi danh mục Đơn vị
        # (`ma_cua_tram`), vẫn không rõ thì để None và bước sẽ đeo cảnh báo `buoc_ngoai_dong_giay`.
        dv_to_lenh = don_vi_chuoi(buoc, tram)["to"] or ma_cua_tram(TRAM_TO, tram)
        # LƯỢT 2 — bước kế hoạch TỰ THÊM nối tiếp đơn vị bước liền trước, không đổi cách đếm.
        truoc_ra: str | None = None
        for i, cd in enumerate(buoc):
            if khai_tay[i]:
                # Đơn vị khai tay KHÔNG được làm mốc nối cho bước sau: `kem` chảy sang bước tự thêm
                # đứng kế là bước ấy rơi khỏi dòng giấy, hao của nó biến mất khỏi số giấy phải mua.
                # Bước ngoài dòng kế thừa danh mục vốn để trống nên `or truoc_ra` tự giữ mốc cũ —
                # đây chỉ giữ đúng hành vi ấy khi hai ô đã có chữ.
                continue
            if not tu_danh_muc[i]:
                cd.don_vi_vao = cd.don_vi_ra = truoc_ra or dv_to_lenh
            truoc_ra = cd.don_vi_ra or truoc_ra
        # LƯỢT 3 (11/10/2026) — bước cuối của LỆNH CHÍNH ra chặng Thành phẩm = đơn vị tính của sản
        # phẩm trên lệnh, danh mục khai gì cũng vậy. Danh mục sách khai "Xén 3 mặt" tay → tay thì
        # KCS cuối đếm tay, kho nhận cuốn, mà tay ↔ cuốn không có quy đổi chung (số tay mỗi cuốn
        # đi theo từng sách) ⇒ gửi kho gãy. Cầu đổi dạng do `_he_so_cau` cấp từ chính sản phẩm.
        # Lệnh ĐI KÈM (bìa…) nhả bán thành phẩm sang lệnh khác nên giữ đơn vị danh mục. Chặng vào
        # không có cầu tới Thành phẩm (tờ nguyên) thì để yên — ép vào là chia hệ số 1, sai số giấy.
        # Luật: docs/superpowers/specs/2026-10-11-buoc-cuoi-theo-don-vi-san-pham-design.md.
        tren = [cd for cd in buoc if tren_dong_giay(cd.don_vi_vao, cd.don_vi_ra, tram)]
        if (tren and tram_cua(tren[-1].don_vi_vao, tram) in _CO_CAU_TOI_THANH_PHAM
                and not self._la_lenh_di_kem(lsx)):
            tren[-1].don_vi_ra = ma_cua_tram(TRAM_CAI, tram) or DV_CAI
        rows = {r["idx"]: r for r in self.tinh_nguoc_routing(
            lsx, bo_hao_step_keys=self._bo_hao_do_ghep(lsx),
        )}
        for i, cd in enumerate(buoc):
            r = rows.get(i)
            if r is None:            # bước ngoài dòng giấy (chế bản) — giữ nguyên số kẽm
                if khai_tay[i]:
                    # Hai đầu đều là số người ta gõ ⇒ không còn phép suy nào để hao hay hệ số quy
                    # đổi tham gia. Bỏ qua thì ba cột này nằm lại ở giá trị của lần danh mục tính
                    # cuối, rồi drawer đọc thành "Số vào = 1 bài in = 6 bản kẽm + 2 bài in hao" —
                    # sai số học; `ty_le_hao_hut` và cảnh báo vượt định mức hao cũng đo trên số cũ.
                    cd.hao_hut = 0.0
                    cd.hao_hut_pct = 0.0
                    cd.he_so_quy_doi = 0.0
                continue
            cd.so_luong_vao = r["so_luong_vao"]
            cd.so_luong_ra = r["so_luong_ra"]
            cd.he_so_quy_doi = r["he_so_quy_doi"]
            cd.hao_hut = r["hao_hut"]
            cd.hao_hut_pct = r["hao_hut_pct"]

        # Hai mốc số tờ = ĐỌC RA khỏi chuỗi tại đúng ranh giới, không tính riêng bên ngoài.
        # Dò theo TRẠM: xưởng khai mã riêng cho chặng tờ in thì dò theo mã không thấy, hai mốc rơi
        # về 0 và số giấy phải mua biến mất — hỏng im lặng.
        tram = self._tram()

        def _vao_tai(tram_can: str) -> float | None:
            # Tề sóng đếm tờ khổ in của SÓNG, không phải tờ in của lệnh.
            return next((r["so_luong_vao"] for i, cd in enumerate(buoc)
                         if (r := rows.get(i)) and not self._la_te_song(cd)
                         and tram_cua(cd.don_vi_vao, tram) == tram_can), None)

        to_in = _vao_tai(TRAM_TO)
        lsx.so_to_ke_hoach = int(to_in or 0)
        nguyen = _vao_tai(TRAM_TO_NGUYEN)
        if nguyen is not None:
            lsx.so_to_nguyen = int(nguyen)
        else:
            # Chuỗi không có bước xả → quy đổi ở đây, đúng fallback `thanh_phan_engine` đang dùng.
            xa = self._he_so_cau(lsx)[(TRAM_TO_NGUYEN, TRAM_TO)]
            lsx.so_to_nguyen = ceil(lsx.so_to_ke_hoach / xa) if lsx.so_to_ke_hoach else 0
        # CUỐI CÙNG: dòng giấy của từng bước đọc số vào/ra vừa ghi ở trên.
        self._dong_bo_dong_giay(lsx)

    # ================= KHÂU CHUẨN BỊ GIẤY (spec 2026-10-24-chuan-bi-giay §7) =================

    def _ma_cd(self, cd) -> str | None:
        obj = self.db.get(CongDoan, cd.cong_doan_id) if getattr(cd, "cong_doan_id", None) else None
        return obj.ma if obj is not None else None

    def _la_te_song(self, cd) -> bool:
        id_ts = id_cong_doan_he_thong(self.db, CD_TE_SONG)
        return bool(id_ts) and getattr(cd, "cong_doan_id", None) == id_ts

    def _id_boi(self) -> set[int]:
        return {i for ma in CD_BOI if (i := id_cong_doan_he_thong(self.db, ma))}

    @staticmethod
    def _buoc_in(buoc) -> LsxCongDoan | None:
        return next((c for c in buoc if c.nhom == "print"), None)

    def _dau_vao_giay(self, lsx: Lsx, so_to_in: float) -> DauVaoGiay | None:
        """Đầu vào chọn nguồn của lệnh — giấy của sản phẩm + khổ in + khổ nguyên + số mảnh xả. Lệnh
        không giấy ⇒ None. Thiếu khổ nguyên / mảnh xả để None — `chon_nguon` tự lui về tờ khổ in."""
        qc = lsx.quy_cach_json or {}
        if not qc.get("giay_id"):
            return None
        giay = self.db.get(GiayNguyen, int(qc["giay_id"]))
        kn = (int(_f(qc.get("kho_nguyen_rong"))), int(_f(qc.get("kho_nguyen_dai"))))
        return DauVaoGiay(
            giay_id=int(qc["giay_id"]), gsm=_f(getattr(giay, "gsm", None)),
            kho_in=(int(_f(qc.get("kho_in_rong"))), int(_f(qc.get("kho_in_dai")))),
            kho_nguyen=kn if all(kn) else None,
            so_to_in=int(ceil(_f(so_to_in))), so_manh_xa=int(_f(qc.get("so_manh_xa"))) or None)

    def _chon_nguon_giay(self, lsx: Lsx) -> NguonChon | None:
        """Nguồn giấy theo TỒN TỰ DO (tồn − đang giữ), đọc MỘT lượt cho mọi khoá ứng viên. Chọn sau
        chuỗi ngược lần đầu: cần SL vào In."""
        in_ = self._buoc_in(sorted(lsx.cong_doans, key=lambda c: c.thu_tu))
        dv = self._dau_vao_giay(lsx, in_.so_luong_vao) if in_ is not None else None
        return self._chon_nguon_theo_ton(dv) if dv is not None else None

    def _chon_nguon_theo_ton(self, dv: DauVaoGiay) -> NguonChon:
        """`chon_nguon` trên tồn tự do của mọi khoá ứng viên — dùng chung cho lệnh và bài ghép."""
        from types import SimpleNamespace

        from ..repositories.stock_lot_repo import StockLotRepository
        from .giu_cho_service import GiuChoService

        ton = GiuChoService(self.db, SimpleNamespace(lots=StockLotRepository(self.db))).ton_tu_do(
            khoa_ung_vien(dv))
        return chon_nguon(dv, lambda k: ton.get(k, 0.0))

    def _them_buoc_he_thong(self, lsx: Lsx, ma: str) -> LsxCongDoan | None:
        obj = self.db.get(CongDoan, id_cong_doan_he_thong(self.db, ma) or 0)
        if obj is None:
            return None
        qc = lsx.quy_cach_json or {}
        d = self._default_buoc({"cong_doan_id": obj.id, "nhom": obj.nhom, "ten": obj.ten},
                               comp={"con": lsx.so_con, "so_manh_xa": qc.get("so_manh_xa")},
                               lsx_may_id=lsx.may_id)
        cd = LsxCongDoan(thu_tu=0, cong_doan_id=obj.id, ten=obj.ten, nhom=obj.nhom, phu_thuoc=[], **d)
        lsx.cong_doans.append(cd)
        return cd

    def _gan_giay(self, cd: LsxCongDoan, giay_id: int, dong: dict) -> None:
        """Dòng giấy/sóng máy gắn (`tu_dong=False`: đổi công đoạn không quét mất). Số do
        `_dong_bo_dong_giay` ghi ở cuối chuỗi ngược; khổ ghi ngay vì cuộn giữ rộng cuộn ở đây."""
        g = self.db.get(GiayNguyen, giay_id)
        cd.vat_tus.append(LsxCongDoanVatTu(
            hang_loai=HANG_GIAY, vat_tu_id=giay_id, vat_tu_ma_snapshot=getattr(g, "ma", None) or "",
            vat_tu_ten_snapshot=getattr(g, "ten", None) or "", don_vi_snapshot=dong["don_vi_goc"],
            so_luong=0, thu_tu=max((v.thu_tu for v in cd.vat_tus), default=-1) + 1, tu_dong=False,
            gia_tri_chip={}, kho_rong=dong["kho_rong"], kho_dai=dong["kho_dai"],
            don_vi_goc=dong["don_vi_goc"]))

    def _dung_khau_chuan_bi(self, lsx: Lsx, nguon: NguonChon | None) -> list[LsxCongDoan]:
        """Chèn Cắt giấy cuộn / Tề giấy in ngay trước In (theo `nguon`) và Tề sóng ngay trước bước bồi (có sóng
        + có bước bồi), gắn giấy vào bước đầu khâu, sóng vào Tề sóng, ghi `lsx.nguon_giay`. KHÔNG commit.

        Lệnh phải có id (cạnh trỏ id bước). Cạnh: bước trước In chuyển sang trỏ bước chuẩn bị đầu, khâu
        nối thẳng một hàng vào In; Tề sóng chỉ nối vào bước bồi đầu, chạy song song nhánh giấy.
        Trả các bước vừa chèn để bên gọi bung vật tư định mức sau chuỗi ngược."""
        buoc = sorted(lsx.cong_doans, key=lambda c: (c.thu_tu, c.id or 0))
        qc = lsx.quy_cach_json or {}
        in_ = self._buoc_in(buoc)
        dv = self._dau_vao_giay(lsx, in_.so_luong_vao) if in_ is not None else None
        # Phiếu kiểu cũ đã tự khai bước chuẩn bị giấy trước In (xả/cắt tờ): chèn thêm là chia mảnh xả
        # hai lần. Giữ nguyên tuyến, giấy gắn vào bước đầu dòng giấy, lệnh đi luật cũ (`nguon_giay` NULL).
        tram = self._tram()
        dong_giay = [c for c in buoc if tren_dong_giay(c.don_vi_vao, c.don_vi_ra, tram)
                     and not self._la_te_song(c)]
        tu_khai = in_ is not None and bool(dong_giay) and dong_giay[0] is not in_ and (
            dong_giay[0].thu_tu <= in_.thu_tu)
        if tu_khai:
            nguon = None
        lsx.nguon_giay = nguon.nguon if (nguon is not None and dv is not None) else None
        khau = [b for ma in (ma_buoc_giay(lsx.nguon_giay, dv) if lsx.nguon_giay else [])
                if (b := self._them_buoc_he_thong(lsx, ma)) is not None]
        ts = next((c for c in buoc if self._la_te_song(c)), None)
        boi = next((c for c in buoc if c.cong_doan_id in self._id_boi()), None)
        ts_moi = None
        if qc.get("song_id") and boi is not None and ts is None:
            ts = ts_moi = self._them_buoc_he_thong(lsx, CD_TE_SONG)
        con_lai = [c for c in buoc if c is not ts]
        vt = con_lai.index(in_) if in_ in con_lai else len(con_lai)
        thu_tu = con_lai[:vt] + khau + con_lai[vt:]
        # Tề sóng đứng NGAY TRƯỚC bước bồi nó nối vào (e2e 24/10/2026): để đầu danh sách thì dải tên
        # và bảng đọc thành "Tề sóng › Cắt giấy cuộn › Tề giấy in", như thể sóng chảy vào nhánh giấy.
        if ts is not None:
            thu_tu.insert(thu_tu.index(boi) if boi in thu_tu else 0, ts)
        for i, c in enumerate(thu_tu):
            c.thu_tu = i
        self.db.flush()
        if khau:
            for e in list(in_.phu_thuoc):
                in_.phu_thuoc.remove(e)
                khau[0].phu_thuoc.append(LsxCongDoanPhuThuoc(buoc_truoc_id=e.buoc_truoc_id))
            for truoc, sau in zip(khau, khau[1:] + [in_]):
                sau.phu_thuoc.append(LsxCongDoanPhuThuoc(buoc_truoc_id=truoc.id))
        if ts_moi is not None:
            boi.phu_thuoc.append(LsxCongDoanPhuThuoc(buoc_truoc_id=ts_moi.id))
        if lsx.nguon_giay:
            # Giấy CHỈ ở bước đầu khâu (không khâu ⇒ In): gỡ dòng của mã này ở mọi bước khác trước.
            for c in lsx.cong_doans:
                for v in [v for v in c.vat_tus if v.hang_loai == HANG_GIAY and v.vat_tu_id == dv.giay_id]:
                    c.vat_tus.remove(v)
            self.db.flush()
            self._gan_giay(khau[0] if khau else in_, dv.giay_id, dong_giay_buoc_dau(nguon, dv, 0))
        elif tu_khai and dv is not None and not any(
                v.hang_loai == HANG_GIAY and v.vat_tu_id == dv.giay_id for v in dong_giay[0].vat_tus):
            self._gan_giay(dong_giay[0], dv.giay_id, {"don_vi_goc": "", "kho_rong": 0, "kho_dai": 0})
        elif in_ is None and qc.get("giay_id") and buoc:
            # Không có bước In thì không chọn được nguồn — vẫn giữ giấy ở bước đầu dòng giấy (luật cũ),
            # mất dòng này là mất nhu cầu ở Kế hoạch vật tư.
            dau = dong_giay[0] if dong_giay else buoc[0]
            if not any(v.hang_loai == HANG_GIAY and v.vat_tu_id == int(qc["giay_id"]) for v in dau.vat_tus):
                self._gan_giay(dau, int(qc["giay_id"]), {"don_vi_goc": "", "kho_rong": 0, "kho_dai": 0})
        if ts_moi is not None:
            kho_in = (int(_f(qc.get("kho_in_rong"))), int(_f(qc.get("kho_in_dai"))))
            self._gan_giay(ts_moi, int(qc["song_id"]), dong_song(int(qc["song_id"]), kho_in, 0))
        self.db.flush()
        return [*khau, *([ts_moi] if ts_moi else [])]

    def _go_khau_chuan_bi_giay(self, lsx: Lsx) -> None:
        """Gỡ Cắt giấy cuộn / Tề giấy in của lệnh (cùng dòng giấy của chúng), nối bước đứng trước khâu
        thẳng vào In. Tề sóng giữ nguyên. KHÔNG commit."""
        ids = {i for ma in (CD_CAT_CUON, CD_TE_GIAY_IN) if (i := id_cong_doan_he_thong(self.db, ma))}
        buoc = sorted(lsx.cong_doans, key=lambda c: (c.thu_tu, c.id or 0))
        bo = [c for c in buoc if c.cong_doan_id in ids]
        if not bo:
            return
        bo_ids = {c.id for c in bo}
        truoc_ngoai = list(dict.fromkeys(
            e.buoc_truoc_id for c in bo for e in c.phu_thuoc if e.buoc_truoc_id not in bo_ids))
        nhan = []
        for c in buoc:
            if c in bo:
                continue
            cu = [e for e in c.phu_thuoc if e.buoc_truoc_id in bo_ids]
            for e in cu:
                c.phu_thuoc.remove(e)
            if cu:
                nhan.append(c)
        for c in bo:
            c.phu_thuoc.clear()
        self.db.flush()
        for c in nhan:
            co = {e.buoc_truoc_id for e in c.phu_thuoc}
            for t in truoc_ngoai:
                if t not in co:
                    c.phu_thuoc.append(LsxCongDoanPhuThuoc(buoc_truoc_id=t))
        for c in bo:
            lsx.cong_doans.remove(c)
        for i, c in enumerate(c for c in buoc if c not in bo):
            c.thu_tu = i
        self.db.flush()

    def doi_nguon_giay(self, *, lsx_id: int, nguon: str, rong_cuon: int | None, actor) -> Lsx:
        """Người kế hoạch đổi nguồn giấy: gỡ Cắt giấy cuộn / Tề giấy in hiện có rồi dựng lại theo nguồn
        mới, không đụng bước khác (Tề sóng giữ nguyên). Chặn đúng ba cửa của sửa routing."""
        lsx = self.get(lsx_id)
        if (loi := self._ly_do_khong_cap_nhat(lsx)) is not None:
            raise LsxConflict(loi.replace("lấy số mới của danh mục", "đổi nguồn giấy")
                              .replace("lấy số mới", "đổi nguồn giấy"))
        if self._ghep_cua(lsx) is not None:   # bước chung của bài trỏ vào step_key của lệnh ⇒ gỡ là mồ côi
            raise LsxConflict("Lệnh đang nằm trong bài ghép — bỏ lệnh khỏi bài trước khi đổi nguồn giấy.")
        if nguon not in NGUON_GIAY:
            raise LsxValidationError("Nguồn giấy chỉ nhận: tờ đúng khổ in, tờ khổ nguyên, cuộn, mua mới.")
        in_ = self._buoc_in(sorted(lsx.cong_doans, key=lambda c: c.thu_tu))
        dv = self._dau_vao_giay(lsx, in_.so_luong_vao) if in_ is not None else None
        if dv is None:
            raise LsxValidationError("Lệnh chưa có giấy hoặc chưa có bước In — không có gì để đổi nguồn.")
        if nguon == "cuon":
            if dv.kho_nguyen is None:
                raise LsxValidationError("Lệnh thiếu khổ nguyên — chưa dựng được Cắt giấy cuộn theo rộng cuộn.")
            if not rong_cuon or not any(c <= rong_cuon <= c + CUON_DU_TOI_DA_MM for c in dv.kho_nguyen):
                raise LsxValidationError(
                    f"Rộng cuộn phải bằng một cạnh khổ nguyên ({dv.kho_nguyen[0]} hoặc {dv.kho_nguyen[1]} mm), "
                    f"dư tối đa {CUON_DU_TOI_DA_MM} mm.")
        cu = lsx.nguon_giay
        self._go_khau_chuan_bi_giay(lsx)
        moi = self._dung_khau_chuan_bi(
            lsx, NguonChon(nguon, int(rong_cuon) if nguon == "cuon" else None, None))
        self._ap_chuoi_nguoc(lsx)
        self._bung_lai_vat_tu(lsx, moi)
        thieu = self.thieu_cua(lsx)
        if thieu and lsx.trang_thai != TT_CHO_BO_SUNG:
            lsx.trang_thai = TT_CHO_BO_SUNG
        elif not thieu and lsx.trang_thai == TT_CHO_BO_SUNG:
            lsx.trang_thai = TT_NHAP
        self.audit.create(
            actor_user_id=actor.id, action="doi_nguon_giay", target=f"lsx:{lsx.id}",
            detail=f"Đổi nguồn giấy lệnh {lsx.ma}: {_NHAN_NGUON.get(cu, 'chưa có')} → {_NHAN_NGUON[nguon]}"
                   + (f" rộng {rong_cuon} mm" if nguon == "cuon" else ""))
        self.repo.commit()
        return self.get(lsx_id)

    def _dong_giay_khau_chuan_bi(self, cd, qc: dict, giay_id: int) -> dict | None:
        """Dòng giấy/sóng của lệnh CÓ nguồn giấy (`lsx.nguon_giay`): Cắt giấy cuộn ⇒ kg theo rộng cuộn,
        Tề giấy in ⇒ tờ khổ nguyên, bước khác (In) ⇒ tờ khổ in; sóng ở Tề sóng ⇒ tờ khổ in. Lệnh cũ
        (NULL) hoặc mã không phải giấy/sóng của sản phẩm ⇒ None, đi luật cũ `_dong_giay_cho_ma`."""
        lsx = getattr(cd, "lsx", None)
        if lsx is None or not getattr(lsx, "nguon_giay", None):
            return None
        vao, ma = _f(getattr(cd, "so_luong_vao", 0)), self._ma_cd(cd)
        out = {"ly_do": None, "dien_giai_nguon": None}
        if qc.get("song_id") and int(qc["song_id"]) == giay_id:
            if ma != CD_TE_SONG:
                return None
            d = dong_song(giay_id, (int(_f(qc.get("kho_in_rong"))), int(_f(qc.get("kho_in_dai")))), vao)
        elif qc.get("giay_id") and int(qc["giay_id"]) == giay_id:
            dv = self._dau_vao_giay(lsx, vao)
            if ma == CD_CAT_CUON:
                rong = next((int(v.kho_rong or 0) for v in (getattr(cd, "vat_tus", None) or [])
                             if v.hang_loai == HANG_GIAY and v.vat_tu_id == giay_id), 0)
                if not (rong and dv.kho_nguyen):
                    return {**out, "so_luong": None, "don_vi": "kg", "don_vi_goc": "kg",
                            "kho_rong": rong, "kho_dai": 0,
                            "ly_do": "Chưa có rộng cuộn hoặc khổ nguyên để tính số kg giấy."}
                d = dong_giay_buoc_dau(NguonChon("cuon", rong, None), dv, vao)
            else:
                d = dong_giay_buoc_dau(NguonChon("to_nguyen" if ma == CD_TE_GIAY_IN else "to_in", None, None),
                                       dv, vao)
        else:
            return None
        out.update(so_luong=d["so_luong"], don_vi=d["don_vi_goc"], don_vi_goc=d["don_vi_goc"],
                   kho_rong=d["kho_rong"], kho_dai=d["kho_dai"])
        if d["don_vi_goc"] == DON_VI_TO_KHO and not (d["kho_rong"] and d["kho_dai"]):
            out.update(so_luong=None, ly_do="Chưa có khổ giấy (khổ tờ in / khổ nguyên).")
        return out

    def _goc_mat_hang(self) -> GocMatHang:
        """Một `GocMatHang` cho cả lượt (đọc bảng đơn vị + cặp một lần, không hỏi lại mỗi dòng giấy)."""
        if getattr(self, "_gmh", None) is None:
            self._gmh = GocMatHang.tu_db(self.db)
        return self._gmh

    @staticmethod
    def _sl_ra_buoc_giay(cd, qc: dict) -> tuple[float, str | None]:
        """`(SL ra, chặng của nó)` cho dòng giấy ở bước đầu vào "—" (vd cắt từ cuộn, 18/10/2026): bước
        ngoài dòng giấy không có số của riêng nó, nên SL ra lấy theo chuỗi bù hao ngược = SL vào của
        bước KẾ TIẾP trên dòng giấy. Không có bước kế tiếp thì số ra đã ghi của chính bước, rồi tờ
        nguyên của lệnh. Bước trên dòng giấy trả số ra của chính nó (nhánh tờ không đọc tới)."""
        tram_vao = tram_cua(getattr(cd, "don_vi_vao", None), ban_do_tram())
        if tram_vao is not None:
            return _f(cd.so_luong_ra), tram_cua(getattr(cd, "don_vi_ra", None), ban_do_tram())
        lsx = getattr(cd, "lsx", None)
        moc = (cd.thu_tu or 0, cd.id or 0)
        for b in sorted(getattr(lsx, "cong_doans", None) or [], key=lambda c: (c.thu_tu or 0, c.id or 0)):
            if (b.thu_tu or 0, b.id or 0) <= moc:
                continue
            t = tram_cua(getattr(b, "don_vi_vao", None), ban_do_tram())
            if t is not None and _f(b.so_luong_vao) > 0:
                return _f(b.so_luong_vao), t
        if _f(cd.so_luong_ra) > 0:
            return _f(cd.so_luong_ra), None
        return _f((qc or {}).get("to_nguyen")), TRAM_TO_NGUYEN

    def _quy_kg_ve_goc(self, giay_id: int, goc: str | None) -> dict | str:
        """Quy 1 kg của mã giấy về đơn vị gốc `goc` — `quy_ve_goc` (đọc danh mục) MỘT lần mỗi cặp
        trong lượt, vì bước đầu vào "—"/con/cái nào cũng ra kg mà chi tiết lệnh hỏi từng bước × từng
        mã giấy. Trả kết quả `quy_ve_goc` hoặc câu lỗi."""
        nho = self.__dict__.setdefault("_kg_goc", {})
        if (giay_id, goc) not in nho:
            from ..repositories.don_vi_do_repo import DonViDoRepository
            from ..repositories.vat_lieu_kho_repo import VatLieuKhoRepository
            from .vat_lieu_kho_service import VatLieuKhoError, VatLieuKhoService

            try:
                nho[(giay_id, goc)] = VatLieuKhoService(
                    VatLieuKhoRepository(self.db), DonViDoRepository(self.db)
                ).quy_ve_goc(HANG_GIAY, giay_id, "kg", 1.0, goc=goc)
            except VatLieuKhoError as e:
                nho[(giay_id, goc)] = str(e)
        return nho[(giay_id, goc)]

    def _dong_giay_cho_ma(self, cd, qc: dict, giay_id: int) -> dict:
        """Dòng giấy của MỘT bước ứng với mã giấy `giay_id`, ĐÃ đổi sang đơn vị của mã (spec
        2026-10-01 dong-giay-theo-dau-vao §4). Trả `dong_giay_theo_dau_vao` + `so_luong`/`don_vi`
        theo mã + `don_vi_goc` (máy chủ suy, không ai gõ): bước nhận tờ ⇒ `to`; bước nhận giấy khổ
        rộng (nhánh kg) ⇒ đơn vị giá của mã, số kg quy qua `quy_ve_goc`. Không đổi được (thiếu cặp
        quy đổi kg → đơn vị giá) thì `so_luong=None` + `ly_do`.

        Lệnh có `nguon_giay` (24/10/2026) ⇒ `_dong_giay_khau_chuan_bi`; luật dưới chỉ còn cho lệnh cũ."""
        if (moi := self._dong_giay_khau_chuan_bi(cd, qc, giay_id)) is not None:
            return moi
        giay = self.db.get(GiayNguyen, giay_id)
        sl_ra, tram_ra = self._sl_ra_buoc_giay(cd, qc)
        d = dong_giay_theo_dau_vao(
            don_vi_vao=getattr(cd, "don_vi_vao", None), so_luong_vao=_f(cd.so_luong_vao),
            so_luong_ra=sl_ra, quy_cach=qc, gsm=_f(getattr(giay, "gsm", None)) or None,
            tram_ra=tram_ra)
        # `dong_giay_theo_dau_vao` trả "kg" ở bước nhận con/cái/tay và bước đầu vào "—"; nhận tờ thì đếm tờ.
        kg = d["don_vi"] == "kg"
        gia = (getattr(giay, "don_vi_gia", None) or "").strip().lower() or None
        khai = don_vi_khai(giay) if giay is not None else []
        gmh = self._goc_mat_hang() if khai else None
        goc_kg = gmh.goc("kg", khai) if gmh else None
        # Giấy tờ mà mã CHỈ khai nhóm cân (kg/tấn), không khai tờ (16/10/2026): xưởng vẫn đếm tờ,
        # nhưng kho/mua hàng mã này chỉ có tồn theo cân ⇒ quy số tờ ra kg theo khổ của dòng × gsm.
        # Giữ khổ hai cạnh: tồn giấy tờ mua theo kg vẫn khoá theo khổ tờ. Mã có khai tờ thì đếm tờ.
        if (not kg and d["so_luong"] is not None and goc_kg
                and gmh.goc(DON_VI_TO_KHO, khai) is None):
            gsm = _f(getattr(giay, "gsm", None))
            kg = True
            d["don_vi"] = "kg"
            if gsm <= 0:
                d["so_luong"] = None
                d["ly_do"] = "Giấy chỉ khai đơn vị theo cân mà chưa khai định lượng (gsm) nên không quy được số tờ ra kg."
            else:
                d["so_luong"] = (d["so_luong"] * (d["kho_rong"] / 1000) * (d["kho_dai"] / 1000)
                                 * gsm / 1000)
                d["dien_giai_nguon"] = "Số kg quy từ số tờ đầu vào của bước theo khổ và định lượng"
        # Gốc nhóm cân = đơn vị đã khai mà nhóm của nó chứa kg (ĐVT chính là tờ, khai thêm kg vẫn
        # ra kg); mã chưa khai gì thì lùi về ĐVT chính như trước.
        gia = goc_kg or gia
        d["don_vi_goc"] = (gia or "kg") if kg else DON_VI_TO_KHO
        if kg and d["so_luong"] is not None:
            # Ép gốc = đơn vị giá của mã: thiếu cặp kg → đơn vị giá thì báo, không lặng lẽ để kg.
            r = self._quy_kg_ve_goc(giay_id, gia)
            if isinstance(r, str):
                d["so_luong"], d["ly_do"] = None, r
            else:
                d["so_luong"] = d["so_luong"] * float(r["he_so_ve_goc"])
                d["don_vi"] = d["don_vi_goc"] = r["don_vi_goc"]
        if kg and d["so_luong"] is None:
            d["don_vi"] = gia or "kg"
        return d

    def _dong_bo_dong_giay(self, lsx: Lsx) -> None:
        """Ghi lại MỌI dòng giấy của lệnh theo ĐẦU VÀO của bước chứa nó. KHÔNG commit.

        Số/khổ/đơn vị/đơn vị gốc của dòng giấy là dẫn xuất — không ai gõ. Cửa duy nhất là cuối
        `_ap_chuoi_nguoc`, nên chèn thêm bước rồi gọi chuỗi ngược là dòng giấy của bước ấy đúng ngay.

        Giấy nằm ở bước nào thì bước đó lấy (18/10/2026): KHÔNG còn tự chép giấy của In sang bước cắt
        đứng trước."""
        qc = quy_cach_bien(lsx)
        for cd in lsx.cong_doans:
            for v in cd.vat_tus:
                if v.hang_loai != HANG_GIAY:
                    continue
                d = self._dong_giay_cho_ma(cd, qc, int(v.vat_tu_id))
                if d["so_luong"] is None:
                    # Chưa tính được (thiếu khổ/gsm/cặp quy đổi/đơn vị vào) ⇒ GIỮ nguyên giá trị đã
                    # lưu; lý do hiện qua `vat_tu_goi_y`. Ghi 0 là xoá im lặng dòng đang đúng.
                    continue
                v.don_vi_goc = d["don_vi_goc"]
                v.so_luong = d["so_luong"]
                v.kho_rong, v.kho_dai = d["kho_rong"], d["kho_dai"]
                if d["don_vi"]:
                    v.don_vi_snapshot = d["don_vi"]

    def _may_cua_buoc(self, cd) -> MayThietBi | None:
        """Máy ĐANG GÁN của bước — nguồn SỐNG của tốc độ + thời gian chuẩn bị sau chốt 2026-08-04.
        `db.get` đi qua identity map nên gọi lặp trong một vòng lặp không sinh query mới."""
        return self.db.get(MayThietBi, cd.may_id) if getattr(cd, "may_id", None) else None

    def lead_time(self, lsx: Lsx) -> dict:
        """Tổng thời gian dẫn của cả lệnh + ngày dự kiến xong (thô, 8h/ngày, chưa trừ nghỉ lễ)."""
        chiem_may = 0.0
        durations: dict[int, float] = {}
        qc = quy_cach_bien(lsx)
        for cd in lsx.cong_doans:
            may = self._may_cua_buoc(cd)
            t = thoi_luong_buoc(cd, may, self.sl_tinh_cua_buoc(cd, may, qc))
            durations[cd.id] = t["tong_phut"]
            chiem_may += t["chiem_may_phut"]
        ids = set(durations)
        preds: dict[int, list[int]] = {i: [] for i in ids}
        for a, b in self.db.execute(select(
            LsxCongDoanPhuThuoc.buoc_truoc_id, LsxCongDoanPhuThuoc.buoc_sau_id
        ).where(LsxCongDoanPhuThuoc.buoc_sau_id.in_(ids))).all() if ids else []:
            if a in ids:
                preds[b].append(a)
        memo: dict[int, float] = {}
        def finish(i: int) -> float:
            if i not in memo:
                memo[i] = durations[i] + max((finish(p) for p in preds[i]), default=0.0)
            return memo[i]
        tong = max((finish(i) for i in ids), default=0.0)
        so_ngay = tong / 60.0 / GIO_LAM_MOI_NGAY if tong else 0.0
        han = lsx.han_giao_khach
        con_lai = (han - date.today()).days if han else None
        return {
            "tong_phut": round(tong, 2),
            "chiem_may_phut": round(chiem_may, 2),
            "so_ngay": round(so_ngay, 2),
            "ngay_du_kien_xong": date.today() + timedelta(days=ceil(so_ngay)) if tong else None,
            "ngay_con_lai": con_lai,
        }

    def detail_dict(self, lsx: Lsx) -> dict:
        """Ghép dữ liệu hiển thị (tên đơn/khách/máy/tổ/khuôn) cho 1 lệnh."""
        order = self.db.get(Order, lsx.order_id)
        self._nap_cd(c.cong_doan_id for c in lsx.cong_doans)
        dept_ids = {cd.department_id for cd in lsx.cong_doans if cd.department_id}
        may_ids = {cd.may_id for cd in lsx.cong_doans if cd.may_id}
        if lsx.may_id:
            may_ids.add(lsx.may_id)
        dept_names = self._dept_names(dept_ids)
        may_names = self._may_names(may_ids)
        khuon_map = self._khuon_map({cd.khuon_be_id for cd in lsx.cong_doans})
        thieu, thieu_buoc = self.kiem_thieu(lsx)
        ptg_id = ptg_ma = None
        tp = self._thanh_phan(lsx.phieu_thanh_phan_id)
        if tp is not None:
            ptg = self.db.get(PhieuTinhGia, tp.phieu_id)
            ptg_id, ptg_ma = (ptg.id, ptg.ma) if ptg else (None, None)
        quote_number = quote_version_number = None
        if lsx.quote_version_id:
            ver = self.db.get(QuoteVersion, lsx.quote_version_id)
            if ver is not None:
                quote_version_number = ver.version_number
                from ..models.quotation import Quote

                quote = self.db.get(Quote, ver.quote_id)
                quote_number = quote.quote_number if quote else None
        # Nhãn nhóm ĐỌC SỐNG từ dòng đơn, KHÔNG lấy trong `quy_cach_json`: quy cách là ảnh chụp
        # lúc tạo lệnh nên lệnh tạo trước khi có tính năng nhóm sẽ trống — mà "thuộc sản phẩm nào"
        # là thông tin thương mại, phải luôn đúng hiện tại.
        line = self.db.get(OrderLine, lsx.order_line_id) if lsx.order_line_id else None
        chua_d, chua_r = chua_theo_chieu(lsx.quy_cach_json or {})
        # Quy cách của lệnh là nguồn biến cho quy đổi khoán. Đi qua `quy_cach_bien` chứ KHÔNG lấy
        # `quy_cach_json` trần: năm số dẫn xuất (SL đặt · con/tờ · tờ in · tờ nguyên · tờ sau in)
        # nằm ở cột, thiếu chúng thì công thức khoán dùng `to_dau_vao` báo "chưa biết Tờ vào máy"
        # ngay giữa màn đang hiện số tờ đó.
        qc_bien = quy_cach_bien(lsx)
        # SỐ LƯỢNG LÀ ẢNH CHỤP lúc tạo lệnh — engine chỉ chạy lại ở ba cửa: tạo · sửa quy cách ·
        # lưu routing. Danh mục đổi sau đó (bậc bù hao, công thức đơn vị, hệ số ngoài dòng) thì lệnh
        # đã tạo KHÔNG hay biết, và người kế hoạch cũng không có gì để mà biết mà bấm Lưu.
        #
        # Nên tính lại NGẦM ở đây rồi SO với số đã lưu. Khác thì phơi ra `so_luong_*_moi` để màn
        # gạch số cũ + hiện nhãn "tính lại". CỐ Ý KHÔNG tự đè: lệnh đã phát xuống xưởng mà số giấy
        # tự đổi dưới chân người kế hoạch còn tệ hơn số cũ — máy đề xuất, người quyết.
        moi = {r["idx"]: r for r in self.tinh_nguoc_routing(lsx)}
        thu_tu_idx = {id(c): i for i, c in enumerate(sorted(lsx.cong_doans, key=lambda x: x.thu_tu))}
        buoc_dicts = [
            self._cong_doan_dict(cd, dept_names, may_names, qc_bien,
                                 moi.get(thu_tu_idx.get(id(cd), -1)), khuon_map)
            for cd in lsx.cong_doans
        ]
        # Bước đã có việc chạy ở bàn tổ thì `replace_routing` không cho đổi tổ/máy — gửi cờ để ngăn
        # bước khoá sẵn hai ô đó, khỏi để người lập chọn xong mới ăn lỗi lúc Lưu (23/10/2026).
        bat_dau = self.repo.buoc_da_bat_dau({cd.id for cd in lsx.cong_doans if cd.id})
        for d in buoc_dicts:
            d["da_bat_dau"] = d["id"] in bat_dau
        return {
            "nhom": getattr(line, "nhom", None),
            "order_no": order.order_no if order else None,
            "order_status": order.status if order else None,
            "customer_name": self._customer_name(order) if order else None,
            "customer_po_no": order.customer_po_no if order else None,
            "sale_name": self._user_name(order.sale_user_id) if order else None,
            # "Lưu ý sản xuất (gửi xưởng)" của ĐƠN — đọc SỐNG (sale sửa lúc nào thợ thấy lúc đó),
            # KHÔNG ảnh chụp. Đây là nguồn DUY NHẤT của ô lưu ý thợ thấy trên lệnh; khác hẳn
            # `ghi_chu_ky_thuat` (ghi chú kỹ thuật theo sản phẩm, chốt ở khâu tính giá).
            "luu_y_gui_xuong": order.production_note if order else None,
            "quote_number": quote_number,
            "quote_version_number": quote_version_number,
            "ptg_id": ptg_id,
            "ptg_ma": ptg_ma,
            "may_ten": may_names.get(lsx.may_id),
            "nguoi_phu_trach_ten": self._user_name(lsx.nguoi_phu_trach_id),
            "thieu": thieu,
            "thieu_buoc": thieu_buoc,
            "lead_time": self.lead_time(lsx),
            "cong_doans": buoc_dicts,
            # KHÔNG có `khoan_tien_tong` (gỡ 11/09/2026). Tổng công thợ của lệnh là số của kế toán
            # lương, tính theo bảng giá TẠI KỲ TÍNH LƯƠNG — cộng ở đây là bày một con số mà tầng
            # dưới không có gì để đối chiếu, và nó từng là con số duy nhất người xem tin.
            # Chừa TÁCH CHIỀU — tính LÚC ĐỌC bằng đúng hàm của engine, kể cả cho lệnh cũ. Màn lệnh
            # chỉ việc hiện: để nó tự cộng lại từ các khoản chừa là đẻ ra bản thứ hai của công
            # thức, mà bản thứ hai chính là chỗ vừa sai (gộp 20/20 thay vì 15/10).
            "chua_dai": chua_d,
            "chua_rong": chua_r,
            # MÃ đơn vị bốn CHẶNG dòng giấy của lệnh này. Server chấm MỘT chỗ (`don_vi_chuoi`) rồi
            # gửi cho cả ba màn — danh sách, hàng chờ, chi tiết. Trước đây màn chi tiết tự suy lại
            # bằng bản chép tay bên frontend; hai bản cùng luật là hai cơ hội lệch, và lần đầu tiên
            # chúng đã cùng sai y hệt nhau ở chặng "tay" (12/08/2026).
            **{f"don_vi_{k}": v for k, v in don_vi_chuoi(lsx.cong_doans, self._tram()).items()},
            # Lệnh đang ghép chung tờ với ai — màn lệnh trước đây MÙ hoàn toàn, người kế hoạch
            # sửa máy in ở đây mà không biết máy thật nằm ở bài.
            "bai_ghep": self._bai_ghep_dict(lsx),
            # Danh mục Công đoạn đã đổi sau lúc lệnh chụp ảnh — None khi còn khớp hết. Cùng tinh
            # thần `so_luong_*_moi` ngay trên: MÁY ĐỀ XUẤT, NGƯỜI QUYẾT. Không tự đè, chỉ phơi ra.
            "danh_muc_doi": self.danh_muc_doi(lsx),
            # Tiêu chí KCS khai/sửa SAU lúc phát hành: thẻ việc còn giữ bộ cũ cho tới khi bấm "Cập
            # nhật tiêu chí" ở băng này. Băng riêng — cửa cập nhật khác băng trên.
            "tieu_chi_kcs_doi": self._tieu_chi_kcs_doi(lsx),
        }

    def _tieu_chi_kcs_doi(self, lsx: Lsx) -> dict | None:
        from .san_xuat.release_update import tieu_chi_kcs_lech   # lười: tránh vòng import

        ds = tieu_chi_kcs_lech(self.db, lsx.id)
        return {"so_cong_doan": len(ds), "cong_doans": ds} if ds else None

    def _bai_ghep_dict(self, lsx: Lsx) -> dict | None:
        """Khối bài ghép của lệnh (None nếu in riêng) — DẪN XUẤT, đọc sống từ bài."""
        ghep = self._ghep_cua(lsx)
        if ghep is None:
            return None
        bg, tv = ghep
        # Bước nào của lệnh đang bị bài ĐÈ + số của cả lượt chung. Màn lệnh phải nói được CẢ HAI
        # số ("bài cấp 1.480 tờ · phần lệnh này 987 tờ"), không thì người sửa máy in ở đây mà
        # không biết máy thật nằm ở bài.
        de_len = {
            m.lsx_step_key: {
                "gop_step_key": c.step_key, "ten": c.ten,
                "to_ten": self._dept_names({c.department_id}).get(c.department_id),
                "may_ten": self._may_names({c.may_id}).get(c.may_id),
                "so_luong_vao": _f(c.so_luong_vao), "so_luong_ra": _f(c.so_luong_ra),
                "hao_hut": _f(c.hao_hut),
            }
            for c, m in self.db.execute(
                select(BaiGhepCongDoan, BaiGhepCongDoanMap)
                .join(BaiGhepCongDoanMap,
                      BaiGhepCongDoanMap.bai_ghep_cong_doan_id == BaiGhepCongDoan.id)
                .where(BaiGhepCongDoanMap.lsx_id == lsx.id)
            ).all()
        }
        return {
            "id": bg.id, "ma": bg.ma, "trang_thai": bg.trang_thai,
            "may_id": bg.may_id, "may_ten": self._may_names({bg.may_id}).get(bg.may_id),
            "giay_id": bg.giay_id,
            "kho_in_dai": bg.kho_in_dai, "kho_in_rong": bg.kho_in_rong,
            "so_con_tren_to": tv.so_con_tren_to,
            "buoc_bi_de": de_len,
        }

    def _cong_doan_dict(self, cd, dept_names: dict, may_names: dict,
                        quy_cach: dict | None = None, moi: dict | None = None,
                        khuon_map: dict | None = None) -> dict:
        vao = _f(cd.so_luong_vao)
        vat_tu_theo_id = self._vat_tu_theo_id()   # chip riêng của vật tư
        may_cd = self._may_cua_buoc(cd)
        t = thoi_luong_buoc(cd, may_cd, self.sl_tinh_cua_buoc(cd, may_cd, quy_cach))
        cd_obj = self.db.get(CongDoan, cd.cong_doan_id) if cd.cong_doan_id else None
        _tren_dg = tren_dong_giay(cd.don_vi_vao, cd.don_vi_ra, self._tram())
        # ⚠️ `loi_quy_doi` + `san_luong_dien_giai` GỠ 18/09/2026 (mg `0324`) cùng công thức sản lượng
        #    ra của công đoạn: bước ngoài dòng giấy nay là số người lập lệnh tự khai, không có phép
        #    đổi nào để báo lỗi hay câu công thức nào để diễn giải.
        return {
            "id": cd.id, "step_key": cd.step_key, "thu_tu": cd.thu_tu, "cong_doan_id": cd.cong_doan_id,
            "ten": cd.ten, "nhom": cd.nhom, "loai_buoc": cd.loai_buoc, "bat_buoc": bool(cd.bat_buoc),
            "department_id": cd.department_id,
            "department_ten": dept_names.get(cd.department_id),
            "may_id": cd.may_id, "may_ten": may_names.get(cd.may_id),
            # Hai cờ dụng cụ đọc từ danh mục Công đoạn (KHÔNG suy từ tên bước — tên là chữ người
            # dùng gõ, đặt "Die-cut" hay "Ép kim" đều được). Chúng quyết định bước này có hỏi khuôn
            # hay không, và `tooling_type` còn là chiều lọc thứ hai của ô chọn dao.
            "requires_tooling": can_chot_khuon(getattr(cd_obj, "requires_tooling", False),
                                               getattr(cd_obj, "tooling_type", None)),
            "tooling_type": getattr(cd_obj, "tooling_type", None),
            # Con dao của bước + thông tin bày cho thợ. Nạp theo LÔ ở `_khuon_map`, không tra ở đây.
            "khuon_be_id": cd.khuon_be_id,
            **(khuon_map or {}).get(cd.khuon_be_id, {}),
            # Ý định của sale + chỗ lệch với con dao kế hoạch đã chốt. `khuon_lech` là câu tiếng
            # Việt hoặc None — dựng ở server để mọi màn nói cùng một câu, FE không tự suy lại.
            "khuon_nguon": cd.khuon_nguon,
            "khuon_phi": _f(cd.khuon_phi),
            "khuon_lech": canh_bao_lech_khuon(
                cd.khuon_nguon, cd.khuon_phi,
                (khuon_map or {}).get(cd.khuon_be_id, {}).get("khuon_be_tinh_trang"),
            ),
            "so_luong_vao": vao, "so_luong_ra": _f(cd.so_luong_ra),
            # Số ĐÚNG RA phải là, tính lại theo danh mục HIỆN TẠI. Chỉ có mặt khi KHÁC số đã lưu —
            # bằng nhau thì để None cho màn khỏi phải so lại lần nữa. Xem `detail_dict`.
            "so_luong_vao_moi": (
                _f(moi["so_luong_vao"]) if moi and _f(moi["so_luong_vao"]) != vao else None),
            "so_luong_ra_moi": (
                _f(moi["so_luong_ra"])
                if moi and _f(moi["so_luong_ra"]) != _f(cd.so_luong_ra) else None),
            "don_vi_vao": cd.don_vi_vao, "don_vi_ra": cd.don_vi_ra,
            # Bước có nằm trên DÒNG GIẤY không. Bước ngoài dòng đứng ngoài chuỗi bù hao nên số
            # lượng KHÔNG tự tính (đứng im ở 0 nếu không ai điền) và hao của nó không cộng vào số
            # giấy phải mua. Không gửi cờ này thì màn chỉ thấy hai số 0 mà không có lời giải thích
            # — FE tự suy không nổi vì "trên dòng giấy hay không" nằm ở cờ của danh mục Đơn vị.
            "tren_dong_giay": _tren_dg,
            "he_so_quy_doi": _f(cd.he_so_quy_doi),
            "hao_hut": _f(cd.hao_hut), "hao_hut_pct": _f(cd.hao_hut_pct),
            # % thực tế suy từ số — KHÔNG lưu cột, tránh hai nguồn sự thật với `hao_hut`.
            "ty_le_hao_hut": round(_f(cd.hao_hut) / vao * 100, 2) if vao > 0 else 0.0,
            "so_luot_chay": cd.so_luot_chay,
            # SỐ GIỜ KẾ HOẠCH của bước TỔ (mg `0319`) — ô gõ tay, thay chỗ "Kíp chuẩn" cũ.
            "so_gio_ke_hoach": _f(cd.so_gio_ke_hoach),
            # Chuẩn bị TRẢ RA LÀ SỐ KẾ THỪA TỪ MÁY (`t`), không phải cột `cd.setup_phut` đã dormant
            # — nếu trả cột cũ thì UI hiện một số mà engine lại tính bằng số khác.
            "setup_phut": t["dien_giai"]["setup_phut"],
            "phat_sinh_phut": _f(cd.phat_sinh_phut),
            "chay_phut": t["chay_phut"],
            # Gia công ngoài (spec 2026-09-26): nhà gia công của BƯỚC. Việc mang đi / chốt
            # số nằm ở LẦN GIA CÔNG (`/api/gia-cong-ngoai/lenh/{id}`), không ở bước.
            "nha_cung_cap_id": cd.nha_cung_cap_id, "nha_cung_cap": cd.nha_cung_cap,
            "ghi_chu": cd.ghi_chu,
            # CHỈ lấy hai số DẪN XUẤT. KHÔNG spread cả `thoi_luong_buoc` vào đây: nó cũng có key
            # `chay_phut` và sẽ GHI ĐÈ giá trị đã lưu ở trên — client nhận số đã-tính, tưởng là
            # người dùng gõ đè, lưu ngược lại, thế là hợp đồng "để trống = máy tự tính" vỡ vĩnh
            # viễn ngay sau lần lưu đầu (bước chưa khai năng suất bị đóng băng ở 0 phút).
            "chiem_may_phut": t["chiem_may_phut"],
            # Dải nhanh/chậm nhất (tốc độ max/min của máy) — bảng công đoạn + Gantt vẽ râu.
            "chiem_may_phut_min": t["chiem_may_phut_min"],
            "chiem_may_phut_max": t["chiem_may_phut_max"],
            "tong_phut": t["tong_phut"],
            "thoi_luong_dien_giai": t["dien_giai"],
            # ⚠️ Ba khoá đầu việc GỠ 18/09/2026 (mg `0320`): `khoan_rate_id` · `khoan_ten` ·
            #    `khoan_chon_duoc`. Bước lệnh thôi chọn việc khoán — việc ấy chọn LÚC GHI MẺ ở bàn
            #    tổ, nơi thợ biết mình vừa làm gì. Vật tư của bước nay bung từ CÔNG ĐOẠN nên cũng
            #    không cần đi kèm từng lựa chọn nữa.
            "phu_thuoc_step_keys": [
                p.step_key for edge in cd.phu_thuoc
                if (p := self.db.get(LsxCongDoan, edge.buoc_truoc_id)) is not None
            ],
            "vat_tus": [
                {"id": v.id, "hang_loai": v.hang_loai, "vat_tu_id": v.vat_tu_id,
                 # Giấy hay Sóng (mg 0426) — màn lệnh tách ô Giấy / Sóng theo khoá này.
                 "giay_loai": self._loai_giay(v.vat_tu_id) if v.hang_loai == HANG_GIAY else "",
                 "vat_tu_ma": v.vat_tu_ma_snapshot, "vat_tu_ten": v.vat_tu_ten_snapshot,
                 "don_vi": v.don_vi_snapshot, "so_luong": _f(v.so_luong),
                 "kho_rong": int(v.kho_rong or 0), "kho_dai": int(v.kho_dai or 0),
                 "don_vi_goc": v.don_vi_goc or "",
                 "tu_dong": bool(v.tu_dong), "sua_tay": bool(v.sua_tay),
                 "gia_tri_chip": dict(v.gia_tri_chip or {}),
                 "chips": [{"ma": c.ma, "ten": c.ten, "don_vi": c.don_vi}
                           for c in (vat_tu_theo_id[v.vat_tu_id].chips
                                     if v.hang_loai == HANG_VAT_TU and v.vat_tu_id in vat_tu_theo_id
                                     else [])]}
                for v in cd.vat_tus
            ],
            # Lượng tính sẵn cho MỌI vật tư — drawer chọn món nào là điền được ngay, khỏi gõ tay.
            "vat_tu_goi_y": self._goi_y_luong_vat_tu(cd, quy_cach),
        }

    # ⚠️ `_dau_viec_cua_buoc()` GỠ 18/09/2026 (mg `0320`) — không còn ai gọi từ lúc bước lệnh
    #    thôi chọn đầu việc.

    def list_rows(self, **kw) -> tuple[list[dict], int]:
        """`(dòng của TRANG này, TỔNG số dòng khớp lọc)`. Nhận thêm `page`/`size` xuống repo."""
        rows, total = self.repo.list(**kw)
        order_ids = {r.order_id for r in rows}
        orders = {
            o.id: o for o in self.db.execute(select(Order).where(Order.id.in_(order_ids))).scalars()
        } if order_ids else {}
        # Nhãn nhóm (vd "Catalogue A4 - 32 trang") — ĐỌC SỐNG từ dòng đơn: lệnh "Bìa" đứng một
        # mình thì không ai biết nó thuộc cuốn nào. `order_line_id` là FK THẬT nên đọc sống
        # an toàn, khỏi thêm cột (`phieu_thanh_phan_id` cũng ổn định từ 07/09/2026 nhưng nó không
        # mang nhãn nhóm — nhãn nằm ở dòng đơn).
        line_ids = {r.order_line_id for r in rows if r.order_line_id}
        nhom_by_line = {
            ln.id: ln.nhom
            for ln in (
                self.db.execute(select(OrderLine).where(OrderLine.id.in_(line_ids))).scalars()
                if line_ids else []
            )
        }
        dept_ids = {cd.department_id for r in rows for cd in r.cong_doans if cd.department_id}
        dept_names = self._dept_names(dept_ids)
        khach_names = self._customer_names({o.customer_id for o in orders.values() if o.customer_id})
        tram = self._tram()          # đọc MỘT lần cho cả danh sách
        # Gia công ngoài của cả trang — một câu (`cua_nhieu_lenh`), không gọi `lan_dict` theo dòng.
        gc_repo = GiaCongNgoaiRepository(self.db)
        cap = gc_repo.cua_nhieu_lenh([r.id for r in rows])
        # Chip "Chờ cấp giấy": thêm tối đa MỘT câu, và chỉ khi trang có trọn gói xưởng cấp giấy.
        gia_cong = tom_tat_gcn_theo_lenh(
            cap, gc_repo.co_yeu_cau_xuat(lan_can_hoi_xuat_giay(cap)))
        out: list[dict] = []
        for r in rows:
            o = orders.get(r.order_id)
            first = r.cong_doans[0] if r.cong_doans else None
            out.append({
                "id": r.id, "ma": r.ma, "loai": r.loai, "ten": r.ten, "trang_thai": r.trang_thai,
                "nhom": nhom_by_line.get(r.order_line_id),
                "order_id": r.order_id,
                "order_no": o.order_no if o else None,
                "customer_name": khach_names.get(o.customer_id) if o else None,
                "so_luong_dat": r.so_luong_dat, "don_vi_tinh": r.don_vi_tinh,
                "so_to_ke_hoach": r.so_to_ke_hoach,
                "han_giao_khach": r.han_giao_khach, "han_hoan_thanh_sx": r.han_hoan_thanh_sx,
                "is_rush": bool(r.is_rush),
                "created_at": r.created_at,
                "to_dau_ten": dept_names.get(first.department_id) if first else None,
                "so_cong_doan": len(r.cong_doans),
                # `r.cong_doans` đã nạp sẵn (dùng ngay ở hai dòng trên) nên chỗ này KHÔNG thêm
                # query nào — đừng đổi sang tra danh mục theo từng dòng, danh sách sẽ thành N+1.
                "don_vi_to": don_vi_chuoi(r.cong_doans, tram)["to"],
                "gia_cong": gia_cong.get(r.id),
            })
        return out, total

    def nguon_bo_loc(self, **kw) -> dict:
        """Hai danh sách cho ô lọc của bảng lệnh: đơn nào đang có lệnh, và khách của chúng."""
        rows = self.repo.nguon_bo_loc(**kw)
        khach = self._customer_names({cid for _, _, cid in rows if cid})
        return {
            "orders": [
                {"id": i, "order_no": no, "customer_id": cid, "customer_name": khach.get(cid) if cid else None}
                for i, no, cid in rows
            ],
            # Khách hiện MỘT lần dù ôm bao nhiêu đơn; bỏ khách chưa có hồ sơ (`customer_id` rỗng)
            # vì không có gì để lọc theo.
            "customers": [
                {"id": cid, "name": ten}
                for cid, ten in sorted(
                    {cid: khach.get(cid) or f"#{cid}" for _, _, cid in rows if cid}.items(),
                    key=lambda kv: kv[1],
                )
            ],
        }

    def khach_loc(self, *, owner_ids: set[int] | None) -> list[tuple[int, str, int]]:
        """Ô "Khách hàng" của thanh lọc bảng lệnh — khách đang có lệnh trong phạm vi, kèm số lệnh."""
        return self.repo.khach_loc(owner_ids=owner_ids)

    def don_loc(self, *, owner_ids: set[int] | None) -> list[tuple[int, str, int]]:
        """Ô "Đơn hàng" của thanh lọc bảng lệnh — đơn đang có lệnh trong phạm vi, kèm số lệnh."""
        return self.repo.don_loc(owner_ids=owner_ids)

    def khach_hang_cho(self, *, owner_ids: set[int] | None = None) -> list[tuple[int, str, int]]:
        """Ô "Khách hàng" của thanh lọc hàng chờ — khách đang có đơn chờ lên lệnh (trong phạm vi), kèm số đơn."""
        return self.repo.khach_hang_cho(owner_ids=owner_ids)

    def dem_trang_thai(self, **kw) -> dict[str, int]:
        """Số trên TAB lọc — đếm ở máy chủ theo cùng bộ lọc trừ chính `trang_thai`.

        Trước đây màn tự đếm mảng đã tải về. Đếm kiểu đó chỉ đúng khi client cầm TOÀN BỘ dữ liệu;
        có phân trang rồi thì nó thành số của trang đang xem, tức số SAI.
        """
        return self.repo.dem_theo_trang_thai(**kw)

    def phu_thuoc_options(self, lsx_id: int) -> list[dict]:
        from ..repositories.catalog_base import SIZE_TRAN

        current = self.get(lsx_id)
        # Trong PHẠM VI MỘT ĐƠN — vài chục lệnh là cùng, lấy trọn trần một trang.
        lsxs, _ = self.repo.list(order_id=current.order_id, size=SIZE_TRAN)
        line_ids = [x.order_line_id for x in lsxs if x.order_line_id]
        groups = {
            x.id: x.nhom for x in self.db.execute(
                select(OrderLine).where(OrderLine.id.in_(line_ids))
            ).scalars()
        } if line_ids else {}
        # Tên bước ưu tiên tên CÔNG ĐOẠN đang gắn, y hệt `tenBuoc()` bên FE. Trả thẳng `step.ten`
        # thì chip phụ thuộc + panel "Bước LSX khác" là hai chỗ DUY NHẤT không có `cong_doan_id`
        # để tra ngược, nên bước mang nhãn tạm sẽ hiện "Công đoạn" trong khi bảng/DAG hiện tên thật.
        cd_ids = {
            step.cong_doan_id for item in lsxs for step in item.cong_doans if step.cong_doan_id
        }
        ten_cd = {
            c.id: c.ten for c in self.db.execute(
                select(CongDoan).where(CongDoan.id.in_(cd_ids))
            ).scalars()
        } if cd_ids else {}
        return [
            {"lsx_id": item.id, "lsx_ma": item.ma, "nhom": groups.get(item.order_line_id),
             "step_key": step.step_key,
             "ten_buoc": ten_cd.get(step.cong_doan_id) or step.ten,
             "thu_tu": step.thu_tu}
            for item in lsxs for step in sorted(item.cong_doans, key=lambda x: x.thu_tu)
        ]

    # THÔNG SỐ kế hoạch sửa được (nguyên nhân) — khớp `LsxQuyCachIn`. Mọi thứ ngoài bộ này trong
    # `quy_cach_json` là HỆ QUẢ, tính lại ở `ap_quy_cach`, không nhận từ client.
    _QC_SUA_DUOC = (
        "giay_id", "nguon_giay", "kho_nguyen_dai", "kho_nguyen_rong",
        "kho_in_dai", "kho_in_rong", "dai_thanh_pham", "rong_thanh_pham",
        "quy_cach_in", "muc_a", "muc_b", "so_trang", "trang_moi_tay",
        "bleed_mm", "khe_cat_mm", "con_auto",
    )

    def ap_quy_cach(self, lsx: Lsx, patch: dict) -> tuple[dict, list[str]]:
        """Trộn THÔNG SỐ mới vào ảnh chụp rồi tính lại mọi số DẪN XUẤT. KHÔNG ghi DB.

        Trả `(quy_cach_json mới, danh sách khoá đã đổi)`. Dùng cho cả đường LƯU (`update`) lẫn
        đường XEM TRƯỚC — một hàm, nên số xem trước không thể lệch số lưu xuống.

        Tính lại từ CHÍNH ảnh chụp của lệnh, KHÔNG đọc lại phiếu tính giá: lệnh đã được phép rời
        phiếu, quay về hỏi phiếu là xoá mất đúng thứ người kế hoạch vừa sửa.
        """
        from .thanh_phan_engine import (
            _fit, binh_bai_con, chua_theo_chieu, so_kem_moi_tay, so_mau_dan_xuat,
            so_tay_moi_cuon, tap_muc,
        )

        qc = dict(lsx.quy_cach_json or {})
        doi: list[str] = []
        for k in self._QC_SUA_DUOC:
            if k in patch and patch[k] is not None and qc.get(k) != patch[k]:
                qc[k] = patch[k]
                doi.append(k)
        if not doi:
            return qc, []

        # Đổi giấy → kéo theo định lượng + tên, không thì lệnh mang gsm của cuộn giấy cũ.
        if "giay_id" in doi and qc.get("giay_id"):
            giay = self.db.get(GiayNguyen, int(qc["giay_id"]))
            if giay is not None:
                qc["gsm"] = giay.gsm
                qc["giay_ten"] = giay.ten

        qc["muc_a"] = tap_muc(qc.get("muc_a"))
        qc["muc_b"] = tap_muc(qc.get("muc_b"))
        qc["so_mau_a"], qc["so_mau_b"], qc["so_mau_pha"] = so_mau_dan_xuat(
            qc["muc_a"], qc["muc_b"])

        # ① xả giấy: mấy tờ in cắt được từ một tờ nguyên.
        kn_d, kn_r = _f(qc.get("kho_nguyen_dai")), _f(qc.get("kho_nguyen_rong"))
        ki_d, ki_r = _f(qc.get("kho_in_dai")), _f(qc.get("kho_in_rong"))
        if kn_d > 0 and kn_r > 0 and ki_d > 0 and ki_r > 0:
            qc["so_manh_xa"] = max(_fit(kn_d, kn_r, ki_d, ki_r), 1)

        # ② bình bài: chỉ khi đang để MÁY TỰ. `con_auto=False` là người đã ép số con — tôn trọng.
        chua_d, chua_r = chua_theo_chieu(qc)
        if qc.get("con_auto") is not False and ki_d > 0 and ki_r > 0:
            con = binh_bai_con(
                kho_in_dai=ki_d, kho_in_rong=ki_r,
                dai_tp=_f(qc.get("dai_thanh_pham")), rong_tp=_f(qc.get("rong_thanh_pham")),
                chua_mm=0, chua_dai_mm=chua_d, chua_rong_mm=chua_r,
                bleed_mm=_f(qc.get("bleed_mm")), khe_cat_mm=_f(qc.get("khe_cat_mm")),
            )
            if con > 0:
                lsx.so_con = con
        qc["chua_dai"], qc["chua_rong"] = chua_d, chua_r

        # ③ số bài in = số TAY, và số kẽm = kẽm mỗi tay × số tay.
        so_tay = so_tay_moi_cuon(
            trang_moi_tay=qc.get("trang_moi_tay"), so_trang=qc.get("so_trang"))
        qc["so_to_per_sp"] = so_tay
        qc["kem_moi_tay"] = so_kem_moi_tay(
            qc["muc_a"], qc["muc_b"], str(qc.get("quy_cach_in") or "mot_mat"))
        qc["so_kem"] = qc["kem_moi_tay"] * so_tay
        return qc, doi

    def xem_truoc_quy_cach(self, *, lsx_id: int, patch: dict) -> dict:
        """Sửa thông số này thì các số MÁY TỰ TÍNH ra bao nhiêu? — KHÔNG ghi gì vào DB.

        Chạy ĐÚNG đường mà nút Lưu chạy (`ap_quy_cach` + `_ap_chuoi_nguoc`) rồi `rollback`. Cố ý
        không viết một bản tính riêng cho xem-trước: hai bản là hai chỗ để lệch, mà lệch ở đây
        nghĩa là màn hiện một số rồi lưu xuống một số khác.
        """
        lsx = self.get(lsx_id)
        try:
            qc, doi = self.ap_quy_cach(lsx, patch or {})
            if doi:
                lsx.quy_cach_json = qc
                self._ap_chuoi_nguoc(lsx)
            qc = dict(lsx.quy_cach_json or {})
            passes = 1 if qc.get("quy_cach_in") == "mot_mat" else 2
            return {
                "doi": doi,
                "so_con": int(lsx.so_con or 0),
                "so_kem": int(qc.get("so_kem") or 0),
                "kem_moi_tay": int(qc.get("kem_moi_tay") or 0),
                "so_manh_xa": int(qc.get("so_manh_xa") or 0),
                "so_to_per_sp": int(qc.get("so_to_per_sp") or 1),
                "so_to_ke_hoach": int(lsx.so_to_ke_hoach or 0),
                "so_to_nguyen": int(lsx.so_to_nguyen or 0),
                "so_luot": int(round(_f(lsx.so_to_ke_hoach) * passes)),
                "so_mau_a": int(qc.get("so_mau_a") or 0),
                "so_mau_b": int(qc.get("so_mau_b") or 0),
                "so_mau_pha": int(qc.get("so_mau_pha") or 0),
            }
        finally:
            # Rollback dọn SẠCH mọi thay đổi ở trên — kể cả `so_con` và cả chuỗi bước mà
            # `_ap_chuoi_nguoc` vừa ghi. Endpoint này không làm gì khác nên rollback là an toàn.
            self.db.rollback()

    def xem_truoc_routing(self, *, lsx_id: int, rows_in, actor) -> list[dict]:
        """Đổi/chèn công đoạn thì SỐ VÀO–RA + đơn vị của cả chuỗi ra bao nhiêu? — KHÔNG ghi DB.

        Chạy ĐÚNG đường nút Lưu routing chạy (`replace_routing`) ở chế độ không commit rồi
        `rollback`, y hệt `xem_truoc_quy_cach`. Cố ý không viết bản tính số thứ hai (ở FE hay ở
        đây): hai bản là hai chỗ để lệch, mà lệch nghĩa là drawer hiện một số rồi Lưu xuống số
        khác. Chỉ trả phần DÒNG CHẢY drawer cần nhảy tức thì, khớp `step_key` client gửi lên.
        """
        try:
            lsx = self.replace_routing(
                lsx_id=lsx_id, rows_in=rows_in, actor=actor, commit=False)
            tram = self._tram()
            out: list[dict] = []
            for cd in sorted(lsx.cong_doans, key=lambda c: c.thu_tu):
                out.append({
                    "step_key": cd.step_key,
                    "so_luong_vao": _f(cd.so_luong_vao),
                    "so_luong_ra": _f(cd.so_luong_ra),
                    "don_vi_vao": cd.don_vi_vao,
                    "don_vi_ra": cd.don_vi_ra,
                    "he_so_quy_doi": _f(cd.he_so_quy_doi),
                    "hao_hut": _f(cd.hao_hut),
                    "hao_hut_pct": _f(cd.hao_hut_pct),
                    "tren_dong_giay": tren_dong_giay(cd.don_vi_vao, cd.don_vi_ra, tram),
                })
            return out
        finally:
            # Rollback dọn SẠCH chuỗi bước `replace_routing(commit=False)` vừa ghi (kể cả bước
            # mới chèn). Endpoint chỉ đọc số nên rollback là an toàn.
            self.db.rollback()

    def update(self, *, lsx_id: int, payload, actor) -> Lsx:
        lsx = self.get(lsx_id)
        if lsx.trang_thai == TT_DA_LAP_KE_HOACH:
            raise LsxConflict("Lệnh đã lập kế hoạch — gỡ kế hoạch trước khi sửa")
        data = payload.model_dump(exclude_unset=True)
        changed: list[str] = []
        # `so_to_ke_hoach` / `so_to_nguyen` KHÔNG còn nhận từ client — hai mốc đó nay đọc ra từ
        # chuỗi ngược (`_ap_chuoi_nguoc`), nhận thêm đường nữa là đẻ nguồn sự thật thứ hai.
        for field in (
            "ten", "so_luong_dat", "don_vi_tinh",
            "so_con", "han_hoan_thanh_sx", "is_rush", "may_id",
            "nguoi_phu_trach_id", "ghi_chu",
        ):
            if field in data and getattr(lsx, field) != data[field]:
                setattr(lsx, field, data[field])
                changed.append(field)
        # Đổi SL đặt / con·tờ / quy cách là đổi luôn số vật tư cần — chặn khi đang giữ chỗ, cùng
        # luật với routing (`replace_routing`) và xoá lệnh (`xoa`). Field khác (tên, ghi chú, người
        # phụ trách...) không đụng vật tư nên KHÔNG chặn.
        # Điều kiện phải TRÙNG KHÍT với điều kiện chạy lại chuỗi ngược ở dưới: cái gì làm
        # `_ap_chuoi_nguoc` viết lại số tờ vào máy thì cái đó đổi lượng giấy cần. `so_con` từng
        # lọt vì đọc như "thông số trình bày", nhưng bình bài lại là số tờ kế hoạch khác đi.
        if {"so_luong_dat", "so_con"} & set(changed) or data.get("quy_cach"):
            self._chan_dang_giu_cho(lsx)
        # THÔNG SỐ (ảnh chụp) đổi → trộn vào rồi tính lại mọi số dẫn xuất. Đặt TRƯỚC chuỗi ngược
        # vì nó có thể đổi `so_con` (bình bài lại) — thứ chuỗi ngược lấy làm hệ số cầu.
        if data.get("quy_cach"):
            qc_moi, qc_doi = self.ap_quy_cach(lsx, data["quy_cach"])
            if qc_doi:
                lsx.quy_cach_json = qc_moi
                changed.extend(f"quy_cach.{k}" for k in qc_doi)
        # SL đặt / con·tờ / thông số đổi → cả chuỗi phải tính lại.
        if {"so_luong_dat", "so_con"} & set(changed) or data.get("quy_cach"):
            self._ap_chuoi_nguoc(lsx)
            # Số lượt phải đợi chuỗi ngược chốt số tờ vào máy mới tính được.
            qc = dict(lsx.quy_cach_json or {})
            passes = 1 if qc.get("quy_cach_in") == "mot_mat" else 2
            qc["so_luot"] = int(round(_f(lsx.so_to_ke_hoach) * passes))
            lsx.quy_cach_json = qc
        if changed:
            # Sửa xong mà hết thiếu → về NHÁP; còn thiếu → CHỜ BỔ SUNG (giữ nguyên nếu đã SẴN SÀNG
            # và vẫn đủ dữ liệu).
            thieu = self.thieu_cua(lsx)
            if thieu:
                lsx.trang_thai = TT_CHO_BO_SUNG
            elif lsx.trang_thai == TT_CHO_BO_SUNG:
                lsx.trang_thai = TT_NHAP
            self.audit.create(
                actor_user_id=actor.id, action="update_lsx", target=f"lsx:{lsx.id}",
                detail=f"Sửa lệnh {lsx.ma}: {', '.join(changed)}",
            )
        self.repo.commit()
        return self.get(lsx_id)

    # Cột nhận thẳng từ client, không cần suy diễn gì thêm. KHÔNG có `he_so_quy_doi`/`hao_hut`/
    # `hao_hut_pct`: cả ba nay là dẫn xuất của chuỗi ngược, server ghi trong `_ap_chuoi_nguoc`.
    # Thời lượng nay KẾ THỪA từ máy (2026-08-04) nên client chỉ còn gửi được `phat_sinh_phut`.
    # `setup_phut` · `chay_phut` · `di_chuyen_phut` · `ve_sinh_phut` · `cho_phut` đã rời bộ này:
    # còn cột trong DB nhưng không nhận từ client và engine không đọc.
    # `bat_buoc` rời bộ này 07/09/2026: mọi bước trong routing đều bắt buộc, cột do server giữ TRUE.
    _ROUTING_FIELD_THUAN = (
        "may_id", "khuon_be_id", "so_luot_chay",
        # SỐ GIỜ KẾ HOẠCH của bước TỔ (mg `0319`) — số gõ tay, KHÔNG kế thừa từ đâu cả, nên nó
        # thuộc bộ "nhận thẳng" này. Thay chỗ `so_nhan_cong_tieu_chuan` (kíp chuẩn) đã gỡ.
        "so_gio_ke_hoach", "phat_sinh_phut",
        "ghi_chu",
        # `kcs_tieu_chi_bo_sung_json` rời bộ này 08/09/2026 (mg `0283`): tiêu chí KCS chỉ còn MỘT
        # nguồn là danh mục gắn theo công đoạn — `docs/design-kcs-theo-cong-doan.md` mục 5.
        # `nha_cung_cap` (chữ) rời bộ NHẬN THẲNG 26/09/2026 — client gửi `nha_cung_cap_id`, tên do
        # server ghi theo NCC (xem nhánh THUÊ NGOÀI trong `replace_routing`).
    )
    _ROUTING_FIELD_NULLABLE = {
        "may_id", "khuon_be_id", "chay_phut",
        "ghi_chu",
    }

    def _chan_dang_giu_cho(self, lsx: Lsx) -> None:
        """Lệnh đang giữ chỗ vật tư → không đổi số lượng/con·tờ/quy cách/routing, không xoá.

        Đối xứng với `BaiGhepService._chan_dang_giu_cho`/`_chan_lenh_dang_giu_cho` ở phía bài ghép
        — nới ở phía lệnh sẽ vô hiệu hoá khoá phía bài (LSX đứng riêng vẫn đổi được số vật tư cần
        mà giữ chỗ không hay biết). Có ĐƯỜNG LÙI: nhả chỗ ở màn Kế hoạch vật tư rồi làm — chặn
        cứng không lối ra sẽ biến giữ chỗ thành cái khoá vĩnh viễn.

        Chặn CẢ preview (`replace_routing(commit=False)`, tức `xem_truoc_routing`): số trên màn
        xem trước đã dùng để người dùng QUYẾT ĐỊNH có nhả chỗ hay không — cho preview chạy qua thì
        màn nói dối, bấm Lưu thật mới báo lỗi.
        """
        if getattr(lsx, "giu_cho_bat", False):
            raise LsxConflict(
                f"Lệnh {lsx.ma} đang giữ chỗ vật tư — nhả chỗ ở màn Kế hoạch vật tư trước khi sửa "
                "số lượng, số con/tờ, quy cách, routing hoặc xoá lệnh."
            )

    # --- Danh mục đổi dưới chân lệnh -----------------------------------------

    def _ly_do_khong_cap_nhat(self, lsx: Lsx) -> str | None:
        """Vì sao lệnh này KHÔNG lấy được số mới của danh mục. `None` = lấy được.

        Đúng ba cửa mà `replace_routing` chặn, và chặn bằng cùng câu chữ: đồng bộ danh mục cũng là
        ghi đè `khoan_json` + dòng vật tư của bước, tức là đúng thứ ba cửa kia đang giữ. Nới ở đây
        là mở cửa hậu cho chính thứ vừa khoá.
        """
        if lsx.trang_thai == TT_DA_LAP_KE_HOACH:
            return "Lệnh đã lập kế hoạch — gỡ kế hoạch trước khi lấy số mới của danh mục"
        order = self.db.get(Order, lsx.order_id)
        if order is not None and order.status == STATUS_CANCELLED:
            return "Đơn đã hủy — không cập nhật được"
        if getattr(lsx, "giu_cho_bat", False):
            return ("Lệnh đang giữ chỗ vật tư — nhả chỗ ở màn Kế hoạch vật tư trước khi lấy số mới")
        return None

    def _soi_danh_muc(self, lsx: Lsx) -> list[dict]:
        """Từng bước lệch danh mục ra sao — kèm rổ `ap` là thứ sẽ ghi nếu người dùng bấm cập nhật.

        Gộp SOI và ÁP vào một lượt, cố ý: hai lượt tính riêng là hai cơ hội lệch nhau, mà lệch ở
        đây nghĩa là băng hứa một đằng nút ghi một nẻo. `danh_muc_doi` bóc phần `ap` ra trước khi
        trả về client.

        ⚠️ 18/09/2026: nửa KHOÁN của băng này GỠ HẲN (mg `0320`) — bước thôi ghim đầu việc nên
        chẳng còn ảnh chụp nào lệch với danh mục. Băng còn đúng hai việc: VẬT TƯ của công đoạn và
        MÁY bị gỡ khỏi công đoạn. Ảnh chụp đơn giá nay nằm ở MẺ sản xuất, và băng "Danh mục đã
        đổi" của mẻ là một cửa riêng ở bàn tổ (§7.2b), không đi qua đây.
        """
        quy_cach = quy_cach_bien(lsx)
        ra: list[dict] = []
        for cd in sorted(lsx.cong_doans, key=lambda c: c.thu_tu):
            if not cd.cong_doan_id:
                continue
            cd_obj = self.db.get(CongDoan, cd.cong_doan_id)
            if cd_obj is None:
                continue        # công đoạn bị xoá hẳn — `thieu_cua` lo phần đó, đừng nói hai lần
            # THUÊ NGOÀI vẫn miễn soi vật tư: nhà thầu tự lo vật tư của họ, bung định mức của
            # công đoạn vào bước thuê ngoài là đẻ ra một nhu cầu mua hàng không có thật.
            ngoai = cd.loai_buoc == LB_THUE_NGOAI
            ap: dict = {"vat_tu_them": [], "vat_tu_dat_lai": []}
            muc: dict = {
                "buoc_id": cd.id, "step_key": cd.step_key, "thu_tu": cd.thu_tu, "ten": cd.ten,
                "vat_tu_them": [], "vat_tu_bo": [], "vat_tu_lech": [], "may_canh_bao": None,
            }
            # Vật tư soi thẳng theo CÔNG ĐOẠN (mg `0316`) — không còn phải đợi bước chọn đầu việc.
            if not ngoai:
                # Danh sách + chip là của PHIẾU (đã chép vào dòng bước) — danh mục công đoạn đổi sau
                # KHÔNG còn là "lệch". Chỉ soi: định mức lưu có khác định mức tính lại từ công thức
                # hiện hành của vật tư không.
                nguon_hien_co = [(v.vat_tu_id, dict(v.gia_tri_chip or {}))
                                 for v in cd.vat_tus if v.hang_loai == HANG_VAT_TU]
                moi_rows, _ = self._vat_tu_bung(cd_obj, cd, quy_cach, dong_nguon=nguon_hien_co)
                hien_co = [
                    {"hang_loai": v.hang_loai, "vat_tu_id": v.vat_tu_id,
                     "ma": v.vat_tu_ma_snapshot,
                     "ten": v.vat_tu_ten_snapshot, "don_vi": v.don_vi_snapshot,
                     "so_luong": _f(v.so_luong), "tu_dong": bool(v.tu_dong)}
                    for v in cd.vat_tus
                ]
                vt = vat_tu_lech(hien_co, moi_rows)
                muc["vat_tu_them"], muc["vat_tu_bo"], muc["vat_tu_lech"] = (
                    vt["them"], vt["bo"], vt["lech"])
                moi_theo_id = {(r.get("hang_loai") or HANG_VAT_TU, int(r["vat_tu_id"])): r
                               for r in moi_rows}
                ap["vat_tu_them"] = [moi_theo_id[(r["hang_loai"], r["vat_tu_id"])]
                                     for r in vt["them"]]
                ap["vat_tu_dat_lai"] = [moi_theo_id[(r["hang_loai"], r["vat_tu_id"])]
                                        for r in vt["lech"]]
            # Máy: công thức giờ chạy của cặp (công đoạn × máy) đọc SỐNG lúc tính thời lượng nên
            # không có gì để đồng bộ. Thứ DUY NHẤT trôi được là danh sách máy: gỡ máy khỏi công
            # đoạn thì bước vẫn ôm `may_id` cũ và vẫn tính giờ bằng công thức đã bị gỡ.
            may_ids = {m.may_id for m in (cd_obj.may_lam_duoc or [])}
            if cd.may_id and may_ids and cd.may_id not in may_ids:
                muc["may_canh_bao"] = (
                    "Máy đang gán không còn nằm trong danh sách máy của công đoạn — chọn máy khác")
            elif cd.loai_buoc == LB_MAY:
                # Máy thuộc tổ (mg `0435`): tổ/máy là ảnh chụp, danh mục đổi sau thì chỉ NÓI.
                muc["may_canh_bao"] = cap_lech(self.db, cd_obj, cd.department_id, cd.may_id,
                                               to_map=self._to_cua_may_nap)
            co_gi = (muc["vat_tu_them"] or muc["vat_tu_bo"] or muc["vat_tu_lech"]
                     or muc["may_canh_bao"])
            if co_gi:
                ra.append({**muc, "ap": ap})
        return ra

    def danh_muc_doi(self, lsx: Lsx) -> dict | None:
        """Lệnh đang giữ số cũ ở chỗ nào so với danh mục hiện tại. `None` = còn khớp hết.

        Đi kèm mọi lần đọc lệnh (`detail_dict`) để người lập kế hoạch THẤY mà không phải đi tìm —
        đó là cả lý do tồn tại của nó: ảnh chụp không tự đổi là ĐÚNG, nhưng im lặng thì sai.
        """
        buocs = self._soi_danh_muc(lsx)
        if not buocs:
            return None
        khoa = self._ly_do_khong_cap_nhat(lsx)
        return {
            "so_buoc": len(buocs),
            "co_the_cap_nhat": khoa is None,
            "ly_do_khoa": khoa,
            "buocs": [{k: v for k, v in b.items() if k != "ap"} for b in buocs],
        }

    def dong_bo_danh_muc(self, *, lsx_id: int, actor) -> Lsx:
        """Lấy số mới của danh mục cho MỌI bước của lệnh — cửa của nút "Cập nhật theo danh mục".

        Ghi HAI thứ: dòng vật tư danh mục có mà bước chưa có, và số của dòng vật tư MÁY BUNG bị
        lệch. KHÔNG đụng: dòng người khai tay (`tu_dong=False`), dòng danh mục không còn bung (xem
        `vat_tu_lech`), máy của bước, và SỐ GIỜ KẾ HOẠCH (số người lập lệnh gõ, danh mục không có
        nguồn tương đương).
        """
        lsx = self.get(lsx_id)
        if (loi := self._ly_do_khong_cap_nhat(lsx)) is not None:
            raise LsxConflict(loi)
        buocs = self._soi_danh_muc(lsx)
        if not buocs:
            return lsx
        theo_id = {b["buoc_id"]: b["ap"] for b in buocs}
        for cd in lsx.cong_doans:
            ap = theo_id.get(cd.id)
            if ap is None:
                continue
            dat_lai = {(r.get("hang_loai") or HANG_VAT_TU, int(r["vat_tu_id"])): r
                       for r in ap["vat_tu_dat_lai"]}
            for v in cd.vat_tus:
                if (r := dat_lai.get((v.hang_loai, int(v.vat_tu_id)))) is not None:
                    v.so_luong = float(r["so_luong"])
            thu_tu = max((v.thu_tu for v in cd.vat_tus), default=-1)
            for r in ap["vat_tu_them"]:
                thu_tu += 1
                cd.vat_tus.append(LsxCongDoanVatTu(
                    hang_loai=r.get("hang_loai") or HANG_VAT_TU,
                    vat_tu_id=int(r["vat_tu_id"]), vat_tu_ma_snapshot=r.get("ma") or "",
                    vat_tu_ten_snapshot=r.get("ten") or "", don_vi_snapshot=r.get("don_vi") or "",
                    so_luong=float(r["so_luong"]), thu_tu=thu_tu, tu_dong=True,
                    gia_tri_chip=r.get("gia_tri_chip") or {},
                ))
        self.db.flush()
        # Lượt đồng bộ có thể gỡ nốt chỗ "thiếu" cuối cùng — cùng luật với lưu routing, để trạng
        # thái lệnh không đứng lại ở Chờ bổ sung vì một lý do đã hết.
        thieu = self.thieu_cua(lsx)
        if thieu and lsx.trang_thai != TT_CHO_BO_SUNG:
            lsx.trang_thai = TT_CHO_BO_SUNG
        elif not thieu and lsx.trang_thai == TT_CHO_BO_SUNG:
            lsx.trang_thai = TT_NHAP
        self.audit.create(
            actor_user_id=actor.id, action="update_lsx_danh_muc", target=f"lsx:{lsx.id}",
            detail=f"Cập nhật lệnh {lsx.ma} theo danh mục: {len(buocs)} công đoạn lấy số mới",
        )
        self.repo.commit()
        return self.get(lsx_id)

    def replace_routing(self, *, lsx_id: int, rows_in, actor, ly_do: str | None = None,
                        commit: bool = True) -> Lsx:
        lsx = self.get(lsx_id)
        if lsx.trang_thai == TT_DA_LAP_KE_HOACH:
            raise LsxConflict("Lệnh đã lập kế hoạch — gỡ kế hoạch trước khi sửa routing")
        order = self.db.get(Order, lsx.order_id)
        if order is not None and order.status == STATUS_CANCELLED:
            raise LsxConflict("Đơn đã hủy — không thể sửa routing")
        self._chan_dang_giu_cho(lsx)
        truoc = len(lsx.cong_doans)
        di_kem_cu = self._lenh_nguon_cheo(lsx.id)
        old_by_key = {r.step_key: r for r in lsx.cong_doans}
        self._nap_cd([getattr(r, "cong_doan_id", None) for r in rows_in]
                     + [c.cong_doan_id for c in lsx.cong_doans])
        rows: list[LsxCongDoan] = []
        payloads: list[dict] = []
        # Bước MỚI gắn công đoạn hoặc bước vừa ĐỔI công đoạn — lưu xong phải bung lại vật tư theo
        # công đoạn của nó (`_bung_lai_vat_tu`). Drawer chỉ bỏ dòng máy bung của công đoạn cũ.
        doi_cd: list[LsxCongDoan] = []
        # Bước có việc đã bắt đầu ở bàn tổ — tổ/máy của nó đổi ở bàn tổ (Đổi máy), không ở đây.
        da_bat_dau = self.repo.buoc_da_bat_dau({c.id for c in lsx.cong_doans if c.id is not None})
        # ⚠️ Rổ `bo_dau_viec` (lưu ý "bước này mất đầu việc mồ côi") GỠ 18/09/2026 (mg `0320`):
        #    bước thôi ghim đầu việc nên không có gì mồ côi được nữa.
        for i, r in enumerate(rows_in):
            d = r.model_dump(exclude_unset=True)
            payloads.append(d)
            cd_id = d.get("cong_doan_id")
            ten = d.get("ten")
            nhom = d.get("nhom")
            dept = d.get("department_id")
            cd_obj = self.db.get(CongDoan, cd_id) if cd_id else None
            # Chuỗi `TEN_BUOC_TRONG` là NHÃN TẠM của bước chưa đặt tên, không phải tên người đặt.
            # Bước chèn tay từng bị client cũ gửi đúng chuỗi này; khi bước đã gắn công đoạn thì coi
            # như chưa có tên để lấy lại tên danh mục, nếu không nó trơ chữ "Công đoạn" vĩnh viễn.
            if cd_id and ten and ten.strip() == TEN_BUOC_TRONG:
                ten = None
            if cd_id and (not ten or nhom is None or dept is None):
                if cd_obj is not None:
                    ten = ten or cd_obj.ten
                    nhom = nhom if nhom is not None else cd_obj.nhom
                    dept = dept if dept is not None else cd_obj.to_mac_dinh_id
            key = (d.get("step_key") or "").strip()
            row = old_by_key.get(key) if key else None
            old_cd_id = row.cong_doan_id if row is not None else None
            old_dept_id = row.department_id if row is not None else None
            old_loai = row.loai_buoc if row is not None else None
            old_may_id = row.may_id if row is not None else None
            buoc_moi = row is None
            # Tổ của bước phải là một TỔ PHỤ TRÁCH của công đoạn (mg `0312`) — chỉ soi khi bước mới,
            # đổi tổ hoặc đổi công đoạn. Bước giữ nguyên thì để yên snapshot cũ: danh mục đổi tổ sau
            # khi lên lệnh không được khoá đường lưu cả lệnh vì một bước chẳng ai đụng.
            if ((d.get("loai_buoc") or old_loai) != LB_THUE_NGOAI
                    and cd_obj is not None and dept is not None and cd_obj.department_ids
                    and dept not in cd_obj.department_ids
                    and (row is None or old_cd_id != cd_id or old_dept_id != dept)):
                raise LsxValidationError(
                    f'Tổ đã chọn không phụ trách công đoạn "{cd_obj.ten}" — chọn một trong các tổ '
                    f'khai ở danh mục Công đoạn.')
            if row is None:
                row = LsxCongDoan(thu_tu=i, **({"step_key": key} if key else {}))
            row.cong_doan_id = cd_id
            row.ten = ten or TEN_BUOC_TRONG
            row.nhom = nhom
            row.department_id = dept
            # Loại bước do KHSX chọn. Đổi Công đoạn không được âm thầm đổi lại Máy/Tổ.
            loai = d.get("loai_buoc") or old_loai or LB_MAY
            if loai not in LOAI_BUOC:
                raise LsxValidationError("Loại bước chỉ nhận Máy, Tổ hoặc Thuê ngoài")
            row.loai_buoc = loai
            for f in self._ROUTING_FIELD_THUAN:
                if f in d and (d.get(f) is not None or f in self._ROUTING_FIELD_NULLABLE):
                    setattr(row, f, d[f])
            # ĐƠN VỊ + SỐ LƯỢNG (10/09/2026): nhận từ client cho bước NGOÀI dòng giấy — ghi kẽm đếm
            # bản kẽm theo số màu của TỪNG đơn, không có công thức chung nào ở danh mục nói hộ.
            # Bước TRÊN dòng giấy gửi lên cũng vô hại: `_ap_chuoi_nguoc` ở cuối hàm ghi đè cả bốn ô
            # bằng số của chuỗi ngược — nó vẫn là nơi DUY NHẤT quyết ai được giữ số của mình.
            # Chuỗi rỗng phải về None, đừng lưu `""`: "chưa khai" và "khai bằng đơn vị tên rỗng" mà
            # lẫn nhau thì `tu_khai_don_vi` bật lên cho mọi bước và danh mục hết đường kéo lại.
            for f in ("don_vi_vao", "don_vi_ra"):
                if f in d:
                    setattr(row, f, (d[f] or "").strip() or None)
            for f in ("so_luong_vao", "so_luong_ra"):
                if d.get(f) is not None:
                    setattr(row, f, float(d[f]))
            # Bước TỔ làm bằng tay theo tổ, KHÔNG chiếm máy. Gỡ máy ở SERVER chứ không chỉ ẩn ô
            # trên form: máy còn dính lại thì bước vẫn chiếm một lane Gantt của máy đó.
            if row.loai_buoc == LB_TO:
                row.may_id = None
                # Cùng lẽ ấy với "số lượt qua máy" (08/09/2026): ô đã gỡ khỏi drawer ở bước tổ —
                # làm tay thì không có lượt chạy qua máy nào. Ép 1 ở SERVER để số cũ khác 1 không
                # nằm lại VÔ HÌNH: chip `so_luot_chay` của công thức tiền công vẫn có số thật để
                # dùng (`thoi_luong_buoc` vẫn báo `so_luot_chay`), chỉ là luôn bằng 1.
                row.so_luot_chay = 1
            # GIA CÔNG NGOÀI (spec 2026-09-26 §7): bước thuê ngoài KHÔNG tổ, KHÔNG máy — nhà gia công
            # chọn từ danh mục Nhà cung cấp (cờ `nhan_gia_cong`) và TÊN do máy chủ ghi theo. Gỡ ở
            # SERVER chứ không chỉ ẩn ô: tổ còn dính lại là công việc rơi vào bàn tổ đó sau phát hành.
            if row.loai_buoc == LB_THUE_NGOAI:
                row.department_id = None
                row.may_id = None
                row.so_luot_chay = 1
                if "nha_cung_cap_id" in d:
                    ncc_id = d.get("nha_cung_cap_id")
                    if ncc_id is None:
                        row.nha_cung_cap_id, row.nha_cung_cap = None, None
                    elif ncc_id != row.nha_cung_cap_id:
                        ncc = GiaCongNgoaiRepository(self.db).nha_gia_cong(ncc_id)
                        if ncc is None:
                            raise LsxValidationError(
                                "Nhà gia công phải là nhà cung cấp đang hoạt động có tích "
                                "“Nhận gia công” — vào màn Nhà cung cấp để tích.")
                        row.nha_cung_cap_id, row.nha_cung_cap = ncc.id, ncc.name
            else:
                # Đổi khỏi thuê ngoài thì dọn dữ liệu nhà gia công — không để checklist hiểu nhầm.
                row.nha_cung_cap_id, row.nha_cung_cap = None, None
            # ⚠️ Cả khối ĐẦU VIỆC KHOÁN của bước GỠ 18/09/2026 (mg `0320`): nhận `piece_rate_id`,
            #    ghim `khoan_json`, kế thừa kíp chuẩn + năng suất người-giờ, và cửa dọn ảnh chụp
            #    cho bước máy / thuê ngoài. Bước thôi mang đầu việc; việc khoán chọn LÚC GHI MẺ ở
            #    bàn tổ (`san_xuat_batch.piece_rate_id`), nơi thợ biết mình vừa làm gì. Cửa
            #    `source_changed` + `_ke_thua` đi theo luôn — chúng chỉ phục vụ khối này.

            # Cặp TỔ × MÁY (spec máy thuộc tổ §4.7) — cùng lối soi tổ ở trên: chỉ khi bước mới hoặc
            # tổ/máy/công đoạn đổi, để lệnh cũ đang lệch vẫn lưu được các sửa khác.
            doi_cap = old_dept_id != row.department_id or old_may_id != row.may_id
            if (not buoc_moi and doi_cap and row.id in da_bat_dau
                    and LB_MAY in (old_loai, row.loai_buoc)):
                raise LsxValidationError("Việc đã bắt đầu ở bàn tổ — đổi máy ở bàn tổ")
            if row.loai_buoc == LB_MAY and (buoc_moi or doi_cap or old_cd_id != cd_id):
                if loi := loi_cap(self.db, cd_obj, row.department_id, row.may_id):
                    raise LsxValidationError(loi)
            if cd_id and old_cd_id != cd_id:
                doi_cd.append(row)
            rows.append(row)
        # Bước đang bị một bài ghép ĐÈ mà biến mất khỏi payload → bài mất chỗ bám. Chặn ở đây
        # thay vì để lớp đè âm thầm trỏ vào một `step_key` không còn tồn tại. Neo nay là
        # `bai_ghep_cong_doan_map` (mọi bước đã gộp), không riêng bước in.
        con_lai = {r.step_key for r in rows}
        mat = self.db.execute(
            select(BaiGhep.ma, BaiGhepCongDoanMap.lsx_step_key, BaiGhepCongDoan.ten)
            .join(BaiGhepCongDoan, BaiGhepCongDoan.bai_ghep_id == BaiGhep.id)
            .join(BaiGhepCongDoanMap,
                  BaiGhepCongDoanMap.bai_ghep_cong_doan_id == BaiGhepCongDoan.id)
            .where(BaiGhepCongDoanMap.lsx_id == lsx.id)
        ).all()
        hong = next((m for m in mat if m[1] not in con_lai), None)
        if hong:
            raise LsxConflict(
                f'Bước "{hong[2]}" đang chạy chung trong bài ghép {hong[0]} — tách bước khỏi bài '
                f"trước khi bỏ nó khỏi routing"
            )
        removed_ids = {r.id for r in lsx.cong_doans if r not in rows and r.id is not None}
        # Cạnh còn sống trỏ VÀO bước sắp xoá. Phân đôi theo chủ sở hữu bước phụ thuộc:
        #  · Bước ở LỆNH KHÁC → chặn: routing của lệnh này không có quyền viết lại cạnh của lệnh kia.
        #  · Bước trong CHÍNH lệnh này → cạnh đó đang được chính lần lưu này vẽ lại, gỡ luôn cạnh
        #    chết. Không gỡ thì FK `buoc_truoc_id` (ondelete RESTRICT) làm vỡ `sync_cong_doans`,
        #    còn chặn cứng thì XEM TRƯỚC báo oan — payload xem-trước cố ý KHÔNG gửi
        #    `phu_thuoc_step_keys` (xem `LsxRoutingTable.xemTruocChuoi`) nên mọi lần bỏ bước giữa
        #    chuỗi đều dính "Không thể xóa bước đang được <chính lệnh này> phụ thuộc".
        canh_chet: list[LsxCongDoanPhuThuoc] = []
        for e in self.repo.phu_thuoc_toi_buoc(removed_ids):
            if e.buoc_sau_id in removed_ids:
                continue
            dep = self.db.get(LsxCongDoan, e.buoc_sau_id)
            if dep is not None and dep.lsx_id == lsx.id:
                canh_chet.append(e)
                continue
            dep_lsx = self.db.get(Lsx, dep.lsx_id) if dep else None
            raise LsxConflict(
                f"Không thể xóa bước đang được {dep_lsx.ma if dep_lsx else 'LSX khác'} / "
                f"{dep.ten if dep else 'công đoạn khác'} phụ thuộc"
            )
        for e in canh_chet:
            dep = self.db.get(LsxCongDoan, e.buoc_sau_id)
            if dep is not None and e in dep.phu_thuoc:
                dep.phu_thuoc.remove(e)   # delete-orphan
            else:
                self.db.delete(e)
        if canh_chet:
            self.db.flush()
        self.repo.sync_cong_doans(lsx, rows)

        # Vật tư là khai báo riêng của bước, chọn từ danh mục; không đọc PTG.
        for row, d in zip(rows, payloads):
            ngoai = row.loai_buoc == LB_THUE_NGOAI
            if "vat_tus" not in d and not ngoai:
                continue
            # Bước thuê ngoài không có dòng vật tư (spec §3): đổi sang thuê ngoài là dọn sạch.
            vat_tus = [] if ngoai else (d.get("vat_tus") or [])
            # Khoá là CẶP `(hang_loai, id)` (08/09/2026): bước ăn cả giấy lẫn vật tư, mà Giấy #7 và
            # Vật tư #7 là hai món khác nhau — khoá bằng id trần sẽ báo trùng oan và ghi nhầm món.
            caps = [(str(v.get("hang_loai") or HANG_VAT_TU), int(v.get("vat_tu_id") or 0))
                    for v in vat_tus]
            if len(caps) != len(set(caps)):
                raise LsxValidationError("Một vật tư không được chọn trùng trong cùng công đoạn")
            # Dòng giấy: khổ/số/dạng/đơn vị do MÁY ghi theo đầu vào của bước (`_dong_bo_dong_giay`, cuối
            # `_ap_chuoi_nguoc`) — số + khổ client gửi lên bị bỏ, người lập lệnh chỉ chọn MÃ giấy.
            # Món ĐÃ nằm trên bước từ trước — giữ lại được kể cả khi danh mục đã ngừng nó. Chặn cả
            # hai kiểu như trước thì một lệnh cũ có vật tư ngừng dùng là KHÔNG LƯU LẠI ĐƯỢC routing
            # nữa, kể cả khi người ta chỉ sửa cái khác.
            cu_theo_cap = {(v.hang_loai, int(v.vat_tu_id)): v for v in row.vat_tus if v.vat_tu_id}
            mons = self._mon_active()
            thieu = [c for c in caps if c not in mons and c not in cu_theo_cap]
            if thieu:
                raise LsxValidationError(
                    "Vật tư không tồn tại hoặc đã ngừng dùng — chọn món khác")
            # Định mức vật tư khác: máy tính bằng công thức định mức của chính vật tư + chip + số
            # của bước. Không tính được (chưa khai công thức / chip thiếu) thì giữ số cũ của dòng
            # cùng món, chưa có thì 0. NGOẠI LỆ (03/10/2026): dòng người đã gõ định mức (`sua_tay`)
            # thì giữ đúng số gửi lên — máy không tính đè.
            tinh_lai: dict[tuple[str, int], float] = {}
            quy_cach_tl = quy_cach_bien(lsx)
            for item, cap in zip(vat_tus, caps):
                if cap[0] == HANG_GIAY:
                    continue
                if item.get("sua_tay") and item.get("so_luong") is not None:
                    tinh_lai[cap] = float(item["so_luong"])
                    continue
                rows_tl, _ = self._vat_tu_bung(
                    None, row, quy_cach_tl,
                    dong_nguon=[(cap[1], dict(item.get("gia_tri_chip") or {}))])
                if rows_tl:
                    tinh_lai[cap] = float(rows_tl[0]["so_luong"])
                else:
                    cu_tl = cu_theo_cap.get(cap)
                    tinh_lai[cap] = _f(getattr(cu_tl, "so_luong", 0))
            row.vat_tus.clear()
            # FLUSH giữa xoá và thêm: bảng có UNIQUE (lsx_cong_doan_id, hang_loai, vat_tu_id), mà
            # lưu lại bước với ĐÚNG món cũ là xoá rồi thêm lại chính cặp đó. Không ép DELETE chạy
            # trước thì SQLAlchemy gộp một lượt và INSERT đụng hàng chưa kịp xoá → 500 ngay khi
            # bấm Lưu lần thứ hai mà không đổi gì.
            self.db.flush()
            for pos, (item, cap) in enumerate(zip(vat_tus, caps)):
                sua_tay_dong = (cap[0] != HANG_GIAY and bool(item.get("sua_tay"))
                                and item.get("so_luong") is not None)
                # Món đã ngừng dùng thì `_mon_active` không có — mượn SNAPSHOT của chính dòng cũ,
                # đúng thứ đang hiện trên màn, thay vì để tên/đơn vị rỗng.
                mon = mons.get(cap)
                cu = cu_theo_cap.get(cap)
                row.vat_tus.append(LsxCongDoanVatTu(
                    hang_loai=cap[0],
                    vat_tu_id=cap[1],
                    # `or ""`: đơn vị gốc có thể CHƯA KHAI (nullable từ 2026-08-08) còn cột
                    # snapshot NOT NULL — không chặn thì IntegrityError 500.
                    vat_tu_ma_snapshot=(getattr(mon, "ma", None)
                                        or getattr(cu, "vat_tu_ma_snapshot", None) or ""),
                    vat_tu_ten_snapshot=(getattr(mon, "ten", None)
                                         or getattr(cu, "vat_tu_ten_snapshot", None) or ""),
                    # Giấy của BƯỚC lệnh mang MÃ CHẶNG tờ nguyên (dữ liệu sản xuất, spec §4.2) —
                    # không phải đơn vị kho `to`, cũng không mượn `don_vi_gia` (kg) của mã.
                    don_vi_snapshot=((getattr(cu, "don_vi_snapshot", None) or TRAM_TO_NGUYEN)
                                     if cap[0] == HANG_GIAY else
                                     (getattr(mon, "don_vi_gia", None)
                                      or getattr(cu, "don_vi_snapshot", None) or "")),
                    # Giấy giữ khổ của dòng cũ cùng mã: Cắt giấy cuộn đọc RỘNG CUỘN người kế hoạch
                    # chọn từ chính dòng này (`_dong_giay_khau_chuan_bi`); về 0 là mất cuộn, 0 kg.
                    # Bước khác thì `_dong_bo_dong_giay` ghi đè khổ theo đầu vào ngay sau.
                    kho_rong=(int(getattr(cu, "kho_rong", 0) or 0) if cap[0] == HANG_GIAY else 0),
                    kho_dai=(int(getattr(cu, "kho_dai", 0) or 0) if cap[0] == HANG_GIAY else 0),
                    # Giấy: số tạm 0 (cùng đơn vị, dạng, khổ) — `_dong_bo_dong_giay` ghi đè ngay sau.
                    so_luong=(0 if cap[0] == HANG_GIAY else tinh_lai[cap]),
                    gia_tri_chip=(None if cap[0] == HANG_GIAY
                                  else dict(item.get("gia_tri_chip") or {})),
                    thu_tu=pos,
                    # Cờ MÁY BUNG / NGƯỜI KHAI đi theo từng dòng: lần bung sau chỉ thay dòng máy,
                    # dòng người đã sửa thì chừa ra. Client cũ không gửi ⇒ False = người khai.
                    # Dòng gõ tay định mức luôn là người khai — bung lại / đồng bộ danh mục chừa ra.
                    tu_dong=bool(item.get("tu_dong")) and not sua_tay_dong,
                    sua_tay=sua_tay_dong,
                ))

        # Một lệnh tối đa 1 mã Giấy + 1 mã Sóng (19/10/2026) — đếm trên dòng THẬT của mọi bước sau khi
        # gán, kể cả bước payload không gửi `vat_tus` (giữ nguyên dòng cũ).
        ids_giay = id_giay_cua_rows(sorted(rows, key=lambda r: r.thu_tu or 0))
        loi = loi_tran_giay(lsx.ma, ids_giay, bang_giay(self.db, ids_giay), chu_the="Lệnh")
        if loi:
            raise LsxValidationError(loi)

        # Ghi lại cạnh đến từng bước; key có thể trỏ bước cùng LSX hoặc LSX khác cùng đơn hàng.
        all_keys = {k for d in payloads for k in (d.get("phu_thuoc_step_keys") or [])}
        predecessors = {
            x.step_key: x for x in self.db.execute(
                select(LsxCongDoan).where(LsxCongDoan.step_key.in_(all_keys))
            ).scalars()
        } if all_keys else {}
        for row, d in zip(rows, payloads):
            if "phu_thuoc_step_keys" not in d:
                continue
            desired_ids: list[int] = []
            for key in dict.fromkeys(d.get("phu_thuoc_step_keys") or []):
                pred = predecessors.get(key)
                if pred is None:
                    raise LsxValidationError("Không tìm thấy công đoạn tiền nhiệm")
                if pred.id == row.id:
                    raise LsxValidationError("Công đoạn không thể tự phụ thuộc")
                pred_lsx = self.db.get(Lsx, pred.lsx_id)
                if pred_lsx is None or pred_lsx.order_id != lsx.order_id:
                    raise LsxValidationError("Chỉ được phụ thuộc công đoạn thuộc cùng đơn hàng")
                desired_ids.append(pred.id)
            # Giữ lại cạnh không đổi để tránh INSERT đụng UNIQUE trước khi ORM kịp DELETE cạnh cũ.
            existing = {edge.buoc_truoc_id: edge for edge in row.phu_thuoc}
            row.phu_thuoc[:] = [existing[pred_id] for pred_id in desired_ids if pred_id in existing]
            for pred_id in desired_ids:
                if pred_id not in existing:
                    row.phu_thuoc.append(LsxCongDoanPhuThuoc(buoc_truoc_id=pred_id))
        self.db.flush()
        self._kiem_chu_trinh_phu_thuoc(lsx.order_id)
        self._ap_chuoi_nguoc(lsx)     # đơn vị + số lượng của MỌI bước là dẫn xuất, server ghi
        # Nối/gỡ cạnh chéo đổi một lệnh khác thành (hoặc thôi là) lệnh ĐI KÈM ⇒ bước cuối của nó
        # đổi luật đơn vị (LƯỢT 3 của `_ap_chuoi_nguoc`), phải tính lại ngay. Lệnh đã lập kế hoạch
        # trở đi giữ nguyên số đã chụp.
        for khac_id in sorted(di_kem_cu ^ self._lenh_nguon_cheo(lsx.id)):
            khac = self.db.get(Lsx, khac_id)
            if khac is not None and khac.trang_thai in (TT_NHAP, TT_CHO_BO_SUNG, TT_SAN_SANG):
                self._ap_chuoi_nguoc(khac)
        # SAU chuỗi ngược: lượng vật tư tính trên số vào–ra của chính bước, số ấy vừa mới chốt.
        self._bung_lai_vat_tu(lsx, doi_cd)
        if commit:
            # Chặn LƯU tuyến hỏng (18/10/2026, lỗi #15 #29) — sau chuỗi ngược vì đơn vị vào/ra của
            # bước do nó ghi. Xem trước vẫn đi tiếp: người lập lệnh cần số để thấy chỗ hỏng.
            self._kiem_tuyen_luu(lsx, rows)
        if not commit:
            # XEM TRƯỚC (đổi/chèn công đoạn): số vào–ra + đơn vị của MỌI bước đã nằm trên
            # `lsx.cong_doans` nhưng CHƯA ghi DB. Không đụng bài ghép / trạng thái / audit —
            # người gọi (`xem_truoc_routing`) đọc số xong rollback. Trả `lsx` in-session.
            return lsx
        self._bai_ghep_xep_lai(lsx)   # lệnh đang ghép → thứ tự bước chung của bài phải theo
        thieu = self.thieu_cua(lsx)
        if thieu and lsx.trang_thai != TT_CHO_BO_SUNG:
            lsx.trang_thai = TT_CHO_BO_SUNG
        elif not thieu and lsx.trang_thai == TT_CHO_BO_SUNG:
            lsx.trang_thai = TT_NHAP
        # §10: routing lệch bài tính giá thì phải lưu NGƯỜI xác nhận (audit đã có) + LÝ DO.
        detail = f"Sửa routing lệnh {lsx.ma}: {truoc} → {len(rows)} công đoạn"
        if (ly_do or "").strip():
            detail += f" — lý do: {ly_do.strip()}"
        self.audit.create(
            actor_user_id=actor.id, action="update_lsx_routing", target=f"lsx:{lsx.id}",
            detail=detail,
        )
        self.repo.commit()
        return self.get(lsx_id)

    def _bai_ghep_xep_lai(self, lsx: Lsx) -> None:
        """Routing của lệnh đổi → đánh lại thứ tự bước chung của bài rồi tính lại. KHÔNG commit.

        `_sap_lai_thu_tu` trước đây chỉ chạy khi GỘP / TÁCH. Nhưng sửa routing đổi được cả
        `thu_tu` lẫn `cong_doan_id` của bước đang bị đè (chỉ XOÁ bước đó mới bị chặn), nên
        `thu_tu` của bước chung thiu ngay sau lần kéo-thả đầu tiên — mà `_node_chungs` chạy
        NGƯỢC theo đúng thứ tự đó để chia hao. Sai lặng lẽ, không ai báo.

        Import trễ y như `BaiGhepService._lsx_svc` đi chiều ngược lại: hai service gọi chéo nhau,
        import ở đầu file là vòng.
        """
        ghep = self._ghep_cua(lsx)
        if ghep is None:
            return
        from ..repositories.bai_ghep_repo import BaiGhepRepository
        from .bai_ghep_service import BaiGhepService

        svc = BaiGhepService(self.db, BaiGhepRepository(self.db), self.audit, self.sequence)
        bg = ghep[0]
        svc._sap_lai_thu_tu(bg)
        svc._tinh_lai(bg)

    def _kiem_tuyen_luu(self, lsx: Lsx, rows: list[LsxCongDoan]) -> None:
        """Từ chối lưu tuyến lệnh mà xưởng chạy sẽ ra số sai hoặc kẹt (18/10/2026):

        · phụ thuộc NGƯỢC — bước trỏ tới bước đứng SAU nó trong bảng (▲▼ chỉ dời dòng, không
          nối lại dây, lỗi #15);
        · cạnh BẮC CẦU — A → C trong khi C đã nhận từ A qua B: ra xưởng C đòi nhận hàng từ A, mà A
          giao hết cho B, C kẹt vĩnh viễn (lỗi #29);
        · chuỗi ĐỨT ĐƠN VỊ trên dòng giấy — bước sau nhận thứ bước trước không nhả ra, chuỗi ngược
          chia hệ số sai (1.400 → 413 tờ in cho 5.000 hộp, lỗi #15). Dùng chung luật với phiếu tính
          giá (`bu_hao_engine.kiem_chuoi_don_vi`).

        Cạnh ngầm theo thứ tự bảng (bước không khai cạnh ra nào ⇒ đứng trước bước liền sau, đúng
        luật `cong_viec_chang_truoc` của xưởng) được tính như cạnh thật. Lệnh CŨ đã lưu tuyến hỏng
        vẫn mở được — hàm chỉ chạy lúc lưu."""
        from .bu_hao_engine import kiem_chuoi_don_vi

        vi_tri = {r.id: i for i, r in enumerate(rows)}
        ten = {r.id: r.ten for r in rows}
        step_ids = set(self.db.execute(
            select(LsxCongDoan.id).join(Lsx, Lsx.id == LsxCongDoan.lsx_id)
            .where(Lsx.order_id == lsx.order_id)
        ).scalars())
        canh = set(self.db.execute(select(
            LsxCongDoanPhuThuoc.buoc_truoc_id, LsxCongDoanPhuThuoc.buoc_sau_id
        ).where(LsxCongDoanPhuThuoc.buoc_sau_id.in_(step_ids))).all()) if step_ids else set()
        # Tề sóng phải nhả vào một bước bồi (24/10/2026) — xét cạnh THẬT, trước khi thêm cạnh ngầm.
        boi_ids = {r.id for r in rows if r.cong_doan_id in self._id_boi()}
        for r in rows:
            if self._la_te_song(r) and not any((r.id, b) in canh for b in boi_ids):
                raise LsxValidationError(
                    "Tề sóng cần bước bồi — giữ một bước bồi nối từ Tề sóng, hoặc bỏ luôn Tề sóng.")
        co_canh_ra = {a for a, _ in canh}
        for truoc, sau in zip(rows, rows[1:]):
            if truoc.id not in co_canh_ra:
                canh.add((truoc.id, sau.id))

        def _ten(i: int) -> str:
            if i not in ten:
                c = self.db.get(LsxCongDoan, i)
                ten[i] = c.ten if c is not None else "?"
            return ten[i]

        for a, b in sorted(canh):
            if a in vi_tri and b in vi_tri and vi_tri[a] > vi_tri[b]:
                raise LsxValidationError(
                    f"Bước '{_ten(b)}' phụ thuộc bước '{_ten(a)}' đứng sau nó — đổi chỗ lại hoặc "
                    f"sửa tab Phụ thuộc của '{_ten(b)}'.")

        sau_cua: dict[int, set[int]] = {}
        for a, b in canh:
            sau_cua.setdefault(a, set()).add(b)

        def _toi_duoc(tu: int, dich: int, bo: tuple[int, int]) -> bool:
            ngan, da = [tu], {tu}
            while ngan:
                x = ngan.pop()
                for y in sau_cua.get(x, ()):
                    if (x, y) == bo or y in da:
                        continue
                    if y == dich:
                        return True
                    da.add(y)
                    ngan.append(y)
            return False

        for r in rows:
            truoc = sorted(a for a, b in canh if b == r.id)
            for a in truoc:
                qua = next((q for q in truoc if q != a and _toi_duoc(a, q, (a, r.id))), None)
                if qua is not None:
                    raise LsxValidationError(
                        f"Bước '{r.ten}' phụ thuộc thẳng '{_ten(a)}' trong khi đã nhận qua "
                        f"'{_ten(qua)}' — bỏ '{_ten(a)}' khỏi tab Phụ thuộc của '{r.ten}', nếu không "
                        f"ra xưởng '{r.ten}' sẽ chờ hàng từ '{_ten(a)}' mãi.")

        tram = self._tram()
        tren = [r for r in rows if tren_dong_giay(r.don_vi_vao, r.don_vi_ra, tram)
                and not self._la_te_song(r)]
        loi = kiem_chuoi_don_vi([
            {"ten": r.ten, "dv_vao": r.don_vi_vao, "dv_ra": r.don_vi_ra,
             "tram_vao": tram_cua(r.don_vi_vao, tram), "tram_ra": tram_cua(r.don_vi_ra, tram)}
            for r in tren
        ])
        if loi:
            raise LsxValidationError(" ".join(loi) + " Đổi chỗ lại các bước rồi lưu.")

    def _kiem_chu_trinh_phu_thuoc(self, order_id: int) -> None:
        step_ids = set(self.db.execute(
            select(LsxCongDoan.id).join(Lsx, Lsx.id == LsxCongDoan.lsx_id)
            .where(Lsx.order_id == order_id)
        ).scalars())
        edges = self.db.execute(select(
            LsxCongDoanPhuThuoc.buoc_truoc_id, LsxCongDoanPhuThuoc.buoc_sau_id
        ).where(
            LsxCongDoanPhuThuoc.buoc_truoc_id.in_(step_ids),
            LsxCongDoanPhuThuoc.buoc_sau_id.in_(step_ids),
        )).all() if step_ids else []
        graph: dict[int, list[int]] = {i: [] for i in step_ids}
        indegree = {i: 0 for i in step_ids}
        for a, b in edges:
            graph[a].append(b)
            indegree[b] += 1
        queue = [i for i, n in indegree.items() if n == 0]
        seen = 0
        while queue:
            node = queue.pop()
            seen += 1
            for nxt in graph[node]:
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    queue.append(nxt)
        if seen != len(step_ids):
            raise LsxValidationError("Phụ thuộc công đoạn tạo thành vòng lặp")

    def set_trang_thai(self, *, lsx_id: int, trang_thai: str, actor) -> Lsx:
        lsx = self.get(lsx_id)
        if trang_thai not in TRANG_THAI_LSX:
            raise LsxValidationError("Trạng thái không hợp lệ")
        if trang_thai == TT_DA_LAP_KE_HOACH:
            raise LsxValidationError("Lập kế hoạch qua màn Xếp lịch, không đổi trực tiếp ở đây")
        if lsx.trang_thai == TT_DA_LAP_KE_HOACH:
            raise LsxConflict("Lệnh đã lập kế hoạch — gỡ kế hoạch trước")
        if trang_thai == TT_DA_DONG or lsx.trang_thai == TT_DA_DONG:
            raise LsxConflict("Lệnh đã đóng — KCS đóng/mở lại ở màn KCS, không đổi trực tiếp ở đây")
        # "Đã phát hành" chỉ đến từ cửa PHÁT HÀNH (đóng băng gói công việc) — Xếp lịch hoặc Gia
        # công trọn gói. Đổi tay ở đây là lệnh "đã phát" mà xưởng không có việc nào.
        if trang_thai == TT_DA_PHAT_HANH:
            raise LsxValidationError(
                "Phát hành qua màn Xếp lịch (hoặc Gia công trọn gói), không đổi trực tiếp ở đây")
        if lsx.trang_thai == TT_DA_PHAT_HANH:
            raise LsxConflict(
                "Lệnh đã phát hành — thu hồi ở màn Xếp lịch (hoặc huỷ gia công trọn gói) trước")
        if trang_thai == TT_SAN_SANG:
            thieu = self.thieu_cua(lsx)
            if thieu:
                raise LsxConflict("Còn thiếu dữ liệu — bổ sung xong mới đánh dấu sẵn sàng")
        lsx.trang_thai = trang_thai
        self.audit.create(
            actor_user_id=actor.id, action="lsx_trang_thai", target=f"lsx:{lsx.id}",
            detail=f"Lệnh {lsx.ma} → {NHAN_TRANG_THAI.get(trang_thai, trang_thai)}",
        )
        self.repo.commit()
        return self.get(lsx_id)

    def xoa(self, *, lsx_id: int, actor) -> int:
        """Xoá lệnh chưa phát hành → dòng đơn quay lại hàng chờ. Trả `order_id` để router bắn SSE."""
        lsx = self.get(lsx_id)
        if lsx.trang_thai == TT_DA_LAP_KE_HOACH:
            raise LsxConflict("Lệnh đã lập kế hoạch — gỡ kế hoạch trước khi xoá")
        # Đã phát hành ⇒ xưởng đang giữ gói việc, có thể đã có lần gia công ngoài (FK CASCADE sẽ cuốn
        # mất cả lần gia công lẫn vết mang đi/chốt). Phải thu hồi / huỷ trọn gói trước.
        if lsx.trang_thai == TT_DA_PHAT_HANH:
            raise LsxConflict(
                "Lệnh đã phát hành — thu hồi ở màn Xếp lịch (hoặc huỷ gia công trọn gói) trước khi xoá")
        if lsx.trang_thai == TT_DA_DONG:
            raise LsxConflict("Lệnh đã đóng — không xoá được")
        # Coupling bài ghép: neo thành viên là FK RESTRICT (chặn ở Postgres); SQLite dev tắt FK nên
        # chặn ở đây + báo đẹp. Gỡ LSX khỏi bài ghép trước rồi mới xoá được lệnh.
        ghep_ma = self.db.execute(
            select(BaiGhep.ma)
            .join(BaiGhepThanhVien, BaiGhepThanhVien.bai_ghep_id == BaiGhep.id)
            .where(BaiGhepThanhVien.lsx_id == lsx_id)
        ).scalars().first()
        if ghep_ma:
            raise LsxConflict(f"LSX đang trong bài ghép {ghep_ma} — gỡ khỏi bài trước khi xoá")
        self._chan_dang_giu_cho(lsx)
        order_id, ma = lsx.order_id, lsx.ma
        self.repo.delete(lsx)
        self.audit.create(
            actor_user_id=actor.id, action="delete_lsx", target=f"lsx:{lsx_id}",
            detail=f"Xoá lệnh {ma}",
        )
        self.repo.commit()
        return order_id
