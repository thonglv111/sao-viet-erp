"""KCS ghi lỗi ở công đoạn GIỮA đã kết thúc: không vượt số tổ đã làm (lỗi #31 bấm thử 18/10/2026).

Bước In "Đã xong, Tổ đã làm 1.250 tờ in" nhận 1.300 tờ lỗi, hộp vẫn báo "Lưu được" và tổ In bị
báo 1.300 tờ lỗi; lần ghi lỗi không sửa/xoá được trên giao diện nên gõ nhầm là số sai nằm lại.

Bỏ trần ở công đoạn giữa (10/10/2026) là cho lúc MÁY ĐANG CHẠY — KCS thấy lỗi trước khi tổ ghi
mẻ. Công đoạn đã kết thúc thì tổ đã ghi hết sản lượng, trần quay lại: Σ lỗi bắt tại công đoạn
(cũ + lần này) ≤ Σ tốt tổ đã ghi. Đang chạy vẫn không trần — `test_cong_doan_giua_chi_ghi_loi`.
"""
from __future__ import annotations

import pytest

from app.models.san_xuat import CV_HOAN_THANH
from app.services.san_xuat import kcs
from tests.test_san_xuat_kcs import _anh, _cv_kcs, _ghi_tot, _to_kiem
from tests.test_san_xuat_thuc_thi import admin, customer, db, lsx_svc, orders  # noqa: F401


def _cv_da_xong(db, orders, lsx_svc, admin, customer, tot: float):
    _to, cv = _cv_kcs(db, orders, lsx_svc, admin, customer)
    _ghi_tot(db, cv, tot)
    cv.trang_thai = CV_HOAN_THANH
    db.commit()
    return cv


def test_cong_doan_da_xong_loi_vuot_so_to_da_lam_bi_chan(db, orders, lsx_svc, admin, customer):
    cv = _cv_da_xong(db, orders, lsx_svc, admin, customer, 1250)
    _d, nguoi = _to_kiem(db)
    with pytest.raises(ValueError, match="1.250"):
        kcs.kiem_cong_doan(db, user=nguoi, cong_viec_id=cv.id, so_loi=1300, loi_mo_ta="Lem",
                           anh=_anh())


def test_cong_doan_da_xong_cong_don_lan_truoc(db, orders, lsx_svc, admin, customer):
    cv = _cv_da_xong(db, orders, lsx_svc, admin, customer, 100)
    _d, nguoi = _to_kiem(db)
    kcs.kiem_cong_doan(db, user=nguoi, cong_viec_id=cv.id, so_loi=60, loi_mo_ta="Lem", anh=_anh())
    with pytest.raises(ValueError, match="còn ghi được 40"):
        kcs.kiem_cong_doan(db, user=nguoi, cong_viec_id=cv.id, so_loi=41, loi_mo_ta="Xước",
                           anh=_anh())
    kcs.kiem_cong_doan(db, user=nguoi, cong_viec_id=cv.id, so_loi=40, loi_mo_ta="Xước", anh=_anh())
