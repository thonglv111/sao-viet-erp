"""Giao đơn cho người phụ trách (08/11/2026, docs/design-giao-don-lam-lenh.md).

Người có ô "Giao đơn" (`san_xuat:reassign`) chia đơn ở tab Hàng chờ tiếp nhận cho MỘT người cùng phòng
(kể cả phòng con, kể cả bản thân) có Thao tác ở Lệnh sản xuất. Tab đó chỉ để giao. Lệnh tạo ở tab Tạo
lệnh: chỉ đơn đã giao, theo phạm vi người phụ trách (Của tôi = mình, Cả phòng = người trong phòng,
Tất cả = mọi người). Bảng lệnh cũng lọc theo người phụ trách. Chặn ở máy chủ.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from app.db import SessionLocal
from app.models.audit import AuditLog
from app.models.lsx import Lsx
from app.models.module_notification import ModuleNotification
from app.models.order import STATUS_ORDERED, Order, OrderLine
from app.models.role import SCOPE_ALL, SCOPE_DEPARTMENT, SCOPE_OWN
from app.repositories.rbac_repo import DepartmentRepository, RoleRepository
from app.repositories.user_repo import UserRepository
from app.security import hash_password
from tests.test_duong_nong import PW, _login

SX_LAM = dict(can_read=True, can_create=True, can_update=True, scope=SCOPE_OWN)
SX_GIAO = dict(can_read=True, can_create=True, can_update=True, can_reassign=True, scope=SCOPE_ALL)


def _nguoi(db, username: str, dept_id: int, perms: dict) -> int:
    role = RoleRepository(db).create(name=f"Vai {username}", department_id=dept_id)
    RoleRepository(db).set_permission(role_id=role.id, module_key="san_xuat", **perms)
    users = UserRepository(db)
    u = users.create(username=username, name=f"Tên {username}", password_hash=hash_password(PW))
    users.set_assignment(u, department_id=dept_id, role_id=role.id, is_active=True)
    return u.id


def _don(db, so: str, so_dong: int = 1) -> int:
    don = Order(order_no=so, status=STATUS_ORDERED,
                san_xuat_released_at=datetime(2026, 11, 8, 3, tzinfo=timezone.utc))
    don.lines.extend(OrderLine(description=f"Hộp {i}", qty=10) for i in range(so_dong))
    db.add(don)
    db.commit()
    return don.id


def _dong(db, order_id: int) -> list[int]:
    return [i for (i,) in db.execute(
        select(OrderLine.id).where(OrderLine.order_id == order_id).order_by(OrderLine.id)).all()]


def _cay():
    db = SessionLocal()
    try:
        d = DepartmentRepository(db)
        phong = d.create(name="Phòng Kế hoạch thử giao")
        to = d.create(name="Tổ lệnh thử giao", parent_id=phong.id)
        khac = d.create(name="Phòng khác thử giao")
        ids = {
            "giao": _nguoi(db, "giao_don_kh", phong.id, SX_GIAO),
            "lam": _nguoi(db, "lam_lenh_kh", to.id, SX_LAM),
            "lam2": _nguoi(db, "lam_lenh_kh2", phong.id, SX_LAM),
            "ngoai": _nguoi(db, "lam_lenh_ngoai", khac.id, SX_LAM),
            "chi_xem": _nguoi(db, "chi_xem_kh", phong.id, dict(can_read=True, scope=SCOPE_ALL)),
            "ca_phong": _nguoi(db, "ca_phong_kh", phong.id, {**SX_LAM, "scope": SCOPE_DEPARTMENT}),
        }
        ids.update(d1=_don(db, "DH-GIAO-1"), d2=_don(db, "DH-GIAO-2"), d3=_don(db, "DH-GIAO-3", 2),
                   d4=_don(db, "DH-GIAO-4"))
        return ids
    finally:
        db.close()


def _so(r) -> dict[str, dict]:
    assert r.status_code == 200, r.text
    return {i["order_no"]: i for i in r.json()["items"]}


def _cho(client, h, che_do: str, **params):
    return client.get("/api/lsx/hang-cho", headers=h, params={"che_do": che_do, **params})


def test_giao_don_va_cua_chan_may_chu(client):
    ids = _cay()
    hg, hl = _login(client, "giao_don_kh"), _login(client, "lam_lenh_kh")

    # Không có ô Giao đơn: không mở được Hàng chờ tiếp nhận; đơn chưa giao không có ở Tạo lệnh,
    # không mở được, không tạo được.
    assert _cho(client, hl, "giao").status_code == 403
    assert not {"DH-GIAO-1", "DH-GIAO-2"} & set(_so(_cho(client, hl, "tao")))
    assert client.get(f"/api/lsx/preview/{ids['d1']}", headers=hl).status_code == 403
    db = SessionLocal()
    try:
        d1_dong = _dong(db, ids["d1"])
    finally:
        db.close()
    assert client.post(f"/api/lsx/tao/{ids['d1']}", headers=hl,
                       json={"order_line_ids": d1_dong}).status_code == 403
    # Người giao XEM được sản phẩm và lệnh dự kiến của đơn chưa giao (10/11/2026) — chỉ xem.
    r = client.get(f"/api/lsx/preview/{ids['d1']}", headers=hg)
    assert r.status_code == 200, r.text
    assert len(r.json()["lines"]) == 1
    # Người giao (Tất cả) cũng không tạo được lệnh cho đơn chưa giao.
    assert client.post(f"/api/lsx/tao/{ids['d1']}", headers=hg,
                       json={"order_line_ids": d1_dong}).status_code == 403
    assert client.get("/api/lsx/hang-cho/nguoi-lam-lenh", headers=hl).status_code == 403
    assert client.post("/api/lsx/hang-cho/giao", headers=hl,
                       json={"order_ids": [ids["d1"]], "nguoi_nhan_id": ids["lam"]}).status_code == 403

    # Danh sách người chọn được: cùng phòng (kể cả phòng con) + bản thân, có Thao tác.
    r = client.get("/api/lsx/hang-cho/nguoi-lam-lenh", headers=hg)
    assert r.status_code == 200, r.text
    chon = {x["id"] for x in r.json()}
    assert {ids["giao"], ids["lam"], ids["lam2"]} <= chon
    assert ids["ngoai"] not in chon and ids["chi_xem"] not in chon

    # Giao cho người phòng khác ⇒ 400; giao đúng ⇒ hai đơn sang người phụ trách.
    r = client.post("/api/lsx/hang-cho/giao", headers=hg,
                    json={"order_ids": [ids["d1"], ids["d2"]], "nguoi_nhan_id": ids["ngoai"]})
    assert r.status_code == 400, r.text
    r = client.post("/api/lsx/hang-cho/giao", headers=hg,
                    json={"order_ids": [ids["d1"], ids["d2"]], "nguoi_nhan_id": ids["lam"]})
    assert r.status_code == 200, r.text
    assert sorted(r.json()["da_giao"]) == ["DH-GIAO-1", "DH-GIAO-2"]
    assert r.json()["nguoi_nhan_ten"] == "Tên lam_lenh_kh"

    # Hàng chờ tiếp nhận: cột trạng thái, chip lọc, ô lọc người phụ trách.
    r = _cho(client, hg, "giao", trang_thai="chua_giao")
    assert not {"DH-GIAO-1", "DH-GIAO-2"} & set(_so(r))
    assert r.json()["facets"]["da_giao"] >= 2 and r.json()["la_nguoi_giao"] is True
    tat_ca = _so(_cho(client, hg, "giao"))
    assert tat_ca["DH-GIAO-1"]["trang_thai"] == "da_giao"
    assert tat_ca["DH-GIAO-1"]["nguoi_lam_lenh_ten"] == "Tên lam_lenh_kh"
    assert tat_ca["DH-GIAO-3"]["trang_thai"] == "chua_giao"
    assert set(_so(_cho(client, hg, "giao", nguoi_phu_trach_id=ids["lam"]))) == {"DH-GIAO-1", "DH-GIAO-2"}
    r = client.get("/api/lsx/hang-cho/phu-trach-loc", headers=hg, params={"che_do": "giao"})
    assert {"id": ids["lam"], "ten": "Tên lam_lenh_kh", "so": 2} in r.json()

    # Tạo lệnh, phạm vi Của tôi: thấy đúng hai đơn của mình, chấm "chưa mở" từng đơn và chấm tab.
    r = _cho(client, hl, "tao")
    cua_lam = _so(r)
    assert set(cua_lam) == {"DH-GIAO-1", "DH-GIAO-2"}
    assert cua_lam["DH-GIAO-1"]["chua_mo"] is True and r.json()["cham"] is True
    assert client.get("/api/lsx/hang-cho/cham", headers=hl).json() == {"giao": False, "tao": True}
    assert client.get(f"/api/lsx/preview/{ids['d1']}", headers=hl).status_code == 200
    r = _cho(client, hl, "tao")
    assert _so(r)["DH-GIAO-1"]["chua_mo"] is False and r.json()["cham"] is True   # còn đơn 2
    # Người cùng phòng phạm vi Của tôi: không thấy, không mở được đơn người khác phụ trách.
    h2 = _login(client, "lam_lenh_kh2")
    assert not {"DH-GIAO-1", "DH-GIAO-2"} & set(_so(_cho(client, h2, "tao")))
    assert client.get(f"/api/lsx/preview/{ids['d1']}", headers=h2).status_code == 403
    # Phạm vi Cả phòng: thấy đơn của người trong phòng (kể cả phòng con).
    hp = _login(client, "ca_phong_kh")
    assert {"DH-GIAO-1", "DH-GIAO-2"} <= set(_so(_cho(client, hp, "tao")))

    # Người phụ trách tạo lệnh đơn của mình; người giao (Tất cả) tạo hộ đơn 2 ⇒ phụ trách vẫn là X.
    db = SessionLocal()
    try:
        d2_dong = _dong(db, ids["d2"])
    finally:
        db.close()
    assert client.post(f"/api/lsx/tao/{ids['d1']}", headers=hl,
                       json={"order_line_ids": d1_dong}).status_code == 201
    r = client.post(f"/api/lsx/tao/{ids['d2']}", headers=hg, json={"order_line_ids": d2_dong})
    assert r.status_code == 201, r.text
    db = SessionLocal()
    try:
        phu_trach = dict(db.execute(select(Lsx.order_id, Lsx.nguoi_phu_trach_id)
                                    .where(Lsx.order_id.in_([ids["d1"], ids["d2"]]))).all())
        assert phu_trach == {ids["d1"]: ids["lam"], ids["d2"]: ids["lam"]}
        ma = {a.action for a in db.execute(select(AuditLog).where(
            AuditLog.target.in_([f"order:{ids['d1']}", f"order:{ids['d2']}"]))).scalars()}
        assert {"giao_don_lam_lenh", "tao_lsx_ho"} <= ma
        bao = {(n.event_type, n.recipient_user_id) for n in db.execute(
            select(ModuleNotification).where(ModuleNotification.channel == "san_xuat")).scalars()}
        assert ("giao_don_lam_lenh", ids["lam"]) in bao and ("tao_lsx_ho", ids["lam"]) in bao
    finally:
        db.close()

    # Bảng lệnh theo người phụ trách: Của tôi thấy lệnh mình phụ trách (kể cả lệnh người khác tạo hộ),
    # người cùng phòng phạm vi Của tôi không thấy, phạm vi Cả phòng thấy.
    def _so_lenh(h, order_id):
        r = client.get("/api/lsx", headers=h, params={"order_id": order_id})
        assert r.status_code == 200, r.text
        return r.json()["total"]

    assert _so_lenh(hl, ids["d1"]) == 1 and _so_lenh(hl, ids["d2"]) == 1
    assert _so_lenh(h2, ids["d2"]) == 0 and _so_lenh(hp, ids["d2"]) == 1
    db = SessionLocal()
    try:
        lenh_d2 = db.execute(select(Lsx.id).where(Lsx.order_id == ids["d2"])).scalar_one()
    finally:
        db.close()
    assert client.get(f"/api/lsx/{lenh_d2}", headers=hl).status_code == 200
    assert client.get(f"/api/lsx/{lenh_d2}", headers=h2).status_code == 404


def test_giao_lai_giu_phu_trach_lenh_cu(client):
    ids = _cay()
    hg, hl = _login(client, "giao_don_kh"), _login(client, "lam_lenh_kh")
    db = SessionLocal()
    try:
        d3 = _dong(db, ids["d3"])
    finally:
        db.close()
    assert client.post("/api/lsx/hang-cho/giao", headers=hg,
                       json={"order_ids": [ids["d3"]], "nguoi_nhan_id": ids["lam"]}).status_code == 200
    assert client.post(f"/api/lsx/tao/{ids['d3']}", headers=hl,
                       json={"order_line_ids": d3[:1]}).status_code == 201
    # Có lệnh, còn dòng chưa lên ⇒ vẫn Đã giao (không có trạng thái thứ ba), số lệnh đọc riêng.
    r = _cho(client, hg, "giao", trang_thai="da_giao")
    d = _so(r)["DH-GIAO-3"]
    assert d["trang_thai"] == "da_giao" and d["so_dong_co_lsx"] == 1 and d["so_dong"] == len(d3)
    assert "tao_mot_phan" not in r.json()["facets"] and "dang_lam" not in r.json()["facets"]
    # Giao lại cho chính người giao: dòng còn lại thuộc người mới, lệnh đã tạo giữ người cũ.
    r = client.post("/api/lsx/hang-cho/giao", headers=hg,
                    json={"order_ids": [ids["d3"]], "nguoi_nhan_id": ids["giao"]})
    assert r.status_code == 200 and r.json()["giao_lai"] == ["DH-GIAO-3"], r.text
    # Giao lại đúng người đang giữ ⇒ bỏ qua.
    r = client.post("/api/lsx/hang-cho/giao", headers=hg,
                    json={"order_ids": [ids["d3"]], "nguoi_nhan_id": ids["giao"]})
    assert r.json()["bo_qua"] == 1
    # Người cũ không còn thấy, không tạo tiếp được.
    assert "DH-GIAO-3" not in _so(_cho(client, hl, "tao"))
    assert client.post(f"/api/lsx/tao/{ids['d3']}", headers=hl,
                       json={"order_line_ids": d3[1:]}).status_code == 403
    assert client.post(f"/api/lsx/tao/{ids['d3']}", headers=hg,
                       json={"order_line_ids": d3[1:]}).status_code == 201
    db = SessionLocal()
    try:
        theo_dong = dict(db.execute(select(Lsx.order_line_id, Lsx.nguoi_phu_trach_id)
                                    .where(Lsx.order_id == ids["d3"])).all())
        assert theo_dong == {d3[0]: ids["lam"], d3[1]: ids["giao"]}
        assert db.execute(select(AuditLog.id).where(
            AuditLog.action == "giao_lai_don_lam_lenh",
            AuditLog.target == f"order:{ids['d3']}")).first() is not None
    finally:
        db.close()
    r = client.get("/api/lsx", headers=hg, params={"cua_toi": "true", "order_id": ids["d3"]})
    assert r.status_code == 200 and r.json()["total"] == 1


def test_don_moi_chi_bao_nguoi_giao():
    """Chấm đơn mới vào hàng chờ đòi ô Giao đơn (`required_action = reassign`)."""
    from app.services.thong_bao_man import KENH

    assert "reassign" in KENH["san_xuat"]
