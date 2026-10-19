"""Chấm đỏ thanh bên = "có bản ghi mới kể từ lần mở màn trước" (chủ chốt 29/09/2026).

MỘT điểm ghi (`bao`) cho mọi module + MỘT lượt hỏi (`trang_thai`) cho cả thanh bên — thay ~15 lượt
đếm riêng (có lượt duyệt cả kho/lệnh bằng Python). Kênh = khoá module RBAC của màn; tổ SX dùng
`to_sx_<id>`. Bảng kênh: docs/superpowers/plans/2026-09-29-cham-do-ban-ghi-moi.md.
"""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import event
from sqlalchemy.orm import Session

from ..models.role import SCOPE_ALL, SCOPE_DEPARTMENT
from ..realtime import hub
from ..repositories.module_notification_repo import DieuKienKenh, ModuleNotificationRepository
from ..repositories.org_scope import dept_subtree_ids

# Kênh tĩnh → các ô quyền (ngoài Xem) mà một dòng phát rộng của kênh có thể đòi. Ô của MÀN KHÁC
# ghi dạng `khoá:việc` (đơn chờ cọc báo người có Phiếu thu → Tạo, 13/10/2026).
KENH: dict[str, tuple[str, ...]] = {
    "thu_mua": (),
    "ke_toan": (),
    "luong": ("approve",),
    "nghi_phep": ("approve",),
    "tang_ca": ("approve",),
    "cham_cong": ("approve_late_early",),
    "bao_gia": ("approve_exception",),
    "don_hang_ban": ("phieu_thu:create",),
    "san_xuat": (),
    "xep_lich": (),
    "kho": (),
    # Hàng việc tiền của đơn bán (17/10/2026): chấm cho người LẬP được phiếu — "Đơn hàng chờ thu"
    # ở Phiếu thu, "Chờ trả lại khách" ở Phiếu chi.
    "phieu_chi": ("create",),
    "phieu_thu": ("create",),
    "ky_thuat_may": (),
    "phieu_bao_tri": (),
    "khach_hang": (),
}
TIEN_TO_TO = "to_sx_"


def kenh_to(department_id: int) -> str:
    return f"{TIEN_TO_TO}{int(department_id)}"


def kenh_hop_le(kenh: str) -> bool:
    if kenh in KENH:
        return True
    return kenh.startswith(TIEN_TO_TO) and kenh[len(TIEN_TO_TO):].isdigit()


def bao(
    db: Session,
    *,
    kenh: str,
    loai: str,
    actor_id: int | None,
    nguoi_nhan: int | Iterable[int] | None = None,
    quyen: str | None = None,
    phong_id: int | None = None,
    ma: str | None = None,
    chi_mot_lan: bool = False,
    commit: bool = True,
) -> int:
    """Ghi thông báo + đẩy SSE `thong_bao_man`. Trả số dòng đã ghi.

    `nguoi_nhan` None = phát rộng theo quyền; một id hoặc danh sách = đích danh (danh sách rỗng ⇒
    không ai, không ghi gì). `commit=True`: gọi SAU khi nghiệp vụ đã commit. `commit=False`: dòng đi
    chung giao dịch đang mở, SSE chỉ bắn khi giao dịch đó commit (bắn trước là báo một việc còn có
    thể rollback)."""
    if not kenh_hop_le(kenh):
        raise ValueError(f"Kênh thông báo không hợp lệ: {kenh!r}")
    if quyen is not None and quyen not in KENH.get(kenh, ()):
        raise ValueError(f"Kênh {kenh!r} không khai ô quyền {quyen!r}")
    repo = ModuleNotificationRepository(db)
    if chi_mot_lan and repo.da_co(kenh=kenh, loai=loai, ma=ma):
        return 0
    if nguoi_nhan is None:
        ds: list[int | None] = [None]
    elif isinstance(nguoi_nhan, int):
        ds = [nguoi_nhan]
    else:
        ds = sorted({int(u) for u in nguoi_nhan if u is not None})
        if not ds:
            return 0
    for uid in ds:
        repo.create(
            channel=kenh, event_type=loai, actor_user_id=actor_id, recipient_user_id=uid,
            source_code=ma, required_action=quyen, department_id=phong_id, commit=False,
        )

    su_kien = {"type": "thong_bao_man", "kenh": kenh}

    def _day(*_a) -> None:
        if ds == [None]:
            if kenh.startswith(TIEN_TO_TO):
                hub.gui(su_kien, to=[int(kenh[len(TIEN_TO_TO):])])
            else:
                hub.gui(su_kien, quyen=[kenh])
        else:
            hub.gui(su_kien, nguoi=[u for u in ds if u is not None])

    if commit:
        db.commit()
        _day()
    else:
        event.listen(db, "after_commit", _day, once=True)
    return len(ds)


def trang_thai(db: Session, authz, user) -> dict[str, dict]:
    """Tóm tắt chấm đỏ của người gọi: `{kenh: {"id","loai","ma"}}` — chỉ kênh đang có bản ghi mới."""
    from .quyen_to import VIEC_XEM, quyen_to_cua

    cay: tuple[int, ...] | None = None

    def _cay() -> tuple[int, ...]:
        nonlocal cay
        if cay is None:
            cay = tuple(dept_subtree_ids(db, user.department_id)) if user.department_id else ()
        return cay

    authz.nap_ca_ma_tran(user)  # 15 kênh × can/scope_for: một câu thay vì mỗi kênh một câu
    dk: list[DieuKienKenh] = []
    for kenh, cac_quyen in KENH.items():
        if not authz.can(user, kenh, "read"):
            continue
        pv = authz.scope_for(user, kenh) or "own"
        phong = None if pv == SCOPE_ALL else (_cay() if pv == SCOPE_DEPARTMENT else ())
        for q in (None, *cac_quyen):
            if q is None or authz.can(user, *(q.split(":", 1) if ":" in q else (kenh, q))):
                dk.append(DieuKienKenh(kenh=kenh, quyen=q, phong_ids=phong))
    if user.role_id is not None:
        qt = quyen_to_cua(db, user)
        for to_id in sorted(qt.tron[VIEC_XEM] | qt.rieng[VIEC_XEM]):
            dk.append(DieuKienKenh(kenh=kenh_to(to_id), quyen=None, phong_ids=None))
    return ModuleNotificationRepository(db).moi_nhat(user.id, dk)
