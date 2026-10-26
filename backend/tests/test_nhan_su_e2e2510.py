"""Nhân sự — chuyển trạng thái (bấm thử 25/10/2026): ngày hiệu lực trước ngày vào làm (L-SX-28),
tự cho mình nghỉ (L-VAI-20), tuyển lại giữ khoá tay (L-VAI-22), cắt kênh SSE khi khoá (L-VAI-23),
câu nhật ký đọc được (L-SX-38)."""
from __future__ import annotations

import pytest

from app import realtime
from app.db import SessionLocal
from app.models.audit import AuditLog
from app.models.user import User
from app.routers.quotations import _sse_con_hieu_luc
from tests.test_bien_che_dung_chung_08_09 import _chuyen
from tests.test_go_dinh_chi_08_09 import _tao, _trang_thai
from tests.test_luong_api import _admin_token, _h
from tests.test_user_admin_api import _dept_id, _role_id


def _nv_co_tai_khoan(client, h, username: str, *, phong="Hành chính nhân sự",
                     vai="Trưởng phòng HCNS") -> tuple[int, int]:
    r = client.post("/api/employees", json={
        "full_name": f"NV {username}", "department_id": _dept_id(phong), "hire_date": "2026-01-05",
        "gender": "male", "status": "active",
        "account": {"username": username, "password": "password123", "role_id": _role_id(phong, vai)},
    }, headers=h)
    assert r.status_code == 201, r.text
    e = r.json()["employee"]
    return e["id"], e["user_id"]


def _dang_nhap(client, username: str) -> dict[str, str]:
    r = client.post("/api/auth/login", json={"username": username, "password": "password123"})
    assert r.status_code == 200, r.text
    return _h(r.json()["access_token"])


def _hoat_dong(uid: int) -> bool:
    db = SessionLocal()
    try:
        return db.get(User, uid).is_active
    finally:
        db.close()


@pytest.fixture
def quyen_doi(monkeypatch):
    ra: list[int] = []
    goc = realtime.hub.publish

    def gia(uid, ev):
        if ev.get("type") == "quyen_doi":
            ra.append(uid)
        goc(uid, ev)

    monkeypatch.setattr(realtime.hub, "publish", gia)
    return ra


def test_ngay_hieu_luc_truoc_ngay_vao_lam_bi_chan(client):
    h = _h(_admin_token(client))
    eid = _tao(client, h, name="Mốc trước vào làm", status="active")       # vào làm 05/01/2026
    r = _chuyen(client, h, eid, "probation_restart", "2026-01-04", probation_end_date="2026-12-31")
    assert r.status_code == 400 and "ngày vào làm" in r.text, r.text
    r = _chuyen(client, h, eid, "suspend", "2025-12-31")
    assert r.status_code == 400 and "ngày vào làm" in r.text, r.text
    assert _trang_thai(client, h, eid) == "active"
    # Đúng ngày vào làm vẫn được.
    r = _chuyen(client, h, eid, "probation_restart", "2026-01-05", probation_end_date="2026-12-31")
    assert r.status_code == 200, r.text


def test_khong_tu_cho_minh_nghi_viec(client):
    h = _h(_admin_token(client))
    eid, uid = _nv_co_tai_khoan(client, h, "hcns-pv20")
    hm = _dang_nhap(client, "hcns-pv20")
    r = _chuyen(client, hm, eid, "resign", "2026-02-01", resign_reason="thử")
    assert r.status_code == 400 and "tự cho mình" in r.text, r.text
    r = _chuyen(client, hm, eid, "suspend", "2026-02-01")
    assert r.status_code == 400, r.text
    assert _hoat_dong(uid) is True
    assert _trang_thai(client, h, eid) == "active"


def test_tuyen_lai_giu_khoa_tay(client):
    h = _h(_admin_token(client))
    eid, uid = _nv_co_tai_khoan(client, h, "nv-pv22a", phong="Kinh doanh", vai="NV Sales")
    assert client.put(f"/api/users/{uid}/active", json={"is_active": False}, headers=h).status_code == 200
    assert _chuyen(client, h, eid, "resign", "2026-02-01", resign_reason="nghỉ").status_code == 200
    r = _chuyen(client, h, eid, "reinstate", "2026-03-01")
    assert r.status_code == 200, r.text
    assert _hoat_dong(uid) is False
    ev = client.get(f"/api/employees/{eid}/events", headers=h).json()["items"]
    assert "khoá tay" in next(e for e in ev if e["event_type"] == "reinstated")["note"]


def test_tuyen_lai_mo_khoa_do_nghi_viec(client):
    h = _h(_admin_token(client))
    eid, uid = _nv_co_tai_khoan(client, h, "nv-pv22b", phong="Kinh doanh", vai="NV Sales")
    # Khoá tay rồi mở tay: dòng mới nhất là `unlock_user` ⇒ không tính là khoá tay.
    client.put(f"/api/users/{uid}/active", json={"is_active": False}, headers=h)
    client.put(f"/api/users/{uid}/active", json={"is_active": True}, headers=h)
    assert _chuyen(client, h, eid, "resign", "2026-02-01", resign_reason="nghỉ").status_code == 200
    assert _hoat_dong(uid) is False
    assert _chuyen(client, h, eid, "reinstate", "2026-03-01").status_code == 200
    assert _hoat_dong(uid) is True


def test_khoa_thu_hoi_nghi_viec_day_quyen_doi(client, quyen_doi):
    h = _h(_admin_token(client))
    eid, uid = _nv_co_tai_khoan(client, h, "nv-pv23", phong="Kinh doanh", vai="NV Sales")
    quyen_doi.clear()
    assert client.post(f"/api/users/{uid}/revoke-sessions", headers=h).status_code == 204
    assert quyen_doi == [uid]
    assert client.put(f"/api/users/{uid}/active", json={"is_active": False}, headers=h).status_code == 200
    assert quyen_doi == [uid, uid]
    client.put(f"/api/users/{uid}/active", json={"is_active": True}, headers=h)
    quyen_doi.clear()
    assert _chuyen(client, h, eid, "resign", "2026-02-01", resign_reason="nghỉ").status_code == 200
    assert quyen_doi == [uid]


def test_sse_con_hieu_luc_false_khi_bi_khoa_hoac_thu_hoi(client):
    h = _h(_admin_token(client))
    _, uid = _nv_co_tai_khoan(client, h, "nv-pv23b", phong="Kinh doanh", vai="NV Sales")
    db = SessionLocal()
    try:
        tv = db.get(User, uid).token_version
    finally:
        db.close()
    assert _sse_con_hieu_luc(uid, tv) is True
    client.post(f"/api/users/{uid}/revoke-sessions", headers=h)
    assert _sse_con_hieu_luc(uid, tv) is False
    db = SessionLocal()
    try:
        tv = db.get(User, uid).token_version
    finally:
        db.close()
    client.put(f"/api/users/{uid}/active", json={"is_active": False}, headers=h)
    assert _sse_con_hieu_luc(uid, tv) is False


def test_nhat_ky_chuyen_trang_thai_doc_duoc(client):
    h = _h(_admin_token(client))
    eid = _tao(client, h, name="Nhật ký dễ đọc", status="active")
    assert _chuyen(client, h, eid, "probation_restart", "2026-01-05",
                   probation_end_date="2026-12-31").status_code == 200
    db = SessionLocal()
    try:
        dong = db.query(AuditLog).filter(AuditLog.target == f"employee:{eid}",
                                         AuditLog.action == "employee_probation_restarted").one()
    finally:
        db.close()
    assert "Đang làm việc → Thử việc" in dong.detail
    assert "hiệu lực 05/01/2026" in dong.detail and "hết thử việc 31/12/2026" in dong.detail


def test_list_tra_duyet_duoc_false_cho_don_cua_chinh_to_truong(client):
    """L-VAI-12: tổ trưởng (phạm vi Phòng) thấy đơn mình với `duyet_duoc=False`, đơn người khác
    trong tổ không gắn cờ; HCNS (Tất cả) thấy `None`."""
    from tests.test_cua_tu_ky_08_09 import _ho_so_cua, _vai_rieng
    from tests.test_leaves_api import _make_type

    admin = _admin_token(client)
    tid = _make_type(client, admin)
    uid, tok = _vai_rieng("tt-pv12", "Sản xuất", {"nghi_phep": dict(
        can_read=True, can_create=True, can_approve=True, scope="department")})
    _ho_so_cua(client, admin, name="Tổ trưởng PV12", dept="Sản xuất", uid=uid)
    r = client.post("/api/leaves", json={"leave_type_id": tid, "start_date": "2026-08-10",
                                         "end_date": "2026-08-10", "reason": "việc nhà"},
                    headers=_h(tok))
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    ds = client.get("/api/leaves", headers=_h(tok)).json()["items"]
    assert next(o for o in ds if o["id"] == rid)["duyet_duoc"] is False
    ds_admin = client.get("/api/leaves", headers=_h(admin)).json()["items"]
    assert next(o for o in ds_admin if o["id"] == rid)["duyet_duoc"] is None


def test_chi_tiet_co_role_name(client):
    h = _h(_admin_token(client))
    eid, _ = _nv_co_tai_khoan(client, h, "nv-pv48", phong="Kinh doanh", vai="NV Sales")
    assert client.get(f"/api/employees/{eid}", headers=h).json()["role_name"] == "NV Sales"


def test_doi_trang_thai_lui_vao_ky_luong_da_chot(client):
    """L-SX-44: kỳ T02 đã chốt ⇒ chuyển về thử việc / điều chuyển hiệu lực trong T02 bị chặn;
    nghỉ việc lùi ngày vẫn được; ngày ở kỳ mở vẫn được."""
    from app.models.payroll import PERIOD_LOCKED, PayrollPeriod

    h = _h(_admin_token(client))
    eid = _tao(client, h, name="Kỳ đã chốt PV44", status="active")
    db = SessionLocal()
    try:
        db.add(PayrollPeriod(year=2026, month=2, status=PERIOD_LOCKED))
        db.commit()
    finally:
        db.close()
    r = _chuyen(client, h, eid, "probation_restart", "2026-02-15", probation_end_date="2026-12-31")
    assert r.status_code == 400 and "đã chốt" in r.text, r.text
    r = _chuyen(client, h, eid, "transfer", "2026-02-15", new_department_id=_dept_id("Kinh doanh"))
    assert r.status_code == 400 and "đã chốt" in r.text, r.text
    r = _chuyen(client, h, eid, "probation_restart", "2026-03-01", probation_end_date="2026-12-31")
    assert r.status_code == 200, r.text
    r = _chuyen(client, h, eid, "resign", "2026-02-20", resign_reason="nghỉ")
    assert r.status_code == 200, r.text
