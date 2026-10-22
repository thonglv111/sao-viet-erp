"""Ô "Tổ đứng máy" của danh mục Máy (spec 2026-10-22-may-thuoc-to §4.1) — đi trọn POST/PUT → GET.

Một máy thuộc NHIỀU tổ; chỉ nhận tổ LÁ khối Sản xuất. Gán tổ cho máy thì công đoạn đang tick tổ đó
tự có dòng máy (công thức trống) để bảng "Máy chạy được công đoạn này" hiện ngay.
"""
from __future__ import annotations

import pytest
from sqlalchemy.orm import Session


def _headers(client) -> dict[str, str]:
    login = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.fixture()
def nen(client) -> dict:
    from app.db import engine
    from app.models.cong_doan import CongDoan
    from app.models.department import Department

    with Session(engine) as db:
        a = Department(name="Nhóm in 2 màu T", code="PB-T2M", la_san_xuat=True)
        b = Department(name="Nhóm in 4 màu T", code="PB-T4M", la_san_xuat=True)
        cha = Department(name="Khối in T", code="PB-TCHA", la_san_xuat=True)
        db.add_all([a, b, cha])
        db.flush()
        con = Department(name="Tổ con T", code="PB-TCON", la_san_xuat=True, parent_id=cha.id)
        cd = CongDoan(ma="CD-IN-T", ten="In T", nhom="print")
        db.add_all([con, cd])
        db.flush()
        cd.department_ids = [a.id]
        db.commit()
        ids = {"a": a.id, "b": b.id, "cha": cha.id, "cd": cd.id}
    return {"headers": _headers(client), **ids}


def _payload(**kw) -> dict:
    return {"ma": "IN-T1", "ten": "Máy in thử", "loai_may": "Máy in", **kw}


def test_tao_va_sua_to_dung_may(client, nen):
    h = nen["headers"]
    r = client.post("/api/may-thiet-bi", json=_payload(to_ids=[nen["a"], nen["b"]]), headers=h)
    assert r.status_code == 201, r.text
    assert sorted(r.json()["to_ids"]) == sorted([nen["a"], nen["b"]])
    mid = r.json()["id"]

    r = client.put(f"/api/may-thiet-bi/{mid}", json=_payload(to_ids=[nen["b"]]), headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["to_ids"] == [nen["b"]]

    # PUT không gửi `to_ids` ⇒ giữ nguyên
    r = client.put(f"/api/may-thiet-bi/{mid}", json=_payload(ten="Đổi tên"), headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["to_ids"] == [nen["b"]]

    doc = client.get(f"/api/may-thiet-bi/{mid}", headers=h)
    assert doc.json()["to_ids"] == [nen["b"]]


def test_chi_nhan_to_la(client, nen):
    r = client.post("/api/may-thiet-bi", json=_payload(to_ids=[nen["cha"]]), headers=nen["headers"])
    assert r.status_code == 422, r.text  # lỗi kiểm dữ liệu danh mục = 422 như mọi màn danh mục


def test_gan_to_thi_cong_doan_co_dong_may(client, nen):
    h = nen["headers"]
    r = client.post("/api/may-thiet-bi", json=_payload(to_ids=[nen["a"]]), headers=h)
    assert r.status_code == 201, r.text
    cd = client.get(f"/api/cong-doan/{nen['cd']}", headers=h).json()
    assert [m["may_id"] for m in cd["may_lam_duoc"]] == [r.json()["id"]]
    assert cd["may_lam_duoc"][0]["cong_thuc_gio"] is None


def test_nhat_ky_chup_to_dung_may(client, nen):
    from app.db import engine
    from app.models.may_thiet_bi import MayThietBi
    from app.services import nhat_ky_danh_muc as nk

    r = client.post("/api/may-thiet-bi", json=_payload(to_ids=[nen["a"]]), headers=nen["headers"])
    with Session(engine) as db:
        may = db.get(MayThietBi, r.json()["id"])
        assert nk.anh_chup(may)["to_dung_may"] == "Nhóm in 2 màu T"
        assert nk.NHAN["to_dung_may"] == "Tổ đứng máy"


def test_excel_may_co_cot_to_dung_may():
    from app.services.catalog_excel_specs import MAY_THIET_BI

    nhan = [c.nhan for c in MAY_THIET_BI.cot]
    assert "Mã tổ đứng máy" in nhan and "Tổ đứng máy" in nhan
