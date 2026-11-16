"""Thuộc tính lọc của bàn tổ (09/10/2026): vị trí hàng trên tuyến công đoạn — luật thuần, không DB.

Cùng luật với `frontend/src/pages/thsxTuyen.ts` (`viTriHang`): bước hàng đang ở là bước XA NHẤT
đang chạy/tạm dừng; không có thì bước đầu chưa xong; xong hết thì bước cuối."""
from app.services.san_xuat.loc_ban_to import vi_tri_hang


def _dai(*tt, toi_o=1):
    return [{"thu_tu": i + 1, "trang_thai": t, "cong_viec_id": (99 if i + 1 == toi_o else None)}
            for i, t in enumerate(tt)]


def test_toi_khi_buoc_cua_to_dang_chay():
    assert vi_tri_hang(_dai("running", "released", "released", toi_o=1), 99) == "toi"


def test_con_2_3_buoc():
    assert vi_tri_hang(_dai("completed", "running", "released", "released", "released", toi_o=4), 99) == "con_2_3"


def test_con_1_buoc():
    assert vi_tri_hang(_dai("running", "released", toi_o=2), 99) == "con_1"


def test_con_4_buoc():
    assert vi_tri_hang(_dai("running", "released", "released", "released", "released", toi_o=5), 99) == "con_4"


def test_qua_khi_hang_da_o_buoc_sau():
    assert vi_tri_hang(_dai("completed", "running", "released", toi_o=1), 99) == "qua"


def test_chua_ai_chay_thi_lay_buoc_dau_chua_xong():
    assert vi_tri_hang(_dai("completed", "released", "released", toi_o=3), 99) == "con_1"


def test_xong_het_la_buoc_cuoi():
    assert vi_tri_hang(_dai("completed", "completed", toi_o=1), 99) == "qua"


def test_tam_dung_tinh_nhu_dang_lam():
    assert vi_tri_hang(_dai("completed", "paused", "released", toi_o=2), 99) == "toi"


def test_khong_co_dai():
    assert vi_tri_hang([], 99) is None


def test_khong_thay_buoc_cua_viec():
    assert vi_tri_hang(_dai("running", "released", toi_o=1), 12345) is None


def test_buoc_thue_gia_cong_co_san_luong_tinh_la_co_hang():
    dai = _dai("released", "released", "released", "released", "released", toi_o=5)
    dai[3]["thuc_te"] = 1000
    assert vi_tri_hang(dai, 99) == "con_1"


def test_to_minh_da_nhan_chua_bat_dau_la_toi():
    dai = _dai("released", "released", "released", "released", "released", toi_o=5)
    dai[3]["thuc_te"] = 1000
    dai[4]["da_nhan"] = 1000
    assert vi_tri_hang(dai, 99) == "toi"


def test_buoc_da_xong_khong_keo_vi_tri():
    dai = _dai("completed", "released", "released", toi_o=3)
    dai[0]["thuc_te"] = 500
    assert vi_tri_hang(dai, 99) == "con_1"


def test_phan_doan_sau_tim_o_qua_step_key():
    dai = [{"thu_tu": 1, "step_key": "a", "trang_thai": "running", "cong_viec_id": None},
           {"thu_tu": 2, "step_key": "b", "trang_thai": "released", "cong_viec_id": 7}]
    assert vi_tri_hang(dai, 8, "b") == "con_1"  # 8 là phân đoạn thứ hai của bước "b"
