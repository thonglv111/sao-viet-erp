"""Lượt xuất hàng của đơn thương mại — chỉ In Hà Phương (docs/design-hang-thuong-mai-ha-phuong.md §7).

Một lượt = một lần người bán bấm "Xuất hàng" ở đơn thương mại: sinh MỘT yêu cầu XUẤT kho
(`stock_requests.luot_xuat_tm_id` trỏ ngược về lượt). Kho không biết gì về bảng này, lập phiếu và ghi
sổ như mọi yêu cầu xuất. Móc sau ghi sổ (`services/thuong_mai/moc_kho.py`) chuyển lượt sang "đã xuất",
ghi SL thực xuất và giá vốn từ lô thực xuất. Kho huỷ yêu cầu khi chưa xuất gì ⇒ lượt "đã huỷ".
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base

LXTM_CHO_XUAT = "cho_xuat"
LXTM_DA_XUAT = "da_xuat"
LXTM_HUY = "huy"
LXTM_TRANG_THAI = (LXTM_CHO_XUAT, LXTM_DA_XUAT, LXTM_HUY)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class LuotXuatThuongMai(Base):
    __tablename__ = "luot_xuat_thuong_mai"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False)
    # Mã hiện cho người dùng: "<số đơn>-X<n>", n đếm theo đơn.
    ma: Mapped[str] = mapped_column(String(40), nullable=False)
    kho_id: Mapped[int] = mapped_column(Integer, ForeignKey("kho_hang.id"), index=True, nullable=False)
    # Yêu cầu XUẤT kho của lượt (soft ref, cùng khuôn `stock_requests.delivery_trip_id`).
    stock_request_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    trang_thai: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=LXTM_CHO_XUAT, default=LXTM_CHO_XUAT)
    nguoi_lap_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    ghi_chu: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
    xuat_luc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    dong: Mapped[list[LuotXuatThuongMaiDong]] = relationship(
        "LuotXuatThuongMaiDong", back_populates="luot", cascade="all, delete-orphan",
        order_by="LuotXuatThuongMaiDong.id")


class LuotXuatThuongMaiDong(Base):
    __tablename__ = "luot_xuat_thuong_mai_dong"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    luot_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("luot_xuat_thuong_mai.id", ondelete="CASCADE"), index=True, nullable=False)
    order_line_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("order_lines.id", ondelete="CASCADE"), index=True, nullable=False)
    # Dòng yêu cầu kho tương ứng (soft ref) — móc ghi sổ đọc SL thực xuất theo dòng này.
    stock_request_line_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    # SL xin xuất, theo ĐVT của dòng đơn. Số nguyên như dòng đơn.
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    # SL kho thực xuất (ĐVT dòng đơn) — điền lúc lượt sang "đã xuất".
    qty_thuc: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Giá vốn của phần này = Σ (SL gốc xuất từ lô × đơn giá nhập của lô). Tiền, gác ở router.
    gia_von: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    luot: Mapped[LuotXuatThuongMai] = relationship("LuotXuatThuongMai", back_populates="dong")
