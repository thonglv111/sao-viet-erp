"""PHIẾU GIAO gia công (spec 2026-11-13 §4.3) — ERPNext "Send to Subcontractor".

Một phiếu giao thuộc một đơn ĐÃ ĐẶT, gồm:
  · bán thành phẩm — KHÔNG qua kho (SVN không theo dõi tồn bán thành phẩm): số lấy đúng bàn giao
    tổ bước trước đã đề xuất sang công việc đầu của việc, không gõ tay; lưu phiếu = xác nhận các bàn
    giao đó. Dải đứng đầu lệnh (không bước trước) thì gõ số.
  · vật tư xưởng cấp — dòng vật tư của các bước trong dải bỏ tick "Nhà gia công tự lo"; đi qua MỘT
    đề nghị XUẤT kho mang `tgc_phieu_giao_id` (dòng mang `lsx_id`), kho lập phiếu xuất như thường.
    Không chặn vượt định mức — bù hao do người giao quyết.
  · giấy trọn gói xưởng cấp — chọn khổ (C1) ngay trên phiếu, thành một dòng của đề nghị xuất đó.
Huỷ được khi kho chưa lập phiếu xuất và chưa có phiếu nhận sống lập sau: huỷ đề nghị, bàn giao về
"đề xuất" (việc lại "Sẵn sàng giao")."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ...models.san_xuat_san_luong import BG_DE_XUAT
from ...models.stock_request import REQ_CANCELLED, REQ_REJECTED, REQ_XUAT
from ...models.thue_gia_cong import (
    KIEU_TRON_GOI, LOAI_BAN_THANH_PHAM, LOAI_VAT_TU, TgcPhieuGiao, TgcPhieuGiaoDong,
)
from ...models.vat_lieu_kho import HANG_GIAY
from ...repositories.audit_repo import AuditLogRepository
from ...repositories.document_sequence_repo import DocumentSequenceRepository
from ...repositories.don_vi_do_repo import DonViDoRepository, nhan_don_vi
from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from ...repositories.stock_lot_repo import StockLotRepository
from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository
from ..kho_giay import chuan_kho, co_don_vi_goc, don_vi_goc_to, khoa_ton, la_ma_to_giay, nhan_kho
from ..san_xuat import ban_giao
from ..sequence_service import SequenceService
from ..stock_request_service import StockRequestError
from . import TgcXungDot, kiem_version, nhan_dv_chang, so_lieu, so_vi, thong_tin_lenh
from .giay import goi_y_cap_giay
from .hang_cho import _co_buoc_truoc

_EPS = 1e-9


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _req_svc(db: Session):
    from ..san_xuat.vat_tu_de_nghi import _hang_service, _req_service

    return _req_service(db, _hang_service(db))


def _dvt_kho(hang_loai: str, dvt: str) -> str:
    """Dòng giấy của lệnh mang MÃ CHẶNG (`to_nguyen`…); qua cửa kho mọi mã tờ là một "tờ"."""
    if hang_loai == HANG_GIAY and la_ma_to_giay(dvt):
        return don_vi_goc_to()
    return dvt


def _don_dat(repo: ThueGiaCongRepository, don_id: int, *, khoa: bool = False):
    don = repo.khoa_don(don_id) if khoa else repo.don(don_id)
    if don is None:
        raise ValueError("Không tìm thấy đơn gia công.")
    if don.huy_luc is not None:
        raise ValueError(f"Đơn {don.ma} đã huỷ.")
    if don.dat_luc is None:
        raise ValueError(f"Đơn {don.ma} còn nháp — đặt hàng rồi mới giao được.")
    return don


# --- Dữ liệu điền sẵn ------------------------------------------------------------------------
def _khoa_ton_vat_tu(x) -> tuple:
    """Khoá tra tồn của một dòng vật tư xưởng cấp — cùng đơn vị, cùng khổ như dòng đề nghị xuất kho
    mà `lap` sẽ tạo (giấy theo mã chặng quy về "tờ")."""
    loai, hid = x.hang_loai, int(x.vat_tu_id)
    if not co_don_vi_goc(loai):
        return (loai, hid)
    return khoa_ton(loai, hid, goc=_dvt_kho(loai, x.don_vi_snapshot or ""),
                    kho_rong=int(x.kho_rong or 0), kho_dai=int(x.kho_dai or 0))


def du_lieu_moi(db: Session, don_id: int, *, kho_xem: set[int] | None = None) -> dict:
    """`kho_xem` = các kho người gọi được xem số tồn (`quyen_kho.kho_duoc`): tồn chỉ cộng lô ở các kho
    đó; rỗng thì mọi ô `ton` là None — số không rời máy chủ, chỉ còn khổ để chọn. None = mọi kho."""
    xem_ton = kho_xem is None or bool(kho_xem)
    repo = ThueGiaCongRepository(db)
    don = _don_dat(repo, don_id)
    dongs = [d for d in repo.dong_cua_don(don.id) if d.hoan_tat_luc is None]
    viecs = repo.nhieu_viec({d.viec_id for d in dongs})
    cvs = repo.cong_viec_cua_nhieu_viec(viecs.keys())
    sl = so_lieu.cua_dong(db, dongs, viecs)
    lenh = thong_tin_lenh.cua_viec(db, viecs.values())
    sx = SanXuatSanLuongRepository(db)
    lots = StockLotRepository(db)
    out = []
    for d in dongs:
        v = viecs[d.viec_id]
        ds_cv = cvs.get(v.id, [])
        dau = ds_cv[0] if ds_cv else None
        btp = None
        if v.kieu != KIEU_TRON_GOI and dau is not None:
            cho = repo.ban_giao_cho_nhan(dau.id)
            btp = {
                "don_vi": dau.don_vi_vao,
                "ban_giao": [{"ban_giao_id": b.id, "so_luong": float(b.so_luong), "don_vi": b.don_vi,
                              "nguon_ten": (n.ten_cong_doan if (n := sx.cong_viec(b.nguon_cong_viec_id)) else ""),
                              "luc": b.de_xuat_luc} for b in cho],
                "go_tay": not cho and not _co_buoc_truoc(repo, dau),
                "cho_buoc_truoc": not cho and _co_buoc_truoc(repo, dau),
            }
        vts = repo.vat_tu_xuong_cap({c.lsx_cong_doan_id for c in ds_cv if c.lsx_cong_doan_id})
        ds_vt = [x for c in ds_cv for x in vts.get(c.lsx_cong_doan_id or 0, [])]
        da = repo.da_giao_vat_tu([x.id for x in ds_vt])
        ton: dict = {}
        if xem_ton and ds_vt:
            theo_kho = lots.on_hand_by_kho(sorted({_khoa_ton_vat_tu(x) for x in ds_vt}))
            ton = {k: sum(sl for kid, sl in m.items() if kho_xem is None or kid in kho_xem)
                   for k, m in theo_kho.items()}
        giay = goi_y_cap_giay(db, v, kho_xem) if v.kieu == KIEU_TRON_GOI else None
        if giay and not xem_ton:
            giay["kho"] = [{**k, "ton": None} for k in giay["kho"]]
        out.append({
            "don_dong_id": d.id, "viec_id": v.id, "ten_viec": v.ten_viec, "kieu": v.kieu,
            "lenh": lenh.get(v.id, []), "sl_dat": float(d.sl_dat), "don_vi": d.don_vi,
            "da_giao": sl.get(d.id, {}).get("da_giao", 0.0), "ban_thanh_pham": btp,
            "vat_tu": [{
                "lsx_cong_doan_vat_tu_id": x.id, "hang_loai": x.hang_loai, "hang_id": int(x.vat_tu_id),
                "ten": x.vat_tu_ten_snapshot, "ma": x.vat_tu_ma_snapshot, "don_vi": x.don_vi_snapshot,
                "kho_rong": int(x.kho_rong or 0), "kho_dai": int(x.kho_dai or 0),
                "dinh_muc": float(x.so_luong), "da_giao": da.get(x.id, 0.0),
                "goi_y": round(max(float(x.so_luong) - da.get(x.id, 0.0), 0.0), 3),
                "lsx_id": v.lsx_id,
                "ton": ton.get(_khoa_ton_vat_tu(x), 0.0) if xem_ton else None,
            } for x in ds_vt],
            "giay": giay,
        })
    return {"don_id": don.id, "ma_don": don.ma, "version": don.version,
            "nha_cung_cap_ten": don.nha_cung_cap_ten, "xem_ton": xem_ton, "dong": out}


def co_gi_de_giao(db: Session, don_id: int) -> bool:
    """Đơn còn thứ xưởng phải mang sang nhà gia công không (16/11/2026) — cùng luật `du_lieu_moi`:
    dòng chưa hoàn tất có bán thành phẩm (việc một phần có bước đầu), giấy trọn gói xưởng cấp, hoặc
    vật tư xưởng cấp. Trọn gói nhà gia công tự lo giấy, không vật tư xưởng cấp ⇒ False: ngăn đơn làm
    mờ nút Giao hàng thay vì mở một hộp trống."""
    repo = ThueGiaCongRepository(db)
    dongs = [d for d in repo.dong_cua_don(don_id) if d.hoan_tat_luc is None]
    if not dongs:
        return False
    viecs = repo.nhieu_viec({d.viec_id for d in dongs})
    cvs = repo.cong_viec_cua_nhieu_viec(viecs.keys())
    for v in viecs.values():
        if v.kieu == KIEU_TRON_GOI and v.xuong_cap_giay:
            return True
        if v.kieu != KIEU_TRON_GOI and cvs.get(v.id):
            return True
    cd_ids = {c.lsx_cong_doan_id for ds in cvs.values() for c in ds if c.lsx_cong_doan_id}
    return any(repo.vat_tu_xuong_cap(cd_ids).values()) if cd_ids else False


# --- Lập ------------------------------------------------------------------------------------
def lap(db: Session, *, user, don_id: int, expected_version: int | None, dong: list[dict],
        ghi_chu: str | None = None) -> tuple[TgcPhieuGiao, list[dict]]:
    """`dong` = `[{don_dong_id, giao_ban_thanh_pham: bool, sl_go: float|None,
    vat_tu: [{lsx_cong_doan_vat_tu_id, so_luong}], giay: {kho_rong, kho_dai, so_luong}|None}]`.
    Trả `(phiếu, kết quả bàn giao đã nhận)` — router phát SSE cho tổ nguồn."""
    repo = ThueGiaCongRepository(db)
    don = _don_dat(repo, don_id, khoa=True)
    kiem_version(don, expected_version, f"Đơn {don.ma}")
    theo_id = {d.id: d for d in repo.dong_cua_don(don.id)}
    viecs = repo.nhieu_viec({d.viec_id for d in theo_id.values()})
    cvs = repo.cong_viec_cua_nhieu_viec(viecs.keys())
    uid = getattr(user, "id", None)
    pg = TgcPhieuGiao(ma=SequenceService(DocumentSequenceRepository(db)).generate_code("tgc_phieu_giao"),
                      don_id=don.id, nguoi_giao_id=uid, ghi_chu=(ghi_chu or "").strip() or None)
    db.add(pg)
    db.flush()
    dong_pg: list[TgcPhieuGiaoDong] = []
    req_lines: list[dict] = []
    da_nhan: list[tuple] = []
    tom_tat: list[str] = []
    ten_dv = DonViDoRepository(db).ten_theo_ma()
    sx = SanXuatSanLuongRepository(db)
    for x in dong:
        d = theo_id.get(int(x.get("don_dong_id") or 0))
        if d is None:
            raise ValueError("Dòng đơn không thuộc đơn này hoặc đã bỏ — tải lại đơn.")
        if d.hoan_tat_luc is not None:
            raise ValueError("Dòng đơn đã hoàn tất — mở lại hoàn tất trước khi giao thêm.")
        v = viecs[d.viec_id]
        ds_cv = cvs.get(v.id, [])
        dau = ds_cv[0] if ds_cv else None
        # Bán thành phẩm
        if x.get("giao_ban_thanh_pham") and v.kieu != KIEU_TRON_GOI:
            if dau is None:
                raise ValueError(f"Việc \"{v.ten_viec}\" không còn công việc trên lệnh — lệnh đã bị thu hồi?")
            cho = repo.ban_giao_cho_nhan(dau.id, khoa=True)
            sl_go = x.get("sl_go")
            if cho:
                if sl_go not in (None, 0, 0.0):
                    raise ValueError("Số bán thành phẩm lấy theo bàn giao của tổ bước trước, không gõ tay.")
                for bg in cho:
                    ban_giao.ghi_xac_nhan(db, bg=bg, user=user)
                    dong_pg.append(TgcPhieuGiaoDong(phieu_id=pg.id, don_dong_id=d.id, loai=LOAI_BAN_THANH_PHAM,
                                                    so_luong=float(bg.so_luong), don_vi=bg.don_vi,
                                                    ban_giao_id=bg.id))
                    da_nhan.append((bg, sx.cong_viec(bg.nguon_cong_viec_id), dau))
                tong = sum(float(b.so_luong) for b in cho)
                tom_tat.append(f"{v.ten_viec} {so_vi(tong)} {nhan_dv_chang(ten_dv, cho[0].don_vi or '')}".strip())
            elif _co_buoc_truoc(repo, dau):
                raise ValueError(f"Bước trước của \"{v.ten_viec}\" chưa bàn giao hàng sang — chờ tổ bàn giao.")
            else:
                if sl_go is None or float(sl_go) <= _EPS:
                    raise ValueError(f"Nhập số bán thành phẩm giao cho \"{v.ten_viec}\" (lớn hơn 0).")
                dong_pg.append(TgcPhieuGiaoDong(phieu_id=pg.id, don_dong_id=d.id, loai=LOAI_BAN_THANH_PHAM,
                                                so_luong=float(sl_go), don_vi=dau.don_vi_vao))
                tom_tat.append(f"{v.ten_viec} {so_vi(sl_go)} {nhan_dv_chang(ten_dv, dau.don_vi_vao or '')}".strip())
        # Vật tư xưởng cấp
        cd_ids = {c.lsx_cong_doan_id for c in ds_cv if c.lsx_cong_doan_id}
        for y in x.get("vat_tu") or []:
            so = float(y.get("so_luong") or 0)
            if so <= _EPS:
                continue
            vt = repo.vat_tu_buoc(int(y.get("lsx_cong_doan_vat_tu_id") or 0))
            if vt is None or vt.lsx_cong_doan_id not in cd_ids:
                raise ValueError("Dòng vật tư không thuộc các bước của việc — tải lại đơn.")
            if vt.ncc_tu_lo:
                raise ValueError(f"“{vt.vat_tu_ten_snapshot}” do nhà gia công tự lo — không xuất kho.")
            dvt = _dvt_kho(vt.hang_loai, vt.don_vi_snapshot)
            dong_pg.append(TgcPhieuGiaoDong(phieu_id=pg.id, don_dong_id=d.id, loai=LOAI_VAT_TU, so_luong=so,
                                            don_vi=dvt, hang_loai=vt.hang_loai, hang_id=int(vt.vat_tu_id),
                                            kho_rong=int(vt.kho_rong or 0), kho_dai=int(vt.kho_dai or 0),
                                            lsx_cong_doan_vat_tu_id=vt.id))
            req_lines.append({"hang_loai": vt.hang_loai, "hang_id": int(vt.vat_tu_id), "dvt": dvt,
                              "kho_rong": int(vt.kho_rong or 0), "kho_dai": int(vt.kho_dai or 0),
                              "sl_de_nghi": round(so, 2), "lsx_id": v.lsx_id})
            tom_tat.append(f"{vt.vat_tu_ten_snapshot} {so_vi(so)} {nhan_don_vi(ten_dv, dvt)}".strip())
        # Giấy trọn gói
        gy = x.get("giay")
        if gy:
            if v.kieu != KIEU_TRON_GOI or not v.xuong_cap_giay:
                raise ValueError(f"Việc \"{v.ten_viec}\" không có giấy xưởng cấp.")
            goi_y = goi_y_cap_giay(db, v) or {}
            if not goi_y.get("giay_id"):
                raise ValueError(goi_y.get("ly_do") or "Lệnh chưa chọn loại giấy.")
            kr, kd = chuan_kho(gy.get("kho_rong"), gy.get("kho_dai"))
            if not kr:
                raise ValueError("Chọn khổ giấy cần xuất.")
            so = round(float(gy.get("so_luong") or 0), 2)
            if so <= 0:
                raise ValueError("Số lượng giấy xin xuất phải lớn hơn 0.")
            dvt = don_vi_goc_to() if kd else "kg"
            dong_pg.append(TgcPhieuGiaoDong(phieu_id=pg.id, don_dong_id=d.id, loai=LOAI_VAT_TU, so_luong=so,
                                            don_vi=dvt, hang_loai=HANG_GIAY, hang_id=int(goi_y["giay_id"]),
                                            kho_rong=kr, kho_dai=kd))
            req_lines.append({"hang_loai": HANG_GIAY, "hang_id": int(goi_y["giay_id"]), "dvt": dvt,
                              "kho_rong": kr, "kho_dai": kd, "sl_de_nghi": so, "lsx_id": v.lsx_id})
            tom_tat.append(f"Giấy {so_vi(so)} {nhan_don_vi(ten_dv, dvt)} khổ {nhan_kho(kr, kd)}")
    if not dong_pg:
        raise ValueError("Phiếu giao chưa có dòng nào — chọn bán thành phẩm hoặc gõ số vật tư.")
    for x in dong_pg:
        db.add(x)
    req = None
    if req_lines:
        svc = _req_svc(db)
        lsx_ma = ", ".join(sorted({l["lsx_ma"] for ds in thong_tin_lenh.cua_viec(db, viecs.values()).values()
                                   for l in ds}))
        try:
            req = svc.create(user=user, loai=REQ_XUAT, lines=req_lines, commit=False,
                             bo_phan_id=getattr(user, "department_id", None), tgc_phieu_giao_id=pg.id,
                             ghi_chu=f"Cấp vật tư gia công {pg.ma} — {don.nha_cung_cap_ten} — lệnh {lsx_ma}"[:1000])
        except StockRequestError as e:
            db.rollback()
            raise ValueError(str(e)) from None
    don.version += 1
    AuditLogRepository(db).create(
        actor_user_id=uid, action="tgc_phieu_giao_tao", target=f"tgc_phieu_giao:{pg.id}",
        detail=(f"Phiếu giao {pg.ma} cho đơn {don.ma} ({don.nha_cung_cap_ten}): {'; '.join(tom_tat)}"
                + (f". Đề nghị xuất {req.ma}" if req is not None else ""))[:500], commit=False)
    db.commit()
    db.refresh(pg)
    if req is not None:
        _req_svc(db).thong_bao_yeu_cau_moi(req)
        _bao_vat_tu_doi()
    ket_qua = [ban_giao.ket_qua_da_nhan(db, user=user, bg=bg, nguon_cv=n, dich_cv=dau) for bg, n, dau in da_nhan]
    return pg, ket_qua


def _bao_vat_tu_doi() -> None:
    from .tron_goi import _bao_nhu_cau_doi

    _bao_nhu_cau_doi()


# --- Huỷ ------------------------------------------------------------------------------------
def huy(db: Session, *, user, phieu_id: int, expected_version: int | None, ly_do: str) -> TgcPhieuGiao:
    repo = ThueGiaCongRepository(db)
    pg = repo.khoa_phieu_giao(phieu_id)
    if pg is None:
        raise ValueError("Không tìm thấy phiếu giao.")
    kiem_version(pg, expected_version, f"Phiếu giao {pg.ma}")
    if pg.huy_luc is not None:
        raise ValueError(f"Phiếu giao {pg.ma} đã huỷ rồi.")
    ly_do = (ly_do or "").strip()
    if len(ly_do) < 3:
        raise ValueError("Ghi lý do huỷ (ít nhất 3 ký tự).")
    sau = [p.ma for p in repo.phieu_nhan_cua_don(pg.don_id) if p.huy_luc is None and p.nhan_luc >= pg.giao_luc]
    if sau:
        raise ValueError(f"Đơn đã nhận hàng về bằng phiếu {', '.join(sau)} sau phiếu giao này — huỷ phiếu nhận trước.")
    svc = _req_svc(db)
    reqs = [r for r in repo.de_nghi_cua_phieu_giao([pg.id])[pg.id]
            if r.trang_thai not in (REQ_CANCELLED, REQ_REJECTED)]
    for r in reqs:
        if svc.kho_da_lap_phieu(r):
            raise ValueError(f"Kho đã lập phiếu xuất cho đề nghị {r.ma} — không huỷ phiếu giao được. "
                             "Vật tư dư trả kho lúc Hoàn tất dòng đơn.")
    dongs = repo.dong_phieu_giao([pg.id])[pg.id]
    bgs = repo.ban_giao_theo_id([x.ban_giao_id for x in dongs if x.ban_giao_id])
    for bg in bgs.values():
        bg.trang_thai = BG_DE_XUAT
        bg.xac_nhan_by_id = None
        bg.xac_nhan_luc = None
        bg.version += 1
    for r in reqs:
        r.trang_thai = REQ_CANCELLED
        r.ly_do_huy = f"Huỷ phiếu giao gia công {pg.ma}"[:500]
    uid = getattr(user, "id", None)
    pg.huy_luc, pg.huy_boi_id, pg.ly_do_huy = _now(), uid, ly_do[:500]
    pg.version += 1
    don = repo.don(pg.don_id)
    if don is not None:
        don.version += 1
    AuditLogRepository(db).create(actor_user_id=uid, action="tgc_phieu_giao_huy", target=f"tgc_phieu_giao:{pg.id}",
                                  detail=f"Huỷ phiếu giao {pg.ma}. Lý do: {ly_do}"[:500], commit=False)
    db.commit()
    for r in reqs:
        svc.thong_bao_da_huy(r)
    if reqs:
        _bao_vat_tu_doi()
    return pg


# --- Đọc ------------------------------------------------------------------------------------
def nhieu_dict(db: Session, phieus) -> list[dict]:
    phieus = list(phieus)
    if not phieus:
        return []
    repo = ThueGiaCongRepository(db)
    ids = [p.id for p in phieus]
    dongs = repo.dong_phieu_giao(ids)
    reqs = repo.de_nghi_cua_phieu_giao(ids)
    dons = repo.nhieu_don({p.don_id for p in phieus})
    dd_ids = {x.don_dong_id for ds in dongs.values() for x in ds}
    dds = {d.id: d for ds in repo.dong_cua_nhieu_don(dons.keys()).values() for d in ds if d.id in dd_ids}
    viecs = repo.nhieu_viec({d.viec_id for d in dds.values()})
    lenh = thong_tin_lenh.cua_viec(db, viecs.values())
    ten = repo.user_names({u for p in phieus for u in (p.nguoi_giao_id, p.huy_boi_id)})
    svc = _req_svc(db)
    ten_hang: dict[tuple, str] = {}

    def hang(loai, hid) -> str:
        k = (loai, hid)
        if k not in ten_hang:
            try:
                ten_hang[k] = svc.hang.get(loai, hid).ten
            except Exception:  # noqa: BLE001 — mặt hàng đã xoá: hiện mã
                ten_hang[k] = f"#{hid}"
        return ten_hang[k]

    out = []
    for p in phieus:
        don = dons.get(p.don_id)
        ds = dongs.get(p.id, [])
        lenh_p: dict[int, dict] = {}
        for x in ds:
            dd = dds.get(x.don_dong_id)
            for l in lenh.get(dd.viec_id, []) if dd else []:
                lenh_p.setdefault(l["lsx_id"], l)
        de_nghi = [{"id": r.id, "ma": r.ma, "trang_thai": r.trang_thai, "da_lap_phieu": svc.kho_da_lap_phieu(r)}
                   for r in reqs.get(p.id, [])]
        out.append({
            "id": p.id, "ma": p.ma, "version": p.version, "don_id": p.don_id,
            "ma_don": don.ma if don else "", "nha_cung_cap_id": don.nha_cung_cap_id if don else None,
            "nha_cung_cap_ten": don.nha_cung_cap_ten if don else "",
            "giao_luc": p.giao_luc, "nguoi_giao_ten": ten.get(p.nguoi_giao_id), "ghi_chu": p.ghi_chu,
            "huy_luc": p.huy_luc, "nguoi_huy_ten": ten.get(p.huy_boi_id), "ly_do_huy": p.ly_do_huy,
            "created_at": p.created_at, "lenh": list(lenh_p.values()), "de_nghi": de_nghi,
            "dong": [{
                "id": x.id, "don_dong_id": x.don_dong_id,
                "ten_viec": viecs[dds[x.don_dong_id].viec_id].ten_viec if x.don_dong_id in dds else "",
                "loai": x.loai, "so_luong": float(x.so_luong), "don_vi": x.don_vi,
                "ten_hang": hang(x.hang_loai, x.hang_id) if x.loai == LOAI_VAT_TU and x.hang_id else None,
                "kho_rong": int(x.kho_rong or 0), "kho_dai": int(x.kho_dai or 0),
                "tu_ban_giao": x.ban_giao_id is not None,
            } for x in ds],
        })
    return out


def danh_sach(db: Session, *, tu_ngay=None, den_ngay=None, q: str | None = None,
              nha_cung_cap_id: int | None = None, con_hieu_luc: bool | None = None,
              page: int = 1, size: int = 25) -> dict:
    ds = ThueGiaCongRepository(db).phieu_giao_trong_ky(tu_ngay=tu_ngay, den_ngay=den_ngay, q=q,
                                                       nha_cung_cap_id=nha_cung_cap_id)
    facets = {"con_hieu_luc": sum(1 for p in ds if p.huy_luc is None),
              "da_huy": sum(1 for p in ds if p.huy_luc is not None)}
    if con_hieu_luc is not None:
        ds = [p for p in ds if (p.huy_luc is None) == con_hieu_luc]
    size = max(1, min(int(size or 25), 200))
    page = max(1, int(page or 1))
    return {"items": nhieu_dict(db, ds[(page - 1) * size: page * size]), "total": len(ds), "page": page,
            "size": size, "facets": facets}


def lsx_ids_cua_phieu(db: Session, pg) -> list[int]:
    from .don import lsx_ids_cua_dong

    return lsx_ids_cua_dong(db, ThueGiaCongRepository(db).dong_cua_don(pg.don_id, ca_huy=True))


__all__ = ["du_lieu_moi", "lap", "huy", "nhieu_dict", "danh_sach", "TgcXungDot"]
