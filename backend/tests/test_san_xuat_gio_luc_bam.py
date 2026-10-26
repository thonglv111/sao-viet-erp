"""Ghi sản lượng không gõ giờ (10/10/2026, chủ xưởng: *"thời gian sẽ theo cái nút ghi sản lượng"*).

Hộp Ghi sản lượng không còn ô Bắt đầu / Kết thúc: máy chủ lấy lúc bấm làm kết thúc, bắt đầu nối
lần ghi trước. Chống ghi trùng khi đó so số + người + việc, không so giờ.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.models.san_xuat_san_luong import SanXuatBatch
from tests.san_xuat_me_fixtures import T0, canh_me, tao_me, utc

# Fixtures + helper luồng thật.
from tests.test_san_xuat_thuc_thi import (  # noqa: F401
    admin,
    customer,
    db,
    lsx_svc,
    orders,
)


def test_khong_go_gio_thi_lay_luc_bam_va_noi_lan_truoc(db, orders, lsx_svc, admin, customer):
    _to, cv, _batch = canh_me(db, orders, lsx_svc, admin, customer, tot=50, ma="TO-GIO-1")
    truoc = datetime.now(timezone.utc)
    moi = tao_me(db, user=admin, cong_viec_id=cv.id, tong=10, tot=10)["batch_id"]
    sau = datetime.now(timezone.utc)

    b = db.get(SanXuatBatch, moi)
    assert utc(b.bat_dau) == T0 + timedelta(hours=1)     # nối kết thúc lần ghi trước
    assert truoc <= utc(b.ket_thuc) <= sau                # lúc bấm


def test_bam_lai_ngay_thi_khong_ra_lan_thu_hai(db, orders, lsx_svc, admin, customer):
    _to, cv, _batch = canh_me(db, orders, lsx_svc, admin, customer, tot=50, ma="TO-GIO-2")
    a = tao_me(db, user=admin, cong_viec_id=cv.id, tong=10, tot=10)["batch_id"]
    b = tao_me(db, user=admin, cong_viec_id=cv.id, tong=10, tot=10)["batch_id"]
    assert a == b
    c = tao_me(db, user=admin, cong_viec_id=cv.id, tong=5, tot=5)["batch_id"]
    assert c != a
    assert utc(db.get(SanXuatBatch, c).bat_dau) == utc(db.get(SanXuatBatch, a).ket_thuc)


def test_chi_gui_mot_dau_gio_thi_bao_loi(db, orders, lsx_svc, admin, customer):
    import pytest

    _to, cv, _batch = canh_me(db, orders, lsx_svc, admin, customer, tot=50, ma="TO-GIO-3")
    with pytest.raises(ValueError, match="bắt đầu và kết thúc"):
        tao_me(db, user=admin, cong_viec_id=cv.id, bat_dau=T0 + timedelta(hours=2), tong=5, tot=5)


# ── Đợt vá 26/10/2026: kỳ lương đã chốt (L-SX-43, L-SX-47) ──────────────────────────────────────

def _ky(db, nam, thang, tt):
    from app.models.payroll import PayrollPeriod

    db.add(PayrollPeriod(year=nam, month=thang, status=tt))
    db.commit()


def test_khong_go_gio_khong_lui_qua_dau_phien_dang_mo(db, orders, lsx_svc, admin, customer):
    """Lần ghi trước kết thúc từ tháng 8, tạm dừng rồi chạy lại hôm nay: lần ghi mới bắt đầu từ phiên
    đang mở, không nối đuôi lần ghi tháng 8 (L-SX-43)."""
    from app.models.san_xuat_thuc_thi import SanXuatPhienChay

    _to, cv, _batch = canh_me(db, orders, lsx_svc, admin, customer, tot=50, ma="TO-GIO-43A")
    dau_phien = datetime.now(timezone.utc) - timedelta(hours=2)
    db.add(SanXuatPhienChay(cong_viec_id=cv.id, so_thu_tu=1, bat_dau=dau_phien))
    db.commit()
    moi = tao_me(db, user=admin, cong_viec_id=cv.id, tong=10, tot=10)["batch_id"]
    assert utc(db.get(SanXuatBatch, moi).bat_dau) == dau_phien


def test_khong_go_gio_khong_lui_vao_ky_luong_da_chot(db, orders, lsx_svc, admin, customer):
    """Phiên chạy liền từ tháng 8 mà kỳ lương tháng 8 đã chốt: `bat_dau` kẹp về 00:00 ngày 01 tháng mở
    kế tiếp — lần ghi không rơi vào kỳ đã chốt, số kỳ đó không đổi (chủ chốt phương án B)."""
    from app.models.payroll import PERIOD_LOCKED
    from app.services.san_xuat.nguoi_trong_me import ngay_cua_me

    _to, cv, _batch = canh_me(db, orders, lsx_svc, admin, customer, tot=50, ma="TO-GIO-43B")
    _ky(db, 2026, 8, PERIOD_LOCKED)
    moi = tao_me(db, user=admin, cong_viec_id=cv.id, tong=10, tot=10)["batch_id"]
    from datetime import date

    assert ngay_cua_me(db.get(SanXuatBatch, moi).bat_dau) == date(2026, 9, 1)


def test_go_gio_vao_ky_luong_da_chot_bi_chan(db, orders, lsx_svc, admin, customer):
    import pytest
    from app.models.payroll import PERIOD_PAID

    _to, cv, _batch = canh_me(db, orders, lsx_svc, admin, customer, tot=50, ma="TO-GIO-43C")
    _ky(db, 2026, 8, PERIOD_PAID)
    with pytest.raises(ValueError, match="08/2026 đã chi"):
        tao_me(db, user=admin, cong_viec_id=cv.id, bat_dau=T0 + timedelta(hours=2),
               ket_thuc=T0 + timedelta(hours=3), tong=5, tot=5)


def test_sua_lan_ghi_ky_luong_da_chot_bi_chan(db, orders, lsx_svc, admin, customer):
    """L-SX-47: sửa số và "Cập nhật theo danh mục" của lần ghi tháng đã chốt lương — chặn, mẻ không đổi."""
    import pytest
    from app.models.payroll import PERIOD_LOCKED
    from app.services.san_xuat import san_luong, viec_khoan

    _to, cv, batch = canh_me(db, orders, lsx_svc, admin, customer, tot=50, ma="TO-GIO-47")
    _ky(db, 2026, 8, PERIOD_LOCKED)
    v0 = batch.version
    with pytest.raises(ValueError, match="08/2026 đã chốt"):
        san_luong.sua_so_me(db, user=admin, batch_id=batch.id, tot=40)
    with pytest.raises(ValueError, match="08/2026 đã chốt"):
        viec_khoan.cap_nhat_theo_danh_muc(db, user=admin, batch_id=batch.id)
    db.expire_all()
    b = db.get(SanXuatBatch, batch.id)
    assert float(b.tot) == 50 and b.version == v0
