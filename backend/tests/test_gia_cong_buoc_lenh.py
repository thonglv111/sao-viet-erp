"""Bước "Thuê ngoài" ở Kế hoạch SX (spec 2026-09-26 §7, §8, §10).

Nhà gia công chọn từ danh mục Nhà cung cấp; bước không tổ, không máy, không vật tư, không thời
lượng; thiếu nhà gia công thì chặn "Sẵn sàng"."""
from __future__ import annotations

import pytest

from app.models.lsx import LB_MAY, LB_THUE_NGOAI
from app.schemas.lsx import LsxCongDoanIn
from app.services.lsx_service import LsxValidationError, thoi_luong_buoc
from tests.gia_cong_fixtures import lenh_chua_phat, ncc
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401


def _rows(lsx, **sua_buoc_cuoi) -> list[LsxCongDoanIn]:
    ds = sorted(lsx.cong_doans, key=lambda c: c.thu_tu)
    out = []
    for i, c in enumerate(ds):
        d = {"step_key": c.step_key, "thu_tu": i, "cong_doan_id": c.cong_doan_id, "ten": c.ten,
             "nhom": c.nhom, "loai_buoc": c.loai_buoc, "department_id": c.department_id,
             "may_id": c.may_id}
        if i == len(ds) - 1:
            d.update(sua_buoc_cuoi)
        out.append(LsxCongDoanIn(**d))
    return out


def test_buoc_thue_ngoai_lay_ten_tu_danh_muc_va_bo_to_may(sess, orders, lsx_svc, admin, customer):
    s = ncc(sess)
    lsx = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(
        lsx, loai_buoc=LB_THUE_NGOAI, nha_cung_cap_id=s.id,
    ), actor=admin)
    cd = max(lsx.cong_doans, key=lambda c: c.thu_tu)
    assert (cd.nha_cung_cap_id, cd.nha_cung_cap) == (s.id, "Cán màng Minh Long")
    assert cd.department_id is None and cd.may_id is None
    assert list(cd.vat_tus) == []


def test_ncc_khong_tich_nhan_gia_cong_bi_tu_choi(sess, orders, lsx_svc, admin, customer):
    s = ncc(sess, "Giấy Hoàng Hà", nhan=False)
    lsx = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    with pytest.raises(LsxValidationError, match="Nhận gia công"):
        lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(
            lsx, loai_buoc=LB_THUE_NGOAI, nha_cung_cap_id=s.id), actor=admin)


def test_doi_ve_buoc_may_thi_xoa_nha_gia_cong(sess, orders, lsx_svc, admin, customer):
    s = ncc(sess)
    lsx = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(
        lsx, loai_buoc=LB_THUE_NGOAI, nha_cung_cap_id=s.id), actor=admin)
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(lsx, loai_buoc=LB_MAY), actor=admin)
    cd = max(lsx.cong_doans, key=lambda c: c.thu_tu)
    assert cd.nha_cung_cap_id is None and cd.nha_cung_cap is None


def test_thieu_nha_gia_cong_chan_san_sang(sess, orders, lsx_svc, admin, customer):
    # Khổ nguyên = khổ in: không có bước Tề giấy in (bước máy tự chèn, chưa gán tổ) chen vào đếm thiếu.
    lsx = lenh_chua_phat(sess, orders, lsx_svc, admin, customer, kho_nguyen=(650, 900))
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(
        lsx, loai_buoc=LB_THUE_NGOAI), actor=admin)
    thieu = lsx_svc.thieu_cua(lsx)
    assert "thieu_nha_gia_cong" in thieu
    assert "thieu_to_may" not in thieu     # bước thuê ngoài không bị đòi tổ/máy


def test_thoi_luong_buoc_thue_ngoai_bang_0_khong_canh_bao():
    class Buoc:
        loai_buoc = LB_THUE_NGOAI
        so_luot_chay = 3
        phat_sinh_phut = 45
        so_gio_ke_hoach = 0
        so_luong_vao = 5000
        don_vi_vao = "to"

    t = thoi_luong_buoc(Buoc(), None, None)
    assert t["chiem_may_phut"] == 0 and t["tong_phut"] == 0
    assert t["dien_giai"]["phuong_phap"] == "thue_ngoai"
    assert t["dien_giai"]["canh_bao"] == []
