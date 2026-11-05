"""Tin "KCS đã kiểm" gửi tổ bước cuối mang số lỗi quy cho công đoạn khác (05/11/2026).

Thiếu số này thì tổ bước cuối đọc "đạt 995 và lỗi 0" dù KCS vừa ghi 5 lỗi, quy cả cho bước trước."""
from app.routers import san_xuat as r


def test_tin_ket_qua_mang_loi_quy_ve(monkeypatch):
    gui: list[tuple[int, dict]] = []
    monkeypatch.setattr(r.hub, "publish", lambda uid, ev: gui.append((uid, ev)))
    monkeypatch.setattr(r.hub, "gui", lambda *a, **k: None)
    res = {
        "cong_viec_id": 7, "department_id": 3, "lsx_id": 1, "lsx_ma": "LSX26-0007",
        "ten_cong_doan": "Cân hàng", "la_kcs_cuoi": True, "so_dat": 995.0, "so_loi": 5.0,
        "so_loi_cua_to": 0.0, "notify_user_ids": [11],
        "bao_loi_nguon": [
            {"cong_viec_id": 1, "department_id": 4, "ten_cong_doan": "In", "so_loi": 3.0, "notify_user_ids": []},
            {"cong_viec_id": 5, "department_id": 6, "ten_cong_doan": "Dán bìa", "so_loi": 2.0, "notify_user_ids": []},
        ],
    }
    r._phat_sse_kcs(res)
    ev = next(ev for uid, ev in gui if uid == 11)
    assert ev["so_loi"] == 0.0
    assert ev["so_loi_quy_ve"] == 5.0
