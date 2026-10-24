"""Chọn nguồn giấy + khâu chuẩn bị giấy khi lập lệnh (spec 2026-10-24-chuan-bi-giay §7) — hàm thuần.

Ví dụ chuẩn: Duplex 350 gsm, khổ in 650×430, khổ nguyên 650×860 (xả 2), cần 3.000 tờ in ⇒ 1.500 tờ nguyên.
"""
from __future__ import annotations

import math

import pytest

from app.services.chuan_bi_giay import (
    CUON_DU_TOI_DA_MM, DauVaoGiay, NguonChon, can_tgi, chon_nguon, dong_giay_buoc_dau, dong_song,
    ma_buoc_giay,
)
from app.services.kho_giay import kg_tu_to, khoa_ton

G = 7


def _dv(**kw) -> DauVaoGiay:
    d = dict(giay_id=G, gsm=350, kho_in=(650, 430), kho_nguyen=(650, 860), so_to_in=3000, so_manh_xa=2)
    d.update(kw)
    return DauVaoGiay(**d)


def _ton(*dong: tuple[tuple[int, int], str, float]):
    """Tồn tự do giả: [((rộng, dài), đơn vị gốc, số)]. Khoá tra đúng `khoa_ton` như kho thật."""
    bang = {khoa_ton("giay", G, goc=goc, kho_rong=r, kho_dai=d): so for (r, d), goc, so in dong}
    return lambda khoa: bang.get(khoa, 0.0)


def test_co_to_kho_in_du_lay_thang():
    n = chon_nguon(_dv(), _ton(((650, 430), "to", 3000)))
    assert n.nguon == "to_in" and ma_buoc_giay(n.nguon, _dv()) == []


def test_co_to_nguyen_du_them_te():
    n = chon_nguon(_dv(), _ton(((650, 430), "to", 2999), ((860, 650), "to", 1500)))
    assert n.nguon == "to_nguyen" and ma_buoc_giay(n.nguon, _dv()) == ["TGI"]


def test_co_cuon_rong_bang_canh_them_cat_cuon_va_te():
    n = chon_nguon(_dv(), _ton(((860, 0), "kg", 400)))
    assert (n.nguon, n.rong_cuon) == ("cuon", 860)
    assert ma_buoc_giay(n.nguon, _dv()) == ["CGC", "TGI"]


def test_cuon_rong_hon_trong_30mm_duoc_chon_cuon_hep_nhat():
    n = chon_nguon(_dv(), _ton(((880, 0), "kg", 400), ((870, 0), "kg", 400)))
    assert (n.nguon, n.rong_cuon) == ("cuon", 870)


def test_cuon_rong_hon_qua_30mm_bo_qua():
    assert CUON_DU_TOI_DA_MM == 30
    assert chon_nguon(_dv(), _ton(((900, 0), "kg", 9999))).nguon == "mua"


def test_cuon_khong_du_kg_bo_qua():
    # 1.500 tờ 650×860 × 350 gsm ≈ 293,5 kg; cuộn chỉ 200 kg.
    assert chon_nguon(_dv(), _ton(((860, 0), "kg", 200))).nguon == "mua"


def test_khong_du_nguon_nao_la_mua():
    n = chon_nguon(_dv(), _ton())
    assert n == NguonChon("mua", None, None) and ma_buoc_giay("mua", _dv()) == ["TGI"]


def test_kho_nguyen_bang_kho_in_khong_them_te():
    dv = _dv(kho_nguyen=(650, 430), so_manh_xa=1)
    assert not can_tgi(dv)
    n = chon_nguon(dv, _ton(((650, 0), "kg", 400)))
    assert n.nguon == "cuon" and ma_buoc_giay("cuon", dv) == ["CGC"]
    assert ma_buoc_giay("to_nguyen", dv) == [] and ma_buoc_giay("mua", dv) == []


@pytest.mark.parametrize("kw", [dict(kho_nguyen=None), dict(so_manh_xa=None), dict(so_manh_xa=0)])
def test_thieu_kho_nguyen_khong_chia_0(kw):
    dv = _dv(**kw)
    assert chon_nguon(dv, _ton(((650, 430), "to", 3000))).nguon == "to_in"
    n = chon_nguon(dv, _ton(((860, 650), "to", 9999), ((860, 0), "kg", 9999)))
    assert (n.nguon, n.ly_do) == ("mua", "thiếu khổ nguyên")
    assert ma_buoc_giay(n.nguon, dv) == []
    d = dong_giay_buoc_dau(n, dv, 3060)
    assert (d["so_luong"], d["don_vi_goc"], d["kho_rong"], d["kho_dai"]) == (3060, "to", 430, 650)


def test_dong_giay_cat_cuon_tinh_kg_theo_rong_cuon():
    d = dong_giay_buoc_dau(NguonChon("cuon", 870, None), _dv(), 1530)
    assert d["hang_loai"] == "giay" and d["vat_tu_id"] == G
    assert d["so_luong"] == math.ceil(kg_tu_to(1530, 870, 650, 350) * 100) / 100   # 302,83
    assert (d["kho_rong"], d["kho_dai"], d["don_vi_goc"]) == (870, 0, "kg")


def test_dong_giay_cat_cuon_kg_lam_tron_len_hai_so_le():
    """Đề nghị kho lưu 2 số lẻ; nhu cầu 19,7925 kg mà đề nghị 19,79 thì cấp đủ đề nghị vẫn treo
    0,0025 kg "còn phải lấy" ở bảng cân đối. Làm tròn LÊN để cấp đủ đề nghị là đủ nhu cầu."""
    d = dong_giay_buoc_dau(NguonChon("cuon", 870, None), _dv(), 100)   # 19,7925 kg
    assert d["so_luong"] == 19.80


def test_dong_giay_te_tinh_to_nguyen():
    d = dong_giay_buoc_dau(NguonChon("to_nguyen", None, None), _dv(), 1530)
    assert (d["so_luong"], d["don_vi_goc"], d["kho_rong"], d["kho_dai"]) == (1530, "to", 650, 860)


def test_dong_giay_lay_thang_tinh_to_in():
    d = dong_giay_buoc_dau(NguonChon("to_in", None, None), _dv(), 3060)
    assert (d["so_luong"], d["don_vi_goc"], d["kho_rong"], d["kho_dai"]) == (3060, "to", 430, 650)


def test_dong_song_tinh_to_kho_in():
    d = dong_song(9, (650, 430), 1020)
    assert d == {"hang_loai": "giay", "vat_tu_id": 9, "so_luong": 1020, "don_vi_goc": "to",
                 "kho_rong": 430, "kho_dai": 650}


@pytest.mark.parametrize("kw", [dict(), dict(kho_nguyen=None), dict(kho_nguyen=(650, 430), so_manh_xa=1)])
def test_chon_nguon_chi_hoi_khoa_ung_vien(kw):
    """Bên gọi đọc tồn MỘT lượt cho cả danh sách khoá — chon_nguon không được hỏi khoá ngoài danh sách."""
    from app.services.chuan_bi_giay import khoa_ung_vien

    dv, da_hoi = _dv(**kw), []
    chon_nguon(dv, lambda k: da_hoi.append(k) or 0.0)
    assert da_hoi and set(da_hoi) <= set(khoa_ung_vien(dv))
