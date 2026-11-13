"""Giao hàng kiểu In Hà Phương (docs/design-giao-hang-ha-phuong.md) — chỉ bản cài bật `giao_hang_hp`."""
from __future__ import annotations

from datetime import date

import pytest

from app.config import settings
from app.db import SessionLocal
from app.models.department import Department
from app.models.giao_hang_hp import PhuongThucGiaoHp
from app.models.user import User

from tests.test_giao_hang_api import _admin, _don_da_chot
from tests.test_xuat_hang_don_ban import _gan_ho_so_admin


@pytest.fixture
def hp(monkeypatch):
    """Cấu hình In Hà Phương: tắt Giao hàng cũ, bật thương mại + giao hàng kiểu Hà Phương."""
    monkeypatch.setattr(settings, "phan_he_tat", "giao_hang")
    monkeypatch.setattr(settings, "phan_he_bat", "thuong_mai,giao_hang_hp")


def _nguoi_giao(ma: str, co_bo_phan: bool = True) -> int:
    db = SessionLocal()
    try:
        d = Department(name=f"Tổ giao {ma}", code=f"GH{ma}", la_giao_hang=co_bo_phan)
        db.add(d)
        db.flush()
        u = User(username=f"giao_{ma}", name=f"Tài xế {ma}", password_hash="x", department_id=d.id)
        db.add(u)
        db.commit()
        return u.id
    finally:
        db.close()


def _dvvc(client, h, ten: str) -> int:
    """Thêm đơn vị vận chuyển ngay ở danh sách riêng (không dính nhà cung cấp)."""
    r = client.post("/api/giao-hang-hp/don-vi-van-chuyen", headers=h, json={"ten": ten})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _xuat(client, h, oid, lid, qty, pt):
    body = {"order_id": oid, "ngay_can_giao": date.today().isoformat(),
            "lines": [{"order_line_id": lid, "qty": qty}]}
    if pt is not None:
        body["phuong_thuc"] = pt
    return client.post("/api/giao-hang-hp/xuat-hang", headers=h, json=body)


def test_tat_phan_he_thi_404_va_svn_y_nguyen(client, monkeypatch):
    """Sao Việt Nhật (mặc định): không có đường nào của giao hàng HP, không danh mục xe mới."""
    monkeypatch.setattr(settings, "phan_he_bat", "")
    h = _admin(client)
    assert client.get("/api/xe-giao-hang", headers=h).status_code == 404
    assert client.get("/api/giao-hang-hp/nguoi-giao", headers=h).status_code == 404
    assert client.post("/api/giao-hang-hp/xuat-hang", headers=h, json={}).status_code == 404
    assert client.get("/api/giao-hang-hp/cuoc-cho-chi", headers=h).status_code == 404
    perms = client.get("/api/auth/permissions", headers=h).json()
    assert "giao_hang_hp" in perms["phan_he_tat"]
    mods = {m["key"] for m in client.get("/api/rbac/modules", headers=h).json()}
    assert "xe_giao_hang" in mods  # ô quyền vẫn seed, chỉ không ai có quyền khi tắt


def test_danh_muc_xe_va_nguoi_phu_trach(client, hp):
    h = _admin(client)
    uid = _nguoi_giao("A")
    ngoai = _nguoi_giao("B", co_bo_phan=False)
    r = client.post("/api/xe-giao-hang", headers=h, json={"ma": "29C-123.45", "ten": "Xe tải nhỏ",
                                                          "nguoi_phu_trach_id": ngoai})
    assert r.status_code == 422 and "bộ phận giao hàng" in r.json()["detail"]
    r = client.post("/api/xe-giao-hang", headers=h, json={"ma": "29C-123.45", "ten": "Xe tải nhỏ",
                                                          "nguoi_phu_trach_id": uid})
    assert r.status_code == 201, r.text
    xe_id = r.json()["id"]
    ds = client.get("/api/xe-giao-hang", headers=h).json()["items"]
    assert ds[0]["nguoi_phu_trach_ten"] == "Tài xế A"
    nguoi = client.get("/api/giao-hang-hp/nguoi-giao", headers=h).json()["items"]
    assert [(n["id"], n["xe_id"]) for n in nguoi] == [(uid, xe_id)]


def test_xuat_hang_bat_chon_cach_giao(client, hp):
    _gan_ho_so_admin()
    h = _admin(client)
    oid, lid = _don_da_chot(suffix="HP1", qty=1000)
    assert _xuat(client, h, oid, lid, 10, None).status_code == 400
    r = _xuat(client, h, oid, lid, 10, {"loai": "noi_bo"})
    assert r.status_code == 400 and "người giao" in r.json()["detail"]
    ngoai = _nguoi_giao("C", co_bo_phan=False)
    r = _xuat(client, h, oid, lid, 10, {"loai": "noi_bo", "nguoi_giao_id": ngoai})
    assert r.status_code == 400
    r = _xuat(client, h, oid, lid, 10, {"loai": "dich_vu", "don_vi_vc_id": 987654, "tien_cuoc": 50000})
    assert r.status_code == 400 and "Đơn vị vận chuyển" in r.json()["detail"]

    uid = _nguoi_giao("D")
    r = _xuat(client, h, oid, lid, 10, {"loai": "noi_bo", "nguoi_giao_id": uid})
    assert r.status_code == 201, r.text
    ds = client.get(f"/api/giao-hang-hp/don/{oid}", headers=h).json()["items"]
    assert len(ds) == 1 and ds[0]["loai"] == "noi_bo" and ds[0]["nguoi_giao_ten"] == "Tài xế D"
    assert ds[0]["ma_lan_xuat"] == r.json()["phieu_kho"]
    db = SessionLocal()
    try:
        pt = db.get(PhuongThucGiaoHp, r.json()["phuong_thuc_id"])
        assert pt.stock_request_id is not None and pt.nguoi_chon_id is not None
    finally:
        db.close()


def test_cuoc_vao_hang_cho_chi_va_lap_phieu_chi(client, hp):
    _gan_ho_so_admin()
    h = _admin(client)
    oid, lid = _don_da_chot(suffix="HP2", qty=1000)
    vc = _dvvc(client, h, "Viettel Post")
    assert [d["id"] for d in client.get("/api/giao-hang-hp/don-vi-van-chuyen", headers=h).json()["items"]] == [vc]
    for qty, cuoc in ((10, 30000), (20, 45000)):
        r = _xuat(client, h, oid, lid, qty, {"loai": "dich_vu", "don_vi_vc_id": vc, "tien_cuoc": cuoc,
                                              "ma_van_don": "VD1"})
        assert r.status_code == 201, r.text
    moi = client.get(f"/api/giao-hang-hp/moi-nhat?order_ids={oid}", headers=h).json()["items"]
    assert moi[str(oid)]["tien_cuoc"] == 45000 and moi[str(oid)]["don_vi_vc_ten"] == "Viettel Post"

    cho = client.get("/api/giao-hang-hp/cuoc-cho-chi", headers=h).json()["items"]
    assert [c["con"] for c in cho] == [30000, 45000]
    muc = client.post("/api/muc-thu-chi", headers=h, json={"ten": "Cước vận chuyển", "loai": "chi"}).json()["id"]
    r = client.post("/api/giao-hang-hp/cuoc-cho-chi/phieu-chi", headers=h, json={
        "dong": [{"phuong_thuc_giao_hp_id": c["phuong_thuc_giao_hp_id"], "amount": c["con"]} for c in cho],
        "voucher_type": "cash", "voucher_date": date.today().isoformat(), "muc_thu_chi_id": muc})
    assert r.status_code == 201, r.text
    pc = r.json()
    assert pc["amount"] == 75000 and pc["cash_recipient_name"] == "Viettel Post"
    assert client.get("/api/giao-hang-hp/cuoc-cho-chi", headers=h).json()["items"] == []

    # Huỷ phiếu chi ⇒ cước quay lại hàng chờ.
    r = client.post(f"/api/accounting/payment-vouchers/{pc['id']}/cancel", headers=h, json={"reason": "Lập nhầm"})
    assert r.status_code == 200, r.text
    assert len(client.get("/api/giao-hang-hp/cuoc-cho-chi", headers=h).json()["items"]) == 2


def test_tien_cuoc_xoa_khi_khong_quyen_phieu_chi(client, hp, monkeypatch):
    _gan_ho_so_admin()
    h = _admin(client)
    oid, lid = _don_da_chot(suffix="HP3", qty=1000)
    vc = _dvvc(client, h, "GHTK")
    assert _xuat(client, h, oid, lid, 10, {"loai": "dich_vu", "don_vi_vc_id": vc, "tien_cuoc": 20000}).status_code == 201
    from app.services.rbac_service import AuthorizationService

    goc = AuthorizationService.can
    monkeypatch.setattr(AuthorizationService, "can",
                        lambda self, u, m, a: False if m == "phieu_chi" else goc(self, u, m, a))
    ds = client.get(f"/api/giao-hang-hp/don/{oid}", headers=h).json()["items"]
    assert ds[0]["tien_cuoc"] is None and ds[0]["don_vi_vc_ten"] == "GHTK"


def test_don_thuong_mai_ghi_cach_giao_theo_luot(client, hp):
    from tests.test_luot_xuat_thuong_mai import _don_chot, _hang, _kho, _nhap

    h = _admin(client)
    hid, dv = _hang(client, h, "TM-GH", gia=5000)
    kho = _kho(client, h, "Kho CH GH")
    _nhap(client, h, kho, hid, dv, 10, 3000)
    d = _don_chot(client, h, hid, dv, qty=5, kh="KH giao HP")
    ol = d["lines"][0]["id"]
    r = client.post(f"/api/thuong-mai/don/{d['id']}/xuat", headers=h, json={
        "kho_id": kho, "lines": [{"order_line_id": ol, "qty": 2}]})
    assert r.status_code == 400 and "cách giao" in r.json()["detail"]
    r = client.post(f"/api/thuong-mai/don/{d['id']}/xuat", headers=h, json={
        "kho_id": kho, "lines": [{"order_line_id": ol, "qty": 2}], "phuong_thuc": {"loai": "khong_giao"}})
    assert r.status_code == 201, r.text
    ds = client.get(f"/api/giao-hang-hp/don/{d['id']}", headers=h).json()["items"]
    assert ds[0]["loai"] == "khong_giao" and ds[0]["luot_xuat_tm_id"] == r.json()["luot"][0]["id"]
    assert ds[0]["ma_lan_xuat"] == f"{d['order_no']}-X1"


def test_loc_don_hang_ban_theo_cach_giao_va_nguoi_giao(client, hp):
    """Nút Lọc của Đơn hàng bán: đơn có ít nhất một lần xuất khớp cách giao / người giao / đơn vị VC."""
    from tests.test_luot_xuat_thuong_mai import _don_chot, _hang

    h = _admin(client)
    hid, dv = _hang(client, h, "TM-LOC", gia=5000)
    a = _don_chot(client, h, hid, dv, qty=1, kh="KH lọc A")["id"]
    b = _don_chot(client, h, hid, dv, qty=1, kh="KH lọc B")["id"]
    c = _don_chot(client, h, hid, dv, qty=1, kh="KH lọc C")["id"]
    uid = _nguoi_giao("L")
    vc = _dvvc(client, h, "VC lọc")
    with SessionLocal() as db:
        db.add_all([
            PhuongThucGiaoHp(order_id=a, loai="noi_bo", nguoi_giao_id=uid),
            PhuongThucGiaoHp(order_id=b, loai="dich_vu", don_vi_vc_id=vc, tien_cuoc=0),
            PhuongThucGiaoHp(order_id=c, loai="khong_giao"),
        ])
        db.commit()

    def ds(qs):
        r = client.get(f"/api/orders?{qs}&size=100", headers=h)
        assert r.status_code == 200, r.text
        return {x["id"] for x in r.json()["items"]} & {a, b, c}

    assert ds("cach_giao=noi_bo") == {a}
    assert ds("cach_giao=khong_giao") == {c}
    assert ds(f"nguoi_giao={uid}") == {a}
    assert ds(f"don_vi_vc={vc}") == {b}
    assert ds(f"cach_giao=noi_bo&nguoi_giao={uid}") == {a}
    assert client.get("/api/orders?cach_giao=xe_om", headers=h).status_code == 422


def test_danh_sach_don_vi_van_chuyen_them_bo_ngay_o_hop_xuat(client, hp):
    """Đơn vị vận chuyển là danh sách riêng: gợi ý hãng phổ biến, thêm trùng tên dùng lại, bỏ đơn vị đã
    giao thì chỉ ẩn (lịch sử còn tên), chưa giao thì xoá hẳn; thêm lại tên đã bỏ thì bật lại dòng cũ."""
    _gan_ho_so_admin()
    h = _admin(client)
    url = "/api/giao-hang-hp/don-vi-van-chuyen"
    dau = client.get(url, headers=h).json()
    assert dau["items"] == [] and "Viettel Post" in dau["goi_y"]

    vt = _dvvc(client, h, "Viettel Post")
    assert _dvvc(client, h, "  viettel   post ") == vt
    sau = client.get(url, headers=h).json()
    assert [d["ten"] for d in sau["items"]] == ["Viettel Post"] and "Viettel Post" not in sau["goi_y"]
    assert client.post(url, headers=h, json={"ten": "   "}).status_code == 400

    rieng = _dvvc(client, h, "Xe ôm anh Tư")
    assert client.delete(f"{url}/{rieng}", headers=h).status_code == 204
    assert rieng not in [d["id"] for d in client.get(f"{url}?ca_da_bo=true", headers=h).json()["items"]]

    oid, lid = _don_da_chot(suffix="HP9", qty=100)
    assert _xuat(client, h, oid, lid, 5, {"loai": "dich_vu", "don_vi_vc_id": vt, "tien_cuoc": 10000}).status_code == 201
    assert client.delete(f"{url}/{vt}", headers=h).status_code == 204
    assert client.get(url, headers=h).json()["items"] == []
    da_bo = client.get(f"{url}?ca_da_bo=true", headers=h).json()["items"]
    assert [(d["id"], d["active"]) for d in da_bo] == [(vt, False)]
    assert client.get(f"/api/giao-hang-hp/don/{oid}", headers=h).json()["items"][0]["don_vi_vc_ten"] == "Viettel Post"
    r = _xuat(client, h, oid, lid, 5, {"loai": "dich_vu", "don_vi_vc_id": vt, "tien_cuoc": 10000})
    assert r.status_code == 400
    assert _dvvc(client, h, "Viettel Post") == vt
    assert client.delete(f"{url}/987654", headers=h).status_code == 404


def test_them_bo_don_vi_van_chuyen_can_quyen_sua_don_ban(client, hp):
    """Chỉ xem Đơn hàng bán thì đọc được danh sách, không thêm hay bỏ được (ô Sửa mới xuất hàng được)."""
    from app.repositories.rbac_repo import DepartmentRepository, RoleRepository
    from app.repositories.user_repo import UserRepository
    from app.security import create_access_token, hash_password

    _gan_ho_so_admin()
    vt = _dvvc(client, _admin(client), "Ahamove")
    db = SessionLocal()
    try:
        dept = DepartmentRepository(db).get_by_name("Sản xuất")
        roles = RoleRepository(db)
        role = roles.create(name="Vai chỉ xem đơn bán", department_id=dept.id)
        roles.set_permission(role_id=role.id, module_key="don_hang_ban", scope="all", can_read=True)
        users = UserRepository(db)
        u = users.create(username="chi-xem-dhb", name="chi-xem-dhb", password_hash=hash_password("x"))
        users.set_assignment(u, department_id=dept.id, role_id=role.id, is_active=True)
        h = {"Authorization": f"Bearer {create_access_token(str(u.id))}"}
    finally:
        db.close()
    url = "/api/giao-hang-hp/don-vi-van-chuyen"
    assert client.get(url, headers=h).status_code == 200
    assert client.post(url, headers=h, json={"ten": "GHN"}).status_code == 403
    assert client.delete(f"{url}/{vt}", headers=h).status_code == 403
