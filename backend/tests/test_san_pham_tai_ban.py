"""Sản phẩm tái bản + thành phẩm THUỘC VỀ KHÁCH (11/10/2026, mg 0394).

Chốt đơn gắn mỗi cụm bán vào một mã thành phẩm của khách (tái bản đã chọn, hoặc mã mới) và chụp
cấu hình kỹ thuật vào chính mã đó; ô tái bản chỉ hiện mã của khách đầu phiếu.

Service-level tests, cùng phong cách `test_orders_api.py`: dựng DB in-memory, chạy OrderService
thật cho phần chốt đơn, gọi thẳng `san_pham_tai_ban_service` cho phần tìm/đọc chi tiết.
"""
from __future__ import annotations

import pytest

from tests.conftest import phien_da_seed

from app.models.customer import Customer
from app.models.phieu_tinh_gia import (
    PhieuBuocVatTu, PhieuChiPhiKhac, PhieuThanhPham, PhieuThanhPhan, PhieuTinhGia,
)
from app.models.order import Order
from app.models.vat_lieu_kho import VatTuInAn
from app.models.quotation import STATUS_ACCEPTED, Quote, QuoteItem, QuoteVersion
from app.models.user import User
from app.repositories.accounting_repo import AccountingRepository
from app.repositories.audit_repo import AuditLogRepository
from app.repositories.document_sequence_repo import DocumentSequenceRepository
from app.repositories.order_repo import OrderRepository
from app.repositories.purchase_repo import PurchaseRequestRepository, SupplierRepository
from app.repositories.quotation_repo import QuotationRepository
from app.repositories.user_repo import UserRepository
from app.schemas.order import OrderCreate, OrderDepositReceiptIn, OrderUpdate
from app.services import san_pham_tai_ban_service
from app.services.accounting_service import AccountingService
from app.services.order_service import OrderService, OrderValidationError
from app.services.sequence_service import SequenceService
from datetime import date


@pytest.fixture
def db():
    yield from phien_da_seed()


@pytest.fixture
def admin(db):
    return db.query(User).filter(User.username == "admin").first()


@pytest.fixture
def svc(db):
    audit = AuditLogRepository(db)
    accounting_repo = AccountingRepository(db)
    accounting = AccountingService(
        accounting_repo,
        PurchaseRequestRepository(db),
        SupplierRepository(db),
        UserRepository(db),
        audit,
        SequenceService(DocumentSequenceRepository(db)),
    )
    return OrderService(
        OrderRepository(db), audit, QuotationRepository(db), db, accounting_repo, accounting
    )


def _customer(db, code="KH-T"):
    c = Customer(code=code, name=f"KH {code}")
    db.add(c)
    db.commit()
    return c


_ma_seq = 0


def _thanh_phan(db, *, ten="Card visit 350gsm", giay_id=101, may_id=201, phi_giao_hang=0,
                chi_phi_khac: list[tuple[str, float]] | None = None) -> PhieuThanhPhan:
    """Dựng 1 PhieuTinhGia + 1 PhieuThanhPhan (kèm 2 công đoạn + 1 vật tư) — nguồn để snapshot."""
    global _ma_seq
    _ma_seq += 1
    p = PhieuTinhGia(ma=f"PTG-T-{_ma_seq:04d}", ten_san_pham=ten, so_luong=1000)
    db.add(p)
    db.flush()
    tp = PhieuThanhPhan(
        phieu_id=p.id, thu_tu=0, loai_thanh_phan="to_roi", ten=ten,
        dai_thanh_pham=90, rong_thanh_pham=54, so_luong=1000, don_vi_tinh="cái",
        giay_id=giay_id, kho_nguyen="65x86", kho_nguyen_dai=650, kho_nguyen_rong=860,
        don_gia_giay=25000, don_gia_don_vi="to", nguon_giay="cong_ty",
        co_in=True, quy_cach_in="hai_mat", kho_in_dai=430, kho_in_rong=650,
        so_con=8, con_auto=True, may_id=may_id, don_gia_cong_in=500,
        muc_a=["C", "M", "Y", "K"], muc_b=["C", "M", "Y", "K"],
        so_mau_a=4, so_mau_b=4, gia_von_tp=1_234_000, phi_giao_hang=phi_giao_hang,
    )
    db.add(tp)
    db.flush()
    tp.thanh_phams.append(PhieuThanhPham(
        thanh_phan_id=tp.id, thu_tu=1, cong_doan_id=301, ten="Cán màng", don_gia=200,
        so_mat=1, phi_khuon=0, ghi_chu="mờ",
    ))
    tp.thanh_phams.append(PhieuThanhPham(
        thanh_phan_id=tp.id, thu_tu=0, cong_doan_id=300, ten="Cắt xén", don_gia=100,
        so_mat=1, phi_khuon=50_000,
    ))
    # Vật tư thuộc BƯỚC (01/10/2026): gắn vào bước "Cắt xén" (thu_tu 0).
    next(f for f in tp.thanh_phams if f.ten == "Cắt xén").vat_tus.append(
        PhieuBuocVatTu(thu_tu=0, vat_tu_id=401, gia_tri_chip={"dai_support": 5}))
    for i, (ten_cp, tien_cp) in enumerate(chi_phi_khac or []):
        tp.chi_phi_khacs.append(PhieuChiPhiKhac(
            thanh_phan_id=tp.id, thu_tu=i, ten=ten_cp, so_tien=tien_cp))
    db.commit()
    db.refresh(tp)
    return tp


def _quote_for(db, customer, tp: PhieuThanhPhan | None, *, qty=1000) -> Quote:
    q = Quote(quote_number=f"BG-{tp.id if tp else 'X'}-{customer.id}", customer_id=customer.id, status=STATUS_ACCEPTED)
    db.add(q)
    db.flush()
    v = QuoteVersion(quote_id=q.id, version_number=1, vat_percent=8)
    db.add(v)
    db.flush()
    q.current_version_id = v.id
    db.add(QuoteItem(
        quote_version_id=v.id, line_no=1, product_type="tr", product_name=tp.ten if tp else "SP tay",
        quantity=qty, unit="cái", selling_price=1_000_000, discount_amount=0,
        unit_price=1_000_000 / qty, vat_percent=8, vat_amount=80_000,
        final_amount=1_080_000, total_cost_snapshot=600_000, margin_percent=20,
        phieu_thanh_phan_id=tp.id if tp else None,
    ))
    db.commit()
    return q


def _confirm_ready_order(svc, db, admin, quote):
    d = svc.create(actor=admin, scope="all", payload=OrderCreate(quotation_id=quote.id))
    svc.add_deposit_receipt(order_id=d.id, actor=admin, scope="all",
                             payload=OrderDepositReceiptIn(receipt_method="bank_transfer", amount=1_080_000))
    svc.update(order_id=d.id, actor=admin, scope="all",
               payload=OrderUpdate(customer_po_no="PO1", delivery_committed_date=date.today()))
    return d


def _quote_nhieu(db, customer, tps: list[PhieuThanhPhan], *, nhom: str | None = None, qty=1000,
                 so: str = "") -> Quote:
    """Báo giá nhiều dòng; `nhom` cho mọi dòng ⇒ một cụm bán (ruột + bìa một cuốn)."""
    q = Quote(quote_number=f"BG-N{so}-{customer.id}-{tps[0].id}", customer_id=customer.id,
              status=STATUS_ACCEPTED)
    db.add(q)
    db.flush()
    v = QuoteVersion(quote_id=q.id, version_number=1, vat_percent=8)
    db.add(v)
    db.flush()
    q.current_version_id = v.id
    for i, tp in enumerate(tps, start=1):
        db.add(QuoteItem(
            quote_version_id=v.id, line_no=i, product_type="tr", product_name=tp.ten,
            quantity=qty, unit="cái", selling_price=500_000, discount_amount=0,
            unit_price=500, vat_percent=8, vat_amount=40_000, final_amount=540_000,
            total_cost_snapshot=300_000, margin_percent=20, phieu_thanh_phan_id=tp.id, nhom=nhom,
        ))
    db.commit()
    return q


def _chot(svc, db, admin, quote):
    d = _confirm_ready_order(svc, db, admin, quote)
    svc.confirm(order_id=d.id, actor=admin, scope="all")
    return db.get(Order, d.id)


def _ma_cua_don(order) -> set[int]:
    return {ln.thanh_pham_id for ln in order.lines}


# ------------------------------------------------ chốt đơn: gắn mã + chụp cấu hình vào mã


def test_chot_don_gan_ma_cua_khach_va_chup_cau_hinh(svc, admin, db):
    cust = _customer(db)
    tp = _thanh_phan(db)
    o = _chot(svc, db, admin, _quote_for(db, cust, tp))
    assert o.status == "ordered"
    (ma_id,) = _ma_cua_don(o)
    ma = db.get(VatTuInAn, ma_id)
    assert ma.la_thanh_pham and ma.customer_id == cust.id
    (cfg,) = ma.cau_hinh_tai_ban
    assert cfg["ten"] == tp.ten
    assert cfg["giay_id"] == 101 and cfg["may_id"] == 201
    assert cfg["muc_a"] == ["C", "M", "Y", "K"]
    # Công đoạn giữ ĐÚNG THỨ TỰ (thu_tu 0 rồi 1), dù insert ngược.
    assert [c["ten"] for c in cfg["thanh_phams"]] == ["Cắt xén", "Cán màng"]
    assert cfg["thanh_phams"][0]["vat_tus"][0]["gia_tri_chip"] == {"dai_support": 5}
    # KHÔNG lưu: SL của đơn cũ, giá vốn, số dẫn xuất, và dấu tái bản của thẻ nguồn.
    assert cfg.get("so_luong") is None and cfg.get("so_to_per_sp") is None
    assert cfg.get("so_mau_a") is None
    assert "tai_ban_thanh_pham_id" not in cfg
    assert ma.tai_ban_luc is not None


def test_ruot_bia_MOT_cum_la_MOT_ma_chup_du_hai_thanh_phan(svc, admin, db):
    """Tái bản ở cấp MÓN BÁN: chọn "Sách" là nạp đủ ruột + bìa, nên mã phải giữ cả hai."""
    cust = _customer(db)
    ruot = _thanh_phan(db, ten="Ruột sách", giay_id=101)
    bia = _thanh_phan(db, ten="Bìa sách", giay_id=102)
    o = _chot(svc, db, admin, _quote_nhieu(db, cust, [ruot, bia], nhom="Sách A5 64 trang"))
    (ma_id,) = _ma_cua_don(o)
    ma = db.get(VatTuInAn, ma_id)
    assert ma.ten == "Sách A5 64 trang"
    assert [c["ten"] for c in ma.cau_hinh_tai_ban] == ["Ruột sách", "Bìa sách"]


def test_HAI_KHACH_cung_ten_la_HAI_ma(svc, admin, db):
    """⭐ 11/10/2026: hàng in riêng cho khách nào là của khách đó — trùng tên vẫn là hai mã, không
    thì kho giao hộp in logo khách A cho khách B."""
    a, b = _customer(db, "KH-A"), _customer(db, "KH-B")
    o1 = _chot(svc, db, admin, _quote_for(db, a, _thanh_phan(db, ten="Tờ rơi A5")))
    o2 = _chot(svc, db, admin, _quote_for(db, b, _thanh_phan(db, ten="Tờ rơi A5")))
    assert _ma_cua_don(o1) != _ma_cua_don(o2)


def test_CUNG_DON_hai_cum_cung_ten_la_MOT_ma(svc, admin, db):
    """Ruột + bìa cùng nhãn mà khác SL là hai cụm cùng tên — vẫn là MỘT món, một mã."""
    cust = _customer(db)
    q = _quote_nhieu(db, cust, [_thanh_phan(db, ten="Ruột"), _thanh_phan(db, ten="Bìa")],
                     nhom="Kỷ yếu 2027")
    q_items = sorted(db.get(QuoteVersion, q.current_version_id).items, key=lambda x: x.line_no)
    q_items[1].quantity = 1_200
    db.commit()
    o = _chot(svc, db, admin, q)
    from app.services.thanh_pham_khai_bao import cum_ban

    assert len(cum_ban(o)) == 2 and len(_ma_cua_don(o)) == 1


def test_cung_khach_KHONG_gan_tai_ban_la_san_pham_MOI(svc, admin, db):
    """Danh tính do người lập phiếu CHỌN, không đoán bằng tên: không chọn tái bản = sản phẩm mới."""
    cust = _customer(db)
    o1 = _chot(svc, db, admin, _quote_for(db, cust, _thanh_phan(db, ten="Lịch bàn 2027")))
    o2 = _chot(svc, db, admin, _quote_nhieu(db, cust, [_thanh_phan(db, ten="Lịch bàn 2027")], so="2"))
    assert _ma_cua_don(o1) != _ma_cua_don(o2)


def test_cung_khach_GAN_tai_ban_dung_lai_ma_va_cap_nhat_cau_hinh(svc, admin, db):
    cust = _customer(db)
    o1 = _chot(svc, db, admin, _quote_for(db, cust, _thanh_phan(db, ten="Hộp trà", giay_id=101)))
    (ma_id,) = _ma_cua_don(o1)
    lai = _thanh_phan(db, ten="Hộp trà (in lại)", giay_id=102)
    lai.tai_ban_thanh_pham_id = ma_id
    db.commit()
    o2 = _chot(svc, db, admin, _quote_nhieu(db, cust, [lai], so="2"))
    assert _ma_cua_don(o2) == {ma_id}
    db.refresh(db.get(VatTuInAn, ma_id))
    assert db.get(VatTuInAn, ma_id).cau_hinh_tai_ban[0]["giay_id"] == 102   # cấu hình lần chốt SAU


def test_gan_tai_ban_vao_ma_KHACH_KHAC_thi_chan_chot(svc, admin, db):
    a, b = _customer(db, "KH-A"), _customer(db, "KH-B")
    o1 = _chot(svc, db, admin, _quote_for(db, a, _thanh_phan(db, ten="Hộp A")))
    (ma_a,) = _ma_cua_don(o1)
    nham = _thanh_phan(db, ten="Hộp A")
    nham.tai_ban_thanh_pham_id = ma_a
    db.commit()
    d = _confirm_ready_order(svc, db, admin, _quote_nhieu(db, b, [nham], so="b"))
    with pytest.raises(OrderValidationError, match="không thuộc khách"):
        svc.confirm(order_id=d.id, actor=admin, scope="all")
    assert svc.get(order_id=d.id, actor=admin, scope="all").status == "draft"


def test_dong_nhap_tay_cung_khach_cung_ten_dung_lai_ma(svc, admin, db):
    """Dòng nhập tay không có ô tái bản để chọn ⇒ tìm theo (khách, tên)."""
    cust = _customer(db)
    q1 = _quote_for(db, cust, None)
    q1.quote_number = "BG-tay-1"
    db.commit()
    o1 = _chot(svc, db, admin, q1)
    o2 = _chot(svc, db, admin, _quote_for(db, cust, None))
    assert _ma_cua_don(o1) == _ma_cua_don(o2)


def test_don_CU_chua_co_dau_van_tim_ra_ma_theo_khach_va_ten(svc, admin, db):
    from app.services.thanh_pham_khai_bao import cum_ban, thanh_pham_cua_cum

    cust = _customer(db)
    o = _chot(svc, db, admin, _quote_for(db, cust, _thanh_phan(db, ten="Nhãn chai")))
    (ma_id,) = _ma_cua_don(o)
    for ln in o.lines:
        ln.thanh_pham_id = None          # đơn chốt trước 11/10/2026
    db.commit()
    (cum,) = cum_ban(o)
    assert thanh_pham_cua_cum(db, o, cum).id == ma_id


def test_confirm_rejects_and_rolls_back_when_source_deleted(svc, admin, db):
    cust = _customer(db)
    tp = _thanh_phan(db, ten="Sẽ bị xoá")
    d = _confirm_ready_order(svc, db, admin, _quote_for(db, cust, tp))
    db.delete(tp)
    db.commit()
    with pytest.raises(OrderValidationError):
        svc.confirm(order_id=d.id, actor=admin, scope="all")
    assert svc.get(order_id=d.id, actor=admin, scope="all").status == "draft"


# ------------------------------------------------------------- ô tái bản: chỉ hàng của khách


def test_goi_y_CHI_tra_ma_cua_khach_ke_ca_ma_chua_co_cau_hinh(svc, admin, db):
    a, b = _customer(db, "KH-A"), _customer(db, "KH-B")
    _chot(svc, db, admin, _quote_for(db, a, _thanh_phan(db, ten="Áo thun cotton")))
    _chot(svc, db, admin, _quote_for(db, b, _thanh_phan(db, ten="Áo thun cotton")))
    tay = VatTuInAn(ma="TP-TAY-1", ten="Áo khoác gió", la_thanh_pham=True, customer_id=a.id, don_gia=0)
    db.add(tay)
    db.commit()

    goi_y = san_pham_tai_ban_service.tim_kiem(db, a.id, "ao")     # gõ KHÔNG dấu
    assert sorted(r["ten"] for r in goi_y) == ["Áo khoác gió", "Áo thun cotton"]
    assert {r["ten"]: r["so_thanh_phan"] for r in goi_y} == {"Áo thun cotton": 1, "Áo khoác gió": 0}
    # Mã đã chốt lên trước mã chưa từng chốt.
    assert goi_y[0]["ten"] == "Áo thun cotton"

    ma = next(r for r in goi_y if r["ten"] == "Áo thun cotton")
    chi_tiet = san_pham_tai_ban_service.lay_chi_tiet(db, a.id, ma["id"])
    assert chi_tiet["ma"] == ma["ma"] and chi_tiet["thanh_phans"][0]["giay_id"] == 101
    assert san_pham_tai_ban_service.lay_chi_tiet(db, b.id, ma["id"]) is None   # khách khác


def test_cau_hinh_giu_phi_giao_hang_chi_phi_khac_va_nguon_khuon(svc, admin, db):
    """Tái bản nạp lại NGUYÊN cấu hình — bỏ sót phí giao, chi phí khác hay câu trả lời "khuôn có
    sẵn / làm mới" thì đơn tái bản tự nhiên rẻ đi hoặc mất lựa chọn mà không ai được báo."""
    cust = _customer(db, code="KH-GH")
    tp = _thanh_phan(db, ten="Hộp giao tận nơi", phi_giao_hang=750_000,
                     chi_phi_khac=[("làm kẽm", 800_000), ("phí thiết kế", 1_500_000)])
    tp.thanh_phams[0].khuon_nguon = "lam_moi"
    tp.thanh_phams[1].khuon_nguon = "co_san"
    db.commit()
    o = _chot(svc, db, admin, _quote_for(db, cust, tp))
    (cfg,) = db.get(VatTuInAn, next(iter(_ma_cua_don(o)))).cau_hinh_tai_ban
    assert cfg["phi_giao_hang"] == 750_000
    assert [(c["ten"], c["so_tien"]) for c in cfg["chi_phi_khacs"]] == [
        ("làm kẽm", 800_000), ("phí thiết kế", 1_500_000)]
    assert [(c["ten"], c["khuon_nguon"]) for c in cfg["thanh_phams"]] == [
        ("Cắt xén", "lam_moi"), ("Cán màng", "co_san")]


def _chuan(v):
    """Numeric của DB về float để so với JSON của ảnh chụp."""
    from decimal import Decimal

    return float(v) if isinstance(v, Decimal) else v


def _so_du_o(cfg: dict, nguon, schema, bo_qua: set[str], cap: str) -> None:
    for ten_o in schema.model_fields:
        if ten_o in bo_qua:
            continue
        gia_tri = _chuan(getattr(nguon, ten_o))
        # Ô mới thêm vào schema mà test chưa điền thì nguồn là None, ảnh chụp bỏ sót cũng ra None —
        # so bằng nhau là lọt. Bắt người thêm cột điền giá trị ở đây.
        assert gia_tri is not None, f"{cap}.{ten_o}: điền giá trị khác None cho ô này trong test"
        assert cfg.get(ten_o) == gia_tri, f"ảnh chụp tái bản bỏ sót {cap}.{ten_o}"


def test_snapshot_chep_du_moi_o_nhap(db):
    """Chặn tái phát: hàm chụp liệt kê TAY từng ô, nên thêm ô nhập mới mà quên chép là tái bản
    nạp thiếu im lặng (đã xảy ra với `khuon_nguon`, thêm 04/09 sau khi hàm chụp viết 30/08).
    Test đi theo schema đầu vào: schema có ô nào thì ảnh chụp phải có đúng giá trị ô đó, trừ các
    ô CỐ Ý bỏ (số lượng của đơn cũ + số dẫn xuất engine tự tính lại)."""
    p = PhieuTinhGia(ma="PTG-T-DU-O", ten_san_pham="Hộp đủ ô", so_luong=1000)
    db.add(p)
    db.flush()
    tp = PhieuThanhPhan(
        phieu_id=p.id, thu_tu=0, loai_thanh_phan="hop", ten="Hộp đủ ô",
        dai_thanh_pham=90.5, rong_thanh_pham=54.5, so_trang=4, trang_moi_tay=2, so_luong=1000,
        don_vi_tinh="hộp", nhom_bao_gia="Bộ hộp", dvt_nhom="bộ",
        giay_id=101, song_id=102, kho_nguyen="65x86", kho_nguyen_dai=650, kho_nguyen_rong=860,
        don_gia_giay=25000, don_gia_don_vi="kg", nguon_giay="khach", chua_nhip=12,
        bleed_mm=3, khe_cat_mm=2, co_in=False, che_ban_loai="ctp", che_ban_don_gia=150_000,
        quy_cach_in="tu_tro", kho_in_dai=430, kho_in_rong=650, so_con=8, con_auto=False,
        may_id=201, don_gia_cong_in=500, muc_a=["C", "M"], muc_b=["K"],
        ghi_chu_ky_thuat="canh màu như mẫu", phi_giao_hang=750_000,
    )
    db.add(tp)
    db.flush()
    tp.thanh_phams.append(PhieuThanhPham(
        thanh_phan_id=tp.id, thu_tu=0, cong_doan_id=300, ten="Bế", don_gia=100, bu_hao=True,
        so_mat=2, so_vi_tri=3, dien_tich=12.5, nha_cung_cap="Xưởng khuôn A", ghi_chu="dao sắc",
        phi_khuon=800_000, khuon_nguon="lam_moi",
    ))
    tp.thanh_phams[0].vat_tus.append(PhieuBuocVatTu(
        thu_tu=0, vat_tu_id=401, gia_tri_chip={"dai_support": 5, "rong_support": 6}))
    tp.chi_phi_khacs.append(PhieuChiPhiKhac(thanh_phan_id=tp.id, thu_tu=0, ten="làm kẽm", so_tien=800_000))
    db.commit()
    db.refresh(tp)

    from app.schemas.phieu_tinh_gia import BuocVatTuIn, ChiPhiKhacIn, ThanhPhamIn, ThanhPhanIn

    cfg = san_pham_tai_ban_service.cau_hinh_tu_thanh_phan(tp)
    _so_du_o(cfg, tp, ThanhPhanIn, {
        "thu_tu", "so_luong", "so_to_per_sp", "so_mau_a", "so_mau_b", "so_mau_pha",
        "thanh_phams", "chi_phi_khacs", "tai_ban_thanh_pham_id",
    }, "san_pham")
    # `so_luong` của bước/vật tư: "0 = dùng SL đặt" — cùng lẽ SL của đơn cũ, màn Tính giá cũng không
    # có ô nào sửa nó.
    _so_du_o(cfg["thanh_phams"][0], tp.thanh_phams[0], ThanhPhamIn, {"thu_tu", "so_luong", "vat_tus"}, "cong_doan")
    _so_du_o(cfg["thanh_phams"][0]["vat_tus"][0], tp.thanh_phams[0].vat_tus[0], BuocVatTuIn, {"thu_tu"}, "vat_tu")
    _so_du_o(cfg["chi_phi_khacs"][0], tp.chi_phi_khacs[0], ChiPhiKhacIn, {"thu_tu"}, "chi_phi_khac")
