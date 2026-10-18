"""Giấy là vật tư của BƯỚC (18/10/2026, plan docs/superpowers/plans/2026-10-18-giay-la-vat-tu-cua-buoc.md).

Phiếu tính giá thôi chọn giấy ở mục "Giấy nguyên": giấy thêm vào công đoạn qua ô "Thêm vật tư"
(`phieu_buoc_vat_tu.hang_loai = 'giay'`), `phieu_thanh_phan.giay_id` thành giấy chính dẫn xuất.
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.db_migrations import MIGRATIONS


# ============================ Migration 0418 ============================
def _mg(db: Session) -> None:
    dict(MIGRATIONS)["0418_phieu_buoc_vat_tu_hang_loai"](db)


def _db_cu() -> Session:
    """Ba bảng ĐÚNG hình dạng trước 0418 — `phieu_buoc_vat_tu` chưa có `hang_loai`."""
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


def test_mg_0418_chuyen_giay_id_thanh_dong_buoc_in():
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


def test_mg_0418_khong_buoc_in_thi_vao_buoc_dau_khong_buoc_thi_bo_qua():
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
