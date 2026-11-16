"""Ô "Nhà gia công tự lo" trên dòng vật tư của bước thuê ngoài (Thuê gia công đợt 1, Task 1.2).

Ứng với `bom_item.sourced_by_supplier` của ERPNext: bước thuê ngoài vẫn bung vật tư của công đoạn,
mỗi dòng mặc định tự lo (`ncc_tu_lo=True`) nên kế hoạch vật tư và giữ chỗ bỏ qua; bỏ tick thì
xưởng cấp và dòng vào nhu cầu như bước thường. Bước không thuê ngoài bỏ qua cờ."""
from __future__ import annotations

from app.models.cong_doan import CongDoan, CongDoanVatTu
from app.models.lsx import LB_MAY, LB_THUE_NGOAI, TT_SAN_SANG
from app.models.vat_lieu_kho import VatTuInAn
from app.schemas.lsx import LsxCongDoanIn
from tests.gia_cong_fixtures import hang_can_cua, lenh_chua_phat
from tests.lenh_sx_fixtures import admin, customer, orders, lsx_svc, sess  # noqa: F401


def _mang(sess) -> VatTuInAn:
    m = VatTuInAn(ma="VT-MANG-TGC", ten="Màng BOPP bóng", don_vi_gia="kg", active=True,
                  cong_thuc_dinh_muc="sl_vao / 1000")
    sess.add(m)
    sess.flush()
    return m


def _cong_doan_can_mang(sess, mang) -> CongDoan:
    cd = CongDoan(ma="CD-CM-TGC", ten="Cán màng bóng", nhom="finishing",
                  don_vi_vao="to", don_vi_ra="to")
    sess.add(cd)
    sess.flush()
    cd.vat_tus.append(CongDoanVatTu(vat_tu_id=mang.id, thu_tu=0))
    sess.commit()
    return cd


def _rows(lsx, **sua_buoc_cuoi) -> list[LsxCongDoanIn]:
    ds = sorted(lsx.cong_doans, key=lambda c: c.thu_tu)
    out = []
    for i, c in enumerate(ds):
        d = {"step_key": c.step_key, "thu_tu": i, "cong_doan_id": c.cong_doan_id, "ten": c.ten,
             "nhom": c.nhom, "loai_buoc": c.loai_buoc, "department_id": c.department_id,
             "may_id": c.may_id}
        if i == len(ds) - 1:
            d.update(sua_buoc_cuoi)
        out.append(LsxCongDoanIn(**d))
    return out


def _buoc_cuoi(lsx):
    return max(lsx.cong_doans, key=lambda c: c.thu_tu)


def _lenh_buoc_cuoi_thue_can_mang(sess, orders, lsx_svc, admin, customer):
    """Lệnh nháp, bước cuối đổi sang công đoạn Cán màng (có màng) + Thuê ngoài. Trả `(lsx, mang)`."""
    mang = _mang(sess)
    cd = _cong_doan_can_mang(sess, mang)
    lsx = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(
        lsx, cong_doan_id=cd.id, ten=cd.ten, loai_buoc=LB_THUE_NGOAI,
        department_id=None, may_id=None), actor=admin)
    sess.commit()
    return lsx, mang


def _dong_mang(lsx, mang, ncc_tu_lo: bool) -> list[dict]:
    return [{"hang_loai": "vat_tu", "vat_tu_id": mang.id, "tu_dong": True, "ncc_tu_lo": ncc_tu_lo}]


def test_buoc_thue_ngoai_van_bung_vat_tu(sess, orders, lsx_svc, admin, customer):
    lsx, mang = _lenh_buoc_cuoi_thue_can_mang(sess, orders, lsx_svc, admin, customer)
    dong = [v for v in _buoc_cuoi(lsx).vat_tus if v.hang_loai == "vat_tu" and v.vat_tu_id == mang.id]
    assert len(dong) == 1
    assert dong[0].ncc_tu_lo is True
    buoc = max(lsx_svc.detail_dict(lsx)["cong_doans"], key=lambda c: c["thu_tu"])
    assert [v["ncc_tu_lo"] for v in buoc["vat_tus"]
            if v["hang_loai"] == "vat_tu" and v["vat_tu_id"] == mang.id] == [True]


def test_khvt_bo_dong_tu_lo(sess, orders, lsx_svc, admin, customer):
    lsx, mang = _lenh_buoc_cuoi_thue_can_mang(sess, orders, lsx_svc, admin, customer)
    assert ("vat_tu", mang.id) not in hang_can_cua(sess, lsx.id)


def test_khvt_tinh_dong_xuong_cap(sess, orders, lsx_svc, admin, customer):
    lsx, mang = _lenh_buoc_cuoi_thue_can_mang(sess, orders, lsx_svc, admin, customer)
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(
        lsx, vat_tus=_dong_mang(lsx, mang, False)), actor=admin)
    sess.commit()
    dong = [v for v in _buoc_cuoi(lsx).vat_tus if v.hang_loai == "vat_tu" and v.vat_tu_id == mang.id]
    assert [v.ncc_tu_lo for v in dong] == [False]
    assert ("vat_tu", mang.id) in hang_can_cua(sess, lsx.id)

    # Lưu lại mà client không gửi cờ ⇒ giữ cờ cũ của dòng (không tự bật lại tự lo).
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(
        lsx, vat_tus=[{"hang_loai": "vat_tu", "vat_tu_id": mang.id, "tu_dong": True}]), actor=admin)
    sess.commit()
    assert [v.ncc_tu_lo for v in _buoc_cuoi(lsx).vat_tus if v.hang_loai == "vat_tu" and v.vat_tu_id == mang.id] == [False]


def test_giu_cho_bo_dong_tu_lo(sess, orders, lsx_svc, admin, customer):
    """Giữ chỗ đi theo nhu cầu của kế hoạch vật tư: dòng tự lo không bị giữ, dòng xưởng cấp thì có.

    Lệnh đang giữ chỗ khoá sửa routing (`_chan_dang_giu_cho`) nên kiểm hai lượt bật trên hai trạng
    thái của dòng, nhả chỗ ở giữa — đúng đường lùi người dùng đi."""
    from app.services.xep_lich.release import _giu_cho_service

    lsx, mang = _lenh_buoc_cuoi_thue_can_mang(sess, orders, lsx_svc, admin, customer)
    # Bảng cân đối toàn xưởng (nguồn của giữ chỗ) chỉ tính lệnh đã qua Nháp.
    lsx.trang_thai = TT_SAN_SANG
    sess.commit()
    gc = _giu_cho_service(sess)
    # Kho trống: dòng nào là nhu cầu thì nằm ở `thieu`.
    tt = gc.bat(lsx_id=lsx.id)
    assert not any(k[0] == "vat_tu" and k[1] == mang.id for k in tt["thieu"])
    gc.tat(lsx_id=lsx.id)
    sess.commit()

    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(
        lsx, vat_tus=_dong_mang(lsx, mang, False)), actor=admin)
    sess.commit()
    lsx.trang_thai = TT_SAN_SANG   # lưu routing đưa lệnh về Chờ bổ sung
    sess.commit()
    tt = gc.bat(lsx_id=lsx.id)
    assert any(k[0] == "vat_tu" and k[1] == mang.id for k in tt["thieu"])


def test_buoc_thuong_khong_doc_co(sess, orders, lsx_svc, admin, customer):
    lsx, mang = _lenh_buoc_cuoi_thue_can_mang(sess, orders, lsx_svc, admin, customer)
    dau = min(lsx.cong_doans, key=lambda c: c.thu_tu)
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(
        lsx, loai_buoc=LB_MAY, department_id=dau.department_id,
        vat_tus=_dong_mang(lsx, mang, True)), actor=admin)
    sess.commit()
    assert _buoc_cuoi(lsx).loai_buoc == LB_MAY
    assert [v.ncc_tu_lo for v in _buoc_cuoi(lsx).vat_tus if v.hang_loai == "vat_tu" and v.vat_tu_id == mang.id] == [True]
    assert ("vat_tu", mang.id) in hang_can_cua(sess, lsx.id)
