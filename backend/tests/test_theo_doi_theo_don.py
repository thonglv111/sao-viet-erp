"""Theo dõi sản xuất THEO ĐƠN (12/10/2026): một dòng một đơn, ngăn mở bằng bảng mặt hàng.

Phạm vi = luật Đơn hàng bán; trễ đo theo hạn giao khách; đơn chưa có lệnh vẫn có dòng (chặng Lệnh).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.models.lsx import Lsx
from app.models.order import STATUS_ORDERED, Order
from app.models.san_xuat_kcs import KCS_KHONG_DAT, SanXuatKcsBatch
from app.services.delivery_service import DeliveryService
from app.services.lenh_sx import theo_doi_don
from tests.lenh_sx_fixtures import (  # noqa: F401
    _cvs,
    _dot_dong_don,
    _h,
    _phat_hanh_that,
    _tok,
    admin,
    customer,
    lenh_that,
    lsx_svc,
    orders,
    sess,
)


@pytest.fixture(autouse=True)
def _kho_trong(monkeypatch):
    """Nền test xếp lịch có sẵn tồn 1.000.000 của mã thành phẩm ⇒ món nào cũng "đủ hàng" (mg 0394:
    giao được đọc tồn của mã). Ép kho trống để đơn còn đi qua sản xuất."""
    monkeypatch.setattr(DeliveryService, "kha_dung_theo_ma", lambda self, ids: {})


def _don_cua(sess, lsx_id: int) -> Order:
    o = sess.get(Order, sess.get(Lsx, lsx_id).order_id)
    # Đơn của fixture đã chốt; bật mốc giao xưởng để đơn lọt tầng 1 (màn chỉ nói đơn đã xuống xưởng).
    o.status = STATUS_ORDERED
    o.san_xuat_released_at = o.san_xuat_released_at or datetime(2026, 10, 1, tzinfo=timezone.utc)
    sess.commit()
    return o


def _dong(sess, order_id: int, **kw) -> dict:
    r = theo_doi_don.theo_don(sess, sale_ids=None, **kw)
    return next(d for d in r["items"] if d["order_id"] == order_id)


def test_mot_don_mot_dong_va_dem_chip(sess, lenh_that):
    o = _don_cua(sess, lenh_that)
    r = theo_doi_don.theo_don(sess, sale_ids=None)
    assert [d["order_id"] for d in r["items"]].count(o.id) == 1
    d = _dong(sess, o.id)
    # Đơn của fixture có hai dòng; dòng không có lệnh kéo chặng của cả đơn về Lệnh (món chậm nhất).
    assert d["so_mon"] >= 1
    assert d["chang"] in ("lenh", "sx")
    assert d["nhom"] == "dang_lam"
    assert r["dem"]["tat_ca"] == r["total"]
    assert r["dem"]["dang_lam"] >= 1
    # Lọc chip: đơn đang làm không lọt chip Đã giao xong, nhưng số đếm chip không đổi theo chip.
    r2 = theo_doi_don.theo_don(sess, sale_ids=None, chip="da_giao")
    assert o.id not in [x["order_id"] for x in r2["items"]]
    assert r2["dem"] == r["dem"]


def test_ngoai_pham_vi_khong_thay_va_chi_tiet_403(sess, lenh_that, admin):
    o = _don_cua(sess, lenh_that)
    o.sale_user_id = admin.id
    sess.commit()
    r = theo_doi_don.theo_don(sess, sale_ids={admin.id + 9999})
    assert o.id not in [d["order_id"] for d in r["items"]]
    with pytest.raises(HTTPException) as e:
        theo_doi_don.chi_tiet_don(sess, o.id, sale_ids={admin.id + 9999})
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        theo_doi_don.chi_tiet_don(sess, 987654, sale_ids=None)
    assert e.value.status_code == 404


def test_chi_tiet_co_routing_tung_lenh(sess, lenh_that):
    o = _don_cua(sess, lenh_that)
    c = theo_doi_don.chi_tiet_don(sess, o.id, sale_ids=None)
    assert c["don"]["order_id"] == o.id
    mon = next(m for m in c["mon"] if m["lenh"])
    lenh = mon["lenh"]
    assert [x["id"] for x in lenh] == [lenh_that]
    buoc = lenh[0]["buoc_ds"]
    assert [b["ten"] for b in buoc] == ["CTP", "In", "Đóng gói"]
    assert all(b["trang_thai"] in ("xong", "chay", "dung", "cho") for b in buoc)


def test_kcs_khong_dat_thanh_mon_vuong(sess, lenh_that):
    o = _don_cua(sess, lenh_that)
    cv = _cvs(sess, lenh_that)[0]
    sess.add(SanXuatKcsBatch(
        cong_viec_id=cv.id, bat_dau=datetime(2026, 10, 2, tzinfo=timezone.utc),
        ket_thuc=datetime(2026, 10, 2, 1, tzinfo=timezone.utc),
        so_luong_nhan=10, so_luong_dat=7, so_luong_khong_dat=3, don_vi="cai", ket_luan=KCS_KHONG_DAT,
    ))
    sess.commit()
    d = _dong(sess, o.id)
    # Lý do hiện trên dòng là cờ NẶNG NHẤT (nền test còn thiếu vật tư, đứng trước KCS).
    assert d["vuong"] is not None
    assert d["vuong"]["so_mon"] == 1
    assert d["can_de_y"] is True
    c = theo_doi_don.chi_tiet_don(sess, o.id, sale_ids=None)
    # Món vướng xếp đầu ngăn.
    assert c["mon"][0]["nhom"] == "vuong"
    assert "kcs_khong_dat" in c["mon"][0]["co"]
    assert c["mon"][0]["lenh"][0]["buoc_ds"][0]["kcs_khong_dat"] == 3


def test_chi_tiet_co_hang_va_lich_su(client, seed_credentials, sess, lenh_that):
    """Ngăn đơn hai cột (13/10/2026): món mang hàng ĐÃ CÓ tách phần từ tồn của mã + phần đang giữ cho
    yêu cầu giao (cùng nguồn Đơn hàng bán); lệnh mang làm ra / kế hoạch của bước cuối; đơn có nhật ký
    mới nhất lên đầu, có mốc giao xưởng và KCS của lệnh gắn mã lệnh."""
    o = _don_cua(sess, lenh_that)
    cv = _cvs(sess, lenh_that)[0]
    sess.add(SanXuatKcsBatch(
        cong_viec_id=cv.id, bat_dau=datetime(2026, 10, 2, tzinfo=timezone.utc),
        ket_thuc=datetime(2026, 10, 2, 1, tzinfo=timezone.utc),
        so_luong_nhan=10, so_luong_dat=7, so_luong_khong_dat=3, don_vi="cai", ket_luan=KCS_KHONG_DAT,
    ))
    sess.commit()
    r = client.get(f"/api/theo-doi-san-xuat/theo-don/{o.id}", headers=_h(_tok(client, seed_credentials)))
    assert r.status_code == 200, r.text
    c = r.json()
    mon = next(m for m in c["mon"] if m["lenh"])
    assert {"co_hang", "co_tu_ton", "dang_giu", "con_phai_giao", "lam_ra"} <= set(mon)
    assert mon["co_hang"] == 0 and mon["co_tu_ton"] == 0, "kho trống ⇒ chưa có hàng"
    lenh = mon["lenh"][0]
    assert lenh["ke_hoach_ra"] == lenh["buoc_ds"][-1]["ke_hoach_ra"]
    assert c["giao_xuong_luc"] is not None
    ls = c["lich_su"]
    assert [e["luc"] for e in ls] == sorted((e["luc"] for e in ls), reverse=True)
    assert [e["lenh"] for e in ls if e["loai"] == "giao_xuong"] == [None]
    kcs = next(e for e in ls if e["loai"] == "kcs")
    assert kcs["lenh"] == sess.get(Lsx, lenh_that).ma
    assert "7 đạt và 3 không đạt" in kcs["noi_dung"]


def test_qua_han_giao_thi_tre_theo_hom_nay(sess, lenh_that):
    o = _don_cua(sess, lenh_that)
    o.delivery_committed_date = date.today() - timedelta(days=4)
    sess.commit()
    d = _dong(sess, o.id)
    assert d["tre_ngay"] is not None and d["tre_ngay"] >= 4
    assert d["vuong"]["ly_do"] == "tre"
    assert d["chang_ket"] is True


def test_tim_theo_ma_lenh(sess, lenh_that):
    o = _don_cua(sess, lenh_that)
    ma = sess.get(Lsx, lenh_that).ma
    r = theo_doi_don.theo_don(sess, sale_ids=None, q=ma)
    assert [d["order_id"] for d in r["items"]] == [o.id]


def test_api_theo_don_va_chi_tiet(client, seed_credentials, sess, lenh_that):
    o = _don_cua(sess, lenh_that)
    h = _h(_tok(client, seed_credentials))
    r = client.get("/api/theo-doi-san-xuat/theo-don", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body["dem"]) == set(theo_doi_don.CHIP)
    dong = next(d for d in body["items"] if d["order_id"] == o.id)
    assert dong["dai_dien"]["o"]
    r = client.get(f"/api/theo-doi-san-xuat/theo-don/{o.id}", headers=h)
    assert r.status_code == 200, r.text
    assert any(x["buoc_ds"] for m in r.json()["mon"] for x in m["lenh"])
    assert client.get("/api/theo-doi-san-xuat/theo-don?chip=la", headers=h).status_code == 422
    assert client.get("/api/theo-doi-san-xuat/phu-trach-loc", headers=h).status_code == 200
    assert client.get("/api/theo-doi-san-xuat/khach-loc", headers=h).status_code == 200


def test_nguon_giao_dung_ban_lo_khong_goi_tung_don(sess, lenh_that, monkeypatch):
    """26/10/2026: bản một đơn ~16 câu SQL mỗi đơn — trang theo dõi phải dựng nguồn giao bằng bản
    lô `nguon_giao_theo_cum_nhieu` cho cả trang, không gọi `nguon_giao_theo_cum` từng đơn."""
    o = _don_cua(sess, lenh_that)

    def _cam(self, order):
        raise AssertionError("gọi nguồn giao từng đơn")

    monkeypatch.setattr(DeliveryService, "nguon_giao_theo_cum", _cam)
    assert _dong(sess, o.id)["so_mon"] >= 1
