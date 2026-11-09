"""Khai vùng khoá máy ở Xếp lịch (lỗi #50 bấm thử E2E 18/10/2026).

Route `/vung-khoa` mất từ lúc gỡ bàn theo công đoạn (20/08/2026): lịch bảo trì không đặt được, nhãn
"Đang bảo trì" không bao giờ hiện, lệnh vẫn xếp vào giờ máy dừng. Service `tao_vung_khoa` còn nguyên,
chỉ thiếu cửa vào.
"""
from __future__ import annotations

import ast
import inspect as _inspect
from datetime import datetime, timedelta

from app.db import SessionLocal
from app.models.may_thiet_bi import MayThietBi
from app.services.may_trang_thai import trang_thai_may
from tests.test_xep_lich_lenh_api import GOC, _hd


def _may() -> int:
    db = SessionLocal()
    try:
        m = MayThietBi(ma="MAY-VK-1", ten="Máy in 4 màu", loai_may="press_offset_sheet",
                       toc_do=5_000, don_vi_toc_do="to_gio")
        db.add(m)
        db.commit()
        return m.id
    finally:
        db.close()


def test_tao_xem_xoa_vung_khoa_qua_route(client):
    h, mid = _hd(client), _may()
    # Giờ TƯỜNG của xưởng, không múi — đúng cái ô `datetime-local` của FE gửi lên.
    bay_gio = datetime.now().replace(microsecond=0)
    body = {"tu": (bay_gio - timedelta(hours=1)).isoformat(),
            "den": (bay_gio + timedelta(hours=3)).isoformat(), "ly_do": "bao_tri", "note": "Thay lô"}
    r = client.post(f"{GOC}/may/{mid}/vung-khoa", json=body, headers=h)
    assert r.status_code == 200, r.text
    vk = r.json()
    assert vk["may_id"] == mid and vk["ly_do"] == "bao_tri"

    ds = client.get(f"{GOC}/may/{mid}/vung-khoa", headers=h).json()
    assert [x["id"] for x in ds] == [vk["id"]]

    db = SessionLocal()
    try:
        assert trang_thai_may(db, [mid])[mid]["nhan"] == "Đang bảo trì"
    finally:
        db.close()

    assert client.delete(f"{GOC}/vung-khoa/{vk['id']}", headers=h).status_code == 200
    assert client.get(f"{GOC}/may/{mid}/vung-khoa", headers=h).json() == []


def test_vung_khoa_tu_sau_den_bi_400(client):
    h, mid = _hd(client), _may()
    t = datetime.now().replace(microsecond=0)
    r = client.post(f"{GOC}/may/{mid}/vung-khoa", headers=h, json={
        "tu": t.isoformat(), "den": (t - timedelta(hours=1)).isoformat(), "ly_do": "bao_tri"})
    assert r.status_code == 400


def test_route_ghi_vung_khoa_day_sse():
    from app.routers import xep_lich as r

    cay = ast.parse(_inspect.getsource(r))
    ghi = {"tao_vung_khoa", "xoa_vung_khoa"}
    thay = {n.name for n in ast.walk(cay)
            if isinstance(n, ast.FunctionDef) and n.name in ghi and "_phat_lich_doi_may(" in ast.unparse(n)}
    assert thay == ghi


# ------------------------------------------------- cảnh báo trên thanh lệnh (#50, #27)


def test_danh_sach_may_cho_hop_khoa_may_chi_may_con_dung(client):
    h, mid = _hd(client), _may()
    db = SessionLocal()
    try:
        db.add(MayThietBi(ma="MAY-VK-CU", ten="Máy đã thanh lý", loai_may="press_offset_sheet",
                          active=False))
        db.commit()
    finally:
        db.close()
    ds = client.get(f"{GOC}/may", headers=h).json()
    assert {"id": mid, "ma": "MAY-VK-1", "ten": "Máy in 4 màu"} in ds
    assert "MAY-VK-CU" not in [m["ma"] for m in ds]


