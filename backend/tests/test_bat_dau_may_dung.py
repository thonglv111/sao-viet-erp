"""Bàn tổ: máy đang dừng chờ sửa thì không cho "Bắt đầu" (lỗi #27 bấm thử E2E 18/10/2026).

Máy in có phiếu sửa ở trạng thái máy dừng chưa xong mà tổ vẫn bấm Bắt đầu được, không ai hỏi lại —
khung việc có hiện dòng phiếu sửa, người đọc kỹ mới thấy.
"""
from __future__ import annotations

import pytest

from app.models.ky_thuat_may import TT_YC_CHO_TIEP_NHAN, YeuCauSuaChua
from app.models.san_xuat import CV_DANG_CHAY
from app.services.san_xuat import thuc_thi
from tests.test_lsx_service import _may_in
from tests.test_san_xuat_thuc_thi import (  # noqa: F401
    _emp, _mot_cv, _to_cong_nhat, admin, customer, db, lsx_svc, orders,
)


def _viec_tren_may(db, orders, lsx_svc, admin, customer):
    to, cv = _mot_cv(db, orders, lsx_svc, admin, customer)
    may = _may_in(db)
    cv.may_id = may.id
    db.commit()
    thuc_thi.phan_cong(db, user=admin, cong_viec_id=cv.id,
                       employee_id=_emp(db, _to_cong_nhat(db), "NV-MD-1").id)
    return cv, may


def _bao_hong(db, may, *, dung: bool):
    db.add(YeuCauSuaChua(ma="YC-MD-1", may_id=may.id, bo_phan_hong="Cụm cấp giấy",
                         muc_do="cao", may_dung=dung, trang_thai=TT_YC_CHO_TIEP_NHAN))
    db.commit()


def test_bat_dau_bi_chan_khi_may_co_phieu_sua_may_dung(db, orders, lsx_svc, admin, customer):
    cv, may = _viec_tren_may(db, orders, lsx_svc, admin, customer)
    _bao_hong(db, may, dung=True)
    with pytest.raises(ValueError, match="YC-MD-1"):
        thuc_thi.bat_dau(db, user=admin, cong_viec_id=cv.id)


def test_bao_hong_khong_dung_may_van_bat_dau_duoc(db, orders, lsx_svc, admin, customer):
    cv, may = _viec_tren_may(db, orders, lsx_svc, admin, customer)
    _bao_hong(db, may, dung=False)
    assert thuc_thi.bat_dau(db, user=admin, cong_viec_id=cv.id)["trang_thai"] == CV_DANG_CHAY
