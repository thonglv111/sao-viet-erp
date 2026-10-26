"""Vật tư tự lập khi phát hành (bấm thử 25/10/2026): bước khai vật tư mà định mức ra 0 vẫn chờ tổ
tự xin (L-SX-15); lệnh thu hồi chặn xuất tiếp yêu cầu đã xuất một phần (L-SX-14)."""
from __future__ import annotations

from tests.test_vat_tu_tu_lap import (  # noqa: F401
    _MOC, _buoc_in, _cv_cua_buoc, _dns, _them_buoc, _them_vat_tu, admin, customer, db, lenh,
    lsx_svc, orders, svc3,
)


def test_buoc_vat_tu_ra_0_bat_cho_vat_tu_khong_lap_yeu_cau(db, svc3, lenh, admin):
    in_ = _buoc_in(db, lenh.id)
    sau = _them_buoc(db, lenh.id, ten="Cán màng định mức 0", thu_tu=int(in_.thu_tu or 0) + 1)
    _them_vat_tu(db, sau, ma="MANG-0", so_luong=0)
    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)

    cv = _cv_cua_buoc(db, sau.id)
    assert cv.can_vat_tu is True
    assert _dns(db, cv.id) == []


def test_thu_hoi_chan_lap_phieu_tiep_yeu_cau_da_xuat_mot_phan(db, svc3, lenh, admin):
    """L-SX-14: yêu cầu đã xuất một phần của lệnh bị thu hồi ⇒ không lập phiếu mới, không ghi sổ
    phiếu nháp còn sống; phát hành lại thì hết chặn."""
    import pytest

    from app.models.stock_request import REQ_PARTIAL, StockRequest
    from app.models.stock_voucher import StockVoucher
    from app.repositories.san_xuat_vat_tu_repo import SanXuatVatTuRepository
    from app.routers.kho_voucher import get_service
    from app.services.stock_voucher_service import StockVoucherError
    from tests.test_vat_tu_tu_lap import _phieu, _req_cua, _thu_hoi

    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    (req,) = _req_cua(db, _cv_cua_buoc(db, _buoc_in(db, lenh.id).id))
    _phieu(db, req, "posted")
    _phieu(db, req, "draft")
    req.trang_thai = REQ_PARTIAL
    db.commit()

    _thu_hoi(svc3, lenh.id, admin)
    assert db.get(StockRequest, req.id).trang_thai == REQ_PARTIAL
    nhap = db.query(StockVoucher).filter_by(request_id=req.id, trang_thai="draft").one()
    with pytest.raises(StockVoucherError, match="thu hồi"):
        get_service(db).create(user=admin, request_id=req.id, kho_id=1, lines=[])
    with pytest.raises(StockVoucherError, match="thu hồi"):
        get_service(db).post(nhap.id, admin)
    assert SanXuatVatTuRepository(db).boi_canh_san_xuat([req.id])[req.id]["lenh_thu_hoi"] is True

    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    assert SanXuatVatTuRepository(db).yeu_cau_cua_lenh_thu_hoi(req.id) is False
    assert SanXuatVatTuRepository(db).boi_canh_san_xuat([req.id])[req.id]["lenh_thu_hoi"] is False
