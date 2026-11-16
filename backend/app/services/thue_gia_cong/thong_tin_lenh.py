"""Thông tin lệnh đi kèm mọi bản ghi Thuê gia công (Global Constraints của plan): mã lệnh, khách
hàng, mã đơn hàng, mặt hàng, hạn giao. Bài ghép trả từng lệnh thành viên."""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository


def cua_nhieu(db: Session, lsx_ids) -> dict[int, dict]:
    return {
        int(i): {"lsx_id": int(i), "lsx_ma": ma, "khach_hang": kh or "", "don_hang_ma": dh or "",
                 "mat_hang": ten or "", "han_giao": han}
        for i, ma, ten, han, dh, kh in ThueGiaCongRepository(db).thong_tin_lenh(lsx_ids)
    }


def cua_viec(db: Session, viecs) -> dict[int, list[dict]]:
    """`{viec_id: [thông tin lệnh]}` — việc của lệnh trả một phần tử, việc bài ghép trả mọi lệnh
    thành viên. Hai câu cho cả trang."""
    viecs = list(viecs)
    repo = ThueGiaCongRepository(db)
    theo_bg = repo.lenh_cua_bai_ghep({v.bai_ghep_id for v in viecs if v.bai_ghep_id})
    can = {v.lsx_id for v in viecs if v.lsx_id} | {l for ds in theo_bg.values() for l in ds}
    tt = cua_nhieu(db, can)
    out: dict[int, list[dict]] = {}
    for v in viecs:
        ids = [v.lsx_id] if v.lsx_id else theo_bg.get(v.bai_ghep_id, [])
        out[v.id] = [tt[i] for i in ids if i in tt]
    return out
