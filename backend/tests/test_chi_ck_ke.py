"""Chiết khấu / kê đi theo hóa đơn, chi lại khi hóa đơn thu đủ (20/10/2026).

Spec: docs/superpowers/specs/2026-10-19-ke-gia-va-chi-chiet-khau-design.md.
Đơn mẫu: 100 cái, trước VAT 15.000.000 (gồm CK 1.000.000 và kê 5.000.000), VAT 10% ⇒ 16.500.000;
khách thuế TNDN trên kê 20% ⇒ kê chi lại 4.000.000.
"""
from __future__ import annotations

from app.db import SessionLocal
from app.models.accounting import PaymentVoucher
from app.models.customer import Customer
from app.models.module_notification import ModuleNotification
from app.models.order import STATUS_ORDERED, Order, OrderLine
from app.services.accounting_service import _business_today as _hom_nay
from tests.giao_hang_fixtures import giao_het
from tests.test_sales_invoices_api import _add_deposit, _headers

URL_CHO = "/api/accounting/ck-ke-cho-chi"
URL_PC = "/api/accounting/payment-vouchers/ck-ke"


def _don(suffix: str = "01", *, ck: int = 1_000_000, ke: int = 5_000_000) -> tuple[int, int, int]:
    db = SessionLocal()
    try:
        kh = Customer(code=f"KH-CK-{suffix}", name=f"Khách CK {suffix}", payment_term_days=30,
                      ke_thue_tndn_pct=20)
        db.add(kh)
        db.flush()
        don = Order(order_no=f"DH-CK-{suffix}", customer_id=kh.id, status=STATUS_ORDERED)
        don.lines.append(OrderLine(description="Hộp", qty=100, don_vi_tinh="cái", line_total=15_000_000,
                                   vat_pct_estimate=10, chiet_khau=ck, ke_gia=ke))
        db.add(don)
        db.commit()
        return don.id, kh.id, don.lines[0].id
    finally:
        db.close()


def _hoa_don(client, h, order_id: int, so: str, *, trip: int | None = None, amount: int | None = None):
    body = {"order_id": order_id, "delivery_trip_id": trip or giao_het(order_id),
            "invoice_symbol": "1C26TCK", "invoice_number": so, "invoice_date": _hom_nay().isoformat()}
    if amount is not None:
        body["amount_vnd"] = amount
    r = client.post("/api/accounting/sales-invoices", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _thu(client, h, inv: dict, so: int | None = None):
    r = client.post(f"/api/accounting/sales-invoices/{inv['id']}/receipts", headers=h, json={
        "payer_name": "Khách", "receipt_method": "cash", "receipt_date": _hom_nay().isoformat(),
        "amount": so if so is not None else inv["remaining_amount"], "content": "Thu tiền hàng"})
    assert r.status_code == 201, r.text


def _cho(client, h) -> list[dict]:
    r = client.get(URL_CHO, headers=h)
    assert r.status_code == 200, r.text
    return r.json()["items"]


def _phieu(loai: str, dong: list[dict], **them) -> dict:
    return {"loai": loai, "dong": dong, "voucher_type": "cash", "voucher_date": _hom_nay().isoformat(),
            **them}


def test_ghi_hoa_don_chup_ck_ke_va_thue(client):
    h = _headers(client)
    oid, _, _ = _don()
    inv = _hoa_don(client, h, oid, "CK0001")
    assert inv["amount_vnd"] == 16_500_000
    assert (inv["chiet_khau"], inv["ke_gia"], inv["ke_thue_tndn_pct"], inv["ke_thue_tndn"]) == (
        1_000_000, 5_000_000, 20, 1_000_000)


def test_hai_luot_tong_khop_don(client):
    h = _headers(client)
    oid, _, lid = _don("02")
    a = _hoa_don(client, h, oid, "CK0002", trip=giao_het(oid, {lid: 50}))
    b = _hoa_don(client, h, oid, "CK0003", trip=giao_het(oid, {lid: 50}))
    assert (a["chiet_khau"], a["ke_gia"]) == (500_000, 2_500_000)
    assert (b["chiet_khau"], b["ke_gia"]) == (500_000, 2_500_000)


def test_hoa_don_le_tien_hoa_don_cuoi_nhan_phan_con_lai(client):
    h = _headers(client)
    oid, _, lid = _don("03", ck=1_000_001)
    a = _hoa_don(client, h, oid, "CK0004", trip=giao_het(oid, {lid: 33}))
    b = _hoa_don(client, h, oid, "CK0005", trip=giao_het(oid, {lid: 67}))
    assert a["chiet_khau"] + b["chiet_khau"] == 1_000_001
    assert a["ke_gia"] + b["ke_gia"] == 5_000_000


def test_chua_het_no_chua_vao_hang_cho(client):
    h = _headers(client)
    oid, _, _ = _don("04")
    inv = _hoa_don(client, h, oid, "CK0006")
    _thu(client, h, inv, 16_000_000)
    assert [r for r in _cho(client, h) if r["sales_invoice_id"] == inv["id"]] == []


def test_coc_phu_tron_hoa_don_vao_hang_cho_ngay(client):
    h = _headers(client)
    oid, _, lid = _don("05")
    _add_deposit(oid, 9_000_000)
    inv = _hoa_don(client, h, oid, "CK0007", trip=giao_het(oid, {lid: 50}))
    assert inv["remaining_amount"] == 0
    assert {r["loai"] for r in _cho(client, h) if r["sales_invoice_id"] == inv["id"]} == {
        "chiet_khau", "ke_gia"}


def test_thu_du_sinh_hai_dong_cho_chi(client):
    h = _headers(client)
    oid, _, _ = _don("06")
    inv = _hoa_don(client, h, oid, "CK0008")
    _thu(client, h, inv)
    dong = {r["loai"]: r for r in _cho(client, h) if r["sales_invoice_id"] == inv["id"]}
    assert (dong["chiet_khau"]["con"], dong["ke_gia"]["con"]) == (1_000_000, 4_000_000)
    assert (dong["ke_gia"]["tien"], dong["ke_gia"]["thue_tndn"]) == (5_000_000, 1_000_000)


def test_lap_phieu_chi_ke_rung_hang_cho(client):
    h = _headers(client)
    oid, _, _ = _don("07")
    inv = _hoa_don(client, h, oid, "CK0009")
    _thu(client, h, inv)
    r = client.post(URL_PC, headers=h, json=_phieu(
        "ke_gia", [{"sales_invoice_id": inv["id"], "amount": 4_000_000}], cash_recipient_name="Anh Nam"))
    assert r.status_code == 201, r.text
    pc = r.json()
    assert (pc["source_type"], pc["amount_vnd"], pc["muc_thu_chi_ten"]) == (
        "chi_ke_gia", 4_000_000, "Chi kê trả khách")
    assert {r["loai"] for r in _cho(client, h) if r["sales_invoice_id"] == inv["id"]} == {"chiet_khau"}
    db = SessionLocal()
    try:
        v = db.get(PaymentVoucher, pc["id"])
        assert (v.order_id, v.customer_id) == (None, None)   # không nuôi quỹ cọc / sổ 131
    finally:
        db.close()
    # Chiết khấu: người nhận khoá theo tên khách, payload gửi tên khác cũng bỏ.
    r = client.post(URL_PC, headers=h, json=_phieu(
        "chiet_khau", [{"sales_invoice_id": inv["id"], "amount": 1_000_000}], cash_recipient_name="Ai đó"))
    assert r.status_code == 201, r.text
    assert r.json()["cash_recipient_name"] == "Khách CK 07"
    out = client.get("/api/accounting/sales-invoices", params={"order_id": oid}, headers=h)
    assert out.status_code == 200, out.text
    it = next(i for i in out.json()["items"] if i["id"] == inv["id"])
    assert (it["ck_da_chi"], it["ke_da_chi"]) == (1_000_000, 4_000_000)


def test_chi_vuot_con_bi_chan(client):
    h = _headers(client)
    oid, _, _ = _don("08")
    inv = _hoa_don(client, h, oid, "CK0010")
    _thu(client, h, inv)
    r = client.post(URL_PC, headers=h, json=_phieu(
        "ke_gia", [{"sales_invoice_id": inv["id"], "amount": 4_000_001}], cash_recipient_name="X"))
    assert r.status_code == 422, r.text
    # Chưa thu đủ thì chưa chi được.
    oid2, _, _ = _don("09")
    inv2 = _hoa_don(client, h, oid2, "CK0011")
    r = client.post(URL_PC, headers=h, json=_phieu(
        "chiet_khau", [{"sales_invoice_id": inv2["id"], "amount": 1}]))
    assert r.status_code == 422, r.text


def test_tron_hai_khach_bi_chan(client):
    h = _headers(client)
    a_oid, _, _ = _don("10")
    b_oid, _, _ = _don("11")
    a = _hoa_don(client, h, a_oid, "CK0012")
    b = _hoa_don(client, h, b_oid, "CK0013")
    _thu(client, h, a)
    _thu(client, h, b)
    r = client.post(URL_PC, headers=h, json=_phieu("chiet_khau", [
        {"sales_invoice_id": a["id"], "amount": 1_000_000},
        {"sales_invoice_id": b["id"], "amount": 1_000_000}]))
    assert r.status_code == 422, r.text
    assert "cùng một khách" in r.text


def test_huy_phieu_chi_khoan_quay_lai_va_chan_huy_hoa_don(client):
    h = _headers(client)
    oid, _, _ = _don("12")
    inv = _hoa_don(client, h, oid, "CK0014")
    _thu(client, h, inv)
    pc = client.post(URL_PC, headers=h, json=_phieu(
        "chiet_khau", [{"sales_invoice_id": inv["id"], "amount": 1_000_000}])).json()
    r = client.post(f"/api/accounting/sales-invoices/{inv['id']}/cancel", headers=h,
                    json={"reason": "Ghi nhầm"})
    assert r.status_code == 409, r.text
    assert "phiếu chi chiết khấu/kê" in r.text
    r = client.post(f"/api/accounting/payment-vouchers/{pc['id']}/cancel", headers=h,
                    json={"reason": "Chi nhầm"})
    assert r.status_code == 200, r.text
    assert "chiet_khau" in {r["loai"] for r in _cho(client, h) if r["sales_invoice_id"] == inv["id"]}


def test_thu_du_bao_phieu_chi(client):
    h = _headers(client)
    oid, _, _ = _don("13")
    inv = _hoa_don(client, h, oid, "CK0015")
    _thu(client, h, inv)
    db = SessionLocal()
    try:
        so = db.query(ModuleNotification).filter(
            ModuleNotification.channel == "phieu_chi", ModuleNotification.event_type == "ck_ke_cho_chi",
            ModuleNotification.source_code == "CK0015").count()
    finally:
        db.close()
    assert so == 1
