"""Phiếu sửa chữa mở lại rồi xong: thời lượng sửa không gồm quãng phiếu đã đóng (lỗi #71) và nhật ký
đổi trạng thái ghi nhãn tiếng Việt chứ không phải mã thô (lỗi #70)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.models.audit import AuditLog
from app.models.ky_thuat_may import (
    LOAI_PHIEU_BAO_TRI,
    LOAI_PHIEU_SUA_CHUA,
    TT_SC_CHO_SUA,
    TT_SC_DA_SUA_XONG,
)
from app.repositories.audit_repo import AuditLogRepository
from app.repositories.ky_thuat_may_repo import KyThuatMayRepository
from app.schemas.ky_thuat_may import SuaChuaRow
from app.services.ky_thuat_may_service import KyThuatMayService
from tests.test_ky_thuat_may import _anh_sau, _may, _svc


def _utc(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _dich_lui(db, phieu, *, thoi_diem_h=None, hoan_thanh_h=None):
    """Lùi mốc về quá khứ để giả lập thời gian trôi (không ngủ thật)."""
    now = datetime.now(timezone.utc)
    if thoi_diem_h is not None:
        phieu.thoi_diem = now - timedelta(hours=thoi_diem_h)
    if hoan_thanh_h is not None:
        phieu.hoan_thanh_at = now - timedelta(hours=hoan_thanh_h)
    db.commit()
    db.refresh(phieu)


def _thoi_luong_giay(phieu) -> float:
    row = SuaChuaRow.model_validate(phieu)
    return (_utc(row.hoan_thanh_at) - _utc(row.thoi_diem)).total_seconds() - row.thoi_gian_dong_giay


def test_mo_lai_roi_xong_thoi_luong_khong_gom_quang_dong():
    db, _ = _svc()
    svc = KyThuatMayService(db, KyThuatMayRepository(db), AuditLogRepository(db))
    may = _may(db, ma="CAN-71")
    phieu = svc.tao_sua_chua({"may_id": may.id, "bo_phan_hong": "Trục cán"})
    _anh_sau(svc, LOAI_PHIEU_SUA_CHUA, phieu.id)
    assert phieu.thoi_gian_dong_giay == 0

    # Hỏng lúc 20 giờ trước, xong lần 1 lúc 18 giờ trước (sửa 2 giờ).
    _dich_lui(db, phieu, thoi_diem_h=20)
    svc.doi_trang_thai_sua_chua(phieu.id, TT_SC_DA_SUA_XONG)
    _dich_lui(db, phieu, hoan_thanh_h=18)

    # Mở lại BÂY GIỜ ⇒ phiếu đã đóng 18 giờ.
    phieu = svc.doi_trang_thai_sua_chua(phieu.id, TT_SC_CHO_SUA, ly_do="Máy kẹt lại")
    assert phieu.hoan_thanh_at is None
    assert abs(phieu.thoi_gian_dong_giay - 18 * 3600) < 60

    # Xong lần 2 ngay bây giờ: tổng 20 giờ kể từ lúc hỏng, trừ 18 giờ đóng ⇒ 2 giờ.
    phieu = svc.doi_trang_thai_sua_chua(phieu.id, TT_SC_DA_SUA_XONG)
    assert abs(_thoi_luong_giay(phieu) - 2 * 3600) < 120


def test_mo_lai_nhieu_lan_cong_don_quang_dong():
    db, _ = _svc()
    svc = KyThuatMayService(db, KyThuatMayRepository(db), AuditLogRepository(db))
    may = _may(db, ma="CAN-72")
    phieu = svc.tao_sua_chua({"may_id": may.id, "bo_phan_hong": "Trục cán"})
    _anh_sau(svc, LOAI_PHIEU_SUA_CHUA, phieu.id)
    _dich_lui(db, phieu, thoi_diem_h=30)
    for dong_h in (10, 5):
        svc.doi_trang_thai_sua_chua(phieu.id, TT_SC_DA_SUA_XONG)
        _dich_lui(db, phieu, hoan_thanh_h=dong_h)
        phieu = svc.doi_trang_thai_sua_chua(phieu.id, TT_SC_CHO_SUA, ly_do="Lại hỏng")
    # Đóng 10 giờ ở lần 1 rồi mở lại; lần 2 đóng 5 giờ (mốc đóng mới đặt lại = 5 giờ trước).
    assert abs(phieu.thoi_gian_dong_giay - 15 * 3600) < 120


def test_nhat_ky_doi_trang_thai_ghi_nhan_tieng_viet():
    db, _ = _svc()
    svc = KyThuatMayService(db, KyThuatMayRepository(db), AuditLogRepository(db))
    may = _may(db, ma="CAN-70")
    phieu = svc.tao_sua_chua({"may_id": may.id, "bo_phan_hong": "Trục cán"})
    _anh_sau(svc, LOAI_PHIEU_SUA_CHUA, phieu.id)
    svc.doi_trang_thai_sua_chua(phieu.id, TT_SC_DA_SUA_XONG)
    vet = " | ".join(a.detail or "" for a in db.query(AuditLog).all())
    assert "da_sua_xong" not in vet
    assert "Đã sửa xong" in vet
