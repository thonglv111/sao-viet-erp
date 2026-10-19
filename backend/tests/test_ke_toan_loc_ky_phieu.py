"""Phiếu chi / Phiếu thu: lọc theo kỳ, bộ lọc nâng cao và số trên hàng thẻ lọc.

Ngày lấy từ `accounting_service._business_today()` (đồng hồ xưởng), KHÔNG hard-code và KHÔNG dùng
`date.today()` — runner CI chạy UTC nên hai thứ đó lệch nhau vài giờ mỗi ngày.
"""
from __future__ import annotations

from datetime import timedelta

from app.services import accounting_service
from tests.muc_thu_chi_fixtures import muc_id

URL_PC = "/api/accounting/payment-vouchers"
URL_PT = "/api/accounting/payment-receipts"


def _hom_nay():
    return accounting_service._business_today()


def _headers(client) -> dict[str, str]:
    login = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _lap_phieu_chi(client, h, *, so_tien, ngay=None, hinh_thuc="cash", nguon="internal_expense",
                   nguoi_nhan="Nguyễn Văn Nhận", noi_dung="Chi phí văn phòng", **them):
    """Phiếu chi lập rời (chi phí nội bộ, tiền mặt) — lập ra là ĐÃ CHI. `them` gửi kèm (vd
    `customer_id` cho phiếu trả lại tiền cho khách)."""
    r = client.post(
        URL_PC,
        json={
            "source_type": nguon,
            "voucher_type": hinh_thuc,
            "payment_stage": "other",
            "voucher_date": (ngay or _hom_nay()).isoformat(),
            "amount": so_tien,
            "currency": "VND",
            "exchange_rate": 1,
            "content": noi_dung,
            "cash_recipient_name": nguoi_nhan,
            "muc_thu_chi_id": muc_id(client, h, "chi"),
            **them,
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _huy_phieu_chi(client, h, voucher_id):
    r = client.post(f"{URL_PC}/{voucher_id}/cancel", json={"reason": "Lập nhầm"}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _lap_phieu_thu_khac(client, h, *, so_tien, ngay=None, nguoi_nop="Nguyễn Văn Nộp", noi_dung="Thu khác"):
    r = client.post(
        URL_PT,
        json={
            "payer_name": nguoi_nop,
            "receipt_method": "cash",
            "receipt_date": (ngay or _hom_nay()).isoformat(),
            "amount": so_tien,
            "content": noi_dung,
            "muc_thu_chi_id": muc_id(client, h, "thu"),
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _dinh_kem(client, h, url, ma_id):
    r = client.post(f"{url}/{ma_id}/attachments",
                    files={"file": ("chung-tu.jpg", b"anh-chung-tu", "image/jpeg")}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def test_phieu_chi_loc_theo_ky_theo_ngay_chung_tu(client):
    h = _headers(client)
    hn = _hom_nay()
    cu = _lap_phieu_chi(client, h, so_tien=1_000_000, ngay=hn - timedelta(days=40))
    moi = _lap_phieu_chi(client, h, so_tien=2_000_000, ngay=hn)
    r = client.get(URL_PC, headers=h, params={"tu_ngay": (hn - timedelta(days=7)).isoformat(),
                                               "den_ngay": hn.isoformat()})
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()["items"]]
    assert moi["id"] in ids and cu["id"] not in ids
    assert r.json()["total_paid_amount"] == 2_000_000


def test_phieu_chi_tu_ngay_sau_den_ngay_bi_chan(client):
    h = _headers(client)
    hn = _hom_nay()
    r = client.get(URL_PC, headers=h, params={"tu_ngay": hn.isoformat(),
                                               "den_ngay": (hn - timedelta(days=1)).isoformat()})
    assert r.status_code == 422


def _khach_moi() -> int:
    from app.db import SessionLocal
    from app.models.customer import Customer

    db = SessionLocal()
    try:
        c = Customer(code="KH-LOC-01", name="Khách lọc phiếu")
        db.add(c)
        db.commit()
        return c.id
    finally:
        db.close()


def test_phieu_chi_loc_khoang_tien_hinh_thuc_nhieu_nguon(client):
    h = _headers(client)
    nho = _lap_phieu_chi(client, h, so_tien=300_000)
    lon = _lap_phieu_chi(client, h, so_tien=9_000_000)
    khac = _lap_phieu_chi(client, h, so_tien=9_500_000, nguon="other")
    hoan = _lap_phieu_chi(client, h, so_tien=9_700_000, nguon="customer_refund", customer_id=_khach_moi())
    r = client.get(URL_PC, headers=h, params=[("tien_tu", 5_000_000), ("nguon", "internal_expense"),
                                               ("nguon", "other")])
    ids = [x["id"] for x in r.json()["items"]]
    assert lon["id"] in ids and khac["id"] in ids         # OR trên nhiều nguồn
    assert nho["id"] not in ids and hoan["id"] not in ids  # dưới ngưỡng tiền / ngoài nguồn
    r2 = client.get(URL_PC, headers=h, params={"tien_tu": 1_000_000, "tien_den": 9_000_000})
    assert [x["id"] for x in r2.json()["items"]] == [lon["id"]]
    r3 = client.get(URL_PC, headers=h, params={"hinh_thuc": "cash"})
    assert r3.json()["total"] == 4
    r4 = client.get(URL_PC, headers=h, params={"hinh_thuc": "bank_transfer"})
    assert r4.json()["total"] == 0


def test_phieu_chi_loc_nguoi_lap_va_tai_khoan(client):
    h = _headers(client)
    p = _lap_phieu_chi(client, h, so_tien=400_000)
    uid = p["created_by_user_id"]
    co = client.get(URL_PC, headers=h, params={"nguoi_lap_id": uid})
    assert [x["id"] for x in co.json()["items"]] == [p["id"]]
    khong = client.get(URL_PC, headers=h, params={"nguoi_lap_id": uid + 999})
    assert khong.json()["total"] == 0
    # Phiếu tiền mặt không gắn tài khoản công ty ⇒ lọc theo một tài khoản bất kỳ ra rỗng.
    assert client.get(URL_PC, headers=h, params={"tai_khoan_id": 999_999}).json()["total"] == 0


def test_phieu_chi_loc_nguoi_nhan_tach_khoi_o_tim(client):
    """`nhan` chỉ so tên người nhận (tiền mặt hoặc chủ tài khoản), không so nội dung hay mã như `q`;
    dùng cùng `q` thì AND — ô tìm và ô lọc "Người nhận" không đè nhau.
    Chuỗi tìm cố ý toàn chữ thường: SQLite (DB test) chỉ hạ chữ hoa ASCII, "Đ" không thành "đ"."""
    h = _headers(client)
    a = _lap_phieu_chi(client, h, so_tien=500_000, nguoi_nhan="Điện lực Thuận An", noi_dung="Tiền điện tháng 9")
    b = _lap_phieu_chi(client, h, so_tien=600_000, nguoi_nhan="Nước Bình Dương", noi_dung="Trả hộ Điện lực Thuận An")
    r = client.get(URL_PC, headers=h, params={"nhan": "lực thuận"})
    assert [x["id"] for x in r.json()["items"]] == [a["id"]]
    # `q` khớp cả nội dung ⇒ ra hai phiếu; thêm `nhan` thì còn đúng phiếu của người nhận đó.
    assert r.json()["total"] == 1
    assert client.get(URL_PC, headers=h, params={"q": "lực thuận"}).json()["total"] == 2
    r2 = client.get(URL_PC, headers=h, params={"q": "thuận an", "nhan": "nước"})
    assert [x["id"] for x in r2.json()["items"]] == [b["id"]]
    assert client.get(URL_PC, headers=h, params={"nhan": "lực thuận", "dem_only": True}).json()["total"] == 1


def test_the_loc_khong_sap_khi_loc_trang_thai(client):
    h = _headers(client)
    _lap_phieu_chi(client, h, so_tien=1_000_000)
    huy = _lap_phieu_chi(client, h, so_tien=500_000)
    _huy_phieu_chi(client, h, huy["id"])
    tat_ca = client.get(URL_PC, headers=h).json()["the_loc"]
    chi_huy = client.get(URL_PC, headers=h, params={"status": "cancelled"}).json()
    assert chi_huy["the_loc"] == tat_ca          # đếm thẻ bỏ qua status
    assert chi_huy["total"] == tat_ca["da_huy"]
    assert tat_ca["tat_ca"] == tat_ca["xong"] + tat_ca["da_huy"] + tat_ca["cho"]
    assert tat_ca["xong"] == 1 and tat_ca["da_huy"] == 1 and tat_ca["xong_tien"] == 1_000_000


def test_the_loc_theo_ky_nhung_khong_theo_the(client):
    h = _headers(client)
    hn = _hom_nay()
    _lap_phieu_chi(client, h, so_tien=1_000_000, ngay=hn - timedelta(days=40))
    _lap_phieu_chi(client, h, so_tien=2_000_000, ngay=hn)
    r = client.get(URL_PC, headers=h, params={"tu_ngay": (hn - timedelta(days=7)).isoformat(),
                                               "den_ngay": hn.isoformat()}).json()
    assert r["the_loc"]["tat_ca"] == 1 and r["the_loc"]["xong_tien"] == 2_000_000


def test_phieu_chi_bo_loc_chung_tu_va_dem_only(client):
    """Lọc theo chứng từ gốc đã gỡ (18/10/2026): `chung_tu` cũ trên URL bị bỏ qua, thẻ lọc không còn
    đếm "thiếu chứng từ"; `dem_only` vẫn chỉ trả số."""
    h = _headers(client)
    thieu = _lap_phieu_chi(client, h, so_tien=700_000)
    du = _lap_phieu_chi(client, h, so_tien=800_000)
    tep = _dinh_kem(client, h, URL_PC, du["id"])
    try:
        r = client.get(URL_PC, headers=h, params={"chung_tu": "thieu"}).json()
        assert {x["id"] for x in r["items"]} == {thieu["id"], du["id"]}
        assert "thieu_chung_tu" not in r["the_loc"] and r["the_loc"]["tat_ca"] == 2
        d = client.get(URL_PC, headers=h, params={"dem_only": True}).json()
        assert d["items"] == [] and d["total"] == 2
    finally:
        client.delete(f"{URL_PC}/{du['id']}/attachments/{tep['id']}", headers=h)


def test_phieu_thu_loc_ky_va_tong_da_thu(client):
    h = _headers(client)
    hn = _hom_nay()
    pt = _lap_phieu_thu_khac(client, h, so_tien=1_200_000, ngay=hn)
    cu = _lap_phieu_thu_khac(client, h, so_tien=300_000, ngay=hn - timedelta(days=40))
    r = client.get(URL_PT, headers=h, params={"tu_ngay": hn.isoformat(), "den_ngay": hn.isoformat(),
                                               "hinh_thuc": "cash"})
    ids = [x["id"] for x in r.json()["items"]]
    assert pt["id"] in ids and cu["id"] not in ids
    assert r.json()["total_received_amount"] == 1_200_000
    assert r.json()["the_loc"]["xong"] == 1 and r.json()["the_loc"]["xong_tien"] == 1_200_000
    assert client.get(URL_PT, headers=h, params={"hinh_thuc": "bank_transfer"}).json()["total"] == 0
    assert client.get(URL_PT, headers=h, params={
        "tu_ngay": hn.isoformat(), "den_ngay": (hn - timedelta(days=1)).isoformat()}).status_code == 422


def test_phieu_thu_bo_loc_chung_tu_va_dem_only(client):
    h = _headers(client)
    thieu = _lap_phieu_thu_khac(client, h, so_tien=100_000)
    du = _lap_phieu_thu_khac(client, h, so_tien=200_000)
    tep = _dinh_kem(client, h, URL_PT, du["id"])
    try:
        r = client.get(URL_PT, headers=h, params={"chung_tu": "thieu"}).json()
        assert {x["id"] for x in r["items"]} == {thieu["id"], du["id"]}
        assert "thieu_chung_tu" not in r["the_loc"] and r["the_loc"]["tat_ca"] == 2
        d = client.get(URL_PT, headers=h, params={"dem_only": True}).json()
        assert d["items"] == [] and d["total"] == 2
        # Sắp xếp theo ngày chứng từ phải được nhận.
        s = client.get(URL_PT, headers=h, params={"sort": "receipt_date"})
        assert s.status_code == 200
    finally:
        client.delete(f"{URL_PT}/{du['id']}/attachments/{tep['id']}", headers=h)


def test_phieu_thu_loc_nguoi_nop_tach_khoi_o_tim(client):
    """Ô "Người nộp" của bộ lọc nâng cao Phiếu thu đi vào `nhan`: chỉ so tên người nộp, không so nội
    dung hay mã như `q`; đi cùng `q` là AND; `dem_only` đếm theo đúng điều kiện đó. Chuỗi tìm viết
    thường: SQLite (bộ test) chỉ hạ chữ hoa ASCII."""
    h = _headers(client)
    a = _lap_phieu_thu_khac(client, h, so_tien=500_000, nguoi_nop="Phế liệu Tư Hải", noi_dung="Bán giấy vụn")
    b = _lap_phieu_thu_khac(client, h, so_tien=600_000, nguoi_nop="Nhà sách Minh Tâm", noi_dung="Thu hộ phế liệu tư hải")
    r = client.get(URL_PT, headers=h, params={"nhan": "liệu tư"})
    assert [x["id"] for x in r.json()["items"]] == [a["id"]]
    # Thẻ lọc và tổng tiền đã thu cũng đếm theo `nhan` — không tính phiếu 600.000 của người khác.
    assert r.json()["total_received_amount"] == 500_000
    the = r.json()["the_loc"]
    assert (the["tat_ca"], the["xong"], the["xong_tien"]) == (1, 1, 500_000)
    # `q` khớp cả nội dung ⇒ ra hai phiếu; thêm `nhan` thì còn đúng phiếu của người nộp đó.
    assert {x["id"] for x in client.get(URL_PT, headers=h, params={"q": "liệu tư"}).json()["items"]} == {a["id"], b["id"]}
    r2 = client.get(URL_PT, headers=h, params={"q": "liệu tư", "nhan": "minh tâm"})
    assert [x["id"] for x in r2.json()["items"]] == [b["id"]]
    assert client.get(URL_PT, headers=h, params={"nhan": "liệu tư", "dem_only": True}).json()["total"] == 1
