"""Danh sách NHÀ GIA CÔNG (16/11/2026, chủ dự án: "logic như ô Đơn vị vận chuyển, không gán nút bật tắt
nhà cung cấp nữa").

Bảng riêng `tgc_nha_gia_cong`, không dính danh mục Nhà cung cấp — thuê gia công trả tiền bằng phiếu chi
riêng, không vào công nợ 331, nên nhà gia công chỉ cần cái tên. Người lập đơn thêm, bỏ ngay ở ô Nhà gia
công của hộp Lập đơn. Khuôn `services/giao_hang_hp/don_vi_vc.py`, không có hãng gợi ý.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...repositories.audit_repo import AuditLogRepository
from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository

TEN_TOI_DA = 255


class NhaGiaCongLoi(Exception):
    pass


def them(db: Session, *, ten: str, actor):
    """Thêm (hoặc bật lại nhà cùng tên đã bỏ). Trùng tên nhà đang dùng thì trả lại nhà đó."""
    ten = " ".join((ten or "").split())
    if not ten:
        raise NhaGiaCongLoi("Gõ tên nhà gia công.")
    if len(ten) > TEN_TOI_DA:
        raise NhaGiaCongLoi(f"Tên nhà gia công tối đa {TEN_TOI_DA} ký tự.")
    repo = ThueGiaCongRepository(db)
    row = repo.tim_nha_theo_ten(ten)
    if row is not None and row.active:
        return row
    if row is not None:
        row.active = True
    else:
        row = repo.them_nha(ten)
    AuditLogRepository(db).create(actor_user_id=getattr(actor, "id", None), action="tgc_nha_them",
                                  target=f"tgc_nha_gia_cong:{row.id}", detail=row.ten, commit=False)
    db.commit()
    return row


def bo(db: Session, *, nha_id: int, actor) -> None:
    """Bỏ khỏi danh sách. Đã có đơn thì chỉ tắt (đơn cũ, phiếu chi, bộ lọc còn đọc tên); chưa thì xoá."""
    repo = ThueGiaCongRepository(db)
    row = repo.get_nha_gia_cong(nha_id)
    if row is None:
        raise NhaGiaCongLoi("Không tìm thấy nhà gia công.")
    AuditLogRepository(db).create(actor_user_id=getattr(actor, "id", None), action="tgc_nha_bo",
                                  target=f"tgc_nha_gia_cong:{row.id}", detail=row.ten, commit=False)
    if repo.nha_da_co_don(row.id):
        row.active = False
    else:
        repo.xoa_nha(row)
    db.commit()
