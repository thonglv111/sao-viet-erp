"""Phiếu tính giá: Giấy và Sóng chọn MỘT lần cho sản phẩm (spec 2026-10-24-chuan-bi-giay §4).

`giay_id` = mã loại Giấy, `song_id` (mới) = mã loại Sóng; bước không mang giấy nữa. Tiền giấy là dòng
cấp sản phẩm theo tờ nguyên; tiền sóng theo SL vào của bước bồi hệ thống đầu tiên, khổ sóng = khổ in.
"""
from __future__ import annotations

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.db_migrations import MIGRATIONS
from app.models.cong_doan import CongDoan
from app.models.vat_lieu_kho import GiayNguyen
from app.services.thanh_phan_engine import compute_phieu
from tests.test_giay_vat_tu_buoc import _giay, _seed, _tp, h  # noqa: F401


def _doi_loai(gid: int, loai: str) -> None:
    db = SessionLocal()
    try:
        db.get(GiayNguyen, gid).loai = loai
        db.commit()
    finally:
        db.close()


def _id_boi() -> int:
    db = SessionLocal()
    try:
        return db.query(CongDoan).filter(CongDoan.ma == "BTĐ").one().id
    finally:
        db.close()


def _tp_boi(ids, **kw) -> dict:
    tp = _tp(ids, **{k: v for k, v in kw.items() if k in ("giay_id", "vt_in", "vt_can")})
    tp["thanh_phams"][1] = {"ten": "Bồi", "cong_doan_id": _id_boi(), "vat_tus": []}
    for k, v in kw.items():
        if k not in ("giay_id", "vt_in", "vt_can"):
            tp[k] = v
    return tp


def _nvl(out) -> list[dict]:
    return next(g for g in out["result"]["groups"] if g["idx"] == "nvl")["rows"]


# ============================ Lưu phiếu ============================
def test_luu_phieu_giay_va_song_cap_san_pham(client, h):
    ids = _seed()
    _doi_loai(ids["b"], "song")
    r = client.post("/api/phieu-tinh-gia", json={"so_luong": 1000, "thanh_phans": [
        _tp_boi(ids, giay_id=ids["a"], song_id=ids["b"])]}, headers=h)
    assert r.status_code == 201, r.text
    tp = r.json()["thanh_phans"][0]
    assert (tp["giay_id"], tp["song_id"]) == (ids["a"], ids["b"])
    assert all(v["hang_loai"] != "giay" for b in tp["thanh_phams"] for v in b["vat_tus"])
    assert {x["loai"] for x in _nvl(r.json())} >= {"giay", "song"}


def test_song_khong_co_buoc_boi_422(client, h):
    ids = _seed()
    _doi_loai(ids["b"], "song")
    r = client.post("/api/phieu-tinh-gia", json={"so_luong": 1000, "thanh_phans": [
        {**_tp(ids, giay_id=ids["a"]), "song_id": ids["b"]}]}, headers=h)
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == "Sản phẩm có sóng nhưng chuỗi chưa có bước bồi."


def test_giay_id_la_ma_song_422(client, h):
    ids = _seed()
    _doi_loai(ids["a"], "song")
    r = client.post("/api/phieu-tinh-gia", json={"so_luong": 1000, "thanh_phans": [
        _tp(ids, giay_id=ids["a"])]}, headers=h)
    assert r.status_code == 422, r.text
    assert "Ivory 300" in r.json()["detail"] and "sóng" in r.json()["detail"]


def test_song_id_la_ma_giay_422(client, h):
    ids = _seed()
    r = client.post("/api/phieu-tinh-gia", json={"so_luong": 1000, "thanh_phans": [
        _tp_boi(ids, giay_id=ids["a"], song_id=ids["b"])]}, headers=h)
    assert r.status_code == 422, r.text
    assert "Carton 500" in r.json()["detail"]


def test_vat_tu_buoc_hang_loai_giay_422(client, h):
    ids = _seed()
    r = client.post("/api/phieu-tinh-gia", json={"so_luong": 1000, "thanh_phans": [
        _tp(ids, vt_in=[_giay(ids["a"])])]}, headers=h)
    assert r.status_code == 422, r.text


def test_tien_giay_cap_san_pham_khi_co_chuoi(client, h):
    ids = _seed()
    r = client.post("/api/phieu-tinh-gia", json={"so_luong": 1000, "thanh_phans": [
        _tp(ids, giay_id=ids["a"])]}, headers=h)
    assert r.status_code == 201, r.text
    (g,) = [x for x in _nvl(r.json()) if x.get("loai") == "giay"]
    to_ng = r.json()["result"]["meta"]["components"][0]["to_nguyen"]
    assert to_ng > 0 and g.get("buoc_idx") is None     # dòng CẤP SẢN PHẨM, không gắn bước
    assert g["thanh_tien"] == round(0.3 * 1.09 * 0.79 * 20000 * to_ng, 2)


# ============================ Engine: tiền sóng ============================
def _buoc(ten, *, nhom="finishing", ma=None, hao=0) -> dict:
    return {"ten": ten, "vat_tus": [], "cong_doan": {
        "ten": ten, "ma": ma, "nhom": nhom, "kieu_bu_hao": "co_dinh" if hao else "khong",
        "so_to_bu_hao": hao, "don_vi_vao": "to", "don_vi_ra": "to"}}


def _tp_song(song: dict) -> dict:
    """Tờ in 650×430, 49 con/tờ; In → Bồi BTĐ (bù 20 tờ). SL 49.000 ⇒ 1.000 tờ ra ⇒ Bồi vào 1.020."""
    return {"ten": "Hộp", "quy_cach_in": "mot_mat", "con_auto": True,
            "dai_thanh_pham": 90, "rong_thanh_pham": 54, "kho_in_dai": 650, "kho_in_rong": 430,
            "kho_dai": 860, "kho_rong": 650, "so_mau_a": 4, "co_in": True, "song": song,
            "thanh_phams": [_buoc("In", nhom="print"), _buoc("Bồi", ma="BTĐ", hao=20)]}


def _song(**kw) -> dict:
    return {"vat_tu_id": 9, "ten": "Sóng E", "gsm": 400, "he_so": 1.0, **kw}


def _dong_song(res) -> dict:
    (s,) = [r for r in next(g for g in res["groups"] if g["idx"] == "nvl")["rows"]
            if r.get("loai") == "song"]
    return s


def _vao_boi(res) -> int:
    return next(x["vao"] for x in res["meta"]["components"][0]["bu_hao_chi_tiet"] if x["ten"] == "Bồi")


def test_tien_song_theo_so_to_vao_buoc_boi():
    res = compute_phieu(so_luong=49000, thanh_phans=[_tp_song(_song(don_gia=2000, don_vi_gia="to"))])
    assert _vao_boi(res) == 1020
    s = _dong_song(res)
    assert s["so_to"] == 1020 and s["thanh_tien"] == 2_040_000


def test_tien_song_gia_kg_theo_kho_in():
    res = compute_phieu(so_luong=49000, thanh_phans=[_tp_song(_song(don_gia=12000, don_vi_gia="kg"))])
    s = _dong_song(res)
    assert s["thanh_tien"] == round(0.4 * 0.65 * 0.43 * 12000 * 1020, 2)


# ============================ Dữ liệu cũ ============================
def _db_cu() -> Session:
    db = Session(create_engine("sqlite://"))
    for sql in (
        "CREATE TABLE giay_nguyen (id INTEGER PRIMARY KEY, loai VARCHAR(8))",
        "CREATE TABLE phieu_thanh_phan (id INTEGER PRIMARY KEY, giay_id INTEGER)",
        "CREATE TABLE phieu_thanh_pham (id INTEGER PRIMARY KEY, thanh_phan_id INTEGER, thu_tu INTEGER)",
        "CREATE TABLE phieu_buoc_vat_tu (id INTEGER PRIMARY KEY, thanh_pham_id INTEGER, "
        "thu_tu INTEGER NOT NULL DEFAULT 0, hang_loai VARCHAR(10) NOT NULL DEFAULT 'vat_tu', "
        "vat_tu_id INTEGER NOT NULL)",
        "INSERT INTO giay_nguyen (id, loai) VALUES (5, 'giay'), (6, 'song')",
        # 10: giấy ở In + sóng ở Bồi. 11: chỉ sóng (giấy chính cũ = sóng). 12: không bước.
        "INSERT INTO phieu_thanh_phan (id, giay_id) VALUES (10, 5), (11, 6), (12, 5)",
        "INSERT INTO phieu_thanh_pham (id, thanh_phan_id, thu_tu) VALUES (100, 10, 0), (101, 10, 1), "
        "(110, 11, 0)",
        "INSERT INTO phieu_buoc_vat_tu (thanh_pham_id, thu_tu, hang_loai, vat_tu_id) VALUES "
        "(100, 0, 'vat_tu', 7), (100, 1, 'giay', 5), (101, 0, 'giay', 6), (110, 0, 'giay', 6)",
    ):
        db.execute(text(sql))
    db.commit()
    return db


def test_migration_0445_dua_giay_buoc_len_san_pham():
    db = _db_cu()
    mg = dict(MIGRATIONS)["0445_ptg_song_id_giay_len_san_pham"]
    mg(db)
    mg(db)   # chạy lại không đổi gì
    tp = {r[0]: (r[1], r[2]) for r in db.execute(text(
        "SELECT id, giay_id, song_id FROM phieu_thanh_phan")).all()}
    assert tp == {10: (5, 6), 11: (None, 6), 12: (5, None)}
    assert db.execute(text("SELECT COUNT(*) FROM phieu_buoc_vat_tu WHERE hang_loai = 'giay'")).scalar() == 0
    assert db.execute(text("SELECT vat_tu_id FROM phieu_buoc_vat_tu")).scalars().all() == [7]


def test_cau_hinh_tai_ban_cu_doi_luc_nap():
    from app.services.ptg_giay_buoc import ThongTinGiay, chuyen_giay_buoc_len_san_pham

    bang = {5: ThongTinGiay("giay", "Couche"), 6: ThongTinGiay("song", "Sóng E")}
    cfg = {"giay_id": 5, "thanh_phams": [
        {"cong_doan_id": 1, "vat_tus": [{"vat_tu_id": 7}, {"hang_loai": "giay", "vat_tu_id": 5}]},
        {"cong_doan_id": 2, "vat_tus": [{"hang_loai": "giay", "vat_tu_id": 6}]}]}
    out = chuyen_giay_buoc_len_san_pham(cfg, bang)
    assert (out["giay_id"], out["song_id"]) == (5, 6)
    assert [b["vat_tus"] for b in out["thanh_phams"]] == [[{"vat_tu_id": 7}], []]
    # Chỉ có sóng ở `giay_id` (giấy chính cũ), không dòng bước ⇒ chuyển sang ô Sóng.
    out = chuyen_giay_buoc_len_san_pham({"giay_id": 6, "thanh_phams": []}, bang)
    assert (out["giay_id"], out["song_id"]) == (None, 6)


def test_xoa_ma_song_dang_dung_o_phieu_bi_chan(client, h):
    """Mã đang là SÓNG của một sản phẩm tính giá ⇒ luồng xoá danh mục phải báo vướng, như `giay_id`."""
    from app.services.danh_muc_tham_chieu import tham_chieu

    ids = _seed()
    _doi_loai(ids["b"], "song")
    r = client.post("/api/phieu-tinh-gia", json={"so_luong": 1000, "thanh_phans": [
        _tp_boi(ids, giay_id=ids["a"], song_id=ids["b"])]}, headers=h)
    assert r.status_code == 201, r.text
    db = SessionLocal()
    try:
        assert any("phiếu tính giá" in c for c in tham_chieu(db, "giay", db.get(GiayNguyen, ids["b"])).chan)
    finally:
        db.close()
