"""PHIẾU NHẬN gia công (spec 2026-11-13 §4.4) — ERPNext "Subcontracting Receipt".

Một phiếu nhận thuộc một đơn ĐÃ ĐẶT, nhiều đợt. Mỗi dòng: dòng đơn, số đạt, số hỏng, nơi về.
  · Một phần: Σ (đạt + hỏng) không vượt "còn ngoài" = giao × ra ÷ vào (làm tròn lên) − đã nhận.
  · Trọn gói: không có số giao để chặn; vượt số đặt chỉ CẢNH BÁO (ngành in hay in dư).
  · Mỗi dòng một mẻ (tốt = đạt, hỏng = hỏng) trên công việc cuối của việc rồi rẽ nơi về (`noi_ve`).
    Công việc trên lệnh KHÔNG chuyển hoàn thành ở đây — chỉ khi Hoàn tất dòng đơn.
  · Tách vai (Q2): người đã lập phiếu giao còn hiệu lực của đơn không lập phiếu nhận của đơn đó,
    trừ khi cấu hình `TGC_CHAN_NGUOI_GIAO_TU_NHAN=false`.
  · Quyền: ô `thue_gia_cong:handover`, HOẶC mọi dòng về xưởng và người lập có quyền Xác nhận sản
    lượng ở tổ bước nhận (tổ bế nhận hàng cán màng về không cần quyền module).
  · Tiền công tạm tính = đạt × đơn giá CHỤP từ dòng đơn lúc nhận; hỏng không tính tiền.
Huỷ gỡ đúng những gì phiếu đẻ ra, khi chứng từ phía sau chưa chạy."""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from ...config import settings
from ...models.san_xuat_san_luong import SanXuatBatch
from ...models.stock_request import REQ_CANCELLED, REQ_REJECTED
from ...models.thue_gia_cong import (
    KIEU_TRON_GOI, NOI_VE, NOI_VE_KHACH, NOI_VE_KHO, NOI_VE_XUONG, TgcPhieuNhan, TgcPhieuNhanDong,
)
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.document_sequence_repo import DocumentSequenceRepository
from ...repositories.don_vi_do_repo import DonViDoRepository
from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository
from ..quyen_to import VIEC_XAC_NHAN, gate_to
from ..san_xuat import ban_giao
from ..san_xuat import kho as sx_kho
from ..sequence_service import SequenceService
from . import TgcXungDot, kiem_version, nhan_dv_chang, so_lieu, so_vi, thong_tin_lenh
from . import noi_ve as nv
from .giao_thang import huy_giao_thang
from .phieu_giao import _don_dat, _req_svc

_EPS = 1e-9
CHAN_TU_NHAN = ("Bạn đã lập phiếu giao của đơn này — người khác nhận hàng về (tách vai giao, nhận). "
                "Nhờ tổ bước sau, kho hoặc người có quyền Nhận hàng gia công.")
THIEU_QUYEN = ("Bạn cần quyền Nhận hàng của Thuê gia công, hoặc quyền Xác nhận sản lượng ở tổ nhận hàng "
               "(chỉ cho dòng về xưởng).")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uid(user) -> int | None:
    return getattr(user, "id", None)


def _xac_nhan_duoc(db: Session, uid: int | None, cv) -> bool:
    """Người này có quyền Xác nhận sản lượng ở tổ của công việc `cv` (bước nhận hàng)."""
    if cv is None or uid is None:
        return False
    try:
        gate_to(db, uid, cv.department_id, VIEC_XAC_NHAN, cong_viec_id=cv.id)
    except PermissionError:
        return False
    return True


def _canh_bao_tron_goi(ten: str, sl_dat: float, tong: float, dv: str) -> str | None:
    if tong > sl_dat + _EPS:
        return (f"“{ten}” đã nhận {so_vi(tong)} {dv}, vượt số đặt {so_vi(sl_dat)} {dv} "
                f"(dư {so_vi(tong - sl_dat)}). Vẫn lưu được — kiểm lại với nhà gia công.").replace("  ", " ")
    return None


def _ngu_canh(db: Session, repo: ThueGiaCongRepository, dongs):
    viecs = repo.nhieu_viec({d.viec_id for d in dongs})
    cvs = repo.cong_viec_cua_nhieu_viec(viecs.keys())
    return viecs, cvs, so_lieu.cua_dong(db, dongs, viecs)


# --- Dữ liệu điền sẵn ------------------------------------------------------------------------
def du_lieu_moi(db: Session, don_id: int, *, user, co_quyen_module: bool) -> dict:
    repo = ThueGiaCongRepository(db)
    don = _don_dat(repo, don_id)
    uid = _uid(user)
    dongs = [d for d in repo.dong_cua_don(don.id) if d.hoan_tat_luc is None]
    viecs, cvs, sl = _ngu_canh(db, repo, dongs)
    lenh = thong_tin_lenh.cua_viec(db, viecs.values())
    sl_repo = SanXuatSanLuongRepository(db)
    ten_dv = DonViDoRepository(db).ten_theo_ma()
    out = []
    for d in dongs:
        v = viecs[d.viec_id]
        ds_cv = cvs.get(v.id, [])
        cuoi = ds_cv[-1] if ds_cv else None
        chang_sau = sl_repo.cong_viec_chang_sau(cuoi) if cuoi is not None else []
        s = sl.get(d.id, {})
        tron_goi = v.kieu == KIEU_TRON_GOI
        hop_le = nv.noi_ve_hop_le(db, v, chang_sau) if cuoi is not None else []
        toa = v.bai_ghep_id is not None and cuoi is not None and nv.nhanh_bai_ghep(db, cuoi, chang_sau) == nv.NHANH_TOA
        buoc_sau = [] if toa else [{"cong_viec_id": c.id, "ten": c.ten_cong_doan,
                                    "xac_nhan_duoc": _xac_nhan_duoc(db, uid, c)} for c in chang_sau]
        # Dòng này người đang mở nhận được không: có quyền module, hoặc về xưởng (không toả) và có
        # quyền xác nhận ở ít nhất một bước sau.
        nhan_duoc = co_quyen_module or (hop_le == [NOI_VE_XUONG] and any(b["xac_nhan_duoc"] for b in buoc_sau))
        if not nhan_duoc:
            continue
        ly_do = None
        if cuoi is None:
            ly_do = "Việc không còn công việc trên lệnh — lệnh đã bị thu hồi?"
        elif not tron_goi and not s.get("co_giao"):
            ly_do = "Chưa giao bán thành phẩm cho nhà gia công — lập phiếu giao trước."
        dv = s.get("don_vi_nhan") or d.don_vi or (cuoi.don_vi_ra if cuoi else None)
        da_nhan = float(s.get("dat", 0)) + float(s.get("hong", 0))
        out.append({
            "don_dong_id": d.id, "viec_id": v.id, "ten_viec": v.ten_viec, "kieu": v.kieu,
            "lenh": lenh.get(v.id, []), "sl_dat": float(d.sl_dat), "don_vi": dv,
            "don_gia": float(d.don_gia or 0),
            "da_giao": s.get("da_giao", 0.0), "don_vi_giao": s.get("don_vi_giao"),
            "giao_quy_doi": s.get("giao_quy_doi", 0.0),
            "da_dat": float(s.get("dat", 0)), "da_hong": float(s.get("hong", 0)),
            "con_ngoai": None if tron_goi else float(s.get("con_ngoai", 0)),
            "canh_bao": _canh_bao_tron_goi(v.ten_viec, float(d.sl_dat), da_nhan, nhan_dv_chang(ten_dv, dv or ""))
            if tron_goi else None,
            "noi_ve_hop_le": hop_le, "buoc_sau": buoc_sau,
            "chia_theo_lenh": nv.chia_theo_lenh(db, v, cuoi, chang_sau) if cuoi is not None else [],
            "ly_do_khong_nhan": ly_do,
        })
    if not out and not co_quyen_module:
        raise PermissionError(THIEU_QUYEN)
    chan = (CHAN_TU_NHAN if settings.tgc_chan_nguoi_giao_tu_nhan and uid in repo.nguoi_giao_cua_don(don.id)
            else None)
    return {"don_id": don.id, "ma_don": don.ma, "version": don.version,
            "nha_cung_cap_ten": don.nha_cung_cap_ten, "chan_tu_nhan": chan, "dong": out}


# --- Lập ------------------------------------------------------------------------------------
def lap(db: Session, *, user, co_quyen_module: bool, don_id: int, expected_version: int | None,
        dong: list[dict], ghi_chu: str | None = None) -> tuple[TgcPhieuNhan, list[dict], list[str]]:
    """`dong` = `[{don_dong_id, sl_dat, sl_hong, noi_ve, dich_cong_viec_id?, ngay_khach_nhan?}]`.
    Trả `(phiếu, kết quả bàn giao cho bên nhận, câu cảnh báo)` — router phát SSE sau commit."""
    repo = ThueGiaCongRepository(db)
    don = _don_dat(repo, don_id, khoa=True)
    kiem_version(don, expected_version, f"Đơn {don.ma}")
    uid = _uid(user)
    if settings.tgc_chan_nguoi_giao_tu_nhan and uid in repo.nguoi_giao_cua_don(don.id):
        raise PermissionError(CHAN_TU_NHAN)
    theo_id = {d.id: d for d in repo.dong_cua_don(don.id)}
    viecs, cvs, sl = _ngu_canh(db, repo, list(theo_id.values()))
    sl_repo = SanXuatSanLuongRepository(db)
    ten_dv = DonViDoRepository(db).ten_theo_ma()

    # Kiểm hết trước khi ghi gì.
    ke_hoach: list[dict] = []
    dung: set[int] = set()
    for x in dong:
        dat = round(float(x.get("sl_dat") or 0), 3)
        hong = round(float(x.get("sl_hong") or 0), 3)
        if dat < 0 or hong < 0:
            raise ValueError("Số đạt, số hỏng không được âm.")
        if dat + hong <= _EPS:
            continue
        d = theo_id.get(int(x.get("don_dong_id") or 0))
        if d is None:
            raise ValueError("Dòng đơn không thuộc đơn này hoặc đã bỏ — tải lại đơn.")
        if d.id in dung:
            raise ValueError("Mỗi dòng đơn chỉ một dòng trên phiếu nhận.")
        dung.add(d.id)
        if d.hoan_tat_luc is not None:
            raise ValueError("Dòng đơn đã hoàn tất — mở lại hoàn tất trước khi nhận thêm.")
        v = viecs[d.viec_id]
        ds_cv = cvs.get(v.id, [])
        if not ds_cv:
            raise ValueError(f"Việc “{v.ten_viec}” không còn công việc trên lệnh — lệnh đã bị thu hồi?")
        cuoi = ds_cv[-1]
        chang_sau = sl_repo.cong_viec_chang_sau(cuoi)
        noi = x.get("noi_ve")
        if noi not in NOI_VE or noi not in nv.noi_ve_hop_le(db, v, chang_sau):
            raise ValueError(
                f"“{v.ten_viec}” còn bước sau trong xưởng — chỉ nhận về xưởng." if chang_sau else
                f"Nơi về không hợp lệ cho “{v.ten_viec}” — dải chứa bước cuối chỉ về kho, hoặc giao "
                "thẳng khi dòng đơn bán đứng riêng một cụm.")
        toa = v.bai_ghep_id is not None and nv.nhanh_bai_ghep(db, cuoi, chang_sau) == nv.NHANH_TOA
        dich = None
        if noi == NOI_VE_XUONG and not toa:
            dich = nv.chon_dich(chang_sau, x.get("dich_cong_viec_id"))
        xac_nhan_ngay = _xac_nhan_duoc(db, uid, dich)
        if not co_quyen_module and (noi != NOI_VE_XUONG or toa or not xac_nhan_ngay):
            raise PermissionError(THIEU_QUYEN)
        s = sl.get(d.id, {})
        dv = s.get("don_vi_nhan") or d.don_vi or cuoi.don_vi_ra or ""
        if v.kieu != KIEU_TRON_GOI:
            if not s.get("co_giao"):
                raise ValueError(f"Chưa giao bán thành phẩm của “{v.ten_viec}” cho nhà gia công — lập phiếu giao trước.")
            con = float(s.get("con_ngoai", 0))
            if dat + hong > con + _EPS:
                raise ValueError(
                    f"“{v.ten_viec}” chỉ còn {so_vi(con)} {nhan_dv_chang(ten_dv, dv)} ở nhà gia công — "
                    f"đạt + hỏng ({so_vi(dat + hong)}) vượt số còn ngoài.")
        ngay_kn = x.get("ngay_khach_nhan")
        if isinstance(ngay_kn, str) and ngay_kn:
            ngay_kn = date.fromisoformat(ngay_kn)
        ke_hoach.append({"d": d, "v": v, "cuoi": cuoi, "chang_sau": chang_sau, "noi": noi, "dich": dich,
                         "dat": dat, "hong": hong, "dv": dv, "xac_nhan_ngay": xac_nhan_ngay,
                         "ngay_kn": ngay_kn if noi == NOI_VE_KHACH else None, "s": s})
    if not ke_hoach:
        raise ValueError("Phiếu nhận chưa có dòng nào — gõ số đạt hoặc số hỏng.")

    pn = TgcPhieuNhan(ma=SequenceService(DocumentSequenceRepository(db)).generate_code("tgc_phieu_nhan"),
                      don_id=don.id, nguoi_nhan_id=uid, ghi_chu=(ghi_chu or "").strip() or None)
    db.add(pn)
    db.flush()
    luc = _now()
    bgs: list[tuple] = []
    reqs: list = []
    tom_tat: list[str] = []
    canh_bao: list[str] = []
    for k in ke_hoach:
        d, v, cuoi = k["d"], k["v"], k["cuoi"]
        me = SanXuatBatch(cong_viec_id=cuoi.id, bat_dau=luc, ket_thuc=luc, tong=k["dat"] + k["hong"],
                          tot=k["dat"], hong=k["hong"], don_vi=(cuoi.don_vi_ra or k["dv"] or "").strip(),
                          ghi_chu=f"Phiếu nhận gia công {pn.ma} — {don.nha_cung_cap_ten}"[:500],
                          created_by=uid)
        db.add(me)
        db.flush()
        db.add(TgcPhieuNhanDong(phieu_id=pn.id, don_dong_id=d.id, sl_dat=k["dat"], sl_hong=k["hong"],
                                don_gia=float(d.don_gia or 0), noi_ve=k["noi"],
                                dich_cong_viec_id=k["dich"].id if k["dich"] is not None else None,
                                ngay_khach_nhan=k["ngay_kn"], batch_id=me.id))
        if k["dat"] > _EPS:
            kq = nv.ghi(db, user=user, don=don, viec=v, cuoi=cuoi, me=me, so=k["dat"], chang_sau=k["chang_sau"],
                        noi_ve=k["noi"], dich=k["dich"], phieu_nhan_id=pn.id,
                        xac_nhan_ngay=k["xac_nhan_ngay"], ngay_khach_nhan=k["ngay_kn"])
            bgs.extend((bg, cuoi) for bg in kq["ban_giao"])
            reqs.extend(kq["yeu_cau_khos"])
        dv_ten = nhan_dv_chang(ten_dv, k["dv"])
        noi_txt = nv.NHAN_NOI_VE[k["noi"]] + (f" ({k['dich'].ten_cong_doan})" if k["dich"] is not None else "")
        ma_lenh = ", ".join(l["lsx_ma"] for l in thong_tin_lenh.cua_viec(db, [v]).get(v.id, []))
        tom_tat.append(f"{v.ten_viec} ({ma_lenh}) đạt {so_vi(k['dat'])}, hỏng {so_vi(k['hong'])} {dv_ten} {noi_txt}"
                       .replace("  ", " "))
        if v.kieu == KIEU_TRON_GOI:
            tong = float(k["s"].get("dat", 0)) + float(k["s"].get("hong", 0)) + k["dat"] + k["hong"]
            cb = _canh_bao_tron_goi(v.ten_viec, float(d.sl_dat), tong, dv_ten)
            if cb:
                canh_bao.append(cb)
    don.version += 1
    AuditLogRepository(db).create(
        actor_user_id=uid, action="tgc_phieu_nhan_tao", target=f"tgc_phieu_nhan:{pn.id}",
        detail=(f"Phiếu nhận {pn.ma} cho đơn {don.ma} ({don.nha_cung_cap_ten}): {'; '.join(tom_tat)}"
                + (f". Đề nghị nhập {', '.join(r.ma for r in reqs)}" if reqs else ""))[:500], commit=False)
    db.commit()
    db.refresh(pn)
    for r in reqs:
        sx_kho.bao_yeu_cau_nhap_moi(db, r)
    ket_qua = []
    for bg, cuoi in bgs:
        dich = sl_repo.cong_viec(bg.dich_cong_viec_id)
        ket_qua.append(ban_giao.ket_qua_cho_ben_nhan(db, user=user, bg=bg, nguon_cv=cuoi, dich_cv=dich))
    return pn, ket_qua, canh_bao


# --- Huỷ ------------------------------------------------------------------------------------
def ly_do_khong_huy(db: Session, pn, *, dongs=None, pc: str | None = None) -> str | None:
    """Lý do máy chủ SẼ từ chối huỷ — CHỈ ĐỌC, cùng các cửa của `huy`. FE khoá nút kèm lý do."""
    if pn.huy_luc is not None:
        return None
    repo = ThueGiaCongRepository(db)
    if pc is None:
        pc = repo.phieu_chi_song_cua_phieu_nhan([pn.id]).get(pn.id)
    if pc:
        return f"Kế toán đã lập phiếu chi {pc} — huỷ phiếu chi trước rồi mới huỷ phiếu nhận."
    dongs = repo.dong_phieu_nhan([pn.id])[pn.id] if dongs is None else dongs
    dds = {d.id: d for d in repo.dong_cua_don(pn.don_id, ca_huy=True)}
    viecs = repo.nhieu_viec({d.viec_id for d in dds.values()})
    cvs = repo.cong_viec_cua_nhieu_viec(viecs.keys())
    for x in dongs:
        dd = dds.get(x.don_dong_id)
        if dd is None:
            continue
        v = viecs.get(dd.viec_id)
        if dd.hoan_tat_luc is not None:
            return f"Dòng “{v.ten_viec if v else ''}” đã hoàn tất — mở lại hoàn tất trước."
        ds = cvs.get(dd.viec_id, [])
        ly_do = nv.ly_do_khong_go(db, dong=x, viec=v, cuoi=ds[-1] if ds else None, nguoi_nhan_id=pn.nguoi_nhan_id)
        if ly_do:
            return ly_do
    svc = _req_svc(db)
    for r in repo.de_nghi_cua_phieu_nhan([pn.id])[pn.id]:
        if r.trang_thai not in (REQ_CANCELLED, REQ_REJECTED) and svc.kho_da_lap_phieu(r):
            return f"Kho đã lập phiếu cho đề nghị nhập {r.ma} — không huỷ được phiếu nhận."
    return None


def huy(db: Session, *, user, phieu_id: int, expected_version: int | None, ly_do: str) -> TgcPhieuNhan:
    repo = ThueGiaCongRepository(db)
    pn = repo.khoa_phieu_nhan(phieu_id)
    if pn is None:
        raise ValueError("Không tìm thấy phiếu nhận.")
    kiem_version(pn, expected_version, f"Phiếu nhận {pn.ma}")
    if pn.huy_luc is not None:
        raise ValueError(f"Phiếu nhận {pn.ma} đã huỷ rồi.")
    ly_do = (ly_do or "").strip()
    if len(ly_do) < 3:
        raise ValueError("Ghi lý do huỷ (ít nhất 3 ký tự).")
    dongs = repo.dong_phieu_nhan([pn.id])[pn.id]
    chan = ly_do_khong_huy(db, pn, dongs=dongs)
    if chan:
        raise ValueError(chan)
    for x in dongs:
        nv.go(db, dong=x)
    reqs = [r for r in repo.de_nghi_cua_phieu_nhan([pn.id])[pn.id]
            if r.trang_thai not in (REQ_CANCELLED, REQ_REJECTED)]
    for r in reqs:
        r.trang_thai = REQ_CANCELLED
        r.ly_do_huy = f"Huỷ phiếu nhận gia công {pn.ma}"[:500]
    huy_giao_thang(db, user=user, phieu_nhan_id=pn.id, ly_do=f"Huỷ phiếu nhận gia công {pn.ma}")
    uid = _uid(user)
    pn.huy_luc, pn.huy_boi_id, pn.ly_do_huy = _now(), uid, ly_do[:500]
    pn.version += 1
    don = repo.don(pn.don_id)
    if don is not None:
        don.version += 1
    AuditLogRepository(db).create(actor_user_id=uid, action="tgc_phieu_nhan_huy", target=f"tgc_phieu_nhan:{pn.id}",
                                  detail=f"Huỷ phiếu nhận {pn.ma}. Lý do: {ly_do}"[:500], commit=False)
    db.commit()
    for r in reqs:
        sx_kho.bao_yeu_cau_da_huy(db, r)
    return pn


# --- Đọc ------------------------------------------------------------------------------------
def nhieu_dict(db: Session, phieus) -> list[dict]:
    phieus = list(phieus)
    if not phieus:
        return []
    repo = ThueGiaCongRepository(db)
    ids = [p.id for p in phieus]
    dongs = repo.dong_phieu_nhan(ids)
    reqs = repo.de_nghi_cua_phieu_nhan(ids)
    pcs = repo.phieu_chi_song_cua_phieu_nhan(ids)
    dons = repo.nhieu_don({p.don_id for p in phieus})
    dds = {d.id: d for ds in repo.dong_cua_nhieu_don(dons.keys()).values() for d in ds}
    viecs = repo.nhieu_viec({d.viec_id for d in dds.values()})
    cvs = repo.cong_viec_cua_nhieu_viec(viecs.keys())
    lenh = thong_tin_lenh.cua_viec(db, viecs.values())
    ten = repo.user_names({u for p in phieus for u in (p.nguoi_nhan_id, p.huy_boi_id)})
    sl_repo = SanXuatSanLuongRepository(db)
    ten_dv = DonViDoRepository(db).ten_theo_ma()
    svc = _req_svc(db)
    out = []
    for p in phieus:
        don = dons.get(p.don_id)
        ds = dongs.get(p.id, [])
        lenh_p: dict[int, dict] = {}
        dong_out = []
        for x in ds:
            dd = dds.get(x.don_dong_id)
            v = viecs.get(dd.viec_id) if dd else None
            for l in lenh.get(dd.viec_id, []) if dd else []:
                lenh_p.setdefault(l["lsx_id"], l)
            cv_ds = cvs.get(dd.viec_id, []) if dd else []
            dv = (dd.don_vi if dd and dd.don_vi else (cv_ds[-1].don_vi_ra if cv_ds else None))
            dich = sl_repo.cong_viec(x.dich_cong_viec_id) if x.dich_cong_viec_id else None
            bg = sl_repo.ban_giao_cua_me(x.batch_id) if x.batch_id and x.noi_ve == NOI_VE_XUONG else None
            dong_out.append({
                "id": x.id, "don_dong_id": x.don_dong_id, "ten_viec": v.ten_viec if v else "",
                "kieu": v.kieu if v else None,
                "sl_dat": float(x.sl_dat), "sl_hong": float(x.sl_hong), "don_vi": dv,
                "don_vi_ten": nhan_dv_chang(ten_dv, dv or ""),
                "don_gia": float(x.don_gia or 0), "thanh_tien": round(float(x.sl_dat) * float(x.don_gia or 0), 2),
                "noi_ve": x.noi_ve, "dich_ten": dich.ten_cong_doan if dich else None,
                "ngay_khach_nhan": x.ngay_khach_nhan,
                "ban_giao_trang_thai": bg.trang_thai if bg is not None else None,
            })
        de_nghi = [{"id": r.id, "ma": r.ma, "trang_thai": r.trang_thai, "da_lap_phieu": svc.kho_da_lap_phieu(r)}
                   for r in reqs.get(p.id, [])]
        out.append({
            "id": p.id, "ma": p.ma, "version": p.version, "don_id": p.don_id,
            "ma_don": don.ma if don else "", "nha_cung_cap_id": don.nha_cung_cap_id if don else None,
            "nha_cung_cap_ten": don.nha_cung_cap_ten if don else "",
            "nhan_luc": p.nhan_luc, "nguoi_nhan_ten": ten.get(p.nguoi_nhan_id), "ghi_chu": p.ghi_chu,
            "huy_luc": p.huy_luc, "nguoi_huy_ten": ten.get(p.huy_boi_id), "ly_do_huy": p.ly_do_huy,
            "created_at": p.created_at, "lenh": list(lenh_p.values()), "de_nghi": de_nghi,
            "tam_tinh": round(sum(d["thanh_tien"] for d in dong_out), 2),
            "phieu_chi_ma": pcs.get(p.id),
            "ly_do_khong_huy": ly_do_khong_huy(db, p, dongs=ds, pc=pcs.get(p.id) or ""),
            "dong": dong_out,
        })
    return out


def danh_sach(db: Session, *, tu_ngay=None, den_ngay=None, q: str | None = None,
              nha_cung_cap_id: int | None = None, con_hieu_luc: bool | None = None,
              page: int = 1, size: int = 25) -> dict:
    ds = ThueGiaCongRepository(db).phieu_nhan_trong_ky(tu_ngay=tu_ngay, den_ngay=den_ngay, q=q,
                                                       nha_cung_cap_id=nha_cung_cap_id)
    facets = {"con_hieu_luc": sum(1 for p in ds if p.huy_luc is None),
              "da_huy": sum(1 for p in ds if p.huy_luc is not None)}
    if con_hieu_luc is not None:
        ds = [p for p in ds if (p.huy_luc is None) == con_hieu_luc]
    size = max(1, min(int(size or 25), 200))
    page = max(1, int(page or 1))
    return {"items": nhieu_dict(db, ds[(page - 1) * size: page * size]), "total": len(ds), "page": page,
            "size": size, "facets": facets}


def lsx_ids_cua_phieu(db: Session, pn) -> list[int]:
    from .don import lsx_ids_cua_dong

    return lsx_ids_cua_dong(db, ThueGiaCongRepository(db).dong_cua_don(pn.don_id, ca_huy=True))


__all__ = ["du_lieu_moi", "lap", "huy", "nhieu_dict", "danh_sach", "ly_do_khong_huy", "TgcXungDot"]
