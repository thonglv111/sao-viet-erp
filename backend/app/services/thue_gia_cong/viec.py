"""VIỆC gia công: sinh lúc phát hành, đồng bộ lúc phát hành cập nhật, xoá khi thu hồi gói, tách theo
bước (spec 2026-11-13 §3 điểm nối 1).

Một dải bước "Thuê ngoài" LIỀN NHAU của một lệnh (hoặc dải bước CHUNG của bài ghép) ⇒ MỘT việc.
Lệnh không còn biết nhà gia công nên dải gom theo "liền nhau cùng tick", nhà gia công chọn lúc lập
đơn. Việc CHƯA vào dòng đơn sống tự do sinh lại / xoá; việc đã vào đơn thì bị khoá: routing làm mất
hoặc đổi dải của nó bị chặn, phải huỷ dòng đơn trước.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.lsx import LB_THUE_NGOAI
from ...models.thue_gia_cong import KIEU_MOT_PHAN, TgcViec
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository
from . import kiem_version


def _cap_ke_tiep_bai_ghep(db: Session, buoc_chungs: list) -> set[tuple[int, int]]:
    """Cặp (bước chung x, bước chung y) LIỀN NHAU ở MỌI lệnh thành viên — bước lệnh x phủ có cạnh
    DAG sang bước lệnh y phủ (routing không khai cạnh ⇒ so `thu_tu` liền kề). Chỉ một lệnh có bước
    riêng chen giữa là hai việc khác nhau: hàng lệnh đó phải về xưởng làm bước riêng rồi mới đi."""
    repo = SanXuatRepository(db)
    tgc = ThueGiaCongRepository(db)
    phu = {c.id: {m.lsx_id: m.lsx_step_key for m in c.thanh_phans} for c in buoc_chungs}
    cache: dict[int, tuple[dict, set, list]] = {}

    def lenh(lsx_id: int):
        if lsx_id not in cache:
            steps = repo.routing_steps(lsx_id)
            cache[lsx_id] = ({cd.step_key: cd for cd in steps}, tgc.canh_ke_tiep(lsx_id),
                             [cd.step_key for cd in steps])
        return cache[lsx_id]

    def lien(lsx_id: int, k1: str, k2: str) -> bool:
        theo_key, canh, thu_tu = lenh(lsx_id)
        x, y = theo_key.get(k1), theo_key.get(k2)
        if x is None or y is None:
            return False
        if canh:
            return (x.id, y.id) in canh
        i = thu_tu.index(k1)
        return i + 1 < len(thu_tu) and thu_tu[i + 1] == k2

    ra: set[tuple[int, int]] = set()
    for x, y in zip(buoc_chungs, buoc_chungs[1:]):
        px, py = phu.get(x.id) or {}, phu.get(y.id) or {}
        if px and set(px) == set(py) and all(lien(l, px[l], py[l]) for l in px):
            ra.add((x.id, y.id))
    return ra


def quet_dai_thue_ngoai(steps, canh: set[tuple[int, int]], cv_by_step: dict, *,
                        bi_phu: set[str] | None = None, bai_ghep: bool = False) -> list[list]:
    """Cắt routing (đã sắp `thu_tu`) thành các dải bước "Thuê ngoài" LIỀN NHAU. "Liền nhau" theo
    CẠNH DAG (`dai[-1].id → cd.id` phải có cạnh); routing không khai cạnh nào thì so `thu_tu` liền
    kề. Hai nhánh song song của cùng một bước cha không liền nhau dù `thu_tu` sát nhau.

    Bước LỆNH bị bài ghép phủ ngắt dải — nó thuộc việc của BÀI GHÉP. `bai_ghep=True`: `steps` là
    bước CHUNG của một bài (`canh` = `_cap_ke_tiep_bai_ghep`; rỗng là không cặp nào liền nhau)."""
    co_canh_nao = bool(canh) or bai_ghep
    bi_phu = bi_phu or set()
    ra: list[list] = []
    dai: list = []

    def dong() -> None:
        if dai:
            ra.append(list(dai))
            dai.clear()

    for cd in steps:
        cvs = cv_by_step.get(cd.step_key) or []
        chung = not bai_ghep and (cd.step_key in bi_phu or any(cv.bai_ghep_id for cv in cvs))
        if cd.loai_buoc != LB_THUE_NGOAI or chung:
            dong()
            continue
        if dai and co_canh_nao and (dai[-1].id, cd.id) not in canh:
            dong()
        dai.append(cd)
    dong()
    return ra


def _cvs_cua_dai(dai: list, cv_by_step: dict) -> list:
    return [cv for c in dai for cv in cv_by_step.get(c.step_key) or []]


def _tao_viec(db: Session, audit: AuditLogRepository, *, dai: list, cv_by_step: dict,
              uid: int | None, lsx_id: int | None = None, bai_ghep_id: int | None = None) -> TgcViec:
    dau, cuoi = dai[0], dai[-1]
    # Số cần đo bằng đơn vị NHẬN VỀ (đơn vị ra của bước cuối) — cùng đơn vị với số đặt, phiếu nhận và
    # còn ở ngoài; lấy số vào của bước đầu thì lệch khi dải đổi đơn vị (tề giấy: tờ nguyên → tờ in).
    cv_cuoi = (cv_by_step.get(cuoi.step_key) or [None])[-1]
    sl = getattr(cv_cuoi, "so_luong_ra", None)
    if sl is None:
        sl = getattr(cuoi, "so_luong_ra", None)
    viec = TgcViec(
        lsx_id=lsx_id, bai_ghep_id=bai_ghep_id, kieu=KIEU_MOT_PHAN,
        ten_viec=" + ".join(c.ten for c in dai)[:255],
        sl_can=float(sl) if sl is not None else None,
        don_vi=getattr(cuoi, "don_vi_ra", None), created_by=uid,
    )
    db.add(viec)
    db.flush()
    for cv in _cvs_cua_dai(dai, cv_by_step):
        cv.tgc_viec_id = viec.id
        cv.department_id = None
        cv.may_id = None
    audit.create(actor_user_id=uid, action="tgc_viec_sinh", target=f"tgc_viec:{viec.id}",
                 detail=f"Phát hành: việc {viec.ten_viec} vào Hàng chờ", commit=False)
    return viec


def _xoa_viec(db: Session, audit: AuditLogRepository, viec: TgcViec, uid: int | None,
              ly_do: str) -> None:
    """Xoá việc CHƯA đặt. Công việc còn trỏ tới nó phải được gỡ/gán lại TRƯỚC (SQLite test không
    chạy FK SET NULL)."""
    audit.create(actor_user_id=uid, action="tgc_viec_xoa", target=f"tgc_viec:{viec.id}",
                 detail=f"{viec.ten_viec}: {ly_do}"[:500], commit=False)
    db.delete(viec)


def _tra_ve_xuong(cvs: list, cd_by_step: dict) -> None:
    """Công việc MỒ CÔI (bước hết thuê ngoài / dải co lại): gỡ liên kết, trả tổ + máy theo routing
    hiện tại của đúng bước đó."""
    for cv in cvs:
        cd = cd_by_step.get(cv.step_key)
        cv.tgc_viec_id = None
        cv.department_id = getattr(cd, "department_id", None) if cd is not None else None
        cv.may_id = getattr(cd, "may_id", None) if cd is not None else None


def _cv_by_step(cvs) -> dict[str, list]:
    out: dict[str, list] = {}
    for cv in cvs:
        if cv.step_key:
            out.setdefault(cv.step_key, []).append(cv)
    return out


def sinh_khi_phat_hanh(db: Session, *, lsx_ids: set[int], bai_ghep_ids: set[int] | None = None,
                       cv_by_step: dict, actor) -> list[TgcViec]:
    """Gọi trong giao dịch phát hành, KHÔNG commit. Công việc của dải gắn `tgc_viec_id`, gỡ tổ +
    máy (không vào bàn tổ nào)."""
    repo = SanXuatRepository(db)
    tgc = ThueGiaCongRepository(db)
    audit = AuditLogRepository(db)
    uid = getattr(actor, "id", None)
    tao: list[TgcViec] = []
    for lsx_id in sorted(lsx_ids or ()):
        steps = repo.routing_steps(lsx_id)
        for dai in quet_dai_thue_ngoai(steps, tgc.canh_ke_tiep(lsx_id), cv_by_step,
                                       bi_phu=tgc.step_keys_bi_phu(lsx_id)):
            tao.append(_tao_viec(db, audit, lsx_id=lsx_id, dai=dai, cv_by_step=cv_by_step, uid=uid))
    for bg_id in sorted(bai_ghep_ids or ()):
        steps = repo.bai_ghep_cong_doans(bg_id)
        for dai in quet_dai_thue_ngoai(steps, _cap_ke_tiep_bai_ghep(db, steps), cv_by_step,
                                       bai_ghep=True):
            tao.append(_tao_viec(db, audit, bai_ghep_id=bg_id, dai=dai, cv_by_step=cv_by_step,
                                 uid=uid))
    db.flush()
    return tao


def _chan_da_dat(viec: TgcViec, ma_don: str, cvs: list) -> ValueError:
    ten = cvs[0].ten_cong_doan if cvs else viec.ten_viec
    return ValueError(f"Bước “{ten}” đang nằm trong đơn {ma_don} — huỷ dòng đơn trước rồi phát "
                      "hành lại.")


def _dong_bo_mot(db: Session, audit: AuditLogRepository, tgc: ThueGiaCongRepository,
                 uid: int | None, *, steps: list, cv_by_step: dict, dai_list: list,
                 viecs: list[TgcViec], nguon: dict) -> None:
    cd_by_step = {cd.step_key: cd for cd in steps}
    mot_phan = [v for v in viecs if v.kieu == KIEU_MOT_PHAN]
    cvs_cua = tgc.cong_viec_cua_nhieu_viec([v.id for v in mot_phan])
    da_dat = tgc.dong_song_cua_viec([v.id for v in mot_phan])
    theo_step: dict[str, TgcViec] = {}
    for v in mot_phan:
        for cv in cvs_cua.get(v.id, []):
            if cv.step_key:
                theo_step[cv.step_key] = v

    giu: set[int] = set()
    bo: list[TgcViec] = []
    for dai in dai_list:
        lien_quan = {theo_step[c.step_key].id: theo_step[c.step_key]
                     for c in dai if c.step_key in theo_step}
        cv_dai = {cv.id for cv in _cvs_cua_dai(dai, cv_by_step)}
        cv_viec = {cv.id for v in lien_quan.values() for cv in cvs_cua.get(v.id, [])}
        if lien_quan and cv_dai == cv_viec:
            # Dải KHÔNG đổi (kể cả đã tách theo bước): giữ nguyên các việc. Việc chưa đặt đồng bộ
            # tên + đơn vị theo routing hiện tại khi có đúng một việc phủ cả dải.
            if len(lien_quan) == 1:
                (v,) = lien_quan.values()
                ten = " + ".join(c.ten for c in dai)[:255]
                dv = getattr(dai[-1], "don_vi_ra", None)
                if v.id not in da_dat and (v.ten_viec != ten or v.don_vi != dv):
                    v.ten_viec, v.don_vi = ten, dv
                    v.version += 1
            giu.update(lien_quan)
            continue
        for v in lien_quan.values():
            if v.id in da_dat:
                raise _chan_da_dat(v, da_dat[v.id], cvs_cua.get(v.id, []))
        bo.extend(v for v in lien_quan.values() if v.id not in giu and v not in bo)
        moi = _tao_viec(db, audit, dai=dai, cv_by_step=cv_by_step, uid=uid, **nguon)
        giu.add(moi.id)

    for v in mot_phan:
        if v.id not in giu and v not in bo:
            if v.id in da_dat:
                raise _chan_da_dat(v, da_dat[v.id], cvs_cua.get(v.id, []))
            bo.append(v)

    # Trả việc MỒ CÔI về tổ/máy SAU khi mọi việc mới đã gom xong (không cướp nhầm công việc vừa gán
    # sang việc mới), rồi mới xoá việc cũ.
    bo_ids = {v.id for v in bo}
    mo_coi = [cv for v in bo for cv in cvs_cua.get(v.id, []) if cv.tgc_viec_id in bo_ids]
    _tra_ve_xuong(mo_coi, cd_by_step)
    db.flush()
    for v in bo:
        _xoa_viec(db, audit, v, uid, "Phát hành cập nhật — routing đổi, gom lại việc.")


def dong_bo_khi_cap_nhat(db: Session, *, lsx_ids: set[int], bai_ghep_ids: set[int] | None = None,
                         actor) -> None:
    """Sau Phát hành cập nhật: đồng bộ việc theo routing hiện tại — IDEMPOTENT, KHÔNG commit."""
    repo = SanXuatRepository(db)
    tgc = ThueGiaCongRepository(db)
    audit = AuditLogRepository(db)
    uid = getattr(actor, "id", None)
    for lsx_id in sorted(lsx_ids or ()):
        steps = repo.routing_steps(lsx_id)
        cv_by_step = _cv_by_step(tgc.cong_viec_cua_lenh(lsx_id))
        dai_list = quet_dai_thue_ngoai(steps, tgc.canh_ke_tiep(lsx_id), cv_by_step,
                                       bi_phu=tgc.step_keys_bi_phu(lsx_id))
        _dong_bo_mot(db, audit, tgc, uid, steps=steps, cv_by_step=cv_by_step, dai_list=dai_list,
                     viecs=tgc.viec_cua_lenh(lsx_id), nguon={"lsx_id": lsx_id})
    for bg_id in sorted(bai_ghep_ids or ()):
        steps = repo.bai_ghep_cong_doans(bg_id)
        cv_by_step = _cv_by_step(tgc.cong_viec_chung_song(bg_id))
        dai_list = quet_dai_thue_ngoai(steps, _cap_ke_tiep_bai_ghep(db, steps), cv_by_step,
                                       bai_ghep=True)
        _dong_bo_mot(db, audit, tgc, uid, steps=steps, cv_by_step=cv_by_step, dai_list=dai_list,
                     viecs=tgc.viec_cua_bai_ghep(bg_id), nguon={"bai_ghep_id": bg_id})
    db.flush()


def chan_thu_hoi(db: Session, *, goi_id: int) -> str | None:
    """Câu chặn thu hồi gói khi có việc đã vào dòng đơn sống; None = thu hồi được."""
    tgc = ThueGiaCongRepository(db)
    viecs = tgc.viec_cua_goi(goi_id)
    da_dat = tgc.dong_song_cua_viec([v.id for v in viecs])
    for v in viecs:
        if v.id in da_dat:
            return (f"Việc “{v.ten_viec}” đang nằm trong đơn gia công {da_dat[v.id]} — huỷ dòng "
                    "đơn trước rồi thu hồi.")
    return None


def xoa_viec_cua_goi(db: Session, *, goi_id: int, actor, ly_do: str | None = None) -> int:
    """Gói bị thu hồi ⇒ xoá việc CHƯA đặt của gói. Có việc đã vào dòng đơn sống ⇒ `ValueError`
    nêu mã đơn. KHÔNG commit. Trả số việc đã xoá."""
    chan = chan_thu_hoi(db, goi_id=goi_id)
    if chan:
        raise ValueError(chan)
    tgc = ThueGiaCongRepository(db)
    audit = AuditLogRepository(db)
    uid = getattr(actor, "id", None)
    viecs = tgc.viec_cua_goi(goi_id)
    cvs_cua = tgc.cong_viec_cua_nhieu_viec([v.id for v in viecs])
    for v in viecs:
        for cv in cvs_cua.get(v.id, []):
            cv.tgc_viec_id = None
    db.flush()
    for v in viecs:
        _xoa_viec(db, audit, v, uid, ly_do or "Thu hồi gói phát hành")
    db.flush()
    return len(viecs)


def tach_theo_buoc(db: Session, *, user, viec_id: int, expected_version: int | None) -> list[TgcViec]:
    """Q5: một việc nhiều bước tách thành mỗi bước một việc (để đặt hai nhà gia công khác nhau).
    Chỉ việc một phần, chưa vào dòng đơn sống, có ít nhất 2 bước."""
    tgc = ThueGiaCongRepository(db)
    viec = tgc.khoa_viec(viec_id)
    if viec is None:
        raise ValueError("Không tìm thấy việc gia công.")
    kiem_version(viec, expected_version, "Việc gia công")
    if viec.kieu != KIEU_MOT_PHAN:
        raise ValueError("Việc trọn gói không tách theo bước được.")
    da_dat = tgc.dong_song_cua_viec([viec.id])
    if viec.id in da_dat:
        raise ValueError(f"Việc đã nằm trong đơn {da_dat[viec.id]} — huỷ dòng đơn trước rồi tách.")
    cvs = tgc.cong_viec_cua_viec(viec.id)
    buoc: list[str] = []
    theo: dict[str, list] = {}
    for cv in cvs:
        k = cv.step_key or f"cv:{cv.id}"
        if k not in theo:
            buoc.append(k)
        theo.setdefault(k, []).append(cv)
    if len(buoc) < 2:
        raise ValueError("Việc chỉ có một bước — không có gì để tách.")
    audit = AuditLogRepository(db)
    uid = getattr(user, "id", None)
    moi: list[TgcViec] = []
    for k in buoc:
        dau = theo[k][0]
        v = TgcViec(lsx_id=viec.lsx_id, bai_ghep_id=viec.bai_ghep_id, kieu=KIEU_MOT_PHAN,
                    ten_viec=(dau.ten_cong_doan or "")[:255],
                    sl_can=float(dau.so_luong_ra) if dau.so_luong_ra is not None else None,
                    don_vi=dau.don_vi_ra, created_by=uid)
        db.add(v)
        db.flush()
        for cv in theo[k]:
            cv.tgc_viec_id = v.id
        moi.append(v)
    db.flush()
    audit.create(actor_user_id=uid, action="tgc_viec_tach", target=f"tgc_viec:{viec.id}",
                 detail=f"Tách “{viec.ten_viec}” thành {len(moi)} việc: "
                        + "; ".join(v.ten_viec for v in moi), commit=False)
    db.delete(viec)
    db.commit()
    return moi
