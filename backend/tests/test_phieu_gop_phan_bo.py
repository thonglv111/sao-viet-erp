"""Phiếu chi / phiếu thu GỘP nhiều chứng từ (chủ chốt 17/10/2026: "một phiếu cho cả lượt").

Bảng phân bổ `payment_voucher_lines` / `payment_receipt_lines` là nguồn DUY NHẤT cho "tiền của phiếu
đi vào chứng từ nào". Phiếu một chứng từ vẫn mang nguồn trên đầu phiếu và tự có đúng một dòng.
"""
from __future__ import annotations

from sqlalchemy import text

from app.db import SessionLocal
from app.models.accounting import PaymentReceipt, PaymentReceiptLine, PaymentVoucher, PaymentVoucherLine
from tests.test_payables_api import (
    _da_mua,
    _don,
    _dong_dau_tien,
    _ghi_dot,
    _headers,
    _phieu_chi,
    _supplier,
)
from tests.test_sales_invoices_api import _add_deposit, _invoice_payload, _sales_order
from tests.test_ban_hang_cho_thu_chi import _thu_hd


def _dong_chi(voucher_id: int) -> list[tuple]:
    db = SessionLocal()
    try:
        return [
            (l.purchase_request_id, l.delivery_id, l.amount_vnd)
            for l in db.query(PaymentVoucherLine).filter_by(payment_voucher_id=voucher_id).order_by(PaymentVoucherLine.id)
        ]
    finally:
        db.close()


def _dong_thu(receipt_id: int) -> list[tuple]:
    db = SessionLocal()
    try:
        return [
            (l.order_id, l.sales_invoice_id, l.amount_vnd)
            for l in db.query(PaymentReceiptLine).filter_by(payment_receipt_id=receipt_id).order_by(PaymentReceiptLine.id)
        ]
    finally:
        db.close()


# ---------------------------------------------------------------- Task 1: dòng mặc định


def test_phieu_chi_le_tu_co_dung_mot_dong(client):
    h = _headers(client)
    ncc = _supplier(client, h, name="NCC Gop Le")
    don = _don(client, h, ncc["id"], coc=500_000)
    coc = _phieu_chi(client, h, don["id"], 100_000)
    assert _dong_chi(coc["id"]) == [(don["id"], None, 100_000)]

    _da_mua(client, h, don["id"])
    sau = _ghi_dot(client, h, don["id"], lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 100}])
    dot = sau["deliveries"][0]["id"]
    tt = _phieu_chi(client, h, don["id"], 20_000, stage="final", delivery_id=dot)
    assert _dong_chi(tt["id"]) == [(don["id"], dot, 20_000)]


def test_phieu_thu_le_tu_co_dong_va_khach(client):
    h = _headers(client)
    don, kh = _sales_order(total=1_000_000, suffix="GL1")
    r = client.post("/api/accounting/sales-invoices", json=_invoice_payload(don, number="GL-1", amount=600_000), headers=h)
    assert r.status_code == 201, r.text
    pt = _thu_hd(client, h, r.json()["id"], 250_000)
    assert _dong_thu(pt["id"]) == [(don, r.json()["id"], 250_000)]

    _add_deposit(don, 100_000)
    db = SessionLocal()
    try:
        coc = db.query(PaymentReceipt).filter(PaymentReceipt.code == f"PT-DEPOSIT-{don}-100000").one()
        assert coc.customer_id == kh
        assert [(l.order_id, l.sales_invoice_id, l.amount_vnd) for l in coc.lines] == [(don, None, 100_000)]
        assert db.get(PaymentReceipt, pt["id"]).customer_id == kh
    finally:
        db.close()


def test_migration_dung_dong_cho_phieu_cu_va_chay_lai_khong_nhan(client):
    from app.db_migrations import _migrate_phieu_gop_phan_bo

    h = _headers(client)
    ncc = _supplier(client, h, name="NCC Gop Mig")
    don = _don(client, h, ncc["id"], coc=500_000)
    coc = _phieu_chi(client, h, don["id"], 300_000)
    don_ban, kh = _sales_order(total=1_000_000, suffix="GL2")
    _add_deposit(don_ban, 70_000)

    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM payment_voucher_lines"))
        db.execute(text("DELETE FROM payment_receipt_lines"))
        db.execute(text("UPDATE payment_receipts SET customer_id = NULL"))
        db.commit()
        _migrate_phieu_gop_phan_bo(db)
        _migrate_phieu_gop_phan_bo(db)
    finally:
        db.close()

    assert _dong_chi(coc["id"]) == [(don["id"], None, 300_000)]
    db = SessionLocal()
    try:
        pt = db.query(PaymentReceipt).filter(PaymentReceipt.order_id == don_ban).one()
        assert pt.customer_id == kh
        assert _dong_thu(pt.id) == [(don_ban, None, 70_000)]
    finally:
        db.close()


# ---------------------------------------------------------------- Task 2: phía chi đọc dòng


def _phieu_chi_gop_orm(supplier_id: int, dong: list[tuple[int, int | None, int]], *, ma: str = "PC-GOP-1") -> int:
    """Phiếu chi gộp dựng thẳng bằng ORM: đầu phiếu không nguồn, tiền nằm ở các dòng."""
    from datetime import datetime, timezone

    from app.models.user import User
    from tests.test_payables_api import _hom_nay

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").one()
        tong = sum(t for _, _, t in dong)
        v = PaymentVoucher(
            code=ma, doc_no=ma[-8:], source_type="purchase_request", purchase_request_id=None, delivery_id=None,
            supplier_id=supplier_id, voucher_type="cash", payment_stage="final", status="paid",
            voucher_date=_hom_nay(), amount=tong, amount_vnd=tong, currency="VND", exchange_rate=1,
            content="Trả gộp", source_code_snapshot="GOP", supplier_name_snapshot="NCC",
            cash_recipient_name="Lan", paid_at=datetime.now(timezone.utc), created_by_user_id=admin.id,
            paid_by_user_id=admin.id,
        )
        for pr, dot, tien in dong:
            v.lines.append(PaymentVoucherLine(purchase_request_id=pr, delivery_id=dot, amount_vnd=tien))
        db.add(v)
        db.commit()
        return v.id
    finally:
        db.close()


def _hai_don_cung_ncc(client, h, ten: str):
    ncc = _supplier(client, h, name=ten)
    a = _don(client, h, ncc["id"], coc=500_000)
    _da_mua(client, h, a["id"])
    a_dot = _ghi_dot(client, h, a["id"], lines=[{"purchase_request_line_id": _dong_dau_tien(a), "quantity": 100}])["deliveries"][0]["id"]
    b = _don(client, h, ncc["id"])
    _da_mua(client, h, b["id"])
    b_dot = _ghi_dot(client, h, b["id"], lines=[{"purchase_request_line_id": _dong_dau_tien(b), "quantity": 200}])["deliveries"][0]["id"]
    return ncc, a, a_dot, b, b_dot


def _don_mua(client, h, don_id: int) -> dict:
    r = client.get(f"/api/purchase-requests/{don_id}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_phieu_chi_gop_chia_tien_dung_tung_don_va_dot(client):
    h = _headers(client)
    ncc, a, a_dot, b, b_dot = _hai_don_cung_ncc(client, h, "NCC Gop Chia")
    # Đợt A 100 tờ = 220.000; đợt B 200 tờ = 440.000.
    vid = _phieu_chi_gop_orm(ncc["id"], [(a["id"], None, 100_000), (a["id"], a_dot, 50_000), (b["id"], b_dot, 300_000)])

    da = _don_mua(client, h, a["id"])
    assert da["net_paid"] == 150_000
    dot_a = da["deliveries"][0]
    assert (dot_a["paid_amount"], dot_a["coc_bu"], dot_a["con_no"]) == (50_000, 100_000, 70_000)
    assert [(p["voucher_id"], p["amount"], p["gop"]) for p in dot_a["phieu_chi"]] == [(vid, 50_000, True)]
    assert [(p["amount"]) for p in da["coc_da_lap"]] == [100_000]
    db_ = _don_mua(client, h, b["id"])
    assert (db_["deliveries"][0]["paid_amount"], db_["deliveries"][0]["con_no"]) == (300_000, 140_000)

    ct = client.get(f"/api/accounting/payables/{ncc['id']}", headers=h, params={"all_history": True}).json()
    assert sorted((p["purchase_code"], p["delivery_seq_no"] or 0, p["amount"], p["voucher_amount"]) for p in ct["paid"] if p["voucher_id"] == vid) == sorted([
        (a["code"], 0, 100_000, 450_000), (a["code"], 1, 50_000, 450_000), (b["code"], 1, 300_000, 450_000)
    ])

    ds = client.get("/api/accounting/payment-vouchers", headers=h, params={"purchase_request_id": b["id"]}).json()
    assert vid in [x["id"] for x in ds["items"]]
    ds = client.get("/api/accounting/payment-vouchers", headers=h, params={"q": b["code"]}).json()
    assert vid in [x["id"] for x in ds["items"]]

    pv = client.get(f"/api/accounting/payment-vouchers/{vid}", headers=h).json()
    assert [(l["purchase_code"], l["delivery_seq_no"], l["amount"]) for l in pv["lines"]] == [
        (a["code"], None, 100_000), (a["code"], 1, 50_000), (b["code"], 1, 300_000)
    ]

    r = client.post(f"/api/accounting/payment-vouchers/{vid}/cancel", json={"reason": "Lập nhầm"}, headers=h)
    assert r.status_code == 200, r.text
    assert _don_mua(client, h, a["id"])["deliveries"][0]["con_no"] == 220_000
    assert _don_mua(client, h, b["id"])["deliveries"][0]["con_no"] == 440_000


def test_dot_co_dong_phieu_gop_khong_xoa_duoc(client):
    h = _headers(client)
    ncc, a, a_dot, b, b_dot = _hai_don_cung_ncc(client, h, "NCC Gop Chan")
    _phieu_chi_gop_orm(ncc["id"], [(a["id"], a_dot, 10_000), (b["id"], b_dot, 10_000)], ma="PC-GOP-2")
    r = client.delete(f"/api/purchase-requests/{b['id']}/deliveries/{b_dot}", headers=h)
    assert r.status_code in (400, 409, 422), r.text


# ---------------------------------------------------------------- Task 3: lập phiếu chi gộp

URL_CHI_GOP = "/api/accounting/payment-vouchers/gop"


def _chi_gop(client, h, dong: list[tuple[int, int | None, int]], expect: int = 201) -> dict:
    from tests.test_payables_api import _hom_nay

    r = client.post(URL_CHI_GOP, json={
        "lines": [{"purchase_request_id": p, "delivery_id": d, "amount": t} for p, d, t in dong],
        "voucher_type": "cash", "voucher_date": _hom_nay().isoformat(),
        "cash_recipient_name": "Nguyễn Lan", "content": None,
    }, headers=h)
    assert r.status_code == expect, r.text
    return r.json()


def _so_phieu_chi() -> int:
    db = SessionLocal()
    try:
        return db.query(PaymentVoucher).count()
    finally:
        db.close()


def test_lap_phieu_chi_gop_mot_so_phieu_nhieu_dong(client):
    h = _headers(client)
    ncc, a, a_dot, b, b_dot = _hai_don_cung_ncc(client, h, "NCC Lap Gop")
    pv = _chi_gop(client, h, [(a["id"], None, 100_000), (a["id"], a_dot, 50_000), (b["id"], b_dot, 300_000)])
    assert pv["doc_no"] and pv["amount"] == 450_000
    assert pv["purchase_request_id"] is None and pv["delivery_id"] is None
    assert [(l["purchase_code"], l["delivery_seq_no"], l["amount"]) for l in pv["lines"]] == [
        (a["code"], None, 100_000), (a["code"], 1, 50_000), (b["code"], 1, 300_000)
    ]
    assert a["code"] in pv["content"] and b["code"] in pv["content"]
    # Trả một phần đợt B ⇒ đợt còn đúng phần thiếu.
    assert _don_mua(client, h, b["id"])["deliveries"][0]["con_no"] == 140_000

    r = client.post(f"/api/accounting/payment-vouchers/{pv['id']}/cancel", json={"reason": "Lập nhầm"}, headers=h)
    assert r.status_code == 200, r.text
    hang = client.get("/api/accounting/mua-hang-cho-chi", headers=h).json()
    theo_don = {x["don"]["id"]: x for x in hang}
    assert theo_don[a["id"]]["no_dot"] == 220_000 and theo_don[b["id"]]["no_dot"] == 440_000


def test_phieu_chi_gop_mot_dong_la_phieu_le(client):
    h = _headers(client)
    ncc, a, a_dot, b, b_dot = _hai_don_cung_ncc(client, h, "NCC Gop Mot")
    pv = _chi_gop(client, h, [(b["id"], b_dot, 440_000)])
    assert (pv["purchase_request_id"], pv["delivery_id"], len(pv["lines"])) == (b["id"], b_dot, 1)


def test_phieu_chi_gop_chan_sai_luat_va_khong_ghi_gi(client):
    h = _headers(client)
    ncc, a, a_dot, b, b_dot = _hai_don_cung_ncc(client, h, "NCC Gop Sai")
    khac = _supplier(client, h, name="NCC Gop Khac")
    c = _don(client, h, khac["id"], coc=200_000)
    truoc = _so_phieu_chi()
    _chi_gop(client, h, [(a["id"], a_dot, 10_000), (c["id"], None, 10_000)], expect=422)  # khác NCC
    _chi_gop(client, h, [(a["id"], a_dot, 10_000), (b["id"], b_dot, 500_000)], expect=422)  # vượt còn nợ đợt
    _chi_gop(client, h, [(a["id"], None, 600_000), (b["id"], b_dot, 10_000)], expect=422)  # vượt cọc khai
    _chi_gop(client, h, [(a["id"], a_dot, 10_000), (a["id"], a_dot, 10_000)], expect=422)  # trùng khoản
    _chi_gop(client, h, [(a["id"], a_dot, 0), (b["id"], b_dot, 10_000)], expect=422)  # số 0
    assert _so_phieu_chi() == truoc


def test_phieu_chi_gop_khong_nhan_nop_lai(client):
    from tests.test_payables_api import _hom_nay

    h = _headers(client)
    ncc, a, a_dot, b, b_dot = _hai_don_cung_ncc(client, h, "NCC Gop Nop Lai")
    pv = _chi_gop(client, h, [(a["id"], a_dot, 10_000), (b["id"], b_dot, 10_000)])
    r = client.post(f"/api/accounting/payment-vouchers/{pv['id']}/receipts", json={
        "payer_name": "Lan", "receipt_method": "cash", "receipt_date": _hom_nay().isoformat(),
        "amount": 5_000, "content": "Nộp lại",
    }, headers=h)
    assert r.status_code == 422, r.text
    assert "gộp" in r.json()["detail"]


def test_phieu_chi_gop_coc_va_dot_cung_don_khong_tra_thua_dot(client):
    """Cọc mới và tiền đợt cùng một đơn trong một phiếu: đợt về 0 đúng bằng tiền gắn đợt, cọc mới
    nằm lại rổ cọc chờ bù đợt sau — không chảy sang làm âm nợ đợt."""
    h = _headers(client)
    ncc, a, a_dot, b, b_dot = _hai_don_cung_ncc(client, h, "NCC Coc Dot")
    _chi_gop(client, h, [(a["id"], None, 100_000), (a["id"], a_dot, 220_000)])
    don = _don_mua(client, h, a["id"])
    assert don["deliveries"][0]["con_no"] == 0
    assert don["coc_chua_bu"] == 100_000


# ---------------------------------------------------------------- Task 4: phía thu đọc dòng


def _don_cua_khach(customer_id: int, suffix: str, total: int = 1_000_000, **cot) -> int:
    from app.models.order import STATUS_ORDERED, Order, OrderLine

    db = SessionLocal()
    try:
        o = Order(order_no=f"DH-GOP-{suffix}", customer_id=customer_id, **{"status": STATUS_ORDERED, **cot})
        o.lines.append(OrderLine(description="Hộp in", qty=100, don_vi_tinh="hộp", line_total=total,
                                 vat_pct_estimate=0))
        db.add(o)
        db.commit()
        return o.id
    finally:
        db.close()


def _phieu_thu_gop_orm(customer_id: int, dong: list[tuple[int, int | None, int]], *, ma: str = "PT-GOP-1") -> int:
    """Phiếu thu gộp dựng thẳng bằng ORM: đầu phiếu không hoá đơn/đơn, tiền nằm ở các dòng."""
    from app.models.user import User
    from tests.test_payables_api import _hom_nay

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").one()
        tong = sum(t for _, _, t in dong)
        p = PaymentReceipt(
            code=ma, doc_no=ma[-8:], source_type="sales_invoice", sales_invoice_id=None, order_id=None,
            customer_id=customer_id, order_no_snapshot="GOP", customer_name_snapshot="Khách gộp",
            payer_name="Khách gộp", receipt_method="cash", status="received", receipt_date=_hom_nay(),
            amount=tong, amount_vnd=tong, currency="VND", exchange_rate=1, content="Thu gộp",
            created_by_user_id=admin.id, received_by_user_id=admin.id,
        )
        for don, hd, tien in dong:
            p.lines.append(PaymentReceiptLine(order_id=don, sales_invoice_id=hd, amount_vnd=tien))
        db.add(p)
        db.commit()
        return p.id
    finally:
        db.close()


def _ba_don_mot_khach(client, h, suffix: str):
    from tests.test_ban_hang_cho_thu_chi import _ghi_hd

    x, kh = _sales_order(total=1_000_000, suffix=f"{suffix}X")
    y = _don_cua_khach(kh, f"{suffix}Y")
    z = _don_cua_khach(kh, f"{suffix}Z", deposit_pct=20)
    hd1 = _ghi_hd(client, h, x, f"{suffix}-1", 600_000)
    hd2 = _ghi_hd(client, h, y, f"{suffix}-2", 400_000)
    return kh, x, y, z, hd1, hd2


def test_phieu_thu_gop_tru_dung_tung_hoa_don_va_coc(client):
    from app.repositories.accounting_repo import AccountingRepository

    h = _headers(client)
    kh, x, y, z, hd1, hd2 = _ba_don_mot_khach(client, h, "GT1")
    pt = _phieu_thu_gop_orm(kh, [(x, hd1["id"], 300_000), (y, hd2["id"], 400_000), (z, None, 150_000)])

    ngan = client.get(f"/api/accounting/receivables/{kh}", headers=h).json()
    con = {it["invoice_id"]: it["remaining_amount"] for it in ngan["items"]}
    assert con.get(hd1["id"]) == 300_000 and con.get(hd2["id"], 0) == 0
    da_thu = sorted((p["sales_invoice_id"], p["amount"]) for p in ngan["paid"] if p["receipt_id"] == pt)
    assert da_thu == sorted([(hd1["id"], 300_000), (hd2["id"], 400_000)])

    db = SessionLocal()
    try:
        repo = AccountingRepository(db)
        assert repo.received_deposit_sums([x, y, z]) == {z: 150_000}
        assert repo.received_deposit_sum(z) == 150_000
        assert repo.received_invoice_receipt_sums([hd1["id"], hd2["id"]]) == {hd1["id"]: 300_000, hd2["id"]: 400_000}
        assert z in repo.don_co_coc_da_thu()
        hd, thu = repo.hoa_don_va_da_thu_toi_ngay([x, y, z])
        assert thu == {x: 300_000, y: 400_000, z: 150_000}
    finally:
        db.close()

    # Ngăn đơn Z thấy đúng phần cọc của dòng, không phải cả phiếu.
    don_z = client.get(f"/api/orders/{z}", headers=h).json()
    assert [int(d["amount"]) for d in don_z["deposits"]] == [150_000]


def test_phieu_thu_gop_so_131_mot_dong_va_bao_cao_thu_chi_tach_muc(client):
    from tests.test_payables_api import _hom_nay

    h = _headers(client)
    kh, x, y, z, hd1, hd2 = _ba_don_mot_khach(client, h, "GT2")
    pt = _phieu_thu_gop_orm(kh, [(x, hd1["id"], 300_000), (y, hd2["id"], 400_000), (z, None, 150_000)],
                            ma="PT-GOP-2")
    ky = {"tu_ngay": _hom_nay().replace(day=1).isoformat(), "den_ngay": _hom_nay().isoformat()}

    so = client.get(f"/api/accounting/receivables/{kh}/so-chi-tiet", params=ky, headers=h)
    assert so.status_code == 200, so.text
    dong_pt = [d for d in so.json()["dong"] if d["loai"] == "phieu_thu"]
    assert [(d["so_ct"], d["co"]) for d in dong_pt] == [("PT-GOP-2", 850_000)]

    bc = client.get("/api/bao-cao-thu-chi", params=ky, headers=h)
    assert bc.status_code == 200, bc.text
    # Phiếu có cả dòng cọc và dòng hoá đơn ⇒ hai mục cố định, cộng lại đúng bằng phiếu.
    assert sorted(d["cong"] for d in bc.json()["dong"] if d["ben"] == "thu") == [150_000, 700_000]

    tim = client.get("/api/accounting/payment-receipts", params={"q": "GT2-2"}, headers=h).json()
    assert pt in [r["id"] for r in tim["items"]]


def test_huy_hoa_don_phieu_gop_chi_dong_cua_no_ve_quy_don(client):
    from app.repositories.accounting_repo import AccountingRepository
    from tests.test_ban_hang_cho_thu_chi import _huy_hd

    h = _headers(client)
    kh, x, y, z, hd1, hd2 = _ba_don_mot_khach(client, h, "GT3")
    _phieu_thu_gop_orm(kh, [(x, hd1["id"], 300_000), (y, hd2["id"], 400_000)], ma="PT-GOP-3")
    assert _huy_hd(client, h, hd1["id"]).status_code == 200
    db = SessionLocal()
    try:
        repo = AccountingRepository(db)
        assert repo.thu_hoa_don_huy_theo_don([x, y]) == {x: 300_000}
        assert repo.hoa_don_huy_da_thu([x, y]) == {x: ["GT3-1"]}
    finally:
        db.close()


# ---------------------------------------------------------------- Task 5: lập phiếu thu gộp

URL_THU_GOP = "/api/accounting/payment-receipts/gop"


def _thu_gop(client, h, dong: list[tuple[int | None, int | None, int]], expect: int = 201, **them) -> dict:
    from tests.test_payables_api import _hom_nay

    r = client.post(URL_THU_GOP, json={
        "lines": [{"sales_invoice_id": hd, "order_id": don, "amount": t} for hd, don, t in dong],
        "receipt_method": "cash", "receipt_date": _hom_nay().isoformat(), "payer_name": "Khách gộp",
        **them,
    }, headers=h)
    assert r.status_code == expect, r.text
    return r.json()


def _so_phieu_thu() -> int:
    db = SessionLocal()
    try:
        return db.query(PaymentReceipt).count()
    finally:
        db.close()


def _con_no(client, h, kh: int) -> dict[int, int]:
    ngan = client.get(f"/api/accounting/receivables/{kh}", headers=h).json()
    return {it["invoice_id"]: it["remaining_amount"] for it in ngan["items"]}


def test_lap_phieu_thu_gop_mot_so_phieu_ba_dong(client):
    h = _headers(client)
    kh, x, y, z, hd1, hd2 = _ba_don_mot_khach(client, h, "LT1")
    pt = _thu_gop(client, h, [(hd1["id"], None, 300_000), (hd2["id"], None, 400_000), (None, z, 150_000)])
    assert pt["doc_no"] and pt["amount"] == 850_000 and pt["customer_id"] == kh
    assert pt["sales_invoice_id"] is None and pt["order_id"] is None
    assert [(l["sales_invoice_id"], l["order_id"], l["amount"]) for l in pt["lines"]] == [
        (hd1["id"], x, 300_000), (hd2["id"], y, 400_000), (None, z, 150_000)]
    assert "LT1-1" in pt["content"] and "DH-GOP-LT1Z" in pt["content"]
    assert _con_no(client, h, kh) == {hd1["id"]: 300_000}  # HĐ2 trả hết ⇒ rời bảng còn nợ

    r = client.post(f"/api/accounting/payment-receipts/{pt['id']}/cancel", json={"reason": "Nhầm"}, headers=h)
    assert r.status_code == 200, r.text
    assert _con_no(client, h, kh) == {hd1["id"]: 600_000, hd2["id"]: 400_000}
    cho = client.get("/api/accounting/don-hang-cho-thu", headers=h).json()
    assert z in [d["order_id"] for d in cho["coc"]]
    assert {d["invoice_id"] for d in cho["hoa_don"]} >= {hd1["id"], hd2["id"]}


def test_phieu_thu_gop_mot_dong_la_phieu_le(client):
    h = _headers(client)
    kh, x, y, z, hd1, hd2 = _ba_don_mot_khach(client, h, "LT2")
    pt = _thu_gop(client, h, [(hd2["id"], None, 400_000)])
    assert (pt["source_type"], pt["sales_invoice_id"], len(pt["lines"])) == ("sales_invoice", hd2["id"], 1)
    coc = _thu_gop(client, h, [(None, z, 50_000)])
    assert (coc["source_type"], coc["order_id"], coc["sales_invoice_id"]) == ("order_deposit", z, None)


def test_phieu_thu_gop_chan_sai_luat_va_khong_ghi_gi(client):
    from datetime import timedelta

    from tests.test_payables_api import _hom_nay

    h = _headers(client)
    kh, x, y, z, hd1, hd2 = _ba_don_mot_khach(client, h, "LT3")
    khac, _ = _sales_order(total=500_000, suffix="LT3K")
    truoc = _so_phieu_thu()
    _thu_gop(client, h, [(hd1["id"], None, 10_000), (None, khac, 10_000)], expect=422)  # khác khách
    _thu_gop(client, h, [(hd1["id"], None, 10_000), (hd2["id"], None, 400_001)], expect=422)  # vượt còn nợ
    _thu_gop(client, h, [(hd1["id"], None, 10_000), (hd1["id"], None, 10_000)], expect=422)  # trùng
    _thu_gop(client, h, [(None, z, 10_000), (None, z, 10_000)], expect=422)  # trùng cọc
    _thu_gop(client, h, [(hd1["id"], None, 10_000)], expect=422,
             receipt_date=(_hom_nay() - timedelta(days=3)).isoformat())  # trước ngày hoá đơn
    _thu_gop(client, h, [(None, None, 10_000)], expect=422)  # không nói khoản nào
    assert _so_phieu_thu() == truoc


def test_chi_tiet_khoan_thu_hang_va_phieu_gop(client):
    h = _headers(client)
    kh, x, y, z, hd1, hd2 = _ba_don_mot_khach(client, h, "LT4")
    pt = _thu_gop(client, h, [(hd1["id"], None, 300_000), (None, z, 150_000)])

    r = client.get("/api/accounting/chi-tiet-khoan-thu", params={"invoice_id": hd1["id"]}, headers=h)
    assert r.status_code == 200, r.text
    ct = r.json()
    assert [(x_["ten"], x_["so_luong"], x_["thanh_tien"]) for x_ in ct["hang"]] == [("Printed boxes", 100, 1_000_000)]
    assert [(p["receipt_id"], p["amount"], p["gop"]) for p in ct["phieu"]] == [(pt["id"], 300_000, True)]

    ct = client.get("/api/accounting/chi-tiet-khoan-thu", params={"order_id": z}, headers=h).json()
    assert [x_["ten"] for x_ in ct["hang"]] == ["Hộp in"]
    assert [(p["receipt_id"], p["amount"]) for p in ct["phieu"]] == [(pt["id"], 150_000)]


def test_don_ban_coc_phieu_gop_ghi_phan_cua_don_va_tong_phieu(client):
    h = _headers(client)
    kh, x, y, z, hd1, hd2 = _ba_don_mot_khach(client, h, "LT5")
    pt = _thu_gop(client, h, [(hd1["id"], None, 300_000), (None, z, 150_000)])
    r = client.get(f"/api/orders/{z}", headers=h)
    assert r.status_code == 200, r.text
    coc = [d for d in r.json()["deposits"] if d["id"] == pt["id"]]
    assert [(d["amount"], d["gop"], d["tong_phieu"]) for d in coc] == [(150_000, True, 450_000)]


def test_phieu_thu_gop_dong_coc_di_dung_luong_coc_cua_don(client):
    """Dòng cọc trong phiếu gộp = thu cọc thật: đủ cọc ⇒ đơn tự xuống SX; đơn huỷ ⇒ chặn, không ghi gì."""
    from app.models.order import STATUS_CANCELLED, Order

    h = _headers(client)
    kh, x, y, z, hd1, hd2 = _ba_don_mot_khach(client, h, "LT6")   # Z cọc 20% của 1.000.000
    huy = _don_cua_khach(kh, "LT6H", deposit_pct=20, status=STATUS_CANCELLED)
    truoc = _so_phieu_thu()
    _thu_gop(client, h, [(hd1["id"], None, 10_000), (None, huy, 200_000)], expect=409)
    assert _so_phieu_thu() == truoc

    _thu_gop(client, h, [(hd1["id"], None, 10_000), (None, z, 200_000)])
    db = SessionLocal()
    try:
        assert db.get(Order, z).san_xuat_released_at is not None
    finally:
        db.close()


def test_huy_phieu_chi_gop_bao_tung_don_mua(client, monkeypatch):
    """Huỷ phiếu chi gộp ⇒ báo từng đơn mua của nó (đầu phiếu chỉ mang mã ghép "PMH-A +2")."""
    import app.routers.accounting as r_kt

    h = _headers(client)
    ncc, a, a_dot, b, b_dot = _hai_don_cung_ncc(client, h, "NCC Huy Bao")
    pv = _chi_gop(client, h, [(a["id"], a_dot, 50_000), (b["id"], b_dot, 300_000)])
    da_bao: list[tuple[str, str]] = []
    monkeypatch.setattr(r_kt, "_notify_accounting_changed",
                        lambda ma, *, event_type, **_: da_bao.append((ma, event_type)))
    r = client.post(f"/api/accounting/payment-vouchers/{pv['id']}/cancel", json={"reason": "Nhầm"}, headers=h)
    assert r.status_code == 200, r.text
    assert sorted(da_bao) == sorted([(a["code"], "payment_voucher_cancelled"),
                                     (b["code"], "payment_voucher_cancelled")])


def test_bao_cao_cong_no_331_phieu_gop_bang_phieu_le_va_ngoai_ky_bi_loai(client):
    """Sổ 331 + tuổi nợ theo `den_ngay`: NCC trả bằng MỘT phiếu gộp phải ra đúng như NCC trả bằng
    hai phiếu lẻ cùng số; phiếu (gộp hay lẻ) ngày sau `den_ngay` thì rời kỳ như nhau."""
    from datetime import datetime, time, timedelta, timezone

    from tests.test_payables_api import _hom_nay

    h = _headers(client)
    ky = {"tu_ngay": (_hom_nay() - timedelta(days=30)).isoformat(), "den_ngay": _hom_nay().isoformat()}
    g, ga, _, gb, gb_dot = _hai_don_cung_ncc(client, h, "NCC Gop So")
    l_, la, _, lb, lb_dot = _hai_don_cung_ncc(client, h, "NCC Le So")
    pv = _chi_gop(client, h, [(ga["id"], None, 100_000), (gb["id"], gb_dot, 300_000)])
    le = [_phieu_chi(client, h, la["id"], 100_000)["id"],
          _phieu_chi(client, h, lb["id"], 300_000, stage="final", delivery_id=lb_dot)["id"]]

    def _dong_ncc(ten: str) -> dict:
        r = client.get("/api/accounting/reports/payables", params=ky, headers=h)
        assert r.status_code == 200, r.text
        d = next(x for x in r.json()["items"] if x["ten"] == ten)
        return {k: v for k, v in d.items() if k not in ("id", "ten", "ma", "doi_tuong_id")}

    trong_ky = _dong_ncc("NCC Gop So")
    assert trong_ky == _dong_ncc("NCC Le So")
    assert trong_ky["ps_no"] == 400_000

    db = SessionLocal()
    try:
        for v in db.query(PaymentVoucher).filter(PaymentVoucher.id.in_([pv["id"], *le])):
            v.voucher_date = _hom_nay() + timedelta(days=1)   # sổ lấy ngày tiền rời két = paid_at
            v.paid_at = datetime.combine(_hom_nay() + timedelta(days=2), time(12), tzinfo=timezone.utc)
        db.commit()
    finally:
        db.close()
    sau_ky = _dong_ncc("NCC Gop So")
    assert sau_ky == _dong_ncc("NCC Le So")
    assert sau_ky["ps_no"] == 0 and sau_ky["cuoi_co"] == trong_ky["cuoi_co"] + 400_000


def test_phieu_thu_gop_mot_dong_coc_cung_tu_chuyen_sx(client):
    """Tick đúng MỘT khoản cọc ở hàng chờ thu cũng đi `/gop` ⇒ đủ cọc vẫn tự xuống SX."""
    from app.models.order import Order

    h = _headers(client)
    kh, x, y, z, hd1, hd2 = _ba_don_mot_khach(client, h, "LT7")
    _thu_gop(client, h, [(None, z, 200_000)])
    db = SessionLocal()
    try:
        assert db.get(Order, z).san_xuat_released_at is not None
    finally:
        db.close()
