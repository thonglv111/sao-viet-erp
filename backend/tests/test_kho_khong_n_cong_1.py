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


def test_bao_cao_nxt_khong_hoi_db_tung_kho(client):
    """Báo cáo Nhập–Xuất–Tồn: tên kho nạp một câu (bản sao: mỗi kho một SELECT kho_hang)."""
    from datetime import date

    kho_dau, _mat = _setup(client)
    h = _admin(client)
    hom_nay = date.today()
    url = f"/api/kho/bao-cao/nxt?tu={hom_nay.replace(day=1)}&den={hom_nay}"

    def _them_kho(n: int, tien_to: str) -> None:
        for i in range(n):
            r = client.post("/api/kho", json={"ten": f"Kho NXT {tien_to}{i}"}, headers=h)
            assert r.status_code in (200, 201), r.text
            _nhap(client, kho_id=r.json()["id"], mat_id=_mk_material(f"NXT-{tien_to}-{i}"),
                  qty=5, gia=1000)

    _nhap(client, kho_id=kho_dau, mat_id=_mk_material("NXT-0"), qty=5, gia=1000)
    _them_kho(1, "A")
    it = _so_cau(client, h, url)
    _them_kho(6, "B")
    nhieu = _so_cau(client, h, url)
    ten = {r["kho_ten"] for r in client.get(url, headers=h).json()["items"]}
    assert {f"Kho NXT B{i}" for i in range(6)} <= ten
    print("\nSO CAU SQL nxt (2 -> 8 kho):", it, nhieu)
    assert nhieu <= it, f"{url}: {it} -> {nhieu} câu khi tăng số kho"
