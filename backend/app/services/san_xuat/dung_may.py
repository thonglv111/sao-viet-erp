"""Báo dừng máy ở bàn tổ (Đợt 2 — 21/10/2026).

Spec: `docs/superpowers/specs/2026-10-20-hai-luong-khoi-san-xuat-design.md` mục "Đợt 2" ý 5. Tổ
trưởng báo một ngày máy hư / hết hàng ⇒ ngày đó tổ ăn chỉ tiêu ngày (`khoan_chi_tieu_ngay`), chia
cho người được tick theo lương ca máy — `khoan_ky` tính. Một tổ một ngày một dòng.

Giả định tự chốt (báo chủ): người hưởng do tổ trưởng tick trong hộp (tick sẵn mọi người của tổ),
không đọc chấm công. Quyền: Xác nhận sản lượng TRỌN tổ — việc cấp tổ, không gắn việc của ai.

GỘP BÁO SỰ CỐ (23/10/2026, mockup `docs/mockups/bao-dung-may-gop.html`): bàn tổ bỏ "Báo sự cố" trong
ngăn việc, chỉ còn hộp này. Máy hư HÔM NAY đi `bao_may_hu`: gửi "Báo máy hỏng" cho tổ sửa chữa, tuỳ
chọn tạm dừng việc đang chạy trên máy, tuỳ chọn ghi luôn ngày dừng cho lương — MỘT giao dịch, cùng
khuôn `su_co.bao_su_co`. Báo bù ngày cũ / Hết hàng vẫn đi `bao`.

QUYỀN (chủ chốt 23/10: "có quyền mới bấm được báo máy hư, chứ không phải hardcode tổ trưởng"): gửi
báo hỏng = ô Báo hỏng của Sửa chữa máy (`ky_thuat_may:request`) + Xem tổ; tạm dừng việc trên máy đi
cổng Thực hiện lệnh của chính việc đó (`thuc_thi._tam_dung_lo`); mọi thứ đụng lương (ngày dừng, Hết
hàng, ngày đã qua, sửa, xoá) vẫn là Xác nhận sản lượng TRỌN tổ.
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
from ...repositories.rbac_repo import RoleRepository
from ..ky_thuat_may_service import MODULE_SUA_CHUA, KyThuatMayError, KyThuatMayService
from ..quyen_to import VIEC_XAC_NHAN, VIEC_XEM, gate_to_tron, quyen_cua_uid
from ..rbac_service import AuthorizationService
from . import thuc_thi
from .su_co import MAX_LY_DO_PHIEN
from .tinh_trang_nguoi import hom_nay


class KhongThayDungMay(LookupError):
    """Dòng dừng máy không còn (đã xoá ở máy khác) — route trả 404."""


def _chu_to_ngay(repo: DungMayRepository, department_id: int, ngay: date) -> str:
    """"Bế TD - long ngày 26/10/2026" — đầu câu nhật ký dừng máy (L-SX-38: trước ghi `to=84`)."""
    to = repo.to(int(department_id))
    return f"{to.name if to is not None else f'Tổ #{department_id}'} ngày {ngay.strftime('%d/%m/%Y')}"


def _nhan_ly_do(ly_do: str | None) -> str:
    return LY_DO_DUNG_MAY.get(ly_do or "", ly_do or "")


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
    # Máy tổ đứng mà tổ chưa có việc mở: việc của tổ KHÁC đang trên máy đó (L-SX-18) — hộp nói
    # "Đang chạy LSX… của tổ X" thay vì "Rảnh". Việc của chính tổ vẫn đứng trước.
    to_khac: dict[int, tuple] = {}
    for cv, ma_lsx, ten_to in repo.viec_mo_tren_may([i for i in ids if i not in viec]):
        if cv.department_id != department_id:
            to_khac.setdefault(int(cv.may_id), (cv, ma_lsx, ten_to))
    may = repo.may(ids)
    yc, sc = repo.yeu_cau_mo(ids), repo.phieu_mo(ids)
    ra = []
    for i in ids:
        if i not in may:
            continue
        cv, ma_lsx = viec.get(i, (None, None))
        ten_to = None
        if cv is None and i in to_khac:
            cv, ma_lsx, ten_to = to_khac[i]
        mo = sc.get(i) or yc.get(i)
        ra.append({
            "id": i, "ma": may[i].ma, "ten": may[i].ten,
            "viec": " ".join(x for x in (ma_lsx, cv.ten_cong_doan) if x) if cv is not None else None,
            "viec_dang_chay": cv is not None and cv.trang_thai == CV_DANG_CHAY,
            # Việc trên máy là của tổ khác ⇒ tên tổ đó; báo hư KHÔNG tạm dừng việc tổ khác (không
            # có quyền theo tổ của việc), chỉ báo tin cho tổ đó.
            "viec_cua_to": ten_to,
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


def _repo_to(db: Session, department_id: int) -> DungMayRepository:
    repo = DungMayRepository(db)
    if repo.to(department_id) is None:
        raise ValueError("Không tìm thấy tổ.")
    return repo


def _gate(db: Session, user, department_id: int) -> DungMayRepository:
    """Phần LƯƠNG (ngày dừng, Hết hàng, ngày đã qua, sửa, xoá): Xác nhận sản lượng trọn tổ."""
    repo = _repo_to(db, department_id)
    gate_to_tron(db, getattr(user, "id", None), department_id, VIEC_XAC_NHAN)
    return repo


_THIEU_BAO_HONG = "Bạn không có quyền Báo hỏng (Sửa chữa máy) ở tổ này"


def _quyen(db: Session, user, department_id: int) -> tuple[bool, bool]:
    """(gửi báo hỏng được, đụng phần lương được) của `user` trên tổ."""
    q = quyen_cua_uid(db, getattr(user, "id", None))
    luong = q is not None and q.co_tron(VIEC_XAC_NHAN, department_id)
    bao_hong = (q is not None and q.muc(VIEC_XEM, department_id) is not None
                and AuthorizationService(RoleRepository(db)).can(user, MODULE_SUA_CHUA, "request"))
    return bao_hong, luong


def danh_sach(db: Session, *, user, department_id: int, year: int, month: int) -> dict:
    """Ngày đã báo trong tháng + người của tổ (bộ tick sẵn) + phiếu sửa báo trong tháng của MÁY CỦA TỔ
    (`repo.may_cua_to`) + kỳ lương đã chốt."""
    repo = _repo_to(db, department_id)
    bao_hong, luong = _quyen(db, user, department_id)
    if not (bao_hong or luong):
        raise PermissionError(_THIEU_BAO_HONG)
    may = _may_chon(repo, department_id)
    if not luong:
        # Chỉ được báo hỏng: hộp chỉ còn phần gửi tổ sửa chữa, không lộ ngày dừng / người hưởng.
        return {"ky_da_chot": [], "ds": [], "nguoi": [], "phieu_sua": [], "may": may,
                "hom_nay": hom_nay(), "quyen_bao_hong": True, "quyen_luong": False}
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
        "may": may,
        "hom_nay": hom_nay(),
        "quyen_bao_hong": bao_hong,
        "quyen_luong": True,
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
        detail=f"{_chu_to_ngay(repo, department_id, ngay)} dừng máy vì {_nhan_ly_do(ly_do)}, "
               f"{len(ids)} người hưởng chỉ tiêu ngày.",
        commit=False,
    )
    db.commit()
    return _dong(r, ten, _ma(repo, [r]))


def bao_may_hu(db: Session, *, user, department_id: int, may_id: int, muc_do: str, mo_ta: str | None,
               dung_san_xuat: bool, tinh_luong: bool, ghi_chu: str | None, nguoi_ids: list[int]) -> dict:
    """Máy hư HÔM NAY: báo tổ sửa chữa + (tuỳ chọn) tạm dừng việc đang chạy trên máy + (tuỳ chọn) ghi
    ngày dừng cho lương — MỘT giao dịch.

    Máy đang có phiếu sửa chờ sửa ⇒ không gửi yêu cầu nữa, ngày dừng gắn phiếu đó; máy dừng hoặc
    có triệu chứng mới thì vẫn báo tổ sửa chữa ngay (`bao_lai_phieu`). Có yêu cầu còn chờ
    tiếp nhận ⇒ dùng lại yêu cầu đó, nâng cờ máy dừng / mức độ và nối triệu chứng mới (`_nang_yeu_cau`).
    Mọi luật của ngày dừng (kỳ chốt, người hưởng, trùng ngày) kiểm TRƯỚC khi ghi gì: lỗi giữa chừng
    không được để lại một yêu cầu đã gửi mà ngày dừng không ghi."""
    repo = _repo_to(db, department_id)
    if not _quyen(db, user, department_id)[0]:
        raise PermissionError(_THIEU_BAO_HONG)
    if tinh_luong:
        gate_to_tron(db, getattr(user, "id", None), department_id, VIEC_XAC_NHAN)
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
    # Việc tổ KHÁC đang chạy trên máy này (L-SX-18, chủ chốt phương án B): không tạm dừng — chỉ báo
    # tin cho tổ đó sau commit.
    khac = [(cv, ma_lsx) for cv, ma_lsx, _t in repo.viec_mo_tren_may([may_id])
            if cv.department_id != department_id and cv.trang_thai == CV_DANG_CHAY]
    neo = cvs[0] if cvs else None
    repo.khoa_may(may_id)   # giữ khoá rồi mới hỏi "máy đã có yêu cầu / phiếu mở chưa"
    phieu = repo.phieu_mo([may_id]).get(may_id)
    yc = None if phieu is not None else repo.yeu_cau_mo([may_id]).get(may_id)
    moi = nang = bao_phieu = False
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
        elif yc is not None:
            nang = _nang_yeu_cau(yc, muc_do=muc_do, trieu_chung=trieu_chung, may_dung=dung_san_xuat)
        else:
            # Phiếu đã lập: mức độ do tổ sửa chữa đánh giá, không đè; triệu chứng mới thì nối.
            bao_phieu = _noi_trieu_chung(phieu, trieu_chung) or bool(dung_san_xuat)
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
                detail=f"{_chu_to_ngay(repo, department_id, ngay)} dừng máy vì máy "
                       f"{_ten_may(repo, may_id)} hư (phiếu {ma}), {len(ids)} người hưởng chỉ tiêu ngày.",
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
    _bao_tin(db, svc, yc if (moi or nang) else None, tam_dung,
             phieu=phieu if bao_phieu else None, user=user, may_dung=bool(dung_san_xuat))
    _bao_to_khac(repo, khac, department_id=department_id, may_id=may_id, ma=ket["yeu_cau_ma"] or ket["phieu_ma"])
    return ket


def _ten_may(repo: DungMayRepository, may_id: int) -> str:
    may = repo.may([may_id]).get(may_id)
    # Mã máy (BE-01): tên máy đã mở đầu bằng "Máy …", ghép vào câu "máy …" là lặp chữ.
    return may.ma if may is not None else f"#{may_id}"


def _bao_to_khac(repo: DungMayRepository, khac: list, *, department_id: int, may_id: int,
                 ma: str | None) -> None:
    """Toast cho tổ đang chạy việc trên máy mà tổ khác vừa báo hư (L-SX-18). Sau commit, hỏng thì
    nuốt — cùng lý do `_bao_tin`."""
    if not khac:
        return
    try:
        to = repo.to(department_id)
        ten_may = _ten_may(repo, may_id)
        for cv, ma_lsx in khac:
            viec = " ".join(x for x in (ma_lsx, cv.ten_cong_doan) if x)
            hub.gui({"type": "san_xuat_may_hu_to_khac", "team_id": cv.department_id,
                     "cong_viec_id": cv.id, "may_id": may_id,
                     "message": f"{to.name if to else 'Tổ khác'} vừa báo máy {ten_may} hư"
                                f"{f' ({ma})' if ma else ''} — việc {viec} của tổ bạn đang chạy trên máy này."},
                    to=[cv.department_id])   # chỉ người xem được bàn tổ đó — câu nói "tổ bạn"
    except Exception:
        pass


def _noi_trieu_chung(ban, trieu_chung: str | None) -> bool:
    """Nối triệu chứng mới vào `mo_ta` của yêu cầu / phiếu; đã có dòng y hệt thì thôi."""
    cu = (ban.mo_ta or "").strip()
    if not trieu_chung or trieu_chung in cu.splitlines():
        return False
    ban.mo_ta = f"{cu}\n{trieu_chung}" if cu else trieu_chung
    return True


def _nang_yeu_cau(yc, *, muc_do: str, trieu_chung: str | None, may_dung: bool) -> bool:
    """Báo lại máy đang có yêu cầu chờ tiếp nhận: chỉ NÂNG (cờ máy dừng, mức độ), triệu chứng mới thì
    nối thêm dòng. Trả True nếu có đổi — khi đó tổ sửa chữa phải được báo lại ngay."""
    doi = False
    if may_dung and not yc.may_dung:
        yc.may_dung = True
        doi = True
    if yc.muc_do not in MUC_DO or MUC_DO.index(muc_do) > MUC_DO.index(yc.muc_do):
        yc.muc_do = muc_do
        doi = True
    return _noi_trieu_chung(yc, trieu_chung) or doi


def _bao_tin(db: Session, svc: KyThuatMayService, yc, tam_dung: list, *, phieu=None, user=None,
             may_dung: bool = False) -> None:
    """Báo tin SAU commit, hỏng thì nuốt — cùng lý do `su_co._bao_tin`: thao tác chính đã chốt,
    khâu báo tin hỏng không được hoá 500 để người ta bấm lại đẻ yêu cầu thứ hai."""
    try:
        if yc is not None:
            svc.bao_to_sua_chua(yc)
        if phieu is not None:
            svc.bao_lai_phieu(phieu, nguoi_bao=svc._ten_user(getattr(user, "id", None)), may_dung=may_dung)
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
    ly_do_cu, so_cu = r.ly_do, len(r.nguoi_ids or [])
    r.ly_do = ly_do
    r.sua_chua_id = int(sua_chua_id) if sua_chua_id is not None else None
    r.ghi_chu = (ghi_chu or "").strip() or None
    r.nguoi_ids = ids
    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None), action="san_xuat_sua_dung_may",
        target=f"khoan_dung_may:{r.id}",
        detail=f"{_chu_to_ngay(repo, r.department_id, r.ngay)}: lý do {_nhan_ly_do(ly_do_cu)} → "
               f"{_nhan_ly_do(ly_do)}, người hưởng {so_cu} → {len(ids)}.",
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
        detail=f"Xoá ngày dừng máy của {_chu_to_ngay(repo, r.department_id, r.ngay)} "
               f"(lý do {_nhan_ly_do(r.ly_do)}).",
        commit=False,
    )
    repo.delete(r)
    db.commit()
