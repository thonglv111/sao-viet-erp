"""Danh mục Hàng thương mại — chỉ In Hà Phương (phân hệ `thuong_mai`, mặc định tắt)."""
from __future__ import annotations

import pytest

from app.config import settings


def _admin(client) -> dict[str, str]:
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def bat_tm(monkeypatch):
    monkeypatch.setattr(settings, "phan_he_bat", "thuong_mai")


def _dvt(client, h) -> str:
    rows = client.get("/api/don-vi?size=200", headers=h).json()
    items = rows["items"] if isinstance(rows, dict) else rows
    return items[0]["ma"]


def test_tat_thi_khong_co_man(client, monkeypatch):
    monkeypatch.setattr(settings, "phan_he_bat", "")
    h = _admin(client)
    assert client.get("/api/vat-lieu-kho/hang-thuong-mai", headers=h).status_code in (403, 404)
    assert "hang_thuong_mai" not in client.get("/api/auth/permissions", headers=h).json()["modules"]


def test_hang_thuong_mai_tach_khoi_vat_tu(client, bat_tm):
    h = _admin(client)
    dv = _dvt(client, h)
    r = client.post("/api/vat-lieu-kho/hang-thuong-mai", headers=h, json={
        "ma": "TM-BUT", "ten": "Bút bi", "don_vi_gia": dv, "gia_ban_theo_dvt": {dv: 5000, "khong_co": 1}})
    assert r.status_code in (200, 201), r.text
    hid = r.json()["id"]
    assert r.json()["gia_ban_theo_dvt"] == {dv: 5000}
    ds = client.get("/api/vat-lieu-kho/hang-thuong-mai", headers=h).json()["items"]
    assert [x["ma"] for x in ds] == ["TM-BUT"]
    vt = client.get("/api/vat-lieu-kho/vat-tu-in-an?q=TM-BUT", headers=h).json()["items"]
    assert vt == []
    # màn Vật tư khác không sửa chéo được
    assert client.get(f"/api/vat-lieu-kho/vat-tu-in-an/{hid}", headers=h).status_code == 404
    # ô chọn mặt hàng của kho / mua hàng thấy hàng thương mại, với kho là "vat_tu"
    mh = client.get("/api/vat-lieu-kho/mat-hang?q=TM-BUT", headers=h).json()
    assert [(m["hang_loai"], m["hang_id"], m["nhom"]) for m in mh] == [("vat_tu", hid, "Hàng thương mại")]


def test_khong_xem_gia_thi_khong_lo_gia_ban(client, bat_tm, monkeypatch):
    from app.routers import vat_lieu_kho as r_vlk

    h = _admin(client)
    dv = _dvt(client, h)
    r = client.post("/api/vat-lieu-kho/hang-thuong-mai", headers=h, json={
        "ma": "TM-VO", "ten": "Vở", "don_vi_gia": dv, "gia_ban_theo_dvt": {dv: 12000}})
    hid = r.json()["id"]
    monkeypatch.setattr(r_vlk, "_thay_gia_ban", lambda db, user: False)
    ds = client.get("/api/vat-lieu-kho/hang-thuong-mai", headers=h).json()["items"]
    assert ds[0]["gia_ban_theo_dvt"] is None
    # sửa tên mà gửi giá rỗng thì giá cũ giữ nguyên
    r = client.put(f"/api/vat-lieu-kho/hang-thuong-mai/{hid}", headers=h, json={
        "ma": "TM-VO", "ten": "Vở kẻ ngang", "don_vi_gia": dv, "gia_ban_theo_dvt": {dv: 1}})
    assert r.status_code == 200, r.text
    monkeypatch.setattr(r_vlk, "_thay_gia_ban", lambda db, user: True)
    assert client.get(f"/api/vat-lieu-kho/hang-thuong-mai/{hid}", headers=h).json()["gia_ban_theo_dvt"] == {dv: 12000}


def test_danh_sach_tra_ton_theo_don_vi_goc(client, bat_tm):
    """Cột Tồn (09/11/2026, phương án A): cộng mọi kho, tách theo đơn vị gốc của lô; lô cũ không ghi
    đơn vị gốc thuộc ĐVT chính; lô đã hết không tính; mã chưa có lô thì `{}`."""
    from datetime import date

    from app.db import SessionLocal
    from app.models.kho_hang import KhoHang
    from app.models.stock_lot import StockLot

    h = _admin(client)
    dv = _dvt(client, h)
    a = client.post("/api/vat-lieu-kho/hang-thuong-mai", headers=h, json={
        "ma": "TM-TON", "ten": "Bút đếm tồn", "don_vi_gia": dv}).json()["id"]
    client.post("/api/vat-lieu-kho/hang-thuong-mai", headers=h, json={
        "ma": "TM-HET", "ten": "Bút chưa nhập", "don_vi_gia": dv})
    db = SessionLocal()
    try:
        kho = [db.query(KhoHang).first()]
        k2 = KhoHang(ma="CUA-HANG-T", ten="Cửa hàng thử")
        db.add(k2)
        db.flush()
        for ma, kho_id, goc, sl in [("L1", kho[0].id, dv, 7), ("L2", k2.id, dv, 3), ("L3", k2.id, "", 2),
                                    ("L4", k2.id, dv, 0)]:
            db.add(StockLot(ma_lo=f"TM-{ma}", hang_loai="vat_tu", hang_id=a, kho_id=kho_id, don_vi_goc=goc,
                            ngay_nhap=date(2026, 11, 9), sl_ban_dau=max(sl, 1), sl_con_lai=sl))
        db.commit()
    finally:
        db.close()
    ds = {x["ma"]: x for x in client.get("/api/vat-lieu-kho/hang-thuong-mai", headers=h).json()["items"]}
    assert ds["TM-TON"]["ton_theo_dvt"] == {dv: 12}
    assert ds["TM-HET"]["ton_theo_dvt"] == {}

def test_khong_bo_duoc_don_vi_con_ton(client, bat_tm):
    """Bảng "Đơn vị bán và giá" bỏ một dòng: đơn vị còn lô tồn thì máy chủ chặn, hết tồn thì bỏ được.
    Lô hàng thương mại ghi `hang_loai="vat_tu"` nên cửa chặn phải đọc tồn dưới khoá đó."""
    from datetime import date

    from app.db import SessionLocal
    from app.models.kho_hang import KhoHang
    from app.models.stock_lot import StockLot

    h = _admin(client)
    dv = _dvt(client, h)
    r = client.post("/api/don-vi", headers=h, json={"ma": "hopthu", "ten": "Hộp thử"})
    assert r.status_code in (200, 201), r.text
    hid = client.post("/api/vat-lieu-kho/hang-thuong-mai", headers=h, json={
        "ma": "TM-HOP", "ten": "Bút hộp", "don_vi_gia": dv, "don_vi_them": ["hopthu"],
        "gia_ban_theo_dvt": {dv: 5000, "hopthu": 90000}}).json()["id"]
    db = SessionLocal()
    try:
        db.add(StockLot(ma_lo="TM-HOP-L1", hang_loai="vat_tu", hang_id=hid, kho_id=db.query(KhoHang).first().id,
                        don_vi_goc="hopthu", ngay_nhap=date(2026, 11, 9), sl_ban_dau=4, sl_con_lai=4))
        db.commit()
    finally:
        db.close()
    bo = {"ma": "TM-HOP", "ten": "Bút hộp", "don_vi_gia": dv, "don_vi_them": [], "gia_ban_theo_dvt": {dv: 5000}}
    r = client.put(f"/api/vat-lieu-kho/hang-thuong-mai/{hid}", headers=h, json=bo)
    assert r.status_code == 422, r.text
    assert "tồn kho" in r.text
    db = SessionLocal()
    try:
        db.query(StockLot).filter(StockLot.ma_lo == "TM-HOP-L1").update({"sl_con_lai": 0})
        db.commit()
    finally:
        db.close()
    r = client.put(f"/api/vat-lieu-kho/hang-thuong-mai/{hid}", headers=h, json=bo)
    assert r.status_code == 200, r.text
    assert r.json()["don_vi_them"] == [] and r.json()["gia_ban_theo_dvt"] == {dv: 5000}

def test_gia_nhap_gan_nhat_va_ton_theo_kho(client, bat_tm, monkeypatch):
    """Ngăn chi tiết (09/11/2026): giá nhập gần nhất = đơn giá lô nhập mới nhất của từng đơn vị (lô giá 0
    bỏ qua, lô cũ không ghi đơn vị gốc thuộc ĐVT chính); thiếu ô Xem giá thì máy chủ che. Tab Tồn theo
    kho tách từng kho, mỗi đơn vị một dòng, kho hết lô thì không có dòng."""
    from datetime import date

    from app.db import SessionLocal
    from app.models.kho_hang import KhoHang
    from app.models.stock_lot import StockLot
    from app.routers import vat_lieu_kho as r_vlk

    h = _admin(client)
    dv = _dvt(client, h)
    client.post("/api/don-vi", headers=h, json={"ma": "hopgia", "ten": "Hộp giá"})
    hid = client.post("/api/vat-lieu-kho/hang-thuong-mai", headers=h, json={
        "ma": "TM-GIA", "ten": "Bút giá nhập", "don_vi_gia": dv, "don_vi_them": ["hopgia"]}).json()["id"]
    db = SessionLocal()
    try:
        k1 = db.query(KhoHang).first()
        k2 = KhoHang(ma="ZZ-CUA-HANG", ten="Cửa hàng")
        db.add(k2)
        db.flush()
        for ma, kho, goc, ngay, gia, sl in [
            ("G1", k1.id, dv, date(2026, 10, 1), 3000, 100),
            ("G2", k1.id, "", date(2026, 11, 1), 3200, 20),      # lô cũ không ghi gốc, mới hơn ⇒ thắng
            ("G3", k2.id, dv, date(2026, 11, 5), 0, 5),          # giá 0 ⇒ không tính giá, vẫn tính tồn
            ("G4", k2.id, "hopgia", date(2026, 11, 2), 62000, 0),  # đã xuất hết: vẫn là giá mua lần cuối
        ]:
            db.add(StockLot(ma_lo=f"TM-{ma}", hang_loai="vat_tu", hang_id=hid, kho_id=kho, don_vi_goc=goc,
                            ngay_nhap=ngay, don_gia_nhap=gia, sl_ban_dau=max(sl, 1), sl_con_lai=sl))
        db.commit()
        k1_id, k1_ma, k2_id = k1.id, k1.ma, k2.id
    finally:
        db.close()

    ds = {x["ma"]: x for x in client.get("/api/vat-lieu-kho/hang-thuong-mai", headers=h).json()["items"]}
    assert ds["TM-GIA"]["gia_nhap_gan_nhat"] == {dv: 3200, "hopgia": 62000}

    ton = client.get(f"/api/vat-lieu-kho/hang-thuong-mai/{hid}/ton-theo-kho", headers=h)
    assert ton.status_code == 200, ton.text
    assert sorted((x["kho_id"], x["don_vi"], x["sl"]) for x in ton.json()) == sorted(
        [(k1_id, dv, 120), (k2_id, dv, 5)])
    assert {x["kho_ma"] for x in ton.json()} == {k1_ma, "ZZ-CUA-HANG"}
    assert client.get("/api/vat-lieu-kho/hang-thuong-mai/999999/ton-theo-kho", headers=h).status_code == 404

    monkeypatch.setattr(r_vlk, "_thay_gia_ban", lambda db, user: False)
    ds = {x["ma"]: x for x in client.get("/api/vat-lieu-kho/hang-thuong-mai", headers=h).json()["items"]}
    assert ds["TM-GIA"]["gia_nhap_gan_nhat"] is None
