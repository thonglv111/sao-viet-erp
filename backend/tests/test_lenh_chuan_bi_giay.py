"""Lập lệnh tự chèn khâu chuẩn bị giấy (spec 2026-10-24-chuan-bi-giay §7).

Ví dụ chuẩn: Duplex 350 gsm, khổ in 650×430, khổ nguyên 650×860 (xả 2). Máy xem tồn tự do, chọn
nguồn, chèn Cắt giấy cuộn / Tề giấy in trước In, Tề sóng nối vào bước bồi; giấy/sóng gắn ở bước đầu.
"""
from __future__ import annotations

from datetime import date
from math import ceil

import math

import pytest

from app.models.cong_doan import CongDoan
from app.models.kho_hang import KhoHang
from app.models.phieu_tinh_gia import PhieuThanhPhan, PhieuThanhPham, PhieuTinhGia
from app.models.stock_lot import LOT_AVAILABLE, StockLot
from app.models.vat_lieu_kho import GiayNguyen
from app.schemas.lsx import LsxCongDoanIn
from app.services.kho_giay import kg_tu_to
from app.services.lsx_service import LsxValidationError
from tests.test_lsx_service import (  # noqa: F401 — fixture dùng chung
    _don_da_chuyen_sx, _may_in, _to_san_xuat, admin, customer, db, lsx_svc, orders,
)


def _cd_he_thong(db, ma: str) -> CongDoan:
    return db.query(CongDoan).filter(CongDoan.ma == ma).one()


def _ptg(db, *, song: bool = False, kho_nguyen: tuple[int, int] | None = (650, 860),
         co_in: bool = True) -> PhieuTinhGia:
    """In → (Bồi Duplex với Krap TĐ nếu có sóng) → Cán màng. Giấy + sóng chọn ở sản phẩm."""
    giay = GiayNguyen(ma="G-DUP350", ten="Duplex 350", loai="giay", gsm=350, don_gia=3_000,
                      don_vi_gia="to", don_vi_them=["to", "kg"])
    db.add(giay)
    sg = None
    if song:
        sg = GiayNguyen(ma="G-SONGE", ten="Sóng E", loai="song", gsm=300, don_gia=2_000,
                        don_vi_gia="to", don_vi_them=["to"])
        db.add(sg)
    to_id = _to_san_xuat(db).id
    may = _may_in(db)
    in_ = CongDoan(ma="CD-IN-CB", ten="In offset", nhom="print", cong_thuc_gia="so_luong * don_gia",
                   department_ids=[to_id], don_vi_vao="to", don_vi_ra="to")
    can = CongDoan(ma="CD-CAN-CB", ten="Cán màng", nhom="finishing", cong_thuc_gia="so_luong * don_gia",
                   department_ids=[to_id], don_vi_vao="to", don_vi_ra="to")
    db.add_all([in_, can])
    db.flush()
    chuoi = [*([in_] if co_in else []), *([_cd_he_thong(db, "BTĐ")] if song else []), can]
    p = PhieuTinhGia(ma=f"PTG-CB-{int(song)}-{kho_nguyen}-{int(co_in)}", ten_san_pham="Hộp", so_luong=5_000)
    tp = PhieuThanhPhan(
        thu_tu=0, ten="Hộp Duplex", so_luong=5_000, dai_thanh_pham=200, rong_thanh_pham=150,
        kho_nguyen_dai=kho_nguyen[1] if kho_nguyen else None,
        kho_nguyen_rong=kho_nguyen[0] if kho_nguyen else None,
        kho_in_dai=650, kho_in_rong=430, so_mau_a=4, so_mau_b=0, quy_cach_in="mot_mat",
        may_id=may.id, giay_id=giay.id, song_id=sg.id if sg else None,
    )
    for i, cd in enumerate(chuoi):
        tp.thanh_phams.append(PhieuThanhPham(thu_tu=i, cong_doan_id=cd.id, ten=cd.ten, don_gia=50))
    p.thanh_phans.append(tp)
    db.add(p)
    db.commit()
    return p


def _ton(db, giay_ma: str, kr: int, kd: int, goc: str, so: float) -> None:
    kho = db.query(KhoHang).first()
    if kho is None:
        kho = KhoHang(ma="K1", ten="Kho test")
        db.add(kho)
        db.flush()
    g = db.query(GiayNguyen).filter(GiayNguyen.ma == giay_ma).one()
    db.add(StockLot(hang_loai="giay", hang_id=g.id, kho_id=kho.id, ma_lo=f"LOT-{kr}x{kd}{goc}",
                    sl_ban_dau=so, sl_con_lai=so, ngay_nhap=date.today(), trang_thai=LOT_AVAILABLE,
                    don_vi_goc=goc, kho_rong=kr, kho_dai=kd))
    db.commit()


def _tao(db, orders, lsx_svc, admin, customer, ptg):
    d = _don_da_chuyen_sx(db, orders, admin, customer, ptg)
    return lsx_svc.tao(order_id=d.id, order_line_ids=[ln.id for ln in d.lines], actor=admin)[0]


def _buoc(lsx) -> list:
    return sorted(lsx.cong_doans, key=lambda c: c.thu_tu)


def _ma(db, lsx) -> list[str]:
    return [db.get(CongDoan, c.cong_doan_id).ma if c.cong_doan_id else c.ten for c in _buoc(lsx)]


def _theo_ma(db, lsx, ma: str):
    return next(c for c in _buoc(lsx) if c.cong_doan_id and db.get(CongDoan, c.cong_doan_id).ma == ma)


def _in(lsx):
    return next(c for c in _buoc(lsx) if c.nhom == "print")


def _giay(lsx) -> dict[str, list]:
    return {c.ten: [v for v in c.vat_tus if v.hang_loai == "giay"] for c in _buoc(lsx)}


def test_kho_co_cuon_lenh_co_cat_cuon_te_in(db, orders, lsx_svc, admin, customer):
    ptg = _ptg(db)
    _ton(db, "G-DUP350", 870, 0, "kg", 5_000)
    lsx = _tao(db, orders, lsx_svc, admin, customer, ptg)
    assert _ma(db, lsx) == ["CGC", "TGI", "CD-IN-CB", "CD-CAN-CB"]
    assert lsx.nguon_giay == "cuon"
    cgc = _theo_ma(db, lsx, "CGC")
    co_giay = {ten: dong for ten, dong in _giay(lsx).items() if dong}
    assert list(co_giay) == [cgc.ten]
    (g,) = co_giay[cgc.ten]
    assert (g.don_vi_goc, g.kho_rong, g.kho_dai) == ("kg", 870, 0)
    # Làm tròn LÊN 0,01 kg — đề nghị kho lưu 2 số lẻ.
    assert float(g.so_luong) == pytest.approx(math.ceil(kg_tu_to(cgc.so_luong_vao, 870, 650, 350) * 100) / 100)


def test_kho_co_to_kho_in_khong_them_buoc_giay_o_in(db, orders, lsx_svc, admin, customer):
    ptg = _ptg(db)
    _ton(db, "G-DUP350", 430, 650, "to", 999_999)
    lsx = _tao(db, orders, lsx_svc, admin, customer, ptg)
    assert _ma(db, lsx) == ["CD-IN-CB", "CD-CAN-CB"]
    assert lsx.nguon_giay == "to_in"
    in_ = _in(lsx)
    (g,) = _giay(lsx)[in_.ten]
    assert (g.don_vi_goc, g.kho_rong, g.kho_dai) == ("to", 430, 650)
    assert float(g.so_luong) == in_.so_luong_vao


def test_kho_trong_nguon_mua_co_te_giay_in(db, orders, lsx_svc, admin, customer):
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg(db))
    assert _ma(db, lsx) == ["TGI", "CD-IN-CB", "CD-CAN-CB"]
    assert lsx.nguon_giay == "mua"
    tgi = _theo_ma(db, lsx, "TGI")
    (g,) = _giay(lsx)[tgi.ten]
    assert (g.don_vi_goc, g.kho_rong, g.kho_dai) == ("to", 650, 860)
    assert float(g.so_luong) == tgi.so_luong_vao
    assert _giay(lsx)[_in(lsx).ten] == []


def test_co_song_them_te_song_noi_vao_boi(db, orders, lsx_svc, admin, customer):
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg(db, song=True))
    assert _ma(db, lsx) == ["TGI", "CD-IN-CB", "TS", "BTĐ", "CD-CAN-CB"]
    ts, boi = _theo_ma(db, lsx, "TS"), _theo_ma(db, lsx, "BTĐ")
    assert ts.phu_thuoc == []
    sau_ts = [c for c in lsx.cong_doans if any(e.buoc_truoc_id == ts.id for e in c.phu_thuoc)]
    assert sau_ts == [boi]
    assert {e.buoc_truoc_id for e in boi.phu_thuoc} == {ts.id, _in(lsx).id}
    song_id = ptg_song = db.query(GiayNguyen).filter(GiayNguyen.ma == "G-SONGE").one().id
    (s,) = _giay(lsx)[ts.ten]
    assert s.vat_tu_id == song_id == ptg_song
    assert (s.don_vi_goc, s.kho_rong, s.kho_dai, float(s.so_luong)) == ("to", 430, 650, ts.so_luong_vao)
    assert all(v.vat_tu_id != song_id for c in _buoc(lsx) if c is not ts for v in c.vat_tus)


def test_tinh_nguoc_te_song_ra_bang_vao_boi_cong_hao(db, orders, lsx_svc, admin, customer):
    ts_dm = _cd_he_thong(db, "TS")
    ts_dm.kieu_bu_hao, ts_dm.so_to_bu_hao = "co_dinh", 21
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg(db, song=True))
    ts, boi = _theo_ma(db, lsx, "TS"), _theo_ma(db, lsx, "BTĐ")
    assert ts.so_luong_ra == boi.so_luong_vao
    assert ts.so_luong_vao == ts.so_luong_ra + 21
    assert lsx.so_to_ke_hoach == int(_in(lsx).so_luong_vao)


def test_nhanh_giay_tinh_nguoc_qua_te_va_cat_cuon(db, orders, lsx_svc, admin, customer):
    for ma, hao in (("TGI", 10), ("CGC", 5)):
        cd = _cd_he_thong(db, ma)
        cd.kieu_bu_hao, cd.so_to_bu_hao = "co_dinh", hao
    ptg = _ptg(db)
    _ton(db, "G-DUP350", 870, 0, "kg", 5_000)
    lsx = _tao(db, orders, lsx_svc, admin, customer, ptg)
    in_, tgi, cgc = _in(lsx), _theo_ma(db, lsx, "TGI"), _theo_ma(db, lsx, "CGC")
    assert lsx.quy_cach_json["so_manh_xa"] == 2
    assert tgi.so_luong_ra == in_.so_luong_vao
    assert tgi.so_luong_vao == ceil(in_.so_luong_vao / 2) + 10
    assert cgc.so_luong_ra == tgi.so_luong_vao
    assert cgc.so_luong_vao == cgc.so_luong_ra + 5
    assert lsx.so_to_nguyen == int(cgc.so_luong_vao)


def test_xoa_buoc_boi_khi_co_te_song_bi_chan(db, orders, lsx_svc, admin, customer):
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg(db, song=True))
    rows = [LsxCongDoanIn(step_key=c.step_key, cong_doan_id=c.cong_doan_id, ten=c.ten, nhom=c.nhom,
                          department_id=c.department_id, may_id=c.may_id)
            for c in _buoc(lsx) if c.ten != "Bồi Duplex với Krap TĐ"]
    with pytest.raises(LsxValidationError, match="Tề sóng cần bước bồi"):
        lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=rows, actor=admin)


def test_thieu_kho_nguyen_kiem_thieu_bao(db, orders, lsx_svc, admin, customer):
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg(db, kho_nguyen=None))
    assert lsx.nguon_giay == "mua"
    assert _ma(db, lsx) == ["CD-IN-CB", "CD-CAN-CB"]
    assert "thieu_kho_nguyen" in lsx_svc.thieu_cua(lsx)


def test_kho_nguyen_nho_hon_kho_in_khong_chon_cuon_va_bao_thieu(db, orders, lsx_svc, admin, customer):
    """Khổ nguyên 400×500 không chứa được khổ in 430×650 ⇒ không dựng Cắt cuộn từ cuộn 400, báo thiếu."""
    ptg = _ptg(db, kho_nguyen=(400, 500))
    _ton(db, "G-DUP350", 400, 0, "kg", 9999)
    lsx = _tao(db, orders, lsx_svc, admin, customer, ptg)
    assert lsx.nguon_giay == "mua"
    assert _ma(db, lsx) == ["CD-IN-CB", "CD-CAN-CB"]
    assert "thieu_kho_nguyen" in lsx_svc.thieu_cua(lsx)


def test_lenh_khong_buoc_in_van_giu_giay_o_buoc_dau(db, orders, lsx_svc, admin, customer):
    """Phiếu không có In (chỉ Cán): không chọn nguồn được, nhưng giấy của sản phẩm vẫn phải nằm ở một
    bước — mất dòng giấy là mất luôn nhu cầu ở Kế hoạch vật tư và yêu cầu xuất kho."""
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg(db, co_in=False))
    assert lsx.nguon_giay is None
    assert _ma(db, lsx) == ["CD-CAN-CB"]
    assert [v.hang_loai for cd in lsx.cong_doans for v in cd.vat_tus] == ["giay"]


def test_lenh_cu_nguon_null_giu_nguyen_khi_ap_chuoi_nguoc(db, orders, lsx_svc, admin, customer):
    ptg = _ptg(db)
    _ton(db, "G-DUP350", 430, 650, "to", 999_999)
    lsx = _tao(db, orders, lsx_svc, admin, customer, ptg)
    lsx.nguon_giay = None
    lsx_svc._ap_chuoi_nguoc(lsx)
    assert _ma(db, lsx) == ["CD-IN-CB", "CD-CAN-CB"]
    in_ = _in(lsx)
    (g,) = _giay(lsx)[in_.ten]
    assert float(g.so_luong) == in_.so_luong_vao and (g.kho_rong, g.kho_dai) == (430, 650)


def test_go_khau_chuan_bi_noi_lai_in(db, orders, lsx_svc, admin, customer):
    ptg = _ptg(db)
    _ton(db, "G-DUP350", 870, 0, "kg", 5_000)
    lsx = _tao(db, orders, lsx_svc, admin, customer, ptg)
    lsx_svc._go_khau_chuan_bi_giay(lsx)
    db.flush()
    assert _ma(db, lsx) == ["CD-IN-CB", "CD-CAN-CB"]
    assert _in(lsx).phu_thuoc == []
