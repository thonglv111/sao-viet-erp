"""Schema màn "Theo dõi sản xuất" (làm gọn 05/10/2026) — ô lọc, Theo máy, Theo lệnh.

Không một số tiền nào. Mốc giờ trả ra là giờ xưởng không nhãn múi (`lich_hien_thi` /
`thuc_te_hien_thi`), FE đọc thẳng thành phần ngày giờ.
"""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel

from .lenh_san_xuat import LenhSxChang


class BoLocMucOut(BaseModel):
    """MỘT ô chọn. `id` là CHUỖI cho mọi nhóm (FE so khớp một kiểu); FastAPI tự ép về `int` ở
    tham số khai kiểu số."""

    id: str
    ten: str | None = None


class BoLocMayMucOut(BoLocMucOut):
    """Ô chọn MÁY: `ngung_dung` = `may_thiet_bi.active=False`; `co_viec` = còn ít nhất một công
    việc chưa xong trong phạm vi người gọi — GỢI Ý hiển thị, không phải bộ lọc."""

    ngung_dung: bool = False
    co_viec: bool = False


class BoLocOut(BaseModel):
    may: list[BoLocMayMucOut] = []
    khach_hang: list[BoLocMucOut] = []


class LsxThamChieuOut(BaseModel):
    """MỘT lệnh mà một công việc đang gánh — `ma` để đọc, `lsx_id` để mở hồ sơ."""

    lsx_id: int
    ma: str
    ten: str | None = None
    is_rush: bool = False


# --- Làm gọn 05/10/2026: dải bất thường + góc Theo lệnh -------------------------------------------
class DemBatThuongOut(BaseModel):
    """Số trên dải bất thường — đếm trên TOÀN tập còn sống trong phạm vi, trước ô tìm/khách/máy."""

    tre_han: int = 0
    su_co: int = 0
    tam_dung: int = 0
    kcs_khong_dat: int = 0
    may_hong: int = 0
    chua_may: int = 0


class TheoLenhDongOut(BaseModel):
    """MỘT lệnh còn sống. `canh_bao` ⊆ `tre_han` / `su_co` / `tam_dung` / `kcs_khong_dat`.
    `tre_ngay` = số ngày đã qua hạn giao khách, chỉ có khi `tre_han`."""

    lsx_id: int
    ma: str
    ten: str | None = None
    is_rush: bool = False
    so_luong_dat: int
    don_vi_tinh: str | None = None
    khach_hang: str | None = None
    chang: list[LenhSxChang] = []
    buoc_hien_tai: str | None = None
    khau: str
    khau_chi_tiet: str | None = None
    han_hoan_thanh_sx: date | None = None
    #: Ngày tạo lệnh — cột "Ngày tạo" của bảng (06/10/2026).
    created_at: datetime | None = None
    canh_bao: list[str] = []
    tre_ngay: int | None = None


class TheoLenhOut(BaseModel):
    items: list[TheoLenhDongOut] = []
    total: int = 0
    bat_thuong: DemBatThuongOut


# --- Góc Theo máy (làm gọn 05/10/2026, đặc tả 3.3) ------------------------------------------------
class TdsxViecOut(BaseModel):
    """MỘT công việc trên dòng máy. `bai_ma` có khi là việc GHÉP; `lsx` là mọi lệnh nó phục vụ —
    từ hai lệnh trở lên giao diện bắt chọn, không đoán lấy cái đầu."""

    cong_viec_id: int
    ten_buoc: str | None = None
    trang_thai: str
    bai_ma: str | None = None
    lsx: list[LsxThamChieuOut] = []


class TdsxSanLuongDonViOut(BaseModel):
    don_vi: str | None = None
    tot: float


class TdsxSanLuongOut(BaseModel):
    """`tot = None` khi mẻ ghi lẫn đơn vị — khi đó chỉ có `theo_don_vi`, không vẽ thanh."""

    tot: float | None = None
    ke_hoach: float | None = None
    don_vi: str | None = None
    theo_don_vi: list[TdsxSanLuongDonViOut] = []
    ca_bai: bool = False


class TdsxMayDongOut(BaseModel):
    """MỘT dòng của bảng Theo máy: một máy, một nhà gia công, hoặc một bước chưa có máy.
    `khoa` duy nhất trong cả bảng (`may:<id>`, `ncc:<tên>`, `cv:<id>`)."""

    khoa: str
    may_id: int | None = None
    ten: str | None = None
    ngung_dung: bool = False
    tinh_trang: str
    nhan_tinh_trang: str
    dang_chay: TdsxViecOut | None = None
    dang_chay_them: int = 0
    san_luong: TdsxSanLuongOut | None = None
    ke_hoach_xong: datetime | None = None
    ke_hoach_bat_dau: datetime | None = None
    ke_tiep: list[TdsxViecOut] = []
    ke_tiep_them: int = 0


class TdsxNhomMayOut(BaseModel):
    """`loai` ∈ `chua_may` / `may` / `may_da_xoa` / `gia_cong`; nhóm `may` mang `ten = loai_may`."""

    loai: str
    ten: str
    dong: list[TdsxMayDongOut] = []


class TheoMayOut(BaseModel):
    nhom: list[TdsxNhomMayOut] = []
    may_trong: list[TdsxMayDongOut] = []
    bat_thuong: DemBatThuongOut


# --- Theo đơn (12/10/2026, mockup theo-doi-don-san-xuat phương án A bản 3) ---------------------
class MonTomTatOut(BaseModel):
    """Mặt hàng đại diện của một đơn (món chậm nhất) — đủ để viết câu "Đang làm" một dòng.
    `o` ∈ `don_hang_san_xuat.O_*`; `nhom` ∈ vuong/dang/chua/kho/giao."""

    ten: str | None = None
    o: str
    nhom: str
    dat: int = 0
    don_vi: str | None = None
    kho_da_nhan: float = 0.0
    da_giao: int = 0
    buoc: str | None = None
    buoc_so: int | None = None
    buoc_tong: int | None = None
    pct: float | None = None
    nha_gia_cong: str | None = None


class DonVuongOut(BaseModel):
    """`ly_do` ∈ tre / su_co / tam_dung / thieu_vat_tu / kcs_khong_dat / dong_thieu / chua_lenh —
    cờ nặng nhất của đơn. `buoc` = bước đang dính cờ đó (khi có)."""

    so_mon: int = 0
    ly_do: str
    buoc: str | None = None


class DonDongOut(BaseModel):
    """MỘT đơn. `chang` ∈ lenh/sx/kho/giao/xong (chặng của món chậm nhất); `nhom` ∈
    dang_lam/cho_giao/da_giao; `can_de_y` cắt ngang."""

    order_id: int
    order_no: str
    khach_hang: str | None = None
    phu_trach: str | None = None
    so_mon: int = 0
    mon_dau: str | None = None
    so_luong: int | None = None
    don_vi: str | None = None
    chang: str
    chang_ket: bool = False
    dai_dien: MonTomTatOut | None = None
    so_mon_kho: int = 0
    so_mon_giao: int = 0
    han_giao: date | None = None
    tre_ngay: int | None = None
    con_ngay: int | None = None
    vuong: DonVuongOut | None = None
    nhom: str
    can_de_y: bool = False


class TheoDonOut(BaseModel):
    """`dem` là FACET của tập đã lọc, không bị chính chip đang chọn lọc lại."""

    items: list[DonDongOut] = []
    total: int = 0
    page: int = 1
    page_size: int = 25
    dem: dict[str, int] = {}


class BuocDonOut(BaseModel):
    """MỘT bước trong routing dọc. `trang_thai` ∈ xong/chay/dung/cho. `to` = tổ làm; bước thuê
    ngoài có `ngoai=True` và `nha_cung_cap`."""

    ten: str | None = None
    to: str | None = None
    ngoai: bool = False
    nha_cung_cap: str | None = None
    trang_thai: str
    hien_tai: bool = False
    hoan_thanh_luc: datetime | None = None
    kcs_khong_dat: float = 0.0
    # Số tốt đã ghi / số ra kế hoạch của bước, theo tên đơn vị ra (13/10/2026).
    lam_ra: float = 0.0
    ke_hoach_ra: float = 0.0
    don_vi_ra: str | None = None


class LenhCuaMonOut(BaseModel):
    """MỘT lệnh của mặt hàng. `tron_goi` ⇒ không có `buoc_ds`, FE bày một bước "Gia công trọn gói".
    `co` ⊆ su_co / tam_dung / thieu_vat_tu / kcs_khong_dat."""

    id: int
    ma: str
    ten: str | None = None
    o: str
    xong: bool = False
    co: list[str] = []
    da_xuong: bool = False
    tron_goi: bool = False
    nha_gia_cong: str | None = None
    buoc: str | None = None
    buoc_so: int | None = None
    buoc_tong: int | None = None
    pct: float | None = None
    buoc_ds: list[BuocDonOut] = []
    # Bước CUỐI routing: số tốt / kế hoạch / đơn vị. None = lệnh chưa xuống xưởng hoặc trọn gói.
    lam_ra: float | None = None
    ke_hoach_ra: float | None = None
    don_vi_ra: str | None = None


class MonDonOut(BaseModel):
    """MỘT mặt hàng của đơn trong ngăn. Xếp sẵn: vướng → đang → chưa có lệnh → đã nhập kho → đã giao."""

    khoa: str
    ten: str | None = None
    dat: int = 0
    don_vi: str | None = None
    o: str
    nhom: str
    co: list[str] = []
    kho_da_nhan: float = 0.0
    da_giao: int = 0
    buoc: str | None = None
    buoc_so: int | None = None
    buoc_tong: int | None = None
    pct: float | None = None
    nha_gia_cong: str | None = None
    lenh: list[LenhCuaMonOut] = []
    # 13/10/2026: làm ra (None khi các lệnh ra đơn vị khác món), hàng đã có kèm phần từ tồn của mã,
    # phần đang giữ cho yêu cầu giao, còn phải giao — cùng nguồn với Đơn hàng bán.
    lam_ra: float | None = None
    co_hang: float = 0.0
    co_tu_ton: float = 0.0
    dang_giu: int = 0
    con_phai_giao: int = 0


class SuKienDonOut(BaseModel):
    """MỘT dòng nhật ký cấp đơn. `luc` có múi giờ; `lenh` = mã lệnh gây ra (None = việc của đơn)."""

    luc: datetime
    loai: str
    noi_dung: str
    lenh: str | None = None


class DonChiTietOut(BaseModel):
    don: DonDongOut
    mon: list[MonDonOut] = []
    lich_su: list[SuKienDonOut] = []
    giao_xuong_luc: datetime | None = None
