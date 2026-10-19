"""Tổng báo giá: chỉ cộng dòng khách lấy, và khớp đúng đồng với đơn (lỗi #61, #62 bấm lại 19/10/2026).

#61 BG26-0013 v3 chốt 1/2 sản phẩm: khối tổng 6.345.355 nhưng Lịch sử phiên bản và danh sách
    12.810.204 — tổng phiên bản cộng cả dòng khách không lấy.
#62 DH010 42.454.541 mà BG26-0012 42.454.539; DH017 5.453.186 mà BG26-0018 5.453.185. Đơn tính
    ⌊Σ giá bán tròn·(100+VAT)/100⌋; báo giá cộng số thô rồi cắt phần lẻ.
"""
from __future__ import annotations

from types import SimpleNamespace

from app.models.quotation import VERSION_STATUS_ACCEPTED
from app.services.quotation_service import QuotationService


def _dong(selling, vat_pct=10, accepted=False, cost=0):
    return SimpleNamespace(selling_price=selling, vat_percent=vat_pct, accepted=accepted,
                           total_cost_snapshot=cost, discount_amount=0,
                           vat_amount=selling * vat_pct / 100,
                           final_amount=selling * (100 + vat_pct) / 100)


def _ban(items, status="draft"):
    return SimpleNamespace(items=items, status=status)


def test_tong_phien_ban_theo_cong_thuc_cua_don():
    # Đúng 5 dòng của BG26-0012 trên clone.
    v = _ban([_dong(14382947.71), _dong(2956560.52), _dong(8283242.71), _dong(7957476.60),
              _dong(5014808.71)])
    QuotationService._cong_tong(None, v)
    assert v.subtotal_amount == 38_595_038
    assert v.final_amount == 42_454_541          # = tổng DH010
    assert v.vat_amount == 42_454_541 - 38_595_038

    v1 = _ban([_dong(4957441.80)])               # BG26-0018
    QuotationService._cong_tong(None, v1)
    assert v1.final_amount == 5_453_186           # = tổng DH017


def test_chot_mot_phan_chi_cong_dong_khach_lay():
    v = _ban([_dong(5_000_000, accepted=True, cost=4_000_000),
              _dong(7_000_000, accepted=False, cost=6_000_000)], status=VERSION_STATUS_ACCEPTED)
    QuotationService._cong_tong(None, v)
    assert (v.subtotal_amount, v.final_amount, v.total_cost_snapshot) == (5_000_000, 5_500_000, 4_000_000)


def test_chot_truoc_khi_co_co_thi_cong_het():
    v = _ban([_dong(1_000_000), _dong(2_000_000)], status=VERSION_STATUS_ACCEPTED)
    QuotationService._cong_tong(None, v)
    assert v.final_amount == 3_300_000


def test_migration_0422_tinh_lai_tong_phien_ban_cu(client):
    from sqlalchemy import text

    from app.db import SessionLocal
    from app.db_migrations import _migrate_tong_bao_gia_theo_don
    from tests.test_quotation_approval import _h, _seed_ptg, _token

    t = _token(client)
    q = client.post("/api/quotations", json={"phieu_tinh_gia_id": _seed_ptg(gia_von_tp=1_000_000)},
                    headers=_h(t)).json()
    db = SessionLocal()
    try:
        vid = db.execute(text("SELECT id FROM quote_versions WHERE quote_id = :q"), {"q": q["id"]}).scalar()
        db.execute(text("UPDATE quote_items SET selling_price = 4957441.80, vat_percent = 10"
                        " WHERE quote_version_id = :v"), {"v": vid})
        db.execute(text("UPDATE quote_versions SET final_amount = 5453185.98 WHERE id = :v"), {"v": vid})
        db.commit()
        _migrate_tong_bao_gia_theo_don(db)
        _migrate_tong_bao_gia_theo_don(db)
        assert float(db.execute(text("SELECT final_amount FROM quote_versions WHERE id = :v"),
                                {"v": vid}).scalar()) == 5_453_186
    finally:
        db.close()
