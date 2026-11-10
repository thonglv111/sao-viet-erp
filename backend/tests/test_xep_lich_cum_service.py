"""Xếp lịch — trải THEO CỤM ở lớp service (mục 5b + 7 mockup `xep-lich-A-cai-tien.html`, 08/10/2026).

Hai lệnh thật (đơn → lệnh → sẵn sàng), nối một cạnh phụ thuộc chéo: bước ĐẦU của lệnh B đợi bước
CUỐI của lệnh A. Cả hai đặt cùng một mốc ⇒ B phải đứng chờ tới lúc A xong.
"""
from __future__ import annotations

from datetime import datetime

import pytest

from app.models.lsx import LsxCongDoan, LsxCongDoanPhuThuoc
from app.repositories.audit_repo import AuditLogRepository
from app.repositories.xep_lich_lenh_repo import XepLichLenhRepository
from app.services.xep_lich import XepLichLenhService

from tests.test_xep_lich_service import (  # noqa: F401
    _hai_lsx_san_sang,
    _khai_giay_len_buoc_in,
    admin,
    customer,
    db,
    lsx_svc,
    orders,
)

MOC = datetime(2026, 9, 11, 8, 0)


@pytest.fixture
def svc3(db):
    return XepLichLenhService(db, XepLichLenhRepository(db), AuditLogRepository(db))


def _buoc(db, lsx_id):
    return list(db.query(LsxCongDoan).filter(LsxCongDoan.lsx_id == lsx_id)
                .order_by(LsxCongDoan.thu_tu, LsxCongDoan.id))


@pytest.fixture
def cap(db, orders, lsx_svc, admin, customer):
    """(A, B, bước cuối A, bước đầu B) — B.đầu đợi A.cuối."""
    a, b = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)
    for l in (a, b):
        _khai_giay_len_buoc_in(db, l.id)
    cuoi_a, dau_b = _buoc(db, a.id)[-1], _buoc(db, b.id)[0]
    db.add(LsxCongDoanPhuThuoc(buoc_truoc_id=cuoi_a.id, buoc_sau_id=dau_b.id))
    db.commit()
    return a, b, cuoi_a, dau_b


def test_cum_lien_thong_chia_dung_cum(db, cap):
    a, b, *_ = cap
    cum = XepLichLenhRepository(db).cum_lien_thong([a.id])
    assert {a.id, b.id} in cum


def test_lenh_kia_chua_xep_thi_khong_cho(svc3, cap):
    a, b, _cuoi_a, dau_b = cap
    svc3.dat_moc(b.id, MOC)
    ct = svc3.chi_tiet(b.id)
    assert ct["cho_phut"] == 0
    buoc = {c["id"]: c for c in ct["cong_doans"]}[dau_b.id]
    assert buoc["lien"] and buoc["lien"][0]["luc_khac"] is None


