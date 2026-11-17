"""Trạng thái CHỈ ĐỌC của từng việc thuê gia công trên màn lệnh (spec 2026-11-13 §3).

"Chưa đặt" · "Đơn nháp GC-…" · "Đã đặt GC-… hẹn về dd/mm" · "Đang ở <NCC> x/y" · "Xong x (hụt z)".
Trả cả số liệu rời để giao diện tự bày (không nối chuỗi bằng dấu phẩy)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.thue_gia_cong import KIEU_TRON_GOI
from ...repositories.don_vi_do_repo import DonViDoRepository
from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository
from . import nhan_dv_chang, so_lieu, so_vi

TT_CHUA_DAT = "chua_dat"
TT_NHAP = "nhap"
TT_DA_DAT = "da_dat"
TT_DANG_O_NGOAI = "dang_o_ngoai"
TT_DA_VE = "da_ve"
TT_XONG = "xong"


def _ngay(d) -> str:
    return d.strftime("%d/%m") if d else ""


def cua_viec(db: Session, viecs) -> list[dict]:
    viecs = list(viecs)
    if not viecs:
        return []
    repo = ThueGiaCongRepository(db)
    ten_dv = DonViDoRepository(db).ten_theo_ma()
    dong = repo.dong_song_cua_nhieu_viec([v.id for v in viecs])
    sl = so_lieu.cua_dong(db, [dd for dd, _ in dong.values()], {v.id: v for v in viecs})
    cvs = repo.cong_viec_cua_nhieu_viec([v.id for v in viecs])
    ma_bg = {v.bai_ghep_id: (b.ma if (b := repo.bai_ghep(v.bai_ghep_id)) else None)
             for v in viecs if v.bai_ghep_id}
    out: list[dict] = []
    for v in viecs:
        dd, don = dong.get(v.id, (None, None))
        s = sl.get(dd.id) if dd is not None else None
        dv = nhan_dv_chang(ten_dv, v.don_vi or "") if v.don_vi else ""
        r = {
            "viec_id": v.id, "version": v.version, "kieu": v.kieu, "ten_viec": v.ten_viec,
            "sl_can": float(v.sl_can) if v.sl_can is not None else None, "don_vi": v.don_vi,
            "xuong_cap_giay": bool(v.xuong_cap_giay),
            "bai_ghep_id": v.bai_ghep_id, "bai_ghep_ma": ma_bg.get(v.bai_ghep_id),
            "step_keys": [c.step_key for c in cvs.get(v.id, []) if c.step_key],
            "don_id": don.id if don else None, "ma_don": don.ma if don else None,
            "nha_cung_cap_ten": don.nha_cung_cap_ten if don else None,
            "ngay_hen_ve": don.ngay_hen_ve if don else None,
            "da_giao": s["giao_quy_doi"] if s else 0.0, "dat": s["dat"] if s else 0.0,
            "hong": s["hong"] if s else 0.0, "con_ngoai": s["con_ngoai"] if s else 0.0,
            "sl_dat": float(dd.sl_dat) if dd is not None else None,
            "hao_hut": float(dd.hao_hut) if dd is not None and dd.hao_hut is not None else None,
        }
        if don is None:
            tt, nhan = TT_CHUA_DAT, "Chưa đặt"
        elif don.dat_luc is None:
            tt, nhan = TT_NHAP, f"Đơn nháp {don.ma}"
        elif dd.hoan_tat_luc is not None:
            tt = TT_XONG
            nhan = f"Xong {so_vi(s['dat'])} {dv}".strip()
            if dd.hao_hut is not None and float(dd.hao_hut) > 0:
                nhan += f" (hụt {so_vi(dd.hao_hut)})"
        elif v.kieu == KIEU_TRON_GOI and s and s["co_nhan"]:
            tt = TT_DA_VE
            nhan = f"Đã về {so_vi(s['dat'])}/{so_vi(dd.sl_dat)} {dv}".strip()
        elif s and s["da_giao"] > 0:
            tt = TT_DANG_O_NGOAI
            nhan = f"Đang ở {don.nha_cung_cap_ten} {so_vi(s['con_ngoai'])}/{so_vi(s['giao_quy_doi'])} {dv}".strip()
        else:
            tt = TT_DA_DAT
            nhan = f"Đã đặt {don.ma}" + (f" hẹn về {_ngay(don.ngay_hen_ve)}" if don.ngay_hen_ve else "")
        r["trang_thai"], r["nhan"] = tt, nhan
        out.append(r)
    return out


def cua_lenh(db: Session, lsx_id: int) -> list[dict]:
    """Việc của lệnh + việc của bước chung bài ghép có lệnh này."""
    repo = ThueGiaCongRepository(db)
    viecs = [v for _l, v, _bg in repo.viec_cua_nhieu_lenh([lsx_id])]
    return cua_viec(db, viecs)


def cua_bai_ghep(db: Session, bai_ghep_id: int) -> list[dict]:
    """Việc thuê gia công của bước chung bài ghép (cả tờ ghép đi một việc)."""
    return cua_viec(db, ThueGiaCongRepository(db).viec_cua_bai_ghep(bai_ghep_id))
