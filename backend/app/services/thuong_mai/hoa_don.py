"""Hoá đơn bán của đơn thương mại lập theo LƯỢT XUẤT (docs/design-hang-thuong-mai-ha-phuong.md §6
"Hoá đơn theo lượt xuất").

Đơn thương mại không đi chuyến giao, nên lượt xuất "đã xuất" đóng vai lượt khách đã nhận. Hàm ở đây
dựng lượt xuất thành đúng dáng chuyến giao mà `hoa_don_theo_giao.gia_tri_luot_giao` và
`chi_ck_ke.ck_ke_luot` đang đọc (`id`, `lines[].order_line_id/qty_giao`, `request.code`, `lan_thu`,
`thoi_gian_ket_thuc`) — cách tính cộng dồn và chia chiết khấu dùng lại nguyên, không chép.
"""
from __future__ import annotations

from types import SimpleNamespace

from sqlalchemy.orm import Session

from ...repositories.thuong_mai_repo import ThuongMaiRepository


def luot_xuat_nhu_luot_giao(db: Session, order) -> list[SimpleNamespace]:
    ra = []
    for l in ThuongMaiRepository(db).luot_cua_don(order.id, chi_da_xuat=True):
        ra.append(SimpleNamespace(
            id=l.id,
            lines=[SimpleNamespace(order_line_id=d.order_line_id, qty_giao=int(d.qty_thuc or 0))
                   for d in l.dong],
            request=SimpleNamespace(code=l.ma),
            lan_thu=1,
            thoi_gian_ket_thuc=l.xuat_luc,
        ))
    return ra


def hoa_don_da_ghi_theo_luot(db: Session, order_id: int) -> dict[int, int]:
    return ThuongMaiRepository(db).hoa_don_da_ghi_theo_luot(order_id)
