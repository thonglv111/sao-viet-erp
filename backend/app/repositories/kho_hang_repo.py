"""Repository — Danh mục Kho hàng. CRUD + tìm theo mã/tên + sinh mã tự động."""
from __future__ import annotations

from sqlalchemy import func, select

from ..models.kho_hang import KhoHang, KhoViTri
from ..models.stock_lot import StockLot
from ..models.stock_request import REQUEST_FULFILLABLE, StockRequest
from ..models.stock_voucher import VOUCHER_DRAFT, StockVoucher
from .catalog_base import CatalogRepo


class KhoHangRepository(CatalogRepo):
    model = KhoHang
    fields = ("ten", "vi_tri", "ghi_chu", "active")
    ma_prefix = "KHO-"
    commit_on_write = False   # `KhoHangService` chốt sau khi đã ghi nhật ký — xem `catalog_base`

    def dang_dung(self) -> list[tuple[int, str]]:
        """[(id, tên)] các kho đang dùng, theo tên — giá trị của điều kiện lọc "Kho"."""
        return [(int(i), t) for i, t in self.db.execute(
            select(KhoHang.id, KhoHang.ten).where(KhoHang.active.is_(True)).order_by(KhoHang.ten)).all()]

    def id_theo_ma(self, ma: str) -> int | None:
        """Id kho theo mã (không phân biệt hoa thường) — dùng tra kho cố định `KHO-TP`."""
        i = self.db.execute(
            select(KhoHang.id).where(func.upper(KhoHang.ma) == (ma or "").upper())).scalar_one_or_none()
        return int(i) if i is not None else None

    def theo_ids(self, kho_ids) -> dict[int, KhoHang]:
        """`{kho_id: bản ghi}` một câu cho cả danh sách (kể cả kho đã xoá mềm, như `get`)."""
        ids = {int(i) for i in kho_ids if i is not None}
        if not ids:
            return {}
        return {k.id: k for k in self.db.execute(select(KhoHang).where(KhoHang.id.in_(ids))).scalars()}

    def ten_theo_ids(self, kho_ids) -> dict[int, str]:
        """`{kho_id: tên kho}` cho MỘT lượt đọc, một câu cho cả danh sách. Kho đã xoá mềm vẫn trả tên
        (lô cũ vẫn phải đọc được)."""
        ids = {int(i) for i in kho_ids if i is not None}
        if not ids:
            return {}
        return {int(i): t for i, t in self.db.execute(
            select(KhoHang.id, KhoHang.ten).where(KhoHang.id.in_(ids))).all()}

    def dem_vi_tri(self, kho_ids) -> dict[int, int]:
        """`{kho_id: số vị trí cất ĐANG DÙNG}` cho một trang danh sách — một câu GROUP BY. Kho chưa
        khai vị trí nào thì vắng mặt trong map (đọc ra 0)."""
        ids = {int(i) for i in kho_ids if i is not None}
        if not ids:
            return {}
        return {int(k): int(n) for k, n in self.db.execute(
            select(KhoViTri.kho_id, func.count()).where(KhoViTri.kho_id.in_(ids), KhoViTri.active.is_(True))
            .group_by(KhoViTri.kho_id)).all()}

    def dem_rang_buoc(self, kho_id: int) -> dict[str, int]:
        """Ba con số CHẶN xoá một kho: lô còn tồn · phiếu chờ ghi sổ · đề nghị đang xử lý.

        Ba câu `select()` này trước 15/08/2026 nằm trong `kho_hang_service._blockers` và chạy qua
        `self.repo.db` — service tự truy DB là đi vòng qua tầng repo, và ba model kho lọt vào
        import của service.

        Phiếu ĐÃ ghi sổ (lịch sử) KHÔNG kể — xóa mềm giữ nguyên FK để tra cứu.
        """
        def _dem(model, *conds) -> int:
            return int(self.db.execute(
                select(func.count()).select_from(model).where(*conds)
            ).scalar_one())

        return {
            "lo_con_ton": _dem(StockLot, StockLot.kho_id == kho_id, StockLot.sl_con_lai > 0),
            "phieu_cho_ghi_so": _dem(StockVoucher, StockVoucher.kho_id == kho_id,
                                     StockVoucher.trang_thai == VOUCHER_DRAFT),
            "de_nghi_dang_xu_ly": _dem(StockRequest, StockRequest.kho_id == kho_id,
                                       StockRequest.trang_thai.in_(REQUEST_FULFILLABLE)),
        }
