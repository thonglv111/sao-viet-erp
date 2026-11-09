"""Góc Theo lệnh + dải bất thường của màn Theo dõi sản xuất (làm gọn 05/10/2026).

Dải bất thường đếm trên TOÀN tập lệnh còn sống trong phạm vi, trước ô tìm/khách/máy và trước chính
mục đang chọn — gõ tìm xong không được làm người ta tưởng sự cố đã hết. Màn này KHÔNG chạy cân đối
vật tư: cờ thiếu vật tư không thuộc dải (đặc tả 3.1).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.lsx import Lsx
from app.models.machine_unavailable import KIEU_CHAN, LY_DO_HONG_HOC, MachineUnavailablePeriod
from app.models.may_thiet_bi import MayThietBi
from app.models.san_xuat import CV_TAM_DUNG
from app.models.san_xuat_kcs import KCS_KHONG_DAT, SanXuatKcsBatch
from app.services.lenh_sx import theo_doi, trang_thai
from tests.lenh_sx_fixtures import (  # noqa: F401
    _cvs,
    _dem_sql,
    _dot_dong_don,
    _h,
    _lenh_tho,
    _phat_hanh_that,
    _tok,
    _token_khong_quyen_theo_doi,
    admin,
    customer,
    ghep_doi,
    lenh_cua_sale_own,
    lenh_that,
    lsx_svc,
    orders,
    sale_own,
    sess,
)
from tests.test_lenh_sx_trang_thai import _su_co

_HAN_XA = date(2099, 1, 1)


def _theo_lenh(sess, **kw) -> dict:
    return theo_doi.theo_lenh(sess, sale_ids=None, **kw)


def _ids(d: dict) -> list[int]:
    return [r["lsx_id"] for r in d["items"]]


@pytest.fixture
def xuong_co_chuyen(sess, orders, lsx_svc, admin, customer) -> dict[str, int]:
    """Bảy lệnh thật, mỗi lệnh dính ĐÚNG MỘT chuyện (cộng một lệnh sạch). Mọi bước đã xếp lên một
    máy bình thường, trừ bước đầu của lệnh `chua_may` — vì `_dung_lenh` để `may_id` rỗng cho mọi
    bước, không xếp thì lệnh nào cũng đếm vào "bước chưa có máy"."""
    _dot_dong_don(sess, 7)
    buoc = [("CTP", 15, 500), ("In", 360, 5000)]
    w = {
        k: _phat_hanh_that(sess, orders, lsx_svc, admin, customer, buoc=buoc)
        for k in ("sach", "tre_han", "su_co", "tam_dung", "kcs_khong_dat", "may_hong", "chua_may")
    }
    thuong = MayThietBi(ma="MAY-TL-THUONG", ten="Máy in thường (TL)", loai_may="in", active=True)
    hong = MayThietBi(ma="MAY-TL-HONG", ten="Máy in hỏng (TL)", loai_may="in", active=True)
    sess.add_all([thuong, hong])
    sess.flush()
    bay_gio = datetime.now(timezone.utc)
    sess.add(MachineUnavailablePeriod(
        may_id=hong.id, kieu=KIEU_CHAN, reason=LY_DO_HONG_HOC,
        unavailable_from=bay_gio - timedelta(days=1), unavailable_to=bay_gio + timedelta(days=1),
    ))
    for k, lsx_id in w.items():
        sess.get(Lsx, lsx_id).han_giao_khach = _HAN_XA
        for cv in _cvs(sess, lsx_id):
            cv.may_id = thuong.id
    # Từ 08/11/2026 trễ đo theo HẠN GIAO KHÁCH (lệnh chưa xong mà đã qua hạn giao).
    sess.get(Lsx, w["tre_han"]).han_giao_khach = date(2020, 1, 1)
    _cvs(sess, w["tam_dung"])[0].trang_thai = CV_TAM_DUNG
    _cvs(sess, w["may_hong"])[1].may_id = hong.id
    _cvs(sess, w["chua_may"])[0].may_id = None
    sess.add(SanXuatKcsBatch(
        cong_viec_id=_cvs(sess, w["kcs_khong_dat"])[0].id,
        bat_dau=bay_gio - timedelta(hours=2), ket_thuc=bay_gio - timedelta(hours=1),
        so_luong_nhan=10, so_luong_dat=0, so_luong_khong_dat=10, don_vi="to",
        ket_luan=KCS_KHONG_DAT,
    ))
    sess.commit()
    _su_co(sess, w["su_co"], _cvs(sess, w["su_co"])[0].id, ma="YC-TL-SC")
    return w


def test_dai_bat_thuong_dem_dung_tung_muc(sess, xuong_co_chuyen):
    d = _theo_lenh(sess)
    assert d["bat_thuong"] == {
        "tre_han": 1, "su_co": 1, "tam_dung": 1, "kcs_khong_dat": 1, "may_hong": 1, "chua_may": 1,
    }


@pytest.mark.parametrize("khoa", theo_doi.BAT_THUONG)
def test_loc_bat_thuong_tung_muc(sess, xuong_co_chuyen, khoa):
    d = _theo_lenh(sess, bat_thuong=khoa)
    assert _ids(d) == [xuong_co_chuyen[khoa]]
    assert d["total"] == 1


def test_dai_bat_thuong_khong_doi_theo_o_tim_va_muc_dang_chon(sess, xuong_co_chuyen):
    het = _theo_lenh(sess)["bat_thuong"]
    tim = _theo_lenh(sess, q="khong-khop-lenh-nao")
    assert tim["items"] == [] and tim["total"] == 0
    assert tim["bat_thuong"] == het
    assert _theo_lenh(sess, bat_thuong="su_co")["bat_thuong"] == het


def test_canh_bao_tren_dong_va_tre_ngay(sess, xuong_co_chuyen):
    d = _theo_lenh(sess)
    dong = {r["lsx_id"]: r for r in d["items"]}
    assert dong[xuong_co_chuyen["sach"]]["canh_bao"] == []
    tre = dong[xuong_co_chuyen["tre_han"]]
    assert tre["canh_bao"] == [trang_thai.CO_TRE_HAN]
    assert tre["tre_ngay"] is not None and tre["tre_ngay"] > 0
    assert dong[xuong_co_chuyen["su_co"]]["canh_bao"] == [trang_thai.CO_SU_CO]
    assert dong[xuong_co_chuyen["su_co"]]["tre_ngay"] is None


def test_dong_mang_dang_o_va_khau(sess, lenh_that):
    row = next(r for r in _theo_lenh(sess)["items"] if r["lsx_id"] == lenh_that)
    assert row["buoc_hien_tai"] == _cvs(sess, lenh_that)[0].ten_cong_doan
    assert len(row["chang"]) == 3
    assert sum(1 for c in row["chang"] if c["hien_tai"]) == 1
    assert row["khau"] == trang_thai.KHAU_DANG_SX
    assert row["khau_chi_tiet"] is None
    assert set(row) == {
        "lsx_id", "ma", "ten", "is_rush", "so_luong_dat", "don_vi_tinh", "khach_hang", "chang",
        "buoc_hien_tai", "khau", "khau_chi_tiet", "han_hoan_thanh_sx", "created_at",
        "canh_bao", "tre_ngay",
    }


def test_sap_so_co_giam_roi_gap_roi_han(sess, admin, customer, lenh_that):
    kw = dict(sale_user_id=admin.id, customer_id=customer.id)
    a = _lenh_tho(sess, ma="LSX-TL-A", han_giao=date(2099, 1, 9), **kw)
    gap = _lenh_tho(sess, ma="LSX-TL-GAP", han_giao=date(2099, 1, 20), is_rush=True, **kw)
    b = _lenh_tho(sess, ma="LSX-TL-B", han_giao=date(2099, 1, 5), **kw)
    sess.get(Lsx, lenh_that).han_giao_khach = date(2099, 1, 30)
    sess.commit()
    _su_co(sess, lenh_that, _cvs(sess, lenh_that)[0].id, ma="YC-TL-SAP")
    assert _ids(_theo_lenh(sess)) == [lenh_that, gap, b, a]


def test_cat_o_200_dong_nhung_total_dem_du(sess, admin, customer, monkeypatch):
    monkeypatch.setattr(theo_doi, "GIOI_HAN_THEO_LENH", 3)
    for i in range(5):
        _lenh_tho(sess, ma=f"LSX-TL-CAT{i}", sale_user_id=admin.id, customer_id=customer.id)
    d = _theo_lenh(sess)
    assert len(d["items"]) == 3
    assert d["total"] == 5


def test_loc_may_bat_ca_buoc_ghep(sess, ghep_doi):
    a, b, cv_chung = ghep_doi
    may = MayThietBi(ma="MAY-TL-GHEP", ten="Máy in ca ghép (TL)", loai_may="in", active=True)
    sess.add(may)
    sess.flush()
    cv_chung.may_id = may.id
    sess.commit()
    assert sorted(_ids(_theo_lenh(sess, may_id=may.id))) == sorted([a, b])


def test_khong_chay_can_doi_vat_tu(sess, xuong_co_chuyen, monkeypatch):
    def cam(*_a, **_k):
        raise AssertionError("Theo dõi không được chạy cân đối vật tư")

    monkeypatch.setattr(trang_thai, "den_vat_tu_theo_lo", cam)
    assert _theo_lenh(sess)["total"] == len(xuong_co_chuyen)


def test_so_cau_sql_hang_tren_truc_lenh(sess, orders, lsx_svc, admin, customer):
    buoc = [("CTP", 15, 500), ("In", 360, 5000)]
    _dot_dong_don(sess, 6)
    for _ in range(3):
        _phat_hanh_that(sess, orders, lsx_svc, admin, customer, buoc=buoc)
    n3 = _dem_sql(lambda: _theo_lenh(sess))
    for _ in range(2):
        _phat_hanh_that(sess, orders, lsx_svc, admin, customer, buoc=buoc)
    n5 = _dem_sql(lambda: _theo_lenh(sess))
    assert _theo_lenh(sess)["total"] == 5
    assert n3 == n5, f"số câu SQL nở theo số lệnh: {n3} → {n5}"


# --- Cửa HTTP --------------------------------------------------------------------------------------
def test_api_theo_lenh(client, seed_credentials, sess, lenh_that):
    h = _h(_tok(client, seed_credentials))
    r = client.get("/api/theo-doi-san-xuat/theo-lenh", headers=h)
    assert r.status_code == 200
    d = r.json()
    assert set(d) == {"items", "total", "bat_thuong"}
    assert [i["lsx_id"] for i in d["items"]] == [lenh_that]


def test_api_bat_thuong_la_bi_chan(client, seed_credentials):
    h = _h(_tok(client, seed_credentials))
    r = client.get("/api/theo-doi-san-xuat/theo-lenh?bat_thuong=thieu_vat_tu", headers=h)
    assert r.status_code == 422


def test_api_theo_lenh_401_403(client, sess):
    assert client.get("/api/theo-doi-san-xuat/theo-lenh").status_code == 401
    h = _h(_token_khong_quyen_theo_doi(sess))
    assert client.get("/api/theo-doi-san-xuat/theo-lenh", headers=h).status_code == 403


def test_api_theo_lenh_hep_theo_pham_vi(client, sess, sale_own, lenh_cua_sale_own, lenh_that):
    h = _h(_tok(client, {"username": sale_own.username, "password": "x"}))
    d = client.get("/api/theo-doi-san-xuat/theo-lenh", headers=h).json()
    assert [i["lsx_id"] for i in d["items"]] == [lenh_cua_sale_own]
