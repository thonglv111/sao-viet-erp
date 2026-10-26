"""Đơn hàng bán (Order + OrderLine) data access — spec-10-don-hang-ban. The ONLY layer that
touches the DB for orders. SQL goes through SQLAlchemy bound parameters (no string-formatted
input). No business rules here (those live in OrderService).

Scope note: an order is owned by its Sale (``sale_user_id → users.department_id``), so the
``department`` data-scope filters on the set of Sale ids in the actor's department, mirroring
the Customer/Quotation repositories (feat-006 apply_scope pattern).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import BigInteger, and_, asc, cast, desc, exists, func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..models.customer import Customer
from ..models.order import (
    SOURCE_BAO_GIA, STATUS_CANCELLED, STATUS_DRAFT, STATUS_ORDERED, Order, OrderLine,
)
from ..models.quotation import Quote
from ..models.role import SCOPE_ALL, SCOPE_DEPARTMENT, SCOPE_OWN
from ..models.user import User
from .org_scope import dept_subtree_ids
from .org_scope import chu_cua, chu_theo_khach, nhom_dung_chung_user_ids
from .loc_danh_sach import dk_khoang_ngay, hom_nay_vn
from .tim_khong_dau import like_khong_dau

# Columns a caller may sort by (whitelist — never interpolate a raw sort key).
def _line_total_with_vat():
    """`line_total · (100 + vat_pct)` — ép 64-bit TRƯỚC khi nhân.

    Cả hai cột đều là `Integer` (int32). Postgres nhân int32×int32 ra int32 nên tràn ngay khi
    `line_total` vượt ~19,5 triệu VND (2.147.483.647 ÷ 110) — cỡ đơn thường ngày của xưởng in.
    SQLite dùng số nguyên 64-bit động nên không lộ, lỗi chỉ nổ trên Postgres.
    Gọi hàm mới mỗi lần vì biểu thức SQLAlchemy không nên dùng chung giữa các câu lệnh.
    """
    return cast(OrderLine.line_total, BigInteger) * (100 + OrderLine.vat_pct_estimate)


_SORTABLE = {
    "order_no": Order.order_no,
    "status": Order.status,
    "order_type": Order.order_type,
    "order_kind": Order.order_kind,
    "created_at": Order.created_at,
    "ordered_at": Order.ordered_at,
    "delivery_committed_date": Order.delivery_committed_date,
}


def _tong_vat_x100():
    """Σ `line_total · (100 + vat)` của đơn — bằng 100 × "Giá trị gồm VAT" ngoài bảng (bản Python
    lấy `// 100`, xem `money_sums`). So sánh trên số ×100 để khỏi chia trong SQL."""
    return (
        select(func.coalesce(func.sum(_line_total_with_vat()), 0))
        .where(OrderLine.order_id == Order.id)
        .correlate(Order)
        .scalar_subquery()
    )


def _san_sang_chot(hom_nay: date):
    """Đơn NHÁP đã qua cổng chốt — bản SQL của `OrderService._confirm_gate` (sửa một nơi thì sửa
    cả nơi kia): báo giá nguồn khách đã đồng ý và còn hạn, có số PO, có ngày giao cam kết, không
    còn dòng chưa định giá. Cọc KHÔNG phải cổng chốt."""
    bao_gia_hop_le = Order.quotation_id.in_(
        select(Quote.id).where(
            Quote.status.in_(("accepted", "converted_to_order")),
            or_(Quote.valid_until.is_(None), Quote.valid_until >= hom_nay),
        )
    )
    con_dong_chua_gia = (
        select(OrderLine.id)
        .where(OrderLine.order_id == Order.id, OrderLine.line_total.is_(None))
        .exists()
    )
    return and_(
        Order.status == STATUS_DRAFT,
        or_(Order.source_type != SOURCE_BAO_GIA, bao_gia_hop_le),
        Order.customer_po_no.is_not(None),
        Order.customer_po_no != "",
        Order.delivery_committed_date.is_not(None),
        ~con_dong_chua_gia,
    )


def _da_giao_dong():
    """Σ khách đã thực nhận của MỘT dòng đơn (correlate OrderLine) — cùng luật `da_giao_theo_dong`."""
    from ..models.delivery import LAN_GIAO_CO_HANG_DEN_TAY, DeliveryTrip, DeliveryTripLine

    return (
        select(func.coalesce(func.sum(DeliveryTripLine.qty_giao), 0))
        .join(DeliveryTrip, DeliveryTrip.id == DeliveryTripLine.trip_id)
        .where(DeliveryTripLine.order_line_id == OrderLine.id,
               DeliveryTrip.trang_thai.in_(LAN_GIAO_CO_HANG_DEN_TAY))
        .correlate(OrderLine)
        .scalar_subquery()
    )


def _giao_du():
    """Đơn có dòng, và không dòng nào khách nhận chưa đủ số đặt."""
    co_dong = exists(select(OrderLine.id).where(OrderLine.order_id == Order.id))
    thieu = exists(select(OrderLine.id).where(
        OrderLine.order_id == Order.id, _da_giao_dong() < OrderLine.qty))
    return and_(co_dong, ~thieu)


def _da_giao_gi():
    return exists(select(OrderLine.id).where(OrderLine.order_id == Order.id, _da_giao_dong() > 0))


def _hoa_don_x100():
    from ..models.accounting import SALES_INVOICE_ISSUED, SalesInvoice

    return (
        select(func.coalesce(func.sum(cast(SalesInvoice.amount_vnd, BigInteger)), 0) * 100)
        .where(SalesInvoice.order_id == Order.id, SalesInvoice.status == SALES_INVOICE_ISSUED)
        .correlate(Order)
        .scalar_subquery()
    )


def _gia_cong_cua_don(*dk):
    """EXISTS lần gia công ngoài CHƯA HUỶ của lệnh thuộc đơn — trực tiếp hoặc qua bước chung bài
    ghép (lần của bài ghép tính cho mọi lệnh thành viên, cùng luật `lsx_ids_loc_gia_cong`)."""
    from ..models.bai_ghep import BaiGhepThanhVien
    from ..models.gia_cong_ngoai import GiaCongNgoai
    from ..models.lsx import Lsx

    song = (GiaCongNgoai.huy_luc.is_(None), *dk)
    truc_tiep = exists(select(GiaCongNgoai.id).join(Lsx, Lsx.id == GiaCongNgoai.lsx_id)
                       .where(Lsx.order_id == Order.id, *song))
    qua_bai = exists(select(GiaCongNgoai.id)
                     .join(BaiGhepThanhVien, BaiGhepThanhVien.bai_ghep_id == GiaCongNgoai.bai_ghep_id)
                     .join(Lsx, Lsx.id == BaiGhepThanhVien.lsx_id)
                     .where(Lsx.order_id == Order.id, *song))
    return or_(truc_tiep, qua_bai)


#: Đã chốt mà chưa xuống sản xuất = còn chờ kế toán thu đủ cọc (chốt xong đủ cọc là tự chuyển —
#: `OrderService._tu_chuyen_sx`). Cùng cách đọc với ô "Chờ đủ cọc" ở cột Sản xuất ngoài bảng.
_CHO_COC = and_(Order.status == STATUS_ORDERED, Order.san_xuat_released_at.is_(None))


def _hoan_tat():
    """Đơn đã chốt đi HẾT vòng đời: khách nhận đủ mọi dòng và hoá đơn đã phát hành đủ "Giá trị gồm
    VAT" (lệch dưới 1đ do làm tròn coi là đủ — cùng luật ô lọc Hoá đơn = đủ). Bản SQL của "Đang
    chờ = xong" trong `services/don_hang_san_xuat.py`; sửa một nơi thì sửa cả hai."""
    return and_(
        Order.status == STATUS_ORDERED, Order.san_xuat_released_at.isnot(None),
        _giao_du(), _hoa_don_x100() + 100 > _tong_vat_x100(),
    )


@dataclass
class LocDonHang:
    """Dải kỳ + bảng "Bộ lọc nâng cao" của danh sách Đơn hàng bán (06/10/2026).

    `moc`: kỳ tính theo `tao` (ngày tạo), `chot` (ngày chốt), `giao` (ngày giao cam kết)."""

    tu_ngay: date | None = None
    den_ngay: date | None = None
    moc: str = "tao"
    khach: int | None = None
    gap: bool | None = None
    gia_tu: int | None = None
    gia_den: int | None = None
    #: `qua` = ngày giao hẹn đã qua mà khách CHƯA nhận đủ, `sap` = hẹn giao trong 7 ngày tới —
    #: chỉ đơn chưa huỷ.
    hen_giao: str | None = None
    #: Đơn đang chờ ai (`services/don_hang_san_xuat.CHO_*`). Suy từ nhiều nguồn nên SERVICE tính
    #: ra tập id rồi đặt vào `chi_id`; repo chỉ đọc `chi_id`.
    dang_cho: str | None = None
    chi_id: list[int] | None = None
    #: `co` | `tron_goi` | `mot_phan` | `giao_thang` | `khong` — lần gia công ngoài chưa huỷ.
    gia_cong: str | None = None
    nha_gia_cong: int | None = None
    #: `chua` | `mot_phan` | `du` — theo số khách đã thực nhận, gồm phần nhà gia công giao thẳng.
    giao: str | None = None
    #: `chua` | `mot_phan` | `du` — hoá đơn đã ghi so với giá trị gồm VAT.
    hoa_don: str | None = None
    #: Cho test ghim ngày; bỏ trống = hôm nay giờ Việt Nam.
    hom_nay: date | None = None


#: "Hẹn giao trong N ngày tới" của bảng lọc.
HEN_GIAO_SAP_NGAY = 7


class OrderRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    # --- reads --------------------------------------------------------------

    def get_by_id(self, order_id: int) -> Order | None:
        return self.db.get(Order, order_id)

    def theo_ids_kem_dong(self, ids) -> dict[int, Order]:
        """`{order_id: đơn kèm dòng}` trong một lượt nạp — dựng cả trang khỏi hỏi từng đơn."""
        ids = {int(i) for i in ids if i is not None}
        if not ids:
            return {}
        return {o.id: o for o in self.db.execute(
            select(Order).where(Order.id.in_(ids)).options(selectinload(Order.lines))
        ).scalars()}

    def get_with_lines(self, order_id: int) -> Order | None:
        return self.db.execute(
            select(Order).where(Order.id == order_id).options(selectinload(Order.lines))
        ).scalar_one_or_none()

    def _scope_condition(self, *, scope: str, actor):
        """WHERE expression narrowing orders to a data scope, or None for `all`."""
        if scope == SCOPE_ALL:
            return None
        # Chủ đơn = sale phụ trách KHÁCH, thiếu thì sale của đơn — xem `org_scope.chu_theo_khach`.
        chu = chu_theo_khach(Order.customer_id, Order.sale_user_id)
        if scope == SCOPE_OWN:
            # "Của tôi" = tôi + người CÙNG NHÓM DÙNG CHUNG với tôi (khối KD).
            return chu.in_(nhom_dung_chung_user_ids(self.db, actor.id))
        if scope == SCOPE_DEPARTMENT:
            # Subtree semantics (#26): phòng mình + mọi đơn vị con (GĐKD thấy các team).
            dept_ids = dept_subtree_ids(self.db, actor.department_id)
            if not dept_ids:
                return chu == actor.id
            dept_sales = select(User.id).where(User.department_id.in_(dept_ids))
            return chu.in_(dept_sales)
        raise ValueError(f"Unknown scope: {scope!r}")

    def can_access(self, *, order: Order, scope: str, actor) -> bool:
        """Whether `actor` may see this one order under `scope` (detail/edit guard)."""
        if scope == SCOPE_ALL:
            return True
        chu = chu_cua(self.db, order.customer_id, order.sale_user_id)
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

    def drafts_in_scope(self, *, scope: str, actor) -> list[Order]:
        """Đơn còn NHÁP trong phạm vi — nuôi badge 'việc chờ TÔI' (tập nháp nhỏ, bounded)."""
        stmt = select(Order).where(Order.status == "draft")
        cond = self._scope_condition(scope=scope, actor=actor)
        if cond is not None:
            stmt = stmt.where(cond)
        return list(self.db.execute(stmt).scalars().all())

    def line_total_sum(self, order_id: int) -> int | None:
        """Tổng dự kiến = Σ line_total (None if no priced line)."""
        val = self.db.execute(
            select(func.sum(OrderLine.line_total)).where(OrderLine.order_id == order_id)
        ).scalar()
        return int(val) if val is not None else None

    def unpriced_line_count(self, order_id: int) -> int:
        """Số dòng đơn CHƯA có giá (line_total IS NULL) — chặn chốt khi còn dòng chưa định giá
        (nếu không, tổng cọc yêu cầu bị thiếu vì Σ bỏ qua dòng null)."""
        val = self.db.execute(
            select(func.count())
            .select_from(OrderLine)
            .where(OrderLine.order_id == order_id, OrderLine.line_total.is_(None))
        ).scalar()
        return int(val or 0)

    def order_cost_sum(self, order_id: int) -> int | None:
        """Tổng giá vốn snapshot của đơn = Σ OrderLine.cost_snapshot (A2, soi biên). None nếu
        MỌI dòng đều thiếu giá vốn (đơn cũ trước A2 / báo giá không có cost) → không soi được biên.
        Dòng có cost + dòng None lẫn lộn: func.sum bỏ qua None → trả tổng phần có (chấp nhận được;
        đơn A2 thật thì mọi dòng đều có cost)."""
        val = self.db.execute(
            select(func.sum(OrderLine.cost_snapshot)).where(OrderLine.order_id == order_id)
        ).scalar()
        return int(val) if val is not None else None

    def total_with_vat(self, order_id: int) -> int:
        """Tổng đơn GỒM VAT ước = Σ line_total·(1 + vat_pct_estimate/100) — base tính cọc (cọc là
        tiền mặt thật khách đưa, gồm VAT). Dòng chưa định giá (line_total NULL) bỏ qua như
        line_total_sum. Số nguyên (floor) — đủ cho ngưỡng cọc."""
        val = self.db.execute(
            select(func.sum(_line_total_with_vat()))
            .where(OrderLine.order_id == order_id)
        ).scalar()
        return int(val) // 100 if val is not None else 0

    def chot_trong_khoang(
        self, *, tu, den, scope: str, actor, customer_id: int | None = None,
        sale_user_id: int | None = None,
    ) -> list[Order]:
        """Đơn ĐÃ CHỐT có `ordered_at` trong `[tu, den)` (hai mốc UTC; đầu nào None = không chặn
        đầu đó — kỳ "Tất cả") — nguồn của Báo cáo kinh doanh (24/09/2026). Nạp sẵn dòng sản phẩm:
        báo cáo in hết dòng của mọi đơn, để lười là N+1 trên cả trăm đơn. Lọc khách / sale ở ĐÂY
        (06/10/2026) — trước đó màn tải cả kỳ rồi lọc trong trình duyệt."""
        stmt = (
            select(Order)
            .options(selectinload(Order.lines))
            .where(Order.status == "ordered", Order.ordered_at.is_not(None))
            .order_by(Order.ordered_at, Order.id)
        )
        if tu is not None:
            stmt = stmt.where(Order.ordered_at >= tu)
        if den is not None:
            stmt = stmt.where(Order.ordered_at < den)
        cond = self._scope_condition(scope=scope, actor=actor)
        if cond is not None:
            stmt = stmt.where(cond)
        if customer_id is not None:
            stmt = stmt.where(Order.customer_id == customer_id)
        if sale_user_id is not None:
            stmt = stmt.where(Order.sale_user_id == sale_user_id)
        return list(self.db.execute(stmt).scalars().unique().all())

    def dem_chot_theo(self, *, theo: str, scope: str, actor) -> list[dict]:
        """Giá trị chọn được của thanh lọc Báo cáo kinh doanh: khách (`theo="khach"`) hoặc sale
        (`theo="sale"`) có đơn ĐÃ CHỐT trong tầm nhìn, kèm số đơn — `[{id, ten, so}]`."""
        if theo == "khach":
            cot, bang, ten = Order.customer_id, Customer, Customer.name
        else:
            cot, bang, ten = Order.sale_user_id, User, User.name
        stmt = (
            select(cot, ten, func.count(Order.id))
            .join(bang, bang.id == cot)
            .where(Order.status == "ordered", Order.ordered_at.is_not(None))
            .group_by(cot, ten)
            .order_by(ten)
        )
        cond = self._scope_condition(scope=scope, actor=actor)
        if cond is not None:
            stmt = stmt.where(cond)
        return [{"id": i, "ten": t or "", "so": int(n)} for i, t, n in self.db.execute(stmt)]

    def khach_theo_ids(self, ids: set[int]) -> dict[int, Customer]:
        if not ids:
            return {}
        return {
            c.id: c for c in self.db.execute(select(Customer).where(Customer.id.in_(ids))).scalars()
        }

    def so_dong_bao_gia(self, quote_ids: set[int]) -> dict[int, tuple[int, int]]:
        """(số mặt hàng khách ƯNG, tổng số mặt hàng) trong bản HIỆN HÀNH (`current_version_id`) của
        từng báo giá — nguồn "tỷ lệ báo giá thành công" ở Báo cáo kinh doanh. Một câu cho cả lô."""
        if not quote_ids:
            return {}
        from sqlalchemy import Integer as _Int

        from ..models.quotation import Quote, QuoteItem

        stmt = (
            select(Quote.id, func.sum(cast(QuoteItem.accepted, _Int)), func.count(QuoteItem.id))
            .join(QuoteItem, QuoteItem.quote_version_id == Quote.current_version_id)
            .where(Quote.id.in_(quote_ids))
            .group_by(Quote.id)
        )
        return {qid: (int(ung or 0), int(n)) for qid, ung, n in self.db.execute(stmt)}

    def ten_nguoi_dung(self, ids: set[int]) -> dict[int, str]:
        if not ids:
            return {}
        return {
            uid: (name or "")
            for uid, name in self.db.execute(select(User.id, User.name).where(User.id.in_(ids)))
        }

    def da_giao_theo_dong_nhieu(self, order_ids: list[int], *, truoc: datetime | None = None) -> dict[int, int]:
        """`{order_line_id: Σ khách đã thực nhận}` cho NHIỀU đơn trong MỘT câu — cùng luật
        `delivery_repo.da_giao_theo_dong` (chỉ lần giao có hàng tới tay). `truoc` = chỉ tính chuyến
        kết thúc TRƯỚC mốc này (báo cáo "tính tới cuối kỳ"); chuyến chưa ghi giờ kết thúc vẫn tính."""
        from ..models.delivery import LAN_GIAO_CO_HANG_DEN_TAY, DeliveryTrip, DeliveryTripLine

        if not order_ids:
            return {}
        stmt = (
            select(DeliveryTripLine.order_line_id, func.coalesce(func.sum(DeliveryTripLine.qty_giao), 0))
            .join(DeliveryTrip, DeliveryTrip.id == DeliveryTripLine.trip_id)
            .join(OrderLine, OrderLine.id == DeliveryTripLine.order_line_id)
            .where(OrderLine.order_id.in_(order_ids),
                   DeliveryTrip.trang_thai.in_(LAN_GIAO_CO_HANG_DEN_TAY))
            .group_by(DeliveryTripLine.order_line_id)
        )
        if truoc is not None:
            stmt = stmt.where(or_(DeliveryTrip.thoi_gian_ket_thuc.is_(None),
                                  DeliveryTrip.thoi_gian_ket_thuc < truoc))
        return {int(lid): int(sl or 0) for lid, sl in self.db.execute(stmt)}

    def money_sums(self, order_ids: list[int]) -> dict[int, dict]:
        """Batch của `line_total_sum` + `total_with_vat` + `order_cost_sum` — MỘT câu cho cả trang.

        Màn danh sách trước đây gọi ba hàm lẻ đó cho TỪNG đơn (N+1: 3 câu × số dòng hiển thị).
        Ở đây gom một câu `GROUP BY order_id`.

        Đơn KHÔNG có dòng nào sẽ vắng mặt trong map — caller phải mặc định đúng như bản lẻ:
        `total=None`, `order_cost=None`, `total_with_vat=0`.
        """
        if not order_ids:
            return {}
        stmt = (
            select(
                OrderLine.order_id,
                func.sum(OrderLine.line_total),
                func.sum(_line_total_with_vat()),
                func.sum(OrderLine.cost_snapshot),
            )
            .where(OrderLine.order_id.in_(order_ids))
            .group_by(OrderLine.order_id)
        )
        out: dict[int, dict] = {}
        for oid, total, with_vat, cost in self.db.execute(stmt):
            out[int(oid)] = {
                "total": int(total) if total is not None else None,
                # //100 vì biểu thức nhân với (100 + vat_pct) — khớp total_with_vat() bản lẻ.
                "total_with_vat": int(with_vat) // 100 if with_vat is not None else 0,
                "order_cost": int(cost) if cost is not None else None,
            }
        return out

    def tong_gia_tri(self, ids_stmt) -> int:
        """Σ giá trị gồm VAT của mọi đơn trong `ids_stmt` — làm tròn theo TỪNG đơn như `money_sums`
        để dòng "Cộng" khớp đúng tổng các ô trên lưới."""
        moi_don = (
            select((func.sum(_line_total_with_vat()) / 100).label("v"))
            .where(OrderLine.order_id.in_(ids_stmt))
            .group_by(OrderLine.order_id)
            .subquery()
        )
        return int(self.db.execute(select(func.coalesce(func.sum(moi_don.c.v), 0))).scalar_one() or 0)

    def line_summaries(self, order_ids: list[int]) -> dict[int, tuple[str, int]]:
        """Tóm tắt hàng của mỗi đơn cho màn danh sách: (tên MÓN đầu, số món) — MỘT câu cả trang.

        Một món = một cụm `nhom` (ruột + bìa của "Sách A5 64 trang" là MỘT món, tên là tên cụm — 11/10/2026,
        trước đó bày "Ruột sách A5 64 trang" như thể đơn chỉ bán ruột); dòng không nhóm là một món."""
        if not order_ids:
            return {}
        stmt = (
            select(OrderLine.id, OrderLine.order_id, OrderLine.description, OrderLine.nhom)
            .where(OrderLine.order_id.in_(order_ids))
            .order_by(OrderLine.order_id, OrderLine.id)
        )
        dau: dict[int, str] = {}
        mon: dict[int, set] = {}
        for lid, oid, desc, nhom in self.db.execute(stmt):
            oid, nhom = int(oid), (nhom or "").strip()
            dau.setdefault(oid, nhom or desc or "")
            mon.setdefault(oid, set()).add(("nhom", nhom) if nhom else ("dong", lid))
        return {oid: (dau[oid], len(mon[oid])) for oid in dau}

    def _dk_loc(
        self, *, q: str | None, order_kind: str | None, nguoi: int | None, loc: LocDonHang | None,
    ) -> list:
        """Mọi điều kiện của bảng TRỪ phạm vi và tab trạng thái — thanh tab đếm bằng đúng bộ này."""
        conditions = []
        if q and q.strip():
            # Tìm TƯƠNG ĐỐI (không dấu, không phân biệt hoa thường): mã đơn, tên khách, PO khách,
            # tên hàng trong đơn — đúng những gì cột bảng bày ra.
            cust_ids = select(Customer.id).where(like_khong_dau(Customer.name, q))
            line_ids = select(OrderLine.order_id).where(or_(
                like_khong_dau(OrderLine.description, q), like_khong_dau(OrderLine.nhom, q)))
            conditions.append(
                or_(
                    like_khong_dau(Order.order_no, q),
                    like_khong_dau(Order.customer_po_no, q),
                    Order.customer_id.in_(cust_ids),
                    Order.id.in_(line_ids),
                )
            )
        if order_kind:
            conditions.append(Order.order_kind == order_kind)
        if nguoi is not None:   # hộp lọc NV phụ trách — AND với phạm vi, không vượt được tầm nhìn
            conditions.append(Order.sale_user_id == nguoi)
        if loc is None:
            return conditions
        if loc.moc == "chot":
            conditions.extend(dk_khoang_ngay(Order.ordered_at, loc.tu_ngay, loc.den_ngay))
        elif loc.moc == "giao":
            conditions.extend(
                dk_khoang_ngay(Order.delivery_committed_date, loc.tu_ngay, loc.den_ngay, cot_ngay=True)
            )
        else:
            conditions.extend(dk_khoang_ngay(Order.created_at, loc.tu_ngay, loc.den_ngay))
        if loc.khach is not None:
            conditions.append(Order.customer_id == loc.khach)
        if loc.gap is not None:
            conditions.append(Order.is_rush.is_(loc.gap))
        if loc.gia_tu is not None:
            conditions.append(_tong_vat_x100() >= loc.gia_tu * 100)
        if loc.gia_den is not None:
            conditions.append(_tong_vat_x100() < (loc.gia_den + 1) * 100)
        if loc.chi_id is not None:
            conditions.append(Order.id.in_(loc.chi_id) if loc.chi_id else Order.id.is_(None))
        if loc.gia_cong or loc.nha_gia_cong is not None:
            from ..models.gia_cong_ngoai import KIEU_MOT_PHAN, KIEU_TRON_GOI, NOI_VE_KHACH, GiaCongNgoai

            dk = []
            if loc.nha_gia_cong is not None:
                dk.append(GiaCongNgoai.nha_cung_cap_id == loc.nha_gia_cong)
            if loc.gia_cong == "tron_goi":
                dk.append(GiaCongNgoai.kieu == KIEU_TRON_GOI)
            elif loc.gia_cong == "mot_phan":
                dk.append(GiaCongNgoai.kieu == KIEU_MOT_PHAN)
            elif loc.gia_cong == "giao_thang":
                dk += [GiaCongNgoai.chot_luc.is_not(None), GiaCongNgoai.noi_ve == NOI_VE_KHACH]
            if loc.gia_cong == "khong":
                conditions.append(Order.status == STATUS_ORDERED)
                conditions.append(~_gia_cong_cua_don(*dk))
            else:
                conditions.append(_gia_cong_cua_don(*dk))
        if loc.giao:
            conditions.append(Order.status == STATUS_ORDERED)
            if loc.giao == "du":
                conditions.append(_giao_du())
            elif loc.giao == "chua":
                conditions.append(~_da_giao_gi())
            else:
                conditions.append(and_(_da_giao_gi(), ~_giao_du()))
        if loc.hoa_don:
            conditions.append(Order.status == STATUS_ORDERED)
            # Đủ = đã ghi ≥ "Giá trị gồm VAT" (x100 // 100) ⇔ ghi×100 + 100 > x100.
            if loc.hoa_don == "du":
                conditions.append(_hoa_don_x100() + 100 > _tong_vat_x100())
            elif loc.hoa_don == "chua":
                conditions.append(_hoa_don_x100() == 0)
            else:
                conditions.append(and_(_hoa_don_x100() > 0, _hoa_don_x100() + 100 <= _tong_vat_x100()))
        if loc.hen_giao:
            hom_nay = loc.hom_nay or hom_nay_vn()
            conditions.append(Order.status != STATUS_CANCELLED)
            if loc.hen_giao == "qua":
                conditions.append(Order.delivery_committed_date < hom_nay)
                conditions.append(~_giao_du())
            else:
                conditions.append(Order.delivery_committed_date >= hom_nay)
                conditions.append(Order.delivery_committed_date <= hom_nay + timedelta(days=HEN_GIAO_SAP_NGAY))
        return conditions

    @staticmethod
    def _dk_tab(status: str | None, hom_nay: date):
        """Tab trạng thái: trạng thái thật, hoặc tab suy ra `san_sang` / `cho_coc` / `hoan_tat`."""
        if not status:
            return None
        if status == "san_sang":
            return _san_sang_chot(hom_nay)
        if status == "cho_coc":
            return _CHO_COC
        if status == "hoan_tat":
            return _hoan_tat()
        return Order.status == status

    def list(
        self,
        *,
        scope: str,
        actor,
        q: str | None = None,
        status: str | None = None,
        order_kind: str | None = None,
        sort: str = "-created_at",
        page: int = 1,
        size: int = 20,
        nguoi: int | None = None,
        loc: LocDonHang | None = None,
    ) -> tuple[list[Order], int, dict[int, str], dict[int, int | None]]:
        """Return (rows, total, customer_names, totals). `q` matches order_no + customer
        name (case-insensitive substring). `status` là trạng thái thật hoặc tab suy ra
        (`san_sang`, `cho_coc`). `total` is the count BEFORE pagination. `customer_names` maps
        order_id → customer name and `totals` maps order_id → tổng dự kiến, both for the page only."""
        conditions = []
        scope_cond = self._scope_condition(scope=scope, actor=actor)
        if scope_cond is not None:
            conditions.append(scope_cond)
        conditions.extend(self._dk_loc(q=q, order_kind=order_kind, nguoi=nguoi, loc=loc))
        tab = self._dk_tab(status, date.today())
        if tab is not None:
            conditions.append(tab)

        base = select(Order)
        count_stmt = select(func.count()).select_from(Order)
        for c in conditions:
            base = base.where(c)
            count_stmt = count_stmt.where(c)

        total = self.db.execute(count_stmt).scalar_one()
        # Tập id MỌI đơn khớp bộ lọc (chưa cắt trang) — service cộng tiền cho dòng "Cộng" cuối bảng.
        self.ids_khop_cuoi = base.with_only_columns(Order.id).order_by(None)

        direction = asc
        key = sort or "-created_at"
        if key.startswith("-"):
            direction = desc
            key = key[1:]
        col = _SORTABLE.get(key, Order.created_at)
        base = base.order_by(direction(col), Order.id.asc())

        page = max(1, page)
        size = max(1, min(size, 200))
        base = base.offset((page - 1) * size).limit(size)

        rows = list(self.db.execute(base).scalars())

        names: dict[int, str] = {}
        cust_ids_on_page = [r.customer_id for r in rows if r.customer_id is not None]
        if cust_ids_on_page:
            for oid, name in self.db.execute(
                select(Order.id, Customer.name)
                .join(Customer, Customer.id == Order.customer_id)
                .where(Order.id.in_([r.id for r in rows]))
            ):
                names[oid] = name

        totals: dict[int, int | None] = {}
        if rows:
            for oid, s in self.db.execute(
                select(OrderLine.order_id, func.sum(OrderLine.line_total))
                .where(OrderLine.order_id.in_([r.id for r in rows]))
                .group_by(OrderLine.order_id)
            ):
                totals[oid] = int(s) if s is not None else None

        return rows, total, names, totals

    # --- writes -------------------------------------------------------------

    def _next_order_no(self) -> str:
        """Next sequential order number: 'DH' + zero-padded number (DH001, DH002…). NOT
        `PB###` (mã phòng ban). Pattern chưa xác nhận với SVN — DH### is the working default."""
        max_n = 0
        for no in self.db.execute(select(Order.order_no)).scalars():
            if no and no.startswith("DH"):
                try:
                    max_n = max(max_n, int(no[2:]))
                except ValueError:
                    continue
        return f"DH{max_n + 1:03d}"

    def create(self, *, lines: list[dict], **order_fields) -> Order:
        """Tạo đơn + dòng. `order_fields` = giá trị các cột `orders` do OrderService chuẩn bị
        (source_type/customer_id/quotation_*/deposit_pct/cost_basis/needs_approval/... — service
        kiểm hợp lệ). `order_no` tự sinh (DH###). Mỗi phần tử `lines` là dict cột `order_lines`."""
        order = Order(order_no=self._next_order_no(), **order_fields)
        for ln in lines:
            order.lines.append(
                OrderLine(
                    description=ln.get("description", ""),
                    qty=ln.get("qty", 1),
                    unit_price_snapshot=ln.get("unit_price_snapshot"),
                    norm_snapshot=ln.get("norm_snapshot"),
                    vat_pct_estimate=ln.get("vat_pct_estimate", 0),
                    line_total=ln.get("line_total"),
                    chiet_khau=ln.get("chiet_khau"),   # tiền chiết khấu nằm trong line_total
                    ke_gia=ln.get("ke_gia"),           # tiền kê giá nằm trong line_total
                    cost_snapshot=ln.get("cost_snapshot"),  # giá vốn dòng (soi biên)
                    phieu_thanh_phan_id=ln.get("phieu_thanh_phan_id"),  # pin ấn phẩm (soft)
                    nhom=ln.get("nhom"),   # nhãn gộp dòng khi in xác nhận đơn (khớp bản báo giá)
                    don_vi_tinh=ln.get("don_vi_tinh", "cái"),   # ĐVT dòng (kéo từ báo giá / gõ tay)
                    dvt_nhom=ln.get("dvt_nhom"),   # ĐVT của cụm khi in gộp (ruột + bìa → "cuốn")
                )
            )
        self.db.add(order)
        self.db.commit()
        self.db.refresh(order)
        return order

    def stats(
        self, *, scope: str, actor, nguoi: int | None = None, q: str | None = None,
        order_kind: str | None = None, loc: LocDonHang | None = None,
    ) -> dict[str, int]:
        """Đếm đơn cho thanh tab, theo ĐÚNG phạm vi + ô tìm + dải kỳ + bộ lọc đang áp trên bảng."""
        base = [c for c in [self._scope_condition(scope=scope, actor=actor)] if c is not None]
        base.extend(self._dk_loc(q=q, order_kind=order_kind, nguoi=nguoi, loc=loc))
        hom_nay = date.today()

        def cnt(*extra) -> int:
            stmt = select(func.count()).select_from(Order)
            for c in (*base, *extra):
                stmt = stmt.where(c)
            return int(self.db.execute(stmt).scalar_one())

        return {
            "all": cnt(),
            "draft": cnt(Order.status == STATUS_DRAFT),
            "ordered": cnt(Order.status == STATUS_ORDERED),
            "cancelled": cnt(Order.status == STATUS_CANCELLED),
            "san_sang": cnt(_san_sang_chot(hom_nay)),
            "cho_coc": cnt(_CHO_COC),
            "hoan_tat": cnt(_hoan_tat()),
        }

    def don_da_chot_khop(
        self, *, scope: str, actor, q: str | None = None, order_kind: str | None = None,
        nguoi: int | None = None, loc: LocDonHang | None = None,
    ) -> list[Order]:
        """Đơn ĐÃ CHỐT khớp phạm vi + ô tìm + bộ lọc (trừ "Đang chờ") — tập ứng viên để service suy
        ra đơn đang chờ ai. Nạp sẵn dòng đơn (cụm bán đọc `order.lines`)."""
        conds = [c for c in [self._scope_condition(scope=scope, actor=actor)] if c is not None]
        conds.extend(self._dk_loc(q=q, order_kind=order_kind, nguoi=nguoi, loc=loc))
        stmt = select(Order).where(Order.status == STATUS_ORDERED, *conds).options(
            selectinload(Order.lines))
        return list(self.db.execute(stmt).scalars())

    def don_huy_khop(
        self, *, scope: str, actor, q: str | None = None, order_kind: str | None = None,
        nguoi: int | None = None, loc: LocDonHang | None = None,
    ) -> list[int]:
        """Id đơn ĐÃ HUỶ khớp phạm vi + ô tìm + bộ lọc (trừ "Đang chờ") — ứng viên "Chờ trả lại cọc"."""
        conds = [c for c in [self._scope_condition(scope=scope, actor=actor)] if c is not None]
        conds.extend(self._dk_loc(q=q, order_kind=order_kind, nguoi=nguoi, loc=loc))
        return [int(i) for i in self.db.execute(
            select(Order.id).where(Order.status == STATUS_CANCELLED, *conds)).scalars()]

    def dem_theo_nha_gia_cong(self, *, scope: str, actor) -> list[tuple[int, str, int]]:
        """(id, tên, số đơn) của nhà gia công có lần CHƯA HUỶ trên đơn trong tầm nhìn."""
        from ..models.bai_ghep import BaiGhepThanhVien
        from ..models.gia_cong_ngoai import GiaCongNgoai
        from ..models.lsx import Lsx

        truc_tiep = (select(GiaCongNgoai.nha_cung_cap_id.label("ncc"), Lsx.order_id.label("oid"))
                     .join(Lsx, Lsx.id == GiaCongNgoai.lsx_id).where(GiaCongNgoai.huy_luc.is_(None)))
        qua_bai = (select(GiaCongNgoai.nha_cung_cap_id.label("ncc"), Lsx.order_id.label("oid"))
                   .join(BaiGhepThanhVien, BaiGhepThanhVien.bai_ghep_id == GiaCongNgoai.bai_ghep_id)
                   .join(Lsx, Lsx.id == BaiGhepThanhVien.lsx_id).where(GiaCongNgoai.huy_luc.is_(None)))
        cap = truc_tiep.union(qua_bai).subquery()
        ten = (select(GiaCongNgoai.nha_cung_cap_id, func.max(GiaCongNgoai.nha_cung_cap_ten).label("ten"))
               .group_by(GiaCongNgoai.nha_cung_cap_id).subquery())
        stmt = (select(cap.c.ncc, ten.c.ten, func.count(func.distinct(cap.c.oid)))
                .join(Order, Order.id == cap.c.oid)
                .join(ten, ten.c.nha_cung_cap_id == cap.c.ncc)
                .group_by(cap.c.ncc, ten.c.ten).order_by(ten.c.ten))
        cond = self._scope_condition(scope=scope, actor=actor)
        if cond is not None:
            stmt = stmt.where(cond)
        return [(int(i), t or "", int(n)) for i, t, n in self.db.execute(stmt)]

    def dem_theo_khach(self, *, scope: str, actor) -> list[tuple[int, str, int]]:
        """(id, tên, số đơn) của khách đang có đơn TRONG tầm nhìn — ô "Khách hàng" của bảng lọc."""
        stmt = (
            select(Customer.id, Customer.name, func.count(Order.id))
            .join(Customer, Customer.id == Order.customer_id)
            .group_by(Customer.id, Customer.name)
            .order_by(Customer.name)
        )
        cond = self._scope_condition(scope=scope, actor=actor)
        if cond is not None:
            stmt = stmt.where(cond)
        return [(int(i), t, int(n)) for i, t, n in self.db.execute(stmt)]

    def dem_theo_nguoi(self, *, scope: str, actor) -> dict[int, int]:
        """{sale_user_id: số đơn} CHỈ trong tầm nhìn của người xem — nguồn hộp lọc NV phụ trách."""
        stmt = (
            select(Order.sale_user_id, func.count())
            .where(Order.sale_user_id.is_not(None))
            .group_by(Order.sale_user_id)
        )
        cond = self._scope_condition(scope=scope, actor=actor)
        if cond is not None:
            stmt = stmt.where(cond)
        return {int(uid): int(c) for uid, c in self.db.execute(stmt)}

    def value_rows(self, *, scope: str, actor, statuses: tuple[str, ...],
                   nguoi: int | None = None) -> dict[int, dict]:
        """Nguyên liệu tính KPI tiền cho từng đơn trong phạm vi (status ∈ statuses):
        `{order_id: {status, deposit_pct, deposit_amount, total_with_vat}}`. total_with_vat khớp ĐÚNG helper
        `total_with_vat` (Σ line_total·(100+vat) rồi //100 theo TỪNG đơn) → KPI = tổng số per-row,
        không lệch. 1 truy vấn GROUP BY, không N+1."""
        base = self._scope_condition(scope=scope, actor=actor)
        stmt = (
            select(
                Order.id,
                Order.status,
                Order.deposit_pct,
                Order.deposit_amount,
                func.coalesce(func.sum(_line_total_with_vat()), 0),
            )
            .select_from(Order)
            .join(OrderLine, OrderLine.order_id == Order.id, isouter=True)
            .where(Order.status.in_(statuses))
            .group_by(Order.id, Order.status, Order.deposit_pct, Order.deposit_amount)
        )
        if base is not None:
            stmt = stmt.where(base)
        if nguoi is not None:
            stmt = stmt.where(Order.sale_user_id == nguoi)
        out: dict[int, dict] = {}
        for oid, status, pct, so_tien, num in self.db.execute(stmt):
            out[int(oid)] = {"status": status, "deposit_pct": pct, "deposit_amount": so_tien,
                             "total_with_vat": int(num) // 100}
        return out

    # V5: Σ cọc đã thu chuyển sang AccountingRepository.received_deposit_sum (cọc = PaymentReceipt).

    def active_order_for_quotation(self, quotation_id: int) -> Order | None:
        """Đơn CHƯA hủy đang tham chiếu báo giá này (guard 1 báo giá → 1 đơn)."""
        from ..models.order import STATUS_CANCELLED

        return self.db.execute(
            select(Order)
            .where(Order.quotation_id == quotation_id, Order.status != STATUS_CANCELLED)
            .limit(1)
        ).scalar_one_or_none()

    def update(self, order: Order, **fields) -> Order:
        for key, value in fields.items():
            setattr(order, key, value)
        self.db.commit()
        self.db.refresh(order)
        return order
