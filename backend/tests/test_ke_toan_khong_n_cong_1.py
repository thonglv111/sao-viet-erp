"""Guard chống N+1 ở các danh sách của module Kế toán (26/10/2026).

Đếm số câu SQL của MỘT request danh sách khi dữ liệu có ít dòng và khi có nhiều dòng. Số câu phải
đứng yên khi số dòng tăng. Đo bản sao trước khi sửa: phiếu chi 12 → 25 câu (5 → 8 dòng), phiếu thu
15 → 24 — mỗi dòng tự SELECT users cho tên người lập / người chi / người huỷ, SELECT orders cho mã
đơn, SELECT dòng đợt giao của đơn mua.

Dữ liệu dựng thẳng bằng ORM: mỗi phiếu một người lập + một người chi KHÁC nhau (fixture chỉ có admin,
admin nằm sẵn trong phiên nên tra tên không tốn câu nào và che mất lỗi).
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime

import pytest
from sqlalchemy import event

from app.db import SessionLocal, engine
from app.models.accounting import (
    PAYMENT_RECEIPT_RECEIVED,
    PAYMENT_VOUCHER_PAID,
    VOUCHER_CASH,
    VOUCHER_SOURCE_PURCHASE,
    PaymentReceipt,
    PaymentVoucher,
)
from app.models.order import Order
from app.models.purchase import (
    PR_APPROVED,
    PurchaseDelivery,
    PurchaseDeliveryLine,
    PurchaseRequest,
    PurchaseRequestLine,
)
from app.models.user import User


@pytest.fixture
def h(client, seed_credentials) -> dict[str, str]:
    tok = client.post("/api/auth/login", json=seed_credentials).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


@contextmanager
def dem_sql():
    dem = {"n": 0}

    def _nghe(*_a, **_k):
        dem["n"] += 1

    event.listen(engine, "before_cursor_execute", _nghe)
    try:
        yield dem
    finally:
        event.remove(engine, "before_cursor_execute", _nghe)


def _so_cau(client, h, url: str) -> int:
    with dem_sql() as d:
        r = client.get(url, headers=h)
    assert r.status_code == 200, r.text
    return d["n"]


def _nguoi(db, ma: str) -> User:
    u = User(username=ma, name=f"Nguoi {ma}", password_hash="x")
    db.add(u)
    db.flush()
    return u


def _phieu_chi(n: int, tt: str) -> None:
    """n phiếu chi đã chi — mỗi phiếu trả một đợt giao của một đơn mua riêng, kèm một đơn bán
    riêng; người lập / người chi khác nhau từng phiếu."""
    db = SessionLocal()
    try:
        for i in range(n):
            lap, chi = _nguoi(db, f"pc_lap_{tt}{i}"), _nguoi(db, f"pc_chi_{tt}{i}")
            don = PurchaseRequest(code=f"PMH-{tt}{i}", status=PR_APPROVED, purpose="do",
                                  created_by_user_id=lap.id, approved_at=datetime.now())
            db.add(don)
            db.flush()
            dong = PurchaseRequestLine(purchase_request_id=don.id, item_name=f"Hang {tt}{i}", unit="kg",
                                       quantity=10, expected_unit_price=1000)
            db.add(dong)
            db.flush()
            dot = PurchaseDelivery(purchase_request_id=don.id, seq_no=1, delivery_date=date.today(),
                                   created_by_user_id=lap.id)
            db.add(dot)
            db.flush()
            db.add(PurchaseDeliveryLine(delivery_id=dot.id, purchase_request_line_id=dong.id, quantity=10))
            ban = Order(order_no=f"DB-{tt}{i}")
            db.add(ban)
            db.flush()
            db.add(PaymentVoucher(
                code=f"PC-{tt}{i}", voucher_type=VOUCHER_CASH, payment_stage="payment",
                source_type=VOUCHER_SOURCE_PURCHASE, purchase_request_id=don.id, delivery_id=dot.id,
                order_id=ban.id, status=PAYMENT_VOUCHER_PAID, voucher_date=date.today(),
                amount=5000, amount_vnd=5000, content="do", source_code_snapshot=don.code,
                supplier_name_snapshot="NCC do", created_by_user_id=lap.id, paid_by_user_id=chi.id,
                paid_at=datetime.now(),
            ))
        db.commit()
    finally:
        db.close()


def _phieu_thu(n: int, tt: str) -> None:
    db = SessionLocal()
    try:
        for i in range(n):
            lap, thu = _nguoi(db, f"pt_lap_{tt}{i}"), _nguoi(db, f"pt_thu_{tt}{i}")
            db.add(PaymentReceipt(
                code=f"PT-{tt}{i}", payer_name=f"Khach {tt}{i}", receipt_method=VOUCHER_CASH,
                source_type="other", status=PAYMENT_RECEIPT_RECEIVED, receipt_date=date.today(),
                amount=7000, amount_vnd=7000, content="do", created_by_user_id=lap.id,
                received_by_user_id=thu.id,
            ))
        db.commit()
    finally:
        db.close()


def test_phieu_chi_khong_hoi_db_tung_dong(client, h):
    url = "/api/accounting/payment-vouchers?size=50"
    _phieu_chi(2, "a")
    it = _so_cau(client, h, url)
    _phieu_chi(8, "b")
    nhieu = _so_cau(client, h, url)
    items = client.get(url, headers=h).json()["items"]
    assert len(items) == 10
    mot = next(x for x in items if x["code"] == "PC-b3")
    assert mot["created_by_name"] == "Nguoi pc_lap_b3"
    assert mot["paid_by_name"] == "Nguoi pc_chi_b3"
    assert mot["order_code"] == "DB-b3"
    assert mot["purchase_created_by_name"] == "Nguoi pc_lap_b3"
    assert mot["delivery_seq_no"] == 1
    print("\nPHIEU CHI (2 -> 10 dong):", it, nhieu)
    assert nhieu <= it + 2, f"{url}: {it} -> {nhieu} câu khi tăng số dòng"


def test_phieu_thu_khong_hoi_db_tung_dong(client, h):
    url = "/api/accounting/payment-receipts?size=50"
    _phieu_thu(2, "a")
    it = _so_cau(client, h, url)
    _phieu_thu(8, "b")
    nhieu = _so_cau(client, h, url)
    items = client.get(url, headers=h).json()["items"]
    assert len(items) == 10
    mot = next(x for x in items if x["code"] == "PT-b5")
    assert mot["created_by_name"] == "Nguoi pt_lap_b5"
    assert mot["received_by_name"] == "Nguoi pt_thu_b5"
    print("\nPHIEU THU (2 -> 10 dong):", it, nhieu)
    assert nhieu <= it + 2, f"{url}: {it} -> {nhieu} câu khi tăng số dòng"


def _khach_no(client, h, n: int, tt: str) -> None:
    """n khách, mỗi khách một sale phụ trách riêng + một hoá đơn đã phát hành còn nợ."""
    from tests.test_ke_toan_cong_no_theo_ky import _invoice_payload, _sales_order, _user_id

    for i in range(n):
        sale = _user_id(f"sale_{tt}{i}")
        order_id, _kh = _sales_order(total=100_000 + i, suffix=f"{tt}{i}", sale_user_id=sale)
        r = client.post("/api/accounting/sales-invoices",
                        json=_invoice_payload(order_id, number=f"{tt.upper()}{i:05d}"), headers=h)
        assert r.status_code == 201, r.text
        # Khách trả một phần; phiếu thu do một người lập riêng.
        pt = client.post(f"/api/accounting/sales-invoices/{r.json()['id']}/receipts", json={
            "payer_name": f"Khach {tt}{i}", "receipt_method": "cash",
            "receipt_date": date.today().isoformat(), "amount": 1000, "content": "tra mot phan",
        }, headers=h)
        assert pt.status_code == 201, pt.text
        db = SessionLocal()
        try:
            phieu = db.get(PaymentReceipt, pt.json()["id"])
            phieu.created_by_user_id = _nguoi(db, f"pt_kh_{tt}{i}").id
            db.commit()
        finally:
            db.close()


def test_cong_no_phai_thu_khong_hoi_db_tung_dong(client, h):
    """Tên sale phụ trách: nạp một lượt cho cả trang (bản sao: mỗi sale một SELECT users)."""
    url = "/api/accounting/receivables?size=50"
    _khach_no(client, h, 2, "a")
    it = _so_cau(client, h, url)
    _khach_no(client, h, 8, "b")
    nhieu = _so_cau(client, h, url)
    items = client.get(url, headers=h).json()["items"]
    assert len(items) == 10
    mot = next(x for x in items if x["customer_name"] == "Khach ky b4")
    assert mot["sale_user_name"] == "sale_b4"
    print("\nPHAI THU (2 -> 10 khach):", it, nhieu)
    assert nhieu <= it + 2, f"{url}: {it} -> {nhieu} câu khi tăng số dòng"
