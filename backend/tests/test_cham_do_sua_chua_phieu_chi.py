"""Chấm đỏ Sửa chữa máy (báo hỏng → tổ sửa chữa).

Chấm Phiếu chi của gia công chốt (module cũ) gỡ 13/11/2026 — hàng chờ trả tiền thuê gia công làm lại
ở đợt 6 của module Thuê gia công, test đi theo (`test_tgc_phieu_chi.py`)."""
from app.db import SessionLocal
from app.models.may_thiet_bi import MayThietBi
from app.models.role import SCOPE_ALL, SCOPE_OWN

from .thong_bao_helpers import dang_nhap, tao_nguoi, tom_tat


def test_bao_hong_moi_toi_to_sua_chua(client):
    db = SessionLocal()
    try:
        m = MayThietBi(ma="MAY-CHAM", ten="Máy chấm", loai_may="Bế")
        db.add(m)
        db.commit()
        may_id = m.id
    finally:
        db.close()
    tao_nguoi("tho_sua", {"ky_thuat_may": dict(can_read=True, can_update=True, scope=SCOPE_ALL)})
    tao_nguoi("nguoi_bao", {"ky_thuat_may": dict(can_read=True, can_request=True, scope=SCOPE_OWN)})
    hb = dang_nhap(client, "nguoi_bao")
    r = client.post("/api/ky-thuat-may/yeu-cau", json={"may_id": may_id, "bo_phan_hong": "Dao bế"},
                    headers=hb)
    assert r.status_code == 201, r.text
    tt = tom_tat(client, dang_nhap(client, "tho_sua"))
    assert tt["ky_thuat_may"]["loai"] == "bao_hong_moi"
    assert "ky_thuat_may" not in tom_tat(client, hb)

