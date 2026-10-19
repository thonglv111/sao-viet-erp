"""Phiếu "Nhà cung cấp hoàn tiền" làm TĂNG nợ phải trả ở MỌI màn (lỗi #36 bấm thử 18/10/2026).

Ngăn NCC sau phiếu hoàn: tab "Sao kê" cộng phiếu thu vào số dư (420.000), còn ô "Còn nợ tới …" và
danh sách Công nợ phải trả vẫn 370.000 — hai con số cho cùng một NCC trên cùng một ngăn.

Luật (đúng hạch toán 331, giống Sao kê): NCC trả lại tiền thì mình nợ họ thêm đúng số đó. Phiếu hoàn
lập thẳng cho NCC (không qua phiếu chi gốc) không gắn đơn ⇒ cộng vào đợt giao hạn MUỘN NHẤT của NCC
(đối xứng luật 17/10 bên phải thu); đợt đó mang khoản cộng lại riêng (`hoan_ncc`) để số đợt vẫn tự
giải thích được: giá trị − đã trả − cọc bù + hoàn = còn nợ.
"""
from __future__ import annotations

from tests.test_payables_api import (
    _cong_no,
    _cong_no_ncc,
    _da_mua,
    _don,
    _dong_dau_tien,
    _ghi_dot,
    _headers,
    _hom_nay,
    _supplier,
)


def _hoan(client, h, ncc: int, tien: int):
    r = client.post(f"/api/accounting/payables/{ncc}/refund-receipts", headers=h, json={
        "payer_name": "NCC", "receipt_method": "cash", "receipt_date": _hom_nay().isoformat(),
        "amount": tien, "currency": "VND", "exchange_rate": 1, "content": "NCC hoàn tiền",
    })
    assert r.status_code == 201, r.text


def test_phieu_hoan_ncc_tang_con_no_o_danh_sach_va_ngan(client):
    h = _headers(client)
    ncc = _supplier(client, h, name="NCC Hoàn Tiền Tăng Nợ")["id"]
    don = _don(client, h, ncc)
    _da_mua(client, h, don["id"])
    _ghi_dot(client, h, don["id"],
             lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 100}])
    truoc = _cong_no_ncc(client, h, ncc)["total_due"]
    assert truoc > 0

    _hoan(client, h, ncc, 50_000)

    ngan = _cong_no_ncc(client, h, ncc)
    assert ngan["total_due"] == truoc + 50_000
    dot = next(x for x in ngan["items"] if not x["da_tat_toan"])
    assert dot["hoan_ncc"] == 50_000 and dot["con_no"] == truoc + 50_000
    muc = next(m for m in _cong_no(client, h)["items"] if m["supplier_id"] == ncc)
    assert muc["total_due"] == truoc + 50_000


def test_ncc_da_tra_het_van_hien_khoan_hoan_o_dot_muon_nhat(client):
    """NCC không còn nợ gì mà vẫn hoàn tiền ⇒ mình nợ lại họ đúng số hoàn: đợt đã tất toán nhận khoản
    cộng lại và quay lại danh sách còn nợ."""
    from tests.test_payables_api import _phieu_chi

    h = _headers(client)
    ncc = _supplier(client, h, name="NCC Hoàn Khi Hết Nợ")["id"]
    don = _don(client, h, ncc)
    _da_mua(client, h, don["id"])
    _ghi_dot(client, h, don["id"],
             lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 100}])
    ngan = _cong_no_ncc(client, h, ncc)
    _phieu_chi(client, h, don["id"], amount=ngan["total_due"],
               stage="final", delivery_id=ngan["items"][0]["delivery_id"])
    assert _cong_no_ncc(client, h, ncc)["total_due"] == 0

    _hoan(client, h, ncc, 30_000)

    ngan = _cong_no_ncc(client, h, ncc)
    assert ngan["total_due"] == 30_000
    assert [(x["hoan_ncc"], x["con_no"], x["da_tat_toan"]) for x in ngan["items"]] == [(30_000, 30_000, False)]
    muc = next(m for m in _cong_no(client, h)["items"] if m["supplier_id"] == ncc)
    assert muc["total_due"] == 30_000


def test_ncc_hoan_lai_coc_du_khong_de_ra_no(client):
    """Cọc 500.000, mới nhận 100 tờ (220.000) ⇒ NCC đang giữ 280.000 cọc chưa dùng. NCC hoàn đúng
    280.000 đó ⇒ mình không nợ NCC đồng nào (rà cuối 19/10/2026: trước đây đợt hiện Còn nợ 280.000,
    kế toán trả lại lần nữa). Đối xứng phần thu vượt bên phải thu."""
    from tests.test_payables_api import _phieu_chi

    h = _headers(client)
    ncc = _supplier(client, h, name="NCC Hoàn Cọc Dư")["id"]
    don = _don(client, h, ncc, coc=500_000)
    _da_mua(client, h, don["id"])
    _phieu_chi(client, h, don["id"], amount=500_000)
    _ghi_dot(client, h, don["id"],
             lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 100}])
    assert _cong_no_ncc(client, h, ncc)["total_due"] == 0

    _hoan(client, h, ncc, 280_000)

    ngan = _cong_no_ncc(client, h, ncc)
    assert ngan["total_due"] == 0
    assert all(x["hoan_ncc"] == 0 for x in ngan["items"])
    assert all(m["supplier_id"] != ncc or m["total_due"] == 0 for m in _cong_no(client, h)["items"])

    # Hoàn vượt cọc dư 50.000 ⇒ chỉ phần vượt mới thành nợ.
    _hoan(client, h, ncc, 50_000)
    assert _cong_no_ncc(client, h, ncc)["total_due"] == 50_000
