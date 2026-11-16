"""Nền module Thuê gia công (đợt 1, plan 2026-11-13-thue-gia-cong.md): bảng `tgc_*`, cột nối,
luật "một việc một dòng đơn còn sống", "việc đúng một nguồn" và mã chứng từ GC / GG / GN."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from app.db import engine
from app.models import TgcDon, TgcDonDong, TgcViec
from app.repositories.document_sequence_repo import DocumentSequenceRepository
from app.services.sequence_service import SequenceService
from tests.conftest import phien_da_seed


@pytest.fixture
def db():
    yield from phien_da_seed()


def _viec(db, **kw) -> TgcViec:
    v = TgcViec(kieu=kw.pop("kieu", "mot_phan"), ten_viec="Cán màng", sl_can=Decimal("1000"),
                don_vi="tờ", **kw)
    db.add(v)
    db.flush()
    return v


def _don(db, ma: str) -> TgcDon:
    d = TgcDon(ma=ma, nha_cung_cap_id=1, nha_cung_cap_ten="NCC A", ngay_dat=date(2026, 11, 13))
    db.add(d)
    db.flush()
    return d


def test_tao_bang_va_cot(db):
    insp = inspect(engine)
    bang = set(insp.get_table_names())
    for t in ("tgc_viec", "tgc_don", "tgc_don_dong", "tgc_phieu_giao", "tgc_phieu_giao_dong",
              "tgc_phieu_nhan", "tgc_phieu_nhan_dong", "tgc_phieu_chi_nhan"):
        assert t in bang, t
    cot = lambda t: {c["name"] for c in insp.get_columns(t)}  # noqa: E731
    assert "ncc_tu_lo" in cot("lsx_cong_doan_vat_tu")
    assert "tgc_viec_id" in cot("san_xuat_cong_viec")
    assert {"tgc_phieu_giao_id", "tgc_phieu_nhan_id", "tgc_don_dong_id"} <= cot("stock_requests")
    assert "tgc_phieu_nhan_id" in cot("delivery_trips")


def test_mot_viec_mot_dong_song(db):
    v = _viec(db, lsx_id=1)
    d1 = _don(db, "GC26-0001")
    db.add(TgcDonDong(don_id=d1.id, viec_id=v.id, sl_dat=Decimal("1000"), don_gia=Decimal("300")))
    db.flush()
    d2 = _don(db, "GC26-0002")
    db.add(TgcDonDong(don_id=d2.id, viec_id=v.id, sl_dat=Decimal("1000"), don_gia=Decimal("300")))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()

    # Dòng đã huỷ thì việc được vào đơn mới.
    v = _viec(db, lsx_id=1)
    d1 = _don(db, "GC26-0003")
    db.add(TgcDonDong(don_id=d1.id, viec_id=v.id, sl_dat=Decimal("1000"),
                      huy_luc=datetime(2026, 11, 13, tzinfo=timezone.utc)))
    d2 = _don(db, "GC26-0004")
    db.add(TgcDonDong(don_id=d2.id, viec_id=v.id, sl_dat=Decimal("1000")))
    db.flush()


@pytest.mark.parametrize("nguon", [{}, {"lsx_id": 1, "bai_ghep_id": 1}])
def test_viec_dung_mot_nguon(db, nguon):
    with pytest.raises(IntegrityError):
        _viec(db, **nguon)
    db.rollback()


def test_ma_chung_tu(db):
    sv = SequenceService(DocumentSequenceRepository(db))
    hom_nay = date(2026, 11, 13)
    assert sv.generate_code("tgc_don", at_date=hom_nay) == "GC26-0001"
    assert sv.generate_code("tgc_don", at_date=hom_nay) == "GC26-0002"
    assert sv.generate_code("tgc_phieu_giao", at_date=hom_nay) == "GG26-0001"
    assert sv.generate_code("tgc_phieu_nhan", at_date=hom_nay) == "GN26-0001"


def test_ncc_tu_lo_mac_dinh_true(db):
    # Cột thêm bằng migration phải mang mặc định true ở mức DB (dòng cũ = nhà gia công tự lo).
    cot = {c["name"]: c for c in inspect(engine).get_columns("lsx_cong_doan_vat_tu")}
    mac_dinh = str(cot["ncc_tu_lo"].get("default") or "").lower()
    assert mac_dinh in {"1", "true", "'1'"}, mac_dinh
