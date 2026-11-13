"""Pydantic schemas — giao hàng kiểu In Hà Phương (docs/design-giao-hang-ha-phuong.md)."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from .loc_danh_muc import DemDieuKien


# ── Danh mục Xe giao hàng ───────────────────────────────────────────────────────
class XeGiaoHangIn(BaseModel):
    ma: str = Field(min_length=1, max_length=30)          # BIỂN SỐ
    ten: str = Field(min_length=1, max_length=150)
    nguoi_phu_trach_id: int | None = None
    ghi_chu: str | None = Field(default=None, max_length=500)
    active: bool = True


class XeGiaoHangRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    ma: str
    ten: str
    nguoi_phu_trach_id: int | None = None
    nguoi_phu_trach_ten: str | None = None
    ghi_chu: str | None = None
    active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None


class XeGiaoHangListOut(BaseModel):
    items: list[XeGiaoHangRow]
    total: int
    page: int
    size: int
    dem: DemDieuKien = {}


# ── Ô chọn ở Xuất hàng ──────────────────────────────────────────────────────────
class NguoiGiaoOut(BaseModel):
    """Nhân viên bộ phận giao hàng. `ma`/`ten` để ô chọn danh mục đọc được như mọi danh mục."""
    id: int
    ma: str
    ten: str
    bo_phan: str | None = None
    #: Xe người này phụ trách (đang dùng) — ô Xe tự điền.
    xe_id: int | None = None


class NguoiGiaoListOut(BaseModel):
    items: list[NguoiGiaoOut]


class DonViVcOut(BaseModel):
    id: int
    ten: str
    #: Sai = đã bỏ khỏi danh sách (chỉ có khi hỏi `ca_da_bo`, cho bộ lọc Đơn hàng bán).
    active: bool = True


class DonViVcListOut(BaseModel):
    items: list[DonViVcOut]
    #: Hãng phổ biến chưa có trong danh sách — chọn là thêm.
    goi_y: list[str] = []


class DonViVcIn(BaseModel):
    ten: str = Field(min_length=1, max_length=150)


class PhuongThucGiaoIn(BaseModel):
    """Cách giao của MỘT lần xuất. Bắt buộc chọn `loai`, không mặc định ngầm."""
    loai: str | None = None
    nguoi_giao_id: int | None = None
    xe_id: int | None = None
    don_vi_vc_id: int | None = None
    tien_cuoc: int | None = Field(default=None, ge=0)
    ma_van_don: str | None = Field(default=None, max_length=64)


class PhuongThucGiaoOut(BaseModel):
    id: int
    order_id: int
    stock_request_id: int | None = None
    luot_xuat_tm_id: int | None = None
    ma_lan_xuat: str | None = None
    loai: str
    nguoi_giao_id: int | None = None
    nguoi_giao_ten: str | None = None
    xe_id: int | None = None
    xe_ten: str | None = None
    xe_bien_so: str | None = None
    don_vi_vc_id: int | None = None
    don_vi_vc_ten: str | None = None
    #: Tiền: None khi người xem không có ô Xem của Phiếu chi.
    tien_cuoc: int | None = None
    ma_van_don: str | None = None
    nguoi_chon_ten: str | None = None
    created_at: datetime


class PhuongThucGiaoListOut(BaseModel):
    items: list[PhuongThucGiaoOut]


class PhuongThucMoiNhatOut(BaseModel):
    """Cột "Giao hàng" của danh sách Đơn hàng bán: lần xuất gần nhất của mỗi đơn."""
    items: dict[str, PhuongThucGiaoOut]


# ── Xuất hàng đơn sản xuất kèm phương thức ──────────────────────────────────────
class DongXuatHpIn(BaseModel):
    order_line_id: int
    qty: float = Field(gt=0)


class XuatHangHpIn(BaseModel):
    order_id: int
    ngay_can_giao: date
    lines: list[DongXuatHpIn]
    ghi_chu: str | None = Field(None, max_length=1000)
    dia_chi_id: int | None = None
    lien_he_id: int | None = None
    phuong_thuc: PhuongThucGiaoIn | None = None


class XuatHangHpOut(BaseModel):
    request_code: str
    phieu_kho: str | None = None
    phuong_thuc_id: int


# ── Cước chờ chi ở Phiếu chi ────────────────────────────────────────────────────
class CuocChoChiRow(BaseModel):
    phuong_thuc_giao_hp_id: int
    order_id: int
    order_no: str | None = None
    customer_name: str | None = None
    ma_lan_xuat: str | None = None
    don_vi_vc_id: int
    don_vi_vc_ten: str
    ma_van_don: str | None = None
    tien_cuoc: int
    da_chi: int
    con: int
    created_at: datetime


class CuocChoChiOut(BaseModel):
    items: list[CuocChoChiRow]


class DongChiCuocIn(BaseModel):
    phuong_thuc_giao_hp_id: int
    amount: int = Field(gt=0)


class PhieuChiCuocIn(BaseModel):
    """Một phiếu chi trả cước nhiều lần giao của CÙNG một đơn vị vận chuyển."""
    dong: list[DongChiCuocIn] = Field(min_length=1, max_length=50)
    voucher_type: str
    voucher_date: date
    muc_thu_chi_id: int | None = None
    content: str | None = Field(default=None, max_length=500)
    cash_recipient_name: str | None = Field(default=None, max_length=255)
    cash_recipient_address: str | None = Field(default=None, max_length=500)
    company_bank_account_id: int | None = None
    beneficiary_account_holder: str | None = Field(default=None, max_length=255)
    beneficiary_account_number: str | None = Field(default=None, max_length=64)
    beneficiary_bank_name: str | None = Field(default=None, max_length=255)
    beneficiary_bank_branch: str | None = Field(default=None, max_length=255)
    bank_fee_bearer: str | None = None
    note: str | None = None
