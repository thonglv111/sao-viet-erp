"""Schema cho Thêm / Xoá / Import / Export hàng trên màn Tồn kho (`routers/kho_nhap_tay.py`)."""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field


class HangThemIn(BaseModel):
    """Form Thêm hàng — đúng các cột của file import. Ô số / ngày nhận cả chữ để kiểm chung một đường
    với file (câu lỗi giống hệt)."""

    ma: str | None = None
    dvt: str | None = None
    so_luong: float | str | None = None
    don_gia: float | str | None = None
    kho_rong: float | str | None = None
    kho_dai: float | str | None = None
    vi_tri: str | None = None
    hsd: date | str | None = None
    ngay_nhap: date | str | None = None
    ncc: str | None = Field(default=None, max_length=150)
    ghi_chu: str | None = Field(default=None, max_length=500)
    xem_truoc: bool = False


class DongXoaIn(BaseModel):
    hang_loai: str = Field(pattern="^(giay|vat_tu)$")
    hang_id: int = Field(gt=0)
    kho_rong: int = Field(default=0, ge=0)
    kho_dai: int = Field(default=0, ge=0)
    don_vi_goc: str = Field(default="", max_length=16)


class HangXoaIn(BaseModel):
    dong: list[DongXoaIn] = Field(min_length=1, max_length=500)


class HangXoaOut(BaseModel):
    so_lo: int


class LoiDongOut(BaseModel):
    sheet: str = ""
    dong: int
    cot: str
    ly_do: str


class ThayDoiOut(BaseModel):
    dong: int
    ma: str
    ten: str
    cot: str
    cu: str
    moi: str


class CanhBaoOut(BaseModel):
    dong: int
    noi_dung: str


class NhapTayOut(BaseModel):
    """Cùng hình dạng `ImportExcelOut` của danh mục (dialog nhập Excel dùng chung) + thay đổi / cảnh báo."""

    hop_le: bool
    tong_dong: int
    tao_moi: int
    cap_nhat: int
    khong_doi: int
    da_ghi: bool
    loi: list[LoiDongOut]
    thay_doi: list[ThayDoiOut] = []
    canh_bao: list[CanhBaoOut] = []
