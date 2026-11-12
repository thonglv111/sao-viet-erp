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
    """Tờ nguyên / mua đúng khổ in thì khỏi Tề. Cuộn thì VẪN Tề (L-SX-21): Cắt giấy cuộn ra tờ nguyên,
    In nhận tờ in — bỏ Tề là chuỗi đứt đơn vị."""
    dv = _dv(kho_nguyen=(650, 430), so_manh_xa=1)
    assert not can_tgi(dv)
    n = chon_nguon(dv, _ton(((650, 0), "kg", 400)))
    assert n.nguon == "cuon" and ma_buoc_giay("cuon", dv) == ["CGC", "TGI"]
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


def test_kho_nguyen_khong_chua_duoc_kho_in_coi_nhu_thieu():
    """Khổ nguyên 400×500 nhỏ hơn khổ in 430×650: engine ép xả ≥ 1 nên số mảnh không bắt được — phải
    xét độ lọt thật. Không được chọn cuộn 400 (cắt ra tờ nhỏ hơn khổ in)."""
    dv = _dv(kho_nguyen=(400, 500), so_manh_xa=1)
    n = chon_nguon(dv, _ton(((400, 0), "kg", 9999), ((400, 500), "to", 9999)))
    assert (n.nguon, n.ly_do) == ("mua", "thiếu khổ nguyên")
    assert ma_buoc_giay(n.nguon, dv) == []


def test_mot_manh_kho_nguyen_lon_hon_kho_in_van_te_va_lay_to_nguyen():
    """Khổ nguyên 700×700 chỉ ra một tờ in 430×650 vẫn phải Tề — spec §7 bỏ Tề khi khổ nguyên = khổ in,
    không phải khi một mảnh. Tồn tờ 700×700 phải được dùng, không đòi mua tờ khổ in."""
    dv = _dv(kho_nguyen=(700, 700), so_manh_xa=1)
    assert can_tgi(dv)
    n = chon_nguon(dv, _ton(((700, 700), "to", 3000)))
    assert n.nguon == "to_nguyen" and ma_buoc_giay(n.nguon, dv) == ["TGI"]
    d = dong_giay_buoc_dau(n, dv, 3060)
    assert (d["so_luong"], d["kho_rong"], d["kho_dai"]) == (3060, 700, 700)


# ── Phương án lấy ở kho (12/11/2026) ────────────────────────────────────────────────────────────

from app.models.cong_doan import CD_CAT_CUON, CD_TE_GIAY_IN, CD_TE_SONG  # noqa: E402
from app.services.chuan_bi_giay import KhoLay, nguon_dan_xuat, phuong_an_lay, so_manh  # noqa: E402


def test_so_manh_to_mot_va_hai_manh():
    assert so_manh(KhoLay("to", 790, 1090), (720, 1020)) == (1, None)
    assert so_manh(KhoLay("to", 1040, 1440), (720, 1020)) == (2, None)


def test_so_manh_cuon_chon_cach_nhieu_manh():
    assert so_manh(KhoLay("cuon", 1450, 0), (720, 1020)) == (2, 1020)
    assert so_manh(KhoLay("cuon", 700, 0), (720, 1020)) == (0, None)


def test_phuong_an_xep_theo_diem_va_chon_dau():
    ton = [(720, 1020, "to", 800), (760, 1060, "to", 1800), (790, 1090, "to", 2400), (750, 0, "kg", 3200)]
    ds = phuong_an_lay("giay", (720, 1020), 1560, 300, ton)
    assert [p.diem for p in ds] == sorted((p.diem for p in ds), reverse=True)
    assert ds[0].kho == KhoLay("to", 760, 1060) and ds[0].ma_buoc == [CD_TE_GIAY_IN]
    dung_kho = next(p for p in ds if p.kho == KhoLay("to", 720, 1020))
    assert dung_kho.ma_buoc == [] and dung_kho.ton == 800 and dung_kho.can == 1560
    cuon = next(p for p in ds if p.kho.dang == "cuon")
    assert cuon.ma_buoc == [CD_CAT_CUON, CD_TE_GIAY_IN] and cuon.don_vi == "kg"
    assert cuon.can == math.ceil(kg_tu_to(1560, 750, 1020, 300) * 100 - 1e-9) / 100


def test_to_hai_manh_chia_luong_can():
    ds = phuong_an_lay("giay", (720, 1020), 1561, 300, [(1440, 1040, "to", 900)])
    pa = next(p for p in ds if p.kho == KhoLay("to", 1040, 1440))
    assert pa.so_manh == 2 and pa.can == 781 and pa.ton == 900


def test_kho_trong_van_co_to_dung_kho_ton_0():
    ds = phuong_an_lay("giay", (1020, 720), 1560, 300, [])
    assert len(ds) == 1 and ds[0].kho == KhoLay("to", 720, 1020) and ds[0].ton == 0 and ds[0].diem == 50


def test_song_bo_cuon_va_kho_nho():
    ton = [(715, 1015, "to", 1800), (700, 1000, "to", 3000), (900, 0, "kg", 999)]
    ds = phuong_an_lay("song", (715, 1015), 1500, 560, ton)
    assert [p.kho for p in ds] == [KhoLay("to", 715, 1015)] and ds[0].diem == 100


def test_song_to_lon_hon_qua_te_song():
    ds = phuong_an_lay("song", (715, 1015), 1500, 560, [(720, 1020, "to", 1800)])
    assert ds[0].kho == KhoLay("to", 720, 1020) and ds[0].ma_buoc == [CD_TE_SONG]


def test_to_luu_theo_kg_doi_ra_to():
    mot_to = kg_tu_to(1, 720, 1020, 300)
    ds = phuong_an_lay("giay", (720, 1020), 100, 300, [(720, 1020, "kg", mot_to * 100)])
    assert ds[0].ton == pytest.approx(100) and ds[0].diem == 100


def test_toi_da_8_phuong_an():
    ton = [(720 + i * 10, 1020 + i * 10, "to", 5000) for i in range(12)]
    assert len(phuong_an_lay("giay", (720, 1020), 1000, 300, ton)) == 8


def test_nguon_dan_xuat():
    assert nguon_dan_xuat(KhoLay("to", 1020, 720), (720, 1020)) == "to_in"
    assert nguon_dan_xuat(KhoLay("to", 790, 1090), (720, 1020)) == "to_nguyen"
    assert nguon_dan_xuat(KhoLay("cuon", 750, 0), (720, 1020)) == "cuon"
