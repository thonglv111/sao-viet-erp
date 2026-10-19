"""Khoá kỳ công nợ phải CHẶN chứng từ có ngày trong kỳ (lỗi #46 bấm thử 18/10/2026).

Kỳ phải thu "E2E Ky phai thu den 18/10" đã chốt mà vẫn lập được PT00028 ngày 18/10 vào hoá đơn
00000104 rồi huỷ được, không một lời cảnh báo: `is_locked` viết sẵn nhưng không nơi nào gọi, số "đã
chốt" của kỳ đổi được bất cứ lúc nào.

Luật: chứng từ có ngày nằm trong kỳ đã khoá của ĐÚNG phân hệ thì không lập, không sửa, không huỷ được.
Phải thu (131): hoá đơn bán, phiếu thu của khách, phiếu chi trả lại khách. Phải trả (331): phiếu chi
cho NCC, phiếu thu NCC hoàn tiền. Thu/chi khác không thuộc sổ công nợ nào, không bị chặn. Khoá phân
hệ này không đụng phân hệ kia. Mở kỳ lại thì làm được như thường.
"""
from __future__ import annotations

from app.db import SessionLocal
from app.models.purchase import Supplier
from tests.test_bao_cao_cong_no import _ngay
from tests.test_ban_hang_cho_thu_chi import _ghi_hd, _huy_hd, _sua_don, _thu_hd, _tra_lai
from tests.test_sales_invoices_api import _headers, _invoice_payload, _sales_order


def _khoa(client, h, phan_he: str, *, hanh_dong: str = "khoa"):
    r = client.post("/api/accounting/khoa-so", headers=h, json={
        "phan_he": phan_he, "tu_ngay": _ngay(5), "den_ngay": _ngay(0), "hanh_dong": hanh_dong,
        "ten": f"Kỳ thử {phan_he}",
    })
    assert r.status_code == 201, r.text


def _bi_chan(r) -> None:
    assert r.status_code == 422, r.text
    assert "đã khoá" in r.json()["detail"]


def _ncc(suffix: str) -> int:
    db = SessionLocal()
    try:
        s = Supplier(code=f"NCC-KK-{suffix}", name=f"NCC khoá kỳ {suffix}")
        db.add(s)
        db.commit()
        return s.id
    finally:
        db.close()


def _ncc_hoan(client, h, ncc: int):
    return client.post(f"/api/accounting/payables/{ncc}/refund-receipts", headers=h, json={
        "payer_name": "NCC", "receipt_method": "cash", "receipt_date": _ngay(0),
        "amount": 50_000, "currency": "VND", "exchange_rate": 1, "content": "NCC hoàn tiền",
    })


def test_khoa_ky_phai_thu_chan_lap_huy_phieu_thu_va_hoa_don(client):
    h = _headers(client)
    don, _ = _sales_order(suffix="kk1")
    hd = _ghi_hd(client, h, don, "0000901", 500_000)
    pt = _thu_hd(client, h, hd["id"], 100_000)
    don2, _ = _sales_order(suffix="kk1b")
    _khoa(client, h, "phai_thu")

    _bi_chan(client.post("/api/accounting/sales-invoices", headers=h,
                         json=_invoice_payload(don2, number="0000902", amount=300_000)))
    _bi_chan(client.post(f"/api/accounting/sales-invoices/{hd['id']}/receipts", headers=h, json={
        "payer_name": "Khách", "receipt_method": "cash", "receipt_date": _ngay(0),
        "amount": 50_000, "content": "Thu tiếp",
    }))
    _bi_chan(client.post(f"/api/accounting/payment-receipts/{pt['id']}/cancel", headers=h,
                         json={"reason": "Nhầm"}))
    _bi_chan(_huy_hd(client, h, hd["id"]))
    _bi_chan(_tra_lai(client, h, kh=_sua_don(don), don=None, tien=10_000))


def test_khoa_ky_phai_tra_chan_ncc_hoan_khong_dung_phai_thu(client):
    h = _headers(client)
    ncc = _ncc("kk2")
    _khoa(client, h, "phai_tra")
    _bi_chan(_ncc_hoan(client, h, ncc))
    # Sổ phải thu không bị khoá theo.
    don, _ = _sales_order(suffix="kk2")
    assert client.post("/api/accounting/sales-invoices", headers=h,
                       json=_invoice_payload(don, number="0000903", amount=300_000)).status_code == 201


def test_mo_ky_lai_thi_lap_duoc(client):
    h = _headers(client)
    ncc = _ncc("kk3")
    _khoa(client, h, "phai_tra")
    _bi_chan(_ncc_hoan(client, h, ncc))
    _khoa(client, h, "phai_tra", hanh_dong="mo")
    assert _ncc_hoan(client, h, ncc).status_code == 201


def test_ngay_cu_trong_ky_khoa_van_bi_bat_khi_phien_tu_flush(client):
    """Rà cuối 19/10/2026: `loi_ky_khoa` đọc ngày CŨ sau khi `_xep` nạp `lines` — phiên bật autoflush
    thì lượt nạp đó flush lần sửa, `history` rỗng, chứng từ dời ra khỏi kỳ khoá lọt qua."""
    from datetime import date, timedelta

    from app.models.accounting import PaymentReceipt
    from app.services.cong_no_khoa_ky import loi_ky_khoa

    h = _headers(client)
    ncc = _ncc("af")
    pid = _ncc_hoan(client, h, ncc).json()["id"]
    _khoa(client, h, "phai_tra")
    db = SessionLocal()
    db.autoflush = True
    try:
        p = db.get(PaymentReceipt, pid)
        db.expire(p, ["lines"])
        p.receipt_date = date.today() + timedelta(days=40)
        assert "đã khoá" in (loi_ky_khoa(db, p) or "")
    finally:
        db.rollback()
        db.close()
