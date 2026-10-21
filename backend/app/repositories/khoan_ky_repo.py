"""Truy vấn cho tiền khoán của kỳ lương (`services/khoan_ky.py`, 21/10/2026)."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from ..models.cong_doan import CongDoanKhoan
from ..models.department import Department
from ..models.employee import Employee
from ..models.lsx import Lsx
from ..models.payroll import KhoanChiTieuNgay, KhoanToTruong
from ..models.san_xuat import SanXuatCongViec
from ..models.san_xuat_san_luong import SanXuatBatch, SanXuatBatchNguoi, SanXuatBatchPhatSinh


class KhoanKyRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def lan_ghi_trong_khoang(self, tu: datetime, den: datetime) -> list[tuple[SanXuatBatch, SanXuatCongViec]]:
        """Lần ghi có cấu hình Khoán của công đoạn, `bat_dau` trong [tu, den) — nơi gọi tự lọc lại
        theo ngày giờ xưởng."""
        stmt = (
            select(SanXuatBatch, SanXuatCongViec)
            .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatBatch.cong_viec_id)
            .where(SanXuatBatch.bat_dau >= tu, SanXuatBatch.bat_dau < den,
                   SanXuatBatch.khoan_cong_doan_id.is_not(None))
            .order_by(SanXuatBatch.bat_dau, SanXuatBatch.id)
        )
        return [(b, cv) for b, cv in self.db.execute(stmt).all()]

    def lan_chay(self, den: datetime, khoan_ids: set[int], *, lsx_ids: set[int], bai_ids: set[int],
                 cv_ids: set[int]) -> list[tuple[SanXuatBatch, SanXuatCongViec]]:
        """Mọi lần ghi `bat_dau < den` của các cấu hình Khoán `khoan_ids` trên CÙNG lệnh / bài ghép /
        công việc với lần ghi của kỳ — kể cả kỳ trước — để đếm `so_lan_chay`. Một truy vấn."""
        if not khoan_ids:
            return []
        neo = [c for c in (
            SanXuatCongViec.lsx_id.in_(lsx_ids) if lsx_ids else None,
            SanXuatCongViec.bai_ghep_id.in_(bai_ids) if bai_ids else None,
            SanXuatCongViec.id.in_(cv_ids) if cv_ids else None,
        ) if c is not None]
        stmt = (
            select(SanXuatBatch, SanXuatCongViec)
            .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatBatch.cong_viec_id)
            .where(SanXuatBatch.bat_dau < den, SanXuatBatch.khoan_cong_doan_id.in_(khoan_ids),
                   or_(*neo))
        )
        return [(b, cv) for b, cv in self.db.execute(stmt).all()]

    def ten_nhan_vien(self, ids: set[int]) -> dict[int, str]:
        if not ids:
            return {}
        return {int(i): t for i, t in self.db.execute(
            select(Employee.id, Employee.full_name).where(Employee.id.in_(ids)))}

    def nguoi_theo_lan_ghi(self, batch_ids: list[int]) -> dict[int, list[SanXuatBatchNguoi]]:
        ra: dict[int, list[SanXuatBatchNguoi]] = {}
        if not batch_ids:
            return ra
        for r in self.db.scalars(select(SanXuatBatchNguoi)
                                 .where(SanXuatBatchNguoi.batch_id.in_(batch_ids))
                                 .order_by(SanXuatBatchNguoi.id)):
            ra.setdefault(int(r.batch_id), []).append(r)
        return ra

    def phat_sinh_theo_lan_ghi(self, batch_ids: list[int]) -> dict[int, list[SanXuatBatchPhatSinh]]:
        ra: dict[int, list[SanXuatBatchPhatSinh]] = {}
        if not batch_ids:
            return ra
        for r in self.db.scalars(select(SanXuatBatchPhatSinh)
                                 .where(SanXuatBatchPhatSinh.batch_id.in_(batch_ids))
                                 .order_by(SanXuatBatchPhatSinh.id)):
            ra.setdefault(int(r.batch_id), []).append(r)
        return ra

    def khoan_theo_id(self, ids: set[int]) -> dict[int, CongDoanKhoan]:
        if not ids:
            return {}
        rows = self.db.scalars(select(CongDoanKhoan)
                               .options(selectinload(CongDoanKhoan.cong_doan))
                               .where(CongDoanKhoan.id.in_(ids)))
        return {int(k.id): k for k in rows}

    def lenh_theo_id(self, ids: set[int]) -> dict[int, Lsx]:
        if not ids:
            return {}
        rows = self.db.scalars(select(Lsx).options(selectinload(Lsx.cong_doans))
                               .where(Lsx.id.in_(ids)))
        return {int(l.id): l for l in rows}

    def bai_ghep(self, bai_id: int):
        from ..models.bai_ghep import BaiGhep

        return self.db.get(BaiGhep, bai_id)

    def phong_ban(self) -> dict[int, Department]:
        return {int(d.id): d for d in self.db.scalars(select(Department))}

    def chi_tieu_ngay(self, den_ngay: date) -> dict[int, list[KhoanChiTieuNgay]]:
        """Mọi mốc chỉ tiêu ≤ `den_ngay`, theo tổ, tăng dần ngày áp dụng."""
        ra: dict[int, list[KhoanChiTieuNgay]] = {}
        for r in self.db.scalars(select(KhoanChiTieuNgay)
                                 .where(KhoanChiTieuNgay.ap_dung_tu <= den_ngay)
                                 .order_by(KhoanChiTieuNgay.ap_dung_tu)):
            ra.setdefault(int(r.department_id), []).append(r)
        return ra

    def to_truong(self, den_ngay: date) -> dict[int, KhoanToTruong]:
        """Mốc tổ trưởng HIỆU LỰC tại `den_ngay` của từng tổ."""
        ra: dict[int, KhoanToTruong] = {}
        for r in self.db.scalars(select(KhoanToTruong)
                                 .where(KhoanToTruong.ap_dung_tu <= den_ngay)
                                 .order_by(KhoanToTruong.ap_dung_tu)):
            ra[int(r.department_id)] = r
        return ra

    def nhan_vien_theo_tai_khoan(self, user_ids: set[int]) -> dict[int, int]:
        """{user_id → employee_id} — tổ trưởng khai bằng TÀI KHOẢN đứng đầu tổ."""
        if not user_ids:
            return {}
        return {int(u): int(e) for e, u in self.db.execute(
            select(Employee.id, Employee.user_id).where(Employee.user_id.in_(user_ids)))}
