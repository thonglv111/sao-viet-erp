"""Giao hàng kiểu In Hà Phương — chỉ bản cài bật phân hệ `giao_hang_hp` (docs/design-giao-hang-ha-phuong.md).

Ba bảng MỚI, không đụng module Giao hàng cũ (`models/delivery.py`, `models/xe.py`, khoán km):

* `xe_giao_hang` — danh mục xe: biển số, tên xe, người phụ trách, ngưng dùng (§6). Bảng `xe` của module
  cũ gắn mức khoán km nên không dùng lại.
* `phuong_thuc_giao_hp` — mỗi lần xuất hàng một dòng: không giao / nội bộ / dịch vụ (§3, §8). Lần xuất
  nối bằng tham chiếu MỀM: đơn sản xuất trỏ `stock_request_id` (yêu cầu XUẤT kho), đơn thương mại trỏ
  `luot_xuat_tm_id`.
* `phieu_chi_cuoc_giao` — dòng của phiếu chi trả tiền cước (§4). Một phiếu gom nhiều lần giao của cùng
  đơn vị vận chuyển. Không trạng thái riêng: huỷ phiếu là lần giao quay lại hàng chờ chi, nên mọi chỗ
  cộng "đã chi" lọc theo trạng thái của PHIẾU (cùng khuôn `phieu_chi_ck_ke`).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, true as sa_true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base

PT_KHONG_GIAO = "khong_giao"
PT_NOI_BO = "noi_bo"
PT_DICH_VU = "dich_vu"
PT_LOAI = (PT_KHONG_GIAO, PT_NOI_BO, PT_DICH_VU)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class XeGiaoHang(Base):
    """Một xe giao hàng. `ma` = BIỂN SỐ, người khai gõ tay."""

    __tablename__ = "xe_giao_hang"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ma: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    ten: Mapped[str] = mapped_column(String(150), nullable=False)
    #: Nhân viên bộ phận giao hàng phụ trách xe. Chọn người giao ở Xuất hàng thì ô Xe tự điền xe này.
    nguoi_phu_trach_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True)
    ghi_chu: Mapped[str | None] = mapped_column(String(500), nullable=True)
    #: Tắt = ngưng dùng: không hiện ở ô chọn lần xuất mới, lần xuất cũ vẫn giữ tên xe.
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa_true(), default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)


class PhuongThucGiaoHp(Base):
    """Cách giao của MỘT lần xuất hàng. Người chọn do máy chủ ghi từ tài khoản."""

    __tablename__ = "phuong_thuc_giao_hp"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False)
    #: Đơn sản xuất: yêu cầu XUẤT kho của lần xuất (soft ref).
    stock_request_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    #: Đơn thương mại: lượt xuất (soft ref).
    luot_xuat_tm_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    #: Mã lần xuất hiện cho người dùng (mã yêu cầu kho hoặc mã lượt), chép lúc ghi.
    ma_lan_xuat: Mapped[str | None] = mapped_column(String(40), nullable=True)
    loai: Mapped[str] = mapped_column(String(16), nullable=False)
    nguoi_giao_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True)
    xe_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("xe_giao_hang.id", ondelete="SET NULL"), index=True, nullable=True)
    don_vi_vc_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), index=True, nullable=True)
    #: Tiền cước công ty chịu (đồng). Không cộng vào đơn hay hoá đơn của khách.
    tien_cuoc: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    ma_van_don: Mapped[str | None] = mapped_column(String(64), nullable=True)
    nguoi_chon_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)


class PhieuChiCuocGiao(Base):
    """Phiếu chi trả bao nhiêu cước cho lần giao dịch vụ nào."""

    __tablename__ = "phieu_chi_cuoc_giao"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    payment_voucher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("payment_vouchers.id", ondelete="CASCADE"), nullable=False, index=True)
    phuong_thuc_giao_hp_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("phuong_thuc_giao_hp.id", ondelete="RESTRICT"), nullable=False, index=True)
    amount_vnd: Mapped[int] = mapped_column(BigInteger, nullable=False)

    voucher = relationship("PaymentVoucher")
