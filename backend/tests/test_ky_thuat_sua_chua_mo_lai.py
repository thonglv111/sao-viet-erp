"""Phiếu sửa chữa: dòng "Từ yêu cầu" sau Lưu / đổi trạng thái (lỗi #30) và mở lại phiếu đã sửa
xong kèm lý do (lỗi #51) — bấm thử E2E 18/10/2026.

#30: PUT `/sua-chua/{id}` và `/trang-thai` dựng dòng trả về thiếu `yeu_cau_map`, nên ngăn phiếu đổi
"YC-0009 Ban giám đốc" thành "không có" tới khi tải lại.
#51: máy chủ cho mở lại nhưng giao diện không có nút; mở lại là đảo một lần đóng phiếu nên phải để
vết vì sao (sửa chưa đạt, máy hỏng lại) — không thì chỉ còn đường lập phiếu mới, đứt mạch lịch sử.
"""
from __future__ import annotations

import pytest

from app.models.ky_thuat_may import LOAI_PHIEU_SUA_CHUA, TT_SC_CHO_SUA, TT_SC_DA_SUA_XONG
from app.models.audit import AuditLog
from app.repositories.audit_repo import AuditLogRepository
from app.repositories.ky_thuat_may_repo import KyThuatMayRepository
from app.services.ky_thuat_may_service import KyThuatMayService, KyThuatMayValidationError
from tests.test_ky_thuat_may import _anh_sau, _headers, _may, _svc


def _phieu_tu_yeu_cau(client, h) -> dict:
    may = client.post("/api/may-thiet-bi", json={"ma": "IN-30", "ten": "Máy in 4 màu",
                                                "loai_may": "In offset"}, headers=h).json()
    yc = client.post("/api/ky-thuat-may/yeu-cau", json={"may_id": may["id"], "mo_ta": "Kẹt giấy",
                                                        "may_dung": True}, headers=h)
    assert yc.status_code == 201, yc.text
    r = client.post(f"/api/ky-thuat-may/yeu-cau/{yc.json()['id']}/tao-phieu", json={}, headers=h)
    assert r.status_code == 201, r.text
    phieu = r.json()["phieu"]
    assert phieu["yeu_cau_ma"] == yc.json()["ma"]
    return phieu


def test_luu_phieu_van_giu_dong_tu_yeu_cau(client):
    h = _headers(client)
    phieu = _phieu_tu_yeu_cau(client, h)
    r = client.put(f"/api/ky-thuat-may/sua-chua/{phieu['id']}",
                   json={"nguyen_nhan_phuong_an": "Thay bạc đạn"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["yeu_cau_ma"] == phieu["yeu_cau_ma"]


def test_doi_trang_thai_van_giu_dong_tu_yeu_cau(client):
    h = _headers(client)
    phieu = _phieu_tu_yeu_cau(client, h)
    r = client.post(f"/api/ky-thuat-may/sua-chua/{phieu['id']}/trang-thai",
                    json={"trang_thai": TT_SC_CHO_SUA}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["yeu_cau_ma"] == phieu["yeu_cau_ma"]


def _dong_phieu():
    db, _ = _svc()
    svc = KyThuatMayService(db, KyThuatMayRepository(db), AuditLogRepository(db))
    may = _may(db, ma="CAN-51")
    phieu = svc.tao_sua_chua({"may_id": may.id, "bo_phan_hong": "Trục cán"})
    _anh_sau(svc, LOAI_PHIEU_SUA_CHUA, phieu.id)
    svc.doi_trang_thai_sua_chua(phieu.id, TT_SC_DA_SUA_XONG)
    return db, svc, phieu


def test_mo_lai_phieu_da_sua_xong_bat_buoc_ly_do():
    _db, svc, phieu = _dong_phieu()
    with pytest.raises(KyThuatMayValidationError, match="lý do"):
        svc.doi_trang_thai_sua_chua(phieu.id, TT_SC_CHO_SUA)
    with pytest.raises(KyThuatMayValidationError, match="lý do"):
        svc.doi_trang_thai_sua_chua(phieu.id, TT_SC_CHO_SUA, ly_do="  ")


def test_mo_lai_co_ly_do_thi_ghi_vao_nhat_ky():
    db, svc, phieu = _dong_phieu()
    phieu = svc.doi_trang_thai_sua_chua(phieu.id, TT_SC_CHO_SUA, ly_do="Máy kẹt lại sau 2 giờ")
    assert phieu.trang_thai == TT_SC_CHO_SUA
    vet = [a.detail for a in db.query(AuditLog).all()]
    assert any("Máy kẹt lại sau 2 giờ" in (d or "") for d in vet)


def test_api_mo_lai_nhan_ly_do(client):
    h = _headers(client)
    phieu = _phieu_tu_yeu_cau(client, h)
    r = client.post(f"/api/ky-thuat-may/sua-chua/{phieu['id']}/trang-thai",
                    json={"trang_thai": TT_SC_CHO_SUA, "ly_do": "Sửa chưa đạt"}, headers=h)
    assert r.status_code == 200, r.text
