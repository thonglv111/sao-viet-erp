"""Bước "Thuê ngoài" trên lệnh.

Bước không tổ, không máy, không thời lượng. Từ 13/11/2026 (module Thuê gia công) lệnh KHÔNG chọn
nhà gia công — chọn lúc lập đơn ở màn Thuê gia công; `nha_cung_cap_id` gửi lên bị bỏ qua và lệnh
không còn "thiếu nhà gia công"."""
from __future__ import annotations

from app.models.lsx import LB_MAY, LB_THUE_NGOAI
from app.schemas.lsx import LsxCongDoanIn
from app.services.lsx_service import thoi_luong_buoc
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


def test_buoc_thue_ngoai_bo_to_may_va_bo_qua_nha_gia_cong(sess, orders, lsx_svc, admin, customer):
    s = ncc(sess)
    lsx = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(
        lsx, loai_buoc=LB_THUE_NGOAI, nha_cung_cap_id=s.id,
    ), actor=admin)
    cd = max(lsx.cong_doans, key=lambda c: c.thu_tu)
    assert not hasattr(cd, "nha_cung_cap_id")
    assert cd.department_id is None and cd.may_id is None
    # Thuê gia công (13/11/2026): bước thuê ngoài GIỮ vật tư, mỗi dòng mặc định nhà gia công tự lo.
    assert all(v.ncc_tu_lo for v in cd.vat_tus)


def test_doi_ve_buoc_may_khong_con_nha_gia_cong(sess, orders, lsx_svc, admin, customer):
    lsx = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(
        lsx, loai_buoc=LB_THUE_NGOAI), actor=admin)
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(lsx, loai_buoc=LB_MAY), actor=admin)
    cd = max(lsx.cong_doans, key=lambda c: c.thu_tu)
    assert cd.loai_buoc == LB_MAY and cd.department_id is not None


def test_thue_ngoai_khong_chan_san_sang(sess, orders, lsx_svc, admin, customer):
    # Khổ nguyên = khổ in: không có bước Tề giấy in (bước máy tự chèn, chưa gán tổ) chen vào đếm thiếu.
    lsx = lenh_chua_phat(sess, orders, lsx_svc, admin, customer, kho_nguyen=(650, 900))
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(
        lsx, loai_buoc=LB_THUE_NGOAI), actor=admin)
    thieu = lsx_svc.thieu_cua(lsx)
    assert "thieu_nha_gia_cong" not in thieu
    assert "thieu_bo_phan" not in thieu     # bước thuê ngoài không bị đòi tổ/máy


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
