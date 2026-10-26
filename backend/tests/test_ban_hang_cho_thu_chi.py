"""Hàng việc tiền của đơn bán (17/10/2026).

Phiếu thu: "Đơn hàng chờ thu" = cọc đơn đã chốt chưa đủ + hoá đơn khách chưa trả hết.
Phiếu chi: "Chờ trả lại khách" = đơn hết chỗ ghi hoá đơn (ghi đủ / đã huỷ) mà tiền khách đưa còn dư.
Huỷ hoá đơn khách đã trả: phiếu thu giữ nguyên, tiền về quỹ của đơn và trừ vào hoá đơn ghi lại.
"""
from __future__ import annotations

from app.db import SessionLocal
from app.models.order import STATUS_CANCELLED, Order
from tests.test_bao_cao_cong_no import _ngay
from tests.test_sales_invoices_api import _add_deposit, _headers, _invoice_payload, _sales_order

URL_CHO_THU = "/api/accounting/don-hang-cho-thu"
URL_CHO_CHI = "/api/accounting/tra-lai-khach-cho-chi"


def _sua_don(order_id: int, **cot) -> int:
    db = SessionLocal()
    try:
        don = db.get(Order, order_id)
        for k, v in cot.items():
            setattr(don, k, v)
        db.commit()
        return don.customer_id
    finally:
        db.close()


def _ghi_hd(client, h, order_id: int, so: str, tien: int) -> dict:
    r = client.post("/api/accounting/sales-invoices",
                    json=_invoice_payload(order_id, number=so, amount=tien), headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _thu_hd(client, h, hd_id: int, tien: int) -> dict:
    r = client.post(f"/api/accounting/sales-invoices/{hd_id}/receipts", json={
        "payer_name": "Khách", "receipt_method": "cash", "receipt_date": _ngay(0),
        "amount": tien, "content": "Thu tiền hoá đơn",
    }, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _huy_hd(client, h, hd_id: int):
    return client.post(f"/api/accounting/sales-invoices/{hd_id}/cancel",
                       json={"reason": "Sai thông tin"}, headers=h)


def _tra_lai(client, h, *, kh: int, don: int, tien: int):
    return client.post("/api/accounting/payment-vouchers", json={
        "source_type": "customer_refund", "voucher_type": "cash", "payment_stage": "other",
        "voucher_date": _ngay(0), "amount": tien, "currency": "VND", "exchange_rate": 1,
        "content": "Trả lại tiền cho khách", "cash_recipient_name": "Khách",
        "customer_id": kh, "order_id": don,
    }, headers=h)


def _dong_coc(client, h, don: int):
    r = client.get(URL_CHO_THU, headers=h)
    assert r.status_code == 200, r.text
    return next((d for d in r.json()["coc"] if d["order_id"] == don), None)


def _dong_hd(client, h, hd: int):
    r = client.get(URL_CHO_THU, headers=h)
    assert r.status_code == 200, r.text
    return next((d for d in r.json()["hoa_don"] if d["invoice_id"] == hd), None)


def _dong_tra(client, h, don: int):
    r = client.get(URL_CHO_CHI, headers=h)
    assert r.status_code == 200, r.text
    return next((d for d in r.json() if d["order_id"] == don), None)


def test_coc_cho_thu_roi_hang_khi_thu_du(client):
    h = _headers(client)
    don, _ = _sales_order(total=1_000_000, suffix="CT1")
    _sua_don(don, deposit_pct=30)

    d = _dong_coc(client, h, don)
    assert d is not None
    assert (d["order_code"], d["can_thu"], d["da_thu"], d["con_thieu"]) == ("DH-HD-CT1", 300_000, 0, 300_000)

    _add_deposit(don, 100_000)
    assert _dong_coc(client, h, don)["con_thieu"] == 200_000
    _add_deposit(don, 200_000)
    assert _dong_coc(client, h, don) is None


def test_don_khong_coc_hoac_da_huy_khong_vao_hang_coc(client):
    h = _headers(client)
    khong_coc, _ = _sales_order(suffix="CT2")
    huy, _ = _sales_order(suffix="CT3")
    _sua_don(huy, deposit_pct=30, status=STATUS_CANCELLED)
    assert _dong_coc(client, h, khong_coc) is None
    assert _dong_coc(client, h, huy) is None


def test_hoa_don_cho_thu_roi_hang_khi_thu_het(client):
    h = _headers(client)
    don, _ = _sales_order(total=1_000_000, suffix="CT4")
    hd = _ghi_hd(client, h, don, "CT-0004", 600_000)

    d = _dong_hd(client, h, hd["id"])
    assert (d["order_code"], d["amount"], d["da_thu"], d["con_no"]) == ("DH-HD-CT4", 600_000, 0, 600_000)

    _thu_hd(client, h, hd["id"], 250_000)
    assert _dong_hd(client, h, hd["id"])["con_no"] == 350_000
    _thu_hd(client, h, hd["id"], 350_000)
    assert _dong_hd(client, h, hd["id"]) is None


def test_coc_don_khac_cung_khach_khong_tru_vao_hoa_don(client):
    """Hàng tính theo đơn: cọc đơn B không được làm hoá đơn đơn A (cùng khách) rời hàng."""
    h = _headers(client)
    a, kh = _sales_order(total=1_000_000, suffix="CT8")
    b, _ = _sales_order(total=10_000_000, suffix="CT9")
    _sua_don(b, customer_id=kh, deposit_pct=30)
    hd = _ghi_hd(client, h, a, "CT-0008", 1_000_000)

    _add_deposit(b, 2_000_000)
    assert _dong_hd(client, h, hd["id"])["con_no"] == 1_000_000
    assert _dong_coc(client, h, b)["con_thieu"] == 1_000_000


def test_huy_hoa_don_da_thu_tien_tru_vao_hoa_don_ghi_lai(client):
    h = _headers(client)
    don, _ = _sales_order(total=1_000_000, suffix="CT5")
    hd = _ghi_hd(client, h, don, "CT-0005", 1_000_000)
    _thu_hd(client, h, hd["id"], 400_000)

    r = _huy_hd(client, h, hd["id"])
    assert r.status_code == 200, r.text
    # Đơn còn chỗ ghi hoá đơn ⇒ tiền giữ lại để trừ, chưa phải việc trả lại.
    assert _dong_tra(client, h, don) is None

    moi = _ghi_hd(client, h, don, "CT-0005B", 1_000_000)
    assert (moi["deposit_offset_amount"], moi["remaining_amount"]) == (400_000, 600_000)
    d = _dong_hd(client, h, moi["id"])
    assert (d["con_no"], d["deposit_offset_amount"]) == (600_000, 400_000)
    assert _dong_tra(client, h, don) is None
    # Khối Hoá đơn trong ngăn đơn ghi phiếu thu của hoá đơn đã huỷ ở dòng trừ.
    so = client.get(f"/api/accounting/sales-invoices?order_id={don}", headers=h).json()
    assert [(p["invoice_id"], p["amount"]) for p in so["phieu_thu_hd_huy"]] == [(hd["id"], 400_000)]


def test_don_huy_sau_khi_huy_hoa_don_da_thu_vao_hang_tra_lai(client):
    h = _headers(client)
    don, _ = _sales_order(total=1_000_000, suffix="CT6")
    _add_deposit(don, 300_000)
    hd = _ghi_hd(client, h, don, "CT-0006", 1_000_000)
    assert hd["deposit_offset_amount"] == 300_000
    _thu_hd(client, h, hd["id"], 700_000)
    assert _huy_hd(client, h, hd["id"]).status_code == 200
    kh = _sua_don(don, status=STATUS_CANCELLED)

    d = _dong_tra(client, h, don)
    assert d is not None
    assert (d["don_huy"], d["hoa_don_huy"], d["con_lai"]) == (True, ["CT-0006"], 1_000_000)

    # Trần trả lại = cọc + tiền hoá đơn đã huỷ.
    r = _tra_lai(client, h, kh=kh, don=don, tien=1_000_001)
    assert r.status_code == 422 and "1.000.000 đ" in r.text
    assert _tra_lai(client, h, kh=kh, don=don, tien=400_000).status_code == 201
    assert _dong_tra(client, h, don)["con_lai"] == 600_000
    assert _tra_lai(client, h, kh=kh, don=don, tien=600_000).status_code == 201
    assert _dong_tra(client, h, don) is None


def test_don_dang_chay_con_cho_ghi_thi_khong_tra_lai(client):
    h = _headers(client)
    don, _ = _sales_order(total=1_000_000, suffix="CT7")
    hd = _ghi_hd(client, h, don, "CT-0007", 500_000)
    _thu_hd(client, h, hd["id"], 500_000)
    kh = _huy_hd(client, h, hd["id"]).json()["customer_id"]

    r = _tra_lai(client, h, kh=kh, don=don, tien=100_000)
    assert r.status_code == 422 and "chưa huỷ" in r.text


def test_don_huy_chi_co_tien_hoa_don_huy_vao_co_tra_lai_va_cong_no(client):
    """Đơn huỷ KHÔNG cọc nhưng còn tiền của hoá đơn đã huỷ: cờ chờ trả lại ở Đơn hàng, khối Đơn đã huỷ
    của Công nợ phải thu và số còn giữ trên dòng đơn đều đếm khoản này."""
    h = _headers(client)
    don, _ = _sales_order(total=1_000_000, suffix="CT10")
    hd = _ghi_hd(client, h, don, "CT-0010", 1_000_000)
    _thu_hd(client, h, hd["id"], 250_000)
    assert _huy_hd(client, h, hd["id"]).status_code == 200
    kh = _sua_don(don, status=STATUS_CANCELLED)

    ds = client.get("/api/orders", params={"dang_cho": "tra_coc", "size": 50}, headers=h).json()["items"]
    assert [(d["id"], d["tien_khach_da_nhan"], d["tien_khach_con_giu"], d["dang_cho"]) for d in ds] == [
        (don, 250_000, 250_000, ["tra_coc"])]
    chi_tiet = client.get(f"/api/orders/{don}", headers=h).json()
    assert (chi_tiet["tien_khach_da_nhan"], chi_tiet["tien_khach_con_giu"]) == (250_000, 250_000)
    ngan = client.get(f"/api/accounting/receivables/{kh}", headers=h).json()
    assert [(d["order_id"], d["da_nhan"], d["da_tra_lai"], d["con_lai"]) for d in ngan["tien_dang_de"]] == [
        (don, 250_000, 0, 250_000)]

    assert _tra_lai(client, h, kh=kh, don=don, tien=250_000).status_code == 201
    assert client.get("/api/orders", params={"dang_cho": "tra_coc", "size": 50}, headers=h).json()["items"] == []
    assert client.get(f"/api/accounting/receivables/{kh}", headers=h).json()["tien_dang_de"] == []
    chi_tiet = client.get(f"/api/orders/{don}", headers=h).json()
    assert (chi_tiet["tien_khach_da_nhan"], chi_tiet["tien_khach_con_giu"], chi_tiet["deposit_refunded"]) == (
        250_000, 0, 250_000)


def _don_tu_bao_gia(client, ha, *, coc: int, po: str) -> dict:
    from datetime import date

    from app.models.customer import Customer
    from tests.test_orders_api import _accepted_quote

    db = SessionLocal()
    try:
        c = Customer(code=f"KH-{po}", name=f"KH {po}")
        db.add(c)
        db.commit()
        bg = _accepted_quote(db, c).id
    finally:
        db.close()
    r = client.post("/api/orders", json={"source_type": "bao_gia", "quotation_id": bg, "deposit_pct": coc},
                    headers=ha)
    assert r.status_code == 201, r.text
    d = r.json()
    u = client.put(f"/api/orders/{d['id']}", json={"customer_po_no": po,
                                                    "delivery_committed_date": date.today().isoformat()},
                   headers=ha)
    assert u.status_code == 200, u.text
    return d


def test_cham_thanh_ben_khi_khoan_moi_vao_hang(client):
    """Ghi hoá đơn ⇒ chấm Phiếu thu; chốt đơn còn thiếu cọc ⇒ chấm Phiếu thu; huỷ đơn còn giữ tiền
    khách ⇒ chấm Phiếu chi. Chấm tới người LẬP được phiếu, người chỉ xem thì không."""
    from app.models.role import SCOPE_ALL
    from tests.thong_bao_helpers import dang_nhap, tao_nguoi, tom_tat

    ha = _headers(client)
    tao_nguoi("kt_thu_chi", {"phieu_thu": dict(can_read=True, can_create=True, scope=SCOPE_ALL),
                             "phieu_chi": dict(can_read=True, can_create=True, scope=SCOPE_ALL)})
    tao_nguoi("kt_chi_xem", {"phieu_thu": dict(can_read=True, scope=SCOPE_ALL),
                             "phieu_chi": dict(can_read=True, scope=SCOPE_ALL)})
    hk, hx = dang_nhap(client, "kt_thu_chi"), dang_nhap(client, "kt_chi_xem")

    don, _ = _sales_order(total=1_000_000, suffix="CT11")
    _ghi_hd(client, ha, don, "CT-0011", 400_000)
    tt = tom_tat(client, hk)
    assert (tt["phieu_thu"]["loai"], tt["phieu_thu"]["ma"]) == ("hoa_don_cho_thu", "CT-0011")
    assert "phieu_thu" not in tom_tat(client, hx)

    d = _don_tu_bao_gia(client, ha, coc=50, po="PO-CT12")
    ch = client.post(f"/api/orders/{d['id']}/confirm", headers=ha)
    assert ch.status_code == 200, ch.text
    tt = tom_tat(client, hk)
    assert (tt["phieu_thu"]["loai"], tt["phieu_thu"]["ma"]) == ("coc_cho_thu", d["order_no"])
    assert "phieu_chi" not in tt

    _add_deposit(d["id"], 100_000)
    r = client.post(f"/api/orders/{d['id']}/cancel", json={"reason": "Khách huỷ", "fault": "khach"}, headers=ha)
    assert r.status_code == 200, r.text
    tt = tom_tat(client, hk)
    assert (tt["phieu_chi"]["loai"], tt["phieu_chi"]["ma"]) == ("tra_lai_khach", d["order_no"])
    assert "phieu_chi" not in tom_tat(client, hx)


def test_tra_lai_khong_gan_don_cong_no_lai_hoa_don_muon_nhat(client):
    """Tiền trả lại khách KHÔNG gắn đơn (hàng lỗi) cộng nợ lại vào hoá đơn hạn muộn nhất của khách —
    hàng chờ thu, ngăn Công nợ, khối Hoá đơn của đơn và trần phiếu thu cùng thấy (dữ liệu dev: BIBICA).
    Quỹ tiền của đơn không đổi: tiền trả ngoài đơn không làm đơn thành "chờ trả lại"."""
    h = _headers(client)
    don, kh = _sales_order(total=1_000_000, suffix="CT20")
    hd1 = _ghi_hd(client, h, don, "CT-0020", 400_000)
    hd2 = _ghi_hd(client, h, don, "CT-0021", 600_000)
    _thu_hd(client, h, hd1["id"], 400_000)
    _thu_hd(client, h, hd2["id"], 600_000)
    assert _dong_hd(client, h, hd2["id"]) is None

    r = _tra_lai(client, h, kh=kh, don=None, tien=300_000)
    assert r.status_code == 201, r.text

    assert _dong_hd(client, h, hd1["id"]) is None
    # Khoản cộng lại đứng RIÊNG: Đã thu giữ số thật của phiếu, Giá trị + cộng lại − Đã thu = Còn nợ.
    cho = _dong_hd(client, h, hd2["id"])
    assert (cho["amount"], cho["hoan_khong_don"], cho["da_thu"], cho["con_no"]) == (
        600_000, 300_000, 600_000, 300_000)
    ngan = client.get(f"/api/accounting/receivables/{kh}", headers=h).json()
    assert ngan["total_due"] == 300_000
    dong = next(i for i in ngan["items"] if i["invoice_id"] == hd2["id"])
    assert (dong["amount"], dong["deposit_offset_amount"], dong["direct_received_amount"],
            dong["remaining_amount"], dong["hoan_khong_don"]) == (600_000, 0, 600_000, 300_000, 300_000)
    assert ngan["tien_dang_de"] == []
    khoi = client.get("/api/accounting/sales-invoices", params={"order_id": don}, headers=h).json()
    assert {i["id"]: i["remaining_amount"] for i in khoi["items"]} == {hd1["id"]: 0, hd2["id"]: 300_000}
    assert _dong_tra(client, h, don) is None

    vuot = client.post(f"/api/accounting/sales-invoices/{hd2['id']}/receipts", json={
        "payer_name": "Khách", "receipt_method": "cash", "receipt_date": _ngay(0),
        "amount": 300_001, "content": "Thu lại",
    }, headers=h)
    assert vuot.status_code == 422, vuot.text
    _thu_hd(client, h, hd2["id"], 300_000)
    assert _dong_hd(client, h, hd2["id"]) is None


def test_doi_chieu_phieu_thu_tinh_ca_tien_tra_lai_ngoai_don(client):
    """Ngăn phiếu thu "Còn nợ sau phiếu này" phải cùng số hàng chờ thu / Công nợ phải thu: hoá đơn được
    cộng nợ lại tiền trả khách ngoài đơn thì còn nợ sau phiếu tính cả khoản đó (bấm thử 18/10/2026:
    phiếu gộp ghi 748.989 trong khi hàng chờ ghi 798.989 — lệch đúng 50.000 trả lại ngoài đơn)."""
    h = _headers(client)
    don, kh = _sales_order(total=1_000_000, suffix="CT22")
    hd = _ghi_hd(client, h, don, "CT-0022", 1_000_000)
    _thu_hd(client, h, hd["id"], 1_000_000)
    assert _tra_lai(client, h, kh=kh, don=None, tien=300_000).status_code == 201

    pt = _thu_hd(client, h, hd["id"], 100_000)
    ct = client.get(f"/api/accounting/payment-receipts/{pt['id']}", headers=h).json()
    assert (ct["truoc_do"], ct["con_no_sau"]) == (1_000_000, 200_000)
    assert _dong_hd(client, h, hd["id"])["con_no"] == 200_000
