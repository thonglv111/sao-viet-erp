"""Khối Vật liệu đầu vào của lệnh (12/11/2026, mockup chuan-bi-vat-lieu.html): máy chấm điểm các khổ
đang có trong kho, chọn sẵn phương án đầu; người kế hoạch đổi khổ / lề sóng / về phương án tốt nhất.
Đổi chỉ gỡ và dựng lại bước chuẩn bị của vật liệu đó. Cùng cổng chặn với sửa routing.

Khổ in 430×650, Duplex 350 gsm (fixture `test_lenh_chuan_bi_giay`)."""
from __future__ import annotations

from math import ceil

import pytest

from app.models.lsx import TT_DA_DONG, TT_DA_LAP_KE_HOACH, TT_DA_PHAT_HANH
from app.services.lsx_service import LsxConflict, LsxValidationError
from tests.test_lenh_chuan_bi_giay import (
    _buoc, _giay, _in, _le_song, _ma, _ptg, _ptg_song_co_te, _tao, _theo_ma, _ton,
)
from tests.test_lsx_service import (  # noqa: F401 — fixture dùng chung
    admin, customer, db, lsx_svc, orders,
)


def _doi(lsx_svc, lsx, admin, vat_lieu="giay", *, rong=None, dai=None, le=None, ve=False):
    return lsx_svc.doi_vat_lieu(lsx_id=lsx.id, vat_lieu=vat_lieu, rong=rong, dai=dai, tru_le_mm=le,
                                ve_tot_nhat=ve, actor=admin)


def _lenh_cuon(db, orders, lsx_svc, admin, customer, *, ptg=None):
    ptg = ptg or _ptg(db)
    _ton(db, "G-DUP350", 870, 0, "kg", 5_000)
    lsx = _tao(db, orders, lsx_svc, admin, customer, ptg)
    assert lsx.nguon_giay == "cuon"
    return lsx


def test_phuong_an_xep_diem_dang_lay_la_tot_nhat(db, orders, lsx_svc, admin, customer):
    ptg = _ptg(db)
    _ton(db, "G-DUP350", 650, 860, "to", 999_999)
    _ton(db, "G-DUP350", 870, 0, "kg", 5_000)
    lsx = _tao(db, orders, lsx_svc, admin, customer, ptg)
    kq = lsx_svc.phuong_an_vat_lieu(lsx)
    g = kq["giay"]
    assert kq["khoa"] is None and kq["song"] is None
    assert g["kho_can"] == [430, 650] and g["vao_buoc"] == _in(lsx).ten and g["so_to_can"] > 0
    diem = [p["diem"] for p in g["ds"]]
    assert diem == sorted(diem, reverse=True) and len(diem) == 3
    assert g["tot_nhat"] and (g["dang_lay"]["rong"], g["dang_lay"]["dai"]) == (g["ds"][0]["rong"], g["ds"][0]["dai"])
    to_nguyen = next(p for p in g["ds"] if (p["rong"], p["dai"]) == (650, 860))
    assert to_nguyen["buoc"] == ["Tề giấy in"] and to_nguyen["so_manh"] == 2 and to_nguyen["don_vi"] == "to"
    cuon = next(p for p in g["ds"] if p["dang"] == "cuon")
    assert cuon["buoc"] == ["Cắt giấy cuộn", "Tề giấy in"] and cuon["don_vi"] == "kg"


def test_doi_cuon_sang_to_nguyen_go_cat_cuon(db, orders, lsx_svc, admin, customer):
    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer)
    _ton(db, "G-DUP350", 650, 860, "to", 999_999)
    lsx = _doi(lsx_svc, lsx, admin, rong=860, dai=650)
    assert lsx.nguon_giay == "to_nguyen"
    assert _ma(db, lsx) == ["TGI", "CD-IN-CB", "CD-CAN-CB"]
    tgi = _theo_ma(db, lsx, "TGI")
    co_giay = {ten: dong for ten, dong in _giay(lsx).items() if dong}
    assert list(co_giay) == [tgi.ten]
    (g,) = co_giay[tgi.ten]
    assert (g.don_vi_goc, g.kho_rong, g.kho_dai, float(g.so_luong)) == ("to", 650, 860, tgi.so_luong_vao)
    assert tgi.so_luong_vao == ceil(_in(lsx).so_luong_vao / 2)
    assert tgi.phu_thuoc == [] and {e.buoc_truoc_id for e in _in(lsx).phu_thuoc} == {tgi.id}


def test_doi_sang_cuon_dung_cat_cuon_va_kg(db, orders, lsx_svc, admin, customer):
    ptg = _ptg(db)
    _ton(db, "G-DUP350", 880, 0, "kg", 1)
    lsx = _tao(db, orders, lsx_svc, admin, customer, ptg)
    assert lsx.nguon_giay == "to_in"
    lsx = _doi(lsx_svc, lsx, admin, rong=880, dai=0)
    assert _ma(db, lsx) == ["CGC", "TGI", "CD-IN-CB", "CD-CAN-CB"]
    (g,) = _giay(lsx)[_theo_ma(db, lsx, "CGC").ten]
    assert (g.don_vi_goc, g.kho_rong, g.kho_dai) == ("kg", 880, 0) and float(g.so_luong) > 0
    assert (lsx.quy_cach_json["kho_nguyen_rong"], lsx.quy_cach_json["so_manh_xa"]) == (880, 2)


def test_ve_tot_nhat_va_co_tot_nhat(db, orders, lsx_svc, admin, customer):
    ptg = _ptg(db)
    _ton(db, "G-DUP350", 880, 0, "kg", 1)
    lsx = _tao(db, orders, lsx_svc, admin, customer, ptg)
    lsx = _doi(lsx_svc, lsx, admin, rong=880, dai=0)
    assert lsx_svc.phuong_an_vat_lieu(lsx)["giay"]["tot_nhat"] is False
    lsx = _doi(lsx_svc, lsx, admin, ve=True)
    assert lsx.nguon_giay == "to_in" and _ma(db, lsx) == ["CD-IN-CB", "CD-CAN-CB"]
    assert lsx_svc.phuong_an_vat_lieu(lsx)["giay"]["tot_nhat"] is True


def test_kho_khong_trong_danh_sach_bi_chan(db, orders, lsx_svc, admin, customer):
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg(db))
    with pytest.raises(LsxValidationError, match="không còn trong danh sách"):
        _doi(lsx_svc, lsx, admin, rong=700, dai=1000)


def test_vat_lieu_la_bi_chan(db, orders, lsx_svc, admin, customer):
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg(db))
    with pytest.raises(LsxValidationError):
        _doi(lsx_svc, lsx, admin, "khach", ve=True)


def test_doi_giay_khong_dung_buoc_khac(db, orders, lsx_svc, admin, customer):
    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer, ptg=_ptg_song_co_te(db))
    giu = {c.step_key for c, ma in zip(_buoc(lsx), _ma(db, lsx)) if ma not in ("CGC", "TGI")}
    lsx = _doi(lsx_svc, lsx, admin, rong=430, dai=650)
    assert _ma(db, lsx) == ["CD-IN-CB", "TS", "BTĐ", "CD-CAN-CB"]
    assert {c.step_key for c in _buoc(lsx)} == giu
    (g,) = _giay(lsx)[_in(lsx).ten]
    assert (g.don_vi_goc, g.kho_rong, g.kho_dai) == ("to", 430, 650)
    assert len(_giay(lsx)[_theo_ma(db, lsx, "TS").ten]) == 1


def test_doi_le_song_lam_kho_dang_lay_nho_thi_chon_lai_va_them_te(db, orders, lsx_svc, admin, customer):
    _le_song(db, 5)
    ptg = _ptg(db, song=True)
    _ton(db, "G-SONGE", 425, 645, "to", 999_999)
    _ton(db, "G-SONGE", 440, 660, "to", 999_999)
    lsx = _tao(db, orders, lsx_svc, admin, customer, ptg)
    assert "TS" not in _ma(db, lsx)
    giay_truoc = [c.step_key for c, ma in zip(_buoc(lsx), _ma(db, lsx)) if ma in ("CGC", "TGI")]
    lsx = _doi(lsx_svc, lsx, admin, "song", le=0)
    assert lsx.quy_cach_json["song_tru_le_mm"] == 0
    assert _ma(db, lsx).index("TS") == _ma(db, lsx).index("BTĐ") - 1
    (s,) = _giay(lsx)[_theo_ma(db, lsx, "TS").ten]
    assert (s.kho_rong, s.kho_dai) == (440, 660)
    assert [c.step_key for c, ma in zip(_buoc(lsx), _ma(db, lsx)) if ma in ("CGC", "TGI")] == giay_truoc
    assert all(not [v for v in c.vat_tus if v.vat_tu_id == s.vat_tu_id]
               for c in _buoc(lsx) if c.ten != _theo_ma(db, lsx, "TS").ten)


def test_lenh_cu_co_te_song_doc_le_theo_danh_muc(db, orders, lsx_svc, admin, customer):
    """Lệnh dựng theo cách cũ: chuỗi có Tề sóng nhưng chưa có khoá khổ sóng / lề. Khối phải nói đúng chuỗi
    đang có (cần Tề sóng, lề theo danh mục), và đổi xong lề được chốt vào lệnh."""
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg_song_co_te(db))
    assert "TS" in _ma(db, lsx)
    qc = dict(lsx.quy_cach_json)
    for k in ("song_kho_rong", "song_kho_dai", "song_tru_le_mm"):
        qc.pop(k, None)
    lsx.quy_cach_json = qc
    db.flush()
    s = lsx_svc.phuong_an_vat_lieu(lsx)["song"]
    assert s["tru_le_mm"] == 5 and s["kho_can"] == [425, 645]
    assert s["dang_lay"]["buoc"] == ["Tề sóng"]
    lsx = _doi(lsx_svc, lsx, admin, "song", ve=True)
    assert lsx.quy_cach_json["song_tru_le_mm"] == 5 and "TS" in _ma(db, lsx)


def test_le_ngoai_0_50_bi_chan(db, orders, lsx_svc, admin, customer):
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg_song_co_te(db))
    with pytest.raises(LsxValidationError, match="Lề trừ từ 0 đến 50"):
        _doi(lsx_svc, lsx, admin, "song", le=51)


def test_khong_song_chi_co_giay(db, orders, lsx_svc, admin, customer):
    lsx = _tao(db, orders, lsx_svc, admin, customer, _ptg(db))
    assert lsx_svc.phuong_an_vat_lieu(lsx)["song"] is None
    with pytest.raises(LsxValidationError, match="chưa có sóng"):
        _doi(lsx_svc, lsx, admin, "song", ve=True)


def test_doi_khi_dang_giu_cho_409(db, orders, lsx_svc, admin, customer):
    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer)
    lsx.giu_cho_bat = True
    db.commit()
    assert "giữ chỗ" in (lsx_svc.phuong_an_vat_lieu(lsx_svc.get(lsx.id))["khoa"] or "")
    with pytest.raises(LsxConflict, match="giữ chỗ"):
        _doi(lsx_svc, lsx, admin, ve=True)
    assert _ma(db, lsx_svc.get(lsx.id))[:2] == ["CGC", "TGI"]


def test_doi_khi_da_lap_ke_hoach_409(db, orders, lsx_svc, admin, customer):
    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer)
    lsx.trang_thai = TT_DA_LAP_KE_HOACH
    db.commit()
    with pytest.raises(LsxConflict, match="lập kế hoạch"):
        _doi(lsx_svc, lsx, admin, ve=True)


@pytest.mark.parametrize("tt, cau", [(TT_DA_PHAT_HANH, "đã phát hành"), (TT_DA_DONG, "đã đóng")])
def test_doi_lenh_da_xuong_xuong_409(db, orders, lsx_svc, admin, customer, tt, cau):
    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer)
    lsx.trang_thai = tt
    db.commit()
    with pytest.raises(LsxConflict, match=cau):
        _doi(lsx_svc, lsx, admin, ve=True)
    assert _ma(db, lsx_svc.get(lsx.id))[:2] == ["CGC", "TGI"]


def test_doi_lenh_tron_goi_409(db, orders, lsx_svc, admin, customer):
    from app.models.gia_cong_ngoai import KIEU_TRON_GOI, GiaCongNgoai
    from app.models.purchase import Supplier

    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer)
    s = Supplier(name="In ngoài", nhan_gia_cong=True)
    db.add(s)
    db.flush()
    db.add(GiaCongNgoai(kieu=KIEU_TRON_GOI, nha_cung_cap_id=s.id, lsx_id=lsx.id))
    db.commit()
    with pytest.raises(LsxConflict, match="trọn gói"):
        _doi(lsx_svc, lsx, admin, ve=True)


def test_nhat_ky_ghi_kho_cu_va_moi(db, orders, lsx_svc, admin, customer):
    from app.models.audit import AuditLog

    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer)
    _doi(lsx_svc, lsx, admin, rong=430, dai=650)
    log = db.query(AuditLog).filter(AuditLog.action == "doi_vat_lieu_dau_vao").one()
    assert log.detail.endswith("Cuộn rộng 870 → Tờ 430 × 650")


def test_luu_routing_kem_vat_tu_giu_rong_cuon(db, orders, lsx_svc, admin, customer):
    """Lưu routing gửi kèm dòng vật tư mọi bước — Cắt giấy cuộn phải giữ rộng cuộn đang lấy."""
    from app.schemas.lsx import LsxBuocVatTuIn, LsxCongDoanIn

    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer)
    (truoc,) = _giay(lsx)[_theo_ma(db, lsx, "CGC").ten]
    kg_truoc = float(truoc.so_luong)
    rows = [LsxCongDoanIn(step_key=c.step_key, cong_doan_id=c.cong_doan_id, ten=c.ten, nhom=c.nhom,
                          department_id=c.department_id, may_id=c.may_id,
                          vat_tus=[LsxBuocVatTuIn(hang_loai=v.hang_loai, vat_tu_id=v.vat_tu_id)
                                   for v in c.vat_tus])
            for c in _buoc(lsx)]
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=rows, actor=admin)
    (g,) = _giay(lsx)[_theo_ma(db, lsx, "CGC").ten]
    assert (g.don_vi_goc, g.kho_rong, g.kho_dai) == ("kg", 870, 0)
    assert float(g.so_luong) == pytest.approx(kg_truoc) and kg_truoc > 0


def _rows(lsx, bo_ma: set[str] = frozenset(), db=None):
    from app.schemas.lsx import LsxBuocVatTuIn, LsxCongDoanIn

    return [LsxCongDoanIn(step_key=c.step_key, cong_doan_id=c.cong_doan_id, ten=c.ten, nhom=c.nhom,
                          department_id=c.department_id, may_id=c.may_id,
                          vat_tus=[LsxBuocVatTuIn(hang_loai=v.hang_loai, vat_tu_id=v.vat_tu_id)
                                   for v in c.vat_tus])
            for c, ma in zip(_buoc(lsx), _ma(db, lsx)) if ma not in bo_ma]


@pytest.mark.parametrize("tt", [TT_DA_PHAT_HANH, TT_DA_DONG])
def test_sua_routing_lenh_da_xuong_xuong_409(db, orders, lsx_svc, admin, customer, tt):
    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer)
    rows = _rows(lsx, db=db)
    lsx.trang_thai = tt
    db.commit()
    with pytest.raises(LsxConflict, match="sửa routing"):
        lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=rows, actor=admin)


def test_bo_cat_cuon_bang_tay_409_giay_con_nguyen(db, orders, lsx_svc, admin, customer):
    """L-SX-04: bỏ tay bước Cắt giấy cuộn là mất dòng giấy duy nhất — bảo đổi ở Vật liệu đầu vào."""
    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer)
    with pytest.raises(LsxConflict, match="Vật liệu đầu vào"):
        lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(lsx, {"CGC"}, db=db), actor=admin)
    lsx = lsx_svc.get(lsx.id)
    assert _ma(db, lsx)[:2] == ["CGC", "TGI"]
    assert len(_giay(lsx)[_theo_ma(db, lsx, "CGC").ten]) == 1


def test_lenh_co_nguon_giay_mat_dong_giay_thi_thieu_giay(db, orders, lsx_svc, admin, customer):
    lsx = _lenh_cuon(db, orders, lsx_svc, admin, customer)
    assert "thieu_giay" not in lsx_svc.thieu_cua(lsx)
    for c in lsx.cong_doans:
        c.vat_tus[:] = [v for v in c.vat_tus if v.hang_loai != "giay"]
    db.commit()
    assert "thieu_giay" in lsx_svc.thieu_cua(lsx_svc.get(lsx.id))


def test_doi_sang_cuon_kho_nguyen_bang_kho_in_van_luu_routing_duoc(db, orders, lsx_svc, admin, customer):
    """L-SX-21: cuộn 650 cắt ra đúng tờ 650×430 vẫn có Tề, chuỗi không đứt, lưu routing được."""
    ptg = _ptg(db, kho_nguyen=(430, 650))
    _ton(db, "G-DUP350", 650, 0, "kg", 1)
    lsx = _tao(db, orders, lsx_svc, admin, customer, ptg)
    lsx = _doi(lsx_svc, lsx, admin, rong=650, dai=0)
    assert _ma(db, lsx)[:3] == ["CGC", "TGI", "CD-IN-CB"]
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(lsx, db=db), actor=admin)
    assert _ma(db, lsx)[:2] == ["CGC", "TGI"]
