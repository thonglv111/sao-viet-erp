"""Thuê gia công — service (spec docs/superpowers/specs/2026-11-13-module-gia-cong-ngoai-design.md).

Lệnh sản xuất chỉ gắn cờ "Thuê ngoài" trên bước. Phát hành sinh VIỆC gia công vào Hàng chờ
(`viec.py`); đặt, giao, nhận, trả tiền đi qua Đơn / Phiếu giao / Phiếu nhận của module. Việc của tổ,
ghi sản lượng, KCS chỉ nhìn công việc thuê ngoài, không ghi.
"""
from __future__ import annotations

# Câu chặn chung cho mọi cửa xưởng (bàn tổ, ghi lần, KCS) gặp công việc thuê gia công.
CHAN_XUONG = (
    "Công việc thuê gia công — giao nhận ở màn Thuê gia công, không làm ở Việc của tổ hay KCS."
)

# Bàn giao của bước trước sang công việc thuê gia công: nhà gia công nhận bằng Phiếu giao.
CHAN_NHAN_TAY = (
    "Bước sau là việc thuê gia công — hàng được nhận bằng Phiếu giao ở màn Thuê gia công, "
    "không xác nhận tay ở đây."
)


class TgcXungDot(ValueError):
    """Chứng từ vừa bị người khác đổi (lệch `version`) — router dịch 409."""


def la_thue_ngoai(cv) -> bool:
    """Công việc thuộc một việc thuê gia công (không vào bàn tổ, không ghi sản lượng, không KCS)."""
    return getattr(cv, "tgc_viec_id", None) is not None


def so_vi(v) -> str:
    """Số kiểu Việt cho câu nhật ký: 5.000 · 1.250,5 · 1.000.000 (định dạng LÚC GHI)."""
    x = round(float(v), 3)
    nguyen, _, le = f"{abs(x):,.3f}".partition(".")
    le = le.rstrip("0")
    chu = nguyen.replace(",", ".") + ("," + le if le else "")
    return ("-" if x < 0 else "") + chu


def nhan_dv_chang(bang: dict[str, str], ma: str | None) -> str:
    """Nhãn đơn vị của bán thành phẩm / dòng đơn: cột giữ MÃ CHẶNG (`to` → "tờ in"), mã ngoài
    chặng mới tra danh mục Đơn vị. Cùng luật `nhanChang` ở `frontend/src/pages/lsxBuoc.ts`, để câu
    máy chủ dựng (chip trên lệnh, nhật ký, câu chặn) nói cùng chữ với màn."""
    from ...models.don_vi_do import nhan_tram
    from ...repositories.don_vi_do_repo import nhan_don_vi
    return nhan_tram(ma, ngan=True) or nhan_don_vi(bang, ma)


def kiem_version(obj, expected: int | None, ten: str = "Chứng từ") -> None:
    if expected is not None and int(expected) != int(obj.version):
        raise TgcXungDot(f"{ten} vừa được người khác cập nhật — tải lại rồi làm tiếp.")
