"""Giấy chọn ở bước phiếu tính giá chảy xuống ĐÚNG bước lệnh sản xuất (18/10/2026).

"Thiếu giấy" của lệnh = không công đoạn nào có dòng giấy — bước nào cũng được, không riêng In.
"""
from __future__ import annotations

from app.models.cong_doan import CongDoan
from app.models.phieu_tinh_gia import PhieuBuocVatTu, PhieuThanhPhan, PhieuThanhPham, PhieuTinhGia
from app.models.vat_lieu_kho import GiayNguyen
from tests.test_lsx_service import (  # noqa: F401 — fixture dùng chung
    _don_da_chuyen_sx, _may_in, _to_san_xuat, admin, customer, db, lsx_svc, orders,
)


def _ptg(db, *, giay_o: str | None) -> PhieuTinhGia:
    """Tờ rơi: In → Cán (đều nhận tờ in). `giay_o` = tên bước mang dòng giấy, None = không giấy."""
    giay = GiayNguyen(don_vi_them=["to"], ma=f"G-{giay_o}", ten="Couche 150", gsm=150,
                      don_gia=2_000, don_vi_gia="to")
    db.add(giay)
    to_id = _to_san_xuat(db).id
    may = _may_in(db)
    cds = [
        CongDoan(ma=f"CD-IN-{giay_o}", ten="In offset", nhom="print",
                 cong_thuc_gia="so_luong * don_gia", department_ids=[to_id],
                 don_vi_vao="to", don_vi_ra="to"),
        CongDoan(ma=f"CD-CAN-{giay_o}", ten="Cán màng", nhom="finishing",
                 cong_thuc_gia="so_luong * don_gia", department_ids=[to_id],
                 don_vi_vao="to", don_vi_ra="to"),
    ]
    db.add_all(cds)
    db.flush()
    p = PhieuTinhGia(ma=f"PTG-GIAY-{giay_o}", ten_san_pham="Tờ rơi", so_luong=5_000)
    tp = PhieuThanhPhan(
        thu_tu=0, ten="Tờ rơi A4", so_luong=5_000, dai_thanh_pham=210, rong_thanh_pham=297,
        kho_nguyen_dai=1090, kho_nguyen_rong=790, kho_in_dai=545, kho_in_rong=790,
        so_mau_a=4, so_mau_b=4, quy_cach_in="hai_mat", may_id=may.id,
        # Bỏ trống `giay_id` để lệnh chỉ còn dòng giấy ở bước làm bằng chứng "có giấy".
        giay_id=None,
    )
    for i, cd in enumerate(cds):
        b = PhieuThanhPham(thu_tu=i, cong_doan_id=cd.id, ten=cd.ten, don_gia=50)
        if giay_o and cd.ten.startswith(giay_o):
            b.vat_tus.append(PhieuBuocVatTu(thu_tu=0, hang_loai="giay", vat_tu_id=giay.id))
        tp.thanh_phams.append(b)
    p.thanh_phans.append(tp)
    db.add(p)
    db.commit()
    return p


def _tao_lenh(db, orders, lsx_svc, admin, customer, ptg):
    d = _don_da_chuyen_sx(db, orders, admin, customer, ptg)
    return lsx_svc.tao(order_id=d.id, order_line_ids=[ln.id for ln in d.lines], actor=admin)[0]


def _giay_cua(lsx) -> dict[str, list]:
    return {cd.ten: [v for v in cd.vat_tus if v.hang_loai == "giay"]
            for cd in sorted(lsx.cong_doans, key=lambda c: c.thu_tu)}


def test_giay_o_buoc_in_xuong_buoc_in_cua_lenh_kem_so_to(db, orders, lsx_svc, admin, customer):
    lsx = _tao_lenh(db, orders, lsx_svc, admin, customer, _ptg(db, giay_o="In"))
    giay = _giay_cua(lsx)
    assert giay["Cán màng"] == []
    (g,) = giay["In offset"]
    assert float(g.so_luong) > 0 and g.tu_dong is False
    assert "thieu_giay" not in lsx_svc.thieu_cua(lsx)


def test_giay_chi_o_buoc_can_van_khong_thieu_giay(db, orders, lsx_svc, admin, customer):
    lsx = _tao_lenh(db, orders, lsx_svc, admin, customer, _ptg(db, giay_o="Cán"))
    assert len(_giay_cua(lsx)["Cán màng"]) == 1
    assert "thieu_giay" not in lsx_svc.thieu_cua(lsx)


def test_quy_cach_lenh_khong_xep_giay_vao_vat_tu_khac(db, orders, lsx_svc, admin, customer):
    """Giấy là NVL chính: khối "Vật tư khác" của quy cách lệnh chỉ còn mực/màng/keo."""
    lsx = _tao_lenh(db, orders, lsx_svc, admin, customer, _ptg(db, giay_o="In"))
    assert [v["ten"] for v in lsx.quy_cach_json["vat_tus"]] == []


def test_phieu_khong_giay_thi_lenh_thieu_giay(db, orders, lsx_svc, admin, customer):
    lsx = _tao_lenh(db, orders, lsx_svc, admin, customer, _ptg(db, giay_o=None))
    assert "thieu_giay" in lsx_svc.thieu_cua(lsx)
