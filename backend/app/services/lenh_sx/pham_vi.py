"""Phạm vi dữ liệu của hai màn chỉ-đọc (Hồ sơ lệnh, Theo dõi sản xuất) — ĐÚNG luật Đơn hàng bán.

12/10/2026: đơn nào người đó thấy ở Đơn hàng bán thì xuống hai màn này thấy đúng đơn đó, kèm mọi
lệnh của nó. Chủ đơn = sale phụ trách KHÁCH, thiếu thì sale ghi trên đơn (`org_scope.chu_theo_khach`);
"Của tôi" gồm cả người CÙNG NHÓM DÙNG CHUNG (`org_scope.nhom_dung_chung_user_ids`). Trước đó hai màn
lọc thẳng `orders.sale_user_id`: khách đã chuyển cho người khác thì người mới không thấy lệnh.

MỨC phạm vi (own / department / all) vẫn đọc từ ô quyền của CHÍNH màn gọi: chủ xưởng có thể có
`theo_doi_san_xuat:all` mà không có quyền gì ở Đơn hàng bán.

Từ 14/10/2026 Kế hoạch SX (`routers/lsx.py::_owner_ids_for_scope`) cũng gọi hàm này với khoá
`san_xuat` — cả ba màn đi theo "lệnh này bán cho ai". Trước đó Kế hoạch SX tính theo người tạo /
phụ trách lệnh.

Lệnh CHƯA xuống xưởng không thuộc phạm vi của bất kỳ ai ở đây: hai màn này nói về việc đã thả
xuống xưởng. Lệnh nháp/đang lập vẫn xem ở màn Kế hoạch sản xuất.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.lsx import TT_DA_XUONG_XUONG, Lsx
from ...models.order import STATUS_ORDERED, Order
from ...models.role import SCOPE_ALL, SCOPE_DEPARTMENT, SCOPE_OWN
from ...models.user import User
from ...repositories.org_scope import chu_cua, chu_theo_khach, dept_subtree_ids, nhom_dung_chung_user_ids


def sale_ids_theo_pham_vi(db: Session, user: User, authz, module_key: str) -> set[int] | None:
    """Tập `users.id` CHỦ ĐƠN mà `user` được nhìn. `None` = thấy tất cả.

    Thiếu khai scope ⇒ hẹp nhất (`own`), không phải rộng nhất — mở nhầm còn tệ hơn khoá nhầm.
    """
    scope = authz.scope_for(user, module_key) or SCOPE_OWN
    if scope == SCOPE_ALL:
        return None
    if scope == SCOPE_DEPARTMENT:
        dept_ids = dept_subtree_ids(db, user.department_id)
        if dept_ids:
            ids = db.execute(select(User.id).where(User.department_id.in_(dept_ids))).scalars().all()
            return set(ids) | {user.id}
        return {user.id}
    return nhom_dung_chung_user_ids(db, user.id)


def phu_trach_ids_theo_pham_vi(db: Session, user: User, authz, module_key: str) -> set[int] | None:
    """Tập `users.id` NGƯỜI PHỤ TRÁCH mà `user` được nhìn (08/11/2026, Lệnh sản xuất + tab Tạo lệnh).
    Của tôi = chính mình; Cả phòng = người trong phòng mình và phòng con; Tất cả = None."""
    scope = authz.scope_for(user, module_key) or SCOPE_OWN
    if scope == SCOPE_ALL:
        return None
    if scope == SCOPE_DEPARTMENT:
        dept_ids = dept_subtree_ids(db, user.department_id)
        if dept_ids:
            ids = db.execute(select(User.id).where(User.department_id.in_(dept_ids))).scalars().all()
            return set(ids) | {user.id}
    return {user.id}


def chu_don():
    """Biểu thức SQL chủ của một đơn — cùng một biểu thức với `OrderRepository._scope_condition`."""
    return chu_theo_khach(Order.customer_id, Order.sale_user_id)


def loc_don(stmt, sale_ids: set[int] | None):
    """Gắn điều kiện phạm vi vào một câu đã có `Order` trong FROM. `None` ⇒ không lọc."""
    if sale_ids is None:
        return stmt
    return stmt.where(chu_don().in_(sale_ids))


def loc_lsx_da_phat_hanh(stmt, sale_ids: set[int] | None):
    """Gắn hai điều kiện vào một `select(Lsx)`: đã xuống xưởng (đang chạy hoặc đã đóng) + trong phạm vi.

    `sale_ids is None` ⇒ chỉ lọc trạng thái. Đơn không có chủ (khách chưa gán sale, đơn không ghi
    sale) rơi ra ngoài mọi phạm vi hẹp — chỉ `all` thấy, đúng chủ ý: không gán bừa cho ai.
    """
    stmt = stmt.where(Lsx.trang_thai.in_(TT_DA_XUONG_XUONG))
    if sale_ids is None:
        return stmt
    return loc_don(stmt.join(Order, Order.id == Lsx.order_id), sale_ids)


def _don_trong_pham_vi(db: Session, order: Order | None, sale_ids: set[int] | None) -> bool:
    if sale_ids is None:
        return True
    return order is not None and chu_cua(db, order.customer_id, order.sale_user_id) in sale_ids


def chan_ngoai_pham_vi(db: Session, lsx: Lsx | None, sale_ids: set[int] | None) -> None:
    """404 khi lệnh không có / chưa xuống xưởng, 403 khi có thật mà ngoài phạm vi.

    Dùng 403 chứ không 404: hai màn này là bàn tra cứu, người dùng CẦN biết "có lệnh đó nhưng
    không thuộc phần việc của bạn" để đi hỏi đúng người, thay vì tưởng gõ nhầm mã.
    """
    if lsx is None or lsx.trang_thai not in TT_DA_XUONG_XUONG:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lệnh sản xuất đã phát hành")
    if _don_trong_pham_vi(db, db.get(Order, lsx.order_id) if lsx.order_id else None, sale_ids):
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Lệnh sản xuất ngoài phạm vi của bạn")


def chan_don_ngoai_pham_vi(db: Session, order: Order | None, sale_ids: set[int] | None) -> None:
    """Cùng luật cho ngăn đơn của Theo dõi: 404 khi đơn không có hoặc chưa giao xưởng, 403 khi
    ngoài phạm vi. Thân lỗi không mang chữ nào của nội dung đơn."""
    if order is None or order.status != STATUS_ORDERED or order.san_xuat_released_at is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy đơn đã giao xưởng")
    if _don_trong_pham_vi(db, order, sale_ids):
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Đơn hàng ngoài phạm vi của bạn")
