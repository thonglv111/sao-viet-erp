""""In phiếu giao" là biên bản giao: số khách THỰC NHẬN, không phải số xuất (lỗi #34 bấm thử 18/10/2026).

Lượt giao thiếu (xuất 1.000, khách nhận 800, trả 200) in 1.000 cái kèm tổng tiền của 1.000; lượt
thất bại (khách không nhận cái nào) vẫn in phiếu bán hàng 500 cái. Khách ký nhận trên phiếu là ký vào
số sai. Dòng "Người mua:" luôn trống.

Luật: chuyến đã có kết quả giao ⇒ số in = số thực nhận từng dòng (`delivery_trip_lines`); chưa có kết
quả (tài xế mang phiếu đi cho khách ký) ⇒ số xuất kho. Chuyến thất bại ⇒ không có phiếu giao để in.
`so_xuat` giữ số kho thực xuất cho mẫu 02-VT (chứng từ kho). "Người mua" = người nhận hàng.
"""
from __future__ import annotations

from tests.test_giao_hang_tra_hang_ve_kho import _admin, _chuyen, _ket_qua, _trip


def _yeu_cau_cua(client, h, trip: int) -> tuple[int, int]:
    _tt, oid = _trip(trip)
    yc = client.get(f"/api/giao-hang/requests?order_id={oid}", headers=h).json()["items"][0]
    return oid, yc["id"]


def _in(client, h, trip: int):
    oid, yc = _yeu_cau_cua(client, h, trip)
    return client.get(f"/api/orders/{oid}/yeu-cau-giao/{yc}/phieu-xuat", headers=h)


def test_giao_thieu_in_so_khach_thuc_nhan(client):
    h = _admin(client)
    trip, lid = _chuyen(client, h, suffix="pg1", qty=1000)
    _ket_qua(client, h, trip, ket_qua="giao_thieu", nguoi_nhan_thuc_te="Chị Hạnh",
             so_thuc_nhan=[{"order_line_id": lid, "qty": 800}])
    r = _in(client, h, trip)
    assert r.status_code == 200, r.text
    dong = {d["order_line_id"]: d for d in r.json()["thuc_xuat"]}
    assert dong[lid]["so_luong"] == 800
    assert dong[lid]["so_xuat"] == 1000
    assert r.json()["nguoi_mua"] == "Chị Hạnh"


def test_chua_co_ket_qua_in_so_xuat_va_nguoi_nhan_cua_yeu_cau(client):
    h = _admin(client)
    trip, lid = _chuyen(client, h, suffix="pg2", qty=300)
    r = _in(client, h, trip)
    assert r.status_code == 200, r.text
    assert {d["order_line_id"]: d["so_luong"] for d in r.json()["thuc_xuat"]}[lid] == 300
    assert r.json()["nguoi_mua"] == "Chi Lan"


def test_chuyen_that_bai_khong_in_duoc(client):
    h = _admin(client)
    trip, _lid = _chuyen(client, h, suffix="pg3", qty=500)
    _ket_qua(client, h, trip, ket_qua="that_bai", ly_do_that_bai="Khách đóng cửa",
             huong_xu_ly="tra_ve")
    r = _in(client, h, trip)
    assert r.status_code == 400
    assert "thất bại" in r.json()["detail"]
