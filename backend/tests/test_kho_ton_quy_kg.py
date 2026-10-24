"""Màn Tồn kho: giấy tờ hiện số tờ + "Quy kg" + "Định lượng" (spec 2026-10-24-chuan-bi-giay §6).

Quy kg = số tờ × khổ × gsm của danh mục; cuộn (khổ một cạnh) đã đếm kg nên ô Quy kg trống. Định lượng
chỉ có ở giấy. Lô tạo thẳng vào DB — bài test nói về phần hiển thị, không về phiếu.
"""
from __future__ import annotations

from datetime import date

import pytest

from app.db import SessionLocal
from app.models.stock_lot import StockLot
from app.models.vat_lieu_kho import GiayNguyen
from tests.test_kho_de_nghi import _login, _mk_material, _setup

URL = "/api/kho/phieu/lo/ton-nhom"


def _giay(gsm: int) -> tuple[str, int]:
    db = SessionLocal()
    try:
        g = GiayNguyen(don_vi_them=["to"], ma=f"DL-{gsm}", ten=f"Duplex {gsm}", gsm=gsm, don_vi_gia="kg")
        db.add(g)
        db.commit()
        return ("giay", g.id)
    finally:
        db.close()


def _lo(kho_id, hang, *, con, goc, kr=0, kd=0) -> None:
    db = SessionLocal()
    try:
        so = db.query(StockLot).count()
        db.add(StockLot(
            ma_lo=f"LOT-QK-{hang[1]}-{so}", hang_loai=hang[0], hang_id=hang[1], kho_id=kho_id,
            ngay_nhap=date.today(), sl_ban_dau=con, sl_con_lai=con,
            don_gia_nhap=1000, trang_thai="available", don_vi_goc=goc, kho_rong=kr, kho_dai=kd))
        db.commit()
    finally:
        db.close()


def _trang(client, kho_id) -> dict:
    r = client.get(URL, headers=_login(client, "t_thukho"), params={"kho_id": kho_id})
    assert r.status_code == 200, r.text
    return r.json()


def test_ton_nhom_giay_to_co_quy_kg_va_dinh_luong(client):
    kho_id, _ = _setup(client)
    g = _giay(350)
    _lo(kho_id, g, con=1530, goc="to", kr=650, kd=860)
    body = _trang(client, kho_id)
    (n,) = body["nhom"]
    assert n["dinh_luong"] == 350 and n["quy_kg"] == pytest.approx(299.34, abs=0.005)
    (lo,) = body["items"]
    assert lo["dinh_luong"] == 350 and lo["quy_kg"] == pytest.approx(299.34, abs=0.005)


def test_cuon_khong_quy_kg(client):
    kho_id, _ = _setup(client)
    g = _giay(250)
    _lo(kho_id, g, con=300, goc="kg", kr=860)
    body = _trang(client, kho_id)
    (n,) = body["nhom"]
    assert n["quy_kg"] is None and n["dinh_luong"] == 250
    assert body["items"][0]["quy_kg"] is None and body["items"][0]["dinh_luong"] == 250


def test_vat_tu_khong_co_dinh_luong(client):
    kho_id, _ = _setup(client)
    m = _mk_material("QK-VT")
    _lo(kho_id, m, con=10, goc="")
    body = _trang(client, kho_id)
    (n,) = body["nhom"]
    assert n["dinh_luong"] is None and n["quy_kg"] is None
    assert body["items"][0]["dinh_luong"] is None
