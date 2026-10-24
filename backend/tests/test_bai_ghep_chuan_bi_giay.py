"""Khâu chuẩn bị giấy của bài ghép (spec 2026-10-24-chuan-bi-giay §8).

Bước chung của bài là lớp ĐÈ lên bước của lệnh thành viên. Nên khâu chuẩn bị của bài cũng đi đường
đó: lệnh vào bài thì khâu chuẩn bị riêng (chọn theo tồn của lệnh) bị gỡ, dựng lại theo nguồn của BÀI;
khi bài gộp In thì Cắt giấy cuộn / Tề giấy in của các lệnh được gộp thành bước chung đứng trước In
chung, và giấy của bài lấy ở bước chung đầu đó. Tề sóng theo từng lệnh, không đụng.
"""
from __future__ import annotations

import pytest

from app.models.bai_ghep_cong_doan import BaiGhepCongDoan, BaiGhepCongDoanMap
from app.models.cong_doan import CongDoan
from app.models.lsx import TT_SAN_SANG
from app.models.phieu_tinh_gia import PhieuThanhPhan, PhieuThanhPham, PhieuTinhGia
from app.models.vat_lieu_kho import GiayNguyen
from app.services.kho_giay import kg_tu_to
from app.services.san_xuat.buoc_giay_bai import buoc_lay_giay_bai_lo
from tests.test_bai_ghep_service import bg_svc  # noqa: F401 — fixture dùng chung
from tests.test_ke_hoach_vat_tu import svc  # noqa: F401
from tests.test_ke_hoach_vat_tu_buoc_dau import _khoa_giay
from tests.test_lenh_chuan_bi_giay import _cd_he_thong, _ma, _ton
from tests.test_lsx_service import (  # noqa: F401
    _don_da_chuyen_sx, _may_in, _to_san_xuat, admin, customer, db, lsx_svc, orders,
)


def _ptg_hai_hop(db, *, song_a: bool = False) -> PhieuTinhGia:
    """Hai hộp cùng Duplex 350, khổ in 650×430, khổ nguyên 650×860 (xả 2): In → (Bồi TĐ) → Cán."""
    giay = GiayNguyen(ma="G-DUP350", ten="Duplex 350", loai="giay", gsm=350, don_gia=3_000,
                      don_vi_gia="to", don_vi_them=["to", "kg"])
    sg = GiayNguyen(ma="G-SONGE", ten="Sóng E", loai="song", gsm=300, don_gia=2_000,
                    don_vi_gia="to", don_vi_them=["to"])
    db.add_all([giay, sg])
    to_id = _to_san_xuat(db).id
    for ma in ("CGC", "TGI", "TS", "BTĐ"):   # bước hệ thống cần tổ thì lệnh mới "sẵn sàng" được
        _cd_he_thong(db, ma).department_ids = [to_id]
    may = _may_in(db)
    in_ = CongDoan(ma="CD-IN-BG", ten="In offset", nhom="print", cong_thuc_gia="so_luong * don_gia",
                   department_ids=[to_id], don_vi_vao="to", don_vi_ra="to")
    can = CongDoan(ma="CD-CAN-BG", ten="Cán màng", nhom="finishing", cong_thuc_gia="so_luong * don_gia",
                   department_ids=[to_id], don_vi_vao="to", don_vi_ra="to")
    db.add_all([in_, can])
    db.flush()

    def _sp(thu_tu: int, ten: str, sl: int, song: bool) -> PhieuThanhPhan:
        chuoi = [in_, *([_cd_he_thong(db, "BTĐ")] if song else []), can]
        sp = PhieuThanhPhan(
            thu_tu=thu_tu, ten=ten, so_luong=sl, dai_thanh_pham=200, rong_thanh_pham=150,
            kho_nguyen_dai=860, kho_nguyen_rong=650, kho_in_dai=650, kho_in_rong=430,
            so_mau_a=4, so_mau_b=0, quy_cach_in="mot_mat", may_id=may.id, giay_id=giay.id,
            song_id=sg.id if song else None,
        )
        for i, cd in enumerate(chuoi):
            sp.thanh_phams.append(PhieuThanhPham(thu_tu=i, cong_doan_id=cd.id, ten=cd.ten, don_gia=50))
        return sp

    p = PhieuTinhGia(ma="PTG-BG-CB", ten_san_pham="Hai hộp ghép", so_luong=5_000)
    p.thanh_phans.extend([_sp(0, "Hộp A", 5_000, song_a), _sp(1, "Hộp B", 3_000, False)])
    db.add(p)
    db.commit()
    return p


def _hai_lenh(db, orders, lsx_svc, admin, customer, **kw):
    d = _don_da_chuyen_sx(db, orders, admin, customer, _ptg_hai_hop(db, **kw))
    ids = [l["order_line_id"] for l in lsx_svc.preview(d.id)["lines"]]
    a, b = lsx_svc.tao(order_id=d.id, order_line_ids=ids, actor=admin)
    for l in (a, b):
        lsx_svc.set_trang_thai(lsx_id=l.id, trang_thai=TT_SAN_SANG, actor=admin)
    return lsx_svc.get(a.id), lsx_svc.get(b.id)


def _theo(db, lsx, ma: str):
    return next(c for c in lsx.cong_doans if c.cong_doan_id and db.get(CongDoan, c.cong_doan_id).ma == ma)


def _chung(db, bg) -> list[BaiGhepCongDoan]:
    return (db.query(BaiGhepCongDoan).filter_by(bai_ghep_id=bg.id)
            .order_by(BaiGhepCongDoan.thu_tu, BaiGhepCongDoan.id).all())


def _gop_in(db, bg_svc, lsx_svc, admin, bg, a, b):
    a, b = lsx_svc.get(a.id), lsx_svc.get(b.id)
    return bg_svc.gop(bai_ghep_id=bg.id, step_keys=[_theo(db, a, "CD-IN-BG").step_key,
                                                    _theo(db, b, "CD-IN-BG").step_key], actor=admin)


def test_lenh_vao_bai_dung_khau_theo_nguon_bai_giu_te_song(db, orders, lsx_svc, bg_svc, admin, customer):
    a, b = _hai_lenh(db, orders, lsx_svc, admin, customer, song_a=True)
    lsx_svc.doi_nguon_giay(lsx_id=a.id, nguon="to_in", rong_cuon=None, actor=admin)
    assert "TGI" not in _ma(db, lsx_svc.get(a.id))

    bg = bg_svc.tao(lsx_ids=[a.id, b.id], actor=admin)

    assert bg.nguon_giay == "mua"
    a, b = lsx_svc.get(a.id), lsx_svc.get(b.id)
    assert a.nguon_giay == b.nguon_giay == "mua"
    assert _ma(db, a) == ["TS", "TGI", "CD-IN-BG", "BTĐ", "CD-CAN-BG"]
    assert _ma(db, b) == ["TGI", "CD-IN-BG", "CD-CAN-BG"]


def test_bai_co_buoc_chung_te_truoc_in_chung(db, orders, lsx_svc, bg_svc, admin, customer):
    a, b = _hai_lenh(db, orders, lsx_svc, admin, customer)
    bg = bg_svc.tao(lsx_ids=[a.id, b.id], actor=admin)

    _gop_in(db, bg_svc, lsx_svc, admin, bg, a, b)

    chung = _chung(db, bg)
    assert [db.get(CongDoan, c.cong_doan_id).ma for c in chung] == ["TGI", "CD-IN-BG"]
    a, b = lsx_svc.get(a.id), lsx_svc.get(b.id)
    phu = {m.lsx_step_key for m in db.query(BaiGhepCongDoanMap).filter_by(bai_ghep_cong_doan_id=chung[0].id)}
    assert phu == {_theo(db, a, "TGI").step_key, _theo(db, b, "TGI").step_key}
    so_to = bg_svc.tinh_so_to(bg, {a.id: a, b.id: b})
    assert float(chung[0].so_luong_vao) == pytest.approx(so_to["to_nguyen_can"])


def test_buoc_lay_giay_bai_la_buoc_chung_dau(db, orders, lsx_svc, bg_svc, admin, customer):
    a, b = _hai_lenh(db, orders, lsx_svc, admin, customer)
    bg = bg_svc.tao(lsx_ids=[a.id, b.id], actor=admin)
    _gop_in(db, bg_svc, lsx_svc, admin, bg, a, b)

    chung = _chung(db, bg)
    assert buoc_lay_giay_bai_lo(db, {bg.id: chung})[bg.id].id == chung[0].id


def test_tach_in_chung_go_luon_khau_chung(db, orders, lsx_svc, bg_svc, admin, customer):
    a, b = _hai_lenh(db, orders, lsx_svc, admin, customer)
    bg = bg_svc.tao(lsx_ids=[a.id, b.id], actor=admin)
    _gop_in(db, bg_svc, lsx_svc, admin, bg, a, b)
    in_chung = _chung(db, bg)[-1]

    bg_svc.tach(bai_ghep_id=bg.id, gang_step_key=in_chung.step_key, actor=admin)

    assert _chung(db, bg) == []


def test_lenh_roi_bai_dung_lai_khau_rieng(db, orders, lsx_svc, bg_svc, admin, customer):
    a, b = _hai_lenh(db, orders, lsx_svc, admin, customer)
    bg = bg_svc.tao(lsx_ids=[a.id, b.id], actor=admin)
    _gop_in(db, bg_svc, lsx_svc, admin, bg, a, b)
    _ton(db, "G-DUP350", 430, 650, "to", 999_999)
    tv_b = next(tv for tv in bg_svc._get(bg.id).thanh_viens if tv.lsx_id == b.id)

    bg_svc.bo_thanh_vien(bai_ghep_id=bg.id, thanh_vien_id=tv_b.id, actor=admin)

    b = lsx_svc.get(b.id)
    assert b.nguon_giay == "to_in"
    assert _ma(db, b) == ["CD-IN-BG", "CD-CAN-BG"]
    assert _chung(db, bg) == []


def test_pha_bai_lenh_dung_lai_khau_rieng(db, orders, lsx_svc, bg_svc, admin, customer):
    a, b = _hai_lenh(db, orders, lsx_svc, admin, customer)
    bg = bg_svc.tao(lsx_ids=[a.id, b.id], actor=admin)
    _ton(db, "G-DUP350", 430, 650, "to", 999_999)

    bg_svc.xoa(bai_ghep_id=bg.id, actor=admin)

    for l in (a, b):
        l = lsx_svc.get(l.id)
        assert l.nguon_giay == "to_in"
        assert "TGI" not in _ma(db, l)


def test_khvt_bai_mot_dong_giay_o_buoc_chung_dau(db, orders, lsx_svc, bg_svc, svc, admin, customer):
    a, b = _hai_lenh(db, orders, lsx_svc, admin, customer)
    bg = bg_svc.tao(lsx_ids=[a.id, b.id], actor=admin)
    _gop_in(db, bg_svc, lsx_svc, admin, bg, a, b)
    a, b = lsx_svc.get(a.id), lsx_svc.get(b.id)
    so_to = bg_svc.tinh_so_to(bg_svc._get(bg.id), {a.id: a, b.id: b})
    g = db.query(GiayNguyen).filter_by(ma="G-DUP350").one()

    bang = svc.can_doi(chi_lsx_ids={a.id, b.id})

    assert _khoa_giay(bang, g) == {("giay", g.id, 650, 860): pytest.approx(so_to["to_nguyen_can"])}
    dong = [d for i in bang["items"] if i["hang_loai"] == "giay" and i["hang_id"] == g.id for d in i["dong"]]
    assert len(dong) == 1


def test_khvt_bai_cuon_ra_kg_theo_rong_cuon(db, orders, lsx_svc, bg_svc, svc, admin, customer):
    a, b = _hai_lenh(db, orders, lsx_svc, admin, customer)
    _ton(db, "G-DUP350", 870, 0, "kg", 50_000)
    bg = bg_svc.tao(lsx_ids=[a.id, b.id], actor=admin)
    assert bg.nguon_giay == "cuon"
    _gop_in(db, bg_svc, lsx_svc, admin, bg, a, b)
    a, b = lsx_svc.get(a.id), lsx_svc.get(b.id)
    chung = _chung(db, bg)
    assert [db.get(CongDoan, c.cong_doan_id).ma for c in chung] == ["CGC", "TGI", "CD-IN-BG"]
    g = db.query(GiayNguyen).filter_by(ma="G-DUP350").one()

    kq = _khoa_giay(svc.can_doi(chi_lsx_ids={a.id, b.id}), g)

    assert kq == {("giay", g.id, 870, 0): pytest.approx(kg_tu_to(chung[0].so_luong_vao, 870, 650, 350),
                                                       abs=1e-2)}
