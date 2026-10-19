"""Sales invoice is the only event that creates accounts receivable."""
from __future__ import annotations

from datetime import timedelta

from tests.giao_hang_fixtures import giao_het
from app.db import SessionLocal
# "Hôm nay" phải là ĐỒNG HỒ CỦA SERVER (`Asia/Bangkok`), không phải của runner.
#
# `_hom_nay()` đọc giờ máy chạy test; GitHub Actions chạy UTC. Trong khoảng 17–24h UTC (tức
# 0–7h giờ VN) hai đồng hồ lệch NGÀY, nên "ngày mai" mà test dựng lại đúng bằng "hôm nay" của
# server ⇒ ca "hoá đơn đề ngày tương lai phải bị chặn" nhận 201 thay vì 422. Đã đỏ CI thật
# 15/08/2026 21:28 UTC. Dùng chung seam với service thì hai bên không thể lệch, bất kể chạy giờ nào.
from app.services.accounting_service import _business_today as _hom_nay
from app.models.accounting import (
    PAYMENT_RECEIPT_RECEIVED,
    RECEIPT_SOURCE_ORDER,
    PaymentReceipt,
)
from app.models.customer import Customer
from app.models.order import Order, OrderLine, STATUS_ORDERED
from app.models.user import User


def _headers(client) -> dict[str, str]:
    response = client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin123"}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _sales_order(
    *, total: int = 1_000_000, term_days: int | None = 30, suffix: str = "01"
) -> tuple[int, int]:
    db = SessionLocal()
    try:
        customer = Customer(
            code=f"KH-HD-{suffix}",
            name="Customer invoice test" if suffix == "01" else f"Customer invoice test {suffix}",
            payment_term_days=term_days,
            credit_limit=500_000,
        )
        db.add(customer)
        db.flush()
        order = Order(
            order_no=f"DH-HD-{suffix}",
            customer_id=customer.id,
            status=STATUS_ORDERED,
            ordered_at=None,
        )
        order.lines.append(
            OrderLine(
                description="Printed boxes",
                qty=100,
                don_vi_tinh="box",
                line_total=total,
                vat_pct_estimate=0,
            )
        )
        db.add(order)
        db.commit()
        return order.id, customer.id
    finally:
        db.close()


def _invoice_payload(order_id: int, *, number: str, amount: int | None = None) -> dict:
    # Hóa đơn gắn lượt khách đã nhận (mg 0402) — dựng sẵn lượt giao hết đơn.
    payload = {
        "order_id": order_id,
        "delivery_trip_id": giao_het(order_id),
        "invoice_symbol": "1C26TSV",
        "invoice_number": number,
        "invoice_date": _hom_nay().isoformat(),
    }
    if amount is not None:
        payload["amount_vnd"] = amount
    return payload


def _add_deposit(order_id: int, amount: int) -> None:
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").one()
        db.add(
            PaymentReceipt(
                code=f"PT-DEPOSIT-{order_id}-{amount}",
                source_type=RECEIPT_SOURCE_ORDER,
                order_id=order_id,
                order_no_snapshot="DH-HD-01",
                customer_name_snapshot="Customer invoice test",
                payer_name="Customer invoice test",
                receipt_method="cash",
                status=PAYMENT_RECEIPT_RECEIVED,
                receipt_date=_hom_nay(),
                amount=amount,
                amount_vnd=amount,
                currency="VND",
                exchange_rate=1,
                content="Order deposit",
                created_by_user_id=admin.id,
                received_by_user_id=admin.id,
            )
        )
        db.commit()
    finally:
        db.close()


def test_confirmed_order_does_not_create_receivable_until_invoice(client):
    headers = _headers(client)
    order_id, customer_id = _sales_order()

    before = client.get("/api/accounting/receivables", headers=headers)
    assert before.status_code == 200, before.text
    assert before.json()["total_due"] == 0
    assert all(row["customer_id"] != customer_id for row in before.json()["items"])

    created = client.post(
        "/api/accounting/sales-invoices",
        json=_invoice_payload(order_id, number="00000001", amount=400_000),
        headers=headers,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["remaining_amount"] == 400_000
    assert body["due_date"] == (_hom_nay() + timedelta(days=30)).isoformat()

    after = client.get("/api/accounting/receivables", headers=headers).json()
    customer = next(row for row in after["items"] if row["customer_id"] == customer_id)
    assert customer["invoice_count"] == 1
    assert customer["invoiced_amount"] == 400_000
    assert customer["total_due"] == 400_000


def test_cong_no_phai_thu_phan_trang_nhung_tong_tien_khong_doi(client):
    headers = _headers(client)
    order_a, customer_a = _sales_order(total=300_000, suffix="P1")
    order_b, customer_b = _sales_order(total=700_000, suffix="P2")
    assert client.post(
        "/api/accounting/sales-invoices",
        json=_invoice_payload(order_a, number="PAG-0001"),
        headers=headers,
    ).status_code == 201
    assert client.post(
        "/api/accounting/sales-invoices",
        json=_invoice_payload(order_b, number="PAG-0002"),
        headers=headers,
    ).status_code == 201

    trang_1 = client.get("/api/accounting/receivables?page=1&size=1", headers=headers)
    trang_2 = client.get("/api/accounting/receivables?page=2&size=1", headers=headers)
    assert trang_1.status_code == 200 and trang_2.status_code == 200
    mot, hai = trang_1.json(), trang_2.json()
    assert mot["total"] == 2 and mot["pages"] == 2
    assert mot["page"] == 1 and hai["page"] == 2
    assert mot["total_due"] == hai["total_due"] == 1_000_000
    assert {mot["items"][0]["customer_id"], hai["items"][0]["customer_id"]} == {
        customer_a,
        customer_b,
    }


def test_so_hoa_don_cua_don_tra_so_ngay_cong_no_va_ky_hieu_gan_nhat(client):
    """Popup ghi nhận hoá đơn cần hai số này để hiện trước hạn trả và điền sẵn ký hiệu."""
    headers = _headers(client)
    order_id, _ = _sales_order(term_days=45)
    other_id, _ = _sales_order(term_days=None, suffix="02")

    truoc = client.get(f"/api/accounting/sales-invoices?order_id={order_id}", headers=headers).json()
    assert truoc["payment_term_days"] == 45
    assert truoc["last_invoice_symbol"] is None

    created = client.post(
        "/api/accounting/sales-invoices",
        json={**_invoice_payload(order_id, number="00000009", amount=100_000), "invoice_symbol": "1C26TAB"},
        headers=headers,
    )
    assert created.status_code == 201, created.text

    # Ký hiệu gần nhất lấy trên MỌI đơn; khách chưa đặt số ngày công nợ ⇒ null.
    khac = client.get(f"/api/accounting/sales-invoices?order_id={other_id}", headers=headers).json()
    assert khac["last_invoice_symbol"] == "1C26TAB"
    assert khac["payment_term_days"] is None


def test_partial_invoices_are_capped_by_order_total(client):
    headers = _headers(client)
    order_id, _ = _sales_order()

    first = client.post(
        "/api/accounting/sales-invoices",
        json=_invoice_payload(order_id, number="00000002", amount=400_000),
        headers=headers,
    )
    assert first.status_code == 201, first.text
    second = client.post(
        "/api/accounting/sales-invoices",
        json=_invoice_payload(order_id, number="00000003"),
        headers=headers,
    )
    assert second.status_code == 201, second.text
    assert second.json()["amount_vnd"] == 600_000

    too_much = client.post(
        "/api/accounting/sales-invoices",
        json=_invoice_payload(order_id, number="00000004", amount=1),
        headers=headers,
    )
    assert too_much.status_code == 422, too_much.text


def test_deposit_offsets_issued_invoices_fifo_without_creating_early_debt(client):
    headers = _headers(client)
    order_id, customer_id = _sales_order()
    _add_deposit(order_id, 300_000)

    before = client.get(
        f"/api/accounting/receivables/{customer_id}", headers=headers
    ).json()
    assert before["total_due"] == 0

    first = client.post(
        "/api/accounting/sales-invoices",
        json=_invoice_payload(order_id, number="00000005", amount=200_000),
        headers=headers,
    )
    assert first.status_code == 201, first.text
    assert first.json()["deposit_offset_amount"] == 200_000
    assert first.json()["remaining_amount"] == 0

    second = client.post(
        "/api/accounting/sales-invoices",
        json=_invoice_payload(order_id, number="00000006", amount=300_000),
        headers=headers,
    )
    assert second.status_code == 201, second.text
    assert second.json()["deposit_offset_amount"] == 100_000
    assert second.json()["remaining_amount"] == 200_000


def test_invoice_receipt_reduces_debt_and_invoice_still_cancellable(client):
    headers = _headers(client)
    order_id, customer_id = _sales_order()
    invoice = client.post(
        "/api/accounting/sales-invoices",
        json=_invoice_payload(order_id, number="00000007", amount=500_000),
        headers=headers,
    ).json()

    receipt = client.post(
        f"/api/accounting/sales-invoices/{invoice['id']}/receipts",
        json={
            "payer_name": "Customer invoice test",
            "receipt_method": "cash",
            "receipt_date": _hom_nay().isoformat(),
            "amount": 200_000,
            "content": "Partial invoice payment",
        },
        headers=headers,
    )
    assert receipt.status_code == 201, receipt.text
    assert receipt.json()["source_type"] == "sales_invoice"
    assert receipt.json()["status"] == "received"
    assert receipt.json()["sales_invoice_id"] == invoice["id"]

    detail = client.get(
        f"/api/accounting/receivables/{customer_id}", headers=headers
    ).json()
    assert detail["total_due"] == 300_000
    assert detail["items"][0]["direct_received_amount"] == 200_000

    # Sổ hoá đơn của đơn kể từng phiếu thu thẳng vào hoá đơn — khối Hoá đơn ghi số phiếu.
    book = client.get(f"/api/accounting/sales-invoices?order_id={order_id}", headers=headers).json()
    assert [(p["code"], p["invoice_id"], p["amount"]) for p in book["phieu_thu"]] == [
        (receipt.json()["code"], invoice["id"], 200_000)
    ]

    overpay = client.post(
        f"/api/accounting/sales-invoices/{invoice['id']}/receipts",
        json={
            "payer_name": "Customer invoice test",
            "receipt_method": "cash",
            "receipt_date": _hom_nay().isoformat(),
            "amount": 300_001,
            "content": "Overpay",
        },
        headers=headers,
    )
    assert overpay.status_code == 422, overpay.text

    # Khách đã trả vẫn huỷ được hoá đơn (17/10/2026): phiếu thu giữ nguyên, tiền về quỹ của đơn.
    cancelled_invoice = client.post(
        f"/api/accounting/sales-invoices/{invoice['id']}/cancel",
        json={"reason": "Incorrect invoice"},
        headers=headers,
    )
    assert cancelled_invoice.status_code == 200, cancelled_invoice.text
    assert cancelled_invoice.json()["status"] == "cancelled"
    assert client.get(
        f"/api/accounting/receivables/{customer_id}", headers=headers
    ).json()["total_due"] == 0
    assert client.get(
        f"/api/accounting/payment-receipts/{receipt.json()['id']}", headers=headers
    ).json()["status"] == "received"


def test_overdue_and_credit_limit_use_invoice_date_and_snapshot(client):
    headers = _headers(client)
    order_id, customer_id = _sales_order(term_days=1)
    payload = _invoice_payload(order_id, number="00000012")
    payload["invoice_date"] = (_hom_nay() - timedelta(days=3)).isoformat()
    created = client.post(
        "/api/accounting/sales-invoices", json=payload, headers=headers
    )
    assert created.status_code == 201, created.text

    summary = client.get("/api/accounting/receivables", headers=headers).json()
    row = next(item for item in summary["items"] if item["customer_id"] == customer_id)
    assert row["overdue_amount"] == 1_000_000
    assert row["vuot_han_muc"] is True
    assert row["vuot_bao_nhieu"] == 500_000


def test_invoice_without_payment_terms_is_due_but_not_overdue(client):
    headers = _headers(client)
    order_id, customer_id = _sales_order(term_days=None)
    created = client.post(
        "/api/accounting/sales-invoices",
        json=_invoice_payload(order_id, number="00000013"),
        headers=headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["due_date"] is None

    detail = client.get(
        f"/api/accounting/receivables/{customer_id}", headers=headers
    ).json()
    assert detail["items"][0]["chua_dat_han"] is True
    assert detail["items"][0]["overdue_days"] == 0
    assert detail["overdue_amount"] == 0


def test_phan_tuoi_no_phai_thu_xe_dung_ro_va_tong_luon_khop(client):
    """PHÂN TUỔI NỢ phải thu (chủ chốt 29/08/2026) — trước đó chỉ có MỘT ô "Quá hạn" gộp tất.

    Dựng ba hoá đơn trễ ba mức khác nhau + một hoá đơn CHƯA tới hạn, rồi soi hai bất biến:

      1. Mỗi hoá đơn rơi ĐÚNG rổ theo số ngày trễ.
      2. Tổng 5 rổ TRỄ = đúng `overdue_amount`. Đây là bất biến sống còn: hai chỗ nói hai kiểu
         tiền là lỗi nặng nhất của màn công nợ (`test_phan_tuoi_cong_no.py` canh y hệt điều đó
         cho bên phải trả).
    """
    headers = _headers(client)
    # `term_days=0` ⇒ hạn = chính ngày hoá đơn, nên lùi ngày hoá đơn bao nhiêu là trễ bấy nhiêu.
    # Đơn phải đủ to cho 4 hoá đơn 1tr — server chặn xuất quá phần chưa xuất hoá đơn.
    order_id, customer_id = _sales_order(total=4_000_000, term_days=0, suffix="tuoi")
    mong = {"d1_7": 5, "d16_30": 20, "d60_plus": 90}
    for i, (ro, tre) in enumerate(mong.items(), start=40):
        payload = _invoice_payload(order_id, number=f"000000{i}", amount=1_000_000)
        payload["invoice_date"] = (_hom_nay() - timedelta(days=tre)).isoformat()
        r = client.post("/api/accounting/sales-invoices", json=payload, headers=headers)
        assert r.status_code == 201, (ro, r.text)
    # Một hoá đơn CHƯA tới hạn để rổ đầu không rỗng.
    chua = _invoice_payload(order_id, number="00000049", amount=1_000_000)
    chua["invoice_date"] = _hom_nay().isoformat()
    assert client.post(
        "/api/accounting/sales-invoices", json=chua, headers=headers
    ).status_code == 201

    tong = client.get("/api/accounting/receivables", headers=headers).json()
    khach = next(i for i in tong["items"] if i["customer_id"] == customer_id)

    for ro, _tre in mong.items():
        assert khach["aging"][ro]["amount"] == 1_000_000, (ro, khach["aging"])
        assert khach["aging"][ro]["count"] == 1, ro
    assert khach["aging"]["chua_toi_han"]["amount"] == 1_000_000

    tre = sum(
        v["amount"] for k, v in khach["aging"].items() if k != "chua_toi_han"
    )
    assert tre == khach["overdue_amount"] == 3_000_000
    assert khach["aging"]["chua_toi_han"]["amount"] == khach["no_han_amount"]

    # Dải rổ TOÀN MÀN phải cộng ra cùng con số.
    ro_man = {b["key"]: b["amount"] for b in tong["aging"]}
    assert sum(v for k, v in ro_man.items() if k != "chua_toi_han") == tong["overdue_amount"]

    # Lọc theo rổ: chỉ giữ khách còn tiền trong rổ đó, và KHÔNG làm tổng đầu màn nhảy.
    # Tên tham số là `aging_bucket`, CÙNG tên với màn phải trả. Gõ `aging=` thì server lặng lẽ
    # bỏ qua và trả nguyên danh sách — bộ lọc "chạy" mà không lọc gì, đúng cái bẫy lượt
    # `init.ps1` 29/08/2026 bắt được.
    loc = client.get(
        "/api/accounting/receivables?aging_bucket=d60_plus", headers=headers
    ).json()
    assert any(i["customer_id"] == customer_id for i in loc["items"])
    assert loc["total_due"] == tong["total_due"]
    trong = client.get(
        "/api/accounting/receivables?aging_bucket=d31_60", headers=headers
    ).json()
    assert all(i["customer_id"] != customer_id for i in trong["items"])

    # Màn CHI TIẾT của khách phải ra cùng bộ rổ — hai màn lệch là một khoản hiện hai mức khẩn.
    ct = client.get(f"/api/accounting/receivables/{customer_id}", headers=headers).json()
    assert {b["key"]: b["amount"] for b in ct["aging"]} == {
        b["key"]: b["amount"] for b in tong["aging"]
    }


def test_hoa_don_khong_co_han_nam_o_ro_chua_toi_han(client):
    """Khách chưa khai số ngày thanh toán ⇒ hoá đơn không có hạn ⇒ rổ "Chưa tới hạn".

    Chủ chốt 29/08/2026 chọn y hệt bên phải trả: *"chưa tới hạn như phải trả"*. Thêm rổ KHÔNG
    được đổi chỗ của khoản nào — nó vẫn phải nằm đúng chỗ `no_han_amount` vẫn xếp, và vẫn đeo cờ
    `chua_dat_han` ở màn chi tiết để không ai tưởng nó đã được canh."""
    headers = _headers(client)
    order_id, customer_id = _sales_order(term_days=None, suffix="khhan")
    assert client.post(
        "/api/accounting/sales-invoices",
        json=_invoice_payload(order_id, number="00000051"),
        headers=headers,
    ).status_code == 201

    tong = client.get("/api/accounting/receivables", headers=headers).json()
    khach = next(i for i in tong["items"] if i["customer_id"] == customer_id)
    assert khach["aging"]["chua_toi_han"]["amount"] == khach["total_due"]
    assert khach["overdue_amount"] == 0
    assert all(
        v["amount"] == 0 for k, v in khach["aging"].items() if k != "chua_toi_han"
    )

    ct = client.get(f"/api/accounting/receivables/{customer_id}", headers=headers).json()
    assert ct["items"][0]["chua_dat_han"] is True
    assert ct["items"][0]["aging_bucket"] is None


def test_invoice_validation_requires_traceable_identity_and_valid_date(client):
    headers = _headers(client)
    order_id, _ = _sales_order()

    missing_symbol = _invoice_payload(order_id, number="00000008")
    missing_symbol.pop("invoice_symbol")
    response = client.post(
        "/api/accounting/sales-invoices", json=missing_symbol, headers=headers
    )
    assert response.status_code == 422, response.text

    future = _invoice_payload(order_id, number="00000009")
    future["invoice_date"] = (_hom_nay() + timedelta(days=1)).isoformat()
    response = client.post(
        "/api/accounting/sales-invoices", json=future, headers=headers
    )
    assert response.status_code == 422, response.text


def test_order_with_issued_invoice_cannot_be_cancelled(client):
    headers = _headers(client)
    order_id, _ = _sales_order()
    created = client.post(
        "/api/accounting/sales-invoices",
        json=_invoice_payload(order_id, number="00000011"),
        headers=headers,
    )
    assert created.status_code == 201, created.text

    response = client.post(
        f"/api/orders/{order_id}/cancel",
        json={"reason": "Customer stopped order", "fault": "khach"},
        headers=headers,
    )
    assert response.status_code == 409, response.text

def test_man_khach_hang_va_man_cong_no_khong_duoc_lech(client):
    headers = _headers(client)
    order_id, customer_id = _sales_order()
    created = client.post(
        "/api/accounting/sales-invoices",
        json=_invoice_payload(order_id, number="00000010", amount=650_000),
        headers=headers,
    )
    assert created.status_code == 201, created.text

    ar = client.get(
        f"/api/accounting/receivables/{customer_id}", headers=headers
    )
    crm = client.get(f"/api/customers/{customer_id}", headers=headers)
    assert ar.status_code == 200, ar.text
    assert crm.status_code == 200, crm.text
    assert crm.json()["receivable"]["balance"] == ar.json()["total_due"] == 650_000


def test_hoa_don_theo_so_da_giao_tung_luot(client):
    """Hóa đơn gắn lượt khách đã nhận; trần duy nhất là tổng đơn (13/10/2026).

    Đơn 100 hộp 1.000.000 đ: chưa giao thì không ghi được; giao 30 hộp (300.000) vẫn ghi được
    500.000 rồi 500.000 nữa — tới tổng đơn thì chặn. Lượt sau giao 70 nốt đã được phần dư phủ."""
    headers = _headers(client)
    order_id, _ = _sales_order(suffix="GL1")
    khac_id, _ = _sales_order(suffix="GL2")
    goc = {
        "order_id": order_id, "invoice_symbol": "1C26TSV",
        "invoice_date": _hom_nay().isoformat(),
    }

    r = client.post("/api/accounting/sales-invoices", json={**goc, "invoice_number": "GL-1"},
                    headers=headers)
    assert r.status_code == 422 and "lượt giao" in r.json()["detail"], r.text

    book = client.get(f"/api/accounting/sales-invoices?order_id={order_id}", headers=headers).json()
    assert (book["delivered_amount"], book["invoiceable_amount"], book["luot_giao"]) == (0, 0, [])

    db = SessionLocal()
    try:
        dong = db.query(OrderLine).filter(OrderLine.order_id == order_id).one().id
    finally:
        db.close()
    l1 = giao_het(order_id, {dong: 30})

    # Lượt của đơn khác không ghi được cho đơn này.
    l_khac = giao_het(khac_id)
    r = client.post("/api/accounting/sales-invoices",
                    json={**goc, "invoice_number": "GL-2", "delivery_trip_id": l_khac}, headers=headers)
    assert r.status_code == 422, r.text

    r = client.post("/api/accounting/sales-invoices",
                    json={**goc, "invoice_number": "GL-3", "delivery_trip_id": l1, "amount_vnd": 1_000_001},
                    headers=headers)
    assert r.status_code == 422 and "1,000,000" in r.json()["detail"], r.text

    # Không gõ số thì điền sẵn phần chưa ghi của lượt.
    r = client.post("/api/accounting/sales-invoices",
                    json={**goc, "invoice_number": "GL-4", "delivery_trip_id": l1}, headers=headers)
    assert r.status_code == 201, r.text
    assert (r.json()["amount_vnd"], r.json()["delivery_trip_id"]) == (300_000, l1)

    # Vượt hàng của lượt vẫn được, miễn chưa quá tổng đơn.
    r = client.post("/api/accounting/sales-invoices",
                    json={**goc, "invoice_number": "GL-5", "delivery_trip_id": l1, "amount_vnd": 200_000},
                    headers=headers)
    assert r.status_code == 201, r.text
    # Lượt đã ghi đủ thì điền sẵn phần còn lại của cả đơn.
    r = client.post("/api/accounting/sales-invoices",
                    json={**goc, "invoice_number": "GL-6", "delivery_trip_id": l1}, headers=headers)
    assert r.status_code == 201 and r.json()["amount_vnd"] == 500_000, r.text
    r = client.post("/api/accounting/sales-invoices",
                    json={**goc, "invoice_number": "GL-7", "delivery_trip_id": l1}, headers=headers)
    assert r.status_code == 422 and "đủ tổng" in r.json()["detail"], r.text

    # Lượt sau giao nốt: phần ghi dư ở lượt 1 dồn sang phủ lượt 2.
    l2 = giao_het(order_id)
    book = client.get(f"/api/accounting/sales-invoices?order_id={order_id}", headers=headers).json()
    assert (book["delivered_amount"], book["invoiced_amount"]) == (1_000_000, 1_000_000)
    assert [(x["trip_id"], x["gia_tri"], x["da_ghi"], x["con_ghi"]) for x in book["luot_giao"]] == [
        (l1, 300_000, 300_000, 0), (l2, 700_000, 700_000, 0),
    ]
    assert book["items"][0]["luot_giao_ma"] == book["luot_giao"][0]["ma"]


def test_gia_tri_luot_co_vat_va_lam_tron_khop_tong_don(client):
    """Ba lượt 1 + 1 + 1 của đơn 3 hộp 100 đ VAT 10%: tổng các lượt bằng đúng tổng đơn gồm VAT."""
    headers = _headers(client)
    order_id, _ = _sales_order(total=100, suffix="GL3")
    db = SessionLocal()
    try:
        ln = db.query(OrderLine).filter(OrderLine.order_id == order_id).one()
        ln.qty, ln.vat_pct_estimate = 3, 10
        db.commit()
        dong = ln.id
    finally:
        db.close()
    for _ in range(3):
        giao_het(order_id, {dong: 1})
    book = client.get(f"/api/accounting/sales-invoices?order_id={order_id}", headers=headers).json()
    assert [x["gia_tri"] for x in book["luot_giao"]] == [36, 37, 37]
    assert book["delivered_amount"] == book["order_total"] == 110


def test_hoa_don_cu_chua_gan_luot_don_vao_luot_theo_thu_tu(client):
    """Hóa đơn ghi trước mg 0402 không có lượt: dồn vào lượt đầu, lượt chỉ còn phần chưa ghi."""
    from app.models.accounting import SalesInvoice

    headers = _headers(client)
    order_id, customer_id = _sales_order(suffix="GL4")
    db = SessionLocal()
    try:
        db.add(SalesInvoice(order_id=order_id, customer_id=customer_id, invoice_symbol="1C26TSV",
                            invoice_number="CU-1", invoice_date=_hom_nay(), amount_vnd=400_000,
                            customer_name_snapshot="x", status="issued"))
        db.commit()
    finally:
        db.close()
    luot = giao_het(order_id)
    book = client.get(f"/api/accounting/sales-invoices?order_id={order_id}", headers=headers).json()
    assert [(x["da_ghi"], x["con_ghi"]) for x in book["luot_giao"]] == [(400_000, 600_000)]
    r = client.post("/api/accounting/sales-invoices", json={
        "order_id": order_id, "invoice_symbol": "1C26TSV", "invoice_number": "CU-2",
        "invoice_date": _hom_nay().isoformat(), "delivery_trip_id": luot}, headers=headers)
    assert r.status_code == 201 and r.json()["amount_vnd"] == 600_000, r.text
