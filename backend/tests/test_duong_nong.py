"""Đường đọc NÓNG (Task 14, audit sức chịu tải 28/09/2026 mục B): N+1, đếm-không-nạp, memo quyền,
giới hạn đăng nhập sai, index mg 0344.

Khoá bằng SỐ ĐO (đếm câu SQL qua `before_cursor_execute`, cùng lối `test_bang_cong_so_truy_van.py`)
và bằng so khớp NGUYÊN VĂN kết quả trước/sau — tối ưu mà đổi một con số là hỏng.
"""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import Session

from app.db import Base, SessionLocal, engine
from app.db_migrations import _INDEX_0344, MIGRATIONS
from app.models.accounting import PAYMENT_RECEIPT_RECEIVED, RECEIPT_SOURCE_ORDER, PaymentReceipt
from app.models.customer import Customer, CustomerCareTask
from app.models.order import Order, OrderLine
from app.models.role import SCOPE_ALL, SCOPE_OWN
from app.models.user import User
from app.repositories.rbac_repo import DepartmentRepository, RoleRepository
from app.repositories.user_repo import UserRepository
from app.security import hash_password

from .test_kho_de_nghi import _admin, _mk_kho, _mk_material

PW = "pw123456"


def _dem(fn):
    """Chạy `fn()` và đếm số câu SQL nó bắn ra."""
    dem = {"n": 0, "sql": []}

    def _ghi(conn, cursor, statement, parameters, context, executemany):
        dem["n"] += 1
        dem["sql"].append(statement)

    event.listen(engine, "before_cursor_execute", _ghi)
    try:
        kq = fn()
    finally:
        event.remove(engine, "before_cursor_execute", _ghi)
    return kq, dem["n"], dem["sql"]


def _mk_user(username: str, perms: dict[str, dict]) -> int:
    db = SessionLocal()
    try:
        depts, roles, users = DepartmentRepository(db), RoleRepository(db), UserRepository(db)
        dept = depts.get_by_name("Phòng thử tải") or depts.create(name="Phòng thử tải")
        role = roles.create(name=f"Vai {username}", department_id=dept.id)
        for module, p in perms.items():
            roles.set_permission(role_id=role.id, module_key=module, **p)
        u = users.create(username=username, name=username, password_hash=hash_password(PW))
        users.set_assignment(u, department_id=dept.id, role_id=role.id, is_active=True)
        return u.id
    finally:
        db.close()


def _login(client, username: str, pw: str = PW) -> dict[str, str]:
    r = client.post("/api/auth/login", json={"username": username, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ---------------------------------------------------------------- (a) danh sách yêu cầu kho --


def _tao_yeu_cau(client, h, kho_id, mats, so: int, tu: int = 0) -> None:
    # SL khác nhau từng yêu cầu — cùng nội dung trong 30 giây bị coi là gửi lại (chống bấm đúp).
    for i in range(tu, tu + so):
        r = client.post("/api/kho/de-nghi", headers=h, json={
            "loai": "XUAT", "kho_id": kho_id, "lines": [
                {"hang_loai": mats[0][0], "hang_id": mats[0][1], "dvt": "ram", "sl_de_nghi": 2 + i},
                {"hang_loai": mats[1][0], "hang_id": mats[1][1], "dvt": "to", "sl_de_nghi": 7},
                {"hang_loai": mats[2][0], "hang_id": mats[2][1], "dvt": "ram", "sl_de_nghi": 1},
            ],
        })
        assert r.status_code == 201, r.text


def test_danh_sach_yeu_cau_kho_giu_nguyen_ket_qua_va_khong_n_cong_1(client, monkeypatch):
    from app.services.vat_lieu_kho_service import VatLieuKhoService

    h = _admin(client)
    kho_id = _mk_kho(client, h)
    mats = [_mk_material(f"GY-NONG-{i}") for i in (1, 2, 3)]
    _tao_yeu_cau(client, h, kho_id, mats, 2)

    def lay():
        r = client.get("/api/kho/de-nghi?size=200", headers=h)
        assert r.status_code == 200, r.text
        return r.json()

    moi_2, n_moi_2, _ = _dem(lay)
    _tao_yeu_cau(client, h, kho_id, mats, 6, tu=2)
    moi_8, n_moi_8, _ = _dem(lay)
    # Có quy đổi thật (ram → tờ) để chắc là đường quy đổi đã chạy chứ không trả rỗng.
    dong_ram = [ln for it in moi_8["items"] for ln in it["lines"] if ln["dvt"] == "ram"]
    assert dong_ram and all(ln["sl_quy_doi"] == ln["sl_de_nghi"] * 500 for ln in dong_ram)
    # Tên tra theo lô cả trang phải đúng như tra lẻ.
    assert all(it["nguoi_tao_ten"] == "Admin" and it["kho_ten"] == "Kho NVL"
               and it["nguoi_duyet_ten"] == "Admin" for it in moi_8["items"])

    # Bản CŨ: map gom lô rỗng ⇒ mọi dòng rơi về `quy_ve_goc` từng dòng như trước khi sửa.
    monkeypatch.setattr(VatLieuKhoService, "don_vi_nhieu_mat_hang",
                        lambda self, caps, san=None: {})
    # Dòng giấy / vật tư có ĐƠN VỊ GỐC (mg 0390) đi lô theo `(loại, mã, gốc)` — tắt luôn.
    monkeypatch.setattr(VatLieuKhoService, "don_vi_nhieu_theo_goc", lambda self, khoa: {})
    cu_8, n_cu_8, _ = _dem(lay)
    assert cu_8 == moi_8, "kết quả JSON phải Y HỆT đường cũ"
    print(f"\n[kho de-nghi] 8 yêu cầu × 3 dòng: cũ {n_cu_8} câu → mới {n_moi_8} câu "
          f"(2 yêu cầu: {n_moi_2})")
    assert n_moi_8 < n_cu_8
    # Thêm 6 yêu cầu × 3 dòng không được kéo thêm câu nào (số câu là hằng số theo trang).
    assert n_moi_8 == n_moi_2, (n_moi_2, n_moi_8)


# ------------------------------------------------------------- (b) orders notify-summary --


def _don_nhap(so: str, *, coc_pct, gia: int, thu: int = 0) -> int:
    db = SessionLocal()
    try:
        k = db.query(Customer).filter(Customer.code == "KH-NONG").first()
        if k is None:
            k = Customer(code="KH-NONG", name="Khách thử tải")
            db.add(k)
            db.flush()
        admin = db.query(User).filter(User.username == "admin").one()
        o = Order(order_no=so, customer_id=k.id, status="draft", deposit_pct=coc_pct,
                  sale_user_id=admin.id, customer_po_no=f"PO-{so}")
        o.lines.append(OrderLine(description="Hộp", qty=100, don_vi_tinh="cái",
                                 unit_price_snapshot=gia, line_total=100 * gia,
                                 vat_pct_estimate=8))
        db.add(o)
        db.flush()
        if thu:
            db.add(PaymentReceipt(
                code=f"PT-NONG-{o.id}", source_type=RECEIPT_SOURCE_ORDER, order_id=o.id,
                payer_name="Khách", receipt_method="cash", status=PAYMENT_RECEIPT_RECEIVED,
                receipt_date=date.today(), amount=thu, amount_vnd=thu, currency="VND",
                exchange_rate=1, content="Cọc đơn", created_by_user_id=admin.id,
                received_by_user_id=admin.id,
            ))
        db.commit()
        return o.id
    finally:
        db.close()


def test_orders_notify_summary_dung_so_va_so_cau_khong_theo_so_don(client):
    h = _admin(client)
    # 100 × 1000 × 1,08 = 108.000 có VAT; cọc 30% = 32.400.
    _don_nhap("DN-N1", coc_pct=30, gia=1000)              # thiếu cọc
    _don_nhap("DN-N2", coc_pct=30, gia=1000, thu=32400)   # đủ cọc
    _don_nhap("DN-N3", coc_pct=None, gia=1000)            # không cần cọc

    def lay():
        r = client.get("/api/orders/notify-summary", headers=h)
        assert r.status_code == 200, r.text
        return r.json()

    kq3, n3, _ = _dem(lay)
    assert kq3 == {"action_count": 3, "approval_pending": 0,
                   "deposit_pending": 1, "ready_to_confirm": 2}, kq3
    for i in range(6):
        _don_nhap(f"DN-M{i}", coc_pct=50, gia=2000)       # thêm 6 đơn thiếu cọc
    kq9, n9, _ = _dem(lay)
    assert kq9["deposit_pending"] == 7 and kq9["ready_to_confirm"] == 2
    print(f"\n[orders notify-summary] 3 đơn: {n3} câu, 9 đơn: {n9} câu")
    assert n9 == n3, (n3, n9)


# ------------------------------------------------------------------- (c) lịch hẹn --


def test_lich_hen_so_khop_danh_sach(client):
    h = _admin(client)
    sale_id = _mk_user("sale_nong", {"khach_hang": dict(can_read=True, scope=SCOPE_OWN)})
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").one()
        k1 = Customer(code="KH-CS1", name="Khách chăm sóc 1", sale_user_id=sale_id)
        k2 = Customer(code="KH-CS2", name="Khách chăm sóc 2", sale_user_id=admin.id)
        db.add_all([k1, k2])
        db.flush()
        bay_gio = datetime.now(timezone.utc)
        for k, lech, st in ((k1, -3, "open"), (k1, -1, "open"), (k1, 5, "open"),
                            (k2, -2, "open"), (k2, -4, "done")):
            db.add(CustomerCareTask(customer_id=k.id, note="Gọi lại", status=st,
                                    due_date=bay_gio + timedelta(days=lech)))
        db.commit()
    finally:
        db.close()

    def lay(hd, pham_vi="toi"):
        r = client.get(f"/api/customers/lich-hen?pham_vi={pham_vi}", headers=hd)
        assert r.status_code == 200, r.text
        return r.json()

    # Hẹn chưa gán ai tính cho NV phụ trách khách. Số đỏ = trễ + hôm nay còn mở, khớp danh sách;
    # hẹn sắp tới (+5) có trong danh sách nhưng không vào số, hẹn đã xong ngày cũ không hiện.
    sale = lay(_login(client, "sale_nong"))
    assert sale["so"] == 2 and len(sale["items"]) == 3
    assert sale["so"] == sum(o["tre"] for o in sale["items"])
    assert lay(h)["so"] == 1
    assert lay(h, "nhom")["so"] == 3


# ------------------------------------------------------------------ (d) lsx hang-cho --


def test_lsx_hang_cho_chi_dem(client):
    h = _admin(client)
    db = SessionLocal()
    try:
        k = Customer(code="KH-HC", name="Khách hàng chờ")
        db.add(k)
        db.flush()
        for i in range(3):
            o = Order(order_no=f"HC-{i}", customer_id=k.id, status="ordered",
                      san_xuat_released_at=datetime.now(timezone.utc), customer_po_no=f"PO-HC{i}")
            o.lines.append(OrderLine(description="Tem", qty=10, don_vi_tinh="cái",
                                     unit_price_snapshot=1, line_total=10, vat_pct_estimate=0))
            db.add(o)
        db.commit()
    finally:
        db.close()

    day = client.get("/api/lsx/hang-cho", headers=h).json()
    (dem, n_dem, _) = _dem(lambda: client.get("/api/lsx/hang-cho?chi_dem=true", headers=h).json())
    (_, n_day, _) = _dem(lambda: client.get("/api/lsx/hang-cho", headers=h).json())
    assert day["total"] == 3 and len(day["items"]) == 3
    # Ba trường giao đơn (08/11/2026) về mặc định ở đường đếm — không thêm câu nào.
    assert {k: dem[k] for k in ("items", "total", "page", "size")} == {"items": [], "total": 3, "page": 1, "size": 50}
    assert dem["facets"] == {} and dem["cham"] is False
    print(f"\n[lsx hang-cho] đầy đủ {n_day} câu, chi_dem {n_dem} câu")
    assert n_dem < n_day


# --------------------------------------------------------- memo quyền + module-notifications --


def test_permissions_doc_role_permissions_mot_lan(client):
    h = _admin(client)
    r, _, sql = _dem(lambda: client.get("/api/auth/permissions", headers=h))
    assert r.status_code == 200
    doc_quyen = [s for s in sql if "FROM role_permissions" in s]
    assert len(doc_quyen) == 1, doc_quyen


def test_tom_tat_cham_do_mot_cau_sql(client):
    """Cả thanh bên hỏi chấm đỏ bằng MỘT câu gom (không có dòng mới thì khỏi câu chi tiết)."""
    _mk_user("khong_kenh", {"noi_quy": dict(can_read=True, scope=SCOPE_OWN)})
    hd = _login(client, "khong_kenh")
    r, _, sql = _dem(lambda: client.get("/api/module-notifications/summary", headers=hd))
    assert r.status_code == 200 and r.json() == {"kenh": {}}
    assert len([s for s in sql if "module_notification" in s]) <= 1, sql


def test_memo_quyen_bo_khi_phien_ghi():
    """Memo quyền sống trong phiên chỉ-đọc, nhưng phiên vừa ghi (thêm dòng quyền) thì hỏi lại DB."""
    from app.services.rbac_service import AuthorizationService

    from .conftest import phien_da_seed

    gen = phien_da_seed()
    db = next(gen)
    try:
        dept = DepartmentRepository(db).create(name="Phòng memo")
        roles = RoleRepository(db)
        role = roles.create(name="Vai memo", department_id=dept.id)
        az = AuthorizationService(roles)
        u = type("U", (), {"role_id": role.id, "id": 0, "department_id": dept.id})()
        assert az.can(u, "kho", "read") is False
        roles.set_permission(role_id=role.id, module_key="kho", can_read=True, scope=SCOPE_ALL)
        assert az.can(u, "kho", "read") is True
    finally:
        gen.close()


# ------------------------------------------------------------- (e) giới hạn đăng nhập sai --


class _RedisGia:
    """Đủ lệnh mà `gioi_han_dang_nhap` dùng: get/ttl/set(nx, ex)/incr/delete + pipeline."""

    def __init__(self):
        self.kv: dict[str, tuple[int, float]] = {}

    def _song(self, k):
        o = self.kv.get(k)
        if o and o[1] <= time.time():
            self.kv.pop(k, None)
            return None
        return o

    def get(self, k):
        o = self._song(k)
        return str(o[0]) if o else None

    def ttl(self, k):
        o = self._song(k)
        return int(o[1] - time.time()) if o else -2

    def set(self, k, v, ex=None, nx=False):
        if nx and self._song(k):
            return None
        self.kv[k] = (int(v), time.time() + (ex or 10 ** 9))
        return True

    def incr(self, k):
        o = self._song(k) or (0, time.time() + 10 ** 9)
        self.kv[k] = (o[0] + 1, o[1])
        return o[0] + 1

    def delete(self, *ks):
        for k in ks:
            self.kv.pop(k, None)

    def pipeline(self):
        goc = self

        class _P:
            def __init__(self):
                self.lenh = []

            def __getattr__(self, ten):
                return lambda *a, **kw: self.lenh.append((ten, a, kw))

            def execute(self):
                return [getattr(goc, t)(*a, **kw) for t, a, kw in self.lenh]

        return _P()


def test_dang_nhap_sai_10_lan_thi_lan_11_bi_429(client, monkeypatch):
    from app import gioi_han_dang_nhap as gh
    from app.services import auth_service

    gia = _RedisGia()
    monkeypatch.setattr(gh, "_redis", lambda: gia)
    for _ in range(10):
        r = client.post("/api/auth/login", json={"username": "Admin", "password": "sai-mat-khau"})
        assert r.status_code == 401, r.text

    # Bị chặn TRƯỚC khi chạy bcrypt: đếm lượt gọi kiểm mật khẩu.
    goi = {"n": 0}
    goc_login = auth_service.AuthService.login

    def dem_login(self, *a, **kw):
        goi["n"] += 1
        return goc_login(self, *a, **kw)

    monkeypatch.setattr(auth_service.AuthService, "login", dem_login)
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 429, r.text
    assert r.json()["detail"] == "Đăng nhập sai quá nhiều lần, vui lòng thử lại sau 15 phút."
    assert goi["n"] == 0

    # Hết cửa sổ ⇒ đăng nhập đúng được, và xoá bộ đếm theo tên.
    gia.kv = {k: (v, time.time() - 1) if ":ten:" in k else (v, h) for k, (v, h) in gia.kv.items()}
    assert client.post("/api/auth/login",
                       json={"username": "admin", "password": "admin123"}).status_code == 200
    assert not [k for k in gia.kv if ":ten:" in k]


def test_dang_nhap_sai_theo_ip_va_khong_co_redis_thi_bo_qua(client, monkeypatch):
    from app import gioi_han_dang_nhap as gh

    # Không Redis (mặc định của bộ test): sai 12 lần vẫn chỉ 401, không bao giờ 429.
    for _ in range(12):
        assert client.post("/api/auth/login",
                           json={"username": "admin", "password": "x"}).status_code == 401
    gia = _RedisGia()
    monkeypatch.setattr(gh, "_redis", lambda: gia)
    ip = {"X-Forwarded-For": "203.0.113.9, 10.0.0.2"}
    for i in range(30):
        r = client.post("/api/auth/login", headers=ip,
                        json={"username": f"nguoi{i}", "password": "x"})
        assert r.status_code == 401
    r = client.post("/api/auth/login", headers=ip,
                    json={"username": "admin", "password": "admin123"})
    assert r.status_code == 429
    # Redis lỗi ⇒ bỏ qua, không chặn.

    class _Hong:
        def pipeline(self):
            raise ConnectionError("redis chết")

        def delete(self, *a):
            raise ConnectionError("redis chết")

    monkeypatch.setattr(gh, "_redis", lambda: _Hong())
    assert client.post("/api/auth/login", headers=ip,
                       json={"username": "admin", "password": "admin123"}).status_code == 200


# ------------------------------------------------------------------ can-doi cache 45 giây --


def test_can_doi_cache_va_xoa(client, monkeypatch):
    from app.services import can_doi_cache
    from app.services.ke_hoach_vat_tu_service import KeHoachVatTuService

    can_doi_cache.xoa_cache_can_doi()
    h = _admin(client)
    goi = {"n": 0}
    goc = KeHoachVatTuService.can_doi

    def dem(self, *a, **kw):
        goi["n"] += 1
        return goc(self, *a, **kw)

    monkeypatch.setattr(KeHoachVatTuService, "can_doi", dem)
    r1 = client.get("/api/ke-hoach-vat-tu/can-doi", headers=h)
    r2 = client.get("/api/ke-hoach-vat-tu/can-doi", headers=h)
    assert r1.status_code == 200 and r1.json() == r2.json()
    assert goi["n"] == 1
    client.get("/api/ke-hoach-vat-tu/can-doi?chi_thieu=true", headers=h)
    assert goi["n"] == 2                      # tham số khác ⇒ khoá khác
    can_doi_cache.xoa_cache_can_doi()
    client.get("/api/ke-hoach-vat-tu/can-doi", headers=h)
    assert goi["n"] == 3
    can_doi_cache.xoa_cache_can_doi()


# ------------------------------------------------------------------ (f) migration 0344 --


def _chay_0344(db: Session) -> None:
    dict(MIGRATIONS)["0344_index_duong_nong"](db)


def _index_0344_con_bang() -> list:
    """Danh sách index của mg 0344 trừ bảng model đã gỡ SAU đó (vd `san_xuat_ho_tro`, mg 0389) —
    migration tự bỏ qua bảng không có, nên chỉ chấm những bảng còn trong model."""
    return [x for x in _INDEX_0344 if x[0] in Base.metadata.tables]


def test_0344_chay_hai_lan_tren_sqlite_va_tao_du_index():
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    # DB CŨ: bỏ hết index mà mg 0344 lo, như DB dev/prod dựng trước khi model khai.
    with eng.begin() as c:
        for _, ten, _, _ in _INDEX_0344:
            c.execute(text(f"DROP INDEX IF EXISTS {ten}"))
    with Session(eng) as db:
        _chay_0344(db)
        _chay_0344(db)          # chạy lại không nổ
        insp = inspect(db.get_bind())
        for bang, ten, cot, _ in _index_0344_con_bang():
            idx = {i["name"]: i["column_names"] for i in insp.get_indexes(bang)}
            assert idx.get(ten) == list(cot), f"{bang}: thiếu {ten}"
        # Partial index mang đúng điều kiện.
        sql = db.execute(text(
            "SELECT sql FROM sqlite_master WHERE name = 'ix_san_xuat_cong_viec_to_chua_xong'"
        )).scalar_one()
        assert "WHERE trang_thai <> 'completed'" in sql


def test_0344_thieu_bang_thi_bo_qua():
    eng = create_engine("sqlite://")
    with Session(eng) as db:
        db.execute(text("CREATE TABLE refresh_tokens (id INTEGER PRIMARY KEY)"))
        db.commit()
        _chay_0344(db)
        assert inspect(db.get_bind()).get_indexes("refresh_tokens") == []


def test_0344_ten_va_cot_index_trung_model():
    for bang, ten, cot, _ in _index_0344_con_bang():
        idx = {i.name: [c.name for c in i.columns] for i in Base.metadata.tables[bang].indexes}
        assert idx.get(ten) == list(cot), (
            f"{bang}: model chưa khai {ten}{cot} — DB trắng (`create_all`) sẽ lệch DB đi migration")


@pytest.fixture(autouse=True)
def _don_cache_can_doi():
    from app.services.can_doi_cache import xoa_cache_can_doi

    xoa_cache_can_doi()
    yield
    xoa_cache_can_doi()
