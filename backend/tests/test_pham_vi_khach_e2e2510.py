"""Khách hàng — điều chuyển theo cây phòng, hộp NV phụ trách theo nhóm dùng chung
(bấm thử 25/10/2026, L-VAI-09/43)."""
from __future__ import annotations

from app.db import SessionLocal
from app.repositories.rbac_repo import DepartmentRepository
from app.repositories.user_repo import UserRepository
from tests.test_customer_reassign_api import _mk_customer, _mk_user, _owner, _token
from tests.test_nhom_dung_chung_kd import _QUYEN, _gop_nhom, _h, _sale_own


def _phong_con(ten: str, cha: str = "Kinh doanh") -> int:
    s = SessionLocal()
    try:
        depts = DepartmentRepository(s)
        d = depts.get_by_name(ten) or depts.create(name=ten, parent_id=depts.get_by_name(cha).id)
        return d.id
    finally:
        s.close()


def _chuyen_phong(uid: int, dept_id: int) -> None:
    s = SessionLocal()
    try:
        users = UserRepository(s)
        u = users.get_by_id(uid)
        users.set_assignment(u, department_id=dept_id, role_id=u.role_id, is_active=True)
    finally:
        s.close()


def test_truong_phong_dieu_chuyen_sang_sale_phong_con(client):
    """L-VAI-09: trưởng phòng KD (Cả phòng) chuyển khách sang sale ở phòng con → 200."""
    tp = _mk_user("pv09-tp", "Trưởng phòng KD", "Kinh doanh")
    sale_a = _mk_user("pv09-a", "NV Sales", "Kinh doanh")
    sale_con = _mk_user("pv09-con", "NV Sales", "Kinh doanh")
    _chuyen_phong(sale_con, _phong_con("KD nhóm PV09"))
    cid = _mk_customer("Khách PV09", sale_a)
    r = client.post("/api/customers/reassign", headers=_token(tp),
                    json={"customer_ids": [cid], "to_sale_user_id": sale_con})
    assert r.status_code == 200, r.text
    assert _owner(cid) == sale_con
    # Phòng ngoài cây vẫn bị chặn.
    ngoai = _mk_user("pv09-ngoai", None, "Sản xuất")
    r2 = client.post("/api/customers/reassign", headers=_token(tp),
                     json={"customer_ids": [cid], "to_sale_user_id": ngoai})
    assert r2.status_code == 400, r2.text


def test_hop_nv_phu_trach_co_nguoi_cung_nhom_nhung_khong_gan_duoc(client):
    """L-VAI-43: sale Của tôi cùng nhóm với B thấy B trong hộp lọc (B đang giữ khách hiện trong
    bảng), nhưng B không phải lựa chọn GÁN (chủ chốt: chỉ lọc, không gán)."""
    uid_a, tok_a = _sale_own("pv43_a", **_QUYEN)
    uid_b, _ = _sale_own("pv43_b", **_QUYEN)
    _mk_customer("Khách của B PV43", uid_b)
    _gop_nhom("Cặp PV43", [uid_a, uid_b])
    ds = client.get("/api/customers", headers=_h(tok_a)).json()
    assert any(c["sale_user_id"] == uid_b for c in ds["items"])
    r = client.get("/api/customers/sales", headers=_h(tok_a))
    assert r.status_code == 200, r.text
    theo_id = {o["id"]: o for o in r.json()}
    assert uid_b in theo_id, r.json()
    assert theo_id[uid_b]["co_the_gan"] is False
    assert uid_a in theo_id
