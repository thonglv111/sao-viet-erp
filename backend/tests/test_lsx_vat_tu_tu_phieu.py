"""Lệnh sản xuất lấy vật tư + chip từ phiếu tính giá, định mức tính bằng công thức của vật tư."""
from __future__ import annotations

import pytest

from tests.test_lsx_service import (  # noqa: F401 — fixture + helper dùng chung
    _don_da_chuyen_sx,
    _ptg_2_san_pham,
    admin,
    customer,
    db,
    lsx_svc,
    orders,
)

from app.models.cong_doan import CongDoan, CongDoanVatTu
from app.models.don_vi_do import DonViDo
from app.models.phieu_tinh_gia import PhieuBuocVatTu
from app.models.vat_lieu_kho import VatTuChip, VatTuInAn
from app.schemas.lsx import LsxCongDoanIn
from app.services.bien_cong_thuc import quy_cach_bien

CT_DAI_RONG = "dai_support * rong_support / 1000000"


def _support(db, *, cong_thuc=CT_DAI_RONG) -> VatTuInAn:
    db.add(DonViDo(ma="m2_sup", ten="m² support"))
    vt = VatTuInAn(ma="SUP-T", ten="Support", don_vi_gia="m2_sup", don_gia=1_000,
                   cong_thuc_dinh_muc=cong_thuc)
    vt.chips = [
        VatTuChip(ma="dai_support", ten="Dài support", don_vi="mm", thu_tu=0),
        VatTuChip(ma="rong_support", ten="Rộng support", don_vi="mm", thu_tu=1),
    ]
    db.add(vt)
    db.flush()
    return vt


def _gan_vao_buoc_phieu(db, ptg, ten_buoc: str, vt: VatTuInAn, chip: dict) -> None:
    hop = ptg.thanh_phans[0]
    buoc = next(f for f in hop.thanh_phams if f.ten == ten_buoc)
    buoc.vat_tus.append(PhieuBuocVatTu(vat_tu_id=vt.id, thu_tu=0, gia_tri_chip=chip))
    db.commit()


def _tao_lenh_hop(db, orders, lsx_svc, admin, customer, ptg):
    d = _don_da_chuyen_sx(db, orders, admin, customer, ptg)
    line = lsx_svc.preview(d.id)["lines"][0]
    created = lsx_svc.tao(order_id=d.id, order_line_ids=[line["order_line_id"]], actor=admin)
    return lsx_svc.get(created[0].id)


def _buoc(lsx, ten="Dán hộp"):
    return next(c for c in lsx.cong_doans if c.ten == ten)


def test_tao_lenh_bung_vat_tu_cua_buoc_voi_chip_tu_phieu(db, orders, lsx_svc, admin, customer):
    ptg = _ptg_2_san_pham(db)
    vt = _support(db)
    _gan_vao_buoc_phieu(db, ptg, "Dán hộp", vt, {"dai_support": 500, "rong_support": 400})

    lsx = _tao_lenh_hop(db, orders, lsx_svc, admin, customer, ptg)

    buoc = _buoc(lsx)
    assert [v.vat_tu_id for v in buoc.vat_tus] == [vt.id]
    v = buoc.vat_tus[0]
    assert v.gia_tri_chip == {"dai_support": 500, "rong_support": 400}
    assert float(v.so_luong) == pytest.approx(0.2)            # 500 × 400 / 1_000_000
    assert v.tu_dong is True
    # Bước khác chỉ còn dòng GIẤY máy gắn ở bước đầu khâu chuẩn bị (spec 2026-10-24-chuan-bi-giay §7).
    assert all(v.hang_loai == "giay" for c in lsx.cong_doans if c.ten != "Dán hộp" for v in c.vat_tus)


def test_phieu_khong_gan_vat_tu_thi_lenh_khong_bung_tu_danh_muc_cong_doan(
    db, orders, lsx_svc, admin, customer,
):
    """Phiếu là nơi CHỐT vật tư của bước: danh mục công đoạn có Support nhưng phiếu đã xoá thì lệnh
    KHÔNG tự đẻ lại."""
    ptg = _ptg_2_san_pham(db)
    vt = _support(db)
    cd_dan = db.query(CongDoan).filter(CongDoan.ma == "CD-DAN-T").one()
    cd_dan.vat_tus.append(CongDoanVatTu(vat_tu_id=vt.id, thu_tu=0))
    db.commit()

    lsx = _tao_lenh_hop(db, orders, lsx_svc, admin, customer, ptg)

    assert _buoc(lsx).vat_tus == []


def test_cong_thuc_dung_sl_vao_thi_doi_so_luong_la_doi_dinh_muc_va_chip_giu_nguyen(
    db, orders, lsx_svc, admin, customer,
):
    ptg = _ptg_2_san_pham(db)
    vt = _support(db, cong_thuc="sl_vao * dai_support / 1000000")
    _gan_vao_buoc_phieu(db, ptg, "Dán hộp", vt, {"dai_support": 500})
    lsx = _tao_lenh_hop(db, orders, lsx_svc, admin, customer, ptg)
    buoc = _buoc(lsx)
    cd_dan = db.query(CongDoan).filter(CongDoan.ma == "CD-DAN-T").one()
    nguon = [(vt.id, {"dai_support": 500})]

    rows, _ = lsx_svc._vat_tu_bung(cd_dan, buoc, quy_cach_bien(lsx), dong_nguon=nguon)
    assert rows[0]["so_luong"] == pytest.approx(round(float(buoc.so_luong_vao) * 500 / 1_000_000, 3))
    assert rows[0]["gia_tri_chip"] == {"dai_support": 500}

    buoc.so_luong_vao = float(buoc.so_luong_vao) * 2
    rows2, _ = lsx_svc._vat_tu_bung(cd_dan, buoc, quy_cach_bien(lsx), dong_nguon=nguon)
    assert rows2[0]["so_luong"] == pytest.approx(rows[0]["so_luong"] * 2, abs=0.002)


def test_chip_thieu_so_thi_khong_bung_va_noi_ro_chip_nao(db, orders, lsx_svc, admin, customer):
    ptg = _ptg_2_san_pham(db)
    vt = _support(db)
    lsx = _tao_lenh_hop(db, orders, lsx_svc, admin, customer, ptg)
    cd_dan = db.query(CongDoan).filter(CongDoan.ma == "CD-DAN-T").one()

    rows, canh_bao = lsx_svc._vat_tu_bung(
        cd_dan, _buoc(lsx), quy_cach_bien(lsx),
        dong_nguon=[(vt.id, {"dai_support": 500})])          # thiếu "Rộng support"

    assert rows == []                                         # công thức ra 0 ⇒ không bung
    assert any("Rộng support" in c and "chưa có số" in c for c in canh_bao)


def test_khong_co_nguon_phieu_thi_bung_tu_danh_muc_cong_doan_voi_chip_rong(
    db, orders, lsx_svc, admin, customer,
):
    """Lệnh không có phiếu (hoặc bài ghép): `dong_nguon=None` ⇒ lấy vật tư của công đoạn trong danh
    mục, chip = 0. Công thức không dùng chip thì vẫn ra số."""
    ptg = _ptg_2_san_pham(db)
    vt = _support(db, cong_thuc="sl_vao / 40000")
    cd_dan = db.query(CongDoan).filter(CongDoan.ma == "CD-DAN-T").one()
    cd_dan.vat_tus.append(CongDoanVatTu(vat_tu_id=vt.id, thu_tu=0))
    db.commit()
    lsx = _tao_lenh_hop(db, orders, lsx_svc, admin, customer, ptg)
    buoc = _buoc(lsx)

    rows, _ = lsx_svc._vat_tu_bung(cd_dan, buoc, quy_cach_bien(lsx))      # không truyền dong_nguon

    assert [r["vat_tu_id"] for r in rows] == [vt.id]
    assert rows[0]["gia_tri_chip"] == {}
    assert rows[0]["so_luong"] == pytest.approx(round(float(buoc.so_luong_vao) / 40_000, 3))


def test_replace_routing_bo_so_luong_gui_len_cho_vat_tu_khac_va_tinh_lai(
    db, orders, lsx_svc, admin, customer,
):
    ptg = _ptg_2_san_pham(db)
    vt = _support(db)
    lsx = _tao_lenh_hop(db, orders, lsx_svc, admin, customer, ptg)

    lsx_svc.replace_routing(lsx_id=lsx.id, actor=admin, rows_in=[
        LsxCongDoanIn(
            ten="Dán hộp", nhom="finishing", so_luong_vao=1000, so_luong_ra=1000, don_vi_vao="cai",
            phu_thuoc_step_keys=[],
            vat_tus=[{"vat_tu_id": vt.id, "so_luong": 999, "tu_dong": False,
                      "gia_tri_chip": {"dai_support": 500, "rong_support": 400}}],
        ),
    ])

    buoc = _buoc(lsx_svc.get(lsx.id))
    assert float(buoc.vat_tus[0].so_luong) == pytest.approx(0.2)    # số 999 gửi lên bị bỏ
    assert buoc.vat_tus[0].gia_tri_chip == {"dai_support": 500, "rong_support": 400}


def test_dinh_muc_go_tay_sua_tay_thi_giu_dung_so_va_khong_con_la_dong_may(
    db, orders, lsx_svc, admin, customer,
):
    ptg = _ptg_2_san_pham(db)
    vt = _support(db)
    lsx = _tao_lenh_hop(db, orders, lsx_svc, admin, customer, ptg)

    def luu(**dong):
        lsx_svc.replace_routing(lsx_id=lsx.id, actor=admin, rows_in=[
            LsxCongDoanIn(
                ten="Dán hộp", nhom="finishing", so_luong_vao=1000, so_luong_ra=1000, don_vi_vao="cai",
                phu_thuoc_step_keys=[],
                vat_tus=[{"vat_tu_id": vt.id, "gia_tri_chip": {"dai_support": 500, "rong_support": 400},
                          **dong}],
            ),
        ])
        return _buoc(lsx_svc.get(lsx.id)).vat_tus[0]

    v = luu(so_luong=12.5, tu_dong=True, sua_tay=True)
    assert float(v.so_luong) == pytest.approx(12.5)
    assert v.sua_tay is True and v.tu_dong is False

    v = luu(tu_dong=False)                         # bấm "Tính lại theo công thức"
    assert float(v.so_luong) == pytest.approx(0.2)
    assert v.sua_tay is False


def test_dien_giai_dinh_muc_doc_nhan_chip_va_thay_so_chip_rieng(db, orders, lsx_svc, admin, customer):
    """Chip riêng của vật tư không nằm trong từ điển biến chung: diễn giải phải đọc được nhãn chip
    và thay số chip, không để lộ mã `dai_support × rong_support = dai_support × rong_support`."""
    ptg = _ptg_2_san_pham(db)
    vt = _support(db)
    lsx = _tao_lenh_hop(db, orders, lsx_svc, admin, customer, ptg)
    cd_dan = db.query(CongDoan).filter(CongDoan.ma == "CD-DAN-T").one()

    rows, _ = lsx_svc._vat_tu_bung(
        cd_dan, _buoc(lsx), quy_cach_bien(lsx),
        dong_nguon=[(vt.id, {"dai_support": 500, "rong_support": 400})])

    dg = rows[0]["dien_giai"]
    assert "dai_support" not in dg and "rong_support" not in dg, dg
    assert dg.startswith("Dài support × Rộng support ÷ 1000000 = 500 × 400 ÷ 1000000 = 0,2")
