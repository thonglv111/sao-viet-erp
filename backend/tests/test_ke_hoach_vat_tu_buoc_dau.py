"""Kế hoạch vật tư: giấy chỉ tính ở BƯỚC ĐẦU mỗi mã (bước lấy từ kho) — spec 2026-10-01 §5."""
from __future__ import annotations

import pytest

from app.models.bai_ghep_cong_doan import BaiGhepCongDoan
from app.models.lsx import LsxCongDoan, LsxCongDoanVatTu
from app.services.kho_giay import chuan_kho, don_vi_goc_to

# Fixture và dựng liệu dùng chung với bộ test KHVT chính.
from tests.test_ke_hoach_vat_tu import (  # noqa: F401
    MAI, _bai, _giay, _lenh, _nhom, customer, db, svc,
)


def _buoc_giay(db, l, *, thu_tu, ten, giay, so_luong, kho, don_vi_vao="to_nguyen", goc="to",
               dvt=None):
    b = LsxCongDoan(lsx_id=l.id, thu_tu=thu_tu, ten=ten, loai_buoc="may",
                    don_vi_vao=don_vi_vao, don_vi_ra="to", so_luong_vao=so_luong,
                    so_luong_ra=so_luong)
    db.add(b)
    db.flush()
    kr, kd = chuan_kho(*kho) if kho else (0, 0)
    db.add(LsxCongDoanVatTu(
        lsx_cong_doan_id=b.id, hang_loai="giay", vat_tu_id=giay.id,
        vat_tu_ma_snapshot=giay.ma, vat_tu_ten_snapshot=giay.ten,
        don_vi_snapshot=dvt or don_vi_goc_to(), so_luong=so_luong, kho_rong=kr, kho_dai=kd,
        thu_tu=0, tu_dong=False, don_vi_goc=goc,
    ))
    db.commit()
    return b


def _lenh_cat_in(db, customer, g):
    """Lệnh 2 bước: Cắt tờ (790×1090, 5.260 tờ nguyên) → In (545×790, 10.520 tờ in)."""
    l = _lenh(db, customer, ma="LSX-CI", giay_id=g.id, so_to_nguyen=5_260, han=MAI, buoc=False)
    cat = _buoc_giay(db, l, thu_tu=1, ten="Cắt tờ", giay=g, so_luong=5_260, kho=(790, 1_090))
    in_ = _buoc_giay(db, l, thu_tu=2, ten="In offset", giay=g, so_luong=10_520, kho=(545, 790),
                     don_vi_vao="to")
    return l, cat, in_


def _khoa_giay(bang, g):
    return {(i["hang_loai"], i["hang_id"], i["kho_rong"], i["kho_dai"]):
            sum(d["nhu_cau"] for d in i["dong"])
            for i in bang["items"] if i["hang_loai"] == "giay" and i["hang_id"] == g.id}


def test_chi_buoc_dau_vao_nhu_cau(db, svc, customer):
    g = _giay(db)
    _lenh_cat_in(db, customer, g)
    kq = _khoa_giay(svc.can_doi(), g)
    assert kq == {("giay", g.id, 790, 1_090): pytest.approx(5_260)}


def test_nhu_cau_cong_viec_in_rong_khi_co_buoc_cat(db, svc, customer):
    from tests.test_ke_hoach_vat_tu import _cong_viec

    g = _giay(db)
    l, cat, in_ = _lenh_cat_in(db, customer, g)
    cv_in = _cong_viec(db, l, buoc_id=in_.id, xong=False)
    cv_cat = _cong_viec(db, l, buoc_id=cat.id, xong=False)
    assert svc.nhu_cau_cua_cong_viec(cv_in) == []
    ds = svc.nhu_cau_cua_cong_viec(cv_cat)
    assert [round(x["sl_goc"] if "sl_goc" in x else x.get("nhu_cau", 0)) for x in ds] == [5_260]


def test_khong_buoc_cat_thi_in_la_buoc_dau(db, svc, customer):
    g = _giay(db)
    l = _lenh(db, customer, ma="LSX-I", giay_id=g.id, so_to_nguyen=10_520, han=MAI, buoc=False)
    _buoc_giay(db, l, thu_tu=1, ten="In offset", giay=g, so_luong=10_520, kho=(545, 790),
               don_vi_vao="to")
    assert _khoa_giay(svc.can_doi(), g) == {("giay", g.id, 545, 790): pytest.approx(10_520)}


def test_buoc_nhan_tu(db, svc, customer):
    g = _giay(db)
    l, cat, in_ = _lenh_cat_in(db, customer, g)
    kq = svc.buoc_nhan_tu(l.id)
    dong = kq[in_.id].pop("dong")
    assert kq == {in_.id: {"hang_id": g.id, "tu_buoc": "Cắt tờ"}}
    # Trả kèm dòng giấy của chính bước để bàn tổ khỏi đọc lại DB.
    assert [(v.lsx_cong_doan_id, int(v.vat_tu_id)) for v in dong] == [(in_.id, g.id)]


def test_buoc_nhan_tu_bo_qua_buoc_bi_buoc_chung_de(db, svc, customer):
    """Bước Cắt tờ bị bước chung của bài đè ⇒ không đóng góp ⇒ nhãn của Cán màng nêu In offset,
    không nêu Cắt tờ; còn In (đứng sau Cắt tờ, trước không còn bước nào đóng góp) không có nhãn."""
    from app.models.bai_ghep_cong_doan import BaiGhepCongDoanMap

    g = _giay(db)
    l, cat, in_ = _lenh_cat_in(db, customer, g)
    can = _buoc_giay(db, l, thu_tu=3, ten="Cán màng", giay=g, so_luong=10_520, kho=(545, 790),
                     don_vi_vao="to")
    bg = _bai(db, "GB-DE", g, [l])
    chung = BaiGhepCongDoan(bai_ghep_id=bg.id, thu_tu=1, ten="Cắt chung", loai_buoc="may",
                            don_vi_vao="to_nguyen", don_vi_ra="to")
    db.add(chung)
    db.flush()
    db.add(BaiGhepCongDoanMap(bai_ghep_cong_doan_id=chung.id, lsx_id=l.id,
                              lsx_step_key=cat.step_key))
    db.commit()
    kq = svc.buoc_nhan_tu(l.id)
    kq[can.id].pop("dong")
    assert kq == {can.id: {"hang_id": g.id, "tu_buoc": "In offset"}}


def test_buoc_nhan_tu_bo_qua_lenh_tron_goi(db, svc, customer):
    from app.models.gia_cong_ngoai import KIEU_TRON_GOI, GiaCongNgoai
    from app.models.purchase import Supplier

    g = _giay(db)
    l, _cat, _in = _lenh_cat_in(db, customer, g)
    s = Supplier(name="NCC trọn gói", tax_code="0900000001", phone="0900000000",
                 email="tg@x.vn", address="HN", contact_name="A", supplier_group="giay",
                 status="active")
    db.add(s)
    db.flush()
    db.add(GiaCongNgoai(kieu=KIEU_TRON_GOI, lsx_id=l.id, nha_cung_cap_id=s.id,
                        xuong_cap_giay=False))
    db.commit()
    assert svc.buoc_nhan_tu(l.id) == {}


def test_giay_kg_kho_rong_la_mot_nhom_rieng(db, svc, customer):
    """Giấy khổ rộng đếm kg (bỏ dạng cuộn 10/10/2026): nhóm mang khổ chỉ-rộng + đơn vị gốc kg —
    không còn gom mọi khổ của mã về `(0, 0)`."""
    g = _giay(db)
    l = _lenh(db, customer, ma="LSX-CU", giay_id=g.id, so_to_nguyen=100, han=MAI, buoc=False)
    _buoc_giay(db, l, thu_tu=1, ten="Cắt cuộn", giay=g, so_luong=300, kho=(790, 0),
               don_vi_vao="kg", goc="kg", dvt="kg")
    bang = svc.can_doi()
    assert _khoa_giay(bang, g) == {("giay", g.id, 790, 0): pytest.approx(300)}
    assert [i["don_vi_goc"] for i in bang["items"] if i["hang_id"] == g.id] == ["kg"]


def _bai_voi_buoc_chung(db, customer, g, *, don_vi_vao, so_luong_vao=0):
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
              giay_o_buoc=False)
    b = _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
              giay_o_buoc=False)
    bg = _bai(db, "GB-CAT", g, [a, b])
    db.add(BaiGhepCongDoan(bai_ghep_id=bg.id, thu_tu=1, ten="Cắt tờ", loai_buoc="may",
                           don_vi_vao=don_vi_vao, don_vi_ra="to", so_luong_vao=so_luong_vao,
                           so_luong_ra=so_luong_vao, chen_boi_to_cat=True))
    db.commit()
    return a, b, bg


def test_bai_buoc_chung_dau_nhan_to_nguyen_lay_to_nguyen_can(db, svc, customer):
    g = _giay(db)
    a, b, bg = _bai_voi_buoc_chung(db, customer, g, don_vi_vao="to_nguyen")
    so_to = svc._tinh_so_to(bg, {a.id: a, b.id: b})
    kq = _khoa_giay(svc.can_doi(), g)
    assert kq == {("giay", g.id, 780, 905): pytest.approx(so_to["to_nguyen_can"])}


def test_bai_buoc_chung_dau_nhan_to_in_lay_kho_in_va_tong_to(db, svc, customer):
    g = _giay(db)
    a, b, bg = _bai_voi_buoc_chung(db, customer, g, don_vi_vao="to")
    so_to = svc._tinh_so_to(bg, {a.id: a, b.id: b})
    kq = _khoa_giay(svc.can_doi(), g)
    assert kq == {("giay", g.id, 650, 860): pytest.approx(so_to["tong_to"])}


def _bai_tuyen(db, customer, g, buoc):
    """Bài 2 thành viên, tuyến chung `buoc` = [(ten, nhom, don_vi_vao)] theo thứ tự."""
    a = _lenh(db, customer, ma="LSX-TA", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
              giay_o_buoc=False)
    b = _lenh(db, customer, ma="LSX-TB", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
              giay_o_buoc=False)
    bg = _bai(db, "GB-TUYEN", g, [a, b])
    for i, (ten, nhom, vao) in enumerate(buoc, start=1):
        db.add(BaiGhepCongDoan(bai_ghep_id=bg.id, thu_tu=i, ten=ten, nhom=nhom,
                               loai_buoc="may", don_vi_vao=vao, don_vi_ra=vao,
                               so_luong_vao=0, so_luong_ra=0))
    db.commit()
    return a, b, bg


def test_bai_ghi_kem_dung_dau_in_nhan_to_in(db, svc, customer):
    """I1 — CTP (đơn vị `kem`) đứng đầu tuyến bài KHÔNG phải bước lấy giấy: In nhận tờ in ⇒ mua
    khổ in × tổng tờ, không phải cuộn kg."""
    g = _giay(db)
    a, b, bg = _bai_tuyen(db, customer, g, [("Ghi kẽm CTP", "prepress", "kem"),
                                            ("In offset", "print", "to")])
    so_to = svc._tinh_so_to(bg, {a.id: a, b.id: b})
    assert _khoa_giay(svc.can_doi(), g) == {("giay", g.id, 650, 860): pytest.approx(so_to["tong_to"])}


def test_bai_ghi_kem_cat_to_in_lay_to_nguyen(db, svc, customer):
    g = _giay(db)
    a, b, bg = _bai_tuyen(db, customer, g, [("Ghi kẽm CTP", "prepress", "kem"),
                                            ("Cắt tờ", "prepress", "to_nguyen"),
                                            ("In offset", "print", "to")])
    so_to = svc._tinh_so_to(bg, {a.id: a, b.id: b})
    assert _khoa_giay(svc.can_doi(), g) == {
        ("giay", g.id, 780, 905): pytest.approx(so_to["to_nguyen_can"])}


def test_bai_in_chua_khai_don_vi_mua_kho_in(db, svc, customer):
    """Ghi kẽm bỏ trống đơn vị, In chưa khai đơn vị vào, không có bước cắt ⇒ mua khổ in (§5)."""
    g = _giay(db)
    a, b, bg = _bai_tuyen(db, customer, g, [("Ghi kẽm CTP", "prepress", None),
                                            ("In offset", "print", None)])
    so_to = svc._tinh_so_to(bg, {a.id: a, b.id: b})
    assert _khoa_giay(svc.can_doi(), g) == {("giay", g.id, 650, 860): pytest.approx(so_to["tong_to"])}


def test_bai_cuon_thieu_gsm_bo_so_kem_ly_do(db, svc, customer):
    """I1 — bước chung lấy giấy nhận cuộn mà giấy thiếu gsm ⇒ không lấy số tờ dán nhãn kg: nhu cầu
    0, có lý do cảnh báo. Bước cắt cuộn là bước lấy giấy vì bước thành viên nó phủ mang dòng giấy
    (khâu tổ Cắt chốt giấy đã gỡ 18/10/2026, cờ Tổ Cắt không còn kéo bước nào thành bước lấy giấy)."""
    from app.models.bai_ghep_cong_doan import BaiGhepCongDoanMap

    g = _giay(db, gsm=0)
    a, _b, bg = _bai_tuyen(db, customer, g, [("Cắt cuộn", "prepress", "kg"),
                                             ("In offset", "print", "to")])
    cat = db.query(BaiGhepCongDoan).filter_by(bai_ghep_id=bg.id, thu_tu=1).one()
    tv = LsxCongDoan(lsx_id=a.id, thu_tu=9, ten="Cắt cuộn", loai_buoc="may", step_key="tv-cat",
                     don_vi_vao="kg", don_vi_ra="to")
    db.add(tv)
    db.flush()
    db.add(LsxCongDoanVatTu(lsx_cong_doan_id=tv.id, hang_loai="giay", vat_tu_id=g.id,
                            vat_tu_ma_snapshot=g.ma, vat_tu_ten_snapshot=g.ten,
                            don_vi_snapshot="kg", so_luong=0, thu_tu=0))
    db.add(BaiGhepCongDoanMap(bai_ghep_cong_doan_id=cat.id, lsx_id=a.id, lsx_step_key="tv-cat"))
    db.commit()
    items = [i for i in svc.can_doi()["items"] if i["hang_loai"] == "giay" and i["hang_id"] == g.id]
    dong = [d for i in items for d in i["dong"]]
    assert len(dong) == 1
    assert dong[0]["nhu_cau"] == 0
    assert "gsm" in (dong[0]["ly_do_canh_bao"] or "")
    assert "tờ" not in dong[0]["nhu_cau_hien_thi"]
