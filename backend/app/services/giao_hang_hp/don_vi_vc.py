"""Danh sách đơn vị vận chuyển của giao hàng dịch vụ (13/11/2026, chỉ In Hà Phương).

Bảng riêng `don_vi_van_chuyen`, không dính nhà cung cấp. Người xuất hàng thêm, bỏ ngay ở ô Đơn vị vận
chuyển của hộp Xuất hàng. Các hãng phổ biến ở Việt Nam là GỢI Ý nằm trong code: chưa ai chọn thì không
có dòng nào trong DB (luật `SEED_DEMO=false` không ghi gì).
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...repositories.audit_repo import AuditLogRepository
from ...repositories.giao_hang_hp_repo import GiaoHangHpRepository

GOI_Y = (
    "Giao Hàng Nhanh (GHN)",
    "Giao Hàng Tiết Kiệm (GHTK)",
    "Viettel Post",
    "VNPost (Bưu điện)",
    "J&T Express",
    "Ninja Van",
    "SPX Express",
    "Best Express",
    "Ahamove",
    "Grab Express",
    "Lalamove",
    "Nhất Tín Logistics",
)


class DonViVcLoi(Exception):
    pass


def goi_y_con_lai(db: Session) -> list[str]:
    """Hãng phổ biến chưa có trong danh sách đang dùng."""
    dang = {d.ten.strip().lower() for d in GiaoHangHpRepository(db).don_vi_van_chuyen()}
    return [t for t in GOI_Y if t.lower() not in dang]


def them(db: Session, *, ten: str, actor) -> object:
    """Thêm (hoặc bật lại đơn vị cùng tên đã bỏ). Trùng tên đơn vị đang dùng thì trả lại đơn vị đó."""
    ten = " ".join((ten or "").split())
    if not ten:
        raise DonViVcLoi("Gõ tên đơn vị vận chuyển.")
    if len(ten) > 150:
        raise DonViVcLoi("Tên đơn vị vận chuyển tối đa 150 ký tự.")
    repo = GiaoHangHpRepository(db)
    row = repo.tim_dvvc_theo_ten(ten)
    if row is not None and row.active:
        return row
    if row is not None:
        row.active = True
    else:
        row = repo.them_dvvc(ten)
    AuditLogRepository(db).create(actor_user_id=actor.id, action="dvvc_them", target=f"dvvc:{row.id}",
                                  detail=row.ten, commit=False)
    db.commit()
    return row


def bo(db: Session, *, dvvc_id: int, actor) -> None:
    """Bỏ khỏi danh sách. Đã có lần giao thì chỉ tắt (lịch sử, cước chờ chi còn đọc tên); chưa thì xoá."""
    repo = GiaoHangHpRepository(db)
    row = repo.get_dvvc(dvvc_id)
    if row is None:
        raise DonViVcLoi("Không tìm thấy đơn vị vận chuyển.")
    AuditLogRepository(db).create(actor_user_id=actor.id, action="dvvc_bo", target=f"dvvc:{row.id}",
                                  detail=row.ten, commit=False)
    if repo.dvvc_da_dung(row.id):
        row.active = False
    else:
        repo.xoa_dvvc(row)
    db.commit()
