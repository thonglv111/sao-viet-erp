"""Bảng đối chiếu trong ngăn phiếu: "trả/thu TRƯỚC phiếu này" và "còn nợ SAU phiếu này".

`paid_amount` của đợt và `received_amount` của hoá đơn tính cả phiếu lập SAU nên không đối chiếu
được từng phiếu ⇒ máy chủ tính riêng ở route đọc MỘT phiếu. Danh sách không tính (tránh N truy vấn).
"""
from __future__ import annotations

from tests.test_ke_toan_cong_no_theo_ky import (
    _da_mua,
    _dong_dau_tien,
    _ghi_dot,
    _headers,
    _hom_nay,
    _invoice_payload,
    _needed_date,
    _duyet,
    _phieu_chi,
    _sales_order,
)


def _ncc_gia_100tr(client, h) -> dict:
    """NCC có mặt hàng đơn giá 100.000đ ⇒ 1000 tờ = 100.000.000đ."""
    r = client.post(
        "/api/suppliers",
        json={
            "name": "NCC Truoc Do",
            "tax_code": "0199990001",
            "phone": "0999990001",
            "email": "truocdo@example.com",
            "address": "Hà Nội",
            "contact_name": "Nguyễn Lan",
            "supplier_group": "paper",
            "items": [{"item_name": "Giấy Duplex", "unit": "tờ", "unit_price": 100_000, "vat_percent": 0}],
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _don_100tr(client, h, supplier_id: int, *, coc: int = 0) -> dict:
    src = client.post(
        "/api/department-purchase-requests",
        json={
            "source_type": "kinh_doanh",
            "purpose": "Mua giấy",
            "needed_date": _needed_date(),
            "lines": [{"item_name": "Giấy Duplex", "unit": "tờ", "quantity": 1000}],
        },
        headers=h,
    )
    assert src.status_code == 201, src.text
    r = client.post(
        "/api/purchase-requests",
        json={
            "supplier_id": supplier_id,
            "source_request_ids": [src.json()["id"]],
            "purpose": "Mua giấy",
            "needed_date": _needed_date(),
            "lines": [{
                "item_name": "Giấy Duplex", "unit": "tờ", "quantity": 1000,
                "expected_unit_price": 100_000, "discount_percent": 0, "vat_percent": 0,
            }],
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    if coc:  # cọc dự kiến phải khai xong TRƯỚC khi gửi duyệt
        rc = client.put(f"/api/purchase-requests/{body['id']}/contract",
                        json={"contract_number": None, "deposit_expected": coc}, headers=h)
        assert rc.status_code == 200, rc.text
    assert client.post(f"/api/purchase-requests/{body['id']}/submit", headers=h).status_code == 200
    _duyet(client, body["id"])
    return body


def _lay_phieu_chi(client, h, vid: int) -> dict:
    r = client.get(f"/api/accounting/payment-vouchers/{vid}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_phieu_chi_truoc_do_va_con_no_sau(client):
    h = _headers(client)
    ncc = _ncc_gia_100tr(client, h)
    don = _don_100tr(client, h, ncc["id"])
    _da_mua(client, h, don["id"])
    sau = _ghi_dot(client, h, don["id"],
                   lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 1000}])
    dot = sau["deliveries"][-1]["id"]

    a = _phieu_chi(client, h, don["id"], 30_000_000, delivery_id=dot)
    b = _phieu_chi(client, h, don["id"], 20_000_000, delivery_id=dot)
    c = _phieu_chi(client, h, don["id"], 10_000_000, delivery_id=dot)
    rc = client.post(f"/api/accounting/payment-vouchers/{b['id']}/cancel",
                     json={"reason": "Nhập sai"}, headers=h)
    assert rc.status_code == 200, rc.text

    # C lập sau A, B đã huỷ ⇒ trước đó chỉ còn A. Nợ sau C = 100tr − 30tr − 10tr.
    pc = _lay_phieu_chi(client, h, c["id"])
    assert pc["truoc_do"] == 30_000_000
    assert pc["con_no_sau"] == 60_000_000
    # A là phiếu đầu tiên: trước đó 0; nợ sau A = 100tr − 30tr (chỉ trừ tới chính A).
    pa = _lay_phieu_chi(client, h, a["id"])
    assert pa["truoc_do"] == 0
    assert pa["con_no_sau"] == 70_000_000
    # Phiếu đã huỷ: trước đó = A (30tr), phiếu này không tính vào nợ sau.
    pb = _lay_phieu_chi(client, h, b["id"])
    assert pb["truoc_do"] == 30_000_000
    assert pb["con_no_sau"] == 70_000_000


def test_phieu_chi_coc_khong_co_doi_chieu(client):
    """Phiếu ĐẶT CỌC không trả đích danh đợt nào ⇒ không có số đối chiếu."""
    h = _headers(client)
    ncc = _ncc_gia_100tr(client, h)
    don = _don_100tr(client, h, ncc["id"], coc=20_000_000)
    coc = _phieu_chi(client, h, don["id"], 20_000_000, stage="advance")
    ct = _lay_phieu_chi(client, h, coc["id"])
    assert ct["truoc_do"] is None and ct["con_no_sau"] is None


def test_danh_sach_phieu_chi_khong_tinh_truoc_do(client):
    h = _headers(client)
    ncc = _ncc_gia_100tr(client, h)
    don = _don_100tr(client, h, ncc["id"])
    _da_mua(client, h, don["id"])
    sau = _ghi_dot(client, h, don["id"],
                   lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 1000}])
    _phieu_chi(client, h, don["id"], 5_000_000, delivery_id=sau["deliveries"][-1]["id"])
    r = client.get("/api/accounting/payment-vouchers", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["items"], "phải có phiếu"
    for it in r.json()["items"]:
        assert it["truoc_do"] is None and it["con_no_sau"] is None


def _thu(client, h, hd_id: int, so_tien: int) -> dict:
    r = client.post(
        f"/api/accounting/sales-invoices/{hd_id}/receipts",
        json={"payer_name": "Khach", "receipt_method": "cash",
              "receipt_date": _hom_nay().isoformat(), "amount": so_tien, "content": "Thu"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_phieu_thu_truoc_do_va_con_no_sau(client):
    h = _headers(client)
    order, _kh = _sales_order(total=10_000_000, suffix="TD1")
    r = client.post("/api/accounting/sales-invoices",
                    json=_invoice_payload(order, number="TD-0001"), headers=h)
    assert r.status_code == 201, r.text
    hd = r.json()["id"]
    p1 = _thu(client, h, hd, 4_000_000)
    p2 = _thu(client, h, hd, 3_000_000)

    g1 = client.get(f"/api/accounting/payment-receipts/{p1['id']}", headers=h)
    assert g1.status_code == 200, g1.text
    assert g1.json()["truoc_do"] == 0
    assert g1.json()["con_no_sau"] == 6_000_000
    g2 = client.get(f"/api/accounting/payment-receipts/{p2['id']}", headers=h)
    assert g2.status_code == 200, g2.text
    assert g2.json()["truoc_do"] == 4_000_000
    assert g2.json()["con_no_sau"] == 3_000_000

    # Danh sách không tính hai số này.
    ds = client.get("/api/accounting/payment-receipts", headers=h)
    assert ds.status_code == 200, ds.text
    for it in ds.json()["items"]:
        assert it["truoc_do"] is None and it["con_no_sau"] is None


def test_phieu_thu_khong_ton_tai_404(client):
    h = _headers(client)
    assert client.get("/api/accounting/payment-receipts/999999", headers=h).status_code == 404


# --- nhánh TRỪ CỌC (vòng sửa 1) ------------------------------------------------


def test_phieu_chi_tru_coc_bu_vao_dot(client):
    """Đơn có cọc 20tr đã chi, đợt 100tr, phiếu 30tr ⇒ còn nợ SAU = 100 − 20 (cọc bù) − 30 = 50tr."""
    h = _headers(client)
    ncc = _ncc_gia_100tr(client, h)
    don = _don_100tr(client, h, ncc["id"], coc=20_000_000)
    _phieu_chi(client, h, don["id"], 20_000_000, stage="advance")
    _da_mua(client, h, don["id"])
    sau = _ghi_dot(client, h, don["id"],
                   lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 1000}])
    p = _phieu_chi(client, h, don["id"], 30_000_000, delivery_id=sau["deliveries"][-1]["id"])
    g = _lay_phieu_chi(client, h, p["id"])
    assert g["truoc_do"] == 0
    assert g["con_no_sau"] == 50_000_000


def test_phieu_thu_tru_coc_don_vao_hoa_don(client):
    """Hoá đơn 10tr, cọc đơn 2tr cấn vào, phiếu thu 4tr ⇒ còn nợ SAU = 10 − 2 − 4 = 4tr."""
    from tests.test_sales_invoices_api import _add_deposit

    h = _headers(client)
    order, _kh = _sales_order(total=10_000_000, suffix="TD2")
    _add_deposit(order, 2_000_000)
    r = client.post("/api/accounting/sales-invoices",
                    json=_invoice_payload(order, number="TD-0002"), headers=h)
    assert r.status_code == 201, r.text
    p = _thu(client, h, r.json()["id"], 4_000_000)
    g = client.get(f"/api/accounting/payment-receipts/{p['id']}", headers=h)
    assert g.status_code == 200, g.text
    assert g.json()["truoc_do"] == 0
    assert g.json()["con_no_sau"] == 4_000_000


def test_phieu_thu_cua_hoa_don_da_huy_khong_bao_con_no(client):
    h = _headers(client)
    order, _kh = _sales_order(total=10_000_000, suffix="TD3")
    r = client.post("/api/accounting/sales-invoices",
                    json=_invoice_payload(order, number="TD-0003"), headers=h)
    assert r.status_code == 201, r.text
    hd = r.json()["id"]
    p = _thu(client, h, hd, 4_000_000)
    # Huỷ phiếu thu (nhập sai) rồi huỷ hoá đơn.
    assert client.post(f"/api/accounting/payment-receipts/{p['id']}/cancel",
                       json={"reason": "Nhập sai"}, headers=h).status_code == 200
    assert client.post(f"/api/accounting/sales-invoices/{hd}/cancel",
                       json={"reason": "Lập nhầm"}, headers=h).status_code == 200
    g = client.get(f"/api/accounting/payment-receipts/{p['id']}", headers=h)
    assert g.status_code == 200, g.text
    assert g.json()["con_no_sau"] is None
