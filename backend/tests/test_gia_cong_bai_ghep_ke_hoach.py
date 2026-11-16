"""Bước CHUNG thuê ngoài của bài ghép — lập kế hoạch.

Từ 13/11/2026 (module Thuê gia công) bài ghép KHÔNG chọn nhà gia công: nhà gia công chọn lúc lập
đơn ở màn Thuê gia công. Bước chung thuê ngoài gỡ tổ/máy, bỏ qua `nha_cung_cap_id`, không "Còn
thiếu" vì thiếu nhà; xoá bài dọn việc thuê gia công chưa đặt, chặn việc đã nằm trong đơn.
"""
from __future__ import annotations

import pytest

from datetime import date

from app.models.thue_gia_cong import KIEU_MOT_PHAN, TgcDon, TgcDonDong, TgcNhaGiaCong, TgcViec
from app.models.lsx import LB_THUE_NGOAI, LsxCongDoan
from app.services.bai_ghep_service import BaiGhepValidationError
from tests.test_bai_ghep_service import (  # noqa: F401
    _hai_lsx_san_sang, admin, bg_svc, customer, db, lsx_svc, orders,
)


def _ncc(db, ten="Cán màng Tân Phát", nhan=True) -> TgcNhaGiaCong:
    s = TgcNhaGiaCong(ten=ten, active=nhan)
    db.add(s)
    db.commit()
    return s


def _buoc_in(db, lsx_id) -> LsxCongDoan:
    return (db.query(LsxCongDoan).filter(LsxCongDoan.lsx_id == lsx_id)
            .order_by(LsxCongDoan.thu_tu).first())


@pytest.fixture
def bai(db, orders, lsx_svc, bg_svc, admin, customer):
    a, b = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)
    bg = bg_svc.tao(lsx_ids=[a.id, b.id], actor=admin)
    return bg, a, b


def _gop(db, bg_svc, admin, bg, a, b):
    bg_svc.gop(bai_ghep_id=bg.id, actor=admin,
               step_keys=[_buoc_in(db, a.id).step_key, _buoc_in(db, b.id).step_key])
    (c,) = bg_svc._buoc_chungs(bg_svc._get(bg.id))
    return c


def test_buoc_chung_thue_ngoai_go_to_may_bo_qua_nha_gia_cong(db, bg_svc, admin, bai):
    bg, a, b = bai
    c = _gop(db, bg_svc, admin, bg, a, b)
    s = _ncc(db)
    bg_svc.lap_ke_hoach_buoc_chung(
        bai_ghep_id=bg.id, gang_step_key=c.step_key, actor=admin,
        patch={"loai_buoc": LB_THUE_NGOAI, "nha_cung_cap_id": s.id, "department_id": 1},
    )
    db.refresh(c)
    assert not hasattr(c, "nha_cung_cap_id") and not hasattr(c, "nha_cung_cap")
    assert c.department_id is None and c.may_id is None


def test_thue_ngoai_khong_con_thieu_nha_gia_cong(db, bg_svc, admin, bai):
    bg, a, b = bai
    c = _gop(db, bg_svc, admin, bg, a, b)
    bg_svc.lap_ke_hoach_buoc_chung(bai_ghep_id=bg.id, gang_step_key=c.step_key, actor=admin,
                                   patch={"loai_buoc": LB_THUE_NGOAI})
    db.refresh(c)
    assert bg_svc._thieu_buoc_chung(c) == []


def test_gop_khong_chep_nha_gia_cong(db, bg_svc, admin, bai):
    bg, a, b = bai
    for l in (a, b):
        _buoc_in(db, l.id).loai_buoc = LB_THUE_NGOAI
    db.commit()
    c = _gop(db, bg_svc, admin, bg, a, b)
    assert c.loai_buoc == LB_THUE_NGOAI


def test_xoa_bai_don_viec_chua_dat(db, bg_svc, admin, bai):
    bg, _a, _b = bai
    db.add(TgcViec(kieu=KIEU_MOT_PHAN, bai_ghep_id=bg.id, ten_viec="Cán màng"))
    db.commit()
    bg_svc.xoa(bai_ghep_id=bg.id, actor=admin)
    assert db.query(TgcViec).filter_by(bai_ghep_id=bg.id).count() == 0


def test_xoa_bai_chan_viec_da_dat(db, bg_svc, admin, bai):
    bg, _a, _b = bai
    v = TgcViec(kieu=KIEU_MOT_PHAN, bai_ghep_id=bg.id, ten_viec="Cán màng")
    s = _ncc(db)
    don = TgcDon(ma="GC26-9201", nha_cung_cap_id=s.id, nha_cung_cap_ten=s.ten, ngay_dat=date.today())
    db.add_all([v, don])
    db.flush()
    db.add(TgcDonDong(don_id=don.id, viec_id=v.id, sl_dat=100, don_gia=0))
    db.commit()
    with pytest.raises(BaiGhepValidationError, match="GC26-9201"):
        bg_svc.xoa(bai_ghep_id=bg.id, actor=admin)
