"""Người kế hoạch đổi nguồn giấy của lệnh (spec 2026-10-24-chuan-bi-giay §7): gỡ Cắt giấy cuộn / Tề giấy
in hiện có rồi dựng lại theo nguồn mới; không đụng bước khác. Cùng cổng chặn với sửa routing."""
from __future__ import annotations

import pytest

from app.models.lsx import TT_DA_LAP_KE_HOACH
from app.services.lsx_service import LsxConflict, LsxValidationError
from tests.test_lenh_chuan_bi_giay import _buoc, _giay, _in, _ma, _ptg, _tao, _theo_ma, _ton
from tests.test_lsx_service import (  # noqa: F401 — fixture dùng chung
    admin, customer, db, lsx_svc, orders,
)


def _lenh_cuon(db, orders, lsx_svc, admin, customer, *, song=False):
    ptg = _ptg(db, song=song)
    _ton(db, "G-DUP350", 870, 0, "kg", 5_000)
    lsx = _tao(db, orders, lsx_svc, admin, customer, ptg)
    assert lsx.nguon_giay == "cuon"
    return lsx


def test_doi_cuon_sang_to_nguyen_go_cat_cuon(db, orders, lsx_svc, admin, customer):
    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer)
    lsx = lsx_svc.doi_nguon_giay(lsx_id=lsx.id, nguon="to_nguyen", rong_cuon=None, actor=admin)
    assert lsx.nguon_giay == "to_nguyen"
    assert _ma(db, lsx) == ["TGI", "CD-IN-CB", "CD-CAN-CB"]
    tgi = _theo_ma(db, lsx, "TGI")
    co_giay = {ten: dong for ten, dong in _giay(lsx).items() if dong}
    assert list(co_giay) == [tgi.ten]
    (g,) = co_giay[tgi.ten]
    assert (g.don_vi_goc, g.kho_rong, g.kho_dai, float(g.so_luong)) == ("to", 650, 860, tgi.so_luong_vao)
    assert tgi.phu_thuoc == [] and {e.buoc_truoc_id for e in _in(lsx).phu_thuoc} == {tgi.id}


def test_doi_sang_cuon_dung_lai_cat_cuon_theo_rong_nhap(db, orders, lsx_svc, admin, customer):
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg(db))
    assert lsx.nguon_giay == "mua"
    lsx = lsx_svc.doi_nguon_giay(lsx_id=lsx.id, nguon="cuon", rong_cuon=880, actor=admin)
    assert _ma(db, lsx) == ["CGC", "TGI", "CD-IN-CB", "CD-CAN-CB"]
    (g,) = _giay(lsx)[_theo_ma(db, lsx, "CGC").ten]
    assert (g.don_vi_goc, g.kho_rong, g.kho_dai) == ("kg", 880, 0) and float(g.so_luong) > 0


def test_doi_khi_dang_giu_cho_409(db, orders, lsx_svc, admin, customer):
    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer)
    lsx.giu_cho_bat = True
    db.commit()
    with pytest.raises(LsxConflict, match="giữ chỗ"):
        lsx_svc.doi_nguon_giay(lsx_id=lsx.id, nguon="to_in", rong_cuon=None, actor=admin)
    assert _ma(db, lsx_svc.get(lsx.id))[:2] == ["CGC", "TGI"]


def test_doi_khi_da_lap_ke_hoach_409(db, orders, lsx_svc, admin, customer):
    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer)
    lsx.trang_thai = TT_DA_LAP_KE_HOACH
    db.commit()
    with pytest.raises(LsxConflict, match="lập kế hoạch"):
        lsx_svc.doi_nguon_giay(lsx_id=lsx.id, nguon="to_in", rong_cuon=None, actor=admin)


@pytest.mark.parametrize("rong", [None, 0, 700, 891])
def test_doi_cuon_thieu_rong_cuon_422(db, orders, lsx_svc, admin, customer, rong):
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg(db))
    with pytest.raises(LsxValidationError, match="ộng cuộn"):
        lsx_svc.doi_nguon_giay(lsx_id=lsx.id, nguon="cuon", rong_cuon=rong, actor=admin)


def test_doi_nguon_la_tu_khong_nhan(db, orders, lsx_svc, admin, customer):
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg(db))
    with pytest.raises(LsxValidationError):
        lsx_svc.doi_nguon_giay(lsx_id=lsx.id, nguon="khach", rong_cuon=None, actor=admin)


def test_doi_khong_dung_buoc_khac(db, orders, lsx_svc, admin, customer):
    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer, song=True)
    giu = {c.step_key for c in _buoc(lsx) if _ma(db, lsx)[_buoc(lsx).index(c)] not in ("CGC", "TGI")}
    lsx = lsx_svc.doi_nguon_giay(lsx_id=lsx.id, nguon="to_in", rong_cuon=None, actor=admin)
    assert _ma(db, lsx) == ["CD-IN-CB", "TS", "BTĐ", "CD-CAN-CB"]
    assert {c.step_key for c in _buoc(lsx)} == giu
    (g,) = _giay(lsx)[_in(lsx).ten]
    assert (g.don_vi_goc, g.kho_rong, g.kho_dai) == ("to", 430, 650)
    assert len(_giay(lsx)[_theo_ma(db, lsx, "TS").ten]) == 1


def test_luu_routing_kem_vat_tu_giu_rong_cuon(db, orders, lsx_svc, admin, customer):
    """E2E 24/10: màn lệnh lưu routing gửi kèm dòng vật tư mọi bước — Cắt giấy cuộn phải giữ rộng cuộn
    người kế hoạch đã chọn (dòng giấy là nơi duy nhất ghi nó), không về 0 kg."""
    from app.schemas.lsx import LsxBuocVatTuIn, LsxCongDoanIn

    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer)
    (truoc,) = _giay(lsx)[_theo_ma(db, lsx, "CGC").ten]
    kg_truoc = float(truoc.so_luong)
    rows = [LsxCongDoanIn(step_key=c.step_key, cong_doan_id=c.cong_doan_id, ten=c.ten, nhom=c.nhom,
                          department_id=c.department_id, may_id=c.may_id,
                          vat_tus=[LsxBuocVatTuIn(hang_loai=v.hang_loai, vat_tu_id=v.vat_tu_id)
                                   for v in c.vat_tus])
            for c in _buoc(lsx)]
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=rows, actor=admin)
    (g,) = _giay(lsx)[_theo_ma(db, lsx, "CGC").ten]
    assert (g.don_vi_goc, g.kho_rong, g.kho_dai) == ("kg", 870, 0)
    assert float(g.so_luong) == pytest.approx(kg_truoc) and kg_truoc > 0
