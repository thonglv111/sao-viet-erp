"""Báo dừng máy ở bàn tổ (Đợt 2 — 21/10/2026).

Spec: `docs/superpowers/specs/2026-10-20-hai-luong-khoi-san-xuat-design.md` mục "Đợt 2" ý 5. Tổ
trưởng báo một ngày máy hư / hết hàng ⇒ ngày đó tổ ăn chỉ tiêu ngày (`khoan_chi_tieu_ngay`), chia
cho người được tick theo lương ca máy — `khoan_ky` tính. Một tổ một ngày một dòng.

Giả định tự chốt (báo chủ): người hưởng do tổ trưởng tick trong hộp (tick sẵn mọi người của tổ),
không đọc chấm công. Quyền: Xác nhận sản lượng TRỌN tổ — việc cấp tổ, không gắn việc của ai.

GỘP BÁO SỰ CỐ (23/10/2026, mockup `docs/mockups/bao-dung-may-gop.html`): bàn tổ bỏ "Báo sự cố" trong
ngăn việc, chỉ còn hộp này. Máy hư HÔM NAY đi `bao_may_hu`: gửi "Báo máy hỏng" cho tổ sửa chữa, tuỳ
chọn tạm dừng việc đang chạy trên máy, tuỳ chọn ghi luôn ngày dừng cho lương — MỘT giao dịch, cùng
khuôn `su_co.bao_su_co`. Báo bù ngày cũ / Hết hàng vẫn đi `bao`. Quyền giữ nguyên (chủ: "tổ trưởng có
quyền mới bấm được cho nó đơn giản").
"""
from __future__ import annotations

import calendar as _cal
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...doi_tuong_nhan import MAN_THEO_LENH, kem_ban_to
from ...models.ky_thuat_may import MUC_DO
from ...models.payroll import LY_DO_DUNG_MAY, PERIOD_LOCKED, PERIOD_PAID, KhoanDungMay
from ...models.san_xuat import CV_DANG_CHAY
from ...realtime import hub
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.dung_may_repo import DungMayRepository
from ...repositories.ky_thuat_may_repo import KyThuatMayRepository
from ..ky_thuat_may_service import KyThuatMayError, KyThuatMayService
from ..quyen_to import VIEC_XAC_NHAN, gate_to_tron
from . import thuc_thi
from .su_co import MAX_LY_DO_PHIEN
from .tinh_trang_nguoi import hom_nay


class KhongThayDungMay(LookupError):
    """Dòng dừng máy không còn (đã xoá ở máy khác) — route trả 404."""


def _dong(r: KhoanDungMay, ten_nv: dict[int, str], ma: tuple[dict[int, str], dict]) -> dict:
    """`ma` = (mã phiếu sửa theo id, yêu cầu theo id) — `_ma` dựng. Yêu cầu đã thành phiếu thì
    "Phiếu sửa máy" đọc qua `phieu_id` của yêu cầu."""
    ma_sc, yc = ma
    y = yc.get(int(r.yeu_cau_id)) if r.yeu_cau_id else None
    sc_id = r.sua_chua_id or (y.phieu_id if y is not None else None)
    return {
        "id": r.id, "department_id": r.department_id, "ngay": r.ngay, "ly_do": r.ly_do,
        "ly_do_ten": LY_DO_DUNG_MAY.get(r.ly_do, r.ly_do), "sua_chua_id": r.sua_chua_id,
        "sua_chua_ma": ma_sc.get(int(sc_id)) if sc_id else None,
        "yeu_cau_id": r.yeu_cau_id, "yeu_cau_ma": y.ma if y is not None else None,
        "ghi_chu": r.ghi_chu,
        "nguoi": [{"employee_id": int(e), "ho_ten": ten_nv.get(int(e), "")} for e in (r.nguoi_ids or [])],
    }


def _ma(repo: DungMayRepository, ds: list[KhoanDungMay]) -> tuple[dict[int, str], dict]:
    yc = repo.yeu_cau({r.yeu_cau_id for r in ds})
    return repo.ma_sua_chua({r.sua_chua_id for r in ds} | {y.phieu_id for y in yc.values()}), yc


def _may_chon(repo: DungMayRepository, department_id: int) -> list[dict]:
    """Máy báo hư được: máy đang có việc mở của tổ (đang chạy đứng đầu) rồi máy thuộc tổ. Kèm việc
    đang trên máy và yêu cầu / phiếu sửa còn mở để hộp nói "đã báo" thay vì để người ta báo trùng."""
    viec: dict[int, tuple] = {}
    for cv, ma_lsx in repo.viec_mo_co_may(department_id):
        viec.setdefault(int(cv.may_id), (cv, ma_lsx))
    ids = list(dict.fromkeys([*viec, *repo.may_thuoc_to(department_id)]))
    may = repo.may(ids)
    yc, sc = repo.yeu_cau_mo(ids), repo.phieu_mo(ids)
    ra = []
    for i in ids:
        if i not in may:
            continue
        cv, ma_lsx = viec.get(i, (None, None))
        mo = sc.get(i) or yc.get(i)
        ra.append({
            "id": i, "ma": may[i].ma, "ten": may[i].ten,
            "viec": " ".join(x for x in (ma_lsx, cv.ten_cong_doan) if x) if cv is not None else None,
            "viec_dang_chay": cv is not None and cv.trang_thai == CV_DANG_CHAY,
            "dang_mo": mo.ma if mo is not None else None,
        })
    return ra


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
    """Ngày đã báo trong tháng + người của tổ (bộ tick sẵn) + phiếu sửa báo trong tháng của MÁY CỦA TỔ
    (`repo.may_cua_to`) + kỳ lương đã chốt."""
    repo = _gate(db, user, department_id)
    dau = date(year, month, 1)
    cuoi = date(year, month, _cal.monthrange(year, month)[1])
    ds = repo.cua_to_trong_khoang(department_id, dau, cuoi)
    nguoi = repo.nhan_vien_to(department_id)
    ten = {int(e.id): e.full_name for e in nguoi}
    ten.update(repo.ten_nhan_vien({int(i) for r in ds for i in (r.nguoi_ids or [])} - set(ten)))
    ma = _ma(repo, ds)
    # Rộng một ngày mỗi đầu: phiếu ghi UTC, ngày tháng tính theo giờ xưởng.
    tu = datetime.combine(dau - timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    den = datetime.combine(cuoi + timedelta(days=2), datetime.min.time(), tzinfo=timezone.utc)
    return {
        "ky_da_chot": [f"{y}-{m:02d}" for y, m in repo.ky_da_chot()],
        "ds": [_dong(r, ten, ma) for r in ds],
        "nguoi": [{"employee_id": int(e.id), "ho_ten": e.full_name} for e in nguoi],
        "phieu_sua": [{"id": sc.id, "ma": sc.ma, "may_ten": may_ten, "bo_phan_hong": sc.bo_phan_hong}
                      for sc, may_ten in repo.phieu_sua_trong_khoang(tu, den, repo.may_cua_to(department_id))],
        "may": _may_chon(repo, department_id),
        "hom_nay": hom_nay(),
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
    if sua_chua_id is not None:
        sc = repo.sua_chua(int(sua_chua_id))
        if sc is None:
            raise ValueError("Không tìm thấy phiếu sửa máy đã chọn.")
        if int(sc.may_id) not in repo.may_cua_to(department_id):
            raise ValueError(f"Phiếu {sc.ma} là của máy không phải máy của tổ.")
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
    return _dong(r, ten, _ma(repo, [r]))


def bao_may_hu(db: Session, *, user, department_id: int, may_id: int, muc_do: str, mo_ta: str | None,
               dung_san_xuat: bool, tinh_luong: bool, ghi_chu: str | None, nguoi_ids: list[int]) -> dict:
    """Máy hư HÔM NAY: báo tổ sửa chữa + (tuỳ chọn) tạm dừng việc đang chạy trên máy + (tuỳ chọn) ghi
    ngày dừng cho lương — MỘT giao dịch.

    Máy đang có phiếu sửa chờ sửa ⇒ không gửi yêu cầu nữa, ngày dừng gắn phiếu đó. Có yêu cầu còn chờ
    tiếp nhận ⇒ dùng lại yêu cầu đó (tick "Máy đang dừng" thì nâng cờ `may_dung` cho nó lên ưu tiên).
    Mọi luật của ngày dừng (kỳ chốt, người hưởng, trùng ngày) kiểm TRƯỚC khi ghi gì: lỗi giữa chừng
    không được để lại một yêu cầu đã gửi mà ngày dừng không ghi."""
    repo = _gate(db, user, department_id)
    if repo.co_to_con(department_id):
        raise ValueError("Đây là tổ cha (chỉ là nhóm) — báo dừng máy ở từng tổ con.")
    if muc_do not in MUC_DO:
        raise ValueError(f"Mức độ không hợp lệ: {muc_do!r} (nhận: {', '.join(MUC_DO)})")
    may_id = int(may_id)
    if may_id not in {m["id"] for m in _may_chon(repo, department_id)}:
        raise ValueError("Máy này không phải máy của tổ — chọn máy tổ đứng hoặc máy đang chạy việc của tổ.")
    ngay = hom_nay()
    trung = f"Tổ đã báo dừng máy ngày {ngay.strftime('%d/%m')}."
    ids: list[int] = []
    ten: dict[int, str] = {}
    if tinh_luong:
        _chan_ky(repo, ngay)
        ids, ten = _kiem(repo, department_id, ly_do="may_hu", sua_chua_id=None, nguoi_ids=nguoi_ids)
        if repo.cua_to_ngay(department_id, ngay) is not None:
            raise ValueError(trung)

    cvs = [cv for cv, _ in repo.viec_mo_co_may(department_id) if int(cv.may_id) == may_id]
    neo = cvs[0] if cvs else None
    phieu = repo.phieu_mo([may_id]).get(may_id)
    yc = None if phieu is not None else repo.yeu_cau_mo([may_id]).get(may_id)
    moi = False
    trieu_chung = (mo_ta or "").strip() or None
    svc = KyThuatMayService(db, KyThuatMayRepository(db), AuditLogRepository(db))
    tam_dung: list = []
    r = None
    try:
        if phieu is None and yc is None:
            # Cùng khuôn `su_co.bao_su_co`: không hỏi bộ phận hỏng, neo việc do SERVER chốt.
            yc = svc.tao_yeu_cau(
                {"may_id": may_id, "bo_phan_hong": "", "mo_ta": trieu_chung, "muc_do": muc_do,
                 "may_dung": bool(dung_san_xuat)},
                actor_id=getattr(user, "id", None),
                cong_viec_id=neo.id if neo is not None else None,
                lsx_id=neo.lsx_id if neo is not None else None,
                commit=False,
            )
            moi = True
        elif yc is not None and dung_san_xuat and not yc.may_dung:
            yc.may_dung = True
        ma = yc.ma if yc is not None else phieu.ma
        if dung_san_xuat:
            for cv in cvs:
                if cv.trang_thai == CV_DANG_CHAY:
                    thuc_thi._tam_dung_lo(
                        db, user=user, cong_viec_id=cv.id,
                        ly_do=(f"Sự cố {ma}: {trieu_chung}" if trieu_chung else f"Sự cố {ma}")[:MAX_LY_DO_PHIEN],
                    )
                    tam_dung.append(cv)
        if tinh_luong:
            r = KhoanDungMay(department_id=department_id, ngay=ngay, ly_do="may_hu",
                             sua_chua_id=phieu.id if phieu is not None else None,
                             yeu_cau_id=yc.id if yc is not None else None,
                             ghi_chu=(ghi_chu or "").strip() or None, nguoi_ids=ids,
                             created_by=getattr(user, "id", None))
            repo.add(r)
            AuditLogRepository(db).create(
                actor_user_id=getattr(user, "id", None), action="san_xuat_bao_dung_may",
                target=f"khoan_dung_may:{r.id}",
                detail=f"to={department_id} ngay={ngay.isoformat()} ly_do=may_hu may={may_id} "
                       f"bao={ma} nguoi={len(ids)}",
                commit=False,
            )
        db.commit()
    except KyThuatMayError as exc:
        db.rollback()
        raise ValueError(str(exc)) from exc
    except IntegrityError:
        # Hai lần Lưu đua nhau — UNIQUE (tổ, ngày) ở DB chặn lần sau.
        db.rollback()
        raise ValueError(trung) from None
    except Exception:
        db.rollback()
        raise

    ket = {
        "yeu_cau_ma": yc.ma if yc is not None else None,
        "phieu_ma": phieu.ma if phieu is not None else None,
        "moi": moi,
        "tam_dung": [cv.id for cv in tam_dung],
        "dung_may": _dong(r, ten, _ma(repo, [r])) if r is not None else None,
    }
    _bao_tin(db, svc, yc if moi else None, tam_dung)
    return ket


def _bao_tin(db: Session, svc: KyThuatMayService, yc, tam_dung: list) -> None:
    """Báo tin SAU commit, hỏng thì nuốt — cùng lý do `su_co._bao_tin`: thao tác chính đã chốt,
    khâu báo tin hỏng không được hoá 500 để người ta bấm lại đẻ yêu cầu thứ hai."""
    try:
        if yc is not None:
            svc.bao_to_sua_chua(yc)
        for cv in tam_dung:
            hub.gui({"type": "san_xuat_cong_viec_changed", "team_id": cv.department_id,
                     "cong_viec_id": cv.id, "trang_thai": cv.trang_thai},
                    **kem_ban_to(MAN_THEO_LENH, [cv.department_id]))
    except Exception:
        db.rollback()


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
    return _dong(r, ten, _ma(repo, [r]))


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
