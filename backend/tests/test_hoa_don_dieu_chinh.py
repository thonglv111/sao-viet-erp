"""Hóa đơn điều chỉnh GIẢM để hoàn tiền chiết khấu cho khách (18/10/2026).

Hóa đơn gốc giữ 100%; điều chỉnh giảm bớt phần khách phải trả. Khách đã trả đủ thì phần dư thành việc
trả lại ở Phiếu chi (Chờ trả lại khách), mang số hóa đơn điều chỉnh làm chứng từ gốc.
"""
from __future__ import annotations

from app.db import SessionLocal
from app.models.order import OrderLine
from tests.test_ban_hang_cho_thu_chi import (
    URL_CHO_CHI, _dong_hd, _dong_tra, _ghi_hd, _thu_hd, _tra_lai,
)
from tests.test_bao_cao_cong_no import _ngay
from tests.test_sales_invoices_api import _headers, _sales_order


def _dieu_chinh(client, h, hd_id: int, so: str, tien: int | None = None, ky_hieu: str = "1C26DC"):
    body = {"adj_symbol": ky_hieu, "adj_number": so, "adj_date": _ngay(0)}
    if tien is not None:
        body["amount_vnd"] = tien
    return client.post(f"/api/accounting/sales-invoices/{hd_id}/dieu-chinh", json=body, headers=h)


def _so_hd_cua_don(client, h, order_id: int) -> dict:
    return client.get(f"/api/accounting/sales-invoices?order_id={order_id}", headers=h).json()


def _hd_trong_ngan(client, h, order_id: int, hd_id: int) -> dict:
    return next(i for i in _so_hd_cua_don(client, h, order_id)["items"] if i["id"] == hd_id)


def test_dieu_chinh_chua_thu_giam_phai_thu_cua_hoa_don(client):
    h = _headers(client)
    don, _ = _sales_order(total=1_000_000, suffix="DC1")
    hd = _ghi_hd(client, h, don, "DC-0001", 1_000_000)

    r = _dieu_chinh(client, h, hd["id"], "DC-A1", 50_000)
    assert r.status_code == 201, r.text
    assert (r.json()["amount_vnd"], r.json()["reason"], r.json()["status"]) == (50_000, "Chiết khấu", "issued")

    m = _hd_trong_ngan(client, h, don, hd["id"])
    # Giá trị hóa đơn gốc giữ nguyên, còn phải thu giảm đúng số điều chỉnh.
    assert (m["amount_vnd"], m["dieu_chinh_amount"], m["remaining_amount"]) == (1_000_000, 50_000, 950_000)
    assert [a["adj_number"] for a in m["dieu_chinh"]] == ["DC-A1"]
    assert _dong_hd(client, h, hd["id"])["con_no"] == 950_000
    # Khách chưa trả đồng nào ⇒ không có gì để trả lại.
    assert _dong_tra(client, h, don) is None

    # Trả nốt phần đã giảm là hóa đơn hết nợ.
    _thu_hd(client, h, hd["id"], 950_000)
    assert _dong_hd(client, h, hd["id"]) is None
    assert _dong_tra(client, h, don) is None


def test_khach_da_tra_du_roi_dieu_chinh_thanh_viec_tra_lai(client):
    h = _headers(client)
    don, kh = _sales_order(total=1_000_000, suffix="DC2")
    hd = _ghi_hd(client, h, don, "DC-0002", 1_000_000)
    _thu_hd(client, h, hd["id"], 1_000_000)
    assert _dong_tra(client, h, don) is None

    assert _dieu_chinh(client, h, hd["id"], "DC-A2", 50_000).status_code == 201
    d = _dong_tra(client, h, don)
    assert d is not None and d["con_lai"] == 50_000
    # Chứng từ gốc của khoản trả lại = hóa đơn điều chỉnh.
    assert [(x["so_hoa_don"], x["so_tien"], x["hoa_don_goc"]) for x in d["hoa_don_dieu_chinh"]] == [
        ("1C26DC DC-A2", 50_000, "1C26TSV DC-0002")]
    assert _hd_trong_ngan(client, h, don, hd["id"])["remaining_amount"] == 0

    # Trần trả lại đúng bằng phần dư.
    r = _tra_lai(client, h, kh=kh, don=don, tien=50_001)
    assert r.status_code == 422, r.text
    assert _tra_lai(client, h, kh=kh, don=don, tien=20_000).status_code == 201
    assert _dong_tra(client, h, don)["con_lai"] == 30_000
    # Ngăn đơn báo cùng số với hàng chờ trả lại, không tự tính lại từ phiếu thu.
    assert _so_hd_cua_don(client, h, don)["cho_tra_lai"] == 30_000
    assert _tra_lai(client, h, kh=kh, don=don, tien=30_000).status_code == 201
    assert _dong_tra(client, h, don) is None
    assert _so_hd_cua_don(client, h, don)["cho_tra_lai"] == 0


def test_huy_dieu_chinh_chan_khi_da_tra_lai_khach(client):
    h = _headers(client)
    don, kh = _sales_order(total=1_000_000, suffix="DC3")
    hd = _ghi_hd(client, h, don, "DC-0003", 1_000_000)
    _thu_hd(client, h, hd["id"], 1_000_000)
    adj = _dieu_chinh(client, h, hd["id"], "DC-A3", 50_000).json()
    assert _tra_lai(client, h, kh=kh, don=don, tien=50_000).status_code == 201

    r = client.post(f"/api/accounting/sales-invoice-adjustments/{adj['id']}/cancel",
                    json={"reason": "Nhập nhầm"}, headers=h)
    assert r.status_code == 409, r.text
    assert "phiếu chi" in r.text.lower()
    assert _hd_trong_ngan(client, h, don, hd["id"])["dieu_chinh_amount"] == 50_000


def test_huy_dieu_chinh_khi_chua_tra_lai_dua_hoa_don_ve_nguyen(client):
    h = _headers(client)
    don, _ = _sales_order(total=1_000_000, suffix="DC4")
    hd = _ghi_hd(client, h, don, "DC-0004", 1_000_000)
    _thu_hd(client, h, hd["id"], 1_000_000)
    adj = _dieu_chinh(client, h, hd["id"], "DC-A4", 50_000).json()
    assert _dong_tra(client, h, don) is not None

    r = client.post(f"/api/accounting/sales-invoice-adjustments/{adj['id']}/cancel",
                    json={"reason": "Nhập nhầm"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"
    assert _dong_tra(client, h, don) is None
    m = _hd_trong_ngan(client, h, don, hd["id"])
    assert (m["dieu_chinh_amount"], m["remaining_amount"]) == (0, 0)
    assert [(a["adj_number"], a["status"]) for a in m["dieu_chinh"]] == [("DC-A4", "cancelled")]
    # Hủy rồi thì ghi lại cùng số vẫn bị chặn (số hóa đơn là duy nhất).
    assert _dieu_chinh(client, h, hd["id"], "DC-A4", 10_000).status_code == 409
    # Hủy hai lần thì từ chối.
    assert client.post(f"/api/accounting/sales-invoice-adjustments/{adj['id']}/cancel",
                       json={"reason": "x"}, headers=h).status_code == 409


def test_dieu_chinh_khong_vuot_hoa_don_va_phai_hop_le(client):
    h = _headers(client)
    don, _ = _sales_order(total=1_000_000, suffix="DC5")
    hd = _ghi_hd(client, h, don, "DC-0005", 400_000)

    assert _dieu_chinh(client, h, hd["id"], "DC-A5", 400_001).status_code == 422
    assert _dieu_chinh(client, h, hd["id"], "DC-A5", 300_000).status_code == 201
    # Tổng điều chỉnh còn hiệu lực không vượt hóa đơn gốc.
    r = _dieu_chinh(client, h, hd["id"], "DC-A6", 100_001)
    assert r.status_code == 422 and "100,000" in r.text
    # Không có chiết khấu gợi ý và không gõ số ⇒ phải nhập.
    assert _dieu_chinh(client, h, hd["id"], "DC-A7").status_code == 422
    # Trùng ký hiệu + số.
    assert _dieu_chinh(client, h, hd["id"], "DC-A5", 10_000).status_code == 409
    # Ngày tương lai bị từ chối.
    r = client.post(f"/api/accounting/sales-invoices/{hd['id']}/dieu-chinh", json={
        "adj_symbol": "1C26DC", "adj_number": "DC-A8", "adj_date": _ngay(2), "amount_vnd": 1_000,
    }, headers=h)
    assert r.status_code == 422


def test_hoa_don_da_huy_khong_dieu_chinh_duoc(client):
    h = _headers(client)
    don, _ = _sales_order(total=1_000_000, suffix="DC6")
    hd = _ghi_hd(client, h, don, "DC-0006", 1_000_000)
    assert client.post(f"/api/accounting/sales-invoices/{hd['id']}/cancel",
                       json={"reason": "Sai"}, headers=h).status_code == 200
    assert _dieu_chinh(client, h, hd["id"], "DC-A9", 1_000).status_code == 409


def test_goi_y_dieu_chinh_theo_chiet_khau_cua_don(client):
    h = _headers(client)
    don, _ = _sales_order(total=1_000_000, suffix="DC7")
    db = SessionLocal()
    try:
        # Chiết khấu 100.000 nằm trong 1.000.000 (không VAT) ⇒ 10% mỗi hóa đơn.
        db.query(OrderLine).filter(OrderLine.order_id == don).update({"chiet_khau": 100_000})
        db.commit()
    finally:
        db.close()
    hd = _ghi_hd(client, h, don, "DC-0007", 600_000)
    assert _hd_trong_ngan(client, h, don, hd["id"])["ck_goi_y"] == 60_000

    # Bỏ trống số tiền ⇒ lấy đúng số gợi ý; sau đó hết gợi ý.
    r = _dieu_chinh(client, h, hd["id"], "DC-B1")
    assert r.status_code == 201 and r.json()["amount_vnd"] == 60_000
    assert _hd_trong_ngan(client, h, don, hd["id"])["ck_goi_y"] == 0


def test_so_cong_no_phai_thu_ghi_dieu_chinh_la_ps_co(client):
    """Sổ 131: hóa đơn gốc ghi Nợ, hóa đơn điều chỉnh ghi Có — dư cuối giảm đúng số điều chỉnh."""
    h = _headers(client)
    don, kh = _sales_order(total=1_000_000, suffix="DC8")
    hd = _ghi_hd(client, h, don, "DC-0008", 1_000_000)
    assert _dieu_chinh(client, h, hd["id"], "DC-C1", 50_000).status_code == 201

    r = client.get("/api/accounting/receivables", headers=h)
    assert r.status_code == 200, r.text
    dong = next(i for i in r.json()["items"] if i["customer_id"] == kh)
    assert dong["total_due"] == 950_000
    # "Bán trong kỳ" là doanh số ròng: hóa đơn điều chỉnh phát hành cùng kỳ được trừ.
    r = client.get("/api/accounting/receivables", params={"tu_ngay": _ngay(5), "den_ngay": _ngay(0)}, headers=h)
    assert r.status_code == 200, r.text
    assert next(i for i in r.json()["items"] if i["customer_id"] == kh)["ban_trong_ky"] == 950_000
