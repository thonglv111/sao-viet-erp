""""Tạo và ghi sổ" trong kỳ kho đã khoá không được để lại phiếu nháp (lỗi #45 bấm thử 18/10/2026).

FE gọi hai lượt: tạo nháp rồi ghi sổ. Lượt ghi sổ bị khoá kỳ chặn nhưng PNK00091 đã nằm lại "Chờ
ghi sổ" và yêu cầu kẹt "Đang chuẩn bị" — người dùng tưởng chưa có gì, bấm lại đẻ thêm phiếu.
Lập NHÁP thuần (không ghi sổ ngay) vẫn được trong kỳ khoá như trước — đó là thiết kế cũ.
"""
from __future__ import annotations

from datetime import date

from app.db import SessionLocal
from app.models.kho_khoa_so import KhoKhoaSo
from app.models.stock_voucher import StockVoucher
from tests.test_kho_de_nghi import _approved_request, _login, _setup


def _khoa_hom_nay(kho_id: int) -> None:
    db = SessionLocal()
    try:
        db.add(KhoKhoaSo(kho_id=kho_id, tu_ngay=date.today(), den_ngay=date.today(),
                         hanh_dong="khoa", nguoi_khoa_id=1))
        db.commit()
    finally:
        db.close()


def _so_phieu(request_id: int) -> int:
    db = SessionLocal()
    try:
        return db.query(StockVoucher).filter(StockVoucher.request_id == request_id).count()
    finally:
        db.close()


def _than(req, kho_id, **them):
    return {"request_id": req["id"], "kho_id": kho_id,
            "lines": [{"request_line_id": req["lines"][0]["id"], "so_luong": 10}], **them}


def test_tao_de_ghi_so_trong_ky_khoa_bi_chan_va_khong_de_nhap(client):
    kho_id, mat_id = _setup(client)
    req = _approved_request(client, kho_id=kho_id, loai="NHAP", mat_id=mat_id, qty=10, gia=1_000)
    _khoa_hom_nay(kho_id)
    tk = _login(client, "t_thukho")
    r = client.post("/api/kho/phieu", headers=tk, json=_than(req, kho_id, ghi_so=True))
    assert r.status_code == 400, r.text
    assert "khóa sổ" in r.json()["detail"]
    assert _so_phieu(req["id"]) == 0


def test_lap_nhap_thuan_trong_ky_khoa_van_duoc(client):
    kho_id, mat_id = _setup(client)
    req = _approved_request(client, kho_id=kho_id, loai="NHAP", mat_id=mat_id, qty=10, gia=1_000)
    _khoa_hom_nay(kho_id)
    tk = _login(client, "t_thukho")
    r = client.post("/api/kho/phieu", headers=tk, json=_than(req, kho_id))
    assert r.status_code == 201, r.text
