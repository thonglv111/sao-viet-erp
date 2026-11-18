"""Thành phẩm chỉ vào / ra Kho thành phẩm (12/10/2026, `services/kho_thanh_pham`).

KCS cuối gửi kho ⇒ đề nghị nhập gắn sẵn `KHO-TP`; phiếu nhập thành phẩm vào kho khác bị chặn; thành
phẩm không điều chuyển ra khỏi Kho thành phẩm được, nhưng hàng còn sót ở kho khác vẫn chuyển VỀ được.
"""
from __future__ import annotations

import pytest

from app.models.kho_hang import MA_KHO_THANH_PHAM, KhoHang
from app.models.stock_lot import StockLot
from app.models.stock_request import StockRequest
from app.routers.kho_voucher import get_service as voucher_service
from app.services.stock_voucher_service import StockVoucherError
from tests.test_kho_lo_goc import _kho
from tests.test_san_xuat_kcs import (  # noqa: F401
    _batch,
    admin,
    customer,
    db,
    lsx_svc,
    orders,
)
from tests.test_san_xuat_nhap_kho_tp import _gui, _nhan


def test_kcs_gui_kho_vao_KHO_TP_va_chan_nhap_kho_khac(db, orders, lsx_svc, admin, customer):
    _to, cv, rb = _batch(db, orders, lsx_svc, admin, customer, dat=90, khong_dat=0, cuoi=True)
    r = _gui(db, cv, rb)
    req = db.get(StockRequest, r["request_id"])
    assert db.get(KhoHang, req.kho_id).ma == MA_KHO_THANH_PHAM

    khac = _kho(db, "KHO-KHAC")
    [ln] = req.lines
    with pytest.raises(StockVoucherError, match="chỉ nhập vào Kho thành phẩm"):
        voucher_service(db).create(user=admin, request_id=req.id, kho_id=khac.id,
                                   lines=[{"request_line_id": ln.id, "so_luong": 90}])
    db.rollback()
    _nhan(db, admin, req.id, 90)                      # vào Kho thành phẩm thì được


def test_khong_dieu_chuyen_thanh_pham_ra_khoi_KHO_TP_nhung_chuyen_ve_duoc(
        db, orders, lsx_svc, admin, customer):
    _to, cv, rb = _batch(db, orders, lsx_svc, admin, customer, dat=90, khong_dat=0, cuoi=True)
    r = _gui(db, cv, rb)
    _nhan(db, admin, r["request_id"], 90)
    tp, khac = _kho(db, MA_KHO_THANH_PHAM), _kho(db, "KHO-KHAC")
    hang_id = db.get(StockRequest, r["request_id"]).lines[0].hang_id
    svc = voucher_service(db)
    with pytest.raises(StockVoucherError, match="không điều chuyển sang kho khác"):
        svc.dieu_chuyen(user=admin, kho_nguon_id=tp.id, kho_den_id=khac.id,
                        items=[{"hang_loai": "vat_tu", "hang_id": hang_id, "so_luong": 30}])
    db.rollback()

    # Hàng còn sót ở kho khác (dữ liệu trước ngày luật) ⇒ chuyển VỀ Kho thành phẩm được.
    [lo] = db.query(StockLot).filter_by(kho_id=tp.id, hang_loai="vat_tu", hang_id=hang_id).all()
    lo.kho_id = khac.id
    db.commit()
    res = svc.dieu_chuyen(user=admin, kho_nguon_id=khac.id, kho_den_id=tp.id,
                          items=[{"hang_loai": "vat_tu", "hang_id": hang_id, "so_luong": 30}])
    assert res["phieu_nhap"].kho_id == tp.id


def test_ha_phuong_bat_chuyen_kho_tp_thi_chuyen_ra_cua_hang_va_xuat_tu_do(
        db, orders, lsx_svc, admin, customer, monkeypatch):
    """Cờ `chuyen_kho_tp` (chỉ In Hà Phương): thành phẩm chuyển KHO-TP → kho khác và ngược lại được;
    nhập thường từ sản xuất vẫn chỉ vào Kho thành phẩm."""
    from app.config import settings
    monkeypatch.setattr(settings, "phan_he_bat", "chuyen_kho_tp")
    _to, cv, rb = _batch(db, orders, lsx_svc, admin, customer, dat=90, khong_dat=0, cuoi=True)
    r = _gui(db, cv, rb)
    req = db.get(StockRequest, r["request_id"])
    khac = _kho(db, "CUA-HANG")
    [ln] = req.lines
    with pytest.raises(StockVoucherError, match="chỉ nhập vào Kho thành phẩm"):
        voucher_service(db).create(user=admin, request_id=req.id, kho_id=khac.id,
                                   lines=[{"request_line_id": ln.id, "so_luong": 90}])
    db.rollback()
    _nhan(db, admin, req.id, 90)
    tp = _kho(db, MA_KHO_THANH_PHAM)
    svc = voucher_service(db)
    di = svc.dieu_chuyen(user=admin, kho_nguon_id=tp.id, kho_den_id=khac.id,
                         items=[{"hang_loai": "vat_tu", "hang_id": ln.hang_id, "so_luong": 30}])
    assert di["phieu_nhap"].kho_id == khac.id
    ve = svc.dieu_chuyen(user=admin, kho_nguon_id=khac.id, kho_den_id=tp.id,
                         items=[{"hang_loai": "vat_tu", "hang_id": ln.hang_id, "so_luong": 10}])
    assert ve["phieu_nhap"].kho_id == tp.id
