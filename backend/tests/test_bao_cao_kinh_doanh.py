"""Báo cáo kinh doanh theo khách hàng (24/09/2026).

Chủ chốt: chỉ ĐƠN ĐÃ CHỐT, vào kỳ theo NGÀY CHỐT (giờ VN), phạm vi theo ô quyền riêng
`bao_cao_kinh_doanh` (sale `own` chỉ thấy đơn mình bán). Mỗi khách → đơn → dòng sản phẩm (đơn giá)
+ cọc phải thu / đã nhận của từng đơn. Xuất Excel được mọi khách hoặc đúng một khách.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from io import BytesIO

from openpyxl import load_workbook

from app.db import SessionLocal
from app.models.accounting import PAYMENT_RECEIPT_RECEIVED, RECEIPT_SOURCE_ORDER, PaymentReceipt
from app.models.customer import Customer
from app.models.order import Order, OrderLine
from app.models.user import User
from app.repositories.rbac_repo import DepartmentRepository, RoleRepository
from app.repositories.user_repo import UserRepository
from app.security import create_access_token, hash_password

URL = "/api/bao-cao-kinh-doanh"
VN = timezone(timedelta(hours=7))


def _h(client) -> dict[str, str]:
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _khach(ten: str, ma: str) -> int:
    db = SessionLocal()
    try:
        k = Customer(code=ma, name=ten)
        db.add(k)
        db.commit()
        return k.id
    finally:
        db.close()


def _don(khach_id: int, so: str, *, chot_luc: datetime | None, status: str = "ordered",
         coc_pct: float | None = 30, sale_id: int | None = None,
         dong=(("Hộp giấy in 4 màu", 1000, 2500),)) -> int:
    db = SessionLocal()
    try:
        o = Order(order_no=so, customer_id=khach_id, status=status, ordered_at=chot_luc,
                  deposit_pct=coc_pct, sale_user_id=sale_id, customer_po_no=f"PO-{so}")
        for ten, sl, gia in dong:
            o.lines.append(OrderLine(description=ten, qty=sl, don_vi_tinh="cái",
                                     unit_price_snapshot=gia, line_total=sl * gia,
                                     vat_pct_estimate=8))
        db.add(o)
        db.commit()
        return o.id
    finally:
        db.close()


def _coc(order_id: int, tien: int) -> None:
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").one()
        db.add(PaymentReceipt(
            code=f"PT-BCKD-{order_id}-{tien}", source_type=RECEIPT_SOURCE_ORDER,
            order_id=order_id, payer_name="Khách", receipt_method="cash",
            status=PAYMENT_RECEIPT_RECEIVED, receipt_date=date.today(), amount=tien,
            amount_vnd=tien, currency="VND", exchange_rate=1, content="Cọc đơn",
            created_by_user_id=admin.id, received_by_user_id=admin.id,
        ))
        db.commit()
    finally:
        db.close()


def _luc(y, m, d, h=10) -> datetime:
    """Giờ VN → lưu UTC, y như app (`ordered_at = datetime.now(timezone.utc)`). SQLite của test so
    chuỗi, nên ghi lệch múi giờ với tham số truy vấn là so sai — Postgres thì không bị."""
    return datetime(y, m, d, h, tzinfo=VN).astimezone(timezone.utc)


def test_gom_theo_khach_don_dong_va_coc(client):
    kh = _khach("Công ty BCKD Alpha", "KH-BCKD-A")
    d1 = _don(kh, "DH-BCKD-1", chot_luc=_luc(2026, 9, 5),
              dong=(("Hộp cứng", 1000, 2500), ("Tem nhãn", 2000, 300)))   # 3.100.000
    _coc(d1, 500_000)
    _don(kh, "DH-BCKD-NHAP", chot_luc=None, status="draft")               # nháp: không vào
    _don(kh, "DH-BCKD-HUY", chot_luc=_luc(2026, 9, 6), status="cancelled")  # hủy: không vào
    _don(kh, "DH-BCKD-NGOAI", chot_luc=_luc(2026, 10, 1))                 # ngoài kỳ
    # Chốt 23:30 giờ VN ngày 30/09 = 16:30 UTC — vẫn là ngày 30/09, phải VÀO kỳ tháng 9.
    _don(kh, "DH-BCKD-KHUYA", chot_luc=_luc(2026, 9, 30, 23), dong=(("Túi giấy", 10, 1000),))

    r = client.get(URL, params={"tu_ngay": "2026-09-01", "den_ngay": "2026-09-30"}, headers=_h(client))
    assert r.status_code == 200, r.text
    k = next(x for x in r.json()["khach"] if x["ma"] == "KH-BCKD-A")
    assert [d["order_no"] for d in k["don"]] == ["DH-BCKD-1", "DH-BCKD-KHUYA"]
    d = k["don"][0]
    assert [(ln["ten"], ln["so_luong"], ln["don_gia"], ln["thanh_tien"]) for ln in d["dong"]] == [
        ("Hộp cứng", 1000, 2500, 2_500_000), ("Tem nhãn", 2000, 300, 600_000)]
    assert d["tong"] == 3_100_000 and d["tong_vat"] == 3_348_000          # VAT 8%
    assert d["coc_pct"] == 30 and d["coc_phai_thu"] == 1_004_400          # 30% × có VAT
    assert (d["coc_da_nhan"], d["coc_con_thieu"]) == (500_000, 504_400)
    assert d["ngay_chot"] == "2026-09-05"
    assert k["so_don"] == 2 and k["tong"] == 3_110_000


def test_xuat_excel_mot_khach(client):
    ka = _khach("Công ty BCKD Beta", "KH-BCKD-B")
    kb = _khach("Công ty BCKD Gamma", "KH-BCKD-G")
    _don(ka, "DH-BCKD-B1", chot_luc=_luc(2026, 8, 10))
    _don(kb, "DH-BCKD-G1", chot_luc=_luc(2026, 8, 11))
    r = client.get(f"{URL}/export.xlsx",
                   params={"tu_ngay": "2026-08-01", "den_ngay": "2026-08-31", "customer_id": ka},
                   headers=_h(client))
    assert r.status_code == 200, r.text
    assert "bao-cao-kinh-doanh-KH-BCKD-B-2026-08-01" in r.headers["content-disposition"]
    ws = load_workbook(BytesIO(r.content)).active
    chu = [str(v) for row in ws.iter_rows(values_only=True) for v in row if v is not None]
    assert any("KH-BCKD-B" in c for c in chu)
    assert not any("KH-BCKD-G" in c for c in chu), "xuất một khách thì không lẫn khách khác"
    assert "DH-BCKD-B1" in chu and "Hộp giấy in 4 màu" in chu
    assert ws["D4"].value == "Sản phẩm" and ws["G4"].value == "Đơn giá"
    assert ws["L4"].value == "Cọc phải thu" and ws["M4"].value == "Cọc đã nhận"


def test_sale_pham_vi_cua_toi_chi_thay_don_minh_ban(client):
    db = SessionLocal()
    try:
        kd = DepartmentRepository(db).get_by_name("Kinh doanh")
        vai = RoleRepository(db).get_by_name_and_department("NV Sales", kd.id)
        users = UserRepository(db)
        u = users.create(username="sale-bckd", name="Sale BCKD", password_hash=hash_password("x"))
        users.set_assignment(u, department_id=kd.id, role_id=vai.id, is_active=True)
        sale_id = u.id
    finally:
        db.close()
    kh = _khach("Công ty BCKD Delta", "KH-BCKD-D")
    _don(kh, "DH-BCKD-CUA-TOI", chot_luc=_luc(2026, 7, 5), sale_id=sale_id)
    _don(kh, "DH-BCKD-NGUOI-KHAC", chot_luc=_luc(2026, 7, 6))
    tok = create_access_token(str(sale_id))
    r = client.get(URL, params={"tu_ngay": "2026-07-01", "den_ngay": "2026-07-31"},
                   headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    so = [d["order_no"] for k in r.json()["khach"] for d in k["don"]]
    assert so == ["DH-BCKD-CUA-TOI"]


def test_thieu_quyen_bi_chan_va_khoang_ngay_nguoc(client):
    db = SessionLocal()
    try:
        sx = DepartmentRepository(db).get_by_name("Sản xuất")
        vai = RoleRepository(db).get_by_name_and_department("Thợ SX", sx.id)
        users = UserRepository(db)
        u = users.create(username="tho-bckd", name="Thợ", password_hash=hash_password("x"))
        users.set_assignment(u, department_id=sx.id, role_id=vai.id, is_active=True)
        tok = create_access_token(str(u.id))
    finally:
        db.close()
    r = client.get(URL, params={"tu_ngay": "2026-07-01", "den_ngay": "2026-07-31"},
                   headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403
    r2 = client.get(URL, params={"tu_ngay": "2026-07-31", "den_ngay": "2026-07-01"},
                    headers=_h(client))
    assert r2.status_code == 422


def _bao_gia(so: str, ung: list[bool]) -> int:
    """Báo giá có bản hiện hành gồm len(ung) mặt hàng, cờ khách ưng theo `ung`."""
    from app.models.quotation import Quote, QuoteItem, QuoteVersion

    db = SessionLocal()
    try:
        q = Quote(quote_number=so, status="converted_to_order")
        db.add(q)
        db.flush()
        v = QuoteVersion(quote_id=q.id, version_number=1)
        db.add(v)
        db.flush()
        for i, a in enumerate(ung, 1):
            db.add(QuoteItem(quote_version_id=v.id, line_no=i, product_type="hop",
                             product_name=f"SP {i}", quantity=100, accepted=a))
        q.current_version_id = v.id
        db.commit()
        return q.id
    finally:
        db.close()


def test_ty_le_bao_gia_thanh_cong_moi_don(client):
    kh = _khach("Công ty BCKD Tỷ lệ", "KH-BCKD-TL")
    d_mot_phan = _don(kh, "DH-BCKD-TL1", chot_luc=_luc(2026, 9, 7))
    d_cu = _don(kh, "DH-BCKD-TL2", chot_luc=_luc(2026, 9, 8))
    _don(kh, "DH-BCKD-TL3", chot_luc=_luc(2026, 9, 9))                     # không từ báo giá
    q1 = _bao_gia("BG-TL-1", [True, True] + [False] * 8)                   # báo 10 chốt 2
    q2 = _bao_gia("BG-TL-2", [False, False, False])                        # chốt trước khi có cờ
    db = SessionLocal()
    try:
        db.get(Order, d_mot_phan).quotation_id = q1
        db.get(Order, d_cu).quotation_id = q2
        db.commit()
    finally:
        db.close()

    r = client.get(URL, params={"tu_ngay": "2026-09-01", "den_ngay": "2026-09-30"}, headers=_h(client))
    k = next(x for x in r.json()["khach"] if x["ma"] == "KH-BCKD-TL")
    assert [d["ty_le_bao_gia"] for d in k["don"]] == [20, 100, None]

    x = client.get(f"{URL}/export.xlsx", params={"tu_ngay": "2026-09-01", "den_ngay": "2026-09-30",
                                           "customer_id": kh}, headers=_h(client))
    ws = load_workbook(BytesIO(x.content)).active
    assert ws["O4"].value == "Tỷ lệ báo giá"
    assert [ws[f"O{h}"].value for h in range(6, ws.max_row) if ws[f"A{h}"].value] == ["20%", "100%", None]


def test_nut_loc_tim_coc_va_khoang_tien(client):
    """Nút Lọc (11/10/2026): ô tìm (không dấu, đủ từ — cả tên mặt hàng), tình trạng cọc chọn nhiều,
    khoảng tổng đơn có VAT. Số đếm của "Cọc" tính trên mọi điều kiện KHÁC; KPI theo đơn còn lại."""
    kh = _khach("Công ty BCKD Lọc", "KH-BCKD-L")
    d_thieu = _don(kh, "DH-BCKD-L1", chot_luc=_luc(2026, 8, 3), dong=(("Hộp quà Tết", 100, 10000),))
    _coc(d_thieu, 1000)                                                   # 30% × 1.080.000 chưa đủ
    d_du = _don(kh, "DH-BCKD-L2", chot_luc=_luc(2026, 8, 4), dong=(("Tem nhãn", 10, 1000),))
    _coc(d_du, 3240)                                                      # 30% × 10.800 đủ
    _don(kh, "DH-BCKD-L3", chot_luc=_luc(2026, 8, 5), coc_pct=None, dong=(("Túi giấy", 10, 1000),))
    ky = {"tu_ngay": "2026-08-01", "den_ngay": "2026-08-31"}

    def don(**p):
        r = client.get(URL, params={**ky, **p}, headers=_h(client))
        assert r.status_code == 200, r.text
        return r.json()

    j = don(q="hop qua")
    assert [d["order_no"] for k in j["khach"] for d in k["don"]] == ["DH-BCKD-L1"]
    j = don(coc=["thieu", "khong"])
    assert [d["order_no"] for k in j["khach"] for d in k["don"]] == ["DH-BCKD-L1", "DH-BCKD-L3"]
    assert {c["value"]: c["so"] for c in j["lua_chon"]["coc"]} == {"khong": 1, "thieu": 1, "du": 1}
    assert j["tong"]["so_don"] == 2
    j = don(gt_den=20000)
    assert [d["order_no"] for k in j["khach"] for d in k["don"]] == ["DH-BCKD-L2", "DH-BCKD-L3"]
    j = don(q="khong-co-don-nao")
    assert j["khach"] == [] and j["tong"]["so_don"] == 0
    assert client.get(URL, params={**ky, "coc": "sai"}, headers=_h(client)).status_code == 422
    x = client.get(f"{URL}/export.xlsx", params={**ky, "coc": "du"}, headers=_h(client))
    assert x.status_code == 200


def _phieu_thu(order_id: int, tien: int, ngay: date, *, hoa_don_id: int | None = None) -> None:
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").one()
        db.add(PaymentReceipt(
            code=f"PT-BCKD-{order_id}-{tien}-{ngay:%m%d}", source_type=RECEIPT_SOURCE_ORDER,
            order_id=order_id, sales_invoice_id=hoa_don_id, payer_name="Khách",
            receipt_method="cash", status=PAYMENT_RECEIPT_RECEIVED, receipt_date=ngay, amount=tien,
            amount_vnd=tien, currency="VND", exchange_rate=1, content="Thu tiền đơn",
            created_by_user_id=admin.id, received_by_user_id=admin.id,
        ))
        db.commit()
    finally:
        db.close()


def _hoa_don(order_id: int, khach_id: int, tien: int, ngay: date) -> int:
    from app.models.accounting import SalesInvoice

    db = SessionLocal()
    try:
        hd = SalesInvoice(order_id=order_id, customer_id=khach_id, invoice_symbol="1C26T",
                          invoice_number=f"BCKD-{order_id}-{ngay:%m%d}", invoice_date=ngay,
                          amount_vnd=tien, customer_name_snapshot="Khách")
        db.add(hd)
        db.commit()
        return hd.id
    finally:
        db.close()


def _giao(order_id: int, sl: int, xong_luc: datetime) -> None:
    from app.models.delivery import LG_THANH_CONG, DeliveryRequest, DeliveryTrip, DeliveryTripLine
    from tests.gia_cong_fixtures import nhan_vien_cua

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").one()
        ln = db.query(OrderLine).filter(OrderLine.order_id == order_id).first()
        req = DeliveryRequest(code=f"YC-BCKD-{order_id}-{xong_luc:%m%d}", order_id=order_id,
                              trang_thai="cho_len_ke_hoach", ngay_can_giao=xong_luc.date())
        db.add(req)
        db.flush()
        trip = DeliveryTrip(request_id=req.id, lan_thu=1, trang_thai=LG_THANH_CONG,
                            employee_id=nhan_vien_cua(db, admin).id,
                            thoi_gian_ket_thuc=xong_luc)
        db.add(trip)
        db.flush()
        db.add(DeliveryTripLine(trip_id=trip.id, order_line_id=ln.id, qty_giao=sl))
        db.commit()
    finally:
        db.close()


def test_thuc_hien_don_luy_ke_toi_cuoi_ky_va_loc_giao_thu(client):
    """Phương án C (11/10/2026): đã giao / đã xuất HĐ / đã thu của đơn LŨY KẾ TỚI HẾT `den_ngay` —
    chuyến, hoá đơn, phiếu thu sau cuối kỳ không tính. Phiếu thu hoá đơn có cả `order_id` không bị
    cộng hai lần. Lọc tình trạng giao / thu, số đếm của mỗi điều kiện tính trên điều kiện KHÁC."""
    kh = _khach("Công ty BCKD Thực hiện", "KH-BCKD-T")
    g1 = _don(kh, "DH-BCKD-G1", chot_luc=_luc(2026, 8, 3), dong=(("Hộp cứng", 100, 10000),))
    _don(kh, "DH-BCKD-G2", chot_luc=_luc(2026, 8, 4), coc_pct=None, dong=(("Tem", 10, 1000),))
    _giao(g1, 40, _luc(2026, 8, 20))
    _giao(g1, 60, _luc(2026, 9, 5))
    hd1 = _hoa_don(g1, kh, 500_000, date(2026, 8, 25))
    _hoa_don(g1, kh, 580_000, date(2026, 9, 6))
    _phieu_thu(g1, 324_000, date(2026, 8, 10))                           # cọc 30%
    _phieu_thu(g1, 200_000, date(2026, 8, 28), hoa_don_id=hd1)           # thu hoá đơn, có cả order_id
    _phieu_thu(g1, 300_000, date(2026, 9, 10), hoa_don_id=hd1)           # sau cuối kỳ tháng 8

    def bc(**p):
        r = client.get(URL, params=p, headers=_h(client))
        assert r.status_code == 200, r.text
        return r.json()

    j = bc(tu_ngay="2026-08-01", den_ngay="2026-08-31")
    assert j["tinh_toi"] == "2026-08-31"
    d = {x["order_no"]: x for k in j["khach"] for x in k["don"]}
    g = d["DH-BCKD-G1"]
    assert (g["dong"][0]["da_giao"], g["dong"][0]["con_giao"]) == (40, 60)
    assert g["tong_vat"] == 1_080_000 and g["gia_tri_giao"] == 432_000
    assert (g["da_xuat_hd"], g["da_thu"], g["con_phai_thu"]) == (500_000, 524_000, 556_000)
    assert (g["giao"], g["thu"]) == ("mot_phan", "mot_phan")
    assert (d["DH-BCKD-G2"]["giao"], d["DH-BCKD-G2"]["thu"]) == ("chua", "chua")
    assert j["tong"]["da_thu"] == 524_000 and j["tong"]["con_phai_thu"] == 556_000 + 10_800

    j = bc(tu_ngay="2026-08-01", den_ngay="2026-09-30")
    g = {x["order_no"]: x for k in j["khach"] for x in k["don"]}["DH-BCKD-G1"]
    assert (g["dong"][0]["con_giao"], g["gia_tri_giao"], g["giao"]) == (0, 1_080_000, "du")
    assert (g["da_xuat_hd"], g["da_thu"]) == (1_080_000, 824_000)

    j = bc(tu_ngay="2026-08-01", den_ngay="2026-08-31", giao=["chua"])
    assert [x["order_no"] for k in j["khach"] for x in k["don"]] == ["DH-BCKD-G2"]
    assert {c["value"]: c["so"] for c in j["lua_chon"]["giao"]} == {"chua": 1, "mot_phan": 1, "du": 0}
    assert {c["value"]: c["so"] for c in j["lua_chon"]["thu"]} == {"chua": 1, "mot_phan": 0, "du": 0}
    j = bc(tu_ngay="2026-08-01", den_ngay="2026-08-31", thu=["mot_phan"])
    assert [x["order_no"] for k in j["khach"] for x in k["don"]] == ["DH-BCKD-G1"]
    assert client.get(URL, params={"giao": "sai"}, headers=_h(client)).status_code == 422

    x = client.get(f"{URL}/export.xlsx", params={"tu_ngay": "2026-08-01", "den_ngay": "2026-08-31"},
                   headers=_h(client))
    ws = load_workbook(BytesIO(x.content)).active
    assert ws["O4"].value == "Tỷ lệ báo giá" and ws["P4"].value == "Đã giao (SL)"
    assert ws["T4"].value == "Điều chỉnh giảm" and ws["W4"].value == "Hẹn giao"
    don_g1 = next(r for r in range(5, ws.max_row + 1) if ws[f"A{r}"].value == "DH-BCKD-G1")
    assert (ws[f"R{don_g1}"].value, ws[f"T{don_g1}"].value, ws[f"U{don_g1}"].value, ws[f"V{don_g1}"].value) == (
        432_000, 0, 524_000, 556_000)
    assert (ws[f"P{don_g1 + 1}"].value, ws[f"Q{don_g1 + 1}"].value) == (40, 60)


def test_dieu_chinh_giam_bot_so_khach_phai_thu(client):
    """Hoá đơn điều chỉnh giảm (hoàn chiết khấu, 18/10/2026): hoá đơn gốc vẫn 100%, nhưng khách chỉ phải
    trả phần sau điều chỉnh — trả đúng số đó là ĐỦ, không còn "thu một phần". Lũy kế tới hết `den_ngay`."""
    from app.models.accounting import SalesInvoiceAdjustment

    kh = _khach("Công ty BCKD Điều chỉnh", "KH-BCKD-DC")
    don = _don(kh, "DH-BCKD-DC", chot_luc=_luc(2026, 8, 3), dong=(("Hộp cứng", 100, 10000),))  # 1.080.000
    hd = _hoa_don(don, kh, 1_080_000, date(2026, 8, 10))
    db = SessionLocal()
    try:
        db.add(SalesInvoiceAdjustment(sales_invoice_id=hd, order_id=don, adj_symbol="1C26DC",
                                      adj_number="DC-BCKD-1", adj_date=date(2026, 8, 20),
                                      amount_vnd=54_000, reason="Chiết khấu"))
        db.commit()
    finally:
        db.close()
    _phieu_thu(don, 1_026_000, date(2026, 8, 25), hoa_don_id=hd)

    def dong(den):
        j = client.get(URL, params={"tu_ngay": "2026-08-01", "den_ngay": den}, headers=_h(client)).json()
        return {x["order_no"]: x for k in j["khach"] for x in k["don"]}["DH-BCKD-DC"], j["tong"]

    d, tong = dong("2026-08-31")
    assert (d["da_xuat_hd"], d["dieu_chinh"], d["da_thu"], d["con_phai_thu"], d["thu"]) == (
        1_080_000, 54_000, 1_026_000, 0, "du")
    assert tong["dieu_chinh"] == 54_000
    # In lại kỳ trước ngày điều chỉnh: chưa có điều chỉnh, khách mới trả 0 ⇒ còn phải thu cả đơn.
    d, _ = dong("2026-08-15")
    assert (d["dieu_chinh"], d["da_thu"], d["con_phai_thu"], d["thu"]) == (0, 0, 1_080_000, "chua")
