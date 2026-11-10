"""Đơn thương mại — chỉ In Hà Phương (docs/design-hang-thuong-mai-ha-phuong.md §6)."""
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
    return client.get("/api/don-vi?size=200", headers=h).json()["items"][0]["ma"]


def _hang(client, h, ma="TM-BUT", gia=5000) -> tuple[int, str]:
    dv = _dvt(client, h)
    r = client.post("/api/vat-lieu-kho/hang-thuong-mai", headers=h, json={
        "ma": ma, "ten": f"Hàng {ma}", "don_vi_gia": dv, "gia_ban_theo_dvt": {dv: gia}})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"], dv


def _khach(client, h, ten="Khách lẻ") -> int:
    return client.post("/api/customers", headers=h, json={"name": ten}).json()["customer"]["id"]


def test_tat_phan_he_thi_khong_tao_duoc(client, monkeypatch):
    monkeypatch.setattr(settings, "phan_he_bat", "")
    h = _admin(client)
    r = client.post("/api/thuong-mai/don", headers=h, json={
        "customer_id": 1, "lines": [{"hang_id": 1, "qty": 1}]})
    assert r.status_code == 404


def test_tao_chot_don_thuong_mai(client, bat_tm):
    h = _admin(client)
    hid, dv = _hang(client, h)
    kh = _khach(client, h)
    r = client.post("/api/thuong-mai/don", headers=h, json={
        "customer_id": kh, "lines": [{"hang_id": hid, "dvt": dv, "qty": 3, "vat_pct": 10}]})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["order_no"] == "TM001"
    assert d["lines"][0]["unit_price_snapshot"] == 5000 and d["lines"][0]["line_total"] == 15000
    r2 = client.post("/api/thuong-mai/don", headers=h, json={
        "customer_id": kh, "lines": [{"hang_id": hid, "dvt": dv, "qty": 1, "don_gia": 4500}]})
    assert r2.json()["order_no"] == "TM002"
    assert r2.json()["lines"][0]["unit_price_snapshot"] == 4500
    # chốt: không PO, không ngày giao, không xuống sản xuất
    c = client.post(f"/api/orders/{d['id']}/confirm", headers=h)
    assert c.status_code == 200, c.text
    from app.db import SessionLocal
    from app.models.order import Order

    with SessionLocal() as db:
        o = db.get(Order, d["id"])
        assert o.status == "ordered" and o.source_type == "thuong_mai"
        assert o.san_xuat_released_at is None
        assert all(ln.thanh_pham_id is None for ln in o.lines)
    rel = client.post(f"/api/orders/{d['id']}/release-production", headers=h)
    assert rel.status_code == 409


def test_chan_dong_khong_phai_hang_thuong_mai(client, bat_tm):
    h = _admin(client)
    kh = _khach(client, h, "KH vật tư")
    dv = _dvt(client, h)
    vt = client.post("/api/vat-lieu-kho/vat-tu-in-an", headers=h, json={
        "ma": "VT-KEO", "ten": "Keo", "don_vi_gia": dv}).json()["id"]
    r = client.post("/api/thuong-mai/don", headers=h, json={
        "customer_id": kh, "lines": [{"hang_id": vt, "dvt": dv, "qty": 1, "don_gia": 1000}]})
    assert r.status_code == 400
    assert "Hàng thương mại" in r.json()["detail"]
    hid, _ = _hang(client, h, "TM-LE")
    r = client.post("/api/thuong-mai/don", headers=h, json={
        "customer_id": kh, "lines": [{"hang_id": hid, "dvt": dv, "qty": 1.5}]})
    assert r.status_code == 400


def test_sua_dong_luc_nhap(client, bat_tm):
    h = _admin(client)
    hid, dv = _hang(client, h, "TM-SUA")
    kh = _khach(client, h, "KH sửa")
    d = client.post("/api/thuong-mai/don", headers=h, json={
        "customer_id": kh, "lines": [{"hang_id": hid, "dvt": dv, "qty": 2}]}).json()
    r = client.put(f"/api/thuong-mai/don/{d['id']}/dong", headers=h, json={
        "lines": [{"hang_id": hid, "dvt": dv, "qty": 5, "don_gia": 1000}]})
    assert r.status_code == 200, r.text
    assert [(x["qty"], x["line_total"]) for x in r.json()["lines"]] == [(5, 5000)]


def test_loc_danh_sach_theo_san_xuat_hay_thuong_mai(client, bat_tm):
    """Nút Lọc của Đơn hàng bán: `ban=thuong_mai` chỉ đơn TM, `ban=san_xuat` mọi đơn còn lại."""
    h = _admin(client)
    hid, dv = _hang(client, h)
    kh = _khach(client, h)
    ids = [client.post("/api/thuong-mai/don", headers=h, json={
        "customer_id": kh, "lines": [{"hang_id": hid, "dvt": dv, "qty": 1}]}).json()["id"] for _ in range(2)]
    from app.db import SessionLocal
    from app.models.order import Order

    with SessionLocal() as db:   # giả một đơn sản xuất: nguồn khác thuong_mai
        db.get(Order, ids[1]).source_type = "bao_gia"
        db.commit()

    def ds(ban):
        r = client.get(f"/api/orders?ban={ban}&size=50", headers=h)
        assert r.status_code == 200, r.text
        return {x["id"] for x in r.json()["items"]}

    assert ids[0] in ds("thuong_mai") and ids[1] not in ds("thuong_mai")
    assert ids[1] in ds("san_xuat") and ids[0] not in ds("san_xuat")
    assert client.get("/api/orders?ban=khac", headers=h).status_code == 422
