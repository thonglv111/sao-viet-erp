"""Cọc phải thu của một đơn bán (20/10/2026) — MỘT công thức cho mọi nơi đọc.

Đơn giữ cọc theo một trong hai cách, lưu cái này là xoá cái kia:
- `deposit_amount` — số tiền gõ thẳng (không vượt tổng đơn gồm VAT);
- `deposit_pct` — % trên tổng đơn gồm VAT.
"""
from __future__ import annotations


def coc_phai_thu(deposit_pct: float | None, deposit_amount: int | None, total_with_vat: int) -> int:
    """Số tiền cọc khách phải đưa. Số tiền thắng nếu có; không thì `round(% × tổng / 100)`; trống ⇒ 0."""
    if deposit_amount:
        return int(deposit_amount)
    if deposit_pct:
        return int(round(float(deposit_pct) * int(total_with_vat or 0) / 100))
    return 0


def co_coc(order) -> bool:
    """Đơn có đặt cọc (theo % hay theo số tiền)."""
    return bool((order.deposit_amount or 0) > 0 or (order.deposit_pct or 0) > 0)
