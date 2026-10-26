"""Bao quát khoán In — máy tính lương đối chiếu với sổ khoán 5 máy in T08/2026 (2M, 4M, 5M, 6M, 7M).

Hai nửa độc lập:

- `_so_tinh` = ĐÁP ÁN viết thẳng từ bảng sổ: loại bài A/B/C/D/F/G/H theo máy, ghi chú UV ×2, cán
  metaline ×3, xuống bài lỗi máy, thay kẽm. Không đọc bậc hay ô giá của danh mục.
- `_may_tinh` = đúng đường lương: `chuan_hoa_khi_ghi` (chọn bậc + chụp giá tổ) → `chip_lenh` →
  `_tien_chinh` → cộng việc phát sinh.

Ma trận quét mọi tổ × bộ mực × quy cách in (1 mặt, tự trở, trở nhíp, AB từng mặt, bài ghép, ảnh chụp
cũ) × tuỳ chọn × số tờ quanh mốc 3.000. Cấu hình `BAC` / `GIA` / `CT` chép từ IN-12 trên DB dev
22/10/2026; DB đổi thì chép lại.

3 màu có pha ăn giá bài C: bảng giá 4M/5M/6M/7M ghi C là "bài in TRONG 4 màu có màu pha" (≤ 4 kẽm, có pha);
sổ T08 không có dòng nào ghi quy cách mực để đối chiếu thẳng (kiểm 23/10/2026).
Vecni KHÔNG xét: chủ chốt 22/10 phần vecni trong sổ coi là sai, tạm gác.

Sổ 7M dòng 393A / 393C (bài ghép nối tiếp: bỏ giá bài, không trừ 3.000) chủ chốt 22/10 là GHI SAI —
mọi lần ghi ăn đủ giá bài, thay kẽm cộng riêng.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.db import SessionLocal
from app.models.cong_doan import CongDoanKhoan, CongDoanKhoanPhatSinh
from app.models.payroll import KhoanChiTieuNgay, KhoanDungMay
from app.models.san_xuat_san_luong import SanXuatBatch, SanXuatBatchNguoi
from app.services.khoan_ky import KhoanKyService
from app.services.san_xuat import viec_khoan
from tests.test_khoan_dot_2_tinh import _muc, _Nen2
from tests.test_khoan_ky import NAM, THANG

CMYK = ["C", "M", "Y", "K"]
M2, M4, M5, M6, M7 = 11, 12, 13, 14, 15

# ------------------------------------------------------------------ cấu hình IN-12 (DB dev)
CT = ("(gia_co_dinh + max(0, sl_ghi * (1 + tu_tro) - 3000) * don_gia_khoan)"
      " * if(metaline > 0, 3, if(muc_uv > 0, if(gia_gom_uv > 0, 1, 2), 1))")
TC = [{"ma": "muc_uv", "ten": "Mực UV", "kieu": "co_khong", "goi_y": None},
      {"ma": "metaline", "ten": "Mực UV cán metaline (tính gấp 3)", "kieu": "co_khong", "goi_y": None}]


def _b(ma, ten, tu, den, pha=None, tick=None):
    return {"ma": ma, "ten": ten, "mau_tu": tu, "mau_den": den, "pha": pha, "tuy_chon_ma": tick,
            "tuy_chon_co": "co" if tick else None, "gom_uv": bool(tick)}


BAC = [
    _b("b9", "1–2 màu Pantone metaline", 1, 2, "co", "metaline"),
    _b("b3", "1–2 màu Pantone UV", 1, 2, "co", "muc_uv"),
    _b("b2", "1–2 màu Pantone", 1, 2, "co"),
    _b("b1", "1–2 màu thường", 1, 2),
    _b("b5", "3–4 màu có pha", 3, 4, "co"),
    _b("b4", "3–4 màu thường", 3, 4),
    _b("b6", "5 màu", 5, 5),
    _b("b7", "6 màu", 6, 6),
    _b("b8", "7 màu", 7, 7),
]
GIA = {
    M2: {"b9": (225_000, 30), "b3": (450_000, 40), "b2": (225_000, 30), "b1": (150_000, 30)},
    M4: {"b1": (250_000, 30), "b4": (300_000, 40), "b5": (350_000, 45), "b6": (550_000, 70),
         "b7": (600_000, 80)},
    M5: {"b1": (144_000, 20), "b4": (180_000, 30), "b5": (210_000, 30), "b6": (240_000, 35)},
    M6: {"b1": (200_000, 20), "b4": (250_000, 27), "b5": (275_000, 29.7), "b6": (375_000, 40),
         "b7": (500_000, 50), "b8": (650_000, 65)},
    M7: {"b1": (200_000, 20), "b4": (250_000, 30), "b5": (275_000, 35), "b6": (375_000, 40),
         "b7": (500_000, 50), "b8": (650_000, 65)},
}
XUONG_BAI_GIA = {M2: 187_500, M4: 150_000, M5: 90_000, M6: 125_000, M7: 125_000}
THAY_KEM, XUONG_BAI = 3, 4


def _khoan() -> CongDoanKhoan:
    k = CongDoanKhoan(id=17, unit="to", unit_price=0, gia_co_dinh=0, cong_thuc_khoan=CT, tuy_chon=TC,
                      bac_gia=BAC,
                      gia_theo_to=[{"department_id": to, "bac": ma, "gia_co_dinh": g, "don_gia": d}
                                   for to, o in GIA.items() for ma, (g, d) in o.items()])
    k.viec_phat_sinh = [
        CongDoanKhoanPhatSinh(id=THAY_KEM, ten="Thay kẽm", don_gia=100_000, don_vi="kem", thu_tu=0),
        CongDoanKhoanPhatSinh(id=XUONG_BAI, ten="Xuống bài do lỗi máy hoặc bộ phận khác", don_gia=0,
                              don_vi="bai", thu_tu=1,
                              gia_theo_to=[{"department_id": to, "don_gia": g}
                                           for to, g in XUONG_BAI_GIA.items()]),
    ]
    return k


K = _khoan()

# ------------------------------------------------------------------ ĐÁP ÁN theo sổ
# Bảng sổ: (giá bài, giá tờ rớt) theo loại bài. 2M: A thường, B Pantone, D Pantone UV (C = A × 2
# là ghi chú UV). 4M–7M: A 1–2 màu, B 3–4 màu, C 4 màu có pha, F 5 màu, G 6 màu, H 7 màu.
SO = {
    M2: {"A": (150_000, 30), "B": (225_000, 30), "D": (450_000, 40)},
    M4: {"A": (250_000, 30), "B": (300_000, 40), "C": (350_000, 45), "F": (550_000, 70),
         "G": (600_000, 80)},
    M5: {"A": (144_000, 20), "B": (180_000, 30), "C": (210_000, 30), "F": (240_000, 35)},
    M6: {"A": (200_000, 20), "B": (250_000, 27), "C": (275_000, 29.7), "F": (375_000, 40),
         "G": (500_000, 50), "H": (650_000, 65)},
    M7: {"A": (200_000, 20), "B": (250_000, 30), "C": (275_000, 35), "F": (375_000, 40),
         "G": (500_000, 50), "H": (650_000, 65)},
}
SO_XUONG_BAI = {M2: 187_500, M4: 150_000, M5: 90_000, M6: 125_000, M7: 125_000}   # "50% bài in"
SO_MAY_HU = {M2: 1_250_000, M4: 1_403_846, M5: 1_403_846, M6: 1_800_000, M7: 1_923_077}


def _loai_bai(to: int, n: int, pha: bool, uv: bool, metaline: bool) -> str | None:
    if n <= 0:
        return None
    if to == M2:
        if n > 2:
            return None
        if pha:
            return "D" if uv and not metaline else "B"
        return "A"
    if n <= 2:
        return "A"
    if n <= 4:
        return "C" if pha else "B"
    return {5: "F", 6: "G", 7: "H"}.get(n)


def _so_tinh(to, n, pha, *, uv=False, metaline=False, hai_luot=False, sl=0.0) -> float | None:
    """Tiền phần bài của MỘT lần ghi theo sổ; None = sổ không có giá (máy chủ phải báo thiếu)."""
    loai = _loai_bai(to, n, pha, uv, metaline)
    if loai not in SO[to]:
        return None
    gia_bai, to_rot = SO[to][loai]
    luot = sl * (2 if hai_luot else 1)          # tự trở / trở nhíp: mỗi tờ qua máy hai lượt
    bai = gia_bai + max(0.0, luot - 3000) * to_rot
    he_so = 3 if metaline else (2 if uv and loai != "D" else 1)
    return bai * he_so


def _so_phat_sinh(to, thay_kem=0, xuong_bai=0) -> float:
    return thay_kem * 100_000 + xuong_bai * SO_XUONG_BAI[to]


# ------------------------------------------------------------------ MÁY tính (đường lương)
def _may_tinh(to, qc, *, uv=0, metaline=0, sl=0.0, mat=None, thay_kem=0, xuong_bai=0):
    tc = {"muc_uv": uv, "metaline": metaline}
    ps = [{"phat_sinh_id": i, "so_luong": n} for i, n in ((THAY_KEM, thay_kem), (XUONG_BAI, xuong_bai))
          if n]
    o, rows = viec_khoan.chuan_hoa_khi_ghi(None, khoan=K, ten_cong_doan="In", phat_sinh=ps,
                                           department_id=to, tuy_chon=tc, qc=qc, mat_in=mat)
    tien_ps = sum(float(r.so_luong) * float(r.don_gia_snapshot) for r in rows)
    if o["don_gia_khoan_snapshot"] is None:
        return None, tien_ps, o["bac_khoan_snapshot"]
    b = SimpleNamespace(**o, tong=sl, tot=sl)
    them = {"so_lan_chay": 1.0, "tien_gio": 0.0,
            **KhoanKyService.chip_lenh(qc, o["bac_khoan_snapshot"])}
    return KhoanKyService._tien_chinh(K, b, qc, them), tien_ps, o["bac_khoan_snapshot"]


# ------------------------------------------------------------------ ma trận
def _bo_muc() -> list[list[str]]:
    return [CMYK[:np] + [f"P{i}" for i in range(1, nf + 1)]
            for np in range(5) for nf in range(5) if np + nf]


def _quy_cach(kem: list[str]):
    """(tên, qc, mặt chọn khi ghi, hai lượt?) — mỗi kiểu đều cho đúng bộ kẽm `kem` lên máy."""
    n, pha = len(kem), sum(1 for m in kem if m not in CMYK)
    ra = [("1 mặt", {"muc_a": kem, "muc_b": [], "quy_cach_in": "mot_mat"}, None, False),
          ("tự trở", {"muc_a": kem, "muc_b": kem[:1], "quy_cach_in": "tu_tro"}, None, True),
          ("trở nhíp", {"muc_a": kem[:1], "muc_b": kem, "quy_cach_in": "tro_nhip"}, None, True),
          ("AB mặt A", {"muc_a": kem, "muc_b": ["K"], "quy_cach_in": "hai_mat"}, "a", False),
          ("AB mặt B", {"muc_a": CMYK, "muc_b": kem, "quy_cach_in": "hai_mat"}, "b", False),
          ("bài ghép", {"bien_so_mau": n, "bien_so_mau_pha": pha, "bien_so_mau_phu": n}, None, False)]
    if not pha:
        ra.append(("ảnh chụp cũ", {"so_mau": n}, None, False))
    return ra


SO_TO = [1, 1499, 1500, 1501, 2999, 3000, 3001, 4300, 10_700, 100_000]
TICK = [(uv, me) for uv in (0, 1) for me in (0, 1)]


@pytest.mark.parametrize("to", [M2, M4, M5, M6, M7], ids=["2M", "4M", "5M", "6M", "7M"])
def test_ma_tran_moi_to_khop_so(to):
    sai, dem = [], 0
    for kem in _bo_muc():
        n, pha = len(kem), any(m not in CMYK for m in kem)
        for ten, qc, mat, hai_luot in _quy_cach(kem):
            for uv, me in TICK:
                for sl in SO_TO:
                    dem += 1
                    may, _ps, bac = _may_tinh(to, qc, uv=uv, metaline=me, sl=sl, mat=mat)
                    so = _so_tinh(to, n, pha, uv=uv, metaline=me, hai_luot=hai_luot, sl=sl)
                    if (may is None) != (so is None) or (so is not None and abs(may - so) > 1e-6):
                        sai.append(f"{'+'.join(kem)} {ten} uv={uv} metaline={me} "
                                   f"{sl} tờ: máy {may} ({bac and bac.get('ten')}) sổ {so}")
    assert dem > 5_000
    assert not sai, f"{len(sai)}/{dem} ca lệch, ví dụ:\n" + "\n".join(sai[:15])


@pytest.mark.parametrize("to", [M2, M4, M5, M6, M7], ids=["2M", "4M", "5M", "6M", "7M"])
@pytest.mark.parametrize(("thay_kem", "xuong_bai"), [(0, 0), (1, 0), (3, 0), (0, 1), (2, 2)])
def test_viec_phat_sinh_cong_rieng(to, thay_kem, xuong_bai):
    qc = {"muc_a": CMYK, "quy_cach_in": "mot_mat"}
    chinh0, ps0, _ = _may_tinh(to, qc, sl=5000)
    chinh, ps, _ = _may_tinh(to, qc, sl=5000, thay_kem=thay_kem, xuong_bai=xuong_bai)
    assert chinh == chinh0 and ps0 == 0
    assert ps == _so_phat_sinh(to, thay_kem, xuong_bai)


def test_mat_khong_doi_tien_lenh_khac_mau_mau():
    # Cùng bộ kẽm thì 1 mặt, AB một mặt, bài ghép ra một số — chỉ tự trở / trở nhíp gấp lượt.
    kem = ["C", "M", "Y", "P1"]
    ra = {ten: _may_tinh(M7, qc, sl=8000, mat=mat)[0] for ten, qc, mat, _h in _quy_cach(kem)}
    assert ra["1 mặt"] == ra["AB mặt A"] == ra["AB mặt B"] == ra["bài ghép"] == 275_000 + 5000 * 35
    assert ra["tự trở"] == ra["trở nhíp"] == 275_000 + 13_000 * 35


# ------------------------------------------------------------------ dòng thật trong sổ
@pytest.mark.parametrize(("ten", "to", "kem", "tick", "sl", "kem_thay", "dung"), [
    ("2M WIPRO 413", M2, ["K"], {}, 10_700, 0, 381_000),
    ("2M WIPRO", M2, ["K"], {}, 10_000, 0, 360_000),
    ("2M", M2, ["K"], {}, 4_500, 0, 195_000),
    ("2M bài lẻ 30 tờ", M2, ["K"], {}, 30, 0, 150_000),
    ("2M 1–2 CMYK UV = 300k/60", M2, ["C", "K"], {"uv": 1}, 5_000, 0, 300_000 + 2_000 * 60),
    ("2M Pantone UV", M2, ["K", "185C"], {"uv": 1}, 5_000, 0, 530_000),
    ("2M Pantone metaline, tick cả UV", M2, ["K", "185C"], {"uv": 1, "metaline": 1}, 500, 0, 675_000),
    ("7M1 bài B", M7, CMYK, {}, 21_350, 0, 800_500),
    ("7M 393B bài đầu", M7, ["C", "M", "Y", "P1"], {}, 4_300, 0, 320_500),
    # Sổ ghi 474.500 / 331.000 (bỏ giá bài) — chủ chốt 22/10 sổ sai: ăn đủ giá bài + 100.000 thay kẽm.
    ("7M 393A thay 1 kẽm", M7, ["C", "M", "Y", "P1"], {}, 10_700, 1, 275_000 + 7_700 * 35 + 100_000),
    ("7M 393C thay 1 kẽm", M7, ["C", "M", "Y", "P1"], {}, 6_600, 1, 275_000 + 3_600 * 35 + 100_000),
    ("4M 2 màu có pha = 1–2 màu", M4, ["K", "185C"], {}, 5_000, 0, 310_000),
    # Sổ hiện "30" vì ô định dạng không lẻ; giá thật 29,7 = 27 × 1,1 (dòng 6M1 lệnh 397: 631.400).
    ("6M 397 4 màu có pha 15.000 tờ", M6, ["C", "M", "Y", "P1"], {}, 15_000, 0, 631_400),
])
def test_dong_that_trong_so(ten, to, kem, tick, sl, kem_thay, dung):
    chinh, ps, _ = _may_tinh(to, {"muc_a": kem, "quy_cach_in": "mot_mat"}, sl=sl, thay_kem=kem_thay,
                             **tick)
    assert chinh + ps == dung, ten


def test_ab_moi_mat_mot_bai():
    qc = {"muc_a": CMYK, "muc_b": ["K"], "quy_cach_in": "hai_mat"}
    a, _, bac_a = _may_tinh(M4, qc, sl=5_000, mat="a")
    b, _, bac_b = _may_tinh(M4, qc, sl=5_000, mat="b")
    assert (a, b) == (300_000 + 2_000 * 40, 250_000 + 2_000 * 30)
    assert bac_a["mat"] == "a" and viec_khoan.mo_ta_mau(bac_b) == "lệnh mặt B 1 màu"
    with pytest.raises(ValueError, match="chọn mặt A hay mặt B"):
        _may_tinh(M4, qc, sl=5_000)
    with pytest.raises(ValueError, match="không in AB"):
        _may_tinh(M4, {"muc_a": CMYK, "quy_cach_in": "mot_mat"}, sl=5_000, mat="a")


def test_bac_theo_chon_lenh_ab_tach_tung_mat():
    qc = {"muc_a": [*CMYK, "P1"], "muc_b": ["K", "P2"], "quy_cach_in": "hai_mat"}
    ds = viec_khoan.bac_theo_chon(K, qc, M2)
    assert {x["mat"] for x in ds} == {"a", "b"} and len(ds) == 8
    b_uv = next(x for x in ds if x["mat"] == "b" and x["chon"] == {"metaline": 0.0, "muc_uv": 1.0})
    assert (b_uv["bac_ten"], b_uv["gia_co_dinh"]) == ("1–2 màu Pantone UV", 450_000)
    a = next(x for x in ds if x["mat"] == "a")
    assert a["thieu_gia"] and a["so_mau"] == 5     # máy 2 màu không in mặt 5 màu
    # Lệnh 1 mặt: không có mặt.
    assert {x["mat"] for x in viec_khoan.bac_theo_chon(K, {"muc_a": CMYK}, M4)} == {None}


def test_thieu_gia_van_noi_dung_bac_khop_dau():
    # Máy 2 màu gặp lệnh 4 màu: không ô nào của tổ khớp ⇒ giữ bậc khớp đầu để lương nói rõ.
    chinh, _, bac = _may_tinh(M2, {"muc_a": CMYK, "quy_cach_in": "mot_mat"}, sl=5_000)
    assert chinh is None and bac["ten"] == "3–4 màu thường"
    chinh, _, bac = _may_tinh(M4, {"muc_a": [*CMYK, "P1", "P2", "P3", "P4"]}, sl=5_000)
    assert chinh is None and bac["ma"] is None and bac["so_mau"] == 8


# ------------------------------------------------------------------ một tháng qua `tinh`
@pytest.fixture()
def nen(client):
    db = SessionLocal()
    try:
        yield _Nen2(db)
    finally:
        db.rollback()
        db.close()


def test_mot_ngay_to_7m_va_ngay_may_hu_qua_ky_luong(nen):
    db = nen.db
    to = nen.to("Máy 7 màu")
    nhat = nen.nv(to, "Nhất")
    k = nen.khoan2(CT, tuy_chon=TC)
    k.bac_gia = BAC
    k.gia_theo_to = [{"department_id": to.id, "bac": ma, "gia_co_dinh": g, "don_gia": d}
                     for ma, (g, d) in GIA[M7].items()]
    kem = CongDoanKhoanPhatSinh(ten="Thay kẽm", don_gia=100_000, don_vi="kem", thu_tu=0)
    k.viec_phat_sinh.append(kem)
    db.add(KhoanChiTieuNgay(department_id=to.id, ap_dung_tu=date(NAM, 1, 1), so_tien=SO_MAY_HU[M7]))
    db.flush()

    def ghi(gio, sl, mau, tick=None, thay_kem=0):
        cv = nen.cv(to)
        o, rows = viec_khoan.chuan_hoa_khi_ghi(
            db, khoan=k, ten_cong_doan="In", department_id=to.id, tuy_chon=tick,
            phat_sinh=[{"phat_sinh_id": kem.id, "so_luong": thay_kem}] if thay_kem else [],
            qc={"muc_a": mau, "quy_cach_in": "mot_mat"})
        bd = datetime(NAM, THANG, 5, gio - 7, 0, tzinfo=timezone.utc)
        b = SanXuatBatch(cong_viec_id=cv.id, bat_dau=bd, ket_thuc=bd + timedelta(hours=1), tong=sl,
                         tot=sl, hong=0, don_vi="to", **o)
        db.add(b)
        db.flush()
        for r in rows:
            r.batch_id = b.id
            db.add(r)
        db.add(SanXuatBatchNguoi(batch_id=b.id, employee_id=nhat.id, department_id=to.id))
        db.flush()

    ghi(8, 21_350, CMYK)                                                   # 800.500
    ghi(10, 4_300, ["C", "M", "Y", "P1"])                                  # 320.500
    ghi(12, 10_700, ["C", "M", "Y", "P1"], thay_kem=1)                     # 644.500
    ghi(14, 6_600, ["C", "M", "Y", "P1"], thay_kem=1)                      # 501.000
    db.add(KhoanDungMay(department_id=to.id, ngay=date(NAM, THANG, 6), ly_do="may_hu", nguoi_ids=[nhat.id]))
    db.flush()

    kq = KhoanKyService(db).tinh(NAM, THANG, _muc((nhat, 16_500_000)))
    lan = [d["tien_lan_ghi"] for d in kq["theo_nguoi"][nhat.id] if d["loai"] == "lan_ghi"]
    assert sorted(lan) == sorted([800_500, 320_500, 644_500, 501_000])
    ngay = 800_500 + 320_500 + 644_500 + 501_000
    assert kq["khoan"][nhat.id] == ngay + SO_MAY_HU[M7]
    # Tăng ca: 50% phần tổ vượt chỉ tiêu ngày (cùng số với máy hư).
    assert kq["tang_ca_khoan"][nhat.id] == round(0.5 * (ngay - SO_MAY_HU[M7]))
