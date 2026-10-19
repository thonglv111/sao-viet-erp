"""Tab "Mua hàng chờ chi" của màn Phiếu chi (docs/prd-mua-hang-cho-chi-o-phieu-chi.md, chủ 17/10/2026).

Khoá các luật người kế toán dựa vào:
  - Đơn vào tab khi ĐÃ DUYỆT và còn cọc chưa chi HOẶC còn đợt giao còn nợ — mỗi đơn MỘT dòng.
  - Đơn không cọc, chưa ghi đợt ⇒ không vào. Đơn chờ duyệt dù có cọc ⇒ không vào.
  - Đợt giao vào ngay khi ghi (không đợi tới hạn). Chi đủ ⇒ rời tab; huỷ phiếu ⇒ quay lại.
  - Quá hạn đứng đầu.
"""
from __future__ import annotations

from datetime import timedelta

from tests.test_payables_api import (
    _da_mua,
    _don,
    _dong_dau_tien,
    _ghi_dot,
    _headers,
    _hom_nay,
    _phieu_chi,
    _supplier,
    _token_vai,
)

URL = "/api/accounting/mua-hang-cho-chi"


def _hang(client, headers, **params) -> list[dict]:
    r = client.get(URL, headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _dong_cua(client, headers, don_id: int) -> dict | None:
    return next((x for x in _hang(client, headers) if x["don"]["id"] == don_id), None)


def test_don_co_coc_vao_tab_chi_du_coc_thi_roi(client):
    headers = _headers(client)
    ncc = _supplier(client, headers, name="NCC Cho Chi Coc")
    don = _don(client, headers, ncc["id"], coc=1_000_000)

    dong = _dong_cua(client, headers, don["id"])
    assert dong is not None, "đã duyệt + có cọc ⇒ phải vào tab"
    assert dong["coc_can_chi"] == 1_000_000
    assert dong["so_dot_no"] == 0 and dong["no_dot"] == 0
    assert dong["tong_can_chi"] == 1_000_000
    assert dong["han_gan_nhat"] is None and dong["qua_han"] is False
    # `don` là nguyên dòng đơn — form lập phiếu chi dùng thẳng.
    assert dong["don"]["code"] == don["code"]
    assert dong["don"]["tran_dat_coc"] == 1_000_000

    _phieu_chi(client, headers, don["id"], 400_000)
    assert _dong_cua(client, headers, don["id"])["coc_can_chi"] == 600_000

    _phieu_chi(client, headers, don["id"], 600_000)
    assert _dong_cua(client, headers, don["id"]) is None, "chi đủ cọc, chưa đợt nào ⇒ rời tab"


def test_don_khong_coc_chua_giao_khong_vao_ghi_dot_thi_vao_ngay(client):
    headers = _headers(client)
    ncc = _supplier(client, headers, name="NCC Cho Chi Dot")
    don = _don(client, headers, ncc["id"])
    _da_mua(client, headers, don["id"])
    assert _dong_cua(client, headers, don["id"]) is None, "không cọc, chưa giao ⇒ không có gì để chi"

    han = (_hom_nay() + timedelta(days=30)).isoformat()
    sau = _ghi_dot(
        client, headers, don["id"],
        lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 400}],
        han=han,
    )
    dong = _dong_cua(client, headers, don["id"])
    assert dong is not None, "đợt vào tab NGAY khi ghi, không đợi tới hạn"
    assert dong["coc_can_chi"] == 0
    assert dong["so_dot_no"] == 1
    assert dong["no_dot"] == 880_000  # 400 tờ × 2.200đ
    assert dong["han_gan_nhat"] == han
    assert dong["qua_han"] is False
    # Popup kể vật tư của đợt: đơn giá + thành tiền từng dòng, cộng lại đúng giá trị đợt.
    dot = dong["don"]["deliveries"][0]
    assert [(l["item_name"], l["quantity"], l["don_gia"], l["thanh_tien"]) for l in dot["lines"]] == [
        ("Giấy Duplex", 400, 2_200, 880_000)
    ]
    assert sum(l["thanh_tien"] for l in dot["lines"]) == dot["amount"]

    dot_id = sau["deliveries"][0]["id"]
    phieu = _phieu_chi(client, headers, don["id"], 880_000, stage="final", delivery_id=dot_id)
    assert _dong_cua(client, headers, don["id"]) is None, "chi đủ đợt ⇒ rời tab"

    r = client.post(
        f"/api/accounting/payment-vouchers/{phieu['id']}/cancel",
        json={"reason": "Lập nhầm"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    dong = _dong_cua(client, headers, don["id"])
    assert dong is not None and dong["no_dot"] == 880_000, "huỷ phiếu ⇒ đơn quay lại tab"


def test_hang_ve_du_thi_coc_thoi_treo_khong_dem_doi(client):
    """Đơn 2.200.000 khai cọc 1.000.000 mà hàng đã về ĐỦ ⇒ chỉ còn nợ đợt; cọc không treo thêm —
    cộng cả hai là "cần chi" vượt giá trị đơn."""
    headers = _headers(client)
    ncc = _supplier(client, headers, name="NCC Cho Chi Ve Du")
    don = _don(client, headers, ncc["id"], coc=1_000_000)
    _da_mua(client, headers, don["id"])

    _ghi_dot(client, headers, don["id"],
             lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 600}])
    dong = _dong_cua(client, headers, don["id"])
    # Về 600 tờ = 1.320.000 ⇒ phần chưa về 880.000 ⇒ cọc còn treo tối đa 880.000.
    assert (dong["coc_can_chi"], dong["no_dot"], dong["tong_can_chi"]) == (880_000, 1_320_000, 2_200_000)

    _ghi_dot(client, headers, don["id"],
             lines=[{"purchase_request_line_id": _dong_dau_tien(don), "quantity": 400}])
    dong = _dong_cua(client, headers, don["id"])
    assert dong["coc_can_chi"] == 0, "hàng về đủ ⇒ không còn gì để đặt cọc"
    assert (dong["so_dot_no"], dong["tong_can_chi"]) == (2, 2_200_000)


def test_don_chua_duyet_khong_vao_du_co_coc(client):
    headers = _headers(client)
    ncc = _supplier(client, headers, name="NCC Cho Chi Chua Duyet")
    don = _don(client, headers, ncc["id"], coc=500_000, duyet=False)
    assert client.post(f"/api/purchase-requests/{don['id']}/submit", headers=headers).status_code == 200
    assert _dong_cua(client, headers, don["id"]) is None, "chờ duyệt ⇒ chưa được chi"


def test_coc_va_dot_cung_mot_dong_qua_han_dung_dau(client):
    headers = _headers(client)
    ncc = _supplier(client, headers, name="NCC Cho Chi Qua Han")
    con_han = _don(client, headers, ncc["id"], coc=300_000)

    qua_han = _don(client, headers, ncc["id"], coc=200_000)
    _da_mua(client, headers, qua_han["id"])
    ngay_giao = (_hom_nay() - timedelta(days=20)).isoformat()
    _ghi_dot(
        client, headers, qua_han["id"],
        lines=[{"purchase_request_line_id": _dong_dau_tien(qua_han), "quantity": 100}],
        ngay=ngay_giao,
        han=(_hom_nay() - timedelta(days=5)).isoformat(),
    )

    hang = _hang(client, headers, supplier_id=ncc["id"])
    assert [x["don"]["id"] for x in hang] == [qua_han["id"], con_han["id"]], "quá hạn đứng đầu"
    dau = hang[0]
    # Một đơn = một dòng: cả cọc lẫn đợt nằm chung. Cọc 200k đã khai nhưng CHƯA chi nên chưa bù
    # vào đợt — đợt 100 tờ × 2.200đ còn nợ nguyên 220k.
    assert dau["coc_can_chi"] == 200_000
    assert dau["so_dot_no"] == 1 and dau["no_dot"] == 220_000
    assert dau["tong_can_chi"] == 420_000
    assert dau["qua_han"] is True


def test_quyen_doc_phieu_chi(client):
    headers = _headers(client)
    _don(client, headers, _supplier(client, headers, name="NCC Cho Chi Quyen")["id"], coc=100_000)

    khong = _token_vai("mhcc-khong", module="ke_toan", can_read=True)
    assert client.get(URL, headers={"Authorization": f"Bearer {khong}"}).status_code == 403

    co = _token_vai("mhcc-co", module="phieu_chi", can_read=True)
    r = client.get(URL, headers={"Authorization": f"Bearer {co}"})
    assert r.status_code == 200, r.text
    assert len(r.json()) >= 1
