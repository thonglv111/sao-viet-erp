"""Sóng tính theo mét vuông (12/11/2026): ĐVT chính m² + tờ, m² quy ra tờ theo khổ, định lượng không
bắt buộc, mã sóng cũ (đ/kg, đ/tờ) quy giá sang đ/m² bằng phép tính (mg 0476)."""
from __future__ import annotations

import pytest
from sqlalchemy import text

from app.db_migrations import _migrate_song_don_vi_m2
from app.models.vat_lieu_kho import GiayNguyen
from app.services.kho_giay import to_tu_m2
from app.services.tinh_gia_service import DanhMucNapSan, quy_gia_giay
from app.services.vat_lieu_kho_service import VatLieuKhoValidationError
from tests.test_vat_lieu_kho import _svc


def test_song_mac_dinh_m2_va_to_giay_van_kg_va_to():
    db, svc = _svc()
    s = svc.create("giay", dict(ma="S1", ten="Sóng B", loai="song"))
    assert s.don_vi_gia == "m2" and s.don_vi_them == ["to"] and s.gsm is None
    g = svc.create("giay", dict(ma="G1", ten="Couche", gsm=150))
    assert g.don_vi_gia == "kg" and g.don_vi_them == ["to"]


def test_song_khong_nhan_kg_lam_dvt_chinh():
    db, svc = _svc()
    with pytest.raises(VatLieuKhoValidationError, match="Sóng chỉ có hai đơn vị"):
        svc.create("giay", dict(ma="S2", ten="Sóng E", loai="song", don_vi_gia="kg"))


def test_doi_loai_giay_sang_song_chon_lai_don_vi():
    db, svc = _svc()
    g = svc.create("giay", dict(ma="G2", ten="Duplex", gsm=250))
    svc.update("giay", g.id, dict(ma="G2", ten="Duplex", loai="song", don_vi_gia=None))
    db.refresh(g)
    assert g.loai == "song" and g.don_vi_gia == "m2" and g.don_vi_them == ["to"]


def test_nhap_song_bang_m2_quy_ra_to_theo_kho():
    db, svc = _svc()
    s = svc.create("giay", dict(ma="S3", ten="Sóng B", loai="song"))
    ra = svc.quy_ve_goc("giay", s.id, "m2", 7.344 * 10, kho_rong=720, kho_dai=1020)
    assert ra["don_vi_goc"] == "to" and ra["sl_goc"] == 100
    assert to_tu_m2(7.343, 720, 1020) == 9          # làm tròn xuống


def test_he_so_gia_m2_bang_1():
    assert quy_gia_giay("m2", DanhMucNapSan()) == (1.0, "m2")


def test_migration_quy_gia_song_cu_sang_m2():
    db, _svc_ = _svc()
    ct_kg = "dinh_luong * dai_nguyen * rong_nguyen * to_nguyen * don_gia_giay"
    db.add_all([
        GiayNguyen(ma="SK", ten="Sóng kg", loai="song", gsm=260, don_vi_gia="kg", don_vi_them=["to"],
                   don_gia=18269, cong_thuc_gia=ct_kg),
        GiayNguyen(ma="ST", ten="Sóng tờ", loai="song", gsm=300, don_vi_gia="to", don_vi_them=["kg"],
                   don_gia=0, cong_thuc_gia="don_gia_giay * to_nguyen"),
        GiayNguyen(ma="SR", ten="Sóng riêng", loai="song", gsm=200, don_vi_gia="kg", don_vi_them=["to"],
                   don_gia=10000, cong_thuc_gia="don_gia_giay * to_nguyen * 2"),
        GiayNguyen(ma="SX", ten="Sóng thiếu", loai="song", gsm=None, don_vi_gia="kg", don_vi_them=["to"],
                   don_gia=5000),
        GiayNguyen(ma="GK", ten="Giấy", loai="giay", gsm=150, don_vi_gia="kg", don_vi_them=["to"],
                   don_gia=20000, cong_thuc_gia=ct_kg),
    ])
    db.commit()
    _migrate_song_don_vi_m2(db)
    _migrate_song_don_vi_m2(db)                       # chạy lại không quy giá lần hai
    r = {m: (dv, float(g), ct) for m, dv, g, ct in db.execute(text(
        "SELECT ma, don_vi_gia, don_gia, cong_thuc_gia FROM giay_nguyen")).all()}
    m2 = "dai_nguyen * rong_nguyen * to_nguyen * don_gia_giay"
    assert r["SK"] == ("m2", 4749.94, m2)              # 18.269 đ/kg × 0,26 kg/m²
    assert r["ST"] == ("m2", 0.0, m2)
    assert r["SR"] == ("m2", 2000.0, "don_gia_giay * to_nguyen * 2")   # công thức tự khai giữ
    assert r["SX"][0] == "kg"                          # có giá mà thiếu định lượng: để nguyên
    assert r["GK"] == ("kg", 20000.0, ct_kg)           # giấy không đụng
