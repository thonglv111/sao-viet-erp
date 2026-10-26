"""Giao hàng — đường có `order_id` phải qua cổng đơn bán, phụ xe thấy chuyến có tên mình
(bấm thử 25/10/2026, L-VAI-14/15/16)."""
from __future__ import annotations

from app.db import SessionLocal
from app.models.employee import Employee
from app.models.role import SCOPE_OWN
from app.repositories.user_repo import UserRepository
from tests.test_giao_hang_api import _admin, _don_da_chot, _h, _tai_xe, _tao_yc, _vai


def _noi_nguoi_dung(employee_id: int, username: str) -> None:
    s = SessionLocal()
    try:
        u = UserRepository(s).get_by_username(username)
        s.get(Employee, employee_id).user_id = u.id
        s.commit()
    finally:
        s.close()


def test_tai_xe_cua_toi_khong_lap_yeu_cau_cho_don_nguoi_khac(client):
    """L-VAI-15: token tài xế (giao_hang Thêm, Của tôi) POST yêu cầu cho đơn không phải của mình → 404."""
    oid, lid = _don_da_chot(suffix="pv15")
    tok = _vai("tx-pv15", scope=SCOPE_OWN, can_read=True, can_create=True)
    r = client.post("/api/giao-hang/requests", json={
        "order_id": oid, "ngay_can_giao": "2030-01-01",
        "lines": [{"order_line_id": lid, "qty": 10}],
    }, headers=_h(tok))
    assert r.status_code == 404, r.text
    # Người phạm vi Tất cả vẫn lập được như cũ.
    _tao_yc(client, _admin(client), oid, lid, qty=10)


def test_con_phai_giao_don_ngoai_pham_vi_404(client):
    """L-VAI-16: GET còn phải giao của đơn ngoài phạm vi → 404, không lộ tên + số từng dòng."""
    oid, _ = _don_da_chot(suffix="pv16")
    tok = _vai("tx-pv16", scope=SCOPE_OWN, can_read=True)
    r = client.get(f"/api/giao-hang/orders/{oid}/con-phai-giao", headers=_h(tok))
    assert r.status_code == 404, r.text
    assert client.get(f"/api/giao-hang/orders/{oid}/con-phai-giao",
                      headers=_admin(client)).status_code == 200


def test_phu_xe_cua_toi_thay_chuyen_co_ten_minh(client):
    """L-VAI-14: phụ xe phạm vi Của tôi thấy chuyến mình ngồi phụ, mở và thao tác được như tài xế."""
    h = _admin(client)
    oid, lid = _don_da_chot(suffix="pv14")
    yc = _tao_yc(client, h, oid, lid)
    tx, px = _tai_xe("Tai xe pv14"), _tai_xe("Phu xe pv14")
    r = client.post("/api/giao-hang/plans", json={
        "request_id": yc["id"], "employee_id": tx, "phu_xe_employee_id": px,
    }, headers=h)
    assert r.status_code == 201, r.text
    trip_id = r.json()["trip"]["id"]

    tok = _vai("px-pv14", scope=SCOPE_OWN, can_read=True, can_create=True, can_update=True)
    _noi_nguoi_dung(px, "px-pv14")
    ds = client.get("/api/giao-hang/trips", headers=_h(tok))
    assert ds.status_code == 200, ds.text
    assert [t["id"] for t in ds.json()["items"]] == [trip_id]
    # Người không có tên trên chuyến vẫn không thấy.
    tok_khac = _vai("px-pv14-khac", scope=SCOPE_OWN, can_read=True)
    _noi_nguoi_dung(_tai_xe("Nguoi khac pv14"), "px-pv14-khac")
    assert client.get("/api/giao-hang/trips", headers=_h(tok_khac)).json()["items"] == []
