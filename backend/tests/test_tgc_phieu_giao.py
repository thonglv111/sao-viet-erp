"""Phiếu giao gia công (plan đợt 4): bán thành phẩm lấy theo bàn giao tổ bước trước, dải đầu lệnh gõ
số, vật tư xưởng cấp thành đề nghị xuất kho, giấy trọn gói chọn khổ, huỷ trả bàn giao về chờ."""
from __future__ import annotations

from datetime import date

import pytest

from app.models.kho_hang import KhoHang
from app.models.lsx import LB_THUE_NGOAI, LsxCongDoan, LsxCongDoanVatTu
from app.models.san_xuat import SanXuatCongViec
from app.models.san_xuat_san_luong import BG_DE_XUAT, BG_XAC_NHAN, SanXuatBanGiao
from app.models.stock_lot import LOT_AVAILABLE, StockLot
from app.models.stock_request import REQ_CANCELLED, REQ_XUAT, StockRequest
from app.models.thue_gia_cong import TgcViec
from app.models.vat_lieu_kho import VatTuInAn
from app.services.lsx_service import LsxConflict
from app.services.stock_request_service import StockRequestService
from app.services.thue_gia_cong import don as don_svc
from app.services.thue_gia_cong import phieu_giao as pg_svc
from app.services.thue_gia_cong.tron_goi import dat as dat_tron_goi
from tests.gia_cong_fixtures import cv_ten, dung_lenh_gia_cong, giao_sang, lenh_chua_phat, ncc
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401

ADMIN = {"username": "admin", "password": "admin123"}
_BUOC = [
    ("In", "may", None, 1660, "to"),
    ("Cán màng", "thue_ngoai", None, 1660, "to"),
    ("Bế", "may", None, 1650, "cai"),
]
_BUOC_DAU = [
    ("Cán màng", "thue_ngoai", None, 1660, "to"),
    ("Bế", "may", None, 1650, "cai"),
]


def _h(client) -> dict[str, str]:
    r = client.post("/api/auth/login", json=ADMIN)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _viec(sess, lsx_id) -> TgcViec:
    return sess.query(TgcViec).filter_by(lsx_id=lsx_id).one()


def _don(sess, admin, viec, *, dat=True, sl=1660):
    return don_svc.tao(sess, user=admin, nha_cung_cap_id=ncc(sess, "NCC phiếu giao").id,
                       ngay_dat=date.today(), dong=[{"viec_id": viec.id, "sl_dat": sl, "don_gia": 600}],
                       dat=dat)


def _lenh_va_don(sess, orders, lsx_svc, admin, customer, buoc=_BUOC):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=buoc)
    return a, _don(sess, admin, _viec(sess, a))


def _moi(client, h, don_id):
    r = client.get(f"/api/thue-gia-cong/don/{don_id}/phieu-giao/moi", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _lap(client, h, don_id, dong, *, version=None):
    if version is None:
        version = client.get(f"/api/thue-gia-cong/don/{don_id}", headers=h).json()["version"]
    return client.post(f"/api/thue-gia-cong/don/{don_id}/phieu-giao", headers=h,
                       json={"version": version, "dong": dong})


def _vat_tu_buoc_thue(sess, lsx_id, *, tu_lo: bool, so_luong=5.0) -> LsxCongDoanVatTu:
    m = VatTuInAn(ma=f"VT-PG-{lsx_id}-{int(tu_lo)}", ten="Màng BOPP bóng", don_vi_gia="kg", active=True)
    sess.add(m)
    sess.flush()
    buoc = sess.query(LsxCongDoan).filter_by(lsx_id=lsx_id, loai_buoc=LB_THUE_NGOAI).one()
    vt = LsxCongDoanVatTu(lsx_cong_doan_id=buoc.id, hang_loai="vat_tu", vat_tu_id=m.id,
                          vat_tu_ma_snapshot=m.ma, vat_tu_ten_snapshot=m.ten, don_vi_snapshot="kg",
                          so_luong=so_luong, ncc_tu_lo=tu_lo)
    sess.add(vt)
    sess.commit()
    return vt


def _giao_in_sang_can(sess, admin, a, sl=1600) -> dict:
    return giao_sang(sess, admin, cv_ten(sess, a, "In"), cv_ten(sess, a, "Cán màng"), sl)


def test_dien_san_ban_thanh_pham_theo_ban_giao(client, sess, orders, lsx_svc, admin, customer):
    a, d = _lenh_va_don(sess, orders, lsx_svc, admin, customer)
    _giao_in_sang_can(sess, admin, a, 1600)
    h = _h(client)
    (dong,) = _moi(client, h, d.id)["dong"]
    btp = dong["ban_thanh_pham"]
    assert [b["so_luong"] for b in btp["ban_giao"]] == [1600] and not btp["go_tay"]
    r = _lap(client, h, d.id, [{"don_dong_id": dong["don_dong_id"], "giao_ban_thanh_pham": True}])
    assert r.status_code == 200, r.text
    pg = r.json()
    assert pg["ma"].startswith("GG")
    assert [(x["loai"], x["so_luong"], x["tu_ban_giao"]) for x in pg["dong"]] == [("ban_thanh_pham", 1600, True)]
    assert sess.query(SanXuatBanGiao).filter_by(dich_cong_viec_id=cv_ten(sess, a, "Cán màng").id).one().trang_thai \
        == BG_XAC_NHAN
    don = client.get(f"/api/thue-gia-cong/don/{d.id}", headers=h).json()
    assert don["trang_thai"] == "giao_mot_phan" and don["dong"][0]["da_giao"] == 1600
    assert [p["ma"] for p in don["phieu_giao"]] == [pg["ma"]]
    # Danh sách phiếu giao tìm theo mã lệnh.
    ds = client.get("/api/thue-gia-cong/phieu-giao", headers=h, params={"q": don["lenh"][0]["lsx_ma"]}).json()
    assert pg["id"] in {x["id"] for x in ds["items"]} and ds["facets"]["con_hieu_luc"] >= 1


def test_khong_go_tay_khi_co_ban_giao(client, sess, orders, lsx_svc, admin, customer):
    a, d = _lenh_va_don(sess, orders, lsx_svc, admin, customer)
    _giao_in_sang_can(sess, admin, a, 1600)
    h = _h(client)
    (dong,) = _moi(client, h, d.id)["dong"]
    r = _lap(client, h, d.id, [{"don_dong_id": dong["don_dong_id"], "giao_ban_thanh_pham": True, "sl_go": 2000}])
    assert r.status_code == 400 and "không gõ tay" in r.json()["detail"]


def test_cho_buoc_truoc_chua_giao_duoc(client, sess, orders, lsx_svc, admin, customer):
    a, d = _lenh_va_don(sess, orders, lsx_svc, admin, customer)
    h = _h(client)
    (dong,) = _moi(client, h, d.id)["dong"]
    assert dong["ban_thanh_pham"]["cho_buoc_truoc"] is True
    r = _lap(client, h, d.id, [{"don_dong_id": dong["don_dong_id"], "giao_ban_thanh_pham": True, "sl_go": 100}])
    assert r.status_code == 400 and "chưa bàn giao" in r.json()["detail"]


def test_dai_dau_lenh_go_so(client, sess, orders, lsx_svc, admin, customer):
    a, d = _lenh_va_don(sess, orders, lsx_svc, admin, customer, buoc=_BUOC_DAU)
    h = _h(client)
    (dong,) = _moi(client, h, d.id)["dong"]
    assert dong["ban_thanh_pham"]["go_tay"] is True
    r = _lap(client, h, d.id, [{"don_dong_id": dong["don_dong_id"], "giao_ban_thanh_pham": True}])
    assert r.status_code == 400 and "Nhập số" in r.json()["detail"]
    r = _lap(client, h, d.id, [{"don_dong_id": dong["don_dong_id"], "giao_ban_thanh_pham": True, "sl_go": 1660}])
    assert r.status_code == 200, r.text
    assert [(x["so_luong"], x["tu_ban_giao"]) for x in r.json()["dong"]] == [(1660, False)]
    don = client.get(f"/api/thue-gia-cong/don/{d.id}", headers=h).json()
    assert don["trang_thai"] == "giao_du"


def test_vat_tu_xuong_cap_thanh_de_nghi_xuat(client, sess, orders, lsx_svc, admin, customer):
    a, d = _lenh_va_don(sess, orders, lsx_svc, admin, customer, buoc=_BUOC_DAU)
    vt = _vat_tu_buoc_thue(sess, a, tu_lo=False, so_luong=5)
    h = _h(client)
    (dong,) = _moi(client, h, d.id)["dong"]
    (v,) = dong["vat_tu"]
    assert v["lsx_cong_doan_vat_tu_id"] == vt.id and v["dinh_muc"] == 5 and v["goi_y"] == 5
    # Vượt định mức không chặn — bù hao người giao quyết.
    r = _lap(client, h, d.id, [{"don_dong_id": dong["don_dong_id"],
                                "vat_tu": [{"lsx_cong_doan_vat_tu_id": vt.id, "so_luong": 6}]}])
    assert r.status_code == 200, r.text
    pg = r.json()
    (dn,) = pg["de_nghi"]
    req = sess.get(StockRequest, dn["id"])
    assert req.loai == REQ_XUAT and req.tgc_phieu_giao_id == pg["id"]
    assert [(float(l.sl_de_nghi), l.lsx_id) for l in req.lines] == [(6.0, a)]
    (v,) = _moi(client, h, d.id)["dong"][0]["vat_tu"]
    assert v["da_giao"] == 6 and v["goi_y"] == 0


def test_vat_tu_kem_ton_kho_va_gac_quyen(client, sess, orders, lsx_svc, admin, customer):
    """Hộp giao hàng hiện tồn của từng vật tư xưởng cấp (cùng đơn vị gốc với dòng đề nghị xuất), chỉ
    cộng các kho người xem được; không xem được kho nào thì số không rời máy chủ."""
    a, d = _lenh_va_don(sess, orders, lsx_svc, admin, customer, buoc=_BUOC_DAU)
    vt = _vat_tu_buoc_thue(sess, a, tu_lo=False, so_luong=5)
    kho = sess.query(KhoHang).first()
    if kho is None:
        kho = KhoHang(ma="K-PG", ten="Kho test phiếu giao")
        sess.add(kho)
        sess.flush()
    for i, sl in enumerate((3.0, 4.5)):
        sess.add(StockLot(hang_loai="vat_tu", hang_id=int(vt.vat_tu_id), kho_id=kho.id, ma_lo=f"LO-PG-{i}",
                          sl_ban_dau=sl, sl_con_lai=sl, ngay_nhap=date.today(), trang_thai=LOT_AVAILABLE,
                          don_vi_goc="kg", kho_rong=0, kho_dai=0))
    sess.commit()
    moi = _moi(client, _h(client), d.id)
    # Qua API: số tồn tuỳ dòng quyền kho của vai admin trong DB test — chỉ kiểm trường có mặt.
    assert "xem_ton" in moi and "ton" in moi["dong"][0]["vat_tu"][0]
    assert pg_svc.du_lieu_moi(sess, d.id, kho_xem={kho.id})["dong"][0]["vat_tu"][0]["ton"] == 7.5
    assert pg_svc.du_lieu_moi(sess, d.id, kho_xem={kho.id + 999})["dong"][0]["vat_tu"][0]["ton"] == 0
    kin = pg_svc.du_lieu_moi(sess, d.id, kho_xem=set())
    assert kin["xem_ton"] is False and kin["dong"][0]["vat_tu"][0]["ton"] is None


def test_vat_tu_tu_lo_khong_co_dong(client, sess, orders, lsx_svc, admin, customer):
    a, d = _lenh_va_don(sess, orders, lsx_svc, admin, customer, buoc=_BUOC_DAU)
    vt = _vat_tu_buoc_thue(sess, a, tu_lo=True)
    h = _h(client)
    (dong,) = _moi(client, h, d.id)["dong"]
    assert dong["vat_tu"] == []
    r = _lap(client, h, d.id, [{"don_dong_id": dong["don_dong_id"],
                                "vat_tu": [{"lsx_cong_doan_vat_tu_id": vt.id, "so_luong": 1}]}])
    assert r.status_code == 400 and "tự lo" in r.json()["detail"]


def test_giay_tron_goi_chon_kho(client, sess, orders, lsx_svc, admin, customer):
    lenh = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    v = dat_tron_goi(sess, user=admin, lsx_id=lenh.id, sl_can=5000, xuong_cap_giay=True)
    d = _don(sess, admin, v, sl=5000)
    h = _h(client)
    (dong,) = _moi(client, h, d.id)["dong"]
    assert dong["ban_thanh_pham"] is None
    g = dong["giay"]
    assert g["giay_id"] and g["kho"], g
    assert all(k["ton"] is None for k in pg_svc.du_lieu_moi(sess, d.id, kho_xem=set())["dong"][0]["giay"]["kho"])
    kho = g["kho"][0]
    r = _lap(client, h, d.id, [{"don_dong_id": dong["don_dong_id"],
                                "giay": {"kho_rong": kho["kho_rong"], "kho_dai": kho["kho_dai"], "so_luong": 500}}])
    assert r.status_code == 200, r.text
    (x,) = r.json()["dong"]
    assert x["loai"] == "vat_tu" and x["so_luong"] == 500 and x["kho_rong"] == kho["kho_rong"]
    req = sess.get(StockRequest, r.json()["de_nghi"][0]["id"])
    assert [(l.hang_loai, int(l.hang_id), float(l.sl_de_nghi)) for l in req.lines] == [("giay", g["giay_id"], 500.0)]


def test_chon_cap_giay_o_don(client, sess, orders, lsx_svc, admin, customer):
    """Lệnh chỉ gắn cờ trọn gói; xưởng cấp giấy hay nhà gia công tự lo chọn ở đơn (lập và sửa).
    Đã có phiếu giao mang giấy thì không đổi được nữa."""
    lenh = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    v = dat_tron_goi(sess, user=admin, lsx_id=lenh.id, sl_can=5000, xuong_cap_giay=True)
    h = _h(client)
    nha = ncc(sess, "NCC cấp giấy").id
    r = client.post("/api/thue-gia-cong/don", headers=h, json={
        "nha_cung_cap_id": nha, "ngay_dat": date.today().isoformat(), "dat": True,
        "dong": [{"viec_id": v.id, "sl_dat": 5000, "don_gia": 100, "xuong_cap_giay": False}]})
    assert r.status_code == 200, r.text
    d = r.json()
    sess.expire_all()
    assert sess.get(TgcViec, v.id).xuong_cap_giay is False
    assert d["dong"][0]["xuong_cap_giay"] is False
    assert _moi(client, h, d["id"])["dong"][0]["giay"] is None

    def _sua(cap: bool):
        dd = client.get(f"/api/thue-gia-cong/don/{d['id']}", headers=h).json()
        return client.put(f"/api/thue-gia-cong/don/{d['id']}", headers=h, json={
            "version": dd["version"], "nha_cung_cap_id": nha, "ngay_dat": dd["ngay_dat"],
            "dong": [{"viec_id": v.id, "sl_dat": 5000, "don_gia": 100, "xuong_cap_giay": cap}]})

    r = _sua(True)
    assert r.status_code == 200, r.text
    (dong,) = _moi(client, h, d["id"])["dong"]
    assert dong["giay"] and dong["giay"]["kho"]
    kho = dong["giay"]["kho"][0]
    r = _lap(client, h, d["id"], [{"don_dong_id": dong["don_dong_id"],
                                   "giay": {"kho_rong": kho["kho_rong"], "kho_dai": kho["kho_dai"], "so_luong": 10}}])
    assert r.status_code == 200, r.text
    r = _sua(False)
    assert r.status_code == 400 and "phiếu giao mang giấy" in r.json()["detail"]
    sess.expire_all()
    assert sess.get(TgcViec, v.id).xuong_cap_giay is True


def test_don_nhap_khong_giao_duoc(client, sess, orders, lsx_svc, admin, customer):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC_DAU)
    d = _don(sess, admin, _viec(sess, a), dat=False)
    h = _h(client)
    r = client.get(f"/api/thue-gia-cong/don/{d.id}/phieu-giao/moi", headers=h)
    assert r.status_code == 400 and "nháp" in r.json()["detail"]
    dd = client.get(f"/api/thue-gia-cong/don/{d.id}", headers=h).json()
    r = _lap(client, h, d.id, [{"don_dong_id": dd["dong"][0]["id"], "giao_ban_thanh_pham": True, "sl_go": 10}],
             version=dd["version"])
    assert r.status_code == 400


def test_huy_phieu_giao_tra_ban_giao_ve_cho(client, sess, orders, lsx_svc, admin, customer):
    a, d = _lenh_va_don(sess, orders, lsx_svc, admin, customer)
    vt = _vat_tu_buoc_thue(sess, a, tu_lo=False)
    _giao_in_sang_can(sess, admin, a, 1600)
    h = _h(client)
    (dong,) = _moi(client, h, d.id)["dong"]
    pg = _lap(client, h, d.id, [{"don_dong_id": dong["don_dong_id"], "giao_ban_thanh_pham": True,
                                 "vat_tu": [{"lsx_cong_doan_vat_tu_id": vt.id, "so_luong": 5}]}]).json()
    r = client.post(f"/api/thue-gia-cong/phieu-giao/{pg['id']}/huy", headers=h,
                    json={"version": pg["version"], "ly_do": "Giao nhầm nhà"})
    assert r.status_code == 200, r.text
    assert r.json()["huy_luc"] is not None and r.json()["ly_do_huy"] == "Giao nhầm nhà"
    sess.expire_all()
    bg = sess.query(SanXuatBanGiao).filter_by(dich_cong_viec_id=cv_ten(sess, a, "Cán màng").id).one()
    assert bg.trang_thai == BG_DE_XUAT and bg.xac_nhan_luc is None
    assert sess.get(StockRequest, pg["de_nghi"][0]["id"]).trang_thai == REQ_CANCELLED
    (dong,) = _moi(client, h, d.id)["dong"]
    assert [b["so_luong"] for b in dong["ban_thanh_pham"]["ban_giao"]] == [1600]
    assert dong["vat_tu"][0]["da_giao"] == 0
    hc = client.get("/api/thue-gia-cong/don", headers=h, params={"q": d.ma}).json()["items"][0]
    assert hc["trang_thai"] == "da_dat"
    # Huỷ lần hai báo rõ.
    r = client.post(f"/api/thue-gia-cong/phieu-giao/{pg['id']}/huy", headers=h,
                    json={"version": r.json()["version"], "ly_do": "Lần nữa"})
    assert r.status_code == 400 and "đã huỷ" in r.json()["detail"]


def test_huy_phieu_giao_kho_da_xuat_bi_chan(client, sess, orders, lsx_svc, admin, customer, monkeypatch):
    a, d = _lenh_va_don(sess, orders, lsx_svc, admin, customer, buoc=_BUOC_DAU)
    vt = _vat_tu_buoc_thue(sess, a, tu_lo=False)
    h = _h(client)
    (dong,) = _moi(client, h, d.id)["dong"]
    pg = _lap(client, h, d.id, [{"don_dong_id": dong["don_dong_id"],
                                 "vat_tu": [{"lsx_cong_doan_vat_tu_id": vt.id, "so_luong": 5}]}]).json()
    monkeypatch.setattr(StockRequestService, "kho_da_lap_phieu", lambda self, req: True)
    r = client.post(f"/api/thue-gia-cong/phieu-giao/{pg['id']}/huy", headers=h,
                    json={"version": pg["version"], "ly_do": "Đổi ý"})
    assert r.status_code == 400 and "Kho đã lập phiếu xuất" in r.json()["detail"]


def test_chan_doi_y_tu_lo_sau_khi_giao(client, sess, orders, lsx_svc, admin, customer):
    """Đổi tick "Nhà gia công tự lo" sau khi đã xuất vật tư là bất khả: lệnh đã phát hành thì không sửa
    routing, còn thu hồi gói thì bị chặn vì việc đang nằm trong đơn sống. Bài này chốt cả hai cửa —
    gỡ một cửa thì dòng phiếu giao mất dấu dòng định mức."""
    from app.services.thue_gia_cong.viec import chan_thu_hoi

    a, d = _lenh_va_don(sess, orders, lsx_svc, admin, customer, buoc=_BUOC_DAU)
    vt = _vat_tu_buoc_thue(sess, a, tu_lo=False)
    h = _h(client)
    (dong,) = _moi(client, h, d.id)["dong"]
    assert _lap(client, h, d.id, [{"don_dong_id": dong["don_dong_id"],
                                   "vat_tu": [{"lsx_cong_doan_vat_tu_id": vt.id, "so_luong": 5}]}]).status_code == 200
    sess.expire_all()
    with pytest.raises(LsxConflict, match="đã phát hành"):
        lsx_svc.replace_routing(lsx_id=a, rows_in=[], actor=admin)
    sess.rollback()
    goi_id = sess.query(SanXuatCongViec).filter_by(lsx_id=a, ten_cong_doan="Cán màng").one().goi_id
    assert d.ma in (chan_thu_hoi(sess, goi_id=goi_id) or "")


def test_toast_san_sang_giao(sess, orders, lsx_svc, admin, customer):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    res = _giao_in_sang_can(sess, admin, a, 1000)
    can = sess.query(SanXuatCongViec).filter_by(lsx_id=a, ten_cong_doan="Cán màng").one()
    assert res["su_kien"] == "san_sang_giao" and res["tgc_viec_id"] == can.tgc_viec_id
    assert res["lsx_ma"]
