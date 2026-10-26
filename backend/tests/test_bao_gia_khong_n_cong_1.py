"""Guard chống N+1 ở danh sách Báo giá.

Đếm số câu SQL của MỘT request danh sách khi có ít và nhiều báo giá. Số câu phải ĐỨNG YÊN khi số
dòng tăng — 26/10/2026 bản sao E2E đo 20 → 74 câu khi trang 5 → 21 dòng: mỗi dòng nạp riêng phiên
bản + dòng hàng, mỗi báo giá CHỜ DUYỆT hỏi lại phạm vi của từng người duyệt.
"""
from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import event

from app.db import engine
from tests.test_quotation_approval import _h, _make_high_value_quote, _role_token, _token


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


def _dung(client, token, n: int) -> None:
    """n báo giá đặc thù, một nửa đã trình duyệt (cột "Người duyệt" phải dò người duyệt được)."""
    for i in range(n):
        q = _make_high_value_quote(client, token)
        if i % 2 == 0:
            r = client.post(f"/api/quotations/{q['id']}/transition",
                            json={"to_status": "pending_approval"}, headers=_h(token))
            assert r.status_code == 200, r.text


def _so_cau(client, h, url: str) -> int:
    with dem_sql() as d:
        r = client.get(url, headers=h)
    assert r.status_code == 200, r.text
    return d["n"]


def test_danh_sach_bao_gia_khong_hoi_db_tung_dong(client):
    token = _token(client)
    h = _h(token)
    # Người duyệt phạm vi PHÒNG — xét "báo giá này trong phạm vi của họ không" mới phải đọc DB.
    _role_token("tpkd_n1", "Trưởng phòng KD")
    url = "/api/quotations?size=50"
    _dung(client, token, 2)
    it = _so_cau(client, h, url)
    _dung(client, token, 8)
    nhieu = _so_cau(client, h, url)
    print("\nSO CAU SQL bao gia (it -> nhieu):", it, nhieu)
    assert nhieu <= it + 2, f"{url}: {it} -> {nhieu} câu khi tăng số dòng"
