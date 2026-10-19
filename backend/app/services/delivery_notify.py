"""Móc của Giao hàng vào luồng Kho: báo tài xế khi KHO LẬP PHIẾU, đổi trạng thái chuyến khi KHO
GHI SỔ.

Vì sao phải có móc này (chủ chốt 20/08/2026): mốc thật sự làm tài xế lên đường là *"kho soạn
xong hàng"*, mà việc đó xảy ra bên màn Kho. Router phiếu kho không đẩy sự kiện nào, nên Giao hàng
không có gì để nghe ké — không móc thì tài xế phải tự F5 đoán, đoán sai thì hoặc tới sớm ngồi
chờ, hoặc tới muộn.

RANH GIỚI, cố ý giữ hẹp:

* Toàn bộ logic nằm ở ĐÂY, file của Giao hàng. Bên `routers/kho_voucher` mỗi chỗ chỉ MỘT dòng
  gọi; hàm tự nuốt lỗi — hỏng phần phụ KHÔNG được làm hỏng việc lập phiếu / ghi sổ của kho.
* Chỉ ĐỌC dữ liệu kho, không sửa gì, không đổi trạng thái gì của họ.
* Yêu cầu không phải của giao hàng (`delivery_trip_id` rỗng) thì lặng lẽ thôi — mọi phiếu vật tư
  thường đi qua đây, không được sinh tiếng động nào.
"""
from __future__ import annotations

from ..models.delivery import DeliveryTrip
from ..models.employee import Employee
from ..models.stock_request import StockRequest
from ..doi_tuong_nhan import MAN_BAN_HANG, MAN_GIAO_HANG, hop
from ..realtime import hub


def bao_tai_xe_kho_lap_phieu(db, request_id: int | None, ma_phieu: str | None = None) -> None:
    """Kho vừa lập phiếu cho `request_id` ⇒ đẩy cho tài xế của chuyến, nếu có.

    Nuốt mọi lỗi: đây là thông báo, không phải nghiệp vụ. Ném lên là kho lập phiếu xong lại thấy
    màn hình báo đỏ, trong khi phiếu đã ghi đúng.
    """
    try:
        if not request_id:
            return
        req = db.get(StockRequest, int(request_id))
        trip_id = getattr(req, "delivery_trip_id", None)
        if not trip_id:
            return
        trip = db.get(DeliveryTrip, int(trip_id))
        if trip is None:
            return
        emp = db.get(Employee, int(trip.employee_id)) if trip.employee_id else None
        uid = getattr(emp, "user_id", None)
        if not uid:
            return
        hub.publish(int(uid), {
            "type": "giao_hang_chuyen",
            "viec": "kho_xong",
            "trip_id": trip.id,
            "ma_phieu": ma_phieu,
            "message": "Kho đã chuẩn bị xong hàng — bạn tới lấy được rồi.",
        })
    except Exception:
        return


def kho_huy_hang_giao(db, request_id: int | None, *, actor) -> None:
    """Kho vừa huỷ đề nghị xuất của chuyến giao (huỷ yêu cầu, hoặc huỷ phiếu nháp cuối) ⇒ chuyến về
    "Đã lên kế hoạch" kèm lý do của kho, màn Giao hàng + tài xế được đẩy ngay (#32, 18/10/2026).
    Nuốt lỗi như các móc khác: lời huỷ của kho đã ghi đúng."""
    try:
        if not request_id:
            return
        req = db.get(StockRequest, int(request_id))
        if req is None or not getattr(req, "delivery_trip_id", None):
            return
        from ..repositories.delivery_repo import DeliveryRepository
        from ..repositories.employee_repo import EmployeeRepository
        from ..repositories.order_repo import OrderRepository
        from .delivery_service import DeliveryService

        svc = DeliveryService(DeliveryRepository(db), OrderRepository(db), EmployeeRepository(db),
                              None, None)
        trip = svc.sau_kho_huy_xuat(req, actor=actor)
        if trip is None:
            return
        db.commit()
        svc.bao_tai_xe(trip, f"Kho đã huỷ yêu cầu xuất {req.ma} của chuyến bạn — chờ điều phối báo lại.",
                       viec="kho_huy")
        hub.gui({"type": "giao_hang_changed", "trip_id": trip.id,
                 "message": f"Kho đã huỷ yêu cầu xuất {req.ma}, chuyến về Đã lên kế hoạch."},
                quyen=hop(MAN_GIAO_HANG, MAN_BAN_HANG))
    except Exception:
        db.rollback()
        return


def kho_ghi_so_hang_giao(db, request_id: int | None, *, actor) -> None:
    """Kho vừa ghi sổ một phiếu của yêu cầu thuộc chuyến giao:

    * phiếu XUẤT (12/10/2026) — yêu cầu đã xuất đủ ⇒ chuyến "Đã lấy hàng" + báo tài xế bắt đầu
      giao được. Mốc này thay nút "Đã lấy hàng" tài xế tự bấm (bấm được cả khi kho chưa lập phiếu).
    * phiếu NHẬP trả hàng về (19/09/2026) — chuyến thất bại sang "đã trả hàng" và đơn tự làm mới
      tiến độ (phần hàng đó quay lại "giao được"). Thủ kho xác nhận hàng về bằng chính phiếu nhập.

    Nuốt lỗi như móc trên: phiếu kho đã ghi sổ đúng, không được báo đỏ vì phần phụ này.
    """
    try:
        if not request_id:
            return
        req = db.get(StockRequest, int(request_id))
        if req is None or not getattr(req, "delivery_trip_id", None):
            return
        from ..repositories.delivery_repo import DeliveryRepository
        from ..repositories.employee_repo import EmployeeRepository
        from ..repositories.order_repo import OrderRepository
        from .delivery_service import DeliveryService

        svc = DeliveryService(DeliveryRepository(db), OrderRepository(db), EmployeeRepository(db),
                              None, None)
        xuat = svc.sau_ghi_so_xuat(req, actor=actor)
        if xuat is not None or svc.sau_ghi_so_tra_hang(req, actor=actor):
            db.commit()
        # Báo SAU commit — tài xế / màn Giao hàng refetch trên kết nối khác.
        if xuat is not None:
            svc.bao_tai_xe(xuat, "Kho đã xuất hàng cho chuyến của bạn — bắt đầu giao được rồi.",
                           viec="da_xuat_kho")
        # Nhóm `giao_hang` + `ban_hang`: màn Giao hàng + drawer Đơn hàng bán (tiến độ giao).
        hub.gui({"type": "giao_hang_changed", "trip_id": req.delivery_trip_id},
                quyen=hop(MAN_GIAO_HANG, MAN_BAN_HANG))
    except Exception:
        db.rollback()
        return
