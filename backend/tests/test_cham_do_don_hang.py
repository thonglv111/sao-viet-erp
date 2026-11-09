"""Chấm đỏ Đơn hàng bán + Kế hoạch SX: đơn chờ cọc → người ghi cọc (Phiếu thu → Tạo); đủ cọc → Sale;
chuyển xuống sản xuất → người Xem Kế hoạch SX (một lần mỗi đơn)."""
from datetime import date

from app.db import SessionLocal
from app.models.customer import Customer
from app.models.module_notification import ModuleNotification
from app.models.role import SCOPE_ALL

from .test_orders_api import _accepted_quote
from .thong_bao_helpers import admin, dang_nhap, tao_nguoi, tom_tat


def _bao_gia_da_chot() -> int:
    db = SessionLocal()
    try:
        c = Customer(code="KH-CHAM", name="KH chấm")
        db.add(c)
        db.commit()
        return _accepted_quote(db, c).id
    finally:
        db.close()


def test_cho_coc_du_coc_va_chuyen_san_xuat(client):
    ha = admin(client)
    tao_nguoi("ke_toan_coc", {"don_hang_ban": dict(can_read=True, scope=SCOPE_ALL),
                         "phieu_thu": dict(can_read=True, can_create=True, scope=SCOPE_ALL)})
    tao_nguoi("chi_xem_don", {"don_hang_ban": dict(can_read=True, scope=SCOPE_ALL)})
    # Đơn mới vào hàng chờ chỉ báo người có ô Giao đơn (08/11/2026); người làm lệnh chỉ nghe đơn giao
    # cho mình.
    tao_nguoi("ke_hoach", {"san_xuat": dict(can_read=True, can_reassign=True, scope=SCOPE_ALL)})
    tao_nguoi("lam_lenh_cham", {"san_xuat": dict(can_read=True, can_create=True, scope=SCOPE_ALL)})
    hk = dang_nhap(client, "ke_toan_coc")

    r = client.post("/api/orders", json={"source_type": "bao_gia", "quotation_id": _bao_gia_da_chot(),
                                         "deposit_pct": 50}, headers=ha)
    assert r.status_code == 201, r.text
    d = r.json()
    tt = tom_tat(client, hk)
    assert tt["don_hang_ban"]["loai"] == "don_cho_coc" and tt["don_hang_ban"]["ma"] == d["order_no"]
    assert "don_hang_ban" not in tom_tat(client, dang_nhap(client, "chi_xem_don"))

    c = client.post(f"/api/orders/{d['id']}/deposit-receipts",
                    json={"receipt_method": "cash", "amount": 500_000}, headers=hk)
    assert c.status_code == 200 and c.json()["deposit_ok"], c.text
    assert tom_tat(client, ha)["don_hang_ban"]["loai"] == "don_du_coc"

    u = client.put(f"/api/orders/{d['id']}", json={"customer_po_no": "PO1",
                                                    "delivery_committed_date": date.today().isoformat()},
                   headers=ha)
    assert u.status_code == 200, u.text
    # Cọc đã đủ từ trước → chốt là TỰ xuống SX (04/10/2026); bấm tay lại vẫn idempotent.
    ch = client.post(f"/api/orders/{d['id']}/confirm", headers=ha)
    assert ch.status_code == 200 and ch.json()["san_xuat_released_at"], ch.text
    rel = client.post(f"/api/orders/{d['id']}/release-production", headers=ha)
    assert rel.status_code == 200, rel.text
    assert tom_tat(client, dang_nhap(client, "ke_hoach"))["san_xuat"]["loai"] == "don_chuyen_sx"
    assert "san_xuat" not in tom_tat(client, dang_nhap(client, "lam_lenh_cham"))
    db = SessionLocal()
    try:
        assert db.query(ModuleNotification).filter_by(channel="san_xuat").count() == 1
    finally:
        db.close()


def test_chot_truoc_thu_coc_sau_thi_du_coc_tu_xuong_san_xuat(client):
    ha = admin(client)
    tao_nguoi("ke_toan_coc3", {"don_hang_ban": dict(can_read=True, scope=SCOPE_ALL),
                         "phieu_thu": dict(can_read=True, can_create=True, scope=SCOPE_ALL)})
    tao_nguoi("ke_hoach3", {"san_xuat": dict(can_read=True, can_reassign=True, scope=SCOPE_ALL)})
    hk = dang_nhap(client, "ke_toan_coc3")
    r = client.post("/api/orders", json={"source_type": "bao_gia", "quotation_id": _bao_gia_da_chot(),
                                         "deposit_pct": 50}, headers=ha)
    d = r.json()
    client.put(f"/api/orders/{d['id']}", json={"customer_po_no": "PO3",
                                               "delivery_committed_date": date.today().isoformat()},
               headers=ha)
    ch = client.post(f"/api/orders/{d['id']}/confirm", headers=ha)
    assert ch.status_code == 200 and ch.json()["san_xuat_released_at"] is None, ch.text

    thieu = client.post(f"/api/orders/{d['id']}/deposit-receipts",
                        json={"receipt_method": "cash", "amount": 100_000}, headers=hk)
    assert thieu.status_code == 200 and thieu.json()["san_xuat_released_at"] is None, thieu.text
    du = client.post(f"/api/orders/{d['id']}/deposit-receipts",
                     json={"receipt_method": "cash", "amount": 400_000}, headers=hk)
    assert du.status_code == 200 and du.json()["san_xuat_released_at"], du.text
    assert tom_tat(client, dang_nhap(client, "ke_hoach3"))["san_xuat"]["loai"] == "don_chuyen_sx"


def test_don_khong_coc_chot_la_xuong_san_xuat(client):
    ha = admin(client)
    r = client.post("/api/orders", json={"source_type": "bao_gia", "quotation_id": _bao_gia_da_chot(),
                                         "deposit_pct": 0}, headers=ha)
    d = r.json()
    client.put(f"/api/orders/{d['id']}", json={"customer_po_no": "PO4",
                                               "delivery_committed_date": date.today().isoformat()},
               headers=ha)
    ch = client.post(f"/api/orders/{d['id']}/confirm", headers=ha)
    assert ch.status_code == 200 and ch.json()["san_xuat_released_at"], ch.text


def test_don_khong_coc_thi_khong_cham(client):
    ha = admin(client)
    tao_nguoi("ke_toan_coc2", {"don_hang_ban": dict(can_read=True, scope=SCOPE_ALL),
                         "phieu_thu": dict(can_read=True, can_create=True, scope=SCOPE_ALL)})
    r = client.post("/api/orders", json={"source_type": "bao_gia", "quotation_id": _bao_gia_da_chot(),
                                         "deposit_pct": 0}, headers=ha)
    assert r.status_code == 201, r.text
    assert "don_hang_ban" not in tom_tat(client, dang_nhap(client, "ke_toan_coc2"))


def test_phieu_thu_coc_nhan_du_o_nhu_form_lap_phieu_thu(client):
    """Form thu cọc dùng chung khung Lập phiếu thu: người nộp, địa chỉ, lý do, mã giao dịch vào
    đúng phiếu; response trả id phiếu vừa lập để tải chứng từ gốc."""
    from app.models.accounting import PaymentReceipt

    ha = admin(client)
    r = client.post("/api/orders", json={"source_type": "bao_gia", "quotation_id": _bao_gia_da_chot(),
                                         "deposit_pct": 50}, headers=ha)
    d = r.json()
    c = client.post(f"/api/orders/{d['id']}/deposit-receipts", headers=ha, json={
        "receipt_method": "cash", "amount": 200_000, "payer_name": " Anh Tú (khách cử) ",
        "payer_address": "12 Lê Lợi", "content": "Thu cọc lần 1", "bank_reference": "FT123"})
    assert c.status_code == 200, c.text
    pid = c.json()["phieu_vua_lap_id"]
    db = SessionLocal()
    try:
        p = db.get(PaymentReceipt, pid)
        assert (p.payer_name, p.payer_address, p.content, p.order_id) == (
            "Anh Tú (khách cử)", "12 Lê Lợi", "Thu cọc lần 1", d["id"])
    finally:
        db.close()
    # Để trống thì giữ mặc định cũ: người nộp = khách, lý do = "Thu cọc đơn …".
    c2 = client.post(f"/api/orders/{d['id']}/deposit-receipts", headers=ha,
                     json={"receipt_method": "cash", "amount": 100_000})
    db = SessionLocal()
    try:
        p2 = db.get(PaymentReceipt, c2.json()["phieu_vua_lap_id"])
        assert p2.payer_name == "KH chấm" and p2.content == f"Thu cọc đơn {d['order_no']}"
    finally:
        db.close()
    assert client.get(f"/api/orders/{d['id']}", headers=ha).json()["phieu_vua_lap_id"] is None


def test_huy_phieu_coc_da_thu_tai_ngan_phieu_thu(client):
    """06/10/2026: phiếu cọc đã thu hủy được ở ngăn Phiếu thu (màn Đơn hàng không có nút hủy cọc) —
    bắt lý do, đơn bớt số đã cọc; hủy lần hai bị chặn."""
    ha = admin(client)
    r = client.post("/api/orders", json={"source_type": "bao_gia", "quotation_id": _bao_gia_da_chot(),
                                         "deposit_pct": 50}, headers=ha)
    d = r.json()
    c = client.post(f"/api/orders/{d['id']}/deposit-receipts",
                    json={"receipt_method": "cash", "amount": 500_000}, headers=ha)
    assert c.status_code == 200 and c.json()["deposit_ok"], c.text
    pid = c.json()["phieu_vua_lap_id"]
    url = f"/api/accounting/payment-receipts/{pid}/cancel"

    assert client.post(url, json={"reason": "  "}, headers=ha).status_code in (400, 422)
    h = client.post(url, json={"reason": "Ghi nhầm số tiền"}, headers=ha)
    assert h.status_code == 200, h.text
    assert h.json()["status"] == "cancelled" and h.json()["cancel_reason"] == "Ghi nhầm số tiền"
    don = client.get(f"/api/orders/{d['id']}", headers=ha).json()
    assert don["deposit_received"] == 0 and don["deposit_ok"] is False
    assert client.post(url, json={"reason": "lần nữa"}, headers=ha).status_code == 409
