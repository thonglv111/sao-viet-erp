"""Danh mục Kho hàng — service CRUD (chỉ khai báo, validate nhẹ).

Thân CRUD dùng chung ở `services/catalog_base.CatalogService`; ở đây chỉ còn luật riêng.
"""
from __future__ import annotations

from ..models.kho_hang import MA_KHO_THANH_PHAM
from ..repositories.kho_hang_repo import KhoHangRepository
from .catalog_base import (
    CatalogDuplicate, CatalogError, CatalogInUse, CatalogNotFound, CatalogService,
    CatalogValidationError,
)


class KhoHangError(CatalogError):
    pass


class KhoHangValidationError(KhoHangError, CatalogValidationError):
    pass


class KhoHangDuplicate(KhoHangError, CatalogDuplicate):
    pass


class KhoHangNotFound(KhoHangError, CatalogNotFound):
    pass


class KhoHangInUse(KhoHangError, CatalogInUse):
    """Kho còn tồn / phiếu chờ ghi sổ / đề nghị đang xử lý → chặn xóa."""
    pass


# Khoá đếm của `repo.dem_rang_buoc()` → câu tiếng Việt hiện trong hộp thoại xoá.
_LY_DO = (
    ("lo_con_ton", "lô còn tồn"),
    ("phieu_cho_ghi_so", "phiếu chờ ghi sổ"),
    ("de_nghi_dang_xu_ly", "đề nghị đang xử lý"),
)


_KHOA_TP = "Kho thành phẩm là kho cố định của hệ thống."


def la_kho_co_dinh(obj) -> bool:
    """Kho thành phẩm của hệ thống (`MA_KHO_THANH_PHAM`) — xem `models/kho_hang.py`."""
    return obj is not None and (getattr(obj, "ma", "") or "").upper() == MA_KHO_THANH_PHAM


class KhoHangService(CatalogService):
    LOAI = "kho_hang"
    E_NOT_FOUND = KhoHangNotFound
    E_DUPLICATE = KhoHangDuplicate
    E_VALIDATION = KhoHangValidationError
    E_IN_USE = KhoHangInUse
    MSG_NOT_FOUND = "Không tìm thấy kho."
    MSG_DUPLICATE = "Mã kho đã tồn tại."
    MSG_IN_USE = "Không xóa được — kho đang dùng: {ly_do}."
    MA_TU_SINH = True      # UI không cho gõ mã tay → server cấp KHO-####
    XOA_MEM = True         # giữ FK cho lịch sử phiếu đã ghi sổ

    def __init__(self, repo: KhoHangRepository, audit=None) -> None:
        super().__init__(repo, audit)

    def _sau_ghi(self) -> None:
        """Mỗi kho một dòng quyền `ton_kho_<id>` (05/10/2026): khai kho mới / đổi tên / nhập Excel
        xong là ma trận có ngay dòng mang tên kho đó — cùng khuôn phòng ban ↔ dòng quyền theo tổ."""
        from .quyen_kho import dong_bo_dong_quyen_kho

        dong_bo_dong_quyen_kho(self.repo.db)

    def _chuan_hoa(self, data: dict) -> dict:
        """Cờ kho hàng thương mại (chỉ In Hà Phương): không gửi thì giữ giá trị cũ (nhập Excel, form bản
        cài tắt `thuong_mai`); phân hệ tắt thì bỏ qua cả khi có gửi."""
        from ..phan_he import THUONG_MAI, tat

        if data.get("la_kho_thuong_mai") is None or tat(THUONG_MAI):
            data = {k: v for k, v in data.items() if k != "la_kho_thuong_mai"}
        return data

    def _validate(self, data: dict, obj=None) -> None:
        if not (data.get("ten") or "").strip():
            raise KhoHangValidationError("Tên kho không được trống.")
        # Kho thành phẩm của hệ thống (12/10/2026): sửa vị trí / ghi chú được, đổi tên hay ngừng dùng
        # thì không — kể cả qua Excel (nhập Excel cũng đi `update`).
        if la_kho_co_dinh(obj):
            if (data.get("ten") or "").strip() != obj.ten:
                raise KhoHangValidationError(f"{_KHOA_TP} Không đổi tên được.")
            if data.get("active") is False:
                raise KhoHangValidationError(f"{_KHOA_TP} Không ngừng dùng được.")

    def dat_active(self, item_id: int, active: bool, actor_id: int | None = None):
        if not active and la_kho_co_dinh(self.get(item_id)):
            raise KhoHangValidationError(f"{_KHOA_TP} Không ngừng dùng được.")
        return super().dat_active(item_id, active, actor_id)

    def so_vi_tri(self, kho_ids) -> dict[int, int]:
        """Số vị trí cất đang dùng của từng kho — cột "Vị trí cất" ở màn Khai báo kho."""
        return self.repo.dem_vi_tri(kho_ids)

    def _blockers(self, obj) -> list[str]:
        dem = self.repo.dem_rang_buoc(obj.id)
        ly_do = [f"{dem[k]} {nhan}" for k, nhan in _LY_DO if dem[k]]
        if la_kho_co_dinh(obj):
            # Kho cố định không có đường xoá nào — lý do này đứng một mình, khỏi kể tồn / phiếu.
            return ["kho thành phẩm của hệ thống"]
        return ly_do
