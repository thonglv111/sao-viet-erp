"""Phạm vi khối Kinh doanh — các cửa ghi / tra cứu còn lọt (bấm thử 25/10/2026, L-VAI-01/04/05/06).

Chủ của phiếu / báo giá / đơn = sale phụ trách KHÁCH (`org_scope.chu_cua`), không phải người bấm tạo.
"""
from __future__ import annotations

from app.db import SessionLocal
from app.models.customer import Customer
from app.models.phieu_tinh_gia import PhieuThanhPhan, PhieuTinhGia
from tests.test_nhom_dung_chung_kd import _QUYEN, _h, _sale_own

ADMIN = {"username": "admin", "password": "admin123"}


def _admin(client) -> dict[str, str]:
    return _h(client.post("/api/auth/login", json=ADMIN).json()["access_token"])


def _khach(code: str, sale_id: int) -> int:
    s = SessionLocal()
    try:
        c = Customer(code=code, name=f"Khách {code}", sale_user_id=sale_id)
        s.add(c)
        s.commit()
        return c.id
    finally:
        s.close()


def _phieu(cid: int, created_by: int | None) -> int:
    """Phiếu 1 sản phẩm của khách `cid`, người lập `created_by`."""
    s = SessionLocal()
    try:
        n = s.query(PhieuTinhGia).count() + 1
        p = PhieuTinhGia(customer_id=cid, created_by=created_by, ma=f"PTG-PV-{n:04d}",
                         ten_san_pham="Tờ rơi", so_luong=1000, tong_gia_von=1_000_000,
                         gia_von_don=0, ktv="KTV")
        s.add(p)
        s.flush()
        s.add(PhieuThanhPhan(phieu_id=p.id, thu_tu=0, ten="Tờ rơi", so_luong=1000,
                             gia_von_tp=1_000_000, loai_thanh_phan="to_roi"))
        s.commit()
        return p.id
    finally:
        s.close()


def test_sale_chu_khach_lap_bao_gia_tu_phieu_nguoi_khac_lap(client):
    """L-VAI-01: người khác lập phiếu cho khách của sale A — A lập được báo giá từ phiếu đó."""
    uid_a, tok_a = _sale_own("pv01_a", **_QUYEN)
    uid_b, tok_b = _sale_own("pv01_b", **_QUYEN)
    pid = _phieu(_khach("PV01", uid_a), created_by=uid_b)
    assert client.get(f"/api/phieu-tinh-gia/{pid}", headers=_h(tok_a)).status_code == 200
    r = client.post("/api/quotations", json={"phieu_tinh_gia_id": pid}, headers=_h(tok_a))
    assert r.status_code == 201, r.text
    # Người lập phiếu (B) không còn là chủ — không lập được báo giá cho khách của A.
    pid2 = _phieu(_khach("PV01B", uid_a), created_by=uid_b)
    r2 = client.post("/api/quotations", json={"phieu_tinh_gia_id": pid2}, headers=_h(tok_b))
    assert r2.status_code == 404, r2.text


def test_by_phieu_ngoai_pham_vi_khong_lo_ma_bao_gia(client):
    """L-VAI-05: tra báo giá theo phiếu của khách người khác → không lộ mã."""
    uid_a, tok_a = _sale_own("pv05_a", **_QUYEN)
    _, tok_b = _sale_own("pv05_b", **_QUYEN)
    pid = _phieu(_khach("PV05", uid_a), created_by=uid_a)
    q = client.post("/api/quotations", json={"phieu_tinh_gia_id": pid}, headers=_h(tok_a))
    assert q.status_code == 201, q.text
    mine = client.get(f"/api/quotations/by-phieu/{pid}", headers=_h(tok_a)).json()
    assert mine["quote_id"] == q.json()["id"]
    other = client.get(f"/api/quotations/by-phieu/{pid}", headers=_h(tok_b))
    assert other.status_code == 200
    assert other.json() == {"quote_id": None, "quote_number": None}


def test_tao_don_tu_bao_gia_ngoai_pham_vi_404(client):
    """L-VAI-04: sale B gọi thẳng POST /api/orders với báo giá đã chốt của sale A → 404, không sinh đơn."""
    uid_a, tok_a = _sale_own("pv04_a", **_QUYEN)
    _, tok_b = _sale_own("pv04_b", **_QUYEN)
    pid = _phieu(_khach("PV04", uid_a), created_by=uid_a)
    adm = _admin(client)
    q = client.post("/api/quotations", json={"phieu_tinh_gia_id": pid}, headers=adm).json()
    r = client.post(f"/api/quotations/{q['id']}/transition", json={"to_status": "accepted"}, headers=adm)
    assert r.status_code == 200, r.text
    o = client.post("/api/orders", json={"source_type": "bao_gia", "quotation_id": q["id"]},
                    headers=_h(tok_b))
    assert o.status_code == 404, o.text
    ok = client.post("/api/orders", json={"source_type": "bao_gia", "quotation_id": q["id"]},
                     headers=_h(tok_a))
    assert ok.status_code == 201, ok.text


def test_goi_y_tai_ban_khach_ngoai_pham_vi(client):
    """L-VAI-06: gợi ý tái bản theo customer_id của khách người khác → rỗng / 404."""
    uid_a, tok_a = _sale_own("pv06_a", **_QUYEN)
    _, tok_b = _sale_own("pv06_b", **_QUYEN)
    from app.models.vat_lieu_kho import VatTuInAn

    cid = _khach("PV06", uid_a)
    s = SessionLocal()
    try:
        tp = VatTuInAn(ma="TP-PV06", ten="Hộp PV06", la_thanh_pham=True, customer_id=cid, don_gia=0)
        s.add(tp)
        s.commit()
        tp_id = tp.id
    finally:
        s.close()
    mine = client.get(f"/api/phieu-tinh-gia/san-pham-tai-ban?customer_id={cid}", headers=_h(tok_a))
    assert [x["ma"] for x in mine.json()] == ["TP-PV06"]
    assert client.get(f"/api/phieu-tinh-gia/san-pham-tai-ban/{tp_id}?customer_id={cid}",
                      headers=_h(tok_a)).status_code == 200
    r = client.get(f"/api/phieu-tinh-gia/san-pham-tai-ban?customer_id={cid}", headers=_h(tok_b))
    assert r.status_code == 200 and r.json() == []
    r2 = client.get(f"/api/phieu-tinh-gia/san-pham-tai-ban/{tp_id}?customer_id={cid}", headers=_h(tok_b))
    assert r2.status_code == 404
