"""Repository — NGUỒN của phiếu kho cho Báo cáo kho (11/10/2026): lệnh, đơn, khách, nhà cung cấp,
bộ phận, người lập của một loạt phiếu. Tra GỘP theo lô (mỗi bảng một lượt) để bảng Chi tiết phiếu
không N+1. Các cột nguồn ở yêu cầu kho đều là soft ref nên mọi tra cứu đều chịu được id mồ côi."""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.customer import Customer
from ..models.delivery import DeliveryRequest, DeliveryTrip, LuotXe, LuotXeDiem
from ..models.department import Department
from ..models.lsx import Lsx
from ..models.order import Order
from ..models.purchase import PurchaseDelivery, PurchaseRequest, Supplier
from ..models.stock_request import StockRequest, StockRequestLine
from ..models.user import User


@dataclass
class NguonPhieu:
    lsx_cua_dong: dict[int, int] = field(default_factory=dict)          # dòng yêu cầu → lệnh
    lsx: dict[int, tuple[str, int | None]] = field(default_factory=dict)  # lệnh → (mã, đơn)
    don: dict[int, tuple[str, int | None]] = field(default_factory=dict)  # đơn → (số đơn, khách)
    khach: dict[int, str] = field(default_factory=dict)
    chuyen_don: dict[int, tuple[int | None, int | None]] = field(default_factory=dict)  # chuyến → (đơn, khách)
    ncc_dot_mua: dict[int, str] = field(default_factory=dict)          # đợt giao mua → tên NCC
    gia_cong: dict[int, tuple[str, int | None]] = field(default_factory=dict)  # đề nghị thuê gia công → (NCC, lệnh)
    bo_phan: dict[int, str] = field(default_factory=dict)
    nguoi: dict[int, str] = field(default_factory=dict)


class NguonPhieuKhoRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def tra(self, *, reqs: list[StockRequest], dong_yc_ids: set[int], nguoi_ids: set[int]) -> NguonPhieu:
        db = self.db
        n = NguonPhieu()
        if dong_yc_ids:
            n.lsx_cua_dong = {
                i: l for i, l in db.execute(
                    select(StockRequestLine.id, StockRequestLine.lsx_id)
                    .where(StockRequestLine.id.in_(dong_yc_ids), StockRequestLine.lsx_id.is_not(None))
                ).all()
            }
        from .thue_gia_cong_repo import ThueGiaCongRepository

        n.gia_cong = ThueGiaCongRepository(db).nguon_yeu_cau_kho(reqs)
        trip_ids = {r.delivery_trip_id for r in reqs if r.delivery_trip_id}
        if trip_ids:
            n.chuyen_don = {
                i: (o, c) for i, o, c in db.execute(
                    select(DeliveryTrip.id, DeliveryRequest.order_id, DeliveryRequest.customer_id)
                    .join(DeliveryRequest, DeliveryRequest.id == DeliveryTrip.request_id)
                    .where(DeliveryTrip.id.in_(trip_ids))
                ).all()
            }
        pd_ids = {r.purchase_delivery_id for r in reqs if r.purchase_delivery_id}
        if pd_ids:
            n.ncc_dot_mua = {
                i: ten for i, ten in db.execute(
                    select(PurchaseDelivery.id, Supplier.name)
                    .join(PurchaseRequest, PurchaseRequest.id == PurchaseDelivery.purchase_request_id)
                    .join(Supplier, Supplier.id == PurchaseRequest.supplier_id)
                    .where(PurchaseDelivery.id.in_(pd_ids))
                ).all()
            }
        lsx_ids = set(n.lsx_cua_dong.values()) | {l for _t, l in n.gia_cong.values() if l}
        if lsx_ids:
            n.lsx = {i: (ma, o) for i, ma, o in db.execute(
                select(Lsx.id, Lsx.ma, Lsx.order_id).where(Lsx.id.in_(lsx_ids))).all()}
        order_ids = {o for _m, o in n.lsx.values() if o} | {o for o, _c in n.chuyen_don.values() if o}
        if order_ids:
            n.don = {i: (so, c) for i, so, c in db.execute(
                select(Order.id, Order.order_no, Order.customer_id).where(Order.id.in_(order_ids))).all()}
        khach_ids = {c for _s, c in n.don.values() if c} | {c for _o, c in n.chuyen_don.values() if c}
        if khach_ids:
            n.khach = dict(db.execute(select(Customer.id, Customer.name).where(Customer.id.in_(khach_ids))).all())
        bp_ids = {r.bo_phan_id for r in reqs if r.bo_phan_id}
        if bp_ids:
            n.bo_phan = dict(db.execute(select(Department.id, Department.name).where(Department.id.in_(bp_ids))).all())
        if nguoi_ids:
            n.nguoi = dict(db.execute(select(User.id, User.name).where(User.id.in_(nguoi_ids))).all())
        return n

    def giao_theo_chuyen(self, trip_ids: set[int]) -> dict[int, tuple]:
        """`{chuyến: (mã lượt xe, mã yêu cầu giao, số đơn, tên khách, biển số xe, tên tài xế)}` — ô
        "Nguồn" và khối "Giao hàng" của yêu cầu kho do Giao hàng lập (đề nghị xuất giao khách, đề
        nghị nhập trả hàng). MỘT câu cho cả trang (12/10/2026). Chuyến ngoài lượt (dữ liệu trước
        lượt xe) thì mã lượt None."""
        from ..models.employee import Employee
        from ..models.xe import Xe

        ids = {i for i in trip_ids if i}
        if not ids:
            return {}
        q = (
            select(DeliveryTrip.id, LuotXe.code, DeliveryRequest.code, Order.order_no,
                   Customer.name, Xe.ma, Employee.full_name)
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryTrip.request_id)
            .outerjoin(Order, Order.id == DeliveryRequest.order_id)
            .outerjoin(Customer, Customer.id == DeliveryRequest.customer_id)
            .outerjoin(Xe, Xe.id == DeliveryTrip.vehicle_id)
            .outerjoin(Employee, Employee.id == DeliveryTrip.employee_id)
            .outerjoin(LuotXeDiem, LuotXeDiem.delivery_trip_id == DeliveryTrip.id)
            .outerjoin(LuotXe, LuotXe.id == LuotXeDiem.luot_xe_id)
            .where(DeliveryTrip.id.in_(ids))
        )
        return {int(r[0]): tuple(r[1:]) for r in self.db.execute(q).all()}
