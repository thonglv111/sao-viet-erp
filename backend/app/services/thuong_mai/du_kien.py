"""Dự kiến Xuất hàng + Thanh toán của đơn thương mại còn nháp — chỉ In Hà Phương (14/11/2026).

Trang Tạo / Sửa đơn gửi kèm lúc "Lưu nháp" để mở lại thấy đúng như đã chọn; ngăn đơn hiện ra cho người xem.
Nháp được phép dở dang nên KHÔNG kiểm chặt như lúc xuất thật (`giao_hang_hp.phuong_thuc.kiem`): chỉ giữ ô
thuộc cách đã chọn và bỏ giá trị lạ. Kiểm thật vẫn chạy khi bấm nút chính.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.giao_hang_hp import PT_DICH_VU, PT_LOAI, PT_NOI_BO
from ...repositories.thuong_mai_repo import ThuongMaiRepository

CACH_NHAN = ("cash", "bank_transfer")


def _so(v) -> int | None:
    try:
        return int(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def ghi(db: Session, *, order_id: int, actor, dk: dict | None) -> None:
    """Ghi đè dự kiến của đơn. `dk` vắng ⇒ giữ nguyên dòng cũ. Không commit — người gọi commit."""
    if dk is None:
        return
    repo = ThuongMaiRepository(db)
    row = repo.du_kien(order_id) or repo.them_du_kien(order_id)
    pt = dict(dk.get("phuong_thuc") or {})
    loai = pt.get("loai") if pt.get("loai") in PT_LOAI else None
    row.xuat_ngay = bool(dk.get("xuat_ngay", True))
    row.kho_id = _so(dk.get("kho_id"))
    row.giao_loai = loai
    row.nguoi_giao_id = _so(pt.get("nguoi_giao_id")) if loai == PT_NOI_BO else None
    row.xe_id = _so(pt.get("xe_id")) if loai == PT_NOI_BO else None
    row.don_vi_vc_id = _so(pt.get("don_vi_vc_id")) if loai == PT_DICH_VU else None
    cuoc = _so(pt.get("tien_cuoc")) if loai == PT_DICH_VU else None
    row.tien_cuoc = cuoc if cuoc is None or cuoc >= 0 else None
    row.ma_van_don = ((pt.get("ma_van_don") or "").strip()[:64] or None) if loai == PT_DICH_VU else None
    row.tra_ngay = bool(dk.get("tra_ngay", False))
    cach = dk.get("cach_nhan") if dk.get("cach_nhan") in CACH_NHAN else None
    row.cach_nhan = cach if row.tra_ngay else None
    row.company_bank_account_id = (_so(dk.get("company_bank_account_id"))
                                   if row.tra_ngay and cach == "bank_transfer" else None)
    row.nguoi_luu_id = actor.id


def doc(db: Session, order_id: int) -> dict | None:
    """Dự kiến của đơn kèm tên để hiện, hoặc None nếu chưa lưu lần nào."""
    repo = ThuongMaiRepository(db)
    row = repo.du_kien(order_id)
    if row is None:
        return None
    return {
        "xuat_ngay": row.xuat_ngay, "kho_id": row.kho_id,
        "phuong_thuc": ({"loai": row.giao_loai, "nguoi_giao_id": row.nguoi_giao_id, "xe_id": row.xe_id,
                         "don_vi_vc_id": row.don_vi_vc_id, "tien_cuoc": row.tien_cuoc,
                         "ma_van_don": row.ma_van_don} if row.giao_loai else None),
        "tra_ngay": row.tra_ngay, "cach_nhan": row.cach_nhan,
        "company_bank_account_id": row.company_bank_account_id,
        **repo.ten_du_kien(row),
    }
