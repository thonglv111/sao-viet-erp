"""Bảy công đoạn HỆ THỐNG của khâu chuẩn bị giấy + bồi (spec 2026-10-24-chuan-bi-giay §3).

Máy tự chèn Cắt giấy cuộn / Tề giấy in / Tề sóng vào lệnh và nhận ra bước nhận sóng bằng MÃ — nên
mã, tên, nhóm, đơn vị vào/ra khoá; không xoá, không ngừng. Tổ, năng suất, khoán… vẫn sửa được."""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.db_migrations import _migrate_cong_doan_he_thong
from app.models.cong_doan import CD_HE_THONG, CongDoan, la_cong_doan_he_thong
from app.repositories.cong_doan_repo import CongDoanRepository
from app.services.cong_doan_service import CongDoanService, CongDoanValidationError


def _svc():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    db = sessionmaker(bind=eng)()
    return db, CongDoanService(CongDoanRepository(db))


def _bang(db) -> dict[str, tuple]:
    return {c.ma: (c.ten, c.nhom, c.don_vi_vao, c.don_vi_ra, c.active)
            for c in db.query(CongDoan).all()}


def test_migration_tao_du_bay_cong_doan_he_thong():
    db, _ = _svc()
    _migrate_cong_doan_he_thong(db)
    _migrate_cong_doan_he_thong(db)          # chạy lại không đẻ thêm
    bang = _bang(db)
    assert set(bang) == set(CD_HE_THONG)
    assert bang["CGC"] == ("Cắt giấy cuộn", "prepress", "to_nguyen", "to_nguyen", True)
    assert bang["TGI"] == ("Tề giấy in", "prepress", "to_nguyen", "to", True)
    assert bang["TS"] == ("Tề sóng", "prepress", "to", "to", True)
    assert bang["BTĐ"] == ("Bồi Duplex với Krap TĐ", "finishing", "to", "to", True)
    assert db.query(CongDoan).count() == 7


def test_migration_ep_lai_o_khoa_dong_da_co():
    db, _ = _svc()
    db.add(CongDoan(ma="CGC", ten="Cắt cuộn (cũ)", nhom="finishing", nang_suat=1200, active=False))
    db.commit()
    _migrate_cong_doan_he_thong(db)
    cd = db.query(CongDoan).filter(CongDoan.ma == "CGC").one()
    assert (cd.ten, cd.nhom, cd.don_vi_vao, cd.don_vi_ra, cd.active) == (
        "Cắt giấy cuộn", "prepress", "to_nguyen", "to_nguyen", True)
    assert float(cd.nang_suat) == 1200


def _payload(cd: CongDoan, **doi) -> dict:
    d = dict(ma=cd.ma, ten=cd.ten, nhom=cd.nhom, don_vi_vao=cd.don_vi_vao, don_vi_ra=cd.don_vi_ra,
             pricing_basis=cd.pricing_basis)
    d.update(doi)
    return d


@pytest.mark.parametrize("doi", [
    {"ten": "Tề giấy"}, {"ma": "TGI2"}, {"nhom": "finishing"},
    {"don_vi_vao": "to", "don_vi_ra": "to"}, {"active": False},
])
def test_khong_doi_o_khoa(doi):
    db, svc = _svc()
    _migrate_cong_doan_he_thong(db)
    cd = db.query(CongDoan).filter(CongDoan.ma == "TGI").one()
    with pytest.raises(CongDoanValidationError, match="Công đoạn hệ thống"):
        svc.update(cd.id, _payload(cd, **doi))


def test_sua_duoc_nang_suat_va_cong_thuc_gia():
    db, svc = _svc()
    _migrate_cong_doan_he_thong(db)
    cd = db.query(CongDoan).filter(CongDoan.ma == "BTĐ").one()
    svc.update(cd.id, _payload(cd, nang_suat=900, cong_thuc_gia="so_luong * 10"))
    db.refresh(cd)
    assert float(cd.nang_suat) == 900 and cd.cong_thuc_gia == "so_luong * 10"


def test_khong_ngung_khong_xoa():
    db, svc = _svc()
    _migrate_cong_doan_he_thong(db)
    cd = db.query(CongDoan).filter(CongDoan.ma == "TS").one()
    with pytest.raises(CongDoanValidationError):
        svc.dat_active(cd.id, False)
    with pytest.raises(CongDoanValidationError, match="công đoạn của hệ thống"):
        svc.delete(cd.id)
    assert db.query(CongDoan).filter(CongDoan.ma == "TS").one().active is True


def test_cong_doan_thuong_van_xoa_duoc():
    db, svc = _svc()
    cd = svc.create(dict(ma="X1", ten="Bế", nhom="finishing", don_vi_vao="to", don_vi_ra="cai",
                          pricing_basis="per_sheet"))
    assert not la_cong_doan_he_thong(cd.ma)
    svc.delete(cd.id)
    assert db.query(CongDoan).filter(CongDoan.ma == "X1").first() is None


def test_schema_co_dinh_va_tra_id_theo_ma():
    from app.repositories.cong_doan_repo import id_cong_doan_he_thong
    from app.schemas.cong_doan import CongDoanRow

    db, svc = _svc()
    _migrate_cong_doan_he_thong(db)
    cgc = db.query(CongDoan).filter(CongDoan.ma == "CGC").one()
    thuong = svc.create(dict(ma="X2", ten="Cán", nhom="finishing", don_vi_vao="to",
                             don_vi_ra="to", pricing_basis="per_sheet"))
    assert CongDoanRow.model_validate(cgc).co_dinh is True
    assert CongDoanRow.model_validate(thuong).co_dinh is False
    assert id_cong_doan_he_thong(db, "CGC") == cgc.id
    assert id_cong_doan_he_thong(db, "X2") is None      # không phải mã hệ thống thì không tra
