"""mg 0415: ngày chốt công nợ dời từ đơn mua sang nhà cung cấp (16/10/2026).

Hạn các đợt đã ghi phải giữ đúng con số đang hiện trước khi bỏ cột của đơn — kể cả đợt của đơn
KHÔNG chốt, vì NCC vừa nhận ngày chốt backfill từ đơn khác.
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.db_migrations import MIGRATIONS, _migrate_chot_cong_no_theo_ncc


def _db():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as cn:
        cn.execute(text("CREATE TABLE suppliers (id INTEGER PRIMARY KEY, credit_days INTEGER)"))
        cn.execute(text("CREATE TABLE purchase_requests (id INTEGER PRIMARY KEY, "
                        "supplier_id INTEGER, debt_cutoff_day INTEGER)"))
        cn.execute(text("CREATE TABLE purchase_deliveries (id INTEGER PRIMARY KEY, "
                        "purchase_request_id INTEGER, delivery_date DATE, invoice_date DATE, "
                        "due_date DATE)"))
        cn.execute(text("INSERT INTO suppliers VALUES (1, 30), (2, NULL)"))
        # NCC 1: đơn 10 chốt 30, đơn 11 chốt cuối tháng (mới nhất), đơn 12 không chốt.
        cn.execute(text("INSERT INTO purchase_requests VALUES "
                        "(10, 1, 30), (11, 1, 31), (12, 1, NULL), (20, 2, 31)"))
        cn.execute(text(
            "INSERT INTO purchase_deliveries VALUES "
            "(1, 11, '2026-08-05', '2026-08-05', NULL),"
            "(2, 12, '2026-08-05', NULL, NULL),"
            "(3, 12, '2026-08-06', NULL, '2026-09-20'),"
            "(4, 20, '2026-08-05', '2026-08-05', NULL)"))
    return engine


def _chay(engine):
    with Session(engine) as db:
        _migrate_chot_cong_no_theo_ncc(db)


def _lay(engine):
    with engine.begin() as cn:
        han = dict(cn.execute(text("SELECT id, due_date FROM purchase_deliveries")).all())
        ncc = dict(cn.execute(text("SELECT id, debt_cutoff_day FROM suppliers")).all())
        cot = [r[1] for r in cn.execute(text("PRAGMA table_info(purchase_requests)")).all()]
    return {k: str(v) if v else None for k, v in han.items()}, ncc, cot


def test_mg_0415_chup_han_cu_roi_doi_ngay_chot_sang_ncc():
    engine = _db()
    _chay(engine)
    han, ncc, cot = _lay(engine)
    assert han == {
        1: "2026-09-30",   # chốt cuối tháng + 30
        2: "2026-09-04",   # không chốt, không hoá đơn ⇒ ngày giao + 30, chụp trước khi NCC có chốt
        3: "2026-09-20",   # chỉ có hạn tay ⇒ giữ
        4: None,           # NCC chưa khai số ngày ⇒ vẫn không có hạn
    }
    assert ncc == {1: 31, 2: 31}
    assert "debt_cutoff_day" not in cot


def test_mg_0415_chay_lai_vo_hai():
    engine = _db()
    _chay(engine)
    truoc = _lay(engine)
    _chay(engine)
    assert _lay(engine) == truoc
    assert "0415_chot_cong_no_theo_ncc" in [ten for ten, _ in MIGRATIONS]
