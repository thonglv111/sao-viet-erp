"""Phát hành sinh VIỆC thuê gia công vào Hàng chờ; xưởng chặn công việc thuê ngoài (plan Task 2.1)."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.lsx import LB_THUE_NGOAI, TT_DA_PHAT_HANH, LsxCongDoan, LsxCongDoanPhuThuoc
from app.models.san_xuat import SanXuatCongViec
from app.models.thue_gia_cong import KIEU_MOT_PHAN, TgcDon, TgcDonDong, TgcViec
from app.services.san_xuat import ban_giao, kcs, release, release_update, san_luong, thuc_thi
from app.services.thue_gia_cong import CHAN_XUONG
from app.services.thue_gia_cong.viec import dong_bo_khi_cap_nhat, tach_theo_buoc
from tests.gia_cong_fixtures import dung_lenh_gia_cong, ghi_me, lenh_chua_phat, ncc, nguoi_kcs
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401
from tests.test_san_xuat_board import _to_moi


def _viec(sess, lsx_id):
    return sess.query(TgcViec).filter_by(lsx_id=lsx_id).order_by(TgcViec.id).all()


def _cv(sess, lsx_id, ten):
    return sess.query(SanXuatCongViec).filter_by(lsx_id=lsx_id, ten_cong_doan=ten).one()


def _dat(sess, viec, ma="GC26-9001"):
    """Đưa việc vào một dòng đơn SỐNG (dịch vụ đơn là đợt 3 — chèn thẳng)."""
    s = ncc(sess, f"NCC {ma}")
    don = TgcDon(ma=ma, nha_cung_cap_id=s.id, nha_cung_cap_ten=s.ten, ngay_dat=date.today(),
                 dat_luc=datetime.now(timezone.utc))
    sess.add(don)
    sess.flush()
    sess.add(TgcDonDong(don_id=don.id, viec_id=viec.id, sl_dat=1000, don_gia=0, don_vi="to"))
    sess.commit()
    return don


_BON_BUOC = [
    ("In", "may", None, 1660, "to"),
    ("Cán màng", "thue_ngoai", None, 1660, "to"),
    ("Bế", "thue_ngoai", None, 1650, "cai"),
    ("Dán", "may", None, 1650, "cai"),
]


def test_phat_hanh_sinh_mot_viec_cho_dai_lien_nhau(sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BON_BUOC)
    (v,) = _viec(sess, lsx_id)
    assert v.kieu == KIEU_MOT_PHAN and v.ten_viec == "Cán màng + Bế"
    assert float(v.sl_can) == 1650 and v.don_vi == "cai"
    for ten in ("Cán màng", "Bế"):
        cv = _cv(sess, lsx_id, ten)
        assert cv.tgc_viec_id == v.id and cv.department_id is None and cv.may_id is None
    assert _cv(sess, lsx_id, "In").tgc_viec_id is None


def test_buoc_thuong_chen_giua_tach_viec(sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=[
        ("In", "may", None, 1000, "to"),
        ("Cán màng", "thue_ngoai", None, 1000, "to"),
        ("Bế", "may", None, 1000, "cai"),
        ("Dán", "thue_ngoai", None, 1000, "cai"),
    ])
    assert [v.ten_viec for v in _viec(sess, lsx_id)] == ["Cán màng", "Dán"]


def test_hai_nhanh_song_song_khong_gop(sess, orders, lsx_svc, admin, customer):
    to = _to_moi(sess, "Tổ TGC song song", "TO-TGC-SS")
    lsx = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    for cd in list(lsx.cong_doans):
        sess.delete(cd)
    sess.flush()
    goc = LsxCongDoan(lsx_id=lsx.id, thu_tu=0, ten="In", nhom="print", loai_buoc="may",
                      department_id=to.id, so_luong_vao=1000, so_luong_ra=1000,
                      don_vi_vao="to", don_vi_ra="to")
    sess.add(goc)
    sess.flush()
    n1 = LsxCongDoan(lsx_id=lsx.id, thu_tu=1, ten="Cán màng", nhom="finishing",
                     loai_buoc=LB_THUE_NGOAI, so_luong_vao=1000, so_luong_ra=1000,
                     don_vi_vao="to", don_vi_ra="to")
    n2 = LsxCongDoan(lsx_id=lsx.id, thu_tu=2, ten="Bế", nhom="finishing", loai_buoc=LB_THUE_NGOAI,
                     so_luong_vao=1000, so_luong_ra=1000, don_vi_vao="to", don_vi_ra="cai")
    sess.add_all([n1, n2])
    sess.flush()
    sess.add_all([LsxCongDoanPhuThuoc(buoc_truoc_id=goc.id, buoc_sau_id=n1.id),
                  LsxCongDoanPhuThuoc(buoc_truoc_id=goc.id, buoc_sau_id=n2.id)])
    sess.commit()
    release.phat_hanh(sess, lsx_ids={lsx.id}, actor=admin)
    lsx.trang_thai = TT_DA_PHAT_HANH
    sess.commit()
    assert [v.ten_viec for v in _viec(sess, lsx.id)] == ["Cán màng", "Bế"]


def test_cap_nhat_giu_viec_da_dat(sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BON_BUOC)
    (v,) = _viec(sess, lsx_id)
    _dat(sess, v)
    # Đổi bước KHÁC (đổi tên bước Dán) — dải của việc giữ nguyên.
    dan = sess.query(LsxCongDoan).filter_by(lsx_id=lsx_id, ten="Dán").one()
    dan.ten = "Dán hộp"
    sess.commit()
    dong_bo_khi_cap_nhat(sess, lsx_ids={lsx_id}, actor=admin)
    sess.commit()
    (con,) = _viec(sess, lsx_id)
    assert con.id == v.id and con.ten_viec == "Cán màng + Bế"


def test_cap_nhat_chan_khi_mat_buoc_da_dat(sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BON_BUOC)
    (v,) = _viec(sess, lsx_id)
    _dat(sess, v, "GC26-9002")
    be = sess.query(LsxCongDoan).filter_by(lsx_id=lsx_id, ten="Bế").one()
    be.loai_buoc = "may"
    sess.commit()
    with pytest.raises(ValueError, match="GC26-9002"):
        dong_bo_khi_cap_nhat(sess, lsx_ids={lsx_id}, actor=admin)
    sess.rollback()


def test_cap_nhat_bo_buoc_chua_dat_tra_cv_ve_to(sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BON_BUOC)
    (v,) = _viec(sess, lsx_id)
    to_moi = _to_moi(sess, "Tổ Bế nội bộ", "TO-TGC-BE")
    be = sess.query(LsxCongDoan).filter_by(lsx_id=lsx_id, ten="Bế").one()
    be.loai_buoc, be.department_id = "to", to_moi.id
    sess.commit()
    dong_bo_khi_cap_nhat(sess, lsx_ids={lsx_id}, actor=admin)
    sess.commit()
    (moi,) = _viec(sess, lsx_id)
    assert moi.id != v.id and moi.ten_viec == "Cán màng"
    cv_be = _cv(sess, lsx_id, "Bế")
    assert cv_be.tgc_viec_id is None and cv_be.department_id == to_moi.id
    assert _cv(sess, lsx_id, "Cán màng").tgc_viec_id == moi.id


def test_thu_hoi_xoa_viec_chua_dat(sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BON_BUOC)
    release_update.thu_hoi_goi(sess, nguon="lsx", id=lsx_id, actor=admin)
    sess.commit()
    assert _viec(sess, lsx_id) == []
    assert _cv(sess, lsx_id, "Bế").tgc_viec_id is None


def test_thu_hoi_chan_viec_da_dat(sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BON_BUOC)
    (v,) = _viec(sess, lsx_id)
    _dat(sess, v, "GC26-9003")
    with pytest.raises(ValueError, match="GC26-9003"):
        release_update.thu_hoi_goi(sess, nguon="lsx", id=lsx_id, actor=admin)
    sess.rollback()
    assert len(_viec(sess, lsx_id)) == 1


def test_tach_theo_buoc(sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BON_BUOC)
    (v,) = _viec(sess, lsx_id)
    moi = tach_theo_buoc(sess, user=admin, viec_id=v.id, expected_version=v.version)
    assert [x.ten_viec for x in moi] == ["Cán màng", "Bế"]
    assert [x.don_vi for x in moi] == ["to", "cai"]
    assert _cv(sess, lsx_id, "Cán màng").tgc_viec_id == moi[0].id
    assert _cv(sess, lsx_id, "Bế").tgc_viec_id == moi[1].id
    # Phát hành cập nhật sau khi tách không gộp lại (dải không đổi).
    dong_bo_khi_cap_nhat(sess, lsx_ids={lsx_id}, actor=admin)
    sess.commit()
    assert [x.id for x in _viec(sess, lsx_id)] == [x.id for x in moi]
    with pytest.raises(ValueError, match="một bước"):
        tach_theo_buoc(sess, user=admin, viec_id=moi[0].id, expected_version=None)


def test_tach_chan_viec_da_dat(sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BON_BUOC)
    (v,) = _viec(sess, lsx_id)
    _dat(sess, v, "GC26-9004")
    with pytest.raises(ValueError, match="GC26-9004"):
        tach_theo_buoc(sess, user=admin, viec_id=v.id, expected_version=None)


def test_xuong_chan_cong_viec_thue_ngoai(sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BON_BUOC)
    cv = _cv(sess, lsx_id, "Cán màng")
    with pytest.raises(ValueError, match="Thuê gia công") as e:
        thuc_thi.bat_dau(sess, user=admin, cong_viec_id=cv.id)
    assert str(e.value) == CHAN_XUONG
    luc = datetime.now(timezone.utc)
    with pytest.raises(ValueError, match="màn Thuê gia công"):
        san_luong.tao_batch(sess, user=admin, cong_viec_id=cv.id, bat_dau=luc - timedelta(hours=1),
                            ket_thuc=luc, tong=10, tot=10)
    with pytest.raises(ValueError, match="màn Thuê gia công"):
        kcs.kiem_cong_doan(sess, user=nguoi_kcs(sess, "TO-KCS-TGC"), cong_viec_id=cv.id, so_dat=10)


def test_ban_giao_sang_viec_thue_ngoai_khong_xac_nhan_tay(sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BON_BUOC)
    in_, can = _cv(sess, lsx_id, "In"), _cv(sess, lsx_id, "Cán màng")
    b = ghi_me(sess, in_, 1000)
    sess.commit()
    ra = ban_giao.de_xuat(sess, user=admin, nguon_cong_viec_id=in_.id, dich_cong_viec_id=can.id,
                          batch_ids=[b.id])
    assert ra["tgc_viec_id"] == can.tgc_viec_id
    bg_id = ra["ban_giao_id"]
    with pytest.raises(ValueError, match="nhận bằng Phiếu giao ở màn Thuê gia công"):
        ban_giao.xac_nhan(sess, user=admin, ban_giao_id=bg_id)
