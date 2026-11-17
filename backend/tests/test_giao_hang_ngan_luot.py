"""Ngăn lượt xe màn Giao hàng (06/10/2026, mockup docs/mockups/giao-hang-phuong-an-B-chi-tiet.html).

Bảng + ngăn cần đọc ngay trên từng điểm: nơi giao, người nhận, ngày hẹn, lưu ý giao, PO, phiếu kho
thật của RIÊNG điểm đó. Bài giao thẳng của nhà gia công dời sang Phiếu nhận thuê gia công (đợt 5).
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.models.delivery import DeliveryRequest, DeliveryTrip
from tests.test_giao_hang_api import _kho_lap_phieu
from tests.test_luot_xe import GOC, _canh, _len_don, _len_luot, _yc


def _diem(client, h):
    khoi = client.get(f"{GOC}/bang-giao", headers=h).json()["items"]
    return [t for k in khoi for t in (k["luot"]["diem"] if k["luot"] else [k["trip"]])]


def test_moi_diem_mang_noi_nhan_ngay_hen_va_ngay_tao(client):
    h, tx, _px, xe = _canh(client, "51C-111.01")
    luot = _len_luot(client, h, [_yc(client, h, "nl1")], tx=tx, xe=xe)
    (t,) = _diem(client, h)
    assert (t["dia_chi"], t["nguoi_nhan"], t["sdt_nguoi_nhan"]) == (
        "12 Le Loi, Q1", "Chi Lan", "0901234567")
    assert t["ngay_can_giao"] and t["created_at"]
    assert t["giao_thang"] is None
    assert t["phieu_xuat"] is None and t["kho_da_lap_phieu"] is False
    khoi = client.get(f"{GOC}/bang-giao", headers=h).json()["items"][0]["luot"]
    assert khoi["id"] == luot["luot_id"] and khoi["created_at"]


def test_phieu_xuat_cua_rieng_diem_khop_co_kho_da_lap_phieu(client):
    h, tx, _px, xe = _canh(client, "51C-111.02")
    _len_luot(client, h, [_yc(client, h, "nl2a"), _yc(client, h, "nl2b")], tx=tx, xe=xe)
    a, b = _diem(client, h)
    _kho_lap_phieu(client, h, a["id"])
    theo_id = {t["id"]: t for t in _diem(client, h)}
    # Cờ "kho đã chuẩn bị xong" và phiếu đọc từ CÙNG một chỗ — không bao giờ nói hai kiểu.
    for t in theo_id.values():
        assert (t["phieu_xuat"] is not None) == t["kho_da_lap_phieu"]
    # Điểm kho chưa lập phiếu không mượn phiếu của điểm kia.
    assert theo_id[b["id"]]["phieu_xuat"] is None


_KHOA_DONG = ("id", "order_line_id", "qty", "mo_ta", "don_vi_tinh", "da_giao", "hang_ten", "dvt")


def _dem_truy_van(viec) -> int:
    from sqlalchemy import event

    from app.db import engine

    dem = [0]

    def nghe(*_a, **_k):
        dem[0] += 1

    event.listen(engine, "before_cursor_execute", nghe)
    try:
        viec()
    finally:
        event.remove(engine, "before_cursor_execute", nghe)
    return dem[0]


def test_moi_diem_mang_dong_hang_khop_chi_tiet_yeu_cau(client):
    h, tx, _px, xe = _canh(client, "51C-111.03")
    _len_luot(client, h, [_yc(client, h, "nl3a"), _yc(client, h, "nl3b")], tx=tx, xe=xe)
    diem = _diem(client, h)
    assert len(diem) == 2
    for t in diem:
        ct = client.get(f"{GOC}/requests/{t['request_id']}", headers=h).json()["request"]["lines"]
        assert t["hang"], "bảng giao phải mang dòng hàng của yêu cầu"
        assert [{k: d[k] for k in _KHOA_DONG} for d in t["hang"]] == \
               [{k: d[k] for k in _KHOA_DONG} for d in ct]


def test_dong_hang_nap_gop_so_truy_van_khong_tang_theo_so_yeu_cau(client):
    from app.db import SessionLocal
    from app.routers.delivery import _hang_theo_yeu_cau, get_service

    h, tx, _px, xe = _canh(client, "51C-111.04")
    ids = [_yc(client, h, f"nl4{c}") for c in "abc"]
    _len_luot(client, h, ids, tx=tx, xe=xe)
    db = SessionLocal()
    try:
        svc = get_service(db)
        mot = _dem_truy_van(lambda: _hang_theo_yeu_cau(db, svc, ids[:1]))
        ba = _dem_truy_van(lambda: _hang_theo_yeu_cau(db, svc, ids))
        assert len(_hang_theo_yeu_cau(db, svc, ids)) == 3
    finally:
        db.close()
    assert ba == mot


def test_chi_tiet_yeu_cau_so_truy_van_khong_tang_theo_so_dong_lich_su(client):
    from app.db import SessionLocal
    from app.models.delivery import DeliveryStatusHistory

    h, tx, _px, xe = _canh(client, "51C-111.05")
    rid = _yc(client, h, "nl5")
    _len_luot(client, h, [rid], tx=tx, xe=xe)
    url = f"{GOC}/requests/{rid}"
    truoc = _dem_truy_van(lambda: client.get(url, headers=h))
    db = SessionLocal()
    try:
        trip = db.query(DeliveryTrip).filter_by(request_id=rid).one()
        # Mỗi mốc một người KHÁC nhau: cùng một người thì `db.get` lấy từ bộ nhớ phiên, bản cũ
        # cũng không tốn thêm truy vấn — test sẽ xanh oan.
        from app.models.user import User
        moi = [User(username=f"ls_nl5_{i}", name=f"Người {i}", password_hash="x") for i in range(4)]
        db.add_all(moi)
        db.flush()
        nguoi = [u.id for u in moi]
        for i, uid in enumerate(nguoi):
            db.add(DeliveryStatusHistory(trip_id=trip.id, tu_trang_thai=None, den_trang_thai="da_len_ke_hoach",
                                         nguoi_thao_tac_id=uid, luc=datetime.now(timezone.utc),
                                         ghi_chu=f"mốc {i}"))
        db.commit()
    finally:
        db.close()
    r = client.get(url, headers=h)
    assert r.status_code == 200
    assert len(r.json()["lich_su"]) >= len(nguoi) + 1
    assert all(x["nguoi_thao_tac_name"] for x in r.json()["lich_su"] if x["nguoi_thao_tac_id"])
    assert _dem_truy_van(lambda: client.get(url, headers=h)) == truoc


def test_bang_giao_so_truy_van_khong_tang_theo_so_chuyen(client):
    """Cả trang `/bang-giao` chạy số truy vấn CỐ ĐỊNH (07/10/2026) — trước đây mỗi chuyến ~12 truy vấn
    (yêu cầu, đơn, khách, tài xế, phụ xe, yêu cầu kho, phiếu kho, lượt…), mỗi lượt thêm vài câu."""
    url = f"{GOC}/bang-giao?size=50"

    def dung(ma_xe, so_diem, so_le, sfx):
        h, tx, px, xe = _canh(client, ma_xe)
        _len_luot(client, h, [_yc(client, h, f"{sfx}l{i}") for i in range(so_diem)], tx=tx, xe=xe, px=px)
        for i in range(so_le):
            _len_don(client, h, suffix=f"{sfx}c{i}", tx=tx, xe=xe, luot=None, px=px)
        return h

    h = dung("51C-111.06", 2, 1, "nl6a")
    _kho_lap_phieu(client, h, _diem(client, h)[0]["id"])
    it = _dem_truy_van(lambda: client.get(url, headers=h))
    assert len(_diem(client, h)) == 3

    h = dung("51C-111.07", 3, 2, "nl6b")
    _kho_lap_phieu(client, h, _diem(client, h)[0]["id"])
    nhieu = _dem_truy_van(lambda: client.get(url, headers=h))
    assert len(_diem(client, h)) == 8
    assert nhieu == it, (it, nhieu)


def test_dang_giu_hang_theo_lo_so_truy_van_khong_tang_theo_so_yeu_cau(client):
    """Ngăn đơn bán (tiến độ) duyệt MỌI yêu cầu chưa huỷ của mã thành phẩm qua `yeu_cau_dang_giu`.
    Trước 13/10/2026 mỗi yêu cầu tốn 2–3 câu (chuyến + dòng chuyến + phiếu nhập trả về) ⇒ mã tái bản
    nhiều lần mở ngăn chậm dần. Bản lô: số câu cố định, kết quả y bản một-cái."""
    from app.db import SessionLocal
    from app.routers.delivery import get_service

    h, tx, _px, xe = _canh(client, "51C-111.08")
    ids = [_yc(client, h, f"nl8{c}") for c in "abc"]
    _len_luot(client, h, ids[:2], tx=tx, xe=xe)
    db = SessionLocal()
    try:
        svc = get_service(db)
        reqs = [db.get(DeliveryRequest, i) for i in ids]
        mot = _dem_truy_van(lambda: svc.yeu_cau_dang_giu(reqs[:1]))
        ba = _dem_truy_van(lambda: svc.yeu_cau_dang_giu(reqs))
        # Hai yêu cầu đang trên lượt chạy và một yêu cầu chưa lên lượt: cả ba đều đang giữ hàng.
        assert svc.yeu_cau_dang_giu(reqs) == set(ids)
    finally:
        db.close()
    assert ba == mot, (mot, ba)
