"""Truy vấn của giao hàng kiểu In Hà Phương (docs/design-giao-hang-ha-phuong.md)."""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models.accounting import PAYMENT_VOUCHER_CANCELLED, PaymentVoucher
from ..models.department import Department
from ..models.giao_hang_hp import PT_DICH_VU, PhieuChiCuocGiao, PhuongThucGiaoHp, XeGiaoHang
from ..models.order import Order
from ..models.purchase import SUPPLIER_ACTIVE, Supplier
from ..models.user import User
from .catalog_base import CatalogRepo


class XeGiaoHangRepository(CatalogRepo):
    model = XeGiaoHang
    fields = ("ten", "nguoi_phu_trach_id", "ghi_chu", "active")
    commit_on_write = False   # service chốt sau khi đã ghi nhật ký — xem `catalog_base`
    # Không `ma_prefix`: mã xe LÀ BIỂN SỐ, người khai gõ tay.


class GiaoHangHpRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    # -- người và đơn vị ------------------------------------------------------------------

    def dept_ids_giao_hang(self) -> set[int]:
        """Phòng/tổ TỰ bật cờ giao hàng — cùng luật `DepartmentRepository.dept_ids_giao_hang`."""
        return set(self.db.execute(
            select(Department.id).where(Department.la_giao_hang.is_(True))).scalars().all())

    def nguoi_giao(self) -> list[tuple[User, str | None]]:
        """Tài khoản đang hoạt động thuộc bộ phận giao hàng, kèm tên bộ phận."""
        ids = self.dept_ids_giao_hang()
        if not ids:
            return []
        return list(self.db.execute(
            select(User, Department.name).join(Department, Department.id == User.department_id)
            .where(User.department_id.in_(sorted(ids)), User.is_active.is_(True))
            .order_by(User.name, User.username)).all())

    def la_nguoi_giao(self, user_id: int) -> bool:
        u = self.db.get(User, int(user_id))
        return bool(u is not None and u.is_active and u.department_id in self.dept_ids_giao_hang())

    def xe_theo_nguoi(self, user_ids: Iterable[int]) -> dict[int, int]:
        """`{user_id: xe_id}` — xe đang dùng mà người đó phụ trách (lấy xe tạo trước nếu nhiều)."""
        ids = sorted({int(u) for u in user_ids if u is not None})
        if not ids:
            return {}
        ra: dict[int, int] = {}
        for uid, xid in self.db.execute(
                select(XeGiaoHang.nguoi_phu_trach_id, XeGiaoHang.id)
                .where(XeGiaoHang.nguoi_phu_trach_id.in_(ids), XeGiaoHang.active.is_(True))
                .order_by(XeGiaoHang.id)).all():
            ra.setdefault(int(uid), int(xid))
        return ra

    def don_vi_van_chuyen(self) -> list[Supplier]:
        return list(self.db.execute(
            select(Supplier).where(Supplier.la_don_vi_van_chuyen.is_(True),
                                   Supplier.status == SUPPLIER_ACTIVE)
            .order_by(Supplier.name)).scalars().all())

    def get_xe(self, xe_id: int) -> XeGiaoHang | None:
        return self.db.get(XeGiaoHang, int(xe_id))

    def get_supplier(self, supplier_id: int) -> Supplier | None:
        return self.db.get(Supplier, int(supplier_id))

    def ten_nguoi(self, user_ids: Iterable[int | None]) -> dict[int, str]:
        ids = sorted({int(u) for u in user_ids if u is not None})
        if not ids:
            return {}
        return {u.id: (u.name or u.username) for u in self.db.execute(
            select(User).where(User.id.in_(ids))).scalars().all()}

    def xe_theo_ids(self, ids: Iterable[int | None]) -> dict[int, XeGiaoHang]:
        ids = sorted({int(i) for i in ids if i is not None})
        if not ids:
            return {}
        return {x.id: x for x in self.db.execute(
            select(XeGiaoHang).where(XeGiaoHang.id.in_(ids))).scalars().all()}

    def ncc_theo_ids(self, ids: Iterable[int | None]) -> dict[int, Supplier]:
        ids = sorted({int(i) for i in ids if i is not None})
        if not ids:
            return {}
        return {s.id: s for s in self.db.execute(
            select(Supplier).where(Supplier.id.in_(ids))).scalars().all()}

    # -- phương thức giao -----------------------------------------------------------------

    def them(self, **cot) -> PhuongThucGiaoHp:
        row = PhuongThucGiaoHp(**cot)
        self.db.add(row)
        self.db.flush()
        return row

    def cua_don(self, order_id: int) -> list[PhuongThucGiaoHp]:
        return list(self.db.execute(
            select(PhuongThucGiaoHp).where(PhuongThucGiaoHp.order_id == int(order_id))
            .order_by(PhuongThucGiaoHp.id)).scalars().all())

    def moi_nhat_theo_don(self, order_ids: Iterable[int]) -> dict[int, PhuongThucGiaoHp]:
        ids = sorted({int(i) for i in order_ids})
        if not ids:
            return {}
        sub = (select(func.max(PhuongThucGiaoHp.id))
               .where(PhuongThucGiaoHp.order_id.in_(ids))
               .group_by(PhuongThucGiaoHp.order_id))
        return {r.order_id: r for r in self.db.execute(
            select(PhuongThucGiaoHp).where(PhuongThucGiaoHp.id.in_(sub))).scalars().all()}

    def get(self, pt_id: int) -> PhuongThucGiaoHp | None:
        return self.db.get(PhuongThucGiaoHp, int(pt_id))

    # -- cước chờ chi ---------------------------------------------------------------------

    def da_chi_theo_pt(self, pt_ids: Iterable[int] | None = None) -> dict[int, int]:
        """`{phương thức id: Σ tiền đã chi}` — chỉ phiếu chi còn hiệu lực."""
        q = (select(PhieuChiCuocGiao.phuong_thuc_giao_hp_id, func.sum(PhieuChiCuocGiao.amount_vnd))
             .join(PaymentVoucher, PaymentVoucher.id == PhieuChiCuocGiao.payment_voucher_id)
             .where(PaymentVoucher.status != PAYMENT_VOUCHER_CANCELLED)
             .group_by(PhieuChiCuocGiao.phuong_thuc_giao_hp_id))
        if pt_ids is not None:
            ids = sorted({int(i) for i in pt_ids})
            if not ids:
                return {}
            q = q.where(PhieuChiCuocGiao.phuong_thuc_giao_hp_id.in_(ids))
        return {int(k): int(v or 0) for k, v in self.db.execute(q).all()}

    def dich_vu_co_cuoc(self) -> list[tuple[PhuongThucGiaoHp, Order]]:
        """Lần giao dịch vụ có tiền cước > 0 của đơn chưa huỷ, cũ trước."""
        return list(self.db.execute(
            select(PhuongThucGiaoHp, Order).join(Order, Order.id == PhuongThucGiaoHp.order_id)
            .where(PhuongThucGiaoHp.loai == PT_DICH_VU, PhuongThucGiaoHp.tien_cuoc > 0)
            .order_by(PhuongThucGiaoHp.id)).all())

    def lan_xuat_da_huy(self, rows: Iterable[PhuongThucGiaoHp]) -> set[int]:
        """Id cách giao mà lần xuất của nó đã HUỶ hẳn (yêu cầu kho huỷ/từ chối, lượt thương mại huỷ)."""
        from ..models.stock_request import REQ_CANCELLED, REQ_REJECTED, StockRequest
        from ..models.thuong_mai import LXTM_HUY, LuotXuatThuongMai

        rows = list(rows)
        yc_ids = sorted({r.stock_request_id for r in rows if r.stock_request_id})
        lx_ids = sorted({r.luot_xuat_tm_id for r in rows if r.luot_xuat_tm_id})
        yc_huy = set(self.db.execute(select(StockRequest.id).where(
            StockRequest.id.in_(yc_ids), StockRequest.trang_thai.in_((REQ_CANCELLED, REQ_REJECTED))
        )).scalars().all()) if yc_ids else set()
        lx_huy = set(self.db.execute(select(LuotXuatThuongMai.id).where(
            LuotXuatThuongMai.id.in_(lx_ids), LuotXuatThuongMai.trang_thai == LXTM_HUY
        )).scalars().all()) if lx_ids else set()
        return {r.id for r in rows if r.stock_request_id in yc_huy or r.luot_xuat_tm_id in lx_huy}

    def them_dong_chi(self, voucher: PaymentVoucher, pt_id: int, amount: int) -> None:
        self.db.add(PhieuChiCuocGiao(voucher=voucher, phuong_thuc_giao_hp_id=int(pt_id),
                                     amount_vnd=int(amount)))
