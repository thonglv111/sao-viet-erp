"""Xuất hàng ở đơn bán khi TẮT giao hàng (docs/prd-tat-phan-he-theo-ban-cai.md)."""
from __future__ import annotations

from datetime import date

import pytest

from app.config import settings
from app.db import SessionLocal
from app.models.delivery import LG_DA_HUY, LG_THANH_CONG, YC_DA_HUY, DeliveryRequest, DeliveryTrip
from app.models.employee import Employee
from app.models.user import User
from app.repositories.delivery_repo import DeliveryRepository

from tests.test_giao_hang_api import _admin, _don_da_chot, _kho_lap_phieu, _kho_xuat


@pytest.fixture
def tat_giao_hang(monkeypatch):
    monkeypatch.setattr(settings, "phan_he_tat", "giao_hang")


def _gan_ho_so_admin() -> None:
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.username == "admin").one()
        if db.query(Employee).filter(Employee.user_id == u.id).one_or_none() is None:
            db.add(Employee(code="NV-ADMIN-XH", full_name="Admin", user_id=u.id))
            db.commit()
    finally:
        db.close()


def _xuat(client, h, oid, lid, qty):
    return client.post("/api/giao-hang/xuat-hang", headers=h, json={
        "order_id": oid, "ngay_can_giao": date.today().isoformat(),
        "lines": [{"order_line_id": lid, "qty": qty}], "ghi_chu": "Giao sáng mai"})


def _chuyen(code: str) -> DeliveryTrip:
    db = SessionLocal()
    try:
        req = db.query(DeliveryRequest).filter(DeliveryRequest.code == code).one()
        trip = db.query(DeliveryTrip).filter(DeliveryTrip.request_id == req.id).one()
        db.expunge(trip)
        return trip
    finally:
        db.close()


def test_bat_giao_hang_thi_khong_xuat_thang(client):
    h = _admin(client)
    oid, lid = _don_da_chot(suffix="XH0")
    assert _xuat(client, h, oid, lid, 10).status_code == 400


def test_chua_gan_ho_so_thi_bao_ro(client, tat_giao_hang):
    h = _admin(client)
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.username == "admin").one()
        for e in db.query(Employee).filter(Employee.user_id == u.id):
            e.user_id = None
        db.commit()
    finally:
        db.close()
    oid, lid = _don_da_chot(suffix="XH1")
    r = _xuat(client, h, oid, lid, 10)
    assert r.status_code == 400 and "hồ sơ nhân viên" in r.json()["detail"]


def test_xuat_roi_kho_ghi_so_la_da_giao(client, tat_giao_hang):
    _gan_ho_so_admin()
    h = _admin(client)
    oid, lid = _don_da_chot(suffix="XH2", qty=1000)
    r = _xuat(client, h, oid, lid, 100)
    assert r.status_code == 201, r.text
    assert r.json()["phieu_kho"]
    trip = _chuyen(r.json()["request_code"])
    assert trip.vehicle_id is None
    _kho_xuat(client, h, trip.id)
    assert _chuyen(r.json()["request_code"]).trang_thai == LG_THANH_CONG
    db = SessionLocal()
    try:
        assert DeliveryRepository(db).da_giao_theo_dong(oid)[lid] == 100
    finally:
        db.close()


def test_vuot_con_phai_giao_bi_chan(client, tat_giao_hang):
    _gan_ho_so_admin()
    h = _admin(client)
    oid, lid = _don_da_chot(suffix="XH3", qty=50)
    assert _xuat(client, h, oid, lid, 60).status_code == 400


def test_kho_huy_phieu_thi_huy_ca_yeu_cau(client, tat_giao_hang):
    _gan_ho_so_admin()
    h = _admin(client)
    oid, lid = _don_da_chot(suffix="XH4", qty=100)
    r = _xuat(client, h, oid, lid, 40)
    code = r.json()["request_code"]
    phieu = _kho_lap_phieu(client, h, _chuyen(code).id)
    rr = client.post(f"/api/kho/phieu/{phieu}/huy", headers=h, json={"ly_do": "Khách hoãn"})
    assert rr.status_code == 200, rr.text
    assert _chuyen(code).trang_thai == LG_DA_HUY
    db = SessionLocal()
    try:
        assert db.query(DeliveryRequest).filter(DeliveryRequest.code == code).one().trang_thai \
            == YC_DA_HUY
    finally:
        db.close()
    # hàng thôi bị giữ ⇒ xuất lại đủ 100
    assert _xuat(client, h, oid, lid, 100).status_code == 201


def test_lan_xuat_goi_bang_so_phieu_xuat(client, tat_giao_hang):
    """Bản tắt giao hàng gọi lần xuất bằng số phiếu xuất kho, ở cả tiến độ đơn lẫn bảng hóa đơn
    (04/11/2026) — mã yêu cầu giao ẩn không ai khác nhìn thấy."""
    _gan_ho_so_admin()
    h = _admin(client)
    oid, lid = _don_da_chot(suffix="XH5", qty=1000)
    r = _xuat(client, h, oid, lid, 100)
    assert r.status_code == 201, r.text
    trip = _chuyen(r.json()["request_code"])
    _kho_xuat(client, h, trip.id)
    td = client.get(f"/api/orders/{oid}/tien-do", headers=h).json()
    (yc,) = td["yeu_cau"]
    (ma,) = yc["chuyen"]["phieu_xuat_ma"]
    assert ma and ma != r.json()["request_code"]
    hd = client.get("/api/accounting/sales-invoices", headers=h, params={"order_id": oid}).json()
    assert [l["ma"] for l in hd["luot_giao"]] == [ma]
