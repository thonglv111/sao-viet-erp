"""Báo dừng máy ở bàn tổ (Đợt 2 — 21/10/2026).

Spec: `docs/superpowers/specs/2026-10-20-hai-luong-khoi-san-xuat-design.md` mục "Đợt 2" ý 5. Tổ
trưởng báo một ngày máy hư / hết hàng ⇒ ngày đó tổ ăn chỉ tiêu ngày (`khoan_chi_tieu_ngay`), chia
cho người được tick theo lương ca máy — `khoan_ky` tính. Một tổ một ngày một dòng.

Giả định tự chốt (báo chủ): người hưởng do tổ trưởng tick trong hộp (tick sẵn mọi người của tổ),
không đọc chấm công. Quyền: Xác nhận sản lượng TRỌN tổ — việc cấp tổ, không gắn việc của ai.
"""
from __future__ import annotations

import calendar as _cal
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ...models.payroll import LY_DO_DUNG_MAY, KhoanDungMay
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.dung_may_repo import DungMayRepository
from ..quyen_to import VIEC_XAC_NHAN, gate_to_tron


def _dong(r: KhoanDungMay, ten_nv: dict[int, str], ma_sc: dict[int, str]) -> dict:
    return {
        "id": r.id, "department_id": r.department_id, "ngay": r.ngay, "ly_do": r.ly_do,
        "ly_do_ten": LY_DO_DUNG_MAY.get(r.ly_do, r.ly_do), "sua_chua_id": r.sua_chua_id,
        "sua_chua_ma": ma_sc.get(int(r.sua_chua_id)) if r.sua_chua_id else None,
        "ghi_chu": r.ghi_chu,
        "nguoi": [{"employee_id": int(e), "ho_ten": ten_nv.get(int(e), "")} for e in (r.nguoi_ids or [])],
    }


def _gate(db: Session, user, department_id: int) -> DungMayRepository:
    repo = DungMayRepository(db)
    if repo.to(department_id) is None:
        raise ValueError("Không tìm thấy tổ.")
    gate_to_tron(db, getattr(user, "id", None), department_id, VIEC_XAC_NHAN)
    return repo


def danh_sach(db: Session, *, user, department_id: int, year: int, month: int) -> dict:
    """Ngày đã báo trong tháng + người của tổ (bộ tick sẵn) + phiếu sửa máy báo trong tháng."""
    repo = _gate(db, user, department_id)
    dau = date(year, month, 1)
    cuoi = date(year, month, _cal.monthrange(year, month)[1])
    ds = repo.cua_to_trong_khoang(department_id, dau, cuoi)
    nguoi = repo.nhan_vien_to(department_id)
    ten = {int(e.id): e.full_name for e in nguoi}
    ten.update(repo.ten_nhan_vien({int(i) for r in ds for i in (r.nguoi_ids or [])} - set(ten)))
    ma_sc = repo.ma_sua_chua({r.sua_chua_id for r in ds})
    # Rộng một ngày mỗi đầu: phiếu ghi UTC, ngày tháng tính theo giờ xưởng.
    tu = datetime.combine(dau - timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    den = datetime.combine(cuoi + timedelta(days=2), datetime.min.time(), tzinfo=timezone.utc)
    return {
        "ds": [_dong(r, ten, ma_sc) for r in ds],
        "nguoi": [{"employee_id": int(e.id), "ho_ten": e.full_name} for e in nguoi],
        "phieu_sua": [{"id": sc.id, "ma": sc.ma, "may_ten": may_ten, "bo_phan_hong": sc.bo_phan_hong}
                      for sc, may_ten in repo.phieu_sua_trong_khoang(tu, den)],
    }


def bao(db: Session, *, user, department_id: int, ngay: date, ly_do: str, sua_chua_id: int | None,
        ghi_chu: str | None, nguoi_ids: list[int]) -> dict:
    repo = _gate(db, user, department_id)
    if ly_do not in LY_DO_DUNG_MAY:
        raise ValueError("Lý do dừng máy chỉ là Máy hư hoặc Hết hàng.")
    ids = list(dict.fromkeys(int(i) for i in (nguoi_ids or [])))
    if not ids:
        raise ValueError("Chọn người hưởng ngày dừng máy.")
    ten = repo.ten_nhan_vien(ids)
    if len(ten) != len(ids):
        raise ValueError("Có người hưởng không còn trong danh sách nhân viên.")
    if sua_chua_id is not None and repo.sua_chua(int(sua_chua_id)) is None:
        raise ValueError("Không tìm thấy phiếu sửa máy đã chọn.")
    if repo.cua_to_ngay(department_id, ngay) is not None:
        raise ValueError(f"Tổ đã báo dừng máy ngày {ngay.strftime('%d/%m')}.")
    r = KhoanDungMay(department_id=department_id, ngay=ngay, ly_do=ly_do,
                     sua_chua_id=int(sua_chua_id) if sua_chua_id is not None else None,
                     ghi_chu=(ghi_chu or "").strip() or None, nguoi_ids=ids,
                     created_by=getattr(user, "id", None))
    repo.add(r)
    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None), action="san_xuat_bao_dung_may",
        target=f"khoan_dung_may:{r.id}",
        detail=f"to={department_id} ngay={ngay.isoformat()} ly_do={ly_do} nguoi={len(ids)}",
        commit=False,
    )
    db.commit()
    return _dong(r, ten, repo.ma_sua_chua({r.sua_chua_id}))


def xoa(db: Session, *, user, dung_may_id: int) -> None:
    repo = DungMayRepository(db)
    r = repo.get(dung_may_id)
    if r is None:
        raise ValueError("Không tìm thấy ngày dừng máy.")
    _gate(db, user, int(r.department_id))
    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None), action="san_xuat_xoa_dung_may",
        target=f"khoan_dung_may:{r.id}",
        detail=f"to={r.department_id} ngay={r.ngay.isoformat()} ly_do={r.ly_do}",
        commit=False,
    )
    repo.delete(r)
    db.commit()
