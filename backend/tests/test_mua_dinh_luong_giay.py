"""Mua hàng: dòng giấy mang "Định lượng" CHỈ ĐỌC, đọc từ danh mục (spec 2026-10-24-chuan-bi-giay §6).

Yêu cầu mua, đơn mua, đợt giao đều trả `dinh_luong` = gsm của danh mục cho dòng giấy; vật tư khác
None. Payload gửi kèm `dinh_luong` bị chặn 422 — không ai gõ định lượng ở chứng từ mua.
"""
from __future__ import annotations

from datetime import date, timedelta

from app.db import SessionLocal
from app.models.vat_lieu_kho import GiayNguyen
from tests.test_purchases_api import (  # noqa: F401
    _create_purchase_request, _request_payload, _supplier, auth_headers, token,
)


def _giay(ma: str = "GY-DL", gsm: int = 350) -> int:
    db = SessionLocal()
    try:
        g = GiayNguyen(don_vi_them=["to"], ma=ma, ten=f"Giấy {ma}", gsm=gsm, kho_rong=650, kho_dai=860,
                       don_vi_gia="kg")
        db.add(g)
        db.commit()
        return g.id
    finally:
        db.close()


def _ycmh(client, headers, giay_id: int) -> dict:
    r = client.post("/api/department-purchase-requests", headers=headers, json={
        "source_type": "kinh_doanh", "related_document_type": "sales_order",
        "related_document_code": "DH-DL-1", "purpose": "Giấy cho đơn",
        "needed_date": (date.today() + timedelta(days=30)).isoformat(),
        "lines": [{"item_name": "Giấy GY-DL", "unit": "kg", "quantity": 50,
                   "hang_loai": "giay", "hang_id": giay_id, "kho_rong": 650, "kho_dai": 860}],
    })
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_dong_ycmh_giay_co_dinh_luong_tu_danh_muc(client, auth_headers):
    g = _giay()
    _supplier(client, auth_headers, name="NCC Định lượng", items=[{
        "hang_loai": "giay", "hang_id": g, "item_name": "Giấy GY-DL", "unit": "kg", "unit_price": 22000}])
    src = _ycmh(client, auth_headers, g)
    assert src["lines"][0]["dinh_luong"] == 350
    lai = client.get(f"/api/department-purchase-requests/{src['id']}", headers=auth_headers).json()
    assert lai["lines"][0]["dinh_luong"] == 350


def test_gui_dinh_luong_trong_payload_bi_chan(client, auth_headers):
    """Định lượng không phải ô nhập của chứng từ mua: gửi kèm là sai hợp đồng ⇒ 422 (schema vào cấm khoá
    lạ), không âm thầm ghi đè danh mục."""
    g = _giay("GY-DL2", gsm=300)
    r = client.post("/api/department-purchase-requests", headers=auth_headers, json={
        "source_type": "kinh_doanh", "related_document_type": "sales_order",
        "related_document_code": "DH-DL-2", "purpose": "Giấy cho đơn",
        "needed_date": (date.today() + timedelta(days=30)).isoformat(),
        "lines": [{"item_name": "Giấy GY-DL", "unit": "kg", "quantity": 50, "hang_loai": "giay",
                   "hang_id": g, "dinh_luong": 999}],
    })
    assert r.status_code == 422 and "dinh_luong" in r.text


def test_dong_don_mua_giay_co_dinh_luong(client, auth_headers):
    g = _giay("GY-DL3", gsm=250)
    sup = _supplier(client, auth_headers, name="NCC Định lượng 3", items=[{
        "hang_loai": "giay", "hang_id": g, "item_name": "Giấy GY-DL", "unit": "kg", "unit_price": 22000}])
    src = _ycmh(client, auth_headers, g)
    payload = _request_payload(sup["id"])
    payload["source_request_ids"] = [src["id"]]
    payload["lines"] = [{"item_name": "Giấy GY-DL", "unit": "kg", "quantity": 50,
                         "expected_unit_price": 22000, "department_request_line_id": src["lines"][0]["id"]}]
    pr = client.post("/api/purchase-requests", json=payload, headers=auth_headers)
    assert pr.status_code in (200, 201), pr.text
    lai = client.get(f"/api/purchase-requests/{pr.json()['id']}", headers=auth_headers).json()
    assert lai["lines"][0]["dinh_luong"] == 250


def test_dong_khong_noi_giay_khong_co_dinh_luong(client, auth_headers):
    sup = _supplier(client, auth_headers, name="NCC Định lượng 4")
    pr = _create_purchase_request(client, auth_headers, sup["id"])
    assert [ln["dinh_luong"] for ln in pr["lines"]] == [None] * len(pr["lines"])


def test_luoi_tung_mon_co_dinh_luong(client, auth_headers):
    g = _giay("GY-DL5", gsm=230)
    _supplier(client, auth_headers, name="NCC Định lượng 5", items=[{
        "hang_loai": "giay", "hang_id": g, "item_name": "Giấy GY-DL", "unit": "kg", "unit_price": 22000}])
    src = _ycmh(client, auth_headers, g)
    r = client.get("/api/department-purchase-requests/mon", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    items = body["items"] if isinstance(body, dict) else body
    (mon,) = [m for m in items if m["request_id"] == src["id"]]
    assert mon["dinh_luong"] == 230
