"""Guard chống N+1 ở các danh sách Nhân sự (26/10/2026): nhật ký chấm công, tăng ca, nghỉ phép.

Đo bản sao trước khi sửa: `/api/attendance/logs` 7 → 35 câu (5 → 50 dòng) vì tra tên từng nhân
viên bằng `get_by_id`; `/api/overtime` 9 → 17, `/api/leaves` 13 → 18 — thêm tên người duyệt
(`get_by_user_id`) và người quyết yêu cầu huỷ, mỗi người một câu.

Dữ liệu dựng thẳng bằng ORM: mỗi dòng một nhân viên riêng, một người duyệt riêng (có hồ sơ NV),
một yêu cầu huỷ do người khác quyết.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import event

from app.db import SessionLocal, engine
from app.models.attendance import AttendanceLog
from app.models.employee import Employee
from app.models.leave import STATUS_APPROVED as LEAVE_APPROVED
from app.models.leave import LeaveRequest
from app.models.overtime import STATUS_APPROVED as OT_APPROVED
from app.models.overtime import OvertimeRequest
from app.models.user import User
from app.models.yeu_cau_huy import LOAI_NGHI_PHEP, LOAI_TANG_CA, TT_GIU_NGUYEN, YeuCauHuy


@pytest.fixture
def h(client, seed_credentials) -> dict[str, str]:
    tok = client.post("/api/auth/login", json=seed_credentials).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


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


def _so_cau(client, h, url: str) -> int:
    with dem_sql() as d:
        r = client.get(url, headers=h)
    assert r.status_code == 200, r.text
    return d["n"]


def _nv(db, ma: str, *, co_tai_khoan: bool = False) -> Employee:
    uid = None
    if co_tai_khoan:
        u = User(username=f"u_{ma}", name=f"TK {ma}", password_hash="x")
        db.add(u)
        db.flush()
        uid = u.id
    e = Employee(code=ma, full_name=f"NV {ma}", user_id=uid)
    db.add(e)
    db.flush()
    return e


def _dung(n: int, tt: str) -> None:
    """Mỗi i: một NV có 1 lượt chấm công + 1 phiếu tăng ca + 1 đơn nghỉ (đã duyệt bởi người duyệt
    riêng) và mỗi phiếu/đơn một yêu cầu huỷ do người khác quyết."""
    db = SessionLocal()
    try:
        bay_gio = datetime.now(timezone.utc)
        for i in range(n):
            nv = _nv(db, f"{tt}{i}")
            duyet = _nv(db, f"{tt}{i}d", co_tai_khoan=True)
            quyet = _nv(db, f"{tt}{i}q", co_tai_khoan=True)
            db.add(AttendanceLog(employee_id=nv.id, check_type="in", checked_at=bay_gio))
            ot = OvertimeRequest(employee_id=nv.id, work_date=date.today(), from_minute=1080,
                                 to_minute=1200, status=OT_APPROVED, decided_by=duyet.user_id,
                                 decided_at=bay_gio)
            nghi = LeaveRequest(employee_id=nv.id, start_date=date.today(), end_date=date.today(),
                                days=1, status=LEAVE_APPROVED, decided_by=duyet.user_id,
                                decided_at=bay_gio)
            db.add_all([ot, nghi])
            db.flush()
            for loai, rid in ((LOAI_TANG_CA, ot.id), (LOAI_NGHI_PHEP, nghi.id)):
                db.add(YeuCauHuy(loai=loai, request_id=rid, employee_id=nv.id, ly_do="do",
                                 trang_thai=TT_GIU_NGUYEN, decided_by=quyet.user_id,
                                 decided_at=bay_gio))
        db.commit()
    finally:
        db.close()


DANH_SACH = [
    "/api/attendance/logs?size=50",
    "/api/overtime?size=50",
    "/api/leaves?size=50",
]


def test_danh_sach_nhan_su_khong_hoi_db_tung_dong(client, h):
    _dung(2, "A")
    it = {u: _so_cau(client, h, u) for u in DANH_SACH}
    _dung(8, "B")
    nhieu = {u: _so_cau(client, h, u) for u in DANH_SACH}

    logs = client.get(DANH_SACH[0], headers=h).json()["items"]
    assert "NV B3" in {x["employee_name"] for x in logs}
    for url in DANH_SACH[1:]:
        items = client.get(url, headers=h).json()["items"]
        mot = next(x for x in items if x["employee_name"] == "NV B3")
        assert mot["decided_by_name"] == "NV B3d"
        assert mot["yeu_cau_huy"]["decided_by_name"] == "NV B3q"

    print("\nSO CAU SQL nhan su (it -> nhieu):", {u: (it[u], nhieu[u]) for u in DANH_SACH})
    for u in DANH_SACH:
        assert nhieu[u] <= it[u] + 2, f"{u}: {it[u]} -> {nhieu[u]} câu khi tăng số dòng"
