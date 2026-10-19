"""Lịch sử + lý do huỷ của yêu cầu mua hàng (lỗi #19, #20 bấm thử E2E 18/10/2026).

  · #19: lập yêu cầu không ghi dòng "Lập phiếu"; bỏ một món (còn món sống) không ghi lịch sử phiếu,
    tab Lịch sử trống trơn.
  · #20: huỷ cả yêu cầu không hỏi lý do, FE gửi cứng tiêu đề hộp thoại làm "lý do".
"""
from __future__ import annotations

from tests.test_purchases_api import _department_request_payload, auth_headers, token  # noqa: F401


def _tao(client, h, so_mon=1):
    body = _department_request_payload()
    mon = [("Giay Duplex 350gsm", "to"), ("Keo can mang", "kg")]
    body["lines"] = [{"item_name": t, "unit": u, "quantity": 100} for t, u in mon[:so_mon]]
    r = client.post("/api/department-purchase-requests", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def test_lap_yeu_cau_ghi_dong_lich_su_lap_phieu(client, auth_headers):
    yc = _tao(client, auth_headers)
    ls = yc["status_history"]
    assert len(ls) == 1
    assert ls[0]["from_status"] is None and ls[0]["to_status"] == "open"
    assert ls[0]["changed_by_name"]


def test_bo_mot_mon_con_mon_song_ghi_lich_su_kem_ly_do(client, auth_headers):
    yc = _tao(client, auth_headers, so_mon=2)
    line_id = yc["lines"][0]["id"]
    r = client.post(f"/api/department-purchase-requests/{yc['id']}/lines/{line_id}/cancel",
                    json={"reason": "Khach doi mau"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    ls = r.json()["status_history"]
    moi = ls[0]
    assert moi["to_status"] == "huy_mot_phan"
    assert "Khach doi mau" in moi["reason"] and "Giay Duplex 350gsm" in moi["reason"]


def test_huy_ca_yeu_cau_bat_buoc_ly_do(client, auth_headers):
    yc = _tao(client, auth_headers)
    url = f"/api/department-purchase-requests/{yc['id']}/cancel"
    assert client.post(url, json={}, headers=auth_headers).status_code == 422
    assert client.post(url, json={"reason": "  "}, headers=auth_headers).status_code == 422
    r = client.post(url, json={"reason": "Don khach huy"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["reject_reason"] == "Don khach huy"
    assert r.json()["status_history"][0]["reason"] == "Don khach huy"


def test_bo_mot_mon_roi_huy_ca_thi_het_huy_mot_phan(client, auth_headers):
    """#58 bấm lại 19/10/2026: bỏ một món rồi huỷ cả yêu cầu, chip ở danh sách và ngăn vẫn
    "Huỷ một phần" (YCMH-261018-7OHY)."""
    yc = _tao(client, auth_headers, so_mon=2)
    client.post(f"/api/department-purchase-requests/{yc['id']}/lines/{yc['lines'][0]['id']}/cancel",
                json={"reason": "Bo mon"}, headers=auth_headers)
    r = client.post(f"/api/department-purchase-requests/{yc['id']}/cancel",
                    json={"reason": "Huy ca"}, headers=auth_headers)
    assert r.json()["workflow_status"] == "cancelled"
    ds = client.get("/api/department-purchase-requests", params={"workflow_status": "cancelled"},
                    headers=auth_headers).json()
    items = ds["items"] if isinstance(ds, dict) else ds
    assert any(x["id"] == yc["id"] and x["workflow_status"] == "cancelled" for x in items)
