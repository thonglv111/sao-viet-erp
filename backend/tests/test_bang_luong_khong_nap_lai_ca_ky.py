"""Mở Bảng lương không nạp lại cả bảng lương / ảnh chụp công nhiều lượt (26/10/2026).

Đo trên DB đo tải (6.293 dòng lương): `/api/luong/table` ~12,7 s. Trong đó cảnh báo chốt
(`ly_do_chua_chot_duoc`) nạp nguyên các dòng lương của kỳ BA lượt và kỳ trước một lượt, rồi giải
JSON cả ảnh chụp kỳ công chỉ để lấy tập NV — hàng chục nghìn object rộng ~80 cột chỉ để đọc 4 cột.
Guard: một lần mở bảng nạp object dòng lương đúng MỘT lượt (dựng bảng), không giải ảnh chụp công;
câu cảnh báo vẫn y như cũ.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.db import SessionLocal
from app.models.attendance import APERIOD_LOCKED, AttendancePeriod, AttendancePeriodLine
from app.models.employee import Employee
from app.models.payroll import PayrollLine, PayrollPeriod
from app.repositories.attendance_repo import AttendanceRepository
from app.repositories.payroll_repo import PayrollRepository


@pytest.fixture
def h(client, seed_credentials) -> dict[str, str]:
    tok = client.post("/api/auth/login", json=seed_credentials).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def _dung() -> None:
    db = SessionLocal()
    try:
        bay_gio = datetime.now(timezone.utc)
        a = Employee(code="BLA", full_name="Người Có Ảnh", status="active", hire_date=date(2020, 1, 1))
        b = Employee(code="BLB", full_name="Người Thiếu Ảnh", status="active", hire_date=date(2020, 1, 1))
        db.add_all([a, b])
        db.flush()
        k9 = PayrollPeriod(year=2026, month=9, generated_at=bay_gio)
        k10 = PayrollPeriod(year=2026, month=10, generated_at=bay_gio)
        db.add_all([k9, k10])
        db.flush()
        for k in (k9, k10):
            for e in (a, b):
                db.add(PayrollLine(period_id=k.id, employee_id=e.id))
        cong = AttendancePeriod(year=2026, month=10, status=APERIOD_LOCKED,
                                locked_at=bay_gio - timedelta(hours=1))
        db.add(cong)
        db.flush()
        db.add(AttendancePeriodLine(period_id=cong.id, employee_id=a.id))
        db.commit()
    finally:
        db.close()


def test_mo_bang_luong_nap_dong_luong_mot_luot(client, h, monkeypatch):
    _dung()
    dem = {"list_lines": 0, "anh_chup": 0}
    goc_ll = PayrollRepository.list_lines
    goc_ac = AttendanceRepository.period_metrics_map

    def _ll(self, *a, **k):
        dem["list_lines"] += 1
        return goc_ll(self, *a, **k)

    def _ac(self, *a, **k):
        dem["anh_chup"] += 1
        return goc_ac(self, *a, **k)

    monkeypatch.setattr(PayrollRepository, "list_lines", _ll)
    monkeypatch.setattr(AttendanceRepository, "period_metrics_map", _ac)
    r = client.get("/api/luong/table?year=2026&month=10", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    # Câu cảnh báo L7 vẫn đúng: B có dòng lương mà không có trong ảnh chụp công.
    assert "KHÔNG có trong ảnh chụp" in (body["chan_chot_ly_do"] or ""), body["chan_chot_ly_do"]
    assert "Người Thiếu Ảnh" in body["chan_chot_ly_do"]
    assert len(body["lines"]) == 2
    print("\n", dem)
    assert dem["list_lines"] <= 1, dem
    assert dem["anh_chup"] == 0, dem
