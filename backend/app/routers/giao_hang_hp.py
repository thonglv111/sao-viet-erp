"""Giao hàng kiểu In Hà Phương — chỉ bản cài bật `giao_hang_hp` (docs/design-giao-hang-ha-phuong.md).

* Ô chọn của hộp "Cách giao" ở Xuất hàng: người giao (bộ phận giao hàng), đơn vị vận chuyển (NCC có cờ).
* `POST /xuat-hang` — Xuất hàng ĐƠN SẢN XUẤT kèm cách giao. Bọc đường xuất cũ
  (`DeliveryService.xuat_hang`, router `delivery`) mà KHÔNG sửa file nào của module Giao hàng: đường cũ
  lập yêu cầu XUẤT kho, rồi ở đây ghi cách giao trỏ vào yêu cầu đó, cùng một giao dịch.
  Đơn thương mại ghi cách giao ở `routers/thuong_mai.py` (lượt xuất).
* Cách giao từng lần của một đơn (ngăn chi tiết) và lần gần nhất của nhiều đơn (cột danh sách).
* Cước chờ chi ở màn Phiếu chi + lập phiếu chi gom nhiều lần giao cùng đơn vị vận chuyển.

Tiền cước chỉ trả ra cho người có ô Xem của Phiếu chi — gác ở đây, giao diện chỉ ẩn cột.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import (
    get_accounting_service, get_authorization_service, get_order_service, require_any_permission,
    require_permission,
)
from ..models.order import Order
from ..models.role import SCOPE_OWN
from ..models.user import User
from ..phan_he import GIAO_HANG, GIAO_HANG_HP, chan_khi_tat, tat
from ..repositories.giao_hang_hp_repo import GiaoHangHpRepository
from ..schemas.accounting import PaymentVoucherOut
from ..schemas.giao_hang_hp import (
    CuocChoChiOut, CuocChoChiRow, DonViVcListOut, DonViVcOut, NguoiGiaoListOut, NguoiGiaoOut,
    PhieuChiCuocIn, PhuongThucGiaoListOut, PhuongThucGiaoOut, PhuongThucMoiNhatOut, XuatHangHpIn,
    XuatHangHpOut,
)
from ..services.giao_hang_hp import cuoc as cuoc_svc
from ..services.giao_hang_hp import phuong_thuc as pt_svc
from ..services.accounting_service import AccountingService
from ..services.order_service import OrderService
from ..services.rbac_service import AuthorizationService

router = APIRouter(prefix="/api/giao-hang-hp", tags=["giao-hang-hp"],
                   dependencies=[Depends(chan_khi_tat(GIAO_HANG_HP))])

Db = Annotated[Session, Depends(get_db)]
Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]
OrderSvc = Annotated[OrderService, Depends(get_order_service)]
_DOC_CHON = require_any_permission(("don_hang_ban", "read"), ("xe_giao_hang", "read"))


def _xem_tien(authz: AuthorizationService, user: User) -> bool:
    """Tiền cước là tiền công ty chi ra — người có ô Xem của Phiếu chi mới thấy."""
    return authz.can(user, "phieu_chi", "read")


def _don(svc: OrderService, authz: AuthorizationService, user: User, order_id: int) -> Order:
    order = svc.repo.db.get(Order, int(order_id))
    if order is None or not svc.repo.can_access(
            order=order, scope=authz.scope_for(user, "don_hang_ban") or SCOPE_OWN, actor=user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy đơn hàng")
    return order


# ── Ô chọn ──────────────────────────────────────────────────────────────────────
@router.get("/nguoi-giao", response_model=NguoiGiaoListOut)
def nguoi_giao(db: Db, _: Annotated[User, Depends(_DOC_CHON)], size: int = Query(200, ge=1, le=500)):
    """Nhân viên bộ phận giao hàng (phòng/tổ bật cờ giao hàng), kèm xe họ phụ trách."""
    repo = GiaoHangHpRepository(db)
    ds = repo.nguoi_giao()[:size]
    xe = repo.xe_theo_nguoi(u.id for u, _ in ds)
    return NguoiGiaoListOut(items=[
        NguoiGiaoOut(id=u.id, ma=u.username, ten=u.name or u.username, bo_phan=bp, xe_id=xe.get(u.id))
        for u, bp in ds
    ])


@router.get("/don-vi-van-chuyen", response_model=DonViVcListOut)
def don_vi_van_chuyen(db: Db, _: Annotated[User, Depends(_DOC_CHON)]):
    return DonViVcListOut(items=[
        DonViVcOut(id=s.id, ma=s.code or "", ten=s.name) for s in GiaoHangHpRepository(db).don_vi_van_chuyen()
    ])


# ── Xuất hàng đơn sản xuất kèm cách giao ────────────────────────────────────────
@router.post("/xuat-hang", response_model=XuatHangHpOut, status_code=status.HTTP_201_CREATED)
def xuat_hang(
    body: XuatHangHpIn, db: Db, authz: Authz,
    user: Annotated[User, Depends(require_permission("don_hang_ban", "update"))],
) -> XuatHangHpOut:
    # Đường cũ của bản cài tắt giao hàng — import, không sửa (docs/design-giao-hang-ha-phuong.md §9).
    from ..services.delivery_service import DeliveryError
    from ..services.stock_request_service import StockRequestError
    from .delivery import _bao_kho, _err, get_service

    if not tat(GIAO_HANG):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Bản cài này dùng màn Giao hàng — lập yêu cầu giao ở đó.")
    try:
        cot = pt_svc.kiem(db, body.phuong_thuc.model_dump() if body.phuong_thuc else None)
    except pt_svc.PhuongThucLoi as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None
    svc = get_service(db)
    try:
        kq = svc.xuat_hang(order_id=body.order_id, ngay_can_giao=body.ngay_can_giao,
                           lines=[l.model_dump() for l in body.lines], actor=user,
                           scope=authz.scope_for(user, "don_hang_ban") or SCOPE_OWN,
                           ghi_chu=body.ghi_chu, dia_chi_id=body.dia_chi_id, lien_he_id=body.lien_he_id)
        phieu = kq["phieu"]
        row = pt_svc.ghi(db, order_id=body.order_id, actor=user, cot=cot,
                         stock_request_id=getattr(phieu, "id", None),
                         ma_lan_xuat=getattr(phieu, "ma", None) or kq["request"].code)
    except DeliveryError as e:
        db.rollback()
        raise _err(e)
    except StockRequestError as e:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    db.commit()
    _bao_kho(svc, [kq["phieu"]])
    pt_svc.bao_nguoi_giao(db, row, db.get(Order, body.order_id))
    return XuatHangHpOut(request_code=kq["request"].code, phieu_kho=getattr(kq["phieu"], "ma", None),
                         phuong_thuc_id=row.id)


# ── Đọc ở Đơn hàng bán ──────────────────────────────────────────────────────────
@router.get("/don/{order_id}", response_model=PhuongThucGiaoListOut)
def cua_don(
    order_id: int, db: Db, svc: OrderSvc, authz: Authz,
    user: Annotated[User, Depends(require_permission("don_hang_ban", "read"))],
) -> PhuongThucGiaoListOut:
    _don(svc, authz, user, order_id)
    rows = GiaoHangHpRepository(db).cua_don(order_id)
    return PhuongThucGiaoListOut(items=[
        PhuongThucGiaoOut(**d) for d in pt_svc.ra_dict(db, rows, xem_tien=_xem_tien(authz, user))])


@router.get("/moi-nhat", response_model=PhuongThucMoiNhatOut)
def moi_nhat(
    db: Db, svc: OrderSvc, authz: Authz,
    user: Annotated[User, Depends(require_permission("don_hang_ban", "read"))],
    order_ids: str = Query("", max_length=4000),
) -> PhuongThucMoiNhatOut:
    """Cột "Giao hàng" của danh sách: lần xuất gần nhất của từng đơn trong trang đang xem."""
    ids = [int(x) for x in order_ids.split(",") if x.strip().isdigit()][:200]
    scope = authz.scope_for(user, "don_hang_ban") or SCOPE_OWN
    duoc = [o.id for o in (db.get(Order, i) for i in ids)
            if o is not None and svc.repo.can_access(order=o, scope=scope, actor=user)]
    theo_don = GiaoHangHpRepository(db).moi_nhat_theo_don(duoc)
    rows = list(theo_don.values())
    ds = pt_svc.ra_dict(db, rows, xem_tien=_xem_tien(authz, user))
    return PhuongThucMoiNhatOut(items={str(d["order_id"]): PhuongThucGiaoOut(**d) for d in ds})


# ── Cước chờ chi ở Phiếu chi ────────────────────────────────────────────────────
@router.get("/cuoc-cho-chi", response_model=CuocChoChiOut)
def cuoc_cho_chi(db: Db, _: Annotated[User, Depends(require_permission("phieu_chi", "read"))]):
    return CuocChoChiOut(items=[CuocChoChiRow(**r) for r in cuoc_svc.hang_cho_chi(db)])


@router.post("/cuoc-cho-chi/phieu-chi", response_model=PaymentVoucherOut,
             status_code=status.HTTP_201_CREATED)
def lap_phieu_chi_cuoc(
    body: PhieuChiCuocIn, db: Db,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission("phieu_chi", "create"))],
) -> PaymentVoucherOut:
    from ..services.accounting_service import (
        AccountingConflict, AccountingNotFound, AccountingValidationError,
    )
    from .accounting import _map_error, _notify_accounting_changed

    data = body.model_dump()
    dong = data.pop("dong")
    try:
        row = cuoc_svc.tao_phieu_chi(svc, actor=user, dong=dong, shared=data)
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        db.rollback()
        raise _map_error(exc) from None
    _notify_accounting_changed(row.get("code"), voucher_code=row.get("code"), actor_user_id=user.id)
    return PaymentVoucherOut(**row)
