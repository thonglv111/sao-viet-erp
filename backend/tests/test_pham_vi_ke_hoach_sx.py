"""Phạm vi Lệnh sản xuất.

Tab Hàng chờ tiếp nhận (chỉ người có ô Giao đơn) khoanh theo CHỦ ĐƠN như Đơn hàng bán (14/10/2026: sale
phụ trách khách, thiếu thì sale ghi trên đơn; Của tôi gồm người cùng nhóm dùng chung). Bảng lệnh và tab
Tạo lệnh khoanh theo NGƯỜI PHỤ TRÁCH (08/11/2026, chi tiết ở test_giao_don_lam_lenh.py). Lệnh ngoài
phạm vi trả 404, đơn ngoài phạm vi phụ trách trả 403. Lên lệnh vẫn do ô Thao tác.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.db import SessionLocal
from app.models.customer import Customer
from app.models.lsx import Lsx
from app.models.nhom_dung_chung import NhomDungChung, NhomDungChungThanhVien
from app.models.order import STATUS_ORDERED, Order, OrderLine
from app.models.role import SCOPE_OWN
from tests.lenh_sx_fixtures import _h, _tok
from tests.test_duong_nong import _login, _mk_user


def _don(db, so: str, *, sale_id: int | None = None, customer_id: int | None = None) -> Order:
    don = Order(order_no=so, customer_id=customer_id, sale_user_id=sale_id, status=STATUS_ORDERED,
                san_xuat_released_at=datetime(2026, 10, 2, 3, tzinfo=timezone.utc))
    # Hai dòng: dòng 1 lên lệnh, dòng 2 còn chờ ⇒ đơn vừa có lệnh vừa nằm ở hàng chờ.
    don.lines.extend([OrderLine(description="Hộp", qty=10), OrderLine(description="Túi", qty=5)])
    db.add(don)
    db.commit()
    return don


def _lenh(db, don: Order, ma: str, phu_trach: int) -> int:
    lsx = Lsx(ma=ma, ten="Hộp", order_id=don.id, order_line_id=don.lines[0].id, so_luong_dat=10,
              nguoi_phu_trach_id=phu_trach)
    db.add(lsx)
    db.commit()
    return lsx.id


def test_pham_vi_cua_toi_theo_chu_don_va_nhom(client, seed_credentials):
    tro_ly = _mk_user("tro_ly_khsx", {"san_xuat": dict(can_read=True, can_reassign=True, scope=SCOPE_OWN)})
    ban_nhom = _mk_user("ban_nhom_khsx", {"dashboard": dict(can_read=True, scope=SCOPE_OWN)})
    nguoi_khac = _mk_user("nguoi_khac_khsx", {"dashboard": dict(can_read=True, scope=SCOPE_OWN)})
    db = SessionLocal()
    try:
        nhom = NhomDungChung(ten="nhóm thử khsx")
        db.add(nhom)
        db.flush()
        db.add_all([NhomDungChungThanhVien(nhom_id=nhom.id, user_id=tro_ly),
                    NhomDungChungThanhVien(nhom_id=nhom.id, user_id=ban_nhom)])
        # Khách do bạn cùng nhóm phụ trách — đơn ghi sale người khác vẫn là của bạn cùng nhóm.
        kh_nhom = Customer(code="KH-NHOM-KHSX", name="Khách của nhóm", sale_user_id=ban_nhom)
        db.add(kh_nhom)
        db.commit()
        don_nhom = _don(db, "DH-KHSX-NHOM", sale_id=nguoi_khac, customer_id=kh_nhom.id)
        don_minh = _don(db, "DH-KHSX-MINH", sale_id=tro_ly)
        don_khac = _don(db, "DH-KHSX-KHAC", sale_id=nguoi_khac)
        # Lệnh khoanh theo người phụ trách, không theo chủ đơn: lệnh của đơn người khác mà mình phụ
        # trách vẫn thấy, lệnh của đơn nhóm mình mà người khác phụ trách thì không.
        lenh_nhom = _lenh(db, don_nhom, "LSX-KHSX-NHOM", phu_trach=nguoi_khac)
        lenh_khac = _lenh(db, don_khac, "LSX-KHSX-KHAC", phu_trach=tro_ly)
        don_minh.nguoi_lam_lenh_id = tro_ly
        don_khac.nguoi_lam_lenh_id = nguoi_khac
        db.commit()
        id_nhom, id_minh, id_khac = don_nhom.id, don_minh.id, don_khac.id
    finally:
        db.close()

    h = _login(client, "tro_ly_khsx")
    r = client.get("/api/lsx/hang-cho", headers=h, params={"che_do": "giao"})
    assert r.status_code == 200, r.text
    so = {i["order_no"] for i in r.json()["items"]}
    assert {"DH-KHSX-NHOM", "DH-KHSX-MINH"} <= so and "DH-KHSX-KHAC" not in so

    # Ô lọc Khách: câu ngoài đã có bảng khách — truy vấn con "chủ đơn" không được nuốt mất nó.
    r = client.get("/api/lsx/hang-cho/khach-loc", headers=h)
    assert r.status_code == 200, r.text
    assert "Khách của nhóm" in r.text

    r = client.get("/api/lsx", headers=h, params={"q": "LSX-KHSX"})
    assert [i["ma"] for i in r.json()["items"]] == ["LSX-KHSX-KHAC"]
    assert client.get(f"/api/lsx/{lenh_khac}", headers=h).status_code == 200
    assert client.get(f"/api/lsx/{lenh_nhom}", headers=h).status_code == 404

    assert client.get(f"/api/lsx/preview/{id_minh}", headers=h).status_code == 200
    assert client.get(f"/api/lsx/preview/{id_khac}", headers=h).status_code == 403
    # Không có ô Thao tác ⇒ không lên lệnh được, kể cả đơn trong phạm vi.
    r = client.post(f"/api/lsx/tao/{id_nhom}", headers=h, json={"order_line_ids": []})
    assert r.status_code == 403, r.text

    # Người phạm vi Tất cả (admin) vẫn thấy mọi đơn chờ.
    ha = _h(_tok(client, seed_credentials))
    so_all = {i["order_no"] for i in client.get("/api/lsx/hang-cho", headers=ha).json()["items"]}
    assert {"DH-KHSX-NHOM", "DH-KHSX-MINH", "DH-KHSX-KHAC"} <= so_all
