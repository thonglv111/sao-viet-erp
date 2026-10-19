"""Sửa đơn nháp phải XOÁ TRẮNG được PO khách, ngày hẹn giao, % cọc (lỗi #52 bấm thử 18/10/2026).

Giao diện gửi `null` khi ô trống, còn `order_service.update` bỏ qua mọi trường `None` ⇒ xoá rồi Lưu
thì giá trị cũ ở lại mà Nhật ký vẫn ghi "Cập nhật đơn". Sale tưởng đã bỏ cọc 30% mà đơn vẫn đòi cọc.

Luật: trường KHÔNG gửi = giữ nguyên; trường GỬI `null` = xoá (phân biệt bằng `model_fields_set`).
Nhật ký ghi đúng những trường đã đổi; không đổi gì thì không ghi dòng "Cập nhật đơn".
"""
from __future__ import annotations

from datetime import date

from app.db import SessionLocal
from app.models.audit import AuditLog
from app.models.customer import Customer

from .test_orders_api import _accepted_quote
from .thong_bao_helpers import admin


def _don_nhap(client, h) -> dict:
    db = SessionLocal()
    try:
        c = Customer(code="KH-XOA", name="KH xoá trắng")
        db.add(c)
        db.commit()
        qid = _accepted_quote(db, c).id
    finally:
        db.close()
    r = client.post("/api/orders", json={"source_type": "bao_gia", "quotation_id": qid,
                                         "deposit_pct": 30, "customer_po_no": "PO-CU",
                                         "delivery_committed_date": date.today().isoformat()},
                    headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _nhat_ky(order_id: int) -> list[str]:
    db = SessionLocal()
    try:
        return [a.detail for a in db.query(AuditLog).filter_by(action="update_order",
                                                                target=f"order:{order_id}")]
    finally:
        db.close()


def test_sua_don_nhap_xoa_trang_po_ngay_coc(client):
    h = admin(client)
    d = _don_nhap(client, h)
    u = client.put(f"/api/orders/{d['id']}", json={"customer_po_no": None,
                                                    "delivery_committed_date": None,
                                                    "deposit_pct": None}, headers=h)
    assert u.status_code == 200, u.text
    o = u.json()
    assert o["customer_po_no"] is None
    assert o["delivery_committed_date"] is None
    assert o["deposit_pct"] is None
    ghi = _nhat_ky(d["id"])
    assert len(ghi) == 1 and all(t in ghi[0] for t in ("PO khách", "ngày hẹn giao", "% cọc")), ghi


def test_khong_gui_truong_thi_giu_nguyen_va_khong_ghi_nhat_ky(client):
    h = admin(client)
    d = _don_nhap(client, h)
    u = client.put(f"/api/orders/{d['id']}", json={"delivery_note": None}, headers=h)
    assert u.status_code == 200, u.text
    o = u.json()
    assert o["customer_po_no"] == "PO-CU" and o["deposit_pct"] == 30
    assert _nhat_ky(d["id"]) == []
