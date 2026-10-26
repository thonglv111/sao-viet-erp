"""Migration 0430 — công thức khoán Đợt 2 (21/10/2026).

Ba cột mới trên DB đang chạy (giá cố định chung, tuỳ chọn khi ghi của công đoạn, ảnh chụp tuỳ chọn
của lần ghi) + bảng `khoan_dung_may` (create_all tạo, một tổ một ngày một dòng)."""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.db_migrations import _migrate_khoan_dot_2
from app.models.payroll import LY_DO_DUNG_MAY, KhoanDungMay
from app.models.department import Department


def _db_cu():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as cn:
        cn.execute(text("CREATE TABLE cong_doan_khoan (id INTEGER PRIMARY KEY, unit_price NUMERIC)"))
        cn.execute(text("CREATE TABLE san_xuat_batch (id INTEGER PRIMARY KEY, tong NUMERIC)"))
        cn.execute(text("INSERT INTO cong_doan_khoan (unit_price) VALUES (120)"))
    return engine


def test_mg_0430_them_cot_tren_db_cu():
    engine = _db_cu()
    for _ in range(2):          # chạy lần hai không lỗi
        with Session(engine) as db:
            _migrate_khoan_dot_2(db)
    insp = inspect(engine)
    cot_cd = {c["name"] for c in insp.get_columns("cong_doan_khoan")}
    cot_b = {c["name"] for c in insp.get_columns("san_xuat_batch")}
    assert {"gia_co_dinh", "tuy_chon"} <= cot_cd
    assert "tuy_chon_khoan" in cot_b
    with engine.begin() as cn:
        assert float(cn.execute(text("SELECT gia_co_dinh FROM cong_doan_khoan")).scalar()) == 0


def test_khoan_dung_may_unique_to_ngay(client):
    assert LY_DO_DUNG_MAY == {"may_hu": "Máy hư", "het_hang": "Hết hàng"}
    db = SessionLocal()
    try:
        to = Department(name="Tổ bế thử", code="TBT")
        db.add(to)
        db.flush()
        db.add(KhoanDungMay(department_id=to.id, ngay=date(2026, 10, 5), ly_do="may_hu", nguoi_ids=[1]))
        db.flush()
        db.add(KhoanDungMay(department_id=to.id, ngay=date(2026, 10, 5), ly_do="het_hang", nguoi_ids=[2]))
        with pytest.raises(IntegrityError):
            db.flush()
    finally:
        db.rollback()
        db.close()


def test_mg_0449_go_tuy_chon_khuon_giu_tuy_chon_khac():
    """26/10/2026: trung_khuon / khuon_moi thành chip máy dò ⇒ gỡ khỏi tuỳ chọn tick, giữ phần còn lại."""
    import json

    from app.db_migrations import _migrate_khuon_thoi_la_tuy_chon

    engine = create_engine("sqlite+pysqlite:///:memory:")
    tc = [{"ma": "trung_khuon", "ten": "Trùng khuôn", "kieu": "co_khong"},
          {"ma": "so_lo", "ten": "Số lỗ đục", "kieu": "so"},
          {"ma": "khuon_moi", "ten": "Khuôn mới", "kieu": "co_khong"}]
    with engine.begin() as cn:
        cn.execute(text("CREATE TABLE cong_doan_khoan (id INTEGER PRIMARY KEY, tuy_chon JSON)"))
        cn.execute(text("INSERT INTO cong_doan_khoan (tuy_chon) VALUES (:a), (:b), (NULL)"),
                   {"a": json.dumps(tc), "b": json.dumps(tc[::2])})
    for _ in range(2):
        with Session(engine) as db:
            _migrate_khuon_thoi_la_tuy_chon(db)
    with engine.begin() as cn:
        hang = [r[0] for r in cn.execute(text("SELECT tuy_chon FROM cong_doan_khoan ORDER BY id"))]
    assert [json.loads(h) if h else None for h in hang] == [[tc[1]], None, None]
