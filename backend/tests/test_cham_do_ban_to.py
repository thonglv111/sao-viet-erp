"""Chấm đỏ Xếp lịch + bàn tổ: lệnh quay lại hàng chờ → người Xem Xếp lịch; việc của tổ → đúng
người xem được tổ đó (kênh `to_sx_<id>`)."""
from app.db import SessionLocal
from app.models.department import Department
from app.models.lsx import TT_SAN_SANG, Lsx
from app.models.role import SCOPE_ALL
from app.models.user import User
from app.repositories.san_xuat_repo import SanXuatRepository
from app.routers.xep_lich import _cham_viec_moi
from app.services.thong_bao_man import bao, kenh_to

from tests.lenh_sx_fixtures import (  # noqa: F401
    _cvs, admin, customer, lenh_that, lsx_svc, orders, sess,
)
from tests.quyen_to_fixtures import cap_quyen_to

from .thong_bao_helpers import admin as h_admin
from .thong_bao_helpers import dang_nhap, tao_nguoi, tom_tat


def test_thu_hoi_lenh_quay_lai_cho_day_cham_xep_lich(client):
    db = SessionLocal()
    try:
        l = Lsx(ma="LSX-CHAM-01", ten="Lệnh chấm", order_id=1, order_line_id=1,
                trang_thai=TT_SAN_SANG, so_luong_dat=1000, so_to_ke_hoach=120)
        db.add(l)
        db.commit()
        lid = l.id
    finally:
        db.close()
    tao_nguoi("xem_xl", {"xep_lich": dict(can_read=True, scope=SCOPE_ALL)})
    tao_nguoi("khong_xl", {"san_xuat": dict(can_read=True, scope=SCOPE_ALL)})
    ha = h_admin(client)
    # Bàn kéo thả cũ (bỏ mốc) gỡ 08/11/2026; đường còn đưa lệnh quay lại chờ đẩy là thu hồi.
    assert client.post(f"/api/xep-lich/phat-hanh/{lid}", headers=ha).status_code == 200
    assert client.delete(f"/api/xep-lich/phat-hanh/{lid}?ly_do=Khách đổi quy cách",
                         headers=ha).status_code == 200
    tt = tom_tat(client, dang_nhap(client, "xem_xl"))
    assert tt["xep_lich"]["loai"] == "lenh_cho_xep" and tt["xep_lich"]["ma"] == "LSX-CHAM-01"
    assert "xep_lich" not in tom_tat(client, dang_nhap(client, "khong_xl"))


def test_viec_moi_chi_toi_nguoi_xem_duoc_to(client, sess, admin, lenh_that):  # noqa: F811
    to_ids = SanXuatRepository(sess).to_cua_lenh([lenh_that])
    assert to_ids == {cv.department_id for cv in _cvs(sess, lenh_that)}
    to = sess.get(Department, next(iter(to_ids)))
    khac = Department(name="Tổ khác chấm", code="TO-KHAC-CHAM", la_san_xuat=True)
    sess.add(khac)
    sess.commit()
    uid_to = tao_nguoi("nguoi_to", {})
    uid_khac = tao_nguoi("nguoi_to_khac", {})
    cap_quyen_to(sess, sess.get(User, uid_to), to)
    cap_quyen_to(sess, sess.get(User, uid_khac), khac)
    sess.commit()

    _cham_viec_moi(sess, lenh_that, admin.id)
    tt = tom_tat(client, dang_nhap(client, "nguoi_to"))
    assert tt[kenh_to(to.id)]["loai"] == "viec_moi"
    assert kenh_to(to.id) not in tom_tat(client, dang_nhap(client, "nguoi_to_khac"))

    bao(sess, kenh=kenh_to(khac.id), loai="ban_giao_den", actor_id=admin.id)
    assert tom_tat(client, dang_nhap(client, "nguoi_to_khac"))[kenh_to(khac.id)]["loai"] == "ban_giao_den"
    assert kenh_to(khac.id) not in tom_tat(client, dang_nhap(client, "nguoi_to"))
