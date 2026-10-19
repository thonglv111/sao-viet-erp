"""Ngày chốt đơn so theo GIỜ XƯỞNG (Asia/Bangkok), không theo ngày UTC của cột `ordered_at`.

Đơn chốt 06:36 sáng 18/10/2026 giờ VN được lưu 2026-10-17 23:36 UTC. So bằng `.date()` trên giờ UTC
thì ngày chốt ra 17/10 và hoá đơn đề 17/10 lọt qua dù luật cấm hoá đơn trước ngày chốt.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from app.db import SessionLocal
from app.models.order import Order
from app.services import accounting_service
from tests.giao_hang_fixtures import giao_het
from tests.test_sales_invoices_api import _headers, _sales_order


def _dat_ordered_at(order_id: int, luc: datetime) -> None:
    db = SessionLocal()
    try:
        db.get(Order, order_id).ordered_at = luc
        db.commit()
    finally:
        db.close()


def _ghi(client, headers, order_id: int, trip_id: int, ngay: str, so: str):
    return client.post(
        "/api/accounting/sales-invoices",
        json={
            "order_id": order_id,
            "delivery_trip_id": trip_id,
            "invoice_symbol": "1C26TSV",
            "invoice_number": so,
            "invoice_date": ngay,
        },
        headers=headers,
    )


def test_hoa_don_truoc_ngay_chot_theo_gio_vn_bi_chan(client, monkeypatch):
    monkeypatch.setattr(accounting_service, "_business_today", lambda: date(2026, 10, 20))
    headers = _headers(client)
    order_id, _ = _sales_order(suffix="VN")
    # 23:36 UTC ngày 17 = 06:36 ngày 18 giờ VN.
    _dat_ordered_at(order_id, datetime(2026, 10, 17, 23, 36, 4, tzinfo=timezone.utc))
    trip_id = giao_het(order_id)

    truoc = _ghi(client, headers, order_id, trip_id, "2026-10-17", "00000011")
    assert truoc.status_code in (400, 409, 422), truoc.text
    assert "Ngày hóa đơn không được trước ngày chốt đơn" in truoc.text

    dung = _ghi(client, headers, order_id, trip_id, "2026-10-18", "00000012")
    assert dung.status_code == 201, dung.text


def test_hoa_don_ordered_at_khong_mui_gio_coi_la_utc(client, monkeypatch):
    """SQLite trả datetime KHÔNG múi: coi là UTC (như Postgres timestamptz), vẫn ra ngày 18 giờ VN."""
    monkeypatch.setattr(accounting_service, "_business_today", lambda: date(2026, 10, 20))
    headers = _headers(client)
    order_id, _ = _sales_order(suffix="VN2")
    _dat_ordered_at(order_id, datetime(2026, 10, 17, 23, 36, 4))
    trip_id = giao_het(order_id)

    truoc = _ghi(client, headers, order_id, trip_id, "2026-10-17", "00000021")
    assert truoc.status_code in (400, 409, 422), truoc.text
    assert "không được trước ngày chốt đơn" in truoc.text
