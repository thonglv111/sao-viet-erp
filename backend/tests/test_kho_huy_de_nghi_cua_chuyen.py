"""Kho huỷ đề nghị xuất của một chuyến giao ⇒ chuyến rời "Chờ kho xuất" (lỗi #32 bấm thử 18/10/2026).

Kho bấm "Hủy yêu cầu" trên DNX00113 thì yêu cầu thành "cancelled" nhưng chuyến vẫn `dang_chuan_bi`:
màn Giao hàng ghi mãi "CHỜ KHO XUẤT", không lý do, không dòng lịch sử, điều phối không biết.

Luật: kho không xuất nữa ⇒ chuyến quay về "Đã lên kế hoạch" (trạng thái trước khi gửi kho), lịch sử
chuyến có dòng ghi lý do của kho, màn Giao hàng được đẩy sự kiện ngay. Hai đường kho huỷ: huỷ yêu cầu
(`/huy-kho`) và huỷ phiếu nháp cuối cùng của yêu cầu (`/phieu/{id}/huy`).
"""
from __future__ import annotations

from app.db import SessionLocal
from app.models.delivery import DeliveryStatusHistory, DeliveryTrip
from app.models.stock_request import REQ_XUAT, StockRequest
from app.realtime import hub
from tests.test_giao_hang_api import (
    _admin,
    _don_da_chot,
    _kho_lap_phieu,
    _len_kh,
    _tai_xe,
    _tao_yc,
)


def _chuyen_cho_kho(client, h, suffix: str) -> tuple[int, StockRequest]:
    oid, lid = _don_da_chot(suffix=suffix, qty=60)
    yc = _tao_yc(client, h, oid, lid, qty=60)
    r = _len_kh(client, h, yc["id"], _tai_xe(f"TX-{suffix}"))
    assert r.status_code == 201, r.text
    trip = r.json()["trip"]["id"]
    db = SessionLocal()
    try:
        assert db.get(DeliveryTrip, trip).trang_thai == "dang_chuan_bi"
        req = (db.query(StockRequest)
               .filter(StockRequest.delivery_trip_id == trip, StockRequest.loai == REQ_XUAT).one())
        db.expunge(req)
        return trip, req
    finally:
        db.close()


def _trang_thai_va_lich_su(trip: int):
    db = SessionLocal()
    try:
        tt = db.get(DeliveryTrip, trip).trang_thai
        ls = (db.query(DeliveryStatusHistory).filter(DeliveryStatusHistory.trip_id == trip)
              .order_by(DeliveryStatusHistory.id.desc()).first())
        return tt, ls.tu_trang_thai, ls.den_trang_thai, ls.ly_do
    finally:
        db.close()


def _nghe_su_kien(monkeypatch) -> list[dict]:
    da_gui: list[dict] = []
    goc = hub.gui

    def gui(ev, *a, **kw):
        da_gui.append(ev)
        return goc(ev, *a, **kw)

    monkeypatch.setattr(hub, "gui", gui)
    return da_gui


def test_kho_huy_yeu_cau_thi_chuyen_ve_da_len_ke_hoach_kem_ly_do(client, monkeypatch):
    h = _admin(client)
    trip, req = _chuyen_cho_kho(client, h, "kh32a")
    su_kien = _nghe_su_kien(monkeypatch)

    r = client.post(f"/api/kho/de-nghi/{req.id}/huy-kho", headers=h,
                    json={"ly_do": "Hàng lỗi, chưa xuất được"})
    assert r.status_code == 200, r.text

    tt, tu, den, ly_do = _trang_thai_va_lich_su(trip)
    assert tt == "da_len_ke_hoach"
    assert (tu, den) == ("dang_chuan_bi", "da_len_ke_hoach")
    assert req.ma in ly_do and "Hàng lỗi, chưa xuất được" in ly_do
    assert any(e.get("type") == "giao_hang_changed" and e.get("trip_id") == trip for e in su_kien)


def test_kho_huy_phieu_nhap_cuoi_cung_cung_tra_chuyen_ve(client):
    h = _admin(client)
    trip, _req = _chuyen_cho_kho(client, h, "kh32b")
    phieu = _kho_lap_phieu(client, h, trip)
    r = client.post(f"/api/kho/phieu/{phieu}/huy", headers=h, json={"ly_do": "Soạn nhầm"})
    assert r.status_code == 200, r.text

    tt, _tu, _den, ly_do = _trang_thai_va_lich_su(trip)
    assert tt == "da_len_ke_hoach"
    assert "Soạn nhầm" in ly_do


def test_dieu_phoi_huy_chuyen_van_ve_da_huy(client):
    """Đường ngược: chính Giao hàng huỷ chuyến (kéo huỷ đề nghị kho theo) ⇒ chuyến `da_huy`, không bị
    móc của kho kéo về "Đã lên kế hoạch"."""
    h = _admin(client)
    trip, _req = _chuyen_cho_kho(client, h, "kh32c")
    r = client.post(f"/api/giao-hang/plans/{trip}/huy", headers=h, json={"ly_do": "Khách hoãn"})
    assert r.status_code == 200, r.text
    assert _trang_thai_va_lich_su(trip)[0] == "da_huy"
