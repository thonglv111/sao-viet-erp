"""`so_mau` "Số màu in" = số kẽm một tay, đổi theo quy cách in (16/10/2026).

Ca người dùng: mặt A CMYK + Reflex Blue, mặt B y hệt ⇒ 1 mặt 5 · AB 10 · tự trở/trở nhíp 5.
Cách đếm cũ (A + B + màu pha phân biệt = 9) sang `so_mau_phu`, mg 0414 chuyển công thức mực/giờ
máy/bình bài sang tên mới để số của chúng không đổi.
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.db_migrations import MIGRATIONS, _migrate_so_mau_phu
from app.services.bien_cong_thuc import ngu_canh_lenh
from app.services.thanh_phan_engine import dem_mau_cong_thuc

A = ["C", "M", "Y", "K", "Reflex Blue"]


def test_so_mau_bang_so_kem_theo_quy_cach_in():
    assert dem_mau_cong_thuc(A, A, "mot_mat") == (5, 1, 9)
    assert dem_mau_cong_thuc(A, A, "ab") == (10, 2, 9)
    assert dem_mau_cong_thuc(A, A, "tu_tro") == (5, 1, 9)
    assert dem_mau_cong_thuc(A, A, "tro_nhip") == (5, 1, 9)


def test_hai_mat_khac_mau_pha():
    b = ["K", "185C"]
    # AB: 5 + 2 kẽm; tự trở hợp hai mặt: CMYK + Reflex Blue + 185C = 6 kẽm, 2 kẽm pha.
    assert dem_mau_cong_thuc(A, b, "ab") == (7, 2, 7)
    assert dem_mau_cong_thuc(A, b, "tu_tro") == (6, 2, 7)


def test_tang_lenh_dem_cung_luat_voi_phieu():
    qc = {"muc_a": A, "muc_b": A}
    for cach, mau in (("ab", 10), ("tu_tro", 5), ("mot_mat", 5)):
        ctx = ngu_canh_lenh({**qc, "quy_cach_in": cach})
        assert (ctx["so_mau"], ctx["so_mau_phu"]) == (mau, 9)


def test_tang_lenh_anh_chup_cu_chi_co_so_mau():
    ctx = ngu_canh_lenh({"so_mau": 4})
    assert (ctx["so_mau"], ctx["so_mau_pha"], ctx["so_mau_phu"]) == (4, 0, 4)


def _db():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as cn:
        cn.execute(text("CREATE TABLE cong_doan_may (id INTEGER PRIMARY KEY, "
                        "cong_thuc_gio TEXT, cong_thuc_gia TEXT)"))
        cn.execute(text("CREATE TABLE vat_tu_in_an (id INTEGER PRIMARY KEY, cong_thuc_gia TEXT)"))
        cn.execute(text(
            "INSERT INTO cong_doan_may (id, cong_thuc_gio, cong_thuc_gia) VALUES "
            "(1, 'if ( so_mau / so_mat <= 4 , sl_vao , sl_vao * 2 )', "
            "    'so_kem * 50000 + (so_mau - so_mau_pha) * 1000'),"
            "(2, 'sl_vao / 8000', 'so_mau_pha * 2000')"))
        cn.execute(text("INSERT INTO vat_tu_in_an (id, cong_thuc_gia) VALUES "
                        "(1, 'so_mau * dai_in * rong_in * 0.0002'), (2, NULL)"))
    return engine


def _chay(engine):
    with Session(engine) as db:
        _migrate_so_mau_phu(db)


def _lay(engine):
    with engine.begin() as cn:
        may = cn.execute(text("SELECT id, cong_thuc_gio, cong_thuc_gia FROM cong_doan_may "
                              "ORDER BY id")).all()
        vt = dict(cn.execute(text("SELECT id, cong_thuc_gia FROM vat_tu_in_an")).all())
    return [tuple(r) for r in may], vt


def test_mg_0414_chuyen_cong_thuc_phu_giay_giu_cong_thuc_tien_in():
    engine = _db()
    _chay(engine)
    may, vt = _lay(engine)
    assert may == [
        (1, "if ( so_mau_phu / so_mat <= 4 , sl_vao , sl_vao * 2 )",
         "so_kem * 50000 + (so_mau - so_mau_pha) * 1000"),
        (2, "sl_vao / 8000", "so_mau_pha * 2000"),
    ]
    assert vt == {1: "so_mau_phu * dai_in * rong_in * 0.0002", 2: None}


def test_mg_0414_chay_lai_vo_hai_va_bo_qua_bang_thieu():
    engine = _db()
    _chay(engine)
    truoc = _lay(engine)
    _chay(engine)
    assert _lay(engine) == truoc
    _chay(create_engine("sqlite+pysqlite:///:memory:"))


def test_mg_0414_da_dang_ky():
    assert ("0414_so_mau_phu", _migrate_so_mau_phu) in MIGRATIONS
