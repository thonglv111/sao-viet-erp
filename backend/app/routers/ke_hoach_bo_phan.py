"""Kế hoạch theo bộ phận — prefix `/api/ke-hoach-bo-phan` (07/11/2026, đổi quyền 08/11/2026).

Router chỉ điều phối: nghiệp vụ ở `services/ke_hoach_bo_phan.py`. Mỗi bộ phận một dòng quyền
`ke_hoach_bp_<id>`: Xem = mở mục Kế hoạch của bộ phận, Giao việc = Giao và Rút lại. Cổng ở đây chỉ
chặn người không có dòng nào; đúng bộ phận nào do service gác.
"""
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_authorization_service, require_ke_hoach
from ..doi_tuong_nhan import NGHE_LENH, kem_ban_to
from ..models.user import User
from ..realtime import hub
from ..services.rbac_service import AuthorizationService
from ..services.ke_hoach_bo_phan import (
    KeHoachBoPhanService,
    KhbpCam,
    KhbpKhongThay,
    KhbpLoi,
    KhbpXungDot,
)
from ..services.quyen_ke_hoach import bo_phan_duoc, khoa_ke_hoach
from ..services.thong_bao_man import bao, kenh_to

router = APIRouter(prefix="/api/ke-hoach-bo-phan", tags=["ke-hoach-bo-phan"])


def _svc(db: Session, user: User, authz: AuthorizationService) -> KeHoachBoPhanService:
    return KeHoachBoPhanService(db, user=user, xem=bo_phan_duoc(authz, user, "read"),
                                giao=bo_phan_duoc(authz, user, "update"))


def _loi(e: Exception) -> HTTPException:
    if isinstance(e, KhbpKhongThay):
        return HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    if isinstance(e, KhbpCam):
        return HTTPException(status.HTTP_403_FORBIDDEN, str(e))
    if isinstance(e, KhbpXungDot):
        return HTTPException(status.HTTP_409_CONFLICT, str(e))
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


def _bao_doi(bo_phan_id: int, nhom_ids: list[int] | None = None) -> None:
    """Bảng bộ phận đổi ⇒ mọi người đang mở màn này nạp lại; giao/rút ⇒ bàn của nhóm nạp lại."""
    hub.gui({"type": "ke_hoach_bo_phan_changed", "bo_phan_id": bo_phan_id}, quyen=[khoa_ke_hoach(bo_phan_id)])
    if nhom_ids is not None:
        hub.gui({"type": "lsx_changed"}, **kem_ban_to(NGHE_LENH, nhom_ids))


class GiaoIn(BaseModel):
    may_id: int | None = None
    department_id: int | None = None
    ly_do: str | None = Field(None, max_length=500)
    version: int | None = None


class RutIn(BaseModel):
    version: int | None = None


Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]


@router.get("/bo-phan", response_model=None)
def danh_sach(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_ke_hoach("read"))],
    authz: Authz,
) -> list[dict]:
    return _svc(db, user, authz).danh_sach()


@router.get("/bo-phan/{bo_phan_id}", response_model=None)
def bang(
    bo_phan_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_ke_hoach("read"))],
    authz: Authz,
) -> JSONResponse:
    try:
        # Dict thuần số/chuỗi: trả thẳng, bỏ lượt `jsonable_encoder` duyệt từng ô (0,4 s với 400 việc).
        return JSONResponse(_svc(db, user, authz).bang(bo_phan_id))
    except (KhbpKhongThay, KhbpLoi, KhbpXungDot, KhbpCam) as e:
        raise _loi(e) from None


@router.get("/bo-phan/{bo_phan_id}/viec", response_model=None)
def bang_viec(
    bo_phan_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_ke_hoach("read"))],
    authz: Authz,
    trang_thai: str = Query("chua_giao", pattern="^(tat_ca|chua_giao|da_giao|dang_chay|tam_dung|hoan_thanh)$"),
    tim: str | None = Query(None, max_length=200),
    tu_ngay: date | None = Query(None),
    den_ngay: date | None = Query(None),
    may_id: int | None = Query(None),
    nhom_id: int | None = Query(None),
    trang: int = Query(1, ge=1),
    co_trang: int = Query(25, ge=1, le=100),
) -> dict:
    """Bảng việc: tìm, kỳ (theo lúc việc tới bộ phận), lọc máy / nhóm, đếm năm chip và cắt trang
    ở máy chủ."""
    try:
        return JSONResponse(_svc(db, user, authz).trang_viec(
            bo_phan_id, trang_thai=trang_thai, tim=tim, tu_ngay=tu_ngay, den_ngay=den_ngay,
            may_id=may_id, nhom_id=nhom_id, trang=trang, co_trang=co_trang))
    except (KhbpKhongThay, KhbpLoi, KhbpXungDot, KhbpCam) as e:
        raise _loi(e) from None


@router.get("/viec/{cv_id}/tep", response_model=None)
def tep(
    cv_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_ke_hoach("read"))],
    authz: Authz,
) -> list[dict]:
    """Tệp của lệnh (maket, bản vẽ) — cùng dạng `GET /api/san-xuat/work-items/{id}/tep-lenh`."""
    try:
        return _svc(db, user, authz).tep(cv_id)
    except (KhbpKhongThay, KhbpLoi, KhbpXungDot, KhbpCam) as e:
        raise _loi(e) from None


@router.get("/viec/{cv_id}/chi-tiet", response_model=None)
def chi_tiet(
    cv_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_ke_hoach("read"))],
    authz: Authz,
) -> dict:
    """Ngăn của Việc của tổ (cùng dạng `GET /api/san-xuat/work-items/{id}`), gác theo bộ phận,
    chỉ xem."""
    from ..schemas.san_xuat import WorkItemChiTietOut

    try:
        return JSONResponse(WorkItemChiTietOut.model_validate(_svc(db, user, authz).chi_tiet(cv_id, authz)).model_dump(mode="json"))
    except (KhbpKhongThay, KhbpLoi, KhbpXungDot, KhbpCam) as e:
        raise _loi(e) from None


@router.get("/viec/{cv_id}/lich-su", response_model=None)
def lich_su(
    cv_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_ke_hoach("read"))],
    authz: Authz,
) -> dict:
    """Tab Lịch sử của ngăn — cùng dạng `GET /api/san-xuat/work-items/{id}/lich-su`."""
    try:
        return _svc(db, user, authz).lich_su(cv_id)
    except (KhbpKhongThay, KhbpLoi, KhbpXungDot, KhbpCam) as e:
        raise _loi(e) from None


@router.post("/viec/{cv_id}/giao", response_model=None)
def giao(
    cv_id: int, body: GiaoIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_ke_hoach("update"))],
    authz: Authz,
) -> dict:
    """Giao một việc: máy (trống = Làm tay) và nhóm cùng lúc. Nhóm thấy việc ngay qua SSE."""
    try:
        v = _svc(db, user, authz).giao(cv_id, may_id=body.may_id, department_id=body.department_id,
                                       ly_do=body.ly_do, version=body.version)
    except (KhbpKhongThay, KhbpLoi, KhbpXungDot, KhbpCam) as e:
        raise _loi(e) from None
    nhom = int(v.department_id)
    bao(db, kenh=kenh_to(nhom), loai="viec_moi", actor_id=user.id)
    _bao_doi(int(v.bo_phan_id), [nhom])
    return {"id": v.id, "version": v.version, "nhom_id": nhom}


@router.post("/viec/{cv_id}/rut", response_model=None)
def rut(
    cv_id: int, body: RutIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_ke_hoach("update"))],
    authz: Authz,
) -> dict:
    try:
        kq = _svc(db, user, authz).rut(cv_id, body.version)
    except (KhbpKhongThay, KhbpLoi, KhbpXungDot, KhbpCam) as e:
        raise _loi(e) from None
    _bao_doi(kq["bo_phan_id"], [kq["nhom_cu"]] if kq.get("nhom_cu") else [])
    return kq

