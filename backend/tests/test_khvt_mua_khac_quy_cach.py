"""Kế hoạch vật tư: lệnh đã có đơn "Mua cho" khác khổ/ĐVT (lỗi #23 bấm thử E2E 18/10/2026).

Cân đối số giữ luật khớp 5 phần (tờ và kg không quy đổi), nhưng liên kết "đơn này mua cho lệnh
này" không được mất: dòng nhu cầu của lệnh phải nói "Đã mua khác quy cách: <mã> <SL> <ĐVT> <khổ>"
để người lập kế hoạch không đề nghị mua lần hai.
"""
from __future__ import annotations

from app.models.purchase import (
    DPR_OPEN, SOURCE_SAN_XUAT, DepartmentPurchaseRequest, DepartmentPurchaseRequestLine,
    YeuCauMuaNguonLenh,
)
from tests.test_ke_hoach_vat_tu import (  # noqa: F401
    KHO, MAI, _giay, _kho_dong, _lenh, _nhom, customer, db, svc,
)
from tests.test_mot_o_mot_phieu import _don_tu


def _yc_khac_kho(db, g, lenh):
    """Cần tờ khổ KHO cho lệnh, Thu mua đổi sang mua 47 kg khổ 650 × 860 — vẫn "Mua cho" lệnh."""
    yc = DepartmentPurchaseRequest(code="YCMH-ZJK2", status=DPR_OPEN, source_type=SOURCE_SAN_XUAT,
                                   purpose="Thiếu giấy", needed_date=MAI)
    db.add(yc)
    db.flush()
    ln = DepartmentPurchaseRequestLine(
        department_request_id=yc.id, item_name="Giấy", hang_loai="giay", hang_id=g.id,
        unit="kg", quantity=47, kho_rong=650, kho_dai=860)
    db.add(ln)
    kr, kd = _kho_dong(("giay", g.id), KHO)
    db.add(YeuCauMuaNguonLenh(department_request_id=yc.id, hang_loai="giay", hang_id=g.id,
                              kho_rong=kr, kho_dai=kd, lsx_id=lenh.id, so_luong=1_000))
    db.commit()
    return ln


def test_dong_cua_lenh_hien_don_mua_khac_quy_cach(db, svc, customer):
    g = _giay(db)
    l = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    ln = _yc_khac_kho(db, g, l)
    p, _pl = _don_tu(db, ln, 47)

    dong = next(d for d in _nhom(svc.can_doi(), g)["dong"] if d["lsx_id"] == l.id)
    assert dong["mua_khac_quy_cach"] == [{
        "ma": p.code, "so_luong": 47.0, "don_vi": "kg", "kho_rong": 650, "kho_dai": 860}]
    # Số cân đối giữ nguyên luật khớp 5 phần: kg không bù cho nhu cầu tờ.
    assert dong["thieu"] > 0


def test_lenh_khac_khong_dinh_don_mua_khac_quy_cach(db, svc, customer):
    g = _giay(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    b = _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=500, han=MAI)
    _don_tu(db, _yc_khac_kho(db, g, a), 47)
    dong = {d["lsx_id"]: d for d in _nhom(svc.can_doi(), g)["dong"]}
    assert dong[b.id]["mua_khac_quy_cach"] == []


def test_luoi_o_cua_lenh_khoa_de_nghi_mua_khi_da_mua_khac_quy_cach(db, svc, customer):
    from tests.test_mot_o_mot_phieu import _luoi, _o

    g = _giay(db)
    l = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    p, _pl = _don_tu(db, _yc_khac_kho(db, g, l), 47)
    o = _o(_luoi(db, svc), l, g)
    assert o["mua_khac_quy_cach"] == [{
        "ma": p.code, "so_luong": 47.0, "don_vi": "kg", "kho_rong": 650, "kho_dai": 860}]
    assert o["khoa_mua"] == []          # không gửi được đề nghị mua lần hai
    # Schema trả về giữ field (Pydantic không nuốt im lặng).
    from app.schemas.ke_hoach_vat_tu import LuoiDong
    assert LuoiDong.model_validate(o).mua_khac_quy_cach[0].ma == p.code


def test_don_khac_quy_cach_da_nhan_du_thi_mo_lai_de_nghi_mua(db, svc, customer):
    """Đơn khác khổ đã nhận đủ (rà cuối 19/10/2026): hàng đó không bù được cho lệnh, mạch đã xong
    nên không còn ai đang mua cho ô này ⇒ người lập kế hoạch phải đề nghị mua đúng khổ được, không
    kẹt ở câu "đã mua khác quy cách" mãi."""
    from app.models.purchase import PR_RECEIVED
    from tests.test_mot_o_mot_phieu import _luoi, _o

    g = _giay(db)
    l = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    _p, pl = _don_tu(db, _yc_khac_kho(db, g, l), 47, status=PR_RECEIVED)
    pl.received_quantity = 47
    db.commit()
    o = _o(_luoi(db, svc), l, g)
    assert o["mua_khac_quy_cach"] == []
    assert o["khoa_mua"] != []
