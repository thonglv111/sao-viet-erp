"""mg 0480/0481 — chuyển LẦN gia công ngoài cũ sang bảng `tgc_*` rồi gỡ bảng cũ (plan Task 2.2).

Model cũ đã gỡ nên bảng `gia_cong_ngoai` + cột `gia_cong_ngoai_id` dựng lại bằng DDL thô trên SQLite.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import inspect, text

from app.db_migrations import _migrate_tgc_chuyen_du_lieu_cu, _migrate_tgc_go_gia_cong_ngoai
from app.models.purchase import Supplier
from app.models.san_xuat import SanXuatCongViec
from app.models.stock_request import REQ_XUAT, StockRequest, StockRequestLine
from app.models.thue_gia_cong import (
    TgcDon, TgcDonDong, TgcNhaGiaCong, TgcPhieuGiao, TgcPhieuGiaoDong, TgcPhieuNhan, TgcPhieuNhanDong,
    TgcViec,
)
from app.models.vat_lieu_kho import HANG_GIAY
from tests.gia_cong_fixtures import dung_lenh_gia_cong
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401

_DDL_CU = """
CREATE TABLE gia_cong_ngoai (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lsx_id INTEGER, bai_ghep_id INTEGER, kieu VARCHAR(12) NOT NULL,
    nha_cung_cap_id INTEGER, nha_cung_cap_ten VARCHAR(255) NOT NULL DEFAULT '',
    ten_viec VARCHAR(255) NOT NULL DEFAULT '', don_vi VARCHAR(40), sl_dat NUMERIC(18,3),
    xuong_cap_giay BOOLEAN NOT NULL DEFAULT 0, mang_di_boi_id INTEGER, mang_di_luc DATETIME,
    sl_gui NUMERIC(18,3), chot_boi_id INTEGER, chot_luc DATETIME, sl_cuoi NUMERIC(18,3),
    noi_ve VARCHAR(8), huy_boi_id INTEGER, huy_luc DATETIME, ly_do_huy VARCHAR(500),
    created_by INTEGER, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
)"""

_LUC = datetime(2026, 11, 1, 8, 0, tzinfo=timezone.utc)


def _lan(sess, **kw) -> int:
    gt = {"lsx_id": None, "kieu": "mot_phan", "nha_cung_cap_id": None, "nha_cung_cap_ten": "",
          "ten_viec": "", "don_vi": None, "sl_dat": None, "xuong_cap_giay": False,
          "mang_di_luc": None, "sl_gui": None, "chot_luc": None, "sl_cuoi": None, "noi_ve": None,
          "huy_luc": None, "created_by": None, "created_at": _LUC, "updated_at": _LUC, **kw}
    cot = ", ".join(gt)
    return int(sess.execute(text(
        f"INSERT INTO gia_cong_ngoai ({cot}) VALUES ({', '.join(':' + k for k in gt)}) RETURNING id"),
        gt).scalar_one())


def _dung_du_lieu_cu(sess, orders, lsx_svc, admin, customer):
    lsx_id = dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, buoc=[
        ("In", "may", None, 250, "to"),
        ("Cán màng", "thue_ngoai", None, 250, "to"),
        ("Dán", "may", None, 250, "to"),
    ])
    # Phát hành ở code mới đã sinh việc — xoá đi để giả DB cũ chưa có `tgc_*`.
    sess.query(SanXuatCongViec).filter_by(lsx_id=lsx_id).update({"tgc_viec_id": None})
    sess.query(TgcViec).delete()
    sess.commit()
    sess.execute(text(_DDL_CU))
    for b in ("san_xuat_cong_viec", "stock_requests", "delivery_trips", "payment_vouchers"):
        sess.execute(text(f"ALTER TABLE {b} ADD COLUMN gia_cong_ngoai_id INTEGER"))
    # Lần cũ trỏ NHÀ CUNG CẤP; mg 0480 đổi sang nhà gia công cùng tên (danh sách riêng, mg 0484).
    a = Supplier(name="Cán màng Minh Long")
    sess.add(a)
    sess.flush()
    nha = {"nha_cung_cap_id": a.id, "nha_cung_cap_ten": "Tên chụp cũ"}

    chua_mang = _lan(sess, lsx_id=lsx_id, ten_viec="Bế", don_vi="cai", sl_dat=1000, **nha)
    da_chot = _lan(sess, lsx_id=lsx_id, ten_viec="Cán màng", don_vi="to", mang_di_luc=_LUC,
                   sl_gui=250, chot_luc=_LUC, sl_cuoi=250, noi_ve="xuong", **nha)
    tron_goi = _lan(sess, lsx_id=lsx_id, kieu="tron_goi", ten_viec="Gia công trọn gói",
                    don_vi="cai", sl_dat=5000, xuong_cap_giay=True, **nha)
    _lan(sess, lsx_id=lsx_id, ten_viec="Đã huỷ", huy_luc=_LUC, **nha)
    cv = sess.query(SanXuatCongViec).filter_by(lsx_id=lsx_id, ten_cong_doan="Cán màng").one()
    sess.execute(text("UPDATE san_xuat_cong_viec SET gia_cong_ngoai_id = :g WHERE id = :c"),
                 {"g": da_chot, "c": cv.id})
    req = StockRequest(ma="XK26-9001", loai=REQ_XUAT, nguoi_tao_id=admin.id, trang_thai="pending")
    sess.add(req)
    sess.flush()
    sess.add(StockRequestLine(request_id=req.id, hang_loai=HANG_GIAY, hang_id=1, dvt="to",
                              sl_de_nghi=5200, kho_rong=790, kho_dai=1090))
    sess.execute(text("UPDATE stock_requests SET gia_cong_ngoai_id = :g WHERE id = :r"),
                 {"g": tron_goi, "r": req.id})
    sess.commit()
    return lsx_id, cv.id, req.id, (chua_mang, da_chot, tron_goi)


def test_chuyen_lan_cu_sang_tgc(sess, orders, lsx_svc, admin, customer):
    _lsx_id, cv_id, req_id, _ = _dung_du_lieu_cu(sess, orders, lsx_svc, admin, customer)
    _migrate_tgc_chuyen_du_lieu_cu(sess)
    sess.expire_all()

    viecs = sess.query(TgcViec).order_by(TgcViec.id).all()
    assert [v.ten_viec for v in viecs] == ["Bế", "Cán màng", "Gia công trọn gói"]
    assert sess.query(TgcDon).count() == 3
    assert all(float(d.don_gia) == 0 for d in sess.query(TgcDonDong))
    assert all(d.dat_luc is not None for d in sess.query(TgcDon))
    assert sess.get(SanXuatCongViec, cv_id).tgc_viec_id == viecs[1].id
    (nha,) = sess.query(TgcNhaGiaCong).all()
    assert nha.ten == "Cán màng Minh Long" and nha.active
    assert {d.nha_cung_cap_id for d in sess.query(TgcDon)} == {nha.id}

    # Lần đã mang đi + chốt: phiếu giao bán thành phẩm 250, phiếu nhận 250 về xưởng, hao hụt 0.
    dong_chot = sess.query(TgcDonDong).filter_by(viec_id=viecs[1].id).one()
    assert dong_chot.hoan_tat_luc is not None and float(dong_chot.hao_hut) == 0
    (gd,) = sess.query(TgcPhieuGiaoDong).filter_by(don_dong_id=dong_chot.id).all()
    assert gd.loai == "ban_thanh_pham" and float(gd.so_luong) == 250
    (nd,) = sess.query(TgcPhieuNhanDong).filter_by(don_dong_id=dong_chot.id).all()
    assert float(nd.sl_dat) == 250 and nd.noi_ve == "xuong"
    assert sess.query(TgcPhieuNhan).count() == 1

    # Trọn gói xưởng cấp giấy: phiếu giao dòng vật tư, đề nghị xuất trỏ về phiếu giao.
    dong_tg = sess.query(TgcDonDong).filter_by(viec_id=viecs[2].id).one()
    (vt,) = sess.query(TgcPhieuGiaoDong).filter_by(don_dong_id=dong_tg.id).all()
    assert vt.loai == "vat_tu" and vt.hang_loai == HANG_GIAY and float(vt.so_luong) == 5200
    assert sess.get(StockRequest, req_id).tgc_phieu_giao_id == vt.phieu_id
    assert sess.query(TgcPhieuGiao).count() == 2

    # Lần chưa mang đi: đơn đã đặt, chưa phiếu nào.
    dong_cho = sess.query(TgcDonDong).filter_by(viec_id=viecs[0].id).one()
    assert dong_cho.hoan_tat_luc is None
    assert sess.query(TgcPhieuGiaoDong).filter_by(don_dong_id=dong_cho.id).count() == 0

    # Chạy lại vô hại.
    _migrate_tgc_chuyen_du_lieu_cu(sess)
    assert sess.query(TgcViec).count() == 3


def test_go_bang_cu_sau_khi_chuyen(sess, orders, lsx_svc, admin, customer):
    _dung_du_lieu_cu(sess, orders, lsx_svc, admin, customer)
    _migrate_tgc_chuyen_du_lieu_cu(sess)
    _migrate_tgc_go_gia_cong_ngoai(sess)
    insp = inspect(sess.get_bind())
    assert "gia_cong_ngoai" not in insp.get_table_names()
    _migrate_tgc_go_gia_cong_ngoai(sess)   # idempotent
