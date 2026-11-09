"""Tiền đã thu của đơn thương mại (docs/design-hang-thuong-mai-ha-phuong.md §6 "Cọc và thu tiền").

Đơn thương mại thu tiền theo đơn bất kỳ lúc nào, không chỉ phần cọc: chặng "Thu tiền" của ngăn đơn và
trang Tạo đơn (khách trả ngay) đều lập phiếu thu theo đơn. Phiếu không được vượt phần đơn còn thiếu.
"""
from __future__ import annotations

from ...models.accounting import SALES_INVOICE_ISSUED


def tien_da_thu(accounting_repo, order_id: int) -> int:
    """Tiền khách đã đưa cho đơn: quỹ tiền của đơn (cọc + thu của hoá đơn đã huỷ − đã trả lại) cộng
    tiền thu đích danh trên hoá đơn còn hiệu lực của đơn. Cùng phép tính quỹ cấn vào công nợ."""
    from ..accounting_service import quy_tien_don

    quy = quy_tien_don(accounting_repo, [order_id]).get(order_id, 0)
    hd = [i.id for i in accounting_repo.list_sales_invoices(order_id=order_id)
          if i.status == SALES_INVOICE_ISSUED]
    return quy + sum(accounting_repo.received_invoice_receipt_sums(hd).values())


def con_thieu(accounting_repo, order_id: int, tong_gom_vat: int) -> int:
    return max(0, int(tong_gom_vat or 0) - tien_da_thu(accounting_repo, order_id))


def chan_thu_vuot(accounting_repo, order_id: int, tong_gom_vat: int, so_tien: int) -> None:
    """Phiếu thu theo đơn thương mại không được vượt phần đơn còn thiếu."""
    from ..order_service import OrderValidationError
    from ..dinh_dang import so_vn

    con = con_thieu(accounting_repo, order_id, tong_gom_vat)
    if int(so_tien or 0) > con:
        raise OrderValidationError(
            f"Số tiền thu vượt phần đơn còn thiếu ({so_vn(con)} đ)." if con > 0
            else "Đơn đã thu đủ tiền, không lập thêm phiếu thu.")
