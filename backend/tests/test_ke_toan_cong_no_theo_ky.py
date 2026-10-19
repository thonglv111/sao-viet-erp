"""Công nợ phải trả / phải thu THEO KỲ + bộ lọc nâng cao (Task 2, đặc tả 05/10/2026).

Khi có `tu_ngay`/`den_ngay`:
  • Còn nợ / quá hạn / tuổi nợ: kỳ kết thúc HÔM NAY (mọi kỳ mặc định) ⇒ ẢNH CHỤP như màn không kỳ;
    kỳ đã QUA ⇒ dư cuối kỳ + tuổi nợ tại `den_ngay` của sổ theo kỳ (`bao_cao_cong_no`), kẹp ≥ 0.
  • Đã trả / đã thu trong kỳ: đếm theo NGÀY CHI của phiếu chi / NGÀY THU của phiếu thu trong kỳ.
  • Mua thêm / bán thêm trong kỳ: PS Có 331 / PS Nợ 131 của sổ.
Không có kỳ thì giữ nguyên hành vi cũ (ảnh chụp tại hôm nay, cột "đã trả" 3 tháng).
"""
from __future__ import annotations

from datetime import timedelta

from tests.giao_hang_fixtures import giao_het
from app.db import SessionLocal
from app.models.customer import Customer, CustomerTag
from app.models.order import Order, OrderLine, STATUS_ORDERED
from app.models.role import SCOPE_ALL
from app.repositories.rbac_repo import DepartmentRepository, RoleRepository
from app.repositories.user_repo import UserRepository
from app.security import create_access_token, hash_password
from app.services import accounting_service


def _hom_nay():
    return accounting_service._business_today()


# --- helper chép từ tests/test_payables_api.py --------------------------------


def _headers(client) -> dict[str, str]:
    login = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _needed_date(days: int = 30) -> str:
    return (_hom_nay() + timedelta(days=days)).isoformat()


def _supplier(client, headers, *, name: str = "NCC Công Nợ") -> dict:
    dau = f"{abs(hash(name)) % 10**8:08d}"
    response = client.post(
        "/api/suppliers",
        json={
            "name": name,
            "tax_code": f"01{dau}",
            "phone": f"09{dau}",
            "email": f"ncc{dau}@example.com",
            "address": "Hà Nội",
            "contact_name": "Nguyễn Lan",
            "supplier_group": "paper",
            "items": [{"item_name": "Giấy Duplex", "unit": "tờ", "unit_price": 2200, "vat_percent": 0}],
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _sua_ncc(client, headers, supplier: dict, **doi) -> dict:
    body = {
        "name": supplier["name"],
        "tax_code": supplier["tax_code"],
        "phone": supplier["phone"],
        "email": supplier["email"],
        "address": supplier["address"],
        "contact_name": supplier["contact_name"],
        "supplier_group": supplier["supplier_group"],
        "items": [{"item_name": "Giấy Duplex", "unit": "tờ", "unit_price": 2200, "vat_percent": 0}],
        **doi,
    }
    r = client.put(f"/api/suppliers/{supplier['id']}", json=body, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _token_vai(username: str, *, module: str, **quyen) -> str:
    db = SessionLocal()
    try:
        users = UserRepository(db)
        u = users.get_by_username(username)
        if u is None:
            bgd = DepartmentRepository(db).get_by_name("Ban giám đốc")
            roles = RoleRepository(db)
            role = roles.create(name=f"Vai {username}", department_id=bgd.id)
            roles.set_permission(role_id=role.id, module_key=module, scope=SCOPE_ALL, **quyen)
            u = users.create(username=username, name=username, password_hash=hash_password("x"))
            users.set_assignment(u, department_id=bgd.id, role_id=role.id, is_active=True)
        return create_access_token(str(u.id))
    finally:
        db.close()


def _duyet(client, purchase_id: int) -> None:
    token = _token_vai("cn-approver", module="ke_toan", can_read=True, can_approve=True)
    r = client.post(
        f"/api/purchase-requests/{purchase_id}/approve",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text


def _khai_coc(client, headers, purchase_id: int, so_tien: int) -> None:
    """Khai CỌC DỰ KIẾN — bắt buộc trước phiếu ĐẶT CỌC, và phải xong trước khi duyệt."""
    r = client.put(
        f"/api/purchase-requests/{purchase_id}/contract",
        json={"contract_number": None, "deposit_expected": so_tien},
        headers=headers,
    )
    assert r.status_code == 200, r.text


def _ve_hang(client, headers, purchase_id: int) -> None:
    """Đường CŨ: nhận cả đơn bằng `mark-received` — KHÔNG sinh đợt giao."""
    _da_mua(client, headers, purchase_id)
    r = client.post(
        f"/api/purchase-requests/{purchase_id}/mark-received", json={"lines": []}, headers=headers
    )
    assert r.status_code == 200, r.text


def _don(client, headers, supplier_id: int, *, quantity: int = 1000, coc: int = 0) -> dict:
    """PMH đã duyệt. quantity tờ × 2.200đ. `coc=N` khai cọc dự kiến trước khi duyệt."""
    source = client.post(
        "/api/department-purchase-requests",
        json={
            "source_type": "kinh_doanh",
            "purpose": "Mua giấy",
            "needed_date": _needed_date(),
            "lines": [{"item_name": "Giấy Duplex", "unit": "tờ", "quantity": quantity}],
        },
        headers=headers,
    )
    assert source.status_code == 201, source.text
    src = source.json()
    purchase = client.post(
        "/api/purchase-requests",
        json={
            "supplier_id": supplier_id,
            "source_request_ids": [src["id"]],
            "purpose": "Mua giấy",
            "needed_date": _needed_date(),
            "lines": [
                {
                    "item_name": "Giấy Duplex",
                    "unit": "tờ",
                    "quantity": quantity,
                    "expected_unit_price": 2200,
                    "discount_percent": 0,
                    "vat_percent": 0,
                }
            ],
        },
        headers=headers,
    )
    assert purchase.status_code == 201, purchase.text
    body = purchase.json()
    if coc:
        _khai_coc(client, headers, body["id"], coc)
    assert client.post(
        f"/api/purchase-requests/{body['id']}/submit", headers=headers
    ).status_code == 200
    _duyet(client, body["id"])
    return body


def _da_mua(client, headers, purchase_id: int) -> None:
    assert client.post(
        f"/api/purchase-requests/{purchase_id}/mark-purchased", headers=headers
    ).status_code == 200


def _ghi_dot(
    client, headers, purchase_id: int, *, lines: list[dict], han: str | None = None,
    ngay: str | None = None,
) -> dict:
    if han is not None:
        from tests.test_payables_api import _han_bang_dieu_khoan_ncc

        _han_bang_dieu_khoan_ncc(purchase_id, ngay or _hom_nay().isoformat(), han)
    r = client.post(
        f"/api/purchase-requests/{purchase_id}/deliveries",
        json={
            "delivery_date": ngay or _hom_nay().isoformat(),
            "invoice_number": None,
            "invoice_date": None,
            "lines": lines,
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _dong_dau_tien(don: dict) -> int:
    return don["lines"][0]["id"]


def _phieu_chi(
    client, headers, purchase_id: int, amount: int, *, delivery_id: int | None = None,
    stage: str = "final",
) -> dict:
    """Phiếu chi — sinh ra là đã chi, đề ngày hôm nay. `final` = THANH TOÁN (bắt buộc gắn đợt
    giao); `advance` = ĐẶT CỌC (đơn phải khai cọc dự kiến trước)."""
    r = client.post(
        "/api/accounting/payment-vouchers",
        json={
            "purchase_request_id": purchase_id,
            "voucher_type": "cash",
            "payment_stage": stage,
            "delivery_id": delivery_id,
            "voucher_date": _hom_nay().isoformat(),
            "amount": amount,
            "currency": "VND",
            "exchange_rate": 1,
            "content": "Trả tiền giấy",
            "cash_recipient_name": "Nguyễn Lan",
            "cash_recipient_address": "Hà Nội",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _ncc_co_no(client, h, *, name: str, quantity: int) -> tuple[dict, dict, int]:
    """NCC + một đơn đã giao `quantity` tờ hôm nay ⇒ nợ quantity × 2.200đ. Trả (ncc, đơn, id đợt)."""
    ncc = _supplier(client, h, name=name)
    don = _don(client, h, ncc["id"], quantity=quantity)
    _da_mua(client, h, don["id"])
    sau = _ghi_dot(client, h, don["id"], lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": quantity}])
    dot_id = sau["deliveries"][-1]["id"]
    return ncc, don, dot_id


def _ky_thang_nay() -> dict[str, str]:
    hn = _hom_nay()
    return {"tu_ngay": hn.replace(day=1).isoformat(), "den_ngay": hn.isoformat()}


def _ky_nam_truoc() -> dict[str, str]:
    hn = _hom_nay()
    return {
        "tu_ngay": (hn - timedelta(days=730)).isoformat(),
        "den_ngay": (hn - timedelta(days=366)).isoformat(),
    }


def _payables(client, h, **params) -> dict:
    r = client.get("/api/accounting/payables", headers=h, params=params)
    assert r.status_code == 200, r.text
    return r.json()


# --- helper chép từ tests/test_sales_invoices_api.py --------------------------


def _sales_order(
    *, total: int = 1_000_000, term_days: int | None = 30, suffix: str = "01",
    sale_user_id: int | None = None,
) -> tuple[int, int]:
    db = SessionLocal()
    try:
        customer = Customer(
            code=f"KH-KY-{suffix}",
            name=f"Khach ky {suffix}",
            payment_term_days=term_days,
            credit_limit=500_000,
            sale_user_id=sale_user_id,
        )
        db.add(customer)
        db.flush()
        order = Order(
            order_no=f"DH-KY-{suffix}",
            customer_id=customer.id,
            status=STATUS_ORDERED,
            ordered_at=None,
        )
        order.lines.append(
            OrderLine(
                description="Printed boxes",
                qty=100,
                don_vi_tinh="box",
                line_total=total,
                vat_pct_estimate=0,
            )
        )
        db.add(order)
        db.commit()
        return order.id, customer.id
    finally:
        db.close()


def _invoice_payload(order_id: int, *, number: str, amount: int | None = None) -> dict:
    # Hóa đơn gắn lượt khách đã nhận (mg 0402) — dựng sẵn lượt giao hết đơn.
    payload = {
        "order_id": order_id,
        "delivery_trip_id": giao_het(order_id),
        "invoice_symbol": "1C26TSV",
        "invoice_number": number,
        "invoice_date": _hom_nay().isoformat(),
    }
    if amount is not None:
        payload["amount_vnd"] = amount
    return payload


def _user_id(username: str) -> int:
    db = SessionLocal()
    try:
        users = UserRepository(db)
        u = users.get_by_username(username)
        if u is None:
            u = users.create(username=username, name=username, password_hash=hash_password("x"))
        return u.id
    finally:
        db.close()


# --- PHẢI TRẢ ---------------------------------------------------------------


def test_ky_den_hom_nay_khop_ban_chup_hien_tai(client):
    """Cùng dữ liệu: có kỳ (đến hôm nay) và không kỳ phải ra CÙNG số còn nợ / quá hạn / tuổi nợ."""
    h = _headers(client)
    ncc = _supplier(client, h, name="NCC Ky Khop")
    don = _don(client, h, ncc["id"]); _da_mua(client, h, don["id"])
    _ghi_dot(client, h, don["id"], lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 400}])
    hn = accounting_service._business_today()
    cu = client.get("/api/accounting/payables", headers=h).json()
    moi = client.get("/api/accounting/payables", headers=h,
                     params={"tu_ngay": hn.replace(day=1).isoformat(), "den_ngay": hn.isoformat()}).json()
    a = next(m for m in cu["items"] if m["supplier_id"] == ncc["id"])
    b = next(m for m in moi["items"] if m["supplier_id"] == ncc["id"])
    assert b["total_due"] == a["total_due"]
    assert b["overdue_amount"] == a["overdue_amount"]
    assert b["aging"] == a["aging"]
    assert b["mua_trong_ky"] == a["total_due"]   # mua trong tháng này, chưa trả
    # Tổng đầu màn cũng theo kỳ, và kỳ được trả ngược lại cho giao diện in tiêu đề.
    assert moi["mua_trong_ky"] == 880_000
    assert moi["tu_ngay"] == hn.replace(day=1).isoformat()
    assert moi["den_ngay"] == hn.isoformat()


def test_tra_trong_ky_va_ky_truoc_khong_tinh(client):
    h = _headers(client)
    ncc, don, dot_id = _ncc_co_no(client, h, name="NCC Tra Trong Ky", quantity=400)  # 880.000
    _phieu_chi(client, h, don["id"], 300_000, delivery_id=dot_id)

    thang_nay = _payables(client, h, **_ky_thang_nay())
    m = next(x for x in thang_nay["items"] if x["supplier_id"] == ncc["id"])
    assert m["paid_in_period"] == 300_000
    assert m["mua_trong_ky"] == 880_000
    assert m["total_due"] == 580_000
    assert thang_nay["paid_in_period"] == 300_000

    # Kỳ năm trước: chưa có gì xảy ra ⇒ không nợ, không phát sinh ⇒ không có dòng, kể cả khi bật
    # "hiện cả NCC đã trả hết" (cờ đó chỉ giữ người CÓ phát sinh mà đã về 0).
    nam_truoc = _payables(client, h, **_ky_nam_truoc())
    assert all(x["supplier_id"] != ncc["id"] for x in nam_truoc["items"])
    assert nam_truoc["total_due"] == 0 and nam_truoc["paid_in_period"] == 0
    nam_truoc_ca = _payables(client, h, ca_da_tra_het=True, **_ky_nam_truoc())
    assert all(x["supplier_id"] != ncc["id"] for x in nam_truoc_ca["items"])

    # Trả nốt ⇒ còn nợ 0: mặc định ẨN khỏi danh sách (tổng "đã trả" vẫn đếm), bật cờ thì hiện.
    _phieu_chi(client, h, don["id"], 580_000, delivery_id=dot_id)
    an = _payables(client, h, **_ky_thang_nay())
    assert all(x["supplier_id"] != ncc["id"] for x in an["items"])
    assert an["paid_in_period"] == 880_000
    hien = _payables(client, h, ca_da_tra_het=True, **_ky_thang_nay())
    m = next(x for x in hien["items"] if x["supplier_id"] == ncc["id"])
    assert m["total_due"] == 0 and m["paid_in_period"] == 880_000

    # Chi tiết theo kỳ: tab Đã trả chỉ lấy phiếu trong kỳ.
    ct = client.get(f"/api/accounting/payables/{ncc['id']}", headers=h, params=_ky_thang_nay())
    assert ct.status_code == 200, ct.text
    assert sum(p["amount"] for p in ct.json()["paid"]) == 880_000
    ct_cu = client.get(f"/api/accounting/payables/{ncc['id']}", headers=h, params=_ky_nam_truoc())
    assert ct_cu.status_code == 200, ct_cu.text
    assert ct_cu.json()["paid"] == []


def test_loc_khoang_no_va_han_muc(client):
    h = _headers(client)
    nho, _, _ = _ncc_co_no(client, h, name="NCC No Nho", quantity=400)      # 880.000
    lon, _, _ = _ncc_co_no(client, h, name="NCC No Lon", quantity=4000)     # 8.800.000
    ky = _ky_thang_nay()

    ids = {x["supplier_id"] for x in _payables(client, h, no_tu=1_000_000, **ky)["items"]}
    assert ids == {lon["id"]}
    ids = {x["supplier_id"] for x in _payables(client, h, no_den=1_000_000, **ky)["items"]}
    assert ids == {nho["id"]}

    # Chưa ai đặt hạn mức ⇒ cả hai "chưa đặt", không ai "vượt".
    assert {x["supplier_id"] for x in _payables(client, h, han_muc="chua_dat", **ky)["items"]} == {
        nho["id"], lon["id"]
    }
    assert _payables(client, h, han_muc="vuot", **ky)["items"] == []

    _sua_ncc(client, h, lon, credit_limit=1_000_000)       # nợ 8,8tr > 1tr ⇒ vượt
    _sua_ncc(client, h, nho, credit_limit=1_000_000)       # nợ 880k = 88% ⇒ trên 80%, chưa vượt
    vuot = _payables(client, h, han_muc="vuot", **ky)
    assert {x["supplier_id"] for x in vuot["items"]} == {lon["id"]}
    tren_80 = _payables(client, h, han_muc="tren_80", **ky)
    assert {x["supplier_id"] for x in tren_80["items"]} == {nho["id"], lon["id"]}
    assert _payables(client, h, han_muc="chua_dat", **ky)["items"] == []

    # Lọc chọn DÒNG, không đổi số tổng đầu màn.
    assert vuot["total_due"] == 880_000 + 8_800_000
    # `dem_only` ⇒ không trả dòng, chỉ trả số đếm.
    dem = _payables(client, h, han_muc="vuot", dem_only=True, **ky)
    assert dem["items"] == [] and dem["total"] == 1


def test_loc_han_tra(client):
    h = _headers(client)
    ncc = _supplier(client, h, name="NCC Han Tra")
    don = _don(client, h, ncc["id"], quantity=400)
    _da_mua(client, h, don["id"])
    han = (_hom_nay() + timedelta(days=5)).isoformat()
    _ghi_dot(client, h, don["id"], lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 400}], han=han)
    ky = _ky_thang_nay()
    m = next(x for x in _payables(client, h, **ky)["items"] if x["supplier_id"] == ncc["id"])
    assert m["han_gan_nhat"] == han
    assert {x["supplier_id"] for x in _payables(client, h, han_tra="7_ngay", **ky)["items"]} == {ncc["id"]}
    assert {x["supplier_id"] for x in _payables(client, h, han_tra="30_ngay", **ky)["items"]} == {ncc["id"]}
    assert _payables(client, h, han_tra="qua_han", **ky)["items"] == []


def _mot_ncc(body: dict, supplier_id: int) -> dict | None:
    return next((m for m in body["items"] if m["supplier_id"] == supplier_id), None)


def test_coc_don_khac_ky_den_hom_nay_van_theo_anh_chup(client):
    """Sổ 331 cộng RÒNG theo NCC nên cọc thừa của đơn 1 bù sang nợ đơn 2 (ra −120.000). Kỳ kết thúc
    hôm nay thì còn nợ phải theo ảnh chụp: 880.000 — đúng như màn không kỳ."""
    h = _headers(client)
    ncc = _supplier(client, h, name="NCC Coc Don Khac")
    d1 = _don(client, h, ncc["id"], coc=1_000_000)
    _phieu_chi(client, h, d1["id"], 1_000_000, stage="advance")   # cọc, chưa giao gì
    d2 = _don(client, h, ncc["id"], quantity=1000)
    _da_mua(client, h, d2["id"])
    _ghi_dot(client, h, d2["id"], lines=[{"purchase_request_line_id": _dong_dau_tien(d2), "quantity": 400}])

    cu = _mot_ncc(_payables(client, h), ncc["id"])
    moi = _mot_ncc(_payables(client, h, **_ky_thang_nay()), ncc["id"])
    assert cu["total_due"] == 880_000
    assert moi["total_due"] == cu["total_due"]
    assert moi["overdue_amount"] == cu["overdue_amount"]
    assert moi["aging"] == cu["aging"]
    # "Đã trả trong kỳ" theo phiếu chi trong kỳ, "mua thêm" theo PS Có của sổ.
    assert moi["paid_in_period"] == 1_000_000
    assert moi["mua_trong_ky"] == 880_000


def test_don_nhan_kieu_cu_khong_dot_ky_den_hom_nay_van_con_no(client):
    """Đơn nhận bằng `mark-received` (không có đợt giao) — sổ 331 không thấy nợ của nó. Kỳ kết thúc
    hôm nay thì nợ vẫn phải hiện, đúng bằng ảnh chụp."""
    h = _headers(client)
    ncc = _supplier(client, h, name="NCC Nhan Kieu Cu")
    don = _don(client, h, ncc["id"])
    _ve_hang(client, h, don["id"])

    cu = _mot_ncc(_payables(client, h), ncc["id"])
    moi = _mot_ncc(_payables(client, h, **_ky_thang_nay()), ncc["id"])
    assert cu is not None and cu["total_due"] == 2_200_000
    assert moi is not None, "nợ của đơn không có đợt giao biến mất khi chọn kỳ"
    assert moi["total_due"] == cu["total_due"]
    assert moi["aging"] == cu["aging"]


def test_ky_da_qua_du_am_thi_con_no_bang_0(client):
    """Kỳ đã qua dùng dư cuối kỳ của sổ 331 — cọc chi trong kỳ, hàng chưa về ⇒ sổ dư NỢ (NCC nợ lại
    mình). Màn công nợ không hiện số âm: còn nợ = 0, nhưng vẫn thấy tiền đã chi trong kỳ."""
    from app.models.accounting import PaymentVoucher

    h = _headers(client)
    ncc = _supplier(client, h, name="NCC Ky Qua Du Am")
    don = _don(client, h, ncc["id"], coc=500_000)
    phieu = _phieu_chi(client, h, don["id"], 500_000, stage="advance")
    # Lùi ngày chi về 10 ngày trước — phiếu lập qua API luôn mang ngày chi hôm nay.
    hn = _hom_nay()
    lui = hn - timedelta(days=10)
    db = SessionLocal()
    try:
        v = db.get(PaymentVoucher, phieu["id"])
        v.voucher_date = lui
        v.paid_at = v.paid_at.replace(year=lui.year, month=lui.month, day=lui.day) if v.paid_at else None
        db.commit()
    finally:
        db.close()
    ky = {"tu_ngay": (hn - timedelta(days=30)).isoformat(), "den_ngay": (hn - timedelta(days=1)).isoformat()}

    so = client.get("/api/accounting/reports/payables", headers=h, params=ky)
    assert so.status_code == 200, so.text
    dong = next(d for d in so.json()["items"] if d["doi_tuong_id"] == ncc["id"])
    assert dong["cuoi_no"] == 500_000 and dong["cuoi_co"] == 0, "tiền đề: sổ đang dư âm"

    an = _payables(client, h, **ky)
    assert _mot_ncc(an, ncc["id"]) is None          # còn nợ 0 ⇒ ẩn mặc định
    assert an["total_due"] == 0
    assert an["paid_in_period"] == 500_000
    hien = _mot_ncc(_payables(client, h, ca_da_tra_het=True, **ky), ncc["id"])
    assert hien["total_due"] == 0
    assert hien["overdue_amount"] == 0 and hien["no_han_amount"] == 0
    assert all(c["amount"] == 0 for c in hien["aging"].values())
    assert hien["paid_in_period"] == 500_000


def _ky_qua_khu() -> dict[str, str]:
    """[hôm nay − 30, hôm qua] — kỳ đã QUA, số còn nợ phải lấy từ sổ."""
    hn = _hom_nay()
    return {"tu_ngay": (hn - timedelta(days=30)).isoformat(), "den_ngay": (hn - timedelta(days=1)).isoformat()}


def _so_tong_hop(client, h, ben: str, ky: dict) -> dict:
    r = client.get(f"/api/accounting/reports/{ben}", headers=h, params=ky)
    assert r.status_code == 200, r.text
    return {d["doi_tuong_id"]: d for d in r.json()["items"]}


def test_ky_da_qua_du_duong_lay_tu_so_331(client):
    """Kỳ đã qua: còn nợ = dư Có − dư Nợ cuối kỳ của sổ 331, tuổi nợ = tuổi nợ của sổ tại `den_ngay`.
    Tiền trả SAU kỳ (hôm nay) không được làm nhẹ nợ của kỳ cũ — khác hẳn ảnh chụp hôm nay."""
    h = _headers(client)
    hn = _hom_nay()
    ngay_giao = (hn - timedelta(days=10)).isoformat()
    han = (hn - timedelta(days=5)).isoformat()   # tới `den_ngay` (hôm qua) đã trễ 4 ngày

    # NCC A: giao 10 ngày trước 880.000, hôm nay mới trả 300.000.
    a = _supplier(client, h, name="NCC Qua Khu A")
    don_a = _don(client, h, a["id"], quantity=400)
    _da_mua(client, h, don_a["id"])
    sau = _ghi_dot(client, h, don_a["id"], ngay=ngay_giao, han=han,
                   lines=[{"purchase_request_line_id": _dong_dau_tien(don_a), "quantity": 400}])
    _phieu_chi(client, h, don_a["id"], 300_000, delivery_id=sau["deliveries"][-1]["id"])

    # NCC B: giao 10 ngày trước 880.000, hôm nay trả HẾT ⇒ hôm nay không còn gì, dòng của kỳ cũ chỉ
    # có trong sổ (nhánh dựng dòng từ sổ).
    b = _supplier(client, h, name="NCC Qua Khu B")
    don_b = _don(client, h, b["id"], quantity=400)
    _da_mua(client, h, don_b["id"])
    sau = _ghi_dot(client, h, don_b["id"], ngay=ngay_giao,
                   lines=[{"purchase_request_line_id": _dong_dau_tien(don_b), "quantity": 400}])
    _phieu_chi(client, h, don_b["id"], 880_000, delivery_id=sau["deliveries"][-1]["id"])

    # Tiền đề: ảnh chụp hôm nay đã khác — A còn 580.000, B không còn dòng.
    hom_nay = _payables(client, h)
    assert _mot_ncc(hom_nay, a["id"])["total_due"] == 580_000
    assert _mot_ncc(hom_nay, b["id"])["total_due"] == 0

    ky = _ky_qua_khu()
    so = _so_tong_hop(client, h, "payables", ky)
    body = _payables(client, h, **ky)
    for ncc in (a, b):
        m = _mot_ncc(body, ncc["id"])
        assert m is not None, ncc["name"]
        dong = so[ncc["id"]]
        assert m["total_due"] == dong["cuoi_co"] - dong["cuoi_no"] == 880_000
        assert m["aging"] == dong["aging"]
        assert m["mua_trong_ky"] == dong["ps_co"] == 880_000
        assert m["paid_in_period"] == 0          # tiền chi hôm nay, ngoài kỳ
    assert _mot_ncc(body, a["id"])["aging"]["d1_7"] == {"amount": 880_000, "count": 1}
    assert _mot_ncc(body, a["id"])["overdue_amount"] == 880_000
    assert _mot_ncc(body, b["id"])["supplier_name"] == "NCC Qua Khu B"
    assert body["total_due"] == 1_760_000
    assert body["den_ngay"] == ky["den_ngay"]


def test_den_ngay_tuong_lai_chan_ve_hom_nay(client):
    h = _headers(client)
    ncc = _supplier(client, h, name="NCC Ky Tuong Lai")
    don = _don(client, h, ncc["id"], quantity=400)
    _da_mua(client, h, don["id"])
    hn = _hom_nay()
    han = (hn + timedelta(days=5)).isoformat()
    _ghi_dot(client, h, don["id"], han=han,
             lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 400}])
    ky = {"tu_ngay": hn.replace(day=1).isoformat(), "den_ngay": (hn + timedelta(days=20)).isoformat()}
    body = _payables(client, h, han_tra="7_ngay", **ky)
    # Mốc "tới hạn trong 7 ngày" đếm từ hôm nay, không từ hôm nay + 20.
    assert {x["supplier_id"] for x in body["items"]} == {ncc["id"]}
    assert body["den_ngay"] == hn.isoformat()
    assert _mot_ncc(body, ncc["id"])["total_due"] == 880_000


# --- PHẢI THU ---------------------------------------------------------------


def test_phai_thu_loc_nguoi_phu_trach(client):
    h = _headers(client)
    sale_a = _user_id("sale-a-ky")
    sale_b = _user_id("sale-b-ky")
    order_a, kh_a = _sales_order(total=300_000, suffix="A1", sale_user_id=sale_a)
    order_b, kh_b = _sales_order(total=700_000, suffix="B1", sale_user_id=sale_b)
    for order_id, so in ((order_a, "KY-0001"), (order_b, "KY-0002")):
        r = client.post("/api/accounting/sales-invoices", json=_invoice_payload(order_id, number=so), headers=h)
        assert r.status_code == 201, r.text

    ky = _ky_thang_nay()
    r = client.get("/api/accounting/receivables", headers=h, params={"phu_trach_id": sale_a, **ky})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [x["customer_id"] for x in body["items"]] == [kh_a]
    assert body["items"][0]["sale_user_id"] == sale_a
    assert body["items"][0]["ban_trong_ky"] == 300_000
    assert body["items"][0]["total_due"] == 300_000
    assert body["items"][0]["han_gan_nhat"] == (_hom_nay() + timedelta(days=30)).isoformat()
    # Tổng đầu màn là của TOÀN BỘ khách, không đổi theo bộ lọc.
    assert body["ban_trong_ky"] == 1_000_000
    assert body["total_due"] == 1_000_000

    # Nhãn khách hàng: chỉ khách B mang nhãn "Đại lý".
    db = SessionLocal()
    try:
        db.add(CustomerTag(customer_id=kh_b, label="Đại lý"))
        db.commit()
    finally:
        db.close()
    r = client.get("/api/accounting/receivables", headers=h, params={"nhan": "đại lý", **ky})
    assert r.status_code == 200, r.text
    assert [x["customer_id"] for x in r.json()["items"]] == [kh_b]

    # Không có kỳ ⇒ hành vi cũ vẫn chạy và vẫn mang `sale_user_id`.
    cu = client.get("/api/accounting/receivables", headers=h, params={"phu_trach_id": sale_b}).json()
    assert [x["customer_id"] for x in cu["items"]] == [kh_b]


def _hoa_don_lui_ngay(client, h, *, suffix: str, total: int) -> tuple[int, int, int]:
    """Khách + hoá đơn `total` đã phát hành, rồi LÙI ngày hoá đơn về 10 ngày trước, hạn 5 ngày trước
    (API chỉ lập hoá đơn đề hôm nay). Trả (order_id, customer_id, invoice_id)."""
    from app.models.accounting import SalesInvoice

    order_id, kh = _sales_order(total=total, suffix=suffix)
    r = client.post("/api/accounting/sales-invoices", json=_invoice_payload(order_id, number=f"QK-{suffix}"), headers=h)
    assert r.status_code == 201, r.text
    hn = _hom_nay()
    db = SessionLocal()
    try:
        hd = db.get(SalesInvoice, r.json()["id"])
        hd.invoice_date = hn - timedelta(days=10)
        hd.due_date = hn - timedelta(days=5)
        db.commit()
    finally:
        db.close()
    return order_id, kh, r.json()["id"]


def _thu_coc_hom_nay(order_id: int, amount: int) -> None:
    """Phiếu thu cọc của đơn, đề HÔM NAY (chép từ `_add_deposit` của test_sales_invoices_api)."""
    from app.models.accounting import PAYMENT_RECEIPT_RECEIVED, RECEIPT_SOURCE_ORDER, PaymentReceipt
    from app.models.user import User

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").one()
        db.add(PaymentReceipt(
            code=f"PT-KY-{order_id}-{amount}", source_type=RECEIPT_SOURCE_ORDER, order_id=order_id,
            order_no_snapshot=f"DH-{order_id}", customer_name_snapshot="Khach ky",
            payer_name="Khach ky", receipt_method="cash", status=PAYMENT_RECEIPT_RECEIVED,
            receipt_date=_hom_nay(), amount=amount, amount_vnd=amount, currency="VND",
            exchange_rate=1, content="Coc don", created_by_user_id=admin.id,
            received_by_user_id=admin.id,
        ))
        db.commit()
    finally:
        db.close()


def test_phai_thu_ky_da_qua_du_duong_lay_tu_so_131(client):
    """Kỳ đã qua: còn nợ = dư Nợ − dư Có cuối kỳ sổ 131, tuổi nợ tại `den_ngay`, bán thêm = PS Nợ.
    Tiền thu HÔM NAY (sau kỳ) không làm nhẹ nợ của kỳ cũ."""
    h = _headers(client)
    order_id, kh, _ = _hoa_don_lui_ngay(client, h, suffix="QK1", total=300_000)
    _thu_coc_hom_nay(order_id, 100_000)

    hom_nay = client.get("/api/accounting/receivables", headers=h).json()
    assert next(x for x in hom_nay["items"] if x["customer_id"] == kh)["total_due"] == 200_000

    ky = _ky_qua_khu()
    so = _so_tong_hop(client, h, "receivables", ky)
    r = client.get("/api/accounting/receivables", headers=h, params=ky)
    assert r.status_code == 200, r.text
    m = next(x for x in r.json()["items"] if x["customer_id"] == kh)
    dong = so[kh]
    assert m["total_due"] == dong["cuoi_no"] - dong["cuoi_co"] == 300_000
    assert m["aging"] == dong["aging"]
    assert m["aging"]["d1_7"] == {"amount": 300_000, "count": 1}
    assert m["overdue_amount"] == 300_000
    assert m["ban_trong_ky"] == dong["ps_no"] == 300_000
    assert m["received_in_period"] == 0


def test_phai_thu_chi_tiet_theo_ky(client):
    """`/receivables/{id}` có kỳ: tab Đã thu chỉ lấy phiếu thu trong kỳ; hoá đơn còn nợ vẫn của hôm nay."""
    h = _headers(client)
    order_id, kh, hd_id = _hoa_don_lui_ngay(client, h, suffix="QK2", total=300_000)
    _thu_coc_hom_nay(order_id, 100_000)

    thang_nay = client.get(f"/api/accounting/receivables/{kh}", headers=h, params=_ky_thang_nay())
    assert thang_nay.status_code == 200, thang_nay.text
    assert [p["amount"] for p in thang_nay.json()["paid"]] == [100_000]
    assert thang_nay.json()["received_in_period"] == 100_000

    qua_khu = client.get(f"/api/accounting/receivables/{kh}", headers=h, params=_ky_qua_khu())
    assert qua_khu.status_code == 200, qua_khu.text
    body = qua_khu.json()
    assert body["paid"] == [] and body["received_in_period"] == 0
    assert [i["invoice_id"] for i in body["items"]] == [hd_id]
    assert body["total_due"] == 200_000            # còn nợ = của hôm nay

    thieu = client.get(f"/api/accounting/receivables/{kh}", headers=h,
                       params={"tu_ngay": _ky_qua_khu()["tu_ngay"]})
    assert thieu.status_code == 422


def test_tu_ngay_sau_den_ngay_422(client):
    h = _headers(client); hn = accounting_service._business_today()
    r = client.get("/api/accounting/receivables", headers=h,
                   params={"tu_ngay": hn.isoformat(), "den_ngay": (hn - timedelta(days=1)).isoformat()})
    assert r.status_code == 422
    # Chỉ một trong hai ⇒ 422 với câu dễ hiểu.
    for url in ("/api/accounting/receivables", "/api/accounting/payables"):
        r = client.get(url, headers=h, params={"tu_ngay": hn.isoformat()})
        assert r.status_code == 422
        assert r.json()["detail"] == "Chọn đủ từ ngày và đến ngày."


# --- Fix round 1 Task 7 (06/10/2026): số nhóm nút, trang "đã trả", lọc thiếu hoá đơn ----------


def test_phai_tra_the_loc_dem_truoc_nut_dang_chon(client):
    """`the_loc` = số NCC của "Tất cả | Quá hạn | Vượt hạn mức", đếm SAU tìm / bộ lọc nâng cao,
    TRƯỚC `filter` — đổi nút đang chọn không đổi ba số; bộ lọc nâng cao thì có đổi."""
    h = _headers(client)
    hn = _hom_nay()
    tre = _supplier(client, h, name="TLoc Tre")
    don = _don(client, h, tre["id"], quantity=400); _da_mua(client, h, don["id"])
    _ghi_dot(client, h, don["id"], lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 400}],
             ngay=(hn - timedelta(days=10)).isoformat(), han=(hn - timedelta(days=3)).isoformat())
    vuot, _, _ = _ncc_co_no(client, h, name="TLoc Vuot", quantity=4000)       # 8.800.000
    _sua_ncc(client, h, vuot, credit_limit=1_000_000)
    _ncc_co_no(client, h, name="TLoc Thuong", quantity=400)

    ca = _payables(client, h, q="TLoc")
    assert ca["the_loc"] == {"tat_ca": 3, "qua_han": 1, "vuot_han_muc": 1}
    qh = _payables(client, h, q="TLoc", filter="overdue")
    assert [x["supplier_id"] for x in qh["items"]] == [tre["id"]]
    assert qh["the_loc"] == ca["the_loc"]
    vh = _payables(client, h, q="TLoc", filter="vuot_han_muc")
    assert vh["total"] == 1 and vh["the_loc"] == ca["the_loc"]
    # Bộ lọc nâng cao đi TRƯỚC ba số: còn nợ ≥ 1 triệu chỉ còn NCC vượt.
    lon = _payables(client, h, q="TLoc", no_tu=1_000_000)
    assert lon["the_loc"] == {"tat_ca": 1, "qua_han": 0, "vuot_han_muc": 1}
    # `dem_only` vẫn mang ba số (không phải gọi riêng từng nút).
    assert _payables(client, h, q="TLoc", dem_only=True)["the_loc"] == ca["the_loc"]


def test_phai_thu_the_loc_dem_truoc_nut_dang_chon(client):
    h = _headers(client)
    _, kh_tre, _ = _hoa_don_lui_ngay(client, h, suffix="TL1", total=300_000)   # quá hạn 5 ngày
    order_vuot, kh_vuot = _sales_order(total=700_000, suffix="TL2")            # hạn mức 500.000
    r = client.post("/api/accounting/sales-invoices", json=_invoice_payload(order_vuot, number="TL-0002"), headers=h)
    assert r.status_code == 201, r.text

    def _thu(**p) -> dict:
        r = client.get("/api/accounting/receivables", headers=h, params={"q": "Khach ky TL", **p})
        assert r.status_code == 200, r.text
        return r.json()

    ca = _thu()
    assert ca["the_loc"] == {"tat_ca": 2, "qua_han": 1, "vuot_han_muc": 1, "tra_coc": 0}
    qh = _thu(filter="overdue")
    assert [x["customer_id"] for x in qh["items"]] == [kh_tre]
    assert qh["the_loc"] == ca["the_loc"]
    vh = _thu(filter="vuot_han_muc")
    assert [x["customer_id"] for x in vh["items"]] == [kh_vuot]
    assert vh["the_loc"] == ca["the_loc"]
    assert _thu(no_tu=500_000)["the_loc"] == {"tat_ca": 1, "qua_han": 0, "vuot_han_muc": 1, "tra_coc": 0}


def test_chi_tiet_phai_tra_phan_trang_da_tra(client):
    """`paid_page`/`paid_size` cắt rổ "đã chi" ở MÁY CHỦ (nút "Xem thêm"); `paid_total` và
    `paid_in_period` vẫn là của cả phạm vi. Không truyền `paid_size` = trả trọn như cũ."""
    h = _headers(client)
    ncc, don, dot_id = _ncc_co_no(client, h, name="NCC Trang Da Tra", quantity=400)   # 880.000
    ma = [_phieu_chi(client, h, don["id"], so, delivery_id=dot_id)["code"] for so in (100_000, 200_000, 300_000)]

    def _ct(**p) -> dict:
        r = client.get(f"/api/accounting/payables/{ncc['id']}", headers=h, params=p)
        assert r.status_code == 200, r.text
        return r.json()

    tron = _ct()
    assert tron["paid_total"] == 3 and len(tron["paid"]) == 3
    t1 = _ct(paid_page=1, paid_size=2)
    t2 = _ct(paid_page=2, paid_size=2)
    assert len(t1["paid"]) == 2 and len(t2["paid"]) == 1
    assert t1["paid_total"] == t2["paid_total"] == 3
    assert t1["paid_in_period"] == t2["paid_in_period"] == 600_000
    # Hai trang nối lại đúng bằng danh sách trọn, không trùng không sót.
    assert [p["voucher_id"] for p in t1["paid"] + t2["paid"]] == [p["voucher_id"] for p in tron["paid"]]
    assert {p["code"] for p in tron["paid"]} == set(ma)
    assert _ct(paid_page=3, paid_size=2)["paid"] == []
    assert client.get(f"/api/accounting/payables/{ncc['id']}", headers=h,
                      params={"paid_size": 0}).status_code == 422


def test_loc_co_dot_giao_chua_ghi_hoa_don(client):
    """`thieu_hoa_don` giữ NCC còn ít nhất một đợt CÒN NỢ chưa ghi số hoá đơn."""
    h = _headers(client)
    thieu, _, _ = _ncc_co_no(client, h, name="HDon Thieu", quantity=400)
    du = _supplier(client, h, name="HDon Du")
    don = _don(client, h, du["id"], quantity=400); _da_mua(client, h, don["id"])
    r = client.post(
        f"/api/purchase-requests/{don['id']}/deliveries",
        json={"delivery_date": _hom_nay().isoformat(), "due_date": None, "invoice_number": "0001234",
              "invoice_date": _hom_nay().isoformat(),
              "lines": [{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 400}]},
        headers=h,
    )
    assert r.status_code == 200, r.text

    assert {x["supplier_id"] for x in _payables(client, h, q="HDon")["items"]} == {thieu["id"], du["id"]}
    loc = _payables(client, h, q="HDon", thieu_hoa_don=True)
    assert [x["supplier_id"] for x in loc["items"]] == [thieu["id"]]
    assert loc["the_loc"]["tat_ca"] == 1
    # Chọn DÒNG, không đổi tổng đầu màn.
    assert loc["total_due"] == _payables(client, h, q="HDon")["total_due"]


# --- Task 8 (06/10/2026): tab Đã thu phân trang; khoá nội bộ không lọt ra ----------------------


def test_chi_tiet_phai_thu_phan_trang_da_thu(client):
    """`paid_page`/`paid_size` cắt rổ "đã thu" ở MÁY CHỦ (nút "Xem thêm" của ngăn khách hàng);
    `paid_total` và `received_in_period` vẫn là của cả phạm vi. Không truyền = trả trọn như cũ."""
    h = _headers(client)
    order_id, kh = _sales_order(total=900_000, suffix="PG1")
    r = client.post("/api/accounting/sales-invoices", json=_invoice_payload(order_id, number="PG-0001"), headers=h)
    assert r.status_code == 201, r.text
    hd_id = r.json()["id"]
    for so in (100_000, 200_000, 300_000):
        thu = client.post(
            f"/api/accounting/sales-invoices/{hd_id}/receipts",
            json={"payer_name": "Khach PG1", "receipt_method": "cash", "receipt_date": _hom_nay().isoformat(),
                  "amount": so, "content": f"Thu {so}"},
            headers=h,
        )
        assert thu.status_code == 201, thu.text

    def _ct(**p) -> dict:
        r = client.get(f"/api/accounting/receivables/{kh}", headers=h, params={**_ky_thang_nay(), **p})
        assert r.status_code == 200, r.text
        return r.json()

    tron = _ct()
    assert tron["paid_total"] == 3 and len(tron["paid"]) == 3
    t1 = _ct(paid_page=1, paid_size=2)
    t2 = _ct(paid_page=2, paid_size=2)
    assert len(t1["paid"]) == 2 and len(t2["paid"]) == 1
    assert t1["paid_total"] == t2["paid_total"] == 3
    assert t1["received_in_period"] == t2["received_in_period"] == 600_000
    # Hai trang nối lại đúng bằng danh sách trọn (mới nhất trước), không trùng không sót.
    assert [p["receipt_id"] for p in t1["paid"] + t2["paid"]] == [p["receipt_id"] for p in tron["paid"]]
    assert _ct(paid_page=3, paid_size=2)["paid"] == []
    # Hoá đơn còn nợ không bị cắt theo trang "đã thu".
    assert [i["invoice_id"] for i in t2["items"]] == [hd_id]
    assert client.get(f"/api/accounting/receivables/{kh}", headers=h,
                      params={"paid_size": 0}).status_code == 422
    assert client.get(f"/api/accounting/receivables/{kh}", headers=h,
                      params={"paid_size": 201}).status_code == 422


def test_loc_thieu_hoa_don_khong_lo_khoa_noi_bo(client):
    """Khoá phụ `_thieu_hoa_don` chỉ để lọc — dict trả từ service không còn mang nó."""
    from app.repositories.accounting_repo import AccountingRepository
    from app.repositories.audit_repo import AuditLogRepository
    from app.repositories.document_sequence_repo import DocumentSequenceRepository
    from app.repositories.purchase_repo import PurchaseRequestRepository, SupplierRepository
    from app.services.accounting_service import AccountingService
    from app.services.sequence_service import SequenceService

    h = _headers(client)
    ncc, _, _ = _ncc_co_no(client, h, name="HDon Khoa Noi Bo", quantity=400)
    db = SessionLocal()
    try:
        svc = AccountingService(
            AccountingRepository(db), PurchaseRequestRepository(db), SupplierRepository(db),
            UserRepository(db), AuditLogRepository(db), SequenceService(DocumentSequenceRepository(db)),
        )
        kq = svc.payables_summary(q="HDon Khoa", thieu_hoa_don=True)
    finally:
        db.close()
    assert [m["supplier_id"] for m in kq["items"]] == [ncc["id"]]
    assert all(not any(k.startswith("_") for k in m) for m in kq["items"])


# --- Vòng sửa cuối (06/10/2026): `chi_tong` + nạp một lần ----------------------------------------

_SO_TONG = (
    "total_due", "overdue_amount", "aging", "vuot_han_muc_count", "period_months",
    "tu_ngay", "den_ngay", "as_of",
)


def _dung_phai_tra_nhieu_dang(client, h) -> None:
    """Ba NCC: một trễ hạn (đã trả một phần), một vượt hạn mức, một đã trả hết trong kỳ."""
    hn = _hom_nay()
    tre = _supplier(client, h, name="CT Tre")
    don = _don(client, h, tre["id"], quantity=400); _da_mua(client, h, don["id"])
    sau = _ghi_dot(client, h, don["id"], lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 400}],
                   ngay=(hn - timedelta(days=10)).isoformat(), han=(hn - timedelta(days=3)).isoformat())
    _phieu_chi(client, h, don["id"], 300_000, delivery_id=sau["deliveries"][-1]["id"])
    vuot, _, _ = _ncc_co_no(client, h, name="CT Vuot", quantity=4000)
    _sua_ncc(client, h, vuot, credit_limit=1_000_000)
    _, don_het, dot_het = _ncc_co_no(client, h, name="CT Het", quantity=400)
    _phieu_chi(client, h, don_het["id"], 880_000, delivery_id=dot_het)


def test_phai_tra_chi_tong_bang_dung_so_tong_cua_loi_thuong(client):
    """`chi_tong=true` trả items rỗng nhưng MỌI số tổng bằng đúng lời thường cùng tham số — kỳ kết
    thúc hôm nay lẫn kỳ đã qua, có hay không bộ lọc dòng."""
    h = _headers(client)
    _dung_phai_tra_nhieu_dang(client, h)
    for ky in (_ky_thang_nay(), _ky_qua_khu(), _ky_nam_truoc()):
        for loc in ({}, {"q": "CT"}, {"filter": "overdue"}, {"han_muc": "vuot"}, {"aging_bucket": "d1_7"},
                    {"thieu_hoa_don": True}, {"ca_da_tra_het": True}):
            thuong = _payables(client, h, **ky, **loc)
            tong = _payables(client, h, **ky, **loc, chi_tong=True, page=1, size=1)
            assert tong["items"] == []
            for k in (*_SO_TONG, "paid_in_period", "mua_trong_ky"):
                assert tong[k] == thuong[k], (ky, loc, k)
    # Tiền đề: dữ liệu có thật (khỏi so hai bộ số 0).
    co = _payables(client, h, **_ky_thang_nay(), chi_tong=True)
    assert co["total_due"] > 0 and co["overdue_amount"] > 0 and co["paid_in_period"] > 0
    assert co["mua_trong_ky"] > 0 and co["vuot_han_muc_count"] == 1
    # Không bật cờ thì vẫn là lời thường: có dòng.
    assert _payables(client, h, **_ky_thang_nay())["items"]


def test_phai_thu_chi_tong_bang_dung_so_tong_cua_loi_thuong(client):
    h = _headers(client)
    order_tre, _, _ = _hoa_don_lui_ngay(client, h, suffix="CT1", total=300_000)   # trễ 5 ngày
    _thu_coc_hom_nay(order_tre, 100_000)
    order_vuot, _ = _sales_order(total=700_000, suffix="CT2")                      # hạn mức 500.000
    r = client.post("/api/accounting/sales-invoices", json=_invoice_payload(order_vuot, number="CT-0002"), headers=h)
    assert r.status_code == 201, r.text

    so_thu = (*_SO_TONG, "received_in_period", "ban_trong_ky")
    for ky in (_ky_thang_nay(), _ky_qua_khu(), _ky_nam_truoc()):
        for loc in ({}, {"q": "Khach ky CT"}, {"filter": "overdue"}, {"han_muc": "vuot"},
                    {"aging_bucket": "d1_7"}, {"nhan": "Đại lý"}, {"ca_da_tra_het": True}):
            r1 = client.get("/api/accounting/receivables", headers=h, params={**ky, **loc})
            r2 = client.get("/api/accounting/receivables", headers=h,
                            params={**ky, **loc, "chi_tong": True, "page": 1, "size": 1})
            assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
            thuong, tong = r1.json(), r2.json()
            assert tong["items"] == []
            for k in so_thu:
                assert tong[k] == thuong[k], (ky, loc, k)
    co = client.get("/api/accounting/receivables", headers=h,
                    params={**_ky_thang_nay(), "chi_tong": True}).json()
    assert co["total_due"] == 900_000 and co["overdue_amount"] == 200_000
    # Hoá đơn CT1 đề hôm nay − 10 ngày: từ ngày 11 trong tháng nó rơi vào kỳ tháng này, nên
    # "bán trong kỳ" phụ thuộc lịch chạy test chứ không cố định 700.000.
    hn = _hom_nay()
    ban_trong_ky = 700_000 + (300_000 if hn - timedelta(days=10) >= hn.replace(day=1) else 0)
    assert co["ban_trong_ky"] == ban_trong_ky and co["received_in_period"] == 100_000
    assert co["vuot_han_muc_count"] == 1


def test_tong_hop_nap_san_va_bo_tuoi_khong_doi_so_cua_so(client):
    """`don_da_nap` / `hoa_don_da_nap` chỉ để khỏi nạp lại: số của sổ tổng hợp y hệt tự nạp. Còn
    `tinh_tuoi=False` chỉ làm rổ tuổi về 0, không đụng cột nào khác."""
    from app.models.accounting import SALES_INVOICE_ISSUED
    from app.repositories.accounting_repo import AccountingRepository
    from app.repositories.purchase_repo import PurchaseRequestRepository
    from app.services import bao_cao_cong_no

    h = _headers(client)
    _dung_phai_tra_nhieu_dang(client, h)
    order_id, _, _ = _hoa_don_lui_ngay(client, h, suffix="NS1", total=300_000)
    _thu_coc_hom_nay(order_id, 100_000)
    hn = _hom_nay()
    tu, den = hn.replace(day=1), hn

    db = SessionLocal()
    try:
        repo, mua = AccountingRepository(db), PurchaseRequestRepository(db)
        tra = bao_cao_cong_no.tong_hop_phai_tra(repo, mua, tu_ngay=tu, den_ngay=den)
        tra_san = bao_cao_cong_no.tong_hop_phai_tra(
            repo, mua, tu_ngay=tu, den_ngay=den, don_da_nap=mua.list_for_payables())
        assert tra_san == tra
        tra_khong_tuoi = bao_cao_cong_no.tong_hop_phai_tra(
            repo, mua, tu_ngay=tu, den_ngay=den, tinh_tuoi=False)
        assert tra["tong"]["cuoi_co"] > 0 and any(a["amount"] for a in tra["aging"])
        assert all(a["amount"] == 0 for a in tra_khong_tuoi["aging"])
        bo_tuoi = lambda bc: [{k: v for k, v in i.items() if k != "aging"} for i in bc["items"]]
        assert bo_tuoi(tra_khong_tuoi) == bo_tuoi(tra) and tra_khong_tuoi["tong"] == tra["tong"]

        thu = bao_cao_cong_no.tong_hop_phai_thu(repo, tu_ngay=tu, den_ngay=den)
        thu_san = bao_cao_cong_no.tong_hop_phai_thu(
            repo, tu_ngay=tu, den_ngay=den,
            hoa_don_da_nap=repo.list_sales_invoices(status=SALES_INVOICE_ISSUED))
        assert thu_san == thu
        thu_khong_tuoi = bao_cao_cong_no.tong_hop_phai_thu(repo, tu_ngay=tu, den_ngay=den, tinh_tuoi=False)
        assert any(a["amount"] for a in thu["aging"])
        assert all(a["amount"] == 0 for a in thu_khong_tuoi["aging"])
        assert bo_tuoi(thu_khong_tuoi) == bo_tuoi(thu) and thu_khong_tuoi["tong"] == thu["tong"]
    finally:
        db.close()
