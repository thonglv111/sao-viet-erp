"""Báo cáo lỗi KCS gọi chặng thành phẩm bằng ĐVT của lệnh, như hộp Kiểm hàng (05/11/2026)."""
from app.services.san_xuat.kcs_bao_cao import _dv_hien


def test_chang_thanh_pham_goi_theo_dvt_lenh():
    assert _dv_hien("cai", "cái") == "cái"
    assert _dv_hien("CAI", "cuốn") == "cuốn"


def test_chang_khac_hoac_lenh_khong_co_dvt_giu_ma():
    assert _dv_hien("to", "cái") == "to"
    assert _dv_hien("cai", None) == "cai"
    assert _dv_hien(None, "cái") is None
