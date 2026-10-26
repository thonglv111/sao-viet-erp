"""Repository — Giao hàng (docs/prd-giao-hang.md).

Chỉ truy vấn/ghi DB. Luật nghiệp vụ (chặn vượt số còn phải giao, trùng lịch tài xế, chuyển trạng
thái, sinh đề nghị xuất hàng) nằm ở `services/delivery_service.py`.

Hai truy vấn ở đây là XƯƠNG SỐNG của bản thiết kế, đọc kỹ trước khi "tối ưu":

* `da_giao_theo_dong()` — "đã giao bao nhiêu" tính bằng `SUM` từ `delivery_trip_lines`, KHÔNG đọc
  cột cộng dồn nào. Repo không có Alembic; một cột cộng dồn lệch là không có đường phát hiện.
* `chuyen_dang_chay_cua_kip()` — người đang ôm chuyến chưa xong (ở vai tài xế hoặc phụ xe). Chỉ
  để NHẮC lúc lên đơn: chuyến không còn giờ (mg 0400) nên không còn khái niệm "trùng giờ".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Session, aliased, selectinload

from ..models.delivery import (
    LAN_GIAO_CO_HANG_DEN_TAY,
    LAN_GIAO_DANG_CHAY,
    YC_CHO_LEN_KE_HOACH,
    YC_DA_HUY,
    DeliveryRequest,
    DeliveryRequestLine,
    DeliveryStatusHistory,
    DeliveryTrip,
    DeliveryTripAttachment,
    DeliveryTripLine,
)
from .loc_danh_sach import dk_khoang_ngay, hom_nay_vn

HAN_YEU_CAU = ("qua_han", "hom_nay", "ngay_mai", "sau")


def _dk_tim_yeu_cau(chu: str) -> list:
    """Ô tìm: mã yêu cầu, mã đơn, tên khách (không phân biệt hoa thường)."""
    from ..models.customer import Customer
    from ..models.order import Order

    p = f"%{chu.strip()}%"
    return [or_(
        DeliveryRequest.code.ilike(p),
        DeliveryRequest.order_id.in_(select(Order.id).where(Order.order_no.ilike(p))),
        DeliveryRequest.customer_id.in_(select(Customer.id).where(Customer.name.ilike(p))),
    )]


@dataclass
class LocYeuCau:
    """Kỳ + điều kiện của tab "Yêu cầu giao". Mốc: `tao` Ngày tạo, `can` Ngày cần giao (Date)."""
    q: str | None = None
    tu_ngay: date | None = None
    den_ngay: date | None = None
    moc: str = "tao"
    khach: int | None = None
    #: Hàng lọc nhanh "Cần giao": `qua_han` / `hom_nay` / `ngay_mai` / `sau` (sau ngày mai hoặc
    #: chưa hẹn ngày) — tính theo ngày giờ Việt Nam.
    han: str | None = None

    def dieu_kien(self) -> list:
        dk: list = []
        if self.q and self.q.strip():
            dk += _dk_tim_yeu_cau(self.q)
        if self.han in HAN_YEU_CAU:
            nay = hom_nay_vn()
            mai = nay + timedelta(days=1)
            cot = DeliveryRequest.ngay_can_giao
            dk.append({
                "qua_han": cot < nay,
                "hom_nay": cot == nay,
                "ngay_mai": cot == mai,
                "sau": or_(cot > mai, cot.is_(None)),
            }[self.han])
        cot, la_ngay = {
            "tao": (DeliveryRequest.created_at, False),
            "can": (DeliveryRequest.ngay_can_giao, True),
        }.get(self.moc, (DeliveryRequest.created_at, False))
        dk += dk_khoang_ngay(cot, self.tu_ngay, self.den_ngay, cot_ngay=la_ngay)
        if self.khach is not None:
            dk.append(DeliveryRequest.customer_id == self.khach)
        return dk


@dataclass
class LocChuyen:
    """Kỳ + điều kiện của tab "Đơn giao hàng" — lọc trên CHUYẾN; một lượt xe hiện khi có ít nhất
    một chuyến của nó khớp. Mốc: `tao` Ngày tạo (giờ lấy / giờ giao đã gỡ, mg 0400)."""
    q: str | None = None
    tu_ngay: date | None = None
    den_ngay: date | None = None
    moc: str = "tao"
    xe: int | None = None
    tai_xe: int | None = None
    trang_thai: list[str] = field(default_factory=list)

    def dieu_kien(self) -> list:
        from ..models.delivery import LuotXe, LuotXeDiem

        dk: list = []
        if self.q and self.q.strip():
            p = f"%{self.q.strip()}%"
            dk.append(or_(
                *_dk_tim_yeu_cau(self.q),
                DeliveryTrip.id.in_(
                    select(LuotXeDiem.delivery_trip_id)
                    .join(LuotXe, LuotXe.id == LuotXeDiem.luot_xe_id)
                    .where(LuotXe.code.ilike(p))),
            ))
        dk += dk_khoang_ngay(DeliveryTrip.created_at, self.tu_ngay, self.den_ngay)
        if self.xe is not None:
            dk.append(DeliveryTrip.vehicle_id == self.xe)
        if self.tai_xe is not None:
            dk.append(DeliveryTrip.employee_id == self.tai_xe)
        if self.trang_thai:
            dk.append(DeliveryTrip.trang_thai.in_(self.trang_thai))
        return dk


class DeliveryRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    # --- Yêu cầu giao hàng --------------------------------------------------------------
    def get_request(self, request_id: int) -> DeliveryRequest | None:
        return self.db.execute(
            select(DeliveryRequest)
            .options(selectinload(DeliveryRequest.lines),
                     selectinload(DeliveryRequest.trips).selectinload(DeliveryTrip.lines))
            .where(DeliveryRequest.id == request_id)
        ).scalar_one_or_none()

    def get_request_by_code(self, code: str) -> DeliveryRequest | None:
        return self.db.execute(
            select(DeliveryRequest).where(DeliveryRequest.code == code)
        ).scalar_one_or_none()

    def create_request(self, **kw) -> DeliveryRequest:
        row = DeliveryRequest(**kw)
        self.db.add(row)
        self.db.flush()
        return row

    def add_request_line(self, request_id: int, order_line_id: int, qty: int, *,
                         hang_loai=None, hang_id=None, dvt=None) -> DeliveryRequestLine:
        row = DeliveryRequestLine(request_id=request_id, order_line_id=order_line_id, qty=qty,
                                  hang_loai=hang_loai, hang_id=hang_id, dvt=dvt)
        self.db.add(row)
        self.db.flush()
        return row

    @staticmethod
    def _dk_yeu_cau(
        *,
        order_id: int | None = None,
        department_ids: list[int] | None = None,
        created_by: int | None = None,
        chi_cho_len_ke_hoach: bool = False,
        loc: LocYeuCau | None = None,
    ) -> list:
        """Điều kiện SQL của danh sách yêu cầu giao — MỘT chỗ cho cả trang lẫn đếm.

        `chi_cho_len_ke_hoach` khớp ĐÚNG trạng thái tính `trang_thai_yeu_cau()` = "chờ lên kế
        hoạch": chưa huỷ VÀ chưa có chuyến nào (kể cả chuyến đã đóng — khi đó yêu cầu mang trạng
        thái kết cục của chuyến, không quay về hàng chờ). Viết bằng NOT EXISTS để trang hoá thật ở
        SQL; trước 06/10/2026 lọc bằng Python sau truy vấn nên phải tải cửa sổ 200 dòng."""
        dk: list = []
        if order_id is not None:
            dk.append(DeliveryRequest.order_id == order_id)
        if department_ids is not None:
            dk.append(DeliveryRequest.department_id.in_(department_ids))
        if created_by is not None:
            dk.append(DeliveryRequest.created_by == created_by)
        if chi_cho_len_ke_hoach:
            dk.append(DeliveryRequest.trang_thai == YC_CHO_LEN_KE_HOACH)
            dk.append(~exists().where(DeliveryTrip.request_id == DeliveryRequest.id))
        if loc is not None:
            dk += loc.dieu_kien()
        return dk

    def list_requests(
        self,
        *,
        order_id: int | None = None,
        department_ids: list[int] | None = None,
        created_by: int | None = None,
        chi_cho_len_ke_hoach: bool = False,
        loc: LocYeuCau | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[DeliveryRequest]:
        q = (
            select(DeliveryRequest)
            .options(selectinload(DeliveryRequest.lines),
                     selectinload(DeliveryRequest.trips))
            .where(*self._dk_yeu_cau(order_id=order_id, department_ids=department_ids,
                                     created_by=created_by,
                                     chi_cho_len_ke_hoach=chi_cho_len_ke_hoach, loc=loc))
            .order_by(DeliveryRequest.id.desc())
        )
        if limit is not None:
            q = q.limit(limit).offset(offset)
        return list(self.db.execute(q).scalars().all())

    def count_requests(
        self,
        *,
        order_id: int | None = None,
        department_ids: list[int] | None = None,
        created_by: int | None = None,
        chi_cho_len_ke_hoach: bool = False,
        loc: LocYeuCau | None = None,
    ) -> int:
        q = select(func.count()).select_from(DeliveryRequest).where(
            *self._dk_yeu_cau(order_id=order_id, department_ids=department_ids,
                              created_by=created_by, chi_cho_len_ke_hoach=chi_cho_len_ke_hoach,
                              loc=loc))
        return int(self.db.execute(q).scalar() or 0)

    def dem_yeu_cau_theo(
        self,
        truong: str,
        *,
        department_ids: list[int] | None = None,
        created_by: int | None = None,
        chi_cho_len_ke_hoach: bool = False,
    ) -> list[tuple[int, str, int]]:
        """(id, tên, số yêu cầu) cho ô lọc "Khách hàng" (`truong="khach"`) / "Đơn hàng"
        (`truong="don"`) — chỉ những giá trị đang có yêu cầu TRONG tầm nhìn của tab."""
        from ..models.customer import Customer
        from ..models.order import Order

        if truong == "khach":
            q = (select(Customer.id, Customer.name, func.count(DeliveryRequest.id))
                 .join(Customer, Customer.id == DeliveryRequest.customer_id)
                 .group_by(Customer.id, Customer.name).order_by(Customer.name))
        else:
            q = (select(Order.id, Order.order_no, func.count(DeliveryRequest.id))
                 .join(Order, Order.id == DeliveryRequest.order_id)
                 .group_by(Order.id, Order.order_no).order_by(Order.order_no.desc()))
        q = q.where(*self._dk_yeu_cau(department_ids=department_ids, created_by=created_by,
                                      chi_cho_len_ke_hoach=chi_cho_len_ke_hoach))
        return [(int(i), t, int(n)) for i, t, n in self.db.execute(q)]

    def requests_mo_cua_don(self, order_id: int) -> list[DeliveryRequest]:
        """Yêu cầu CHƯA huỷ của một đơn — dùng để chặn đặt vượt số còn phải giao."""
        return list(self.db.execute(
            select(DeliveryRequest)
            .options(selectinload(DeliveryRequest.lines))
            .where(DeliveryRequest.order_id == order_id,
                   DeliveryRequest.trang_thai != YC_DA_HUY)
        ).scalars().all())

    def requests_mo_cua_nhieu_don(self, order_ids) -> dict[int, list[DeliveryRequest]]:
        """Bản lô của `requests_mo_cua_don` — `{order_id: [yêu cầu chưa huỷ]}` một lượt nạp."""
        ids = {int(i) for i in order_ids if i is not None}
        ra: dict[int, list[DeliveryRequest]] = {i: [] for i in ids}
        if not ids:
            return ra
        for r in self.db.execute(
            select(DeliveryRequest)
            .options(selectinload(DeliveryRequest.lines))
            .where(DeliveryRequest.order_id.in_(ids), DeliveryRequest.trang_thai != YC_DA_HUY)
        ).scalars().all():
            ra[int(r.order_id)].append(r)
        return ra

    def requests_cua_don_ca_huy(self, order_id: int) -> list[DeliveryRequest]:
        """MỌI yêu cầu của đơn, kể cả đã huỷ — Kinh doanh xem lại lịch sử giao của đơn."""
        return list(self.db.execute(
            select(DeliveryRequest)
            .options(selectinload(DeliveryRequest.lines))
            .where(DeliveryRequest.order_id == order_id)
        ).scalars().all())

    # --- "Đã giao bao nhiêu" — SUM, không phải cột --------------------------------------
    def da_giao_theo_dong(self, order_id: int) -> dict[int, int]:
        """{order_line_id: tổng số khách đã THỰC NHẬN} của cả đơn.

        Cộng từ `delivery_trip_lines` qua các lần `thanh_cong`/`giao_thieu`. Giao thất bại KHÔNG
        cộng (nghiệm thu #7) vì chuyến hỏng không sinh dòng `delivery_trip_lines` nào.
        """
        rows = self.db.execute(
            select(DeliveryTripLine.order_line_id, func.coalesce(func.sum(DeliveryTripLine.qty_giao), 0))
            .join(DeliveryTrip, DeliveryTrip.id == DeliveryTripLine.trip_id)
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryTrip.request_id)
            .where(DeliveryRequest.order_id == order_id,
                   DeliveryTrip.trang_thai.in_(LAN_GIAO_CO_HANG_DEN_TAY))
            .group_by(DeliveryTripLine.order_line_id)
        ).all()
        return {int(r[0]): int(r[1] or 0) for r in rows}

    def da_giao_theo_dong_nhieu_don(self, order_ids: list[int]) -> dict[int, int]:
        """Bản lô của `da_giao_theo_dong` cho nhiều đơn — MỘT câu: {order_line_id: đã thực nhận}."""
        if not order_ids:
            return {}
        rows = self.db.execute(
            select(DeliveryTripLine.order_line_id, func.coalesce(func.sum(DeliveryTripLine.qty_giao), 0))
            .join(DeliveryTrip, DeliveryTrip.id == DeliveryTripLine.trip_id)
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryTrip.request_id)
            .where(DeliveryRequest.order_id.in_(order_ids),
                   DeliveryTrip.trang_thai.in_(LAN_GIAO_CO_HANG_DEN_TAY))
            .group_by(DeliveryTripLine.order_line_id)
        ).all()
        return {int(r[0]): int(r[1] or 0) for r in rows}

    def giao_thang_theo_dong(self, order_id: int) -> dict[int, int]:
        """{order_line_id: phần đã giao do NHÀ GIA CÔNG GIAO THẲNG} — chuyến đứng tên lần gia công
        ngoài, hàng không qua KCS trên phần mềm, không qua kho. Là một phần của `da_giao_theo_dong`."""
        rows = self.db.execute(
            select(DeliveryTripLine.order_line_id, func.coalesce(func.sum(DeliveryTripLine.qty_giao), 0))
            .join(DeliveryTrip, DeliveryTrip.id == DeliveryTripLine.trip_id)
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryTrip.request_id)
            .where(DeliveryRequest.order_id == order_id,
                   DeliveryTrip.gia_cong_ngoai_id.is_not(None),
                   DeliveryTrip.trang_thai.in_(LAN_GIAO_CO_HANG_DEN_TAY))
            .group_by(DeliveryTripLine.order_line_id)
        ).all()
        return {int(r[0]): int(r[1] or 0) for r in rows}

    def giao_thang_theo_dong_nhieu_don(self, order_ids) -> dict[int, int]:
        """Bản lô của `giao_thang_theo_dong` cho nhiều đơn — MỘT câu: {order_line_id: đã giao thẳng}."""
        ids = {int(i) for i in order_ids if i is not None}
        if not ids:
            return {}
        rows = self.db.execute(
            select(DeliveryTripLine.order_line_id, func.coalesce(func.sum(DeliveryTripLine.qty_giao), 0))
            .join(DeliveryTrip, DeliveryTrip.id == DeliveryTripLine.trip_id)
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryTrip.request_id)
            .where(DeliveryRequest.order_id.in_(ids),
                   DeliveryTrip.gia_cong_ngoai_id.is_not(None),
                   DeliveryTrip.trang_thai.in_(LAN_GIAO_CO_HANG_DEN_TAY))
            .group_by(DeliveryTripLine.order_line_id)
        ).all()
        return {int(r[0]): int(r[1] or 0) for r in rows}

    def da_giao_cua_yeu_cau(self, request_id: int) -> dict[int, int]:
        """{order_line_id: đã thực nhận} nhưng chỉ trong PHẠM VI MỘT yêu cầu.

        Dùng để tính hàng còn phải xuất cho lần giao kế tiếp — `delivery_issue_requests` cố ý
        KHÔNG có bảng dòng riêng nên con số này phải tính ra mỗi lần.
        """
        rows = self.db.execute(
            select(DeliveryTripLine.order_line_id, func.coalesce(func.sum(DeliveryTripLine.qty_giao), 0))
            .join(DeliveryTrip, DeliveryTrip.id == DeliveryTripLine.trip_id)
            .where(DeliveryTrip.request_id == request_id,
                   DeliveryTrip.trang_thai.in_(LAN_GIAO_CO_HANG_DEN_TAY))
            .group_by(DeliveryTripLine.order_line_id)
        ).all()
        return {int(r[0]): int(r[1] or 0) for r in rows}

    def da_giao_theo_yeu_cau(self, request_ids: list[int]) -> dict[int, dict[int, int]]:
        """`{request_id: {order_line_id: đã thực nhận}}` cho NHIỀU yêu cầu trong MỘT truy vấn —
        cùng luật `da_giao_cua_yeu_cau`, dùng khi dựng cả trang bảng giao (gọi từng yêu cầu là N+1)."""
        if not request_ids:
            return {}
        rows = self.db.execute(
            select(DeliveryTrip.request_id, DeliveryTripLine.order_line_id,
                   func.coalesce(func.sum(DeliveryTripLine.qty_giao), 0))
            .join(DeliveryTrip, DeliveryTrip.id == DeliveryTripLine.trip_id)
            .where(DeliveryTrip.request_id.in_(set(request_ids)),
                   DeliveryTrip.trang_thai.in_(LAN_GIAO_CO_HANG_DEN_TAY))
            .group_by(DeliveryTrip.request_id, DeliveryTripLine.order_line_id)
        ).all()
        ra: dict[int, dict[int, int]] = {}
        for rid, olid, sl in rows:
            ra.setdefault(int(rid), {})[int(olid)] = int(sl or 0)
        return ra

    def requests_theo_ids(self, request_ids: list[int]) -> list[DeliveryRequest]:
        """Nhiều yêu cầu kèm dòng hàng trong một lượt nạp (không kéo theo chuyến như `get_request`)."""
        if not request_ids:
            return []
        return list(self.db.execute(
            select(DeliveryRequest)
            .options(selectinload(DeliveryRequest.lines))
            .where(DeliveryRequest.id.in_(set(request_ids)))
        ).scalars().all())

    # --- Lần giao -----------------------------------------------------------------------
    def get_trip(self, trip_id: int) -> DeliveryTrip | None:
        return self.db.execute(
            select(DeliveryTrip)
            .options(selectinload(DeliveryTrip.lines), selectinload(DeliveryTrip.request))
            .where(DeliveryTrip.id == trip_id)
        ).scalar_one_or_none()

    def trips_theo_ids(self, trip_ids) -> dict[int, DeliveryTrip]:
        """`{trip_id: chuyến}` kèm dòng + yêu cầu như `get_trip`, một lượt cho cả trang."""
        ids = {int(i) for i in trip_ids}
        if not ids:
            return {}
        return {t.id: t for t in self.db.execute(
            select(DeliveryTrip)
            .options(selectinload(DeliveryTrip.lines), selectinload(DeliveryTrip.request))
            .where(DeliveryTrip.id.in_(ids))
        ).scalars().all()}

    def create_trip(self, **kw) -> DeliveryTrip:
        row = DeliveryTrip(**kw)
        self.db.add(row)
        self.db.flush()
        return row

    def add_trip_line(self, trip_id: int, order_line_id: int, qty_giao: int) -> DeliveryTripLine:
        row = DeliveryTripLine(trip_id=trip_id, order_line_id=order_line_id, qty_giao=qty_giao)
        self.db.add(row)
        self.db.flush()
        return row

    # --- Nguồn hàng của đơn: lệnh + yêu cầu NHẬP thành phẩm từ KCS -------------------------
    def lenh_theo_dong_don(self, order_id: int) -> dict[int, list[int]]:
        """{order_line_id: [lsx_id]} của đơn — cụm bán có lệnh thì "kho đã nhận" đọc theo lệnh."""
        from ..models.lsx import Lsx

        out: dict[int, list[int]] = {}
        for lid, sid in self.db.execute(
            select(Lsx.order_line_id, Lsx.id).where(Lsx.order_id == order_id).order_by(Lsx.id)
        ).all():
            out.setdefault(int(lid), []).append(int(sid))
        return out

    def lenh_theo_dong_nhieu_don(self, order_ids) -> dict[int, dict[int, list[int]]]:
        """Bản lô của `lenh_theo_dong_don` — `{order_id: {order_line_id: [lsx_id]}}` một câu."""
        from ..models.lsx import Lsx

        ids = {int(i) for i in order_ids if i is not None}
        out: dict[int, dict[int, list[int]]] = {i: {} for i in ids}
        if not ids:
            return out
        for oid, lid, sid in self.db.execute(
            select(Lsx.order_id, Lsx.order_line_id, Lsx.id).where(Lsx.order_id.in_(ids)).order_by(Lsx.id)
        ).all():
            out[int(oid)].setdefault(int(lid), []).append(int(sid))
        return out

    def dong_don_theo_don(self, order_ids) -> dict[int, list]:
        """`{order_id: [dòng đơn theo id]}` một câu — như `order.lines` (quan hệ xếp theo id)."""
        from ..models.order import OrderLine

        ids = {int(i) for i in order_ids if i is not None}
        out: dict[int, list] = {i: [] for i in ids}
        if not ids:
            return out
        for ln in self.db.execute(
            select(OrderLine).where(OrderLine.order_id.in_(ids)).order_by(OrderLine.id)
        ).scalars().all():
            out[int(ln.order_id)].append(ln)
        return out

    def dong_nhap_tp_cua_lenh(self, lsx_ids) -> list:
        """`[(yêu cầu, dòng)]` NHẬP thành phẩm do KCS gửi (`san_xuat_cong_viec_id`) mà dòng trỏ vào
        các lệnh này. Yêu cầu NHẬP trả hàng về của giao hàng KHÔNG nằm ở đây (không có nguồn KCS)."""
        from ..models.stock_request import StockRequest, StockRequestLine

        ids = {int(i) for i in lsx_ids if i}
        if not ids:
            return []
        return list(self.db.execute(
            select(StockRequest, StockRequestLine)
            .join(StockRequestLine, StockRequestLine.request_id == StockRequest.id)
            .where(StockRequest.loai == "NHAP",
                   StockRequest.san_xuat_cong_viec_id.is_not(None),
                   StockRequestLine.lsx_id.in_(ids))
        ).all())

    def dong_giu_theo_ma(self, hang_ids) -> list:
        """`[(yêu cầu, dòng)]` yêu cầu giao CHƯA huỷ có dòng mang các mã kho (thành phẩm) này — MỌI
        đơn. Tồn của mã thành phẩm là hàng của khách (11/10/2026), nên phần đơn khác đang giữ phải
        trừ khỏi "giao được" của đơn này."""
        ids = {int(i) for i in hang_ids if i}
        if not ids:
            return []
        return list(self.db.execute(
            select(DeliveryRequest, DeliveryRequestLine)
            .join(DeliveryRequestLine, DeliveryRequestLine.request_id == DeliveryRequest.id)
            .where(DeliveryRequestLine.hang_loai == "vat_tu",
                   DeliveryRequestLine.hang_id.in_(ids),
                   DeliveryRequest.trang_thai != YC_DA_HUY)
        ).all())

    def da_xuat_theo_yeu_cau_giao(self, request_ids) -> dict[tuple[int, int], float]:
        """`{(id yêu cầu giao, hang_id): Σ đã xuất kho ghi sổ}` qua các yêu cầu XUẤT của chuyến. Phần
        đã xuất thì tồn kho đã giảm — trừ thêm lần nữa ở "đang giữ" là đếm hai lần."""
        from ..models.stock_request import REQ_CANCELLED, REQ_REJECTED, StockRequest, StockRequestLine

        ids = {int(i) for i in request_ids if i}
        if not ids:
            return {}
        rows = self.db.execute(
            select(DeliveryTrip.request_id, StockRequestLine.hang_id,
                   func.coalesce(func.sum(StockRequestLine.sl_da_ung), 0))
            .join(StockRequest, StockRequest.delivery_trip_id == DeliveryTrip.id)
            .join(StockRequestLine, StockRequestLine.request_id == StockRequest.id)
            .where(DeliveryTrip.request_id.in_(ids), StockRequest.loai == "XUAT",
                   StockRequest.trang_thai.notin_([REQ_CANCELLED, REQ_REJECTED]),
                   StockRequestLine.hang_loai == "vat_tu")
            .group_by(DeliveryTrip.request_id, StockRequestLine.hang_id)
        ).all()
        return {(int(r), int(h)): float(sl or 0) for r, h, sl in rows}

    def yeu_cau_kho_cua_chuyen(self, trip_id: int, loai: str):
        """Yêu cầu kho còn sống (không huỷ/từ chối) của chuyến — đọc thẳng, không cần service kho."""
        from ..models.stock_request import REQ_CANCELLED, REQ_REJECTED, StockRequest

        return self.db.execute(
            select(StockRequest).where(
                StockRequest.delivery_trip_id == trip_id, StockRequest.loai == loai,
                StockRequest.trang_thai.notin_([REQ_CANCELLED, REQ_REJECTED]),
            ).order_by(StockRequest.id.desc())
        ).scalars().first()

    def phieu_kho_cua_yeu_cau(self, stock_request_id: int):
        """Phiếu kho chưa huỷ mới nhất lập theo một yêu cầu kho — None khi kho chưa lập phiếu."""
        from ..models.stock_voucher import VOUCHER_CANCELLED, StockVoucher

        return self.db.execute(
            select(StockVoucher).where(
                StockVoucher.request_id == stock_request_id,
                StockVoucher.trang_thai != VOUCHER_CANCELLED,
            ).order_by(StockVoucher.id.desc())
        ).scalars().first()

    # --- Gom cho NHIỀU yêu cầu / chuyến một lượt (tiến độ đơn, 06/10/2026) -----------------------
    # Danh sách yêu cầu giao của ngăn đơn từng hỏi từng yêu cầu / từng chuyến (~10 câu SQL mỗi yêu
    # cầu) ⇒ đơn nhiều chuyến mở ngăn chậm dần. Mỗi hàm dưới = MỘT câu cho cả tập, cùng luật với bản
    # một-cái tương ứng.
    def trips_cua_nhieu_yeu_cau(self, request_ids: list[int]) -> dict[int, list[DeliveryTrip]]:
        """{request_id: [chuyến theo lan_thu]} — như `trips_cua_yeu_cau`."""
        ra: dict[int, list[DeliveryTrip]] = {i: [] for i in request_ids}
        if not request_ids:
            return ra
        for t in self.db.execute(
            select(DeliveryTrip)
            .options(selectinload(DeliveryTrip.lines))
            .where(DeliveryTrip.request_id.in_(request_ids))
            .order_by(DeliveryTrip.request_id, DeliveryTrip.lan_thu)
        ).scalars().all():
            ra[t.request_id].append(t)
        return ra

    def yeu_cau_kho_cua_nhieu_chuyen(self, trip_ids, loai: str) -> dict[int, object]:
        """{trip_id: yêu cầu kho còn sống MỚI NHẤT} — như `yeu_cau_kho_cua_chuyen`, một câu cho cả tập."""
        from ..models.stock_request import REQ_CANCELLED, REQ_REJECTED, StockRequest

        ids = {int(i) for i in trip_ids if i}
        if not ids:
            return {}
        ra: dict[int, object] = {}
        for y in self.db.execute(
            select(StockRequest).where(
                StockRequest.delivery_trip_id.in_(ids), StockRequest.loai == loai,
                StockRequest.trang_thai.notin_([REQ_CANCELLED, REQ_REJECTED]),
            ).order_by(StockRequest.id.desc())
        ).scalars().all():
            ra.setdefault(int(y.delivery_trip_id), y)
        return ra

    def da_giao_cua_nhieu_yeu_cau(self, request_ids: list[int]) -> dict[int, dict[int, int]]:
        """{request_id: {order_line_id: đã thực nhận}} — như `da_giao_cua_yeu_cau`."""
        ra: dict[int, dict[int, int]] = {i: {} for i in request_ids}
        if not request_ids:
            return ra
        for rid, olid, sl in self.db.execute(
            select(DeliveryTrip.request_id, DeliveryTripLine.order_line_id,
                   func.coalesce(func.sum(DeliveryTripLine.qty_giao), 0))
            .join(DeliveryTrip, DeliveryTrip.id == DeliveryTripLine.trip_id)
            .where(DeliveryTrip.request_id.in_(request_ids),
                   DeliveryTrip.trang_thai.in_(LAN_GIAO_CO_HANG_DEN_TAY))
            .group_by(DeliveryTrip.request_id, DeliveryTripLine.order_line_id)
        ).all():
            ra[int(rid)][int(olid)] = int(sl or 0)
        return ra

    def yeu_cau_kho_cua_nhieu_chuyen(self, trip_ids: list[int], loai: str) -> dict[int, object]:
        """{trip_id: yêu cầu kho còn sống mới nhất} — như `yeu_cau_kho_cua_chuyen`; chuyến không có
        thì vắng mặt."""
        from ..models.stock_request import REQ_CANCELLED, REQ_REJECTED, StockRequest

        ra: dict[int, object] = {}
        if not trip_ids:
            return ra
        for r in self.db.execute(
            select(StockRequest).where(
                StockRequest.delivery_trip_id.in_(trip_ids), StockRequest.loai == loai,
                StockRequest.trang_thai.notin_([REQ_CANCELLED, REQ_REJECTED]),
            ).order_by(StockRequest.id.desc())
        ).scalars().all():
            ra.setdefault(r.delivery_trip_id, r)
        return ra

    def yeu_cau_kho_da_co_phieu(self, stock_request_ids: list[int]) -> set[int]:
        """Các yêu cầu kho đã có phiếu kho CHƯA huỷ — mốc "kho đã lập phiếu" của `kho_da_lap_phieu`."""
        from ..models.stock_voucher import VOUCHER_CANCELLED, StockVoucher

        if not stock_request_ids:
            return set()
        return {int(i) for (i,) in self.db.execute(
            select(StockVoucher.request_id).distinct().where(
                StockVoucher.request_id.in_(stock_request_ids),
                StockVoucher.trang_thai != VOUCHER_CANCELLED,
            )
        ).all()}

    def luot_khach_da_nhan_cua_don(self, order_id: int) -> list[DeliveryTrip]:
        """Các lượt `thanh_cong`/`giao_thieu` của đơn kèm dòng thực nhận và yêu cầu, theo thứ tự
        giao xong — nguồn giá trị "đã giao" để ghi hóa đơn."""
        return list(self.db.execute(
            select(DeliveryTrip)
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryTrip.request_id)
            .options(selectinload(DeliveryTrip.lines), selectinload(DeliveryTrip.request))
            .where(DeliveryRequest.order_id == order_id,
                   DeliveryTrip.trang_thai.in_(LAN_GIAO_CO_HANG_DEN_TAY))
            .order_by(DeliveryTrip.thoi_gian_ket_thuc.is_(None), DeliveryTrip.thoi_gian_ket_thuc,
                      DeliveryTrip.id)
        ).scalars().all())

    def yeu_cau_kho_da_ghi_so(self, stock_request_ids: list[int]) -> set[int]:
        """Các yêu cầu kho đã có phiếu GHI SỔ — hàng đã thực ra khỏi kho (mốc in phiếu xuất bán hàng)."""
        from ..models.stock_voucher import VOUCHER_POSTED, StockVoucher

        if not stock_request_ids:
            return set()
        return {int(i) for (i,) in self.db.execute(
            select(StockVoucher.request_id).distinct().where(
                StockVoucher.request_id.in_(stock_request_ids),
                StockVoucher.trang_thai == VOUCHER_POSTED,
            )
        ).all()}

    def phieu_da_ghi_so_cua_yeu_cau(self, stock_request_id: int) -> list:
        """Phiếu kho ĐÃ GHI SỔ của một yêu cầu kho, cũ trước (kèm dòng)."""
        from ..models.stock_voucher import VOUCHER_POSTED, StockVoucher

        return list(self.db.execute(
            select(StockVoucher).where(
                StockVoucher.request_id == stock_request_id,
                StockVoucher.trang_thai == VOUCHER_POSTED,
            ).order_by(StockVoucher.id)
        ).scalars().all())

    def phieu_kho_cua_nhieu_yeu_cau(self, stock_request_ids) -> dict[int, object]:
        """{stock_request_id: phiếu kho chưa huỷ mới nhất} — như `phieu_kho_cua_yeu_cau`; yêu cầu
        kho chưa có phiếu thì vắng mặt."""
        from ..models.stock_voucher import VOUCHER_CANCELLED, StockVoucher

        ids = {int(i) for i in stock_request_ids}
        ra: dict[int, object] = {}
        if not ids:
            return ra
        for p in self.db.execute(
            select(StockVoucher).where(
                StockVoucher.request_id.in_(ids), StockVoucher.trang_thai != VOUCHER_CANCELLED,
            ).order_by(StockVoucher.id.desc())
        ).scalars().all():
            ra.setdefault(int(p.request_id), p)
        return ra

    def so_dinh_kem_theo_trip(self, trip_ids: list[int]) -> dict[int, int]:
        if not trip_ids:
            return {}
        return {int(t): int(n) for t, n in self.db.execute(
            select(DeliveryTripAttachment.trip_id, func.count(DeliveryTripAttachment.id))
            .where(DeliveryTripAttachment.trip_id.in_(trip_ids))
            .group_by(DeliveryTripAttachment.trip_id)
        ).all()}

    def trips_cua_yeu_cau(self, request_id: int) -> list[DeliveryTrip]:
        return list(self.db.execute(
            select(DeliveryTrip)
            .options(selectinload(DeliveryTrip.lines))
            .where(DeliveryTrip.request_id == request_id)
            .order_by(DeliveryTrip.lan_thu)
        ).scalars().all())

    def trip_dang_chay(self, request_id: int) -> DeliveryTrip | None:
        """Lần giao còn sống của yêu cầu — nghiệm thu #3 chặn có quá một."""
        return self.db.execute(
            select(DeliveryTrip)
            .where(DeliveryTrip.request_id == request_id,
                   DeliveryTrip.trang_thai.in_(LAN_GIAO_DANG_CHAY))
            .order_by(DeliveryTrip.lan_thu.desc())
        ).scalars().first()

    def lan_thu_ke_tiep(self, request_id: int) -> int:
        cao_nhat = self.db.execute(
            select(func.max(DeliveryTrip.lan_thu)).where(DeliveryTrip.request_id == request_id)
        ).scalar()
        return int(cao_nhat or 0) + 1

    def _loc_chuyen(self, q, *, employee_ids, department_ids, trang_thai, latest_per_request,
                    loc: LocChuyen | None = None):
        if loc is not None:
            q = q.where(*loc.dieu_kien())
        if employee_ids is not None:
            # "Của tôi" = chuyến có tên mình — tài xế HOẶC phụ xe (cùng đi, cùng chia tiền chuyến).
            q = q.where(or_(DeliveryTrip.employee_id.in_(employee_ids),
                            DeliveryTrip.phu_xe_employee_id.in_(employee_ids)))
        if department_ids is not None:
            q = q.where(DeliveryRequest.department_id.in_(department_ids))
        if trang_thai:
            q = q.where(DeliveryTrip.trang_thai.in_(trang_thai))
        if latest_per_request:
            # Gộp theo yêu cầu — chỉ lấy chuyến MỚI NHẤT (lan_thu lớn nhất) của mỗi yêu cầu, khớp
            # `gopTheoYeuCau()` phía FE. Từ 22/08/2026 mỗi yêu cầu chỉ còn 1 chuyến sống nên đây
            # chủ yếu chừa cho dữ liệu cũ (nhiều `lan_thu` một yêu cầu) trước mốc đó.
            t2 = aliased(DeliveryTrip)
            max_lan_thu = (
                select(func.max(t2.lan_thu))
                .where(t2.request_id == DeliveryTrip.request_id)
                .correlate(DeliveryTrip)
                .scalar_subquery()
            )
            q = q.where(DeliveryTrip.lan_thu == max_lan_thu)
        return q

    def list_trips(
        self,
        *,
        employee_ids: list[int] | None = None,
        department_ids: list[int] | None = None,
        trang_thai: list[str] | None = None,
        latest_per_request: bool = False,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[DeliveryTrip]:
        q = (
            select(DeliveryTrip)
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryTrip.request_id)
            .options(selectinload(DeliveryTrip.lines), selectinload(DeliveryTrip.request))
            .order_by(DeliveryTrip.created_at.desc(), DeliveryTrip.id.desc())
        )
        q = self._loc_chuyen(q, employee_ids=employee_ids, department_ids=department_ids,
                             trang_thai=trang_thai, latest_per_request=latest_per_request)
        if limit is not None:
            q = q.limit(limit).offset(offset)
        return list(self.db.execute(q).scalars().all())

    def count_trips(
        self,
        *,
        employee_ids: list[int] | None = None,
        department_ids: list[int] | None = None,
        trang_thai: list[str] | None = None,
        latest_per_request: bool = False,
        loc: LocChuyen | None = None,
    ) -> int:
        q = (
            select(func.count())
            .select_from(DeliveryTrip)
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryTrip.request_id)
        )
        q = self._loc_chuyen(q, employee_ids=employee_ids, department_ids=department_ids,
                             trang_thai=trang_thai, latest_per_request=latest_per_request, loc=loc)
        return int(self.db.execute(q).scalar() or 0)

    def dem_chuyen_theo(
        self,
        truong: str,
        *,
        employee_ids: list[int] | None = None,
        department_ids: list[int] | None = None,
    ) -> list[tuple[int, str, int]]:
        """(id, tên, số đơn giao) cho ô lọc "Xe" (`truong="xe"`, tên = biển số) / "Tài xế"
        (`truong="tai_xe"`) của tab Đơn giao hàng — đếm như `so_don` (chuyến mới nhất mỗi yêu cầu)
        trong tầm nhìn."""
        from ..models.employee import Employee
        from ..models.xe import Xe

        if truong == "xe":
            q = (select(Xe.id, Xe.ma, func.count(DeliveryTrip.id))
                 .select_from(DeliveryTrip)
                 .join(Xe, Xe.id == DeliveryTrip.vehicle_id)
                 .group_by(Xe.id, Xe.ma).order_by(Xe.ma))
        else:
            q = (select(Employee.id, Employee.full_name, func.count(DeliveryTrip.id))
                 .select_from(DeliveryTrip)
                 .join(Employee, Employee.id == DeliveryTrip.employee_id)
                 .group_by(Employee.id, Employee.full_name).order_by(Employee.full_name))
        q = q.join(DeliveryRequest, DeliveryRequest.id == DeliveryTrip.request_id)
        q = self._loc_chuyen(q, employee_ids=employee_ids, department_ids=department_ids,
                             trang_thai=None, latest_per_request=True)
        return [(int(i), t, int(n)) for i, t, n in self.db.execute(q)]

    def khoi_bang_giao(
        self,
        *,
        employee_ids: list[int] | None = None,
        department_ids: list[int] | None = None,
        trang_thai: list[str] | None = None,
        loc: LocChuyen | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[tuple[str, int]], int]:
        """Một trang của tab "Đơn giao hàng" tính theo KHỐI: một LƯỢT XE = một khối, chuyến ngoài
        lượt = một khối. Trả `([("luot", id) | ("chuyen", id)], tổng số khối)`.

        Khoá khối là MỘT cột số nguyên — `-luot_xe_id` cho lượt, `trip.id` cho chuyến lẻ — để
        GROUP BY / ORDER BY / LIMIT chạy ngay trong SQL. Trang hoá theo chuyến rồi mới gom là cắt
        đôi một lượt qua hai trang: nửa lượt ở trang 1, nửa kia ở trang 2 (chủ chốt 18/09/2026:
        người lên đơn và tài xế phải thấy một lượt là MỘT khối).
        """
        from ..models.delivery import LuotXeDiem

        khoa = func.coalesce(-LuotXeDiem.luot_xe_id, DeliveryTrip.id).label("khoa")
        q = (
            select(khoa, func.max(DeliveryTrip.created_at).label("moc"))
            .select_from(DeliveryTrip)
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryTrip.request_id)
            .outerjoin(LuotXeDiem, LuotXeDiem.delivery_trip_id == DeliveryTrip.id)
        )
        q = self._loc_chuyen(q, employee_ids=employee_ids, department_ids=department_ids,
                             trang_thai=trang_thai, latest_per_request=True, loc=loc)
        nhom = q.group_by(khoa).subquery()
        tong = int(self.db.execute(select(func.count()).select_from(nhom)).scalar() or 0)
        khoa_trang = self.db.execute(
            select(nhom.c.khoa).order_by(nhom.c.moc.desc(), nhom.c.khoa.desc())
            .limit(limit).offset(offset)
        ).scalars().all()
        return [("luot", -int(k)) if int(k) < 0 else ("chuyen", int(k)) for k in khoa_trang], tong

    def tong_km_theo_yeu_cau(self, request_ids: list[int]) -> dict[int, int]:
        """{request_id: TỔNG km cả các lần giao} — không chỉ km của chuyến mới nhất.

        Dùng cho cột "Tổng km" ở tab đã gộp theo yêu cầu; tách khỏi `list_trips(latest_per_request)`
        vì bản thân dòng hiển thị chỉ còn CHUYẾN MỚI NHẤT, mất km của các lần trước nếu không cộng
        riêng.
        """
        if not request_ids:
            return {}
        rows = self.db.execute(
            select(DeliveryTrip.request_id, func.coalesce(func.sum(DeliveryTrip.km), 0))
            .where(DeliveryTrip.request_id.in_(request_ids))
            .group_by(DeliveryTrip.request_id)
        ).all()
        return {int(r[0]): int(r[1] or 0) for r in rows}

    def chuyen_cua_kip(self, employee_id: int) -> list[DeliveryTrip]:
        """Chuyến người này có mặt — ở vai tài xế HOẶC phụ xe, mới nhất trước.

        Cho nhãn trạng thái (Rảnh / Có lịch / Đang giao) và chuyến đang chạy ở tab Nhân viên giao
        hàng. Lọc mỗi `employee_id` thì phụ xe đang ngồi trên xe vẫn hiện "Rảnh" (12/10/2026) —
        cùng lý do `chuyen_dang_chay_cua_kip` soi cả hai vai.
        """
        q = (
            select(DeliveryTrip)
            .where(or_(DeliveryTrip.employee_id == employee_id,
                       DeliveryTrip.phu_xe_employee_id == employee_id))
            .order_by(DeliveryTrip.created_at.desc(), DeliveryTrip.id.desc())
        )
        return list(self.db.execute(q).scalars().all())

    def chuyen_cua_nhieu_kip(self, employee_ids, *, ket_thuc_tu=None,
                             ket_thuc_den=None) -> dict[int, list[DeliveryTrip]]:
        """Bản lô của `chuyen_cua_kip` — `{employee_id: [chuyến]}` trong MỘT câu, cùng thứ tự (mới
        nhất trước). Tab Nhân viên giao hàng từng hỏi 3 lần mỗi người (26/10/2026).

        `ket_thuc_tu`/`ket_thuc_den` (cùng có hoặc cùng không): chỉ chuyến ĐANG CHẠY + chuyến kết
        thúc trong `[tu, den)` — tab Nhân viên chỉ cần chừng ấy, nạp cả lịch sử là 7,7 s trên DB đo
        tải 26/10/2026 (18 nghìn chuyến)."""
        ids = {int(i) for i in employee_ids if i is not None}
        ra: dict[int, list[DeliveryTrip]] = {i: [] for i in ids}
        if not ids:
            return ra
        stmt = select(DeliveryTrip).where(
            or_(DeliveryTrip.employee_id.in_(ids), DeliveryTrip.phu_xe_employee_id.in_(ids)))
        if ket_thuc_tu is not None:
            stmt = stmt.where(or_(
                DeliveryTrip.trang_thai.in_(LAN_GIAO_DANG_CHAY),
                and_(DeliveryTrip.thoi_gian_ket_thuc >= ket_thuc_tu,
                     DeliveryTrip.thoi_gian_ket_thuc < ket_thuc_den),
            ))
        for t in self.db.execute(
            stmt.order_by(DeliveryTrip.created_at.desc(), DeliveryTrip.id.desc())
        ).scalars().all():
            # Một chuyến thuộc CẢ tài xế lẫn phụ xe — như hai lần gọi `chuyen_cua_kip` riêng.
            for eid in {t.employee_id, t.phu_xe_employee_id}:
                if eid in ra:
                    ra[eid].append(t)
        return ra

    def nhan_vien_co_chuyen(self, employee_ids) -> set[int]:
        """Những người (trong `employee_ids`) có ít nhất một chuyến ở vai tài xế HOẶC phụ xe —
        cùng luật `bool(list_trips(employee_ids=[id]))` nhưng MỘT câu cho cả danh sách."""
        ids = {int(i) for i in employee_ids if i is not None}
        if not ids:
            return set()
        ra: set[int] = set()
        for tx, px in self.db.execute(
            select(DeliveryTrip.employee_id, DeliveryTrip.phu_xe_employee_id)
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryTrip.request_id)
            .where(or_(DeliveryTrip.employee_id.in_(ids), DeliveryTrip.phu_xe_employee_id.in_(ids)))
            .distinct()
        ).all():
            ra.update(i for i in (tx, px) if i in ids)
        return ra

    def ma_yeu_cau_theo_ids(self, request_ids) -> dict[int, str]:
        """`{request_id: mã}` trong một câu — khỏi nạp cả yêu cầu chỉ để đọc mã."""
        ids = {int(i) for i in request_ids if i is not None}
        if not ids:
            return {}
        return {int(i): c for i, c in self.db.execute(
            select(DeliveryRequest.id, DeliveryRequest.code).where(DeliveryRequest.id.in_(ids))
        ).all()}

    def chuyen_dang_chay_cua_kip(
        self,
        *,
        employee_id: int,
        bo_qua_trip_id: int | None = None,
        bo_qua_luot_id: int | None = None,
    ) -> list[DeliveryTrip]:
        """Chuyến CÒN SỐNG mà người này đang ở vai tài xế HOẶC phụ xe (mg 0231 — phụ xe cũng là
        người đang bận). `bo_qua_luot_id`: các chuyến cùng một lượt là cùng một vòng xe, không
        tính. Chỉ để NHẮC lúc lên đơn, không chặn (giờ chuyến gỡ ở mg 0400)."""
        q = (
            select(DeliveryTrip)
            .where(or_(DeliveryTrip.employee_id == employee_id,
                       DeliveryTrip.phu_xe_employee_id == employee_id),
                   DeliveryTrip.trang_thai.in_(LAN_GIAO_DANG_CHAY))
            .order_by(DeliveryTrip.id)
        )
        if bo_qua_trip_id is not None:
            q = q.where(DeliveryTrip.id != bo_qua_trip_id)
        if bo_qua_luot_id is not None:
            from ..models.delivery import LuotXeDiem

            q = q.where(DeliveryTrip.id.not_in(
                select(LuotXeDiem.delivery_trip_id).where(LuotXeDiem.luot_xe_id == bo_qua_luot_id)))
        return list(self.db.execute(q).scalars().all())

    # --- Lịch sử trạng thái --------------------------------------------------------------
    def ghi_lich_su(
        self,
        *,
        trip_id: int,
        tu_trang_thai: str | None,
        den_trang_thai: str,
        nguoi_thao_tac_id: int | None,
        ghi_chu: str | None = None,
        ly_do: str | None = None,
    ) -> DeliveryStatusHistory:
        row = DeliveryStatusHistory(
            trip_id=trip_id, tu_trang_thai=tu_trang_thai, den_trang_thai=den_trang_thai,
            nguoi_thao_tac_id=nguoi_thao_tac_id, ghi_chu=ghi_chu, ly_do=ly_do,
        )
        self.db.add(row)
        self.db.flush()
        return row

    def dinh_kem_cua_trip(self, trip_id: int) -> list[DeliveryTripAttachment]:
        return list(self.db.execute(
            select(DeliveryTripAttachment)
            .where(DeliveryTripAttachment.trip_id == trip_id)
            .order_by(DeliveryTripAttachment.id)
        ).scalars().all())

    def get_dinh_kem(self, attachment_id: int) -> DeliveryTripAttachment | None:
        return self.db.get(DeliveryTripAttachment, attachment_id)

    def them_dinh_kem(self, **kw) -> DeliveryTripAttachment:
        row = DeliveryTripAttachment(**kw)
        self.db.add(row)
        self.db.flush()
        return row

    def xoa_dinh_kem(self, row) -> None:
        self.db.delete(row)
        self.db.flush()

    def lich_su_cua_trip(self, trip_id: int) -> list[DeliveryStatusHistory]:
        return list(self.db.execute(
            select(DeliveryStatusHistory)
            .where(DeliveryStatusHistory.trip_id == trip_id)
            .order_by(DeliveryStatusHistory.id)
        ).scalars().all())

    def lich_su_cua_cac_trip(self, trip_ids: list[int]) -> list[DeliveryStatusHistory]:
        """Lịch sử của NHIỀU chuyến trong một truy vấn — chi tiết yêu cầu gọi từng chuyến là N+1."""
        if not trip_ids:
            return []
        return list(self.db.execute(
            select(DeliveryStatusHistory)
            .where(DeliveryStatusHistory.trip_id.in_(set(trip_ids)))
            .order_by(DeliveryStatusHistory.id)
        ).scalars().all())

    # --- Chuyến chưa ghi kết quả của một phòng ------------------------------------------------
    def dem_chuyen_chua_ket_qua_cua_phong(self, department_id: int) -> int:
        """Số chuyến CHƯA ghi kết quả mà TÀI XẾ đang thuộc phòng này.

        Dùng để CHẶN tắt cờ Giao hàng (chủ chốt 14/09/2026): đơn giá khoán km chụp lúc GHI KẾT
        QUẢ và tra theo phòng của tài xế — tắt cờ trước lúc đó là chuyến đóng xong với
        `don_gia_km = NULL`, tài xế mất trắng tiền mà không có lỗi nào (đã đo thực nghiệm).

        Bốn trạng thái, KHÔNG gồm `dang_tra_hang`: chuyến đó đã ghi kết quả (giao thất bại), đơn
        giá đã chụp rồi, tắt cờ lúc này không làm mất gì. Đếm theo TÀI XẾ chứ không theo phụ xe vì
        cả đơn giá lẫn % chia đều tra theo phòng của tài xế.
        """
        from ..models.delivery import (
            LG_DA_LAY_HANG, LG_DA_LEN_KE_HOACH, LG_DANG_CHUAN_BI, LG_DANG_GIAO,
        )
        from ..models.employee import Employee

        return int(self.db.execute(
            select(func.count()).select_from(DeliveryTrip)
            .join(Employee, Employee.id == DeliveryTrip.employee_id)
            .where(Employee.department_id == department_id,
                   DeliveryTrip.trang_thai.in_((LG_DA_LEN_KE_HOACH, LG_DANG_CHUAN_BI,
                                                LG_DA_LAY_HANG, LG_DANG_GIAO)))
        ).scalar() or 0)

    # --- Lượt xe (PRD khoán km §14, 18/09/2026) ----------------------------------------------
    def get_luot(self, luot_id: int):
        from ..models.delivery import LuotXe

        return self.db.execute(
            select(LuotXe).options(selectinload(LuotXe.diem)).where(LuotXe.id == luot_id)
        ).scalar_one_or_none()

    def luot_theo_ids(self, luot_ids) -> dict[int, object]:
        """`{luot_id: lượt}` kèm các điểm — như `get_luot`, một lượt cho cả trang."""
        from ..models.delivery import LuotXe

        ids = {int(i) for i in luot_ids}
        if not ids:
            return {}
        return {l.id: l for l in self.db.execute(
            select(LuotXe).options(selectinload(LuotXe.diem)).where(LuotXe.id.in_(ids))
        ).scalars().all()}

    def trang_thai_theo_trip(self, trip_ids) -> dict[int, str]:
        """`{trip_id: trạng thái}` — lượt chỉ cần biết điểm nào còn chạy, khỏi nạp cả chuyến."""
        ids = {int(i) for i in trip_ids}
        if not ids:
            return {}
        return {int(i): tt for i, tt in self.db.execute(
            select(DeliveryTrip.id, DeliveryTrip.trang_thai).where(DeliveryTrip.id.in_(ids))
        ).all()}

    def get_luot_by_code(self, code: str):
        from ..models.delivery import LuotXe

        return self.db.execute(select(LuotXe).where(LuotXe.code == code)).scalar_one_or_none()

    def create_luot(self, **kw):
        from ..models.delivery import LuotXe

        row = LuotXe(**kw)
        self.db.add(row)
        self.db.flush()
        return row

    def them_diem(self, luot_id: int, trip_id: int):
        from ..models.delivery import LuotXeDiem

        row = LuotXeDiem(luot_xe_id=luot_id, delivery_trip_id=trip_id)
        self.db.add(row)
        self.db.flush()
        return row

    def diem_cua_trip(self, trip_id: int):
        from ..models.delivery import LuotXeDiem

        return self.db.execute(
            select(LuotXeDiem).where(LuotXeDiem.delivery_trip_id == trip_id)
        ).scalar_one_or_none()

    def diem_theo_trip(self, trip_ids: list[int]) -> dict:
        """`{trip_id: LuotXeDiem}` cho cả trang chuyến — 1 truy vấn, không N+1."""
        from ..models.delivery import LuotXe, LuotXeDiem

        if not trip_ids:
            return {}
        rows = self.db.execute(
            select(LuotXeDiem).options(selectinload(LuotXeDiem.luot).selectinload(LuotXe.diem))
            .where(LuotXeDiem.delivery_trip_id.in_(trip_ids))
        ).scalars().all()
        return {int(r.delivery_trip_id): r for r in rows}

    def xoa_diem(self, row) -> None:
        self.db.delete(row)
        self.db.flush()

    def xoa_luot(self, row) -> None:
        self.db.delete(row)
        self.db.flush()

    def luot_mo_cua_xe(self, vehicle_id: int) -> list:
        """Lượt CHƯA về kho của một xe — mới nhất trước (ô Lượt xe lúc lên đơn)."""
        from ..models.delivery import LuotXe

        return list(self.db.execute(
            select(LuotXe).options(selectinload(LuotXe.diem))
            .where(LuotXe.vehicle_id == vehicle_id, LuotXe.ve_kho_luc.is_(None))
            .order_by(LuotXe.id.desc())
        ).scalars().all())

    def so_dong_ho_cuoi_cua_xe(self, vehicle_id: int, *, bo_qua_luot_id: int | None = None) -> int | None:
        """Số đồng hồ LỚN NHẤT đã ghi cho xe này, ở mọi lượt khác — gợi ý số lúc xuất phát, và là
        mốc để báo "xe chạy ngoài sổ N km" khi số xuất phát nhảy xa hơn."""
        from ..models.delivery import LuotXe, LuotXeDiem

        cond = [LuotXe.vehicle_id == vehicle_id]
        if bo_qua_luot_id is not None:
            cond.append(LuotXe.id != bo_qua_luot_id)
        ve_kho = self.db.execute(
            select(func.max(LuotXe.so_dong_ho_ve_kho)).where(*cond)
        ).scalar()
        xuat_phat = self.db.execute(
            select(func.max(LuotXe.so_dong_ho_xuat_phat)).where(*cond)
        ).scalar()
        diem = self.db.execute(
            select(func.max(LuotXeDiem.so_dong_ho))
            .join(LuotXe, LuotXe.id == LuotXeDiem.luot_xe_id).where(*cond)
        ).scalar()
        so = [int(x) for x in (ve_kho, xuat_phat, diem) if x is not None]
        return max(so) if so else None

    def so_dong_ho_cuoi_theo_luot(self, luots) -> dict[int, int | None]:
        """`{luot_id: so_dong_ho_cuoi_cua_xe(xe của lượt, bỏ qua chính lượt đó)}` cho nhiều lượt."""
        return {lid: (n["so"] if n else None) for lid, n in self.nguon_so_cuoi_theo_luot(luots).items()}

    def nguon_so_cuoi_theo_luot(self, luots) -> dict[int, dict | None]:
        """Số cuối của xe (như `so_dong_ho_cuoi_cua_xe`) KÈM nơi nó ghi: lượt nào, lúc về kho / tới
        khách / rời kho — hộp Bắt đầu giao lấy sẵn số này và nói rõ nó từ đâu ra. Hai truy vấn: số
        lớn nhất của TỪNG lượt cùng xe, rồi mỗi lượt lấy số lớn nhất của các lượt còn lại. Cùng số
        thì ưu tiên về kho, rồi tới khách, rồi rời kho."""
        from ..models.delivery import LuotXe, LuotXeDiem

        xe = {int(l.vehicle_id) for l in luots if l.vehicle_id is not None}
        if not xe:
            return {l.id: None for l in luots}
        # (so, ưu tiên, luot_id) — max theo bộ này là số cuối.
        moi_luot: dict[int, tuple[int, list[tuple[int, int, int]], dict]] = {}
        for lid, vid, code, ngay, ve_kho, ve_kho_luc, xuat_phat in self.db.execute(
            select(LuotXe.id, LuotXe.vehicle_id, LuotXe.code, LuotXe.ngay, LuotXe.so_dong_ho_ve_kho,
                   LuotXe.ve_kho_luc, LuotXe.so_dong_ho_xuat_phat)
            .where(LuotXe.vehicle_id.in_(xe))
        ).all():
            ds = [(int(s), u, int(lid)) for s, u in ((ve_kho, 2), (xuat_phat, 0)) if s is not None]
            moi_luot[int(lid)] = (int(vid), ds, {"luot_code": code, "ngay": ngay, "ve_kho_luc": ve_kho_luc})
        for lid, so in self.db.execute(
            select(LuotXeDiem.luot_xe_id, func.max(LuotXeDiem.so_dong_ho))
            .join(LuotXe, LuotXe.id == LuotXeDiem.luot_xe_id)
            .where(LuotXe.vehicle_id.in_(xe)).group_by(LuotXeDiem.luot_xe_id)
        ).all():
            if so is not None and int(lid) in moi_luot:
                moi_luot[int(lid)][1].append((int(so), 1, int(lid)))
        loai = {2: "ve_kho", 1: "toi_khach", 0: "xuat_phat"}
        ra: dict[int, dict | None] = {}
        for l in luots:
            top = max((k for lid, (vid, ds, _) in moi_luot.items()
                       if vid == l.vehicle_id and lid != l.id for k in ds), default=None)
            if top is None:
                ra[l.id] = None
                continue
            so, u, lid = top
            tt = moi_luot[lid][2]
            ra[l.id] = {"so": so, "loai": loai[u], "luot_code": tt["luot_code"], "ngay": tt["ngay"],
                        "luc": tt["ve_kho_luc"] if u == 2 else None}
        return ra

    def luot_ve_kho_trong_khoang(self, tu: datetime, den: datetime) -> list:
        """Lượt đã về kho trong [tu, den) — nguồn tiền CHẶNG VỀ KHO của kỳ lương."""
        from ..models.delivery import LuotXe

        return list(self.db.execute(
            select(LuotXe).where(LuotXe.ve_kho_luc >= tu, LuotXe.ve_kho_luc < den)
        ).scalars().all())

    def ve_kho_cua_tai_xe(self, employee_id: int) -> list[tuple]:
        """`[(ve_kho_luc, km_ve_kho)]` các chặng về kho mà điểm cuối do người này LÁI — tab Nhân
        viên giao hàng cộng vào "tổng km" (chặng về kho không nằm trong km của chuyến nào)."""
        from ..models.delivery import LuotXe

        return [(r[0], int(r[1] or 0)) for r in self.db.execute(
            select(LuotXe.ve_kho_luc, LuotXe.km_ve_kho)
            .join(DeliveryTrip, DeliveryTrip.id == LuotXe.ve_kho_trip_id)
            .where(DeliveryTrip.employee_id == employee_id, LuotXe.ve_kho_luc.is_not(None))
        ).all()]

    def ve_kho_cua_nhieu_tai_xe(self, employee_ids, *, tu=None, den=None) -> dict[int, list[tuple]]:
        """Bản lô của `ve_kho_cua_tai_xe` — `{employee_id: [(ve_kho_luc, km_ve_kho)]}` một câu.
        `tu`/`den`: chỉ lượt về kho trong `[tu, den)` (xem `chuyen_cua_nhieu_kip`)."""
        from ..models.delivery import LuotXe

        ids = {int(i) for i in employee_ids if i is not None}
        ra: dict[int, list[tuple]] = {i: [] for i in ids}
        if not ids:
            return ra
        stmt = (
            select(DeliveryTrip.employee_id, LuotXe.ve_kho_luc, LuotXe.km_ve_kho)
            .join(DeliveryTrip, DeliveryTrip.id == LuotXe.ve_kho_trip_id)
            .where(DeliveryTrip.employee_id.in_(ids), LuotXe.ve_kho_luc.is_not(None))
        )
        if tu is not None:
            stmt = stmt.where(LuotXe.ve_kho_luc >= tu, LuotXe.ve_kho_luc < den)
        for eid, luc, km in self.db.execute(stmt).all():
            ra[int(eid)].append((luc, int(km or 0)))
        return ra
