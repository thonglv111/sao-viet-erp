"""THUÊ GIA CÔNG — spec `docs/superpowers/specs/2026-11-13-module-gia-cong-ngoai-design.md`.

Lệnh sản xuất chỉ gắn cờ "Thuê ngoài"; đặt, giao, nhận, trả tiền nằm ở module này (bám khung
Subcontracting của ERPNext, bỏ hạch toán):

  · `tgc_viec`      — việc gia công trong Hàng chờ: một dải bước thuê ngoài liền nhau của MỘT lệnh
                      (hoặc bước chung của bài ghép), hoặc cả lệnh trọn gói. Tự sinh lúc phát hành.
  · `tgc_don`       — Đơn gia công `GC..`: một nhà gia công, nhiều dòng (mỗi dòng một việc).
  · `tgc_phieu_giao`— Phiếu giao `GG..`: bán thành phẩm (nhận bàn giao của bước trước) + vật tư kho.
  · `tgc_phieu_nhan`— Phiếu nhận `GN..`: nhiều đợt, đạt / hỏng / nơi về; sinh tiền công tạm tính.
  · `tgc_phieu_chi_nhan` — phiếu chi trả gộp nhiều phiếu nhận cùng nhà gia công.

Trạng thái chứng từ DẪN XUẤT từ mốc + số liệu dòng, không lưu cột trạng thái. Người ghi là tham
chiếu MỀM tới `users` (FK tới `users` trong dự án bắt buộc CASCADE, mà xoá tài khoản không được kéo
mất chứng từ đã trả tiền).
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric,
    String, Text, false as sa_false, text, true as sa_true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base

KIEU_MOT_PHAN = "mot_phan"
KIEU_TRON_GOI = "tron_goi"
KIEU_VIEC = (KIEU_MOT_PHAN, KIEU_TRON_GOI)

LOAI_BAN_THANH_PHAM = "ban_thanh_pham"
LOAI_VAT_TU = "vat_tu"
LOAI_DONG_GIAO = (LOAI_BAN_THANH_PHAM, LOAI_VAT_TU)

NOI_VE_XUONG = "xuong"   # bàn giao sang bước sau của lệnh (dải còn chặng sau)
NOI_VE_KHO = "kho"       # đề nghị nhập kho thành phẩm (dải chứa bước cuối / trọn gói)
NOI_VE_KHACH = "khach"   # nhà gia công giao thẳng cho khách
NOI_VE = (NOI_VE_XUONG, NOI_VE_KHO, NOI_VE_KHACH)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TgcViec(Base):
    __tablename__ = "tgc_viec"
    __table_args__ = (
        CheckConstraint(
            "(lsx_id IS NULL AND bai_ghep_id IS NOT NULL) "
            "OR (lsx_id IS NOT NULL AND bai_ghep_id IS NULL)",
            name="ck_tgc_viec_mot_nguon",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lsx_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("lsx.id", ondelete="CASCADE"), index=True, nullable=True)
    # Bước CHUNG thuê ngoài của bài ghép. RESTRICT: bài còn việc thì không xoá được.
    bai_ghep_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("bai_ghep.id", ondelete="RESTRICT"), index=True, nullable=True)
    kieu: Mapped[str] = mapped_column(String(12), nullable=False)
    # "Cán màng" · "Bế + Dán" · "Gia công trọn gói".
    ten_viec: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # Số cần làm: số vào của bước đầu dải (một phần) / số lượng lệnh (trọn gói).
    sl_can: Mapped[float | None] = mapped_column(Numeric(18, 3), nullable=True)
    # Đơn vị NHẬN VỀ: đơn vị ra của bước cuối dải; trọn gói = đơn vị tính của lệnh.
    don_vi: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # Chỉ trọn gói: xưởng cấp giấy (giấy đi theo phiếu giao) hay nhà gia công tự lo.
    xuong_cap_giay: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa_false(), default=False)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class TgcNhaGiaCong(Base):
    """Một nhà gia công — danh sách RIÊNG, không dính danh mục Nhà cung cấp (16/11/2026, khuôn
    `don_vi_van_chuyen`): người lập đơn thêm, bỏ ngay ở ô Nhà gia công. Bỏ nhà đã có đơn = `active`
    sai (đơn cũ, phiếu chi, bộ lọc vẫn đọc tên); chưa có đơn thì xoá hẳn."""

    __tablename__ = "tgc_nha_gia_cong"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ten: Mapped[str] = mapped_column(String(255), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa_true(), default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class TgcDon(Base):
    __tablename__ = "tgc_don"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ma: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    # Nhà gia công (`tgc_nha_gia_cong`, mg 0484 — trước đó trỏ `suppliers`). Tên cột giữ nguyên.
    # Nhà đã có đơn chỉ tắt `active`, không xoá, nên FK thường là đủ.
    nha_cung_cap_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tgc_nha_gia_cong.id"), index=True, nullable=False)
    # ẢNH CHỤP tên lúc lập — đổi tên nhà sau không đổi đơn đã in / phiếu chi đã lập.
    nha_cung_cap_ten: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    ngay_dat: Mapped[date] = mapped_column(Date, nullable=False)
    # Chỉ để theo dõi / nhắc tổ sau, KHÔNG đưa vào Xếp lịch (spec §7).
    ngay_hen_ve: Mapped[date | None] = mapped_column(Date, nullable=True)
    ghi_chu: Mapped[str | None] = mapped_column(Text, nullable=True)
    # NULL = Nháp.
    dat_luc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dat_boi_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    huy_luc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    huy_boi_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ly_do_huy: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class TgcDonDong(Base):
    __tablename__ = "tgc_don_dong"
    __table_args__ = (
        # Một việc chỉ MỘT dòng đơn còn sống; đơn huỷ chép `huy_luc` xuống dòng để nhường chỗ.
        Index("uq_tgc_don_dong_viec_song", "viec_id", unique=True,
              postgresql_where=text("huy_luc IS NULL"), sqlite_where=text("huy_luc IS NULL")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    don_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tgc_don.id", ondelete="CASCADE"), index=True, nullable=False)
    viec_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tgc_viec.id", ondelete="RESTRICT"), index=True, nullable=False)
    sl_dat: Mapped[float] = mapped_column(Numeric(18, 3), nullable=False)
    # Đơn giá theo đơn vị nhận về (Q1). Phiếu nhận CHỤP lại lúc nhận.
    don_gia: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    don_vi: Mapped[str | None] = mapped_column(String(40), nullable=True)
    thu_tu: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    hoan_tat_luc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hoan_tat_boi_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Hao hụt = đã giao (quy đổi) − đạt − hỏng, CHỤP lúc Hoàn tất. Trọn gói: NULL.
    hao_hut: Mapped[float | None] = mapped_column(Numeric(18, 3), nullable=True)
    huy_luc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TgcPhieuGiao(Base):
    __tablename__ = "tgc_phieu_giao"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ma: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    don_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tgc_don.id", ondelete="RESTRICT"), index=True, nullable=False)
    giao_luc: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    nguoi_giao_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ghi_chu: Mapped[str | None] = mapped_column(Text, nullable=True)
    huy_luc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    huy_boi_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ly_do_huy: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class TgcPhieuGiaoDong(Base):
    __tablename__ = "tgc_phieu_giao_dong"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    phieu_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tgc_phieu_giao.id", ondelete="CASCADE"), index=True, nullable=False)
    don_dong_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tgc_don_dong.id", ondelete="RESTRICT"), index=True, nullable=False)
    loai: Mapped[str] = mapped_column(String(16), nullable=False)
    so_luong: Mapped[float] = mapped_column(Numeric(18, 3), nullable=False)
    don_vi: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # Bán thành phẩm: bàn giao của bước trước mà phiếu này nhận (mỗi bàn giao một dòng).
    ban_giao_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("san_xuat_ban_giao.id", ondelete="SET NULL"), index=True, nullable=True)
    # Vật tư: món kho (cặp `hang_loai, hang_id` như kho) + khổ (giấy).
    hang_loai: Mapped[str | None] = mapped_column(String(8), nullable=True)
    hang_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kho_rong: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    kho_dai: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    # Dòng định mức (xưởng cấp) của bước lệnh mà dòng này điền từ đó. Tham chiếu mềm: sửa lệnh xoá
    # dòng vật tư không được kéo mất phiếu giao đã lập.
    lsx_cong_doan_vat_tu_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class TgcPhieuNhan(Base):
    __tablename__ = "tgc_phieu_nhan"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ma: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    don_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tgc_don.id", ondelete="RESTRICT"), index=True, nullable=False)
    nhan_luc: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    nguoi_nhan_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ghi_chu: Mapped[str | None] = mapped_column(Text, nullable=True)
    huy_luc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    huy_boi_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ly_do_huy: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class TgcPhieuNhanDong(Base):
    __tablename__ = "tgc_phieu_nhan_dong"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    phieu_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tgc_phieu_nhan.id", ondelete="CASCADE"), index=True, nullable=False)
    don_dong_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tgc_don_dong.id", ondelete="RESTRICT"), index=True, nullable=False)
    sl_dat: Mapped[float] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    sl_hong: Mapped[float] = mapped_column(Numeric(18, 3), nullable=False, default=0)
    # Đơn giá CHỤP từ dòng đơn lúc nhận — tạm tính = sl_dat × don_gia (hỏng không tính tiền).
    don_gia: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    noi_ve: Mapped[str] = mapped_column(String(8), nullable=False)
    # Bước nhận hàng khi bước sau có nhiều nhánh.
    dich_cong_viec_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ngay_khach_nhan: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Mẻ ghi lên công việc cuối của việc — từ đó bàn giao / nhập kho / giao hàng chạy nguyên đường.
    batch_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("san_xuat_batch.id", ondelete="SET NULL"), index=True, nullable=True)


class TgcPhieuChiNhan(Base):
    """Phiếu chi trả bao nhiêu cho phiếu nhận nào (khuôn `phieu_chi_cuoc_giao`). Một phiếu nhận chỉ
    một phiếu chi còn hiệu lực — service kiểm dưới khoá dòng phiếu nhận."""

    __tablename__ = "tgc_phieu_chi_nhan"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    payment_voucher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("payment_vouchers.id", ondelete="CASCADE"), index=True, nullable=False)
    phieu_nhan_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tgc_phieu_nhan.id", ondelete="RESTRICT"), index=True, nullable=False)
    amount_vnd: Mapped[int] = mapped_column(BigInteger, nullable=False)

    voucher = relationship("PaymentVoucher")
