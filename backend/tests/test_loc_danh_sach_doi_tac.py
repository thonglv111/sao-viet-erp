"""Thanh lọc chung (kỳ + điều kiện) của hai danh bạ đối tác — Khách hàng và Nhà cung cấp
(06/10/2026, Task 21). Lọc ở máy chủ; kỳ tính theo Ngày tạo, ranh ngày theo giờ Việt Nam.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.db import SessionLocal
from app.models.customer import Customer
from app.models.order import Order, OrderLine
from app.models.purchase import Supplier

from .test_quotation_approval import _h, _token

VN = timezone(timedelta(hours=7))


def _vn(*a) -> datetime:
    return datetime(*a, tzinfo=VN).astimezone(timezone.utc)


def _khach(ma: str, **kw) -> int:
    db = SessionLocal()
    try:
        c = Customer(code=ma, name=f"Khách {ma}", **kw)
        db.add(c)
        db.commit()
        return c.id
    finally:
        db.close()


def _ncc(ten: str, **kw) -> int:
    db = SessionLocal()
    try:
        s = Supplier(name=ten, **kw)
        db.add(s)
        db.commit()
        return s.id
    finally:
        db.close()


def _don(kh: int, so: str, luc: datetime) -> None:
    db = SessionLocal()
    try:
        o = Order(order_no=so, customer_id=kh, status="ordered", created_at=luc)
        db.add(o)
        db.flush()
        db.add(OrderLine(order_id=o.id, description="Hộp", line_total=1_000_000))
        db.commit()
    finally:
        db.close()


def _ma_khach(client, t, params) -> set[str]:
    r = client.get("/api/customers", params={"size": 200, **params}, headers=_h(t))
    assert r.status_code == 200, r.text
    return {i["code"] for i in r.json()["items"]}


def _ten_ncc(client, t, params) -> set[str]:
    r = client.get("/api/suppliers", params={"size": 200, **params}, headers=_h(t))
    assert r.status_code == 200, r.text
    return {i["name"] for i in r.json()["items"]}


# --- Khách hàng ---------------------------------------------------------------------------------

def test_khach_loc_ngay_tao_ranh_gio_vn(client):
    t = _token(client)
    # 30/09 17:30 UTC = 01/10 00:30 giờ VN ⇒ THUỘC tháng 10; 16:30 UTC = 30/09 23:30 VN ⇒ ngoài.
    _khach("KT-A", created_at=datetime(2025, 9, 30, 17, 30, tzinfo=timezone.utc))
    _khach("KT-B", created_at=datetime(2025, 9, 30, 16, 30, tzinfo=timezone.utc))
    p = {"tu_ngay": "2025-10-01", "den_ngay": "2025-10-31", "moc": "tao"}
    assert _ma_khach(client, t, p) == {"KT-A"}
    r = client.get("/api/customers", params={"size": 200}, headers=_h(t)).json()["items"]
    assert all(i["created_at"] for i in r)


def test_khach_loc_loai_khach(client):
    t = _token(client)
    _khach("KL-CN", customer_kind="ca_nhan")
    _khach("KL-CT", customer_kind="cong_ty")
    assert _ma_khach(client, t, {"loai": "ca_nhan"}) == {"KL-CN"}
    assert "KL-CN" not in _ma_khach(client, t, {"loai": "cong_ty"})


def test_khach_loc_trang_thai_mua_hang(client):
    t = _token(client)
    dang = _khach("KM-DANG")
    ngung = _khach("KM-NGUNG")
    _khach("KM-CHUA")
    _don(dang, "DH-KM1", datetime.now(timezone.utc) - timedelta(days=10))
    _don(ngung, "DH-KM2", datetime.now(timezone.utc) - timedelta(days=500))
    assert {m for m in _ma_khach(client, t, {"mua": "dang_mua"}) if m.startswith("KM-")} == {"KM-DANG"}
    assert {m for m in _ma_khach(client, t, {"mua": "ngung"}) if m.startswith("KM-")} == {"KM-NGUNG"}
    assert {m for m in _ma_khach(client, t, {"mua": "chua_don"}) if m.startswith("KM-")} == {"KM-CHUA"}


def test_khach_loc_mua_sai_gia_tri_bi_tu_choi(client):
    t = _token(client)
    assert client.get("/api/customers", params={"mua": "bay"}, headers=_h(t)).status_code == 422


# --- Nhà cung cấp -------------------------------------------------------------------------------

def test_ncc_loc_ngay_tao_ranh_gio_vn(client):
    t = _token(client)
    _ncc("NCC A", created_at=datetime(2025, 9, 30, 17, 30, tzinfo=timezone.utc))
    _ncc("NCC B", created_at=datetime(2025, 9, 30, 16, 30, tzinfo=timezone.utc))
    p = {"tu_ngay": "2025-10-01", "den_ngay": "2025-10-31", "moc": "tao"}
    assert _ten_ncc(client, t, p) == {"NCC A"}


def test_ncc_loc_ket_hop_trang_thai_nhom_va_ky(client):
    t = _token(client)
    _ncc("NCC 1", status="active", supplier_group="Giấy", created_at=_vn(2025, 10, 2, 9))
    _ncc("NCC 2", status="inactive", supplier_group="Giấy", created_at=_vn(2025, 10, 2, 9))
    _ncc("NCC 3", status="active", supplier_group="Mực", created_at=_vn(2025, 10, 2, 9))
    _ncc("NCC 4", status="active", supplier_group="Giấy", created_at=_vn(2025, 8, 2, 9))
    p = {"status": "active", "supplier_group": "Giấy", "tu_ngay": "2025-10-01", "den_ngay": "2025-10-31"}
    r = client.get("/api/suppliers", params=p, headers=_h(t)).json()
    assert {i["name"] for i in r["items"]} == {"NCC 1"} and r["total"] == 1
