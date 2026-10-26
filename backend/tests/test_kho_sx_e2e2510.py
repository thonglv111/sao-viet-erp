"""Kho ↔ sản xuất (bấm thử 25/10/2026): sửa số xuất báo bàn tổ (L-SX-07), phát hành cập nhật đổi
tổ bước loại Tổ (L-SX-11), bước định mức 0 vẫn chờ tổ tự xin (L-SX-15), lệnh thu hồi chặn xuất
tiếp yêu cầu đã xuất một phần (L-SX-14)."""
from __future__ import annotations

from tests.test_xep_lich_service import (  # noqa: F401
    admin,
    bg_svc,
    customer,
    db,
    lsx_svc,
    orders,
    xl_svc,
)
from tests.test_kho_de_nghi import _approved_request, _login, _nhap, _setup


def test_dieu_chinh_xuat_bao_ban_to(client, monkeypatch):
    """L-SX-07: sửa số phiếu xuất đã ghi sổ ⇒ đẩy sự kiện kho như tạo / ghi sổ / huỷ."""
    from app.routers import kho_voucher as KV

    kho_id, mat_id = _setup(client)
    lot_id = _nhap(client, kho_id=kho_id, mat_id=mat_id, qty=10, gia=1_000)["lines"][0]["lot_id"]
    req = _approved_request(client, kho_id=kho_id, loai="XUAT", mat_id=mat_id, qty=6)
    tk = _login(client, "t_thukho")
    r = client.post("/api/kho/phieu", headers=tk, json={
        "request_id": req["id"], "kho_id": kho_id,
        "lines": [{"request_line_id": req["lines"][0]["id"], "so_luong": 6, "lot_id": lot_id}],
    })
    vid = r.json()["id"]
    line_id = client.post(f"/api/kho/phieu/{vid}/ghi-so", headers=tk).json()["lines"][0]["id"]

    bao = []
    monkeypatch.setattr(KV, "phat_su_kien_kho", lambda rq, **kw: bao.append(rq.id))
    r = client.post(f"/api/kho/phieu/{vid}/dieu-chinh-xuat", headers=tk, json={
        "lines": [{"line_id": line_id, "so_luong_moi": 5}], "ly_do": "xuất nhầm"})
    assert r.status_code == 200, r.text
    assert bao == [req["id"]]


def test_cap_nhat_doi_to_buoc_loai_to_sang_ban_moi(db, orders, lsx_svc, xl_svc, admin, customer):
    """L-SX-11: bước loại Tổ đổi tổ ⇒ phát hành cập nhật đưa việc sang bàn tổ mới, máy vẫn None."""
    from app.models.lsx import LsxCongDoan
    from app.models.san_xuat import BUOC_TO, SanXuatCongViec
    from app.services.san_xuat import release_update
    from tests.test_phat_hanh_cap_nhat_to_may import _phat_hanh_cap_lenh, _to_may

    a, goi = _phat_hanh_cap_lenh(db, orders, lsx_svc, xl_svc, admin, customer)
    cv = next(c for c in db.query(SanXuatCongViec).filter_by(goi_id=goi.id)
              if c.lsx_cong_doan_id and c.gia_cong_ngoai_id is None)
    cv.loai_buoc, cv.may_id = BUOC_TO, None
    to_moi, _ = _to_may(db, "TOX1")
    buoc = db.get(LsxCongDoan, cv.lsx_cong_doan_id)
    buoc.department_id, buoc.may_id = to_moi, None
    db.commit()

    release_update.phat_hanh_cap_nhat(db, nguon="lsx", id=a.id, ly_do="Đổi tổ", actor=admin)

    db.refresh(cv)
    assert (cv.department_id, cv.may_id) == (to_moi, None)
