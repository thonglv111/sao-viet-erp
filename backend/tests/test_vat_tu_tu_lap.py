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


# ============================================================ thu hồi / phát hành lại / cập nhật

def _phieu(db, req, trang_thai):
    """Kho lập phiếu cho yêu cầu: `draft` = đang soạn, `posted` = đã ghi sổ (xuất đủ)."""
    from datetime import date

    from app.models.stock_request import REQ_DONE, REQ_PREPARING
    from app.models.stock_voucher import VOUCHER_XUAT, StockVoucher

    db.add(StockVoucher(
        ma=f"PXK-TL-{req.id}-{trang_thai}", loai=VOUCHER_XUAT, request_id=req.id, kho_id=1,
        ngay=date(2026, 9, 11), nguoi_lap_id=req.nguoi_tao_id, trang_thai=trang_thai,
    ))
    req.trang_thai = REQ_DONE if trang_thai == "posted" else REQ_PREPARING
    db.commit()


def _req_cua(db, cv):
    return [db.get(StockRequest, dn.stock_request_id) for dn in _dns(db, cv.id) if dn.stock_request_id]


def _thu_hoi(svc3, lsx_id, admin):
    return svc3.thu_hoi(lsx_id, actor=admin, ly_do="Đổi lịch")


def test_thu_hoi_huy_yeu_cau_chua_xuat_ca_tu_lap_lan_to_bam(db, svc3, lenh, admin):
    from app.services.san_xuat import vat_tu_de_nghi as V

    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    cv = _cv_cua_buoc(db, _buoc_in(db, lenh.id).id)
    (tu_lap,) = _req_cua(db, cv)
    # Lần tự lập có phiếu nháp ⇒ đóng, tổ bấm được lần bổ sung.
    _phieu(db, tu_lap, "draft")
    from app.models.department import Department
    from tests.quyen_to_fixtures import cap_quyen_to

    cap_quyen_to(db, admin, db.get(Department, cv.department_id))
    db.commit()
    kh = V._kh_service(db, V._hang_service(db)).nhu_cau_cua_cong_viec(cv)
    V.tao(db, user=admin, cong_viec_id=cv.id, can_luc=_MOC, lines=[
        {"hang_loai": k["hang_loai"], "hang_id": k["hang_id"], "kho_rong": k["kho_rong"],
         "kho_dai": k["kho_dai"], "dvt": k["dvt"], "sl_yeu_cau": k["sl"]} for k in kh])

    kq = _thu_hoi(svc3, lenh.id, admin)

    reqs = _req_cua(db, cv)
    assert len(reqs) == 2
    assert all(r.trang_thai == "cancelled" for r in reqs)
    assert all(r.ly_do_huy == "Lệnh bị thu hồi phát hành" for r in reqs)
    assert sorted(kq["yeu_cau_da_huy"]) == sorted(r.id for r in reqs)


def test_thu_hoi_huy_ca_phieu_nhap_kho_dang_soan(db, svc3, lenh, admin):
    from app.models.stock_voucher import StockVoucher

    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    cv = _cv_cua_buoc(db, _buoc_in(db, lenh.id).id)
    (req,) = _req_cua(db, cv)
    _phieu(db, req, "draft")

    _thu_hoi(svc3, lenh.id, admin)

    v = db.query(StockVoucher).filter(StockVoucher.request_id == req.id).one()
    assert v.trang_thai == "cancelled"
    assert db.get(StockRequest, req.id).trang_thai == "cancelled"


def test_thu_hoi_giu_yeu_cau_da_xuat_va_phat_hanh_lai_chuyen_sang_cong_viec_moi(db, svc3, lenh, admin):
    in_ = _buoc_in(db, lenh.id)
    sau = _them_buoc(db, lenh.id, ten="Bồi", thu_tu=int(in_.thu_tu or 0) + 1)
    _them_vat_tu(db, sau, ma="KEO-BOI", don_vi="kg", so_luong=2.0)
    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    cv_in = _cv_cua_buoc(db, in_.id)
    cv_boi = _cv_cua_buoc(db, sau.id)
    (req_in,) = _req_cua(db, cv_in)
    (req_boi,) = _req_cua(db, cv_boi)
    _phieu(db, req_in, "posted")

    _thu_hoi(svc3, lenh.id, admin)
    assert db.get(StockRequest, req_in.id).trang_thai == "done"
    assert db.get(StockRequest, req_boi.id).trang_thai == "cancelled"

    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    moi_in = db.query(SanXuatCongViec).filter(
        SanXuatCongViec.lsx_cong_doan_id == in_.id, SanXuatCongViec.id != cv_in.id).one()
    moi_boi = db.query(SanXuatCongViec).filter(
        SanXuatCongViec.lsx_cong_doan_id == sau.id, SanXuatCongViec.id != cv_boi.id).one()
    assert [(d.stock_request_id, d.lan_so) for d in _dns(db, moi_in.id)] == [(req_in.id, 1)]
    assert moi_in.can_vat_tu is True
    dns_boi = _dns(db, moi_boi.id)
    assert len(dns_boi) == 1 and dns_boi[0].stock_request_id != req_boi.id
    assert db.get(StockRequest, dns_boi[0].stock_request_id).trang_thai == "approved"


def test_thu_hoi_van_bi_chan_khi_co_viec_da_bat_dau(db, svc3, lenh, admin):
    import pytest

    from app.models.san_xuat import CV_DANG_CHAY

    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    cv = _cv_cua_buoc(db, _buoc_in(db, lenh.id).id)
    cv.trang_thai = CV_DANG_CHAY
    db.commit()
    with pytest.raises(Exception):
        _thu_hoi(svc3, lenh.id, admin)
    assert all(r.trang_thai == "approved" for r in _req_cua(db, cv))


def _cap_nhat(svc3, lenh, admin, moc):
    svc3.dat_moc(lenh.id, moc)
    return svc3.phat_hanh_cap_nhat(lenh.id, actor=admin, ly_do="Dời lịch")


def test_phat_hanh_cap_nhat_doi_can_luc_tu_lap(db, svc3, lenh, admin):
    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    cv = _cv_cua_buoc(db, _buoc_in(db, lenh.id).id)
    (req,) = _req_cua(db, cv)
    cu = req.can_luc

    kq = _cap_nhat(svc3, lenh, admin, datetime(2026, 9, 14, 8, 0))

    db.refresh(cv)
    req = db.get(StockRequest, req.id)
    assert req.can_luc != cu
    assert req.can_luc.replace(tzinfo=None) == cv.du_kien_bat_dau.replace(tzinfo=None)
    assert req.ngay_can == cv.du_kien_bat_dau.date()
    (dn,) = _dns(db, cv.id)
    assert dn.can_luc.replace(tzinfo=None) == cv.du_kien_bat_dau.replace(tzinfo=None)
    assert kq["yeu_cau_doi_gio"] == [req.id]


def test_phat_hanh_cap_nhat_giu_can_luc_to_da_sua(db, svc3, lenh, admin):
    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    cv = _cv_cua_buoc(db, _buoc_in(db, lenh.id).id)
    (dn,) = _dns(db, cv.id)
    dn.updated_by_id = admin.id          # tổ đã sửa lần đề nghị (đổi giờ cần)
    db.commit()
    (req,) = _req_cua(db, cv)
    cu = req.can_luc

    _cap_nhat(svc3, lenh, admin, datetime(2026, 9, 14, 8, 0))

    assert db.get(StockRequest, req.id).can_luc == cu


# ============================================================ sửa minor sau review (18/10)

def test_thu_hoi_khong_huy_yeu_cau_kho_vua_ghi_so(db, svc3, lenh, admin, monkeypatch):
    """Kho ghi sổ chen vào giữa lúc thu hồi kiểm và lúc huỷ: quyết định phải đọc từ phiếu ĐÃ
    KHOÁ, không phải từ một lượt đọc trước khoá."""
    from app.models.stock_voucher import StockVoucher
    from app.services.san_xuat import vat_tu_tu_lap as T

    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    cv = _cv_cua_buoc(db, _buoc_in(db, lenh.id).id)
    (req,) = _req_cua(db, cv)
    _phieu(db, req, "posted")
    monkeypatch.setattr(T, "_co_phieu_ghi_so", lambda *_a, **_k: False)

    _thu_hoi(svc3, lenh.id, admin)

    assert db.get(StockRequest, req.id).trang_thai == "done"
    assert db.query(StockVoucher).filter_by(request_id=req.id).one().trang_thai == "posted"


def test_thu_hoi_huy_phieu_nhap_ghi_nhat_ky(db, svc3, lenh, admin):
    from app.models.audit import AuditLog
    from app.models.stock_voucher import StockVoucher

    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    cv = _cv_cua_buoc(db, _buoc_in(db, lenh.id).id)
    (req,) = _req_cua(db, cv)
    _phieu(db, req, "draft")
    v = db.query(StockVoucher).filter_by(request_id=req.id).one()

    _thu_hoi(svc3, lenh.id, admin)

    log = db.query(AuditLog).filter_by(action="kho_phieu_huy", target=f"voucher:{v.id}").one()
    assert log.actor_user_id == admin.id
    assert "thu hồi" in log.detail


def test_buoc_moi_dong_sai_don_vi_khong_kep_chua_yeu_cau(db, svc3, lenh, admin):
    in_ = _buoc_in(db, lenh.id)
    sau = _them_buoc(db, lenh.id, ten="Bồi lỗi", thu_tu=int(in_.thu_tu or 0) + 1)
    xau = _them_vat_tu(db, sau, ma="KEO-XAU2", don_vi=None, so_luong=3.0)
    svc3.dat_moc(lenh.id, _MOC)
    kq = svc3.phat_hanh(lenh.id, actor=admin)

    cv = _cv_cua_buoc(db, sau.id)
    assert _dns(db, cv.id) == []
    assert cv.can_vat_tu is False
    assert xau.ten in [b["ten_hang"] for b in kq["vat_tu"]["bo_qua"]]


def test_toast_kho_noi_lenh_va_so_yeu_cau(db, svc3, lenh, admin, monkeypatch):
    from app.services.san_xuat import vat_tu_tu_lap as T

    in_ = _buoc_in(db, lenh.id)
    sau = _them_buoc(db, lenh.id, ten="Bồi", thu_tu=int(in_.thu_tu or 0) + 1)
    _them_vat_tu(db, sau, ma="KEO-TOAST", don_vi="kg", so_luong=2.0)
    svc3.dat_moc(lenh.id, _MOC)
    kq = svc3.phat_hanh(lenh.id, actor=admin)

    goi: list[dict] = []
    monkeypatch.setattr(T, "bao", lambda _db, **kw: goi.append(kw) or 1)

    class _Kho:
        def __init__(self, _db):
            pass

        def kho_notify_user_ids(self, **_kw):
            return [admin.id + 1000]

    monkeypatch.setattr(T, "RoleRepository", _Kho)
    T.bao_sau_phat_hanh(db, kq["_tu_lap"], ma_lenh=lenh.ma, actor_id=admin.id)

    (kw,) = goi
    assert kw["loai"] == "kho_yeu_cau_phat_hanh"
    assert kw["ma"] == f"{lenh.ma}: 2 yêu cầu xuất mới"


def test_phat_hanh_cap_nhat_gio_khong_doi_thi_khong_dung_yeu_cau(db, svc3, lenh, admin):
    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)

    kq = _cap_nhat(svc3, lenh, admin, _MOC)

    assert kq["yeu_cau_doi_gio"] == []


def test_phat_hanh_cap_nhat_khong_dung_viec_da_bat_dau(db, svc3, lenh, admin):
    from app.models.san_xuat import CV_DANG_CHAY

    in_ = _buoc_in(db, lenh.id)
    sau = _them_buoc(db, lenh.id, ten="Bồi", thu_tu=int(in_.thu_tu or 0) + 1)
    _them_vat_tu(db, sau, ma="KEO-CHAY", don_vi="kg", so_luong=2.0)
    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    cv_in = _cv_cua_buoc(db, in_.id)
    cv_in.trang_thai = CV_DANG_CHAY
    db.commit()
    (req_in,) = _req_cua(db, cv_in)
    cu = req_in.can_luc

    kq = _cap_nhat(svc3, lenh, admin, datetime(2026, 9, 14, 8, 0))

    assert db.get(StockRequest, req_in.id).can_luc == cu
    assert req_in.id not in kq["yeu_cau_doi_gio"]


def test_phat_hanh_tinh_nhu_cau_mot_lan_cho_moi_lenh(db, svc3, lenh, admin, monkeypatch):
    from app.services.ke_hoach_vat_tu_service import KeHoachVatTuService

    in_ = _buoc_in(db, lenh.id)
    for i, ma in enumerate(("KEO-Q1", "KEO-Q2", "KEO-Q3"), start=1):
        b = _them_buoc(db, lenh.id, ten=f"Bồi {i}", thu_tu=int(in_.thu_tu or 0) + i)
        _them_vat_tu(db, b, ma=ma, don_vi="kg", so_luong=1.0)
    goc = KeHoachVatTuService._gom_nhu_cau
    dem = {"n": 0}

    def dem_gom(self, *a, **k):
        dem["n"] += 1
        return goc(self, *a, **k)

    monkeypatch.setattr(KeHoachVatTuService, "_gom_nhu_cau", dem_gom)
    svc3.dat_moc(lenh.id, _MOC)
    kq = svc3.phat_hanh(lenh.id, actor=admin)

    assert kq["vat_tu"]["so_yeu_cau"] == 4
    assert dem["n"] == 1


def test_chia_so_xin_theo_phan_doan():
    from app.services.ke_hoach_vat_tu_service import phan_cua_phan_doan

    assert phan_cua_phan_doan(100.0, [300, 200], 0) == 60.0
    assert phan_cua_phan_doan(100.0, [300, 200], 1) == 40.0
    # Ba phần không chia chẵn: phần cuối nhận số dư, tổng đúng bằng số của cả bước.
    ba = [phan_cua_phan_doan(10.0, [1, 1, 1], i) for i in range(3)]
    assert abs(sum(ba) - 10.0) < 1e-9
    # Chưa khai số vào ⇒ chia đều.
    assert phan_cua_phan_doan(9.0, [0, 0, 0], 1) == 3.0
    assert phan_cua_phan_doan(7.0, [5], 0) == 7.0


def test_buoc_tach_phan_doan_moi_viec_xin_phan_cua_minh(db, svc3, lenh, admin):
    """Hai phân đoạn của MỘT bước: tổng hai yêu cầu = số kế hoạch của cả bước, không phải gấp đôi."""
    from app.models.lsx import LsxCongDoanVatTu
    from app.services.san_xuat import vat_tu_de_nghi as V

    in_ = _buoc_in(db, lenh.id)
    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    cv = _cv_cua_buoc(db, in_.id)
    ca_buoc = {(k["hang_loai"], k["hang_id"]): k["sl"]
               for k in V._kh_service(db, V._hang_service(db)).nhu_cau_cua_cong_viec(cv)}
    # Giả lập lịch tách bước In làm hai phân đoạn (300 + 100 tờ vào).
    cv.phan_doan_so, cv.phan_doan_tong, cv.so_luong_vao = 1, 2, 300
    hai = SanXuatCongViec(**{c.name: getattr(cv, c.name) for c in SanXuatCongViec.__table__.columns
                             if c.name not in ("id",)})
    hai.phan_doan_so, hai.so_luong_vao = 2, 100
    db.add(hai)
    db.commit()

    kh = V._kh_service(db, V._hang_service(db))
    mot = {(k["hang_loai"], k["hang_id"]): k["sl"] for k in kh.nhu_cau_cua_cong_viec(cv)}
    hai_ = {(k["hang_loai"], k["hang_id"]): k["sl"] for k in kh.nhu_cau_cua_cong_viec(hai)}
    assert db.query(LsxCongDoanVatTu).filter_by(lsx_cong_doan_id=in_.id).count() >= 1
    for k, sl in ca_buoc.items():
        assert abs(mot[k] - sl * 0.75) < 1e-3
        assert abs(mot[k] + hai_[k] - sl) < 1e-6


def test_den_vat_tu_xanh_khi_cac_buoc_co_vat_tu_da_chay_xong(db, svc3, lenh, admin):
    """Bấm thử 19/10: bước Cắt tờ ăn cả hai giấy chạy xong ⇒ dòng vật tư rụng khỏi bảng cân đối ⇒
    lệnh "không còn nhu cầu" và đèn rơi về đỏ "Chưa giữ chỗ vật tư", dù kho đã cấp và xưởng đã
    dùng hết. Vật tư của lệnh đã dùng xong thì đèn phải xanh."""
    from app.models.san_xuat import CV_HOAN_THANH
    from app.services.lsx_tong_quan import MUC_OK, den_vat_tu_va_bang

    svc3.dat_moc(lenh.id, _MOC)
    svc3.phat_hanh(lenh.id, actor=admin)
    for cv in _cvs(db, lenh.id):
        cv.trang_thai = CV_HOAN_THANH
        cv.hoan_thanh_luc = _MOC
    db.commit()

    den, _ = den_vat_tu_va_bang(db, [lenh.id])
    assert den[lenh.id]["muc"] == MUC_OK, den[lenh.id]
