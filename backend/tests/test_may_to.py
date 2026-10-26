"""Máy thuộc tổ (spec 2026-10-22-may-thuoc-to): một máy thuộc NHIỀU tổ, công đoạn lấy máy qua các
tổ đã tick. `CongDoan.may_khai` là mọi dòng `cong_doan_may` đã khai (kể cả dòng nằm im vì máy ra
khỏi phạm vi tổ); `CongDoan.may_lam_duoc` là phần đang hiệu lực — đọc ở mọi nơi.
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import selectinload, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — đăng ký metadata
from app.db import Base
from app.models.cong_doan import CongDoan, CongDoanMay
from app.models.department import Department
from app.models.may_thiet_bi import MayThietBi, MayTo


@pytest.fixture()
def db():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    s = sessionmaker(bind=eng)()
    yield s
    s.close()


def _to(db, ma: str) -> Department:
    d = Department(name=f"Tổ {ma}", code=ma, la_san_xuat=True)
    db.add(d)
    db.flush()
    return d


def _may(db, ma: str, *to_ids: int, active: bool = True) -> MayThietBi:
    m = MayThietBi(ma=ma, ten=f"Máy {ma}", loai_may="Máy in", active=active)
    db.add(m)
    db.flush()
    for t in to_ids:
        db.add(MayTo(may_id=m.id, department_id=t))
    db.flush()
    return m


def _cd(db, to_ids: list[int], mays: list[MayThietBi], ma: str = "IN") -> CongDoan:
    cd = CongDoan(ma=ma, ten="In", nhom="print")
    db.add(cd)
    db.flush()
    cd.department_ids = to_ids
    for i, m in enumerate(mays):
        cd.may_khai.append(CongDoanMay(may_id=m.id, thu_tu=i, cong_thuc_gio="sl_vao"))
    db.commit()
    db.expire_all()
    return cd


def test_may_lam_duoc_loc_theo_to(db):
    a, b = _to(db, "A"), _to(db, "B")
    m1, m2 = _may(db, "M1", a.id), _may(db, "M2", b.id)
    cd = _cd(db, [a.id], [m1, m2])
    assert [r.may_id for r in cd.may_lam_duoc] == [m1.id]
    assert {r.may_id for r in cd.may_khai} == {m1.id, m2.id}


def test_may_hai_to_cung_tick_mot_dong(db):
    a, b = _to(db, "A"), _to(db, "B")
    m = _may(db, "M", a.id, b.id)
    cd = _cd(db, [a.id, b.id], [m])
    assert [r.may_id for r in cd.may_lam_duoc] == [m.id]


def test_cong_doan_khong_tick_to_giu_hanh_vi_cu(db):
    a = _to(db, "A")
    m1, m2 = _may(db, "M1", a.id), _may(db, "M2")
    cd = _cd(db, [], [m1, m2])
    assert [r.may_id for r in cd.may_lam_duoc] == [m1.id, m2.id]


def test_bo_tick_roi_tick_lai_giu_cong_thuc(db):
    a, b = _to(db, "A"), _to(db, "B")
    m1 = _may(db, "M1", a.id)
    cd = _cd(db, [a.id], [m1])
    cd.department_ids = [b.id]
    db.commit()
    db.expire_all()
    assert cd.may_lam_duoc == []
    cd.department_ids = [a.id]
    db.commit()
    db.expire_all()
    assert [r.may_id for r in cd.may_lam_duoc] == [m1.id]
    assert cd.may_lam_duoc[0].cong_thuc_gio == "sl_vao"


def test_selectinload_may_lam_duoc(db):
    a, b = _to(db, "A"), _to(db, "B")
    m1, m2 = _may(db, "M1", a.id), _may(db, "M2", b.id)
    _cd(db, [a.id], [m1, m2], ma="IN-1")
    _cd(db, [b.id], [m1, m2], ma="IN-2")
    _cd(db, [], [m1, m2], ma="IN-3")
    m1_id, m2_id = m1.id, m2.id
    db.expunge_all()
    rows = db.execute(select(CongDoan).options(selectinload(CongDoan.may_lam_duoc))
                      .order_by(CongDoan.ma)).scalars().all()
    assert [[r.may_id for r in cd.may_lam_duoc] for cd in rows] == [[m1_id], [m2_id], [m1_id, m2_id]]


def test_may_to_ids_doc_ghi(db):
    a, b = _to(db, "A"), _to(db, "B")
    m = _may(db, "M", a.id)
    db.commit()
    db.expire_all()
    assert m.to_ids == [a.id]
    m.to_ids = [a.id, b.id]
    db.commit()
    db.expire_all()
    assert sorted(m.to_ids) == sorted([a.id, b.id])


# ---------------------------------------------------------------- luật cặp tổ × máy (services/may_to)
from app.services import may_to as luat  # noqa: E402


def _bo(db):
    """Công đoạn In tick [A, B]; M1 thuộc A, M2 thuộc B, M3 thuộc A nhưng ngừng dùng, MC thuộc cả
    A lẫn B. Thứ tự bảng: M1, M3, MC, M2."""
    a, b = _to(db, "A"), _to(db, "B")
    m1, m2 = _may(db, "M1", a.id), _may(db, "M2", b.id)
    m3 = _may(db, "M3", a.id, active=False)
    mc = _may(db, "MC", a.id, b.id)
    cd = _cd(db, [a.id, b.id], [m1, m3, mc, m2])
    return cd, a, b, m1, m2, m3, mc


def test_may_chon_duoc_theo_to(db):
    cd, a, b, m1, m2, m3, mc = _bo(db)
    assert luat.may_chon_duoc(db, cd, a.id) == [m1.id, mc.id]
    assert luat.may_chon_duoc(db, cd, b.id) == [mc.id, m2.id]


def test_may_chon_duoc_khong_rang_buoc_to(db):
    a = _to(db, "A")
    m1, m2 = _may(db, "M1"), _may(db, "M2")
    cd = _cd(db, [], [m1, m2])
    assert luat.rang_buoc_to(cd) is False
    assert luat.may_chon_duoc(db, cd, a.id) == [m1.id, m2.id]
    assert luat.may_chon_duoc(db, None, a.id) == []


def test_may_mac_dinh_cua_to(db):
    cd, a, b, m1, m2, m3, mc = _bo(db)
    assert luat.may_mac_dinh(db, cd, b.id) == mc.id
    c = _to(db, "C")
    cd.department_ids = [a.id, b.id, c.id]
    db.commit()
    db.expire_all()
    assert luat.may_mac_dinh(db, cd, c.id) is None


def test_to_cho_may(db):
    cd, a, b, m1, m2, m3, mc = _bo(db)
    assert luat.to_cho_may(db, cd, m2.id, uu_tien=a.id) == b.id
    assert luat.to_cho_may(db, cd, mc.id, uu_tien=b.id) == b.id
    assert luat.to_cho_may(db, cd, mc.id, uu_tien=None) == a.id
    m_ngoai = _may(db, "MX")
    assert luat.to_cho_may(db, cd, m_ngoai.id, uu_tien=a.id) is None


def test_loi_cap(db):
    cd, a, b, m1, m2, m3, mc = _bo(db)
    assert luat.loi_cap(db, cd, a.id, m2.id) == "Máy M2 không thuộc Tổ A. Chọn máy của Tổ A hoặc đổi tổ."
    assert luat.loi_cap(db, cd, a.id, m1.id) is None
    assert luat.loi_cap(db, cd, None, m2.id) is None
    assert luat.loi_cap(db, cd, a.id, None) is None
    cd_tu_do = _cd(db, [], [m1, m2], ma="TD")
    assert luat.loi_cap(db, cd_tu_do, a.id, m2.id) is None


def test_to_cua_may_va_ten_to(db):
    cd, a, b, m1, m2, m3, mc = _bo(db)
    assert luat.to_cua_may(db, [m1.id, mc.id]) == {m1.id: [a.id], mc.id: [a.id, b.id]}
    assert luat.ten_to(db, [a.id]) == {a.id: "Tổ A"}


def test_dong_bo_cong_doan_may_tao_dong_thieu(db):
    a = _to(db, "A")
    m1 = _may(db, "M1", a.id)
    cd = _cd(db, [a.id], [m1])
    m_moi = _may(db, "M9", a.id)
    db.commit()
    assert luat.dong_bo_cong_doan_may(db, may_ids=[m_moi.id]) == 1
    db.commit()
    assert luat.dong_bo_cong_doan_may(db, may_ids=[m_moi.id]) == 0
    db.expire_all()
    assert [r.may_id for r in cd.may_lam_duoc] == [m1.id, m_moi.id]
    assert cd.may_lam_duoc[1].cong_thuc_gio is None


def test_dong_bo_theo_cong_doan(db):
    a, b = _to(db, "A"), _to(db, "B")
    m1, m2 = _may(db, "M1", a.id), _may(db, "M2", b.id)
    cd = _cd(db, [a.id], [m1])
    cd.department_ids = [a.id, b.id]
    db.commit()
    assert luat.dong_bo_cong_doan_may(db, cong_doan_ids=[cd.id]) == 1
    db.commit()
    db.expire_all()
    assert [r.may_id for r in cd.may_lam_duoc] == [m1.id, m2.id]
