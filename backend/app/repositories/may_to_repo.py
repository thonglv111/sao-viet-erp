"""Truy vấn của "máy thuộc tổ" (`may_to`, mg 0435) — luật nằm ở `services/may_to.py`."""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from ..models.cong_doan import CongDoanMay, CongDoanTo
from ..models.department import Department
from ..models.may_thiet_bi import MayThietBi, MayTo


class MayToRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def to_cua_may(self, may_ids: Iterable[int]) -> dict[int, list[int]]:
        ids = {int(x) for x in may_ids if x is not None}
        ra: dict[int, list[int]] = {}
        if not ids:
            return ra
        for may_id, dept in self.db.execute(
            select(MayTo.may_id, MayTo.department_id)
            .where(MayTo.may_id.in_(ids)).order_by(MayTo.may_id, MayTo.department_id)
        ):
            ra.setdefault(int(may_id), []).append(int(dept))
        return ra

    def ten_to(self, department_ids: Iterable[int]) -> dict[int, str]:
        ids = {int(x) for x in department_ids if x is not None}
        if not ids:
            return {}
        return {int(i): n for i, n in self.db.execute(
            select(Department.id, Department.name).where(Department.id.in_(ids)))}

    def may(self, may_ids: Iterable[int]) -> dict[int, MayThietBi]:
        ids = {int(x) for x in may_ids if x is not None}
        if not ids:
            return {}
        return {m.id: m for m in self.db.execute(
            select(MayThietBi).where(MayThietBi.id.in_(ids))).scalars()}

    def cap_thieu_dong(self, *, cong_doan_ids: Iterable[int] | None = None,
                       may_ids: Iterable[int] | None = None) -> list[tuple[int, int, str]]:
        """Cặp (công đoạn, máy, mã máy) mà máy thuộc một tổ công đoạn tick nhưng CHƯA có dòng
        `cong_doan_may`. Lọc theo công đoạn và/hoặc máy; cả hai None = toàn bộ."""
        co_dong = select(CongDoanMay.id).where(
            CongDoanMay.cong_doan_id == CongDoanTo.cong_doan_id,
            CongDoanMay.may_id == MayTo.may_id,
        ).exists()
        stmt = (
            select(CongDoanTo.cong_doan_id, MayTo.may_id, MayThietBi.ma)
            .join(MayTo, MayTo.department_id == CongDoanTo.department_id)
            .join(MayThietBi, MayThietBi.id == MayTo.may_id)
            .where(~co_dong)
            .distinct()
        )
        if cong_doan_ids is not None:
            stmt = stmt.where(CongDoanTo.cong_doan_id.in_([int(x) for x in cong_doan_ids]))
        if may_ids is not None:
            stmt = stmt.where(MayTo.may_id.in_([int(x) for x in may_ids]))
        return [(int(c), int(m), ma) for c, m, ma in self.db.execute(stmt)]

    def thu_tu_lon_nhat(self, cong_doan_ids: Iterable[int]) -> dict[int, int]:
        ids = {int(x) for x in cong_doan_ids}
        if not ids:
            return {}
        return {int(c): int(t) for c, t in self.db.execute(
            select(CongDoanMay.cong_doan_id, func.max(CongDoanMay.thu_tu))
            .where(and_(CongDoanMay.cong_doan_id.in_(ids)))
            .group_by(CongDoanMay.cong_doan_id))}

    def them_dong(self, cong_doan_id: int, may_id: int, thu_tu: int) -> None:
        self.db.add(CongDoanMay(cong_doan_id=cong_doan_id, may_id=may_id, thu_tu=thu_tu))
