"""Giấy trong kho mang KHỔ + ĐƠN VỊ GỐC — giấy KHÔNG còn dạng cuộn/tờ (10/10/2026).

Đơn vị gốc dòng giấy máy chủ SUY từ ĐVT: họ tờ (tờ, ram, mã chặng `to_nguyen`) ⇒ "to"; họ đơn vị giá
của mã (kg, tấn…) ⇒ đơn vị giá. Tồn tách theo mã + khổ + đơn vị gốc. Khổ hai cạnh khai kg ⇒ quy ra tờ (spec 2026-10-24 §5).

Đi bằng HTTP thật: đề nghị → phiếu → ghi sổ → lô, như kho dùng.
"""
from __future__ import annotations

from app.db import SessionLocal
from app.models.don_vi_do import DonViDo, DonViQuyDoi
from app.models.stock_lot import StockLot
from app.models.vat_lieu_kho import GiayNguyen
from tests.test_kho_de_nghi import _admin, _login, _setup

BASE = "/api/kho"


def _don_vi() -> None:
    """kg (khối lượng) · ram · tờ + cặp 1 ram = 500 tờ. Kho/mua đếm giấy tờ bằng `to` (07/10/2026);
    `to_nguyen` còn trong danh mục (mã chặng của lệnh) nhưng KHÔNG có cặp với `to`."""
    db = SessionLocal()
    try:
        def lay(ma, ten, ho):
            d = db.query(DonViDo).filter(DonViDo.ma == ma).first()
            if d is None:
                d = DonViDo(ma=ma, ten=ten, ho=ho)
                db.add(d)
                db.flush()
            return d

        kg = lay("kg", "kg", "khoi_luong")
        ram = lay("ram", "ram", "to")
        lay("to_nguyen", "tờ nguyên", "to")
        to = lay("to", "tờ", "to")
        del kg
        if not db.query(DonViQuyDoi).filter(
                DonViQuyDoi.tu_id == ram.id, DonViQuyDoi.den_id == to.id).first():
            db.add(DonViQuyDoi(tu_id=ram.id, den_id=to.id, he_so=500))
        db.commit()
    finally:
        db.close()


def _giay(ma: str = "C-300", don_vi_gia: str = "kg") -> int:
    db = SessionLocal()
    try:
        g = GiayNguyen(don_vi_them=["to"], ma=ma, ten=f"Giấy {ma}", gsm=300, don_vi_gia=don_vi_gia)
        db.add(g)
        db.commit()
        return g.id
    finally:
        db.close()


def _dong(giay_id, *, dvt, sl, kr=0, kd=0, gia=None, **them) -> dict:
    d = {"hang_loai": "giay", "hang_id": giay_id, "dvt": dvt, "sl_de_nghi": sl}
    if kr:
        d["kho_rong"] = kr
    if kd:
        d["kho_dai"] = kd
    if gia is not None:
        d["don_gia"] = gia
    d.update(them)
    return d


def _de_nghi(client, kho_id, loai, lines):
    return client.post("/api/kho/de-nghi", headers=_login(client, "t_denghi"), json={
        "loai": loai, "kho_id": kho_id, "lines": lines})


def _nhap(client, kho_id, line) -> dict:
    """Đề nghị nhập 1 dòng → phiếu → ghi sổ. Trả phiếu."""
    r = _de_nghi(client, kho_id, "NHAP", [line])
    assert r.status_code == 201, r.text
    req = r.json()
    tk = _login(client, "t_thukho")
    r = client.post(f"{BASE}/phieu", headers=tk, json={
        "request_id": req["id"], "kho_id": kho_id,
        "lines": [{"request_line_id": req["lines"][0]["id"], "so_luong": req["lines"][0]["sl_de_nghi"]}],
    })
    assert r.status_code == 201, r.text
    r = client.post(f"{BASE}/phieu/{r.json()['id']}/ghi-so", headers=tk)
    assert r.status_code == 200, r.text
    return r.json()


def _lo(giay_id):
    db = SessionLocal()
    try:
        return db.query(StockLot).filter(
            StockLot.hang_loai == "giay", StockLot.hang_id == giay_id).order_by(StockLot.id).all()
    finally:
        db.close()


def test_nhap_giay_ram_sinh_lo_dung_kho_dem_to(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    _nhap(client, kho_id, _dong(g, dvt="ram", sl=2, kr=905, kd=780, gia=1_000_000))
    (lo,) = _lo(g)
    assert (lo.don_vi_goc, lo.kho_rong, lo.kho_dai) == ("to", 780, 905)
    assert float(lo.sl_ban_dau) == 1000
    assert int(lo.don_gia_nhap) == 2000      # 2.000.000 ÷ 1.000 tờ


def test_nhap_giay_kg_kho_chi_rong_dem_kg(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    _nhap(client, kho_id, _dong(g, dvt="kg", sl=500, kr=1000, gia=20_000))
    (lo,) = _lo(g)
    assert (lo.don_vi_goc, lo.kho_rong, lo.kho_dai) == ("kg", 1000, 0)
    assert float(lo.sl_ban_dau) == 500


def test_nhap_giay_kg_kho_hai_canh_quy_ra_to(client):
    """Khổ hai cạnh nhập theo kg ⇒ quy ra TỜ theo khổ + gsm, làm tròn xuống (spec 2026-10-24-chuan-bi-giay
    §5, đảo luật 10/10 "vẫn là kg"): 120 kg ÷ (0,79 × 1,09 × 0,3) = 464,5 ⇒ 464 tờ."""
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    _nhap(client, kho_id, _dong(g, dvt="kg", sl=120, kr=790, kd=1090, gia=20_000))
    (lo,) = _lo(g)
    assert (lo.don_vi_goc, lo.kho_rong, lo.kho_dai, float(lo.sl_ban_dau)) == ("to", 790, 1090, 464.0)


def test_dang_giay_gui_thua_bi_bo_qua(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    r = _de_nghi(client, kho_id, "NHAP", [_dong(g, dvt="ram", sl=1, kr=780, kd=905, dang_giay="cuon")])
    assert r.status_code == 201, r.text
    ln = r.json()["lines"][0]
    assert "dang_giay" not in ln
    assert (ln["don_vi_goc"], ln["kho_rong"], ln["kho_dai"]) == ("to", 780, 905)


def test_giay_dem_to_thieu_kho_bi_chan_kg_thi_khong(client):
    """Màn kho: giấy đếm tờ phải đủ khổ hai cạnh (máy chủ chặn, FE không còn tự kiểm). Giấy theo
    kg để trống khổ / chỉ rộng vẫn được."""
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    for kho in ({}, {"kr": 780}):
        r = _de_nghi(client, kho_id, "NHAP", [_dong(g, dvt="ram", sl=1, **kho)])
        assert r.status_code == 400, r.text
        assert "đủ khổ" in r.json()["detail"]
    r = _de_nghi(client, kho_id, "NHAP", [_dong(g, dvt="kg", sl=5)])
    assert r.status_code == 201, r.text
    assert r.json()["lines"][0]["don_vi_goc"] == "kg"
    assert r.json()["lines"][0]["don_vi_goc_ten"] == "kg"


def test_dvt_khong_doi_duoc_bao_loi(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    r = _de_nghi(client, kho_id, "NHAP", [_dong(g, dvt="cai_khong_co", sl=1)])
    assert r.status_code == 400, r.text


def test_cung_ma_hai_kho_tren_mot_phieu_hop_le(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    r = _de_nghi(client, kho_id, "NHAP", [
        _dong(g, dvt="ram", sl=1, kr=780, kd=905, gia=1000),
        _dong(g, dvt="ram", sl=1, kr=800, kd=1090, gia=1000),
    ])
    assert r.status_code == 201, r.text
    req = r.json()
    tk = _login(client, "t_thukho")
    r = client.post(f"{BASE}/phieu", headers=tk, json={
        "request_id": req["id"], "kho_id": kho_id,
        "lines": [{"request_line_id": ln["id"], "so_luong": 1} for ln in req["lines"]]})
    assert r.status_code == 201, r.text
    assert client.post(f"{BASE}/phieu/{r.json()['id']}/ghi-so", headers=tk).status_code == 200
    assert sorted((lo.kho_rong, lo.kho_dai) for lo in _lo(g)) == [(780, 905), (800, 1090)]


def test_cung_kho_khac_don_vi_goc_la_hai_dong_hop_le(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    r = _de_nghi(client, kho_id, "NHAP", [
        _dong(g, dvt="ram", sl=1, kr=780, kd=905),
        _dong(g, dvt="kg", sl=50, kr=780),          # cuộn khổ 780: gốc kg (khổ hai cạnh thì quy ra tờ)
    ])
    assert r.status_code == 201, r.text
    assert sorted(ln["don_vi_goc"] for ln in r.json()["lines"]) == ["kg", "to"]


def test_cung_ma_cung_kho_cung_goc_hai_dong_bi_chan(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    r = _de_nghi(client, kho_id, "NHAP", [
        _dong(g, dvt="ram", sl=1, kr=780, kd=905),
        _dong(g, dvt="to", sl=1, kr=905, kd=780),    # cùng khổ ghi ngược cạnh, tờ và ram cùng gốc tờ
    ])
    assert r.status_code == 400, r.text
    assert "1 dòng" in r.json()["detail"]


def _ba_lo(client, kho_id, g):
    _nhap(client, kho_id, _dong(g, dvt="ram", sl=1, kr=780, kd=905, gia=1000))
    _nhap(client, kho_id, _dong(g, dvt="ram", sl=1, kr=800, kd=1090, gia=1000))
    _nhap(client, kho_id, _dong(g, dvt="kg", sl=100, kr=1000, gia=20_000))
    return _lo(g)


def test_goi_y_lo_chi_lay_dung_don_vi_goc_va_kho(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    lo_a, lo_b, lo_c = _ba_lo(client, kho_id, g)
    tk = _login(client, "t_thukho")
    base = {"hang_loai": "giay", "hang_id": g, "kho_id": kho_id, "so_luong": 100}
    r = client.get(f"{BASE}/phieu/lo/goi-y", headers=tk,
                   params={**base, "goc": "to", "kho_rong": 905, "kho_dai": 780})
    assert r.status_code == 200, r.text
    assert [x["lot_id"] for x in r.json()["lines"]] == [lo_a.id]
    assert r.json()["lines"][0]["don_vi_goc"] == "to"
    r = client.get(f"{BASE}/phieu/lo/goi-y", headers=tk, params={**base, "goc": "kg"})
    assert [x["lot_id"] for x in r.json()["lines"]] == [lo_c.id]
    # Khổ chỉ-rộng không khớp khổ hai cạnh.
    r = client.get(f"{BASE}/phieu/lo/goi-y", headers=tk,
                   params={**base, "goc": "kg", "kho_rong": 1000, "kho_dai": 700})
    assert r.json()["lines"] == []
    r = client.get(f"{BASE}/phieu/lo/danh-sach", headers=_login(client, "t_ketoan"),
                   params={"hang_loai": "giay", "hang_id": g, "goc": "to",
                           "kho_rong": 800, "kho_dai": 1090})
    assert [x["id"] for x in r.json()] == [lo_b.id]
    assert (r.json()[0]["don_vi_goc"], r.json()[0]["kho_rong"], r.json()[0]["kho_dai"]) == ("to", 800, 1090)


def test_goi_y_lo_co_kho_ma_thieu_don_vi_goc_van_loc_kho(client):
    """Dòng xin có khổ nhưng không gửi `goc` (dòng đề nghị trống đơn vị gốc ⇒ FE gửi goc=null) thì
    vẫn chỉ gợi ý lô ĐÚNG khổ — bỏ lọc khổ là kho bị dắt sang lô khổ khác rồi mới bị chặn lúc lập phiếu."""
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    lo_a, lo_b, _lo_c = _ba_lo(client, kho_id, g)
    base = {"hang_loai": "giay", "hang_id": g, "kho_id": kho_id, "so_luong": 100}
    r = client.get(f"{BASE}/phieu/lo/goi-y", headers=_login(client, "t_thukho"),
                   params={**base, "kho_rong": 800, "kho_dai": 1090})
    assert r.status_code == 200, r.text
    assert [x["lot_id"] for x in r.json()["lines"]] == [lo_b.id]
    r = client.get(f"{BASE}/phieu/lo/danh-sach", headers=_login(client, "t_ketoan"),
                   params={"hang_loai": "giay", "hang_id": g, "kho_rong": 905, "kho_dai": 780})
    assert [x["id"] for x in r.json()] == [lo_a.id]


def test_xuat_chon_lo_sai_kho_hoac_sai_don_vi_bi_chan(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    lo_a, lo_b, lo_c = _ba_lo(client, kho_id, g)
    r = _de_nghi(client, kho_id, "XUAT", [_dong(g, dvt="to_nguyen", sl=300, kr=780, kd=905)])
    assert r.status_code == 201, r.text
    req = r.json()
    assert req["lines"][0]["don_vi_goc"] == "to"
    tk = _login(client, "t_thukho")
    body = {"request_id": req["id"], "kho_id": kho_id, "lines": [
        {"request_line_id": req["lines"][0]["id"], "so_luong": 300, "lot_id": lo_b.id}]}
    r = client.post(f"{BASE}/phieu", headers=tk, json=body)
    assert r.status_code == 400, r.text
    assert "dòng xin 780 × 905 mm" in r.json()["detail"]
    body["lines"][0]["lot_id"] = lo_c.id
    r = client.post(f"{BASE}/phieu", headers=tk, json=body)
    assert r.status_code == 400, r.text
    assert "đếm theo “kg”" in r.json()["detail"]
    body["lines"][0]["lot_id"] = lo_a.id
    assert client.post(f"{BASE}/phieu", headers=tk, json=body).status_code == 201


def test_vat_tu_khac_giu_kho_tuy_chon(client):
    from app.models.stock_request import StockRequestLine

    kho_id, mat = _setup(client)
    r = _de_nghi(client, kho_id, "NHAP", [{
        "hang_loai": mat[0], "hang_id": mat[1], "dvt": "to", "sl_de_nghi": 5,
        "dang_giay": "to", "kho_rong": 780, "kho_dai": 905}])
    assert r.status_code == 201, r.text
    db = SessionLocal()
    try:
        ln = db.get(StockRequestLine, r.json()["lines"][0]["id"])
        # Vật tư: khổ TUỲ CHỌN như giấy (27/10/2026, chuẩn cạnh ngắn trước), đơn vị gốc = đơn vị đã
        # khai (mg 0390). Đọc từ DB, không từ phản hồi.
        assert (ln.don_vi_goc, ln.kho_rong, ln.kho_dai) == ("to", 780, 905)
    finally:
        db.close()


def test_phan_hoi_dong_giay_mang_kho_va_don_vi_goc(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    r = _de_nghi(client, kho_id, "NHAP", [_dong(g, dvt="ram", sl=2, kr=905, kd=780, gia=1000)])
    assert r.status_code == 201, r.text
    ln = r.json()["lines"][0]
    assert (ln["don_vi_goc"], ln["kho_rong"], ln["kho_dai"]) == ("to", 780, 905)
    assert ln["sl_quy_doi"] == 1000 and ln["canh_bao_dv"] is None     # tờ, không phải kg
    tk = _login(client, "t_thukho")
    r = client.post(f"{BASE}/phieu", headers=tk, json={
        "request_id": r.json()["id"], "kho_id": kho_id,
        "lines": [{"request_line_id": ln["id"], "so_luong": 2}]})
    assert r.status_code == 201, r.text
    pl = r.json()["lines"][0]
    assert (pl["kho_rong"], pl["kho_dai"]) == (780, 905) and "dang_giay" not in pl
    assert pl["don_vi_goc"] == "to"
    client.post(f"{BASE}/phieu/{r.json()['id']}/ghi-so", headers=tk)
    lo = client.get(f"{BASE}/phieu/lo/danh-sach", headers=_login(client, "t_ketoan"),
                    params={"hang_loai": "giay", "hang_id": g}).json()[0]
    assert lo["dvt"] == "to" and lo["don_vi_goc"] == "to"


def test_dieu_chuyen_giay_tach_theo_kho_va_don_vi_goc(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    _ba_lo(client, kho_id, g)
    adm = _login(client, "t_thukho")
    r = client.post("/api/kho", json={"ten": "Kho đích"}, headers=_admin(client))
    den = r.json()["id"]
    r = client.post("/api/kho/dieu-chuyen", headers=adm, json={
        "kho_nguon_id": kho_id, "kho_den_id": den, "items": [
            {"hang_loai": "giay", "hang_id": g, "so_luong": 300,
             "don_vi_goc": "to", "kho_rong": 905, "kho_dai": 780},
            # Bỏ trống đơn vị gốc: kho nguồn chỉ có lô kg ở khổ 1000 ⇒ máy suy ra kg.
            {"hang_loai": "giay", "hang_id": g, "so_luong": 40, "kho_rong": 1000},
        ]})
    assert r.status_code == 201, r.text
    assert r.json()["so_dong"] == 2
    r = client.post(f"{BASE}/phieu/{r.json()['phieu_nhap_id']}/ghi-so", headers=adm)
    assert r.status_code == 200, r.text
    db = SessionLocal()
    try:
        moi = sorted((lo.don_vi_goc, lo.kho_rong, lo.kho_dai, float(lo.sl_ban_dau))
                     for lo in db.query(StockLot).filter(StockLot.kho_id == den).all())
        assert moi == [("kg", 1000, 0, 40.0), ("to", 780, 905, 300.0)]
    finally:
        db.close()


def test_dieu_chuyen_giay_khong_ro_don_vi_bi_chan(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    _ba_lo(client, kho_id, g)
    adm = _login(client, "t_thukho")
    den = client.post("/api/kho", json={"ten": "Kho đích 2"}, headers=_admin(client)).json()["id"]
    # Không khổ, không đơn vị: kho nguồn có cả lô tờ lẫn lô kg ⇒ không đoán.
    r = client.post("/api/kho/dieu-chuyen", headers=adm, json={
        "kho_nguon_id": kho_id, "kho_den_id": den,
        "items": [{"hang_loai": "giay", "hang_id": g, "so_luong": 10}]})
    assert r.status_code in (400, 409, 422), r.text
    assert "đơn vị" in r.text


def test_ton_theo_khoa_tach_tung_kho_va_don_vi_giay(client):
    """`/lo/ton-khoa`: tồn toàn xưởng của MỘT mã giấy tách theo khổ + đơn vị gốc (cột Tồn của form
    yêu cầu đọc đúng ô, không cộng lẫn hai khổ hay tờ với kg)."""
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    _nhap(client, kho_id, _dong(g, dvt="ram", sl=2, kr=905, kd=780, gia=1_000_000))
    _nhap(client, kho_id, _dong(g, dvt="to", sl=300, kr=790, kd=1090, gia=600_000))
    _nhap(client, kho_id, _dong(g, dvt="kg", sl=500, kr=1000, gia=20_000))
    _nhap(client, kho_id, _dong(g, dvt="kg", sl=60, kr=790, kd=1090, gia=20_000))
    r = client.get(f"{BASE}/phieu/lo/ton-khoa", headers=_login(client, "t_thukho"),
                   params={"hang_loai": "giay", "hang_id": g})
    assert r.status_code == 200, r.text
    got = {(x["don_vi_goc"], x["kho_rong"], x["kho_dai"]): x["ton"] for x in r.json()}
    # 60 kg khổ 790×1090 quy ra 232 tờ (spec 2026-10-24 §5) ⇒ cộng vào ô tờ cùng khổ.
    assert got == {("to", 780, 905): 1000, ("to", 790, 1090): 532, ("kg", 1000, 0): 500}
