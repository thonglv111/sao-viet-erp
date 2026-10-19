"""Loại Giấy / Sóng của mã giấy (spec 2026-10-19-loai-giay-song).

Mỗi mã ở danh mục Giấy thuộc đúng một loại: `giay` hoặc `song`. Một sản phẩm tính giá (và một lệnh)
có tối đa 1 mã Giấy + 1 mã Sóng; giấy chính lấy theo loại chứ không đoán theo thứ tự bước.
"""
import pytest
from pydantic import ValidationError

from app.schemas.vat_lieu_kho import GiayIn
from tests.test_vat_lieu_kho import _svc


# ---- Danh mục ----------------------------------------------------------------------------------


def test_tao_giay_mac_dinh_loai_giay():
    _db, svc = _svc()
    g = svc.create("giay", dict(ma="C150", ten="Couche 150", gsm=150, don_vi_gia="kg"))
    assert g.loai == "giay"


def test_tao_giay_loai_song():
    _db, svc = _svc()
    g = svc.create("giay", dict(ma="SONG-E", ten="Sóng E", gsm=300, don_vi_gia="kg", loai="song"))
    assert g.loai == "song"
    g2 = svc.update("giay", g.id, dict(ma="SONG-E", ten="Sóng E", gsm=300, don_vi_gia="kg", loai="giay"))
    assert g2.loai == "giay"


def test_loai_la_gia_tri_la_bi_422():
    with pytest.raises(ValidationError):
        GiayIn(ma="D", ten="Decal", gsm=80, loai="decal")
    assert GiayIn(ma="C", ten="C", gsm=80).loai == "giay"


def test_loc_va_dem_theo_loai():
    _db, svc = _svc()
    svc.create("giay", dict(ma="C150", ten="Couche 150", gsm=150, don_vi_gia="kg"))
    svc.create("giay", dict(ma="SONG-E", ten="Sóng E", gsm=300, don_vi_gia="kg", loai="song"))
    rows, total = svc.list("giay", loai="song")
    assert total == 1 and rows[0].ma == "SONG-E"
    dem = {d["value"]: (d["nhan"], d["so"]) for d in svc.dem_theo_cot("giay", "loai")}
    assert dem == {"giay": ("Giấy", 1), "song": ("Sóng", 1)}
