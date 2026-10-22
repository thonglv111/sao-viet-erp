"""Lệnh & bài ghép theo luật máy thuộc tổ (spec 2026-10-22-may-thuoc-to §4.6–4.7).

Ca gốc LSX26-0003: phiếu chọn IN-02 (máy 4 màu) mà bước In ra đời với tổ 2 màu — tổ và máy là hai
ô độc lập. Nay tổ đi theo máy phiếu; sửa bước mà cặp lệch thì máy chủ chặn.
"""
from __future__ import annotations

import pytest

from app.models.cong_doan import CongDoan, CongDoanMay
from app.models.department import Department
from app.models.may_thiet_bi import MayThietBi, MayTo
from app.models.phieu_tinh_gia import PhieuThanhPhan, PhieuThanhPham, PhieuTinhGia
from app.models.vat_lieu_kho import GiayNguyen
from app.schemas.lsx import LsxCongDoanIn
from app.services.bai_ghep_service import BaiGhepValidationError
from app.services.lsx_service import LsxValidationError
from app.services.may_to import may_chon_duoc

from tests.test_bai_ghep_service import (  # noqa: F401
    _don_da_chuyen_sx,
    _hai_lsx_san_sang,
    admin,
    bg_svc,
    customer,
    db,
    lsx_svc,
    orders,
)

LOI_DOI = "Việc đã bắt đầu ở bàn tổ — đổi máy ở bàn tổ"


def _may(db, ma: str, *to_ids: int) -> MayThietBi:
    m = MayThietBi(ma=ma, ten=f"Máy {ma}", loai_may="press_offset_sheet", toc_do=5_000,
                   don_vi_toc_do="to_gio", kho_max_dai=1020, kho_max_rong=720, active=True)
    db.add(m)
    db.flush()
    for t in to_ids:
        db.add(MayTo(may_id=m.id, department_id=t))
    db.flush()
    return m


@pytest.fixture()
def nen(db) -> dict:
    """Công đoạn In tick [2 màu, 4 màu]; IN-01 thuộc 2 màu, IN-02 thuộc 4 màu; Bế tick [2 màu]."""
    t2 = Department(name="Nhóm thợ in máy 2 màu", code="T2M", la_san_xuat=True)
    t4 = Department(name="Nhóm thợ in máy 4 màu", code="T4M", la_san_xuat=True)
    db.add_all([t2, t4])
    db.flush()
    in01, in02 = _may(db, "IN-01", t2.id), _may(db, "IN-02", t4.id)
    cd_in = CongDoan(ma="CD-IN-MT", ten="In AB", nhom="print", department_ids=[t2.id, t4.id],
                     don_vi_vao="to", don_vi_ra="to", cong_thuc_gia="so_luong * don_gia")
    cd_be = CongDoan(ma="CD-BE-MT", ten="Bế", nhom="finishing", department_ids=[t2.id],
                     don_vi_vao="to", don_vi_ra="to", cong_thuc_gia="so_luong * don_gia")
    db.add_all([cd_in, cd_be])
    db.flush()
    db.add_all([CongDoanMay(cong_doan_id=cd_in.id, may_id=in01.id, thu_tu=0, cong_thuc_gio="sl_vao"),
                CongDoanMay(cong_doan_id=cd_in.id, may_id=in02.id, thu_tu=1, cong_thuc_gio="sl_vao")])
    db.commit()
    return {"t2": t2.id, "t4": t4.id, "in01": in01.id, "in02": in02.id,
            "cd_in": cd_in.id, "cd_be": cd_be.id}


def _ptg(db, nen, may_phieu: int | None) -> PhieuTinhGia:
    giay = GiayNguyen(don_vi_them=["to"], ma="G-MT", ten="Giấy MT", gsm=300, don_gia=25_000,
                      don_vi_gia="tan",
                      cong_thuc_gia="to_nguyen * dai_nguyen * rong_nguyen * dinh_luong * don_gia / 1000")
    db.add(giay)
    db.flush()
    p = PhieuTinhGia(ma="PTG-MT-0001", ten_san_pham="Thẻ", so_luong=500)
    tp = PhieuThanhPhan(
        thu_tu=0, ten="Thẻ", so_luong=500, don_vi_tinh="cái", dai_thanh_pham=86,
        rong_thanh_pham=54, giay_id=giay.id, kho_nguyen_dai=860, kho_nguyen_rong=650,
        kho_in_dai=860, kho_in_rong=650, so_mau_a=4, so_mau_b=1, quy_cach_in="hai_mat",
        co_in=True, may_id=may_phieu,
    )
    for i, cd_id in enumerate((nen["cd_in"], nen["cd_be"])):
        tp.thanh_phams.append(PhieuThanhPham(thu_tu=i, cong_doan_id=cd_id,
                                             ten=("In AB", "Bế")[i], don_gia=50))
    p.thanh_phans.append(tp)
    db.add(p)
    db.commit()
    return p


def _lenh(db, orders, lsx_svc, admin, customer, nen, may_phieu=None):
    d = _don_da_chuyen_sx(db, orders, admin, customer, _ptg(db, nen, may_phieu))
    line = lsx_svc.preview(d.id)["lines"][0]
    lsx = lsx_svc.tao(order_id=d.id, order_line_ids=[line["order_line_id"]], actor=admin)[0]
    return line, lsx_svc.get(lsx.id)


def _buoc_in(lsx):
    return next(c for c in lsx.cong_doans if c.ten == "In AB")


def _rows(lsx, **sua_in) -> list[LsxCongDoanIn]:
    return [
        LsxCongDoanIn(**{
            "step_key": c.step_key, "cong_doan_id": c.cong_doan_id, "ten": c.ten, "nhom": c.nhom,
            "loai_buoc": c.loai_buoc, "department_id": c.department_id, "may_id": c.may_id,
            **(sua_in if c.ten == "In AB" else {})})
        for c in sorted(lsx.cong_doans, key=lambda c: c.thu_tu)
    ]


# ------------------------------------------------------------------ tạo lệnh (§4.6)

def test_phieu_chon_may_to_khac_thi_to_di_theo_may(db, orders, lsx_svc, admin, customer, nen):
    line, lsx = _lenh(db, orders, lsx_svc, admin, customer, nen, may_phieu=nen["in02"])
    b = _buoc_in(lsx)
    assert (b.department_id, b.may_id) == (nen["t4"], nen["in02"])
    xem = next(r for r in line["routing"] if r["ten"] == "In AB")
    assert xem["department_id"] == nen["t4"], "lệnh dự kiến nói cùng tổ với lệnh tạo ra"
    assert [x for x in lsx_svc._soi_danh_muc(lsx) if x.get("may_canh_bao")] == []


def test_phieu_khong_chon_may_thi_to_mac_dinh_va_may_cua_to(
    db, orders, lsx_svc, admin, customer, nen,
):
    _, lsx = _lenh(db, orders, lsx_svc, admin, customer, nen)
    b = _buoc_in(lsx)
    assert (b.department_id, b.may_id) == (nen["t2"], nen["in01"])


def test_cong_doan_moi_to_deu_khong_co_may_thi_buoc_mac_dinh_la_to(
    db, orders, lsx_svc, admin, customer, nen,
):
    """Bế tick tổ 2 màu mà tổ đó không có máy chạy Bế ⇒ bước ra đời loại TỔ, không máy (23/10/2026)."""
    line, lsx = _lenh(db, orders, lsx_svc, admin, customer, nen)
    be = next(c for c in lsx.cong_doans if c.ten == "Bế")
    assert (be.loai_buoc, be.department_id, be.may_id) == ("to", nen["t2"], None)
    assert next(r for r in line["routing"] if r["ten"] == "Bế")["loai_buoc"] == "to", \
        "lệnh dự kiến nói cùng loại bước với lệnh tạo ra"
    assert _buoc_in(lsx).loai_buoc == "may"


def test_cong_doan_chi_con_may_ngung_dung_cung_tinh_la_khong_may(
    db, orders, lsx_svc, admin, customer, nen,
):
    for may_id in (nen["in01"], nen["in02"]):
        db.get(MayThietBi, may_id).active = False
    db.commit()
    _, lsx = _lenh(db, orders, lsx_svc, admin, customer, nen)
    assert (_buoc_in(lsx).loai_buoc, _buoc_in(lsx).may_id) == ("to", None)


def test_mac_dinh_buoc_cung_cap_voi_tao_lenh(db, orders, lsx_svc, admin, customer, nen):
    _, lsx = _lenh(db, orders, lsx_svc, admin, customer, nen, may_phieu=nen["in02"])
    md = lsx_svc.mac_dinh_buoc(lsx_id=lsx.id, cong_doan_id=nen["cd_in"])
    assert (md["department_id"], md["may_id_goi_y"]) == (nen["t4"], nen["in02"])


# ------------------------------------------------------------------ sửa bước (§4.7)

def test_doi_may_sang_may_to_khac_bi_chan(db, orders, lsx_svc, admin, customer, nen):
    _, lsx = _lenh(db, orders, lsx_svc, admin, customer, nen)
    with pytest.raises(LsxValidationError) as e:
        lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(lsx, may_id=nen["in02"]), actor=admin)
    assert str(e.value) == ("Máy IN-02 không thuộc Nhóm thợ in máy 2 màu. Chọn máy của Nhóm thợ "
                            "in máy 2 màu hoặc đổi tổ.")


def test_doi_to_kem_may_cua_to_moi_thi_luu_duoc(db, orders, lsx_svc, admin, customer, nen):
    _, lsx = _lenh(db, orders, lsx_svc, admin, customer, nen)
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, actor=admin,
                                  rows_in=_rows(lsx, department_id=nen["t4"], may_id=nen["in02"]))
    assert (_buoc_in(lsx).department_id, _buoc_in(lsx).may_id) == (nen["t4"], nen["in02"])


def test_buoc_lech_san_chi_sua_ghi_chu_van_luu_duoc(db, orders, lsx_svc, admin, customer, nen):
    _, lsx = _lenh(db, orders, lsx_svc, admin, customer, nen)
    _buoc_in(lsx).may_id = nen["in02"]          # lệch sẵn (dữ liệu cũ / danh mục đổi sau)
    db.commit()
    lsx = lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(lsx, ghi_chu="giữ"), actor=admin)
    assert _buoc_in(lsx).ghi_chu == "giữ"
    canh = [x["may_canh_bao"] for x in lsx_svc._soi_danh_muc(lsx) if x.get("may_canh_bao")]
    assert canh == ["Máy IN-02 không thuộc Nhóm thợ in máy 2 màu"]


@pytest.mark.parametrize("trang_thai", ["running", "paused", "completed"])
def test_viec_da_bat_dau_khong_doi_to_may(db, orders, lsx_svc, admin, customer, nen, trang_thai):
    from app.models.san_xuat import SanXuatCongViec, SanXuatGoiPhatHanh

    _, lsx = _lenh(db, orders, lsx_svc, admin, customer, nen)
    b = _buoc_in(lsx)
    goi = SanXuatGoiPhatHanh(ma="GOI-MT")
    db.add(goi)
    db.flush()
    db.add(SanXuatCongViec(goi_id=goi.id, lsx_id=lsx.id, lsx_cong_doan_id=b.id,
                           step_key=b.step_key, trang_thai=trang_thai))
    db.commit()
    with pytest.raises(LsxValidationError, match=LOI_DOI):
        lsx_svc.replace_routing(lsx_id=lsx.id, actor=admin,
                                rows_in=_rows(lsx, department_id=nen["t4"], may_id=nen["in02"]))
    # Sửa thứ khác thì vẫn được.
    lsx_svc.replace_routing(lsx_id=lsx.id, rows_in=_rows(lsx, ghi_chu="ok"), actor=admin)


def test_chi_tiet_lenh_bao_buoc_da_bat_dau(db, orders, lsx_svc, admin, customer, nen):
    """Ngăn bước khoá sẵn ô tổ/máy thay vì để người lập chọn rồi ăn lỗi lúc Lưu (23/10/2026)."""
    from app.models.san_xuat import SanXuatCongViec, SanXuatGoiPhatHanh

    _, lsx = _lenh(db, orders, lsx_svc, admin, customer, nen)
    b = _buoc_in(lsx)
    goi = SanXuatGoiPhatHanh(ma="GOI-BD")
    db.add(goi)
    db.flush()
    db.add(SanXuatCongViec(goi_id=goi.id, lsx_id=lsx.id, lsx_cong_doan_id=b.id,
                           step_key=b.step_key, trang_thai="running"))
    db.commit()
    co = {d["id"]: d["da_bat_dau"] for d in lsx_svc.detail_dict(lsx)["cong_doans"]}
    assert co[b.id] is True
    assert [v for k, v in co.items() if k != b.id] and not any(v for k, v in co.items() if k != b.id)


# ------------------------------------------------------------------ bài ghép (§4.6–4.7)

def _bai_hai_to(db, orders, lsx_svc, admin, customer, bg_svc):
    """Hai lệnh cùng giấy; công đoạn của bước máy đầu tick thêm tổ X; máy MX chỉ thuộc X."""
    a, b = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)
    bg = bg_svc.tao(lsx_ids=[a.id, b.id], actor=admin)
    lsx_map = bg_svc._lsx_map(bg_svc._get(bg.id))
    sa = next(cd for cd in lsx_map[a.id].cong_doans if cd.loai_buoc == "may")
    sb = next(cd for cd in lsx_map[b.id].cong_doans if cd.cong_doan_id == sa.cong_doan_id)
    x = Department(name="Tổ X", code="TX", la_san_xuat=True)
    db.add(x)
    db.flush()
    cd = db.get(CongDoan, sa.cong_doan_id)
    to_goc = cd.department_ids[0]
    cd.department_ids = [to_goc, x.id]
    mx = _may(db, "MX", x.id)
    cd.may_khai.append(CongDoanMay(may_id=mx.id, thu_tu=99))
    sa.may_id = sb.may_id = mx.id
    db.commit()
    db.expire_all()
    return bg, sa, sb, to_goc, x.id, mx.id


def test_gop_buoc_chung_lay_to_theo_may(db, orders, lsx_svc, admin, customer, bg_svc):
    bg, sa, sb, _, x, mx = _bai_hai_to(db, orders, lsx_svc, admin, customer, bg_svc)
    bg_svc.gop(bai_ghep_id=bg.id, step_keys=[sa.step_key, sb.step_key], actor=admin)
    chung = bg_svc._buoc_chungs(bg_svc._get(bg.id))[0]
    assert (chung.may_id, chung.department_id) == (mx, x)


def test_so_do_buoc_chung_gui_may_cua_cong_doan_theo_thu_tu(
        db, orders, lsx_svc, admin, customer, bg_svc):
    """Form lượt chung lọc + xếp máy như ngăn bước lệnh: chỉ máy CÒN DÙNG của công đoạn, máy "Đặt mặc
    định" đứng đầu (23/10/2026) — không còn mời máy ngoài công đoạn rồi để máy chủ chặn lúc lưu."""
    bg, sa, sb, _, _, mx = _bai_hai_to(db, orders, lsx_svc, admin, customer, bg_svc)
    bg_svc.gop(bai_ghep_id=bg.id, step_keys=[sa.step_key, sb.step_key], actor=admin)
    node = bg_svc.so_do(bg_svc._get(bg.id))["gop"][0]
    cd = db.get(CongDoan, sa.cong_doan_id)
    assert node["may_chon_duoc"] == may_chon_duoc(db, cd, None)
    assert node["may_chon_duoc"][-1] == mx   # MX khai thu_tu 99 ⇒ đứng cuối


def test_ke_hoach_buoc_chung_cap_lech_bi_chan(db, orders, lsx_svc, admin, customer, bg_svc):
    bg, sa, sb, to_goc, _, mx = _bai_hai_to(db, orders, lsx_svc, admin, customer, bg_svc)
    bg_svc.gop(bai_ghep_id=bg.id, step_keys=[sa.step_key, sb.step_key], actor=admin)
    chung = bg_svc._buoc_chungs(bg_svc._get(bg.id))[0]
    with pytest.raises(BaiGhepValidationError, match="Máy MX không thuộc"):
        bg_svc.lap_ke_hoach_buoc_chung(bai_ghep_id=bg.id, gang_step_key=chung.step_key,
                                       patch={"department_id": to_goc, "may_id": mx}, actor=admin)
