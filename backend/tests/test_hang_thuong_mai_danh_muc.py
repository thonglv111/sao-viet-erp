"""Danh mục Hàng thương mại — chỉ In Hà Phương (phân hệ `thuong_mai`, mặc định tắt)."""
from __future__ import annotations

import pytest

from app.config import settings


def _admin(client) -> dict[str, str]:
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def bat_tm(monkeypatch):
    monkeypatch.setattr(settings, "phan_he_bat", "thuong_mai")


def _dvt(client, h) -> str:
    rows = client.get("/api/don-vi?size=200", headers=h).json()
    items = rows["items"] if isinstance(rows, dict) else rows
    return items[0]["ma"]


def test_tat_thi_khong_co_man(client, monkeypatch):
    monkeypatch.setattr(settings, "phan_he_bat", "")
    h = _admin(client)
    assert client.get("/api/vat-lieu-kho/hang-thuong-mai", headers=h).status_code in (403, 404)
    assert "hang_thuong_mai" not in client.get("/api/auth/permissions", headers=h).json()["modules"]


def test_hang_thuong_mai_tach_khoi_vat_tu(client, bat_tm):
    h = _admin(client)
    dv = _dvt(client, h)
    r = client.post("/api/vat-lieu-kho/hang-thuong-mai", headers=h, json={
        "ma": "TM-BUT", "ten": "Bút bi", "don_vi_gia": dv, "gia_ban_theo_dvt": {dv: 5000, "khong_co": 1}})
    assert r.status_code in (200, 201), r.text
    hid = r.json()["id"]
    assert r.json()["gia_ban_theo_dvt"] == {dv: 5000}
    ds = client.get("/api/vat-lieu-kho/hang-thuong-mai", headers=h).json()["items"]
    assert [x["ma"] for x in ds] == ["TM-BUT"]
    vt = client.get("/api/vat-lieu-kho/vat-tu-in-an?q=TM-BUT", headers=h).json()["items"]
    assert vt == []
    # màn Vật tư khác không sửa chéo được
    assert client.get(f"/api/vat-lieu-kho/vat-tu-in-an/{hid}", headers=h).status_code == 404
    # ô chọn mặt hàng của kho / mua hàng thấy hàng thương mại, với kho là "vat_tu"
    mh = client.get("/api/vat-lieu-kho/mat-hang?q=TM-BUT", headers=h).json()
    assert [(m["hang_loai"], m["hang_id"], m["nhom"]) for m in mh] == [("vat_tu", hid, "Hàng thương mại")]


def test_khong_xem_gia_thi_khong_lo_gia_ban(client, bat_tm, monkeypatch):
    from app.routers import vat_lieu_kho as r_vlk

    h = _admin(client)
    dv = _dvt(client, h)
    r = client.post("/api/vat-lieu-kho/hang-thuong-mai", headers=h, json={
        "ma": "TM-VO", "ten": "Vở", "don_vi_gia": dv, "gia_ban_theo_dvt": {dv: 12000}})
    hid = r.json()["id"]
    monkeypatch.setattr(r_vlk, "_thay_gia_ban", lambda db, user: False)
    ds = client.get("/api/vat-lieu-kho/hang-thuong-mai", headers=h).json()["items"]
    assert ds[0]["gia_ban_theo_dvt"] is None
    # sửa tên mà gửi giá rỗng thì giá cũ giữ nguyên
    r = client.put(f"/api/vat-lieu-kho/hang-thuong-mai/{hid}", headers=h, json={
        "ma": "TM-VO", "ten": "Vở kẻ ngang", "don_vi_gia": dv, "gia_ban_theo_dvt": {dv: 1}})
    assert r.status_code == 200, r.text
    monkeypatch.setattr(r_vlk, "_thay_gia_ban", lambda db, user: True)
    assert client.get(f"/api/vat-lieu-kho/hang-thuong-mai/{hid}", headers=h).json()["gia_ban_theo_dvt"] == {dv: 12000}
