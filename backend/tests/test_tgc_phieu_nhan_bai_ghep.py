"""Phiếu nhận gia công của bước CHUNG bài ghép (plan đợt 5, spec 2026-11-13 §5.3): số nhận là tờ ghép,
hệ chia theo số con/tờ — toả sang bước riêng từng lệnh, hoặc nhập kho từng lệnh; không có nơi về khách."""
from __future__ import annotations

from datetime import date

import pytest

from app.models.san_xuat_san_luong import BG_XAC_NHAN, SanXuatBanGiao, SanXuatBatch, SanXuatKetQuaNhanh
from app.models.stock_request import REQ_CANCELLED, StockRequest, StockRequestLine
from app.models.thue_gia_cong import NOI_VE_KHACH, NOI_VE_KHO, NOI_VE_XUONG, TgcViec
from app.models.user import User
from app.services.thue_gia_cong import don as don_svc
from app.services.thue_gia_cong import phieu_giao as pg_svc
from app.services.thue_gia_cong import phieu_nhan as pn_svc
from tests.gia_cong_fixtures import cv_chung, cv_ten, dung_bai_ghep_gia_cong, ghi_me, giao_sang, ncc
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401


def _don_giao(sess, admin, bg, sl=1000):
    v = sess.query(TgcViec).filter_by(bai_ghep_id=bg.id).one()
    d = don_svc.tao(sess, user=admin, nha_cung_cap_id=ncc(sess, "Cán màng Tân Phát").id, ngay_dat=date.today(),
                    dong=[{"viec_id": v.id, "sl_dat": sl, "don_gia": 500}], dat=True)
    giao_sang(sess, admin, cv_chung(sess, bg.id, "In"), cv_chung(sess, bg.id, "Cán màng"), sl)
    sess.refresh(d)
    (dd,) = don_svc.ThueGiaCongRepository(sess).dong_cua_don(d.id)
    pg_svc.lap(sess, user=admin, don_id=d.id, expected_version=d.version,
               dong=[{"don_dong_id": dd.id, "giao_ban_thanh_pham": True}])
    sess.refresh(d)
    return d, dd


def _nguoi(sess, admin) -> User:
    u = User(username="nhan_bg", name="Nhận bài ghép", password_hash="x", role_id=admin.role_id, is_active=True)
    sess.add(u)
    sess.commit()
    return u


def _lap(sess, user, d, dd, *, dat, noi):
    sess.refresh(d)
    return pn_svc.lap(sess, user=user, co_quyen_module=True, don_id=d.id, expected_version=d.version,
                      dong=[{"don_dong_id": dd.id, "sl_dat": dat, "sl_hong": 0, "noi_ve": noi}])[0]


def test_nhan_to_ghep_chia_so_con(sess, orders, lsx_svc, admin, customer):
    """In chung → Cán màng chung (thuê ngoài) → Bế RIÊNG từng lệnh. A 4 con, B 2 con."""
    bg, a, b = dung_bai_ghep_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=[
        ("In", "may", None, 1000, "to", "to"),
        ("Cán màng", "thue_ngoai", None, 1000, "to", "to"),
        ("Bế", "may", None, 4000, "to", "cai"),
    ], chung=[0, 1], con=(4, 2))
    d, dd = _don_giao(sess, admin, bg)
    nhan = _nguoi(sess, admin)
    (dong,) = pn_svc.du_lieu_moi(sess, d.id, user=nhan, co_quyen_module=True)["dong"]
    assert dong["noi_ve_hop_le"] == [NOI_VE_XUONG] and dong["buoc_sau"] == []
    # Bế ăn TỜ ghép ⇒ mỗi lệnh nhận nguyên số tờ (hệ số 1); bảng chia hiện trước khi lưu.
    assert {(c["lsx_id"], c["so_con"], c["he_so_nhan"]) for c in dong["chia_theo_lenh"]} == {(a, 4, 1), (b, 2, 1)}
    pn = _lap(sess, nhan, d, dd, dat=980, noi=NOI_VE_XUONG)
    for lsx_id in (a, b):
        x = sess.query(SanXuatBanGiao).filter_by(dich_cong_viec_id=cv_ten(sess, lsx_id, "Bế").id).one()
        assert x.trang_thai == BG_XAC_NHAN and float(x.so_luong) == 980
    can = cv_chung(sess, bg.id, "Cán màng")
    (me,) = sess.query(SanXuatBatch).filter_by(cong_viec_id=can.id).all()
    assert sess.query(SanXuatKetQuaNhanh).filter_by(batch_id=me.id).count() == 2
    # Huỷ gỡ sạch phần toả.
    pn_svc.huy(sess, user=admin, phieu_id=pn.id, expected_version=pn.version, ly_do="Gõ nhầm số")
    assert sess.query(SanXuatKetQuaNhanh).count() == 0
    assert sess.query(SanXuatBatch).filter_by(cong_viec_id=can.id).count() == 0
    for lsx_id in (a, b):
        assert sess.query(SanXuatBanGiao).filter_by(dich_cong_viec_id=cv_ten(sess, lsx_id, "Bế").id).count() == 0


def test_huy_toa_bi_chan_khi_mot_lenh_da_ghi(sess, orders, lsx_svc, admin, customer):
    bg, _a, b = dung_bai_ghep_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=[
        ("In", "may", None, 1000, "to", "to"),
        ("Cán màng", "thue_ngoai", None, 1000, "to", "to"),
        ("Bế", "may", None, 4000, "to", "cai"),
    ], chung=[0, 1], con=(4, 2))
    d, dd = _don_giao(sess, admin, bg)
    pn = _lap(sess, _nguoi(sess, admin), d, dd, dat=980, noi=NOI_VE_XUONG)
    ghi_me(sess, cv_ten(sess, b, "Bế"), 500)
    sess.commit()
    with pytest.raises(ValueError, match="đã ghi sản lượng"):
        pn_svc.huy(sess, user=admin, phieu_id=pn.id, expected_version=pn.version, ly_do="Gõ nhầm số")


def test_ve_kho_tung_lenh(sess, orders, lsx_svc, admin, customer):
    bg, a, b = dung_bai_ghep_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=[
        ("In", "may", None, 1000, "to", "to"),
        ("Cán màng", "thue_ngoai", None, 1000, "to", "cái"),
    ], chung=[0, 1], con=(4, 2))
    d, dd = _don_giao(sess, admin, bg)
    nhan = _nguoi(sess, admin)
    (dong,) = pn_svc.du_lieu_moi(sess, d.id, user=nhan, co_quyen_module=True)["dong"]
    assert dong["noi_ve_hop_le"] == [NOI_VE_KHO]
    assert {(c["lsx_id"], c["so_con"]) for c in dong["chia_theo_lenh"]} == {(a, 4), (b, 2)}
    pn = _lap(sess, nhan, d, dd, dat=980, noi=NOI_VE_KHO)
    reqs = sess.query(StockRequest).filter_by(tgc_phieu_nhan_id=pn.id).all()
    theo_lenh: dict[int, float] = {}
    for r in reqs:
        for ln in sess.query(StockRequestLine).filter_by(request_id=r.id):
            theo_lenh[ln.lsx_id] = theo_lenh.get(ln.lsx_id, 0) + float(ln.sl_de_nghi)
    assert len(reqs) == 2 and theo_lenh == {a: 3920, b: 1960}
    pn_svc.huy(sess, user=admin, phieu_id=pn.id, expected_version=pn.version, ly_do="Nhập nhầm")
    assert all(r.trang_thai == REQ_CANCELLED for r in sess.query(StockRequest).filter_by(tgc_phieu_nhan_id=pn.id))


def test_bai_ghep_khong_co_noi_ve_khach(sess, orders, lsx_svc, admin, customer):
    bg, _a, _b = dung_bai_ghep_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=[
        ("In", "may", None, 1000, "to", "to"),
        ("Cán màng", "thue_ngoai", None, 1000, "to", "cái"),
    ], chung=[0, 1], con=(4, 2))
    d, dd = _don_giao(sess, admin, bg)
    with pytest.raises(ValueError, match="Nơi về không hợp lệ"):
        _lap(sess, _nguoi(sess, admin), d, dd, dat=980, noi=NOI_VE_KHACH)
