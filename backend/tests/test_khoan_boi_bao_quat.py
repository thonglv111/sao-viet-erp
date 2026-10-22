r"""Bao quát khoán Bồi — máy tính lương đối chiếu từng dòng sổ tổ Bồi T08/2026.

Nguồn: hai sheet `Bồi- Giang` (máy lớn) và `Bồi- Qúy` (máy nhỏ, bồi tay) của bảng lương T08 bản 12.09
(`D:\BẢNG LƯƠNG T08.2026 ( 12.09).xls`). Sổ tính: số tờ × (R × D cm ÷ 10.000) × đơn giá m². Bảng giá
đầu sheet có hai cột: "giá mới" cho bồi máy, "giá cũ" cho bồi tay — sheet `Bồi- Qúy` toàn giá cũ, sheet
`Bồi- Giang` dòng ghi chú "BỒI TAY" cũng giá cũ. Trên máy (chủ gom 22/10): mỗi loại bồi một công đoạn,
bồi tay = tick "Bồi tay" lúc ghi, công thức cộng phần chênh tường minh (+30 carton, +40 Duplex TĐ);
BBTĐ hai cột cùng 250 nên không có ô tick. Hai dòng gỡ phôi trong sổ tổ Bồi tính 5đ/con = giá hộp mềm
từ 5 con/tờ của công đoạn GID (gộp GID1 + GID5 ngày 22/10, giá theo chip số con/tờ của lệnh) — dòng 19 sổ
ghi mã GID1 nhưng nội dung + giá là của GID5.

Bỏ hai dòng sổ không tính tiền: `Bồi- Qúy` dòng 22 ("Dư số lượng") và 24 ("KO THẤY LỆNH").
`Bồi- Giang` dòng 58 lệnh thiếu quy cách ⇒ 0 đồng, sổ cũng 0. `Bồi- Qúy` dòng 79 sổ gõ khổ 665 × 56
(chắc 66,5) — giữ nguyên số sổ, máy ra đúng số sổ với cùng khổ đó.

`_may_tinh` đi đúng đường lương: `chuan_hoa_khi_ghi` (chụp giá) → `_tien_chinh` với quy cách lệnh
khoá `kho_in_dai` / `kho_in_rong` tính bằng MM như `lsx.quy_cach_json`. Cấu hình chép từ DB dev
22/10/2026 (công đoạn 61, 63, 65, 67, 77); DB đổi thì chép lại.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.models.cong_doan import CongDoanKhoan
from app.services.khoan_ky import KhoanKyService
from app.services.san_xuat import viec_khoan

TO_BOI = 17
CT_M2 = "sl_ghi * dai_in * rong_in * don_gia_khoan"
BOI_TAY = [{"ma": "boi_tay", "ten": "Bồi tay", "kieu": "co_khong", "goi_y": None}]


def _ct_tay(chenh: int) -> str:
    return f"sl_ghi * dai_in * rong_in * (don_gia_khoan + {chenh} * boi_tay)"


def _khoan(cd_id: int, unit: str, gia: float, ct: str, tuy_chon=None) -> CongDoanKhoan:
    k = CongDoanKhoan(id=cd_id, unit=unit, unit_price=gia, gia_co_dinh=0, cong_thuc_khoan=ct,
                      tuy_chon=tuy_chon, bac_gia=None, gia_theo_to=None)
    k.viec_phat_sinh = []
    return k


K = {
    "BCT3LEB": _khoan(61, "m2", 140, _ct_tay(30), BOI_TAY),
    "BCT5LBEC": _khoan(63, "m2", 170, _ct_tay(30), BOI_TAY),
    "BTĐ": _khoan(65, "m2", 210, _ct_tay(40), BOI_TAY),
    "BBTĐ": _khoan(67, "m2", 250, CT_M2),
    "GID5": _khoan(77, "con", 5, "sl_ghi * (don_gia_khoan + if(so_con >= 5, 0, 5))"),
}


def _may_tinh(ma: str, r_cm: float, d_cm: float, sl: float, tay: int = 0) -> float:
    """Tiền MỘT lần ghi của tổ Bồi; `tay` = thợ tick "Bồi tay"."""
    khoan = K[ma]
    qc = {"kho_in_dai": r_cm * 10, "kho_in_rong": d_cm * 10,       # lệnh lưu khổ in bằng mm
          "so_con": 5 if ma == "GID5" else 1}                       # dòng gỡ phôi: hộp mềm 5 con/tờ
    tc = {"boi_tay": tay} if khoan.tuy_chon else {}
    o, rows = viec_khoan.chuan_hoa_khi_ghi(None, khoan=khoan, ten_cong_doan=ma, phat_sinh=[],
                                           department_id=TO_BOI, tuy_chon=tc, qc=qc)
    assert not rows
    b = SimpleNamespace(**o, tong=sl, tot=sl)
    return KhoanKyService._tien_chinh(khoan, b, qc, {"so_lan_chay": 1.0, "tien_gio": 0.0})


# (sheet, dòng sổ, công đoạn, tick bồi tay, R cm, D cm, số lượng, thành tiền sổ)
DONG = [
    ("Giang", 9, "BCT3LEB", 0, 78.5, 59.5, 10110, 661097.955),
    ("Giang", 10, "BCT3LEB", 0, 78.5, 59.5, 10080, 659136.24),
    ("Giang", 11, "BCT3LEB", 1, 65, 44, 3540, 172114.8),
    ("Giang", 12, "BCT3LEB", 0, 96.5, 62.5, 805, 67972.1875),
    ("Giang", 13, "BCT3LEB", 0, 96.5, 62.5, 75, 6332.8125),
    ("Giang", 14, "BCT3LEB", 0, 86.5, 70, 1650, 139870.5),
    ("Giang", 15, "BCT3LEB", 0, 86.5, 70, 835, 70782.95),
    ("Giang", 16, "BCT3LEB", 0, 52, 51, 2080, 77226.24),
    ("Giang", 17, "BCT3LEB", 1, 65, 44, 5020, 244072.4),
    ("Giang", 18, "BCT3LEB", 0, 86, 69.5, 1440, 120496.32),
    ("Giang", 19, "GID5", 0, 0, 0, 13560, 67800.0),
    ("Giang", 20, "GID5", 0, 0, 0, 7260, 36300.0),
    ("Giang", 21, "BCT3LEB", 1, 82, 68.5, 1125, 107425.125),
    ("Giang", 22, "BCT3LEB", 0, 91.5, 48, 2355, 144804.24),
    ("Giang", 23, "BCT3LEB", 0, 92, 47.5, 2055, 125724.9),
    ("Giang", 24, "BCT3LEB", 0, 92, 47.5, 2080, 127254.4),
    ("Giang", 25, "BCT3LEB", 0, 62, 58, 4320, 217486.08),
    ("Giang", 26, "BCT3LEB", 0, 93, 71.5, 1060, 98678.58),
    ("Giang", 27, "BCT3LEB", 0, 54.5, 52, 1120, 44437.12),
    ("Giang", 28, "BCT3LEB", 0, 66.5, 61, 1555, 88310.005),
    ("Giang", 29, "BCT3LEB", 0, 75, 59.5, 1095, 68410.125),
    ("Giang", 30, "BCT3LEB", 0, 96, 59, 1100, 87225.6),
    ("Giang", 31, "BCT3LEB", 0, 138.5, 96.5, 1585, 296574.8975),
    ("Giang", 32, "BBTĐ", 0, 72, 39.5, 310, 22041.0),
    ("Giang", 33, "BCT3LEB", 0, 96.5, 75, 1060, 107404.5),
    ("Giang", 34, "BCT3LEB", 0, 96.5, 77, 1060, 110268.62),
    ("Giang", 35, "BCT3LEB", 0, 108.5, 85.5, 5030, 653268.735),
    ("Giang", 36, "BCT3LEB", 0, 96.5, 77, 580, 60335.66),
    ("Giang", 37, "BCT3LEB", 0, 96.5, 75, 620, 62821.5),
    ("Giang", 38, "BCT3LEB", 0, 70, 68, 5060, 337198.4),
    ("Giang", 39, "BCT3LEB", 0, 70, 68, 5060, 337198.4),
    ("Giang", 40, "BCT3LEB", 0, 70, 68, 5060, 337198.4),
    ("Giang", 41, "BCT3LEB", 0, 101.5, 65, 1670, 154249.55),
    ("Giang", 42, "BCT3LEB", 0, 101.5, 44, 1380, 86283.12),
    ("Giang", 43, "BCT5LBEC", 0, 96.5, 66.5, 2070, 225823.0275),
    ("Giang", 44, "BCT5LBEC", 0, 96.5, 66.5, 2075, 226368.4937),
    ("Giang", 45, "BCT3LEB", 0, 101.5, 65, 640, 59113.6),
    ("Giang", 46, "BCT3LEB", 0, 101.5, 65, 2080, 192119.2),
    ("Giang", 47, "BCT3LEB", 0, 101.5, 65, 950, 87746.75),
    ("Giang", 48, "BCT3LEB", 0, 101.5, 65, 845, 78048.425),
    ("Giang", 49, "BCT3LEB", 0, 101.5, 65, 1515, 139932.975),
    ("Giang", 50, "BCT3LEB", 0, 101.5, 65, 225, 20782.125),
    ("Giang", 51, "BCT3LEB", 0, 101.5, 65, 650, 60037.25),
    ("Giang", 52, "BCT3LEB", 0, 60.5, 54.5, 2355, 108710.3325),
    ("Giang", 53, "BCT3LEB", 0, 62.5, 58, 1100, 55825.0),
    ("Giang", 54, "BCT3LEB", 0, 46.5, 41.5, 670, 18101.055),
    ("Giang", 55, "BCT3LEB", 0, 73.5, 50, 2370, 121936.5),
    ("Giang", 56, "BCT3LEB", 0, 73.5, 50, 1675, 86178.75),
    ("Giang", 57, "BCT5LBEC", 0, 87, 60, 2075, 184135.5),
    ("Giang", 58, "BCT5LBEC", 0, 0, 0, 2045, 0.0),
    ("Giang", 59, "BCT3LEB", 0, 89, 54.5, 5710, 387748.97),
    ("Giang", 60, "BCT3LEB", 0, 91, 67.5, 1100, 94594.5),
    ("Giang", 61, "BCT3LEB", 0, 103.5, 83.5, 5060, 612216.99),
    ("Giang", 62, "BTĐ", 0, 68.5, 49.5, 4220, 300488.265),
    ("Giang", 63, "BTĐ", 0, 68, 46, 4645, 305120.76),
    ("Giang", 64, "BCT3LEB", 0, 71.5, 51, 5450, 278227.95),
    ("Giang", 65, "BCT3LEB", 0, 70, 100, 10100, 989800.0),
    ("Giang", 66, "BCT3LEB", 0, 96.5, 54.5, 4045, 297831.3275),
    ("Giang", 67, "BCT3LEB", 0, 70, 100, 4630, 453740.0),
    ("Giang", 68, "BCT3LEB", 0, 79, 60, 3650, 242214.0),
    ("Giang", 69, "BCT3LEB", 0, 79, 60, 3645, 241882.2),
    ("Giang", 70, "BCT3LEB", 0, 70, 100, 4640, 454720.0),
    ("Giang", 71, "BCT3LEB", 0, 93, 69.5, 2110, 190931.79),
    ("Giang", 72, "BCT3LEB", 0, 99, 66, 1960, 179292.96),
    ("Giang", 73, "BCT3LEB", 0, 77, 63, 1385, 94060.89),
    ("Giang", 74, "BCT3LEB", 0, 89, 54.5, 6550, 444790.85),
    ("Giang", 75, "BCT3LEB", 0, 74, 65, 5100, 343434.0),
    ("Giang", 76, "BCT5LBEC", 0, 98.5, 71.5, 5040, 603422.82),
    ("Giang", 77, "BCT5LBEC", 0, 92.5, 114.5, 3060, 550956.825),
    ("Giang", 78, "BCT5LBEC", 0, 92.5, 114.5, 3060, 550956.825),
    ("Giang", 79, "BCT3LEB", 0, 96, 80, 6490, 697804.8),
    ("Giang", 80, "BBTĐ", 0, 84, 60, 16820, 2119320.0),
    ("Giang", 81, "BCT3LEB", 0, 80.5, 69, 9430, 733305.09),
    ("Giang", 82, "BCT3LEB", 0, 79, 60, 800, 53088.0),
    ("Giang", 83, "BCT3LEB", 0, 79, 60, 810, 53751.6),
    ("Giang", 84, "BCT5LBEC", 0, 108, 99.5, 1050, 191816.1),
    ("Giang", 85, "BCT5LBEC", 0, 108, 99.5, 1050, 191816.1),
    ("Giang", 86, "BTĐ", 0, 66, 43.5, 2600, 156756.6),
    ("Giang", 87, "BTĐ", 0, 71.5, 52.5, 5150, 405968.0625),
    ("Giang", 88, "BCT3LEB", 0, 91, 74.5, 10450, 991840.85),
    ("Giang", 89, "BCT3LEB", 0, 95, 59, 1100, 86317.0),
    ("Giang", 90, "BCT5LBEC", 0, 82, 62.5, 3095, 269651.875),
    ("Giang", 91, "BCT5LBEC", 0, 82, 54.5, 3080, 233996.84),
    ("Giang", 92, "BCT5LBEC", 0, 78, 62.5, 2100, 174037.5),
    ("Giang", 93, "BCT3LEB", 0, 89, 54.5, 4180, 283851.26),
    ("Giang", 94, "BCT3LEB", 0, 95, 64, 5050, 429856.0),
    ("Giang", 95, "BCT3LEB", 0, 78.5, 68, 6280, 469316.96),
    ("Giang", 96, "BCT5LBEC", 0, 82, 62.5, 3110, 270958.75),
    ("Giang", 97, "BCT5LBEC", 0, 82, 54.5, 2935, 222980.755),
    ("Giang", 98, "BCT5LBEC", 0, 82, 54.5, 2060, 156504.38),
    ("Giang", 99, "BCT5LBEC", 0, 82, 54.5, 1990, 151186.27),
    ("Giang", 100, "BCT3LEB", 0, 89, 54.5, 7470, 507265.29),
    ("Giang", 101, "BTĐ", 0, 60, 84, 3100, 328104.0),
    ("Giang", 102, "BTĐ", 0, 60, 84, 3130, 331279.2),
    ("Giang", 103, "BTĐ", 0, 60, 84, 3140, 332337.6),
    ("Quy", 9, "BCT3LEB", 1, 73.5, 50, 3250, 203043.75),
    ("Quy", 10, "BCT3LEB", 1, 73.5, 50, 3250, 203043.75),
    ("Quy", 11, "BCT3LEB", 1, 82, 68.5, 4105, 391982.345),
    ("Quy", 12, "BCT3LEB", 1, 59.5, 43.5, 4305, 189421.0763),
    ("Quy", 13, "BCT3LEB", 1, 65, 39.5, 2120, 92532.7),
    ("Quy", 14, "BCT3LEB", 1, 59, 54.5, 3045, 166450.3575),
    ("Quy", 15, "BCT3LEB", 1, 59, 54.5, 3050, 166723.675),
    ("Quy", 16, "BCT3LEB", 1, 56.5, 56.5, 4295, 233082.1337),
    ("Quy", 17, "BBTĐ", 0, 74.5, 52.5, 2600, 254231.25),
    ("Quy", 18, "BCT5LBEC", 1, 82, 54.5, 1110, 99211.8),
    ("Quy", 19, "BCT3LEB", 1, 92, 55, 3915, 336768.3),
    ("Quy", 20, "BCT3LEB", 1, 50.5, 48, 300, 12362.4),
    ("Quy", 21, "BCT3LEB", 1, 94.5, 47.5, 3205, 244569.5438),
    ("Quy", 23, "BCT3LEB", 1, 83, 49, 4720, 326336.08),
    ("Quy", 25, "BCT3LEB", 1, 94.5, 47.5, 2945, 224729.2688),
    ("Quy", 26, "BCT5LBEC", 1, 49, 47, 510, 23490.6),
    ("Quy", 27, "BCT3LEB", 1, 93, 71.5, 370, 41825.355),
    ("Quy", 28, "BCT3LEB", 1, 83, 68, 7410, 710974.68),
    ("Quy", 29, "BCT3LEB", 1, 89, 54.5, 3340, 275411.39),
    ("Quy", 30, "BCT3LEB", 1, 96.5, 54.5, 6060, 541807.935),
    ("Quy", 31, "BCT3LEB", 1, 86, 69.5, 3130, 318036.17),
    ("Quy", 32, "BCT3LEB", 1, 65, 44, 815, 39625.3),
    ("Quy", 33, "BCT3LEB", 1, 73.5, 70, 1350, 118077.75),
    ("Quy", 34, "BCT3LEB", 1, 73.5, 70, 2805, 245339.325),
    ("Quy", 35, "BCT3LEB", 1, 67, 49, 700, 39067.7),
    ("Quy", 36, "BCT3LEB", 1, 77.5, 42.5, 2545, 142504.0938),
    ("Quy", 37, "BCT3LEB", 1, 73.5, 50, 675, 42170.625),
    ("Quy", 38, "BCT3LEB", 1, 69, 48.5, 1060, 60303.93),
    ("Quy", 39, "BCT3LEB", 1, 83, 68, 580, 55649.84),
    ("Quy", 40, "BCT3LEB", 1, 80, 70, 945, 89964.0),
    ("Quy", 41, "BCT3LEB", 1, 64, 53.5, 5000, 291040.0),
    ("Quy", 42, "BCT3LEB", 1, 82, 68.5, 6095, 582005.455),
    ("Quy", 43, "BCT3LEB", 1, 88.5, 53.5, 2580, 207666.135),
    ("Quy", 44, "BCT3LEB", 1, 63.5, 63.5, 570, 39072.5025),
    ("Quy", 45, "BCT3LEB", 1, 75, 61.5, 750, 58809.375),
    ("Quy", 46, "BCT3LEB", 1, 75, 61.5, 750, 58809.375),
    ("Quy", 47, "BCT3LEB", 1, 96.5, 59, 1760, 170349.52),
    ("Quy", 48, "BCT3LEB", 1, 86, 69.5, 1840, 186960.56),
    ("Quy", 49, "BCT3LEB", 1, 86, 69.5, 3185, 323624.665),
    ("Quy", 50, "BCT3LEB", 1, 101.5, 44, 770, 58459.94),
    ("Quy", 51, "BCT3LEB", 1, 72, 43, 2655, 139737.96),
    ("Quy", 52, "BCT5LBEC", 1, 99.5, 77.5, 5075, 782691.875),
    ("Quy", 53, "BCT3LEB", 1, 96.5, 59, 2110, 204225.845),
    ("Quy", 54, "BCT5LBEC", 1, 82, 62.5, 920, 94300.0),
    ("Quy", 55, "BCT3LEB", 1, 96.5, 59, 350, 33876.325),
    ("Quy", 56, "BCT3LEB", 1, 96.5, 59, 2010, 194546.895),
    ("Quy", 57, "BCT5LBEC", 1, 99.5, 75.5, 5060, 760239.7),
    ("Quy", 58, "BCT3LEB", 1, 62, 58, 4290, 262256.28),
    ("Quy", 59, "BCT3LEB", 1, 58.5, 55.5, 1100, 60714.225),
    ("Quy", 60, "BCT3LEB", 1, 99.5, 68, 4160, 478491.52),
    ("Quy", 61, "BCT3LEB", 1, 71, 51.5, 1085, 67444.1425),
    ("Quy", 62, "BCT3LEB", 1, 60, 56, 1100, 62832.0),
    ("Quy", 63, "BCT3LEB", 1, 71, 39.5, 1050, 50060.325),
    ("Quy", 64, "BCT3LEB", 1, 54.5, 47, 1080, 47029.14),
    ("Quy", 65, "BCT5LBEC", 1, 105, 63.5, 2290, 305371.5),
    ("Quy", 66, "BCT3LEB", 1, 75, 46, 1090, 63928.5),
    ("Quy", 67, "BCT3LEB", 1, 75, 46, 1045, 61289.25),
    ("Quy", 68, "BCT5LBEC", 1, 105, 63.5, 945, 126015.75),
    ("Quy", 69, "BCT3LEB", 1, 80, 70, 2030, 193256.0),
    ("Quy", 70, "BCT5LBEC", 1, 82, 62.5, 1175, 120437.5),
    ("Quy", 71, "BCT5LBEC", 1, 113.5, 67.5, 4970, 761528.25),
    ("Quy", 72, "BCT5LBEC", 1, 113.5, 67.5, 1915, 293425.875),
    ("Quy", 73, "BCT3LEB", 1, 93, 71.5, 1055, 119258.7825),
    ("Quy", 74, "BCT3LEB", 1, 82.5, 59, 725, 59991.9375),
    ("Quy", 75, "BCT3LEB", 1, 77.5, 42.5, 2575, 144183.9062),
    ("Quy", 76, "BCT3LEB", 1, 58, 48, 1100, 52060.8),
    ("Quy", 77, "BCT3LEB", 1, 54, 40, 2100, 77112.0),
    ("Quy", 78, "BCT3LEB", 1, 65, 56, 1560, 96532.8),
    ("Quy", 79, "BCT3LEB", 1, 665, 56, 705, 446321.4),
    ("Quy", 80, "BCT3LEB", 1, 76.5, 59.5, 1770, 136962.1575),
    ("Quy", 81, "BCT3LEB", 1, 86, 70, 4790, 490208.6),
    ("Quy", 82, "BCT3LEB", 1, 86, 70, 4465, 456948.1),
    ("Quy", 83, "BCT3LEB", 1, 86, 70, 5055, 517328.7),
    ("Quy", 84, "BCT3LEB", 1, 78, 60, 1565, 124511.4),
    ("Quy", 85, "BCT3LEB", 1, 102, 48.5, 2440, 205201.56),
    ("Quy", 86, "BCT3LEB", 1, 102, 48.5, 2515, 211508.985),
    ("Quy", 87, "BCT3LEB", 1, 67, 47, 1885, 100909.705),
    ("Quy", 88, "BCT3LEB", 1, 71, 43.5, 6635, 348367.3575),
    ("Quy", 89, "BCT3LEB", 1, 66.5, 44.5, 1310, 65902.4975),
    ("Quy", 90, "BCT3LEB", 1, 102, 52.5, 1105, 100593.675),
    ("Quy", 91, "BCT3LEB", 1, 101.5, 44, 2160, 163991.52),
    ("Quy", 92, "BCT3LEB", 1, 69, 64, 2500, 187680.0),
    ("Quy", 93, "BCT3LEB", 1, 69, 64, 2290, 171914.88),
    ("Quy", 94, "BCT3LEB", 1, 97, 69, 2570, 292417.17),
    ("Quy", 95, "BCT3LEB", 1, 69, 64, 2710, 203445.12),
    ("Quy", 96, "BCT3LEB", 1, 69, 64, 2560, 192184.32),
    ("Quy", 97, "BCT3LEB", 1, 69, 64, 65, 4879.68),
    ("Quy", 98, "BCT3LEB", 1, 66.5, 44.5, 45, 2263.8262),
    ("Quy", 99, "BCT3LEB", 1, 91, 54.5, 3700, 311952.55),
    ("Quy", 100, "BCT5LBEC", 1, 87, 67, 2020, 235491.6),
    ("Quy", 101, "BCT5LBEC", 1, 82, 54.5, 165, 14747.7),
    ("Quy", 102, "BCT3LEB", 1, 89, 54.5, 300, 24737.55),
    ("Quy", 103, "BCT3LEB", 1, 91, 54.5, 3000, 252934.5),
]
TONG_SO = {"Giang": 25_122_203.15, "Quy": 18_841_778.29}     # ô TỔNG hai sheet; cộng = 43.963.981 "Tổng lương sp"


@pytest.mark.parametrize(("sheet", "dong", "ma", "tay", "r", "d", "sl", "so"), DONG,
                         ids=[f"{x[0]} dòng {x[1]} {x[2]}{' tay' if x[3] else ''}" for x in DONG])
def test_tung_dong_so_khop(sheet, dong, ma, tay, r, d, sl, so):
    assert _may_tinh(ma, r, d, sl, tay) == pytest.approx(so, abs=0.5)


def test_tong_hai_sheet_khop_o_tong():
    for sheet, tong_so in TONG_SO.items():
        tong = sum(_may_tinh(ma, r, d, sl, tay) for sh, _d, ma, tay, r, d, sl, _so in DONG if sh == sheet)
        assert tong == pytest.approx(tong_so, abs=1)


def test_lenh_thieu_quy_cach_ra_0():
    # Sổ dòng 58 sheet Giang: "THIẾU QC" ⇒ 0 đồng. Chủ 22/10: thiếu số để tính thì tiền là 0.
    assert _may_tinh("BCT5LBEC", 0, 0, 2_045) == 0


@pytest.mark.parametrize(("ma", "may", "tay"), [("BCT3LEB", 140, 170), ("BCT5LBEC", 170, 200),
                                                ("BTĐ", 210, 250), ("BBTĐ", 250, 250)])
def test_tick_boi_tay_ra_dung_cot_gia_cu(ma, may, tay):
    # Bảng giá đầu sheet: "giá mới" = bồi máy, "giá cũ" = bồi tay. 1.000 tờ khổ 1 m² cho dễ đọc.
    assert _may_tinh(ma, 100, 100, 1_000) == pytest.approx(may * 1_000)
    assert _may_tinh(ma, 100, 100, 1_000, tay=1 if K[ma].tuy_chon else 0) == pytest.approx(tay * 1_000)
