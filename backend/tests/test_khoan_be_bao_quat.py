r"""Bao quát khoán Bế — máy tính lương đối chiếu từng dòng sổ 6 kíp bế T08/2026.

Nguồn: sheet `Bế- Kiệt+Tâm`, `Bế- Long`, `Bế -Linh` (kíp tự động) và `Bế- Cường`, `Bế- Hòa`, `Bế- Bằng`
(kíp bán tự động) của bảng lương T08 bản 12.09 (`D:\BẢNG LƯƠNG T08.2026 ( 12.09).xls`). Sổ tính:
lên khuôn (bỏ khi "Trùng khuôn" = X) + số tờ × giá tờ rớt. Mã đuôi M = khuôn mới, lên khuôn 80.000.
Ghi chú "Đục từ 1-6 lỗ" ⇒ tờ rớt +20, "Đục từ 7 lỗ trở lên" ⇒ +50 — trên máy là tuỳ chọn "Số lỗ đục".
Một dòng gỡ phôi trong sheet Long tính 5đ/con = công đoạn GID (gộp 22/10) với lệnh hộp mềm 5 con/tờ.

Giấy nhãn (chủ gom 22/10): KN2C "C200 trở xuống" 40 và KN21C "C210 trở lên" 60 gộp một công đoạn, tờ rớt
`+ if(dinh_luong > 0.2, 20, 0)` theo giấy của lệnh — dòng sổ KN21* chạy với giấy 210g, KN2* với 200g.

Năm dòng ghi chú có đục lỗ nhưng sổ QUÊN cộng phụ thu (tờ rớt vẫn giá trơn) — `QUEN_DUC_LO`: trên máy
thợ nhập số lỗ thì ăn đủ phụ thu, nên máy = sổ + số tờ × 20 / 50 (cộng 324.900 đ cả tháng).

Không đưa vào: `Bế- NHẤT` (bản 12.09 Nhất ăn bù lỗ, tiền SP không vào lương; giá ép kim trong sheet
còn 60 trong khi chủ chốt kíp tự động 80), `Bế-Hồng Châu` (không dòng nào có tiền), `bế sô Tùng`
(ăn theo giờ), `bế sô` (dữ liệu 12/2025), `Bế xô sp` (mẫu trống).

`_may_tinh` đi đúng đường lương: `chuan_hoa_khi_ghi` (chụp giá theo tổ + tuỳ chọn) → `_tien_chinh`.
Bàn tổ bế ghi theo CON, công thức chia `so_con` ra tờ — test cho lệnh 1 con/tờ nên số ghi = số tờ sổ.
Cấu hình chép từ DB dev 22/10/2026 (công đoạn 18, 41, 44, 46, 48, 50, 52, 54, 77); DB đổi thì chép lại.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.models.cong_doan import CongDoanKhoan
from app.services.khoan_ky import KhoanKyService
from app.services.san_xuat import viec_khoan

CFG = [
    {'id': 18, 'ma': 'KDCC', 'unit': 'to', 'ct': '(1 - trung_khuon) * if(khuon_moi > 0, 80000, gia_co_dinh) * (1 + kem_be_noi) + (sl_ghi / max(1, so_con)) * (don_gia_khoan + 20 * kem_be_noi + if(so_lo >= 7, 50, if(so_lo >= 1, 20, 0)))', 'gcd': 0.0, 'dg': 0.0, 'gtt': [{'department_id': 21, 'don_gia': 40.0, 'gia_co_dinh': 50000.0}, {'department_id': 22, 'don_gia': 40.0, 'gia_co_dinh': 50000.0}, {'department_id': 23, 'don_gia': 40.0, 'gia_co_dinh': 50000.0}, {'department_id': 24, 'don_gia': 60.0, 'gia_co_dinh': 50000.0}, {'department_id': 25, 'don_gia': 60.0, 'gia_co_dinh': 50000.0}, {'department_id': 26, 'don_gia': 60.0, 'gia_co_dinh': 50000.0}], 'tc': [{'ma': 'trung_khuon', 'ten': 'Trùng khuôn', 'kieu': 'co_khong', 'goi_y': None}, {'ma': 'so_lo', 'ten': 'Số lỗ đục', 'kieu': 'so', 'goi_y': 'số lỗ trên mỗi con'}, {'ma': 'khuon_moi', 'ten': 'Khuôn mới (lên khuôn 80.000)', 'kieu': 'co_khong', 'goi_y': None}, {'ma': 'kem_be_noi', 'ten': 'Kèm bế nổi — kíp tự động (+20 đ/tờ, lên khuôn 2 lần)', 'kieu': 'co_khong', 'goi_y': None}]},
    {'id': 41, 'ma': 'BE-KHC', 'unit': 'to', 'ct': '(1 - trung_khuon) * if(khuon_moi > 0, 80000, gia_co_dinh) * (1 + kem_be_noi) + (sl_ghi / max(1, so_con)) * (don_gia_khoan + 20 * kem_be_noi + if(so_lo >= 7, 50, if(so_lo >= 1, 20, 0)))', 'gcd': 50000.0, 'dg': 40.0, 'gtt': None, 'tc': [{'ma': 'trung_khuon', 'ten': 'Trùng khuôn', 'kieu': 'co_khong', 'goi_y': None}, {'ma': 'so_lo', 'ten': 'Số lỗ đục', 'kieu': 'so', 'goi_y': 'số lỗ trên mỗi con'}, {'ma': 'khuon_moi', 'ten': 'Khuôn mới (lên khuôn 80.000)', 'kieu': 'co_khong', 'goi_y': None}, {'ma': 'kem_be_noi', 'ten': 'Kèm bế nổi — kíp tự động (+20 đ/tờ, lên khuôn 2 lần)', 'kieu': 'co_khong', 'goi_y': None}]},
    {'id': 44, 'ma': 'BNC', 'unit': 'to', 'ct': '(1 - trung_khuon) * if(khuon_moi > 0, 80000, gia_co_dinh) + (sl_ghi / max(1, so_con)) * (don_gia_khoan + if(so_lo >= 7, 50, if(so_lo >= 1, 20, 0)))', 'gcd': 0.0, 'dg': 0.0, 'gtt': [{'department_id': 21, 'don_gia': 40.0, 'gia_co_dinh': 50000.0}, {'department_id': 22, 'don_gia': 40.0, 'gia_co_dinh': 50000.0}, {'department_id': 23, 'don_gia': 40.0, 'gia_co_dinh': 50000.0}, {'department_id': 24, 'don_gia': 80.0, 'gia_co_dinh': 50000.0}, {'department_id': 25, 'don_gia': 80.0, 'gia_co_dinh': 50000.0}, {'department_id': 26, 'don_gia': 80.0, 'gia_co_dinh': 50000.0}], 'tc': [{'ma': 'trung_khuon', 'ten': 'Trùng khuôn', 'kieu': 'co_khong', 'goi_y': None}, {'ma': 'so_lo', 'ten': 'Số lỗ đục', 'kieu': 'so', 'goi_y': 'số lỗ trên mỗi con'}, {'ma': 'khuon_moi', 'ten': 'Khuôn mới (lên khuôn 80.000)', 'kieu': 'co_khong', 'goi_y': None}]},
    {'id': 46, 'ma': 'EKC', 'unit': 'to', 'ct': '(1 - trung_khuon) * if(khuon_moi > 0, 80000, gia_co_dinh) + (sl_ghi / max(1, so_con)) * (don_gia_khoan + if(so_lo >= 7, 50, if(so_lo >= 1, 20, 0)))', 'gcd': 0.0, 'dg': 0.0, 'gtt': [{'department_id': 21, 'don_gia': 80.0, 'gia_co_dinh': 50000.0}, {'department_id': 22, 'don_gia': 80.0, 'gia_co_dinh': 50000.0}, {'department_id': 23, 'don_gia': 80.0, 'gia_co_dinh': 50000.0}, {'department_id': 24, 'don_gia': 100.0, 'gia_co_dinh': 50000.0}, {'department_id': 25, 'don_gia': 100.0, 'gia_co_dinh': 50000.0}, {'department_id': 26, 'don_gia': 100.0, 'gia_co_dinh': 50000.0}], 'tc': [{'ma': 'trung_khuon', 'ten': 'Trùng khuôn', 'kieu': 'co_khong', 'goi_y': None}, {'ma': 'so_lo', 'ten': 'Số lỗ đục', 'kieu': 'so', 'goi_y': 'số lỗ trên mỗi con'}, {'ma': 'khuon_moi', 'ten': 'Khuôn mới (lên khuôn 80.000)', 'kieu': 'co_khong', 'goi_y': None}]},
    {'id': 48, 'ma': 'BDMC', 'unit': 'to', 'ct': '(1 - trung_khuon) * if(khuon_moi > 0, 80000, gia_co_dinh) * (1 + kem_be_noi) + (sl_ghi / max(1, so_con)) * (don_gia_khoan + 20 * kem_be_noi + if(so_lo >= 7, 50, if(so_lo >= 1, 20, 0)))', 'gcd': 0.0, 'dg': 0.0, 'gtt': [{'department_id': 21, 'don_gia': 60.0, 'gia_co_dinh': 50000.0}, {'department_id': 22, 'don_gia': 60.0, 'gia_co_dinh': 50000.0}, {'department_id': 23, 'don_gia': 60.0, 'gia_co_dinh': 50000.0}, {'department_id': 24, 'don_gia': 100.0, 'gia_co_dinh': 50000.0}, {'department_id': 25, 'don_gia': 100.0, 'gia_co_dinh': 50000.0}, {'department_id': 26, 'don_gia': 100.0, 'gia_co_dinh': 50000.0}], 'tc': [{'ma': 'trung_khuon', 'ten': 'Trùng khuôn', 'kieu': 'co_khong', 'goi_y': None}, {'ma': 'so_lo', 'ten': 'Số lỗ đục', 'kieu': 'so', 'goi_y': 'số lỗ trên mỗi con'}, {'ma': 'khuon_moi', 'ten': 'Khuôn mới (lên khuôn 80.000)', 'kieu': 'co_khong', 'goi_y': None}, {'ma': 'kem_be_noi', 'ten': 'Kèm bế nổi — kíp tự động (+20 đ/tờ, lên khuôn 2 lần)', 'kieu': 'co_khong', 'goi_y': None}]},
    {'id': 50, 'ma': 'BCTC', 'unit': 'to', 'ct': '(1 - trung_khuon) * if(khuon_moi > 0, 80000, gia_co_dinh) * (1 + kem_be_noi) + (sl_ghi / max(1, so_con)) * (don_gia_khoan + 20 * kem_be_noi + if(so_lo >= 7, 50, if(so_lo >= 1, 20, 0)))', 'gcd': 0.0, 'dg': 0.0, 'gtt': [{'department_id': 21, 'don_gia': 70.0, 'gia_co_dinh': 50000.0}, {'department_id': 22, 'don_gia': 70.0, 'gia_co_dinh': 50000.0}, {'department_id': 23, 'don_gia': 70.0, 'gia_co_dinh': 50000.0}, {'department_id': 24, 'don_gia': 100.0, 'gia_co_dinh': 60000.0}, {'department_id': 25, 'don_gia': 100.0, 'gia_co_dinh': 60000.0}, {'department_id': 26, 'don_gia': 100.0, 'gia_co_dinh': 60000.0}], 'tc': [{'ma': 'trung_khuon', 'ten': 'Trùng khuôn', 'kieu': 'co_khong', 'goi_y': None}, {'ma': 'so_lo', 'ten': 'Số lỗ đục', 'kieu': 'so', 'goi_y': 'số lỗ trên mỗi con'}, {'ma': 'khuon_moi', 'ten': 'Khuôn mới (lên khuôn 80.000)', 'kieu': 'co_khong', 'goi_y': None}, {'ma': 'kem_be_noi', 'ten': 'Kèm bế nổi — kíp tự động (+20 đ/tờ, lên khuôn 2 lần)', 'kieu': 'co_khong', 'goi_y': None}]},
    {'id': 52, 'ma': 'BCT5LC', 'unit': 'to', 'ct': '(1 - trung_khuon) * if(khuon_moi > 0, 80000, gia_co_dinh) * (1 + kem_be_noi) + (sl_ghi / max(1, so_con)) * (don_gia_khoan + 20 * kem_be_noi + if(so_lo >= 7, 50, if(so_lo >= 1, 20, 0)))', 'gcd': 0.0, 'dg': 0.0, 'gtt': [{'department_id': 21, 'don_gia': 100.0, 'gia_co_dinh': 50000.0}, {'department_id': 22, 'don_gia': 100.0, 'gia_co_dinh': 50000.0}, {'department_id': 23, 'don_gia': 100.0, 'gia_co_dinh': 50000.0}, {'department_id': 24, 'don_gia': 150.0, 'gia_co_dinh': 60000.0}, {'department_id': 25, 'don_gia': 150.0, 'gia_co_dinh': 60000.0}, {'department_id': 26, 'don_gia': 150.0, 'gia_co_dinh': 60000.0}], 'tc': [{'ma': 'trung_khuon', 'ten': 'Trùng khuôn', 'kieu': 'co_khong', 'goi_y': None}, {'ma': 'so_lo', 'ten': 'Số lỗ đục', 'kieu': 'so', 'goi_y': 'số lỗ trên mỗi con'}, {'ma': 'khuon_moi', 'ten': 'Khuôn mới (lên khuôn 80.000)', 'kieu': 'co_khong', 'goi_y': None}, {'ma': 'kem_be_noi', 'ten': 'Kèm bế nổi — kíp tự động (+20 đ/tờ, lên khuôn 2 lần)', 'kieu': 'co_khong', 'goi_y': None}]},
    {'id': 54, 'ma': 'KN2C', 'unit': 'to', 'ct': '( 1 - trung_khuon ) * if ( khuon_moi > 0 , 80000 , gia_co_dinh ) + ( sl_ghi / max ( 1 , so_con ) ) * ( don_gia_khoan + if ( dinh_luong > 0.2 , 20 , 0 ) + if ( so_lo >= 7 , 50 , if ( so_lo >= 1 , 20 , 0 ) ) )', 'gcd': 50000.0, 'dg': 40.0, 'gtt': None, 'tc': [{'ma': 'trung_khuon', 'ten': 'Trùng khuôn', 'kieu': 'co_khong', 'goi_y': None}, {'ma': 'so_lo', 'ten': 'Số lỗ đục', 'kieu': 'so', 'goi_y': 'số lỗ trên mỗi con'}, {'ma': 'khuon_moi', 'ten': 'Khuôn mới (lên khuôn 80.000)', 'kieu': 'co_khong', 'goi_y': None}]},
    {'id': 77, 'ma': 'GID', 'unit': 'con', 'ct': 'sl_ghi * (don_gia_khoan + if(so_con >= 5, 0, 5))', 'gcd': 0.0, 'dg': 5.0, 'gtt': None, 'tc': None},
]


def _khoan(c: dict) -> CongDoanKhoan:
    k = CongDoanKhoan(id=c["id"], unit=c["unit"], unit_price=c["dg"], gia_co_dinh=c["gcd"],
                      cong_thuc_khoan=c["ct"], tuy_chon=c["tc"], bac_gia=None, gia_theo_to=c["gtt"])
    k.viec_phat_sinh = []
    return k


K = {c["ma"]: _khoan(c) for c in CFG}


def _may_tinh(ma: str, to: int, sl: float, *, moi: int = 0, trung: int = 0, so_lo: int = 0,
              so_con: int = 1, kem_be_noi: int = 0, gsm: int = 0) -> float:
    """Tiền MỘT lần ghi; `sl` = số ghi ở bàn tổ (con)."""
    khoan = K[ma]
    if ma == "GID":
        so_con = 5                                  # dòng gỡ phôi sheet Long: hộp mềm 5 con/tờ
    qc = {"so_con": so_con, "gsm": gsm}
    tc = {k: v for k, v in {"khuon_moi": moi, "trung_khuon": trung, "so_lo": so_lo, "kem_be_noi": kem_be_noi}.items()
          if any(t["ma"] == k for t in khoan.tuy_chon or [])}
    o, rows = viec_khoan.chuan_hoa_khi_ghi(None, khoan=khoan, ten_cong_doan=ma, phat_sinh=[],
                                           department_id=to, tuy_chon=tc, qc=qc)
    assert not rows
    b = SimpleNamespace(**o, tong=sl, tot=sl)
    return KhoanKyService._tien_chinh(khoan, b, qc, {"so_lan_chay": 1.0, "tien_gio": 0.0})


# (sheet, dòng sổ, công đoạn, tổ, khuôn mới, trùng khuôn, số lỗ, định lượng giấy g/m², số tờ, thành tiền sổ)
DONG = [
    ("Kiệt+Tâm", 17, "KDCC", 21, 0, 0, 0, 0, 6120, 294800.0),
    ("Kiệt+Tâm", 18, "KDCC", 21, 0, 0, 0, 0, 1890, 125600.0),
    ("Kiệt+Tâm", 19, "KDCC", 21, 0, 1, 0, 0, 3290, 131600.0),
    ("Kiệt+Tâm", 20, "KDCC", 21, 0, 0, 1, 0, 6360, 431600.0),
    ("Kiệt+Tâm", 21, "KDCC", 21, 0, 0, 0, 0, 1890, 125600.0),
    ("Kiệt+Tâm", 22, "KDCC", 21, 0, 1, 0, 0, 4400, 176000.0),
    ("Kiệt+Tâm", 23, "KDCC", 21, 0, 1, 0, 0, 1605, 64200.0),
    ("Kiệt+Tâm", 24, "KDCC", 21, 0, 1, 0, 0, 4780, 191200.0),
    ("Kiệt+Tâm", 25, "KDCC", 21, 0, 1, 0, 0, 4450, 178000.0),
    ("Kiệt+Tâm", 26, "KDCC", 21, 0, 0, 7, 0, 19800, 1832000.0),
    ("Kiệt+Tâm", 27, "BCTC", 21, 0, 0, 0, 0, 12200, 904000.0),
    ("Kiệt+Tâm", 28, "KDCC", 21, 0, 0, 0, 0, 6580, 313200.0),
    ("Kiệt+Tâm", 29, "KDCC", 21, 0, 1, 0, 0, 4310, 172400.0),
    ("Kiệt+Tâm", 30, "KDCC", 21, 0, 0, 0, 0, 16150, 696000.0),
    ("Kiệt+Tâm", 31, "KDCC", 21, 0, 0, 0, 0, 10670, 476800.0),
    ("Kiệt+Tâm", 32, "KDCC", 21, 0, 0, 0, 0, 16550, 712000.0),
    ("Kiệt+Tâm", 33, "KDCC", 21, 1, 0, 0, 0, 10840, 513600.0),
    ("Kiệt+Tâm", 34, "KDCC", 21, 1, 0, 0, 0, 7640, 385600.0),
    ("Kiệt+Tâm", 36, "KDCC", 21, 0, 0, 0, 0, 16400, 706000.0),
    ("Kiệt+Tâm", 37, "KDCC", 21, 0, 0, 0, 0, 10270, 460800.0),
    ("Kiệt+Tâm", 38, "KDCC", 21, 1, 0, 0, 0, 5170, 286800.0),
    ("Kiệt+Tâm", 39, "KDCC", 21, 0, 0, 0, 0, 8450, 388000.0),
    ("Kiệt+Tâm", 40, "KDCC", 21, 0, 0, 0, 0, 3180, 177200.0),
    ("Kiệt+Tâm", 41, "KDCC", 21, 0, 0, 0, 0, 5180, 257200.0),
    ("Kiệt+Tâm", 42, "KDCC", 21, 1, 0, 0, 0, 13700, 628000.0),
    ("Kiệt+Tâm", 43, "KDCC", 21, 0, 1, 0, 0, 13200, 528000.0),
    ("Kiệt+Tâm", 44, "KDCC", 21, 0, 1, 0, 0, 10300, 412000.0),
    ("Kiệt+Tâm", 45, "KDCC", 21, 0, 1, 0, 0, 4150, 166000.0),
    ("Kiệt+Tâm", 46, "KDCC", 21, 0, 1, 0, 0, 12450, 498000.0),
    ("Kiệt+Tâm", 47, "KDCC", 21, 0, 1, 0, 0, 12750, 510000.0),
    ("Kiệt+Tâm", 48, "KDCC", 21, 0, 0, 0, 0, 3530, 191200.0),
    ("Kiệt+Tâm", 49, "KDCC", 21, 0, 1, 0, 0, 1200, 48000.0),
    ("Kiệt+Tâm", 50, "KDCC", 21, 0, 1, 0, 0, 1070, 42800.0),
    ("Kiệt+Tâm", 51, "KDCC", 21, 0, 1, 0, 0, 5760, 230400.0),
    ("Kiệt+Tâm", 52, "KDCC", 21, 0, 0, 0, 0, 7700, 358000.0),
    ("Kiệt+Tâm", 53, "KDCC", 21, 0, 1, 0, 0, 3900, 156000.0),
    ("Kiệt+Tâm", 54, "KDCC", 21, 0, 0, 0, 0, 19220, 818800.0),
    ("Kiệt+Tâm", 55, "KDCC", 21, 0, 0, 0, 0, 5590, 273600.0),
    ("Kiệt+Tâm", 56, "KDCC", 21, 0, 0, 0, 0, 3810, 202400.0),
    ("Kiệt+Tâm", 57, "KDCC", 21, 0, 1, 0, 0, 3550, 142000.0),
    ("Kiệt+Tâm", 58, "KDCC", 21, 0, 1, 0, 0, 7260, 290400.0),
    ("Kiệt+Tâm", 59, "KDCC", 21, 0, 1, 0, 0, 8940, 357600.0),
    ("Kiệt+Tâm", 60, "KDCC", 21, 0, 0, 0, 0, 5200, 258000.0),
    ("Kiệt+Tâm", 61, "KDCC", 21, 0, 1, 0, 0, 10690, 427600.0),
    ("Kiệt+Tâm", 62, "KDCC", 21, 1, 0, 0, 0, 5, 80200.0),
    ("Kiệt+Tâm", 63, "KDCC", 21, 1, 0, 0, 0, 5150, 286000.0),
    ("Kiệt+Tâm", 64, "KDCC", 21, 0, 1, 0, 0, 5040, 201600.0),
    ("Kiệt+Tâm", 65, "KDCC", 21, 0, 0, 1, 0, 20890, 1303400.0),
    ("Kiệt+Tâm", 66, "KDCC", 21, 1, 0, 0, 0, 6150, 326000.0),
    ("Kiệt+Tâm", 67, "KDCC", 21, 0, 1, 0, 0, 10680, 427200.0),
    ("Kiệt+Tâm", 68, "KDCC", 21, 0, 0, 0, 0, 4160, 216400.0),
    ("Kiệt+Tâm", 69, "KDCC", 21, 0, 1, 0, 0, 1250, 50000.0),
    ("Kiệt+Tâm", 70, "BCTC", 21, 0, 0, 1, 0, 4990, 499100.0),
    ("Kiệt+Tâm", 71, "BCTC", 21, 0, 0, 0, 0, 12340, 913800.0),
    ("Kiệt+Tâm", 72, "KDCC", 21, 0, 0, 0, 0, 2000, 130000.0),
    ("Kiệt+Tâm", 73, "KDCC", 21, 0, 1, 0, 0, 960, 38400.0),
    ("Kiệt+Tâm", 74, "KDCC", 21, 0, 1, 0, 0, 1200, 48000.0),
    ("Kiệt+Tâm", 75, "KDCC", 21, 0, 0, 0, 0, 4500, 230000.0),
    ("Kiệt+Tâm", 76, "KDCC", 21, 0, 1, 0, 0, 10260, 410400.0),
    ("Kiệt+Tâm", 77, "KDCC", 21, 0, 1, 0, 0, 1360, 54400.0),
    ("Kiệt+Tâm", 78, "KDCC", 21, 0, 0, 0, 0, 5200, 258000.0),
    ("Kiệt+Tâm", 79, "BCTC", 21, 0, 0, 0, 0, 1750, 172500.0),
    ("Kiệt+Tâm", 80, "KDCC", 21, 0, 0, 0, 0, 7200, 338000.0),
    ("Kiệt+Tâm", 81, "KDCC", 21, 0, 0, 1, 0, 770, 96200.0),
    ("Kiệt+Tâm", 82, "BCTC", 21, 0, 0, 0, 0, 2090, 196300.0),
    ("Kiệt+Tâm", 83, "BCTC", 21, 0, 0, 0, 0, 4290, 350300.0),
    ("Kiệt+Tâm", 84, "KDCC", 21, 0, 0, 0, 0, 5130, 255200.0),
    ("Kiệt+Tâm", 85, "KDCC", 21, 0, 0, 0, 0, 5180, 257200.0),
    ("Kiệt+Tâm", 86, "BCTC", 21, 0, 0, 1, 0, 1990, 229100.0),
    ("Kiệt+Tâm", 87, "KDCC", 21, 0, 0, 0, 0, 4110, 214400.0),
    ("Kiệt+Tâm", 88, "KDCC", 21, 0, 0, 0, 0, 8720, 398800.0),
    ("Kiệt+Tâm", 89, "KDCC", 21, 0, 1, 0, 0, 8710, 348400.0),
    ("Kiệt+Tâm", 90, "KDCC", 21, 0, 0, 0, 0, 18070, 772800.0),
    ("Kiệt+Tâm", 91, "KDCC", 21, 0, 0, 1, 0, 16900, 1064000.0),
    ("Kiệt+Tâm", 92, "KDCC", 21, 1, 0, 1, 0, 2150, 209000.0),
    ("Kiệt+Tâm", 93, "KDCC", 21, 0, 1, 1, 0, 3250, 195000.0),
    ("Kiệt+Tâm", 94, "KDCC", 21, 0, 0, 0, 0, 3490, 189600.0),
    ("Kiệt+Tâm", 95, "KDCC", 21, 0, 0, 0, 0, 5360, 264400.0),
    ("Kiệt+Tâm", 96, "BCTC", 21, 0, 0, 0, 0, 2570, 229900.0),
    ("Kiệt+Tâm", 97, "KDCC", 21, 0, 0, 0, 0, 6850, 324000.0),
    ("Kiệt+Tâm", 98, "KDCC", 21, 0, 0, 7, 0, 1570, 112800.0),
    ("Kiệt+Tâm", 99, "BCTC", 21, 0, 0, 0, 0, 2500, 225000.0),
    ("Kiệt+Tâm", 100, "BCTC", 21, 0, 1, 0, 0, 1530, 107100.0),
    ("Kiệt+Tâm", 101, "KDCC", 21, 1, 0, 0, 0, 2680, 187200.0),
    ("Kiệt+Tâm", 102, "BCTC", 21, 0, 0, 0, 0, 6630, 514100.0),
    ("Kiệt+Tâm", 103, "KDCC", 21, 0, 0, 0, 0, 2320, 142800.0),
    ("Kiệt+Tâm", 104, "KDCC", 21, 1, 0, 1, 0, 15750, 1025000.0),
    ("Kiệt+Tâm", 105, "KDCC", 21, 0, 0, 0, 0, 11140, 495600.0),
    ("Kiệt+Tâm", 106, "KDCC", 21, 0, 1, 0, 0, 17230, 689200.0),
    ("Kiệt+Tâm", 107, "KDCC", 21, 0, 1, 0, 0, 7550, 302000.0),
    ("Kiệt+Tâm", 108, "KDCC", 21, 0, 1, 0, 0, 5100, 204000.0),
    ("Kiệt+Tâm", 109, "KDCC", 21, 0, 0, 1, 0, 3110, 174400.0),
    ("Kiệt+Tâm", 110, "KDCC", 21, 0, 1, 1, 0, 3110, 124400.0),
    ("Kiệt+Tâm", 111, "KDCC", 21, 0, 1, 1, 0, 3100, 124000.0),
    ("Kiệt+Tâm", 112, "KDCC", 21, 0, 0, 0, 0, 5250, 260000.0),
    ("Long", 17, "BCTC", 22, 1, 1, 0, 0, 3185, 222950.0),
    ("Long", 18, "BCTC", 22, 1, 1, 0, 0, 5115, 358050.0),
    ("Long", 19, "BCTC", 22, 1, 1, 0, 0, 4900, 343000.0),
    ("Long", 20, "BCTC", 22, 0, 1, 0, 0, 2590, 181300.0),
    ("Long", 21, "BCTC", 22, 0, 0, 0, 0, 75, 55250.0),
    ("Long", 22, "BCTC", 22, 0, 1, 0, 0, 805, 56350.0),
    ("Long", 23, "BCTC", 22, 0, 0, 0, 0, 4100, 337000.0),
    ("Long", 24, "BCTC", 22, 1, 0, 0, 0, 2060, 224200.0),
    ("Long", 25, "KDCC", 22, 0, 0, 0, 0, 930, 87200.0),
    ("Long", 26, "GID", 22, 0, 0, 0, 0, 5580, 27900.0),
    ("Long", 27, "BCTC", 22, 0, 0, 0, 0, 4320, 352400.0),
    ("Long", 28, "BCTC", 22, 0, 0, 1, 0, 3050, 324500.0),
    ("Long", 29, "BCTC", 22, 0, 0, 1, 0, 3040, 323600.0),
    ("Long", 30, "BCTC", 22, 0, 0, 0, 0, 1120, 128400.0),
    ("Long", 31, "BCTC", 22, 0, 0, 7, 0, 5020, 652400.0),
    ("Long", 32, "BCTC", 22, 0, 0, 7, 0, 7405, 938600.0),
    ("Long", 33, "BCTC", 22, 0, 0, 0, 0, 3130, 269100.0),
    ("Long", 34, "BCTC", 22, 0, 0, 1, 0, 9040, 863600.0),
    ("Long", 35, "BCTC", 22, 0, 0, 0, 0, 5450, 431500.0),
    ("Long", 36, "BCTC", 22, 0, 0, 0, 0, 5000, 400000.0),
    ("Long", 37, "BCTC", 22, 0, 1, 0, 0, 5090, 356300.0),
    ("Long", 38, "BCTC", 22, 0, 1, 0, 0, 4620, 323400.0),
    ("Long", 39, "BCTC", 22, 0, 0, 7, 0, 3995, 529400.0),
    ("Long", 40, "BCTC", 22, 0, 0, 7, 0, 1705, 254600.0),
    ("Long", 41, "KDCC", 22, 1, 0, 1, 0, 25000, 1580000.0),
    ("Long", 42, "KDCC", 22, 1, 1, 1, 0, 20000, 1200000.0),
    ("Long", 43, "KDCC", 22, 1, 1, 1, 0, 20000, 1200000.0),
    ("Long", 44, "KDCC", 22, 1, 1, 1, 0, 14650, 879000.0),
    ("Long", 45, "BCT5LC", 22, 0, 0, 7, 0, 2290, 393500.0),
    ("Long", 46, "BCT5LC", 22, 0, 1, 7, 0, 945, 141750.0),
    ("Long", 47, "BCT5LC", 22, 0, 0, 7, 0, 4965, 794750.0),
    ("Long", 48, "BCT5LC", 22, 0, 0, 7, 0, 1915, 337250.0),
    ("Long", 49, "BCTC", 22, 0, 0, 7, 0, 2220, 316400.0),
    ("Long", 50, "BCT5LC", 22, 1, 0, 0, 0, 1030, 183000.0),
    ("Long", 51, "BCTC", 22, 0, 0, 0, 0, 2380, 216600.0),
    ("Long", 52, "BCTC", 22, 0, 1, 0, 0, 3570, 249900.0),
    ("Long", 53, "BCTC", 22, 0, 0, 0, 0, 10410, 778700.0),
    ("Long", 54, "BCTC", 22, 0, 0, 0, 0, 5055, 403850.0),
    ("Long", 55, "BCTC", 22, 0, 1, 0, 0, 1209, 84630.0),
    ("Long", 56, "BCTC", 22, 0, 1, 0, 0, 2085, 145950.0),
    ("Long", 57, "BCTC", 22, 0, 0, 1, 0, 5425, 538250.0),
    ("Long", 58, "BCTC", 22, 0, 0, 0, 0, 2500, 225000.0),
    ("Long", 59, "BCTC", 22, 0, 1, 0, 0, 2275, 159250.0),
    ("Long", 60, "BCTC", 22, 0, 1, 0, 0, 2560, 179200.0),
    ("Long", 61, "BCTC", 22, 0, 1, 0, 0, 2750, 192500.0),
    ("Long", 62, "BCTC", 22, 0, 0, 1, 0, 3000, 260000.0),
    ("Linh", 17, "KDCC", 23, 0, 1, 0, 0, 12750, 510000.0),
    ("Linh", 18, "KDCC", 23, 0, 0, 0, 0, 1484, 109360.0),
    ("Linh", 19, "EKC", 23, 0, 0, 0, 0, 4495, 409600.0),
    ("Linh", 20, "EKC", 23, 0, 0, 0, 0, 1611, 178880.0),
    ("Linh", 21, "EKC", 23, 0, 1, 0, 0, 4790, 383200.0),
    ("Linh", 22, "EKC", 23, 0, 0, 0, 0, 4466, 407280.0),
    ("Linh", 23, "EKC", 23, 0, 0, 0, 0, 16571, 1375680.0),
    ("Linh", 24, "EKC", 23, 0, 0, 0, 0, 87, 56960.0),
    ("Linh", 25, "EKC", 23, 0, 0, 0, 0, 16234, 1348720.0),
    ("Linh", 26, "EKC", 23, 0, 1, 0, 0, 5200, 416000.0),
    ("Linh", 27, "EKC", 23, 0, 1, 0, 0, 11200, 896000.0),
    ("Linh", 28, "EKC", 23, 0, 1, 0, 0, 16423, 1313840.0),
    ("Linh", 29, "KDCC", 23, 0, 0, 0, 0, 8159, 376360.0),
    ("Linh", 30, "KDCC", 23, 0, 0, 0, 0, 2678, 157120.0),
    ("Linh", 31, "KDCC", 23, 1, 0, 0, 0, 2600, 184000.0),
    ("Linh", 32, "KDCC", 23, 0, 0, 0, 0, 3100, 174000.0),
    ("Linh", 33, "KDCC", 23, 0, 0, 0, 0, 5129, 255160.0),
    ("Linh", 34, "BCTC", 23, 0, 0, 0, 0, 5044, 403080.0),
    ("Linh", 35, "KDCC", 23, 0, 0, 0, 0, 1403, 106120.0),
    ("Linh", 36, "BCTC", 23, 0, 0, 0, 0, 5051, 403570.0),
    ("Linh", 37, "BCTC", 23, 0, 0, 0, 0, 5060, 404200.0),
    ("Linh", 38, "BCTC", 23, 0, 0, 0, 0, 3300, 281000.0),
    ("Linh", 39, "EKC", 23, 0, 0, 0, 0, 5782, 512560.0),
    ("Linh", 40, "BCTC", 23, 0, 0, 0, 0, 1700, 169000.0),
    ("Linh", 41, "EKC", 23, 0, 0, 0, 0, 5343, 477440.0),
    ("Linh", 42, "EKC", 23, 0, 1, 0, 0, 3805, 304400.0),
    ("Linh", 43, "EKC", 23, 0, 1, 0, 0, 1920, 153600.0),
    ("Linh", 44, "EKC", 23, 0, 0, 0, 0, 3600, 338000.0),
    ("Linh", 45, "KDCC", 23, 0, 0, 0, 0, 5239, 259560.0),
    ("Linh", 46, "EKC", 23, 0, 0, 0, 0, 1260, 150800.0),
    ("Linh", 47, "EKC", 23, 0, 1, 0, 0, 6573, 525840.0),
    ("Linh", 48, "EKC", 23, 0, 0, 0, 0, 10043, 853440.0),
    ("Linh", 49, "EKC", 23, 0, 1, 0, 0, 1204, 96320.0),
    ("Linh", 50, "KDCC", 23, 0, 0, 0, 0, 3052, 172080.0),
    ("Linh", 51, "KDCC", 23, 0, 0, 0, 0, 1834, 123360.0),
    ("Linh", 52, "KDCC", 23, 0, 0, 0, 0, 1745, 119800.0),
    ("Linh", 53, "BCTC", 23, 0, 0, 0, 0, 1400, 148000.0),
    ("Linh", 54, "KDCC", 23, 0, 0, 0, 0, 1696, 117840.0),
    ("Linh", 55, "BCTC", 23, 0, 0, 0, 0, 2375, 216250.0),
    ("Linh", 56, "KDCC", 23, 0, 0, 0, 0, 2799, 161960.0),
    ("Linh", 57, "KDCC", 23, 0, 0, 0, 0, 1585, 113400.0),
    ("Linh", 58, "KDCC", 23, 0, 0, 0, 0, 10000, 450000.0),
    ("Linh", 59, "KDCC", 23, 0, 0, 0, 0, 6224, 298960.0),
    ("Linh", 60, "KDCC", 23, 0, 0, 0, 0, 10200, 458000.0),
    ("Linh", 61, "KDCC", 23, 1, 0, 0, 0, 3741, 229640.0),
    ("Linh", 62, "BCTC", 23, 0, 0, 0, 0, 6517, 506190.0),
    ("Linh", 63, "BCTC", 23, 0, 0, 0, 0, 10, 50700.0),
    ("Linh", 64, "BCTC", 23, 0, 0, 0, 0, 2106, 197420.0),
    ("Linh", 65, "BCTC", 23, 0, 0, 0, 0, 1552, 158640.0),
    ("Linh", 66, "BCTC", 23, 0, 1, 0, 0, 706, 49420.0),
    ("Linh", 67, "KDCC", 23, 1, 1, 0, 0, 2343, 93720.0),
    ("Linh", 68, "KDCC", 23, 1, 0, 0, 0, 2216, 168640.0),
    ("Linh", 69, "KDCC", 23, 1, 0, 0, 0, 9895, 475800.0),
    ("Linh", 70, "KDCC", 23, 1, 0, 0, 0, 5000, 280000.0),
    ("Linh", 71, "KDCC", 23, 0, 1, 0, 0, 21256, 850240.0),
    ("Linh", 72, "KDCC", 23, 0, 0, 0, 0, 2598, 153920.0),
    ("Linh", 73, "KDCC", 23, 0, 0, 0, 0, 1000, 90000.0),
    ("Linh", 74, "KDCC", 23, 0, 0, 0, 0, 2048, 131920.0),
    ("Linh", 75, "KDCC", 23, 0, 0, 0, 0, 1072, 92880.0),
    ("Linh", 76, "KDCC", 23, 0, 1, 0, 0, 1830, 73200.0),
    ("Linh", 77, "KDCC", 23, 0, 1, 0, 0, 1000, 40000.0),
    ("Cường", 19, "BCTC", 24, 0, 0, 0, 0, 1530, 213000.0),
    ("Cường", 20, "BCTC", 24, 0, 0, 0, 0, 3230, 383000.0),
    ("Cường", 21, "KN2C", 24, 0, 0, 0, 210, 0, 50000.0),
    ("Cường", 22, "BCTC", 24, 0, 0, 0, 0, 3540, 414000.0),
    ("Cường", 23, "KN2C", 24, 0, 0, 0, 210, 3430, 255800.0),
    ("Cường", 24, "BCTC", 24, 0, 0, 0, 0, 2350, 295000.0),
    ("Cường", 25, "BCTC", 24, 0, 0, 0, 0, 1555, 215500.0),
    ("Cường", 26, "BCTC", 24, 0, 0, 0, 0, 4295, 489500.0),
    ("Cường", 27, "KDCC", 24, 0, 0, 0, 0, 5540, 382400.0),
    ("Cường", 28, "KN2C", 24, 1, 0, 0, 210, 700, 122000.0),
    ("Cường", 29, "BCTC", 24, 1, 0, 0, 0, 1060, 186000.0),
    ("Cường", 30, "BCTC", 24, 0, 1, 0, 0, 510, 51000.0),
    ("Cường", 31, "BCT5LC", 24, 0, 0, 0, 0, 1110, 226500.0),
    ("Cường", 32, "BCTC", 24, 0, 0, 0, 0, 97, 69700.0),
    ("Cường", 33, "BCTC", 24, 1, 0, 0, 0, 1035, 183500.0),
    ("Cường", 34, "KN2C", 24, 1, 0, 0, 210, 50, 83000.0),
    ("Cường", 35, "BCTC", 24, 0, 0, 0, 0, 1545, 214500.0),
    ("Cường", 36, "BCTC", 24, 0, 0, 0, 0, 2135, 273500.0),
    ("Cường", 37, "BCTC", 24, 0, 0, 0, 0, 2120, 272000.0),
    ("Cường", 38, "BCT5LC", 24, 0, 0, 0, 0, 1020, 213000.0),
    ("Cường", 39, "BCTC", 24, 0, 0, 0, 0, 220, 82000.0),
    ("Cường", 40, "BCT5LC", 24, 1, 0, 0, 0, 2075, 391250.0),
    ("Cường", 41, "BCTC", 24, 0, 0, 0, 0, 2370, 297000.0),
    ("Cường", 42, "BCTC", 24, 1, 0, 0, 0, 150, 95000.0),
    ("Cường", 43, "KN2C", 24, 0, 0, 0, 210, 1200, 122000.0),
    ("Cường", 44, "BCTC", 24, 0, 0, 0, 0, 815, 141500.0),
    ("Cường", 45, "BCTC", 24, 0, 0, 0, 0, 1100, 170000.0),
    ("Cường", 46, "BCTC", 24, 0, 0, 0, 0, 2400, 300000.0),
    ("Cường", 47, "BCTC", 24, 0, 0, 0, 0, 2540, 314000.0),
    ("Cường", 48, "KDCC", 24, 1, 0, 0, 0, 10600, 716000.0),
    ("Cường", 49, "BCTC", 24, 0, 0, 0, 0, 4035, 463500.0),
    ("Cường", 50, "KDCC", 24, 0, 0, 0, 0, 5400, 374000.0),
    ("Cường", 51, "BCTC", 24, 0, 0, 0, 0, 910, 151000.0),
    ("Cường", 52, "BCTC", 24, 0, 0, 0, 0, 2580, 318000.0),
    ("Cường", 53, "KN2C", 24, 1, 0, 0, 210, 100, 86000.0),
    ("Cường", 54, "BCTC", 24, 0, 0, 0, 0, 4640, 524000.0),
    ("Cường", 55, "KN2C", 24, 0, 0, 0, 210, 50, 53000.0),
    ("Cường", 56, "KN2C", 24, 1, 0, 0, 210, 100, 86000.0),
    ("Cường", 57, "KDCC", 24, 1, 0, 0, 0, 0, 80000.0),
    ("Cường", 58, "BCTC", 24, 0, 0, 0, 0, 1840, 244000.0),
    ("Cường", 59, "BCTC", 24, 0, 1, 0, 0, 3190, 319000.0),
    ("Cường", 60, "BCT5LC", 24, 0, 0, 0, 0, 920, 198000.0),
    ("Cường", 61, "BCTC", 24, 1, 0, 0, 0, 1100, 190000.0),
    ("Cường", 62, "KN2C", 24, 0, 0, 0, 210, 1150, 119000.0),
    ("Cường", 63, "BCTC", 24, 0, 0, 0, 0, 1100, 170000.0),
    ("Cường", 64, "KN2C", 24, 0, 0, 0, 210, 2780, 216800.0),
    ("Cường", 65, "KN2C", 24, 0, 0, 0, 200, 0, 50000.0),
    ("Cường", 66, "BCTC", 24, 0, 0, 0, 0, 1050, 165000.0),
    ("Cường", 67, "KN2C", 24, 1, 0, 0, 210, 1350, 161000.0),
    ("Cường", 68, "KN2C", 24, 0, 0, 0, 210, 1050, 113000.0),
    ("Cường", 69, "BCTC", 24, 0, 0, 0, 0, 2030, 263000.0),
    ("Cường", 70, "BCT5LC", 24, 0, 0, 0, 0, 1175, 236250.0),
    ("Cường", 71, "KN2C", 24, 1, 0, 0, 210, 150, 89000.0),
    ("Cường", 72, "KDCC", 24, 1, 0, 0, 0, 50, 83000.0),
    ("Cường", 73, "KN2C", 24, 0, 0, 0, 200, 650, 76000.0),
    ("Cường", 74, "KN2C", 24, 0, 0, 0, 200, 420, 66800.0),
    ("Cường", 75, "BCTC", 24, 0, 0, 0, 0, 810, 141000.0),
    ("Cường", 76, "KN2C", 24, 0, 0, 0, 210, 0, 50000.0),
    ("Cường", 77, "KN2C", 24, 1, 0, 0, 210, 10, 80600.0),
    ("Cường", 78, "BCT5LC", 24, 1, 0, 0, 0, 1000, 230000.0),
    ("Cường", 79, "BCT5LC", 24, 0, 1, 0, 0, 3340, 501000.0),
    ("Cường", 80, "KN2C", 24, 0, 0, 0, 200, 3000, 170000.0),
    ("Cường", 81, "BCTC", 24, 0, 0, 0, 0, 205, 80500.0),
    ("Cường", 82, "BCTC", 24, 0, 0, 0, 0, 7, 60700.0),
    ("Cường", 83, "KDCC", 24, 1, 0, 0, 0, 2800, 248000.0),
    ("Cường", 84, "KN2C", 24, 0, 0, 0, 210, 1000, 110000.0),
    ("Cường", 85, "BCTC", 24, 0, 0, 0, 0, 2570, 317000.0),
    ("Cường", 86, "BCTC", 24, 0, 0, 0, 0, 2160, 276000.0),
    ("Hòa", 19, "BCTC", 25, 0, 0, 0, 0, 3270, 387000.0),
    ("Hòa", 20, "KN2C", 25, 0, 0, 0, 210, 5100, 356000.0),
    ("Hòa", 21, "KN2C", 25, 0, 0, 0, 210, 1550, 143000.0),
    ("Hòa", 22, "KN2C", 25, 0, 1, 0, 210, 1150, 69000.0),
    ("Hòa", 23, "BCTC", 25, 0, 0, 0, 0, 117, 71700.0),
    ("Hòa", 24, "BCTC", 25, 0, 1, 0, 0, 145, 14500.0),
    ("Hòa", 25, "BCTC", 25, 0, 0, 0, 0, 130, 73000.0),
    ("Hòa", 26, "BCTC", 25, 1, 0, 0, 0, 43, 84300.0),
    ("Hòa", 27, "BCTC", 25, 0, 1, 0, 0, 1649, 164900.0),
    ("Hòa", 28, "KN2C", 25, 0, 0, 0, 210, 2600, 206000.0),
    ("Hòa", 29, "KN2C", 25, 0, 0, 0, 210, 323, 69380.0),
    ("Hòa", 30, "KN2C", 25, 0, 1, 0, 210, 1500, 90000.0),
    ("Hòa", 31, "KN2C", 25, 0, 0, 0, 210, 2260, 185600.0),
    ("Hòa", 32, "KN2C", 25, 0, 1, 0, 210, 1210, 72600.0),
    ("Hòa", 33, "KN2C", 25, 0, 0, 0, 210, 880, 102800.0),
    ("Hòa", 34, "BCTC", 25, 0, 0, 0, 0, 1440, 204000.0),
    ("Hòa", 35, "BCTC", 25, 0, 0, 0, 0, 4298, 489800.0),
    ("Hòa", 36, "KN2C", 25, 1, 0, 0, 200, 2600, 184000.0),
    ("Hòa", 37, "KN2C", 25, 1, 0, 0, 210, 337, 100220.0),
    ("Hòa", 38, "BCTC", 25, 1, 0, 0, 0, 2044, 284400.0),
    ("Hòa", 39, "BCTC", 25, 0, 1, 0, 0, 2072, 207200.0),
    ("Hòa", 40, "BCTC", 25, 1, 0, 0, 0, 1060, 186000.0),
    ("Hòa", 41, "BCTC", 25, 0, 1, 0, 0, 586, 58600.0),
    ("Hòa", 42, "BCTC", 25, 0, 0, 0, 0, 1100, 170000.0),
    ("Hòa", 43, "KN2C", 25, 1, 0, 0, 210, 70, 84200.0),
    ("Hòa", 44, "BCT5LC", 25, 1, 0, 0, 0, 2067, 390050.0),
    ("Hòa", 45, "BCT5LC", 25, 0, 1, 0, 0, 2075, 311250.0),
    ("Hòa", 46, "KN2C", 25, 0, 0, 0, 210, 500, 80000.0),
    ("Hòa", 47, "BCTC", 25, 0, 0, 0, 0, 1100, 170000.0),
    ("Hòa", 48, "BCTC", 25, 0, 0, 0, 0, 74, 67400.0),
    ("Hòa", 49, "BCTC", 25, 0, 1, 0, 0, 72, 7200.0),
    ("Hòa", 51, "BCT5LC", 25, 1, 0, 0, 0, 2044, 386600.0),
    ("Hòa", 52, "KN2C", 25, 0, 0, 0, 210, 5541, 382460.0),
    ("Hòa", 53, "KN2C", 25, 1, 0, 0, 200, 1268, 130720.0),
    ("Hòa", 54, "KN2C", 25, 0, 0, 0, 210, 700, 92000.0),
    ("Hòa", 55, "KN2C", 25, 0, 0, 0, 210, 4640, 328400.0),
    ("Hòa", 56, "BCTC", 25, 0, 0, 0, 0, 665, 126500.0),
    ("Hòa", 57, "BCTC", 25, 0, 0, 0, 0, 579, 117900.0),
    ("Hòa", 58, "BCTC", 25, 1, 0, 0, 0, 1060, 186000.0),
    ("Hòa", 59, "BCTC", 25, 0, 0, 0, 0, 947, 154700.0),
    ("Hòa", 60, "BNC", 25, 0, 0, 0, 0, 2630, 260400.0),
    ("Hòa", 61, "KN2C", 25, 0, 0, 0, 210, 2627, 207620.0),
    ("Hòa", 62, "KN2C", 25, 1, 0, 0, 200, 1600, 144000.0),
    ("Hòa", 63, "BCTC", 25, 0, 0, 0, 0, 2720, 332000.0),
    ("Hòa", 64, "BCTC", 25, 0, 1, 0, 0, 2720, 272000.0),
    ("Hòa", 65, "KN2C", 25, 0, 0, 0, 210, 6990, 469400.0),
    ("Hòa", 66, "BCTC", 25, 0, 0, 0, 0, 750, 135000.0),
    ("Hòa", 67, "BCTC", 25, 0, 1, 0, 0, 750, 75000.0),
    ("Hòa", 68, "BCTC", 25, 0, 0, 0, 0, 770, 137000.0),
    ("Hòa", 69, "BCTC", 25, 0, 0, 0, 0, 6530, 713000.0),
    ("Hòa", 70, "BCTC", 25, 1, 0, 0, 0, 15, 81500.0),
    ("Hòa", 71, "BCTC", 25, 1, 0, 0, 0, 15, 81500.0),
    ("Hòa", 72, "BCTC", 25, 0, 0, 0, 0, 105, 70500.0),
    ("Hòa", 73, "BCTC", 25, 0, 0, 0, 0, 125, 72500.0),
    ("Hòa", 74, "BCTC", 25, 0, 1, 0, 0, 350, 35000.0),
    ("Hòa", 75, "BCTC", 25, 0, 0, 0, 0, 700, 130000.0),
    ("Hòa", 76, "BCTC", 25, 0, 0, 0, 0, 25, 62500.0),
    ("Hòa", 77, "BCT5LC", 25, 1, 0, 0, 0, 200, 110000.0),
    ("Hòa", 78, "BCT5LC", 25, 0, 0, 0, 0, 3060, 519000.0),
    ("Hòa", 79, "BCT5LC", 25, 0, 1, 0, 0, 3100, 465000.0),
    ("Hòa", 80, "BCTC", 25, 0, 0, 0, 0, 905, 150500.0),
    ("Hòa", 81, "BCTC", 25, 0, 0, 0, 0, 53, 65300.0),
    ("Hòa", 82, "KN2C", 25, 1, 0, 0, 210, 6020, 441200.0),
    ("Hòa", 83, "BCT5LC", 25, 1, 0, 0, 0, 2018, 382700.0),
    ("Bằng", 19, "KN2C", 26, 0, 0, 0, 210, 1150, 119000.0),
    ("Bằng", 20, "KN2C", 26, 0, 0, 0, 210, 1252, 125120.0),
    ("Bằng", 21, "BCTC", 26, 0, 0, 0, 0, 50, 65000.0),
    ("Bằng", 22, "KN2C", 26, 1, 0, 0, 210, 4300, 338000.0),
    ("Bằng", 23, "BCTC", 26, 0, 0, 0, 0, 5037, 563700.0),
    ("Bằng", 24, "KN2C", 26, 0, 0, 0, 210, 650, 89000.0),
    ("Bằng", 25, "KN2C", 26, 0, 0, 0, 210, 3619, 267140.0),
    ("Bằng", 26, "BCT5LC", 26, 0, 0, 0, 0, 1060, 219000.0),
    ("Bằng", 27, "BCTC", 26, 0, 0, 0, 0, 1095, 169500.0),
    ("Bằng", 28, "KN2C", 26, 0, 0, 0, 210, 4100, 296000.0),
    ("Bằng", 29, "BCTC", 26, 1, 0, 0, 0, 622, 142200.0),
    ("Bằng", 30, "KN2C", 26, 1, 0, 0, 210, 60, 83600.0),
    ("Bằng", 31, "BCTC", 26, 0, 0, 0, 0, 1120, 172000.0),
    ("Bằng", 32, "KN2C", 26, 1, 0, 0, 210, 50, 83000.0),
    ("Bằng", 33, "BCTC", 26, 0, 0, 0, 0, 1680, 228000.0),
    ("Bằng", 34, "BCTC", 26, 0, 1, 0, 0, 690, 69000.0),
    ("Bằng", 35, "BCTC", 26, 0, 1, 0, 0, 3030, 303000.0),
    ("Bằng", 36, "BCTC", 26, 1, 1, 0, 0, 875, 87500.0),
    ("Bằng", 37, "BCTC", 26, 0, 1, 0, 0, 2310, 231000.0),
    ("Bằng", 38, "BCTC", 26, 0, 0, 0, 0, 670, 127000.0),
    ("Bằng", 39, "BCTC", 26, 0, 0, 0, 0, 1675, 227500.0),
    ("Bằng", 40, "BCT5LC", 26, 0, 0, 0, 0, 370, 115500.0),
    ("Bằng", 41, "KN2C", 26, 1, 0, 0, 210, 860, 131600.0),
    ("Bằng", 42, "KN2C", 26, 0, 0, 0, 210, 443, 76580.0),
    ("Bằng", 43, "BCTC", 26, 0, 0, 0, 0, 1186, 178600.0),
    ("Bằng", 44, "BCT5LC", 26, 1, 0, 0, 0, 50, 87500.0),
    ("Bằng", 45, "BCT5LC", 26, 0, 0, 0, 0, 5060, 819000.0),
    ("Bằng", 46, "BCT5LC", 26, 0, 0, 0, 0, 50, 67500.0),
    ("Bằng", 47, "BCTC", 26, 0, 0, 0, 0, 4950, 555000.0),
    ("Bằng", 48, "BCTC", 26, 0, 0, 0, 0, 1600, 220000.0),
    ("Bằng", 49, "BCTC", 26, 0, 0, 0, 0, 45, 64500.0),
    ("Bằng", 50, "BCTC", 26, 0, 0, 0, 0, 60, 66000.0),
    ("Bằng", 51, "BCT5LC", 26, 0, 0, 0, 0, 70, 70500.0),
    ("Bằng", 52, "BCTC", 26, 0, 0, 0, 0, 2110, 271000.0),
    ("Bằng", 53, "BCTC", 26, 0, 0, 0, 0, 1960, 256000.0),
    ("Bằng", 54, "BCT5LC", 26, 1, 0, 0, 0, 5075, 841250.0),
    ("Bằng", 55, "BCT5LC", 26, 1, 0, 0, 0, 1400, 290000.0),
    ("Bằng", 56, "BCT5LC", 26, 0, 0, 0, 0, 3040, 516000.0),
    ("Bằng", 57, "BCT5LC", 26, 1, 0, 0, 0, 3475, 601250.0),
    ("Bằng", 58, "BCTC", 26, 1, 0, 0, 0, 2300, 310000.0),
    ("Bằng", 59, "BCTC", 26, 0, 0, 0, 0, 725, 132500.0),
    ("Bằng", 60, "BCTC", 26, 0, 0, 0, 0, 1055, 165500.0),
    ("Bằng", 61, "BCTC", 26, 0, 0, 0, 0, 1060, 166000.0),
    ("Bằng", 62, "BCTC", 26, 0, 0, 0, 0, 1102, 170200.0),
    ("Bằng", 63, "KN2C", 26, 0, 0, 0, 210, 2600, 206000.0),
    ("Bằng", 64, "BCTC", 26, 1, 0, 0, 0, 1300, 210000.0),
    ("Bằng", 65, "KN2C", 26, 0, 0, 0, 210, 1400, 134000.0),
    ("Bằng", 66, "BCTC", 26, 0, 0, 0, 0, 43, 64300.0),
    ("Bằng", 67, "BCTC", 26, 0, 0, 0, 0, 160, 76000.0),
]
TONG_SO = {'Kiệt+Tâm': 32804600.0, 'Long': 18500480.0, 'Linh': 20013070.0, 'Cường': 14381800.0, 'Hòa': 12402000.0, 'Bằng': 10867540.0}     # ô TỔNG CỘNG từng sheet
QUEN_DUC_LO = {("Kiệt+Tâm", 98), ("Kiệt+Tâm", 109), ("Kiệt+Tâm", 110), ("Kiệt+Tâm", 111), ("Long", 62)}


def _phu_thu_quen(sheet, dong, so_lo, sl) -> float:
    if (sheet, dong) not in QUEN_DUC_LO:
        return 0.0
    return sl * (50 if so_lo >= 7 else 20)


@pytest.mark.parametrize(("sheet", "dong", "ma", "to", "moi", "trung", "so_lo", "gsm", "sl", "so"), DONG,
                         ids=[f"{x[0]} dòng {x[1]} {x[2]}" for x in DONG])
def test_tung_dong_so_khop(sheet, dong, ma, to, moi, trung, so_lo, gsm, sl, so):
    mong = so + _phu_thu_quen(sheet, dong, so_lo, sl)
    assert _may_tinh(ma, to, sl, moi=moi, trung=trung, so_lo=so_lo, gsm=gsm) == pytest.approx(mong, abs=0.5)


def test_tong_tung_kip_khop_o_tong_cong():
    for sheet, tong_so in TONG_SO.items():
        tong = sum(_may_tinh(ma, to, sl, moi=moi, trung=trung, so_lo=so_lo, gsm=gsm)
                   for sh, _d, ma, to, moi, trung, so_lo, gsm, sl, _s in DONG if sh == sheet)
        quen = sum(_phu_thu_quen(sh, d, so_lo, sl) for sh, d, _m, _t, _mo, _tr, so_lo, _g, sl, _s in DONG if sh == sheet)
        assert tong == pytest.approx(tong_so + quen, abs=1), sheet
    assert sum(_phu_thu_quen(sh, d, so_lo, sl) for sh, d, _m, _t, _mo, _tr, so_lo, _g, sl, _s in DONG) == 324_900


def test_ban_to_ghi_theo_con_chia_ra_to():
    # Lệnh 4 con/tờ: thợ ghi 4.000 con = 1.000 tờ ⇒ như sổ ghi 1.000 tờ (Cường bế carton cũ).
    assert _may_tinh("BCTC", 24, 4_000, so_con=4) == pytest.approx(60_000 + 1_000 * 100)


def test_kem_be_noi_theo_thong_bao_to_be():
    # Thông báo đầu sheet kíp tự động: bế + bế nổi = giá bế + 20đ, lên khuôn bế nổi bằng lên khuôn bế.
    # T08 không dòng nào — kiểm luật: kíp Kiệt bế carton cũ 1.000 tờ.
    assert _may_tinh("BCTC", 21, 1_000, kem_be_noi=1) == pytest.approx(2 * 50_000 + 1_000 * (70 + 20))


@pytest.mark.parametrize(("gsm", "to_rot"), [(0, 40), (150, 40), (200, 40), (210, 60), (230, 60), (300, 60)])
def test_giay_nhan_gia_theo_dinh_luong(gsm, to_rot):
    # Một công đoạn giấy nhãn: 200g trở xuống 40, trên 200g 60. Lệnh chưa chọn giấy (0) ăn giá thấp.
    assert _may_tinh("KN2C", 24, 1_000, gsm=gsm) == pytest.approx(50_000 + 1_000 * to_rot)
