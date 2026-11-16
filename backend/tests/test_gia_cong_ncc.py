"""Nhà gia công là DANH SÁCH RIÊNG `tgc_nha_gia_cong` (16/11/2026, mg 0484), thêm bỏ ngay ở ô Nhà gia công
của hộp Lập đơn như ô Đơn vị vận chuyển — không còn tích "Nhận gia công" trên nhà cung cấp."""
from __future__ import annotations

from datetime import date

from sqlalchemy import inspect, text

from app.db import SessionLocal
from app.db_migrations import _migrate_tgc_nha_gia_cong_rieng
from app.models.audit import AuditLog
from app.models.purchase import Supplier
from app.models.thue_gia_cong import TgcDon, TgcNhaGiaCong

ADMIN = {"username": "admin", "password": "admin123"}
URL = "/api/thue-gia-cong/nha-gia-cong"


def _h(client) -> dict[str, str]:
    r = client.post("/api/auth/login", json=ADMIN)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _them(client, h, ten: str) -> dict:
    r = client.post(URL, headers=h, json={"ten": ten})
    assert r.status_code == 201, r.text
    return r.json()


def test_them_gom_khoang_trang_va_trung_ten_tra_lai_nha_cu(client):
    h = _h(client)
    a = _them(client, h, "  Cán màng   Minh Long ")
    assert a["ten"] == "Cán màng Minh Long" and a["active"] is True
    assert _them(client, h, "cán màng minh long")["id"] == a["id"]
    assert client.get(URL, headers=h).json() == [a]
    assert client.post(URL, headers=h, json={"ten": "   "}).status_code == 400


def test_bo_nha_chua_co_don_thi_xoa_han(client):
    h = _h(client)
    a = _them(client, h, "Bế Tân Tiến")
    assert client.delete(f"{URL}/{a['id']}", headers=h).status_code == 204
    assert client.get(URL, params={"ca_da_bo": True}, headers=h).json() == []
    assert client.delete(f"{URL}/{a['id']}", headers=h).status_code == 404
    with SessionLocal() as s:
        hanh_dong = {r.action for r in s.query(AuditLog).filter(AuditLog.target == f"tgc_nha_gia_cong:{a['id']}")}
    assert hanh_dong == {"tgc_nha_them", "tgc_nha_bo"}


def test_bo_nha_da_co_don_chi_an_gay_lai_ten_thi_bat_lai(client):
    h = _h(client)
    a = _them(client, h, "In hộp Phú Thịnh")
    with SessionLocal() as s:
        s.add(TgcDon(ma="GC26-9501", nha_cung_cap_id=a["id"], nha_cung_cap_ten=a["ten"], ngay_dat=date.today()))
        s.commit()
    assert client.delete(f"{URL}/{a['id']}", headers=h).status_code == 204
    assert client.get(URL, headers=h).json() == []
    assert client.get(URL, params={"ca_da_bo": True}, headers=h).json() == [{**a, "active": False}]
    # Gõ lại đúng tên ở ô chọn: bật lại nhà cũ, không đẻ bản thứ hai.
    assert _them(client, h, "In hộp Phú Thịnh") == a


def test_mg_0484_chuyen_ncc_co_tich_va_go_cot(client):
    with SessionLocal() as s:
        s.execute(text("ALTER TABLE suppliers ADD COLUMN nhan_gia_cong BOOLEAN NOT NULL DEFAULT 0"))
        co = Supplier(name="Cán màng Minh Long")
        khong = Supplier(name="Giấy Hoàng Hà")
        ngung = Supplier(name="Bế Tân Tiến", status="inactive")
        s.add_all([co, khong, ngung])
        s.flush()
        s.execute(text("UPDATE suppliers SET nhan_gia_cong = 1 WHERE id IN (:a, :b)"), {"a": co.id, "b": ngung.id})
        s.add(TgcNhaGiaCong(ten="cán màng minh long"))   # trùng tên (khác hoa thường) ⇒ không thêm bản mới
        s.commit()

        _migrate_tgc_nha_gia_cong_rieng(s)
        assert [n.ten for n in s.query(TgcNhaGiaCong)] == ["cán màng minh long"]
        assert "nhan_gia_cong" not in {c["name"] for c in inspect(s.get_bind()).get_columns("suppliers")}
        _migrate_tgc_nha_gia_cong_rieng(s)   # chạy lại vô hại
