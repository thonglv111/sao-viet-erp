"""Lệnh sản xuất + Kế hoạch bộ phận (07/11/2026, `docs/design-lenh-san-xuat-ke-hoach-bo-phan.md`).

Luật soi ở đây:
- Bộ phận = phòng con trực tiếp của phòng gốc `la_san_xuat`; ứng viên của công đoạn xếp theo số nhóm
  được tick, bằng nhau thì bộ phận chứa tổ tick đầu.
- Phát lệnh: bước Nội bộ nằm ở bộ phận, CHƯA có tổ ⇒ không bàn tổ nào thấy.
- Bộ phận Giao (máy + nhóm một lần) ⇒ việc mang nhóm, bàn tổ thấy; Rút lại khi nhóm chưa bắt đầu.
- Chạy khác máy theo báo giá (kể cả Làm tay) phải có lý do, có dòng nhật ký của lệnh.
- Quyền theo dòng `ke_hoach_bp_<id>` của từng bộ phận: Xem mở bảng, Giao việc mới giao/rút được.
"""
from __future__ import annotations

import pytest

from app.models.audit import AuditLog
from app.models.cong_doan import CongDoan, CongDoanMay
from app.models.department import Department
from app.models.lsx import LB_MAY, TT_DA_PHAT_HANH, Lsx, LsxCongDoan
from app.models.may_thiet_bi import MayThietBi, MayTo
from app.models.san_xuat import SanXuatCongViec
from app.repositories.san_xuat_repo import SanXuatRepository
from app.services.ke_hoach_bo_phan import (
    KeHoachBoPhanService, KhbpCam, KhbpKhongThay, KhbpLoi, KhbpXungDot,
)
from app.services.quyen_to import doc_cay
from app.services.san_xuat import release
from app.services.san_xuat.bo_phan import (
    bo_phan_cua, danh_sach_bo_phan, nhom_cua_bo_phan, ung_vien_cua,
)

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


def _svc(db, user, *, xem=None, giao=None) -> KeHoachBoPhanService:
    """Mặc định: Xem và Giao việc ở mọi bộ phận của cây."""
    ds = set(danh_sach_bo_phan(doc_cay(db)))
    return KeHoachBoPhanService(db, user=user, xem=ds if xem is None else xem,
                                giao=ds if giao is None else giao)


def test_giao_mot_lan_chon_may_va_nhom_roi_rut(db, admin, lenh_phat, cay_bp):
    c = cay_bp
    svc = _svc(db, admin)
    b = svc.bang(c["bp_in"].id)
    # Máy của bộ phận đã có cột riêng, không được lặp lại ở nhóm "máy ngoài".
    assert not {m["id"] for m in b["may"]} & {m["id"] for m in b["may_ngoai"]}
    v = next(x for x in b["viec"] if x["lsx_id"] == lenh_phat)
    assert v["may_goi_y_id"] == c["m2"].id
    # (Khuôn `_hai_lsx_san_sang` thêm máy của nó vào nhóm của công đoạn In đầu tiên — là công đoạn
    # của test này — nên chỉ soi hai máy của mình có mặt.)
    assert {c["m2"].id, c["m4"].id} <= set(v["may_chon"])
    assert v["nhom_chon"] == [c["n2"].id, c["n4"].id]
    assert v["nhom_goi_y_id"] == c["n2"].id      # máy 2 màu chỉ thuộc nhóm 2 màu
    assert v["trang_thai_kh"] == "chua_giao"

    # Không truyền nhóm: máy 2 màu chỉ thuộc một nhóm nên tự lấy nhóm đó.
    svc.giao(v["id"], may_id=c["m2"].id, department_id=None)
    cv = _cv(db, lenh_phat)
    assert cv.department_id == c["n2"].id and cv.da_giao_at is not None
    assert cv.da_giao_by_id == admin.id and cv.may_id == c["m2"].id
    assert SanXuatRepository(db).to_cua_lenh([lenh_phat]) == {c["n2"].id}
    v = next(x for x in svc.bang(c["bp_in"].id)["viec"] if x["id"] == cv.id)
    assert v["trang_thai_kh"] == "da_giao" and v["department_ten"] == c["n2"].name

    with pytest.raises(KhbpXungDot):
        svc.giao(cv.id, may_id=c["m4"].id, department_id=c["n4"].id, ly_do="x")
    svc.rut(cv.id)
    cv = _cv(db, lenh_phat)
    assert cv.department_id is None and cv.da_giao_at is None and cv.nhom_xep_id == c["n2"].id
    assert SanXuatRepository(db).to_cua_lenh([lenh_phat]) == set()
    with pytest.raises(KhbpXungDot):
        svc.rut(cv.id)


def test_bang_viec_dem_chip_tim_ky_va_cat_trang_o_may_chu(db, admin, lenh_phat, cay_bp):
    """Bảng việc (mockup phương án B): số trên năm chip, tìm, kỳ theo lúc việc tới, lọc máy / nhóm,
    cắt trang — đều ở máy chủ; dòng có "Tới" (lúc việc tới bộ phận)."""
    from datetime import date, timedelta

    c = cay_bp
    bp = c["bp_in"].id
    svc = _svc(db, admin)
    ma = db.get(Lsx, lenh_phat).ma
    r = svc.trang_viec(bp, trang_thai="chua_giao")
    assert r["tong"] == 1 and r["dem"]["chua_giao"] == 1 and r["dem"]["da_giao"] == 0
    assert r["items"][0]["lsx_ma"] == ma and r["items"][0]["toi_luc"]
    assert svc.trang_viec(bp, trang_thai="chua_giao", tim=ma[-4:])["tong"] == 1
    assert svc.trang_viec(bp, trang_thai="chua_giao", tim="khong-co-dau")["tong"] == 0
    mai = date.today() + timedelta(days=1)
    assert svc.trang_viec(bp, trang_thai="chua_giao", tu_ngay=mai)["dem"]["chua_giao"] == 0
    assert svc.trang_viec(bp, trang_thai="chua_giao", co_trang=1, trang=2)["items"] == []

    v = r["items"][0]
    svc.giao(v["id"], may_id=c["m2"].id, department_id=None)
    r = svc.trang_viec(bp, trang_thai="da_giao")
    assert r["dem"]["chua_giao"] == 0 and r["dem"]["da_giao"] == 1 and r["tong"] == 1
    assert svc.trang_viec(bp, trang_thai="da_giao", may_id=c["m4"].id)["tong"] == 0
    assert svc.trang_viec(bp, trang_thai="da_giao", nhom_id=c["n2"].id)["tong"] == 1
    # Chip Tất cả: mọi trạng thái; máy kèm số việc chờ để chọn máy ngay trên dòng.
    tc = svc.trang_viec(bp, trang_thai="tat_ca")
    assert tc["tong"] == tc["dem"]["tat_ca"] == sum(tc["dem"][k] for k in tc["dem"] if k != "tat_ca")
    assert {m["id"]: m.get("so_cho") for m in tc["may"]}[c["m2"].id] == 1
    assert tc["nhom"]
    with pytest.raises(KhbpLoi):
        svc.trang_viec(bp, trang_thai="la")



def test_thu_hoi_roi_phat_hanh_lai_moi_viec_chi_hien_mot_lan(db, admin, lenh_phat, cay_bp):
    """Thu hồi giữ việc của gói cũ (gói `da_thu_hoi`); phát hành lại không được hiện việc hai lần."""
    from app.services.san_xuat.release_update import thu_hoi_goi

    bp = cay_bp["bp_in"].id
    thu_hoi_goi(db, nguon="lsx", id=lenh_phat, actor=admin, ly_do="thử lại")
    db.commit()
    release.phat_hanh(db, lsx_ids={lenh_phat}, actor=admin)
    db.get(Lsx, lenh_phat).trang_thai = TT_DA_PHAT_HANH
    db.commit()
    svc = _svc(db, admin)
    assert svc.trang_viec(bp, trang_thai="tat_ca")["tong"] == 1
    assert len([v for v in svc.bang(bp)["viec"] if v["lsx_id"] == lenh_phat]) == 1

def test_chay_khac_may_theo_bao_gia_phai_co_ly_do_va_ghi_nhat_ky(db, admin, lenh_phat, cay_bp):
    c = cay_bp
    svc = _svc(db, admin)
    cv = _cv(db, lenh_phat)
    with pytest.raises(KhbpLoi, match="lý do"):
        svc.giao(cv.id, may_id=c["m4"].id, department_id=c["n4"].id)
    with pytest.raises(KhbpLoi, match="không thuộc nhóm"):
        svc.giao(cv.id, may_id=c["m4"].id, department_id=c["n2"].id, ly_do="Máy 2 màu hỏng")
    # Làm tay cũng là chạy khác máy theo báo giá.
    with pytest.raises(KhbpLoi, match="lý do"):
        svc.giao(cv.id, may_id=None, department_id=c["n2"].id)
    svc.giao(cv.id, may_id=c["m4"].id, department_id=c["n4"].id, ly_do="Máy 2 màu hỏng")
    cv = _cv(db, lenh_phat)
    assert cv.may_id == c["m4"].id and cv.department_id == c["n4"].id
    log = (db.query(AuditLog).filter(AuditLog.action == "kh_bo_phan_doi_may",
                                     AuditLog.target == f"lsx:{lenh_phat}").one())
    assert "Máy 2 màu hỏng" in log.detail and log.actor_user_id == admin.id
    assert "chạy Máy 4 màu" in log.detail and "thay máy theo báo giá Máy 2 màu" in log.detail
    # Hồ sơ lệnh, tab Lịch sử: lần đổi máy hiện kèm lý do và tên người đổi.
    from app.services.lenh_sx.ho_so import ho_so
    tl = ho_so(db, lenh_phat, sale_ids=None, chi_khoi={"timeline"})["timeline"]
    dong = [e for e in tl if e["loai"] == "ke_hoach_bo_phan" and "Máy 2 màu hỏng" in e["noi_dung"]]
    assert len(dong) == 1 and dong[0]["nguoi"]
    # Rút về rồi giao đúng máy theo báo giá thì không đòi lý do.
    svc.rut(cv.id)
    svc.giao(cv.id, may_id=c["m2"].id, department_id=c["n2"].id)
    assert db.query(AuditLog).filter(AuditLog.action == "kh_bo_phan_doi_may").count() == 1


def test_chi_xem_khong_giao_duoc_va_ngoai_bo_phan_khong_thay(db, admin, lenh_phat, cay_bp):
    c = cay_bp
    cv = _cv(db, lenh_phat)
    xem = _svc(db, admin, xem={c["bp_in"].id}, giao=set())
    assert [b["id"] for b in xem.danh_sach()] == [c["bp_in"].id]
    assert xem.danh_sach()[0]["giao_duoc"] is False
    assert xem.bang(c["bp_in"].id)["bo_phan"]["giao_duoc"] is False
    with pytest.raises(KhbpCam):
        xem.giao(cv.id, may_id=c["m2"].id, department_id=c["n2"].id)
    khac = _svc(db, admin, xem={c["bp_be"].id})
    with pytest.raises(KhbpKhongThay):
        khac.bang(c["bp_in"].id)
    with pytest.raises(KhbpKhongThay):
        khac.chi_tiet(cv.id, None)


def test_trang_thai_ke_hoach_ghep_tu_giao_va_trang_thai_to():
    from types import SimpleNamespace as N

    from app.models.san_xuat import CV_DANG_CHAY, CV_HOAN_THANH, CV_PHAT_HANH, CV_TAM_DUNG
    from app.services.ke_hoach_bo_phan import trang_thai_ke_hoach as tt

    assert tt(N(da_giao_at=None, trang_thai=CV_PHAT_HANH)) == "chua_giao"
    assert tt(N(da_giao_at=1, trang_thai=CV_PHAT_HANH)) == "da_giao"
    assert tt(N(da_giao_at=1, trang_thai=CV_DANG_CHAY)) == "dang_chay"
    assert tt(N(da_giao_at=1, trang_thai=CV_TAM_DUNG)) == "tam_dung"
    # Việc làm xong trước khi có bước Giao (dữ liệu cũ) vẫn là Hoàn thành.
    assert tt(N(da_giao_at=None, trang_thai=CV_HOAN_THANH)) == "hoan_thanh"


def test_dong_quyen_ke_hoach_sinh_theo_cay(db, cay_bp):
    from app.models.module import Module
    from app.services.quyen_ke_hoach import dong_bo_dong_quyen_ke_hoach, khoa_ke_hoach

    c = cay_bp
    dong_bo_dong_quyen_ke_hoach(db)
    nhan = {m.key: m.label for m in db.query(Module).filter(Module.key.like("ke_hoach_bp_%"))}
    assert nhan[khoa_ke_hoach(c["bp_in"].id)] == "Kế hoạch Tổ in KHBP"
    assert khoa_ke_hoach(c["boi"].id) in nhan
    assert khoa_ke_hoach(c["n2"].id) not in nhan and khoa_ke_hoach(c["goc"].id) not in nhan
    # Đổi tên bộ phận ⇒ đổi nhãn; bộ phận chuyển xuống làm nhóm ⇒ gỡ dòng.
    c["bp_in"].name = "Tổ in mới KHBP"
    c["boi"].parent_id = c["bp_in"].id
    db.commit()
    dong_bo_dong_quyen_ke_hoach(db)
    nhan = {m.key: m.label for m in db.query(Module).filter(Module.key.like("ke_hoach_bp_%"))}
    assert nhan[khoa_ke_hoach(c["bp_in"].id)] == "Kế hoạch Tổ in mới KHBP"
    assert khoa_ke_hoach(c["boi"].id) not in nhan


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


def test_su_kien_biet_to_chi_toi_ke_hoach_bo_phan_chua_to(db, cay_bp):
    """Ghi sản lượng ở nhóm In 2 màu: người kế hoạch Tổ in nghe, người kế hoạch Tổ bế thì không;
    không rõ tổ thì vẫn tới mọi người kế hoạch (khoá giả `ke_hoach_bp`)."""
    from app.doi_tuong_nhan import MAN_THEO_LENH, kem_ban_to
    from app.services.quyen_ke_hoach import NGHE_KE_HOACH, khoa_ke_hoach

    q = kem_ban_to(MAN_THEO_LENH, [cay_bp["n2"].id])["quyen"]
    assert khoa_ke_hoach(cay_bp["bp_in"].id) in q
    assert khoa_ke_hoach(cay_bp["bp_be"].id) not in q
    assert NGHE_KE_HOACH not in q
    assert "san_xuat" in q
    assert NGHE_KE_HOACH in kem_ban_to(MAN_THEO_LENH, [None])["quyen"]


def test_phat_hanh_thu_hoi_chi_bao_to_va_bo_phan_cua_goi(db, lenh_phat, cay_bp, monkeypatch):
    """Phát hành / cập nhật / thu hồi: `lsx_changed` tới bàn của đúng tổ cầm việc của gói (trước
    HOẶC sau lần đổi) và Kế hoạch của đúng bộ phận đó, không tới mọi bàn tổ, mọi bộ phận."""
    from app.doi_tuong_nhan import BAN_TO
    from app.routers import xep_lich as r
    from app.services.quyen_ke_hoach import NGHE_KE_HOACH, khoa_ke_hoach

    c = cay_bp
    gui: list = []
    monkeypatch.setattr(r.hub, "gui", lambda ev, **kw: gui.append((ev, kw)))

    def lan_cuoi():
        return [kw for ev, kw in gui if ev["type"] == "lsx_changed"][-1]

    # Việc còn ở khay bộ phận: không bàn tổ nào, chỉ Kế hoạch Tổ in.
    r._phat_goi_xuong_xuong(db, lenh_phat, r._noi_goi(db, lenh_phat))
    kw = lan_cuoi()
    assert kw["to"] == []
    assert khoa_ke_hoach(c["bp_in"].id) in kw["quyen"]
    assert khoa_ke_hoach(c["bp_be"].id) not in kw["quyen"]
    assert NGHE_KE_HOACH not in kw["quyen"] and BAN_TO not in kw["quyen"]
    lich = [kw for ev, kw in gui if ev["type"] == "xep_lich_changed"][-1]
    assert NGHE_KE_HOACH not in lich["quyen"] and "xep_lich" in lich["quyen"]

    # Đã giao nhóm 2 màu; sau lần đổi gói không còn chỉ ra tổ nào (như thu hồi) — ảnh chụp TRƯỚC
    # vẫn đưa tin tới bàn nhóm đó.
    cv = _cv(db, lenh_phat)
    cv.department_id = c["n2"].id
    db.commit()
    truoc = r._noi_goi(db, lenh_phat)
    cv.department_id = None
    db.commit()
    gui.clear()
    r._phat_goi_xuong_xuong(db, lenh_phat, truoc)
    assert lan_cuoi()["to"] == [c["n2"].id]


def test_de_nghi_vat_tu_viec_chua_giao_khong_bao_moi_ban_to(db, lenh_phat, cay_bp, monkeypatch):
    """Phát hành tự lập đề nghị cấp vật tư cho việc còn ở khay bộ phận: việc đó chưa nằm trên bàn
    tổ nào nên không gửi `ban_to` (mọi bàn tổ). Đã giao thì gửi đúng bàn tổ cầm việc."""
    from app.services.san_xuat import vat_tu_de_nghi as m

    gui: list = []
    monkeypatch.setattr(m.hub, "gui", lambda ev, **kw: gui.append((ev, kw)))
    cv = _cv(db, lenh_phat)
    assert cv.department_id is None and cv.bo_phan_id is not None
    m._bao_de_nghi_doi(cv)
    assert gui == []

    cv.department_id = cay_bp["n2"].id
    m._bao_de_nghi_doi(cv)
    assert gui[-1][1]["to"] == [cay_bp["n2"].id]


def test_kem_ban_to_viec_chua_giao_chi_bao_ke_hoach_bo_phan(db, cay_bp):
    """Việc chưa giao ⇒ không `ban_to`, không khoá giả `ke_hoach_bp`, chỉ Kế hoạch bộ phận giữ việc.
    Lẫn việc đã giao ⇒ thêm đúng tổ. Việc gia công (không tổ, không bộ phận) ⇒ vẫn gửi rộng."""
    from app.doi_tuong_nhan import BAN_TO, MAN_THEO_LENH, kem_ban_to_viec
    from app.services.quyen_ke_hoach import NGHE_KE_HOACH, khoa_ke_hoach

    c = cay_bp
    kw = kem_ban_to_viec(MAN_THEO_LENH, [(None, c["bp_in"].id)])
    assert kw["to"] == []
    assert khoa_ke_hoach(c["bp_in"].id) in kw["quyen"]
    assert khoa_ke_hoach(c["bp_be"].id) not in kw["quyen"]
    assert BAN_TO not in kw["quyen"] and NGHE_KE_HOACH not in kw["quyen"]

    kw = kem_ban_to_viec(MAN_THEO_LENH, [(None, c["bp_be"].id), (c["n2"].id, c["bp_in"].id)])
    assert kw["to"] == [c["n2"].id]
    assert {khoa_ke_hoach(c["bp_in"].id), khoa_ke_hoach(c["bp_be"].id)} <= set(kw["quyen"])
    assert BAN_TO not in kw["quyen"] and NGHE_KE_HOACH not in kw["quyen"]

    kw = kem_ban_to_viec(MAN_THEO_LENH, [(None, None)])
    assert BAN_TO in kw["quyen"] and NGHE_KE_HOACH in kw["quyen"]


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
    assert [x["lsx_id"] for x in _svc(db, admin).bang(c["bp_in"].id)["viec"]].count(lenh_phat) == 1


def test_tick_nhom_o_danh_muc_dien_bo_phan_cho_buoc_lenh_trong(db, orders, lsx_svc, admin, customer, cay_bp):
    """Lệnh bung lúc công đoạn chưa tick nhóm ⇒ bước trống bộ phận nhận. Tick nhóm ở danh mục rồi
    lưu thì bước của lệnh chưa lập kế hoạch nhận ngay bộ phận, hết "Còn thiếu" (10/11/2026)."""
    from app.repositories.cong_doan_repo import CongDoanRepository
    from app.models.cong_doan import PRICING_BASIS
    from app.services.cong_doan_service import CongDoanService

    a, _b = _hai_lsx_san_sang(db, orders, lsx_svc, admin, customer)
    buoc = db.query(LsxCongDoan).filter(LsxCongDoan.lsx_id == a.id,
                                        LsxCongDoan.cong_doan_id.isnot(None)).first()
    buoc.loai_buoc, buoc.department_id = LB_MAY, None
    cd = db.get(CongDoan, buoc.cong_doan_id)
    cd.department_ids = []
    db.commit()
    assert "thieu_bo_phan" in lsx_svc.kiem_thieu(db.get(Lsx, a.id))[0]

    CongDoanService(CongDoanRepository(db)).update(
        cd.id, {"ma": cd.ma, "ten": cd.ten, "nhom": cd.nhom, "che_do_tinh": cd.che_do_tinh,
                "pricing_basis": cd.pricing_basis or PRICING_BASIS[0], "department_ids": [cay_bp["be"].id]})
    db.refresh(buoc)
    assert buoc.department_id == cay_bp["bp_be"].id
    assert "thieu_bo_phan" not in lsx_svc.kiem_thieu(db.get(Lsx, a.id))[0]
