"""Pydantic schemas — Công đoạn (danh mục)."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer

from .loc_danh_muc import DemDieuKien


class CongDoanVatTuIn(BaseModel):
    """MỘT món vật tư công đoạn tiêu thụ, kèm định mức của riêng nó (spec 18/09/2026 §3.1).

    ⚠️ ĐỔI HÌNH 18/09/2026 (mg `0316`): trước đây vật tư treo dưới từng ĐẦU VIỆC của công đoạn
    (`cong_doan_dau_viec_vat_tu`). Tầng đầu việc đã gỡ (mg `0320`) nên vật tư về thẳng CÔNG ĐOẠN:
    một công đoạn khai nhiều món, mỗi món một công thức định mức ra LƯỢNG theo ĐVT của món đó.
    Hai món cùng ĐVT vẫn ăn theo hai trục khác hẳn (mực theo số tờ, dung môi theo số màu) nên
    công thức phải nằm ở TỪNG DÒNG, không phải ở món hàng."""

    vat_tu_id: int
    # Ô "định mức" của dòng đã GỠ 01/10/2026: định mức nay do công thức của CHÍNH vật tư tính
    # (`vat_tu_in_an.cong_thuc_dinh_muc`). Cột DB `cong_doan_vat_tu.cong_thuc_luong` còn nhưng không đọc/ghi.


class CongDoanVatTuRow(CongDoanVatTuIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    # Chỉ trả ID, không trả mã/tên/đơn vị: form đã nạp sẵn danh mục Vật tư khác cho dropdown nên tự
    # tra được — trả kèm ở đây là N+1 query cho mọi công đoạn trong danh sách.



class CongDoanMayIn(BaseModel):
    may_id: int
    # Ra LƯỢNG theo đơn vị TỐC ĐỘ của máy (không ra giờ — engine vẫn chia tốc độ). Trống = lùi về
    # cầu quy đổi, đúng hành vi của ô "Cách đo lượng" cũ trên máy khi để trống.
    cong_thuc_gio: str | None = None
    # Ra TIỀN, GHI ĐÈ `cong_doan.cong_thuc_gia` khi phiếu tính giá có chọn đúng máy này.
    cong_thuc_gia: str | None = None


class CongDoanMayRow(CongDoanMayIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class GiaTheoToIn(BaseModel):
    """Một dòng bảng giá theo tổ (21/10/2026). Việc phát sinh không có giá cố định.

    `bac` = mã bậc giá (22/10/2026) — chỉ có khi công đoạn chia bậc; vắng thì không trả khoá này để
    dòng của công đoạn thường giữ nguyên hình dạng cũ."""
    department_id: int
    bac: str | None = Field(default=None, max_length=20)
    gia_co_dinh: float | None = None
    don_gia: float | None = None

    @model_serializer(mode="wrap")
    def _bo_bac_rong(self, handler):
        d = handler(self)
        if d.get("bac") is None:
            d.pop("bac", None)
        return d


class BacGiaIn(BaseModel):
    """Một bậc giá (22/10/2026): điều kiện theo số màu (= số kẽm một tay như Tính giá), màu pha, một tuỳ chọn khi ghi.
    `None` ở điều kiện nào = không xét điều kiện đó. Xem `viec_khoan.anh_bac`."""
    ma: str = Field(default="", max_length=20)
    ten: str = Field(default="", max_length=80)
    mau_tu: float | None = None
    mau_den: float | None = None
    pha: Literal["co", "khong"] | None = None
    tuy_chon_ma: str | None = Field(default=None, max_length=40)
    tuy_chon_co: Literal["co", "khong"] | None = None
    # Giá của bậc đã gồm mực UV (bậc Pantone UV) ⇒ chip `gia_gom_uv` = 1, công thức thôi nhân đôi.
    gom_uv: bool = False


class CongDoanKhoanPhatSinhIn(BaseModel):
    id: int | None = None
    ten: str = Field(default="", max_length=255)
    don_gia: float | None = None
    don_vi: str | None = Field(default=None, max_length=24)
    gia_theo_to: list[GiaTheoToIn] | None = None
    # "Cách tính giá" (24/10/2026) — công thức ra đơn giá; trống = dùng đơn giá.
    cong_thuc: str | None = None


class CongDoanKhoanPhatSinhRow(CongDoanKhoanPhatSinhIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class TuyChonKhoanIn(BaseModel):
    """Một tuỳ chọn khi ghi (Đợt 2, 21/10/2026): thợ tick (`co_khong` ⇒ 1/0) hoặc gõ số (`so`) ở
    từng lần ghi; `ma` là chip của ô Công thức khoán."""
    ma: str = Field(default="", max_length=40)
    ten: str = Field(default="", max_length=80)
    kieu: Literal["co_khong", "so"] = "co_khong"
    goi_y: str | None = Field(default=None, max_length=80)


class CongDoanKhoanIn(BaseModel):
    unit: str | None = Field(default=None, max_length=24)
    unit_price: float | None = None
    # Giá cố định CHUNG (Đợt 2) — bảng giá theo tổ trống thì mọi tổ dùng.
    gia_co_dinh: float | None = None
    cong_thuc_khoan: str | None = None
    gia_theo_to: list[GiaTheoToIn] | None = None
    tuy_chon: list[TuyChonKhoanIn] = Field(default_factory=list)
    bac_gia: list[BacGiaIn] | None = None
    viec_phat_sinh: list[CongDoanKhoanPhatSinhIn] = Field(default_factory=list)


class CongDoanKhoanRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    unit: str
    unit_price: float
    gia_co_dinh: float = 0.0
    cong_thuc_khoan: str | None = None
    gia_theo_to: list[GiaTheoToIn] | None = None
    tuy_chon: list[TuyChonKhoanIn] = Field(default_factory=list)
    bac_gia: list[BacGiaIn] | None = None
    viec_phat_sinh: list[CongDoanKhoanPhatSinhRow] = Field(default_factory=list)

    @field_validator("tuy_chon", mode="before")
    @classmethod
    def _tuy_chon_null(cls, v):
        return v or []


class CongDoanIn(BaseModel):
    ma: str = Field(min_length=1, max_length=30)
    ten: str = Field(min_length=1, max_length=150)
    ten_hien_thi: str | None = None
    # Đơn vị vào/ra trên dòng giấy (hệ số quy đổi lấy từ phiếu, không khai ở đây). None = bước
    # không chạm giấy. Cặp hợp lệ do `cong_doan_service` kiểm.
    don_vi_vao: str | None = None
    don_vi_ra: str | None = None
    # GỠ 18/09/2026 (mg `0324`): `cong_thuc_san_luong` + `don_vi_san_luong` — số của bước ngoài dòng
    # giấy nay do người lập lệnh tự khai ở bước.
    kieu_bu_hao: str = "khong"
    # Bảng bậc của CHÍNH công đoạn (22/09/2026 — module Bù hao độc lập đã gỡ, hết `bu_hao_id`).
    # Mỗi bậc `{sl_den, gia_tri, don_vi}`; luật khai do `cong_doan_service._kiem_bac_bu_hao` soi.
    bac_bu_hao: list[dict] | None = None
    so_to_bu_hao: int = Field(default=50, ge=0)
    nhom: str
    # Nhóm máy (tên ở danh mục `nhom_may`) làm được công đoạn này — chặn gán máy sai loại ở bài
    # ghép. None/[] = không ràng buộc.
    nhom_may_cho_phep: list[str] | None = None
    # Máy CỤ THỂ chạy được công đoạn, mỗi dòng mang công thức giờ + công thức giá của riêng nó
    # (06/09/2026). `nhom_may_cho_phep` ngay trên nay chỉ còn là BỘ LỌC để chọn máy trong drawer.
    may_lam_duoc: list[CongDoanMayIn] = Field(default_factory=list)
    # Tổ phụ trách — NHIỀU tổ (18/09/2026, mg `0312`), đúng thứ tự chọn: tổ đầu là mặc định của bước
    # lệnh. `None` = giữ nguyên danh sách đang lưu, `[]` = gỡ hết.
    department_ids: list[int] | None = None
    khoan_ghi_theo: str = "khong"
    allowed_defect_pct: float = Field(default=0, ge=0, le=1)
    allowed_defect_abs: float = Field(default=0, ge=0)
    che_do_tinh: str = "theo_san_luong"
    pricing_basis: str | None = None
    setup_cost: float = Field(default=0, ge=0)
    setup_time: float = Field(default=0, ge=0)
    # Năng suất mặc định lúc lên lệnh SX (output/giờ) — đơn vị theo đầu vào của bước, không lưu.
    nang_suat: float | None = Field(default=None, gt=0)
    run_rate: float | None = None
    rate_tiers: list | None = None
    size_tiers: list | None = None
    first_unit_floor: float | None = None
    min_charge: float | None = None
    requires_tooling: bool = False
    tooling_type: str | None = None
    spoilage_pct: float = Field(default=0, ge=0, le=100)
    inline_flag: bool = False
    ghi_chu: str | None = None
    cong_thuc_gia: str | None = None
    active: bool = True
    # Vật tư công đoạn tiêu thụ, đúng thứ tự chọn (§3.1) — `[]` = gỡ hết.
    vat_tus: list[CongDoanVatTuIn] = Field(default_factory=list)
    # Vắng = giữ nguyên khi cập nhật; null/khối rỗng = gỡ cấu hình; object đủ = thay cấu hình.
    khoan: CongDoanKhoanIn | None = None


class CongDoanRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    ma: str
    ten: str
    ten_hien_thi: str | None = None
    don_vi_vao: str | None = None
    don_vi_ra: str | None = None
    # GỠ 08/09/2026: `don_vi_vao_ten` / `don_vi_ra_ten`. Hai ô này lưu MÃ CHẶNG của dòng giấy
    # (`to_nguyen · to · con · tay · cai`), không phải mã đơn vị kho — nhãn của chúng là
    # `models/don_vi_do.TRAM_NHAN`, hằng trong code, không phải thứ tra ở danh mục. Lý do đầy đủ:
    # xem khối chú thích chỗ `cong_doan_service.gan_ten_don_vi` cũ.
    kieu_bu_hao: str = "khong"
    bac_bu_hao: list[dict] | None = None
    so_to_bu_hao: int = 50
    nhom: str
    nhom_may_cho_phep: list[str] | None = None
    department_ids: list[int] = Field(default_factory=list)
    khoan_ghi_theo: str = "khong"
    allowed_defect_pct: float = 0
    allowed_defect_abs: float = 0
    che_do_tinh: str
    pricing_basis: str | None = None
    setup_cost: float
    setup_time: float
    nang_suat: float | None = None
    run_rate: float | None = None
    rate_tiers: list | None = None
    size_tiers: list | None = None
    first_unit_floor: float | None = None
    min_charge: float | None = None
    requires_tooling: bool
    tooling_type: str | None = None
    spoilage_pct: float
    inline_flag: bool
    ghi_chu: str | None = None
    cong_thuc_gia: str | None = None
    active: bool
    vat_tus: list[CongDoanVatTuRow] = Field(default_factory=list)
    may_lam_duoc: list[CongDoanMayRow] = Field(default_factory=list)
    # Mọi dòng đã khai, kể cả dòng NẰM IM vì máy ra khỏi phạm vi tổ (mg `0435`) — form cần số của
    # chúng để tick lại tổ là hiện ngay công thức cũ, chưa cần lưu.
    may_khai: list[CongDoanMayRow] = Field(default_factory=list)
    khoan: CongDoanKhoanRow | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CongDoanListOut(BaseModel):
    items: list[CongDoanRow]
    total: int
    page: int
    size: int
    # Số công đoạn theo giai đoạn — nuôi số trên tab lọc (màn chỉ cầm 20 dòng, không tự đếm được).
    facets: dict[str, int] = {}
    # Giá trị + số đếm của từng điều kiện lọc (thanh lọc chung) — xem `schemas/loc_danh_muc`.
    dem: DemDieuKien = {}


class RefOption(BaseModel):
    """Một mục cho dropdown 'ref' của màn cấu hình (khớp {id, ma, ten})."""
    id: int
    ma: str
    ten: str


class RefOptionListOut(BaseModel):
    items: list[RefOption]
