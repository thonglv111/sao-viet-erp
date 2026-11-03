"""Nhật ký của MỘT dòng tồn — tab "Lịch sử sửa" ở ngăn mặt hàng màn Tồn kho (03/11/2026).

Dòng tồn = mặt hàng × kho (giấy, vật tư thêm đơn vị gốc + khổ) — đúng khoá một dòng màn Tồn. Trước
ngày này nhật ký sửa tồn ghi theo KHO ("Nhập tay tồn kho Kho giấy: 2 cập nhật — A, B"), không lọc ra
được "ai đã sửa Couche 100". Từ đây mỗi dòng tồn đổi gì là một dòng nhật ký `target = ton:…`.

Tab gom bốn nguồn:
  · `ton:<khoá dòng>`  — sửa tồn / vị trí (nhập tay), đặt mức tồn.
  · `stock_lot:<id>`   — sửa giá gốc lô, bổ sung khổ cho lô cũ (đã ghi theo lô từ trước).
  · `<hang_loai>:<id>` — sửa mặt hàng ở danh mục (tên, mã, đơn vị…), chung mọi kho.
Chuyển kho có tab riêng nên không lặp ở đây.
"""
from __future__ import annotations

from .kho_giay import chuan_kho
from .nhat_ky_danh_muc import PHAN_CACH, _gom_dong

#: Hành động đọc ở tab — nhãn ngắn cho cột "Việc".
VIEC: dict[str, str] = {
    "kho_ton_sua": "Sửa tồn",
    "kho_muc_ton": "Đặt mức tồn",
    "kho_sua_gia_goc": "Sửa giá gốc",
    "kho_bo_sung_kho_lo": "Bổ sung khổ",
    "dm_tao": "Tạo ở danh mục",
    "dm_sua": "Sửa ở danh mục",
}


def target_dong_ton(kho_id: int, hang_loai: str, hang_id: int, goc: str | None = None,
                    kho_rong: int = 0, kho_dai: int = 0) -> str:
    """Khoá nhật ký của một dòng tồn. Đơn vị gốc chữ thường, khổ chuẩn hoá — cùng luật `_loc_kho`,
    để nhập tay, đặt mức và ngăn mặt hàng ra cùng một chuỗi."""
    kr, kd = chuan_kho(kho_rong, kho_dai)
    return f"ton:{int(kho_id)}:{hang_loai}:{int(hang_id)}:{(goc or '').strip().lower()}:{kr}x{kd}"


def gom(dong: list[str]) -> str:
    return _gom_dong([d for d in dong if d])


def tach(detail: str) -> list[str]:
    """Chi tiết → từng thay đổi một dòng (cùng dấu nối với nhật ký danh mục)."""
    return [p for p in (detail or "").split(PHAN_CACH) if p.strip()]
