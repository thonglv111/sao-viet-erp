"""Lưu đợt giao = tạo luôn yêu cầu NHẬP kho của đợt (20/10/2026).

Trước đây ghi đợt xong phải bấm "Gửi kho" ở đợt, sang màn Kho bấm gửi lần nữa. Nay một lần Lưu là
đủ; sửa đợt kéo yêu cầu theo, xoá đợt huỷ yêu cầu — tới khi kho lập phiếu thì khoá. Ghi / sửa / xoá
đợt đòi thêm ô Thao tác của Yêu cầu nhập xuất (`kho:request`).
"""
from __future__ import annotations

from datetime import date

from app.db import SessionLocal
from app.models.kho_hang import KhoHang
from app.models.stock_request import REQ_APPROVED, REQ_CANCELLED, StockRequest
from app.models.stock_voucher import StockVoucher

from .test_purchases_api import (  # noqa: F401
    _dot, _pmh_giay_da_mua, _vai_dung_mot_man, auth_headers, token,
)


def _yeu_cau(dot_id: int) -> StockRequest | None:
    db = SessionLocal()
    try:
        req = db.query(StockRequest).filter(StockRequest.purchase_delivery_id == dot_id).first()
        if req is not None:
            _ = list(req.lines)
            db.expunge(req)
        return req
    finally:
        db.close()


def _sua(client, headers, pr_id, dot_id, dong_id, so):
    return client.put(f"/api/purchase-requests/{pr_id}/deliveries/{dot_id}", headers=headers, json={
        "delivery_date": date.today().isoformat(),
        "lines": [{"purchase_request_line_id": dong_id, "quantity": so}]})


def test_luu_dot_la_tao_yeu_cau_nhap(client, auth_headers):
    pr_id, dong_id = _pmh_giay_da_mua(client, auth_headers)
    r = _dot(client, auth_headers, pr_id, dong_id)
    assert r.status_code == 200, r.text
    don = r.json()
    dot = don["deliveries"][-1]
    assert dot["da_nhap_kho"] is True
    assert dot["kho"] == "kho_chua_nhap"
    assert dot["kho_da_lap_phieu"] is False

    req = _yeu_cau(dot["id"])
    assert req is not None and req.loai == "NHAP" and req.trang_thai == REQ_APPROVED
    assert dot["stock_request_ma"] == req.ma
    assert req.ghi_chu == f"Nhập từ đơn mua {don['code']} — đợt {dot['seq_no']}"
    assert req.ngay_can == date.today()
    (ln,) = req.lines
    assert (ln.hang_loai, float(ln.sl_de_nghi), ln.dvt) == ("giay", 40.0, "kg")
    assert (ln.kho_rong, ln.kho_dai) == (790, 1090), "khổ thực nhận (mặc định khổ đặt)"
    assert ln.don_gia == 25000 and float(ln.sl_duyet) == 40.0


def test_sua_dot_thi_yeu_cau_doi_theo_xoa_dot_thi_huy(client, auth_headers):
    pr_id, dong_id = _pmh_giay_da_mua(client, auth_headers)
    dot = _dot(client, auth_headers, pr_id, dong_id).json()["deliveries"][-1]
    ma = _yeu_cau(dot["id"]).ma

    r = _sua(client, auth_headers, pr_id, dot["id"], dong_id, 55)
    assert r.status_code == 200, r.text
    req = _yeu_cau(dot["id"])
    assert req.ma == ma, "sửa tại chỗ, không đẻ yêu cầu mới"
    assert [float(ln.sl_de_nghi) for ln in req.lines] == [55.0]

    r = client.delete(f"/api/purchase-requests/{pr_id}/deliveries/{dot['id']}", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert _yeu_cau(dot["id"]).trang_thai == REQ_CANCELLED


def test_kho_da_lap_phieu_thi_khoa_sua_xoa_dot(client, auth_headers):
    pr_id, dong_id = _pmh_giay_da_mua(client, auth_headers)
    dot = _dot(client, auth_headers, pr_id, dong_id).json()["deliveries"][-1]
    req = _yeu_cau(dot["id"])
    db = SessionLocal()
    try:
        kho = KhoHang(ma="KHO-DOT", ten="Kho đợt giao")
        db.add(kho)
        db.flush()
        db.add(StockVoucher(ma="PN-DOT-1", loai="NHAP", request_id=req.id, kho_id=kho.id,
                            ngay=date.today(), nguoi_lap_id=req.nguoi_tao_id, trang_thai="draft"))
        db.commit()
    finally:
        db.close()

    r = _sua(client, auth_headers, pr_id, dot["id"], dong_id, 55)
    assert r.status_code == 409, r.text
    assert "Kho đã lập phiếu" in r.json()["detail"]
    r = client.delete(f"/api/purchase-requests/{pr_id}/deliveries/{dot['id']}", headers=auth_headers)
    assert r.status_code == 409, r.text

    don = client.get(f"/api/purchase-requests/{pr_id}", headers=auth_headers).json()
    dot = next(d for d in don["deliveries"] if d["id"] == dot["id"])
    assert dot["kho_da_lap_phieu"] is True
    assert [float(ln["quantity"]) for ln in dot["lines"]] == [40.0], "đợt giữ nguyên số cũ"


def test_thieu_o_yeu_cau_nhap_xuat_thi_khong_ghi_duoc_dot(client, auth_headers):
    pr_id, dong_id = _pmh_giay_da_mua(client, auth_headers)
    h = {"Authorization": "Bearer " + _vai_dung_mot_man(
        "thu_mua", "mua_khong_kho", can_read=True, can_create=True, can_update=True)}
    r = _dot(client, h, pr_id, dong_id)
    assert r.status_code == 403, r.text
