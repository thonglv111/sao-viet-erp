"""Biên chế trên từng ngày — nhớ bản sự kiện đã lọc + xếp (26/10/2026).

Bảng công hỏi trạng thái của 203 người × 31 ngày; lọc + xếp lại lịch sử sự kiện ở MỖI ô ăn ~0,45 s
CPU một lần mở bảng. Danh sách nạp gộp (`events_map`) phải xếp mỗi trường MỘT lần cho mỗi người,
và kết quả phải y như đưa vào list thường.
"""
from __future__ import annotations

from datetime import date
from types import SimpleNamespace

from app.repositories.employee_repo import DsSuKien
from app.services import bien_che


def _ev(i, field, d, tu, den):
    return SimpleNamespace(id=i, field=field, effective_date=d, from_value=tu, to_value=den)


def _su_kien():
    return [
        _ev(1, "status", date(2026, 10, 5), "active", "on_leave"),
        _ev(2, "department", date(2026, 10, 10), "3", "7"),
        _ev(3, "status", date(2026, 10, 20), "on_leave", "active"),
    ]


def _nv():
    return SimpleNamespace(id=1, status="active", department_id=7, hire_date=date(2026, 1, 1),
                           resign_date=None, full_name="A")


def test_ds_su_kien_cho_ket_qua_y_nhu_list_thuong():
    nv = _nv()
    thuong, nho = _su_kien(), DsSuKien(_su_kien())
    for ngay in range(1, 32):
        d = date(2026, 10, ngay)
        assert bien_che.trang_thai_tren_ngay(nv, nho, d) == bien_che.trang_thai_tren_ngay(nv, thuong, d)
        assert bien_che.ly_do_ngoai_bien_che(nv, nho, d) == bien_che.ly_do_ngoai_bien_che(nv, thuong, d)


def test_ds_su_kien_xep_moi_truong_mot_lan(monkeypatch):
    dem = {"n": 0}
    goc = bien_che._loc_xep

    def _dem(events, field):
        dem["n"] += 1
        return goc(events, field)

    monkeypatch.setattr(bien_che, "_loc_xep", _dem)
    nv, ds = _nv(), DsSuKien(_su_kien())
    for ngay in range(1, 32):
        bien_che.trong_bien_che(nv, ds, date(2026, 10, ngay))
    assert dem["n"] <= 2  # mỗi trường một lần, không phải 2 × 31
