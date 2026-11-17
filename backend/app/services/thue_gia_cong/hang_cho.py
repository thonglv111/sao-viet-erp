"""HÀNG CHỜ gia công — việc tự sinh lúc phát hành, chưa vào dòng đơn sống (spec 2026-11-13 §4.1).

Tình trạng một việc:
  · `san_sang_giao` — tổ bước trước đã đề xuất bàn giao sang công việc đầu của việc, hoặc dải đứng
    đầu lệnh (không có bước trước — xưởng gõ số lúc giao);
  · `cho_buoc_truoc` — còn chờ tổ bước trước bàn giao;
  · `chua_dat` — việc trọn gói (không có bước trước để chờ).
Lọc + đếm + cắt trang ở máy chủ."""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.thue_gia_cong import KIEU_TRON_GOI
from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository
from . import thong_tin_lenh

TT_SAN_SANG = "san_sang_giao"
TT_CHO_BUOC_TRUOC = "cho_buoc_truoc"
TT_CHUA_DAT = "chua_dat"
TINH_TRANG = (TT_SAN_SANG, TT_CHO_BUOC_TRUOC, TT_CHUA_DAT)


def _co_buoc_truoc(repo: ThueGiaCongRepository, cv) -> bool:
    if cv is None:
        return False
    if cv.lsx_cong_doan_id:
        return repo.co_buoc_truoc(cv.lsx_cong_doan_id)
    if cv.bai_ghep_cong_doan_id:
        return not repo.bai_ghep_buoc_dau(cv.bai_ghep_cong_doan_id)
    return False


def dong_hang_cho(db: Session, viecs) -> list[dict]:
    """Dữ liệu từng dòng Hàng chờ cho danh sách việc đã có trong tay."""
    viecs = list(viecs)
    if not viecs:
        return []
    repo = ThueGiaCongRepository(db)
    cvs = repo.cong_viec_cua_nhieu_viec([v.id for v in viecs])
    dau = {vid: ds[0] for vid, ds in cvs.items() if ds}
    bg = repo.ban_giao_cho_nhan_nhieu([c.id for c in dau.values()])
    vt = repo.vat_tu_xuong_cap({c.lsx_cong_doan_id for ds in cvs.values() for c in ds if c.lsx_cong_doan_id})
    lenh = thong_tin_lenh.cua_viec(db, viecs)
    ma_bg = {v.bai_ghep_id: (b.ma if (b := repo.bai_ghep(v.bai_ghep_id)) else None)
             for v in viecs if v.bai_ghep_id}
    out: list[dict] = []
    for v in viecs:
        cv = dau.get(v.id)
        cho = bg.get(cv.id, []) if cv is not None else []
        if v.kieu == KIEU_TRON_GOI:
            tt = TT_CHUA_DAT
        elif cho or not _co_buoc_truoc(repo, cv):
            tt = TT_SAN_SANG
        else:
            tt = TT_CHO_BUOC_TRUOC
        vat_tu = [{"ten": x.vat_tu_ten_snapshot, "so_luong": float(x.so_luong),
                   "don_vi": x.don_vi_snapshot}
                  for c in cvs.get(v.id, []) for x in vt.get(c.lsx_cong_doan_id or 0, [])]
        out.append({
            "viec_id": v.id, "version": v.version, "kieu": v.kieu, "ten_viec": v.ten_viec,
            "sl_can": float(v.sl_can) if v.sl_can is not None else None,
            "don_vi": v.don_vi, "don_vi_giao": cv.don_vi_vao if cv is not None else None,
            "xuong_cap_giay": bool(v.xuong_cap_giay),
            "lsx_id": v.lsx_id, "bai_ghep_id": v.bai_ghep_id, "bai_ghep_ma": ma_bg.get(v.bai_ghep_id),
            "lenh": lenh.get(v.id, []), "tinh_trang": tt,
            "sl_san_sang": sum(float(b.so_luong) for b in cho),
            "so_buoc": len(cvs.get(v.id, [])), "vat_tu_xuong_cap": vat_tu,
            "created_at": v.created_at,
        })
    return out


def _khop(d: dict, q: str) -> bool:
    if not q:
        return True
    chu = " ".join([d["ten_viec"] or "", d["bai_ghep_ma"] or ""] + [
        " ".join([l["lsx_ma"], l["khach_hang"], l["don_hang_ma"], l["mat_hang"]]) for l in d["lenh"]])
    return q.lower() in chu.lower()


def danh_sach(db: Session, *, q: str | None = None, tinh_trang: str | None = None,
              page: int = 1, size: int = 25) -> dict:
    repo = ThueGiaCongRepository(db)
    q = (q or "").strip()
    dong = [d for d in dong_hang_cho(db, repo.viec_chua_dat()) if _khop(d, q)]
    facets = {k: sum(1 for d in dong if d["tinh_trang"] == k) for k in TINH_TRANG}
    if tinh_trang:
        dong = [d for d in dong if d["tinh_trang"] == tinh_trang]
    # Việc sẵn sàng giao lên đầu, rồi theo hạn giao gần nhất.
    uu = {TT_SAN_SANG: 0, TT_CHUA_DAT: 1, TT_CHO_BUOC_TRUOC: 2}

    def han(d):
        ds = [l["han_giao"] for l in d["lenh"] if l["han_giao"]]
        return min(ds).isoformat() if ds else "9999"

    dong.sort(key=lambda d: (uu[d["tinh_trang"]], han(d), d["viec_id"]))
    size = max(1, min(int(size or 25), 200))
    page = max(1, int(page or 1))
    tong = len(dong)
    return {"items": dong[(page - 1) * size: page * size], "total": tong, "page": page, "size": size,
            "facets": facets}
