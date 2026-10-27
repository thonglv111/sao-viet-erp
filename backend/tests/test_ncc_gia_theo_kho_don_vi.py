"""Bảng giá NCC giấy theo KHỔ + ĐƠN VỊ (chủ chốt 10/10/2026, bỏ dạng bán cuộn/tờ).

Vì sao: tách dạng làm kẹt việc chọn NCC (dòng Ivory tờ 720×1020 không chọn được NCC chỉ "bán
cuộn"). Nay dòng giá giấy chỉ có khổ (hai cạnh hoặc chỉ rộng) + ĐVT tự chọn. Mỗi dòng quy về gốc
của CHÍNH đơn vị nó: họ tờ (ram = 500 tờ) ra đ/tờ, họ đơn vị giá (tấn = 1000 kg) ra đ/kg. Máy
không quy tờ ↔ kg; so giá chỉ khớp đúng khổ, dòng khác họ đơn vị với dòng đang mua xếp sau.
"""
from __future__ import annotations

from itertools import count

import pytest

from app.db import SessionLocal
from app.models.don_vi_do import DonViDo, DonViQuyDoi
from app.models.vat_lieu_kho import GiayNguyen

ADMIN = {"username": "admin", "password": "admin123"}
_dem_mst = count(1)


def _h(client) -> dict[str, str]:
    r = client.post("/api/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def giay_id() -> int:
    """Đơn vị to/ram/kg/tan + cặp ram→tờ 500, tấn→kg 1000; một mã giấy giá theo kg."""
    db = SessionLocal()
    try:
        def lay(ma, ten, ho):
            d = db.query(DonViDo).filter(DonViDo.ma == ma).first()
            if d is None:
                d = DonViDo(ma=ma, ten=ten, ho=ho)
                db.add(d)
                db.flush()
            return d

        to, ram = lay("to", "tờ", "to"), lay("ram", "ram", "to")
        kg, tan = lay("kg", "kg", "khoi_luong"), lay("tan", "tấn", "khoi_luong")
        for tu, den, hs in ((ram, to, 500), (tan, kg, 1000)):
            if not db.query(DonViQuyDoi).filter(
                    DonViQuyDoi.tu_id == tu.id, DonViQuyDoi.den_id == den.id).first():
                db.add(DonViQuyDoi(tu_id=tu.id, den_id=den.id, he_so=hs))
        g = GiayNguyen(don_vi_them=["to"], ma="C80-NCC", ten="COUCHE 80GSM", gsm=80, don_vi_gia="kg")
        db.add(g)
        db.commit()
        return g.id
    finally:
        db.close()


def _ncc(client, h, ten: str, items: list[dict]):
    mst = f"02{next(_dem_mst):08d}"
    return client.post("/api/suppliers", headers=h, json={
        "name": ten, "tax_code": mst, "phone": "0900000000",
        "email": f"{next(_dem_mst)}@x.vn", "address": "HN",
        "contact_name": "A", "supplier_group": "giay", "items": items,
    })


def _dong(gid, **kw) -> dict:
    return {"hang_loai": "giay", "hang_id": gid, "item_name": "COUCHE 80GSM",
            "vat_percent": 8, **kw}


def test_dong_gia_giay_luu_kho_va_quy_ve_goc_cua_chinh_don_vi(client, giay_id):
    h = _h(client)
    r = _ncc(client, h, "Tân Mai", [
        _dong(giay_id, kho_rong=870, kho_dai=650, unit="ram", unit_price=520_000),
        _dong(giay_id, kho_rong=1090, unit="tan", unit_price=22_600_000),
    ])
    assert r.status_code == 201, r.text
    items = {i["unit"]: i for i in r.json()["items"]}
    assert "dang_ban" not in items["ram"]
    assert (items["ram"]["kho_rong"], items["ram"]["kho_dai"]) == (650, 870)   # cạnh ngắn trước
    assert items["ram"]["gia_quy_doi"] == 1040                                # 520.000 ÷ 500 tờ
    assert items["ram"]["don_vi_goc"] == "to"
    assert items["tan"]["gia_quy_doi"] == 22600                               # 22.600.000 ÷ 1.000 kg
    assert items["tan"]["don_vi_goc"] == "kg"
    assert (items["tan"]["kho_rong"], items["tan"]["kho_dai"]) == (1090, 0)   # khổ chỉ rộng


def test_khong_con_luat_to_cam_kg_cuon_cam_ram(client, giay_id):
    """Khổ hai cạnh bán theo kg, khổ chỉ-rộng bán theo ram — đều hợp lệ; `dang_ban` client cũ gửi
    thừa thì bỏ qua, không 422."""
    h = _h(client)
    r = _ncc(client, h, "X1", [
        _dong(giay_id, kho_rong=650, kho_dai=870, unit="kg", unit_price=21_000),
        _dong(giay_id, dang_ban="cuon", kho_rong=1000, unit="ram", unit_price=500_000),
    ])
    assert r.status_code == 201, r.text
    items = {i["unit"]: i for i in r.json()["items"]}
    assert items["kg"]["gia_quy_doi"] == 21000 and items["kg"]["don_vi_goc"] == "kg"
    assert items["ram"]["gia_quy_doi"] == 1000 and items["ram"]["don_vi_goc"] == "to"


def test_don_vi_ngoai_hai_ho_bi_chan(client, giay_id):
    """Đơn vị không đổi được về họ tờ lẫn họ đơn vị giá của mã ⇒ báo lỗi, không lùi hệ số 1."""
    db = SessionLocal()
    try:
        if not db.query(DonViDo).filter(DonViDo.ma == "cuon_le").first():
            db.add(DonViDo(ma="cuon_le", ten="cuộn lẻ", ho="dem"))
            db.commit()
    finally:
        db.close()
    h = _h(client)
    r = _ncc(client, h, "X3", [_dong(giay_id, kho_rong=1000, unit="cuon_le", unit_price=1)])
    assert r.status_code in (400, 422), r.text


def _bang_gia(client, h, giay_id):
    assert _ncc(client, h, "Tân Mai", [
        _dong(giay_id, kho_rong=650, kho_dai=870, unit="ram", unit_price=520_000),
    ]).status_code == 201
    assert _ncc(client, h, "An Phát", [
        _dong(giay_id, kho_rong=650, kho_dai=870, unit="to", unit_price=1_080),
        _dong(giay_id, kho_rong=790, kho_dai=1090, unit="to", unit_price=900),
    ]).status_code == 201
    assert _ncc(client, h, "Việt Trì", [
        _dong(giay_id, kho_rong=650, kho_dai=870, unit="tan", unit_price=20_000_000),
        _dong(giay_id, kho_rong=650, unit="kg", unit_price=19_000),
    ]).status_code == 201


def test_so_gia_chi_khop_cung_kho_va_xep_cung_ho_truoc(client, giay_id):
    h = _h(client)
    _bang_gia(client, h, giay_id)

    r = client.get("/api/supplier-items/so-gia", headers=h, params={
        "hang_loai": "giay", "hang_id": giay_id, "don_vi": "to", "kho_rong": 870, "kho_dai": 650})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["don_vi_goc"] == "to"
    # Đúng khổ 650 × 870: khổ 790 × 1090 và khổ chỉ-rộng 650 đều không vào.
    assert [(x["supplier_name"], x["unit"], x["cung_ho"], x["gia_quy_doi"]) for x in body["items"]] == [
        ("Tân Mai", "ram", True, 1040),     # ram ÷ 500 tờ
        ("An Phát", "to", True, 1080),
        ("Việt Trì", "tan", False, 20000),  # cùng khổ khác họ (tấn → kg ÷ 1000): xếp sau dù rẻ
    ]
    assert [x["don_vi_goc"] for x in body["items"]] == ["to", "to", "kg"]
    assert all((x["kho_rong"], x["kho_dai"]) == (650, 870) for x in body["items"])
    assert all("dang_ban" not in x for x in body["items"])


def test_so_gia_kho_chi_rong_khong_khop_hai_canh(client, giay_id):
    h = _h(client)
    _bang_gia(client, h, giay_id)
    r = client.get("/api/supplier-items/so-gia", headers=h, params={
        "hang_loai": "giay", "hang_id": giay_id, "don_vi": "kg", "kho_rong": 650})
    body = r.json()
    assert body["don_vi_goc"] == "kg"
    assert [(x["supplier_name"], x["unit"], x["cung_ho"], x["gia_quy_doi"])
            for x in body["items"]] == [("Việt Trì", "kg", True, 19000)]


def test_so_gia_khong_gui_don_vi_thi_cung_ho_het(client, giay_id):
    h = _h(client)
    _bang_gia(client, h, giay_id)
    r = client.get("/api/supplier-items/so-gia", headers=h, params={
        "hang_loai": "giay", "hang_id": giay_id})
    items = r.json()["items"]
    assert all(x["cung_ho"] for x in items)
    # Mỗi dòng quy theo gốc của chính nó — không dòng nào bị quy tờ ↔ kg.
    assert sorted((x["gia_quy_doi"], x["don_vi_goc"]) for x in items) == [
        (900, "to"), (1040, "to"), (1080, "to"), (19000, "kg"), (20000, "kg")]


def test_dong_kho_0_la_moi_kho_khop_moi_kho_xep_sau_dung_kho(client, giay_id):
    """Dòng giá khổ 0 · 0 = NCC bán mọi khổ: khớp mọi khổ đang hỏi (`dung_kho=False`), xếp sau dòng
    đúng khổ cùng họ dù rẻ hơn; khác họ vẫn xếp sau cùng."""
    h = _h(client)
    _bang_gia(client, h, giay_id)
    assert _ncc(client, h, "Mọi Khổ", [
        _dong(giay_id, unit="to", unit_price=500),
        _dong(giay_id, unit="kg", unit_price=18_000),
    ]).status_code == 201

    r = client.get("/api/supplier-items/so-gia", headers=h, params={
        "hang_loai": "giay", "hang_id": giay_id, "don_vi": "ram", "kho_rong": 650, "kho_dai": 870})
    got = [(x["supplier_name"], x["unit"], x["cung_ho"], x["dung_kho"], x["gia_quy_doi"])
           for x in r.json()["items"]]
    assert got == [
        ("Tân Mai", "ram", True, True, 1040),
        ("An Phát", "to", True, True, 1080),
        ("Mọi Khổ", "to", True, False, 500),
        ("Việt Trì", "tan", False, True, 20000),
        ("Mọi Khổ", "kg", False, False, 18000),
    ]

    # Khổ chỉ-rộng: khớp dòng (650, 0) + dòng mọi khổ, KHÔNG khớp dòng 650 × 870.
    r = client.get("/api/supplier-items/so-gia", headers=h, params={
        "hang_loai": "giay", "hang_id": giay_id, "don_vi": "kg", "kho_rong": 650})
    got = [(x["supplier_name"], x["unit"], x["kho_rong"], x["kho_dai"], x["dung_kho"])
           for x in r.json()["items"] if x["cung_ho"]]
    assert got == [("Việt Trì", "kg", 650, 0, True), ("Mọi Khổ", "kg", 0, 0, False)]

    # Không gửi khổ ⇒ mọi dòng đều `dung_kho`.
    r = client.get("/api/supplier-items/so-gia", headers=h, params={
        "hang_loai": "giay", "hang_id": giay_id})
    assert all(x["dung_kho"] for x in r.json()["items"])


def test_vat_tu_khac_co_kho_tuy_chon_cung_luat_giay(client, giay_id):
    """Vật tư khác có khổ tuỳ chọn như giấy (27/10/2026): dòng giá màng bóng lưu khổ chỉ-rộng, so giá
    chỉ khớp đúng khổ + dòng trống khổ (bán mọi khổ, xếp sau); không gửi khổ ⇒ mọi dòng đúng khổ."""
    from app.models.vat_lieu_kho import VatTuInAn

    db = SessionLocal()
    try:
        vt = VatTuInAn(ma="MANG-BONG", ten="Màng bóng", don_vi_gia="kg")
        db.add(vt)
        db.commit()
        vid = vt.id
    finally:
        db.close()

    def dong(**kw):
        return {"hang_loai": "vat_tu", "hang_id": vid, "item_name": "Màng bóng", "unit": "kg",
                "vat_percent": 8, **kw}

    h = _h(client)
    r = _ncc(client, h, "Màng Việt", [dong(kho_rong=320, unit_price=50_000),
                                      dong(kho_rong=350, unit_price=48_000)])
    assert r.status_code == 201, r.text
    assert sorted((x["kho_rong"], x["kho_dai"]) for x in r.json()["items"]) == [(320, 0), (350, 0)]
    assert _ncc(client, h, "Màng Mọi Khổ", [dong(unit_price=40_000)]).status_code == 201

    r = client.get("/api/supplier-items/so-gia", headers=h, params={
        "hang_loai": "vat_tu", "hang_id": vid, "don_vi": "kg", "kho_rong": 320})
    assert r.status_code == 200, r.text
    assert [(x["supplier_name"], x["kho_rong"], x["dung_kho"]) for x in r.json()["items"]] == [
        ("Màng Việt", 320, True), ("Màng Mọi Khổ", 0, False)]

    r = client.get("/api/supplier-items/so-gia", headers=h, params={
        "hang_loai": "vat_tu", "hang_id": vid, "don_vi": "kg"})
    assert len(r.json()["items"]) == 3 and all(x["dung_kho"] for x in r.json()["items"])
