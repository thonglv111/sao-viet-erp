"""Biểu bậc hoa hồng theo số ngày thu tiền (chủ chốt 23/10/2026, sổ T08).

Bậc tăng dần theo `den_ngay`, bậc cuối vô hạn (`den_ngay = None`). NULL / rỗng = không hưởng.
"""
from __future__ import annotations

import pytest

from app.services.bac_hoa_hong import chuan_hoa_bac, pct_theo_bac
from tests.test_luong_api import _admin_token, _h, _make_emp

CTV = [{"den_ngay": 45, "pct": 0.03}, {"den_ngay": 60, "pct": 0.02},
       {"den_ngay": 75, "pct": 0.01}, {"den_ngay": None, "pct": 0}]
LANH_DAO = [{"den_ngay": None, "pct": 0.005}]


def test_bac_ctv_moc_bien():
    assert [pct_theo_bac(CTV, n) for n in (0, 45, 46, 60, 61, 75, 76, 400)] == [
        0.03, 0.03, 0.02, 0.02, 0.01, 0.01, 0, 0]


def test_lanh_dao_khong_gioi_han_ngay():
    assert pct_theo_bac(LANH_DAO, 383) == 0.005


def test_so_ngay_am_coi_nhu_0():
    assert pct_theo_bac(CTV, -12) == 0.03


def test_rong_la_khong_huong():
    assert pct_theo_bac(None, 10) == 0.0 and pct_theo_bac([], 10) == 0.0


def test_chuan_hoa_chan_moc_khong_tang():
    with pytest.raises(ValueError):
        chuan_hoa_bac([{"den_ngay": 60, "pct": 0.02}, {"den_ngay": 45, "pct": 0.03},
                       {"den_ngay": None, "pct": 0}])


def test_chuan_hoa_chan_thieu_bac_vo_han():
    with pytest.raises(ValueError):
        chuan_hoa_bac([{"den_ngay": 45, "pct": 0.03}])


def test_chuan_hoa_chan_pct_ngoai_0_1():
    with pytest.raises(ValueError):
        chuan_hoa_bac([{"den_ngay": None, "pct": 3}])


def test_chuan_hoa_rong_la_None():
    assert chuan_hoa_bac([]) is None and chuan_hoa_bac(None) is None
    assert chuan_hoa_bac(CTV) == CTV


def test_KHAI_bieu_o_ho_so_luong_va_doc_lai(client):
    t = _admin_token(client)
    eid = _make_emp(client, t, name="CTV Bieu")
    r = client.post(f"/api/luong/salaries/{eid}",
                    json={"effective_from": "2026-01-01", "luong_vi_tri": 5_000_000, "bac_hoa_hong": CTV},
                    headers=_h(t))
    assert r.status_code == 201, r.text
    assert r.json()["bac_hoa_hong"] == CTV
    ds = client.get(f"/api/luong/salaries/{eid}", headers=_h(t)).json()
    assert ds["items"][0]["bac_hoa_hong"] == CTV


def test_KHAI_bieu_moc_lui_bi_chan_400(client):
    t = _admin_token(client)
    eid = _make_emp(client, t, name="CTV Lui")
    r = client.post(f"/api/luong/salaries/{eid}",
                    json={"effective_from": "2026-01-01", "luong_vi_tri": 5_000_000,
                          "bac_hoa_hong": [{"den_ngay": 60, "pct": 0.02}, {"den_ngay": 45, "pct": 0.03},
                                           {"den_ngay": None, "pct": 0}]},
                    headers=_h(t))
    assert r.status_code == 400, r.text


def test_MIGRATION_chuyen_pct_cu_sang_bieu_mot_bac(client):
    """`commission_pct > 0` cũ ⇒ biểu một bậc vô hạn cùng %; chạy lại không đổi gì."""
    from datetime import date

    from app.db import SessionLocal
    from app.db_migrations import _migrate_bac_hoa_hong
    from app.models.payroll import EmployeeSalary

    t = _admin_token(client)
    eid = _make_emp(client, t, name="Sale Cu")
    db = SessionLocal()
    try:
        s = EmployeeSalary(employee_id=eid, effective_from=date(2026, 1, 1), luong_vi_tri=5_000_000,
                           commission_pct=0.02)
        db.add(s)
        db.commit()
        sid = s.id
        _migrate_bac_hoa_hong(db)
        _migrate_bac_hoa_hong(db)
        db.expire_all()
        assert db.get(EmployeeSalary, sid).bac_hoa_hong == [{"den_ngay": None, "pct": 0.02}]
    finally:
        db.close()


def test_KHAI_pct_phang_cu_thanh_bieu_mot_bac(client):
    """Đường cũ còn gửi `commission_pct` (tạo nhân viên, nhập Excel) ⇒ lưu thành biểu một bậc vô hạn,
    không thì ô % đó khai bao nhiêu cũng không ra đồng nào."""
    t = _admin_token(client)
    eid = _make_emp(client, t, name="Sale Phang")
    r = client.post(f"/api/luong/salaries/{eid}",
                    json={"effective_from": "2026-01-01", "luong_vi_tri": 5_000_000, "commission_pct": 0.02},
                    headers=_h(t))
    assert r.status_code == 201, r.text
    assert r.json()["bac_hoa_hong"] == [{"den_ngay": None, "pct": 0.02}]


def test_KHAI_chi_huong_hoa_hong_luong_0_van_luu_duoc(client):
    """Lãnh đạo (TGĐ Sơn) và CTV (Ngọc Sơn) trên sổ T08 không có lương vị trí, chỉ hưởng hoa hồng —
    phải lưu được biểu với lương 0. Không biểu mà lương 0 thì vẫn chặn như cũ."""
    t = _admin_token(client)
    eid = _make_emp(client, t, name="Lanh Dao")
    r = client.post(f"/api/luong/salaries/{eid}",
                    json={"effective_from": "2026-01-01", "luong_vi_tri": 0, "bac_hoa_hong": LANH_DAO},
                    headers=_h(t))
    assert r.status_code == 201, r.text
    assert r.json()["bac_hoa_hong"] == LANH_DAO
    r = client.post(f"/api/luong/salaries/{eid}",
                    json={"effective_from": "2026-02-01", "luong_vi_tri": 0, "bac_hoa_hong": None},
                    headers=_h(t))
    assert r.status_code == 400, r.text
