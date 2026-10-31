"""Ma trận quyền: ô "Sửa lương & BHXH" kéo theo "Xem lương & BHXH" ở MÁY CHỦ.

Giao diện đã tự tick (`applyPermissionDependency`); test này chốt đường gọi API thẳng.
"""
from __future__ import annotations

from app.db import SessionLocal
from app.repositories.rbac_repo import DepartmentRepository, RoleRepository
from tests.test_kho_de_nghi import _admin


def _vai_moi(ten: str) -> int:
    db = SessionLocal()
    try:
        dept = DepartmentRepository(db).get_by_name("Phòng HCNS") or DepartmentRepository(db).create(name="Phòng HCNS")
        role = RoleRepository(db).create(name=ten, department_id=dept.id)
        db.commit()
        return role.id
    finally:
        db.close()


def _quyen_nhan_su(rid: int):
    db = SessionLocal()
    try:
        return RoleRepository(db).get_permission(rid, "nhan_su")
    finally:
        db.close()


def test_luu_sua_luong_khong_xem_luong_thi_tu_bat_xem(client):
    admin = _admin(client)
    rid = _vai_moi("Vai chỉ sửa lương")
    r = client.put(f"/api/roles/{rid}/permissions", headers=admin, json={"permissions": [
        {"module_key": "nhan_su", "can_read": True, "can_edit_salary": True,
         "can_view_salary": False, "scope": "all"}]})
    assert r.status_code in (200, 204), r.text
    p = _quyen_nhan_su(rid)
    assert p.can_edit_salary and p.can_view_salary


def test_xem_luong_khong_sua_luong_giu_nguyen(client):
    admin = _admin(client)
    rid = _vai_moi("Vai chỉ xem lương")
    r = client.put(f"/api/roles/{rid}/permissions", headers=admin, json={"permissions": [
        {"module_key": "nhan_su", "can_read": True, "can_view_salary": True, "scope": "all"}]})
    assert r.status_code in (200, 204), r.text
    p = _quyen_nhan_su(rid)
    assert p.can_view_salary and not p.can_edit_salary
