"""Truy vấn cho Báo dừng máy ở bàn tổ (`services/san_xuat/dung_may.py`, Đợt 2 — 21/10/2026)."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.department import Department
from ..models.employee import STATUS_RESIGNED, Employee
from ..models.ky_thuat_may import TT_SC_DANG_MO, TT_YC_DANG_MO, SuaChuaMay, YeuCauSuaChua
from ..models.lsx import Lsx
from ..models.may_thiet_bi import MayThietBi, MayTo
from ..models.san_xuat import CV_DANG_CHAY, CV_TAM_DUNG, SanXuatCongViec
from ..models.payroll import PERIOD_LOCKED, PERIOD_PAID, KhoanDungMay, PayrollPeriod


class DungMayRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def to(self, department_id: int) -> Department | None:
        return self.db.get(Department, department_id)

    def co_to_con(self, department_id: int) -> bool:
        """Tổ cha (có tổ con) chỉ là nhóm — không có bàn tổ, không báo dừng máy."""
        return self.db.scalar(select(Department.id).where(Department.parent_id == department_id)
                              .limit(1)) is not None

    def khoa_may(self, may_id: int) -> None:
        """Khoá dòng máy tới hết transaction: hai người cùng báo hư MỘT máy xếp hàng — lượt sau đọc
        lại thấy yêu cầu lượt trước vừa lập, không đẻ yêu cầu thứ hai (L-SX-22). Cùng khuôn
        `SanXuatSanLuongRepository.khoa_cong_viec`; SQLite (test) tự bỏ FOR UPDATE."""
        self.db.execute(select(MayThietBi.id).where(MayThietBi.id == may_id).with_for_update())

    def trang_thai_ky(self, year: int, month: int) -> str | None:
        return self.db.scalar(select(PayrollPeriod.status)
                              .where(PayrollPeriod.year == year, PayrollPeriod.month == month))

    def ky_da_chot(self) -> list[tuple[int, int]]:
        """(năm, tháng) mọi kỳ lương đã chốt hoặc đã chi."""
        return [(int(y), int(m)) for y, m in self.db.execute(
            select(PayrollPeriod.year, PayrollPeriod.month)
            .where(PayrollPeriod.status.in_((PERIOD_LOCKED, PERIOD_PAID)))
            .order_by(PayrollPeriod.year, PayrollPeriod.month))]

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

    def may_cua_to(self, department_id: int) -> set[int]:
        """Máy của tổ: máy mà các việc tổ đã nhận gắn (`san_xuat_cong_viec.may_id`, chép từ xếp lịch
        lúc phát hành) CỘNG máy khai "Tổ đứng máy" là tổ này (`may_thuoc_to`) — cùng tập máy hộp báo
        hư cho chọn (`_may_chon`), để phiếu sửa của máy tổ đứng gắn / sửa được (L-SX-10)."""
        tu_viec = {int(m) for m in self.db.scalars(
            select(SanXuatCongViec.may_id).distinct()
            .where(SanXuatCongViec.department_id == department_id, SanXuatCongViec.may_id.is_not(None)))}
        return tu_viec | set(self.may_thuoc_to(department_id))

    def phieu_sua_trong_khoang(self, tu: datetime, den: datetime,
                               may_ids: set[int]) -> list[tuple[SuaChuaMay, str | None]]:
        """Phiếu sửa máy báo trong [tu, den) của các máy `may_ids`, kèm tên máy."""
        if not may_ids:
            return []
        stmt = (
            select(SuaChuaMay, MayThietBi.ten)
            .outerjoin(MayThietBi, MayThietBi.id == SuaChuaMay.may_id)
            .where(SuaChuaMay.thoi_diem >= tu, SuaChuaMay.thoi_diem < den,
                   SuaChuaMay.may_id.in_(may_ids))
            .order_by(SuaChuaMay.thoi_diem.desc(), SuaChuaMay.id.desc())
        )
        return [(sc, ten) for sc, ten in self.db.execute(stmt).all()]

    # --- Máy hư (hộp Báo dừng máy gộp Báo sự cố, 23/10/2026) -------------------------------------
    def may_thuoc_to(self, department_id: int) -> list[int]:
        """Máy khai "Tổ đứng máy" là tổ này (`may_to`, mg 0435)."""
        return [int(m) for m in self.db.scalars(
            select(MayTo.may_id).where(MayTo.department_id == department_id).order_by(MayTo.may_id))]

    def viec_mo_co_may(self, department_id: int) -> list[tuple[SanXuatCongViec, str | None]]:
        """Việc đang chạy / tạm dừng của tổ có gắn máy, kèm mã lệnh — đang chạy đứng trước."""
        rows = self.db.execute(
            select(SanXuatCongViec, Lsx.ma)
            .outerjoin(Lsx, Lsx.id == SanXuatCongViec.lsx_id)
            .where(SanXuatCongViec.department_id == department_id,
                   SanXuatCongViec.may_id.is_not(None),
                   SanXuatCongViec.trang_thai.in_((CV_DANG_CHAY, CV_TAM_DUNG)))
            .order_by(SanXuatCongViec.id)).all()
        return sorted(((cv, ma) for cv, ma in rows), key=lambda x: x[0].trang_thai != CV_DANG_CHAY)

    def viec_mo_tren_may(self, may_ids) -> list[tuple[SanXuatCongViec, str | None, str | None]]:
        """Việc đang chạy / tạm dừng trên các máy `may_ids` của MỌI tổ, kèm mã lệnh + tên tổ — đang
        chạy đứng trước. Hộp báo hư cần biết máy đang chạy việc của tổ khác (L-SX-18)."""
        ids = {int(i) for i in may_ids or ()}
        if not ids:
            return []
        rows = self.db.execute(
            select(SanXuatCongViec, Lsx.ma, Department.name)
            .outerjoin(Lsx, Lsx.id == SanXuatCongViec.lsx_id)
            .outerjoin(Department, Department.id == SanXuatCongViec.department_id)
            .where(SanXuatCongViec.may_id.in_(ids),
                   SanXuatCongViec.trang_thai.in_((CV_DANG_CHAY, CV_TAM_DUNG)))
            .order_by(SanXuatCongViec.id)).all()
        return sorted(((cv, ma, ten) for cv, ma, ten in rows), key=lambda x: x[0].trang_thai != CV_DANG_CHAY)

    def may(self, may_ids) -> dict[int, MayThietBi]:
        ids = {int(i) for i in may_ids or ()}
        if not ids:
            return {}
        return {m.id: m for m in self.db.scalars(select(MayThietBi).where(MayThietBi.id.in_(ids)))}

    def yeu_cau_mo(self, may_ids) -> dict[int, YeuCauSuaChua]:
        """Yêu cầu "Báo máy hỏng" còn chờ tổ sửa chữa tiếp nhận, mới nhất mỗi máy."""
        ids = {int(i) for i in may_ids or ()}
        ra: dict[int, YeuCauSuaChua] = {}
        if ids:
            for yc in self.db.scalars(select(YeuCauSuaChua)
                                      .where(YeuCauSuaChua.may_id.in_(ids),
                                             YeuCauSuaChua.trang_thai.in_(TT_YC_DANG_MO))
                                      .order_by(YeuCauSuaChua.id.desc())):
                ra.setdefault(int(yc.may_id), yc)
        return ra

    def phieu_mo(self, may_ids) -> dict[int, SuaChuaMay]:
        """Phiếu sửa máy còn chờ sửa, mới nhất mỗi máy."""
        ids = {int(i) for i in may_ids or ()}
        ra: dict[int, SuaChuaMay] = {}
        if ids:
            for sc in self.db.scalars(select(SuaChuaMay)
                                      .where(SuaChuaMay.may_id.in_(ids),
                                             SuaChuaMay.trang_thai.in_(TT_SC_DANG_MO))
                                      .order_by(SuaChuaMay.id.desc())):
                ra.setdefault(int(sc.may_id), sc)
        return ra

    def yeu_cau(self, ids) -> dict[int, YeuCauSuaChua]:
        ids = {int(i) for i in ids or () if i}
        if not ids:
            return {}
        return {yc.id: yc for yc in self.db.scalars(select(YeuCauSuaChua).where(YeuCauSuaChua.id.in_(ids)))}

    def add(self, r: KhoanDungMay) -> None:
        self.db.add(r)
        self.db.flush()

    def delete(self, r: KhoanDungMay) -> None:
        self.db.delete(r)
        self.db.flush()
