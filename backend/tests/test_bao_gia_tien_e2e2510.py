"""Báo giá, đơn bán, tiền (bấm thử 25/10/2026, Đợt 8)."""
from __future__ import annotations

from tests.test_orders_api import admin, customer, db, svc  # noqa: F401 — fixture
from tests.test_quotation_from_ptg import _h, _seed_ptg, _token


def test_gia_go_tay_markup_tren_999_bao_422_giu_gia_cu(client):
    """L-VAI-27: giá gõ tay 10.000.002 trên vốn 105.786 ra markup ~9.353 % → 422 kèm câu."""
    h = _h(_token(client))
    pid = _seed_ptg(products=[("Tờ rơi PV27", 1_000, 105_786)])
    q = client.post("/api/quotations", json={"phieu_tinh_gia_id": pid}, headers=h).json()
    it = q["items"][0]
    r = client.put(f"/api/quotations/{q['id']}", json={"items": [
        {"id": it["id"], "margin_percent": it["margin_percent"], "manual_selling_price": 10_000_002}]},
        headers=h)
    assert r.status_code == 422 and "999,99" in r.text, r.text
    sau = client.get(f"/api/quotations/{q['id']}", headers=h).json()["items"][0]
    assert sau["selling_price"] == it["selling_price"]


def test_tao_bao_gia_tu_phieu_tong_cung_phep_tinh_voi_lan_sua(client):
    """L-VAI-32: tổng lúc tạo = tổng sau một lần lưu không đổi gì (VAT sàn trên tổng)."""
    h = _h(_token(client))
    pid = _seed_ptg(products=[("Ruột PV32", 1, 5), ("Bìa PV32", 1, 5)])
    q = client.post("/api/quotations", json={"phieu_tinh_gia_id": pid}, headers=h).json()
    tao = q["total"]
    its = q["items"]
    ban = sum(round(i["selling_price"]) for i in its)
    vat = round(its[0]["vat_percent"])
    assert tao == ban * (100 + vat) // 100
    r = client.put(f"/api/quotations/{q['id']}", json={"items": [
        {"id": i["id"], "margin_percent": i["margin_percent"], "vat_percent": i["vat_percent"]} for i in its]},
        headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["total"] == tao


def test_ke_dung_tran_lam_tron_len_1d_khong_bi_rao():
    """L-VAI-30: kê 10 % trên giá lẻ 1.000.015 ⇒ 100.002 (làm tròn lên 1 đ) — không bắt trình duyệt."""
    from app.services.exception_gate import EXC_KE_OUT, evaluate_quote

    def keys(ke):
        r = evaluate_quote(subtotal=1_000_015, total_gross=1_100_017, cost=800_000, ke_amount=ke,
                           ke_lines=[{"ten": "SP", "ban": 1_000_015, "ke": ke, "n": 1}], ke_max_pct=10)
        return {t["key"] for t in r["triggers"]}

    assert EXC_KE_OUT not in keys(100_002)
    assert EXC_KE_OUT in keys(100_010)



def test_dat_coc_ve_0_thi_het_coc(svc, admin, customer, db):
    """L-VAI-34: đơn cọc 30 %, gửi deposit_amount=0 → không còn cọc."""
    from app.models.order import Order
    from app.schemas.order import OrderCreate, OrderUpdate
    from app.services.coc import co_coc
    from tests.test_orders_api import _accepted_quote

    q = _accepted_quote(db, customer)
    d = svc.create(actor=admin, scope="all",
                   payload=OrderCreate(source_type="bao_gia", quotation_id=q.id, deposit_pct=30))
    svc.update(order_id=d.id, actor=admin, scope="all", payload=OrderUpdate(deposit_amount=0))
    o = db.get(Order, d.id)
    db.refresh(o)
    assert not co_coc(o), (o.deposit_pct, o.deposit_amount)


def test_coc_vuot_tong_don_chua_hoa_don_la_coc_vuot(client):
    """L-VAI-37: cọc 170.000 > đơn 160.582, chưa ghi hoá đơn → `coc_vuot`, còn lại 9.418."""
    from tests.test_ban_hang_cho_thu_chi import _dong_tra
    from tests.test_sales_invoices_api import _add_deposit, _headers, _sales_order

    h = _headers(client)
    don, _ = _sales_order(total=160_582, suffix="PV37")
    _add_deposit(don, 170_000)
    d = _dong_tra(client, h, don)
    assert d is not None and d["con_lai"] == 9_418, d
    assert d["tinh_trang"] == "coc_vuot"


def _phieu_thu_cua_hd(inv_id: int) -> int:
    from app.db import SessionLocal
    from app.models.accounting import PaymentReceiptLine

    db = SessionLocal()
    try:
        return db.query(PaymentReceiptLine).filter(
            PaymentReceiptLine.sales_invoice_id == inv_id).order_by(
            PaymentReceiptLine.id.desc()).first().payment_receipt_id
    finally:
        db.close()


def test_huy_phieu_thu_bi_chan_khi_hoa_don_da_chi_ck_roi_duoc_sau_khi_huy_phieu_chi(client):
    """L-VAI-35: HĐ thu đủ → chi CK → huỷ phiếu thu ⇒ 409; huỷ phiếu chi CK trước thì huỷ được."""
    from tests.test_chi_ck_ke import URL_PC, _don, _hoa_don, _phieu, _thu
    from tests.test_sales_invoices_api import _headers

    h = _headers(client)
    oid, _, _ = _don("PV35")
    inv = _hoa_don(client, h, oid, "PV35001")
    _thu(client, h, inv)
    pt = _phieu_thu_cua_hd(inv["id"])
    pc = client.post(URL_PC, headers=h, json=_phieu(
        "chiet_khau", [{"sales_invoice_id": inv["id"], "amount": 1_000_000}])).json()
    r = client.post(f"/api/accounting/payment-receipts/{pt}/cancel", headers=h, json={"reason": "Gõ nhầm"})
    assert r.status_code == 409 and "PV35001" in r.text, r.text
    assert client.post(f"/api/accounting/payment-vouchers/{pc['id']}/cancel", headers=h,
                       json={"reason": "Chi nhầm"}).status_code == 200
    r = client.post(f"/api/accounting/payment-receipts/{pt}/cancel", headers=h, json={"reason": "Gõ nhầm"})
    assert r.status_code == 200, r.text


def test_don_huy_tra_lai_coc_khong_con_hoa_hong(client):
    """L-VAI-40: cọc của đơn đã huỷ không còn ra hoa hồng."""
    from app.db import SessionLocal
    from app.models.order import STATUS_CANCELLED, Order
    from tests.test_hoa_hong_kinh_doanh import _don, _sales, _thu, _tinh

    emp, uid = _sales("pv40")
    oid = _don("DH-PV40", uid, truoc_vat=100_000_000, vat_pct=8)
    _thu([(oid, None, 54_000_000)])
    assert _tinh(emp) > 0
    db = SessionLocal()
    try:
        db.get(Order, oid).status = STATUS_CANCELLED
        db.commit()
    finally:
        db.close()
    assert _tinh(emp) == 0


def test_thu_vuot_con_no_bao_so_dau_cham(client):
    """L-VAI-42: câu lỗi tiền in "1.000.000 đ", không in "1,000,000 đ"."""
    from tests.test_ban_hang_cho_thu_chi import _ghi_hd
    from tests.test_bao_cao_cong_no import _ngay
    from tests.test_sales_invoices_api import _headers, _sales_order

    h = _headers(client)
    don, _ = _sales_order(total=1_000_000, suffix="PV42")
    hd = _ghi_hd(client, h, don, "PV42-0001", 1_000_000)
    r = client.post(f"/api/accounting/sales-invoices/{hd['id']}/receipts", json={
        "payer_name": "Khách", "receipt_method": "cash", "receipt_date": _ngay(0),
        "amount": 1_500_000, "content": "Thu"}, headers=h)
    assert r.status_code in (400, 409, 422), r.text
    assert "1.000.000 đ" in r.text, r.text


def _khoa_ky_luong_thang_nay():
    from app.db import SessionLocal
    from app.models.payroll import PERIOD_LOCKED, PayrollPeriod
    from app.services.accounting_service import _business_today

    hn = _business_today()
    db = SessionLocal()
    try:
        db.add(PayrollPeriod(year=hn.year, month=hn.month, status=PERIOD_LOCKED))
        db.commit()
    finally:
        db.close()


def test_phieu_thu_don_co_sale_trong_ky_luong_da_chot_bi_chan(client):
    """L-SX-48: kỳ lương tháng này đã chốt ⇒ thu tiền hoá đơn của đơn có sale bị chặn; đơn không
    có sale vẫn thu được; huỷ phiếu thu của đơn có sale cũng bị chặn."""
    from app.db import SessionLocal
    from app.models.order import Order
    from app.models.user import User
    from tests.test_ban_hang_cho_thu_chi import _ghi_hd, _thu_hd
    from tests.test_bao_cao_cong_no import _ngay
    from tests.test_sales_invoices_api import _headers, _sales_order

    h = _headers(client)
    co_sale, _ = _sales_order(total=1_000_000, suffix="PV48a")
    khong_sale, _ = _sales_order(total=1_000_000, suffix="PV48b")
    hd1 = _ghi_hd(client, h, co_sale, "PV48-0001", 1_000_000)
    hd2 = _ghi_hd(client, h, khong_sale, "PV48-0002", 1_000_000)
    _thu_hd(client, h, hd1["id"], 300_000)          # thu khi kỳ còn mở
    db = SessionLocal()
    try:
        db.get(Order, co_sale).sale_user_id = db.query(User).filter(User.username == "admin").one().id
        db.commit()
    finally:
        db.close()
    pt = _phieu_thu_cua_hd(hd1["id"])
    _khoa_ky_luong_thang_nay()
    r = client.post(f"/api/accounting/sales-invoices/{hd1['id']}/receipts", json={
        "payer_name": "Khách", "receipt_method": "cash", "receipt_date": _ngay(0),
        "amount": 200_000, "content": "Thu"}, headers=h)
    assert r.status_code == 422 and "Kỳ lương" in r.text, r.text
    _thu_hd(client, h, hd2["id"], 200_000)
    r = client.post(f"/api/accounting/payment-receipts/{pt}/cancel", headers=h, json={"reason": "Nhầm"})
    assert r.status_code == 422 and "Kỳ lương" in r.text, r.text


def test_phieu_chi_ck_trong_ky_phai_thu_khoa_bi_chan(client):
    """L-SX-49: kỳ công nợ phải thu khoá ⇒ lập phiếu chi CK ngày trong kỳ bị chặn."""
    from tests.test_chi_ck_ke import URL_PC, _don, _hoa_don, _phieu, _thu
    from tests.test_khoa_ky_cong_no_chan_chung_tu import _bi_chan, _khoa
    from tests.test_sales_invoices_api import _headers

    h = _headers(client)
    oid, _, _ = _don("PV49")
    inv = _hoa_don(client, h, oid, "PV49001")
    _thu(client, h, inv)
    _khoa(client, h, "phai_thu")
    _bi_chan(client.post(URL_PC, headers=h, json=_phieu(
        "chiet_khau", [{"sales_invoice_id": inv["id"], "amount": 1_000_000}])))
