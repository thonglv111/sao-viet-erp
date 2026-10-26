"""Kế hoạch vật tư — bảng cân đối. Test SỐ HỌC, không qua HTTP.

Trọng tâm là mấy chỗ mà sai thì KHÔNG AI BÁO, chỉ có hệ quả ngoài đời (mua thừa một lô giấy, hoặc
lệnh đứng máy vì tưởng còn đủ):

* hai **bẫy đếm hai lần** — đã cấp không được trừ vào tồn lần nữa; hàng đang về chỉ cộng một lần;
* *đang lĩnh* chỉ là nhãn;
* bài ghép KHÔNG đếm đôi giấy;
* thiếu đường quy đổi → báo `khong_doi_chieu_duoc`, không đoán;
* dòng mua không gắn mặt hàng → không trừ;
* giấy nguồn khách → không sinh dòng;
* NGÀY CẦN chỉ đọc từ yêu cầu mua đã lập cho lệnh — chưa mua gì thì TRỐNG, không suy;
* thứ tự ăn tồn = hạn sản xuất.

Dựng dữ liệu THẲNG vào DB (Order/OrderLine tối thiểu để thoả FK) thay vì chạy cả luồng
đơn → chuyển SX → tạo lệnh: cái đang kiểm là phép cộng trừ của bảng cân đối, không phải luồng bán.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from tests.conftest import phien_da_seed

from app.db import SessionLocal, engine
from app.models.bai_ghep import BaiGhep, BaiGhepThanhVien
from app.models.customer import Customer
from app.models.lsx import TT_CHO_BO_SUNG, TT_NHAP, TT_SAN_SANG, Lsx, LsxCongDoan
from app.models.may_thiet_bi import MayThietBi
from app.models.order import Order, OrderLine
from app.models.purchase import (
    DPR_CANCELLED,
    DPR_OPEN,
    DPR_PENDING_APPROVAL,
    PR_PENDING,
    PR_PURCHASED,
    SOURCE_SAN_XUAT,
    DepartmentPurchaseRequest,
    DepartmentPurchaseRequestLine,
    PurchaseRequest,
    PurchaseRequestLine,
    Supplier,
    SupplierItem,
    YeuCauMuaNguonLenh,
)
from app.models.kho_hang import KhoHang
from app.models.stock_lot import LOT_AVAILABLE, StockLot
from app.models.stock_request import REQ_APPROVED, REQ_XUAT, StockRequest, StockRequestLine
from app.models.vat_lieu_kho import GiayNguyen, VatTuInAn
from app.repositories.bai_ghep_repo import BaiGhepRepository
from app.repositories.don_vi_do_repo import DonViDoRepository
from app.repositories.lsx_repo import LsxRepository
from app.repositories.purchase_repo import PurchaseRequestRepository, SupplierRepository
from app.repositories.stock_lot_repo import StockLotRepository
from app.repositories.stock_request_repo import StockRequestRepository
from app.repositories.vat_lieu_kho_repo import VatLieuKhoRepository
from app.services.ke_hoach_vat_tu_service import KeHoachVatTuService
from app.services.kho_giay import chuan_kho, don_vi_goc_to
from app.services.vat_lieu_kho_service import VatLieuKhoService

HOM_NAY = date.today()
MAI = HOM_NAY + timedelta(days=1)
#: Khổ giấy mặc định của dòng giấy / lô / dòng mua trong test (mm, đã chuẩn hoá ngắn × dài).
KHO = (780, 905)


@pytest.fixture
def db():
    yield from phien_da_seed()


@pytest.fixture
def svc(db):
    return KeHoachVatTuService(
        db,
        lsx_repo=LsxRepository(db),
        bai_ghep_repo=BaiGhepRepository(db),
        hang=VatLieuKhoService(VatLieuKhoRepository(db), DonViDoRepository(db)),
        lots=StockLotRepository(db),
        requests=StockRequestRepository(db),
        purchases=PurchaseRequestRepository(db),
        suppliers=SupplierRepository(db),
        don_vi=DonViDoRepository(db),
    )


# --- dựng dữ liệu -------------------------------------------------------------


def _giay(db, *, ma="GY-TEST", don_vi="kg", gsm=150, dai=860, rong=650) -> GiayNguyen:
    """Mã giấy ở danh mục. `don_vi` (kg) chỉ còn cho tính giá + lô cuộn — giấy tờ đếm tờ nguyên."""
    g = GiayNguyen(don_vi_them=["to"], ma=ma, ten=f"Giấy {ma}", gsm=gsm, kho_dai=dai, kho_rong=rong,
                   don_vi_gia=don_vi)
    db.add(g)
    db.commit()
    return g


def _don(db, customer) -> Order:
    o = Order(order_no=f"DH-{customer.id}-{db.query(Order).count() + 1}", customer_id=customer.id)
    db.add(o)
    db.flush()
    ln = OrderLine(order_id=o.id, description="dòng test", qty=1_000)
    db.add(ln)
    db.commit()
    o._line = ln
    return o


def _may(db) -> MayThietBi:
    """Máy in 1.000 tờ/giờ, chuẩn bị 30'. Thời lượng bước LẤY TỪ MÁY (setup_phut/chay_phut trên
    bước là cột dormant từ 2026-08-04) — không gán máy thì tổng thời gian dẫn = 0."""
    may = db.query(MayThietBi).filter(MayThietBi.ma == "MAY-KHVT").first()
    if may is None:
        may = MayThietBi(ma="MAY-KHVT", ten="Máy in test", loai_may="press_offset_sheet",
                         toc_do=1_000, don_vi_toc_do="to_gio", makeready_time_default=30,
                         kho_max_dai=1020, kho_max_rong=720)
        db.add(may)
        db.commit()
    return may


def _lenh(db, customer, *, ma, giay_id, so_to_nguyen, han=None, nguon_giay=None,
          buoc=True, giay_o_buoc=True, sl_giay=None, dvt_giay=None, qc_them=None,
          kho=KHO) -> Lsx:
    """Lệnh test. `giay_o_buoc=True` gắn dòng GIẤY lên bước — đường DUY NHẤT từ 08/09/2026.

    `quy_cach_json.giay_id` vẫn ghi vì quy cách còn nhiều thứ khác đọc nó (khổ, định lượng), nhưng
    nó KHÔNG còn đẻ nhu cầu giấy. Muốn dựng ca "lệnh chưa khai giấy" thì `giay_o_buoc=False`.

    Dòng giấy = số TỜ NGUYÊN theo KHỔ (spec giấy đếm tờ × khổ): `sl_giay=None` ⇒ `so_to_nguyen`,
    `dvt_giay=None` ⇒ mã tờ nguyên, `kho` ⇒ khổ của dòng (`None` = dòng chưa có khổ). Truyền
    `dvt_giay="kg"` để dựng dòng giấy CŨ ghi kg.
    """
    from app.models.lsx import LsxCongDoanVatTu

    o = _don(db, customer)
    qc = {"giay_id": giay_id}
    if kho:
        qc["kho_nguyen_rong"], qc["kho_nguyen_dai"] = chuan_kho(*kho)
    qc.update(qc_them or {})
    if nguon_giay:
        qc["nguon_giay"] = nguon_giay
    l = Lsx(
        ma=ma, ten=ma, order_id=o.id, order_line_id=o._line.id,
        so_luong_dat=1_000, so_to_nguyen=so_to_nguyen, so_con=1,
        han_hoan_thanh_sx=han, quy_cach_json=qc, trang_thai=TT_SAN_SANG,
    )
    db.add(l)
    db.flush()
    if buoc:
        b = LsxCongDoan(
            lsx_id=l.id, thu_tu=1, ten="In offset", loai_buoc="may", may_id=_may(db).id,
            don_vi_vao="to_nguyen", don_vi_ra="to",
            so_luong_vao=so_to_nguyen, so_luong_ra=so_to_nguyen,
        )
        db.add(b)
        db.flush()
        if giay_o_buoc:
            g = db.get(GiayNguyen, giay_id)
            kr, kd = chuan_kho(*kho) if kho else (0, 0)
            db.add(LsxCongDoanVatTu(
                lsx_cong_doan_id=b.id, hang_loai="giay", vat_tu_id=giay_id,
                vat_tu_ma_snapshot=g.ma, vat_tu_ten_snapshot=g.ten,
                don_vi_snapshot=dvt_giay or don_vi_goc_to(),
                so_luong=sl_giay if sl_giay is not None else so_to_nguyen,
                kho_rong=kr, kho_dai=kd, thu_tu=0, tu_dong=False,
            ))
    db.commit()
    return l


def _ton(db, giay: GiayNguyen, so_luong: float, *, goc="to", kho=KHO) -> None:
    """Một lô giấy khổ `kho`, đơn vị gốc `goc` (`to` đếm tờ; đơn vị giá của mã — `kg` — đếm kg)."""
    kho_hang = db.query(KhoHang).first()
    if kho_hang is None:
        kho_hang = KhoHang(ma="K1", ten="Kho test")
        db.add(kho_hang)
        db.flush()
    kr, kd = chuan_kho(*kho) if kho else (0, 0)
    db.add(StockLot(
        hang_loai="giay", hang_id=giay.id, kho_id=kho_hang.id,
        ma_lo=f"LOT-{giay.ma}-{goc}-{kr}x{kd}-{so_luong}",
        sl_ban_dau=so_luong, sl_con_lai=so_luong, ngay_nhap=HOM_NAY, trang_thai=LOT_AVAILABLE,
        don_vi_goc=goc, kho_rong=kr, kho_dai=kd,
    ))
    db.commit()


def _de_nghi_xuat(db, giay: GiayNguyen, *, lsx_id, duyet, da_ung, dvt=None,
                  kho=KHO) -> StockRequest:
    r = StockRequest(ma=f"DNX{db.query(StockRequest).count() + 1:04d}", loai=REQ_XUAT,
                     nguoi_tao_id=1, trang_thai=REQ_APPROVED)
    db.add(r)
    db.flush()
    kr, kd = chuan_kho(*kho)
    db.add(StockRequestLine(
        request_id=r.id, hang_loai="giay", hang_id=giay.id, lsx_id=lsx_id,
        dvt=dvt or don_vi_goc_to(), sl_de_nghi=duyet, sl_duyet=duyet, sl_da_ung=da_ung,
        don_vi_goc="to", kho_rong=kr, kho_dai=kd,
    ))
    db.commit()
    return r


def _kho_dong(hang, kho) -> tuple[int, int]:
    """Khổ của dòng mua: chỉ giấy mang khổ; vật tư khác 0 · 0."""
    return chuan_kho(*kho) if hang and hang[0] == "giay" and kho else (0, 0)


def _dv_dong(hang, unit) -> str:
    """Đơn vị dòng mua mặc định: giấy đếm tờ nguyên, vật tư khác kg."""
    return unit or (don_vi_goc_to() if hang and hang[0] == "giay" else "kg")


def _phieu_mua(db, *, hang, so_luong, ngay_ve, unit=None, status=PR_PURCHASED,
               kho=KHO) -> PurchaseRequest:
    p = PurchaseRequest(code=f"PMH-{db.query(PurchaseRequest).count() + 1}",
                        status=status, expected_receipt_date=ngay_ve)
    db.add(p)
    db.flush()
    db.add(PurchaseRequestLine(
        purchase_request_id=p.id, item_name="Giấy mua",
        hang_loai=hang[0] if hang else None, hang_id=hang[1] if hang else None,
        kho_rong=_kho_dong(hang, kho)[0], kho_dai=_kho_dong(hang, kho)[1],
        unit=_dv_dong(hang, unit), quantity=so_luong, expected_unit_price=1,
    ))
    db.commit()
    return p


def _ycmh(db, *, hang, so_luong, status=DPR_OPEN, unit=None,
          kho=KHO) -> DepartmentPurchaseRequest:
    """Đề nghị mua của bộ phận — chính là thứ nút "Mua" trên bảng cân đối đẻ ra."""
    yc = DepartmentPurchaseRequest(
        code=f"YCMH-{db.query(DepartmentPurchaseRequest).count() + 1}",
        status=status, source_type=SOURCE_SAN_XUAT, purpose="Thiếu vật tư",
        needed_date=HOM_NAY,
    )
    db.add(yc)
    db.flush()
    db.add(DepartmentPurchaseRequestLine(
        department_request_id=yc.id, item_name="Giấy đề nghị",
        hang_loai=hang[0], hang_id=hang[1], unit=_dv_dong(hang, unit), quantity=so_luong,
        kho_rong=_kho_dong(hang, kho)[0], kho_dai=_kho_dong(hang, kho)[1],
    ))
    db.commit()
    return yc


@pytest.fixture
def customer(db):
    c = Customer(code="KH-KHVT", name="KH kế hoạch vật tư")
    db.add(c)
    db.commit()
    return c


def _nhom(bang, giay, kho=KHO) -> dict:
    """Nhóm (mã giấy, khổ) — `kho=None` ⇒ nhóm dòng giấy chưa có khổ (khoá 0 · 0)."""
    kr, kd = chuan_kho(*kho) if kho else (0, 0)
    return next(g for g in bang["items"]
                if (g["hang_loai"], g["hang_id"], g["kho_rong"], g["kho_dai"]) == ("giay", giay.id, kr, kd))


# --- BẪY ĐẾM HAI LẦN ----------------------------------------------------------


def test_da_cap_du_thi_dong_xam_va_khong_tru_vao_ton_lan_nua(db, svc, customer):
    """Bẫy #1. Kho đã xuất 1.000 tờ cho lệnh A ⇒ tồn ĐÃ giảm còn 1.000.

    Phần đã cấp chỉ được trừ vào NHU CẦU (A thành xám). Nếu trừ thêm lần nữa vào tồn thì lệnh B
    thấy 0 tờ và báo đỏ oan — rồi ai đó đi mua một lô giấy không cần mua.
    """
    g = _giay(db)
    _ton(db, g, 1_000)                                 # tồn SAU khi đã xuất 1.000 cho lệnh A
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=1_000,
          han=MAI + timedelta(days=1))
    _de_nghi_xuat(db, g, lsx_id=a.id, duyet=1_000, da_ung=1_000)

    nhom = _nhom(svc.can_doi(), g)
    dong = {d["ma"]: d for d in nhom["dong"]}
    assert dong["LSX-A"]["trang_thai"] == "xam"
    assert dong["LSX-A"]["da_cap"] == pytest.approx(1_000)
    assert dong["LSX-A"]["con_phai_co"] == pytest.approx(0)
    # B cần 1.000 tờ ⇒ đủ bằng CHÍNH tồn 1.000 tờ đang có (không cần hàng về).
    assert dong["LSX-B"]["trang_thai"] == "xanh"
    assert dong["LSX-B"]["thieu"] == pytest.approx(0)


def test_hang_dang_ve_chi_cong_mot_lan(db, svc, customer):
    """Bẫy #2. Một đợt hàng về 1.000 tờ không được cộng cho CẢ HAI lệnh."""
    g = _giay(db)
    _phieu_mua(db, hang=("giay", g.id), so_luong=1_000, ngay_ve=HOM_NAY)
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=1_000,
          han=MAI + timedelta(days=1))

    dong = {d["ma"]: d for d in _nhom(svc.can_doi(), g)["dong"]}
    assert dong["LSX-A"]["trang_thai"] == "vang"       # đủ NHỜ hàng đang về
    assert dong["LSX-B"]["trang_thai"] == "do"         # lô đó đã dùng cho A rồi
    assert dong["LSX-B"]["thieu"] > 0


def test_dang_linh_chi_la_nhan_khong_vao_phep_tru(db, svc, customer):
    """Đề nghị đã lập nhưng kho CHƯA ghi sổ: hàng vẫn nằm trong kho ⇒ tồn không đổi."""
    g = _giay(db)
    _ton(db, g, 1_500)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    _de_nghi_xuat(db, g, lsx_id=a.id, duyet=100, da_ung=0)

    dong = _nhom(svc.can_doi(), g)["dong"][0]
    assert dong["dang_linh"] == pytest.approx(100)
    assert dong["da_cap"] == pytest.approx(0)
    assert dong["con_phai_co"] == pytest.approx(dong["nhu_cau"])
    assert dong["trang_thai"] == "xanh"                # tồn vẫn còn nguyên


def test_thieu_cua_tung_dong_khong_cong_don(db, svc, customer):
    """Hai dòng đỏ liên tiếp: `thieu` của dòng sau KHÔNG được gộp cả phần thiếu của dòng trước.

    Nếu cộng dồn thì tick cả hai rồi gộp một yêu cầu mua là đặt thừa đúng phần đếm hai lần.
    """
    g = _giay(db)
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=1_000,
          han=MAI + timedelta(days=1))

    nhom = _nhom(svc.can_doi(), g)
    dong = {d["ma"]: d for d in nhom["dong"]}
    assert dong["LSX-A"]["thieu"] == pytest.approx(dong["LSX-B"]["thieu"])
    assert sum(d["thieu"] for d in nhom["dong"]) == pytest.approx(nhom["tong_can"])


# --- BÀI GHÉP -----------------------------------------------------------------


def test_bai_ghep_khong_dem_doi_giay(db, svc, customer):
    """Hai lệnh in chung một tờ ⇒ MỘT dòng giấy mang mã bài, KHÔNG có dòng nào mang mã lệnh.

    Thành viên KHÔNG khai giấy ở bước của mình (`giay_o_buoc=False`): tờ in của một lượt chạy
    chung thuộc về BÀI, đó chính là luật chống đếm đôi đang kiểm.
    """
    g = _giay(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
              giay_o_buoc=False)
    b = _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
              giay_o_buoc=False)
    bg = BaiGhep(ma="GB-001", giay_id=g.id, kho_in_dai=860, kho_in_rong=650)
    db.add(bg)
    db.flush()
    db.add_all([
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=a.id, so_con_tren_to=1),
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=b.id, so_con_tren_to=1),
    ])
    db.commit()

    mas = [d["ma"] for d in _nhom(svc.can_doi(), g)["dong"]]
    assert mas == ["GB-001"]


# --- KHÔNG ĐOÁN ---------------------------------------------------------------


def test_dong_giay_ghi_kg_la_nhom_kg_khong_tru_ton_to(db, svc, customer):
    """Dòng giấy ghi kg ⇒ đơn vị gốc là đơn vị giá của mã (kg) — một nhóm RIÊNG, cân theo kg. Tờ và
    kg không quy đổi (bỏ dạng cuộn/tờ 10/10/2026) nên 10.000 tờ cùng khổ KHÔNG trừ vào nhu cầu kg;
    chúng chỉ hiện cạnh nhóm ở `cung_kho_khac_don_vi` cho người lập kế hoạch tự xem."""
    g = _giay(db, ma="GY-KG-CU")
    _ton(db, g, 10_000)
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
          sl_giay=83.85, dvt_giay="kg")

    nhom = _nhom(svc.can_doi(), g)
    assert nhom["don_vi_goc"] == "kg"
    dong = nhom["dong"][0]
    assert "khong_doi_chieu_duoc" not in dong["canh_bao"]
    assert dong["nhu_cau"] == pytest.approx(83.85)
    assert dong["trang_thai"] == "do"
    assert [(x["don_vi_goc"], x["ton"]) for x in nhom["cung_kho_khac_don_vi"]] == [("to", 10_000)]


def test_dong_mua_khong_gan_mat_hang_thi_khong_tru(db, svc, customer):
    """Phiếu mua 500 kg nhưng không gắn `(hang_loai, hang_id)` ⇒ bảng KHÔNG cộng.

    Ghép ngược bằng `item_name` là đoán; đoán trúng nhầm lô giấy khác thì bảng báo đủ trong khi
    thực tế thiếu.
    """
    g = _giay(db)
    _phieu_mua(db, hang=None, so_luong=500, ngay_ve=HOM_NAY)
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)

    dong = _nhom(svc.can_doi(), g)["dong"][0]
    assert dong["trang_thai"] == "do"


def test_lenh_cu_con_co_nguon_khach_VAN_sinh_dong_can_doi(db, svc, customer):
    """Đợt 4 · K — nguồn giấy "khách cấp" đã gỡ, nên bảng cân đối thôi bỏ qua lệnh mang cờ đó.

    Test cũ ghim "không sinh dòng"; nay ngược lại. Lý do nghiệp vụ: giấy vẫn phải CÓ MẶT ở xưởng
    đúng ngày bất kể ai trả tiền — chuyện tiền là của phiếu tính giá, không phải của bảng cân đối.
    Lệnh cũ còn cờ trong `quy_cach_json` cũng hiện dòng.
    """
    g = _giay(db)
    _lenh(db, customer, ma="LSX-KHACH", giay_id=g.id, so_to_nguyen=5_000, han=MAI,
          nguon_giay="khach")

    assert [gr for gr in svc.can_doi()["items"] if gr["hang_id"] == g.id]


def test_lenh_chua_khai_vat_tu_thi_VANG_MAT_chu_khong_bao_gi(db, svc, customer):
    """Từ 23/09/2026 bảng KHÔNG còn mục "bỏ qua": chưa khai thì vắng mặt, im lặng.

    Cửa chặn nằm ở xếp lịch (`_chan_chua_giu_du`), không ở bảng này — xem `_gom_nhu_cau`.
    """
    o = _don(db, customer)
    db.add(Lsx(ma="LSX-NOGIAY", ten="x", order_id=o.id, order_line_id=o._line.id,
               so_luong_dat=10, so_to_nguyen=100, quy_cach_json={}, trang_thai=TT_SAN_SANG))
    db.commit()

    bang = svc.can_doi()
    assert "bo_qua" not in bang
    assert not [r for nhom in bang["items"] for r in nhom["dong"] if r.get("ma") == "LSX-NOGIAY"]


def test_lenh_KHONG_con_tu_sinh_dong_giay_tu_quy_cach(db, svc, customer):
    """Đường cũ đã cắt 08/09/2026: `quy_cach_json.giay_id` không còn đẻ nhu cầu giấy nào.

    Lệnh vẫn ghi giấy trong quy cách (khổ/định lượng còn dùng chỗ khác) và vẫn có bước, chỉ thiếu
    dòng giấy khai tay ⇒ bảng cân đối phải TRỐNG giấy.
    """
    g = _giay(db)
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
          giay_o_buoc=False)

    bang = svc.can_doi()
    assert not [x for x in bang["items"] if x["hang_loai"] == "giay"]


def test_giay_chon_tay_o_BUOC_len_bang_voi_ngay_can_cua_dung_buoc_do(db, svc, customer):
    """Giấy neo vào CHÍNH bước mang nó — không còn "bước đầu tiên chạm tờ" nữa.

    Và số lượng LẤY THẲNG từ dòng của bước: 1.000 tờ nguyên — không quy đổi, không công thức.
    """
    g = _giay(db)
    l = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    buoc_id = l.cong_doans[0].id

    nhom = _nhom(svc.can_doi(), g)
    assert nhom["tong_can"] == pytest.approx(1_000)
    assert nhom["don_vi_goc"] == don_vi_goc_to()
    dong = nhom["dong"][0]
    assert dong["buoc_id"] == buoc_id
    assert dong["ten_viec"] == "In offset"


# --- NGÀY CẦN (18/09/2026: đọc từ yêu cầu mua, KHÔNG suy) --------------------


def _ycmh_cho(db, hang, *, can, lsx=None, bai=None, status=DPR_OPEN, huy_dong=False):
    """Yêu cầu mua đã lập cho ĐÚNG lệnh/bài này — thứ nút "Đề nghị mua" + Lưu trên form đẻ ra."""
    yc = DepartmentPurchaseRequest(
        code=f"YCMH-{db.query(DepartmentPurchaseRequest).count() + 1}",
        status=status, source_type=SOURCE_SAN_XUAT, purpose="Thiếu vật tư", needed_date=can,
    )
    db.add(yc)
    db.flush()
    db.add(DepartmentPurchaseRequestLine(
        department_request_id=yc.id, item_name="Giấy đề nghị", hang_loai=hang[0],
        hang_id=hang[1], unit=_dv_dong(hang, None), quantity=10,
        kho_rong=_kho_dong(hang, KHO)[0], kho_dai=_kho_dong(hang, KHO)[1],
        cancelled_at=datetime.now(timezone.utc) if huy_dong else None,
    ))
    db.add(YeuCauMuaNguonLenh(
        department_request_id=yc.id, hang_loai=hang[0], hang_id=hang[1],
        lsx_id=lsx.id if lsx else None, bai_ghep_id=bai.id if bai else None,
    ))
    db.commit()
    return yc


def test_chua_lap_yeu_cau_mua_thi_ngay_can_TRONG(db, svc, customer):
    """Tồn đủ hay chưa ai mua thì không có "ngày cần" nào để hiện — hệ KHÔNG suy từ hạn SX."""
    g = _giay(db)
    _ton(db, g, 10_000)
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000,
          han=HOM_NAY + timedelta(days=10))

    dong = _nhom(svc.can_doi(), g)["dong"][0]
    assert dong["trang_thai"] == "xanh"
    assert dong["ngay_can"] is None
    assert "moc_tam" not in dong and "han_dat" not in dong


def test_ngay_can_la_NGAY_CAN_HANG_tren_yeu_cau_mua_da_lap_cho_lenh(db, svc, customer):
    """Ngày người lập gõ trên form quay về đúng lệnh được tick — lệnh khác cùng giấy vẫn trống.
    Nhiều yêu cầu cho cùng lệnh ⇒ lấy ngày SỚM NHẤT."""
    g = _giay(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000,
              han=HOM_NAY + timedelta(days=10))
    _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=1_000,
          han=HOM_NAY + timedelta(days=12))
    _ycmh_cho(db, ("giay", g.id), can=HOM_NAY + timedelta(days=7), lsx=a)
    _ycmh_cho(db, ("giay", g.id), can=HOM_NAY + timedelta(days=4), lsx=a)

    dong = {d["ma"]: d for d in _nhom(svc.can_doi(), g)["dong"]}
    assert dong["LSX-A"]["ngay_can"] == HOM_NAY + timedelta(days=4)
    assert dong["LSX-B"]["ngay_can"] is None


def test_yeu_cau_da_huy_hoac_mon_da_bo_thi_het_ngay_can(db, svc, customer):
    """Yêu cầu huỷ, hoặc món đó bị bỏ khỏi yêu cầu ⇒ không còn ai mua cho lệnh ⇒ trống lại."""
    g = _giay(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000,
              han=HOM_NAY + timedelta(days=10))
    _ycmh_cho(db, ("giay", g.id), can=HOM_NAY + timedelta(days=3), lsx=a, status=DPR_CANCELLED)
    _ycmh_cho(db, ("giay", g.id), can=HOM_NAY + timedelta(days=5), lsx=a, huy_dong=True)

    assert _nhom(svc.can_doi(), g)["dong"][0]["ngay_can"] is None


def test_yeu_cau_mua_mon_KHAC_cho_lenh_khong_dan_ngay_vao_giay(db, svc, customer):
    """Liên kết khớp theo MẶT HÀNG: mua mực cho lệnh không phải là đã mua giấy cho lệnh đó."""
    g = _giay(db)
    vt = VatTuInAn(ma="VT-MUC", ten="Mực đen", don_vi_gia="kg")
    db.add(vt)
    db.commit()
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000,
              han=HOM_NAY + timedelta(days=10))
    _ycmh_cho(db, ("vat_tu", vt.id), can=HOM_NAY + timedelta(days=3), lsx=a)

    assert _nhom(svc.can_doi(), g)["dong"][0]["ngay_can"] is None


def test_bai_ghep_doc_ngay_can_theo_BAI(db, svc, customer):
    g = _giay(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=500,
              han=HOM_NAY + timedelta(days=25))
    b = _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=500,
              han=HOM_NAY + timedelta(days=9))
    bg = BaiGhep(ma="GB-001", giay_id=g.id, kho_in_dai=860, kho_in_rong=650)
    db.add(bg)
    db.flush()
    db.add_all([
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=a.id, so_con_tren_to=1),
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=b.id, so_con_tren_to=1),
    ])
    db.commit()
    _ycmh_cho(db, ("giay", g.id), can=HOM_NAY + timedelta(days=6), bai=bg)

    dong = {d["ma"]: d for d in _nhom(svc.can_doi(), g)["dong"]}
    assert dong["GB-001"]["ngay_can"] == HOM_NAY + timedelta(days=6)


def test_hang_dang_ve_sau_han_SX_VAN_duoc_cong_vao(db, svc, customer):
    """Không còn ca "về muộn" (18/09/2026): hệ không suy ngày cần nên không có mốc nào để chê lô
    về trễ. Lô có hẹn ngày là hàng đang về — vàng, không đỏ, không chặn gì."""
    g = _giay(db)
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000,
          han=HOM_NAY + timedelta(days=2))
    _phieu_mua(db, hang=("giay", g.id), so_luong=1_500, ngay_ve=HOM_NAY + timedelta(days=30))

    dong = _nhom(svc.can_doi(), g)["dong"][0]
    assert dong["trang_thai"] == "vang"
    assert dong["con_lai_sau"] >= 0


# --- VẬT TƯ KHÁC + KHÔNG PHƠI GIÁ --------------------------------------------


def test_vat_tu_khai_tay_o_buoc_len_bang(db, svc, customer):
    g = _giay(db)
    vt = VatTuInAn(ma="VT-MUC", ten="Mực đen", don_vi_gia="kg")
    db.add(vt)
    db.commit()
    l = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=100, han=MAI)
    buoc = db.query(LsxCongDoan).filter(LsxCongDoan.lsx_id == l.id).first()
    from app.models.lsx import LsxCongDoanVatTu

    db.add(LsxCongDoanVatTu(
        lsx_cong_doan_id=buoc.id, vat_tu_id=vt.id, vat_tu_ma_snapshot=vt.ma,
        vat_tu_ten_snapshot=vt.ten, don_vi_snapshot="kg", so_luong=5,
    ))
    db.commit()

    nhom = next(g for g in svc.can_doi()["items"]
                if (g["hang_loai"], g["hang_id"]) == ("vat_tu", vt.id))
    assert nhom["dong"][0]["nhu_cau"] == pytest.approx(5)


def test_khong_phoi_gia_von_o_bat_ky_truong_nao(db, svc, customer):
    """Bảng mở cho vai Kế hoạch SX; giá vốn thuộc quyền Kho/Kế toán."""
    g = _giay(db)
    _ton(db, g, 100)
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)

    cam = ("gia", "don_gia", "tien", "price", "cost")
    for nhom in svc.can_doi()["items"]:
        assert not [k for k in nhom if k in cam]
        for d in nhom["dong"]:
            assert not [k for k in d if k in cam]


# --- VÁ SAU AUDIT (2026-08-09) -------------------------------------------------
# Bốn ca dưới đây là lỗi THẬT bị bắt lúc soi lại, không phải giả định. Giữ test để đừng ai vô tình
# quay lại hành vi cũ.


def test_khong_doi_chieu_duoc_KHONG_deo_nhan_da_cap_du(db, svc, customer):
    """Dòng máy không tính nổi phải mang trạng thái RIÊNG.

    Trước đây `nhu_cau = 0` rơi vào nhánh "con_phai_co ≤ 0" ⇒ pill "Đã cấp đủ" — mạnh hơn cả "đủ",
    dán lên đúng dòng chưa ai tính được. Và vì `so_dong_do` không tăng, nhóm còn biến mất khỏi bộ
    lọc "chỉ mặt hàng đang thiếu": giấu đúng cái cần thấy.
    """
    # Giấy nay luôn quy được về đơn vị gốc suy từ chính ĐVT (bỏ dạng cuộn/tờ 10/10/2026) ⇒ dựng ca
    # "không đổi được" bằng vật tư khai theo ĐVT không có đường quy đổi về đơn vị giá của mã.
    g = _giay(db, ma="GY-KC2")
    vt = _vat_tu(db, ma="VT-KC2", don_vi="kg")
    l = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    _khai_vat_tu(db, _buoc_dau(db, l), vt, 3, dvt="hộp")

    def _nhom_vt(bang):
        return next(x for x in bang["items"] if (x["hang_loai"], x["hang_id"]) == ("vat_tu", vt.id))

    nhom = _nhom_vt(svc.can_doi())
    assert nhom["dong"][0]["trang_thai"] == "khong_ro"
    assert nhom["so_dong_khong_ro"] == 1
    # Và phải CÒN LẠI khi lọc "chỉ thiếu" — thứ máy không đánh giá được thì phải lo nhiều hơn.
    assert _nhom_vt(svc.can_doi(chi_thieu=True))["so_dong_khong_ro"] == 1


def test_da_cap_gan_vao_lenh_thanh_vien_van_tru_dung_vao_bai_ghep(db, svc, customer):
    """Thủ kho chọn LỆNH (thành viên bài) thay vì BÀI — số đã cấp không được bốc hơi.

    Giấy của lệnh thành viên KHÔNG có dòng nhu cầu riêng (một dòng cho cả bài, chống đếm đôi), nên
    khoá `(hang, lsx_id, None)` không dòng nào tra tới. Không quy về bài thì bài hiện đỏ dù kho đã
    cấp đủ giấy — rồi ai đó đi mua thêm.
    """
    g = _giay(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
              giay_o_buoc=False)
    b = _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
              giay_o_buoc=False)
    bg = BaiGhep(ma="GB-002", giay_id=g.id, kho_in_dai=860, kho_in_rong=650)
    db.add(bg)
    db.flush()
    db.add_all([
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=a.id, so_con_tren_to=1),
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=b.id, so_con_tren_to=1),
    ])
    db.commit()
    # Kho cấp 200 tờ, khai "cho LSX-A" (lệnh thành viên), không phải "cho GB-002".
    _de_nghi_xuat(db, g, lsx_id=a.id, duyet=200, da_ung=200)

    dong = _nhom(svc.can_doi(), g)["dong"][0]
    assert dong["ma"] == "GB-002"
    assert dong["da_cap"] == pytest.approx(200)


def test_phieu_mua_da_nhan_mot_phan_thi_chi_con_phan_chua_ve(db, svc, customer):
    """Phiếu cũ (chưa có đợt giao) khai `received_quantity` một phần: phần ĐÃ nhận nằm trong tồn rồi.

    Coi là "chưa nhận gì" thì phần đó bị đếm HAI LẦN — một lần ở tồn, một lần ở hàng đang về — và
    bảng báo đủ trong khi thật ra thiếu.
    """
    g = _giay(db)
    p = _phieu_mua(db, hang=("giay", g.id), so_luong=1_500, ngay_ve=HOM_NAY)
    ln = p.lines[0]
    ln.received_quantity = 1_200         # đã về 1.200, còn đúng 300 đang trên đường
    db.commit()
    _ton(db, g, 1_200)                   # 1.200 đó đã nằm trong kho
    # Mỗi lệnh 1.000 tờ → tồn 1.200 đủ cho A; nếu cộng nhầm cả 1.500 "đang về" thì B cũng hoá đủ,
    # trong khi thật ra chỉ còn 1.200 + 300 = 1.500 tờ cho 2.000 tờ nhu cầu.
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=1_000,
          han=MAI + timedelta(days=1))

    dong = {d["ma"]: d for d in _nhom(svc.can_doi(), g)["dong"]}
    assert dong["LSX-A"]["trang_thai"] == "xanh"
    assert dong["LSX-B"]["trang_thai"] == "do"


def test_dong_giay_chua_kho_canh_bao_khong_tra_ton(db, svc, customer):
    """Dòng giấy CHƯA có khổ ⇒ cờ `giay_chua_kho`, nhu cầu 0, "không đánh giá được" — và tồn của
    nhóm không lấy lô kg khổ rộng hay lô tờ khổ khác: khoá `(giay, id, 0, 0, to)` không khớp lô nào."""
    g = _giay(db, ma="GY-TRONG")
    _ton(db, g, 5_000, goc="kg", kho=(1_000, 0))
    _ton(db, g, 5_000)
    _lenh(db, customer, ma="LSX-TRONG", giay_id=g.id, so_to_nguyen=1_000,
          han=HOM_NAY + timedelta(days=10), kho=None)

    nhom = _nhom(svc.can_doi(), g, kho=None)
    dong = nhom["dong"][0]
    assert dong["canh_bao"] == ["giay_chua_kho"]
    assert dong["trang_thai"] == "khong_ro"
    assert dong["nhu_cau"] == 0
    assert "khổ" in dong["ly_do_canh_bao"]
    assert nhom["ton"] == 0


def test_ton_chia_theo_HAN_SX_lenh_khong_han_xuong_cuoi(db, svc, customer):
    """Con trỏ tồn chạy theo HẠN SẢN XUẤT — không phải thứ tự tạo lệnh, không phải id.

    Sai thứ tự là sai kết quả chứ không chỉ sai hiển thị: lệnh hạn sau đứng trước sẽ ăn hết tồn,
    rồi lệnh gấp hơn bị báo đỏ oan. Lệnh chưa khai hạn không được chen lên trước lệnh có hạn.
    """
    g = _giay(db)
    _ton(db, g, 1_500)                     # mỗi lệnh 1.000 tờ ⇒ tồn chỉ đủ MỘT lệnh
    # Tạo NGƯỢC thứ tự hạn: lệnh không hạn + hạn muộn tạo TRƯỚC, hạn sớm tạo SAU.
    _lenh(db, customer, ma="LSX-0-KHONG-HAN", giay_id=g.id, so_to_nguyen=1_000, han=None)
    _lenh(db, customer, ma="LSX-MUON", giay_id=g.id, so_to_nguyen=1_000,
          han=HOM_NAY + timedelta(days=20))
    _lenh(db, customer, ma="LSX-SOM", giay_id=g.id, so_to_nguyen=1_000,
          han=HOM_NAY + timedelta(days=3))
    _lenh(db, customer, ma="LSX-GIUA", giay_id=g.id, so_to_nguyen=1_000,
          han=HOM_NAY + timedelta(days=10))

    dong = _nhom(svc.can_doi(), g)["dong"]
    assert [d["ma"] for d in dong] == ["LSX-SOM", "LSX-GIUA", "LSX-MUON", "LSX-0-KHONG-HAN"]
    assert [d["trang_thai"] for d in dong] == ["xanh", "do", "do", "do"]


# 🔴 Khối test nhóm "Công cụ" (khuôn) đã GỠ 16/08/2026 cùng chính nhóm đó — xem mg `0203`.
# Cặp cờ `requires_tooling` / `tooling_type` VẪN CÒN ở danh mục Công đoạn, nhưng nay chỉ phiếu
# tính giá đọc (để biết bước nào hỏi PHÍ khuôn) — luật đó gác ở `test_thanh_phan_engine.py`.


# ============ ĐỢT 1 (17/08/2026) — ba lỗi làm SAI SỐ TIỀN ĐI MUA ============
#
# Cả ba cùng một họ HỎNG CÂM: bảng vẫn vẽ ra, không lỗi, chỉ con số gửi sang thu mua là sai.


def _vat_tu(db, *, ma="VT-MUC", ten="Mực đen", don_vi="kg") -> VatTuInAn:
    vt = VatTuInAn(ma=ma, ten=ten, don_vi_gia=don_vi)
    db.add(vt)
    db.commit()
    return vt


def _khai_vat_tu(db, buoc, vt, so_luong, dvt="kg") -> None:
    from app.models.lsx import LsxCongDoanVatTu

    db.add(LsxCongDoanVatTu(
        lsx_cong_doan_id=buoc.id, vat_tu_id=vt.id, vat_tu_ma_snapshot=vt.ma,
        vat_tu_ten_snapshot=vt.ten, don_vi_snapshot=dvt, so_luong=so_luong,
    ))
    db.commit()


def _them_buoc(db, lsx, *, thu_tu, ten) -> LsxCongDoan:
    b = LsxCongDoan(lsx_id=lsx.id, thu_tu=thu_tu, ten=ten, loai_buoc="may", may_id=_may(db).id,
                    don_vi_vao="to", don_vi_ra="to", so_luong_vao=100, so_luong_ra=100)
    db.add(b)
    db.commit()
    return b


def _buoc_dau(db, lsx) -> LsxCongDoan:
    """Bước ĐẦU của lệnh. `order_by` tường minh: mọi chỗ gọi hiện đều lúc lệnh mới có một bước,
    nhưng `.first()` trần sẽ gãy im lặng nếu ai đó tái dùng sau `_them_buoc`."""
    return (db.query(LsxCongDoan)
            .filter(LsxCongDoan.lsx_id == lsx.id)
            .order_by(LsxCongDoan.thu_tu.asc(), LsxCongDoan.id.asc())
            .first())


def _khai_vat_tu_bai(db, buoc_chung, vt, so_luong, dvt="kg") -> None:
    """Vật tư của một bước CHUNG của bài ghép — bảng khác hẳn bảng vật tư của bước lệnh."""
    from app.models.bai_ghep_cong_doan import BaiGhepCongDoanVatTu

    db.add(BaiGhepCongDoanVatTu(
        bai_ghep_cong_doan_id=buoc_chung.id, vat_tu_id=vt.id, vat_tu_ma_snapshot=vt.ma,
        vat_tu_ten_snapshot=vt.ten, don_vi_snapshot=dvt, so_luong=so_luong,
    ))
    db.commit()


# --- Lỗi ①: một lệnh ăn CÙNG một vật tư ở NHIỀU công đoạn ---------------------


def test_cung_vat_tu_o_hai_buoc_sinh_HAI_dong_khac_khoa(db, svc, customer):
    """Một lệnh có nhiều công đoạn, mỗi công đoạn khai vật tư riêng ⇒ hai dòng RIÊNG BIỆT.

    Ca thật trên DB dev: LSX26-0004 khai *Màng cán bóng* ở cả #20 In offset lẫn #50 Xén 3 mặt.
    """
    g = _giay(db)
    vt = _vat_tu(db)
    l = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=100, han=MAI)
    b1 = _buoc_dau(db, l)
    b2 = _them_buoc(db, l, thu_tu=2, ten="Bước hai")
    _khai_vat_tu(db, b1, vt, 5)
    _khai_vat_tu(db, b2, vt, 5)

    nhom = next(x for x in svc.can_doi()["items"]
                if (x["hang_loai"], x["hang_id"]) == ("vat_tu", vt.id))
    assert len(nhom["dong"]) == 2, "hai công đoạn ⇒ hai dòng, không được gộp"
    assert nhom["tong_can"] == pytest.approx(10)
    # KHOÁ phải khác nhau — đây là thứ `gom_de_nghi` tra; trùng khoá là nuốt mất một dòng.
    assert {d["buoc_id"] for d in nhom["dong"]} == {b1.id, b2.id}


def test_de_nghi_mua_cong_DU_ca_hai_buoc_khong_ra_mot_nua(db, svc, customer):
    """🔴 Lỗi ① — trước 17/08/2026 hàm này trả 5 thay vì 10, đúng MỘT NỬA.

    Khoá dòng thiếu `buoc_id` nên hai dòng cùng lệnh + cùng món trùng khoá; dict `tra` ghi đè, dòng
    sau nuốt dòng trước. Không lỗi, không cảnh báo — chỉ là đơn mua ra nửa số cần.
    """
    g = _giay(db)
    vt = _vat_tu(db)
    l = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=100, han=MAI)
    b1 = _buoc_dau(db, l)
    b2 = _them_buoc(db, l, thu_tu=2, ten="Bước hai")
    _khai_vat_tu(db, b1, vt, 5)
    _khai_vat_tu(db, b2, vt, 5)

    gom = svc.gom_de_nghi([
        {"hang_loai": "vat_tu", "hang_id": vt.id, "lsx_id": l.id,
         "bai_ghep_id": None, "buoc_id": b1.id},
        {"hang_loai": "vat_tu", "hang_id": vt.id, "lsx_id": l.id,
         "bai_ghep_id": None, "buoc_id": b2.id},
    ])
    assert len(gom["lines"]) == 1                      # gộp về MỘT dòng hàng để đi mua
    assert gom["lines"][0]["quantity"] == pytest.approx(10)


def test_da_cap_CHIA_cho_cac_buoc_khong_tru_nguyen_vao_tung_dong(db, svc, customer):
    """🔴 Cùng họ lỗi ①, nhưng ở phía ĐÃ CẤP — sửa 17/08/2026.

    Phiếu xuất kho chỉ gắn `lsx_id`, KHÔNG có `lsx_cong_doan_id`: kho xuất cho một LỆNH chứ không
    cho một bước. Nhưng lệnh ăn cùng món ở hai công đoạn thì có HAI dòng cùng khoá đó. Trừ nguyên
    phần đã cấp vào cả hai ⇒ cả hai ra `con_phai_co = 0` ⇒ bảng báo "đã cấp đủ" trong khi xưởng
    còn thiếu đúng một nửa. Tệ hơn báo thiếu oan: không ai đi mua bù.

    Chia theo thứ tự ngày cần — cùng luật con trỏ tồn và luật ưu tiên của giữ chỗ.
    """
    g = _giay(db)
    vt = _vat_tu(db)
    l = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=100, han=MAI)
    b1 = _buoc_dau(db, l)
    b2 = _them_buoc(db, l, thu_tu=2, ten="Bước hai")
    _khai_vat_tu(db, b1, vt, 5)
    _khai_vat_tu(db, b2, vt, 5)
    # Kho mới cấp 5 kg cho cả lệnh — đủ MỘT bước, không đủ hai.
    r = StockRequest(ma="DNX-CHIA", loai=REQ_XUAT, nguoi_tao_id=1, trang_thai=REQ_APPROVED)
    db.add(r)
    db.flush()
    db.add(StockRequestLine(request_id=r.id, hang_loai="vat_tu", hang_id=vt.id, lsx_id=l.id,
                            dvt="kg", sl_de_nghi=5, sl_duyet=5, sl_da_ung=5))
    db.commit()

    nhom = next(x for x in svc.can_doi()["items"]
                if (x["hang_loai"], x["hang_id"]) == ("vat_tu", vt.id))
    con = [_f2(d["con_phai_co"]) for d in nhom["dong"]]
    assert sorted(con) == [0, 5], f"5 kg chỉ phủ được MỘT bước, thực tế còn phải có: {con}"
    assert nhom["tong_can"] == pytest.approx(5), "cả lệnh vẫn còn thiếu 5 kg"


def _f2(v) -> float:
    return round(float(v or 0), 2)


def test_tick_trung_mot_dong_khong_lam_mua_gap_doi(db, svc, customer):
    """Client gửi hai lần cùng một khoá (bấm đúp / bảng cũ) ⇒ vẫn chỉ tính MỘT lần."""
    g = _giay(db)
    vt = _vat_tu(db)
    l = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=100, han=MAI)
    b1 = _buoc_dau(db, l)
    _khai_vat_tu(db, b1, vt, 5)

    khoa = {"hang_loai": "vat_tu", "hang_id": vt.id, "lsx_id": l.id,
            "bai_ghep_id": None, "buoc_id": b1.id}
    gom = svc.gom_de_nghi([khoa, dict(khoa)])
    assert gom["lines"][0]["quantity"] == pytest.approx(5)


def test_so_luong_de_nghi_lam_tron_LEN_toi_0_01(db, svc, customer):
    """Thiếu 79,475 kg ⇒ đề nghị 79,48: cột quantity chỉ giữ 2 lẻ, ô số lượng trên form YCMH đi bước
    0,01 — để nguyên 3 lẻ thì trình duyệt chặn nút Lưu; làm tròn xuống thì mua hụt."""
    g = _giay(db)
    vt = _vat_tu(db)
    l = _lenh(db, customer, ma="LSX-LE", giay_id=g.id, so_to_nguyen=100, han=MAI)
    b1 = _buoc_dau(db, l)
    _khai_vat_tu(db, b1, vt, 79.475)

    khoa = {"hang_loai": "vat_tu", "hang_id": vt.id, "lsx_id": l.id,
            "bai_ghep_id": None, "buoc_id": b1.id}
    assert svc.gom_de_nghi([khoa])["lines"][0]["quantity"] == 79.48


# --- Đề nghị mua: KHÔNG suy ngày, mang theo lệnh nguồn (18/09/2026) ---------


def test_gom_de_nghi_KHONG_suy_ngay_can_va_tra_lenh_nguon(db, svc, customer):
    """Ngày cần hàng để người lập tự gõ. Thứ gom trả thêm là KHOÁ các dòng đã tick — form gửi lại
    lúc Lưu để yêu cầu nhớ mình mua cho lệnh nào."""
    g = _giay(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=500,
              han=HOM_NAY + timedelta(days=5))
    b = _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=500,
              han=HOM_NAY + timedelta(days=25))
    chon = [
        {"hang_loai": "giay", "hang_id": g.id, "kho_rong": 780, "kho_dai": 905, "lsx_id": a.id,
         "bai_ghep_id": None, "buoc_id": _buoc_dau(db, a).id},
        {"hang_loai": "giay", "hang_id": g.id, "kho_rong": 780, "kho_dai": 905, "lsx_id": b.id,
         "bai_ghep_id": None, "buoc_id": _buoc_dau(db, b).id},
    ]
    gom = svc.gom_de_nghi(chon)
    assert gom["needed_date"] is None
    assert "ghi_chu_ngay" not in gom
    # Nguồn trả kèm đơn vị gốc của khoá (giấy đếm tờ ⇒ "to") — form gửi lại nguyên khoá.
    assert [{k: v for k, v in n.items() if k != "so_luong"} for n in gom["nguon"]] == [
        {**c, "don_vi_goc": "to"} for c in chon]
    assert [n["so_luong"] for n in gom["nguon"]] == [500, 500], "liên kết mang số đề nghị của ô"
    assert len(gom["lines"]) == 1
    # Định lượng đi theo dòng để form "Tạo yêu cầu mua hàng" điền sẵn hiện đúng cột chỉ đọc
    # (e2e 24/10/2026: form ra "–" trong khi danh sách sau khi lưu ra 150).
    assert gom["lines"][0]["dinh_luong"] == 150


def test_router_tao_thang_chuyen_NGAY_NGUOI_GUI_va_lenh_nguon_sang_thu_mua(client):
    """Cửa tạo thẳng không tự điền ngày nào: ngày do người gửi, lệnh nguồn do bảng cân đối."""
    from app.main import app
    from app.routers import ke_hoach_vat_tu as r

    nguon = [{"hang_loai": "giay", "hang_id": 1, "lsx_id": 5, "bai_ghep_id": None,
              "buoc_id": 9}]
    da_nhan: dict = {}

    class _KhoGia:
        def gom_de_nghi(self, chon):
            return {"lines": [{"hang_loai": "giay", "hang_id": 1, "item_name": "Giấy",
                               "unit": "kg", "quantity": 5}],
                    "needed_date": None, "related_document_code": "LSX-X", "nguon": nguon}

    class _ThuMuaGia:
        def create_department_request(self, **kw):
            da_nhan.update(kw)
            return {"id": 1, "code": "YC-0001"}

    can = HOM_NAY + timedelta(days=9)
    app.dependency_overrides[r.get_service] = lambda: _KhoGia()
    app.dependency_overrides[r.get_purchase_service] = lambda: _ThuMuaGia()
    try:
        resp = client.post(
            "/api/ke-hoach-vat-tu/de-nghi-mua",
            json={"dong": [{"hang_loai": "giay", "hang_id": 1}], "needed_date": can.isoformat()},
            headers={"Authorization": f"Bearer {_admin_token()}"},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 201, resp.text
    assert da_nhan["needed_date"] == can
    assert da_nhan["nguon_lenh"] == nguon
    assert "cần" not in (da_nhan.get("content") or "").split("—")[0]


def test_luu_yeu_cau_mua_qua_API_thi_lenh_nhan_NGAY_CAN(client, db, svc, customer):
    """Đi đúng đường thật: POST yêu cầu mua kèm `nguon_lenh` ⇒ bảng cân đối hiện ngày đó ở đúng
    lệnh. Sửa yêu cầu (đổi ngày) giữ liên kết; liên kết rác (lệnh không tồn tại / món không có
    trong yêu cầu) bị bỏ lặng lẽ."""
    g = _giay(db)
    s = Supplier(name="NCC giấy", status="active")
    db.add(s)
    db.flush()
    db.add(SupplierItem(supplier_id=s.id, hang_loai="giay", hang_id=g.id,
                        item_name=g.ten, unit="kg", unit_price=1))
    db.commit()
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000,
              han=HOM_NAY + timedelta(days=10))
    b = _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=1_000,
              han=HOM_NAY + timedelta(days=12))
    headers = {"Authorization": f"Bearer {_admin_token()}"}
    payload = {
        "source_type": "san_xuat", "related_document_type": "lsx",
        "related_document_code": "LSX-A", "purpose": "Thiếu giấy",
        "needed_date": (HOM_NAY + timedelta(days=8)).isoformat(),
        "lines": [{"item_name": g.ten, "unit": "kg", "quantity": 90,
                   "hang_loai": "giay", "hang_id": g.id}],
        "nguon_lenh": [
            {"hang_loai": "giay", "hang_id": g.id, "lsx_id": a.id,
             "buoc_id": _buoc_dau(db, a).id},
            {"hang_loai": "giay", "hang_id": g.id, "lsx_id": 999_999},
            {"hang_loai": "vat_tu", "hang_id": 1, "lsx_id": b.id},
        ],
    }
    resp = client.post("/api/department-purchase-requests", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    yc_id = resp.json()["id"]

    links = db.query(YeuCauMuaNguonLenh).filter_by(department_request_id=yc_id).all()
    assert [(n.hang_loai, n.hang_id, n.lsx_id) for n in links] == [("giay", g.id, a.id)]

    dong = {d["ma"]: d for d in _nhom(svc.can_doi(), g)["dong"]}
    assert dong["LSX-A"]["ngay_can"] == HOM_NAY + timedelta(days=8)
    assert dong["LSX-B"]["ngay_can"] is None

    payload.pop("nguon_lenh")
    payload["needed_date"] = (HOM_NAY + timedelta(days=6)).isoformat()
    resp = client.put(f"/api/department-purchase-requests/{yc_id}", json=payload,
                      headers=headers)
    assert resp.status_code == 200, resp.text
    db.expire_all()
    dong = {d["ma"]: d for d in _nhom(svc.can_doi(), g)["dong"]}
    assert dong["LSX-A"]["ngay_can"] == HOM_NAY + timedelta(days=6), "sửa yêu cầu mất liên kết"


def test_xem_truoc_de_nghi_mua_TRA_DU_DE_DIEN_FORM_va_KHONG_ghi_gi(client):
    """Cửa xem-trước phải trả đủ bộ để đổ vào form — và tuyệt đối KHÔNG lập phiếu.

    Đây là chỗ dễ hỏng nhất của đợt 20/08/2026: nút "Đề nghị mua ngay" đổi nghĩa từ "lập phiếu"
    sang "mở form". Nếu cửa này lỡ gọi `create_department_request` thì mỗi lần người dùng bấm rồi
    bấm Huỷ ở form vẫn đẻ ra một yêu cầu mua ma — không ai thấy, tới lúc thu mua mở màn mới lộ ra
    một đống phiếu trùng.
    """
    from app.main import app
    from app.routers import ke_hoach_vat_tu as r

    nguon = [{"hang_loai": "vat_tu", "hang_id": 7, "lsx_id": 3, "bai_ghep_id": None,
              "buoc_id": 11}]
    da_tao: list = []

    class _KhoGia:
        def gom_de_nghi(self, chon):
            return {"lines": [{"hang_loai": "vat_tu", "hang_id": 7, "item_name": "Kẽm CTP",
                               "unit": "kem", "quantity": 15}],
                    "needed_date": None, "related_document_code": "LSX-X, LSX-Y",
                    "nguon": nguon}

    class _ThuMuaGia:
        def can_create_department_request(self, actor):
            return True

        def create_department_request(self, **kw):
            da_tao.append(kw)
            return {"id": 1, "code": "YC-0001"}

    app.dependency_overrides[r.get_service] = lambda: _KhoGia()
    app.dependency_overrides[r.get_purchase_service] = lambda: _ThuMuaGia()
    try:
        resp = client.post(
            "/api/ke-hoach-vat-tu/de-nghi-mua/xem-truoc",
            json={"dong": [{"hang_loai": "vat_tu", "hang_id": 7}]},
            headers={"Authorization": f"Bearer {_admin_token()}"},
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert da_tao == [], "cửa xem-trước mà vẫn lập phiếu — bấm rồi huỷ là đẻ yêu cầu ma"
    assert body["related_document_type"] == "lsx"
    assert body["related_document_code"] == "LSX-X, LSX-Y"
    assert body["needed_date"] is None, "ngày cần để người lập tự gõ — hệ không suy"
    assert "LSX-X, LSX-Y" in body["noi_dung"]
    # Khổ là một phần khoá dòng + khổ cần của dòng mua; vật tư khác 0 · 0.
    assert body["nguon"] == [{**n, "kho_rong": 0, "kho_dai": 0, "don_vi_goc": "", "so_luong": None}
                             for n in nguon]
    assert body["lines"] == [{"hang_loai": "vat_tu", "hang_id": 7, "kho_rong": 0, "kho_dai": 0,
                              "item_name": "Kẽm CTP", "unit": "kem", "quantity": 15,
                              "dinh_luong": None}]


def test_xem_truoc_de_nghi_mua_CHAN_nguoi_khong_duoc_lap_yeu_cau(client):
    """Không có bit tạo yêu cầu mua thì chặn NGAY ở cửa xem-trước, đừng dẫn tới form rồi mới 403."""
    from app.main import app
    from app.routers import ke_hoach_vat_tu as r

    class _KhoGia:
        def gom_de_nghi(self, chon):  # pragma: no cover - không được gọi tới
            raise AssertionError("chặn quyền phải xảy ra TRƯỚC khi tính toán")

    class _ThuMuaGia:
        def can_create_department_request(self, actor):
            return False

    app.dependency_overrides[r.get_service] = lambda: _KhoGia()
    app.dependency_overrides[r.get_purchase_service] = lambda: _ThuMuaGia()
    try:
        resp = client.post(
            "/api/ke-hoach-vat-tu/de-nghi-mua/xem-truoc",
            json={"dong": [{"hang_loai": "vat_tu", "hang_id": 7}]},
            headers={"Authorization": f"Bearer {_admin_token()}"},
        )
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 403, resp.text


def _admin_token() -> str:
    from app.repositories.user_repo import UserRepository
    from app.security import create_access_token

    s = SessionLocal()
    try:
        return create_access_token(str(UserRepository(s).get_by_username("admin").id))
    finally:
        s.close()


def test_is_rush_ra_toi_dong(db, svc, customer):
    """Cờ GẤP phải đi hết chuỗi. Nửa vời (backend có, dòng không mang) là bẫy dự án đã dính 4 lần."""
    g = _giay(db)
    l = _lenh(db, customer, ma="LSX-GAP", giay_id=g.id, so_to_nguyen=500,
              han=HOM_NAY + timedelta(days=6))
    l.is_rush = True
    db.commit()

    dong = _nhom(svc.can_doi(), g)["dong"][0]
    assert dong["is_rush"] is True


# --- Lỗi ①, nhánh BÀI GHÉP ---------------------------------------------------


def test_bai_ghep_cung_vat_tu_o_hai_buoc_chung_cung_KHONG_gop_khoa(db, svc, customer):
    """🔴 Nhánh bài ghép của lỗi ① — plan ghi đích danh.

    `buoc_id` của dòng BÀI là `bai_ghep_cong_doan.id`, KHÁC không gian id với bước lệnh. Cặp
    `(lsx_id=None, bai_ghep_id=X)` trong khoá là thứ phân biệt hai không gian đó — nếu luật ấy sai
    thì bài ghép ăn cùng món ở hai bước chung cũng ra đơn mua một nửa, y như lệnh thường.
    """
    from app.models.bai_ghep_cong_doan import BaiGhepCongDoan
    from app.models.lsx import LsxCongDoanVatTu  # noqa: F401 — cùng module với bảng vật tư bước

    g = _giay(db)
    vt = _vat_tu(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    b = _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    bg = BaiGhep(ma="GB-001", giay_id=g.id, kho_in_dai=860, kho_in_rong=650)
    db.add(bg)
    db.flush()
    db.add_all([
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=a.id, so_con_tren_to=1),
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=b.id, so_con_tren_to=1),
    ])
    # HAI bước CHUNG của bài, cả hai cùng ăn một món.
    buocs = []
    for i in (1, 2):
        c = BaiGhepCongDoan(bai_ghep_id=bg.id, thu_tu=i, ten=f"Bước chung {i}",
                            so_luong_vao=100, so_luong_ra=100)
        db.add(c)
        db.flush()
        buocs.append(c)
    db.commit()
    for c in buocs:
        _khai_vat_tu_bai(db, c, vt, 5)

    nhom = next(x for x in svc.can_doi()["items"]
                if (x["hang_loai"], x["hang_id"]) == ("vat_tu", vt.id))
    assert len(nhom["dong"]) == 2
    assert {d["buoc_id"] for d in nhom["dong"]} == {buocs[0].id, buocs[1].id}
    assert all(d["lsx_id"] is None and d["bai_ghep_id"] == bg.id for d in nhom["dong"])

    gom = svc.gom_de_nghi([
        {"hang_loai": "vat_tu", "hang_id": vt.id, "lsx_id": None,
         "bai_ghep_id": bg.id, "buoc_id": buocs[0].id},
        {"hang_loai": "vat_tu", "hang_id": vt.id, "lsx_id": None,
         "bai_ghep_id": bg.id, "buoc_id": buocs[1].id},
    ])
    assert gom["lines"][0]["quantity"] == pytest.approx(10), "phải cộng cả hai bước chung"


def test_bai_GAP_khi_co_it_nhat_mot_thanh_vien_gap(db, svc, customer):
    """Bài chạy chung một lượt, không tách được — một thành viên gấp là cả bài gấp."""
    g = _giay(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    b = _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    b.is_rush = True
    bg = BaiGhep(ma="GB-001", giay_id=g.id, kho_in_dai=860, kho_in_rong=650)
    db.add(bg)
    db.flush()
    db.add_all([
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=a.id, so_con_tren_to=1),
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=b.id, so_con_tren_to=1),
    ])
    db.commit()

    dong = _nhom(svc.can_doi(), g)["dong"][0]
    assert dong["ma"] == "GB-001" and dong["is_rush"] is True


def test_vat_tu_hieu_luc_bai_ghep_khong_cong_lai_buoc_nguon_bi_override(
    db, svc, customer,
):
    """Bước chung tính một lần; bước riêng theo LSX; bước nguồn bị đè không còn hiệu lực."""
    from app.models.bai_ghep_cong_doan import BaiGhepCongDoan, BaiGhepCongDoanMap
    from app.models.lsx import LsxCongDoan

    g = _giay(db)
    vt = _vat_tu(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    b = _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    a.trang_thai = TT_NHAP
    b.trang_thai = TT_CHO_BO_SUNG
    db.commit()
    nguon_a, nguon_b = _buoc_dau(db, a), _buoc_dau(db, b)
    rieng_a = LsxCongDoan(lsx_id=a.id, thu_tu=2, ten="Riêng A", nhom="finishing")
    rieng_b = LsxCongDoan(lsx_id=b.id, thu_tu=2, ten="Riêng B", nhom="finishing")
    db.add_all([rieng_a, rieng_b])
    bg = BaiGhep(ma="GB-EFFECTIVE", giay_id=g.id, kho_in_dai=860, kho_in_rong=650)
    db.add(bg)
    db.flush()
    db.add_all([
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=a.id, so_con_tren_to=1),
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=b.id, so_con_tren_to=1),
    ])
    chung = BaiGhepCongDoan(
        bai_ghep_id=bg.id, thu_tu=1, ten="Bước chung", nhom="print",
        so_luong_vao=100, so_luong_ra=100,
    )
    db.add(chung)
    db.flush()
    db.add_all([
        BaiGhepCongDoanMap(
            bai_ghep_cong_doan_id=chung.id, lsx_id=a.id, lsx_step_key=nguon_a.step_key,
        ),
        BaiGhepCongDoanMap(
            bai_ghep_cong_doan_id=chung.id, lsx_id=b.id, lsx_step_key=nguon_b.step_key,
        ),
    ])
    db.commit()

    # Hai dòng 5 kg ở bước nguồn đã bị đè phải biến khỏi nhu cầu hiệu lực.
    _khai_vat_tu(db, nguon_a, vt, 5)
    _khai_vat_tu(db, nguon_b, vt, 5)
    # Hai bước riêng vẫn tính theo từng LSX; bước chung chỉ tính đúng một lần cho cả bài.
    _khai_vat_tu(db, rieng_a, vt, 2)
    _khai_vat_tu(db, rieng_b, vt, 3)
    _khai_vat_tu_bai(db, chung, vt, 7)

    nhom = next(x for x in svc.can_doi(include_lsx_ids={a.id, b.id})["items"]
                if (x["hang_loai"], x["hang_id"]) == ("vat_tu", vt.id))
    assert len(nhom["dong"]) == 3
    assert sum(d["nhu_cau"] for d in nhom["dong"]) == pytest.approx(12)
    assert {(d["lsx_id"], d["bai_ghep_id"], d["nhu_cau"]) for d in nhom["dong"]} == {
        (a.id, None, 2), (b.id, None, 3), (None, bg.id, 7),
    }

    hieu_luc = svc.vat_tu_hieu_luc(bg.id)
    assert hieu_luc["bai_ghep_id"] == bg.id
    tab = next(x for x in hieu_luc["items"]
               if (x["hang_loai"], x["hang_id"]) == ("vat_tu", vt.id))
    assert tab["tong_can"] == pytest.approx(12), "phải tính lại sau khi lọc khỏi tổng toàn xưởng"
    assert {(d["pham_vi"], d["lsx_id"], d["nhu_cau"]) for d in tab["dong"]} == {
        ("lsx", a.id, 2), ("lsx", b.id, 3), ("bai_ghep", None, 7),
    }
    assert {
        (d["pham_vi"], d["gang_step_key"]) for d in tab["dong"]
    } == {("lsx", None), ("bai_ghep", chung.step_key)}


# --- VẾT MUA (chip "đang có phiếu chạy") --------------------------------------


def test_ycmh_moi_de_nghi_hien_ten_phieu_ma_KHONG_doi_mot_con_so_nao(db, svc, customer):
    """Câu hỏi 20/08/2026: *"sao biết được cái nào đang yêu cầu mua"*.

    Bấm "Mua" trên bảng cân đối chỉ đẻ ra YCMH; engine cố ý KHÔNG cộng nó vào tồn (chưa ai duyệt,
    hàng chưa chắc có). Nên trước đây "đã đề nghị" và "chưa ai đụng vào" vẽ ĐỎ giống hệt nhau và
    người tiếp theo bấm Mua chồng lên. `phieu_mua` là NHÃN — phải hiện tên phiếu mà tuyệt đối
    không được nhích một con số nào của bảng, nếu không nhãn hoá thành lời hứa có hàng.
    """
    g = _giay(db)
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)

    truoc = _nhom(svc.can_doi(), g)
    assert truoc["phieu_mua"] == []
    assert truoc["dong"][0]["trang_thai"] == "do"

    yc = _ycmh(db, hang=("giay", g.id), so_luong=200)

    sau = _nhom(svc.can_doi(), g)
    assert sau["phieu_mua"] == [
        {"ma": yc.code, "loai": "ycmh", "trang_thai": DPR_OPEN, "ngay_ve": None},
    ]
    # Số học không đổi một ly: vẫn đỏ, vẫn thiếu đúng ngần ấy, vẫn còn nút Mua.
    assert sau["dong"][0]["trang_thai"] == "do"
    assert sau["dong"][0]["thieu"] == pytest.approx(truoc["dong"][0]["thieu"])
    assert sau["tong_can"] == pytest.approx(truoc["tong_can"])
    assert sau["ton"] == pytest.approx(truoc["ton"])


def test_vet_mua_xep_chac_truoc_long_sau(db, svc, customer):
    """Chip vật tư chỉ đủ chỗ MỘT dòng ⇒ phần tử đầu phải là lời hứa CHẮC nhất.

    Xếp ngược lại thì chip báo "mới đề nghị" trong khi hàng đã nằm trên xe — tin xấu che tin tốt.
    """
    g = _giay(db)
    cho_duyet = _phieu_mua(db, hang=("giay", g.id), so_luong=10, ngay_ve=None, status=PR_PENDING)
    khong_ngay = _phieu_mua(db, hang=("giay", g.id), so_luong=10, ngay_ve=None)
    co_ngay = _phieu_mua(db, hang=("giay", g.id), so_luong=10, ngay_ve=MAI)
    yc = _ycmh(db, hang=("giay", g.id), so_luong=10, status=DPR_PENDING_APPROVAL)
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)

    nhom = _nhom(svc.can_doi(), g)
    assert [v["ma"] for v in nhom["phieu_mua"]] == [
        co_ngay.code,      # đã duyệt + có ngày về  → chắc nhất
        khong_ngay.code,   # đã duyệt, NCC chưa hẹn ngày
        cho_duyet.code,    # PMH còn nằm chờ duyệt
        yc.code,           # mới là đề nghị của bộ phận → lỏng nhất
    ]
    assert [v["loai"] for v in nhom["phieu_mua"]] == ["pmh", "pmh", "pmh", "ycmh"]
    assert nhom["phieu_mua"][0]["ngay_ve"] == MAI


def test_phieu_nhan_du_va_phieu_khep_KHONG_con_la_viec_dang_chay(db, svc, customer):
    """Nhãn nói "đang có người lo" ⇒ phiếu đã xong phải rụng khỏi danh sách.

    Giữ lại thì mặt hàng nào từng mua một lần cũng đeo nhãn vĩnh viễn, và nhãn hết nghĩa.
    """
    g = _giay(db)
    p = _phieu_mua(db, hang=("giay", g.id), so_luong=100, ngay_ve=HOM_NAY)
    p.lines[0].received_quantity = 100          # về đủ rồi, hàng nằm trong kho
    db.commit()
    _ycmh(db, hang=("giay", g.id), so_luong=50, status="done")
    _ycmh(db, hang=("giay", g.id), so_luong=50, status="cancelled")
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)

    assert _nhom(svc.can_doi(), g)["phieu_mua"] == []


def test_dong_mua_khong_gan_mat_hang_thi_khong_deo_nhan(db, svc, customer):
    """Ghép ngược bằng TÊN hàng là đoán. Đoán trúng nhầm lô giấy khác thì nhãn nói dối."""
    g = _giay(db)
    _phieu_mua(db, hang=None, so_luong=100, ngay_ve=MAI)
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)

    assert _nhom(svc.can_doi(), g)["phieu_mua"] == []


def test_vat_tu_co_CONG_THUC_LUONG_van_lay_SO_DA_CHOT_o_buoc_khong_tinh_lai(db, svc, customer):
    """Vật tư khai công thức lượng ⇒ bảng cân đối DÙNG số của bước, KHÔNG chạy lại công thức.

    Hỏng thật 20/08/2026 (LSX26-0020): kẽm/mực/màng đều khai công thức lượng, BOM của lệnh ghi
    10 bản kẽm · 100 kg mực · 91.000 m² màng, còn kế hoạch vật tư hiện "0 · Chưa rõ ĐVT" cho cả
    năm dòng ⇒ độ sẵn sàng 0%, không bật được giữ chỗ, không xếp lịch được.

    Vì sao: `_ve_goc` chạy lại công thức bằng `ngu_canh_lenh(qc)`, mà `qc` chỉ được dựng cho GIẤY
    (`_quy_cach_cua` trả None cho loại khác) nên cả 16 biến đều 0 ⇒ "Chưa biết so_kem".
    Số của bước mới là số đúng: `LsxService._luong_vat_tu` tính nó bằng ngữ cảnh có cả `sl_vao`
    của chính bước — thứ mà tầng lệnh không bao giờ có (`sl_vao` là biến TẦNG BƯỚC).
    """
    g = _giay(db)
    kem = _vat_tu(db, ma="VT-KEM", ten="Bản kẽm khổ 102", don_vi="kem")
    mang = _vat_tu(db, ma="VT-MANG", ten="Màng cán bóng", don_vi="m2")
    # Ô `vat_tu_in_an.cong_thuc_luong` GỠ ở mg `0274` — định mức nay khai ở dòng vật tư của đầu
    # việc, mà đường KẾ HOẠCH VẬT TƯ này (tầng lệnh) chưa bao giờ đọc nó cho vật tư: nó chỉ đọc
    # `so_luong` mà bước đã tính sẵn. Bỏ hai dòng khai là đúng nghiệp vụ hiện tại.
    db.commit()

    l = _lenh(db, customer, ma="LSX-CTL-VT", giay_id=g.id, so_to_nguyen=241, han=MAI)
    l.quy_cach_json = {**l.quy_cach_json, "so_kem": 5}
    db.commit()
    buoc = _buoc_dau(db, l)
    _khai_vat_tu(db, buoc, kem, 5, dvt="kem")
    _khai_vat_tu(db, buoc, mang, 91_000, dvt="m2")

    bang = svc.can_doi()
    for vt, cho_doi in ((kem, 5), (mang, 91_000)):
        dong = next(n for n in bang["items"]
                    if (n["hang_loai"], n["hang_id"]) == ("vat_tu", vt.id))["dong"][0]
        assert "khong_doi_chieu_duoc" not in dong["canh_bao"], dong.get("ly_do_canh_bao")
        assert dong["nhu_cau"] == pytest.approx(cho_doi)


# --- VẾT MUA THEO TỪNG MÓN, KHÔNG THEO CẢ YÊU CẦU -----------------------------
#
# Chủ chốt 24/08/2026: *"phải đi vào trong trạng thái của từng sản phẩm trong yêu cầu ấy chứ không
# phải yêu cầu"*. Một YCMH gộp nhiều món; Thu mua lập đơn cho từng món một, nên trạng thái của cả
# yêu cầu KHÔNG nói được món cụ thể này đang ở đâu.


def _ycmh_hai_mon(db, *, hang_a, hang_b, status=DPR_OPEN):
    """YCMH hai dòng, hai mặt hàng khác nhau — dựng thẳng để khỏi kéo cả luồng HTTP vào đây."""
    yc = DepartmentPurchaseRequest(
        code=f"YCMH-{db.query(DepartmentPurchaseRequest).count() + 1}",
        status=status, source_type=SOURCE_SAN_XUAT, purpose="Thiếu vật tư",
        needed_date=HOM_NAY,
    )
    db.add(yc)
    db.flush()
    dong = []
    for i, hang in enumerate((hang_a, hang_b)):
        ln = DepartmentPurchaseRequestLine(
            department_request_id=yc.id, item_name=f"Giấy đề nghị {i + 1}",
            hang_loai=hang[0], hang_id=hang[1], unit=_dv_dong(hang, None), quantity=100,
            kho_rong=_kho_dong(hang, KHO)[0], kho_dai=_kho_dong(hang, KHO)[1],
        )
        db.add(ln)
        dong.append(ln)
    db.commit()
    return yc, dong[0], dong[1]


def test_yeu_cau_dang_mua_vi_mon_KHAC_thi_mon_nay_van_la_dang_cho_thu_mua(db, svc, customer):
    """⭐ Ca chủ hỏi (ảnh 3): yêu cầu đã "đang mua" nhưng chỉ vì MỘT món trong đó.

    Trước 24/08/2026 chip lấy thẳng `yc.status`, nên món chưa ai lập đơn cũng đeo nhãn "đang mua"
    — người lập kế hoạch nhìn vào tưởng có hàng đang trên đường, thực ra không ai cầm.
    """
    g1 = _giay(db, ma="GY-CHUA-MUA")
    g2 = _giay(db, ma="GY-DA-MUA")
    yc, dong1, dong2 = _ycmh_hai_mon(
        db, hang_a=("giay", g1.id), hang_b=("giay", g2.id),
        status="in_purchase",   # cả yêu cầu đã nhảy sang "đang mua" vì món thứ hai
    )
    # Đơn mua CHỈ ôm món thứ hai, và nối đích danh dòng của yêu cầu.
    pmh = _phieu_mua(db, hang=("giay", g2.id), so_luong=100, ngay_ve=MAI)
    pmh.lines[0].department_request_line_id = dong2.id
    db.commit()

    _lenh(db, customer, ma="LSX-A", giay_id=g1.id, so_to_nguyen=1_000, han=MAI)
    _lenh(db, customer, ma="LSX-B", giay_id=g2.id, so_to_nguyen=1_000, han=MAI)
    bang = svc.can_doi()

    chua_mua = _nhom(bang, g1)["phieu_mua"]
    assert chua_mua == [
        {"ma": yc.code, "loai": "ycmh", "trang_thai": DPR_OPEN, "ngay_ve": None},
    ], "món chưa ai lập đơn phải nói đúng là còn đang chờ Thu mua"

    da_mua = _nhom(bang, g2)["phieu_mua"]
    assert [(v["ma"], v["loai"]) for v in da_mua] == [(pmh.code, "pmh")], (
        "món đã có đơn mua thì chỉ nói về đơn mua — thêm chip YCMH là vẽ ra hai việc song song"
    )


def test_mon_da_BO_khoi_yeu_cau_thi_rung_chip(db, svc, customer):
    """Bộ phận bỏ món khỏi yêu cầu (mg 0233) ⇒ không còn ai chờ nó, nhãn phải biến mất.

    Giữ lại thì bảng cân đối bảo "đang có người lo" trong khi thực tế chẳng ai lo, và người lập kế
    hoạch không bấm Mua nữa."""
    g = _giay(db)
    yc, dong1, _dong2 = _ycmh_hai_mon(
        db, hang_a=("giay", g.id), hang_b=("giay", _giay(db, ma="GY-KHAC").id),
    )
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    assert _nhom(svc.can_doi(), g)["phieu_mua"] != []

    dong1.cancelled_at = datetime.now(timezone.utc)
    dong1.cancel_reason = "Kho còn hàng"
    db.commit()

    assert _nhom(svc.can_doi(), g)["phieu_mua"] == [], (
        "món đã bỏ mà vẫn đeo nhãn thì nhãn nói dối"
    )


# --- KHÁCH HÀNG & HẠN GIAO KHÁCH ----------------------------------------------


def test_dong_mang_khach_va_han_giao_cua_lenh(db, svc, customer):
    """Bảng cân đối phải nói được "lệnh này của ai, giao ngày nào".

    Hạn giao KHÁCH (`han_giao_khach`) khác hạn nội bộ `han_hoan_thanh_sx` mà bảng dùng xếp thứ tự
    ăn tồn — dựng hai ngày LỆCH nhau để bắt được ca lấy nhầm cột."""
    g = _giay(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000,
              han=HOM_NAY + timedelta(days=5))
    a.han_giao_khach = HOM_NAY + timedelta(days=9)
    db.commit()

    d = _nhom(svc.can_doi(), g)["dong"][0]
    assert d["khach_ten"] == customer.name
    assert d["han_giao_khach"] == HOM_NAY + timedelta(days=9)


def test_don_chua_gan_khach_thi_o_khach_trong_chu_khong_mat_dong(db, svc, customer):
    """Đơn không có khách (`customer_id` NULL) vẫn phải giữ dòng — join phải là LEFT."""
    g = _giay(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    db.get(Order, a.order_id).customer_id = None
    db.commit()

    dong = _nhom(svc.can_doi(), g)["dong"]
    assert [d["ma"] for d in dong] == ["LSX-A"]
    assert dong[0]["khach_ten"] is None


def test_bai_ghep_nhieu_khach_thi_dem_khach_va_lay_han_som_nhat(db, svc, customer):
    """Bài gom nhiều lệnh của nhiều khách: KHÔNG bốc một tên làm đại diện (người đọc sẽ tưởng cả
    bài của khách đó), mà nói đúng là "2 khách". Hạn giao lấy SỚM NHẤT."""
    khac = Customer(code="KH-KHAC", name="Khách thứ hai")
    db.add(khac)
    db.commit()
    g = _giay(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=500, han=MAI,
              giay_o_buoc=False)
    b = _lenh(db, khac, ma="LSX-B", giay_id=g.id, so_to_nguyen=500, han=MAI,
              giay_o_buoc=False)
    a.han_giao_khach = HOM_NAY + timedelta(days=12)
    b.han_giao_khach = HOM_NAY + timedelta(days=8)
    bg = BaiGhep(ma="GB-001", giay_id=g.id, kho_in_dai=860, kho_in_rong=650)
    db.add(bg)
    db.flush()
    db.add_all([
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=a.id, so_con_tren_to=1),
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=b.id, so_con_tren_to=1),
    ])
    db.commit()

    d = _nhom(svc.can_doi(), g)["dong"][0]
    assert d["ma"] == "GB-001"
    assert d["khach_ten"] == "2 khách"
    assert d["han_giao_khach"] == HOM_NAY + timedelta(days=8)


def test_bai_ghep_cung_mot_khach_thi_noi_ten_khach(db, svc, customer):
    """Mọi thành viên cùng khách ⇒ nói thẳng tên, không đếm."""
    g = _giay(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=500, han=MAI,
              giay_o_buoc=False)
    b = _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=500, han=MAI,
              giay_o_buoc=False)
    bg = BaiGhep(ma="GB-002", giay_id=g.id, kho_in_dai=860, kho_in_rong=650)
    db.add(bg)
    db.flush()
    db.add_all([
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=a.id, so_con_tren_to=1),
        BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=b.id, so_con_tren_to=1),
    ])
    db.commit()

    assert _nhom(svc.can_doi(), g)["dong"][0]["khach_ten"] == customer.name


# --- BƯỚC ĐÃ CHẠY XONG THÌ RỤNG KHỎI BẢNG (23/09/2026) ------------------------
#
# Bảng này trả lời "CÒN phải lo gì". `lsx.trang_thai` dừng ở `da_phat_hanh` (các mốc sau khai mà
# chưa dùng), nên trước đây không có gì kéo dòng ra: lệnh chạy xong đời nào vẫn nằm lại dưới dạng
# "đã cấp đủ". Mốc rụng là BƯỚC — vật tư neo vào đúng bước tiêu thụ nó.


def _cong_viec(db, lsx, *, buoc_id=None, bai_ghep_cong_doan_id=None, xong=True,
               phan_doan_so=1, phan_doan_tong=1):
    """Một work item của bàn tổ, đủ cột để `buoc_da_chay_xong` đếm được."""
    from app.models.san_xuat import (
        CV_HOAN_THANH, CV_PHAT_HANH, SanXuatCongViec, SanXuatGoiPhatHanh,
    )

    goi = db.query(SanXuatGoiPhatHanh).first()
    if goi is None:
        goi = SanXuatGoiPhatHanh(ma="GOI-KHVT-1")
        db.add(goi)
        db.flush()
    cv = SanXuatCongViec(
        goi_id=goi.id, lsx_id=(lsx.id if lsx is not None else None),
        lsx_cong_doan_id=buoc_id, bai_ghep_cong_doan_id=bai_ghep_cong_doan_id,
        ten_cong_doan="In offset", phan_doan_so=phan_doan_so, phan_doan_tong=phan_doan_tong,
        trang_thai=CV_HOAN_THANH if xong else CV_PHAT_HANH,
        hoan_thanh_luc=datetime.now(timezone.utc) if xong else None,
    )
    db.add(cv)
    db.commit()
    return cv


def _buoc_cua(db, lsx) -> LsxCongDoan:
    return db.query(LsxCongDoan).filter(LsxCongDoan.lsx_id == lsx.id).order_by(
        LsxCongDoan.thu_tu).first()


def _nhom_neu_co(bang, giay):
    """Như `_nhom` nhưng trả `None` khi mặt hàng đã rụng — `_nhom` cố ý nổ để test cũ không im."""
    return next(
        (g for g in bang["items"] if (g["hang_loai"], g["hang_id"]) == ("giay", giay.id)), None
    )


def test_buoc_chay_xong_thi_dong_vat_tu_RUNG_khoi_bang(db, svc, customer):
    """Bước ăn giấy đã `completed` ⇒ mặt hàng không còn việc gì để lo ⇒ biến khỏi bảng.

    Không phải "chuyển xám": xám nghĩa là còn theo dõi. Ở đây là hết chuyện.
    """
    g = _giay(db)
    l = _lenh(db, customer, ma="LSX-XONG", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    _ton(db, g, 500)
    assert _nhom_neu_co(svc.can_doi(), g) is not None, "chưa chạy thì phải có mặt"

    _cong_viec(db, l, buoc_id=_buoc_cua(db, l).id, xong=True)

    assert _nhom_neu_co(svc.can_doi(), g) is None


def test_buoc_chua_phat_hanh_thi_VAN_O_LAI(db, svc, customer):
    """Không có work item nào ⇒ chưa chạy, không phải đã xong. Chiều an toàn."""
    g = _giay(db)
    _lenh(db, customer, ma="LSX-CHUA", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    _ton(db, g, 500)

    assert _nhom_neu_co(svc.can_doi(), g) is not None


def test_moi_xong_MOT_lan_chay_thi_chua_rung(db, svc, customer):
    """Bước tách hai lần chạy (mg `0254`): lần 1 xong, lần 2 còn chạy ⇒ vật tư vẫn phải lo.

    Đếm "có một việc xong" thay vì "mọi việc xong" là giấu mất giấy của nửa sau.
    """
    g = _giay(db)
    l = _lenh(db, customer, ma="LSX-2LAN", giay_id=g.id, so_to_nguyen=1_000, han=MAI)
    _ton(db, g, 500)
    buoc = _buoc_cua(db, l).id
    _cong_viec(db, l, buoc_id=buoc, xong=True, phan_doan_so=1, phan_doan_tong=2)
    _cong_viec(db, l, buoc_id=buoc, xong=False, phan_doan_so=2, phan_doan_tong=2)

    assert _nhom_neu_co(svc.can_doi(), g) is not None

    db.query(__import__("app.models.san_xuat", fromlist=["SanXuatCongViec"]).SanXuatCongViec)\
        .filter_by(phan_doan_so=2).update({"trang_thai": "completed"})
    db.commit()

    assert _nhom_neu_co(svc.can_doi(), g) is None, "xong nốt lần 2 thì mới hết việc"


def test_phan_da_cap_cua_buoc_rung_KHONG_troi_sang_buoc_con_lai(db, svc, customer):
    """Lệnh ăn cùng một món ở HAI bước, kho cấp cho bước đầu, bước đầu chạy xong.

    `da_cap` không có chiều bước (phiếu xuất chỉ gắn lệnh — xem `_da_cap_dang_linh`), nên nếu bỏ
    dòng mà không trừ phần của nó thì số đã cấp ấy trôi sang bước sau và dán "đã cấp đủ" lên một
    bước chưa hề nhận hàng.
    """
    # Từ 01/10/2026 giấy chỉ tính ở BƯỚC ĐẦU mỗi mã (bước sau "nhận từ bước trước"), nên ca "cùng
    # một món ở hai bước" dựng bằng vật tư THƯỜNG (mực), không phải giấy.
    g = _giay(db)
    vt = _vat_tu(db)
    l = _lenh(db, customer, ma="LSX-2BUOC", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
              giay_o_buoc=False)
    b1 = _buoc_cua(db, l)
    b2 = _them_buoc(db, l, thu_tu=2, ten="In mặt sau")
    _khai_vat_tu(db, b1, vt, 80)
    _khai_vat_tu(db, b2, vt, 80)
    kho_hang = db.query(KhoHang).first() or KhoHang(ma="K1", ten="Kho test")
    db.add(kho_hang)
    db.flush()
    db.add(StockLot(hang_loai="vat_tu", hang_id=vt.id, kho_id=kho_hang.id, ma_lo="LOT-MUC",
                    sl_ban_dau=1_000, sl_con_lai=1_000, ngay_nhap=HOM_NAY,
                    trang_thai=LOT_AVAILABLE))
    r = StockRequest(ma="DNX-2BUOC", loai=REQ_XUAT, nguoi_tao_id=1, trang_thai=REQ_APPROVED)
    db.add(r)
    db.flush()
    # Kho đã ứng ĐÚNG phần của bước 1 (80), bước 1 chạy xong.
    db.add(StockRequestLine(request_id=r.id, hang_loai="vat_tu", hang_id=vt.id, lsx_id=l.id,
                            dvt="kg", sl_de_nghi=80, sl_duyet=80, sl_da_ung=80))
    db.commit()
    _cong_viec(db, l, buoc_id=b1.id, xong=True)

    nhom = next(x for x in svc.can_doi()["items"]
                if (x["hang_loai"], x["hang_id"]) == ("vat_tu", vt.id))
    dong = nhom["dong"]
    assert len(dong) == 1, "bước 1 đã rụng, chỉ còn bước 2"
    assert dong[0]["da_cap"] == 0, "80 đó tiêu ở bước 1, không phải hàng của bước 2"
    assert dong[0]["con_phai_co"] == 80


# --- GIẤY ĐẾM TỜ × KHỔ (spec 2026-10-01-giay-dem-to-theo-kho §4.3) ------------


def _bai(db, ma, giay, thanh_vien, *, kho_in=(650, 860)) -> BaiGhep:
    bg = BaiGhep(ma=ma, giay_id=giay.id, kho_in_rong=kho_in[0], kho_in_dai=kho_in[1])
    db.add(bg)
    db.flush()
    db.add_all([BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=l.id, so_con_tren_to=1)
                for l in thanh_vien])
    db.commit()
    return bg


def test_giay_so_to_voi_lo_dung_kho(db, svc, customer):
    """Tồn đem so = Σ lô đúng mã + đúng khổ + đúng đơn vị gốc. Lô khổ khác và lô kg khổ rộng không
    cộng vào."""
    g = _giay(db, ma="C-300")
    _ton(db, g, 3_000)                                  # 780 × 905
    _ton(db, g, 9_000, kho=(800, 1_090))
    _ton(db, g, 2_000, goc="kg", kho=(1_000, 0))
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=5_000, han=MAI)

    bang = svc.can_doi()
    nhom = _nhom(bang, g)
    assert (nhom["kho_rong"], nhom["kho_dai"]) == (780, 905)
    assert nhom["ton"] == pytest.approx(3_000)
    assert nhom["tong_can"] == pytest.approx(5_000)
    assert nhom["dong"][0]["thieu"] == pytest.approx(2_000)
    assert nhom["dong"][0]["trang_thai"] == "do"
    # Không nhóm nào khác của mã này — lô 800 × 1090 và lô kg khổ 1000 không đẻ nhu cầu, cũng không bù.
    assert [x for x in bang["items"] if x["hang_id"] == g.id] == [nhom]
    # Lô kg khác KHỔ ⇒ không phải "cùng khổ khác đơn vị".
    assert nhom["cung_kho_khac_don_vi"] == []


def test_cung_kho_khac_don_vi_chi_bay_canh_khong_tru(db, svc, customer):
    """Cùng mã + cùng khổ mà một bên đếm tờ một bên đếm kg (luật 1, chủ chốt 10/10/2026): nhóm tờ
    chỉ ăn lô tờ; tồn kg cùng khổ + hàng kg đang về hiện CẠNH nhóm, máy không trừ chéo."""
    g = _giay(db, ma="C-310")
    _ton(db, g, 1_000)                                  # 1.000 tờ 780 × 905
    _ton(db, g, 600, goc="kg")                          # 600 kg cùng khổ 780 × 905
    _phieu_mua(db, hang=("giay", g.id), so_luong=250, unit="kg", ngay_ve=MAI)
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=3_000, han=MAI)

    bang = svc.can_doi()
    nhom = _nhom(bang, g)
    assert nhom["don_vi_goc"] == "to"
    assert nhom["ton"] == pytest.approx(1_000)
    assert nhom["dong"][0]["thieu"] == pytest.approx(2_000), "kg không được trừ vào số tờ thiếu"
    assert nhom["cung_kho_khac_don_vi"] == [
        {"don_vi_goc": "kg", "don_vi_goc_ten": nhom["cung_kho_khac_don_vi"][0]["don_vi_goc_ten"],
         "ton": pytest.approx(600), "dang_ve": pytest.approx(250)}]
    # Không có nhu cầu kg nên không có nhóm kg.
    assert [x["don_vi_goc"] for x in bang["items"] if x["hang_id"] == g.id] == ["to"]


def test_hai_lenh_khac_kho_cung_ma_la_hai_nhom(db, svc, customer):
    g = _giay(db, ma="C-300")
    _ton(db, g, 1_000)
    _ton(db, g, 4_000, kho=(905, 780))                  # cùng khổ, ghi ngược cạnh ⇒ vẫn cùng khoá
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=2_000, han=MAI)
    _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=3_000, han=MAI,
          kho=(1_090, 800))

    bang = svc.can_doi()
    a, b = _nhom(bang, g), _nhom(bang, g, kho=(800, 1_090))
    assert [d["ma"] for d in a["dong"]] == ["LSX-A"]
    assert [d["ma"] for d in b["dong"]] == ["LSX-B"]
    assert a["ton"] == pytest.approx(5_000) and a["dong"][0]["trang_thai"] == "xanh"
    assert b["ton"] == 0 and b["dong"][0]["thieu"] == pytest.approx(3_000)


def test_giay_bai_ghep_lay_kho_nguyen_cua_bai_va_to_nguyen_can(db, svc, customer):
    g = _giay(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
              giay_o_buoc=False)
    b = _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
              giay_o_buoc=False)
    bg = _bai(db, "GB-KHO", g, [a, b])
    so_to = svc._tinh_so_to(bg, {a.id: a, b.id: b})
    assert so_to["to_nguyen_can"] > 0

    dong = _nhom(svc.can_doi(), g)["dong"]               # khổ nguyên 780 × 905 của thành viên
    assert [d["ma"] for d in dong] == ["GB-KHO"]
    assert dong[0]["nhu_cau"] == pytest.approx(so_to["to_nguyen_can"])


def test_giay_bai_ghep_thieu_kho_nguyen_lay_kho_in_va_tong_to(db, svc, customer):
    g = _giay(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
              giay_o_buoc=False, kho=None)
    b = _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
              giay_o_buoc=False, kho=None)
    bg = _bai(db, "GB-IN", g, [a, b], kho_in=(860, 650))
    so_to = svc._tinh_so_to(bg, {a.id: a, b.id: b})
    assert so_to["tong_to"] > 0

    dong = _nhom(svc.can_doi(), g, kho=(650, 860))["dong"]
    assert [d["ma"] for d in dong] == ["GB-IN"]
    assert dong[0]["nhu_cau"] == pytest.approx(so_to["tong_to"])


def test_hang_dang_ve_chi_tinh_dong_mua_dung_kho(db, svc, customer):
    """Đơn mua 790 × 1090 không bù cho nhu cầu 800 × 1090 — so khổ bằng nhau tuyệt đối."""
    g = _giay(db)
    _phieu_mua(db, hang=("giay", g.id), so_luong=5_000, ngay_ve=MAI, kho=(790, 1_090))
    _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=1_000, han=MAI,
          kho=(800, 1_090))

    bang = svc.can_doi()
    dong = _nhom(bang, g, kho=(800, 1_090))["dong"][0]
    assert dong["trang_thai"] == "do"
    assert dong["thieu"] == pytest.approx(1_000)
    assert _nhom(bang, g, kho=(800, 1_090))["phieu_mua"] == []

    _phieu_mua(db, hang=("giay", g.id), so_luong=1_000, ngay_ve=MAI, kho=(1_090, 800))
    assert _nhom(svc.can_doi(), g, kho=(800, 1_090))["dong"][0]["trang_thai"] == "vang"


def test_de_nghi_mua_mang_kho_can(db, svc, customer):
    """Hai khổ của cùng mã ⇒ hai dòng yêu cầu mua, mỗi dòng mang khổ cần + đơn vị tờ nguyên."""
    g = _giay(db)
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=2_000, han=MAI)
    b = _lenh(db, customer, ma="LSX-B", giay_id=g.id, so_to_nguyen=3_000, han=MAI,
              kho=(800, 1_090))
    gom = svc.gom_de_nghi([
        {"hang_loai": "giay", "hang_id": g.id, "kho_rong": 905, "kho_dai": 780,
         "lsx_id": a.id, "bai_ghep_id": None, "buoc_id": _buoc_dau(db, a).id},
        {"hang_loai": "giay", "hang_id": g.id, "kho_rong": 800, "kho_dai": 1_090,
         "lsx_id": b.id, "bai_ghep_id": None, "buoc_id": _buoc_dau(db, b).id},
    ])
    assert sorted((ln["kho_rong"], ln["kho_dai"], ln["quantity"], ln["unit"])
                  for ln in gom["lines"]) == [
        (780, 905, 2_000, don_vi_goc_to()), (800, 1_090, 3_000, don_vi_goc_to()),
    ]


def test_de_nghi_mua_tao_ycmh_co_kho(client, db, svc, customer):
    """Đường thật: tick dòng giấy trên bảng cân đối → POST /de-nghi-mua ⇒ YCMH có dòng mang khổ cần."""
    g = _giay(db)
    s = Supplier(name="NCC giấy khổ", status="active")
    db.add(s)
    db.flush()
    db.add(SupplierItem(supplier_id=s.id, hang_loai="giay", hang_id=g.id,
                        item_name=g.ten, unit="kg", unit_price=1))
    db.commit()
    a = _lenh(db, customer, ma="LSX-A", giay_id=g.id, so_to_nguyen=2_000, han=MAI,
              kho=(800, 1_090))
    resp = client.post(
        "/api/ke-hoach-vat-tu/de-nghi-mua",
        json={"dong": [{"hang_loai": "giay", "hang_id": g.id, "kho_rong": 800, "kho_dai": 1_090,
                        "lsx_id": a.id, "bai_ghep_id": None, "buoc_id": _buoc_dau(db, a).id}],
              "needed_date": (HOM_NAY + timedelta(days=5)).isoformat()},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )
    assert resp.status_code == 201, resp.text
    yc = client.get(f"/api/department-purchase-requests/{resp.json()['id']}",
                    headers={"Authorization": f"Bearer {_admin_token()}"}).json()
    assert [(ln["kho_rong"], ln["kho_dai"], ln["quantity"]) for ln in yc["lines"]] == [
        (800, 1_090, 2_000)]

