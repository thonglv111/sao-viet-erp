"""Chờ trả tiền + phiếu chi thuê gia công (plan đợt 6, spec 2026-11-13 §4.6): một phiếu chi trả gộp
nhiều phiếu nhận cùng nhà gia công, tiền chia về từng phiếu theo tạm tính, lệch thì bắt lý do, huỷ
phiếu chi thì phiếu nhận quay lại, không vào công nợ 331."""
from __future__ import annotations

from datetime import date

import pytest

from app.models.accounting import PaymentVoucher
from app.models.thue_gia_cong import NOI_VE_XUONG, TgcPhieuChiNhan
from app.repositories.accounting_repo import AccountingRepository
from app.services.thue_gia_cong import don as don_svc
from app.services.thue_gia_cong.cho_tra_tien import chia_tien
from tests.gia_cong_fixtures import dung_lenh_gia_cong, ncc
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401
from tests.test_tgc_phieu_nhan import _BUOC, _don_giao, _nguoi, _nhan, _viec

URL = "/api/accounting/payment-vouchers"


def _h(client):
    return {"Authorization": "Bearer " + client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin123"}).json()["access_token"]}


def _chi(client, h, ids, amount, **them):
    them.setdefault("content", "Trả tiền thuê gia công")
    return client.post(URL, headers=h, json={
        "source_type": "gia_cong_ngoai", "voucher_type": "cash", "payment_stage": "other",
        "voucher_date": date.today().isoformat(), "amount": amount, "currency": "VND", "exchange_rate": 1,
        "tgc_phieu_nhan_ids": ids, **them})


@pytest.fixture
def hai_phieu(sess, orders, lsx_svc, admin, customer):
    """Một đơn Minh Phát (600đ/tờ) đã giao 1.660 tờ, nhận hai đợt: 800 rồi 500 tờ."""
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    d = _don_giao(sess, admin, a, dau="Cán màng")
    nhan = _nguoi(sess, admin, "nhan_pc", cung_vai=True)
    pn1, _, _ = _nhan(sess, nhan, d, dat=800, hong=5)
    pn2, _, _ = _nhan(sess, nhan, d, dat=500)
    return a, d, pn1, pn2


def test_cho_tra_tien_liet_ke_phieu_nhan_chua_chi(client, sess, hai_phieu):
    _a, d, pn1, pn2 = hai_phieu
    h = _h(client)
    ds = client.get("/api/thue-gia-cong/cho-tra-tien", headers=h).json()
    assert [x["ma"] for x in ds] == [pn1.ma, pn2.ma]
    x = ds[0]
    assert x["tam_tinh"] == 480_000 and x["nha_cung_cap_ten"] == "Cán màng Minh Phát" and x["ma_don"] == d.ma
    assert x["dong"][0]["dat"] == 800 and x["dong"][0]["hong"] == 5 and x["dong"][0]["hut"] is None
    assert x["lenh"] and x["lenh"][0]["lsx_ma"]
    assert client.get("/api/thue-gia-cong/cho-tra-tien/dem", headers=h).json() == {"so": 2}


def test_lap_phieu_chi_gop_hai_phieu_nhan(client, sess, hai_phieu):
    _a, d, pn1, pn2 = hai_phieu
    h = _h(client)
    r = _chi(client, h, [pn1.id, pn2.id], 780_000, content=f"Trả tiền thuê gia công {pn1.ma}, {pn2.ma}")
    assert r.status_code == 201, r.text
    pc = r.json()
    assert pc["source_type"] == "gia_cong_ngoai" and pc["amount"] == 780_000
    assert pc["cash_recipient_name"] == "Cán màng Minh Phát"
    assert pn1.ma in pc["content"] and pn2.ma in pc["content"]
    dong = {r_.phieu_nhan_id: r_.amount_vnd for r_ in sess.query(TgcPhieuChiNhan).filter_by(payment_voucher_id=pc["id"])}
    assert dong == {pn1.id: 480_000, pn2.id: 300_000}
    assert client.get("/api/thue-gia-cong/cho-tra-tien", headers=h).json() == []


def test_lech_khong_ly_do_bi_chan(client, sess, hai_phieu):
    _a, _d, pn1, pn2 = hai_phieu
    h = _h(client)
    r = _chi(client, h, [pn1.id, pn2.id], 770_000)
    assert r.status_code == 422 and "lý do lệch" in r.json()["detail"]
    r = _chi(client, h, [pn1.id, pn2.id], 770_000, ly_do_lech="Trừ 5 tờ hỏng và làm tròn")
    assert r.status_code == 201, r.text
    assert "Lệch tạm tính: Trừ 5 tờ hỏng và làm tròn" in r.json()["content"]
    dong = {r_.phieu_nhan_id: r_.amount_vnd for r_ in sess.query(TgcPhieuChiNhan).filter_by(payment_voucher_id=r.json()["id"])}
    assert sum(dong.values()) == 770_000 and dong[pn1.id] == 770_000 * 480_000 // 780_000


def test_khac_ncc_bi_chan(client, sess, orders, lsx_svc, admin, customer, hai_phieu):
    _a, _d, pn1, _pn2 = hai_phieu
    b = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    d2 = don_svc.tao(sess, user=admin, nha_cung_cap_id=ncc(sess, "Cán màng Hưng Thịnh").id, ngay_dat=date.today(),
                     dong=[{"viec_id": _viec(sess, b).id, "sl_dat": 100, "don_gia": 500}], dat=True)
    from app.services.thue_gia_cong import phieu_giao as pg_svc
    from tests.gia_cong_fixtures import cv_ten, giao_sang

    giao_sang(sess, admin, cv_ten(sess, b, "In"), cv_ten(sess, b, "Cán màng"), 100)
    sess.refresh(d2)
    (dd,) = __import__("tests.test_tgc_phieu_nhan", fromlist=["_dongs"])._dongs(sess, d2)
    pg_svc.lap(sess, user=admin, don_id=d2.id, expected_version=d2.version,
               dong=[{"don_dong_id": dd.id, "giao_ban_thanh_pham": True}])
    khac = _nguoi(sess, admin, "nhan_pc2", cung_vai=True)
    pn3, _, _ = _nhan(sess, khac, d2, dat=100)
    r = _chi(client, _h(client), [pn1.id, pn3.id], 530_000)
    assert r.status_code == 422 and "cùng một nhà gia công" in r.json()["detail"]


def test_huy_phieu_chi_tra_ve_cho(client, sess, hai_phieu):
    _a, _d, pn1, _pn2 = hai_phieu
    h = _h(client)
    pc = _chi(client, h, [pn1.id], 480_000).json()
    assert [x["ma"] for x in client.get("/api/thue-gia-cong/cho-tra-tien", headers=h).json()] == [_pn2.ma]
    r = client.post(f"{URL}/{pc['id']}/cancel", headers=h, json={"reason": "Lập nhầm"})
    assert r.status_code == 200, r.text
    assert {x["ma"] for x in client.get("/api/thue-gia-cong/cho-tra-tien", headers=h).json()} == {pn1.ma, _pn2.ma}


def test_mot_phieu_nhan_mot_phieu_chi_song(client, sess, hai_phieu):
    _a, _d, pn1, pn2 = hai_phieu
    h = _h(client)
    assert _chi(client, h, [pn1.id], 480_000).status_code == 201
    r = _chi(client, h, [pn1.id, pn2.id], 780_000)
    assert r.status_code == 422 and f"Phiếu nhận {pn1.ma} đã có phiếu chi" in r.json()["detail"]
    assert _chi(client, h, [pn2.id, pn2.id], 600_000).status_code == 422
    assert _chi(client, h, [], 1).status_code == 422


def test_khong_vao_331(client, sess, hai_phieu):
    _a, _d, pn1, _pn2 = hai_phieu
    pc = _chi(client, _h(client), [pn1.id], 480_000).json()
    v = sess.get(PaymentVoucher, pc["id"])
    sess.refresh(v)
    assert v.supplier_id is None and v.customer_id is None
    assert pc["id"] not in {x.id for x in AccountingRepository(sess).phieu_chi_cho_bao_cao()}


def test_chia_tien_phan_le_don_cuoi():
    assert chia_tien(100, [1, 1, 1]) == [33, 33, 34]
    assert chia_tien(10, [0, 0]) == [5, 5]
    assert chia_tien(780_000, [480_000, 300_000]) == [480_000, 300_000]
