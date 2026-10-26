"""Chứng từ công nợ có ngày trong kỳ ĐÃ KHOÁ thì không lập, sửa, huỷ được (#46, 18/10/2026).

Trước đó khoá kỳ chỉ là một bản ghi: `is_locked` viết sẵn mà không ai gọi, kỳ phải thu đã chốt vẫn
nhận phiếu thu mới và cho huỷ phiếu cũ — số "đã chốt" đổi được bất cứ lúc nào.

Mọi lần ghi chứng từ công nợ trong `AccountingService` đều đi qua bốn hàm lưu của repo, nên chỉ cần
hỏi một chỗ ngay trước mỗi lần lưu. Phân hệ suy từ chính chứng từ:

* Phải thu (131): hoá đơn bán, hoá đơn điều chỉnh, phiếu thu của khách (cọc đơn, thu hoá đơn, gộp),
  phiếu chi trả lại khách, phiếu chi chiết khấu / kê.
* Phải trả (331): phiếu chi cho NCC (đơn mua, gia công ngoài), phiếu thu NCC hoàn tiền.
* Thu/chi khác, tạm ứng lương: không thuộc sổ công nợ nào ⇒ không chặn.

Xét cả ngày CŨ khi lần sửa đổi ngày chứng từ — kéo chứng từ ra khỏi kỳ khoá cũng là sửa số đã chốt.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import inspect

from ..models.accounting import (
    RECEIPT_SOURCE_ORDER,
    RECEIPT_SOURCE_PURCHASE,
    RECEIPT_SOURCE_SALES_INVOICE,
    VOUCHER_SOURCE_CHI_CK,
    VOUCHER_SOURCE_CHI_KE,
    VOUCHER_SOURCE_CUSTOMER_REFUND,
    VOUCHER_SOURCE_GIA_CONG,
    VOUCHER_SOURCE_PURCHASE,
    PaymentReceipt,
    PaymentVoucher,
    SalesInvoice,
)
from ..models.cong_no_khoa_so import PHAN_HE_PHAI_THU, PHAN_HE_PHAI_TRA
from ..repositories.cong_no_khoa_so_repo import CongNoKhoaSoRepository

_TEN_SO = {PHAN_HE_PHAI_THU: "phải thu", PHAN_HE_PHAI_TRA: "phải trả"}


def _phan_he_phieu_chi(v: PaymentVoucher) -> str | None:
    if v.source_type == VOUCHER_SOURCE_CUSTOMER_REFUND or v.customer_id or v.order_id:
        return PHAN_HE_PHAI_THU
    # Chi CK / kê trả khách thuộc sổ phải thu, xét theo ngày phiếu chi (L-SX-49). Phiếu này không
    # mang khách / đơn — hoá đơn nằm ở `dong_ck_ke`.
    if v.source_type in (VOUCHER_SOURCE_CHI_CK, VOUCHER_SOURCE_CHI_KE) or v.dong_ck_ke:
        return PHAN_HE_PHAI_THU
    if (v.source_type in (VOUCHER_SOURCE_PURCHASE, VOUCHER_SOURCE_GIA_CONG) or v.purchase_request_id
            or v.supplier_id or v.gia_cong_ngoai_id
            or any(l.purchase_request_id for l in v.lines)):
        return PHAN_HE_PHAI_TRA
    return None


def _phan_he_phieu_thu(p: PaymentReceipt) -> str | None:
    if (p.source_type == RECEIPT_SOURCE_PURCHASE or p.supplier_id or p.payment_voucher_id
            or p.purchase_request_id):
        return PHAN_HE_PHAI_TRA
    if (p.source_type in (RECEIPT_SOURCE_ORDER, RECEIPT_SOURCE_SALES_INVOICE) or p.order_id
            or p.sales_invoice_id or p.customer_id
            or any(l.order_id or l.sales_invoice_id for l in p.lines)):
        return PHAN_HE_PHAI_THU
    return None


def _xep(obj) -> tuple[str | None, str, str]:
    """(phân hệ, tên chứng từ, cột ngày chứng từ)."""
    if isinstance(obj, PaymentVoucher):
        return _phan_he_phieu_chi(obj), "phiếu chi", "voucher_date"
    if isinstance(obj, PaymentReceipt):
        return _phan_he_phieu_thu(obj), "phiếu thu", "receipt_date"
    if isinstance(obj, SalesInvoice):
        return PHAN_HE_PHAI_THU, "hoá đơn bán", "invoice_date"
    return None, "", ""


_COT_NGAY = {PaymentVoucher: "voucher_date", PaymentReceipt: "receipt_date",
             SalesInvoice: "invoice_date"}


def loi_ky_khoa(db, obj) -> str | None:
    """Câu báo khi `obj` (sắp lưu) có ngày — hoặc ngày cũ trước lần sửa — nằm trong kỳ công nợ đã
    khoá của phân hệ nó; None nếu được lưu."""
    # Ngày CŨ phải đọc TRƯỚC mọi thứ có thể chạm DB: `_xep` (phân hệ của phiếu) có thể nạp quan hệ,
    # và một lần autoflush ở đó là `history` bị xoá sạch — ngày cũ trong kỳ khoá lọt qua (rà 19/10).
    cot = _COT_NGAY.get(type(obj))
    if cot is None:
        return None
    with db.no_autoflush:
        ngay: set[date] = {getattr(obj, cot)}
        tt = inspect(obj)
        if tt.persistent:
            ngay.update(tt.attrs[cot].history.deleted)
        phan_he, ten, _ = _xep(obj)
    if phan_he is None:
        return None
    repo = CongNoKhoaSoRepository(db)
    for n in sorted(d for d in ngay if d):
        if repo.is_locked(n, phan_he):
            return (f"Kỳ công nợ {_TEN_SO[phan_he]} chứa ngày {n:%d/%m/%Y} đã khoá — không lập, sửa hay "
                    f"huỷ {ten} có ngày trong kỳ này. Mở lại kỳ rồi mới làm.")
    return None
