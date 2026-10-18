"""Nhật ký phải ghi các thao tác tiền và kho (đợt sửa lỗi E2E 18/10/2026, lỗi #3 và #49) và thôi
dùng tài sản không được chọn ngày sau hôm nay (#44).

Trước đó `audit_logs` không có dòng nào cho: mức khoán km (giá trả lương tài xế), lập / ghi sổ / huỷ
phiếu nhập xuất kho, mọi thao tác tài sản, khoá và mở kỳ kho, khoá và mở kỳ công nợ. Màn Nhật ký
trống đúng quãng những việc đó xảy ra, trong khi hộp mở kỳ công nợ còn hứa "được ghi lại trong
nhật ký".

Mỗi nhóm một test: một thao tác ra ĐÚNG MỘT dòng, mã action đã khai ở `audit_registry` (nhãn tiếng
Việt + nhóm lọc), `actor_user_id` là người bấm, chi tiết có mã chứng từ / tên kỳ / tên mức.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app import audit_registry as reg
from app.db import SessionLocal
from app.models.audit import AuditLog
from app.models.department import Department
from app.models.user import User

from tests.test_kho_de_nghi import _approved_request, _login, _nhap, _setup
from tests.test_khoan_km_theo_muc import GOC, THANG_THUONG, _bac_muc, _tao_muc
from tests.test_tai_san_thoi_dung import _file

ADMIN = {"username": "admin", "password": "admin123"}


def _h(client) -> dict[str, str]:
    r = client.post("/api/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _id_user(username: str) -> int:
    with SessionLocal() as s:
        return s.query(User).filter(User.username == username).one().id


def _dong(action: str) -> list[AuditLog]:
    with SessionLocal() as s:
        rows = s.query(AuditLog).filter(AuditLog.action == action).order_by(AuditLog.id).all()
        for r in rows:
            s.expunge(r)
        return rows


def _mot_dong(action: str, *, actor: int, co_trong_chi_tiet: list[str]) -> AuditLog:
    """Đúng MỘT dòng, đã khai ở registry (nhãn Việt, nhóm thật), đúng người, chi tiết có mã."""
    rows = _dong(action)
    assert len(rows) == 1, f"{action}: cần đúng 1 dòng, có {len(rows)}"
    r = rows[0]
    assert action in reg.THEO_MA, f"{action} chưa khai ở audit_registry"
    assert reg.tra(action).nhom != reg.NHOM_KHAC
    assert r.actor_user_id == actor
    for mau in co_trong_chi_tiet:
        assert mau in (r.detail or "") or mau in (r.target or ""), (
            f"{action}: chi tiết thiếu {mau!r}: target={r.target!r} detail={r.detail!r}"
        )
    return r


# --- #3: mức khoán km ----------------------------------------------------------------------------

def test_muc_khoan_km_tao_doi_ten_ghi_bac_xoa_deu_vao_nhat_ky(client):
    h = _h(client)
    admin = _id_user("admin")
    muc = _tao_muc(client, h, "Xe 2 tan")
    _mot_dong("km_muc_tao", actor=admin, co_trong_chi_tiet=["Xe 2 tan"])

    r = client.put(f"{GOC}/{muc}", json={"ten": "Xe 2,5 tan"}, headers=h)
    assert r.status_code == 200, r.text
    d = _mot_dong("km_muc_sua", actor=admin, co_trong_chi_tiet=["Xe 2 tan", "Xe 2,5 tan"])
    assert d.target == f"muc_khoan_km:{muc}"

    _bac_muc(client, h, muc, THANG_THUONG)
    d = _mot_dong("km_muc_bac", actor=admin, co_trong_chi_tiet=["Xe 2,5 tan", "8 bậc"])
    assert "18000" in d.detail or "18.000" in d.detail    # có giá thật, để dò ai đổi giá nào

    # Xoá mức còn xe thì 400: không được để lại dòng nhật ký cho việc chưa xảy ra.
    muc2 = _tao_muc(client, h, "Xe nhap nham")
    r = client.delete(f"{GOC}/{muc2}", headers=h)
    assert r.status_code == 200, r.text
    _mot_dong("km_muc_xoa", actor=admin, co_trong_chi_tiet=["Xe nhap nham"])


def test_muc_khoan_km_loi_thi_khong_ghi_nhat_ky(client):
    h = _h(client)
    _tao_muc(client, h, "Trung ten")
    r = client.post(GOC, json={"ten": "trung ten"}, headers=h)
    assert r.status_code == 400, r.text
    assert len(_dong("km_muc_tao")) == 1


# --- #49: phiếu nhập xuất kho --------------------------------------------------------------------

def test_phieu_kho_lap_ghi_so_huy_deu_vao_nhat_ky(client):
    kho_id, mat_id = _setup(client)
    tk = _login(client, "t_thukho")
    thu_kho = _id_user("t_thukho")

    req = _approved_request(client, kho_id=kho_id, loai="NHAP", mat_id=mat_id, qty=10, gia=1_000)
    r = client.post("/api/kho/phieu", headers=tk, json={
        "request_id": req["id"], "kho_id": kho_id,
        "lines": [{"request_line_id": req["lines"][0]["id"], "so_luong": 10}],
    })
    assert r.status_code == 201, r.text
    v1 = r.json()
    d = _mot_dong("kho_phieu_lap", actor=thu_kho, co_trong_chi_tiet=[v1["ma"]])
    assert d.target == f"voucher:{v1['id']}"

    r = client.post(f"/api/kho/phieu/{v1['id']}/ghi-so", headers=tk)
    assert r.status_code == 200, r.text
    d = _mot_dong("kho_phieu_ghi_so", actor=thu_kho, co_trong_chi_tiet=[v1["ma"]])
    assert d.target == f"voucher:{v1['id']}"

    # Phiếu thứ hai để huỷ (chỉ huỷ được phiếu còn nháp).
    req2 = _approved_request(client, kho_id=kho_id, loai="NHAP", mat_id=mat_id, qty=5, gia=1_000)
    r = client.post("/api/kho/phieu", headers=tk, json={
        "request_id": req2["id"], "kho_id": kho_id,
        "lines": [{"request_line_id": req2["lines"][0]["id"], "so_luong": 5}],
    })
    assert r.status_code == 201, r.text
    v2 = r.json()
    r = client.post(f"/api/kho/phieu/{v2['id']}/huy", headers=tk, json={"ly_do": "Nhập nhầm kho"})
    assert r.status_code == 200, r.text
    d = _mot_dong("kho_phieu_huy", actor=thu_kho, co_trong_chi_tiet=[v2["ma"], "Nhập nhầm kho"])
    assert d.target == f"voucher:{v2['id']}"
    assert len(_dong("kho_phieu_lap")) == 2          # hai phiếu lập, mỗi phiếu một dòng
    assert len(_dong("kho_phieu_ghi_so")) == 1       # phiếu huỷ chưa từng ghi sổ


def test_phieu_kho_ghi_so_loi_thi_khong_ghi_nhat_ky(client):
    kho_id, mat_id = _setup(client)
    tk = _login(client, "t_thukho")
    posted = _nhap(client, kho_id=kho_id, mat_id=mat_id, qty=10, gia=1_000)
    assert len(_dong("kho_phieu_ghi_so")) == 1
    r = client.post(f"/api/kho/phieu/{posted['id']}/ghi-so", headers=tk)   # ghi sổ lần hai
    assert r.status_code == 400, r.text
    assert len(_dong("kho_phieu_ghi_so")) == 1


# --- #49: tài sản --------------------------------------------------------------------------------

def _them_ts(client, h, ten="May cat Polar", ngay="2026-03-10", gia=120_000_000) -> dict:
    r = client.post("/api/tai-san", headers=h, json={
        "ten": ten, "loai": "tscd", "so_thang": 120, "ngay_su_dung": ngay,
        "nguon_vao": "ghi_tang", "chi_phi": [{"dien_giai": "Gia mua", "so_tien": gia}],
    })
    assert r.status_code == 201, r.text
    return r.json()


def _phong(ten: str) -> int:
    with SessionLocal() as s:
        d = Department(name=ten, code="TS-NK")
        s.add(d)
        s.commit()
        return d.id


def test_tai_san_moi_thao_tac_deu_vao_nhat_ky(client):
    h = _h(client)
    admin = _id_user("admin")
    ts = _them_ts(client, h)
    d = _mot_dong("tai_san_them", actor=admin, co_trong_chi_tiet=[ts["ma"], "May cat Polar"])
    assert d.target == f"tai_san:{ts['id']}"

    r = client.put(f"/api/tai-san/{ts['id']}", headers=h, json={"ghi_chu": "Dat o xuong 2"})
    assert r.status_code == 200, r.text
    _mot_dong("tai_san_sua", actor=admin, co_trong_chi_tiet=[ts["ma"]])

    bp = _phong("To Be NK")
    r = client.post(f"/api/tai-san/{ts['id']}/bien-dong", headers=h, json={
        "loai": "dieu_chuyen", "ngay": "2026-05-20", "bo_phan_moi_id": bp, "ly_do": "Doi to"})
    assert r.status_code == 201, r.text
    _mot_dong("tai_san_dieu_chuyen", actor=admin, co_trong_chi_tiet=[ts["ma"], "To Be NK"])

    r = client.post(f"/api/tai-san/{ts['id']}/bien-dong", headers=h, json={
        "loai": "nang_cap", "ngay": "2026-06-15", "so_tien": 12_000_000,
        "so_thang_con_lai": 60, "ly_do": "Thay bo truc"})
    assert r.status_code == 201, r.text
    _mot_dong("tai_san_nang_cap", actor=admin, co_trong_chi_tiet=[ts["ma"], "12.000.000"])

    r = client.post(f"/api/tai-san/{ts['id']}/thoi-dung", headers=h, json={
        "ngay": "2026-09-15", "kieu": "ban", "ly_do": "Ban cho xuong ban"})
    assert r.status_code == 201, r.text
    _mot_dong("tai_san_thoi_dung", actor=admin, co_trong_chi_tiet=[ts["ma"], "15/09/2026"])

    r = client.delete(f"/api/tai-san/{ts['id']}/thoi-dung", headers=h)
    assert r.status_code == 200, r.text
    _mot_dong("tai_san_bo_thoi_dung", actor=admin, co_trong_chi_tiet=[ts["ma"]])

    nham = _them_ts(client, h, ten="May nhap nham")
    assert client.delete(f"/api/tai-san/{nham['id']}", headers=h).status_code == 204
    d = _mot_dong("tai_san_xoa", actor=admin, co_trong_chi_tiet=[nham["ma"], "May nhap nham"])
    assert d.target == f"tai_san:{nham['id']}"
    assert len(_dong("tai_san_them")) == 2


def test_tai_san_nhap_excel_ghi_mot_dong_tong_ket(client):
    h = _h(client)
    admin = _id_user("admin")
    tep = {"file": ("ts.xlsx", _file(
        ("May in Heidelberg", None, 1_200_000_000, None, 120, "01/10/2020")),
        "application/octet-stream")}
    r = client.post("/api/tai-san/import-excel?mode=preview", headers=h, files=tep)
    assert r.status_code == 200, r.text
    assert _dong("tai_san_nhap_excel") == []                 # xem trước không phải việc đã xảy ra
    r = client.post("/api/tai-san/import-excel?mode=commit", headers=h, files=tep)
    assert r.status_code == 200 and r.json()["da_ghi"], r.text
    _mot_dong("tai_san_nhap_excel", actor=admin, co_trong_chi_tiet=["1 tài sản"])


def test_tai_san_loi_thi_khong_ghi_nhat_ky(client):
    h = _h(client)
    ts = _them_ts(client, h)
    r = client.post(f"/api/tai-san/{ts['id']}/thoi-dung", headers=h, json={
        "ngay": "2026-09-15", "kieu": "cho_muon"})
    assert r.status_code == 422, r.text
    assert _dong("tai_san_thoi_dung") == []


# --- #49: khoá và mở kỳ kho ----------------------------------------------------------------------

def test_khoa_va_mo_ky_kho_vao_nhat_ky(client):
    h = _h(client)
    admin = _id_user("admin")
    body = {"kho_id": None, "tu_ngay": "2026-07-01", "den_ngay": "2026-07-31"}
    r = client.post("/api/kho/khoa-so", headers=h, json={**body, "hanh_dong": "khoa",
                                                          "ten": "Ky 07/2026"})
    assert r.status_code == 201, r.text
    d = _mot_dong("kho_khoa_ky", actor=admin,
                  co_trong_chi_tiet=["Ky 07/2026", "01/07/2026", "31/07/2026"])

    r = client.post("/api/kho/khoa-so", headers=h, json={**body, "hanh_dong": "mo"})
    assert r.status_code == 201, r.text
    # Mở không mang tên kỳ trong body, nên chi tiết phải tra ra tên kỳ đang mở.
    _mot_dong("kho_mo_ky", actor=admin, co_trong_chi_tiet=["Ky 07/2026", "31/07/2026"])
    assert d.id != _dong("kho_mo_ky")[0].id


def test_khoa_ky_kho_bi_chan_thi_khong_ghi_nhat_ky(client):
    h = _h(client)
    body = {"kho_id": None, "tu_ngay": "2026-07-01", "den_ngay": "2026-07-31", "hanh_dong": "khoa"}
    assert client.post("/api/kho/khoa-so", headers=h, json=body).status_code == 201
    assert client.post("/api/kho/khoa-so", headers=h, json=body).status_code == 400   # chồng lấn
    assert len(_dong("kho_khoa_ky")) == 1


# --- #49: khoá và mở kỳ công nợ ------------------------------------------------------------------

def test_khoa_va_mo_ky_cong_no_vao_nhat_ky(client):
    h = _h(client)
    admin = _id_user("admin")
    hom_nay = date.today()
    den = date(hom_nay.year, hom_nay.month, 1) - timedelta(days=1)
    tu = den.replace(day=1)
    body = {"phan_he": "phai_tra", "tu_ngay": tu.isoformat(), "den_ngay": den.isoformat()}
    r = client.post("/api/accounting/khoa-so", headers=h,
                    json={**body, "hanh_dong": "khoa", "ten": "Chot ky NK"})
    assert r.status_code == 201, r.text
    _mot_dong("cong_no_khoa_ky", actor=admin,
              co_trong_chi_tiet=["Chot ky NK", "phải trả", f"{den:%d/%m/%Y}"])

    r = client.post("/api/accounting/khoa-so", headers=h, json={**body, "hanh_dong": "mo"})
    assert r.status_code == 201, r.text
    _mot_dong("cong_no_mo_ky", actor=admin,
              co_trong_chi_tiet=["phải trả", f"{den:%d/%m/%Y}"])


def test_mo_ky_cong_no_bi_chan_thi_khong_ghi_nhat_ky(client):
    h = _h(client)
    hom_nay = date.today()
    den2 = date(hom_nay.year, hom_nay.month, 1) - timedelta(days=1)
    tu2 = den2.replace(day=1)
    den1 = tu2 - timedelta(days=1)
    tu1 = den1.replace(day=1)
    for tu, den in ((tu1, den1), (tu2, den2)):
        r = client.post("/api/accounting/khoa-so", headers=h, json={
            "phan_he": "phai_thu", "tu_ngay": tu.isoformat(), "den_ngay": den.isoformat(),
            "hanh_dong": "khoa"})
        assert r.status_code == 201, r.text
    # Kỳ trước đã bị niêm vì có kỳ sau ⇒ 422, và không được để dấu vết "đã mở".
    r = client.post("/api/accounting/khoa-so", headers=h, json={
        "phan_he": "phai_thu", "tu_ngay": tu1.isoformat(), "den_ngay": den1.isoformat(),
        "hanh_dong": "mo"})
    assert r.status_code == 422, r.text
    assert _dong("cong_no_mo_ky") == []
    assert len(_dong("cong_no_khoa_ky")) == 2


# --- #44: thôi dùng không chọn ngày sau hôm nay --------------------------------------------------

def _dong_ho_vn(monkeypatch, utc: datetime) -> None:
    """Đặt đồng hồ `hom_nay_vn()` (giờ VN = UTC+7) về một mốc UTC cho trước."""
    from app.repositories import loc_danh_sach as m

    class _Gia(datetime):
        @classmethod
        def now(cls, tz=None):
            return utc.astimezone(tz) if tz else utc.replace(tzinfo=None)

    monkeypatch.setattr(m, "datetime", _Gia)


def test_thoi_dung_ngay_tuong_lai_bi_chan_o_may_chu(client, monkeypatch):
    h = _h(client)
    ts = _them_ts(client, h)
    _dong_ho_vn(monkeypatch, datetime(2026, 10, 18, 5, 0, tzinfo=timezone.utc))   # 12:00 18/10 VN
    r = client.post(f"/api/tai-san/{ts['id']}/thoi-dung", headers=h, json={
        "ngay": "2026-12-15", "kieu": "ban"})
    assert r.status_code == 422, r.text
    assert "Không chọn được ngày sau hôm nay" in r.json()["detail"]
    # Bị chặn thì thẻ KHÔNG được đổi trạng thái (lỗi gốc: hôm 18/10 thẻ đã "Đã thôi dùng").
    ct = client.get(f"/api/tai-san/{ts['id']}", headers=h).json()
    assert ct["trang_thai"] == "dang_dung" and ct["ngay_giam"] is None
    assert _dong("tai_san_thoi_dung") == []

    r = client.post(f"/api/tai-san/{ts['id']}/thoi-dung", headers=h, json={
        "ngay": "2026-10-18", "kieu": "ban"})
    assert r.status_code == 201, r.text      # đúng hôm nay thì được


def test_thoi_dung_hom_nay_theo_gio_vn_khong_theo_utc(client, monkeypatch):
    """23:36 UTC ngày 17 là 06:36 ngày 18 giờ VN: ngày 18 là HÔM NAY (được), ngày 19 là mai (chặn)."""
    h = _h(client)
    ts = _them_ts(client, h)
    _dong_ho_vn(monkeypatch, datetime(2026, 10, 17, 23, 36, tzinfo=timezone.utc))
    r = client.post(f"/api/tai-san/{ts['id']}/thoi-dung", headers=h, json={
        "ngay": "2026-10-19", "kieu": "hong"})
    assert r.status_code == 422, r.text
    r = client.post(f"/api/tai-san/{ts['id']}/thoi-dung", headers=h, json={
        "ngay": "2026-10-18", "kieu": "hong"})
    assert r.status_code == 201, r.text


def test_thoi_dung_ngay_qua_khu_van_duoc(client):
    h = _h(client)
    ts = _them_ts(client, h)
    r = client.post(f"/api/tai-san/{ts['id']}/thoi-dung", headers=h, json={
        "ngay": "2026-09-01", "kieu": "mat"})
    assert r.status_code == 201, r.text


# --- Fix round 1: màn Nhật ký đang mở phải được báo "có dòng mới" ----------------------------------
# `create(commit=False)` không tự báo; người gọi phải gọi `bao_co_dong_moi()` SAU commit
# (docstring `audit_repo.bao_co_dong_moi`). Thiếu thì dòng đã vào bảng mà màn đang mở không nhảy.

@pytest.fixture
def tick(monkeypatch):
    """Đếm số lần màn Nhật ký được báo, và dòng nhật ký đã COMMIT hay chưa lúc được báo."""
    from app.repositories import audit_repo

    ds: list[int] = []

    def gia():
        with SessionLocal() as s:           # phiên MỚI: chỉ thấy dòng đã commit
            ds.append(s.query(AuditLog).count())

    monkeypatch.setattr(audit_repo, "_bao_co_dong_moi", gia)
    return ds


def test_tick_nhat_ky_sau_commit_o_muc_km(client, tick):
    h = _h(client)
    tick.clear()                             # đăng nhập cũng ghi nhật ký và báo — bỏ ra
    _tao_muc(client, h, "Xe tick")
    assert tick, "tạo mức khoán km không báo màn Nhật ký"
    assert tick[-1] >= 1                     # lúc báo, dòng đã nằm trong bảng đã commit


def test_tick_nhat_ky_sau_commit_o_tai_san(client, tick):
    h = _h(client)
    ts = _them_ts(client, h)
    tick.clear()
    r = client.post(f"/api/tai-san/{ts['id']}/thoi-dung", headers=h, json={
        "ngay": "2026-09-15", "kieu": "ban"})
    assert r.status_code == 201, r.text
    assert tick, "thôi dùng tài sản không báo màn Nhật ký"
    with SessionLocal() as s:                # lúc báo, dòng thôi dùng đã nằm trong bảng đã commit
        assert tick[-1] == s.query(AuditLog).count()
        assert s.query(AuditLog).filter(AuditLog.action == "tai_san_thoi_dung").count() == 1


def test_tick_nhat_ky_sau_commit_o_ghi_so_phieu_kho(client, tick):
    kho_id, mat_id = _setup(client)
    tk = _login(client, "t_thukho")
    req = _approved_request(client, kho_id=kho_id, loai="NHAP", mat_id=mat_id, qty=10, gia=1_000)
    v = client.post("/api/kho/phieu", headers=tk, json={
        "request_id": req["id"], "kho_id": kho_id,
        "lines": [{"request_line_id": req["lines"][0]["id"], "so_luong": 10}]}).json()
    tick.clear()
    assert client.post(f"/api/kho/phieu/{v['id']}/ghi-so", headers=tk).status_code == 200
    assert tick, "ghi sổ phiếu kho không báo màn Nhật ký"
    assert len(_dong("kho_phieu_ghi_so")) == 1


def test_tick_nhat_ky_sau_commit_o_mo_ky_kho(client, tick):
    h = _h(client)
    body = {"kho_id": None, "tu_ngay": "2026-07-01", "den_ngay": "2026-07-31"}
    assert client.post("/api/kho/khoa-so", headers=h,
                       json={**body, "hanh_dong": "khoa", "ten": "K"}).status_code == 201
    tick.clear()
    assert client.post("/api/kho/khoa-so", headers=h, json={**body, "hanh_dong": "mo"}).status_code == 201
    assert tick, "mở kỳ kho không báo màn Nhật ký"
    assert len(_dong("kho_mo_ky")) == 1


# --- Fix round 1: huỷ điều chuyển chỉ ghi "huỷ" cho phiếu mà chính lần này huỷ -----------------------

def _dieu_chuyen(client, tick=None):
    kho_id, mat_id = _setup(client)
    _nhap(client, kho_id=kho_id, mat_id=mat_id, qty=100, gia=1_000)
    tk = _login(client, "t_thukho")
    den = client.post("/api/kho", json={"ten": "Kho đích NK"}, headers=_h(client)).json()["id"]
    r = client.post("/api/kho/dieu-chuyen", headers=tk, json={
        "kho_nguon_id": kho_id, "kho_den_id": den,
        "items": [{"hang_loai": mat_id[0], "hang_id": mat_id[1], "so_luong": 10}]})
    assert r.status_code == 201, r.text
    return tk, r.json()


def test_huy_dieu_chuyen_ghi_huy_cho_ca_hai_phieu(client, tick):
    tk, dc = _dieu_chuyen(client)
    tick.clear()
    r = client.post(f"/api/kho/dieu-chuyen/{dc['yeu_cau_id']}/huy", headers=tk,
                    json={"ly_do": "Chuyển nhầm"})
    assert r.status_code == 204, r.text
    ds = _dong("kho_phieu_huy")
    assert sorted(d.target for d in ds) == sorted(
        [f"voucher:{dc['phieu_xuat_id']}", f"voucher:{dc['phieu_nhap_id']}"])
    assert tick, "huỷ điều chuyển không báo màn Nhật ký"


def test_huy_dieu_chuyen_khong_ghi_huy_cho_phieu_xuat_da_huy_tu_truoc(client):
    from app.models.stock_voucher import VOUCHER_CANCELLED, StockVoucher

    tk, dc = _dieu_chuyen(client)
    with SessionLocal() as s:                 # phiếu xuất nguồn đã bị huỷ từ trước (dữ liệu cũ)
        s.get(StockVoucher, dc["phieu_xuat_id"]).trang_thai = VOUCHER_CANCELLED
        s.commit()
    r = client.post(f"/api/kho/dieu-chuyen/{dc['yeu_cau_id']}/huy", headers=tk,
                    json={"ly_do": "Chuyển nhầm"})
    assert r.status_code == 204, r.text
    assert [d.target for d in _dong("kho_phieu_huy")] == [f"voucher:{dc['phieu_nhap_id']}"]
