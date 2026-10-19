"""Ô Xem "Hồ sơ của tôi" (`self_service`) LUÔN BẬT, không tắt được (14/10/2026, mg 0410).

Hồ sơ, chấm công, phiếu lương của CHÍNH MÌNH là quyền của mọi người lao động. Ma trận khoá ô;
máy chủ ép bật lúc lưu để client gửi tắt cũng không tắt được; mg 0410 bật lại vai đang tắt.
"""
from __future__ import annotations

from sqlalchemy import text

from app.db import SessionLocal
from app.db_migrations import _migrate_ho_so_cua_toi_luon_xem
from app.repositories.rbac_repo import DepartmentRepository, RoleRepository


def _h(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _admin(client) -> str:
    return client.post("/api/auth/login",
                       json={"username": "admin", "password": "admin123"}).json()["access_token"]


def _vai_moi(ten: str) -> int:
    db = SessionLocal()
    try:
        kd = DepartmentRepository(db).get_by_name("Kinh doanh")
        return RoleRepository(db).create(name=ten, department_id=kd.id).id
    finally:
        db.close()


def _xem(role_id: int) -> bool | None:
    db = SessionLocal()
    try:
        p = RoleRepository(db).get_permission(role_id, "self_service")
        return None if p is None else bool(p.can_read)
    finally:
        db.close()


def test_luu_ma_tran_tat_xem_ho_so_cua_toi_van_bat(client):
    rid = _vai_moi("vai-thu-tat-ho-so")
    r = client.put(f"/api/roles/{rid}/permissions", headers=_h(_admin(client)), json={
        "permissions": [{"module_key": "self_service", "can_read": False, "scope": "own"}],
    })
    assert r.status_code == 200, r.text
    dong = next(d for d in r.json() if d["module_key"] == "self_service")
    assert dong["can_read"] is True
    assert _xem(rid) is True


def test_mg_0410_bat_lai_vai_dang_tat_va_cap_cho_vai_chua_co_dong(client):
    tat = _vai_moi("vai-dang-tat-ho-so")
    thieu = _vai_moi("vai-thieu-dong-ho-so")
    db = SessionLocal()
    try:
        db.execute(text("UPDATE role_permissions SET can_read = false "
                        "WHERE role_id = :r AND module_key = 'self_service'"), {"r": tat})
        db.execute(text("DELETE FROM role_permissions "
                        "WHERE role_id = :r AND module_key = 'self_service'"), {"r": thieu})
        db.commit()
        assert _xem(tat) is False and _xem(thieu) is None

        _migrate_ho_so_cua_toi_luon_xem(db)
        _migrate_ho_so_cua_toi_luon_xem(db)  # chạy lại là no-op
    finally:
        db.close()
    assert _xem(tat) is True
    assert _xem(thieu) is True
