"""Thanh lọc chung trên ba màn BÁO CÁO (06/10/2026) — lọc ở MÁY CHỦ.

- Báo cáo kinh doanh: kỳ `tu_ngay`/`den_ngay`/`moc=chot` (bỏ trống = mọi thời gian), Khách hàng
  (`customer_id`), Sale (`sale_id`); `loc-khach` / `loc-sale` trả giá trị kèm số đơn.
- Báo cáo kho — Sổ kho: kỳ đổi `tu`/`den` → `tu_ngay`/`den_ngay` + `moc` (ngày nhập/xuất kho hoặc
  ngày ghi sổ), kho, ô tìm không dấu, khoảng số, cắt trang + tổng tiền ở máy chủ. Người không có ô
  xem giá: khoảng tiền bị bỏ qua, tổng tiền None.
- Báo cáo công nợ: ô tìm mã / tên đối tượng lọc ở máy chủ, dòng tổng tính lại theo phần còn hiện.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.db import SessionLocal
from app.models.role import SCOPE_ALL
from app.models.stock_voucher import StockVoucher
from app.models.user import User
from app.repositories.user_repo import UserRepository
from app.security import hash_password

from .test_bao_cao_kinh_doanh import _don, _h, _khach, _luc
from .test_kho_de_nghi import _admin, _login, _nhap, _setup
from .test_quyen_theo_kho import _nguoi

VN = timezone(timedelta(hours=7))
URL_KD = "/api/bao-cao-kinh-doanh"
URL_SO = "/api/kho/bao-cao/dong"


def _vn(*a) -> datetime:
    return datetime(*a, tzinfo=VN).astimezone(timezone.utc)


def _sale(username: str) -> int:
    db = SessionLocal()
    try:
        u = UserRepository(db).create(username=username, name=f"Sale {username}",
                                      password_hash=hash_password("x12345678"))
        db.commit()
        return u.id
    finally:
        db.close()


def _admin_id() -> int:
    db = SessionLocal()
    try:
        return db.query(User).filter(User.username == "admin").one().id
    finally:
        db.close()


# --- Báo cáo kinh doanh ---------------------------------------------------------------------------

def _so_don(r) -> list[str]:
    assert r.status_code == 200, r.text
    return sorted(d["order_no"] for k in r.json()["khach"] for d in k["don"])


def test_kinh_doanh_ky_tat_ca_khach_va_sale_loc_o_may_chu(client):
    h = _h(client)
    a = _khach("Công ty Lọc KD A", "KH-LKD-A")
    b = _khach("Công ty Lọc KD B", "KH-LKD-B")
    s1, s2 = _admin_id(), _sale("sale_loc_kd")
    _don(a, "DH-LKD-1", chot_luc=_luc(2026, 9, 5), sale_id=s1)
    _don(a, "DH-LKD-2", chot_luc=_luc(2026, 9, 6), sale_id=s2)
    _don(b, "DH-LKD-3", chot_luc=_luc(2026, 8, 20), sale_id=s2)
    _don(b, "DH-LKD-NHAP", chot_luc=None, status="draft", sale_id=s2)

    thang9 = {"tu_ngay": "2026-09-01", "den_ngay": "2026-09-30", "moc": "chot"}
    assert _so_don(client.get(URL_KD, params=thang9, headers=h)) == ["DH-LKD-1", "DH-LKD-2"]
    # Không gửi ngày = mọi thời gian (nút kỳ "Tất cả").
    r = client.get(URL_KD, headers=h)
    assert _so_don(r) == ["DH-LKD-1", "DH-LKD-2", "DH-LKD-3"]
    assert r.json()["tu_ngay"] is None and r.json()["tong"]["so_don"] == 3

    # Khách + sale lọc ở máy chủ, dòng tổng theo đúng phần đã lọc.
    r = client.get(URL_KD, params={"sale_id": s2}, headers=h)
    assert _so_don(r) == ["DH-LKD-2", "DH-LKD-3"]
    assert r.json()["tong"]["so_don"] == 2
    assert _so_don(client.get(URL_KD, params={**thang9, "customer_id": a, "sale_id": s2}, headers=h)) == [
        "DH-LKD-2"]

    # Giá trị chọn được kèm số đơn đã chốt (nháp không tính).
    khach = {x["ten"]: x["so"] for x in client.get(f"{URL_KD}/loc-khach", headers=h).json()}
    assert khach["Công ty Lọc KD A"] == 2 and khach["Công ty Lọc KD B"] == 1
    sale = {x["id"]: x["so"] for x in client.get(f"{URL_KD}/loc-sale", headers=h).json()}
    assert sale[s1] == 1 and sale[s2] == 2

    # Excel mọi thời gian: tên file nói rõ.
    x = client.get(f"{URL_KD}/export.xlsx", params={"sale_id": s2}, headers=h)
    assert x.status_code == 200, x.text
    assert "tat-ca.xlsx" in x.headers["content-disposition"]


def test_kinh_doanh_ranh_gio_ngay_chot_gio_vn(client):
    h = _h(client)
    k = _khach("Công ty Lọc KD Ranh", "KH-LKD-R")
    _don(k, "DH-LKD-TRONG", chot_luc=_vn(2026, 10, 1, 0, 30))    # 30/09 17:30 UTC ⇒ tháng 10
    _don(k, "DH-LKD-NGOAI", chot_luc=_vn(2026, 9, 30, 23, 30))
    r = client.get(URL_KD, params={"tu_ngay": "2026-10-01", "den_ngay": "2026-10-31", "moc": "chot"},
                   headers=h)
    assert _so_don(r) == ["DH-LKD-TRONG"]
    assert client.get(URL_KD, params={"moc": "tao"}, headers=h).status_code == 422


# --- Báo cáo kho — Sổ kho ------------------------------------------------------------------------

def _sua_phieu(vid: int, **cot) -> None:
    db = SessionLocal()
    try:
        v = db.get(StockVoucher, vid)
        for k, val in cot.items():
            setattr(v, k, val)
        db.commit()
    finally:
        db.close()


def _ct(r) -> list[str]:
    assert r.status_code == 200, r.text
    return sorted({x["so_ct"] for x in r.json()["items"]})


def test_so_kho_ky_theo_ngay_chung_tu_va_ngay_ghi_so(client):
    kho_id, mat = _setup(client)
    a = _nhap(client, kho_id=kho_id, mat_id=mat, qty=5, gia=1000)
    b = _nhap(client, kho_id=kho_id, mat_id=mat, qty=6, gia=1000)
    _sua_phieu(a["id"], ngay=date(2026, 8, 15), ghi_so_luc=_vn(2026, 9, 2, 8, 0))
    _sua_phieu(b["id"], ngay=date(2026, 9, 1), ghi_so_luc=_vn(2026, 8, 20, 8, 0))
    h = _admin(client)
    t9 = {"tu_ngay": "2026-09-01", "den_ngay": "2026-09-30", "kho_id": kho_id, "loai": "NHAP"}
    assert _ct(client.get(URL_SO, headers=h, params={**t9, "moc": "ct"})) == [b["ma"]]
    assert _ct(client.get(URL_SO, headers=h, params={**t9, "moc": "ghi_so"})) == [a["ma"]]
    # Ngày ghi sổ theo GIỜ VN: 01/10 00:30 VN là 30/09 UTC nhưng thuộc tháng 10.
    _sua_phieu(a["id"], ghi_so_luc=_vn(2026, 10, 1, 0, 30))
    t10 = {**t9, "tu_ngay": "2026-10-01", "den_ngay": "2026-10-31", "moc": "ghi_so"}
    assert _ct(client.get(URL_SO, headers=h, params=t10)) == [a["ma"]]


def test_so_kho_tim_khoang_so_trang_va_tong_tien(client):
    kho_id, mat = _setup(client)
    phieu = [_nhap(client, kho_id=kho_id, mat_id=mat, qty=q, gia=1000) for q in (5, 7, 9)]
    h = _admin(client)
    base = {"kho_id": kho_id, "loai": "NHAP"}
    # Tìm không dấu theo mã hàng.
    assert len(_ct(client.get(URL_SO, headers=h, params={**base, "q": "gy-kho-1"}))) == 3
    assert _ct(client.get(URL_SO, headers=h, params={**base, "q": "khong-co"})) == []
    # Khoảng số lượng + thành tiền.
    assert _ct(client.get(URL_SO, headers=h, params={**base, "sl_from": 6})) == sorted(
        p["ma"] for p in phieu[1:])
    assert _ct(client.get(URL_SO, headers=h, params={**base, "tt_to": 7000})) == sorted(
        p["ma"] for p in phieu[:2])
    # Máy chủ cắt trang; tổng số dòng + tổng tiền tính trên MỌI dòng khớp lọc.
    r = client.get(URL_SO, headers=h, params={**base, "page": 2, "size": 2})
    assert r.status_code == 200, r.text
    assert len(r.json()["items"]) == 1 and r.json()["total"] == 3
    assert r.json()["tong_tien"] == 21_000
    # File Excel nhận đúng bộ tham số mới.
    x = client.get("/api/kho/bao-cao/export.xlsx", headers=h, params={
        **base, "tu_ngay": "2000-01-01", "den_ngay": "2100-01-01", "moc": "ct", "sl_from": 6})
    assert x.status_code == 200, x.text


def test_so_kho_khong_xem_gia_thi_bo_qua_khoang_tien(client):
    kho_id, mat = _setup(client)
    _nhap(client, kho_id=kho_id, mat_id=mat, qty=5, gia=1000)
    _nhap(client, kho_id=kho_id, mat_id=mat, qty=7, gia=3000)
    _nguoi("xem_bc_kho_khong_gia", {"bao_cao_kho": dict(can_read=True, scope=SCOPE_ALL)})
    u = _login(client, "xem_bc_kho_khong_gia")
    r = client.get(URL_SO, headers=u, params={"kho_id": kho_id, "loai": "NHAP", "tt_from": 10_000})
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 2
    assert r.json()["tong_tien"] is None
    assert all(x["thanh_tien"] is None for x in r.json()["items"])


def test_so_chuyen_kho_nhan_tham_so_ky_moi(client):
    h = _admin(client)
    r = client.get("/api/kho/bao-cao/chuyen-kho", headers=h, params={
        "tu_ngay": "2026-09-01", "den_ngay": "2026-09-30", "moc": "ghi_so", "page": 1, "size": 20})
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 0
    assert client.get("/api/kho/bao-cao/chuyen-kho", headers=h, params={"moc": "tao"}).status_code == 422


# --- Báo cáo công nợ -----------------------------------------------------------------------------

def test_cong_no_tim_doi_tuong_o_may_chu(client):
    from app.services.accounting_service import _business_today as hom_nay

    from .test_payables_api import _da_mua, _dong_dau_tien, _don as _don_mua, _ghi_dot, _headers, _supplier

    headers = _headers(client)
    for ten in ("NCC Lọc Tìm Ánh", "NCC Khác Hẳn"):
        ncc = _supplier(client, headers, name=ten)
        don = _don_mua(client, headers, ncc["id"])
        _da_mua(client, headers, don["id"])
        _ghi_dot(client, headers, don["id"],
                 lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 100}],
                 ngay=(hom_nay() - timedelta(days=3)).isoformat())

    tham = {"tu_ngay": (hom_nay() - timedelta(days=30)).isoformat(), "den_ngay": hom_nay().isoformat()}
    du = client.get("/api/accounting/reports/payables", params=tham, headers=headers).json()
    assert {"NCC Lọc Tìm Ánh", "NCC Khác Hẳn"} <= {d["ten"] for d in du["items"]}

    # Gõ không dấu vẫn ra; dòng tổng chỉ cộng phần còn hiện.
    r = client.get("/api/accounting/reports/payables", params={**tham, "q": "loc tim anh"},
                   headers=headers)
    assert r.status_code == 200, r.text
    assert [d["ten"] for d in r.json()["items"]] == ["NCC Lọc Tìm Ánh"]
    assert r.json()["tong"]["so_dong"] == 1
    assert r.json()["tong"]["cuoi_co"] == r.json()["items"][0]["cuoi_co"]


def test_bao_cao_kho_loc_thuoc_tinh_va_lua_chon(client):
    """Nút Lọc của Chi tiết phiếu + Nhập-Xuất-Tồn (11/10/2026): điều kiện thuộc tính lọc ở máy chủ,
    `lua_chon` đếm TRƯỚC khi áp (chọn một mặt hàng thì menu vẫn bày đủ), kỳ khóa tra theo ngày CT."""
    from app.repositories.kho_khoa_so_repo import KhoKhoaSoRepository

    kho_id, mat = _setup(client)
    a = _nhap(client, kho_id=kho_id, mat_id=mat, qty=5, gia=1000)
    _nhap(client, kho_id=kho_id, mat_id=mat, qty=7, gia=1000)
    _sua_phieu(a["id"], ngay=date(2026, 8, 15))
    h = _admin(client)
    base = {"kho_id": kho_id, "loai": "NHAP"}

    r = client.get(URL_SO, headers=h, params=base)
    assert r.status_code == 200, r.text
    lc = r.json()["lua_chon"]
    assert [(x["value"], x["so"]) for x in lc["mat_hang"]] == [("GY-KHO-1", 2)]
    assert [x["value"] for x in lc["hang_loai"]] == [mat[0]]
    # Menu Lọc chỉ giữ điều kiện người ta cắt báo cáo theo — khổ, ĐVT, kỳ khóa, lệnh… không còn.
    assert set(lc) == {"hang_loai", "mat_hang", "phat_sinh", "ton", "loai_phieu", "ly_do",
                       "khach_hang", "nha_cung_cap"}
    # Cột nguồn phiếu + điều kiện Loại phiếu / Lý do (Chi tiết phiếu gộp nhập + xuất một bảng).
    assert [(x["value"], x["so"]) for x in lc["loai_phieu"]] == [("NHAP", 2)]
    assert [(x["value"], x["so"]) for x in lc["ly_do"]] == [("nhap_khac", 2)]
    dong = r.json()["items"][0]
    assert dong["ly_do_ten"] == "Nhập khác" and dong["ma_yeu_cau"] and dong["nguoi_lap"]
    assert dong["nhom_hang"] == mat[0]
    gop = {"kho_id": kho_id}
    assert client.get(URL_SO, headers=h, params=gop).json()["total"] == 2
    assert client.get(URL_SO, headers=h, params={**gop, "loai_phieu": "XUAT"}).json()["total"] == 0
    assert client.get(URL_SO, headers=h, params={**gop, "loai_phieu": ["NHAP", "XUAT"]}).json()["total"] == 2
    assert client.get(URL_SO, headers=h, params={**gop, "ly_do": "nhap_mua"}).json()["total"] == 0

    assert r.json()["total"] == 2
    assert client.get(URL_SO, headers=h, params={**base, "mat_hang": "KHAC"}).json()["total"] == 0
    r = client.get(URL_SO, headers=h, params={**base, "mat_hang": ["KHAC", "GY-KHO-1"]})
    assert r.json()["total"] == 2
    # Lựa chọn không co lại theo điều kiện đang áp.
    r = client.get(URL_SO, headers=h, params={**base, "mat_hang": "KHAC"})
    assert [x["value"] for x in r.json()["lua_chon"]["mat_hang"]] == ["GY-KHO-1"]
    assert client.get(URL_SO, headers=h, params={**base, "hang_loai": "khong-co"}).json()["total"] == 0

    # Khóa sổ tháng 8 ⇒ phiếu ngày CT 15/08 mang tên kỳ ở cột Kỳ khóa sổ (kỳ chọn ở nút Kỳ, không lọc).
    db = SessionLocal()
    try:
        KhoKhoaSoRepository(db).add(kho_id=None, tu_ngay=date(2026, 8, 1), den_ngay=date(2026, 8, 31),
                                    hanh_dong="khoa", nguoi_khoa_id=None, ten="Tháng 8")
    finally:
        db.close()
    r = client.get(URL_SO, headers=h, params={**base, "tu_ngay": "2026-08-01", "den_ngay": "2026-08-31"})
    assert _ct(r) == [a["ma"]]
    assert r.json()["items"][0]["ky_khoa"] == "Tháng 8"
    # File Excel nhận cùng điều kiện.
    x = client.get("/api/kho/bao-cao/export.xlsx", headers=h, params={**base, "mat_hang": "GY-KHO-1"})
    assert x.status_code == 200, x.text

    # Nhập-Xuất-Tồn: phát sinh + tồn cuối, đếm trước khi áp.
    nxt = {"tu": "2026-08-01", "den": "2100-12-31", "kho_id": kho_id}
    r = client.get("/api/kho/bao-cao/nxt", headers=h, params=nxt)
    assert r.status_code == 200, r.text
    lc = r.json()["lua_chon"]
    assert {x["value"] for x in lc["phat_sinh"]} == {"nhap"}
    assert {x["value"] for x in lc["ton"]} == {"con"}
    assert len(client.get("/api/kho/bao-cao/nxt", headers=h,
                          params={**nxt, "phat_sinh": "nhap"}).json()["items"]) == 1
    assert client.get("/api/kho/bao-cao/nxt", headers=h,
                      params={**nxt, "phat_sinh": "xuat"}).json()["items"] == []
    assert client.get("/api/kho/bao-cao/nxt", headers=h,
                      params={**nxt, "ton": ["het", "am"]}).json()["items"] == []
    x = client.get("/api/kho/bao-cao/nxt/export.xlsx", headers=h, params={**nxt, "ton": "con"})
    assert x.status_code == 200, x.text


def test_bao_cao_kho_nhom_thanh_pham_va_ly_do():
    """Thành phẩm (vật tư bật cờ `la_thanh_pham`) là nhóm hàng riêng; lý do phiếu suy từ nguồn yêu cầu."""
    from types import SimpleNamespace as NS

    from app.routers.kho_baocao import _ly_do, _nhom_hang

    assert _nhom_hang("vat_tu", NS(la_thanh_pham=True)) == "thanh_pham"
    assert _nhom_hang("vat_tu", NS(la_thanh_pham=False)) == "vat_tu"
    assert _nhom_hang("giay", None) == "giay"

    req = NS(purchase_delivery_id=None, san_xuat_cong_viec_id=None, tgc_phieu_giao_id=None,
             tgc_phieu_nhan_id=None, tgc_don_dong_id=None,
             vat_tu_tra_cong_viec_id=None, delivery_trip_id=None)
    assert _ly_do(NS(loai="NHAP"), NS(**{**vars(req), "san_xuat_cong_viec_id": 3}), False) == "nhap_thanh_pham"
    assert _ly_do(NS(loai="NHAP"), NS(**{**vars(req), "purchase_delivery_id": 1}), False) == "nhap_mua"
    assert _ly_do(NS(loai="XUAT"), NS(**{**vars(req), "delivery_trip_id": 9}), False) == "xuat_giao_khach"
    assert _ly_do(NS(loai="XUAT"), req, True) == "xuat_san_xuat"
    assert _ly_do(NS(loai="XUAT"), None, False) == "xuat_khac"

