"""Dự báo tồn màn Tồn kho (`GET /api/kho/phieu/lo/du-bao`) — số lấy nguyên từ bảng cân đối.

Hai lớp: (1) service gộp đúng dòng bảng theo chủ thể, bỏ dòng đã cấp đủ / chưa rõ, cộng hàng đang
về theo ngày; (2) HTTP thật: cùng cửa quyền với danh sách lô — dòng Kho A không đọc được Kho B.
"""
from __future__ import annotations

import contextlib
from datetime import date

from app.models.role import SCOPE_ALL
from app.services import can_doi_cache, du_bao_ton_service
from app.services.du_bao_ton_service import DuBaoTonService

from .test_kho_de_nghi import _admin, _login, _nhap, _setup
from .test_quyen_theo_kho import _kho, _nguoi


class _KhGia:
    db = None

    def __init__(self, dang_ve, vet):
        self._dv, self._vet, self.hoi = dang_ve, vet, None

    def dang_ve_va_vet_mua(self, hangs):
        self.hoi = list(hangs)
        return self._dv, self._vet

    def nho_phieu_mua(self):
        return contextlib.nullcontext()


def _dong(ma, lsx_id, can, *, han, giu=0.0, loai="vat_tu"):
    return {"loai": loai, "ma": ma, "lsx_id": lsx_id, "bai_ghep_id": None, "ten_viec": "In",
            "khach_ten": "Khách A", "han_giao_khach": han, "con_phai_co": can,
            "da_giu_kho": giu, "da_giu_dang_ve": 0}


def test_du_bao_gop_theo_lenh_va_cong_hang_dang_ve(monkeypatch):
    giay = ("giay", 5, 650, 860, "to")
    bang = {"items": [{
        "loai_nhom": "vat_tu", "hang_loai": "giay", "hang_id": 5, "kho_rong": 650, "kho_dai": 860,
        "don_vi_goc": "to", "ton": 5000,
        "dong": [
            _dong("LSX-0318", 1, 1200, han="2026-10-09", giu=1200),
            _dong("LSX-0318", 1, 300, han="2026-10-08", giu=1200),  # cùng lệnh, bước khác
            _dong("LSX-0322", 2, 700, han="2026-10-12"),
            _dong("LSX-0300", 3, 0, han="2026-10-01"),               # đã cấp đủ ⇒ rụng
            _dong("LSX-0301", 4, None, han="2026-10-02"),            # chưa rõ đơn vị ⇒ rụng
        ],
    }]}
    monkeypatch.setattr(du_bao_ton_service, "bang_can_doi", lambda kh, giu: bang)
    # Dòng đơn 11 lập từ yêu cầu cho LSX-0318, dòng 12 không nối yêu cầu nào.
    monkeypatch.setattr(du_bao_ton_service, "mua_cho_theo_dong_don", lambda db, ids: {11: {
        "loai_mua": "cho_lsx", "lenh": [{"loai": "lsx", "id": 1, "ma": "LSX-0318", "so_luong": 1000.0}]}})
    kh = _KhGia(
        {giay: [(date(2026, 10, 15), 1000.0, "PMH-1", 11), (date(2026, 10, 15), 500.0, "PMH-1", 12)]},
        {("vat_tu", 9, 0, 0, ""): [{"ma": "YCMH-1", "loai": "ycmh", "trang_thai": "open", "ngay_ve": None}]},
    )

    rows = {(r["hang_loai"], r["hang_id"]): r
            for r in DuBaoTonService(kh, None).du_bao([giay, ("vat_tu", 9)])}

    g = rows[("giay", 5)]
    assert g["ton_toan_xuong"] == 5000 and g["don_vi_goc"] == "to"
    assert [(x["ma"], x["can"], x["da_giu"], x["han_giao"]) for x in g["lenh"]] == [
        ("LSX-0318", 1500.0, 1200.0, "2026-10-08"), ("LSX-0322", 700.0, 0.0, "2026-10-12")]
    assert g["can_lenh"] == 2200.0
    assert g["dang_ve"] == 1500.0 and g["ve"] == [{
        "ma": "PMH-1", "ngay_ve": date(2026, 10, 15), "sl": 1500.0, "loai_mua_cac": ["cho_lsx"],
        "mua_cho": [{"loai": "lsx", "id": 1, "ma": "LSX-0318", "so_luong": 1000.0}]}]

    # Mã chưa lệnh nào cần: vẫn có dòng để màn bày phiếu mua đang chạy.
    v = rows[("vat_tu", 9)]
    assert v["ton_toan_xuong"] is None and v["lenh"] == [] and v["can_lenh"] == 0
    assert [p["ma"] for p in v["phieu_mua"]] == ["YCMH-1"]
    assert ("vat_tu", 9, 0, 0, "") in kh.hoi   # cặp (loai, id) được chuẩn thành khoá 5 phần


def test_du_bao_rong_khi_kho_khong_co_hang():
    assert DuBaoTonService(None, None).du_bao([]) == []


def test_api_du_bao_cung_cua_quyen_voi_danh_sach_lo(client):
    can_doi_cache.xoa_cache_can_doi()
    kho_a, mat = _setup(client)
    h = _admin(client)
    kho_b = _kho(client, h, "Kho B dự báo")
    _nhap(client, kho_id=kho_a, mat_id=mat, qty=5, gia=1000)

    r = client.get("/api/kho/phieu/lo/du-bao", headers=h, params={"kho_id": kho_a})
    assert r.status_code == 200, r.text
    dong = [x for x in r.json() if (x["hang_loai"], x["hang_id"]) == tuple(mat)]
    assert len(dong) == 1 and dong[0]["lenh"] == [] and dong[0]["can_lenh"] == 0

    _nguoi("db_chi_a", {f"ton_kho_{kho_a}": dict(can_read=True, scope=SCOPE_ALL)})
    u = _login(client, "db_chi_a")
    assert client.get("/api/kho/phieu/lo/du-bao", headers=u, params={"kho_id": kho_a}).status_code == 200
    assert client.get("/api/kho/phieu/lo/du-bao", headers=u, params={"kho_id": kho_b}).status_code == 403
    can_doi_cache.xoa_cache_can_doi()
