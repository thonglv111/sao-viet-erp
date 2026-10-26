"""Guard chống N+1 ở các danh sách của module Giao hàng.

Đếm số câu SQL của MỘT request danh sách khi dữ liệu có ít dòng và khi có nhiều dòng. Số câu phải
ĐỨNG YÊN khi số dòng tăng — tăng theo số dòng nghĩa là đang hỏi DB từng dòng một (26/10/2026: bản
sao E2E đo danh sách yêu cầu giao 61 → 468 câu khi trang 5 → 50 dòng, tab Nhân viên 327 câu cho
15 người, ô chọn tài xế 194 câu).
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date

from sqlalchemy import event

from app.db import SessionLocal, engine
from app.models.employee import STATUS_ACTIVE, Employee
from app.repositories.rbac_repo import DepartmentRepository
from tests.test_giao_hang_api import _admin, _bat_co_giao_hang, _don_da_chot, _len_kh, _tao_yc


@contextmanager
def dem_sql():
    dem = {"n": 0}

    def _nghe(*_a, **_k):
        dem["n"] += 1

    event.listen(engine, "before_cursor_execute", _nghe)
    try:
        yield dem
    finally:
        event.remove(engine, "before_cursor_execute", _nghe)


def _nhan_vien(ma: str, ten: str, phong: str) -> int:
    db = SessionLocal()
    try:
        dept = DepartmentRepository(db).get_by_name(phong)
        e = Employee(code=ma, full_name=ten, department_id=dept.id, hire_date=date(2020, 1, 1),
                     status=STATUS_ACTIVE)
        db.add(e)
        db.commit()
        return e.id
    finally:
        db.close()


def _dung(client, h, n: int, tien_to: str) -> None:
    """n đơn đã chốt, mỗi đơn 2 yêu cầu giao: một yêu cầu lên kế hoạch cho một tài xế MỚI (xen kẽ
    tài xế thuộc bộ phận giao hàng và tài xế ở phòng khác — người phòng khác chỉ hiện vì có chuyến),
    một yêu cầu để chờ lên kế hoạch."""
    for i in range(n):
        oid, lid = _don_da_chot(suffix=f"N1{tien_to}{i}")
        a = _tao_yc(client, h, oid, lid, qty=30)
        _tao_yc(client, h, oid, lid, qty=20)
        phong = "Sản xuất" if i % 2 == 0 else "Kinh doanh"
        nv = _nhan_vien(f"TXN1{tien_to}{i}", f"Tai xe N1 {tien_to} {i}", phong)
        r = _len_kh(client, h, a["id"], nv)
        assert r.status_code == 201, r.text


def _so_cau(client, h, url: str) -> int:
    with dem_sql() as d:
        r = client.get(url, headers=h)
    assert r.status_code == 200, r.text
    return d["n"]


DANH_SACH = [
    "/api/giao-hang/requests?size=50",
    "/api/giao-hang/requests?cho_len_ke_hoach=true&size=50",
    "/api/giao-hang/nhan-vien",
    "/api/giao-hang/tai-xe-chon",
    "/api/giao-hang/bang-giao?size=50",
]


def test_danh_sach_giao_hang_khong_hoi_db_tung_dong(client):
    h = _admin(client)
    _bat_co_giao_hang()
    _dung(client, h, 2, "A")
    it = {u: _so_cau(client, h, u) for u in DANH_SACH}
    _dung(client, h, 6, "B")
    nhieu = {u: _so_cau(client, h, u) for u in DANH_SACH}
    print("\nSO CAU SQL (it dong -> nhieu dong):", {u: (it[u], nhieu[u]) for u in DANH_SACH})
    loi = {u: (it[u], nhieu[u]) for u in DANH_SACH if nhieu[u] > it[u] + 2}
    assert not loi, f"số câu SQL tăng theo số dòng: {loi}"
