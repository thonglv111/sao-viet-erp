"""NGƯỜI LÀM từng lần ghi sản lượng — tổ tick lúc ghi (10/10/2026, mg 0386).

Chủ xưởng: *"khi lệnh được phát hành thì hệ thống sẽ tự động gán tất cả thành viên thuộc phòng ban
đấy, lúc ghi sản lượng thì hiển thị danh sách tất cả thành viên tham gia bao gồm cả bên gọi sang hỗ
trợ, và chỉ untick thành viên bên tổ mình để xác nhận những ai tham gia"*.

Cùng ngày chủ xưởng bỏ thỏa thuận hỗ trợ chéo (mg 0389): *"không cần gửi cho bên kia chấp nhận nữa
mà cứ thêm vào thôi, lúc ghi sản lượng ấy, còn sản lượng bên kia vẫn nhìn thấy"*.

Danh sách trong hộp Ghi sản lượng:
  · người tổ mình = ai đang được giao vào việc (Rút người thì thôi hiện). Mặc định tick, trừ người
    nghỉ hôm đó (nghỉ dài hạn, đình chỉ, nghỉ phép đã duyệt) — mờ, không tick.
    Người còn tên ở việc khác đã Bắt đầu, chưa Kết thúc ⇒ chỉ ghi chú "đang ở LSX… công đoạn…",
    vẫn tick: một người đứng hai máy là chuyện thường, tổ tự bỏ tick khi họ không làm lần này;
  · người tổ khác sang giúp — tổ tự thêm thẳng vào lần ghi (không ai phải duyệt), lưu `la_ho_tro`.
    Chặn người nghỉ hôm đó hoặc đã nghỉ việc. Tổ gốc của họ thấy lần ghi ở tab Sản lượng, mục
    người của tổ làm ở tổ khác (`san_luong_to`, `la_khach`).

Lưu thành ẢNH CHỤP: tổ đổi người, đổi tổ sau đó thì lần ghi cũ giữ nguyên tên."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from ...models.employee import STATUS_RESIGNED
from ...models.san_xuat import SanXuatCongViec
from ...models.san_xuat_san_luong import SanXuatBatch
from ...repositories.leave_repo import LeaveRepository
from ...repositories.san_xuat_batch_nguoi_repo import SanXuatBatchNguoiRepository
from ...repositories.san_xuat_thuc_thi_repo import SanXuatThucThiRepository
from .nguoi_trong_me import ngay_cua_me
from .tinh_trang_nguoi import LY_DO_NGHI, nhan_viec

CAN_MOT_NGUOI = "Chọn ít nhất một người làm lần này."


def chuan_so_luong_nguoi(so_luong_nguoi: dict | None, tot: float) -> dict[int, float] | None:
    """Số làm được của từng người (18/11/2026, chỉ In Hà Phương bật `san_luong_tung_nguoi`).

    Tốt của lần ghi = tổng số từng người; máy chủ kiểm lại để số tổng không lệch số người. None =
    lần ghi theo số tổng như cũ."""
    if so_luong_nguoi is None:
        return None
    from ...phan_he import SAN_LUONG_TUNG_NGUOI, tat

    if tat(SAN_LUONG_TUNG_NGUOI):
        raise ValueError("Bản cài này ghi sản lượng theo số tổng, không ghi riêng từng người.")
    ds = {int(k): round(float(v or 0), 3) for k, v in so_luong_nguoi.items()}
    if not ds:
        raise ValueError(CAN_MOT_NGUOI)
    if any(v < 0 for v in ds.values()):
        raise ValueError("Số của từng người không được âm.")
    if abs(sum(ds.values()) - float(tot)) > 0.0005:
        raise ValueError("Số tốt phải bằng tổng số của từng người.")
    return ds


def dat_so_luong(db: Session, batch_id: int, ds: dict[int, float] | None) -> list[str]:
    """Ghi số từng người vào các dòng người làm của lần ghi. Trả ["Tên: cũ→mới"] của người đổi số."""
    if ds is None:
        return []
    db.flush()  # dòng người vừa thêm / xoá phải xuống DB trước khi đọc lại (session không tự flush)
    repo = SanXuatBatchNguoiRepository(db)
    rows = repo.cua_batch(batch_id)
    emps = repo.nhan_vien_nhieu({r.employee_id for r in rows})
    doi = []
    for r in rows:
        moi = ds.get(r.employee_id, 0.0)
        cu = float(r.so_luong) if r.so_luong is not None else None
        if cu is None or abs(cu - moi) > 0.0005:
            ten = getattr(emps.get(r.employee_id), "full_name", None) or f"#{r.employee_id}"
            doi.append(f"{ten}: {'-' if cu is None else f'{cu:g}'}->{moi:g}")
            r.so_luong = moi
    return doi


def tinh_trang_ghi(db: Session, cv: SanXuatCongViec, emp_ids: set[int], ngay: date | None) -> dict[int, dict]:
    """{employee_id: {nghi, dang_o}} — hai thứ hộp Ghi sản lượng ghi cạnh tên.

    `dang_o` chỉ mã lệnh + tên công đoạn (chủ xưởng: *"chỉ cần hiển thị tên lsx và công đoạn
    thôi"*)."""
    if not emp_ids:
        return {}
    emps = SanXuatBatchNguoiRepository(db).nhan_vien_nhieu(emp_ids)
    dang_o = SanXuatThucThiRepository(db).viec_dang_lam_cua_nhieu(emp_ids, cv.id)
    nhan = nhan_viec(db, [c for ds in dang_o.values() for c in ds])
    phep = ({d.employee_id for d in LeaveRepository(db).approved_for_employees(emp_ids, tu=ngay, den=ngay)}
            if ngay else set())

    def _viec(c: SanXuatCongViec) -> dict:
        v = nhan.get(c.id, {})
        return {"cong_viec_id": c.id, "ma": v.get("ma"), "ten_cong_doan": v.get("ten_cong_doan") or ""}

    ra: dict[int, dict] = {}
    for eid in emp_ids:
        e = emps.get(eid)
        nghi = LY_DO_NGHI.get(e.status) if e is not None else None
        if nghi is None and eid in phep:
            nghi = "Nghỉ phép"
        ra[eid] = {"nghi": nghi, "dang_o": [_viec(c) for c in dang_o.get(eid, [])]}
    return ra


def tick_san(t: dict) -> bool:
    """Mặc định tick: đi làm hôm đó."""
    return t["nghi"] is None


def ung_vien_ghi(db: Session, cv: SanXuatCongViec, roster_ids: list[int], ngay: date) -> list[dict]:
    """Người tổ mình bày trong hộp Ghi sản lượng, theo thứ tự tên. Người tổ khác FE tìm trong danh
    sách thợ tổ khác (`/teams/{id}/ho-tro-ung-vien`)."""
    ids = set(roster_ids)
    tt = tinh_trang_ghi(db, cv, ids, ngay)
    emps = SanXuatBatchNguoiRepository(db).nhan_vien_nhieu(ids)
    ds = [
        {
            "employee_id": eid,
            "ho_ten": getattr(emps.get(eid), "full_name", None) or f"#{eid}",
            **tt[eid],
            "tick_san": tick_san(tt[eid]),
        }
        for eid in ids
    ]
    return sorted(ds, key=lambda x: (x["ho_ten"], x["employee_id"]))


def _khong_trung(ids) -> list[int]:
    return list(dict.fromkeys(int(i) for i in ids))


def _kiem_nguoi_ngoai(db: Session, cv: SanXuatCongViec, ids: list[int], ngay: date | None) -> dict:
    """Người ngoài danh sách giao tổ thêm vào lần ghi: phải có hồ sơ, chưa nghỉ việc, không nghỉ
    đúng ngày của lần ghi. Trả {id: Employee}."""
    if not ids:
        return {}
    emps = SanXuatBatchNguoiRepository(db).nhan_vien_nhieu(set(ids))
    if any(e not in emps for e in ids):
        raise ValueError("Không tìm thấy người được thêm — đóng hộp rồi chọn lại.")
    tt = tinh_trang_ghi(db, cv, set(ids), ngay)
    for eid in ids:
        e = emps[eid]
        if e.status == STATUS_RESIGNED:
            raise ValueError(f"{e.full_name} đã nghỉ việc, không thêm vào lần ghi được.")
        if tt[eid]["nghi"]:
            raise ValueError(f"{e.full_name} nghỉ hôm đó ({tt[eid]['nghi'].lower()}), không thêm vào lần ghi được.")
    return emps


def chot_nguoi(
    db: Session, cv: SanXuatCongViec, nguoi_ids: list[int] | None, ngay_me: date | None,
) -> list[tuple[int, int | None, bool]]:
    """[(employee_id, tổ gốc, là người ngoài danh sách giao)] của lần ghi sắp lưu. Kiểm TRƯỚC khi
    đụng session.

    `nguoi_ids` None (gọi không qua hộp: chốt gia công, script, test cũ) ⇒ lấy đúng bộ tick sẵn của
    hộp, và không ai thì thôi — luật "ít nhất một người" là luật của HỘP, nơi tổ tự bỏ tick."""
    roster = [pc.employee_id for pc in SanXuatThucThiRepository(db).phan_cong_hoat_dong(cv.id)]
    if nguoi_ids is None:
        tt = tinh_trang_ghi(db, cv, set(roster), ngay_me) if ngay_me else {}
        chon = [e for e in roster if e in tt and tick_san(tt[e])]
    else:
        chon = _khong_trung(nguoi_ids)
        if not chon:
            raise ValueError(CAN_MOT_NGUOI)
    trong = set(roster)
    ngoai = [e for e in chon if e not in trong]
    emps = _kiem_nguoi_ngoai(db, cv, ngoai, ngay_me)
    emps.update(SanXuatBatchNguoiRepository(db).nhan_vien_nhieu({e for e in chon if e in trong}))
    return [(eid, getattr(emps.get(eid), "department_id", None), eid not in trong) for eid in chon]


def ghi_nguoi(db: Session, batch_id: int, ds: list[tuple[int, int | None, bool]]) -> None:
    repo = SanXuatBatchNguoiRepository(db)
    for eid, dept, la_ht in ds:
        repo.them(batch_id, eid, dept, la_ht)


def sua_nguoi(
    db: Session, batch: SanXuatBatch, cv: SanXuatCongViec, nguoi_ids: list[int],
) -> tuple[list[str], list[str]] | None:
    """Đổi người của một lần ghi (hộp Sửa số sản lượng), kể cả người tổ khác. Chọn được: người đang
    có trong lần ghi, người đang được giao, và người tổ khác (cùng luật `_kiem_nguoi_ngoai`). Trả
    (tên bỏ ra, tên thêm vào), None = không đổi gì."""
    repo = SanXuatBatchNguoiRepository(db)
    cu = {r.employee_id: r for r in repo.cua_batch(batch.id)}
    roster = {pc.employee_id for pc in SanXuatThucThiRepository(db).phan_cong_hoat_dong(cv.id)}
    moi = _khong_trung(nguoi_ids)
    if set(moi) == set(cu):
        return None
    if not moi:
        raise ValueError(CAN_MOT_NGUOI)
    them = [eid for eid in moi if eid not in cu]
    _kiem_nguoi_ngoai(db, cv, [e for e in them if e not in roster], ngay_cua_me(batch.bat_dau))
    emps = repo.nhan_vien_nhieu(set(cu) | set(moi))

    def _ten(eid: int) -> str:
        return getattr(emps.get(eid), "full_name", None) or f"#{eid}"

    bot = [eid for eid in cu if eid not in moi]
    for eid in bot:
        repo.xoa(cu[eid])
    for eid in them:
        repo.them(batch.id, eid, getattr(emps.get(eid), "department_id", None), eid not in roster)
    return [_ten(e) for e in bot], [_ten(e) for e in them]
