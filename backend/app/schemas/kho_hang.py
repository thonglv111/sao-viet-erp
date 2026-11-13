"""Pydantic schemas — Danh mục Kho hàng (khai báo kho)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..models.kho_hang import MA_KHO_THANH_PHAM

from .loc_danh_muc import DemDieuKien


class KhoHangIn(BaseModel):
    ma: str | None = Field(default=None, max_length=30)  # tạo mới: bỏ trống → backend tự sinh KHO-####
    ten: str = Field(min_length=1, max_length=150)
    vi_tri: str | None = None
    ghi_chu: str | None = None
    active: bool = True
    #: Kho hàng thương mại (chỉ In Hà Phương) — ô Kho xuất của đơn thương mại chỉ liệt kê kho có cờ này.
    la_kho_thuong_mai: bool | None = None


class KhoHangRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    ma: str
    ten: str
    vi_tri: str | None = None
    ghi_chu: str | None = None
    active: bool
    la_kho_thuong_mai: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None
    #: Kho cố định của hệ thống (Kho thành phẩm `KHO-TP`) — màn hiện ổ khoá, không nút xoá.
    co_dinh: bool = False

    @model_validator(mode="after")
    def _co_dinh(self) -> "KhoHangRow":
        self.co_dinh = (self.ma or "").upper() == MA_KHO_THANH_PHAM
        return self
    #: Số vị trí cất (kệ/ô) ĐANG DÙNG của kho — router gắn theo trang (`_dung_rows`), không phải cột.
    so_vi_tri: int = 0


class KhoHangListOut(BaseModel):
    items: list[KhoHangRow]
    total: int
    page: int
    size: int
    # Giá trị + số đếm của từng điều kiện lọc (thanh lọc chung) — xem `schemas/loc_danh_muc`.
    dem: DemDieuKien = {}


# ── Vị trí cất trong kho (bảng `kho_vi_tri`) ────────────────────────────────────────────────
class KhoViTriIn(BaseModel):
    ma: str = Field(min_length=1, max_length=60)   # tên/mã vị trí: "Kệ A - Ô 1"
    ghi_chu: str | None = Field(default=None, max_length=255)


class KhoViTriRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kho_id: int
    ma: str
    ghi_chu: str | None = None
    active: bool


class KhoViTriListOut(BaseModel):
    items: list[KhoViTriRow]
