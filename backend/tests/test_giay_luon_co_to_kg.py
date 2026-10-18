"""Mã giấy luôn có nhóm tờ + nhóm kg; Đơn vị tờ/kg bị khoá (chốt 18/10/2026,
spec docs/superpowers/specs/2026-10-18-luong-giay-theo-dau-vao-buoc-design.md)."""
import pytest

from app.db_migrations import MIGRATIONS
from app.models.vat_lieu_kho import GiayNguyen
from tests.conftest import phien_da_seed


@pytest.fixture
def db():
    yield from phien_da_seed()


def test_mg_0421_bu_to_kg_cho_giay_cu(db):
    thieu_to = GiayNguyen(ma="M-KG", ten="Chỉ kg", gsm=150, don_vi_gia="kg", don_vi_them=[])
    thieu_kg = GiayNguyen(ma="M-TO", ten="Chỉ tờ", gsm=150, don_vi_gia="to", don_vi_them=None)
    du = GiayNguyen(ma="M-RAM", ten="Ram + tấn", gsm=150, don_vi_gia="ram", don_vi_them=["tan"])
    db.add_all([thieu_to, thieu_kg, du])
    db.commit()
    mg = dict(MIGRATIONS)["0421_giay_luon_co_to_kg"]
    mg(db)
    mg(db)   # chạy lại không thêm trùng
    db.expire_all()
    assert (thieu_to.don_vi_gia, thieu_to.don_vi_them) == ("kg", ["to"])
    assert (thieu_kg.don_vi_gia, thieu_kg.don_vi_them) == ("to", ["kg"])
    assert (du.don_vi_gia, du.don_vi_them) == ("ram", ["tan"])


# ============================ Đơn vị & quy đổi: tờ, kg bị khoá ============================
from app.db import SessionLocal  # noqa: E402
from app.models.don_vi_do import DonViDo  # noqa: E402
from tests.test_danh_muc_http_contract import _admin  # noqa: E402


def _dv(ma: str) -> dict:
    s = SessionLocal()
    try:
        d = s.query(DonViDo).filter(DonViDo.ma == ma).first()
        if d is None:
            d = DonViDo(ma=ma, ten={"to": "tờ", "kg": "kg"}.get(ma, ma), ho="dem")
            s.add(d)
            s.commit()
        return {"id": d.id, "ma": d.ma, "ten": d.ten, "ho": d.ho}
    finally:
        s.close()


@pytest.mark.parametrize("ma", ["to", "kg"])
def test_don_vi_to_kg_khong_xoa_khong_ngung_khong_doi_ma(client, ma):
    h = _admin(client)
    d = _dv(ma)
    r = client.delete(f"/api/don-vi/{d['id']}", headers=h)
    assert r.status_code >= 400 and "bắt buộc của giấy" in r.text, r.text
    r = client.patch(f"/api/don-vi/{d['id']}/active", json={"active": False}, headers=h)
    assert r.status_code >= 400 and "bắt buộc của giấy" in r.text, r.text
    r = client.put(f"/api/don-vi/{d['id']}", json={**d, "ma": f"{ma}x"}, headers=h)
    assert r.status_code >= 400 and "Không đổi được mã" in r.text, r.text
    # Tên vẫn sửa được.
    r = client.put(f"/api/don-vi/{d['id']}", json={**d, "ten": f"{d['ten']} (đếm)"}, headers=h)
    assert r.status_code == 200, r.text


def test_don_vi_khac_van_xoa_duoc(client):
    h = _admin(client)
    d = _dv("thung_zz")
    r = client.delete(f"/api/don-vi/{d['id']}", headers=h)
    assert r.status_code in (200, 204), r.text
