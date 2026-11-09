"""Màn Tồn kho phân trang + lọc + đếm ở MÁY CHỦ — `GET /api/kho/phieu/lo/ton-nhom` (08/10/2026).

Đơn vị phân trang là MẶT HÀNG (nhóm tồn), không phải lô: một mặt hàng nhiều lô vẫn là một dòng.
Lô được tạo thẳng vào DB (không đi qua phiếu) để bài test nói đúng thứ nó kiểm: gom, lọc, đếm, cắt trang.
"""
from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.db import SessionLocal
from app.models.stock_lot import StockLot, StockThreshold
from app.services.ton_kho_nhom_service import can_mua_theo_du_bao
from tests.test_kho_de_nghi import _login, _mk_material, _setup

URL = "/api/kho/phieu/lo/ton-nhom"
HOM_NAY = date.today()


def _lo(kho_id, hang, *, con, ban_dau=None, gia=1000, ngay=None, hsd=None, ma_lo=None, goc="") -> None:
    db = SessionLocal()
    try:
        so = db.query(StockLot).count()
        db.add(StockLot(
            ma_lo=ma_lo or f"LOT-T-{hang[1]}-{so}", hang_loai=hang[0], hang_id=hang[1], kho_id=kho_id,
            ngay_nhap=ngay or HOM_NAY, sl_ban_dau=ban_dau if ban_dau is not None else max(con, 1),
            sl_con_lai=con, don_gia_nhap=gia, hsd=hsd, trang_thai="available" if con > 0 else "empty",
            don_vi_goc=goc))
        db.commit()
    finally:
        db.close()


def _nguong(kho_id, hang, *, min_, max_=None, goc="") -> None:
    db = SessionLocal()
    try:
        db.add(StockThreshold(hang_loai=hang[0], hang_id=hang[1], kho_id=kho_id, don_vi_goc=goc,
                              nguong_ton=min_, nguong_toi_da=max_, canh_bao=True))
        db.commit()
    finally:
        db.close()


def _dung_kho(client):
    """Kho + 7 mặt hàng tên tăng dần (TK-01…TK-07):
    01 tồn 100 hai lô, chưa khai ngưỡng · 02 tồn 5 ≤ min 10 (cần mua) · 03 tồn 500 > max 300 (vượt) ·
    04 tồn 50 trong ngưỡng · 05 đã xuất hết (lô tồn 0) · 06 tồn 20 hạn 10 ngày nữa · 07 tồn 700."""
    kho_id, _ = _setup(client)
    m = {i: _mk_material(f"TK-{i:02d}") for i in range(1, 8)}
    _lo(kho_id, m[1], con=40, gia=2000, ngay=HOM_NAY - timedelta(days=40))
    _lo(kho_id, m[1], con=60, gia=2000, ngay=HOM_NAY - timedelta(days=2))
    _lo(kho_id, m[2], con=5)
    _nguong(kho_id, m[2], min_=10, max_=100)
    _lo(kho_id, m[3], con=500)
    _nguong(kho_id, m[3], min_=10, max_=300)
    _lo(kho_id, m[4], con=50)
    _nguong(kho_id, m[4], min_=10, max_=300)
    _lo(kho_id, m[5], con=0, ban_dau=10)
    _lo(kho_id, m[6], con=20, hsd=HOM_NAY + timedelta(days=10))
    _lo(kho_id, m[7], con=700)
    return kho_id, m


def _get(client, kho_id, user="t_thukho", **params):
    r = client.get(URL, headers=_login(client, user), params={"kho_id": kho_id, **params})
    assert r.status_code == 200, r.text
    return r.json()


def _ma_cac_nhom(body) -> list[str]:
    """Mã mặt hàng theo thứ tự xuất hiện trong `items` (mỗi mặt hàng một lần)."""
    ra: list[str] = []
    for lo in body["items"]:
        if lo["hang_ma"] not in ra:
            ra.append(lo["hang_ma"])
    return ra


def test_cat_trang_theo_mat_hang_khong_theo_lo(client):
    kho_id, _ = _dung_kho(client)
    p1 = _get(client, kho_id, page=1, size=3)
    # 7 mặt hàng (một mặt hàng có 2 lô, một mặt hàng đã hết) → total đếm MẶT HÀNG, không đếm lô.
    assert p1["total"] == 7
    assert _ma_cac_nhom(p1) == ["TK-01", "TK-02", "TK-03"]
    assert len(p1["items"]) == 4          # TK-01 có hai lô còn hàng
    p2 = _get(client, kho_id, page=2, size=3)
    assert _ma_cac_nhom(p2) == ["TK-04", "TK-05", "TK-06"]
    p3 = _get(client, kho_id, page=3, size=3)
    assert _ma_cac_nhom(p3) == ["TK-07"]
    assert _get(client, kho_id, page=4, size=3)["items"] == []
    # Mỗi lô chỉ xuất hiện ở đúng một trang.
    ids = [lo["id"] for p in (p1, p2, p3) for lo in p["items"]]
    assert len(ids) == len(set(ids))


def test_mat_hang_da_het_van_co_dong_voi_lo_dai_dien(client):
    kho_id, _ = _dung_kho(client)
    body = _get(client, kho_id, q="TK-05")
    assert body["total"] == 1
    (lo,) = body["items"]
    assert lo["hang_ma"] == "TK-05" and lo["sl_con_lai"] == 0


def test_dem_nam_nhom_khong_doi_theo_trang_va_nhom_dang_chon(client):
    kho_id, _ = _dung_kho(client)
    # TK-01, TK-05 (hết), TK-06, TK-07 chưa khai ngưỡng; chỉ TK-02 chạm tối thiểu; chỉ TK-03 vượt tối đa.
    mong = {"all": 7, "can_mua": 1, "du_ton": 1, "chuakhai": 4, "sap_het_han": 1}
    # Đổi trang, đổi cỡ trang, đổi NHÓM đang chọn: số đếm vẫn là của cả tập đã lọc (ở đây: không lọc gì).
    for tham_so in ({}, {"size": 2, "page": 2}, {"nhom": "can_mua"}, {"nhom": "chuakhai", "size": 1}):
        assert _get(client, kho_id, **tham_so)["dem"] == mong


def test_dem_theo_dung_tap_da_loc_chi_bo_nhom(client):
    kho_id, _ = _dung_kho(client)
    # Ô tìm: chỉ còn TK-02 (cần mua) → mọi con số co theo, không còn "Cần mua 1 / Tất cả 7" cạnh 1 dòng.
    assert _get(client, kho_id, q="tk-02")["dem"] == {
        "all": 1, "can_mua": 1, "du_ton": 0, "chuakhai": 0, "sap_het_han": 0}
    assert _get(client, kho_id, q="TK-06")["dem"] == {
        "all": 1, "can_mua": 0, "du_ton": 0, "chuakhai": 1, "sap_het_han": 1}
    # Khoảng Đang có 90..800 loại TK-02 (5), TK-04 (50), TK-05 (0), TK-06 (20): còn TK-01, TK-03, TK-07.
    d = _get(client, kho_id, ton_tu=90, ton_den=800)["dem"]
    assert d == {"all": 3, "can_mua": 0, "du_ton": 1, "chuakhai": 2, "sap_het_han": 0}
    # Kỳ Nhập gần nhất 45..30 ngày trước: chỉ TK-01 có lô trong khoảng.
    tu, den = HOM_NAY - timedelta(days=45), HOM_NAY - timedelta(days=30)
    assert _get(client, kho_id, ngay_tu=tu.isoformat(), ngay_den=den.isoformat())["dem"]["all"] == 1
    # Nhóm đang chọn KHÔNG co số đếm của chính nó và các nhóm khác, nhưng ô tìm thì có.
    body = _get(client, kho_id, nhom="can_mua", q="TK-0")
    assert body["total"] == 1 and body["dem"] == {
        "all": 7, "can_mua": 1, "du_ton": 1, "chuakhai": 4, "sap_het_han": 1}
    body = _get(client, kho_id, nhom="can_mua", q="TK-03")
    assert body["total"] == 0 and body["dem"]["all"] == 1 and body["dem"]["du_ton"] == 1


def test_loc_nhom(client):
    kho_id, _ = _dung_kho(client)
    assert _ma_cac_nhom(_get(client, kho_id, nhom="can_mua")) == ["TK-02"]
    assert _ma_cac_nhom(_get(client, kho_id, nhom="du_ton")) == ["TK-03"]
    assert _ma_cac_nhom(_get(client, kho_id, nhom="chuakhai")) == ["TK-01", "TK-05", "TK-06", "TK-07"]
    assert _ma_cac_nhom(_get(client, kho_id, nhom="sap_het_han")) == ["TK-06"]
    body = _get(client, kho_id, nhom="chuakhai", size=2)
    assert body["total"] == 4 and _ma_cac_nhom(body) == ["TK-01", "TK-05"]


def test_loc_tim_khong_dau_khoang_ton_va_ngay_nhap(client):
    kho_id, _ = _dung_kho(client)
    # Tìm theo tên không dấu: tên là "Vật tư TK-03".
    assert _ma_cac_nhom(_get(client, kho_id, q="vat tu tk-03")) == ["TK-03"]
    assert _get(client, kho_id, q="khong-co-ma-nay")["total"] == 0
    # Khoảng tồn khả dụng là TỔNG các lô của mặt hàng (TK-01 = 40 + 60).
    assert _ma_cac_nhom(_get(client, kho_id, ton_tu=90, ton_den=120)) == ["TK-01"]
    assert _ma_cac_nhom(_get(client, kho_id, ton_tu=600)) == ["TK-07"]
    # Ngày nhập: có ÍT NHẤT MỘT lô còn hàng trong khoảng (TK-01 có lô cách 40 ngày và 2 ngày).
    tu, den = HOM_NAY - timedelta(days=45), HOM_NAY - timedelta(days=30)
    assert _ma_cac_nhom(_get(client, kho_id, ngay_tu=tu.isoformat(), ngay_den=den.isoformat())) == ["TK-01"]
    gan = (HOM_NAY - timedelta(days=5)).isoformat()
    assert "TK-01" in _ma_cac_nhom(_get(client, kho_id, ngay_tu=gan))


def test_loc_gia_tri_chi_ap_khi_thay_gia(client):
    kho_id, _ = _dung_kho(client)
    # TK-01 = 100 × 2000 = 200.000; các mã khác 1.000 × tồn.
    ke_toan = _get(client, kho_id, user="t_ketoan", gt_tu=150_000, gt_den=250_000)
    assert _ma_cac_nhom(ke_toan) == ["TK-01"]
    assert ke_toan["items"][0]["don_gia_nhap"] == 2000
    # Thủ kho không có ô xem giá: không thấy tiền và bộ lọc giá trị KHÔNG được dùng để dò ra giá.
    thu_kho = _get(client, kho_id, gt_tu=150_000, gt_den=250_000)
    assert thu_kho["total"] == 7
    assert all(lo["don_gia_nhap"] is None for lo in thu_kho["items"])


def test_co_hsd_va_cua_quyen(client):
    kho_id, _ = _dung_kho(client)
    assert _get(client, kho_id)["co_hsd"] is True
    # Vai chỉ tạo đề nghị (không có quyền xem tồn) không được đọc số tồn qua đường mới.
    r = client.get(URL, headers=_login(client, "t_denghi"), params={"kho_id": kho_id})
    assert r.status_code == 403, r.text


def test_endpoint_cu_van_tra_mang_lo(client):
    kho_id, _ = _dung_kho(client)
    r = client.get("/api/kho/phieu/lo/danh-sach", headers=_login(client, "t_thukho"),
                   params={"kho_id": kho_id, "con_hang": False, "dai_dien_het": True})
    assert r.status_code == 200 and isinstance(r.json(), list)
    assert len(r.json()) == 8          # 7 mặt hàng, TK-01 hai lô


# --- Luật "Cần mua" theo dự báo (phản chiếu `tinhDuBao().canMua` của ton-kho/duBao.ts) ----------

def _th(min_):
    return SimpleNamespace(nguong_ton=min_, nguong_toi_da=None)


def test_can_mua_khi_ton_cham_toi_thieu():
    assert can_mua_theo_du_bao(10, None, _th(10)) is True
    assert can_mua_theo_du_bao(11, None, _th(10)) is False


def test_can_mua_khi_chua_khai_nguong_chi_khi_am():
    assert can_mua_theo_du_bao(0, None, None) is False
    du = {"lenh": [{"han_giao": "2026-10-10", "can": 120}], "ve": []}
    assert can_mua_theo_du_bao(100, du, None) is True       # lệnh lĩnh vượt tồn → âm


def test_hang_ve_sau_ngay_thung_khong_cuu_lenh_linh_truoc():
    du = {"lenh": [{"han_giao": "2026-10-10", "can": 95}], "ve": [{"ngay_ve": "2026-10-20", "sl": 500}]}
    assert can_mua_theo_du_bao(100, du, _th(10)) is True     # còn 5 ≤ 10 trước khi hàng về
    # Hàng về TRƯỚC ngày lĩnh thì không thủng.
    du2 = {"lenh": [{"han_giao": "2026-10-10", "can": 95}], "ve": [{"ngay_ve": "2026-10-05", "sl": 500}]}
    assert can_mua_theo_du_bao(100, du2, _th(10)) is False
    # Cùng ngày: LĨNH trước, VỀ sau.
    du3 = {"lenh": [{"han_giao": "2026-10-10", "can": 95}], "ve": [{"ngay_ve": "2026-10-10", "sl": 500}]}
    assert can_mua_theo_du_bao(100, du3, _th(10)) is True


@pytest.mark.parametrize("han_giao", [None, ""])
def test_lenh_chua_co_han_coi_nhu_linh_ngay(han_giao):
    du = {"lenh": [{"han_giao": han_giao, "can": 95}], "ve": [{"ngay_ve": "2026-10-05", "sl": 500}]}
    assert can_mua_theo_du_bao(100, du, _th(10)) is True


# --- Phán quyết "Cần mua" + số dự báo do MÁY CHỦ trả (nguồn duy nhất), cache dự báo, các ca biên ----------

def _du_bao_gia(m, *, can=None, ve=None):
    """Dòng dự báo giả của DuBaoTonService cho mặt hàng `m` (khoá 5 phần, khổ 0 × 0, đơn vị gốc "")."""
    return {
        "hang_loai": m[0], "hang_id": m[1], "kho_rong": 0, "kho_dai": 0, "don_vi_goc": "",
        "ton_toan_xuong": None,
        "can_lenh": sum(x[1] for x in (can or [])), "dang_ve": sum(x[1] for x in (ve or [])),
        "lenh": [{"ma": f"LSX-{i}", "han_giao": h, "can": c, "da_giu": 0} for i, (h, c) in enumerate(can or [])],
        "ve": [{"ma": f"PO-{i}", "ngay_ve": h, "sl": c, "mua_cho": [], "loai_mua_cac": []}
               for i, (h, c) in enumerate(ve or [])],
        "phieu_mua": [],
    }


@pytest.fixture
def du_bao_gia(monkeypatch):
    """Thay `DuBaoTonService.du_bao` bằng bản đếm lượt gọi; `ctx['rows']` do bài test đặt, `ctx['loi']` ném lỗi."""
    from app.services.du_bao_ton_service import DuBaoTonService
    from app.services.ke_hoach_vat_tu_service import KeHoachVatTuError

    ctx = {"goi": 0, "rows": [], "loi": False}

    def gia(self, hangs):
        ctx["goi"] += 1
        if ctx["loi"]:
            raise KeHoachVatTuError("bảng cân đối hỏng")
        return list(ctx["rows"])

    monkeypatch.setattr(DuBaoTonService, "du_bao", gia)
    return ctx


def test_phan_quyet_can_mua_va_so_du_bao_do_may_chu_tra(client, du_bao_gia):
    kho_id, m = _dung_kho(client)
    xa = (HOM_NAY + timedelta(days=20)).isoformat()
    # TK-04: tồn 50, min 10; lệnh sắp lĩnh 45 → còn 5 ≤ 10 → CẦN MUA dù tồn hiện có còn trong ngưỡng.
    du_bao_gia["rows"] = [_du_bao_gia(m[4], can=[(xa, 45)], ve=[(xa, 100)])]
    body = _get(client, kho_id, q="TK-04")
    (muc,) = body["nhom"]
    assert body["du_bao_ok"] is True
    assert muc["can_mua"] is True and muc["tinh_trang"] == "can_mua"
    assert (muc["can_lenh"], muc["dang_ve"], muc["du_kien"]) == (45, 100, 105)
    assert muc["duoi_cuoi"] is False                  # cuối chuỗi 105 > min nên ô Dự kiến không đỏ
    assert muc["du_bao"]["lenh"][0]["can"] == 45      # dòng đầy đủ cho ngăn chi tiết
    # Bộ lọc nhóm + số đếm dùng CÙNG phán quyết với chip của dòng.
    assert _ma_cac_nhom(_get(client, kho_id, nhom="can_mua")) == ["TK-02", "TK-04"]
    assert _get(client, kho_id)["dem"]["can_mua"] == 2
    # Dòng không có việc nào vẫn có số 0 (để màn bày "–"), không phải None.
    tk3 = _get(client, kho_id, q="TK-03")["nhom"][0]
    assert (tk3["can_lenh"], tk3["dang_ve"], tk3["du_kien"]) == (0, 0, 500)
    assert tk3["tinh_trang"] == "vuot" and tk3["can_mua"] is False


def test_chip_se_vuot_khi_hang_ve_day_vuot_toi_da(client, du_bao_gia):
    kho_id, m = _dung_kho(client)
    xa = (HOM_NAY + timedelta(days=20)).isoformat()
    # TK-04: tồn 50, max 300; đơn về 400 sau 20 ngày → sẽ vượt, chưa vượt ngay.
    du_bao_gia["rows"] = [_du_bao_gia(m[4], ve=[(xa, 400)])]
    (muc,) = _get(client, kho_id, q="TK-04")["nhom"]
    assert muc["tinh_trang"] == "se_vuot" and muc["can_mua"] is False


def test_du_bao_cache_mot_lan_roi_xoa_cung_cho_voi_can_doi(client, du_bao_gia):
    from app.services.can_doi_cache import xoa_cache_can_doi

    kho_id, _ = _dung_kho(client)
    _get(client, kho_id)
    _get(client, kho_id, page=2, size=2)
    _get(client, kho_id, q="TK-03")
    _get(client, kho_id, nhom="can_mua")
    assert du_bao_gia["goi"] == 1, "đổi trang / tìm / lọc không được dựng lại dự báo cả kho"
    # Sự kiện xoá cache cân đối (đổi lệnh, giữ chỗ, phiếu mua…) cũng xoá dự báo này.
    xoa_cache_can_doi()
    _get(client, kho_id)
    assert du_bao_gia["goi"] == 2


def test_dem_va_ton_doc_tuoi_du_du_bao_cache(client, du_bao_gia):
    """Dự báo cache nhưng tồn và ngưỡng đọc tươi: thêm lô / khai ngưỡng thì số đổi ngay."""
    kho_id, m = _dung_kho(client)
    assert _get(client, kho_id)["dem"]["can_mua"] == 1
    _lo(kho_id, m[7], con=1)            # TK-07: 700 → 701, không đụng dự báo
    _nguong(kho_id, m[7], min_=800)     # nay tồn 701 ≤ 800 ⇒ Cần mua
    body = _get(client, kho_id)
    assert body["dem"]["can_mua"] == 2
    assert _ma_cac_nhom(_get(client, kho_id, nhom="can_mua")) == ["TK-02", "TK-07"]
    assert du_bao_gia["goi"] == 1


def test_du_bao_hong_van_tra_trang_va_khong_bi_cache(client, du_bao_gia):
    kho_id, _ = _dung_kho(client)
    du_bao_gia["loi"] = True
    body = _get(client, kho_id)
    assert body["du_bao_ok"] is False and body["total"] == 7
    assert all(m["du_bao"] is None and m["du_kien"] is None for m in body["nhom"])
    assert body["dem"]["can_mua"] == 1               # lùi về mức tồn so với ngưỡng (TK-02)
    # Chip lùi về mức của tồn hiện có.
    assert {m["tinh_trang"] for m in body["nhom"]} == {"can_mua", "vuot", "chua", "het", None}
    _get(client, kho_id)
    assert du_bao_gia["goi"] == 2, "bản lùi không được cất cache"
    du_bao_gia["loi"] = False                         # hết hỏng → dự báo trở lại ngay, không đợi hết hạn
    assert _get(client, kho_id)["du_bao_ok"] is True


def test_giay_cu_chua_co_kho_khop_nguong_kho_0x0(client, du_bao_gia):
    """Giấy nhập trước khi có khổ: khoá dòng `giay:<id>:0:0:kg` (vẫn mang đơn vị gốc của lô), ngưỡng
    lưu ở (giay, id, 0, 0, kg). Phán quyết phải thấy ngưỡng đó — cả "đã khai" lẫn "Cần mua"."""
    from tests.test_kho_lo_giay import _giay

    kho_id, _ = _dung_kho(client)
    g = ("giay", _giay("GC-CU"))
    _lo(kho_id, g, con=8, ngay=HOM_NAY, goc="kg")
    _nguong(kho_id, g, min_=10, max_=100, goc="kg")
    body = _get(client, kho_id, q="GC-CU")
    (muc,) = body["nhom"]
    assert muc["khoa"] == f"giay:{g[1]}:0:0:kg" and muc["don_vi_goc"] == "kg"
    assert muc["co_nguong"] is True and muc["can_mua"] is True and muc["tinh_trang"] == "can_mua"
    assert _get(client, kho_id, nhom="chuakhai", q="GC-CU")["total"] == 0
    # Chưa khai ngưỡng thì mới là "Chưa đặt mức".
    h = ("giay", _giay("GC-CU2"))
    _lo(kho_id, h, con=8, ngay=HOM_NAY, goc="kg")
    (muc2,) = _get(client, kho_id, q="GC-CU2")["nhom"]
    assert muc2["co_nguong"] is False and muc2["tinh_trang"] == "chua" and muc2["can_mua"] is False


def test_ton_am_khong_du_bao_van_la_can_mua():
    """Tồn khả dụng ÂM, không lệnh/đơn về nào, chưa khai ngưỡng: dự báo trống (`[]`) cũng không được
    che mất "Cần mua" (trước đây `bool(du_bao)` chặn luật âm lại). DB có CHECK `sl_con_lai >= 0` nên
    ca này dựng bằng repo giả ở mức service."""
    from app.services.ton_kho_nhom_service import LocTon, TonKhoNhomService

    dong = SimpleNamespace(hang_loai="vat_tu", hang_id=1, don_vi_goc="", kho_rong=0, kho_dai=0,
                           tong=-5.0, gia_tri=0.0, hsd_som=None)
    lots = SimpleNamespace(tong_hop_ton_theo_khoa=lambda kho_id: [dong], list_lots_gon=lambda **k: [],
                           khoa_co_lo_nhap_trong=lambda *a: set())
    hang = SimpleNamespace(map_theo_cap=lambda cap: {})
    nguong = SimpleNamespace(list_active=lambda kho_id: [])
    ket = TonKhoNhomService(lots, nguong, hang, lambda khoas: []).trang(987_654, LocTon(), 1, 25)
    (muc,) = ket["nhom"]
    assert muc["can_mua"] is True and muc["tinh_trang"] == "het" and ket["dem"]["can_mua"] == 1


def test_chi_lay_mot_mat_hang_de_nap_lai_dong_ngoai_trang(client, du_bao_gia):
    kho_id, m = _dung_kho(client)
    body = _get(client, kho_id, hang_loai=m[3][0], hang_id=m[3][1], size=1)
    assert _ma_cac_nhom(body) == ["TK-03"] and body["total"] == 1
    assert body["nhom"][0]["hang_id"] == m[3][1]
    assert body["dem"]["all"] == 7           # tra cứu theo mặt hàng không làm co số đếm


def test_nguoi_khong_co_o_xem_gia_cua_kho_do_khong_thay_tien(client, du_bao_gia):
    from app.models.role import SCOPE_ALL
    from tests.test_kho_de_nghi import _admin
    from tests.test_quyen_theo_kho import _kho, _nguoi

    kho_a, m = _dung_kho(client)
    kho_b = _kho(client, _admin(client), "Kho B tiền")
    _lo(kho_a, m[1], con=10, gia=5000)
    _lo(kho_b, m[1], con=10, gia=5000)
    xem = dict(can_read=True, scope=SCOPE_ALL)
    _nguoi("tn_gia_a", {f"ton_kho_{kho_a}": {**xem, "can_view_cost": True}, f"ton_kho_{kho_b}": dict(xem)})
    u = _login(client, "tn_gia_a")

    def lay(kho, **tham_so):
        r = client.get(URL, headers=u, params={"kho_id": kho, "q": "TK-01", **tham_so})
        assert r.status_code == 200, r.text
        return r.json()

    a = lay(kho_a)
    assert a["items"] and all(lo["don_gia_nhap"] is not None for lo in a["items"])
    b = lay(kho_b)
    assert b["items"] and all(lo["don_gia_nhap"] is None and lo.get("don_gia_ban") is None for lo in b["items"])
    # Khoảng giá trị KHÔNG được dùng để dò ra giá ở kho không có ô xem giá: lọc 1..2 đ vẫn ra dòng.
    assert lay(kho_b, gt_tu=1, gt_den=2)["total"] == 1
    # Còn ở kho có ô xem giá thì khoảng đó áp thật: 10 × 5000 = 50.000 không nằm trong 1..2.
    assert lay(kho_a, gt_tu=1, gt_den=2)["total"] == 0
    # Phản hồi không mang trường tiền thừa (giá trị tồn chỉ để lọc ở máy chủ).
    assert not any("gia_tri" in lo for lo in b["items"] + a["items"])


def test_tinh_trang_dong_don_vi():
    from app.services.ton_kho_nhom_service import tinh_du_bao_gon, tinh_trang_dong

    ngay = date(2026, 10, 8)
    th = SimpleNamespace(nguong_ton=10, nguong_toi_da=100)
    # Vượt NGAY (đang trên tối đa) khác SẼ vượt (hàng về làm vượt).
    assert tinh_trang_dong(150, "du_ton", True, tinh_du_bao_gon(150, None, th, ngay)) == "vuot"
    sap = {"lenh": [], "ve": [{"ngay_ve": "2026-11-01", "sl": 200}]}
    assert tinh_trang_dong(50, "du", True, tinh_du_bao_gon(50, sap, th, ngay)) == "se_vuot"
    # Đơn về đã quá hẹn mà chưa về coi như về hôm nay → "vuot".
    tre = {"lenh": [], "ve": [{"ngay_ve": "2026-09-01", "sl": 200}]}
    assert tinh_trang_dong(50, "du", True, tinh_du_bao_gon(50, tre, th, ngay)) == "vuot"
    assert tinh_trang_dong(50, "du", True, tinh_du_bao_gon(50, None, th, ngay)) is None
    assert tinh_trang_dong(50, None, False, tinh_du_bao_gon(50, None, None, ngay)) == "chua"
    # Dự báo không dùng được: lùi về mức tồn hiện có.
    assert tinh_trang_dong(5, "can_mua", True, None) == "can_mua"
    assert tinh_trang_dong(0, "het", False, None) == "het"


# --- Cache dự báo: ngăn phụ có trần riêng, không đuổi bảng cân đối; single-flight --------------------

def test_day_ngan_phu_khong_duoi_muc_bang_can_doi():
    from app.services import can_doi_cache as cache

    dem = {"chinh": 0}

    def tinh_chinh():
        dem["chinh"] += 1
        return {"items": [1, 2, 3]}

    cache.lay_hoac_tinh(tinh_chinh, q="", chi_thieu=False)            # mục kiểu `bang_can_doi`
    for i in range(cache._TRAN_KHOA_PHU + 30):                         # churn: mỗi hình dạng tồn một khoá
        cache.lay_hoac_tinh(lambda i=i: {"rows": [i]}, ngan=cache.NGAN_PHU,
                            loai="ton_nhom_du_bao", kho_id=1, khoas=f"hinh-{i}")
    assert len(cache._bo_nho_phu) <= cache._TRAN_KHOA_PHU, "ngăn phụ phải có trần"
    cache.lay_hoac_tinh(tinh_chinh, q="", chi_thieu=False)
    assert dem["chinh"] == 1, "churn của dự báo tồn đã đuổi mục bảng cân đối"
    # Mục MỚI NHẤT của ngăn phụ còn, mục cũ nhất bị đuổi (đuổi từng mục, không clear cả ngăn).
    moi = cache._doc(cache.khoa_cache(loai="ton_nhom_du_bao", kho_id=1, khoas=f"hinh-{cache._TRAN_KHOA_PHU + 29}"),
                     cache.NGAN_PHU)
    assert moi == {"rows": [cache._TRAN_KHOA_PHU + 29]}
    cu = cache._doc(cache.khoa_cache(loai="ton_nhom_du_bao", kho_id=1, khoas="hinh-0"), cache.NGAN_PHU)
    assert cu is None
    # Sự kiện xoá cache vẫn xoá cả hai ngăn.
    cache.xoa_cache_can_doi()
    assert not cache._bo_nho and not cache._bo_nho_phu


def test_khoa_nguoi_chi_tinh_mot_lan_khi_nhieu_request_cung_luc():
    import threading
    import time

    from app.services import can_doi_cache as cache

    dem = {"n": 0}

    def tinh():
        dem["n"] += 1
        time.sleep(0.2)          # đủ lâu để các luồng kia đã vào hàng chờ
        return {"rows": [1]}

    kq: list = []
    luong = [threading.Thread(target=lambda: kq.append(
        cache.lay_hoac_tinh(tinh, ngan=cache.NGAN_PHU, loai="ton_nhom_du_bao", kho_id=7, khoas="x")))
        for _ in range(6)]
    for t in luong:
        t.start()
    for t in luong:
        t.join()
    assert dem["n"] == 1 and len(kq) == 6 and all(k == {"rows": [1]} for k in kq)
    assert not cache._dang_tinh, "bảng ổ khoá phải rỗng sau khi xong"
