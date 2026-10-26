"""Gia công TRỌN GÓI (spec 2026-09-26 §4): cả lệnh ra ngoài, không xuống xưởng."""
from __future__ import annotations

import pytest

from app.models.gia_cong_ngoai import KIEU_TRON_GOI, NOI_VE_KHO, GiaCongNgoai
from app.models.lsx import TT_DA_PHAT_HANH, TT_NHAP, Lsx, LsxCongDoanPhuThuoc
from app.models.san_xuat import (
    BUOC_THUE_NGOAI, GOI_DA_THU_HOI, SanXuatCongViec, SanXuatGoiPhatHanh,
)
from app.models.stock_request import REQ_NHAP, REQ_XUAT, StockRequest
from app.models.xep_lich import XepLichCongDoan
from app.models.xep_lich_lenh import XepLichLenh
from app.services.gia_cong_ngoai import TT_DA_HUY, TT_DANG_GIA_CONG
from app.services.gia_cong_ngoai.chot import chot
from app.services.gia_cong_ngoai.lan import lan_cua_lenh
from app.services.gia_cong_ngoai.tron_goi import (
    dat_tron_goi, de_nghi_xuat_giay, huy_tron_goi, ly_do_khong_tron_goi,
)
from tests.gia_cong_fixtures import hang_can_cua, lenh_chua_phat, ncc, them_giay
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401


@pytest.fixture
def lenh(sess, orders, lsx_svc, admin, customer) -> Lsx:
    return lenh_chua_phat(sess, orders, lsx_svc, admin, customer)


def _dat(sess, admin, lenh, *, xuong_cap_giay=False):
    a = ncc(sess, "In hộp Phú Thịnh")
    kq = dat_tron_goi(sess, user=admin, lsx_id=lenh.id, nha_cung_cap_id=a.id, sl_dat=20_000,
                      xuong_cap_giay=xuong_cap_giay)
    return sess.get(GiaCongNgoai, kq["gia_cong_ngoai_id"])


def test_dat_tron_goi_phat_hanh_mot_cong_viec_khong_to(sess, admin, lenh):
    lan = _dat(sess, admin, lenh)
    sess.refresh(lenh)
    assert lenh.trang_thai == TT_DA_PHAT_HANH and lan.kieu == KIEU_TRON_GOI
    (cv,) = sess.query(SanXuatCongViec).filter_by(lsx_id=lenh.id).all()
    assert cv.gia_cong_ngoai_id == lan.id and cv.department_id is None
    assert cv.la_kcs_cuoi and cv.loai_buoc == BUOC_THUE_NGOAI
    assert float(cv.so_luong_ra) == 20_000 and cv.don_vi_ra == lan.don_vi
    assert sess.query(XepLichLenh).filter_by(lsx_id=lenh.id).count() == 0
    (d,) = lan_cua_lenh(sess, lenh.id)
    assert d["trang_thai"] == TT_DANG_GIA_CONG and d["xuat_giay"] is None


def test_lenh_da_phat_hanh_thi_khong_dat_duoc(sess, admin, lenh):
    lenh.trang_thai = TT_DA_PHAT_HANH
    sess.commit()
    with pytest.raises(ValueError, match="đã phát hành"):
        _dat(sess, admin, lenh)


def test_lenh_dung_rieng_khong_bi_chan(sess, lenh):
    assert ly_do_khong_tron_goi(sess, lenh.id) is None


def test_lenh_di_chung_lenh_khac_noi_dich_danh(sess, orders, lsx_svc, admin, customer, lenh):
    """Bìa nối công đoạn chéo sang ruột (vd Cắt thành phẩm chờ Xén 3 mặt) ⇒ câu chặn nêu đích danh
    lệnh kia, và màn lệnh nhận đúng câu đó TRƯỚC khi mở hộp thoại trọn gói."""
    khac = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    khac.ten = "Ruột sách A5"
    sess.add(LsxCongDoanPhuThuoc(buoc_truoc_id=khac.cong_doans[-1].id,
                                 buoc_sau_id=lenh.cong_doans[-1].id))
    sess.commit()

    ly_do = ly_do_khong_tron_goi(sess, lenh.id)
    assert ly_do and f"{khac.ma} (Ruột sách A5)" in ly_do
    with pytest.raises(ValueError, match=khac.ma):
        _dat(sess, admin, lenh)

    from app.routers.lsx import _out
    out = _out(lsx_svc, lenh)
    assert out.tron_goi_chan == ly_do and khac.ma in out.tron_goi_chan_ngan
    lenh.trang_thai = TT_DA_PHAT_HANH
    sess.commit()
    out = _out(lsx_svc, lenh)
    assert out.tron_goi_chan is None and out.tron_goi_chan_ngan is None


def test_lenh_trong_bai_ghep_noi_ma_bai(sess, orders, lsx_svc, admin, customer):
    from tests.gia_cong_fixtures import dung_bai_ghep_gia_cong
    bg, a, _b = dung_bai_ghep_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=[
        ("In", "may", None, 1000, "to", "to"),
        ("Bế", "may", None, 4000, "to", "cai"),
    ], chung=[0], phat_hanh=False)
    ly_do = ly_do_khong_tron_goi(sess, a)
    assert ly_do and f"bài ghép {bg.ma}" in ly_do


def test_chot_tron_goi_ve_kho(sess, admin, lenh):
    lan = _dat(sess, admin, lenh)
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
         sl_cuoi=19_800, noi_ve=NOI_VE_KHO)
    req = sess.query(StockRequest).filter_by(gia_cong_ngoai_id=lan.id, loai=REQ_NHAP).one()
    assert float(req.lines[0].sl_de_nghi) == 19_800


def test_huy_tron_goi_ve_nhap_thu_hoi_goi(sess, admin, lenh):
    lan = _dat(sess, admin, lenh)
    huy_tron_goi(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
                 ly_do="Khách đổi mẫu")
    sess.refresh(lenh)
    sess.refresh(lan)
    assert lenh.trang_thai == TT_NHAP and lan.ly_do_huy == "Khách đổi mẫu"
    goi_id = sess.query(SanXuatCongViec).filter_by(lsx_id=lenh.id).one().goi_id
    assert sess.get(SanXuatGoiPhatHanh, goi_id).trang_thai == GOI_DA_THU_HOI
    (d,) = lan_cua_lenh(sess, lenh.id)
    assert d["trang_thai"] == TT_DA_HUY


def test_lenh_tron_goi_khong_len_man_kcs(sess, admin, lenh):
    """Trọn gói không xuống xưởng, KCS không kiểm hàng gia công về (09/10/2026) — đặt trọn gói cũng
    đưa lệnh vào nhóm thành phẩm, nhưng màn KCS (danh sách + ô Khách hàng) không được liệt kê nó."""
    from app.services.san_xuat import kcs
    from tests.test_san_xuat_kcs import _to_kiem

    _d, nguoi = _to_kiem(sess)
    _dat(sess, admin, lenh)
    out = kcs.danh_sach_lenh_kcs(sess, nguoi)
    assert lenh.id not in [i["lsx_id"] for i in out["items"]] and out["tong"] == 0
    assert kcs.khach_loc_kcs(sess, nguoi) == []


def _lo(sess, giay_id, rong, dai, sl, *, ma, goc):
    """Một lô giấy trong một kho riêng của test: tờ đúng khổ (`to`) hoặc cuộn `(rộng, 0)` (`kg`)."""
    from datetime import date

    from app.models.kho_hang import KhoHang
    from app.models.stock_lot import StockLot

    kho = sess.query(KhoHang).filter_by(ma="KHO-GCT").one_or_none()
    if kho is None:
        kho = KhoHang(ma="KHO-GCT", ten="Kho giấy test")
        sess.add(kho)
        sess.flush()
    sess.add(StockLot(ma_lo=ma, hang_loai="giay", hang_id=giay_id, kho_id=kho.id,
                      don_vi_goc=goc, kho_rong=rong, kho_dai=dai, ngay_nhap=date(2026, 10, 1),
                      sl_ban_dau=sl, sl_con_lai=sl))
    sess.commit()


def _lo_to(sess, giay_id, rong, dai, so_to, *, ma):
    _lo(sess, giay_id, rong, dai, so_to, ma=ma, goc="to")


def _bo_giay_buoc(sess, lenh):
    """Lệnh cũ chưa khai giấy ở bước (trước khâu chuẩn bị giấy 24/10/2026) — gỡ dòng giấy mà lập
    lệnh nay tự gắn, để thử đường đọc quy cách."""
    for c in lenh.cong_doans:
        for vt in list(c.vat_tus):
            if vt.hang_loai == "giay":
                sess.delete(vt)
    sess.commit()


def _xuat(sess, admin, lan, *, kho=(790, 1090), so_to=1112):
    sess.refresh(lan)
    return de_nghi_xuat_giay(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
                             kho_rong=kho[0], kho_dai=kho[1], so_to=so_to)


def test_cho_cap_giay_goi_y_theo_phieu_va_ton_theo_kho(sess, admin, lenh):
    """C1: lần trọn gói xưởng cấp giấy chưa gửi đề nghị ⇒ dict lần mang sẵn phần "Chọn giấy":
    khổ + số tờ theo phiếu tính giá, và tồn tờ của mã giấy chia theo khổ (khổ đúng phiếu đứng đầu,
    kể cả khi kho hết)."""
    _bo_giay_buoc(sess, lenh)
    lan = _dat(sess, admin, lenh, xuong_cap_giay=True)
    giay_id = int(lenh.quy_cach_json["giay_id"])
    (d,) = lan_cua_lenh(sess, lenh.id)
    cg = d["cap_giay"]
    assert cg["giay_id"] == giay_id and cg["nguon"] == "phiếu tính giá"
    assert cg["de_xuat"] == {"kho_rong": 790, "kho_dai": 1090, "so_to": float(lenh.so_to_nguyen),
                             "don_vi": "to"}
    assert cg["kho"] == [{"kho_rong": 790, "kho_dai": 1090, "ton": 0.0, "don_vi": "to",
                          "dung_de_xuat": True}]

    _lo_to(sess, giay_id, 650, 860, 2000, ma="LOT-T1")
    _lo_to(sess, giay_id, 790, 1090, 300, ma="LOT-T2")
    _lo_to(sess, giay_id, 790, 1090, 200, ma="LOT-T3")
    (d,) = lan_cua_lenh(sess, lenh.id)
    assert [(k["kho_rong"], k["kho_dai"], k["ton"], k["dung_de_xuat"]) for k in d["cap_giay"]["kho"]] == [
        (790, 1090, 500.0, True), (650, 860, 2000.0, False)]


def test_xuong_cap_giay_lap_de_nghi_xuat_mot_lan(sess, admin, lenh):
    from app.services.kho_giay import don_vi_goc_to

    lan = _dat(sess, admin, lenh, xuong_cap_giay=True)
    # Khổ gửi lên theo thứ tự nào cũng được — máy chủ chuẩn hoá (cạnh ngắn, cạnh dài).
    _xuat(sess, admin, lan, kho=(1090, 790), so_to=1200)
    req = sess.query(StockRequest).filter_by(gia_cong_ngoai_id=lan.id, loai=REQ_XUAT).one()
    (ln,) = req.lines
    assert (ln.hang_loai, ln.hang_id, ln.don_vi_goc, ln.kho_rong, ln.kho_dai) == (
        "giay", int(lenh.quy_cach_json["giay_id"]), "to", 790, 1090)
    assert float(ln.sl_de_nghi) == 1200 and ln.dvt == don_vi_goc_to() and ln.lsx_id == lenh.id
    (d,) = lan_cua_lenh(sess, lenh.id)
    assert d["xuat_giay"]["ma"] == req.ma and d["cap_giay"] is None
    assert (d["xuat_giay"]["kho_rong"], d["xuat_giay"]["kho_dai"], d["xuat_giay"]["so_to"]) == (
        790, 1090, 1200.0)
    with pytest.raises(ValueError, match="đã có đề nghị"):
        _xuat(sess, admin, lan)


def _lo_cuon(sess, giay_id, rong, kg, *, ma):
    _lo(sess, giay_id, rong, 0, kg, ma=ma, goc="kg")


def _giay_cuon(sess, lenh, *, rong=870, kg=395.85):
    """Lệnh nguồn cuộn: bước đầu (Cắt giấy cuộn) mang giấy kg khổ `(rộng cuộn, 0)`."""
    vt = them_giay(sess, lenh, so_luong=kg, don_vi="kg")
    vt.don_vi_goc, vt.kho_rong, vt.kho_dai = "kg", rong, 0
    sess.commit()
    return vt


def test_cho_cap_giay_nguon_cuon_de_xuat_kg_theo_rong(sess, admin, lenh):
    """Lệnh lấy giấy từ cuộn (24/10/2026 e2e): "Chọn giấy" đề xuất đúng cuộn của lệnh tính kg, và
    liệt kê cả cuộn (theo rộng, kg) lẫn tờ (theo khổ) của mã giấy — mỗi dòng mang đơn vị của nó."""
    vt = _giay_cuon(sess, lenh)
    _dat(sess, admin, lenh, xuong_cap_giay=True)
    _lo_cuon(sess, vt.vat_tu_id, 870, 5000, ma="LOT-C1")
    _lo_to(sess, vt.vat_tu_id, 650, 860, 2000, ma="LOT-T1")
    (d,) = lan_cua_lenh(sess, lenh.id)
    cg = d["cap_giay"]
    assert cg["nguon"] == "lệnh" and cg["don_vi"] == "kg"
    assert cg["de_xuat"] == {"kho_rong": 870, "kho_dai": 0, "so_to": 395.85, "don_vi": "kg"}
    assert [(k["kho_rong"], k["kho_dai"], k["ton"], k["don_vi"], k["dung_de_xuat"])
            for k in cg["kho"]] == [(870, 0, 5000.0, "kg", True), (650, 860, 2000.0, "to", False)]


def test_xuong_cap_cuon_lap_dong_kg(sess, admin, lenh):
    vt = _giay_cuon(sess, lenh)
    lan = _dat(sess, admin, lenh, xuong_cap_giay=True)
    _xuat(sess, admin, lan, kho=(870, 0), so_to=395.85)
    req = sess.query(StockRequest).filter_by(gia_cong_ngoai_id=lan.id, loai=REQ_XUAT).one()
    (ln,) = req.lines
    assert (ln.hang_id, ln.dvt, ln.kho_rong, ln.kho_dai) == (vt.vat_tu_id, "kg", 870, 0)
    assert float(ln.sl_de_nghi) == 395.85
    (d,) = lan_cua_lenh(sess, lenh.id)
    assert (d["xuat_giay"]["kho_rong"], d["xuat_giay"]["kho_dai"], d["xuat_giay"]["don_vi"]) == (
        870, 0, "kg")


def test_o_giay_liet_ke_phieu_xuat_kho_cua_de_nghi(sess, admin, lenh):
    """Ô Giấy hiện mã PXK lập theo đề nghị (bấm mở được) — xuất nhiều đợt thì nhiều phiếu, phiếu
    huỷ không hiện."""
    from datetime import date

    from app.models.kho_hang import KhoHang
    from app.models.stock_voucher import (
        VOUCHER_CANCELLED, VOUCHER_DRAFT, VOUCHER_POSTED, VOUCHER_XUAT, StockVoucher,
    )

    lan = _dat(sess, admin, lenh, xuong_cap_giay=True)
    req = _xuat(sess, admin, lan)
    (d,) = lan_cua_lenh(sess, lenh.id)
    assert d["xuat_giay"]["id"] == req.id and d["xuat_giay"]["phieu"] == []

    kho = KhoHang(ma="KHO-PXK", ten="Kho giấy test")
    sess.add(kho)
    sess.flush()
    for ma, tt in (("PXK-T1", VOUCHER_POSTED), ("PXK-T2", VOUCHER_CANCELLED), ("PXK-T3", VOUCHER_DRAFT)):
        sess.add(StockVoucher(ma=ma, loai=VOUCHER_XUAT, request_id=req.id, kho_id=kho.id,
                              ngay=date(2026, 10, 7), nguoi_lap_id=admin.id, trang_thai=tt))
    sess.commit()
    (d,) = lan_cua_lenh(sess, lenh.id)
    assert [(p["ma"], p["trang_thai"]) for p in d["xuat_giay"]["phieu"]] == [
        ("PXK-T1", VOUCHER_POSTED), ("PXK-T3", VOUCHER_DRAFT)]


def test_kho_tu_choi_thi_chon_giay_lai(sess, admin, lenh):
    from app.models.stock_request import REQ_REJECTED

    lan = _dat(sess, admin, lenh, xuong_cap_giay=True)
    req = _xuat(sess, admin, lan)
    req.trang_thai = REQ_REJECTED
    sess.commit()
    (d,) = lan_cua_lenh(sess, lenh.id)
    assert d["xuat_giay"] is None and d["cap_giay"] is not None
    _xuat(sess, admin, lan, so_to=1000)
    assert sess.query(StockRequest).filter_by(gia_cong_ngoai_id=lan.id, loai=REQ_XUAT).count() == 2


def test_xuat_giay_kiem_kho_va_so_to(sess, admin, lenh):
    lan = _dat(sess, admin, lenh, xuong_cap_giay=True)
    with pytest.raises(ValueError, match="khổ"):
        _xuat(sess, admin, lan, kho=(0, 0))
    with pytest.raises(ValueError, match="Số lượng"):
        _xuat(sess, admin, lan, so_to=0)


def test_bang_lenh_chip_cho_cap_giay(sess, admin, lenh, lsx_svc):
    """Chip "Chờ cấp giấy" trên bảng lệnh: bật khi trọn gói xưởng cấp giấy chưa gửi đề nghị, tắt
    ngay khi gửi."""
    from app.repositories.gia_cong_ngoai_repo import GiaCongNgoaiRepository
    from app.services.gia_cong_ngoai import lan_can_hoi_xuat_giay, tom_tat_theo_lenh

    def chip():
        repo = GiaCongNgoaiRepository(sess)
        cap = repo.cua_nhieu_lenh([lenh.id])
        return tom_tat_theo_lenh(cap, repo.co_yeu_cau_xuat(lan_can_hoi_xuat_giay(cap)))[
            lenh.id]["cho_cap_giay"]

    lan = _dat(sess, admin, lenh, xuong_cap_giay=True)
    assert chip() is True
    _xuat(sess, admin, lan)
    assert chip() is False


def test_nha_gia_cong_lo_giay_khong_cho_cap_giay(sess, admin, lenh):
    _dat(sess, admin, lenh, xuong_cap_giay=False)
    (d,) = lan_cua_lenh(sess, lenh.id)
    assert d["cap_giay"] is None and d["xuat_giay"] is None


def test_nha_gia_cong_lo_giay_thi_khong_xuat(sess, admin, lenh):
    lan = _dat(sess, admin, lenh, xuong_cap_giay=False)
    with pytest.raises(ValueError, match="tự lo giấy"):
        _xuat(sess, admin, lan)


def test_can_doi_vat_tu_bo_giay_khi_nha_gia_cong_lo(sess, admin, lenh):
    giay = ("giay", them_giay(sess, lenh).vat_tu_id)
    assert giay in hang_can_cua(sess, lenh.id)
    _dat(sess, admin, lenh, xuong_cap_giay=False)
    assert giay not in hang_can_cua(sess, lenh.id)


def test_can_doi_vat_tu_giu_giay_khi_xuong_cap(sess, admin, lenh):
    giay = ("giay", them_giay(sess, lenh).vat_tu_id)
    _dat(sess, admin, lenh, xuong_cap_giay=True)
    assert giay in hang_can_cua(sess, lenh.id)


def test_api_dat_tron_goi(client, sess, admin, lenh):
    a = ncc(sess, "In hộp Phú Thịnh")
    tok = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    h = {"Authorization": f"Bearer {tok.json()['access_token']}"}
    r = client.post(f"/api/gia-cong-ngoai/lenh/{lenh.id}/tron-goi", headers=h, json={
        "nha_cung_cap_id": a.id, "sl_dat": 20000, "xuong_cap_giay": False})
    assert r.status_code == 200, r.text
    assert r.json()["kieu"] == "tron_goi" and r.json()["trang_thai"] == "dang_gia_cong"


# --- Fix round 1 ------------------------------------------------------------------------------

def test_dat_tron_goi_tu_go_dong_xep_lich(sess, admin, lenh):
    """Lệnh đã có dòng xếp lịch công đoạn: đặt trọn gói tự xoá dòng đó thay vì bắt tay xoá trước
    (spec §4 bước 1)."""
    buoc = sorted(lenh.cong_doans, key=lambda c: c.thu_tu)[0]
    dong = XepLichCongDoan(nguon="lsx", lsx_id=lenh.id, lsx_cong_doan_id=buoc.id,
                           source_thu_tu=buoc.thu_tu, loai_buoc="may")
    sess.add(dong)
    sess.commit()
    _dat(sess, admin, lenh)
    assert sess.query(XepLichCongDoan).filter_by(lsx_id=lenh.id).count() == 0


def test_huy_tron_goi_bat_lai_giu_cho(sess, admin, lenh, monkeypatch):
    """Đặt trọn gói xưởng cấp giấy giữ nguyên `giu_cho_bat=True` (chỉ còn giữ giấy). Huỷ phải gọi
    LẠI `GiuChoService.bat()` — cùng điều kiện `if lsx.giu_cho_bat` như lúc đặt — để nhặt lại theo
    nhu cầu ĐẦY ĐỦ một khi lệnh về Nháp, không dừng ở mỗi giấy."""
    import app.services.gia_cong_ngoai.tron_goi as tron_goi_mod
    from app.services.xep_lich.release import _giu_cho_service

    them_giay(sess, lenh)
    _giu_cho_service(sess).bat(lsx_id=lenh.id)  # bật giữ chỗ TRƯỚC khi đặt trọn gói, như lệnh thật
    sess.refresh(lenh)
    assert lenh.giu_cho_bat

    goi_lan_dau: list[dict] = []
    goc_giu_cho = tron_goi_mod._giu_cho

    def _theo_doi(db):
        svc = goc_giu_cho(db)
        goc_bat = svc.bat
        svc.bat = lambda **kw: (goi_lan_dau.append(kw), goc_bat(**kw))[1]
        return svc

    monkeypatch.setattr(tron_goi_mod, "_giu_cho", _theo_doi)

    lan = _dat(sess, admin, lenh, xuong_cap_giay=True)
    sess.refresh(lenh)
    assert lenh.giu_cho_bat
    assert goi_lan_dau == [{"lsx_id": lenh.id}]  # `dat_tron_goi` tự bật lại cho phần giấy

    huy_tron_goi(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
                 ly_do="Khách đổi mẫu")
    sess.refresh(lenh)
    assert lenh.giu_cho_bat
    assert goi_lan_dau == [{"lsx_id": lenh.id}, {"lsx_id": lenh.id}]  # huỷ gọi lại `bat()` lần 2


def test_huy_tron_goi_ncc_lo_giay_bat_lai_giu_cho(sess, admin, lenh, monkeypatch):
    """Fix round 2: NCC LO GIẤY (`xuong_cap_giay=False`) — `dat_tron_goi` tắt hẳn `giu_cho_bat`,
    không có nhánh bật lại nên cờ về False. Không có cách nào đọc lại cờ TRƯỚC lúc đặt (không lưu
    riêng), nên huỷ BẬT LẠI VÔ ĐIỀU KIỆN cho đúng trường hợp này — chấp nhận bật cả khi lệnh trước
    đó có thể chưa từng bật giữ chỗ."""
    import app.services.gia_cong_ngoai.tron_goi as tron_goi_mod
    from app.services.xep_lich.release import _giu_cho_service

    them_giay(sess, lenh)
    _giu_cho_service(sess).bat(lsx_id=lenh.id)
    sess.refresh(lenh)
    assert lenh.giu_cho_bat

    goi_lan_dau: list[dict] = []
    goc_giu_cho = tron_goi_mod._giu_cho

    def _theo_doi(db):
        svc = goc_giu_cho(db)
        goc_bat = svc.bat
        svc.bat = lambda **kw: (goi_lan_dau.append(kw), goc_bat(**kw))[1]
        return svc

    monkeypatch.setattr(tron_goi_mod, "_giu_cho", _theo_doi)

    lan = _dat(sess, admin, lenh, xuong_cap_giay=False)
    sess.refresh(lenh)
    assert not lenh.giu_cho_bat  # đặt tắt hẳn — không nhánh nào bật lại khi NCC lo giấy
    assert goi_lan_dau == []  # `dat_tron_goi` không gọi `bat()` ở nhánh này

    huy_tron_goi(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
                 ly_do="Khách đổi mẫu")
    sess.refresh(lenh)
    assert lenh.giu_cho_bat  # huỷ tự bật lại
    assert goi_lan_dau == [{"lsx_id": lenh.id}]  # và gọi `bat()` đúng một lần


def test_de_nghi_xuat_giay_ghi_chu_dung_mau(sess, admin, lenh):
    lan = _dat(sess, admin, lenh, xuong_cap_giay=True)
    req = _xuat(sess, admin, lan)
    assert req.ghi_chu.startswith("Cấp giấy gia công trọn gói — In hộp Phú Thịnh")
    assert lenh.ma in req.ghi_chu


# --- Final fix: đơn vị lệnh ≠ đơn vị món Thành phẩm (C1/I1) + phạm vi lệnh (I2) ----------------

def _hop_bang_10_cai(sess, lenh):
    """Lệnh đếm theo HỘP, dòng đơn + món Thành phẩm đếm theo CÁI; 1 hộp = 10 cái."""
    from app.models.don_vi_do import DonViDo, DonViQuyDoi
    from app.models.order import OrderLine

    hop = sess.query(DonViDo).filter(DonViDo.ma == "hop").one()
    cai = sess.query(DonViDo).filter(DonViDo.ma == "cai").one()
    sess.add(DonViQuyDoi(tu_id=hop.id, den_id=cai.id, he_so=10))
    lenh.don_vi_tinh = "hop"
    sess.get(OrderLine, lenh.order_line_id).don_vi_tinh = "cai"
    sess.commit()


def test_tron_goi_luu_so_theo_don_vi_lenh(sess, admin, lenh):
    _hop_bang_10_cai(sess, lenh)
    lan = _dat(sess, admin, lenh)
    (cv,) = sess.query(SanXuatCongViec).filter_by(lsx_id=lenh.id).all()
    assert lan.don_vi == "hop" and cv.don_vi_ra == "hop" and float(cv.so_luong_ra) == 20_000


def test_tron_goi_ve_kho_quy_sang_don_vi_thanh_pham(sess, admin, lenh):
    from app.services.thanh_pham_khai_bao import khai_mot_dong
    from app.models.order import Order, OrderLine

    _hop_bang_10_cai(sess, lenh)
    order = sess.get(Order, lenh.order_id)
    tp = khai_mot_dong(sess, order, sess.get(OrderLine, lenh.order_line_id))
    tp.don_vi_gia = "cai"
    sess.commit()
    lan = _dat(sess, admin, lenh)
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
         sl_cuoi=100, noi_ve=NOI_VE_KHO)
    req = sess.query(StockRequest).filter_by(gia_cong_ngoai_id=lan.id, loai=REQ_NHAP).one()
    (ln,) = req.lines
    # 100 hộp = 1.000 cái — kho nhận đúng số cái, không phải 100 cái.
    assert ln.dvt == "cai" and float(ln.sl_de_nghi) == 1_000


def test_tron_goi_giao_thang_quy_ve_don_vi_dong_don(sess, admin, lenh):
    from app.models.gia_cong_ngoai import NOI_VE_KHACH
    from app.repositories.delivery_repo import DeliveryRepository
    from app.models.order import OrderLine
    from tests.gia_cong_fixtures import nhan_vien_cua

    _hop_bang_10_cai(sess, lenh)
    dong = sess.get(OrderLine, lenh.order_line_id)
    dong.qty = 1_000
    sess.commit()
    nhan_vien_cua(sess, admin)
    lan = _dat(sess, admin, lenh)
    # 101 hộp = 1.010 cái > 1.000 cái còn phải giao ⇒ chặn (so CÙNG đơn vị dòng đơn).
    with pytest.raises(ValueError, match="còn phải giao 1000"):
        chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
             sl_cuoi=101, noi_ve=NOI_VE_KHACH)
    sess.rollback()
    sess.refresh(lan)
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
         sl_cuoi=100, noi_ve=NOI_VE_KHACH)
    assert DeliveryRepository(sess).da_giao_theo_dong(lenh.order_id)[lenh.order_line_id] == 1_000


def test_giao_thang_tinh_la_hang_da_co_va_khong_an_phan_kho(sess, admin, lenh):
    """06/10/2026: giao thẳng không qua kho ⇒ tiến độ đơn tách riêng `giao_thang` (để Sản xuất của
    đơn tính "đủ hàng") và phần kho còn giao được KHÔNG bị số giao thẳng trừ lẹm."""
    from app.models.gia_cong_ngoai import NOI_VE_KHACH
    from app.models.order import Order, OrderLine
    from app.services.don_hang_tien_do import tien_do_don
    from tests.gia_cong_fixtures import nhan_vien_cua

    _hop_bang_10_cai(sess, lenh)
    dong = sess.get(OrderLine, lenh.order_line_id)
    dong.qty = 1_000
    sess.commit()
    nhan_vien_cua(sess, admin)
    lan = _dat(sess, admin, lenh)
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
         sl_cuoi=100, noi_ve=NOI_VE_KHACH)
    don = sess.get(Order, dong.order_id)
    (c,) = [c for c in tien_do_don(sess, don)["cum"] if dong.id in c["order_line_ids"]]
    assert c["da_giao"] == 1_000 and c["giao_thang"] == 1_000
    assert c["kho_da_nhan"] == 0 and c["giao_duoc"] == 0 and c["con_phai_giao"] == 0


def test_nguoi_pham_vi_rieng_khong_dung_lenh_nguoi_khac(sess, admin, lenh):
    from fastapi import HTTPException

    from app.models.role import SCOPE_OWN
    from app.models.user import User
    from app.routers import gia_cong_ngoai as r
    from app.schemas.gia_cong_ngoai import HuyTronGoiIn

    class _Authz:
        def scope_for(self, user, module_key):  # noqa: ARG002
            return SCOPE_OWN

        def can(self, *a, **k):  # noqa: ARG002
            return False

    lan = _dat(sess, admin, lenh)
    la = User(username="to_truong_gc", name="Tổ trưởng khác", password_hash="x")
    sess.add(la)
    sess.commit()
    with pytest.raises(HTTPException) as e:
        r.cua_lenh(lenh.id, sess, _Authz(), la)
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        r.huy_tron_goi(lan.id, HuyTronGoiIn(version=lan.version, ly_do="Khách đổi mẫu"), sess, _Authz(), la)
    assert e.value.status_code == 404
    sess.refresh(lan)
    assert lan.ly_do_huy is None


def test_den_vat_tu_xanh_khi_nha_gia_cong_lo_giay(sess, admin, lenh):
    """E2E 27/09: trọn gói NCC tự lo giấy tắt giữ chỗ ⇒ đèn vật tư từng báo đỏ "Chưa giữ chỗ vật
    tư", đẩy lệnh vào tab Cảnh báo (cờ Thiếu vật tư) kể cả khi hàng đã về kho. Lệnh không đòi gì
    từ kho thì đèn phải xanh; xưởng cấp giấy thì vẫn soi như lệnh thường."""
    from app.services import lsx_tong_quan

    them_giay(sess, lenh)
    _dat(sess, admin, lenh, xuong_cap_giay=False)
    den, _ = lsx_tong_quan.den_vat_tu_va_bang(sess, [lenh.id])
    assert den[lenh.id]["muc"] == lsx_tong_quan.MUC_OK


def test_ly_do_khong_mo_lai_khi_kho_da_lap_phieu(sess, admin, lenh, monkeypatch):
    """E2E 27/09: nút Mở lại hiện dù máy chủ chắc chắn từ chối. Lần dict nay trả lý do để FE khoá."""
    from app.repositories.stock_request_repo import StockRequestRepository

    lan = _dat(sess, admin, lenh)
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
         sl_cuoi=19_800, noi_ve=NOI_VE_KHO)
    (d,) = lan_cua_lenh(sess, lenh.id)
    assert d["ly_do_khong_mo_lai"] is None
    monkeypatch.setattr(StockRequestRepository, "co_voucher", lambda self, rid: True)
    (d,) = lan_cua_lenh(sess, lenh.id)
    assert "Kho đã lập phiếu" in d["ly_do_khong_mo_lai"]


def test_huy_roi_dat_lai_chot_xong_thi_lenh_xong_va_don_dem_dung(sess, admin, lenh):
    """E2E 27/09/2026: huỷ trọn gói (gói bị thu hồi) rồi đặt lại, chốt xong — việc của gói thu hồi
    không được tính, lệnh phải "xong" và đơn đếm 1 lệnh xong (trước đó kẹt 50%, 0/N lệnh)."""
    from app.models.order import Order, OrderLine
    from app.services.don_hang_tien_do import tien_do_don

    lan = _dat(sess, admin, lenh)
    huy_tron_goi(sess, user=admin, gcn_id=lan.id, expected_version=lan.version, ly_do="đổi nhà")
    lan = _dat(sess, admin, lenh)
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
         sl_cuoi=20_000, noi_ve=NOI_VE_KHO)
    don = sess.get(Order, sess.get(OrderLine, lenh.order_line_id).order_id)
    (x,) = [l for c in tien_do_don(sess, don)["cum"] for l in c["lenh"] if l["id"] == lenh.id]
    assert x["xong"] and x["pct"] == 100.0


def test_lan_da_huy_tren_man_lenh_khong_them_cau_hoi(sess, admin, lenh):
    """Hồ sơ lệnh chờ danh sách lần trước khi vẽ (06/10/2026) — lần đã huỷ chỉ là một dòng "Đã huỷ
    N lần", dựng đủ cấp giấy / phiếu chi / nhật ký cho nó là thêm ~10 câu SQL mỗi lần huỷ."""
    from sqlalchemy import event

    a = ncc(sess, "In hộp Phú Thịnh")

    def dat():
        kq = dat_tron_goi(sess, user=admin, lsx_id=lenh.id, nha_cung_cap_id=a.id, sl_dat=20_000,
                          xuong_cap_giay=True)
        return sess.get(GiaCongNgoai, kq["gia_cong_ngoai_id"])

    def dem_cau() -> int:
        n = [0]

        def _d(*_a):
            n[0] += 1
        event.listen(sess.bind, "before_cursor_execute", _d)
        try:
            sess.expire_all()
            lan_cua_lenh(sess, lenh.id)
        finally:
            event.remove(sess.bind, "before_cursor_execute", _d)
        return n[0]

    lan = dat()
    mot_lan = dem_cau()
    for ly_do in ("đổi nhà", "đổi giá"):
        huy_tron_goi(sess, user=admin, gcn_id=lan.id, expected_version=lan.version, ly_do=ly_do)
        lan = dat()
    assert dem_cau() <= mot_lan + 2   # + mã lệnh + tên người huỷ, chung cho mọi lần huỷ

    huy = [x for x in lan_cua_lenh(sess, lenh.id) if x["trang_thai"] == TT_DA_HUY]
    assert [x["ly_do_huy"] for x in huy] == ["đổi nhà", "đổi giá"]
    assert all(x["huy_boi_ten"] and x["lsx_ma"] == lenh.ma and x["nha_cung_cap_ten"] for x in huy)
    from app.schemas.gia_cong_ngoai import GiaCongNgoaiOut
    for x in huy:
        GiaCongNgoaiOut.model_validate(x)   # bản gọn vẫn đủ trường bắt buộc của API


def test_giao_thang_khong_quy_doi_duoc_chi_duong_sua(sess, admin, lenh):
    """Bước ra «cái», dòng đơn tính đơn vị không đổi được ⇒ câu lỗi nói bước nào, lệnh nào, và
    sửa ở đâu — không gợi ý khai cặp quy đổi toàn cục cho hai đơn vị khác loại."""
    from app.models.don_vi_do import DonViDo
    from app.models.gia_cong_ngoai import NOI_VE_KHACH
    from app.models.order import OrderLine
    from tests.gia_cong_fixtures import nhan_vien_cua

    kien = DonViDo(ma="kien_x", ten="kiện X", ho="khac")
    sess.add(kien)
    dong = sess.get(OrderLine, lenh.order_line_id)
    dong.don_vi_tinh = kien.ma
    lenh.don_vi_tinh = "cai"
    sess.commit()
    nhan_vien_cua(sess, admin)
    lan = _dat(sess, admin, lenh)
    with pytest.raises(ValueError, match=r"sang «kiện X» \(đơn vị dòng đơn") as e:
        chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
             sl_cuoi=100, noi_ve=NOI_VE_KHACH)
    msg = str(e.value)
    assert lenh.ma in msg and "tab Công đoạn" in msg and "Đơn hàng bán" in msg


def _ghi_bao_huy(monkeypatch) -> list:
    from app.services.stock_request_service import StockRequestService

    goi: list = []
    monkeypatch.setattr(StockRequestService, "thong_bao_da_huy", lambda self, req: goi.append(req.ma))
    return goi


def test_mo_lai_ve_kho_bao_kho_de_nghi_da_huy(sess, admin, lenh, monkeypatch):
    """E2E 27/09/2026: mở lại lần đã chốt về kho huỷ đề nghị nhập mà kho không được báo — badge
    "chờ cấp" đứng số cũ tới khi F5. Nay báo kho (sau commit) đúng đề nghị vừa huỷ."""
    from app.services.gia_cong_ngoai.chot import mo_lai

    goi = _ghi_bao_huy(monkeypatch)
    lan = _dat(sess, admin, lenh)
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
         sl_cuoi=19_800, noi_ve=NOI_VE_KHO)
    req = sess.query(StockRequest).filter_by(gia_cong_ngoai_id=lan.id, loai=REQ_NHAP).one()
    sess.refresh(lan)
    mo_lai(sess, user=admin, gcn_id=lan.id, expected_version=lan.version)
    assert goi == [req.ma]


def test_huy_tron_goi_bao_kho_de_nghi_xuat_giay_da_huy(sess, admin, lenh, monkeypatch):
    goi = _ghi_bao_huy(monkeypatch)
    lan = _dat(sess, admin, lenh, xuong_cap_giay=True)
    req = _xuat(sess, admin, lan)
    sess.refresh(lan)
    huy_tron_goi(sess, user=admin, gcn_id=lan.id, expected_version=lan.version, ly_do="đổi nhà")
    assert goi == [req.ma]


# --- Nhu cầu giấy + giữ chỗ của trọn gói xưởng cấp (06/10/2026) -------------------------------

def _giay_can(sess, lsx_id):
    """`[(rộng, dài, nhu cầu)]` dòng GIẤY của lệnh trong bảng cân đối vật tư."""
    from tests.gia_cong_fixtures import kh_vt

    bang = kh_vt(sess).can_doi(chi_lsx_ids={lsx_id})
    return sorted((n["kho_rong"], n["kho_dai"], float(d["nhu_cau"]))
                  for n in bang["items"] if n["hang_loai"] == "giay"
                  for d in n.get("dong", []) if d.get("lsx_id") == lsx_id)


def test_xuong_cap_giay_nhu_cau_theo_quy_cach_roi_theo_de_nghi(sess, admin, lenh):
    """Bước chưa khai giấy: nhu cầu giấy theo quy cách lệnh (khổ nguyên + số tờ nguyên). Gửi đề
    nghị khác khổ / số tờ thì nhu cầu đi theo đúng dòng đề nghị, khổ cũ rụng."""
    _bo_giay_buoc(sess, lenh)
    assert _giay_can(sess, lenh.id) == []  # lệnh cũ chưa khai giấy ở bước: không có
    lan = _dat(sess, admin, lenh, xuong_cap_giay=True)
    assert _giay_can(sess, lenh.id) == [(790, 1090, float(lenh.so_to_nguyen))]
    _xuat(sess, admin, lan, kho=(860, 650), so_to=1000)
    assert _giay_can(sess, lenh.id) == [(650, 860, 1000.0)]


def test_nha_gia_cong_lo_giay_khong_co_nhu_cau_giay(sess, admin, lenh):
    _dat(sess, admin, lenh, xuong_cap_giay=False)
    assert _giay_can(sess, lenh.id) == []


def _kho_da_xuat(sess, req, trang_thai="done"):
    """Kho ghi sổ phiếu xuất giấy — đề nghị sang Đã xuất một phần / đủ."""
    req.trang_thai = trang_thai
    sess.commit()


def test_xuong_cap_giay_kho_chua_xuat_thi_chua_nhan_ve(sess, admin, lenh):
    """Chặn cứng 07/10/2026: trọn gói xưởng cấp giấy, kho chưa ghi sổ phiếu xuất giấy ⇒ máy chủ
    từ chối chốt, dict lần mang lý do để nút "Nhận hàng về" khoá sẵn. Xuất một phần là đủ."""
    lan = _dat(sess, admin, lenh, xuong_cap_giay=True)
    (d,) = lan_cua_lenh(sess, lenh.id)
    assert "Chưa cấp giấy" in d["ly_do_khong_nhan_ve"]
    with pytest.raises(ValueError, match="Chưa cấp giấy"):
        chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
             sl_cuoi=19_800, noi_ve=NOI_VE_KHO)

    req = _xuat(sess, admin, lan)
    (d,) = lan_cua_lenh(sess, lenh.id)
    assert req.ma in d["ly_do_khong_nhan_ve"]
    sess.refresh(lan)
    with pytest.raises(ValueError, match="Kho chưa xuất giấy"):
        chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
             sl_cuoi=19_800, noi_ve=NOI_VE_KHO)

    _kho_da_xuat(sess, req, "partial")
    (d,) = lan_cua_lenh(sess, lenh.id)
    assert d["ly_do_khong_nhan_ve"] is None
    sess.refresh(lan)
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
         sl_cuoi=19_800, noi_ve=NOI_VE_KHO)
    sess.refresh(lan)
    assert lan.chot_luc is not None


def test_nha_gia_cong_lo_giay_nhan_ve_khong_can_xuat(sess, admin, lenh):
    lan = _dat(sess, admin, lenh, xuong_cap_giay=False)
    (d,) = lan_cua_lenh(sess, lenh.id)
    assert d["ly_do_khong_nhan_ve"] is None


def test_chot_so_thi_giay_rung(sess, admin, lenh):
    lan = _dat(sess, admin, lenh, xuong_cap_giay=True)
    _kho_da_xuat(sess, _xuat(sess, admin, lan))
    sess.refresh(lan)
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
         sl_cuoi=19_800, noi_ve=NOI_VE_KHO)
    assert _giay_can(sess, lenh.id) == []


def test_bat_giu_cho_giu_duoc_giay_tron_goi(sess, admin, lenh):
    """Lỗi cũ: giữ chỗ dựa dòng giấy của bước nên lệnh trọn gói xưởng cấp không giữ được gì. Nay
    giữ đúng khổ, và gửi đề nghị khổ khác thì giữ lại theo khổ mới."""
    from app.models.vat_tu_giu_cho import VatTuGiuCho
    from app.services.xep_lich.release import _giu_cho_service

    _bo_giay_buoc(sess, lenh)
    giay_id = int(lenh.quy_cach_json["giay_id"])
    _lo_to(sess, giay_id, 790, 1090, 5000, ma="LOT-G1")
    _lo_to(sess, giay_id, 650, 860, 5000, ma="LOT-G2")
    lan = _dat(sess, admin, lenh, xuong_cap_giay=True)
    _giu_cho_service(sess).bat(lsx_id=lenh.id)

    def giu():
        return sorted((g.kho_rong, g.kho_dai, float(g.so_luong)) for g in sess.query(VatTuGiuCho)
                      .filter_by(lsx_id=lenh.id, hang_loai="giay"))

    assert giu() == [(790, 1090, float(lenh.so_to_nguyen))]
    _xuat(sess, admin, lan, kho=(650, 860), so_to=1000)
    assert giu() == [(650, 860, 1000.0)]


def test_nhat_ky_lenh_gom_ca_gia_cong_kho_va_xuong(sess, admin, lenh):
    """Tab Nhật ký của lệnh (10/10/2026): trước chỉ đọc audit `lsx:{id}` nên lệnh trọn gói đã giao,
    đã xuất giấy, đã nhận về vẫn chỉ hiện "Tạo lệnh". Nay gom cả lần gia công ngoài, đề nghị kho,
    và công việc xưởng của lệnh (gắn thẻ tên công đoạn)."""
    from app.services.lsx_nhat_ky import nhat_ky

    lan = _dat(sess, admin, lenh)
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version,
         sl_cuoi=19_800, noi_ve=NOI_VE_KHO)

    items = nhat_ky(sess, lenh.id)
    actions = [x["action"] for x in items]
    for a in ("gia_cong_ngoai_dat", "gia_cong_ngoai_chot"):
        assert a in actions, a
    # Đề nghị nhập kho của lần gia công đã có dòng audit "chốt" ⇒ không lặp dòng "Lập đề nghị".
    assert "kho_de_nghi" not in actions
    # Việc trọn gói không thuộc tổ ⇒ không có dòng "Tổ nhận lệnh" sai nghĩa.
    assert not any(x["tieu_de"] == "Tổ nhận lệnh" for x in items)
    # Mới nhất trên cùng, câu không rỗng, có người thao tác cho dòng audit.
    ats = [x["at"] for x in items if x["at"]]
    assert ats == sorted(ats, reverse=True)
    assert all(x["tieu_de"] for x in items)
    assert next(x for x in items if x["action"] == "gia_cong_ngoai_chot")["actor_name"]


def test_nhat_ky_lenh_co_de_nghi_xuat_giay(sess, admin, lenh):
    from app.services.lsx_nhat_ky import nhat_ky

    lan = _dat(sess, admin, lenh, xuong_cap_giay=True)
    _xuat(sess, admin, lan, so_to=1200)
    req = sess.query(StockRequest).filter_by(gia_cong_ngoai_id=lan.id, loai=REQ_XUAT).one()
    items = nhat_ky(sess, lenh.id)
    assert any(x["action"] == "gia_cong_ngoai_xuat_giay" and req.ma in x["tieu_de"] for x in items)
    assert not any(x["action"] == "kho_de_nghi" for x in items)
