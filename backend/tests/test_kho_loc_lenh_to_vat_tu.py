"""Kho lọc yêu cầu theo lệnh, tổ, vật tư (spec 2026-10-18 §7).

Yêu cầu dựng qua API `/api/kho/de-nghi` (dòng mang `lsx_id` / `bai_ghep_id` như bàn tổ gửi), riêng
yêu cầu tự lập lấy từ luồng phát hành thật (fixture `lenh` của Xếp lịch 3).
"""
from __future__ import annotations

from datetime import datetime

from app.models.bai_ghep import BaiGhep, BaiGhepThanhVien
from app.models.department import Department
from app.models.san_xuat_vat_tu import SanXuatVatTuDeNghi
from app.models.stock_request import StockRequest
from tests.test_kho_de_nghi import _mk_material
from tests.test_trang_thai_vat_tu import _buoc_in_cv
from tests.test_xep_lich_lenh_service import (  # noqa: F401
    _hai_lsx_san_sang, _khai_giay_len_buoc_in, admin, customer, db, hai_lenh, lenh, lsx_svc,
    orders, svc3,
)

_MOC = datetime(2026, 9, 11, 8, 0)
URL = "/api/kho/de-nghi"


def _h(client) -> dict[str, str]:
    tok = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"}).json()
    return {"Authorization": f"Bearer {tok['access_token']}"}


def _kho(client, h) -> int:
    r = client.post("/api/kho", json={"ten": "Kho NVL lọc"}, headers=h)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _yc(client, h, kho_id, hang, **dong) -> int:
    r = client.post(URL, headers=h, json={"loai": "XUAT", "kho_id": kho_id, "lines": [
        {"hang_loai": hang[0], "hang_id": hang[1], "dvt": "to", "sl_de_nghi": 5, **dong}]})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _ids(client, h, **params) -> set[int]:
    r = client.get(URL, headers=h, params=params)
    assert r.status_code == 200, r.text
    return {it["id"] for it in r.json()["items"]}


def test_loc_theo_lenh_gom_ca_bai_ghep_chua_lenh(client, db, hai_lenh):
    a, b = hai_lenh
    bg = BaiGhep(ma="GB26-LOC1")
    db.add(bg)
    db.flush()
    db.add(BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=a.id))
    db.commit()
    h = _h(client)
    kho = _kho(client, h)
    m = _mk_material("LOC-L1")
    theo_lenh = _yc(client, h, kho, m, lsx_id=a.id)
    theo_bai = _yc(client, h, kho, m, bai_ghep_id=bg.id)
    lenh_khac = _yc(client, h, kho, m, lsx_id=b.id)

    assert _ids(client, h, lenh=a.id) == {theo_lenh, theo_bai}
    assert _ids(client, h, lenh=b.id) == {lenh_khac}

    r = client.get(f"{URL}/loc-lenh", headers=h)
    assert r.status_code == 200, r.text
    dem = {d["id"]: d["so"] for d in r.json()}
    assert dem[a.id] == 2 and dem[b.id] == 1
    assert {d["ten"] for d in r.json()} >= {a.ma, b.ma}


def test_loc_theo_to_khop_qua_cong_viec_khi_nguoi_bam_khac_phong(client, db, svc3, lenh, admin):
    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    cv = _buoc_in_cv(db, lenh.id)
    dn = db.query(SanXuatVatTuDeNghi).filter_by(cong_viec_id=cv.id).one()
    req = db.get(StockRequest, dn.stock_request_id)
    db.get(Department, cv.department_id).la_san_xuat = True
    # Người bấm thuộc phòng khác: yêu cầu đứng tên phòng đó, nhưng việc vẫn của tổ.
    khac = Department(name="Phòng Kế hoạch lọc", code="KH-LOC")
    db.add(khac)
    db.flush()
    req.bo_phan_id = khac.id
    db.commit()
    h = _h(client)

    assert req.id in _ids(client, h, to=cv.department_id)
    # "Phòng ban yêu cầu" giữ nghĩa cũ: đúng phòng đứng tên yêu cầu.
    assert req.id in _ids(client, h, bo_phan=khac.id)
    assert req.id not in _ids(client, h, bo_phan=cv.department_id)

    r = client.get(f"{URL}/loc-to", headers=h)
    assert r.status_code == 200, r.text
    dem = {d["id"]: d["so"] for d in r.json()}
    assert dem.get(cv.department_id) == 1
    assert khac.id not in dem, "danh sách Tổ chỉ liệt kê tổ sản xuất"

    r = client.get(f"{URL}/loc-bo-phan", headers=h)
    dem = {d["id"]: d["so"] for d in r.json()}
    assert dem.get(khac.id) == 1 and cv.department_id not in dem


def test_loc_theo_vat_tu_nhieu_ma(client, db):
    h = _h(client)
    kho = _kho(client, h)
    m1, m2, m3 = (_mk_material(c) for c in ("LOC-V1", "LOC-V2", "LOC-V3"))
    y1, y2 = _yc(client, h, kho, m1), _yc(client, h, kho, m2)
    _yc(client, h, kho, m3)

    assert _ids(client, h, vat_tu=[f"{m1[0]}:{m1[1]}", f"{m2[0]}:{m2[1]}"]) == {y1, y2}
    # Khoá hỏng bị bỏ qua, không nổ 500.
    assert _ids(client, h, vat_tu=[f"{m1[0]}:{m1[1]}", "rac"]) == {y1}

    r = client.get(f"{URL}/loc-vat-tu", headers=h)
    assert r.status_code == 200, r.text
    dem = {d["id"]: d for d in r.json()}
    assert dem[f"{m1[0]}:{m1[1]}"]["so"] == 1
    assert dem[f"{m1[0]}:{m1[1]}"]["ten"] == "Vật tư LOC-V1"


def test_counts_by_status_ton_trong_bo_loc_moi(client, db, hai_lenh):
    a, b = hai_lenh
    h = _h(client)
    kho = _kho(client, h)
    m1, m2 = _mk_material("LOC-C1"), _mk_material("LOC-C2")
    _yc(client, h, kho, m1, lsx_id=a.id)
    _yc(client, h, kho, m2, lsx_id=a.id)
    _yc(client, h, kho, m1, lsx_id=b.id)

    def dem(**p) -> int:
        r = client.get(f"{URL}/counts-by-status", headers=h, params=p)
        assert r.status_code == 200, r.text
        return sum(r.json().values())

    assert dem(lenh=a.id) == 2
    assert dem(lenh=a.id, vat_tu=[f"{m1[0]}:{m1[1]}"]) == 1
    assert dem(vat_tu=[f"{m1[0]}:{m1[1]}"]) == 2


def test_danh_sach_kho_danh_dau_yeu_cau_tu_lap(client, db, svc3, lenh, admin):
    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    cv = _buoc_in_cv(db, lenh.id)
    rid = db.query(SanXuatVatTuDeNghi).filter_by(cong_viec_id=cv.id).one().stock_request_id
    h = _h(client)
    kho = _kho(client, h)
    tay = _yc(client, h, kho, _mk_material("LOC-T1"))

    items = {it["id"]: it for it in client.get(URL, headers=h).json()["items"]}
    assert items[rid]["san_xuat_tu_lap"] is True
    assert items[tay]["san_xuat_tu_lap"] is False
    assert client.get(f"{URL}/{rid}", headers=h).json()["san_xuat_tu_lap"] is True
