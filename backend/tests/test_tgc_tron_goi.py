"""Thuê gia công TRỌN GÓI (plan Task 2.1): bấm trọn gói sinh gói + MỘT việc vào Hàng chờ."""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from app.models.lsx import TT_DA_PHAT_HANH, TT_NHAP, Lsx
from app.models.san_xuat import (
    BUOC_THUE_NGOAI, GOI_DA_THU_HOI, SanXuatCongViec, SanXuatGoiPhatHanh,
)
from app.models.thue_gia_cong import KIEU_TRON_GOI, TgcDon, TgcDonDong, TgcViec
from app.models.xep_lich import XepLichCongDoan
from app.models.xep_lich_lenh import XepLichLenh
from app.services.thue_gia_cong.tron_goi import dat, huy, ly_do_khong_tron_goi
from tests.gia_cong_fixtures import lenh_chua_phat, ncc
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401


@pytest.fixture
def lenh(sess, orders, lsx_svc, admin, customer) -> Lsx:
    return lenh_chua_phat(sess, orders, lsx_svc, admin, customer)


def _dat_tron_goi(sess, admin, lenh, *, xuong_cap_giay=False) -> TgcViec:
    return dat(sess, user=admin, lsx_id=lenh.id, sl_can=20_000, xuong_cap_giay=xuong_cap_giay)


def test_dat_tron_goi_sinh_goi_va_viec(sess, admin, lenh):
    v = _dat_tron_goi(sess, admin, lenh)
    sess.refresh(lenh)
    assert lenh.trang_thai == TT_DA_PHAT_HANH
    assert v.kieu == KIEU_TRON_GOI and v.lsx_id == lenh.id and float(v.sl_can) == 20_000
    (cv,) = sess.query(SanXuatCongViec).filter_by(lsx_id=lenh.id).all()
    assert cv.tgc_viec_id == v.id and cv.department_id is None
    assert cv.loai_buoc == BUOC_THUE_NGOAI and cv.la_kcs_cuoi
    assert sess.query(TgcViec).filter_by(lsx_id=lenh.id).count() == 1


def test_dat_tron_goi_mac_dinh_nha_gia_cong_tu_lo_giay(sess, admin, lenh):
    """Màn lệnh gửi `{}`: giấy mặc định nhà gia công tự lo, kể cả khi quy cách ghi công ty lo giấy
    (chủ dự án 16/11/2026). Đổi sang xưởng cấp ở hộp lập đơn."""
    lenh.quy_cach_json = {**(lenh.quy_cach_json or {}), "nguon_giay": "cong_ty"}
    sess.commit()
    v = dat(sess, user=admin, lsx_id=lenh.id)
    assert v.xuong_cap_giay is False


def test_huy_tron_goi_chua_dat_ve_nhap(sess, admin, lenh):
    v = _dat_tron_goi(sess, admin, lenh)
    goi_id = sess.query(SanXuatCongViec).filter_by(lsx_id=lenh.id).one().goi_id
    huy(sess, user=admin, viec_id=v.id, expected_version=v.version, ly_do="Khách đổi mẫu")
    sess.expire_all()
    assert sess.get(Lsx, lenh.id).trang_thai == TT_NHAP
    assert sess.get(SanXuatGoiPhatHanh, goi_id).trang_thai == GOI_DA_THU_HOI
    assert sess.query(TgcViec).filter_by(lsx_id=lenh.id).count() == 0


def test_huy_tron_goi_da_dat_bi_chan(sess, admin, lenh):
    v = _dat_tron_goi(sess, admin, lenh)
    s = ncc(sess, "In hộp Phú Thịnh")
    don = TgcDon(ma="GC26-9101", nha_cung_cap_id=s.id, nha_cung_cap_ten=s.ten,
                 ngay_dat=date.today(), dat_luc=datetime.now(timezone.utc))
    sess.add(don)
    sess.flush()
    sess.add(TgcDonDong(don_id=don.id, viec_id=v.id, sl_dat=20_000, don_gia=0))
    sess.commit()
    with pytest.raises(ValueError, match="GC26-9101"):
        huy(sess, user=admin, viec_id=v.id, expected_version=v.version, ly_do="Khách đổi mẫu")
    sess.rollback()
    assert sess.get(Lsx, lenh.id).trang_thai == TT_DA_PHAT_HANH


def test_tron_goi_khong_vao_xep_lich(sess, admin, lenh):
    buoc = sorted(lenh.cong_doans, key=lambda c: c.thu_tu)[0]
    sess.add(XepLichCongDoan(nguon="lsx", lsx_id=lenh.id, lsx_cong_doan_id=buoc.id,
                             source_thu_tu=buoc.thu_tu, loai_buoc="may"))
    sess.commit()
    _dat_tron_goi(sess, admin, lenh)
    assert sess.query(XepLichCongDoan).filter_by(lsx_id=lenh.id).count() == 0
    assert sess.query(XepLichLenh).filter_by(lsx_id=lenh.id).count() == 0


def test_lenh_bai_ghep_khong_tron_goi(sess, orders, lsx_svc, admin, customer):
    from tests.gia_cong_fixtures import dung_bai_ghep_gia_cong
    bg, a, _b = dung_bai_ghep_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=[
        ("In", "may", None, 1000, "to", "to"),
        ("Bế", "may", None, 4000, "to", "cai"),
    ], chung=[0], phat_hanh=False)
    ly_do = ly_do_khong_tron_goi(sess, a)
    assert ly_do and f"bài ghép {bg.ma}" in ly_do
    with pytest.raises(ValueError, match=bg.ma):
        dat(sess, user=admin, lsx_id=a, sl_can=1000, xuong_cap_giay=False)


@pytest.mark.parametrize("cap, mong", [(False, False), (True, True)])
def test_co_gi_de_giao_theo_ai_lo_giay(sess, admin, lenh, cap, mong):
    """Trọn gói nhà gia công tự lo giấy, lệnh không vật tư xưởng cấp ⇒ không có gì phải giao: ngăn đơn
    làm mờ nút Giao hàng (16/11/2026). Xưởng cấp giấy ⇒ còn giấy phải giao."""
    from app.services.thue_gia_cong.phieu_giao import co_gi_de_giao

    v = _dat_tron_goi(sess, admin, lenh, xuong_cap_giay=cap)
    s = ncc(sess, "Bế Minh Phát")
    don = TgcDon(ma="GC26-9102", nha_cung_cap_id=s.id, nha_cung_cap_ten=s.ten,
                 ngay_dat=date.today(), dat_luc=datetime.now(timezone.utc))
    sess.add(don)
    sess.flush()
    sess.add(TgcDonDong(don_id=don.id, viec_id=v.id, sl_dat=20_000, don_gia=0))
    sess.commit()
    assert co_gi_de_giao(sess, don.id) is mong
