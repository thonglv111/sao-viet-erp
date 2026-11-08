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


def _ncc(client, h, ten: str, van_chuyen: bool) -> int:
    mst = str(abs(hash(ten)) % 10**10).rjust(10, "1")
    r = client.post("/api/suppliers", headers=h, json={
        "name": ten, "tax_code": mst, "phone": "0900000000", "email": "x@example.com",
        "address": "1 Le Loi", "contact_name": "A", "supplier_group": "paper",
        "payment_terms": "Cong no 30 ngay", "items": [], "la_don_vi_van_chuyen": van_chuyen})
    assert r.status_code in (200, 201), r.text
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
    thuong = _ncc(client, h, "NCC giấy", van_chuyen=False)
    r = _xuat(client, h, oid, lid, 10, {"loai": "dich_vu", "don_vi_vc_id": thuong, "tien_cuoc": 50000})
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
    vc = _ncc(client, h, "Viettel Post", van_chuyen=True)
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
    vc = _ncc(client, h, "GHTK", van_chuyen=True)
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
