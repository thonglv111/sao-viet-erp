"""Guard chống N+1 ở bàn tổ Sản xuất (26/10/2026).

Bàn tổ dựng số "đã nhận / lỗi" cho từng việc qua `dau_vao.tran_nhan` → `nhom_truoc` →
`cong_viec_chang_truoc`: 4 câu SQL MỖI việc, một trang 50 lệnh là 230 câu (1,2 s trên bản sao). Bản
nạp gộp (`cong_viec_chang_truoc_nhieu` + `dau_vao.NapTruoc`) phải cho ĐÚNG kết quả của bản từng
việc, và số câu của một trang không được tăng theo số lệnh.
"""
from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import event

from app.db import engine
from app.models.bai_ghep_cong_doan import BaiGhepCongDoanMap
from app.models.lsx import LsxCongDoanPhuThuoc
from app.models.san_xuat import SanXuatCongViec, SanXuatPhuThuoc
from app.repositories.rbac_repo import RoleRepository
from app.repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from app.services.rbac_service import AuthorizationService
from app.services.san_xuat import board, dau_vao

from tests.test_san_xuat_ban_giao import _buoc, _viec  # noqa: F401
from tests.test_san_xuat_dau_vao import _cung_lenh, _giao, _giao_nhan, _khac_to
from tests.test_san_xuat_thuc_thi import (  # noqa: F401
    _phat_hanh_vao_to,
    _to_khoan,
    admin,
    customer,
    db,
    lsx_svc,
    orders,
)


@contextmanager
def dem_sql():
    dem = {"n": 0}

    def _nghe(*_a, **_k):
        dem["n"] += 1

    event.listen(engine, "before_cursor_execute", _nghe)
    try:
        yield dem
    finally:
        event.remove(engine, "before_cursor_execute", _nghe)


def _moi_viec(db) -> list[SanXuatCongViec]:
    return db.query(SanXuatCongViec).order_by(SanXuatCongViec.id).all()


def _khop_chang_truoc(db) -> None:
    repo = SanXuatSanLuongRepository(db)
    cvs = _moi_viec(db)
    gop = repo.cong_viec_chang_truoc_nhieu(cvs)
    for cv in cvs:
        assert [c.id for c in gop[cv.id]] == [c.id for c in repo.cong_viec_chang_truoc(cv)], cv.id


def test_chang_truoc_nhieu_khop_tung_viec(db, orders, lsx_svc, admin, customer):
    """Thứ tự bảng, cạnh routing, bước tách lần chạy, bước ghép bài — bản gộp trả ĐÚNG danh sách
    (cả thứ tự) như bản từng việc, trước và sau khi khai cạnh."""
    to = _to_khoan(db, admin, ma="TO-N1A")
    a, b, goi = _phat_hanh_vao_to(db, orders, lsx_svc, admin, customer, to.id)
    x, y, z = (_buoc(db, a.id, 900 + i, t) for i, t in enumerate(("X", "Y", "Z")))
    vx = _viec(db, goi.id, a.id, x)
    _viec(db, goi.id, a.id, y)
    _viec(db, goi.id, a.id, z, 1, 2)
    _viec(db, goi.id, a.id, z, 2, 2)
    # Bước chung của bài ghép gom bước Y: việc của nó có chặng trước là X, và Z nhận cả việc ghép.
    db.add(BaiGhepCongDoanMap(bai_ghep_cong_doan_id=7777, lsx_id=a.id, lsx_step_key=y.step_key))
    db.add(SanXuatCongViec(goi_id=goi.id, nhom_id=vx.nhom_id, bai_ghep_cong_doan_id=7777, phan_doan_so=1, phan_doan_tong=1,
                           ten_cong_doan="Y ghép", trang_thai="released"))
    db.commit()
    _khop_chang_truoc(db)

    db.add(LsxCongDoanPhuThuoc(buoc_truoc_id=x.id, buoc_sau_id=z.id))
    db.commit()
    _khop_chang_truoc(db)
    assert b.id  # lệnh thứ hai của gói cũng nằm trong tập so ở trên


def test_tran_nhan_nap_truoc_khop_tung_viec(db, orders, lsx_svc, admin, customer):
    """Cùng tổ (trần bám sản lượng), khác tổ (trần bám bàn giao đã chốt), cạnh phụ thuộc chéo —
    `tran_nhan` đọc qua `NapTruoc` ra đúng số như đọc thẳng repo."""
    _to, cv1, cv2 = _cung_lenh(db, orders, lsx_svc, admin, customer, ma="TO-N1B")
    _giao(db, admin, cv1, cv2, 300)
    _ta, _tb, u_b, k1, k2 = _khac_to(db, orders, lsx_svc, admin, customer, he_so=2.0, ma="TO-N1C")
    _giao_nhan(db, admin, u_b, k1, k2, 120)
    db.add(SanXuatPhuThuoc(goi_id=k2.goi_id, nhom_id=k2.nhom_id, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=k2.id))
    db.commit()

    repo = SanXuatSanLuongRepository(db)
    cvs = _moi_viec(db)
    nap = dau_vao.NapTruoc(repo, cvs)
    for cv in cvs:
        assert dau_vao.tran_nhan(db, cv, repo=nap) == dau_vao.tran_nhan(db, cv, repo=repo), cv.id
        assert ([[c.id for c in g] for g in dau_vao.nhom_truoc(nap, cv)]
                == [[c.id for c in g] for g in dau_vao.nhom_truoc(repo, cv)]), cv.id


def test_ban_to_so_cau_sql_khong_tang_theo_so_lenh(db, orders, lsx_svc, admin, customer):
    to = _to_khoan(db, admin, ma="TO-N1D")
    _phat_hanh_vao_to(db, orders, lsx_svc, admin, customer, to.id)
    authz = AuthorizationService(RoleRepository(db))

    def _do() -> int:
        db.expire_all()
        with dem_sql() as d:
            kq = board.work_items(db, admin, authz, team_id=to.id, co_trang=50)
        assert kq["lenh"]
        return d["n"]

    it = _do()
    for _ in range(3):
        _phat_hanh_vao_to(db, orders, lsx_svc, admin, customer, to.id)
    nhieu = _do()
    assert nhieu <= it + 3, (it, nhieu)
