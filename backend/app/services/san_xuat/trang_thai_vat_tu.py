"""Trạng thái vật tư của một bước (spec 2026-10-18 §5.1) — Bàn tổ (cột, bộ lọc vướng), cổng Bắt
đầu và ngăn chi tiết đọc CHUNG hàm này, để chip và cổng không bao giờ nói hai chuyện khác nhau.

Mỗi yêu cầu kho còn tính của bước (lần đầu + bổ sung) xếp một mức theo trạng thái kho; mức của
bước là mức chưa xong sớm nhất. "Sẵn sàng" đo theo YÊU CẦU, không đo theo định mức: kho chốt thực
xuất thiếu là kho đã quyết xong phần mình, vẫn Sẵn sàng.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.stock_request import (
    REQ_APPROVED, REQ_DONE, REQ_DRAFT, REQ_PARTIAL, REQ_PENDING, REQ_PREPARING, REQ_RECEIVED,
)
from ...repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from ...repositories.san_xuat_vat_tu_repo import SanXuatVatTuRepository

MUC_VT = ("chua_yeu_cau", "cho_kho", "kho_dang_soan", "cap_thieu", "san_sang")
_MUC_KHO = {
    REQ_DRAFT: "cho_kho", REQ_PENDING: "cho_kho", REQ_APPROVED: "cho_kho", REQ_RECEIVED: "cho_kho",
    REQ_PREPARING: "kho_dang_soan", REQ_PARTIAL: "cap_thieu", REQ_DONE: "san_sang",
}
_THU_TU = {m: i for i, m in enumerate(MUC_VT)}

_LY_DO = {
    "chua_yeu_cau": "Chưa có yêu cầu vật tư còn hiệu lực. Gửi yêu cầu ở tab Vật tư trước.",
    "cho_kho": "Vật tư chưa sẵn sàng: đang chờ kho. Đợi kho xuất xong mới bắt đầu được.",
    "kho_dang_soan": "Vật tư chưa sẵn sàng: kho đang soạn. Đợi kho xuất xong mới bắt đầu được.",
    "cap_thieu": "Vật tư chưa sẵn sàng: kho mới cấp một phần. Đợi kho xuất nốt mới bắt đầu được.",
}


def ly_do_vat_tu(muc: str) -> str:
    """Câu chặn Bắt đầu cho một mức chưa Sẵn sàng."""
    return _LY_DO[muc]


def chan_bat_dau(muc: str | None) -> bool:
    return muc is not None and muc != "san_sang"


def trang_thai_vat_tu(db: Session, cvs: list) -> dict[int, dict | None]:
    """`{cv_id: None | {"muc", "mon": [...]}}`. None = bước không cần vật tư. Cả lô tốn tối đa
    4 câu truy vấn: lần đề nghị kèm trạng thái kho, dòng yêu cầu, tên hàng (mỗi loại hàng một câu)."""
    ids = sorted({cv.id for cv in cvs})
    ra: dict[int, dict | None] = {i: None for i in ids}
    if not ids:
        return ra
    vt = SanXuatVatTuRepository(db)
    theo_cv = vt.yeu_cau_cua_cong_viec(ids)
    req_ids = [rid for ds in theo_cv.values() for _lan, rid, tt in ds if _MUC_KHO.get(tt)]
    dong = vt.dong_yeu_cau(req_ids)
    ten = SanXuatSanLuongRepository(db).ten_hang_nhieu(
        {(d["hang_loai"], d["hang_id"]) for ds in dong.values() for d in ds})

    can = {cv.id: bool(cv.can_vat_tu) for cv in cvs}
    for cid in ids:
        muc_buoc = None
        mon = []
        for lan, rid, tt in theo_cv.get(cid, []):
            muc = _MUC_KHO.get(tt)
            if muc is None:          # cancelled / rejected: không tính
                continue
            if muc_buoc is None or _THU_TU[muc] < _THU_TU[muc_buoc]:
                muc_buoc = muc
            for d in dong.get(rid, []):
                xin = float(d["sl_de_nghi"] or 0)
                chot = d["sl_chot_thuc_xuat"]
                mon.append({
                    "ten": ten.get((d["hang_loai"], d["hang_id"])) or f"#{d['hang_id']}",
                    "dvt": d["dvt"], "sl_xin": xin, "sl_da_xuat": float(d["sl_da_ung"] or 0),
                    "chot_thieu": chot is not None and float(chot) < xin - 0.005,
                    "lan_so": lan, "muc": muc,
                })
        if muc_buoc is None:
            ra[cid] = {"muc": "chua_yeu_cau", "mon": []} if can[cid] else None
        else:
            ra[cid] = {"muc": muc_buoc, "mon": mon}
    return ra
