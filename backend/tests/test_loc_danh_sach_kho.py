"""Kỳ + bộ lọc của các danh sách Kho (06/10/2026) — lọc, đếm tab, phân trang đều ở MÁY CHỦ.

- Phiếu nhập / Phiếu xuất / Điều chuyển của từng kho (`GET /api/kho/phieu?man=ton&kho_id=…`):
  kỳ theo Ngày tạo / Ngày nhập-xuất / Ngày ghi sổ, Trạng thái, Người lập, Giá vốn (chỉ khi xem
  được giá ở ĐÚNG màn đó), số theo tab.
- Yêu cầu nhập xuất + Phiếu từ yêu cầu (`GET /api/kho/de-nghi`, `/counts-by-status`): kỳ theo
  Ngày yêu cầu / Ngày cần / Ngày duyệt, Phòng ban yêu cầu, Người yêu cầu, Kho.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.db import SessionLocal
from app.models.role import SCOPE_ALL
from app.models.stock_request import StockRequest
from app.models.stock_voucher import StockVoucher

from .test_kho_de_nghi import _admin, _approved_request, _login, _nhap, _setup
from .test_quyen_theo_kho import _kho, _nguoi

VN = timezone(timedelta(hours=7))
URL_PHIEU = "/api/kho/phieu"
URL_YC = "/api/kho/de-nghi"


def _vn(*a) -> datetime:
    """Mốc giờ VN, cất dạng UTC như ứng dụng vẫn ghi — SQLite không tự đổi múi."""
    return datetime(*a, tzinfo=VN).astimezone(timezone.utc)


def _sua_phieu(vid: int, **cot) -> None:
    db = SessionLocal()
    try:
        v = db.get(StockVoucher, vid)
        for k, val in cot.items():
            setattr(v, k, val)
        db.commit()
    finally:
        db.close()


def _sua_yc(rid: int, **cot) -> None:
    db = SessionLocal()
    try:
        r = db.get(StockRequest, rid)
        for k, val in cot.items():
            setattr(r, k, val)
        db.commit()
    finally:
        db.close()


def _ma(r) -> list[str]:
    assert r.status_code == 200, r.text
    return [x["ma"] for x in r.json()["items"]]


# --- Phiếu kho theo từng kho -----------------------------------------------------------------

def test_phieu_loc_ngay_tao_ranh_gio_vn(client):
    kho_id, mat = _setup(client)
    a = _nhap(client, kho_id=kho_id, mat_id=mat, qty=5, gia=1000)
    b = _nhap(client, kho_id=kho_id, mat_id=mat, qty=6, gia=1000)
    _sua_phieu(a["id"], created_at=_vn(2026, 10, 1, 0, 30))    # 30/09 17:30 UTC ⇒ thuộc tháng 10
    _sua_phieu(b["id"], created_at=_vn(2026, 9, 30, 23, 30))   # ngoài
    h = _admin(client)
    r = client.get(URL_PHIEU, headers=h, params={
        "kho_id": kho_id, "man": "ton", "tu_ngay": "2026-10-01", "den_ngay": "2026-10-31", "moc": "tao"})
    assert _ma(r) == [a["ma"]]


def test_phieu_loc_theo_ngay_nhap_va_ngay_ghi_so(client):
    kho_id, mat = _setup(client)
    a = _nhap(client, kho_id=kho_id, mat_id=mat, qty=5, gia=1000)
    b = _nhap(client, kho_id=kho_id, mat_id=mat, qty=6, gia=1000)
    _sua_phieu(a["id"], ngay=date(2026, 8, 15), ghi_so_luc=_vn(2026, 9, 2, 8, 0))
    _sua_phieu(b["id"], ngay=date(2026, 9, 1), ghi_so_luc=_vn(2026, 8, 20, 8, 0))
    h = _admin(client)
    tham = {"kho_id": kho_id, "man": "ton", "tu_ngay": "2026-09-01", "den_ngay": "2026-09-30"}
    assert _ma(client.get(URL_PHIEU, headers=h, params={**tham, "moc": "ngay"})) == [b["ma"]]
    assert _ma(client.get(URL_PHIEU, headers=h, params={**tham, "moc": "ghi_so"})) == [a["ma"]]


def test_phieu_dem_theo_tab_va_loc_trang_thai_nguoi_lap(client):
    kho_id, mat = _setup(client)
    _nhap(client, kho_id=kho_id, mat_id=mat, qty=10, gia=1000)
    _nhap(client, kho_id=kho_id, mat_id=mat, qty=11, gia=1000)
    # Một phiếu xuất CHỜ GHI SỔ, do người khác lập.
    req = _approved_request(client, kho_id=kho_id, loai="XUAT", mat_id=mat, qty=3)
    lp = _login(client, "t_lapphieu")
    alloc = client.get(f"{URL_PHIEU}/lo/goi-y", headers=lp, params={
        "hang_loai": mat[0], "hang_id": mat[1], "kho_id": kho_id, "so_luong": 3}).json()
    r = client.post(URL_PHIEU, headers=lp, json={
        "request_id": req["id"], "kho_id": kho_id,
        "lines": [{"request_line_id": req["lines"][0]["id"], "so_luong": x["so_luong"],
                   "lot_id": x["lot_id"]} for x in alloc["lines"]]})
    assert r.status_code == 201, r.text
    xuat = r.json()

    h = _admin(client)
    base = {"kho_id": kho_id, "man": "ton"}
    r = client.get(URL_PHIEU, headers=h, params={**base, "nhom": "xuat"})
    assert _ma(r) == [xuat["ma"]]
    assert r.json()["dem_theo_tab"] == {"nhap": 2, "xuat": 1, "dc": 0}

    # Trạng thái áp vào cả số trên tab.
    r = client.get(URL_PHIEU, headers=h, params={**base, "nhom": "nhap", "trang_thai": "draft"})
    assert _ma(r) == []
    assert r.json()["dem_theo_tab"] == {"nhap": 0, "xuat": 1, "dc": 0}

    # Người lập: giá trị kèm số phiếu, rồi lọc theo đúng người đó.
    ds = client.get(f"{URL_PHIEU}/loc-nguoi-lap", headers=h, params={"kho_id": kho_id}).json()
    so = {d["ten"]: d["so"] for d in ds}
    assert so == {"t_thukho": 2, "t_lapphieu": 1}
    lp_id = next(d["id"] for d in ds if d["ten"] == "t_lapphieu")
    r = client.get(URL_PHIEU, headers=h, params={**base, "nguoi_lap": lp_id})
    assert _ma(r) == [xuat["ma"]]
    assert r.json()["dem_theo_tab"] == {"nhap": 0, "xuat": 1, "dc": 0}


def test_phieu_tim_theo_ma_yeu_cau_va_ten_vat_tu(client):
    kho_id, mat = _setup(client)
    a = _nhap(client, kho_id=kho_id, mat_id=mat, qty=5, gia=1000)
    h = _admin(client)
    base = {"kho_id": kho_id, "man": "ton"}
    assert _ma(client.get(URL_PHIEU, headers=h, params={**base, "q": a["request_ma"]})) == [a["ma"]]
    assert _ma(client.get(URL_PHIEU, headers=h, params={**base, "q": "gy-kho-1"})) == [a["ma"]]
    assert _ma(client.get(URL_PHIEU, headers=h, params={**base, "q": "khong-co-dau"})) == []


def test_phieu_loc_gia_von_khi_xem_duoc_gia_cua_kho_do(client):
    kho_id, mat = _setup(client)
    re_ = _nhap(client, kho_id=kho_id, mat_id=mat, qty=5, gia=1000)      # 5 000
    dat = _nhap(client, kho_id=kho_id, mat_id=mat, qty=7, gia=3000)     # 21 000
    _nguoi("gia_kho_nay", {
        "kho": dict(can_read=True, scope=SCOPE_ALL),
        f"ton_kho_{kho_id}": dict(can_read=True, can_view_cost=True, scope=SCOPE_ALL),
    })
    u = _login(client, "gia_kho_nay")
    base = {"kho_id": kho_id, "man": "ton", "nhom": "nhap"}
    r = client.get(URL_PHIEU, headers=u, params={**base, "gia_tu": 10_000})
    assert _ma(r) == [dat["ma"]]
    assert r.json()["items"][0]["gia_von"] == 21_000
    assert _ma(client.get(URL_PHIEU, headers=u, params={**base, "gia_den": 5_000})) == [re_["ma"]]


def test_phieu_khong_quyen_xem_tien_thi_bo_qua_loc_gia(client):
    kho_id, mat = _setup(client)
    a = _nhap(client, kho_id=kho_id, mat_id=mat, qty=5, gia=1000)
    b = _nhap(client, kho_id=kho_id, mat_id=mat, qty=7, gia=3000)
    du = sorted([a["ma"], b["ma"]], reverse=True)
    # Thủ kho: xem tồn kho này nhưng KHÔNG có ô xem giá ⇒ gửi khoảng giá cũng không lọc, không lộ tiền.
    tk = _login(client, "t_thukho")
    r = client.get(URL_PHIEU, headers=tk, params={"kho_id": kho_id, "man": "ton", "gia_tu": 10_000})
    assert _ma(r) == du
    assert all(x["gia_von"] is None for x in r.json()["items"])
    # Kế toán có `kho.view_cost` (màn Yêu cầu nhập xuất) nhưng ô giá của KHO NÀY bị tắt ⇒ ở màn tồn
    # kho này cũng không lọc được theo tiền.
    _nguoi("gia_man_khac", {
        "kho": dict(can_read=True, can_view_cost=True, scope=SCOPE_ALL),
        f"ton_kho_{kho_id}": dict(can_read=True, scope=SCOPE_ALL),
    })
    u = _login(client, "gia_man_khac")
    r = client.get(URL_PHIEU, headers=u, params={"kho_id": kho_id, "man": "ton", "gia_tu": 10_000})
    assert _ma(r) == du
    assert all(x["gia_von"] is None for x in r.json()["items"])


# --- Yêu cầu nhập xuất + Phiếu từ yêu cầu ----------------------------------------------------

def test_yeu_cau_loc_ngay_tao_ranh_gio_vn_va_dem_tab(client):
    kho_id, mat = _setup(client)
    a = _approved_request(client, kho_id=kho_id, loai="NHAP", mat_id=mat, qty=1)
    b = _approved_request(client, kho_id=kho_id, loai="NHAP", mat_id=mat, qty=2)
    _sua_yc(a["id"], created_at=_vn(2026, 10, 1, 0, 30))
    _sua_yc(b["id"], created_at=_vn(2026, 9, 30, 23, 30))
    h = _admin(client)
    tham = {"loai": "NHAP", "tu_ngay": "2026-10-01", "den_ngay": "2026-10-31", "moc": "tao"}
    assert _ma(client.get(URL_YC, headers=h, params=tham)) == [a["ma"]]
    dem = client.get(f"{URL_YC}/counts-by-status", headers=h, params=tham).json()
    assert dem == {"approved": 1}


def test_yeu_cau_loc_ngay_can_va_ngay_duyet(client):
    kho_id, mat = _setup(client)
    a = _approved_request(client, kho_id=kho_id, loai="XUAT", mat_id=mat, qty=1)
    b = _approved_request(client, kho_id=kho_id, loai="XUAT", mat_id=mat, qty=2)
    _sua_yc(a["id"], ngay_can=date(2026, 11, 5), duyet_luc=_vn(2026, 10, 2, 9, 0))
    _sua_yc(b["id"], ngay_can=date(2026, 10, 20), duyet_luc=_vn(2026, 11, 3, 9, 0))
    h = _admin(client)
    thang10 = {"loai": "XUAT", "tu_ngay": "2026-10-01", "den_ngay": "2026-10-31"}
    assert _ma(client.get(URL_YC, headers=h, params={**thang10, "moc": "can"})) == [b["ma"]]
    assert _ma(client.get(URL_YC, headers=h, params={**thang10, "moc": "duyet"})) == [a["ma"]]


def test_yeu_cau_loc_phong_ban_nguoi_yeu_cau_va_kho(client):
    kho_id, mat = _setup(client)
    h = _admin(client)
    kho_b = _kho(client, h, "Kho B lọc")
    a = _approved_request(client, kho_id=kho_id, loai="NHAP", mat_id=mat, qty=1)
    # Yêu cầu thứ hai: tạo rồi lập phiếu ở Kho B (yêu cầu thường không gắn kho — kho quyết ở phiếu).
    b = _approved_request(client, kho_id=None, loai="NHAP", mat_id=mat, qty=2, gia=100)
    tk = _login(client, "t_thukho")
    r = client.post(URL_PHIEU, headers=tk, json={
        "request_id": b["id"], "kho_id": kho_b,
        "lines": [{"request_line_id": b["lines"][0]["id"], "so_luong": 2}]})
    assert r.status_code == 201, r.text
    # Yêu cầu thứ ba do người khác, phòng khác tạo.
    kt = _login(client, "t_ketoan")
    r = client.post(URL_YC, headers=kt, json={"loai": "NHAP", "lines": [
        {"hang_loai": mat[0], "hang_id": mat[1], "dvt": "to", "sl_de_nghi": 3}]})
    if r.status_code != 201:   # kế toán không có ô tạo yêu cầu ⇒ dùng người duyệt (cùng phòng SX)
        r = client.post(URL_YC, headers=_login(client, "t_duyet"), json={"loai": "NHAP", "lines": [
            {"hang_loai": mat[0], "hang_id": mat[1], "dvt": "to", "sl_de_nghi": 3}]})
    assert r.status_code == 201, r.text
    c = r.json()

    nguoi = client.get(f"{URL_YC}/loc-nguoi-yeu-cau", headers=h, params={"loai": "NHAP"}).json()
    so = {d["ten"]: d["so"] for d in nguoi}
    assert so["t_denghi"] == 2 and sum(so.values()) == 3
    dn_id = next(d["id"] for d in nguoi if d["ten"] == "t_denghi")
    r = client.get(URL_YC, headers=h, params={"loai": "NHAP", "nguoi_yeu_cau": dn_id})
    assert set(_ma(r)) == {a["ma"], b["ma"]}

    phong = client.get(f"{URL_YC}/loc-bo-phan", headers=h, params={"loai": "NHAP"}).json()
    assert sum(d["so"] for d in phong) == 3
    bp = next(d for d in phong if d["so"] >= 1)
    r = client.get(URL_YC, headers=h, params={"loai": "NHAP", "bo_phan": bp["id"]})
    assert len(_ma(r)) == bp["so"]

    khos = {d["id"]: d["so"] for d in client.get(f"{URL_YC}/loc-kho", headers=h,
                                                    params={"loai": "NHAP"}).json()}
    assert khos.get(kho_b) == 1
    assert _ma(client.get(URL_YC, headers=h, params={"loai": "NHAP", "kho": kho_b})) == [b["ma"]]
    dem = client.get(f"{URL_YC}/counts-by-status", headers=h,
                     params={"loai": "NHAP", "kho": kho_b}).json()
    assert sum(dem.values()) == 1
    assert c["ma"] not in _ma(client.get(URL_YC, headers=h, params={"loai": "NHAP", "kho": kho_b}))


def test_yeu_cau_loc_theo_nguon_va_dem_tab(client):
    """Điều kiện Nguồn (12/10/2026): các nguồn LOẠI TRỪ nhau theo thứ tự ô Nguồn trên danh sách;
    `/loc-nguon` đếm đúng tầm nhìn, và số tab theo trạng thái cũng áp nguồn."""
    kho_id, mat = _setup(client)
    h = _admin(client)
    mua, giao, kcs, gc, tay, xuat_cv = (
        _approved_request(client, kho_id=kho_id, loai=loai, mat_id=mat, qty=i + 1)
        for i, loai in enumerate(["NHAP", "XUAT", "NHAP", "NHAP", "NHAP", "XUAT"]))
    _sua_yc(mua["id"], purchase_delivery_id=901)
    _sua_yc(giao["id"], delivery_trip_id=902)
    _sua_yc(kcs["id"], san_xuat_cong_viec_id=903)
    # Gia công THẮNG KCS (#41, 18/10/2026): thành phẩm nhà gia công giao về mang cả công việc lẫn
    # gia công ngoài, mà KCS không kiểm lô đó.
    _sua_yc(gc["id"], san_xuat_cong_viec_id=904, gia_cong_ngoai_id=905)
    _sua_yc(xuat_cv["id"], san_xuat_cong_viec_id=906)    # XUẤT có công việc ≠ KCS ⇒ không nguồn

    so = {d["id"]: d["so"] for d in client.get(f"{URL_YC}/loc-nguon", headers=h).json()}
    assert so == {"mua_hang": 1, "giao_hang": 1, "kcs": 1, "gia_cong": 1, "khong": 2}

    def ma(*nguon):
        return set(_ma(client.get(URL_YC, headers=h, params={"nguon": list(nguon)})))

    assert ma("kcs") == {kcs["ma"]}
    assert ma("gia_cong") == {gc["ma"]}
    assert ma("khong") == {tay["ma"], xuat_cv["ma"]}
    assert ma("mua_hang", "giao_hang") == {mua["ma"], giao["ma"]}
    assert ma("san_xuat") == set()
    assert len(ma("khong", "la_ma_khong_co")) == 2          # giá trị lạ bị bỏ qua
    dem = client.get(f"{URL_YC}/counts-by-status", headers=h, params={"nguon": ["kcs", "gia_cong"]}).json()
    assert sum(dem.values()) == 2
    xuat = client.get(f"{URL_YC}/loc-nguon", headers=h, params={"loai": "XUAT"}).json()
    assert {d["id"]: d["so"] for d in xuat} == {"giao_hang": 1, "khong": 1}
    assert next(d for d in xuat if d["id"] == "giao_hang")["ten"] == "Giao hàng"
