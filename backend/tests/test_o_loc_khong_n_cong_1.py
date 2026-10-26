"""Guard chống N+1 ở các ô LỌC người / bộ phận / kho và vài danh sách nhỏ đi kèm.

Đếm số câu SQL của MỘT request khi có ít và nhiều người (phòng, kho, nhóm). Số câu phải ĐỨNG YÊN —
26/10/2026 lượt quét bản sao E2E bắt mỗi người một câu SELECT users/roles/departments: hộp "NV phụ
trách" đơn hàng 15 câu users + 5 câu roles, `/api/customers/sales` 11 câu roles, ô "Phòng ban yêu
cầu" của đề nghị kho 11 câu departments, ô "Kho" đếm riêng từng kho...
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date

from sqlalchemy import event, update

from app.db import SessionLocal, engine
from app.models.department import Department
from app.models.kho_hang import KhoHang
from app.models.kho_khoa_so import KhoKhoaSo
from app.models.nhom_dung_chung import NhomDungChung, NhomDungChungThanhVien
from app.models.role import Role
from app.models.stock_request import StockRequest
from app.models.stock_voucher import StockVoucher
from app.models.user import User


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


def _admin(client) -> dict[str, str]:
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _so_cau(client, h, url: str) -> int:
    with dem_sql() as d:
        r = client.get(url, headers=h)
    assert r.status_code == 200, r.text
    return d["n"]


def _dung(n: int, tien_to: str, *, kinh_doanh: bool = True) -> list[int]:
    """n người, mỗi người một phòng + một vai + một kho riêng; mỗi người có một đề nghị kho, một
    phiếu kho, một lần khoá sổ kho; cả bọn vào chung một nhóm dùng chung."""
    db = SessionLocal()
    try:
        nhom = NhomDungChung(ten=f"Nhóm {tien_to}")
        db.add(nhom)
        db.flush()
        ids: list[int] = []
        for i in range(n):
            d = Department(name=f"Phòng {tien_to}{i}", code=f"N1{tien_to}{i}", la_kinh_doanh=kinh_doanh)
            db.add(d)
            db.flush()
            r = Role(name=f"Vai {tien_to}{i}", department_id=d.id)
            db.add(r)
            db.flush()
            u = User(username=f"n1_{tien_to}{i}", name=f"Người {tien_to}{i}", password_hash="x",
                     department_id=d.id, role_id=r.id, is_active=True)
            k = KhoHang(ma=f"KHO-N1{tien_to}{i}", ten=f"Kho {tien_to}{i}")
            db.add_all([u, k])
            db.flush()
            yc = StockRequest(ma=f"YC-N1{tien_to}{i}", loai="NHAP", nguoi_tao_id=u.id,
                              bo_phan_id=d.id, kho_id=k.id, trang_thai="approved")
            db.add(yc)
            db.flush()
            db.add(StockVoucher(ma=f"PK-N1{tien_to}{i}", loai="NHAP", request_id=yc.id, kho_id=k.id,
                                ngay=date(2026, 10, 1), nguoi_lap_id=u.id))
            db.add(KhoKhoaSo(kho_id=k.id, tu_ngay=date(2020, 1, 1 + i), den_ngay=date(2020, 1, 1 + i),
                             nguoi_khoa_id=u.id, ten=f"Kỳ {tien_to}{i}"))
            db.add(NhomDungChungThanhVien(nhom_id=nhom.id, user_id=u.id))
            ids.append(u.id)
        db.commit()
        return ids
    finally:
        db.close()


O_LOC = [
    "/api/customers/sales",
    "/api/kho/de-nghi/loc-bo-phan",
    "/api/kho/de-nghi/loc-nguoi-yeu-cau",
    "/api/kho/de-nghi/loc-kho",
    "/api/kho/phieu/loc-nguoi-lap",
    "/api/kho/khoa-so",
    "/api/nhom-dung-chung",
]


def test_o_loc_khong_hoi_db_tung_nguoi(client):
    h = _admin(client)
    _dung(2, "A")
    it = {u: _so_cau(client, h, u) for u in O_LOC}
    _dung(8, "B")
    nhieu = {u: _so_cau(client, h, u) for u in O_LOC}
    print("\nSO CAU SQL o loc (it -> nhieu):", {u: (it[u], nhieu[u]) for u in O_LOC})
    loi = {u: (it[u], nhieu[u]) for u in O_LOC if nhieu[u] > it[u] + 1}
    assert not loi, f"số câu SQL tăng theo số người: {loi}"
    # Nạp gộp không được đổi giá trị: tên + số đếm từng mục vẫn đúng.
    lay = lambda u: {d["ten"]: d["so"] for d in client.get(u, headers=h).json()}  # noqa: E731
    assert lay("/api/kho/de-nghi/loc-kho")["Kho B3"] == 1
    assert lay("/api/kho/de-nghi/loc-bo-phan")["Phòng B3"] == 1
    assert lay("/api/kho/de-nghi/loc-nguoi-yeu-cau")["Người B3"] == 1
    assert lay("/api/kho/phieu/loc-nguoi-lap")["Người B3"] == 1
    ks = [k for k in client.get("/api/kho/khoa-so", headers=h).json() if k["ten"] == "Kỳ B3"]
    assert ks[0]["kho_ten"] == "Kho B3" and ks[0]["nguoi_khoa_ten"] == "Người B3"
    nhom = [n for n in client.get("/api/nhom-dung-chung", headers=h).json() if n["ten"] == "Nhóm B"]
    assert [t["ho_ten"] for t in nhom[0]["thanh_viens"]] == [f"Người B{i}" for i in range(8)]
    sale = {s["name"]: s for s in client.get("/api/customers/sales", headers=h).json()}
    assert sale["Người B3"]["vai_tro"] == "Vai B3" and sale["Người B3"]["phong_ban"] == "Phòng B3"


def _dem_lua_chon_nguoi(user_ids: list[int]) -> int:
    from app.services.nguoi_phu_trach_service import lua_chon_nguoi

    db = SessionLocal()
    try:
        nguoi_xem = db.get(User, user_ids[0])
        db.expunge_all()
        with dem_sql() as d:
            ra = lua_chon_nguoi(db, {uid: 1 for uid in user_ids}, nguoi_xem)
        assert len(ra) == len(user_ids)
        assert all(o.vai_tro and o.phong_ban for o in ra)
        return d["n"]
    finally:
        db.close()


def test_hop_nv_phu_trach_khong_hoi_db_tung_nguoi(client):
    """Hộp "NV phụ trách" của Đơn hàng bán / Báo giá / Tính giá thành dùng chung `lua_chon_nguoi`."""
    it = _dem_lua_chon_nguoi(_dung(2, "C"))
    nhieu = _dem_lua_chon_nguoi(_dung(8, "D"))
    print("\nSO CAU SQL lua_chon_nguoi (it -> nhieu):", it, nhieu)
    assert nhieu <= it, f"lua_chon_nguoi: {it} -> {nhieu} câu khi tăng số người"


def _dem_du_tu_cach() -> int:
    from app.services.customer_service import nguoi_du_tu_cach_nhan_khach

    db = SessionLocal()
    try:
        with dem_sql() as d:
            nguoi_du_tu_cach_nhan_khach(db)
        return d["n"]
    finally:
        db.close()


def test_du_tu_cach_nhan_khach_theo_quyen_khong_hoi_tung_nguoi(client):
    """Chưa khai khối Kinh doanh ⇒ luật lùi về quyền đọc `khach_hang` của vai từng người."""
    db = SessionLocal()
    try:
        db.execute(update(Department).values(la_kinh_doanh=False))
        db.commit()
    finally:
        db.close()
    _dung(2, "E", kinh_doanh=False)
    it = _dem_du_tu_cach()
    _dung(8, "F", kinh_doanh=False)
    nhieu = _dem_du_tu_cach()
    print("\nSO CAU SQL du tu cach (it -> nhieu):", it, nhieu)
    assert nhieu <= it, f"nguoi_du_tu_cach_nhan_khach: {it} -> {nhieu} câu"
