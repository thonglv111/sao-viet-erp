"""Đơn hàng bán (Order) routes — redesign-don-hang-ban.md (P1 khung đơn).

P1: list / get / enums / activity / create (TỪ BÁO GIÁ) / update (khi nháp).
Cọc/chốt/hủy = P2–P5.

ĐÃ GỠ: nhánh tạo đơn nhập tay + 3 route duyệt đơn đặc thù (submit-approval / approve / reject).
HỦY ĐƠN ĐÃ CHỐT: từ 24/08/2026 MẶC ĐỊNH BẬT cho vai có `update` đơn — công tắc chi tiết
`approve_exception` (từng gác riêng việc này) đã gỡ khỏi ma trận phân quyền; cột DB giữ nguyên.
"""
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from ..deps import (
    get_authorization_service,
    get_current_user,
    get_order_service,
    require_permission,
)
from ..db import get_db
from ..models.user import User
from ..services import ban_hang_cho_thu_chi
from ..services.thong_bao_man import bao
from ..schemas.customer import SaleOption
from ..schemas.loc_danh_sach import LuaChonLoc
from ..repositories.order_repo import LocDonHang
from ..services.nguoi_phu_trach_service import lua_chon_nguoi
from ..schemas.order import (
    OrderActivityOut,
    OrderCancelIn,
    OrderCreate,
    OrderDepositReceiptIn,
    OrderDetailOut,
    OrderEnumsOut,
    OrderListOut,
    OrderStatsOut,
    OrderProductionHintIn,
    OrderUpdate,
)
from ..services.order_service import (
    OrderConflict,
    OrderForbidden,
    OrderNotFound,
    OrderService,
    OrderValidationError,
    _MAX_ATTACH_BYTES,
)
from ..services.rbac_service import AuthorizationService
from ..tai_len import doc_gioi_han
from ..doi_tuong_nhan import MAN_BAN_HANG, NGHE_LENH
from ..realtime import hub

router = APIRouter(prefix="/api/orders", tags=["orders"])


def _order_changed(order_no: str | None = None) -> None:
    """Tín hiệu 'danh sách chờ (duyệt/ghi cọc/chốt) đã đổi' — mọi vai tự refetch notify-summary
    (badge nhảy + toast khi số 'chờ TÔI' tăng). Bám đúng logic SSE báo giá (kênh hub chung).

    Nhóm `ban_hang`: badge Đơn hàng bán + các màn bán hàng (gồm Phiếu thu / Công nợ phải thu — nơi kế
    toán thấy đơn chờ ghi cọc)."""
    hub.gui({"type": "order_pending_changed", "code": order_no}, quyen=MAN_BAN_HANG)

MODULE = "don_hang_ban"

Service = Annotated[OrderService, Depends(get_order_service)]
Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def _scope_for(authz: AuthorizationService, user: User) -> str:
    return authz.scope_for(user, MODULE) or "own"


_SCOPE_RANK = {"own": 0, "department": 1, "all": 2}


def _effective_scope(role_scope: str, view_scope: str | None) -> str:
    """Lọc phạm vi FE (Của tôi/Cả phòng/Tất cả) — KẸP về quyền: không cho xem rộng hơn."""
    if not view_scope or view_scope not in _SCOPE_RANK:
        return role_scope
    return view_scope if _SCOPE_RANK[view_scope] <= _SCOPE_RANK.get(role_scope, 2) else role_scope


def _map(exc: Exception) -> HTTPException:
    if isinstance(exc, OrderNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, OrderForbidden):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if isinstance(exc, OrderConflict):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, OrderValidationError):
        return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    raise exc


@router.get("/enums", response_model=OrderEnumsOut)
def get_enums(
    _user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    svc: Service,
) -> OrderEnumsOut:
    return svc.enums()


def _loc_don_hang(
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query(default="tao", pattern="^(tao|chot|giao)$"),
    khach: int | None = Query(default=None),
    gap: bool | None = Query(default=None),
    gia_tu: int | None = Query(default=None, ge=0),
    gia_den: int | None = Query(default=None, ge=0),
    hen_giao: str | None = Query(default=None, pattern="^(qua|sap)$"),
    dang_cho: str | None = Query(
        default=None, pattern="^(coc|ke_hoach|xuong|gia_cong|kho|giao|hoa_don|xong|tra_coc)$"),
    gia_cong: str | None = Query(default=None, pattern="^(co|tron_goi|mot_phan|giao_thang|khong)$"),
    nha_gia_cong: int | None = Query(default=None),
    giao: str | None = Query(default=None, pattern="^(chua|mot_phan|du)$"),
    hoa_don: str | None = Query(default=None, pattern="^(chua|mot_phan|du)$"),
) -> LocDonHang:
    """Dải kỳ + bảng "Bộ lọc nâng cao" — chung cho danh sách và thanh tab."""
    return LocDonHang(
        tu_ngay=tu_ngay, den_ngay=den_ngay, moc=moc, khach=khach, gap=gap, gia_tu=gia_tu, gia_den=gia_den,
        hen_giao=hen_giao, dang_cho=dang_cho, gia_cong=gia_cong, nha_gia_cong=nha_gia_cong,
        giao=giao, hoa_don=hoa_don,
    )


LocDH = Annotated[LocDonHang, Depends(_loc_don_hang)]


@router.get("", response_model=OrderListOut)
def list_orders(
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    svc: Service,
    authz: Authz,
    loc: LocDH,
    q: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    order_kind: str | None = Query(default=None),
    view_scope: str | None = Query(default=None),
    sort: str = Query(default="-created_at"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
    nguoi: int | None = Query(default=None),
) -> OrderListOut:
    scope = _effective_scope(_scope_for(authz, user), view_scope)
    return svc.list(
        actor=user, scope=scope, q=q, status=status_filter, order_kind=order_kind,
        sort=sort, page=page, size=size, nguoi=nguoi, loc=loc,
    )


@router.get("/stats", response_model=OrderStatsOut)
def get_stats(
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    svc: Service,
    authz: Authz,
    loc: LocDH,
    view_scope: str | None = Query(default=None),
    nguoi: int | None = Query(default=None),
    q: str | None = Query(default=None),
    order_kind: str | None = Query(default=None),
) -> OrderStatsOut:
    return svc.stats(actor=user, scope=_effective_scope(_scope_for(authz, user), view_scope),
                     nguoi=nguoi, q=q, order_kind=order_kind, loc=loc)


@router.get("/khach-loc", response_model=list[LuaChonLoc])
def list_khach_loc(
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    svc: Service,
    authz: Authz,
) -> list[LuaChonLoc]:
    """Ô "Khách hàng" của bảng lọc: khách đang có đơn trong tầm nhìn, kèm số đơn."""
    return [
        LuaChonLoc(id=i, ten=t, so=n)
        for i, t, n in svc.dem_theo_khach(actor=user, scope=_scope_for(authz, user))
    ]


@router.get("/dang-cho-dem")
def dem_dang_cho(
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    svc: Service,
    authz: Authz,
) -> dict[str, int]:
    """Số đơn theo từng giá trị ô lọc "Đang chờ", trong tầm nhìn."""
    return svc.dem_dang_cho(actor=user, scope=_scope_for(authz, user))


@router.get("/nha-gia-cong-loc", response_model=list[LuaChonLoc])
def list_nha_gia_cong_loc(
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    svc: Service,
    authz: Authz,
) -> list[LuaChonLoc]:
    """Ô "Nhà gia công" của bảng lọc: nhà gia công có lần trên đơn trong tầm nhìn, kèm số đơn."""
    return [
        LuaChonLoc(id=i, ten=t, so=n)
        for i, t, n in svc.repo.dem_theo_nha_gia_cong(scope=_scope_for(authz, user), actor=user)
    ]


@router.get("/nguoi-phu-trach", response_model=list[SaleOption])
def list_nguoi_phu_trach(
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    svc: Service,
    authz: Authz,
    db: Annotated[Session, Depends(get_db)],
    view_scope: str | None = Query(default=None),
) -> list[SaleOption]:
    """Hộp lọc NV phụ trách: người đang giữ đơn TRONG tầm nhìn (phạm vi + nhóm dùng chung)."""
    scope = _effective_scope(_scope_for(authz, user), view_scope)
    return lua_chon_nguoi(db, svc.repo.dem_theo_nguoi(scope=scope, actor=user), user)


@router.get("/notify-summary")
def notify_summary(
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    svc: Service,
    authz: Authz,
) -> dict:
    """Số nuôi badge/toast real-time Đơn hàng bán — 'việc chờ TÔI xử lý' theo vai (SSE snapshot lúc
    connect + REST fallback khi có event). Kế toán=chờ ghi cọc; Sale=sẵn sàng chốt."""
    return svc.notify_summary(
        actor=user, scope=_scope_for(authz, user),
        can_record_deposit=authz.can(user, "phieu_thu", "create"),
        can_chot=authz.can(user, MODULE, "update"),
    )


@router.get("/{order_id}", response_model=OrderDetailOut)
def get_order(
    order_id: int,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    svc: Service,
    authz: Authz,
) -> OrderDetailOut:
    try:
        return svc.get(order_id=order_id, actor=user, scope=_scope_for(authz, user))
    except Exception as exc:
        raise _map(exc)


@router.get("/{order_id}/tien-do")
def get_tien_do(
    order_id: int,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    svc: Service,
    authz: Authz,
) -> dict:
    """Thanh tiến độ của drawer đơn: Sản xuất → Nhập kho → Giao hàng theo từng sản phẩm (19/09/2026).
    Cùng cổng đọc + phạm vi với chi tiết đơn — ai xem được đơn thì xem được tiến độ của nó."""
    try:
        return svc.tien_do(order_id=order_id, actor=user, scope=_scope_for(authz, user))
    except Exception as exc:
        raise _map(exc)


@router.get("/{order_id}/yeu-cau-giao/{yeu_cau_id}/phieu-xuat")
def get_phieu_xuat_in(
    order_id: int,
    yeu_cau_id: int,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    svc: Service,
    authz: Authz,
) -> dict:
    """Dữ liệu in "Phiếu xuất kho bán hàng" (có giá) / "Phiếu xuất kho 02-VT" (không giá) của một
    yêu cầu giao. Kho chưa ghi sổ phiếu xuất ⇒ 400."""
    from ..services.phieu_xuat_ban_hang import PhieuXuatChuaCo

    try:
        return svc.phieu_xuat_in(order_id=order_id, yeu_cau_id=yeu_cau_id, actor=user,
                                 scope=_scope_for(authz, user))
    except PhieuXuatChuaCo as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise _map(exc)


@router.get("/{order_id}/activity", response_model=OrderActivityOut)
def get_activity(
    order_id: int,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    svc: Service,
    authz: Authz,
) -> OrderActivityOut:
    try:
        return svc.activity(order_id=order_id, actor=user, scope=_scope_for(authz, user))
    except Exception as exc:
        raise _map(exc)


@router.post("", response_model=OrderDetailOut, status_code=status.HTTP_201_CREATED)
def create_order(
    payload: OrderCreate,
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
    svc: Service,
    authz: Authz,
    db: Annotated[Session, Depends(get_db)],
) -> OrderDetailOut:
    try:
        d = svc.create(actor=user, scope=_scope_for(authz, user), payload=payload)
    except Exception as exc:
        raise _map(exc)
    _order_changed(d.order_no)   # đơn nháp mới → Kế toán thấy 'chờ ghi cọc'
    if (d.deposit_pct or 0) > 0:
        # Chấm đỏ Đơn hàng cho người GHI CỌC trong phạm vi phòng của Sale đứng tên đơn.
        sale = db.get(User, d.sale_user_id) if d.sale_user_id else None
        bao(db, kenh="don_hang_ban", loai="don_cho_coc", actor_id=user.id, quyen="phieu_thu:create",
            phong_id=sale.department_id if sale else None, ma=d.order_no)
    return d


@router.put("/{order_id}", response_model=OrderDetailOut)
def update_order(
    order_id: int,
    payload: OrderUpdate,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    svc: Service,
    authz: Authz,
) -> OrderDetailOut:
    try:
        return svc.update(order_id=order_id, actor=user, scope=_scope_for(authz, user), payload=payload)
    except Exception as exc:
        raise _map(exc)


# --- Sale đổi hint sản xuất (gấp / lưu ý SX) SAU khi đã chốt → realtime bàn Kế hoạch ---
@router.post("/{order_id}/production-hint", response_model=OrderDetailOut)
def update_production_hint(
    order_id: int,
    payload: OrderProductionHintIn,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    svc: Service,
    authz: Authz,
) -> OrderDetailOut:
    try:
        d = svc.update_production_hint(
            order_id=order_id, actor=user, scope=_scope_for(authz, user), payload=payload,
        )
    except Exception as exc:
        raise _map(exc)
    # Bàn Kế hoạch SX 'ting': đơn chuyển gấp / cập nhật lưu ý (badge nhảy; nội dung note FE refetch).
    # Nhóm `ban_hang` + `san_xuat`; bàn tổ không bày cờ gấp / lưu ý SX của đơn nên không nhận.
    hub.gui(
        {"type": "order_sx_hint_changed", "code": d.order_no, "order_id": order_id, "is_rush": d.is_rush},
        quyen=NGHE_LENH,
    )
    return d


# --- Chuyển đơn (đã chốt) xuống Sản xuất → vào hàng chờ Kế hoạch (handoff) -----
@router.post("/{order_id}/release-production", response_model=OrderDetailOut)
def release_production(
    order_id: int,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    svc: Service,
    authz: Authz,
    db: Annotated[Session, Depends(get_db)],
) -> OrderDetailOut:
    try:
        d = svc.release_production(order_id=order_id, actor=user, scope=_scope_for(authz, user))
    except Exception as exc:
        raise _map(exc)
    _bao_xuong_sx(db, d, user)
    return d


def _bao_xuong_sx(db: Session, d: OrderDetailOut, user: User) -> None:
    """Đơn 'bắn xuống' hàng chờ Kế hoạch (badge nhảy, không refresh) — dù Sale bấm hay TỰ chuyển
    lúc chốt / lúc đủ cọc. Hàng chờ Kế hoạch SX (badge + toast người có `san_xuat`) + nhóm
    `ban_hang`/`san_xuat`. Đơn mới vào hàng chờ, chưa có công việc nào ở bàn tổ."""
    hub.gui({"type": "order_ordered", "code": d.order_no, "order_id": d.id}, quyen=NGHE_LENH)
    # Chấm đỏ Kế hoạch SX — chuyển lại (idempotent) không đẻ thêm dòng.
    bao(db, kenh="san_xuat", loai="don_chuyen_sx", actor_id=user.id, ma=d.order_no, chi_mot_lan=True)


# --- Hủy đơn (P5) — nháp hay đã chốt đều cần `update` (hủy đã chốt mặc định bật) ----
@router.post("/{order_id}/cancel", response_model=OrderDetailOut)
def cancel_order(
    order_id: int,
    payload: OrderCancelIn,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    svc: Service,
    authz: Authz,
) -> OrderDetailOut:
    # Hủy đơn đã chốt MẶC ĐỊNH BẬT cho vai có `update` đơn (gỡ quyền `approve_exception` 24/08/2026).
    elevated = True
    try:
        d = svc.cancel(
            order_id=order_id, actor=user, scope=_scope_for(authz, user),
            reason=payload.reason, fault=payload.fault, can_cancel_ordered=elevated,
        )
    except Exception as exc:
        raise _map(exc)
    _order_changed(d.order_no)   # hủy nháp → rời tập chờ, badge 'chờ xử lý' các vai tụt
    # Đơn huỷ còn giữ tiền khách ⇒ chấm Phiếu chi "Chờ trả lại khách" (17/10/2026).
    ban_hang_cho_thu_chi.bao_hang_cho(svc.db, svc.accounting_repo, actor_id=user.id,
                                      order_id=d.id, order_code=d.order_no)
    return d


# --- Chốt đơn (P4) — đi theo quyền SỬA đơn (05/10/2026) ---------------------------
# Trước đó đòi `manage_status` — ô KHÔNG có trên ma trận phân quyền (gỡ 15/07/2026, df15765d) nên
# vai lập qua giao diện không bao giờ chốt được, chỉ Giám đốc. Chủ chốt: chốt đơn không cần quyền
# riêng — ai lập/sửa được đơn thì chốt được, cùng luật với vòng đời Báo giá.
@router.post("/{order_id}/confirm", response_model=OrderDetailOut)
def confirm_order(
    order_id: int,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    svc: Service,
    authz: Authz,
    db: Annotated[Session, Depends(get_db)],
) -> OrderDetailOut:
    try:
        d = svc.confirm(order_id=order_id, actor=user, scope=_scope_for(authz, user))
    except Exception as exc:
        raise _map(exc)
    # Chốt → rời tập nháp, badge 'sẵn sàng chốt' của Sale tụt; màn Phiếu thu / Công nợ phải thu
    # (nhóm `ban_hang`) cũng nạp lại theo tin này nên kế toán thấy đơn chờ ghi cọc.
    #
    # ĐÃ BỎ `order_deposit_needed` (28/09/2026, sức chịu tải A3): nơi duy nhất nghe nó là
    # `OrderDepositQueue.tsx` mà không màn nào mount; phần còn lại chỉ là nhích nhóm `ban_hang` —
    # đã có tin trên — và `mua_ke_toan`, nơi không màn nào bày đơn chờ cọc. Gói tin còn mang SỐ TIỀN
    # cọc đi tới MỌI kết nối, kể cả người không có quyền xem tiền.
    _order_changed(d.order_no)
    # Đơn chốt còn thiếu cọc ⇒ chấm Phiếu thu "Đơn hàng chờ thu" (17/10/2026).
    ban_hang_cho_thu_chi.bao_hang_cho(db, svc.accounting_repo, actor_id=user.id, order_id=d.id,
                                      order_code=d.order_no, coc_moi=True)
    if svc.vua_chuyen_sx:   # đơn không cần cọc → xuống SX ngay lúc chốt
        _bao_xuong_sx(db, d, user)
    return d


# --- Gia hạn báo giá nguồn (Việc 4) — quyền `update` (Sale + TP/GĐ) -----------
@router.post("/{order_id}/extend-quote", response_model=OrderDetailOut)
def extend_quote(
    order_id: int,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    svc: Service,
    authz: Authz,
) -> OrderDetailOut:
    """Gỡ blocker 'báo giá hết hạn' ở cổng chốt: gia hạn báo giá nguồn +30 ngày ngay từ đơn.
    Không broadcast — badge notify-summary không phụ thuộc hạn báo giá; actor nhận detail mới
    (blocker biến mất) ngay trong response."""
    try:
        return svc.extend_source_quote(order_id=order_id, actor=user, scope=_scope_for(authz, user))
    except Exception as exc:
        raise _map(exc)


# --- Cọc (V5) — Kế toán LẬP PHIẾU THU CỌC THẬT, quyền Phiếu thu → Tạo (13/10/2026; trước đó là ô
# riêng `record_deposit` của Đơn hàng bán — ai thu cọc được mà không lập được phiếu thu là lệch).
@router.post("/{order_id}/deposit-receipts", response_model=OrderDetailOut)
def add_deposit_receipt(
    order_id: int,
    payload: OrderDepositReceiptIn,
    user: Annotated[User, Depends(require_permission("phieu_thu", "create"))],
    svc: Service,
    authz: Authz,
    db: Annotated[Session, Depends(get_db)],
) -> OrderDetailOut:
    """Kế toán bấm trên drawer đơn → tạo PaymentReceipt(nguồn đơn, received) gắn order_id. Cổng đủ
    cọc = Σ phiếu thu received ≥ deposit_required."""
    try:
        d = svc.add_deposit_receipt(order_id=order_id, actor=user, scope=_scope_for(authz, user), payload=payload)
    except Exception as exc:
        raise _map(exc)
    if d.deposit_ok and d.sale_user_id:   # Kế toán thu ĐỦ cọc → báo Sale 'chốt được rồi' (Việc 3)
        hub.publish(d.sale_user_id, {"type": "order_deposit_ok", "code": d.order_no})
        bao(db, kenh="don_hang_ban", loai="don_du_coc", actor_id=user.id,
            nguoi_nhan=d.sale_user_id, ma=d.order_no)
    _order_changed(d.order_no)
    if svc.vua_chuyen_sx:   # đủ cọc → đơn TỰ xuống hàng chờ Kế hoạch
        _bao_xuong_sx(db, d, user)
    return d


# --- Tệp đính kèm của đơn (`update`) — minh chứng đã thu cọc nằm ở màn Phiếu thu Kế toán ---
@router.post("/{order_id}/attachments", response_model=OrderDetailOut)
def upload_consent(
    order_id: int,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    svc: Service,
    authz: Authz,
    file: UploadFile = File(...),
) -> OrderDetailOut:
    # `def` (không `async`): đọc tệp + ghi kho tệp + DB đồng bộ — chạy trong threadpool. Tệp rỗng
    # để service báo bằng câu của nó.
    data = doc_gioi_han(file, _MAX_ATTACH_BYTES, cho_rong=True)
    try:
        return svc.add_consent_attachment(order_id=order_id, actor=user, scope=_scope_for(authz, user),
            file_name=file.filename, content_type=file.content_type, data=data)
    except Exception as exc:
        raise _map(exc)


@router.delete("/{order_id}/attachments/{attachment_id}", response_model=OrderDetailOut)
def delete_consent(
    order_id: int,
    attachment_id: int,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    svc: Service,
    authz: Authz,
) -> OrderDetailOut:
    try:
        return svc.delete_consent_attachment(order_id=order_id, attachment_id=attachment_id,
            actor=user, scope=_scope_for(authz, user))
    except Exception as exc:
        raise _map(exc)
