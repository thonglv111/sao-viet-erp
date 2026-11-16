"""Ô ĐUÔI của dải ở ngăn chi tiết (11/10/2026) — làm xong bước cuối thì hàng đi đâu.

Bước cuối thuê ngoài: chờ Phiếu giao (số bước trước đã bàn giao sang). Các mốc ở ngoài / về kho /
giao thẳng đi theo phiếu giao, phiếu nhận của module Thuê gia công (test ở đợt 4–5).
Bước cuối tự làm, không chặng sau: nhập kho thành phẩm.
"""
from __future__ import annotations

from app.models.san_xuat import SanXuatCongViec
from app.repositories.san_xuat_repo import SanXuatRepository
from app.services.san_xuat.routing_dai import dung_routing, o_duoi
from tests.gia_cong_fixtures import cv_ten, dung_lenh_gia_cong, giao_sang, ncc
from tests.lenh_sx_fixtures import _cvs, admin, customer, lenh_that, lsx_svc, orders, sess  # noqa: F401


def _duoi(sess, lsx_id: int) -> dict | None:
    cvs = sess.query(SanXuatCongViec).filter_by(lsx_id=lsx_id).all()
    repo = SanXuatRepository(sess)
    dai = dung_routing(sess, repo, khoa=[("lsx", lsx_id)], cv_cua_toi=cvs).get(("lsx", lsx_id), [])
    return o_duoi(sess, dai, cvs)


def _lenh_cuoi_ngoai(sess, orders, lsx_svc, admin, customer) -> int:
    a = ncc(sess, "Cắt Thành Công")
    return dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=[
        ("In", "may", None, 1000, "to"),
        ("Cắt thành phẩm", "thue_ngoai", a, 1000, "cái"),
    ])


def test_cuoi_thue_ngoai_cho_phieu_giao(sess, orders, lsx_svc, admin, customer):
    lsx_id = _lenh_cuoi_ngoai(sess, orders, lsx_svc, admin, customer)
    giao_sang(sess, admin, cv_ten(sess, lsx_id, "In"), cv_ten(sess, lsx_id, "Cắt thành phẩm"), 330)

    d = _duoi(sess, lsx_id)
    assert d["loai"] == "cho_mang_di" and d["noi"] is None
    assert d["so"] == 330 and d["don_vi"] == "to"


def test_cuoi_tu_lam_khong_chang_sau_la_nhap_kho(sess, lenh_that):
    d = _duoi(sess, lenh_that)
    assert d["loai"] == "ve_kho" and d["so"] is None


def test_kcs_cuoi_khong_xet_buoc_thue_ngoai(sess, orders, lsx_svc, admin, customer):
    """Chủ chốt 11/10/2026: KCS cuối không xét tiêu chí và không quy lỗi về bước thuê ngoài."""
    from app.services.san_xuat.kcs_checklist import chuoi_gop

    a = ncc(sess, "Cắt Ngoài KCS")
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=[
        ("In", "may", None, 1000, "to"),
        ("Cắt", "thue_ngoai", a, 1000, "cái"),
        ("Đóng gói", "may", None, 1000, "cái"),
    ])
    cuoi = cv_ten(sess, lsx_id, "Đóng gói")
    assert cuoi.la_kcs_cuoi
    assert [c.ten_cong_doan for c in chuoi_gop(sess, cuoi, lsx_id)] == ["In", "Đóng gói"]
