"""Hoàn tất dòng đơn gia công + sổ Hàng đang ở ngoài (plan đợt 5, Task 5.2): hao hụt chụp lúc hoàn
tất, vật tư dư trả kho thành đề nghị nhập, công việc chỉ Hoàn thành ở đây, mở lại gỡ đúng phần đó."""
from __future__ import annotations

from datetime import date

import pytest

from app.models.san_xuat import CV_HOAN_THANH, CV_PHAT_HANH
from app.models.stock_request import REQ_CANCELLED, REQ_NHAP, StockRequest, StockRequestLine
from app.models.thue_gia_cong import NOI_VE_XUONG, TgcViec
from app.models.user import User
from app.repositories.thue_gia_cong_repo import ThueGiaCongRepository
from app.services.stock_request_service import StockRequestService
from app.services.thue_gia_cong import don as don_svc
from app.services.thue_gia_cong import hoan_tat as ht
from app.services.thue_gia_cong import phieu_giao as pg_svc
from app.services.thue_gia_cong import phieu_nhan as pn_svc
from app.services.thue_gia_cong import so_ngoai
from app.services.thue_gia_cong.trang_thai_lenh import cua_lenh
from tests.gia_cong_fixtures import cv_ten, dung_lenh_gia_cong, giao_sang, ncc
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401
from tests.test_tgc_phieu_giao import _vat_tu_buoc_thue

_BUOC = [
    ("In", "may", None, 1660, "to"),
    ("Cán màng", "thue_ngoai", None, 1660, "to"),
    ("Bế", "may", None, 1650, "cai"),
]


@pytest.fixture
def ca(sess, orders, lsx_svc, admin, customer):
    """In → Cán màng (ngoài, màng 5 kg xưởng cấp) → Bế. Đã giao 1.660 tờ + 5 kg màng."""
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    vt = _vat_tu_buoc_thue(sess, a, tu_lo=False, so_luong=5)
    v = sess.query(TgcViec).filter_by(lsx_id=a).one()
    d = don_svc.tao(sess, user=admin, nha_cung_cap_id=ncc(sess, "Cán màng Minh Phát").id, ngay_dat=date.today(),
                    dong=[{"viec_id": v.id, "sl_dat": 1660, "don_gia": 600}], dat=True)
    giao_sang(sess, admin, cv_ten(sess, a, "In"), cv_ten(sess, a, "Cán màng"), 1660)
    sess.refresh(d)
    (dd,) = ThueGiaCongRepository(sess).dong_cua_don(d.id)
    pg, _kq = pg_svc.lap(sess, user=admin, don_id=d.id, expected_version=d.version, dong=[{
        "don_dong_id": dd.id, "giao_ban_thanh_pham": True,
        "vat_tu": [{"lsx_cong_doan_vat_tu_id": vt.id, "so_luong": 5}]}])
    nhan = User(username="nhan_ht", name="Nhận", password_hash="x", role_id=admin.role_id, is_active=True)
    sess.add(nhan)
    sess.commit()
    return a, d, dd, pg, nhan


def _kho_xuat(sess, pg, monkeypatch, so=5.0):
    """Kho xuất đề nghị của phiếu giao (giả lập: số đã ứng + đã lập phiếu)."""
    req = sess.query(StockRequest).filter_by(tgc_phieu_giao_id=pg.id).one()
    for ln in sess.query(StockRequestLine).filter_by(request_id=req.id):
        ln.sl_da_ung = so
    sess.commit()
    monkeypatch.setattr(StockRequestService, "kho_da_lap_phieu", lambda self, r: True)


def _nhan(sess, user, d, dd, dat, hong=0):
    sess.refresh(d)
    return pn_svc.lap(sess, user=user, co_quyen_module=True, don_id=d.id, expected_version=d.version,
                      dong=[{"don_dong_id": dd.id, "sl_dat": dat, "sl_hong": hong, "noi_ve": NOI_VE_XUONG}])[0]


def _ht(sess, admin, d, dd, tra_ve=None):
    sess.refresh(d)
    return ht.hoan_tat(sess, user=admin, don_dong_id=dd.id, expected_version=d.version, tra_ve=tra_ve)


def test_hoan_tat_bi_chan_khi_kho_chua_xuat(sess, admin, ca):
    _a, d, dd, _pg, nhan = ca
    _nhan(sess, nhan, d, dd, 1650)
    with pytest.raises(ValueError, match="Kho chưa xuất"):
        _ht(sess, admin, d, dd)


def test_hoan_tat_ra_hao_hut(sess, admin, ca, monkeypatch):
    a, d, dd, pg, nhan = ca
    _kho_xuat(sess, pg, monkeypatch)
    _nhan(sess, nhan, d, dd, 800)
    _nhan(sess, nhan, d, dd, 850)
    kq = _ht(sess, admin, d, dd)
    assert kq["hao_hut"] == 10 and kq["de_nghi_tra"] is None
    sess.refresh(dd)
    assert float(dd.hao_hut) == 10 and dd.hoan_tat_luc is not None
    assert cv_ten(sess, a, "Cán màng").trang_thai == CV_HOAN_THANH
    assert don_svc.don_dict(sess, d)["trang_thai"] == "hoan_tat"
    with pytest.raises(ValueError, match="hoàn tất"):
        _nhan(sess, nhan, d, dd, 1)


def test_hoan_tat_cong_viec_xong_lenh_doc_xong(sess, admin, ca, monkeypatch):
    a, d, dd, pg, nhan = ca
    _kho_xuat(sess, pg, monkeypatch)
    _nhan(sess, nhan, d, dd, 1650)
    _ht(sess, admin, d, dd)
    (tt,) = cua_lenh(sess, a)
    assert tt["trang_thai"] == "xong" and tt["nhan"].startswith("Xong 1.650") and tt["nhan"].endswith("(hụt 10)")


def test_hoan_tat_tra_vat_tu_tao_de_nghi_nhap(sess, admin, ca, monkeypatch):
    _a, d, dd, pg, nhan = ca
    _kho_xuat(sess, pg, monkeypatch)
    _nhan(sess, nhan, d, dd, 1650)
    (m,) = so_ngoai.cua_dong(sess, [dd.id])[dd.id]["vat_tu"]
    assert (m["xuat"], m["con_ngoai"]) == (5, 5)
    with pytest.raises(ValueError, match="không vượt"):
        _ht(sess, admin, d, dd, [{**{k: m[k] for k in ("hang_loai", "hang_id", "kho_rong", "kho_dai")}, "so_luong": 6}])
    sess.rollback()
    kq = _ht(sess, admin, d, dd, [{**{k: m[k] for k in ("hang_loai", "hang_id", "kho_rong", "kho_dai")}, "so_luong": 1.5}])
    req = sess.query(StockRequest).filter_by(tgc_don_dong_id=dd.id).one()
    assert req.loai == REQ_NHAP and req.ma == kq["de_nghi_tra"]
    (ln,) = sess.query(StockRequestLine).filter_by(request_id=req.id).all()
    assert float(ln.sl_de_nghi) == 1.5 and ln.hang_id == m["hang_id"]
    (m,) = so_ngoai.cua_dong(sess, [dd.id])[dd.id]["vat_tu"]
    assert (m["tra"], m["con_ngoai"]) == (1.5, 0)


def test_hoan_tat_dung_het_khong_de_nghi(sess, admin, ca, monkeypatch):
    _a, d, dd, pg, nhan = ca
    _kho_xuat(sess, pg, monkeypatch)
    _nhan(sess, nhan, d, dd, 1650)
    _ht(sess, admin, d, dd, [])
    assert sess.query(StockRequest).filter_by(tgc_don_dong_id=dd.id).count() == 0


def test_so_ngoai_tru_dan(sess, admin, ca, monkeypatch):
    _a, d, dd, pg, nhan = ca

    def hang():
        return {(r["loai"], r["con_ngoai"]) for r in so_ngoai.danh_sach(sess)["items"] if r["don_id"] == d.id}

    assert hang() == {("ban_thanh_pham", 1660)}            # vật tư chưa rời kho
    _kho_xuat(sess, pg, monkeypatch)
    assert hang() == {("ban_thanh_pham", 1660), ("vat_tu", 5)}
    _nhan(sess, nhan, d, dd, 800)
    assert hang() == {("ban_thanh_pham", 860), ("vat_tu", 5)}
    ds = so_ngoai.danh_sach(sess, q=d.ma)
    assert ds["total"] == 2 and ds["items"][0]["nha_cung_cap_ten"] == "Cán màng Minh Phát"
    _nhan(sess, nhan, d, dd, 850)
    _ht(sess, admin, d, dd)
    assert hang() == set()


def test_mo_lai_hoan_tat(sess, admin, ca, monkeypatch):
    a, d, dd, pg, nhan = ca
    _kho_xuat(sess, pg, monkeypatch)
    _nhan(sess, nhan, d, dd, 1600)
    (m,) = so_ngoai.cua_dong(sess, [dd.id])[dd.id]["vat_tu"]
    _ht(sess, admin, d, dd, [{**{k: m[k] for k in ("hang_loai", "hang_id", "kho_rong", "kho_dai")}, "so_luong": 1}])
    # Đề nghị nhập trả kho đã lập phiếu ⇒ chặn mở lại.
    assert ht.ly_do_khong_mo_lai(sess, dd) and "phiếu nhập trả" in ht.ly_do_khong_mo_lai(sess, dd)
    monkeypatch.setattr(StockRequestService, "kho_da_lap_phieu", lambda self, r: False)
    sess.refresh(d)
    ht.mo_lai(sess, user=admin, don_dong_id=dd.id, expected_version=d.version)
    sess.refresh(dd)
    assert dd.hoan_tat_luc is None and dd.hao_hut is None
    assert cv_ten(sess, a, "Cán màng").trang_thai == CV_PHAT_HANH
    assert sess.query(StockRequest).filter_by(tgc_don_dong_id=dd.id).one().trang_thai == REQ_CANCELLED
    _nhan(sess, nhan, d, dd, 50)          # nhận tiếp được


def test_api_hoan_tat_va_hang_o_ngoai(client, sess, admin, ca, monkeypatch):
    _a, d, dd, pg, nhan = ca
    _kho_xuat(sess, pg, monkeypatch)
    _nhan(sess, nhan, d, dd, 1650)
    h = {"Authorization": "Bearer " + client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin123"}).json()["access_token"]}
    don = client.get(f"/api/thue-gia-cong/don/{d.id}", headers=h).json()
    (dong,) = don["dong"]
    assert dong["ly_do_khong_hoan_tat"] is None and dong["vat_tu_ngoai"][0]["con_ngoai"] == 5
    r = client.get("/api/thue-gia-cong/hang-o-ngoai", headers=h, params={"q": d.ma})
    assert r.status_code == 200 and r.json()["total"] == 2
    r = client.post(f"/api/thue-gia-cong/don-dong/{dd.id}/hoan-tat", headers=h,
                    json={"version": don["version"], "tra_ve": []})
    assert r.status_code == 200, r.text
    assert r.json()["hao_hut"] == 10


def test_viec_cua_to_thay_hang_hen_ve(sess, admin, ca, monkeypatch):
    """Tab Nhận của bước Bế: bước trước Cán màng đang ở nhà gia công ⇒ có khối gia_cong để mở hộp
    Nhận hàng đúng dòng; hoàn tất xong thì rụng."""
    from app.repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
    from app.services.san_xuat import dau_vao

    a, d, dd, pg, nhan = ca

    def gc():
        be = cv_ten(sess, a, "Bế")
        return [c["gia_cong"] for c in dau_vao.cong_doan_truoc(sess, SanXuatSanLuongRepository(sess), be)
                if c["gia_cong"]]

    (g,) = gc()
    assert (g["don_id"], g["don_dong_id"], g["con_ngoai"]) == (d.id, dd.id, 1660)
    _kho_xuat(sess, pg, monkeypatch)
    _nhan(sess, nhan, d, dd, 1650)
    _ht(sess, admin, d, dd)
    assert gc() == []
