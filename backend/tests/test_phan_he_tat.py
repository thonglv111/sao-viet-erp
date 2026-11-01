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
    monkeypatch.setattr(settings, "phan_he_tat", "luong,khoan,hoa_hong,giao_hang")


def test_rong_la_bat_het(client):
    h = _admin(client)
    r = client.get("/api/auth/permissions", headers=h).json()
    assert r["phan_he_tat"] == []
    assert {"luong", "giao_hang", "dm_xe"} <= set(r["modules"])
    assert client.get("/api/luong/params", headers=h).status_code == 200


def test_tat_thi_admin_cung_mat_quyen(client, tat_het):
    h = _admin(client)
    r = client.get("/api/auth/permissions", headers=h).json()
    assert r["phan_he_tat"] == ["giao_hang", "hoa_hong", "khoan", "luong"]
    assert not {"luong", "giao_hang", "dm_xe"} & set(r["modules"])
    assert not any(p["module_key"] in ("luong", "giao_hang", "dm_xe") for p in r["permissions"])
    ns = next(p for p in r["permissions"] if p["module_key"] == "nhan_su")
    assert ns["can_view_salary"] is False and ns["can_edit_salary"] is False
    assert client.get("/api/luong/params", headers=h).status_code == 404
    # đường "của tôi" không qua cổng module cũng bị chặn
    assert client.get("/api/luong/advances/me", headers=h).status_code == 404
    assert client.get("/api/giao-hang/requests", headers=h).status_code == 403
    assert client.get("/api/xe", headers=h).status_code == 403


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
