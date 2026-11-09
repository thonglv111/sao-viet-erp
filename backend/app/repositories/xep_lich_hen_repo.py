"""Truy vấn bàn HẸN ĐẨY của Xếp lịch (08/11/2026, docs/design-go-toc-do-may-va-xep-lich.md).

Bàn có bốn tab: Kẹt, Chưa hẹn giờ, Đã hẹn, Đã đẩy. Đường đọc chính (`dong_nhe`) lấy đúng các cột
nhẹ cần để chia tab, đếm, lọc và sắp xếp cho MỌI lệnh còn chờ đẩy và lệnh đã đẩy trong khoảng
ngày, bằng hai câu SQL. Phần nặng (tên khách, đơn vị) chỉ nạp cho những dòng của trang đang xem.

Lúc đẩy của lệnh = `created_at` sớm nhất của gói ĐANG CHẠY có công việc của lệnh. Không có cột nối
thẳng gói với lệnh: công việc mang cả `goi_id` lẫn `lsx_id`.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..models.customer import Customer
from ..models.lsx import TT_DA_DONG, TT_DA_PHAT_HANH, Lsx, LsxCongDoan
from ..models.order import Order
from ..models.san_xuat import GOI_DANG_PHAT_HANH, SanXuatCongViec, SanXuatGoiPhatHanh
from ..models.user import User
from ..models.xep_lich_lenh import XepLichLenh


@dataclass
class DongNhe:
    """Một lệnh trên bàn, đủ để chia tab và sắp xếp. Giờ hẹn là giờ xưởng; lúc đẩy là UTC thật."""

    id: int
    ma: str
    is_rush: bool
    han_giao_khach: date | None
    trang_thai: str
    hen_luc: datetime | None
    ket_ly_do: str | None
    ket_luc: datetime | None
    nguoi_hen_id: int | None
    da_day_luc: datetime | None


def _cot_da_day():
    return (
        select(func.min(SanXuatGoiPhatHanh.created_at))
        .join(SanXuatCongViec, SanXuatCongViec.goi_id == SanXuatGoiPhatHanh.id)
        .where(SanXuatCongViec.lsx_id == Lsx.id,
               SanXuatGoiPhatHanh.trang_thai == GOI_DANG_PHAT_HANH)
        .correlate(Lsx)
        .scalar_subquery()
    )


def _dk_tim(tim: str | None) -> list:
    if not (tim or "").strip():
        return []
    mau = f"%{tim.strip()}%"
    return [or_(Lsx.ma.ilike(mau), Lsx.ten.ilike(mau))]


class XepLichHenRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def dong_nhe(self, *, cho_day: tuple[str, ...], tim: str | None,
                 day_tu: datetime, day_den: datetime) -> list[DongNhe]:
        """Mọi lệnh còn chờ đẩy (`cho_day`, kèm hàng hẹn nếu có) + lệnh đã đẩy có lúc đẩy trong
        `[day_tu, day_den)` (UTC thật). Chia tab là việc của service."""
        cot_day = _cot_da_day()
        ra: list[DongNhe] = []
        rows = self.db.execute(
            select(Lsx.id, Lsx.ma, Lsx.is_rush, Lsx.han_giao_khach, Lsx.trang_thai,
                   XepLichLenh.bat_dau_at, XepLichLenh.ket_ly_do, XepLichLenh.ket_luc,
                   XepLichLenh.nguoi_hen_id)
            .outerjoin(XepLichLenh, XepLichLenh.lsx_id == Lsx.id)
            .where(Lsx.trang_thai.in_(cho_day), *_dk_tim(tim))
        ).all()
        ra += [DongNhe(int(r[0]), r[1], bool(r[2]), r[3], r[4], r[5], r[6], r[7], r[8], None)
               for r in rows]
        rows = self.db.execute(
            select(Lsx.id, Lsx.ma, Lsx.is_rush, Lsx.han_giao_khach, Lsx.trang_thai,
                   XepLichLenh.bat_dau_at, cot_day)
            .outerjoin(XepLichLenh, XepLichLenh.lsx_id == Lsx.id)
            .where(Lsx.trang_thai.in_((TT_DA_PHAT_HANH, TT_DA_DONG)),
                   cot_day >= day_tu, cot_day < day_den, *_dk_tim(tim))
        ).all()
        ra += [DongNhe(int(r[0]), r[1], bool(r[2]), r[3], r[4], r[5], None, None, None, r[6])
               for r in rows]
        return ra

    def da_day_luc(self, lsx_id: int) -> datetime | None:
        return self.db.execute(select(_cot_da_day()).select_from(Lsx).where(Lsx.id == lsx_id)).scalar()

    def lenh_va_khach(self, lsx_ids: list[int]) -> dict[int, tuple[Lsx, str | None]]:
        if not lsx_ids:
            return {}
        rows = self.db.execute(
            select(Lsx, Customer.name)
            .outerjoin(Order, Order.id == Lsx.order_id)
            .outerjoin(Customer, Customer.id == Order.customer_id)
            .where(Lsx.id.in_(lsx_ids))
        ).all()
        return {l.id: (l, ten) for l, ten in rows}

    def ten_nguoi(self, user_ids) -> dict[int, str]:
        ids = sorted({int(i) for i in user_ids if i})
        if not ids:
            return {}
        return {i: (t or u or f"#{i}") for i, t, u in self.db.execute(
            select(User.id, User.name, User.username).where(User.id.in_(ids)))}

    def nguoi(self, user_id: int | None) -> User | None:
        return self.db.get(User, user_id) if user_id else None

    def hang_toi_gio(self, bay_gio: datetime, cho_day: tuple[str, ...]) -> list[int]:
        """`lsx_id` có hẹn đã tới giờ, chưa kẹt, lệnh còn chờ đẩy — giờ hẹn sớm nhất trước."""
        return [int(i) for i in self.db.execute(
            select(XepLichLenh.lsx_id)
            .join(Lsx, Lsx.id == XepLichLenh.lsx_id)
            .where(XepLichLenh.bat_dau_at <= bay_gio, XepLichLenh.ket_ly_do.is_(None),
                   Lsx.trang_thai.in_(cho_day))
            .order_by(XepLichLenh.bat_dau_at, XepLichLenh.lsx_id)
        ).scalars()]

    def khoa_hang(self, lsx_id: int) -> XepLichLenh | None:
        """Hàng hẹn của lệnh, KHOÁ DÒNG trên Postgres. Hai worker cùng quét thì worker sau bỏ qua
        dòng đang bị giữ (`skip_locked`) chứ không đứng chờ rồi đẩy lần hai."""
        q = select(XepLichLenh).where(XepLichLenh.lsx_id == lsx_id)
        if self.db.get_bind().dialect.name == "postgresql":
            q = q.with_for_update(skip_locked=True)
        return self.db.execute(q).scalar_one_or_none()

    def cong_doan(self, lsx_id: int) -> list[LsxCongDoan]:
        return list(self.db.execute(
            select(LsxCongDoan).where(LsxCongDoan.lsx_id == lsx_id)
            .order_by(LsxCongDoan.thu_tu, LsxCongDoan.id)
        ).scalars())

    def xoa_hen(self, lsx_ids) -> int:
        ids = [int(i) for i in lsx_ids if i]
        if not ids:
            return 0
        rows = list(self.db.execute(
            select(XepLichLenh).where(XepLichLenh.lsx_id.in_(ids))).scalars())
        for r in rows:
            self.db.delete(r)
        self.db.flush()
        return len(rows)
