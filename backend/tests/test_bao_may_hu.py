"""Báo dừng máy gộp Báo sự cố (23/10/2026, mockup `docs/mockups/bao-dung-may-gop.html`).

Bàn tổ còn MỘT nút "Báo dừng máy" (người giữ Xác nhận sản lượng trọn tổ). Chọn Máy hư hôm nay: gửi
yêu cầu vào hộp thư "Báo máy hỏng" của tổ sửa chữa, tick "Máy đang dừng" thì tạm dừng việc đang chạy
trên máy đó, tick "Tính ngày dừng cho lương" thì ghi luôn ngày dừng (dòng G của sổ khoán). Máy đã có
yêu cầu / phiếu sửa đang mở thì gắn vào cái đang mở, không đẻ trùng."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.models.ky_thuat_may import (
    MUC_DO_NGHIEM_TRONG,
    MUC_DO_NHE,
    SuaChuaMay,
    YeuCauSuaChua,
)
from app.models.may_thiet_bi import MayTo
from app.models.payroll import KhoanDungMay
from app.models.san_xuat import CV_DANG_CHAY, CV_TAM_DUNG, SanXuatCongViec
from app.services.quyen_to import VIEC_THUC_HIEN
from app.services.san_xuat import dung_may
from app.services.san_xuat.tinh_trang_nguoi import hom_nay
from tests.quyen_to_fixtures import cap_quyen_to
from tests.san_xuat_me_fixtures import tao_user
from tests.test_san_xuat_su_co import _may, _mot_cong_viec

from tests.test_san_xuat_board import (  # noqa: F401
    _authz, _phat_hanh_vao_to, admin, customer, db, lsx_svc, orders,
)


@pytest.fixture
def cv(db, orders, lsx_svc, admin, customer) -> SanXuatCongViec:
    """Tổ khoán + một việc đang chạy trên máy MHU-1, hai thợ của tổ."""
    m = _may(db, "MHU-1")
    return _mot_cong_viec(db, orders, lsx_svc, admin, customer, ma="TO-MHU", may_id=m.id, so_nguoi=2)


def _nguoi(db, cv) -> list[int]:
    from app.models.employee import Employee

    return [e.id for e in db.query(Employee).filter_by(department_id=cv.department_id).order_by(Employee.id)]


def _bao(db, user, cv, **kw):
    kw.setdefault("may_id", cv.may_id)
    kw.setdefault("muc_do", MUC_DO_NGHIEM_TRONG)
    kw.setdefault("mo_ta", None)
    kw.setdefault("dung_san_xuat", False)
    kw.setdefault("tinh_luong", False)
    kw.setdefault("ghi_chu", None)
    kw.setdefault("nguoi_ids", [])
    return dung_may.bao_may_hu(db, user=user, department_id=cv.department_id, **kw)


def test_may_hu_gui_yeu_cau_neo_viec_va_tam_dung(db, admin, cv):
    kq = _bao(db, admin, cv, mo_ta="Kêu to ở tốc độ cao", dung_san_xuat=True)
    yc = db.query(YeuCauSuaChua).one()
    assert (yc.may_id, yc.cong_viec_id, yc.lsx_id) == (cv.may_id, cv.id, cv.lsx_id)
    assert yc.may_dung is True and yc.mo_ta == "Kêu to ở tốc độ cao"
    assert cv.trang_thai == CV_TAM_DUNG
    assert kq["yeu_cau_ma"] == yc.ma and kq["moi"] is True and kq["tam_dung"] == [cv.id]
    assert kq["dung_may"] is None and db.query(KhoanDungMay).count() == 0


def test_may_hu_khong_tick_may_dung_thi_viec_van_chay(db, admin, cv):
    kq = _bao(db, admin, cv, muc_do=MUC_DO_NHE)
    assert cv.trang_thai == CV_DANG_CHAY and kq["tam_dung"] == []
    assert db.query(YeuCauSuaChua).one().may_dung is False


def test_may_hu_tinh_luong_ghi_ngay_dung_hom_nay_gan_yeu_cau(db, admin, cv):
    ids = _nguoi(db, cv)
    kq = _bao(db, admin, cv, tinh_luong=True, nguoi_ids=ids, ghi_chu="Gãy trục")
    r = db.query(KhoanDungMay).one()
    yc = db.query(YeuCauSuaChua).one()
    assert (r.ngay, r.ly_do, r.yeu_cau_id, r.ghi_chu) == (hom_nay(), "may_hu", yc.id, "Gãy trục")
    assert sorted(r.nguoi_ids) == sorted(ids)
    assert kq["dung_may"]["yeu_cau_ma"] == yc.ma
    ds = dung_may.danh_sach(db, user=admin, department_id=cv.department_id,
                            year=hom_nay().year, month=hom_nay().month)
    assert ds["ds"][0]["yeu_cau_ma"] == yc.ma


def test_may_hu_tinh_luong_trung_ngay_thi_khong_ghi_gi(db, admin, cv):
    """Tổ đã có ngày dừng hôm nay ⇒ chặn TRƯỚC khi gửi yêu cầu: lỗi giữa chừng không được để lại
    một yêu cầu sửa đã gửi mà ngày dừng không ghi."""
    ids = _nguoi(db, cv)
    dung_may.bao(db, user=admin, department_id=cv.department_id, ngay=hom_nay(), ly_do="het_hang",
                 sua_chua_id=None, ghi_chu=None, nguoi_ids=ids)
    with pytest.raises(ValueError, match="đã báo dừng máy"):
        _bao(db, admin, cv, tinh_luong=True, nguoi_ids=ids, dung_san_xuat=True)
    assert db.query(YeuCauSuaChua).count() == 0 and cv.trang_thai == CV_DANG_CHAY


def test_may_da_co_yeu_cau_cho_tiep_nhan_thi_khong_tao_trung(db, admin, cv):
    dau = _bao(db, admin, cv, muc_do=MUC_DO_NHE)
    lai = _bao(db, admin, cv, dung_san_xuat=True)
    yc = db.query(YeuCauSuaChua).one()
    assert lai["moi"] is False and lai["yeu_cau_ma"] == dau["yeu_cau_ma"] == yc.ma
    # Lần sau nói máy đã dừng hẳn ⇒ yêu cầu đang chờ lên ưu tiên (cờ `may_dung` là thứ xếp hàng chờ).
    assert yc.may_dung is True and cv.trang_thai == CV_TAM_DUNG


def test_may_dang_co_phieu_cho_sua_thi_gan_phieu_khong_gui_yeu_cau(db, admin, cv):
    sc = SuaChuaMay(ma="SC-MHU-1", may_id=cv.may_id, bo_phan_hong="Lô mực",
                    thoi_diem=datetime.now(timezone.utc))
    db.add(sc)
    db.commit()
    kq = _bao(db, admin, cv, tinh_luong=True, nguoi_ids=_nguoi(db, cv), dung_san_xuat=True)
    assert db.query(YeuCauSuaChua).count() == 0
    assert kq["yeu_cau_ma"] is None and kq["phieu_ma"] == "SC-MHU-1"
    assert db.query(KhoanDungMay).one().sua_chua_id == sc.id
    assert cv.trang_thai == CV_TAM_DUNG


def test_may_hu_chi_nhan_may_cua_to(db, admin, cv):
    khac = _may(db, "MHU-KHAC")
    with pytest.raises(ValueError, match="không phải máy của tổ"):
        _bao(db, admin, cv, may_id=khac.id)
    db.add(MayTo(may_id=khac.id, department_id=cv.department_id))
    db.commit()
    kq = _bao(db, admin, cv, may_id=khac.id)
    yc = db.query(YeuCauSuaChua).one()
    # Máy thuộc tổ mà không chạy việc nào của tổ ⇒ yêu cầu không neo việc.
    assert kq["tam_dung"] == [] and (yc.cong_viec_id, yc.lsx_id) == (None, None)


def test_may_hu_can_quyen_xac_nhan_tron_to(db, admin, cv):
    tho = tao_user(db, "tho_mhu")
    from app.models.department import Department

    cap_quyen_to(db, tho, db.get(Department, cv.department_id), viec=(VIEC_THUC_HIEN,))
    db.commit()
    with pytest.raises(PermissionError):
        _bao(db, tho, cv)
    assert db.query(YeuCauSuaChua).count() == 0


def test_danh_sach_tra_may_cua_to_kem_viec_va_phieu_dang_mo(db, admin, cv):
    rieng = _may(db, "MHU-RIENG")
    db.add(MayTo(may_id=rieng.id, department_id=cv.department_id))
    db.commit()
    _bao(db, admin, cv)
    ds = dung_may.danh_sach(db, user=admin, department_id=cv.department_id,
                            year=hom_nay().year, month=hom_nay().month)
    may = {m["id"]: m for m in ds["may"]}
    # Máy có việc đang chạy đứng đầu, rồi máy thuộc tổ (dàn cảnh phát hành đã gắn sẵn một máy in).
    assert list(may)[0] == cv.may_id and list(may)[-1] == rieng.id
    assert cv.ten_cong_doan in may[cv.may_id]["viec"]
    assert may[cv.may_id]["dang_mo"] == db.query(YeuCauSuaChua).one().ma
    assert may[rieng.id]["viec"] is None and may[rieng.id]["dang_mo"] is None
    assert ds["hom_nay"] == hom_nay()


def test_api_may_hu_qua_schema(client):
    """Route + schema thật (Pydantic nuốt field là im lặng)."""
    from app.db import SessionLocal
    from app.models.department import Department
    from app.models.employee import Employee
    from app.models.may_thiet_bi import MayThietBi
    from app.models.user import User

    s = SessionLocal()
    try:
        to = Department(name="Tổ in API MHU", code="TO-MHU-API", la_san_xuat=True)
        s.add(to)
        s.flush()
        m = MayThietBi(ma="MHU-API", ten="Máy MHU API", loai_may="press_offset_sheet")
        s.add(m)
        s.flush()
        s.add(MayTo(may_id=m.id, department_id=to.id))
        e = Employee(code="NV-MHU-API", full_name="Thợ MHU", department_id=to.id)
        s.add(e)
        cap_quyen_to(s, s.query(User).filter_by(username="admin").one(), to)
        s.commit()
        to_id, m_id, e_id = to.id, m.id, e.id
    finally:
        s.close()
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.post(f"/api/san-xuat/teams/{to_id}/may-hu", headers=h,
                    json={"may_id": m_id, "muc_do": "trung_binh", "mo_ta": "Kẹt giấy",
                          "dung_san_xuat": True, "tinh_luong": True, "nguoi_ids": [e_id]})
    assert r.status_code == 200, r.text
    kq = r.json()
    assert kq["yeu_cau_ma"].startswith("YC-") and kq["moi"] is True
    assert kq["dung_may"]["ly_do_ten"] == "Máy hư" and kq["dung_may"]["yeu_cau_ma"] == kq["yeu_cau_ma"]
    ds = client.get(f"/api/san-xuat/teams/{to_id}/dung-may?nam={hom_nay().year}&thang={hom_nay().month}",
                    headers=h).json()
    assert ds["may"][0]["id"] == m_id and ds["may"][0]["dang_mo"] == kq["yeu_cau_ma"]
