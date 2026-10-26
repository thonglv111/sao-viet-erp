"""Biên chế cả THÁNG trong một lượt (26/10/2026 — bảng công/lương dưới 1 giây trên DB 6.300 NV).

Bảng công, lưới phân ca, bảng lương hỏi "ngày d người này còn biên chế không" cho TỪNG (người ×
ngày): 6.300 người × 31 ngày ≈ 240 nghìn lượt duyệt lại sự kiện. `ngay_trong_bien_che_thang` trả
tập ngày trong biên chế của một tháng bằng các khoảng [từ, đến) dựng từ sự kiện — phải ra ĐÚNG
tập ngày mà hỏi `trong_bien_che` từng ngày cho ra, ở mọi ca biên: vào/nghỉ việc giữa tháng, nghỉ
dài hạn rồi đi làm lại, hai sự kiện cùng ngày, sự kiện thiếu `from_value`/`to_value`, tuyển lại.
"""
from __future__ import annotations

import calendar
import random
from datetime import date, timedelta
from types import SimpleNamespace

from app.repositories.employee_repo import DsSuKien
from app.services import bien_che

_TRANG_THAI = ["probation", "probation_ended", "active", "on_leave", "suspended", "resigned"]


def _ev(i, field, d, tu, den):
    return SimpleNamespace(id=i, field=field, effective_date=d, from_value=tu, to_value=den)


def _nv(status="active", hire=None, resign=None):
    return SimpleNamespace(id=1, status=status, department_id=7, hire_date=hire,
                           resign_date=resign, full_name="A")


def _tung_ngay(nv, evs, y, m):
    last = calendar.monthrange(y, m)[1]
    return {d for d in range(1, last + 1) if bien_che.trong_bien_che(nv, evs, date(y, m, d))}


def test_vao_nghi_giua_thang_va_nghi_dai_han():
    nv = _nv(hire=date(2026, 10, 6), resign=date(2026, 10, 25))
    evs = [_ev(1, "status", date(2026, 10, 10), "active", "on_leave"),
           _ev(2, "status", date(2026, 10, 15), "on_leave", "active")]
    for ds in (evs, DsSuKien(evs)):
        assert bien_che.ngay_trong_bien_che_thang(nv, ds, 2026, 10) == (
            set(range(6, 10)) | set(range(15, 25)))
    assert bien_che.trong_bien_che_thang(nv, evs, 2026, 10)
    assert not bien_che.trong_bien_che_thang(nv, evs, 2026, 11)


def test_khop_hoi_tung_ngay_ngau_nhien():
    """So với hỏi từng ngày trên 3.000 hồ sơ ngẫu nhiên — mọi tổ hợp biên."""
    rng = random.Random(20261026)
    goc = date(2026, 8, 1)
    for _ in range(3000):
        hire = goc + timedelta(days=rng.randint(-10, 120)) if rng.random() < 0.8 else None
        resign = goc + timedelta(days=rng.randint(0, 150)) if rng.random() < 0.4 else None
        nv = _nv(status=rng.choice(_TRANG_THAI), hire=hire, resign=resign)
        evs = []
        for i in range(rng.randint(0, 5)):
            d = goc + timedelta(days=rng.randint(-20, 130))
            tu = rng.choice(_TRANG_THAI + [None])
            den = rng.choice(_TRANG_THAI + [None])
            evs.append(_ev(i + 1, rng.choice(["status", "status", "department"]), d, tu, den))
        if rng.random() < 0.2 and evs:     # hai sự kiện cùng ngày
            e0 = evs[0]
            evs.append(_ev(99, "status", e0.effective_date, rng.choice(_TRANG_THAI), rng.choice(_TRANG_THAI)))
        rng.shuffle(evs)
        for y, m in ((2026, 9), (2026, 10), (2026, 11)):
            mong = _tung_ngay(nv, evs, y, m)
            assert bien_che.ngay_trong_bien_che_thang(nv, evs, y, m) == mong
            assert bien_che.ngay_trong_bien_che_thang(nv, DsSuKien(evs), y, m) == mong
            assert bien_che.trong_bien_che_thang(nv, DsSuKien(evs), y, m) == bool(mong)


def test_tra_tung_ngay_khop_duyet_tuan_tu():
    """Bản tra nhị phân của `_gia_tri_tren_ngay` phải y bản duyệt tuần tự cũ."""
    rng = random.Random(7)

    def _cu(hien_tai, events, field, d):
        evs = bien_che._loc_xep(events, field)
        if not evs:
            return hien_tai
        v = evs[0].from_value if evs[0].from_value is not None else hien_tai
        for e in evs:
            if e.effective_date <= d:
                if e.to_value is not None:
                    v = e.to_value
            else:
                break
        return v

    goc = date(2026, 10, 1)
    for _ in range(500):
        evs = [_ev(i + 1, "status", goc + timedelta(days=rng.randint(0, 40)),
                   rng.choice(_TRANG_THAI + [None]), rng.choice(_TRANG_THAI + [None]))
               for i in range(rng.randint(0, 4))]
        ds = DsSuKien(evs)
        for k in range(-3, 45):
            d = goc + timedelta(days=k)
            assert bien_che._gia_tri_tren_ngay("active", ds, "status", d) == _cu("active", evs, "status", d)
            assert bien_che._gia_tri_tren_ngay("active", evs, "status", d) == _cu("active", evs, "status", d)
