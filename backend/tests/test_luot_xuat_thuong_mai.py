"""Lượt xuất của đơn thương mại — chỉ In Hà Phương (docs/design-hang-thuong-mai-ha-phuong.md §6 Xuất hàng)."""
from __future__ import annotations

import pytest

from app.config import settings
from tests.test_don_thuong_mai import _admin, _hang, _khach


@pytest.fixture
def bat_tm(monkeypatch):
    monkeypatch.setattr(settings, "phan_he_bat", "thuong_mai")


def _kho(client, h, ten="Kho Cửa hàng") -> int:
    r = client.post("/api/kho", json={"ten": ten}, headers=h)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _nhap(client, h, kho, hid, dv, sl, gia):
    r = client.post("/api/kho/de-nghi", headers=h, json={"loai": "NHAP", "kho_id": kho, "lines": [
        {"hang_loai": "vat_tu", "hang_id": hid, "dvt": dv, "sl_de_nghi": sl, "don_gia": gia}]})
    assert r.status_code == 201, r.text
    req = r.json()
    r = client.post("/api/kho/phieu", headers=h, json={
        "request_id": req["id"], "kho_id": kho, "ghi_so": True,
        "lines": [{"request_line_id": req["lines"][0]["id"], "so_luong": sl}]})
    assert r.status_code == 201, r.text
    assert client.post(f"/api/kho/phieu/{r.json()['id']}/ghi-so", headers=h).status_code == 200


def _don_chot(client, h, hid, dv, qty=5, kh="KH xuất") -> dict:
    d = client.post("/api/thuong-mai/don", headers=h, json={
        "customer_id": _khach(client, h, kh), "lines": [{"hang_id": hid, "dvt": dv, "qty": qty}]}).json()
    assert client.post(f"/api/orders/{d['id']}/confirm", headers=h).status_code == 200
    return d


def test_xuat_mot_lan_bam_ghi_so_va_chup_gia_von(client, bat_tm):
    h = _admin(client)
    hid, dv = _hang(client, h, "TM-X1", gia=5000)
    kho = _kho(client, h)
    _nhap(client, h, kho, hid, dv, 10, 3000)
    d = _don_chot(client, h, hid, dv, qty=5)
    ol = d["lines"][0]["id"]

    r = client.post(f"/api/thuong-mai/don/{d['id']}/xuat", headers=h, json={
        "kho_id": kho, "ghi_so": True, "lines": [{"order_line_id": ol, "qty": 3}]})
    assert r.status_code == 201, r.text
    st = r.json()
    assert st["con_lai"][str(ol)] == 2
    luot = st["luot"][0]
    assert luot["trang_thai"] == "da_xuat" and luot["ma"] == f"{d['order_no']}-X1"
    assert luot["dong"][0]["qty_thuc"] == 3 and luot["dong"][0]["gia_von"] == 9000

    from app.db import SessionLocal
    from app.models.order import OrderLine

    with SessionLocal() as db:
        assert db.get(OrderLine, ol).cost_snapshot == 9000
    # Màn đơn bán không mang giá vốn của đơn thương mại.
    det = client.get(f"/api/orders/{d['id']}", headers=h).json()
    assert det["lines"][0]["cost_snapshot"] is None and det.get("order_cost") is None

    # Vượt phần còn lại ⇒ chặn.
    r = client.post(f"/api/thuong-mai/don/{d['id']}/xuat", headers=h, json={
        "kho_id": kho, "lines": [{"order_line_id": ol, "qty": 3}]})
    assert r.status_code == 400 and "còn 2" in r.json()["detail"]


def test_gui_kho_roi_kho_ghi_so_hoac_huy(client, bat_tm):
    h = _admin(client)
    hid, dv = _hang(client, h, "TM-X2", gia=1000)
    kho = _kho(client, h, "Kho CH 2")
    _nhap(client, h, kho, hid, dv, 10, 400)
    d = _don_chot(client, h, hid, dv, qty=6, kh="KH xuất 2")
    ol = d["lines"][0]["id"]

    st = client.post(f"/api/thuong-mai/don/{d['id']}/xuat", headers=h, json={
        "kho_id": kho, "lines": [{"order_line_id": ol, "qty": 2}]}).json()
    l1 = st["luot"][0]
    assert l1["trang_thai"] == "cho_xuat" and l1["stock_request_id"]
    assert st["con_lai"][str(ol)] == 4

    # Kho lập phiếu + ghi sổ ở màn Kho ⇒ lượt "đã xuất".
    req = client.get(f"/api/kho/de-nghi/{l1['stock_request_id']}", headers=h).json()
    goi = client.get("/api/kho/phieu/lo/goi-y", headers=h, params={
        "hang_loai": "vat_tu", "hang_id": hid, "kho_id": kho, "so_luong": 2}).json()
    r = client.post("/api/kho/phieu", headers=h, json={
        "request_id": req["id"], "kho_id": kho, "ghi_so": True,
        "lines": [{"request_line_id": req["lines"][0]["id"], "so_luong": 2,
                   "lot_id": goi["lines"][0]["lot_id"]}]})
    assert r.status_code == 201, r.text
    assert client.post(f"/api/kho/phieu/{r.json()['id']}/ghi-so", headers=h).status_code == 200
    st = client.get(f"/api/thuong-mai/don/{d['id']}/xuat", headers=h).json()
    assert st["luot"][0]["trang_thai"] == "da_xuat" and st["luot"][0]["dong"][0]["gia_von"] == 800

    # Lượt hai: kho huỷ khi chưa xuất gì ⇒ lượt "huỷ", SL trả lại phần còn xuất.
    st = client.post(f"/api/thuong-mai/don/{d['id']}/xuat", headers=h, json={
        "kho_id": kho, "lines": [{"order_line_id": ol, "qty": 4}]}).json()
    l2 = st["luot"][1]
    assert st["con_lai"][str(ol)] == 0
    r = client.post(f"/api/kho/de-nghi/{l2['stock_request_id']}/huy-kho", headers=h,
                    json={"ly_do": "Hết hàng trưng bày"})
    assert r.status_code == 200, r.text
    st = client.get(f"/api/thuong-mai/don/{d['id']}/xuat", headers=h).json()
    assert st["luot"][1]["trang_thai"] == "huy" and st["con_lai"][str(ol)] == 4


def test_ghi_so_thieu_ton_van_giu_yeu_cau(client, bat_tm):
    h = _admin(client)
    hid, dv = _hang(client, h, "TM-X3")
    kho = _kho(client, h, "Kho CH 3")
    d = _don_chot(client, h, hid, dv, qty=2, kh="KH xuất 3")
    r = client.post(f"/api/thuong-mai/don/{d['id']}/xuat", headers=h, json={
        "kho_id": kho, "ghi_so": True, "lines": [{"order_line_id": d["lines"][0]["id"], "qty": 2}]})
    assert r.status_code == 409 and "không đủ hàng" in r.json()["detail"]
    st = client.get(f"/api/thuong-mai/don/{d['id']}/xuat", headers=h).json()
    assert st["luot"][0]["trang_thai"] == "cho_xuat"


def test_chua_chot_khong_xuat_duoc(client, bat_tm):
    h = _admin(client)
    hid, dv = _hang(client, h, "TM-X4")
    kho = _kho(client, h, "Kho CH 4")
    d = client.post("/api/thuong-mai/don", headers=h, json={
        "customer_id": _khach(client, h, "KH nháp"), "lines": [{"hang_id": hid, "dvt": dv, "qty": 1}]}).json()
    r = client.post(f"/api/thuong-mai/don/{d['id']}/xuat", headers=h, json={
        "kho_id": kho, "lines": [{"order_line_id": d["lines"][0]["id"], "qty": 1}]})
    assert r.status_code == 400 and "đã chốt" in r.json()["detail"]


def test_hoa_don_theo_luot_xuat_va_bao_cao_da_giao(client, bat_tm):
    from datetime import date

    h = _admin(client)
    hid, dv = _hang(client, h, "TM-HD", gia=10000)
    kho = _kho(client, h, "Kho CH HD")
    _nhap(client, h, kho, hid, dv, 10, 6000)
    d = _don_chot(client, h, hid, dv, qty=4, kh="KH hoá đơn")
    ol = d["lines"][0]["id"]
    st = client.post(f"/api/thuong-mai/don/{d['id']}/xuat", headers=h, json={
        "kho_id": kho, "ghi_so": True, "lines": [{"order_line_id": ol, "qty": 1}]}).json()
    luot = st["luot"][0]

    ds = client.get("/api/accounting/sales-invoices", headers=h, params={"order_id": d["id"]}).json()
    assert ds["luot_xuat_tm"] is True
    assert [(r["trip_id"], r["ma"], r["gia_tri"]) for r in ds["luot_giao"]] == [(luot["id"], luot["ma"], 10000)]

    hd = {"order_id": d["id"], "invoice_symbol": "1C26THM", "invoice_number": "0000901",
          "invoice_date": date.today().isoformat()}
    r = client.post("/api/accounting/sales-invoices", headers=h, json=hd)
    assert r.status_code == 422 and "lượt xuất" in r.json()["detail"]
    r = client.post("/api/accounting/sales-invoices", headers=h, json={**hd, "luot_xuat_tm_id": luot["id"]})
    assert r.status_code == 201, r.text
    assert r.json()["amount_vnd"] == 10000 and r.json()["luot_xuat_tm_id"] == luot["id"]
    ds = client.get("/api/accounting/sales-invoices", headers=h, params={"order_id": d["id"]}).json()
    assert ds["items"][0]["luot_giao_ma"] == luot["ma"] and ds["luot_giao"][0]["con_ghi"] == 0

    bc = client.get("/api/bao-cao-kinh-doanh", headers=h, params={"nguon": "thuong_mai"}).json()
    don = [x for k in bc["khach"] for x in k["don"]]
    assert [x["order_no"] for x in don] == [d["order_no"]]
    assert don[0]["dong"][0]["da_giao"] == 1 and don[0]["gia_tri_giao"] == 10000
    bc = client.get("/api/bao-cao-kinh-doanh", headers=h, params={"nguon": "san_xuat"}).json()
    assert d["order_no"] not in [x["order_no"] for k in bc["khach"] for x in k["don"]]
