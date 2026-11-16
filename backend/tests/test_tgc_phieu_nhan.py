"""Phiếu nhận gia công (plan đợt 5, Task 5.1): nhiều đợt, chặn vượt còn ngoài (một phần), cảnh báo
vượt số đặt (trọn gói), tách vai giao / nhận, tổ sau nhận không cần quyền module, về kho không KCS,
giao thẳng khách, chụp đơn giá, huỷ gỡ đúng những gì phiếu đẻ ra."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.config import settings
from app.models.delivery import DeliveryRequest, DeliveryTrip, LG_DA_HUY
from app.models.department import Department
from app.models.lsx import Lsx
from app.models.order import Order
from app.models.san_xuat import CV_HOAN_THANH
from app.models.san_xuat_kcs import SanXuatKcsBatch
from app.models.san_xuat_san_luong import BG_DE_XUAT, BG_XAC_NHAN, SanXuatBanGiao, SanXuatBatch
from app.models.stock_request import REQ_CANCELLED, StockRequest
from app.models.thue_gia_cong import NOI_VE_KHACH, NOI_VE_KHO, NOI_VE_XUONG, TgcViec
from app.models.user import User
from app.repositories.loc_danh_sach import VN_TZ
from app.services.san_xuat import ban_giao
from app.services.thue_gia_cong import don as don_svc
from app.services.thue_gia_cong import phieu_giao as pg_svc
from app.services.thue_gia_cong import phieu_nhan as pn_svc
from app.services.thue_gia_cong.giao_thang import _ngay_vn
from app.services.thue_gia_cong.tron_goi import dat as dat_tron_goi
from tests.gia_cong_fixtures import (
    cv_ten, dung_lenh_gia_cong, ghi_me, giao_sang, lenh_chua_phat, ncc, nhan_vien_cua,
)
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401
from tests.quyen_to_fixtures import cap_quyen_to

_BUOC = [
    ("In", "may", None, 1660, "to"),
    ("Cán màng", "thue_ngoai", None, 1660, "to"),
    ("Bế", "may", None, 1650, "cai"),
]
_BUOC_CUOI = [
    ("In", "may", None, 1000, "to"),
    ("Bế", "thue_ngoai", None, 1000, "cái"),
    ("Đóng gói", "thue_ngoai", None, 1000, "cái"),
]


def _viec(sess, lsx_id) -> TgcViec:
    return sess.query(TgcViec).filter_by(lsx_id=lsx_id).one()


def _nguoi(sess, admin, ten: str, *, cung_vai: bool) -> User:
    u = User(username=ten, name=ten.capitalize(), password_hash="x",
             role_id=admin.role_id if cung_vai else None, is_active=True)
    sess.add(u)
    sess.commit()
    return u


def _don_giao(sess, admin, lsx_id, *, dau: str, truoc: str = "In", sl=1660, don_gia=600):
    """Đơn đã đặt + tổ bước trước bàn giao `sl` + phiếu giao (admin lập) nhận bàn giao đó."""
    v = _viec(sess, lsx_id)
    d = don_svc.tao(sess, user=admin, nha_cung_cap_id=ncc(sess, "Cán màng Minh Phát").id,
                    ngay_dat=date.today(), dong=[{"viec_id": v.id, "sl_dat": sl, "don_gia": don_gia}], dat=True)
    giao_sang(sess, admin, cv_ten(sess, lsx_id, truoc), cv_ten(sess, lsx_id, dau), sl)
    sess.refresh(d)
    pg_svc.lap(sess, user=admin, don_id=d.id, expected_version=d.version,
               dong=[{"don_dong_id": d_.id, "giao_ban_thanh_pham": True} for d_ in _dongs(sess, d)])
    sess.refresh(d)
    return d


def _dongs(sess, d):
    from app.repositories.thue_gia_cong_repo import ThueGiaCongRepository

    return ThueGiaCongRepository(sess).dong_cua_don(d.id)


def _nhan(sess, user, d, *, dat, hong=0, noi=NOI_VE_XUONG, module=True, **them):
    sess.refresh(d)
    (dd,) = _dongs(sess, d)
    pn, kq, cb = pn_svc.lap(sess, user=user, co_quyen_module=module, don_id=d.id, expected_version=d.version,
                            dong=[{"don_dong_id": dd.id, "sl_dat": dat, "sl_hong": hong, "noi_ve": noi, **them}])
    return pn, kq, cb


@pytest.fixture
def mot_phan(sess, orders, lsx_svc, admin, customer):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    return a, _don_giao(sess, admin, a, dau="Cán màng")


@pytest.fixture
def nhan(sess, admin):
    """Người nhận khác người giao, CÙNG vai admin (có quyền xác nhận ở tổ Bế)."""
    return _nguoi(sess, admin, "nhan_gc", cung_vai=True)


def test_nhan_hai_dot_ve_buoc_sau(sess, admin, nhan, mot_phan):
    a, d = mot_phan
    be = cv_ten(sess, a, "Bế")
    pn1, kq1, _ = _nhan(sess, nhan, d, dat=800)
    pn2, _kq, _ = _nhan(sess, nhan, d, dat=850)
    assert pn1.ma.startswith("GN") and pn2.ma != pn1.ma
    bgs = sess.query(SanXuatBanGiao).filter_by(dich_cong_viec_id=be.id).order_by(SanXuatBanGiao.id).all()
    # Người nhận có quyền xác nhận ở tổ Bế ⇒ bàn giao vào thẳng đã xác nhận, tổ làm được ngay.
    assert [(float(b.so_luong), b.trang_thai) for b in bgs] == [(800, BG_XAC_NHAN), (850, BG_XAC_NHAN)]
    assert kq1 and kq1[0]["dich_department_id"] == be.department_id
    can = cv_ten(sess, a, "Cán màng")
    assert can.trang_thai != CV_HOAN_THANH       # chỉ Hoàn tất dòng đơn mới đánh xong
    assert [float(b.tot) for b in sess.query(SanXuatBatch).filter_by(cong_viec_id=can.id)] == [800, 850]
    don = don_svc.don_dict(sess, d)
    assert don["trang_thai"] == "ve_mot_phan"
    (dong,) = don["dong"]
    assert dong["dat"] == 1650 and dong["con_ngoai"] == 10


def test_nhan_vuot_con_ngoai_bi_chan(sess, orders, lsx_svc, admin, customer, nhan):
    """Giao tờ, nhận con: còn ngoài quy qua tỷ lệ ra ÷ vào của dải (1.000 tờ ⇒ 4.000 con)."""
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    can = cv_ten(sess, a, "Cán màng")
    can.so_luong_vao, can.so_luong_ra, can.don_vi_ra = 1000, 4000, "cai"
    sess.commit()
    d = _don_giao(sess, admin, a, dau="Cán màng", sl=1000)
    with pytest.raises(ValueError, match="vượt số còn ngoài"):
        _nhan(sess, nhan, d, dat=3995, hong=6)
    sess.rollback()
    _nhan(sess, nhan, d, dat=3990, hong=10)
    with pytest.raises(ValueError, match="chỉ còn 0"):
        _nhan(sess, nhan, d, dat=1)


def test_tron_goi_nhan_vuot_sl_dat_canh_bao(sess, orders, lsx_svc, admin, customer, nhan):
    lenh = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    v = dat_tron_goi(sess, user=admin, lsx_id=lenh.id, sl_can=5000, xuong_cap_giay=False)
    d = don_svc.tao(sess, user=admin, nha_cung_cap_id=ncc(sess, "In Tân Phát").id, ngay_dat=date.today(),
                    dong=[{"viec_id": v.id, "sl_dat": 5000, "don_gia": 1200}], dat=True)
    moi = pn_svc.du_lieu_moi(sess, d.id, user=nhan, co_quyen_module=True)
    (dong,) = moi["dong"]
    assert dong["con_ngoai"] is None and dong["ly_do_khong_nhan"] is None and NOI_VE_KHO in dong["noi_ve_hop_le"]
    _p1, _kq, cb1 = _nhan(sess, nhan, d, dat=5000, noi=NOI_VE_KHO)
    assert cb1 == []
    p2, _kq, cb2 = _nhan(sess, nhan, d, dat=100, hong=20, noi=NOI_VE_KHO)
    assert p2.id and len(cb2) == 1 and "vượt số đặt" in cb2[0] and "Vẫn lưu được" in cb2[0]
    (dong,) = pn_svc.du_lieu_moi(sess, d.id, user=nhan, co_quyen_module=True)["dong"]
    assert "vượt số đặt" in (dong["canh_bao"] or "")


def test_nguoi_giao_khong_tu_nhan(client, sess, admin, mot_phan):
    _a, d = mot_phan
    with pytest.raises(PermissionError, match="tách vai"):
        _nhan(sess, admin, d, dat=100)
    sess.rollback()
    assert pn_svc.du_lieu_moi(sess, d.id, user=admin, co_quyen_module=True)["chan_tu_nhan"]
    h = {"Authorization": "Bearer " + client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin123"}).json()["access_token"]}
    (dd,) = _dongs(sess, d)
    r = client.post(f"/api/thue-gia-cong/don/{d.id}/phieu-nhan", headers=h, json={
        "version": d.version, "dong": [{"don_dong_id": dd.id, "sl_dat": 100, "noi_ve": "xuong"}]})
    assert r.status_code == 403 and "tách vai" in r.json()["detail"]


def test_tat_chan_bang_cau_hinh(sess, admin, mot_phan, monkeypatch):
    _a, d = mot_phan
    monkeypatch.setattr(settings, "tgc_chan_nguoi_giao_tu_nhan", False)
    pn, _kq, _cb = _nhan(sess, admin, d, dat=100)
    assert pn.nguoi_nhan_id == admin.id
    assert pn_svc.du_lieu_moi(sess, d.id, user=admin, co_quyen_module=True)["chan_tu_nhan"] is None


def test_to_sau_nhan_duoc_khong_can_quyen_module(sess, admin, mot_phan):
    a, d = mot_phan
    be = cv_ten(sess, a, "Bế")
    to_be = _nguoi(sess, admin, "to_be", cung_vai=False)
    cap_quyen_to(sess, to_be, sess.get(Department, be.department_id), viec=("confirm_output",))
    sess.commit()
    moi = pn_svc.du_lieu_moi(sess, d.id, user=to_be, co_quyen_module=False)
    (dong,) = moi["dong"]
    assert dong["buoc_sau"] == [{"cong_viec_id": be.id, "ten": "Bế", "xac_nhan_duoc": True}]
    _pn, _kq, _cb = _nhan(sess, to_be, d, dat=800, module=False)
    (bg,) = sess.query(SanXuatBanGiao).filter_by(dich_cong_viec_id=be.id).all()
    assert bg.trang_thai == BG_XAC_NHAN
    # Không quyền module, không quyền tổ ⇒ chặn cả đọc lẫn lập.
    la = _nguoi(sess, admin, "nguoi_la", cung_vai=False)
    with pytest.raises(PermissionError):
        pn_svc.du_lieu_moi(sess, d.id, user=la, co_quyen_module=False)
    with pytest.raises(PermissionError):
        _nhan(sess, la, d, dat=10, module=False)


def test_ve_kho_tao_de_nghi_nhap_khong_kcs(sess, orders, lsx_svc, admin, customer, nhan):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC_CUOI)
    d = _don_giao(sess, admin, a, dau="Bế", sl=1000)
    (dong,) = pn_svc.du_lieu_moi(sess, d.id, user=nhan, co_quyen_module=True)["dong"]
    assert dong["noi_ve_hop_le"][0] == NOI_VE_KHO and dong["buoc_sau"] == []
    pn, _kq, _cb = _nhan(sess, nhan, d, dat=1000, noi=NOI_VE_KHO)
    cuoi = cv_ten(sess, a, "Đóng gói")
    req = sess.query(StockRequest).filter_by(tgc_phieu_nhan_id=pn.id).one()
    assert req.san_xuat_cong_viec_id == cuoi.id
    assert sess.query(SanXuatKcsBatch).filter_by(cong_viec_id=cuoi.id).count() == 0
    out = pn_svc.nhieu_dict(sess, [pn])[0]
    assert [x["ma"] for x in out["de_nghi"]] == [req.ma] and out["ly_do_khong_huy"] is None


def test_giao_thang_khach_chi_khi_dong_rieng(sess, orders, lsx_svc, admin, customer, nhan, monkeypatch):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC_CUOI)
    d = _don_giao(sess, admin, a, dau="Bế", sl=1000)
    nhan_vien_cua(sess, nhan)
    (dong,) = pn_svc.du_lieu_moi(sess, d.id, user=nhan, co_quyen_module=True)["dong"]
    assert dong["noi_ve_hop_le"] == [NOI_VE_KHO, NOI_VE_KHACH]
    import app.services.thue_gia_cong.giao_thang as gt

    monkeypatch.setattr(gt, "dong_don_dung_rieng", lambda db, lsx_id: False)
    with pytest.raises(ValueError, match="Nơi về không hợp lệ"):
        _nhan(sess, nhan, d, dat=400, noi=NOI_VE_KHACH)
    sess.rollback()
    monkeypatch.undo()
    pn, _kq, _cb = _nhan(sess, nhan, d, dat=400, noi=NOI_VE_KHACH)
    trip = sess.query(DeliveryTrip).filter_by(tgc_phieu_nhan_id=pn.id).one()
    assert "giao thẳng" in (trip.ghi_chu_phan_cong or "")


def test_tam_tinh_chup_don_gia(sess, admin, nhan, mot_phan):
    _a, d = mot_phan
    p1, _kq, _cb = _nhan(sess, nhan, d, dat=800, hong=5)
    (dd,) = _dongs(sess, d)
    dd.don_gia = 650          # đơn giá đổi sau đợt 1
    sess.commit()
    p2, _kq, _cb = _nhan(sess, nhan, d, dat=100)
    o1, o2 = pn_svc.nhieu_dict(sess, [p1, p2])
    assert (o1["tam_tinh"], o1["dong"][0]["don_gia"]) == (480000, 600)   # hỏng không tính tiền
    assert (o2["tam_tinh"], o2["dong"][0]["don_gia"]) == (65000, 650)


def test_huy_phieu_nhan_go_ban_giao(sess, admin, mot_phan):
    a, d = mot_phan
    be = cv_ten(sess, a, "Bế")
    kho = _nguoi(sess, admin, "kho_gc", cung_vai=False)   # chỉ quyền module, không quyền tổ Bế
    pn, kq, _cb = _nhan(sess, kho, d, dat=800)
    (bg,) = sess.query(SanXuatBanGiao).filter_by(dich_cong_viec_id=be.id).all()
    assert bg.trang_thai == BG_DE_XUAT and kq[0]["notify_user_ids"]
    with pytest.raises(ValueError, match="lý do"):
        pn_svc.huy(sess, user=admin, phieu_id=pn.id, expected_version=pn.version, ly_do="")
    pn_svc.huy(sess, user=admin, phieu_id=pn.id, expected_version=pn.version, ly_do="Gõ nhầm số")
    assert sess.query(SanXuatBanGiao).filter_by(dich_cong_viec_id=be.id).count() == 0
    assert sess.query(SanXuatBatch).filter_by(cong_viec_id=cv_ten(sess, a, "Cán màng").id).count() == 0
    sess.refresh(pn)
    assert pn.huy_luc is not None
    (dong,) = don_svc.don_dict(sess, d)["dong"]
    assert dong["dat"] == 0 and dong["con_ngoai"] == 1660


def test_huy_phieu_nhan_to_da_xac_nhan_bi_chan(sess, admin, mot_phan):
    a, d = mot_phan
    be = cv_ten(sess, a, "Bế")
    kho = _nguoi(sess, admin, "kho_gc2", cung_vai=False)
    pn, _kq, _cb = _nhan(sess, kho, d, dat=800)
    (bg,) = sess.query(SanXuatBanGiao).filter_by(dich_cong_viec_id=be.id).all()
    ban_giao.xac_nhan(sess, user=admin, ban_giao_id=bg.id, expected_version=bg.version)
    ly_do = pn_svc.nhieu_dict(sess, [pn])[0]["ly_do_khong_huy"]
    assert ly_do and "đã xác nhận" in ly_do
    with pytest.raises(ValueError, match="đã xác nhận"):
        pn_svc.huy(sess, user=admin, phieu_id=pn.id, expected_version=pn.version, ly_do="Gõ nhầm số")


def test_huy_bi_chan_khi_to_sau_da_ghi_san_luong(sess, admin, nhan, mot_phan):
    a, d = mot_phan
    pn, _kq, _cb = _nhan(sess, nhan, d, dat=800)     # tự xác nhận (người nhận có quyền tổ Bế)
    assert pn_svc.nhieu_dict(sess, [pn])[0]["ly_do_khong_huy"] is None
    ghi_me(sess, cv_ten(sess, a, "Bế"), 300)
    sess.commit()
    with pytest.raises(ValueError, match="đã ghi sản lượng"):
        pn_svc.huy(sess, user=admin, phieu_id=pn.id, expected_version=pn.version, ly_do="Gõ nhầm số")


def test_huy_ve_kho_huy_de_nghi_va_chuyen_giao_thang(sess, orders, lsx_svc, admin, customer, nhan):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC_CUOI)
    d = _don_giao(sess, admin, a, dau="Bế", sl=1000)
    nhan_vien_cua(sess, nhan)
    p1, _kq, _cb = _nhan(sess, nhan, d, dat=500, noi=NOI_VE_KHO)
    p2, _kq, _cb = _nhan(sess, nhan, d, dat=300, noi=NOI_VE_KHACH)
    for p in (p1, p2):
        pn_svc.huy(sess, user=admin, phieu_id=p.id, expected_version=p.version, ly_do="Nhận nhầm đơn")
    assert sess.query(StockRequest).filter_by(tgc_phieu_nhan_id=p1.id).one().trang_thai == REQ_CANCELLED
    assert sess.query(DeliveryTrip).filter_by(tgc_phieu_nhan_id=p2.id).one().trang_thai == LG_DA_HUY


def test_danh_sach_va_api(client, sess, admin, nhan, mot_phan):
    _a, d = mot_phan
    pn, _kq, _cb = _nhan(sess, nhan, d, dat=800)
    h = {"Authorization": "Bearer " + client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin123"}).json()["access_token"]}
    ds = client.get("/api/thue-gia-cong/phieu-nhan", headers=h, params={"q": d.ma}).json()
    assert [x["ma"] for x in ds["items"]] == [pn.ma] and ds["facets"] == {"con_hieu_luc": 1, "da_huy": 0}
    x = client.get(f"/api/thue-gia-cong/phieu-nhan/{pn.id}", headers=h).json()
    assert x["tam_tinh"] == 480000 and x["dong"][0]["noi_ve"] == "xuong" and x["dong"][0]["dich_ten"] == "Bế"
    don = client.get(f"/api/thue-gia-cong/don/{d.id}", headers=h).json()
    assert [p["ma"] for p in don["phieu_nhan"]] == [pn.ma]


# --- Giao thẳng (chuyển từ test_giao_hang_ngan_luot, viết lại theo phiếu nhận) ------------------
@pytest.fixture
def dai_cuoi(sess, orders, lsx_svc, admin, customer, nhan):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC_CUOI)
    d = _don_giao(sess, admin, a, dau="Bế", sl=1000)
    nhan_vien_cua(sess, nhan)
    return a, d


def test_giao_thang_lay_noi_nhan_cua_don_va_noi_ro_nha_gia_cong(sess, nhan, dai_cuoi):
    from app.routers.delivery import _giao_thang_out

    lsx_id, d = dai_cuoi
    pn, _kq, _cb = _nhan(sess, nhan, d, dat=1000, noi=NOI_VE_KHACH)
    trip = sess.query(DeliveryTrip).filter_by(tgc_phieu_nhan_id=pn.id).one()
    req = sess.get(DeliveryRequest, trip.request_id)
    l = sess.get(Lsx, lsx_id)
    o = sess.get(Order, l.order_id)
    assert req.dia_chi == (o.delivery_address or "")
    assert (req.nguoi_nhan, req.sdt_nguoi_nhan, req.ghi_chu) == (
        o.delivery_contact_name, o.delivery_contact_phone, o.delivery_note)
    gt = _giao_thang_out(sess, trip)
    assert (gt.nha_cung_cap_ten, gt.lsx_id, gt.lsx_ma) == ("Cán màng Minh Phát", lsx_id, l.ma)


def test_giao_thang_ghi_ngay_khach_nhan_va_hen_theo_han_don(sess, nhan, dai_cuoi):
    lsx_id, d = dai_cuoi
    hom_nay = datetime.now(VN_TZ).date()
    d.dat_luc = datetime.now(timezone.utc) - timedelta(days=10)
    o = sess.get(Order, sess.get(Lsx, lsx_id).order_id)
    o.delivery_committed_date = hom_nay + timedelta(days=24)
    sess.commit()
    ngay = hom_nay - timedelta(days=2)
    pn, _kq, _cb = _nhan(sess, nhan, d, dat=1000, noi=NOI_VE_KHACH, ngay_khach_nhan=ngay)
    trip = sess.query(DeliveryTrip).filter_by(tgc_phieu_nhan_id=pn.id).one()
    assert _ngay_vn(trip.thoi_gian_ket_thuc) == ngay
    assert sess.get(DeliveryRequest, trip.request_id).ngay_can_giao == o.delivery_committed_date
    assert pn_svc.nhieu_dict(sess, [pn])[0]["dong"][0]["ngay_khach_nhan"] == ngay


def test_giao_thang_chan_ngay_khach_nhan_sau_hom_nay_hoac_truoc_ngay_dat(sess, nhan, dai_cuoi):
    _lsx_id, d = dai_cuoi
    hom_nay = datetime.now(VN_TZ).date()
    with pytest.raises(ValueError, match="sau hôm nay"):
        _nhan(sess, nhan, d, dat=1000, noi=NOI_VE_KHACH, ngay_khach_nhan=hom_nay + timedelta(days=1))
    sess.rollback()
    with pytest.raises(ValueError, match="trước ngày giao việc"):
        _nhan(sess, nhan, d, dat=1000, noi=NOI_VE_KHACH, ngay_khach_nhan=hom_nay - timedelta(days=30))
    sess.rollback()
    assert sess.query(DeliveryTrip).filter(DeliveryTrip.tgc_phieu_nhan_id.isnot(None)).count() == 0
