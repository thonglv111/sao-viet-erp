"""Theo dõi SX: lệnh đã GIAO HẾT rụng sau 3 ngày kể từ lần giao cuối (chốt 28/09/2026).

Trước đây mỗi lệnh từng phát hành có một dòng mãi mãi — màn phình theo tuổi dữ liệu và dải số đầu
màn đếm cả lệnh xong từ năm ngoái. Luật: giao hết + lần giao cuối quá `KANBAN_GIU_SAU_GIAO` + không
còn công việc đang chạy/tạm dừng ⇒ rụng. Thiếu một vế là card PHẢI còn.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.delivery import DeliveryTrip, DeliveryTripLine
from app.models.lsx import Lsx
from app.models.san_xuat import CV_TAM_DUNG
from app.services.lenh_sx import boi_canh, theo_doi
from tests.lenh_sx_fixtures import (  # noqa: F401
    _cvs,
    _dot_dong_don,
    _lenh_tho,
    _phat_hanh_that,
    admin,
    customer,
    lsx_svc,
    orders,
    sess,
)
from tests.test_lenh_sx_trang_thai import _giao_xong


def _doi_moc_giao(sess, lsx_id: int, moc: datetime) -> None:
    """Dời mốc kết thúc mọi chuyến giao của lệnh — `_chuyen` của fixture không đặt cột này."""
    lsx = sess.get(Lsx, lsx_id)
    trip_ids = sess.execute(
        select(DeliveryTripLine.trip_id).where(DeliveryTripLine.order_line_id == lsx.order_line_id)
    ).scalars()
    for tid in set(trip_ids):
        sess.get(DeliveryTrip, tid).thoi_gian_ket_thuc = moc
    sess.commit()


def _giao(sess, lsx_id: int, qty: int, *, ma: str, cach_day: timedelta) -> None:
    _giao_xong(sess, lsx_id, qty, ma=ma)
    _doi_moc_giao(sess, lsx_id, datetime.now(timezone.utc) - cach_day)


@pytest.fixture
def the_gioi(sess, orders, lsx_svc, admin, customer):
    _dot_dong_don(sess, 5)
    kw = dict(sale_user_id=admin.id, customer_id=customer.id, han_giao=date(2026, 9, 10), so_luong=100)
    w = {}
    w["rung"] = _lenh_tho(sess, ma="LSX-KB-RUNG", **kw)
    _giao(sess, w["rung"], 100, ma="YCGH-KB-1", cach_day=timedelta(days=5))

    w["moi_giao"] = _lenh_tho(sess, ma="LSX-KB-MOI", **kw)
    _giao(sess, w["moi_giao"], 100, ma="YCGH-KB-2", cach_day=timedelta(days=1))

    w["giao_thieu"] = _lenh_tho(sess, ma="LSX-KB-THIEU", **kw)
    _giao(sess, w["giao_thieu"], 40, ma="YCGH-KB-3", cach_day=timedelta(days=30))

    w["chua_giao"] = _lenh_tho(sess, ma="LSX-KB-CHUA", **kw)

    # Giao đủ từ lâu nhưng xưởng còn làm dở một bước (làm lại / bù lỗi) ⇒ chưa xong, chưa rụng.
    w["con_lam"] = _phat_hanh_that(
        sess, orders, lsx_svc, admin, customer, buoc=[("CTP", 15, 500), ("In", 360, 5000)],
    )
    _cvs(sess, w["con_lam"])[-1].trang_thai = CV_TAM_DUNG
    sess.commit()
    dat = sess.get(Lsx, w["con_lam"]).so_luong_dat
    _giao(sess, w["con_lam"], dat, ma="YCGH-KB-4", cach_day=timedelta(days=10))
    return w


def _ids_card(sess) -> set[int]:
    """Lệnh còn hiện ở Theo dõi — đọc góc Theo lệnh (một dòng mỗi lệnh còn sống)."""
    return {r["lsx_id"] for r in theo_doi.theo_lenh(sess, sale_ids=None)["items"]}


def test_lenh_giao_het_qua_3_ngay_rung_khoi_theo_doi(sess, the_gioi):
    ids = _ids_card(sess)
    assert the_gioi["rung"] not in ids
    for con in ("moi_giao", "giao_thieu", "chua_giao", "con_lam"):
        assert the_gioi[con] in ids, con


def test_lenh_rung_khong_bi_nap_nang(sess, the_gioi, monkeypatch):
    """Rụng phải xảy ra TRƯỚC `boi_canh.nap()` — chỉ giấu card mà vẫn nạp thì màn vẫn phình."""
    ghi: list[set[int]] = []
    goc = boi_canh.nap
    monkeypatch.setattr(boi_canh, "nap", lambda db, ids: (ghi.append(set(ids)), goc(db, ids))[1])
    theo_doi.theo_lenh(sess, sale_ids=None)
    assert ghi and the_gioi["rung"] not in set().union(*ghi)


def test_moc_3_ngay_tinh_tu_lan_giao_cuoi(sess, the_gioi):
    """Lần giao cuối mới hơn mốc thì còn, dù lần giao đầu đã quá 3 ngày."""
    _doi_moc_giao(sess, the_gioi["rung"], datetime.now(timezone.utc) - timedelta(days=2, hours=23))
    assert the_gioi["rung"] in _ids_card(sess)
    _doi_moc_giao(sess, the_gioi["rung"], datetime.now(timezone.utc) - timedelta(days=3, hours=1))
    assert the_gioi["rung"] not in _ids_card(sess)
