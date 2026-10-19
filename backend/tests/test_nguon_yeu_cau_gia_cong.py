"""Yêu cầu nhập của gia công trọn gói có nguồn "gia công", không phải KCS (lỗi #41, 18/10/2026).

Yêu cầu nhập do chốt gia công về kho cũng mang `san_xuat_cong_viec_id` (công việc thuê ngoài), nên
bộ lọc Nguồn xếp nó vào "KCS" (KCS đứng trước gia công trong thứ tự ưu tiên) và ô Nguồn hiện "KCS
LSX…", dù hàng do nhà gia công giao về, KCS không kiểm.
"""
from __future__ import annotations

from app.models.gia_cong_ngoai import NOI_VE_KHO
from app.models.stock_request import REQ_NHAP, StockRequest
from app.repositories.stock_request_repo import StockRequestRepository
from app.services.gia_cong_ngoai.chot import chot
from tests.test_gia_cong_tron_goi import _dat, lenh  # noqa: F401
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401


def test_yeu_cau_nhap_gia_cong_loc_vao_nguon_gia_cong(sess, admin, lenh):
    lan = _dat(sess, admin, lenh)
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
         sl_cuoi=19_800, noi_ve=NOI_VE_KHO)
    req = sess.query(StockRequest).filter_by(gia_cong_ngoai_id=lan.id, loai=REQ_NHAP).one()
    repo = StockRequestRepository(sess)
    gia_cong, _ = repo.list(nguon=["gia_cong"])
    kcs, _ = repo.list(nguon=["kcs"])
    assert req.id in [r.id for r in gia_cong]
    assert req.id not in [r.id for r in kcs]
