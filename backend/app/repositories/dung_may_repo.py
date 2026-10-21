"""Truy vấn cho Báo dừng máy ở bàn tổ (`services/san_xuat/dung_may.py`, Đợt 2 — 21/10/2026)."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.department import Department
from ..models.employee import STATUS_RESIGNED, Employee
from ..models.ky_thuat_may import SuaChuaMay
from ..models.may_thiet_bi import MayThietBi
from ..models.payroll import KhoanDungMay


class DungMayRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def to(self, department_id: int) -> Department | None:
        return self.db.get(Department, department_id)

    def co_to_con(self, department_id: int) -> bool:
        """Tổ cha (có tổ con) chỉ là nhóm — không có bàn tổ, không báo dừng máy."""
        return self.db.scalar(select(Department.id).where(Department.parent_id == department_id)
                              .limit(1)) is not None

    def get(self, dung_may_id: int) -> KhoanDungMay | None:
        return self.db.get(KhoanDungMay, dung_may_id)

    def cua_to_ngay(self, department_id: int, ngay: date) -> KhoanDungMay | None:
        return self.db.scalar(select(KhoanDungMay).where(KhoanDungMay.department_id == department_id,
                                                         KhoanDungMay.ngay == ngay))

    def cua_to_trong_khoang(self, department_id: int, tu: date, den: date) -> list[KhoanDungMay]:
        return list(self.db.scalars(
            select(KhoanDungMay)
            .where(KhoanDungMay.department_id == department_id, KhoanDungMay.ngay >= tu,
                   KhoanDungMay.ngay <= den)
            .order_by(KhoanDungMay.ngay)))

    def nhan_vien_to(self, department_id: int) -> list[Employee]:
        """Người đang thuộc tổ (trừ đã nghỉ việc) — bộ tick sẵn của hộp Báo dừng máy."""
        return list(self.db.scalars(
            select(Employee)
            .where(Employee.department_id == department_id, Employee.status != STATUS_RESIGNED)
            .order_by(Employee.id)))

    def ten_nhan_vien(self, ids) -> dict[int, str]:
        ids = {int(i) for i in ids or ()}
        if not ids:
            return {}
        return {int(i): t for i, t in self.db.execute(
            select(Employee.id, Employee.full_name).where(Employee.id.in_(ids)))}

    def sua_chua(self, sua_chua_id: int) -> SuaChuaMay | None:
        return self.db.get(SuaChuaMay, sua_chua_id)

    def ma_sua_chua(self, ids) -> dict[int, str]:
        ids = {int(i) for i in ids or () if i}
        if not ids:
            return {}
        return {int(i): m for i, m in self.db.execute(
            select(SuaChuaMay.id, SuaChuaMay.ma).where(SuaChuaMay.id.in_(ids)))}

    def phieu_sua_trong_khoang(self, tu: datetime, den: datetime) -> list[tuple[SuaChuaMay, str | None]]:
        """Phiếu sửa máy báo trong [tu, den) kèm tên máy — máy chưa gắn tổ nên lọc theo thời gian."""
        stmt = (
            select(SuaChuaMay, MayThietBi.ten)
            .outerjoin(MayThietBi, MayThietBi.id == SuaChuaMay.may_id)
            .where(SuaChuaMay.thoi_diem >= tu, SuaChuaMay.thoi_diem < den)
            .order_by(SuaChuaMay.thoi_diem.desc(), SuaChuaMay.id.desc())
        )
        return [(sc, ten) for sc, ten in self.db.execute(stmt).all()]

    def add(self, r: KhoanDungMay) -> None:
        self.db.add(r)
        self.db.flush()

    def delete(self, r: KhoanDungMay) -> None:
        self.db.delete(r)
        self.db.flush()
