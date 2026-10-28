"""Data access for operational accounting and purchase payments."""
from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy import (
    MetaData, Table, and_, asc, case, desc, false, func, inspect, or_, select, update,
)
from sqlalchemy.orm import Session, selectinload

from ..models.accounting import (
    PAYMENT_RECEIPT_CANCELLED,
    PAYMENT_RECEIPT_RECEIVED,
    PAYMENT_RECEIPT_WAITING,
    PAYMENT_VOUCHER_CANCELLED,
    PAYMENT_VOUCHER_PAID,
    RECEIPT_SOURCE_ORDER,
    RECEIPT_SOURCE_PURCHASE,
    SALES_INVOICE_CANCELLED,
    SALES_INVOICE_ISSUED,
    VOUCHER_SOURCE_CUSTOMER_REFUND,
    VOUCHER_SOURCE_GIA_CONG,
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
from ..models.customer import Customer, CustomerContact
from ..models.muc_thu_chi import MUC_CO_DINH, NGUON_CO_DINH_CHI, NGUON_CO_DINH_THU
from .customer_repo import CustomerRepository
from .loc_danh_sach import dk_khoang_ngay
from ..models.payroll import SalaryAdvance
from ..models.order import Order
from ..models.purchase import PurchaseDelivery, PurchaseRequest, PurchaseRequestSource, Supplier


_VOUCHER_SORTABLE = {
    "code": PaymentVoucher.code,
    "status": PaymentVoucher.status,
    "voucher_date": PaymentVoucher.voucher_date,
    "amount": PaymentVoucher.amount_vnd,
    "created_at": PaymentVoucher.created_at,
}

_RECEIPT_SORTABLE = {
    "code": PaymentReceipt.code,
    "status": PaymentReceipt.status,
    "amount": PaymentReceipt.amount_vnd,
    "receipt_date": PaymentReceipt.receipt_date,
    "created_at": PaymentReceipt.created_at,
}


#: Quá số id này thì đọc cả bảng (vài cột) rồi lọc bằng Python thay vì `IN (...)`: biên dịch một
#: IN-list hàng chục nghìn tham số tốn hơn đọc thẳng bảng.
_IN_LIST_TOI_DA = 2000


def _loc_id(stmt, cot, ids):
    """Gắn `cot IN ids` vào `stmt`, trừ khi tập quá `_IN_LIST_TOI_DA` — khi đó trả kèm tập để người
    gọi lọc dòng kết quả bằng Python (câu chạy trên cả bảng, thường là SUM ... GROUP BY rẻ). Trả
    `(stmt, tap_loc | None)`."""
    tap = {int(i) for i in ids if i is not None}
    if len(tap) > _IN_LIST_TOI_DA:
        return stmt, tap
    return stmt.where(cot.in_(tap)), None

#: Cột LÕI của BẢN NHẸ phiếu thu cho sổ công nợ (`phieu_thu_cho_bao_cao`) — tiền, ngày, truy
#: khách / NCC. Cùng tên thuộc tính ORM.
_COT_PHIEU_THU_LOI = (
    "id", "source_type", "payment_voucher_id", "order_id", "sales_invoice_id", "supplier_id",
    "customer_id", "customer_name_snapshot", "supplier_name_snapshot", "receipt_date", "amount_vnd",
)

#: Cột MẶT PHIẾU — chỉ sổ chi tiết in ra (số, diễn giải, giờ, TK đối ứng).
_COT_PHIEU_THU_MAT = (
    "code", "content", "receipt_method", "company_bank_account_id", "company_bank_name_snapshot",
    "company_account_number_snapshot", "received_at", "created_at",
)

#: Cột của BẢN NHẸ hoá đơn bán (`hoa_don_phat_hanh_nhe`) — cùng tên thuộc tính ORM.
_COT_HOA_DON_NHE = (
    "id", "order_id", "customer_id", "invoice_symbol", "invoice_number", "invoice_date",
    "amount_vnd", "payment_term_days_snapshot", "due_date", "customer_name_snapshot", "status",
    "created_at", "chiet_khau", "ke_gia", "ke_thue_tndn",
)


def _loc_muc(bang, loai: str, muc: list[int]):
    """Lọc theo mục thu chi. Id dương = mục tự khai; id âm = mục CỐ ĐỊNH (lọc theo nguồn phiếu);
    `0` = chưa phân loại (phiếu lập tay chưa có mục)."""
    co_dinh = tuple(m["nguon"] for m in MUC_CO_DINH if m["id"] in muc and m["loai"] == loai)
    nguon_cd = NGUON_CO_DINH_CHI if loai == "chi" else NGUON_CO_DINH_THU
    ids = [m for m in muc if m > 0]
    dk = [bang.muc_thu_chi_id.in_(ids)] if ids else []
    if co_dinh:
        dk.append(bang.source_type.in_(co_dinh))
    if 0 in muc:
        dk.append(and_(bang.muc_thu_chi_id.is_(None), bang.source_type.not_in(nguon_cd)))
    return or_(*dk) if dk else false()


class AccountingRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    # --- company bank accounts -------------------------------------------

    def list_company_accounts(
        self,
        *,
        active_only: bool = False,
        usage: str | None = None,
        ngan_hang: str | None = None,
        trang_thai: str | None = None,
    ) -> list[CompanyBankAccount]:
        stmt = select(CompanyBankAccount)
        if active_only or trang_thai == "dang_dung":
            stmt = stmt.where(CompanyBankAccount.is_active.is_(True))
        elif trang_thai == "ngung":
            stmt = stmt.where(CompanyBankAccount.is_active.is_(False))
        if ngan_hang:
            stmt = stmt.where(CompanyBankAccount.bank_name == ngan_hang)
        if usage == "receive":
            stmt = stmt.where(CompanyBankAccount.use_for_receipts.is_(True))
        elif usage == "pay":
            stmt = stmt.where(CompanyBankAccount.use_for_payments.is_(True))
        return list(
            self.db.execute(
                stmt.order_by(CompanyBankAccount.is_default.desc(), CompanyBankAccount.bank_name, CompanyBankAccount.id)
            ).scalars()
        )

    def dem_tai_khoan_theo_ngan_hang(self) -> list[tuple[str, int]]:
        stmt = (
            select(CompanyBankAccount.bank_name, func.count())
            .group_by(CompanyBankAccount.bank_name)
            .order_by(CompanyBankAccount.bank_name)
        )
        return [(t, int(n)) for t, n in self.db.execute(stmt).all()]

    def get_company_account(self, account_id: int) -> CompanyBankAccount | None:
        return self.db.get(CompanyBankAccount, account_id)

    def save_company_account(
        self, account: CompanyBankAccount, *, make_default: bool = False
    ) -> CompanyBankAccount:
        if make_default:
            self.db.execute(
                update(CompanyBankAccount)
                .where(CompanyBankAccount.id != (account.id or -1))
                .values(is_default=False)
            )
            account.is_default = True
        self.db.add(account)
        self._commit()
        self.db.refresh(account)
        return account

    def company_account_count(self) -> int:
        return self.db.execute(select(func.count()).select_from(CompanyBankAccount)).scalar_one()

    # --- supplier bank accounts ------------------------------------------

    def list_supplier_accounts(
        self, *, supplier_id: int | None = None, active_only: bool = False
    ) -> list[SupplierBankAccount]:
        stmt = select(SupplierBankAccount).options(selectinload(SupplierBankAccount.supplier))
        if supplier_id is not None:
            stmt = stmt.where(SupplierBankAccount.supplier_id == supplier_id)
        if active_only:
            stmt = stmt.where(SupplierBankAccount.is_active.is_(True))
        return list(
            self.db.execute(
                stmt.order_by(
                    SupplierBankAccount.supplier_id,
                    SupplierBankAccount.is_default.desc(),
                    SupplierBankAccount.bank_name,
                    SupplierBankAccount.id,
                )
            ).scalars()
        )

    def get_supplier_account(self, account_id: int) -> SupplierBankAccount | None:
        return self.db.execute(
            select(SupplierBankAccount)
            .options(selectinload(SupplierBankAccount.supplier))
            .where(SupplierBankAccount.id == account_id)
        ).scalars().first()

    def save_supplier_account(
        self, account: SupplierBankAccount, *, make_default: bool = False
    ) -> SupplierBankAccount:
        if make_default:
            self.db.execute(
                update(SupplierBankAccount)
                .where(
                    SupplierBankAccount.supplier_id == account.supplier_id,
                    SupplierBankAccount.id != (account.id or -1),
                )
                .values(is_default=False)
            )
            account.is_default = True
        self.db.add(account)
        self._commit()
        self.db.refresh(account)
        return self.get_supplier_account(account.id) or account

    def supplier_account_count(self, supplier_id: int) -> int:
        return self.db.execute(
            select(func.count())
            .select_from(SupplierBankAccount)
            .where(SupplierBankAccount.supplier_id == supplier_id)
        ).scalar_one()

    # --- vouchers ---------------------------------------------------------

    def get_voucher(self, voucher_id: int) -> PaymentVoucher | None:
        return self.db.execute(self._voucher_stmt().where(PaymentVoucher.id == voucher_id)).scalars().first()

    def tong_chi_dot_truoc_phieu(self, delivery_id: int, voucher_id: int) -> int:
        """Σ tiền các phiếu chi ĐÃ CHI trả cho đợt giao này, lập TRƯỚC phiếu `voucher_id`
        (id nhỏ hơn). Không tính chính phiếu đó."""
        return int(
            self.db.execute(
                select(func.coalesce(func.sum(PaymentVoucherLine.amount_vnd), 0))
                .join(PaymentVoucher, PaymentVoucher.id == PaymentVoucherLine.payment_voucher_id)
                .where(
                    PaymentVoucherLine.delivery_id == delivery_id,
                    PaymentVoucher.status == PAYMENT_VOUCHER_PAID,
                    PaymentVoucher.id < voucher_id,
                )
            ).scalar_one()
        )

    def tong_thu_hoa_don_truoc_phieu(self, sales_invoice_id: int, receipt_id: int) -> int:
        """Σ tiền các phiếu thu ĐÃ THU gắn hoá đơn này, lập TRƯỚC phiếu `receipt_id`."""
        return int(
            self.db.execute(
                select(func.coalesce(func.sum(PaymentReceiptLine.amount_vnd), 0))
                .join(PaymentReceipt, PaymentReceipt.id == PaymentReceiptLine.payment_receipt_id)
                .where(
                    PaymentReceiptLine.sales_invoice_id == sales_invoice_id,
                    PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED,
                    PaymentReceipt.id < receipt_id,
                )
            ).scalar_one()
        )

    def get_voucher_by_salary_advance(self, salary_advance_id: int):
        """Phiếu chi đã lập cho một phiếu tạm ứng — None nếu chưa lập.

        Dùng ở HAI chỗ: chặn lập phiếu chi lần hai, và chặn huỷ phiếu tạm ứng khi tiền đã ra."""
        return self.live_vouchers_by_salary_advance_ids([salary_advance_id]).get(int(salary_advance_id))

    def live_vouchers_by_salary_advance_ids(self, ids) -> dict[int, PaymentVoucher]:
        """`{salary_advance_id: phiếu chi CÒN HIỆU LỰC}` cho nhiều phiếu tạm ứng — một lượt thay vì
        hỏi từng phiếu (màn Tạm ứng gắn mã PC lên dòng, file chuyển khoản, chi một lượt)."""
        ids = sorted({int(i) for i in ids})
        out: dict[int, PaymentVoucher] = {}
        for i in range(0, len(ids), 500):
            phan = ids[i:i + 500]
            # 1) Cột `salary_advances.payment_voucher_id` — phiếu chi một lượt (nhiều tạm ứng → một
            #    phiếu chi, 25/09/2026) và mọi phiếu lập từ đó về sau.
            for aid, v in self.db.execute(
                select(SalaryAdvance.id, PaymentVoucher)
                .join(PaymentVoucher, PaymentVoucher.id == SalaryAdvance.payment_voucher_id)
                .where(SalaryAdvance.id.in_(phan),
                       PaymentVoucher.status != PAYMENT_VOUCHER_CANCELLED)
            ).all():
                out[int(aid)] = v
            # 2) Phiếu chi một-một cũ (`payment_vouchers.salary_advance_id`) — mg 0337 đã gắn ngược,
            #    giữ nhánh này cho phiếu lập trước khi có cột.
            con = [aid for aid in phan if aid not in out]
            if con:
                for v in self.db.execute(
                    select(PaymentVoucher).where(
                        PaymentVoucher.salary_advance_id.in_(con),
                        PaymentVoucher.status != PAYMENT_VOUCHER_CANCELLED,
                    )
                ).scalars():
                    out[int(v.salary_advance_id)] = v
        return out

    def add_vouchers(self, vouchers: list[PaymentVoucher]) -> None:
        """Thêm nhiều phiếu chi, CHỈ flush — người gọi `commit()` cả lượt (chi một lượt)."""
        self.db.add_all(vouchers)
        self.db.flush()

    def get_vouchers_by_ids(self, ids) -> list[PaymentVoucher]:
        ids = sorted({int(i) for i in ids})
        out: list[PaymentVoucher] = []
        for i in range(0, len(ids), 500):
            out += self.db.execute(
                self._voucher_stmt().where(PaymentVoucher.id.in_(ids[i:i + 500]))
            ).scalars().all()
        return out

    def commit(self) -> None:
        self._commit()

    def get_voucher_by_code(self, code: str) -> PaymentVoucher | None:
        return self.db.execute(
            select(PaymentVoucher).where(PaymentVoucher.code == code)
        ).scalars().first()

    def _dieu_kien_phieu_chi(
        self,
        *,
        q: str | None = None,
        source_type: str | None = None,
        voucher_type: str | None = None,
        supplier_id: int | None = None,
        purchase_request_id: int | None = None,
        tu_ngay: date | None = None,
        den_ngay: date | None = None,
        tien_tu: int | None = None,
        tien_den: int | None = None,
        nguon: list[str] | None = None,
        muc: list[int] | None = None,
        tai_khoan_id: int | None = None,
        nguoi_lap_id: int | None = None,
        nhan: str | None = None,
        moc: str = "chi",
    ) -> list:
        """Điều kiện lọc CHUNG cho bảng, số đếm thẻ lọc và tổng tiền — một nguồn, không ba chỗ tự lọc.

        KHÔNG gồm `status`: đó là thẻ lọc, thẻ phải đếm trên nền CHƯA chọn thẻ
        (chọn "Đã huỷ" mà các thẻ còn lại về 0 thì người dùng không còn thấy đường quay lại)."""
        c = []
        if q:
            like = f"%{q.strip().lower()}%"
            c.append(
                or_(
                    func.lower(PaymentVoucher.code).like(like),
                    func.lower(func.coalesce(PaymentVoucher.doc_no, "")).like(like),
                    func.lower(PaymentVoucher.source_code_snapshot).like(like),
                    func.lower(PaymentVoucher.supplier_name_snapshot).like(like),
                    func.lower(func.coalesce(PaymentVoucher.cash_recipient_name, "")).like(like),
                    func.lower(func.coalesce(PaymentVoucher.beneficiary_account_holder_snapshot, "")).like(like),
                    func.lower(PaymentVoucher.content).like(like),
                    # Mã đơn tìm qua DÒNG phân bổ — phiếu gộp nhiều đơn cũng ra (17/10/2026).
                    PaymentVoucher.lines.any(
                        PaymentVoucherLine.purchase_request.has(func.lower(PurchaseRequest.code).like(like))
                    ),
                    PaymentVoucher.lines.any(
                        PaymentVoucherLine.purchase_request.has(
                            PurchaseRequest.sources.any(
                                func.lower(PurchaseRequestSource.source_code_snapshot).like(like)
                            )
                        )
                    ),
                )
            )
        if source_type:
            c.append(PaymentVoucher.source_type == source_type)
        if nguon:
            c.append(PaymentVoucher.source_type.in_(list(nguon)))
        if muc:
            c.append(_loc_muc(PaymentVoucher, "chi", muc))
        if voucher_type:
            c.append(PaymentVoucher.voucher_type == voucher_type)
        if supplier_id is not None:
            c.append(PaymentVoucher.supplier_id == supplier_id)
        if purchase_request_id is not None:
            c.append(PaymentVoucher.lines.any(PaymentVoucherLine.purchase_request_id == purchase_request_id))
        # Kỳ tính theo mốc (06/10/2026): `chi` = ngày chi trên chứng từ (Date), `tao` = lúc lập phiếu
        # (mốc giờ UTC — ranh ngày theo giờ VN).
        if moc == "tao":
            c.extend(dk_khoang_ngay(PaymentVoucher.created_at, tu_ngay, den_ngay))
        else:
            c.extend(dk_khoang_ngay(PaymentVoucher.voucher_date, tu_ngay, den_ngay, cot_ngay=True))
        if tien_tu is not None:
            c.append(PaymentVoucher.amount_vnd >= tien_tu)
        if tien_den is not None:
            c.append(PaymentVoucher.amount_vnd <= tien_den)
        if tai_khoan_id is not None:
            c.append(PaymentVoucher.company_bank_account_id == tai_khoan_id)
        if nguoi_lap_id is not None:
            c.append(PaymentVoucher.created_by_user_id == nguoi_lap_id)
        if (nhan or "").strip():
            # Ô lọc "Người nhận" của bộ lọc nâng cao — RIÊNG với ô tìm `q` (q còn so mã, nội dung,
            # mã đơn): chỉ so tên người nhận tiền mặt, chủ tài khoản nhận, nhà cung cấp. Đi cùng `q` là AND.
            like_nhan = f"%{nhan.strip().lower()}%"
            c.append(
                or_(
                    func.lower(func.coalesce(PaymentVoucher.cash_recipient_name, "")).like(like_nhan),
                    func.lower(func.coalesce(PaymentVoucher.beneficiary_account_holder_snapshot, "")).like(like_nhan),
                    func.lower(func.coalesce(PaymentVoucher.supplier_name_snapshot, "")).like(like_nhan),
                )
            )
        return c

    def _the_loc_chi(self, nen: list) -> dict:
        """Số trên hàng thẻ lọc: đếm trên nền đã lọc kỳ + bộ lọc nâng cao nhưng CHƯA chọn thẻ.
        Đếm "Thiếu chứng từ" gỡ 18/10/2026 cùng điều kiện lọc Chứng từ."""
        da_chi = PaymentVoucher.status == PAYMENT_VOUCHER_PAID
        stmt = select(
            func.count(),
            func.coalesce(func.sum(case((da_chi, 1), else_=0)), 0),
            func.coalesce(func.sum(case((da_chi, PaymentVoucher.amount_vnd), else_=0)), 0),
            func.coalesce(func.sum(case((PaymentVoucher.status == PAYMENT_VOUCHER_CANCELLED, 1), else_=0)), 0),
        ).select_from(PaymentVoucher)
        for dk in nen:
            stmt = stmt.where(dk)
        tat_ca, xong, xong_tien, huy = self.db.execute(stmt).one()
        return {
            "tat_ca": int(tat_ca),
            "xong": int(xong),
            "xong_tien": int(xong_tien),
            "da_huy": int(huy),
            "cho": int(tat_ca) - int(xong) - int(huy),
        }

    def list_vouchers(
        self,
        *,
        q: str | None = None,
        status: str | None = None,
        source_type: str | None = None,
        voucher_type: str | None = None,
        supplier_id: int | None = None,
        purchase_request_id: int | None = None,
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
        moc: str = "chi",
        dem_only: bool = False,
        sort: str = "-created_at",
        page: int = 1,
        size: int = 20,
    ) -> tuple[list[PaymentVoucher], int, dict]:
        nen = self._dieu_kien_phieu_chi(
            q=q, source_type=source_type, voucher_type=hinh_thuc or voucher_type,
            supplier_id=supplier_id, purchase_request_id=purchase_request_id,
            tu_ngay=tu_ngay, den_ngay=den_ngay, tien_tu=tien_tu, tien_den=tien_den,
            nguon=nguon, muc=muc, tai_khoan_id=tai_khoan_id, nguoi_lap_id=nguoi_lap_id, nhan=nhan, moc=moc,
        )
        conditions = list(nen)
        if status:
            conditions.append(PaymentVoucher.status == status)

        stmt = self._voucher_stmt()
        count_stmt = select(func.count()).select_from(PaymentVoucher)
        for condition in conditions:
            stmt = stmt.where(condition)
            count_stmt = count_stmt.where(condition)

        total = self.db.execute(count_stmt).scalar_one()
        if dem_only:
            # Chỉ cần "Khớp n phiếu" khi người dùng đang chỉnh bộ lọc — khỏi kéo hàng + tổng tiền.
            return [], total, {}
        direction = asc
        key = sort or "-created_at"
        if key.startswith("-"):
            direction = desc
            key = key[1:]
        if key == "group":
            # Gom phiếu cùng PMH đứng cạnh nhau; nhóm có phiếu MỚI NHẤT lên đầu
            # (vừa chi bổ sung cho PMH cũ → cả nhóm nổi lên trang 1), trong nhóm
            # đọc theo trình tự lập: tạm ứng → bổ sung → quyết toán.
            #
            # KHÔNG MÀN NÀO ĐANG GỌI (27/08/2026): màn Phiếu chi đã đổi sang `-created_at` vì kiểu
            # gom này khiến cả bảng trông như chưa sắp xếp — bên trong nhóm xếp TĂNG DẦN nên phiếu
            # 10/8 nằm trên cả 19/8 lẫn 27/8. Giữ nhánh + test cho ai muốn bật lại.
            #
            # `-id` cho phiếu KHÔNG thuộc PMH nào (chi phí nội bộ, tạm ứng lương, UNC độc lập):
            # mỗi phiếu tự làm một nhóm. Partition thẳng theo cột nullable là SQL gom MỌI phiếu
            # `purchase_request_id IS NULL` vào CHUNG một nhóm dù chúng chẳng liên quan gì nhau —
            # nhóm ma đó nổi lên đầu trang rồi lôi theo phiếu cũ nhất lên trên cùng.
            # Dùng `-id` để không bao giờ đụng một `purchase_request_id` thật (luôn dương).
            khoa_nhom = func.coalesce(PaymentVoucher.purchase_request_id, -PaymentVoucher.id)
            latest_in_group = func.max(PaymentVoucher.created_at).over(partition_by=khoa_nhom)
            stmt = stmt.order_by(
                direction(latest_in_group),
                direction(khoa_nhom),
                PaymentVoucher.created_at.asc(),
                PaymentVoucher.id.asc(),
            )
        else:
            stmt = stmt.order_by(
                direction(_VOUCHER_SORTABLE.get(key, PaymentVoucher.created_at)),
                PaymentVoucher.id.desc(),
            )
        page = max(1, page)
        size = max(1, min(size, 200))
        rows = list(self.db.execute(stmt.offset((page - 1) * size).limit(size)).scalars())
        return rows, total, {**self._voucher_totals(conditions), "the_loc": self._the_loc_chi(nen)}

    def _voucher_totals(self, conditions) -> dict:
        """Tổng tiền trên TOÀN BỘ kết quả khớp bộ lọc (không chỉ trang hiện tại) —
        kế toán chi nhiều đợt không phải cộng tay.

        `total_waiting_amount` giữ lại và luôn = 0 kể từ khi bỏ trạng thái "Chờ chi" (06/08/2026):
        phiếu cũ đã được migration `0169` chuyển hết sang `paid`, và không đường nào sinh phiếu
        `waiting` nữa. Giữ khoá để hợp đồng API không vỡ, KHÔNG giữ phép cộng — cộng một thứ luôn
        rỗng chỉ tốn một lần quét bảng mỗi lần mở màn."""
        sums_stmt = select(
            func.coalesce(
                func.sum(
                    case(
                        (PaymentVoucher.status == PAYMENT_VOUCHER_PAID, PaymentVoucher.amount_vnd),
                        else_=0,
                    )
                ),
                0,
            ),
        ).select_from(PaymentVoucher)
        receipts_stmt = (
            select(func.coalesce(func.sum(PaymentReceipt.amount_vnd), 0))
            .join(PaymentVoucher, PaymentReceipt.payment_voucher_id == PaymentVoucher.id)
            .where(PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED)
        )
        for condition in conditions:
            sums_stmt = sums_stmt.where(condition)
            receipts_stmt = receipts_stmt.where(condition)
        (paid_sum,) = self.db.execute(sums_stmt).one()
        received_sum = self.db.execute(receipts_stmt).scalar_one()
        return {
            "total_paid_amount": int(paid_sum),
            "total_waiting_amount": 0,
            "total_receipt_received_amount": int(received_sum),
        }

    # `reserved_amount` ĐÃ GỠ 06/08/2026: trần lập phiếu chi nay tính trong `purchase_money`
    # (`outstanding_amount` / `tran_dat_coc`) trên đúng tập quan hệ đã eager-load, nên không cần
    # query riêng — và quan trọng hơn: một nguồn số, không phải hai chỗ tự cộng lấy.

    # --- payment receipts ---------------------------------------------------

    def _dieu_kien_phieu_thu(
        self,
        *,
        q: str | None = None,
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
    ) -> list:
        """Điều kiện lọc CHUNG của phiếu thu (bảng + số thẻ lọc + tổng đã thu). KHÔNG gồm `status`
        — xem `_dieu_kien_phieu_chi`."""
        conditions = []
        if source_type is not None:
            conditions.append(PaymentReceipt.source_type == source_type)
        if nguon:
            conditions.append(PaymentReceipt.source_type.in_(list(nguon)))
        if muc:
            conditions.append(_loc_muc(PaymentReceipt, "thu", muc))
        if hinh_thuc:
            conditions.append(PaymentReceipt.receipt_method == hinh_thuc)
        # Kỳ theo mốc: `thu` = ngày thu trên chứng từ (Date), `tao` = lúc lập phiếu (giờ VN).
        if moc == "tao":
            conditions.extend(dk_khoang_ngay(PaymentReceipt.created_at, tu_ngay, den_ngay))
        else:
            conditions.extend(dk_khoang_ngay(PaymentReceipt.receipt_date, tu_ngay, den_ngay, cot_ngay=True))
        if tien_tu is not None:
            conditions.append(PaymentReceipt.amount_vnd >= tien_tu)
        if tien_den is not None:
            conditions.append(PaymentReceipt.amount_vnd <= tien_den)
        if tai_khoan_id is not None:
            conditions.append(PaymentReceipt.company_bank_account_id == tai_khoan_id)
        if nguoi_lap_id is not None:
            conditions.append(PaymentReceipt.created_by_user_id == nguoi_lap_id)
        if payment_voucher_id is not None:
            conditions.append(PaymentReceipt.payment_voucher_id == payment_voucher_id)
        if q:
            like = f"%{q.strip().lower()}%"
            conditions.append(
                or_(
                    func.lower(PaymentReceipt.code).like(like),
                    func.lower(func.coalesce(PaymentReceipt.doc_no, "")).like(like),
                    func.lower(PaymentReceipt.voucher_code_snapshot).like(like),
                    func.lower(PaymentReceipt.purchase_code_snapshot).like(like),
                    func.lower(PaymentReceipt.supplier_name_snapshot).like(like),
                    func.lower(PaymentReceipt.order_no_snapshot).like(like),
                    func.lower(PaymentReceipt.customer_name_snapshot).like(like),
                    PaymentReceipt.lines.any(PaymentReceiptLine.sales_invoice.has(
                        func.lower(SalesInvoice.invoice_number).like(like)
                    )),
                    PaymentReceipt.lines.any(PaymentReceiptLine.order.has(
                        func.lower(Order.order_no).like(like)
                    )),
                    func.lower(PaymentReceipt.payer_name).like(like),
                    func.lower(PaymentReceipt.content).like(like),
                )
            )
        if (nhan or "").strip():
            # Ô lọc "Người nộp" — RIÊNG với ô tìm `q` (q còn so mã, nội dung, số hoá đơn): chỉ so tên
            # người nộp. Đi cùng `q` là AND (cùng luật với "Người nhận" của phiếu chi).
            like_nhan = f"%{nhan.strip().lower()}%"
            conditions.append(func.lower(PaymentReceipt.payer_name).like(like_nhan))
        return conditions

    def _the_loc_thu(self, nen: list) -> dict:
        """Số trên hàng thẻ lọc phiếu thu: nền đã lọc kỳ + bộ lọc nâng cao, CHƯA chọn thẻ.
        `xong` = đã thu, `cho` = chờ thu (phần còn lại sau khi trừ đã thu và đã huỷ)."""
        da_thu = PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED
        stmt = select(
            func.count(),
            func.coalesce(func.sum(case((da_thu, 1), else_=0)), 0),
            func.coalesce(func.sum(case((da_thu, PaymentReceipt.amount_vnd), else_=0)), 0),
            func.coalesce(func.sum(case((PaymentReceipt.status == PAYMENT_RECEIPT_CANCELLED, 1), else_=0)), 0),
        ).select_from(PaymentReceipt)
        for dk in nen:
            stmt = stmt.where(dk)
        tat_ca, xong, xong_tien, huy = self.db.execute(stmt).one()
        return {
            "tat_ca": int(tat_ca),
            "xong": int(xong),
            "xong_tien": int(xong_tien),
            "da_huy": int(huy),
            "cho": int(tat_ca) - int(xong) - int(huy),
        }

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
    ) -> tuple[list[PaymentReceipt], int, dict]:
        nen = self._dieu_kien_phieu_thu(
            q=q, payment_voucher_id=payment_voucher_id, source_type=source_type,
            tu_ngay=tu_ngay, den_ngay=den_ngay, tien_tu=tien_tu, tien_den=tien_den,
            hinh_thuc=hinh_thuc, nguon=nguon, muc=muc, tai_khoan_id=tai_khoan_id, nguoi_lap_id=nguoi_lap_id,
            nhan=nhan, moc=moc,
        )
        conditions = list(nen)
        if status:
            conditions.append(PaymentReceipt.status == status)

        stmt = self._receipt_stmt()
        count_stmt = select(func.count()).select_from(PaymentReceipt)
        for condition in conditions:
            stmt = stmt.where(condition)
            count_stmt = count_stmt.where(condition)

        total = self.db.execute(count_stmt).scalar_one()
        if dem_only:
            return [], total, {}
        direction = asc
        key = sort or "-created_at"
        if key.startswith("-"):
            direction = desc
            key = key[1:]
        stmt = stmt.order_by(
            direction(_RECEIPT_SORTABLE.get(key, PaymentReceipt.created_at)),
            PaymentReceipt.id.desc(),
        )
        page = max(1, page)
        size = max(1, min(size, 200))
        rows = list(self.db.execute(stmt.offset((page - 1) * size).limit(size)).scalars())
        tong_stmt = select(func.coalesce(func.sum(PaymentReceipt.amount_vnd), 0)).where(
            PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED
        )
        for condition in conditions:
            tong_stmt = tong_stmt.where(condition)
        tong_da_thu = int(self.db.execute(tong_stmt).scalar_one())
        return rows, total, {
            "total_received_amount": tong_da_thu,
            "the_loc": self._the_loc_thu(nen),
        }

    def get_receipt(self, receipt_id: int) -> PaymentReceipt | None:
        return self.db.execute(
            self._receipt_stmt().where(PaymentReceipt.id == receipt_id)
        ).scalar_one_or_none()

    def get_receipt_by_code(self, code: str) -> PaymentReceipt | None:
        return self.db.execute(
            select(PaymentReceipt).where(PaymentReceipt.code == code)
        ).scalar_one_or_none()

    def receipt_reserved_amount(self, payment_voucher_id: int, *, exclude_id: int | None = None) -> int:
        """Tổng thu đang chiếm chỗ trên một phiếu chi (chờ thu + đã thu)."""
        stmt = select(func.coalesce(func.sum(PaymentReceipt.amount_vnd), 0)).where(
            PaymentReceipt.payment_voucher_id == payment_voucher_id,
            PaymentReceipt.status.in_((PAYMENT_RECEIPT_WAITING, PAYMENT_RECEIPT_RECEIVED)),
        )
        if exclude_id is not None:
            stmt = stmt.where(PaymentReceipt.id != exclude_id)
        return int(self.db.execute(stmt).scalar_one())

    def receipt_received_amount(self, purchase_request_id: int) -> int:
        stmt = select(func.coalesce(func.sum(PaymentReceipt.amount_vnd), 0)).where(
            PaymentReceipt.purchase_request_id == purchase_request_id,
            PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED,
        )
        return int(self.db.execute(stmt).scalar_one())

    def receipt_received_sum_for_order(self, order_id: int) -> int:
        """Σ phiếu thu ĐÃ THU của một đơn bán (cổng chốt đơn đọc số này)."""
        return self.received_deposit_sum(order_id)

    def list_receipts_for_order(self, order_id: int) -> list[PaymentReceipt]:
        """Các phiếu thu (mọi trạng thái) của một đơn bán, mới nhất trước."""
        stmt = (
            self._receipt_stmt()
            .where(PaymentReceipt.lines.any(
                (PaymentReceiptLine.order_id == order_id) & PaymentReceiptLine.sales_invoice_id.is_(None)
            ))
            .order_by(PaymentReceipt.created_at.desc())
        )
        return list(self.db.execute(stmt).scalars().all())

    # --- Cầu nối cho module Đơn hàng (erp V5) — cọc = phiếu thu source=order --
    # order_service (bản erp) đọc cọc qua 3 hàm này; giữ ĐÚNG ngữ nghĩa erp (lọc theo
    # source_type=order, dùng `amount`, list theo id tăng dần) để không phải sửa order_service.
    def received_deposit_sum(self, order_id: int) -> int:
        """Σ tiền THỰC thu của phiếu thu cọc (source=order, đã 'received') gắn đơn —
        base cổng đủ cọc. 0 nếu chưa có phiếu received."""
        return int(self.received_deposit_sums([order_id]).get(order_id, 0))

    def received_deposit_sums(self, order_ids: list[int]) -> dict[int, int]:
        """Batch của received_deposit_sum: `{order_id: Σ tiền đã thu}` cho nhiều đơn (KPI, tránh
        N+1). Chỉ đơn có phiếu 'received' mới xuất hiện trong map."""
        if not order_ids:
            return {}
        stmt, tap = _loc_id(
            select(PaymentReceiptLine.order_id, func.coalesce(func.sum(PaymentReceiptLine.amount_vnd), 0))
            .join(PaymentReceipt, PaymentReceipt.id == PaymentReceiptLine.payment_receipt_id)
            .where(
                PaymentReceiptLine.sales_invoice_id.is_(None),
                PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED,
            )
            .group_by(PaymentReceiptLine.order_id),
            PaymentReceiptLine.order_id, order_ids,
        )
        return {int(oid): int(s) for oid, s in self.db.execute(stmt) if tap is None or oid in tap}

    def tong_coc_da_thu(self, order_ids_stmt) -> int:
        """Σ cọc đã thu (phiếu 'received') của mọi đơn trong câu chọn id — dòng "Cộng" của lưới đơn."""
        stmt = (
            select(func.coalesce(func.sum(PaymentReceiptLine.amount_vnd), 0))
            .join(PaymentReceipt, PaymentReceipt.id == PaymentReceiptLine.payment_receipt_id)
            .where(
                PaymentReceiptLine.order_id.in_(order_ids_stmt),
                PaymentReceiptLine.sales_invoice_id.is_(None),
                PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED,
            )
        )
        return int(self.db.execute(stmt).scalar_one() or 0)

    def list_order_receipts(self, order_id: int) -> list[PaymentReceipt]:
        """Mọi phiếu thu cọc của một đơn (mọi trạng thái) — FE hiện danh sách + đi tới màn
        Phiếu thu Kế toán. Sắp theo thứ tự lập (id tăng dần)."""
        return list(
            self.db.execute(
                select(PaymentReceipt)
                .options(selectinload(PaymentReceipt.lines))
                .where(PaymentReceipt.lines.any(
                    (PaymentReceiptLine.order_id == order_id) & PaymentReceiptLine.sales_invoice_id.is_(None)
                ))
                .order_by(PaymentReceipt.id.asc())
            ).scalars()
        )

    # --- sales invoices / accounts receivable ------------------------------

    def get_sales_order(self, order_id: int) -> Order | None:
        return self.db.execute(
            select(Order).options(selectinload(Order.lines)).where(Order.id == order_id)
        ).scalar_one_or_none()

    def get_customer(self, customer_id: int) -> Customer | None:
        return self.db.get(Customer, customer_id)

    def customers_by_ids(self, customer_ids: set[int]) -> dict[int, Customer]:
        if not customer_ids:
            return {}
        rows = self.db.execute(
            select(Customer).where(Customer.id.in_(customer_ids))
        ).scalars()
        return {row.id: row for row in rows}

    def lien_he_chinh_theo_khach(self, customer_ids: set[int]) -> dict[int, tuple[str, str | None]]:
        """`{customer_id: (tên, số điện thoại)}` của LIÊN HỆ CHÍNH (`is_primary`) — cột Liên hệ của
        bảng Công nợ phải thu. Khách chưa đánh dấu ai là chính thì KHÔNG có khoá: người gọi lùi về
        ô liên hệ nhanh của khách (`contact_name` / `phone`)."""
        if not customer_ids:
            return {}
        rows = self.db.execute(
            select(CustomerContact.customer_id, CustomerContact.name, CustomerContact.phone)
            .where(CustomerContact.customer_id.in_(customer_ids), CustomerContact.is_primary.is_(True))
            .order_by(CustomerContact.id.asc())
        ).all()
        out: dict[int, tuple[str, str | None]] = {}
        for cid, ten, sdt in rows:
            out.setdefault(cid, (ten, sdt))
        return out

    def lan_thu_cuoi_cong_no(
        self, *, invoice_ids: list[int] | None = None, order_ids: list[int] | None = None
    ) -> list[tuple]:
        """Phiếu thu ĐÃ THU gắn các hoá đơn / cọc đơn này, MỚI NHẤT trước — cột thô
        `(sales_invoice_id, order_id, receipt_date, id, amount_vnd)`, không nạp đối tượng. Cùng luật
        nối với `list_receipts_for_receivables` nhưng KHÔNG mốc kỳ: "thu gần nhất" là của cả lịch sử.
        Không truyền cả hai = MỌI hoá đơn `issued` và đơn của chúng (truy vấn con, không IN-list)."""
        if invoice_ids is None and order_ids is None:
            noi = self._noi_dong_moi_hoa_don_phat_hanh()
        elif not invoice_ids and not order_ids:
            return []
        else:
            noi = self._noi_dong_cong_no(invoice_ids or [], order_ids or [])
        # Cột của BẢNG (không qua thuộc tính ORM): kết quả đi đường Core, bớt tầng dựng dòng ORM —
        # lời "mọi hoá đơn" trả hàng chục nghìn dòng.
        dong, pt = PaymentReceiptLine.__table__, PaymentReceipt.__table__
        return list(
            self.db.execute(
                select(dong.c.sales_invoice_id, dong.c.order_id, pt.c.receipt_date, pt.c.id,
                       pt.c.amount_vnd)
                .select_from(dong)
                .join(pt, pt.c.id == dong.c.payment_receipt_id)
                .where(noi,
                       PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED)
                .order_by(PaymentReceipt.receipt_date.desc(), PaymentReceipt.id.desc(),
                          PaymentReceiptLine.id.asc())
            ).all()
        )

    @staticmethod
    def _noi_dong_cong_no(invoice_ids: list[int], order_ids: list[int]):
        """Dòng phân bổ thuộc công nợ của các hoá đơn / cọc của các đơn này."""
        links = []
        if invoice_ids:
            links.append(PaymentReceiptLine.sales_invoice_id.in_(invoice_ids))
        if order_ids:
            links.append(
                PaymentReceiptLine.order_id.in_(order_ids) & PaymentReceiptLine.sales_invoice_id.is_(None)
            )
        return or_(*links)

    def customer_ids_co_nhan(self, label: str) -> set[int]:
        """Id các khách mang nhãn `label` — lọc Công nợ phải thu theo nhãn. Gọi thẳng
        `CustomerRepository.ids_with_label` (nguồn DUY NHẤT của phép so nhãn), không chép luật."""
        if not (label or "").strip():
            return set()
        return CustomerRepository(self.db).ids_with_label(label)

    def get_sales_invoice(self, invoice_id: int) -> SalesInvoice | None:
        return self.db.execute(
            self._sales_invoice_stmt().where(SalesInvoice.id == invoice_id)
        ).scalar_one_or_none()

    def latest_sales_invoice_symbol(self) -> str | None:
        """Ký hiệu của hoá đơn bán ghi gần nhất (mọi đơn) — cả năm thường chỉ một dãy."""
        return self.db.execute(
            select(SalesInvoice.invoice_symbol)
            .where(SalesInvoice.invoice_symbol.is_not(None), SalesInvoice.invoice_symbol != "")
            .order_by(SalesInvoice.id.desc())
            .limit(1)
        ).scalar_one_or_none()

    def list_sales_invoices(
        self,
        *,
        order_id: int | None = None,
        customer_id: int | None = None,
        status: str | None = None,
    ) -> list[SalesInvoice]:
        stmt = self._sales_invoice_stmt()
        if order_id is not None:
            stmt = stmt.where(SalesInvoice.order_id == order_id)
        if customer_id is not None:
            stmt = stmt.where(SalesInvoice.customer_id == customer_id)
        if status is not None:
            stmt = stmt.where(SalesInvoice.status == status)
        return list(
            self.db.execute(
                stmt.order_by(SalesInvoice.invoice_date, SalesInvoice.id)
            ).scalars()
        )

    def hoa_don_va_da_thu_toi_ngay(
        self, order_ids: list[int], *, den_ngay: date | None = None
    ) -> tuple[dict[int, int], dict[int, int]]:
        """`({order_id: Σ hoá đơn đã ghi}, {order_id: Σ đã thu})` tính tới hết `den_ngay` (None = mọi
        ngày) cho nhiều đơn — Báo cáo kinh doanh (11/10/2026). Đã thu = phiếu thu ĐÃ THU của đơn
        (cọc, không gắn hoá đơn) + phiếu thu ĐÃ THU đích danh hoá đơn của đơn; cùng hai nguồn mà
        sổ phải thu cấn trừ (`bao_cao_cong_no._khoan_phai_thu`). Phiếu hoàn tiền NCC không tính."""
        if not order_ids:
            return {}, {}
        hd_stmt = (
            select(SalesInvoice.order_id, func.coalesce(func.sum(SalesInvoice.amount_vnd), 0))
            .where(SalesInvoice.order_id.in_(order_ids), SalesInvoice.status == SALES_INVOICE_ISSUED)
            .group_by(SalesInvoice.order_id)
        )
        thu_stmt = (
            select(PaymentReceiptLine.order_id, func.coalesce(func.sum(PaymentReceiptLine.amount_vnd), 0))
            .join(PaymentReceipt, PaymentReceipt.id == PaymentReceiptLine.payment_receipt_id)
            .where(PaymentReceiptLine.order_id.in_(order_ids),
                   PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED)
            .group_by(PaymentReceiptLine.order_id)
        )
        if den_ngay is not None:
            hd_stmt = hd_stmt.where(SalesInvoice.invoice_date <= den_ngay)
            thu_stmt = thu_stmt.where(PaymentReceipt.receipt_date <= den_ngay)
        hoa_don = {int(o): int(s or 0) for o, s in self.db.execute(hd_stmt)}
        da_thu = {int(o): int(s or 0) for o, s in self.db.execute(thu_stmt)}
        return hoa_don, da_thu

    def issued_invoice_sums(self, order_ids: list[int]) -> dict[int, int]:
        """`{order_id: Σ hoá đơn đã ghi}` MỘT câu cho nhiều đơn — đơn chưa ghi vắng mặt."""
        if not order_ids:
            return {}
        return {int(oid): int(s or 0) for oid, s in self.db.execute(
            select(SalesInvoice.order_id, func.coalesce(func.sum(SalesInvoice.amount_vnd), 0))
            .where(SalesInvoice.order_id.in_(order_ids), SalesInvoice.status == SALES_INVOICE_ISSUED)
            .group_by(SalesInvoice.order_id))}

    def hoa_don_cua_don_co_ck_ke(
        self, *, order_ids: list[int] | None = None, customer_id: int | None = None
    ) -> list[SimpleNamespace]:
        """Mọi hóa đơn còn hiệu lực của các đơn có ÍT NHẤT một hóa đơn còn hiệu lực mang CK hoặc kê
        (20/10/2026) — hàng chờ chi CK / kê cần đủ hóa đơn của đơn để cấn cọc FIFO đúng. BẢN NHẸ
        (`hoa_don_phat_hanh_nhe`, 26/10/2026)."""
        don = select(SalesInvoice.order_id).where(
            SalesInvoice.status == SALES_INVOICE_ISSUED,
            or_(SalesInvoice.chiet_khau > 0, SalesInvoice.ke_gia > 0),
        )
        if order_ids is not None:
            if not order_ids:
                return []
            don = don.where(SalesInvoice.order_id.in_(order_ids))
        if customer_id is not None:
            don = don.where(SalesInvoice.customer_id == customer_id)
        return self.hoa_don_phat_hanh_nhe(SalesInvoice.order_id.in_(don.distinct()))

    def da_chi_ck_ke(self, invoice_ids: list[int]) -> dict[tuple[int, str], int]:
        """{(hóa đơn, loại): Σ đã chi} qua phiếu chi CK / kê chưa huỷ."""
        if not invoice_ids:
            return {}
        rows = self.db.execute(
            select(PhieuChiCkKe.sales_invoice_id, PhieuChiCkKe.loai,
                   func.coalesce(func.sum(PhieuChiCkKe.amount_vnd), 0))
            .join(PaymentVoucher, PaymentVoucher.id == PhieuChiCkKe.payment_voucher_id)
            .where(PhieuChiCkKe.sales_invoice_id.in_(invoice_ids),
                   PaymentVoucher.status != PAYMENT_VOUCHER_CANCELLED)
            .group_by(PhieuChiCkKe.sales_invoice_id, PhieuChiCkKe.loai)
        ).all()
        return {(int(i), str(loai)): int(so) for i, loai, so in rows}

    def ck_ke_da_ghi_cua_don(self, order_id: int) -> tuple[int, int]:
        """(Σ CK, Σ kê) của các hóa đơn còn hiệu lực của đơn."""
        ck, ke = self.db.execute(
            select(func.coalesce(func.sum(SalesInvoice.chiet_khau), 0),
                   func.coalesce(func.sum(SalesInvoice.ke_gia), 0))
            .where(SalesInvoice.order_id == order_id, SalesInvoice.status == SALES_INVOICE_ISSUED)
        ).one()
        return int(ck), int(ke)

    def issued_invoice_amount_for_order(self, order_id: int) -> int:
        return int(
            self.db.execute(
                select(func.coalesce(func.sum(SalesInvoice.amount_vnd), 0)).where(
                    SalesInvoice.order_id == order_id,
                    SalesInvoice.status == SALES_INVOICE_ISSUED,
                )
            ).scalar_one()
        )

    def issued_invoice_amount_by_trip(self, order_id: int) -> dict[int, int]:
        """{delivery_trip_id: tổng hóa đơn issued đã ghi cho lượt} của một đơn."""
        rows = self.db.execute(
            select(SalesInvoice.delivery_trip_id, func.coalesce(func.sum(SalesInvoice.amount_vnd), 0))
            .where(
                SalesInvoice.order_id == order_id,
                SalesInvoice.status == SALES_INVOICE_ISSUED,
                SalesInvoice.delivery_trip_id.is_not(None),
            )
            .group_by(SalesInvoice.delivery_trip_id)
        ).all()
        return {int(r[0]): int(r[1] or 0) for r in rows}

    def received_invoice_receipt_sums(self, invoice_ids: list[int]) -> dict[int, int]:
        if not invoice_ids:
            return {}
        stmt, tap = _loc_id(
            select(
                PaymentReceiptLine.sales_invoice_id,
                func.coalesce(func.sum(PaymentReceiptLine.amount_vnd), 0),
            )
            .join(PaymentReceipt, PaymentReceipt.id == PaymentReceiptLine.payment_receipt_id)
            .where(
                PaymentReceiptLine.sales_invoice_id.is_not(None),
                PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED,
            )
            .group_by(PaymentReceiptLine.sales_invoice_id),
            PaymentReceiptLine.sales_invoice_id, invoice_ids,
        )
        return {
            int(iid): int(amount) for iid, amount in self.db.execute(stmt).all() if tap is None or iid in tap
        }

    def received_invoice_receipts(self, invoice_ids: list[int]) -> list[PaymentReceiptLine]:
        """DÒNG phân bổ của phiếu thu ĐÃ THU gắn vào các hoá đơn — cùng tập với
        `received_invoice_receipt_sums`. Dòng mang mặt phiếu (`receipt_id`, `code`, `doc_no`,
        `receipt_date`); tiền là của dòng."""
        if not invoice_ids:
            return []
        stmt = (
            self._dong_thu_stmt()
            .where(
                PaymentReceiptLine.sales_invoice_id.in_(invoice_ids),
                PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED,
            )
            .order_by(PaymentReceipt.receipt_date, PaymentReceipt.id, PaymentReceiptLine.id)
        )
        return list(self.db.execute(stmt).scalars())

    def dong_coc_da_thu(self, order_id: int) -> list[PaymentReceiptLine]:
        """DÒNG cọc của đơn trên phiếu thu ĐÃ THU — popup chi tiết khoản cọc."""
        stmt = (
            self._dong_thu_stmt()
            .where(
                PaymentReceiptLine.order_id == order_id,
                PaymentReceiptLine.sales_invoice_id.is_(None),
                PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED,
            )
            .order_by(PaymentReceipt.receipt_date, PaymentReceipt.id, PaymentReceiptLine.id)
        )
        return list(self.db.execute(stmt).scalars())

    def luot_giao(self, trip_id: int):
        from ..models.delivery import DeliveryTrip

        return self.db.execute(
            select(DeliveryTrip).options(selectinload(DeliveryTrip.lines)).where(DeliveryTrip.id == trip_id)
        ).scalar_one_or_none()

    @staticmethod
    def _dong_thu_stmt():
        return (
            select(PaymentReceiptLine)
            .join(PaymentReceipt, PaymentReceipt.id == PaymentReceiptLine.payment_receipt_id)
            .options(
                selectinload(PaymentReceiptLine.receipt).selectinload(PaymentReceipt.lines),
                selectinload(PaymentReceiptLine.sales_invoice),
                selectinload(PaymentReceiptLine.order),
            )
        )

    def list_receipts_for_receivables(
        self,
        *,
        invoice_ids: list[int],
        order_ids: list[int],
        since=None,
    ) -> list[PaymentReceiptLine]:
        """DÒNG phân bổ (một lần thu = một dòng) thuộc công nợ của các hoá đơn / cọc của các đơn."""
        if not invoice_ids and not order_ids:
            return []
        stmt = self._dong_thu_stmt().where(
            self._noi_dong_cong_no(invoice_ids, order_ids),
            PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED,
        )
        if since is not None:
            stmt = stmt.where(PaymentReceipt.receipt_date >= since)
        return list(
            self.db.execute(
                stmt.order_by(PaymentReceipt.receipt_date.desc(), PaymentReceipt.id.desc(),
                              PaymentReceiptLine.id.asc())
            ).scalars()
        )

    # --- báo cáo công nợ theo kỳ (docs/prd-bao-cao-cong-no.md §5.1) ---
    #
    # Ba hàm dưới KHÔNG phân trang và KHÔNG lọc `từ ngày`: báo cáo phải dựng được cả SỐ DƯ ĐẦU KỲ,
    # mà số dư đầu kỳ là tổng mọi chứng từ TRƯỚC kỳ. Cắt bớt ở SQL là mất đúng phần đó.
    # Chặn trên `den_ngay` thì có — chứng từ sau kỳ không thuộc báo cáo nào.

    def phieu_thu_cho_bao_cao(
        self, *, den_ngay: date, chi_ncc_hoan: bool = False, mat: bool = True, dong: bool = True
    ) -> list[SimpleNamespace]:
        """Mọi phiếu thu ĐÃ THU tới hết `den_ngay`. `chi_ncc_hoan=True` = chỉ phiếu NCC hoàn tiền
        (`purchase_refund`) — sổ 331 chỉ cần nhánh đó, đừng nạp cả chục nghìn phiếu thu của khách.

        Chỉ `received`: phiếu chờ chưa động vào tiền nên chưa vào công nợ — cùng luật với
        `payables/receivables` đang chạy, hai chỗ tính hai kiểu là hai chỗ lệch.

        Trả BẢN NHẸ (26/10/2026), không phải đối tượng ORM: cột thô (phiếu + dòng phân bổ) thay cho
        selectinload năm quan hệ — trên DB đo tải 13 nghìn phiếu tốn ~10 s chỉ để dựng đối tượng.
        Bản nhẹ mang ĐÚNG các thuộc tính sổ công nợ đọc, cùng tên với ORM: phần LÕI (tiền, ngày,
        truy khách / NCC: `sales_invoice.customer_id`, `lines[].sales_invoice.{status, order_id}`,
        `payment_voucher.{supplier_id, purchase_request.supplier_id}`) luôn có; phần MẶT PHIẾU (số,
        diễn giải, giờ, hình thức, `company_bank_account`…) chỉ khi `mat=True` — sổ tổng hợp và tuổi
        nợ không đọc mặt phiếu, sổ chi tiết nạp bù cho đúng phiếu cần bằng `nap_mat_phieu_thu`.
        `dong=False`: không nạp dòng phân bổ (`lines`) — người gọi lấy tiền theo hoá đơn / đơn đã
        cộng sẵn ở SQL (`tien_thu_hoa_don_va_coc`).
        Đọc thuộc tính chưa nạp là AttributeError ngay, không lặng lẽ ra None."""
        pt = PaymentReceipt.__table__
        dk = [pt.c.status == PAYMENT_RECEIPT_RECEIVED, pt.c.receipt_date <= den_ngay]
        if chi_ncc_hoan:
            dk.append(pt.c.source_type == RECEIPT_SOURCE_PURCHASE)
        hd = SalesInvoice.__table__.alias("hd_phieu")
        pc = PaymentVoucher.__table__.alias("pc_phieu")
        pm = PurchaseRequest.__table__.alias("pm_phieu")
        stmt = (
            select(
                *[pt.c[c] for c in _COT_PHIEU_THU_LOI], hd.c.customer_id, pc.c.supplier_id,
                pm.c.id, pm.c.supplier_id,
            )
            .select_from(pt)
            .outerjoin(hd, hd.c.id == pt.c.sales_invoice_id)
            .outerjoin(pc, pc.c.id == pt.c.payment_voucher_id)
            .outerjoin(pm, pm.c.id == pc.c.purchase_request_id)
            .where(*dk)
            .order_by(pt.c.receipt_date, pt.c.id)
        )
        n = len(_COT_PHIEU_THU_LOI)
        ra: list[SimpleNamespace] = []
        theo_id: dict[int, SimpleNamespace] = {}
        for r in self.db.execute(stmt).all():
            p = SimpleNamespace(**dict(zip(_COT_PHIEU_THU_LOI, r)))
            hd_kh, pc_ncc, pm_id, pm_ncc = r[n:]
            p.sales_invoice = (
                SimpleNamespace(id=p.sales_invoice_id, customer_id=hd_kh)
                if p.sales_invoice_id is not None else None
            )
            p.payment_voucher = (
                SimpleNamespace(
                    id=p.payment_voucher_id, supplier_id=pc_ncc,
                    purchase_request=(
                        SimpleNamespace(id=pm_id, supplier_id=pm_ncc) if pm_id is not None else None
                    ),
                )
                if p.payment_voucher_id is not None else None
            )
            if dong:
                p.lines = []
            ra.append(p)
            theo_id[p.id] = p
        if not ra or not dong:
            if ra and mat:
                self.nap_mat_phieu_thu(ra, _dk=dk)
            return ra
        # Dòng phân bổ của CÙNG tập phiếu (cùng điều kiện, JOIN thay cho IN-list id), thứ tự dòng
        # theo `PaymentReceipt.lines` (order_by id).
        dong = PaymentReceiptLine.__table__
        hd_dong = SalesInvoice.__table__.alias("hd_dong")
        dong_stmt = (
            select(
                dong.c.payment_receipt_id, dong.c.id, dong.c.order_id, dong.c.sales_invoice_id,
                dong.c.amount_vnd, hd_dong.c.status, hd_dong.c.order_id,
            )
            .select_from(dong)
            .join(pt, pt.c.id == dong.c.payment_receipt_id)
            .outerjoin(hd_dong, hd_dong.c.id == dong.c.sales_invoice_id)
            .where(*dk)
            .order_by(dong.c.id)
        )
        for pid, lid, don_id, hd_id, tien, h_tt, h_don in self.db.execute(dong_stmt).all():
            p = theo_id.get(pid)
            if p is None:
                continue
            p.lines.append(SimpleNamespace(
                id=lid, payment_receipt_id=pid, order_id=don_id, sales_invoice_id=hd_id,
                amount_vnd=tien,
                sales_invoice=(
                    SimpleNamespace(id=hd_id, status=h_tt, order_id=h_don) if hd_id is not None else None
                ),
            ))
        if mat:
            self.nap_mat_phieu_thu(ra, _dk=dk)
        return ra

    def tien_thu_hoa_don_va_coc(self, *, den_ngay: date) -> tuple[dict[int, int], dict[int, int]]:
        """`(thu ĐÍCH DANH theo hoá đơn, quỹ CỌC theo đơn)` của mọi phiếu thu ĐÃ THU tới hết
        `den_ngay` — bản cộng ở SQL của `bao_cao_cong_no.tien_thu_tu_phieu`, CÙNG luật:
        dòng gắn hoá đơn đã huỷ ⇒ quỹ của đơn của hoá đơn đó; dòng gắn hoá đơn khác ⇒ đích danh;
        dòng không gắn hoá đơn ⇒ quỹ của đơn của dòng. Phiếu NCC hoàn tiền không thuộc 131."""
        pt = PaymentReceipt.__table__
        dong = PaymentReceiptLine.__table__
        hd = SalesInvoice.__table__.alias("hd_tien")
        nen = (
            select()
            .select_from(dong)
            .join(pt, pt.c.id == dong.c.payment_receipt_id)
            .outerjoin(hd, hd.c.id == dong.c.sales_invoice_id)
            .where(pt.c.status == PAYMENT_RECEIPT_RECEIVED, pt.c.receipt_date <= den_ngay,
                   pt.c.source_type != RECEIPT_SOURCE_PURCHASE)
        )
        huy = and_(hd.c.id.is_not(None), hd.c.status != SALES_INVOICE_ISSUED)
        tong = func.coalesce(func.sum(dong.c.amount_vnd), 0)
        dich_danh = {
            int(i): int(t) for i, t in self.db.execute(
                nen.add_columns(dong.c.sales_invoice_id, tong)
                .where(dong.c.sales_invoice_id.is_not(None), ~huy)
                .group_by(dong.c.sales_invoice_id)
            ).all()
        }
        don_cua_dong = case((dong.c.sales_invoice_id.is_(None), dong.c.order_id), else_=hd.c.order_id)
        coc = {
            int(i): int(t) for i, t in self.db.execute(
                nen.add_columns(don_cua_dong, tong)
                .where(or_(dong.c.sales_invoice_id.is_(None), huy))
                .group_by(don_cua_dong)
            ).all()
        }
        return dich_danh, coc

    def nap_mat_phieu_thu(self, phieu: list, *, _dk=None) -> None:
        """Nạp bù phần MẶT PHIẾU (`_COT_PHIEU_THU_MAT` + `company_bank_account`) vào các phiếu thu
        BẢN NHẸ của `phieu_thu_cho_bao_cao(mat=False)`. Đối tượng ORM (đã đủ cột) thì bỏ qua."""
        can = [p for p in phieu if isinstance(p, SimpleNamespace)]
        if not can:
            return
        pt = PaymentReceipt.__table__
        tk = CompanyBankAccount.__table__.alias("tk_phieu")
        stmt = (
            select(pt.c.id, *[pt.c[c] for c in _COT_PHIEU_THU_MAT], tk.c.id, tk.c.bank_name,
                   tk.c.account_number)
            .select_from(pt)
            .outerjoin(tk, tk.c.id == pt.c.company_bank_account_id)
        )
        theo_id = {p.id: p for p in can}
        if _dk is not None:
            stmt = stmt.where(*_dk)
        else:
            stmt, _tap = _loc_id(stmt, pt.c.id, theo_id)
        n = len(_COT_PHIEU_THU_MAT)
        for r in self.db.execute(stmt).all():
            p = theo_id.get(r[0])
            if p is None:
                continue
            for k, v in zip(_COT_PHIEU_THU_MAT, r[1:n + 1]):
                setattr(p, k, v)
            tk_id, tk_nh, tk_so = r[n + 1:]
            p.company_bank_account = (
                SimpleNamespace(id=tk_id, bank_name=tk_nh, account_number=tk_so)
                if tk_id is not None else None
            )

    def hoa_don_phat_hanh_nhe(self, *dieu_kien) -> list[SimpleNamespace]:
        """MỌI hoá đơn bán `issued` (thêm `dieu_kien` để thu hẹp), xếp (ngày hoá đơn, id) — BẢN NHẸ của
        `list_sales_invoices(status=issued)` cho màn Công nợ phải thu và sổ 131 (26/10/2026).

        Một câu cột thô JOIN đơn (lấy `order.order_no`) thay cho selectinload order/customer/receipts
        của từng hoá đơn (~6 s trên 13 nghìn hoá đơn của DB đo tải). Mang đúng các thuộc tính
        `receivable_rows` và `bao_cao_cong_no` đọc, cùng tên với ORM."""
        si, dh = SalesInvoice.__table__, Order.__table__
        # Cột của BẢNG (không qua thuộc tính ORM) — kết quả đi đường Core, bớt tầng dựng dòng ORM.
        stmt = (
            select(*[si.c[c] for c in _COT_HOA_DON_NHE], dh.c.order_no)
            .select_from(si)
            .join(dh, dh.c.id == si.c.order_id)
            .where(si.c.status == SALES_INVOICE_ISSUED, *dieu_kien)
            .order_by(si.c.invoice_date, si.c.id)
        )
        ra = []
        for r in self.db.execute(stmt).all():
            hd = SimpleNamespace(**dict(zip(_COT_HOA_DON_NHE, r)))
            hd.order = SimpleNamespace(id=hd.order_id, order_no=r[-1])
            ra.append(hd)
        return ra

    @staticmethod
    def _noi_dong_moi_hoa_don_phat_hanh():
        """`_noi_dong_cong_no` cho TOÀN BỘ hoá đơn `issued` và đơn của chúng — bằng truy vấn con,
        không đẩy IN-list hàng chục nghìn id lên máy chủ."""
        hd_ids = select(SalesInvoice.id).where(SalesInvoice.status == SALES_INVOICE_ISSUED)
        don_ids = select(SalesInvoice.order_id).where(SalesInvoice.status == SALES_INVOICE_ISSUED)
        return or_(
            PaymentReceiptLine.sales_invoice_id.in_(hd_ids),
            PaymentReceiptLine.order_id.in_(don_ids) & PaymentReceiptLine.sales_invoice_id.is_(None),
        )

    def thu_cong_no_theo_dong(self, *, since: date | None, until: date | None) -> list[tuple]:
        """`[(sales_invoice_id, order_id, Σ tiền dòng)]` của phiếu thu ĐÃ THU có ngày thu trong
        [`since`, `until`] (None = không chặn), thuộc công nợ của MỌI hoá đơn `issued` — cùng tập
        dòng với `list_receipts_for_receivables(invoice_ids=mọi hoá đơn issued, order_ids=đơn của
        chúng)`, nhưng cộng sẵn ở SQL. Cột "đã thu trong kỳ" của màn Công nợ phải thu."""
        stmt = (
            select(
                PaymentReceiptLine.sales_invoice_id, PaymentReceiptLine.order_id,
                func.coalesce(func.sum(PaymentReceiptLine.amount_vnd), 0),
            )
            .join(PaymentReceipt, PaymentReceipt.id == PaymentReceiptLine.payment_receipt_id)
            .where(self._noi_dong_moi_hoa_don_phat_hanh(),
                   PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED)
            .group_by(PaymentReceiptLine.sales_invoice_id, PaymentReceiptLine.order_id)
        )
        if since is not None:
            stmt = stmt.where(PaymentReceipt.receipt_date >= since)
        if until is not None:
            stmt = stmt.where(PaymentReceipt.receipt_date <= until)
        return [(hd, don, int(t)) for hd, don, t in self.db.execute(stmt).all()]

    def coc_da_tra_lai(self, order_id: int) -> int:
        """Σ phiếu chi TRẢ LẠI CỌC (còn hiệu lực) của một đơn đã huỷ. Cọc còn lại của đơn =
        `received_deposit_sum` − số này."""
        stmt = select(func.coalesce(func.sum(PaymentVoucher.amount_vnd), 0)).where(
            PaymentVoucher.order_id == order_id,
            PaymentVoucher.status == PAYMENT_VOUCHER_PAID,
        )
        return int(self.db.execute(stmt).scalar_one())

    def coc_da_tra_lai_nhieu(self, order_ids) -> dict[int, int]:
        """Bản lô của `coc_da_tra_lai`: `{order_id: Σ phiếu chi trả lại cọc}`, MỘT câu cho cả tập.
        Đơn chưa trả lại đồng nào vắng mặt trong map."""
        ids = sorted({int(i) for i in order_ids if i})
        if not ids:
            return {}
        stmt, tap = _loc_id(
            select(PaymentVoucher.order_id, func.coalesce(func.sum(PaymentVoucher.amount_vnd), 0))
            .where(PaymentVoucher.order_id.is_not(None), PaymentVoucher.status == PAYMENT_VOUCHER_PAID)
            .group_by(PaymentVoucher.order_id),
            PaymentVoucher.order_id, ids,
        )
        return {int(oid): int(s) for oid, s in self.db.execute(stmt) if tap is None or oid in tap}

    def hoan_khach_khong_don(self, customer_ids=None, *, den_ngay: date | None = None) -> dict[int, int]:
        """`{customer_id: Σ phiếu chi trả lại khách ĐÃ CHI không gắn đơn}` (17/10/2026) — tiền trả
        ngoài đơn (vd. hàng lỗi) cộng nợ lại vào hoá đơn hạn muộn nhất của khách. `None` = mọi khách.
        `den_ngay`: chỉ phiếu chi tới hết ngày đó (Báo cáo kinh doanh in lại kỳ cũ)."""
        stmt = (
            select(PaymentVoucher.customer_id, func.coalesce(func.sum(PaymentVoucher.amount_vnd), 0))
            .where(PaymentVoucher.source_type == VOUCHER_SOURCE_CUSTOMER_REFUND,
                   PaymentVoucher.status == PAYMENT_VOUCHER_PAID,
                   PaymentVoucher.order_id.is_(None),
                   PaymentVoucher.customer_id.is_not(None))
            .group_by(PaymentVoucher.customer_id)
        )
        if den_ngay is not None:
            stmt = stmt.where(PaymentVoucher.voucher_date <= den_ngay)
        if customer_ids is not None:
            ids = sorted({int(i) for i in customer_ids if i})
            if not ids:
                return {}
            stmt = stmt.where(PaymentVoucher.customer_id.in_(ids))
        return {int(c): int(t) for c, t in self.db.execute(stmt) if int(t) > 0}

    def ncc_hoan_khong_don(self, supplier_ids=None) -> dict[int, int]:
        """`{supplier_id: Σ phiếu thu NCC hoàn tiền ĐÃ THU lập thẳng cho NCC}` (#36, 18/10/2026) — phiếu
        không qua phiếu chi gốc nên không gắn đơn mua nào; mình nợ NCC thêm đúng số đó. Phiếu hoàn qua
        phiếu chi đã nằm sẵn trong `net_paid` của đơn. `None` = mọi NCC."""
        stmt = (
            select(PaymentReceipt.supplier_id, func.coalesce(func.sum(PaymentReceipt.amount_vnd), 0))
            .where(PaymentReceipt.source_type == RECEIPT_SOURCE_PURCHASE,
                   PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED,
                   PaymentReceipt.payment_voucher_id.is_(None),
                   PaymentReceipt.purchase_request_id.is_(None),
                   PaymentReceipt.supplier_id.is_not(None))
            .group_by(PaymentReceipt.supplier_id)
        )
        if supplier_ids is not None:
            ids = sorted({int(i) for i in supplier_ids if i})
            if not ids:
                return {}
            stmt = stmt.where(PaymentReceipt.supplier_id.in_(ids))
        return {int(s): int(t) for s, t in self.db.execute(stmt) if int(t) > 0}

    def hoa_don_hieu_luc_cua_khach(self, customer_ids) -> list[SimpleNamespace]:
        """Hoá đơn `issued` của các khách — BẢN NHẸ (`hoa_don_phat_hanh_nhe`)."""
        ids = sorted({int(i) for i in customer_ids if i})
        if not ids:
            return []
        return self.hoa_don_phat_hanh_nhe(SalesInvoice.customer_id.in_(ids))

    def thu_hoa_don_huy_theo_don(self, order_ids=None) -> dict[int, int]:
        """`{order_id: Σ phiếu thu ĐÃ THU gắn hoá đơn ĐÃ HUỶ}` (17/10/2026). Hoá đơn huỷ khi khách đã
        trả thì phiếu thu vẫn giữ (tiền đã vào quỹ); số tiền đó về chung quỹ tiền của đơn như cọc,
        trừ vào hoá đơn ghi lại sau. `order_ids=None` = mọi đơn."""
        stmt = (
            select(SalesInvoice.order_id, func.coalesce(func.sum(PaymentReceiptLine.amount_vnd), 0))
            .join(SalesInvoice, PaymentReceiptLine.sales_invoice_id == SalesInvoice.id)
            .join(PaymentReceipt, PaymentReceipt.id == PaymentReceiptLine.payment_receipt_id)
            .where(
                SalesInvoice.status == SALES_INVOICE_CANCELLED,
                PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED,
            )
            .group_by(SalesInvoice.order_id)
        )
        tap = None
        if order_ids is not None:
            ids = sorted({int(i) for i in order_ids if i})
            if not ids:
                return {}
            stmt, tap = _loc_id(stmt, SalesInvoice.order_id, ids)
        return {
            int(oid): int(s) for oid, s in self.db.execute(stmt)
            if int(s) > 0 and (tap is None or oid in tap)
        }

    # --- Hàng việc tiền của đơn bán (services/ban_hang_cho_thu_chi.py, 17/10/2026) ---
    def don_chot_co_coc(self) -> list[Order]:
        """Đơn ĐÃ CHỐT có % cọc — ứng viên hàng "cọc chờ thu"."""
        from ..models.order import STATUS_ORDERED
        return list(self.db.scalars(
            select(Order).where(Order.status == STATUS_ORDERED,
                                (Order.deposit_pct > 0) | (Order.deposit_amount > 0))
            .order_by(Order.ordered_at, Order.id)))

    def don_co_coc_da_thu(self) -> set[int]:
        """Id mọi đơn có phiếu thu cọc ĐÃ THU."""
        return {int(i) for i in self.db.scalars(
            select(PaymentReceiptLine.order_id)
            .join(PaymentReceipt, PaymentReceipt.id == PaymentReceiptLine.payment_receipt_id)
            .where(
                PaymentReceiptLine.sales_invoice_id.is_(None),
                PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED).distinct())}

    def don_cua_khach_co_tien(self, customer_id: int) -> set[int]:
        """Id mọi đơn của khách — `tien_dang_de` lọc tiếp theo quỹ tiền của đơn."""
        return {int(i) for i in self.db.scalars(select(Order.id).where(Order.customer_id == customer_id))}

    def don_theo_ids(self, order_ids) -> dict[int, Order]:
        ids = sorted({int(i) for i in order_ids if i})
        if not ids:
            return {}
        return {o.id: o for o in self.db.scalars(select(Order).where(Order.id.in_(ids)))}

    def hoa_don_hieu_luc_cua_don(self, order_ids) -> list[SimpleNamespace]:
        """Hoá đơn `issued` của các đơn — BẢN NHẸ (`hoa_don_phat_hanh_nhe`)."""
        ids = sorted({int(i) for i in order_ids if i})
        if not ids:
            return []
        return self.hoa_don_phat_hanh_nhe(SalesInvoice.order_id.in_(ids))

    def hoa_don_huy_da_thu(self, order_ids) -> dict[int, list[str]]:
        """`{order_id: [số hoá đơn ĐÃ HUỶ mà khách đã trả tiền]}`."""
        ids = sorted({int(i) for i in order_ids if i})
        if not ids:
            return {}
        stmt = (
            select(SalesInvoice.order_id, SalesInvoice.invoice_number)
            .join(PaymentReceiptLine, PaymentReceiptLine.sales_invoice_id == SalesInvoice.id)
            .join(PaymentReceipt, PaymentReceipt.id == PaymentReceiptLine.payment_receipt_id)
            .where(SalesInvoice.order_id.in_(ids),
                   SalesInvoice.status == SALES_INVOICE_CANCELLED,
                   PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED)
            .distinct().order_by(SalesInvoice.order_id, SalesInvoice.invoice_number)
        )
        ra: dict[int, list[str]] = {}
        for oid, so in self.db.execute(stmt):
            ra.setdefault(int(oid), []).append(so)
        return ra

    def phieu_chi_hoan_khach(self) -> list[PaymentVoucher]:
        """Phiếu chi ĐÃ CHI có gắn khách (trả lại tiền cho khách, nguồn `customer_refund`) — vế Nợ
        của Công nợ phải thu. Lọc ngày bằng `ngay_chi` ở service, cùng lý do `phieu_chi_cho_bao_cao`."""
        stmt = (
            select(PaymentVoucher)
            .options(selectinload(PaymentVoucher.company_bank_account))
            .where(PaymentVoucher.status == PAYMENT_VOUCHER_PAID,
                   PaymentVoucher.customer_id.is_not(None))
            .order_by(PaymentVoucher.voucher_date, PaymentVoucher.id)
        )
        return list(self.db.execute(stmt).scalars().all())

    def phieu_chi_cho_bao_cao(self) -> list[PaymentVoucher]:
        """Mọi phiếu chi ĐÃ CHI, không chặn ngày.

        Không lọc ngày ở SQL vì "ngày tiền rời két" là `paid_at` có thì lấy, không thì lùi về
        `voucher_date` — một biểu thức COALESCE trên hai kiểu khác nhau (timestamptz vs date),
        viết ở SQL thì mỗi DB một kiểu. Lọc bằng Python với đúng hàm `_ngay_chi` mà màn công nợ
        đang dùng, để hai nơi không bao giờ chọn ngày khác nhau cho cùng một phiếu.

        Loại phiếu chi gia công ngoài — không phải công nợ NCC.
        """
        stmt = (
            select(PaymentVoucher)
            .options(
                selectinload(PaymentVoucher.purchase_request),
                selectinload(PaymentVoucher.company_bank_account),
            )
            .where(PaymentVoucher.status == PAYMENT_VOUCHER_PAID,
                   # Chi gia công ngoài KHÔNG vào công nợ 331 (spec gia công ngoài §5): tiền trả
                   # ngay khi chốt, không có đơn mua / hoá đơn treo nợ.
                   PaymentVoucher.source_type != VOUCHER_SOURCE_GIA_CONG)
            .order_by(PaymentVoucher.voucher_date, PaymentVoucher.id)
        )
        return list(self.db.execute(stmt).scalars().unique().all())

    def thong_ke_tai_khoan(self, *, tu_ngay: date, den_ngay: date) -> list[dict]:
        """Thu/chi ĐÃ XONG của từng tài khoản ngân hàng công ty trong kỳ (theo ngày chứng từ).

        Chỉ phiếu `paid` / `received` — phiếu huỷ không vào số. Tài khoản không có phiếu nào trong
        kỳ thì vắng mặt; chỗ gọi tự điền 0 cho thẻ tài khoản của mình."""
        chi = {i: (tong, dem) for i, tong, dem in self.db.execute(
            select(PaymentVoucher.company_bank_account_id,
                   func.sum(PaymentVoucher.amount_vnd), func.count())
            .where(PaymentVoucher.status == PAYMENT_VOUCHER_PAID,
                   PaymentVoucher.company_bank_account_id.is_not(None),
                   PaymentVoucher.voucher_date.between(tu_ngay, den_ngay))
            .group_by(PaymentVoucher.company_bank_account_id)).all()}
        thu = {i: (tong, dem) for i, tong, dem in self.db.execute(
            select(PaymentReceipt.company_bank_account_id,
                   func.sum(PaymentReceipt.amount_vnd), func.count())
            .where(PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED,
                   PaymentReceipt.company_bank_account_id.is_not(None),
                   PaymentReceipt.receipt_date.between(tu_ngay, den_ngay))
            .group_by(PaymentReceipt.company_bank_account_id)).all()}
        return [
            {
                "tai_khoan_id": i,
                "thu": int(thu.get(i, (0, 0))[0] or 0),
                "chi": int(chi.get(i, (0, 0))[0] or 0),
                "so_phieu": int(thu.get(i, (0, 0))[1]) + int(chi.get(i, (0, 0))[1]),
            }
            for i in sorted(set(chi) | set(thu))
        ]

    def khach_cua_don(self, order_ids: list[int]) -> dict[int, int]:
        """`{order_id: customer_id}` — truy khách cho phiếu thu đi đường CỌC ĐƠN HÀNG.

        Phiếu thu `order_deposit` chỉ giữ `order_id`; không có bảng tra này thì mỗi phiếu là một
        query (N+1 trên màn báo cáo cả năm).
        """
        ids = {int(i) for i in order_ids if i is not None}
        if not ids:
            return {}
        stmt = select(Order.id, Order.customer_id).where(Order.customer_id.is_not(None))
        if len(ids) <= _IN_LIST_TOI_DA:
            stmt = stmt.where(Order.id.in_(ids))
        # Tập lớn (sổ cả năm: mỗi phiếu thu một đơn): đọc cả bảng hai cột rồi lọc ở đây — rẻ hơn
        # đẩy IN-list hàng chục nghìn tham số qua bước biên dịch SQL.
        return {oid: cid for oid, cid in self.db.execute(stmt).all() if oid in ids}

    def khach_nhe_theo_ids(self, customer_ids) -> dict[int, SimpleNamespace]:
        """`{customer_id: khách}` BẢN NHẸ — chỉ các cột sổ công nợ đọc (`code`, `name`,
        `credit_limit`, `payment_term_days`, `sale_user_id`), không dựng đối tượng ORM. Tập lớn đọc cả
        bảng rồi lọc như `khach_cua_don`."""
        ids = {int(i) for i in customer_ids if i}
        if not ids:
            return {}
        stmt = select(Customer.id, Customer.code, Customer.name, Customer.credit_limit,
                      Customer.payment_term_days, Customer.sale_user_id)
        if len(ids) <= _IN_LIST_TOI_DA:
            stmt = stmt.where(Customer.id.in_(ids))
        return {
            r[0]: SimpleNamespace(id=r[0], code=r[1], name=r[2], credit_limit=r[3],
                                  payment_term_days=r[4], sale_user_id=r[5])
            for r in self.db.execute(stmt).all() if r[0] in ids
        }

    def ncc_theo_ids(self, supplier_ids: set[int]) -> dict[int, Supplier]:
        """`{supplier_id: NCC}` — song sinh của `customers_by_ids` cho phía 331."""
        if not supplier_ids:
            return {}
        rows = self.db.execute(
            select(Supplier).where(Supplier.id.in_(supplier_ids))
        ).scalars()
        return {row.id: row for row in rows}

    def get_supplier(self, supplier_id: int) -> Supplier | None:
        return self.db.get(Supplier, supplier_id)

    def save_sales_invoice(self, invoice: SalesInvoice) -> SalesInvoice:
        # Tương thích DB SQLite/PG đã từng chạy schema hóa đơn đời cũ. Các cột cũ
        # ``code/subtotal_vnd/vat_vnd`` là NOT NULL nên ORM hiện tại không thể INSERT
        # nếu không cấp giá trị. Phản chiếu đúng bảng live và ghi thêm các cột đó;
        # hóa đơn cũ vẫn giữ nguyên, DB trắng tiếp tục dùng đường ORM bình thường.
        bind = self.db.get_bind()
        live_columns = {c["name"] for c in inspect(bind).get_columns("sales_invoices")}
        legacy_required = {"code", "subtotal_vnd", "vat_vnd"}
        if invoice.id is None and legacy_required <= live_columns:
            now = datetime.now(timezone.utc)
            values = {
                "order_id": invoice.order_id,
                "customer_id": invoice.customer_id,
                "invoice_symbol": invoice.invoice_symbol,
                "invoice_number": invoice.invoice_number,
                "invoice_date": invoice.invoice_date,
                "amount_vnd": invoice.amount_vnd,
                "payment_term_days_snapshot": invoice.payment_term_days_snapshot,
                "due_date": invoice.due_date,
                "customer_name_snapshot": invoice.customer_name_snapshot,
                "status": invoice.status,
                "created_by_user_id": invoice.created_by_user_id,
                "created_at": now,
                "updated_at": now,
                "code": f"HD-{uuid4().hex[:28]}",
                "subtotal_vnd": invoice.amount_vnd,
                "vat_vnd": 0,
            }
            if "delivery_trip_id" in live_columns:
                values["delivery_trip_id"] = invoice.delivery_trip_id
            if "invoice_series" in live_columns:
                values["invoice_series"] = invoice.invoice_symbol
            if "invoice_no" in live_columns:
                values["invoice_no"] = invoice.invoice_number
            if "payment_term_days" in live_columns:
                values["payment_term_days"] = invoice.payment_term_days_snapshot
            table = Table("sales_invoices", MetaData(), autoload_with=bind)
            result = self.db.execute(table.insert().values(**values))
            invoice_id = int(result.inserted_primary_key[0])
            self._commit()
            saved = self.get_sales_invoice(invoice_id)
            if saved is None:
                raise RuntimeError("Không đọc lại được hóa đơn vừa ghi.")
            return saved
        self.db.add(invoice)
        self._commit()
        self.db.refresh(invoice)
        return self.get_sales_invoice(invoice.id) or invoice

    def _sales_invoice_stmt(self):
        return select(SalesInvoice).options(
            selectinload(SalesInvoice.order),
            selectinload(SalesInvoice.customer),
            selectinload(SalesInvoice.receipts),
        )

    def save_receipt(self, receipt: PaymentReceipt) -> PaymentReceipt:
        self.db.add(receipt)
        self._commit()
        self.db.refresh(receipt)
        return self.get_receipt(receipt.id) or receipt

    def _receipt_stmt(self):
        return select(PaymentReceipt).options(
            selectinload(PaymentReceipt.payment_voucher),
            selectinload(PaymentReceipt.sales_invoice),
            selectinload(PaymentReceipt.company_bank_account),
            selectinload(PaymentReceipt.attachments),
            selectinload(PaymentReceipt.muc_thu_chi),
            selectinload(PaymentReceipt.lines).options(
                selectinload(PaymentReceiptLine.sales_invoice), selectinload(PaymentReceiptLine.order)
            ),
        )

    # --- receipt attachments ------------------------------------------------

    def list_receipt_attachments(self, payment_receipt_id: int) -> list[PaymentReceiptAttachment]:
        return list(
            self.db.execute(
                select(PaymentReceiptAttachment)
                .where(PaymentReceiptAttachment.payment_receipt_id == payment_receipt_id)
                .order_by(
                    PaymentReceiptAttachment.uploaded_at,
                    PaymentReceiptAttachment.id,
                )
            ).scalars()
        )

    def get_receipt_attachment(self, attachment_id: int) -> PaymentReceiptAttachment | None:
        return self.db.get(PaymentReceiptAttachment, attachment_id)

    def save_receipt_attachment(
        self, attachment: PaymentReceiptAttachment
    ) -> PaymentReceiptAttachment:
        self.db.add(attachment)
        self._commit()
        self.db.refresh(attachment)
        return attachment

    def delete_receipt_attachment(self, attachment: PaymentReceiptAttachment) -> None:
        self.db.delete(attachment)
        self._commit()

    def save_voucher(self, voucher: PaymentVoucher) -> PaymentVoucher:
        self.db.add(voucher)
        self._commit()
        self.db.refresh(voucher)
        return self.get_voucher(voucher.id) or voucher

    # --- voucher attachments ------------------------------------------------

    def list_attachments(self, payment_voucher_id: int) -> list[PaymentVoucherAttachment]:
        return list(
            self.db.execute(
                select(PaymentVoucherAttachment)
                .where(PaymentVoucherAttachment.payment_voucher_id == payment_voucher_id)
                .order_by(
                    PaymentVoucherAttachment.uploaded_at,
                    PaymentVoucherAttachment.id,
                )
            ).scalars()
        )

    def get_attachment(self, attachment_id: int) -> PaymentVoucherAttachment | None:
        return self.db.get(PaymentVoucherAttachment, attachment_id)

    def save_attachment(self, attachment: PaymentVoucherAttachment) -> PaymentVoucherAttachment:
        self.db.add(attachment)
        self._commit()
        self.db.refresh(attachment)
        return attachment

    def delete_attachment(self, attachment: PaymentVoucherAttachment) -> None:
        self.db.delete(attachment)
        self._commit()

    def _voucher_stmt(self):
        return select(PaymentVoucher).options(
            selectinload(PaymentVoucher.purchase_request).selectinload(PurchaseRequest.lines),
            selectinload(PaymentVoucher.purchase_request)
            .selectinload(PurchaseRequest.sources)
            .selectinload(PurchaseRequestSource.department_request),
            # Các phiếu chi anh em cùng PMH — tính "PMH đã chi" cho dải nhóm.
            selectinload(PaymentVoucher.purchase_request).selectinload(PurchaseRequest.khoan_chi)
            .selectinload(PaymentVoucherLine.voucher),
            selectinload(PaymentVoucher.lines).selectinload(PaymentVoucherLine.purchase_request)
            .selectinload(PurchaseRequest.deliveries),
            # Đợt giao + dòng đợt của đơn mua — `purchase_money` đọc cả hai; thiếu là mỗi phiếu tự
            # SELECT dòng đợt từng đợt (N+1, đo 26/10/2026).
            selectinload(PaymentVoucher.purchase_request).selectinload(PurchaseRequest.deliveries)
            .selectinload(PurchaseDelivery.lines),
            selectinload(PaymentVoucher.order),
            selectinload(PaymentVoucher.supplier),
            selectinload(PaymentVoucher.company_bank_account),
            selectinload(PaymentVoucher.supplier_bank_account),
            selectinload(PaymentVoucher.receipts),
            selectinload(PaymentVoucher.attachments),
            selectinload(PaymentVoucher.muc_thu_chi),
            selectinload(PaymentVoucher.customer),
        )

    def _commit(self) -> None:
        try:
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
