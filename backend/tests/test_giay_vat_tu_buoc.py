"""Giấy là vật tư của BƯỚC (18/10/2026, plan docs/superpowers/plans/2026-10-18-giay-la-vat-tu-cua-buoc.md).

Phiếu tính giá thôi chọn giấy ở mục "Giấy nguyên": giấy thêm vào công đoạn qua ô "Thêm vật tư"
(`phieu_buoc_vat_tu.hang_loai = 'giay'`), `phieu_thanh_phan.giay_id` thành giấy chính dẫn xuất.
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.db_migrations import MIGRATIONS


# ============================ Migration 0419 ============================
def _mg(db: Session) -> None:
    dict(MIGRATIONS)["0419_phieu_buoc_vat_tu_hang_loai"](db)


def _db_cu() -> Session:
    """Ba bảng ĐÚNG hình dạng trước 0419 — `phieu_buoc_vat_tu` chưa có `hang_loai`."""
    db = Session(create_engine("sqlite://"))
    for sql in (
        "CREATE TABLE cong_doan (id INTEGER PRIMARY KEY, nhom VARCHAR(20))",
        "CREATE TABLE phieu_thanh_phan (id INTEGER PRIMARY KEY, giay_id INTEGER)",
        "CREATE TABLE phieu_thanh_pham (id INTEGER PRIMARY KEY, thanh_phan_id INTEGER, "
        "thu_tu INTEGER, cong_doan_id INTEGER)",
        "CREATE TABLE phieu_buoc_vat_tu (id INTEGER PRIMARY KEY, thanh_pham_id INTEGER, "
        "thu_tu INTEGER NOT NULL DEFAULT 0, vat_tu_id INTEGER NOT NULL, gia_tri_chip JSON, "
        "created_at DATETIME, updated_at DATETIME)",
        "INSERT INTO cong_doan (id, nhom) VALUES (1, 'finishing'), (2, 'print')",
    ):
        db.execute(text(sql))
    db.commit()
    return db


def _dong(db: Session, thanh_pham_id: int) -> list[tuple]:
    return [tuple(r) for r in db.execute(text(
        "SELECT hang_loai, vat_tu_id, thu_tu FROM phieu_buoc_vat_tu WHERE thanh_pham_id = :b "
        "ORDER BY thu_tu"), {"b": thanh_pham_id}).all()]


def test_mg_0419_chuyen_giay_id_thanh_dong_buoc_in():
    db = _db_cu()
    db.execute(text("INSERT INTO phieu_thanh_phan (id, giay_id) VALUES (10, 5)"))
    # Cắt đứng TRƯỚC In: giấy vẫn phải vào bước In, không vào bước đầu chuỗi.
    db.execute(text("INSERT INTO phieu_thanh_pham (id, thanh_phan_id, thu_tu, cong_doan_id) "
                    "VALUES (100, 10, 0, 1), (101, 10, 1, 2)"))
    db.execute(text("INSERT INTO phieu_buoc_vat_tu (thanh_pham_id, thu_tu, vat_tu_id) "
                    "VALUES (101, 0, 7)"))
    db.commit()

    _mg(db)
    assert _dong(db, 100) == []
    assert _dong(db, 101) == [("vat_tu", 7, 0), ("giay", 5, 1)]

    _mg(db)   # chạy lại không nhân dòng
    assert _dong(db, 101) == [("vat_tu", 7, 0), ("giay", 5, 1)]


def test_mg_0419_khong_buoc_in_thi_vao_buoc_dau_khong_buoc_thi_bo_qua():
    db = _db_cu()
    db.execute(text("INSERT INTO phieu_thanh_phan (id, giay_id) VALUES (10, 5), (11, 6), (12, NULL)"))
    db.execute(text("INSERT INTO phieu_thanh_pham (id, thanh_phan_id, thu_tu, cong_doan_id) "
                    "VALUES (100, 10, 1, 1), (101, 10, 0, NULL), (102, 12, 0, 2)"))
    db.commit()

    _mg(db)
    assert _dong(db, 101) == [("giay", 5, 0)]     # bước thu_tu nhỏ nhất
    assert _dong(db, 100) == []
    assert _dong(db, 102) == []                   # thành phần không có giấy
    # Thành phần 11 không bước nào ⇒ không có chỗ đặt, giữ nguyên giay_id.
    assert db.execute(text("SELECT giay_id FROM phieu_thanh_phan WHERE id = 11")).scalar() == 6


# ============================ Lưu phiếu: máy chủ chốt giấy chính ============================
import pytest  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models.cong_doan import CongDoan  # noqa: E402
from app.models.vat_lieu_kho import GiayNguyen, VatTuInAn  # noqa: E402


@pytest.fixture
def h(client, seed_credentials) -> dict[str, str]:
    r = client.post("/api/auth/login", json=seed_credentials)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _seed() -> dict[str, int]:
    """Hai giấy + In + Cán + một vật tư CÙNG id với giấy A (để soi lẫn khoá)."""
    db = SessionLocal()
    try:
        a = GiayNguyen(don_vi_them=["kg"], ma="G-A", ten="Ivory 300", gsm=300,
                       don_vi_gia="kg", don_gia=20000)
        b = GiayNguyen(don_vi_them=["kg"], ma="G-B", ten="Carton 500", gsm=500,
                       don_vi_gia="kg", don_gia=10000)
        cd_in = CongDoan(ma="CD-IN", ten="In offset", nhom="print", kieu_bu_hao="khong",
                         don_vi_vao="to", don_vi_ra="to")
        cd_can = CongDoan(ma="CD-CAN", ten="Cán màng", nhom="finishing", kieu_bu_hao="khong",
                          don_vi_vao="to", don_vi_ra="to")
        db.add_all([a, b, cd_in, cd_can])
        db.flush()
        vt = VatTuInAn(id=a.id, ma="VT-X", ten="Keo X", don_vi_gia="kg", don_gia=1,
                       cong_thuc_gia="don_gia_vat_tu * 1")
        db.add(vt)
        db.flush()
        ids = {"a": a.id, "b": b.id, "in": cd_in.id, "can": cd_can.id, "vt": vt.id}
        db.commit()
        return ids
    finally:
        db.close()


def _tp(ids, *, giay_id=None, vt_in=(), vt_can=()) -> dict:
    tp = {"ten": "Tờ rơi", "so_luong": 1000, "dai_thanh_pham": 210, "rong_thanh_pham": 297,
          "kho_nguyen_dai": 1090, "kho_nguyen_rong": 790, "kho_in_dai": 545, "kho_in_rong": 790,
          "muc_a": ["C", "M", "Y", "K"],
          "thanh_phams": [
              {"ten": "In", "cong_doan_id": ids["in"], "vat_tus": list(vt_in)},
              {"ten": "Cán", "cong_doan_id": ids["can"], "vat_tus": list(vt_can)},
          ]}
    if giay_id is not None:
        tp["giay_id"] = giay_id
    return tp


def _giay(gid) -> dict:
    return {"hang_loai": "giay", "vat_tu_id": gid}


def _luu(client, h, tp) -> dict:
    r = client.post("/api/phieu-tinh-gia", json={"so_luong": 1000, "thanh_phans": [tp]}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _dong_buoc(tp_out) -> list[list[tuple]]:
    return [[(v["hang_loai"], v["vat_tu_id"]) for v in b["vat_tus"]] for b in tp_out["thanh_phams"]]


def test_payload_cu_giay_id_thanh_dong_giay_o_buoc_in(client, h):
    ids = _seed()
    out = _luu(client, h, _tp(ids, giay_id=ids["a"]))["thanh_phans"][0]
    assert _dong_buoc(out) == [[("giay", ids["a"])], []]
    assert out["giay_id"] == ids["a"]


def test_giay_chi_o_buoc_can_la_giay_chinh(client, h):
    ids = _seed()
    out = _luu(client, h, _tp(ids, vt_can=[_giay(ids["b"])]))["thanh_phans"][0]
    assert out["giay_id"] == ids["b"]


def test_giay_o_buoc_in_thang_giay_buoc_sau(client, h):
    ids = _seed()
    # Mỗi sản phẩm chỉ một mã loại Giấy (19/10/2026) — mã thứ hai phải là Sóng mới lưu được.
    db = SessionLocal()
    db.get(GiayNguyen, ids["b"]).loai = "song"
    db.commit()
    db.close()
    out = _luu(client, h, _tp(ids, vt_in=[_giay(ids["a"])], vt_can=[_giay(ids["b"])]))["thanh_phans"][0]
    assert out["giay_id"] == ids["a"]
    assert _dong_buoc(out) == [[("giay", ids["a"])], [("giay", ids["b"])]]


def test_xoa_dong_giay_thi_giay_chinh_ve_null(client, h):
    ids = _seed()
    p = _luu(client, h, _tp(ids, vt_in=[_giay(ids["a"])]))
    r = client.put(f"/api/phieu-tinh-gia/{p['id']}",
                   json={"thanh_phans": [_tp(ids)]}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["thanh_phans"][0]["giay_id"] is None


def test_giay_va_vat_tu_trung_id_khong_lan(client, h):
    ids = _seed()
    assert ids["vt"] == ids["a"]
    out = _luu(client, h, _tp(ids, vt_in=[_giay(ids["a"]), {"vat_tu_id": ids["vt"]}]))
    assert _dong_buoc(out["thanh_phans"][0])[0] == [("giay", ids["a"]), ("vat_tu", ids["vt"])]
    nvl = next(g for g in out["result"]["groups"] if g["idx"] == "nvl")["rows"]
    ten = {r["loai"]: r["ten"] for r in nvl if r.get("buoc_idx") == 0}
    assert "Ivory 300" in ten["giay"] and "Keo X" in ten["vat_tu"]


def test_cau_hinh_tai_ban_cu_chuyen_giay_vao_buoc_in():
    """Cấu hình tái bản chụp trước 18/10 (JSON trên mã thành phẩm) — `giay_id` không kèm dòng giấy."""
    from app.services.ptg_giay_buoc import chuan_hoa_giay

    nhom = {1: "finishing", 2: "print"}.get
    cfg = {"giay_id": 9, "thanh_phams": [{"cong_doan_id": 1, "vat_tus": []},
                                         {"cong_doan_id": 2, "vat_tus": [{"vat_tu_id": 4}]}]}
    out = chuan_hoa_giay(cfg, nhom)
    assert out["thanh_phams"][1]["vat_tus"][-1]["hang_loai"] == "giay"
    assert out["thanh_phams"][1]["vat_tus"][-1]["vat_tu_id"] == 9
    assert out["giay_id"] == 9
    # Chuỗi rỗng: không có chỗ đặt, giữ nguyên giấy cấp sản phẩm.
    assert chuan_hoa_giay({"giay_id": 9, "thanh_phams": []}, nhom)["giay_id"] == 9


# ============================ Engine: tiền giấy theo bước ============================
from math import ceil  # noqa: E402

from app.services.thanh_phan_engine import compute_phieu  # noqa: E402


def _buoc_e(ten, dv_vao, dv_ra, *, nhom="finishing", hao=0, vat_tus=()) -> dict:
    return {"ten": ten, "vat_tus": list(vat_tus), "cong_doan": {
        "ten": ten, "nhom": nhom, "kieu_bu_hao": "co_dinh" if hao else "khong",
        "so_to_bu_hao": hao, "don_vi_vao": dv_vao, "don_vi_ra": dv_ra}}


def _tp_e(*buocs, **kw) -> dict:
    """Giấy nguyên 860×650, tờ in 650×430 ⇒ xả 2; 49 con/tờ. KHÔNG mang giá giấy cấp sản phẩm."""
    return {"ten": "Card", "quy_cach_in": "hai_mat", "con_auto": True,
            "dai_thanh_pham": 90, "rong_thanh_pham": 54, "kho_in_dai": 650, "kho_in_rong": 430,
            "kho_dai": 860, "kho_rong": 650, "so_mau_a": 4, "so_mau_b": 4, "co_in": True,
            "thanh_phams": list(buocs), **kw}


def _gy(gid, ten, *, gsm, don_gia, dv) -> dict:
    return {"hang_loai": "giay", "vat_tu_id": gid, "ten": ten, "gsm": gsm, "don_gia": don_gia,
            "don_vi_gia": dv, "he_so": 1.0, "goc": "kg" if dv == "kg" else "to"}


def _dong_giay(res) -> list[dict]:
    return [r for r in next(g for g in res["groups"] if g["idx"] == "nvl")["rows"]
            if r.get("loai") == "giay"]


def test_engine_giay_o_buoc_in_tinh_bang_giay_cap_san_pham_cu():
    to = _gy(1, "Couche 300", gsm=300, don_gia=5000, dv="to")
    moi = compute_phieu(so_luong=5000, thanh_phans=[_tp_e(
        _buoc_e("In", "to", "to", nhom="print", hao=150, vat_tus=[to]),
        _buoc_e("Cán", "to", "to", hao=50))])
    cu = compute_phieu(so_luong=5000, thanh_phans=[_tp_e(
        _buoc_e("In", "to", "to", nhom="print", hao=150), _buoc_e("Cán", "to", "to", hao=50),
        don_gia_giay=5000, don_gia_don_vi="to", gsm=300, giay_ten="Couche 300")])
    (g,) = _dong_giay(moi)
    assert g["thanh_tien"] == _dong_giay(cu)[0]["thanh_tien"] > 0
    assert g["buoc_idx"] == 0 and g["vat_tu_id"] == 1
    # Lượng = SL vào của In, đếm tờ (in); khổ tờ in hiện cạnh tên giấy.
    assert g["dinh_muc"] == moi["meta"]["components"][0]["to_dau_vao"] and g["dinh_muc_don_vi"] == "to"
    assert (g["kho_rong"], g["kho_dai"]) == (430, 650)


def test_engine_hai_loai_giay_hai_buoc_tinh_doc_lap():
    a = _gy(1, "Ivory 300", gsm=300, don_gia=20000, dv="kg")
    b = _gy(2, "Carton 500", gsm=500, don_gia=10000, dv="kg")
    res = compute_phieu(so_luong=5000, thanh_phans=[_tp_e(
        _buoc_e("In", "to", "to", nhom="print", hao=150, vat_tus=[a]),
        _buoc_e("Bồi", "to", "to", hao=50, vat_tus=[b]))])
    m = res["meta"]["components"][0]
    vao_boi = next(x["vao"] for x in m["bu_hao_chi_tiet"] if x["ten"] == "Bồi")
    ga, gb = _dong_giay(res)
    assert ga["thanh_tien"] == round(0.3 * 0.86 * 0.65 * 20000 * m["to_nguyen"], 2)
    assert gb["thanh_tien"] == round(0.5 * 0.86 * 0.65 * 10000 * ceil(vao_boi / 2), 2)
    # Tiền theo công thức giá kg của mã; LƯỢNG theo đầu vào của bước (Bồi nhận tờ in ⇒ tờ).
    assert gb["dinh_muc"] == vao_boi and gb["dinh_muc_don_vi"] == "to" and gb["buoc_idx"] == 1


def test_engine_giay_o_buoc_vao_cai_tinh_kg_theo_kho_cai():
    """Bước nhận cái: kg = định lượng × khổ thành phẩm × SL vào; tiền = kg × đơn giá kg."""
    g = _gy(1, "Ivory 300", gsm=300, don_gia=20000, dv="kg")
    res = compute_phieu(so_luong=5000, thanh_phans=[_tp_e(
        _buoc_e("In", "to", "to", nhom="print"), _buoc_e("Bế", "to", "cai"),
        _buoc_e("Đóng gói", "cai", "cai", vat_tus=[g]))])
    (d,) = _dong_giay(res)
    vao = next(x["vao"] for x in res["meta"]["components"][0]["bu_hao_chi_tiet"] if x["ten"] == "Đóng gói")
    kg = 0.3 * 0.09 * 0.054 * vao
    assert d["dinh_muc_don_vi"] == "kg" and d["dinh_muc"] == round(kg, 4)
    assert d["thanh_tien"] == round(kg * 20000, 2)
    assert (d["kho_rong"], d["kho_dai"]) == (54, 90)


def test_engine_giay_o_buoc_dau_vao_trong_tinh_kg_theo_buoc_ke_tiep():
    """Cắt cuộn ("—") → In: SL ra của Cắt cuộn = tờ in In nhận ⇒ kg theo khổ tờ in, không hiện khổ."""
    g = _gy(1, "Ivory 300", gsm=300, don_gia=20000, dv="kg")
    res = compute_phieu(so_luong=5000, thanh_phans=[_tp_e(
        _buoc_e("Cắt cuộn", None, None, vat_tus=[g]),
        _buoc_e("In", "to", "to", nhom="print", hao=150))])
    (d,) = _dong_giay(res)
    to_in = res["meta"]["components"][0]["to_dau_vao"]
    kg = 0.3 * 0.65 * 0.43 * to_in
    assert d["dinh_muc_don_vi"] == "kg" and d["dinh_muc"] == round(kg, 4)
    assert d["thanh_tien"] == round(kg * 20000, 2)
    assert (d["kho_rong"], d["kho_dai"]) == (0, 0)
    assert "sl_ra" in d["dinh_muc_cong_thuc_goc"]


def test_engine_chuoi_khong_giay_thi_khong_dong_giay_va_nhac():
    res = compute_phieu(so_luong=5000, thanh_phans=[_tp_e(_buoc_e("In", "to", "to", nhom="print"))])
    assert _dong_giay(res) == []
    assert any("chưa chọn giấy" in w for w in res["warnings"])


def test_engine_dict_cu_khong_buoc_van_tinh_giay_cap_san_pham():
    res = compute_phieu(so_luong=5000, thanh_phans=[_tp_e(
        don_gia_giay=5000, don_gia_don_vi="to", giay_ten="Couche 300")])
    (g,) = _dong_giay(res)
    assert g["thanh_tien"] > 0
