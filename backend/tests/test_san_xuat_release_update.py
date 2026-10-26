"""Thực hiện sản xuất §4.3 — PHÁT HÀNH CẬP NHẬT & THU HỒI gói khi lịch đổi sau phát hành.

Soi đúng luật §4.3: chỉ việc CHƯA bắt đầu mới cập nhật được; cập nhật TÁI CHỤP máy + giờ theo lịch
hiện tại, tăng `version_hien_tai`, đẻ `san_xuat_phien_ban(cap_nhat)` kèm LÝ DO, và HUỶ phân công +
hỗ trợ của việc đó (tổ xác nhận lại). Việc ĐÃ bắt đầu giữ nguyên snapshot và CHẶN thu hồi toàn gói.

Tái dùng fixtures + helper của test xếp lịch/release để dựng một gói phát hành thật.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.models.employee import Employee
from app.models.lsx import LsxCongDoan
from app.models.machine import Machine
from app.models.order import OrderLine
from app.models.san_xuat import (
    GOI_DA_THU_HOI,
    PB_CAP_NHAT,
    SanXuatCongViec,
    SanXuatPhienBan,
)
from app.models.san_xuat_thuc_thi import (
    PC_DA_RUT,
    PC_HOAT_DONG,
    SanXuatPhanCong,
    SanXuatPhienChay,
)
from app.models.xep_lich import XepLichCongDoan
from app.services.san_xuat import release, release_update

# Fixtures + helper dùng chung từ test xếp lịch.
from tests.test_xep_lich_service import (  # noqa: F401
    _giu_cho_du,
    _hai_lsx_san_sang,
    admin,
    bg_svc,
    customer,
    db,
    lsx_svc,
    orders,
    xl_svc,
)


# --- helpers -----------------------------------------------------------------
def _lsx_da_phat_hanh(db, orders, lsx_svc, xl_svc, admin, customer):
    """Một LSX đã đưa vào lịch + phát hành gói. Trả (lsx, goi)."""
    a, _b = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)
    xl_svc.dua_vao_lsx(lsx_id=a.id, actor=admin)
    goi = release.phat_hanh(db, lsx_ids={a.id}, actor=admin)
    db.commit()
    return a, goi


def _cvs(db, goi_id):
    return (
        db.query(SanXuatCongViec)
        .filter_by(goi_id=goi_id)
        .order_by(SanXuatCongViec.id)
        .all()
    )


def _emp(db) -> Employee:
    e = db.query(Employee).first()
    assert e is not None, "seed phải có nhân viên"
    return e


def _mark_started(db, cv) -> None:
    """Đánh dấu một công việc ĐÃ bắt đầu bằng một phiên chạy mở (tín hiệu `bat_dau` đặt §4.3)."""
    db.add(SanXuatPhienChay(
        cong_viec_id=cv.id, so_thu_tu=1,
        bat_dau=datetime(2026, 8, 1, 8, 0, tzinfo=timezone.utc),
    ))
    db.flush()


# --- Đọc thông tin gói (cho UI quyết nút Cập nhật / Thu hồi) ------------------
def test_thong_tin_goi_chua_phat_hanh(db, orders, lsx_svc, admin, customer):
    a, _b = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)
    assert release_update.thong_tin_goi(db, nguon="lsx", id=a.id) == {"co_goi": False, "lich_su_goi": []}


def test_thong_tin_goi_sau_phat_hanh(db, orders, lsx_svc, xl_svc, admin, customer):
    a, goi = _lsx_da_phat_hanh(db, orders, lsx_svc, xl_svc, admin, customer)
    tt = release_update.thong_tin_goi(db, nguon="lsx", id=a.id)

    assert tt["co_goi"] and tt["goi_id"] == goi.id
    assert tt["version_hien_tai"] == 1
    assert tt["so_cong_viec"] > 0
    assert tt["so_da_bat_dau"] == 0
    assert tt["so_chua_bat_dau"] == tt["so_cong_viec"]
    assert tt["cho_phep_cap_nhat"] and tt["cho_phep_thu_hoi"]
    assert len(tt["phien_bans"]) == 1 and tt["phien_bans"][0]["so"] == 1


def test_luc_phien_ban_tra_ve_gio_xuong(db, orders, lsx_svc, xl_svc, admin, customer):
    """`created_at` ghi UTC thật; trả thô thì ngăn Xếp lịch hiện 05:02 khi xưởng đang 12:02."""
    a, goi = _lsx_da_phat_hanh(db, orders, lsx_svc, xl_svc, admin, customer)
    pb = db.query(SanXuatPhienBan).filter_by(goi_id=goi.id).one()
    pb.created_at = datetime(2026, 10, 8, 5, 2, tzinfo=timezone.utc)
    db.flush()
    tt = release_update.thong_tin_goi(db, nguon="lsx", id=a.id)
    assert tt["phien_bans"][0]["luc"].startswith("2026-10-08T12:02")


# --- Cập nhật: tái chụp máy + giờ theo lịch hiện tại, tăng phiên bản ----------
def test_cap_nhat_tai_chup_may_gio_va_tang_phien_ban(db, orders, lsx_svc, xl_svc, admin, customer):
    a, goi = _lsx_da_phat_hanh(db, orders, lsx_svc, xl_svc, admin, customer)
    cvs = _cvs(db, goi.id)
    cd_ids = [cv.lsx_cong_doan_id for cv in cvs if cv.lsx_cong_doan_id]
    sched = db.query(XepLichCongDoan).filter(
        XepLichCongDoan.lsx_cong_doan_id.in_(cd_ids)
    ).first()
    assert sched is not None, "phải có ít nhất một dòng lịch để tái chụp"
    target = next(cv for cv in cvs if cv.lsx_cong_doan_id == sched.lsx_cong_doan_id)

    may = db.query(Machine).first()
    may_id_moi = may.id if may else 4242
    sched.may_id = may_id_moi
    sched.start_at = datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc)
    sched.finish_at = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
    db.commit()

    kq = release_update.phat_hanh_cap_nhat(
        db, nguon="lsx", id=a.id, ly_do="Dời lịch do máy bận", actor=admin,
    )
    assert kq["version_hien_tai"] == 2
    assert kq["so_cong_viec_cap_nhat"] == len(cvs)
    assert kq["so_giu_nguyen"] == 0

    db.refresh(target)
    assert target.phien_ban_so == 2
    assert target.may_id == may_id_moi
    assert target.du_kien_bat_dau is not None
    assert (target.du_kien_bat_dau.month, target.du_kien_bat_dau.day,
            target.du_kien_bat_dau.hour) == (9, 1, 8)

    pb2 = db.query(SanXuatPhienBan).filter_by(goi_id=goi.id, so=2).one()
    assert pb2.loai == PB_CAP_NHAT and pb2.ly_do == "Dời lịch do máy bận"
    db.refresh(goi)
    assert goi.version_hien_tai == 2


# --- Cập nhật: tái chụp HÀNH LÝ đọc-để-làm ----------------------------------
def test_cap_nhat_tai_chup_hanh_ly_don_vi_va_dan_do(db, orders, lsx_svc, xl_svc, admin, customer):
    """Kế hoạch sửa dặn dò + đẩy bước ra NGOÀI dòng giấy sau phát hành → `Phát hành cập nhật`
    phải chở thông tin MỚI xuống thẻ việc.

    Trước 10/09/2026 hàm chỉ tái chụp máy + giờ, nên bàn tổ đứng yên với đơn vị rỗng và không có
    dặn dò dù người lập kế hoạch đã sửa và bấm cập nhật — đúng lỗi §8 của
    `docs/superpowers/specs/2026-09-10-ban-to-du-thong-tin-design.md`. Test cũng ghim RANH GIỚI:
    số lượng vào là cam kết đã đóng băng, cập nhật KHÔNG được đụng vào.
    """
    a, goi = _lsx_da_phat_hanh(db, orders, lsx_svc, xl_svc, admin, customer)
    target = next(cv for cv in _cvs(db, goi.id) if cv.lsx_cong_doan_id)
    cd = db.get(LsxCongDoan, target.lsx_cong_doan_id)
    assert cd.cong_doan_id, "bước seed phải trỏ danh mục công đoạn"

    sl_vao_da_chot = float(target.so_luong_vao or 0)
    assert target.ghi_chu is None
    assert (target.dinh_muc_json or {}).get("ngoai_dong") is False

    # Người lập kế hoạch sửa SAU phát hành: thêm dặn dò, đưa bước ra khỏi dòng giấy bằng cách TỰ
    # KHAI đơn vị `kem → kem` ở bước (mã ngoài 5 chặng ⇒ ngoài dòng; đơn vị sản lượng ở danh mục
    # GỠ 18/09/2026, mg `0324`). Đổi luôn số lượng vào để soi phần cố ý KHÔNG chụp lại.
    cd.ghi_chu = "Kẽm cũ của đợt 1 còn dùng được, chỉ ghi lại tay 3."
    cd.don_vi_vao = "kem"
    cd.don_vi_ra = "kem"
    cd.so_luong_vao = sl_vao_da_chot + 500
    db.commit()

    release_update.phat_hanh_cap_nhat(
        db, nguon="lsx", id=a.id, ly_do="Bổ sung dặn dò kỹ thuật", actor=admin,
    )
    db.commit()

    db.refresh(target)
    assert target.ghi_chu == "Kẽm cũ của đợt 1 còn dùng được, chỉ ghi lại tay 3."
    assert target.don_vi_vao == "kem" and target.don_vi_ra == "kem"
    dm = target.dinh_muc_json or {}
    assert dm["ngoai_dong"] is True
    assert "chay_phut_min" in dm and "chay_phut_max" in dm
    # Cam kết đã đóng băng thì cập nhật không đụng tới (số này chảy xuống lương + kho).
    assert float(target.so_luong_vao or 0) == sl_vao_da_chot


def _them_tieu_chi(db, cong_doan_id, *ten):
    from app.models.san_xuat_kcs import SanXuatKcsTieuChi

    for i, x in enumerate(ten, start=1):
        db.add(SanXuatKcsTieuChi(ma=f"KMT{cong_doan_id}{i:03d}", cong_doan_id=cong_doan_id, ten=x, thu_tu=i))
    db.commit()


def test_cap_nhat_tai_chup_tieu_chi_kcs(db, orders, lsx_svc, xl_svc, admin, customer):
    """Khai tiêu chí cho công đoạn SAU khi lệnh phát hành → `Phát hành cập nhật` mang tiêu chí mới
    xuống thẻ việc chưa bắt đầu (09/10/2026). Trước đó tiêu chí đóng băng theo lần phát hành đầu nên
    KCS cuối không bao giờ thấy tiêu chí khai muộn của lệnh đang chạy."""
    a, goi = _lsx_da_phat_hanh(db, orders, lsx_svc, xl_svc, admin, customer)
    target = next(cv for cv in _cvs(db, goi.id) if cv.lsx_cong_doan_id)
    cd = db.get(LsxCongDoan, target.lsx_cong_doan_id)
    truoc = list(target.kcs_tieu_chi_json or [])
    _them_tieu_chi(db, cd.cong_doan_id, "Khai muộn 1", "Khai muộn 2")

    # Băng trên hồ sơ lệnh báo đúng việc sẽ được chụp lại, kèm câu mới.
    lech = release_update.tieu_chi_kcs_lech(db, a.id)
    assert [x["cong_viec_id"] for x in lech] == [target.id]
    assert lech[0]["them"] == ["Khai muộn 1", "Khai muộn 2"] and lech[0]["bo"] == []

    release_update.phat_hanh_cap_nhat(db, nguon="lsx", id=a.id, ly_do="Thêm tiêu chí KCS", actor=admin)
    assert release_update.tieu_chi_kcs_lech(db, a.id) == []
    db.refresh(target)
    ten = [x["ten"] for x in target.kcs_tieu_chi_json or []]
    assert "Khai muộn 1" in ten and "Khai muộn 2" in ten
    assert len(ten) == len(truoc) + 2
    # `thu_tu` là nửa khoá kết quả: đánh lại 1..n theo vị trí.
    assert [x["thu_tu"] for x in target.kcs_tieu_chi_json] == list(range(1, len(ten) + 1))


def test_cap_nhat_giu_tieu_chi_da_co_ket_qua_kiem(db, orders, lsx_svc, xl_svc, admin, customer):
    """Tiêu chí của việc đã có kết quả xét ở một lần kiểm thì giữ nguyên bản chụp — kết quả khoá
    theo `thu_tu`, chụp lại là kết quả cũ trỏ nhầm câu."""
    from app.models.san_xuat_kcs import SanXuatKcsBatch

    a, goi = _lsx_da_phat_hanh(db, orders, lsx_svc, xl_svc, admin, customer)
    target = next(cv for cv in _cvs(db, goi.id) if cv.lsx_cong_doan_id)
    cd = db.get(LsxCongDoan, target.lsx_cong_doan_id)
    truoc = target.kcs_tieu_chi_json
    luc = datetime(2026, 10, 9, 8, 0, tzinfo=timezone.utc)
    # Lần kiểm ghi ở một việc khác của nhóm (bước cuối xét gộp), kết quả trỏ về `target`.
    db.add(SanXuatKcsBatch(
        cong_viec_id=target.id, nhom_id=target.nhom_id, bat_dau=luc, ket_thuc=luc,
        so_luong_nhan=10, so_luong_dat=10, so_luong_khong_dat=0, don_vi="to",
        checklist_json=[{"cong_viec_id": target.id, "thu_tu": 1, "dat": True}],
    ))
    db.commit()
    _them_tieu_chi(db, cd.cong_doan_id, "Khai muộn 1")
    assert release_update.tieu_chi_kcs_lech(db, a.id) == []    # băng không hứa điều nút không làm

    release_update.phat_hanh_cap_nhat(db, nguon="lsx", id=a.id, ly_do="Thêm tiêu chí KCS", actor=admin)
    db.refresh(target)
    assert target.kcs_tieu_chi_json == truoc


def test_nut_cap_nhat_tieu_chi_ap_ca_viec_dang_chay(db, orders, lsx_svc, xl_svc, admin, customer):
    """Nút "Cập nhật tiêu chí" của băng ở hồ sơ lệnh: lấy bộ mới cho CẢ việc đã bắt đầu (tiêu chí
    không phải cam kết với tổ), không đẻ phiên bản gói, không huỷ phân công."""
    a, goi = _lsx_da_phat_hanh(db, orders, lsx_svc, xl_svc, admin, customer)
    target = next(cv for cv in _cvs(db, goi.id) if cv.lsx_cong_doan_id)
    _mark_started(db, target)
    db.commit()
    cd = db.get(LsxCongDoan, target.lsx_cong_doan_id)
    _them_tieu_chi(db, cd.cong_doan_id, "Khai muộn 1")

    lech = release_update.tieu_chi_kcs_lech(db, a.id)
    assert [x["cong_viec_id"] for x in lech] == [target.id]
    assert lech[0]["da_bat_dau"] is True and lech[0]["moi"][-1] == "Khai muộn 1"

    assert release_update.cap_nhat_tieu_chi_kcs(db, lsx_id=a.id, actor=admin) == 1
    db.refresh(target)
    assert "Khai muộn 1" in [x["ten"] for x in target.kcs_tieu_chi_json]
    assert target.phien_ban_so == 1
    db.refresh(goi)
    assert goi.version_hien_tai == 1
    assert release_update.tieu_chi_kcs_lech(db, a.id) == []
    with pytest.raises(ValueError):
        release_update.cap_nhat_tieu_chi_kcs(db, lsx_id=a.id, actor=admin)


def test_cap_nhat_huy_phan_cong(db, orders, lsx_svc, xl_svc, admin, customer):
    a, goi = _lsx_da_phat_hanh(db, orders, lsx_svc, xl_svc, admin, customer)
    cv = _cvs(db, goi.id)[0]
    emp = _emp(db)
    pc = SanXuatPhanCong(cong_viec_id=cv.id, employee_id=emp.id, trang_thai=PC_HOAT_DONG)
    db.add(pc)
    db.commit()

    kq = release_update.phat_hanh_cap_nhat(
        db, nguon="lsx", id=a.id, ly_do="Đổi tổ thực hiện", actor=admin,
    )
    assert kq["so_huy_phan_cong"] >= 1 and "so_huy_ho_tro" not in kq

    db.refresh(pc)
    assert pc.trang_thai == PC_DA_RUT and pc.ly_do_rut


def test_cap_nhat_thieu_ly_do_thi_chan(db, orders, lsx_svc, xl_svc, admin, customer):
    a, _goi = _lsx_da_phat_hanh(db, orders, lsx_svc, xl_svc, admin, customer)
    with pytest.raises(ValueError):
        release_update.phat_hanh_cap_nhat(db, nguon="lsx", id=a.id, ly_do="x", actor=admin)


# --- Việc đã bắt đầu: giữ nguyên + chặn thu hồi toàn gói ----------------------
def test_viec_da_bat_dau_giu_nguyen_va_van_cap_nhat_phan_con_lai(
    db, orders, lsx_svc, xl_svc, admin, customer
):
    # Gói routing seed chỉ 1 công đoạn/LSX → gộp HAI LSX cùng nhóm để có ≥2 công việc.
    a, b = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)
    for l in (a, b):
        db.get(OrderLine, l.order_line_id).nhom = "Sách A5"
    db.commit()
    xl_svc.dua_vao_lsx(lsx_id=a.id, actor=admin)
    xl_svc.dua_vao_lsx(lsx_id=b.id, actor=admin)
    goi = release.phat_hanh(db, lsx_ids={a.id, b.id}, actor=admin)
    db.commit()

    cvs = _cvs(db, goi.id)
    assert len(cvs) >= 2, "hai LSX cùng nhóm phải cho ≥2 công việc để tách đã/chưa bắt đầu"
    da_chay = cvs[0]
    _mark_started(db, da_chay)
    db.commit()

    assert release_update.co_cong_viec_da_bat_dau(db, nguon="lsx", id=a.id) is True

    kq = release_update.phat_hanh_cap_nhat(
        db, nguon="lsx", id=a.id, ly_do="Cập nhật phần còn lại", actor=admin,
    )
    assert kq["so_giu_nguyen"] >= 1
    assert kq["so_cong_viec_cap_nhat"] == len(cvs) - kq["so_giu_nguyen"]

    db.refresh(da_chay)
    assert da_chay.phien_ban_so == 1  # việc đã bắt đầu KHÔNG bị tái chụp


def test_cap_nhat_khi_chua_viec_nao_bat_dau(db, orders, lsx_svc, xl_svc, admin, customer):
    """L-SX-12: lệnh đã phát hành, CHƯA việc nào chạy ⇒ vẫn cho Phát hành cập nhật để dời lịch."""
    a, goi = _lsx_da_phat_hanh(db, orders, lsx_svc, xl_svc, admin, customer)
    tt = release_update.thong_tin_goi(db, nguon="lsx", id=a.id)
    assert tt["so_da_bat_dau"] == 0 and tt["cho_phep_cap_nhat"] is True

    kq = release_update.phat_hanh_cap_nhat(
        db, nguon="lsx", id=a.id, ly_do="Dời lịch trước khi xưởng bắt đầu", actor=admin,
    )
    assert kq["so_giu_nguyen"] == 0
    assert kq["so_cong_viec_cap_nhat"] == len(_cvs(db, goi.id))
    db.refresh(goi)
    assert goi.version_hien_tai == 2


def test_het_viec_chua_bat_dau_thi_chan_cap_nhat(db, orders, lsx_svc, xl_svc, admin, customer):
    a, goi = _lsx_da_phat_hanh(db, orders, lsx_svc, xl_svc, admin, customer)
    for cv in _cvs(db, goi.id):
        _mark_started(db, cv)
    db.commit()
    with pytest.raises(ValueError):
        release_update.phat_hanh_cap_nhat(
            db, nguon="lsx", id=a.id, ly_do="Không còn gì để cập nhật", actor=admin,
        )


# --- Thu hồi gói khi chưa việc nào bắt đầu -----------------------------------
def test_thu_hoi_goi_khi_chua_bat_dau(db, orders, lsx_svc, xl_svc, admin, customer):
    a, goi = _lsx_da_phat_hanh(db, orders, lsx_svc, xl_svc, admin, customer)
    cv = _cvs(db, goi.id)[0]
    emp = _emp(db)
    db.add(SanXuatPhanCong(cong_viec_id=cv.id, employee_id=emp.id, trang_thai=PC_HOAT_DONG))
    db.commit()

    n = release_update.thu_hoi_goi(db, nguon="lsx", id=a.id, actor=admin)
    db.commit()
    assert n == len(_cvs(db, goi.id))

    db.refresh(goi)
    assert goi.trang_thai == GOI_DA_THU_HOI
    # Gói đã thu hồi biến khỏi "gói hiện tại" → thông tin gói báo không còn, nhưng lịch sử giữ nó (#25).
    tt = release_update.thong_tin_goi(db, nguon="lsx", id=a.id)
    assert tt["co_goi"] is False
    assert [(g["goi_id"], g["trang_thai"]) for g in tt["lich_su_goi"]] == [(goi.id, GOI_DA_THU_HOI)]

    pc = db.query(SanXuatPhanCong).filter_by(cong_viec_id=cv.id).first()
    assert pc.trang_thai == PC_DA_RUT
