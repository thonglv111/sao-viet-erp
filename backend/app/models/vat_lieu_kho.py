"""Danh mục Giấy & Vật tư (Cấu hình danh mục).

- `GiayNguyen`     — tờ giấy nguyên (khổ mua). Danh mục Chủng loại giấy đã gỡ (mg 0342): tên
                     giấy tự nói loại, không engine nào đọc nhãn phân loại đó.
- `GiayGiaVersion` — lịch sử giá của 1 Giấy. DI TÍCH: UI đã tắt (`hasVersions: false`) từ khi
                     đơn giá chuyển sang nhập per-phiếu; endpoint còn nhưng màn không gọi.
- `VatTuInAn`      — vật tư in ấn danh mục PHẲNG (mực/kẽm/hoá chất/màng/keo… chung 1 bảng, phân
                     biệt bằng TÊN): Mã · Tên · ĐVT · công thức · ghi chú. Không phân loại con, không tồn.

Danh mục CRUD thuần — chỉ khai CÔNG THỨC; đơn giá nhập ở phiếu tính giá (per-phiếu), engine
KHÔNG đọc `don_gia` tại danh mục.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint,
    false as sa_false,
    true as sa_true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base

# `THO` còn dùng cho `GiayNguyen.tho` (thớ của TỪNG loại giấy) — ĐỪNG gỡ theo.
THO = ("canh_dai", "canh_ngan")

# MẶT HÀNG GỐC nằm ở HAI bảng với hai dãy id riêng, nên mọi nơi trỏ tới nó (kho, NCC) phải mang
# CẶP `(hang_loai, hang_id)` chứ không mang mỗi id. Khoá cặp thay vì hai cột `giay_id`/`vat_tu_id`
# rời: tồn kho phải GỘP NHÓM theo mặt hàng (`GROUP BY hang_loai, hang_id`), mà hai cột nullable thì
# mọi truy vấn gộp đều phải COALESCE và unique constraint phải tách làm hai.
HANG_GIAY = "giay"
HANG_VAT_TU = "vat_tu"
HANG_LOAI = (HANG_GIAY, HANG_VAT_TU)
# GỠ 2026-08-08: `DON_VI_GIA_GIAY` / `DON_VI_GIA_VAT_TU` — hai danh sách đơn vị CỨNG. Đơn vị giờ
# lấy từ danh mục `don_vi_do` (nguồn duy nhất, dùng chung cho Kho · NCC · khoán · tính giá); thêm
# đơn vị là việc khai ở màn Đơn vị & quy đổi, không phải sửa code.


LOAI_GIAY = "giay"
LOAI_SONG = "song"
NHAN_LOAI_GIAY = {LOAI_GIAY: "Giấy", LOAI_SONG: "Sóng"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class GiayNguyen(Base):
    """Tờ giấy nguyên (khổ lớn để mua)."""

    __tablename__ = "giay_nguyen"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ma: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    ten: Mapped[str] = mapped_column(String(150), nullable=False)
    kho_dai: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)   # mm; 0 = cuộn/khổ mở
    kho_rong: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)  # mm; 0 = cuộn/khổ mở
    gsm: Mapped[int] = mapped_column(Integer, nullable=False)       # định lượng
    # LOẠI (mg 0426, 19/10/2026): `giay` (tờ để in) | `song` (tấm sóng để bồi). Một sản phẩm tính
    # giá / một lệnh có tối đa 1 mã mỗi loại; giấy chính lấy mã loại `giay` (ptg_giay_buoc).
    loai: Mapped[str] = mapped_column(String(8), nullable=False, server_default=LOAI_GIAY, default=LOAI_GIAY)
    caliper_micron: Mapped[int | None] = mapped_column(Integer, nullable=True)  # độ dày (spine/creep; ≠ gsm)
    tho: Mapped[str | None] = mapped_column(String(12), nullable=True)          # canh_dai|canh_ngan
    # ĐƠN VỊ GỐC của mặt hàng — mã trong `don_vi_do`, KHÔNG còn là enum cứng ở frontend. Tồn kho
    # cộng dồn theo đơn vị này; nhập bằng đơn vị nào cũng được rồi quy về đây (xem `quy_doi_service.
    # don_vi_dung_duoc`). NULL = chưa chọn: không mặc định "kg" nữa vì đoán sai một lần là sai
    # vĩnh viễn — màn danh mục hiện "Chưa chọn đơn vị" để người khai tự chọn.
    don_vi_gia: Mapped[str | None] = mapped_column(String(24), nullable=True)
    # ĐƠN VỊ THÊM (mg 0390, 10/10/2026) — mảng mã đơn vị mua/nhập được NGOÀI ĐVT chính, có thứ tự.
    # Mỗi đơn vị kéo cả nhóm quy đổi của nó (tờ ⇒ ram); hai đơn vị khai không cùng nhóm, không quy đổi
    # lẫn nhau (tờ và kg). Tồn tách theo đơn vị gốc. Đơn giá `don_gia` chỉ thuộc `don_vi_gia`.
    # Đọc qua `kho_giay.don_vi_khai`. NULL = chỉ ĐVT chính.
    don_vi_them: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    don_gia: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, server_default="0", default=0)
    gia_thi_truong: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)   # giá tham khảo thị trường
    kho_tinh_gia: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa_true(), default=True)  # khổ này dùng để tính giá?
    cong_thuc_gia: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Ô "Công thức tính định mức" (`cong_thuc_luong`, mg 0195) ĐÃ GỠ, mg `0348`: giấy đếm theo TỜ × KHỔ,
    # không còn ra kg bằng công thức.
    ghi_chu: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # NVL THAY THẾ (`thay_the_ids`, mg 0239) ĐÃ GỠ, mg `0405`: chỉ để tra cứu, không đường nào đọc.
    # Ảnh minh hoạ vật tư (1 ảnh). Lưu đường `/api/files/materials/…` (đọc qua router có đăng nhập);
    # trang QR công khai serve lại chính key này qua `/api/public/vat-lieu-anh` bằng token QR. NULL = chưa có ảnh.
    anh_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1", default=1)  # phiên bản giá hiện hành (mirror từ giay_gia_version)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa_true(), default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class GiayGiaVersion(Base):
    """Phiên bản giá giấy — ẢNH CHỤP toàn bản ghi Giấy tại 1 mốc hiệu lực (lịch sử giá).

    Mỗi lần "Thêm phiên bản" đẻ 1 row; `is_current` = mốc đang áp dụng; `giay_nguyen` mirror
    các trường của version is_current. `giay_id` soft int → `giay_nguyen` (no DB FK).
    """

    __tablename__ = "giay_gia_version"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    giay_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)  # → giay_nguyen.id
    version_no: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1", default=1)
    ngay_hieu_luc: Mapped[date | None] = mapped_column(Date, nullable=True)     # áp dụng từ ngày
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa_true(), default=True)
    # -- ảnh chụp toàn bản ghi tại mốc này --
    kho_dai: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    kho_rong: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    gsm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    caliper_micron: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tho: Mapped[str | None] = mapped_column(String(12), nullable=True)
    don_vi_gia: Mapped[str] = mapped_column(String(8), nullable=False, server_default="kg", default="kg")
    don_gia: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, server_default="0", default=0)
    gia_thi_truong: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    ghi_chu: Mapped[str | None] = mapped_column(String(500), nullable=True)     # lý do đổi (vd NCC tăng giá)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class VatTuInAn(Base):
    """Vật tư in ấn — danh mục PHẲNG (mực/kẽm/hoá chất/màng/keo… chung 1 bảng, phân biệt bằng TÊN).

    Đơn giản theo bảng xưởng: Mã · Tên · ĐVT · Giá · Ghi chú. Không phân loại, không tồn.
    """

    __tablename__ = "vat_tu_in_an"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ma: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    ten: Mapped[str] = mapped_column(String(150), nullable=False)
    # ĐƠN VỊ GỐC — mã trong `don_vi_do`. NULL = chưa chọn (xem ghi chú ở `GiayNguyen.don_vi_gia`).
    don_vi_gia: Mapped[str | None] = mapped_column(String(24), nullable=True)
    # ĐƠN VỊ THÊM (mg 0390) — như `GiayNguyen.don_vi_them`. Màn Thành phẩm (chung bảng) không khai.
    don_vi_them: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    # BỎ quy cách đóng gói (`don_vi_dong_goi` / `he_so_dong_goi`, mg 0170 → gỡ 10/08/2026): khai
    # quy đổi hai nơi (ở đây và ở danh mục Đơn vị & quy đổi) là bắt người dùng nhớ luật vô ích.
    # Cần "thùng keo 20 kg" thì khai thẳng một đơn vị như vậy trong danh mục Đơn vị & quy đổi.
    # Hai cột cũ để nguyên trong DB (không drop, dự án không có Alembic) nhưng không còn ai đọc.
    don_gia: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, server_default="0", default=0)
    cong_thuc_gia: Mapped[str | None] = mapped_column(Text, nullable=True)
    # CÔNG THỨC LƯỢNG (mg 0194) — "một lệnh cần bao nhiêu <đơn vị này>", biến lấy từ quy cách lệnh.
    # KHÁC `cong_thuc_gia` ngay trên: ô kia ra TIỀN cho phiếu tính giá, ô này ra LƯỢNG cho BOM ở
    # bước lệnh. Hai câu hỏi khác nhau nên hai ô, đừng gộp.
    #
    # Ô "Công thức tính lượng" (`cong_thuc_luong`) ĐÃ GỠ 06/09/2026, migration `0274`: định mức
    # khai theo TỪNG DÒNG vật tư của CÔNG ĐOẠN (`cong_doan_vat_tu.cong_thuc_luong`, mg `0316`;
    # trước 18/09/2026 dòng ấy treo dưới đầu việc của tổ) — mực ăn theo SỐ TỜ còn dung môi rửa
    # máy ăn theo SỐ MÀU, cùng ĐVT kg mà hai cách hoàn toàn khác.
    # CÔNG THỨC ĐỊNH MỨC (mg 0357, 01/10/2026) — "bước này tiêu hao bao nhiêu <ĐVT> vật tư này". Khác
    # `cong_thuc_gia` (ra TIỀN). Biến: bộ `LOAI_QUY_DOI` + chip riêng (`chips`). Cùng nghĩa với ô
    # `cong_thuc_luong` đã gỡ ở mg 0274, rồi từng nằm ở dòng công đoạn × vật tư
    # (`cong_doan_vat_tu.cong_thuc_luong`, nay ngưng đọc) — về lại vật tư theo yêu cầu 01/10/2026.
    cong_thuc_dinh_muc: Mapped[str | None] = mapped_column(Text, nullable=True)
    # CHIP RIÊNG do người dùng đặt tên cho vật tư này, dùng làm biến trong hai công thức trên.
    chips: Mapped[list["VatTuChip"]] = relationship(
        "VatTuChip", back_populates="vat_tu", order_by="VatTuChip.thu_tu",
        cascade="all, delete-orphan",
        # selectin: mọi nơi quét danh mục vật tư (tính giá, bung lệnh) đọc chip của MỌI món —
        # lazy-load là mỗi món một câu SQL.
        lazy="selectin",
    )
    ghi_chu: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # NVL THAY THẾ (`thay_the_ids`) ĐÃ GỠ, mg `0405` — xem `GiayNguyen`.

    # THÀNH PHẨM của một đơn hàng (mg 0203 · docs/prd-thanh-pham.md).
    #
    # Sản phẩm in là hàng ĐẶT RIÊNG — "Hộp thuốc 10 vỉ, in 2 màu, cán bóng" không có sẵn ở danh
    # mục nào. Nhưng kho chỉ xuất được thứ CÓ trong danh mục (luật 08/08/2026 bỏ ô tên tự do),
    # nên lúc CHỐT ĐƠN hệ tự khai mỗi dòng đơn thành một dòng ở đây.
    #
    # KHÁCH SỞ HỮU thành phẩm (11/10/2026, mg 0394): hàng in riêng cho khách nào là hàng của khách
    # đó — tồn của mã là tồn của khách, đơn nào của khách cũng giao được. Danh tính do người lập
    # phiếu CHỌN ở ô Sản phẩm tái bản (lọc theo khách), không đoán bằng tên: hai khách cùng tên hàng
    # là hai mã. (21/08–11/10/2026 cột này chỉ là vết "khách đặt lần đầu", khoá gộp là tên.)
    customer_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)

    # CÔNG TẮC chia hai màn dùng chung bảng này: `true` ⇒ màn "Thành phẩm", `false` ⇒ "Vật tư
    # khác" (xem `_VatTuRepo` / `_ThanhPhamRepo`). Cột cờ RIÊNG chứ không suy từ cột khác nữa —
    # suy từ `customer_id` đã hỏng đúng lúc thành phẩm thôi thuộc về khách. Thêm ở mg 0228.
    la_thanh_pham: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=sa_false()
    )

    # Đơn ĐẦU TIÊN đặt món này — giữ để tra nguồn gốc, KHÔNG phải khoá định danh (mg 0203 từng
    # dùng làm khoá và sai: đặt lại là đẻ dòng thứ hai). Không cập nhật ở những lần đặt sau.
    #
    # Soft-ref, KHÔNG FK cứng: danh mục sống lâu hơn đơn — huỷ đơn KHÔNG xoá thành phẩm vì có thể
    # đã nhập kho, xoá là làm mồ côi lô tồn. Cùng khuôn `stock_requests.purchase_delivery_id`.
    order_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    order_line_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    # CẤU HÌNH TÁI BẢN của thành phẩm (mg 0394): list `ThanhPhanIn` (ruột + bìa… theo thứ tự dòng
    # đơn) chụp ở lần CHỐT ĐƠN gần nhất có phiếu tính giá. Ô "Sản phẩm tái bản" nạp lại từ đây.
    # NULL = mã chưa từng chốt qua phiếu tính giá (khai tay / nhập Excel) — vẫn chọn được, chỉ gắn mã.
    cau_hinh_tai_ban: Mapped[list | None] = mapped_column(JSON, nullable=True)
    tai_ban_luc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Ảnh minh hoạ vật tư (1 ảnh) — xem ghi chú `GiayNguyen.anh_url`.
    anh_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa_true(), default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class VatTuChip(Base):
    """Một CHIP riêng của một vật tư (vd Support: "Dài support", "Rộng support").

    `ma` là tên biến trong công thức — sinh từ tên LÚC TẠO và KHÔNG đổi khi đổi tên chip (công thức
    đang trỏ vào mã). Số cụ thể của chip nhập ở phiếu tính giá, theo từng bước (`phieu_buoc_vat_tu`)."""

    __tablename__ = "vat_tu_chip"
    __table_args__ = (UniqueConstraint("vat_tu_id", "ma", name="uq_vat_tu_chip_ma"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vat_tu_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("vat_tu_in_an.id", ondelete="CASCADE"), index=True, nullable=False
    )
    ma: Mapped[str] = mapped_column(String(40), nullable=False)
    ten: Mapped[str] = mapped_column(String(80), nullable=False)
    don_vi: Mapped[str | None] = mapped_column(String(24), nullable=True)
    thu_tu: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)

    vat_tu: Mapped["VatTuInAn"] = relationship("VatTuInAn", back_populates="chips")
