"""Danh mục Xe giao hàng kiểu Hà Phương — CRUD (thân sinh từ `routers/catalog_base.make_catalog_router`).

CHỈ bản cài bật `giao_hang_hp` (docs/design-giao-hang-ha-phuong.md §6); tắt thì mọi đường trả 404.
MODULE quyền = "xe_giao_hang". ĐỌC mở thêm cho người xuất hàng ở đơn bán (ô Xe của hộp chọn cách giao).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_any_permission
from ..phan_he import GIAO_HANG_HP, chan_khi_tat
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.giao_hang_hp_repo import GiaoHangHpRepository, XeGiaoHangRepository
from ..schemas.giao_hang_hp import XeGiaoHangIn, XeGiaoHangListOut, XeGiaoHangRow
from ..services.giao_hang_hp.xe import XeGiaoHangService
from .catalog_base import make_catalog_router

router = APIRouter(prefix="/api/xe-giao-hang", tags=["xe-giao-hang"],
                   dependencies=[Depends(chan_khi_tat(GIAO_HANG_HP))])
MODULE = "xe_giao_hang"
_DOC = require_any_permission((MODULE, "read"), ("don_hang_ban", "read"))


def get_service(db: Annotated[Session, Depends(get_db)]) -> XeGiaoHangService:
    return XeGiaoHangService(XeGiaoHangRepository(db), AuditLogRepository(db))


Service = Annotated[XeGiaoHangService, Depends(get_service)]


def _dung_rows(svc: XeGiaoHangService, objs: list) -> list[XeGiaoHangRow]:
    """Kèm tên người phụ trách — một câu tra cho cả trang."""
    rows = [XeGiaoHangRow.model_validate(o) for o in objs]
    ten = GiaoHangHpRepository(svc.repo.db).ten_nguoi(r.nguoi_phu_trach_id for r in rows)
    return [r.model_copy(update={"nguoi_phu_trach_ten": ten.get(r.nguoi_phu_trach_id)}) for r in rows]


make_catalog_router(
    router, ten="xe_giao_hang", ServiceDep=Service, module=MODULE, doc=_DOC,
    InModel=XeGiaoHangIn, RowModel=XeGiaoHangRow, ListModel=XeGiaoHangListOut,
    co_ky=True,
    dung_rows=_dung_rows,
    # Không `/ma-goi-y`: mã xe LÀ BIỂN SỐ.
)
