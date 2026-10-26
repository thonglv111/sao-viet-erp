"""Công đoạn router — CRUD danh mục + một cửa tham chiếu (`/phong-ban`).

Thân CRUD sinh từ `routers/catalog_base.make_catalog_router`. Dependency INLINE (không đụng
deps.py). MODULE quyền = "dm_cong_doan".

⚠️ Route TĨNH bên dưới phải khai TRƯỚC lời gọi factory ở cuối file — factory dựng
`/{item_id}`, mà FastAPI khớp route theo THỨ TỰ khai: để sau thì `"phong-ban"` rơi vào
`{item_id}` và ăn 422 vì không ép được sang int.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_any_permission
from ..models.user import User
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.cong_doan_repo import CongDoanRepository
from ..repositories.rbac_repo import RoleRepository
from ..schemas.cong_doan import CongDoanIn, CongDoanListOut, CongDoanRow, RefOption, RefOptionListOut
from ..services.cong_doan_service import CongDoanService
from ..services.rbac_service import AuthorizationService
from ..services.catalog_excel_specs import CONG_DOAN
from .catalog_base import make_catalog_router

router = APIRouter(prefix="/api/cong-doan", tags=["cong-doan"])
MODULE = "dm_cong_doan"

# Danh mục THAM CHIẾU: đọc được nếu có quyền cấu hình Công đoạn HOẶC quyền Tính giá (màn Tính giá
# cần đổ dropdown Công đoạn mà không phải mở màn cấu hình).
#
# MỘT dependency đọc dùng cho CẢ list LẪN detail. Trước 15/08/2026 list mở bằng OR-gate còn detail
# khoá bằng quyền chặt, nên người Tính giá liệt kê được nhưng bấm vào một dòng thì ăn 403 giữa
# luồng — lỗi câm, không ai đoán ra thiếu quyền gì.
_DOC = require_any_permission((MODULE, "read"), ("tinh_gia_thanh", "read"))


def get_service(db: Annotated[Session, Depends(get_db)]) -> CongDoanService:
    return CongDoanService(CongDoanRepository(db), AuditLogRepository(db))


Service = Annotated[CongDoanService, Depends(get_service)]


def _thay_gia(svc: CongDoanService, user: User) -> bool:
    """Tiền khoán của công đoạn (đơn giá, giá cố định, giá theo tổ, việc phát sinh) là tiền lương —
    chỉ ô "Xem giá" của danh mục Công đoạn mới thấy (L-SX-39)."""
    return AuthorizationService(RoleRepository(svc.audit.db)).can(user, MODULE, "view_cost")


def _che_tien_khoan(svc: CongDoanService, user: User, rows: list) -> None:
    if _thay_gia(svc, user):
        return
    for r in rows:
        k = r.khoan
        if k is None:
            continue
        k.unit_price = None
        k.gia_co_dinh = None
        k.gia_theo_to = None
        for v in k.viec_phat_sinh:
            v.don_gia = None
            v.gia_theo_to = None


def _giu_tien_khoan(svc: CongDoanService, user: User, item_id: int | None, data: dict) -> None:
    """Người không thấy giá vẫn sửa được công đoạn: ô tiền bị che gửi lên rỗng thì GIỮ số cũ của
    khoán (theo id việc phát sinh), không để lưu form là xoá trắng tiền lương. Tạo mới / việc phát
    sinh mới thì tiền về 0 — người có ô Xem giá điền sau."""
    k = data.get("khoan")
    if not k or _thay_gia(svc, user):
        return
    cu = svc.get(item_id).khoan if item_id is not None else None
    k["unit_price"] = float(cu.unit_price) if cu is not None else 0.0
    k["gia_co_dinh"] = float(cu.gia_co_dinh or 0) if cu is not None else 0.0
    k["gia_theo_to"] = cu.gia_theo_to if cu is not None else None
    ps_cu = {v.id: v for v in cu.viec_phat_sinh} if cu is not None else {}
    for v in k.get("viec_phat_sinh") or []:
        goc = ps_cu.get(v.get("id"))
        v["don_gia"] = float(goc.don_gia) if goc is not None else 0.0
        v["gia_theo_to"] = goc.gia_theo_to if goc is not None else None


# GỠ 08/09/2026: `_dung_rows` — nó chỉ tồn tại để gọi `gan_ten_don_vi` trước khi dựng dòng. Hàm ấy
# đã gỡ (xem `cong_doan_service`), nên factory dùng lại đường mặc định `RowModel.model_validate`.


# --- Route TĨNH: khai TRƯỚC factory (xem cảnh báo ở docstring) ---------------------------


@router.get("/phong-ban", response_model=RefOptionListOut)
def list_phong_ban_options(
    svc: Service,
    # Đọc được nếu có quyền cấu hình Công đoạn HOẶC Tính giá (đổ dropdown 'Phòng ban phụ trách').
    _: Annotated[User, Depends(_DOC)],
) -> RefOptionListOut:
    """TỔ cho dropdown 'Phòng ban / Tổ phụ trách' ở form Công đoạn — luật ở service."""
    return RefOptionListOut(items=[RefOption(**r) for r in svc.phong_ban_options()])


# ⚠️ Route `/dau-viec` GỠ 18/09/2026 (mg `0320`) cùng bảng "Đầu việc và định mức của tổ": drawer
#    Công đoạn thôi khai đầu việc nên không còn dropdown nào cần đổ.

make_catalog_router(
    router, ten="cong_doan", ServiceDep=Service, module=MODULE, doc=_DOC,
    InModel=CongDoanIn, RowModel=CongDoanRow, ListModel=CongDoanListOut,
    loc="nhom",
    facets=lambda svc, kw: svc.dem_theo_nhom(**kw),
    # Thanh lọc chung (06/10/2026): kỳ Ngày tạo + Giai đoạn · Tổ phụ trách · Cần khuôn.
    co_ky=True,
    loc_them={"to_id": int, "can_khuon": bool},
    dem_them={"to_id": lambda svc, kw: svc.dem_theo_to(**kw), "can_khuon": "requires_tooling"},
    ma_goi_y=True,      # repo khai `ma_prefix = "CD-"`
    enable_clone=True,
    # `cong_thuc_truong="cong_thuc_san_luong"` GỠ 18/09/2026 (mg `0324`) cùng cột ấy — công đoạn
    # không còn ô công thức nào có lịch sử "lần trước".
    excel_spec=CONG_DOAN,
    che_tien=_che_tien_khoan,
    giu_tien=_giu_tien_khoan,
)
