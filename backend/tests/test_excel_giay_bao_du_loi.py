"""Nhập Excel danh mục Giấy: báo ĐỦ lỗi của một dòng, đúng tên cột, file xuất ghi nhãn đơn vị
(lỗi #55 bấm thử 18/10/2026).

Bấm thử B21: một dòng mới có định lượng "abc" và đơn giá −5 mà mỗi lượt chỉ báo một lỗi — phải nạp
lại từng lần mới thấy lỗi kế. Lỗi đơn giá âm thì ô cột ghi "—". File xuất ghi cột "ĐVT thêm" bằng mã
thô "to" thay vì chữ người dùng đọc "tờ".

Luật: lỗi kiểu dữ liệu và lỗi giới hạn của schema báo hết trong một lượt, mỗi lỗi một dòng gắn đúng
cột. Lỗi nghiệp vụ của service (ĐVT không có trong danh mục) vẫn chỉ lộ ra khi dòng đã qua schema —
service dừng ở lỗi đầu. Cột "ĐVT thêm" xuất nhãn; nhập lại nhãn đó vẫn ra đúng mã.
"""
from __future__ import annotations

from tests.test_import_excel import PREFIX, _chinh, _dong_theo_ma, _login, _nhap, _tao, _wb_tu

GIAY = "giay"
TIEU_DE = ["Mã", "Tên", "Định lượng (gsm)", "Đơn vị giá", "ĐVT thêm", "Đơn giá"]


def test_mot_dong_ba_loi_bao_du_ba_loi_dung_cot(client, seed_credentials):
    h = _login(client)
    file = _wb_tu(TIEU_DE, [["GI-LOI-3", None, "abc", "kg", None, -5]], ten_sheet="Giấy", loai=GIAY)
    r = _nhap(client, h, PREFIX[GIAY], file)
    assert r.status_code == 200, r.text
    kq = r.json()
    assert kq["hop_le"] is False and kq["da_ghi"] is False
    cot = sorted(x["cot"] for x in kq["loi"] if x["dong"] == 2)
    assert cot == ["Tên", "Đơn giá", "Định lượng (gsm)"], kq["loi"]


def test_don_gia_am_ghi_dung_cot(client, seed_credentials):
    h = _login(client)
    file = _wb_tu(TIEU_DE, [["GI-LOI-1", "Giấy lỗi giá", 200, "kg", None, -5]], ten_sheet="Giấy",
                  loai=GIAY)
    kq = _nhap(client, h, PREFIX[GIAY], file).json()
    assert [(x["cot"], x["ly_do"]) for x in kq["loi"]] == [("Đơn giá", 'Cột "Đơn giá" phải ≥ 0.')]


def test_xuat_dvt_them_bang_nhan_nhap_lai_van_dung_ma(client, seed_credentials):
    h = _login(client)
    _tao(client, h, GIAY, {"ma": "GI-DVT-TO", "ten": "Giấy có tờ", "gsm": 150, "don_vi_gia": "kg",
                           "don_vi_them": ["to"]})
    tieu_de, dong = _chinh(client, h, GIAY)
    d = _dong_theo_ma(tieu_de, dong, "GI-DVT-TO")
    assert d[tieu_de.index("ĐVT thêm")] == "tờ"

    # Nhập lại đúng nhãn đã xuất ⇒ không đổi gì (nhãn quy về mã "to").
    file = _wb_tu(TIEU_DE, [["GI-DVT-TO", "Giấy có tờ", 150, "kg", "tờ", 0]], ten_sheet="Giấy",
                  loai=GIAY)
    kq = _nhap(client, h, PREFIX[GIAY], file).json()
    assert kq["loi"] == [] and kq["khong_doi"] == 1, kq
