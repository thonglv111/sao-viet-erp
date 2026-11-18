"""Nhập / xuất Excel dòng hàng ở trang Tạo đơn thương mại — chỉ In Hà Phương (16/11/2026)."""
from __future__ import annotations

from io import BytesIO

import pytest
from openpyxl import Workbook, load_workbook

from app.config import settings
from tests.test_don_thuong_mai import _admin, _hang


@pytest.fixture
def bat_tm(monkeypatch):
    monkeypatch.setattr(settings, "phan_he_bat", "thuong_mai")


def _file(*dong) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(["Mã hàng", "Tên hàng", "Đơn vị", "Số lượng", "VAT %"])
    for d in dong:
        ws.append(list(d))
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def _nhap(client, h, du_lieu: bytes):
    return client.post("/api/thuong-mai/dong/nhap-excel", headers=h,
                       files={"file": ("dong.xlsx", du_lieu, "application/octet-stream")})


def _ten_dv(client, h, ma: str) -> str:
    return next(d["ten"] for d in client.get("/api/don-vi?size=200", headers=h).json()["items"] if d["ma"] == ma)


def test_xuat_roi_nhap_lai_ra_dung_dong(client, bat_tm):
    h = _admin(client)
    hid, dv = _hang(client, h, "TM-EX1", gia=15000)
    r = client.post("/api/thuong-mai/dong/xuat-excel", headers=h,
                    json={"lines": [{"hang_id": hid, "dvt": dv, "qty": 3, "vat_pct": 8}]})
    assert r.status_code == 200, r.text
    wb = load_workbook(BytesIO(r.content))
    rows = list(wb["Mặt hàng"].iter_rows(values_only=True))
    # Không có cột đơn giá; đơn vị in TÊN; Tên hàng là công thức tra trang Danh mục hàng.
    assert rows[0] == ("Mã hàng", "Tên hàng", "Đơn vị", "Số lượng", "VAT %", "CK %")
    assert rows[1][0] == "TM-EX1" and rows[1][2] == _ten_dv(client, h, dv) and rows[1][3] == 3 and rows[1][4] == 8
    assert rows[1][1].startswith("=IF(A2")
    dm = list(wb["Danh mục hàng"].iter_rows(values_only=True))
    assert any(d[0] == "TM-EX1" for d in dm[1:])
    assert 15000 not in [c for d in dm for c in d]

    r = _nhap(client, h, r.content)
    assert r.status_code == 200, r.text
    d = r.json()
    assert [{k: x[k] for k in ("hang_id", "dvt", "qty", "vat_pct")} for x in d] == [
        {"hang_id": hid, "dvt": dv, "qty": 3, "vat_pct": 8}]
    assert "don_gia" not in d[0]
    assert d[0]["hang"]["ma"] == "TM-EX1" and d[0]["hang"]["gia_ban_theo_dvt"] == {dv: 15000}


def test_file_mau_khong_co_dong_hang_va_nhap_lai_bao_trong(client, bat_tm):
    h = _admin(client)
    r = client.post("/api/thuong-mai/dong/xuat-excel", headers=h, json={"lines": []})
    assert r.status_code == 200
    rows = list(load_workbook(BytesIO(r.content)).active.iter_rows(values_only=True))
    # Dòng kẻ sẵn chỉ có công thức Tên hàng, chưa có mã hay số lượng.
    assert all(x[0] is None and x[3] is None for x in rows[1:])
    r = _nhap(client, h, r.content)
    assert r.status_code == 400 and "chưa có mặt hàng" in r.json()["detail"]


def test_ma_thuong_viet_tat_don_vi_va_gia_trong(client, bat_tm):
    h = _admin(client)
    hid, dv = _hang(client, h, "TM-EX2", gia=9000)
    # Mã gõ chữ thường, bỏ trống đơn vị (lấy ĐVT chính); dòng chỉ có VAT kéo sẵn bị bỏ qua.
    r = _nhap(client, h, _file(("tm-ex2", None, None, 4, None), (None, "", None, None, 8)))
    assert r.status_code == 200, r.text
    assert [{k: x[k] for k in ("hang_id", "dvt", "qty", "vat_pct")} for x in r.json()] == [
        {"hang_id": hid, "dvt": dv, "qty": 4, "vat_pct": 0}]


def test_dong_loi_thi_khong_tra_dong_nao_va_ke_du_loi(client, bat_tm):
    h = _admin(client)
    _hang(client, h, "TM-EX3", gia=5000)
    r = _nhap(client, h, _file(
        ("TM-EX3", None, None, 2, 0),
        ("KHONG-CO", None, None, 1, 0),
        ("TM-EX3", None, None, 1.5, 0),
        ("TM-EX3", None, "thùng-lạ", 1, 0),
    ))
    assert r.status_code == 400
    loi = r.json()["detail"]
    assert "Dòng 3" in loi and "KHONG-CO" in loi
    assert "Dòng 4" in loi and "số nguyên" in loi
    assert "Dòng 5" in loi and "thùng-lạ" in loi
    assert "Dòng 2" not in loi


def test_file_sai_cot_va_file_hong(client, bat_tm):
    h = _admin(client)
    wb = Workbook()
    wb.active.append(["Tên", "SL"])
    out = BytesIO()
    wb.save(out)
    r = _nhap(client, h, out.getvalue())
    assert r.status_code == 400 and "Mã hàng" in r.json()["detail"]
    r = _nhap(client, h, b"khong phai excel")
    assert r.status_code == 400 and "Không đọc được file" in r.json()["detail"]


def test_ban_cai_tat_thuong_mai_thi_khong_co_duong(client, monkeypatch):
    monkeypatch.setattr(settings, "phan_he_bat", "")
    h = _admin(client)
    assert client.post("/api/thuong-mai/dong/xuat-excel", headers=h, json={"lines": []}).status_code == 404


def test_khong_xem_gia_hang_thuong_mai_thi_dong_nhap_khong_co_gia_khai(client, bat_tm, monkeypatch):
    from app.services.rbac_service import AuthorizationService

    h = _admin(client)
    _hang(client, h, "TM-EX4", gia=7000)
    goc = AuthorizationService.can
    monkeypatch.setattr(AuthorizationService, "can", lambda self, user, mod, act: (
        False if (mod, act) == ("hang_thuong_mai", "view_cost") else goc(self, user, mod, act)))
    r = _nhap(client, h, _file(("TM-EX4", None, None, 2, 0)))
    assert r.status_code == 200, r.text
    assert r.json()[0]["hang"]["gia_ban_theo_dvt"] is None


def test_cot_ck_xuat_ra_va_nhap_lai(client, bat_tm):
    """CK % (18/11/2026): xuất ra đúng số đang có trên trang, nhập vào đọc được số lẻ «2,5»; trống là 0."""
    h = _admin(client)
    hid, dv = _hang(client, h, "TM-CK1", gia=10000)
    r = client.post("/api/thuong-mai/dong/xuat-excel", headers=h,
                    json={"lines": [{"hang_id": hid, "dvt": dv, "qty": 2, "vat_pct": 8, "ck_pct": 5}]})
    rows = list(load_workbook(BytesIO(r.content))["Mặt hàng"].iter_rows(values_only=True))
    assert rows[1][5] == 5
    assert _nhap(client, h, r.content).json()[0]["ck_pct"] == 5

    wb = Workbook()
    ws = wb.active
    ws.append(["Mã hàng", "Tên hàng", "Đơn vị", "Số lượng", "VAT %", "CK %"])
    ws.append(["TM-CK1", None, None, 3, 0, "2,5"])
    ws.append(["TM-CK1", None, None, 1, 0, None])
    out = BytesIO()
    wb.save(out)
    d = _nhap(client, h, out.getvalue()).json()
    assert [x["ck_pct"] for x in d] == [2.5, 0]

    ws.append(["TM-CK1", None, None, 1, 0, 120])
    out = BytesIO()
    wb.save(out)
    r = _nhap(client, h, out.getvalue())
    assert r.status_code == 400 and "Dòng 4" in r.json()["detail"] and "CK %" in r.json()["detail"]
