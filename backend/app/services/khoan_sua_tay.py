"""Kế toán lương sửa tay khoán ở màn Lương → Khoán theo tổ (chủ chốt 23/10/2026).

Mockup đã duyệt: `docs/mockups/ke-toan-dieu-chinh-khoan-excel.html`; kế hoạch
`docs/superpowers/plans/2026-10-23-ke-toan-dieu-chinh-khoan.md`. Chỉ ba chỗ gõ được, mỗi dòng một ghi chú:

  - Tiền một lần ghi (`khoan_lan_ghi_tay`) — đè tiền máy, luật chia vẫn chạy.
  - Dòng tay (`khoan_dong_tay`) — dòng không gắn lệnh chèn vào sổ của một tổ.
  - Cộng thêm từng người (`khoan_cong_them`) — cộng thẳng vào lương ngoài phép so.

Số tiền đọc lại qua `KhoanKyService.tinh` — module này chỉ ghi. Xưởng (`san_xuat_batch`) không bị đụng.
Kỳ lương đã chốt / đã chi ⇒ `PayrollLocked`; người ngoài phạm vi nhân sự ⇒ `PayrollForbidden`.
"""
from __future__ import annotations

import calendar as _cal
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from ..models.department import Department
from ..models.employee import Employee
from ..models.payroll import PERIOD_DRAFT, KhoanCongThem, KhoanDongTay, KhoanLanGhiTay
from ..models.san_xuat_san_luong import SanXuatBatch
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.khoan_ky_repo import KhoanKyRepository
from .payroll_service import PayrollForbidden, PayrollLocked, PayrollNotFound, PayrollValidationError
from .san_xuat.nguoi_trong_me import ngay_cua_me

_CHUA = object()   # trường không gửi lên = giữ nguyên


def _chu(v) -> str | None:
    v = (v or "").strip()
    return v or None


def _tien(v, *, cho_am: bool) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise PayrollValidationError("Tiền phải là số.") from None
    if not cho_am and x < 0:
        raise PayrollValidationError("Tiền không được âm.")
    return round(x)


class KhoanSuaTayService:
    def __init__(self, db: Session, payroll_svc) -> None:
        self.db = db
        self.payroll = payroll_svc.payroll
        self.repo = KhoanKyRepository(db)
        self.audit = AuditLogRepository(db)

    # ------------------------------------------------------------------ gác chung
    def _ky_mo(self, year: int, month: int) -> None:
        ky = self.payroll.get_period_by_ym(year, month)
        if ky is not None and ky.status != PERIOD_DRAFT:
            raise PayrollLocked(f"Kỳ lương tháng {month:02d}/{year} đã chốt/đã chi — không sửa khoán được.")

    @staticmethod
    def _pham_vi(emps, duoc_xem: set[int] | None) -> None:
        if duoc_xem is not None and not set(emps) <= duoc_xem:
            raise PayrollForbidden("Có người ngoài phạm vi quản lý của bạn.")

    def _to(self, to_id: int) -> Department:
        to = self.db.get(Department, int(to_id))
        if to is None:
            raise PayrollNotFound("Không tìm thấy tổ.")
        return to

    def _ghi(self, actor, action: str, target: str, detail: str) -> None:
        self.audit.create(actor_user_id=getattr(actor, "id", None), action=action, target=target,
                          detail=detail, commit=False)

    @staticmethod
    def _dau(row, actor) -> None:
        row.sua_boi_id = getattr(actor, "id", None)
        row.sua_luc = datetime.now(timezone.utc)

    # ------------------------------------------------------------------ tiền một lần ghi
    def sua_lan_ghi(self, batch_id: int, *, actor, duoc_xem, tien=_CHUA, ghi_chu=_CHUA) -> None:
        """`tien` None = trả về số máy; `ghi_chu` rỗng = xoá ghi chú. Cả hai rỗng ⇒ bỏ dòng."""
        b = self.db.get(SanXuatBatch, int(batch_id))
        if b is None or b.khoan_cong_doan_id is None:
            raise PayrollNotFound("Không tìm thấy lần ghi có khoán.")
        d = ngay_cua_me(b.bat_dau)
        self._ky_mo(d.year, d.month)
        self._pham_vi({int(r.employee_id) for r in self.repo.nguoi_theo_lan_ghi([int(b.id)]).get(int(b.id), [])},
                      duoc_xem)
        row = self.repo.lan_ghi_tay_mot(int(b.id)) or KhoanLanGhiTay(batch_id=int(b.id))
        if tien is not _CHUA:
            row.tien = _tien(tien, cho_am=False)
        if ghi_chu is not _CHUA:
            row.ghi_chu = _chu(ghi_chu)
        if row.tien is None and not row.ghi_chu:
            if row.id is not None:
                self.db.delete(row)
        else:
            self._dau(row, actor)
            self.db.add(row)
        self._ghi(actor, "payroll_khoan_sua_lan_ghi", f"san_xuat_batch:{b.id}",
                  f"tien={'máy' if row.tien is None else round(row.tien)} ghi_chu={row.ghi_chu or ''}")
        self.db.commit()

    # ------------------------------------------------------------------ dòng tay
    def _kiem_dong(self, year: int, month: int, to_id: int, ngay: date, nguoi_ids, duoc_xem) -> list[int]:
        self._to(to_id)
        if not (date(year, month, 1) <= ngay <= date(year, month, _cal.monthrange(year, month)[1])):
            raise PayrollValidationError(f"Ngày của dòng tay phải nằm trong tháng {month:02d}/{year}.")
        ids = sorted({int(e) for e in nguoi_ids or []})
        if not ids:
            raise PayrollValidationError("Chọn ít nhất một người tham gia.")
        if len(self.repo.nhan_vien(set(ids))) != len(ids):
            raise PayrollValidationError("Có người tham gia không tồn tại.")
        self._pham_vi(ids, duoc_xem)
        return ids

    def them_dong_tay(self, *, year: int, month: int, to_id: int, ngay: date, noi_dung: str | None,
                      tien, nguoi_ids, ghi_chu: str | None, actor, duoc_xem) -> int:
        self._ky_mo(year, month)
        ids = self._kiem_dong(year, month, to_id, ngay, nguoi_ids, duoc_xem)
        row = KhoanDongTay(nam=year, thang=month, department_id=int(to_id), ngay=ngay,
                           noi_dung=(noi_dung or "").strip(), tien=_tien(tien, cho_am=False) or 0,
                           nguoi_ids=ids, ghi_chu=_chu(ghi_chu))
        self._dau(row, actor)
        self.db.add(row)
        self.db.flush()
        self._ghi(actor, "payroll_khoan_them_dong_tay", f"khoan_dong_tay:{row.id}",
                  f"to={to_id} ngay={ngay.isoformat()} tien={round(row.tien)} nguoi={len(ids)}")
        self.db.commit()
        return int(row.id)

    def _dong(self, dong_id: int) -> KhoanDongTay:
        row = self.db.get(KhoanDongTay, int(dong_id))
        if row is None:
            raise PayrollNotFound("Không tìm thấy dòng tay.")
        self._ky_mo(row.nam, row.thang)
        return row

    def sua_dong_tay(self, dong_id: int, *, actor, duoc_xem, ngay=_CHUA, noi_dung=_CHUA, tien=_CHUA,
                     nguoi_ids=_CHUA, ghi_chu=_CHUA) -> None:
        row = self._dong(dong_id)
        self._pham_vi(row.nguoi_ids or [], duoc_xem)
        ids = self._kiem_dong(row.nam, row.thang, row.department_id,
                              row.ngay if ngay is _CHUA else ngay,
                              row.nguoi_ids if nguoi_ids is _CHUA else nguoi_ids, duoc_xem)
        if ngay is not _CHUA:
            row.ngay = ngay
        if nguoi_ids is not _CHUA:
            row.nguoi_ids = ids
        if noi_dung is not _CHUA:
            row.noi_dung = (noi_dung or "").strip()
        if tien is not _CHUA:
            row.tien = _tien(tien, cho_am=False) or 0
        if ghi_chu is not _CHUA:
            row.ghi_chu = _chu(ghi_chu)
        self._dau(row, actor)
        self._ghi(actor, "payroll_khoan_sua_dong_tay", f"khoan_dong_tay:{row.id}",
                  f"ngay={row.ngay.isoformat()} tien={round(row.tien)} nguoi={len(ids)}")
        self.db.commit()

    def xoa_dong_tay(self, dong_id: int, *, actor, duoc_xem) -> None:
        row = self._dong(dong_id)
        self._pham_vi(row.nguoi_ids or [], duoc_xem)
        self._ghi(actor, "payroll_khoan_xoa_dong_tay", f"khoan_dong_tay:{row.id}",
                  f"to={row.department_id} ngay={row.ngay.isoformat()} tien={round(row.tien)} "
                  f"noi_dung={row.noi_dung}")
        self.db.delete(row)
        self.db.commit()

    # ------------------------------------------------------------------ cộng thêm từng người
    def sua_cong_them(self, *, year: int, month: int, to_id: int, emp_id: int, actor, duoc_xem,
                      tien=_CHUA, ghi_chu=_CHUA) -> None:
        """`tien` None hoặc 0 = bỏ số; cả số lẫn ghi chú rỗng ⇒ bỏ dòng."""
        self._ky_mo(year, month)
        self._to(to_id)
        if self.db.get(Employee, int(emp_id)) is None:
            raise PayrollNotFound("Không tìm thấy nhân viên.")
        self._pham_vi({int(emp_id)}, duoc_xem)
        row = (self.repo.cong_them_mot(year, month, int(to_id), int(emp_id))
               or KhoanCongThem(nam=year, thang=month, department_id=int(to_id), employee_id=int(emp_id)))
        if tien is not _CHUA:
            row.tien = _tien(tien, cho_am=True) or None
        if ghi_chu is not _CHUA:
            row.ghi_chu = _chu(ghi_chu)
        if row.tien is None and not row.ghi_chu:
            if row.id is not None:
                self.db.delete(row)
        else:
            self._dau(row, actor)
            self.db.add(row)
        self._ghi(actor, "payroll_khoan_cong_them", f"employee:{emp_id}",
                  f"ky={month:02d}/{year} to={to_id} tien={'' if row.tien is None else round(row.tien)} "
                  f"ghi_chu={row.ghi_chu or ''}")
        self.db.commit()
