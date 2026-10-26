"""Guard số câu SQL của màn Kế hoạch vật tư — cách nhìn "Theo lệnh" (26/10/2026).

Đo bản sao trước khi sửa: `/api/ke-hoach-vat-tu/theo-lenh` 76 câu cho 6 thẻ, trong đó danh sách
phiếu mua đang về (`dong_dang_ve`, mỗi lần 4 câu kèm dòng + đợt giao + dòng đợt) bị đọc lại 7 lần,
trạng thái nhập kho của đợt (`trang_thai_nhap_dot`) 4 lần, YCMH đang đề nghị 2 lần — vì
`theo_chu_the` dựng bảng cân đối KHÔNG trong khối nhớ `nho_phieu_mua` như `/can-doi` vẫn làm.

`/can-doi` (bản dựng nguội 43 câu) đã nạp gộp hết — mỗi nguồn 1–2 câu, không có câu nào lặp theo
dòng — nên không có guard riêng ở đây.
"""
from __future__ import annotations

from contextlib import contextmanager

import pytest
from sqlalchemy import event

from app.db import SessionLocal, engine
from app.models.customer import Customer
from app.repositories.purchase_repo import DepartmentPurchaseRequestRepository, PurchaseRequestRepository
from tests.test_ke_hoach_vat_tu import MAI, _giay, _lenh, _phieu_mua, _ycmh

URL = "/api/ke-hoach-vat-tu/theo-lenh"


@pytest.fixture
def h(client, seed_credentials) -> dict[str, str]:
    tok = client.post("/api/auth/login", json=seed_credentials).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


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


def _dung(n: int, tt: str) -> None:
    """n lệnh, mỗi lệnh một mã giấy riêng, một phiếu mua đang về + một YCMH cho mã đó."""
    db = SessionLocal()
    try:
        kh = Customer(code=f"KH-NC1-{tt}", name=f"KH {tt}")
        db.add(kh)
        db.commit()
        for i in range(n):
            g = _giay(db, ma=f"GY-{tt}{i}")
            _lenh(db, kh, ma=f"LSX-{tt}{i}", giay_id=g.id, so_to_nguyen=500)
            _phieu_mua(db, hang=("giay", g.id), so_luong=200, ngay_ve=MAI)
            _ycmh(db, hang=("giay", g.id), so_luong=100)
    finally:
        db.close()


def _so_cau(client, h) -> int:
    with dem_sql() as d:
        r = client.get(URL, headers=h)
    assert r.status_code == 200, r.text
    return d["n"]


def test_theo_lenh_doc_phieu_mua_mot_lan(client, h, monkeypatch):
    _dung(2, "A")
    goi = {"dong_dang_ve": 0, "dang_de_nghi": 0, "trang_thai_nhap_dot": 0}
    lop = {"dong_dang_ve": PurchaseRequestRepository, "trang_thai_nhap_dot": PurchaseRequestRepository,
           "dang_de_nghi": DepartmentPurchaseRequestRepository}
    for ten in goi:
        goc = getattr(lop[ten], ten)

        def _boc(self, *a, _goc=goc, _ten=ten, **k):
            goi[_ten] += 1
            return _goc(self, *a, **k)

        monkeypatch.setattr(lop[ten], ten, _boc)
    r = client.get(URL, headers=h)
    assert r.status_code == 200, r.text
    assert len(r.json()["items"]) == 2
    print("\nSO LAN DOC (theo-lenh):", goi)
    assert goi["dong_dang_ve"] == 1
    assert goi["dang_de_nghi"] <= 1
    assert goi["trang_thai_nhap_dot"] <= 1


def test_theo_lenh_khong_hoi_db_tung_dong(client, h):
    _dung(2, "B")
    it = _so_cau(client, h)
    _dung(6, "C")
    nhieu = _so_cau(client, h)
    assert len(client.get(URL, headers=h).json()["items"]) == 8
    print("\nTHEO LENH (2 -> 8 lenh):", it, nhieu)
    assert nhieu <= it + 2, f"{URL}: {it} -> {nhieu} câu khi tăng số lệnh"
