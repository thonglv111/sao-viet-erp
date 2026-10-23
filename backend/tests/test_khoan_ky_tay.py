"""Kế toán lương sửa tay khoán ở màn Khoán theo tổ (23/10/2026) — `services/khoan_sua_tay.py` + engine.

Ba chỗ gõ: tiền một lần ghi (đè số máy, luật chia vẫn chạy), dòng tay (vào quỹ tổ, trích tổ trưởng, không
sinh tăng ca), cộng thêm từng người (cộng thẳng vào lương ngoài phép so). Kỳ đã chốt ⇒ chặn."""
from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest

from app.models.payroll import KhoanLanGhiTay
from app.models.user import User
from app.services.khoan_ky import KhoanKyService
from app.services.khoan_sua_tay import KhoanSuaTayService
from app.services.khoan_theo_to import xem
from app.services.payroll_service import PayrollForbidden, PayrollLocked, PayrollValidationError
from tests.test_hai_luong_khoi_sx import _svc as _payroll_svc
from tests.test_hai_luong_khoi_sx import _tinh
from tests.test_khoan_ky import CT_THANG, GIA_IN, NAM, THANG, _h
from tests.test_khoan_theo_to import _svc, nen  # noqa: F401 — fixture dùng chung


def _sua(nen, ky=None) -> KhoanSuaTayService:
    stub = SimpleNamespace(payroll=SimpleNamespace(get_period_by_ym=lambda y, m: ky))
    return KhoanSuaTayService(nen.db, stub)


def _admin(nen) -> User:
    return nen.db.query(User).filter(User.username == "admin").one()


def _lan(kq, batch_id) -> dict:
    return next(r for r in kq["so"]["lan_ghi"] if r["batch_id"] == batch_id)


def test_DE_TIEN_lan_ghi_chia_theo_luat_roi_tra_ve_so_may(nen):
    sua, ad = _sua(nen), _admin(nen)
    sua.sua_lan_ghi(nen.l2.id, actor=ad, duoc_xem=None, tien=1_000_000, ghi_chu="canh chia đôi")
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, nen.muc, so=True)
    r = _lan(kq, nen.l2.id)
    assert (r["tien"], r["tien_may"], r["tay"], r["ghi_chu_tay"]) == (1_000_000, 400_000, True, "canh chia đôi")
    assert r["sua_boi_id"] == ad.id and r["sua_luc"] is not None
    # Tổ trưởng vẫn trích 5% trên số đè; phần còn lại chia theo lương ca máy (10tr : 6tr).
    assert round(r["to_truong"][0]["tien"]) == 50_000
    assert {e: round(v) for e, v in r["nguoi"].items()} == {nen.a.id: 593_750, nen.b.id: 356_250}

    # Xoá trắng tiền ⇒ về số máy, ghi chú vẫn giữ dòng.
    sua.sua_lan_ghi(nen.l2.id, actor=ad, duoc_xem=None, tien=None)
    r = _lan(KhoanKyService(nen.db).tinh(NAM, THANG, nen.muc, so=True), nen.l2.id)
    assert (r["tien"], r["tien_may"], r["tay"], r["ghi_chu_tay"]) == (400_000, None, False, "canh chia đôi")
    # Bỏ cả ghi chú ⇒ không còn dòng sửa tay.
    sua.sua_lan_ghi(nen.l2.id, actor=ad, duoc_xem=None, ghi_chu="  ")
    assert nen.db.query(KhoanLanGhiTay).count() == 0


def test_THIEU_GIA_hien_trong_so_tien_0_de_tay_thi_canh_bao_rung(nen):
    from tests.test_khoan_ky import _Nen

    n = _Nen(nen.db)
    k = n.khoan(gia_theo_to=GIA_IN((nen.may, 0, 100)), cong_thuc=CT_THANG)   # tổ Dán chưa có giá
    l4 = n.ghi(nen.dan, k, date(NAM, THANG, 8), 500, [nen.a, nen.b])
    nen.db.commit()
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, nen.muc, so=True)
    assert _lan(kq, l4.id)["tien"] == 0
    assert any(t["batch_id"] == l4.id for t in kq["thieu_gia"])

    _sua(nen).sua_lan_ghi(l4.id, actor=_admin(nen), duoc_xem=None, tien=160_000)
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, nen.muc, so=True)
    assert _lan(kq, l4.id)["tien"] == 160_000
    assert not any(t["batch_id"] == l4.id for t in kq["thieu_gia"])


def test_DONG_TAY_vao_quy_trich_to_truong_khong_sinh_tang_ca(nen):
    sua, ad = _sua(nen), _admin(nen)
    did = sua.them_dong_tay(year=NAM, month=THANG, to_id=nen.dan.id, ngay=date(NAM, THANG, 5),
                            noi_dung="Gấp hộp theo giờ", tien=300_000, nguoi_ids=[nen.a.id, nen.b.id],
                            ghi_chu="4 giờ", actor=ad, duoc_xem=None)
    ra = xem(nen.db, _svc(nen.muc), NAM, THANG, nen.dan.id, None)
    # Ngày 5 đã vượt chỉ tiêu — dòng tay cùng ngày vẫn không đẻ thêm tăng ca.
    assert ra["quy"] == {"san_luong": 1_400_000, "dong_tay": 300_000, "dung_may": 0, "tang_ca": 200_000,
                         "tong": 1_900_000}
    assert ra["to_truong"]["tien"] == 70_000 + 15_000
    d = next(r for r in ra["so"] if r["loai"] == "dong_tay")
    assert (d["dong_tay_id"], d["batch_id"], d["noi_dung"], d["tien"], d["ghi_chu_tay"]) == \
        (did, None, "Gấp hộp theo giờ", 300_000, "4 giờ")
    assert {n["emp_id"]: n["tien"] for n in d["nguoi"]} == {nen.a.id: 178_125, nen.b.id: 106_875}
    dc = ra["doi_chieu"]
    assert dc["quy"] - dc["tang_ca"] + dc["o_to_khac"] == dc["luong_khoan"]

    # Ngăn soi khoán ở bảng lương thấy dòng tay như một lần ghi.
    kq = KhoanKyService(nen.db).tinh(NAM, THANG, nen.muc)
    x = next(x for x in kq["theo_nguoi"][nen.b.id] if x["cong_doan"] == "Gấp hộp theo giờ")
    assert (x["loai"], x["batch_id"], x["tien"]) == ("lan_ghi", None, 106_875)

    sua.sua_dong_tay(did, actor=ad, duoc_xem=None, tien=160_000, nguoi_ids=[nen.b.id])
    ra = xem(nen.db, _svc(nen.muc), NAM, THANG, nen.dan.id, None)
    d = next(r for r in ra["so"] if r["loai"] == "dong_tay")
    assert {n["emp_id"]: n["tien"] for n in d["nguoi"]} == {nen.b.id: 152_000}
    sua.xoa_dong_tay(did, actor=ad, duoc_xem=None)
    ra = xem(nen.db, _svc(nen.muc), NAM, THANG, nen.dan.id, None)
    assert ra["quy"]["dong_tay"] == 0 and all(r["loai"] == "lan_ghi" for r in ra["so"])


def test_DONG_TAY_ngay_ngoai_ky_va_khong_nguoi_bi_chan(nen):
    sua, ad = _sua(nen), _admin(nen)
    kw = dict(year=NAM, month=THANG, to_id=nen.dan.id, noi_dung="x", tien=1, ghi_chu=None, actor=ad,
              duoc_xem=None)
    with pytest.raises(PayrollValidationError):
        sua.them_dong_tay(ngay=date(NAM, THANG + 1, 1), nguoi_ids=[nen.a.id], **kw)
    with pytest.raises(PayrollValidationError):
        sua.them_dong_tay(ngay=date(NAM, THANG, 1), nguoi_ids=[], **kw)


def test_CONG_THEM_hien_o_cot_va_vao_engine(nen):
    sua, ad = _sua(nen), _admin(nen)
    sua.sua_cong_them(year=NAM, month=THANG, to_id=nen.dan.id, emp_id=nen.b.id, actor=ad, duoc_xem=None,
                      tien=-50_000, ghi_chu="trừ canh máy")
    assert KhoanKyService(nen.db).tinh(NAM, THANG, nen.muc)["cong_them"] == {nen.b.id: -50_000}
    ra = xem(nen.db, _svc(nen.muc), NAM, THANG, nen.dan.id, None)
    h = {x["emp_id"]: x for x in ra["nguoi"]}[nen.b.id]
    assert (h["cong_them"], h["cong_them_ghi_chu"], h["cong_them_sua_boi"]) == \
        (-50_000, "trừ canh máy", ad.name or ad.username)
    assert ra["quy"]["tong"] == 1_600_000, "cộng thêm không vào quỹ tổ"
    sua.sua_cong_them(year=NAM, month=THANG, to_id=nen.dan.id, emp_id=nen.b.id, actor=ad, duoc_xem=None,
                      tien=None, ghi_chu="")
    assert KhoanKyService(nen.db).tinh(NAM, THANG, nen.muc)["cong_them"] == {}


def test_CONG_THEM_cong_ngoai_phep_so_hai_luong(client):
    """Khoán 24tr < bù lỗ 26tr ⇒ ăn bù lỗ; cộng thêm 3tr cộng SAU phép so (nếu vào vế khoán thì 27tr đã
    thắng bù lỗ)."""
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        svc = _payroll_svc(db)
        kq = _tinh(svc, svc.get_params(), actual_cong=26, khoan=24_000_000, khoan_cong_them=3_000_000,
                   che_do_khoan=True)
        assert kq["lay_bu_lo"] is True and kq["khoan_cong_them"] == 3_000_000
        assert kq["gross"] == 26_000_000 + 3_000_000
    finally:
        db.close()


def test_KY_DA_CHOT_va_NGOAI_PHAM_VI_bi_chan(nen):
    ad = _admin(nen)
    with pytest.raises(PayrollLocked):
        _sua(nen, SimpleNamespace(status="locked")).sua_lan_ghi(nen.l2.id, actor=ad, duoc_xem=None, tien=1)
    with pytest.raises(PayrollLocked):
        _sua(nen, SimpleNamespace(status="paid")).sua_cong_them(
            year=NAM, month=THANG, to_id=nen.dan.id, emp_id=nen.a.id, actor=ad, duoc_xem=None, tien=1)
    with pytest.raises(PayrollForbidden):
        _sua(nen).sua_lan_ghi(nen.l2.id, actor=ad, duoc_xem={nen.tt.id, nen.a.id}, tien=1)
    ra = xem(nen.db, _svc(nen.muc), NAM, THANG, nen.dan.id, None, co_quyen_sua=True)
    assert (ra["khoa"], ra["sua_duoc"]) == (False, True)
    assert {t["emp_id"] for t in ra["thanh_vien"]} == {nen.tt.id, nen.a.id, nen.b.id}


def test_API_sua_tay(client, nen, monkeypatch):
    from app.services.payroll_service import PayrollService

    monkeypatch.setattr(PayrollService, "muc_khoan", lambda self, y, m: nen.muc)
    h = _h(client)
    r = client.put(f"/api/luong/khoan-theo-to/lan-ghi/{nen.l2.id}", json={"tien": 700_000}, headers=h)
    assert r.status_code == 204, r.text
    r = client.post("/api/luong/khoan-theo-to/dong-tay", headers=h,
                    json={"year": NAM, "month": THANG, "to_id": nen.dan.id, "ngay": f"{NAM}-{THANG}-09",
                          "noi_dung": "Kiểm lựa", "tien": 100_000, "nguoi_ids": [nen.a.id]})
    assert r.status_code == 201, r.text
    did = r.json()["id"]
    r = client.put("/api/luong/khoan-theo-to/cong-them", headers=h,
                   json={"year": NAM, "month": THANG, "to_id": nen.dan.id, "emp_id": nen.a.id, "tien": 20_000})
    assert r.status_code == 204, r.text
    r = client.patch(f"/api/luong/khoan-theo-to/dong-tay/{did}", json={"ghi_chu": "2 giờ"}, headers=h)
    assert r.status_code == 204, r.text

    body = client.get(f"/api/luong/khoan-theo-to?year={NAM}&month={THANG}&to_id={nen.dan.id}", headers=h).json()
    assert body["sua_duoc"] is True
    lg = next(x for x in body["so"] if x["batch_id"] == nen.l2.id)
    assert (lg["tien"], lg["tien_may"], lg["tay"]) == (700_000, 400_000, True) and lg["sua_boi"]
    dt = next(x for x in body["so"] if x["loai"] == "dong_tay")
    assert (dt["tien"], dt["ghi_chu_tay"]) == (100_000, "2 giờ")
    assert body["quy"]["dong_tay"] == 100_000
    assert {x["emp_id"]: x["cong_them"] for x in body["nguoi"]}[nen.a.id] == 20_000

    r = client.post("/api/luong/khoan-theo-to/dong-tay", headers=h,
                    json={"year": NAM, "month": THANG, "to_id": nen.dan.id, "ngay": f"{NAM}-{THANG + 1}-01",
                          "tien": 1, "nguoi_ids": [nen.a.id]})
    assert r.status_code == 400, r.text
    r = client.delete(f"/api/luong/khoan-theo-to/dong-tay/{did}", headers=h)
    assert r.status_code == 204, r.text
