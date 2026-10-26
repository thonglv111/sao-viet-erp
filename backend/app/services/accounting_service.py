"""Business rules for Accounting purchase approvals and payment vouchers."""
from __future__ import annotations

import secrets
import string
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from sqlalchemy import BigInteger, cast, func, select
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.exc import IntegrityError

from ..models.payroll import ADV_APPROVED, ADV_PAID
from ..models.accounting import (
    BANK_FEE_BEARERS,
    BANK_FEE_PAYER,
    PAYMENT_RECEIPT_CANCELLED,
    PAYMENT_RECEIPT_RECEIVED,
    PAYMENT_RECEIPT_WAITING,
    PAYMENT_STAGE_ADVANCE,
    PAYMENT_STAGE_FINAL,
    PAYMENT_STAGES,
    PAYMENT_VOUCHER_CANCELLED,
    PAYMENT_VOUCHER_PAID,
    PAYMENT_VOUCHER_STATUSES,
    PAYMENT_VOUCHER_TYPES,
    RECEIPT_SOURCE_ORDER,
    RECEIPT_SOURCE_OTHER,
    RECEIPT_SOURCE_PURCHASE,
    RECEIPT_SOURCE_SALES_INVOICE,
    LOAI_CK,
    LOAI_KE,
    NGUON_CK_KE,
    SALES_INVOICE_CANCELLED,
    SALES_INVOICE_ISSUED,
    VOUCHER_SOURCE_CHI_CK,
    VOUCHER_SOURCE_CHI_KE,
    VOUCHER_SOURCE_CUSTOMER_REFUND,
    VOUCHER_SOURCE_GIA_CONG,
    VOUCHER_SOURCE_INTERNAL,
    VOUCHER_SOURCE_OTHER,
    VOUCHER_SOURCE_PURCHASE,
    VOUCHER_SOURCE_SALARY_ADVANCE,
    VOUCHER_BANK_TRANSFER,
    VOUCHER_CASH,
    CompanyBankAccount,
    PaymentReceipt,
    PaymentReceiptAttachment,
    PaymentReceiptLine,
    PaymentVoucher,
    PaymentVoucherAttachment,
    PaymentVoucherLine,
    PhieuChiCkKe,
    SalesInvoice,
    SupplierBankAccount,
)
from ..models.customer import Customer
from ..models.muc_thu_chi import muc_co_dinh, ten_muc_phieu
from ..models.document_sequence import (
    SEQ_DOC_TYPE_PAYMENT_RECEIPT,
    SEQ_DOC_TYPE_PAYMENT_VOUCHER,
)
from ..models.order import Order, OrderLine, STATUS_CANCELLED as ORDER_CANCELLED, STATUS_ORDERED
from ..models.purchase import (
    DPR_CANCELLED,
    DPR_DONE,
    DPR_IN_PURCHASE,
    PR_APPROVED,
    PR_PARTIALLY_RECEIVED,
    PR_PENDING,
    PR_PURCHASED,
    PR_RECEIVED,
    PURCHASE_ATTACHMENT_HOA_DON,
    PurchaseRequest,
)
from ..repositories.accounting_repo import AccountingRepository
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.muc_thu_chi_repo import MucThuChiRepository
from ..repositories.purchase_repo import PurchaseRequestRepository, SupplierRepository
from ..repositories.user_repo import UserRepository
from ..storage import get_storage, key_from_url, make_key, url_from_key
from . import bao_cao_cong_no
from .cong_no_khoa_ky import loi_ky_khoa
from .dinh_dang import so_vn
from .ky_luong_guard import ly_do_ky_luong_da_khoa
from .hoa_don_theo_giao import _ngay_vn
from .muc_thu_chi_service import MucThuChiError, MucThuChiService
from .purchase_service import (
    _purchase_line_amounts,
    phan_bo_du_dot,
    han_tra_dot,
    phan_bo_tien_dot,
    purchase_money,
)
from .sequence_service import SequenceService


class AccountingError(Exception):
    pass


class AccountingValidationError(AccountingError):
    pass


class AccountingNotFound(AccountingError):
    pass


class AccountingBulkBlocked(AccountingValidationError):
    """Chi MỘT LƯỢT bị chặn vì vài phiếu vướng — không phiếu chi nào được ghi. `vuong_ids` = id
    phiếu tạm ứng vướng, để màn hình bỏ chọn đúng chúng rồi bấm lại (25/09/2026)."""

    def __init__(self, message: str, vuong_ids):
        super().__init__(message)
        self.vuong_ids = [int(i) for i in vuong_ids]


class AccountingConflict(AccountingError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _business_today() -> date:
    """Hôm nay theo giờ xưởng. SEAM — cột 'Quá hạn' của Công nợ phải trả so ngày qua đây.

    Để test chọc được (`monkeypatch.setattr(accounting_service, "_business_today", ...)`). Gọi thẳng
    `date.today()` trong thân hàm là đẻ ra test thối theo thời gian — dự án đã dính một lần rồi."""
    return datetime.now(ZoneInfo("Asia/Bangkok")).date()


def _order_line_total_with_vat():
    return cast(OrderLine.line_total, BigInteger) * (100 + OrderLine.vat_pct_estimate)


# File đính kèm chứng từ: bytes đi qua kho file dùng chung (app/storage.py), đọc lại qua
# /api/files và chỉ người có quyền `ke_toan` mới xem được. Vẫn giới hạn loại + cỡ file.
_ATTACHMENT_SUBDIR = "ke-toan"
_RECEIPT_ATTACHMENT_SUBDIR = "ke-toan-thu"
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENTS_PER_VOUCHER = 20

# Kỳ của cột "Đã trả" và rổ ✅ trên màn Công nợ phải trả. CỨNG, cố ý không cho chọn trên giao diện:
# ô chọn kỳ là nút toàn màn mà 90% thời gian không dùng tới (việc hằng ngày là "ai đang nợ, ai quá
# hạn" — hai thứ đó không dính gì tới kỳ). Cần tra NCC đã im lặng lâu thì dùng Ô TÌM, nó lôi được
# mọi NCC bất kể kỳ.
#
# Kỳ càng dài càng phải quét nhiều đơn đã tất toán ⇒ đây cũng là chốt chặn màn chậm dần.
PAYABLES_PERIOD_MONTHS = 3

# --- PHÂN TUỔI CÔNG NỢ (aging) ---------------------------------------------
# MỘT nguồn duy nhất cho mốc rổ VÀ nhãn rổ. API trả kèm `label` + `min_days`/`max_days` để giao
# diện in ra và tự lọc — frontend KHÔNG được gõ lại "1–7" hay số 7/15/30/60 ở đâu cả. Gõ hai nơi
# là hai nơi lệch nhau ngay lần đầu chủ đổi mốc, mà lệch ở màn tiền thì không ai phát hiện.
#
# Đây chỉ là phép NHÓM trên `overdue_days` đã tính sẵn — không có phép tính tiền nào ở đây.
# `min_days=None` = không có cận dưới (rổ chưa tới hạn), `max_days=None` = không có cận trên.
AGING_CHUA_TOI_HAN = "chua_toi_han"
AGING_BUCKETS: tuple[dict, ...] = (
    # Rổ này gom cả đợt CHƯA TỚI HẠN lẫn đợt KHÔNG CÓ HẠN (`credit_days` NULL ⇒ `han_tra_dot`
    # trả None ⇒ `overdue_days` = 0). Đó đúng là hành vi `_no_theo_han` vẫn chạy từ 06/08/2026:
    # đợt không hạn nằm ở `no_han_amount`. Rổ tuổi chỉ XÉ phần quá hạn ra, KHÔNG đổi chỗ của
    # đợt không-hạn — nó vẫn phải đeo badge "Chưa đặt hạn" ở danh sách chi tiết để không ai
    # tưởng nó đã được canh.
    {"key": AGING_CHUA_TOI_HAN, "label": "Chưa tới hạn", "min_days": None, "max_days": 0},
    {"key": "d1_7", "label": "Trễ 1–7 ngày", "min_days": 1, "max_days": 7},
    {"key": "d8_15", "label": "Trễ 8–15 ngày", "min_days": 8, "max_days": 15},
    {"key": "d16_30", "label": "Trễ 16–30 ngày", "min_days": 16, "max_days": 30},
    {"key": "d31_60", "label": "Trễ 31–60 ngày", "min_days": 31, "max_days": 60},
    {"key": "d60_plus", "label": "Trễ > 60 ngày", "min_days": 61, "max_days": None},
)
AGING_KEYS: tuple[str, ...] = tuple(b["key"] for b in AGING_BUCKETS)
# 5 rổ TRỄ. Tổng tiền 5 rổ này phải LUÔN bằng `overdue_amount` cũ — hai chỗ nói hai kiểu tiền là
# lỗi nặng nhất của màn này (test_phan_tuoi_cong_no.py canh đúng bất biến đó).
AGING_KEYS_TRE: tuple[str, ...] = tuple(k for k in AGING_KEYS if k != AGING_CHUA_TOI_HAN)


def ro_tuoi(overdue_days: int) -> str:
    """Số ngày quá hạn → KHOÁ rổ tuổi. Mốc lấy từ `AGING_BUCKETS`, đừng gõ lại số ở chỗ khác."""
    for b in AGING_BUCKETS:
        if (b["min_days"] is None or overdue_days >= b["min_days"]) and (
            b["max_days"] is None or overdue_days <= b["max_days"]
        ):
            return str(b["key"])
    return AGING_CHUA_TOI_HAN


def _aging_rong() -> dict[str, dict[str, int]]:
    """Bộ rổ rỗng — đủ 6 khoá. NCC không nợ gì vẫn phải trả về đủ rổ = 0, chứ không phải `{}`:
    thiếu khoá là giao diện đọc ra `undefined` rồi in "NaN đ"."""
    return {k: {"amount": 0, "count": 0} for k in AGING_KEYS}


def _aging_cong(dich: dict[str, dict[str, int]], them: dict[str, dict[str, int]]) -> None:
    for k, v in them.items():
        dich[k]["amount"] += v["amount"]
        dich[k]["count"] += v["count"]


def _aging_ra_danh_sach(ro: dict[str, dict[str, int]]) -> list[dict]:
    """Bộ rổ → danh sách CÓ NHÃN, đúng thứ tự già dần. Giao diện chỉ việc in, không tự đặt tên rổ."""
    return [
        {
            "key": b["key"],
            "label": b["label"],
            "min_days": b["min_days"],
            "max_days": b["max_days"],
            "amount": ro[str(b["key"])]["amount"],
            "count": ro[str(b["key"])]["count"],
        }
        for b in AGING_BUCKETS
    ]


def _ap_du_cuoi_ky_qua_khu(muc: dict, it: dict | None, *, phai_tra: bool) -> None:
    """Kỳ đã QUA (`den_ngay` < hôm nay): ghi đè phần CÒN NỢ của một dòng màn Công nợ bằng dư cuối
    kỳ + tuổi nợ tại `den_ngay` của SỔ THEO KỲ (`bao_cao_cong_no`) — không tính lại đồng nào.

    331 (`phai_tra`) dư Có là còn nợ; 131 dư Nợ là còn nợ. Dư ≤ 0 (cọc/ứng trước vượt hàng — sổ
    cộng RÒNG theo đối tượng) hoặc `it=None` (không có số trong kỳ) ⇒ mọi ô còn nợ về 0: màn này
    đếm nợ phải đi trả/đi đòi, không hiện số âm (chốt 05/10/2026).

    131 từ 17/10/2026: còn nợ = tổng tuổi nợ THEO ĐƠN của sổ, không phải dư Nợ — tiền khách đang để
    ở đơn khác không trừ vào hoá đơn đơn này (cùng luật ảnh chụp hôm nay)."""
    du = 0
    if it is not None and phai_tra:
        du = it["cuoi_co"] - it["cuoi_no"]
    elif it is not None:
        du = sum(int(it["aging"][k]["amount"]) for k in AGING_KEYS)
    if du <= 0:
        muc.update(total_due=0, overdue_amount=0, no_han_amount=0, aging=_aging_rong())
        return
    ro = {k: {"amount": int(it["aging"][k]["amount"]), "count": int(it["aging"][k]["count"])}
          for k in AGING_KEYS}
    muc["total_due"] = du
    muc["aging"] = ro
    muc["overdue_amount"] = sum(ro[k]["amount"] for k in AGING_KEYS_TRE)
    muc["no_han_amount"] = ro[AGING_CHUA_TOI_HAN]["amount"]


def _loc_nang_cao(
    items: list[dict],
    *,
    no_tu: int | None,
    no_den: int | None,
    han_tra: str | None,
    han_muc: str | None,
    moc: date,
) -> list[dict]:
    """Bộ lọc nâng cao dùng CHUNG cho Công nợ phải trả và phải thu (đặc tả 05/10/2026): khoảng
    còn nợ, hạn trả gần nhất, mức dùng hạn mức. Chọn DÒNG, không đổi số của dòng.

    `moc` = ngày cuối kỳ (không kỳ thì hôm nay): "tới hạn trong 7 ngày" đếm từ mốc đó. Khoá lạ thì
    BỎ QUA như `filter_` — cửa lọc không phải chỗ ném 422."""
    if no_tu is not None:
        items = [m for m in items if m["total_due"] >= no_tu]
    if no_den is not None:
        items = [m for m in items if m["total_due"] <= no_den]
    if han_tra == "qua_han":
        items = [m for m in items if m["overdue_amount"] > 0]
    elif han_tra in ("7_ngay", "30_ngay"):
        toi = moc + timedelta(days=7 if han_tra == "7_ngay" else 30)
        items = [m for m in items if m.get("han_gan_nhat") and moc <= m["han_gan_nhat"] <= toi]
    if han_muc == "tren_80":
        items = [
            m for m in items
            if m["credit_limit"] > 0 and m["total_due"] * 100 >= m["credit_limit"] * 80
        ]
    elif han_muc == "vuot":
        items = [m for m in items if m["vuot_han_muc"]]
    elif han_muc == "chua_dat":
        items = [m for m in items if not m["credit_limit"]]
    return items


def _loc_the_cong_no(items: list[dict], filter_: str) -> list[dict]:
    """Nút nhóm của hai màn công nợ (`filter`). Khoá lạ thì bỏ qua — không 422."""
    if filter_ == "overdue":
        return [m for m in items if m["overdue_amount"] > 0]
    if filter_ == "chua_han":
        return [m for m in items if m["no_han_amount"] > 0]
    if filter_ == "vuot_han_muc":
        return [m for m in items if m["vuot_han_muc"]]
    if filter_ == "tra_coc":
        return [m for m in items if m.get("cho_tra_lai", 0) > 0]
    return items


def _the_loc_cong_no(items: list[dict]) -> dict:
    """Số trên ba nút "Tất cả | Quá hạn | Vượt hạn mức" — đếm trên danh sách ĐÃ qua tìm / kỳ /
    bộ lọc nâng cao / rổ tuổi, TRƯỚC `filter_`: bấm nút nào bảng ra đúng số trên nút đó."""
    return {
        "tat_ca": len(items),
        "qua_han": len(_loc_the_cong_no(items, "overdue")),
        "vuot_han_muc": len(_loc_the_cong_no(items, "vuot_han_muc")),
    }


def _tong_loc_cong_no(items: list[dict], *, so_khoan, khoa_ky_1: str, khoa_ky_2: str) -> dict:
    """Dòng CỘNG của bảng công nợ: tổng của MỌI dòng khớp bộ lọc, TRƯỚC khi cắt trang (07/10/2026).

    Khác số tổng đầu màn (`total_due`, `aging`…) — những số đó cố ý KHÔNG theo bộ lọc nâng cao.
    `so_khoan(m)` = số khoản nợ của một dòng (phải trả: số đợt còn nợ; phải thu: số hoá đơn còn nợ).
    Rổ tuổi cộng bằng `_aging_cong` — cùng hàm với dải tổng đầu màn nên hai nơi không thể lệch."""
    ro = _aging_rong()
    for m in items:
        _aging_cong(ro, m["aging"])
    return {
        "so_doi_tac": len(items),
        "so_khoan": sum(so_khoan(m) for m in items),
        "con_no": sum(m["total_due"] for m in items),
        "aging": {k: ro[k]["amount"] for k in AGING_KEYS},
        "qua_han": sum(m["overdue_amount"] for m in items),
        "trong_ky_1": sum(m[khoa_ky_1] for m in items),
        "trong_ky_2": sum(m[khoa_ky_2] for m in items),
    }


#: Cột sắp xếp được của hai bảng công nợ → chiều MẶC ĐỊNH khi bấm lần đầu: còn nợ lớn trước, hạn
#: sớm trước, thu / trả gần nhất CŨ trước (khách im lâu nhất là người cần gọi trước).
SAP_XEP_CONG_NO = {"con_no": "desc", "han": "asc", "gan_nhat": "asc"}


def _sap_xep_cong_no(
    items: list[dict], sap_xep: str | None, chieu: str | None, *, khoa_gan_nhat: str, khoa_ky: str
) -> list[dict]:
    """Sắp DÒNG của hai bảng công nợ ở MÁY CHỦ, trước khi cắt trang (06/10/2026, bảng đủ cột).

    `items` đến đây đã theo thứ tự mặc định (còn nợ, rồi tiền trong kỳ, giảm dần). Khoá lạ thì giữ
    nguyên thứ tự đó — cửa lọc không ném 422. Dòng THIẾU giá trị (không có hạn) luôn nằm cuối dù đảo
    chiều; riêng "gần nhất" tăng dần thì dòng CHƯA THU / TRẢ LẦN NÀO đứng ĐẦU — đó là im lâu nhất."""
    if sap_xep not in SAP_XEP_CONG_NO:
        return items
    giam = (chieu if chieu in ("asc", "desc") else SAP_XEP_CONG_NO[sap_xep]) == "desc"
    if sap_xep == "con_no":
        return sorted(items, key=lambda m: (m["total_due"], m[khoa_ky]), reverse=giam)
    khoa = "han_gan_nhat" if sap_xep == "han" else khoa_gan_nhat
    co = sorted((m for m in items if m.get(khoa) is not None), key=lambda m: m[khoa], reverse=giam)
    khong = [m for m in items if m.get(khoa) is None]
    if sap_xep == "gan_nhat" and not giam:
        return khong + co
    return co + khong


def _delete_stored_file(file_url: str | None) -> None:
    """Gỡ bytes best-effort — xoá row mới là việc chính, file rác không được làm hỏng request."""
    key = key_from_url(file_url)
    if key:
        get_storage().delete(key)


def _text(value, *, label: str, required: bool = False, max_length: int | None = None):
    cleaned = (value or "").strip()
    if required and not cleaned:
        raise AccountingValidationError(f"{label} không được để trống.")
    if max_length is not None and len(cleaned) > max_length:
        raise AccountingValidationError(f"{label} vượt quá {max_length} ký tự.")
    return cleaned or None


def _order_total_with_vat(order: Order) -> int:
    """Giá trị đơn gồm VAT, cùng công thức với màn Đơn hàng bán."""
    total_x100 = sum(
        int(line.line_total or 0) * (100 + int(line.vat_pct_estimate or 0))
        for line in order.lines
    )
    return total_x100 // 100


def quy_tien_don(repo: AccountingRepository, order_ids: list[int]) -> dict[int, int]:
    """Quỹ tiền khách đã đưa cho từng đơn mà chưa gắn hoá đơn còn hiệu lực (17/10/2026):
    cọc + tiền đã thu của hoá đơn ĐÃ HUỶ − đã trả lại khách. Quỹ này cấn FIFO vào hoá đơn của đơn."""
    coc = repo.received_deposit_sums(order_ids)
    huy = repo.thu_hoa_don_huy_theo_don(order_ids)
    tra = repo.coc_da_tra_lai_nhieu(order_ids)
    return {
        oid: max(0, coc.get(oid, 0) + huy.get(oid, 0) - tra.get(oid, 0))
        for oid in set(coc) | set(huy)
    }


def _tien_dang_de(repo: AccountingRepository, customer_id: int) -> list[dict]:
    from .ban_hang_cho_thu_chi import tien_dang_de

    return tien_dang_de(repo, customer_id)


def receivable_rows(
    repo: AccountingRepository,
    *,
    customer_id: int | None = None,
    invoices: list[SalesInvoice] | None = None,
    hoan: bool = True,
) -> list[dict]:
    """Một nguồn sự thật cho Công nợ phải thu và thẻ công nợ CRM.

    Chỉ hóa đơn `issued` sinh nợ. Phiếu thu gắn hóa đơn trừ đích danh; cọc gắn đơn
    được cấn FIFO theo (ngày hóa đơn, id) nhưng không tự biến thành công nợ trước
    khi hóa đơn xuất hiện.

    `invoices` (tuỳ chọn) = danh sách người gọi đã nạp sẵn bằng ĐÚNG
    `list_sales_invoices(customer_id=customer_id, status=issued)` — màn Công nợ phải thu dùng chung
    với sổ 131 để khỏi nạp hoá đơn hai lần. Không truyền thì tự nạp như cũ.

    Còn nợ đi THEO ĐƠN (17/10/2026): tiền của đơn nào chỉ trừ vào hoá đơn của đơn đó, không cân theo
    dư 131 nữa. `hoan=True` cộng nợ lại tiền trả lại khách KHÔNG gắn đơn (`hoan_khong_don`, luật
    `bao_cao_cong_no.phan_bo_hoan_khong_don`) thành khoản RIÊNG: Trừ cọc / Đã thu giữ số thật của
    phiếu, Giá trị + `hoan_khong_don` − Trừ cọc − Đã thu = Còn nợ (17/10/2026). Tính quỹ tiền của đơn (`tien_cho_tra_lai`) gọi
    `hoan=False` — tiền trả ngoài đơn không đụng quỹ của đơn nào.
    """
    if invoices is None:
        invoices = repo.list_sales_invoices(
            customer_id=customer_id, status=SALES_INVOICE_ISSUED
        )
    if not invoices:
        return []

    invoice_ids = [row.id for row in invoices]
    direct_sums = repo.received_invoice_receipt_sums(invoice_ids)
    order_ids = sorted({row.order_id for row in invoices})
    deposit_sums = quy_tien_don(repo, order_ids)
    customers = repo.customers_by_ids(
        {row.customer_id for row in invoices if row.customer_id is not None}
    )

    by_order: dict[int, list[SalesInvoice]] = {}
    for invoice in invoices:
        by_order.setdefault(invoice.order_id, []).append(invoice)

    deposit_offsets: dict[int, int] = {}
    for order_id, order_invoices in by_order.items():
        deposit_pool = int(deposit_sums.get(order_id, 0))
        for invoice in sorted(order_invoices, key=lambda row: (row.invoice_date, row.id)):
            phai_thu = int(invoice.amount_vnd)
            direct = min(phai_thu, int(direct_sums.get(invoice.id, 0)))
            offset = min(deposit_pool, max(0, phai_thu - direct))
            deposit_offsets[invoice.id] = offset
            deposit_pool -= offset

    rows: list[dict] = []
    for invoice in invoices:
        direct = int(direct_sums.get(invoice.id, 0))
        deposit_offset = int(deposit_offsets.get(invoice.id, 0))
        amount = int(invoice.amount_vnd)
        received = min(amount, direct + deposit_offset)
        customer = customers.get(invoice.customer_id) if invoice.customer_id else None
        rows.append(
            {
                "invoice_id": invoice.id,
                "invoice_symbol": invoice.invoice_symbol,
                "invoice_number": invoice.invoice_number,
                "invoice_date": invoice.invoice_date,
                "order_id": invoice.order_id,
                "order_code": invoice.order.order_no,
                "customer_id": invoice.customer_id,
                "customer_name": invoice.customer_name_snapshot,
                "credit_limit": int(customer.credit_limit or 0) if customer else 0,
                "payment_term_days": customer.payment_term_days if customer else None,
                # Sale phụ trách khách — cho bộ lọc "Người phụ trách" ở Công nợ phải thu.
                "sale_user_id": customer.sale_user_id if customer else None,
                "payment_term_days_snapshot": invoice.payment_term_days_snapshot,
                "due_date": invoice.due_date,
                "amount": amount,
                "direct_received_amount": direct,
                "deposit_offset_amount": deposit_offset,
                "received_amount": received,
                "remaining_amount": max(0, amount - received),
                "hoan_khong_don": 0,
            }
        )
    if hoan:
        _cong_hoan_khong_don(repo, rows)
    return rows


def _phan_bo_hoan(
    repo: AccountingRepository, customer_ids: set, rows: list[dict] | None = None, *, tru_thua: bool = True,
    den_ngay: date | None = None,
) -> dict[int, int]:
    """`{invoice_id: tiền trả lại ngoài đơn cộng nợ lại}` cho các khách. `tru_thua=False` ⇒ phần GỘP,
    chưa trừ tiền khách đã trả vượt hoá đơn — đối chiếu từng phiếu thu dùng số này, vì phần trả vượt
    chính là các phiếu thu đã đếm riêng (trừ hai lần thì "còn nợ sau phiếu" thấp hơn thật)."""
    hoan = repo.hoan_khach_khong_don(customer_ids, den_ngay=den_ngay)
    if not hoan:
        return {}
    co_san = {r["invoice_id"] for r in rows or []}
    du = repo.hoa_don_hieu_luc_cua_khach(hoan)
    # Phân bổ cần MỌI hoá đơn của khách — người gọi có thể chỉ đưa hoá đơn của một đơn.
    day_du = (rows if rows is not None and all(i.id in co_san for i in du)
              else receivable_rows(repo, invoices=du, hoan=False))
    khoan = [
        {"id": r["invoice_id"], "doi_tuong_id": r["customer_id"], "han": r["due_date"],
         "ngay": r["invoice_date"], "goc": r["amount"],
         "con_no": r["remaining_amount"],
         "thua": max(0, r["direct_received_amount"] - r["amount"]) if tru_thua else 0}
        for r in day_du if r["customer_id"] in hoan
    ]
    return bao_cao_cong_no.phan_bo_hoan_khong_don(khoan, hoan)


def hoan_khong_don_theo_don(
    repo: AccountingRepository, customer_ids, *, den_ngay: date | None = None
) -> dict[int, int]:
    """`{order_id: tiền trả lại khách ngoài đơn cộng nợ lại vào hoá đơn của đơn đó}` — cùng phép phân
    bổ của Công nợ phải thu (`_phan_bo_hoan`), để Báo cáo kinh doanh ra cùng số (#47, 18/10/2026)."""
    ids = {int(i) for i in customer_ids if i}
    them = _phan_bo_hoan(repo, ids, den_ngay=den_ngay) if ids else {}
    if not them:
        return {}
    don_cua = {hd.id: hd.order_id for hd in repo.hoa_don_hieu_luc_cua_khach(ids)}
    ra: dict[int, int] = {}
    for hd_id, tien in them.items():
        don = don_cua.get(hd_id)
        if don is not None:
            ra[int(don)] = ra.get(int(don), 0) + int(tien)
    return ra


def _cong_hoan_khong_don(repo: AccountingRepository, rows: list[dict]) -> None:
    them = _phan_bo_hoan(repo, {r["customer_id"] for r in rows if r["customer_id"]}, rows)
    if not them:
        return
    for r in rows:
        cong = them.get(r["invoice_id"], 0)
        if not cong:
            continue
        r["hoan_khong_don"] = cong
        r["remaining_amount"] += cong


class AccountingService:
    def __init__(
        self,
        repo: AccountingRepository,
        purchases: PurchaseRequestRepository,
        suppliers: SupplierRepository,
        users: UserRepository,
        audit: AuditLogRepository,
        sequences: SequenceService,
        payroll=None,
        employees=None,
    ) -> None:
        self.repo = repo
        self.purchases = purchases
        self.suppliers = suppliers
        self.users = users
        self.audit = audit
        self.sequences = sequences
        # PayrollRepository | EmployeeRepository — CHỈ ĐỌC, chỉ để lập phiếu chi từ phiếu tạm ứng
        # lương (18/08/2026): đọc phiếu tạm ứng + tên nhân viên. None (unit test dựng tay) ⇒ nguồn
        # `salary_advance` báo lỗi rõ ràng thay vì vỡ.
        self._payroll = payroll
        self._employees = employees
        # Tên người đã nạp gộp cho trang đang dựng (`_nap_ten_nguoi`): `{user_id: tên | None}`.
        self._ten_nap: dict[int, str | None] = {}

    # --- bank accounts ----------------------------------------------------

    def list_company_accounts(
        self,
        *,
        active_only: bool = False,
        usage: str | None = None,
        ngan_hang: str | None = None,
        trang_thai: str | None = None,
    ):
        if usage not in (None, "receive", "pay"):
            raise AccountingValidationError("Mục đích tài khoản không hợp lệ.")
        return self.repo.list_company_accounts(
            active_only=active_only, usage=usage, ngan_hang=(ngan_hang or "").strip() or None,
            trang_thai=trang_thai,
        )

    def dem_tai_khoan_theo_ngan_hang(self) -> list[tuple[str, int]]:
        return self.repo.dem_tai_khoan_theo_ngan_hang()

    def thong_ke_tai_khoan(self, *, tu_ngay: date, den_ngay: date) -> list[dict]:
        return self.repo.thong_ke_tai_khoan(tu_ngay=tu_ngay, den_ngay=den_ngay)

    def create_company_account(self, *, actor, **values):
        cleaned = self._clean_bank_account(values, include_usage=True)
        cleaned.pop("is_default", None)
        row = CompanyBankAccount(**cleaned, is_default=False)
        try:
            saved = self.repo.save_company_account(row, make_default=False)
        except IntegrityError as exc:
            raise AccountingConflict("Tài khoản ngân hàng công ty đã tồn tại.") from exc
        self.audit.create(
            actor_user_id=actor.id,
            action="create_company_bank_account",
            target=f"company_bank_account:{saved.id}",
            detail=f"{saved.bank_name} - {saved.account_number}",
        )
        return saved

    def update_company_account(self, account_id: int, *, actor, **values):
        row = self.repo.get_company_account(account_id)
        if row is None:
            raise AccountingNotFound("Không tìm thấy tài khoản ngân hàng công ty.")
        cleaned = self._clean_bank_account(values, include_usage=True)
        cleaned.pop("is_default", None)
        for key, value in cleaned.items():
            setattr(row, key, value)
        row.is_default = False
        try:
            saved = self.repo.save_company_account(row, make_default=False)
        except IntegrityError as exc:
            raise AccountingConflict("Tài khoản ngân hàng công ty đã tồn tại.") from exc
        self.audit.create(
            actor_user_id=actor.id,
            action="update_company_bank_account",
            target=f"company_bank_account:{saved.id}",
            detail=f"{saved.bank_name} - {saved.account_number}",
        )
        return saved

    def toggle_company_account(self, account_id: int, *, actor):
        row = self.repo.get_company_account(account_id)
        if row is None:
            raise AccountingNotFound("Không tìm thấy tài khoản ngân hàng công ty.")
        row.is_active = not row.is_active
        if not row.is_active:
            row.is_default = False
        saved = self.repo.save_company_account(row, make_default=False)
        self.audit.create(
            actor_user_id=actor.id,
            action="toggle_company_bank_account",
            target=f"company_bank_account:{saved.id}",
            detail="active" if saved.is_active else "inactive",
        )
        return saved

    def list_supplier_accounts(self, *, supplier_id: int | None = None, active_only: bool = False):
        return [
            self._supplier_account_out(row)
            for row in self.repo.list_supplier_accounts(
                supplier_id=supplier_id, active_only=active_only
            )
        ]

    def create_supplier_account(self, *, actor, supplier_id: int, **values):
        supplier = self.suppliers.get_by_id(supplier_id)
        if supplier is None:
            raise AccountingNotFound("Không tìm thấy nhà cung cấp.")
        cleaned = self._clean_bank_account(values)
        cleaned.pop("is_default", None)
        row = SupplierBankAccount(
            supplier_id=supplier_id, **cleaned, is_default=False
        )
        try:
            saved = self.repo.save_supplier_account(row, make_default=False)
        except IntegrityError as exc:
            raise AccountingConflict("Tài khoản ngân hàng nhà cung cấp đã tồn tại.") from exc
        self.audit.create(
            actor_user_id=actor.id,
            action="create_supplier_bank_account",
            target=f"supplier_bank_account:{saved.id}",
            detail=f"{supplier.name} - {saved.account_number}",
        )
        return self._supplier_account_out(saved)

    def update_supplier_account(self, account_id: int, *, actor, supplier_id: int, **values):
        row = self.repo.get_supplier_account(account_id)
        if row is None:
            raise AccountingNotFound("Không tìm thấy tài khoản ngân hàng nhà cung cấp.")
        supplier = self.suppliers.get_by_id(supplier_id)
        if supplier is None:
            raise AccountingNotFound("Không tìm thấy nhà cung cấp.")
        cleaned = self._clean_bank_account(values)
        cleaned.pop("is_default", None)
        row.supplier_id = supplier_id
        for key, value in cleaned.items():
            setattr(row, key, value)
        row.is_default = False
        try:
            saved = self.repo.save_supplier_account(row, make_default=False)
        except IntegrityError as exc:
            raise AccountingConflict("Tài khoản ngân hàng nhà cung cấp đã tồn tại.") from exc
        self.audit.create(
            actor_user_id=actor.id,
            action="update_supplier_bank_account",
            target=f"supplier_bank_account:{saved.id}",
            detail=f"{supplier.name} - {saved.account_number}",
        )
        return self._supplier_account_out(saved)

    def toggle_supplier_account(self, account_id: int, *, actor):
        row = self.repo.get_supplier_account(account_id)
        if row is None:
            raise AccountingNotFound("Không tìm thấy tài khoản ngân hàng nhà cung cấp.")
        row.is_active = not row.is_active
        if not row.is_active:
            row.is_default = False
        saved = self.repo.save_supplier_account(row, make_default=False)
        self.audit.create(
            actor_user_id=actor.id,
            action="toggle_supplier_bank_account",
            target=f"supplier_bank_account:{saved.id}",
            detail="active" if saved.is_active else "inactive",
        )
        return self._supplier_account_out(saved)

    # --- công nợ phải trả -------------------------------------------------
    #
    # KHÔNG có bảng công nợ. Số dư là phép CỘNG TRỪ chạy lúc mở màn, suy từ chứng từ đang có, nên
    # không ai gõ tay sửa được và không bao giờ lệch với phiếu. Muốn một món nợ biến mất chỉ có hai
    # đường: lập phiếu chi rồi chi, hoặc huỷ đơn.
    #
    # Ba rổ, đừng lẫn:

    def _no_cua_phieu(self, row) -> dict:
        """Bóc một phiếu mua thành các con số công nợ.

        Tiền lấy từ `purchase_money` — DÙNG CHUNG với màn Mua hàng, không cộng lại ở đây. Hai chỗ
        tự cộng lấy là hai chỗ lệch, mà lệch tiền thì tới lúc đối chiếu với NCC mới lòi ra.

        Từ 06/08/2026 chỉ còn MỘT con số nợ: `outstanding_amount = hàng đã giao − đã chi ròng`.
        Rổ "chờ chi" biến mất cùng trạng thái `waiting_payment` — lập phiếu chi nghĩa là tiền đã ra,
        nên không còn khoảng giữa "đã ghi sổ" và "đã trả" để mà theo dõi riêng."""
        money = purchase_money(row)
        return {"money": money, "con_no": money["outstanding_amount"]}

    @staticmethod
    def _ngay_chi(v) -> date:
        """Ngày tiền THỰC SỰ rời két. `paid_at` là mốc bấm 'Đã chi'; phiếu cũ chưa có thì lùi về
        ngày chứng từ."""
        return v.paid_at.date() if v.paid_at is not None else v.voucher_date

    def _no_tung_dot(self, row) -> tuple[list[dict], int, int]:
        """Bóc một phiếu thành **(các đợt giao, cọc chung, cọc chưa dùng hết)** cho MÀN CÔNG NỢ.

        Phép phân bổ nằm ở `purchase_service.phan_bo_tien_dot` — DÙNG CHUNG với màn Mua hàng (trần
        lập phiếu chi bám đúng con số này). Hai chỗ tự phân lấy là hai chỗ lệch, mà lệch ở đây thì
        một đợt có thể biến mất khỏi công nợ ở màn này trong khi màn kia vẫn cho lập phiếu.

        Hàm này chỉ khoác thêm phần HIỂN THỊ: hạn trả, số hoá đơn, ngày giao.

        Phiếu chưa có đợt giao nào (dữ liệu cũ) trả `([], 0, 0)`: nợ của nó không quy được về đợt
        nào, màn hình phải hiện ở mức PHIẾU."""
        phan_bo, coc, coc_du = phan_bo_tien_dot(row)
        # `phan_bo_tien_dot` chỉ trả TIỀN Ở MỨC ĐỢT (không giữ chi tiết từng dòng), nên gọi lại
        # `phan_bo_du_dot` — hàm NỀN TẢNG nó dùng bên trong — để lấy `tinh_tien`/`du` CỦA TỪNG
        # DÒNG, nuôi cột "Đơn giá"/"Thành tiền" ở popup "Hàng đã nhận" (04/09/2026). Gọi lại tốn
        # thêm một lượt tính cho phiếu này, chấp nhận được (vài đợt/dòng mỗi phiếu) để KHÔNG phải
        # đổi hình dạng trả về của `phan_bo_tien_dot` — hàm đó còn được gọi ở nhiều nơi khác.
        chi_tiet_dong = phan_bo_du_dot(row)
        # Tên + ĐVT + đơn giá đã chốt của mặt hàng nằm ở DÒNG ĐẶT, dòng đợt chỉ giữ số lượng ⇒
        # tra bảng một lần.
        dong_dat = {ln.id: ln for ln in row.lines}

        def _hang_cua_dot(delivery) -> list[dict]:
            """Mặt hàng của một đợt — nuôi popup "hàng đã nhận" ở Công nợ phải trả (28/08/2026,
            thêm giá + thành tiền 04/09/2026: *"Hiển thị số tiền và tổng số tiền của mặt hàng"*).

            Kèm sẵn trong payload thay vì đẻ endpoint thứ hai: mỗi đợt vài dòng, mà bấm vào đợt
            rồi mới đi gọi mạng là người dùng nhìn một hộp thoại rỗng đang quay.
            """
            dong_cua_dot = chi_tiet_dong.get(delivery.id, {}).get("lines", {})
            ra = []
            for dl in delivery.lines:
                ln = dong_dat.get(dl.purchase_request_line_id)
                muc = dong_cua_dot.get(dl.id, {})
                tinh_tien = float(muc.get("tinh_tien", 0.0) or 0.0)
                du = float(muc.get("du", 0.0) or 0.0)
                thanh_tien = 0
                if ln is not None and tinh_tien > 0:
                    _, _, _, thanh_tien = _purchase_line_amounts(
                        quantity=tinh_tien,
                        unit_price=int(ln.expected_unit_price),
                        discount_percent=float(ln.discount_percent or 0),
                        vat_percent=float(ln.vat_percent or 0),
                    )
                ra.append({
                    "item_name": ln.item_name if ln is not None else "(dòng đã bị xoá)",
                    "unit": ln.unit if ln is not None else "",
                    "quantity": float(dl.quantity),
                    "unit_price": int(ln.expected_unit_price) if ln is not None else 0,
                    "thanh_tien": thanh_tien,
                    # DƯ = phần giao VƯỢT số đặt, tính 0đ (chủ chốt 28/08/2026). Phơi ra ở đúng
                    # dòng đơn — nếu không, người đọc thấy "900 Cái" mà thành tiền lại thấp hơn
                    # 900×đơn giá và tưởng máy tính sai, trong khi máy đang tính ĐÚNG.
                    "du": du,
                })
            return ra

        def _file_hoa_don(delivery) -> list[dict]:
            """File hoá đơn/biên bản NCC đã đính kèm cho đợt này — CHỈ ĐỌC (04/09/2026).

            Kế toán không tự upload từ màn này: file đính kèm lúc GHI ĐỢT GIAO bên Thu mua
            (`DeliveryDialog.tsx`), ở đây chỉ hiện lại để khỏi phải nhảy màn mới xem được ảnh.
            """
            return [
                {
                    "id": a.id,
                    "file_name": a.file_name,
                    "file_url": a.file_url,
                    "file_type": a.file_type,
                }
                for a in sorted(delivery.attachments, key=lambda a: a.id)
                if a.kind == PURCHASE_ATTACHMENT_HOA_DON
            ]

        out = [
            {
                "lines": _hang_cua_dot(m["delivery"]),
                "delivery_id": m["delivery"].id,
                "seq_no": m["delivery"].seq_no,
                "delivery_date": m["delivery"].delivery_date,
                "due_date": han_tra_dot(m["delivery"], row.supplier),
                "invoice_symbol": m["delivery"].invoice_symbol,
                "invoice_number": m["delivery"].invoice_number,
                "invoice_date": m["delivery"].invoice_date,
                "hoa_don_files": _file_hoa_don(m["delivery"]),
                "amount": m["amount"],
                "paid": m["paid"],
                "coc_bu": m["coc_bu"],
                "con_no": m["con_no"],
            }
            for m in phan_bo
        ]
        return out, coc, coc_du

    def _hoan_ncc_theo_dot(self, rows, hoan: dict, dot_cua: dict | None = None) -> list[tuple]:
        """Phiếu NCC hoàn tiền không gắn đơn (`ncc_hoan_khong_don`) cộng vào đợt giao hạn MUỘN NHẤT của
        NCC — cùng phép phân bổ tiền trả lại khách ngoài đơn bên phải thu (#36, 18/10/2026). Trả
        `[(supplier_id, đơn, đợt, tiền)]`. `dot_cua` = `{row.id: _no_tung_dot(row)}` đã tính sẵn."""
        khoan, dot_theo_id = [], {}
        for row in rows:
            if row.supplier_id not in hoan:
                continue
            dots = (dot_cua or {}).get(row.id) or self._no_tung_dot(row)
            # Cọc NCC còn giữ chưa dùng (`coc_du`) là tiền họ hoàn lại trước — giống phần khách thu
            # vượt bên phải thu: hoàn trong phạm vi đó không đẻ ra nợ (rà cuối 19/10/2026).
            thua = max(0, dots[2])
            for d in dots[0]:
                if d["delivery_id"] is None:
                    continue
                dot_theo_id[d["delivery_id"]] = (row, d)
                khoan.append({"id": d["delivery_id"], "doi_tuong_id": row.supplier_id,
                              "han": d["due_date"], "ngay": d["delivery_date"], "goc": d["amount"],
                              "con_no": d["con_no"], "thua": thua})
                thua = 0
        if not khoan:
            return []
        them = bao_cao_cong_no.phan_bo_hoan_khong_don(khoan, hoan)
        return [(dot_theo_id[k][0].supplier_id, dot_theo_id[k][0], dot_theo_id[k][1], int(t))
                for k, t in them.items() if t]

    def _no_theo_han(self, row, con_no: int, hom_nay: date) -> tuple[int, int]:
        """Tách phần còn nợ thành (QUÁ HẠN, CHƯA TỚI HẠN).

        Hạn trả nay thuộc về ĐỢT GIAO, không thuộc phiếu chi nữa — phiếu chi là tiền đã ra, nó
        không có hạn. Đợt của NCC chưa khai `credit_days` thì `han_tra_dot` trả None ⇒ rơi vào
        "chưa tới hạn", và màn hình phải lôi nó lên đầu kèm badge 'Chưa đặt hạn'. Im lặng ở đây là
        một món nợ không ai canh — đúng bệnh giấu nợ đã vá một lần ở phiếu chi thiếu hạn.

        `_no_tung_dot` đã chiếu cọc xuống từng đợt rồi (`con_no` là số SAU khi bù), nên ở đây chỉ
        việc cộng — cọc đã trả thì phần đó không thể còn bị tính là trễ."""
        if con_no <= 0:
            return 0, 0
        dots, _coc, _du = self._no_tung_dot(row)
        if not dots:
            return 0, con_no
        qua_han = sum(
            d["con_no"]
            for d in dots
            if d["con_no"] > 0 and d["due_date"] is not None and d["due_date"] < hom_nay
        )
        return qua_han, max(0, con_no - qua_han)

    def _no_theo_ro_tuoi(self, row, con_no: int, hom_nay: date) -> dict[str, dict[str, int]]:
        """Xé phần còn nợ của MỘT phiếu thành các RỔ TUỔI (tiền + số đợt).

        Chỉ NHÓM, không tính lại đồng nào: cùng danh sách đợt, cùng phép so hạn, cùng phép trừ
        `con_no − quá hạn` với `_no_theo_han`. Nhờ vậy tổng 5 rổ trễ LUÔN đúng bằng
        `overdue_amount`, và rổ "chưa tới hạn" đúng bằng `no_han_amount` — hai màn không bao giờ
        nói hai kiểu tiền. Tự cộng lấy ở đây là mở đúng cái cửa đó.

        Đợt KHÔNG có hạn (`han_tra_dot` trả None) không vào rổ trễ nào; nó ở lại "chưa tới hạn"
        y như `_no_theo_han` vẫn xếp — giữ nguyên hành vi cũ, chỉ thêm rổ."""
        ro = _aging_rong()
        if con_no <= 0:
            return ro
        dots, _coc, _du = self._no_tung_dot(row)
        if not dots:
            # Phiếu CŨ không theo dõi theo đợt: nợ chỉ quy được về mức PHIẾU, không có hạn ⇒ cả
            # cục nằm ở "chưa tới hạn" (đúng nhánh `return 0, con_no` của `_no_theo_han`), đếm là
            # MỘT khoản.
            ro[AGING_CHUA_TOI_HAN]["amount"] += con_no
            ro[AGING_CHUA_TOI_HAN]["count"] += 1
            return ro
        qua_han = 0
        for d in dots:
            if d["con_no"] <= 0:
                continue
            if d["due_date"] is not None and d["due_date"] < hom_nay:
                khoa = ro_tuoi((hom_nay - d["due_date"]).days)
                ro[khoa]["amount"] += d["con_no"]
                ro[khoa]["count"] += 1
                qua_han += d["con_no"]
            else:
                ro[AGING_CHUA_TOI_HAN]["count"] += 1
        ro[AGING_CHUA_TOI_HAN]["amount"] += max(0, con_no - qua_han)
        return ro

    # --- báo cáo tổng hợp công nợ theo kỳ (docs/prd-bao-cao-cong-no.md §5.1) --------------
    #
    # Vỏ MỎNG, cố ý: ruột nằm ở `bao_cao_cong_no.py` chứ không nhét thêm vào file 2700 dòng này.
    # Hai báo cáo này KHÁC HẲN `payables_summary`/`receivables_summary` ngay bên dưới — chúng là
    # SỔ THEO KỲ (đầu kỳ · phát sinh · cuối kỳ), còn hai hàm kia là ảnh chụp TẠI HÔM NAY để đi
    # đòi nợ. Đừng gộp, và đừng sửa cái này rồi tưởng đã sửa cái kia.

    def bao_cao_phai_thu(self, *, tu_ngay: date, den_ngay: date) -> dict:
        """Sổ tổng hợp công nợ phải thu TK 131 cho kỳ `[tu_ngay, den_ngay]`."""
        return bao_cao_cong_no.tong_hop_phai_thu(
            self.repo, tu_ngay=tu_ngay, den_ngay=den_ngay
        )

    def bao_cao_phai_tra(self, *, tu_ngay: date, den_ngay: date) -> dict:
        """Sổ tổng hợp công nợ phải trả TK 331 cho kỳ `[tu_ngay, den_ngay]`."""
        return bao_cao_cong_no.tong_hop_phai_tra(
            self.repo, self.purchases, tu_ngay=tu_ngay, den_ngay=den_ngay
        )

    def so_chi_tiet_phai_thu(
        self, *, doi_tuong_id: int | None, tu_ngay: date, den_ngay: date
    ) -> dict:
        """Sổ chi tiết TK 131 của MỘT khách — từng chứng từ + luỹ kế (PRD §5.1)."""
        return bao_cao_cong_no.so_chi_tiet_phai_thu(
            self.repo, doi_tuong_id=doi_tuong_id, tu_ngay=tu_ngay, den_ngay=den_ngay
        )

    def so_chi_tiet_phai_tra(
        self, *, doi_tuong_id: int | None, tu_ngay: date, den_ngay: date
    ) -> dict:
        """Sổ chi tiết TK 331 của MỘT nhà cung cấp — từng chứng từ + luỹ kế (PRD §5.1)."""
        return bao_cao_cong_no.so_chi_tiet_phai_tra(
            self.repo, self.purchases, doi_tuong_id=doi_tuong_id,
            tu_ngay=tu_ngay, den_ngay=den_ngay,
        )

    def khoan_con_no_phai_thu(self, *, doi_tuong_id: int | None, den_ngay: date) -> dict:
        """Hoá đơn bán còn nợ của một khách tại `den_ngay` — tab "Hoá đơn còn nợ" của sổ."""
        return bao_cao_cong_no.khoan_con_no_phai_thu(
            self.repo, doi_tuong_id=doi_tuong_id, den_ngay=den_ngay
        )

    def khoan_con_no_phai_tra(self, *, doi_tuong_id: int | None, den_ngay: date) -> dict:
        """Đợt giao còn nợ của một NCC tại `den_ngay` — tab "Đợt còn nợ" của sổ."""
        return bao_cao_cong_no.khoan_con_no_phai_tra(
            self.repo, self.purchases, doi_tuong_id=doi_tuong_id, den_ngay=den_ngay
        )

    def so_chi_tiet_tat_ca_phai_thu(
        self, *, tu_ngay: date, den_ngay: date, loc=bao_cao_cong_no.TAT_CA
    ) -> dict:
        """Sổ chi tiết TK 131 cho file Excel: mọi khách trong kỳ, hoặc đúng một khách (`loc`)."""
        return bao_cao_cong_no.so_chi_tiet_tat_ca_phai_thu(
            self.repo, tu_ngay=tu_ngay, den_ngay=den_ngay, loc=loc
        )

    def so_chi_tiet_tat_ca_phai_tra(
        self, *, tu_ngay: date, den_ngay: date, loc=bao_cao_cong_no.TAT_CA
    ) -> dict:
        """Sổ chi tiết TK 331 cho file Excel: mọi NCC trong kỳ, hoặc đúng một NCC (`loc`)."""
        return bao_cao_cong_no.so_chi_tiet_tat_ca_phai_tra(
            self.repo, self.purchases, tu_ngay=tu_ngay, den_ngay=den_ngay, loc=loc
        )

    @staticmethod
    def _han_gan_nhat_phieu(row) -> date | None:
        """Hạn trả GẦN NHẤT trong các đợt CÒN NỢ của một phiếu (None = không đợt nào có hạn).

        Cùng phép phân bổ (`phan_bo_tien_dot`, `con_no` đã trừ cọc) và cùng hàm hạn
        (`han_tra_dot`) mà `_no_tung_dot`/`_no_theo_han` dùng — chỉ khỏi dựng phần hiển thị
        từng dòng hàng, vì ở đây chỉ cần một cái ngày."""
        phan_bo, _coc, _du = phan_bo_tien_dot(row)
        cac_han = [
            han
            for m in phan_bo
            if m["con_no"] > 0
            and (han := han_tra_dot(m["delivery"], row.supplier)) is not None
        ]
        return min(cac_han, default=None)

    @staticmethod
    def _co_dot_thieu_hoa_don(row) -> bool:
        """Phiếu còn ít nhất một ĐỢT GIAO CÒN NỢ chưa ghi số hoá đơn (bộ lọc "Có đợt giao chưa ghi
        hoá đơn"). Cùng phép phân bổ `phan_bo_tien_dot` (`con_no` đã trừ cọc). Phiếu cũ không theo
        đợt không có hoá đơn theo đợt ⇒ không tính."""
        phan_bo, _coc, _du = phan_bo_tien_dot(row)
        return any(
            m["con_no"] > 0 and not (m["delivery"].invoice_number or "").strip() for m in phan_bo
        )

    def payables_summary(
        self,
        *,
        q: str | None = None,
        filter_: str = "all",
        aging_bucket: str | None = None,
        page: int = 1,
        size: int = 20,
        tu_ngay: date | None = None,
        den_ngay: date | None = None,
        no_tu: int | None = None,
        no_den: int | None = None,
        han_tra: str | None = None,
        han_muc: str | None = None,
        ca_da_tra_het: bool = False,
        thieu_hoa_don: bool = False,
        dem_only: bool = False,
        chi_tong: bool = False,
        sap_xep: str | None = None,
        chieu: str | None = None,
    ) -> dict:
        """Công nợ phải trả gom theo nhà cung cấp.

        Dựng dòng khi **còn nợ > 0 HOẶC đã trả trong kỳ > 0**. Chỉ lấy "còn nợ > 0" là NCC vừa trả
        hết biến mất khỏi bảng ngay — mà đó đúng là lúc cần thấy nhất: câu hỏi *"làm sao biết mình
        đã trả hết"* chỉ trả lời được bằng cách NHÌN THẤY danh sách đã trả, không phải bằng việc
        không thấy gì (im lặng còn có nghĩa là màn hỏng).

        `q` = tìm theo tên NCC. Khi có `q` thì lôi ra **mọi** NCC khớp tên, kể cả nợ 0đ và không hề
        giao dịch trong kỳ — dùng để tra một NCC đã im lặng lâu. Lọc ở SERVER chứ không lọc trên
        danh sách đã dựng, vì NCC đó vốn không có dòng nào để mà lọc.

        `aging_bucket` = một khoá trong `AGING_KEYS`: chỉ giữ NCC còn tiền trong RỔ TUỔI đó. Đi
        cùng đường với `filter_` (lọc trên danh sách đã dựng, sau khi thẻ tổng đã chốt), nên bấm
        một rổ KHÔNG làm mấy con số tổng ở đầu màn nhảy theo.

        THEO KỲ (05/10/2026): có `tu_ngay` + `den_ngay` thì `paid_in_period` = phiếu chi có ngày chi
        trong kỳ (cách ảnh chụp), `mua_trong_ky` = PS Có của sổ 331 (`bao_cao_cong_no`). Còn nợ /
        quá hạn / tuổi nợ: kỳ kết thúc hôm nay ⇒ ảnh chụp như cũ; kỳ đã qua ⇒ dư cuối kỳ + tuổi nợ
        tại `den_ngay` của sổ, kẹp ≥ 0 — không có công thức thứ hai. Hạn mức, số ngày cho nợ,
        `han_gan_nhat`, "đơn còn nợ" luôn của HÔM NAY. Không có kỳ = hành vi cũ (kỳ 3 tháng).

        Bộ lọc nâng cao (`no_tu/no_den`, `han_tra`, `han_muc`) đi cùng đường với `filter_`: chọn
        DÒNG, không đổi số tổng đầu màn. Có kỳ thì NCC đã về 0 bị ẩn khỏi danh sách (vẫn được cộng
        vào tổng "đã trả") trừ khi `ca_da_tra_het` hoặc đang tìm tên. `thieu_hoa_don` = chỉ giữ NCC
        còn ít nhất một đợt giao CÒN NỢ chưa ghi số hoá đơn (theo hôm nay, như `han_gan_nhat`).
        `dem_only` = chỉ trả số đếm.

        `chi_tong` (06/10/2026) = chỉ các số TỔNG (lời "cùng kỳ" của màn): bỏ phần chỉ phục vụ dòng
        (`han_gan_nhat`, `thieu_hoa_don`, bộ lọc, đếm nhóm nút, cắt trang) và trả `items=[]`,
        `total=0`, `the_loc` mặc định. Các số tổng tính CÙNG đoạn mã với lời thường nên bằng đúng.

        `the_loc` = số NCC của ba nút "Tất cả | Quá hạn | Vượt hạn mức", đếm SAU tìm / kỳ / bộ lọc
        nâng cao / rổ tuổi nhưng TRƯỚC `filter_` — số của mỗi nút không đổi theo nút đang chọn, và
        bấm nút nào bảng ra đúng số đó. Tính trong cùng lượt, màn khỏi gọi thêm ba lời đếm.

        BẢNG ĐỦ CỘT (06/10/2026): mỗi dòng mang thêm mã + liên hệ của NCC và lần TRẢ GẦN NHẤT (phiếu
        chi đã chi mới nhất, cả lịch sử — không theo kỳ). `sap_xep` + `chieu` sắp dòng trước khi cắt
        trang (`_sap_xep_cong_no`)."""
        hom_nay = _business_today()
        co_ky = tu_ngay is not None and den_ngay is not None
        moc_ky = tu_ngay if co_ky else hom_nay - timedelta(days=31 * PAYABLES_PERIOD_MONTHS)
        # `den_ngay` ở tương lai ⇒ chặn về hôm nay: chưa có chứng từ nào sau hôm nay, và mốc của bộ
        # lọc "tới hạn trong 7/30 ngày" phải đếm từ hôm nay chứ không từ một ngày chưa tới.
        cuoi_ky = min(den_ngay, hom_nay) if co_ky else hom_nay
        # Kỳ kết thúc HÔM NAY (mọi kỳ mặc định: tháng/quý/năm này, 12 tháng qua) thì phần CÒN NỢ /
        # quá hạn / tuổi nợ vẫn tính bằng ẢNH CHỤP như cũ, KHÔNG lấy dư cuối kỳ của sổ 331: sổ cộng
        # RÒNG theo NCC nên cọc thừa của đơn này bù sang đơn khác (ra nợ âm), và sổ chỉ ghi nợ theo
        # ĐỢT GIAO nên đơn nhận hàng bằng `mark-received` (không có đợt) biến mất. Chỉ kỳ đã QUA mới
        # dùng dư cuối kỳ của sổ (kẹp ≥ 0). Hai lỗ của sổ theo dõi riêng (chốt 05/10/2026).
        so_chup = cuoi_ky >= hom_nay
        tim = (q or "").strip().lower()
        theo_ncc: dict[int | None, dict] = {}

        def _muc_moi(supplier_id, ten, supplier) -> dict:
            lien_he = self._lien_he_ncc(supplier)
            return {
                "supplier_id": supplier_id,
                "supplier_name": ten,
                "order_count": 0,
                "overdue_amount": 0,
                "no_han_amount": 0,
                # Rổ tuổi của RIÊNG NCC này. NCC không nợ gì vẫn có đủ 6 rổ = 0.
                "aging": _aging_rong(),
                "paid_in_period": 0,
                "mua_trong_ky": 0,
                "han_gan_nhat": None,
                "total_due": 0,
                "credit_limit": int(getattr(supplier, "credit_limit", 0) or 0) if supplier else 0,
                "credit_days": getattr(supplier, "credit_days", None) if supplier else None,
                "supplier_code": getattr(supplier, "code", None) if supplier else None,
                "lien_he_ten": lien_he[0],
                "lien_he_sdt": lien_he[1],
                "tra_gan_nhat_ngay": None,
                "tra_gan_nhat_tien": 0,
            }

        def _muc(row) -> dict:
            if row.supplier_id not in theo_ncc:
                theo_ncc[row.supplier_id] = _muc_moi(
                    row.supplier_id,
                    row.supplier.name if row.supplier else "(không rõ NCC)",
                    row.supplier,
                )
            return theo_ncc[row.supplier_id]

        # Nạp MỘT lần cả lịch sử phiếu mua đã duyệt: vòng ảnh chụp dưới đây và sổ 331 (khối
        # `if co_ky`) dùng chung, không nạp lại.
        don_ds = self.purchases.list_for_payables()
        # Lần TRẢ gần nhất của từng NCC — cả lịch sử, đọc từ phiếu chi đã nạp sẵn (không thêm truy
        # vấn). Tính trước vòng dưới vì vòng đó bỏ qua đơn đã trả hết từ lâu.
        tra_cuoi: dict[int | None, tuple] = {}
        if not chi_tong:
            for row in don_ds:
                for v in row.khoan_chi:
                    if v.status != PAYMENT_VOUCHER_PAID:
                        continue
                    # Theo dòng phân bổ nhưng số là của CẢ phiếu — "lần trả cuối" là một lần chi.
                    moc = (self._ngay_chi(v), v.voucher_id, int(v.voucher.amount_vnd))
                    cu = tra_cuoi.get(row.supplier_id)
                    if cu is None or moc[:2] > cu[:2]:
                        tra_cuoi[row.supplier_id] = moc
        for row in don_ds:
            no = self._no_cua_phieu(row)
            da_tra_ky = sum(
                int(v.amount_vnd)
                for v in row.khoan_chi
                if v.status == PAYMENT_VOUCHER_PAID and moc_ky <= self._ngay_chi(v) <= cuoi_ky
            )
            ten = (row.supplier.name if row.supplier else "").lower()
            khop_tim = bool(tim) and tim in ten
            if no["con_no"] <= 0 and da_tra_ky <= 0 and not khop_tim:
                continue
            muc = _muc(row)
            muc["paid_in_period"] += da_tra_ky
            if no["con_no"] <= 0:
                # Đơn không còn nợ vẫn được góp tiền đã trả, nhưng KHÔNG đếm vào "Đơn còn nợ" —
                # cột đếm mà lẫn đơn đã xong là nó chửi nhau với cột "Tổng còn nợ".
                continue
            muc["order_count"] += 1
            # `han_gan_nhat` và cờ thiếu hoá đơn chỉ phục vụ DÒNG — lời `chi_tong` bỏ qua.
            han = None if chi_tong else self._han_gan_nhat_phieu(row)
            if han is not None and (muc["han_gan_nhat"] is None or han < muc["han_gan_nhat"]):
                muc["han_gan_nhat"] = han
            if thieu_hoa_don and not chi_tong and not muc.get("_thieu_hoa_don"):
                # Chỉ tính khi có người lọc — thêm một lượt phân bổ cho phiếu này.
                muc["_thieu_hoa_don"] = self._co_dot_thieu_hoa_don(row)
            if not so_chup:
                # Kỳ đã qua: còn nợ do sổ 331 ghi đè ngay dưới — tính ở đây là phí hai lượt phân bổ.
                continue
            muc["total_due"] += no["con_no"]
            qua_han, chua_han = self._no_theo_han(row, no["con_no"], hom_nay)
            muc["overdue_amount"] += qua_han
            muc["no_han_amount"] += chua_han
            # Rổ tuổi = xé chính hai con số trên ra theo `overdue_days`, không cộng lại từ đầu.
            _aging_cong(muc["aging"], self._no_theo_ro_tuoi(row, no["con_no"], hom_nay))

        if so_chup:
            # NCC hoàn tiền không gắn đơn ⇒ mình nợ thêm, cộng vào đợt hạn muộn nhất (#36). Kỳ đã qua
            # thì sổ 331 ghi đè còn nợ ngay dưới — sổ vốn đã tính phiếu hoàn.
            hoan_ncc = self.repo.ncc_hoan_khong_don()
            for sid, row, d, tien in self._hoan_ncc_theo_dot(don_ds, hoan_ncc) if hoan_ncc else []:
                muc = _muc(row)
                muc["total_due"] += tien
                tre = ((hom_nay - d["due_date"]).days
                       if d["due_date"] is not None and d["due_date"] < hom_nay else 0)
                if tre > 0:
                    muc["overdue_amount"] += tien
                else:
                    muc["no_han_amount"] += tien
                ro = muc["aging"][ro_tuoi(tre) if tre > 0 else AGING_CHUA_TOI_HAN]
                ro["amount"] += tien
                ro["count"] += 1

        if co_ky:
            # Kỳ kết thúc hôm nay thì rổ tuổi của sổ không được đọc (còn nợ / tuổi nợ theo ảnh
            # chụp) ⇒ bỏ luôn lượt phân tuổi của sổ: mỗi đơn đỡ một lần `phan_bo_tien_dot`.
            bc = bao_cao_cong_no.tong_hop_phai_tra(
                self.repo, self.purchases, tu_ngay=tu_ngay, den_ngay=cuoi_ky,
                don_da_nap=don_ds, tinh_tuoi=not so_chup,
            )
            theo_bc = {it["doi_tuong_id"]: it for it in bc["items"] if it["doi_tuong_id"] is not None}
            # NCC chỉ có phát sinh trong kỳ (hôm nay đã hết nợ) vẫn phải có dòng — nạp danh mục
            # MỘT lượt cho cả nhóm đó.
            thieu = {sid for sid in theo_bc if sid not in theo_ncc}
            ncc = self.repo.ncc_theo_ids(thieu)
            for sid in thieu:
                theo_ncc[sid] = _muc_moi(sid, theo_bc[sid]["ten"], ncc.get(sid))
            for sid, muc in theo_ncc.items():
                it = theo_bc.get(sid)
                # "Mua thêm trong kỳ" = PS Có của sổ (gồm cả tiền NCC hoàn lại). "Đã trả trong kỳ"
                # giữ cách ảnh chụp: phiếu chi của đơn có ngày chi trong kỳ (đã cộng ở vòng trên).
                muc["mua_trong_ky"] = it["ps_co"] if it else 0
                if not so_chup:
                    _ap_du_cuoi_ky_qua_khu(muc, it, phai_tra=True)

        for sid, muc in theo_ncc.items():
            if sid in tra_cuoi:
                muc["tra_gan_nhat_ngay"], _, muc["tra_gan_nhat_tien"] = tra_cuoi[sid]
        items = sorted(
            theo_ncc.values(),
            key=lambda m: (m["total_due"], m["paid_in_period"]),
            reverse=True,
        )
        for m in items:
            # Cảnh báo MỀM (Đ6): chỉ gắn cờ, không chặn gì ở đâu.
            m["vuot_han_muc"] = m["credit_limit"] > 0 and m["total_due"] > m["credit_limit"]
            m["vuot_bao_nhieu"] = (
                max(0, m["total_due"] - m["credit_limit"]) if m["credit_limit"] > 0 else 0
            )

        # Thẻ tổng quan luôn tính trên TOÀN BỘ NCC đang có hoạt động/nợ, không đổi theo ô tìm kiếm,
        # bộ lọc hay trang hiện tại. Dòng nợ 0 chỉ được lôi ra khi người dùng chủ động tìm tên.
        tong_hop = [
            m for m in items
            if m["total_due"] > 0 or m["paid_in_period"] > 0 or m["mua_trong_ky"] > 0
        ]
        # Dải rổ tuổi ở ĐẦU MÀN tính trên `tong_hop` — cùng gốc với thẻ "Tổng phải trả"/"Quá hạn",
        # nên bấm lọc hay lật trang KHÔNG làm nó nhảy. Dải mà nhảy theo trang thì nó đang đo cái
        # trang, không đo món nợ.
        tong_ro = _aging_rong()
        for m in tong_hop:
            _aging_cong(tong_ro, m["aging"])
        # Mọi số TỔNG của câu trả lời, một chỗ: lời thường và lời `chi_tong` cùng đọc từ đây.
        tong_so = {
            "total_due": sum(m["total_due"] for m in tong_hop),
            # GIỮ NGUYÊN: nhiều chỗ đang ăn con số này. Rổ tuổi chỉ XÉ nó ra chứ không thay nó.
            "overdue_amount": sum(m["overdue_amount"] for m in tong_hop),
            "aging": _aging_ra_danh_sach(tong_ro),
            "paid_in_period": sum(m["paid_in_period"] for m in tong_hop),
            "mua_trong_ky": sum(m["mua_trong_ky"] for m in tong_hop),
            "vuot_han_muc_count": sum(1 for m in tong_hop if m["vuot_han_muc"]),
            "period_months": PAYABLES_PERIOD_MONTHS,
            "tu_ngay": moc_ky,
            "den_ngay": cuoi_ky,
            "as_of": hom_nay,
        }
        if chi_tong:
            return {"items": [], "total": 0, "page": 1, "size": 1, "pages": 1, **tong_so}
        if tim:
            items = [m for m in items if tim in (m["supplier_name"] or "").lower()]
        else:
            items = tong_hop
            if co_ky and not ca_da_tra_het:
                items = [m for m in items if m["total_due"] > 0]
        items = _loc_nang_cao(
            items, no_tu=no_tu, no_den=no_den, han_tra=han_tra, han_muc=han_muc, moc=cuoi_ky
        )
        if thieu_hoa_don:
            items = [m for m in items if m.get("_thieu_hoa_don")]
        # Khoá phụ chỉ để lọc — không đi ra ngoài service (schema bỏ qua, nhưng dict thì không).
        for m in theo_ncc.values():
            m.pop("_thieu_hoa_don", None)
        # Lọc theo RỔ TUỔI: khoá lạ thì BỎ QUA (không lọc), y như `filter_` lạ — cửa lọc không phải
        # chỗ ném 422 vào mặt người đang xem công nợ.
        if aging_bucket in AGING_KEYS:
            items = [m for m in items if m["aging"][aging_bucket]["amount"] > 0]
        # Số trên nhóm nút đếm TRƯỚC `filter_` (lọc giao nhau nên đổi thứ tự không đổi kết quả).
        the_loc = _the_loc_cong_no(items)
        items = _loc_the_cong_no(items, filter_)
        items = _sap_xep_cong_no(
            items, sap_xep, chieu, khoa_gan_nhat="tra_gan_nhat_ngay", khoa_ky="paid_in_period"
        )
        # Dòng Cộng của bảng: trên MỌI dòng đã lọc, trước khi cắt trang. `dem_only` chỉ cần số đếm
        # nên bỏ qua cho nhẹ (`chi_tong` đã thoát ở trên).
        tong_loc = None if dem_only else _tong_loc_cong_no(
            items,
            so_khoan=lambda m: sum(r["count"] for r in m["aging"].values()),
            khoa_ky_1="mua_trong_ky", khoa_ky_2="paid_in_period",
        )

        page = max(1, page)
        size = max(1, min(size, 200))
        total = len(items)
        pages = max(1, (total + size - 1) // size)
        page = min(page, pages)
        bat_dau = (page - 1) * size
        return {
            "items": [] if dem_only else items[bat_dau:bat_dau + size],
            "total": total,
            "page": page,
            "size": size,
            "pages": pages,
            "the_loc": the_loc,
            "tong_loc": tong_loc,
            **tong_so,
        }

    @staticmethod
    def _lien_he_ncc(supplier) -> tuple[str | None, str | None]:
        """(Tên liên hệ, số điện thoại) của NCC — MỘT nguồn cho dòng danh sách và ngăn chi tiết."""
        if supplier is None:
            return None, None
        return getattr(supplier, "contact_name", None), getattr(supplier, "phone", None)

    def _tk_nhan_ncc(self, supplier_id: int) -> str | None:
        """Tài khoản nhận tiền MẶC ĐỊNH (đang dùng) của NCC dạng "{ngân hàng} {số tài khoản}".
        Không có tài khoản mặc định thì None — không đoán một tài khoản khác."""
        for acc in self.repo.list_supplier_accounts(supplier_id=supplier_id, active_only=True):
            if acc.is_default:
                return f"{acc.bank_name} {acc.account_number}".strip()
        return None

    def payables_detail(
        self,
        supplier_id: int,
        *,
        all_history: bool = False,
        tu_ngay: date | None = None,
        den_ngay: date | None = None,
        paid_page: int = 1,
        paid_size: int | None = None,
    ) -> dict:
        """Chi tiết công nợ một NCC — chưa vào sổ · 🟡 chờ chi · ✅ đã chi trong kỳ.


        `all_history=True` bỏ mốc kỳ cho riêng rổ ✅ — dùng cho nút "Xem lịch sử cũ hơn". NCC trả
        hết từ 5 tháng trước thì mặc định rổ ✅ rỗng, tra ra "không nợ" nhưng không thấy đã trả
        những gì; nút này để với tới.

        Nới chỉ cho MỘT NCC nên vẫn nhẹ. Đừng bao giờ nới cho cả bảng tổng hợp — lúc đó mỗi lần mở
        màn phải quét mọi đơn từ ngày mở công ty.

        `tu_ngay` + `den_ngay` (05/10/2026): rổ ✅ chỉ lấy phiếu chi có ngày chi trong kỳ — khớp
        cột "Đã trả trong kỳ" của màn tổng hợp đang chọn cùng kỳ. Các khoản CÒN NỢ vẫn là của hôm
        nay (đó là việc phải làm, không phải sổ). `all_history` thắng kỳ: bỏ cả hai mốc.

        `paid_size` (06/10/2026): rổ ✅ chỉ trả MỘT TRANG (`paid_page`, mới nhất trước) — nút "Xem
        thêm" của ngăn gọi trang tiếp. `paid_total` / `paid_in_period` vẫn là của CẢ phạm vi.
        Không truyền `paid_size` = trả trọn như cũ."""
        hom_nay = _business_today()
        co_ky = tu_ngay is not None and den_ngay is not None and not all_history
        moc_ky = (
            date.min if all_history
            else tu_ngay if co_ky
            else hom_nay - timedelta(days=31 * PAYABLES_PERIOD_MONTHS)
        )
        cuoi_ky = den_ngay if co_ky else date.max
        supplier = self.suppliers.get_by_id(supplier_id)
        con_no: list[dict] = []
        coc_chung: list[dict] = []
        da_chi: list[dict] = []
        qua_han_tong = 0
        don_ds = self.purchases.list_for_payables(supplier_id=supplier_id)
        dot_cua = {row.id: self._no_tung_dot(row) for row in don_ds}
        # NCC hoàn tiền không gắn đơn ⇒ cộng vào đợt hạn muộn nhất, đợt mang khoản riêng `hoan_ncc` (#36).
        hoan_ncc = self.repo.ncc_hoan_khong_don([supplier_id])
        hoan_dot = {d["delivery_id"]: tien
                    for _s, _r, d, tien in self._hoan_ncc_theo_dot(don_ds, hoan_ncc, dot_cua)}
        for row in don_ds:
            no = self._no_cua_phieu(row)
            money = no["money"]
            # Quá hạn tính SAU khi trừ cọc — cọc đã trả rồi thì phần đó không còn trễ. Dùng chung
            # hàm với màn tổng hợp để hai màn không bao giờ ra hai con số.
            qua_han_tong += self._no_theo_han(row, no["con_no"], hom_nay)[0]
            dots, coc, coc_du = dot_cua[row.id]
            for d in dots:
                d["hoan_ncc"] = hoan_dot.get(d["delivery_id"], 0)
                if d["hoan_ncc"]:
                    d["con_no"] += d["hoan_ncc"]
                    if d["due_date"] is not None and d["due_date"] < hom_nay:
                        qua_han_tong += d["hoan_ncc"]
            if coc > 0:
                # CỌC là cọc của CẢ ĐƠN, không thuộc đợt nào — hiện thành dòng riêng chứ không nhét
                # vào cột "đã trả" của một đợt. Nhét vào là bảng nói dối: người đối chiếu với NCC
                # theo từng đợt sẽ không khớp được với sao kê.
                #
                # `da_dung` để màn hình nói được "cọc 100.000, đã bù hết vào đợt 1" — nếu không,
                # người đọc thấy một dòng trừ 100.000 mà không biết nó trừ vào đâu.
                coc_chung.append(
                    {
                        "purchase_request_id": row.id,
                        "code": row.code,
                        "status": row.status,
                        "amount": coc,
                        "da_dung": max(0, coc - coc_du),
                        "con_du": max(0, coc_du),
                    }
                )
            # ĐƠN nào còn ít nhất một đợt chưa trả hết thì liệt kê CẢ những đợt đã tất toán của nó
            # (cờ `da_tat_toan`, màn hình làm mờ). Vì sao (chủ chốt 27/08/2026): cọc bù theo lối
            # GIAO TRƯỚC BÙ TRƯỚC, nên đợt sớm thường bị cọc nuốt trọn rồi biến mất — người đọc thấy
            # badge "cọc 3.500.000 đã trừ hết vào đợt giao" mà cả bảng chỉ trừ được 100.000, không
            # dò ngược được 3.400.000 kia đi đâu.
            #
            # Đơn TẤT TOÁN SẠCH thì vẫn im lặng hoàn toàn — khối này tên là "Đợt giao còn nợ", và
            # `test_coc_la_coc_ca_don_khong_thuoc_dot_nao` chốt đúng điều đó.
            # `if dots:` phải giữ nguyên hình dạng cũ — đổi thành `if dots and ...` là đơn có đợt
            # nhưng tất toán sạch sẽ rơi xuống nhánh `elif` bên dưới và hiện lại thành một dòng
            # "cả đơn", đúng thứ nhánh đó chỉ dành cho dữ liệu CŨ không có đợt nào.
            if dots:
                con_thieu = any(d["con_no"] > 0 for d in dots)
                for d in dots if con_thieu else []:
                    da_tat_toan = d["con_no"] <= 0
                    # Tính MỘT lần rồi tái dùng cho cả `overdue_days` lẫn `aging_bucket` — hai
                    # trường phải luôn khớp nhau, tách ra tính hai lần là mở cửa cho chúng lệch.
                    #
                    # Đợt ĐÃ TẤT TOÁN luôn 0 ngày trễ: hết nợ thì không thể trễ. Ép ở đây chứ không
                    # để màn hình tự lọc — `overdue_days` nuôi cả pill "Quá hạn" của drawer lẫn bộ
                    # lọc tab, để nó > 0 là dòng đã trả xong chui vào tab Quá hạn.
                    so_ngay_tre = (
                        0
                        if da_tat_toan
                        else (hom_nay - d["due_date"]).days
                        if d["due_date"] is not None and d["due_date"] < hom_nay
                        else 0
                    )
                    con_no.append(
                        {
                            "purchase_request_id": row.id,
                            "code": row.code,
                            "status": row.status,
                            "lines": d["lines"],
                            "delivery_id": d["delivery_id"],
                            "seq_no": d["seq_no"],
                            "delivery_date": d["delivery_date"],
                            "due_date": d["due_date"],
                            # Cùng lý do: đợt đã tất toán không phải món nợ "chưa đặt hạn" cần ai
                            # canh, nên không được ghim lên đầu lẫn không được đếm vào lời nhắc.
                            "chua_dat_han": (not da_tat_toan) and d["due_date"] is None,
                            "overdue_days": so_ngay_tre,
                            "aging_bucket": ro_tuoi(so_ngay_tre) if so_ngay_tre > 0 else None,
                            "invoice_symbol": d["invoice_symbol"],
                            "invoice_number": d["invoice_number"],
                            "invoice_date": d["invoice_date"],
                            "hoa_don_files": d["hoa_don_files"],
                            "amount": d["amount"],
                            "paid": d["paid"],
                            "coc_bu": d["coc_bu"],
                            "hoan_ncc": d["hoan_ncc"],
                            "con_no": d["con_no"],
                            "da_tat_toan": da_tat_toan,
                        }
                    )
            elif no["con_no"] > 0:
                # Phiếu CŨ không theo dõi theo đợt: nợ chỉ quy được về mức PHIẾU. Không có hạn trả
                # nên không bao giờ vào cột Quá hạn — vẫn phải hiện, và `chua_dat_han` kéo nó lên đầu.
                con_no.append(
                    {
                        "purchase_request_id": row.id,
                        "code": row.code,
                        "status": row.status,
                        "delivery_id": None,
                        "seq_no": None,
                        "delivery_date": None,
                        "due_date": None,
                        "chua_dat_han": True,
                        "overdue_days": 0,
                        "aging_bucket": None,
                        "invoice_number": None,
                        "amount": money["gia_tri_da_giao"],
                        "paid": money["net_paid"],
                        "hoan_ncc": 0,
                        "con_no": no["con_no"],
                        # Nhánh này chỉ chạy khi CÒN nợ (`elif no["con_no"] > 0`) ⇒ không bao giờ
                        # là dòng tất toán. Vẫn phải khai khoá: hàm sắp xếp đọc thẳng `x["da_tat_toan"]`.
                        "da_tat_toan": False,
                    }
                )
            # Số ĐỢT của từng phiếu chi. Chỉ có `delivery_id` thì màn hình đành ghi "trả theo đợt"
            # chung chung — cầm sao kê NCC đối chiếu không biết dòng nào là đợt mấy (chủ 07/08/2026).
            seq_theo_dot = {d.id: d.seq_no for d in (getattr(row, "deliveries", []) or [])}
            # Một dòng kết quả cho MỖI DÒNG PHÂN BỔ (17/10/2026): phiếu gộp trả 3 khoản hiện 3 dòng, mỗi
            # dòng số của khoản đó, kèm tổng phiếu để đối chiếu với sao kê.
            for k in row.khoan_chi:
                v = k.voucher
                if v.status != PAYMENT_VOUCHER_PAID:
                    continue
                ngay = self._ngay_chi(v)
                if ngay < moc_ky or ngay > cuoi_ky:
                    continue
                did = k.delivery_id
                da_chi.append(
                    {
                        "voucher_id": v.id,
                        "code": v.code,
                        "doc_no": v.doc_no,
                        "voucher_type": v.voucher_type,
                        "payment_stage": k.payment_stage,
                        "delivery_id": did,
                        "delivery_seq_no": seq_theo_dot.get(did),
                        "purchase_request_id": row.id,
                        "purchase_code": row.code,
                        "amount": int(k.amount_vnd),
                        "voucher_amount": int(v.amount_vnd),
                        "so_dong": len(v.lines),
                        "invoice_number": v.invoice_number,
                        "invoice_date": v.invoice_date,
                        "has_attachment": bool(v.attachments),
                        "paid_date": ngay,
                        # `_user_name` đi qua `Session.get` ⇒ cùng một kế toán lập 20 phiếu vẫn chỉ
                        # một lượt vào DB (lần sau lấy ở identity map), không thành N+1.
                        "created_by_user_id": v.created_by_user_id,
                        "created_by_name": self._user_name(v.created_by_user_id),
                    }
                )
        # Sắp MỚI NHẤT → CŨ NHẤT theo ngày giao (chủ chốt 27/08/2026): việc vừa xảy ra là việc đang
        # phải xử, đợt từ mấy tháng trước để xuống dưới.
        #
        # HAI ngoại lệ giữ nguyên, đứng TRƯỚC ngày giao trong khoá sắp:
        #  - Đợt THIẾU hạn trả lên ĐẦU: chúng không bao giờ vào được cột Quá hạn nên phải đập vào
        #    mắt để còn đi khai "số ngày cho nợ" của NCC. Dìm chúng theo ngày là giấu nợ.
        #  - Đợt ĐÃ TẤT TOÁN xuống ĐÁY: chúng chỉ ở đây để dò dấu tiền cọc, không phải việc phải làm.
        con_no.sort(
            key=lambda x: (
                x["da_tat_toan"],
                x["due_date"] is not None,
                -(x["delivery_date"].toordinal() if x["delivery_date"] else 0),
                -(x["seq_no"] or 0),
            )
        )
        da_chi.sort(key=lambda x: x["paid_date"], reverse=True)
        tong_da_chi = sum(x["amount"] for x in da_chi)
        so_lan_chi = len(da_chi)
        if paid_size is not None:
            paid_size = max(1, min(paid_size, 200))
            bat_dau = (max(1, paid_page) - 1) * paid_size
            da_chi = da_chi[bat_dau:bat_dau + paid_size]
        han_muc = int(getattr(supplier, "credit_limit", 0) or 0) if supplier is not None else 0
        # `con_no` của từng đợt ĐÃ trừ cọc trong `_no_tung_dot` ⇒ cộng thẳng, KHÔNG trừ lần nữa.
        # Cọc lớn hơn nợ (ứng trước nhiều, hàng về ít) chỉ làm mọi đợt về 0, không thành số âm —
        # phần dôi ra là khoản phải THU, việc khác, không thuộc màn này.
        tong_no = sum(x["con_no"] for x in con_no)
        tong_coc = sum(x["amount"] for x in coc_chung)
        # Rổ tuổi của drawer đếm trên ĐÚNG danh sách đang hiện bên dưới nó (`con_no`), nên pill và
        # bảng không bao giờ chửi nhau. Đợt chưa có hạn có `overdue_days` = 0 ⇒ rơi vào "chưa tới
        # hạn" và vẫn giữ badge "Chưa đặt hạn" ở cột Hạn trả — nó không bị rổ tuổi nuốt mất.
        ro_chi_tiet = _aging_rong()
        for x in con_no:
            # Dòng ĐÃ TẤT TOÁN chỉ nằm trong danh sách để dò dấu tiền cọc — nó không phải một khoản
            # nợ. Cộng 0đ thì vô hại nhưng `count` sẽ nhảy, và pill "chưa tới hạn" đếm luôn cả những
            # đợt đã trả xong: pill và bảng lại nói hai kiểu.
            if x["da_tat_toan"]:
                continue
            khoa = ro_tuoi(x["overdue_days"])
            ro_chi_tiet[khoa]["amount"] += x["con_no"]
            ro_chi_tiet[khoa]["count"] += 1
        lien_he_ncc = self._lien_he_ncc(supplier)
        return {
            "supplier_id": supplier_id,
            "supplier_name": supplier.name if supplier is not None else "(không rõ NCC)",
            "credit_limit": han_muc,
            "credit_days": getattr(supplier, "credit_days", None) if supplier is not None else None,
            "vuot_han_muc": han_muc > 0 and tong_no > han_muc,
            "vuot_bao_nhieu": max(0, tong_no - han_muc) if han_muc > 0 else 0,
            "lien_he_ten": lien_he_ncc[0],
            "lien_he_sdt": lien_he_ncc[1],
            "tk_nhan": self._tk_nhan_ncc(supplier_id) if supplier is not None else None,
            "items": con_no,
            # Cọc/ứng trước của CẢ ĐƠN — dòng riêng, không thuộc đợt nào (chủ chốt 06/08/2026).
            "coc_chung": coc_chung,
            "coc_chung_amount": tong_coc,
            "paid": da_chi,
            "paid_total": so_lan_chi,
            "period_months": PAYABLES_PERIOD_MONTHS,
            "all_history": all_history,
            "total_due": tong_no,
            "overdue_amount": qua_han_tong,
            "aging": _aging_ra_danh_sach(ro_chi_tiet),
            "paid_in_period": tong_da_chi,
            "as_of": hom_nay,
        }

    # --- vouchers ---------------------------------------------------------

    def list_vouchers(self, **filters):
        rows, total, totals = self.repo.list_vouchers(**filters)
        self._nap_ten_nguoi(
            [u for r in rows for u in (r.created_by_user_id, r.paid_by_user_id, r.cancelled_by_user_id)]
            + [r.purchase_request.created_by_user_id for r in rows if r.purchase_request is not None]
        )
        return [self._voucher_out(row) for row in rows], total, totals

    def get_voucher(self, voucher_id: int):
        row = self._voucher(voucher_id)
        out = self._voucher_out(row)
        out["truoc_do"], out["con_no_sau"] = self._doi_chieu_phieu_chi(row)
        out["doi_chieu"] = self._doi_chieu_tung_dong(row) if len(row.lines) > 1 else []
        return out

    def _doi_chieu_tung_dong(self, row: PaymentVoucher) -> list[dict]:
        """Phiếu GỘP: đối chiếu của từng dòng trả đợt — đã trả trước phiếu này và còn nợ sau nó."""
        ra = []
        for k in row.lines:
            if k.delivery_id is None or k.purchase_request is None:
                continue
            dot = next((d for d in phan_bo_tien_dot(k.purchase_request)[0]
                        if d["delivery"].id == k.delivery_id), None)
            if dot is None:
                continue
            truoc_do = self.repo.tong_chi_dot_truoc_phieu(k.delivery_id, row.id)
            phieu_nay = int(k.amount_vnd) if row.status == PAYMENT_VOUCHER_PAID else 0
            ra.append({
                "purchase_code": k.purchase_request.code,
                "delivery_seq_no": dot["delivery"].seq_no,
                "truoc_do": truoc_do,
                "con_no_sau": max(0, int(dot["amount"]) - int(dot["coc_bu"]) - truoc_do - phieu_nay),
            })
        return ra

    def _doi_chieu_phieu_chi(self, row: PaymentVoucher) -> tuple[int | None, int | None]:
        """Số đã trả TRƯỚC phiếu chi này và số còn nợ của đợt SAU phiếu này (bảng đối chiếu ở ngăn).

        `paid` của đợt tính cả phiếu lập sau nên không dùng được. Chỉ phiếu trả đích danh một đợt
        giao mới có số (cọc, gia công, tạm ứng, khác ⇒ `(None, None)`). Giá trị đợt và phần cọc bù
        lấy từ `_no_tung_dot` — cùng nguồn với màn Công nợ, không tự tính lại."""
        did = getattr(row, "delivery_id", None)
        purchase = row.purchase_request
        if did is None or purchase is None:
            return None, None
        # `phan_bo_tien_dot` là hàm nền của `_no_tung_dot` — gọi thẳng cho nhẹ (khỏi dựng dòng hàng).
        dot = next((d for d in phan_bo_tien_dot(purchase)[0] if d["delivery"].id == did), None)
        if dot is None:
            return None, None
        truoc_do = self.repo.tong_chi_dot_truoc_phieu(did, row.id)
        phieu_nay = int(row.amount_vnd) if row.status == PAYMENT_VOUCHER_PAID else 0
        con_no_sau = max(0, int(dot["amount"]) - int(dot["coc_bu"]) - truoc_do - phieu_nay)
        return truoc_do, con_no_sau

    def _chan_ky_khoa(self, obj) -> None:
        """Chứng từ công nợ có ngày trong kỳ đã khoá thì không lập/sửa/huỷ (#46, 18/10/2026) —
        gọi ngay trước mỗi lần lưu phiếu chi, phiếu thu, hoá đơn bán, hoá đơn điều chỉnh."""
        db = self.repo.db
        ngay_hh: set = set()
        if isinstance(obj, PaymentReceipt):
            # Ngày cũ đọc TRƯỚC mọi thứ chạm DB (cùng mẹo `loi_ky_khoa`).
            with db.no_autoflush:
                ngay_hh = {obj.receipt_date}
                tt = sa_inspect(obj)
                if tt.persistent:
                    ngay_hh.update(tt.attrs["receipt_date"].history.deleted)
        loi = loi_ky_khoa(db, obj)
        if loi:
            raise AccountingValidationError(loi)
        if ngay_hh:
            # Hoa hồng gom phiếu thu theo ngày thu trong tháng kỳ lương: lập / sửa / huỷ phiếu thu
            # của đơn có sale vào tháng kỳ lương đã chốt là khoản rơi khỏi mọi kỳ (L-SX-48).
            # Phiếu thu hoá đơn không mang `order_id` (cố ý) ⇒ đơn lấy cả qua hoá đơn.
            with db.no_autoflush:
                don_ids = {obj.order_id} | {l.order_id for l in obj.lines}
                hd_ids = {obj.sales_invoice_id} | {l.sales_invoice_id for l in obj.lines}
            don_ids.discard(None)
            hd_ids.discard(None)
            if hd_ids:
                don_ids |= set(db.scalars(select(SalesInvoice.order_id).where(
                    SalesInvoice.id.in_(sorted(hd_ids)))))
            don_ids.discard(None)
            if don_ids and db.scalar(select(Order.id).where(
                    Order.id.in_(sorted(don_ids)), Order.sale_user_id.is_not(None)).limit(1)):
                loi = ly_do_ky_luong_da_khoa(db, *ngay_hh,
                                             viec="lập, sửa hay huỷ phiếu thu ảnh hưởng hoa hồng")
                if loi:
                    raise AccountingValidationError(loi)

    def create_voucher(self, *, actor, purchase_request_id: int | None = None,
                       salary_advance_id: int | None = None,
                       gia_cong_ngoai_id: int | None = None, **values):
        source_type = (values.get("source_type") or VOUCHER_SOURCE_PURCHASE).strip()
        advance = None
        gia_cong = None
        if source_type == VOUCHER_SOURCE_GIA_CONG or gia_cong_ngoai_id is not None:
            purchase = None
            gia_cong = self._gia_cong_cho_phieu_chi(gia_cong_ngoai_id)
            prepared = self._prepare_standalone_voucher(values, gia_cong=gia_cong)
        elif source_type == VOUCHER_SOURCE_SALARY_ADVANCE or salary_advance_id is not None:
            purchase = None
            advance = self._advance_cho_phieu_chi(salary_advance_id)
            prepared = self._prepare_standalone_voucher(values, advance=advance)
        elif source_type == VOUCHER_SOURCE_PURCHASE or purchase_request_id is not None:
            if purchase_request_id is None:
                raise AccountingValidationError("Phiếu chi từ Đơn mua hàng phải chọn Đơn mua hàng nguồn.")
            purchase = self._purchase(purchase_request_id)
            prepared = self._prepare_voucher(
                purchase, values, allow_pending_purchase=False, exclude_voucher_id=None
            )
        else:
            purchase = None
            prepared = self._prepare_standalone_voucher(values)
            if source_type == VOUCHER_SOURCE_CUSTOMER_REFUND:
                self._gan_khach_tra_lai(prepared, values)
        doc_no = self._next_voucher_doc_no()
        voucher = self._new_voucher(purchase, prepared, actor.id, doc_no=doc_no)
        self._chan_ky_khoa(voucher)
        saved = self.repo.save_voucher(voucher)
        if advance is not None:
            # Tiền ĐÃ RA két ⇒ phiếu tạm ứng sang ĐÃ CHI. Từ 07/09/2026 chỉ trạng thái này mới trừ vào
            # lương (chủ: "kế toán phải lập phiếu chi mới trừ"). `decided_at` để chốt lương (L12) biết
            # phiếu đổi trạng thái sau lần Tính lại.
            self._payroll.update_advance(advance, status=ADV_PAID, decided_at=_now(),
                                         payment_voucher_id=saved.id)
        self.audit.create(
            actor_user_id=actor.id,
            action="create_payment_voucher",
            target=f"payment_voucher:{saved.id}",
            detail=f"{saved.code} <- {purchase.code if purchase else prepared['source_type']}",
        )
        return self._voucher_out(saved)

    def ck_ke_cho_chi(self, *, customer_id: int | None = None) -> list[dict]:
        from .chi_ck_ke import ck_ke_cho_chi

        return ck_ke_cho_chi(self.repo, customer_id=customer_id)

    def create_voucher_ck_ke(self, *, actor, loai: str, dong: list[dict], shared: dict) -> dict:
        """MỘT phiếu chi trả chiết khấu HOẶC kê của nhiều hóa đơn CÙNG một khách (20/10/2026).

        Mỗi dòng `{sales_invoice_id, amount}`: 0 < amount ≤ phần còn phải chi của (hóa đơn, loại) ở
        hàng chờ. Chiết khấu trả đúng khách ⇒ người nhận khoá theo tên khách; kê thì người dùng gõ.
        Phiếu KHÔNG gắn đơn / khách ở đầu phiếu — hai cột đó nuôi quỹ cọc và sổ 131."""
        from .chi_ck_ke import TEN_LOAI, ck_ke_cho_chi

        if loai not in NGUON_CK_KE:
            raise AccountingValidationError("Loại khoản chi không hợp lệ.")
        if not dong:
            raise AccountingValidationError("Chưa chọn khoản nào để chi.")
        if len(dong) > 50:
            raise AccountingValidationError("Một phiếu chi tối đa 50 khoản.")
        if (shared.get("currency") or "VND") != "VND":
            raise AccountingValidationError("Phiếu chi chiết khấu / kê chỉ lập bằng VND.")
        ids = [int(d["sales_invoice_id"]) for d in dong]
        if len(set(ids)) != len(ids):
            raise AccountingValidationError("Có hóa đơn bị chọn trùng lặp hai lần.")
        hoa_don = {i: self.repo.get_sales_invoice(i) for i in ids}
        if any(v is None for v in hoa_don.values()):
            raise AccountingNotFound("Không tìm thấy hóa đơn bán.")
        khach = {v.customer_id for v in hoa_don.values()}
        if len(khach) != 1:
            raise AccountingValidationError("Các khoản phải cùng một khách mới chi chung một phiếu được.")
        cho = {
            r["sales_invoice_id"]: r
            for r in ck_ke_cho_chi(self.repo, order_ids=sorted({v.order_id for v in hoa_don.values()}))
            if r["loai"] == loai
        }
        tong = 0
        for d in dong:
            inv = hoa_don[int(d["sales_invoice_id"])]
            so = int(d.get("amount") or 0)
            if so <= 0:
                raise AccountingValidationError("Số tiền từng khoản phải lớn hơn 0.")
            con = cho.get(inv.id, {}).get("con", 0)
            if con <= 0:
                raise AccountingValidationError(
                    f"Hóa đơn {inv.invoice_number} không còn {TEN_LOAI[loai].lower()} chờ chi "
                    "(chưa thu đủ hoặc đã chi hết).")
            if so > con:
                raise AccountingValidationError(
                    f"Số chi vượt phần còn phải chi của hóa đơn {inv.invoice_number} ({so_vn(con)} đ).")
            tong += so
        dau = hoa_don[ids[0]]
        so_hd = [hoa_don[i].invoice_number for i in ids]
        values = {
            **shared,
            "source_type": NGUON_CK_KE[loai],
            "currency": "VND",
            "exchange_rate": 1,
            "amount": tong,
            "content": (shared.get("content") or "").strip()
                       or f"Chi {TEN_LOAI[loai].lower()} hóa đơn {', '.join(so_hd)}"[:500],
        }
        if loai == LOAI_CK:
            values["cash_recipient_name"] = dau.customer_name_snapshot
        prepared = self._prepare_standalone_voucher(values)
        prepared["source_code_snapshot"] = f"HĐ {', '.join(so_hd)}"[:32]
        prepared["customer_id"] = None
        voucher = self._new_voucher(None, prepared, actor.id, doc_no=self._next_voucher_doc_no())
        for d in dong:
            voucher.dong_ck_ke.append(PhieuChiCkKe(
                sales_invoice_id=int(d["sales_invoice_id"]), loai=loai, amount_vnd=int(d["amount"])))
        self._chan_ky_khoa(voucher)
        saved = self.repo.save_voucher(voucher)
        self.audit.create(
            actor_user_id=actor.id,
            action="create_payment_voucher",
            target=f"payment_voucher:{saved.id}",
            detail=f"{saved.code} <- {TEN_LOAI[loai]} {', '.join(so_hd)}: {so_vn(tong)}đ",
        )
        return self._voucher_out(saved)

    def create_voucher_gop(self, *, actor, lines: list[dict], shared: dict) -> dict:
        """MỘT phiếu chi trả NHIỀU khoản (cọc, đợt giao, nhiều đơn) của CÙNG một NCC (chủ chốt
        17/10/2026: "một phiếu cho cả lượt") — thay lượt "mỗi đợt một phiếu" cũ (04/09/2026).

        Mỗi dòng `{purchase_request_id, delivery_id|None, amount}` đi qua đúng đường kiểm của phiếu lẻ
        (`_prepare_voucher`: trạng thái đơn, đợt thuộc đơn, trần cọc / trần còn nợ của đợt, hình thức
        chi). Thẩm định MỌI dòng trước, ghi MỘT phiếu sau — dòng thứ 3 sai thì không gì được ghi.

        Một dòng ⇒ phiếu lẻ bình thường (đầu phiếu mang nguồn). Nhiều dòng ⇒ đầu phiếu để trống nguồn,
        tiền nằm ở `PaymentVoucherLine`; số phiếu = tổng các dòng."""
        if not lines:
            raise AccountingValidationError("Chưa chọn khoản nào để chi.")
        if len(lines) > 50:
            raise AccountingValidationError("Một phiếu chi gộp tối đa 50 khoản.")
        if (shared.get("currency") or "VND") != "VND":
            raise AccountingValidationError("Phiếu chi gộp chỉ lập bằng VND.")
        da_thay: set[tuple[int, int | None]] = set()
        chuan_bi: list[tuple[PurchaseRequest, dict]] = []
        ncc_id: int | None = None
        for it in lines:
            pr_id = int(it["purchase_request_id"])
            did = int(it["delivery_id"]) if it.get("delivery_id") is not None else None
            if (pr_id, did) in da_thay:
                raise AccountingValidationError("Có khoản bị chọn trùng lặp hai lần.")
            da_thay.add((pr_id, did))
            so = int(it.get("amount") or 0)
            if so <= 0:
                raise AccountingValidationError("Số tiền từng khoản phải lớn hơn 0.")
            purchase = self._purchase(pr_id)
            if ncc_id is None:
                ncc_id = purchase.supplier_id
            elif purchase.supplier_id != ncc_id:
                raise AccountingValidationError(
                    "Các khoản phải cùng một nhà cung cấp mới chi chung một phiếu được."
                )
            values = {
                **shared,
                "currency": "VND",
                "exchange_rate": 1,
                "payment_stage": PAYMENT_STAGE_ADVANCE if did is None else PAYMENT_STAGE_FINAL,
                "delivery_id": did,
                "amount": so,
                "content": shared.get("content") or "-",
            }
            prepared = self._prepare_voucher(
                purchase, values, allow_pending_purchase=False, exclude_voucher_id=None
            )
            chuan_bi.append((purchase, prepared))

        nhan = []
        for purchase, p in chuan_bi:
            seq = next((d.seq_no for d in purchase.deliveries if d.id == p["delivery_id"]), None)
            nhan.append(f"cọc {purchase.code}" if p["delivery_id"] is None else f"{purchase.code} đợt {seq}")
        noi_dung = (shared.get("content") or "").strip() or (
            "Thanh toán " + (nhan[0] if len(nhan) == 1 else f"{', '.join(nhan[:-1])} và {nhan[-1]}")
        )
        dau, p0 = chuan_bi[0]
        p0 = dict(p0)
        p0["content"] = noi_dung[:500]
        if len(chuan_bi) > 1:
            tong = sum(int(p["amount_vnd"]) for _, p in chuan_bi)
            p0.update(
                amount=tong, amount_vnd=tong, delivery_id=None,
                payment_stage=(
                    PAYMENT_STAGE_FINAL if any(p["delivery_id"] is not None for _, p in chuan_bi)
                    else PAYMENT_STAGE_ADVANCE
                ),
            )
        doc_no = self._next_voucher_doc_no()
        voucher = self._new_voucher(dau, p0, actor.id, doc_no=doc_no)
        if len(chuan_bi) > 1:
            voucher.purchase_request_id = None
            so_don = len({pu.id for pu, _ in chuan_bi})
            voucher.source_code_snapshot = (
                f"{dau.code} +{len(chuan_bi) - 1}" if so_don > 1 else dau.code
            )[:32]
            for purchase, p in chuan_bi:
                voucher.lines.append(PaymentVoucherLine(
                    purchase_request_id=purchase.id, delivery_id=p["delivery_id"],
                    amount_vnd=int(p["amount_vnd"]),
                ))
        self._chan_ky_khoa(voucher)
        saved = self.repo.save_voucher(voucher)
        self.audit.create(
            actor_user_id=actor.id,
            action="create_payment_voucher",
            target=f"payment_voucher:{saved.id}",
            detail=f"{saved.code} <- {', '.join(nhan)}",
        )
        return self._voucher_out(self._voucher(saved.id))

    # ĐÃ GỠ 04/08/2026: `approve_and_create_voucher()` — gộp duyệt PMH + lập phiếu chi vào một
    # thao tác. Tách vai: người đồng ý chi không được là người viết phiếu chi. Duyệt nay ở
    # `purchase_service.approve()` (có chốt chống tự duyệt), lập phiếu chi ở `create_voucher()`.

    # ĐÃ GỠ 07/08/2026: `update_voucher()` — sửa một phiếu chi đã lập.
    #
    # Chủ chốt: *"đã lập phiếu chứng từ rồi sao lại cho sửa nữa vậy, chỉ cho nó đính kèm tài liệu
    # lên thôi"*. Đúng nguyên tắc chứng từ: phiếu chi phát hành ra là TIỀN ĐÃ RỜI KÉT (Đ1), sửa nó
    # là làm cho tờ giấy đang nằm ở chỗ NCC khác với bản trong máy. Sai thì HUỶ (có lý do, giữ số
    # chứng từ) rồi lập phiếu mới — dấu vết còn đủ hai bản.
    #
    # Còn sửa được: ĐÍNH KÈM tài liệu (`add_voucher_attachment` / `delete_voucher_attachment`) —
    # hoá đơn, UNC ngân hàng thường về sau khi chi.

    # ĐÃ GỠ 06/08/2026: `mark_paid()` — nút "Xác nhận đã chi". Không còn nghĩa gì khi lập phiếu chi
    # ĐÃ LÀ hành vi chi tiền (Đ1). Giữ lại một nút hai bước chỉ tạo ra khoảng giữa mà bên nghiệp vụ
    # nói thẳng là không tồn tại: *"tạo phiếu chi là đã chi tiền rồi còn công nợ cái gì"*.

    def cancel_voucher(self, voucher_id: int, *, actor, reason: str):
        """Huỷ một phiếu chi — nay nghĩa là GHI NHẬN NHẦM, vì tiền đã ra lúc lập phiếu.

        Chặn khi đã có phiếu thu gắn vào: phiếu thu là tiền tiêu không hết nộp về, huỷ phiếu chi gốc
        sẽ để phiếu thu treo không có gốc và cộng ngược thành nợ ảo. Luật này vốn có từ trước, chỉ
        chuyển chỗ kiểm — trước đây `cancel` chỉ cho phiếu `waiting` nên phiếu có phiếu thu (buộc
        phải `paid`) tự nhiên không bao giờ huỷ được."""
        voucher = self._voucher(voucher_id)
        if voucher.status == PAYMENT_VOUCHER_CANCELLED:
            raise AccountingConflict("Chứng từ đã hủy rồi.")
        if voucher.receipts:
            raise AccountingConflict(
                "Chứng từ đã có phiếu thu gắn vào nên không hủy được — hủy phiếu thu trước."
            )
        cleaned_reason = _text(reason, label="Lý do hủy", required=True, max_length=2000)
        # Phiếu chi TỪ TẠM ỨNG (07/09/2026, bản rà B5): kỳ lương của phiếu đã chốt/đã chi thì khoản
        # ứng đã trừ vào lương — huỷ phiếu chi lúc này là thợ mất tiền. Kỳ còn nháp thì trả phiếu tạm
        # ứng về ĐÃ DUYỆT (chưa chi) để Tính lại thôi trừ.
        # Phiếu chi MỘT LƯỢT (25/09/2026): huỷ là CẢ LÔ về "đã duyệt — chờ chi" (chủ chốt — không gỡ lẻ
        # từng người khỏi phiếu chi; sai thì huỷ cả phiếu rồi lập lại cho những người đã nhận tiền).
        lo = self._lo_cua_phieu_chi(voucher)
        for y, m in sorted({(int(a.period_year), int(a.period_month)) for a in lo}):
            ky = self._payroll.get_period_by_ym(y, m)
            if ky is not None and ky.status in ("locked", "paid"):
                ten = (f"Phiếu tạm ứng {lo[0].code or lo[0].id}" if len(lo) == 1
                       else f"{len(lo)} phiếu tạm ứng của phiếu chi này")
                raise AccountingConflict(
                    f"{ten} đã trừ vào bảng lương {m:02d}/{y} (đã chốt) — mở lại kỳ "
                    "lương trước rồi mới huỷ phiếu chi.")
        voucher.status = PAYMENT_VOUCHER_CANCELLED
        voucher.cancel_reason = cleaned_reason
        voucher.cancelled_by_user_id = actor.id
        voucher.cancelled_at = _now()
        luc = _now()
        for a in lo:
            if a.status == ADV_PAID:
                a.status = ADV_APPROVED
                a.decided_at = luc
            if a.payment_voucher_id == voucher.id:
                a.payment_voucher_id = None
        self._chan_ky_khoa(voucher)
        saved = self.repo.save_voucher(voucher)   # một commit cho phiếu chi + cả lô
        self.audit.create(
            actor_user_id=actor.id,
            action="cancel_payment_voucher",
            target=f"payment_voucher:{saved.id}",
            detail=f"{saved.code}: {cleaned_reason}",
        )
        return self._voucher_out(saved)

    # --- receivables -------------------------------------------------------

    def _receivable_rows(self, *, customer_id: int | None = None) -> list[dict]:
        return receivable_rows(self.repo, customer_id=customer_id)

    def _sales_invoice_out(self, invoice: SalesInvoice, money_row: dict | None = None,
                           da_chi: dict[tuple[int, str], int] | None = None) -> dict:
        active = invoice.status == SALES_INVOICE_ISSUED
        if da_chi is None:
            da_chi = self.repo.da_chi_ck_ke([invoice.id])
        direct = money_row["direct_received_amount"] if money_row else 0
        deposit = money_row["deposit_offset_amount"] if money_row else 0
        received = money_row["received_amount"] if money_row else 0
        remaining = money_row["remaining_amount"] if money_row else 0
        return {
            "id": invoice.id,
            "order_id": invoice.order_id,
            "order_code": invoice.order.order_no,
            "customer_id": invoice.customer_id,
            "customer_name": invoice.customer_name_snapshot,
            "invoice_symbol": invoice.invoice_symbol,
            "invoice_number": invoice.invoice_number,
            "invoice_date": invoice.invoice_date,
            "amount_vnd": int(invoice.amount_vnd),
            "payment_term_days_snapshot": invoice.payment_term_days_snapshot,
            "due_date": invoice.due_date,
            "status": invoice.status,
            "direct_received_amount": direct if active else 0,
            "deposit_offset_amount": deposit if active else 0,
            "received_amount": received if active else 0,
            "remaining_amount": remaining if active else 0,
            "hoan_khong_don": (money_row or {}).get("hoan_khong_don", 0) if active else 0,
            "created_by_user_id": invoice.created_by_user_id,
            "created_by_name": self._user_name(invoice.created_by_user_id),
            "created_at": invoice.created_at,
            "cancelled_by_user_id": invoice.cancelled_by_user_id,
            "cancelled_by_name": self._user_name(invoice.cancelled_by_user_id),
            "cancelled_at": invoice.cancelled_at,
            "cancel_reason": invoice.cancel_reason,
            "delivery_trip_id": invoice.delivery_trip_id,
            # Chiết khấu / kê của hóa đơn (20/10/2026) — trước VAT, chi lại khách khi thu đủ.
            "chiet_khau": int(invoice.chiet_khau or 0),
            "ke_gia": int(invoice.ke_gia or 0),
            "ke_thue_tndn_pct": invoice.ke_thue_tndn_pct,
            "ke_thue_tndn": int(invoice.ke_thue_tndn or 0),
            "ck_da_chi": da_chi.get((invoice.id, LOAI_CK), 0),
            "ke_da_chi": da_chi.get((invoice.id, LOAI_KE), 0),
        }

    def _luot_giao_ghi_hoa_don(self, order) -> list[dict]:
        """Các lượt khách đã nhận của đơn kèm giá trị gồm VAT, phần đã ghi hóa đơn và phần còn ghi."""
        from ..repositories.delivery_repo import DeliveryRepository
        from .hoa_don_theo_giao import gia_tri_luot_giao

        trips = DeliveryRepository(self.repo.db).luot_khach_da_nhan_cua_don(order.id)
        da_ghi = self.repo.issued_invoice_amount_by_trip(order.id)
        ra = gia_tri_luot_giao(order, trips)
        for r in ra:
            r["da_ghi"] = min(da_ghi.get(r["trip_id"], 0), r["gia_tri"])
        # Phần dư không nằm gọn trong lượt của nó — hóa đơn cũ chưa gắn lượt (mg 0402), hoặc hóa
        # đơn ghi vượt hàng của lượt (trần chỉ còn tổng đơn) — dồn sang các lượt theo thứ tự giao.
        cu = max(0, self.repo.issued_invoice_amount_for_order(order.id) - sum(r["da_ghi"] for r in ra))
        for r in ra:
            don = min(cu, max(0, r["gia_tri"] - r["da_ghi"]))
            cu -= don
            r["da_ghi"] += don
            r["con_ghi"] = max(0, r["gia_tri"] - r["da_ghi"])
        return ra

    def list_order_sales_invoices(self, order_id: int) -> dict:
        order = self.repo.get_sales_order(order_id)
        if order is None:
            raise AccountingNotFound("Không tìm thấy đơn hàng bán.")
        invoices = self.repo.list_sales_invoices(order_id=order_id)
        # Cọc cấn FIFO trong TỪNG đơn ⇒ số của đơn này chỉ phụ thuộc hoá đơn của chính nó. Trước
        # 13/10/2026 nạp mọi hoá đơn của khách rồi lọc lại — mở ngăn đơn chậm dần theo lịch sử khách.
        money = {
            row["invoice_id"]: row
            for row in receivable_rows(
                self.repo, invoices=[i for i in invoices if i.status == SALES_INVOICE_ISSUED])
        }
        customer = self.repo.get_customer(order.customer_id) if order.customer_id else None
        order_total = _order_total_with_vat(order)
        invoiced = sum(
            int(row.amount_vnd)
            for row in invoices
            if row.status == SALES_INVOICE_ISSUED
        )
        luot = self._luot_giao_ghi_hoa_don(order)
        delivered = sum(r["gia_tri"] for r in luot)
        ma_luot = {r["trip_id"]: r["ma"] for r in luot}
        da_chi = self.repo.da_chi_ck_ke([row.id for row in invoices])
        from .ban_hang_cho_thu_chi import tien_cho_tra_lai
        cho_tra = next((r["con_lai"] for r in tien_cho_tra_lai(self.repo, [order.id])), 0)
        return {
            "order_id": order.id,
            "cho_tra_lai": cho_tra,
            "order_code": order.order_no,
            "order_total": order_total,
            "invoiced_amount": invoiced,
            "uninvoiced_amount": max(0, order_total - invoiced),
            # Hóa đơn chỉ ghi theo hàng khách đã nhận: trần là đã giao trừ đã ghi.
            "delivered_amount": delivered,
            "invoiceable_amount": max(0, delivered - invoiced),
            "luot_giao": luot,
            "deposit_received": self.repo.received_deposit_sum(order.id),
            # Hai trường dưới cho popup ghi nhận hoá đơn: hiện trước hạn trả và điền sẵn ký hiệu.
            "payment_term_days": customer.payment_term_days if customer else None,
            "last_invoice_symbol": self.repo.latest_sales_invoice_symbol(),
            # Từng phiếu thu thẳng vào hoá đơn của đơn — khối Hoá đơn ghi số phiếu ở dòng "Khách đã
            # trả" (13/10/2026). Cọc đã có ở `order.deposits`.
            "phieu_thu": [
                {"id": p.receipt_id, "code": p.code, "doc_no": p.doc_no, "invoice_id": p.sales_invoice_id,
                 "amount": int(p.amount_vnd), "receipt_date": p.receipt_date, "gop": p.gop}
                for p in self.repo.received_invoice_receipts(
                    [row.id for row in invoices if row.status == SALES_INVOICE_ISSUED])
            ],
            # Phiếu thu của hoá đơn ĐÃ HUỶ (17/10/2026): tiền về quỹ của đơn như cọc — khối Hoá đơn
            # ghi chúng cạnh phiếu cọc ở dòng trừ.
            "phieu_thu_hd_huy": [
                {"id": p.receipt_id, "code": p.code, "doc_no": p.doc_no, "invoice_id": p.sales_invoice_id,
                 "amount": int(p.amount_vnd), "receipt_date": p.receipt_date, "gop": p.gop}
                for p in self.repo.received_invoice_receipts(
                    [row.id for row in invoices if row.status != SALES_INVOICE_ISSUED])
            ],
            "items": [
                {**self._sales_invoice_out(row, money.get(row.id), da_chi),
                 "luot_giao_ma": ma_luot.get(row.delivery_trip_id)}
                for row in invoices
            ],
        }

    def create_sales_invoice(self, *, actor, **values) -> dict:
        order_id = int(values.get("order_id") or 0)
        order = self.repo.get_sales_order(order_id)
        if order is None:
            raise AccountingNotFound("Không tìm thấy đơn hàng bán.")
        if order.status != STATUS_ORDERED:
            raise AccountingConflict("Chỉ đơn hàng đã chốt mới được ghi nhận hóa đơn.")
        if order.customer_id is None:
            raise AccountingValidationError("Đơn hàng chưa có khách hàng để ghi nhận công nợ.")
        customer = self.repo.get_customer(order.customer_id)
        if customer is None:
            raise AccountingValidationError("Khách hàng của đơn không còn tồn tại.")
        invoice_date = values.get("invoice_date")
        if invoice_date is None:
            raise AccountingValidationError("Ngày hóa đơn không được để trống.")
        if invoice_date > _business_today():
            raise AccountingValidationError("Ngày hóa đơn không được ở tương lai.")
        # `ordered_at` lưu UTC: đơn chốt 06:36 sáng 18/10 giờ VN là 17/10 23:36 UTC, `.date()` thẳng
        # ra 17/10 và để hoá đơn ngày 17/10 lọt qua. Đổi sang ngày giờ xưởng trước khi so.
        if order.ordered_at is not None and invoice_date < _ngay_vn(order.ordered_at):
            raise AccountingValidationError("Ngày hóa đơn không được trước ngày chốt đơn.")
        invoice_number = _text(
            values.get("invoice_number"), label="Số hóa đơn", required=True, max_length=64
        )
        invoice_symbol = _text(
            values.get("invoice_symbol"), label="Ký hiệu hóa đơn", required=True, max_length=64
        )
        # Hóa đơn lập theo LƯỢT GIAO khách đã nhận, không vượt hàng của lượt đó (13/10/2026).
        trip_id = values.get("delivery_trip_id")
        if not trip_id:
            raise AccountingValidationError("Chọn lượt giao cần ghi hóa đơn.")
        luot = self._luot_giao_ghi_hoa_don(order)
        dong_luot = next((r for r in luot if r["trip_id"] == int(trip_id)), None)
        if dong_luot is None:
            raise AccountingValidationError(
                "Lượt giao này không thuộc đơn hoặc khách chưa nhận hàng — giao xong mới ghi hóa đơn."
            )
        already_invoiced = self.repo.issued_invoice_amount_for_order(order.id)
        # Trần DUY NHẤT là cả đơn: tổng hóa đơn không vượt tổng đơn gồm VAT (13/10/2026 — người dùng
        # bỏ trần từng lượt). Mặc định vẫn gợi phần chưa ghi của lượt.
        available = max(0, _order_total_with_vat(order) - already_invoiced)
        if available <= 0:
            raise AccountingValidationError("Đơn đã ghi hóa đơn đủ tổng giá trị đơn.")
        goi_y = min(dong_luot["con_ghi"], available) or available
        amount = int(values.get("amount_vnd") or goi_y)
        if amount > available:
            raise AccountingValidationError(
                f"Số tiền hóa đơn vượt phần đơn chưa ghi hóa đơn ({so_vn(available)} đ)."
            )
        term_days = customer.payment_term_days
        due_date = (
            invoice_date + timedelta(days=int(term_days))
            if term_days is not None
            else None
        )
        # Chiết khấu / kê đi theo hàng của lượt (20/10/2026); hóa đơn ghi đủ đơn nhận phần còn lại.
        from ..repositories.delivery_repo import DeliveryRepository
        from .chi_ck_ke import chia_ck_ke, thue_tndn

        tong_don = _order_total_with_vat(order)
        ck, ke = chia_ck_ke(
            order, DeliveryRepository(self.repo.db).luot_khach_da_nhan_cua_don(order.id),
            trip_id=int(trip_id), amount=amount, gia_tri_luot=dong_luot["gia_tri"], tong_don=tong_don,
            da_ghi=self.repo.ck_ke_da_ghi_cua_don(order.id),
            ghi_du=already_invoiced + amount >= tong_don,
        )
        ke_pct = float(customer.ke_thue_tndn_pct if customer.ke_thue_tndn_pct is not None else 20)
        invoice = SalesInvoice(
            order_id=order.id,
            customer_id=customer.id,
            invoice_symbol=invoice_symbol,
            invoice_number=invoice_number,
            invoice_date=invoice_date,
            amount_vnd=amount,
            payment_term_days_snapshot=term_days,
            due_date=due_date,
            customer_name_snapshot=customer.name,
            delivery_trip_id=int(trip_id),
            chiet_khau=ck,
            ke_gia=ke,
            ke_thue_tndn_pct=ke_pct if ke else None,
            ke_thue_tndn=thue_tndn(ke, ke_pct),
            status=SALES_INVOICE_ISSUED,
            created_by_user_id=actor.id,
        )
        try:
            self._chan_ky_khoa(invoice)
            saved = self.repo.save_sales_invoice(invoice)
        except IntegrityError as exc:
            raise AccountingConflict("Số và ký hiệu hóa đơn đã tồn tại.") from exc
        self.audit.create(
            actor_user_id=actor.id,
            action="create_sales_invoice",
            target=f"sales_invoice:{saved.id}",
            detail=f"{saved.invoice_number} <- {order.order_no} lượt {dong_luot['ma']}: {so_vn(amount)}đ",
        )
        money = next(
            (row for row in self._receivable_rows(customer_id=customer.id) if row["invoice_id"] == saved.id),
            None,
        )
        return self._sales_invoice_out(saved, money)

    def cancel_sales_invoice(self, invoice_id: int, *, actor, reason: str) -> dict:
        invoice = self.repo.get_sales_invoice(invoice_id)
        if invoice is None:
            raise AccountingNotFound("Không tìm thấy hóa đơn bán.")
        if invoice.status == SALES_INVOICE_CANCELLED:
            raise AccountingConflict("Hóa đơn đã hủy rồi.")
        # Khách đã trả vẫn hủy được (17/10/2026): phiếu thu giữ nguyên, tiền về quỹ của đơn
        # (`quy_tien_don`) để trừ vào hóa đơn ghi lại; đơn hết chỗ ghi thì thành việc trả lại khách.
        if any(self.repo.da_chi_ck_ke([invoice.id]).values()):
            raise AccountingConflict("Hóa đơn đã có phiếu chi chiết khấu/kê — huỷ phiếu chi trước.")
        cleaned = _text(reason, label="Lý do hủy", required=True, max_length=2000)
        invoice.status = SALES_INVOICE_CANCELLED
        invoice.cancel_reason = cleaned
        invoice.cancelled_by_user_id = actor.id
        invoice.cancelled_at = _now()
        self._chan_ky_khoa(invoice)
        saved = self.repo.save_sales_invoice(invoice)
        self.audit.create(
            actor_user_id=actor.id,
            action="cancel_sales_invoice",
            target=f"sales_invoice:{saved.id}",
            detail=f"{saved.invoice_number}: {cleaned}",
        )
        return self._sales_invoice_out(saved)

    def _receipts_for_receivable_rows(
        self, rows: list[dict], *, since: date | None = None, until: date | None = None
    ) -> list[dict]:
        invoice_ids = sorted({row["invoice_id"] for row in rows})
        order_ids = sorted({row["order_id"] for row in rows})
        receipts = self.repo.list_receipts_for_receivables(
            invoice_ids=invoice_ids, order_ids=order_ids, since=since
        )
        if until is not None:
            receipts = [r for r in receipts if r.receipt_date <= until]
        # Tên người lập: một lượt cho mọi phiếu (trước 26/10/2026 mỗi phiếu một SELECT users).
        self._nap_ten_nguoi(r.created_by_user_id for r in receipts)
        return [
            {
                "receipt_id": row.receipt_id,
                "code": row.code,
                "doc_no": row.doc_no,
                "order_id": row.order_id,
                "order_code": row.order_no_snapshot,
                "source_type": RECEIPT_SOURCE_ORDER if row.la_coc else RECEIPT_SOURCE_SALES_INVOICE,
                "sales_invoice_id": row.sales_invoice_id,
                "sales_invoice_number": (
                    row.sales_invoice.invoice_number if row.sales_invoice else None
                ),
                "applied_to": "deposit_offset" if row.la_coc else "sales_invoice",
                "receipt_method": row.receipt_method,
                "amount": int(row.amount_vnd),
                # Phiếu gộp: `amount` là phần của dòng này, `receipt_amount` là cả phiếu.
                "receipt_amount": int(row.receipt.amount_vnd),
                "so_dong": len(row.receipt.lines),
                "receipt_date": row.receipt_date,
                "payer_name": row.payer_name,
                "bank_reference": row.bank_reference,
                "created_by_name": self._user_name(row.created_by_user_id),
            }
            for row in receipts
        ]

    def receivables_summary(
        self,
        *,
        q: str | None = None,
        filter_: str = "all",
        aging_bucket: str | None = None,
        page: int = 1,
        size: int = 20,
        tu_ngay: date | None = None,
        den_ngay: date | None = None,
        no_tu: int | None = None,
        no_den: int | None = None,
        han_tra: str | None = None,
        han_muc: str | None = None,
        ca_da_tra_het: bool = False,
        phu_trach_id: int | None = None,
        nhan: str | None = None,
        dem_only: bool = False,
        chi_tong: bool = False,
        sap_xep: str | None = None,
        chieu: str | None = None,
    ) -> dict:
        """Công nợ phải thu gom theo khách hàng.

        PHÂN TUỔI NỢ thêm 29/08/2026 — trước đó chỉ có MỘT ô "Quá hạn" gộp tất, nên khoản trễ 3
        ngày và khoản trễ 90 ngày nằm chung, nhìn vào không biết đòi cái nào trước. Dùng lại y
        nguyên bộ rổ của phải trả (`AGING_BUCKETS` · `ro_tuoi`): hai màn cùng mốc thì một khoản
        không thể hiện hai mức khẩn khác nhau ở hai chỗ.

        Hoá đơn KHÔNG CÓ HẠN (khách chưa khai `payment_term_days` ⇒ `due_date` NULL) nằm ở rổ
        "Chưa tới hạn", đúng y bên phải trả và đúng y nhánh `no_han_amount` vẫn chạy — thêm rổ
        chứ KHÔNG đổi chỗ của khoản nào (chủ chốt 29/08/2026: *"chưa tới hạn như phải trả"*).

        `aging_bucket` lọc trên danh sách ĐÃ dựng, sau khi thẻ tổng đã chốt — bấm một rổ không
        làm mấy con số tổng ở đầu màn nhảy theo. Cùng đường với `filter_`.

        THEO KỲ (05/10/2026): cùng khuôn với `payables_summary` — `received_in_period` = phiếu thu
        có ngày thu trong kỳ (cách ảnh chụp), `ban_trong_ky` = hoá đơn trong kỳ của sổ 131 (`ban_ky`). Còn nợ / quá hạn /
        tuổi nợ: kỳ kết thúc hôm nay ⇒ ảnh chụp như cũ; kỳ đã qua ⇒ dư cuối kỳ + tuổi nợ tại
        `den_ngay` của sổ (`bao_cao_cong_no.tong_hop_phai_thu`), kẹp ≥ 0. `phu_trach_id` (sale phụ
        trách) và `nhan` (nhãn khách) chọn DÒNG.

        `chi_tong` (06/10/2026) = chỉ các số TỔNG (lời "cùng kỳ" của màn): bỏ `han_gan_nhat`, bộ
        lọc, đếm nhóm nút, cắt trang; trả `items=[]`, `total=0`, `the_loc` mặc định. Các số tổng
        tính CÙNG đoạn mã với lời thường nên bằng đúng.

        BẢNG ĐỦ CỘT (06/10/2026): mỗi dòng mang thêm lần THU GẦN NHẤT (cả lịch sử, một truy vấn cột
        thô cho mọi khách — cần cho sắp xếp) và mã + liên hệ chính + tên sale phụ trách (chỉ nạp cho
        các dòng CỦA TRANG, sau khi cắt). `sap_xep` + `chieu`: `_sap_xep_cong_no`.
        """
        hom_nay = _business_today()
        co_ky = tu_ngay is not None and den_ngay is not None
        moc_ky = tu_ngay if co_ky else hom_nay - timedelta(days=31 * PAYABLES_PERIOD_MONTHS)
        # `den_ngay` ở tương lai ⇒ chặn về hôm nay (xem `payables_summary`).
        cuoi_ky = min(den_ngay, hom_nay) if co_ky else hom_nay
        # Kỳ kết thúc hôm nay ⇒ còn nợ theo ẢNH CHỤP từng hoá đơn, THEO ĐƠN (17/10/2026, bỏ cân theo
        # dư 131 của 12/10): tiền đang để ở đơn khác không trừ vào hoá đơn đơn này; tiền trả lại không
        # gắn đơn cộng nợ lại (`receivable_rows`). Kỳ đã qua dùng tuổi nợ của sổ — cùng luật.
        so_chup = cuoi_ky >= hom_nay
        tim = (q or "").strip().lower()
        # Hoá đơn đã phát hành nạp MỘT lần: dựng dòng ảnh chụp (bên dưới) và sổ 131 (khối `if co_ky`)
        # dùng chung.
        hoa_don_ds = self.repo.list_sales_invoices(status=SALES_INVOICE_ISSUED)
        rows = receivable_rows(self.repo, invoices=hoa_don_ds)
        thu_theo_khach: dict[int | None, int] = {}
        receipts = self._receipts_for_receivable_rows(
            rows, since=moc_ky, until=cuoi_ky if co_ky else None
        )
        order_to_customer = {r["order_id"]: r["customer_id"] for r in rows}
        invoice_to_customer = {r["invoice_id"]: r["customer_id"] for r in rows}
        for receipt in receipts:
            cid = (
                invoice_to_customer.get(receipt["sales_invoice_id"])
                if receipt["sales_invoice_id"] is not None
                else order_to_customer.get(receipt["order_id"])
            )
            thu_theo_khach[cid] = thu_theo_khach.get(cid, 0) + receipt["amount"]

        def _muc_moi(cid, ten, credit_limit, payment_term_days, sale_user_id) -> dict:
            return {
                "customer_id": cid,
                "customer_name": ten,
                "invoice_count": 0,
                "invoiced_amount": 0,
                "received_amount": 0,
                "total_due": 0,
                "overdue_amount": 0,
                "no_han_amount": 0,
                # Khách không nợ gì vẫn có đủ 6 rổ = 0, không phải `{}` — thiếu khoá là giao
                # diện đọc ra `undefined` rồi in "NaN đ".
                "aging": _aging_rong(),
                "credit_limit": credit_limit,
                "payment_term_days": payment_term_days,
                "sale_user_id": sale_user_id,
                "received_in_period": 0,
                "ban_trong_ky": 0,
                "han_gan_nhat": None,
                "customer_code": None,
                "lien_he_ten": None,
                "lien_he_sdt": None,
                "sale_user_name": None,
                "thu_gan_nhat_ngay": None,
                "thu_gan_nhat_tien": 0,
                "cho_tra_lai": 0,
                "tien_dang_de": 0,
            }

        theo_khach: dict[int | None, dict] = {}
        for row in rows:
            cid = row["customer_id"]
            if cid not in theo_khach:
                theo_khach[cid] = _muc_moi(
                    cid, row["customer_name"], row["credit_limit"],
                    row["payment_term_days"], row["sale_user_id"],
                )
            bucket = theo_khach[cid]
            bucket["invoiced_amount"] += row["amount"]
            bucket["received_amount"] += row["received_amount"]
            con_no = row["remaining_amount"]
            if con_no <= 0:
                continue
            bucket["invoice_count"] += 1
            han = row["due_date"]
            # `han_gan_nhat` chỉ phục vụ DÒNG — lời `chi_tong` bỏ qua.
            if (
                not chi_tong and han is not None
                and (bucket["han_gan_nhat"] is None or han < bucket["han_gan_nhat"])
            ):
                bucket["han_gan_nhat"] = han
            bucket["total_due"] += con_no
            # Tính MỘT lần rồi dùng cho cả hai: `overdue/no_han` và RỔ TUỔI phải luôn khớp
            # nhau. Tách ra so hạn hai lần là mở đúng cửa cho chúng lệch.
            so_ngay_tre = (
                (hom_nay - row["due_date"]).days
                if row["due_date"] is not None and row["due_date"] < hom_nay
                else 0
            )
            if so_ngay_tre > 0:
                bucket["overdue_amount"] += con_no
            else:
                # Gồm cả hoá đơn CHƯA TỚI HẠN lẫn hoá đơn KHÔNG CÓ HẠN (khách chưa khai số ngày
                # thanh toán). `ro_tuoi(0)` trả đúng khoá "chưa tới hạn" nên hai nhánh này rơi
                # cùng một rổ — giữ nguyên hành vi cũ của `no_han_amount`.
                bucket["no_han_amount"] += con_no
            khoa = ro_tuoi(so_ngay_tre)
            bucket["aging"][khoa]["amount"] += con_no
            bucket["aging"][khoa]["count"] += 1

        for cid, amount in thu_theo_khach.items():
            if cid in theo_khach:
                theo_khach[cid]["received_in_period"] += amount

        if not chi_tong:
            # Tiền khách đang để ở các đơn (17/10/2026): công nợ đi theo đơn nên tiền này không trừ
            # vào hoá đơn đơn khác — hiện riêng. Khách còn tiền PHẢI TRẢ LẠI (đơn huỷ / ghi đủ mà vẫn
            # dư) mà không có hoá đơn vẫn lên danh sách để kế toán lập phiếu chi. Không đụng số nợ.
            from .ban_hang_cho_thu_chi import tien_dang_de

            de: dict[int, list[int]] = {}
            for d in tien_dang_de(self.repo):
                o = de.setdefault(d["customer_id"], [0, 0])
                o[0] += d["dang_de"]
                o[1] += d["con_lai"]
            thieu = {cid for cid, (_, tra) in de.items() if tra > 0} - set(theo_khach)
            for cid, kh in self.repo.customers_by_ids(thieu).items():
                theo_khach[cid] = _muc_moi(
                    cid, kh.name, int(kh.credit_limit or 0), kh.payment_term_days, kh.sale_user_id
                )
            for cid, (dang, tra) in de.items():
                if cid in theo_khach:
                    theo_khach[cid]["tien_dang_de"] = dang
                    theo_khach[cid]["cho_tra_lai"] = tra

            # Lần thu gần nhất (cả lịch sử): hàng đầu tiên gặp của mỗi khách là mới nhất.
            for hd_id, don_id, ngay_thu, _, tien_thu in self.repo.lan_thu_cuoi_cong_no(
                invoice_ids=sorted(invoice_to_customer), order_ids=sorted(order_to_customer)
            ):
                cid = invoice_to_customer.get(hd_id) if hd_id is not None else order_to_customer.get(don_id)
                muc = theo_khach.get(cid)
                if muc is not None and muc["thu_gan_nhat_ngay"] is None:
                    muc["thu_gan_nhat_ngay"] = ngay_thu
                    muc["thu_gan_nhat_tien"] = int(tien_thu)

        if co_ky:
            # Kỳ kết thúc hôm nay thì rổ tuổi của sổ không được đọc (xem `payables_summary`).
            bc = bao_cao_cong_no.tong_hop_phai_thu(
                self.repo, tu_ngay=tu_ngay, den_ngay=cuoi_ky,
                hoa_don_da_nap=hoa_don_ds, tinh_tuoi=not so_chup,
            )
            theo_bc = {it["doi_tuong_id"]: it for it in bc["items"] if it["doi_tuong_id"] is not None}
            # Không dựng dòng cho khách CHỈ có trong sổ: không có hoá đơn đang phát hành thì PS Nợ
            # = 0 và dư cuối kỳ ≤ 0 (chỉ phiếu thu/cọc) ⇒ sau khi kẹp vẫn không có số nào để hiện.
            # Hoá đơn không gắn khách (cid None): `theo_bc` đã bỏ dòng "không gắn" ⇒ về 0.
            for cid, muc in theo_khach.items():
                it = theo_bc.get(cid)
                # Chỉ hoá đơn — PS Nợ của sổ còn gồm phiếu hoàn tiền khách (không phải bán).
                muc["ban_trong_ky"] = it["ban_ky"] if it else 0
                if not so_chup:
                    _ap_du_cuoi_ky_qua_khu(muc, it, phai_tra=False)

        def _co_so(i) -> bool:
            return (
                i["total_due"] > 0 or i["received_in_period"] > 0 or i["ban_trong_ky"] > 0
                or i["cho_tra_lai"] > 0
            )

        items = []
        for item in theo_khach.values():
            khop_tim = bool(tim) and tim in (item["customer_name"] or "").lower()
            if not _co_so(item) and not khop_tim:
                continue
            item["vuot_han_muc"] = item["credit_limit"] > 0 and item["total_due"] > item["credit_limit"]
            item["vuot_bao_nhieu"] = (
                max(0, item["total_due"] - item["credit_limit"]) if item["credit_limit"] > 0 else 0
            )
            items.append(item)
        items.sort(key=lambda x: (x["total_due"], x["received_in_period"]), reverse=True)
        tong_hop = [i for i in items if _co_so(i)]
        tong_ro = _aging_rong()
        for i in tong_hop:
            _aging_cong(tong_ro, i["aging"])
        # Mọi số TỔNG của câu trả lời, một chỗ: lời thường và lời `chi_tong` cùng đọc từ đây.
        tong_so = {
            "total_due": sum(i["total_due"] for i in tong_hop),
            "overdue_amount": sum(i["overdue_amount"] for i in tong_hop),
            "received_in_period": sum(i["received_in_period"] for i in tong_hop),
            "ban_trong_ky": sum(i["ban_trong_ky"] for i in tong_hop),
            "vuot_han_muc_count": sum(1 for i in tong_hop if i["vuot_han_muc"]),
            "aging": _aging_ra_danh_sach(tong_ro),
            "period_months": PAYABLES_PERIOD_MONTHS,
            "tu_ngay": moc_ky,
            "den_ngay": cuoi_ky,
            "as_of": hom_nay,
        }
        if chi_tong:
            return {"items": [], "total": 0, "page": 1, "size": 1, "pages": 1, **tong_so}
        if tim:
            items = [i for i in items if tim in (i["customer_name"] or "").lower()]
        elif co_ky and not ca_da_tra_het:
            # Có kỳ: khách đã thu hết (còn nợ = 0) ẩn khỏi danh sách, vẫn cộng vào tổng — trừ khách
            # còn tiền phải trả lại (việc còn phải làm).
            items = [i for i in items if i["total_due"] > 0 or i["cho_tra_lai"] > 0]
        items = _loc_nang_cao(
            items, no_tu=no_tu, no_den=no_den, han_tra=han_tra, han_muc=han_muc, moc=cuoi_ky
        )
        if phu_trach_id is not None:
            items = [i for i in items if i["sale_user_id"] == phu_trach_id]
        if (nhan or "").strip():
            co_nhan = self.repo.customer_ids_co_nhan(nhan)
            items = [i for i in items if i["customer_id"] in co_nhan]
        if aging_bucket in AGING_KEYS:
            items = [i for i in items if i["aging"][aging_bucket]["amount"] > 0]
        # Số trên nhóm nút: đếm TRƯỚC `filter_` — cùng luật với phải trả.
        the_loc = _the_loc_cong_no(items)
        the_loc["tra_coc"] = sum(1 for i in items if i["cho_tra_lai"] > 0)
        items = _loc_the_cong_no(items, filter_)
        items = _sap_xep_cong_no(
            items, sap_xep, chieu, khoa_gan_nhat="thu_gan_nhat_ngay", khoa_ky="received_in_period"
        )
        # Dòng Cộng của bảng (xem `payables_summary`): số khoản = Σ số khoản các rổ tuổi của từng
        # dòng, KHÔNG phải `invoice_count`. Kỳ đã qua ghi đè `aging` bằng số của sổ 131 mà không đụng
        # `invoice_count` (số hoá đơn còn nợ hôm nay) — đếm bằng `invoice_count` thì dòng Cộng lệch
        # cột từng dòng. Ở ảnh chụp hai số bằng nhau.
        tong_loc = None if dem_only else _tong_loc_cong_no(
            items,
            so_khoan=lambda m: sum(r["count"] for r in m["aging"].values()),
            khoa_ky_1="ban_trong_ky", khoa_ky_2="received_in_period",
        )

        page = max(1, page)
        size = max(1, min(size, 200))
        total = len(items)
        pages = max(1, (total + size - 1) // size)
        page = min(page, pages)
        bat_dau = (page - 1) * size
        trang = [] if dem_only else items[bat_dau:bat_dau + size]
        self._dien_lien_he_khach(trang)
        return {
            "items": trang,
            "total": total,
            "page": page,
            "size": size,
            "pages": pages,
            "the_loc": the_loc,
            "tong_loc": tong_loc,
            **tong_so,
        }

    def _dien_lien_he_khach(self, trang: list[dict]) -> None:
        """Mã khách, liên hệ chính, tên sale phụ trách — chỉ cho các dòng CỦA TRANG (tối đa ba truy
        vấn). Không có liên hệ chính thì lùi về ô liên hệ nhanh của khách (`contact_name` / `phone`)."""
        ids = {m["customer_id"] for m in trang if m["customer_id"] is not None}
        if not ids:
            return
        khach = self.repo.customers_by_ids(ids)
        chinh = self.repo.lien_he_chinh_theo_khach(ids)
        # Tên sale cả trang một lượt — trước 26/10/2026 mỗi sale một SELECT users.
        self._nap_ten_nguoi(m["sale_user_id"] for m in trang)
        ten_sale: dict[int, str | None] = {}
        for m in trang:
            kh = khach.get(m["customer_id"])
            if kh is None:
                continue
            m["customer_code"] = kh.code
            m["lien_he_ten"], m["lien_he_sdt"] = chinh.get(kh.id, (kh.contact_name, kh.phone))
            sid = m["sale_user_id"]
            if sid is not None:
                if sid not in ten_sale:
                    ten_sale[sid] = self._user_name(sid)
                m["sale_user_name"] = ten_sale[sid]

    def receivables_detail(
        self,
        customer_id: int,
        *,
        all_history: bool = False,
        tu_ngay: date | None = None,
        den_ngay: date | None = None,
        paid_page: int = 1,
        paid_size: int | None = None,
    ) -> dict:
        """Chi tiết công nợ một khách. `tu_ngay` + `den_ngay` chỉ đổi tab Đã thu (phiếu thu trong
        kỳ); các hoá đơn còn nợ vẫn là của hôm nay. `all_history` thắng kỳ.

        `paid_size` (06/10/2026, cùng khuôn `payables_detail`): rổ "đã thu" chỉ trả MỘT TRANG
        (`paid_page`, mới nhất trước) — nút "Xem thêm" của ngăn gọi trang tiếp. `paid_total` /
        `received_in_period` vẫn là của CẢ phạm vi. Không truyền `paid_size` = trả trọn như cũ."""
        hom_nay = _business_today()
        co_ky = tu_ngay is not None and den_ngay is not None and not all_history
        moc_ky = (
            date.min if all_history
            else tu_ngay if co_ky
            else hom_nay - timedelta(days=31 * PAYABLES_PERIOD_MONTHS)
        )
        customer = self.repo.get_customer(customer_id)
        if customer is None:
            raise AccountingNotFound("Không tìm thấy khách hàng.")
        rows = self._receivable_rows(customer_id=customer_id)
        items = []
        for row in rows:
            con_no = row["remaining_amount"]
            if con_no <= 0:
                continue
            items.append(
                {
                    "invoice_id": row["invoice_id"],
                    "invoice_symbol": row["invoice_symbol"],
                    "invoice_number": row["invoice_number"],
                    "invoice_date": row["invoice_date"],
                    "order_id": row["order_id"],
                    "order_code": row["order_code"],
                    "customer_id": row["customer_id"],
                    "customer_name": row["customer_name"],
                    "due_date": row["due_date"],
                    "chua_dat_han": row["due_date"] is None,
                    "overdue_days": (
                        (hom_nay - row["due_date"]).days
                        if row["due_date"] is not None and row["due_date"] < hom_nay
                        else 0
                    ),
                    # KHOÁ RỔ TUỔI của chính hoá đơn này — chụp bằng đúng `ro_tuoi()` server
                    # dùng cho dải tổng, để một hoá đơn KHÔNG BAO GIỜ hiện hai mức khẩn khác nhau
                    # ở hai màn. Chỉ có giá trị khi thật sự trễ; chưa trễ thì None.
                    "aging_bucket": None,
                    "amount": row["amount"],
                    "direct_received_amount": row["direct_received_amount"],
                    "deposit_offset_amount": row["deposit_offset_amount"],
                    "received_amount": row["received_amount"],
                    "remaining_amount": con_no,
                    "hoan_khong_don": row.get("hoan_khong_don", 0),
                }
            )
        ro_chi_tiet = _aging_rong()
        for it in items:
            khoa = ro_tuoi(it["overdue_days"])
            it["aging_bucket"] = khoa if it["overdue_days"] > 0 else None
            ro_chi_tiet[khoa]["amount"] += it["remaining_amount"]
            ro_chi_tiet[khoa]["count"] += 1
        items.sort(key=lambda x: (x["due_date"] is not None, x["due_date"] or hom_nay))
        paid = self._receipts_for_receivable_rows(
            rows, since=moc_ky, until=den_ngay if co_ky else None
        )
        tong_da_thu = sum(p["amount"] for p in paid)
        so_lan_thu = len(paid)
        if paid_size is not None:
            paid_size = max(1, min(paid_size, 200))
            bat_dau = (max(1, paid_page) - 1) * paid_size
            paid = paid[bat_dau:bat_dau + paid_size]
        total_due = sum(i["remaining_amount"] for i in items)
        overdue_amount = sum(i["remaining_amount"] for i in items if i["overdue_days"] > 0)
        credit_limit = int(customer.credit_limit or 0)
        # Liên hệ chính + sale phụ trách: đi ĐÚNG đường của dòng danh sách (`_dien_lien_he_khach`).
        thong_tin = {"customer_id": customer.id, "sale_user_id": customer.sale_user_id}
        self._dien_lien_he_khach([thong_tin])
        return {
            "customer_id": customer.id,
            "customer_name": customer.name,
            "credit_limit": credit_limit,
            "payment_term_days": customer.payment_term_days,
            "vuot_han_muc": credit_limit > 0 and total_due > credit_limit,
            "vuot_bao_nhieu": max(0, total_due - credit_limit) if credit_limit > 0 else 0,
            "lien_he_ten": thong_tin.get("lien_he_ten"),
            "lien_he_sdt": thong_tin.get("lien_he_sdt"),
            "phu_trach": thong_tin.get("sale_user_name"),
            "items": items,
            "paid": paid,
            "paid_total": so_lan_thu,
            "period_months": PAYABLES_PERIOD_MONTHS,
            "all_history": all_history,
            "total_due": total_due,
            "overdue_amount": overdue_amount,
            "aging": _aging_ra_danh_sach(ro_chi_tiet),
            "received_in_period": tong_da_thu,
            "as_of": hom_nay,
            "tien_dang_de": _tien_dang_de(self.repo, customer_id),
        }

    # --- payment receipts ---------------------------------------------------

    def list_receipts(
        self,
        *,
        q: str | None = None,
        status: str | None = None,
        payment_voucher_id: int | None = None,
        source_type: str | None = None,
        tu_ngay: date | None = None,
        den_ngay: date | None = None,
        tien_tu: int | None = None,
        tien_den: int | None = None,
        hinh_thuc: str | None = None,
        nguon: list[str] | None = None,
        muc: list[int] | None = None,
        tai_khoan_id: int | None = None,
        nguoi_lap_id: int | None = None,
        nhan: str | None = None,
        moc: str = "thu",
        dem_only: bool = False,
        sort: str = "-created_at",
        page: int = 1,
        size: int = 20,
    ) -> tuple[list[dict], int, dict]:
        # Màn Phiếu thu kế toán là một sổ chung: thu hoàn phiếu chi, thu cọc đơn bán, và thu khác.
        # Truyền source_type khi cần lọc riêng từng nguồn; None = xem toàn bộ sổ.
        # `extra` = tổng đã thu + số trên hàng thẻ lọc (rỗng khi `dem_only`).
        rows, total, extra = self.repo.list_receipts(
            q=q,
            status=status,
            payment_voucher_id=payment_voucher_id,
            source_type=source_type,
            tu_ngay=tu_ngay,
            den_ngay=den_ngay,
            tien_tu=tien_tu,
            tien_den=tien_den,
            hinh_thuc=hinh_thuc,
            nguon=nguon,
            muc=muc,
            tai_khoan_id=tai_khoan_id,
            nguoi_lap_id=nguoi_lap_id,
            nhan=nhan,
            moc=moc,
            dem_only=dem_only,
            sort=sort,
            page=page,
            size=size,
        )
        self._nap_ten_nguoi(
            [u for r in rows for u in (r.created_by_user_id, r.received_by_user_id, r.cancelled_by_user_id)]
        )
        return [self._receipt_out(row) for row in rows], total, extra

    def get_receipt(self, receipt_id: int) -> dict:
        row = self._receipt(receipt_id)
        out = self._receipt_out(row)
        if len(row.lines) > 1:
            out["truoc_do"], out["con_no_sau"] = None, None
            out["doi_chieu"] = [
                {"order_code": l.order_no_snapshot,
                 "invoice_number": l.sales_invoice.invoice_number if l.sales_invoice else None,
                 "truoc_do": td, "con_no_sau": cn}
                for l in row.lines
                if l.sales_invoice_id is not None
                for td, cn in [self._doi_chieu_dong_thu(row, l.sales_invoice, int(l.amount_vnd))]
                if td is not None
            ]
        else:
            dong = row.lines[0] if row.lines else None
            out["truoc_do"], out["con_no_sau"] = self._doi_chieu_dong_thu(
                row, dong.sales_invoice if dong else row.sales_invoice,
                int(dong.amount_vnd) if dong else int(row.amount_vnd),
            )
            out["doi_chieu"] = []
        return out

    def _doi_chieu_dong_thu(
        self, row: PaymentReceipt, invoice, tien_dong: int
    ) -> tuple[int | None, int | None]:
        """Số đã thu TRƯỚC phiếu thu này và số hoá đơn còn nợ SAU phiếu này, cho MỘT hoá đơn mà
        phiếu trả (`tien_dong` = phần của phiếu cho hoá đơn đó). `received_amount` của hoá đơn tính
        cả phiếu lập sau nên không dùng được. Phần cọc cấn vào hoá đơn và tiền trả lại khách ngoài đơn
        cộng nợ lại vào hoá đơn (phần gộp, `_phan_bo_hoan`) — cùng luật với hàng chờ thu và màn Công nợ
        phải thu (18/10/2026: thiếu khoản trả lại thì ngăn phiếu ghi còn nợ thấp hơn hàng chờ)."""
        if invoice is None:
            return None, None
        iid = invoice.id
        if invoice.status != SALES_INVOICE_ISSUED:
            # Hoá đơn đã huỷ không còn sinh nợ ⇒ không có "còn nợ sau phiếu này" để đối chiếu.
            return None, None
        # Cọc cấn FIFO theo ĐƠN (`receivable_rows` gom theo `order_id`) ⇒ chỉ nạp hoá đơn của đúng
        # đơn này: cùng số trừ cọc mà không quét cả khách (hoá đơn không gắn khách thì quét cả hệ thống).
        hoa_don_don = self.repo.list_sales_invoices(
            order_id=invoice.order_id, status=SALES_INVOICE_ISSUED
        )
        money = next(
            (m for m in receivable_rows(self.repo, invoices=hoa_don_don, hoan=False)
             if m["invoice_id"] == iid),
            None,
        )
        coc_can = int(money["deposit_offset_amount"]) if money else 0
        hoan = (_phan_bo_hoan(self.repo, {invoice.customer_id}, tru_thua=False).get(iid, 0)
                if invoice.customer_id is not None else 0)
        truoc_do = self.repo.tong_thu_hoa_don_truoc_phieu(iid, row.id)
        phieu_nay = tien_dong if row.status == PAYMENT_RECEIPT_RECEIVED else 0
        con_no_sau = max(0, int(invoice.amount_vnd) + hoan - coc_can - truoc_do - phieu_nay)
        return truoc_do, con_no_sau

    def create_other_receipt(self, *, actor, **values):
        return self._tao_phieu_thu_rieng(actor=actor, values=values, nguon=RECEIPT_SOURCE_OTHER,
                                         hanh_dong="create_other_payment_receipt")

    def create_supplier_refund_receipt(self, supplier_id: int, *, actor, **values):
        """Phiếu thu NHÀ CUNG CẤP HOÀN TIỀN (12/10/2026) — lập từ ngăn Công nợ phải trả, gắn thẳng
        NCC, không cần phiếu chi gốc. Thuộc mục cố định "Nhà cung cấp hoàn tiền"; tiền vào Công nợ
        phải trả của NCC đó. Không chặn số: màn hình điền sẵn số NCC đang nợ lại mình và chỉ nhắc
        khi vượt."""
        ncc = self.repo.get_supplier(supplier_id)
        if ncc is None:
            raise AccountingNotFound("Không tìm thấy nhà cung cấp.")
        return self._tao_phieu_thu_rieng(
            actor=actor, values=values, nguon=RECEIPT_SOURCE_PURCHASE,
            hanh_dong="create_supplier_refund_receipt",
            them={"supplier_id": ncc.id, "supplier_name_snapshot": ncc.name},
        )

    def _tao_phieu_thu_rieng(self, *, actor, values: dict, nguon: str, hanh_dong: str,
                             them: dict | None = None):
        prepared = self._prepare_other_receipt(values)
        doc_no = self.sequences.generate_flat_code(SEQ_DOC_TYPE_PAYMENT_RECEIPT)
        account = prepared.pop("company_account")
        receipt = PaymentReceipt(
            code=self._new_receipt_code(),
            doc_no=doc_no,
            source_type=nguon,
            status=PAYMENT_RECEIPT_RECEIVED,
            created_by_user_id=actor.id,
            received_by_user_id=actor.id,
            received_at=_now(),
        )
        for key, value in (them or {}).items():
            setattr(receipt, key, value)
        for key, value in prepared.items():
            setattr(receipt, key, value)
        receipt.company_bank_account_id = account.id if account else None
        receipt.company_account_holder_snapshot = account.account_holder if account else None
        receipt.company_account_number_snapshot = account.account_number if account else None
        receipt.company_bank_name_snapshot = account.bank_name if account else None
        receipt.company_bank_branch_snapshot = account.bank_branch if account else None
        self._gan_muc_thu(receipt, values.get("muc_thu_chi_id"))
        self._chan_ky_khoa(receipt)
        saved = self.repo.save_receipt(receipt)
        self.audit.create(
            actor_user_id=actor.id,
            action=hanh_dong,
            target=f"payment_receipt:{saved.id}",
            detail=saved.code,
        )
        return self._receipt_out(saved)

    def create_receipt(self, payment_voucher_id: int, *, actor, **values):
        voucher = self._voucher(payment_voucher_id)
        if voucher.status != PAYMENT_VOUCHER_PAID:
            raise AccountingConflict("Chỉ Phiếu chi/UNC đã chi mới được lập phiếu thu.")
        if len(voucher.lines) > 1:
            # Tiền nộp lại không biết trừ vào khoản nào của phiếu gộp — khoá hẳn, đỡ đoán.
            raise AccountingValidationError(
                "Phiếu chi gộp nhiều chứng từ không nhận nộp lại. Huỷ phiếu rồi lập lại."
            )
        prepared = self._prepare_receipt(voucher, values, exclude_receipt_id=None)
        # Cấp số trước khi chạm ORM object (xem _next_voucher_doc_no).
        doc_no = self.sequences.generate_flat_code(SEQ_DOC_TYPE_PAYMENT_RECEIPT)
        receipt = PaymentReceipt(
            code=self._new_receipt_code(),
            doc_no=doc_no,
            payment_voucher_id=voucher.id,
            purchase_request_id=voucher.purchase_request_id,
            # LẬP PHIẾU LÀ ĐÃ THU (chủ chốt 27/08/2026: *"cứ lập phiếu là ra tiền rồi xác nhận cái
            # gì nữa"*). Trước đây phiếu ra ở `waiting` rồi chờ bấm "Xác nhận đã thu" — bước đó
            # đúng trên giấy nhưng sai với cách làm thật: kế toán chỉ lập phiếu SAU khi tiền đã về.
            # Quên bấm nút là công nợ báo mình đã trả nhiều hơn thực tế, vì chỉ phiếu `received`
            # mới được trừ ngược vào tiền đã chi (`phan_bo_tien_dot`).
            #
            # Nay khớp với ba nguồn phiếu thu còn lại (khác · hoá đơn bán · cọc đơn) và với chính
            # phiếu chi ("lập ra là đã chi", 06/08/2026) — cả sổ quỹ một luật, không còn hai kiểu.
            status=PAYMENT_RECEIPT_RECEIVED,
            received_by_user_id=actor.id,
            received_at=_now(),
            created_by_user_id=actor.id,
        )
        self._apply_receipt(receipt, voucher, prepared)
        receipt.source_type = RECEIPT_SOURCE_PURCHASE
        receipt.supplier_id = bao_cao_cong_no.ncc_cua_phieu_chi(voucher)
        self._gan_muc_thu(receipt, values.get("muc_thu_chi_id"))
        self._chan_ky_khoa(receipt)
        saved = self.repo.save_receipt(receipt)
        self.audit.create(
            actor_user_id=actor.id,
            action="create_payment_receipt",
            target=f"payment_receipt:{saved.id}",
            detail=f"{saved.code} <- {voucher.code}",
        )
        return self._receipt_out(saved)

    def create_order_receipt(
        self,
        *,
        order_id: int,
        order_no: str,
        customer_name: str | None,
        actor,
        receipt_method: str,
        amount: int,
        receipt_date,
        content: str | None = None,
        bank_reference: str | None = None,
        company_bank_account_id: int | None = None,
        note: str | None = None,
        payer_name: str | None = None,
        payer_address: str | None = None,
        mark_received: bool = True,
    ) -> dict:
        """Sinh phiếu thu 01-TT cho CỌC đơn bán — dùng CHUNG bảng payment_receipts + CHUNG dãy
        số PT với phiếu thu mua hàng (1 quyển sổ quỹ). Người nộp = khách, không cap theo phiếu chi.
        `mark_received=True` (mặc định) → phiếu ở trạng thái đã thu ngay (Kế toán ghi khi tiền đã
        về) → cổng chốt đơn đếm ngay. Định khoản 01-TT: Nợ 111/112 · Có 131 (phải thu khách)."""
        if receipt_method not in PAYMENT_VOUCHER_TYPES:
            raise AccountingValidationError("Hình thức thu không hợp lệ.")
        amount = int(amount or 0)
        if amount <= 0:
            raise AccountingValidationError("Số tiền thu phải lớn hơn 0.")
        company_account = None
        reference = _text(bank_reference, label="Mã giao dịch", max_length=64)
        # TK công ty nhận là TÙY CHỌN với cọc đơn bán (bank_reference đủ vết); nếu có thì kiểm hợp lệ.
        if receipt_method == VOUCHER_BANK_TRANSFER and company_bank_account_id:
            company_account = self.repo.get_company_account(int(company_bank_account_id))
            if company_account is None or not company_account.is_active:
                raise AccountingValidationError("Tài khoản công ty không hợp lệ.")
            if not company_account.use_for_receipts:
                raise AccountingValidationError("Tài khoản này chưa được bật dùng để thu.")
            if company_account.currency != "VND":
                raise AccountingValidationError("Cọc đơn bán chỉ nhận VND.")
        doc_no = self.sequences.generate_flat_code(SEQ_DOC_TYPE_PAYMENT_RECEIPT)
        receipt = PaymentReceipt(
            code=self._new_receipt_code(),
            doc_no=doc_no,
            source_type=RECEIPT_SOURCE_ORDER,
            order_id=order_id,
            order_no_snapshot=order_no,
            customer_name_snapshot=customer_name,
            # Người nộp mặc định = khách; form thu cọc sửa được (vd người khách cử mang tiền tới).
            payer_name=(_text(payer_name, label="Người nộp tiền", max_length=255) or customer_name or "Khách hàng"),
            payer_address=_text(payer_address, label="Địa chỉ người nộp", max_length=500),
            receipt_method=receipt_method,
            receipt_date=receipt_date,
            amount=amount,
            amount_vnd=amount,
            currency="VND",
            exchange_rate=1,
            content=_text(content, label="Nội dung thu", max_length=500) or f"Thu cọc đơn {order_no}",
            # Nợ/Có ĐỂ TRỐNG (chủ 21/08/2026: "cái nợ và có ấy thì họ điền gì kệ họ"). Hai cột
            # này không nuôi tính toán nào, chỉ IN ra phiếu — `printTT200` in sẵn dòng chấm khi
            # trống để kế toán tự ghi. Đúng ý ban đầu, xem mg 2288: "định khoản Nợ/Có NHẬP TAY".
            debit_account=None,
            credit_account=None,
            bank_reference=reference,
            company_bank_account_id=(company_account.id if company_account else None),
            company_account_holder_snapshot=(company_account.account_holder if company_account else None),
            company_account_number_snapshot=(company_account.account_number if company_account else None),
            company_bank_name_snapshot=(company_account.bank_name if company_account else None),
            company_bank_branch_snapshot=(company_account.bank_branch if company_account else None),
            note=_text(note, label="Ghi chú", max_length=2000),
            status=PAYMENT_RECEIPT_WAITING,
            created_by_user_id=actor.id,
        )
        if mark_received:
            receipt.status = PAYMENT_RECEIPT_RECEIVED
            receipt.received_by_user_id = actor.id
            receipt.received_at = _now()
        self._gan_muc_thu(receipt, None)
        self._chan_ky_khoa(receipt)
        saved = self.repo.save_receipt(receipt)
        self.audit.create(
            actor_user_id=actor.id,
            action="create_order_receipt",
            target=f"payment_receipt:{saved.id}",
            detail=f"{saved.code} <- đơn {order_no}",
        )
        return self._receipt_out(saved)

    def create_sales_invoice_receipt(
        self, invoice_id: int, *, actor, **values
    ) -> dict:
        """Lập Phiếu thu đã thu tiền, gắn đích danh một hóa đơn bán còn nợ."""
        invoice = self.repo.get_sales_invoice(invoice_id)
        if invoice is None:
            raise AccountingNotFound("Không tìm thấy hóa đơn bán.")
        if invoice.status != SALES_INVOICE_ISSUED:
            raise AccountingConflict("Chỉ hóa đơn còn hiệu lực mới được lập phiếu thu.")
        prepared = self._prepare_other_receipt(values)
        receipt_date = prepared.get("receipt_date")
        if receipt_date is not None and receipt_date < invoice.invoice_date:
            raise AccountingValidationError("Ngày thu không được trước ngày hóa đơn.")
        money_row = next(
            (
                row
                for row in self._receivable_rows(customer_id=invoice.customer_id)
                if row["invoice_id"] == invoice.id
            ),
            None,
        )
        remaining = money_row["remaining_amount"] if money_row else 0
        if int(prepared["amount_vnd"]) > remaining:
            raise AccountingValidationError(
                f"Số tiền thu vượt quá phần hóa đơn còn phải thu ({so_vn(remaining)} đ)."
            )
        account = prepared.pop("company_account")
        doc_no = self.sequences.generate_flat_code(SEQ_DOC_TYPE_PAYMENT_RECEIPT)
        receipt = PaymentReceipt(
            code=self._new_receipt_code(),
            doc_no=doc_no,
            source_type=RECEIPT_SOURCE_SALES_INVOICE,
            sales_invoice_id=invoice.id,
            # Cố ý không gắn order_id: tiền này là THU HÓA ĐƠN, không được làm cổng cọc nhích lên.
            order_id=None,
            order_no_snapshot=invoice.order.order_no,
            customer_name_snapshot=invoice.customer_name_snapshot,
            status=PAYMENT_RECEIPT_RECEIVED,
            created_by_user_id=actor.id,
            received_by_user_id=actor.id,
            received_at=_now(),
        )
        for key, value in prepared.items():
            setattr(receipt, key, value)
        receipt.company_bank_account_id = account.id if account else None
        receipt.company_account_holder_snapshot = account.account_holder if account else None
        receipt.company_account_number_snapshot = account.account_number if account else None
        receipt.company_bank_name_snapshot = account.bank_name if account else None
        receipt.company_bank_branch_snapshot = account.bank_branch if account else None
        self._gan_muc_thu(receipt, values.get("muc_thu_chi_id"))
        self._chan_ky_khoa(receipt)
        saved = self.repo.save_receipt(receipt)
        self.audit.create(
            actor_user_id=actor.id,
            action="create_sales_invoice_receipt",
            target=f"payment_receipt:{saved.id}",
            detail=f"{saved.code} <- HĐ {invoice.invoice_number}",
        )
        return self._receipt_out(saved)

    def create_receipt_gop(self, *, actor, lines: list[dict], shared: dict) -> dict:
        """MỘT phiếu thu cho NHIỀU khoản (hoá đơn, cọc, nhiều đơn) của CÙNG một khách (17/10/2026).

        Dòng hoá đơn `{sales_invoice_id, amount}`: hoá đơn còn hiệu lực, không vượt phần còn phải
        thu, ngày thu không trước ngày hoá đơn — đúng luật phiếu thu lẻ theo hoá đơn. Dòng cọc
        `{order_id, amount}`: đơn của khách, số > 0 (cọc lẻ cũng không chặn trần). Thẩm định MỌI dòng
        trước, ghi MỘT phiếu sau. Một dòng ⇒ phiếu lẻ bình thường (đầu phiếu mang nguồn)."""
        if not lines:
            raise AccountingValidationError("Chưa chọn khoản nào để thu.")
        if len(lines) > 50:
            raise AccountingValidationError("Một phiếu thu gộp tối đa 50 khoản.")
        receipt_date = shared.get("receipt_date")
        da_thay: set[tuple[str, int]] = set()
        khach_id: int | None = None
        con_no: dict[int, int] | None = None
        dong: list[dict] = []
        for it in lines:
            so = int(it.get("amount") or 0)
            if so <= 0:
                raise AccountingValidationError("Số tiền từng khoản phải lớn hơn 0.")
            hd_id = it.get("sales_invoice_id")
            if hd_id is not None:
                invoice = self.repo.get_sales_invoice(int(hd_id))
                if invoice is None:
                    raise AccountingNotFound("Không tìm thấy hóa đơn bán.")
                if invoice.status != SALES_INVOICE_ISSUED:
                    raise AccountingConflict(
                        f"Hoá đơn {invoice.invoice_number} đã huỷ, không thu được nữa."
                    )
                khoa = ("hd", invoice.id)
                order = invoice.order
                kh = invoice.customer_id if invoice.customer_id is not None else order.customer_id
                if receipt_date is not None and receipt_date < invoice.invoice_date:
                    raise AccountingValidationError(
                        f"Ngày thu không được trước ngày hóa đơn {invoice.invoice_number}."
                    )
            else:
                if it.get("order_id") is None:
                    raise AccountingValidationError("Mỗi khoản phải là một hoá đơn hoặc cọc của một đơn.")
                order = self.repo.get_sales_order(int(it["order_id"]))
                if order is None:
                    raise AccountingNotFound("Không tìm thấy đơn hàng bán.")
                if order.status == ORDER_CANCELLED:   # đúng luật thu cọc lẻ (OrderService.add_deposit_receipt)
                    raise AccountingConflict(f"Đơn {order.order_no} đã huỷ, không ghi cọc.")
                invoice = None
                khoa = ("coc", order.id)
                kh = order.customer_id
            if khoa in da_thay:
                raise AccountingValidationError("Có khoản bị chọn trùng lặp hai lần.")
            da_thay.add(khoa)
            if khach_id is None:
                khach_id = kh
            elif kh != khach_id:
                raise AccountingValidationError(
                    "Các khoản phải cùng một khách hàng mới thu chung một phiếu được."
                )
            if invoice is not None:
                if con_no is None:
                    con_no = {
                        r["invoice_id"]: int(r["remaining_amount"])
                        for r in self._receivable_rows(customer_id=khach_id)
                    }
                tran = con_no.get(invoice.id, 0)
                if so > tran:
                    raise AccountingValidationError(
                        f"Số thu cho hoá đơn {invoice.invoice_number} vượt phần còn phải thu ({so_vn(tran)} đ)."
                    )
            dong.append({"invoice": invoice, "order": order, "amount": so})

        nhan = [
            f"HĐ {d['invoice'].invoice_number}" if d["invoice"] is not None else f"cọc đơn {d['order'].order_no}"
            for d in dong
        ]
        tong = sum(d["amount"] for d in dong)
        customer = self.repo.get_customer(khach_id) if khach_id else None
        values = {
            **shared,
            "amount": tong,
            "payer_name": (shared.get("payer_name") or "").strip() or (customer.name if customer else None),
            "content": (shared.get("content") or "").strip() or (
                "Thu " + (nhan[0] if len(nhan) == 1 else f"{', '.join(nhan[:-1])} và {nhan[-1]}")
            )[:500],
        }
        prepared = self._prepare_other_receipt(values)
        account = prepared.pop("company_account")
        dau = dong[0]
        co_hd = any(d["invoice"] is not None for d in dong)
        doc_no = self.sequences.generate_flat_code(SEQ_DOC_TYPE_PAYMENT_RECEIPT)
        receipt = PaymentReceipt(
            code=self._new_receipt_code(),
            doc_no=doc_no,
            source_type=RECEIPT_SOURCE_SALES_INVOICE if co_hd else RECEIPT_SOURCE_ORDER,
            customer_id=khach_id,
            customer_name_snapshot=(
                dau["invoice"].customer_name_snapshot if dau["invoice"] is not None
                else (customer.name if customer else None)
            ),
            order_no_snapshot=(
                dau["order"].order_no if len(dong) == 1 or len({d["order"].id for d in dong}) == 1
                else f"{dau['order'].order_no} +{len(dong) - 1}"
            )[:32],
            status=PAYMENT_RECEIPT_RECEIVED,
            created_by_user_id=actor.id,
            received_by_user_id=actor.id,
            received_at=_now(),
        )
        if len(dong) == 1:
            if dau["invoice"] is not None:
                # Thu hoá đơn không gắn order_id đầu phiếu — tiền này không làm cổng cọc nhích lên.
                receipt.sales_invoice_id = dau["invoice"].id
            else:
                receipt.order_id = dau["order"].id
        for key, value in prepared.items():
            setattr(receipt, key, value)
        receipt.company_bank_account_id = account.id if account else None
        receipt.company_account_holder_snapshot = account.account_holder if account else None
        receipt.company_account_number_snapshot = account.account_number if account else None
        receipt.company_bank_name_snapshot = account.bank_name if account else None
        receipt.company_bank_branch_snapshot = account.bank_branch if account else None
        if len(dong) > 1:
            for d in dong:
                receipt.lines.append(PaymentReceiptLine(
                    order_id=d["order"].id,
                    sales_invoice_id=d["invoice"].id if d["invoice"] is not None else None,
                    amount_vnd=d["amount"],
                ))
        self._gan_muc_thu(receipt, None)
        self._chan_ky_khoa(receipt)
        saved = self.repo.save_receipt(receipt)
        self.audit.create(
            actor_user_id=actor.id,
            action="create_payment_receipt_gop",
            target=f"payment_receipt:{saved.id}",
            detail=f"{saved.code} <- {', '.join(nhan)}",
        )
        return self._receipt_out(self._receipt(saved.id))

    def chi_tiet_khoan_thu(self, *, invoice_id: int | None = None, order_id: int | None = None) -> dict:
        """Popup chi tiết một khoản chờ thu (17/10/2026, phương án B): hàng của khoản + các lần đã
        thu. Hoá đơn gắn lượt giao ⇒ hàng theo lượt (thành tiền = dòng đơn × SL giao / SL đặt);
        không gắn ⇒ dòng đơn. Cọc ⇒ hàng của đơn + phiếu cọc. Số của phiếu gộp là phần của DÒNG."""
        if invoice_id is not None:
            invoice = self.repo.get_sales_invoice(int(invoice_id))
            if invoice is None:
                raise AccountingNotFound("Không tìm thấy hóa đơn bán.")
            order = invoice.order
            phieu = self.repo.received_invoice_receipts([invoice.id])
            trip = self.repo.luot_giao(invoice.delivery_trip_id) if invoice.delivery_trip_id else None
        elif order_id is not None:
            order = self.repo.get_sales_order(int(order_id))
            if order is None:
                raise AccountingNotFound("Không tìm thấy đơn hàng bán.")
            phieu = self.repo.dong_coc_da_thu(order.id)
            trip = None
        else:
            raise AccountingValidationError("Thiếu hoá đơn hoặc đơn.")

        dong_don = {ln.id: ln for ln in order.lines}

        def _hang(ln, sl: int) -> dict:
            dat = int(ln.qty or 0)
            tien = int(ln.line_total or 0)
            return {
                "ten": ln.description,
                "so_luong": sl,
                "dvt": ln.don_vi_tinh,
                "don_gia": (tien // dat) if dat else 0,
                "vat": int(ln.vat_pct_estimate or 0),
                "thanh_tien": round(tien * sl / dat) if dat else 0,
            }

        if trip is not None:
            hang = [
                _hang(dong_don[tl.order_line_id], int(tl.qty_giao or 0))
                for tl in trip.lines
                if tl.order_line_id in dong_don and int(tl.qty_giao or 0) > 0
            ]
        else:
            hang = [_hang(ln, int(ln.qty or 0)) for ln in order.lines]
        return {
            "hang": hang,
            "phieu": [
                {"receipt_id": p.receipt_id, "code": p.code, "doc_no": p.doc_no,
                 "ngay": p.receipt_date, "amount": int(p.amount_vnd), "gop": p.gop}
                for p in phieu
            ],
        }

    def received_sum_for_order(self, order_id: int) -> int:
        """Σ số tiền các phiếu thu ĐÃ THU (received) của một đơn — cổng chốt đơn đọc số này."""
        return self.repo.receipt_received_sum_for_order(order_id)

    def _chan_huy_khi_da_chi_ck(self, invoice_ids: list[int]) -> None:
        """Huỷ phiếu thu làm hoá đơn nợ lại, khoản CK/kê rút khỏi hàng chờ trong khi phiếu chi CK/kê
        vẫn sống (bấm thử 25/10/2026, L-VAI-35). Cùng trình tự như huỷ hoá đơn: huỷ phiếu chi trước."""
        da_chi = {i for (i, _loai), so in self.repo.da_chi_ck_ke(sorted(set(invoice_ids))).items() if so}
        if not da_chi:
            return
        hd = self.repo.db.get(SalesInvoice, min(da_chi))
        so = hd.invoice_number if hd is not None else str(min(da_chi))
        raise AccountingConflict(
            f"Hóa đơn {so} đã có phiếu chi chiết khấu/kê — huỷ phiếu chi CK/kê trước rồi mới huỷ "
            "phiếu thu.")

    def cancel_order_receipt(self, receipt_id: int, *, actor, reason: str):
        """Hủy phiếu thu CỌC đơn bán — cho hủy cả khi ĐÃ THU (ghi nhầm), khác phiếu thu mua (chỉ
        hủy chờ-thu). Không xóa trắng: giữ vết + số PT trong quyển sổ."""
        receipt = self._receipt(receipt_id)
        if receipt.source_type != RECEIPT_SOURCE_ORDER:
            raise AccountingConflict("Không phải phiếu thu cọc đơn bán.")
        if receipt.status == PAYMENT_RECEIPT_CANCELLED:
            raise AccountingConflict("Phiếu thu đã hủy.")
        # Cọc cấn FIFO vào hoá đơn của đơn ⇒ huỷ cọc cũng đẩy hoá đơn đã chi CK về nợ (L-VAI-35).
        self._chan_huy_khi_da_chi_ck(
            [hd.id for hd in self.repo.hoa_don_hieu_luc_cua_don([receipt.order_id])])
        cleaned = _text(reason, label="Lý do hủy", required=True, max_length=2000)
        receipt.status = PAYMENT_RECEIPT_CANCELLED
        receipt.cancel_reason = cleaned
        receipt.cancelled_by_user_id = actor.id
        receipt.cancelled_at = _now()
        self._chan_ky_khoa(receipt)
        saved = self.repo.save_receipt(receipt)
        self.audit.create(
            actor_user_id=actor.id, action="cancel_order_receipt",
            target=f"payment_receipt:{saved.id}", detail=f"{saved.code}: {cleaned}",
        )
        return self._receipt_out(saved)

    def update_receipt(self, receipt_id: int, *, actor, **values):
        receipt = self._receipt(receipt_id)
        # Từ 27/08/2026 phiếu thu lập ra là ĐÃ THU nên không còn phiếu nào ở `waiting` để sửa —
        # nhánh này chỉ còn phục vụ phiếu CŨ lỡ nằm lại ở trạng thái chờ. Muốn sửa một phiếu đã
        # thu thì HUỶ (có lý do) rồi lập lại: sửa thẳng số tiền của một phiếu đang được trừ vào
        # công nợ là đổi sổ mà không để lại vết.
        if receipt.status != PAYMENT_RECEIPT_WAITING:
            raise AccountingConflict(
                "Phiếu thu đã ghi nhận tiền — huỷ phiếu (có lý do) rồi lập lại, không sửa trực tiếp."
            )
        if receipt.source_type == RECEIPT_SOURCE_OTHER:
            raise AccountingConflict("Phiếu thu khác đã ghi nhận tiền, không sửa trực tiếp.")
        if receipt.source_type == RECEIPT_SOURCE_ORDER:
            raise AccountingConflict("Phiếu thu cọc đơn bán sửa ở màn Đơn hàng.")
        voucher = receipt.payment_voucher
        prepared = self._prepare_receipt(voucher, values, exclude_receipt_id=receipt.id)
        self._apply_receipt(receipt, voucher, prepared)
        self._chan_ky_khoa(receipt)
        saved = self.repo.save_receipt(receipt)
        self.audit.create(
            actor_user_id=actor.id,
            action="update_payment_receipt",
            target=f"payment_receipt:{saved.id}",
            detail=saved.code,
        )
        return self._receipt_out(saved)

    def mark_receipt_received(self, receipt_id: int, *, actor, bank_reference: str | None):
        receipt = self._receipt(receipt_id)
        if receipt.status != PAYMENT_RECEIPT_WAITING:
            raise AccountingConflict("Chỉ phiếu thu đang chờ thu mới được xác nhận đã thu.")
        reference = _text(bank_reference, label="Mã giao dịch", max_length=64)
        if receipt.receipt_method == VOUCHER_BANK_TRANSFER and not reference:
            raise AccountingValidationError(
                "Thu qua ngân hàng phải có mã giao dịch hoặc số báo có."
            )
        receipt.status = PAYMENT_RECEIPT_RECEIVED
        receipt.bank_reference = reference
        receipt.received_by_user_id = actor.id
        receipt.received_at = _now()
        self._chan_ky_khoa(receipt)
        saved = self.repo.save_receipt(receipt)
        self.audit.create(
            actor_user_id=actor.id,
            action="mark_payment_receipt_received",
            target=f"payment_receipt:{saved.id}",
            detail=saved.code,
        )
        return self._receipt_out(saved)

    def cancel_receipt(self, receipt_id: int, *, actor, reason: str):
        receipt = self._receipt(receipt_id)
        if receipt.status == PAYMENT_RECEIPT_CANCELLED:
            raise AccountingConflict("Phiếu thu đã hủy.")
        # HUỶ ĐƯỢC Ở MỌI TRẠNG THÁI (trừ đã huỷ), cho MỌI nguồn. Từ 27/08/2026 phiếu thu lập ra là
        # đã thu ⇒ nếu vẫn giữ luật "chỉ huỷ khi đang chờ thu" thì một phiếu gõ nhầm số là kẹt
        # vĩnh viễn, không sửa được mà cũng không huỷ được, trong khi nó đang trừ vào công nợ.
        # Huỷ luôn bắt LÝ DO và ghi nhật ký nên vết vẫn còn.
        # Cọc đơn bán (06/10/2026): huỷ ngay ở ngăn phiếu thu — màn Đơn hàng không có nút huỷ cọc
        # nên trước đây một phiếu cọc gõ nhầm là kẹt mãi, vẫn được cộng vào "đã cọc đủ".
        if receipt.source_type == RECEIPT_SOURCE_ORDER:
            return self.cancel_order_receipt(receipt_id, actor=actor, reason=reason)
        if receipt.source_type in (
            RECEIPT_SOURCE_OTHER,
            RECEIPT_SOURCE_SALES_INVOICE,
            RECEIPT_SOURCE_PURCHASE,
        ):
            self._chan_huy_khi_da_chi_ck(
                [l.sales_invoice_id for l in receipt.lines if l.sales_invoice_id]
                + ([receipt.sales_invoice_id] if receipt.sales_invoice_id else []))
            cleaned_reason = _text(reason, label="Lý do hủy", required=True, max_length=2000)
            receipt.status = PAYMENT_RECEIPT_CANCELLED
            receipt.cancel_reason = cleaned_reason
            receipt.cancelled_by_user_id = actor.id
            receipt.cancelled_at = _now()
            self._chan_ky_khoa(receipt)
            saved = self.repo.save_receipt(receipt)
            self.audit.create(
                actor_user_id=actor.id,
                action="cancel_payment_receipt",
                target=f"payment_receipt:{saved.id}",
                detail=f"{saved.code}: {cleaned_reason}",
            )
            return self._receipt_out(saved)
        if receipt.status != PAYMENT_RECEIPT_WAITING:
            raise AccountingConflict("Chỉ phiếu thu đang chờ thu mới được hủy.")
        cleaned_reason = _text(reason, label="Lý do hủy", required=True, max_length=2000)
        receipt.status = PAYMENT_RECEIPT_CANCELLED
        receipt.cancel_reason = cleaned_reason
        receipt.cancelled_by_user_id = actor.id
        receipt.cancelled_at = _now()
        self._chan_ky_khoa(receipt)
        saved = self.repo.save_receipt(receipt)
        self.audit.create(
            actor_user_id=actor.id,
            action="cancel_payment_receipt",
            target=f"payment_receipt:{saved.id}",
            detail=f"{saved.code}: {cleaned_reason}",
        )
        return self._receipt_out(saved)

    def _prepare_other_receipt(self, values: dict) -> dict:
        receipt_method = (values.get("receipt_method") or "").strip()
        if receipt_method not in PAYMENT_VOUCHER_TYPES:
            raise AccountingValidationError("Hình thức thu không hợp lệ.")
        payer_name = _text(
            values.get("payer_name"), label="Người nộp tiền", required=True, max_length=255
        )
        amount = int(values.get("amount") or 0)
        if amount <= 0:
            raise AccountingValidationError("Số tiền thu phải lớn hơn 0.")
        content = _text(values.get("content"), label="Nội dung thu", required=True, max_length=500)
        company_account = None
        bank_reference = _text(values.get("bank_reference"), label="Mã giao dịch", max_length=64)
        if receipt_method == VOUCHER_BANK_TRANSFER:
            account_id = values.get("company_bank_account_id")
            company_account = (
                self.repo.get_company_account(int(account_id)) if account_id else None
            )
            if company_account is None or not company_account.is_active:
                raise AccountingValidationError(
                    "Vui lòng chọn tài khoản công ty đang hoạt động."
                )
            if not company_account.use_for_receipts:
                raise AccountingValidationError("Tài khoản này chưa được bật dùng để thu.")
            if company_account.currency != "VND":
                raise AccountingValidationError("Phiếu thu khác hiện chỉ nhận VND.")
            if not bank_reference:
                raise AccountingValidationError(
                    "Thu qua ngân hàng phải có mã giao dịch hoặc số báo có."
                )
        return {
            "payer_name": payer_name,
            "payer_address": _text(
                values.get("payer_address"), label="Địa chỉ người nộp", max_length=500
            ),
            "receipt_method": receipt_method,
            "receipt_date": values.get("receipt_date"),
            "debit_account": _text(values.get("debit_account"), label="Tài khoản Nợ", max_length=64)
            or ("1121" if receipt_method == VOUCHER_BANK_TRANSFER else "1111"),
            "credit_account": _text(values.get("credit_account"), label="Tài khoản Có", max_length=64),
            "amount": amount,
            "amount_vnd": amount,
            "currency": "VND",
            "exchange_rate": 1,
            "content": content,
            "bank_reference": bank_reference,
            "note": _text(values.get("note"), label="Ghi chú", max_length=2000),
            "company_account": company_account,
        }

    def _prepare_receipt(
        self, voucher: PaymentVoucher, values: dict, *, exclude_receipt_id: int | None
    ) -> dict:
        receipt_method = (values.get("receipt_method") or "").strip()
        if receipt_method not in PAYMENT_VOUCHER_TYPES:
            raise AccountingValidationError("Hình thức thu không hợp lệ.")
        payer_name = _text(
            values.get("payer_name"), label="Người nộp tiền", required=True, max_length=255
        )

        amount = int(values.get("amount") or 0)
        if amount <= 0:
            raise AccountingValidationError("Số tiền thu phải lớn hơn 0.")
        # Thu bằng đúng loại tiền của phiếu chi gốc — không nhận currency từ payload.
        currency = voucher.currency
        exchange_rate = float(values.get("exchange_rate") or voucher.exchange_rate)
        if exchange_rate <= 0:
            raise AccountingValidationError("Tỷ giá phải lớn hơn 0.")
        if currency == "VND" and exchange_rate != 1:
            raise AccountingValidationError("Tỷ giá của VND phải bằng 1.")
        amount_vnd = int(
            (Decimal(amount) * Decimal(str(exchange_rate))).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        )
        reserved = self.repo.receipt_reserved_amount(voucher.id, exclude_id=exclude_receipt_id)
        remaining = int(voucher.amount_vnd) - reserved
        if amount_vnd > remaining:
            raise AccountingValidationError(
                f"Số tiền thu vượt quá phần còn được thu ({so_vn(remaining)} đ)."
            )
        content = _text(values.get("content"), label="Nội dung thu", required=True, max_length=500)

        company_account = None
        # MÃ GIAO DỊCH thu ngay tại đây từ 27/08/2026 — trước kia nó chỉ được hỏi ở bước "Xác nhận
        # đã thu", mà bước đó nay bỏ rồi (phiếu lập ra là ĐÃ THU). Không hỏi ở đây là khoản tiền về
        # qua ngân hàng mất sạch dấu vết đối chiếu sao kê. Cùng luật với `_prepare_other_receipt`.
        bank_reference = _text(values.get("bank_reference"), label="Mã giao dịch", max_length=64)
        if receipt_method == VOUCHER_BANK_TRANSFER:
            account_id = values.get("company_bank_account_id")
            company_account = (
                self.repo.get_company_account(int(account_id)) if account_id else None
            )
            if company_account is None or not company_account.is_active:
                raise AccountingValidationError(
                    "Vui lòng chọn tài khoản công ty đang hoạt động."
                )
            if not company_account.use_for_receipts:
                raise AccountingValidationError("Tài khoản này chưa được bật dùng để thu.")
            if company_account.currency != currency:
                raise AccountingValidationError(
                    "Loại tiền phiếu thu phải khớp tài khoản nhận."
                )
            if not bank_reference:
                raise AccountingValidationError(
                    "Thu qua ngân hàng phải có mã giao dịch hoặc số báo có."
                )

        return {
            "bank_reference": bank_reference,
            "payer_name": payer_name,
            "payer_address": _text(
                values.get("payer_address"), label="Địa chỉ người nộp", max_length=500
            ),
            "receipt_method": receipt_method,
            "receipt_date": values.get("receipt_date"),
            "debit_account": _text(values.get("debit_account"), label="Tài khoản Nợ", max_length=64),
            "credit_account": _text(values.get("credit_account"), label="Tài khoản Có", max_length=64),
            "amount": amount,
            "amount_vnd": amount_vnd,
            "currency": currency,
            "exchange_rate": exchange_rate,
            "content": content,
            "note": _text(values.get("note"), label="Ghi chú", max_length=2000),
            "company_account": company_account,
        }

    def _apply_receipt(
        self, receipt: PaymentReceipt, voucher: PaymentVoucher, prepared: dict
    ) -> None:
        account = prepared.pop("company_account")
        for key, value in prepared.items():
            setattr(receipt, key, value)
        receipt.company_bank_account_id = account.id if account else None
        receipt.voucher_code_snapshot = voucher.code
        receipt.purchase_code_snapshot = voucher.source_code_snapshot
        receipt.supplier_name_snapshot = voucher.supplier_name_snapshot
        receipt.company_account_holder_snapshot = account.account_holder if account else None
        receipt.company_account_number_snapshot = account.account_number if account else None
        receipt.company_bank_name_snapshot = account.bank_name if account else None
        receipt.company_bank_branch_snapshot = account.bank_branch if account else None

    def _new_receipt_code(self) -> str:
        alphabet = string.ascii_uppercase + string.digits
        date_part = _now().astimezone(timezone(timedelta(hours=7))).strftime("%y%m%d")
        for _ in range(30):
            suffix = "".join(secrets.choice(alphabet) for _ in range(4))
            code = f"PT-{date_part}-{suffix}"
            if self.repo.get_receipt_by_code(code) is None:
                return code
        raise AccountingConflict("Không sinh được mã chứng từ duy nhất, vui lòng thử lại.")

    def _receipt(self, receipt_id: int) -> PaymentReceipt:
        row = self.repo.get_receipt(receipt_id)
        if row is None:
            raise AccountingNotFound("Không tìm thấy phiếu thu.")
        return row

    def _receipt_out(self, row: PaymentReceipt) -> dict:
        return {
            "id": row.id,
            "code": row.code,
            "doc_no": row.doc_no,
            "source_type": row.source_type,
            "order_id": (
                row.order_id
                if row.order_id is not None
                else (row.sales_invoice.order_id if row.sales_invoice else None)
            ),
            "order_code": row.order_no_snapshot,
            "customer_id": row.customer_id,
            "customer_name": row.customer_name_snapshot,
            # Bảng phân bổ (17/10/2026). Phiếu gộp: đầu phiếu không hoá đơn/đơn, đọc ở đây.
            "lines": [
                {"order_id": l.order_id,
                 "order_code": l.order.order_no if l.order is not None else None,
                 "sales_invoice_id": l.sales_invoice_id,
                 "invoice_number": l.sales_invoice.invoice_number if l.sales_invoice else None,
                 "amount": int(l.amount_vnd)}
                for l in row.lines
            ],
            "sales_invoice_id": row.sales_invoice_id,
            "sales_invoice_number": (
                row.sales_invoice.invoice_number if row.sales_invoice else None
            ),
            "payment_voucher_id": row.payment_voucher_id,
            "payment_voucher_code": row.voucher_code_snapshot,
            "purchase_request_id": row.purchase_request_id,
            "purchase_request_code": row.purchase_code_snapshot,
            "supplier_id": row.supplier_id,
            "supplier_name": row.supplier_name_snapshot,
            "muc_thu_chi_id": row.muc_thu_chi_id,
            "muc_thu_chi_ten": ten_muc_phieu("thu", row.source_type or RECEIPT_SOURCE_PURCHASE,
                                             row.muc_thu_chi),
            "payer_name": row.payer_name,
            "payer_address": row.payer_address,
            "debit_account": row.debit_account,
            "credit_account": row.credit_account,
            "receipt_method": row.receipt_method,
            "status": row.status,
            "receipt_date": row.receipt_date,
            "amount": int(row.amount),
            "amount_vnd": int(row.amount_vnd),
            "currency": row.currency,
            "exchange_rate": float(row.exchange_rate),
            "content": row.content,
            "company_bank_account_id": row.company_bank_account_id,
            "company_account_holder": row.company_account_holder_snapshot,
            "company_account_number": row.company_account_number_snapshot,
            "company_bank_name": row.company_bank_name_snapshot,
            "company_bank_branch": row.company_bank_branch_snapshot,
            "bank_reference": row.bank_reference,
            "created_by_user_id": row.created_by_user_id,
            "created_by_name": self._user_name(row.created_by_user_id),
            "received_by_user_id": row.received_by_user_id,
            "received_by_name": self._user_name(row.received_by_user_id),
            "received_at": row.received_at,
            "cancelled_by_user_id": row.cancelled_by_user_id,
            "cancelled_by_name": self._user_name(row.cancelled_by_user_id),
            "cancelled_at": row.cancelled_at,
            "cancel_reason": row.cancel_reason,
            "note": row.note,
            "attachment_count": len(row.attachments),
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    # --- voucher attachments -----------------------------------------------

    def list_voucher_attachments(self, voucher_id: int) -> list[dict]:
        self._voucher(voucher_id)
        return [self._attachment_out(row) for row in self.repo.list_attachments(voucher_id)]

    def add_voucher_attachment(
        self,
        voucher_id: int,
        *,
        actor,
        file_name: str | None,
        content_type: str | None,
        data: bytes,
    ) -> dict:
        voucher = self._voucher(voucher_id)
        if voucher.status == PAYMENT_VOUCHER_CANCELLED:
            raise AccountingConflict("Chứng từ đã hủy — không đính kèm thêm.")
        ct = (content_type or "").lower()
        if not (ct.startswith("image/") or ct == "application/pdf"):
            raise AccountingValidationError("Chỉ nhận ảnh (image/*) hoặc PDF.")
        if not data:
            raise AccountingValidationError("Tệp rỗng.")
        if len(data) > MAX_ATTACHMENT_BYTES:
            raise AccountingValidationError("Tệp vượt quá 10 MB.")
        if len(voucher.attachments) >= MAX_ATTACHMENTS_PER_VOUCHER:
            raise AccountingValidationError(
                f"Mỗi chứng từ tối đa {MAX_ATTACHMENTS_PER_VOUCHER} file đính kèm."
            )
        key, safe_name = make_key(_ATTACHMENT_SUBDIR, voucher.id, file_name)
        get_storage().save(key, data, content_type)
        attachment = PaymentVoucherAttachment(
            payment_voucher_id=voucher.id,
            file_name=safe_name,
            file_url=url_from_key(key),
            file_type=content_type,
            uploaded_by=actor.id,
        )
        saved = self.repo.save_attachment(attachment)
        self.audit.create(
            actor_user_id=actor.id,
            action="upload_payment_voucher_attachment",
            target=f"payment_voucher:{voucher.id}",
            detail=f"{voucher.code} + {safe_name}",
        )
        return self._attachment_out(saved)

    def delete_voucher_attachment(self, voucher_id: int, attachment_id: int, *, actor) -> None:
        voucher = self._voucher(voucher_id)
        attachment = self.repo.get_attachment(attachment_id)
        if attachment is None or attachment.payment_voucher_id != voucher_id:
            raise AccountingNotFound("Không tìm thấy file đính kèm.")
        _delete_stored_file(attachment.file_url)
        file_name = attachment.file_name
        self.repo.delete_attachment(attachment)
        self.audit.create(
            actor_user_id=actor.id,
            action="delete_payment_voucher_attachment",
            target=f"payment_voucher:{voucher.id}",
            detail=f"{voucher.code} - {file_name}",
        )

    @staticmethod
    def _attachment_out(row: PaymentVoucherAttachment) -> dict:
        return {
            "id": row.id,
            "payment_voucher_id": row.payment_voucher_id,
            "file_name": row.file_name,
            "file_url": row.file_url,
            "file_type": row.file_type,
            "uploaded_by": row.uploaded_by,
            "uploaded_at": row.uploaded_at,
        }

    # --- receipt attachments -----------------------------------------------

    def list_receipt_attachments(self, receipt_id: int) -> list[dict]:
        self._receipt(receipt_id)
        return [
            self._receipt_attachment_out(row)
            for row in self.repo.list_receipt_attachments(receipt_id)
        ]

    def add_receipt_attachment(
        self,
        receipt_id: int,
        *,
        actor,
        file_name: str | None,
        content_type: str | None,
        data: bytes,
    ) -> dict:
        receipt = self._receipt(receipt_id)
        if receipt.status == PAYMENT_RECEIPT_CANCELLED:
            raise AccountingConflict("Phiếu thu đã hủy — không đính kèm thêm.")
        ct = (content_type or "").lower()
        if not (ct.startswith("image/") or ct == "application/pdf"):
            raise AccountingValidationError("Chỉ nhận ảnh (image/*) hoặc PDF.")
        if not data:
            raise AccountingValidationError("Tệp rỗng.")
        if len(data) > MAX_ATTACHMENT_BYTES:
            raise AccountingValidationError("Tệp vượt quá 10 MB.")
        if len(receipt.attachments) >= MAX_ATTACHMENTS_PER_VOUCHER:
            raise AccountingValidationError(
                f"Mỗi phiếu thu tối đa {MAX_ATTACHMENTS_PER_VOUCHER} file đính kèm."
            )
        key, safe_name = make_key(_RECEIPT_ATTACHMENT_SUBDIR, receipt.id, file_name)
        get_storage().save(key, data, content_type)
        attachment = PaymentReceiptAttachment(
            payment_receipt_id=receipt.id,
            file_name=safe_name,
            file_url=url_from_key(key),
            file_type=content_type,
            uploaded_by=actor.id,
        )
        saved = self.repo.save_receipt_attachment(attachment)
        self.audit.create(
            actor_user_id=actor.id,
            action="upload_payment_receipt_attachment",
            target=f"payment_receipt:{receipt.id}",
            detail=f"{receipt.code} + {safe_name}",
        )
        return self._receipt_attachment_out(saved)

    def delete_receipt_attachment(self, receipt_id: int, attachment_id: int, *, actor) -> None:
        receipt = self._receipt(receipt_id)
        attachment = self.repo.get_receipt_attachment(attachment_id)
        if attachment is None or attachment.payment_receipt_id != receipt_id:
            raise AccountingNotFound("Không tìm thấy file đính kèm.")
        _delete_stored_file(attachment.file_url)
        file_name = attachment.file_name
        self.repo.delete_receipt_attachment(attachment)
        self.audit.create(
            actor_user_id=actor.id,
            action="delete_payment_receipt_attachment",
            target=f"payment_receipt:{receipt.id}",
            detail=f"{receipt.code} - {file_name}",
        )

    @staticmethod
    def _receipt_attachment_out(row: PaymentReceiptAttachment) -> dict:
        return {
            "id": row.id,
            "payment_receipt_id": row.payment_receipt_id,
            "file_name": row.file_name,
            "file_url": row.file_url,
            "file_type": row.file_type,
            "uploaded_by": row.uploaded_by,
            "uploaded_at": row.uploaded_at,
        }

    # --- validation/output ------------------------------------------------

    def _clean_bank_account(self, values: dict, *, include_usage: bool = False) -> dict:
        cleaned = {
            "account_holder": _text(values.get("account_holder"), label="Chủ tài khoản", required=True, max_length=255),
            "account_number": _text(values.get("account_number"), label="Số tài khoản", required=True, max_length=64),
            "bank_name": _text(values.get("bank_name"), label="Ngân hàng", required=True, max_length=255),
            "bank_branch": _text(values.get("bank_branch"), label="Chi nhánh ngân hàng", required=True, max_length=255),
            "currency": (values.get("currency") or "VND").strip().upper(),
            "is_default": bool(values.get("is_default")),
            "is_active": bool(values.get("is_active", True)),
            "note": _text(values.get("note"), label="Ghi chú", max_length=2000),
        }
        if include_usage:
            cleaned["use_for_receipts"] = bool(values.get("use_for_receipts", True))
            cleaned["use_for_payments"] = bool(values.get("use_for_payments", True))
        if len(cleaned["currency"]) != 3:
            raise AccountingValidationError("Loại tiền phải gồm 3 ký tự, ví dụ VND.")
        if cleaned["is_default"] and not cleaned["is_active"]:
            raise AccountingValidationError("Tài khoản mặc định phải đang hoạt động.")
        if include_usage and not cleaned["use_for_receipts"] and not cleaned["use_for_payments"]:
            raise AccountingValidationError("Tài khoản công ty phải dùng để thu, để chi hoặc cả hai.")
        return cleaned

    def _prepare_voucher(
        self,
        purchase: PurchaseRequest,
        values: dict,
        *,
        allow_pending_purchase: bool,
        exclude_voucher_id: int | None,
    ) -> dict:
        # `PR_PARTIALLY_RECEIVED` BẮT BUỘC có mặt: đơn giao dở dang chính là ca sinh ra công nợ
        # thường xuyên nhất. Thiếu nó thì hàng về đợt 1, nợ hiện lên màn kế toán, mà bấm trả tiền
        # lại bị chặn "chưa đủ điều kiện" — nợ treo vĩnh viễn không có đường thanh toán.
        allowed_statuses = (PR_APPROVED, PR_PURCHASED, PR_PARTIALLY_RECEIVED, PR_RECEIVED)
        if purchase.status not in allowed_statuses and not (
            allow_pending_purchase and purchase.status == PR_PENDING
        ):
            raise AccountingConflict("Phiếu mua chưa đủ điều kiện lập Phiếu chi/UNC.")
        if purchase.supplier_id is None or purchase.supplier is None:
            raise AccountingValidationError("Phiếu mua chưa có nhà cung cấp.")

        voucher_type = (values.get("voucher_type") or "").strip()
        if voucher_type not in PAYMENT_VOUCHER_TYPES:
            raise AccountingValidationError("Loại chứng từ không hợp lệ.")
        stage = (values.get("payment_stage") or "").strip()
        if stage not in PAYMENT_STAGES:
            raise AccountingValidationError("Đợt thanh toán không hợp lệ.")
        amount = int(values.get("amount") or 0)
        if amount <= 0:
            raise AccountingValidationError("Số tiền thanh toán phải lớn hơn 0.")
        currency = (values.get("currency") or "VND").strip().upper()
        if len(currency) != 3:
            raise AccountingValidationError("Loại tiền phải gồm 3 ký tự, ví dụ VND.")
        exchange_rate = float(values.get("exchange_rate") or 0)
        if exchange_rate <= 0:
            raise AccountingValidationError("Tỷ giá phải lớn hơn 0.")
        if currency == "VND" and exchange_rate != 1:
            raise AccountingValidationError("Tỷ giá của VND phải bằng 1.")
        amount_vnd = int(
            (Decimal(amount) * Decimal(str(exchange_rate))).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        )
        # ĐỢT GIAO mà phiếu này trả cho. Cọc thì không có đợt nào để gắn (hàng chưa về); thanh toán
        # thì bắt buộc chỉ rõ đợt — không có nó thì công nợ biết TỔNG đã trả nhưng không biết đợt
        # nào đã xong, và cột Quá hạn (tính theo hạn trả của từng đợt) không quy được về đâu.
        delivery_id = values.get("delivery_id")
        if stage == PAYMENT_STAGE_ADVANCE:
            if delivery_id is not None:
                raise AccountingValidationError(
                    "Phiếu đặt cọc không gắn với đợt giao nào — cọc là tiền chi trước khi hàng về."
                )
            # CỌC phải được KHAI TRƯỚC trên phiếu mua (chủ chốt 09/08/2026). Không khai mà vẫn chi
            # được thì con số "Cọc dự kiến" chỉ là trang trí, và không có gì để đối chiếu với thoả
            # thuận đã ký.
            if int(getattr(purchase, "deposit_expected", 0) or 0) <= 0:
                raise AccountingValidationError(
                    "Phiếu mua này chưa khai Cọc dự kiến. Khai số cọc đã thoả thuận ở phần Hợp đồng "
                    "trên phiếu mua trước, rồi mới lập phiếu đặt cọc."
                )
        else:
            # THANH TOÁN bắt buộc gắn ĐỢT GIAO (chủ chốt 09/08/2026).
            #
            # Trước đó đơn chưa có đợt vẫn chi được với `delivery_id = None` — mở đường cho tiền ra
            # khỏi két mà không có mốc "hàng đã về đợt nào". Khi đó công nợ biết tổng đã trả nhưng
            # không biết đợt nào xong, và cột Quá hạn (tính theo hạn của TỪNG đợt) không quy được
            # về đâu.
            #
            # ⚠️ Hệ quả đã lường: đơn CŨ chưa có đợt sẽ KHÔNG trả tiền được cho tới khi ghi đợt
            # giao. Đơn đã ở trạng thái "Đã nhận" thì phải bấm "Mở lại đơn" mới ghi đợt được — chủ
            # đã chấp nhận ngày 09/08/2026 (dữ liệu đang là dữ liệu test).
            if not purchase.deliveries:
                raise AccountingValidationError(
                    "Phiếu mua này chưa có đợt giao nào. Ghi đợt giao trước — hoặc lập phiếu ĐẶT CỌC "
                    "nếu hàng chưa về."
                )
            if delivery_id is None:
                raise AccountingValidationError(
                    "Phiếu thanh toán phải chọn đợt giao. Chưa có đợt nào thì đây là tiền đặt cọc."
                )
            if not any(d.id == delivery_id for d in purchase.deliveries):
                raise AccountingValidationError("Đợt giao không thuộc phiếu mua này.")

        tran = self._tran_lap_phieu(purchase, stage, delivery_id)
        # Sửa một phiếu ĐÃ CHI: số tiền cũ của chính nó đang nằm trong `net_paid` nên đã bị trừ khỏi
        # trần — cộng lại, nếu không thì mở phiếu ra sửa mỗi dòng nội dung cũng bị báo "vượt trần".
        #
        # Chỉ cộng lại khi phiếu cũ đóng góp vào ĐÚNG cái trần đang tính: đổi phiếu từ đợt 1 sang
        # đợt 2 thì số cũ nằm ở trần của đợt 1, cộng nó vào trần đợt 2 là nới sai.
        if exclude_voucher_id is not None:
            cu = next(
                (
                    v
                    for v in purchase.payment_vouchers
                    if v.id == exclude_voucher_id and v.status == PAYMENT_VOUCHER_PAID
                ),
                None,
            )
            if cu is not None:
                cu_la_coc = cu.payment_stage == PAYMENT_STAGE_ADVANCE
                dang_la_coc = stage == PAYMENT_STAGE_ADVANCE
                cung_dich = (
                    cu_la_coc
                    if dang_la_coc
                    else (not cu_la_coc and getattr(cu, "delivery_id", None) == delivery_id)
                )
                if cung_dich:
                    tran += int(cu.amount_vnd)
        if amount_vnd > tran:
            if stage == PAYMENT_STAGE_ADVANCE:
                nhan = "đặt cọc cho đơn này"
            elif delivery_id is not None:
                seq = next(
                    (d.seq_no for d in purchase.deliveries if d.id == delivery_id), None
                )
                nhan = f"thanh toán cho đợt {seq}" if seq else "thanh toán cho đợt này"
            else:
                nhan = "thanh toán"
            raise AccountingValidationError(
                f"Số tiền quy đổi vượt quá số còn được phép {nhan} ({so_vn(tran)} đ)."
            )
        content = _text(values.get("content"), label="Nội dung chi", required=True, max_length=500)

        company_account = None
        cash_recipient_name = _text(
            values.get("cash_recipient_name"), label="Người nhận tiền", max_length=255
        )
        beneficiary_holder = _text(
            values.get("beneficiary_account_holder"),
            label="Tên chủ tài khoản thụ hưởng",
            max_length=255,
        )
        beneficiary_number = _text(
            values.get("beneficiary_account_number"),
            label="Số tài khoản thụ hưởng",
            max_length=64,
        )
        beneficiary_bank_name = _text(
            values.get("beneficiary_bank_name"),
            label="Ngân hàng thụ hưởng",
            max_length=255,
        )
        beneficiary_bank_branch = _text(
            values.get("beneficiary_bank_branch"),
            label="Chi nhánh thụ hưởng",
            max_length=255,
        )
        bank_fee_bearer = _text(
            values.get("bank_fee_bearer"), label="Bên chịu phí", max_length=16
        )
        if voucher_type == VOUCHER_CASH:
            if not cash_recipient_name:
                raise AccountingValidationError("Phiếu chi phải có người nhận tiền.")
        else:
            company_id = values.get("company_bank_account_id")
            company_account = self.repo.get_company_account(int(company_id)) if company_id else None
            if company_account is None or not company_account.is_active:
                raise AccountingValidationError("Vui lòng chọn tài khoản công ty đang hoạt động.")
            if not company_account.use_for_payments:
                raise AccountingValidationError("Tài khoản này chưa được bật dùng để chi.")
            if company_account.currency != currency:
                raise AccountingValidationError("Loại tiền của chứng từ phải khớp tài khoản trích nợ.")
            if not beneficiary_holder or not beneficiary_number or not beneficiary_bank_name:
                raise AccountingValidationError(
                    "UNC phải có tên chủ tài khoản, số tài khoản và ngân hàng thụ hưởng."
                )
            bank_fee_bearer = bank_fee_bearer or BANK_FEE_PAYER
            if bank_fee_bearer not in BANK_FEE_BEARERS:
                raise AccountingValidationError("Bên chịu phí ngân hàng không hợp lệ.")

        # HẠN TRẢ thôi bắt buộc từ 06/08/2026: phiếu chi giờ là tiền ĐÃ RA nên nó không có hạn trả.
        # Hạn trả chuyển lên ĐỢT GIAO (`purchase_deliveries.due_date`, mặc định ngày giao +
        # `suppliers.credit_days`) — đó mới là chỗ món nợ phát sinh và cần bị canh.
        # Cột `planned_payment_date` giữ lại cho dữ liệu cũ, không đọc ở đâu nữa.
        han_tra = values.get("planned_payment_date")
        ngay_ct = values.get("voucher_date")
        hom_nay = _business_today()
        # CỐ Ý KHÔNG chặn ngày quá khứ. Hoá đơn về muộn là chuyện thường: chi phát sinh 28/7, hoá
        # đơn về 5/8 ⇒ phiếu phải mang ngày 28/7 mới vào đúng kỳ kế toán. Hạn trả quá khứ cũng hợp
        # lệ — nhập phiếu cho khoản ĐÃ trễ thì phải giữ đúng ngày thật để nó hiện đỏ ngay; ép sang
        # tương lai là làm giả nợ.
        #
        # Chỉ chặn ba thứ VÔ LÝ:
        if ngay_ct is not None and ngay_ct > hom_nay:
            raise AccountingValidationError(
                "Ngày chứng từ không được ở tương lai — kiểm lại năm xem có gõ nhầm không."
            )
        ngay_hd = values.get("invoice_date")
        if ngay_hd is not None and ngay_hd > hom_nay:
            raise AccountingValidationError("Ngày hóa đơn không được ở tương lai.")
        if han_tra is not None and ngay_ct is not None and han_tra < ngay_ct:
            raise AccountingValidationError("Hạn trả tiền không được trước ngày chứng từ.")
        return {
            "source_type": VOUCHER_SOURCE_PURCHASE,
            "muc_thu_chi_id": values.get("muc_thu_chi_id"),
            "voucher_type": voucher_type,
            "payment_stage": stage,
            "delivery_id": delivery_id,
            "voucher_date": values.get("voucher_date"),
            "planned_payment_date": han_tra,
            "amount": amount,
            "amount_vnd": amount_vnd,
            "currency": currency,
            "exchange_rate": exchange_rate,
            "content": content,
            "invoice_number": _text(values.get("invoice_number"), label="Số hóa đơn", max_length=64),
            "invoice_date": values.get("invoice_date"),
            "contract_number": _text(values.get("contract_number"), label="Số hợp đồng", max_length=64),
            "company_account": company_account,
            # Tài khoản NCC không còn quản lý theo danh mục. UNC chụp thông tin thụ hưởng mà
            # kế toán nhập trên chính chứng từ, để chứng từ cũ không đổi khi NCC đổi tài khoản.
            "supplier_account": None,
            "cash_recipient_name": cash_recipient_name,
            "cash_recipient_address": _text(values.get("cash_recipient_address"), label="Địa chỉ người nhận", max_length=500),
            "cash_recipient_identity": _text(values.get("cash_recipient_identity"), label="Giấy tờ người nhận", max_length=64),
            "beneficiary_account_holder_snapshot": beneficiary_holder,
            "beneficiary_account_number_snapshot": beneficiary_number,
            "beneficiary_bank_name_snapshot": beneficiary_bank_name,
            "beneficiary_bank_branch_snapshot": beneficiary_bank_branch,
            "bank_fee_bearer": bank_fee_bearer,
            "debit_account": _text(values.get("debit_account"), label="Tài khoản Nợ", max_length=64),
            "credit_account": _text(values.get("credit_account"), label="Tài khoản Có", max_length=64),
            "note": _text(values.get("note"), label="Ghi chú", max_length=2000),
        }

    def _prepare_standalone_voucher(self, values: dict, *, advance=None, lo_tam_ung=None,
                                    gia_cong=None) -> dict:
        source_type = (values.get("source_type") or "").strip()
        if gia_cong is not None:
            # Số tiền kế toán GÕ (mặc định FE = SL chốt × đơn giá — thực tế hay có tiền lẻ, phí
            # xe). Người nhận bỏ trống ⇒ tên nhà gia công. KHÔNG gắn `supplier_id` (spec §5: không
            # công nợ 331 — `phieu_chi_cho_bao_cao` còn loại hẳn nguồn này).
            source_type = VOUCHER_SOURCE_GIA_CONG
            values = dict(values)
            if not (values.get("cash_recipient_name") or "").strip():
                values["cash_recipient_name"] = gia_cong.nha_cung_cap_ten
        elif lo_tam_ung:
            # Phiếu chi MỘT LƯỢT cho nhiều phiếu tạm ứng (25/09/2026): số tiền = TỔNG lô, lấy từ
            # phiếu đã duyệt chứ không từ payload; người nhận do nơi gọi đặt ("Theo bảng kê…").
            source_type = VOUCHER_SOURCE_SALARY_ADVANCE
            values = dict(values)
            values["amount"] = int(round(sum(float(a.amount or 0) for a in lo_tam_ung)))
        elif advance is not None:
            source_type = VOUCHER_SOURCE_SALARY_ADVANCE
            # Số tiền và người nhận LẤY TỪ PHIẾU TẠM ỨNG, không nhận từ payload — nếu không thì
            # kế toán gõ số khác số đã duyệt và phiếu chi không còn khớp phiếu duyệt.
            values = dict(values)
            values["amount"] = int(round(float(advance.amount)))
            values["cash_recipient_name"] = self._ten_nhan_vien(advance.employee_id)
        elif source_type not in (
            VOUCHER_SOURCE_INTERNAL,
            VOUCHER_SOURCE_CUSTOMER_REFUND,
            VOUCHER_SOURCE_OTHER,
            VOUCHER_SOURCE_CHI_CK,
            VOUCHER_SOURCE_CHI_KE,
        ):
            raise AccountingValidationError("Nguồn chi độc lập không hợp lệ.")
        voucher_type = (values.get("voucher_type") or "").strip()
        if voucher_type not in PAYMENT_VOUCHER_TYPES:
            raise AccountingValidationError("Loại chứng từ không hợp lệ.")
        amount = int(values.get("amount") or 0)
        if amount <= 0:
            raise AccountingValidationError("Số tiền chi phải lớn hơn 0.")
        currency = (values.get("currency") or "VND").strip().upper()
        if len(currency) != 3:
            raise AccountingValidationError("Loại tiền phải gồm 3 ký tự, ví dụ VND.")
        exchange_rate = float(values.get("exchange_rate") or 0)
        if exchange_rate <= 0:
            raise AccountingValidationError("Tỷ giá phải lớn hơn 0.")
        if currency == "VND" and exchange_rate != 1:
            raise AccountingValidationError("Tỷ giá của VND phải bằng 1.")
        amount_vnd = int(
            (Decimal(amount) * Decimal(str(exchange_rate))).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        )
        voucher_date = values.get("voucher_date")
        if voucher_date is None:
            raise AccountingValidationError("Phiếu chi phải có ngày chứng từ.")
        today = _business_today()
        if voucher_date > today:
            raise AccountingValidationError("Ngày chứng từ không được ở tương lai.")
        invoice_date = values.get("invoice_date")
        if invoice_date is not None and invoice_date > today:
            raise AccountingValidationError("Ngày hóa đơn không được ở tương lai.")

        recipient_name = _text(
            values.get("cash_recipient_name"), label="Người nhận tiền", required=True, max_length=255
        )
        recipient_address = _text(
            values.get("cash_recipient_address"), label="Địa chỉ người nhận", max_length=500
        )
        company_account = None
        bank_fee_bearer = _text(values.get("bank_fee_bearer"), label="Bên chịu phí", max_length=16)
        beneficiary_holder = _text(
            values.get("beneficiary_account_holder"), label="Tên người thụ hưởng", max_length=255
        )
        beneficiary_number = _text(
            values.get("beneficiary_account_number"), label="Số tài khoản thụ hưởng", max_length=64
        )
        beneficiary_bank_name = _text(
            values.get("beneficiary_bank_name"), label="Ngân hàng thụ hưởng", max_length=255
        )
        beneficiary_bank_branch = _text(
            values.get("beneficiary_bank_branch"), label="Chi nhánh thụ hưởng", max_length=255
        )
        if voucher_type == VOUCHER_BANK_TRANSFER:
            company_id = values.get("company_bank_account_id")
            company_account = self.repo.get_company_account(int(company_id)) if company_id else None
            if company_account is None or not company_account.is_active:
                raise AccountingValidationError("Vui lòng chọn tài khoản công ty đang hoạt động.")
            if not company_account.use_for_payments:
                raise AccountingValidationError("Tài khoản này chưa được bật dùng để chi.")
            if company_account.currency != currency:
                raise AccountingValidationError("Loại tiền của chứng từ phải khớp tài khoản trích nợ.")
            if not beneficiary_holder or not beneficiary_number or not beneficiary_bank_name:
                raise AccountingValidationError("UNC độc lập phải có tên, số tài khoản và ngân hàng thụ hưởng.")
            bank_fee_bearer = bank_fee_bearer or BANK_FEE_PAYER
            if bank_fee_bearer not in BANK_FEE_BEARERS:
                raise AccountingValidationError("Bên chịu phí ngân hàng không hợp lệ.")

        source_labels = {
            VOUCHER_SOURCE_INTERNAL: "Chi phí nội bộ",
            VOUCHER_SOURCE_CUSTOMER_REFUND: "Trả lại tiền khách",
            VOUCHER_SOURCE_OTHER: "Khác",
            VOUCHER_SOURCE_CHI_CK: "Chi chiết khấu",
            VOUCHER_SOURCE_CHI_KE: "Chi kê",
        }
        # Phiếu tạm ứng: mã nguồn in trên chứng từ là MÃ PHIẾU TẠM ỨNG (TU26-0001), để lần ngược
        # từ sổ quỹ về đúng phiếu đã duyệt.
        return {
            "salary_advance_id": advance.id if advance is not None else None,
            "gia_cong_ngoai_id": gia_cong.id if gia_cong is not None else None,
            "source_type": source_type,
            "voucher_type": voucher_type,
            "payment_stage": "other",
            "delivery_id": None,
            "voucher_date": voucher_date,
            "planned_payment_date": None,
            "amount": amount,
            "amount_vnd": amount_vnd,
            "currency": currency,
            "exchange_rate": exchange_rate,
            "content": _text(values.get("content"), label="Nội dung chi", required=True, max_length=500),
            "invoice_number": _text(values.get("invoice_number"), label="Số hóa đơn", max_length=64),
            "invoice_date": invoice_date,
            "contract_number": _text(values.get("contract_number"), label="Số hợp đồng", max_length=64),
            "company_account": company_account,
            "supplier_account": None,
            "cash_recipient_name": recipient_name,
            "cash_recipient_address": recipient_address,
            "cash_recipient_identity": _text(
                values.get("cash_recipient_identity"), label="Giấy tờ người nhận", max_length=64
            ),
            "bank_fee_bearer": bank_fee_bearer,
            "debit_account": _text(values.get("debit_account"), label="Tài khoản Nợ", max_length=64),
            "credit_account": _text(values.get("credit_account"), label="Tài khoản Có", max_length=64),
            "note": _text(values.get("note"), label="Ghi chú", max_length=2000),
            "source_code_snapshot": (advance.code or f"TU#{advance.id}") if advance is not None
                                    else f"Lô {len(lo_tam_ung)} phiếu tạm ứng" if lo_tam_ung
                                    else self._ma_lenh_gia_cong(gia_cong) if gia_cong is not None
                                    else source_labels[source_type],
            "muc_thu_chi_id": values.get("muc_thu_chi_id"),
            "customer_id": values.get("customer_id"),
            "supplier_name_snapshot": recipient_name,
            "supplier_tax_code_snapshot": None,
            "supplier_address_snapshot": recipient_address,
            "beneficiary_account_holder_snapshot": beneficiary_holder,
            "beneficiary_account_number_snapshot": beneficiary_number,
            "beneficiary_bank_name_snapshot": beneficiary_bank_name,
            "beneficiary_bank_branch_snapshot": beneficiary_bank_branch,
        }

    def _ma_lenh_gia_cong(self, gcn) -> str:
        from .gia_cong_ngoai.lan import nguon_lan

        # Lần của bài ghép: mã bài ghép (mã lệnh thành viên nằm ở lý do chi — cột này chỉ 32 ký tự).
        nguon = nguon_lan(self.repo.db, gcn)
        ma = nguon["bai_ghep_ma"] or nguon["lsx_ma"] or f"#{gcn.id}"
        return f"Gia công {ma}"[:32]  # cột String(32)

    def _next_voucher_doc_no(self) -> str:
        """Số IN trên mẫu 02-TT (PC00445) — chung bộ đếm cho tiền mặt lẫn UNC.

        Bộ đếm nay đi CHUNG giao dịch (không còn tự commit — xem
        DocumentSequenceRepository.increment_and_get), nên phiếu hỏng thì số cấp dở trả lại.
        Vẫn giữ nếp gọi SAU khi validate xong: số nhảy vô ích cũng là số mất.
        """
        return self.sequences.generate_flat_code(SEQ_DOC_TYPE_PAYMENT_VOUCHER)

    def _new_voucher(
        self, purchase: PurchaseRequest | None, prepared: dict, actor_id: int, *, doc_no: str | None = None
    ) -> PaymentVoucher:
        # LẬP PHIẾU CHI = TIỀN ĐÃ RA (chủ chốt 06/08/2026, Đ1). Không còn khoảng "chờ chi" giữa
        # việc viết phiếu và việc tiền rời két, nên phiếu sinh ra đã là `paid` và mang luôn người
        # chi + mốc chi. `paid_at` lấy NGÀY CHỨNG TỪ chứ không lấy giờ bấm: hoá đơn về muộn thì phiếu
        # mang ngày 28/7 phải rơi vào kỳ kế toán tháng 7, không phải kỳ của hôm nhập liệu.
        voucher = PaymentVoucher(
            code=self._new_voucher_code(prepared["voucher_type"]),
            doc_no=doc_no,
            purchase_request_id=purchase.id if purchase else None,
            supplier_id=purchase.supplier_id if purchase else None,
            status=PAYMENT_VOUCHER_PAID,
            created_by_user_id=actor_id,
            paid_by_user_id=actor_id,
            paid_at=datetime.combine(
                prepared["voucher_date"], time(0, 0), tzinfo=timezone.utc
            ),
        )
        muc_id = prepared.pop("muc_thu_chi_id", None)
        khach_id = prepared.pop("customer_id", None)
        self._apply_voucher(voucher, purchase, prepared)
        self._gan_muc_chi(voucher, muc_id, khach_id)
        return voucher

    # --- mục thu chi (11/10/2026, 12/10/2026) ----------------------------------------------
    # Phiếu SINH TỪ NGHIỆP VỤ (đơn mua, gia công, tạm ứng lương, hoá đơn, cọc đơn, NCC hoàn tiền)
    # thuộc mục CỐ ĐỊNH suy từ `source_type` (`models.muc_thu_chi.MUC_CO_DINH`) — cột mục để trống,
    # payload có gửi mục cũng bỏ qua. Phiếu LẬP TAY bắt buộc chọn một mục kế toán tự khai.

    def _muc_svc(self) -> MucThuChiService:
        return MucThuChiService(MucThuChiRepository(self.repo.db))

    def _chon_muc(self, loai: str, nguon: str, muc_id):
        if muc_co_dinh(loai, nguon) is not None:
            return None
        try:
            return self._muc_svc().kiem_muc(muc_id, loai)
        except MucThuChiError as e:
            raise AccountingValidationError(str(e)) from None

    def _gan_muc_chi(self, voucher: PaymentVoucher, muc_id, khach_id) -> None:
        nguon = voucher.source_type or VOUCHER_SOURCE_PURCHASE
        muc = self._chon_muc("chi", nguon, muc_id)
        voucher.muc_thu_chi_id = muc.id if muc else None
        # Chỉ phiếu trả lại tiền cho khách mang khách (đã kiểm ở `_gan_khach_tra_lai`); phiếu khác
        # có gửi khách lên cũng bỏ, kẻo bị cộng vào Công nợ phải thu.
        voucher.customer_id = khach_id if nguon == VOUCHER_SOURCE_CUSTOMER_REFUND else None

    def _gan_khach_tra_lai(self, prepared: dict, values: dict) -> None:
        """Phiếu chi TRẢ LẠI TIỀN CHO KHÁCH (12/10/2026): lập từ ngăn Công nợ phải thu hoặc nút
        "Trả lại cọc" trên đơn đã huỷ. Bắt buộc khách; có đơn thì đơn phải của khách đó, đã huỷ, và
        số tiền không vượt phần cọc còn lại của đơn. Không đơn thì không chặn số — trả lại cho hàng
        lỗi có thể vượt số khách đang dư, màn hình chỉ nhắc."""
        khach_id = values.get("customer_id")
        khach = self.repo.get_customer(int(khach_id)) if khach_id else None
        if khach is None:
            raise AccountingValidationError("Phiếu trả lại tiền phải chọn khách hàng nhận tiền.")
        don_id = values.get("order_id")
        don = None
        if don_id:
            don = self.repo.get_sales_order(int(don_id))
            if don is None or don.customer_id != khach.id:
                raise AccountingValidationError("Đơn trả lại cọc không phải đơn của khách này.")
            # Trần = tiền khách còn phải trả lại của đơn (17/10/2026): đơn huỷ là cả quỹ còn giữ
            # (cọc + tiền hoá đơn đã huỷ); đơn đang chạy chỉ phần dư khi đã hết chỗ ghi hoá đơn.
            from .ban_hang_cho_thu_chi import tien_cho_tra_lai

            con = next((r["con_lai"] for r in tien_cho_tra_lai(self.repo, [don.id])), 0)
            if con <= 0 and don.status != ORDER_CANCELLED:
                raise AccountingValidationError(
                    f"Đơn {don.order_no} chưa huỷ — tiền khách đã đưa còn được trừ vào hoá đơn, "
                    "không trả lại.")
            if prepared["amount_vnd"] > con:
                raise AccountingValidationError(
                    f"Số tiền vượt phần tiền khách còn lại của đơn {don.order_no} ({so_vn(max(con, 0))} đ).")
        prepared["customer_id"] = khach.id
        prepared["order_id"] = don.id if don is not None else None
        prepared["source_code_snapshot"] = (don.order_no if don is not None else "Trả lại tiền khách")[:32]

    def _gan_muc_thu(self, receipt: PaymentReceipt, muc_id) -> None:
        nguon = receipt.source_type or RECEIPT_SOURCE_PURCHASE
        muc = self._chon_muc("thu", nguon, muc_id)
        receipt.muc_thu_chi_id = muc.id if muc else None

    def _apply_voucher(self, voucher: PaymentVoucher, purchase: PurchaseRequest | None, prepared: dict) -> None:
        company = prepared.pop("company_account")
        beneficiary = prepared.pop("supplier_account")
        for key, value in prepared.items():
            setattr(voucher, key, value)
        voucher.company_bank_account_id = company.id if company else None
        voucher.supplier_bank_account_id = beneficiary.id if beneficiary else None
        if purchase is not None:
            voucher.source_code_snapshot = purchase.code
            voucher.supplier_id = purchase.supplier_id
            voucher.supplier_name_snapshot = purchase.supplier.name
            voucher.supplier_tax_code_snapshot = purchase.supplier.tax_code
            voucher.supplier_address_snapshot = purchase.supplier.address
        voucher.company_account_holder_snapshot = company.account_holder if company else None
        voucher.company_account_number_snapshot = company.account_number if company else None
        voucher.company_bank_name_snapshot = company.bank_name if company else None
        voucher.company_bank_branch_snapshot = company.bank_branch if company else None
        if beneficiary is not None:
            voucher.beneficiary_account_holder_snapshot = beneficiary.account_holder
            voucher.beneficiary_account_number_snapshot = beneficiary.account_number
            voucher.beneficiary_bank_name_snapshot = beneficiary.bank_name
            voucher.beneficiary_bank_branch_snapshot = beneficiary.bank_branch

    def _new_voucher_code(self, voucher_type: str) -> str:
        prefix = "PC" if voucher_type == VOUCHER_CASH else "UNC"
        alphabet = string.ascii_uppercase + string.digits
        date_part = _now().astimezone(timezone(timedelta(hours=7))).strftime("%y%m%d")
        for _ in range(30):
            suffix = "".join(secrets.choice(alphabet) for _ in range(4))
            code = f"{prefix}-{date_part}-{suffix}"
            if self.repo.get_voucher_by_code(code) is None:
                return code
        raise AccountingConflict("Không sinh được mã chứng từ duy nhất, vui lòng thử lại.")

    def create_vouchers_from_advances_batch(
        self, *, actor, salary_advance_ids: list[int], shared: dict
    ) -> list[dict]:
        """Chi MỘT LƯỢT cho các phiếu tạm ứng / lương đợt 1 ĐÃ DUYỆT ⇒ **MỘT phiếu chi cho cả lô**
        (chủ đổi ý 25/09/2026: "cho dù một nhân viên hay 1000 nhân viên cùng lúc, cũng chỉ 1 phiếu
        chi"). Số tiền = tổng lô; người nhận "Theo bảng kê đính kèm (N người)" — bảng kê in từ
        `bang_ke_tam_ung`. Lô MỘT người thì như lập lẻ: tên + tài khoản của chính người đó.

        Chuyển khoản: kế toán lập phiếu SAU khi ngân hàng báo kết quả, và chỉ để lại những người đã
        chuyển THÀNH CÔNG; ai lỗi thì bỏ khỏi lượt, chi sau. Sai thì huỷ cả phiếu chi rồi lập lại
        (chủ chốt — không gỡ lẻ một người khỏi phiếu chi).

        THẨM ĐỊNH TRƯỚC, GHI SAU: một phiếu vướng (chưa duyệt, đã có phiếu chi, người nhận chưa
        khai số tài khoản khi chuyển khoản…) là KHÔNG ghi gì; lỗi gom theo câu, kèm id phiếu vướng."""
        if not salary_advance_ids:
            raise AccountingValidationError("Chưa chọn phiếu tạm ứng nào.")
        if len(salary_advance_ids) > 3000:
            raise AccountingValidationError("Chọn tối đa 3000 phiếu cho một lượt chi.")
        if self._payroll is None or self._employees is None:
            raise AccountingValidationError("Chưa nối được phân hệ Lương / Nhân sự để đọc phiếu tạm ứng.")
        chuyen_khoan = (shared.get("voucher_type") or "").strip() == VOUCHER_BANK_TRANSFER
        # Lương chuyển đi thì CÔNG TY chịu phí — không thì người nhận hụt so với số đã duyệt.
        chung = {**shared, "currency": "VND", "exchange_rate": 1, "bank_fee_bearer": None}

        # NẠP MỘT LẦN. Cùng các chốt của `_advance_cho_phieu_chi`: một tạm ứng chỉ MỘT phiếu chi còn
        # hiệu lực (xét trước), chỉ phiếu ĐÃ DUYỆT.
        ids = list(dict.fromkeys(int(i) for i in salary_advance_ids))
        theo_id = {a.id: a for a in self._payroll.get_advances_by_ids(ids)}
        da_co = self.repo.live_vouchers_by_salary_advance_ids(ids)
        nv = self._employees.map_by_ids({a.employee_id for a in theo_id.values()})

        theo_loi: dict[str, list[str]] = {}
        vuong: list[int] = []
        lo: list = []
        for aid in ids:
            a = theo_id.get(aid)
            emp = nv.get(a.employee_id) if a is not None else None
            # Báo lỗi bằng TÊN người (kế toán nhìn danh sách theo tên), kể cả lỗi "chưa duyệt".
            nhan = emp.full_name if emp is not None else f"#{aid}"
            try:
                if a is None:
                    raise AccountingNotFound("Không tìm thấy phiếu tạm ứng")
                if aid in da_co:
                    raise AccountingConflict(f"Phiếu tạm ứng đã có phiếu chi {da_co[aid].code} rồi")
                if a.status != ADV_APPROVED:
                    raise AccountingValidationError("Chỉ lập phiếu chi cho phiếu tạm ứng ĐÃ DUYỆT")
                if chuyen_khoan and not (((emp.bank_account if emp else None) or "").strip()
                                         and ((emp.bank_name if emp else None) or "").strip()):
                    raise AccountingValidationError(
                        "Chưa khai số tài khoản / ngân hàng trong hồ sơ nhân sự")
                lo.append(a)
            except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
                theo_loi.setdefault(str(exc).rstrip(". "), []).append(nhan)
                vuong.append(aid)
        if theo_loi:
            phan = []
            for cau, ai in theo_loi.items():
                ds = ", ".join(ai[:5]) + (f" và {len(ai) - 5} người khác" if len(ai) > 5 else "")
                phan.append(f"{cau} ({ds})")
            raise AccountingBulkBlocked("Chưa lập phiếu chi nào — " + "; ".join(phan) + ".", vuong)

        kinds = {a.kind or "tam_ung" for a in lo}
        loai = ("Thanh toán lương đợt 1" if kinds == {"luong_dot_1"}
                else "Tạm ứng lương" if kinds == {"tam_ung"} else "Chi tạm ứng + lương đợt 1")
        ky = "tháng " + ", ".join(f"{m:02d}/{y}" for y, m in sorted(
            {(int(a.period_year), int(a.period_month)) for a in lo}))
        if len(lo) == 1:
            # Lô MỘT người: như lập lẻ — tên + tài khoản của chính người đó.
            a = lo[0]
            emp = nv.get(a.employee_id)
            ten = emp.full_name if emp is not None else f"NV#{a.employee_id}"
            values = {**chung, "content": f"{loai} {ky} — {ten}"[:500]}
            if chuyen_khoan:
                values.update(beneficiary_account_holder=ten,
                              beneficiary_account_number=emp.bank_account.strip(),
                              beneficiary_bank_name=emp.bank_name.strip(),
                              beneficiary_bank_branch=None)
            prepared = self._prepare_standalone_voucher(values, advance=a)
        else:
            so_nguoi = len({a.employee_id for a in lo})
            theo_bang_ke = f"Theo bảng kê đính kèm ({so_nguoi} người)"
            values = {**chung, "cash_recipient_name": theo_bang_ke,
                      "content": f"{loai} {ky} — {so_nguoi} người (theo bảng kê)"[:500]}
            if chuyen_khoan:
                # UNC một lô: thụ hưởng là DANH SÁCH — chi tiết từng tài khoản nằm ở bảng kê / file MB.
                values.update(beneficiary_account_holder=theo_bang_ke,
                              beneficiary_account_number="Theo bảng kê",
                              beneficiary_bank_name="Theo bảng kê",
                              beneficiary_bank_branch=None)
            prepared = self._prepare_standalone_voucher(values, lo_tam_ung=lo)
        if not chuyen_khoan:
            prepared.update(beneficiary_account_holder_snapshot=None,
                            beneficiary_account_number_snapshot=None,
                            beneficiary_bank_name_snapshot=None,
                            beneficiary_bank_branch_snapshot=None)

        # GHI MỘT GIAO DỊCH: phiếu chi + mọi phiếu tạm ứng sang ĐÃ CHI (mới trừ vào lương) và trỏ
        # về phiếu chi này; `decided_at` để chốt lương (L12) biết phiếu đổi sau lần Tính lại.
        phieu = self._new_voucher(None, prepared, actor.id, doc_no=self._next_voucher_doc_no())
        self.repo.add_vouchers([phieu])
        luc = _now()
        for a in lo:
            a.status = ADV_PAID
            a.decided_at = luc
            a.payment_voucher_id = phieu.id
        self.audit.create_many(
            [{"actor_user_id": actor.id, "action": "create_payment_voucher",
              "target": f"payment_voucher:{phieu.id}",
              "detail": f"{phieu.code} <- {len(lo)} phiếu tạm ứng (chi một lượt)"}]
            + [{"actor_user_id": actor.id, "action": "pay_salary_advance",
                "target": f"salary_advance:{a.id}",
                "detail": f"{a.code or a.id} · {so_vn(float(a.amount))}đ → {phieu.code}"}
               for a in lo]
        )
        pc_id = phieu.id
        self.repo.commit()
        return [self._voucher_out(self.repo.get_vouchers_by_ids([pc_id])[0])]

    def bang_ke_tam_ung(self, voucher_id: int) -> dict:
        """BẢNG KÊ đính kèm phiếu chi một lượt — từng người: mã, tên, tổ, loại, số tiền, tài khoản
        (chuyển khoản) hoặc cột ký nhận (tiền mặt, in ở FE). Phiếu chi lẻ cũng in được (1 dòng)."""
        v = self._voucher(voucher_id)
        lo = self._lo_cua_phieu_chi(v)
        if not lo:
            raise AccountingNotFound("Phiếu chi này không chi phiếu tạm ứng nào.")
        nv = self._employees.map_by_ids({a.employee_id for a in lo}) if self._employees else {}
        rows = []
        for a in lo:
            e = nv.get(a.employee_id)
            rows.append({
                "salary_advance_id": a.id, "ma_phieu": a.code, "kind": a.kind or "tam_ung",
                "employee_id": a.employee_id,
                "ma_nv": getattr(e, "code", None), "ten": getattr(e, "full_name", None),
                "department_id": getattr(e, "department_id", None),
                "so_tien": int(round(float(a.amount or 0))),
                "so_tai_khoan": getattr(e, "bank_account", None),
                "ngan_hang": getattr(e, "bank_name", None),
            })
        rows.sort(key=lambda r: (r["department_id"] or 0, r["ma_nv"] or "", r["salary_advance_id"]))
        return {
            "voucher_id": v.id, "code": v.code, "doc_no": v.doc_no, "voucher_type": v.voucher_type,
            "voucher_date": v.voucher_date, "content": v.content, "status": v.status,
            "so_nguoi": len({r["employee_id"] for r in rows}),
            "tong": sum(r["so_tien"] for r in rows), "rows": rows,
        }

    def _lo_cua_phieu_chi(self, voucher) -> list:
        """Mọi phiếu tạm ứng phiếu chi này đã chi: theo cột mới `salary_advances.payment_voucher_id`
        (lô, từ 25/09/2026) + phiếu một-một cũ qua `payment_vouchers.salary_advance_id`."""
        if self._payroll is None:
            return []
        lo = list(self._payroll.advances_by_payment_voucher(voucher.id))
        if voucher.salary_advance_id is not None and not any(
                a.id == voucher.salary_advance_id for a in lo):
            a0 = self._payroll.get_advance(int(voucher.salary_advance_id))
            if a0 is not None and a0.payment_voucher_id in (None, voucher.id):
                lo.append(a0)
        return lo

    def _advance_cho_phieu_chi(self, salary_advance_id: int | None):
        """Phiếu tạm ứng hợp lệ để lập phiếu chi. Bốn chốt, theo đúng chốt của chủ 18/08/2026."""
        if salary_advance_id is None:
            raise AccountingValidationError("Phiếu chi từ tạm ứng phải chọn phiếu tạm ứng nguồn.")
        if self._payroll is None:
            raise AccountingValidationError("Chưa nối được phân hệ Lương để đọc phiếu tạm ứng.")
        a = self._payroll.get_advance(int(salary_advance_id))
        if a is None:
            raise AccountingNotFound("Không tìm thấy phiếu tạm ứng.")
        # CHỐT 2 (xét trước) — một phiếu tạm ứng chỉ MỘT phiếu chi còn hiệu lực (DB có UNIQUE riêng
        # phần chặn song song, mg 0271). Từ 07/09/2026 phiếu đã chi mang trạng thái `paid` — xét
        # trước để lập lần hai vẫn ra 409 "đã có phiếu chi" chứ không phải 400 "chưa duyệt".
        if self.repo.get_voucher_by_salary_advance(a.id) is not None:
            raise AccountingConflict(
                f"Phiếu tạm ứng {a.code or a.id} đã có phiếu chi rồi."
            )
        # CHỐT 1 — CHỈ phiếu ĐÃ DUYỆT. Phiếu chờ duyệt / từ chối / đã huỷ đều không được chi.
        if a.status != ADV_APPROVED:
            raise AccountingValidationError(
                "Chỉ lập phiếu chi cho phiếu tạm ứng ĐÃ DUYỆT."
            )
        return a

    def _gia_cong_cho_phieu_chi(self, gia_cong_ngoai_id: int | None):
        """Lần gia công nguồn: phải ĐÃ CHỐT, chưa huỷ, chưa có phiếu chi còn hiệu lực. Khoá dòng để
        hai kế toán bấm cùng lúc không đẻ hai phiếu (index partial unique là chốt chặn cuối)."""
        from ..repositories.gia_cong_ngoai_repo import GiaCongNgoaiRepository

        if gia_cong_ngoai_id is None:
            raise AccountingValidationError("Phiếu chi gia công ngoài phải chọn lần gia công nguồn.")
        repo = GiaCongNgoaiRepository(self.repo.db)
        gcn = repo.khoa(int(gia_cong_ngoai_id))
        if gcn is None:
            raise AccountingNotFound("Không tìm thấy lần gia công.")
        if gcn.huy_luc is not None:
            raise AccountingValidationError("Lần gia công đã huỷ.")
        if gcn.chot_luc is None:
            raise AccountingValidationError("Lần gia công chưa chốt số — chưa chi được.")
        pc = repo.phieu_chi_song([gcn.id]).get(gcn.id)
        if pc is not None:
            raise AccountingConflict(f"Lần gia công này đã có phiếu chi {pc.code}.")
        return gcn

    def _ten_nhan_vien(self, employee_id: int) -> str:
        if self._employees is None:
            raise AccountingValidationError("Chưa nối được phân hệ Nhân sự để lấy tên người nhận.")
        emp = self._employees.get_by_id(employee_id)
        if emp is None:
            raise AccountingNotFound("Không tìm thấy nhân viên của phiếu tạm ứng.")
        return emp.full_name

    def _purchase(self, request_id: int) -> PurchaseRequest:
        row = self.purchases.get_by_id(request_id)
        if row is None:
            raise AccountingNotFound("Không tìm thấy phiếu mua hàng.")
        return row

    def _voucher(self, voucher_id: int) -> PaymentVoucher:
        row = self.repo.get_voucher(voucher_id)
        if row is None:
            raise AccountingNotFound("Không tìm thấy Phiếu chi/UNC.")
        return row

    @staticmethod
    def _purchase_total(purchase: PurchaseRequest) -> int:
        """Giá trị ĐƠN ĐẶT — con số in trên phiếu mua. Chỉ để HIỂN THỊ.

        Trần lập phiếu chi KHÔNG dùng hàm này (xem `_tran_lap_phieu`): hàng về thiếu thì trần phải
        tụt theo, còn số trên đơn thì không đổi."""
        return purchase_money(purchase)["total"]

    def _tran_lap_phieu(
        self, purchase: PurchaseRequest, stage: str, delivery_id: int | None
    ) -> int:
        """Số tối đa được phép lập phiếu chi, KHÁC NHAU theo loại phiếu (Đ1/§5.4).

        - **ĐẶT CỌC / ứng trước** — trần = **CỌC DỰ KIẾN đã khai** trừ cọc đã chi (chủ chốt
          09/08/2026). Lập được NHIỀU phiếu cọc, miễn tổng không vượt số đã khai. Chưa khai ⇒ chặn
          ngay từ vòng kiểm phía trên, không tới được đây.
        - **THANH TOÁN gắn đợt** — trần đúng bằng phần **CÒN NỢ CỦA CHÍNH ĐỢT ĐÓ**.
        - THANH TOÁN nay BẮT BUỘC gắn đợt, nên nhánh "không gắn đợt" chỉ còn là lưới an toàn.

        ⚠️ TRẦN THEO ĐỢT LÀ CHỐT QUAN TRỌNG, đừng nới về mức đơn (lỗi 07/08/2026):
        trước đó trần lấy `outstanding_amount` của CẢ ĐƠN, nên kế toán chọn "Đợt 2" rồi gõ 75tr cho
        một đợt trị giá 35tr vẫn qua. 40tr thừa chảy vào rổ cọc chung rồi lặng lẽ trả hộ **Đợt 1**
        — món nợ 50tr của đợt 1 biến mất khỏi màn Công nợ mà không ai bấm gì. Đúng bệnh GIẤU NỢ mà
        cả phân hệ này sinh ra để chữa, chỉ khác đường vào.

        Trả cho nhiều đợt bằng một lần chuyển khoản thì lập nhiều phiếu — mỗi phiếu nói rõ nó tất
        toán đợt nào. Đó cũng là thứ đem đi đối chiếu với sao kê NCC được."""
        money = purchase_money(purchase)
        if stage == PAYMENT_STAGE_ADVANCE:
            return money["tran_dat_coc"]
        if delivery_id is None:
            return money["outstanding_amount"]
        dots, _coc, _du = self._no_tung_dot(purchase)
        return next((d["con_no"] for d in dots if d["delivery_id"] == delivery_id), 0)

    def _supplier_account_out(self, row: SupplierBankAccount) -> dict:
        return {
            "id": row.id,
            "supplier_id": row.supplier_id,
            "supplier_name": row.supplier.name if row.supplier else None,
            "account_holder": row.account_holder,
            "account_number": row.account_number,
            "bank_name": row.bank_name,
            "bank_branch": row.bank_branch,
            "currency": row.currency,
            "is_default": row.is_default,
            "is_active": row.is_active,
            "note": row.note,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    def _user_name(self, user_id: int | None) -> str | None:
        if user_id is None:
            return None
        ten_nap = getattr(self, "_ten_nap", None) or {}
        if user_id in ten_nap:
            return ten_nap[user_id]
        user = self.users.get_by_id(user_id)
        return user.name if user else None

    def _nap_ten_nguoi(self, user_ids) -> None:
        """Nạp tên các User MỘT lượt cho cả trang ⇒ `_user_name` khỏi hỏi DB từng dòng. Giữ lại
        tên (`_ten_nap`) vì identity map của Session chỉ giữ tham chiếu YẾU — nạp rồi bỏ thì
        `db.get` sau đó vẫn SELECT lại. Id không còn User ⇒ ghi None, khỏi hỏi lại."""
        if not hasattr(self, "_ten_nap"):
            self._ten_nap = {}
        ids = {int(u) for u in user_ids if u} - set(self._ten_nap)
        if ids:
            gap = self.users.map_by_ids(ids)
            for i in ids:
                u = gap.get(i)
                self._ten_nap[i] = u.name if u is not None else None

    def _voucher_out(self, row: PaymentVoucher) -> dict:
        purchase = row.purchase_request
        source_codes = [
            link.department_request.code if link.department_request else link.source_code_snapshot
            for link in purchase.sources
        ] if purchase else []
        purchase_total = self._purchase_total(purchase) if purchase else None
        # Tổng ĐÃ CHI của cả PMH (mọi phiếu chi anh em) — hiện trên dải nhóm.
        purchase_paid_amount = (
            sum(
                int(k.amount_vnd)
                for k in purchase.khoan_chi
                if k.status == PAYMENT_VOUCHER_PAID
            )
            if purchase
            else None
        )
        # Bảng phân bổ (17/10/2026). Phiếu gộp: đầu phiếu không nguồn, đọc đơn/đợt ở đây.
        dong = []
        for k in row.lines:
            don = k.purchase_request
            dong.append({
                "purchase_request_id": k.purchase_request_id,
                "purchase_code": don.code if don else None,
                "delivery_id": k.delivery_id,
                "delivery_seq_no": next(
                    (d.seq_no for d in (don.deliveries if don else []) if d.id == k.delivery_id), None
                ),
                "invoice_number": next(
                    (d.invoice_number for d in (don.deliveries if don else []) if d.id == k.delivery_id), None
                ),
                "amount": int(k.amount_vnd),
                "purchase_created_by_user_id": don.created_by_user_id if don else None,
            })
        receipt_received_amount = sum(
            int(receipt.amount_vnd)
            for receipt in row.receipts
            if receipt.status == PAYMENT_RECEIPT_RECEIVED
        )
        receipt_pending_amount = sum(
            int(receipt.amount_vnd)
            for receipt in row.receipts
            if receipt.status == PAYMENT_RECEIPT_WAITING
        )
        return {
            "id": row.id,
            "code": row.code,
            "doc_no": row.doc_no,
            "muc_thu_chi_id": row.muc_thu_chi_id,
            "muc_thu_chi_ten": ten_muc_phieu("chi", row.source_type or VOUCHER_SOURCE_PURCHASE,
                                             row.muc_thu_chi),
            "customer_id": row.customer_id,
            "customer_name": row.customer.name if row.customer else None,
            "order_id": row.order_id,
            "order_code": row.order.order_no if row.order_id is not None and row.order else None,
            "debit_account": row.debit_account,
            "credit_account": row.credit_account,
            "source_type": row.source_type or VOUCHER_SOURCE_PURCHASE,
            "salary_advance_id": row.salary_advance_id,
            "gia_cong_ngoai_id": row.gia_cong_ngoai_id,
            "receipt_received_amount": receipt_received_amount,
            "receipt_pending_amount": receipt_pending_amount,
            "attachment_count": len(row.attachments),
            "lines": dong,
            # Đợt giao mà phiếu này trả cho. NULL = phiếu đặt cọc (hoặc phiếu cũ trước 06/08/2026,
            # khi chưa có khái niệm đợt giao) — màn hình hiện "cả đơn" cho hai ca đó.
            "delivery_id": getattr(row, "delivery_id", None),
            "delivery_seq_no": next(
                (
                    d.seq_no
                    for d in (purchase.deliveries if purchase else [])
                    if d.id == getattr(row, "delivery_id", None)
                ),
                None,
            ),
            "purchase_request_id": row.purchase_request_id,
            "purchase_request_code": purchase.code if purchase else row.source_code_snapshot,
            "purchase_request_total": purchase_total,
            "purchase_paid_amount": purchase_paid_amount,
            # Người phụ trách mua (lập PMH) — mặc định "Người nộp tiền" của phiếu thu.
            "purchase_created_by_user_id": (
                purchase.created_by_user_id if purchase else None
            ),
            "purchase_created_by_name": (
                self._user_name(purchase.created_by_user_id) if purchase else None
            ),
            "source_request_codes": source_codes,
            "supplier_id": row.supplier_id,
            "supplier_name": row.supplier_name_snapshot,
            "supplier_tax_code": row.supplier_tax_code_snapshot,
            "supplier_address": row.supplier_address_snapshot,
            "voucher_type": row.voucher_type,
            "payment_stage": row.payment_stage,
            "status": row.status,
            "voucher_date": row.voucher_date,
            "planned_payment_date": row.planned_payment_date,
            "amount": int(row.amount),
            "amount_vnd": int(row.amount_vnd),
            "currency": row.currency,
            "exchange_rate": float(row.exchange_rate),
            "content": row.content,
            "invoice_number": row.invoice_number,
            "invoice_date": row.invoice_date,
            "contract_number": row.contract_number,
            "company_bank_account_id": row.company_bank_account_id,
            "supplier_bank_account_id": row.supplier_bank_account_id,
            "cash_recipient_name": row.cash_recipient_name,
            "cash_recipient_address": row.cash_recipient_address,
            "cash_recipient_identity": row.cash_recipient_identity,
            "bank_fee_bearer": row.bank_fee_bearer,
            "bank_reference": row.bank_reference,
            "company_account_holder": row.company_account_holder_snapshot,
            "company_account_number": row.company_account_number_snapshot,
            "company_bank_name": row.company_bank_name_snapshot,
            "company_bank_branch": row.company_bank_branch_snapshot,
            "beneficiary_account_holder": row.beneficiary_account_holder_snapshot,
            "beneficiary_account_number": row.beneficiary_account_number_snapshot,
            "beneficiary_bank_name": row.beneficiary_bank_name_snapshot,
            "beneficiary_bank_branch": row.beneficiary_bank_branch_snapshot,
            "created_by_user_id": row.created_by_user_id,
            "created_by_name": self._user_name(row.created_by_user_id),
            "paid_by_user_id": row.paid_by_user_id,
            "paid_by_name": self._user_name(row.paid_by_user_id),
            "paid_at": row.paid_at,
            "cancelled_by_user_id": row.cancelled_by_user_id,
            "cancelled_by_name": self._user_name(row.cancelled_by_user_id),
            "cancelled_at": row.cancelled_at,
            "cancel_reason": row.cancel_reason,
            "note": row.note,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }
