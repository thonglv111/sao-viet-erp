"""Schema API Thuê gia công (spec 2026-11-13). Tên người do máy chủ gán từ tài khoản — không có ô
người giao / người nhận / người hoàn tất trong schema nhập."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class ThongTinLenhOut(BaseModel):
    lsx_id: int
    lsx_ma: str
    khach_hang: str = ""
    don_hang_ma: str = ""
    mat_hang: str = ""
    han_giao: date | datetime | None = None


class NhaGiaCongOut(BaseModel):
    id: int
    ten: str
    active: bool = True


class NhaGiaCongIn(BaseModel):
    ten: str = Field(min_length=1, max_length=255)


class VatTuXuongCapOut(BaseModel):
    ten: str
    so_luong: float
    don_vi: str | None = None


class HangChoDongOut(BaseModel):
    viec_id: int
    version: int
    kieu: str
    ten_viec: str
    sl_can: float | None = None
    don_vi: str | None = None
    don_vi_giao: str | None = None
    xuong_cap_giay: bool = False
    lsx_id: int | None = None
    bai_ghep_id: int | None = None
    bai_ghep_ma: str | None = None
    lenh: list[ThongTinLenhOut] = []
    tinh_trang: str
    sl_san_sang: float = 0
    so_buoc: int = 1
    vat_tu_xuong_cap: list[VatTuXuongCapOut] = []
    created_at: datetime | None = None


class HangChoOut(BaseModel):
    items: list[HangChoDongOut]
    total: int
    page: int
    size: int
    facets: dict[str, int] = {}


class TrangThaiViecOut(BaseModel):
    viec_id: int
    version: int
    kieu: str
    ten_viec: str
    sl_can: float | None = None
    don_vi: str | None = None
    xuong_cap_giay: bool = False
    bai_ghep_id: int | None = None
    bai_ghep_ma: str | None = None
    step_keys: list[str] = []
    don_id: int | None = None
    ma_don: str | None = None
    nha_cung_cap_ten: str | None = None
    ngay_hen_ve: date | None = None
    da_giao: float = 0
    dat: float = 0
    hong: float = 0
    con_ngoai: float = 0
    sl_dat: float | None = None
    hao_hut: float | None = None
    trang_thai: str
    nhan: str


class TronGoiIn(BaseModel):
    """Màn lệnh chỉ gắn cờ — gửi `{}`; hai ô còn để dịch vụ / test truyền thẳng khi cần."""
    sl_can: float | None = Field(default=None, gt=0)
    xuong_cap_giay: bool | None = None


class HuyTronGoiIn(BaseModel):
    version: int
    ly_do: str = Field(min_length=3, max_length=500)


class VersionIn(BaseModel):
    version: int


# --- Đơn gia công ---------------------------------------------------------------------------
class DonDongIn(BaseModel):
    viec_id: int
    sl_dat: float = Field(gt=0)
    don_gia: float = Field(default=0, ge=0)
    #: Chỉ việc trọn gói: True = xưởng cấp giấy, False = nhà gia công tự lo; None = giữ nguyên.
    xuong_cap_giay: bool | None = None


class DonIn(BaseModel):
    nha_cung_cap_id: int
    ngay_dat: date
    ngay_hen_ve: date | None = None
    ghi_chu: str | None = Field(default=None, max_length=2000)
    dong: list[DonDongIn] = Field(min_length=1)


class DonTaoIn(DonIn):
    dat: bool = False


class DonSuaIn(DonIn):
    version: int


class HuyIn(BaseModel):
    version: int
    ly_do: str = Field(min_length=3, max_length=500)


class VatTuNgoaiOut(BaseModel):
    """Vật tư từ kho của một dòng đơn: ghi trên phiếu giao, kho xuất thực, đã trả, còn ở ngoài."""
    hang_loai: str
    hang_id: int
    kho_rong: int = 0
    kho_dai: int = 0
    kho: str | None = None
    ten: str = ""
    don_vi: str | None = None
    giao: float = 0
    xuat: float = 0
    tra: float = 0
    con_ngoai: float = 0


class DonDongOut(BaseModel):
    id: int
    viec_id: int
    ten_viec: str
    kieu: str
    xuong_cap_giay: bool = False
    sl_can: float | None = None
    lenh: list[ThongTinLenhOut] = []
    bai_ghep_id: int | None = None
    bai_ghep_ma: str | None = None
    sl_dat: float
    don_vi: str | None = None
    don_gia: float = 0
    thanh_tien_dat: float = 0
    da_giao: float = 0
    don_vi_giao: str | None = None
    giao_quy_doi: float = 0
    dat: float = 0
    hong: float = 0
    con_ngoai: float = 0
    tam_tinh: float = 0
    co_giao: bool = False
    co_nhan: bool = False
    hoan_tat_luc: datetime | None = None
    hao_hut: float | None = None
    huy_luc: datetime | None = None
    ly_do_khong_hoan_tat: str | None = None
    ly_do_khong_mo_lai: str | None = None
    vat_tu_ngoai: list[VatTuNgoaiOut] = []


class ChungTuNganOut(BaseModel):
    id: int
    ma: str
    luc: datetime
    nguoi_ten: str | None = None
    huy_luc: datetime | None = None


class LichSuOut(BaseModel):
    id: int
    luc: datetime
    nguoi_ten: str = ""
    hanh_dong: str
    chi_tiet: str = ""


class DonOut(BaseModel):
    id: int
    ma: str
    version: int
    nha_cung_cap_id: int
    nha_cung_cap_ten: str
    ngay_dat: date
    ngay_hen_ve: date | None = None
    ghi_chu: str | None = None
    dat_luc: datetime | None = None
    nguoi_dat_ten: str | None = None
    huy_luc: datetime | None = None
    nguoi_huy_ten: str | None = None
    ly_do_huy: str | None = None
    created_at: datetime
    nguoi_tao_ten: str | None = None
    trang_thai: str
    nhan_trang_thai: str
    dong: list[DonDongOut] = []
    lenh: list[ThongTinLenhOut] = []
    tong_tien_dat: float = 0
    tam_tinh_da_nhan: float = 0
    # Ngăn đơn (đã đặt, chưa huỷ): còn thứ xưởng phải giao không — False thì nút Giao hàng mờ.
    co_gi_de_giao: bool = True
    phieu_giao: list[ChungTuNganOut] = []
    phieu_nhan: list[ChungTuNganOut] = []
    lich_su: list[LichSuOut] = []


class DonListOut(BaseModel):
    items: list[DonOut]
    total: int
    page: int
    size: int
    facets: dict[str, int] = {}


class GoiYDonGiaOut(BaseModel):
    don_gia: float | None = None


# --- Phiếu giao -------------------------------------------------------------------------------
class PgBanGiaoOut(BaseModel):
    ban_giao_id: int
    so_luong: float
    don_vi: str | None = None
    nguon_ten: str = ""
    luc: datetime | None = None


class PgBanThanhPhamOut(BaseModel):
    don_vi: str | None = None
    ban_giao: list[PgBanGiaoOut] = []
    go_tay: bool = False
    cho_buoc_truoc: bool = False


class PgVatTuMoiOut(BaseModel):
    lsx_cong_doan_vat_tu_id: int
    hang_loai: str
    hang_id: int
    ten: str | None = None
    ma: str | None = None
    don_vi: str | None = None
    kho_rong: int = 0
    kho_dai: int = 0
    dinh_muc: float
    da_giao: float = 0
    goi_y: float = 0
    lsx_id: int | None = None
    #: Tồn khả dụng ở các kho người gọi được xem, cùng đơn vị + khổ của dòng; None = không xem được kho nào.
    ton: float | None = None


class GiayKhoOut(BaseModel):
    kho_rong: int
    kho_dai: int = 0
    #: None = người gọi không được xem số tồn.
    ton: float | None = None
    don_vi: str | None = None
    dung_de_xuat: bool = False


class GiayDeXuatOut(BaseModel):
    kho_rong: int
    kho_dai: int = 0
    so_to: float | None = None
    don_vi: str | None = None


class GiayGoiYOut(BaseModel):
    giay_id: int | None = None
    giay_ma: str | None = None
    giay_ten: str | None = None
    don_vi: str | None = None
    nguon: str | None = None
    de_xuat: GiayDeXuatOut | None = None
    kho: list[GiayKhoOut] = []
    ly_do: str | None = None


class PgMoiDongOut(BaseModel):
    don_dong_id: int
    viec_id: int
    ten_viec: str
    kieu: str
    lenh: list[ThongTinLenhOut] = []
    sl_dat: float
    don_vi: str | None = None
    da_giao: float = 0
    ban_thanh_pham: PgBanThanhPhamOut | None = None
    vat_tu: list[PgVatTuMoiOut] = []
    giay: GiayGoiYOut | None = None


class PhieuGiaoMoiOut(BaseModel):
    don_id: int
    ma_don: str
    version: int
    nha_cung_cap_ten: str
    #: Xem được ít nhất một kho — tồn cộng các kho đó; không thì các ô `ton` là None.
    xem_ton: bool = False
    dong: list[PgMoiDongOut] = []


class PgVatTuIn(BaseModel):
    lsx_cong_doan_vat_tu_id: int
    so_luong: float = Field(ge=0)


class PgGiayIn(BaseModel):
    kho_rong: int = Field(gt=0)
    kho_dai: int = Field(default=0, ge=0)
    so_luong: float = Field(gt=0)


class PgDongIn(BaseModel):
    don_dong_id: int
    giao_ban_thanh_pham: bool = False
    sl_go: float | None = Field(default=None, ge=0)
    vat_tu: list[PgVatTuIn] = []
    giay: PgGiayIn | None = None


class PhieuGiaoIn(BaseModel):
    version: int
    ghi_chu: str | None = Field(default=None, max_length=1000)
    dong: list[PgDongIn] = Field(min_length=1)


class PgDongOut(BaseModel):
    id: int
    don_dong_id: int
    ten_viec: str = ""
    loai: str
    so_luong: float
    don_vi: str | None = None
    ten_hang: str | None = None
    kho_rong: int = 0
    kho_dai: int = 0
    tu_ban_giao: bool = False


class PgDeNghiOut(BaseModel):
    id: int
    ma: str
    trang_thai: str
    da_lap_phieu: bool = False


class PhieuGiaoOut(BaseModel):
    id: int
    ma: str
    version: int
    don_id: int
    ma_don: str = ""
    nha_cung_cap_id: int | None = None
    nha_cung_cap_ten: str = ""
    giao_luc: datetime
    nguoi_giao_ten: str | None = None
    ghi_chu: str | None = None
    huy_luc: datetime | None = None
    nguoi_huy_ten: str | None = None
    ly_do_huy: str | None = None
    created_at: datetime
    lenh: list[ThongTinLenhOut] = []
    de_nghi: list[PgDeNghiOut] = []
    dong: list[PgDongOut] = []


class PhieuGiaoListOut(BaseModel):
    items: list[PhieuGiaoOut]
    total: int
    page: int
    size: int
    facets: dict[str, int] = {}

# --- Phiếu nhận -------------------------------------------------------------------------------
class PnBuocSauOut(BaseModel):
    cong_viec_id: int
    ten: str = ""
    xac_nhan_duoc: bool = False


class PnChiaLenhOut(BaseModel):
    lsx_id: int
    lsx_ma: str = ""
    so_con: float
    he_so_nhan: float
    don_vi: str | None = None
    buoc_nhan: str | None = None


class PnMoiDongOut(BaseModel):
    don_dong_id: int
    viec_id: int
    ten_viec: str
    kieu: str
    lenh: list[ThongTinLenhOut] = []
    sl_dat: float
    don_vi: str | None = None
    don_gia: float = 0
    da_giao: float = 0
    don_vi_giao: str | None = None
    giao_quy_doi: float = 0
    da_dat: float = 0
    da_hong: float = 0
    con_ngoai: float | None = None
    canh_bao: str | None = None
    noi_ve_hop_le: list[str] = []
    buoc_sau: list[PnBuocSauOut] = []
    chia_theo_lenh: list[PnChiaLenhOut] = []
    ly_do_khong_nhan: str | None = None


class PhieuNhanMoiOut(BaseModel):
    don_id: int
    ma_don: str
    version: int
    nha_cung_cap_ten: str = ""
    chan_tu_nhan: str | None = None
    dong: list[PnMoiDongOut] = []


class PnDongIn(BaseModel):
    don_dong_id: int
    sl_dat: float = Field(default=0, ge=0)
    sl_hong: float = Field(default=0, ge=0)
    noi_ve: str = Field(max_length=8)
    dich_cong_viec_id: int | None = None
    ngay_khach_nhan: date | None = None


class PhieuNhanIn(BaseModel):
    version: int
    ghi_chu: str | None = Field(default=None, max_length=1000)
    dong: list[PnDongIn] = Field(min_length=1)


class PnDongOut(BaseModel):
    id: int
    don_dong_id: int
    ten_viec: str = ""
    kieu: str | None = None
    sl_dat: float
    sl_hong: float
    don_vi: str | None = None
    don_vi_ten: str = ""
    don_gia: float = 0
    thanh_tien: float = 0
    noi_ve: str
    dich_ten: str | None = None
    ngay_khach_nhan: date | None = None
    ban_giao_trang_thai: str | None = None


class PhieuNhanOut(BaseModel):
    id: int
    ma: str
    version: int
    don_id: int
    ma_don: str = ""
    nha_cung_cap_id: int | None = None
    nha_cung_cap_ten: str = ""
    nhan_luc: datetime
    nguoi_nhan_ten: str | None = None
    ghi_chu: str | None = None
    huy_luc: datetime | None = None
    nguoi_huy_ten: str | None = None
    ly_do_huy: str | None = None
    created_at: datetime
    lenh: list[ThongTinLenhOut] = []
    de_nghi: list[PgDeNghiOut] = []
    tam_tinh: float = 0
    phieu_chi_ma: str | None = None
    ly_do_khong_huy: str | None = None
    dong: list[PnDongOut] = []
    canh_bao: list[str] = []


class PhieuNhanListOut(BaseModel):
    items: list[PhieuNhanOut]
    total: int
    page: int
    size: int
    facets: dict[str, int] = {}


# --- Hoàn tất, hàng đang ở ngoài --------------------------------------------------------------
class TraVeIn(BaseModel):
    hang_loai: str = Field(max_length=8)
    hang_id: int
    kho_rong: int = 0
    kho_dai: int = 0
    so_luong: float = Field(ge=0)


class HoanTatIn(BaseModel):
    version: int
    tra_ve: list[TraVeIn] = []


class HoanTatOut(BaseModel):
    don_id: int
    don_dong_id: int
    hao_hut: float | None = None
    de_nghi_tra: str | None = None


class HangONgoaiOut(BaseModel):
    nha_cung_cap_id: int | None = None
    nha_cung_cap_ten: str = ""
    don_id: int
    ma_don: str
    don_dong_id: int
    ten_viec: str = ""
    lenh: list[ThongTinLenhOut] = []
    ngay_hen_ve: date | None = None
    loai: str
    ten_hang: str = ""
    kho: str | None = None
    giao: float = 0
    da_ve: float = 0
    con_ngoai: float = 0
    don_vi: str | None = None
    don_vi_ten: str = ""


class HangONgoaiListOut(BaseModel):
    items: list[HangONgoaiOut]
    total: int
    page: int
    size: int
    facets: dict[str, int] = {}

class ChoTraTienDongOut(BaseModel):
    ten_viec: str
    dat: float
    hong: float
    hut: float | None = None
    don_vi: str | None = None
    don_gia: float
    tam_tinh: int


class ChoTraTienOut(BaseModel):
    """Một phiếu nhận chờ trả tiền (spec §4.6)."""
    phieu_nhan_id: int
    ma: str
    nhan_luc: datetime
    don_id: int
    ma_don: str
    nha_cung_cap_id: int | None = None
    nha_cung_cap_ten: str
    nguoi_nhan_ten: str | None = None
    lenh: list[ThongTinLenhOut] = []
    dong: list[ChoTraTienDongOut] = []
    tam_tinh: int


class DemOut(BaseModel):
    so: int
