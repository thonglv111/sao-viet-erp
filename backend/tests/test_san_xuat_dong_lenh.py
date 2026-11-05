"""Đóng lệnh THỦ CÔNG (spec 2026-09-29) — tầng service `services/san_xuat/dong_lenh.py`.

Không cổng: còn dở chỉ ra CẢNH BÁO. Đóng/mở lại theo NHÓM, ghi cả nhóm lẫn mọi lệnh. Đóng đủ: mọi người KCS;
đóng khi còn cảnh báo và mở lại: phải có ô "Đóng lệnh thiếu" (08/10/2026); người ngoài KCS bị chặn."""
from __future__ import annotations

import pytest

from app.models.lsx import TT_DA_DONG, TT_DA_PHAT_HANH, Lsx
from app.models.san_xuat import CV_DANG_CHAY, CV_HOAN_THANH, NHOM_DANG_SX, NHOM_DONG
from app.repositories.san_xuat_repo import SanXuatRepository
from app.schemas.san_xuat import DongLenhKetQuaOut, DongLenhTinhTrangOut
from app.services.san_xuat import dong_lenh

from tests.test_san_xuat_kcs import (  # noqa: F401
    _batch, _ghi_tot, _ngoai_kcs, _to_kiem, admin, customer, db, lsx_svc, orders,
)
from tests.quyen_to_fixtures import cap_dong_thieu


def _cvs(db, nhom_id):
    return SanXuatRepository(db).cong_viec_hien_tai_cua_nhom(nhom_id)


def _muc_tieu(db, nhom_id, so):
    for cv in _cvs(db, nhom_id):
        if cv.la_kcs_cuoi:
            cv.so_luong_ra = so
    db.commit()


def _hoan_thanh_het(db, nhom_id):
    for cv in _cvs(db, nhom_id):
        cv.trang_thai = CV_HOAN_THANH
    db.commit()


def _phat_hanh(db, lsx_id):
    """Fixture KCS dựng lệnh ở `san_sang`; lệnh thật của nhóm đang sản xuất đã `da_phat_hanh`."""
    db.get(Lsx, lsx_id).trang_thai = TT_DA_PHAT_HANH
    db.commit()


def _ma_canh_bao(tt):
    return {c["ma"] for c in tt["canh_bao"]}


def test_tinh_trang_du_het_thi_chi_con_canh_bao_chua_gui_kho(db, orders, lsx_svc, admin, customer):
    _to, cv, _res = _batch(db, orders, lsx_svc, admin, customer, cuoi=True)   # tốt 100 · đạt 90 · lỗi 10
    _muc_tieu(db, cv.nhom_id, 90)
    _hoan_thanh_het(db, cv.nhom_id)
    tt = dong_lenh.tinh_trang_dong(db, cv.nhom_id)
    assert DongLenhTinhTrangOut.model_validate(tt).trang_thai == NHOM_DANG_SX
    assert tt["da_dat"] == 90 and tt["muc_tieu"] == 90
    assert _ma_canh_bao(tt) == {"chua_gui_kho"}          # đạt 90 chưa gửi yêu cầu nhập kho
    assert [l["id"] for l in tt["lenh"]] == [cv.lsx_id]


def test_tinh_trang_du_bon_canh_bao(db, orders, lsx_svc, admin, customer):
    _to, cv, _res = _batch(db, orders, lsx_svc, admin, customer, cuoi=True)
    _ghi_tot(db, cv, 50)                                  # tốt thêm 50 chưa kiểm
    _muc_tieu(db, cv.nhom_id, 10_000)
    tt = dong_lenh.tinh_trang_dong(db, cv.nhom_id)
    assert _ma_canh_bao(tt) == {"chua_kiem", "chua_gui_kho", "thieu_muc_tieu", "viec_do"}
    cau = {c["ma"]: c["cau"] for c in tt["canh_bao"]}
    assert "50" in cau["chua_kiem"] and "chưa kiểm" in cau["chua_kiem"]
    assert "90 / 10.000" in cau["thieu_muc_tieu"] and "9.910" in cau["thieu_muc_tieu"]
    assert "rút khỏi Việc của tổ" in cau["viec_do"]


def test_dong_khi_con_do_van_dong_duoc_va_dong_moi_lenh(db, orders, lsx_svc, admin, customer):
    _to, cv, res = _batch(db, orders, lsx_svc, admin, customer, cuoi=True)
    _muc_tieu(db, cv.nhom_id, 10_000)
    _phat_hanh(db, cv.lsx_id)
    cap_dong_thieu(db, res["nguoi_kcs"])
    nhom = SanXuatRepository(db).nhom(cv.nhom_id)
    kq = dong_lenh.dong(db, user=res["nguoi_kcs"], nhom_id=cv.nhom_id, expected_version=nhom.version)
    assert DongLenhKetQuaOut.model_validate(kq).kieu == "dong"
    assert SanXuatRepository(db).nhom(cv.nhom_id).trang_thai == NHOM_DONG
    assert db.get(Lsx, cv.lsx_id).trang_thai == TT_DA_DONG
    tt = dong_lenh.tinh_trang_dong(db, cv.nhom_id)
    assert tt["dong_boi"] and tt["dong_luc"] is not None


def test_mo_lai_tra_ve_nhu_truoc(db, orders, lsx_svc, admin, customer):
    _to, cv, res = _batch(db, orders, lsx_svc, admin, customer, cuoi=True)
    k = cap_dong_thieu(db, res["nguoi_kcs"])
    _phat_hanh(db, cv.lsx_id)
    kq = dong_lenh.dong(db, user=k, nhom_id=cv.nhom_id, expected_version=None)
    kq2 = dong_lenh.mo_lai(db, user=k, nhom_id=cv.nhom_id, expected_version=kq["version"])
    assert kq2["kieu"] == "mo_lai"
    assert SanXuatRepository(db).nhom(cv.nhom_id).trang_thai == NHOM_DANG_SX
    assert db.get(Lsx, cv.lsx_id).trang_thai == TT_DA_PHAT_HANH


def test_dong_hai_lan_va_mo_lai_nhom_dang_mo_bi_chan(db, orders, lsx_svc, admin, customer):
    _to, cv, res = _batch(db, orders, lsx_svc, admin, customer, cuoi=True)
    k = cap_dong_thieu(db, res["nguoi_kcs"])
    with pytest.raises(ValueError, match="chưa đóng"):
        dong_lenh.mo_lai(db, user=k, nhom_id=cv.nhom_id, expected_version=None)
    dong_lenh.dong(db, user=k, nhom_id=cv.nhom_id, expected_version=None)
    with pytest.raises(ValueError, match="đã đóng"):
        dong_lenh.dong(db, user=k, nhom_id=cv.nhom_id, expected_version=None)


def test_version_lech_bi_chan(db, orders, lsx_svc, admin, customer):
    _to, cv, res = _batch(db, orders, lsx_svc, admin, customer, cuoi=True)
    with pytest.raises(ValueError, match="tải lại"):
        dong_lenh.dong(db, user=res["nguoi_kcs"], nhom_id=cv.nhom_id, expected_version=999)


def test_nguoi_ngoai_kcs_bi_chan(db, orders, lsx_svc, admin, customer):
    _to, cv, _res = _batch(db, orders, lsx_svc, admin, customer, cuoi=True)
    with pytest.raises(PermissionError):
        dong_lenh.dong(db, user=_ngoai_kcs(db), nhom_id=cv.nhom_id, expected_version=None)


def test_dong_thieu_phai_co_o_dong_lenh_thieu(db, orders, lsx_svc, admin, customer):
    """Còn cảnh báo (đạt 90 chưa gửi kho…) ⇒ người KCS chỉ có Thao tác bị chặn, kể cả trưởng phòng;
    bật ô chi tiết "Đóng lệnh thiếu" ở dòng `kcs` của vai thì đóng được."""
    _to, cv, _res = _batch(db, orders, lsx_svc, admin, customer, cuoi=True)
    _d, thuong = _to_kiem(db, ten="Tổ KCS 2", ma="KCS-2", truong=True)
    assert dong_lenh.tinh_trang_dong(db, cv.nhom_id, thuong)["duoc_dong_thieu"] is False
    with pytest.raises(PermissionError, match="Đóng lệnh thiếu"):
        dong_lenh.dong(db, user=thuong, nhom_id=cv.nhom_id, expected_version=None)
    assert SanXuatRepository(db).nhom(cv.nhom_id).trang_thai == NHOM_DANG_SX
    cap_dong_thieu(db, thuong)
    assert dong_lenh.tinh_trang_dong(db, cv.nhom_id, thuong)["duoc_dong_thieu"] is True
    dong_lenh.dong(db, user=thuong, nhom_id=cv.nhom_id, expected_version=None)
    assert SanXuatRepository(db).nhom(cv.nhom_id).trang_thai == NHOM_DONG


def test_dong_du_khong_can_o_nhung_mo_lai_thi_can(db, orders, lsx_svc, admin, customer):
    """Hết cảnh báo ⇒ mọi người KCS đóng được như cũ; mở lại thì vẫn phải có ô."""
    from app.services.san_xuat import kho

    _to, cv, res = _batch(db, orders, lsx_svc, admin, customer, cuoi=True)   # đạt 90 · lỗi 10
    _muc_tieu(db, cv.nhom_id, 90)
    _hoan_thanh_het(db, cv.nhom_id)
    k = res["nguoi_kcs"]
    kho.tao_yeu_cau_nhap_kho_cong_doan(db, user=k, cong_viec_id=cv.id)
    assert dong_lenh.tinh_trang_dong(db, cv.nhom_id, k)["canh_bao"] == []
    kq = dong_lenh.dong(db, user=k, nhom_id=cv.nhom_id, expected_version=None)
    with pytest.raises(PermissionError, match="mở lại"):
        dong_lenh.mo_lai(db, user=k, nhom_id=cv.nhom_id, expected_version=kq["version"])
    assert SanXuatRepository(db).nhom(cv.nhom_id).trang_thai == NHOM_DONG


def test_audit_chup_so_luc_dong(db, orders, lsx_svc, admin, customer):
    from app.models.audit import AuditLog

    _to, cv, res = _batch(db, orders, lsx_svc, admin, customer, cuoi=True)
    _muc_tieu(db, cv.nhom_id, 10_000)
    cap_dong_thieu(db, res["nguoi_kcs"])
    dong_lenh.dong(db, user=res["nguoi_kcs"], nhom_id=cv.nhom_id, expected_version=None)
    a = db.query(AuditLog).filter_by(action="san_xuat_dong_lenh").one()
    assert a.target == f"san_xuat_nhom:{cv.nhom_id}"
    assert "dat=90" in a.detail and "muc_tieu=10000" in a.detail and "chua_gui_kho=90" in a.detail


def test_chan_neu_da_dong(db, orders, lsx_svc, admin, customer):
    _to, cv, res = _batch(db, orders, lsx_svc, admin, customer, cuoi=True)
    dong_lenh.chan_neu_da_dong(db, cv)                 # nhóm mở ⇒ không ném
    cap_dong_thieu(db, res["nguoi_kcs"])
    dong_lenh.dong(db, user=res["nguoi_kcs"], nhom_id=cv.nhom_id, expected_version=None)
    with pytest.raises(ValueError, match="Lệnh đã đóng"):
        dong_lenh.chan_neu_da_dong(db, cv)
    cv.trang_thai = CV_DANG_CHAY
    db.commit()
    dong_lenh.chan_neu_da_dong(db, cv, cho_viec_dang_chay=True)   # việc đang chạy được ghi tiếp
