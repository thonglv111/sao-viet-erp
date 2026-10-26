"""Kê giá ở báo giá + đơn (20/10/2026) — spec 2026-10-19-ke-gia-va-chi-chiet-khau-design.md.

Giá bán = vốn + chiết khấu + lợi nhuận (markup KHÔNG nhân lên kê); giá bán sau kê = giá bán + kê;
đơn giá, VAT, thành tiền tính trên giá bán sau kê. Sửa markup giữ nguyên SỐ TIỀN kê.
"""
from __future__ import annotations

from app.models.quotation import STATUS_ACCEPTED, Quote, QuoteItem, QuoteVersion
from app.schemas.order import OrderCreate
from app.services.quotation_service import QuotationService
from tests.test_orders_api import admin, customer, db, svc  # noqa: F401 (fixture)
from tests.test_quotation_approval import _h, _quote, _seed_ptg, _token


def test_calculate_pricing_ke_sau_gia_ban():
    p = QuotationService.calculate_pricing(total_cost=800, margin_percent=25, ke_gia=500,
                                           vat_percent=10, quantity=10)
    assert p["selling_price"] == 1000            # markup trên vốn, không đụng kê
    assert p["gia_sau_ke"] == 1500
    assert p["unit_price"] == 150
    assert p["vat_amount"] == 150
    assert p["final_amount"] == 1650


def _bg(client, t, qid):
    return client.get(f"/api/quotations/{qid}", headers=_h(t)).json()


def _put(client, t, qid, item):
    r = client.put(f"/api/quotations/{qid}", json={"items": [item]}, headers=_h(t))
    assert r.status_code == 200, r.text
    return _bg(client, t, qid)


def test_sua_markup_giu_so_tien_ke_va_tong_gom_ke(client):
    t = _token(client)
    pid = _seed_ptg(gia_von_tp=10_000_000)
    q = client.post("/api/quotations", json={"phieu_tinh_gia_id": pid}, headers=_h(t)).json()
    iid = q["items"][0]["id"]
    d = _put(client, t, q["id"], {"id": iid, "margin_percent": 20, "ke_gia": 5_000_000})
    it = d["items"][0]
    assert (round(it["selling_price"]), round(it["ke_gia"]), round(it["gia_sau_ke"])) == (
        12_000_000, 5_000_000, 17_000_000)
    assert round(it["vat_amount"]) == round(17_000_000 * it["vat_percent"] / 100)
    assert round(d["subtotal_amount"]) == 17_000_000 and round(d["ke_gia_amount"]) == 5_000_000
    assert round(d["total"]) == 17_000_000 * (100 + round(it["vat_percent"])) // 100
    # Sửa markup, không gửi kê ⇒ kê giữ số tiền, giá sau kê đổi theo giá bán mới.
    d = _put(client, t, q["id"], {"id": iid, "margin_percent": 30})
    it = d["items"][0]
    assert (round(it["selling_price"]), round(it["ke_gia"]), round(it["gia_sau_ke"])) == (
        13_000_000, 5_000_000, 18_000_000)
    assert d["markup_pct"] == 30                  # kê không làm đẹp markup


def test_ke_theo_phan_tram_tinh_tren_gia_ban(client):
    t = _token(client)
    pid = _seed_ptg(gia_von_tp=10_000_000)
    q = client.post("/api/quotations", json={"phieu_tinh_gia_id": pid}, headers=_h(t)).json()
    d = _put(client, t, q["id"], {"id": q["items"][0]["id"], "margin_percent": 20, "ke_percent": 50})
    assert round(d["items"][0]["ke_gia"]) == 6_000_000


def test_ke_ngoai_rao_phai_trinh_duyet(client):
    t = _token(client)
    cid = client.post("/api/customers", json={"name": "KH Rào Kê"}, headers=_h(t)).json()["customer"]["id"]
    r = client.put(f"/api/customers/{cid}/financial", headers=_h(t),
                   json={"credit_limit": 0, "ke_min_pct": 5, "ke_max_pct": 10})
    assert r.status_code == 200, r.text
    q = _quote(client, t, customer_id=cid, markup=20)
    iid = q["items"][0]["id"]
    d = _put(client, t, q["id"], {"id": iid, "margin_percent": 20, "ke_percent": 50})
    assert d["exception_required"] is True
    assert {e["key"] for e in d["exceptions"]} == {"ke_out"}
    d = _put(client, t, q["id"], {"id": iid, "margin_percent": 20, "ke_percent": 8})
    assert d["exception_required"] is False
    # Rào min đặt mà kê 0 ⇒ dưới sàn.
    d = _put(client, t, q["id"], {"id": iid, "margin_percent": 20, "ke_gia": 0})
    assert {e["key"] for e in d["exceptions"]} == {"ke_out"}


def test_don_chep_ke_tu_bao_gia(svc, admin, customer, db):
    q = Quote(quote_number="BG-KE", customer_id=customer.id, status=STATUS_ACCEPTED)
    db.add(q)
    db.flush()
    v = QuoteVersion(quote_id=q.id, version_number=1, vat_percent=10)
    db.add(v)
    db.flush()
    q.current_version_id = v.id
    db.add(QuoteItem(
        quote_version_id=v.id, line_no=1, product_type="tr", product_name="SP", quantity=100, unit="cái",
        total_cost_snapshot=800_000, margin_percent=25, selling_price=1_000_000, ke_gia=500_000,
        discount_amount=0, unit_price=15_000, vat_percent=10, vat_amount=150_000, final_amount=1_650_000,
    ))
    db.commit()
    d = svc.create(actor=admin, scope="all", payload=OrderCreate(quotation_id=q.id))
    assert (d.total, d.total_with_vat) == (1_500_000, 1_650_000)
    from app.models.order import OrderLine

    ln = db.query(OrderLine).filter(OrderLine.order_id == d.id).one()
    assert (ln.line_total, ln.ke_gia, ln.unit_price_snapshot) == (1_500_000, 500_000, 15_000)
