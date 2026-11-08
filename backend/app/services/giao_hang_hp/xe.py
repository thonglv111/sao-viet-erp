"""Danh mục Xe giao hàng kiểu Hà Phương — service CRUD (thân chung ở `services/catalog_base`)."""
from __future__ import annotations

from ...repositories.giao_hang_hp_repo import GiaoHangHpRepository, XeGiaoHangRepository
from ..catalog_base import (
    CatalogDuplicate, CatalogError, CatalogNotFound, CatalogService, CatalogValidationError,
)


class XeGiaoHangError(CatalogError):
    pass


class XeGiaoHangValidationError(XeGiaoHangError, CatalogValidationError):
    pass


class XeGiaoHangDuplicate(XeGiaoHangError, CatalogDuplicate):
    pass


class XeGiaoHangNotFound(XeGiaoHangError, CatalogNotFound):
    pass


class XeGiaoHangService(CatalogService):
    LOAI = "xe_giao_hang"
    E_NOT_FOUND, E_DUPLICATE, E_VALIDATION = (
        XeGiaoHangNotFound, XeGiaoHangDuplicate, XeGiaoHangValidationError)
    MSG_NOT_FOUND = "Không tìm thấy xe."
    MSG_DUPLICATE = "Biển số đã tồn tại."

    def __init__(self, repo: XeGiaoHangRepository, audit=None) -> None:
        super().__init__(repo, audit)
        self.gh = GiaoHangHpRepository(repo.db)

    def _validate(self, data: dict, obj=None) -> None:
        if not (data.get("ma") or "").strip():
            raise XeGiaoHangValidationError("Biển số không được trống.")
        if not (data.get("ten") or "").strip():
            raise XeGiaoHangValidationError("Tên xe không được trống.")
        nguoi = data.get("nguoi_phu_trach_id")
        # Sửa mà không gửi ô người phụ trách thì giữ như cũ, không kiểm lại.
        if nguoi and ("nguoi_phu_trach_id" in data) and nguoi != getattr(obj, "nguoi_phu_trach_id", None):
            if not self.gh.la_nguoi_giao(int(nguoi)):
                raise XeGiaoHangValidationError(
                    "Người phụ trách phải là nhân viên bộ phận giao hàng đang làm việc.")
