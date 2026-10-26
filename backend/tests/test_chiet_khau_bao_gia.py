"""Giá bán = giá vốn + tiền chiết khấu + tiền lợi nhuận (chủ chốt 18/10/2026).

Chiết khấu % tính trên GIÁ BÁN TRƯỚC KÊ (chủ chốt 23/10/2026, theo sổ DS BÁN RA T8 cột T
`=(O−Q)*N*R`); lợi nhuận % tính trên (giá vốn + chiết khấu). Cả hai gõ được bằng số tiền. Chiết khấu
CỘNG vào giá bán (khách trả đủ, khoản này hoàn lại sau)."""
from types import SimpleNamespace

import pytest

from app.services.quotation_service import QuotationService, QuotationValidationError

tinh = QuotationService.calculate_pricing


def test_theo_phan_tram():
    p = tinh(total_cost=11_985_790, margin_percent=20, discount_percent=5, vat_percent=10, quantity=1000)
    assert p["selling_price"] == 15_301_009
    assert p["discount_amount"] == 765_050                       # 5% × giá bán trước kê
    assert p["profit_amount"] == 2_550_169                       # phần còn lại ≈ 20% × (vốn + CK)
    assert p["subtotal"] == p["selling_price"]                   # không còn khoản trừ
    assert round(p["vat_amount"]) == round(15_301_009 * 0.1)
    assert p["margin_percent"] == 20.0


def test_vi_du_100tr():
    p = tinh(total_cost=100_000_000, margin_percent=20, discount_percent=3)
    assert (p["selling_price"], p["discount_amount"], p["profit_amount"]) == (
        124_481_328, 3_734_440, 20_746_888)


def test_khop_so_T08_dong_706_KI_WORKS():
    """Sổ: (3.780 − 1.000) × 13.190 × 3% = 1.100.046 — giá bán trước kê 36.668.200."""
    p = tinh(total_cost=30_000_000, margin_percent=0, discount_percent=3, manual_selling_price=36_668_200)
    assert p["discount_amount"] == 1_100_046


def test_khop_so_T08_dong_718_Powertech():
    p = tinh(total_cost=10_000_000, margin_percent=0, discount_percent=5, manual_selling_price=16_848_000)
    assert p["discount_amount"] == 842_400


def test_gom_so_tien_chiet_khau_va_loi_nhuan():
    p = tinh(total_cost=1_000_000, margin_percent=0, discount_amount=100_000, profit_amount=250_000)
    assert p["discount_amount"] == 100_000
    assert p["selling_price"] == 1_350_000
    assert p["margin_percent"] == round(250_000 / 1_100_000 * 100, 2)


def test_ck_pct_va_so_tien_loi_nhuan():
    p = tinh(total_cost=1_000_000, margin_percent=0, discount_percent=10, profit_amount=250_000)
    assert (p["selling_price"], p["discount_amount"], p["profit_amount"]) == (1_388_889, 138_889, 250_000)


def test_so_tien_chiet_khau_thang_phan_tram():
    p = tinh(total_cost=1_000_000, margin_percent=10, discount_amount=50_000, discount_percent=99)
    assert p["discount_amount"] == 50_000


def test_gia_go_tay_ck_tren_gia_go():
    p = tinh(total_cost=1_000_000, margin_percent=20, discount_percent=10, manual_selling_price=1_500_000)
    assert p["discount_amount"] == 150_000
    assert p["selling_price"] == 1_500_000
    assert p["profit_amount"] == 350_000
    assert p["margin_percent"] == round(350_000 / 1_150_000 * 100, 2)


def test_lam_tron_thi_ck_tinh_tren_gia_da_tron():
    p = tinh(total_cost=100_000_000, margin_percent=20, discount_percent=3, rounding="round_up_1000")
    assert p["selling_price"] == 124_482_000
    assert p["discount_amount"] == round(124_482_000 * 0.03)


def test_chan_ck_qua_lon():
    with pytest.raises(QuotationValidationError):
        tinh(total_cost=100, margin_percent=100, discount_percent=50)


def test_khong_chiet_khau_giong_markup_cu():
    p = tinh(total_cost=100, margin_percent=20)
    assert p["selling_price"] == 120 and p["discount_amount"] == 0


def test_tinh_lai_khi_doi_gia_von_giu_pct_tren_gia_ban():
    """`_gia_dong` suy % từ tiền CK ÷ GIÁ BÁN cũ. Giá gõ tay giữ nguyên khi vốn đổi ⇒ CK vẫn đúng 3%
    của giá đó (suy theo vốn thì CK phình theo vốn mới)."""
    it = SimpleNamespace(selling_price=124_481_328, total_cost_snapshot=100_000_000,
                         discount_amount=3_734_440, margin_percent=20, gia_go_tay=True,
                         vat_percent=0, ke_gia=0, quantity=1)
    svc = SimpleNamespace(calculate_pricing=QuotationService.calculate_pricing)
    QuotationService._gia_dong(svc, it, cost=110_000_000, qty=1)
    assert it.selling_price == 124_481_328
    assert it.discount_amount == 3_734_440


def test_gia_dong_ck_so_tien_giu_nguyen_khi_doi_von():
    """Chiết khấu GÕ SỐ TIỀN (`discount_percent = 0`) giữ nguyên số tiền khi vốn đổi — không suy ra %."""
    it = SimpleNamespace(selling_price=12_500_000, total_cost_snapshot=10_000_000, discount_amount=500_000,
                         discount_percent=0, margin_percent=20, gia_go_tay=False,
                         vat_percent=0, ke_gia=0, quantity=1)
    svc = SimpleNamespace(calculate_pricing=QuotationService.calculate_pricing)
    QuotationService._gia_dong(svc, it, cost=20_000_000, qty=1)
    assert it.discount_amount == 500_000
    assert it.selling_price == 24_600_000          # (20tr + 0,5tr) × 1,2


# --- Lưu % chiết khấu ở dòng báo giá (23/10/2026) ---------------------------------------------------
# Spec: "Giá gõ tay ⇒ CK = %CK × giá gõ. Số tiền CK gõ thẳng giữ nguyên." Dòng phải nhớ người soạn gõ %
# hay số tiền, không thì lưu 3% xong là thành số tiền cứng, gõ tay giá bán CK không chạy theo.

def _put(client, t, qid, item):
    from tests.test_quotation_approval import _h
    r = client.put(f"/api/quotations/{qid}", json={"items": [item]}, headers=_h(t))
    assert r.status_code == 200, r.text
    return client.get(f"/api/quotations/{qid}", headers=_h(t)).json()["items"][0]


def _bao_gia(client):
    from tests.test_quotation_approval import _h, _seed_ptg, _token
    t = _token(client)
    pid = _seed_ptg(gia_von_tp=10_000_000)
    q = client.post("/api/quotations", json={"phieu_tinh_gia_id": pid}, headers=_h(t)).json()
    return t, q["id"], q["items"][0]["id"]


def test_LUU_pct_ck_roi_go_tay_gia_ban_ck_theo_gia_go(client):
    t, qid, iid = _bao_gia(client)
    it = _put(client, t, qid, {"id": iid, "margin_percent": 20, "discount_percent": 3})
    assert it["discount_percent"] == 3
    assert (round(it["selling_price"]), round(it["discount_amount"])) == (12_448_133, 373_444)
    # Màn gửi lại % đã lưu kèm giá gõ tay ⇒ CK = 3% × giá gõ.
    it = _put(client, t, qid, {"id": iid, "margin_percent": 20, "manual_selling_price": 15_000_000,
                               "discount_percent": it["discount_percent"], "discount_amount": 0})
    assert (round(it["selling_price"]), round(it["discount_amount"]), it["discount_percent"]) == (
        15_000_000, 450_000, 3)


def test_LUU_ck_so_tien_thi_pct_ve_0(client):
    t, qid, iid = _bao_gia(client)
    _put(client, t, qid, {"id": iid, "margin_percent": 20, "discount_percent": 3})
    it = _put(client, t, qid, {"id": iid, "margin_percent": 20, "discount_amount": 500_000})
    assert it["discount_percent"] == 0 and round(it["discount_amount"]) == 500_000


def test_RAO_ck_khach_tinh_tren_gia_ban(client):
    """Rào chiết khấu của khách cùng gốc với ô CK — % trên GIÁ BÁN trước kê. Sale gõ đúng trần 3%
    không bị bắt trình duyệt (gốc giá vốn ra 3,73% ⇒ đặc thù oan); 4% thì vẫn vượt."""
    from tests.test_quotation_approval import _h, _quote, _token
    t = _token(client)
    cid = client.post("/api/customers", json={"name": "KH Rào CK"}, headers=_h(t)).json()["customer"]["id"]
    r = client.put(f"/api/customers/{cid}/financial", headers=_h(t),
                   json={"credit_limit": 0, "discount_min_pct": 0, "discount_max_pct": 3})
    assert r.status_code == 200, r.text
    q = _quote(client, t, customer_id=cid, markup=20)
    iid = q["items"][0]["id"]
    r = client.put(f"/api/quotations/{q['id']}", headers=_h(t),
                   json={"items": [{"id": iid, "margin_percent": 20, "discount_percent": 3}]})
    assert r.status_code == 200, r.text
    d = client.get(f"/api/quotations/{q['id']}", headers=_h(t)).json()
    assert "discount_out" not in {e["key"] for e in d["exceptions"]}
    client.put(f"/api/quotations/{q['id']}", headers=_h(t),
               json={"items": [{"id": iid, "margin_percent": 20, "discount_percent": 4}]})
    d = client.get(f"/api/quotations/{q['id']}", headers=_h(t)).json()
    assert "discount_out" in {e["key"] for e in d["exceptions"]}


def test_dong_cu_NULL_doc_ra_pct_suy_tu_tien(client):
    """Dòng trước mg 0440 (`discount_percent` NULL): API trả % suy từ tiền ÷ giá bán — CÙNG cách
    `_gia_dong` hiểu, để màn và máy chủ không hiểu một dòng theo hai kiểu."""
    from app.db import SessionLocal
    from app.models.quotation import QuoteItem
    from tests.test_quotation_approval import _h
    t, qid, iid = _bao_gia(client)
    _put(client, t, qid, {"id": iid, "margin_percent": 20, "discount_percent": 3})
    db = SessionLocal()
    try:
        db.get(QuoteItem, iid).discount_percent = None
        db.commit()
    finally:
        db.close()
    it = client.get(f"/api/quotations/{qid}", headers=_h(t)).json()["items"][0]
    assert abs(it["discount_percent"] - 3) < 0.001
