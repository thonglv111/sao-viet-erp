"""Quy đổi tờ ↔ kg của giấy (spec 2026-10-24-chuan-bi-giay §5).

`kg = số tờ × rộng/1000 × dài/1000 × gsm/1000`, gsm của danh mục giấy. Giấy có ĐỦ hai cạnh khổ là
giấy tờ: số tờ là gốc, nhập theo kg thì quy ra tờ (làm tròn xuống). Cuộn — khổ (rộng, 0) — vẫn đếm kg.
"""
from __future__ import annotations

import math

import pytest

from app.services.kho_giay import kg_tu_to, la_kho_to, to_tu_kg
from tests.test_kho_de_nghi import _login, _setup
from tests.test_kho_lo_giay import _de_nghi, _don_vi, _dong, _giay, _lo, _nhap

GSM = 300          # `_giay()` của test_kho_lo_giay khai 300 gsm
KG_MOT_TO = 0.65 * 0.86 * GSM / 1000


def test_kg_tu_to_duplex_350():
    assert kg_tu_to(1530, 650, 860, 350) == pytest.approx(299.35, abs=0.01)


def test_to_tu_kg_lam_tron_xuong():
    assert to_tu_kg(299.35, 650, 860, 350) == math.floor(299.35 / (0.65 * 0.86 * 0.35))
    assert to_tu_kg(299.35, 860, 650, 350) == to_tu_kg(299.35, 650, 860, 350)   # cạnh ghi ngược


@pytest.mark.parametrize("kr, kd, gsm", [(0, 860, 350), (650, 0, 350), (650, 860, 0)])
def test_to_tu_kg_thieu_kho_hoac_gsm_bao_loi(kr, kd, gsm):
    with pytest.raises(ValueError):
        to_tu_kg(10, kr, kd, gsm)


def test_la_kho_to():
    assert la_kho_to(650, 860) and not la_kho_to(860, 0) and not la_kho_to(0, 0)


def test_nhap_giay_to_tinh_kg_luu_lo_to(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    _nhap(client, kho_id, _dong(g, dvt="kg", sl=500, kr=650, kd=860, gia=20_000))
    (lo,) = _lo(g)
    so_to = math.floor(500 / KG_MOT_TO)
    assert (lo.don_vi_goc, lo.kho_rong, lo.kho_dai) == ("to", 650, 860)
    assert float(lo.sl_ban_dau) == so_to
    assert int(lo.don_gia_nhap) == round(500 * 20_000 / so_to)    # tiền dòng chia đều cho số tờ


def test_nhap_cuon_kg_giu_kg(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    _nhap(client, kho_id, _dong(g, dvt="kg", sl=300, kr=860, gia=20_000))
    (lo,) = _lo(g)
    assert (lo.don_vi_goc, lo.kho_rong, lo.kho_dai, float(lo.sl_ban_dau)) == ("kg", 860, 0, 300.0)


def test_nhap_kg_qua_nho_ra_0_to_bi_chan(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    r = _de_nghi(client, kho_id, "NHAP", [_dong(g, dvt="kg", sl=0.01, kr=650, kd=860)])
    assert r.status_code == 400, r.text
    assert "0,01 kg khổ 650×860 quy ra 0 tờ" in r.json()["detail"]   # dấu phẩy thập phân kiểu Việt


def test_kg_va_ram_cung_kho_la_mot_mon(client):
    """Cùng khổ hai cạnh, dòng kg và dòng ram nay cùng gốc tờ ⇒ là MỘT món, phải gộp."""
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    r = _de_nghi(client, kho_id, "NHAP", [
        _dong(g, dvt="ram", sl=1, kr=780, kd=905),
        _dong(g, dvt="kg", sl=50, kr=780, kd=905),
    ])
    assert r.status_code == 400, r.text
    assert "1 dòng" in r.json()["detail"]


def test_phan_hoi_dong_kg_kho_hai_canh_quy_ra_to(client):
    """Màn đề nghị hiện "500 kg ≈ N tờ" — cùng số với lúc ghi sổ, không bật cảnh báo đơn vị."""
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    r = _de_nghi(client, kho_id, "NHAP", [_dong(g, dvt="kg", sl=500, kr=650, kd=860)])
    assert r.status_code == 201, r.text
    ln = r.json()["lines"][0]
    assert ln["don_vi_goc"] == "to" and ln["canh_bao_dv"] is None
    assert ln["sl_quy_doi"] == math.floor(500 / KG_MOT_TO)


def test_phan_hoi_dong_kg_kho_hai_canh_tra_kg_moi_dvt_va_gsm(client):
    """Phiếu nhập gõ số khác số đề nghị (hoặc sửa khổ thực nhận) ⇒ FE tự tính lại số tờ làm tròn
    xuống, nên cần kg của MỘT ĐVT và gsm — nhân hệ số đã làm tròn (N tờ / 500 kg) là lệch tờ."""
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    r = _de_nghi(client, kho_id, "NHAP", [_dong(g, dvt="kg", sl=500, kr=650, kd=860)])
    assert r.status_code == 201, r.text
    ln = r.json()["lines"][0]
    assert (ln["kg_moi_dvt"], ln["gsm"]) == (1.0, GSM)


def test_phan_hoi_dong_cuon_khong_tra_kg_moi_dvt(client):
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    r = _de_nghi(client, kho_id, "NHAP", [_dong(g, dvt="kg", sl=300, kr=860)])
    assert r.status_code == 201, r.text
    ln = r.json()["lines"][0]
    assert (ln["kg_moi_dvt"], ln["gsm"]) == (None, None)


def test_de_nghi_xuat_kg_kho_hai_canh_quy_ra_to_va_tru_lo_to(client):
    """Lô giấy khổ hai cạnh luôn lưu tờ ⇒ đề nghị XUẤT kg khổ hai cạnh giữ kg thì không bao giờ khớp
    lô nào (kho báo "còn 0 kg" dù có hàng nghìn tờ). Quy ra tờ như lúc nhập, phiếu trừ lô tờ."""
    kho_id, _ = _setup(client)
    _don_vi()
    g = _giay()
    _nhap(client, kho_id, _dong(g, dvt="kg", sl=500, kr=650, kd=860, gia=20_000))
    (lo,) = _lo(g)
    r = _de_nghi(client, kho_id, "XUAT", [_dong(g, dvt="kg", sl=40, kr=650, kd=860)])
    assert r.status_code == 201, r.text
    req = r.json()
    so_to = math.floor(40 / KG_MOT_TO)
    assert (req["lines"][0]["don_vi_goc"], req["lines"][0]["sl_quy_doi"]) == ("to", so_to)
    r = client.post("/api/kho/phieu", headers=_login(client, "t_thukho"), json={
        "request_id": req["id"], "kho_id": kho_id,
        "lines": [{"request_line_id": req["lines"][0]["id"], "so_luong": 40, "lot_id": lo.id}]})
    assert r.status_code == 201, r.text
    assert r.json()["lines"][0]["sl_goc"] == so_to
