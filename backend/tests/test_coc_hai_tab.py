"""Cọc phải thu nhập % hoặc SỐ TIỀN (20/10/2026) + cột mới của mg 0427/0428 + thuế TNDN trên kê ở khách.

Spec: docs/superpowers/specs/2026-10-19-ke-gia-va-chi-chiet-khau-design.md.
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.schemas.order import OrderCreate, OrderUpdate
from app.services.coc import coc_phai_thu
from app.services.order_service import OrderValidationError
from tests.test_orders_api import _accepted_quote, admin, customer, db, svc  # noqa: F401 (fixture)


def test_coc_phai_thu_uu_tien_so_tien():
    assert coc_phai_thu(30, None, 16_500_000) == 4_950_000
    assert coc_phai_thu(None, 5_000_000, 16_500_000) == 5_000_000
    assert coc_phai_thu(30, 5_000_000, 16_500_000) == 5_000_000
    assert coc_phai_thu(None, None, 16_500_000) == 0


def test_luu_coc_so_tien_xoa_pct(svc, admin, customer, db):
    q = _accepted_quote(db, customer)
    d = svc.create(actor=admin, scope="all", payload=OrderCreate(quotation_id=q.id, deposit_pct=50))
    assert d.deposit_required == 486_000
    d = svc.update(order_id=d.id, actor=admin, scope="all", payload=OrderUpdate(deposit_amount=100_000))
    assert (d.deposit_pct, d.deposit_amount, d.deposit_required) == (None, 100_000, 100_000)
    # Gõ lại % ⇒ số tiền bị xoá.
    d = svc.update(order_id=d.id, actor=admin, scope="all", payload=OrderUpdate(deposit_pct=10))
    assert (d.deposit_pct, d.deposit_amount, d.deposit_required) == (10, None, 97_200)


def test_luu_coc_so_tien_vuot_gia_tri_don_bi_chan(svc, admin, customer, db):
    q = _accepted_quote(db, customer)
    d = svc.create(actor=admin, scope="all", payload=OrderCreate(quotation_id=q.id))
    with pytest.raises(OrderValidationError, match="vượt giá trị đơn"):
        svc.update(order_id=d.id, actor=admin, scope="all", payload=OrderUpdate(deposit_amount=972_001))
    d = svc.update(order_id=d.id, actor=admin, scope="all", payload=OrderUpdate(deposit_amount=972_000))
    assert d.deposit_required == 972_000


def test_khach_moi_thue_tndn_tren_ke_mac_dinh_20(client):
    from tests.test_customers_api import _admin_token, _h  # noqa: PLC0415

    h = _h(_admin_token(client))
    kh = client.post("/api/customers", headers=h, json={"name": "Khách kê"}).json()["customer"]
    assert kh["ke_thue_tndn_pct"] == 20
    url = f"/api/customers/{kh['id']}/financial"
    r = client.put(url, headers=h, json={"credit_limit": 0, "ke_min_pct": 10, "ke_max_pct": 5})
    assert r.status_code == 422, r.text
    r = client.put(url, headers=h, json={"credit_limit": 0, "ke_thue_tndn_pct": 25,
                                         "ke_min_pct": 0, "ke_max_pct": 60})
    assert r.status_code == 200, r.text
    j = r.json()["customer"]
    assert (j["ke_thue_tndn_pct"], j["ke_min_pct"], j["ke_max_pct"]) == (25, 0, 60)


def _db_cu():
    """SQLite trắng dựng bảng kiểu CŨ (trước 0427/0428) bằng SQL thô."""
    eng = create_engine("sqlite://")
    with eng.begin() as c:
        for sql in (
            "CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR(50))",
            "CREATE TABLE quote_items (id INTEGER PRIMARY KEY)",
            "CREATE TABLE quote_versions (id INTEGER PRIMARY KEY)",
            "CREATE TABLE orders (id INTEGER PRIMARY KEY)",
            "CREATE TABLE order_lines (id INTEGER PRIMARY KEY, order_id INTEGER, line_total INTEGER,"
            " vat_pct_estimate INTEGER, chiet_khau BIGINT)",
            "CREATE TABLE payment_vouchers (id INTEGER PRIMARY KEY)",
            "CREATE TABLE sales_invoices (id INTEGER PRIMARY KEY, order_id INTEGER, amount_vnd BIGINT,"
            " status VARCHAR(16))",
            "CREATE TABLE sales_invoice_adjustments (id INTEGER PRIMARY KEY)",
            "INSERT INTO customers (id, name) VALUES (1, 'cũ')",
            # Đơn 15.000.000 trước VAT (CK 1.000.000), VAT 10% ⇒ 16.500.000; hóa đơn nửa đơn.
            "INSERT INTO order_lines VALUES (1, 7, 15000000, 10, 1000000)",
            "INSERT INTO sales_invoices VALUES (1, 7, 8250000, 'issued')",
        ):
            c.execute(text(sql))
    return eng


def test_migration_0427_0428_idempotent():
    from app.db_migrations import (
        MIGRATIONS,
        _migrate_bo_hoa_don_dieu_chinh,
        _migrate_ke_gia_chi_ck,
    )

    eng = _db_cu()
    s = sessionmaker(bind=eng)()
    for _ in range(2):
        _migrate_bo_hoa_don_dieu_chinh(s)
        _migrate_ke_gia_chi_ck(s)
    insp = inspect(eng)
    bang = set(insp.get_table_names())
    assert "sales_invoice_adjustments" not in bang and "phieu_chi_ck_ke" in bang
    cot = {c["name"] for c in insp.get_columns("sales_invoices")}
    assert {"chiet_khau", "ke_gia", "ke_thue_tndn_pct", "ke_thue_tndn"} <= cot
    assert "deposit_amount" in {c["name"] for c in insp.get_columns("orders")}
    assert s.execute(text("SELECT ke_thue_tndn_pct FROM customers")).scalar() == 20
    assert s.execute(text("SELECT chiet_khau FROM sales_invoices")).scalar() == 500_000
    ids = [m[0] for m in MIGRATIONS]
    assert ids.index("0427_bo_hoa_don_dieu_chinh") < ids.index("0428_ke_gia_chi_ck")
