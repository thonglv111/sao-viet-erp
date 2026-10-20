"""Danh mục Mục thu chi (11/10/2026): mã tự cấp, loại Thu/Chi; 7 mục CỐ ĐỊNH theo nguồn phiếu
(12/10/2026) hiện trong danh sách nhưng chỉ đọc."""
from __future__ import annotations

from tests.test_ke_toan_loc_ky_phieu import _headers

URL = "/api/muc-thu-chi"


def _tao(client, h, **body):
    return client.post(URL, json=body, headers=h)


def test_tao_muc_tu_cap_ma_va_loc_theo_loai(client):
    h = _headers(client)
    a = _tao(client, h, ten="Tiền điện", loai="chi")
    b = _tao(client, h, ten="Bán phế liệu", loai="thu")
    assert a.status_code == 201 and b.status_code == 201, (a.text, b.text)
    assert a.json()["ma"].startswith("MTC-")
    r = client.get(URL, params={"loai": "thu"}, headers=h)
    assert r.status_code == 200, r.text
    # Mục cố định của loại đứng trước mục tự khai.
    assert [i["ten"] for i in r.json()["items"]] == [
        "Khách trả tiền hàng", "Khách đặt cọc", "Nhà cung cấp hoàn tiền", "Bán phế liệu"]
    assert [i["co_dinh"] for i in r.json()["items"]] == [True, True, True, False]


def test_danh_sach_ghep_muc_co_dinh_cat_trang_va_dem_dung(client):
    h = _headers(client)
    for ten in ("Tiền điện", "Văn phòng phẩm"):
        assert _tao(client, h, ten=ten, loai="chi").status_code == 201
    ngung = _tao(client, h, ten="Mực in lẻ", loai="chi").json()
    assert client.patch(f"{URL}/{ngung['id']}/active", json={"active": False},
                        headers=h).status_code == 200

    def ten(**p):
        r = client.get(URL, params=p, headers=h)
        assert r.status_code == 200, r.text
        return r.json()

    tat = ten(page=1, size=50, kem_dem=True)
    assert [i["ten"] for i in tat["items"]] == [
        "Trả nhà cung cấp", "Thuê gia công ngoài", "Tạm ứng lương", "Trả lại tiền cho khách",
        "Chi chiết khấu trả khách", "Chi kê trả khách", "Mực in lẻ", "Tiền điện", "Văn phòng phẩm",
        "Khách trả tiền hàng", "Khách đặt cọc", "Nhà cung cấp hoàn tiền"]
    assert tat["total"] == 12
    # Số của hàng Đang dùng / Đã ngừng và của điều kiện Bên trong nút Lọc — mục cố định tính là
    # đang dùng.
    so = lambda ds: {d["value"]: d["so"] for d in ds}  # noqa: E731
    assert so(tat["dem"]["active"]) == {"true": 11, "false": 1}
    assert so(tat["dem"]["loai"]) == {"chi": 9, "thu": 3}
    # Trang cắt trên dãy ghép: trang 2 cỡ 4 = 2 mục chi cố định cuối + 2 mục chi tự khai.
    tr2 = ten(page=2, size=4)
    assert [i["ten"] for i in tr2["items"]] == [
        "Chi chiết khấu trả khách", "Chi kê trả khách", "Mực in lẻ", "Tiền điện"]
    # Mục cố định không lọt bộ lọc "Đã ngừng" và tìm theo tên.
    assert [i["ten"] for i in ten(active=False)["items"]] == ["Mực in lẻ"]
    assert [i["ten"] for i in ten(q="gia công")["items"]] == ["Thuê gia công ngoài"]


def test_muc_co_dinh_chi_doc(client):
    h = _headers(client)
    r = client.put(f"{URL}/-2", json={"ten": "Đổi tên", "loai": "chi"}, headers=h)
    assert r.status_code == 422 and "cố định" in r.text
    r = client.patch(f"{URL}/-2/active", json={"active": False}, headers=h)
    assert r.status_code == 422 and "cố định" in r.text


def test_xoa_muc_nhu_danh_muc_chung(client):
    """Như màn Giấy: chưa phiếu nào mang ⇒ xoá HẲN; đã có phiếu ⇒ chặn, chỉ ngừng dùng được."""
    from tests.test_ke_toan_loc_ky_phieu import _lap_phieu_chi

    h = _headers(client)
    trong = _tao(client, h, ten="Khai nhầm", loai="chi").json()
    r = client.delete(f"{URL}/{trong['id']}", headers=h)
    assert r.status_code == 204, r.text
    assert client.get(f"{URL}/{trong['id']}", headers=h).status_code == 404

    pc = _lap_phieu_chi(client, h, so_tien=100_000)
    muc = pc["muc_thu_chi_id"]
    hoi = client.get(f"/api/danh-muc/muc_thu_chi/{muc}/kiem-xoa", headers=h)
    assert hoi.status_code == 200 and hoi.json()["chan"] == ["1 phiếu chi"], hoi.text
    r = client.delete(f"{URL}/{muc}", headers=h)
    assert r.status_code == 409 and "1 phiếu chi" in r.text and "Ngừng dùng" in r.text
    r = client.patch(f"{URL}/{muc}/active", json={"active": False}, headers=h)
    assert r.status_code == 200 and r.json()["active"] is False
