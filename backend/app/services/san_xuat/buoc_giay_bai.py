"""Bước LẤY giấy của bài ghép (spec 2026-10-18 tự lập yêu cầu xuất §4.2, §6).

Giấy của bài nằm ở `bai_ghep.giay_id`, không phải dòng vật tư của bước chung. Bước lấy giấy là bước
chung mà bước thành viên nó phủ (`bai_ghep_cong_doan_map`) mang dòng giấy; bài chưa có thành viên
nào mang giấy ở bước thì lấy bước chung đầu tiên nhận chặng tờ (tờ nguyên / tờ in) hoặc thuộc nhóm
In. Khâu tổ Cắt chốt giấy đã gỡ (18/10/2026) nên cờ Tổ Cắt không còn kéo bước cắt cuộn vào đây.

Kế hoạch vật tư và đường tự lập yêu cầu khi phát hành cùng đọc hàm này — một luật, một chỗ.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.bai_ghep_cong_doan import BaiGhepCongDoanMap
from ...models.cong_doan import CongDoan
from ...models.don_vi_do import TRAM_TO, TRAM_TO_NGUYEN
from ...models.lsx import LsxCongDoan, LsxCongDoanVatTu
from ..dong_giay import ban_do_tram, tram_cua

NHOM_IN = "print"


def buoc_chung_co_giay(db: Session, buoc: list) -> set[int]:
    """Id các bước chung (của một hay nhiều bài) mà bước thành viên nó phủ mang dòng giấy."""
    if not buoc:
        return set()
    co_giay = select(LsxCongDoanVatTu.lsx_cong_doan_id).where(LsxCongDoanVatTu.hang_loai == "giay")
    return set(db.scalars(
        select(BaiGhepCongDoanMap.bai_ghep_cong_doan_id)
        .join(LsxCongDoan, LsxCongDoan.step_key == BaiGhepCongDoanMap.lsx_step_key)
        .where(BaiGhepCongDoanMap.bai_ghep_cong_doan_id.in_([b.id for b in buoc]),
               LsxCongDoan.id.in_(co_giay))))


def _nhan_giay(buoc, cd, tram: dict) -> bool:
    if buoc.don_vi_vao and tram_cua(buoc.don_vi_vao, tram) in (TRAM_TO, TRAM_TO_NGUYEN):
        return True
    return (cd.nhom if cd is not None else buoc.nhom) == NHOM_IN


def buoc_lay_giay_bai_lo(db: Session, buoc_theo_bai: dict[int, list]) -> dict[int, object]:
    """Bài → bước chung lấy giấy (`None` nếu không bước nào nhận giấy). Nạp lô: số câu truy vấn
    không chạy theo số bài. `buoc_theo_bai`: bài → các bước chung đã nạp."""
    tat_ca = [b for ds in buoc_theo_bai.values() for b in ds]
    co_giay = buoc_chung_co_giay(db, tat_ca)
    can_xet = [b for ds in buoc_theo_bai.values() if not any(x.id in co_giay for x in ds)
               for b in ds]
    tram: dict = {}
    cd_map: dict = {}
    if can_xet:
        tram = ban_do_tram(db)
        cd_ids = {b.cong_doan_id for b in can_xet if b.cong_doan_id}
        if cd_ids:
            cd_map = {c.id: c for c in db.scalars(select(CongDoan).where(CongDoan.id.in_(cd_ids)))}

    kq: dict[int, object] = {}
    for bai_id, ds in buoc_theo_bai.items():
        ds = sorted(ds, key=lambda b: (b.thu_tu or 0, b.id))
        mang = [b for b in ds if b.id in co_giay] or [
            b for b in ds if _nhan_giay(b, cd_map.get(b.cong_doan_id), tram)]
        kq[bai_id] = mang[0] if mang else None
    return kq
