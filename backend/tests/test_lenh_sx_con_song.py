"""A7 (28/09/2026) — màn Lệnh SX / Theo dõi SX theo máy KHÔNG còn nạp toàn lịch sử.

Làm gọn 05/10/2026: tab Hồ sơ lệnh đổi ngữ nghĩa (theo KHÂU) và KPI đã bỏ, nên bài "so với bản
cũ" của danh sách/KPI hết nghĩa và đã xoá; còn lại bài KHÔNG CÒN NẠP của danh sách.

Hai loại bài cho MỖI màn, và cả hai đều bắt buộc:
  · KẾT QUẢ KHÔNG ĐỔI — chạy bản CŨ (dựng lại nguyên văn trong file này: nạp mọi lệnh rồi mới
    tính) và bản MỚI trên cùng một thế giới có đủ lệnh CŨ đã xong, lệnh đang chạy, lệnh xong trong
    cửa sổ/hôm nay, rồi so từng byte đầu ra. Tầng lọc còn sống chỉ được là TỐI ƯU — lệch một dòng là
    một lệnh biến khỏi tab của nó mà không ai biết.
  · KHÔNG CÒN NẠP — soi thẳng tập id đưa vào `boi_canh.nap()`: lệnh cũ đã xong phải vắng mặt. Chỉ
    so kết quả thì một bản "tối ưu" không cắt gì cũng xanh.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.lsx import Lsx
from app.services.lenh_sx import boi_canh, danh_sach, trang_thai
from tests.lenh_sx_fixtures import (  # noqa: F401
    BAY_GIO,
    _cvs,
    _dat_xong_luc,
    _dot_dong_don,
    _lenh_ghep_doi,
    _lenh_tho,
    _phat_hanh_that,
    admin,
    customer,
    lsx_svc,
    orders,
    sess,
)
from tests.test_lenh_sx_trang_thai import _giao_xong

_XONG_NAM_NGOAI = datetime(2025, 1, 5, 3, 0, tzinfo=timezone.utc)


def _giao_du(sess, lsx_id: int, *, ma: str) -> None:
    """Khách THỰC NHẬN đủ `so_luong_dat` qua một chuyến có hàng đến tay — đường production."""
    _giao_xong(sess, lsx_id, sess.get(Lsx, lsx_id).so_luong_dat, ma=ma)


@pytest.fixture
def the_gioi(sess, orders, lsx_svc, admin, customer):
    """Đủ các hình dạng mà tầng lọc còn sống phải phân biệt:

      cu_tho      — giao đủ từ năm ngoái, không công việc nào (lệnh trần);
      cu_that     — mọi bước đóng năm ngoái + giao đủ  ⇒ phải KHÔNG bị nạp;
      hom_nay     — giao đủ nhưng một bước đóng HÔM NAY (giờ xưởng) ⇒ KPI "xong hôm nay" vẫn đếm;
      dang        — lệnh thật chưa ai đụng;
      giao_thieu  — giao 40/100 ⇒ còn sống dù đã có chuyến;
      gap         — lệnh gấp, còn sống (khoá sắp);
      ghep_a/b    — hai lệnh trên MỘT ca in ghép; bước RIÊNG của `a` đã đóng hết nhưng ca ghép chưa
                    ⇒ `a` vẫn còn nợ việc trên máy (canh vế cầu ghép của bộ lọc `theo_may`).
    """
    _dot_dong_don(sess, 6)
    buoc = [("CTP", 15, 500), ("In", 360, 5000)]
    w = {}
    w["cu_tho"] = _lenh_tho(
        sess, ma="LSX-CS-CU-THO", sale_user_id=admin.id, customer_id=customer.id,
        han_giao=date(2025, 1, 10), so_luong=100,
    )
    _giao_du(sess, w["cu_tho"], ma="YCGH-CS-1")

    w["cu_that"] = _phat_hanh_that(sess, orders, lsx_svc, admin, customer, buoc=buoc)
    for cv in _cvs(sess, w["cu_that"]):
        _dat_xong_luc(sess, cv, _XONG_NAM_NGOAI)
    _giao_du(sess, w["cu_that"], ma="YCGH-CS-2")

    w["hom_nay"] = _phat_hanh_that(sess, orders, lsx_svc, admin, customer, buoc=buoc)
    cvs = _cvs(sess, w["hom_nay"])
    _dat_xong_luc(sess, cvs[0], _XONG_NAM_NGOAI)
    _dat_xong_luc(sess, cvs[-1], BAY_GIO - timedelta(hours=1))   # 01:00 giờ VN — "hôm nay"
    _giao_du(sess, w["hom_nay"], ma="YCGH-CS-3")

    w["dang"] = _phat_hanh_that(sess, orders, lsx_svc, admin, customer, buoc=buoc)

    w["giao_thieu"] = _lenh_tho(
        sess, ma="LSX-CS-THIEU", sale_user_id=admin.id, customer_id=customer.id,
        han_giao=date(2026, 9, 3), so_luong=100,
    )
    _giao_xong(sess, w["giao_thieu"], 40, ma="YCGH-CS-4")

    w["gap"] = _lenh_tho(
        sess, ma="LSX-CS-GAP", sale_user_id=admin.id, customer_id=customer.id,
        han_giao=date(2026, 9, 20), is_rush=True,
    )

    a, b, _chung = _lenh_ghep_doi(
        sess, orders, lsx_svc, admin, customer,
        buoc=[("CTP", 500), ("In", 5000), ("Đóng gói", 5000)], ghep_idx=1,
    )
    for cv in _cvs(sess, a):
        _dat_xong_luc(sess, cv, _XONG_NAM_NGOAI)
    w["ghep_a"], w["ghep_b"] = a, b

    # Hạn giao đặt tay để THỨ TỰ bảng biết trước: gấp → ba lệnh hạn 2025 (đã giao hết) → lệnh sống.
    # Bài phân trang dựa vào đúng thứ tự này để có trang CHỨA và trang KHÔNG chứa lệnh cũ.
    for k, han in (("cu_that", date(2025, 1, 8)), ("hom_nay", date(2025, 1, 9))):
        sess.get(Lsx, w[k]).han_giao_khach = han
    for k in ("dang", "ghep_a", "ghep_b"):
        sess.get(Lsx, w[k]).han_giao_khach = date(2026, 9, 10)
    sess.commit()
    return w


@pytest.fixture
def nap_ghi(monkeypatch):
    """Ghi lại MỌI tập id đưa vào `boi_canh.nap()` — cửa nạp nặng duy nhất của ba màn."""
    ghi: list[set[int]] = []
    goc = boi_canh.nap

    def _nap(db, lsx_ids):
        ghi.append(set(lsx_ids))
        return goc(db, lsx_ids)

    monkeypatch.setattr(boi_canh, "nap", _nap)
    return ghi


# --- Danh sách ------------------------------------------------------------------------------------
def test_danh_sach_khong_nap_lenh_da_giao_het_ngoai_trang(sess, the_gioi, nap_ghi):
    """Lệnh đã giao hết chỉ được nạp khi rơi vào TRANG đang xem. Tab Tất cả sắp hạn GIẢM dần nên
    ba lệnh cũ (hạn 2025) nằm ở hai trang cuối với page_size=2 (8 lệnh: gap 20/09, ba lệnh 10/09,
    giao_thieu 03/09, cu_tho 10/01/2025, hom_nay 09/01/2025, cu_that 08/01/2025)."""
    cu = {the_gioi["cu_tho"], the_gioi["cu_that"], the_gioi["hom_nay"]}
    song = {the_gioi[k] for k in ("dang", "giao_thieu", "gap", "ghep_a", "ghep_b")}

    danh_sach.danh_sach(sess, sale_ids=None, tab=trang_thai.KHAU_DANG_SX)
    da_nap = set().union(*nap_ghi)
    assert not (cu & da_nap), "lệnh đã giao hết vẫn bị nạp ở tab không chứa nó"
    assert song <= da_nap

    nap_ghi.clear()
    kq = danh_sach.danh_sach(sess, sale_ids=None, tab=danh_sach.TAB_TAT_CA, page=1, page_size=2)
    assert not (cu & {r["id"] for r in kq["items"]})
    assert not (cu & set().union(*nap_ghi))

    nap_ghi.clear()
    kq = danh_sach.danh_sach(sess, sale_ids=None, tab=danh_sach.TAB_TAT_CA, page=4, page_size=2)
    tren_trang = {r["id"] for r in kq["items"]}
    assert tren_trang == {the_gioi["hom_nay"], the_gioi["cu_that"]}
    assert cu & set().union(*nap_ghi) == tren_trang
