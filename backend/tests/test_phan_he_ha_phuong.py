"""Phân hệ CHỈ In Hà Phương có (`thuong_mai`, `giao_hang_hp`) — mặc định tắt, bật bằng `PHAN_HE_BAT`."""
from __future__ import annotations

from app.config import settings
from app.phan_he import module_bi_tat, phan_he_tat, tat


def test_mac_dinh_sao_viet_nhat_khong_thay(monkeypatch):
    monkeypatch.setattr(settings, "phan_he_tat", "")
    monkeypatch.setattr(settings, "phan_he_bat", "")
    assert tat("thuong_mai") and tat("giao_hang_hp")
    assert module_bi_tat("hang_thuong_mai") and module_bi_tat("xe_giao_hang")
    assert not tat("giao_hang") and not module_bi_tat("dm_vat_tu")


def test_ha_phuong_khai_thi_bat(monkeypatch):
    monkeypatch.setattr(settings, "phan_he_tat", "luong,giao_hang")
    monkeypatch.setattr(settings, "phan_he_bat", "thuong_mai, giao_hang_hp")
    assert phan_he_tat() == frozenset({"luong", "giao_hang"})
    assert not module_bi_tat("hang_thuong_mai") and not module_bi_tat("xe_giao_hang")


def test_bat_mot_phan_he(monkeypatch):
    monkeypatch.setattr(settings, "phan_he_tat", "")
    monkeypatch.setattr(settings, "phan_he_bat", "thuong_mai")
    assert not tat("thuong_mai") and tat("giao_hang_hp")
