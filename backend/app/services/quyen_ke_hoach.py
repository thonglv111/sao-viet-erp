"""Quyền Kế hoạch THEO BỘ PHẬN — ai mở được mục "Kế hoạch" của bộ phận nào (08/11/2026).

Chủ dự án bỏ mục chung "Kế hoạch bộ phận" ở khối Sản xuất: mỗi bộ phận (Tổ in, Tổ cán màng…) có mục
"Kế hoạch" của riêng nó dưới khối Tổ sản xuất, và "mỗi module được sinh ra phải có quyền tương ứng".

MỘT DÒNG QUYỀN CHO MỖI BỘ PHẬN, khoá `ke_hoach_bp_<id bộ phận>`, nhãn "Kế hoạch <tên bộ phận>".
Dòng tự sinh / đổi tên / gỡ theo cây phòng ban (`dong_bo_dong_quyen_ke_hoach`) — cùng khuôn dòng
quyền theo tổ (`quyen_to.py`) và theo kho (`quyen_kho.py`). Dòng gắn sẵn một bộ phận nên không có
phạm vi theo người (máy chủ ép `all`). Xem (`can_read`) = mục Kế hoạch của bộ phận hiện trên thanh
bên và đọc được bảng việc; Giao việc (`can_update`) = Giao, Rút lại.
"""
from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models.module import Module
from ..models.role import RolePermission
from ..models.user import User

KHOA_TIEN_TO_KE_HOACH = "ke_hoach_bp_"
# `_` trong LIKE là ký tự đại diện — thoát để không vơ nhầm khoá khác.
_LIKE = KHOA_TIEN_TO_KE_HOACH.replace("_", r"\_") + "%"
#: Khoá giả cho SSE: người có Xem ở ÍT NHẤT một dòng Kế hoạch (nghe lệnh phát / thu hồi).
NGHE_KE_HOACH = "ke_hoach_bp"


def khoa_ke_hoach(bo_phan_id: int) -> str:
    return f"{KHOA_TIEN_TO_KE_HOACH}{bo_phan_id}"


def bo_phan_cua_khoa(key: str) -> int | None:
    if not key.startswith(KHOA_TIEN_TO_KE_HOACH):
        return None
    duoi = key[len(KHOA_TIEN_TO_KE_HOACH):]
    return int(duoi) if duoi.isdigit() else None


def la_khoa_ke_hoach(key: str) -> bool:
    return bo_phan_cua_khoa(key) is not None


def nhan_dong(ten_bo_phan: str) -> str:
    return f"Kế hoạch {ten_bo_phan}"


def dong_bo_dong_quyen_ke_hoach(db: Session) -> None:
    """Dòng quyền Kế hoạch khớp đúng các bộ phận của cây: bộ phận mới → thêm dòng, đổi tên → đổi
    nhãn, không còn là bộ phận → gỡ dòng cùng các ô đã cấp. Idempotent."""
    from .quyen_to import doc_cay
    from .san_xuat.bo_phan import danh_sach_bo_phan

    cay = doc_cay(db)
    muon = {khoa_ke_hoach(b): nhan_dong(cay.ten.get(b, f"#{b}")) for b in danh_sach_bo_phan(cay)}
    dang_co = dict(db.execute(
        select(Module.key, Module.label).where(Module.key.like(_LIKE, escape="\\"))).all())
    doi = False
    for key, nhan in muon.items():
        if key not in dang_co:
            db.add(Module(key=key, label=nhan))
            doi = True
        elif dang_co[key] != nhan:
            m = db.execute(select(Module).where(Module.key == key)).scalar_one()
            m.label = nhan
            doi = True
    for key in dang_co.keys() - muon.keys():
        db.execute(delete(RolePermission).where(RolePermission.module_key == key))
        db.execute(delete(Module).where(Module.key == key))
        doi = True
    if doi:
        db.commit()


def bo_phan_duoc(authz, user: User, viec: str = "read") -> set[int]:
    """Id các bộ phận mà vai của `user` bật `viec` ("read" | "update") trên dòng Kế hoạch của nó."""
    ket: set[int] = set()
    for c in authz.capabilities(user):
        bp = bo_phan_cua_khoa(c["module_key"])
        if bp is not None and authz.can(user, c["module_key"], viec):
            ket.add(bp)
    return ket
