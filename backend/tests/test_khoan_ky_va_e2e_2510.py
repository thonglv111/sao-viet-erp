"""Vá đợt e2e 25/10/2026 — engine khoán + màn Khoán theo tổ (Đợt 6).

L-SX-27 lần ghi ở công đoạn chưa có Khoán · L-SX-41 nhánh chặn vẫn vào sổ · L-SX-29 lý do chưa tính
· L-SX-34 tiền âm giữ âm + cảnh báo · L-SX-32 phạm vi hẹp không 403 lúc mở · L-SX-33 Cộng thêm của
người chuyển tổ.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace

from app.db import SessionLocal
from app.models.employee import STATUS_ACTIVE
from app.models.payroll import KhoanCongThem, KhoanLanGhiTay
from app.models.san_xuat import SanXuatCongViec
from app.models.san_xuat_san_luong import SanXuatBatch, SanXuatBatchNguoi
from app.repositories.khoan_ky_repo import KhoanKyRepository
from app.services.khoan_ky import KhoanKyService, MucKhoan
from app.services.khoan_theo_to import xem
from tests.test_khoan_ky import CT_THANG, GIA_IN, NAM, THANG, _h, _muc_bang_nhau, _Nen


def _ghi_khong_khoan(n: _Nen, to, ngay: date, sl: float, nguoi) -> SanXuatBatch:
    """Lần ghi ở công đoạn chưa có cấu hình Khoán: không ảnh chụp Khoán nào."""
    cv = SanXuatCongViec(goi_id=n.goi.id, department_id=to.id, ten_cong_doan="Cắt giấy cuộn")
    n.db.add(cv)
    n.db.flush()
    luc = datetime(ngay.year, ngay.month, ngay.day, 3, 0, tzinfo=timezone.utc)
    b = SanXuatBatch(cong_viec_id=cv.id, bat_dau=luc, ket_thuc=luc, tong=sl, tot=sl, hong=0, don_vi="to")
    n.db.add(b)
    n.db.flush()
    for e in nguoi:
        n.db.add(SanXuatBatchNguoi(batch_id=b.id, employee_id=e.id, department_id=to.id))
    n.db.flush()
    return b


def _svc(muc):
    return SimpleNamespace(muc_khoan=lambda y, m: muc,
                           payroll=SimpleNamespace(get_period_by_ym=lambda y, m: None,
                                                   latest_salaries_map=lambda on: {}))


def test_L_SX_27_lan_ghi_chua_khoan_chi_bao_o_to_co_khoan_hoac_nguoi_an_khoan(client):
    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        in_, cat = n.to("In"), n.to("Cắt thời gian")
        a, c = n.nv(in_, "A"), n.nv(cat, "C")
        k = n.khoan(gia_theo_to=GIA_IN((in_, 0, 100)), cong_thuc=CT_THANG)
        n.ghi(in_, k, date(NAM, THANG, 5), 1_000, [a])
        lg_in = _ghi_khong_khoan(n, in_, date(NAM, THANG, 6), 500, [a])
        lg_cat = _ghi_khong_khoan(n, cat, date(NAM, THANG, 6), 500, [c])
        db.commit()

        kq = KhoanKyService(db).tinh(NAM, THANG, _muc_bang_nhau(db), so=True)
        chua = [t for t in kq["thieu_gia"] if t["sua"] == "chua_khoan"]
        assert [t["batch_id"] for t in chua] == [lg_in.id], "tổ Cắt không có lần ghi có Khoán ⇒ im"
        assert chua[0]["ly_do"] == "công đoạn chưa có cấu hình Khoán"
        r = next(x for x in kq["so"]["lan_ghi"] if x["batch_id"] == lg_in.id)
        assert (r["tien"], r["khong_khoan"], r["nguoi"], r["chua_tinh"]) == \
            (0.0, True, {}, ["công đoạn chưa có cấu hình Khoán"])
        assert kq["khoan"] == {a.id: 100_000}, "lần ghi không Khoán không đổi tiền"

        # Người ăn lương khoán được tick ⇒ tổ Cắt cũng bị nhắc.
        muc = MucKhoan(luong_ca_may=_muc_bang_nhau(db).luong_ca_may, an_khoan=frozenset({c.id}))
        kq = KhoanKyService(db).tinh(NAM, THANG, muc)
        assert {t["batch_id"] for t in kq["thieu_gia"] if t["sua"] == "chua_khoan"} == {lg_in.id, lg_cat.id}
    finally:
        db.close()


def test_L_SX_27_to_chi_co_lan_ghi_khong_khoan_van_co_trong_o_to(client):
    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        in_ = n.to("In")
        a = n.nv(in_, "A")
        a.status = STATUS_ACTIVE
        _ghi_khong_khoan(n, in_, date(NAM, THANG, 6), 500, [a])
        db.commit()
        muc = MucKhoan(luong_ca_may={a.id: 1.0}, an_khoan=frozenset({a.id}))
        ra = xem(db, _svc(muc), NAM, THANG, None, None)
        assert in_.id in {t["id"] for t in ra["cac_to"]}
        assert ra["to_id"] == in_.id and ra["so"][0]["khong_khoan"] is True and ra["so"][0]["tien"] == 0
    finally:
        db.close()


def test_L_SX_29_cong_thuc_loi_so_va_ngan_soi_co_ly_do(client):
    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        m2 = n.to("Máy 2 màu")
        a = n.nv(m2, "A")
        k = n.khoan(gia_theo_to=GIA_IN((m2, 150_000, 30)), cong_thuc="gia_co_dinh / (sl_ghi - 3000)")
        lg = n.ghi(m2, k, date(NAM, THANG, 5), 3_000, [a])
        db.commit()
        kq = KhoanKyService(db).tinh(NAM, THANG, _muc_bang_nhau(db), so=True)
        r = next(x for x in kq["so"]["lan_ghi"] if x["batch_id"] == lg.id)
        assert r["tien"] == 0 and r["chua_tinh"][0].startswith("công thức khoán lỗi")
        # Ngăn soi (so=False) cũng có dòng 0 đ kèm lý do.
        kq = KhoanKyService(db).tinh(NAM, THANG, _muc_bang_nhau(db))
        d = next(x for x in kq["theo_nguoi"][a.id] if x["loai"] == "lan_ghi")
        assert d["tien"] == 0 and d["chua_tinh"][0].startswith("công thức khoán lỗi")
    finally:
        db.close()


def test_L_SX_34_tien_am_giu_am_va_canh_bao(client):
    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        m2 = n.to("Máy 2 màu")
        a = n.nv(m2, "A")
        k = n.khoan(gia_theo_to=GIA_IN((m2, 0, 100)), cong_thuc="sl_ghi * don_gia_khoan - 500000")
        n.ghi(m2, k, date(NAM, THANG, 5), 1_000, [a])
        db.commit()
        kq = KhoanKyService(db).tinh(NAM, THANG, _muc_bang_nhau(db))
        assert kq["khoan"][a.id] == -400_000
        assert any("ra âm -400.000" in c for c in kq["canh_bao"])
    finally:
        db.close()


def test_L_SX_41_go_tay_roi_go_cau_hinh_van_trong_so_va_an_tien(client, monkeypatch):
    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        m2 = n.to("Máy 2 màu")
        a = n.nv(m2, "A")
        k = n.khoan(gia_theo_to=GIA_IN((m2, 0, 100)), cong_thuc=CT_THANG)
        lg = n.ghi(m2, k, date(NAM, THANG, 5), 1_000, [a])
        db.commit()
        # Gỡ cấu hình Khoán của công đoạn: engine không còn tìm thấy nó.
        monkeypatch.setattr(KhoanKyRepository, "khoan_theo_id", lambda self, ids: {})

        kq = KhoanKyService(db).tinh(NAM, THANG, _muc_bang_nhau(db), so=True)
        r = next(x for x in kq["so"]["lan_ghi"] if x["batch_id"] == lg.id)
        assert r["tien"] == 0 and r["chua_tinh"] == ["cấu hình Khoán của công đoạn đã bị gỡ"]
        assert [t["sua"] for t in kq["thieu_gia"]] == ["cau_hinh"]

        db.add(KhoanLanGhiTay(batch_id=lg.id, tien=450_000))
        db.commit()
        kq = KhoanKyService(db).tinh(NAM, THANG, _muc_bang_nhau(db), so=True)
        r = next(x for x in kq["so"]["lan_ghi"] if x["batch_id"] == lg.id)
        assert r["tien"] == 450_000 and r["tay"] is True
        assert kq["khoan"] == {a.id: 450_000}, "số kế toán gõ vẫn vào lương"
        assert kq["thieu_gia"] == [], "đã gõ tay ⇒ câu cấu hình gỡ rụng"
    finally:
        db.close()


def test_L_SX_41_khong_nguoi_go_tay_van_con_canh_bao(client):
    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        m2 = n.to("Máy 2 màu")
        k = n.khoan(gia_theo_to=GIA_IN((m2, 0, 100)), cong_thuc=CT_THANG)
        lg = n.ghi(m2, k, date(NAM, THANG, 5), 1_000, [])
        db.add(KhoanLanGhiTay(batch_id=lg.id, tien=300_000))
        db.commit()
        kq = KhoanKyService(db).tinh(NAM, THANG, _muc_bang_nhau(db), so=True)
        r = next(x for x in kq["so"]["lan_ghi"] if x["batch_id"] == lg.id)
        assert (r["tien"], r["nguoi"]) == (300_000, {})
        assert [(t["batch_id"], t["sua"]) for t in kq["thieu_gia"]] == [(lg.id, "lan_ghi")]
        assert kq["khoan"] == {}
    finally:
        db.close()


def test_L_SX_32_pham_vi_hep_o_to_chi_co_to_cua_minh_khong_403(client):
    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        x, y = n.to("A tổ ngoài"), n.to("B tổ mình")
        px, py = n.nv(x, "X"), n.nv(y, "Y")
        k = n.khoan(gia_theo_to=GIA_IN((x, 0, 100), (y, 0, 100)), cong_thuc=CT_THANG)
        n.ghi(x, k, date(NAM, THANG, 5), 1_000, [px])
        n.ghi(y, k, date(NAM, THANG, 5), 2_000, [py])
        db.commit()
        muc = MucKhoan(luong_ca_may={px.id: 1.0, py.id: 1.0})
        ra = xem(db, _svc(muc), NAM, THANG, None, {py.id})
        assert [t["id"] for t in ra["cac_to"]] == [y.id]
        assert ra["to_id"] == y.id and ra["quy"]["san_luong"] == 200_000
    finally:
        db.close()


def test_L_SX_33_cong_them_nguoi_chuyen_to_hien_o_to_da_go(client):
    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        cu, moi = n.to("Tổ cũ"), n.to("Tổ mới")
        a, c = n.nv(cu, "A"), n.nv(moi, "C")
        k = n.khoan(gia_theo_to=GIA_IN((cu, 0, 100), (moi, 0, 100)), cong_thuc=CT_THANG)
        n.ghi(cu, k, date(NAM, THANG, 5), 1_000, [a])
        n.ghi(moi, k, date(NAM, THANG, 20), 1_000, [c])
        db.add(KhoanCongThem(nam=NAM, thang=THANG, department_id=cu.id, employee_id=c.id, tien=-50_000))
        db.commit()
        muc = MucKhoan(luong_ca_may={a.id: 1.0, c.id: 1.0})
        o_cu = {h["emp_id"]: h for h in xem(db, _svc(muc), NAM, THANG, cu.id, None)["nguoi"]}
        assert o_cu[c.id]["cong_them"] == -50_000 and o_cu[c.id]["la_thanh_vien"] is False
        o_moi = {h["emp_id"]: h for h in xem(db, _svc(muc), NAM, THANG, moi.id, None)["nguoi"]}
        assert o_moi[c.id]["cong_them"] is None, "chỉ hiện ở đúng một tổ"
    finally:
        db.close()


def test_API_khoan_theo_to_tra_chua_tinh_va_khong_khoan(client, monkeypatch):
    """Schema trả về phải khai hai trường mới — không thì FastAPI lọc mất."""
    from app.services.payroll_service import PayrollService

    db = SessionLocal()
    try:
        n = _Nen(db)
        in_ = n.to("In")
        a = n.nv(in_, "A")
        k = n.khoan(gia_theo_to=GIA_IN((in_, 0, 100)), cong_thuc="gia_co_dinh / (sl_ghi - 1000)")
        n.ghi(in_, k, date(NAM, THANG, 5), 1_000, [a])
        lg0 = _ghi_khong_khoan(n, in_, date(NAM, THANG, 6), 500, [a])
        db.commit()
        muc = MucKhoan(luong_ca_may={a.id: 1.0})
        monkeypatch.setattr(PayrollService, "muc_khoan", lambda self, y, m: muc)
        r = client.get(f"/api/luong/khoan-theo-to?year={NAM}&month={THANG}&to_id={in_.id}", headers=_h(client))
        assert r.status_code == 200, r.text
        so = {x["batch_id"]: x for x in r.json()["so"]}
        assert so[lg0.id]["khong_khoan"] is True
        assert any(x["chua_tinh"] and x["chua_tinh"][0].startswith("công thức khoán lỗi") for x in so.values())
    finally:
        db.close()


def test_L_SX_32_to_dinh_nguoi_ngoai_pham_vi_rot_khoi_o_to_mo_tu_to_ke(client):
    """Tổ đầu theo tên có người tổ khác được tick (ngoài phạm vi) ⇒ không lọt vào ô Tổ, màn mở ở tổ
    kế tiếp; chọn đích danh tổ đó vẫn 403."""
    import pytest

    from app.services.khoan_theo_to import KhoanTheoToForbidden

    client
    db = SessionLocal()
    try:
        n = _Nen(db)
        a_to, b_to, ngoai = n.to("A tổ dính"), n.to("B tổ sạch"), n.to("Z tổ ngoài")
        pa, pb_, pz = n.nv(a_to, "PA"), n.nv(b_to, "PB"), n.nv(ngoai, "PZ")
        k = n.khoan(gia_theo_to=GIA_IN((a_to, 0, 100), (b_to, 0, 100)), cong_thuc=CT_THANG)
        n.ghi(a_to, k, date(NAM, THANG, 5), 1_000, [pa, pz])
        n.ghi(b_to, k, date(NAM, THANG, 5), 1_000, [pb_])
        db.commit()
        muc = MucKhoan(luong_ca_may={pa.id: 1.0, pb_.id: 1.0, pz.id: 1.0})
        ra = xem(db, _svc(muc), NAM, THANG, None, {pa.id, pb_.id})
        assert [t["id"] for t in ra["cac_to"]] == [b_to.id] and ra["to_id"] == b_to.id
        with pytest.raises(KhoanTheoToForbidden):
            xem(db, _svc(muc), NAM, THANG, a_to.id, {pa.id, pb_.id})
    finally:
        db.close()
