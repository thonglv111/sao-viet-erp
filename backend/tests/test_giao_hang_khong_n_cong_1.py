"""Guard chống N+1 ở các danh sách của module Giao hàng.

Đếm số câu SQL của MỘT request danh sách khi dữ liệu có ít dòng và khi có nhiều dòng. Số câu phải
ĐỨNG YÊN khi số dòng tăng — tăng theo số dòng nghĩa là đang hỏi DB từng dòng một (26/10/2026: bản
sao E2E đo danh sách yêu cầu giao 61 → 468 câu khi trang 5 → 50 dòng, tab Nhân viên 327 câu cho
15 người, ô chọn tài xế 194 câu).
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date

from sqlalchemy import event

from app.db import SessionLocal, engine
from app.models.employee import STATUS_ACTIVE, Employee
from app.repositories.rbac_repo import DepartmentRepository
from tests.test_giao_hang_api import _admin, _bat_co_giao_hang, _don_da_chot, _len_kh, _tao_yc


@contextmanager
def dem_sql():
    dem = {"n": 0}

    def _nghe(*_a, **_k):
        dem["n"] += 1

    event.listen(engine, "before_cursor_execute", _nghe)
    try:
        yield dem
    finally:
        event.remove(engine, "before_cursor_execute", _nghe)


def _nhan_vien(ma: str, ten: str, phong: str) -> int:
    db = SessionLocal()
    try:
        dept = DepartmentRepository(db).get_by_name(phong)
        e = Employee(code=ma, full_name=ten, department_id=dept.id, hire_date=date(2020, 1, 1),
                     status=STATUS_ACTIVE)
        db.add(e)
        db.commit()
        return e.id
    finally:
        db.close()


def _dung(client, h, n: int, tien_to: str) -> None:
    """n đơn đã chốt, mỗi đơn 2 yêu cầu giao: một yêu cầu lên kế hoạch cho một tài xế MỚI (xen kẽ
    tài xế thuộc bộ phận giao hàng và tài xế ở phòng khác — người phòng khác chỉ hiện vì có chuyến),
    một yêu cầu để chờ lên kế hoạch."""
    for i in range(n):
        oid, lid = _don_da_chot(suffix=f"N1{tien_to}{i}")
        a = _tao_yc(client, h, oid, lid, qty=30)
        _tao_yc(client, h, oid, lid, qty=20)
        phong = "Sản xuất" if i % 2 == 0 else "Kinh doanh"
        nv = _nhan_vien(f"TXN1{tien_to}{i}", f"Tai xe N1 {tien_to} {i}", phong)
        r = _len_kh(client, h, a["id"], nv)
        assert r.status_code == 201, r.text


def _so_cau(client, h, url: str) -> int:
    with dem_sql() as d:
        r = client.get(url, headers=h)
    assert r.status_code == 200, r.text
    return d["n"]


DANH_SACH = [
    "/api/giao-hang/requests?size=50",
    "/api/giao-hang/requests?cho_len_ke_hoach=true&size=50",
    "/api/giao-hang/nhan-vien",
    "/api/giao-hang/tai-xe-chon",
    "/api/giao-hang/bang-giao?size=50",
]


def test_danh_sach_giao_hang_khong_hoi_db_tung_dong(client):
    h = _admin(client)
    _bat_co_giao_hang()
    _dung(client, h, 2, "A")
    it = {u: _so_cau(client, h, u) for u in DANH_SACH}
    _dung(client, h, 6, "B")
    nhieu = {u: _so_cau(client, h, u) for u in DANH_SACH}
    print("\nSO CAU SQL (it dong -> nhieu dong):", {u: (it[u], nhieu[u]) for u in DANH_SACH})
    loi = {u: (it[u], nhieu[u]) for u in DANH_SACH if nhieu[u] > it[u] + 2}
    assert not loi, f"số câu SQL tăng theo số dòng: {loi}"


def _muc_km(n: int, tien_to: str) -> None:
    """n mức khoán km, mỗi mức hai bậc và (i+1) xe đang dùng."""
    from app.models.xe import MucKhoanKm, MucKhoanKmBac, Xe

    db = SessionLocal()
    try:
        for i in range(n):
            m = MucKhoanKm(ten=f"Mức {tien_to}{i}")
            db.add(m)
            db.flush()
            db.add_all([MucKhoanKmBac(muc_id=m.id, seq=2, up_to_km=None, don_gia=3000),
                        MucKhoanKmBac(muc_id=m.id, seq=1, up_to_km=10 + i, don_gia=9000)])
            db.add_all([Xe(ma=f"XE-{tien_to}{i}-{j}", ten=f"Xe {tien_to}{i}{j}", muc_khoan_km_id=m.id)
                        for j in range(i + 1)])
        db.commit()
    finally:
        db.close()


def test_muc_khoan_km_khong_hoi_db_tung_muc(client):
    """Danh sách mức khoán km: bậc + số xe nạp gộp (bản sao: mỗi mức hai câu)."""
    h = _admin(client)
    url = "/api/giao-hang/muc-khoan-km"
    _muc_km(2, "A")
    it = _so_cau(client, h, url)
    _muc_km(6, "B")
    nhieu = _so_cau(client, h, url)
    muc = {m["ten"]: m for m in client.get(url, headers=h).json()["items"]}
    assert muc["Mức B4"]["so_xe"] == 5
    assert muc["Mức B4"]["items"] == [{"up_to_km": 14, "don_gia": 9000.0},
                                      {"up_to_km": None, "don_gia": 3000.0}]
    print("\nSO CAU SQL muc khoan km (2 -> 8 muc):", it, nhieu)
    assert nhieu <= it, f"{url}: {it} -> {nhieu} câu khi tăng số mức"


def test_tab_nhan_vien_chi_nap_chuyen_dang_chay_va_trong_khung(client):
    """Tab Nhân viên giao hàng không nạp cả lịch sử chuyến (DB đo tải 26/10/2026: 18 nghìn chuyến,
    7,7 s). Chỉ chuyến đang chạy + chuyến kết thúc quanh khung ngày/tháng đang xem — kết quả y cũ."""
    from datetime import datetime, timezone

    from app.models.delivery import LG_THANH_CONG, DeliveryTrip
    from app.repositories.delivery_repo import DeliveryRepository

    h = _admin(client)
    _bat_co_giao_hang()
    oid, lid = _don_da_chot(suffix="N1KHUNG")
    nv = _nhan_vien("TXN1KHUNG", "Tai xe khung", "Sản xuất")
    trips = []
    for _ in range(4):
        yc = _tao_yc(client, h, oid, lid, qty=5)
        r = _len_kh(client, h, yc["id"], nv)
        assert r.status_code == 201, r.text
        trips.append(r.json()["trip"]["id"])
    hom = date(2026, 10, 20)
    xong = {
        trips[0]: datetime(2025, 3, 10, 9, tzinfo=timezone.utc),   # cũ — ngoài khung
        trips[1]: datetime(2026, 10, 5, 9, tzinfo=timezone.utc),   # trong tháng
        trips[2]: datetime(2026, 10, 20, 9, tzinfo=timezone.utc),  # hôm nay
    }  # trips[3] vẫn đang chạy
    db = SessionLocal()
    try:
        for tid, luc in xong.items():
            t = db.get(DeliveryTrip, tid)
            t.trang_thai, t.thoi_gian_ket_thuc, t.km = LG_THANH_CONG, luc, 10
        db.commit()
        lo = datetime(2026, 9, 30, tzinfo=timezone.utc)
        hi = datetime(2026, 11, 2, tzinfo=timezone.utc)
        co = {t.id for t in DeliveryRepository(db).chuyen_cua_nhieu_kip(
            [nv], ket_thuc_tu=lo, ket_thuc_den=hi)[nv]}
        assert co == {trips[1], trips[2], trips[3]}
    finally:
        db.close()
    body = client.get(f"/api/giao-hang/nhan-vien?ngay={hom}&thang=2026-10", headers=h).json()
    dong = next(d for d in body["items"] if d["employee_id"] == nv)
    assert (dong["so_chuyen_xong"], dong["tong_km"]) == (1, 10)
    assert (dong["so_chuyen_thang"], dong["tong_km_thang"]) == (2, 20)
    assert dong["trang_thai"] != "ranh" and dong["chuyen_dang_thuc_hien"] is not None
    # Tháng trước khi chuyến cũ còn trong khung: vẫn đếm được.
    body = client.get("/api/giao-hang/nhan-vien?ngay=2025-03-10&thang=2025-03", headers=h).json()
    dong = next(d for d in body["items"] if d["employee_id"] == nv)
    assert (dong["so_chuyen_xong"], dong["so_chuyen_thang"]) == (1, 1)


def test_chuyen_moi_nhat_moi_yeu_cau_dung_not_exists(client):
    """"Chuyến mới nhất của yêu cầu" viết bằng NOT EXISTS (không có lần giao sau), KHÔNG bằng
    `lan_thu = (SELECT max …)` tương quan: Postgres ước sai số dòng của dạng max (90 thay vì 18
    nghìn) rồi nối lồng — bảng Đơn giao hàng 0,6 s mỗi câu trên DB đo tải 26/10/2026."""
    from sqlalchemy import select

    from app.models.delivery import DeliveryTrip
    from app.repositories.delivery_repo import DeliveryRepository

    h = _admin(client)
    _bat_co_giao_hang()
    oid, lid = _don_da_chot(suffix="N1LAN")
    nv = _nhan_vien("TXN1LAN", "Tai xe lan", "Sản xuất")
    yc = _tao_yc(client, h, oid, lid, qty=5)
    goc = _len_kh(client, h, yc["id"], nv).json()["trip"]["id"]
    db = SessionLocal()
    try:
        # Mô hình mới khoá một chuyến mỗi yêu cầu (request_id unique, 22/08/2026) — điều kiện chỉ
        # còn cho dữ liệu cũ nhiều `lan_thu`; ở đây kiểm nó không đánh rơi chuyến duy nhất.
        repo = DeliveryRepository(db)
        assert goc in {x.id for x in repo.list_trips(latest_per_request=True)}
        sql = str(repo._loc_chuyen(select(DeliveryTrip.id), employee_ids=None, department_ids=None,
                                   trang_thai=None, latest_per_request=True))
        assert "NOT (EXISTS" in sql and "max(" not in sql, sql
    finally:
        db.close()
