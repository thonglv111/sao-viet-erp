"""Danh mục MỤC THU CHI (11/10/2026) — mỗi phiếu thu, phiếu chi mang một mục từ đây.

Mục là thứ báo cáo thu chi gom theo ("Điện nước", "Trả nhà cung cấp", "Bán phế liệu"…). KHÔNG có
khái niệm "thu chi khác": phiếu nào cũng chọn mục từ danh mục, phiếu chưa có mục hiện ở dòng
"Chưa phân loại" để kế toán chuyển vào mục. Mục KHÔNG có ô tài khoản kế toán — hệ không định khoản,
ô TK Nợ / TK Có trên phiếu vẫn là chữ gõ tay để in.

BẢY MỤC CỐ ĐỊNH (12/10/2026, mockup `docs/mockups/bao-cao-thu-chi-3-phuong-an.html` mục A danh
mục): phiếu SINH TỪ NGHIỆP VỤ (trả đơn mua, gia công ngoài, tạm ứng lương, trả lại tiền cho khách,
thu theo hoá đơn, cọc đơn, nhà cung cấp hoàn tiền) thuộc một mục cố định suy từ `source_type` —
KHÔNG có dòng trong bảng này (SEED_DEMO=false ⇒ không ghi gì), không ai sửa, không ngừng. Danh mục
và báo cáo vẫn hiện chúng dưới id ÂM (`MUC_CO_DINH`). Phiếu loại đó để `muc_thu_chi_id` trống.

Trả lại tiền cho khách (phiếu chi `customer_refund`) và nhà cung cấp hoàn tiền (phiếu thu
`purchase_refund`) lập từ ngăn Công nợ phải thu / phải trả (hoặc "Trả lại cọc" trên đơn đã huỷ),
nên máy biết khách / NCC nào. Mục kế toán tự khai chỉ dành cho phiếu LẬP TAY, không gắn ai.

Bảng MỚI → `create_all` tự dựng; ba cột trỏ vào đây ở `payment_vouchers`/`payment_receipts` do
mg `0395_muc_thu_chi` thêm cho DB cũ.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, true as sa_true
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base

LOAI_THU = "thu"
LOAI_CHI = "chi"
LOAI_MUC = (LOAI_THU, LOAI_CHI)

#: Chín mục cố định theo nguồn phiếu. `id` ÂM để không bao giờ trùng id dòng thật — ô lọc phiếu,
#: báo cáo và URL (`muc=-2`) dùng chung một kiểu số. `nguon` là đúng chuỗi `source_type` của phiếu.
MUC_CO_DINH: tuple[dict, ...] = (
    {"id": -1, "ma": "HT-01", "nguon": "purchase_request", "loai": LOAI_CHI,
     "ten": "Trả nhà cung cấp", "ghi_chu": "Phiếu chi trả đơn mua"},
    {"id": -2, "ma": "HT-02", "nguon": "gia_cong_ngoai", "loai": LOAI_CHI,
     "ten": "Thuê gia công ngoài", "ghi_chu": "Phiếu chi gia công ngoài"},
    {"id": -3, "ma": "HT-03", "nguon": "salary_advance", "loai": LOAI_CHI,
     "ten": "Tạm ứng lương", "ghi_chu": "Phiếu chi tạm ứng lương"},
    {"id": -7, "ma": "HT-07", "nguon": "customer_refund", "loai": LOAI_CHI,
     "ten": "Trả lại tiền cho khách", "ghi_chu": "Phiếu chi trả lại tiền cho khách"},
    {"id": -8, "ma": "HT-08", "nguon": "chi_chiet_khau", "loai": LOAI_CHI,
     "ten": "Chi chiết khấu trả khách", "ghi_chu": "Phiếu chi chiết khấu theo hóa đơn đã thu đủ"},
    {"id": -9, "ma": "HT-09", "nguon": "chi_ke_gia", "loai": LOAI_CHI,
     "ten": "Chi kê trả khách", "ghi_chu": "Phiếu chi kê theo hóa đơn đã thu đủ"},
    {"id": -4, "ma": "HT-04", "nguon": "sales_invoice", "loai": LOAI_THU,
     "ten": "Khách trả tiền hàng", "ghi_chu": "Phiếu thu theo hoá đơn"},
    {"id": -5, "ma": "HT-05", "nguon": "order_deposit", "loai": LOAI_THU,
     "ten": "Khách đặt cọc", "ghi_chu": "Phiếu thu cọc đơn hàng"},
    {"id": -6, "ma": "HT-06", "nguon": "purchase_refund", "loai": LOAI_THU,
     "ten": "Nhà cung cấp hoàn tiền", "ghi_chu": "Phiếu thu nhà cung cấp hoàn tiền"},
)
MUC_CO_DINH_THEO_ID: dict[int, dict] = {m["id"]: m for m in MUC_CO_DINH}
#: `(loại, source_type)` → mục cố định. Khoá theo cả loại vì phiếu thu và phiếu chi có thể trùng
#: chuỗi nguồn (`other`) — dù hiện không nguồn cố định nào trùng.
_THEO_NGUON: dict[tuple[str, str], dict] = {(m["loai"], m["nguon"]): m for m in MUC_CO_DINH}
NGUON_CO_DINH_CHI = tuple(m["nguon"] for m in MUC_CO_DINH if m["loai"] == LOAI_CHI)
NGUON_CO_DINH_THU = tuple(m["nguon"] for m in MUC_CO_DINH if m["loai"] == LOAI_THU)


def muc_co_dinh(loai: str, nguon: str | None) -> dict | None:
    """Mục cố định của phiếu `loai` có `source_type = nguon`, hoặc None (phiếu lập tay)."""
    return _THEO_NGUON.get((loai, nguon or ""))


def ten_muc_phieu(loai: str, nguon: str | None, muc) -> str | None:
    """Tên mục hiện trên phiếu: mục cố định của nguồn, hoặc mục đã chọn, hoặc None (chưa phân loại)."""
    cd = muc_co_dinh(loai, nguon)
    if cd is not None:
        return cd["ten"]
    return muc.ten if muc is not None else None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MucThuChi(Base):
    """1 dòng = 1 mục thu hoặc mục chi (vd "Điện nước" — Chi)."""

    __tablename__ = "muc_thu_chi"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ma: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    ten: Mapped[str] = mapped_column(String(150), nullable=False)
    loai: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    ghi_chu: Mapped[str | None] = mapped_column(String(500), nullable=True)

    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa_true(), default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
