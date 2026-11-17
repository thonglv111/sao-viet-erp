"""Góc Theo máy của màn Theo dõi sản xuất (làm gọn 05/10/2026, đặc tả 3.3).

Thứ tự nhóm: Chưa có máy → nhóm máy theo `loai_may` (sắp tên) → Máy đã xoá → Gia công ngoài. Máy
bình thường không việc gập vào `may_trong`. Tình trạng đọc công việc THẬT, không đọc kế hoạch.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.models.lsx import Lsx
from app.models.machine_unavailable import KIEU_CHAN, LY_DO_HONG_HOC, MachineUnavailablePeriod
from app.models.may_thiet_bi import MayThietBi
from app.models.purchase import Supplier
from app.models.san_xuat import BUOC_THUE_NGOAI, CV_DANG_CHAY, CV_TAM_DUNG
from app.models.san_xuat_san_luong import SanXuatBatch
from app.models.thue_gia_cong import KIEU_MOT_PHAN, TgcDon, TgcDonDong, TgcPhieuGiao, TgcViec
from app.services import may_trang_thai
from app.services.lenh_sx import theo_doi
from tests.lenh_sx_fixtures import (  # noqa: F401
    _cvs,
    _dem_sql,
    _dot_dong_don,
    _h,
    _phat_hanh_that,
    _tok,
    _token_khong_quyen_theo_doi,
    admin,
    customer,
    ghep_doi,
    lenh_that,
    lsx_svc,
    orders,
    sess,
)


def _theo_may(sess, **kw) -> dict:
    return theo_doi.theo_may(sess, sale_ids=None, **kw)


def _nhom(d: dict, loai: str) -> list[dict]:
    return [g for g in d["nhom"] if g["loai"] == loai]


def _dong_may(d: dict, may_id: int) -> dict:
    return next(r for g in d["nhom"] for r in g["dong"] if r["may_id"] == may_id)


def _may(sess, ma: str, ten: str, loai: str = "in", active: bool = True) -> MayThietBi:
    m = MayThietBi(ma=ma, ten=ten, loai_may=loai, active=active)
    sess.add(m)
    sess.commit()
    return m


def _gan_may(sess, cv, may: MayThietBi | None) -> None:
    cv.may_id = may.id if may is not None else None
    sess.commit()


def _batch(sess, cv, tot: float, don_vi: str) -> None:
    luc = datetime.now(timezone.utc)
    sess.add(SanXuatBatch(
        cong_viec_id=cv.id, bat_dau=luc - timedelta(hours=1), ket_thuc=luc,
        tong=tot, tot=tot, hong=0, don_vi=don_vi,
    ))
    sess.commit()


def test_nhom_chua_co_may_dung_dau_moi_buoc_mot_dong(sess, lenh_that):
    """`_dung_lenh` để mọi bước chưa có máy ⇒ ba dòng "Chờ xếp máy", nhóm đứng đầu."""
    in_ = _may(sess, "MAY-TM-IN", "Máy in (TM)")
    d = _theo_may(sess)
    assert d["nhom"][0]["loai"] == theo_doi.NHOM_CHUA_MAY
    dong = d["nhom"][0]["dong"]
    assert len(dong) == 3
    assert {r["tinh_trang"] for r in dong} == {theo_doi.TT_CHO_XEP_MAY}
    assert all(r["may_id"] is None and r["ten"] is None for r in dong)
    assert dong[0]["dang_chay"]["lsx"][0]["lsx_id"] == lenh_that
    # Fixture dựng lệnh tự để sẵn một máy in nền ("MAY-IN-XL") — nên so THÀNH VIÊN, không so cả tập.
    assert in_.id in {m["may_id"] for m in d["may_trong"]}


def test_gom_theo_loai_may_nhom_sap_ten_may_sap_ten(sess, lenh_that):
    cvs = _cvs(sess, lenh_that)
    be = _may(sess, "MAY-TM-BE", "Bế B", loai="be")
    in_b = _may(sess, "MAY-TM-INB", "In B", loai="in")
    in_a = _may(sess, "MAY-TM-INA", "In A", loai="in")
    _gan_may(sess, cvs[0], in_b)
    _gan_may(sess, cvs[1], in_a)
    _gan_may(sess, cvs[2], be)
    d = _theo_may(sess)
    nhom_may = _nhom(d, theo_doi.NHOM_MAY)
    assert [g["ten"] for g in nhom_may] == ["be", "in"]
    assert [r["ten"] for r in nhom_may[1]["dong"]] == ["In A", "In B"]
    assert _nhom(d, theo_doi.NHOM_CHUA_MAY) == []


def test_tinh_trang_doc_viec_that_khong_doc_ke_hoach(sess, lenh_that, monkeypatch):
    """Bàn Xếp lịch nói máy đang chạy, nhưng không công việc nào `running` ⇒ "Đang trống" — và
    máy ấy gập vào `may_trong`."""
    may = _may(sess, "MAY-TM-KH", "Máy theo kế hoạch (TM)")
    monkeypatch.setattr(
        may_trang_thai, "lenh_dang_chay",
        lambda db, ids, bay_gio: {may.id: {"ma": "LSX-KH", "finish_at": None}},
    )
    d = _theo_may(sess)
    trong = {m["may_id"]: m for m in d["may_trong"]}
    assert may.id in trong
    assert trong[may.id]["tinh_trang"] == theo_doi.TT_TRONG


def test_viec_dang_chay_tam_dung_va_ke_tiep(sess, lenh_that):
    cvs = _cvs(sess, lenh_that)
    may = _may(sess, "MAY-TM-CHAY", "Máy chạy (TM)")
    for cv in cvs:
        cv.may_id = may.id
    cvs[0].trang_thai = CV_DANG_CHAY
    cvs[0].du_kien_ket_thuc = datetime(2026, 10, 5, 15, 30, tzinfo=timezone.utc)
    sess.commit()
    r = _dong_may(_theo_may(sess), may.id)
    assert r["tinh_trang"] == theo_doi.TT_VIEC_DANG_CHAY
    assert r["nhan_tinh_trang"] == "Đang chạy"
    assert r["dang_chay"]["cong_viec_id"] == cvs[0].id
    assert r["ke_hoach_xong"] == datetime(2026, 10, 5, 15, 30)
    assert [v["cong_viec_id"] for v in r["ke_tiep"]] == [cvs[1].id, cvs[2].id]
    assert r["ke_tiep_them"] == 0

    sess.get(type(cvs[0]), cvs[0].id).trang_thai = CV_TAM_DUNG
    sess.commit()
    r = _dong_may(_theo_may(sess), may.id)
    assert r["tinh_trang"] == theo_doi.TT_VIEC_TAM_DUNG
    assert r["nhan_tinh_trang"] == "Tạm dừng"


def test_thieu_du_kien_ket_thuc_tra_rong(sess, lenh_that):
    cv = _cvs(sess, lenh_that)[0]
    may = _may(sess, "MAY-TM-RONG", "Máy thiếu mốc (TM)")
    cv.may_id = may.id
    cv.trang_thai = CV_DANG_CHAY
    cv.du_kien_ket_thuc = None
    sess.commit()
    assert _dong_may(_theo_may(sess), may.id)["ke_hoach_xong"] is None


def test_may_hong_thang_viec_dang_chay(sess, lenh_that):
    cv = _cvs(sess, lenh_that)[0]
    may = _may(sess, "MAY-TM-HONG", "Máy hỏng (TM)")
    cv.may_id = may.id
    cv.trang_thai = CV_DANG_CHAY
    bay_gio = datetime.now(timezone.utc)
    sess.add(MachineUnavailablePeriod(
        may_id=may.id, kieu=KIEU_CHAN, reason=LY_DO_HONG_HOC,
        unavailable_from=bay_gio - timedelta(days=1), unavailable_to=bay_gio + timedelta(days=1),
    ))
    sess.commit()
    d = _theo_may(sess)
    r = _dong_may(d, may.id)
    assert r["tinh_trang"] == may_trang_thai.TT_MAY_DUNG
    assert r["nhan_tinh_trang"] == may_trang_thai.NHAN[may_trang_thai.TT_MAY_DUNG]
    assert d["bat_thuong"]["may_hong"] == 1

    chi_hong = _theo_may(sess, bat_thuong=theo_doi.BT_MAY_HONG)
    assert [r["may_id"] for g in chi_hong["nhom"] for r in g["dong"]] == [may.id]
    assert chi_hong["may_trong"] == []


def test_gia_cong_ngoai_mot_dong_moi_nha_khong_lap_o_nhom_may(sess, lenh_that):
    """Việc chưa đặt: gom chung một dòng "Chưa đặt nhà gia công", trạng thái Chờ giao."""
    cvs = _cvs(sess, lenh_that)
    may = _may(sess, "MAY-TM-GC", "Máy in (GC)")
    cvs[0].may_id = may.id
    cvs[1].loai_buoc = BUOC_THUE_NGOAI
    cvs[1].may_id = may.id
    cvs[2].loai_buoc = BUOC_THUE_NGOAI
    sess.commit()
    d = _theo_may(sess)
    gc = _nhom(d, theo_doi.NHOM_GIA_CONG)
    assert len(gc) == 1 and d["nhom"][-1]["loai"] == theo_doi.NHOM_GIA_CONG
    assert [r["ten"] for r in gc[0]["dong"]] == [theo_doi.NHAN_CHUA_CHON_NCC]
    r = gc[0]["dong"][0]
    assert r["tinh_trang"] == theo_doi.TT_CHO_GIAO
    assert r["dang_chay_them"] == 1
    assert r["san_luong"] is None
    tren_may = _dong_may(d, may.id)
    viec = [tren_may["dang_chay"]] + tren_may["ke_tiep"]
    assert [v["cong_viec_id"] for v in viec if v] == [cvs[0].id]


def test_gia_cong_da_giao_lay_ten_tu_don(sess, lenh_that):
    cv = _cvs(sess, lenh_that)[2]
    ncc = Supplier(name="Xưởng bế Hoà Phát")
    sess.add(ncc)
    sess.flush()
    viec = TgcViec(lsx_id=lenh_that, kieu=KIEU_MOT_PHAN, ten_viec="Bế")
    don = TgcDon(ma="GC26-9401", nha_cung_cap_id=ncc.id, nha_cung_cap_ten="Xưởng bế Hoà Phát",
                 ngay_dat=datetime.now(timezone.utc).date(), dat_luc=datetime.now(timezone.utc))
    sess.add_all([viec, don])
    sess.flush()
    sess.add(TgcDonDong(don_id=don.id, viec_id=viec.id, sl_dat=1000, don_gia=0))
    sess.add(TgcPhieuGiao(ma="GG26-9401", don_id=don.id))
    cv.loai_buoc = BUOC_THUE_NGOAI
    cv.tgc_viec_id = viec.id
    sess.commit()
    r = _nhom(_theo_may(sess), theo_doi.NHOM_GIA_CONG)[0]["dong"][0]
    assert r["ten"] == "Xưởng bế Hoà Phát"
    assert r["tinh_trang"] == theo_doi.TT_O_NHA_GIA_CONG


def test_viec_ghep_mot_dong_mang_du_lenh(sess, ghep_doi):
    a, b, cv_chung = ghep_doi
    may = _may(sess, "MAY-TM-GHEP", "Máy in ghép (TM)")
    cv_chung.may_id = may.id
    cv_chung.trang_thai = CV_DANG_CHAY
    sess.commit()
    r = _dong_may(_theo_may(sess), may.id)
    viec = r["dang_chay"]
    assert viec["cong_viec_id"] == cv_chung.id
    assert sorted(l["lsx_id"] for l in viec["lsx"]) == sorted([a, b])
    assert viec["bai_ma"] and viec["bai_ma"].startswith("GB-API-")
    assert r["san_luong"]["ca_bai"] is True


def test_me_khac_don_vi_khong_cong(sess, lenh_that):
    cv = _cvs(sess, lenh_that)[1]
    may = _may(sess, "MAY-TM-DV", "Máy hai đơn vị (TM)")
    cv.may_id = may.id
    cv.trang_thai = CV_DANG_CHAY
    sess.commit()
    dv = cv.don_vi_ra
    _batch(sess, cv, 300, dv)
    sl = _dong_may(_theo_may(sess), may.id)["san_luong"]
    assert sl["tot"] == 300 and sl["theo_don_vi"] == []

    _batch(sess, cv, 2, "ram")
    sl = _dong_may(_theo_may(sess), may.id)["san_luong"]
    assert sl["tot"] is None
    assert {(x["don_vi"], x["tot"]) for x in sl["theo_don_vi"]} == {(dv, 300.0), ("ram", 2.0)}


def test_may_ngung_dung_het_no_khong_hien_con_no_thi_hien(sess, lenh_that):
    het_no = _may(sess, "MAY-TM-NGUNG1", "Máy thanh lý sạch nợ", active=False)
    con_no = _may(sess, "MAY-TM-NGUNG2", "Máy thanh lý còn nợ", active=False)
    _gan_may(sess, _cvs(sess, lenh_that)[0], con_no)
    d = _theo_may(sess)
    moi_dong = [r for g in d["nhom"] for r in g["dong"]] + d["may_trong"]
    assert het_no.id not in {r["may_id"] for r in moi_dong}
    assert _dong_may(d, con_no.id)["ngung_dung"] is True


def test_loc_o_tim_chi_con_may_co_viec_cua_lenh_khop(sess, lenh_that, orders, lsx_svc, admin, customer):
    _dot_dong_don(sess, 13)
    khac = _phat_hanh_that(sess, orders, lsx_svc, admin, customer, buoc=[("CTP", 15, 500)])
    m1 = _may(sess, "MAY-TM-Q1", "Máy lệnh một (TM)")
    m2 = _may(sess, "MAY-TM-Q2", "Máy lệnh hai (TM)")
    for cv in _cvs(sess, lenh_that):
        cv.may_id = m1.id
    for cv in _cvs(sess, khac):
        cv.may_id = m2.id
    sess.commit()
    ma = sess.get(Lsx, lenh_that).ma
    d = _theo_may(sess, q=ma)
    assert [r["may_id"] for g in d["nhom"] for r in g["dong"]] == [m1.id]
    assert d["may_trong"] == []
    assert d["bat_thuong"] == _theo_may(sess)["bat_thuong"]


def test_loc_chua_may_chi_con_nhom_chua_co_may(sess, lenh_that):
    may = _may(sess, "MAY-TM-CM", "Máy (CM)")
    _gan_may(sess, _cvs(sess, lenh_that)[0], may)
    d = _theo_may(sess, bat_thuong=theo_doi.BT_CHUA_MAY)
    assert [g["loai"] for g in d["nhom"]] == [theo_doi.NHOM_CHUA_MAY]
    assert len(d["nhom"][0]["dong"]) == 2
    assert d["may_trong"] == []


def test_so_cau_sql_hang_tren_truc_lenh(sess, orders, lsx_svc, admin, customer):
    may = _may(sess, "MAY-TM-SQL", "Máy (SQL)")
    buoc = [("CTP", 15, 500), ("In", 360, 5000)]
    _dot_dong_don(sess, 6)

    def them():
        lsx_id = _phat_hanh_that(sess, orders, lsx_svc, admin, customer, buoc=buoc)
        for cv in _cvs(sess, lsx_id):
            cv.may_id = may.id
        sess.commit()

    for _ in range(3):
        them()
    n3 = _dem_sql(lambda: _theo_may(sess))
    for _ in range(2):
        them()
    n5 = _dem_sql(lambda: _theo_may(sess))
    assert n3 == n5, f"số câu SQL nở theo số lệnh: {n3} → {n5}"


def test_api_theo_may(client, seed_credentials, sess, lenh_that):
    h = _h(_tok(client, seed_credentials))
    r = client.get("/api/theo-doi-san-xuat/theo-may", headers=h)
    assert r.status_code == 200
    assert set(r.json()) == {"nhom", "may_trong", "bat_thuong"}
    assert client.get(
        "/api/theo-doi-san-xuat/theo-may?bat_thuong=la", headers=h
    ).status_code == 422
    assert client.get("/api/theo-doi-san-xuat/theo-may", headers=_h(
        _token_khong_quyen_theo_doi(sess)
    )).status_code == 403
