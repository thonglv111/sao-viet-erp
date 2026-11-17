"""Sổ HÀNG ĐANG Ở NGOÀI (spec 2026-11-13 §6) — sổ số lượng tính ra từ chứng từ, không phải kho.

  · Bán thành phẩm: giao (đơn vị giao) và quy đổi sang đơn vị nhận, đạt, hỏng, còn ngoài
    (`so_lieu.cua_dong`). Hoàn tất ⇒ còn ngoài = 0 (phần chênh là hao hụt).
  · Vật tư từ kho theo `(hang_loai, hang_id, khổ)`: đã ghi trên phiếu giao, KHO ĐÃ XUẤT THỰC (chỉ
    phần kho đã xuất mới thực ở nhà gia công), đã nhập trả lúc Hoàn tất; còn ngoài = xuất − trả,
    sau Hoàn tất = 0 (phần còn lại coi là nhà gia công dùng hết)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.stock_request import REQ_CANCELLED, REQ_REJECTED
from ...models.thue_gia_cong import KIEU_TRON_GOI, LOAI_VAT_TU
from ...repositories.don_vi_do_repo import DonViDoRepository, nhan_don_vi
from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository
from ..kho_giay import nhan_kho
from . import nhan_dv_chang, so_lieu, thong_tin_lenh

_EPS = 1e-9


def _khoa(x) -> tuple:
    return (x.hang_loai, int(x.hang_id or 0), int(x.kho_rong or 0), int(x.kho_dai or 0))


def _xuat_thuc(ln) -> float:
    """Số kho công nhận đã cấp cho một dòng đề nghị xuất."""
    if ln.sl_chot_thuc_xuat is not None:
        return float(ln.sl_chot_thuc_xuat)
    return float(ln.sl_da_ung or 0)


def _ten_hang(db: Session):
    from .phieu_giao import _req_svc

    svc = _req_svc(db)
    nho: dict[tuple, str] = {}

    def ten(loai, hid) -> str:
        k = (loai, hid)
        if k not in nho:
            try:
                nho[k] = svc.hang.get(loai, hid).ten
            except Exception:  # noqa: BLE001 — mặt hàng đã xoá: hiện mã
                nho[k] = f"#{hid}"
        return nho[k]

    return ten


def cua_dong(db: Session, don_dong_ids) -> dict[int, dict]:
    """`{don_dong_id: {ban_thanh_pham: {...} | None, vat_tu: [...]}}`."""
    repo = ThueGiaCongRepository(db)
    ids = sorted({int(i) for i in don_dong_ids if i})
    if not ids:
        return {}
    dongs = [d for d in (repo.dong_don(i) for i in ids) if d is not None]
    viecs = repo.nhieu_viec({d.viec_id for d in dongs})
    sl = so_lieu.cua_dong(db, dongs, viecs)
    # Vật tư: dòng phiếu giao sống → đề nghị xuất của phiếu → dòng đề nghị (xuất thực).
    giao = [x for x in repo.giao_dong_song([d.id for d in dongs]) if x.loai == LOAI_VAT_TU]
    reqs = repo.de_nghi_cua_phieu_giao({x.phieu_id for x in giao})
    req_ids = [r.id for ds in reqs.values() for r in ds if r.trang_thai not in (REQ_CANCELLED, REQ_REJECTED)]
    lines = repo.dong_de_nghi(req_ids)
    xuat_phieu: dict[tuple, float] = {}     # (phieu_id, khoá) → xuất thực của cả phiếu
    for pid, ds in reqs.items():
        for r in ds:
            for ln in lines.get(r.id, []):
                k = (pid, _khoa(ln))
                xuat_phieu[k] = xuat_phieu.get(k, 0.0) + _xuat_thuc(ln)
    ghi_phieu: dict[tuple, float] = {}      # (phieu_id, khoá) → số ghi của cả phiếu (để chia theo dòng)
    for x in giao:
        k = (x.phieu_id, _khoa(x))
        ghi_phieu[k] = ghi_phieu.get(k, 0.0) + float(x.so_luong)
    tra = repo.de_nghi_tra_cua_dong([d.id for d in dongs])
    tra_lines = repo.dong_de_nghi([r.id for ds in tra.values() for r in ds
                                   if r.trang_thai not in (REQ_CANCELLED, REQ_REJECTED)])
    ten = _ten_hang(db)
    out: dict[int, dict] = {}
    for d in dongs:
        v = viecs.get(d.viec_id)
        s = sl.get(d.id, {})
        xong = d.hoan_tat_luc is not None
        btp = None
        if v is not None and v.kieu != KIEU_TRON_GOI and s.get("da_giao", 0) > _EPS:
            btp = {"giao": s["da_giao"], "don_vi_giao": s.get("don_vi_giao"), "giao_quy_doi": s["giao_quy_doi"],
                   "dat": s["dat"], "hong": s["hong"], "don_vi": s.get("don_vi_nhan"),
                   "con_ngoai": 0.0 if xong else s["con_ngoai"],
                   "hao_hut": float(d.hao_hut) if d.hao_hut is not None else None}
        vt: dict[tuple, dict] = {}
        for x in giao:
            if x.don_dong_id != d.id:
                continue
            k = _khoa(x)
            m = vt.setdefault(k, {"hang_loai": x.hang_loai, "hang_id": int(x.hang_id or 0),
                                  "kho_rong": int(x.kho_rong or 0), "kho_dai": int(x.kho_dai or 0),
                                  "ten": ten(x.hang_loai, x.hang_id), "don_vi": x.don_vi,
                                  "giao": 0.0, "xuat": 0.0, "tra": 0.0})
            m["giao"] += float(x.so_luong)
            tong_ghi = ghi_phieu.get((x.phieu_id, k), 0.0)
            if tong_ghi > _EPS:
                m["xuat"] += xuat_phieu.get((x.phieu_id, k), 0.0) * float(x.so_luong) / tong_ghi
        for r in tra.get(d.id, []):
            for ln in tra_lines.get(r.id, []):
                m = vt.get(_khoa(ln))
                if m is not None:
                    m["tra"] += float(ln.sl_de_nghi)
        ds_vt = []
        for m in vt.values():
            m["giao"], m["xuat"], m["tra"] = round(m["giao"], 3), round(m["xuat"], 3), round(m["tra"], 3)
            m["con_ngoai"] = 0.0 if xong else round(max(m["xuat"] - m["tra"], 0.0), 3)
            m["kho"] = nhan_kho(m["kho_rong"], m["kho_dai"]) if m["kho_rong"] else None
            ds_vt.append(m)
        out[d.id] = {"ban_thanh_pham": btp, "vat_tu": ds_vt, "hoan_tat": xong}
    return out


def danh_sach(db: Session, *, nha_cung_cap_id: int | None = None, q: str | None = None,
              page: int = 1, size: int = 25) -> dict:
    """Theo nhà gia công × hàng, chỉ dòng còn ở ngoài > 0 (dòng đơn chưa hoàn tất)."""
    repo = ThueGiaCongRepository(db)
    cap = [(d, don) for d, don in repo.dong_don_dang_mo(nha_cung_cap_id=nha_cung_cap_id)
           if d.hoan_tat_luc is None]
    so = cua_dong(db, [d.id for d, _ in cap])
    viecs = repo.nhieu_viec({d.viec_id for d, _ in cap})
    lenh = thong_tin_lenh.cua_viec(db, viecs.values())
    ten_dv = DonViDoRepository(db).ten_theo_ma()
    rows: list[dict] = []
    for d, don in cap:
        v = viecs.get(d.viec_id)
        x = so.get(d.id) or {}
        ma_lenh = [l["lsx_ma"] for l in lenh.get(d.viec_id, [])]
        chung = {"nha_cung_cap_id": don.nha_cung_cap_id, "nha_cung_cap_ten": don.nha_cung_cap_ten,
                 "don_id": don.id, "ma_don": don.ma, "don_dong_id": d.id,
                 "ten_viec": v.ten_viec if v else "", "lenh": lenh.get(d.viec_id, []),
                 "ngay_hen_ve": don.ngay_hen_ve}
        btp = x.get("ban_thanh_pham")
        if btp and btp["con_ngoai"] > _EPS:
            rows.append({**chung, "loai": "ban_thanh_pham",
                         "ten_hang": v.ten_viec if v else "",
                         "kho": None, "giao": btp["giao_quy_doi"], "da_ve": btp["dat"] + btp["hong"],
                         "con_ngoai": btp["con_ngoai"], "don_vi": btp["don_vi"],
                         "don_vi_ten": nhan_dv_chang(ten_dv, btp["don_vi"] or ""), "_tim": ma_lenh})
        for m in x.get("vat_tu", []):
            if m["con_ngoai"] > _EPS:
                rows.append({**chung, "loai": "vat_tu", "ten_hang": m["ten"], "kho": m["kho"],
                             "giao": m["xuat"], "da_ve": m["tra"], "con_ngoai": m["con_ngoai"],
                             "don_vi": m["don_vi"], "don_vi_ten": nhan_don_vi(ten_dv, m["don_vi"] or ""),
                             "_tim": ma_lenh})
    q = (q or "").strip().lower()
    if q:
        rows = [r for r in rows if q in " ".join([r["nha_cung_cap_ten"] or "", r["ma_don"], r["ten_hang"] or "",
                                                  r["ten_viec"], *r["_tim"]]).lower()]
    for r in rows:
        r.pop("_tim", None)
    size = max(1, min(int(size or 25), 200))
    page = max(1, int(page or 1))
    return {"items": rows[(page - 1) * size: page * size], "total": len(rows), "page": page, "size": size,
            "facets": {"nha": len({r["nha_cung_cap_id"] for r in rows})}}
