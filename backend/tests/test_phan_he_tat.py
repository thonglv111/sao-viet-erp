"""Tắt phân hệ theo bản cài — `PHAN_HE_TAT` (docs/prd-tat-phan-he-theo-ban-cai.md)."""
from __future__ import annotations

import pytest

from app.config import settings


def _admin(client) -> dict[str, str]:
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def tat_het(monkeypatch):
    monkeypatch.setattr(settings, "phan_he_tat", "luong,khoan,hoa_hong,giao_hang,tai_san,cham_cong,sua_chua")


def test_rong_la_bat_het(client, monkeypatch):
    # Ghi rõ: máy bản cài tắt phân hệ có PHAN_HE_TAT trong backend/.env, test đọc phải nó.
    monkeypatch.setattr(settings, "phan_he_tat", "")
    h = _admin(client)
    r = client.get("/api/auth/permissions", headers=h).json()
    assert r["phan_he_tat"] == []
    assert {"luong", "giao_hang", "dm_xe", "tai_san"} <= set(r["modules"])
    assert client.get("/api/luong/params", headers=h).status_code == 200
    assert client.get("/api/tai-san/thang/2026/10", headers=h).status_code == 200
    assert client.get("/api/leaves/me", headers=h).status_code == 200


def test_tat_thi_admin_cung_mat_quyen(client, tat_het):
    h = _admin(client)
    r = client.get("/api/auth/permissions", headers=h).json()
    assert r["phan_he_tat"] == ["cham_cong", "giao_hang", "hoa_hong", "khoan", "luong", "sua_chua", "tai_san"]
    assert not {"luong", "giao_hang", "dm_xe", "tai_san"} & set(r["modules"])
    assert not any(p["module_key"] in ("luong", "giao_hang", "dm_xe", "tai_san") for p in r["permissions"])
    ns = next(p for p in r["permissions"] if p["module_key"] == "nhan_su")
    assert ns["can_view_salary"] is False and ns["can_edit_salary"] is False
    assert client.get("/api/luong/params", headers=h).status_code == 404
    # đường "của tôi" không qua cổng module cũng bị chặn
    assert client.get("/api/luong/advances/me", headers=h).status_code == 404
    assert client.get("/api/giao-hang/requests", headers=h).status_code == 403
    assert client.get("/api/xe", headers=h).status_code == 403
    assert client.get("/api/tai-san/thang/2026/10", headers=h).status_code == 403
    cham_cong = {"cham_cong", "yeu_cau_chinh_cong", "nghi_phep", "tang_ca", "di_muon"}
    assert not cham_cong & set(r["modules"])
    # đường "của tôi" (đơn nghỉ, bảng công của tôi) cũng chặn
    for url in ("/api/leaves/me", "/api/attendance/shifts", "/api/overtime", "/api/late-early",
                "/api/calendar/config"):
        assert client.get(url, headers=h).status_code == 404, url
    assert not {"ky_thuat_may", "phieu_bao_tri"} & set(r["modules"])
    assert client.get("/api/ky-thuat-may/sua-chua", headers=h).status_code == 403
    assert client.get("/api/ky-thuat-may/bao-tri", headers=h).status_code == 403


def test_tat_sua_chua_ban_to_van_doi_may_duoc(client, tat_het):
    """`may-chon` (ô Đổi máy ở bàn tổ) gác theo quyền tổ, không chết theo phân hệ sửa chữa."""
    from app.db import SessionLocal
    from app.models.department import Department
    from app.models.user import User
    from app.security import create_access_token
    from tests.quyen_to_fixtures import cap_quyen_to

    db = SessionLocal()
    try:
        goc = Department(name="Sản xuất PH", code="SX-PH", la_san_xuat=True)
        db.add(goc)
        db.flush()
        to_in = Department(name="Tổ in PH", code="TI-PH", parent_id=goc.id)
        db.add(to_in)
        db.flush()
        tho = User(username="tho_ph", name="Thợ PH", password_hash="x", department_id=to_in.id)
        db.add(tho)
        db.flush()
        cap_quyen_to(db, tho, to_in, viec=())
        db.commit()
        h = {"Authorization": f"Bearer {create_access_token(str(tho.id))}"}
    finally:
        db.close()
    assert client.get("/api/ky-thuat-may/may-chon", headers=h).status_code == 200


def test_tat_hoa_hong_thi_chot_don_khong_chup_bieu(monkeypatch):
    from types import SimpleNamespace

    from app.services import order_service

    goi = []
    monkeypatch.setattr(order_service, "_bac_hoa_hong_cua_sale",
                        lambda *a, **k: goi.append(1) or [{"den_ngay": 30, "pct": 0.02}])
    don = SimpleNamespace(bac_hoa_hong=None, sale_user_id=1)
    monkeypatch.setattr(settings, "phan_he_tat", "hoa_hong")
    order_service._chup_hoa_hong(don, db=None)
    assert don.bac_hoa_hong is None and not goi
    monkeypatch.setattr(settings, "phan_he_tat", "")
    order_service._chup_hoa_hong(don, db=None)
    assert don.bac_hoa_hong == [{"den_ngay": 30, "pct": 0.02}]
