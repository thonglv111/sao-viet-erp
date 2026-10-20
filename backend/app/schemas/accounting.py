"""HTTP contracts for operational purchase accounting."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class BankAccountBaseIn(BaseModel):
    account_holder: str = Field(min_length=1, max_length=255)
    account_number: str = Field(min_length=1, max_length=64)
    bank_name: str = Field(min_length=1, max_length=255)
    bank_branch: str = Field(min_length=1, max_length=255)
    currency: str = Field(default="VND", min_length=3, max_length=3)
    is_default: bool = False
    is_active: bool = True
    note: str | None = Field(default=None, max_length=2000)


class CompanyBankAccountIn(BankAccountBaseIn):
    use_for_receipts: bool = True
    use_for_payments: bool = True


class SupplierBankAccountIn(BankAccountBaseIn):
    supplier_id: int = Field(gt=0)


class CompanyBankAccountOut(BankAccountBaseIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    use_for_receipts: bool
    use_for_payments: bool
    created_at: datetime
    updated_at: datetime


class NganHangLocOut(BaseModel):
    """Một lựa chọn của ô lọc "Ngân hàng" (màn Tài khoản ngân hàng): tên + số tài khoản."""
    ten: str
    so: int = 0


class TaiKhoanThongKeOut(BaseModel):
    """Thu/chi ĐÃ XONG của một tài khoản ngân hàng công ty trong kỳ (số trên thẻ tài khoản)."""

    tai_khoan_id: int
    thu: int
    chi: int
    so_phieu: int


class SupplierBankAccountOut(BankAccountBaseIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier_id: int
    supplier_name: str | None = None
    created_at: datetime
    updated_at: datetime


class PaymentVoucherBaseIn(BaseModel):
    source_type: str | None = Field(default=None, max_length=24)
    voucher_type: str = Field(min_length=1, max_length=24)
    payment_stage: str = Field(min_length=1, max_length=16)
    # Đợt giao mà phiếu này trả cho. BẮT BUỘC với phiếu thanh toán; phải BỎ TRỐNG với phiếu đặt cọc
    # (cọc là tiền chi khi hàng chưa về nên chưa có đợt nào để gắn).
    delivery_id: int | None = Field(default=None, gt=0)
    voucher_date: date
    # DORMANT từ 06/08/2026: phiếu chi là tiền đã ra nên không có hạn trả. Hạn trả nay thuộc về
    # đợt giao (`purchase_deliveries.due_date`). Giữ khoá để client cũ không vỡ.
    planned_payment_date: date | None = None
    amount: int = Field(gt=0)
    currency: str = Field(default="VND", min_length=3, max_length=3)
    exchange_rate: float = Field(default=1, gt=0)
    content: str = Field(min_length=1, max_length=500)
    invoice_number: str | None = Field(default=None, max_length=64)
    invoice_date: date | None = None
    contract_number: str | None = Field(default=None, max_length=64)
    company_bank_account_id: int | None = Field(default=None, gt=0)
    supplier_bank_account_id: int | None = Field(default=None, gt=0)
    cash_recipient_name: str | None = Field(default=None, max_length=255)
    cash_recipient_address: str | None = Field(default=None, max_length=500)
    cash_recipient_identity: str | None = Field(default=None, max_length=64)
    beneficiary_account_holder: str | None = Field(default=None, max_length=255)
    beneficiary_account_number: str | None = Field(default=None, max_length=64)
    beneficiary_bank_name: str | None = Field(default=None, max_length=255)
    beneficiary_bank_branch: str | None = Field(default=None, max_length=255)
    bank_fee_bearer: str | None = Field(default=None, max_length=16)
    # Định khoản in trên mẫu 02-TT — nhập tay, không bắt buộc.
    debit_account: str | None = Field(default=None, max_length=64)
    credit_account: str | None = Field(default=None, max_length=64)
    note: str | None = Field(default=None, max_length=2000)
    # Mục chi (danh mục Mục thu chi). Phiếu lập tay bắt buộc; phiếu sinh từ nghiệp vụ bỏ qua — mục
    # của nó là mục cố định theo nguồn. `customer_id` (+ `order_id` khi trả lại cọc của đơn đã huỷ)
    # chỉ dùng cho phiếu trả lại tiền cho khách (`source_type = customer_refund`).
    muc_thu_chi_id: int | None = Field(default=None, gt=0)
    customer_id: int | None = Field(default=None, gt=0)
    order_id: int | None = Field(default=None, gt=0)


class PaymentVoucherIn(PaymentVoucherBaseIn):
    purchase_request_id: int | None = Field(default=None, gt=0)
    # Phiếu TẠM ỨNG LƯƠNG nguồn (18/08/2026). Truyền cái này thì `source_type` tự là
    # `salary_advance`, và SỐ TIỀN + NGƯỜI NHẬN lấy từ phiếu tạm ứng — payload gửi lên bị bỏ qua,
    # để phiếu chi không thể lệch số đã duyệt.
    salary_advance_id: int | None = Field(default=None, gt=0)
    # Lần gia công ngoài nguồn — spec 2026-09-26 §5.
    gia_cong_ngoai_id: int | None = Field(default=None, gt=0)


class ApproveAndCreateVoucherIn(PaymentVoucherBaseIn):
    pass


# ĐÃ GỠ 06/08/2026: `MarkPaymentVoucherPaidIn` — không còn bước "xác nhận đã chi" (Đ1).


class CancelPaymentVoucherIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class PaymentVoucherLineOut(BaseModel):
    """Một dòng phân bổ của phiếu chi trả đơn mua."""

    purchase_request_id: int
    purchase_code: str | None = None
    delivery_id: int | None = None
    delivery_seq_no: int | None = None
    invoice_number: str | None = None
    amount: int
    purchase_created_by_user_id: int | None = None


class DoiChieuDongChiOut(BaseModel):
    purchase_code: str
    delivery_seq_no: int | None = None
    truoc_do: int
    con_no_sau: int


class PaymentVoucherOut(BaseModel):
    id: int
    code: str
    doc_no: str | None = None
    debit_account: str | None = None
    credit_account: str | None = None
    source_type: str = "purchase_request"
    muc_thu_chi_id: int | None = None
    muc_thu_chi_ten: str | None = None
    customer_id: int | None = None
    customer_name: str | None = None
    # Đơn đã huỷ mà phiếu trả lại cọc (chỉ phiếu trả lại tiền cho khách).
    order_id: int | None = None
    order_code: str | None = None
    purchase_request_id: int | None = None
    salary_advance_id: int | None = None
    gia_cong_ngoai_id: int | None = None
    purchase_request_code: str
    purchase_request_total: int | None = None
    purchase_paid_amount: int | None = None
    purchase_created_by_user_id: int | None = None
    purchase_created_by_name: str | None = None
    receipt_received_amount: int = 0
    receipt_pending_amount: int = 0
    attachment_count: int = 0
    # Bảng phân bổ (17/10/2026): phiếu lẻ một dòng, phiếu GỘP nhiều dòng (đầu phiếu không nguồn).
    lines: list[PaymentVoucherLineOut] = Field(default_factory=list)
    # NULL = phiếu đặt cọc, hoặc phiếu cũ lập trước khi có khái niệm đợt giao, hoặc phiếu gộp.
    delivery_id: int | None = None
    delivery_seq_no: int | None = None
    source_request_codes: list[str]
    supplier_id: int | None = None
    supplier_name: str
    supplier_tax_code: str | None = None
    supplier_address: str | None = None
    voucher_type: str
    payment_stage: str
    status: str
    voucher_date: date
    planned_payment_date: date | None = None
    amount: int
    amount_vnd: int
    currency: str
    exchange_rate: float
    content: str
    invoice_number: str | None = None
    invoice_date: date | None = None
    contract_number: str | None = None
    company_bank_account_id: int | None = None
    supplier_bank_account_id: int | None = None
    cash_recipient_name: str | None = None
    cash_recipient_address: str | None = None
    cash_recipient_identity: str | None = None
    bank_fee_bearer: str | None = None
    bank_reference: str | None = None
    company_account_holder: str | None = None
    company_account_number: str | None = None
    company_bank_name: str | None = None
    company_bank_branch: str | None = None
    beneficiary_account_holder: str | None = None
    beneficiary_account_number: str | None = None
    beneficiary_bank_name: str | None = None
    beneficiary_bank_branch: str | None = None
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    paid_by_user_id: int | None = None
    paid_by_name: str | None = None
    paid_at: datetime | None = None
    cancelled_by_user_id: int | None = None
    cancelled_by_name: str | None = None
    cancelled_at: datetime | None = None
    cancel_reason: str | None = None
    note: str | None = None
    created_at: datetime
    updated_at: datetime
    # Bảng đối chiếu trong ngăn — CHỈ route đọc một phiếu mới điền (danh sách để None, tránh N truy vấn).
    # `truoc_do` = đã trả/thu TRƯỚC phiếu này; `con_no_sau` = còn nợ SAU phiếu này. None = loại phiếu
    # không đối chiếu theo đợt/hoá đơn được (cọc, gia công, tạm ứng, thu khác…).
    truoc_do: int | None = None
    con_no_sau: int | None = None
    # Phiếu gộp: đối chiếu của từng dòng trả đợt.
    doi_chieu: list[DoiChieuDongChiOut] = Field(default_factory=list)


class GiaCongChoChiOut(BaseModel):
    gia_cong_ngoai_id: int
    lsx_id: int | None = None
    lsx_ma: str
    bai_ghep_id: int | None = None
    nhan_nguon: str = ""
    ten_viec: str
    nha_cung_cap_id: int | None = None
    nha_cung_cap_ten: str
    sl_cuoi: float
    don_vi: str | None = None
    chot_luc: datetime | None = None
    chot_boi_ten: str | None = None


class CocChoThuOut(BaseModel):
    """Một dòng "cọc chờ thu" — đơn đã chốt, cọc chưa đủ (17/10/2026)."""
    order_id: int
    order_code: str
    customer_id: int | None = None
    customer_name: str | None = None
    deposit_pct: float | None = None
    deposit_amount: int | None = None
    can_thu: int
    da_thu: int
    con_thieu: int
    ordered_at: datetime | None = None


class HoaDonChoThuOut(BaseModel):
    """Một dòng "hoá đơn chờ thu" — hoá đơn còn hiệu lực khách chưa trả hết."""
    invoice_id: int
    invoice_symbol: str
    invoice_number: str
    invoice_date: date
    due_date: date | None = None
    order_id: int
    order_code: str
    customer_id: int | None = None
    customer_name: str | None = None
    amount: int
    direct_received_amount: int
    deposit_offset_amount: int
    hoan_khong_don: int = 0
    da_thu: int
    con_no: int


class DonHangChoThuOut(BaseModel):
    """Mục "Đơn hàng chờ thu" của màn Phiếu thu."""
    coc: list[CocChoThuOut]
    hoa_don: list[HoaDonChoThuOut]


class TraLaiKhachChoChiOut(BaseModel):
    """Một dòng "Chờ trả lại khách" của màn Phiếu chi — đơn hết chỗ ghi hoá đơn mà tiền khách còn dư."""
    order_id: int
    order_code: str
    don_huy: bool
    customer_id: int | None = None
    customer_name: str | None = None
    hoa_don_huy: list[str] = []
    da_tra_lai: int
    con_lai: int


class GiaCongChoChiDemOut(BaseModel):
    so: int


# --- MỘT phiếu chi trả NHIỀU khoản của cùng một NCC (17/10/2026: "một phiếu cho cả lượt") ---


class PhieuChiGopDongIn(BaseModel):
    purchase_request_id: int = Field(gt=0)
    #: Bỏ trống = trả CỌC của đơn; có = trả cho đợt giao đó.
    delivery_id: int | None = Field(default=None, gt=0)
    amount: int = Field(gt=0)


class PhieuChiGopIn(BaseModel):
    lines: list[PhieuChiGopDongIn] = Field(min_length=1, max_length=50)
    # Phần CHUNG của cả phiếu — hình thức chi, người nhận/tài khoản, định khoản. Chỉ VND.
    voucher_type: str = Field(min_length=1, max_length=24)
    voucher_date: date
    #: Bỏ trống thì máy đặt "Thanh toán {mã đơn} đợt {n}, … và …".
    content: str | None = Field(default=None, max_length=500)
    invoice_number: str | None = Field(default=None, max_length=64)
    invoice_date: date | None = None
    contract_number: str | None = Field(default=None, max_length=64)
    company_bank_account_id: int | None = Field(default=None, gt=0)
    supplier_bank_account_id: int | None = Field(default=None, gt=0)
    cash_recipient_name: str | None = Field(default=None, max_length=255)
    cash_recipient_address: str | None = Field(default=None, max_length=500)
    cash_recipient_identity: str | None = Field(default=None, max_length=64)
    beneficiary_account_holder: str | None = Field(default=None, max_length=255)
    beneficiary_account_number: str | None = Field(default=None, max_length=64)
    beneficiary_bank_name: str | None = Field(default=None, max_length=255)
    beneficiary_bank_branch: str | None = Field(default=None, max_length=255)
    bank_fee_bearer: str | None = Field(default=None, max_length=16)
    debit_account: str | None = Field(default=None, max_length=64)
    credit_account: str | None = Field(default=None, max_length=64)
    note: str | None = Field(default=None, max_length=2000)


# --- Chi chiết khấu / kê theo hóa đơn đã thu đủ (20/10/2026) ---


class CkKeChoChiRow(BaseModel):
    sales_invoice_id: int
    invoice_symbol: str | None = None
    invoice_number: str
    invoice_date: date
    order_id: int
    order_code: str
    customer_id: int | None = None
    customer_name: str
    #: `chiet_khau` | `ke_gia`.
    loai: str
    #: Tiền CK / kê của hóa đơn (trước VAT); `thue_tndn` chỉ có ở kê.
    tien: int
    thue_tndn: int = 0
    phai_chi: int
    da_chi: int
    con: int


class CkKeChoChiOut(BaseModel):
    items: list[CkKeChoChiRow]


class PhieuChiCkKeDongIn(BaseModel):
    sales_invoice_id: int = Field(gt=0)
    amount: int = Field(gt=0)


class PhieuChiCkKeIn(BaseModel):
    loai: str = Field(pattern="^(chiet_khau|ke_gia)$")
    dong: list[PhieuChiCkKeDongIn] = Field(min_length=1, max_length=50)
    voucher_type: str = Field(min_length=1, max_length=24)
    voucher_date: date
    #: Bỏ trống thì máy đặt "Chi chiết khấu hóa đơn …".
    content: str | None = Field(default=None, max_length=500)
    company_bank_account_id: int | None = Field(default=None, gt=0)
    #: Chiết khấu: máy khoá theo tên khách. Kê: bắt buộc gõ.
    cash_recipient_name: str | None = Field(default=None, max_length=255)
    cash_recipient_address: str | None = Field(default=None, max_length=500)
    cash_recipient_identity: str | None = Field(default=None, max_length=64)
    beneficiary_account_holder: str | None = Field(default=None, max_length=255)
    beneficiary_account_number: str | None = Field(default=None, max_length=64)
    beneficiary_bank_name: str | None = Field(default=None, max_length=255)
    beneficiary_bank_branch: str | None = Field(default=None, max_length=255)
    bank_fee_bearer: str | None = Field(default=None, max_length=16)
    debit_account: str | None = Field(default=None, max_length=64)
    credit_account: str | None = Field(default=None, max_length=64)
    note: str | None = Field(default=None, max_length=2000)


class VoucherFromAdvancesBatchIn(BaseModel):
    """Chi MỘT LƯỢT cho nhiều phiếu tạm ứng đã duyệt ⇒ MỘT phiếu chi cho cả lô (25/09/2026). Chỉ
    phần CHUNG — số tiền (tổng lô), người nhận ("Theo bảng kê…"), nội dung máy tự điền."""
    salary_advance_ids: list[int] = Field(min_length=1, max_length=3000)
    voucher_type: str = Field(min_length=1, max_length=24)
    voucher_date: date
    company_bank_account_id: int | None = Field(default=None, gt=0)
    note: str | None = Field(default=None, max_length=2000)


class BangKeTamUngRowOut(BaseModel):
    salary_advance_id: int
    ma_phieu: str | None = None
    kind: str = "tam_ung"
    employee_id: int
    ma_nv: str | None = None
    ten: str | None = None
    department_id: int | None = None
    department_name: str | None = None      # router fills
    so_tien: int
    so_tai_khoan: str | None = None
    ngan_hang: str | None = None


class BangKeTamUngOut(BaseModel):
    """Bảng kê đính kèm phiếu chi một lượt (25/09/2026) — in kèm phiếu 02-TT / UNC của cả lô."""
    voucher_id: int
    code: str
    doc_no: str | None = None
    voucher_type: str
    voucher_date: date | None = None
    content: str | None = None
    status: str
    so_nguoi: int
    tong: int
    rows: list[BangKeTamUngRowOut]


class VoucherBatchOut(BaseModel):
    vouchers: list[PaymentVoucherOut]
    total_amount: int = 0


class TheLocOut(BaseModel):
    """Số trên hàng thẻ lọc của Phiếu chi / Phiếu thu. Đếm trên bộ lọc KHÔNG gồm trạng thái, nên
    chọn một thẻ không làm các thẻ còn lại sập về 0."""

    tat_ca: int = 0
    xong: int = 0
    xong_tien: int = 0
    da_huy: int = 0
    cho: int = 0


class PaymentVoucherListOut(BaseModel):
    items: list[PaymentVoucherOut]
    total: int
    page: int
    size: int
    # Tổng tiền trên TOÀN BỘ kết quả khớp bộ lọc (mọi trang) — quy đổi VND.
    total_paid_amount: int = 0
    total_waiting_amount: int = 0
    total_receipt_received_amount: int = 0
    the_loc: TheLocOut = TheLocOut()


class PaymentVoucherAttachmentOut(BaseModel):
    id: int
    payment_voucher_id: int
    file_name: str
    file_url: str
    file_type: str | None = None
    uploaded_by: int | None = None
    uploaded_at: datetime | None = None


class PaymentVoucherAttachmentListOut(BaseModel):
    items: list[PaymentVoucherAttachmentOut]


class PaymentReceiptIn(BaseModel):
    payer_name: str = Field(min_length=1, max_length=255)
    # Ô "Địa chỉ" của mẫu 01-TT — không bắt buộc.
    payer_address: str | None = Field(default=None, max_length=500)
    receipt_method: str = Field(min_length=1, max_length=24)
    receipt_date: date
    debit_account: str | None = Field(default=None, max_length=64)
    credit_account: str | None = Field(default=None, max_length=64)
    amount: int = Field(gt=0)
    # None → dùng tỷ giá của phiếu chi gốc.
    exchange_rate: float | None = Field(default=None, gt=0)
    content: str = Field(min_length=1, max_length=500)
    company_bank_account_id: int | None = Field(default=None, gt=0)
    bank_reference: str | None = Field(default=None, max_length=64)
    note: str | None = Field(default=None, max_length=2000)
    # Mục thu — phiếu thu lập tay bắt buộc; phiếu theo hoá đơn / cọc / NCC hoàn tiền bỏ qua — mục
    # của nó là mục cố định theo nguồn.
    muc_thu_chi_id: int | None = Field(default=None, gt=0)


class PhieuThuGopDongIn(BaseModel):
    #: Có = thu cho hoá đơn đó (đơn suy từ hoá đơn); trống = thu CỌC của `order_id`.
    sales_invoice_id: int | None = Field(default=None, gt=0)
    order_id: int | None = Field(default=None, gt=0)
    amount: int = Field(gt=0)


class PhieuThuGopIn(BaseModel):
    """MỘT phiếu thu cho NHIỀU khoản của cùng một khách (17/10/2026). Chỉ VND."""

    lines: list[PhieuThuGopDongIn] = Field(min_length=1, max_length=50)
    #: Trống ⇒ tên khách.
    payer_name: str | None = Field(default=None, max_length=255)
    payer_address: str | None = Field(default=None, max_length=500)
    receipt_method: str = Field(min_length=1, max_length=24)
    receipt_date: date
    debit_account: str | None = Field(default=None, max_length=64)
    credit_account: str | None = Field(default=None, max_length=64)
    #: Trống ⇒ máy đặt "Thu HĐ …, cọc đơn … và …".
    content: str | None = Field(default=None, max_length=500)
    company_bank_account_id: int | None = Field(default=None, gt=0)
    bank_reference: str | None = Field(default=None, max_length=64)
    note: str | None = Field(default=None, max_length=2000)


class HangKhoanThuOut(BaseModel):
    ten: str | None = None
    so_luong: int
    dvt: str | None = None
    don_gia: int
    vat: int = 0
    thanh_tien: int


class PhieuKhoanThuOut(BaseModel):
    receipt_id: int
    code: str
    doc_no: str | None = None
    ngay: date
    amount: int
    gop: bool = False


class ChiTietKhoanThuOut(BaseModel):
    """Popup chi tiết một khoản chờ thu — hàng của khoản + các lần đã thu."""

    hang: list[HangKhoanThuOut]
    phieu: list[PhieuKhoanThuOut]


class MarkPaymentReceiptReceivedIn(BaseModel):
    bank_reference: str | None = Field(default=None, max_length=64)


class CancelPaymentReceiptIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class PaymentReceiptLineOut(BaseModel):
    """Một dòng phân bổ của phiếu thu đơn bán. `sales_invoice_id` trống = dòng cọc của đơn."""

    order_id: int
    order_code: str | None = None
    sales_invoice_id: int | None = None
    invoice_number: str | None = None
    amount: int


class DoiChieuDongThuOut(BaseModel):
    order_code: str | None = None
    invoice_number: str | None = None
    truoc_do: int
    con_no_sau: int


class PaymentReceiptOut(BaseModel):
    id: int
    code: str
    doc_no: str | None = None
    customer_id: int | None = None
    lines: list[PaymentReceiptLineOut] = Field(default_factory=list)
    #: Phiếu gộp: đối chiếu theo từng hoá đơn mà phiếu trả.
    doi_chieu: list[DoiChieuDongThuOut] = Field(default_factory=list)
    # Nguồn: purchase_refund | order_deposit | sales_invoice | other.
    source_type: str = "purchase_refund"
    muc_thu_chi_id: int | None = None
    muc_thu_chi_ten: str | None = None
    # Nhánh Phiếu chi — nullable từ V5 (phiếu thu cọc đơn không có phiếu chi/PMH/NCC).
    payment_voucher_id: int | None = None
    payment_voucher_code: str | None = None
    purchase_request_id: int | None = None
    purchase_request_code: str | None = None
    #: NCC của phiếu nhà cung cấp hoàn tiền (gắn thẳng hoặc suy từ phiếu chi gốc).
    supplier_id: int | None = None
    supplier_name: str | None = None
    # Nhánh Đơn hàng bán (V5) — None với phiếu thu nguồn Phiếu chi.
    order_id: int | None = None
    order_code: str | None = None
    customer_name: str | None = None
    sales_invoice_id: int | None = None
    sales_invoice_number: str | None = None
    payer_name: str
    payer_address: str | None = None
    debit_account: str | None = None
    credit_account: str | None = None
    receipt_method: str
    status: str
    receipt_date: date
    amount: int
    amount_vnd: int
    currency: str
    exchange_rate: float
    content: str
    company_bank_account_id: int | None = None
    company_account_holder: str | None = None
    company_account_number: str | None = None
    company_bank_name: str | None = None
    company_bank_branch: str | None = None
    bank_reference: str | None = None
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    received_by_user_id: int | None = None
    received_by_name: str | None = None
    received_at: datetime | None = None
    cancelled_by_user_id: int | None = None
    cancelled_by_name: str | None = None
    cancelled_at: datetime | None = None
    cancel_reason: str | None = None
    note: str | None = None
    attachment_count: int = 0
    created_at: datetime
    updated_at: datetime
    # Bảng đối chiếu trong ngăn — CHỈ route đọc một phiếu mới điền (danh sách để None, tránh N truy vấn).
    # `truoc_do` = đã trả/thu TRƯỚC phiếu này; `con_no_sau` = còn nợ SAU phiếu này. None = loại phiếu
    # không đối chiếu theo đợt/hoá đơn được (cọc, gia công, tạm ứng, thu khác…).
    truoc_do: int | None = None
    con_no_sau: int | None = None


class PaymentReceiptListOut(BaseModel):
    items: list[PaymentReceiptOut]
    total: int
    page: int
    size: int
    # Tổng tiền các phiếu ĐÃ THU khớp bộ lọc (mọi trang) — quy đổi VND.
    total_received_amount: int = 0
    the_loc: TheLocOut = TheLocOut()


class PaymentReceiptAttachmentOut(BaseModel):
    id: int
    payment_receipt_id: int
    file_name: str
    file_url: str
    file_type: str | None = None
    uploaded_by: int | None = None
    uploaded_at: datetime | None = None


class PaymentReceiptAttachmentListOut(BaseModel):
    items: list[PaymentReceiptAttachmentOut]


# --- Hóa đơn bán ------------------------------------------------------------


class SalesInvoiceIn(BaseModel):
    order_id: int = Field(gt=0)
    invoice_symbol: str = Field(min_length=1, max_length=64)
    invoice_number: str = Field(min_length=1, max_length=64)
    invoice_date: date
    # Lượt giao khách đã nhận mà hóa đơn lập cho — service bắt buộc (mg 0402).
    delivery_trip_id: int | None = Field(default=None, gt=0)
    # Bỏ trống = toàn bộ phần hàng đã giao của lượt chưa ghi hóa đơn.
    amount_vnd: int | None = Field(default=None, gt=0)


class CancelSalesInvoiceIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class SalesInvoiceOut(BaseModel):
    id: int
    order_id: int
    order_code: str
    customer_id: int | None = None
    customer_name: str
    invoice_symbol: str | None = None
    invoice_number: str
    invoice_date: date
    amount_vnd: int
    payment_term_days_snapshot: int | None = None
    due_date: date | None = None
    status: str
    direct_received_amount: int = 0
    deposit_offset_amount: int = 0
    received_amount: int = 0
    remaining_amount: int = 0
    #: Tiền trả lại khách không gắn đơn cộng nợ lại vào hoá đơn này (17/10/2026).
    hoan_khong_don: int = 0
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime
    cancelled_by_user_id: int | None = None
    cancelled_by_name: str | None = None
    cancelled_at: datetime | None = None
    cancel_reason: str | None = None
    delivery_trip_id: int | None = None
    luot_giao_ma: str | None = None
    # Chiết khấu / kê của hóa đơn (20/10/2026) — trước VAT; kê chi lại sau khi trừ thuế TNDN.
    chiet_khau: int = 0
    ke_gia: int = 0
    ke_thue_tndn_pct: float | None = None
    ke_thue_tndn: int = 0
    ck_da_chi: int = 0
    ke_da_chi: int = 0


class LuotGiaoHoaDonOut(BaseModel):
    trip_id: int
    ma: str
    ngay_giao: date | None = None
    gia_tri: int
    da_ghi: int
    con_ghi: int


class PhieuThuHoaDonOut(BaseModel):
    """Một phiếu thu ĐÃ THU gắn thẳng vào hoá đơn của đơn (không gồm cọc)."""

    id: int
    code: str
    doc_no: str | None = None
    invoice_id: int
    amount: int
    receipt_date: date
    #: Phiếu gộp nhiều chứng từ — `amount` là phần của hoá đơn này.
    gop: bool = False


class SalesInvoiceListOut(BaseModel):
    order_id: int
    order_code: str
    order_total: int
    invoiced_amount: int
    uninvoiced_amount: int
    deposit_received: int
    payment_term_days: int | None = None
    last_invoice_symbol: str | None = None
    delivered_amount: int = 0
    invoiceable_amount: int = 0
    #: Tiền khách đưa dư còn phải trả lại (cùng số với hàng Chờ trả lại khách ở Phiếu chi).
    cho_tra_lai: int = 0
    luot_giao: list[LuotGiaoHoaDonOut] = []
    phieu_thu: list[PhieuThuHoaDonOut] = []
    phieu_thu_hd_huy: list[PhieuThuHoaDonOut] = []
    items: list[SalesInvoiceOut]


# --- Công nợ phải trả ------------------------------------------------------
# Không có bảng công nợ: các số dưới đây SUY RA từ phiếu mua + phiếu chi lúc gọi API.


class AgingCellOut(BaseModel):
    """Một ô rổ tuổi: tiền + SỐ ĐỢT. Thiếu số đợt thì 20 triệu không phân biệt được là một đợt to
    hay mười đợt vụn — hai ca đó gọi điện đòi nợ khác hẳn nhau."""

    amount: int = 0
    count: int = 0


class AgingBucketOut(AgingCellOut):
    """Một RỔ TUỔI kèm NHÃN và biên ngày.

    Nhãn/biên do SERVER phát (`accounting_service.AGING_BUCKETS`) — giao diện in thẳng chứ không
    gõ lại "1–7". Hai nơi gõ tay là hai nơi lệch nhau ngay lần đầu đổi mốc."""

    key: str
    label: str
    # None = không có cận (dưới cho rổ "chưa tới hạn", trên cho rổ "> 60 ngày").
    min_days: int | None = None
    max_days: int | None = None


class PayableSupplierOut(BaseModel):
    supplier_id: int | None = None
    supplier_name: str
    order_count: int
    # Nợ đã QUÁ HẠN trả (theo hạn của từng đợt giao) và phần chưa tới hạn. Cộng lại = `total_due`.
    overdue_amount: int
    no_han_amount: int = 0
    # Rổ tuổi của RIÊNG NCC này (khoá → tiền + số đợt). Tổng 5 rổ trễ = `overdue_amount`, rổ
    # "chưa tới hạn" = `no_han_amount` — cùng một phép đếm, chỉ xé nhỏ ra.
    aging: dict[str, AgingCellOut] = Field(default_factory=dict)
    credit_limit: int = 0
    credit_days: int | None = None
    # Cảnh báo MỀM: chỉ gắn cờ, không chặn lập/duyệt phiếu ở đâu cả (Đ6).
    vuot_han_muc: bool = False
    vuot_bao_nhieu: int = 0
    # Tiền ĐÃ CHI trong kỳ. NCC trả hết vẫn giữ được dòng nhờ số này ⇒ "đã trả hết" là thứ NHÌN
    # THẤY, không phải suy ra từ việc không thấy gì.
    paid_in_period: int = 0
    #: Hàng nhận thêm trong kỳ (PS Có TK 331). Chỉ có số khi gọi CÓ kỳ; không kỳ = 0.
    mua_trong_ky: int = 0
    #: Hạn trả gần nhất trong các đợt CÒN NỢ — luôn theo HÔM NAY. None = không đợt nào có hạn.
    han_gan_nhat: date | None = None
    total_due: int
    # Bảng đủ cột (06/10/2026): mã + liên hệ của NCC, lần TRẢ gần nhất (cả lịch sử, không theo kỳ).
    supplier_code: str | None = None
    lien_he_ten: str | None = None
    lien_he_sdt: str | None = None
    tra_gan_nhat_ngay: date | None = None
    tra_gan_nhat_tien: int = 0


class TheLocCongNoOut(BaseModel):
    """Số trên nhóm nút "Tất cả | Quá hạn | Vượt hạn mức" của hai màn công nợ — đếm sau tìm / kỳ /
    bộ lọc nâng cao / rổ tuổi, TRƯỚC nút đang chọn (`filter`)."""

    tat_ca: int = 0
    qua_han: int = 0
    vuot_han_muc: int = 0


class TheLocPhaiThuOut(TheLocCongNoOut):
    #: Số khách còn giữ cọc của đơn đã huỷ — nút "Còn giữ cọc đơn huỷ" (13/10/2026).
    tra_coc: int = 0


class TongLocCongNoOut(BaseModel):
    """Tổng của MỌI dòng khớp bộ lọc (trước khi cắt trang) — dòng Cộng của bảng. Khác số tổng đầu
    màn (`total_due`, `aging`…) vốn không theo bộ lọc nâng cao."""

    so_doi_tac: int
    so_khoan: int          # phải trả: số đợt còn nợ; phải thu: số hoá đơn còn nợ
    con_no: int
    aging: dict[str, int]  # khoá như AGING_KEYS: chua_toi_han, d1_7, d8_15, d16_30, d31_60, d60_plus
    qua_han: int
    trong_ky_1: int        # mua/bán trong kỳ
    trong_ky_2: int        # trả/thu trong kỳ


class PayablesSummaryOut(BaseModel):
    items: list[PayableSupplierOut]
    total: int
    page: int
    size: int
    pages: int
    total_due: int
    overdue_amount: int
    # PHÂN TUỔI toàn màn — tính trên TOÀN BỘ NCC đang nợ, không đổi theo trang hay bộ lọc.
    # `overdue_amount` ở trên GIỮ NGUYÊN nghĩa cũ và luôn = tổng 5 rổ trễ trong này.
    aging: list[AgingBucketOut] = Field(default_factory=list)
    paid_in_period: int = 0
    mua_trong_ky: int = 0
    vuot_han_muc_count: int = 0
    the_loc: TheLocCongNoOut = Field(default_factory=TheLocCongNoOut)
    #: Dòng Cộng theo bộ lọc. None khi `dem_only` / `chi_tong` (hai lối nhanh không tính).
    tong_loc: TongLocCongNoOut | None = None
    period_months: int = 3
    #: Kỳ đã dùng để tính. Không truyền kỳ thì là [hôm nay − 3 tháng, hôm nay].
    tu_ngay: date | None = None
    den_ngay: date | None = None
    as_of: date


class PayableDeliveryLineOut(BaseModel):
    """Một mặt hàng trong đợt giao — BÀY trong popup "Hàng đã nhận", không nuôi phép tính nào ở
    tầng khác (`con_no`/`amount` của đợt tính riêng, không cộng ngược từ đây)."""

    item_name: str
    #: MÃ đơn vị (`cai`), tên hiển thị ("cái") tra ở danh mục — xem `pages/tenDonVi.ts`.
    unit: str
    quantity: float
    #: Đơn giá đã chốt trên phiếu mua (04/09/2026).
    unit_price: int = 0
    #: Thành tiền THẬT của dòng này trong đợt — sau chiết khấu/VAT, và CHỈ TÍNH phần không rơi
    #: vào `du`. KHÔNG phải `quantity × unit_price` — nếu có phần dư, phép nhân thô sẽ RA SỐ SAI.
    thanh_tien: int = 0
    #: Phần giao VƯỢT số đặt, tính 0đ (chủ chốt 28/08/2026 — "cho điền tự do, vượt thì hệ tự tính
    #: phần dư"). > 0 nghĩa là NCC giao nhiều hơn đơn đặt cho dòng này.
    du: float = 0


class PayableHoaDonFileOut(BaseModel):
    """Một file hoá đơn/biên bản NCC đính kèm vào đợt giao — CHỈ ĐỌC ở màn Công nợ (04/09/2026).

    Upload vẫn đi qua Thu mua (`DeliveryDialog.tsx` lúc ghi đợt); ở đây chỉ hiện lại."""

    id: int
    file_name: str
    file_url: str
    file_type: str | None = None


class PayableItemOut(BaseModel):
    """Một khoản CÒN NỢ — thường là một ĐỢT GIAO chưa trả hết.

    Phiếu cũ (lập trước 06/08/2026, không theo dõi theo đợt) hiện ở mức PHIẾU: `delivery_id` NULL,
    `chua_dat_han` True. Không có hạn trả nên không bao giờ vào cột Quá hạn — vì thế nó phải nổi
    lên đầu danh sách chứ không được chìm."""

    purchase_request_id: int
    code: str
    status: str
    #: Hàng của đợt. RỖNG với dòng "cả đơn" (phiếu cũ không theo dõi theo đợt).
    lines: list[PayableDeliveryLineOut] = Field(default_factory=list)
    delivery_id: int | None = None
    seq_no: int | None = None
    delivery_date: date | None = None
    due_date: date | None = None
    chua_dat_han: bool = False
    overdue_days: int = 0
    # Khoá rổ tuổi (`AGING_KEYS` ở accounting_service.py) — CHỈ có giá trị khi `overdue_days > 0`.
    # Chụp bằng đúng `ro_tuoi()` server dùng cho dải phân tuổi tổng, để một đợt KHÔNG BAO GIỜ hiện
    # hai mức khẩn khác nhau ở hai màn — đây là đúng bài học "hai chỗ nói hai kiểu tiền" đã trả giá.
    aging_bucket: str | None = None
    invoice_symbol: str | None = None
    invoice_number: str | None = None
    invoice_date: date | None = None
    #: File hoá đơn/biên bản đã đính kèm cho đợt này (04/09/2026). RỖNG = chưa ai upload ảnh —
    #: KHÁC với `invoice_number is None` (số hoá đơn có thể đã ghi tay mà chưa có ảnh, hoặc
    #: ngược lại).
    hoa_don_files: list[PayableHoaDonFileOut] = Field(default_factory=list)
    amount: int
    # Tiền trả ĐÍCH DANH đợt này (phiếu chi có `delivery_id` trỏ đúng đợt) — cột này phải khớp
    # sao kê NCC theo từng đợt.
    paid: int = 0
    # Phần CỌC của cả đơn chiếu xuống đợt này. Cố ý tách khỏi `paid`: không ai trả riêng cho đợt
    # này số đó. Nhưng `con_no` thì đã trừ CẢ HAI.
    coc_bu: int = 0
    # Phiếu NCC hoàn tiền không gắn đơn cộng nợ lại vào đợt hạn muộn nhất (#36, 18/10/2026):
    # con_no = amount − paid − coc_bu + hoan_ncc.
    hoan_ncc: int = 0
    con_no: int
    # True = đợt đã trả hết (thường do CỌC nuốt trọn, vì cọc bù giao-trước-bù-trước). Vẫn liệt kê
    # để dò được tiền cọc đi đâu, nhưng màn hình làm mờ và xếp xuống đáy đơn — nó KHÔNG phải việc
    # phải làm. Chỉ xuất hiện ở đơn còn ít nhất một đợt chưa trả hết.
    da_tat_toan: bool = False


class PayablePaidOut(BaseModel):
    """✅ Một LẦN CHI trong kỳ. Cộng lại đúng bằng cột "Đã trả"."""

    voucher_id: int
    code: str
    doc_no: str | None = None
    voucher_type: str
    payment_stage: str | None = None
    delivery_id: int | None = None
    # Số đợt (1, 2, 3…) để màn hình ghi "Đợt 2" thay vì "trả theo đợt" chung chung — cầm sao kê
    # NCC đối chiếu thì phải biết dòng nào là đợt mấy.
    delivery_seq_no: int | None = None
    purchase_request_id: int
    purchase_code: str
    # Phần của khoản này. Phiếu GỘP (`so_dong > 1`) hiện nhiều dòng — `voucher_amount` là tổng phiếu.
    amount: int
    voucher_amount: int | None = None
    so_dong: int = 1
    invoice_number: str | None = None
    invoice_date: date | None = None
    has_attachment: bool = False
    paid_date: date
    # NGƯỜI LẬP phiếu chi — hỏi "ai duyệt cho tiền ra" thì phải trả lời được ngay tại dòng, không
    # bắt mở từng phiếu. Các màn Phiếu chi / Đơn mua hàng đã có cột này từ lâu; rổ "đã trả" ở màn
    # Công nợ phải trả là chỗ CUỐI CÙNG còn thiếu (chủ chốt 15/08/2026).
    created_by_user_id: int | None = None
    created_by_name: str | None = None


class PayableCocOut(BaseModel):
    """Một khoản ĐẶT CỌC / ứng trước cho cả đơn — không gắn đợt giao nào."""

    purchase_request_id: int
    code: str
    status: str
    amount: int
    # Phần cọc đã CHIẾU xuống các đợt của chính đơn này (giao trước bù trước) và phần còn dôi.
    # Không có hai số này thì màn hình chỉ nói "trừ 100.000" mà không nói trừ vào đâu.
    da_dung: int = 0
    con_du: int = 0


class PayablesDetailOut(BaseModel):
    supplier_id: int
    supplier_name: str
    credit_limit: int = 0
    credit_days: int | None = None
    vuot_han_muc: bool = False
    vuot_bao_nhieu: int = 0
    # Thông tin đối tác cho ngăn chi tiết (07/10/2026). `tk_nhan` = "{ngân hàng} {số tài khoản}" của
    # tài khoản MẶC ĐỊNH của NCC; không có thì None.
    lien_he_ten: str | None = None
    lien_he_sdt: str | None = None
    tk_nhan: str | None = None
    items: list[PayableItemOut]
    # CỌC / ứng trước của CẢ ĐƠN — không thuộc đợt nào nên hiện thành dòng riêng, KHÔNG nhét vào
    # cột "đã trả" của một đợt (chủ chốt 06/08/2026). Nhét vào là bảng nói dối: người đối chiếu
    # với NCC theo từng đợt sẽ không khớp được với sao kê.
    coc_chung: list[PayableCocOut] = Field(default_factory=list)
    coc_chung_amount: int = 0
    paid: list[PayablePaidOut]
    #: Tổng số lần trả trong phạm vi (kỳ / toàn bộ) — `paid` có thể chỉ là MỘT TRANG của nó
    #: (`paid_page` / `paid_size`). "Đã trả (n)" và "n lần trả" đọc số này.
    paid_total: int = 0
    period_months: int
    # True = đã bỏ mốc kỳ, rổ "đã chi" đang hiện TOÀN BỘ lịch sử (nút "Xem lịch sử cũ hơn").
    all_history: bool = False
    total_due: int
    overdue_amount: int
    # Rổ tuổi của RIÊNG NCC này, đếm trên `items` ở trên — pill và bảng dưới nó luôn cùng một số.
    aging: list[AgingBucketOut] = Field(default_factory=list)
    paid_in_period: int
    as_of: date


# --- Công nợ phải thu ------------------------------------------------------


class ReceivableCustomerOut(BaseModel):
    customer_id: int | None = None
    customer_name: str
    invoice_count: int
    invoiced_amount: int = 0
    received_amount: int = 0
    total_due: int
    overdue_amount: int
    no_han_amount: int = 0
    credit_limit: int = 0
    payment_term_days: int | None = None
    vuot_han_muc: bool = False
    vuot_bao_nhieu: int = 0
    #: 6 rổ tuổi nợ của RIÊNG khách này. Khách không nợ gì vẫn đủ 6 khoá = 0.
    aging: dict[str, AgingCellOut] = Field(default_factory=dict)
    received_in_period: int = 0
    #: Hoá đơn bán thêm trong kỳ (PS Nợ TK 131). Chỉ có số khi gọi CÓ kỳ; không kỳ = 0.
    ban_trong_ky: int = 0
    #: Hạn thu gần nhất trong các hoá đơn CÒN NỢ — luôn theo HÔM NAY.
    han_gan_nhat: date | None = None
    #: Sale phụ trách khách (`Customer.sale_user_id`).
    sale_user_id: int | None = None
    # Bảng đủ cột (06/10/2026): mã khách, liên hệ CHÍNH (không có thì ô liên hệ nhanh của khách),
    # tên sale phụ trách, lần THU gần nhất (cả lịch sử, không theo kỳ).
    customer_code: str | None = None
    lien_he_ten: str | None = None
    lien_he_sdt: str | None = None
    sale_user_name: str | None = None
    thu_gan_nhat_ngay: date | None = None
    thu_gan_nhat_tien: int = 0
    #: Σ cọc còn giữ của các đơn ĐÃ HUỶ của khách — việc kế toán phải lập phiếu chi trả lại.
    #: Tiền khách đang để ở các đơn (17/10/2026) — không trừ vào hoá đơn đơn khác; `cho_tra_lai`
    #: là phần phải trả lại ngay (đơn huỷ / đã ghi đủ hoá đơn mà vẫn dư). Nút nhóm `tra_coc` đếm số này.
    cho_tra_lai: int = 0
    tien_dang_de: int = 0


class ReceivablesSummaryOut(BaseModel):
    items: list[ReceivableCustomerOut]
    total: int
    page: int
    size: int
    pages: int
    total_due: int
    overdue_amount: int
    received_in_period: int = 0
    ban_trong_ky: int = 0
    vuot_han_muc_count: int = 0
    the_loc: TheLocPhaiThuOut = Field(default_factory=TheLocPhaiThuOut)
    #: Dòng Cộng theo bộ lọc. None khi `dem_only` / `chi_tong` (hai lối nhanh không tính).
    tong_loc: TongLocCongNoOut | None = None
    #: Rổ tuổi TOÀN MÀN. Tổng 5 rổ trễ luôn bằng `overdue_amount`, rổ "chưa tới hạn" bằng phần
    #: còn lại — hai chỗ nói hai kiểu tiền là lỗi nặng nhất của màn này.
    aging: list[AgingBucketOut] = Field(default_factory=list)
    period_months: int = 3
    tu_ngay: date | None = None
    den_ngay: date | None = None
    as_of: date


class ReceivableItemOut(BaseModel):
    invoice_id: int
    invoice_symbol: str | None = None
    invoice_number: str
    invoice_date: date
    order_id: int
    order_code: str
    customer_id: int | None = None
    customer_name: str
    due_date: date | None = None
    chua_dat_han: bool = False
    overdue_days: int = 0
    # Khoá rổ tuổi (`AGING_KEYS`) — CHỈ có giá trị khi `overdue_days > 0`. Chụp bằng đúng
    # `ro_tuoi()` server dùng cho dải tổng, để một hoá đơn KHÔNG BAO GIỜ hiện hai mức khẩn khác
    # nhau ở hai màn — cùng bài học đã trả giá bên phải trả.
    aging_bucket: str | None = None
    amount: int
    direct_received_amount: int = 0
    deposit_offset_amount: int = 0
    received_amount: int = 0
    remaining_amount: int
    #: Tiền trả lại khách không gắn đơn cộng nợ lại vào hoá đơn này (17/10/2026).
    hoan_khong_don: int = 0


class ReceivableReceiptOut(BaseModel):
    receipt_id: int
    code: str
    doc_no: str | None = None
    order_id: int | None = None
    order_code: str | None = None
    source_type: str
    sales_invoice_id: int | None = None
    sales_invoice_number: str | None = None
    applied_to: str
    receipt_method: str
    amount: int
    receipt_date: date
    payer_name: str
    bank_reference: str | None = None
    created_by_name: str | None = None
    #: Phiếu gộp: `amount` là phần của dòng này, `receipt_amount` là cả phiếu, `so_dong` số khoản.
    receipt_amount: int | None = None
    so_dong: int = 1


class TienDangDeOut(BaseModel):
    """Một đơn còn đang để tiền khách (cọc + tiền hoá đơn đã huỷ − đã trả lại − đã trừ vào hoá
    đơn, 17/10/2026) — khối "Tiền khách đang để" của ngăn Công nợ phải thu. `con_lai` > 0 thì
    lập phiếu trả lại theo đơn; `tinh_trang`: don_huy / ghi_du / cho_tru."""

    order_id: int
    order_code: str
    da_nhan: int
    da_tra_lai: int = 0
    da_tru: int = 0
    dang_de: int
    con_lai: int
    tinh_trang: str


class ReceivablesDetailOut(BaseModel):
    customer_id: int
    customer_name: str
    credit_limit: int = 0
    payment_term_days: int | None = None
    vuot_han_muc: bool = False
    vuot_bao_nhieu: int = 0
    # Thông tin đối tác cho ngăn chi tiết (07/10/2026): liên hệ chính + sale phụ trách khách.
    lien_he_ten: str | None = None
    lien_he_sdt: str | None = None
    phu_trach: str | None = None
    items: list[ReceivableItemOut]
    paid: list[ReceivableReceiptOut]
    #: Tổng số lần thu trong phạm vi (kỳ / toàn bộ) — `paid` có thể chỉ là MỘT TRANG của nó
    #: (`paid_page` / `paid_size`). "Đã thu (n)" và "n lần thu" đọc số này.
    paid_total: int = 0
    period_months: int
    all_history: bool = False
    total_due: int
    overdue_amount: int
    #: Rổ tuổi của riêng khách này, dựng từ chính `items` — không tính lại đồng nào.
    aging: list[AgingBucketOut] = Field(default_factory=list)
    received_in_period: int
    as_of: date
    #: Tiền khách đang để ở từng đơn (17/10/2026) — đơn còn phải trả lại có nút "Trả lại" gắn đúng đơn.
    tien_dang_de: list[TienDangDeOut] = Field(default_factory=list)


# --- báo cáo tổng hợp công nợ theo kỳ (docs/prd-bao-cao-cong-no.md §5.1) ------------------


class CongNoDongOut(BaseModel):
    """MỘT dòng của sổ tổng hợp = một đối tượng, 6 cột tiền.

    `doi_tuong_id = None` là dòng gom các khoản KHÔNG truy được về khách/NCC nào (§❸) — giao diện
    phải hiện nó ở cuối và KHÔNG cho bấm vào xem chi tiết, vì nó không trỏ tới ai cả.

    Số ÂM không bao giờ xuất hiện: âm thì nhảy sang cột bên kia (luật sổ Nợ/Có).
    """

    doi_tuong_id: int | None = None
    #: Mã khách/NCC. NULL = chưa đặt mã — vẫn hiện dòng, chỉ là không đối chiếu mã với MISA được.
    ma: str | None = None
    ten: str
    #: `131` (phải thu) hoặc `331` (phải trả). Cứng — hệ chưa có danh mục tài khoản kế toán.
    tk: str
    dau_no: int = 0
    dau_co: int = 0
    ps_no: int = 0
    ps_co: int = 0
    #: Tiền HOÀN trong kỳ, đã nằm trong PS (131: hoàn cho khách ở PS Nợ; 331: NCC hoàn ở PS Có).
    #: Giao diện trừ ra khỏi Bán ra / Nhận hàng và tính là thu âm / trả âm. File MISA không dùng.
    hoan: int = 0
    cuoi_no: int = 0
    cuoi_co: int = 0
    #: 6 rổ tuổi của RIÊNG đối tượng này, tính trên dư CUỐI kỳ TẠI `den_ngay`. Đủ 6 khoá kể cả
    #: khi không nợ gì — thiếu khoá là giao diện in "NaN đ".
    aging: dict[str, AgingCellOut] = Field(default_factory=dict)


class CongNoTongOut(BaseModel):
    """Dòng TỔNG CỘNG. Cộng theo TỪNG CỘT, không cộng ròng rồi tách lại — một khách dư Nợ 10 và
    một khách dư Có 10 phải ra "10 Nợ và 10 Có", không phải 0."""

    so_dong: int = 0
    dau_no: int = 0
    dau_co: int = 0
    ps_no: int = 0
    ps_co: int = 0
    hoan: int = 0
    cuoi_no: int = 0
    cuoi_co: int = 0


class BaoCaoCongNoOut(BaseModel):
    """Sổ tổng hợp công nợ một kỳ. Khuôn bám sát bản xuất MISA để dán thẳng vào hồ sơ."""

    tk: str
    tieu_de: str
    #: Nhãn hai cột đầu — khác nhau giữa hai báo cáo ("Mã khách hàng" vs "Mã nhà cung cấp"), để
    #: giao diện dùng CHUNG một component mà vẫn in đúng chữ.
    nhan_ma: str
    nhan_ten: str
    tu_ngay: date
    den_ngay: date
    items: list[CongNoDongOut]
    tong: CongNoTongOut
    #: Dải rổ tuổi TOÀN MÀN, có nhãn sẵn. Tính TẠI `den_ngay` chứ không phải hôm nay — đó là chỗ
    #: khác hẳn dải rổ ở màn Công nợ (§5.3).
    aging: list[AgingBucketOut] = Field(default_factory=list)
    #: Tiền từng rổ tuổi của MỌI dòng khớp bộ lọc (dòng Cộng của lưới) — khác `aging` (toàn màn).
    tong_aging: dict[str, int] = Field(default_factory=dict)
    #: Số dòng mỗi mục lọc nhanh (`all` · `con_no` · `qua_han` · `tra_truoc`), đếm theo ô tìm + rổ tuổi.
    dem_the: dict[str, int] = Field(default_factory=dict)
    #: Số dòng khớp bộ lọc (mọi trang) + trang đang trả. Không gửi `size` thì `items` là tất cả.
    total: int = 0
    page: int = 1
    size: int = 0


class KhoanConNoOut(BaseModel):
    """Một đợt giao (331) / hoá đơn bán (131) CÒN NỢ tại ngày cuối kỳ — tab "Đợt còn nợ"."""

    so_ct: str
    #: Ngày hàng về (331) / ngày hoá đơn (131).
    ngay: date
    #: `None` = chưa đặt hạn (NCC chưa khai số ngày cho nợ, hoá đơn không có hạn).
    han: date | None = None
    con_no: int
    #: Số ngày trễ tại `den_ngay`; âm = còn bấy nhiêu ngày mới tới hạn; `None` = chưa đặt hạn.
    tre_ngay: int | None = None
    #: Khoá rổ tuổi (`AGING_BUCKETS`) — khớp đúng cột tuổi nợ của dòng bên sổ tổng hợp.
    ro: str


class KhoanConNoListOut(BaseModel):
    den_ngay: date
    items: list[KhoanConNoOut] = Field(default_factory=list)
    #: Tổng các khoản — bằng tổng 6 cột tuổi nợ của dòng đó bên sổ tổng hợp.
    tong: int = 0


class SoChiTietDongOut(BaseModel):
    """Một chứng từ trong sổ chi tiết. `no`/`co` là số của CHÍNH chứng từ, `luy_ke_*` là số dư
    SAU khi ghi nó — đúng khuôn sổ chi tiết công nợ của kế toán."""

    ngay: date
    #: Giờ:phút GHI NHẬN — phiếu chi/thu là lúc tiền chạy (`paid_at`/`received_at`), còn lại là
    #: lúc nhập vào hệ (`created_at`). NGÀY nghiệp vụ trong hệ vốn không có giờ, nên đây là thứ
    #: duy nhất tách được thứ tự nhiều chứng từ cùng một ngày. `None` = dữ liệu cũ chưa có mốc.
    luc: datetime | None = None
    #: `hoa_don` · `phieu_thu` · `dot_giao` · `phieu_chi` · `hoan_tien` — giao diện đổi ra nhãn.
    loai: str
    so_ct: str
    #: Dòng hoá đơn bán: ký hiệu (đã nằm đầu `so_ct`) và đơn bán của hoá đơn — sao kê tách cột
    #: Ký hiệu và cho bấm số hoá đơn mở đơn. Dòng đợt giao (phải trả): ký hiệu hoá đơn của đợt.
    ky_hieu: str | None = None
    don_id: int | None = None
    #: Chỉ dòng đợt giao (phải trả): số + ngày hoá đơn NCC của đợt (ngày của dòng là ngày nhận
    #: hàng) và mã đơn mua để bấm mở.
    so_hoa_don: str | None = None
    ngay_hoa_don: date | None = None
    don_ma: str | None = None
    dien_giai: str
    no: int = 0
    co: int = 0
    luy_ke_no: int = 0
    luy_ke_co: int = 0


class SoChiTietCongNoOut(BaseModel):
    """Sổ chi tiết công nợ của MỘT đối tượng (PRD §5.1).

    `cuoi_no`/`cuoi_co` LUÔN bằng ô "Dư cuối kỳ" của chính đối tượng đó bên sổ tổng hợp — hai bên
    đọc chung một luồng chứng từ. Lệch nhau là có chứng từ rơi mất.
    """

    tk: str
    tieu_de: str
    #: `None` = dòng gom các khoản không truy được về đối tượng nào.
    doi_tuong_id: int | None = None
    ma: str | None = None
    ten: str
    tu_ngay: date
    den_ngay: date
    dau_no: int = 0
    dau_co: int = 0
    dong: list[SoChiTietDongOut] = Field(default_factory=list)
    #: Số chứng từ phát sinh trong kỳ (mọi trang). Có gửi `size` thì `dong` là MỘT trang, mới nhất
    #: lên đầu; không gửi thì `dong` là cả sổ theo thứ tự thời gian như trước.
    so_dong: int = 0
    ps_no: int = 0
    ps_co: int = 0
    #: Tiền HOÀN trong kỳ, đã nằm trong PS (131: hoàn cho khách ở PS Nợ; 331: NCC hoàn ở PS Có).
    #: Giao diện trừ ra khỏi Bán ra / Nhận hàng và tính là thu âm / trả âm. File MISA không dùng.
    hoan: int = 0
    cuoi_no: int = 0
    cuoi_co: int = 0


class CongNoKhoaSoIn(BaseModel):
    #: PHÂN HỆ bị khoá — BẮT BUỘC. Hai sổ độc lập: chốt 331 không được kéo theo 131
    #: (chủ báo 04/09/2026: *"2 cái này nó khác nhau mà"*).
    phan_he: Literal["phai_thu", "phai_tra"]
    tu_ngay: date
    den_ngay: date
    hanh_dong: Literal["khoa", "mo"] = "khoa"
    ten: str | None = None


class CongNoKhoaSoRow(BaseModel):
    id: int
    #: `None` = bản ghi CŨ sinh trước khi tách phân hệ ⇒ nó khoá CẢ HAI sổ.
    phan_he: str | None = None
    tu_ngay: date
    den_ngay: date
    hanh_dong: str
    nguoi_khoa_ten: str | None = None
    khoa_luc: datetime
    ten: str | None = None


class CongNoKyRow(BaseModel):
    tu_ngay: date
    den_ngay: date
    ten: str | None = None
    #: Khóa TRỌN khoảng — mọi ngày trong kỳ đều đang khóa.
    da_khoa: bool
    #: Khóa MỘT PHẦN. Ba trạng thái chứ không phải hai: gộp "một phần" vào "chưa khóa" là giấu
    #: mất chuyện nửa kỳ đã chốt, mà đó đúng lúc kế toán cần biết nhất (sửa 04/09/2026).
    khoa_mot_phan: bool = False
    #: Kỳ ĐANG CHẠY (chứa hôm nay) ⇒ `den_ngay` dừng ở hôm nay, không phải cuối tháng.
    dang_dien_ra: bool = False
    #: Mở lại được không. Chỉ kỳ MỚI NHẤT mở được — kỳ chốt sau lấy số dư đầu kỳ từ kỳ trước,
    #: mở ngược là số của kỳ sau sai theo mà không có gì báo.
    co_the_mo: bool = False
    khoa_luc: datetime | None = None


class CongNoKhoaSoTrangThaiOut(BaseModel):
    """Trạng thái khóa của MỘT khoảng bất kỳ — cho màn báo cáo hỏi đúng kỳ nó đang xem.

    Trước 04/09/2026 giao diện tự suy bằng cách dò `list_ky` rồi so BẰNG ĐÚNG hai đầu ngày; kỳ
    báo cáo 01/09–04/09 không đời nào khớp kỳ tháng 01/09–30/09 nên luôn ra "chưa khóa".
    """

    tu_ngay: date
    den_ngay: date
    da_khoa: bool
    khoa_mot_phan: bool = False
