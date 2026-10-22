"""Hai lương cho khối Sản xuất — `docs/superpowers/specs/2026-10-20-hai-luong-khoi-san-xuat-design.md`.

Chủ chốt 20/10/2026, sửa 22/10/2026 (khớp sổ lương T08):

1. Thuộc khối Sản xuất (cờ `la_san_xuat` kế thừa cây) hoặc tổ Giao hàng ⇒ tính 2 lương, ăn bên lớn.
   Không còn công tắc "Lương khoán" / "Tăng ca" theo tổ.
2. Khối Sản xuất (22/10): vế thời gian = CHỈ bù lỗ theo công; vế khoán = tiền sản lượng + khoán km.
   TĂNG CA KHOÁN là tiền tăng ca duy nhất, cộng SAU phép so (ăn vế nào cũng có). Giờ tăng ca chấm công
   và phụ cấp tăng ca đêm KHÔNG ra tiền. Thử việc giữ luật cũ (chủ chưa chốt).
   Giao hàng giữ chốt 16/09: vế thời gian gồm tiền giờ tăng ca + phụ cấp tăng ca đêm.
3. Phép có lương là một công của vế thời gian.
4. Ngoài phép so (giữ như cũ): phần thêm làm nguyên ngày CN / lễ, ngày off1x, cơm tăng ca.
"""
from __future__ import annotations

from datetime import date
from types import SimpleNamespace

from app.db import SessionLocal
from app.repositories.employee_repo import EmployeeRepository
from app.repositories.payroll_repo import PayrollRepository
from app.repositories.rbac_repo import DepartmentRepository
from app.services.payroll_service import PayrollService
from tests.test_com_tang_ca import (
    MUC, _ca_hanh_chinh, _h, _khai_com_tc, _lam_ngay, _ngay_lam_viec, _ngay_nghi, _nv,
    _phieu_tang_ca,
)
from tests.test_com_tang_ca import NAM, THANG
from tests.test_luong_api import _sal

# Lương cơ bản 26tr / 26 công ⇒ 1.000.000 đ/công · 125.000 đ/giờ (8 giờ/công).
LUONG = 26_000_000
GIO = 125_000
# 10 giờ tăng ca ngày thường ×1,5.
TC_10H = 10 * GIO * 3 // 2          # 1.875.000


# --- dựng cảnh -------------------------------------------------------------------------------
def _svc(db) -> PayrollService:
    return PayrollService(PayrollRepository(db), EmployeeRepository(db), attendance=None,
                          departments=DepartmentRepository(db))


def _emp(status: str = "active"):
    return SimpleNamespace(status=status, hire_date=date(2020, 1, 1), gender="male",
                           payroll_group=None, pay_grade_key=None, dependents_count=0)


def _tinh(svc, params, status: str = "active", **kw) -> dict:
    return svc._compute(employee=_emp(status), salary=_sal(luong_vi_tri=LUONG), params=params,
                        standard_cong=26, on=date(2026, 6, 1), **kw)


def _to(ten: str, *, san_xuat: bool = False, giao_hang: bool = False, cha: int | None = None) -> int:
    db = SessionLocal()
    try:
        pb = DepartmentRepository(db).create(name=ten, parent_id=cha)
        pb.la_san_xuat = san_xuat
        pb.la_giao_hang = giao_hang
        db.commit()
        return pb.id
    finally:
        db.close()


def _chuyen_to(eid: int, dept_id: int) -> None:
    db = SessionLocal()
    try:
        EmployeeRepository(db).get_by_id(eid).department_id = dept_id
        db.commit()
    finally:
        db.close()


def _chinh_thuc(client, h, eid: int) -> None:
    """Hồ sơ `_nv()` mặc định THỬ VIỆC — thử việc khối SX luôn ăn vế thời gian, nên bài nào khoá phép
    so 2 lương thì đưa người sang CHÍNH THỨC + khai Mức đóng BHXH (khỏi cảnh báo thừa)."""
    r = client.post(f"/api/employees/{eid}/transitions",
                    json={"kind": "confirm", "effective_date": "2020-01-01"}, headers=h)
    assert r.status_code in (200, 201), r.text
    r = client.post(f"/api/luong/salaries/{eid}",
                    json={"effective_from": "2026-01-02", "luong_vi_tri": 10_000_000,
                          "insurance_base": 10_000_000}, headers=h)
    assert r.status_code in (200, 201), r.text


def _khai_com_tc_va_tat_khop_ca(client, h) -> None:
    _khai_com_tc(client, h)
    r = client.put("/api/luong/params", json={"ca_khop_gio_chuan": False}, headers=h)
    assert r.status_code == 200, r.text


def _tinh_lai(client, h) -> dict:
    r = client.post("/api/luong/generate", json={"year": NAM, "month": THANG}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _dong(bang: dict, eid: int) -> dict:
    return next(l for l in bang["lines"] if l["employee_id"] == eid)


# =============================================================================================
# Engine — phép so 2 lương, số viết tay
# =============================================================================================
def test_CONG_NHAT_trong_khoi_SX_KHONG_co_tien_gio_tang_ca(client):
    """⭐ 22/10/2026: vế khoán = 0 ⇒ ăn vế thời gian = bù lỗ theo công, giờ tăng ca KHÔNG ra tiền.

    2h ngày thường + 1h nghỉ tuần + 1h lễ: tổ thường ăn 125.000 × (2 × 1,5 + 1 × 2 + 1 × 3) = 1.000.000,
    khối SX ăn 0 — gross thấp hơn đúng số đó."""
    client
    db = SessionLocal()
    try:
        svc = _svc(db)
        params = svc.get_params()
        gio = dict(actual_cong=26, ot_minutes=240, ot_restday_minutes=60, ot_holiday_minutes=60)
        thuong = _tinh(svc, params, **gio, che_do_khoan=False)
        hai = _tinh(svc, params, **gio, che_do_khoan=True)
        assert thuong["ot_pay"] == thuong["tien_gio_tang_ca"] == 1_000_000
        assert hai["ot_pay"] == hai["tien_gio_tang_ca"] == 0
        assert hai["gross"] == thuong["gross"] - 1_000_000 == 26_000_000
        assert hai["lay_bu_lo"] is True and hai["che_do_khoan"] is True
        assert hai["tang_ca_khoan"] == 0
    finally:
        db.close()


def test_AN_KHOAN_thi_tien_gio_tang_ca_bang_0(client):
    """Khoán 30tr > vế thời gian 26tr + 1.875.000 ⇒ ăn khoán, tăng ca theo giờ = 0."""
    client
    db = SessionLocal()
    try:
        svc = _svc(db)
        params = svc.get_params()
        v = _tinh(svc, params, actual_cong=26, ot_minutes=600, khoan=30_000_000, che_do_khoan=True)
        assert v["lay_bu_lo"] is False
        assert v["tien_gio_tang_ca"] == 0 and v["ot_pay"] == 0
        assert v["luong_cong"] == 0 and v["khoan"] == 30_000_000
        assert v["gross"] == 30_000_000
    finally:
        db.close()


def test_AN_THOI_GIAN_thi_bu_them_cho_du_bu_lo_theo_cong(client):
    """Khoán 20tr < bù lỗ 26tr ⇒ ăn vế thời gian: phần thiếu vào lương theo công, 10 giờ tăng ca không
    ra tiền. luong_cong + khoan = đúng bù lỗ theo công."""
    client
    db = SessionLocal()
    try:
        svc = _svc(db)
        params = svc.get_params()
        v = _tinh(svc, params, actual_cong=26, ot_minutes=600, khoan=20_000_000, che_do_khoan=True)
        assert v["lay_bu_lo"] is True
        assert v["tien_gio_tang_ca"] == 0 and v["ot_pay"] == 0
        assert v["luong_cong"] == 6_000_000
        assert v["luong_cong"] + v["khoan"] == v["bu_lo_theo_cong"] == v["ve_thoi_gian"] == 26_000_000
        assert v["gross"] == 26_000_000
    finally:
        db.close()


def test_TANG_CA_KHOAN_cong_SAU_phep_so_an_ve_nao_cung_co(client):
    """22/10/2026: tăng ca khoán KHÔNG vào vế khoán. Khoán 20tr + tăng ca khoán 9tr: 20tr < bù lỗ 26tr
    ⇒ ăn bù lỗ 26tr + 9tr (chốt 20/10 cũ: 29tr > 26tr ⇒ ăn khoán). Khoán 30tr ⇒ ăn khoán 30tr + 5tr.
    Tiền giờ tăng ca luôn 0."""
    client
    db = SessionLocal()
    try:
        svc = _svc(db)
        params = svc.get_params()
        an_tg = _tinh(svc, params, actual_cong=26, ot_minutes=600, khoan=20_000_000,
                      tang_ca_khoan=9_000_000, che_do_khoan=True)
        assert an_tg["lay_bu_lo"] is True
        assert an_tg["tang_ca_khoan"] == 9_000_000 and an_tg["tien_gio_tang_ca"] == 0
        assert an_tg["luong_cong"] + an_tg["khoan"] == 26_000_000
        assert an_tg["gross"] == 26_000_000 + 9_000_000

        an_khoan = _tinh(svc, params, actual_cong=26, ot_minutes=600, khoan=30_000_000,
                         tang_ca_khoan=5_000_000, che_do_khoan=True)
        assert an_khoan["lay_bu_lo"] is False
        assert an_khoan["tang_ca_khoan"] == 5_000_000 and an_khoan["tien_gio_tang_ca"] == 0
        assert an_khoan["gross"] == 30_000_000 + 5_000_000
    finally:
        db.close()


def test_SO_T08_may_in_2_mau_Tuan_an_bu_lo_Huy_an_khoan_ca_hai_co_tang_ca_khoan(client):
    """Sổ lương T08/2026 máy in 2 màu. Tuấn 16,5tr × 24/26 = 15.230.769 > khoán 14.147.394 ⇒ ăn bù lỗ.
    Huy 14,5tr × 11/26 = 6.134.615 < khoán 6.344.265 ⇒ ăn khoán. Tăng ca khoán (số minh hoạ) cộng sau
    cho cả hai; giờ tăng ca chấm công (Tuấn 2h, Huy 1,5h) không ra tiền."""
    client
    db = SessionLocal()
    try:
        svc = _svc(db)
        params = svc.get_params()

        def _so(muc, cong, phut, khoan, tck):
            return svc._compute(employee=_emp(), salary=_sal(luong_vi_tri=muc), params=params,
                                standard_cong=26, on=date(2026, 8, 1), actual_cong=cong,
                                ot_minutes=phut, khoan=khoan, tang_ca_khoan=tck, che_do_khoan=True)

        tuan = _so(16_500_000, 24, 120, 14_147_394, 500_000)
        assert tuan["bu_lo_theo_cong"] == 15_230_769 and tuan["lay_bu_lo"] is True
        assert tuan["luong_cong"] + tuan["khoan"] == 15_230_769
        assert tuan["tang_ca_khoan"] == 500_000 and tuan["ot_pay"] == 0
        assert tuan["gross"] == 15_230_769 + 500_000

        huy = _so(14_500_000, 11, 90, 6_344_265, 300_000)
        assert huy["bu_lo_theo_cong"] == 6_134_615 and huy["lay_bu_lo"] is False
        assert huy["luong_cong"] == 0 and huy["ot_pay"] == 0
        assert huy["gross"] == 6_344_265 + 300_000

        # Người KHÔNG tính 2 lương không bao giờ có tăng ca khoán.
        ngoai = _tinh(svc, params, actual_cong=26, tang_ca_khoan=5_000_000, che_do_khoan=False)
        assert ngoai["tang_ca_khoan"] == 0 and ngoai["gross"] == 26_000_000
    finally:
        db.close()


def test_PHU_CAP_TANG_CA_DEM_khoi_SX_khong_co_gio_dem_trong_ca_van_tra(client):
    """Giờ đêm trong ca: 125.000 × 1h, luôn trả (ca đêm thường, không phải tăng ca). Tăng ca đêm:
    125.000 × 1h × (30% + 20%) = 62.500 — tổ thường có; khối SX (22/10/2026) ăn vế nào cũng không."""
    client
    db = SessionLocal()
    try:
        svc = _svc(db)
        params = svc.get_params()
        dem = dict(actual_cong=26, ot_minutes=60, night_premium_minutes=60, ot_night_normal_minutes=60)
        tg = _tinh(svc, params, **dem, che_do_khoan=True)
        khoan = _tinh(svc, params, **dem, khoan=40_000_000, che_do_khoan=True)
        thuong = _tinh(svc, params, **dem, che_do_khoan=False)
        assert thuong["night_premium_pay"] == GIO + 62_500
        assert tg["lay_bu_lo"] is True
        assert tg["night_premium_pay"] == khoan["night_premium_pay"] == GIO
    finally:
        db.close()


def test_PHEP_CO_LUONG_la_mot_cong_cua_ve_thoi_gian(client):
    """Cách A (chủ 20/10/2026): 24 ngày làm + 2 ngày phép = 26 công trong vế thời gian. Khoán 20tr <
    26tr ⇒ ăn 26tr (gồm 2 ngày phép). Khoán 30tr ⇒ ăn 30tr, ngày phép không ra thêm tiền tháng đó."""
    client
    db = SessionLocal()
    try:
        svc = _svc(db)
        params = svc.get_params()
        thap = _tinh(svc, params, actual_cong=26, paid_leave_cong=2, khoan=20_000_000,
                     che_do_khoan=True)
        assert thap["bu_lo_theo_cong"] == 26_000_000 and thap["gross"] == 26_000_000
        cao = _tinh(svc, params, actual_cong=26, paid_leave_cong=2, khoan=30_000_000,
                    che_do_khoan=True)
        assert cao["gross"] == 30_000_000
    finally:
        db.close()


def test_THU_VIEC_khoi_SX_luon_an_ve_thoi_gian_co_tang_ca(client):
    client
    db = SessionLocal()
    try:
        svc = _svc(db)
        params = svc.get_params()
        params.probation_ratio = 1.0
        v = _tinh(svc, params, status="probation", actual_cong=26, ot_minutes=600,
                  khoan=40_000_000, tang_ca_khoan=5_000_000, che_do_khoan=True)
        assert v["khoan"] == 0 and v["tang_ca_khoan"] == 0
        assert v["tien_gio_tang_ca"] == TC_10H
        assert v["gross"] == 26_000_000 + TC_10H
    finally:
        db.close()


def test_NGOAI_PHEP_SO_phan_them_CN_le_va_off1x_va_com_tang_ca_giu_nguyen(client):
    client
    db = SessionLocal()
    try:
        svc = _svc(db)
        params = svc.get_params()
        params.com_tang_ca_muc = 30_000
        params.com_tang_ca_nguong_phut = 180
        for hai in (False, True):
            le = _tinh(svc, params, actual_cong=27, holiday_cong=1, che_do_khoan=hai,
                       khoan=40_000_000 if hai else 0)
            cn = _tinh(svc, params, actual_cong=27, restday_cong=1, che_do_khoan=hai,
                       khoan=40_000_000 if hai else 0)
            assert le["ot_pay"] == 2_000_000, hai             # lễ: phần thêm 200%
            assert cn["ot_pay"] == 1_000_000, hai             # CN: phần thêm 100%
        off = _tinh(svc, params, actual_cong=26, plain_cong=1, khoan=40_000_000, che_do_khoan=True)
        assert off["off1x_pay"] == 1_000_000 and off["ot_pay"] == 1_000_000
        ot_days = {"lam": {"3": 200}, "nghi": {"7": 30}}
        com = _tinh(svc, params, actual_cong=26, ot_minutes=230, ot_days=ot_days,
                    khoan=40_000_000, che_do_khoan=True)
        assert com["com_tang_ca_pay"] == 60_000 and com["tien_gio_tang_ca"] == 0
    finally:
        db.close()


# =============================================================================================
# Ai tính 2 lương — khối Sản xuất (kế thừa cây) ∪ Giao hàng (cờ riêng)
# =============================================================================================
def test_TINH_HAI_LUONG_suy_theo_khoi_san_xuat_va_giao_hang(client):
    client
    khoi = _to("Khối SX thử", san_xuat=True)
    to_con = _to("Tổ con SX thử", cha=khoi)
    to_chau = _to("Tổ cháu SX thử", cha=to_con)
    to_gh = _to("Tổ giao hàng suy thử", giao_hang=True)
    to_con_gh = _to("Tổ con giao hàng chưa bật", cha=to_gh)
    to_thuong = _to("Tổ thường suy thử")
    db = SessionLocal()
    try:
        svc = _svc(db)
        assert svc.che_do_khoan(khoi) is True        # tổ cha cũng tính 2 lương
        assert svc.che_do_khoan(to_con) is True
        assert svc.che_do_khoan(to_chau) is True
        assert svc.che_do_khoan(to_gh) is True
        assert svc.che_do_khoan(to_con_gh) is False
        assert svc.che_do_khoan(to_thuong) is False
        assert svc.che_do_khoan(None) is False
    finally:
        db.close()


def test_CO_CHE_LUONG_chi_con_cong_tac_chuyen_can(client):
    h = _h(client)
    pb = _to("Tổ cơ chế thử", san_xuat=True)
    r = client.get(f"/api/luong/dept-components/{pb}", headers=h)
    assert r.status_code == 200, r.text
    assert [c["component_key"] for c in r.json()["items"]] == ["chuyen_can"]
    for khoa in ("luong_khoan", "tang_ca"):
        r = client.put(f"/api/luong/dept-components/{pb}", json={"items": [
            {"component_key": khoa, "is_enabled": False}]}, headers=h)
        assert r.status_code == 422, (khoa, r.text)


# =============================================================================================
# Chạy qua "Tính lại" thật — chấm công + phiếu tăng ca
# =============================================================================================
def test_TINH_LAI_cong_nhat_khoi_SX_khong_tien_gio_tang_ca_tai_xe_van_co(client):
    """⭐ Ba người cùng làm một ngày thường + 3h tăng ca có phiếu: tổ thường · tổ khối SX (chưa có lần
    ghi nào) · tổ Giao hàng (chưa có chuyến). Hai người sau ăn vế thời gian. Tài xế có tăng ca theo giờ
    bằng người tổ thường; người khối SX KHÔNG có (22/10/2026). Ai cũng 1 suất cơm tăng ca. Không còn câu
    cảnh báo "khoán = 0" cho tổ SX."""
    h = _h(client)
    _khai_com_tc_va_tat_khop_ca(client, h)
    khoi = _to("Khối SX tính lại", san_xuat=True)
    to_sx = _to("Tổ SX tính lại", cha=khoi)
    to_gh = _to("Tổ giao hàng tính lại", giao_hang=True)
    ngay = _ngay_lam_viec(client, h)[2]

    nguoi = {}
    for vai, to in (("thuong", None), ("sx", to_sx), ("gh", to_gh)):
        eid = _nv(client, h, ten=f"NV TC {vai}")
        _chinh_thuc(client, h, eid)
        if to is not None:
            _chuyen_to(eid, to)
        _ca_hanh_chinh(client, h, eid)
        _lam_ngay(client, h, eid, ngay, ot_gio=3)
        _phieu_tang_ca(client, h, eid, ngay)
        nguoi[vai] = eid

    bang = _tinh_lai(client, h)
    thuong, sx, gh = (_dong(bang, nguoi[k]) for k in ("thuong", "sx", "gh"))
    for d in (thuong, sx, gh):
        assert d["ot_minutes"] == 180, d
        assert d["com_tang_ca_pay"] == MUC, d
    assert thuong["ot_pay"] > 0 and thuong["che_do_khoan"] is False
    for d in (sx, gh):
        assert d["che_do_khoan"] is True and d["lay_bu_lo"] is True
        assert d["tang_ca_khoan"] == 0
    assert abs(gh["ot_pay"] - thuong["ot_pay"]) <= 1, (gh["ot_pay"], thuong["ot_pay"])
    assert sx["ot_pay"] == 0 and sx["tien_gio_tang_ca"] == 0
    canh_bao = bang["canh_bao_chot"] or ""
    assert "tổ khoán có công nhưng tiền khoán" not in canh_bao, canh_bao
    assert "1 tài xế / phụ xe có công nhưng tiền km kỳ này = 0 (NV TC gh)" in canh_bao, canh_bao
    assert thuong["bu_lo_theo_cong"] is None


def test_TINH_LAI_khoi_SX_lam_NGUYEN_NGAY_chu_nhat_van_bang_to_thuong(client):
    h = _h(client)
    _khai_com_tc_va_tat_khop_ca(client, h)
    to_sx = _to("Tổ SX chủ nhật", san_xuat=True)
    cn = _ngay_nghi(client, h)[1]

    nguoi = {}
    for vai, to in (("thuong", None), ("sx", to_sx)):
        eid = _nv(client, h, ten=f"NV CN {vai}")
        if to is not None:
            _chuyen_to(eid, to)
        _ca_hanh_chinh(client, h, eid)
        _lam_ngay(client, h, eid, cn)
        nguoi[vai] = eid

    bang = _tinh_lai(client, h)
    thuong, sx = _dong(bang, nguoi["thuong"]), _dong(bang, nguoi["sx"])
    assert thuong["ot_pay"] > 0, "đi làm CN phải có phần thêm — test dựng sai cảnh"
    assert sx["ot_pay"] == thuong["ot_pay"]
    assert sx["che_do_khoan"] is True


# =============================================================================================
# Cảnh báo trước chốt — lần ghi thiếu giá
# =============================================================================================
def test_canh_bao_lan_ghi_thieu_gia(client):
    client
    from app.routers.payroll import _canh_bao_chot

    dong = SimpleNamespace(employee_id=1, employee_name="Thợ A", net_pay=1, advance_total=0,
                           luong_dot_1_total=0, no_ung_ky_truoc=0, no_ung_chuyen_ky_sau=0,
                           ot_minutes=120, khoan=0, khoan_km=0, che_do_khoan=True)
    assert _canh_bao_chot([dong]) is None, "khoán = 0 ở khối SX là ăn vế thời gian, không nhắc"
    cb = _canh_bao_chot([dong], thieu_gia=[
        {"batch_id": 7, "cong_doan": "Bài in 1–2 màu", "to": "Máy 4 màu", "ngay": "05/06/2026",
         "ly_do": "tổ chưa khai giá"}])
    assert cb is not None and "1 lần ghi sản lượng chưa có tiền khoán" in cb
    assert "Bài in 1–2 màu — Máy 4 màu ngày 05/06/2026" in cb
