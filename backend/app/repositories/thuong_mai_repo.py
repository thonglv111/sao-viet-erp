"""Truy vấn của lượt xuất đơn thương mại — chỉ In Hà Phương (docs/design-hang-thuong-mai-ha-phuong.md)."""
from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.accounting import SALES_INVOICE_ISSUED, SalesInvoice
from ..models.stock_lot import StockLot
from ..models.stock_voucher import VOUCHER_POSTED, VOUCHER_XUAT, StockVoucher, StockVoucherLine
from ..models.thuong_mai import LXTM_DA_XUAT, LXTM_HUY, LuotXuatThuongMai, LuotXuatThuongMaiDong


class ThuongMaiRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def luot_cua_don(self, order_id: int, *, chi_da_xuat: bool = False) -> list[LuotXuatThuongMai]:
        q = self.db.query(LuotXuatThuongMai).filter(LuotXuatThuongMai.order_id == order_id)
        if chi_da_xuat:
            q = q.filter(LuotXuatThuongMai.trang_thai == LXTM_DA_XUAT).order_by(
                LuotXuatThuongMai.xuat_luc, LuotXuatThuongMai.id)
        else:
            q = q.order_by(LuotXuatThuongMai.id)
        return q.all()

    def dem_luot(self, order_id: int) -> int:
        return int(self.db.query(func.count(LuotXuatThuongMai.id))
                   .filter(LuotXuatThuongMai.order_id == order_id).scalar() or 0)

    def da_dung_theo_dong(self, order_id: int) -> dict[int, int]:
        """SL đã xuất hoặc đang chờ xuất của từng dòng đơn (lượt huỷ không tính). Lượt đã xuất tính SL
        THỰC xuất, lượt chờ tính SL đã xin."""
        rows = (
            self.db.query(LuotXuatThuongMaiDong.order_line_id, LuotXuatThuongMai.trang_thai,
                          LuotXuatThuongMaiDong.qty, LuotXuatThuongMaiDong.qty_thuc)
            .join(LuotXuatThuongMai, LuotXuatThuongMai.id == LuotXuatThuongMaiDong.luot_id)
            .filter(LuotXuatThuongMai.order_id == order_id, LuotXuatThuongMai.trang_thai != LXTM_HUY)
            .all()
        )
        ra: dict[int, int] = {}
        for ol_id, tt, qty, thuc in rows:
            so = (thuc or 0) if tt == LXTM_DA_XUAT else (qty or 0)
            ra[ol_id] = ra.get(ol_id, 0) + int(so)
        return ra

    def da_xuat_theo_dong(self, order_ids: list[int]) -> dict[int, int]:
        """SL THỰC đã xuất của từng dòng đơn (chỉ lượt `da_xuat`) — "đã giao" của đơn thương mại."""
        if not order_ids:
            return {}
        rows = (
            self.db.query(LuotXuatThuongMaiDong.order_line_id,
                          func.coalesce(func.sum(LuotXuatThuongMaiDong.qty_thuc), 0))
            .join(LuotXuatThuongMai, LuotXuatThuongMai.id == LuotXuatThuongMaiDong.luot_id)
            .filter(LuotXuatThuongMai.order_id.in_(order_ids), LuotXuatThuongMai.trang_thai == LXTM_DA_XUAT)
            .group_by(LuotXuatThuongMaiDong.order_line_id)
            .all()
        )
        return {int(a): int(b or 0) for a, b in rows}

    def gia_von_theo_dong_yeu_cau(self, request_id: int) -> dict[int, int]:
        """{dòng yêu cầu: Σ (SL gốc xuất × đơn giá nhập của lô)} qua các phiếu XUẤT đã ghi sổ."""
        rows = (
            self.db.query(StockVoucherLine.request_line_id,
                          func.sum(StockVoucherLine.sl_goc * func.coalesce(StockLot.don_gia_nhap, 0)))
            .join(StockVoucher, StockVoucher.id == StockVoucherLine.voucher_id)
            .join(StockLot, StockLot.id == StockVoucherLine.lot_id)
            .filter(StockVoucher.request_id == request_id, StockVoucher.loai == VOUCHER_XUAT,
                    StockVoucher.trang_thai == VOUCHER_POSTED)
            .group_by(StockVoucherLine.request_line_id)
            .all()
        )
        return {int(a): int(round(float(b or 0))) for a, b in rows}

    def tong_gia_von_dong_don(self, order_line_id: int) -> int | None:
        tong = (self.db.query(func.sum(LuotXuatThuongMaiDong.gia_von))
                .join(LuotXuatThuongMai, LuotXuatThuongMai.id == LuotXuatThuongMaiDong.luot_id)
                .filter(LuotXuatThuongMaiDong.order_line_id == order_line_id,
                        LuotXuatThuongMai.trang_thai == LXTM_DA_XUAT).scalar())
        return int(tong) if tong is not None else None

    def hoa_don_da_ghi_theo_luot(self, order_id: int) -> dict[int, int]:
        """{lượt xuất: Σ tiền hoá đơn còn hiệu lực đã ghi theo lượt đó}."""
        rows = (
            self.db.query(SalesInvoice.luot_xuat_tm_id, func.sum(SalesInvoice.amount_vnd))
            .filter(SalesInvoice.order_id == order_id, SalesInvoice.status == SALES_INVOICE_ISSUED,
                    SalesInvoice.luot_xuat_tm_id.isnot(None))
            .group_by(SalesInvoice.luot_xuat_tm_id)
            .all()
        )
        return {int(a): int(b or 0) for a, b in rows}
