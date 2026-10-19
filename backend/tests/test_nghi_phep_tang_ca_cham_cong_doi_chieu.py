"""Nghỉ phép, tăng ca và chấm công phải đối chiếu nhau (lỗi #40 bấm thử 18/10/2026).

Bấm thử: phiếu tăng ca 17:00–19:00 ngày đã duyệt nghỉ phép cả ngày vẫn gửi và duyệt được; đơn nghỉ
cho ngày nhân viên đã chấm VÀO/RA vẫn duyệt được. Người duyệt không được nhắc gì.

Luật: đơn nghỉ đã duyệt là CẢ NGÀY (đơn nghỉ không có nửa ngày) ⇒ ngày đó không gửi, không duyệt
tăng ca. Ngày đã có lượt chấm công ⇒ không duyệt đơn nghỉ phủ ngày đó. Câu báo nói cách gỡ.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.db import SessionLocal
from app.models.attendance import AttendanceLog
from tests.test_leaves_api import _admin_token, _h, _link_admin_employee, _make_type

# Thứ Hai–Thứ Tư, ngày làm việc (đơn nghỉ chặn cuối tuần).
NGAY_NGHI, NGAY_LAM, NGAY_CHAM = "2026-08-03", "2026-08-04", "2026-08-05"


def _don_nghi(client, token, tid, ngay: str) -> int:
    r = client.post("/api/leaves", json={"leave_type_id": tid, "start_date": ngay, "end_date": ngay},
                    headers=_h(token))
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _duyet_nghi(client, token, rid: int):
    return client.post(f"/api/leaves/{rid}/approve", json={}, headers=_h(token))


def _tang_ca(client, token, eid: int, ngay: str):
    # 17:00–19:00 ngày công.
    return client.post("/api/overtime", json={"employee_id": eid, "work_date": ngay, "from_minute": 1020,
                                              "to_minute": 1140, "reason": "chạy đơn gấp"},
                       headers=_h(token))


def test_tang_ca_vao_ngay_da_duyet_nghi_bi_chan(client):
    token = _admin_token(client)
    tid = _make_type(client, token)
    eid = _link_admin_employee(client, token)
    assert _duyet_nghi(client, token, _don_nghi(client, token, tid, NGAY_NGHI)).status_code == 200

    r = _tang_ca(client, token, eid, NGAY_NGHI)
    assert r.status_code == 400, r.text
    assert "đơn nghỉ" in r.json()["detail"] and "03/08/2026" in r.json()["detail"]
    assert _tang_ca(client, token, eid, NGAY_LAM).status_code == 201


def test_duyet_tang_ca_cho_sau_khi_nghi_duoc_duyet_bi_chan(client):
    """Phiếu tăng ca gửi trước (đang chờ), đơn nghỉ cùng ngày duyệt sau ⇒ duyệt phiếu bị chặn."""
    token = _admin_token(client)
    tid = _make_type(client, token)
    eid = _link_admin_employee(client, token)
    r = client.post("/api/overtime/me", json={"work_date": NGAY_NGHI, "from_minute": 1020,
                                           "to_minute": 1140, "reason": "tự xin"}, headers=_h(token))
    assert r.status_code == 201 and r.json()["status"] == "pending", r.text
    assert _duyet_nghi(client, token, _don_nghi(client, token, tid, NGAY_NGHI)).status_code == 200

    d = client.post(f"/api/overtime/{r.json()['id']}/approve", json={}, headers=_h(token))
    assert d.status_code == 400, d.text
    assert "đơn nghỉ" in d.json()["detail"]
    assert eid


def test_duyet_nghi_ngay_da_cham_cong_bi_chan(client):
    token = _admin_token(client)
    tid = _make_type(client, token)
    eid = _link_admin_employee(client, token)
    rid = _don_nghi(client, token, tid, NGAY_CHAM)
    db = SessionLocal()
    try:
        # 08:00 giờ VN ngày 05/08.
        db.add(AttendanceLog(employee_id=eid, check_type="in",
                             checked_at=datetime(2026, 8, 5, 1, 0, tzinfo=timezone.utc)))
        db.commit()
    finally:
        db.close()

    r = _duyet_nghi(client, token, rid)
    assert r.status_code == 400, r.text
    assert "chấm công" in r.json()["detail"] and "05/08/2026" in r.json()["detail"]
    # Ngày không có lượt chấm thì duyệt như thường.
    assert _duyet_nghi(client, token, _don_nghi(client, token, tid, NGAY_LAM)).status_code == 200
