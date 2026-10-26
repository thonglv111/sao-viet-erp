"""MỘT chỗ hỏi chung: *"tháng này chốt lương chưa?"* — trước khi ghi thứ đổi tiền của kỳ lương.

VÌ SAO TÁCH RA MODULE RIÊNG
---------------------------
Cùng bệnh với kỳ công (`ky_cong_guard.py`): luật "kỳ lương đã chốt / đã chi thì khoá" đang chép ở ba
chỗ — tạm ứng (`PayrollService._chan_neu_ky_luong_da_khoa`), sửa tay khoán (`KhoanSuaTayService._ky_mo`),
dừng máy (`dung_may._chan_ky`). Còn các đường ghi khác thì không ai hỏi: sửa lần ghi sản lượng, cập nhật
lần ghi theo danh mục, đổi trạng thái hồ sơ lùi ngày, phiếu thu lùi ngày (hoa hồng). Bấm thử 25/10/2026
đo được cả bốn (L-SX-44, 47, 48, 43).

Kỳ hoa hồng KHÔNG phải kỳ riêng: hoa hồng gom theo cửa sổ tháng của kỳ lương
(`PayrollService._hoa_hong_map`), nên "kỳ hoa hồng đã chốt" chính là kỳ lương tháng đó đã chốt / đã chi.

CÁCH DÙNG
---------
Nhận SESSION (không phải service) để không sinh vòng service ↔ service::

    loi = ly_do_ky_luong_da_khoa(db, ngay_cua_me(batch.bat_dau), viec="sửa lần ghi")
    if loi:
        raise SanLuongError(loi)

Trả về CHUỖI thay vì tự ném lỗi: mỗi phân hệ có lớp lỗi riêng đã được router ánh xạ sẵn sang 409/422,
ném lỗi lạ ở đây là rơi ra 500. Câu báo phân biệt "đã chốt" và "đã chi" (NL-DM08).
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.payroll import PERIOD_LOCKED, PERIOD_PAID, PayrollPeriod


def ly_do_ky_luong_da_khoa(db: Session, *nhung_ngay: date | None, viec: str) -> str | None:
    """None = ghi được. Chuỗi = lý do chặn, đã viết sẵn cho người dùng đọc.

    Nhận NHIỀU ngày (ngày mới + ngày cũ khi sửa ngày): chỉ cần MỘT ngày rơi vào tháng có kỳ lương
    đã chốt / đã chi là chặn — kéo chứng từ ra khỏi kỳ đã khoá cũng là đổi số đã khoá.
    """
    da_hoi: set[tuple[int, int]] = set()
    for ngay in sorted(d for d in nhung_ngay if d is not None):
        ym = (ngay.year, ngay.month)
        if ym in da_hoi:
            continue
        da_hoi.add(ym)
        tt = db.scalar(select(PayrollPeriod.status)
                       .where(PayrollPeriod.year == ngay.year, PayrollPeriod.month == ngay.month))
        if tt == PERIOD_LOCKED:
            return (f"Kỳ lương tháng {ngay.month:02d}/{ngay.year} đã chốt — không {viec} của tháng đó "
                    f"được nữa. Mở lại kỳ lương trước.")
        if tt == PERIOD_PAID:
            return (f"Kỳ lương tháng {ngay.month:02d}/{ngay.year} đã chi — không {viec} của tháng đó "
                    f"được nữa. Huỷ 'đã chi' rồi mở lại kỳ lương trước.")
    return None
