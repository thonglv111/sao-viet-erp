from app.models.don_vi_do import TRAM_TO, TRAM_TO_NGUYEN
from app.services.kho_giay import dong_giay_theo_dau_vao

QC = {"kho_nguyen_dai": 1090, "kho_nguyen_rong": 790, "kho_in_dai": 790, "kho_in_rong": 545,
      "so_manh_xa": 2}


def test_buoc_in_nhan_to_in_lay_kho_in():
    d = dong_giay_theo_dau_vao(don_vi_vao=TRAM_TO, so_luong_vao=10520, so_luong_ra=10400,
                               quy_cach=QC, gsm=250)
    assert "dang" not in d     # giấy bỏ dạng cuộn/tờ (10/10/2026): chỉ còn khổ + đơn vị
    assert (d["so_luong"], d["kho_rong"], d["kho_dai"], d["don_vi"]) == (10520, 545, 790, TRAM_TO)


def test_buoc_cat_to_nhan_to_nguyen_lay_kho_nguyen():
    d = dong_giay_theo_dau_vao(don_vi_vao=TRAM_TO_NGUYEN, so_luong_vao=5260, so_luong_ra=10520,
                               quy_cach=QC, gsm=250)
    assert (d["so_luong"], d["kho_rong"], d["kho_dai"]) == (5260, 790, 1090)


def test_in_thang_kho_nguyen_khi_kho_in_trong():
    qc = {**QC, "kho_in_dai": 0, "kho_in_rong": 0}
    d = dong_giay_theo_dau_vao(don_vi_vao=TRAM_TO, so_luong_vao=100, so_luong_ra=100,
                               quy_cach=qc, gsm=250)
    assert (d["kho_rong"], d["kho_dai"]) == (790, 1090)


def test_buoc_nhan_cuon_tinh_kg_tu_to_nguyen_ra():
    d = dong_giay_theo_dau_vao(don_vi_vao="cuon", so_luong_vao=1, so_luong_ra=1370,
                               quy_cach=QC, gsm=150)
    assert d["don_vi"] == "kg"
    assert round(d["so_luong"], 3) == 176.956
    assert (d["kho_rong"], d["kho_dai"]) == (790, 0)


def test_buoc_dau_vao_trong_tinh_kg_theo_sl_ra_va_kho_to_ra():
    """18/10/2026: đầu vào "—" (cắt từ cuộn) ⇒ kg = gsm × khổ tờ RA × SL ra, không hiện khổ."""
    for dv in (None, ""):
        d = dong_giay_theo_dau_vao(don_vi_vao=dv, so_luong_vao=0, so_luong_ra=1000,
                                   quy_cach=QC, gsm=250)
        assert d["don_vi"] == "kg" and d["hien_kho"] is False
        assert d["so_luong"] == pytest.approx(1000 * 0.79 * 1.09 * 0.25)
    # Bước kế tiếp nhận tờ IN ⇒ SL ra đếm tờ in, khổ tờ in.
    d = dong_giay_theo_dau_vao(don_vi_vao=None, so_luong_vao=0, so_luong_ra=1000,
                               quy_cach=QC, gsm=250, tram_ra=TRAM_TO)
    assert d["so_luong"] == pytest.approx(1000 * 0.545 * 0.79 * 0.25)
    assert (d["kho_rong"], d["kho_dai"]) == (545, 0)


def test_buoc_nhan_cai_con_tinh_kg_theo_kho_thanh_pham():
    qc = {**QC, "dai_thanh_pham": 90, "rong_thanh_pham": 54}
    for dv in ("cai", "con"):
        d = dong_giay_theo_dau_vao(don_vi_vao=dv, so_luong_vao=5000, so_luong_ra=0,
                                   quy_cach=qc, gsm=300)
        assert d["don_vi"] == "kg" and d["hien_kho"] is True
        assert (d["kho_rong"], d["kho_dai"]) == (54, 90)
        assert d["so_luong"] == pytest.approx(5000 * 0.054 * 0.09 * 0.3)
    d = dong_giay_theo_dau_vao(don_vi_vao="tay", so_luong_vao=100, so_luong_ra=0,
                               quy_cach=qc, gsm=300)
    assert (d["kho_rong"], d["kho_dai"]) == (545, 790)
    # Thiếu khổ thành phẩm ⇒ không đoán.
    d = dong_giay_theo_dau_vao(don_vi_vao="cai", so_luong_vao=10, so_luong_ra=0,
                               quy_cach=QC, gsm=300)
    assert d["so_luong"] is None and "khổ thành phẩm" in d["ly_do"]


def test_thieu_kho_thi_khong_doan():
    d = dong_giay_theo_dau_vao(don_vi_vao=TRAM_TO_NGUYEN, so_luong_vao=10, so_luong_ra=10,
                               quy_cach={}, gsm=250)
    assert d["so_luong"] is None and d["ly_do"]


# ---- tầng service: dòng giấy thật trên lệnh thật --------------------------------------------
import pytest

from app.models.cong_doan import CongDoan
from app.models.don_vi_do import DonViDo, DonViQuyDoi
from app.models.lsx import Lsx, LsxCongDoan, LsxCongDoanVatTu
from app.repositories.lsx_repo import LsxRepository
from app.services.lsx_service import LsxService
from tests.conftest import phien_da_seed
from tests.test_ke_hoach_vat_tu import _don, _giay, _may


@pytest.fixture
def db():
    yield from phien_da_seed()


def _svc(db) -> LsxService:
    return LsxService(db, LsxRepository(db), None, None)


def _lenh(db, customer, giay, *, qc=None):
    o = _don(db, customer)
    l = Lsx(ma="L-DG", ten="L-DG", order_id=o.id, order_line_id=o._line.id, so_luong_dat=10_000,
            so_to_nguyen=0, so_con=1, quy_cach_json={"giay_id": giay.id, **(qc or QC)})
    db.add(l)
    db.flush()
    return l


def _buoc(db, lsx, thu_tu, ten, vao, ra, giay, *, cd_vao=None):
    cd = CongDoan(ma=f"CD-DG-{thu_tu}", ten=ten, nhom="print", don_vi_vao=vao, don_vi_ra=ra)
    db.add(cd)
    db.flush()
    b = LsxCongDoan(lsx_id=lsx.id, thu_tu=thu_tu, ten=ten, loai_buoc="may", may_id=_may(db).id,
                    cong_doan_id=cd.id, don_vi_vao=vao, don_vi_ra=ra, so_luong_vao=0, so_luong_ra=0)
    db.add(b)
    db.flush()
    # SỐ RÁC + khổ rác: máy phải ghi đè hết.
    db.add(LsxCongDoanVatTu(lsx_cong_doan_id=b.id, hang_loai="giay", vat_tu_id=giay.id,
                            vat_tu_ma_snapshot=giay.ma, vat_tu_ten_snapshot=giay.ten,
                            don_vi_snapshot="rac", so_luong=1, kho_rong=1, kho_dai=2, thu_tu=0))
    db.flush()
    return b


def _dong_giay(b):
    d = next(v for v in b.vat_tus if v.hang_loai == "giay")
    return (d.don_vi_goc, float(d.so_luong), d.kho_rong, d.kho_dai, d.don_vi_snapshot)


def test_dong_giay_buoc_cat_va_buoc_in_theo_dau_vao(db):
    from app.models.customer import Customer
    c = Customer(code="KH-DG", name="Khách DG")
    db.add(c)
    db.commit()
    g = _giay(db, ma="C250", gsm=250)
    lsx = _lenh(db, c, g)
    cat = _buoc(db, lsx, 1, "Cắt tờ", TRAM_TO_NGUYEN, TRAM_TO, g)
    in_ = _buoc(db, lsx, 2, "In", TRAM_TO, TRAM_TO, g)
    db.refresh(lsx)
    _svc(db)._ap_chuoi_nguoc(lsx)
    assert float(cat.so_luong_vao) > 0 and float(in_.so_luong_vao) > 0
    assert _dong_giay(cat) == ("to", float(cat.so_luong_vao), 790, 1090, TRAM_TO_NGUYEN)
    assert _dong_giay(in_) == ("to", float(in_.so_luong_vao), 545, 790, TRAM_TO)


def _cuon(db, don_vi_gia, *, quy_doi=True):
    from app.models.customer import Customer
    c = Customer(code=f"KH-{don_vi_gia}", name="Khách cuộn")
    db.add(c)
    db.commit()
    g = _giay(db, ma=f"CU-{don_vi_gia}", gsm=150, don_vi=don_vi_gia)
    lsx = _lenh(db, c, g)
    b = _buoc(db, lsx, 1, "Cắt cuộn", "cuon", TRAM_TO_NGUYEN, g)
    b.so_luong_vao, b.so_luong_ra = 1, 1370
    db.refresh(lsx)
    return lsx, b


def test_buoc_nhan_cuon_don_vi_kg(db):
    lsx, b = _cuon(db, "kg")
    _svc(db)._dong_bo_dong_giay(lsx)
    goc, sl, kr, kd, dv = _dong_giay(b)
    # Nhánh khổ rộng: đơn vị gốc = đơn vị giá của mã (kg), khổ chỉ-rộng.
    assert (goc, kr, kd, dv) == ("kg", 790, 0, "kg")
    assert round(sl, 3) == 176.956


def test_buoc_dau_vao_trong_lay_sl_ra_tu_buoc_ke_tiep(db):
    """Cắt cuộn ("—") → Cắt tờ (tờ nguyên → tờ in) → In: dòng giấy ở Cắt cuộn = kg của số tờ
    nguyên mà Cắt tờ nhận (chuỗi bù hao ngược), khổ nguyên."""
    from app.models.customer import Customer
    c = Customer(code="KH-CC", name="Khách cuộn")
    db.add(c)
    db.commit()
    g = _giay(db, ma="CC250", gsm=250, don_vi="kg")
    lsx = _lenh(db, c, g)
    cuon = _buoc(db, lsx, 1, "Cắt cuộn", None, None, g)
    cat = _buoc(db, lsx, 2, "Cắt tờ", TRAM_TO_NGUYEN, TRAM_TO, g)
    _buoc(db, lsx, 3, "In", TRAM_TO, TRAM_TO, g)
    db.refresh(lsx)
    _svc(db)._ap_chuoi_nguoc(lsx)
    assert float(cat.so_luong_vao) > 0
    goc, sl, kr, kd, dv = _dong_giay(cuon)
    assert (goc, kr, kd, dv) == ("kg", 790, 0, "kg")
    assert sl == pytest.approx(float(cat.so_luong_vao) * 0.79 * 1.09 * 0.25, rel=1e-6)


def test_buoc_nhan_cuon_don_vi_tan_co_cap_quy_doi(db):
    # Danh mục seed đã có cặp 1 tấn = 1.000 kg; chỉ khẳng định lại để test không dựa vào may rủi.
    tan = db.query(DonViDo).filter(DonViDo.ma == "tan").one()
    kg = db.query(DonViDo).filter(DonViDo.ma == "kg").one()
    cap = db.query(DonViQuyDoi).filter(DonViQuyDoi.tu_id == tan.id, DonViQuyDoi.den_id == kg.id).one()
    assert float(cap.he_so) == 1000
    lsx, b = _cuon(db, "tan")
    _svc(db)._dong_bo_dong_giay(lsx)
    goc, sl, kr, kd, dv = _dong_giay(b)
    assert (goc, dv) == ("tan", "tan")
    assert round(sl, 6) == 0.176956


def test_buoc_nhan_cuon_thieu_cap_quy_doi_khong_raise(db):
    db.query(DonViQuyDoi).delete()
    db.commit()
    lsx, b = _cuon(db, "tan")
    _svc(db)._dong_bo_dong_giay(lsx)
    # Không đổi được ⇒ giữ NGUYÊN giá trị đã lưu (số rác ban đầu 1), không ghi 0.
    assert _dong_giay(b)[:2] == ("", 1.0)


def test_buoc_khong_tinh_duoc_giu_nguyen_dong_giay_da_luu(db):
    from app.models.customer import Customer
    c = Customer(code="KH-GN", name="Khách giữ")
    db.add(c)
    db.commit()
    g = _giay(db, ma="C250G", gsm=250)
    lsx = _lenh(db, c, g)
    b = _buoc(db, lsx, 1, "Dán", "cai", "cai", g)
    v = b.vat_tus[0]
    v.so_luong, v.kho_rong, v.kho_dai, v.don_vi_snapshot, v.don_vi_goc = 123, 790, 1090, "to_nguyen", "to"
    b.so_luong_vao = 50
    db.refresh(lsx)
    _svc(db)._dong_bo_dong_giay(lsx)
    assert _dong_giay(b) == ("to", 123.0, 790, 1090, "to_nguyen")


def _lenh_giay_chi_can(db, ma, don_vi_gia, *, gsm=250):
    """Giấy tờ mà mã CHỈ khai nhóm cân (không khai tờ) — chuỗi Cắt tờ → In."""
    from app.models.customer import Customer
    c = Customer(code=f"KH-{ma}", name="Khách giấy cân")
    db.add(c)
    db.commit()
    g = _giay(db, ma=ma, gsm=gsm, don_vi=don_vi_gia)
    g.don_vi_them = []
    db.commit()
    lsx = _lenh(db, c, g)
    cat = _buoc(db, lsx, 1, "Cắt tờ", TRAM_TO_NGUYEN, TRAM_TO, g)
    in_ = _buoc(db, lsx, 2, "In", TRAM_TO, TRAM_TO, g)
    db.refresh(lsx)
    return lsx, cat, in_


def test_giay_chi_khai_kg_dong_giay_quy_to_ra_kg_giu_kho_hai_canh(db):
    """16/10/2026: mã giấy mua theo kg, không khai tờ ⇒ lệnh vẫn đếm tờ nhưng dòng giấy (thứ kho và
    kế hoạch vật tư đọc) quy ra kg theo khổ của dòng × gsm, khổ giữ đủ hai cạnh."""
    lsx, cat, in_ = _lenh_giay_chi_can(db, "IV-KG", "kg")
    _svc(db)._ap_chuoi_nguoc(lsx)
    goc, sl, kr, kd, dv = _dong_giay(cat)
    assert (goc, kr, kd, dv) == ("kg", 790, 1090, "kg")
    assert sl == pytest.approx(float(cat.so_luong_vao) * 0.79 * 1.09 * 0.25, rel=1e-6)
    goc, sl, kr, kd, dv = _dong_giay(in_)
    assert (goc, kr, kd, dv) == ("kg", 545, 790, "kg")
    assert sl == pytest.approx(float(in_.so_luong_vao) * 0.545 * 0.79 * 0.25, rel=1e-6)


def test_giay_chi_khai_tan_dong_giay_ra_tan(db):
    lsx, cat, _in = _lenh_giay_chi_can(db, "IV-TAN", "tan")
    _svc(db)._ap_chuoi_nguoc(lsx)
    goc, sl, kr, kd, dv = _dong_giay(cat)
    assert (goc, dv) == ("tan", "tan")
    assert sl == pytest.approx(float(cat.so_luong_vao) * 0.79 * 1.09 * 0.25 / 1000, rel=1e-6)


def test_giay_chi_khai_kg_thieu_gsm_giu_nguyen_dong_da_luu(db):
    lsx, cat, _in = _lenh_giay_chi_can(db, "IV-0", "kg", gsm=0)
    _svc(db)._dong_bo_dong_giay(lsx)
    assert _dong_giay(cat)[1] == 1.0     # số rác ban đầu, không ghi đè bằng số tờ đội lốt kg
