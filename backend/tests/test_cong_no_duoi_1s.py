"""Công nợ phải thu / phải trả + sổ theo kỳ KHÔNG dựng đối tượng ORM theo cỡ lịch sử (26/10/2026).

Trên DB đo tải (13 nghìn hoá đơn, 13 nghìn phiếu thu) các API công nợ mất 6–16 s, không phải vì số
câu SQL mà vì nạp TOÀN BỘ hoá đơn / phiếu thu thành đối tượng ORM kèm selectinload. Hai nhóm guard:

1. Số đối tượng ORM `SalesInvoice` / `PaymentReceipt` / `PaymentReceiptLine` dựng ra trong một
   request phải ĐỨNG YÊN khi thêm hoá đơn + phiếu thu (bản cũ: tăng theo từng hoá đơn).
2. Kết quả JSON GIỐNG HỆT đường nạp ORM cũ, trên dữ liệu có đủ ca khó: phiếu gộp nhiều dòng, cọc
   đơn (phiếu chỉ gắn đơn, không gắn khách), tiền trả vào hoá đơn đã huỷ, phiếu thu đã huỷ, trả lại
   khách trong / ngoài đơn, NCC hoàn tiền (qua phiếu chi gốc và gắn thẳng NCC), tài khoản ngân hàng
   lùi về danh mục khi phiếu thiếu bản chụp. "Đường cũ" dựng lại trong test bằng ORM.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import selectinload

from app.db import SessionLocal
from app.models.accounting import (
    PAYMENT_RECEIPT_CANCELLED,
    PAYMENT_RECEIPT_RECEIVED,
    PAYMENT_VOUCHER_PAID,
    RECEIPT_SOURCE_ORDER,
    RECEIPT_SOURCE_PURCHASE,
    RECEIPT_SOURCE_SALES_INVOICE,
    SALES_INVOICE_CANCELLED,
    SALES_INVOICE_ISSUED,
    VOUCHER_CASH,
    VOUCHER_SOURCE_CUSTOMER_REFUND,
    VOUCHER_SOURCE_PURCHASE,
    CompanyBankAccount,
    PaymentReceipt,
    PaymentReceiptLine,
    PaymentVoucher,
    SalesInvoice,
)
from app.models.customer import Customer
from app.models.order import STATUS_ORDERED, Order, OrderLine
from app.models.purchase import (
    PR_RECEIVED,
    PurchaseDelivery,
    PurchaseDeliveryLine,
    PurchaseRequest,
    PurchaseRequestLine,
    Supplier,
)
from app.repositories.accounting_repo import AccountingRepository
from app.services import accounting_service

HOM_NAY = accounting_service._business_today()
TU = (HOM_NAY - timedelta(days=60)).isoformat()
DEN = HOM_NAY.isoformat()
DEN_QUA = (HOM_NAY - timedelta(days=5)).isoformat()


@pytest.fixture
def h(client, seed_credentials) -> dict[str, str]:
    tok = client.post("/api/auth/login", json=seed_credentials).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


@contextmanager
def dem_orm():
    """Đếm đối tượng ORM hoá đơn / phiếu thu / dòng phiếu thu được DỰNG từ DB."""
    dem = {"n": 0}

    def _nap(*_a, **_k):
        dem["n"] += 1

    lop = (SalesInvoice, PaymentReceipt, PaymentReceiptLine)
    for c in lop:
        event.listen(c, "load", _nap)
    try:
        yield dem
    finally:
        for c in lop:
            event.remove(c, "load", _nap)


def _ngay(n: int) -> date:
    return HOM_NAY - timedelta(days=n)


def _khach(db, ma: str, *, han: int | None = 30) -> Customer:
    k = Customer(code=f"KH-{ma}", name=f"Khach {ma}", payment_term_days=han, credit_limit=100_000)
    db.add(k)
    db.flush()
    return k


def _don(db, ma: str, khach: Customer, tong: int = 1_000_000) -> Order:
    o = Order(order_no=f"DH-{ma}", customer_id=khach.id, status=STATUS_ORDERED)
    o.lines.append(OrderLine(description="Hop", qty=1, don_vi_tinh="cai", line_total=tong,
                             vat_pct_estimate=0))
    db.add(o)
    db.flush()
    return o


def _hd(db, don: Order, so: str, tien: int, ngay: date, *, han: int | None = 30,
        tt: str = SALES_INVOICE_ISSUED) -> SalesInvoice:
    hd = SalesInvoice(
        order_id=don.id, customer_id=don.customer_id, invoice_symbol="1C26T", invoice_number=so,
        invoice_date=ngay, amount_vnd=tien, payment_term_days_snapshot=han,
        due_date=(ngay + timedelta(days=han)) if han is not None else None,
        customer_name_snapshot=f"Snap {so}", status=tt,
    )
    db.add(hd)
    db.flush()
    return hd


def _pt(db, ma: str, ngay: date, dong: list[tuple], *, nguon: str = RECEIPT_SOURCE_SALES_INVOICE,
        khach: Customer | None = None, tt: str = PAYMENT_RECEIPT_RECEIVED, **them) -> PaymentReceipt:
    """`dong` = [(order_id, sales_invoice_id | None, tiền)]."""
    tien = sum(t for *_x, t in dong) if dong else them.pop("amount_vnd")
    p = PaymentReceipt(
        code=f"PT-{ma}", payer_name="Nguoi tra", receipt_method=them.pop("receipt_method", VOUCHER_CASH),
        source_type=nguon, status=tt, receipt_date=ngay, amount=tien, amount_vnd=tien,
        content=them.pop("content", f"thu {ma}"), customer_id=khach.id if khach else None,
        received_at=datetime(ngay.year, ngay.month, ngay.day, 9, 30), **them,
    )
    if dong:
        p.order_id = dong[0][0]
        p.sales_invoice_id = dong[0][1] if len(dong) == 1 else None
    for don_id, hd_id, tien in dong:
        p.lines.append(PaymentReceiptLine(order_id=don_id, sales_invoice_id=hd_id, amount_vnd=tien))
    db.add(p)
    db.flush()
    return p


def _hoa_don_thuong(db, ma: str, n: int) -> None:
    """n khách thường, mỗi khách một đơn + một hoá đơn trả một phần — thứ làm phình lịch sử."""
    for i in range(n):
        k = _khach(db, f"{ma}{i}")
        o = _don(db, f"{ma}{i}", k)
        hd = _hd(db, o, f"{ma}{i:04d}", 400_000 + i, _ngay(10 + i))
        _pt(db, f"{ma}{i}", _ngay(3 + i), [(o.id, hd.id, 100_000)], khach=k)


def _du_lieu_kho() -> dict:
    db = SessionLocal()
    try:
        tk = CompanyBankAccount(account_holder="Cty", account_number="0011", bank_name="VCB",
                                bank_branch="HN")
        db.add(tk)
        a, b = _khach(db, "A"), _khach(db, "B", han=None)
        o1, o2, o3 = _don(db, "1", a), _don(db, "2", a, 600_000), _don(db, "3", b)
        i1 = _hd(db, o1, "0001", 300_000, _ngay(90))           # trước kỳ
        i2 = _hd(db, o1, "0002", 200_000, _ngay(20))
        i3 = _hd(db, o2, "0003", 500_000, _ngay(15))
        i4 = _hd(db, o3, "0004", 100_000, _ngay(40), tt=SALES_INVOICE_CANCELLED)
        i5 = _hd(db, o3, "0005", 150_000, _ngay(2), han=None)
        _hd(db, o3, "", 70_000, _ngay(1))                      # chưa có số ⇒ "HĐ #id"
        # Phiếu gộp: trả I1, I3 và cọc O2 một lần, chuyển khoản không bản chụp ⇒ lùi về danh mục.
        _pt(db, "GOP", _ngay(10), [(o1.id, i1.id, 100_000), (o2.id, i3.id, 50_000), (o2.id, None, 20_000)],
            khach=a, receipt_method="bank_transfer", company_bank_account_id=tk.id)
        # Cọc O3 — phiếu chỉ gắn đơn, không gắn khách.
        _pt(db, "COC", _ngay(50), [(o3.id, None, 80_000)], nguon=RECEIPT_SOURCE_ORDER)
        # Tiền trả vào hoá đơn ĐÃ HUỶ (về quỹ đơn như cọc).
        _pt(db, "HUY", _ngay(45), [(o3.id, i4.id, 30_000)])
        # Phiếu trả THỪA I2 (vượt giá trị hoá đơn) và phiếu đã huỷ.
        _pt(db, "THUA", _ngay(4), [(o1.id, i2.id, 250_000)], khach=a)
        _pt(db, "BOHUY", _ngay(4), [(o1.id, i1.id, 99_000)], khach=a, tt=PAYMENT_RECEIPT_CANCELLED)
        # Hoá đơn có chiết khấu + kê đã thu đủ ⇒ hàng "Chờ chi chiết khấu / kê".
        o4 = _don(db, "4", a, 50_000)
        i6 = _hd(db, o4, "0006", 50_000, _ngay(12))
        i6.chiet_khau, i6.ke_gia, i6.ke_thue_tndn = 5_000, 8_000, 1_000
        _pt(db, "CK", _ngay(11), [(o4.id, i6.id, 50_000)], khach=a)
        # Trước kỳ.
        _pt(db, "CU", _ngay(80), [(o1.id, i1.id, 40_000)], khach=a, content="")
        # Trả lại khách: ngoài đơn (khách A) và theo đơn O3.
        for ma, don_id, kh_id, tien in (("TL1", None, a.id, 60_000), ("TL2", o3.id, b.id, 10_000)):
            db.add(PaymentVoucher(
                code=f"PC-{ma}", voucher_type=VOUCHER_CASH, payment_stage="payment",
                source_type=VOUCHER_SOURCE_CUSTOMER_REFUND, status=PAYMENT_VOUCHER_PAID,
                voucher_date=_ngay(6), amount=tien, amount_vnd=tien, content=f"tra lai {ma}", source_code_snapshot=ma, supplier_name_snapshot="",
                customer_id=kh_id, order_id=don_id, paid_at=datetime.now(),
            ))
        # Phải trả: NCC, đơn mua đã nhận, phiếu chi một phần, NCC hoàn qua phiếu chi + gắn thẳng.
        ncc = Supplier(name="NCC Tai")
        db.add(ncc)
        db.flush()
        pr = PurchaseRequest(code="PMH-T1", status=PR_RECEIVED, purpose="do", supplier_id=ncc.id,
                             approved_at=datetime.now())
        db.add(pr)
        db.flush()
        dong = PurchaseRequestLine(purchase_request_id=pr.id, item_name="Giay", unit="kg",
                                   quantity=10, expected_unit_price=10_000)
        db.add(dong)
        db.flush()
        dot = PurchaseDelivery(purchase_request_id=pr.id, seq_no=1, delivery_date=_ngay(30))
        db.add(dot)
        db.flush()
        db.add(PurchaseDeliveryLine(delivery_id=dot.id, purchase_request_line_id=dong.id, quantity=10))
        pc = PaymentVoucher(
            code="PC-NCC", voucher_type=VOUCHER_CASH, payment_stage="payment",
            source_type=VOUCHER_SOURCE_PURCHASE, purchase_request_id=pr.id, delivery_id=dot.id,
            status=PAYMENT_VOUCHER_PAID, voucher_date=_ngay(20), amount=60_000, amount_vnd=60_000,
            content="tra ncc", supplier_name_snapshot="NCC snap", source_code_snapshot="PMH-T1", paid_at=datetime.now() - timedelta(days=20),
        )
        db.add(pc)
        db.flush()
        _pt(db, "HOAN1", _ngay(8), [], nguon=RECEIPT_SOURCE_PURCHASE, payment_voucher_id=pc.id,
            amount_vnd=5_000)
        _pt(db, "HOAN2", _ngay(7), [], nguon=RECEIPT_SOURCE_PURCHASE, supplier_id=ncc.id,
            amount_vnd=3_000, supplier_name_snapshot="NCC snap 2",
            receipt_method="bank_transfer", company_bank_name_snapshot="ACB",
            company_account_number_snapshot="999")
        db.commit()
        return {"a": a.id, "b": b.id, "ncc": ncc.id}
    finally:
        db.close()


def _urls(ids: dict) -> list[str]:
    ky = f"tu_ngay={TU}&den_ngay={DEN}"
    ky_qua = f"tu_ngay={TU}&den_ngay={DEN_QUA}"
    ra = [
        "/api/accounting/receivables?size=50",
        "/api/accounting/don-hang-cho-thu",
        "/api/accounting/ck-ke-cho-chi",
        f"/api/accounting/receivables?size=50&{ky}",
        f"/api/accounting/receivables?size=50&{ky_qua}",
        f"/api/accounting/receivables?size=50&{ky_qua}&ca_da_tra_het=true",
        f"/api/accounting/reports/receivables?{ky}&size=50",
        f"/api/accounting/reports/receivables?{ky_qua}",
        f"/api/accounting/reports/receivables/so-chi-tiet?{ky}&size=50",
        f"/api/accounting/reports/receivables/khoan-con-no?{ky}",
        f"/api/accounting/reports/payables?{ky}&size=50",
        f"/api/accounting/reports/payables/so-chi-tiet?{ky}&size=50",
        f"/api/accounting/reports/payables/khoan-con-no?{ky}",
        f"/api/accounting/reports/payables/so-chi-tiet?{ky}&doi_tuong_id={ids['ncc']}",
        f"/api/accounting/reports/payables/khoan-con-no?{ky}&doi_tuong_id={ids['ncc']}",
    ]
    for kh in (ids["a"], ids["b"]):
        ra += [
            f"/api/accounting/reports/receivables/so-chi-tiet?{ky}&doi_tuong_id={kh}",
            f"/api/accounting/reports/receivables/khoan-con-no?{ky}&doi_tuong_id={kh}",
            f"/api/accounting/reports/receivables/khoan-con-no?{ky_qua}&doi_tuong_id={kh}",
            f"/api/accounting/receivables/{kh}/so-chi-tiet?{ky}",
        ]
    return ra


# --- "Đường cũ": nạp ORM như trước 26/10/2026 -------------------------------------------------


def _phieu_thu_orm(self, *, den_ngay, chi_ncc_hoan=False, mat=True, dong=True):
    stmt = (
        select(PaymentReceipt)
        .options(
            selectinload(PaymentReceipt.sales_invoice),
            selectinload(PaymentReceipt.lines).selectinload(PaymentReceiptLine.sales_invoice),
            selectinload(PaymentReceipt.payment_voucher).selectinload(PaymentVoucher.purchase_request),
            selectinload(PaymentReceipt.company_bank_account),
        )
        .where(PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED, PaymentReceipt.receipt_date <= den_ngay)
        .order_by(PaymentReceipt.receipt_date, PaymentReceipt.id)
    )
    return list(self.db.execute(stmt).scalars().unique().all())


def _tien_thu_orm(self, *, den_ngay):
    from app.services.bao_cao_cong_no import tien_thu_tu_phieu

    return tien_thu_tu_phieu(_phieu_thu_orm(self, den_ngay=den_ngay))


def _hoa_don_orm(self, *dieu_kien):
    return list(self.db.scalars(
        self._sales_invoice_stmt().where(SalesInvoice.status == SALES_INVOICE_ISSUED, *dieu_kien)
        .order_by(SalesInvoice.invoice_date, SalesInvoice.id)))


def _thu_theo_dong_orm(self, *, since, until):
    hd = self.list_sales_invoices(status=SALES_INVOICE_ISSUED)
    gom: dict = {}
    for l in self.list_receipts_for_receivables(
        invoice_ids=sorted({x.id for x in hd}), order_ids=sorted({x.order_id for x in hd}), since=since
    ):
        if until is not None and l.receipt_date > until:
            continue
        k = (l.sales_invoice_id, l.order_id)
        gom[k] = gom.get(k, 0) + int(l.amount_vnd)
    return [(a, b, t) for (a, b), t in gom.items()]


_goc_lan_thu = AccountingRepository.lan_thu_cuoi_cong_no


def _lan_thu_orm(self, *, invoice_ids=None, order_ids=None):
    hd = self.list_sales_invoices(status=SALES_INVOICE_ISSUED)
    return _goc_lan_thu(self, invoice_ids=sorted({x.id for x in hd}),
                        order_ids=sorted({x.order_id for x in hd}))


def _so_tat_ca():
    from app.repositories.purchase_repo import PurchaseRequestRepository
    from app.services import bao_cao_cong_no

    db = SessionLocal()
    try:
        repo = AccountingRepository(db)
        tu, den = date.fromisoformat(TU), date.fromisoformat(DEN)
        return (
            bao_cao_cong_no.so_chi_tiet_tat_ca_phai_thu(repo, tu_ngay=tu, den_ngay=den),
            bao_cao_cong_no.so_chi_tiet_tat_ca_phai_tra(
                repo, PurchaseRequestRepository(db), tu_ngay=tu, den_ngay=den),
        )
    finally:
        db.close()


def test_ket_qua_giong_duong_nap_orm(client, h, monkeypatch):
    ids = _du_lieu_kho()
    moi = {}
    for u in _urls(ids):
        r = client.get(u, headers=h)
        assert r.status_code == 200, (u, r.text)
        moi[u] = r.json()
    so_moi = _so_tat_ca()
    # Nhánh "tập id lớn ⇒ đọc cả bảng rồi lọc bằng Python" phải ra đúng như nhánh IN-list.
    from app.repositories import accounting_repo

    monkeypatch.setattr(accounting_repo, "_IN_LIST_TOI_DA", 0)
    for u in _urls(ids):
        assert client.get(u, headers=h).json() == moi[u], ("IN-list lớn", u)
    assert _so_tat_ca() == so_moi
    monkeypatch.setattr(accounting_repo, "_IN_LIST_TOI_DA", 2000)
    monkeypatch.setattr(AccountingRepository, "phieu_thu_cho_bao_cao", _phieu_thu_orm)
    monkeypatch.setattr(AccountingRepository, "hoa_don_phat_hanh_nhe", _hoa_don_orm)
    monkeypatch.setattr(AccountingRepository, "tien_thu_hoa_don_va_coc", _tien_thu_orm)
    monkeypatch.setattr(AccountingRepository, "thu_cong_no_theo_dong", _thu_theo_dong_orm)
    monkeypatch.setattr(AccountingRepository, "lan_thu_cuoi_cong_no", _lan_thu_orm)
    for u in _urls(ids):
        cu = client.get(u, headers=h).json()
        assert moi[u] == cu, u
    # Sổ chi tiết mọi đối tượng (nguồn file Excel) — có cột TK đối ứng mà API JSON không trả.
    assert so_moi == _so_tat_ca()
    # Dữ liệu thật sự chạm các ca khó (đừng để test xanh trên bảng trống).
    so_a = moi[f"/api/accounting/reports/receivables/so-chi-tiet?tu_ngay={TU}&den_ngay={DEN}&doi_tuong_id={ids['a']}"]
    assert {d["loai"] for d in so_a["dong"]} >= {"hoa_don", "phieu_thu", "hoan_tien_khach"}
    tk = {d["tk_doi_ung"] for m in so_moi[0]["so"] for d in m["dong"]}
    assert {"VCB - 0011", "Tiền mặt"} <= tk
    assert "ACB - 999" in {d["tk_doi_ung"] for m in so_moi[1]["so"] for d in m["dong"]}
    so_ncc = moi[f"/api/accounting/reports/payables/so-chi-tiet?tu_ngay={TU}&den_ngay={DEN}&doi_tuong_id={ids['ncc']}"]
    assert {d["loai"] for d in so_ncc["dong"]} >= {"dot_giao", "phieu_chi", "hoan_tien"}
    assert moi["/api/accounting/receivables?size=50"]["total"] >= 2
    assert moi["/api/accounting/don-hang-cho-thu"]["hoa_don"]
    assert {r["loai"] for r in moi["/api/accounting/ck-ke-cho-chi"]["items"]} == {"chiet_khau", "ke_gia"}


def test_khong_dung_doi_tuong_orm_theo_co_lich_su(client, h):
    """Thêm 6 khách thường (6 hoá đơn + 6 phiếu thu) không được làm tăng số đối tượng ORM hoá đơn /
    phiếu thu dựng ra. Bản cũ: mỗi hoá đơn + phiếu thu thêm là thêm vài đối tượng ở MỌI URL."""
    ids = _du_lieu_kho()
    db = SessionLocal()
    try:
        _hoa_don_thuong(db, "X", 2)
        db.commit()
    finally:
        db.close()

    def _do() -> dict[str, int]:
        ra = {}
        for u in _urls(ids):
            with dem_orm() as d:
                r = client.get(u, headers=h)
            assert r.status_code == 200, (u, r.text)
            ra[u] = d["n"]
        return ra

    it = _do()
    db = SessionLocal()
    try:
        _hoa_don_thuong(db, "Y", 6)
        db.commit()
    finally:
        db.close()
    nhieu = _do()
    tang = {u: (it[u], nhieu[u]) for u in it if nhieu[u] > it[u]}
    assert not tang, f"đối tượng ORM tăng theo số hoá đơn: {tang}"
