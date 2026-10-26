"""Hộp lọc "NV phụ trách" dùng chung cho các màn danh sách khối Kinh doanh (Tính giá thành · Báo giá ·
Đơn hàng bán) — cùng dáng hộp lọc NV phụ trách của Khách hàng.

Danh sách người KHÔNG tự tính phạm vi: repo của từng module đếm phiếu theo người CHỈ TRONG tầm nhìn
của người xem (cùng `_scope_condition` với bảng — own = mình + nhóm dùng chung, department = cây
phòng, all = hết). Nhờ vậy hộp chọn không bao giờ lộ tên người ngoài phạm vi, và không lệch với
bảng bên dưới. Người xem luôn có mặt để chọn được "của mình" dù chưa có phiếu nào.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..repositories.rbac_repo import DepartmentRepository, RoleRepository
from ..repositories.user_repo import UserRepository
from ..schemas.customer import SaleOption


def lua_chon_nguoi(db: Session, dem: dict[int, int], nguoi_xem) -> list[SaleOption]:
    """`dem` = {user_id: số phiếu trong tầm nhìn}. Trả hộp chọn: tên + vai trò + phòng + số phiếu
    (`so_kh` — tên trường giữ theo `SaleOption` của Khách hàng để FE dùng chung một kiểu)."""
    ids = set(dem) | {nguoi_xem.id}
    # Nạp GỘP người + tên vai một lượt cho cả hộp — trước 26/10/2026 mỗi người một SELECT users
    # và một SELECT roles (bản sao E2E: hộp NV phụ trách đơn hàng 15 + 5 câu).
    nguoi = UserRepository(db).get_many(ids)
    ten_vai = RoleRepository(db).names_by_ids(u.role_id for u in nguoi.values())
    ten_phong = {d.id: d.name for d in DepartmentRepository(db).list_all()}
    out: list[SaleOption] = []
    for uid in ids:
        u = nguoi.get(uid)
        if u is None:
            continue
        out.append(SaleOption(
            id=u.id,
            name=u.name or u.username,
            vai_tro=ten_vai.get(u.role_id) if u.role_id is not None else None,
            phong_ban=ten_phong.get(u.department_id) if u.department_id else None,
            so_kh=dem.get(u.id, 0),
        ))
    out.sort(key=lambda o: o.name.lower())
    return out
