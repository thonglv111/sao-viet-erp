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
    # Ảnh chụp rỗng giữ rỗng (không lấy công thức mới 2.000), mà rỗng thì 0 đồng (chủ 22/10).
    kq = KhoanKyService(db).tinh(NAM, THANG, _muc((e, 5_000_000)))
    assert e.id not in kq["khoan"] and not kq["thieu_gia"]


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
    # Nhãn là câu, không nối tên với mục bằng dấu "·" (chủ chốt 21/10/2026).
    assert doi[0]["nhan"] == f"Công thức của {k.cong_doan.ten}"

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


def test_mg_0434_chep_cong_thuc_tuong_minh_vao_o_trong():
    """Ô công thức trống nay ra 0 ⇒ mg 0434 chép `gia_co_dinh + sl_ghi * don_gia_khoan` vào công đoạn
    và ảnh chụp '' để tiền giữ nguyên; ảnh chụp NULL (lần ghi cũ đọc công thức công đoạn) và công
    thức đã khai không đụng. Chạy hai lần không đổi gì thêm."""
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session

    from app.db_migrations import _migrate_cong_thuc_khoan_tuong_minh

    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as cn:
        cn.execute(text("CREATE TABLE cong_doan_khoan (id INTEGER PRIMARY KEY, cong_thuc_khoan TEXT)"))
        cn.execute(text("CREATE TABLE san_xuat_batch (id INTEGER PRIMARY KEY, khoan_cong_doan_id INTEGER, "
                        "cong_thuc_khoan_snapshot TEXT)"))
        cn.execute(text("INSERT INTO cong_doan_khoan VALUES (1, NULL), (2, '  '), (3, 'sl_ghi * don_gia_khoan')"))
        cn.execute(text("INSERT INTO san_xuat_batch VALUES (1, 1, ''), (2, 1, NULL), (3, 3, 'x'), (4, NULL, '')"))
    for _ in range(2):
        with Session(engine) as db:
            _migrate_cong_thuc_khoan_tuong_minh(db)
    ct = "gia_co_dinh + sl_ghi * don_gia_khoan"
    with engine.begin() as cn:
        assert [r[0] for r in cn.execute(text("SELECT cong_thuc_khoan FROM cong_doan_khoan ORDER BY id"))] == [
            ct, ct, "sl_ghi * don_gia_khoan"]
        assert [r[0] for r in cn.execute(text("SELECT cong_thuc_khoan_snapshot FROM san_xuat_batch ORDER BY id"))] == [
            ct, None, "x", ""]


def test_bang_danh_muc_doi_nhan_cach_tinh_gia_viec_phat_sinh_va_cap_nhat_lay_moi(db, admin):
    """Cách tính giá của việc phát sinh (24/10/2026) chụp vào lần ghi như công thức khoán: sửa ở danh
    mục thì băng báo, bấm "Cập nhật theo danh mục" thì lần ghi lấy cách tính mới."""
    from app.models.cong_doan import CongDoanKhoanPhatSinh
    from app.repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository

    n = _Nen2(db)
    to = _to_khoan(db, admin, ma="TO-CT5")
    e = n.nv(to, "E")
    k = n.khoan2("gia_co_dinh", gia_co_dinh=180_000)
    k.viec_phat_sinh.append(CongDoanKhoanPhatSinh(ten="Xuống bài", don_gia=90_000, don_vi="bai",
                                                  thu_tu=0))
    db.flush()
    b = n.ghi2(to, k, NGAY, 0, [e], phat_sinh={"Xuống bài": 1})
    db.commit()
    sl = SanXuatSanLuongRepository(db)

    def doi_ps():
        return [o for o in viec_khoan.danh_muc_doi(db, b, sl.phat_sinh_cua_batch(b.id), department_id=to.id)
                if o["truong"] == "cong_thuc" and "Xuống bài" in o["nhan"]]

    assert doi_ps() == []
    k.viec_phat_sinh[0].cong_thuc = "0.5 * gia_co_dinh"
    k.viec_phat_sinh[0].don_gia = 0
    db.commit()
    doi = doi_ps()
    assert len(doi) == 1 and doi[0]["nhan"] == "Cách tính giá của Xuống bài"
    assert doi[0]["moi"] == "0.5 * gia_co_dinh"

    # Lần ghi trước khi có cột (NULL) vốn tính bằng cách tính hiện tại ⇒ không báo lệch giả.
    r = sl.phat_sinh_cua_batch(b.id)[0]
    r.cong_thuc_snapshot = None
    assert doi_ps() == []
    r.cong_thuc_snapshot = ""
    db.commit()

    viec_khoan.cap_nhat_theo_danh_muc(db, user=admin, batch_id=b.id)
    r = sl.phat_sinh_cua_batch(b.id)[0]
    db.refresh(r)
    assert r.cong_thuc_snapshot == "0.5 * gia_co_dinh"
    assert viec_khoan.danh_muc_doi(db, b, sl.phat_sinh_cua_batch(b.id), department_id=to.id) == []
    assert _tien(db, e) == [270_000]
