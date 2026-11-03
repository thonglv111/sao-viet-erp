"""Ma trận quyền: dòng Tính giá có quyền ghi thì "Xem chi tiết giá vốn" bật kèm ở MÁY CHỦ.

Giao diện đã khoá ô này (`FINE_THEO_WRITE`); test này chốt đường gọi API thẳng — thiếu nó thì vai
có Thao tác mà không có ô xem chi tiết sẽ ăn 403 lúc lưu phiếu (`RuotGia`).
"""
from __future__ import annotations

from tests.test_sua_luong_keo_xem_luong import _vai_moi
from tests.test_kho_de_nghi import _admin

from app.db import SessionLocal
from app.repositories.rbac_repo import RoleRepository


def _quyen_tinh_gia(rid: int):
    db = SessionLocal()
    try:
        return RoleRepository(db).get_permission(rid, "tinh_gia_thanh")
    finally:
        db.close()


def test_luu_thao_tac_tinh_gia_khong_xem_chi_tiet_thi_tu_bat(client):
    admin = _admin(client)
    rid = _vai_moi("Vai sửa phiếu tính giá")
    r = client.put(f"/api/roles/{rid}/permissions", headers=admin, json={"permissions": [
        {"module_key": "tinh_gia_thanh", "can_read": True, "can_create": True, "can_update": True,
         "can_delete": True, "can_view_cost": False, "scope": "own"}]})
    assert r.status_code in (200, 204), r.text
    p = _quyen_tinh_gia(rid)
    assert p.can_update and p.can_view_cost


def test_chi_xem_tinh_gia_thi_khong_tu_bat(client):
    admin = _admin(client)
    rid = _vai_moi("Vai chỉ xem phiếu tính giá")
    r = client.put(f"/api/roles/{rid}/permissions", headers=admin, json={"permissions": [
        {"module_key": "tinh_gia_thanh", "can_read": True, "scope": "own"}]})
    assert r.status_code in (200, 204), r.text
    p = _quyen_tinh_gia(rid)
    assert p.can_read and not p.can_view_cost
