"""Định dạng số trong CÂU cho người đọc (câu lỗi, ghi chú, nhật ký) — một chỗ cho mọi phân hệ.

Dời từ `luoi_vat_tu.py` (26/10/2026, L-VAI-42): câu lỗi / nhật ký tiền ở kế toán, mua hàng đang in số
kiểu Python ("1317600.0") trong khi màn hình in "1.317.600". Ai cần in số vào câu thì import ở đây.
"""

from __future__ import annotations


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def so_vn(x: float) -> str:
    """12345,5 → "12.345,5" — số trong câu ghi chú, cùng kiểu FE in số."""
    x = round(_f(x), 2)
    nguyen, _, le = f"{abs(x):,.2f}".partition(".")
    le = le.rstrip("0")
    s = nguyen.replace(",", ".") + ("," + le if le else "")
    return ("-" if x < 0 else "") + s
