"""Đóng lệnh THỦ CÔNG do KCS bấm (spec `docs/superpowers/specs/2026-09-29-dong-lenh-thu-cong-design.md`).

Thay cổng tự đóng 4 điều kiện (`dong_nhom.py`, gỡ 29/09/2026). Đơn vị đóng là NHÓM thành phẩm; một
giao dịch ghi cả `san_xuat_nhom.trang_thai` (in_production ⇄ closed) lẫn `lsx.trang_thai` của mọi
lệnh trong nhóm (da_phat_hanh ⇄ da_dong). KHÔNG có điều kiện chặn: phần còn dở chỉ là CẢNH BÁO để
hộp xác nhận bày ra — người KCS quyết. Số lúc đóng chụp vào audit để tra "đóng thiếu" về sau.

Quyền (dòng `kcs` của ma trận vai, `docs/design-kcs-quy-trach-nhiem.md` §2.4): đóng ĐỦ (không còn
cảnh báo) — ô Thao tác. Đóng khi còn cảnh báo, và MỞ LẠI — thêm ô chi tiết "Đóng lệnh thiếu"
(`can_close_short`).
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.department import Department
from ...models.lsx import TT_DA_DONG, TT_DA_PHAT_HANH
from ...models.san_xuat import CV_DANG_CHAY, CV_HOAN_THANH, NHOM_DANG_SX, NHOM_DONG, SanXuatNhom
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.san_xuat_kcs_repo import SanXuatKcsRepository
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from .kcs import _EPS, _authz, gate_kcs

CHAN_DA_DONG = "Lệnh đã đóng — KCS mở lại nếu cần ghi thêm."
THIEU_QUYEN_DONG_THIEU = "Cần quyền Đóng lệnh thiếu"


def duoc_dong_thieu(db: Session, user) -> bool:
    """Vai của `user` bật ô chi tiết "Đóng lệnh thiếu" trên dòng KCS. Người gọi còn tự `gate_kcs`."""
    if user is None:
        return False
    return _authz(db).can(user, "kcs", "close_short")


def _so(v: float) -> str:
    """Số kiểu Việt: 10000 → "10.000", 12.5 → "12,5"."""
    t = f"{v:,.3f}".rstrip("0").rstrip(".")
    return t.translate(str.maketrans(",.", ".,"))


def _nhom(repo: SanXuatRepository, nhom_id: int) -> SanXuatNhom:
    nhom = repo.nhom(nhom_id)
    if nhom is None:
        raise ValueError("Không tìm thấy nhóm thành phẩm.")
    return nhom


def _so_lieu(db: Session, nhom_id: int) -> dict:
    """Số của nhóm lúc đọc: mục tiêu/đạt/chưa kiểm/chưa gửi kho ở công đoạn cuối + việc còn dở."""
    from .kho import dong_nhap_kho_cua_cong_viec, so_con_gui_kho

    repo = SanXuatRepository(db)
    cvs = repo.cong_viec_hien_tai_cua_nhom(nhom_id)
    cuoi = [cv for cv in cvs if cv.la_kcs_cuoi]
    ids = [cv.id for cv in cuoi]
    tot_map = SanXuatSanLuongRepository(db).tong_tot_nhieu(ids)
    kiem_map = SanXuatKcsRepository(db).tong_kiem_nhieu(ids)
    tot = sum(tot_map.get(i, 0.0) for i in ids)
    dat = sum(kiem_map.get(i, (0, 0.0, 0.0))[1] for i in ids)
    loi = sum(kiem_map.get(i, (0, 0.0, 0.0))[2] for i in ids)
    co_muc_tieu = [cv for cv in cuoi if cv.so_luong_ra is not None]
    muc_tieu = sum(float(cv.so_luong_ra) for cv in co_muc_tieu) if co_muc_tieu else None
    dong_kho = dong_nhap_kho_cua_cong_viec(db, ids) if ids else {}
    chua_gui = sum(so_con_gui_kho(db, cv, dong_kho.get(cv.id, [])) for cv in cuoi)
    return {
        "muc_tieu": muc_tieu,
        "da_dat": dat,
        "chua_kiem": max(tot - dat - loi, 0.0),
        "chua_gui_kho": chua_gui,
        "viec_do": [cv for cv in cvs if cv.trang_thai != CV_HOAN_THANH],
        # ĐVT của LỆNH ("hộp") — cùng chữ màn Kế hoạch SX; `don_vi_ra` là MÃ chặng ("cai").
        "don_vi": next((l.don_vi_tinh for l, _tv in repo.lenh_cua_nhom(nhom_id) if l.don_vi_tinh), "")
        or next((cv.don_vi_ra for cv in cuoi if cv.don_vi_ra), "") or "",
    }


def _canh_bao(db: Session, s: dict) -> list[dict]:
    dv = f" {s['don_vi']}" if s["don_vi"] else ""
    out: list[dict] = []
    if s["chua_kiem"] > _EPS:
        out.append({"ma": "chua_kiem",
                    "cau": f"Còn {_so(s['chua_kiem'])}{dv} tổ đã ghi tốt mà KCS chưa kiểm."})
    if s["chua_gui_kho"] > _EPS:
        out.append({"ma": "chua_gui_kho",
                    "cau": f"Còn {_so(s['chua_gui_kho'])}{dv} đạt chưa gửi yêu cầu nhập kho."})
    if s["muc_tieu"] is not None and s["da_dat"] + _EPS < s["muc_tieu"]:
        out.append({"ma": "thieu_muc_tieu",
                    "cau": f"Đạt {_so(s['da_dat'])} / {_so(s['muc_tieu'])}{dv} — thiếu "
                           f"{_so(s['muc_tieu'] - s['da_dat'])}."})
    if s["viec_do"]:
        to = sorted({d.name for cv in s["viec_do"]
                     if cv.department_id and (d := db.get(Department, cv.department_id))})
        ten_to = f" ({', '.join(to)})" if to else ""
        out.append({"ma": "viec_do",
                    "cau": f"Còn {len(s['viec_do'])} việc chưa xong{ten_to}, sẽ rút khỏi Việc của tổ."})
    return out


def tinh_trang_dong(db: Session, nhom_id: int, user=None) -> dict:
    repo = SanXuatRepository(db)
    nhom = _nhom(repo, nhom_id)
    s = _so_lieu(db, nhom_id)
    lan = repo.lan_dong_cuoi(nhom_id) if nhom.trang_thai == NHOM_DONG else None
    return {
        "nhom_id": nhom.id,
        "order_id": nhom.order_id,
        "trang_thai": nhom.trang_thai,
        "version": nhom.version,
        "lenh": [{"id": l.id, "ma": l.ma} for l, _tv in repo.lenh_cua_nhom(nhom_id)],
        "muc_tieu": s["muc_tieu"],
        "da_dat": s["da_dat"],
        "don_vi": s["don_vi"],
        "canh_bao": _canh_bao(db, s) if nhom.trang_thai != NHOM_DONG else [],
        "dong_boi": lan[0] if lan else None,
        "dong_luc": lan[1] if lan else None,
        # Giao diện khoá nút đóng khi còn cảnh báo / nút mở lại theo cờ này — máy chủ vẫn gác lại.
        "duoc_dong_thieu": duoc_dong_thieu(db, user),
    }


def _chuyen(db: Session, *, user, nhom_id: int, expected_version: int | None, dong: bool) -> dict:
    gate_kcs(db, user)
    repo = SanXuatRepository(db)
    # Khoá dòng nhóm: hai KCS bấm cùng lúc, hay đóng chen mở lại, thì bên sau chờ rồi đọc trạng thái mới.
    nhom = repo.nhom_khoa(nhom_id)
    if nhom is None:
        raise ValueError("Không tìm thấy nhóm thành phẩm.")
    if dong and nhom.trang_thai == NHOM_DONG:
        raise ValueError("Lệnh đã đóng rồi.")
    if not dong and nhom.trang_thai != NHOM_DONG:
        raise ValueError("Lệnh chưa đóng nên không có gì để mở lại.")
    if expected_version is not None and expected_version != nhom.version:
        raise ValueError("Vừa có người cập nhật lệnh này, hãy tải lại rồi thao tác.")

    s = _so_lieu(db, nhom_id)
    if (not dong or _canh_bao(db, s)) and not duoc_dong_thieu(db, user):
        raise PermissionError(
            f"{THIEU_QUYEN_DONG_THIEU} để "
            + ("mở lại lệnh đã đóng." if not dong else "đóng khi còn việc chưa xong.")
        )
    tu, den = (TT_DA_PHAT_HANH, TT_DA_DONG) if dong else (TT_DA_DONG, TT_DA_PHAT_HANH)
    lenh = [l for l, _tv in repo.lenh_cua_nhom(nhom_id)]
    for l in lenh:
        if l.trang_thai == tu:
            l.trang_thai = den
    nhom.trang_thai = NHOM_DONG if dong else NHOM_DANG_SX
    nhom.version += 1
    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None),
        action="san_xuat_dong_lenh" if dong else "san_xuat_mo_lai_lenh",
        target=f"san_xuat_nhom:{nhom.id}",
        commit=False,
        detail=(f"lenh={','.join(l.ma for l in lenh)} dat={s['da_dat']:g} "
                f"muc_tieu={'' if s['muc_tieu'] is None else format(s['muc_tieu'], 'g')} "
                f"chua_kiem={s['chua_kiem']:g} chua_gui_kho={s['chua_gui_kho']:g} "
                f"viec_do={len(s['viec_do'])}"),
    )
    db.commit()
    return {
        "nhom_id": nhom.id, "order_id": nhom.order_id, "trang_thai": nhom.trang_thai,
        "kieu": "dong" if dong else "mo_lai", "version": nhom.version,
        "lenh_ma": [l.ma for l in lenh], "da_dat": s["da_dat"], "muc_tieu": s["muc_tieu"],
        "don_vi": s["don_vi"],
    }


def dong(db: Session, *, user, nhom_id: int, expected_version: int | None = None) -> dict:
    return _chuyen(db, user=user, nhom_id=nhom_id, expected_version=expected_version, dong=True)


def mo_lai(db: Session, *, user, nhom_id: int, expected_version: int | None = None) -> dict:
    return _chuyen(db, user=user, nhom_id=nhom_id, expected_version=expected_version, dong=False)


def nhom_da_dong(db: Session, cv) -> bool:
    """Công việc thuộc nhóm đã đóng? Việc chung bài ghép (`nhom_id` NULL) chỉ tính là đóng khi MỌI
    nhóm của các lệnh thành viên đã đóng — cùng luật với `SanXuatRepository.viec_con_hien`."""
    repo = SanXuatRepository(db)
    if cv.nhom_id is not None:
        # FOR SHARE: cửa ghi xưởng không chặn nhau, nhưng không lọt qua khi lệnh đóng chưa commit.
        n = repo.nhom_khoa(cv.nhom_id, chia_se=True)
        return n is not None and n.trang_thai == NHOM_DONG
    if cv.bai_ghep_id is None:
        return False
    tt = repo.trang_thai_nhom_cua_bai_ghep(cv.bai_ghep_id)
    return bool(tt) and all(t == NHOM_DONG for t in tt)


def chan_neu_da_dong(db: Session, cv, *, cho_viec_dang_chay: bool = False) -> None:
    """Cửa ghi của xưởng gọi hàm này. `cho_viec_dang_chay` = thao tác được phép tiếp trên việc ĐANG
    CHẠY dù lệnh đã đóng (ghi mẻ của chính việc đó) — để tổ khép đồng hồ, không bỏ treo giờ công."""
    if cho_viec_dang_chay and cv.trang_thai == CV_DANG_CHAY:
        return
    if nhom_da_dong(db, cv):
        raise ValueError(CHAN_DA_DONG)
