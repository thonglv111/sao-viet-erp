"""Màn Lương → Khoán theo tổ (22/10/2026) — `services/khoan_theo_to.py` + `tinh(so=True)`.

Tổ Dán ăn chia 5%: tổ trưởng trích ở MỌI lần ghi kể cả lần mình không làm; lương khoán không gồm
tăng ca khoán; người của tổ làm ở tổ khác cộng vào cột Ở tổ khác."""
from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest

from app.db import SessionLocal
from app.models.employee import STATUS_ACTIVE, STATUS_PROBATION
from app.models.payroll import KhoanChiTieuNgay, KhoanToTruong
from app.services.khoan_ky import KhoanKyService, MucKhoan
from app.services.khoan_theo_to import KhoanTheoToForbidden, xem
from tests.test_khoan_ky import CT_THANG, GIA_IN, NAM, THANG, _h, _Nen


@pytest.fixture()
def nen(client):
    db = SessionLocal()
    try:
        n = _Nen(db)
        dan, may = n.to("Dán"), n.to("Máy 4 màu")
        tt, a, b = n.nv(dan, "Quí", user=True), n.nv(dan, "Trang"), n.nv(dan, "Thảo")
        m = n.nv(may, "Hùng")
        for e in (tt, a, b, m):
            e.status = STATUS_ACTIVE   # hồ sơ mới mặc định thử việc ⇒ công nhật
        dan.head_user_id = tt.user_id
        db.add(KhoanToTruong(department_id=dan.id, ap_dung_tu=date(NAM, 1, 1), che_do="chia", ty_le=5))
        db.add(KhoanChiTieuNgay(department_id=dan.id, ap_dung_tu=date(NAM, 1, 1), so_tien=600_000))
        k = n.khoan(gia_theo_to=GIA_IN((dan, 0, 100), (may, 0, 100)), cong_thuc=CT_THANG)
        l1 = n.ghi(dan, k, date(NAM, THANG, 5), 10_000, [tt, a])
        l2 = n.ghi(dan, k, date(NAM, THANG, 6), 4_000, [a, b])
        l3 = n.ghi(may, k, date(NAM, THANG, 6), 2_000, [a, m])
        db.commit()
        muc = MucKhoan(luong_ca_may={tt.id: 10e6, a.id: 10e6, b.id: 6e6, m.id: 10e6})
        yield SimpleNamespace(db=db, dan=dan, may=may, tt=tt, a=a, b=b, m=m, l1=l1, l2=l2, l3=l3, muc=muc)
    finally:
        db.close()


def _svc(muc, cach_tra=None):
    """Đứng thay PayrollService: mức khoán + kỳ lương (chưa tạo kỳ) + mốc lương. `cach_tra` =
    {nhân viên: an_cong_nhat} — True/False HCNS chọn tay, None = theo trạng thái."""
    sal = {e.id: SimpleNamespace(an_cong_nhat=v) for e, v in (cach_tra or {}).items()}
    return SimpleNamespace(muc_khoan=lambda y, m: muc,
                           payroll=SimpleNamespace(get_period_by_ym=lambda y, m: None,
                                                   latest_salaries_map=lambda on: sal))


def test_SO_tru_to_truong_moi_lan_ghi_ke_ca_khong_tick(nen):
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, nen.muc, so=True)
    lg = {r["batch_id"]: r for r in kq["so"]["lan_ghi"]}
    r2 = lg[nen.l2.id]
    assert r2["tien"] == 400_000
    assert [(t["emp"], t["che_do"], t["ty_le"], round(t["tien"])) for t in r2["to_truong"]] == \
        [(nen.tt.id, "chia", 5.0, 20_000)]
    assert {e: round(v) for e, v in r2["nguoi"].items()} == {nen.a.id: 237_500, nen.b.id: 142_500}
    assert r2["cong_thuc"] == "Giá cố định + SL ghi × Đơn giá khoán = 0 + 4.000 × 100 = 400.000"
    # Tổng theo người của bản ghi khớp tiền khoán engine vẫn trả cho bảng lương.
    tong: dict[int, float] = {}
    for r in kq["so"]["lan_ghi"]:
        for e, v in r["nguoi"].items():
            tong[e] = tong.get(e, 0) + v
    for t in kq["so"]["to_truong"]:
        tong[t["emp"]] = tong.get(t["emp"], 0) + t["tien"]
    assert {e: round(v) for e, v in tong.items()} == kq["khoan"]


def test_NGAN_SOI_lan_ghi_la_so_sau_trich_to_truong(nen):
    """Ngăn soi khoán SP của từng người: tiền lần ghi đã trích tổ trưởng, ghi % trích; không còn dòng
    trừ riêng; cộng dòng (trừ tăng ca khoán) ra đúng cột lương khoán."""
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, nen.muc)
    ds = kq["theo_nguoi"][nen.b.id]
    d = next(x for x in ds if x["loai"] == "lan_ghi" and x["batch_id"] == nen.l2.id)
    assert (d["tien"], d["to_truong"], d["tien_lan_ghi"]) == (142_500, [5.0], 400_000)
    assert (d["luong_bu_lo"], d["tong_luong_bu_lo"], d["ty_le"]) == (6e6, 16e6, 0.375)
    for e in (nen.tt.id, nen.a.id, nen.b.id):
        assert all(x["loai"] != "to_truong_tru" for x in kq["theo_nguoi"][e])
        assert sum(x["tien"] for x in kq["theo_nguoi"][e] if x["loai"] != "tang_ca_khoan") == kq["khoan"][e]
    tt = next(x for x in kq["theo_nguoi"][nen.tt.id] if x["loai"] == "to_truong")
    assert (tt["tien_lan_ghi"], tt["ty_le"], tt["tien"], tt["ghi_chu"]) == (1_400_000, 0.05, 70_000, "ăn chia")


def test_XEM_quy_chia_nguoi_va_doi_chieu(nen):
    ra = xem(nen.db, _svc(nen.muc), NAM, THANG, nen.dan.id, None)
    assert ra["quy"] == {"san_luong": 1_400_000, "dung_may": 0, "tang_ca": 200_000, "tong": 1_600_000}
    hang = {h["emp_id"]: h for h in ra["nguoi"]}
    assert set(hang) == {nen.tt.id, nen.a.id, nen.b.id}
    assert (hang[nen.tt.id]["san_luong"], hang[nen.tt.id]["to_truong"], hang[nen.tt.id]["tang_ca"]) == \
        (475_000, 70_000, 100_000)
    assert hang[nen.tt.id]["luong_khoan"] == 545_000, "lương khoán không gồm tăng ca khoán"
    assert hang[nen.a.id]["o_to_khac"] == 100_000 and hang[nen.a.id]["luong_khoan"] == 812_500
    assert hang[nen.a.id]["phan_bo_bu_lo"] is None and hang[nen.a.id]["luong_chinh"] is None
    dc = ra["doi_chieu"]
    assert dc["quy"] - dc["tang_ca"] + dc["o_to_khac"] == dc["luong_khoan"] == 1_500_000
    assert ra["to_truong"]["tien"] == 70_000 and ra["to_truong"]["che_do"] == "chia"
    assert [r["batch_id"] for r in ra["so"]] == [nen.l1.id, nen.l2.id]
    assert ra["so"][1]["to_truong"][0]["ten"] == "Quí"
    # Khối tổ khác: đủ người của lần ghi, người tổ kia ghi tên tổ sau tên.
    assert [r["batch_id"] for r in ra["khac"]] == [nen.l3.id]
    ng = {n["emp_id"]: n for n in ra["khac"][0]["nguoi"]}
    assert ng[nen.m.id]["to_ten"] == nen.may.name and ng[nen.a.id]["to_ten"] is None
    assert [d["tang_ca"] for d in ra["ngay"]] == [200_000, 0]


def test_XEM_cong_nhat_dung_trong_ty_le_chia_nhung_khong_huong(nen):
    """Thảo ăn công nhật: sổ vẫn chia phần cho Thảo (Trang không ăn thêm), lương khoán của tổ bớt
    đúng phần đó và dòng đối chiếu nói ra."""
    ra = xem(nen.db, _svc(nen.muc, {nen.b: True}), NAM, THANG, nen.dan.id, None)
    hang = {h["emp_id"]: h for h in ra["nguoi"]}
    assert hang[nen.b.id]["cong_nhat"] is True and hang[nen.b.id]["san_luong"] == 142_500
    assert hang[nen.a.id]["luong_khoan"] == 812_500, "phần công nhật không dồn sang người khác"
    dc = ra["doi_chieu"]
    assert dc["cong_nhat"] == 142_500
    assert dc["quy"] - dc["tang_ca"] - dc["cong_nhat"] + dc["o_to_khac"] == dc["luong_khoan"] == 1_357_500


@pytest.mark.parametrize("cach_tra, cong_nhat", [(None, True), (False, False)])
def test_XEM_thu_viec_mac_dinh_cong_nhat_tru_khi_chon_luong_khoan(nen, cach_tra, cong_nhat):
    """Thử việc không còn luật riêng (chủ 22/10/2026): mốc chưa chọn ⇒ công nhật; HCNS chọn Lương
    khoán ⇒ ăn khoán như người chính thức."""
    nen.b.status = STATUS_PROBATION
    nen.db.commit()
    ra = xem(nen.db, _svc(nen.muc, {nen.b: cach_tra}), NAM, THANG, nen.dan.id, None)
    hang = {h["emp_id"]: h for h in ra["nguoi"]}
    assert hang[nen.b.id]["thu_viec"] is True
    assert hang[nen.b.id]["cong_nhat"] is cong_nhat
    assert ra["doi_chieu"]["cong_nhat"] == (142_500 if cong_nhat else 0)
    assert ra["doi_chieu"]["luong_khoan"] == (1_357_500 if cong_nhat else 1_500_000)


def test_XEM_pham_vi_thieu_nguoi_la_cam(nen):
    with pytest.raises(KhoanTheoToForbidden):
        xem(nen.db, _svc(nen.muc), NAM, THANG, nen.dan.id, {nen.tt.id, nen.a.id})


def test_XEM_ky_khong_co_lan_ghi_tra_rong(nen):
    ra = xem(nen.db, _svc(nen.muc), NAM, THANG - 1, None, None)
    assert ra["cac_to"] == [] and ra["to_id"] is None and ra["so"] == []


def test_API_khoan_theo_to(client, nen, monkeypatch):
    from app.services.payroll_service import PayrollService

    monkeypatch.setattr(PayrollService, "muc_khoan", lambda self, y, m: nen.muc)
    r = client.get(f"/api/luong/khoan-theo-to?year={NAM}&month={THANG}&to_id={nen.dan.id}", headers=_h(client))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["quy"]["tong"] == 1_600_000
    assert {t["id"] for t in body["cac_to"]} >= {nen.dan.id, nen.may.id}
    assert body["so"][0]["nguoi"][0]["tien"] == 475_000
