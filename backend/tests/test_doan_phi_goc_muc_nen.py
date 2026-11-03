"""Đoàn phí công đoàn: gốc là MỨC NỀN (cơ bản + trách nhiệm), chốt 16/09/2026 — ở CẢ HAI đường.

`_compute` ("Tính lại") đã đổi sang mức nền từ 16/09, nhưng `update_line` ("Sửa 1 ô") còn nhân
`insurance_base`. Ai có mức đóng BHXH khác mức nền thì sửa một ô bất kỳ trên dòng lương là đoàn phí
đổi số, kéo theo thực nhận và thuế.
"""
from __future__ import annotations

from tests.test_luong_api import _admin_token, _h, _make_emp


def test_sua_mot_o_giu_doan_phi_theo_muc_nen(client):
    token = _admin_token(client)
    client.put("/api/luong/params", json={"cong_doan_rate": 0.01}, headers=_h(token))
    eid = _make_emp(client, token, name="NV Doan Vien Muc BH Thap", status="active")
    r = client.post(f"/api/luong/salaries/{eid}",
                    json={"effective_from": "2026-01-01", "luong_vi_tri": 8_000_000,
                          "luong_trach_nhiem": 4_000_000, "insurance_base": 6_000_000,
                          "union_member": True},
                    headers=_h(token))
    assert r.status_code == 201, r.text

    gen = client.post("/api/luong/generate", json={"year": 2026, "month": 6}, headers=_h(token)).json()
    line = next(l for l in gen["lines"] if l["employee_id"] == eid)
    assert line["insurance_base"] == 6_000_000, "ca đo hỏng: mức đóng BH phải khác mức nền"
    assert line["cong_doan"] == 120_000   # 1% × 12.000.000 mức nền, không phải 1% × 6.000.000

    sua = client.put(f"/api/luong/lines/{line['id']}", json={"note": "soát lại"},
                     headers=_h(token)).json()
    assert sua["cong_doan"] == line["cong_doan"]
    client.put("/api/luong/params", json={"cong_doan_rate": 0}, headers=_h(token))
