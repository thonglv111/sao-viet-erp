"""Guard chống N+1 ở Lương (26/10/2026).

Đo bản sao trước khi sửa: `/api/luong/components` đếm "đã gán cho N nhân viên" và "đã có trong M kỳ
đã chốt" bằng HAI câu cho MỖI khoản (7 khoản ⇒ 14 câu); `/api/luong/table` và `/khoan-theo-to` đọc
`khoan.viec_phat_sinh` lười — mỗi cấu hình khoán một câu (7 câu).
"""
from __future__ import annotations

from contextlib import contextmanager

import pytest
from sqlalchemy import event

from app.db import SessionLocal, engine
from app.models.cong_doan import CongDoan, CongDoanKhoan, CongDoanKhoanPhatSinh
from app.models.employee import Employee
from app.models.payroll import (
    PERIOD_LOCKED,
    EmployeeSalaryComponent,
    PayrollComponent,
    PayrollLine,
    PayrollLineComponent,
    PayrollPeriod,
)
from app.repositories.khoan_ky_repo import KhoanKyRepository


@pytest.fixture
def h(client, seed_credentials) -> dict[str, str]:
    tok = client.post("/api/auth/login", json=seed_credentials).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


@contextmanager
def dem_sql():
    dem = {"n": 0}

    def _nghe(*_a, **_k):
        dem["n"] += 1

    event.listen(engine, "before_cursor_execute", _nghe)
    try:
        yield dem
    finally:
        event.remove(engine, "before_cursor_execute", _nghe)


def _dung_khoan(n: int, tt: str, ky_chot: PayrollPeriod) -> None:
    """Mỗi i: một khoản thu nhập gán cho (i % 3 + 1) nhân viên; khoản chẵn có trong kỳ đã chốt."""
    db = SessionLocal()
    try:
        ky = db.merge(ky_chot)
        for i in range(n):
            c = PayrollComponent(code=f"{tt}_{i}", name=f"Khoản {tt}{i}")
            db.add(c)
            db.flush()
            for j in range(i % 3 + 1):
                e = Employee(code=f"{tt}{i}_{j}", full_name=f"NV {tt}{i}_{j}")
                db.add(e)
                db.flush()
                db.add(EmployeeSalaryComponent(employee_id=e.id, component_id=c.id, amount=100))
                if i % 2 == 0 and j == 0:
                    ln = PayrollLine(period_id=ky.id, employee_id=e.id)
                    db.add(ln)
                    db.flush()
                    db.add(PayrollLineComponent(line_id=ln.id, component_id=c.id, code=c.code,
                                                name=c.name, kind=c.kind))
        db.commit()
    finally:
        db.close()


def _ky_chot() -> PayrollPeriod:
    db = SessionLocal()
    try:
        ky = PayrollPeriod(year=2026, month=9, status=PERIOD_LOCKED)
        db.add(ky)
        db.commit()
        db.refresh(ky)
        db.expunge(ky)
        return ky
    finally:
        db.close()


def test_danh_muc_khoan_khong_dem_tung_khoan(client, h):
    url = "/api/luong/components"
    ky = _ky_chot()
    _dung_khoan(2, "A", ky)
    client.get(url, headers=h)
    with dem_sql() as d:
        assert client.get(url, headers=h).status_code == 200
    it = d["n"]
    _dung_khoan(8, "B", ky)
    with dem_sql() as d:
        r = client.get(url, headers=h)
    nhieu = d["n"]
    assert r.status_code == 200, r.text

    theo_ma = {x["code"]: x for x in r.json()["items"]}
    for i in range(8):
        x = theo_ma[f"B_{i}"]
        assert x["employee_count"] == i % 3 + 1
        assert x["period_count"] == (1 if i % 2 == 0 else 0)

    print(f"\nSO CAU SQL components (it -> nhieu): {it} -> {nhieu}")
    assert nhieu <= it + 2, f"{url}: {it} -> {nhieu} câu khi tăng số khoản"


def test_khoan_theo_id_nap_san_viec_phat_sinh():
    """Vòng tính khoán đọc `khoan.viec_phat_sinh` cho từng lần ghi — phải đã nạp cùng mẻ."""
    db = SessionLocal()
    try:
        ids = set()
        for i in range(5):
            cd = CongDoan(ma=f"CDPS{i}", ten=f"CĐ {i}", nhom="finishing")
            db.add(cd)
            db.flush()
            k = CongDoanKhoan(cong_doan_id=cd.id, unit="to", unit_price=0)
            db.add(k)
            db.flush()
            db.add(CongDoanKhoanPhatSinh(cong_doan_khoan_id=k.id, ten=f"PS {i}", don_gia=10,
                                         don_vi="to"))
            ids.add(k.id)
        db.commit()
        db.expire_all()

        khoan = KhoanKyRepository(db).khoan_theo_id(ids)
        with dem_sql() as d:
            ten = sorted(v.ten for k in khoan.values() for v in k.viec_phat_sinh)
        assert ten == [f"PS {i}" for i in range(5)]
        assert d["n"] == 0, f"đọc việc phát sinh tốn {d['n']} câu"
    finally:
        db.close()
