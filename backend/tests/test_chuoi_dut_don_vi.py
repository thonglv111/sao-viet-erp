"""Lỗi #8 (bấm thử E2E 18/10/2026): chuỗi công đoạn ĐỨT ĐƠN VỊ không được ra giá.

In → Cán → Bế (tờ in → con) → Cắt thành phẩm (tờ in → con): bước Cắt nhận tờ in trong khi bước
trước nhả ra con. Engine cũ chỉ ghi một dòng `warnings` (màn không còn bày), chia cho số con hai
lần, "Bù hao công đoạn" ra −837 tờ và giá vốn thấp hơn thật — lưu phiếu vẫn được, không ai biết.
Nay: engine trả LỖI đích danh bước (`loi_chuoi` của thành phần + `loi` của phiếu), máy chủ từ chối
lưu phiếu mang lỗi đó (422). Phiếu cũ đã lưu thì vẫn mở được — GET không tính lại.
"""
from __future__ import annotations

import pytest

from app.db import SessionLocal
from app.models.cong_doan import CongDoan
from app.models.phieu_tinh_gia import PhieuTinhGia
from app.models.vat_lieu_kho import GiayNguyen
from app.services.bu_hao_engine import kiem_chuoi_don_vi
from app.services.thanh_phan_engine import compute_phieu


def _cd(ten: str, nhom: str, vao: str, ra: str, **k) -> dict:
    return {"ten": ten, "cong_doan": {"ten": ten, "nhom": nhom, "don_vi_vao": vao, "don_vi_ra": ra, **k}}


def _tp(chuoi: list[dict]) -> dict:
    return {
        "ten": "Hộp", "so_to_per_sp": 1, "quy_cach_in": "mot_mat", "con_auto": False, "so_con": 4,
        "dai_thanh_pham": 200, "rong_thanh_pham": 150,
        "kho_in_dai": 650, "kho_in_rong": 430,
        "kho_dai": 860, "kho_rong": 650, "gsm": 120, "giay_ten": "Couche 120",
        "don_gia_giay": 2000, "don_gia_don_vi": "to", "nguon_giay": "cong_ty",
        "che_ban_don_gia": 100000, "don_gia_cong_in": 100,
        "so_mau_a": 4, "co_in": True,
        "thanh_phams": chuoi,
    }


CHUOI_DUT = [
    _cd("In offset", "print", "to", "to", kieu_bu_hao="co_dinh", so_to_bu_hao=100),
    _cd("Cán màng", "finishing", "to", "to"),
    _cd("E2E Be thu", "finishing", "to", "con", kieu_bu_hao="co_dinh", so_to_bu_hao=50),
    _cd("Cắt thành phẩm", "finishing", "to", "con"),
]

CHUOI_LIEN = [
    _cd("In offset", "print", "to", "to", kieu_bu_hao="co_dinh", so_to_bu_hao=100),
    _cd("Cán màng", "finishing", "to", "to"),
    _cd("E2E Be thu", "finishing", "to", "con", kieu_bu_hao="co_dinh", so_to_bu_hao=50),
]


def test_kiem_chuoi_don_vi_chi_ra_buoc_dut():
    buoc = [{"ten": "Bế", "dv_vao": "to", "dv_ra": "con"},
            {"ten": "Cắt thành phẩm", "dv_vao": "to", "dv_ra": "con"}]
    loi = kiem_chuoi_don_vi(buoc)
    assert len(loi) == 1
    assert "Cắt thành phẩm" in loi[0] and "Bế" in loi[0]
    assert kiem_chuoi_don_vi(buoc[:1]) == []


def test_chuoi_dut_don_vi_khong_ra_gia():
    res = compute_phieu(so_luong=5000, thanh_phans=[_tp(CHUOI_DUT)])
    m = res["meta"]["components"][0]
    assert m["loi_chuoi"], "chuỗi đứt phải sinh lỗi ở thành phần"
    assert any("Cắt thành phẩm" in s for s in m["loi_chuoi"])
    assert res["loi"] and any("Cắt thành phẩm" in s for s in res["loi"])
    # Lỗi đã nói ở `loi` thì `warnings` không lặp lại cùng câu.
    assert not [w for w in res["warnings"] if "đứt đơn vị" in w]


def test_bu_hao_khong_bao_gio_am():
    """Chuỗi liền mạch: bù hao công đoạn là số không âm, không có lỗi chuỗi."""
    res = compute_phieu(so_luong=5000, thanh_phans=[_tp(CHUOI_LIEN)])
    m = res["meta"]["components"][0]
    assert m["loi_chuoi"] == []
    assert res["loi"] == []
    assert m["bu_hao_auto"] >= 0


# ---------------------------------------------------------------- API: chặn lưu

@pytest.fixture
def auth_headers(client, seed_credentials) -> dict[str, str]:
    resp = client.post("/api/auth/login", json=seed_credentials)
    assert resp.status_code == 200
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _seed() -> dict:
    db = SessionLocal()
    try:
        giay = GiayNguyen(don_vi_them=["to"], ma="G-DUT", ten="Couche 120 dut", gsm=120,
                          kho_dai=860, kho_rong=650, don_vi_gia="to", don_gia=2000)
        db.add(giay)
        ids = {"giay": giay}
        for ma, ten, nhom, vao, ra in [
            ("CD-IN", "In offset", "print", "to", "to"),
            ("CD-BE", "E2E Be thu", "finishing", "to", "con"),
            ("CD-CAT", "Cắt thành phẩm", "finishing", "to", "con"),
        ]:
            cd = CongDoan(ma=ma, ten=ten, nhom=nhom, che_do_tinh="theo_san_luong",
                          pricing_basis="per_sheet", run_rate=0, setup_cost=0, kieu_bu_hao="khong",
                          don_vi_vao=vao, don_vi_ra=ra)
            db.add(cd)
            ids[ma] = cd
        db.flush()
        out = {k: v.id for k, v in ids.items()}
        db.commit()
        return out
    finally:
        db.close()


def _body(ids: dict, dut: bool) -> dict:
    chuoi = [{"ten": "In offset", "cong_doan_id": ids["CD-IN"]},
             {"ten": "E2E Be thu", "cong_doan_id": ids["CD-BE"]}]
    if dut:
        chuoi.append({"ten": "Cắt thành phẩm", "cong_doan_id": ids["CD-CAT"]})
    return {"ten_san_pham": "Hộp E2E", "so_luong": 5000, "thanh_phans": [{
        "ten": "Hộp", "giay_id": ids["giay"], "so_con": 4, "quy_cach_in": "mot_mat",
        "so_mau_a": 4, "che_ban_don_gia": 90000, "don_gia_cong_in": 120,
        "thanh_phams": chuoi,
    }]}


def test_luu_phieu_chuoi_dut_bi_chan(client, auth_headers):
    ids = _seed()
    truoc = client.get("/api/phieu-tinh-gia", headers=auth_headers).json()["total"]
    r = client.post("/api/phieu-tinh-gia", json=_body(ids, dut=True), headers=auth_headers)
    assert r.status_code == 422, r.text
    assert "Cắt thành phẩm" in r.json()["detail"]
    assert client.get("/api/phieu-tinh-gia", headers=auth_headers).json()["total"] == truoc

    ok = client.post("/api/phieu-tinh-gia", json=_body(ids, dut=False), headers=auth_headers)
    assert ok.status_code == 201, ok.text
    pid = ok.json()["id"]
    sua = client.put(f"/api/phieu-tinh-gia/{pid}", json={"thanh_phans": _body(ids, dut=True)["thanh_phans"]},
                     headers=auth_headers)
    assert sua.status_code == 422, sua.text
    # Bản đã lưu không bị đè bởi lượt sửa bị chặn.
    got = client.get(f"/api/phieu-tinh-gia/{pid}", headers=auth_headers).json()
    assert len(got["thanh_phans"][0]["thanh_phams"]) == 2


def test_preview_chuoi_dut_tra_loi_khong_chan(client, auth_headers):
    ids = _seed()
    r = client.post("/api/tinh-gia/preview", json=_body(ids, dut=True), headers=auth_headers)
    assert r.status_code == 200, r.text
    assert any("Cắt thành phẩm" in s for s in r.json()["meta"]["components"][0]["loi_chuoi"])


def test_phieu_cu_chuoi_dut_van_mo_duoc(client, auth_headers):
    """Phiếu lưu trước luật mới (ảnh chụp có chuỗi đứt) — GET không tính lại nên vẫn 200."""
    ids = _seed()
    ok = client.post("/api/phieu-tinh-gia", json=_body(ids, dut=False), headers=auth_headers)
    pid = ok.json()["id"]
    db = SessionLocal()
    try:
        p = db.get(PhieuTinhGia, pid)
        p.warnings_json = ["Bước 'E2E Be thu' ra con nhưng bước 'Cắt thành phẩm' vào to — chuỗi đứt đơn vị."]
        db.commit()
    finally:
        db.close()
    assert client.get(f"/api/phieu-tinh-gia/{pid}", headers=auth_headers).status_code == 200


def test_cau_bao_dung_nhan_chang_khong_in_ma_tho():
    loi = kiem_chuoi_don_vi([{"ten": "Bế", "dv_vao": "to", "dv_ra": "con"},
                             {"ten": "Cắt", "dv_vao": "to", "dv_ra": "con"}])
    assert "ra con nhưng bước 'Cắt' nhận tờ in" in loi[0]
