"""Lệnh sản xuất + Kế hoạch bộ phận (07/11/2026, `docs/design-lenh-san-xuat-ke-hoach-bo-phan.md`).

Luật soi ở đây:
- Bộ phận = phòng con trực tiếp của phòng gốc `la_san_xuat`; ứng viên của công đoạn xếp theo số nhóm
  được tick, bằng nhau thì bộ phận chứa tổ tick đầu.
- Phát lệnh: bước Nội bộ nằm ở bộ phận, CHƯA có tổ ⇒ không bàn tổ nào thấy.
- Bộ phận Giao ⇒ việc mang nhóm, bàn tổ thấy; Rút lại khi nhóm chưa bắt đầu.
- Đổi khỏi máy in của bài tính giá phải có lý do, có dòng nhật ký của lệnh.
"""
from __future__ import annotations

import pytest

from app.models.audit import AuditLog
from app.models.cong_doan import CongDoan, CongDoanMay
from app.models.department import Department
from app.models.lsx import LB_MAY, TT_DA_PHAT_HANH, Lsx, LsxCongDoan
from app.models.may_thiet_bi import MayThietBi, MayTo
from app.models.role import SCOPE_ALL
from app.models.san_xuat import SanXuatCongViec
from app.repositories.san_xuat_repo import SanXuatRepository
from app.services.ke_hoach_bo_phan import KeHoachBoPhanService, KhbpLoi, KhbpXungDot
from app.services.quyen_to import doc_cay
from app.services.san_xuat import release
from app.services.san_xuat.bo_phan import bo_phan_cua, nhom_cua_bo_phan, ung_vien_cua

from tests.test_san_xuat_board import (  # noqa: F401
    admin, customer, db, lsx_svc, orders,
)
from tests.test_xep_lich_service import _hai_lsx_san_sang


def _phong(db, ten: str, cha: Department | None = None, *, goc: bool = False) -> Department:
    d = Department(name=ten, code=ten.upper().replace(" ", "-")[:30],
                   parent_id=cha.id if cha else None, la_san_xuat=goc)
    db.add(d)
    db.flush()
    return d


@pytest.fixture
def cay_bp(db):
    """Gốc SX-T → bộ phận In-T (nhóm 2 màu, 4 màu) + bộ phận Bế-T (nhóm Bế T) + Bồi-T (tự làm)."""
    goc = _phong(db, "SX KHBP", goc=True)
    bp_in = _phong(db, "Tổ in KHBP", goc)
    n2 = _phong(db, "In 2 màu KHBP", bp_in)
    n4 = _phong(db, "In 4 màu KHBP", bp_in)
    bp_be = _phong(db, "Tổ bế KHBP", goc)
    be = _phong(db, "Bế T KHBP", bp_be)
    boi = _phong(db, "Tổ bồi KHBP", goc)
    m2 = MayThietBi(ma="KHBP-IN2", ten="Máy 2 màu", loai_may="Máy in")
    m4 = MayThietBi(ma="KHBP-IN4", ten="Máy 4 màu", loai_may="Máy in")
    db.add_all([m2, m4])
    db.flush()
    db.add_all([MayTo(may_id=m2.id, department_id=n2.id), MayTo(may_id=m4.id, department_id=n4.id)])
    cd = CongDoan(ma="KHBP-IN", ten="In KHBP", nhom="print")
    db.add(cd)
    db.flush()
    cd.department_ids = [n2.id, n4.id, be.id]
    cd.may_khai.append(CongDoanMay(may_id=m2.id, thu_tu=0))
    cd.may_khai.append(CongDoanMay(may_id=m4.id, thu_tu=1))
    db.commit()
    return dict(goc=goc, bp_in=bp_in, n2=n2, n4=n4, bp_be=bp_be, be=be, boi=boi,
                m2=m2, m4=m4, cd=cd)


def test_bo_phan_la_con_truc_tiep_cua_goc(db, cay_bp):
    cay = doc_cay(db)
    c = cay_bp
    assert bo_phan_cua(cay, c["n4"].id) == c["bp_in"].id
    assert bo_phan_cua(cay, c["bp_be"].id) == c["bp_be"].id
    assert bo_phan_cua(cay, c["goc"].id) is None


def test_ung_vien_theo_so_nhom_roi_theo_to_tick_dau(db, cay_bp):
    cay, c = doc_cay(db), cay_bp
    ds = ung_vien_cua(cay, [c["n2"].id, c["n4"].id, c["be"].id])
    assert [(u.id, u.so_nhom) for u in ds] == [(c["bp_in"].id, 2), (c["bp_be"].id, 1)]
    # Bằng nhau: bộ phận chứa tổ tick đầu đứng trước.
    ds = ung_vien_cua(cay, [c["be"].id, c["n2"].id])
    assert [u.id for u in ds] == [c["bp_be"].id, c["bp_in"].id]


def test_nhom_cua_bo_phan_tu_lam_la_chinh_no(db, cay_bp):
    cay, c = doc_cay(db), cay_bp
    assert nhom_cua_bo_phan(cay, c["boi"].id, []) == [c["boi"].id]
    assert nhom_cua_bo_phan(cay, c["bp_in"].id, [c["n4"].id, c["be"].id]) == [c["n4"].id]


@pytest.fixture
def lenh_phat(db, orders, lsx_svc, admin, customer, cay_bp):
    """Lệnh một bước In ở bộ phận In-T, mang máy in 2 màu của bài tính giá, đã phát hành."""
    a, _b = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)
    for cd in db.query(LsxCongDoan).filter(LsxCongDoan.lsx_id == a.id).all():
        db.delete(cd)
    db.flush()
    db.add(LsxCongDoan(
        lsx_id=a.id, thu_tu=0, ten="In KHBP", nhom="print", cong_doan_id=cay_bp["cd"].id,
        department_id=cay_bp["bp_in"].id, may_id=cay_bp["m2"].id, loai_buoc=LB_MAY,
        so_luong_vao=1000, so_luong_ra=1000, don_vi_vao="to", don_vi_ra="to",
    ))
    db.commit()
    release.phat_hanh(db, lsx_ids={a.id}, actor=admin)
    db.get(Lsx, a.id).trang_thai = TT_DA_PHAT_HANH
    db.commit()
    return a.id


def _cv(db, lsx_id) -> SanXuatCongViec:
    return db.query(SanXuatCongViec).filter(SanXuatCongViec.lsx_id == lsx_id).one()


def test_phat_lenh_viec_nam_o_bo_phan_chua_to_nao_thay(db, lenh_phat, cay_bp):
    cv = _cv(db, lenh_phat)
    assert cv.department_id is None and cv.da_giao_at is None
    assert cv.bo_phan_id == cay_bp["bp_in"].id
    assert cv.may_id == cay_bp["m2"].id
    assert SanXuatRepository(db).to_cua_lenh([lenh_phat]) == set()


def test_bang_goi_y_nhom_theo_may_roi_giao_va_rut(db, admin, lenh_phat, cay_bp):
    c = cay_bp
    svc = KeHoachBoPhanService(db, user=admin, scope=SCOPE_ALL)
    b = svc.bang(c["bp_in"].id)
    # Máy của bộ phận đã có cột riêng, không được lặp lại ở nhóm "máy ngoài".
    assert not {m["id"] for m in b["may"]} & {m["id"] for m in b["may_ngoai"]}
    v = next(x for x in b["viec"] if x["lsx_id"] == lenh_phat)
    assert v["may_goi_y_id"] == c["m2"].id
    # (Khuôn `_hai_lsx_san_sang` thêm máy của nó vào nhóm của công đoạn In đầu tiên — là công đoạn
    # của test này — nên chỉ soi hai máy của mình có mặt.)
    assert {c["m2"].id, c["m4"].id} <= set(v["may_chon"])
    assert v["nhom_chon"] == [c["n2"].id, c["n4"].id]
    assert v["nhom_xep_id"] == c["n2"].id      # máy 2 màu chỉ thuộc nhóm 2 màu

    da = svc.giao(c["bp_in"].id, [v["id"]])
    assert [x.id for x in da] == [v["id"]]
    cv = _cv(db, lenh_phat)
    assert cv.department_id == c["n2"].id and cv.da_giao_at is not None
    assert cv.da_giao_by_id == admin.id
    assert SanXuatRepository(db).to_cua_lenh([lenh_phat]) == {c["n2"].id}

    with pytest.raises(KhbpXungDot):
        svc.xep(cv.id, may_id=c["m4"].id, department_id=c["n4"].id, ly_do="x")
    svc.rut(cv.id)
    cv = _cv(db, lenh_phat)
    assert cv.department_id is None and cv.da_giao_at is None and cv.nhom_xep_id == c["n2"].id
    assert SanXuatRepository(db).to_cua_lenh([lenh_phat]) == set()


def test_doi_may_tinh_gia_phai_co_ly_do_va_ghi_nhat_ky(db, admin, lenh_phat, cay_bp):
    c = cay_bp
    svc = KeHoachBoPhanService(db, user=admin, scope=SCOPE_ALL)
    cv = _cv(db, lenh_phat)
    with pytest.raises(KhbpLoi, match="lý do"):
        svc.xep(cv.id, may_id=c["m4"].id, department_id=c["n4"].id)
    with pytest.raises(KhbpLoi, match="không thuộc nhóm"):
        svc.xep(cv.id, may_id=c["m4"].id, department_id=c["n2"].id, ly_do="Máy 2 màu hỏng")
    svc.xep(cv.id, may_id=c["m4"].id, department_id=c["n4"].id, ly_do="Máy 2 màu hỏng")
    cv = _cv(db, lenh_phat)
    assert cv.may_id == c["m4"].id and cv.nhom_xep_id == c["n4"].id and cv.department_id is None
    log = (db.query(AuditLog).filter(AuditLog.action == "kh_bo_phan_doi_may",
                                     AuditLog.target == f"lsx:{lenh_phat}").one())
    assert "Máy 2 màu hỏng" in log.detail and log.actor_user_id == admin.id
    assert "chạy KHBP-IN4" in log.detail and "thay máy tính giá KHBP-IN2" in log.detail
    # Hồ sơ lệnh, tab Lịch sử: lần đổi máy hiện kèm lý do và tên người đổi.
    from app.services.lenh_sx.ho_so import ho_so
    tl = ho_so(db, lenh_phat, sale_ids=None, chi_khoi={"timeline"})["timeline"]
    dong = [e for e in tl if e["loai"] == "ke_hoach_bo_phan"]
    assert len(dong) == 1 and "Máy 2 màu hỏng" in dong[0]["noi_dung"] and dong[0]["nguoi"]
    # Quay về máy tính giá thì không đòi lý do.
    svc.xep(cv.id, may_id=c["m2"].id, department_id=c["n2"].id)
    # Trả về khay cũng không đòi; đặt từ khay sang máy khác máy tính giá thì đòi lại.
    svc.xep(cv.id, may_id=None, department_id=None)
    with pytest.raises(KhbpLoi, match="lý do"):
        svc.xep(cv.id, may_id=c["m4"].id, department_id=c["n4"].id)


def test_thu_hoi_roi_day_lai_chi_hien_viec_cua_goi_dang_chay(db, admin, lenh_phat, cay_bp):
    """Thu hồi đánh gói `da_thu_hoi` nhưng giữ nguyên việc của nó; đẩy lại sinh gói mới và lệnh
    lại "Đã phát hành". Bảng chỉ được hiện việc của gói đang chạy — không thì một lệnh hai thẻ."""
    from app.models.san_xuat import GOI_DANG_PHAT_HANH, SanXuatGoiPhatHanh
    from app.repositories.ke_hoach_bo_phan_repo import KeHoachBoPhanRepository
    from app.services.san_xuat.release_update import thu_hoi_goi

    c = cay_bp
    goi_cu = _cv(db, lenh_phat).goi_id
    thu_hoi_goi(db, nguon="lsx", id=lenh_phat, actor=admin, ly_do="khách đổi quy cách")
    db.commit()
    # Gói đã thu hồi không còn việc chờ bộ phận nào giao (badge "lệnh mới" không được báo oan).
    assert KeHoachBoPhanRepository(db).bo_phan_cho_giao([lenh_phat]) == set()
    goi_moi = release.phat_hanh(db, lsx_ids={lenh_phat}, actor=admin).id
    db.commit()
    assert goi_moi != goi_cu
    assert db.get(SanXuatGoiPhatHanh, goi_moi).trang_thai == GOI_DANG_PHAT_HANH

    viec = [v for v in KeHoachBoPhanRepository(db).viec_cua_bo_phan(c["bp_in"].id)
            if v.lsx_id == lenh_phat]
    assert [v.goi_id for v in viec] == [goi_moi]
    svc = KeHoachBoPhanService(db, user=admin, scope=SCOPE_ALL)
    assert [x["lsx_id"] for x in svc.bang(c["bp_in"].id)["viec"]].count(lenh_phat) == 1


def test_khau_truoc_doc_tu_phu_thuoc_buoc_lenh(db, orders, lsx_svc, admin, customer, cay_bp):
    """Thứ tự bước TRONG một lệnh nằm ở `lsx_cong_doan_phu_thuoc`, không ở `san_xuat_phu_thuoc`
    (bảng ấy chỉ có cạnh giữa hai lệnh) — thẻ Bế phải nói khâu In đang chờ Tổ in xếp."""
    from app.models.lsx import LsxCongDoanPhuThuoc

    c = cay_bp
    a, _b = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)
    for cd in db.query(LsxCongDoan).filter(LsxCongDoan.lsx_id == a.id).all():
        db.delete(cd)
    db.flush()
    chung = dict(lsx_id=a.id, loai_buoc=LB_MAY, so_luong_vao=1000, so_luong_ra=1000,
                 don_vi_vao="to", don_vi_ra="to")
    b_in = LsxCongDoan(thu_tu=0, ten="In KHBP", nhom="print", cong_doan_id=c["cd"].id,
                       department_id=c["bp_in"].id, **chung)
    b_be = LsxCongDoan(thu_tu=1, ten="Bế KHBP", nhom="finishing", department_id=c["bp_be"].id,
                       **chung)
    db.add_all([b_in, b_be])
    db.flush()
    db.add(LsxCongDoanPhuThuoc(buoc_truoc_id=b_in.id, buoc_sau_id=b_be.id))
    db.commit()
    release.phat_hanh(db, lsx_ids={a.id}, actor=admin)
    db.get(Lsx, a.id).trang_thai = TT_DA_PHAT_HANH
    db.commit()

    svc = KeHoachBoPhanService(db, user=admin, scope=SCOPE_ALL)
    v = next(x for x in svc.bang(c["bp_be"].id)["viec"] if x["lsx_id"] == a.id)
    assert v["khau_truoc"]["ten"] == "In KHBP"
    assert v["khau_truoc"]["o"] == c["bp_in"].name and v["khau_truoc"]["da_giao"] is False
    v_in = next(x for x in svc.bang(c["bp_in"].id)["viec"] if x["lsx_id"] == a.id)
    assert v_in["khau_truoc"] is None


def test_pham_vi_bo_phan_cua_nguoi_xem(db, admin, cay_bp):
    c = cay_bp

    class _U:
        id = admin.id
        department_id = c["n4"].id

    svc = KeHoachBoPhanService(db, user=_U(), scope="department")
    assert svc.bo_phan_thay_duoc() == [c["bp_in"].id]


def test_buoc_mang_bo_phan_khong_soi_cap_to_may(db, lsx_svc, cay_bp):
    """Băng "danh mục đã đổi" từng báo oan "Máy X không thuộc Tổ in" vì so máy với BỘ PHẬN."""
    c = cay_bp
    assert lsx_svc._la_bo_phan(c["bp_in"].id) and lsx_svc._la_bo_phan(c["boi"].id)
    assert not lsx_svc._la_bo_phan(c["n2"].id) and not lsx_svc._la_bo_phan(c["goc"].id)
    assert not lsx_svc._la_bo_phan(None)


def test_kiem_thieu_bao_thieu_bo_phan(db, orders, lsx_svc, admin, customer):
    a, _b = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)
    buoc = db.query(LsxCongDoan).filter(LsxCongDoan.lsx_id == a.id).first()
    buoc.loai_buoc, buoc.department_id = LB_MAY, None
    db.commit()
    thieu, theo_buoc = lsx_svc.kiem_thieu(db.get(Lsx, a.id))
    assert "thieu_bo_phan" in thieu and buoc.id in theo_buoc["thieu_bo_phan"]
