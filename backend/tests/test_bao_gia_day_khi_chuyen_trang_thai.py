"""Mọi lần báo giá đổi trạng thái đều đẩy tới màn đang mở của người khác (lỗi #60 bấm lại 19/10/2026).

Thợ mở BG26-0011, admin bấm Gửi khách: hơn 8 giây sau màn thợ vẫn "Nháp" và còn nút Gửi khách —
router chỉ phát sự kiện khi trình duyệt hoặc huỷ.
"""
from __future__ import annotations

from app.realtime import hub
from tests.test_quotation_approval import _h, _role_token, _seed_ptg, _token


def test_gui_khach_va_khach_chot_deu_day_su_kien(client, monkeypatch):
    _token(client)
    sales = _role_token("nv_sales_day", "NV Sales")
    pid = _seed_ptg(gia_von_tp=1_000_000, cua=sales)
    q = client.post("/api/quotations", json={"phieu_tinh_gia_id": pid}, headers=_h(sales)).json()

    ds: list[dict] = []
    monkeypatch.setattr(hub, "gui", lambda ev, **kw: ds.append(ev))
    for st in ("sent", "accepted"):
        r = client.post(f"/api/quotations/{q['id']}/transition", json={"to_status": st},
                        headers=_h(sales))
        assert r.status_code == 200, r.text
    assert [e["type"] for e in ds] == ["quote_pending_changed", "quote_pending_changed"]
    assert all(e["code"] == q["code"] for e in ds)
