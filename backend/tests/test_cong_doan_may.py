"""Bảng nối công đoạn × máy — nơi khai công thức giờ chạy và công thức giá theo từng máy.

Vì sao có bảng này (06/09/2026): "một bước chạy trên máy này bằng bao nhiêu <đơn vị tốc độ>" và
"máy này tính tiền thế nào" đều là giao của VIỆC và MÁY. Treo ở máy thì mọi công đoạn dùng chung;
treo ở công đoạn thì mọi máy dùng chung — cả hai cách cũ đều sai một nửa.
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — đăng ký metadata
from app.db import Base
from app.models.cong_doan import CongDoan, CongDoanMay, CongDoanVatTu
from app.models.may_thiet_bi import MayThietBi


@pytest.fixture()
def db():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    s = sessionmaker(bind=eng)()
    yield s
    s.close()


def _cd(db, ma="CD-M1") -> CongDoan:
    cd = CongDoan(ma=ma, ten="In AB", nhom="print")
    db.add(cd)
    db.flush()
    return cd


def _may(db, ma="MAY-1") -> MayThietBi:
    m = MayThietBi(ma=ma, ten="Komori 5 màu", loai_may="Máy in")
    db.add(m)
    db.flush()
    return m


def test_mot_cong_doan_giu_nhieu_may_moi_may_mot_cap_cong_thuc(db):
    cd, m1, m2 = _cd(db), _may(db, "MAY-1"), _may(db, "MAY-2")
    cd.may_khai.append(CongDoanMay(
        may_id=m1.id, cong_thuc_gio="sl_vao * so_mau / 5", cong_thuc_gia="sl_vao * 180", thu_tu=0))
    cd.may_khai.append(CongDoanMay(
        may_id=m2.id, cong_thuc_gio="sl_vao * so_mau / 2", cong_thuc_gia="sl_vao * 90", thu_tu=1))
    db.commit()
    db.refresh(cd)
    assert [r.may_id for r in cd.may_lam_duoc] == [m1.id, m2.id]
    assert cd.may_khai[0].cong_thuc_gio == "sl_vao * so_mau / 5"
    assert cd.may_khai[1].cong_thuc_gia == "sl_vao * 90"


def test_mot_may_khong_khai_hai_lan_trong_cung_cong_doan(db):
    cd, m = _cd(db), _may(db)
    cd.may_khai.append(CongDoanMay(may_id=m.id, thu_tu=0))
    db.commit()
    cd.may_khai.append(CongDoanMay(may_id=m.id, thu_tu=1))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_xoa_cong_doan_keo_theo_dong_may(db):
    cd, m = _cd(db), _may(db)
    cd.may_khai.append(CongDoanMay(may_id=m.id, thu_tu=0))
    db.commit()
    db.delete(cd)
    db.commit()
    assert db.query(CongDoanMay).count() == 0


def test_cong_doan_moi_vat_tu_mot_cong_thuc(db):
    """Mực ăn theo SỐ TỜ, dung môi rửa máy ăn theo SỐ MÀU — cùng công đoạn, cùng ĐVT kg.

    Vật tư neo thẳng vào CÔNG ĐOẠN từ 18/09/2026 (mg `0316`) — tầng đầu việc định mức đã gỡ.
    """
    cd = _cd(db, "CD-M9")
    cd.vat_tus.append(CongDoanVatTu(vat_tu_id=11, thu_tu=0, cong_thuc_luong="sl_vao / 40000"))
    cd.vat_tus.append(CongDoanVatTu(vat_tu_id=12, thu_tu=1, cong_thuc_luong="so_mau * 0.3"))
    db.commit()
    db.refresh(cd)
    assert [v.cong_thuc_luong for v in cd.vat_tus] == ["sl_vao / 40000", "so_mau * 0.3"]


def test_mot_vat_tu_khong_khai_hai_lan_trong_cung_cong_doan(db):
    cd = _cd(db, "CD-M10")
    cd.vat_tus.append(CongDoanVatTu(vat_tu_id=11, thu_tu=0))
    db.commit()
    cd.vat_tus.append(CongDoanVatTu(vat_tu_id=11, thu_tu=1))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


# ------------------------------------------------- máy theo tổ (spec 2026-10-22-may-thuoc-to §4.3–4.4)
from sqlalchemy.orm import Session  # noqa: E402


def _headers(client) -> dict[str, str]:
    login = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.fixture()
def nen_to(client) -> dict:
    """Tổ A, B; M1 thuộc A, M2 thuộc B (dòng có công thức, nằm im vì công đoạn chỉ tick A), M3 thuộc
    B chưa có dòng."""
    from app.db import engine
    from app.models.department import Department
    from app.models.may_thiet_bi import MayTo

    with Session(engine) as s:
        a = Department(name="Tổ A", code="PB-A", la_san_xuat=True)
        b = Department(name="Tổ B", code="PB-B", la_san_xuat=True)
        m1, m2, m3 = _may(s, "M1"), _may(s, "M2"), _may(s, "M3")
        s.add_all([a, b])
        s.flush()
        s.add_all([MayTo(may_id=m1.id, department_id=a.id), MayTo(may_id=m2.id, department_id=b.id),
                   MayTo(may_id=m3.id, department_id=b.id)])
        cd = _cd(s, "CD-TO")
        cd.department_ids = [a.id]
        cd.may_khai.append(CongDoanMay(may_id=m1.id, thu_tu=0, cong_thuc_gio="sl_vao"))
        cd.may_khai.append(CongDoanMay(may_id=m2.id, thu_tu=1, cong_thuc_gio="sl_vao * 2"))
        s.commit()
        ids = {"a": a.id, "b": b.id, "m1": m1.id, "m2": m2.id, "m3": m3.id, "cd": cd.id}
    return {"h": _headers(client), **ids}


def _put(client, n, **kw):
    body = {"ma": "CD-TO", "ten": "In AB", "nhom": "print", "che_do_tinh": "theo_san_luong",
            "pricing_basis": "per_finished_qty", "department_ids": [n["a"]],
            "may_lam_duoc": [{"may_id": n["m1"], "cong_thuc_gio": "sl_vao / 2"}], **kw}
    r = client.put(f"/api/cong-doan/{n['cd']}", json=body, headers=n["h"])
    assert r.status_code == 200, r.text
    return client.get(f"/api/cong-doan/{n['cd']}", headers=n["h"]).json()


def test_luu_form_khong_xoa_dong_may_nam_im(client, nen_to):
    n = nen_to
    cd = _put(client, n, may_lam_duoc=[
        {"may_id": n["m1"], "cong_thuc_gio": "sl_vao / 2"},
        {"may_id": n["m2"], "cong_thuc_gio": "sl_vao * 9"},   # ngoài phạm vi tổ ⇒ bỏ qua
    ])
    assert [r["may_id"] for r in cd["may_lam_duoc"]] == [n["m1"]]
    assert cd["may_lam_duoc"][0]["cong_thuc_gio"] == "sl_vao / 2"
    khai = {r["may_id"]: r["cong_thuc_gio"] for r in cd["may_khai"]}
    assert khai == {n["m1"]: "sl_vao / 2", n["m2"]: "sl_vao * 2"}


def test_tick_them_to_co_ngay_may_cua_to(client, nen_to):
    n = nen_to
    cd = _put(client, n, department_ids=[n["a"], n["b"]])
    assert [r["may_id"] for r in cd["may_lam_duoc"]] == [n["m1"], n["m2"], n["m3"]]
    gio = {r["may_id"]: r["cong_thuc_gio"] for r in cd["may_lam_duoc"]}
    assert gio[n["m2"]] == "sl_vao * 2" and gio[n["m3"]] is None


def test_nhom_may_cho_phep_khong_con_loc_may(db):
    from app.services.bai_ghep_service import BaiGhepService

    cd, m = _cd(db), _may(db)
    cd.nhom_may_cho_phep = ["Bế"]
    db.commit()
    assert BaiGhepService.may_ngoai_cong_doan(cd, m) is False
