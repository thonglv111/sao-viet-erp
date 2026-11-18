"""Người làm từng lần ghi sản lượng (10/10/2026, mg 0386).

Soi luật:
  · phát hành = giao cả tổ (người còn làm), như bấm Giao người cho từng người;
  · hộp Ghi sản lượng: người tổ mình đang được giao, tick sẵn trừ người nghỉ; ghi chú "đang ở" chỉ
    cho việc khác đã Bắt đầu, chưa Kết thúc;
  · người tổ khác sang giúp: tổ thêm thẳng lúc ghi, không ai duyệt (mg 0389); chặn người nghỉ hôm
    đó và người đã nghỉ việc;
  · Sửa số sản lượng đổi được mọi người của lần ghi, kể cả thêm/bỏ người tổ khác;
  · migration chép người cho lần ghi cũ theo luật cũ (khoảng tham gia + hỗ trợ).
"""
from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import text

from app.models.employee import STATUS_ON_LEAVE, STATUS_RESIGNED
from app.models.san_xuat import CV_DANG_CHAY, CV_HOAN_THANH, CV_PHAT_HANH, CV_TAM_DUNG, SanXuatCongViec
from app.models.san_xuat_san_luong import SanXuatBatch, SanXuatBatchNguoi
from app.models.san_xuat_thuc_thi import PC_HOAT_DONG, SanXuatPhanCong
from app.services.san_xuat import board, san_luong, thuc_thi
from app.services.san_xuat.nguoi_ghi import ung_vien_ghi
from app.services.san_xuat.nguoi_trong_me import ngay_cua_me, nguoi_theo_me
from tests.san_xuat_me_fixtures import T0, canh_me, khoang, tao_me
from tests.test_san_xuat_thuc_thi import (  # noqa: F401
    _cvs,
    _emp,
    _phat_hanh_vao_to,
    _to_cong_nhat,
    _to_khoan,
    admin,
    customer,
    db,
    lsx_svc,
    orders,
)


def _authz(db):
    from app.repositories.rbac_repo import RoleRepository
    from app.services.rbac_service import AuthorizationService

    return AuthorizationService(RoleRepository(db))


def _roster(db, cv) -> set[int]:
    return {pc.employee_id for pc in db.query(SanXuatPhanCong).filter_by(cong_viec_id=cv.id, trang_thai=PC_HOAT_DONG)}


def test_phat_hanh_giao_ca_to_tru_nguoi_da_nghi_viec(db, orders, lsx_svc, admin, customer):
    to = _to_khoan(db, admin, ma="TO-NG-PH")
    a = _emp(db, to, "NV-NG-A", ten="Thợ A")
    b = _emp(db, to, "NV-NG-B", ten="Thợ B")
    b.status = STATUS_ON_LEAVE                     # nghỉ dài hạn vẫn có tên, hộp ghi làm mờ
    c = _emp(db, to, "NV-NG-C", ten="Thợ C")
    c.status = STATUS_RESIGNED
    db.commit()
    _phat_hanh_vao_to(db, orders, lsx_svc, admin, customer, to.id)

    for cv in _cvs(db, to):
        assert _roster(db, cv) == {a.id, b.id}


def _canh(db, orders, lsx_svc, admin, customer, ma):
    """Tổ khoán + việc đang chạy + một lần ghi; hai thợ A, B được giao."""
    to, cv, batch = canh_me(db, orders, lsx_svc, admin, customer, ma=ma)
    a = _emp(db, to, f"NV-{ma}-A", ten="Thợ A")
    b = _emp(db, to, f"NV-{ma}-B", ten="Thợ B")
    for e in (a, b):
        db.add(SanXuatPhanCong(cong_viec_id=cv.id, employee_id=e.id, trang_thai=PC_HOAT_DONG))
    db.commit()
    return to, cv, batch, a, b


def _viec_khac(db, cv, trang_thai) -> SanXuatCongViec:
    """Một công việc khác cùng gói, đổi trạng thái theo ý test."""
    khac = SanXuatCongViec(goi_id=cv.goi_id, lsx_id=cv.lsx_id, department_id=cv.department_id,
                           step_key=f"khac-{trang_thai}", ten_cong_doan=f"Việc {trang_thai}",
                           loai_buoc=cv.loai_buoc, trang_thai=trang_thai)
    db.add(khac)
    db.flush()
    return khac


def test_ghi_chu_dang_o_chi_cho_viec_da_bat_dau_chua_ket_thuc(db, orders, lsx_svc, admin, customer):
    _to, cv, _b, a, b = _canh(db, orders, lsx_svc, admin, customer, "NG1")
    for tt in (CV_PHAT_HANH, CV_DANG_CHAY, CV_TAM_DUNG, CV_HOAN_THANH):
        k = _viec_khac(db, cv, tt)
        db.add(SanXuatPhanCong(cong_viec_id=k.id, employee_id=a.id, trang_thai=PC_HOAT_DONG))
    db.commit()

    ds = {n["employee_id"]: n for n in ung_vien_ghi(db, cv, [a.id, b.id], T0.date())}
    assert sorted(v["ten_cong_doan"] for v in ds[a.id]["dang_o"]) == sorted([
        f"Việc {CV_DANG_CHAY}", f"Việc {CV_TAM_DUNG}"])
    assert ds[a.id]["tick_san"] is True               # chỉ ghi chú, vẫn tick
    assert ds[b.id]["dang_o"] == [] and ds[b.id]["tick_san"] is True


def test_nghi_dai_han_mo_khong_tick(db, orders, lsx_svc, admin, customer):
    _to, cv, _b, a, b = _canh(db, orders, lsx_svc, admin, customer, "NG3")
    b.status = STATUS_ON_LEAVE
    db.commit()
    ds = {n["employee_id"]: n for n in ung_vien_ghi(db, cv, [a.id, b.id], T0.date())}
    assert ds[b.id]["nghi"] == "Nghỉ dài hạn" and ds[b.id]["tick_san"] is False


def test_ghi_them_thang_nguoi_to_khac_khong_can_duyet(db, orders, lsx_svc, admin, customer):
    to, cv, _b, a, b = _canh(db, orders, lsx_svc, admin, customer, "NG4")
    to2 = _to_cong_nhat(db, ma="TO-NG4-KHAC")
    giup = _emp(db, to2, "NV-NG4-G", ten="Thợ Giúp")
    moc = T0 + timedelta(hours=2)

    r = tao_me(db, user=admin, cong_viec_id=cv.id, bat_dau=moc, ket_thuc=moc + timedelta(hours=1),
               tong=20, tot=20, nguoi_ids=[b.id, giup.id])
    rows = {x.employee_id: x for x in db.query(SanXuatBatchNguoi).filter_by(batch_id=r["batch_id"])}
    assert set(rows) == {b.id, giup.id}
    # Người tổ khác giữ tổ GỐC lúc ghi — tab Sản lượng của tổ đó thấy lần ghi nhờ cột này.
    assert rows[giup.id].la_ho_tro is True and rows[giup.id].department_id == to2.id
    assert rows[b.id].la_ho_tro is False and rows[b.id].department_id == to.id


def test_ghi_chan_nguoi_nghi_hom_do_nghi_viec_va_bo_tick_het(db, orders, lsx_svc, admin, customer):
    to, cv, _b, a, _b2 = _canh(db, orders, lsx_svc, admin, customer, "NG5")
    to2 = _to_cong_nhat(db, ma="TO-NG5-KHAC")
    nghi = _emp(db, to2, "NV-NG5-N", ten="Thợ Nghỉ")
    nghi.status = STATUS_ON_LEAVE
    thoi = _emp(db, to2, "NV-NG5-T", ten="Thợ Thôi")
    thoi.status = STATUS_RESIGNED
    db.commit()
    moc = T0 + timedelta(hours=2)
    kw = dict(user=admin, cong_viec_id=cv.id, bat_dau=moc, ket_thuc=moc + timedelta(hours=1), tong=5, tot=5)
    with pytest.raises(ValueError, match="Thợ Nghỉ nghỉ hôm đó"):
        tao_me(db, nguoi_ids=[a.id, nghi.id], **kw)
    db.rollback()
    with pytest.raises(ValueError, match="Thợ Thôi đã nghỉ việc"):
        tao_me(db, nguoi_ids=[a.id, thoi.id], **kw)
    db.rollback()
    with pytest.raises(ValueError, match="Chọn ít nhất một người"):
        tao_me(db, nguoi_ids=[], **kw)
    db.rollback()
    # Rút người rồi thì hộp không còn tên họ, lần ghi cũ vẫn giữ tên.
    r = tao_me(db, nguoi_ids=[a.id], **kw)
    pc = db.query(SanXuatPhanCong).filter_by(cong_viec_id=cv.id, employee_id=a.id).one()
    thuc_thi.go_phan_cong(db, user=admin, phan_cong_id=pc.id)
    assert [n["employee_id"] for n in nguoi_theo_me(db, [r["batch_id"]])[r["batch_id"]]] == [a.id]
    d = board.chi_tiet_cong_viec(db, admin, _authz(db), cong_viec_id=cv.id)
    assert a.id not in {n["employee_id"] for n in d["nguoi_ghi"]}


def test_sua_so_them_bo_ca_nguoi_to_khac(db, orders, lsx_svc, admin, customer):
    to, cv, _b, a, b = _canh(db, orders, lsx_svc, admin, customer, "NG6")
    to2 = _to_cong_nhat(db, ma="TO-NG6-KHAC")
    giup = _emp(db, to2, "NV-NG6-G", ten="Thợ Giúp")
    moc = T0 + timedelta(hours=2)
    r = tao_me(db, user=admin, cong_viec_id=cv.id, bat_dau=moc, ket_thuc=moc + timedelta(hours=1),
               tong=20, tot=20, nguoi_ids=[a.id])
    me = db.get(SanXuatBatch, r["batch_id"])

    san_luong.sua_so_me(db, user=admin, batch_id=me.id, tot=20, nguoi_ids=[b.id, giup.id],
                        expected_version=me.version)
    rows = {x.employee_id: x for x in db.query(SanXuatBatchNguoi).filter_by(batch_id=me.id)}
    assert set(rows) == {b.id, giup.id}
    assert rows[giup.id].la_ho_tro is True and rows[giup.id].department_id == to2.id
    with pytest.raises(ValueError, match="chưa đổi gì"):
        san_luong.sua_so_me(db, user=admin, batch_id=me.id, tot=20, nguoi_ids=[giup.id, b.id])
    db.rollback()
    # Bỏ được cả người tổ khác; bỏ hết thì chặn.
    san_luong.sua_so_me(db, user=admin, batch_id=me.id, tot=20, nguoi_ids=[b.id])
    assert {n["employee_id"] for n in nguoi_theo_me(db, [me.id])[me.id]} == {b.id}
    with pytest.raises(ValueError, match="Chọn ít nhất một người"):
        san_luong.sua_so_me(db, user=admin, batch_id=me.id, tot=20, nguoi_ids=[])


def test_migration_chep_nguoi_cho_lan_ghi_cu_theo_luat_cu(db, orders, lsx_svc, admin, customer):
    from app.db_migrations import _migrate_batch_nguoi

    to, cv, batch, a, b = _canh(db, orders, lsx_svc, admin, customer, "NG7")
    to2 = _to_cong_nhat(db, ma="TO-NG7-KHAC")
    giup = _emp(db, to2, "NV-NG7-G", ten="Thợ Giúp")
    db.query(SanXuatBatchNguoi).filter_by(batch_id=batch.id).delete()
    khoang(db, cv, a, batch.bat_dau - timedelta(minutes=10), batch.ket_thuc)    # có mặt
    khoang(db, cv, b, batch.bat_dau - timedelta(hours=1), batch.bat_dau)        # chạm mốc ⇒ không
    # Bảng thỏa thuận hỗ trợ gỡ khỏi model (mg 0389) — dựng lại dạng DB cũ bằng SQL thô.
    db.execute(text("CREATE TABLE san_xuat_ho_tro (id INTEGER PRIMARY KEY, cong_viec_id INTEGER,"
                    " employee_id INTEGER, ngay_lam_viec DATE, trang_thai VARCHAR(16), created_at TIMESTAMP)"))
    db.execute(text("INSERT INTO san_xuat_ho_tro (cong_viec_id, employee_id, ngay_lam_viec, trang_thai,"
                    " created_at) VALUES (:cv, :e, :n, 'confirmed', :c)"),
               {"cv": cv.id, "e": giup.id, "n": ngay_cua_me(batch.bat_dau),
                "c": batch.created_at - timedelta(minutes=5)})
    db.commit()

    _migrate_batch_nguoi(db)
    rows = {x.employee_id: x for x in db.query(SanXuatBatchNguoi).filter_by(batch_id=batch.id)}
    assert set(rows) == {a.id, giup.id}
    assert rows[giup.id].la_ho_tro is True and rows[a.id].la_ho_tro is False
    _migrate_batch_nguoi(db)                               # chạy lại vô hại
    assert db.query(SanXuatBatchNguoi).filter_by(batch_id=batch.id).count() == 2


def test_migration_0389_bo_bang_ho_tro(db):
    from sqlalchemy import inspect

    from app.db_migrations import _migrate_bo_ho_tro_cheo

    db.execute(text("CREATE TABLE san_xuat_ho_tro (id INTEGER PRIMARY KEY)"))
    db.commit()
    _migrate_bo_ho_tro_cheo(db)
    assert "san_xuat_ho_tro" not in inspect(db.get_bind()).get_table_names()
    _migrate_bo_ho_tro_cheo(db)                            # chạy lại vô hại


def test_ghi_san_luong_tung_nguoi_chi_khi_bat_co(db, orders, lsx_svc, admin, customer, monkeypatch):
    """In Hà Phương (cờ `san_luong_tung_nguoi`, 18/11/2026): mỗi người một số, tốt = tổng; sửa lần
    ghi chia lại được giữa người với nhau. Sao Việt Nhật (cờ tắt) gửi số từng người ⇒ bị chặn."""
    from app.config import settings

    to, cv, _b, a, b = _canh(db, orders, lsx_svc, admin, customer, "NG7")
    moc = T0 + timedelta(hours=2)
    kw = dict(user=admin, cong_viec_id=cv.id, bat_dau=moc, ket_thuc=moc + timedelta(hours=1))
    monkeypatch.setattr(settings, "phan_he_bat", "")
    with pytest.raises(ValueError, match="theo số tổng"):
        tao_me(db, tong=30, tot=30, so_luong_nguoi={a.id: 10, b.id: 20}, **kw)
    db.rollback()

    monkeypatch.setattr(settings, "phan_he_bat", "san_luong_tung_nguoi")
    with pytest.raises(ValueError, match="bằng tổng số của từng người"):
        tao_me(db, tong=25, tot=25, so_luong_nguoi={a.id: 10, b.id: 20}, **kw)
    db.rollback()
    r = tao_me(db, tong=32, tot=30, hong=2, so_luong_nguoi={a.id: 10, b.id: 20}, **kw)
    me = db.get(SanXuatBatch, r["batch_id"])
    so = {n["employee_id"]: n["so_luong"] for n in nguoi_theo_me(db, [me.id])[me.id]}
    assert so == {a.id: 10, b.id: 20} and float(me.tot) == 30

    # Cùng tổng, chia lại giữa hai người ⇒ vẫn là một lần sửa.
    san_luong.sua_so_me(db, user=admin, batch_id=me.id, tot=30, so_luong_nguoi={a.id: 15, b.id: 15},
                        expected_version=me.version)
    so = {n["employee_id"]: n["so_luong"] for n in nguoi_theo_me(db, [me.id])[me.id]}
    assert so == {a.id: 15, b.id: 15}
    with pytest.raises(ValueError, match="chưa đổi gì"):
        san_luong.sua_so_me(db, user=admin, batch_id=me.id, tot=30, so_luong_nguoi={a.id: 15, b.id: 15})
    db.rollback()
    # Đổi tổng + bỏ một người.
    san_luong.sua_so_me(db, user=admin, batch_id=me.id, tot=12, so_luong_nguoi={b.id: 12})
    me = db.get(SanXuatBatch, me.id)
    assert float(me.tot) == 12 and float(me.tong) == 14
    assert {n["employee_id"]: n["so_luong"] for n in nguoi_theo_me(db, [me.id])[me.id]} == {b.id: 12}
