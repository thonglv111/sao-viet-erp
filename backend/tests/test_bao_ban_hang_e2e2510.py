"""Thông báo khối bán hàng (bấm thử 25/10/2026): "đủ cọc" tới sale ĐANG phụ trách khách (L-VAI-07);
tín hiệu hoá đơn bán gửi nhóm không kèm mã chứng từ (L-VAI-17)."""
from __future__ import annotations

from app.db import SessionLocal
from app.models.customer import Customer
from app.models.role import SCOPE_ALL, SCOPE_OWN
from app.realtime import hub

from .test_orders_api import _accepted_quote
from .thong_bao_helpers import admin, dang_nhap, tao_nguoi, tom_tat

_SALE = {"don_hang_ban": dict(can_read=True, scope=SCOPE_OWN)}


def test_du_coc_bao_sale_dang_phu_trach_khach(client):
    """Đơn tạo khi khách còn của A; điều chuyển khách sang B rồi thu đủ cọc → B nhận, A không."""
    ha = admin(client)
    uid_a = tao_nguoi("pv07_a", _SALE)
    uid_b = tao_nguoi("pv07_b", _SALE)
    db = SessionLocal()
    try:
        c = Customer(code="KH-PV07", name="KH PV07", sale_user_id=uid_a)
        db.add(c)
        db.commit()
        q = _accepted_quote(db, c)
        q.salesperson_id = uid_a
        db.commit()
        qid, cid = q.id, c.id
    finally:
        db.close()
    d = client.post("/api/orders", json={"source_type": "bao_gia", "quotation_id": qid,
                                         "deposit_pct": 50}, headers=ha).json()
    db = SessionLocal()
    try:
        db.get(Customer, cid).sale_user_id = uid_b
        db.commit()
    finally:
        db.close()
    ds: list[tuple[int, dict]] = []
    goc = hub.publish
    hub.publish = lambda uid, ev: (ds.append((uid, ev)), goc(uid, ev))[1]
    try:
        r = client.post(f"/api/orders/{d['id']}/deposit-receipts",
                        json={"receipt_method": "cash", "amount": 10_000_000}, headers=ha)
    finally:
        hub.publish = goc
    assert r.status_code == 200 and r.json()["deposit_ok"], r.text
    assert [u for u, ev in ds if ev.get("type") == "order_deposit_ok"] == [uid_b]
    assert tom_tat(client, dang_nhap(client, "pv07_b"))["don_hang_ban"]["loai"] == "don_du_coc"
    assert "don_hang_ban" not in tom_tat(client, dang_nhap(client, "pv07_a"))


def test_tin_hieu_hoa_don_ban_gui_nhom_khong_kem_ma(monkeypatch):
    from app.routers.accounting import _notify_accounting_changed

    nhom: list[tuple[dict, dict]] = []
    rieng: list[tuple[int, dict]] = []
    monkeypatch.setattr(hub, "gui", lambda ev, **kw: nhom.append((ev, kw)))
    monkeypatch.setattr(hub, "publish", lambda uid, ev: rieng.append((uid, ev)))
    _notify_accounting_changed("DH002", event_type="sales_invoice_receipt_created",
                               recipient_user_id=7, receipt_code="PT-1", invoice_id=3)
    assert nhom == [({"type": "sales_invoice_receipt_created"}, nhom[0][1])]
    assert rieng and rieng[0][0] == 7 and rieng[0][1]["code"] == "DH002"
    # Sự kiện mua / kế toán khác giữ nguyên payload đầy đủ.
    nhom.clear()
    _notify_accounting_changed("PC-1", voucher_code="PC-1")
    assert nhom[0][0]["code"] == "PC-1"
