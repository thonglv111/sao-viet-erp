"""AI LÀM một lần ghi sản lượng — đọc ảnh chụp `san_xuat_batch_nguoi` (10/10/2026, mg 0386).

Trước 10/10/2026 danh sách này SUY LÚC ĐỌC từ khoảng tham gia giao cửa sổ lần ghi + hỗ trợ chéo đã
xác nhận. Từ khi phát hành là giao cả tổ, khoảng tham gia không còn nói được ai đứng máy lần nào —
tổ tick người ngay lúc ghi (`nguoi_ghi.py`), ở đây chỉ đọc lại. Lần ghi cũ đã chép sang bảng theo
luật cũ ở mg 0386.

Không số phút, không phép chia (chốt 18/09/2026: *"ghi nhận thế thôi, đừng có chia bất cứ gì"*).
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from ...repositories.san_xuat_batch_nguoi_repo import SanXuatBatchNguoiRepository
from ..gio_xuong import ve_gio_xuong


def _aware(dt: datetime | None) -> datetime | None:
    """SQLite trả naive; so naive với aware là TypeError. Xem memory `me-gio-naive-lech-7-tieng`."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def ngay_cua_me(bat_dau: datetime | None) -> date | None:
    """Ngày của lần ghi = ngày theo GIỜ XƯỞNG của giờ bắt đầu — khoá để khớp `ngay_lam_viec` hỗ trợ."""
    d = ve_gio_xuong(_aware(bat_dau))
    return d.date() if d is not None else None


def nguoi_theo_me(db: Session, batch_ids: set[int] | list[int]) -> dict[int, list[dict]]:
    """{batch_id → [{employee_id, ho_ten, department_id, la_ho_tro}]} — một truy vấn cho cả trang.

    `department_id` là tổ GỐC lúc ghi; tab Sản lượng dùng để dán nhãn "(tổ bế)" cho người đi giúp."""
    ids = {int(i) for i in batch_ids}
    if not ids:
        return {}
    ra: dict[int, list[dict]] = {i: [] for i in ids}
    for r, ten in SanXuatBatchNguoiRepository(db).cua_nhieu(ids):
        ra[r.batch_id].append({
            "employee_id": r.employee_id,
            "ho_ten": ten or f"#{r.employee_id}",
            "department_id": r.department_id,
            "la_ho_tro": bool(r.la_ho_tro),
            "so_luong": float(r.so_luong) if r.so_luong is not None else None,
        })
    for ds in ra.values():
        ds.sort(key=lambda x: (x["ho_ten"], x["employee_id"]))
    return ra


def me_co_nguoi_cua_to(db: Session, batch_ids: set[int], to_ids: set[int]) -> set[int]:
    """Lần ghi nào có ít nhất một người thuộc `to_ids` — mục "người của tổ đi làm ở tổ khác"."""
    if not batch_ids or not to_ids:
        return set()
    theo_me = nguoi_theo_me(db, batch_ids)
    return {
        bid for bid, ds in theo_me.items()
        if any(n["department_id"] in to_ids for n in ds)
    }
