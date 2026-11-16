"""Đơn gia công (plan Task 3.1): lập gộp nhiều lệnh, không đặt một việc hai lần, sửa / đặt / huỷ,
trạng thái dẫn xuất, gợi ý đơn giá."""
from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace as NS

import pytest

from app.models.audit import AuditLog
from app.models.thue_gia_cong import TgcPhieuGiao, TgcViec
from app.services.thue_gia_cong import TgcXungDot
from app.services.thue_gia_cong import don as don_svc
from tests.gia_cong_fixtures import dung_lenh_gia_cong, ncc
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401

ADMIN = {"username": "admin", "password": "admin123"}
_BUOC = [
    ("In", "may", None, 1660, "to"),
    ("Cán màng", "thue_ngoai", None, 1660, "to"),
    ("Bế", "may", None, 1650, "cai"),
]


def _h(client) -> dict[str, str]:
    r = client.post("/api/auth/login", json=ADMIN)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _viec(sess, lsx_id) -> TgcViec:
    return sess.query(TgcViec).filter_by(lsx_id=lsx_id).one()


def _hai_lenh(sess, orders, lsx_svc, admin, customer):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    b = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    return a, b


def test_tao_don_gop_hai_lenh(client, sess, orders, lsx_svc, admin, customer):
    a, b = _hai_lenh(sess, orders, lsx_svc, admin, customer)
    va, vb = _viec(sess, a), _viec(sess, b)
    nha = ncc(sess, "Cán màng Minh Phát")
    h = _h(client)
    r = client.post("/api/thue-gia-cong/don", headers=h, json={
        "nha_cung_cap_id": nha.id, "ngay_dat": date.today().isoformat(),
        "ngay_hen_ve": (date.today() + timedelta(days=3)).isoformat(),
        "dong": [{"viec_id": va.id, "sl_dat": 1660, "don_gia": 600},
                 {"viec_id": vb.id, "sl_dat": 1660, "don_gia": 600}],
        "dat": True})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["ma"].startswith("GC") and d["trang_thai"] == "da_dat"
    assert {x["viec_id"] for x in d["dong"]} == {va.id, vb.id}
    assert {l["lsx_id"] for l in d["lenh"]} == {a, b}
    assert d["tong_tien_dat"] == 2 * 1660 * 600
    # Hai việc rụng khỏi Hàng chờ.
    hc = client.get("/api/thue-gia-cong/hang-cho", headers=h).json()["items"]
    assert not {va.id, vb.id} & {x["viec_id"] for x in hc}
    # Danh sách đơn tìm theo mã lệnh, đếm theo trạng thái.
    ds = client.get("/api/thue-gia-cong/don", headers=h, params={"q": d["lenh"][0]["lsx_ma"]}).json()
    assert d["id"] in {x["id"] for x in ds["items"]} and ds["facets"]["da_dat"] >= 1


def test_khong_dat_viec_hai_lan(sess, orders, lsx_svc, admin, customer):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    v = _viec(sess, a)
    nha = ncc(sess, "NCC hai lần")
    don_svc.tao(sess, user=admin, nha_cung_cap_id=nha.id, ngay_dat=date.today(),
                dong=[{"viec_id": v.id, "sl_dat": 1660, "don_gia": 600}])
    with pytest.raises(TgcXungDot, match="đã nằm trong đơn"):
        don_svc.tao(sess, user=admin, nha_cung_cap_id=nha.id, ngay_dat=date.today(),
                    dong=[{"viec_id": v.id, "sl_dat": 1660, "don_gia": 600}])


def test_nha_da_bo_khoi_danh_sach_bi_chan(client, sess, orders, lsx_svc, admin, customer):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    khong = ncc(sess, "Bế Tân Tiến", nhan=False)
    r = client.post("/api/thue-gia-cong/don", headers=_h(client), json={
        "nha_cung_cap_id": khong.id, "ngay_dat": date.today().isoformat(),
        "dong": [{"viec_id": _viec(sess, a).id, "sl_dat": 1660, "don_gia": 600}]})
    assert r.status_code == 400 and "bỏ khỏi danh sách" in r.json()["detail"]


def test_sua_don_gia_sau_dat_ghi_nhat_ky(client, sess, orders, lsx_svc, admin, customer):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    v = _viec(sess, a)
    nha = ncc(sess, "NCC sửa giá")
    d = don_svc.tao(sess, user=admin, nha_cung_cap_id=nha.id, ngay_dat=date.today(),
                    dong=[{"viec_id": v.id, "sl_dat": 1660, "don_gia": 600}], dat=True)
    h = _h(client)
    r = client.put(f"/api/thue-gia-cong/don/{d.id}", headers=h, json={
        "version": d.version, "nha_cung_cap_id": nha.id, "ngay_dat": d.ngay_dat.isoformat(),
        "dong": [{"viec_id": v.id, "sl_dat": 1660, "don_gia": 650}]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["dong"][0]["don_gia"] == 650
    assert any(x["hanh_dong"] == "Sửa đơn giá gia công" and "600đ → 650đ" in x["chi_tiet"]
               for x in out["lich_su"])
    # Đã đặt thì không đổi nhà gia công.
    khac = ncc(sess, "NCC khác")
    r = client.put(f"/api/thue-gia-cong/don/{d.id}", headers=h, json={
        "version": out["version"], "nha_cung_cap_id": khac.id, "ngay_dat": d.ngay_dat.isoformat(),
        "dong": [{"viec_id": v.id, "sl_dat": 1660, "don_gia": 650}]})
    assert r.status_code == 400 and "không đổi nhà gia công" in r.json()["detail"]
    # Lệch version ⇒ 409.
    r = client.put(f"/api/thue-gia-cong/don/{d.id}", headers=h, json={
        "version": d.version, "nha_cung_cap_id": nha.id, "ngay_dat": d.ngay_dat.isoformat(),
        "dong": [{"viec_id": v.id, "sl_dat": 1660, "don_gia": 700}]})
    assert r.status_code == 409


def test_huy_don_tra_viec_ve_hang_cho(client, sess, orders, lsx_svc, admin, customer):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    v = _viec(sess, a)
    nha = ncc(sess, "NCC huỷ")
    d = don_svc.tao(sess, user=admin, nha_cung_cap_id=nha.id, ngay_dat=date.today(),
                    dong=[{"viec_id": v.id, "sl_dat": 1660, "don_gia": 600}], dat=True)
    h = _h(client)
    r = client.post(f"/api/thue-gia-cong/don/{d.id}/huy", headers=h,
                    json={"version": d.version, "ly_do": "Nhà gia công báo bận"})
    assert r.status_code == 200, r.text
    assert r.json()["trang_thai"] == "huy" and r.json()["dong"][0]["huy_luc"]
    hc = client.get("/api/thue-gia-cong/hang-cho", headers=h).json()["items"]
    assert v.id in {x["viec_id"] for x in hc}
    # Việc đặt lại được với đơn mới.
    don_svc.tao(sess, user=admin, nha_cung_cap_id=nha.id, ngay_dat=date.today(),
                dong=[{"viec_id": v.id, "sl_dat": 1660, "don_gia": 600}])


def test_huy_don_co_phieu_giao_bi_chan(sess, orders, lsx_svc, admin, customer):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    nha = ncc(sess, "NCC có phiếu")
    d = don_svc.tao(sess, user=admin, nha_cung_cap_id=nha.id, ngay_dat=date.today(),
                    dong=[{"viec_id": _viec(sess, a).id, "sl_dat": 1660, "don_gia": 600}], dat=True)
    sess.add(TgcPhieuGiao(ma="GG26-9901", don_id=d.id))
    sess.commit()
    with pytest.raises(ValueError, match="GG26-9901"):
        don_svc.huy(sess, user=admin, don_id=d.id, expected_version=d.version, ly_do="Thử huỷ")


def _dong(id_, sl_dat=100, hoan_tat=None):
    return NS(id=id_, sl_dat=sl_dat, hoan_tat_luc=hoan_tat, huy_luc=None)


@pytest.mark.parametrize("don, dongs, sl, ky_vong", [
    (NS(huy_luc=1, dat_luc=1), [_dong(1)], {}, "huy"),
    (NS(huy_luc=None, dat_luc=None), [_dong(1)], {}, "nhap"),
    (NS(huy_luc=None, dat_luc=1), [_dong(1)], {1: {}}, "da_dat"),
    (NS(huy_luc=None, dat_luc=1), [_dong(1)], {1: {"co_giao": True, "giao_quy_doi": 60}}, "giao_mot_phan"),
    (NS(huy_luc=None, dat_luc=1), [_dong(1), _dong(2)],
     {1: {"co_giao": True, "giao_quy_doi": 100}, 2: {}}, "giao_mot_phan"),
    (NS(huy_luc=None, dat_luc=1), [_dong(1)], {1: {"co_giao": True, "giao_quy_doi": 100}}, "giao_du"),
    (NS(huy_luc=None, dat_luc=1), [_dong(1)], {1: {"tron_goi": True, "co_giao": True}}, "giao_du"),
    (NS(huy_luc=None, dat_luc=1), [_dong(1)],
     {1: {"co_giao": True, "giao_quy_doi": 100, "co_nhan": True}}, "ve_mot_phan"),
    (NS(huy_luc=None, dat_luc=1), [_dong(1, hoan_tat=1), _dong(2)],
     {1: {"co_nhan": True}, 2: {}}, "ve_mot_phan"),
    (NS(huy_luc=None, dat_luc=1), [_dong(1, hoan_tat=1), _dong(2, hoan_tat=1)], {}, "hoan_tat"),
])
def test_trang_thai_dan_xuat(don, dongs, sl, ky_vong):
    assert don_svc.trang_thai(don, dongs, sl) == ky_vong


def test_goi_y_don_gia_lan_truoc(client, sess, orders, lsx_svc, admin, customer):
    a, b = _hai_lenh(sess, orders, lsx_svc, admin, customer)
    nha = ncc(sess, "NCC gợi ý")
    assert don_svc.goi_y_don_gia(sess, nha.id, "Cán màng") is None
    don_svc.tao(sess, user=admin, nha_cung_cap_id=nha.id, ngay_dat=date.today() - timedelta(days=5),
                dong=[{"viec_id": _viec(sess, a).id, "sl_dat": 1660, "don_gia": 550}], dat=True)
    moi = don_svc.tao(sess, user=admin, nha_cung_cap_id=nha.id, ngay_dat=date.today(),
                      dong=[{"viec_id": _viec(sess, b).id, "sl_dat": 1660, "don_gia": 620}], dat=True)
    r = client.get("/api/thue-gia-cong/goi-y-don-gia", headers=_h(client),
                   params={"nha_cung_cap_id": nha.id, "ten_viec": "cán màng"})
    assert r.status_code == 200 and r.json() == {"don_gia": 620}
    # Đang sửa đơn mới thì "lần trước" là đơn cũ, không phải giá của chính nó.
    assert don_svc.goi_y_don_gia(sess, nha.id, "Cán màng", bo_don_id=moi.id) == 550
    assert don_svc.goi_y_don_gia(sess, ncc(sess, "NCC chưa từng").id, "Cán màng") is None


def test_trang_thai_buoc_lenh_da_dat(client, sess, orders, lsx_svc, admin, customer):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    nha = ncc(sess, "NCC hẹn về")
    hen = date.today() + timedelta(days=4)
    d = don_svc.tao(sess, user=admin, nha_cung_cap_id=nha.id, ngay_dat=date.today(), ngay_hen_ve=hen,
                    dong=[{"viec_id": _viec(sess, a).id, "sl_dat": 1660, "don_gia": 600}])
    h = _h(client)
    (t,) = client.get(f"/api/thue-gia-cong/lenh/{a}", headers=h).json()
    assert t["trang_thai"] == "nhap" and t["nhan"] == f"Đơn nháp {d.ma}"
    r = client.post(f"/api/thue-gia-cong/don/{d.id}/dat", headers=h, json={"version": d.version})
    assert r.status_code == 200, r.text
    (t,) = client.get(f"/api/thue-gia-cong/lenh/{a}", headers=h).json()
    assert t["trang_thai"] == "da_dat" and t["nhan"] == f"Đã đặt {d.ma} hẹn về {hen:%d/%m}"
    assert sess.query(AuditLog).filter_by(action="tgc_don_dat", target=f"tgc_don:{d.id}").count() == 1
