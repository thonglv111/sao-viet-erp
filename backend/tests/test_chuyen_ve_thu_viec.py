"""Chuyển về thử việc (24/10/2026): hồ sơ khai nhầm "Đang làm việc" lúc vào làm, hoặc HCNS cho thử
việc lại — trước đây bảng chuyển trạng thái chỉ đi một chiều, không có đường nào về Thử việc.
Bấm lùi ngày hiệu lực về ngày vào làm thì cả tháng đó máy đọc là thử việc (lương khoán, hệ số)."""
from __future__ import annotations

from datetime import date

from app.db import SessionLocal
from app.repositories.employee_repo import EmployeeRepository
from app.services.bien_che import trang_thai_tren_ngay
from tests.test_bien_che_dung_chung_08_09 import _chuyen
from tests.test_go_dinh_chi_08_09 import _tao, _trang_thai
from tests.test_luong_api import _admin_token, _h


def test_chuyen_ve_thu_viec_tu_ngay_vao_lam(client):
    h = _h(_admin_token(client))
    eid = _tao(client, h, name="Khai nhầm chính thức", status="active")      # vào làm 05/01
    r = _chuyen(client, h, eid, "probation_restart", "2026-01-05",
                probation_end_date="2026-12-31", note="khai nhầm lúc vào làm")
    assert r.status_code == 200, r.text
    assert _trang_thai(client, h, eid) == "probation"
    assert client.get(f"/api/employees/{eid}", headers=h).json()["probation_end_date"] == "2026-12-31"
    ev = client.get(f"/api/employees/{eid}/events", headers=h).json()["items"]
    moc = next(e for e in ev if e["event_type"] == "probation_restarted")
    assert moc["from_value"] == "active" and moc["to_value"] == "probation"
    # Cùng ngày với mốc vào làm: mốc sau thắng ⇒ ngày nào trong kỳ cũng là thử việc.
    db = SessionLocal()
    try:
        repo = EmployeeRepository(db)
        e = repo.get_by_id(eid)
        evs = repo.list_events(eid)
        assert trang_thai_tren_ngay(e, evs, date(2026, 1, 5))[0] == "probation"
        assert trang_thai_tren_ngay(e, evs, date(2026, 2, 1))[0] == "probation"
    finally:
        db.close()


def test_chuyen_ve_thu_viec_bat_buoc_ngay_het_thu_viec_khong_truoc_ngay_hieu_luc(client):
    h = _h(_admin_token(client))
    eid = _tao(client, h, name="Thiếu ngày hết thử việc", status="active")
    r = _chuyen(client, h, eid, "probation_restart", "2026-02-01")
    assert r.status_code == 400 and "Ngày hết thử việc" in r.text
    r = _chuyen(client, h, eid, "probation_restart", "2026-02-01", probation_end_date="2026-01-31")
    assert r.status_code == 400 and "Ngày hết thử việc" in r.text
    assert _trang_thai(client, h, eid) == "active"


def test_khong_chuyen_ve_thu_viec_khi_dang_thu_viec(client):
    h = _h(_admin_token(client))
    eid = _tao(client, h, name="Đang thử việc sẵn", status="probation")
    r = _chuyen(client, h, eid, "probation_restart", "2026-02-01", probation_end_date="2026-12-31")
    assert r.status_code == 400
