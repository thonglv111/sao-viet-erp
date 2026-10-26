"""Kế hoạch vật tư, tự lập xuất kho, cổng Bắt đầu đọc giấy ở bước đầu khâu chuẩn bị (spec
2026-10-24-chuan-bi-giay §9): logic giữ nguyên, chỉ chỗ giấy nằm đổi. Lệnh cũ (giấy ở In) không đổi.
"""
from __future__ import annotations

from datetime import datetime

import pytest

from app.models.cong_doan import CongDoan
from app.models.lsx import TT_SAN_SANG, LsxCongDoanVatTu
from app.models.san_xuat import SanXuatCongViec
from app.models.san_xuat_vat_tu import SanXuatVatTuDeNghi
from app.models.stock_request import StockRequestLine
from app.models.vat_lieu_kho import GiayNguyen
from app.services.san_xuat.trang_thai_vat_tu import trang_thai_vat_tu
from tests.test_ke_hoach_vat_tu import svc  # noqa: F401
from tests.test_lenh_chuan_bi_giay import _cd_he_thong, _in, _ptg, _tao, _theo_ma, _ton
from tests.test_lsx_service import (  # noqa: F401
    _don_da_chuyen_sx, _may_in, _to_san_xuat, admin, customer, db, lsx_svc, orders,
)
from tests.test_xep_lich_lenh_service import svc3  # noqa: F401

_MOC = datetime(2026, 9, 11, 8, 0)


def _dong_giay(bang, g) -> dict[tuple, float]:
    return {(i["hang_loai"], i["hang_id"], i["kho_rong"], i["kho_dai"], i["don_vi_goc"]):
            sum(d["nhu_cau"] for d in i["dong"])
            for i in bang["items"] if i["hang_loai"] == "giay" and i["hang_id"] == g.id}


def _g(db, ma="G-DUP350"):
    return db.query(GiayNguyen).filter(GiayNguyen.ma == ma).one()


def _co_to(db):
    to_id = _to_san_xuat(db).id
    for ma in ("CGC", "TGI", "TS", "BTĐ"):
        _cd_he_thong(db, ma).department_ids = [to_id]
    db.commit()


def test_khvt_nhu_cau_cuon_kg_o_cat_cuon(db, orders, lsx_svc, svc, admin, customer):
    ptg = _ptg(db)
    _ton(db, "G-DUP350", 870, 0, "kg", 5_000)
    lsx = _tao(db, orders, lsx_svc, admin, customer, ptg)
    cgc = _theo_ma(db, lsx, "CGC")
    (dong,) = [v for v in cgc.vat_tus if v.hang_loai == "giay"]

    kq = _dong_giay(svc.can_doi(chi_lsx_ids={lsx.id}), _g(db))

    assert kq == {("giay", _g(db).id, 870, 0, "kg"): pytest.approx(float(dong.so_luong), abs=1e-3)}


def test_khvt_nhu_cau_to_nguyen_o_te(db, orders, lsx_svc, svc, admin, customer):
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg(db))
    tgi = _theo_ma(db, lsx, "TGI")

    kq = _dong_giay(svc.can_doi(chi_lsx_ids={lsx.id}), _g(db))

    assert kq == {("giay", _g(db).id, 650, 860, "to"): pytest.approx(tgi.so_luong_vao)}


def test_khvt_song_o_te_song(db, orders, lsx_svc, svc, admin, customer):
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg(db, song=True))
    ts = _theo_ma(db, lsx, "TS")

    kq = _dong_giay(svc.can_doi(chi_lsx_ids={lsx.id}), _g(db, "G-SONGE"))

    assert kq == {("giay", _g(db, "G-SONGE").id, 430, 650, "to"): pytest.approx(ts.so_luong_vao)}


def _phat_hanh(db, orders, lsx_svc, svc3, admin, customer):
    _co_to(db)
    ptg = _ptg(db)
    _ton(db, "G-DUP350", 870, 0, "kg", 5_000)
    lsx = _tao(db, orders, lsx_svc, admin, customer, ptg)
    lsx_svc.set_trang_thai(lsx_id=lsx.id, trang_thai=TT_SAN_SANG, actor=admin)
    svc3.dat_moc(lsx.id, _MOC)
    svc3.phat_hanh(lsx.id, actor=admin)
    cvs = db.query(SanXuatCongViec).filter(SanXuatCongViec.lsx_id == lsx.id).all()
    ma_buoc = {c.id: db.get(CongDoan, c.cong_doan_id).ma for c in lsx_svc.get(lsx.id).cong_doans}
    return lsx, {ma_buoc[cv.lsx_cong_doan_id]: cv for cv in cvs if cv.lsx_cong_doan_id in ma_buoc}


def _dong_xin(db, cv) -> list[StockRequestLine]:
    req_ids = [d.stock_request_id for d in
               db.query(SanXuatVatTuDeNghi).filter(SanXuatVatTuDeNghi.cong_viec_id == cv.id)]
    return db.query(StockRequestLine).filter(StockRequestLine.request_id.in_(req_ids)).all()


def test_tu_lap_khi_phat_hanh_xin_giay_cho_buoc_dau(db, orders, lsx_svc, svc3, admin, customer):
    _lsx, cv = _phat_hanh(db, orders, lsx_svc, svc3, admin, customer)
    g = _g(db)

    (dong,) = [d for d in _dong_xin(db, cv["CGC"]) if d.hang_loai == "giay"]
    assert (dong.hang_id, dong.kho_rong, dong.kho_dai) == (g.id, 870, 0)
    assert all(d.hang_loai != "giay" for d in _dong_xin(db, cv["CD-IN-CB"]))
    assert all(d.hang_loai != "giay" for d in _dong_xin(db, cv["TGI"]))


def test_cong_bat_dau_in_chi_cho_muc(db, orders, lsx_svc, svc3, admin, customer):
    _lsx, cv = _phat_hanh(db, orders, lsx_svc, svc3, admin, customer)

    tt = trang_thai_vat_tu(db, [cv["CD-IN-CB"], cv["CGC"]])

    assert tt[cv["CGC"].id]["mon"], "Cắt giấy cuộn phải chờ giấy kho"
    in_ = tt[cv["CD-IN-CB"].id]
    assert in_ is None or all("Duplex" not in m["ten"] for m in in_["mon"])


def test_lenh_cu_giay_o_in_khvt_khong_doi(db, orders, lsx_svc, svc, admin, customer):
    """Lệnh lập trước khâu chuẩn bị: không nguồn, giấy khai ở In khổ in. KHVT đọc đúng dòng đó."""
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg(db))
    lsx_svc._go_khau_chuan_bi_giay(lsx)
    lsx.nguon_giay = None
    in_ = _in(lsx)
    g = _g(db)
    in_.vat_tus.append(LsxCongDoanVatTu(
        hang_loai="giay", vat_tu_id=g.id, vat_tu_ma_snapshot=g.ma, vat_tu_ten_snapshot=g.ten,
        don_vi_snapshot="to", so_luong=in_.so_luong_vao, thu_tu=0, tu_dong=False, gia_tri_chip={},
        kho_rong=430, kho_dai=650, don_vi_goc="to"))
    db.commit()

    kq = _dong_giay(svc.can_doi(chi_lsx_ids={lsx.id}), g)

    assert kq == {("giay", g.id, 430, 650, "to"): pytest.approx(in_.so_luong_vao)}
