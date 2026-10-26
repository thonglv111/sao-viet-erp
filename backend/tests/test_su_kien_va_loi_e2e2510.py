"""Bấm thử 25/10/2026, Đợt 11: lỗi 500 mang header CORS (gốc của L-SX-02, L-VAI-27), đổi cây tổ
đẩy `cay_to_doi` (L-VAI-49), duyệt / từ chối đề nghị hồ sơ báo người gửi (L-VAI-21)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def test_loi_500_tra_json_co_header_cors():
    def _no():
        raise RuntimeError("thử lỗi")

    app.add_api_route("/api/_thu_loi_500", _no, methods=["GET"])
    try:
        origin = settings.cors_origin_list[0]
        with TestClient(app, raise_server_exceptions=False) as c:
            r = c.get("/api/_thu_loi_500", headers={"Origin": origin})
        assert r.status_code == 500
        assert r.headers.get("access-control-allow-origin") == origin
        assert "Máy chủ gặp lỗi" in r.json()["detail"]
    finally:
        app.router.routes[:] = [rt for rt in app.router.routes
                                if getattr(rt, "path", None) != "/api/_thu_loi_500"]


def test_doi_cap_tren_phat_su_kien_cay_to_doi(client, monkeypatch):
    from app import realtime
    from tests.test_luong_api import _admin_token, _h

    h = _h(_admin_token(client))
    cha = client.post("/api/departments", json={"name": "Khối thử PV49", "la_san_xuat": True}, headers=h)
    assert cha.status_code == 201, cha.text
    to = client.post("/api/departments", json={"name": "Tổ thử PV49"}, headers=h).json()
    gui = []
    monkeypatch.setattr(realtime.hub, "gui", lambda ev, **kw: gui.append((ev, kw)))

    r = client.put(f"/api/departments/{to['id']}", json={"name": "Tổ thử PV49", "parent_id": cha.json()["id"]},
                   headers=h)
    assert r.status_code == 200, r.text
    (ev, kw), = [g for g in gui if g[0]["type"] == "cay_to_doi"]
    assert to["id"] in kw["to"]


def _de_nghi(client, admin, username):
    from tests.test_employees_api import _create, _h, _vai_tho

    emp = _create(client, admin, full_name=f"NV {username}", bank_account="111",
                  account={"username": username, "password": "pv21-12345", "role_id": _vai_tho(client, admin)}).json()
    tok = client.post("/api/auth/login", json={"username": username, "password": "pv21-12345"}).json()["access_token"]
    r = client.post("/api/employees/me/update-requests",
                    json={"changes": {"bank_account": "999"}, "reason": "Đổi NH"}, headers=_h(tok))
    assert r.status_code == 201, r.text
    return r.json()["id"], emp["employee"]["user_id"]


def test_duyet_va_tu_choi_de_nghi_ho_so_day_su_kien_toi_nguoi_gui(client, monkeypatch):
    from app import realtime
    from tests.test_employees_api import _admin_token, _h

    admin = _admin_token(client)
    da_day = []
    goc = realtime.hub.publish
    monkeypatch.setattr(realtime.hub, "publish", lambda uid, ev: (da_day.append((uid, ev)), goc(uid, ev)))

    rid, uid = _de_nghi(client, admin, "pv21a")
    assert client.post(f"/api/employees/update-requests/{rid}/approve", json={}, headers=_h(admin)).status_code == 200
    assert (uid, {"type": "profile_request_decision", "decision": "approved"}) in da_day

    rid, uid = _de_nghi(client, admin, "pv21b")
    r = client.post(f"/api/employees/update-requests/{rid}/reject", json={"note": "sai số"}, headers=_h(admin))
    assert r.status_code == 200, r.text
    assert (uid, {"type": "profile_request_decision", "decision": "rejected"}) in da_day
