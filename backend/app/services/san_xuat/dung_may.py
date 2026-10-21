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

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...models.payroll import LY_DO_DUNG_MAY, PERIOD_LOCKED, PERIOD_PAID, KhoanDungMay
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.dung_may_repo import DungMayRepository
from ..quyen_to import VIEC_XAC_NHAN, gate_to_tron
from .tinh_trang_nguoi import hom_nay


class KhongThayDungMay(LookupError):
    """Dòng dừng máy không còn (đã xoá ở máy khác) — route trả 404."""


def _dong(r: KhoanDungMay, ten_nv: dict[int, str], ma_sc: dict[int, str]) -> dict:
    return {
        "id": r.id, "department_id": r.department_id, "ngay": r.ngay, "ly_do": r.ly_do,
        "ly_do_ten": LY_DO_DUNG_MAY.get(r.ly_do, r.ly_do), "sua_chua_id": r.sua_chua_id,
        "sua_chua_ma": ma_sc.get(int(r.sua_chua_id)) if r.sua_chua_id else None,
        "ghi_chu": r.ghi_chu,
        "nguoi": [{"employee_id": int(e), "ho_ten": ten_nv.get(int(e), "")} for e in (r.nguoi_ids or [])],
    }


def _chan_ky(repo: DungMayRepository, ngay: date) -> None:
    """Kỳ lương của tháng đã chốt / đã chi ⇒ số khoán đã khoá, báo / sửa / xoá ngày dừng máy tháng đó
    là đổi tiền dưới chân bảng lương đã chốt."""
    tt = repo.trang_thai_ky(ngay.year, ngay.month)
    if tt in (PERIOD_LOCKED, PERIOD_PAID):
        chu = "đã chốt" if tt == PERIOD_LOCKED else "đã chi"
        raise ValueError(f"Kỳ lương tháng {ngay.month:02d}/{ngay.year} {chu} — không báo, sửa hay xoá ngày "
                         f"dừng máy của tháng đó được nữa.")


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
        "ky_da_chot": [f"{y}-{m:02d}" for y, m in repo.ky_da_chot()],
        "ds": [_dong(r, ten, ma_sc) for r in ds],
        "nguoi": [{"employee_id": int(e.id), "ho_ten": e.full_name} for e in nguoi],
        "phieu_sua": [{"id": sc.id, "ma": sc.ma, "may_ten": may_ten, "bo_phan_hong": sc.bo_phan_hong}
                      for sc, may_ten in repo.phieu_sua_trong_khoang(tu, den)],
    }


def _kiem(repo: DungMayRepository, department_id: int, *, ly_do: str, sua_chua_id: int | None,
          nguoi_ids: list[int]) -> tuple[list[int], dict[int, str]]:
    """Luật chung của báo và sửa: lý do, người hưởng thuộc tổ, phiếu sửa tồn tại ⇒ (ids, tên)."""
    if ly_do not in LY_DO_DUNG_MAY:
        raise ValueError("Lý do dừng máy chỉ là Máy hư hoặc Hết hàng.")
    ids = list(dict.fromkeys(int(i) for i in (nguoi_ids or [])))
    if not ids:
        raise ValueError("Chọn người hưởng ngày dừng máy.")
    # Người hưởng = người đang thuộc tổ — đúng bộ hộp tick sẵn, không nhận người tổ khác qua API.
    ten = {int(e.id): e.full_name for e in repo.nhan_vien_to(department_id)}
    ngoai = [i for i in ids if i not in ten]
    if ngoai:
        ten_ngoai = repo.ten_nhan_vien(ngoai)
        raise ValueError("Người hưởng không thuộc tổ: "
                         + ", ".join(ten_ngoai.get(i, f"#{i}") for i in ngoai) + ".")
    ten = {i: ten[i] for i in ids}
    if sua_chua_id is not None and repo.sua_chua(int(sua_chua_id)) is None:
        raise ValueError("Không tìm thấy phiếu sửa máy đã chọn.")
    return ids, ten


def bao(db: Session, *, user, department_id: int, ngay: date, ly_do: str, sua_chua_id: int | None,
        ghi_chu: str | None, nguoi_ids: list[int]) -> dict:
    repo = _gate(db, user, department_id)
    if repo.co_to_con(department_id):
        raise ValueError("Đây là tổ cha (chỉ là nhóm) — báo dừng máy ở từng tổ con.")
    if ngay > hom_nay():
        raise ValueError(f"Ngày {ngay.strftime('%d/%m')} chưa tới — chỉ báo dừng máy hôm nay hoặc ngày đã qua.")
    _chan_ky(repo, ngay)
    ids, ten = _kiem(repo, department_id, ly_do=ly_do, sua_chua_id=sua_chua_id, nguoi_ids=nguoi_ids)
    trung = f"Tổ đã báo dừng máy ngày {ngay.strftime('%d/%m')}."
    if repo.cua_to_ngay(department_id, ngay) is not None:
        raise ValueError(trung)
    r = KhoanDungMay(department_id=department_id, ngay=ngay, ly_do=ly_do,
                     sua_chua_id=int(sua_chua_id) if sua_chua_id is not None else None,
                     ghi_chu=(ghi_chu or "").strip() or None, nguoi_ids=ids,
                     created_by=getattr(user, "id", None))
    try:
        repo.add(r)
    except IntegrityError:
        # Hai lần Lưu đua nhau cùng qua bước kiểm trên — UNIQUE (tổ, ngày) ở DB chặn lần sau.
        db.rollback()
        raise ValueError(trung) from None
    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None), action="san_xuat_bao_dung_may",
        target=f"khoan_dung_may:{r.id}",
        detail=f"to={department_id} ngay={ngay.isoformat()} ly_do={ly_do} nguoi={len(ids)}",
        commit=False,
    )
    db.commit()
    return _dong(r, ten, repo.ma_sua_chua({r.sua_chua_id}))


def sua(db: Session, *, user, dung_may_id: int, ly_do: str, sua_chua_id: int | None,
        ghi_chu: str | None, nguoi_ids: list[int]) -> dict:
    """Tổ trưởng tick nhầm thì sửa tại chỗ — người hưởng, lý do, phiếu sửa, ghi chú. Ngày GIỮ: đổi
    ngày là báo một ngày khác (xoá rồi báo lại)."""
    repo = DungMayRepository(db)
    r = repo.get(dung_may_id)
    if r is None:
        raise KhongThayDungMay("Không tìm thấy ngày dừng máy — có thể đã xoá ở máy khác.")
    _gate(db, user, int(r.department_id))
    _chan_ky(repo, r.ngay)
    ids, ten = _kiem(repo, int(r.department_id), ly_do=ly_do, sua_chua_id=sua_chua_id, nguoi_ids=nguoi_ids)
    cu = f"ly_do={r.ly_do} nguoi={len(r.nguoi_ids or [])}"
    r.ly_do = ly_do
    r.sua_chua_id = int(sua_chua_id) if sua_chua_id is not None else None
    r.ghi_chu = (ghi_chu or "").strip() or None
    r.nguoi_ids = ids
    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None), action="san_xuat_sua_dung_may",
        target=f"khoan_dung_may:{r.id}",
        detail=f"to={r.department_id} ngay={r.ngay.isoformat()} {cu} -> ly_do={ly_do} nguoi={len(ids)}",
        commit=False,
    )
    db.commit()
    return _dong(r, ten, repo.ma_sua_chua({r.sua_chua_id}))


def xoa(db: Session, *, user, dung_may_id: int) -> None:
    repo = DungMayRepository(db)
    r = repo.get(dung_may_id)
    if r is None:
        raise KhongThayDungMay("Không tìm thấy ngày dừng máy — có thể đã xoá ở máy khác.")
    _gate(db, user, int(r.department_id))
    _chan_ky(repo, r.ngay)
    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None), action="san_xuat_xoa_dung_may",
        target=f"khoan_dung_may:{r.id}",
        detail=f"to={r.department_id} ngay={r.ngay.isoformat()} ly_do={r.ly_do}",
        commit=False,
    )
    repo.delete(r)
    db.commit()
