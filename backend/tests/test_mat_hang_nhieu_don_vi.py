"""Giấy + Vật tư khác khai NHIỀU đơn vị tính (mg 0390, spec 2026-10-10-mat-hang-nhieu-don-vi-tinh).

Danh mục lưu ĐVT chính (`don_vi_gia`) + `don_vi_them`; mỗi đơn vị kéo nhóm quy đổi của nó, hai đơn vị
khai không cùng nhóm; bỏ đơn vị còn dùng bị chặn kèm câu nói rõ còn gì. Đi bằng HTTP thật.
"""
from __future__ import annotations

from datetime import date

from app.db import SessionLocal
from app.models.don_vi_do import DonViDo, DonViQuyDoi
from app.models.stock_lot import StockLot
from tests.test_danh_muc_http_contract import _admin
from tests.test_kho_de_nghi import _mk_kho

VT = "/api/vat-lieu-kho/vat-tu-in-an"
GIAY = "/api/vat-lieu-kho/giay"


def _don_vi() -> None:
    """kg · tấn (1 tấn = 1000 kg) · tờ · ram (1 ram = 500 tờ) · thùng."""
    db = SessionLocal()
    try:
        def lay(ma, ten, ho):
            d = db.query(DonViDo).filter(DonViDo.ma == ma).first()
            if d is None:
                d = DonViDo(ma=ma, ten=ten, ho=ho)
                db.add(d)
                db.flush()
            return d

        kg, tan = lay("kg", "kg", "khoi_luong"), lay("tan", "tấn", "khoi_luong")
        to, ram = lay("to", "tờ", "to"), lay("ram", "ram", "to")
        lay("thung", "thùng", "dem")
        for a, b, hs in ((tan, kg, 1000), (ram, to, 500)):
            if not db.query(DonViQuyDoi).filter(DonViQuyDoi.tu_id == a.id, DonViQuyDoi.den_id == b.id).first():
                db.add(DonViQuyDoi(tu_id=a.id, den_id=b.id, he_so=hs))
        db.commit()
    finally:
        db.close()


def _tao_vt(client, h, ma="ZZKEO", **kw) -> dict:
    r = client.post(VT, json={"ma": ma, "ten": f"Keo {ma}", "don_vi_gia": "kg", **kw}, headers=h)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _sua(client, h, url, row, **kw):
    body = {"ma": row["ma"], "ten": row["ten"], "don_vi_gia": row["don_vi_gia"], **kw}
    return client.put(f"{url}/{row['id']}", json=body, headers=h)


def test_khai_them_don_vi_khac_nhom_va_danh_sach_gop(client):
    h = _admin(client)
    _don_vi()
    vt = _tao_vt(client, h, don_vi_them=["thùng"])
    # Tên quy về MÃ.
    assert vt["don_vi_them"] == ["thung"]
    r = client.get(f"/api/vat-lieu-kho/mat-hang/vat_tu/{vt['id']}/don-vi", headers=h)
    assert r.status_code == 200, r.text
    ds = {d["ma"]: d.get("goc") for d in r.json()["ds"]}
    # Nền có sẵn g trong họ kg — mọi đơn vị nhóm kg mang gốc kg.
    assert {k: v for k, v in ds.items() if k in ("kg", "tan", "thung")} == {"kg": "kg", "tan": "kg", "thung": "thung"}
    assert set(ds.values()) == {"kg", "thung"}


def test_chan_khai_don_vi_cung_nhom(client):
    h = _admin(client)
    _don_vi()
    vt = _tao_vt(client, h)
    r = _sua(client, h, VT, vt, don_vi_them=["tan"])
    assert r.status_code == 422 and "nằm trong nhóm" in r.text, r.text
    r = _sua(client, h, VT, vt, don_vi_them=["to", "ram"])
    assert r.status_code == 422 and "“ram” đã nằm trong nhóm của “tờ”" in r.text, r.text
    # Trùng ĐVT chính thì lặng lẽ bỏ, không lỗi.
    r = _sua(client, h, VT, vt, don_vi_them=["kg", "thung"])
    assert r.status_code == 200 and r.json()["don_vi_them"] == ["thung"], r.text


def test_vang_don_vi_them_khong_dung_rong_la_xoa(client):
    h = _admin(client)
    _don_vi()
    vt = _tao_vt(client, h, don_vi_them=["thung"])
    r = _sua(client, h, VT, vt)
    assert r.status_code == 200 and r.json()["don_vi_them"] == ["thung"], r.text
    r = _sua(client, h, VT, vt, don_vi_them=[])
    assert r.status_code == 200 and r.json()["don_vi_them"] == [], r.text


def test_chan_bo_don_vi_con_ton(client):
    h = _admin(client)
    _don_vi()
    vt = _tao_vt(client, h, ma="ZZTON", don_vi_them=["thung"])
    kho_id = _mk_kho(client, h)
    db = SessionLocal()
    try:
        db.add(StockLot(ma_lo="ZZL1", kho_id=kho_id, ngay_nhap=date.today(), hang_loai="vat_tu",
                        hang_id=vt["id"], don_vi_goc="thung", sl_ban_dau=3070, sl_con_lai=3070))
        db.commit()
    finally:
        db.close()
    r = _sua(client, h, VT, vt, don_vi_them=[])
    assert r.status_code == 422, r.text
    assert "Chưa bỏ được đơn vị “thùng”: còn 3.070 thùng tồn kho." in r.text, r.text
    # Đổi ĐVT chính khỏi kg cũng là bỏ kg — kg không có tồn nên được.
    r = _sua(client, h, VT, {**vt, "don_vi_gia": "thung"}, don_vi_them=[])
    assert r.status_code == 200, r.text


def test_giay_luon_co_to_va_kg(client):
    """18/10/2026: mã giấy luôn có nhóm tờ + nhóm kg — thiếu thì máy chủ tự thêm, bỏ đi cũng mọc lại;
    nhóm đã có qua đơn vị khác (ram ∈ tờ, tấn ∈ kg) thì không thêm trùng nhóm."""
    h = _admin(client)
    _don_vi()
    r = client.post(GIAY, json={"ma": "ZZIV", "ten": "Ivory ZZ", "gsm": 300, "don_vi_gia": "kg"},
                    headers=h)
    assert r.status_code in (200, 201), r.text
    g = r.json()
    assert g["don_vi_them"] == ["to"]
    r = client.put(f"{GIAY}/{g['id']}", json={"ma": g["ma"], "ten": g["ten"], "gsm": 300,
                                              "don_vi_gia": "kg", "don_vi_them": []}, headers=h)
    assert r.status_code == 200 and r.json()["don_vi_them"] == ["to"], r.text
    r = client.post(GIAY, json={"ma": "ZZRAM", "ten": "Couche ram", "gsm": 150, "don_vi_gia": "ram",
                                "don_vi_them": ["tan"]}, headers=h)
    assert r.status_code in (200, 201) and r.json()["don_vi_them"] == ["tan"], r.text


def test_chua_co_dvt_chinh_khong_khai_them(client):
    h = _admin(client)
    _don_vi()
    r = client.post(VT, json={"ma": "ZZTRONG", "ten": "Trống", "don_vi_them": ["kg"]}, headers=h)
    assert r.status_code == 422 and "ĐVT chính" in r.text, r.text
