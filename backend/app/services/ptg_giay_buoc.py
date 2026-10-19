"""Giấy là vật tư của BƯỚC trong phiếu tính giá (18/10/2026).

Giấy chọn ở ô "Thêm vật tư" của công đoạn như mọi vật tư (`phieu_buoc_vat_tu.hang_loai = 'giay'`).
`phieu_thanh_phan.giay_id` thôi là ô nhập: máy chủ chốt nó thành GIẤY CHÍNH lúc lưu — giấy ở bước In
(nhóm `print`), không có thì giấy ở công đoạn đầu tiên có giấy. Mọi nơi đang đọc `giay_id` (bài ghép,
quy cách lệnh, báo giá, kiểm gsm máy, biến `dinh_luong`) vì thế giữ nguyên.

Payload cũ (API, test, cấu hình tái bản chụp trước 18/10) gửi `giay_id` mà không dòng giấy nào ⇒
chuyển thành một dòng giấy ở bước In, đúng luật migration `0419` — không để giấy rơi mất.

LOẠI Giấy / Sóng (19/10/2026, mg 0426): một sản phẩm có TỐI ĐA 1 mã loại Giấy + 1 mã loại Sóng
(`loi_tran_giay`, cùng mã lặp ở nhiều bước vẫn là một mã). Giấy chính là mã loại Giấy; chỉ có Sóng
thì là mã Sóng — để bình bài/khổ/định lượng vẫn có số. Thiếu giấy KHÔNG chặn.
"""
from __future__ import annotations

from typing import Callable, Iterable, NamedTuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.cong_doan import CongDoan
from ..models.vat_lieu_kho import LOAI_GIAY, LOAI_SONG, GiayNguyen

HANG_GIAY = "giay"
NHOM_IN = "print"

NhomCua = Callable[[int | None], str | None]


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


def giay_chinh(rows: list, nhom_cua: NhomCua, bang: BangGiay | None = None) -> int | None:
    """Giấy chính của chuỗi `rows` (dict payload hoặc ORM `PhieuThanhPham`, đã xếp đúng thứ tự).

    Ứng viên là các dòng loại Giấy; không có thì các dòng loại Sóng. Trong ứng viên: dòng đầu tiên ở
    bước In đầu tiên có ứng viên; không bước In nào có thì dòng đầu tiên ở bước đầu tiên có. Chuỗi
    không giấy ⇒ None. `bang=None` ⇒ mọi mã coi là loại Giấy (hành vi trước khi có loại)."""
    for loai in (LOAI_GIAY, LOAI_SONG):
        dau_tien = None
        for r in rows:
            ung_vien = [v for v in _vat_tus(r) if _la_giay(v) and loai_cua(bang, _gid(v)) == loai]
            if not ung_vien:
                continue
            if nhom_cua(_cd_id(r)) == NHOM_IN:
                return _gid(ung_vien[0])
            if dau_tien is None:
                dau_tien = _gid(ung_vien[0])
        if dau_tien is not None:
            return dau_tien
    return None


def chuan_hoa_giay(data: dict, nhom_cua: NhomCua, bang: BangGiay | None = None) -> dict:
    """Chuẩn hoá `ThanhPhanIn.model_dump()` tại chỗ rồi trả lại chính nó.

    1. Có `giay_id` mà chưa bước nào có dòng giấy ⇒ thêm dòng giấy vào bước In đầu tiên (không có
       thì bước đầu chuỗi).
    2. Chuỗi có bước ⇒ `giay_id` = giấy chính dẫn xuất (None khi không bước nào có giấy — người dùng
       đã xoá giấy thì giấy chính cũng đi theo). Chuỗi rỗng ⇒ giữ `giay_id` như gửi lên.
    """
    rows = data.get("thanh_phams") or []
    if not rows:
        return data
    gid = data.get("giay_id")
    if gid and not any(_la_giay(v) for r in rows for v in _vat_tus(r)):
        dich = next((r for r in rows if nhom_cua(_cd_id(r)) == NHOM_IN), rows[0])
        dich["vat_tus"] = [*_vat_tus(dich), {"hang_loai": HANG_GIAY, "vat_tu_id": int(gid),
                                             "gia_tri_chip": None}]
    data["giay_id"] = giay_chinh(rows, nhom_cua, bang)
    return data


def nhom_cong_doan(db: Session, cd_ids) -> NhomCua:
    """Bản tra `cong_doan_id → nhóm` dựng bằng MỘT câu cho cả lượt lưu."""
    ids = {int(i) for i in cd_ids if i}
    nhom: dict[int, str | None] = {}
    if ids:
        nhom = dict(db.execute(select(CongDoan.id, CongDoan.nhom).where(CongDoan.id.in_(ids))).all())
    return lambda cid: nhom.get(int(cid)) if cid else None
