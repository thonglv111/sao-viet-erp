"""Mã lượt/yêu cầu giao lấy ngày giờ VN (lỗi #69 bấm lại 19/10/2026).

Lượt tạo 00:15 ngày 19/10 giờ VN mang mã LX-261018-…, trong khi YCMH lập cùng đêm mang mã 261019.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.services import delivery_service


def test_ma_lap_luc_00g15_gio_vn_mang_ngay_vn(monkeypatch):
    monkeypatch.setattr(delivery_service, "_utcnow",
                        lambda: datetime(2026, 10, 18, 17, 15, tzinfo=timezone.utc))
    ma = delivery_service.sinh_ma_chung_tu("LX", lambda _ma: None)
    assert ma.startswith("LX-261019-")
