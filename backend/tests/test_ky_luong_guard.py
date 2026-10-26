"""Nền đợt vá 26/10/2026: hàm kiểm kỳ lương dùng chung + định dạng số trong câu.

`ly_do_ky_luong_da_khoa` là cửa hỏi chung cho mọi đường ghi đổi tiền của kỳ lương (L-SX-43, 44, 47, 48).
Câu phải phân biệt "đã chốt" và "đã chi" (NL-DM08: băng khoá luôn ghi "đã chốt").
"""

from __future__ import annotations

from datetime import date

import pytest

from app.models.payroll import PERIOD_DRAFT, PERIOD_LOCKED, PERIOD_PAID, PayrollPeriod
from app.services.dinh_dang import so_vn
from app.services.ky_luong_guard import ly_do_ky_luong_da_khoa
from tests.conftest import phien_da_seed


@pytest.fixture
def db():
    yield from phien_da_seed()


def _ky(db, nam, thang, tt):
    db.add(PayrollPeriod(year=nam, month=thang, status=tt))
    db.flush()


def test_khong_co_ky_hoac_ky_nhap_thi_ghi_duoc(db):
    assert ly_do_ky_luong_da_khoa(db, date(2026, 9, 15), viec="sửa lần ghi") is None
    _ky(db, 2026, 9, PERIOD_DRAFT)
    assert ly_do_ky_luong_da_khoa(db, date(2026, 9, 15), viec="sửa lần ghi") is None


def test_ky_da_chot_va_da_chi_noi_dung_chu(db):
    _ky(db, 2026, 8, PERIOD_LOCKED)
    _ky(db, 2026, 9, PERIOD_PAID)
    chot = ly_do_ky_luong_da_khoa(db, date(2026, 8, 3), viec="sửa lần ghi")
    chi = ly_do_ky_luong_da_khoa(db, date(2026, 9, 3), viec="sửa lần ghi")
    assert chot and "08/2026 đã chốt" in chot and "sửa lần ghi" in chot
    assert chi and "09/2026 đã chi" in chi and "Huỷ 'đã chi'" in chi


def test_nhieu_ngay_mot_ngay_roi_vao_ky_khoa_la_chan(db):
    _ky(db, 2026, 9, PERIOD_LOCKED)
    assert ly_do_ky_luong_da_khoa(db, None, date(2026, 10, 2), date(2026, 9, 30), viec="lập phiếu thu")
    assert ly_do_ky_luong_da_khoa(db, None, date(2026, 10, 2), viec="lập phiếu thu") is None


def test_so_vn_in_so_kieu_viet():
    assert so_vn(1317600) == "1.317.600"
    assert so_vn(12345.5) == "12.345,5"
    assert so_vn(-0.25) == "-0,25"
    assert so_vn(None) == "0"
