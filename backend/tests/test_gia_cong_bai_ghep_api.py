"""Router lần gia công của bước CHUNG bài ghép (spec 2026-09-27 §4–5): đọc ở màn bài ghép, dòng chỉ
đọc ở màn lệnh, phạm vi trên MỌI lệnh thành viên, SSE mang cả danh sách lệnh, hàng chờ chi."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models.gia_cong_ngoai import NOI_VE_XUONG, GiaCongNgoai
from app.models.lsx import Lsx
from app.models.role import SCOPE_OWN
from app.models.user import User
from app.routers import gia_cong_ngoai as r
from app.schemas.gia_cong_ngoai import MangDiIn
from app.services.gia_cong_ngoai.chot import chot
from app.services.gia_cong_ngoai.mot_phan import mang_di
from tests.gia_cong_fixtures import cv_chung, dung_bai_ghep_gia_cong, giao_sang, ncc
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401


@pytest.fixture
def bai(sess, orders, lsx_svc, admin, customer):
    tp = ncc(sess, "Cán màng Tân Phát")
    bg, a, b = dung_bai_ghep_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=[
        ("In", "may", None, 1000, "to", "to"),
        ("Cán màng", "thue_ngoai", tp, 1000, "to", "to"),
        ("Bế", "may", None, 4000, "to", "cai"),
    ], chung=[0, 1], con=(4, 2))
    giao_sang(sess, admin, cv_chung(sess, bg.id, "In"), cv_chung(sess, bg.id, "Cán màng"), 1000)
    lan = sess.query(GiaCongNgoai).filter_by(bai_ghep_id=bg.id).one()
    return bg, a, b, lan


def _h(client):
    tok = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    return {"Authorization": f"Bearer {tok.json()['access_token']}"}


def test_doc_o_bai_ghep_va_dong_chi_doc_o_lenh(client, sess, bai):
    bg, a, b, lan = bai
    h = _h(client)
    rs = client.get(f"/api/gia-cong-ngoai/bai-ghep/{bg.id}", headers=h)
    assert rs.status_code == 200, rs.text
    (d,) = rs.json()
    ma = {l.id: l.ma for l in sess.query(Lsx).filter(Lsx.id.in_([a, b]))}
    assert d["lsx_id"] is None and d["bai_ghep_ma"] == bg.ma and d["chi_xem"] is False
    assert d["nhan_nguon"] == f"{bg.ma} ({ma[a]}, {ma[b]})"
    assert {(c["lsx_id"], c["so_con"]) for c in d["chia_theo_lenh"]} == {(a, 4), (b, 2)}
    rl = client.get(f"/api/gia-cong-ngoai/lenh/{a}", headers=h)
    assert rl.status_code == 200, rl.text
    assert [(x["id"], x["chi_xem"]) for x in rl.json()] == [(lan.id, True)]
    assert client.get("/api/gia-cong-ngoai/bai-ghep/999999", headers=h).status_code == 404


def test_loc_khsx_tinh_cho_moi_lenh_thanh_vien(client, sess, bai):
    _bg, a, b, _lan = bai
    rs = client.get("/api/lsx?gia_cong=cho_mang_di", headers=_h(client))
    assert rs.status_code == 200, rs.text
    assert {a, b} <= {x["id"] for x in rs.json()["items"]}


def test_sse_mang_di_mang_ca_danh_sach_lenh(client, sess, bai, monkeypatch):
    bg, a, b, lan = bai
    goi = []
    monkeypatch.setattr(r.hub, "gui", lambda e, **_k: goi.append(e))
    rs = client.post(f"/api/gia-cong-ngoai/{lan.id}/mang-di", headers=_h(client),
                     json={"version": lan.version})
    assert rs.status_code == 200, rs.text
    (e,) = [x for x in goi if x["type"] == "gia_cong_ngoai_changed"]
    assert e["bai_ghep_id"] == bg.id and set(e["lsx_ids"]) == {a, b}


def test_cho_chi_mang_nhan_bai_ghep(client, sess, admin, bai):
    bg, _a, _b, lan = bai
    mang_di(sess, user=admin, gcn_id=lan.id, expected_version=lan.version)
    sess.refresh(lan)
    chot(sess, user=admin, gcn_id=lan.id, expected_version=lan.version, sl_cuoi=980,
         noi_ve=NOI_VE_XUONG)
    rs = client.get("/api/accounting/gia-cong-cho-chi", headers=_h(client))
    assert rs.status_code == 200, rs.text
    (d,) = [x for x in rs.json() if x["gia_cong_ngoai_id"] == lan.id]
    assert d["lsx_id"] is None and d["bai_ghep_id"] == bg.id and d["nhan_nguon"].startswith(bg.ma)


class _Own:
    def scope_for(self, user, module_key):  # noqa: ARG002
        return SCOPE_OWN

    def can(self, *a, **k):  # noqa: ARG002
        return False


def test_pham_vi_mot_lenh_chi_xem_khong_lenh_nao_404(sess, bai):
    bg, a, b, lan = bai
    la = User(username="to_truong_bg", name="Sale của đơn A", password_hash="x")
    ngoai = User(username="nguoi_ngoai_bg", name="Người ngoài", password_hash="x")
    sess.add_all([la, ngoai])
    sess.commit()
    # Phạm vi lệnh đi theo NGƯỜI PHỤ TRÁCH (08/11/2026): `la` phụ trách lệnh A, lệnh B của admin ⇒
    # bài ghép có đúng một lệnh trong phạm vi của `la`.
    lenh_a, lenh_b = sess.get(Lsx, a), sess.get(Lsx, b)
    lenh_a.nguoi_phu_trach_id = la.id
    lenh_b.nguoi_phu_trach_id = sess.query(User).filter(User.username == "admin").first().id
    sess.commit()

    (d,) = r.cua_bai_ghep(bg.id, sess, _Own(), la)
    assert d["chi_xem"] is True
    with pytest.raises(HTTPException) as e:
        r.mang_di(lan.id, MangDiIn(version=lan.version), sess, _Own(), la)
    assert e.value.status_code == 403 and "chỉ xem" in e.value.detail
    sess.refresh(lan)
    assert lan.mang_di_luc is None
    with pytest.raises(HTTPException) as e:
        r.cua_bai_ghep(bg.id, sess, _Own(), ngoai)
    assert e.value.status_code == 404
