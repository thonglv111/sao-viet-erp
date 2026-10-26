"""Body / response của `/api/gia-cong-ngoai` — spec 2026-09-26."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class MangDiIn(BaseModel):
    version: int
    sl_gui: float | None = Field(default=None, gt=0)


class ChotIn(BaseModel):
    version: int
    sl_cuoi: float = Field(gt=0)
    noi_ve: str = Field(pattern="^(xuong|kho|khach)$")
    dich_cong_viec_id: int | None = None
    # Giao thẳng: ngày khách nhận theo biên bản nhà gia công gửi về — trống = hôm nay.
    ngay_khach_nhan: date | None = None


class MoLaiIn(BaseModel):
    version: int


class TronGoiIn(BaseModel):
    nha_cung_cap_id: int = Field(gt=0)
    sl_dat: float = Field(gt=0)
    xuong_cap_giay: bool = False


class HuyTronGoiIn(BaseModel):
    version: int
    ly_do: str = Field(min_length=3, max_length=500)


class XuatGiayIn(BaseModel):
    """Khổ + số lượng người kế hoạch chọn. Mã giấy KHÔNG nhận từ client — máy chủ đọc theo lệnh.
    `kho_dai` = 0 là cuộn (theo rộng), khi đó `so_to` là số kg."""
    version: int
    kho_rong: int = Field(gt=0)
    kho_dai: int = Field(ge=0)
    so_to: float = Field(gt=0)


class PhieuKhoNganOut(BaseModel):
    id: int
    ma: str
    ngay: date
    trang_thai: str


class XuatGiayOut(BaseModel):
    id: int
    ma: str
    trang_thai: str
    kho_rong: int = 0
    kho_dai: int = 0
    so_to: float | None = None
    don_vi: str | None = None
    # Phiếu xuất kho lập theo đề nghị này (bỏ phiếu huỷ) — kho xuất nhiều đợt thì nhiều phiếu.
    phieu: list[PhieuKhoNganOut] = []


class CapGiayKhoOut(BaseModel):
    kho_rong: int
    kho_dai: int
    ton: float
    don_vi: str
    dung_de_xuat: bool


class CapGiayDeXuatOut(BaseModel):
    kho_rong: int
    kho_dai: int
    so_to: float | None = None
    don_vi: str


class CapGiayOut(BaseModel):
    """Phần "Chọn giấy" của lần trọn gói xưởng cấp giấy chưa đề nghị xuất (C1)."""
    giay_id: int | None = None
    giay_ma: str | None = None
    giay_ten: str | None = None
    don_vi: str
    nguon: str
    de_xuat: CapGiayDeXuatOut | None = None
    kho: list[CapGiayKhoOut] = []
    ly_do: str | None = None


class NhaGiaCongOut(BaseModel):
    id: int
    ten: str


class PhieuChiNganOut(BaseModel):
    id: int
    code: str


class ChangSauOut(BaseModel):
    id: int
    ten: str


class LichSuOut(BaseModel):
    luc: datetime | None = None
    ai: str = ""
    viec: str = ""
    chi_tiet: str = ""


class LenhBaiGhepOut(BaseModel):
    id: int
    ma: str
    so_con: float


class ChiaTheoLenhOut(BaseModel):
    lsx_id: int
    lsx_ma: str = ""
    so_con: float
    # Số chốt × hệ số này = số bước nhận nhận được (theo `don_vi`). Bước nhận ăn tờ ghép ⇒ 1.
    he_so_nhan: float | None = None
    don_vi: str | None = None
    buoc_nhan: str | None = None


class GiaCongNgoaiOut(BaseModel):
    id: int
    # Lần của LỆNH có `lsx_id`; lần của BƯỚC CHUNG bài ghép có `bai_ghep_id` (spec 2026-09-27).
    lsx_id: int | None = None
    lsx_ma: str
    bai_ghep_id: int | None = None
    bai_ghep_ma: str | None = None
    lenh: list[LenhBaiGhepOut] = []
    nhan_nguon: str = ""
    # Bảng chia số chốt về từng lệnh (hộp chốt hiện trước khi bấm) — rỗng khi không toả.
    chia_theo_lenh: list[ChiaTheoLenhOut] = []
    # Người xem không thao tác được: lần bài ghép trên màn lệnh, hoặc thiếu phạm vi một lệnh.
    chi_xem: bool = False
    kieu: str
    trang_thai: str
    nha_cung_cap_id: int
    nha_cung_cap_ten: str
    # Đọc sống từ danh mục NCC (lần chỉ chép tên) — gọi nhà gia công ngay trên khối.
    nha_cung_cap_sdt: str | None = None
    # Mốc giao việc: trọn gói = lúc đặt, một phần = lúc phát hành gom ra lần.
    tao_boi_ten: str | None = None
    tao_luc: datetime | None = None
    ten_viec: str
    don_vi: str | None = None
    sl_dat: float | None = None
    xuong_cap_giay: bool = False
    don_vi_gui: str | None = None
    sl_cho_mang_di: float = 0
    co_buoc_truoc: bool = False
    mang_di_boi_ten: str | None = None
    mang_di_luc: datetime | None = None
    sl_gui: float | None = None
    sl_goi_y_chot: float | None = None
    chot_boi_ten: str | None = None
    chot_luc: datetime | None = None
    sl_cuoi: float | None = None
    noi_ve: str | None = None
    noi_ve_hop_le: list[str] = []
    chang_sau: list[ChangSauOut] = []
    huy_boi_ten: str | None = None
    huy_luc: datetime | None = None
    ly_do_huy: str | None = None
    phieu_chi: PhieuChiNganOut | None = None
    # Máy chủ sẽ từ chối "Mở lại" vì lý do này (None = mở lại được / chưa chốt).
    ly_do_khong_mo_lai: str | None = None
    # Máy chủ sẽ từ chối "Nhận hàng về" vì lý do này (trọn gói xưởng cấp giấy mà kho chưa xuất).
    ly_do_khong_nhan_ve: str | None = None
    lich_su: list[LichSuOut] = []
    xuat_giay: XuatGiayOut | None = None
    cap_giay: CapGiayOut | None = None
    version: int
