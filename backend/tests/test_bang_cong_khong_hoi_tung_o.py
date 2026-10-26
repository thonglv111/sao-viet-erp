"""Bảng công / lưới phân ca / kỳ công không hỏi biên chế + ca nền theo TỪNG (người × ngày) (26/10/2026).

Đo trên DB đo tải (6.293 NV, tháng 10/2026): `/api/attendance/timesheet` ~13 s chỉ với 16 câu SQL —
toàn CPU Python: `trong_bien_che` 241 nghìn lượt, `base_shift_id_on` 220 nghìn lượt,
`is_working_day` 150 nghìn lượt. Guard: thêm người thì số lượt hỏi các hàm gốc chỉ tăng theo SỐ
NGƯỜI (vài lượt/người), không theo số người × số ngày.
"""
from __future__ import annotations

from datetime import date

import pytest

from app.db import SessionLocal
from app.models.attendance import WorkShift
from app.models.employee import Employee
from app.repositories.employee_repo import EmployeeRepository
from app.services import bien_che
from app.services.calendar_service import CalendarService


@pytest.fixture
def h(client, seed_credentials) -> dict[str, str]:
    tok = client.post("/api/auth/login", json=seed_credentials).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def _them_nv(n: int, tt: str) -> None:
    db = SessionLocal()
    try:
        ca = db.query(WorkShift).filter_by(name="Ca guard").first()
        if ca is None:
            ca = WorkShift(name="Ca guard", start_minute=480, end_minute=1020)
            db.add(ca)
            db.flush()
        for i in range(n):
            db.add(Employee(code=f"G{tt}{i:03d}", full_name=f"NV {tt}{i}", status="active",
                            hire_date=date(2020, 1, 1), default_shift_id=ca.id))
        db.commit()
    finally:
        db.close()


def _dem(monkeypatch):
    dem = {"bien_che": 0, "ca_nen": 0, "lich": 0}
    goc_gt = bien_che._gia_tri_tren_ngay
    goc_ca = EmployeeRepository.base_shift_id_on
    goc_lich = CalendarService.is_working_day

    def _gt(*a, **k):
        dem["bien_che"] += 1
        return goc_gt(*a, **k)

    def _ca(self, *a, **k):
        dem["ca_nen"] += 1
        return goc_ca(self, *a, **k)

    def _lich(self, *a, **k):
        dem["lich"] += 1
        return goc_lich(self, *a, **k)

    monkeypatch.setattr(bien_che, "_gia_tri_tren_ngay", _gt)
    monkeypatch.setattr(EmployeeRepository, "base_shift_id_on", _ca)
    monkeypatch.setattr(CalendarService, "is_working_day", _lich)
    return dem


@pytest.mark.parametrize("url", [
    "/api/attendance/timesheet?year=2026&month=9",
    "/api/attendance/shift-plan?year=2026&month=9",
    "/api/attendance/period?year=2026&month=9",
])
def test_so_luot_hoi_khong_tang_theo_nguoi_nhan_ngay(client, h, monkeypatch, url):
    _them_nv(2, "A")
    assert client.get(url, headers=h).status_code == 200
    dem = _dem(monkeypatch)
    assert client.get(url, headers=h).status_code == 200
    it = dict(dem)
    _them_nv(10, "B")
    for k in dem:
        dem[k] = 0
    r = client.get(url, headers=h)
    assert r.status_code == 200, r.text
    nhieu = dict(dem)
    print(f"\n{url}: {it} -> {nhieu}")
    # 10 người thêm × 30 ngày = 300 ô. Cho phép vài lượt/người, cấm một lượt/ô.
    for k in dem:
        assert nhieu[k] - it[k] <= 10 * 3, f"{k}: {it[k]} -> {nhieu[k]} (tăng theo người × ngày)"
