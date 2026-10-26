"""Guard chống N+1 ở các danh sách Kho.

Đếm số câu SQL của MỘT request danh sách khi có ít và nhiều phiếu. Số câu phải ĐỨNG YÊN khi số
dòng tăng — 26/10/2026 bản sao E2E đo danh sách phiếu kho 32 → 105 câu khi trang 5 → 27 dòng: mỗi
phiếu tra riêng kho, bốn người (lập, ghi sổ, đề nghị, duyệt) và đơn vị gốc của mặt hàng.
"""
from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import event

from app.db import engine

from .test_kho_de_nghi import _admin, _mk_material, _nhap, _setup


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


def _dung(client, kho_id: int, n: int, tien_to: str) -> None:
    """n phiếu nhập đã ghi sổ, mỗi phiếu một mặt hàng riêng."""
    for i in range(n):
        _nhap(client, kho_id=kho_id, mat_id=_mk_material(f"N1-{tien_to}-{i}"), qty=10, gia=1000)


DANH_SACH = ["/api/kho/phieu?size=50", "/api/kho/de-nghi?size=50"]


def test_danh_sach_kho_khong_hoi_db_tung_dong(client):
    kho_id, _mat = _setup(client)
    h = _admin(client)
    _dung(client, kho_id, 2, "A")
    it = {u: _so_cau(client, h, u) for u in DANH_SACH}
    _dung(client, kho_id, 8, "B")
    nhieu = {u: _so_cau(client, h, u) for u in DANH_SACH}
    print("\nSO CAU SQL kho (it -> nhieu):", {u: (it[u], nhieu[u]) for u in DANH_SACH})
    loi = {u: (it[u], nhieu[u]) for u in DANH_SACH if nhieu[u] > it[u] + 2}
    assert not loi, f"số câu SQL tăng theo số dòng: {loi}"
