"""Trang Tạo đơn thương mại kiểu quầy (docs/design-hang-thuong-mai-ha-phuong.md §6, phương án C)."""
from __future__ import annotations

import pytest

from app.config import settings
from tests.test_don_thuong_mai import _admin, _hang, _khach
from tests.test_luot_xuat_thuong_mai import _kho, _nhap


@pytest.fixture
def bat_tm(monkeypatch):
    monkeypatch.setattr(settings, "phan_he_bat", "thuong_mai")


def _so_don(client, h) -> int:
    return client.get("/api/orders", headers=h, params={"size": 100}).json()["total"]


def test_tra_ngay_xuat_ngay_mot_lan_bam(client, bat_tm):
    h = _admin(client)
    hid, dv = _hang(client, h, "TM-BN1", gia=75000)
    kho = _kho(client, h, "Cửa hàng BN1")
    _nhap(client, h, kho, hid, dv, 12, 50000)
    r = client.post("/api/thuong-mai/ban-nhanh", headers=h, json={
        "customer_id": _khach(client, h, "Khách lẻ BN1"),
        "lines": [{"hang_id": hid, "dvt": dv, "qty": 2}],
        "thu": {"receipt_method": "cash", "amount": 150000},
        "xuat": {"kho_id": kho, "ghi_so": True}})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["status"] == "ordered" and d["order_no"].startswith("TM")
    assert d["tm_da_thu"] == 150000
    assert len(d["deposits"]) == 1 and d["deposits"][0]["amount"] == 150000
    st = client.get(f"/api/thuong-mai/don/{d['id']}/xuat", headers=h).json()
    assert st["luot"][0]["trang_thai"] == "da_xuat" and st["con_lai"][str(d["lines"][0]["id"])] == 0
    # Tồn còn 10 hộp ở kho đó.
    ton = client.post("/api/thuong-mai/ton", headers=h, json={
        "kho_id": kho, "lines": [{"hang_id": hid, "dvt": dv, "qty": 1}]}).json()
    assert ton == [{"hang_id": hid, "dvt": dv, "ton": 10}]
    # Đơn thương mại không xuống sản xuất nên không bị xếp vào "Chờ cọc" ở danh sách đơn.
    cho = client.get("/api/orders", headers=h, params={"status": "cho_coc", "size": 100}).json()["items"]
    assert d["id"] not in [o["id"] for o in cho]
    assert client.get("/api/orders/stats", headers=h).json()["cho_coc"] == len(cho)
    dong = next(o for o in client.get("/api/orders", headers=h, params={"size": 100}).json()["items"]
                if o["id"] == d["id"])
    assert dong["dang_cho"] == []


def test_thieu_ton_khong_ghi_gi(client, bat_tm):
    h = _admin(client)
    hid, dv = _hang(client, h, "TM-BN2", gia=12000)
    kho = _kho(client, h, "Cửa hàng BN2")
    _nhap(client, h, kho, hid, dv, 1, 8000)
    truoc = _so_don(client, h)
    r = client.post("/api/thuong-mai/ban-nhanh", headers=h, json={
        "customer_id": _khach(client, h, "Khách BN2"),
        "lines": [{"hang_id": hid, "dvt": dv, "qty": 2}],
        "thu": {"receipt_method": "cash", "amount": 24000},
        "xuat": {"kho_id": kho, "ghi_so": True}})
    assert r.status_code == 400 and "không đủ hàng" in r.json()["detail"]
    # Câu báo nói tên đơn vị người đọc được, không in mã.
    ten = next(d["ten"] for d in client.get("/api/don-vi?size=200", headers=h).json()["items"] if d["ma"] == dv)
    assert f"còn thiếu 1 {ten}." in r.json()["detail"]
    assert _so_don(client, h) == truoc


def test_thu_vuot_tong_bi_chan_truoc_khi_ghi(client, bat_tm):
    h = _admin(client)
    hid, dv = _hang(client, h, "TM-BN3", gia=10000)
    truoc = _so_don(client, h)
    r = client.post("/api/thuong-mai/ban-nhanh", headers=h, json={
        "customer_id": _khach(client, h, "Khách BN3"),
        "lines": [{"hang_id": hid, "dvt": dv, "qty": 1}],
        "thu": {"receipt_method": "cash", "amount": 10001}})
    assert r.status_code == 400 and "vượt" in r.json()["detail"]
    r = client.post("/api/thuong-mai/ban-nhanh", headers=h, json={
        "customer_id": _khach(client, h, "Khách BN3"),
        "lines": [{"hang_id": hid, "dvt": dv, "qty": 1}],
        "thu": {"receipt_method": "bank_transfer", "amount": 10000}})
    assert r.status_code == 400 and "tài khoản" in r.json()["detail"]
    assert _so_don(client, h) == truoc


def test_thanh_toan_sau_xuat_sau_chi_chot_va_giu_coc(client, bat_tm):
    h = _admin(client)
    hid, dv = _hang(client, h, "TM-BN4", gia=100000)
    r = client.post("/api/thuong-mai/ban-nhanh", headers=h, json={
        "customer_id": _khach(client, h, "Khách BN4"),
        "lines": [{"hang_id": hid, "dvt": dv, "qty": 3}], "deposit_amount": 50000})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["status"] == "ordered" and d["deposit_required"] == 50000 and d["tm_da_thu"] == 0
    assert client.get(f"/api/thuong-mai/don/{d['id']}/xuat", headers=h).json()["luot"] == []


def test_thu_tien_sau_chot_tran_la_phan_con_thieu(client, bat_tm, monkeypatch):
    """Chặng Thu tiền: đơn không khai cọc vẫn lập phiếu thu theo đơn, không vượt phần còn thiếu."""
    from app.realtime import hub

    da_bao: list[dict] = []
    monkeypatch.setattr(hub, "publish", lambda _nhan, ev: da_bao.append(ev))
    h = _admin(client)
    hid, dv = _hang(client, h, "TM-BN5", gia=40000)
    d = client.post("/api/thuong-mai/ban-nhanh", headers=h, json={
        "customer_id": _khach(client, h, "Khách BN5"),
        "lines": [{"hang_id": hid, "dvt": dv, "qty": 2}],
        "thu": {"receipt_method": "cash", "amount": 30000}}).json()
    assert d["tm_da_thu"] == 30000
    r = client.post(f"/api/orders/{d['id']}/deposit-receipts", headers=h,
                    json={"receipt_method": "cash", "amount": 50001})
    assert r.status_code == 422 and "50.000" in r.json()["detail"]
    r = client.post(f"/api/orders/{d['id']}/deposit-receipts", headers=h,
                    json={"receipt_method": "cash", "amount": 50000})
    assert r.status_code == 200, r.text
    assert r.json()["tm_da_thu"] == 80000
    # Đơn thương mại không xuống sản xuất: thu tiền không báo "đủ cọc, chuyển xuống sản xuất".
    assert not [e for e in da_bao if e.get("type") == "order_deposit_ok"]
    r = client.post(f"/api/orders/{d['id']}/deposit-receipts", headers=h,
                    json={"receipt_method": "cash", "amount": 1})
    assert r.status_code == 422 and "đủ tiền" in r.json()["detail"]


def test_sua_don_nhap_roi_chot_xuat_thu_tren_chinh_don_do(client, bat_tm):
    """Trang Sửa đơn (14/11/2026): đơn nháp sửa được khách, dòng, cọc, ghi chú; nút chính chốt + xuất + thu
    trên CHÍNH đơn đó, không sinh đơn mới."""
    h = _admin(client)
    hid, dv = _hang(client, h, "TM-SUA1", gia=10000)
    kho = _kho(client, h, "Cửa hàng SUA1")
    _nhap(client, h, kho, hid, dv, 10, 6000)
    k1, k2 = _khach(client, h, "Khách SUA1"), _khach(client, h, "Khách SUA2")
    d = client.post("/api/thuong-mai/don", headers=h, json={
        "customer_id": k1, "lines": [{"hang_id": hid, "dvt": dv, "qty": 1}]}).json()
    r = client.put(f"/api/thuong-mai/don/{d['id']}", headers=h, json={
        "customer_id": k2, "lines": [{"hang_id": hid, "dvt": dv, "qty": 3}],
        "deposit_amount": 5000, "ghi_chu": "Lấy chiều"})
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["status"] == "draft" and s["customer_id"] == k2 and s["lines"][0]["qty"] == 3
    assert s["deposit_amount"] == 5000 and s["delivery_note"] == "Lấy chiều"
    truoc = _so_don(client, h)
    r = client.post(f"/api/thuong-mai/don/{d['id']}/ban-nhanh", headers=h, json={
        "customer_id": k2, "lines": [{"hang_id": hid, "dvt": dv, "qty": 2}],
        "thu": {"receipt_method": "cash", "amount": 20000},
        "xuat": {"kho_id": kho, "ghi_so": True}})
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["id"] == d["id"] and c["status"] == "ordered" and c["lines"][0]["qty"] == 2
    assert c["tm_da_thu"] == 20000 and _so_don(client, h) == truoc
    st = client.get(f"/api/thuong-mai/don/{d['id']}/xuat", headers=h).json()
    assert st["luot"][0]["trang_thai"] == "da_xuat"
    # Đã chốt thì không sửa được nữa.
    r = client.put(f"/api/thuong-mai/don/{d['id']}", headers=h, json={
        "customer_id": k2, "lines": [{"hang_id": hid, "dvt": dv, "qty": 1}]})
    assert r.status_code == 400


def test_luu_nhap_giu_du_kien_xuat_hang_va_thanh_toan(client, bat_tm):
    """Lưu nháp giữ kho xuất, cách giao, cách thanh toán (14/11/2026): ngăn đơn và trang Sửa đọc lại được."""
    h = _admin(client)
    hid, dv = _hang(client, h, "TM-DK1", gia=10000)
    kho = _kho(client, h, "Cửa hàng DK1")
    k = _khach(client, h, "Khách DK1")
    d = client.post("/api/thuong-mai/don", headers=h, json={
        "customer_id": k, "lines": [{"hang_id": hid, "dvt": dv, "qty": 1}],
        "du_kien": {"xuat_ngay": True, "kho_id": kho, "phuong_thuc": {"loai": "khong_giao", "nguoi_giao_id": 5},
                    "tra_ngay": True, "cach_nhan": "cash"}}).json()
    dk = d["tm_du_kien"]
    assert dk["kho_id"] == kho and dk["kho_ten"] == "Cửa hàng DK1"
    # Ô không thuộc cách giao đã chọn bị bỏ.
    assert dk["phuong_thuc"]["loai"] == "khong_giao" and dk["phuong_thuc"]["nguoi_giao_id"] is None
    assert dk["tra_ngay"] is True and dk["cach_nhan"] == "cash"
    # Sửa không gửi dự kiến ⇒ giữ nguyên; gửi ⇒ ghi đè.
    s = client.put(f"/api/thuong-mai/don/{d['id']}", headers=h, json={
        "customer_id": k, "lines": [{"hang_id": hid, "dvt": dv, "qty": 2}]}).json()
    assert s["tm_du_kien"]["kho_id"] == kho
    s = client.put(f"/api/thuong-mai/don/{d['id']}", headers=h, json={
        "customer_id": k, "lines": [{"hang_id": hid, "dvt": dv, "qty": 2}],
        "du_kien": {"xuat_ngay": False, "tra_ngay": False, "cach_nhan": "cash"}}).json()
    assert s["tm_du_kien"]["xuat_ngay"] is False and s["tm_du_kien"]["cach_nhan"] is None
    # Chốt rồi thì không còn là dự kiến.
    c = client.post(f"/api/thuong-mai/don/{d['id']}/ban-nhanh", headers=h, json={
        "customer_id": k, "lines": [{"hang_id": hid, "dvt": dv, "qty": 2}]}).json()
    assert c["status"] == "ordered" and c["tm_du_kien"] is None
