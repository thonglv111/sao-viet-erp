"""Đợt 2 — lần ghi chụp TUỲ CHỌN KHI GHI của công đoạn, Sửa số đổi được tuỳ chọn (21/10/2026).

Spec: `docs/superpowers/specs/2026-10-20-hai-luong-khoi-san-xuat-design.md` mục "Đợt 2"."""
from __future__ import annotations

from datetime import timedelta

import pytest

from app.models.cong_doan import CongDoanKhoan
from app.models.san_xuat_san_luong import SanXuatBatch
from app.services.san_xuat import san_luong
from tests.san_xuat_me_fixtures import T0
from tests.test_san_xuat_cong_doan_khoan import _cong_doan, _cv_chay
from tests.test_san_xuat_thuc_thi import (  # noqa: F401
    admin,
    customer,
    db,
    lsx_svc,
    orders,
)

TUY_CHON = [{"ma": "kem_be_noi", "ten": "Kèm bế nổi", "kieu": "co_khong", "goi_y": None},
            {"ma": "so_lo", "ten": "Số lỗ đục", "kieu": "so", "goi_y": None}]


def _canh(db, orders, lsx_svc, admin, customer, ma):
    cv = _cv_chay(db, orders, lsx_svc, admin, customer, ma=ma)
    db.add(CongDoanKhoan(cong_doan_id=_cong_doan(db, cv).id, unit="to", unit_price=120,
                         gia_co_dinh=150_000, tuy_chon=TUY_CHON))
    db.commit()
    return cv


def _ghi(db, admin, cv, **kw) -> SanXuatBatch:
    r = san_luong.tao_batch(db, user=admin, cong_viec_id=cv.id, bat_dau=T0,
                            ket_thuc=T0 + timedelta(hours=1), tong=100, tot=100, **kw)
    return db.get(SanXuatBatch, r["batch_id"])


def test_ghi_luu_anh_chup_tuy_chon(db, orders, lsx_svc, admin, customer):
    cv = _canh(db, orders, lsx_svc, admin, customer, "TO-D2-LG1")
    b = _ghi(db, admin, cv, tuy_chon={"kem_be_noi": 1, "so_lo": 3})
    assert b.tuy_chon_khoan == [
        {"ma": "kem_be_noi", "ten": "Kèm bế nổi", "kieu": "co_khong", "gia_tri": 1.0},
        {"ma": "so_lo", "ten": "Số lỗ đục", "kieu": "so", "gia_tri": 3.0},
    ]
    assert float(b.gia_co_dinh_khoan_snapshot) == 150_000


def test_ghi_khong_gui_tuy_chon_mac_dinh_0(db, orders, lsx_svc, admin, customer):
    cv = _canh(db, orders, lsx_svc, admin, customer, "TO-D2-LG2")
    b = _ghi(db, admin, cv)
    assert [t["gia_tri"] for t in b.tuy_chon_khoan] == [0.0, 0.0]


def test_ghi_tuy_chon_la_bi_chan(db, orders, lsx_svc, admin, customer):
    cv = _canh(db, orders, lsx_svc, admin, customer, "TO-D2-LG3")
    with pytest.raises(ValueError, match="xa_doi"):
        _ghi(db, admin, cv, tuy_chon={"xa_doi": 1})
    db.rollback()
    with pytest.raises(ValueError):
        _ghi(db, admin, cv, tuy_chon={"so_lo": -2})


def test_sua_so_chi_doi_tuy_chon(db, orders, lsx_svc, admin, customer):
    cv = _canh(db, orders, lsx_svc, admin, customer, "TO-D2-LG4")
    b = _ghi(db, admin, cv, tuy_chon={"kem_be_noi": 1, "so_lo": 3})
    v = b.version
    san_luong.sua_so_me(db, user=admin, batch_id=b.id, tot=100, tuy_chon={"kem_be_noi": 0, "so_lo": 3},
                        expected_version=v)
    db.refresh(b)
    assert [t["gia_tri"] for t in b.tuy_chon_khoan] == [0.0, 3.0]
    assert b.version == v + 1
    # Tuỳ chọn giữ nguyên + số giữ nguyên ⇒ vẫn báo trùng như trước.
    with pytest.raises(ValueError, match="trùng"):
        san_luong.sua_so_me(db, user=admin, batch_id=b.id, tot=100,
                            tuy_chon={"kem_be_noi": 0, "so_lo": 3})
    db.rollback()
    # Đổi số kèm tuỳ chọn cùng lúc.
    san_luong.sua_so_me(db, user=admin, batch_id=b.id, tot=90, tuy_chon={"kem_be_noi": 1})
    db.refresh(b)
    assert float(b.tot) == 90 and [t["gia_tri"] for t in b.tuy_chon_khoan] == [1.0, 0.0]


def test_ngan_chi_tiet_tra_tuy_chon_khai_va_anh_chup(db, orders, lsx_svc, admin, customer):
    """Qua đúng schema của route — field khai thiếu là Pydantic nuốt im lặng."""
    from app.repositories.rbac_repo import RoleRepository
    from app.schemas.san_xuat import WorkItemChiTietOut
    from app.services.rbac_service import AuthorizationService
    from app.services.san_xuat import board

    cv = _canh(db, orders, lsx_svc, admin, customer, "TO-D2-LG5")
    _ghi(db, admin, cv, tuy_chon={"so_lo": 3})
    d = WorkItemChiTietOut.model_validate(
        board.chi_tiet_cong_viec(db, admin, AuthorizationService(RoleRepository(db)), cong_viec_id=cv.id))
    assert [t.ma for t in d.khoan.tuy_chon] == ["kem_be_noi", "so_lo"]
    assert d.khoan.gia_co_dinh == 150_000
    assert [(t.ma, t.gia_tri) for t in d.san_luong.batches[0].tuy_chon_khoan] == [
        ("kem_be_noi", 0.0), ("so_lo", 3.0)]
