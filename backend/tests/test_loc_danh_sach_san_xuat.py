"""Thanh lọc (kỳ + điều kiện) của các danh sách sản xuất — 06/10/2026.

Bốn danh sách: Kế hoạch SX › Lệnh sản xuất (`/api/lsx`), Kế hoạch SX › Hàng chờ (`/api/lsx/hang-cho`),
Hồ sơ lệnh sản xuất (`/api/lenh-san-xuat`), KCS › danh sách lệnh (`/api/san-xuat/kcs/lenh`).
Mọi lọc chạy Ở MÁY CHỦ; kỳ đi qua `tu_ngay`/`den_ngay`/`moc` và ranh ngày tính theo GIỜ VIỆT NAM.

Soi tầng service (cảnh dựng chung cây fixture KCS), cộng vài bài HTTP chỉ để canh đường đi: tham
số được nhận và các đường tĩnh `…/khach-loc`, `…/don-loc` không bị route `/{id}` nuốt.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.models.customer import Customer
from app.models.lsx import Lsx
from app.models.order import STATUS_ORDERED, Order, OrderLine
from app.repositories.lsx_repo import LsxRepository
from app.services.lenh_sx import danh_sach
from app.services.san_xuat import kcs
from tests.lenh_sx_fixtures import _h, _lenh_tho, _tok
from tests.test_san_xuat_kcs import _batch

# Fixture của cây KCS (db + đơn + lệnh thật). `noqa: F401` — pytest dùng qua TÊN.
from tests.test_san_xuat_thuc_thi import (  # noqa: F401
    admin,
    customer,
    db,
    lsx_svc,
    orders,
)

# 30/09 17:30 UTC = 01/10 00:30 giờ VN ⇒ THUỘC tháng 10; 16:30 UTC = 30/09 23:30 VN ⇒ ngoài.
TRONG = datetime(2026, 9, 30, 17, 30)
NGOAI = datetime(2026, 9, 30, 16, 30)
THANG_10 = {"tu_ngay": date(2026, 10, 1), "den_ngay": date(2026, 10, 31)}


def _dat_tao(db, lsx_id: int, luc: datetime) -> None:
    db.get(Lsx, lsx_id).created_at = luc
    db.commit()


def _khach(db, ten: str) -> Customer:
    c = Customer(code=f"KH-{ten}", name=ten)
    db.add(c)
    db.commit()
    return c


# --- Kế hoạch SX › Lệnh sản xuất ---------------------------------------------------------------
def test_lenh_khsx_loc_ngay_tao_ranh_gio_vn(db, admin, lsx_svc):
    a = _lenh_tho(db, ma="LSX-LOC-A", sale_user_id=admin.id)
    b = _lenh_tho(db, ma="LSX-LOC-B", sale_user_id=admin.id)
    _dat_tao(db, a, TRONG)
    _dat_tao(db, b, NGOAI)
    rows, total = lsx_svc.list_rows(q="LSX-LOC", moc="tao", **THANG_10)
    assert [r["ma"] for r in rows] == ["LSX-LOC-A"] and total == 1
    assert rows[0]["created_at"] is not None


def test_lenh_khsx_loc_han_giao_va_moc_han_sx_cu(db, admin, lsx_svc):
    """`moc=han_giao` lọc theo hạn giao; `moc=han_sx` của link cũ (hạn SX đã gỡ 08/11/2026) hiểu y
    như hạn giao, không vỡ."""
    _lenh_tho(db, ma="LSX-HAN-A", sale_user_id=admin.id, han_giao=date(2026, 10, 5))
    _lenh_tho(db, ma="LSX-HAN-B", sale_user_id=admin.id, han_giao=date(2026, 11, 5))
    for moc in ("han_giao", "han_sx"):
        rows, _ = lsx_svc.list_rows(q="LSX-HAN", moc=moc, **THANG_10)
        assert [r["ma"] for r in rows] == ["LSX-HAN-A"], moc


def test_lenh_khsx_tab_dem_theo_ky(db, admin, lsx_svc):
    """Số trên tab đếm CÙNG kỳ với bảng."""
    a = _lenh_tho(db, ma="LSX-DEM-A", sale_user_id=admin.id)
    b = _lenh_tho(db, ma="LSX-DEM-B", sale_user_id=admin.id)
    _dat_tao(db, a, TRONG)
    _dat_tao(db, b, NGOAI)
    dem = lsx_svc.dem_trang_thai(q="LSX-DEM", moc="tao", **THANG_10)
    assert dem["all"] == 1


def test_lenh_khsx_khach_va_don_loc(db, admin, lsx_svc):
    kh = _khach(db, "Khách Lọc KHSX")
    _lenh_tho(db, ma="LSX-KL-1", sale_user_id=admin.id, customer_id=kh.id)
    _lenh_tho(db, ma="LSX-KL-2", sale_user_id=admin.id, customer_id=kh.id)
    khach = {i: (t, n) for i, t, n in lsx_svc.khach_loc(owner_ids=None)}
    assert khach[kh.id] == ("Khách Lọc KHSX", 2)
    don = {t: n for _, t, n in lsx_svc.don_loc(owner_ids=None)}
    assert don["DH-LSX-KL-1"] == 1


# --- Kế hoạch SX › Hàng chờ ---------------------------------------------------------------------
def _don_cho(db, so: str, *, customer_id=None, tao=None, chuyen=None) -> Order:
    don = Order(
        order_no=so, customer_id=customer_id, status=STATUS_ORDERED,
        san_xuat_released_at=chuyen or datetime(2026, 10, 2, 3, tzinfo=timezone.utc),
    )
    don.lines.append(OrderLine(description="Hộp", qty=10))
    db.add(don)
    db.flush()
    if tao is not None:
        don.created_at = tao
    db.commit()
    return don


def test_hang_cho_loc_ngay_tao_va_chuyen(db):
    repo = LsxRepository(db)
    _don_cho(db, "DH-CHO-A", tao=TRONG, chuyen=datetime(2026, 11, 2, 3))
    _don_cho(db, "DH-CHO-B", tao=NGOAI, chuyen=datetime(2026, 10, 2, 3))
    rows, total = repo.orders_ban_giao(moc="tao", **THANG_10)
    assert {o.order_no for o in rows} >= {"DH-CHO-A"} and "DH-CHO-B" not in {o.order_no for o in rows}
    rows, _ = repo.orders_ban_giao(moc="chuyen", **THANG_10)
    so = {o.order_no for o in rows}
    assert "DH-CHO-B" in so and "DH-CHO-A" not in so


def test_hang_cho_loc_khach_va_o_khach(db, lsx_svc):
    kh = _khach(db, "Khách Hàng Chờ")
    _don_cho(db, "DH-CHO-K1", customer_id=kh.id)
    _don_cho(db, "DH-CHO-K2")
    items, total = lsx_svc.hang_cho(customer_id=kh.id)
    assert [i["order_no"] for i in items] == ["DH-CHO-K1"] and total == 1
    assert items[0]["created_at"] is not None
    assert (kh.id, "Khách Hàng Chờ", 1) in lsx_svc.khach_hang_cho()


# --- Hồ sơ lệnh sản xuất ------------------------------------------------------------------------
def test_ho_so_lenh_moc_mac_dinh_la_ngay_tao(db, admin):
    a = _lenh_tho(db, ma="LSX-HS-A", sale_user_id=admin.id, han_giao=date(2026, 12, 1))
    b = _lenh_tho(db, ma="LSX-HS-B", sale_user_id=admin.id, han_giao=date(2026, 10, 3))
    _dat_tao(db, a, TRONG)
    _dat_tao(db, b, NGOAI)
    d = danh_sach.danh_sach(db, sale_ids=None, q="LSX-HS", **THANG_10)
    assert [i["ma"] for i in d["items"]] == ["LSX-HS-A"]
    assert d["dem_theo_tab"]["tat_ca"] == 1
    assert d["items"][0]["created_at"] is not None
    # `moc=han_giao` (link cũ `han_sx` hiểu như hạn giao).
    d = danh_sach.danh_sach(db, sale_ids=None, q="LSX-HS", moc="han_giao", **THANG_10)
    assert [i["ma"] for i in d["items"]] == ["LSX-HS-B"]


def test_ho_so_lenh_loc_don_va_o_loc(db, admin):
    kh = _khach(db, "Khách Hồ Sơ")
    a = _lenh_tho(db, ma="LSX-HD-A", sale_user_id=admin.id, customer_id=kh.id)
    _lenh_tho(db, ma="LSX-HD-B", sale_user_id=admin.id, customer_id=kh.id)
    don_a = db.get(Lsx, a).order_id
    d = danh_sach.danh_sach(db, sale_ids=None, order_id=don_a)
    assert [i["ma"] for i in d["items"]] == ["LSX-HD-A"]
    assert {"id": kh.id, "ten": "Khách Hồ Sơ", "so": 2} in danh_sach.khach_loc(db, sale_ids=None)
    assert {"id": don_a, "ten": "DH-LSX-HD-A", "so": 1} in danh_sach.don_loc(db, sale_ids=None)


# --- KCS › danh sách lệnh -----------------------------------------------------------------------
def test_kcs_loc_ngay_tao_khach_nhom_va_lan_kcs(db, orders, lsx_svc, admin, customer):
    _to, cv, res = _batch(db, orders, lsx_svc, admin, customer, dat=10, khong_dat=0, cuoi=True)
    nguoi = res["nguoi_kcs"]
    lsx_id = cv.lsx_id
    _dat_tao(db, lsx_id, TRONG)

    def ids(**loc):
        return [i["lsx_id"] for i in kcs.danh_sach_lenh_kcs(db, nguoi, **loc)["items"]]

    d = kcs.danh_sach_lenh_kcs(db, nguoi)
    dong = next(i for i in d["items"] if i["lsx_id"] == lsx_id)
    assert dong["created_at"] is not None and dong["kcs_gan_nhat"] is not None

    assert lsx_id in ids(moc="tao", **THANG_10)
    _dat_tao(db, lsx_id, NGOAI)
    assert lsx_id not in ids(moc="tao", **THANG_10)

    # Mốc `kcs` = lần KCS gần nhất (vừa ghi, tức hôm nay).
    hom_nay = datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=7))).date()
    assert lsx_id in ids(moc="kcs", tu_ngay=hom_nay, den_ngay=hom_nay)
    assert lsx_id not in ids(moc="kcs", tu_ngay=hom_nay + timedelta(days=1))

    assert lsx_id in ids(khach_id=customer.id)
    assert lsx_id not in ids(khach_id=customer.id + 999)
    # Nhóm còn mở ⇒ nút "Đã đóng" không có nó, "Tất cả" có.
    assert lsx_id not in ids(nhanh="da_dong")
    assert lsx_id in ids(nhanh="tat_ca")

    # Cảnh dựng phát hành cả cặp lệnh của đơn ⇒ `so` = số lệnh trong nhóm của khách, khớp bảng.
    khach = {k["id"]: k for k in kcs.khach_loc_kcs(db, nguoi)}
    assert khach[customer.id]["ten"] == customer.name
    assert khach[customer.id]["so"] == kcs.danh_sach_lenh_kcs(
        db, nguoi, khach_id=customer.id)["tong"]


def test_kcs_loc_to_cong_doan_co_loi_loai_nguoi_kiem(db, orders, lsx_svc, admin, customer):
    """Thanh lọc thêm 11/10/2026: lệnh có lỗi do tổ / công đoạn gây, có lỗi hay không, lệnh chính /
    đi kèm, người kiểm — lọc bằng SQL; ô giá trị đếm số lệnh khớp với bảng."""
    to, cv, res = _batch(db, orders, lsx_svc, admin, customer, dat=10, khong_dat=5)
    nguoi = res["nguoi_kcs"]
    lsx_id = cv.lsx_id

    def ids(**loc):
        return {i["lsx_id"] for i in kcs.danh_sach_lenh_kcs(db, nguoi, **loc)["items"]}

    tat_ca = ids()
    assert lsx_id in ids(to_id=to.id) and lsx_id not in ids(to_id=to.id + 999)
    assert lsx_id in ids(cong_doan=cv.ten_cong_doan) and not ids(cong_doan="Không có công đoạn này")
    assert lsx_id in ids(co_loi="co") and lsx_id not in ids(co_loi="khong")
    assert ids(co_loi="co") | ids(co_loi="khong") == tat_ca
    assert ids(loai="chinh") | ids(loai="phu") == tat_ca and not ids(loai="chinh") & ids(loai="phu")
    assert lsx_id in ids(nguoi_kiem_id=nguoi.id) and not ids(nguoi_kiem_id=nguoi.id + 999)

    gt = kcs.gia_tri_loc_kcs(db, nguoi)
    to_ = {o["id"]: o for o in gt["to"]}
    assert to_[to.id]["so"] == len(ids(to_id=to.id))
    assert {"ten": cv.ten_cong_doan, "so": len(ids(cong_doan=cv.ten_cong_doan))} in gt["cong_doan"]
    nk = {o["id"]: o for o in gt["nguoi_kiem"]}
    assert nk[nguoi.id]["so"] == len(ids(nguoi_kiem_id=nguoi.id))


# --- Đường đi HTTP ------------------------------------------------------------------------------
def test_http_nhan_tham_so_ky_va_duong_tinh(client, seed_credentials):
    h = _h(_tok(client, seed_credentials))
    for url in (
        "/api/lsx?moc=han_giao&tu_ngay=2026-10-01&den_ngay=2026-10-31&order_id=1",
        "/api/lsx/hang-cho?moc=chuyen&tu_ngay=2026-10-01&customer_id=1",
        "/api/lsx/khach-loc",
        "/api/lsx/don-loc",
        "/api/lsx/hang-cho/khach-loc",
        "/api/lenh-san-xuat?moc=han_sx&tu_ngay=2026-10-01&order_id=1&gia_cong=tron_goi",
        "/api/lenh-san-xuat/khach-loc",
        "/api/lenh-san-xuat/don-loc",
    ):
        r = client.get(url, headers=h)
        assert r.status_code == 200, (url, r.text)
    assert client.get("/api/lsx?moc=la", headers=h).status_code == 422
    assert client.get("/api/lenh-san-xuat?moc=kcs", headers=h).status_code == 422
    # admin (Giám đốc, có dòng `kcs`) ⇒ 200 — tức đường tĩnh tới được service, không bị
    # `/kcs/lenh/{lsx_id}` nuốt thành 422.
    assert client.get("/api/san-xuat/kcs/lenh/khach-loc", headers=h).status_code == 200
    assert client.get("/api/san-xuat/kcs/lenh/gia-tri-loc", headers=h).status_code == 200
    assert client.get(
        "/api/san-xuat/kcs/lenh?to_id=1&cong_doan=In&co_loi=khong&loai=phu&nguoi_kiem_id=1", headers=h
    ).status_code == 200
    assert client.get("/api/san-xuat/kcs/lenh?co_loi=x", headers=h).status_code == 422
    assert client.get(
        "/api/san-xuat/kcs/lenh?moc=kcs&nhanh=da_dong&khach_id=1", headers=h
    ).status_code == 200
