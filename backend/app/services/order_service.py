"""Đơn hàng bán — OrderService (nghiệp vụ khâu ④ CHỐT ĐƠN), redesign-don-hang-ban.md P1.

Tầng nghiệp vụ: tạo đơn TỪ BÁO GIÁ khách đã đồng ý + snapshot dòng copy-on-write + list/get/
update (chỉ khi nháp). Chốt/cọc/hủy = P2–P5. Đọc báo giá qua SEAM-04 (QuotationRepository).

ĐÃ GỠ: đường tạo đơn NHẬP TAY và toàn bộ luồng DUYỆT đơn đặc thù. `needs_approval` chỉ từng được
bật bởi đúng đường nhập tay, nên bỏ nhập tay là luồng duyệt hết nguồn dữ liệu. Cột DB
(`source_type`, `order_nature`, `invoice_entity_*`, `needs_approval`, `approval_state`) và bảng
`order_approvals` GIỮ NGUYÊN — dự án không có Alembic, và đơn `nhap_tay` cũ vẫn phải đọc được.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..models.order import (
    ATTACH_KIND_CONSENT,
    APPROVAL_STATE_NONE,
    COST_BASIS_QUOTE,
    FAULT_KHACH,
    FAULT_XUONG,
    ORDER_KIND_BO_SUNG,
    SOURCE_BAO_GIA,
    STATUS_CANCELLED,
    STATUS_DRAFT,
    STATUS_ORDERED,
    Order,
    OrderAttachment,
)
from ..models.phieu_tinh_gia import PhieuThanhPhan
from ..models.quotation import STATUS_ACCEPTED, Quote
from ..models.user import User
from ..repositories.accounting_repo import AccountingRepository
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.order_repo import LocDonHang, OrderRepository
from ..repositories.org_scope import chu_cua
from ..repositories.quotation_repo import QuotationRepository
from .thanh_pham_khai_bao import ThanhPhamKhacKhach, cum_ban, khai_cho_don, ma_don_vi
from ..schemas.order import (
    EnumOption,
    MonSanXuatOut,
    OrderActivityItem,
    OrderActivityOut,
    AttachmentOut,
    OrderDepositReceiptOut,
    OrderDetailOut,
    OrderEnumsOut,
    OrderLineOut,
    OrderListOut,
    OrderRow,
    OrderStatsOut,
)
from ..storage import get_storage, key_from_url, make_key, url_from_key
from .accounting_service import AccountingService, AccountingValidationError
from .coc import co_coc, coc_phai_thu


class OrderError(Exception):
    """Base — router maps to HTTP."""


class OrderNotFound(OrderError):
    pass


class OrderForbidden(OrderError):
    pass


class OrderValidationError(OrderError):
    pass


class OrderConflict(OrderError):
    pass


_STATUS_LABELS = {
    STATUS_DRAFT: "Nháp",
    STATUS_ORDERED: "Đã chốt",
    STATUS_CANCELLED: "Hủy",
}
# Đơn mới chỉ có MỘT nguồn, nhưng nhãn giữ cả `nhap_tay` để đơn cũ trong DB còn đọc ra chữ đúng.
_SOURCE_LABELS = {SOURCE_BAO_GIA: "Từ báo giá", "nhap_tay": "Nhập giá tay"}
_HINH_THUC_THU = {"cash": "tiền mặt", "bank_transfer": "chuyển khoản"}
_LOI_TAI = {"khach": "khách hàng", "xuong": "xưởng in"}


def _tien_vn(v) -> str:
    return f"{int(v):,}".replace(",", ".")


def _chu_nhat_ky(detail: str | None) -> str | None:
    """Vết cũ ghi mã máy ("(bank_transfer)", "500,000đ", "(lỗi khach)") — dịch lúc trả về cho ngăn đơn."""
    if not detail:
        return detail
    import re

    m = re.fullmatch(r"Thu cọc ([\d,]+)đ \((\w+)\)(?: — đơn \S+)?", detail)
    if m:
        return f"Thu cọc {m.group(1).replace(',', '.')} bằng {_HINH_THUC_THU.get(m.group(2), m.group(2))}"
    return re.sub(r"\(lỗi (khach|xuong)\)", lambda x: f"(lỗi tại {_LOI_TAI[x.group(1)]})", detail)


def _i(x) -> int:
    """Numeric/Decimal → int (làm tròn)."""
    return int(round(float(x))) if x is not None else 0


# --- Đính kèm: bytes đi qua kho file dùng chung, đọc lại qua /api/files --------
_MAX_ATTACH_BYTES = 10 * 1024 * 1024
_MAX_ATTACH_PER = 20


def _save_attachment(subdir: str, owner_id: int, file_name, content_type, data: bytes) -> tuple[str, str, int]:
    ct = (content_type or "").lower()
    if not (ct.startswith("image/") or ct == "application/pdf"):
        raise OrderValidationError("Chỉ nhận ảnh (image/*) hoặc PDF")
    if not data:
        raise OrderValidationError("Tệp rỗng")
    if len(data) > _MAX_ATTACH_BYTES:
        raise OrderValidationError("Tệp vượt quá 10 MB")
    key, safe = make_key(subdir, owner_id, file_name)
    get_storage().save(key, data, content_type)
    return url_from_key(key), safe, len(data)


def _unlink_attachment(url: str) -> None:
    key = key_from_url(url)
    if key:
        get_storage().delete(key)


def _bac_hoa_hong_cua_sale(db, sale_user_id, *, on: date | None = None) -> list[dict] | None:
    """BIỂU BẬC hoa hồng ĐANG hiệu lực của người phụ trách đơn tại ngày `on` (mặc định hôm nay), để
    chụp vào đơn (thay % phẳng từ 23/10/2026 — xem `services/bac_hoa_hong.py`).

    Đọc `employee_salaries` (bảng versioned) qua `employees.user_id` — đơn ghi USER, mức lương thì
    treo ở EMPLOYEE. Không tìm được người / chưa khai biểu ⇒ None, tức đơn không có hoa hồng.

    ⚠️ PHẢI chặn `effective_from <= on`: nhân sự khai trước "từ 01/12 đổi biểu" là chuyện thường;
    không chặn thì đơn chốt HÔM NAY chụp luôn biểu của tháng sau. Engine lương tra mức đúng kiểu này
    (`latest_salaries_map(on)`). Hoà ngày thì bản lưu SAU thắng (`id` lớn hơn).
    """
    if not sale_user_id:
        return None
    from ..models.employee import Employee
    from ..models.payroll import EmployeeSalary

    emp = db.query(Employee).filter(Employee.user_id == int(sale_user_id)).first()
    if emp is None:
        return None
    ms = (db.query(EmployeeSalary)
            .filter(EmployeeSalary.employee_id == emp.id,
                    EmployeeSalary.effective_from <= (on or date.today()))
            .order_by(EmployeeSalary.effective_from.desc(), EmployeeSalary.id.desc())
            .first())
    return getattr(ms, "bac_hoa_hong", None) or None


def _chup_hoa_hong(order, db) -> None:
    """Chụp biểu hoa hồng của người phụ trách vào đơn lúc CHỐT. Đơn đã có biểu thì giữ nguyên —
    `confirm` chạy lại cũng không đổi số đã chụp."""
    if order.bac_hoa_hong is None:
        order.bac_hoa_hong = _bac_hoa_hong_cua_sale(db, order.sale_user_id)


#: Trường sửa được ở đơn nháp → nhãn ghi nhật ký (#52: nhật ký nói đúng trường đã đổi).
_NHAN_SUA_DON = {
    "customer_po_no": "PO khách", "delivery_committed_date": "ngày hẹn giao",
    "deposit_pct": "% cọc", "deposit_amount": "tiền cọc", "delivery_address": "địa chỉ giao", "delivery_contact_name": "người nhận",
    "delivery_contact_phone": "điện thoại người nhận", "delivery_note": "ghi chú giao hàng",
    "production_note": "lưu ý sản xuất", "is_rush": "đơn gấp",
}


class OrderService:
    def __init__(
        self,
        repo: OrderRepository,
        audit: AuditLogRepository,
        quotations: QuotationRepository,
        db: Session,
        accounting_repo: AccountingRepository,
        accounting: AccountingService,
    ) -> None:
        self.repo = repo
        self.audit = audit
        self.quotations = quotations
        self.db = db
        # Bật khi `_tu_chuyen_sx` vừa chuyển đơn xuống SX trong request này (router báo Kế hoạch).
        self.vua_chuyen_sx = False
        # V5: cọc = PaymentReceipt (Kế toán). accounting_repo → đọc Σ received + list phiếu; accounting
        # (service) → LẬP phiếu thu cọc. Cùng Session request-scoped nên chung transaction.
        self.accounting_repo = accounting_repo
        self.accounting = accounting

    # --- helpers ------------------------------------------------------------
    def _user_names(self, ids: list[int]) -> dict[int, str]:
        ids = [i for i in {i for i in ids} if i]
        if not ids:
            return {}
        rows = self.db.query(User.id, User.name).filter(User.id.in_(ids)).all()
        return {uid: name for uid, name in rows}

    def _quote_codes(self, ids: list[int | None]) -> dict[int, str]:
        """Map quotation_id → mã báo giá (quote_number) để hiển thị 'Nguồn'.

        MỘT câu cho cả trang. Trước đây lặp `get_by_id` từng báo giá → N+1.
        """
        qids = {i for i in ids if i}
        if not qids:
            return {}
        rows = self.db.query(Quote.id, Quote.quote_number).filter(Quote.id.in_(qids)).all()
        return {qid: code for qid, code in rows}

    def _money(self, order: Order, *, agg: dict | None = None,
               received: int | None = None) -> dict:
        """Các số tiền suy diễn của 1 đơn (dùng chung cho row + detail).

        `agg`/`received` là số ĐÃ TÍNH SẴN theo lô cho cả trang danh sách (repo.money_sums +
        accounting_repo.received_deposit_sums). Truyền vào thì hàm này KHÔNG chạm DB — đó là
        cách gỡ N+1 ở màn danh sách. Bỏ trống (đường detail 1 đơn) thì tự truy vấn như cũ.
        """
        if agg is None:
            total = self.repo.line_total_sum(order.id)
            total_with_vat = self.repo.total_with_vat(order.id)
            order_cost = self.repo.order_cost_sum(order.id)
        else:
            # Đơn không có dòng nào thì vắng mặt trong map → mặc định ĐÚNG như bản lẻ.
            total = agg.get("total")
            total_with_vat = agg.get("total_with_vat", 0)
            order_cost = agg.get("order_cost")
        # V5: cọc đọc từ phiếu thu THẬT (Kế toán) — Σ PaymentReceipt(order, source=đơn, received).
        if received is None:
            received = self.accounting_repo.received_deposit_sum(order.id)
        required = coc_phai_thu(order.deposit_pct, order.deposit_amount, total_with_vat)
        # biên: chỉ khi có giá vốn (cost_basis=quote) + có total
        margin = None
        if order.cost_basis == COST_BASIS_QUOTE and order_cost is not None and total:
            margin = round((total - order_cost) * 100 / total)
        return dict(
            total=total,
            total_with_vat=total_with_vat,
            order_cost=order_cost,
            deposit_received=received,
            deposit_required=required,
            deposit_ok=(required == 0) or (received >= required),
            margin_pct=margin,
        )

    def _confirm_gate(self, order: Order) -> tuple[bool, list[str]]:
        """Cổng chốt (§8): trả (đủ điều kiện?, danh sách còn thiếu). Đọc-được cho FE + chặn confirm."""
        blockers: list[str] = []
        if order.status != STATUS_DRAFT:
            return False, ["Đơn không ở trạng thái nháp"]
        # (a) báo giá còn duyệt & còn hạn (chỉ nguồn báo giá)
        if order.source_type == SOURCE_BAO_GIA:
            quote = self.quotations.get_by_id(order.quotation_id) if order.quotation_id else None
            if quote is None or quote.status not in (STATUS_ACCEPTED, "converted_to_order"):
                blockers.append("Báo giá chưa được khách đồng ý")
            elif quote.valid_until and quote.valid_until < date.today():
                blockers.append("Báo giá đã hết hạn — cần báo giá lại")
        # (b) CỌC KHÔNG còn là cổng chốt — Chốt = chốt THÔNG TIN; thu tiền cọc là bước SAU chốt
        # (kế toán thu → Sales "Chuyển xuống SX"). Chỉ cần đủ THÔNG TIN dưới đây để chốt.
        # (c) đủ PO + ngày giao
        if not order.customer_po_no:
            blockers.append("Thiếu số PO khách")
        if not order.delivery_committed_date:
            blockers.append("Thiếu ngày giao cam kết")
        # còn dòng chưa định giá → tổng/cọc bị thiếu, chặn chốt
        if self.repo.unpriced_line_count(order.id) > 0:
            blockers.append("Còn dòng chưa định giá")
        # (d) chứng cứ khách đồng ý: đơn giờ LUÔN từ báo giá accepted — chính báo giá là chứng cứ,
        #     nên cổng "thiếu đính kèm" (chỉ áp cho đơn nhập tay) đã bỏ cùng đường nhập tay.
        # (e/f) cổng "đơn đặc thù chưa được duyệt" đã bỏ cùng luồng duyệt.
        # (g) ĐVT mỗi món bán phải có trong danh mục Đơn vị: chốt xong hệ khai Thành phẩm với
        #     ĐVT đó (`khai_cho_don`). Không tra ra mã thì món mang đơn vị TRỐNG và chỉ lộ ra ở
        #     tận lúc nhập kho thành phẩm — chặn ngay tại đây cho sale thấy sớm.
        for cum in cum_ban(order):
            dvt = (cum.dvt or "").strip()
            if not dvt:
                blockers.append(f"«{cum.ten}» chưa có ĐVT")
            elif ma_don_vi(self.db, dvt) is None:
                blockers.append(
                    f"ĐVT «{dvt}» của «{cum.ten}» không có trong danh mục Đơn vị — thêm ở "
                    f"Cấu hình danh mục ▸ Đơn vị & quy đổi rồi chốt lại"
                )
        return (len(blockers) == 0), blockers

    def _row(self, order: Order, customer_name: str | None, sale_name: str | None,
             quotation_code: str | None = None, *, agg: dict | None = None,
             received: int | None = None,
             line_sum: tuple[str, int] | None = None, refunded: int = 0,
             tien_khach: tuple[int, int] = (0, 0)) -> OrderRow:
        m = self._money(order, agg=agg, received=received)
        return OrderRow(
            id=order.id,
            order_no=order.order_no,
            customer_id=order.customer_id,
            customer_name=customer_name,
            quotation_id=order.quotation_id,
            quotation_code=quotation_code,
            source_type=order.source_type,
            order_kind=order.order_kind,
            status=order.status,
            cost_basis=order.cost_basis,
            total=m["total"],
            total_with_vat=m["total_with_vat"],
            deposit_pct=order.deposit_pct,
            deposit_amount=order.deposit_amount,
            deposit_required=m["deposit_required"],
            deposit_received=m["deposit_received"],
            deposit_ok=m["deposit_ok"],
            deposit_refunded=refunded,
            tien_khach_da_nhan=tien_khach[0],
            tien_khach_con_giu=tien_khach[1],
            delivery_committed_date=order.delivery_committed_date,
            is_rush=order.is_rush,
            sale_user_id=order.sale_user_id,
            sale_name=sale_name,
            created_at=order.created_at,
            ordered_at=order.ordered_at,
            customer_po_no=order.customer_po_no,
            san_xuat_released_at=order.san_xuat_released_at,
            first_line_desc=(line_sum[0] or None) if line_sum else None,
            line_count=line_sum[1] if line_sum else 0,
        )

    def _detail(self, order: Order) -> OrderDetailOut:
        cust_name = None
        if order.customer_id:
            from ..models.customer import Customer

            c = self.db.get(Customer, order.customer_id)
            cust_name = c.name if c else None
        names = self._user_names([order.sale_user_id, order.ordered_by])
        m = self._money(order)
        # V5: danh sách phiếu thu cọc (PaymentReceipt nguồn đơn) — thay bản ghi OrderDeposit cũ.
        # Phiếu gộp nhiều đơn: chỉ phần cọc của ĐƠN NÀY (dòng phân bổ), không phải cả phiếu.
        deposits = [
            OrderDepositReceiptOut(
                id=r.id, code=r.code, doc_no=r.doc_no,
                amount=sum(int(l.amount_vnd) for l in r.lines
                           if l.order_id == order.id and l.sales_invoice_id is None),
                receipt_method=r.receipt_method, status=r.status,
                receipt_date=r.receipt_date, created_at=r.created_at,
                gop=len(r.lines) > 1, tong_phieu=int(r.amount_vnd),
            )
            for r in self.accounting_repo.list_order_receipts(order.id)
        ]
        atts = [a for a in order.attachments if a.kind == ATTACH_KIND_CONSENT]
        nguoi_tai = self._user_names([a.uploaded_by for a in atts])
        consent_atts = [
            AttachmentOut(id=a.id, url=a.file_url, file_name=a.file_name,
                          content_type=a.content_type, uploaded_at=a.uploaded_at,
                          size_bytes=a.size_bytes or 0, uploaded_by_name=nguoi_tai.get(a.uploaded_by))
            for a in atts
        ]
        can_confirm, blockers = self._confirm_gate(order)
        da_tra_lai = (self.accounting_repo.coc_da_tra_lai(order.id)
                      if order.status == STATUS_CANCELLED else 0)
        tien_khach = self._tien_khach_don_huy([order.id] if order.status == STATUS_CANCELLED else [],
                                              {order.id: m["deposit_received"]}).get(order.id, (0, 0))
        q_code = None
        quote_expired = False
        if order.quotation_id:
            qq = self.quotations.get_by_id(order.quotation_id)
            q_code = qq.quote_number if qq else None
            # Việc 4: cờ có cấu trúc để FE bật nút "Gia hạn báo giá" — khớp ĐÚNG blocker hết-hạn ở
            # cổng chốt (đơn nháp nguồn báo giá + báo giá accepted đã quá hạn), khỏi dò chuỗi.
            quote_expired = bool(
                order.status == STATUS_DRAFT
                and order.source_type == SOURCE_BAO_GIA
                and qq is not None
                and qq.status in (STATUS_ACCEPTED, "converted_to_order")
                and qq.valid_until and qq.valid_until < date.today()
            )
        return OrderDetailOut(
            # Truyền số tiền ĐÃ TÍNH ở trên: để trống thì `_row` gọi `_money` lần nữa ⇒ bốn câu SUM
            # chạy hai lần mỗi lần mở ngăn đơn (13/10/2026).
            **self._row(order, cust_name, names.get(order.sale_user_id), q_code,
                        agg={k: m[k] for k in ("total", "total_with_vat", "order_cost")},
                        received=m["deposit_received"], refunded=da_tra_lai,
                        tien_khach=tien_khach).model_dump(),
            quotation_version=order.quotation_version,
            quotation_effective_from=order.quotation_effective_from,
            parent_order_id=order.parent_order_id,
            delivery_address=order.delivery_address,
            delivery_contact_name=order.delivery_contact_name,
            delivery_contact_phone=order.delivery_contact_phone,
            delivery_note=order.delivery_note,
            production_note=order.production_note,
            vat_pct_estimate=order.vat_pct_estimate,
            lines=[OrderLineOut.model_validate(ln) for ln in order.lines],
            order_cost=m["order_cost"],
            margin_pct=m["margin_pct"],
            cancel_reason=order.cancel_reason,
            cancel_fault=order.cancel_fault,
            deposits=deposits,
            consent_attachments=consent_atts,
            can_confirm=can_confirm,
            confirm_blockers=blockers,
            quote_expired=quote_expired,
            ordered_by_name=names.get(order.ordered_by) if order.ordered_by else None,
        )

    # --- reads --------------------------------------------------------------
    def _ap_dang_cho(self, *, actor, scope: str, q: str | None, order_kind: str | None,
                     nguoi: int | None, loc: LocDonHang | None) -> LocDonHang | None:
        """Bộ lọc "Đang chờ" suy từ lệnh / gia công / kho / giao / hoá đơn — không viết được bằng
        một điều kiện SQL. Tính trên tập đơn đã chốt khớp các điều kiện khác, rồi đưa tập id xuống
        repo qua `chi_id` để phân trang + đếm tab vẫn ở máy chủ."""
        if loc is None or not loc.dang_cho:
            return loc
        from dataclasses import replace

        from .don_hang_san_xuat import CHO_TRA_COC, tom_tat_nhieu_don

        if loc.dang_cho == CHO_TRA_COC:
            huy = self.repo.don_huy_khop(scope=scope, actor=actor, q=q, order_kind=order_kind,
                                         nguoi=nguoi, loc=loc)
            return replace(loc, chi_id=self._con_giu_coc(huy))

        ung_vien = self.repo.don_da_chot_khop(scope=scope, actor=actor, q=q, order_kind=order_kind,
                                              nguoi=nguoi, loc=loc)
        tom = tom_tat_nhieu_don(self.db, ung_vien)
        return replace(loc, chi_id=sorted(i for i, t in tom.items() if loc.dang_cho in t["dang_cho"]))

    def dem_dang_cho(self, *, actor, scope: str) -> dict[str, int]:
        """Số đơn theo từng giá trị "Đang chờ" trong tầm nhìn — số đếm của menu lọc."""
        from .don_hang_san_xuat import CHO_TAT_CA, CHO_TRA_COC, tom_tat_nhieu_don

        tom = tom_tat_nhieu_don(self.db, self.repo.don_da_chot_khop(scope=scope, actor=actor))
        dem = {c: sum(1 for t in tom.values() if c in t["dang_cho"]) for c in CHO_TAT_CA}
        dem[CHO_TRA_COC] = len(self._con_giu_coc(self.repo.don_huy_khop(scope=scope, actor=actor)))
        return dem

    def _tien_khach_don_huy(self, huy_ids: list[int], coc: dict[int, int]) -> dict[int, tuple[int, int]]:
        """`{order_id: (tiền khách đã đưa, còn giữ)}` cho các đơn ĐÃ HUỶ — `coc` = cọc đã thu đã nạp sẵn."""
        if not huy_ids:
            return {}
        from .ban_hang_cho_thu_chi import tien_cho_tra_lai

        thu_hd = self.accounting_repo.thu_hoa_don_huy_theo_don(huy_ids)
        con = {r["order_id"]: r["con_lai"] for r in tien_cho_tra_lai(self.accounting_repo, huy_ids)}
        return {i: (coc.get(i, 0) + thu_hd.get(i, 0), con.get(i, 0)) for i in huy_ids}

    def _con_giu_coc(self, order_ids: list[int]) -> list[int]:
        """Trong các đơn (đã huỷ) cho vào, đơn nào còn giữ tiền khách: cọc + tiền hoá đơn đã huỷ −
        đã trả lại > 0 — cùng phép tính hàng "Chờ trả lại khách" của Phiếu chi (17/10/2026). Không
        có ca "chuyển cọc sang đơn khác" (chủ chốt 13/10/2026) nên tiền còn giữ chỉ có một lối ra là
        phiếu chi trả lại."""
        if not order_ids:
            return []
        from .ban_hang_cho_thu_chi import tien_cho_tra_lai

        return sorted(r["order_id"] for r in tien_cho_tra_lai(self.accounting_repo, order_ids)
                      if r["don_huy"])

    def list(
        self, *, actor, scope: str, q: str | None, status: str | None,
        order_kind: str | None, sort: str, page: int, size: int, nguoi: int | None = None,
        loc: LocDonHang | None = None,
    ) -> OrderListOut:
        loc = self._ap_dang_cho(actor=actor, scope=scope, q=q, order_kind=order_kind, nguoi=nguoi, loc=loc)
        rows, total, names, _totals = self.repo.list(
            scope=scope, actor=actor, q=q, status=status, order_kind=order_kind,
            sort=sort, page=page, size=size, nguoi=nguoi, loc=loc,
        )
        sale_names = self._user_names([r.sale_user_id for r in rows])
        q_codes = self._quote_codes([r.quotation_id for r in rows])
        # Gỡ N+1: 4 tổng tiền của MỌI đơn trên trang lấy bằng 2 câu gộp, thay vì 4 câu mỗi đơn.
        order_ids = [r.id for r in rows]
        sums = self.repo.money_sums(order_ids)
        received = self.accounting_repo.received_deposit_sums(order_ids)
        line_sums = self.repo.line_summaries(order_ids)
        from .don_hang_san_xuat import tom_tat_nhieu_don

        sx = tom_tat_nhieu_don(self.db, rows)
        # Đơn huỷ: đã trả lại cọc bao nhiêu (một câu cho cả trang); còn giữ thì đơn "chờ trả lại cọc".
        from .don_hang_san_xuat import CHO_TRA_COC

        huy = [o.id for o in rows if o.status == STATUS_CANCELLED]
        tra = self.accounting_repo.coc_da_tra_lai_nhieu(huy)
        tien_khach = self._tien_khach_don_huy(huy, received)
        items = []
        for o in rows:
            dang_cho = sx.get(o.id, {}).get("dang_cho", [])
            if tien_khach.get(o.id, (0, 0))[1] > 0:
                dang_cho = [CHO_TRA_COC]
            items.append(self._row(o, names.get(o.id), sale_names.get(o.sale_user_id),
                                   q_codes.get(o.quotation_id),
                                   agg=sums.get(o.id, {}), received=received.get(o.id, 0),
                                   line_sum=line_sums.get(o.id), refunded=tra.get(o.id, 0),
                                   tien_khach=tien_khach.get(o.id, (0, 0))).model_copy(update={
                "san_xuat_mon": [MonSanXuatOut(**m) for m in sx.get(o.id, {}).get("mon", [])],
                "dang_cho": dang_cho,
            }))
        ids = self.repo.ids_khop_cuoi
        return OrderListOut(items=items, total=total, page=page, size=size,
                            tong_gia_tri=self.repo.tong_gia_tri(ids) if total else 0,
                            tong_coc=self.accounting_repo.tong_coc_da_thu(ids) if total else 0)

    def stats(
        self, *, actor, scope: str, nguoi: int | None = None, q: str | None = None,
        order_kind: str | None = None, loc: LocDonHang | None = None,
    ) -> OrderStatsOut:
        from ..models.order import STATUS_DRAFT, STATUS_ORDERED

        # Số trên thanh tab theo bộ lọc đang áp; KPI tiền bên dưới giữ nguyên nghĩa cũ (cả tầm nhìn).
        loc = self._ap_dang_cho(actor=actor, scope=scope, q=q, order_kind=order_kind, nguoi=nguoi, loc=loc)
        counts = self.repo.stats(scope=scope, actor=actor, nguoi=nguoi, q=q, order_kind=order_kind, loc=loc)
        # KPI tiền: dùng CÙNG công thức _money (required = round(pct·twv/100), received từ phiếu thu)
        # nên số KPI = tổng đúng số hiện trên từng dòng.
        rows = self.repo.value_rows(scope=scope, actor=actor, statuses=(STATUS_DRAFT, STATUS_ORDERED),
                                    nguoi=nguoi)
        received = self.accounting_repo.received_deposit_sums(list(rows.keys()))
        awaiting = shortfall = ordered_value = 0
        for oid, r in rows.items():
            twv = r["total_with_vat"]
            required = coc_phai_thu(r["deposit_pct"], r["deposit_amount"], twv)
            if r["status"] == STATUS_ORDERED:
                ordered_value += twv
            elif r["status"] == STATUS_DRAFT and required > 0 and received.get(oid, 0) < required:
                awaiting += 1
                shortfall += required - received.get(oid, 0)
        return OrderStatsOut(
            **counts,
            awaiting_deposit=awaiting,
            deposit_shortfall=shortfall,
            ordered_value=ordered_value,
        )

    def dem_theo_khach(self, *, actor, scope: str) -> list[tuple[int, str, int]]:
        return self.repo.dem_theo_khach(scope=scope, actor=actor)

    def get(self, *, order_id: int, actor, scope: str) -> OrderDetailOut:
        order = self.repo.get_with_lines(order_id)
        if order is None:
            raise OrderNotFound("Không tìm thấy đơn hàng")
        if not self.repo.can_access(order=order, scope=scope, actor=actor):
            raise OrderNotFound("Không tìm thấy đơn hàng")  # ngoài vùng = 404
        return self._detail(order)

    def tien_do(self, *, order_id: int, actor, scope: str) -> dict:
        """Tiến độ một đơn (ô Sản xuất / Giao của ngăn đơn), cùng cổng đọc + phạm vi với chi tiết đơn.
        Chỉ KIỂM vùng, không dựng chi tiết: trước 06/10/2026 router gọi `get()` để kiểm quyền nên mỗi
        lần mở ngăn đơn máy chủ dựng chi tiết đơn HAI lần (một cho ngăn, một vứt đi ở đây)."""
        from .don_hang_tien_do import tien_do_don

        order = self.repo.get_by_id(order_id)
        if order is None or not self.repo.can_access(order=order, scope=scope, actor=actor):
            raise OrderNotFound("Không tìm thấy đơn hàng")  # ngoài vùng = 404
        return tien_do_don(self.db, order)

    def phieu_xuat_in(self, *, order_id: int, yeu_cau_id: int, actor, scope: str) -> dict:
        """Dữ liệu in phiếu xuất kho bán hàng / 02-VT của một yêu cầu giao — cùng cổng đọc + phạm vi
        với chi tiết đơn (ai thấy giá bán của đơn thì in được tờ có giá)."""
        from .phieu_xuat_ban_hang import du_lieu_in_phieu_xuat

        order = self.repo.get_by_id(order_id)
        if order is None or not self.repo.can_access(order=order, scope=scope, actor=actor):
            raise OrderNotFound("Không tìm thấy đơn hàng")
        return du_lieu_in_phieu_xuat(self.db, order, yeu_cau_id)

    def activity(self, *, order_id: int, actor, scope: str) -> OrderActivityOut:
        order = self.repo.get_by_id(order_id)
        if order is None or not self.repo.can_access(order=order, scope=scope, actor=actor):
            raise OrderNotFound("Không tìm thấy đơn hàng")
        # Vết "push_production" cũ (ghi lúc chốt, kể cả khi còn chờ cọc) trùng với vết chuyển xuống sản
        # xuất thật ⇒ không bày ra nhật ký của đơn nữa.
        logs = [lg for lg in self.audit.list_by_target(f"order:{order_id}", limit=200)
                if lg.action != "push_production"]
        names = self._user_names([lg.actor_user_id for lg in logs])
        items = [
            OrderActivityItem(
                at=lg.created_at, actor_id=lg.actor_user_id,
                actor_name=names.get(lg.actor_user_id), action=lg.action, detail=_chu_nhat_ky(lg.detail),
            )
            for lg in logs
        ]
        return OrderActivityOut(items=items)

    def enums(self) -> OrderEnumsOut:
        return OrderEnumsOut(
            statuses=[EnumOption(value=v, label=lb) for v, lb in _STATUS_LABELS.items()],
        )

    # --- writes -------------------------------------------------------------
    def create(self, *, actor, scope: str, payload) -> OrderDetailOut:
        """Đơn CHỈ sinh từ báo giá khách đã đồng ý — không còn nhánh nào khác."""
        if payload.order_kind == ORDER_KIND_BO_SUNG and not payload.parent_order_id:
            raise OrderValidationError("Đơn bổ sung phải trỏ đơn gốc (giữ kẽm)")
        if payload.deposit_pct is not None and not 0 <= payload.deposit_pct <= 100:
            raise OrderValidationError("% cọc phải trong khoảng 0–100")

        order = self._create_from_quotation(actor=actor, payload=payload)

        self.audit.create(
            actor_user_id=actor.id,
            action="create_order",
            target=f"order:{order.id}",
            detail=f"Tạo đơn {order.order_no} ({_SOURCE_LABELS.get(order.source_type, order.source_type)})",
        )
        return self._detail(order)

    def _create_from_quotation(self, *, actor, payload) -> Order:
        if not payload.quotation_id:
            raise OrderValidationError("Thiếu báo giá nguồn")
        quote: Quote | None = self.quotations.get_by_id(payload.quotation_id)
        if quote is None:
            raise OrderValidationError("Không tìm thấy báo giá")
        if quote.status != STATUS_ACCEPTED:
            raise OrderValidationError("Báo giá chưa được khách đồng ý (accepted)")
        if self.repo.active_order_for_quotation(quote.id) is not None:
            raise OrderConflict("Báo giá này đã có đơn (1 báo giá → 1 đơn)")
        version = next((v for v in quote.versions if v.id == quote.current_version_id), None)
        if version is None:
            raise OrderValidationError("Báo giá chưa có phiên bản hiệu lực")

        # Khách chốt MỘT PHẦN: chỉ kéo dòng khách ƯNG (accepted=True). Fallback: 0 dòng True → kéo TẤT
        # CẢ — an toàn cho báo giá cũ chốt trước khi có cột `accepted` (service accept bắt buộc ≥1 dòng
        # True nên báo giá mới luôn có ít nhất 1).
        accepted_items = [it for it in version.items if getattr(it, "accepted", False)]
        source_items = accepted_items if accepted_items else list(version.items)

        lines = []
        for it in sorted(source_items, key=lambda x: x.line_no):
            # line_total = giá bán trước VAT = final_amount − vat_amount, ĐÃ GỒM tiền chiết khấu (khoản
            # hoàn lại khách, chép riêng sang `chiet_khau`) — khớp đúng số trên báo giá đã ghim.
            net_line = int(round(float(it.final_amount) - float(it.vat_amount)))
            unit = int(round(net_line / it.quantity)) if it.quantity else net_line
            lines.append(dict(
                description=it.product_name or "",
                qty=it.quantity,
                don_vi_tinh=(getattr(it, "unit", None) or "cái"),   # ĐVT kéo từ dòng báo giá
                dvt_nhom=getattr(it, "dvt_nhom", None),   # ĐVT cụm khi in gộp (khớp báo giá)
                unit_price_snapshot=unit,
                line_total=net_line,
                chiet_khau=int(round(float(it.discount_amount or 0))),
                # Kê giá (20/10/2026) nằm trong line_total (giá bán sau kê) — chép riêng để chia vào hoá đơn.
                ke_gia=int(round(float(it.ke_gia or 0))),
                vat_pct_estimate=_i(it.vat_percent),
                cost_snapshot=(_i(it.total_cost_snapshot) if it.total_cost_snapshot else None),
                phieu_thanh_phan_id=it.phieu_thanh_phan_id,   # pin truy vết ấn phẩm (soft) từ dòng báo giá
                nhom=getattr(it, "nhom", None),   # nhãn gộp dòng khi in xác nhận đơn (khớp báo giá)
            ))

        order = self.repo.create(
            lines=lines,
            source_type=SOURCE_BAO_GIA,
            customer_id=quote.customer_id,
            quotation_id=quote.id,
            quotation_version=version.version_number,
            quotation_effective_from=(version.created_at.date() if version.created_at else None),
            order_kind=payload.order_kind,
            parent_order_id=payload.parent_order_id,
            # NV phụ trách đơn = người phụ trách KHÁCH (05/10/2026), thiếu mới tới người soạn báo
            # giá / người bấm. Trước đó chép thẳng người soạn báo giá: trợ lý soạn hộ thì đơn đứng
            # tên trợ lý và hoa hồng lúc chốt chụp nhầm % của trợ lý.
            sale_user_id=(chu_cua(self.db, quote.customer_id, quote.salesperson_id) or actor.id),
            status=STATUS_DRAFT,
            vat_pct_estimate=_i(version.vat_percent),
            # % cọc nhập trên đơn ưu tiên; chưa nhập thì ghim từ báo giá.
            # % cọc đặt TẠI ĐƠN (báo giá không còn giữ deposit_pct — tích hợp accounting-wip):
            # nhập trên đơn thì lấy, chưa nhập để None → Kế toán đặt lúc ghi cọc.
            deposit_pct=payload.deposit_pct,
            cost_basis=COST_BASIS_QUOTE,
            needs_approval=False,
            approval_state=APPROVAL_STATE_NONE,
            delivery_address=(payload.delivery_address or quote.delivery_address),
            customer_po_no=payload.customer_po_no,
            delivery_committed_date=payload.delivery_committed_date,
            delivery_contact_name=(payload.delivery_contact_name or quote.contact_name_snapshot),
            delivery_contact_phone=(payload.delivery_contact_phone or quote.contact_phone_snapshot),
            delivery_note=payload.delivery_note,
            production_note=payload.production_note,
            is_rush=payload.is_rush,
        )
        return order

    def update(self, *, order_id: int, actor, scope: str, payload) -> OrderDetailOut:
        order = self.repo.get_with_lines(order_id)
        if order is None or not self.repo.can_access(order=order, scope=scope, actor=actor):
            raise OrderNotFound("Không tìm thấy đơn hàng")
        if order.status != STATUS_DRAFT:
            raise OrderConflict("Đơn đã chốt/hủy — không sửa được")

        # KHÔNG gửi = giữ nguyên; GỬI `null` = xoá (#52, 18/10/2026). Trước đó mọi `None` bị bỏ qua nên
        # xoá trắng PO / ngày hẹn / % cọc rồi Lưu thì giá trị cũ ở lại, mà nhật ký vẫn ghi đã cập nhật.
        gui = payload.model_fields_set
        fields: dict = {}
        for f in _NHAN_SUA_DON:
            if f not in gui:
                continue
            val = getattr(payload, f)
            if f == "is_rush" and val is None:
                continue                      # cờ gấp không có trạng thái "trống"
            if f == "deposit_pct" and val is not None and not 0 <= val <= 100:
                raise OrderValidationError("% cọc phải trong khoảng 0–100")
            if f == "deposit_amount" and val == 0:
                val = None
            cu = getattr(order, f)
            if (float(cu) if f == "deposit_pct" and cu is not None else cu) != val:
                fields[f] = val
        # Cọc giữ MỘT cách (20/10/2026): lưu số tiền là xoá %, lưu % là xoá số tiền.
        if fields.get("deposit_amount") is not None:
            fields["deposit_pct"] = None
            tong = self.repo.total_with_vat(order.id)
            if fields["deposit_amount"] > tong:
                raise OrderValidationError(
                    f"Tiền cọc không được vượt giá trị đơn hàng ({tong:,} đ).".replace(",", "."))
        elif fields.get("deposit_pct") is not None and order.deposit_amount is not None:
            fields["deposit_amount"] = None
        if fields:
            self.repo.update(order, **fields)
            self.audit.create(
                actor_user_id=actor.id, action="update_order", target=f"order:{order.id}",
                detail=f"Cập nhật đơn {order.order_no}: " + ", ".join(_NHAN_SUA_DON[f] for f in fields),
            )
        return self._detail(self.repo.get_with_lines(order_id))

    def update_production_hint(self, *, order_id: int, actor, scope: str, payload) -> OrderDetailOut:
        """Sale đổi 'hint sản xuất' (gấp / lưu ý SX) SAU khi đơn đã CHỐT — đường HẸP duy nhất được sửa
        khi `status=ORDERED` (`update()` khóa DRAFT). Chỉ 2 field; realtime tới bàn kế hoạch do router
        phát. KHÔNG nới `update()` cũ (giữ cổng nháp cho phần còn lại của đơn)."""
        order = self.repo.get_with_lines(order_id)
        if order is None or not self.repo.can_access(order=order, scope=scope, actor=actor):
            raise OrderNotFound("Không tìm thấy đơn hàng")
        if order.status != STATUS_ORDERED:
            raise OrderConflict("Chỉ sửa lưu ý sản xuất khi đơn đã chốt")
        fields: dict = {}
        if payload.is_rush is not None:
            fields["is_rush"] = payload.is_rush
        if payload.production_note is not None:
            fields["production_note"] = payload.production_note
        if fields:
            self.repo.update(order, **fields)
        self.audit.create(
            actor_user_id=actor.id, action="update_production_hint",
            target=f"order:{order.id}", detail=f"Cập nhật lưu ý SX đơn {order.order_no}",
        )
        return self._detail(self.repo.get_with_lines(order_id))

    def release_production(self, *, order_id: int, actor, scope: str) -> OrderDetailOut:
        """Sale "Chuyển xuống sản xuất" — đơn đã CHỐT (cọc đủ theo cổng chốt) → set mốc release →
        đơn vào HÀNG CHỜ kế hoạch. NGƯỜI QUYẾT (không auto khi chốt). Idempotent: đã release → giữ
        mốc đầu, bấm lại an toàn."""
        order = self.repo.get_by_id(order_id)
        if order is None or not self.repo.can_access(order=order, scope=scope, actor=actor):
            raise OrderNotFound("Không tìm thấy đơn hàng")
        if order.status != STATUS_ORDERED:
            raise OrderConflict("Chỉ chuyển sản xuất đơn đã chốt")
        if not self._money(order)["deposit_ok"]:
            raise OrderConflict("Chưa đủ cọc — kế toán thu đủ cọc rồi mới chuyển sản xuất")
        self._tu_chuyen_sx(order, actor)
        return self._detail(self.repo.get_with_lines(order_id))

    def _tu_chuyen_sx(self, order: Order, actor) -> bool:
        """TỰ chuyển đơn xuống sản xuất khi đã CHỐT + ĐỦ CỌC (chủ chốt 04/10/2026: qua cọc là xuống
        SX luôn, không chờ Sale bấm). Gọi sau chốt và sau mỗi phiếu thu cọc. Đã chuyển thì giữ mốc
        đầu. Trả True nếu LẦN NÀY mới chuyển — router dựa vào đó để báo hàng chờ Kế hoạch."""
        if order.status != STATUS_ORDERED or order.san_xuat_released_at is not None:
            return False
        if not self._money(order)["deposit_ok"]:
            return False
        order.san_xuat_released_at = datetime.now(timezone.utc)
        self.db.commit()
        self.audit.create(
            actor_user_id=actor.id, action="release_production",
            target=f"order:{order.id}", detail=f"Chuyển đơn {order.order_no} xuống sản xuất (đủ cọc)",
        )
        self.vua_chuyen_sx = True
        return True

    def extend_source_quote(self, *, order_id: int, actor, scope: str) -> OrderDetailOut:
        """Việc 4 — Gia hạn báo giá NGUỒN ngay từ đơn (gỡ blocker 'báo giá hết hạn' ở cổng chốt).
        Gộp vào luồng đơn, KHÔNG nhảy màn: đặt lại valid_until = hôm nay + 30 ngày (đúng quy ước
        bản mới ở quotation_service:1146). Quyền = `update` (router đã chặn — Sale + TP/GĐ), scope
        kẹp qua can_access. Chỉ áp cho đơn NHÁP nguồn báo giá + báo giá accepted đã hết hạn; ghi vết
        vào audit để hiện trên timeline báo giá."""
        order = self.repo.get_by_id(order_id)
        if order is None or not self.repo.can_access(order=order, scope=scope, actor=actor):
            raise OrderNotFound("Không tìm thấy đơn hàng")
        if order.status != STATUS_DRAFT:
            raise OrderConflict("Đơn đã chốt/hủy — không cần gia hạn báo giá")
        if order.source_type != SOURCE_BAO_GIA or not order.quotation_id:
            raise OrderValidationError("Đơn nhập giá tay không gắn báo giá để gia hạn")
        quote = self.quotations.get_by_id(order.quotation_id)
        if quote is None or quote.status not in (STATUS_ACCEPTED, "converted_to_order"):
            raise OrderValidationError("Báo giá nguồn không ở trạng thái gia hạn được")
        if not (quote.valid_until and quote.valid_until < date.today()):
            raise OrderValidationError("Báo giá còn hạn — không cần gia hạn")
        new_until = date.today() + timedelta(days=30)
        quote.valid_until = new_until
        self.quotations.update(quote)
        self.audit.create(
            actor_user_id=actor.id, action="extend_quote_validity",
            target=f"quote:{quote.id}",
            detail=f"Gia hạn báo giá {quote.quote_number} tới {new_until.isoformat()} "
                   f"(từ đơn {order.order_no})",
        )
        return self._detail(self.repo.get_with_lines(order_id))

    def notify_summary(self, *, actor, scope: str,
                       can_record_deposit: bool, can_chot: bool) -> dict:
        """Số nuôi badge/toast real-time — 'việc chờ TÔI xử lý' theo vai (đơn còn NHÁP trong phạm vi):
        Kế toán = đơn chờ ghi cọc; Sale = đơn đủ điều kiện chờ chốt. Tự giảm khi người dùng thao tác
        (không cần cờ 'seen'). Đếm trên tập nháp nhỏ nên rẻ.

        `approval_pending` đã bỏ cùng luồng duyệt. Vẫn TRẢ khoá đó với giá trị 0 để client cũ
        (tab đang mở, bản FE chưa nạp lại) không vỡ khi đọc thiếu khoá."""
        deposit_pending = ready_to_confirm = 0
        drafts = list(self.repo.drafts_in_scope(scope=scope, actor=actor))
        # Gom lô như màn danh sách: 2 câu cho cả tập nháp thay vì 4 câu mỗi đơn (badge này gọi lại
        # mỗi lần mở app / có sự kiện đơn — N+1 ở đây nhân với số tab đang mở).
        ids = [o.id for o in drafts]
        sums = self.repo.money_sums(ids)
        received = self.accounting_repo.received_deposit_sums(ids)
        for o in drafts:
            m = self._money(o, agg=sums.get(o.id, {}), received=received.get(o.id, 0))
            if can_record_deposit and co_coc(o) and not m["deposit_ok"]:
                deposit_pending += 1
            if can_chot and m["deposit_ok"]:
                ready_to_confirm += 1
        return {
            "action_count": deposit_pending + ready_to_confirm,
            "approval_pending": 0,
            "deposit_pending": deposit_pending,
            "ready_to_confirm": ready_to_confirm,
        }

    # --- Cọc (V5) — Kế toán LẬP PHIẾU THU THẬT từ đơn (bước 2, SAU chốt) ------
    def add_deposit_receipt(self, *, order_id: int, actor, scope: str, payload) -> OrderDetailOut:
        """Kế toán tạo PaymentReceipt(source='don_hang_ban', received) gắn đơn. THU CỌC = BƯỚC 2 SAU
        chốt (chốt = chốt thông tin; kế toán nhận SSE khi đơn chốt → thu cọc). Cho ghi khi đơn đã CHỐT;
        chặn hủy. Quyền gate ở router = Phiếu thu → Tạo."""
        order = self.repo.get_by_id(order_id)
        if order is None or not self.repo.can_access(order=order, scope=scope, actor=actor):
            raise OrderNotFound("Không tìm thấy đơn hàng")
        if order.status == STATUS_CANCELLED:
            raise OrderConflict("Đơn đã hủy — không ghi cọc")
        customer_name = None
        if order.customer_id:
            from ..models.customer import Customer

            c = self.db.get(Customer, order.customer_id)
            customer_name = c.name if c else None
        try:
            # Cầu nối kế toán canonical (accounting-wip): lập phiếu thu 01-TT cọc đơn (Nợ 111/112·Có 131).
            phieu = self.accounting.create_order_receipt(
                order_id=order.id, order_no=order.order_no, customer_name=customer_name, actor=actor,
                receipt_method=payload.receipt_method, amount=payload.amount,
                receipt_date=(payload.receipt_date or date.today()), note=payload.note,
                company_bank_account_id=payload.company_bank_account_id,
                payer_name=payload.payer_name, payer_address=payload.payer_address,
                content=payload.content, bank_reference=payload.bank_reference,
            )
        except AccountingValidationError as exc:
            raise OrderValidationError(str(exc)) from exc
        self.audit.create(
            actor_user_id=actor.id, action="record_deposit", target=f"order:{order.id}",
            detail=f"Thu cọc {_tien_vn(payload.amount)} bằng {_HINH_THUC_THU.get(payload.receipt_method, payload.receipt_method)}",
        )
        self._tu_chuyen_sx(order, actor)
        d = self._detail(self.repo.get_with_lines(order_id))
        d.phieu_vua_lap_id = phieu["id"]
        return d

    def sau_thu_coc_ngoai(self, *, order_ids: list[int], actor) -> list[tuple[OrderDetailOut, bool]]:
        """Phiếu thu GỘP có dòng cọc (lập ở Kế toán, 17/10/2026) = thu cọc thật: chạy đúng phần sau
        phiếu của `add_deposit_receipt` cho từng đơn — tự chuyển SX khi đủ cọc. Trả (chi tiết đơn,
        lần này mới chuyển SX) để router bắn đúng tín hiệu như thu cọc lẻ."""
        ket: list[tuple[OrderDetailOut, bool]] = []
        for oid in dict.fromkeys(order_ids):
            order = self.repo.get_by_id(oid)
            if order is None:
                continue
            moi = self._tu_chuyen_sx(order, actor)
            ket.append((self._detail(self.repo.get_with_lines(oid)), moi))
        return ket

    # --- Chốt đơn (P4) — transaction compare-and-set + khóa báo giá ---------
    def confirm(self, *, order_id: int, actor, scope: str) -> OrderDetailOut:
        order = self.repo.get_by_id(order_id)
        if order is None or not self.repo.can_access(order=order, scope=scope, actor=actor):
            raise OrderNotFound("Không tìm thấy đơn hàng")
        ok, blockers = self._confirm_gate(order)
        if not ok:
            raise OrderValidationError("Chưa đủ điều kiện chốt: " + "; ".join(blockers))
        now = datetime.now(timezone.utc)
        # compare-and-set: chỉ chốt nếu vẫn đang draft (chống chốt trùng / hủy song song)
        updated = (
            self.db.query(Order)
            .filter(Order.id == order.id, Order.status == STATUS_DRAFT)
            .update(
                {"status": STATUS_ORDERED, "ordered_at": now, "ordered_by": actor.id},
                synchronize_session=False,
            )
        )
        if updated != 1:
            self.db.rollback()
            raise OrderConflict("Đơn vừa được người khác chốt hoặc hủy")
        # khóa báo giá gốc (1 báo giá → 1 đơn) — cùng transaction với chốt
        if order.source_type == SOURCE_BAO_GIA and order.quotation_id:
            quote = self.quotations.get_by_id(order.quotation_id)
            if quote is not None and quote.status != "converted_to_order":
                quote.status = "converted_to_order"
        order_with_lines = self.repo.get_with_lines(order.id)
        # Pin `phieu_thanh_phan_id` trỏ tới sản phẩm tính giá đã bị xoá ⇒ không biết cụm này là sản
        # phẩm nào (tái bản hay mới, cấu hình gì) — rollback, không chốt nửa vời. Dòng không có pin
        # (nhập tay) bỏ qua.
        for line in order_with_lines.lines:
            if line.phieu_thanh_phan_id and self.db.get(PhieuThanhPhan, line.phieu_thanh_phan_id) is None:
                self.db.rollback()
                raise OrderValidationError(
                    f"Dòng \"{line.description}\" trỏ tới sản phẩm tính giá đã bị xoá — "
                    "không thể chốt đơn"
                )
        # THÀNH PHẨM vào danh mục (mg 0203 · docs/prd-thanh-pham.md L1).
        #
        # Sản phẩm in là hàng ĐẶT RIÊNG — không có sẵn ở danh mục nào. Nhưng kho chỉ xuất được
        # thứ CÓ trong danh mục (luật 08/08/2026), nên hệ khai hộ ngay lúc chốt: sản xuất xong
        # là kho nhập kho được, không phải chờ ai đó nghĩ tới việc lập yêu cầu giao.
        #
        # CÙNG giao dịch với chốt, cố ý: chốt xong mà khai hỏng thì đơn đã `ordered` nhưng kho
        # không có gì để nhập, và không ai biết cho tới lúc cần giao.
        #
        # Từ 11/10/2026 (mg 0394) thành phẩm THUỘC VỀ KHÁCH: cụm gắn tái bản ⇒ đúng mã đã chọn, cụm
        # từ phiếu tính giá không gắn ⇒ mã mới, và mã nhận cấu hình kỹ thuật lần chốt này (nguồn của
        # ô tái bản lần sau). Gắn sang mã của khách khác ⇒ dừng chốt.
        try:
            khai_cho_don(self.db, order_with_lines)
        except ThanhPhamKhacKhach as exc:
            self.db.rollback()
            raise OrderValidationError(str(exc)) from exc
        # CHỤP ẢNH biểu hoa hồng của người phụ trách vào đơn (mg 0439, 23/10/2026; trước đó % phẳng
        # `commission_pct`, nay DORMANT). Chụp lúc CHỐT chứ không đọc-sống: đổi biểu cho người ta từ
        # tháng sau KHÔNG được làm đổi hoa hồng của đơn đã chốt tháng trước.
        #
        # KHÔNG phơi biểu ra API/giao diện đơn hàng, cố ý (chủ chốt 21/08/2026): cho sale gõ % trên
        # chính đơn mình bán là để người ta tự viết phiếu lương của mình. Biểu chỉ khai được ở HỒ SƠ
        # LƯƠNG; % riêng của đơn chỉ đặt được qua API lương (ô `luong:update`).
        _chup_hoa_hong(order, self.db)
        self.db.commit()
        self.audit.create(actor_user_id=actor.id, action="confirm_order",
            target=f"order:{order.id}", detail=f"Chốt đơn {order.order_no}")
        # Vết "Đẩy đơn xuống Sản xuất (seam)" lúc chốt đã gỡ (12/10/2026): đơn chỉ thật sự xuống sản
        # xuất ở `_tu_chuyen_sx` (đủ cọc), vết đó đã ghi riêng — ghi thêm ở đây là báo sai khi còn chờ cọc.
        # Đơn không cần cọc (hoặc cọc đã đủ từ trước) → xuống SX ngay lúc chốt.
        # `order` đọc TRƯỚC câu UPDATE compare-and-set (synchronize_session=False) → nạp lại.
        self.db.refresh(order)
        self._tu_chuyen_sx(order, actor)
        return self._detail(self.repo.get_with_lines(order_id))

    # --- Hủy đơn (P5) — nháp (tự do) vs đã chốt (TP/GĐ + lỗi + seam) --------
    def cancel(self, *, order_id: int, actor, scope: str, reason: str, fault: str | None,
               can_cancel_ordered: bool) -> OrderDetailOut:
        order = self.repo.get_by_id(order_id)
        if order is None or not self.repo.can_access(order=order, scope=scope, actor=actor):
            raise OrderNotFound("Không tìm thấy đơn hàng")
        if order.status == STATUS_CANCELLED:
            raise OrderConflict("Đơn đã hủy")
        if not reason or not reason.strip():
            raise OrderValidationError("Hủy đơn phải nêu lý do")
        if order.status == STATUS_ORDERED:
            # Hủy sau chốt: chỉ TP/GĐ (approve_exception); bắt lỗi tại ai. Cọc KHÔNG xóa (giữ
            # nguyên order_deposits → "còn cọc chưa quyết toán" suy từ data); báo giá KHÔNG mở lại
            # (giữ converted_to_order). Hoàn/giữ cọc bao nhiêu = đàm phán NGOÀI hệ thống.
            if not can_cancel_ordered:
                raise OrderForbidden("Hủy đơn đã chốt cần quyền duyệt (TP KD / Giám đốc)")
            if fault not in (FAULT_KHACH, FAULT_XUONG):
                raise OrderValidationError("Hủy đơn đã chốt phải nêu lỗi tại ai (khách / xưởng)")
            if self.accounting_repo.issued_invoice_amount_for_order(order.id) > 0:
                raise OrderConflict(
                    "Đơn đã có hóa đơn còn hiệu lực; hãy hủy hóa đơn trước khi hủy đơn."
                )
            # Nghiệm thu #12 giao hàng: còn yêu cầu / chuyến giao đang chạy thì chặn — huỷ đơn mà
            # xe vẫn đang chở hàng của nó đi là hai bộ phận nói hai chuyện.
            from ..repositories.delivery_repo import DeliveryRepository
            from .delivery_service import DeliveryError, DeliveryService

            try:
                DeliveryService(DeliveryRepository(self.db), self.repo, None, None, None) \
                    .chan_huy_don_khi_con_yeu_cau_mo(order.id)
            except DeliveryError as e:
                raise OrderConflict(str(e)) from None
            order.cancel_fault = fault
        order.status = STATUS_CANCELLED
        order.cancel_reason = reason
        order.cancel_by = actor.id
        order.cancel_at = datetime.now(timezone.utc)
        self.db.commit()
        self.audit.create(actor_user_id=actor.id, action="cancel_order", target=f"order:{order.id}",
            detail=f"Hủy đơn {order.order_no}" + (f" (lỗi tại {_LOI_TAI.get(fault, fault)})" if fault else "") + f" — {reason}")
        return self._detail(self.repo.get_with_lines(order_id))

    # --- Tệp đính kèm của đơn (chỉ thêm/xoá khi nháp) ----
    def _load_editable_draft(self, order_id: int, actor, scope: str) -> Order:
        order = self.repo.get_by_id(order_id)
        if order is None or not self.repo.can_access(order=order, scope=scope, actor=actor):
            raise OrderNotFound("Không tìm thấy đơn hàng")
        if order.status != STATUS_DRAFT:
            raise OrderConflict("Đơn đã chốt/hủy — không sửa đính kèm")
        return order

    def add_consent_attachment(self, *, order_id, actor, scope, file_name, content_type, data) -> OrderDetailOut:
        order = self._load_editable_draft(order_id, actor, scope)
        if sum(1 for a in order.attachments if a.kind == ATTACH_KIND_CONSENT) >= _MAX_ATTACH_PER:
            raise OrderValidationError(f"Tối đa {_MAX_ATTACH_PER} đính kèm")
        url, safe, size = _save_attachment("don-hang", order.id, file_name, content_type, data)
        self.db.add(OrderAttachment(order_id=order.id, kind=ATTACH_KIND_CONSENT, file_url=url,
            file_name=safe, content_type=content_type, size_bytes=size, uploaded_by=actor.id))
        self.db.commit()
        self.audit.create(actor_user_id=actor.id, action="upload_consent",
            target=f"order:{order.id}", detail=f"Đính kèm tệp {safe} vào đơn {order.order_no}")
        return self._detail(self.repo.get_with_lines(order_id))

    def delete_consent_attachment(self, *, order_id, attachment_id, actor, scope) -> OrderDetailOut:
        order = self._load_editable_draft(order_id, actor, scope)
        att = self.db.get(OrderAttachment, attachment_id)
        if att is None or att.order_id != order.id:
            raise OrderNotFound("Không tìm thấy đính kèm")
        ten = att.file_name or f"#{attachment_id}"
        _unlink_attachment(att.file_url)
        self.db.delete(att)
        self.db.commit()
        self.audit.create(actor_user_id=actor.id, action="delete_consent",
            target=f"order:{order.id}", detail=f"Xoá tệp {ten} khỏi đơn {order.order_no}")
        return self._detail(self.repo.get_with_lines(order_id))

    # V5: minh chứng đã thu cọc KHÔNG còn đính ở đơn — dùng PaymentReceiptAttachment (màn Phiếu thu
    # Kế toán, endpoint /api/accounting/payment-receipts/{id}/attachments).
