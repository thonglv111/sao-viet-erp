"""Phân hệ TẮT theo bản cài (docs/prd-tat-phan-he-theo-ban-cai.md).

In Hà Phương dùng chung code với Sao Việt Nhật nhưng không dùng lương, tiền khoán, hoa hồng, giao
hàng. Tắt bằng `PHAN_HE_TAT`, KHÔNG xoá code: bản tách merge `svn/dev` định kỳ, xoá là lần nào cũng
xung đột. Bảng, migration, import chéo giữ nguyên — sản xuất / kế toán còn gọi chốt kỳ lương, mà tắt
lương thì không kỳ nào bị khoá nên các chốt đó tự không bao giờ chặn.

Cổng chính nằm ở `AuthorizationService`: module của phân hệ tắt coi như MỌI vai không có quyền, kể cả
admin ⇒ thanh bên tự ẩn, router trả 403, ma trận không hiện. Phần nằm TRONG màn khác (tab Khoán của
Công đoạn, cột tiền ở Việc của tổ…) giao diện tự ẩn theo `phan_he_tat` của `/api/auth/permissions`.
"""
from __future__ import annotations

from .config import get_settings

LUONG = "luong"
KHOAN = "khoan"
HOA_HONG = "hoa_hong"
GIAO_HANG = "giao_hang"
TAI_SAN = "tai_san"
CHAM_CONG = "cham_cong"
SUA_CHUA = "sua_chua"
# Kê giá ở báo giá (03/11/2026): không có module riêng, tắt thì kê luôn 0, rào kê của khách bỏ qua.
KE_GIA = "ke_gia"
CAC_PHAN_HE = (LUONG, KHOAN, HOA_HONG, GIAO_HANG, TAI_SAN, CHAM_CONG, SUA_CHUA, KE_GIA)

# Module quyền mất hẳn khi tắt phân hệ. `khoan` / `hoa_hong` không có module riêng — chúng nằm
# trong màn khác nên tắt bằng cờ ở service và giao diện.
MODULE_CUA_PHAN_HE: dict[str, frozenset[str]] = {
    LUONG: frozenset({"luong"}),
    GIAO_HANG: frozenset({"giao_hang", "dm_xe"}),
    TAI_SAN: frozenset({"tai_san"}),
    # Chấm công kéo theo nghỉ phép, tăng ca, đi muộn về sớm, yêu cầu chỉnh công (03/11/2026).
    CHAM_CONG: frozenset({"cham_cong", "yeu_cau_chinh_cong", "nghi_phep", "tang_ca", "di_muon"}),
    # Sửa chữa & bảo dưỡng: Sửa chữa máy + Phiếu bảo trì (03/11/2026). `may-chon` của router
    # ky_thuat_may gác theo quyền tổ, không theo module ⇒ bàn tổ vẫn Đổi máy được.
    SUA_CHUA: frozenset({"ky_thuat_may", "phieu_bao_tri"}),
}


def phan_he_tat() -> frozenset[str]:
    """Tập phân hệ đang tắt. Đọc lại mỗi lần (rẻ) để test đổi `settings.phan_he_tat` là ăn ngay."""
    chuoi = get_settings().phan_he_tat or ""
    return frozenset(t.strip().lower() for t in chuoi.split(",") if t.strip())


def tat(ten: str) -> bool:
    return ten in phan_he_tat()


def module_bi_tat(module_key: str) -> bool:
    tat_ = phan_he_tat()
    return any(module_key in ds for ph, ds in MODULE_CUA_PHAN_HE.items() if ph in tat_)


def chan_khi_tat(ten: str):
    """Dependency gắn cả router: phân hệ tắt ⇒ 404 cho MỌI đường, kể cả đường "của tôi" (phiếu lương,
    tạm ứng của tôi) vốn không đi qua cổng quyền module."""
    from fastapi import HTTPException, status

    def dependency() -> None:
        if tat(ten):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail="Phân hệ này không dùng ở bản cài hiện tại")

    return dependency
