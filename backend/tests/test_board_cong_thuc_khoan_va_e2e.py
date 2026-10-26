"""Vá E2E 25/10 — hộp ghi sản lượng nói giá theo CÔNG THỨC khoán (L-SX-30, L-SX-40).

Tiền thật của lần ghi là kết quả công thức (`khoan_ky._tien_chinh`), nên hộp ghi không được in
"giá cố định một lần ghi + đơn giá" khi công thức không dùng cả hai, và việc phát sinh có cách tính
giá thì nói cách tính thay vì in đơn giá thô."""
from __future__ import annotations

from app.schemas.san_xuat import KhoanCongDoanThucThiOut, MePhatSinhOut, ViecPhatSinhChonOut
from app.services.san_xuat.board import _chu_cong_thuc, _mo_ta_cong_thuc_khoan


def test_cong_thuc_chi_don_gia_khong_dung_gia_co_dinh():
    m = _mo_ta_cong_thuc_khoan("sl_ghi * don_gia_khoan", None)
    assert m["dung_don_gia"] is True and m["dung_gia_co_dinh"] is False and m["chi_gia"] is True
    assert m["cong_thuc_chu"] and "sl_ghi" not in m["cong_thuc_chu"]


def test_cong_thuc_co_chip_khac_thi_khong_chi_gia():
    m = _mo_ta_cong_thuc_khoan("gia_co_dinh + max(sl_ghi, 100) * don_gia_khoan * (1 + trung_khuon)",
                               [{"ma": "trung_khuon", "ten": "Trùng khuôn"}])
    assert m["chi_gia"] is False and m["dung_gia_co_dinh"] and m["dung_don_gia"]
    assert "Trùng khuôn" in m["cong_thuc_chu"]


def test_o_cong_thuc_trong_ra_chuoi_rong():
    assert _mo_ta_cong_thuc_khoan(None, None) == {
        "cong_thuc_chu": "", "dung_gia_co_dinh": False, "dung_don_gia": False, "chi_gia": True}
    assert _chu_cong_thuc("  ", None) is None


def test_schema_giu_cac_truong_moi():
    """Trường mới phải khai ở schema response, không FastAPI lọc mất (bài học L-SX-47)."""
    k = KhoanCongDoanThucThiOut(id=1, ten="In", don_gia=30, don_vi="to", cong_thuc_chu="Đơn giá",
                                dung_gia_co_dinh=False, dung_don_gia=True, chi_gia=True,
                                phat_sinh=[ViecPhatSinhChonOut(id=2, ten="Xuống bài", don_gia=0,
                                                               don_vi="to", cong_thuc_chu="0.5 × Giá")])
    d = k.model_dump()
    assert d["cong_thuc_chu"] == "Đơn giá" and d["dung_gia_co_dinh"] is False
    assert d["phat_sinh"][0]["cong_thuc_chu"] == "0.5 × Giá"
    assert MePhatSinhOut(id=1, phat_sinh_id=2, so_luong=3, cong_thuc_chu="x").model_dump()["cong_thuc_chu"] == "x"
