"""Hàng chờ Thuê gia công + trạng thái chỉ đọc trên lệnh (plan Task 2.3)."""
from __future__ import annotations

from datetime import date, datetime, timezone

from app.models.thue_gia_cong import TgcDon, TgcDonDong, TgcViec
from app.models.san_xuat import SanXuatCongViec
from app.services.san_xuat import ban_giao
from app.services.thue_gia_cong.tron_goi import dat as dat_tron_goi
from tests.gia_cong_fixtures import dung_lenh_gia_cong, ghi_me, lenh_chua_phat, ncc
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401
from tests.test_fine_permissions_api import _user_with_role

ADMIN = {"username": "admin", "password": "admin123"}
_BUOC = [
    ("In", "may", None, 1660, "to"),
    ("Cán màng", "thue_ngoai", None, 1660, "to"),
    ("Bế", "may", None, 1650, "cai"),
]


def _h(client) -> dict[str, str]:
    r = client.post("/api/auth/login", json=ADMIN)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _viec(sess, lsx_id) -> TgcViec:
    return sess.query(TgcViec).filter_by(lsx_id=lsx_id).one()


def _dat(sess, viec, ma="GC26-9101"):
    """Đưa việc vào một dòng đơn SỐNG (dịch vụ đơn là đợt 3 — chèn thẳng)."""
    s = ncc(sess, f"NCC {ma}")
    don = TgcDon(ma=ma, nha_cung_cap_id=s.id, nha_cung_cap_ten=s.ten, ngay_dat=date.today(),
                 dat_luc=datetime.now(timezone.utc))
    sess.add(don)
    sess.flush()
    sess.add(TgcDonDong(don_id=don.id, viec_id=viec.id, sl_dat=1660, don_gia=600, don_vi="to"))
    sess.commit()
    return don


def test_hang_cho_chi_hien_viec_chua_dat(client, sess, orders, lsx_svc, admin, customer):
    a = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    b = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    _dat(sess, _viec(sess, b))
    r = client.get("/api/thue-gia-cong/hang-cho", headers=_h(client))
    assert r.status_code == 200, r.text
    ids = {x["viec_id"] for x in r.json()["items"]}
    assert _viec(sess, a).id in ids and _viec(sess, b).id not in ids


def test_hang_cho_tinh_trang(client, sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    h = _h(client)
    v = _viec(sess, lsx_id)
    dong = lambda: next(x for x in client.get("/api/thue-gia-cong/hang-cho", headers=h).json()["items"]
                        if x["viec_id"] == v.id)
    assert dong()["tinh_trang"] == "cho_buoc_truoc"

    in_ = sess.query(SanXuatCongViec).filter_by(lsx_id=lsx_id, ten_cong_doan="In").one()
    can = sess.query(SanXuatCongViec).filter_by(lsx_id=lsx_id, ten_cong_doan="Cán màng").one()
    m = ghi_me(sess, in_, 1000)
    sess.commit()
    ban_giao.de_xuat(sess, user=admin, nguon_cong_viec_id=in_.id, dich_cong_viec_id=can.id, batch_ids=[m.id])
    d = dong()
    assert d["tinh_trang"] == "san_sang_giao" and d["sl_san_sang"] == 1000

    # Lọc theo tình trạng ở máy chủ + đếm từng tình trạng.
    r = client.get("/api/thue-gia-cong/hang-cho?tinh_trang=cho_buoc_truoc", headers=h).json()
    assert v.id not in {x["viec_id"] for x in r["items"]}
    assert r["facets"].get("san_sang_giao", 0) >= 1

    tron = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    vt = dat_tron_goi(sess, user=admin, lsx_id=tron.id, sl_can=5000, xuong_cap_giay=False)
    r = client.get("/api/thue-gia-cong/hang-cho?tinh_trang=chua_dat", headers=h).json()
    assert vt.id in {x["viec_id"] for x in r["items"]}


def test_hang_cho_co_thong_tin_lenh(client, sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    v = _viec(sess, lsx_id)
    h = _h(client)
    items = client.get("/api/thue-gia-cong/hang-cho", headers=h).json()["items"]
    d = next(x for x in items if x["viec_id"] == v.id)
    (l,) = d["lenh"]
    assert l["lsx_id"] == lsx_id and l["lsx_ma"] and l["khach_hang"] and l["mat_hang"]
    assert "don_hang_ma" in l and "han_giao" in l
    # Ô tìm ở máy chủ: theo mã lệnh.
    r = client.get(f"/api/thue-gia-cong/hang-cho?q={l['lsx_ma']}", headers=h).json()
    assert [x["viec_id"] for x in r["items"]] == [v.id] and r["total"] == 1


def test_quyen_hang_cho(client, sess, orders, lsx_svc, admin, customer):
    tok = _user_with_role("tgc-khong-quyen", "san_xuat", can_read=True)
    r = client.get("/api/thue-gia-cong/hang-cho", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403
    tok2 = _user_with_role("tgc-co-quyen", "thue_gia_cong", can_read=True)
    r = client.get("/api/thue-gia-cong/hang-cho", headers={"Authorization": f"Bearer {tok2}"})
    assert r.status_code == 200


def test_trang_thai_buoc_tren_lenh(client, sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=_BUOC)
    h = _h(client)
    (t,) = client.get(f"/api/thue-gia-cong/lenh/{lsx_id}", headers=h).json()
    assert t["trang_thai"] == "chua_dat" and t["nhan"] == "Chưa đặt" and t["step_keys"]
    don = _dat(sess, _viec(sess, lsx_id), ma="GC26-9102")
    (t,) = client.get(f"/api/thue-gia-cong/lenh/{lsx_id}", headers=h).json()
    assert t["trang_thai"] == "da_dat" and t["ma_don"] == don.ma and t["don_id"] == don.id
    assert t["nhan"].startswith("Đã đặt")


def test_tron_goi_dat_va_huy_qua_api(client, sess, orders, lsx_svc, admin, customer):
    lenh = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    h = _h(client)
    # Màn lệnh chỉ gắn cờ: không gửi số lượng hay giấy — máy chủ lấy theo lệnh.
    r = client.post(f"/api/thue-gia-cong/lenh/{lenh.id}/tron-goi", headers=h, json={})
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["kieu"] == "tron_goi" and t["trang_thai"] == "chua_dat"
    assert t["sl_can"] == float(lenh.so_luong_dat)
    r = client.post(f"/api/thue-gia-cong/viec/{t['viec_id']}/huy-tron-goi", headers=h,
                    json={"version": t["version"], "ly_do": "Khách đổi ý"})
    assert r.status_code == 204, r.text
    assert client.get(f"/api/thue-gia-cong/lenh/{lenh.id}", headers=h).json() == []
