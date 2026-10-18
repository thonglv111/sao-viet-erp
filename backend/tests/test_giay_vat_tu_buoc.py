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
