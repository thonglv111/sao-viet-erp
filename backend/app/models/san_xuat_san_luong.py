"""Thực hiện sản xuất — SẢN LƯỢNG · LOT ĐẦU VÀO · BÀN GIAO · XÁC NHẬN VẬT TƯ (Giai đoạn 3, §10–§11).

Sáu bảng GHI đứng SAU khung phiên-chạy (Giai đoạn 2) và neo lên snapshot công việc
(`san_xuat_cong_viec`). Chúng KHÔNG chép lại công việc — chỉ ghi kết quả thực tế:

  san_xuat_batch           — một BATCH sản lượng (§11.1): khoảng thời gian + tổng/tốt/hỏng + đơn vị
                             + nhóm lỗi khi có hỏng. Người làm lưu ở `san_xuat_batch_nguoi` (tổ
                             tick lúc ghi, 10/10/2026 — trước đó suy từ khoảng tham gia).
  san_xuat_batch_lot_vao   — LOT đầu vào đã dùng cho một batch (§10.3): mẻ đầu ra công đoạn trước
                             + số lượng → truy vết đầu vào → batch đầu ra.
  san_xuat_ban_giao        — BÀN GIAO sản lượng tốt sang công đoạn sau (§11.2): MỘT số lượng thống
                             nhất mỗi lần giao. Cùng tổ → tạo thẳng `confirmed`; khác tổ/LSX →
                             `proposed` rồi bên nhận `confirmed`. Số của lần giao đi theo mẻ: sửa
                             số mẻ thì số lần giao đổi theo (10/10/2026 — "điều chỉnh bàn giao" và
                             bảng `san_xuat_ban_giao_dieu_chinh` ĐÃ GỠ, mg 0385).
  san_xuat_ket_qua_nhanh  — SẢN LƯỢNG RIÊNG từng LSX tách ra từ một batch điểm-toả bài ghép (§
                             điểm toả): `tot` của batch quy ra đơn vị vào của bước riêng nhận
                             (× `ty_le_ghep` số con/tờ, hoặc × 1 khi bước nhận ăn tờ ghép).
                             CHỈ-THÊM, không sửa — batch mới thì đẻ dòng mới.

NEO snapshot: batch/bàn giao trỏ `san_xuat_cong_viec.id` (bản đóng băng, ổn định). Số dẫn xuất
(sản lượng còn lại, đầu vào khả dụng, % hoàn thành) TÍNH LÚC ĐỌC ở service — không cache cột.

Bảng MỚI → `create_all` tự dựng, KHÔNG migration. Boolean dùng `false()`/`true()` (bẫy Postgres DB
trắng). Mọi bảng mang `version` chống bấm trùng (trừ bảng LỊCH SỬ chỉ-thêm: lot đầu vào).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    JSON, Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint,
    false as sa_false,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base

# --- Trạng thái bàn giao (§18: proposed → confirmed) -----------------------------------------
# "adjusted" (điều chỉnh sau xác nhận) GỠ 10/10/2026: sửa số MẺ thì lần giao đổi theo; khác tổ thì
# `xac_nhan_luc` xoá về trống ⇒ bên nhận xác nhận lại (`ban_giao.cho_xac_nhan_lai`).
BG_DE_XUAT = "proposed"      # bên giao đã đề xuất, chờ bên nhận xác nhận (khác tổ/LSX)
BG_XAC_NHAN = "confirmed"    # hai bên đã thống nhất — số này là đầu vào công đoạn sau + cơ sở lương
TRANG_THAI_BAN_GIAO = (BG_DE_XUAT, BG_XAC_NHAN)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SanXuatBatch(Base):
    """Một BATCH sản lượng của một công việc (§11.1). Nhiều batch một phần trong cùng công đoạn.

    Ràng buộc `tong = tot + hong` do service kiểm (Numeric, không dựa CHECK để còn dung sai làm
    tròn). Hỏng ghi kèm `mo_ta_loi` tự do, tuỳ chọn — danh mục lý do/lỗi ĐÃ GỠ. Người làm lần ghi
    nằm ở `SanXuatBatchNguoi`."""

    __tablename__ = "san_xuat_batch"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cong_viec_id: Mapped[int] = mapped_column(
        ForeignKey("san_xuat_cong_viec.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bat_dau: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ket_thuc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    tong: Mapped[float] = mapped_column(Numeric(18, 3), nullable=False)
    tot: Mapped[float] = mapped_column(Numeric(18, 3), nullable=False)
    hong: Mapped[float] = mapped_column(Numeric(18, 3), nullable=False, server_default="0", default=0)
    don_vi: Mapped[str] = mapped_column(String(24), nullable=False)
    # CÔNG VIỆC KHOÁN thợ vừa làm (18/09/2026, mg `0318`) — soft-ref `piece_rates`. Chọn ở BÀN TỔ
    # lúc ghi mẻ, trong danh sách việc khoán của chính tổ mình: *"ghi mẻ đó nhưng cho công việc chứ
    # không phải công đoạn nữa"*. Thay hẳn ô "Đầu việc thợ làm" cũ ở bước lệnh (`khoan_json`, gỡ).
    #
    # NULLABLE ở DB nhưng BẮT BUỘC ở service cho mẻ MỚI: mẻ ghi trước bản này không có gì để
    # backfill, ép NOT NULL là migration chết ngay trên DB dev đang có mẻ. Mẻ cũ hiển thị
    # "— chưa khai việc khoán", không đoán. Cổng "Sẵn sàng lập kế hoạch" đã chặn bước giao cho tổ
    # chưa khai việc khoán nào, nên mẻ mới luôn có việc để chọn.
    piece_rate_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    # Nguồn KHOÁN mới của mẻ. Soft-ref để khi người quản trị gỡ cấu hình, ảnh chụp lịch sử vẫn
    # nguyên vẹn; `piece_rate_id` ở trên tiếp tục dành cho các mẻ legacy.
    khoan_cong_doan_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    # ẢNH CHỤP việc khoán lúc ghi mẻ. Chụp CẢ ĐƠN GIÁ (chốt 18/09/2026, đảo đề xuất ban đầu): mai
    # danh mục lên giá thì mẻ vẫn đọc lại được đúng bối cảnh của nó, và mẻ hiện băng "Danh mục đã
    # đổi" kèm nút đồng ý — hệ KHÔNG tự đổi số dưới chân mẻ đã ghi.
    #
    # Bàn tổ không có ô thành tiền: *"SẢN XUẤT CHỈ GHI NHẬN SỐ LƯỢNG."* Tiền tính từ ảnh chụp này
    # lúc tính lương kỳ (`services/khoan_ky.py`, 21/10/2026) — giá là giá CỦA TỔ ghi.
    ten_khoan_snapshot: Mapped[str | None] = mapped_column(String(150), nullable=True)
    don_vi_khoan_snapshot: Mapped[str | None] = mapped_column(String(24), nullable=True)
    don_gia_khoan_snapshot: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    # Giá cố định của TỔ lần ghi, chụp cùng đơn giá (21/10/2026). NULL ở cả hai = thiếu giá.
    gia_co_dinh_khoan_snapshot: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    # Ảnh chụp tuỳ chọn khi ghi (21/10/2026, mg 0430) `[{ma, ten, kieu, gia_tri}]` — mọi tuỳ chọn KHAI
    # ở công đoạn lúc ghi, không tick = 0. NULL = lần ghi trước đợt 2 (công thức coi mọi tuỳ chọn = 0).
    tuy_chon_khoan: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Ảnh chụp CÔNG THỨC khoán của công đoạn lúc ghi (21/10/2026, mg 0431) — chủ chốt công thức chụp
    # như giá: sửa công thức ở danh mục không đổi tiền lần đã ghi. "" = công thức bỏ trống lúc ghi
    # (tiền = giá cố định + SL × đơn giá). NULL = lần ghi trước mg 0431 ⇒ dùng công thức hiện tại.
    cong_thuc_khoan_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Ảnh chụp BẬC GIÁ lúc ghi (22/10/2026, mg 0433) `{ma, ten, gom_uv, so_mau, so_mau_pha}` — chỉ
    # công đoạn chia bậc (Bài in). `ma` None = quy cách lệnh không khớp bậc nào (thiếu giá). NULL =
    # công đoạn không chia bậc / lần ghi trước mg 0433.
    bac_khoan_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    mo_ta_loi: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ghi_chu: Mapped[str | None] = mapped_column(String(500), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class SanXuatBatchPhatSinh(Base):
    """VIỆC PHÁT SINH thợ đã làm trong một mẻ, kèm số lượng (18/09/2026, mg `0318`).

    Ví dụ của chủ xưởng: mẻ sản lượng 3.000 và "thay kẽm 2" — hai con số nằm CẠNH nhau, không cộng
    vào nhau. Việc phát sinh **không bao giờ cộng vào sản lượng**: không tiến độ, không KCS, không
    bàn giao, không nhập kho. *"Chỗ việc phát sinh như lên khuôn không cộng vào sản lượng."*

    Không có công thức: tiền của nó là số lượng × đơn giá, và phép nhân đó xảy ra ở màn kế toán, ở
    đây *"chỉ cần ghi nhận thay 2 bản kẽm thôi"*.
    """

    __tablename__ = "san_xuat_batch_phat_sinh"
    __table_args__ = (
        UniqueConstraint("batch_id", "phat_sinh_id", name="uq_batch_phat_sinh"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("san_xuat_batch.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Soft-ref `cong_viec_khoan_phat_sinh` — service chặn việc phát sinh không thuộc
    # `piece_rate_id` của chính mẻ.
    phat_sinh_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    so_luong: Mapped[float] = mapped_column(Numeric(14, 3), nullable=False)
    # Ảnh chụp — cùng lý do với ba ô snapshot của mẻ.
    ten_snapshot: Mapped[str | None] = mapped_column(String(150), nullable=True)
    don_vi_snapshot: Mapped[str | None] = mapped_column(String(24), nullable=True)
    don_gia_snapshot: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class SanXuatBatchNguoi(Base):
    """NGƯỜI LÀM một lần ghi sản lượng — tổ tick lúc ghi, lưu thành ảnh chụp (10/10/2026, mg 0386).

    Thay luật suy lúc đọc từ khoảng tham gia: lệnh phát hành là cả tổ được giao, nên giờ vào/ra không
    còn nói được ai đứng máy lần nào — chủ xưởng: *"chỉ untick thành viên bên tổ mình để xác nhận
    những ai tham gia"*. Người tổ khác sang giúp thì tổ thêm thẳng lúc ghi hoặc lúc sửa số, không ai
    phải duyệt (mg 0389 gỡ thỏa thuận hỗ trợ chéo) — dòng mang `la_ho_tro`.

    `department_id` là tổ GỐC của người LÚC GHI — người đổi tổ sau đó thì lần ghi cũ vẫn tính cho
    tổ cũ (mục "người của tổ đi làm ở tổ khác" ở tab Sản lượng đọc cột này)."""

    __tablename__ = "san_xuat_batch_nguoi"
    __table_args__ = (
        UniqueConstraint("batch_id", "employee_id", name="uq_batch_nguoi"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("san_xuat_batch.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    department_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    la_ho_tro: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa_false(), default=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class SanXuatBatchLotVao(Base):
    """Một LOT đầu vào đã dùng cho một batch (§10.3). Bảng CHỈ-THÊM (không version): dựng quan hệ
    truy vết mẻ công đoạn trước → batch đầu ra.

    Nguồn DUY NHẤT là mẻ đầu ra của công đoạn trước. Nguồn "lot BTP trong kho" (`nguon_loai` /
    `nguon_lot_id`) ĐÃ GỠ 17/09/2026 (mg 0308) — chưa từng có màn nào ghi."""

    __tablename__ = "san_xuat_batch_lot_vao"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("san_xuat_batch.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Batch đầu ra của công đoạn TRƯỚC. SET NULL giữ vết nếu batch nguồn bị gỡ.
    nguon_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("san_xuat_batch.id", ondelete="SET NULL"), nullable=True, index=True
    )
    so_luong: Mapped[float] = mapped_column(Numeric(18, 3), nullable=False)
    don_vi: Mapped[str] = mapped_column(String(24), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class SanXuatBanGiao(Base):
    """BÀN GIAO sản lượng tốt sang công đoạn sau (§11.2). MỘT số lượng thống nhất mỗi lần giao —
    KHÔNG lưu hai con số cạnh tranh.

    Cùng tổ (`cung_to=true`) → tạo thẳng `confirmed` (hai công đoạn liên tiếp cùng tổ tự chuyển).
    Khác tổ/LSX → `proposed`: bên giao sửa `so_luong` được khi còn proposed; bên nhận xác nhận đúng
    con số cuối. Đã xác nhận mà bên giao sửa số mẻ ⇒ số đổi theo, `xac_nhan_luc` về trống chờ bên
    nhận xác nhận lại (khác tổ)."""

    __tablename__ = "san_xuat_ban_giao"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nguon_cong_viec_id: Mapped[int] = mapped_column(
        ForeignKey("san_xuat_cong_viec.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Công đoạn sau nhận đầu vào — service BẮT BUỘC có (bước cuối lệnh không bàn giao; thành phẩm vào
    # kho qua KCS). Nullable chỉ để SET NULL khi công việc đích bị gỡ.
    dich_cong_viec_id: Mapped[int | None] = mapped_column(
        ForeignKey("san_xuat_cong_viec.id", ondelete="SET NULL"), nullable=True, index=True
    )
    cung_to: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa_false(), default=False
    )
    so_luong: Mapped[float] = mapped_column(Numeric(18, 3), nullable=False)
    don_vi: Mapped[str] = mapped_column(String(24), nullable=False)
    trang_thai: Mapped[str] = mapped_column(
        String(16), nullable=False, default=BG_DE_XUAT, index=True
    )
    de_xuat_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    de_xuat_luc: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    xac_nhan_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    xac_nhan_luc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class SanXuatBanGiaoBatch(Base):
    """MẺ nào đi theo LẦN BÀN GIAO nào (14/09/2026). Tổ ghi sản lượng theo mẻ thì giao cũng theo
    mẻ: form bàn giao liệt kê các mẻ CHƯA giao, tick mẻ nào thì mẻ đó gắn vào lần giao này.

    `batch_id` UNIQUE — một mẻ đi theo đúng MỘT lần giao, nhờ vậy "mẻ chưa giao" là mẻ không có
    dòng ở đây. KHÔNG lưu số lượng theo mẻ: `so_luong` của bàn giao là con số hai bên thống nhất
    (tổ được sửa giảm khi đếm thực tế lệch), chia ngược nó xuống từng mẻ là bịa ra một con số chưa
    ai đếm. Bàn giao toả tự động của bài ghép (`_toa_san_luong`) không đi qua bảng này."""

    __tablename__ = "san_xuat_ban_giao_batch"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ban_giao_id: Mapped[int] = mapped_column(
        ForeignKey("san_xuat_ban_giao.id", ondelete="CASCADE"), nullable=False, index=True
    )
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("san_xuat_batch.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class SanXuatKetQuaNhanh(Base):
    """Sản lượng RIÊNG từng LSX tách ra từ một batch của công việc ĐIỂM TOẢ bài ghép.

    Ghi khi `san_luong.tao_batch` phát hiện công việc vừa ghi có cạnh `san_xuat_phu_thuoc` toả đi
    (nguồn = chính công việc này) — mỗi cạnh một dòng: `so_luong` = `tot` của batch ×
    `san_luong.he_so_nhanh_toa` (số con/tờ; 1 khi bước nhận ăn tờ ghép). `ban_giao_id` neo bàn giao TỰ ĐỘNG-XÁC-NHẬN tương ứng (§11.2 biến
    thể: số suy MỘT CHIỀU từ `tot`, không thể vượt, nên bỏ qua vòng đề xuất/xác nhận hai bên).
    Bảng CHỈ-THÊM — dùng làm sổ cái quota để chặn LSX khác dùng nhầm phần đã toả (§10.3 biến thể)."""

    __tablename__ = "san_xuat_ket_qua_nhanh"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("san_xuat_batch.id", ondelete="CASCADE"), nullable=False, index=True
    )
    lsx_id: Mapped[int] = mapped_column(
        ForeignKey("lsx.id", ondelete="CASCADE"), nullable=False, index=True
    )
    so_luong: Mapped[float] = mapped_column(Numeric(18, 3), nullable=False)
    don_vi: Mapped[str] = mapped_column(String(24), nullable=False)
    ban_giao_id: Mapped[int | None] = mapped_column(
        ForeignKey("san_xuat_ban_giao.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
