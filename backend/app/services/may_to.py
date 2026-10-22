"""Luật cặp TỔ × MÁY (spec 2026-10-22-may-thuoc-to) — một chỗ, mọi nơi gọi.

Máy thuộc tổ khai ở danh mục Máy (`may_to`). Công đoạn lấy máy qua tổ đã tick
(`CongDoan.may_lam_duoc`). Bước / công việc chạy máy hợp lệ khi máy thuộc tổ của nó và nằm trong
máy của công đoạn. Công đoạn chưa tick tổ nào ⇒ KHÔNG ràng buộc tổ (giữ hành vi cũ).
"""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.orm import Session

from ..models.cong_doan import CongDoan
from ..repositories.may_to_repo import MayToRepository


def to_cua_may(db: Session, may_ids: Iterable[int]) -> dict[int, list[int]]:
    return MayToRepository(db).to_cua_may(may_ids)


def ten_to(db: Session, department_ids: Iterable[int]) -> dict[int, str]:
    return MayToRepository(db).ten_to(department_ids)


def rang_buoc_to(cd: CongDoan | None) -> bool:
    """Công đoạn có tick tổ ⇒ máy phải thuộc tổ của bước."""
    return bool(cd is not None and cd.department_ids)


def may_chon_duoc(db: Session, cd: CongDoan | None, department_id: int | None) -> list[int]:
    """Máy CÒN DÙNG mời cho bước của tổ `department_id`, theo thứ tự bảng máy của công đoạn."""
    if cd is None:
        return []
    ids = [int(r.may_id) for r in cd.may_lam_duoc if r.may_id is not None]
    repo = MayToRepository(db)
    may = repo.may(ids)
    ids = [i for i in ids if i in may and may[i].active]
    if department_id is None or not rang_buoc_to(cd):
        return ids
    to = repo.to_cua_may(ids)
    return [i for i in ids if int(department_id) in to.get(i, [])]


def may_mac_dinh(db: Session, cd: CongDoan | None, department_id: int | None) -> int | None:
    """Máy điền sẵn cho bước của tổ: máy đầu bảng thuộc tổ đó (máy "Đặt mặc định" đứng đầu)."""
    ds = may_chon_duoc(db, cd, department_id)
    return ds[0] if ds else None


def to_cho_may(db: Session, cd: CongDoan | None, may_id: int, uu_tien: int | None) -> int | None:
    """Tổ nhận bước khi máy đã định sẵn (máy in của phiếu tính giá): `uu_tien` nếu máy thuộc nó và
    công đoạn tick nó; không thì tổ đầu (theo thứ tự tick) có máy; không có ⇒ None."""
    if cd is None:
        return None
    tos = set(to_cua_may(db, [may_id]).get(int(may_id), []))
    tick = cd.department_ids
    if uu_tien is not None and uu_tien in tos and uu_tien in tick:
        return uu_tien
    return next((d for d in tick if d in tos), None)


def cap_lech(db: Session, cd: CongDoan | None, department_id: int | None,
             may_id: int | None) -> str | None:
    """Câu NGẮN "Máy X không thuộc <tổ>" khi cặp (tổ, máy) không hợp lệ; None = hợp lệ. Tổ hoặc máy
    trống, hoặc công đoạn không ràng buộc tổ ⇒ hợp lệ. Dùng cho cảnh báo (băng danh mục đổi)."""
    if not may_id or not department_id or not rang_buoc_to(cd):
        return None
    trong_cd = {int(r.may_id) for r in cd.may_lam_duoc}
    tos = to_cua_may(db, [may_id]).get(int(may_id), [])
    if int(may_id) in trong_cd and int(department_id) in tos:
        return None
    repo = MayToRepository(db)
    may = repo.may([may_id]).get(int(may_id))
    ma = may.ma if may is not None else f"#{may_id}"
    return f"Máy {ma} không thuộc {_ten_to(repo, department_id)}"


def _ten_to(repo: MayToRepository, department_id: int) -> str:
    return repo.ten_to([department_id]).get(int(department_id), f"tổ #{department_id}")


def loi_cap(db: Session, cd: CongDoan | None, department_id: int | None,
            may_id: int | None) -> str | None:
    """Câu LỖI khi cặp (tổ, máy) không hợp lệ — `cap_lech` kèm cách sửa; None = hợp lệ."""
    lech = cap_lech(db, cd, department_id, may_id)
    if lech is None:
        return None
    ten = _ten_to(MayToRepository(db), department_id)
    return f"{lech}. Chọn máy của {ten} hoặc đổi tổ."


def dong_bo_cong_doan_may(db: Session, *, cong_doan_ids: Iterable[int] | None = None,
                          may_ids: Iterable[int] | None = None) -> int:
    """Tạo dòng `cong_doan_may` còn thiếu cho máy vừa vào phạm vi tổ của công đoạn (công thức
    trống, xếp cuối theo mã máy). KHÔNG xoá dòng nào — dòng ra khỏi phạm vi nằm im giữ số."""
    repo = MayToRepository(db)
    db.flush()
    cap = sorted(repo.cap_thieu_dong(cong_doan_ids=cong_doan_ids, may_ids=may_ids),
                 key=lambda x: (x[0], x[2]))
    if not cap:
        return 0
    cuoi = repo.thu_tu_lon_nhat({c for c, _, _ in cap})
    for cd_id, may_id, _ma in cap:
        cuoi[cd_id] = cuoi.get(cd_id, -1) + 1
        repo.them_dong(cd_id, may_id, cuoi[cd_id])
    db.flush()
    return len(cap)
