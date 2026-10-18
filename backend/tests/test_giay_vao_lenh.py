"""Giấy của phiếu tính giá vào lệnh (lỗi #18 bấm thử E2E 18/10/2026).

Từ 08/09/2026 giấy chỉ vào lệnh qua DÒNG VẬT TƯ của bước (`hang_loai='giay'`), mà lúc tạo lệnh từ
phiếu không ai chép giấy sang bước. Lệnh vẫn lên được Sẵn sàng vì cửa chỉ hỏi quy cách có `giay_id`,
và Kế hoạch vật tư bỏ sót cả lệnh: không dòng "Cần mua", không ai mua giấy.
"""
from __future__ import annotations

from app.models.lsx import TT_SAN_SANG
from app.models.vat_lieu_kho import HANG_GIAY
from app.repositories.bai_ghep_repo import BaiGhepRepository
from app.repositories.don_vi_do_repo import DonViDoRepository
from app.repositories.lsx_repo import LsxRepository
from app.repositories.purchase_repo import PurchaseRequestRepository, SupplierRepository
from app.repositories.stock_lot_repo import StockLotRepository
from app.repositories.stock_request_repo import StockRequestRepository
from app.repositories.vat_lieu_kho_repo import VatLieuKhoRepository
from app.services.ke_hoach_vat_tu_service import KeHoachVatTuService
from app.services.vat_lieu_kho_service import VatLieuKhoService

from tests.test_lsx_service import _don_da_chuyen_sx, _ptg_2_san_pham  # noqa: F401
from tests.test_san_xuat_thuc_thi import admin, customer, db, lsx_svc, orders  # noqa: F401


def _lenh_hop(db, orders, lsx_svc, admin, customer):
    ptg = _ptg_2_san_pham(db)
    d = _don_da_chuyen_sx(db, orders, admin, customer, ptg)
    ids = [l["order_line_id"] for l in lsx_svc.preview(d.id)["lines"]]
    return lsx_svc.tao(order_id=d.id, order_line_ids=ids[:1], actor=admin)[0]


def _giay_cua(lsx):
    return [(cd, v) for cd in lsx.cong_doans for v in cd.vat_tus if v.hang_loai == HANG_GIAY]


def test_tao_lenh_tu_phieu_chep_giay_vao_buoc_in(db, orders, lsx_svc, admin, customer):
    hop = lsx_svc.get(_lenh_hop(db, orders, lsx_svc, admin, customer).id)
    giay = _giay_cua(hop)
    assert len(giay) == 1
    cd, v = giay[0]
    assert cd.nhom == "print"
    assert v.vat_tu_id == hop.quy_cach_json["giay_id"]
    # Số tờ = đầu vào của bước In, khổ = khổ của dòng giấy suy từ quy cách — không phải 0 tạm.
    assert float(v.so_luong) == float(cd.so_luong_vao) > 0
    assert v.kho_rong > 0 and v.kho_dai > 0


def test_san_sang_chan_khi_quy_cach_co_giay_ma_khong_buoc_nao_mang_giay(
        db, orders, lsx_svc, admin, customer):
    hop = lsx_svc.get(_lenh_hop(db, orders, lsx_svc, admin, customer).id)
    assert "thieu_giay" not in lsx_svc.thieu_cua(hop)
    for cd, v in _giay_cua(hop):
        cd.vat_tus.remove(v)
    db.commit()
    assert "thieu_giay" in lsx_svc.thieu_cua(lsx_svc.get(hop.id))


def test_ke_hoach_vat_tu_ra_dong_can_mua_giay(db, orders, lsx_svc, admin, customer):
    hop = lsx_svc.get(_lenh_hop(db, orders, lsx_svc, admin, customer).id)
    hop.trang_thai = TT_SAN_SANG
    db.commit()
    svc = KeHoachVatTuService(
        db, lsx_repo=LsxRepository(db), bai_ghep_repo=BaiGhepRepository(db),
        hang=VatLieuKhoService(VatLieuKhoRepository(db), DonViDoRepository(db)),
        lots=StockLotRepository(db), requests=StockRequestRepository(db),
        purchases=PurchaseRequestRepository(db), suppliers=SupplierRepository(db),
        don_vi=DonViDoRepository(db))
    nhom = [g for g in svc.can_doi()["items"]
            if (g["hang_loai"], g["hang_id"]) == (HANG_GIAY, hop.quy_cach_json["giay_id"])]
    assert nhom and nhom[0]["tong_can"] > 0
    assert any(d["lsx_id"] == hop.id for d in nhom[0]["dong"])
