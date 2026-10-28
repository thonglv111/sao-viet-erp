"""API danh sách màn Hồ sơ lệnh sản xuất — phân trang + lọc Ở MÁY CHỦ, phạm vi gắn từ QUYỀN.

Ba thứ phải đúng ngay từ đầu, sửa sau rất đắt:
  · `page_size` cắt ở MÁY CHỦ, không kéo cả bảng về rồi slice ở trình duyệt.
  · Client KHÔNG được tự truyền `sale_user_id` để nới phạm vi — backend tự gắn từ token.
  · Response không mang một con số tiền nào.

FIXTURE + HELPER dựng cảnh nay nằm ở `tests/lenh_sx_fixtures.py` — RÚT sang đó khi Task 10
(hồ sơ chi tiết) cần đúng những thứ này. Import lại vào đây bằng `# noqa: F401` là bắt buộc:
pytest chỉ thấy fixture nào có mặt trong namespace của chính module test, mà linter thì lại đọc
chúng như tên thừa. Lý do KHÔNG chép sang file test mới (và mọi cái bẫy của cảnh dựng ở đây —
`db` của file anh em, `_dot_dong_don`, `BAY_GIO` 02:00 giờ VN, phát hành bằng tay) đều đã ghi
trong docstring của module fixture; đọc ở đó, đừng chép lại xuống đây thành bản thứ hai.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from sqlalchemy import event

from app.db import engine
from app.models.customer import Customer
from app.models.lsx import Lsx
from app.models.san_xuat import (
    CV_DANG_CHAY,
    CV_HOAN_THANH,
    CV_PHAT_HANH,
    CV_TAM_DUNG,
    SanXuatCongViec,
)
from app.security import create_access_token
from app.services.lenh_sx import boi_canh, danh_sach, trang_thai
from app.services.san_xuat import thuc_thi

# Plain function (KHÔNG phải fixture) — xem docstring `tests/lenh_sx_fixtures.py`. `_giao_xong`
# dựng yêu cầu giao + chuyến ĐÃ CÓ KẾT QUẢ, tức số THỰC NHẬN (`delivery_trip_lines.qty_giao`) —
# đường DUY NHẤT làm một lệnh rơi vào tab Hoàn thành; docstring của nó giải thích vì sao không
# được đếm `qty` yêu cầu.
from tests.test_lenh_sx_trang_thai import _giao_xong

# Fixture + helper dùng chung (xem module đó). `noqa: F401` vì pytest tiêu thụ chúng qua TÊN
# trong namespace này, không qua lời gọi — bỏ import là mọi bài dưới đây mất fixture.
from tests.lenh_sx_fixtures import (  # noqa: F401
    BAY_GIO,
    _chay_that,
    _cvs,
    _dat_xong_luc,
    _dot_dong_don,
    _giao_nguoi,
    _h,
    _lenh_ghep_doi,
    _lenh_tho,
    _nhuong_ten_to,
    _phat_hanh_that,
    _tok,
    admin,
    customer,
    ghep_doi,
    hai_muoi_lenh,
    lenh_cua_sale_own,
    lenh_nhap,
    lenh_that,
    lsx_svc,
    orders,
    sale_khac,
    sale_own,
    sess,
)


def _buoc_va_chang(sess, lsx_id: int) -> tuple[str | None, list[dict]]:
    """Bước hiện tại + dải chặng của MỘT lệnh, đọc thẳng `danh_sach` — cột bảng Hồ sơ lệnh đã bỏ
    (làm gọn 05/10/2026), hai hàm này nay nuôi cột "Đang ở" của Theo dõi."""
    bc = boi_canh.nap(sess, [lsx_id])
    cv = danh_sach.buoc_hien_tai(bc, lsx_id)
    return (cv.ten_cong_doan if cv is not None else None), danh_sach.chang(bc, lsx_id, cv)


def _nguoi(sess, lsx_id: int) -> list[str]:
    """Người của bước hiện tại, đọc thẳng `boi_canh` — cột Máy/người của bảng đã bỏ (làm gọn
    05/10/2026), nhưng `nguoi_cua` vẫn nuôi hồ sơ một lệnh."""
    bc = boi_canh.nap(sess, [lsx_id])
    cv = danh_sach.buoc_hien_tai(bc, lsx_id)
    return bc.nguoi_cua(cv.id) if cv is not None else []




# --- Bài của brief -------------------------------------------------------------------------------
def test_khong_dang_nhap_401(client):
    assert client.get("/api/lenh-san-xuat").status_code == 401


def test_phan_trang_o_may_chu(client, seed_credentials, hai_muoi_lenh):
    h = _h(_tok(client, seed_credentials))
    d = client.get("/api/lenh-san-xuat?page=1&page_size=5", headers=h).json()
    assert len(d["items"]) == 5
    assert d["total"] >= 20


def test_client_khong_tu_noi_pham_vi(client, seed_credentials, sale_khac):
    h = _h(_tok(client, seed_credentials))
    a = client.get("/api/lenh-san-xuat", headers=h).json()["total"]
    b = client.get(f"/api/lenh-san-xuat?sale_user_id={sale_khac.id}", headers=h).json()["total"]
    assert a == b, "tham số lạ trên URL không được đổi phạm vi"


def test_khong_lo_tien(client, seed_credentials, lenh_that):
    """Đọc trên lệnh THẬT (có routing + snapshot), không phải trên danh sách rỗng — bài "không lộ
    tiền" chạy trên body rỗng thì xanh vĩnh viễn."""
    h = _h(_tok(client, seed_credentials))
    r = client.get("/api/lenh-san-xuat", headers=h)
    assert r.json()["total"] >= 1
    body = r.text.lower()
    for cam in ("don_gia", "gia_von", "thanh_tien", "luong_khoan", "chi_phi"):
        assert cam not in body, f"lộ {cam}"


def test_lenh_nhap_khong_hien(client, seed_credentials, lenh_nhap):
    h = _h(_tok(client, seed_credentials))
    ids = {i["id"] for i in client.get("/api/lenh-san-xuat?page_size=200", headers=h).json()["items"]}
    assert lenh_nhap not in ids


# --- Phân trang: cắt Ở MÁY CHỦ, không phải slice ở client -----------------------------------------
def test_hai_trang_roi_nhau_va_gop_lai_du(client, seed_credentials, hai_muoi_lenh):
    """Trang 1 và trang 2 không được lặp dòng, và gộp lại phải phủ đúng 20 lệnh của fixture.

    Cắt trang mà quên sắp thứ tự ổn định thì bài này đỏ ngẫu nhiên — đó chính là điều cần bắt.
    """
    h = _h(_tok(client, seed_credentials))
    t1 = client.get("/api/lenh-san-xuat?page=1&page_size=10", headers=h).json()
    t2 = client.get("/api/lenh-san-xuat?page=2&page_size=10", headers=h).json()
    a = [i["id"] for i in t1["items"]]
    b = [i["id"] for i in t2["items"]]
    assert len(a) == 10 and len(b) == 10
    assert not (set(a) & set(b)), "hai trang lặp dòng"
    assert set(hai_muoi_lenh) <= set(a) | set(b)
    assert t1["total"] == t2["total"]


def test_total_khong_doi_theo_page_size(client, seed_credentials, hai_muoi_lenh):
    """`total` là số dòng KHỚP BỘ LỌC, không phải số dòng của trang đang xem."""
    h = _h(_tok(client, seed_credentials))
    nho = client.get("/api/lenh-san-xuat?page=1&page_size=3", headers=h).json()
    to = client.get("/api/lenh-san-xuat?page=1&page_size=200", headers=h).json()
    assert nho["total"] == to["total"] == len(to["items"])
    assert len(nho["items"]) == 3


def test_trang_vuot_qua_tra_rong_khong_no(client, seed_credentials, hai_muoi_lenh):
    h = _h(_tok(client, seed_credentials))
    d = client.get("/api/lenh-san-xuat?page=99&page_size=10", headers=h).json()
    assert d["items"] == [] and d["total"] >= 20


# --- `dem_theo_tab`: đếm CẢ TẬP đã lọc, không phải trang đang xem ---------------------------------
def test_dem_theo_tab_dem_ca_tap_khong_chi_trang(client, seed_credentials, hai_muoi_lenh):
    """Số trên tab phải là số của cả tập lọc. Đếm trên `items` của trang là lỗi kinh điển và nó
    IM LẶNG: trang 1 vẫn hiện đủ dòng, chỉ con số trên tab bé đi."""
    h = _h(_tok(client, seed_credentials))
    d = client.get("/api/lenh-san-xuat?page=1&page_size=5", headers=h).json()
    dem = d["dem_theo_tab"]
    assert set(dem) == set(trang_thai.KHAU) | {"tat_ca"}
    assert dem["tat_ca"] == d["total"] >= 20
    assert sum(dem[t] for t in trang_thai.KHAU) == dem["tat_ca"]
    assert len(d["items"]) == 5


def test_dem_theo_tab_theo_bo_loc_khac(client, seed_credentials, hai_muoi_lenh, lenh_that):
    """Đổi bộ lọc (không phải tab) thì số trên tab phải đổi theo — tab là FACET của tập đã lọc."""
    h = _h(_tok(client, seed_credentials))
    het = client.get("/api/lenh-san-xuat", headers=h).json()["dem_theo_tab"]["tat_ca"]
    loc = client.get("/api/lenh-san-xuat?q=LSX-DS-0", headers=h).json()["dem_theo_tab"]["tat_ca"]
    assert loc < het


def test_loc_tab_o_may_chu(client, seed_credentials, sess, hai_muoi_lenh, lenh_that):
    """Chọn một tab thì `items` chỉ còn lệnh của tab đó, và `total` co lại theo — nhưng
    `dem_theo_tab` GIỮ NGUYÊN (tab không tự lọc chính số đếm của mình).

    Tập fixture phải KHÔNG ĐỒNG NHẤT, và bài phải tự kiểm điều đó. Mọi lệnh chưa giao ở đây đều
    rơi vào tab `dang_sx`; nếu chỉ có chúng thì lọc tab là phép
    rỗng và bài vẫn xanh kể cả khi cài đặt bỏ hẳn mệnh đề lọc — nghi thức đột biến đã bắt đúng lỗ
    đó ở bản đầu. `lenh_that` được giao ĐỦ cho khách để rơi sang `hoan_thanh`: nhánh ấy đứng TRƯỚC
    mọi cờ cảnh báo trong `trang_thai_chinh:346`, nên nó tách khỏi tập kia một cách chắc chắn.
    """
    h = _h(_tok(client, seed_credentials))
    _giao_xong(sess, lenh_that, sess.get(Lsx, lenh_that).so_luong_dat, ma="YCGH-DS-TAB")

    het = client.get("/api/lenh-san-xuat?page_size=200", headers=h).json()
    assert len({i["khau"] for i in het["items"]}) >= 2, "tập đồng nhất — bài mất tiền đề"
    tab = trang_thai.KHAU_DA_GIAO
    assert 0 < het["dem_theo_tab"][tab] < het["total"], "tab đang xét phải là tập CON thật sự"

    d = client.get(f"/api/lenh-san-xuat?tab={tab}&page_size=200", headers=h).json()
    assert d["total"] == het["dem_theo_tab"][tab] < het["total"]
    assert {i["khau"] for i in d["items"]} == {tab}
    assert [i["id"] for i in d["items"]] == [lenh_that]
    assert d["dem_theo_tab"] == het["dem_theo_tab"]


def test_tab_la_gia_tri_khong_hop_le_bi_chan(client, seed_credentials):
    h = _h(_tok(client, seed_credentials))
    assert client.get("/api/lenh-san-xuat?tab=lung_tung", headers=h).status_code == 422
    assert client.get("/api/lenh-san-xuat?tab=canh_bao", headers=h).status_code == 422


# --- Bộ lọc ở TẦNG SQL ---------------------------------------------------------------------------
def test_q_tim_theo_ma(client, seed_credentials, hai_muoi_lenh):
    h = _h(_tok(client, seed_credentials))
    d = client.get("/api/lenh-san-xuat?q=LSX-DS-07", headers=h).json()
    assert [i["ma"] for i in d["items"]] == ["LSX-DS-07"]
    assert d["total"] == 1
    assert client.get("/api/lenh-san-xuat?q=KHONG-CO-MA-NAY", headers=h).json()["total"] == 0


def test_q_tim_theo_ten_khach(client, seed_credentials, hai_muoi_lenh):
    """Sale gõ tên khách chứ không nhớ mã lệnh — `q` phải với tới `customers.name`."""
    h = _h(_tok(client, seed_credentials))
    d = client.get("/api/lenh-san-xuat?q=Danh Sách&page_size=200", headers=h).json()
    assert d["total"] >= 20
    assert all(i["khach_hang"] == "Khách Danh Sách" for i in d["items"])


def test_lenh_gap_dung_dau_tab_dang_sx(client, seed_credentials, sess, admin, hai_muoi_lenh):
    """Tab Đang sản xuất giữ thứ tự cũ: GẤP → hạn SX tăng → mã."""
    h = _h(_tok(client, seed_credentials))
    gap = _lenh_tho(
        sess, ma="LSX-DS-GAP2", sale_user_id=admin.id, is_rush=True, han_sx=date(2027, 1, 1)
    )
    d = client.get("/api/lenh-san-xuat?tab=dang_sx&page=1&page_size=5", headers=h).json()
    assert d["items"][0]["id"] == gap


def test_loc_khoang_ngay_theo_han_sx(client, seed_credentials, hai_muoi_lenh):
    """`tu_ngay`/`den_ngay` + `moc=han_sx` soi `han_hoan_thanh_sx` — cùng cột mà `tre_han` dùng làm
    mốc. Thiếu `moc` thì kỳ tính theo ngày tạo lệnh (thanh lọc 06/10/2026)."""
    h = _h(_tok(client, seed_credentials))
    d = client.get(
        "/api/lenh-san-xuat?moc=han_sx&tu_ngay=2026-09-03&den_ngay=2026-09-05&page_size=200",
        headers=h,
    ).json()
    assert d["total"] == 3
    assert {i["han_hoan_thanh_sx"] for i in d["items"]} == {
        "2026-09-03", "2026-09-04", "2026-09-05"
    }


# --- Phạm vi bám QUYỀN, không bám URL ------------------------------------------------------------
def test_pham_vi_own_chi_thay_lenh_cua_minh(
    client, sale_own, lenh_cua_sale_own, hai_muoi_lenh
):
    """Vai "NV Sales" (scope `own`) chỉ thấy lệnh của ĐƠN MÌNH BÁN.

    Đây là bài canh THẬT của phạm vi; bài `test_client_khong_tu_noi_pham_vi` của brief chỉ chứng
    minh một tham số lạ bị bỏ qua (FastAPI vốn bỏ qua query param không khai), nó KHÔNG chứng minh
    phạm vi có được gắn hay không.
    """
    h = _h(create_access_token(str(sale_own.id)))
    d = client.get("/api/lenh-san-xuat?page_size=200", headers=h).json()
    assert [i["id"] for i in d["items"]] == [lenh_cua_sale_own]
    assert d["total"] == 1


# --- Nội dung một dòng ----------------------------------------------------------------------------
def test_item_chi_con_cot_tinh(client, seed_credentials, sess, lenh_that):
    """Dòng bảng chỉ còn cột tĩnh — không cột nào cần đường găng hay cân đối vật tư."""
    h = _h(_tok(client, seed_credentials))
    d = client.get("/api/lenh-san-xuat?page_size=200", headers=h).json()
    row = next(i for i in d["items"] if i["id"] == lenh_that)
    assert set(row) == {
        "id", "ma", "ten", "so_luong_dat", "don_vi_tinh", "khach_hang", "order_id", "order_no",
        "han_hoan_thanh_sx", "is_rush", "khau", "khau_chi_tiet", "da_dong", "created_at",
        "han_giao_khach", "tron_goi", "nha_gia_cong", "chang",
    }
    assert row["khau"] == trang_thai.KHAU_DANG_SX
    assert row["khau_chi_tiet"] is None
    assert row["da_dong"] is False
    assert row["order_no"]


def test_khach_hang_ra_toi_response_va_dung_khach(
    client, seed_credentials, sess, admin, customer
):
    """Mỗi dòng mang tên khách CỦA CHÍNH ĐƠN mình (`khach_hang_id` đã rời dòng bảng 05/10/2026).

    Đi qua HTTP chứ không gọi thẳng service, và đó là phần LOAD-BEARING: `LenhSxItem` là
    `response_model`, mà Pydantic BỎ IM LẶNG mọi khoá service trả nhưng schema không khai. Bài gọi
    thẳng service vẫn xanh cả khi trường rơi mất đúng trên đường ra.

    Ba lệnh, ba cảnh (khách A, khách B, chưa có khách) để bài không xanh nhờ “trả đại một id nào
    đó”: tên phải khớp đúng khách của từng đơn, và đơn chưa gắn khách phải ra `None` chứ không
    phải một tên gần đúng.
    """
    kh2 = Customer(code="KH-DS-2", name="Khách Danh Sách Hai")
    sess.add(kh2)
    sess.commit()
    _dot_dong_don(sess, 4)
    a = _lenh_tho(sess, ma="LSX-DS-KH1", sale_user_id=admin.id, customer_id=customer.id)
    b = _lenh_tho(sess, ma="LSX-DS-KH2", sale_user_id=admin.id, customer_id=kh2.id)
    khong = _lenh_tho(sess, ma="LSX-DS-KH0", sale_user_id=admin.id, customer_id=None)

    h = _h(_tok(client, seed_credentials))
    d = client.get("/api/lenh-san-xuat?page_size=200", headers=h).json()
    dong = {i["id"]: i for i in d["items"]}
    assert dong[a]["khach_hang"] == customer.name
    assert dong[b]["khach_hang"] == kh2.name
    assert dong[khong]["khach_hang"] is None, "đơn chưa gắn khách ⇒ None, không phải tên bịa"


def test_buoc_hien_tai_uu_tien_buoc_dang_chay(sess, lenh_that):
    """Cột Công đoạn hiện bước ĐANG CHẠY, kể cả khi một bước TRƯỚC nó còn chưa bắt đầu.

    Ca này có thật ở xưởng: máy in chạy trước trong khi chế bản còn đang chờ bản mới cho tay kê
    thứ hai. Chọn "bước chờ sớm nhất" ở đây là hiện "CTP" trong lúc máy in đang gầm — điều độ đọc
    bảng sẽ đi tìm nhầm chỗ. Không có bài này thì phép ưu tiên ĐANG CHẠY không có lưới: mọi ca
    khác đều để bước đang chạy trùng luôn với bước chờ sớm nhất.
    """
    cvs = _cvs(sess, lenh_that)                       # CTP · In · Đóng gói
    cvs[1].trang_thai = CV_DANG_CHAY                  # CTP vẫn 'released', chưa ai bấm
    sess.commit()

    buoc, chang = _buoc_va_chang(sess, lenh_that)
    assert buoc == "In", "phải là bước ĐANG CHẠY, không phải bước chờ sớm nhất"


def test_buoc_hien_tai_uu_tien_buoc_tam_dung(sess, lenh_that):
    """Không có bước nào chạy thì bước TẠM DỪNG mới là nơi lệnh đang mắc — vẫn hơn bước chờ."""
    cvs = _cvs(sess, lenh_that)
    cvs[1].trang_thai = CV_TAM_DUNG
    sess.commit()

    buoc, chang = _buoc_va_chang(sess, lenh_that)
    assert buoc == "In"


def test_nguoi_rong_khi_chua_giao_ai(sess, lenh_that):
    """Chưa giao ai ⇒ `nguoi` là danh sách RỖNG, không phải `None`, không phải chữ bịa."""
    nguoi = _nguoi(sess, lenh_that)
    assert nguoi == []


def test_nguoi_hien_ca_to_theo_thu_tu_giao(sess, admin, lenh_that):
    """Nhiều người trên một bước là chuyện thường (roster) ⇒ trả ĐỦ tên, theo THỨ TỰ GIAO.

    Trả danh sách chứ không phải chuỗi "A +1" dựng sẵn: cột hẹp thì UI tự cắt (cắt từ cuối được vì
    thứ tự là thứ tự giao), còn tooltip/hồ sơ vẫn có đủ tên mà không phải gọi thêm API.
    """
    cv = _cvs(sess, lenh_that)[0]
    _giao_nguoi(sess, admin, cv, ma="NV-DS-01", ten="Nguyễn Văn A")
    _giao_nguoi(sess, admin, cv, ma="NV-DS-02", ten="Trần Thị B")

    nguoi = _nguoi(sess, lenh_that)
    assert nguoi == ["Nguyễn Văn A", "Trần Thị B"]


def test_nguoi_khong_hien_nguoi_da_bi_rut(sess, admin, lenh_that):
    """Người đã bị RÚT khỏi việc không được hiện trên bảng điều độ.

    Rút người ghi `trang_thai='removed'` và GIỮ dòng lại để có lịch sử (`thuc_thi.go_phan_cong`).
    Nếu câu nạp phân công quên điều kiện trạng thái, bảng sẽ khai tên một người KHÔNG còn làm việc
    đó — sai kiểu không gãy gì, chỉ khiến điều độ đi tìm nhầm người. Bước vẫn còn đúng MỘT người
    đang hoạt động nên ô không rỗng: bỏ điều kiện là ra hai tên, thấy ngay.
    """
    cv = _cvs(sess, lenh_that)[0]
    pc_a = _giao_nguoi(sess, admin, cv, ma="NV-DS-11", ten="Người đã rút")
    _giao_nguoi(sess, admin, cv, ma="NV-DS-12", ten="Người đang làm")
    thuc_thi.go_phan_cong(sess, user=admin, phan_cong_id=pc_a, ly_do="Chuyển sang tổ khác")
    sess.expire_all()

    nguoi = _nguoi(sess, lenh_that)
    assert nguoi == ["Người đang làm"], "người đã `removed` không được lên bảng"


# --- Bài ghép: ba luận cứ của `danh_sach.py` mà trước vòng này không lời nào có lưới ------------
def test_buoc_hien_tai_lay_ca_buoc_ghep(sess, ghep_doi):
    """Bước ĐANG CHẠY là ca in GHÉP ⇒ cột Công đoạn phải hiện nó, không phải một bước riêng.

    `_buoc_hien_tai` đọc `bc.cong_viec_du()` chứ không `bc.cong_viec[]` chính vì ca này: công việc
    chung mang `lsx_id IS NULL` nên map neo theo lệnh KHÔNG có nó, và bảng sẽ hiện "CTP" trong lúc
    máy in đang gầm. Cột Máy/người đi theo cùng một `cv`, nên mất bước ghép là mất cả ba cột.
    """
    a, b, cv_chung = ghep_doi
    cv_chung.trang_thai = CV_DANG_CHAY
    sess.commit()

    assert _buoc_va_chang(sess, a)[0] == "Ca chạy ghép"
    assert _buoc_va_chang(sess, b)[0] == "Ca chạy ghép", "cả hai lệnh cùng đứng ở ca ghép ấy"


# --- Ba luật khác mà đột biến từng đi qua không ai cản ------------------------------------------
def test_sap_xep_toan_phan_khi_trung_khoa_chinh(client, seed_credentials, sess, admin, customer):
    """Hai lệnh TRÙNG cả độ gấp lẫn hạn SX ⇒ `lsx.ma` là nấc phân giải cuối của thứ tự.

    Không có nấc đó thì thứ tự chỉ còn là thứ tự DB tình cờ trả về, và cắt trang trên một thứ tự
    KHÔNG TOÀN PHẦN cho phép trang 1 với trang 2 chồng nhau hoặc bỏ sót dòng. SQLite hay "đúng một
    cách tình cờ", nên bài ép hai thứ tự ấy LỆCH nhau: lệnh mã Z tạo TRƯỚC (id nhỏ hơn), lệnh mã A
    tạo SAU. Sắp theo mã ⇒ A trước; rơi về thứ tự id ⇒ Z trước.
    """
    h = _h(_tok(client, seed_credentials))
    hom = date(2026, 9, 9)
    z = _lenh_tho(sess, ma="LSX-SAP-Z", sale_user_id=admin.id, customer_id=customer.id, han_sx=hom)
    a = _lenh_tho(sess, ma="LSX-SAP-A", sale_user_id=admin.id, customer_id=customer.id, han_sx=hom)
    assert z < a, "tiền đề: id tăng theo thứ tự tạo, tức NGƯỢC thứ tự mã"

    t1 = client.get("/api/lenh-san-xuat?page=1&page_size=1", headers=h).json()
    t2 = client.get("/api/lenh-san-xuat?page=2&page_size=1", headers=h).json()
    assert [i["id"] for i in t1["items"]] == [a], "trang 1 phải là lệnh có MÃ nhỏ hơn"
    assert [i["id"] for i in t2["items"]] == [z]
    assert t1["total"] == t2["total"] == 2


def test_go_phan_cong_khong_doi_moc_hoan_thanh(sess, admin, lenh_that):
    """Rút người khỏi một bước ĐÃ XONG TỪ LÂU không được dời mốc nghiệp vụ `hoan_thanh_luc`.

    `go_phan_cong` dời `updated_at` (cột bảo trì). Cột Thực tế của hồ sơ đọc `hoan_thanh_luc`, nên
    mốc đó phải đứng yên."""
    cv = _cvs(sess, lenh_that)[0]
    pc_id = _giao_nguoi(sess, admin, cv, ma="NV-DS-21", ten="Thợ ca cũ")
    xua = datetime(2020, 1, 1, 3, 0, tzinfo=timezone.utc)
    _dat_xong_luc(sess, cv, xua)

    thuc_thi.go_phan_cong(sess, user=admin, phan_cong_id=pc_id, ly_do="Nghỉ việc")
    sess.expire_all()
    cv = sess.get(SanXuatCongViec, cv.id)
    assert cv.updated_at.year >= 2026, "tiền đề: `go_phan_cong` CÓ dời `updated_at` về hiện tại"
    assert cv.hoan_thanh_luc.year == 2020, "mốc NGHIỆP VỤ phải đứng yên"


def test_ket_thuc_that_dong_dau_hoan_thanh_luc(sess, admin, lenh_that):
    """ĐƯỜNG GHI THẬT (`thuc_thi.ket_thuc`) có đóng dấu `hoan_thanh_luc` — bài duy nhất không đi qua
    fixture `_dat_xong_luc`, nên là bài duy nhất chứng minh production còn ghi cột này."""
    cv = _cvs(sess, lenh_that)[0]
    _chay_that(sess, admin, cv, ma="NV-DS-31", ten="Thợ đóng dấu")
    cv = sess.get(SanXuatCongViec, cv.id)
    assert cv.trang_thai == CV_HOAN_THANH, "tiền đề: đường ghi thật có đóng bước"
    assert cv.hoan_thanh_luc is not None, "`ket_thuc` KHÔNG đóng dấu mốc nghiệp vụ"


def test_ket_thuc_lan_hai_bi_chan_nen_dau_khong_bi_ghi_de(sess, admin, lenh_that):
    """Bước đã `completed` gọi `ket_thuc` lần nữa ⇒ BỊ CHẶN, dấu đứng yên. Hành vi chốt ở đây.

    Câu trả lời không nằm ở dòng đóng dấu mà ở cửa `trang_thai not in (running, paused)` ngay đầu
    hàm: lần gọi thứ hai chết ở cửa, chưa chạm tới phép gán. Nên `hoan_thanh_luc` ghi ĐÚNG MỘT
    LẦN theo cấu trúc chứ không nhờ may — và không có đường nào để một cú bấm lặp kéo bước cũ vào
    KPI hôm nay. Ai sau này viết đường “mở lại bước đã xong” buộc phải mở chính cửa ấy, và bài
    này bắt họ tự quyết định làm gì với cột.
    """
    cv = _cvs(sess, lenh_that)[0]
    _chay_that(sess, admin, cv, ma="NV-DS-32", ten="Thợ đóng dấu hai")
    dau = sess.get(SanXuatCongViec, cv.id).hoan_thanh_luc
    assert dau is not None, "tiền đề: lần đóng đầu tiên đã đóng dấu"

    with pytest.raises(ValueError, match="đang chạy hoặc tạm dừng"):
        thuc_thi.ket_thuc(sess, user=admin, cong_viec_id=cv.id)
    sess.expire_all()
    assert sess.get(SanXuatCongViec, cv.id).hoan_thanh_luc == dau, "dấu nghiệp vụ bị ghi đè"


# --- N+1: số câu SQL hằng TRÊN TRỤC LỆNH (trục BÀI GHÉP thì nở — xem docstring dưới) -------------
def _dem_sql(fn, *, xoa_cache: bool = True):
    """Đếm câu SQL thật sự gửi xuống driver trong lúc chạy `fn`.

    Mặc định xoá cache đèn vật tư trước (`danh_sach._den_vat_tu_co_cache`) ⇒ đo đường LẠNH — trần
    thật của một request khi cache vừa bị xoá."""
    from app.services.can_doi_cache import xoa_cache_can_doi

    if xoa_cache:
        xoa_cache_can_doi()
    n = 0

    def _ghi(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001, ARG001
        nonlocal n
        n += 1

    event.listen(engine, "before_cursor_execute", _ghi)
    try:
        fn()
    finally:
        event.remove(engine, "before_cursor_execute", _ghi)
    return n


def _nen_hinh_dang_that(sess, orders, lsx_svc, admin, customer) -> tuple[int, int, int]:
    """Tập nền cho hai bài đếm SQL: một tờ in GHÉP (2 lệnh) + một lệnh riêng, có máy và có người.

    Nở tập bằng `_lenh_tho` (lệnh TRẦN — không routing, không công việc) là bài tự vô hiệu hoá
    mình: `_buoc_hien_tai` trả `None` nên `_may_id` / `nguoi_cua` / `bc.may` KHÔNG BAO GIỜ được
    gọi, và bất biến "số câu không nở" chỉ được chứng minh trên phần RỖNG của hàm. Vòng rà soát 2
    chỉ đúng lỗ đó. Ở đây mọi nhánh có thể sinh câu SQL đều được chạm, và bài tự chốt điều ấy
    trước khi đo.
    """
    from app.models.may_thiet_bi import MayThietBi

    a, b, cv_chung = _lenh_ghep_doi(
        sess, orders, lsx_svc, admin, customer,
        buoc=[("CTP", 500), ("In", 5000), ("Đóng gói", 5000)], ghep_idx=1,
    )
    rieng = _phat_hanh_that(
        sess, orders, lsx_svc, admin, customer,
        buoc=[("CTP", 15, 500), ("In", 360, 5000)],
    )
    may = MayThietBi(ma="MAY-SQL-01", ten="Máy đo SQL", loai_may="press_offset_sheet")
    sess.add(may)
    sess.flush()
    cv_chung.may_id = may.id
    cv_chung.trang_thai = CV_DANG_CHAY
    sess.commit()
    _giao_nguoi(sess, admin, _cvs(sess, rieng)[0], ma="NV-SQL-01", ten="Thợ đo SQL")
    return a, b, rieng


def test_so_cau_sql_hang_tren_truc_lenh(sess, orders, lsx_svc, admin, customer):
    """Số câu SQL của danh sách KHÔNG nở theo số lệnh (một `boi_canh.nap()` cho cả tập)."""
    _dot_dong_don(sess, 8)
    _nen_hinh_dang_that(sess, orders, lsx_svc, admin, customer)
    n3 = _dem_sql(lambda: danh_sach.danh_sach(sess, sale_ids=None))
    for _ in range(2):
        _phat_hanh_that(
            sess, orders, lsx_svc, admin, customer,
            buoc=[("CTP", 15, 500), ("In", 360, 5000)],
        )
    n5 = _dem_sql(lambda: danh_sach.danh_sach(sess, sale_ids=None))
    assert len(danh_sach.danh_sach(sess, sale_ids=None)["items"]) == 5
    assert n3 == n5, f"số câu SQL nở theo số lệnh: {n3} → {n5}"


# --- `GET /bo-loc` (làm gọn 05/10/2026: chỉ còn ô Khách) ------------------------------------
def test_bo_loc_khong_dang_nhap_401(client):
    assert client.get("/api/lenh-san-xuat/bo-loc").status_code == 401


# --- Dải chặng của dòng bảng ---------------------------------------------------------------------
# `chang` trả CẢ chuỗi công đoạn để bảng vẽ được lệnh đang ở khúc nào của đường đi, thay vì chỉ có
# tên bước đang đứng. Ba bài dưới canh đúng ba chỗ dễ vỡ: hợp đồng dữ liệu qua HTTP, phép gộp lần
# chạy, và cái tên hiện trên đốt.
def test_chang_tra_ca_chuoi_cong_doan_theo_trang_thai(sess, lenh_that):
    """Dải chặng theo trạng thái từng bước, và đốt `hien_tai` bám đúng `buoc_hien_tai`. Hợp đồng
    qua HTTP của dải nay thuộc `/api/theo-doi-san-xuat/theo-lenh` (cột "Đang ở")."""
    cvs = _cvs(sess, lenh_that)                       # CTP · In · Đóng gói
    cvs[0].trang_thai = CV_HOAN_THANH
    cvs[1].trang_thai = CV_DANG_CHAY
    sess.commit()

    buoc, chang = _buoc_va_chang(sess, lenh_that)

    assert [(c["ten"], c["trang_thai"]) for c in chang] == [
        ("CTP", "xong"), ("In", "chay"), ("Đóng gói", "cho"),
    ]
    # Đốt `hien_tai` phải trỏ ĐÚNG bước mà cột "Công đoạn" đang hiện — lệch nhau là dải sáng một
    # đốt còn chữ nói một bước khác, người đọc mất lòng tin vào cả hai.
    dang = [c for c in chang if c["hien_tai"]]
    assert len(dang) == 1 and dang[0]["ten"] == buoc == "In"


def test_chang_gop_moi_lan_chay_cua_mot_buoc_ve_mot_dot(sess, lenh_that):
    """Bước tách nhiều lần chạy (mg 0254) vẫn là MỘT công đoạn trên dải.

    Không gộp thì lệnh nào có bước tách cũng dài thêm một đốt và người đọc tưởng xưởng phải chạy
    thêm một công đoạn không có thật. Và một lần chạy đang chạy ⇒ CẢ chặng là "đang chạy", dù lần
    kia đã xong — chặng chỉ "xong" khi không còn lần nào dở.
    """
    cvs = _cvs(sess, lenh_that)
    goc = cvs[1]                                      # bước "In"
    assert goc.step_key, "cảnh dựng cần bước có step_key thì mới canh được phép gộp"
    goc.trang_thai = CV_HOAN_THANH
    goc.phan_doan_so, goc.phan_doan_tong = 1, 2
    goc.ten_cong_doan = "In (lần 1/2)"
    # Lần chạy thứ hai — đúng hình dạng `snapshot._dung_cong_viec` ghi ra: cùng `step_key`, cùng
    # `lsx_cong_doan_id`, chỉ khác cặp số phân đoạn và cái tên mang hậu tố.
    lan2 = SanXuatCongViec(
        goi_id=goc.goi_id, lsx_id=goc.lsx_id, lsx_cong_doan_id=goc.lsx_cong_doan_id,
        step_key=goc.step_key, phan_doan_so=2, phan_doan_tong=2,
        ten_cong_doan="In (lần 2/2)", nhom_cong_doan=goc.nhom_cong_doan,
        trang_thai=CV_DANG_CHAY, du_kien_bat_dau=goc.du_kien_bat_dau,
    )
    sess.add(lan2)
    sess.commit()

    buoc, chang = _buoc_va_chang(sess, lenh_that)

    assert [c["ten"] for c in chang] == ["CTP", "In", "Đóng gói"], (
        "hai lần chạy của 'In' phải gộp về một đốt, và đốt mang TÊN BƯỚC chứ không mang hậu tố "
        "'(lần 1/2)' — hậu tố chỉ để tổ phân biệt hai thẻ trên bàn"
    )
    assert [c["trang_thai"] for c in chang] == ["cho", "chay", "cho"]


def test_chang_rong_khi_lenh_khong_con_cong_viec_nao(sess, lenh_that):
    """Lệnh đã phát hành nhưng không còn công việc nào (routing rỗng / gói bị gỡ) ⇒ `chang` RỖNG.

    Hợp đồng này LOAD-BEARING ở phía FE: dải rỗng trông y hệt "mọi công đoạn đều chưa tới", nên
    `DaiChang` lùi về thanh tiến độ cũ khi mảng rỗng. Trả một đốt bịa ở đây là nói dối điều độ.
    """
    for cv in _cvs(sess, lenh_that):
        sess.delete(cv)
    sess.commit()

    buoc, chang = _buoc_va_chang(sess, lenh_that)
    assert chang == []
    assert buoc is None, "không còn công việc thì cũng không có bước đang đứng"


# --- Làm gọn 05/10/2026: 4 tab theo khâu, lọc khách, sắp tra cứu, không cân đối ------------------
def test_danh_sach_khong_chay_can_doi_lan_duong_gang(
    client, seed_credentials, sess, lenh_that, monkeypatch,
):
    """Danh sách tĩnh: gọi cân đối vật tư hay dự kiến xong là đẻ lại đúng phần nặng nhất đã bỏ."""
    from app.services.lenh_sx import tien_do

    def cam(*_a, **_k):
        raise AssertionError("danh sách Hồ sơ lệnh không được gọi hàm này")

    monkeypatch.setattr(trang_thai, "den_vat_tu_theo_lo", cam)
    monkeypatch.setattr(tien_do, "du_kien_xong", cam)
    h = _h(_tok(client, seed_credentials))
    r = client.get("/api/lenh-san-xuat?page_size=200", headers=h)
    assert r.status_code == 200
    assert any(i["id"] == lenh_that for i in r.json()["items"])


def test_loc_khach_hang(client, seed_credentials, sess, admin, customer, hai_muoi_lenh):
    h = _h(_tok(client, seed_credentials))
    khac = Customer(code="KH-DS-LOC", name="Khách lọc riêng DS")
    sess.add(khac)
    sess.commit()
    rieng = _lenh_tho(sess, ma="LSX-DS-KH1", sale_user_id=admin.id, customer_id=khac.id)
    d = client.get(f"/api/lenh-san-xuat?khach_hang_id={khac.id}", headers=h).json()
    assert [i["id"] for i in d["items"]] == [rieng]
    assert d["dem_theo_tab"]["tat_ca"] == 1


def test_tab_tat_ca_sap_han_giam_dan(client, seed_credentials, sess, admin):
    """Danh sách tra cứu: lệnh mới nhất ở trên. Lệnh chưa có hạn xuống cuối."""
    h = _h(_tok(client, seed_credentials))
    cu = _lenh_tho(sess, ma="LSX-DS-SAP1", sale_user_id=admin.id, han_sx=date(2026, 1, 5))
    moi = _lenh_tho(sess, ma="LSX-DS-SAP2", sale_user_id=admin.id, han_sx=date(2026, 9, 5))
    gap_cu = _lenh_tho(
        sess, ma="LSX-DS-SAP3", sale_user_id=admin.id, han_sx=date(2025, 6, 1), is_rush=True,
    )
    d = client.get("/api/lenh-san-xuat?q=LSX-DS-SAP&page_size=50", headers=h).json()
    assert [i["id"] for i in d["items"]] == [moi, cu, gap_cu], "GẤP không được kéo lên ở tab Tất cả"


def test_bo_loc_chi_tra_khach_trong_pham_vi(
    client, sess, admin, customer, sale_own, lenh_cua_sale_own,
):
    """`/bo-loc` nay chỉ còn ô Khách, gác `lenh_san_xuat:read`, và hẹp đúng phạm vi người gọi:
    khách của lệnh NGƯỜI KHÁC bán không được lọt vào ô của người bán scope `own`."""
    khac = Customer(code="KH-DS-KHAC", name="Khách của sale khác DS")
    sess.add(khac)
    sess.commit()
    _lenh_tho(sess, ma="LSX-DS-KHAC", sale_user_id=admin.id, customer_id=khac.id)

    tok = _tok(client, {"username": sale_own.username, "password": "x"})
    r = client.get("/api/lenh-san-xuat/bo-loc", headers=_h(tok))
    assert r.status_code == 200
    d = r.json()
    assert set(d) == {"khach_hang"}
    assert [k["ten"] for k in d["khach_hang"]] == [customer.name]
    assert all(set(k) == {"id", "ten"} for k in d["khach_hang"])


def test_summary_da_go(client, seed_credentials):
    h = _h(_tok(client, seed_credentials))
    assert client.get("/api/lenh-san-xuat/summary", headers=h).status_code in (404, 422)


# --- 12/10/2026: dòng có tuyến bước + hạn giao; ngăn gọn ----------------------------------------
def test_dong_co_tuyen_buoc_va_han_giao(client, seed_credentials, lenh_that):
    h = _h(_tok(client, seed_credentials))
    d = client.get("/api/lenh-san-xuat?page_size=200", headers=h).json()
    row = next(i for i in d["items"] if i["id"] == lenh_that)
    assert [c["ten"] for c in row["chang"]] == ["CTP", "In", "Đóng gói"]
    assert {"ngoai", "kcs_loi", "trang_thai", "hien_tai"} <= set(row["chang"][0])
    assert "han_giao_khach" in row
    assert row["tron_goi"] is False


def test_ngan_gon_khong_co_vat_tu(client, seed_credentials, lenh_that):
    h = _h(_tok(client, seed_credentials))
    r = client.get(f"/api/lenh-san-xuat/{lenh_that}/ngan", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    # Sự cố + nhật ký trở lại 13/10/2026 (ngăn hai cột: thẻ Đang vướng + tab Lịch sử); vật tư vẫn không.
    # 27/10/2026 thêm thẻ quy cách + ô đuôi của dải, mượn của ngăn Việc của tổ.
    assert set(body) == {"thong_tin", "tien_do", "thong_so", "routing", "kcs", "kho", "phien_ban", "tron_goi",
                         "kcs_cuoi", "su_co", "timeline", "quy_cach", "dai_duoi"}
    assert body["kcs_cuoi"] == {"so_lan": 0, "nhan": 0.0, "dat": 0.0, "khong_dat": 0.0}
    assert body["tron_goi"] is None
    assert all("kcs_khong_dat" in n for n in body["routing"]["nodes"])
    assert client.get("/api/lenh-san-xuat/987654/ngan", headers=h).status_code == 404
