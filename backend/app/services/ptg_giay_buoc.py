"""Giấy là vật tư của BƯỚC trong phiếu tính giá (18/10/2026).

Giấy chọn ở ô "Thêm vật tư" của công đoạn như mọi vật tư (`phieu_buoc_vat_tu.hang_loai = 'giay'`).
`phieu_thanh_phan.giay_id` thôi là ô nhập: máy chủ chốt nó thành GIẤY CHÍNH lúc lưu — giấy ở bước In
(nhóm `print`), không có thì giấy ở công đoạn đầu tiên có giấy. Mọi nơi đang đọc `giay_id` (bài ghép,
quy cách lệnh, báo giá, kiểm gsm máy, biến `dinh_luong`) vì thế giữ nguyên.

Payload cũ (API, test, cấu hình tái bản chụp trước 18/10) gửi `giay_id` mà không dòng giấy nào ⇒
chuyển thành một dòng giấy ở bước In, đúng luật migration `0418` — không để giấy rơi mất.
"""
from __future__ import annotations

from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.cong_doan import CongDoan

HANG_GIAY = "giay"
NHOM_IN = "print"

NhomCua = Callable[[int | None], str | None]


def _la_giay(v) -> bool:
    return (v.get("hang_loai") if isinstance(v, dict) else getattr(v, "hang_loai", None)) == HANG_GIAY


def _cd_id(r):
    return r.get("cong_doan_id") if isinstance(r, dict) else getattr(r, "cong_doan_id", None)


def _vat_tus(r) -> list:
    return (r.get("vat_tus") if isinstance(r, dict) else getattr(r, "vat_tus", None)) or []


def giay_chinh(rows: list, nhom_cua: NhomCua) -> int | None:
    """Giấy chính của chuỗi `rows` (dict payload hoặc ORM `PhieuThanhPham`, đã xếp đúng thứ tự):
    giấy đầu tiên ở bước In đầu tiên có giấy; không bước In nào có giấy thì giấy đầu tiên ở bước
    đầu tiên có giấy; chuỗi không giấy ⇒ None."""
    dau_tien = None
    for r in rows:
        giay = [v for v in _vat_tus(r) if _la_giay(v)]
        if not giay:
            continue
        gid = int(giay[0]["vat_tu_id"] if isinstance(giay[0], dict) else giay[0].vat_tu_id)
        if nhom_cua(_cd_id(r)) == NHOM_IN:
            return gid
        if dau_tien is None:
            dau_tien = gid
    return dau_tien


def chuan_hoa_giay(data: dict, nhom_cua: NhomCua) -> dict:
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
    data["giay_id"] = giay_chinh(rows, nhom_cua)
    return data


def nhom_cong_doan(db: Session, cd_ids) -> NhomCua:
    """Bản tra `cong_doan_id → nhóm` dựng bằng MỘT câu cho cả lượt lưu."""
    ids = {int(i) for i in cd_ids if i}
    nhom: dict[int, str | None] = {}
    if ids:
        nhom = dict(db.execute(select(CongDoan.id, CongDoan.nhom).where(CongDoan.id.in_(ids))).all())
    return lambda cid: nhom.get(int(cid)) if cid else None
