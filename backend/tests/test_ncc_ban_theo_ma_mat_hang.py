"""Lưu đơn mua: "NCC có bán món này không" khớp theo MẶT HÀNG GỐC, không chỉ theo tên (14/10/2026).

Danh mục giấy đổi tên "IVORY 210-230" thành "IVORY 210--230" còn bảng giá NCC giữ tên cũ ⇒ form cho
chọn NCC (khớp theo mã) mà bấm Lưu bị máy chủ báo "Nhà cung cấp này không bán" (khớp theo tên).
"""
import pytest

from app.models.purchase import Supplier, SupplierItem
from app.repositories.purchase_repo import SupplierRepository
from tests.conftest import phien_da_seed


@pytest.fixture
def db():
    yield from phien_da_seed()


def _ncc(db, **item) -> int:
    ncc = Supplier(name="NCC khớp mã", status="active")
    db.add(ncc)
    db.flush()
    db.add(SupplierItem(supplier_id=ncc.id, unit="kg", unit_price=24_500, vat_percent=8, **item))
    db.commit()
    return ncc.id


def test_khop_theo_ma_du_ten_lech(db):
    nid = _ncc(db, item_name="GIẤY IVORY 210-230-250GSM", hang_loai="giay", hang_id=5)
    repo = SupplierRepository(db)
    assert repo.supplier_sells(nid, "GIẤY IVORY 210--230-250GSM", hang_loai="giay", hang_id=5)
    # Mã khác, tên lệch ⇒ không bán.
    assert not repo.supplier_sells(nid, "GIẤY IVORY 210--230-250GSM", hang_loai="giay", hang_id=6)
    # Dòng không có mã ⇒ vẫn so tên như cũ.
    assert not repo.supplier_sells(nid, "GIẤY IVORY 210--230-250GSM")


def test_dong_gia_chua_gan_ma_van_khop_ten(db):
    nid = _ncc(db, item_name="Mực in đen")
    repo = SupplierRepository(db)
    assert repo.supplier_sells(nid, "Mực in đen", hang_loai="vat_tu", hang_id=3)


def test_dong_gia_ngung_ban_khong_khop(db):
    nid = _ncc(db, item_name="GIẤY X", hang_loai="giay", hang_id=5, is_active=False)
    assert not SupplierRepository(db).supplier_sells(nid, "GIẤY Y", hang_loai="giay", hang_id=5)
