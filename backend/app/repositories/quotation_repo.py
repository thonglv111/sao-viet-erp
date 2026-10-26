"""Báo giá (Quotation / Quote) repository — Header-Version-Item (H-V-I) pattern.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from sqlalchemy import and_, asc, desc, exists, func, or_, select, update
from sqlalchemy.orm import Session, selectinload

from ..models.audit import AuditLog
from ..models.customer import Customer
from ..models.quotation import (
    STATUS_ACCEPTED,
    STATUS_EXPIRED,
    STATUS_PENDING_APPROVAL,
    Quote,
    QuoteApproval,
    QuoteAttachment,
    QuoteItem,
    QuoteVersion,
)
from ..models.order import Order
from ..models.role import SCOPE_ALL, SCOPE_DEPARTMENT, SCOPE_OWN, RolePermission
from ..models.user import User
from .loc_danh_sach import dk_khoang_ngay, hom_nay_vn
from .org_scope import dept_subtree_ids
from .org_scope import chu_cua, chu_theo_khach, nhom_dung_chung_user_ids
from .tim_khong_dau import like_khong_dau

#: Giá bán gồm VAT của phiên bản đang hiệu lực — cột "Giá bán" ngoài bảng.
_GIA_BAN = (
    select(QuoteVersion.final_amount)
    .where(QuoteVersion.id == Quote.current_version_id)
    .correlate(Quote)
    .scalar_subquery()
)

#: Ngày gửi khách của phiên bản hiện hành (ngày gửi nằm ở phiên bản, không ở báo giá).
_NGAY_GUI = (
    select(QuoteVersion.sent_at)
    .where(QuoteVersion.id == Quote.current_version_id)
    .correlate(Quote)
    .scalar_subquery()
)

# Whitelist of sortable fields in Quote
_SORTABLE = {
    "quote_number": Quote.quote_number,
    "status": Quote.status,
    "valid_until": Quote.valid_until,
    "created_at": Quote.created_at,
    # Cột ngày của bảng chạy theo mốc kỳ đang chọn (ngày tạo / ngày gửi khách / hạn hiệu lực).
    "sent_at": _NGAY_GUI,
    # Cột "Giá bán" có nút sắp xếp từ lâu nhưng khoá này thiếu ⇒ máy chủ lặng lẽ xếp theo ngày tạo.
    "total": _GIA_BAN,
}

#: Quyết định duyệt GẦN NHẤT (lần trình sau thắng lần trình trước) — cùng thứ tự với `latest_approval`.
_QUYET_DINH_CUOI = (
    select(QuoteApproval.decision)
    .where(QuoteApproval.quote_id == Quote.id)
    .order_by(desc(QuoteApproval.decided_at), desc(QuoteApproval.id))
    .limit(1)
    .correlate(Quote)
    .scalar_subquery()
)
_NGUOI_QUYET_CUOI = (
    select(QuoteApproval.decided_by)
    .where(QuoteApproval.quote_id == Quote.id)
    .order_by(desc(QuoteApproval.decided_at), desc(QuoteApproval.id))
    .limit(1)
    .correlate(Quote)
    .scalar_subquery()
)

#: Báo giá còn ≤ N ngày hiệu lực ⇒ "Hết trong 7 ngày" (cùng ngưỡng với Thống kê khách hàng).
SAP_HET_HIEU_LUC_NGAY = 7


@dataclass
class LocBaoGia:
    """Dải kỳ + bảng "Bộ lọc nâng cao" của danh sách Báo giá (06/10/2026).

    `moc`: kỳ tính theo ngày nào — `tao` (ngày tạo), `gui` (ngày gửi khách của phiên bản đang hiệu
    lực), `hieu_luc` (hạn hiệu lực). `duyet`: tập con của `cho` / `duyet` / `tu_choi` / `khong`
    (chưa từng qua duyệt). `hieu_luc`: `con` / `sap_het` / `het`."""

    tu_ngay: date | None = None
    den_ngay: date | None = None
    moc: str = "tao"
    khach: int | None = None
    duyet: tuple[str, ...] = ()
    nguoi_duyet: int | None = None
    gia_tu: int | None = None
    gia_den: int | None = None
    hieu_luc: str | None = None


class QuotationRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, quote_id: int) -> Quote | None:
        return self.db.get(Quote, quote_id)

    # --- BG-2: quote_approvals (GĐ duyệt báo giá đặc thù) -------------------

    def latest_approval(self, quote_id: int) -> QuoteApproval | None:
        """Bản duyệt GẦN NHẤT của báo giá (quyết định cổng 'gửi khách')."""
        return self.db.execute(
            select(QuoteApproval)
            .where(QuoteApproval.quote_id == quote_id)
            .order_by(desc(QuoteApproval.decided_at), desc(QuoteApproval.id))
            .limit(1)
        ).scalar_one_or_none()

    def list_approvals(self, quote_id: int) -> list[QuoteApproval]:
        return list(
            self.db.execute(
                select(QuoteApproval)
                .where(QuoteApproval.quote_id == quote_id)
                .order_by(desc(QuoteApproval.decided_at), desc(QuoteApproval.id))
            ).scalars()
        )

    def create_approval(self, **fields) -> QuoteApproval:
        row = QuoteApproval(**fields)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def cua_phieu(self, phieu_tinh_gia_id: int) -> Quote | None:
        """Báo giá DUY NHẤT của một phiếu tính giá, mọi trạng thái (1 phiếu ↔ 1 báo giá, mg 0365)."""
        return self.db.execute(
            select(Quote).where(Quote.phieu_tinh_gia_id == phieu_tinh_gia_id).limit(1)
        ).scalar_one_or_none()

    def list_approved_selectable(
        self, *, scope: str, actor, today: date, limit: int = 50
    ) -> tuple[list[Quote], dict[int, str]]:
        """Select accepted quotes for orders."""
        stmt = select(Quote).where(Quote.status == STATUS_ACCEPTED)
        scope_cond = self._scope_condition(scope=scope, actor=actor)
        if scope_cond is not None:
            stmt = stmt.where(scope_cond)
        stmt = stmt.where(
            or_(Quote.valid_until.is_(None), Quote.valid_until >= today)
        ).order_by(Quote.quote_number.asc()).limit(limit)
        
        rows = list(self.db.execute(stmt).scalars())
        names: dict[int, str] = {}
        if rows:
            for qid, name in self.db.execute(
                select(Quote.id, Customer.name)
                .join(Customer, Customer.id == Quote.customer_id)
                .where(Quote.id.in_([r.id for r in rows]))
            ):
                names[qid] = name
        return rows, names

    def versions_of(self, quote_number: str) -> list[QuoteVersion]:
        return list(
            self.db.execute(
                select(QuoteVersion)
                .join(Quote, Quote.id == QuoteVersion.quote_id)
                .where(Quote.quote_number == quote_number)
                .order_by(QuoteVersion.version_number.asc())
            ).scalars()
        )

    def _scope_condition(self, *, scope: str, actor):
        if scope == SCOPE_ALL:
            return None
        # Chủ báo giá = sale phụ trách KHÁCH, thiếu thì người soạn — xem `org_scope.chu_theo_khach`.
        chu = chu_theo_khach(Quote.customer_id, Quote.salesperson_id)
        if scope == SCOPE_OWN:
            # "Của tôi" = tôi + người CÙNG NHÓM DÙNG CHUNG với tôi (khối KD). Không thuộc nhóm
            # nào thì tập đó đúng bằng {tôi} ⇒ hành vi cũ giữ nguyên.
            return chu.in_(nhom_dung_chung_user_ids(self.db, actor.id))
        if scope == SCOPE_DEPARTMENT:
            # Subtree semantics (#26): phòng mình + mọi đơn vị con (GĐKD thấy các team).
            dept_ids = dept_subtree_ids(self.db, actor.department_id)
            if not dept_ids:
                return chu == actor.id
            dept_sales = select(User.id).where(User.department_id.in_(dept_ids))
            return chu.in_(dept_sales)
        raise ValueError(f"Unknown scope: {scope!r}")

    def count_pending_approval(self, *, scope: str, actor) -> int:
        """Số báo giá đang 'Chờ duyệt' TRONG PHẠM VI của người duyệt (badge nav 'chờ tôi duyệt')."""
        stmt = select(func.count()).select_from(Quote).where(
            Quote.status == STATUS_PENDING_APPROVAL
        )
        cond = self._scope_condition(scope=scope, actor=actor)
        if cond is not None:
            stmt = stmt.where(cond)
        return int(self.db.execute(stmt).scalar_one())

    # --- Real-time "gửi duyệt": quyết định GĐ chưa xem phía Sale ---------------
    _EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

    def _unseen_decision_exists(self):
        """EXISTS 1 quyết định DUYỆT/TỪ CHỐI của GĐ (quote_approvals) ra SAU mốc Sale đã xem.
        Bám bảng quyết định GĐ → KHÔNG lẫn 'khách từ chối' (đường transition, không tạo approval)."""
        return exists().where(
            QuoteApproval.quote_id == Quote.id,
            QuoteApproval.decided_at > func.coalesce(Quote.decision_seen_at, self._EPOCH),
        )

    def count_my_decided_unseen(self, salesperson_id: int) -> int:
        """Số báo giá của NGƯỜI SOẠN vừa được GĐ quyết mà họ chưa xem (nuôi badge/toast phía Sale)."""
        stmt = select(func.count()).select_from(Quote).where(
            Quote.salesperson_id == salesperson_id,
            self._unseen_decision_exists(),
        )
        return int(self.db.execute(stmt).scalar_one())

    def mark_my_decisions_seen(self, salesperson_id: int) -> None:
        """Người soạn xác nhận đã xem các quyết định → đóng badge/chuông (đặt mốc = giờ hiện tại)."""
        self.db.execute(
            update(Quote)
            .where(Quote.salesperson_id == salesperson_id, self._unseen_decision_exists())
            .values(decision_seen_at=datetime.now(timezone.utc))
        )
        self.db.commit()

    def can_access(self, *, quote: Quote, scope: str, actor) -> bool:
        if scope == SCOPE_ALL:
            return True
        chu = chu_cua(self.db, quote.customer_id, quote.salesperson_id)
        if scope == SCOPE_OWN:
            return chu in nhom_dung_chung_user_ids(self.db, actor.id)
        if scope == SCOPE_DEPARTMENT:
            if chu is None:
                return False
            if chu == actor.id:
                return True
            owner = self.db.get(User, chu)
            if owner is None or owner.department_id is None:
                return False
            return owner.department_id in dept_subtree_ids(self.db, actor.department_id)
        raise ValueError(f"Unknown scope: {scope!r}")

    def _xem_duoc_nhieu(self, quotes: list[Quote]):
        """Bản lô của `can_access` cho nhiều báo giá × nhiều người: trả hàm `(quote, scope, actor) ->
        bool` cùng luật, nhưng chủ của mọi báo giá, phòng của mọi chủ đọc MỘT lần; nhóm dùng chung và
        cây phòng nhớ theo người duyệt. Gọi `can_access` từng cặp là 2–3 câu mỗi cặp (26/10/2026)."""
        cids = {q.customer_id for q in quotes if q.customer_id is not None}
        sale = dict(self.db.execute(
            select(Customer.id, Customer.sale_user_id).where(Customer.id.in_(cids))).all()) if cids else {}
        chu = {}
        for q in quotes:
            s = sale.get(q.customer_id) if q.customer_id is not None else None
            chu[q.id] = s if s is not None else q.salesperson_id
        chu_ids = {c for c in chu.values() if c is not None}
        phong_chu = dict(self.db.execute(
            select(User.id, User.department_id).where(User.id.in_(chu_ids))).all()) if chu_ids else {}
        nhom: dict[int, set[int]] = {}
        cay: dict[int | None, list[int]] = {}

        def xem(quote: Quote, scope: str, actor) -> bool:
            if scope == SCOPE_ALL:
                return True
            c = chu[quote.id]
            if scope == SCOPE_OWN:
                if actor.id not in nhom:
                    nhom[actor.id] = nhom_dung_chung_user_ids(self.db, actor.id)
                return c in nhom[actor.id]
            if scope == SCOPE_DEPARTMENT:
                if c is None:
                    return False
                if c == actor.id:
                    return True
                if phong_chu.get(c) is None:
                    return False
                if actor.department_id not in cay:
                    cay[actor.department_id] = dept_subtree_ids(self.db, actor.department_id)
                return phong_chu[c] in cay[actor.department_id]
            raise ValueError(f"Unknown scope: {scope!r}")

        return xem

    def _dk_loc(self, *, q: str | None, nguoi: int | None, loc: LocBaoGia | None) -> list:
        """Mọi điều kiện của bảng TRỪ phạm vi và tab trạng thái — thanh tab đếm bằng đúng bộ này."""
        conditions = []
        if q and q.strip():
            # Tìm TƯƠNG ĐỐI (không dấu, không phân biệt hoa thường): mã báo giá, tên khách, tên sản
            # phẩm trong báo giá (mọi phiên bản).
            cust_ids = select(Customer.id).where(like_khong_dau(Customer.name, q))
            sp_quote_ids = (
                select(QuoteVersion.quote_id)
                .join(QuoteItem, QuoteItem.quote_version_id == QuoteVersion.id)
                .where(like_khong_dau(QuoteItem.product_name, q))
            )
            conditions.append(or_(
                like_khong_dau(Quote.quote_number, q),
                Quote.customer_id.in_(cust_ids),
                Quote.id.in_(sp_quote_ids),
            ))
        if nguoi is not None:   # hộp lọc NV phụ trách — AND với phạm vi, không vượt được tầm nhìn
            conditions.append(Quote.salesperson_id == nguoi)
        if loc is None:
            return conditions

        if loc.tu_ngay is not None or loc.den_ngay is not None:
            if loc.moc == "gui":
                conditions.append(Quote.current_version_id.in_(
                    select(QuoteVersion.id).where(
                        QuoteVersion.sent_at.is_not(None),
                        *dk_khoang_ngay(QuoteVersion.sent_at, loc.tu_ngay, loc.den_ngay),
                    )
                ))
            elif loc.moc == "hieu_luc":
                conditions.extend(dk_khoang_ngay(Quote.valid_until, loc.tu_ngay, loc.den_ngay, cot_ngay=True))
            else:
                conditions.extend(dk_khoang_ngay(Quote.created_at, loc.tu_ngay, loc.den_ngay))
        if loc.khach is not None:
            conditions.append(Quote.customer_id == loc.khach)
        if loc.gia_tu is not None:
            conditions.append(_GIA_BAN >= loc.gia_tu)
        if loc.gia_den is not None:
            conditions.append(_GIA_BAN <= loc.gia_den)
        if loc.duyet:
            dang_cho = Quote.status == STATUS_PENDING_APPROVAL
            co_duyet = exists().where(QuoteApproval.quote_id == Quote.id)
            nhanh = {
                "cho": dang_cho,
                "duyet": and_(~dang_cho, _QUYET_DINH_CUOI == "approved"),
                "tu_choi": and_(~dang_cho, _QUYET_DINH_CUOI == "rejected"),
                "khong": and_(~dang_cho, ~co_duyet),
            }
            chon = [nhanh[k] for k in loc.duyet if k in nhanh]
            if chon:
                conditions.append(or_(*chon))
        if loc.nguoi_duyet is not None:
            conditions.append(_NGUOI_QUYET_CUOI == loc.nguoi_duyet)
        if loc.hieu_luc:
            hom_nay = hom_nay_vn()
            if loc.hieu_luc == "con":
                # Không ghi hạn = không hết hạn.
                conditions.append(Quote.status != STATUS_EXPIRED)
                conditions.append(or_(Quote.valid_until.is_(None), Quote.valid_until >= hom_nay))
            elif loc.hieu_luc == "sap_het":
                conditions.append(Quote.status != STATUS_EXPIRED)
                conditions.append(Quote.valid_until >= hom_nay)
                conditions.append(Quote.valid_until <= hom_nay + timedelta(days=SAP_HET_HIEU_LUC_NGAY))
            elif loc.hieu_luc == "het":
                conditions.append(or_(Quote.status == STATUS_EXPIRED, Quote.valid_until < hom_nay))
        return conditions

    def list(
        self,
        *,
        scope: str,
        actor,
        q: str | None = None,
        status: str | None = None,
        sort: str = "-created_at",
        page: int = 1,
        size: int = 20,
        nguoi: int | None = None,
        loc: LocBaoGia | None = None,
    ) -> tuple[list[Quote], int, dict[int, str], float]:
        """(dòng của trang, tổng số dòng, tên khách theo báo giá, Σ giá bán gồm VAT của MỌI dòng khớp
        bộ lọc — dòng "Cộng" cuối bảng)."""
        conditions = []
        scope_cond = self._scope_condition(scope=scope, actor=actor)
        if scope_cond is not None:
            conditions.append(scope_cond)
        conditions.extend(self._dk_loc(q=q, nguoi=nguoi, loc=loc))

        base = select(Quote)
        count_stmt = select(func.count()).select_from(Quote)
        if status == "need_action":
            # Tab "Cần xử lý": soạn tiếp (draft) + đã gửi chờ khách (sent)
            conditions.append(Quote.status.in_(("draft", "sent")))
        elif status:
            conditions.append(Quote.status == status)

        for c in conditions:
            base = base.where(c)
            count_stmt = count_stmt.where(c)

        total = self.db.execute(count_stmt).scalar_one()
        tong_stmt = select(func.coalesce(func.sum(_GIA_BAN), 0)).select_from(Quote)
        for c in conditions:
            tong_stmt = tong_stmt.where(c)
        tong_gia_ban = float(self.db.execute(tong_stmt).scalar_one() or 0)

        direction = asc
        key = sort or "-created_at"
        if key.startswith("-"):
            direction = desc
            key = key[1:]
            
        # Map sort key if needed (compatibility mapping)
        if key == "code":
            key = "quote_number"
            
        col = _SORTABLE.get(key, Quote.created_at)
        base = base.order_by(direction(col), Quote.id.asc())

        page = max(1, page)
        size = max(1, min(size, 200))
        base = base.offset((page - 1) * size).limit(size)
        # Phiên bản + dòng hàng nạp gộp cho cả trang — dòng danh sách đọc phiên bản hiện hành và các
        # dòng của nó; để lazy là 2 câu mỗi báo giá (26/10/2026).
        base = base.options(selectinload(Quote.versions).selectinload(QuoteVersion.items))

        rows = list(self.db.execute(base).scalars())

        names: dict[int, str] = {}
        cust_ids_on_page = [r.customer_id for r in rows if r.customer_id is not None]
        if cust_ids_on_page:
            for qid, name in self.db.execute(
                select(Quote.id, Customer.name)
                .join(Customer, Customer.id == Quote.customer_id)
                .where(Quote.id.in_([r.id for r in rows]))
            ):
                names[qid] = name
        return rows, total, names, tong_gia_ban

    def don_hang_cua(self, quote_ids: list[int]) -> dict[int, tuple[int, str, str]]:
        """Đơn hàng lên từ mỗi báo giá: quote_id → (order_id, mã đơn, trạng thái đơn). Một báo giá
        một đơn; còn sót nhiều (đơn huỷ rồi lên lại) thì lấy đơn mới nhất."""
        if not quote_ids:
            return {}
        out: dict[int, tuple[int, str, str]] = {}
        for oid, so, tt, qid in self.db.execute(
            select(Order.id, Order.order_no, Order.status, Order.quotation_id)
            .where(Order.quotation_id.in_(quote_ids))
            .order_by(Order.id.asc())
        ):
            out[qid] = (oid, so, tt)
        return out

    def stats(
        self, *, scope: str, actor, nguoi: int | None = None, q: str | None = None,
        loc: LocBaoGia | None = None,
    ) -> dict:
        """Số đếm theo trạng thái cho thanh tab list — CÙNG phạm vi với bảng (trước 04/10/2026 đếm
        cả bảng, người phạm vi `own` thấy số phiếu của người khác) + ô tìm, dải kỳ, bộ lọc nâng cao
        đang áp (06/10/2026): bấm tab nào thì bảng ra đúng số trên tab đó."""
        stmt = select(Quote.status, func.count()).group_by(Quote.status)
        cond = self._scope_condition(scope=scope, actor=actor)
        if cond is not None:
            stmt = stmt.where(cond)
        for c in self._dk_loc(q=q, nguoi=nguoi, loc=loc):
            stmt = stmt.where(c)
        by_status = dict(self.db.execute(stmt).all())
        get = lambda s: int(by_status.get(s, 0))  # noqa: E731
        return {
            "total": sum(int(v) for v in by_status.values()),
            "draft": get("draft"),
            "pending_approval": get("pending_approval"),
            "approved": get("approved"),
            "sent": get("sent"),
            "accepted": get("accepted"),
            "rejected": get("rejected"),
            "expired": get("expired"),
            "converted_to_order": get("converted_to_order"),
            "cancelled": get("cancelled"),
            "need_action": get("draft") + get("sent"),
        }

    def dem_theo_khach(self, *, scope: str, actor) -> list[tuple[int, str, int]]:
        """(id, tên, số báo giá) của khách đang có báo giá TRONG tầm nhìn — ô "Khách hàng" của bảng lọc."""
        stmt = (
            select(Customer.id, Customer.name, func.count(Quote.id))
            .join(Customer, Customer.id == Quote.customer_id)
            .group_by(Customer.id, Customer.name)
            .order_by(Customer.name)
        )
        cond = self._scope_condition(scope=scope, actor=actor)
        if cond is not None:
            stmt = stmt.where(cond)
        return [(int(i), t, int(n)) for i, t, n in self.db.execute(stmt)]

    def dem_theo_nguoi_duyet(self, *, scope: str, actor) -> list[tuple[int, str, int]]:
        """(id, tên, số báo giá) của người ra quyết định duyệt GẦN NHẤT trên báo giá trong tầm nhìn —
        ô "Người duyệt" của bảng lọc, khớp đúng điều kiện `nguoi_duyet`."""
        sub = select(_NGUOI_QUYET_CUOI.label("nguoi")).select_from(Quote)
        cond = self._scope_condition(scope=scope, actor=actor)
        if cond is not None:
            sub = sub.where(cond)
        sub = sub.subquery()
        stmt = (
            select(User.id, User.name, func.count())
            .join(sub, sub.c.nguoi == User.id)
            .group_by(User.id, User.name)
            .order_by(User.name)
        )
        return [(int(i), t, int(n)) for i, t, n in self.db.execute(stmt)]

    def tom_tat_duyet(self, rows: list[Quote]) -> dict[int, dict]:
        """Cột "Người duyệt" của danh sách, cho các báo giá TRÊN TRANG (vài câu cho cả trang).

        - Đang chờ duyệt: người CÓ THỂ duyệt (ô "Duyệt báo giá đặc thù" + báo giá nằm trong phạm vi
          của họ — đúng tập người thấy nó trong hàng "chờ tôi duyệt") và lúc trình.
        - Đã có quyết định: người ra quyết định gần nhất, lúc quyết, ý kiến.
        - Chưa từng qua duyệt mà đã tới tay khách (gửi / khách chốt / lên đơn): báo giá thường,
          không cần duyệt. Còn lại (nháp, hết hạn, huỷ) để trống."""
        if not rows:
            return {}
        ids = [r.id for r in rows]
        cuoi: dict[int, QuoteApproval] = {}
        for a in self.db.execute(
            select(QuoteApproval)
            .where(QuoteApproval.quote_id.in_(ids))
            .order_by(desc(QuoteApproval.decided_at), desc(QuoteApproval.id))
        ).scalars():
            cuoi.setdefault(a.quote_id, a)

        cho = [r for r in rows if r.status == STATUS_PENDING_APPROVAL]
        luc_trinh: dict[int, datetime] = {}
        ung_vien: dict[int, list[int]] = {}
        if cho:
            muc_tieu = {f"quote:{r.id}": r.id for r in cho}
            for target, luc in self.db.execute(
                select(AuditLog.target, func.max(AuditLog.created_at))
                .where(AuditLog.action == "transition_pending_approval", AuditLog.target.in_(muc_tieu))
                .group_by(AuditLog.target)
            ):
                luc_trinh[muc_tieu[target]] = luc
            nguoi_duyet = list(self.db.execute(
                select(User, RolePermission.scope)
                .join(RolePermission, RolePermission.role_id == User.role_id)
                .where(
                    RolePermission.module_key == "bao_gia",
                    RolePermission.can_approve_exception.is_(True),
                    User.is_active.is_(True),
                )
                .order_by(User.name)
            ).all())
            xem = self._xem_duoc_nhieu(cho)
            for r in cho:
                ung_vien[r.id] = [
                    u.id for u, pham_vi in nguoi_duyet
                    if pham_vi and xem(r, pham_vi, u)
                ]

        user_ids = {a.decided_by for a in cuoi.values() if a.decided_by}
        for ds in ung_vien.values():
            user_ids.update(ds)
        ten: dict[int, str] = {}
        if user_ids:
            ten = dict(self.db.execute(select(User.id, User.name).where(User.id.in_(user_ids))).all())

        out: dict[int, dict] = {}
        for r in rows:
            if r.status == STATUS_PENDING_APPROVAL:
                out[r.id] = {
                    "trang_thai": "cho",
                    "nguoi": [ten[i] for i in ung_vien.get(r.id, []) if i in ten],
                    "luc": luc_trinh.get(r.id),
                    "y_kien": None,
                }
            elif r.id in cuoi:
                a = cuoi[r.id]
                out[r.id] = {
                    "trang_thai": "da_duyet" if a.decision == "approved" else "tu_choi",
                    "nguoi": [ten[a.decided_by]] if a.decided_by in ten else [],
                    "luc": a.decided_at,
                    "y_kien": a.note,
                }
            elif r.status in ("sent", "accepted", "converted_to_order"):
                out[r.id] = {"trang_thai": "khong_can", "nguoi": [], "luc": None, "y_kien": None}
        return out

    def dem_theo_nguoi(self, *, scope: str, actor) -> dict[int, int]:
        """{salesperson_id: số báo giá} CHỈ trong tầm nhìn — nguồn hộp lọc NV phụ trách."""
        stmt = (
            select(Quote.salesperson_id, func.count())
            .where(Quote.salesperson_id.is_not(None))
            .group_by(Quote.salesperson_id)
        )
        cond = self._scope_condition(scope=scope, actor=actor)
        if cond is not None:
            stmt = stmt.where(cond)
        return {int(uid): int(c) for uid, c in self.db.execute(stmt)}

    def create(self, quote: Quote) -> Quote:
        self.db.add(quote)
        self.db.commit()
        self.db.refresh(quote)
        return quote

    def update(self, quote: Quote) -> Quote:
        self.db.commit()
        self.db.refresh(quote)
        return quote

    # --- Tài liệu đính kèm (nội bộ) -----------------------------------------
    def list_attachments(self, quote_id: int) -> list[QuoteAttachment]:
        return list(self.db.execute(
            select(QuoteAttachment)
            .where(QuoteAttachment.quote_id == quote_id)
            .order_by(QuoteAttachment.id.desc())
        ).scalars())

    def get_attachment(self, attachment_id: int) -> QuoteAttachment | None:
        return self.db.get(QuoteAttachment, attachment_id)

    def add_attachment(self, quote_id: int, **fields) -> QuoteAttachment:
        att = QuoteAttachment(quote_id=quote_id, **fields)
        self.db.add(att)
        self.db.commit()
        self.db.refresh(att)
        return att

    def delete_attachment(self, att: QuoteAttachment) -> None:
        self.db.delete(att)
        self.db.commit()
