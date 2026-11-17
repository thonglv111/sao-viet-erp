"""Số liệu của DÒNG ĐƠN gia công — đã giao, đã nhận, còn ngoài, tạm tính (spec 2026-11-13 §4, §6).

Dẫn xuất từ phiếu giao / phiếu nhận còn sống, không lưu. Bán thành phẩm giao theo đơn vị VÀO của
bước đầu dải, nhận theo đơn vị RA của bước cuối: "giao quy đổi" = giao × ra ÷ vào (tỷ lệ của chính
công việc), làm tròn LÊN khi dùng để chặn để không chặn oan đúng số."""
from __future__ import annotations

import math

from sqlalchemy.orm import Session

from ...models.thue_gia_cong import KIEU_TRON_GOI, LOAI_BAN_THANH_PHAM, LOAI_VAT_TU
from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository


def he_so_quy_doi(cvs: list) -> tuple[float, str | None, str | None]:
    """`(hệ số giao→nhận, đơn vị giao, đơn vị nhận)` từ công việc của việc (đã sắp theo bước)."""
    if not cvs:
        return 1.0, None, None
    dau, cuoi = cvs[0], cvs[-1]
    vao = float(dau.so_luong_vao or 0)
    ra = float(cuoi.so_luong_ra or 0)
    he_so = ra / vao if vao > 0 and ra > 0 else 1.0
    return he_so, dau.don_vi_vao, cuoi.don_vi_ra


def quy_doi_len(so: float, he_so: float) -> float:
    """Giao × hệ số, làm tròn LÊN tới số nguyên (bỏ sai số dấu phẩy động trước khi làm tròn)."""
    return float(math.ceil(round(float(so) * he_so, 6)))


def cua_dong(db: Session, dongs, viecs: dict | None = None) -> dict[int, dict]:
    """`{don_dong_id: số liệu}`. `viecs` = `{viec_id: TgcViec}` nếu đã có trong tay."""
    dongs = list(dongs)
    if not dongs:
        return {}
    repo = ThueGiaCongRepository(db)
    viecs = dict(viecs or {})
    thieu = {d.viec_id for d in dongs} - set(viecs)
    for vid in thieu:
        v = repo.viec(vid)
        if v is not None:
            viecs[vid] = v
    cvs = repo.cong_viec_cua_nhieu_viec(viecs.keys())
    ids = [d.id for d in dongs]
    giao = repo.giao_dong_song(ids)
    nhan = repo.nhan_dong_song(ids)
    out: dict[int, dict] = {}
    for d in dongs:
        v = viecs.get(d.viec_id)
        tron_goi = v is not None and v.kieu == KIEU_TRON_GOI
        he_so, dv_giao, dv_nhan = he_so_quy_doi(cvs.get(d.viec_id, []))
        g_btp = sum(float(x.so_luong) for x in giao
                    if x.don_dong_id == d.id and x.loai == LOAI_BAN_THANH_PHAM)
        vat_tu: dict[tuple, dict] = {}
        for x in giao:
            if x.don_dong_id != d.id or x.loai != LOAI_VAT_TU:
                continue
            k = (x.hang_loai, x.hang_id, int(x.kho_rong or 0), int(x.kho_dai or 0))
            m = vat_tu.setdefault(k, {"hang_loai": x.hang_loai, "hang_id": x.hang_id,
                                      "kho_rong": int(x.kho_rong or 0), "kho_dai": int(x.kho_dai or 0),
                                      "so_luong": 0.0, "don_vi": x.don_vi})
            m["so_luong"] += float(x.so_luong)
        dat = sum(float(x.sl_dat) for x in nhan if x.don_dong_id == d.id)
        hong = sum(float(x.sl_hong) for x in nhan if x.don_dong_id == d.id)
        tam_tinh = sum(float(x.sl_dat) * float(x.don_gia or 0) for x in nhan if x.don_dong_id == d.id)
        giao_qd = 0.0 if tron_goi else round(g_btp * he_so, 3)
        con_ngoai = 0.0
        if d.hoan_tat_luc is None and not tron_goi:
            con_ngoai = max(quy_doi_len(g_btp, he_so) - dat - hong, 0.0) if g_btp > 0 else 0.0
        out[d.id] = {
            "he_so": he_so, "don_vi_giao": dv_giao or (v.don_vi if v else None),
            "don_vi_nhan": (v.don_vi if v and v.don_vi else dv_nhan),
            "da_giao": g_btp, "giao_quy_doi": giao_qd, "vat_tu_giao": list(vat_tu.values()),
            "dat": dat, "hong": hong, "con_ngoai": con_ngoai, "tam_tinh": round(tam_tinh, 2),
            "co_giao": bool(g_btp > 0 or vat_tu), "co_nhan": bool(nhan and any(x.don_dong_id == d.id for x in nhan)),
            "tron_goi": tron_goi,
        }
    return out
