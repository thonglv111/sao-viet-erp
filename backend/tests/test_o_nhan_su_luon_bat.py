"""Ô việc-của-chính-mình LUÔN BẬT, không tắt được (15/10/2026, mg 0412).

Chấm công / Nghỉ phép / Tăng ca: Xem + Thao tác. Lương: chỉ Xem — Thao tác Lương gồm sửa mức lương
và cấu hình lương nên KHÔNG khoá. Vai mới sinh ra đã có; lưu ma trận gửi tắt cũng không tắt được;
mg 0412 bật cho vai đang tắt / chưa có dòng. Thao tác Chấm công luôn bật nên sửa dữ liệu chung
(ca, điểm chấm công, lịch) đòi thêm ô chi tiết của tab.
"""
from __future__ import annotations

from sqlalchemy import text

from app.db import SessionLocal
from app.db_migrations import _migrate_o_nhan_su_luon_bat
from app.repositories.rbac_repo import DepartmentRepository, RoleRepository
from app.repositories.user_repo import UserRepository
from app.security import create_access_token, hash_password

GHI = ("can_create", "can_update", "can_delete")
KHOA_DU = ("cham_cong", "nghi_phep", "tang_ca")


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


def _dong(role_id: int, khoa: str) -> dict | None:
    db = SessionLocal()
    try:
        p = RoleRepository(db).get_permission(role_id, khoa)
        if p is None:
            return None
        return {k: bool(getattr(p, k)) for k in ("can_read", *GHI)}
    finally:
        db.close()


def _du(d: dict | None) -> bool:
    return d is not None and all(d.values())


def test_vai_moi_sinh_ra_da_co_o_luon_bat(client):
    rid = _vai_moi("vai-moi-o-nhan-su")
    for khoa in KHOA_DU:
        assert _du(_dong(rid, khoa)), khoa
    luong = _dong(rid, "luong")
    assert luong is not None and luong["can_read"] is True
    assert not any(luong[k] for k in GHI)


def test_luu_ma_tran_gui_tat_van_bat_nhung_luong_chi_khoa_xem(client):
    rid = _vai_moi("vai-thu-tat-o-nhan-su")
    tat = {"can_read": False, "can_create": False, "can_update": False, "can_delete": False,
           "scope": "own"}
    r = client.put(f"/api/roles/{rid}/permissions", headers=_h(_admin(client)), json={
        "permissions": [{"module_key": k, **tat} for k in (*KHOA_DU, "luong")],
    })
    assert r.status_code == 200, r.text
    for khoa in KHOA_DU:
        assert _du(_dong(rid, khoa)), khoa
    luong = _dong(rid, "luong")
    assert luong["can_read"] is True
    assert not any(luong[k] for k in GHI)


def test_mg_0412_bat_vai_dang_tat_va_cap_cho_vai_chua_co_dong(client):
    tat = _vai_moi("vai-dang-tat-nhan-su")
    thieu = _vai_moi("vai-thieu-dong-nhan-su")
    db = SessionLocal()
    try:
        db.execute(text(
            "UPDATE role_permissions SET can_read = false, can_create = false, "
            "can_update = false, can_delete = false WHERE role_id = :r"), {"r": tat})
        db.execute(text("DELETE FROM role_permissions WHERE role_id = :r "
                        "AND module_key IN ('cham_cong','nghi_phep','tang_ca','luong')"),
                   {"r": thieu})
        db.commit()
        _migrate_o_nhan_su_luon_bat(db)
        _migrate_o_nhan_su_luon_bat(db)  # chạy lại là no-op
    finally:
        db.close()
    for rid in (tat, thieu):
        for khoa in KHOA_DU:
            assert _du(_dong(rid, khoa)), (rid, khoa)
        assert _dong(rid, "luong")["can_read"] is True
    assert _dong(thieu, "luong")["can_update"] is False


def test_sua_khai_ca_doi_o_khai_ca_du_pham_vi_tat_ca(client):
    """Thao tác + phạm vi Tất cả mà thiếu ô Khai ca ⇒ 403; bật ô ⇒ qua được hàng rào quyền."""
    admin = _admin(client)
    rid = _vai_moi("vai-cham-cong-tat-ca")
    dong = {"module_key": "cham_cong", "can_read": True, "can_create": True, "can_update": True,
            "can_delete": True, "scope": "all"}
    assert client.put(f"/api/roles/{rid}/permissions", headers=_h(admin),
                      json={"permissions": [dong]}).status_code == 200
    db = SessionLocal()
    try:
        kd = DepartmentRepository(db).get_by_name("Kinh doanh")
        u = UserRepository(db).create(username="nv-cham-cong", name="NV chấm công",
                                      password_hash=hash_password("x"))
        UserRepository(db).set_assignment(u, department_id=kd.id, role_id=rid, is_active=True)
        tok = create_access_token(str(u.id))
    finally:
        db.close()
    assert client.post("/api/attendance/shifts", headers=_h(tok), json={}).status_code == 403

    assert client.put(f"/api/roles/{rid}/permissions", headers=_h(admin), json={
        "permissions": [{**dong, "can_manage_shifts": True}]}).status_code == 200
    assert client.post("/api/attendance/shifts", headers=_h(tok), json={}).status_code != 403
