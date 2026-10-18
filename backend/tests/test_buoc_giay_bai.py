"""Bước LẤY giấy của bài ghép sau khi bỏ khâu tổ Cắt chốt giấy (spec 2026-10-18 §6).

Luật: bước chung có bước thành viên mang dòng giấy; không có thì bước chung đầu tiên nhận chặng tờ
hoặc thuộc nhóm In. Cờ Tổ Cắt của phòng ban KHÔNG còn ảnh hưởng."""
from __future__ import annotations

from app.models.bai_ghep_cong_doan import BaiGhepCongDoan, BaiGhepCongDoanMap
from app.models.department import Department
from app.models.lsx import LsxCongDoan, LsxCongDoanVatTu
from app.services.san_xuat.buoc_giay_bai import buoc_lay_giay_bai_lo

from tests.test_ke_hoach_vat_tu import _giay, customer, db  # noqa: F401
from tests.test_ke_hoach_vat_tu_buoc_dau import _bai_tuyen


def _buoc_chung(db, bg):
    return (db.query(BaiGhepCongDoan).filter_by(bai_ghep_id=bg.id)
            .order_by(BaiGhepCongDoan.thu_tu).all())


def test_co_to_cat_khong_con_keo_buoc_cat_cuon_thanh_buoc_lay_giay(db, customer):
    g = _giay(db)
    _a, _b, bg = _bai_tuyen(db, customer, g, [("Cắt cuộn", "prepress", "kg"),
                                              ("In offset", "print", "to")])
    to_cat = Department(name="Tổ Cắt BG", code="TO-CAT-BG", la_san_xuat=True, la_to_cat=True)
    db.add(to_cat)
    db.flush()
    buoc = _buoc_chung(db, bg)
    buoc[0].department_id = to_cat.id
    db.commit()

    kq = buoc_lay_giay_bai_lo(db, {bg.id: buoc})

    assert kq[bg.id].ten == "In offset"


def test_buoc_chung_co_thanh_vien_mang_giay_thang_buoc_nhan_to_dung_truoc(db, customer):
    g = _giay(db)
    a, _b, bg = _bai_tuyen(db, customer, g, [("Cắt tờ", "prepress", "to_nguyen"),
                                             ("In offset", "print", "to")])
    buoc = _buoc_chung(db, bg)
    in_tv = LsxCongDoan(lsx_id=a.id, thu_tu=9, ten="In offset", loai_buoc="may",
                        step_key="tv-a-in", don_vi_vao="to", don_vi_ra="to")
    db.add(in_tv)
    db.flush()
    db.add(LsxCongDoanVatTu(lsx_cong_doan_id=in_tv.id, hang_loai="giay", vat_tu_id=g.id,
                            vat_tu_ma_snapshot=g.ma, vat_tu_ten_snapshot=g.ten,
                            don_vi_snapshot="to", so_luong=100, thu_tu=0))
    db.add(BaiGhepCongDoanMap(bai_ghep_cong_doan_id=buoc[1].id, lsx_id=a.id,
                              lsx_step_key="tv-a-in"))
    db.commit()

    kq = buoc_lay_giay_bai_lo(db, {bg.id: buoc})

    assert kq[bg.id].id == buoc[1].id


def test_khong_buoc_nao_nhan_giay_tra_none(db, customer):
    g = _giay(db)
    _a, _b, bg = _bai_tuyen(db, customer, g, [("Ghi kẽm CTP", "prepress", "kem")])
    buoc = _buoc_chung(db, bg)

    assert buoc_lay_giay_bai_lo(db, {bg.id: buoc}) == {bg.id: None}
