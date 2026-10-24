"""Đợt 2 — cấu hình Khoán của công đoạn: giá cố định chung, tuỳ chọn khi ghi, chip mới (21/10/2026).

Spec: `docs/superpowers/specs/2026-10-20-hai-luong-khoi-san-xuat-design.md` mục "Đợt 2"."""
from __future__ import annotations

from itertools import count

from app.models.cong_doan import CongDoanKhoan
from app.services.bien_cong_thuc import ma_hop_le
from app.services.san_xuat import viec_khoan

_dem = count(1)
CT_BE = "(1 - trung_khuon) * gia_co_dinh + sl_ghi * don_gia_khoan"


def _h(client) -> dict:
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _body(**khoan) -> dict:
    i = next(_dem)
    return {"ma": f"CD-D2-{i}", "ten": f"Bế thử {i}", "nhom": "print",
            "che_do_tinh": "theo_san_luong", "pricing_basis": "per_other",
            "khoan": {"unit": "to", "unit_price": 120, "cong_thuc_khoan": CT_BE,
                      "viec_phat_sinh": [], **khoan}}


TRUNG_KHUON = {"ma": "trung_khuon", "ten": "Trùng khuôn", "kieu": "co_khong"}


def test_luu_gia_co_dinh_chung_va_tuy_chon(client):
    h = _h(client)
    r = client.post("/api/cong-doan", json=_body(gia_co_dinh=150_000, tuy_chon=[TRUNG_KHUON]),
                    headers=h)
    assert r.status_code == 201, r.text
    k = r.json()["khoan"]
    assert k["gia_co_dinh"] == 150_000
    assert k["tuy_chon"] == [{**TRUNG_KHUON, "goi_y": None}]
    r = client.get(f"/api/cong-doan/{r.json()['id']}", headers=h)
    assert r.json()["khoan"]["tuy_chon"][0]["ma"] == "trung_khuon"


def test_viec_phat_sinh_luu_cach_tinh_gia_va_kiem_cong_thuc(client):
    """Cột "Cách tính giá" của việc phát sinh (24/10/2026): công thức chip ô khoán; có công thức
    thì bỏ trống đơn giá được (lưu 0); công thức sai chặn kèm tên việc."""
    h = _h(client)
    xb = {"ten": "Xuống bài", "don_gia": None, "don_vi": "to", "cong_thuc": " 0.5 * gia_co_dinh "}
    r = client.post("/api/cong-doan", json=_body(tuy_chon=[TRUNG_KHUON], viec_phat_sinh=[xb]), headers=h)
    assert r.status_code == 201, r.text
    ps = r.json()["khoan"]["viec_phat_sinh"][0]
    assert ps["cong_thuc"] == "0.5 * gia_co_dinh" and ps["don_gia"] == 0
    r = client.post("/api/cong-doan", json=_body(tuy_chon=[TRUNG_KHUON], viec_phat_sinh=[{**xb, "cong_thuc": "0.5 * gia_bai"}]),
                    headers=h)
    assert r.status_code == 422 and "Xuống bài" in r.text, r.text
    r = client.post("/api/cong-doan", json=_body(tuy_chon=[TRUNG_KHUON], viec_phat_sinh=[{**xb, "cong_thuc": ""}]), headers=h)
    assert r.status_code == 422 and "đơn giá" in r.text, r.text


def test_cong_thuc_goi_tuy_chon_chua_khai_bao_loi(client):
    r = client.post("/api/cong-doan", json=_body(tuy_chon=[]), headers=_h(client))
    assert r.status_code == 422 and "trung_khuon" in r.text, r.text


def test_tuy_chon_trung_chip_he_thong_bi_chan(client):
    h = _h(client)
    for tc in ([{"ma": "sl_ghi", "ten": "SL"}], [{"ma": "max", "ten": "Lớn nhất"}],
               [TRUNG_KHUON, {**TRUNG_KHUON, "ten": "Trùng khuôn 2"}]):
        r = client.post("/api/cong-doan", json=_body(cong_thuc_khoan="sl_ghi * don_gia_khoan",
                                                     tuy_chon=tc), headers=h)
        assert r.status_code == 422 and "trùng" in r.text, (tc, r.text)
    r = client.post("/api/cong-doan", json=_body(cong_thuc_khoan="sl_ghi * don_gia_khoan",
                                                 tuy_chon=[{"ma": "xa_doi", "ten": "  "}]), headers=h)
    assert r.status_code == 422, r.text


def test_chip_sl_tot_da_go(client):
    h = _h(client)
    assert "sl_tot" not in ma_hop_le("khoan")
    r = client.post("/api/cong-doan", json=_body(cong_thuc_khoan="sl_tot * don_gia_khoan"), headers=h)
    assert r.status_code == 422 and "sl_tot" in r.text, r.text
    r = client.post("/api/cong-doan", json=_body(
        cong_thuc_khoan="gia_co_dinh / so_lan_chay + tien_gio + sl_ghi * (1 + tu_tro) * don_gia_khoan"),
        headers=h)
    assert r.status_code == 201, r.text


def test_gia_cua_to_bang_rong_lay_gia_co_dinh_chung():
    k = CongDoanKhoan(unit="to", unit_price=180, gia_co_dinh=150_000, gia_theo_to=None)
    assert viec_khoan.gia_cua_to(k, 7) == (150_000.0, 180.0)
    k.gia_theo_to = [{"department_id": 7, "gia_co_dinh": 1, "don_gia": 2}]
    assert viec_khoan.gia_cua_to(k, 7) == (1.0, 2.0)
    assert viec_khoan.gia_cua_to(k, 8) == (None, None)
