"""L-SX-39 — ô "Xem giá" của danh mục Giấy và Công đoạn.

Đơn giá giấy là giá vốn, tiền khoán công đoạn là tiền lương: máy chủ xoá các ô đó khỏi phản hồi
khi người gọi thiếu `view_cost` của màn. Người SỬA được mà không thấy giá thì lưu form không xoá
trắng giá (router giữ số cũ).
"""
from __future__ import annotations

from app.db import SessionLocal
from app.models.cong_doan import CongDoan, CongDoanKhoan, CongDoanKhoanPhatSinh
from app.models.don_vi_do import DonViDo
from app.models.vat_lieu_kho import GiayNguyen
from tests.test_fine_permissions_api import _h, _user_with_role


def _nen() -> tuple[int, int]:
    db = SessionLocal()
    try:
        db.add(DonViDo(ma="va39dv", ten="tờ VA39", ho="khac"))
        g = GiayNguyen(ma="G-VA39", ten="Duplex VA39", loai="giay", gsm=350, don_gia=19_500)
        cd = CongDoan(ma="CD-VA39", ten="Bế VA39", nhom="finishing", pricing_basis="per_finished_qty")
        db.add_all([g, cd])
        db.flush()
        k = CongDoanKhoan(cong_doan_id=cd.id, unit="va39dv", unit_price=120, gia_co_dinh=50_000,
                          cong_thuc_khoan="gia_co_dinh + sl_ghi * don_gia_khoan")
        db.add(k)
        db.flush()
        db.add(CongDoanKhoanPhatSinh(cong_doan_khoan_id=k.id, ten="Thay dao", don_gia=30_000,
                                     don_vi="va39dv"))
        db.commit()
        return g.id, cd.id
    finally:
        db.close()


def test_khong_xem_gia_thi_json_khong_co_gia_giay_va_tien_khoan(client):
    gid, cdid = _nen()
    xem = _user_with_role("va39-xem", "dm_giay", can_read=True)
    _user_with_role("va39-xem", "dm_cong_doan", can_read=True)

    g = client.get(f"/api/vat-lieu-kho/giay/{gid}", headers=_h(xem)).json()
    assert g["don_gia"] is None and g["ten"] == "Duplex VA39"
    ds = client.get("/api/vat-lieu-kho/giay", params={"size": 200}, headers=_h(xem)).json()["items"]
    assert all(r["don_gia"] is None for r in ds)
    assert client.get(f"/api/vat-lieu-kho/giay/{gid}/versions", headers=_h(xem)).status_code == 403

    k = client.get(f"/api/cong-doan/{cdid}", headers=_h(xem)).json()["khoan"]
    assert k["unit_price"] is None and k["gia_co_dinh"] is None and k["gia_theo_to"] is None
    assert [v["don_gia"] for v in k["viec_phat_sinh"]] == [None]
    assert k["cong_thuc_khoan"] == "gia_co_dinh + sl_ghi * don_gia_khoan"   # công thức vẫn đọc được

    co = _user_with_role("va39-co", "dm_giay", can_read=True, can_view_cost=True)
    _user_with_role("va39-co", "dm_cong_doan", can_read=True, can_view_cost=True)
    assert client.get(f"/api/vat-lieu-kho/giay/{gid}", headers=_h(co)).json()["don_gia"] == 19_500
    k = client.get(f"/api/cong-doan/{cdid}", headers=_h(co)).json()["khoan"]
    assert (k["unit_price"], k["gia_co_dinh"]) == (120, 50_000)
    assert [v["don_gia"] for v in k["viec_phat_sinh"]] == [30_000]


def test_sua_khi_khong_xem_gia_thi_giu_gia_cu(client):
    gid, cdid = _nen()
    sua = _user_with_role("va39-sua", "dm_giay", can_read=True, can_update=True)
    _user_with_role("va39-sua", "dm_cong_doan", can_read=True, can_update=True)

    g = client.get(f"/api/vat-lieu-kho/giay/{gid}", headers=_h(sua)).json()
    r = client.put(f"/api/vat-lieu-kho/giay/{gid}", json={**g, "ten": "Duplex VA39 mới"}, headers=_h(sua))
    assert r.status_code == 200, r.text
    assert r.json()["don_gia"] is None

    cd = client.get(f"/api/cong-doan/{cdid}", headers=_h(sua)).json()
    r = client.put(f"/api/cong-doan/{cdid}", json={**cd, "ten": "Bế VA39 mới"}, headers=_h(sua))
    assert r.status_code == 200, r.text

    db = SessionLocal()
    try:
        assert float(db.get(GiayNguyen, gid).don_gia) == 19_500
        goc = db.get(CongDoan, cdid)
        assert goc.ten == "Bế VA39 mới"
        assert (float(goc.khoan.unit_price), float(goc.khoan.gia_co_dinh)) == (120, 50_000)
        assert [float(v.don_gia) for v in goc.khoan.viec_phat_sinh] == [30_000]
    finally:
        db.close()


def test_migration_0450_cap_san_xem_gia_cho_vai_dang_sua_va_vai_thay_gia_kho(client):
    from sqlalchemy import text

    from app.db_migrations import _migrate_xem_gia_giay_cong_doan

    _user_with_role("va39-mg-sua", "dm_cong_doan", can_read=True, can_update=True)
    _user_with_role("va39-mg-kt", "dm_giay", can_read=True)
    _user_with_role("va39-mg-kt", "kho", can_read=True, can_view_cost=True)
    _user_with_role("va39-mg-xem", "dm_giay", can_read=True)
    db = SessionLocal()
    try:
        _migrate_xem_gia_giay_cong_doan(db)
        hang = dict(((r, m), bool(v)) for r, m, v in db.execute(text(
            "SELECT r.name, rp.module_key, rp.can_view_cost FROM role_permissions rp "
            "JOIN roles r ON r.id = rp.role_id WHERE r.name LIKE 'role-va39-mg-%'")))
    finally:
        db.close()
    assert hang[("role-va39-mg-sua", "dm_cong_doan")] is True
    assert hang[("role-va39-mg-kt", "dm_giay")] is True
    assert hang[("role-va39-mg-xem", "dm_giay")] is False
