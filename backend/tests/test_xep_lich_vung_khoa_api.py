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
# Luật đè vùng khoá CHỈ cảnh báo, không chặn — chủ hạ mức 21/08/2026 (`constraint.de_vung_khoa_may`):
# bản khai tay còn thưa, chặn cứng thì bịt khe của máy đang chạy tốt. Nên ở đây soi CÂU nhắc.
def _lenh_tren_may(mid: int) -> int:
    from app.models.lsx import TT_SAN_SANG, Lsx, LsxCongDoan

    db = SessionLocal()
    try:
        l = Lsx(ma="LSX-VK-1", ten="Lệnh thử khoá máy", order_id=1, order_line_id=1,
                trang_thai=TT_SAN_SANG, so_luong_dat=1000, so_to_ke_hoach=2500)
        db.add(l)
        db.flush()
        db.add(LsxCongDoan(lsx_id=l.id, thu_tu=1, ten="In", nhom="print", loai_buoc="may",
                           may_id=mid, so_luong_vao=2500, don_vi_vao="to", don_vi_ra="to"))
        db.commit()
        return l.id
    finally:
        db.close()


def _dong(client, h, lid: int) -> dict:
    body = client.get(f"{GOC}/lich?tu=2026-09-07&den=2026-09-20", headers=h).json()
    return next(d for d in body["dong"] if d["lsx_id"] == lid)


def test_thanh_lenh_canh_bao_khi_de_vung_khoa_may(client):
    h, mid = _hd(client), _may()
    lid = _lenh_tren_may(mid)
    assert client.put(f"{GOC}/lenh/{lid}", json={"bat_dau_at": "2026-09-11T08:00:00"},
                      headers=h).status_code == 200
    assert _dong(client, h, lid)["canh_bao_may"] == []
    client.post(f"{GOC}/may/{mid}/vung-khoa", headers=h, json={
        "tu": "2026-09-11T07:00:00", "den": "2026-09-11T12:00:00", "ly_do": "bao_tri"})
    canh = _dong(client, h, lid)["canh_bao_may"]
    assert len(canh) == 1 and "Máy in 4 màu" in canh[0] and "bảo trì" in canh[0]


def test_vung_khoa_ngoai_khoang_chay_thi_khong_canh_bao(client):
    h, mid = _hd(client), _may()
    lid = _lenh_tren_may(mid)
    client.put(f"{GOC}/lenh/{lid}", json={"bat_dau_at": "2026-09-11T08:00:00"}, headers=h)
    client.post(f"{GOC}/may/{mid}/vung-khoa", headers=h, json={
        "tu": "2026-09-18T07:00:00", "den": "2026-09-18T12:00:00", "ly_do": "bao_tri"})
    assert _dong(client, h, lid)["canh_bao_may"] == []


def test_thanh_lenh_canh_bao_khi_may_dung_cho_sua(client):
    from app.models.ky_thuat_may import TT_YC_CHO_TIEP_NHAN, YeuCauSuaChua

    h, mid = _hd(client), _may()
    lid = _lenh_tren_may(mid)
    client.put(f"{GOC}/lenh/{lid}", json={"bat_dau_at": "2026-09-11T08:00:00"}, headers=h)
    db = SessionLocal()
    try:
        db.add(YeuCauSuaChua(ma="YC-VK-1", may_id=mid, bo_phan_hong="Cụm cấp giấy",
                             muc_do="cao", may_dung=True, trang_thai=TT_YC_CHO_TIEP_NHAN))
        db.commit()
    finally:
        db.close()
    canh = _dong(client, h, lid)["canh_bao_may"]
    assert len(canh) == 1 and "dừng chờ sửa" in canh[0] and "YC-VK-1" in canh[0]


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


def test_buoc_da_xong_tren_may_khong_canh_bao_may(client, monkeypatch):
    """#79 (bấm lại 19/10/2026): LSX26-0016 xong bước In 18/10 vẫn ghi "máy dừng chờ sửa" — cảnh báo
    máy chỉ dành cho bước CÒN phải chạy trên máy đó."""
    from app.models.ky_thuat_may import TT_YC_CHO_TIEP_NHAN, YeuCauSuaChua
    from app.models.lsx import LsxCongDoan
    from app.models.san_xuat import CV_HOAN_THANH
    from app.repositories.xep_lich_lenh_repo import XepLichLenhRepository

    h, mid = _hd(client), _may()
    lid = _lenh_tren_may(mid)
    client.put(f"{GOC}/lenh/{lid}", json={"bat_dau_at": "2026-09-11T08:00:00"}, headers=h)
    db = SessionLocal()
    try:
        cd_id = db.query(LsxCongDoan.id).filter(LsxCongDoan.lsx_id == lid).scalar()
        db.add(YeuCauSuaChua(ma="YC-VK-2", may_id=mid, bo_phan_hong="Cụm cấp giấy",
                             muc_do="cao", may_dung=True, trang_thai=TT_YC_CHO_TIEP_NHAN))
        db.commit()
    finally:
        db.close()
    xong = datetime(2026, 9, 11, 10, 0)
    monkeypatch.setattr(
        XepLichLenhRepository, "thuc_te_buoc",
        lambda self, ids: {lid: [(cd_id, None, CV_HOAN_THANH, None, None, xong, xong - timedelta(hours=2))]}
        if lid in ids else {})
    assert _dong(client, h, lid)["canh_bao_may"] == []
