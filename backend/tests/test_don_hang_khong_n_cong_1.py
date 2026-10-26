"""Guard chống N+1 ở danh sách Đơn hàng bán + số đếm "Đang chờ".

Đếm số câu SQL của MỘT request khi có ít và nhiều đơn. Số câu phải ĐỨNG YÊN khi số đơn tăng —
26/10/2026 bản sao E2E đo danh sách đơn 85 → 186 câu (trang 5 → 50), badge `dang-cho-dem` 166 câu:
mỗi đơn đã chuyển sản xuất dựng riêng nguồn giao theo cụm (~16 câu mỗi đơn).
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import event

from app.db import SessionLocal, engine
from app.models.order import Order
from tests.test_giao_hang_api import _admin, _don_da_chot, _tao_yc


@contextmanager
def dem_sql():
    dem = {"n": 0}

    def _nghe(*_a, **_k):
        dem["n"] += 1

    event.listen(engine, "before_cursor_execute", _nghe)
    try:
        yield dem
    finally:
        event.remove(engine, "before_cursor_execute", _nghe)


def _so_cau(client, h, url: str) -> int:
    with dem_sql() as d:
        r = client.get(url, headers=h)
    assert r.status_code == 200, r.text
    return d["n"]


def _dung(client, h, n: int, tien_to: str) -> None:
    """n đơn đã chốt + đã chuyển sản xuất, có tồn thành phẩm; một nửa đã lập yêu cầu giao."""
    for i in range(n):
        oid, lid = _don_da_chot(suffix=f"DHN1{tien_to}{i}")
        db = SessionLocal()
        try:
            db.get(Order, oid).san_xuat_released_at = datetime.now(timezone.utc)
            db.commit()
        finally:
            db.close()
        if i % 2 == 0:
            _tao_yc(client, h, oid, lid, qty=30)


DANH_SACH = ["/api/orders?size=50", "/api/orders/dang-cho-dem"]


def test_danh_sach_don_hang_khong_hoi_db_tung_dong(client):
    h = _admin(client)
    _dung(client, h, 2, "A")
    it = {u: _so_cau(client, h, u) for u in DANH_SACH}
    _dung(client, h, 6, "B")
    nhieu = {u: _so_cau(client, h, u) for u in DANH_SACH}
    print("\nSO CAU SQL don hang (it -> nhieu):", {u: (it[u], nhieu[u]) for u in DANH_SACH})
    loi = {u: (it[u], nhieu[u]) for u in DANH_SACH if nhieu[u] > it[u] + 2}
    assert not loi, f"số câu SQL tăng theo số dòng: {loi}"
