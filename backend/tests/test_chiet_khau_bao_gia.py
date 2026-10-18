"""Giá bán = giá vốn + tiền chiết khấu + tiền lợi nhuận (chủ chốt 18/10/2026).

Chiết khấu % tính trên giá vốn; lợi nhuận % tính trên (giá vốn + chiết khấu). Cả hai gõ được bằng số
tiền. Chiết khấu CỘNG vào giá bán (khách trả đủ, khoản này hoàn lại sau)."""
from app.services.quotation_service import QuotationService

tinh = QuotationService.calculate_pricing


def test_theo_phan_tram():
    p = tinh(total_cost=11_985_790, margin_percent=20, discount_percent=5, vat_percent=10, quantity=1000)
    assert p["discount_amount"] == 599_290                       # 5% × vốn
    assert p["profit_amount"] == 2_517_016                       # 20% × (vốn + chiết khấu)
    assert p["selling_price"] == 15_102_096                      # vốn + chiết khấu + lợi nhuận
    assert p["subtotal"] == p["selling_price"]                   # không còn khoản trừ
    assert round(p["vat_amount"]) == round(15_102_096 * 0.1)
    assert p["margin_percent"] == 20.0


def test_gom_so_tien_chiet_khau_va_loi_nhuan():
    p = tinh(total_cost=1_000_000, margin_percent=0, discount_amount=100_000, profit_amount=250_000)
    assert p["discount_amount"] == 100_000
    assert p["selling_price"] == 1_350_000
    assert p["margin_percent"] == round(250_000 / 1_100_000 * 100, 2)


def test_so_tien_chiet_khau_thang_phan_tram():
    p = tinh(total_cost=1_000_000, margin_percent=10, discount_amount=50_000, discount_percent=99)
    assert p["discount_amount"] == 50_000


def test_gia_go_tay_giu_chiet_khau_loi_nhuan_la_phan_con_lai():
    p = tinh(total_cost=1_000_000, margin_percent=20, discount_percent=10, manual_selling_price=1_500_000)
    assert p["discount_amount"] == 100_000
    assert p["selling_price"] == 1_500_000
    assert p["profit_amount"] == 400_000
    assert p["margin_percent"] == round(400_000 / 1_100_000 * 100, 2)


def test_khong_chiet_khau_giong_markup_cu():
    p = tinh(total_cost=100, margin_percent=20)
    assert p["selling_price"] == 120 and p["discount_amount"] == 0
