"""Đợt 2 — Báo dừng máy ở bàn tổ: ngày dừng máy tổ ăn chỉ tiêu ngày (21/10/2026).

Spec: `docs/superpowers/specs/2026-10-20-hai-luong-khoi-san-xuat-design.md` mục "Đợt 2" ý 5. Giả
định tự chốt: người hưởng do tổ trưởng tick trong hộp, không đọc chấm công; tiền dừng máy không
vào quỹ so chỉ tiêu (tăng ca khoán) và không vào quỹ tổ trưởng."""
from __future__ import annotations

from datetime import date

import pytest

from app.models.payroll import KhoanChiTieuNgay, KhoanDungMay
from app.services.khoan_ky import KhoanKyService, MucKhoan
from app.services.quyen_to import VIEC_THUC_HIEN
from app.services.san_xuat import dung_may
from tests.quyen_to_fixtures import cap_quyen_to
from tests.san_xuat_me_fixtures import tao_user
from tests.test_khoan_dot_2_tinh import _Nen2
from tests.test_khoan_ky import NAM, THANG
from tests.test_san_xuat_thuc_thi import _to_khoan, admin, db  # noqa: F401

NGAY = date(NAM, THANG, 5)


def _canh(db, admin, ma, *, chi_tieu=1_150_000):
    n = _Nen2(db)
    to = _to_khoan(db, admin, ma=ma)
    nhat, linh = n.nv(to, "Nhất"), n.nv(to, "Linh")
    if chi_tieu:
        db.add(KhoanChiTieuNgay(department_id=to.id, ap_dung_tu=date(NAM, 1, 1), so_tien=chi_tieu))
    db.commit()
    return n, to, nhat, linh


def _muc(nhat, linh) -> MucKhoan:
    return MucKhoan(luong_ca_may={nhat.id: 14_000_000, linh.id: 9_000_000})


def test_bao_dung_may_va_tinh_chi_tieu(db, admin):
    n, to, nhat, linh = _canh(db, admin, "TO-DM1")
    r = dung_may.bao(db, user=admin, department_id=to.id, ngay=NGAY, ly_do="may_hu", sua_chua_id=None,
                     ghi_chu="Gãy trục", nguoi_ids=[nhat.id, linh.id])
    assert r["ly_do_ten"] == "Máy hư" and [x["ho_ten"] for x in r["nguoi"]] == ["Nhất", "Linh"]
    kq = KhoanKyService(db).tinh(NAM, THANG, _muc(nhat, linh))
    assert kq["khoan"] == {nhat.id: 700_000, linh.id: 450_000}
    assert kq["tang_ca_khoan"] == {}
    d = next(x for x in kq["theo_nguoi"][nhat.id] if x["loai"] == "dung_may")
    assert d["ly_do"] == "Máy hư" and d["tien_ngay"] == 1_150_000 and d["ghi_chu"] == "Gãy trục"
    assert d["ty_le"] == 0.609 and d["so_nguoi"] == 2
    ds = dung_may.danh_sach(db, user=admin, department_id=to.id, year=NAM, month=THANG)
    assert [x["ngay"] for x in ds["ds"]] == [NGAY]
    assert {x["employee_id"] for x in ds["nguoi"]} == {nhat.id, linh.id}


def test_dung_may_cong_ca_lan_ghi(db, admin):
    n, to, nhat, linh = _canh(db, admin, "TO-DM2")
    k = n.khoan2("gia_co_dinh + sl_ghi * don_gia_khoan", gia_co_dinh=1_150_000)
    n.ghi2(to, k, NGAY, 0, [nhat, linh])
    db.commit()
    dung_may.bao(db, user=admin, department_id=to.id, ngay=NGAY, ly_do="het_hang", sua_chua_id=None,
                 ghi_chu=None, nguoi_ids=[nhat.id, linh.id])
    kq = KhoanKyService(db).tinh(NAM, THANG, _muc(nhat, linh))
    assert kq["khoan"] == {nhat.id: 1_400_000, linh.id: 900_000}
    assert kq["tang_ca_khoan"] == {}          # quỹ so chỉ tiêu chỉ có lần ghi = đúng chỉ tiêu


def test_bao_trung_ngay_bi_chan(db, admin):
    n, to, nhat, linh = _canh(db, admin, "TO-DM3")
    dung_may.bao(db, user=admin, department_id=to.id, ngay=NGAY, ly_do="may_hu", sua_chua_id=None,
                 ghi_chu=None, nguoi_ids=[nhat.id])
    with pytest.raises(ValueError, match="Tổ đã báo dừng máy ngày 05/10"):
        dung_may.bao(db, user=admin, department_id=to.id, ngay=NGAY, ly_do="het_hang", sua_chua_id=None,
                     ghi_chu=None, nguoi_ids=[linh.id])
    db.rollback()
    assert db.query(KhoanDungMay).filter_by(department_id=to.id).count() == 1
    with pytest.raises(ValueError, match="Chọn người hưởng"):
        dung_may.bao(db, user=admin, department_id=to.id, ngay=date(NAM, THANG, 6), ly_do="may_hu",
                     sua_chua_id=None, ghi_chu=None, nguoi_ids=[])
    with pytest.raises(ValueError):
        dung_may.bao(db, user=admin, department_id=to.id, ngay=date(NAM, THANG, 6), ly_do="mat_dien",
                     sua_chua_id=None, ghi_chu=None, nguoi_ids=[nhat.id])
    with pytest.raises(ValueError, match="phiếu sửa"):
        dung_may.bao(db, user=admin, department_id=to.id, ngay=date(NAM, THANG, 6), ly_do="may_hu",
                     sua_chua_id=999_999, ghi_chu=None, nguoi_ids=[nhat.id])


def test_to_chua_khai_chi_tieu_canh_bao(db, admin):
    n, to, nhat, linh = _canh(db, admin, "TO-DM4", chi_tieu=0)
    dung_may.bao(db, user=admin, department_id=to.id, ngay=NGAY, ly_do="may_hu", sua_chua_id=None,
                 ghi_chu=None, nguoi_ids=[nhat.id])
    kq = KhoanKyService(db).tinh(NAM, THANG, _muc(nhat, linh))
    assert kq["khoan"] == {}
    assert any("chưa khai chỉ tiêu ngày" in c and "05/10" in c for c in kq["canh_bao"])


def test_khong_quyen_xac_nhan_bi_chan(db, admin):
    n, to, nhat, linh = _canh(db, admin, "TO-DM5")
    tho = tao_user(db, "tho_dm5")
    cap_quyen_to(db, tho, to, viec=(VIEC_THUC_HIEN,))
    db.commit()
    with pytest.raises(PermissionError):
        dung_may.bao(db, user=tho, department_id=to.id, ngay=NGAY, ly_do="may_hu", sua_chua_id=None,
                     ghi_chu=None, nguoi_ids=[nhat.id])


def test_xoa_dung_may(db, admin):
    n, to, nhat, linh = _canh(db, admin, "TO-DM6")
    r = dung_may.bao(db, user=admin, department_id=to.id, ngay=NGAY, ly_do="may_hu", sua_chua_id=None,
                     ghi_chu=None, nguoi_ids=[nhat.id])
    dung_may.xoa(db, user=admin, dung_may_id=r["id"])
    assert db.get(KhoanDungMay, r["id"]) is None
    assert KhoanKyService(db).tinh(NAM, THANG, _muc(nhat, linh))["khoan"] == {}


def test_api_bao_xem_xoa_qua_schema(client):
    """Route + schema thật (Pydantic nuốt field là im lặng)."""
    from app.db import SessionLocal
    from app.models.department import Department
    from app.models.employee import Employee
    from app.models.user import User

    s = SessionLocal()
    try:
        to = Department(name="Tổ bế API DM", code="TO-DM-API", la_san_xuat=True)
        s.add(to)
        s.flush()
        e = Employee(code="NV-DM-API", full_name="Thợ API", department_id=to.id)
        s.add(e)
        cap_quyen_to(s, s.query(User).filter_by(username="admin").one(), to)
        s.commit()
        to_id, e_id = to.id, e.id
    finally:
        s.close()
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.post(f"/api/san-xuat/teams/{to_id}/dung-may", headers=h,
                    json={"ngay": "2026-10-05", "ly_do": "het_hang", "nguoi_ids": [e_id]})
    assert r.status_code == 200, r.text
    assert r.json()["ly_do_ten"] == "Hết hàng" and r.json()["nguoi"][0]["ho_ten"] == "Thợ API"
    r2 = client.post(f"/api/san-xuat/teams/{to_id}/dung-may", headers=h,
                     json={"ngay": "2026-10-05", "ly_do": "may_hu", "nguoi_ids": [e_id]})
    assert r2.status_code == 400 and "05/10" in r2.json()["detail"]
    ds = client.get(f"/api/san-xuat/teams/{to_id}/dung-may?nam=2026&thang=10", headers=h).json()
    assert [x["ngay"] for x in ds["ds"]] == ["2026-10-05"] and ds["nguoi"][0]["employee_id"] == e_id
    assert ds["ky_da_chot"] == []
    assert client.delete(f"/api/san-xuat/dung-may/{r.json()['id']}", headers=h).status_code == 204


def test_nguoi_huong_phai_thuoc_to_va_khong_bao_ngay_tuong_lai(db, admin):
    from datetime import timedelta

    from app.services.san_xuat.tinh_trang_nguoi import hom_nay

    n, to, nhat, linh = _canh(db, admin, "TO-DM7")
    _, to2, la, _ = _canh(db, admin, "TO-DM7B")
    with pytest.raises(ValueError, match="không thuộc tổ"):
        dung_may.bao(db, user=admin, department_id=to.id, ngay=NGAY, ly_do="may_hu", sua_chua_id=None,
                     ghi_chu=None, nguoi_ids=[nhat.id, la.id])
    with pytest.raises(ValueError, match="chưa tới"):
        dung_may.bao(db, user=admin, department_id=to.id, ngay=hom_nay() + timedelta(days=1),
                     ly_do="may_hu", sua_chua_id=None, ghi_chu=None, nguoi_ids=[nhat.id])


def test_to_cha_khong_bao_dung_may(db, admin):
    from app.models.department import Department

    n, to, nhat, linh = _canh(db, admin, "TO-DM8")
    db.add(Department(name="Tổ con TO-DM8", code="TO-DM8-C", la_san_xuat=True, parent_id=to.id))
    db.commit()
    with pytest.raises(ValueError, match="tổ cha"):
        dung_may.bao(db, user=admin, department_id=to.id, ngay=NGAY, ly_do="may_hu", sua_chua_id=None,
                     ghi_chu=None, nguoi_ids=[nhat.id])


def test_bao_dua_hai_lan_tra_cau_loi_khong_500(db, admin, monkeypatch):
    """Hai lần bấm Lưu đua nhau: cả hai cùng qua bước kiểm trùng, lần sau đụng UNIQUE ở DB."""
    from app.repositories.dung_may_repo import DungMayRepository

    n, to, nhat, linh = _canh(db, admin, "TO-DM9")
    dung_may.bao(db, user=admin, department_id=to.id, ngay=NGAY, ly_do="may_hu", sua_chua_id=None,
                 ghi_chu=None, nguoi_ids=[nhat.id])
    monkeypatch.setattr(DungMayRepository, "cua_to_ngay", lambda self, d, ng: None)
    with pytest.raises(ValueError, match="Tổ đã báo dừng máy ngày 05/10"):
        dung_may.bao(db, user=admin, department_id=to.id, ngay=NGAY, ly_do="het_hang", sua_chua_id=None,
                     ghi_chu=None, nguoi_ids=[linh.id])
    assert db.query(KhoanDungMay).filter_by(department_id=to.id).count() == 1


def test_xoa_dong_cua_to_khac_bi_chan(db, admin):
    n, to, nhat, linh = _canh(db, admin, "TO-DM10")
    r = dung_may.bao(db, user=admin, department_id=to.id, ngay=NGAY, ly_do="may_hu", sua_chua_id=None,
                     ghi_chu=None, nguoi_ids=[nhat.id])
    _, to2, _, _ = _canh(db, admin, "TO-DM10B")
    to_truong_khac = tao_user(db, "tt_dm10")
    cap_quyen_to(db, to_truong_khac, to2)
    db.commit()
    with pytest.raises(PermissionError):
        dung_may.xoa(db, user=to_truong_khac, dung_may_id=r["id"])
    assert db.get(KhoanDungMay, r["id"]) is not None


def test_api_xoa_dong_khong_ton_tai_404(client):
    from app.db import SessionLocal
    from app.models.department import Department
    from app.models.user import User

    s = SessionLocal()
    try:
        to = Department(name="Tổ DM 404", code="TO-DM-404", la_san_xuat=True)
        s.add(to)
        s.flush()
        cap_quyen_to(s, s.query(User).filter_by(username="admin").one(), to)
        s.commit()
    finally:
        s.close()
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.delete("/api/san-xuat/dung-may/999999", headers=h).status_code == 404


def test_sua_dung_may_doi_nguoi_huong_ly_do_ghi_chu(db, admin):
    """Tổ trưởng tick nhầm thì sửa tại chỗ — giữ ngày, đổi người hưởng / lý do / phiếu / ghi chú."""
    n, to, nhat, linh = _canh(db, admin, "TO-DM11")
    r = dung_may.bao(db, user=admin, department_id=to.id, ngay=NGAY, ly_do="may_hu", sua_chua_id=None,
                     ghi_chu=None, nguoi_ids=[nhat.id])
    ra = dung_may.sua(db, user=admin, dung_may_id=r["id"], ly_do="het_hang", sua_chua_id=None,
                      ghi_chu="hết giấy", nguoi_ids=[nhat.id, linh.id])
    assert ra["id"] == r["id"] and ra["ngay"] == NGAY and ra["ly_do"] == "het_hang"
    assert ra["ghi_chu"] == "hết giấy" and [x["employee_id"] for x in ra["nguoi"]] == [nhat.id, linh.id]
    kq = KhoanKyService(db).tinh(NAM, THANG, _muc(nhat, linh))
    assert kq["khoan"] == {nhat.id: 700_000, linh.id: 450_000}
    with pytest.raises(ValueError, match="không thuộc tổ"):
        _, to2, la, _ = _canh(db, admin, "TO-DM11B")
        dung_may.sua(db, user=admin, dung_may_id=r["id"], ly_do="het_hang", sua_chua_id=None,
                     ghi_chu=None, nguoi_ids=[la.id])
    with pytest.raises(ValueError, match="Chọn người hưởng"):
        dung_may.sua(db, user=admin, dung_may_id=r["id"], ly_do="het_hang", sua_chua_id=None,
                     ghi_chu=None, nguoi_ids=[])


def test_sua_dung_may_can_quyen_xac_nhan(db, admin):
    n, to, nhat, linh = _canh(db, admin, "TO-DM12")
    r = dung_may.bao(db, user=admin, department_id=to.id, ngay=NGAY, ly_do="may_hu", sua_chua_id=None,
                     ghi_chu=None, nguoi_ids=[nhat.id])
    tho = tao_user(db, "tho_dm12")
    cap_quyen_to(db, tho, to, viec=(VIEC_THUC_HIEN,))
    db.commit()
    with pytest.raises(PermissionError):
        dung_may.sua(db, user=tho, dung_may_id=r["id"], ly_do="het_hang", sua_chua_id=None,
                     ghi_chu=None, nguoi_ids=[nhat.id])
    with pytest.raises(dung_may.KhongThayDungMay):
        dung_may.sua(db, user=admin, dung_may_id=999_999, ly_do="het_hang", sua_chua_id=None,
                     ghi_chu=None, nguoi_ids=[nhat.id])


def test_api_sua_dung_may_qua_schema(client):
    from app.db import SessionLocal
    from app.models.department import Department
    from app.models.employee import Employee
    from app.models.user import User

    s = SessionLocal()
    try:
        to = Department(name="Tổ DM sửa API", code="TO-DM-SUA", la_san_xuat=True)
        s.add(to)
        s.flush()
        a = Employee(code="NV-DM-SUA-A", full_name="Thợ A", department_id=to.id)
        b = Employee(code="NV-DM-SUA-B", full_name="Thợ B", department_id=to.id)
        s.add_all([a, b])
        cap_quyen_to(s, s.query(User).filter_by(username="admin").one(), to)
        s.commit()
        to_id, a_id, b_id = to.id, a.id, b.id
    finally:
        s.close()
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.post(f"/api/san-xuat/teams/{to_id}/dung-may", headers=h,
                    json={"ngay": "2026-10-05", "ly_do": "may_hu", "nguoi_ids": [a_id]})
    r2 = client.put(f"/api/san-xuat/dung-may/{r.json()['id']}", headers=h,
                    json={"ly_do": "het_hang", "ghi_chu": "sửa", "nguoi_ids": [a_id, b_id]})
    assert r2.status_code == 200, r2.text
    assert r2.json()["ly_do_ten"] == "Hết hàng" and len(r2.json()["nguoi"]) == 2
    assert client.put("/api/san-xuat/dung-may/999999", headers=h,
                      json={"ly_do": "het_hang", "nguoi_ids": [a_id]}).status_code == 404


@pytest.mark.parametrize("trang_thai, chu", [("locked", "đã chốt"), ("paid", "đã chi")])
def test_ky_luong_da_chot_khong_bao_sua_xoa(db, admin, trang_thai, chu):
    from app.models.payroll import PayrollPeriod

    n, to, nhat, linh = _canh(db, admin, f"TO-DM13-{trang_thai}")
    r = dung_may.bao(db, user=admin, department_id=to.id, ngay=NGAY, ly_do="may_hu", sua_chua_id=None,
                     ghi_chu=None, nguoi_ids=[nhat.id])
    ky = PayrollPeriod(year=NAM, month=THANG, status=trang_thai)
    db.add(ky)
    db.commit()
    cau = f"Kỳ lương tháng {THANG:02d}/{NAM} {chu}"
    with pytest.raises(ValueError, match=cau):
        dung_may.bao(db, user=admin, department_id=to.id, ngay=date(NAM, THANG, 6), ly_do="may_hu",
                     sua_chua_id=None, ghi_chu=None, nguoi_ids=[nhat.id])
    with pytest.raises(ValueError, match=cau):
        dung_may.sua(db, user=admin, dung_may_id=r["id"], ly_do="het_hang", sua_chua_id=None,
                     ghi_chu=None, nguoi_ids=[nhat.id, linh.id])
    with pytest.raises(ValueError, match=cau):
        dung_may.xoa(db, user=admin, dung_may_id=r["id"])
    assert db.get(KhoanDungMay, r["id"]).ly_do == "may_hu"
    ds = dung_may.danh_sach(db, user=admin, department_id=to.id, year=NAM, month=THANG)
    assert ds["ky_da_chot"] == [f"{NAM}-{THANG:02d}"]
    ky.status = "draft"
    db.commit()
    assert dung_may.danh_sach(db, user=admin, department_id=to.id, year=NAM, month=THANG)["ky_da_chot"] == []
    dung_may.xoa(db, user=admin, dung_may_id=r["id"])


def test_phieu_sua_chi_lay_may_cua_to(db, admin):
    """Máy chưa gắn tổ ⇒ máy của tổ = máy các việc của tổ đã nhận (`san_xuat_cong_viec.may_id`)."""
    from datetime import datetime, timezone

    from app.models.ky_thuat_may import SuaChuaMay
    from app.models.san_xuat import SanXuatCongViec

    n, to, nhat, linh = _canh(db, admin, "TO-DM14")
    _, to2, _, _ = _canh(db, admin, "TO-DM14B")
    db.add_all([
        SanXuatCongViec(goi_id=n.goi.id, department_id=to.id, ten_cong_doan="Bế", may_id=9_101),
        SanXuatCongViec(goi_id=n.goi.id, department_id=to2.id, ten_cong_doan="In", may_id=9_102),
    ])
    luc = datetime(NAM, THANG, 4, 3, 0, tzinfo=timezone.utc)
    db.add_all([SuaChuaMay(ma="SC-DM14-1", may_id=9_101, bo_phan_hong="Dao bế", thoi_diem=luc),
                 SuaChuaMay(ma="SC-DM14-2", may_id=9_102, bo_phan_hong="Lô mực", thoi_diem=luc)])
    db.commit()
    ds = dung_may.danh_sach(db, user=admin, department_id=to.id, year=NAM, month=THANG)
    assert [p["ma"] for p in ds["phieu_sua"]] == ["SC-DM14-1"]
    khac = db.query(SuaChuaMay).filter_by(ma="SC-DM14-2").one()
    with pytest.raises(ValueError, match="không phải máy của tổ"):
        dung_may.bao(db, user=admin, department_id=to.id, ngay=NGAY, ly_do="may_hu", sua_chua_id=khac.id,
                     ghi_chu=None, nguoi_ids=[nhat.id])
