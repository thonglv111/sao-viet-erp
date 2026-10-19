"""Cột "Lãi" ở danh sách báo giá = markup bình quân của chi tiết (lỗi #11 bấm thử 18/10/2026).

Danh sách lấy `margin_percent` của DÒNG ĐẦU, trước chiết khấu (25%), trong khi chi tiết cùng báo
giá ghi markup bình quân sau chiết khấu (19%). Luật (giống khối "Giá bán đề xuất"): lợi nhuận ÷
(giá vốn + chiết khấu), cộng số đã làm tròn từng dòng; khách chốt một phần thì chỉ dòng khách lấy.
"""
from __future__ import annotations

from app.models.quotation import QuoteItem
from app.services.quotation_service import markup_binh_quan


def _dong(cost, ck, sell, *, margin=25, accepted=False) -> QuoteItem:
    return QuoteItem(total_cost_snapshot=cost, discount_amount=ck, selling_price=sell,
                     margin_percent=margin, accepted=accepted)


def test_lai_danh_sach_bang_lai_binh_quan_sau_chiet_khau():
    # Dòng đầu markup 25% trước chiết khấu; dòng hai bán sát vốn ⇒ bình quân thấp hơn hẳn.
    ds = [_dong(1_000_000, 0, 1_250_000), _dong(1_000_000, 100_000, 1_130_000, margin=3)]
    lai = markup_binh_quan(ds, "draft")
    assert round(lai, 4) == round((2_380_000 - 2_000_000 - 100_000) / 2_100_000 * 100, 4)
    assert round(lai) == 13


def test_lai_chot_mot_phan_chi_tinh_dong_khach_lay():
    ds = [_dong(1_000_000, 0, 1_250_000, accepted=True), _dong(1_000_000, 0, 1_000_000)]
    assert markup_binh_quan(ds, "accepted") == 25
    assert markup_binh_quan(ds, "draft") == 12.5
    assert markup_binh_quan([], "draft") is None
