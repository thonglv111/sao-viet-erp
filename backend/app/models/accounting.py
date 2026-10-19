"""Operational accounting models for purchase payments.

The ERP keeps the business document and payment trail; legal journals and
financial statements remain in MISA per the project's hybrid-accounting scope.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    event,
    text,
)
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from ..db import Base


VOUCHER_CASH = "cash"
VOUCHER_BANK_TRANSFER = "bank_transfer"
PAYMENT_VOUCHER_TYPES = (VOUCHER_CASH, VOUCHER_BANK_TRANSFER)

PAYMENT_STAGE_ADVANCE = "advance"
PAYMENT_STAGE_PARTIAL = "partial"
PAYMENT_STAGE_FINAL = "final"
PAYMENT_STAGE_OTHER = "other"
PAYMENT_STAGES = (
    PAYMENT_STAGE_ADVANCE,
    PAYMENT_STAGE_PARTIAL,
    PAYMENT_STAGE_FINAL,
    PAYMENT_STAGE_OTHER,
)

PAYMENT_VOUCHER_WAITING = "waiting_payment"
PAYMENT_VOUCHER_PAID = "paid"
PAYMENT_VOUCHER_CANCELLED = "cancelled"
PAYMENT_VOUCHER_STATUSES = (
    PAYMENT_VOUCHER_WAITING,
    PAYMENT_VOUCHER_PAID,
    PAYMENT_VOUCHER_CANCELLED,
)

VOUCHER_SOURCE_PURCHASE = "purchase_request"
VOUCHER_SOURCE_INTERNAL = "internal_expense"
VOUCHER_SOURCE_CUSTOMER_REFUND = "customer_refund"
VOUCHER_SOURCE_OTHER = "other"
# Phiếu chi lập TỪ MỘT PHIẾU TẠM ỨNG LƯƠNG đã duyệt (chủ chốt 18/08/2026). Một phiếu tạm ứng
# ⇄ một phiếu chi. Áp cho CẢ `tam_ung` lẫn `luong_dot_1` — cùng là tiền ra khỏi két.
VOUCHER_SOURCE_SALARY_ADVANCE = "salary_advance"
# Phiếu chi lập TỪ MỘT LẦN GIA CÔNG NGOÀI đã chốt (26/09/2026). Một lần ⇄ một phiếu chi còn sống.
# CHỈ ghi tiền ra: không `supplier_id`, loại khỏi báo cáo 331 (chủ: "không dính 331").
VOUCHER_SOURCE_GIA_CONG = "gia_cong_ngoai"
VOUCHER_SOURCES = (
    VOUCHER_SOURCE_SALARY_ADVANCE,
    VOUCHER_SOURCE_GIA_CONG,
    VOUCHER_SOURCE_PURCHASE,
    VOUCHER_SOURCE_INTERNAL,
    VOUCHER_SOURCE_CUSTOMER_REFUND,
    VOUCHER_SOURCE_OTHER,
)

BANK_FEE_PAYER = "payer"
BANK_FEE_BENEFICIARY = "beneficiary"
BANK_FEE_SHARED = "shared"
BANK_FEE_BEARERS = (BANK_FEE_PAYER, BANK_FEE_BENEFICIARY, BANK_FEE_SHARED)

PAYMENT_RECEIPT_WAITING = "waiting_receipt"
PAYMENT_RECEIPT_RECEIVED = "received"
PAYMENT_RECEIPT_CANCELLED = "cancelled"
PAYMENT_RECEIPT_STATUSES = (
    PAYMENT_RECEIPT_WAITING,
    PAYMENT_RECEIPT_RECEIVED,
    PAYMENT_RECEIPT_CANCELLED,
)

# --- Nguồn phiếu thu (chung 1 quyển sổ PT, 1 dãy số 01-TT) ---------------------
# purchase_refund: tiền chi mua thừa NCC/nhân viên nộp trả (đường cũ, gắn phiếu chi).
# order_deposit:   khách đặt cọc đơn bán (đường mới, gắn đơn hàng) — không phiếu chi.
# sales_invoice:   khách thanh toán công nợ phát sinh từ hóa đơn bán đã phát hành.
RECEIPT_SOURCE_PURCHASE = "purchase_refund"
RECEIPT_SOURCE_ORDER = "order_deposit"
RECEIPT_SOURCE_SALES_INVOICE = "sales_invoice"
RECEIPT_SOURCE_OTHER = "other"
RECEIPT_SOURCES = (
    RECEIPT_SOURCE_PURCHASE,
    RECEIPT_SOURCE_ORDER,
    RECEIPT_SOURCE_SALES_INVOICE,
    RECEIPT_SOURCE_OTHER,
)

SALES_INVOICE_ISSUED = "issued"
SALES_INVOICE_CANCELLED = "cancelled"
SALES_INVOICE_STATUSES = (SALES_INVOICE_ISSUED, SALES_INVOICE_CANCELLED)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CompanyBankAccount(Base):
    __tablename__ = "company_bank_accounts"
    __table_args__ = (
        UniqueConstraint("bank_name", "account_number", name="uq_company_bank_account"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_holder: Mapped[str] = mapped_column(String(255), nullable=False)
    account_number: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    bank_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    bank_branch: Mapped[str] = mapped_column(String(255), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="VND")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    use_for_receipts: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    use_for_payments: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class SupplierBankAccount(Base):
    __tablename__ = "supplier_bank_accounts"
    __table_args__ = (
        UniqueConstraint(
            "supplier_id", "bank_name", "account_number", name="uq_supplier_bank_account"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    supplier_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    account_holder: Mapped[str] = mapped_column(String(255), nullable=False)
    account_number: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    bank_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    bank_branch: Mapped[str] = mapped_column(String(255), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="VND")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    supplier = relationship("Supplier", back_populates="bank_accounts")


class PaymentVoucher(Base):
    __tablename__ = "payment_vouchers"
    __table_args__ = (
        # Chống chi HAI LẦN cho một phiếu tạm ứng ở tầng DB (hai request song song lách được service),
        # nhưng CHỈ tính phiếu chi còn hiệu lực — phiếu đã huỷ phải nhường chỗ cho phiếu lập lại
        # (bản rà B5, 07/09/2026). Postgres lẫn SQLite đều hiểu partial index.
        Index("uq_payment_voucher_salary_advance", "salary_advance_id", unique=True,
              postgresql_where=text("status <> 'cancelled'"),
              sqlite_where=text("status <> 'cancelled'")),
        Index("uq_payment_voucher_gia_cong_ngoai", "gia_cong_ngoai_id", unique=True,
              postgresql_where=text("status <> 'cancelled'"),
              sqlite_where=text("status <> 'cancelled'")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    # Số IN trên mẫu 02-TT (PC00445): thứ tự LẬP phiếu, KHÔNG phải thứ tự ngày chứng từ
    # (voucher_date sửa được sau khi đã cấp số). Phiếu hủy vẫn giữ số. Dùng chung một bộ
    # đếm cho tiền mặt lẫn UNC — cùng quyển phiếu chi.
    doc_no: Mapped[str | None] = mapped_column(String(16), nullable=True, unique=True, index=True)
    source_type: Mapped[str] = mapped_column(
        String(24), nullable=False, default=VOUCHER_SOURCE_PURCHASE, index=True
    )
    purchase_request_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("purchase_requests.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    # Phiếu này trả cho ĐỢT GIAO nào (chủ chốt 06/08/2026).
    #   NULL  = phiếu ĐẶT CỌC / ứng trước — chi khi hàng chưa về nên chưa có đợt nào để gắn.
    #   có id = phiếu THANH TOÁN cho đúng một đợt giao.
    # Soft ref (không FK) có chủ ý: xoá đợt giao đã bị chặn ở tầng service khi đợt còn phiếu chi,
    # nên FK RESTRICT chỉ thêm một chỗ vỡ ở DB mà không thêm an toàn nào.
    delivery_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # Phiếu TẠM ỨNG LƯƠNG nguồn (chủ chốt 18/08/2026). Chỉ có giá trị khi
    # `source_type = salary_advance`. RESTRICT: còn phiếu chi thì không xoá được phiếu tạm ứng.
    # Một phiếu tạm ứng chỉ được lập ĐÚNG MỘT phiếu chi CÒN HIỆU LỰC ⇒ UNIQUE RIÊNG PHẦN
    # (`uq_payment_voucher_salary_advance` ở `__table_args__`, mg 0271): phiếu chi đã HUỶ không giữ
    # chỗ nữa — huỷ phiếu chi thì phiếu tạm ứng về "đã duyệt" và kế toán lập lại phiếu chi mới.
    salary_advance_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("salary_advances.id", ondelete="RESTRICT"),
        nullable=True, index=True,
    )
    # LẦN GIA CÔNG NGOÀI nguồn (mg 0339). Chỉ có giá trị khi `source_type = gia_cong_ngoai`.
    # RESTRICT: còn phiếu chi thì không xoá được lần. Một lần chỉ MỘT phiếu chi CÒN HIỆU LỰC
    # (`uq_payment_voucher_gia_cong_ngoai`), huỷ phiếu thì lần tự về "chờ chi".
    gia_cong_ngoai_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("gia_cong_ngoai.id", ondelete="RESTRICT"), nullable=True, index=True,
    )
    supplier_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Mục thu chi (11/10/2026, mg 0395). Phiếu lập tay bắt buộc chọn; phiếu sinh từ nghiệp vụ để
    # trống — mục của nó là mục cố định suy từ `source_type` (`models.muc_thu_chi.MUC_CO_DINH`).
    muc_thu_chi_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("muc_thu_chi.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    # Khách nhận tiền — chỉ phiếu TRẢ LẠI TIỀN CHO KHÁCH (`source_type = customer_refund`, 12/10/2026,
    # lập từ ngăn Công nợ phải thu hoặc "Trả lại cọc" trên đơn đã huỷ). Tiền này vào Công nợ phải
    # thu của khách đó (`bao_cao_cong_no._chung_tu_phai_thu`).
    customer_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("customers.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    # Đơn bán đã huỷ mà phiếu này trả lại cọc (mg 0397). Trống = trả lại tiền chung của khách. Cọc
    # còn lại của đơn = Σ phiếu thu cọc − Σ phiếu chi còn hiệu lực trỏ đơn này.
    order_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("orders.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    voucher_type: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    payment_stage: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default=PAYMENT_VOUCHER_WAITING, index=True
    )
    voucher_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    planned_payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    amount_vnd: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="VND")
    exchange_rate: Mapped[float] = mapped_column(Numeric(18, 6), nullable=False, default=1)
    content: Mapped[str] = mapped_column(String(500), nullable=False)
    invoice_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    contract_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    company_bank_account_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("company_bank_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    supplier_bank_account_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("supplier_bank_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    cash_recipient_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cash_recipient_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cash_recipient_identity: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bank_fee_bearer: Mapped[str | None] = mapped_column(String(16), nullable=True)
    bank_reference: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Định khoản in trên mẫu ("Nợ: 242, 1331" / "Có: 1111") — nhập tay, hệ thống chưa
    # có danh mục tài khoản kế toán.
    debit_account: Mapped[str | None] = mapped_column(String(64), nullable=True)
    credit_account: Mapped[str | None] = mapped_column(String(64), nullable=True)

    source_code_snapshot: Mapped[str] = mapped_column(String(32), nullable=False)
    supplier_name_snapshot: Mapped[str] = mapped_column(String(255), nullable=False)
    supplier_tax_code_snapshot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    supplier_address_snapshot: Mapped[str | None] = mapped_column(String(500), nullable=True)
    company_account_holder_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    company_account_number_snapshot: Mapped[str | None] = mapped_column(String(64), nullable=True)
    company_bank_name_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    company_bank_branch_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    beneficiary_account_holder_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    beneficiary_account_number_snapshot: Mapped[str | None] = mapped_column(String(64), nullable=True)
    beneficiary_bank_name_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    beneficiary_bank_branch_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    paid_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    purchase_request = relationship("PurchaseRequest", back_populates="payment_vouchers")
    supplier = relationship("Supplier")
    muc_thu_chi = relationship("MucThuChi")
    customer = relationship("Customer")
    order = relationship("Order")
    company_bank_account = relationship("CompanyBankAccount")
    supplier_bank_account = relationship("SupplierBankAccount")
    receipts: Mapped[list["PaymentReceipt"]] = relationship(
        "PaymentReceipt", back_populates="payment_voucher", order_by="PaymentReceipt.id"
    )
    # Phân bổ tiền của phiếu vào từng đơn mua / đợt giao (17/10/2026). Phiếu lẻ có đúng một dòng
    # (hook `_dong_phan_bo_mac_dinh` tự dựng); phiếu GỘP để trống nguồn trên đầu phiếu, chỉ có dòng.
    lines: Mapped[list["PaymentVoucherLine"]] = relationship(
        "PaymentVoucherLine",
        back_populates="voucher",
        order_by="PaymentVoucherLine.id",
        cascade="all, delete-orphan",
    )
    attachments: Mapped[list["PaymentVoucherAttachment"]] = relationship(
        "PaymentVoucherAttachment",
        back_populates="payment_voucher",
        order_by="PaymentVoucherAttachment.id",
        cascade="all, delete-orphan",
    )


class SalesInvoice(Base):
    """Hóa đơn bán đã phát hành — mốc làm phát sinh công nợ phải thu."""

    __tablename__ = "sales_invoices"
    __table_args__ = (
        UniqueConstraint(
            "invoice_symbol", "invoice_number", name="uq_sales_invoice_symbol_number"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    customer_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    invoice_symbol: Mapped[str] = mapped_column(String(64), nullable=False)
    invoice_number: Mapped[str] = mapped_column(String(64), nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount_vnd: Mapped[int] = mapped_column(BigInteger, nullable=False)
    payment_term_days_snapshot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    customer_name_snapshot: Mapped[str] = mapped_column(String(255), nullable=False)
    # Lượt giao mà hóa đơn này lập cho (mg 0402, 13/10/2026). Hóa đơn bán hàng lập lúc giao hàng,
    # giao nhiều lần thì mỗi lần một hóa đơn đúng số đã giao — nên hóa đơn mới BẮT BUỘC gắn một
    # lượt khách đã nhận. Hóa đơn ghi trước đó để trống.
    delivery_trip_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("delivery_trips.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=SALES_INVOICE_ISSUED, index=True
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
    cancelled_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    order = relationship("Order")
    customer = relationship("Customer")
    receipts: Mapped[list["PaymentReceipt"]] = relationship(
        "PaymentReceipt", back_populates="sales_invoice", order_by="PaymentReceipt.id"
    )
    dieu_chinh: Mapped[list["SalesInvoiceAdjustment"]] = relationship(
        "SalesInvoiceAdjustment", back_populates="sales_invoice",
        order_by="SalesInvoiceAdjustment.id",
    )


class SalesInvoiceAdjustment(Base):
    """Hóa đơn ĐIỀU CHỈNH GIẢM của một hóa đơn bán (18/10/2026) — chứng từ thuế để hoàn tiền chiết
    khấu cho khách. Hóa đơn gốc giữ nguyên 100%; khoản giảm trừ vào phải thu của hóa đơn gốc và,
    nếu khách đã trả đủ, phần trả dư thành tiền phải trả lại (Phiếu chi, Chờ trả lại khách)."""

    __tablename__ = "sales_invoice_adjustments"
    __table_args__ = (
        UniqueConstraint(
            "adj_symbol", "adj_number", name="uq_sales_invoice_adj_symbol_number"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sales_invoice_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sales_invoices.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    order_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    adj_symbol: Mapped[str] = mapped_column(String(64), nullable=False)
    adj_number: Mapped[str] = mapped_column(String(64), nullable=False)
    adj_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount_vnd: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=SALES_INVOICE_ISSUED, index=True
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    cancelled_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    sales_invoice = relationship("SalesInvoice", back_populates="dieu_chinh")


class PaymentReceipt(Base):
    """Phiếu thu đa nguồn: hoàn tiền chi mua, cọc đơn bán, thu hóa đơn hoặc thu khác.

    `source_type` quyết định khóa nguồn nào được dùng; riêng nhánh công nợ liên kết
    trực tiếp tới `SalesInvoice` để số tiền thu được truy về đúng hóa đơn phát sinh.
    """

    __tablename__ = "payment_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    # Số IN trên mẫu 01-TT (PT00027) — xem ghi chú doc_no ở PaymentVoucher.
    doc_no: Mapped[str | None] = mapped_column(String(16), nullable=True, unique=True, index=True)
    # Nguồn phiếu ∈ {purchase_refund, order_deposit, sales_invoice, other}.
    source_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default=RECEIPT_SOURCE_PURCHASE, index=True
    )
    # Đường phiếu chi (purchase_refund) — nullable để đường đơn bán không cần.
    payment_voucher_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("payment_vouchers.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    # Denormalize từ phiếu chi gốc để SUM theo PMH không phải join.
    purchase_request_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("purchase_requests.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    # Đường đơn bán (order_deposit) — cọc khách nộp cho một đơn hàng.
    order_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("orders.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    sales_invoice_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("sales_invoices.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    # NCC hoàn tiền (`purchase_refund`, mg 0397). Phiếu lập từ ngăn Công nợ phải trả gắn thẳng NCC,
    # không cần phiếu chi gốc; phiếu cũ lập từ phiếu chi được điền ngược từ phiếu chi đó.
    supplier_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    # Mục thu chi (11/10/2026, mg 0395) — cùng luật với `PaymentVoucher.muc_thu_chi_id`.
    muc_thu_chi_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("muc_thu_chi.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    # Khách nộp tiền (mg 0416). Phiếu gộp nhiều đơn không còn một đơn/hoá đơn nào để suy ra khách,
    # nên khách nằm thẳng trên phiếu; phiếu lẻ được hook điền từ hoá đơn hoặc đơn.
    customer_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    order_no_snapshot: Mapped[str | None] = mapped_column(String(32), nullable=True)
    customer_name_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Người nộp lại tiền — mặc định suy từ phiếu chi (người phụ trách mua / người nhận TM).
    payer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    payer_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    receipt_method: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default=PAYMENT_RECEIPT_WAITING, index=True
    )
    receipt_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    amount_vnd: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="VND")
    exchange_rate: Mapped[float] = mapped_column(Numeric(18, 6), nullable=False, default=1)
    content: Mapped[str] = mapped_column(String(500), nullable=False)
    company_bank_account_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("company_bank_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    bank_reference: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Định khoản in trên mẫu ("Nợ: 1111" / "Có: 131") — nhập tay.
    debit_account: Mapped[str | None] = mapped_column(String(64), nullable=True)
    credit_account: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Snapshot đường phiếu chi (purchase_refund) — nullable vì đường đơn bán không có.
    voucher_code_snapshot: Mapped[str | None] = mapped_column(String(32), nullable=True)
    purchase_code_snapshot: Mapped[str | None] = mapped_column(String(32), nullable=True)
    supplier_name_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    company_account_holder_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    company_account_number_snapshot: Mapped[str | None] = mapped_column(String(64), nullable=True)
    company_bank_name_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    company_bank_branch_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    received_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    payment_voucher = relationship("PaymentVoucher", back_populates="receipts")
    sales_invoice = relationship("SalesInvoice", back_populates="receipts")
    supplier = relationship("Supplier")
    customer = relationship("Customer")
    muc_thu_chi = relationship("MucThuChi")
    company_bank_account = relationship("CompanyBankAccount")
    # Phân bổ tiền của phiếu vào từng hoá đơn / cọc đơn (17/10/2026) — xem `PaymentReceiptLine`.
    lines: Mapped[list["PaymentReceiptLine"]] = relationship(
        "PaymentReceiptLine",
        back_populates="receipt",
        order_by="PaymentReceiptLine.id",
        cascade="all, delete-orphan",
    )
    attachments: Mapped[list["PaymentReceiptAttachment"]] = relationship(
        "PaymentReceiptAttachment",
        back_populates="payment_receipt",
        order_by="PaymentReceiptAttachment.id",
        cascade="all, delete-orphan",
    )


class PaymentVoucherLine(Base):
    """Một dòng PHÂN BỔ của phiếu chi trả đơn mua (17/10/2026, chủ: "một phiếu cho cả lượt").

    Nguồn DUY NHẤT cho câu hỏi "tiền của phiếu này trả cho đơn nào, đợt nào": mọi phép tính đã chi
    theo đơn/đợt (`purchase_money`, `phan_bo_tien_dot`, công nợ phải trả) đọc các dòng này, không
    đọc cột nguồn trên đầu phiếu nữa. `delivery_id` NULL = dòng CỌC của đơn.

    Dòng KHÔNG có trạng thái riêng — huỷ phiếu là huỷ cả mọi dòng, nên mọi chỗ đọc phải lọc theo
    trạng thái của PHIẾU (`status` dưới đây đọc thẳng từ phiếu)."""

    __tablename__ = "payment_voucher_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    payment_voucher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("payment_vouchers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    purchase_request_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("purchase_requests.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    delivery_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    amount_vnd: Mapped[int] = mapped_column(BigInteger, nullable=False)

    voucher = relationship("PaymentVoucher", back_populates="lines")
    purchase_request = relationship("PurchaseRequest", back_populates="khoan_chi")

    # Đọc qua phiếu — để các vòng tính tiền cũ (viết cho phiếu) chạy nguyên trên dòng.
    @property
    def voucher_id(self) -> int:
        return self.payment_voucher_id

    @property
    def status(self) -> str:
        return self.voucher.status

    @property
    def voucher_date(self):
        return self.voucher.voucher_date

    @property
    def paid_at(self):
        return self.voucher.paid_at

    @property
    def code(self) -> str:
        return self.voucher.code

    @property
    def doc_no(self) -> str | None:
        return self.voucher.doc_no

    @property
    def gop(self) -> bool:
        return len(self.voucher.lines) > 1

    @property
    def payment_stage(self) -> str:
        """Phiếu lẻ giữ nguyên giai đoạn đã ghi (phiếu cũ có thể là `partial`); dòng của phiếu gộp
        suy từ đợt: không đợt = cọc."""
        if not self.gop:
            return self.voucher.payment_stage
        return PAYMENT_STAGE_ADVANCE if self.delivery_id is None else PAYMENT_STAGE_FINAL

    @property
    def receipts(self) -> list:
        """Tiền NỘP LẠI hoàn phiếu chi — chỉ phiếu lẻ nhận được (phiếu gộp bị chặn ở service), nên
        quy trọn về đơn của dòng duy nhất."""
        return [] if self.gop else list(self.voucher.receipts)


class PaymentReceiptLine(Base):
    """Một dòng PHÂN BỔ của phiếu thu đơn bán (17/10/2026): tiền thu cho hoá đơn nào hoặc cọc đơn
    nào. `sales_invoice_id` NULL = dòng CỌC của `order_id`. Nguồn duy nhất cho đã thu theo hoá đơn
    và cọc đã thu theo đơn; lọc theo trạng thái của PHIẾU."""

    __tablename__ = "payment_receipt_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    payment_receipt_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("payment_receipts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    sales_invoice_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("sales_invoices.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    amount_vnd: Mapped[int] = mapped_column(BigInteger, nullable=False)

    receipt = relationship("PaymentReceipt", back_populates="lines")
    order = relationship("Order")
    sales_invoice = relationship("SalesInvoice")

    # Mặt phiếu của dòng — vòng lặp "từng lần thu" cũ đọc dòng như đọc phiếu, tiền là của DÒNG.
    @property
    def receipt_id(self) -> int:
        return self.payment_receipt_id

    @property
    def code(self) -> str:
        return self.receipt.code

    @property
    def doc_no(self) -> str | None:
        return self.receipt.doc_no

    @property
    def status(self) -> str:
        return self.receipt.status

    @property
    def receipt_date(self):
        return self.receipt.receipt_date

    @property
    def receipt_method(self) -> str:
        return self.receipt.receipt_method

    @property
    def payer_name(self) -> str:
        return self.receipt.payer_name

    @property
    def bank_reference(self) -> str | None:
        return self.receipt.bank_reference

    @property
    def created_by_user_id(self) -> int | None:
        return self.receipt.created_by_user_id

    @property
    def order_no_snapshot(self) -> str | None:
        return self.order.order_no if self.order is not None else self.receipt.order_no_snapshot

    @property
    def la_coc(self) -> bool:
        return self.sales_invoice_id is None

    @property
    def gop(self) -> bool:
        return len(self.receipt.lines) > 1


def _dong_chi_mac_dinh(v: "PaymentVoucher") -> None:
    if v.source_type != VOUCHER_SOURCE_PURCHASE or v.purchase_request_id is None:
        return
    if len(v.lines) > 1:
        return
    if v.lines:
        l = v.lines[0]
        l.purchase_request_id = v.purchase_request_id
        l.delivery_id = v.delivery_id
        l.amount_vnd = int(v.amount_vnd)
    else:
        v.lines.append(PaymentVoucherLine(
            purchase_request_id=v.purchase_request_id, delivery_id=v.delivery_id,
            amount_vnd=int(v.amount_vnd),
        ))


def _dong_thu_mac_dinh(session, p: "PaymentReceipt") -> None:
    from .order import Order

    if p.sales_invoice_id is not None:
        hd = session.get(SalesInvoice, p.sales_invoice_id)
        if hd is None:
            return
        don_id, hd_id, khach = hd.order_id, hd.id, hd.customer_id
    elif p.source_type == RECEIPT_SOURCE_ORDER and p.order_id is not None:
        don = session.get(Order, p.order_id)
        if don is None:
            return
        don_id, hd_id, khach = don.id, None, don.customer_id
    else:
        return
    if p.customer_id is None:
        p.customer_id = khach
    if len(p.lines) > 1:
        return
    if p.lines:
        l = p.lines[0]
        l.order_id, l.sales_invoice_id, l.amount_vnd = don_id, hd_id, int(p.amount_vnd)
    else:
        p.lines.append(PaymentReceiptLine(order_id=don_id, sales_invoice_id=hd_id, amount_vnd=int(p.amount_vnd)))


@event.listens_for(Session, "before_flush")
def _dong_phan_bo_mac_dinh(session, flush_context, instances) -> None:
    """Phiếu MỘT chứng từ (mọi đường lập cũ, seed, test) tự có đúng một dòng phân bổ khớp nguồn trên
    đầu phiếu — để bảng phân bổ luôn đủ mà không phải sửa từng chỗ lập phiếu. Phiếu gộp (đầu phiếu
    không nguồn, nhiều dòng) không bị đụng."""
    for obj in list(session.new) + list(session.dirty):
        if isinstance(obj, PaymentVoucher):
            _dong_chi_mac_dinh(obj)
        elif isinstance(obj, PaymentReceipt):
            _dong_thu_mac_dinh(session, obj)


class PaymentVoucherAttachment(Base):
    """Chứng từ scan đính kèm Phiếu chi/UNC (hóa đơn/biên nhận/UNC ngân hàng).
    Bytes nằm trong kho file `ke-toan/<voucher_id>/` (app/storage.py), đọc lại qua
    /api/files — cần đăng nhập + quyền `ke_toan`; DB chỉ lưu metadata + path. Cho
    đính THÊM cả khi phiếu đã `paid` (hóa đơn về sau khi đi mua); chỉ chặn `cancelled`."""

    __tablename__ = "payment_voucher_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    payment_voucher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("payment_vouchers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_url: Mapped[str] = mapped_column(String(500), nullable=False)
    file_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    uploaded_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    payment_voucher = relationship("PaymentVoucher", back_populates="attachments")


class PaymentReceiptAttachment(Base):
    """Ảnh minh chứng đã thu đính kèm Phiếu thu (biên nhận/UNC báo có).
    Bytes nằm trong kho file `ke-toan-thu/<receipt_id>/`, đọc lại qua /api/files (cần
    quyền `ke_toan`); DB chỉ lưu metadata + path (mirror payment_voucher_attachments).
    Cho đính THÊM cả khi đã `received`; chỉ chặn `cancelled`."""

    __tablename__ = "payment_receipt_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    payment_receipt_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("payment_receipts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_url: Mapped[str] = mapped_column(String(500), nullable=False)
    file_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    uploaded_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    payment_receipt = relationship("PaymentReceipt", back_populates="attachments")
