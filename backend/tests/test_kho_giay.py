"""Lõi khổ + đơn vị gốc (`services/kho_giay.py`) — giấy KHÔNG còn dạng cuộn/tờ (10/10/2026); giấy +
vật tư khai được nhiều đơn vị (mg 0390).

Khoá tồn 5 phần tử `(loai, id, rộng, dài, đơn vị gốc)`; đơn vị gốc dòng máy chủ SUY từ ĐVT dòng
(`GocMatHang`): đơn vị đã khai mà nhóm quy đổi của nó chứa ĐVT dòng; không thuộc nhóm nào ⇒ None.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
import app.models  # noqa: F401 — đăng ký metadata mọi bảng
from app.models.don_vi_do import DonViDo, DonViQuyDoi
from app.models.vat_lieu_kho import GiayNguyen
from app.repositories.don_vi_do_repo import DonViDoRepository
from app.repositories.vat_lieu_kho_repo import VatLieuKhoRepository
from app.services.kho_giay import (
    GocMatHang, chuan_kho, don_vi_khai, khoa_dong, khoa_ton, khoa_ton_cua, nhan_kho,
)
from app.services.quy_doi_service import don_vi_map
from app.services.vat_lieu_kho_service import VatLieuKhoService

# Đơn vị mẫu: họ tờ (to · ram · mã chặng to_nguyen không cặp) + họ khối lượng (kg · tấn).
_DV = [("to", "tờ", "to"), ("to_nguyen", "tờ nguyên", "to"), ("ram", "ram", "to"),
       ("kg", "kg", "khoi_luong"), ("tan", "tấn", "khoi_luong"), ("cai", "cái", "dem")]
_CAP = [{"tu_ma": "ram", "den_ma": "to", "he_so": 500}, {"tu_ma": "tan", "den_ma": "kg", "he_so": 1000}]


def _goc_giay() -> GocMatHang:
    return GocMatHang(don_vi_map([{"ma": m, "ten": t, "ho": h} for m, t, h in _DV]), _CAP)


def test_chuan_kho_canh_ngan_truoc_va_lam_tron_mm():
    assert chuan_kho(905, 780) == (780, 905)
    assert chuan_kho("780", 905.4) == (780, 905)
    assert chuan_kho(1000, None) == (1000, 0)
    assert chuan_kho(None, 0) == (0, 0)


def test_khoa_ton_5_phan_tu_giu_kho_va_don_vi_goc_ca_giay_lan_vat_tu():
    # Vật tư có khổ tuỳ chọn như giấy (27/10/2026): khổ chuẩn cạnh ngắn trước, GIỮ đơn vị gốc.
    assert khoa_ton("vat_tu", 7, kho_rong=905, kho_dai=780) == ("vat_tu", 7, 780, 905, "")
    assert khoa_ton("vat_tu", 7, goc="kg", kho_rong=320) == ("vat_tu", 7, 320, 0, "kg")
    assert khoa_ton("vat_tu", 7, goc="kg", kho_rong=320) != khoa_ton("vat_tu", 7, goc="kg", kho_rong=320,
                                                                      kho_dai=500)
    # Hàng khác (thành phẩm, khuôn) vẫn không khổ.
    assert khoa_ton("thanh_pham", 7, kho_rong=780, kho_dai=905) == ("thanh_pham", 7, 0, 0, "")
    assert khoa_ton("vat_tu", 7, goc="KG") == ("vat_tu", 7, 0, 0, "kg")
    assert khoa_ton("vat_tu", 7, goc="kg") != khoa_ton("vat_tu", 7, goc="thung")
    assert khoa_ton("giay", 3, goc="to", kho_rong=905, kho_dai=780) == ("giay", 3, 780, 905, "to")
    # Khổ chỉ-rộng giữ nguyên (1000, 0) — KHÔNG gom về (0, 0) như "cuộn" cũ.
    assert khoa_ton("giay", 3, goc="KG", kho_rong=1000) == ("giay", 3, 1000, 0, "kg")
    # Cùng khổ khác đơn vị gốc là hai món.
    assert (khoa_ton("giay", 3, goc="to", kho_rong=780, kho_dai=905)
            != khoa_ton("giay", 3, goc="kg", kho_rong=780, kho_dai=905))
    # Khổ chỉ-rộng không khớp khổ hai cạnh.
    assert khoa_ton("giay", 3, goc="kg", kho_rong=1000) != khoa_ton("giay", 3, goc="kg", kho_rong=1000, kho_dai=700)


def test_khoa_ton_cua_doc_don_vi_goc_cua_lo():
    class Lo:
        hang_loai, hang_id, don_vi_goc, kho_rong, kho_dai = "giay", 3, "to", 905, 780

    class Vt:
        hang_loai, hang_id, don_vi_goc, kho_rong, kho_dai = "vat_tu", 5, "kg", 0, 0

    class Khuon:
        hang_loai, hang_id, don_vi_goc, kho_rong, kho_dai = "khuon", 9, "", 0, 0

    assert khoa_ton_cua(Lo()) == ("giay", 3, 780, 905, "to")
    assert khoa_ton_cua(Vt()) == ("vat_tu", 5, 0, 0, "kg")
    assert khoa_ton_cua(Khuon()) == ("khuon", 9)


def test_khoa_dong_cung_ma_khac_kho_hoac_khac_goc_la_hai_dong():
    assert khoa_dong("giay", 3, "to", 780, 905) != khoa_dong("giay", 3, "to", 800, 1090)
    assert khoa_dong("giay", 3, "to", 905, 780) == khoa_dong("giay", 3, "to", 780, 905)
    assert khoa_dong("giay", 3, "to", 780, 905) != khoa_dong("giay", 3, "kg", 780, 905)
    # Vật tư: khổ vào khoá như giấy (27/10/2026), đơn vị gốc có.
    assert khoa_dong("vat_tu", 5, "cai", 500, 700) == khoa_dong("vat_tu", 5, "CAI", 700, 500)
    assert khoa_dong("vat_tu", 5, "cai", 500, 700) != khoa_dong("vat_tu", 5, "cai")
    assert khoa_dong("vat_tu", 5, "cai", 320) != khoa_dong("vat_tu", 5, "cai", 320, 700)
    assert khoa_dong("vat_tu", 5, "cai") != khoa_dong("vat_tu", 5, "thung")
    assert khoa_dong("khuon", 5, "cai", 1, 2) == khoa_dong("khuon", 5, None)


def test_goc_ve_don_vi_khai_co_nhom_chua_dvt():
    g = _goc_giay()
    khai = ["kg", "to"]
    assert g.goc("to", khai) == "to"
    assert g.goc("ram", khai) == "to"
    # Mã chặng tờ của lệnh qua cửa kho: vẫn nhóm tờ.
    assert g.goc("to_nguyen", khai) == "to"
    assert g.goc("Tờ", khai) == "to"
    assert g.goc("tan", khai) == "kg"
    assert g.goc("tấn", khai) == "kg"
    # Khai tấn làm ĐVT chính: kg thuộc nhóm tấn ⇒ gốc là tấn.
    assert g.goc("kg", ["tan"]) == "tan"


def test_goc_don_vi_chua_khai_la_none_bo_trong_lay_dvt_chinh():
    g = _goc_giay()
    assert g.goc("cai", ["kg", "to"]) is None
    # Giấy chỉ khai kg: tờ là đơn vị CHƯA KHAI (không còn họ tờ ngầm).
    assert g.goc("ram", ["kg"]) is None
    assert g.goc("", ["kg", "to"]) == "kg"
    assert g.goc(None, ["KG"]) == "kg"
    assert g.goc("kg", []) is None
    assert "ram" in g.ho("to") and "tan" in g.ho("kg") and "kg" not in g.ho("to")


def test_cung_nhom_va_don_vi_khai():
    g = _goc_giay()
    assert g.cung_nhom("kg", "tan") and g.cung_nhom("to", "ram") and g.cung_nhom("to_nguyen", "to")
    assert not g.cung_nhom("kg", "to") and not g.cung_nhom("kg", None)

    class M:
        don_vi_gia, don_vi_them = "KG", ["to", "kg", "", None]

    assert don_vi_khai(M()) == ["kg", "to"]


def test_nhan_kho():
    assert nhan_kho(780, 905) == "780 × 905 mm"
    assert nhan_kho(1000, 0) == "khổ 1000 mm"
    assert nhan_kho(0, 0) == "chưa có khổ"


@pytest.fixture
def db():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    s = sessionmaker(bind=eng)()
    ids = {}
    for ma, ten, ho in _DV:
        d = DonViDo(ma=ma, ten=ten, ho=ho)
        s.add(d)
        s.flush()
        ids[ma] = d.id
    s.add(DonViQuyDoi(tu_id=ids["ram"], den_id=ids["to"], he_so=500))
    s.add(DonViQuyDoi(tu_id=ids["tan"], den_id=ids["kg"], he_so=1000))
    s.commit()
    yield s
    s.close()


def test_quy_ve_goc_giay_khong_truyen_goc_suy_tu_dvt(db):
    g = GiayNguyen(ma="C80", ten="COUCHE 80GSM", gsm=80, don_vi_gia="kg", don_vi_them=["to"])
    db.add(g)
    db.commit()
    svc = VatLieuKhoService(VatLieuKhoRepository(db), DonViDoRepository(db))
    q = svc.quy_ve_goc("giay", g.id, "ram", 2)
    assert q["don_vi_goc"] == "to" and q["sl_goc"] == 1000
    q = svc.quy_ve_goc("giay", g.id, "tan", 1.5)
    assert q["don_vi_goc"] == "kg" and q["sl_goc"] == 1500
    assert svc.quy_ve_goc("giay", g.id, "kg", 7)["don_vi_goc"] == "kg"
    # Bộ suy dựng từ DB cho cùng kết quả.
    assert svc.goc_mat_hang().goc("ram", ["kg", "to"]) == "to"
    assert GocMatHang.tu_db(db).goc("tan", ["kg", "to"]) == "kg"
    # Danh sách đơn vị gộp hai nhóm, mỗi dòng mang gốc của nhóm nó.
    ra = svc.don_vi_cua_mat_hang("giay", g.id)
    assert {d["ma"]: d["goc"] for d in ra["ds"]} == {"kg": "kg", "tan": "kg", "to": "to", "ram": "to"}


def test_don_vi_chua_khai_bi_chan_khi_quy_ve_goc(db):
    from app.services.vat_lieu_kho_service import VatLieuKhoValidationError

    g = GiayNguyen(ma="C81", ten="COUCHE 81", gsm=80, don_vi_gia="kg")
    db.add(g)
    db.commit()
    svc = VatLieuKhoService(VatLieuKhoRepository(db), DonViDoRepository(db))
    with pytest.raises(VatLieuKhoValidationError, match="chưa khai ở danh mục"):
        svc.quy_ve_goc("giay", g.id, "ram", 2)
