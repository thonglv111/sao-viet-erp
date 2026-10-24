"""Giấy và Sóng của phiếu tính giá chọn ở SẢN PHẨM (24/10/2026, spec 2026-10-24-chuan-bi-giay §4).

`phieu_thanh_phan.giay_id` = mã loại Giấy, `song_id` = mã loại Sóng — mỗi thứ MỘT lần, cạnh khổ nguyên.
Chuỗi bước chỉ còn In + sau in, không bước nào mang giấy (`kiem_giay_song`). Có sóng thì chuỗi phải có
bước bồi hệ thống (`CD_BOI`): số tờ sóng là SL vào của bước bồi đầu tiên.

Dữ liệu cũ (giấy là vật tư của bước, 18/10–24/10/2026): mg 0445 đưa dòng giấy của bước lên sản phẩm
theo loại; cấu hình tái bản chụp hồi đó đổi lúc nạp (`chuyen_giay_buoc_len_san_pham`).

Lệnh sản xuất VẪN mang giấy ở bước (bước đầu của khâu chuẩn bị giấy) — `bang_giay`, `id_giay_cua_rows`,
`loi_tran_giay` phục vụ luật trần 1 Giấy + 1 Sóng của lệnh (19/10/2026, mg 0426).
"""
from __future__ import annotations

from typing import Callable, Iterable, NamedTuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.cong_doan import CD_BOI, CongDoan
from ..models.vat_lieu_kho import LOAI_GIAY, LOAI_SONG, GiayNguyen

HANG_GIAY = "giay"


class ThongTinGiay(NamedTuple):
    loai: str
    ten: str


# id giấy → (loại, tên). Mã vắng (đã xoá cứng) coi là loại Giấy — xem `loai_cua`.
BangGiay = dict[int, ThongTinGiay]


def bang_giay(db: Session, ids: Iterable[int]) -> BangGiay:
    """Loại + tên của các mã giấy `ids` — MỘT truy vấn cho cả lượt lưu."""
    tap = {int(i) for i in ids if i}
    if not tap:
        return {}
    return {int(i): ThongTinGiay(loai or LOAI_GIAY, ten or "")
            for i, loai, ten in db.execute(select(GiayNguyen.id, GiayNguyen.loai, GiayNguyen.ten)
                                           .where(GiayNguyen.id.in_(tap)))}


def loai_cua(bang: BangGiay | None, gid: int) -> str:
    tt = (bang or {}).get(int(gid))
    return tt.loai if tt else LOAI_GIAY


def _gid(v) -> int:
    return int(v["vat_tu_id"] if isinstance(v, dict) else v.vat_tu_id)


def id_giay_cua_rows(rows: list) -> list[int]:
    """Id các dòng giấy của chuỗi `rows` (dict payload hoặc ORM), theo thứ tự bước rồi dòng, CÓ lặp."""
    return [_gid(v) for r in rows for v in _vat_tus(r) if _la_giay(v)]


def loi_tran_giay(ten_sp: str, ids: Iterable[int], bang: BangGiay, *,
                  chu_the: str = "Sản phẩm") -> str | None:
    """Câu lỗi khi một sản phẩm (hoặc một lệnh) có quá 1 mã Giấy hoặc quá 1 mã Sóng; None = hợp lệ.
    `ids` lặp được — cùng mã ở nhiều bước là MỘT mã."""
    theo_loai: dict[str, list[int]] = {}
    for gid in dict.fromkeys(int(i) for i in ids):
        theo_loai.setdefault(loai_cua(bang, gid), []).append(gid)
    for loai, chu in ((LOAI_GIAY, "giấy"), (LOAI_SONG, "sóng")):
        ds = theo_loai.get(loai, [])
        if len(ds) > 1:
            ten = ", ".join((bang.get(g).ten if bang.get(g) else f"#{g}") for g in ds)
            return (f"{chu_the} «{ten_sp}» đang có {len(ds)} {chu}: {ten}. "
                    f"Mỗi {chu_the.lower()} chỉ một {chu}.")
    return None


def _la_giay(v) -> bool:
    return (v.get("hang_loai") if isinstance(v, dict) else getattr(v, "hang_loai", None)) == HANG_GIAY


def _cd_id(r):
    return r.get("cong_doan_id") if isinstance(r, dict) else getattr(r, "cong_doan_id", None)


def _vat_tus(r) -> list:
    return (r.get("vat_tus") if isinstance(r, dict) else getattr(r, "vat_tus", None)) or []


NhomVaMa = Callable[[int | None], tuple[str | None, str | None]]


def nhom_va_ma_cong_doan(db: Session, cd_ids) -> NhomVaMa:
    """Bản tra `cong_doan_id → (nhóm, mã)` dựng bằng MỘT câu cho cả lượt lưu."""
    ids = {int(i) for i in cd_ids if i}
    bang: dict[int, tuple[str | None, str | None]] = {}
    if ids:
        bang = {int(i): (n, m) for i, n, m in db.execute(
            select(CongDoan.id, CongDoan.nhom, CongDoan.ma).where(CongDoan.id.in_(ids)))}
    return lambda cid: bang.get(int(cid), (None, None)) if cid else (None, None)


def _ten(bang: BangGiay, gid: int) -> str:
    tt = bang.get(int(gid))
    return tt.ten if tt and tt.ten else f"#{gid}"


def kiem_giay_song(db: Session, tp: dict, nhom_va_ma_cua: NhomVaMa, *,
                   bang: BangGiay | None = None) -> str | None:
    """Câu lỗi 422 cho một sản phẩm (`ThanhPhanIn.model_dump()`), None = hợp lệ.

    `giay_id` phải là mã loại Giấy, `song_id` mã loại Sóng (mã vắng khỏi danh mục: không chặn — FK mềm,
    phiếu cũ lưu lại được); có sóng thì chuỗi phải có bước mã thuộc `CD_BOI`; bước không mang giấy.
    `bang` nạp sẵn cho cả phiếu thì khỏi hỏi lại mỗi sản phẩm."""
    ten_sp = tp.get("ten") or "chưa đặt tên"
    rows = tp.get("thanh_phams") or []
    if any(_la_giay(v) for r in rows for v in _vat_tus(r)):
        return f"Sản phẩm «{ten_sp}»: giấy và sóng chọn ở sản phẩm, bước không mang giấy."
    gid, sid = tp.get("giay_id"), tp.get("song_id")
    if bang is None:
        bang = bang_giay(db, (gid, sid))
    if gid and int(gid) in bang and bang[int(gid)].loai != LOAI_GIAY:
        return f"Sản phẩm «{ten_sp}»: «{_ten(bang, gid)}» là sóng, chọn ở ô Sóng."
    if sid and int(sid) in bang and bang[int(sid)].loai != LOAI_SONG:
        return f"Sản phẩm «{ten_sp}»: «{_ten(bang, sid)}» là giấy, chọn ở ô Giấy."
    if sid and not any(nhom_va_ma_cua(_cd_id(r))[1] in CD_BOI for r in rows):
        return "Sản phẩm có sóng nhưng chuỗi chưa có bước bồi."
    return None


def chuyen_giay_buoc_len_san_pham(data: dict, bang: BangGiay) -> dict:
    """Cấu hình cũ (giấy là vật tư của bước) → giấy/sóng cấp sản phẩm, sửa TẠI CHỖ rồi trả lại.

    Có dòng giấy ở bước ⇒ mã loại Giấy đầu tiên thành `giay_id`, mã Sóng đầu tiên thành `song_id`, xoá
    các dòng đó khỏi bước — cùng luật mg 0445. Không dòng nào mà `giay_id` là mã sóng ⇒ sang `song_id`."""
    rows = data.get("thanh_phams") or []
    gids = id_giay_cua_rows(rows)
    if gids:
        data["giay_id"] = next((g for g in gids if loai_cua(bang, g) == LOAI_GIAY), None)
        data["song_id"] = next((g for g in gids if loai_cua(bang, g) == LOAI_SONG), None)
        for r in rows:
            if isinstance(r, dict) and r.get("vat_tus"):
                r["vat_tus"] = [v for v in r["vat_tus"] if not _la_giay(v)]
    elif data.get("giay_id") and loai_cua(bang, data["giay_id"]) == LOAI_SONG and not data.get("song_id"):
        data["song_id"], data["giay_id"] = data["giay_id"], None
    return data
