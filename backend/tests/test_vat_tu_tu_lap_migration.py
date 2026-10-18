"""Migration 0420 — cờ `tu_lap` trên lần đề nghị vật tư và `can_vat_tu` trên công việc.

Kiểm ở mức HÀM trên một SQLite rời: fixture `db` chỉ `create_all`, không chạy migration.
"""
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db_migrations import _migrate_vat_tu_tu_lap


def _db():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    db = sessionmaker(bind=eng)()
    db.execute(text("CREATE TABLE san_xuat_vat_tu_de_nghi (id INTEGER PRIMARY KEY)"))
    db.execute(text("CREATE TABLE san_xuat_cong_viec (id INTEGER PRIMARY KEY)"))
    db.execute(text("INSERT INTO san_xuat_vat_tu_de_nghi (id) VALUES (1)"))
    db.execute(text("INSERT INTO san_xuat_cong_viec (id) VALUES (1)"))
    db.commit()
    return db


def _cot(db, bang: str) -> set[str]:
    return {c["name"] for c in inspect(db.get_bind()).get_columns(bang)}


def test_them_hai_cot_mac_dinh_false_cho_dong_cu():
    db = _db()
    _migrate_vat_tu_tu_lap(db)
    assert "tu_lap" in _cot(db, "san_xuat_vat_tu_de_nghi")
    assert "can_vat_tu" in _cot(db, "san_xuat_cong_viec")
    assert db.execute(text("SELECT tu_lap FROM san_xuat_vat_tu_de_nghi")).scalar() in (0, False)
    assert db.execute(text("SELECT can_vat_tu FROM san_xuat_cong_viec")).scalar() in (0, False)


def test_chay_lai_khong_loi():
    db = _db()
    _migrate_vat_tu_tu_lap(db)
    _migrate_vat_tu_tu_lap(db)
    assert "tu_lap" in _cot(db, "san_xuat_vat_tu_de_nghi")
