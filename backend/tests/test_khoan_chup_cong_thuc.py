"""Công thức khoán CHỤP vào lần ghi như giá (21/10/2026, mg 0431).

Chủ chốt: "phải snap shot giá công đoạn chứ" — sửa công thức ở danh mục không đổi tiền các lần đã
ghi. Lần ghi cũ chưa có ảnh chụp (NULL) dùng công thức hiện tại của công đoạn. Băng "Danh mục đã
đổi" nhận ra công thức khác, nút "Cập nhật theo danh mục" lấy công thức mới."""
from __future__ import annotations

from datetime import date

from app.services.khoan_ky import KhoanKyService
from app.services.san_xuat import viec_khoan
from tests.test_khoan_dot_2_tinh import _Nen2, _muc, _tc
from tests.test_khoan_ky import NAM, THANG
from tests.test_san_xuat_thuc_thi import _to_khoan, admin, db  # noqa: F401

NGAY = date(NAM, THANG, 5)


def _tien(db, e) -> list[float]:
    kq = KhoanKyService(db).tinh(NAM, THANG, _muc((e, 5_000_000)))
    return [d["tien_lan_ghi"] for d in kq["theo_nguoi"][e.id] if d["loai"] == "lan_ghi"]


def test_doi_cong_thuc_khong_doi_tien_lan_da_ghi(db, admin):
    n = _Nen2(db)
    to = _to_khoan(db, admin, ma="TO-CT1")
    e = n.nv(to, "E")
    k = n.khoan2("sl_ghi * don_gia_khoan", don_gia=10)
    b1 = n.ghi2(to, k, NGAY, 100, [e])
    assert b1.cong_thuc_khoan_snapshot == "sl_ghi * don_gia_khoan"
    k.cong_thuc_khoan = "sl_ghi * don_gia_khoan * 2"
    db.flush()
    b2 = n.ghi2(to, k, NGAY, 100, [e])
    assert b2.cong_thuc_khoan_snapshot == "sl_ghi * don_gia_khoan * 2"
    assert _tien(db, e) == [1_000, 2_000]


def test_lan_ghi_cu_chua_chup_dung_cong_thuc_hien_tai(db, admin):
    n = _Nen2(db)
    to = _to_khoan(db, admin, ma="TO-CT2")
    e = n.nv(to, "E")
    k = n.khoan2("sl_ghi * don_gia_khoan", don_gia=10)
    b = n.ghi2(to, k, NGAY, 100, [e])
    b.cong_thuc_khoan_snapshot = None
    k.cong_thuc_khoan = "sl_ghi * don_gia_khoan * 3"
    db.flush()
    assert _tien(db, e) == [3_000]


def test_cong_thuc_rong_chup_chuoi_rong_khong_phai_null(db, admin):
    n = _Nen2(db)
    to = _to_khoan(db, admin, ma="TO-CT3")
    e = n.nv(to, "E")
    k = n.khoan2("", gia_co_dinh=500, don_gia=10)
    b = n.ghi2(to, k, NGAY, 100, [e])
    assert b.cong_thuc_khoan_snapshot == ""
    k.cong_thuc_khoan = "sl_ghi * don_gia_khoan * 2"
    db.flush()
    assert _tien(db, e) == [1_500]


def test_bang_danh_muc_doi_nhan_cong_thuc_va_cap_nhat_lay_cong_thuc_moi(db, admin):
    n = _Nen2(db)
    to = _to_khoan(db, admin, ma="TO-CT4")
    e = n.nv(to, "E")
    k = n.khoan2("sl_ghi * don_gia_khoan", don_gia=10,
                 tuy_chon=_tc(("xa_doi", "Xả đôi", "co_khong")))
    b = n.ghi2(to, k, NGAY, 100, [e], tuy_chon={"xa_doi": 1})
    db.commit()

    def doi_ct():
        return [o for o in viec_khoan.danh_muc_doi(db, b, [], department_id=to.id) if o["truong"] == "cong_thuc"]

    assert doi_ct() == []

    k.cong_thuc_khoan = "sl_ghi * don_gia_khoan * (1 + xa_doi + so_lo)"
    k.tuy_chon = _tc(("xa_doi", "Xả đôi", "co_khong"), ("so_lo", "Số lỗ", "so"))
    db.commit()
    doi = doi_ct()
    assert len(doi) == 1
    assert doi[0]["cu"] == "sl_ghi * don_gia_khoan"

    # Lần ghi cũ chưa chụp công thức thì không báo lệch giả (nó vốn dùng công thức hiện tại).
    b.cong_thuc_khoan_snapshot = None
    assert doi_ct() == []
    b.cong_thuc_khoan_snapshot = "sl_ghi * don_gia_khoan"
    db.commit()

    viec_khoan.cap_nhat_theo_danh_muc(db, user=admin, batch_id=b.id)
    db.refresh(b)
    assert b.cong_thuc_khoan_snapshot == "sl_ghi * don_gia_khoan * (1 + xa_doi + so_lo)"
    # Bộ tuỳ chọn theo khai mới: giữ giá trị đã chọn, tuỳ chọn mới = 0.
    assert [(t["ma"], t["gia_tri"]) for t in b.tuy_chon_khoan] == [("xa_doi", 1.0), ("so_lo", 0.0)]
    assert viec_khoan.danh_muc_doi(db, b, [], department_id=to.id) == []
    assert _tien(db, e) == [2_000]


def test_mg_0431_them_cot_lan_ghi_cu_de_null():
    from sqlalchemy import create_engine, inspect, text
    from sqlalchemy.orm import Session

    from app.db_migrations import _migrate_chup_cong_thuc_khoan

    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as cn:
        cn.execute(text("CREATE TABLE san_xuat_batch (id INTEGER PRIMARY KEY, tong NUMERIC)"))
        cn.execute(text("INSERT INTO san_xuat_batch (tong) VALUES (100)"))
    for _ in range(2):          # chạy lần hai không lỗi
        with Session(engine) as s:
            _migrate_chup_cong_thuc_khoan(s)
    assert "cong_thuc_khoan_snapshot" in {c["name"] for c in inspect(engine).get_columns("san_xuat_batch")}
    with engine.begin() as cn:
        assert cn.execute(text("SELECT cong_thuc_khoan_snapshot FROM san_xuat_batch")).scalar() is None
