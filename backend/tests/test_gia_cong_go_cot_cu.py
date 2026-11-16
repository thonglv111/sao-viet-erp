"""Gỡ phần thuê ngoài CŨ (spec 2026-09-26 §10): 13 cột bước, sổ giao–nhận, ngày thuê ngoài."""
from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app.db import Base
from app.db_migrations import _migrate_go_cot_thue_ngoai_cu
from app.models.lsx import TT_DA_PHAT_HANH
from app.services.lsx_service import LsxConflict, LsxValidationError
from app.services.xep_lich.trai_lich import BuocVao, trai_lich
import app.models  # noqa: F401
from tests.gia_cong_fixtures import dung_lenh_gia_cong, lenh_chua_phat, ncc
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401
from tests.test_xep_lich_lenh_trai_lich import lich_mot_ca  # noqa: F401

COT_CU = ("sl_gui", "ngay_gui_dk", "van_chuyen_ngay", "gia_cong_ngay", "ngay_nhan_dk",
          "hao_hut_cho_phep", "yeu_cau_ky_thuat", "nguoi_giao_id", "giao_luc", "sl_giao_thuc",
          "nguoi_nhan_id", "nhan_luc", "sl_nhan_thuc")


def test_model_khong_con_cot_cu():
    cot = set(Base.metadata.tables["lsx_cong_doan"].columns.keys())
    assert not (set(COT_CU) & cot)
    # Nhà gia công rời bước (mg 0483) — chọn lúc lập đơn ở màn Thuê gia công.
    assert not ({"nha_cung_cap_id", "nha_cung_cap"} & cot)
    assert "don_gia_gia_cong" not in cot          # gỡ 07/10/2026 (mg 0374)


def test_migration_0340_go_cot_va_chay_lai_la_no_op():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as cn:
        cn.execute(text(
            "CREATE TABLE lsx_cong_doan (id INTEGER PRIMARY KEY, ten VARCHAR(150), "
            + ", ".join(f"{c} VARCHAR(20)" for c in COT_CU) + ")"))
    for _ in range(2):
        with Session(engine) as db:
            _migrate_go_cot_thue_ngoai_cu(db)
    cot = {c["name"] for c in inspect(engine).get_columns("lsx_cong_doan")}
    assert cot == {"id", "ten"}


def test_thue_ngoai_chiem_0_phut_va_ghi_chu(lich_mot_ca):
    buoc = [
        BuocVao(lsx_cong_doan_id=1, thu_tu=1, chay_phut=60),
        BuocVao(lsx_cong_doan_id=2, thu_tu=2, chay_phut=0, la_thue_ngoai=True),
        BuocVao(lsx_cong_doan_id=3, thu_tu=3, chay_phut=60),
    ]
    kq = trai_lich(datetime(2026, 9, 11, 8, 0), buoc, lich_mot_ca)
    assert kq.buoc[1].bat_dau == kq.buoc[1].ket_thuc
    assert kq.buoc[2].bat_dau == kq.buoc[1].ket_thuc
    assert "Không tính thời gian gia công ngoài." in kq.ghi_chu


def test_khong_doi_tay_sang_da_phat_hanh(sess, orders, lsx_svc, admin, customer):
    lsx = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    with pytest.raises(LsxValidationError):
        lsx_svc.set_trang_thai(lsx_id=lsx.id, trang_thai=TT_DA_PHAT_HANH, actor=admin)


def test_lenh_da_phat_hanh_khong_ha_tay(sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=[
        ("In", "may", None, 1000, "to"),
        ("Cán màng", "thue_ngoai", ncc(sess), 1000, "to"),
    ])
    with pytest.raises(LsxConflict):
        lsx_svc.set_trang_thai(lsx_id=lsx_id, trang_thai="nhap", actor=admin)


def test_cua_giao_nhan_cu_da_go(client):
    tok = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    h = {"Authorization": f"Bearer {tok.json()['access_token']}"}
    r = client.post("/api/lsx/1/buoc/1/giao-nhan", headers=h, json={"su_kien": "giao"})
    assert r.status_code in (404, 405)


def test_migration_0374_go_don_gia_gia_cong_va_chay_lai_la_no_op():
    from app.db_migrations import _migrate_go_don_gia_gia_cong
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as cn:
        cn.execute(text("CREATE TABLE gia_cong_ngoai (id INTEGER PRIMARY KEY, don_gia NUMERIC(18,2))"))
        cn.execute(text(
            "CREATE TABLE lsx_cong_doan (id INTEGER PRIMARY KEY, don_gia_gia_cong NUMERIC(18,2))"))
    for _ in range(2):
        with Session(engine) as db:
            _migrate_go_don_gia_gia_cong(db)
    insp = inspect(engine)
    assert {c["name"] for c in insp.get_columns("gia_cong_ngoai")} == {"id"}
    assert {c["name"] for c in insp.get_columns("lsx_cong_doan")} == {"id"}
