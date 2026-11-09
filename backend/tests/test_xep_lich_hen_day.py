"""Xếp lịch kiểu HẸN ĐẨY (08/11/2026, docs/design-go-toc-do-may-va-xep-lich.md).

Người điều phối hẹn giờ đẩy cho lệnh; tới giờ vòng nền `quet_tu_day` tự đẩy bằng quyền của người
hẹn. Đẩy không được thì lệnh "kẹt" kèm lý do và người hẹn nhận thông báo.

Lệnh dựng THẲNG bằng ORM (đơn + dòng đơn + lệnh) như `test_xep_lich_lenh_api.py`: ở đây kiểm luật
hẹn, tab, sắp xếp và vòng tự đẩy, không kiểm con số sản xuất. Mã lệnh đều bắt đầu bằng `HD-` và
mọi lần đọc bàn đều lọc `tim="HD-"` để không lẫn dữ liệu khác của DB test.
"""
from __future__ import annotations

import ast
import inspect as _inspect
from datetime import date, datetime, timedelta, timezone

import pytest

from app.db import SessionLocal
from app.models.audit import AuditLog
from app.models.lsx import TT_DA_PHAT_HANH, TT_NHAP, TT_SAN_SANG, Lsx
from app.models.module_notification import ModuleNotification
from app.models.order import Order, OrderLine
from app.models.san_xuat import SanXuatCongViec, SanXuatGoiPhatHanh
from app.models.user import User
from app.models.xep_lich_lenh import XepLichLenh
from app.repositories.audit_repo import AuditLogRepository
from app.services.gio_xuong import gio_xuong

ADMIN = {"username": "admin", "password": "admin123"}
GOC = "/api/xep-lich"


# ============================================================== helper
def _hd(client) -> dict[str, str]:
    tok = client.post("/api/auth/login", json=ADMIN).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def _bay_gio() -> datetime:
    """Giờ xưởng bây giờ, naive — đúng thứ ô chọn giờ của màn gửi lên."""
    return gio_xuong().replace(tzinfo=None, second=0, microsecond=0)


def _hom_nay() -> date:
    return _bay_gio().date()


def _lenh(ma: str, *, tt: str = TT_SAN_SANG, han: date | None = None, gap: bool = False,
          nhom: str | None = None, don: int | None = None) -> int:
    db = SessionLocal()
    try:
        if don is None:
            o = Order(order_no=f"DH-{ma}")
            db.add(o)
            db.flush()
            don = o.id
        ol = OrderLine(order_id=don, description=ma, qty=1, nhom=nhom)
        db.add(ol)
        db.flush()
        l = Lsx(ma=ma, ten=f"Sản phẩm {ma}", order_id=don, order_line_id=ol.id, trang_thai=tt,
                so_luong_dat=1000, han_giao_khach=han, is_rush=gap)
        db.add(l)
        db.commit()
        return l.id
    finally:
        db.close()


def _don_cua(lid: int) -> int:
    db = SessionLocal()
    try:
        return db.get(Lsx, lid).order_id
    finally:
        db.close()


def _admin_id() -> int:
    db = SessionLocal()
    try:
        return db.query(User).filter(User.username == "admin").one().id
    finally:
        db.close()


def _hen_tho(lid: int, luc: datetime, *, nguoi_id: int | None = None, ket: str | None = None) -> None:
    """Hàng hẹn ghi thẳng — để có hẹn ở QUÁ KHỨ (đường `hen` chặn) cho vòng tự đẩy."""
    db = SessionLocal()
    try:
        db.add(XepLichLenh(lsx_id=lid, bat_dau_at=luc.replace(tzinfo=timezone.utc),
                           created_by=nguoi_id, nguoi_hen_id=nguoi_id, ket_ly_do=ket,
                           ket_luc=datetime.now(timezone.utc) if ket else None))
        db.commit()
    finally:
        db.close()


def _da_day(lid: int, luc_utc: datetime | None = None) -> None:
    """Lệnh đã đẩy kèm gói đang chạy — `created_at` của gói là lúc đẩy."""
    db = SessionLocal()
    try:
        l = db.get(Lsx, lid)
        l.trang_thai = TT_DA_PHAT_HANH
        g = SanXuatGoiPhatHanh(ma=f"G-{l.ma}", created_at=luc_utc or datetime.now(timezone.utc))
        db.add(g)
        db.flush()
        db.add(SanXuatCongViec(goi_id=g.id, lsx_id=lid, ten_cong_doan="In"))
        db.commit()
    finally:
        db.close()


def _hang(lid: int) -> XepLichLenh | None:
    db = SessionLocal()
    try:
        r = db.query(XepLichLenh).filter(XepLichLenh.lsx_id == lid).one_or_none()
        if r is not None:
            db.expunge(r)
        return r
    finally:
        db.close()


def _trang_thai(lid: int) -> str:
    db = SessionLocal()
    try:
        return db.get(Lsx, lid).trang_thai
    finally:
        db.close()


def _vet(lid: int) -> list[tuple[str, int | None, str | None]]:
    db = SessionLocal()
    try:
        return [(a.action, a.actor_user_id, a.detail) for a in db.query(AuditLog)
                .filter(AuditLog.target == f"lsx:{lid}").order_by(AuditLog.id)]
    finally:
        db.close()


def _svc(db):
    from app.services.xep_lich.hen_day import HenDayService

    return HenDayService(db, AuditLogRepository(db))


def _ban(**kw) -> dict:
    kw.setdefault("tu", _hom_nay() - timedelta(days=1))
    kw.setdefault("den", _hom_nay() + timedelta(days=13))
    kw.setdefault("tim", "HD-")
    db = SessionLocal()
    try:
        return _svc(db).ban(**kw)
    finally:
        db.close()


def _hen(lsx_ids: list[int], luc: datetime) -> int:
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").one()
        return _svc(db).hen(lsx_ids, luc, actor=admin)
    finally:
        db.close()


# ============================================================== migration
def test_migration_0470_chay_hai_lan_va_dua_moc_cu_vao_ket():
    from sqlalchemy import create_engine, inspect, text
    from sqlalchemy.orm import Session

    from app.db_migrations import _migrate_xep_lich_hen_day

    eng = create_engine("sqlite://")
    with eng.begin() as c:
        c.execute(text("CREATE TABLE lsx (id INTEGER PRIMARY KEY, trang_thai VARCHAR(30))"))
        c.execute(text("CREATE TABLE xep_lich_lenh (id INTEGER PRIMARY KEY, lsx_id INTEGER, "
                       "bat_dau_at DATETIME, created_by INTEGER, created_at DATETIME, updated_at DATETIME)"))
        c.execute(text("INSERT INTO lsx VALUES (1, 'san_sang'), (2, 'da_phat_hanh')"))
        c.execute(text("INSERT INTO xep_lich_lenh VALUES (1, 1, '2026-09-01 08:00', 7, NULL, NULL), "
                       "(2, 2, '2026-09-01 08:00', 8, NULL, NULL)"))
    with Session(eng) as db:
        _migrate_xep_lich_hen_day(db)
        _migrate_xep_lich_hen_day(db)
    cot = {c["name"] for c in inspect(eng).get_columns("xep_lich_lenh")}
    assert {"nguoi_hen_id", "ket_ly_do", "ket_luc"} <= cot
    with eng.connect() as c:
        hang = {r[0]: r[1:] for r in c.execute(text(
            "SELECT lsx_id, nguoi_hen_id, ket_ly_do, ket_luc FROM xep_lich_lenh"))}
    assert hang[1][0] == 7 and "Hẹn lại giờ" in hang[1][1] and hang[1][2] is not None
    assert hang[2][0] == 8 and hang[2][1] is None   # lệnh đã đẩy: mốc cũ không đụng tới ai


# ============================================================== hẹn
def test_hen_chan_gio_qua_khu(client):
    from app.services.xep_lich.hen_day import HenDayError

    lid = _lenh("HD-QK")
    with pytest.raises(HenDayError, match="Giờ hẹn phải sau bây giờ"):
        _hen([lid], _bay_gio() - timedelta(minutes=1))
    assert _hang(lid) is None


def test_hen_chan_lenh_nhap(client):
    from app.services.xep_lich.hen_day import HenDayError

    lid = _lenh("HD-NHAP", tt=TT_NHAP)
    with pytest.raises(HenDayError, match="chưa sẵn sàng hoặc đã đẩy"):
        _hen([lid], _bay_gio() + timedelta(hours=1))


def test_hen_ghi_dung_gio_khong_trai_lich(client):
    """23:17 nằm ngoài ca: giờ hẹn là giờ người chọn, không trải theo ca như mốc bắt đầu cũ."""
    lid = _lenh("HD-GIO")
    luc = datetime.combine(_hom_nay() + timedelta(days=2), datetime.min.time()).replace(hour=23, minute=17)
    assert _hen([lid], luc) == 1
    r = _hang(lid)
    assert r.bat_dau_at.replace(tzinfo=None) == luc
    assert r.nguoi_hen_id == _admin_id()
    assert [v[0] for v in _vet(lid)] == ["xep_lich_hen_day"]


def test_doi_gio_xoa_ket(client):
    lid = _lenh("HD-DOI")
    _hen_tho(lid, _bay_gio() - timedelta(hours=1), nguoi_id=_admin_id(), ket="Lệnh đi cùng cụm còn Nháp")
    _hen([lid], _bay_gio() + timedelta(hours=3))
    r = _hang(lid)
    assert r.ket_ly_do is None and r.ket_luc is None
    hanh_dong, _ai, chi_tiet = _vet(lid)[-1]
    assert hanh_dong == "xep_lich_doi_gio_hen" and " sang " in chi_tiet


def test_bo_hen_xoa_hang_va_ghi_vet(client):
    lid = _lenh("HD-BO")
    _hen([lid], _bay_gio() + timedelta(hours=3))
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").one()
        _svc(db).bo_hen(lid, actor=admin)
    finally:
        db.close()
    assert _hang(lid) is None
    assert _vet(lid)[-1][0] == "xep_lich_bo_hen"


# ============================================================== bàn
def test_tab_dem_dung(client):
    k, c, h, d = (_lenh(m) for m in ("HD-K", "HD-C", "HD-H", "HD-D"))
    _hen_tho(k, _bay_gio() - timedelta(hours=1), nguoi_id=_admin_id(), ket="Kẹt thử")
    _hen([h], _bay_gio() + timedelta(days=1))
    _da_day(d)
    kq = _ban(tab="chua_hen")
    assert kq["dem_tab"] == {"ket": 1, "chua_hen": 1, "da_hen": 1, "da_day": 1}
    assert [x["lsx_id"] for x in kq["dong"]] == [c]
    assert [x["lsx_id"] for x in _ban(tab="ket")["dong"]] == [k]
    assert _ban(tab="ket")["dong"][0]["ket_ly_do"] == "Kẹt thử"
    assert [x["lsx_id"] for x in _ban(tab="da_hen")["dong"]] == [h]
    dd = _ban(tab="da_day")["dong"]
    assert [x["lsx_id"] for x in dd] == [d]
    assert dd[0]["da_day_luc"] is not None and dd[0]["vat_tu"] is None


def test_da_hen_loc_theo_khoang(client):
    gan, xa = _lenh("HD-GAN"), _lenh("HD-XA")
    _hen([gan], _bay_gio() + timedelta(days=1))
    _hen([xa], _bay_gio() + timedelta(days=20))
    kq = _ban(tab="da_hen", tu=_hom_nay(), den=_hom_nay() + timedelta(days=13))
    assert [x["lsx_id"] for x in kq["dong"]] == [gan]
    assert kq["dem_tab"]["da_hen"] == 1


def test_dem_tab_moi_tab_theo_khoang_cua_minh(client):
    """Tab Đã hẹn xem từ hôm nay tới, tab Đã đẩy xem từ hôm nay lùi lại (mockup B). Số trên tab
    phải bằng số dòng thấy khi bấm vào tab đó, dù đang đứng ở tab nào."""
    h, d = _lenh("HD-KH"), _lenh("HD-KD")
    _hen([h], _bay_gio() + timedelta(days=2))
    _da_day(d, datetime.now(timezone.utc) - timedelta(days=5))
    toi = dict(tu=_hom_nay(), den=_hom_nay() + timedelta(days=13))
    qua = dict(day_tu=_hom_nay() - timedelta(days=13), day_den=_hom_nay())
    for tab in ("chua_hen", "da_hen", "da_day"):
        kq = _ban(tab=tab, **toi, **qua)
        assert (kq["dem_tab"]["da_hen"], kq["dem_tab"]["da_day"]) == (1, 1), tab
    assert [x["lsx_id"] for x in _ban(tab="da_day", **toi, **qua)["dong"]] == [d]
    assert [x["lsx_id"] for x in _ban(tab="da_hen", **toi, **qua)["dong"]] == [h]


def test_dem_ngay(client):
    a, b, c = _lenh("HD-N1"), _lenh("HD-N2"), _lenh("HD-N3")
    mai = datetime.combine(_hom_nay() + timedelta(days=1), datetime.min.time()).replace(hour=8)
    _hen([a, b], mai)
    _hen([c], mai + timedelta(days=1))
    dem = _ban(tab="chua_hen")["dem_ngay"]
    assert dem[mai.date().isoformat()] == 2
    assert dem[(mai.date() + timedelta(days=1)).isoformat()] == 1
    assert dem.get(_hom_nay().isoformat(), 0) == 0


def test_sap_xep_gap_truoc(client):
    t = _hom_nay()
    a = _lenh("HD-S-A", han=t + timedelta(days=1))
    b = _lenh("HD-S-B", han=t + timedelta(days=5), gap=True)
    c = _lenh("HD-S-C")
    assert [x["lsx_id"] for x in _ban(tab="chua_hen")["dong"]] == [b, a, c]
    x, y, z = _lenh("HD-S-X"), _lenh("HD-S-Y", gap=True), _lenh("HD-S-Z")
    _hen([x], _bay_gio() + timedelta(days=2))
    _hen([y], _bay_gio() + timedelta(days=3))
    _hen([z], _bay_gio() + timedelta(days=1))
    assert [d["lsx_id"] for d in _ban(tab="da_hen")["dong"]] == [y, z, x]


def test_loc_sat_han_va_gap_dem_truoc_khi_ap(client):
    t = _hom_nay()
    sat = _lenh("HD-L-SAT", han=t + timedelta(days=2))
    _lenh("HD-L-XA", han=t + timedelta(days=6), gap=True)
    kq = _ban(tab="chua_hen", sat_han=True)
    assert [x["lsx_id"] for x in kq["dong"]] == [sat]
    assert kq["dem_loc"]["sat_han"] == 1 and kq["dem_loc"]["gap"] == 1
    assert kq["tong"] == 1


# ============================================================== vòng tự đẩy
def _quet(**kw) -> int:
    from app.services.xep_lich.hen_day import quet_tu_day

    return quet_tu_day(**kw)


def test_quet_tu_day_day_lenh_toi_gio(client):
    lid = _lenh("HD-Q-TOI")
    _hen_tho(lid, _bay_gio() - timedelta(minutes=1), nguoi_id=_admin_id())
    assert _quet() == 1
    assert _trang_thai(lid) == TT_DA_PHAT_HANH
    tu_day = [v for v in _vet(lid) if v[0] == "xep_lich_tu_day"]
    assert len(tu_day) == 1 and tu_day[0][1] == _admin_id()
    # Chỉ một dòng vết cho một lần tự đẩy — không kèm thêm "xep_lich_phat_hanh".
    assert "xep_lich_phat_hanh" not in [v[0] for v in _vet(lid)]


def test_quet_khong_day_lenh_chua_toi_gio(client):
    lid = _lenh("HD-Q-CHUA")
    _hen([lid], _bay_gio() + timedelta(hours=1))
    assert _quet() == 0
    assert _trang_thai(lid) == TT_SAN_SANG


def test_quet_ket_khi_phat_hanh_loi(client):
    """Lệnh đi cùng nhóm thành phẩm còn Nháp: phát hành chặn cả cụm ⇒ kẹt, người hẹn được báo."""
    a = _lenh("HD-Q-KET", nhom="Bộ hộp")
    _lenh("HD-Q-KET-NHAP", tt=TT_NHAP, nhom="Bộ hộp", don=_don_cua(a))
    _hen_tho(a, _bay_gio() - timedelta(minutes=1), nguoi_id=_admin_id())
    assert _quet() == 0
    r = _hang(a)
    assert "Nháp" in (r.ket_ly_do or "") and r.ket_luc is not None
    assert _trang_thai(a) == TT_SAN_SANG
    assert _vet(a)[-1][0] == "xep_lich_tu_day_ket"
    db = SessionLocal()
    try:
        tb = db.query(ModuleNotification).filter(
            ModuleNotification.channel == "xep_lich",
            ModuleNotification.event_type == "tu_day_ket").all()
    finally:
        db.close()
    assert [t.recipient_user_id for t in tb] == [_admin_id()]
    # Đã kẹt thì vòng sau không thử lại (chờ người hẹn lại giờ).
    assert _quet() == 0
    assert [v[0] for v in _vet(a)].count("xep_lich_tu_day_ket") == 1


def test_quet_ket_khi_nguoi_hen_mat_quyen(client):
    db = SessionLocal()
    try:
        u = User(username="hd_khong_quyen", name="Không quyền", password_hash="x", is_active=True)
        db.add(u)
        db.commit()
        uid = u.id
    finally:
        db.close()
    lid = _lenh("HD-Q-QUYEN")
    _hen_tho(lid, _bay_gio() - timedelta(minutes=1), nguoi_id=uid)
    assert _quet() == 0
    assert _hang(lid).ket_ly_do == "Người hẹn không còn quyền đẩy lệnh"
    assert _trang_thai(lid) == TT_SAN_SANG


def test_quet_hai_lan_khong_day_lai(client):
    lid = _lenh("HD-Q-HAI")
    _hen_tho(lid, _bay_gio() - timedelta(minutes=1), nguoi_id=_admin_id())
    assert _quet() == 1
    assert _quet() == 0
    assert [v[0] for v in _vet(lid)].count("xep_lich_tu_day") == 1


def test_thu_hoi_xoa_gio_hen_cu(client):
    """Thu hồi lệnh đã tự đẩy: hẹn cũ đã qua mà còn nằm lại thì vòng sau đẩy lại ngay."""
    lid, h = _lenh("HD-Q-THU"), _hd(client)
    _hen_tho(lid, _bay_gio() - timedelta(minutes=1), nguoi_id=_admin_id())
    assert _quet() == 1
    r = client.delete(f"{GOC}/phat-hanh/{lid}?ly_do=Khách dời hạn", headers=h)
    assert r.status_code == 200, r.text
    assert _hang(lid) is None
    assert _quet() == 0


# ============================================================== đẩy ngay
def test_day_ngay_gom_loi(client):
    ok = _lenh("HD-DN-OK")
    loi = _lenh("HD-DN-LOI", nhom="Bộ")
    _lenh("HD-DN-LOI-NHAP", tt=TT_NHAP, nhom="Bộ", don=_don_cua(loi))
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").one()
        kq = _svc(db).day_ngay([ok, loi], actor=admin)
    finally:
        db.close()
    assert kq["da_day"] == ["HD-DN-OK"]
    assert [x["ma"] for x in kq["loi"]] == ["HD-DN-LOI"] and "Nháp" in kq["loi"][0]["ly_do"]
    assert _trang_thai(ok) == TT_DA_PHAT_HANH
    # Toast nói được số yêu cầu xuất vừa tự gửi kho như nút phát hành cũ.
    assert kq["vat_tu"] == {"so_yeu_cau": 0, "bo_qua": []}


def test_day_ngay_ca_cum_khong_bao_loi_lenh_thu_hai(client):
    a = _lenh("HD-DN-C1", nhom="Cụm")
    b = _lenh("HD-DN-C2", nhom="Cụm", don=_don_cua(a))
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").one()
        kq = _svc(db).day_ngay([a, b], actor=admin)
    finally:
        db.close()
    assert sorted(kq["da_day"]) == ["HD-DN-C1", "HD-DN-C2"] and kq["loi"] == []


# ============================================================== API
MOI = {"ban", "hen", "hen_theo_loc", "bo_hen", "day_ngay", "lich_su_hen", "ngan_hen"}


def test_moi_route_moi_co_cua_quyen():
    from app.routers import xep_lich as r

    cay = ast.parse(_inspect.getsource(r))
    ham = {n.name: n for n in ast.walk(cay) if isinstance(n, ast.FunctionDef) and n.name in MOI}
    assert set(ham) == MOI
    for ten, n in ham.items():
        nguon = ast.unparse(n)
        doc = any(".get(" in ast.unparse(d) for d in n.decorator_list)
        mong = 'require_permission(MODULE, "read")' if doc else 'require_permission(MODULE, "approve")'
        assert mong.replace('"', "'") in nguon or mong in nguon, ten


def test_moi_duong_ghi_moi_deu_day_sse():
    from app.routers import xep_lich as r

    cay = ast.parse(_inspect.getsource(r))
    ghi = {"hen", "hen_theo_loc", "bo_hen", "day_ngay"}
    thay = {n.name for n in ast.walk(cay) if isinstance(n, ast.FunctionDef) and n.name in ghi
            and ("_phat_lich_doi(" in ast.unparse(n) or "sau_phat_hanh.bao(" in ast.unparse(n))}
    assert thay == ghi


def test_ban_phan_trang_25(client):
    for i in range(27):
        _lenh(f"HD-P-{i:02d}")
    h = _hd(client)
    q = f"tab=chua_hen&tu={_hom_nay()}&den={_hom_nay() + timedelta(days=13)}&tim=HD-P-"
    r1 = client.get(f"{GOC}/ban?{q}", headers=h)
    assert r1.status_code == 200, r1.text
    assert len(r1.json()["dong"]) == 25 and r1.json()["tong"] == 27
    r2 = client.get(f"{GOC}/ban?{q}&trang=2", headers=h).json()
    assert len(r2["dong"]) == 2


def test_ban_khoang_qua_92_ngay_thi_400(client):
    h = _hd(client)
    r = client.get(f"{GOC}/ban?tab=da_hen&tu=2026-01-01&den=2026-06-01", headers=h)
    assert r.status_code == 400
    assert client.get(f"{GOC}/ban?tab=da_hen", headers=h).status_code == 422


def test_ban_api_khoang_da_day_rieng(client):
    d = _lenh("HD-API-D")
    _da_day(d, datetime.now(timezone.utc) - timedelta(days=5))
    h = _hd(client)
    q = (f"tab=chua_hen&tu={_hom_nay()}&den={_hom_nay() + timedelta(days=13)}&tim=HD-API-"
         f"&day_tu={_hom_nay() - timedelta(days=13)}&day_den={_hom_nay()}")
    r = client.get(f"{GOC}/ban?{q}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["dem_tab"]["da_day"] == 1


def test_hen_api_va_sse(client, monkeypatch):
    from app.routers import xep_lich as r

    phat: list = []
    monkeypatch.setattr(r, "_phat_lich_doi", lambda lsx_id=None, **k: phat.append(lsx_id))
    lid, h = _lenh("HD-API"), _hd(client)
    luc = (_bay_gio() + timedelta(days=1)).isoformat()
    rr = client.post(f"{GOC}/hen", json={"lsx_ids": [lid], "hen_luc": luc}, headers=h)
    assert rr.status_code == 200, rr.text
    assert rr.json() == {"ok": True, "so_lenh": 1}
    assert client.post(f"{GOC}/hen", json={"lsx_ids": [lid], "hen_luc": "2020-01-01T08:00:00"},
                       headers=h).status_code == 400
    assert client.delete(f"{GOC}/hen/{lid}", headers=h).status_code == 200
    assert client.delete(f"{GOC}/hen/{lid}", headers=h).status_code == 404
    assert len(phat) == 2


def test_hen_theo_loc(client):
    a, b = _lenh("HD-TL-A"), _lenh("HD-TL-B")
    _lenh("HD-KHAC")
    h = _hd(client)
    luc = (_bay_gio() + timedelta(days=1)).isoformat()
    rr = client.post(f"{GOC}/hen-theo-loc", headers=h, json={
        "tab": "chua_hen", "tu": str(_hom_nay()), "den": str(_hom_nay() + timedelta(days=13)),
        "tim": "HD-TL-", "hen_luc": luc})
    assert rr.status_code == 200, rr.text
    assert rr.json()["so_lenh"] == 2
    assert _hang(a) is not None and _hang(b) is not None


def test_day_ngay_api(client):
    lid, h = _lenh("HD-API-DN"), _hd(client)
    rr = client.post(f"{GOC}/day-ngay", json={"lsx_ids": [lid]}, headers=h)
    assert rr.status_code == 200, rr.text
    assert rr.json() == {"da_day": ["HD-API-DN"], "loi": [], "vat_tu": {"so_yeu_cau": 0, "bo_qua": []}}


def test_lich_su_hen_moi_nhat_truoc(client):
    lid, h = _lenh("HD-LS"), _hd(client)
    _hen([lid], _bay_gio() + timedelta(days=1))
    _hen([lid], _bay_gio() + timedelta(days=2))
    rr = client.get(f"{GOC}/lenh/{lid}/lich-su-hen", headers=h)
    assert rr.status_code == 200, rr.text
    viec = [x["viec"] for x in rr.json()]
    assert viec == ["Đổi giờ hẹn", "Hẹn đẩy"]
    assert rr.json()[0]["nguoi"]
    # Ngăn đã là của lệnh này: chi tiết bỏ tiền tố "Lệnh …:" mà Nhật ký hệ thống cần.
    doi, moi = rr.json()[0]["chi_tiet"], rr.json()[1]["chi_tiet"]
    assert " sang " in doi and not doi.startswith("Lệnh ")
    assert moi.count("/") == 2 and not moi.startswith("Lệnh ")


def test_ngan_co_vat_tu_va_cong_doan(client):
    lid, h = _lenh("HD-NGAN"), _hd(client)
    rr = client.get(f"{GOC}/lenh/{lid}/ngan", headers=h)
    assert rr.status_code == 200, rr.text
    body = rr.json()
    assert body["dau"]["lsx_id"] == lid and body["dau"]["ma"] == "HD-NGAN"
    assert isinstance(body["vat_tu"], list) and isinstance(body["cong_doan"], list)
    assert client.get(f"{GOC}/lenh/999999/ngan", headers=h).status_code == 404
