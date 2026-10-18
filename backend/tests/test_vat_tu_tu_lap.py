"""Phát hành lệnh tự lập yêu cầu xuất vật tư cho từng bước (spec
`docs/superpowers/specs/2026-10-18-tu-lap-yeu-cau-xuat-khi-phat-hanh-design.md` §4).

Chạy trên LUỒNG THẬT của màn Xếp lịch 3 (đơn → chuyển SX → tạo lệnh → sẵn sàng → đặt mốc →
phát hành), dùng lại fixture của `test_xep_lich_lenh_service.py`.
"""
from __future__ import annotations

from datetime import datetime

from app.models.san_xuat import SanXuatCongViec
from app.models.san_xuat_vat_tu import SanXuatVatTuDeNghi
from app.models.stock_request import StockRequest
from tests.test_xep_lich_lenh_service import (  # noqa: F401
    _hai_lsx_san_sang, _khai_giay_len_buoc_in, admin, customer, db, hai_lenh, lenh, lsx_svc,
    orders, svc3,
)

_MOC = datetime(2026, 9, 11, 8, 0)


def _cvs(db, lsx_id):
    return db.query(SanXuatCongViec).filter(SanXuatCongViec.lsx_id == lsx_id).order_by(
        SanXuatCongViec.id).all()


def _dns(db, cv_id):
    return db.query(SanXuatVatTuDeNghi).filter(SanXuatVatTuDeNghi.cong_viec_id == cv_id).all()


def _them_vat_tu(db, buoc, *, ma="KEO-TL", don_vi="kg", so_luong=2.0):
    """Khai một dòng vật tư (không phải giấy) lên bước lệnh, mã khai đơn vị gốc `don_vi`."""
    from app.models.lsx import LsxCongDoanVatTu
    from app.models.vat_lieu_kho import VatTuInAn

    vt = VatTuInAn(ma=ma, ten=f"Vật tư {ma}", don_vi_gia=don_vi, don_gia=0, active=True)
    db.add(vt)
    db.flush()
    db.add(LsxCongDoanVatTu(
        lsx_cong_doan_id=buoc.id, hang_loai="vat_tu", vat_tu_id=vt.id,
        vat_tu_ma_snapshot=vt.ma, vat_tu_ten_snapshot=vt.ten,
        don_vi_snapshot=don_vi or "", so_luong=so_luong, kho_rong=0, kho_dai=0, thu_tu=1,
        tu_dong=False,
    ))
    db.commit()
    return vt


def test_phat_hanh_tu_lap_yeu_cau_cho_buoc_co_vat_tu(db, svc3, lenh, admin):
    svc3.dat_moc(lenh.id, _MOC)
    kq = svc3.phat_hanh(lenh.id, actor=admin)

    cvs = _cvs(db, lenh.id)
    co = [cv for cv in cvs if _dns(db, cv.id)]
    assert co, "bước In mang giấy phải có yêu cầu tự lập"
    for cv in co:
        dns = _dns(db, cv.id)
        assert len(dns) == 1
        dn = dns[0]
        assert dn.tu_lap is True and dn.lan_so == 1
        req = db.get(StockRequest, dn.stock_request_id)
        assert req.trang_thai == "approved"
        assert req.bo_phan_id == cv.department_id
        assert req.nguoi_tao_id == admin.id
        assert req.can_luc.replace(tzinfo=None) == cv.du_kien_bat_dau.replace(tzinfo=None)
        assert cv.can_vat_tu is True
    assert kq["vat_tu"]["so_yeu_cau"] == len(co)


def _buoc_in(db, lsx_id):
    from app.models.lsx import LsxCongDoan

    return db.query(LsxCongDoan).filter(
        LsxCongDoan.lsx_id == lsx_id, LsxCongDoan.nhom == "print").first()


def _them_buoc(db, lsx_id, *, ten, thu_tu, nhom=None):
    """Thêm một bước vào lệnh, cùng công đoạn / tổ / máy với bước In."""
    import uuid

    from app.models.lsx import LsxCongDoan

    goc = _buoc_in(db, lsx_id)
    b = LsxCongDoan(
        step_key=str(uuid.uuid4()), lsx_id=lsx_id, thu_tu=thu_tu, cong_doan_id=goc.cong_doan_id,
        ten=ten, nhom=nhom or goc.nhom, department_id=goc.department_id, may_id=goc.may_id,
    )
    db.add(b)
    db.commit()
    return b


def _cv_cua_buoc(db, buoc_id):
    return db.query(SanXuatCongViec).filter(SanXuatCongViec.lsx_cong_doan_id == buoc_id).first()


def test_buoc_khong_dinh_muc_khong_lap(db, svc3, lenh, admin):
    in_ = _buoc_in(db, lenh.id)
    sau = _them_buoc(db, lenh.id, ten="Bước sau không vật tư", thu_tu=int(in_.thu_tu or 0) + 1)
    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)

    cv = _cv_cua_buoc(db, sau.id)
    assert cv is not None
    assert cv.can_vat_tu is False
    assert _dns(db, cv.id) == []


def test_giay_cung_ma_o_cat_va_in_chi_cat_lay(db, svc3, lenh, admin):
    """Cùng mã giấy ở bước trước In và ở In: chỉ bước ĐẦU xin giấy kho (KHVT `_buoc_dau_giay`)."""
    from app.models.lsx import LsxCongDoanVatTu

    in_ = _buoc_in(db, lenh.id)
    giay_in = db.query(LsxCongDoanVatTu).filter_by(lsx_cong_doan_id=in_.id, hang_loai="giay").one()
    cat = _them_buoc(db, lenh.id, ten="Cắt tờ", thu_tu=int(in_.thu_tu or 0) - 1)
    db.add(LsxCongDoanVatTu(
        lsx_cong_doan_id=cat.id, hang_loai="giay", vat_tu_id=giay_in.vat_tu_id,
        vat_tu_ma_snapshot=giay_in.vat_tu_ma_snapshot, vat_tu_ten_snapshot=giay_in.vat_tu_ten_snapshot,
        don_vi_snapshot=giay_in.don_vi_snapshot, so_luong=1.0, kho_rong=giay_in.kho_rong,
        kho_dai=giay_in.kho_dai, thu_tu=0, tu_dong=False,
    ))
    db.commit()
    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)

    cv_cat, cv_in = _cv_cua_buoc(db, cat.id), _cv_cua_buoc(db, in_.id)
    dong_cat = [d for dn in _dns(db, cv_cat.id) for d in dn.dongs if d.hang_loai == "giay"]
    dong_in = [d for dn in _dns(db, cv_in.id) for d in dn.dongs if d.hang_loai == "giay"]
    assert dong_cat and float(dong_cat[0].sl_yeu_cau) > 0
    assert dong_in == []
    # In không còn món nào khác ⇒ không có nhu cầu vật tư, không bị "Chưa yêu cầu".
    assert cv_in.can_vat_tu is False


def test_mot_dong_loi_khong_chan_phat_hanh(db, svc3, lenh, admin):
    in_ = _buoc_in(db, lenh.id)
    _them_vat_tu(db, in_, ma="KEO-TOT", don_vi="kg", so_luong=2.0)
    xau = _them_vat_tu(db, in_, ma="KEO-XAU", don_vi=None, so_luong=3.0)
    svc3.dat_moc(lenh.id, _MOC)
    kq = svc3.phat_hanh(lenh.id, actor=admin)

    bo_qua = kq["vat_tu"]["bo_qua"]
    assert [b["ten_hang"] for b in bo_qua] == [xau.ten]
    assert "đơn vị" in bo_qua[0]["ly_do"]
    cv = _cv_cua_buoc(db, in_.id)
    (dn,) = _dns(db, cv.id)
    req = db.get(StockRequest, dn.stock_request_id)
    gui = {(l.hang_loai, l.hang_id) for l in req.lines}
    assert ("vat_tu", xau.id) not in gui
    assert len(gui) == 2           # giấy + keo tốt


def test_cum_hai_lenh_lap_cho_ca_cum(db, svc3, hai_lenh, admin):
    from app.models.order import OrderLine

    a, b = hai_lenh
    for x in (a, b):
        db.get(OrderLine, x.order_line_id).nhom = "Sách A5"
    db.commit()
    svc3.dat_moc(a.id, _MOC)
    kq = svc3.phat_hanh(a.id, actor=admin)

    assert set(kq["cum_lsx"]) == {a.id, b.id}
    for x in (a, b):
        cv = _cv_cua_buoc(db, _buoc_in(db, x.id).id)
        assert len(_dns(db, cv.id)) == 1
    assert kq["vat_tu"]["so_yeu_cau"] == 2
