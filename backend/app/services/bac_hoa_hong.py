"""Biểu bậc hoa hồng theo SỐ NGÀY THU TIỀN (chủ chốt 23/10/2026, sổ lương T08).

Biểu = danh sách bậc tăng dần `[{"den_ngay": 45, "pct": 0.03}, …, {"den_ngay": None, "pct": 0}]`:
khoản thu sau `n` ngày ăn % của bậc ĐẦU TIÊN có `n <= den_ngay`; bậc cuối `den_ngay = None` là vô hạn.
% là PHÂN SỐ (0.03 = 3%). NULL / rỗng = người đó không hưởng hoa hồng.

Ví dụ trong sổ: CTV 3/2/1/0% theo 45/60/75 ngày; lãnh đạo một bậc "mọi số ngày 0,5%".
"""
from __future__ import annotations


def pct_theo_bac(bac: list[dict] | None, so_ngay: int) -> float:
    """% của khoản thu sau `so_ngay` ngày. Thu trước hoá đơn (ngày âm) coi như 0 ngày."""
    n = max(0, int(so_ngay))
    for b in bac or []:
        den = b.get("den_ngay")
        if den is None or n <= int(den):
            return float(b.get("pct") or 0)
    return 0.0


def chuan_hoa_bac(bac: list[dict] | None) -> list[dict] | None:
    """Kiểm biểu trước khi lưu. Rỗng ⇒ None. Sai ⇒ `ValueError` (câu tiếng Việt cho người khai)."""
    if not bac:
        return None
    ra: list[dict] = []
    truoc = -1
    for i, b in enumerate(bac):
        den = b.get("den_ngay")
        pct = float(b.get("pct") or 0)
        if not 0 <= pct <= 1:
            raise ValueError("% hoa hồng phải từ 0 đến 100%.")
        cuoi = i == len(bac) - 1
        if den is None:
            if not cuoi:
                raise ValueError("Chỉ bậc cuối được để trống số ngày.")
        else:
            den = int(den)
            if den <= truoc:
                raise ValueError("Mốc số ngày phải tăng dần.")
            truoc = den
        ra.append({"den_ngay": den, "pct": pct})
    if ra[-1]["den_ngay"] is not None:
        raise ValueError("Bậc cuối phải là không giới hạn số ngày.")
    return ra
