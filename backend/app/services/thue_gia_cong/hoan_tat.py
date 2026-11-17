"""HOÀN TẤT dòng đơn gia công (spec 2026-11-13 §4.5) — ERPNext "Close" + trả vật tư dư.

Bấm khi không chờ thêm hàng: chụp hao hụt = giao quy đổi − đạt − hỏng (trọn gói: không có), vật tư
từ kho còn dư mà nhà gia công trả về thì lập MỘT đề nghị NHẬP trả kho mang `tgc_don_dong_id`; phần
không trả coi là dùng hết. Mọi công việc của việc chuyển Hoàn thành — chỉ ở đây, không theo số nhận
(hao hụt luôn có). Dòng cuối hoàn tất ⇒ đơn "Hoàn tất" (trạng thái dẫn xuất).
Mở lại: khi kho chưa lập phiếu cho đề nghị nhập trả và lệnh chưa đóng."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ...models.san_xuat import CV_HOAN_THANH, CV_PHAT_HANH, NHOM_DONG
from ...models.stock_request import REQ_CANCELLED, REQ_NHAP, REQ_REJECTED
from ...models.thue_gia_cong import KIEU_TRON_GOI
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.don_vi_do_repo import DonViDoRepository, nhan_don_vi
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository
from ..stock_request_service import StockRequestError
from . import TgcXungDot, kiem_version, nhan_dv_chang, so_lieu, so_ngoai, so_vi, thong_tin_lenh
from .noi_ve import _nhom_ids
from .phieu_giao import _req_svc

_EPS = 1e-9


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _lay(repo: ThueGiaCongRepository, don_dong_id: int, expected_version: int | None):
    """Khoá đơn rồi dòng. `expected_version` là version của ĐƠN (form mở từ ngăn đơn)."""
    dd = repo.dong_don(don_dong_id)
    if dd is None or dd.huy_luc is not None:
        raise ValueError("Không tìm thấy dòng đơn gia công (hoặc đã bỏ khỏi đơn).")
    don = repo.khoa_don(dd.don_id)
    if don is None or don.huy_luc is not None:
        raise ValueError("Đơn gia công đã huỷ.")
    if don.dat_luc is None:
        raise ValueError(f"Đơn {don.ma} còn nháp.")
    kiem_version(don, expected_version, f"Đơn {don.ma}")
    dd = repo.khoa_dong_don(don_dong_id)
    return don, dd


def ly_do_khong_hoan_tat(db: Session, dd) -> str | None:
    """Kho chưa xuất vật tư của phiếu giao ⇒ hàng chưa rời kho, hoàn tất là để đề nghị treo."""
    repo = ThueGiaCongRepository(db)
    svc = _req_svc(db)
    pg_ids = {x.phieu_id for x in repo.giao_dong_song([dd.id])}
    for ds in repo.de_nghi_cua_phieu_giao(pg_ids).values():
        for r in ds:
            if r.trang_thai not in (REQ_CANCELLED, REQ_REJECTED) and not svc.kho_da_lap_phieu(r):
                return (f"Kho chưa xuất đề nghị {r.ma} của phiếu giao — kho xuất xong, hoặc huỷ phiếu giao, "
                        "rồi mới hoàn tất.")
    return None


def hoan_tat(db: Session, *, user, don_dong_id: int, expected_version: int | None,
             tra_ve: list[dict] | None = None) -> dict:
    """`tra_ve` = `[{hang_loai, hang_id, kho_rong, kho_dai, so_luong}]` — vật tư nhà gia công trả về."""
    repo = ThueGiaCongRepository(db)
    don, dd = _lay(repo, don_dong_id, expected_version)
    if dd.hoan_tat_luc is not None:
        raise TgcXungDot("Dòng đơn vừa được hoàn tất — tải lại.")
    chan = ly_do_khong_hoan_tat(db, dd)
    if chan:
        raise ValueError(chan)
    v = repo.viec(dd.viec_id)
    s = so_lieu.cua_dong(db, [dd], {v.id: v})[dd.id]
    ten_dv = DonViDoRepository(db).ten_theo_ma()
    hao_hut = None
    if v.kieu != KIEU_TRON_GOI:
        hao_hut = round(max(float(s["giao_quy_doi"]) - float(s["dat"]) - float(s["hong"]), 0.0), 3)

    # Vật tư trả về: chỉ món đã xuất cho dòng này, không quá phần kho đã xuất thực.
    vt = {(m["hang_loai"], m["hang_id"], m["kho_rong"], m["kho_dai"]): m
          for m in so_ngoai.cua_dong(db, [dd.id])[dd.id]["vat_tu"]}
    lines: list[dict] = []
    tom_tra: list[str] = []
    for x in tra_ve or []:
        so = round(float(x.get("so_luong") or 0), 2)
        if so <= _EPS:
            continue
        k = (x.get("hang_loai"), int(x.get("hang_id") or 0), int(x.get("kho_rong") or 0), int(x.get("kho_dai") or 0))
        m = vt.get(k)
        if m is None:
            raise ValueError("Món trả về không nằm trong vật tư đã giao cho dòng này — tải lại.")
        if so > m["con_ngoai"] + _EPS:
            raise ValueError(f"“{m['ten']}” kho mới xuất {so_vi(m['xuat'])} {nhan_don_vi(ten_dv, m['don_vi'] or '')}"
                             f" — trả về không vượt số đó.")
        lines.append({"hang_loai": m["hang_loai"], "hang_id": m["hang_id"], "dvt": m["don_vi"],
                      "kho_rong": m["kho_rong"], "kho_dai": m["kho_dai"], "sl_de_nghi": so, "lsx_id": v.lsx_id})
        tom_tra.append(f"{m['ten']} {so_vi(so)} {nhan_don_vi(ten_dv, m['don_vi'] or '')}".strip())

    uid = getattr(user, "id", None)
    req = None
    if lines:
        ma_lenh = ", ".join(l["lsx_ma"] for l in thong_tin_lenh.cua_viec(db, [v]).get(v.id, []))
        try:
            req = _req_svc(db).create(
                user=user, loai=REQ_NHAP, lines=lines, commit=False,
                bo_phan_id=getattr(user, "department_id", None), tgc_don_dong_id=dd.id,
                ghi_chu=f"Vật tư dư nhà gia công {don.nha_cung_cap_ten} trả về — đơn {don.ma} — lệnh {ma_lenh}"[:1000])
        except StockRequestError as e:
            db.rollback()
            raise ValueError(str(e)) from None
    luc = _now()
    for cv in repo.cong_viec_cua_viec(v.id):
        cv.trang_thai = CV_HOAN_THANH
        cv.hoan_thanh_luc = luc
        cv.version += 1
    dd.hoan_tat_luc, dd.hoan_tat_boi_id, dd.hao_hut = luc, uid, hao_hut
    don.version += 1
    dv = nhan_dv_chang(ten_dv, s.get("don_vi_nhan") or "")
    detail = f"Hoàn tất {v.ten_viec} đơn {don.ma}: đạt {so_vi(s['dat'])} {dv}".replace("  ", " ")
    if hao_hut is not None:
        detail += f", hụt {so_vi(hao_hut)}"
    if tom_tra:
        detail += f". Trả kho {'; '.join(tom_tra)} ({req.ma})"
    AuditLogRepository(db).create(actor_user_id=uid, action="tgc_hoan_tat", target=f"tgc_don:{don.id}",
                                  detail=detail[:500], commit=False)
    db.commit()
    if req is not None:
        _req_svc(db).thong_bao_yeu_cau_moi(req)
        from .tron_goi import _bao_nhu_cau_doi

        _bao_nhu_cau_doi()
    return {"don_id": don.id, "don_dong_id": dd.id, "hao_hut": hao_hut,
            "de_nghi_tra": req.ma if req is not None else None}


def ly_do_khong_mo_lai(db: Session, dd) -> str | None:
    if dd.hoan_tat_luc is None:
        return None
    repo = ThueGiaCongRepository(db)
    svc = _req_svc(db)
    for r in repo.de_nghi_tra_cua_dong([dd.id])[dd.id]:
        if r.trang_thai not in (REQ_CANCELLED, REQ_REJECTED) and svc.kho_da_lap_phieu(r):
            return f"Kho đã lập phiếu nhập trả {r.ma} — không mở lại được."
    v = repo.viec(dd.viec_id)
    cvs = repo.cong_viec_cua_viec(dd.viec_id)
    sx = SanXuatRepository(db)
    for nhom_id in _nhom_ids(db, v, cvs[-1] if cvs else None) if v is not None else []:
        nhom = sx.nhom(nhom_id)
        if nhom is not None and nhom.trang_thai == NHOM_DONG:
            return "Lệnh đã đóng — mở lại lệnh trước rồi mới mở lại dòng đơn."
    return None


def mo_lai(db: Session, *, user, don_dong_id: int, expected_version: int | None) -> dict:
    repo = ThueGiaCongRepository(db)
    don, dd = _lay(repo, don_dong_id, expected_version)
    if dd.hoan_tat_luc is None:
        raise ValueError("Dòng đơn chưa hoàn tất.")
    chan = ly_do_khong_mo_lai(db, dd)
    if chan:
        raise ValueError(chan)
    huy = [r for r in repo.de_nghi_tra_cua_dong([dd.id])[dd.id] if r.trang_thai not in (REQ_CANCELLED, REQ_REJECTED)]
    for r in huy:
        r.trang_thai = REQ_CANCELLED
        r.ly_do_huy = f"Mở lại dòng đơn gia công {don.ma}"[:500]
    v = repo.viec(dd.viec_id)
    for cv in repo.cong_viec_cua_viec(dd.viec_id):
        cv.trang_thai = CV_PHAT_HANH
        cv.hoan_thanh_luc = None
        cv.version += 1
    dd.hoan_tat_luc = dd.hoan_tat_boi_id = dd.hao_hut = None
    don.version += 1
    uid = getattr(user, "id", None)
    AuditLogRepository(db).create(actor_user_id=uid, action="tgc_mo_hoan_tat", target=f"tgc_don:{don.id}",
                                  detail=f"Mở lại {v.ten_viec if v else ''} đơn {don.ma}"
                                         + (f", huỷ đề nghị nhập trả {', '.join(r.ma for r in huy)}" if huy else ""),
                                  commit=False)
    db.commit()
    svc = _req_svc(db)
    for r in huy:
        svc.thong_bao_da_huy(r)
    return {"don_id": don.id, "don_dong_id": dd.id}
