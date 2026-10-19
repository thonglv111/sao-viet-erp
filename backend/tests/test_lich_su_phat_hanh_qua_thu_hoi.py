"""Tab "Lịch sử phát hành" giữ cả gói đã thu hồi (lỗi #25 bấm thử E2E 18/10/2026).

Thu hồi (bắt buộc lý do "để đối chiếu sau") rồi phát hành lại thì tab về "Phiên bản 1, Không ghi
lý do": `thong_tin_goi` chỉ đọc gói đang sống, lần phát hành trước và lý do thu hồi chỉ còn trong
Nhật ký hệ thống.
"""
from __future__ import annotations

from datetime import datetime

from tests.test_xep_lich_lenh_service import (  # noqa: F401
    _svc_moi, admin, customer, db, lenh, lsx_svc, orders, svc3,
)


def test_thu_hoi_roi_phat_hanh_lai_van_thay_goi_cu_kem_ly_do(db, svc3, lenh, admin):
    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    svc3.phat_hanh(lenh.id, actor=admin)
    ma_cu = _svc_moi(db).goi_phat_hanh(lenh.id)["ma"]
    _svc_moi(db).thu_hoi(lenh.id, actor=admin, ly_do="khách đổi quy cách tờ in")

    g = _svc_moi(db).goi_phat_hanh(lenh.id)
    assert g["co_goi"] is False
    assert [x["ma"] for x in g["lich_su_goi"]] == [ma_cu]
    cu = g["lich_su_goi"][0]
    assert cu["trang_thai"] == "da_thu_hoi"
    assert cu["thu_hoi_ly_do"] == "khách đổi quy cách tờ in" and cu["thu_hoi_luc"]
    assert [p["so"] for p in cu["phien_bans"]] == [1]

    _svc_moi(db).dat_moc(lenh.id, datetime(2026, 9, 12, 8, 0))
    _svc_moi(db).phat_hanh(lenh.id, actor=admin)
    g = _svc_moi(db).goi_phat_hanh(lenh.id)
    assert g["co_goi"] is True and g["ma"] != ma_cu
    # Mới nhất trước — gói đang sống đứng đầu, gói cũ vẫn còn với lý do thu hồi của nó.
    assert [x["ma"] for x in g["lich_su_goi"]] == [g["ma"], ma_cu]
    assert g["lich_su_goi"][0]["thu_hoi_ly_do"] is None
    assert g["lich_su_goi"][1]["thu_hoi_ly_do"] == "khách đổi quy cách tờ in"
