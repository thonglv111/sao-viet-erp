"""Trạng thái vật tư của bước + cổng Bắt đầu (spec 2026-10-18 §5.1, §5.3).

Bước có yêu cầu tự lập dựng qua luồng Xếp lịch 3 thật (fixture `lenh`). Cổng Bắt đầu dựng qua
`_mot_cv` của `test_san_xuat_thuc_thi` (tổ có quyền, có thợ) rồi gắn đề nghị bằng `V.tao`.
"""
from __future__ import annotations

from datetime import date, datetime

import pytest
from sqlalchemy import event

from app.models.san_xuat import SanXuatCongViec
from app.models.san_xuat_vat_tu import SanXuatVatTuDeNghi
from app.models.stock_request import StockRequest
from app.services.san_xuat.trang_thai_vat_tu import ly_do_vat_tu, trang_thai_vat_tu
from tests.test_xep_lich_lenh_service import (  # noqa: F401
    _hai_lsx_san_sang, _khai_giay_len_buoc_in, admin, customer, db, hai_lenh, lenh, lsx_svc,
    orders, svc3,
)

_MOC = datetime(2026, 9, 11, 8, 0)


def _buoc_in_cv(db, lsx_id):
    from app.models.lsx import LsxCongDoan

    b = db.query(LsxCongDoan).filter(LsxCongDoan.lsx_id == lsx_id, LsxCongDoan.nhom == "print").first()
    return db.query(SanXuatCongViec).filter(SanXuatCongViec.lsx_cong_doan_id == b.id).first()


def _req(db, cv, lan_so=1):
    dn = db.query(SanXuatVatTuDeNghi).filter_by(cong_viec_id=cv.id, lan_so=lan_so).one()
    return db.get(StockRequest, dn.stock_request_id)


def _phieu(db, req, trang_thai_phieu):
    from app.models.stock_voucher import VOUCHER_XUAT, StockVoucher

    db.add(StockVoucher(
        ma=f"PXK-TT-{req.id}-{trang_thai_phieu}", loai=VOUCHER_XUAT, request_id=req.id, kho_id=1,
        ngay=date(2026, 9, 11), nguoi_lap_id=req.nguoi_tao_id, trang_thai=trang_thai_phieu,
    ))


def cap_du_vat_tu(db, cv) -> None:
    """Kho xuất đủ mọi yêu cầu còn tính của công việc (phiếu ghi sổ + yêu cầu `done`). Test cũ của
    cổng Bắt đầu gọi helper này thay vì nới luật."""
    for dn in db.query(SanXuatVatTuDeNghi).filter_by(cong_viec_id=cv.id):
        req = db.get(StockRequest, dn.stock_request_id) if dn.stock_request_id else None
        if req is None or req.trang_thai in ("cancelled", "rejected", "done"):
            continue
        _phieu(db, req, "posted")
        req.trang_thai = "done"
    db.commit()


def _phat_hanh(db, svc3, lenh, admin):
    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    return _buoc_in_cv(db, lenh.id)


def _muc(db, cv):
    tt = trang_thai_vat_tu(db, [cv])[cv.id]
    return tt and tt["muc"]


def test_muc_cho_kho_khi_vua_phat_hanh(db, svc3, lenh, admin):
    cv = _phat_hanh(db, svc3, lenh, admin)
    tt = trang_thai_vat_tu(db, [cv])[cv.id]
    assert tt["muc"] == "cho_kho"
    (mon,) = tt["mon"]
    assert mon["ten"] and mon["sl_xin"] > 0 and mon["sl_da_xuat"] == 0 and mon["chot_thieu"] is False


def test_muc_kho_dang_soan_khi_co_phieu_nhap(db, svc3, lenh, admin):
    cv = _phat_hanh(db, svc3, lenh, admin)
    req = _req(db, cv)
    _phieu(db, req, "draft")
    req.trang_thai = "preparing"
    db.commit()
    assert _muc(db, cv) == "kho_dang_soan"


def test_muc_cap_thieu_khi_partial(db, svc3, lenh, admin):
    cv = _phat_hanh(db, svc3, lenh, admin)
    req = _req(db, cv)
    req.trang_thai = "partial"
    db.commit()
    assert _muc(db, cv) == "cap_thieu"


def test_muc_san_sang_khi_done_ke_ca_chot_thieu(db, svc3, lenh, admin):
    cv = _phat_hanh(db, svc3, lenh, admin)
    req = _req(db, cv)
    req.trang_thai = "done"
    ln = req.lines[0]
    ln.sl_chot_thuc_xuat = float(ln.sl_de_nghi) / 2
    db.commit()
    tt = trang_thai_vat_tu(db, [cv])[cv.id]
    assert tt["muc"] == "san_sang"
    assert tt["mon"][0]["chot_thieu"] is True


def test_kho_huy_thi_ve_chua_yeu_cau(db, svc3, lenh, admin):
    cv = _phat_hanh(db, svc3, lenh, admin)
    _req(db, cv).trang_thai = "cancelled"
    db.commit()
    assert _muc(db, cv) == "chua_yeu_cau"
    assert ly_do_vat_tu("chua_yeu_cau") == "Chưa có yêu cầu vật tư còn hiệu lực. Gửi yêu cầu ở tab Vật tư trước."


def test_lan_bo_sung_dang_cho_keo_buoc_ve_cho_kho(db, svc3, lenh, admin):
    from app.models.department import Department
    from app.services.san_xuat import vat_tu_de_nghi as V
    from tests.quyen_to_fixtures import cap_quyen_to

    cv = _phat_hanh(db, svc3, lenh, admin)
    req = _req(db, cv)
    _phieu(db, req, "posted")
    req.trang_thai = "done"
    cap_quyen_to(db, admin, db.get(Department, cv.department_id))
    db.commit()
    assert _muc(db, cv) == "san_sang"
    kh = V._kh_service(db, V._hang_service(db)).nhu_cau_cua_cong_viec(cv)
    V.tao(db, user=admin, cong_viec_id=cv.id, can_luc=_MOC, lines=[
        {"hang_loai": k["hang_loai"], "hang_id": k["hang_id"], "kho_rong": k["kho_rong"],
         "kho_dai": k["kho_dai"], "dvt": k["dvt"], "sl_yeu_cau": k["sl"]} for k in kh])
    assert _muc(db, cv) == "cho_kho"


def test_buoc_khong_can_vat_tu_tra_none(db, svc3, lenh, admin):
    cv = _phat_hanh(db, svc3, lenh, admin)
    db.query(SanXuatVatTuDeNghi).filter_by(cong_viec_id=cv.id).delete()
    cv.can_vat_tu = False
    db.commit()
    assert trang_thai_vat_tu(db, [cv])[cv.id] is None


def test_cau_chan_tung_muc():
    assert ly_do_vat_tu("cho_kho") == (
        "Vật tư chưa sẵn sàng: đang chờ kho. Đợi kho xuất xong mới bắt đầu được.")
    assert ly_do_vat_tu("kho_dang_soan") == (
        "Vật tư chưa sẵn sàng: kho đang soạn. Đợi kho xuất xong mới bắt đầu được.")
    assert ly_do_vat_tu("cap_thieu") == (
        "Vật tư chưa sẵn sàng: kho mới cấp một phần. Đợi kho xuất nốt mới bắt đầu được.")


def test_trang_thai_lo_25_cong_viec_so_truy_van_co_dinh(db, svc3, hai_lenh, admin):
    a, b = hai_lenh
    for x in (a, b):
        svc3.dat_moc(x.id, _MOC)
        svc3.phat_hanh(x.id, actor=admin)
    cvs = db.query(SanXuatCongViec).all()
    cvs = (cvs * 13)[:25]
    dem = []

    def _dem(*_a, **_k):
        dem.append(1)

    eng = db.get_bind()
    event.listen(eng, "before_cursor_execute", _dem)
    try:
        trang_thai_vat_tu(db, cvs)
    finally:
        event.remove(eng, "before_cursor_execute", _dem)
    assert len(dem) <= 4


# ------------------------------------------------------------------ cổng Bắt đầu

from tests.test_san_xuat_thuc_thi import _emp, _mot_cv  # noqa: E402


def _cv_co_tho(db, orders, lsx_svc, admin, customer, ma):
    from app.services.san_xuat import thuc_thi

    to, cv = _mot_cv(db, orders, lsx_svc, admin, customer, ma=ma)
    e = _emp(db, to, f"NV-{ma}")
    thuc_thi.phan_cong(db, user=admin, cong_viec_id=cv.id, employee_id=e.id)
    db.refresh(cv)
    return cv


def test_bat_dau_bi_chan_khi_chua_san_sang(db, orders, lsx_svc, admin, customer):
    from app.services.san_xuat import thuc_thi

    cv = _cv_co_tho(db, orders, lsx_svc, admin, customer, "TO-VTS1")
    cv.can_vat_tu = True
    db.commit()
    with pytest.raises(ValueError, match="Chưa có yêu cầu vật tư còn hiệu lực. Gửi yêu cầu ở tab Vật tư trước."):
        thuc_thi.bat_dau(db, user=admin, cong_viec_id=cv.id, expected_version=cv.version)


def test_bat_dau_duoc_khi_san_sang(db, orders, lsx_svc, admin, customer):
    from app.services.san_xuat import thuc_thi
    from app.services.san_xuat import vat_tu_de_nghi as V

    cv = _cv_co_tho(db, orders, lsx_svc, admin, customer, "TO-VTS2")
    kh = V._kh_service(db, V._hang_service(db)).nhu_cau_cua_cong_viec(cv)
    V.tao(db, user=admin, cong_viec_id=cv.id, can_luc=_MOC, lines=[
        {"hang_loai": k["hang_loai"], "hang_id": k["hang_id"], "kho_rong": k["kho_rong"],
         "kho_dai": k["kho_dai"], "dvt": k["dvt"], "sl_yeu_cau": k["sl"]} for k in kh])
    db.refresh(cv)
    with pytest.raises(ValueError, match="đang chờ kho"):
        thuc_thi.bat_dau(db, user=admin, cong_viec_id=cv.id, expected_version=cv.version)
    db.rollback()

    cap_du_vat_tu(db, cv)
    db.refresh(cv)
    thuc_thi.bat_dau(db, user=admin, cong_viec_id=cv.id, expected_version=cv.version)
    db.refresh(cv)
    assert cv.trang_thai == "running"


def test_buoc_in_nhan_giay_tu_cat_khong_bi_chan(db, svc3, lenh, admin):
    """Cùng mã giấy ở Cắt tờ và In: In không có yêu cầu giấy, không có món khác ⇒ không chặn."""
    import uuid

    from app.models.lsx import LsxCongDoan, LsxCongDoanVatTu

    in_ = db.query(LsxCongDoan).filter(LsxCongDoan.lsx_id == lenh.id, LsxCongDoan.nhom == "print").first()
    g = db.query(LsxCongDoanVatTu).filter_by(lsx_cong_doan_id=in_.id, hang_loai="giay").one()
    cat = LsxCongDoan(step_key=str(uuid.uuid4()), lsx_id=lenh.id, thu_tu=int(in_.thu_tu or 0) - 1,
                      cong_doan_id=in_.cong_doan_id, ten="Cắt tờ", nhom=in_.nhom,
                      department_id=in_.department_id, may_id=in_.may_id)
    db.add(cat)
    db.flush()
    db.add(LsxCongDoanVatTu(
        lsx_cong_doan_id=cat.id, hang_loai="giay", vat_tu_id=g.vat_tu_id,
        vat_tu_ma_snapshot=g.vat_tu_ma_snapshot, vat_tu_ten_snapshot=g.vat_tu_ten_snapshot,
        don_vi_snapshot=g.don_vi_snapshot, so_luong=1.0, kho_rong=g.kho_rong, kho_dai=g.kho_dai,
        thu_tu=0, tu_dong=False,
    ))
    db.commit()
    cv_in = _phat_hanh(db, svc3, lenh, admin)
    assert trang_thai_vat_tu(db, [cv_in])[cv_in.id] is None


def test_loc_vuong_chua_san_sang_vat_tu(db, svc3, lenh, admin):
    from app.repositories.san_xuat_repo import SanXuatRepository
    from app.services.san_xuat.loc_ban_to import thuoc_tinh

    cv = _phat_hanh(db, svc3, lenh, admin)
    ra = thuoc_tinh(db, SanXuatRepository(db), [cv], can={"vuong"})
    assert "chua_san_sang_vat_tu" in ra[cv.id]["vuong"]
    cap_du_vat_tu(db, cv)
    ra = thuoc_tinh(db, SanXuatRepository(db), [cv], can={"vuong"})
    assert "chua_san_sang_vat_tu" not in ra[cv.id]["vuong"]


# ============================================================ lưới bàn tổ + tin từ kho (Task 6)

def _admin_h(client) -> dict[str, str]:
    tok = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"}).json()
    return {"Authorization": f"Bearer {tok['access_token']}"}


def _cap_quyen_to_cua(db, admin, cv):
    from app.models.department import Department
    from tests.quyen_to_fixtures import cap_quyen_to

    cap_quyen_to(db, admin, db.get(Department, cv.department_id))
    db.commit()


def test_danh_sach_ban_to_tra_trang_thai_vat_tu(client, db, svc3, lenh, admin):
    cv = _phat_hanh(db, svc3, lenh, admin)
    _cap_quyen_to_cua(db, admin, cv)
    h = _admin_h(client)

    r = client.get("/api/san-xuat/work-items", params={"team_id": cv.department_id}, headers=h)
    assert r.status_code == 200, r.text
    items = {it["id"]: it for nhom in r.json()["lenh"] for it in nhom["cong_viec"]}
    tt = items[cv.id]["trang_thai_vat_tu"]
    assert tt["muc"] == "cho_kho"
    assert tt["mon"][0]["sl_xin"] > 0 and tt["mon"][0]["sl_da_xuat"] == 0

    r = client.get("/api/san-xuat/work-items", params={"team_id": cv.department_id, "nhom": "phang"},
                   headers=h)
    assert {it["id"]: it for it in r.json()["cong_viec"]}[cv.id]["trang_thai_vat_tu"]["muc"] == "cho_kho"


def _nhap_ton(client, h, req):
    """Nhập đủ hàng của yêu cầu tự lập vào một kho (đề nghị NHẬP → phiếu → ghi sổ, qua API). Trả kho."""
    ln = req.lines[0]
    r = client.post("/api/kho", json={"ten": "Kho NVL test"}, headers=h)
    assert r.status_code in (200, 201), r.text
    kho_id = r.json()["id"]
    r = client.post("/api/kho/de-nghi", headers=h, json={"loai": "NHAP", "kho_id": kho_id, "lines": [{
        "hang_loai": ln.hang_loai, "hang_id": ln.hang_id, "kho_rong": ln.kho_rong, "kho_dai": ln.kho_dai,
        "dvt": ln.dvt, "sl_de_nghi": float(ln.sl_de_nghi), "don_gia": 1000}]})
    assert r.status_code == 201, r.text
    nhap = r.json()
    r = client.post("/api/kho/phieu", headers=h, json={
        "request_id": nhap["id"], "kho_id": kho_id,
        "lines": [{"request_line_id": nhap["lines"][0]["id"], "so_luong": float(ln.sl_de_nghi)}]})
    assert r.status_code == 201, r.text
    assert client.post(f"/api/kho/phieu/{r.json()['id']}/ghi-so", headers=h).status_code == 200
    return kho_id


def test_lap_va_ghi_so_phieu_xuat_bao_ban_to(client, db, svc3, lenh, admin, monkeypatch):
    from app.services.san_xuat import kho as kho_sx

    cv = _phat_hanh(db, svc3, lenh, admin)
    req = _req(db, cv)
    h = _admin_h(client)
    kho_id = _nhap_ton(client, h, req)
    gui: list[tuple[dict, dict]] = []
    monkeypatch.setattr(kho_sx.hub, "gui", lambda ev, **kw: gui.append((ev, kw)))

    def _toi_to():
        return [ev for ev, kw in gui if ev["type"] == "san_xuat_cong_viec_changed"
                and kw.get("to") == [cv.department_id] and ev.get("request_id") == req.id]

    ln = req.lines[0]
    alloc = client.get("/api/kho/phieu/lo/goi-y", headers=h, params={
        "hang_loai": ln.hang_loai, "hang_id": ln.hang_id, "kho_id": kho_id,
        "so_luong": float(ln.sl_de_nghi)}).json()
    r = client.post("/api/kho/phieu", headers=h, json={
        "request_id": req.id, "kho_id": kho_id,
        "lines": [{"request_line_id": ln.id, "so_luong": x["so_luong"], "lot_id": x["lot_id"]}
                  for x in alloc["lines"]]})
    assert r.status_code == 201, r.text
    assert len(_toi_to()) == 1, "lập phiếu (kho đang soạn) phải báo bàn tổ"

    assert client.post(f"/api/kho/phieu/{r.json()['id']}/ghi-so", headers=h).status_code == 200
    assert len(_toi_to()) == 2, "ghi sổ (sẵn sàng) phải báo bàn tổ"


def test_kho_huy_yeu_cau_tu_lap_bao_ve_to_khong_bao_nguoi_phat_hanh(db, svc3, lenh, admin, monkeypatch):
    from app.models.module_notification import ModuleNotification
    from app.models.notification import Notification
    from app.services import stock_request_service as srs
    from app.services.san_xuat import vat_tu_de_nghi as V
    from app.services.thong_bao_man import kenh_to

    cv = _phat_hanh(db, svc3, lenh, admin)
    req = _req(db, cv)
    assert req.nguoi_tao_id == admin.id      # người bấm phát hành đứng tên yêu cầu tự lập
    gui_rieng: list[tuple[int, dict]] = []
    monkeypatch.setattr(srs.hub, "publish", lambda uid, ev: gui_rieng.append((uid, ev)))
    truoc = db.query(Notification).filter(Notification.user_id == admin.id).count()

    V._req_service(db, V._hang_service(db)).cancel_by_kho(req, "Hết hàng")
    # Route huỷ của kho không commit gì thêm sau service: chuông tổ phải tự commit, không thì đóng
    # session là mất.
    db.rollback()

    assert db.query(Notification).filter(Notification.user_id == admin.id).count() == truoc
    # Toast đích danh "Yêu cầu đã bị hủy" không tới người phát hành (tin danh sách kho thì vẫn tới,
    # vì admin cũng là người của kho).
    assert not [ev for uid, ev in gui_rieng if uid == admin.id and ev["type"] == "stock_request"]
    assert db.query(ModuleNotification).filter(
        ModuleNotification.channel == "kho", ModuleNotification.recipient_user_id == admin.id).count() == 0
    to = db.query(ModuleNotification).filter(ModuleNotification.channel == kenh_to(cv.department_id)).all()
    assert [(n.event_type, n.source_code) for n in to] == [("kho_phan_hoi", req.ma)]


def test_yeu_cau_tu_lap_khong_tinh_vao_badge_phan_hoi_cua_nguoi_phat_hanh(db, svc3, lenh, admin):
    from app.repositories.stock_request_repo import StockRequestRepository
    from app.services.san_xuat import vat_tu_de_nghi as V

    cv = _phat_hanh(db, svc3, lenh, admin)
    req = _req(db, cv)
    repo = StockRequestRepository(db)
    truoc = repo.unseen_response_counts(admin.id)

    V._req_service(db, V._hang_service(db)).cancel_by_kho(req, "Hết hàng")

    assert repo.unseen_response_counts(admin.id) == truoc


def test_ngan_chi_tiet_danh_dau_lan_tu_lap(db, svc3, lenh, admin):
    from app.repositories.rbac_repo import RoleRepository
    from app.services.rbac_service import AuthorizationService
    from app.services.san_xuat import board

    cv = _phat_hanh(db, svc3, lenh, admin)
    _cap_quyen_to_cua(db, admin, cv)
    ct = board.chi_tiet_cong_viec(db, admin, AuthorizationService(RoleRepository(db)), cong_viec_id=cv.id)
    (lan,) = ct["vat_tu_cap"]["cac_de_nghi"]
    assert lan["tu_lap"] is True
