"""Kế hoạch bộ phận — prefix `/api/ke-hoach-bo-phan`, RBAC module `ke_hoach_bo_phan` (07/11/2026).

Router chỉ điều phối: nghiệp vụ ở `services/ke_hoach_bo_phan.py`. Phạm vi bộ phận đọc từ scope của
ô quyền (Tất cả = mọi bộ phận; còn lại = bộ phận chứa phòng của người xem).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_authorization_service, require_permission
from ..doi_tuong_nhan import NGHE_LENH, kem_ban_to
from ..models.user import User
from ..realtime import hub
from ..services.rbac_service import AuthorizationService
from ..services.ke_hoach_bo_phan import (
    MODULE,
    KeHoachBoPhanService,
    KhbpKhongThay,
    KhbpLoi,
    KhbpXungDot,
)
from ..services.thong_bao_man import bao, kenh_to

router = APIRouter(prefix="/api/ke-hoach-bo-phan", tags=["ke-hoach-bo-phan"])


def _svc(db: Session, user: User, authz: AuthorizationService) -> KeHoachBoPhanService:
    return KeHoachBoPhanService(db, user=user, scope=authz.scope_for(user, MODULE))


def _loi(e: Exception) -> HTTPException:
    if isinstance(e, KhbpKhongThay):
        return HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    if isinstance(e, KhbpXungDot):
        return HTTPException(status.HTTP_409_CONFLICT, str(e))
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


def _bao_doi(bo_phan_id: int, nhom_ids: list[int] | None = None) -> None:
    """Bảng bộ phận đổi ⇒ mọi người đang mở màn này nạp lại; giao/rút ⇒ bàn của nhóm nạp lại."""
    hub.gui({"type": "ke_hoach_bo_phan_changed", "bo_phan_id": bo_phan_id}, quyen=[MODULE])
    if nhom_ids is not None:
        hub.gui({"type": "lsx_changed"}, **kem_ban_to(NGHE_LENH, nhom_ids))


class XepIn(BaseModel):
    may_id: int | None = None
    department_id: int | None = None
    ly_do: str | None = Field(None, max_length=500)
    version: int | None = None


class ThuTuIn(BaseModel):
    may_id: int | None = None
    ids: list[int]


class GiaoIn(BaseModel):
    ids: list[int] | None = None


class RutIn(BaseModel):
    version: int | None = None


Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]


@router.get("/bo-phan", response_model=None)
def danh_sach(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    authz: Authz,
) -> list[dict]:
    return _svc(db, user, authz).danh_sach()


@router.get("/bo-phan/{bo_phan_id}", response_model=None)
def bang(
    bo_phan_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    authz: Authz,
) -> dict:
    try:
        return _svc(db, user, authz).bang(bo_phan_id)
    except (KhbpKhongThay, KhbpLoi, KhbpXungDot) as e:
        raise _loi(e) from None


@router.get("/viec/{cv_id}/tep", response_model=None)
def tep(
    cv_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    authz: Authz,
) -> list[dict]:
    """Tệp của lệnh (maket, bản vẽ) — cùng dạng `GET /api/san-xuat/work-items/{id}/tep-lenh`."""
    try:
        return _svc(db, user, authz).tep(cv_id)
    except (KhbpKhongThay, KhbpLoi, KhbpXungDot) as e:
        raise _loi(e) from None


@router.put("/viec/{cv_id}", response_model=None)
def xep(
    cv_id: int, body: XepIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    authz: Authz,
) -> dict:
    svc = _svc(db, user, authz)
    try:
        kq = svc.xep(cv_id, may_id=body.may_id, department_id=body.department_id,
                     ly_do=body.ly_do, version=body.version)
    except (KhbpKhongThay, KhbpLoi, KhbpXungDot) as e:
        raise _loi(e) from None
    _bao_doi(kq["bo_phan_id"])
    return kq


@router.put("/bo-phan/{bo_phan_id}/thu-tu", response_model=None)
def thu_tu(
    bo_phan_id: int, body: ThuTuIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    authz: Authz,
) -> dict:
    try:
        _svc(db, user, authz).sap_xep(bo_phan_id, may_id=body.may_id, ids=body.ids)
    except (KhbpKhongThay, KhbpLoi, KhbpXungDot) as e:
        raise _loi(e) from None
    _bao_doi(bo_phan_id)
    return {"ok": True}


@router.post("/bo-phan/{bo_phan_id}/giao", response_model=None)
def giao(
    bo_phan_id: int, body: GiaoIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    authz: Authz,
) -> dict:
    try:
        da = _svc(db, user, authz).giao(bo_phan_id, body.ids)
    except (KhbpKhongThay, KhbpLoi, KhbpXungDot) as e:
        raise _loi(e) from None
    nhom = sorted({int(v.department_id) for v in da if v.department_id})
    for n in nhom:
        bao(db, kenh=kenh_to(n), loai="viec_moi", actor_id=user.id)
    _bao_doi(bo_phan_id, nhom)
    return {"so_viec": len(da), "nhom_ids": nhom}


@router.post("/viec/{cv_id}/rut", response_model=None)
def rut(
    cv_id: int, body: RutIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    authz: Authz,
) -> dict:
    try:
        kq = _svc(db, user, authz).rut(cv_id, body.version)
    except (KhbpKhongThay, KhbpLoi, KhbpXungDot) as e:
        raise _loi(e) from None
    _bao_doi(kq["bo_phan_id"], [kq["nhom_cu"]] if kq.get("nhom_cu") else [])
    return kq

