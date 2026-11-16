"""Tóm tắt thuê gia công cho TỪNG dòng danh sách lệnh — bảng lệnh biết đặt chip gì.

Trạng thái của một việc dẫn xuất từ dòng đơn còn sống: chưa có ⇒ `chua_dat`; có, chưa hoàn tất
⇒ `da_dat`; đã hoàn tất ⇒ `da_xong`. Lệnh nhiều việc lấy việc "gấp" nhất làm đại diện."""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository

TT_CHUA_DAT = "chua_dat"
TT_DA_DAT = "da_dat"
TT_DA_XONG = "da_xong"
_UU_TIEN = {TT_CHUA_DAT: 0, TT_DA_DAT: 1, TT_DA_XONG: 2}


def theo_lenh(db: Session, lsx_ids) -> dict[int, dict]:
    """`{lsx_id: tóm tắt}` — hai câu cho cả trang, không query theo dòng."""
    repo = ThueGiaCongRepository(db)
    cap = repo.viec_cua_nhieu_lenh(lsx_ids)
    if not cap:
        return {}
    dong = repo.dong_song_chi_tiet({v.id for _, v, _ in cap})
    gom: dict[int, list[tuple[str, object, str | None]]] = {}
    for lsx_id, v, bg in cap:
        d = dong.get(v.id)
        tt = TT_CHUA_DAT if d is None else (TT_DA_XONG if d[2] else TT_DA_DAT)
        gom.setdefault(lsx_id, []).append((tt, v, bg))
    out: dict[int, dict] = {}
    for lsx_id, ds in gom.items():
        tt, v, bg = min(ds, key=lambda x: (_UU_TIEN[x[0]], x[1].id))
        d = dong.get(v.id)
        out[lsx_id] = {
            "kieu": v.kieu, "trang_thai": tt,
            "nha_cung_cap_ten": d[1] if d else None, "ma_don": d[0] if d else None,
            "ten_viec": v.ten_viec, "bai_ghep_ma": bg,
            "so_viec": len(ds), "so_viec_mo": sum(1 for t, _, _ in ds if t != TT_DA_XONG),
        }
    return out


def tron_goi_theo_lenh(db: Session, lsx_ids) -> dict[int, str | None]:
    """`{lsx_id: tên nhà gia công}` của lệnh trọn gói — tên lấy từ đơn sống, chưa đặt thì None."""
    repo = ThueGiaCongRepository(db)
    tg = repo.tron_goi_cua_lenh(lsx_ids)
    dong = repo.dong_song_chi_tiet([v.id for v in tg.values()])
    return {i: (dong[v.id][1] if v.id in dong else None) for i, v in tg.items()}


def nha_theo_cong_viec(db: Session, cvs) -> dict[int, str]:
    """`{cong_viec_id: tên nhà gia công}` lấy từ đơn còn sống của việc gia công (`tgc_viec_id`).
    Công việc của xưởng hoặc việc chưa vào đơn thì không có khoá. Một câu cho cả trang."""
    cvs = [c for c in cvs if getattr(c, "tgc_viec_id", None)]
    if not cvs:
        return {}
    dong = ThueGiaCongRepository(db).dong_song_chi_tiet({c.tgc_viec_id for c in cvs})
    return {c.id: dong[c.tgc_viec_id][1] for c in cvs
            if c.tgc_viec_id in dong and dong[c.tgc_viec_id][1]}
