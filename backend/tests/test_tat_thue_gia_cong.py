"""Tắt phân hệ Thuê gia công theo bản cài — `PHAN_HE_TAT=thue_gia_cong` (In Hà Phương, 17/11/2026).

Tắt thì: module `thue_gia_cong` mất quyền ở mọi vai (thanh bên, ma trận, router module), không thuê trọn
gói, không đặt bước Thuê ngoài MỚI ở lệnh. Bước thuê ngoài đã có giữ nguyên và đổi về Máy được.
"""
from __future__ import annotations

import pytest

from app.config import settings
from app.models.lsx import LB_MAY, LB_THUE_NGOAI
from app.services.lsx_service import LsxValidationError
from tests.gia_cong_fixtures import lenh_chua_phat
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401
from tests.test_gia_cong_buoc_lenh import _rows


def _admin(client) -> dict[str, str]:
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def tat_tgc(monkeypatch):
    monkeypatch.setattr(settings, "phan_he_tat", "thue_gia_cong")


def test_tat_thi_mat_module_va_khong_thue_tron_goi(client, tat_tgc):
    h = _admin(client)
    r = client.get("/api/auth/permissions", headers=h).json()
    assert "thue_gia_cong" in r["phan_he_tat"]
    assert "thue_gia_cong" not in r["modules"]
    assert client.get("/api/thue-gia-cong/nha-gia-cong", headers=h).status_code == 403
    r = client.post("/api/thue-gia-cong/lenh/1/tron-goi", headers=h, json={"sl_can": 100})
    assert r.status_code == 404 and "không dùng ở bản cài" in r.json()["detail"]


def test_bat_mac_dinh_o_sao_viet_nhat(client, monkeypatch):
    monkeypatch.setattr(settings, "phan_he_tat", "")
    h = _admin(client)
    r = client.get("/api/auth/permissions", headers=h).json()
    assert "thue_gia_cong" not in r["phan_he_tat"] and "thue_gia_cong" in r["modules"]


def test_tat_thi_khong_dat_buoc_thue_ngoai_moi(sess, orders, lsx_svc, admin, customer, tat_tgc):
    lsx = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    with pytest.raises(LsxValidationError, match="không dùng Thuê gia công"):
        lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(lsx, loai_buoc=LB_THUE_NGOAI), actor=admin)


def test_buoc_thue_ngoai_cu_van_giu_va_doi_ve_may_duoc(sess, orders, lsx_svc, admin, customer, monkeypatch):
    lsx = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(lsx, loai_buoc=LB_THUE_NGOAI), actor=admin)
    monkeypatch.setattr(settings, "phan_he_tat", "thue_gia_cong")
    # Lưu lại nguyên lệnh: bước thuê ngoài sẵn có không bị chặn.
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(lsx), actor=admin)
    assert max(lsx.cong_doans, key=lambda c: c.thu_tu).loai_buoc == LB_THUE_NGOAI
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(lsx, loai_buoc=LB_MAY), actor=admin)
    assert max(lsx.cong_doans, key=lambda c: c.thu_tu).loai_buoc == LB_MAY
