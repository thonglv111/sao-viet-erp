"""Hoa hồng kinh doanh — MỘT chỗ duy nhất giữ công thức.

Nền: spec `docs/superpowers/specs/2026-10-23-hoa-hong-theo-tien-thu-design.md` (chủ chốt 23/10/2026,
đối chiếu sổ lương T08/2026). Đảo quyết định 21/08/2026 (mốc = hoá đơn ra công nợ): sổ thật trả hoa
hồng khi TIỀN VỀ, và % đổi theo số ngày khách trả chậm.

1. **MỐC = dòng phiếu thu** (`payment_receipt_lines`) của phiếu `received`, `receipt_date` trong kỳ.
   Mỗi dòng sinh MỘT khoản hoa hồng — hoa hồng không trả trước khi tiền về.

2. **GỐC = TRƯỚC VAT, trừ CK + kê**, theo tỷ lệ tiền thu (sổ: `=IF(HĐ, H/1.08 − L, H − L)`):

       dòng có hoá đơn: gốc = tiền × tỷ_lệ_trước_VAT(đơn) − (CK + kê của hoá đơn) × tiền / tiền hoá đơn
       dòng cọc:        gốc = tiền × (Σ line_total − Σ CK − Σ kê) / tổng đơn gồm VAT

   Trừ TOÀN BỘ kê (cả phần thuế TNDN trên kê). Gốc một lần thu được ÂM (CK lớn hơn tiền thu) và trừ
   vào tổng của người như sổ; tổng người kẹp ở 0. Cọc chưa có hoá đơn trừ CK/kê theo tỷ lệ CỦA ĐƠN —
   không trừ thì phần cọc được trả hoa hồng trên cả tiền chi lại khách. Cọc cấn FIFO vào hoá đơn là
   phép tính sống, không sinh dòng thu mới, nên không bị tính hai lần.

   Dòng thu trỏ hoá đơn ĐÃ HUỶ (huỷ khi khách đã trả — tiền thành quỹ của đơn, Kế toán 17/10/2026):
   CK/kê của hoá đơn huỷ không còn giá trị ⇒ gốc tính như cọc (tỷ lệ của đơn); số ngày vẫn từ ngày
   hoá đơn huỷ, vì khách nợ thật từ hôm đó.

   Dữ liệu hỏng (đơn không dòng hàng, hoá đơn 0 đồng mà vẫn có tiền thu trỏ vào) ⇒ gốc = 0: không
   chia cho 0 và không trả tiền đoán.

3. **%** = `orders.hh_rieng_pct` nếu có (kể cả 0 — loại tay), không thì tra BIỂU đã chụp vào đơn lúc
   chốt (`orders.bac_hoa_hong`) theo số ngày = ngày thu − ngày hoá đơn (cọc, thu trước hoá đơn = 0).
   Xem `services/bac_hoa_hong.py`.

`order_lines.line_total` là NET **trước VAT**, đã GỒM CK và kê (giá bán sau kê) — xem `order_service.py`.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..models.accounting import (
    PAYMENT_RECEIPT_RECEIVED,
    PaymentReceipt,
    PaymentReceiptLine,
    SALES_INVOICE_CANCELLED,
    SalesInvoice,
)
from ..models.employee import Employee
from ..models.order import Order
from .bac_hoa_hong import pct_theo_bac


class HoaHongService:
    """Tính hoa hồng kinh doanh trong một kỳ.

    KHÔNG ghi gì — chỉ đọc và trả số. Nơi ghi là `PayrollService` (cột `payroll_lines.hoa_hong`).
    """

    def __init__(self, db) -> None:
        self.db = db

    # ---------------------------------------------------------------- quy đổi trước VAT
    def _ty_le_truoc_vat(self, order: Order) -> float:
        """`tổng trước VAT / tổng có VAT` của đơn. 1.0 khi đơn không có VAT; 0 khi đơn không có dòng
        hàng (không biết phần trước VAT ⇒ gốc 0).

        Quy đổi theo TỶ LỆ chứ không trừ thẳng VAT: một đơn thu nhiều lần, mỗi lần chỉ là một mẩu —
        nhân tỷ lệ giữ đúng phần trước VAT của mẩu đó.
        """
        truoc = sum(int(l.line_total or 0) for l in (order.lines or []))
        co_vat = self._tong_co_vat(order)
        if truoc <= 0 or co_vat <= 0:
            return 0.0
        return truoc / co_vat

    @staticmethod
    def _tong_co_vat(order: Order) -> float:
        return sum(int(l.line_total or 0) * (100 + int(l.vat_pct_estimate or 0)) / 100.0
                   for l in (order.lines or []))

    def _goc_coc(self, order: Order, tien: int) -> float:
        """Gốc của tiền CỌC (chưa có hoá đơn): phần trước VAT, trừ CK + kê theo tỷ lệ của đơn."""
        co_vat = self._tong_co_vat(order)
        if co_vat <= 0:
            return 0.0
        rong = sum(int(l.line_total or 0) - int(l.chiet_khau or 0) - int(l.ke_gia or 0)
                   for l in order.lines)
        return tien * rong / co_vat

    def _goc_hoa_don(self, order: Order, inv: SalesInvoice, tien: int) -> float:
        tong_hd = int(inv.amount_vnd or 0)
        if tong_hd <= 0:
            return 0.0
        tru = int(inv.chiet_khau or 0) + int(inv.ke_gia or 0)
        return tien * self._ty_le_truoc_vat(order) - tru * tien / tong_hd

    # ---------------------------------------------------------------- từng khoản
    def cac_khoan(self, tu_ngay: date, den_ngay: date, *,
                  user_ids: set[int] | None = None) -> list[dict]:
        """Mỗi dòng phiếu thu trong kỳ của đơn có người phụ trách đã nối hồ sơ NV ⇒ một khoản.

        `user_ids` lọc theo người phụ trách đơn (None = mọi người). Bốn truy vấn cho cả mẻ: dòng thu,
        đơn (+ dòng đơn), hoá đơn, nhân viên. `tien` chưa làm tròn — tổng mới làm tròn.
        """
        dong = self.db.execute(
            select(PaymentReceiptLine.payment_receipt_id, PaymentReceiptLine.order_id,
                   PaymentReceiptLine.sales_invoice_id, PaymentReceiptLine.amount_vnd,
                   PaymentReceipt.receipt_date, PaymentReceipt.doc_no, PaymentReceipt.code)
            .join(PaymentReceipt, PaymentReceipt.id == PaymentReceiptLine.payment_receipt_id)
            .where(PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED,
                   PaymentReceipt.receipt_date >= tu_ngay,
                   PaymentReceipt.receipt_date <= den_ngay)
            .order_by(PaymentReceipt.receipt_date, PaymentReceiptLine.id)
        ).all()
        if not dong:
            return []
        q = (select(Order).options(selectinload(Order.lines))
             .where(Order.id.in_(sorted({int(d[1]) for d in dong})), Order.sale_user_id.is_not(None)))
        if user_ids is not None:
            q = q.where(Order.sale_user_id.in_(sorted(user_ids)))
        don = {o.id: o for o in self.db.execute(q).scalars()}
        if not don:
            return []
        nv_theo_user = {
            int(e.user_id): int(e.id) for e in self.db.execute(
                select(Employee).where(Employee.user_id.in_(sorted({int(o.sale_user_id)
                                                                    for o in don.values()})))
            ).scalars()
        }
        inv_ids = sorted({int(d[2]) for d in dong if d[2]})
        hoa_don = {i.id: i for i in self.db.execute(
            select(SalesInvoice).where(SalesInvoice.id.in_(inv_ids))).scalars()} if inv_ids else {}

        ra: list[dict] = []
        for rid, oid, iid, tien, ngay_thu, doc_no, code in dong:
            o = don.get(int(oid))
            if o is None:
                continue
            emp_id = nv_theo_user.get(int(o.sale_user_id))
            if emp_id is None:
                continue                      # người phụ trách chưa nối hồ sơ NV
            tien = int(tien or 0)
            inv = hoa_don.get(int(iid)) if iid else None
            huy = inv is not None and inv.status == SALES_INVOICE_CANCELLED
            if inv is not None:
                goc = self._goc_coc(o, tien) if huy else self._goc_hoa_don(o, inv, tien)
                so_ngay = max(0, (ngay_thu - inv.invoice_date).days)
            else:
                goc = self._goc_coc(o, tien)
                so_ngay = 0
            rieng = o.hh_rieng_pct is not None
            pct = float(o.hh_rieng_pct) if rieng else pct_theo_bac(o.bac_hoa_hong, so_ngay)
            ra.append({
                "employee_id": emp_id, "receipt_id": int(rid), "so_phieu": doc_no or code,
                "order_id": o.id, "order_no": o.order_no,
                "invoice_no": inv.invoice_number if inv is not None else None, "hoa_don_huy": huy,
                "ngay_hoa_don": inv.invoice_date if inv is not None else None,
                "ngay_thu": ngay_thu, "so_ngay": so_ngay, "tien_thu": tien,
                "goc": goc, "pct": pct, "pct_rieng": rieng,
                "ly_do_rieng": o.hh_rieng_ly_do if rieng else None,
                # % âm (gõ nhầm dấu) chỉ bỏ qua khoản đó, không ăn lẹm sang khoản lành. Còn GỐC âm
                # (CK của hoá đơn lớn hơn lần thu — sổ T08 dòng 323 NAM HOA) thì GIỮ: sổ trừ thẳng vào
                # tổng của người. Tổng người không xuống dưới 0 — xem `hoa_hong_ky_map`.
                "tien": goc * pct if pct > 0 else 0.0,
            })
        return ra

    # ---------------------------------------------------------------- API
    def tong_ky_map(self, *, tu_ngay: date, den_ngay: date) -> dict[int, float]:
        """Tổng CHƯA kẹp của mọi người có ít nhất một lần thu trong kỳ — kể cả 0 và âm. Có khoá ⇔ có
        lần thu (bảng lương dùng để cho bấm soi cả khi cột kẹp về 0)."""
        tong: dict[int, float] = {}
        for k in self.cac_khoan(tu_ngay, den_ngay):
            tong[k["employee_id"]] = tong.get(k["employee_id"], 0.0) + k["tien"]
        return {k: round(v) for k, v in tong.items()}

    def hoa_hong_ky_map(self, *, tu_ngay: date, den_ngay: date) -> dict[int, float]:
        """Hoa hồng của TẤT CẢ nhân viên trong kỳ — `{employee_id: tiền}`, một lượt cho cả mẻ.
        Người không có đồng nào thì KHÔNG có khoá trong map — caller dùng `.get(id, 0.0)`."""
        return {k: v for k, v in self.tong_ky_map(tu_ngay=tu_ngay, den_ngay=den_ngay).items() if v > 0}

    def hoa_hong_ky(self, employee_id: int, *, tu_ngay: date, den_ngay: date) -> float:
        """Tiền hoa hồng của MỘT nhân viên trong kỳ `[tu_ngay, den_ngay]`. 0 nếu không có.

        Nhân viên nối với đơn qua `employees.user_id` ↔ `orders.sale_user_id`: đơn ghi USER, còn
        bảng lương chạy theo EMPLOYEE. Chưa có tài khoản thì không thể phụ trách đơn nào ⇒ 0 sớm.
        """
        emp = self.db.get(Employee, int(employee_id))
        uid = getattr(emp, "user_id", None)
        if not uid:
            return 0.0
        tong = sum(k["tien"] for k in self.cac_khoan(tu_ngay, den_ngay, user_ids={int(uid)}))
        return max(0, round(tong))
