"""Mang đi / chốt / mở lại lần gia công của bước CHUNG bài ghép (spec 2026-09-27 §2–3).

Chốt MỘT con số tờ ghép; phần mềm tự chia: toả sang bước riêng từng lệnh (số × số con/tờ), hoặc
một bàn giao sang bước chung kế, hoặc nhập kho từng lệnh khi bước chung là bước cuối.
"""
from __future__ import annotations

import pytest

from app.models.gia_cong_ngoai import NOI_VE_KHO, NOI_VE_XUONG, GiaCongNgoai
from app.models.lsx import Lsx
from app.models.san_xuat import CV_HOAN_THANH, CV_PHAT_HANH
from app.models.san_xuat_kcs import SanXuatKcsBatch
from app.models.san_xuat_san_luong import (
    BG_DE_XUAT, BG_XAC_NHAN, SanXuatBanGiao, SanXuatBatch, SanXuatKetQuaNhanh,
)
from app.models.stock_request import REQ_CANCELLED, StockRequest, StockRequestLine
from app.services.gia_cong_ngoai.chot import chot, mo_lai
from app.services.san_xuat import dau_vao
from app.services.gia_cong_ngoai.lan import lan_dict
from app.services.gia_cong_ngoai.mot_phan import mang_di
from tests.gia_cong_fixtures import (
    cv_chung, cv_ten, dung_bai_ghep_gia_cong, ghi_me, giao_sang, ncc,
)
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401


def _mang_di(sess, admin, bg, sl=1000, dau="Cán màng"):
    giao_sang(sess, admin, cv_chung(sess, bg.id, "In"), cv_chung(sess, bg.id, dau), sl)
    lan = sess.query(GiaCongNgoai).filter_by(bai_ghep_id=bg.id).one()
    d = lan_dict(sess, lan)
    assert d["sl_cho_mang_di"] == sl and d["co_buoc_truoc"] is True
    mang_di(sess, user=admin, gcn_id=lan.id, expected_version=lan.version)
    sess.refresh(lan)
    return lan


@pytest.fixture
def bai_toa(sess, orders, lsx_svc, admin, customer):
    """BG: In chung → Cán màng chung (thuê ngoài Tân Phát) → Bế RIÊNG từng lệnh. A 4 con, B 2 con."""
    tp = ncc(sess, "Cán màng Tân Phát")
    bg, a, b = dung_bai_ghep_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=[
        ("In", "may", None, 1000, "to", "to"),
        ("Cán màng", "thue_ngoai", tp, 1000, "to", "to"),
        ("Bế", "may", None, 4000, "to", "cai"),
    ], chung=[0, 1], con=(4, 2))
    return bg, a, b, _mang_di(sess, admin, bg)


def test_chot_toa_moi_lenh_so_chot_nhan_so_con(sess, admin, bai_toa):
    bg, a, b, lan = bai_toa
    d = lan_dict(sess, lan)
    assert d["bai_ghep_id"] == bg.id and d["lsx_id"] is None
    assert d["noi_ve_hop_le"] == [NOI_VE_XUONG]
    # Bế ăn TỜ ghép ⇒ mỗi lệnh nhận nguyên số tờ chốt (hệ số nhận 1); Bế tự ra con theo số con/tờ.
    assert {(c["lsx_id"], c["so_con"], c["he_so_nhan"]) for c in d["chia_theo_lenh"]} == {
        (a, 4, 1), (b, 2, 1)}
    ma = {l.id: l.ma for l in sess.query(Lsx).filter(Lsx.id.in_([a, b]))}
    assert d["nhan_nguon"] == f"{bg.ma} ({ma[a]}, {ma[b]})"

    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version, sl_cuoi=980,
         noi_ve=NOI_VE_XUONG)
    can = cv_chung(sess, bg.id, "Cán màng")
    assert can.trang_thai == CV_HOAN_THANH
    (me,) = sess.query(SanXuatBatch).filter_by(cong_viec_id=can.id).all()
    assert float(me.tot) == 980
    # E2E 27/09/2026: trước đây Bế nhận 3.920 "tờ" (đã nhân con/tờ) rồi trần ghi mẻ nhân lần nữa.
    for lsx_id, toi_da in ((a, 3920), (b, 1960)):
        be = cv_ten(sess, lsx_id, "Bế")
        bg_ = sess.query(SanXuatBanGiao).filter_by(dich_cong_viec_id=be.id).one()
        assert bg_.trang_thai == BG_XAC_NHAN and float(bg_.so_luong) == 980 and bg_.don_vi == "to"
        assert dau_vao.tran_ghi(sess, be)["toi_da"] == toi_da
    assert sess.query(SanXuatKetQuaNhanh).filter_by(batch_id=me.id).count() == 2


def test_mo_lai_go_sach_phan_toa(sess, admin, bai_toa):
    bg, a, b, lan = bai_toa
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version, sl_cuoi=980,
         noi_ve=NOI_VE_XUONG)
    sess.refresh(lan)
    assert lan_dict(sess, lan)["ly_do_khong_mo_lai"] is None
    mo_lai(sess, user=admin, gcn_id=lan.id, expected_version=lan.version)
    can = cv_chung(sess, bg.id, "Cán màng")
    assert can.trang_thai == CV_PHAT_HANH
    assert sess.query(SanXuatBatch).filter_by(cong_viec_id=can.id).count() == 0
    assert sess.query(SanXuatKetQuaNhanh).count() == 0
    for lsx_id in (a, b):
        assert not sess.query(SanXuatBanGiao).filter_by(
            dich_cong_viec_id=cv_ten(sess, lsx_id, "Bế").id).count()
    sess.refresh(lan)
    # Mở lại xong chốt lại được.
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version, sl_cuoi=990,
         noi_ve=NOI_VE_XUONG)


def test_mo_lai_bi_chan_khi_mot_lenh_da_ghi_me(sess, admin, bai_toa):
    bg, a, b, lan = bai_toa
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version, sl_cuoi=980,
         noi_ve=NOI_VE_XUONG)
    ghi_me(sess, cv_ten(sess, b, "Bế"), 500)
    sess.commit()
    sess.refresh(lan)
    ma_b = sess.get(Lsx, b).ma
    ly_do = lan_dict(sess, lan)["ly_do_khong_mo_lai"]
    assert ly_do and ma_b in ly_do
    with pytest.raises(ValueError, match=ma_b):
        mo_lai(sess, user=admin, gcn_id=lan.id, expected_version=lan.version)


def test_chot_ve_buoc_chung_ke_tiep(sess, orders, lsx_svc, admin, customer):
    tp = ncc(sess, "Cán màng Tân Phát")
    bg, _a, _b = dung_bai_ghep_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=[
        ("In", "may", None, 1000, "to", "to"),
        ("Cán màng", "thue_ngoai", tp, 1000, "to", "to"),
        ("Bế", "may", None, 1000, "to", "to"),
        ("Đóng gói", "to", None, 1000, "to", "cai"),
    ], chung=[0, 1, 2])
    lan = _mang_di(sess, admin, bg)
    assert lan_dict(sess, lan)["chia_theo_lenh"] == []
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version, sl_cuoi=990,
         noi_ve=NOI_VE_XUONG)
    be = cv_chung(sess, bg.id, "Bế")
    (bg_,) = sess.query(SanXuatBanGiao).filter_by(dich_cong_viec_id=be.id).all()
    assert bg_.trang_thai == BG_DE_XUAT and float(bg_.so_luong) == 990


def test_buoc_chung_cuoi_nhap_kho_tung_lenh(sess, orders, lsx_svc, admin, customer):
    tp = ncc(sess, "Cán màng Tân Phát")
    bg, a, b = dung_bai_ghep_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=[
        ("In", "may", None, 1000, "to", "to"),
        ("Cán màng", "thue_ngoai", tp, 1000, "to", "cái"),
    ], chung=[0, 1], con=(4, 2))
    lan = _mang_di(sess, admin, bg)
    d = lan_dict(sess, lan)
    assert d["noi_ve_hop_le"] == [NOI_VE_KHO]
    assert {(c["lsx_id"], c["so_con"]) for c in d["chia_theo_lenh"]} == {(a, 4), (b, 2)}
    kq = chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version, sl_cuoi=980,
              noi_ve=NOI_VE_KHO)
    reqs = sess.query(StockRequest).filter_by(gia_cong_ngoai_id=lan.id).all()
    assert len(reqs) == 2
    theo_lenh = {}
    for r in reqs:
        for ln in sess.query(StockRequestLine).filter_by(request_id=r.id):
            theo_lenh[ln.lsx_id] = theo_lenh.get(ln.lsx_id, 0) + float(ln.sl_de_nghi)
    assert theo_lenh == {a: 3920, b: 1960}
    can = cv_chung(sess, bg.id, "Cán màng")
    assert sorted(float(k.so_luong_dat) for k in
                  sess.query(SanXuatKcsBatch).filter_by(cong_viec_id=can.id)) == [1960, 3920]
    assert len(kq["yeu_cau_khos"]) == 2

    sess.refresh(lan)
    mo_lai(sess, user=admin, gcn_id=lan.id, expected_version=lan.version)
    assert all(r.trang_thai == REQ_CANCELLED for r in
               sess.query(StockRequest).filter_by(gia_cong_ngoai_id=lan.id))
    assert sess.query(SanXuatKcsBatch).filter_by(cong_viec_id=can.id).count() == 0


def test_tat_giao_hang_thi_lan_cuoi_chi_ve_kho(sess, monkeypatch):
    """Bản cài tắt giao hàng: Giao thẳng cho khách ghi chuyến giao vào phân hệ không có ⇒ chỉ còn kho."""
    from types import SimpleNamespace

    from app.config import get_settings
    from app.services.gia_cong_ngoai.lan import NOI_VE_KHO, noi_ve_hop_le

    monkeypatch.setattr(get_settings(), "phan_he_tat", "giao_hang")
    gcn = SimpleNamespace(bai_ghep_id=None, lsx_id=-1)
    assert noi_ve_hop_le(sess, gcn, []) == [NOI_VE_KHO]
