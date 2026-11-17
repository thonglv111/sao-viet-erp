"""ĐƠN GIA CÔNG (spec 2026-11-13 §4.2) — gộp Purchase Order + Subcontracting Order của ERPNext.

Một đơn = một nhà gia công, nhiều dòng; mỗi dòng là một VIỆC (một hoặc nhiều bước liền nhau của
một lệnh, hoặc bước chung bài ghép, hoặc trọn gói). Việc chỉ nằm trong tối đa MỘT dòng đơn sống.
Trạng thái đơn DẪN XUẤT từ phiếu giao / phiếu nhận / hoàn tất dòng, không lưu:
Nháp → Đã đặt → Đã giao một phần / Đã giao đủ → Đã về một phần → Hoàn tất; Huỷ.
Sửa đơn giá sau khi đặt được (ghi nhật ký), chỉ ảnh hưởng phiếu nhận lập sau (phiếu nhận chụp giá).
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from ... import audit_registry
from ...models.thue_gia_cong import KIEU_TRON_GOI, TgcDon, TgcDonDong
from ...models.vat_lieu_kho import HANG_GIAY
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.document_sequence_repo import DocumentSequenceRepository
from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository
from ..sequence_service import SequenceService
from . import TgcXungDot, kiem_version, so_lieu, so_vi, thong_tin_lenh

TT_NHAP = "nhap"
TT_DA_DAT = "da_dat"
TT_GIAO_MOT_PHAN = "giao_mot_phan"
TT_GIAO_DU = "giao_du"
TT_VE_MOT_PHAN = "ve_mot_phan"
TT_HOAN_TAT = "hoan_tat"
TT_HUY = "huy"
NHAN_TRANG_THAI = {
    TT_NHAP: "Nháp", TT_DA_DAT: "Đã đặt", TT_GIAO_MOT_PHAN: "Đã giao một phần",
    TT_GIAO_DU: "Đã giao đủ", TT_VE_MOT_PHAN: "Đã về một phần", TT_HOAN_TAT: "Hoàn tất",
    TT_HUY: "Đã huỷ",
}
TRANG_THAI = tuple(NHAN_TRANG_THAI)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uid(user) -> int | None:
    return getattr(user, "id", None)


def _tien(v) -> str:
    return f"{so_vi(round(float(v or 0)))}đ"


# --- Trạng thái dẫn xuất ------------------------------------------------------------------
def trang_thai(don: TgcDon, dongs, sl: dict[int, dict]) -> str:
    """`dongs` = dòng SỐNG của đơn, `sl` = `so_lieu.cua_dong` của chúng."""
    if don.huy_luc is not None:
        return TT_HUY
    if don.dat_luc is None:
        return TT_NHAP
    dongs = [d for d in dongs if d.huy_luc is None]
    if dongs and all(d.hoan_tat_luc is not None for d in dongs):
        return TT_HOAN_TAT
    s = [sl.get(d.id) or {} for d in dongs]
    if any(x.get("co_nhan") for x in s):
        return TT_VE_MOT_PHAN
    co_giao = [bool(x.get("co_giao")) for x in s]
    if not any(co_giao):
        return TT_DA_DAT

    def du(d, x) -> bool:
        if x.get("tron_goi"):
            return bool(x.get("co_giao"))
        return float(x.get("giao_quy_doi") or 0) >= float(d.sl_dat or 0) - 1e-9

    return TT_GIAO_DU if all(du(d, x) for d, x in zip(dongs, s)) else TT_GIAO_MOT_PHAN


# --- Kiểm tra chung ----------------------------------------------------------------------
def _nha(repo: ThueGiaCongRepository, nha_cung_cap_id: int):
    s = repo.nha_gia_cong(nha_cung_cap_id)
    if s is None:
        raise ValueError("Nhà gia công này đã bị bỏ khỏi danh sách — chọn nhà khác, hoặc gõ lại tên ở ô "
                         "Nhà gia công để thêm lại.")
    return s


def _so_dong(x: dict) -> tuple[int, float, float]:
    try:
        viec_id = int(x["viec_id"])
        sl_dat = float(x["sl_dat"])
        don_gia = float(x.get("don_gia") or 0)
    except (KeyError, TypeError, ValueError):
        raise ValueError("Dòng đơn thiếu việc, số đặt hoặc đơn giá.")
    if sl_dat <= 0:
        raise ValueError("Số đặt phải lớn hơn 0.")
    if don_gia < 0:
        raise ValueError("Đơn giá không được âm.")
    return viec_id, sl_dat, don_gia


def _nhan_viec(repo: ThueGiaCongRepository, viec_id: int, don_hien_tai: int | None = None):
    """Khoá việc; việc đã nằm trong dòng đơn sống KHÁC ⇒ xung đột (người khác vừa đặt)."""
    v = repo.khoa_viec(viec_id)
    if v is None:
        raise ValueError("Việc gia công không còn — tải lại Hàng chờ.")
    dang = repo.dong_song_cua_nhieu_viec([viec_id]).get(viec_id)
    if dang is not None and dang[1].id != don_hien_tai:
        raise TgcXungDot(f"Việc \"{v.ten_viec}\" đã nằm trong đơn {dang[1].ma} — tải lại Hàng chờ.")
    return v


def _bao_nhu_cau_doi() -> None:
    """Cờ cấp giấy đổi thì nhu cầu giấy của lệnh đổi theo (Kế hoạch vật tư nạp lại)."""
    from .tron_goi import _bao_nhu_cau_doi as bao

    bao()


def _cap_giay_gui(dong: list[dict]) -> dict[int, bool]:
    """`{viec_id: xuong_cap_giay}` của các dòng có gửi ô cấp giấy (None = giữ nguyên)."""
    out: dict[int, bool] = {}
    for x in dong:
        v = x.get("xuong_cap_giay")
        if v is not None:
            out[int(x["viec_id"])] = bool(v)
    return out


def _doi_cap_giay(repo: ThueGiaCongRepository, v, cap: bool, dong_don, ten: str) -> str | None:
    """Đổi "xưởng cấp giấy / nhà gia công tự lo" của việc TRỌN GÓI (13/11/2026: chọn ở đơn, lệnh chỉ
    gắn cờ). Việc khác bỏ qua. Đã có phiếu giao còn hiệu lực mang giấy thì chặn — huỷ phiếu giao
    trước. Trả câu nhật ký khi có đổi."""
    if v.kieu != KIEU_TRON_GOI or bool(v.xuong_cap_giay) == cap:
        return None
    if dong_don is not None and any(
            g.hang_loai == HANG_GIAY and g.lsx_cong_doan_vat_tu_id is None
            for g in repo.giao_dong_song([dong_don.id])):
        raise ValueError(f"Việc \"{ten}\" đã có phiếu giao mang giấy — huỷ phiếu giao đó rồi mới đổi "
                         "cách cấp giấy.")
    v.xuong_cap_giay = cap
    v.version = int(v.version or 0) + 1
    return f"giấy {ten}: {'nhà gia công tự lo → xưởng cấp' if cap else 'xưởng cấp → nhà gia công tự lo'}"


# --- Lập / đặt / sửa / huỷ ----------------------------------------------------------------
def tao(db: Session, *, user, nha_cung_cap_id: int, ngay_dat: date, ngay_hen_ve: date | None = None,
        ghi_chu: str | None = None, dong: list[dict], dat: bool = False) -> TgcDon:
    repo = ThueGiaCongRepository(db)
    nha = _nha(repo, nha_cung_cap_id)
    if not dong:
        raise ValueError("Chọn ít nhất một việc để lập đơn.")
    if ngay_hen_ve and ngay_hen_ve < ngay_dat:
        raise ValueError("Ngày hẹn về không được trước ngày đặt.")
    cap = [_so_dong(x) for x in dong]
    if len({c[0] for c in cap}) != len(cap):
        raise ValueError("Một việc chỉ được đặt một dòng trong đơn.")
    viecs = [_nhan_viec(repo, vid) for vid, _, _ in sorted(cap)]
    theo_id = {v.id: v for v in viecs}
    uid = _uid(user)
    don = TgcDon(
        ma=SequenceService(DocumentSequenceRepository(db)).generate_code("tgc_don"),
        nha_cung_cap_id=nha.id, nha_cung_cap_ten=nha.ten, ngay_dat=ngay_dat, ngay_hen_ve=ngay_hen_ve,
        ghi_chu=(ghi_chu or "").strip() or None, created_by=uid,
        dat_luc=_now() if dat else None, dat_boi_id=uid if dat else None,
    )
    db.add(don)
    db.flush()
    for i, (vid, sl_dat, don_gia) in enumerate(cap):
        v = theo_id[vid]
        db.add(TgcDonDong(don_id=don.id, viec_id=vid, sl_dat=sl_dat, don_gia=don_gia,
                          don_vi=v.don_vi, thu_tu=i))
    db.flush()
    audit = AuditLogRepository(db)
    nk = _ten_nhat_ky(db, theo_id.values())
    doi_giay = [c for vid, gt in _cap_giay_gui(dong).items() if vid in theo_id
                and (c := _doi_cap_giay(repo, theo_id[vid], gt, None, nk.get(vid, theo_id[vid].ten_viec)))]
    ten = "; ".join(nk[vid] for vid, _, _ in cap)
    them = f" ({'; '.join(doi_giay)})" if doi_giay else ""
    audit.create(actor_user_id=uid, action="tgc_don_tao", target=f"tgc_don:{don.id}",
                 detail=f"Lập đơn {don.ma} — {nha.ten}: {ten}{them}"[:500], commit=False)
    if dat:
        audit.create(actor_user_id=uid, action="tgc_don_dat", target=f"tgc_don:{don.id}",
                     detail=f"Đặt đơn {don.ma} với {nha.ten}"[:500], commit=False)
    db.commit()
    db.refresh(don)
    if doi_giay:
        _bao_nhu_cau_doi()
    return don


def dat(db: Session, *, user, don_id: int, expected_version: int | None) -> TgcDon:
    repo = ThueGiaCongRepository(db)
    don = repo.khoa_don(don_id)
    if don is None:
        raise ValueError("Không tìm thấy đơn gia công.")
    kiem_version(don, expected_version, f"Đơn {don.ma}")
    if don.huy_luc is not None:
        raise ValueError(f"Đơn {don.ma} đã huỷ.")
    if don.dat_luc is not None:
        raise ValueError(f"Đơn {don.ma} đã đặt rồi.")
    if not repo.dong_cua_don(don.id):
        raise ValueError("Đơn chưa có việc nào.")
    _nha(repo, don.nha_cung_cap_id)
    uid = _uid(user)
    don.dat_luc, don.dat_boi_id = _now(), uid
    don.version += 1
    AuditLogRepository(db).create(actor_user_id=uid, action="tgc_don_dat", target=f"tgc_don:{don.id}",
                                  detail=f"Đặt đơn {don.ma} với {don.nha_cung_cap_ten}", commit=False)
    db.commit()
    db.refresh(don)
    return don


def sua(db: Session, *, user, don_id: int, expected_version: int | None, nha_cung_cap_id: int,
        ngay_dat: date, ngay_hen_ve: date | None, ghi_chu: str | None, dong: list[dict]) -> TgcDon:
    """Gửi lên TOÀN BỘ đơn. Nháp sửa mọi thứ; đã đặt không đổi nhà / ngày đặt, chỉ sửa hẹn về,
    ghi chú, số đặt, đơn giá, thêm dòng, bỏ dòng chưa có phiếu giao / nhận."""
    repo = ThueGiaCongRepository(db)
    don = repo.khoa_don(don_id)
    if don is None:
        raise ValueError("Không tìm thấy đơn gia công.")
    kiem_version(don, expected_version, f"Đơn {don.ma}")
    if don.huy_luc is not None:
        raise ValueError(f"Đơn {don.ma} đã huỷ — không sửa được.")
    da_dat = don.dat_luc is not None
    thay: list[str] = []
    if int(nha_cung_cap_id) != int(don.nha_cung_cap_id):
        if da_dat:
            raise ValueError("Đơn đã đặt — không đổi nhà gia công. Huỷ đơn rồi lập đơn mới.")
        nha = _nha(repo, nha_cung_cap_id)
        thay.append(f"nhà gia công {don.nha_cung_cap_ten} → {nha.ten}")
        don.nha_cung_cap_id, don.nha_cung_cap_ten = nha.id, nha.ten
    if ngay_dat != don.ngay_dat:
        if da_dat:
            raise ValueError("Đơn đã đặt — không đổi ngày đặt.")
        thay.append(f"ngày đặt {don.ngay_dat:%d/%m/%Y} → {ngay_dat:%d/%m/%Y}")
        don.ngay_dat = ngay_dat
    if ngay_hen_ve and ngay_hen_ve < don.ngay_dat:
        raise ValueError("Ngày hẹn về không được trước ngày đặt.")
    if ngay_hen_ve != don.ngay_hen_ve:
        cu = f"{don.ngay_hen_ve:%d/%m/%Y}" if don.ngay_hen_ve else "trống"
        moi = f"{ngay_hen_ve:%d/%m/%Y}" if ngay_hen_ve else "trống"
        thay.append(f"hẹn về {cu} → {moi}")
        don.ngay_hen_ve = ngay_hen_ve
    gc = (ghi_chu or "").strip() or None
    if gc != don.ghi_chu:
        thay.append("ghi chú")
        don.ghi_chu = gc

    cap = [_so_dong(x) for x in dong]
    if not cap:
        raise ValueError("Đơn phải còn ít nhất một việc. Muốn bỏ hết thì huỷ đơn.")
    if len({c[0] for c in cap}) != len(cap):
        raise ValueError("Một việc chỉ được đặt một dòng trong đơn.")
    hien = {d.viec_id: d for d in repo.dong_cua_don(don.id)}
    sl = so_lieu.cua_dong(db, hien.values())
    viecs = repo.nhieu_viec(set(hien) | {c[0] for c in cap})
    gui = {vid: (sl_dat, don_gia) for vid, sl_dat, don_gia in cap}
    cap_giay = _cap_giay_gui(dong)
    doi_giay = False
    nk = _ten_nhat_ky(db, viecs.values())
    uid = _uid(user)
    audit = AuditLogRepository(db)
    # Bỏ dòng
    for vid, d in hien.items():
        if vid in gui:
            continue
        s = sl.get(d.id) or {}
        ten = nk.get(vid, f"#{vid}")
        if s.get("co_giao") or s.get("co_nhan") or d.hoan_tat_luc is not None:
            raise ValueError(f"Việc \"{ten}\" đã có phiếu giao hoặc phiếu nhận — không bỏ khỏi đơn được.")
        d.huy_luc = _now()
        thay.append(f"bỏ việc {ten}")
    # Thêm / sửa dòng
    thu_tu = max([d.thu_tu for d in hien.values()] + [-1]) + 1
    for vid, (sl_dat, don_gia) in gui.items():
        d = hien.get(vid)
        if d is None:
            v = _nhan_viec(repo, vid, don_hien_tai=don.id)
            db.add(TgcDonDong(don_id=don.id, viec_id=vid, sl_dat=sl_dat, don_gia=don_gia,
                              don_vi=v.don_vi, thu_tu=thu_tu))
            thu_tu += 1
            ten_moi = _ten_nhat_ky(db, [v]).get(v.id, v.ten_viec)
            thay.append(f"thêm việc {ten_moi}")
            if vid in cap_giay and (c := _doi_cap_giay(repo, v, cap_giay[vid], None, ten_moi)):
                thay.append(c)
                doi_giay = True
            continue
        ten = nk.get(vid, viecs[vid].ten_viec)
        if d.hoan_tat_luc is not None and (abs(float(d.sl_dat) - sl_dat) > 1e-9
                                           or abs(float(d.don_gia) - don_gia) > 1e-9):
            raise ValueError(f"Việc \"{ten}\" đã hoàn tất — mở lại hoàn tất trước khi sửa số.")
        if abs(float(d.sl_dat) - sl_dat) > 1e-9:
            thay.append(f"số đặt {ten} {so_vi(d.sl_dat)} → {so_vi(sl_dat)}")
            d.sl_dat = sl_dat
        if vid in cap_giay and (c := _doi_cap_giay(repo, viecs[vid], cap_giay[vid], d, ten)):
            thay.append(c)
            doi_giay = True
        if abs(float(d.don_gia) - don_gia) > 1e-9:
            cau = f"Đơn giá {ten}: {_tien(d.don_gia)} → {_tien(don_gia)}"
            if da_dat:
                audit.create(actor_user_id=uid, action="tgc_don_sua_don_gia", target=f"tgc_don:{don.id}",
                             detail=f"{don.ma} — {cau}. Phiếu nhận lập sau dùng giá mới."[:500],
                             commit=False)
            else:
                thay.append(cau[0].lower() + cau[1:])
            d.don_gia = don_gia
    if thay:
        audit.create(actor_user_id=uid, action="tgc_don_sua", target=f"tgc_don:{don.id}",
                     detail=f"Sửa đơn {don.ma}: {'; '.join(thay)}"[:500], commit=False)
    don.version += 1
    db.commit()
    db.refresh(don)
    if doi_giay:
        _bao_nhu_cau_doi()
    return don


def huy(db: Session, *, user, don_id: int, expected_version: int | None, ly_do: str) -> list[int]:
    """Huỷ đơn: mọi dòng huỷ theo ⇒ việc về Hàng chờ. Còn phiếu giao / phiếu nhận sống ⇒ chặn, nêu
    đích danh mã phiếu (ERPNext chặn huỷ đơn còn chứng từ liên kết). Trả lsx_ids để phát SSE."""
    repo = ThueGiaCongRepository(db)
    don = repo.khoa_don(don_id)
    if don is None:
        raise ValueError("Không tìm thấy đơn gia công.")
    kiem_version(don, expected_version, f"Đơn {don.ma}")
    if don.huy_luc is not None:
        raise ValueError(f"Đơn {don.ma} đã huỷ rồi.")
    ly_do = (ly_do or "").strip()
    if len(ly_do) < 3:
        raise ValueError("Ghi lý do huỷ (ít nhất 3 ký tự).")
    con = [p.ma for p in repo.phieu_giao_cua_don(don.id) if p.huy_luc is None] + \
          [p.ma for p in repo.phieu_nhan_cua_don(don.id) if p.huy_luc is None]
    if con:
        raise ValueError(f"Đơn {don.ma} còn phiếu {', '.join(con)} — huỷ các phiếu đó trước.")
    dongs = repo.dong_cua_don(don.id)
    lsx_ids = lsx_ids_cua_dong(db, dongs)
    luc, uid = _now(), _uid(user)
    don.huy_luc, don.huy_boi_id, don.ly_do_huy = luc, uid, ly_do[:500]
    for d in dongs:
        d.huy_luc = luc
    don.version += 1
    AuditLogRepository(db).create(actor_user_id=uid, action="tgc_don_huy", target=f"tgc_don:{don.id}",
                                  detail=f"Huỷ đơn {don.ma}. Lý do: {ly_do}"[:500], commit=False)
    db.commit()
    return lsx_ids


def _ten_nhat_ky(db: Session, viecs) -> dict[int, str]:
    """Tên việc kèm mã lệnh (hoặc bài ghép) cho câu nhật ký — hai lệnh cùng thuê "Gia công trọn gói"
    thì người đọc vẫn biết dòng nào."""
    viecs = [v for v in viecs if v is not None]
    repo = ThueGiaCongRepository(db)
    lenh = thong_tin_lenh.cua_viec(db, viecs)
    out = {}
    for v in viecs:
        if v.bai_ghep_id:
            bg = repo.bai_ghep(v.bai_ghep_id)
            kem = bg.ma if bg else None
        else:
            kem = ", ".join(l["lsx_ma"] for l in lenh.get(v.id, []) if l.get("lsx_ma")) or None
        out[v.id] = f"{v.ten_viec} ({kem})" if kem else v.ten_viec
    return out


def lsx_ids_cua_dong(db: Session, dongs) -> list[int]:
    viecs = list(ThueGiaCongRepository(db).nhieu_viec({d.viec_id for d in dongs}).values())
    return sorted({l["lsx_id"] for ds in thong_tin_lenh.cua_viec(db, viecs).values() for l in ds})


def goi_y_don_gia(db: Session, nha_cung_cap_id: int, ten_viec: str, bo_don_id: int | None = None) -> float | None:
    return ThueGiaCongRepository(db).don_gia_lan_truoc(nha_cung_cap_id, ten_viec, bo_don_id)


# --- Đọc --------------------------------------------------------------------------------
def _dong_dict(d: TgcDonDong, v, s: dict, lenh: list[dict], ma_bg: str | None) -> dict:
    return {
        "id": d.id, "viec_id": d.viec_id, "ten_viec": v.ten_viec if v else "", "kieu": v.kieu if v else "",
        "xuong_cap_giay": bool(v.xuong_cap_giay) if v else False,
        "sl_can": float(v.sl_can) if v is not None and v.sl_can is not None else None,
        "lenh": lenh, "bai_ghep_id": v.bai_ghep_id if v else None, "bai_ghep_ma": ma_bg,
        "sl_dat": float(d.sl_dat), "don_vi": d.don_vi, "don_gia": float(d.don_gia or 0),
        "thanh_tien_dat": round(float(d.sl_dat) * float(d.don_gia or 0)),
        "da_giao": s.get("da_giao", 0.0), "don_vi_giao": s.get("don_vi_giao"),
        "giao_quy_doi": s.get("giao_quy_doi", 0.0), "dat": s.get("dat", 0.0),
        "hong": s.get("hong", 0.0), "con_ngoai": s.get("con_ngoai", 0.0),
        "tam_tinh": s.get("tam_tinh", 0.0), "co_giao": bool(s.get("co_giao")),
        "co_nhan": bool(s.get("co_nhan")), "hoan_tat_luc": d.hoan_tat_luc,
        "hao_hut": float(d.hao_hut) if d.hao_hut is not None else None, "huy_luc": d.huy_luc,
    }


def nhieu_don_dict(db: Session, dons, *, chi_tiet: bool = False) -> list[dict]:
    dons = list(dons)
    if not dons:
        return []
    repo = ThueGiaCongRepository(db)
    theo_don = repo.dong_cua_nhieu_don([d.id for d in dons])
    hien_thi = {d.id: [x for x in theo_don[d.id] if x.huy_luc is None or d.huy_luc is not None]
                for d in dons}
    tat_ca = [x for ds in hien_thi.values() for x in ds]
    viecs = repo.nhieu_viec({x.viec_id for x in tat_ca})
    sl = so_lieu.cua_dong(db, tat_ca, viecs)
    lenh = thong_tin_lenh.cua_viec(db, viecs.values())
    ma_bg = {v.bai_ghep_id: (b.ma if (b := repo.bai_ghep(v.bai_ghep_id)) else None)
             for v in viecs.values() if v.bai_ghep_id}
    ten = repo.user_names({u for d in dons for u in (d.created_by, d.dat_boi_id, d.huy_boi_id)})
    out: list[dict] = []
    for d in dons:
        dongs = hien_thi[d.id]
        tt = trang_thai(d, dongs, sl)
        ds = [_dong_dict(x, viecs.get(x.viec_id), sl.get(x.id) or {}, lenh.get(x.viec_id, []),
                         ma_bg.get(viecs[x.viec_id].bai_ghep_id) if x.viec_id in viecs else None)
              for x in dongs]
        lenh_don: dict[int, dict] = {}
        for x in ds:
            for l in x["lenh"]:
                lenh_don.setdefault(l["lsx_id"], l)
        r = {
            "id": d.id, "ma": d.ma, "version": d.version, "nha_cung_cap_id": d.nha_cung_cap_id,
            "nha_cung_cap_ten": d.nha_cung_cap_ten, "ngay_dat": d.ngay_dat, "ngay_hen_ve": d.ngay_hen_ve,
            "ghi_chu": d.ghi_chu, "dat_luc": d.dat_luc, "nguoi_dat_ten": ten.get(d.dat_boi_id),
            "huy_luc": d.huy_luc, "nguoi_huy_ten": ten.get(d.huy_boi_id), "ly_do_huy": d.ly_do_huy,
            "created_at": d.created_at, "nguoi_tao_ten": ten.get(d.created_by),
            "trang_thai": tt, "nhan_trang_thai": NHAN_TRANG_THAI[tt],
            "dong": ds, "lenh": list(lenh_don.values()),
            "tong_tien_dat": sum(x["thanh_tien_dat"] for x in ds),
            "tam_tinh_da_nhan": round(sum(x["tam_tinh"] for x in ds), 2),
        }
        if chi_tiet:
            r.update(_chung_tu_va_lich_su(db, d))
            if d.dat_luc is not None and d.huy_luc is None:
                _them_hoan_tat(db, dongs, ds)
                from .phieu_giao import co_gi_de_giao
                r["co_gi_de_giao"] = co_gi_de_giao(db, d.id)
        out.append(r)
    return out


def _them_hoan_tat(db: Session, dongs, ds: list[dict]) -> None:
    """Ngăn đơn: lý do khoá nút Hoàn tất / Mở lại + vật tư đang ở nhà gia công (hộp Hoàn tất hỏi
    trả về bao nhiêu)."""
    from . import hoan_tat as ht
    from . import so_ngoai

    sn = so_ngoai.cua_dong(db, [x.id for x in dongs])
    for x, r in zip(dongs, ds):
        r["ly_do_khong_hoan_tat"] = ht.ly_do_khong_hoan_tat(db, x) if x.hoan_tat_luc is None else None
        r["ly_do_khong_mo_lai"] = ht.ly_do_khong_mo_lai(db, x) if x.hoan_tat_luc is not None else None
        r["vat_tu_ngoai"] = (sn.get(x.id) or {}).get("vat_tu", [])


def _chung_tu_va_lich_su(db: Session, don: TgcDon) -> dict:
    repo = ThueGiaCongRepository(db)
    pgs, pns = repo.phieu_giao_cua_don(don.id), repo.phieu_nhan_cua_don(don.id)
    ten = repo.user_names({p.nguoi_giao_id for p in pgs} | {p.nguoi_nhan_id for p in pns})
    targets = [f"tgc_don:{don.id}"] + [f"tgc_phieu_giao:{p.id}" for p in pgs] + \
              [f"tgc_phieu_nhan:{p.id}" for p in pns]
    nhat_ky = AuditLogRepository(db).list_by_targets(targets)
    dong = sorted((x for ds in nhat_ky.values() for x in ds), key=lambda x: (x.created_at, x.id),
                  reverse=True)
    return {
        "phieu_giao": [{"id": p.id, "ma": p.ma, "luc": p.giao_luc, "nguoi_ten": ten.get(p.nguoi_giao_id),
                        "huy_luc": p.huy_luc} for p in pgs],
        "phieu_nhan": [{"id": p.id, "ma": p.ma, "luc": p.nhan_luc, "nguoi_ten": ten.get(p.nguoi_nhan_id),
                        "huy_luc": p.huy_luc} for p in pns],
        "lich_su": [{"id": x.id, "luc": x.created_at, "nguoi_ten": x.actor_name_luc_do or "",
                     "hanh_dong": audit_registry.tra(x.action, x.target).nhan, "chi_tiet": x.detail or ""}
                    for x in dong],
    }


def don_dict(db: Session, don: TgcDon) -> dict:
    return nhieu_don_dict(db, [don], chi_tiet=True)[0]


def danh_sach(db: Session, *, tu_ngay=None, den_ngay=None, moc: str = "dat", q: str | None = None,
              trang_thai_loc: str | None = None, nha_cung_cap_id: int | None = None,
              page: int = 1, size: int = 25) -> dict:
    """Lọc kỳ / tìm / nhà ở câu SQL; trạng thái dẫn xuất nên đếm + lọc sau khi tính (số đơn một kỳ
    nhỏ). Cắt trang ở máy chủ."""
    dons = ThueGiaCongRepository(db).don_trong_ky(tu_ngay=tu_ngay, den_ngay=den_ngay, moc=moc, q=q,
                                                  nha_cung_cap_id=nha_cung_cap_id)
    rows = nhieu_don_dict(db, dons)
    facets = {k: sum(1 for r in rows if r["trang_thai"] == k) for k in TRANG_THAI}
    if trang_thai_loc:
        rows = [r for r in rows if r["trang_thai"] == trang_thai_loc]
    size = max(1, min(int(size or 25), 200))
    page = max(1, int(page or 1))
    return {"items": rows[(page - 1) * size: page * size], "total": len(rows), "page": page,
            "size": size, "facets": facets}
