"""Vấn đề kế hoạch (xung đột & nguy cơ trễ) — service-level tests.

Tái dùng fixtures + helpers của test xếp lịch (đơn → SX → lệnh → sẵn sàng → đưa vào kế hoạch → gán).
Kiểm detector đè khóa máy và sai tiền nhiệm, vòng đời state, luật ngoại
lệ (kỹ thuật bất khả không được duyệt), và gate PHÁT HÀNH (còn Chặn → chặn; ngoại lệ → thả; thu hồi).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.department import Department
from app.models.lsx import (
    LB_MAY, LB_THUE_NGOAI, LB_TO, Lsx, LsxCongDoan, TT_DA_LAP_KE_HOACH, TT_DA_PHAT_HANH,
)
from app.models.may_thiet_bi import MayThietBi
from app.repositories.audit_repo import AuditLogRepository
from app.repositories.xep_lich_repo import XepLichRepository
from app.services.gio_xuong import ve_gio_xuong  # noqa: F401  (đối xứng với `_thuc`)
from app.services.xep_lich_service import XepLichConflict, _gio_xuong
from app.services.xep_lich_van_de_service import XepLichVanDeService

# Fixtures (db/admin/customer/orders/lsx_svc/bg_svc/xl_svc) + helpers dùng chung từ test xếp lịch.
from tests.test_xep_lich_service import (  # noqa: F401
    _giu_cho_du,
    _hai_lsx_san_sang,
    _nha_cho,
    _in_step,
    admin,
    bg_svc,
    customer,
    db,
    lsx_svc,
    orders,
    xl_svc,
)


def _thuc(t: datetime) -> datetime:
    """Mốc GIỜ XƯỞNG `t` ứng với mốc UTC THẬT nào — `san_xuat_phien_chay.bat_dau/ket_thuc` do
    `thuc_thi._moc()` ghi bằng UTC thật, còn `du_kien_*`/`start_at` là giờ tường nhà máy. Dựng cả
    hai từ cùng một hằng là bỏ lọt đúng chỗ hai thang gặp nhau. Xem `app/services/gio_xuong.py`."""
    return t - (datetime.now().astimezone().utcoffset() or timedelta(0))


@pytest.fixture


def vd_svc(db):
    return XepLichVanDeService(db, AuditLogRepository(db))


def _luon_lam(monkeypatch):
    """Bỏ nhiễu ngày nghỉ cho MỌI CalendarService (cả instance trong vd_svc.xl)."""
    monkeypatch.setattr(
        "app.services.calendar_service.CalendarService.is_working_day", lambda self, d: True
    )


def _bo_do(res, tien_to):
    """Lọc theo TIỀN TỐ `issue_key` = đúng một bộ dò.

    Không lọc theo `category`: từ 18/08/2026 loại đã gom còn 6 cho người đọc (`may` trùm cả
    trùng-giờ · đè-khoá · quá-tải · không-kham-khổ), nên lọc theo loại là kiểm chung bốn bộ dò
    một lượt — test hết chỉ được đúng cái nó muốn chỉ.
    """
    return [it for it in res["items"] if it["issue_key"].split(":", 1)[0].startswith(tien_to)]


# --- Cửa CHẶN PHÁT HÀNH khi thiếu vật tư (17/08/2026) -------------------------
#
# Bơm thẳng bảng cân đối giả thay vì dựng cả luồng đơn → lệnh → phiếu mua: cái đang kiểm là LUẬT
# PHÂN LOẠI của detector, không phải phép cộng trừ của bảng cân đối (đã có test riêng ở
# `test_ke_hoach_vat_tu.py`).


def _bang_gia(dong: list[dict]) -> dict:
    return {"items": [{"loai_nhom": "vat_tu", "hang_ten": "Couché 300", "hang_ma": "GY-1",
                       "dong": dong}]}


def _rows(*lsx_ids: int) -> list[dict]:
    return [{"lsx_id": i, "lsx_ma": f"LSX-{i}", "bai_ghep_id": None, "may_id": None, "id": i * 10}
            for i in lsx_ids]


def test_chi_dong_DO_bao_thieu_hang_dang_ve_thi_khong(db, vd_svc, monkeypatch):
    """Chỉ `do` (tồn + hàng đang về vẫn không đủ) mới báo — mức LƯU Ý, không chặn (01/10/2026). Từ 18/09/2026 bảng cân đối không so
    ngày về với ngày cần nữa — hàng đang về (vàng) là đủ, dù NCC hẹn giao muộn đến đâu."""
    monkeypatch.setattr(vd_svc, "_can_doi_vat_tu", lambda: _bang_gia([
        {"trang_thai": "do", "lsx_id": 1, "bai_ghep_id": None},
        {"trang_thai": "vang", "lsx_id": 2, "bai_ghep_id": None},
        {"trang_thai": "khong_ro", "lsx_id": 3, "bai_ghep_id": None},
    ]))
    out = vd_svc._thieu_vat_tu(_rows(1, 2, 3))

    assert [v["issue_key"].split(":", 1)[1] for v in out] == ["lsx:1"]
    assert out[0]["severity"] == "luu_y", "thiếu vật tư chỉ cảnh báo, không chặn phát hành"
    assert "Couché 300" in out[0]["title"]


def test_mot_lenh_thieu_nhieu_mon_chi_ra_MOT_van_de(db, vd_svc, monkeypatch):
    """Gộp một vấn đề cho mỗi lệnh — thiếu những gì thì mở bảng cân đối ra xem."""
    monkeypatch.setattr(vd_svc, "_can_doi_vat_tu", lambda: _bang_gia([
        {"trang_thai": "do", "lsx_id": 1, "bai_ghep_id": None, "buoc_id": 1},
        {"trang_thai": "do", "lsx_id": 1, "bai_ghep_id": None, "buoc_id": 2},
    ]))
    out = vd_svc._thieu_vat_tu(_rows(1))

    assert len(out) == 1, out


def test_bang_can_doi_hong_thi_KEU_chu_khong_im(db, vd_svc, monkeypatch):
    """Trả rỗng đọc y hệt "không lệnh nào thiếu" — và cửa phát hành mở cho lệnh không có giấy."""
    def _no(*_a, **_k):
        raise RuntimeError("bảng hỏng")

    monkeypatch.setattr(vd_svc, "_can_doi_vat_tu", _no)
    out = vd_svc._thieu_vat_tu(_rows(1))
    assert len(out) == 1 and "Không kiểm được vật tư" in out[0]["title"]


# --- Detector: đè vùng khóa máy ---------------------------------------------


# --- Detector: sai thứ tự tiền nhiệm ----------------------------------------


def _gop_in_va_san_sang(db, bg_svc, bg, admin):
    """Gộp bước in + lập kế hoạch lượt chung → bài đủ điều kiện sẵn sàng.

    Bài ghép không tự gộp bước nào; chưa gộp thì đó là N lệnh rời và gate `san_sang` chặn.
    """
    from app.models.department import Department

    tvs = bg_svc._get(bg.id).thanh_viens
    bg_svc.gop(bai_ghep_id=bg.id, actor=admin,
               step_keys=[_in_step(db, tv.lsx_id).step_key for tv in tvs])
    mau = _in_step(db, tvs[0].lsx_id)
    to_id = mau.department_id or db.query(Department.id).scalar()
    for c in bg_svc._buoc_chungs(bg_svc._get(bg.id)):
        bg_svc.lap_ke_hoach_buoc_chung(
            bai_ghep_id=bg.id, gang_step_key=c.step_key, actor=admin,
            patch={"department_id": to_id, "may_id": mau.may_id},
        )
    # `so_con_tren_to` khởi tạo từ `lsx.so_con` — số con khi lệnh còn đứng RIÊNG, tự tính như thể
    # được cả tờ. Ghép N lệnh cùng tờ mà giữ nguyên số đó là chồng diện tích → gate `vuot_dien_tich`
    # chặn đúng — chia đều cho số thành viên trước khi đòi sẵn sàng.
    for tv in bg_svc._get(bg.id).thanh_viens:
        bg_svc.sua_thanh_vien(
            bai_ghep_id=bg.id, thanh_vien_id=tv.id, actor=admin,
            so_con_tren_to=max(1, int(tv.so_con_tren_to or 1) // len(tvs)),
        )
    ra = bg_svc.set_trang_thai(bai_ghep_id=bg.id, trang_thai="san_sang", actor=admin)
    # Bài là CHỦ THỂ giữ chỗ — bật sau khi gộp, vì gộp làm đổi số giấy cần.
    _giu_cho_du(db, bai_ghep_ids=[bg.id])
    return ra


# --- Xả tờ là bước Máy bình thường, không còn detector theo tên ---------------


def test_khong_con_detector_gang_thieu_xa_to(db, orders, lsx_svc, bg_svc, xl_svc, vd_svc, admin, customer, monkeypatch):
    _luon_lam(monkeypatch)
    a, b = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)
    # Có hay không có bước tên Xả tờ đều do routing động quyết định, không sinh cảnh báo hardcode.
    db.add(LsxCongDoan(lsx_id=a.id, thu_tu=1, ten="Dán", nhom="finishing", loai_buoc=LB_TO,
                       department_id=_in_step(db, a.id).department_id, so_luong_vao=5000, chay_phut=20))
    db.add(LsxCongDoan(lsx_id=b.id, thu_tu=1, ten="Xả tờ", nhom="finishing", loai_buoc=LB_MAY,
                       may_id=_in_step(db, b.id).may_id, so_luong_vao=5000))
    db.commit()
    _nha_cho(db, [a.id, b.id])
    bg = bg_svc.tao(lsx_ids=[a.id, b.id], actor=admin)
    bg = _gop_in_va_san_sang(db, bg_svc, bg, admin)
    xl_svc.dua_vao_bai_ghep(bai_ghep_id=bg.id, actor=admin)
    gang = _bo_do(vd_svc.liet_ke(), "gang_thieu_xa_to")
    assert gang == []


# --- Gate phát hành: còn Chặn → chặn; ngoại lệ → thả; thu hồi ----------------


# --- Vòng đời state + ngoại lệ kỹ thuật bị chặn + tái phát -------------------


def test_state_lifecycle_technical_no_exception_reopen(db, orders, lsx_svc, xl_svc, vd_svc, admin, customer, monkeypatch):
    _luon_lam(monkeypatch)
    lsx = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)[0]  # quy_cach kho_in 650×900, 4 màu
    nho = MayThietBi(ma="MAY-NHO-VD", ten="Máy con", loai_may="press_offset_sheet",
                     toc_do=3000, don_vi_toc_do="to_gio", kho_max_dai=520, kho_max_rong=360)
    db.add(nho)
    db.flush()
    step = _in_step(db, lsx.id)
    step.setup_phut, step.so_luong_vao, step.chay_phut = 0, 5000, None
    db.commit()
    xl_svc.dua_vao_lsx(lsx_id=lsx.id, actor=admin)
    dong = XepLichRepository(db).by_lsx(lsx.id)[0]
    xl_svc.gan(dong_id=dong.id, patch={"may_id": nho.id,
               "start_at": datetime(2026, 7, 27, 8, 0, tzinfo=timezone.utc)}, actor=admin)

    mk = _bo_do(vd_svc.liet_ke(), "may_khong_kham")[0]
    assert mk["severity"] == "luu_y" and mk["trang_thai"] == "moi"

    # Vấn đề kỹ thuật (máy không kham) KHÔNG được duyệt ngoại lệ → 409.
    with pytest.raises(XepLichConflict):
        vd_svc.ngoai_le(issue_key=mk["issue_key"], ly_do="tạm chạy", expires_at=None, actor=admin)

    # Tiếp nhận → hiện trạng thái tiep_nhan.
    vd_svc.tiep_nhan(issue_key=mk["issue_key"], actor=admin)
    it2 = next(it for it in vd_svc.liet_ke()["items"] if it["issue_key"] == mk["issue_key"])
    assert it2["trang_thai"] == "tiep_nhan"

    # Đánh dấu đã xử lý nhưng máy vẫn nhỏ → vấn đề vẫn dẫn xuất → TÁI PHÁT (mo_lai).
    vd_svc.danh_dau_xu_ly(issue_key=mk["issue_key"], actor=admin)
    it3 = next(it for it in vd_svc.liet_ke()["items"] if it["issue_key"] == mk["issue_key"])
    assert it3["mo_lai"] is True


# --- Detector: quá tải máy (cửa sổ 7 ngày) ----------------------------------


def test_qua_tai_may_detector(db, orders, lsx_svc, xl_svc, vd_svc, admin, customer, monkeypatch):
    _luon_lam(monkeypatch)
    # Neo "hôm nay" của detector về đúng ngày xếp (cửa sổ 7 ngày mới trùm dòng đã xếp).
    fixed = datetime(2026, 7, 27, 8, 0, tzinfo=timezone.utc)
    monkeypatch.setattr("app.services.xep_lich_van_de_service._gio_xuong", lambda: fixed)
    lsx = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)[0]
    step = _in_step(db, lsx.id)
    # Ô "Thời gian khác" 12000' (200h) chiếm máy > 7×1440' = 10080' khả dụng → >100% Cao.
    # Trần đổi từ 3360' lên 10080' vì máy nay chạy LIÊN TỤC (2026-08-10, bỏ ca của máy): đèn quá
    # tải máy chỉ còn sáng khi một máy bị nhét quá 7 ngày công việc liền — trần thật của xưởng
    # nằm ở quỹ giờ-NGƯỜI của tổ. Dùng ô này vì `chay_phut` gõ đè đã bỏ (2026-08-04).
    step.so_luot_chay, step.so_luong_vao = 1, 5000
    step.phat_sinh_phut = 12000
    db.commit()
    xl_svc.dua_vao_lsx(lsx_id=lsx.id, actor=admin)
    dong = XepLichRepository(db).by_lsx(lsx.id)[0]
    xl_svc.gan(dong_id=dong.id, patch={"may_id": step.may_id, "start_at": fixed}, actor=admin)
    qt = _bo_do(vd_svc.liet_ke(), "qua_tai_may")
    assert len(qt) == 1 and qt[0]["severity"] == "luu_y"
    assert step.may_id in qt[0]["impacts"]["may_ids"]

    # Dời "hôm nay" ra xa 60 ngày → dòng nằm NGOÀI cửa sổ 7 ngày → hết cảnh báo tải.
    monkeypatch.setattr("app.services.xep_lich_van_de_service._gio_xuong",
                        lambda: datetime(2026, 9, 30, 8, 0, tzinfo=timezone.utc))
    assert _bo_do(vd_svc.liet_ke(), "qua_tai_may") == []


# --- Detector: hạn LSX sớm hơn lúc bài ghép in xong -------------------------


# --- Detector: lệch thực tế (J) ----------------------------------------------


def _dong_va_cong_viec(db, orders, lsx_svc, admin, customer):
    """Một dòng lịch đã gán máy + giờ, cộng một công việc sản xuất ĐANG PHÁT HÀNH nối vào đúng
    dòng đó qua `lsx_cong_doan_id` — nền dùng chung cho các test lệch thực tế bên dưới.

    KHÔNG đi qua `xl_svc.gan()` (tính `finish_at` theo giờ làm việc, cần `_luon_lam(monkeypatch)`
    né ngày nghỉ) — ở đây chỉ cần MỘT dòng đã có máy + mốc giờ để `nap_thuc_te` có cái mà so, nên
    gán thẳng lên ORM. Mốc neo vào `_gio_xuong()` (giờ xưởng "bây giờ" của chính module này) thay
    vì ghim ngày cứng, cùng lý do `test_phat_hanh_gate_ngoai_le_revert` đã ghi chú: ghim cứng một
    ngày thì hôm đó trôi qua là test đỏ vĩnh viễn — ở đây còn tệ hơn, vì "quá giờ dự kiến" đo tới
    BÂY GIỜ thật (`nap_thuc_te` không truyền `bay_gio`), mốc quá khứ càng xa "bây giờ" càng bơm
    `tre_ket_thuc_phut` giả lên hàng chục nghìn phút.
    """
    from app.models.san_xuat import SanXuatCongViec, SanXuatGoiPhatHanh
    from app.models.xep_lich import TT_DA_XEP
    from app.services.xep_lich_service import XepLichService

    xl = XepLichService(db, XepLichRepository(db), AuditLogRepository(db))
    lsx = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)[0]
    step = _in_step(db, lsx.id)
    step.setup_phut, step.so_luong_vao, step.chay_phut = 0, 5000, None
    db.commit()
    xl.dua_vao_lsx(lsx_id=lsx.id, actor=admin)
    dong = XepLichRepository(db).by_lsx(lsx.id)[0]
    dong.may_id = step.may_id
    dong.start_at = _gio_xuong()
    dong.finish_at = dong.start_at + timedelta(hours=1)
    dong.trang_thai = TT_DA_XEP
    db.commit()

    goi = SanXuatGoiPhatHanh(ma=f"GOI-VD-{dong.id}")
    db.add(goi)
    db.flush()
    cv = SanXuatCongViec(goi_id=goi.id, lsx_id=lsx.id, lsx_cong_doan_id=dong.lsx_cong_doan_id,
                        ten_cong_doan=step.ten or "In")
    db.add(cv)
    db.commit()
    return dong, cv


def _van_de_svc(db):
    return XepLichVanDeService(db, AuditLogRepository(db))


def test_lech_thuc_te_bat_dau_muon_thi_bao_luu_y(db, orders, lsx_svc, admin, customer):
    """Tổ vào việc muộn hơn 1 tiếng so với kế hoạch ⇒ có vấn đề `lech_thuc_te`, mức Nên xem.

    KHÔNG BAO GIỜ là mức Chặn: lệnh đã phát hành rồi mới có thực tế — chặn ở đây là chặn muộn.
    """
    from datetime import timedelta

    from app.models.san_xuat import CV_DANG_CHAY
    from app.models.san_xuat_thuc_thi import SanXuatPhienChay
    from app.services.xep_lich_van_de_service import (
        CAT_HAN, K_LECH_THUC_TE, SEV_LUU_Y,
    )

    dong, cv = _dong_va_cong_viec(db, orders, lsx_svc, admin, customer)  # helper của file này
    cv.trang_thai = CV_DANG_CHAY
    cv.du_kien_bat_dau = dong.start_at
    cv.du_kien_ket_thuc = dong.finish_at
    db.add(SanXuatPhienChay(cong_viec_id=cv.id, so_thu_tu=1,
                            bat_dau=_thuc(dong.start_at + timedelta(hours=3))))
    db.commit()

    svc = _van_de_svc(db)  # helper của file này
    items = svc.liet_ke()["items"]
    it = next(i for i in items if i["issue_key"] == f"{K_LECH_THUC_TE}:{dong.id}")
    assert it["severity"] == SEV_LUU_Y
    assert it["category"] == CAT_HAN
    assert it["delay_phut"] == 180
    assert "muộn" in it["nguyen_nhan"]
    # Dùng CHUNG `_phut_str` với 12 bộ dò kia — một danh sách mà hai bộ dò viết độ trễ hai kiểu
    # ("3 giờ" vs "3g00") là bắt người đọc học hai bảng chữ cái cho cùng một con số.
    assert "3 giờ" in it["nguyen_nhan"]


def test_lech_thuc_te_viec_da_xong_thi_thoi_bao(db, orders, lsx_svc, admin, customer):
    """Vào việc muộn nhưng ĐÃ XONG ⇒ rời hàng đèn.

    `XepLichRepository.list_dong()` không lọc việc đã hoàn thành bao giờ, nên không có guard này
    thì một bước vào việc muộn 3 tiếng hồi tháng trước nằm MÃI trong danh sách vấn đề — hàng đèn
    chỉ phình ra, đúng cái bệnh mà ngưỡng 60 phút sinh ra để tránh. Cái muộn đó cũng đã nằm trong
    mốc bắt đầu THẬT của bước sau rồi.
    """
    from datetime import timedelta

    from app.models.san_xuat import CV_HOAN_THANH
    from app.models.san_xuat_thuc_thi import SanXuatPhienChay
    from app.services.xep_lich_van_de_service import K_LECH_THUC_TE

    dong, cv = _dong_va_cong_viec(db, orders, lsx_svc, admin, customer)
    cv.trang_thai = CV_HOAN_THANH
    cv.du_kien_bat_dau = dong.start_at
    cv.du_kien_ket_thuc = dong.finish_at
    db.add(SanXuatPhienChay(cong_viec_id=cv.id, so_thu_tu=1,
                            bat_dau=_thuc(dong.start_at + timedelta(hours=3)),
                            ket_thuc=_thuc(dong.start_at + timedelta(hours=5))))
    db.commit()

    keys = {i["issue_key"] for i in _van_de_svc(db).liet_ke()["items"]}
    assert f"{K_LECH_THUC_TE}:{dong.id}" not in keys


def test_lech_thuc_te_chua_ai_vao_viec_thi_khong_bao_qua_gio(db, orders, lsx_svc, admin, customer):
    """Lệnh đã phát hành nhưng CHƯA ai bấm vào việc, mốc kết thúc dự kiến đã trôi qua từ lâu
    ⇒ bộ dò này im.

    Spec §2.2 nêu đúng hai vế, cả hai đều đòi có hoạt động thật: "đã bắt đầu MUỘN hơn
    `du_kien_bat_dau`" và "ĐANG CHẠY mà đã quá `du_kien_ket_thuc`". Một công việc `released`
    chưa ai đụng tới không rơi vào vế nào — cái đó là việc của `nguy_co_tre` (rủi ro kế hoạch),
    không phải của bộ dò thực tế. Bỏ điều kiện "đã vào việc" thì mọi lệnh cũ chưa chạy đều bị
    dán nhãn "vẫn đang chạy và đã quá mốc" — sai sự thật, và trên dữ liệu thật nó nhuộm đỏ quá
    nửa bàn xếp lịch.
    """
    from app.models.san_xuat import CV_PHAT_HANH
    from app.services.xep_lich_van_de_service import K_LECH_THUC_TE

    dong, cv = _dong_va_cong_viec(db, orders, lsx_svc, admin, customer)
    cv.trang_thai = CV_PHAT_HANH
    cv.du_kien_bat_dau = dong.start_at
    # Mốc kết thúc dự kiến đã trôi qua 10 tiếng, nhưng không có phiên chạy nào.
    cv.du_kien_ket_thuc = _gio_xuong() - timedelta(hours=10)
    db.commit()

    keys = {i["issue_key"] for i in _van_de_svc(db).liet_ke()["items"]}
    assert f"{K_LECH_THUC_TE}:{dong.id}" not in keys


def test_lech_thuc_te_dung_gio_thi_im_lang(db, orders, lsx_svc, admin, customer):
    from datetime import timedelta

    from app.models.san_xuat import CV_DANG_CHAY
    from app.models.san_xuat_thuc_thi import SanXuatPhienChay
    from app.services.xep_lich_van_de_service import K_LECH_THUC_TE

    dong, cv = _dong_va_cong_viec(db, orders, lsx_svc, admin, customer)
    cv.trang_thai = CV_DANG_CHAY
    cv.du_kien_bat_dau = dong.start_at
    cv.du_kien_ket_thuc = dong.finish_at
    db.add(SanXuatPhienChay(cong_viec_id=cv.id, so_thu_tu=1,
                            bat_dau=_thuc(dong.start_at + timedelta(minutes=15))))
    db.commit()

    keys = {i["issue_key"] for i in _van_de_svc(db).liet_ke()["items"]}
    assert f"{K_LECH_THUC_TE}:{dong.id}" not in keys


# Gate "duyệt ngoại lệ đòi `approve_exception`" (`POST /api/xep-lich-2/duyet-ngoai-le/lsx/{id}`):
# GỠ 18/09/2026 cùng bàn xếp lịch theo công đoạn — bàn cấp lệnh KHÔNG có cửa gác nên cũng không có
# ngoại lệ để duyệt. Bit `can_approve_exception` vẫn còn trên khoá `xep_lich` (mg `0314` chép y
# nguyên), chỉ là hiện không router nào hỏi tới.


def test_sai_tien_nhiem_im_khi_to_da_vao_viec(db, orders, lsx_svc, admin, customer):
    """Bước ĐANG CHẠY, mốc đã xếp nằm trong quá khứ ⇒ `sai_tien_nhiem` im, `lech_thuc_te` lên tiếng.

    `som_nhat` có sàn là BÂY GIỜ (`XepLichService._san_thoi_gian`), nên MỌI mốc đã xếp trong quá
    khứ đều có `som_nhat > start_at` — kể cả bước chạy đúng thứ tự routing. Không có guard này thì
    `sai_tien_nhiem` (mức Chặn) bật cho mọi lệnh đang chạy, báo bằng một câu về routing không đúng
    chuyện, VÀ vì hàng đèn Kế hoạch SX lấy mức nặng nhất nên nó che vĩnh viễn `lech_thuc_te` —
    bộ dò duy nhất nói được chuyện xưởng chạy lệch mốc, vốn chỉ sống trên lịch đã qua.
    """
    from app.models.san_xuat import CV_DANG_CHAY
    from app.models.san_xuat_thuc_thi import SanXuatPhienChay
    from app.services.xep_lich_van_de_service import K_LECH_THUC_TE, K_SAI_TIEN_NHIEM

    dong, cv = _dong_va_cong_viec(db, orders, lsx_svc, admin, customer)
    # Lùi 24 tiếng chứ không phải vài tiếng: `_gio_xuong()` là giờ TƯỜNG của xưởng (UTC+7) nhưng
    # cột DateTime lưu naive rồi đọc lại như UTC, nên mốc quá khứ bị đẩy lên 7 tiếng khi so với
    # "bây giờ" thật trong `nap_thuc_te`. Lùi ít hơn 7 tiếng là mốc kết thúc dự kiến hoá ra vẫn ở
    # tương lai và vế "quá giờ" im — đúng cái bẫy `_dong_va_cong_viec` đã ghi chú.
    dong.start_at = _gio_xuong() - timedelta(hours=24)
    dong.finish_at = dong.start_at + timedelta(hours=1)
    cv.trang_thai = CV_DANG_CHAY
    cv.du_kien_bat_dau = dong.start_at
    cv.du_kien_ket_thuc = dong.finish_at
    db.add(SanXuatPhienChay(cong_viec_id=cv.id, so_thu_tu=1,
                            bat_dau=_thuc(dong.start_at + timedelta(minutes=10))))
    db.commit()

    keys = {i["issue_key"] for i in _van_de_svc(db).liet_ke()["items"]}
    assert f"{K_SAI_TIEN_NHIEM}:{dong.id}" not in keys
    assert f"{K_LECH_THUC_TE}:{dong.id}" in keys


def test_lich_da_qua_noi_dung_cua_no_khong_muon_thu_tu_cong_doan(db, orders, lsx_svc, admin,
                                                                 customer):
    """Mốc đã xếp trôi qua, CHƯA ai vào việc ⇒ khoá riêng `lich_da_qua`, câu chữ nói đúng chuyện.

    Trước đây chung khoá với `sai_tien_nhiem` nên bảng Lệnh sản xuất báo "Công đoạn sau chạy trước
    công đoạn trước" cho một bước không có tiền nhiệm nào — người điều độ đi tìm một lỗi thứ tự
    không tồn tại, trong khi việc phải làm là XẾP LẠI GIỜ. Vẫn giữ mức Chặn: lịch nằm trong quá
    khứ thì chưa thả xuống xưởng được.
    """
    from app.services.xep_lich_van_de_service import (
        K_LICH_DA_QUA, K_SAI_TIEN_NHIEM, SEV_CHAN,
    )

    dong, cv = _dong_va_cong_viec(db, orders, lsx_svc, admin, customer)
    dong.start_at = _gio_xuong() - timedelta(hours=24)
    dong.finish_at = dong.start_at + timedelta(hours=1)
    db.commit()

    items = _van_de_svc(db).liet_ke()["items"]
    keys = {i["issue_key"] for i in items}
    assert f"{K_SAI_TIEN_NHIEM}:{dong.id}" not in keys
    it = next(i for i in items if i["issue_key"] == f"{K_LICH_DA_QUA}:{dong.id}")
    assert it["severity"] == SEV_CHAN
    assert "chưa ai vào việc" in it["title"]
    assert "Xếp lại giờ" in it["nguyen_nhan"]
    assert it["delay_phut"] and it["delay_phut"] > 0


def test_phat_hanh_duoc_khi_thieu_giay_va_co_canh_bao(db, orders, lsx_svc, vd_svc, admin, customer):
    """Thiếu giấy (tắt giữ chỗ ⇒ không giữ được gì) thì cửa phát hành KHÔNG chặn, chỉ cảnh báo thiếu
    gì — lệnh cần cắt giấy phải phát hành được để tới tổ Cắt (spec giấy đếm tờ × khổ §4.3)."""
    from app.services.xep_lich import release
    from app.services.xep_lich.constraint import MUC_CANH_BAO

    lsx = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)[0]
    release._giu_cho_service(db).tat(lsx_id=lsx.id)

    soat = release.soat_vat_tu(db, lsx_id=lsx.id)
    assert soat["chan"] == []
    assert "vat_tu_chua_du" in [i["ma"] for i in soat["canh_bao"]]
    assert all(i["muc"] == MUC_CANH_BAO for i in soat["canh_bao"])
    assert release.van_de_vat_tu(db, lsx_id=lsx.id) == []
    vd_svc._chan_thieu_vat_tu(lsx_id=lsx.id)            # không ném
