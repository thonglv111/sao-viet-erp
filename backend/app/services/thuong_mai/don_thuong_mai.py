"""Đơn thương mại (chỉ In Hà Phương): bán hàng có sẵn, không qua sản xuất.

Ở chung bảng `orders` / `order_lines` với đơn sản xuất để hoá đơn bán, cọc, phiếu thu, công nợ dùng
lại nguyên. Loại đơn là `orders.source_type = 'thuong_mai'`, mã `TM###`. Chốt / huỷ / cọc đi đường của
`OrderService`; file này lo phần riêng: tạo đơn, sửa dòng lúc nháp, cổng chốt.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.customer import Customer
from ...models.order import (
    APPROVAL_STATE_NONE, COST_BASIS_NONE, SOURCE_THUONG_MAI, STATUS_DRAFT, Order, OrderLine,
)
from ...models.vat_lieu_kho import VatTuInAn
from ...phan_he import THUONG_MAI, tat
from ...repositories.org_scope import chu_cua


class DonThuongMaiError(ValueError):
    """Lỗi nghiệp vụ, router trả 400."""


class DonThuongMaiNotFound(LookupError):
    pass


def la_don_thuong_mai(order) -> bool:
    return getattr(order, "source_type", None) == SOURCE_THUONG_MAI


def cong_chot_don_thuong_mai(db: Session, order: Order) -> list[str]:
    """Điều kiện chốt của đơn thương mại — cổng `OrderService._confirm_gate` gọi sang."""
    if tat(THUONG_MAI):
        return ["Bản cài này không dùng đơn thương mại"]
    if not order.customer_id:
        return ["Chưa chọn khách hàng"]
    lines = list(order.lines or [])
    if not lines:
        return ["Đơn chưa có mặt hàng nào"]
    thieu: list[str] = []
    if any(not ln.hang_thuong_mai_id for ln in lines):
        thieu.append("Có dòng không phải hàng thương mại")
    if any(ln.line_total is None for ln in lines):
        thieu.append("Còn dòng chưa có giá")
    return thieu


def _ten_dvt(db: Session, ma: str) -> str:
    from ...models.don_vi_do import DonViDo

    d = db.query(DonViDo).filter(DonViDo.ma == ma).first()
    return d.ten if d is not None and d.ten else ma


def dvt_cua_hang(hang: VatTuInAn) -> list[str]:
    """Mã ĐVT bán được của một mặt hàng thương mại: ĐVT chính + đơn vị thêm."""
    ra: list[str] = []
    for m in [hang.don_vi_gia or "", *(hang.don_vi_them or [])]:
        m = (m or "").strip().lower()
        if m and m not in ra:
            ra.append(m)
    return ra


def chuan_dong(db: Session, lines: list[dict]) -> list[dict]:
    """Kiểm + dựng dict cột `order_lines` cho các dòng đơn thương mại.

    Mỗi dòng: `hang_id` (mặt hàng mang cờ thương mại, còn dùng), `dvt` (mã, phải là ĐVT đã khai của
    mặt hàng), `qty` nguyên > 0, `don_gia` (đồng, trước VAT; vắng thì lấy giá bán khai theo ĐVT),
    `vat_pct` 0–100. Máy chủ chặn dòng không phải hàng thương mại — không chỉ giao diện chặn."""
    if not lines:
        raise DonThuongMaiError("Đơn phải có ít nhất một mặt hàng.")
    ids = {int(ln.get("hang_id") or 0) for ln in lines}
    hang = {h.id: h for h in db.query(VatTuInAn).filter(VatTuInAn.id.in_(ids)).all()} if ids else {}
    ra: list[dict] = []
    for ln in lines:
        h = hang.get(int(ln.get("hang_id") or 0))
        if h is None or not h.la_hang_thuong_mai:
            raise DonThuongMaiError("Đơn thương mại chỉ bán mặt hàng trong danh mục Hàng thương mại.")
        if not h.active:
            raise DonThuongMaiError(f"«{h.ten}» đã ngừng bán.")
        dvt = (ln.get("dvt") or h.don_vi_gia or "").strip().lower()
        if dvt not in dvt_cua_hang(h):
            raise DonThuongMaiError(f"«{h.ten}» chưa khai đơn vị này.")
        sl = ln.get("qty")
        try:
            qty = int(sl or 0)
        except (TypeError, ValueError):
            raise DonThuongMaiError("Số lượng phải là số nguyên.") from None
        if qty <= 0 or float(sl or 0) != qty:
            raise DonThuongMaiError(f"Số lượng của «{h.ten}» phải là số nguyên lớn hơn 0.")
        gia = ln.get("don_gia")
        if gia is None:
            gia = (h.gia_ban_theo_dvt or {}).get(dvt)
        if gia is None:
            raise DonThuongMaiError(f"«{h.ten}» chưa có giá bán theo đơn vị này, gõ đơn giá ở dòng đơn.")
        gia = int(round(float(gia)))
        if gia < 0:
            raise DonThuongMaiError("Đơn giá không được âm.")
        vat = int(ln.get("vat_pct") or 0)
        if not 0 <= vat <= 100:
            raise DonThuongMaiError("VAT phải trong khoảng 0–100.")
        ra.append(dict(
            description=h.ten,
            qty=qty,
            don_vi_tinh=_ten_dvt(db, dvt),
            unit_price_snapshot=gia,
            line_total=gia * qty,
            vat_pct_estimate=vat,
            hang_thuong_mai_id=h.id,
        ))
    return ra


def ma_dvt_cua_dong(db: Session, ln: OrderLine) -> str | None:
    """ĐVT (mã) của một dòng đơn thương mại — dòng giữ TÊN như dòng đơn sản xuất."""
    from ..thanh_pham_khai_bao import ma_don_vi

    return ma_don_vi(db, ln.don_vi_tinh)


class DonThuongMaiService:
    def __init__(self, db: Session, orders_repo, audit) -> None:
        self.db = db
        self.repo = orders_repo
        self.audit = audit

    def tao(self, *, actor, customer_id: int, lines: list[dict], deposit_pct: float | None = None,
            deposit_amount: int | None = None, ghi_chu: str | None = None) -> Order:
        if tat(THUONG_MAI):
            raise DonThuongMaiNotFound("Bản cài này không dùng đơn thương mại")
        if not customer_id or self.db.get(Customer, int(customer_id)) is None:
            raise DonThuongMaiError("Chọn khách hàng cho đơn.")
        dong = chuan_dong(self.db, lines)
        tong_vat = sum(d["line_total"] * (100 + d["vat_pct_estimate"]) // 100 for d in dong)
        if deposit_pct is not None and not 0 <= deposit_pct <= 100:
            raise DonThuongMaiError("% cọc phải trong khoảng 0–100")
        if deposit_amount:
            if deposit_amount > tong_vat:
                raise DonThuongMaiError("Tiền cọc không được vượt giá trị đơn hàng.")
            deposit_pct = None
        order = self.repo.create(
            lines=dong,
            source_type=SOURCE_THUONG_MAI,
            customer_id=int(customer_id),
            order_kind="moi",
            # Người phụ trách = người phụ trách KHÁCH, thiếu thì người lập (cùng luật đơn sản xuất).
            sale_user_id=(chu_cua(self.db, int(customer_id), None) or actor.id),
            status=STATUS_DRAFT,
            vat_pct_estimate=max((d["vat_pct_estimate"] for d in dong), default=0),
            deposit_pct=deposit_pct,
            deposit_amount=deposit_amount or None,
            cost_basis=COST_BASIS_NONE,
            needs_approval=False,
            approval_state=APPROVAL_STATE_NONE,
            delivery_note=(ghi_chu or None),
        )
        self.audit.create(actor_user_id=actor.id, action="create_order", target=f"order:{order.id}",
                          detail=f"Tạo đơn {order.order_no} (Đơn thương mại)")
        return order

    def sua_dong(self, *, order: Order, actor, lines: list[dict]) -> Order:
        """Thay TRỌN dòng của đơn thương mại còn nháp."""
        if not la_don_thuong_mai(order):
            raise DonThuongMaiNotFound("Không tìm thấy đơn thương mại")
        if order.status != STATUS_DRAFT:
            raise DonThuongMaiError("Đơn đã chốt hoặc huỷ, không sửa được.")
        dong = chuan_dong(self.db, lines)
        for ln in list(order.lines):
            self.db.delete(ln)
        self.db.flush()
        for d in dong:
            self.db.add(OrderLine(order_id=order.id, **d))
        order.vat_pct_estimate = max((d["vat_pct_estimate"] for d in dong), default=0)
        self.db.commit()
        self.audit.create(actor_user_id=actor.id, action="update_order", target=f"order:{order.id}",
                          detail=f"Cập nhật mặt hàng đơn {order.order_no}")
        self.db.expire(order)
        return order
