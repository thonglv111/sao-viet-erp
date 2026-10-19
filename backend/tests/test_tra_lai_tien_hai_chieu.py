"""Trả lại tiền hai chiều (12/10/2026).

Chi: phiếu TRẢ LẠI TIỀN CHO KHÁCH (`customer_refund`) lập từ ngăn Công nợ phải thu hoặc "Trả lại
cọc" trên đơn đã huỷ — bắt buộc khách, có đơn thì không vượt cọc còn lại; thuộc mục cố định "Trả
lại tiền cho khách".
Thu: phiếu NHÀ CUNG CẤP HOÀN TIỀN lập từ ngăn Công nợ phải trả — gắn thẳng NCC, không cần phiếu chi
gốc; thuộc mục cố định "Nhà cung cấp hoàn tiền" và vào Công nợ phải trả của đúng NCC.
"""
from __future__ import annotations

from app.db import SessionLocal
from app.models.order import STATUS_CANCELLED, Order
from tests.test_bao_cao_cong_no import _bao_cao, _dong, _kiem_can_so, _ngay
from tests.test_payables_api import _headers, _supplier
from tests.test_sales_invoices_api import _add_deposit, _invoice_payload, _sales_order

URL_PC = "/api/accounting/payment-vouchers"


def _khach_cua_don(order_id: int, *, huy: bool = False) -> int:
    db = SessionLocal()
    try:
        don = db.get(Order, order_id)
        if huy:
            don.status = STATUS_CANCELLED
            db.commit()
        return don.customer_id
    finally:
        db.close()


def _tra_lai(client, h, *, so_tien: int, **them):
    return client.post(URL_PC, json={
        "source_type": "customer_refund", "voucher_type": "cash", "payment_stage": "other",
        "voucher_date": _ngay(0), "amount": so_tien, "currency": "VND", "exchange_rate": 1,
        "content": "Trả lại tiền cho khách", "cash_recipient_name": "Khách", **them,
    }, headers=h)


def test_tra_lai_tien_khach_bat_buoc_khach_va_thuoc_muc_co_dinh(client):
    h = _headers(client)
    order_id, _ = _sales_order(suffix="TL1")
    kh = _khach_cua_don(order_id)

    r = _tra_lai(client, h, so_tien=100_000)
    assert r.status_code == 422 and "chọn khách hàng" in r.text

    r = _tra_lai(client, h, so_tien=100_000, customer_id=kh)
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["source_type"] == "customer_refund" and p["customer_id"] == kh
    assert p["muc_thu_chi_id"] is None and p["muc_thu_chi_ten"] == "Trả lại tiền cho khách"
    assert p["order_id"] is None

    # Lọc danh sách phiếu chi theo mục cố định -7 ra đúng phiếu này.
    r = client.get(URL_PC, params={"muc": [-7], "size": 50}, headers=h)
    assert [i["id"] for i in r.json()["items"]] == [p["id"]]


def test_tra_lai_coc_chi_don_da_huy_va_khong_vuot_coc_con_lai(client):
    h = _headers(client)
    order_id, _ = _sales_order(suffix="TL2")
    _add_deposit(order_id, 300_000)
    kh = _khach_cua_don(order_id)

    r = _tra_lai(client, h, so_tien=100_000, customer_id=kh, order_id=order_id)
    assert r.status_code == 422 and "chưa huỷ" in r.text

    _khach_cua_don(order_id, huy=True)
    khac, _ = _sales_order(suffix="TL3")
    r = _tra_lai(client, h, so_tien=100_000, customer_id=_khach_cua_don(khac), order_id=order_id)
    assert r.status_code == 422 and "không phải đơn của khách" in r.text

    r = _tra_lai(client, h, so_tien=200_000, customer_id=kh, order_id=order_id)
    assert r.status_code == 201, r.text
    assert r.json()["order_id"] == order_id and r.json()["order_code"] == "DH-HD-TL2"

    # Còn 100.000 — trả 150.000 nữa thì bị chặn.
    r = _tra_lai(client, h, so_tien=150_000, customer_id=kh, order_id=order_id)
    assert r.status_code == 422 and "100,000" in r.text

    don = client.get(f"/api/orders/{order_id}", headers=h)
    assert don.status_code == 200, don.text
    assert (don.json()["deposit_received"], don.json()["deposit_refunded"]) == (300_000, 200_000)

    # Công nợ phải thu của khách: cọc 300.000 (Có) − trả lại 200.000 (Nợ) ⇒ còn giữ 100.000.
    bc = _bao_cao(client, h, "receivables", tu=_ngay(30), den=_ngay(0))
    d = _dong(bc, "Customer invoice test TL2")
    assert (d["cuoi_no"], d["cuoi_co"]) == (0, 100_000)
    # Tiền hoàn nằm trong PS Nợ (sổ MISA) nhưng báo riêng để giao diện không tính là Bán ra.
    assert (d["ps_no"], d["hoan"]) == (200_000, 200_000)
    assert bc["tong"]["hoan"] >= 200_000
    so = client.get("/api/accounting/reports/receivables/so-chi-tiet",
                    params={"doi_tuong_id": kh, "tu_ngay": _ngay(30), "den_ngay": _ngay(0)}, headers=h)
    assert so.status_code == 200, so.text
    assert so.json()["hoan"] == 200_000
    _kiem_can_so(bc)


def test_tra_lai_tien_khach_cong_lai_vao_con_no_man_cong_no_phai_thu(client):
    """Khách trả 300.000 cho hoá đơn 500.000, mình trả lại 100.000 ⇒ màn Công nợ phải thu ghi còn
    nợ 300.000 như sổ 131 (trước 12/10/2026 màn này bỏ qua tiền trả lại, ra 200.000)."""
    h = _headers(client)
    order_id, kh = _sales_order(suffix="TL4", term_days=0)
    r = client.post("/api/accounting/sales-invoices",
                    json=_invoice_payload(order_id, number="70000041", amount=500_000), headers=h)
    assert r.status_code == 201, r.text
    hd_id = r.json()["id"]
    r = client.post(f"/api/accounting/sales-invoices/{hd_id}/receipts", json={
        "payer_name": "Khách", "receipt_method": "cash", "receipt_date": _ngay(0),
        "amount": 300_000, "content": "Thu tiền",
    }, headers=h)
    assert r.status_code == 201, r.text
    assert _tra_lai(client, h, so_tien=100_000, customer_id=kh).status_code == 201

    man = client.get("/api/accounting/receivables", params={"q": "TL4"}, headers=h)
    assert man.status_code == 200, man.text
    assert man.json()["items"][0]["total_due"] == 300_000
    ngan = client.get(f"/api/accounting/receivables/{kh}", headers=h).json()
    hd = ngan["items"][0]
    # Đã thu giữ số thật của phiếu; tiền trả lại đứng riêng ở `hoan_khong_don` (17/10/2026).
    assert (hd["deposit_offset_amount"], hd["direct_received_amount"], hd["hoan_khong_don"],
            hd["remaining_amount"]) == (0, 300_000, 100_000, 300_000)


def test_ncc_hoan_tien_gan_thang_ncc_va_vao_cong_no_phai_tra(client):
    h = _headers(client)
    ncc = _supplier(client, h, name="NCC Hoàn Tiền")

    r = client.post("/api/accounting/payables/999999/refund-receipts", json={
        "payer_name": "X", "receipt_method": "cash", "receipt_date": _ngay(0),
        "amount": 1, "content": "x"}, headers=h)
    assert r.status_code == 404

    r = client.post(f"/api/accounting/payables/{ncc['id']}/refund-receipts", json={
        "payer_name": "NCC Hoàn Tiền", "receipt_method": "cash", "receipt_date": _ngay(0),
        "amount": 400_000, "content": "Hoàn tiền hàng lỗi"}, headers=h)
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["source_type"] == "purchase_refund" and p["supplier_id"] == ncc["id"]
    assert p["supplier_name"] == "NCC Hoàn Tiền" and p["payment_voucher_id"] is None
    assert p["muc_thu_chi_id"] is None and p["muc_thu_chi_ten"] == "Nhà cung cấp hoàn tiền"

    # NCC hoàn tiền ⇒ PS Có của đúng NCC đó (nợ tăng trở lại), không rơi vào dòng không tên.
    bc = _bao_cao(client, h, "payables", tu=_ngay(30), den=_ngay(0))
    d = _dong(bc, "NCC Hoàn Tiền")
    assert (d["ps_no"], d["ps_co"], d["cuoi_co"]) == (0, 400_000, 400_000)
    assert d["hoan"] == 400_000, "giao diện trừ khỏi Nhận hàng, tính là trả âm"
    assert all(x["doi_tuong_id"] is not None for x in bc["items"])
    _kiem_can_so(bc)


def test_don_huy_con_giu_coc_loc_duoc_o_don_hang_va_danh_dau_o_cong_no_phai_thu(client):
    """13/10/2026: đơn huỷ còn giữ cọc ⇒ ô "Đang chờ" = "Chờ trả lại cọc" (lọc + đếm), dòng mang
    `deposit_refunded`; Công nợ phải thu đánh dấu khách (kể cả khách không có hoá đơn nào), lọc được
    bằng nút `tra_coc`, ngăn khách liệt kê từng đơn. Trả lại hết ⇒ RỤNG khỏi cả ba chỗ."""
    h = _headers(client)
    huy, _ = _sales_order(suffix="TC1")
    _add_deposit(huy, 300_000)
    kh = _khach_cua_don(huy, huy=True)
    con_chay, _ = _sales_order(suffix="TC2")
    _add_deposit(con_chay, 200_000)

    def _loc():
        r = client.get("/api/orders", params={"dang_cho": "tra_coc", "size": 50}, headers=h)
        assert r.status_code == 200, r.text
        return r.json()["items"]

    ds = _loc()
    assert [d["id"] for d in ds] == [huy]
    assert (ds[0]["deposit_received"], ds[0]["deposit_refunded"], ds[0]["dang_cho"]) == (300_000, 0, ["tra_coc"])
    assert client.get("/api/orders/dang-cho-dem", headers=h).json()["tra_coc"] == 1

    man = client.get("/api/accounting/receivables", params={"filter": "tra_coc"}, headers=h).json()
    assert [(i["customer_id"], i["cho_tra_lai"], i["total_due"]) for i in man["items"]] == [(kh, 300_000, 0)]
    assert man["the_loc"]["tra_coc"] == 1
    ngan = client.get(f"/api/accounting/receivables/{kh}", headers=h).json()
    assert [(d["order_id"], d["da_nhan"], d["con_lai"]) for d in ngan["tien_dang_de"]] == [(huy, 300_000, 300_000)]

    # Trả một phần: vẫn còn giữ.
    assert _tra_lai(client, h, so_tien=100_000, customer_id=kh, order_id=huy).status_code == 201
    ds = _loc()
    assert (ds[0]["deposit_refunded"], len(ds)) == (100_000, 1)
    # Trả hết: rụng khỏi lọc, số đếm, nút công nợ và ngăn khách.
    assert _tra_lai(client, h, so_tien=200_000, customer_id=kh, order_id=huy).status_code == 201
    assert _loc() == []
    assert client.get("/api/orders/dang-cho-dem", headers=h).json()["tra_coc"] == 0
    man = client.get("/api/accounting/receivables", params={"filter": "tra_coc"}, headers=h).json()
    assert man["items"] == [] and man["the_loc"]["tra_coc"] == 0
    assert client.get(f"/api/accounting/receivables/{kh}", headers=h).json()["tien_dang_de"] == []
    don = client.get("/api/orders", params={"status": "cancelled", "size": 50}, headers=h).json()["items"]
    assert [(d["deposit_refunded"], d["dang_cho"]) for d in don if d["id"] == huy] == [(300_000, [])]
