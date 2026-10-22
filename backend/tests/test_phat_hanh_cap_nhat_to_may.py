"""Phát hành cập nhật đưa TỔ + MÁY của bước kế hoạch xuống việc chưa bắt đầu (spec máy thuộc tổ §4.8).

Lỗ trước 22/10/2026: lệnh xếp ở bàn Xếp lịch cấp lệnh không có dòng `xep_lich_cong_doan`, nên máy
lấy từ lịch luôn None và tổ thì không dòng nào chép — người kế hoạch đổi bước In sang tổ 4 màu, máy
IN-02, bấm cập nhật mà bàn tổ vẫn y như cũ.
"""
from __future__ import annotations

from app.models.department import Department
from app.models.lsx import LsxCongDoan
from app.models.may_thiet_bi import MayThietBi, MayTo
from app.models.san_xuat import BUOC_MAY, SanXuatCongViec
from app.models.xep_lich import XepLichCongDoan
from app.services.san_xuat import release, release_update

from tests.test_xep_lich_service import (  # noqa: F401
    _hai_lsx_san_sang,
    admin,
    bg_svc,
    customer,
    db,
    lsx_svc,
    orders,
    xl_svc,
)


def _phat_hanh_cap_lenh(db, orders, lsx_svc, xl_svc, admin, customer):
    """Lệnh đã phát hành, lịch kiểu CẤP LỆNH (không dòng `xep_lich_cong_doan`)."""
    a, _b = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)
    xl_svc.dua_vao_lsx(lsx_id=a.id, actor=admin)
    goi = release.phat_hanh(db, lsx_ids={a.id}, actor=admin)
    db.commit()
    buoc_ids = [c.id for c in db.query(LsxCongDoan).filter_by(lsx_id=a.id)]
    db.query(XepLichCongDoan).filter(XepLichCongDoan.lsx_cong_doan_id.in_(buoc_ids)).delete()
    db.commit()
    return a, goi


def _to_may(db, ma: str):
    to = Department(name=f"Tổ {ma}", code=f"T-{ma}", la_san_xuat=True)
    db.add(to)
    db.flush()
    may = MayThietBi(ma=ma, ten=f"Máy {ma}", loai_may="Máy in", active=True)
    db.add(may)
    db.flush()
    db.add(MayTo(may_id=may.id, department_id=to.id))
    db.flush()
    return to.id, may.id


def test_cap_nhat_dua_to_va_may_cua_buoc_xuong_viec(db, orders, lsx_svc, xl_svc, admin, customer):
    a, goi = _phat_hanh_cap_lenh(db, orders, lsx_svc, xl_svc, admin, customer)
    cvs = [cv for cv in db.query(SanXuatCongViec).filter_by(goi_id=goi.id)
           if cv.loai_buoc == BUOC_MAY and cv.lsx_cong_doan_id and cv.gia_cong_ngoai_id is None]
    assert cvs, "cần ít nhất một việc máy để soi"
    doi = {}
    for i, cv in enumerate(cvs):
        to, may = _to_may(db, f"MX{i}")
        buoc = db.get(LsxCongDoan, cv.lsx_cong_doan_id)
        buoc.department_id, buoc.may_id = to, may
        doi[cv.id] = (to, may)
    db.commit()

    release_update.phat_hanh_cap_nhat(db, nguon="lsx", id=a.id, ly_do="Đổi tổ máy", actor=admin)

    for cv_id, (to, may) in doi.items():
        cv = db.get(SanXuatCongViec, cv_id)
        db.refresh(cv)
        assert (cv.department_id, cv.may_id) == (to, may)
