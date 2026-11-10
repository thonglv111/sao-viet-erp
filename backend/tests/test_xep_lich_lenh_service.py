"""Xếp lịch 3 — lớp service, chạy trên LUỒNG THẬT (đơn → chuyển SX → tạo lệnh → sẵn sàng).

Tái dùng nguyên bộ dựng nguồn của `test_xep_lich_service.py` thay vì chép lại: hai màn phải nhìn
CÙNG một hình dạng dữ liệu, chép ra là hai bản trôi nhau. Bám `docs/spec-xep-lich-3.md` §4.1
(ranh giới hiệu năng), §5 (màn), §6 (API).
"""
from __future__ import annotations

from datetime import date, datetime

import pytest
from sqlalchemy import event

from app.repositories.audit_repo import AuditLogRepository
from app.repositories.xep_lich_lenh_repo import XepLichLenhRepository
from app.services.xep_lich import XepLichLenhConflict, XepLichLenhNotFound, XepLichLenhService

# Fixtures + helper dùng lại — import tên vào module này là pytest nhận luôn thành fixture.
from tests.test_xep_lich_service import (  # noqa: F401
    _hai_lsx_san_sang,
    _in_step,
    _khai_giay_len_buoc_in,
    admin,
    customer,
    db,
    lsx_svc,
    orders,
)


@pytest.fixture
def svc3(db):
    return XepLichLenhService(db, XepLichLenhRepository(db), AuditLogRepository(db))


@pytest.fixture
def lenh(db, orders, lsx_svc, admin, customer):
    """Một lệnh SẴN SÀNG có routing thật + giấy khai trên bước in (nếu không, giờ chạy = 0)."""
    ds = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)
    _khai_giay_len_buoc_in(db, ds[0].id)
    db.commit()
    return ds[0]


@pytest.fixture
def hai_lenh(db, orders, lsx_svc, admin, customer):
    ds = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)
    for l in ds:
        _khai_giay_len_buoc_in(db, l.id)
    db.commit()
    return ds


# ============================================================== đọc


def test_thanh_dai_bang_gio_chay_cong_nghi_va_ngoai_ca(svc3, lenh):
    """Đây là toàn bộ mục tiêu của module — con số phải cộng đúng, không xấp xỉ."""
    d = svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    tong = (d["ket_thuc"] - d["bat_dau_at"]).total_seconds() / 60
    assert tong == pytest.approx(d["chay_phut"] + d["nghi_ngoai_ca_phut"], abs=0.5)


def test_chi_tiet_du_o_cua_panel(svc3, lenh):
    """Panel dưới — thiếu một khoá là FE nhận `undefined` mà không lỗi nào bật ra."""
    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    ct = svc3.chi_tiet(lenh.id)
    for k in ("customer_name", "order_no", "customer_po_no", "sale_name", "so_luong_dat",
              "don_vi_tinh", "so_to_ke_hoach", "so_con", "han_giao_khach",
              "nguoi_phu_trach_ten", "luu_y_gui_xuong", "giay", "kho_in", "so_mau", "so_kem",
              "is_rush", "bat_dau_at", "ket_thuc", "chay_phut",
              "nghi_ngoai_ca_phut", "cong_doans"):
        assert k in ct, f"thieu khoa {k}"


def test_chi_tiet_dien_giai_nghi_cong_lai_dung_con_so_gop(svc3, lenh):
    """Panel ghi "Nghỉ" một con số thì phần diễn giải bên dưới phải cộng ra ĐÚNG con số đó."""
    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    ct = svc3.chi_tiet(lenh.id)
    pt = ct["phan_tach_nghi"]
    assert pt["ca_san_xuat"]
    assert (pt["nghi_giua_ca_phut"] + pt["ngoai_ca_phut"] + pt["ngay_nghi_phut"]
            + pt["gia_cong_ngoai_phut"]) == pytest.approx(ct["nghi_ngoai_ca_phut"], abs=0.5)
    assert all("ten" in n for n in pt["ngay_nghi"])
    # Đi qua được `response_model` — schema không khai thì Pydantic nuốt im lặng.
    from app.schemas.xep_lich import ChiTietOut

    assert ChiTietOut.model_validate(ct).phan_tach_nghi is not None


def test_chi_tiet_ghi_ten_ca_va_bua_nghi_cua_tung_ca(db, svc3, lenh):
    """Khung gộp "06:00–24:00" không nói bữa nghỉ nào của ca nào — panel phải có tên từng ca."""
    from app.models.attendance import WorkShift

    db.add_all([
        WorkShift(name="Ca 1", start_minute=360, end_minute=900,
                  break_start_minute=720, break_end_minute=780),
        WorkShift(name="Ca 2", start_minute=900, end_minute=0, is_overnight=True,
                  break_start_minute=1080, break_end_minute=1140),
    ])
    db.commit()
    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    pt = svc3.chi_tiet(lenh.id)["phan_tach_nghi"]
    assert [(c["ten"], c["tu"], c["den"], c["nghi_tu"], c["nghi_den"]) for c in pt["cac_ca"]] == [
        ("Ca 1", "06:00", "15:00", "12:00", "13:00"),
        ("Ca 2", "15:00", "24:00", "18:00", "19:00"),
    ]
    from app.schemas.xep_lich import ChiTietOut

    assert ChiTietOut.model_validate(svc3.chi_tiet(lenh.id)).phan_tach_nghi.cac_ca[1].nghi_tu == "18:00"


def test_chi_tiet_ten_to_mot_truy_van(db, svc3, lenh):
    """Mỗi bước một tổ KHÁC nhau: tên tổ của bảng công đoạn vẫn chỉ MỘT câu `departments`."""
    from app.models.department import Department
    from app.models.lsx import LsxCongDoan

    for i in range(2):                  # thêm bước để có ≥ 3 tổ khác nhau trong một lệnh
        db.add(LsxCongDoan(lsx_id=lenh.id, thu_tu=90 + i, ten=f"Bước thêm {i}"))
    db.flush()
    buoc = db.query(LsxCongDoan).filter(LsxCongDoan.lsx_id == lenh.id).all()
    assert len(buoc) >= 3
    for i, b in enumerate(buoc):
        d = Department(name=f"Tổ nạp lô {i}", code=f"TNL{i}")
        db.add(d)
        db.flush()
        b.department_id = d.id
    db.commit()
    db.expire_all()
    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    svc = XepLichLenhService(db, XepLichLenhRepository(db), AuditLogRepository(db))
    dem = {"n": 0}

    def _bat(conn, cur, stmt, params, ctx, many):
        s = " ".join(stmt.lower().split())
        if s.startswith("select") and "from departments" in s:
            dem["n"] += 1

    event.listen(db.get_bind(), "before_cursor_execute", _bat)
    try:
        ct = svc.chi_tiet(lenh.id)
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", _bat)
    assert sorted(c["to_ten"] for c in ct["cong_doans"]) == sorted(f"Tổ nạp lô {i}" for i in range(len(buoc)))
    assert dem["n"] == 1, f"N+1 theo tổ: {dem['n']} câu cho {len(buoc)} bước"


def test_chi_tiet_buoc_bi_bai_ghep_phu_bay_theo_buoc_chung(db, svc3, lenh):
    """E2E 27/09/2026: popup in bước bị bài phủ theo cấu hình CỦA LỆNH ("Tổ cán phủ", loại Máy)
    trong khi lượt chung là Thuê ngoài — phải bày loại, nhà gia công và mã bài của bước chung."""
    from app.models.bai_ghep import BaiGhep
    from app.models.bai_ghep_cong_doan import BaiGhepCongDoan, BaiGhepCongDoanMap
    from app.models.lsx import LB_THUE_NGOAI, LsxCongDoan
    from app.schemas.xep_lich import ChiTietOut

    buoc = db.query(LsxCongDoan).filter(LsxCongDoan.lsx_id == lenh.id).order_by(LsxCongDoan.id).all()
    bi_phu = buoc[-1]
    bg = BaiGhep(ma="GB-XL-1", ten="Bài xếp lịch")
    db.add(bg)
    db.flush()
    chung = BaiGhepCongDoan(bai_ghep_id=bg.id, ten=bi_phu.ten, loai_buoc=LB_THUE_NGOAI,
                            nha_cung_cap="Tân Phát", department_id=None)
    db.add(chung)
    db.flush()
    db.add(BaiGhepCongDoanMap(bai_ghep_cong_doan_id=chung.id, lsx_id=lenh.id,
                              lsx_step_key=bi_phu.step_key))
    db.commit()

    cds = {c["id"]: c for c in ChiTietOut.model_validate(svc3.chi_tiet(lenh.id)).model_dump()["cong_doans"]}
    c = cds[bi_phu.id]
    assert (c["loai_buoc"], c["la_thue_ngoai"], c["to_ten"], c["may_ten"], c["bai_ghep_ma"]) == (
        LB_THUE_NGOAI, True, "Tân Phát", None, "GB-XL-1")
    assert all(cds[b.id]["bai_ghep_ma"] is None for b in buoc[:-1])


def test_chi_tiet_buoc_bi_bai_ghep_phu_co_trang_thai_thuc_te_cua_viec_chung(db, svc3, lenh):
    """E2E 27/09/2026: bước In ghép trên popup không có chip trạng thái — việc chung mang
    `lsx_id IS NULL` nên tra thực tế theo lệnh không thấy. Phải lấy qua bảng phủ."""
    from app.models.bai_ghep import BaiGhep
    from app.models.bai_ghep_cong_doan import BaiGhepCongDoan, BaiGhepCongDoanMap
    from app.models.lsx import LsxCongDoan
    from app.models.san_xuat import CV_DANG_CHAY, SanXuatCongViec, SanXuatGoiPhatHanh

    buoc = db.query(LsxCongDoan).filter(LsxCongDoan.lsx_id == lenh.id).order_by(LsxCongDoan.id).all()
    bi_phu = buoc[0]
    bg = BaiGhep(ma="GB-XL-2", ten="Bài xếp lịch 2")
    db.add(bg)
    db.flush()
    chung = BaiGhepCongDoan(bai_ghep_id=bg.id, ten=bi_phu.ten, loai_buoc=bi_phu.loai_buoc)
    db.add(chung)
    db.flush()
    db.add(BaiGhepCongDoanMap(bai_ghep_cong_doan_id=chung.id, lsx_id=lenh.id,
                              lsx_step_key=bi_phu.step_key))
    goi = SanXuatGoiPhatHanh(ma="GOI-XL-CHUNG")
    db.add(goi)
    db.flush()
    db.add(SanXuatCongViec(goi_id=goi.id, bai_ghep_id=bg.id, bai_ghep_cong_doan_id=chung.id,
                           lsx_id=None, step_key=None, ten_cong_doan=bi_phu.ten,
                           trang_thai=CV_DANG_CHAY))
    db.commit()

    cds = {c["id"]: c for c in svc3.chi_tiet(lenh.id)["cong_doans"]}
    assert cds[bi_phu.id]["trang_thai"] == CV_DANG_CHAY


def test_chi_tiet_lenh_chua_xep_van_mo_duoc(svc3, lenh):
    """Bấm thẻ hàng chờ cũng mở panel — chưa có lịch thì các ô lịch để trống, không nổ."""
    ct = svc3.chi_tiet(lenh.id)
    assert ct["bat_dau_at"] is None and ct["ket_thuc"] is None
    assert ct["cong_doans"]


def test_bang_cong_doan_co_gio_du_kien_tung_buoc(svc3, lenh):
    """Ngăn chi tiết mục 7 (08/10/2026) ghi giờ từng bước — khớp đúng mốc của đường riêng."""
    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    cds = svc3.chi_tiet(lenh.id)["cong_doans"]
    moc = {b.lsx_cong_doan_id: b for b in svc3.moc_cong_doan([lenh.id])[lenh.id]}
    for cd in cds:
        assert cd["du_kien_bat_dau"] == moc[cd["id"]].bat_dau
        assert cd["du_kien_ket_thuc"] == moc[cd["id"]].ket_thuc
        assert cd["cho_tu"] is None and cd["lien"] == []
    assert cds[0]["mau_index"] in (0, 1, 2, 3)


def test_moc_tung_buoc_van_lay_duoc_qua_duong_rieng(svc3, lenh):
    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    moc = svc3.moc_cong_doan([lenh.id])
    assert lenh.id in moc and moc[lenh.id]
    assert all(b.ket_thuc >= b.bat_dau for b in moc[lenh.id])


def test_moc_cong_doan_nap_may_va_ct_gio_theo_lo(db, svc3, hai_lenh):
    """Mỗi bước một máy KHÁC nhau: máy + công thức giờ của cặp vẫn chỉ MỘT câu mỗi thứ.

    Trước 14/09/2026 `_may` và `_ct_gio_cua_may` hỏi từng máy/từng cặp: cột Trạng thái màn Máy trên
    dev ra 11 + 11 câu cho 2 lệnh, và số đó lớn dần theo số máy có trong lịch.
    """
    from app.models.cong_doan import CongDoanMay
    from app.models.lsx import LsxCongDoan
    from app.models.may_thiet_bi import MayThietBi

    buoc = db.query(LsxCongDoan).filter(LsxCongDoan.lsx_id.in_([l.id for l in hai_lenh])).all()
    assert len(buoc) >= 2          # ≥ 2 máy khác nhau là đủ phân biệt "một câu" với "mỗi máy một câu"
    for i, b in enumerate(buoc):
        m = MayThietBi(ma=f"NL-M{i}", ten=f"Máy nạp lô {i}", loai_may="press_offset_sheet")
        db.add(m)
        db.flush()
        b.may_id = m.id
        if b.cong_doan_id:
            db.add(CongDoanMay(cong_doan_id=b.cong_doan_id, may_id=m.id, thu_tu=0,
                               cong_thuc_gio=f"so_luong / {i + 2}"))
    db.commit()
    for l in hai_lenh:
        svc3.dat_moc(l.id, datetime(2026, 9, 11, 8, 0))

    svc = XepLichLenhService(db, XepLichLenhRepository(db), AuditLogRepository(db))
    dem = {"may_thiet_bi": 0, "cong_doan_may": 0}

    def _bat(conn, cur, stmt, params, ctx, many):
        s = " ".join(stmt.lower().split())
        for bang in dem:
            if s.startswith("select") and f"from {bang}" in s:
                dem[bang] += 1

    event.listen(db.get_bind(), "before_cursor_execute", _bat)
    try:
        moc = svc.moc_cong_doan([l.id for l in hai_lenh])
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", _bat)
    assert moc and all(moc[l.id] for l in hai_lenh)
    assert dem == {"may_thiet_bi": 1, "cong_doan_may": 1}, (
        f"N+1 theo máy: {dem} cho {len(buoc)} bước mỗi bước một máy")

    # Nạp theo lô phải ra ĐÚNG chữ mà đường hỏi từng cặp ra — kể cả cặp chưa khai (chuỗi rỗng).
    from app.repositories.lsx_repo import LsxRepository
    from app.services.lsx_service import LsxService

    cap = {(b.cong_doan_id, b.may_id) for b in buoc if b.cong_doan_id} | {(buoc[0].cong_doan_id or 1, 999999)}
    lo = LsxService(db, LsxRepository(db), None, None)
    lo.nap_ct_gio(cap)
    le = LsxService(db, LsxRepository(db), None, None)
    assert {k: lo._ct_gio_cua_may(*k) for k in cap} == {k: le._ct_gio_cua_may(*k) for k in cap}


# ============================================================== ghi

def test_dat_lai_thi_GHI_DE_khong_de_dong_thu_hai(db, svc3, lenh):
    from app.models.xep_lich_lenh import XepLichLenh

    a = svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    svc3.dat_moc(lenh.id, datetime(2026, 9, 14, 8, 0), a["updated_at"])
    assert db.query(XepLichLenh).filter_by(lsx_id=lenh.id).count() == 1


def test_moc_ngoai_gio_chay_thi_TU_DOI_va_bao(svc3, lenh):
    r = svc3.dat_moc(lenh.id, datetime(2026, 9, 13, 3, 0))   # CN, 03:00
    assert r["da_doi"] is True
    assert r["thong_bao"] and "dời" in r["thong_bao"]


def test_moc_da_doi_duoc_LUU_chu_khong_luu_moc_nguoi_tha(svc3, lenh):
    """Lưu mốc người thả thì mỗi lần đọc lại trượt thêm một nhát, thanh tự đi."""
    r = svc3.dat_moc(lenh.id, datetime(2026, 9, 13, 3, 0))
    lai = svc3.chi_tiet(lenh.id)
    assert lai["bat_dau_at"] == r["bat_dau_at"]


def test_nguoi_khac_vua_doi_thi_409(svc3, lenh):
    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    with pytest.raises(XepLichLenhConflict):
        svc3.dat_moc(lenh.id, datetime(2026, 9, 12, 8, 0), datetime(2020, 1, 1, 0, 0))


def test_khong_gui_chot_thi_van_ghi_duoc(svc3, lenh):
    """Đặt mốc lần đầu (kéo từ hàng chờ) không có gì để so — không được đòi chốt."""
    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    assert svc3.dat_moc(lenh.id, datetime(2026, 9, 15, 8, 0))["bat_dau_at"].day == 15


def test_xoa_moc_lenh_chua_xep_thi_404(svc3, lenh):
    with pytest.raises(XepLichLenhNotFound):
        svc3.xoa_moc(lenh.id)


def test_dat_moc_lenh_khong_ton_tai_thi_404(svc3):
    with pytest.raises(XepLichLenhNotFound):
        svc3.dat_moc(999_999, datetime(2026, 9, 11, 8, 0))


# ================= máy đang giao chạy · MỘT nguồn thời lượng (10/09/2026) =================

def _svc_moi(db):
    """Service MỚI cho mỗi lượt đọc — cache máy/khung giờ sống trong đúng MỘT request."""
    return XepLichLenhService(db, XepLichLenhRepository(db), AuditLogRepository(db))


def test_lenh_chua_phat_hanh_dung_may_KE_HOACH(svc3, lenh):
    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    cds = svc3.chi_tiet(lenh.id)["cong_doans"]
    co_may = [c for c in cds if c["may_id"]]
    assert co_may, "routing khong co buoc nao gan may"
    assert all(c["may_nguon"] == "ke_hoach" for c in co_may)
    assert all(c["may_ke_hoach_ten"] is None for c in cds), "chua doi may thi khong bay doi chieu"


def test_may_lay_tu_CONG_VIEC_dang_giao_chay(db, svc3, lenh, admin):
    """Lệnh đã phát hành thì máy thật nằm ở `san_xuat_cong_viec.may_id`.

    Xưởng đổi máy ở bàn tổ, ô máy kế hoạch trên routing KHÔNG đổi theo — bàn xếp lịch đọc ô kế
    hoạch là bày sai máy, và vì tốc độ treo ở cặp (công đoạn × máy) nên thời lượng cũng tính trên
    một máy không chạy.
    """
    from app.models.may_thiet_bi import MayThietBi
    from app.models.san_xuat import SanXuatCongViec

    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    svc3.phat_hanh(lenh.id, actor=admin)

    cv = db.query(SanXuatCongViec).filter(
        SanXuatCongViec.lsx_id == lenh.id,
        SanXuatCongViec.may_id.isnot(None),
        SanXuatCongViec.lsx_cong_doan_id.isnot(None),
    ).order_by(SanXuatCongViec.id).first()
    assert cv is not None, "phat hanh phai de ra cong viec co may"
    # DB test chi seed dung mot may cho moi loai — them mot may THAY THE de co cho ma doi.
    may_moi = db.query(MayThietBi).filter(
        MayThietBi.id != cv.may_id, MayThietBi.active.is_(True)
    ).order_by(MayThietBi.id).first()
    if may_moi is None:
        cu = db.get(MayThietBi, cv.may_id)
        may_moi = MayThietBi(ma=f"{cu.ma}-B", ten=f"{cu.ten} (may 2)",
                             loai_may=cu.loai_may, active=True)
        db.add(may_moi)
        db.commit()
    # Ghi thẳng `cv.may_id` thay vì gọi `thuc_thi.doi_may`: hàm đó đòi công việc đang chạy hoặc
    # tạm dừng (phiên máy, khoảng người…), còn thứ đang kiểm ở đây là ĐƯỜNG ĐỌC của bàn xếp lịch.
    cv.may_id = may_moi.id
    db.commit()

    b = {c["id"]: c for c in _svc_moi(db).chi_tiet(lenh.id)["cong_doans"]}[cv.lsx_cong_doan_id]
    assert b["may_id"] == may_moi.id
    assert b["may_ten"] == may_moi.ten
    assert b["may_nguon"] == "thuc_thi"
    assert b["may_ke_hoach_ten"], "may ke hoach khac may dang chay thi phai bay ca hai de doi chieu"


def test_so_luong_vao_chua_khai_ra_None_KHONG_phai_0(db, svc3, lenh):
    """Cot nguon la NOT NULL default 0 nen 0 CHINH LA "chua khai" — doi ve None ngay o mep API.

    "0 to" doc nhu "buoc nay khong nhan gi vao", khac han "ke hoach chua dien".
    """
    from app.models.lsx import LsxCongDoan

    b = db.query(LsxCongDoan).filter(
        LsxCongDoan.lsx_id == lenh.id
    ).order_by(LsxCongDoan.thu_tu).first()
    b.so_luong_vao = 0
    db.commit()
    c = next(x for x in _svc_moi(db).chi_tiet(lenh.id)["cong_doans"] if x["id"] == b.id)
    assert c["so_luong_vao"] is None


def test_don_vi_vao_kem_TEN_hien_thi(db, svc3, lenh):
    """Bảng lưu MÃ (`to`, `con`), người đọc cần chữ — FE trước đó in mã thô và độn mặc định "tờ"."""
    from app.models.don_vi_do import DonViDo
    from app.models.lsx import LsxCongDoan

    dv = db.query(DonViDo).order_by(DonViDo.id).first()
    b = db.query(LsxCongDoan).filter(
        LsxCongDoan.lsx_id == lenh.id
    ).order_by(LsxCongDoan.thu_tu).first()
    b.don_vi_vao = dv.ma
    db.commit()
    c = next(x for x in _svc_moi(db).chi_tiet(lenh.id)["cong_doans"] if x["id"] == b.id)
    assert c["don_vi_vao"] == dv.ma
    assert c["don_vi_vao_ten"] == dv.ten


def test_moi_buoc_mang_LOP_phu_thuoc(svc3, lenh):
    """Bảng bày 1→N theo `thu_tu`; `lop` mới là quan hệ chặn. Có `lop` thì màn nói được "hai bước
    này không chặn nhau" thay vì vẽ ra một chuỗi tuần tự không tồn tại."""
    cds = _svc_moi(svc3.db).chi_tiet(lenh.id)["cong_doans"]
    assert cds
    assert all(isinstance(c["lop"], int) and isinstance(c["song_song"], bool) for c in cds)


# ============================================================== gói đã thả xuống xưởng
# Chốt 10/09/2026: màn bày nút "Thu hồi phát hành" mà không hỏi gói còn rút về được không, nên
# lệnh có việc đã chạy vẫn mời người dùng gõ lý do rồi mới ném 409 — và câu lỗi chỉ sang "phát
# hành cập nhật" trong khi màn không có nút đó. Ba test dưới khoá cả hai vế.

def _cv_dau(db, lsx_id):
    from app.models.san_xuat import SanXuatCongViec

    return db.query(SanXuatCongViec).filter(
        SanXuatCongViec.lsx_id == lsx_id
    ).order_by(SanXuatCongViec.id).first()


def test_goi_phat_hanh_noi_ro_con_thu_hoi_duoc_khong(db, svc3, lenh, admin):
    """Chưa phát hành thì `co_goi=False`; phát hành xong mà chưa ai bấm bắt đầu thì thu hồi được."""
    assert svc3.goi_phat_hanh(lenh.id)["co_goi"] is False

    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    svc3.phat_hanh(lenh.id, actor=admin)

    g = _svc_moi(db).goi_phat_hanh(lenh.id)
    assert g["co_goi"] is True
    assert g["so_da_bat_dau"] == 0
    assert g["cho_phep_thu_hoi"] is True
    # Chưa việc nào chạy ⇒ chưa cần tới đường cập nhật, nhưng vẫn phải mở (còn việc chưa bắt đầu).
    assert g["cho_phep_cap_nhat"] is True


def test_co_viec_da_bat_dau_thi_KHOA_thu_hoi_va_mo_duong_cap_nhat(db, svc3, lenh, admin):
    """Một bước đã rời `released` là cả gói hết rút về được (§4.3) — màn phải biết TRƯỚC khi bày nút."""
    import uuid

    from app.models.lsx import LsxCongDoan
    from app.models.san_xuat import CV_HOAN_THANH
    from app.services.xep_lich_service import XepLichConflict

    # Lệnh của fixture chỉ có MỘT bước; cần bước thứ hai thì mới tách được "đã chạy" với "chưa chạy".
    goc = db.query(LsxCongDoan).filter(LsxCongDoan.lsx_id == lenh.id).order_by(LsxCongDoan.thu_tu).first()
    db.add(LsxCongDoan(
        step_key=str(uuid.uuid4()), lsx_id=lenh.id, thu_tu=int(goc.thu_tu or 0) + 1,
        cong_doan_id=goc.cong_doan_id, ten=f"{goc.ten} (bước 2)", nhom=goc.nhom,
        department_id=goc.department_id, may_id=goc.may_id,
    ))
    db.commit()

    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    svc3.phat_hanh(lenh.id, actor=admin)
    cv = _cv_dau(db, lenh.id)
    assert cv is not None
    cv.trang_thai = CV_HOAN_THANH
    db.commit()

    svc = _svc_moi(db)
    g = svc.goi_phat_hanh(lenh.id)
    assert g["so_da_bat_dau"] == 1
    assert g["cho_phep_thu_hoi"] is False
    assert g["cho_phep_cap_nhat"] is True

    with pytest.raises(XepLichConflict):
        svc.thu_hoi(lenh.id, actor=admin, ly_do="Khách dời hạn")

    # …nhưng lối ra thì mở: đẩy lịch mới cho phần chưa bắt đầu, việc đã xong giữ nguyên.
    kq = _svc_moi(db).phat_hanh_cap_nhat(lenh.id, actor=admin, ly_do="Dời giờ do kẹt máy in")
    assert kq["so_giu_nguyen"] == 1
    assert kq["so_cong_viec_cap_nhat"] >= 1
    assert _svc_moi(db).goi_phat_hanh(lenh.id)["version_hien_tai"] == 2


# ============================================================== thanh của lệnh ĐÃ CHẠY DỞ
# Chốt 10/09/2026 (ảnh người dùng gửi): mốc đổi nghĩa thành "bắt đầu phần còn lại" xong thì thanh
# trên bàn bắt đầu ở mốc — nằm hẳn bên phải chốt "hôm nay" — trong khi panel của chính lệnh đó
# ghi "Lệnh đã bắt đầu 14:15 09/09". Bàn nói lệnh chưa đụng tới, panel nói đã xong một bước.


def test_phat_hanh_cap_nhat_thieu_ly_do_thi_LOI_CUA_MAN_khong_phai_ValueError(db, svc3, lenh, admin):
    """Thiếu lý do và "không còn gì để cập nhật" đều là `ValueError` ở tầng dưới — màn phải phân
    biệt được, nên chặn trước bằng lỗi của mình để router ra 400 kèm câu đọc được."""
    from app.services.xep_lich import XepLichLenhError

    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    svc3.phat_hanh(lenh.id, actor=admin)

    svc = _svc_moi(db)
    with pytest.raises(XepLichLenhError) as e:
        svc.phat_hanh_cap_nhat(lenh.id, actor=admin, ly_do="ff")
    assert "lý do" in str(e.value).lower()


# ============================================================== thu hồi phải MỞ KHOÁ được lệnh
# Vỡ THẬT 11/09/2026: LSX26-0004 thu hồi vì "chưa chọn giấy" rồi không sửa được giấy nữa. Thu hồi
# đi chung `go_phat_hanh_lsx` với màn 2 nên lùi đúng một nấc về `da_lap_ke_hoach` — nấc KHOÁ sửa
# lệnh/routing/xoá, mà cửa ra của nó ("Xoá nháp" màn 2) phải bấm lên một DÒNG xếp lịch thì màn 3
# không có, còn hàng chờ màn 2 chỉ nhận `san_sang` nên lệnh cũng không hiện ra ở đó.

def test_thu_hoi_o_man_3_tra_lenh_ve_SAN_SANG_va_sua_lai_duoc(db, svc3, lenh, admin, lsx_svc):
    from app.models.lsx import TT_DA_PHAT_HANH, TT_SAN_SANG
    from app.schemas.lsx import LsxUpdateIn

    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    svc3.phat_hanh(lenh.id, actor=admin)
    assert lenh.trang_thai == TT_DA_PHAT_HANH

    kq = _svc_moi(db).thu_hoi(lenh.id, actor=admin, ly_do="chưa chọn giấy")

    assert kq["trang_thai"] == TT_SAN_SANG
    db.refresh(lenh)
    assert lenh.trang_thai == TT_SAN_SANG
    # Cái ĐÍCH của việc thu hồi: sửa lại được. Trước bản vá, đây là `LsxConflict`.
    lsx_svc.update(lsx_id=lenh.id, payload=LsxUpdateIn(ghi_chu="đổi giấy"), actor=admin)


def test_thu_hoi_GIU_da_lap_ke_hoach_khi_lenh_con_dong_xep_lich_cua_man_2(db, svc3, lenh, admin):
    """Lệnh từng đi qua "đưa vào kế hoạch" của màn 2 thì nấc `da_lap_ke_hoach` là CÓ THẬT — lịch
    vẫn còn, gỡ tiếp bằng "Xoá nháp". Hạ thẳng về `san_sang` ở đây là bỏ quên đống dòng ấy."""
    from app.models.lsx import TT_DA_LAP_KE_HOACH
    from app.models.xep_lich import XepLichCongDoan

    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    svc3.phat_hanh(lenh.id, actor=admin)
    db.add(XepLichCongDoan(nguon="lsx", lsx_id=lenh.id, source_thu_tu=0))
    db.commit()

    kq = _svc_moi(db).thu_hoi(lenh.id, actor=admin, ly_do="đổi máy in")

    assert kq["trang_thai"] == TT_DA_LAP_KE_HOACH


# ============================================================== thu hồi CẢ CỤM
# Phát hành thả cả cụm xuống chung một gói, nhưng thu hồi từng chỉ hạ đúng lệnh được bấm — lệnh kia
# vẫn ghi "Đã phát hành" mà bàn tổ trống (08/10/2026).

def _cum_hai_lenh(db, svc3, hai_lenh, admin):
    """Hai lệnh cùng nhóm thành phẩm ⇒ một cụm; đặt mốc lệnh đầu rồi phát hành cả cụm."""
    from app.models.order import OrderLine

    a, b = hai_lenh
    for x in (a, b):
        db.get(OrderLine, x.order_line_id).nhom = "Sách A5"
    db.commit()
    svc3.dat_moc(a.id, datetime(2026, 9, 11, 8, 0))
    kq = svc3.phat_hanh(a.id, actor=admin)
    assert set(kq["cum_lsx"]) == {a.id, b.id}
    return a, b


def test_thu_hoi_mot_lenh_rut_CA_CUM_ve_lai(db, svc3, hai_lenh, admin):
    from app.models.lsx import TT_DA_PHAT_HANH, TT_SAN_SANG
    from app.models.san_xuat import GOI_DA_THU_HOI, SanXuatGoiPhatHanh

    a, b = _cum_hai_lenh(db, svc3, hai_lenh, admin)
    db.refresh(b)
    assert b.trang_thai == TT_DA_PHAT_HANH

    kq = _svc_moi(db).thu_hoi(b.id, actor=admin, ly_do="khách đổi giấy")

    assert set(kq["cum_lsx"]) == {a.id, b.id}
    db.refresh(a)
    db.refresh(b)
    assert a.trang_thai == TT_SAN_SANG
    assert b.trang_thai == TT_SAN_SANG
    assert all(g.trang_thai == GOI_DA_THU_HOI for g in db.query(SanXuatGoiPhatHanh).all())


def test_thu_hoi_ca_cum_moi_lenh_co_vet_rieng(db, svc3, hai_lenh, admin):
    from app.models.audit import AuditLog

    a, b = _cum_hai_lenh(db, svc3, hai_lenh, admin)
    _svc_moi(db).thu_hoi(a.id, actor=admin, ly_do="khách đổi giấy")

    vet = {r.target: r.detail for r in db.query(AuditLog).filter(
        AuditLog.action == "xep_lich_go_phat_hanh")}
    assert f"lsx:{a.id}" in vet and f"lsx:{b.id}" in vet
    assert "khách đổi giấy" in vet[f"lsx:{b.id}"]


def test_cum_co_viec_da_bat_dau_thi_KHONG_lenh_nao_lui(db, svc3, hai_lenh, admin):
    from app.models.lsx import TT_DA_PHAT_HANH
    from app.models.san_xuat import CV_HOAN_THANH
    from app.services.xep_lich_service import XepLichConflict

    a, b = _cum_hai_lenh(db, svc3, hai_lenh, admin)
    cv = _cv_dau(db, b.id)
    cv.trang_thai = CV_HOAN_THANH
    db.commit()

    with pytest.raises(XepLichConflict):
        _svc_moi(db).thu_hoi(a.id, actor=admin, ly_do="khách đổi giấy")

    db.expire_all()
    assert db.get(type(a), a.id).trang_thai == TT_DA_PHAT_HANH
    assert db.get(type(b), b.id).trang_thai == TT_DA_PHAT_HANH


def test_chi_tiet_goi_nguoi_bang_ho_ten_khong_bang_ten_dang_nhap(db, svc3, lenh, admin):
    """`User` giữ họ tên ở cột `name` — đọc nhầm `full_name` (không có) thì ngăn in "admin"."""
    admin.name = "Trần Điều Phối"
    lenh.nguoi_phu_trach_id = admin.id
    db.commit()
    assert svc3.chi_tiet(lenh.id)["nguoi_phu_trach_ten"] == "Trần Điều Phối"


def test_chi_tiet_ke_moi_giay_cua_cac_buoc(db, svc3, lenh):
    """Hộp bồi couche + sóng: hai giấy khai ở bước — ngăn phải kể cả hai, không chỉ giấy chính
    của quy cách."""
    from app.models.lsx import LsxCongDoanVatTu
    from app.models.vat_lieu_kho import GiayNguyen

    song = GiayNguyen(ma="SONG-E-T", ten="Giấy sóng E", gsm=400, loai="song")
    db.add(song)
    db.flush()
    buoc = _in_step(db, lenh.id)
    giay_cu = [v.vat_tu_ten_snapshot for v in buoc.vat_tus if v.hang_loai == "giay"]
    db.add(LsxCongDoanVatTu(
        lsx_cong_doan_id=buoc.id, hang_loai="giay", vat_tu_id=song.id,
        vat_tu_ma_snapshot=song.ma, vat_tu_ten_snapshot=song.ten,
        don_vi_snapshot="kg", so_luong=1.0, kho_rong=780, kho_dai=905, thu_tu=-1, tu_dong=False,
    ))
    db.commit()
    db.expire_all()
    # Sóng khai TRƯỚC giấy cũ trong bước, ngăn vẫn kể giấy trước sóng sau (mg 0426).
    assert svc3.chi_tiet(lenh.id)["giays"] == [*giay_cu, "Giấy sóng E"]


def test_mo_lai_de_sua_bo_luon_moc_lich(db, svc3, lsx_svc, lenh, admin):
    """Bấm thử 05/11: Mở lại để sửa (Sẵn sàng → Nháp) mà mốc còn nằm lại thì lần Sẵn sàng sau lệnh
    hiện lại trên thanh ở giờ cũ, và nút phát hành vẫn thấy "đã có giờ"."""
    from app.models.lsx import TT_NHAP
    from app.models.xep_lich_lenh import XepLichLenh

    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    lsx_svc.set_trang_thai(lsx_id=lenh.id, trang_thai=TT_NHAP, actor=admin)
    assert db.query(XepLichLenh).filter_by(lsx_id=lenh.id).count() == 0


def test_phat_hanh_tu_choi_lenh_nhap(db, svc3, lenh, admin):
    """Cửa phát hành màn 3 không chặn nghiệp vụ, nhưng lệnh Nháp chưa qua tay kế hoạch thì không thả
    xuống xưởng được, kể cả khi mốc còn sót lại."""
    from app.models.lsx import TT_NHAP

    svc3.dat_moc(lenh.id, datetime(2026, 9, 11, 8, 0))
    lenh.trang_thai = TT_NHAP          # mốc sót từ trước bản sửa: đi thẳng DB, không qua Mở lại
    db.commit()
    with pytest.raises(XepLichLenhConflict, match="Nháp"):
        svc3.phat_hanh(lenh.id, actor=admin)
