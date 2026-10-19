"""Hàng đã nhận đủ mà chưa nhập kho vẫn là hàng ĐANG VỀ của kế hoạch vật tư (lỗi #57 bấm lại 19/10/2026).

DMH-261017-SK10 nhận đủ 1.575 tờ cho LSX26-0008, đang "Chờ gửi kho": tồn chưa cộng (kho chưa nhập),
mà bảng cân đối cũng thôi coi là đang về (phiếu đã `received`) ⇒ "Cần mua 1.575, Phiếu mua —", nút
Đề nghị mua còn mở và mua được lần hai. Tồn chỉ tăng khi yêu cầu nhập của đợt giao xong.
"""
from __future__ import annotations

from datetime import date

from app.models.purchase import PR_RECEIVED, PurchaseDelivery, PurchaseDeliveryLine
from app.models.stock_request import REQ_DONE, REQ_NHAP, StockRequest
from tests.test_ke_hoach_vat_tu import (  # noqa: F401
    HOM_NAY, MAI, _giay, _lenh, _nhom, _phieu_mua, _ton, customer, db, svc,
)


def _nhan_du(db, p, *, nhap_xong: bool = False):
    ln = p.lines[0]
    d = PurchaseDelivery(purchase_request_id=p.id, seq_no=1, delivery_date=HOM_NAY)
    db.add(d)
    db.flush()
    db.add(PurchaseDeliveryLine(delivery_id=d.id, purchase_request_line_id=ln.id,
                                quantity=ln.quantity))
    if nhap_xong:
        db.add(StockRequest(ma=f"NK-{d.id}", loai=REQ_NHAP, nguoi_tao_id=1, trang_thai=REQ_DONE,
                            purchase_delivery_id=d.id))
    db.commit()


def test_nhan_du_chua_nhap_kho_van_la_dang_ve(db, svc, customer):
    g = _giay(db)
    p = _phieu_mua(db, hang=("giay", g.id), so_luong=1_000, ngay_ve=HOM_NAY, status=PR_RECEIVED)
    _nhan_du(db, p)
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)

    dong = next(d for d in _nhom(svc.can_doi(), g)["dong"] if d["ma"] == "LSX-A")
    assert dong["trang_thai"] == "vang"
    assert dong["thieu"] == 0


def test_nhap_kho_xong_thi_khong_dem_hai_lan(db, svc, customer):
    g = _giay(db)
    p = _phieu_mua(db, hang=("giay", g.id), so_luong=1_000, ngay_ve=HOM_NAY, status=PR_RECEIVED)
    _nhan_du(db, p, nhap_xong=True)
    _ton(db, g, 1_000)
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=1_000, han=date(2099, 1, 1))

    dong = {d["ma"]: d for d in _nhom(svc.can_doi(), g)["dong"]}
    assert dong["LSX-A"]["thieu"] == 0
    assert dong["LSX-B"]["thieu"] > 0      # 1.000 tờ đã vào tồn, không còn là "đang về" nữa
