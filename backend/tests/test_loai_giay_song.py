"""Loại Giấy / Sóng của mã giấy (spec 2026-10-19-loai-giay-song).

Mỗi mã ở danh mục Giấy thuộc đúng một loại: `giay` hoặc `song`. Một sản phẩm tính giá (và một lệnh)
có tối đa 1 mã Giấy + 1 mã Sóng; giấy chính lấy theo loại chứ không đoán theo thứ tự bước.
"""
import pytest
from pydantic import ValidationError

from app.schemas.vat_lieu_kho import GiayIn
from tests.test_vat_lieu_kho import _svc


# ---- Danh mục ----------------------------------------------------------------------------------


def test_tao_giay_mac_dinh_loai_giay():
    _db, svc = _svc()
    g = svc.create("giay", dict(ma="C150", ten="Couche 150", gsm=150, don_vi_gia="kg"))
    assert g.loai == "giay"


def test_tao_giay_loai_song():
    _db, svc = _svc()
    g = svc.create("giay", dict(ma="SONG-E", ten="Sóng E", gsm=300, don_vi_gia="kg", loai="song"))
    assert g.loai == "song"
    g2 = svc.update("giay", g.id, dict(ma="SONG-E", ten="Sóng E", gsm=300, don_vi_gia="kg", loai="giay"))
    assert g2.loai == "giay"


def test_loai_la_gia_tri_la_bi_422():
    with pytest.raises(ValidationError):
        GiayIn(ma="D", ten="Decal", gsm=80, loai="decal")
    assert GiayIn(ma="C", ten="C", gsm=80).loai == "giay"


def test_loc_va_dem_theo_loai():
    _db, svc = _svc()
    svc.create("giay", dict(ma="C150", ten="Couche 150", gsm=150, don_vi_gia="kg"))
    svc.create("giay", dict(ma="SONG-E", ten="Sóng E", gsm=300, don_vi_gia="kg", loai="song"))
    rows, total = svc.list("giay", loai="song")
    assert total == 1 and rows[0].ma == "SONG-E"
    dem = {d["value"]: (d["nhan"], d["so"]) for d in svc.dem_theo_cot("giay", "loai")}
    assert dem == {"giay": ("Giấy", 1), "song": ("Sóng", 1)}


# ---- Luật trần theo loại (hàm thuần — lệnh vẫn mang giấy ở bước) --------------------------------------
from app.services.ptg_giay_buoc import ThongTinGiay, id_giay_cua_rows, loi_tran_giay  # noqa: E402

_BANG = {10: ThongTinGiay("giay", "COUCHE 150"), 11: ThongTinGiay("giay", "IVORY 300"),
         20: ThongTinGiay("song", "SÓNG E"), 21: ThongTinGiay("song", "SÓNG B")}


def _g(gid):
    return {"hang_loai": "giay", "vat_tu_id": gid}


def test_bang_thieu_ma_coi_la_giay():
    assert loi_tran_giay("Hộp", [10, 99], _BANG) is not None


def test_loi_tran_hai_giay():
    loi = loi_tran_giay("Hộp bánh", [10, 20, 11], _BANG)
    assert loi == "Sản phẩm «Hộp bánh» đang có 2 giấy: COUCHE 150, IVORY 300. Mỗi sản phẩm chỉ một giấy."


def test_loi_tran_hai_song():
    loi = loi_tran_giay("Hộp bánh", [10, 20, 21], _BANG)
    assert loi is not None and "2 sóng" in loi and "chỉ một sóng" in loi


def test_cung_ma_hai_buoc_khong_loi_va_mot_giay_mot_song_duoc():
    rows = [{"cong_doan_id": 1, "vat_tus": [_g(10)]}, {"cong_doan_id": 2, "vat_tus": [_g(10), _g(20)]}]
    assert id_giay_cua_rows(rows) == [10, 10, 20]
    assert loi_tran_giay("Hộp", id_giay_cua_rows(rows), _BANG) is None
    assert loi_tran_giay("Hộp", [], _BANG) is None


# ---- Phiếu tính giá: cấu hình tái bản cũ quá một giấy vẫn nạp được ----------------------------------
def test_nap_tai_ban_hai_giay_khong_chan():
    """Đường ĐỌC không chặn: giấy loại Giấy đầu tiên lên `giay_id`, lần lưu phiếu mới là chỗ chặn."""
    from app.services.ptg_giay_buoc import chuyen_giay_buoc_len_san_pham

    cfg = {"thanh_phams": [{"cong_doan_id": 2, "vat_tus": [_g(10), _g(11)]}]}
    out = chuyen_giay_buoc_len_san_pham(cfg, _BANG)
    assert (out["giay_id"], out["song_id"]) == (10, None) and out["thanh_phams"][0]["vat_tus"] == []


# ---- Lệnh sản xuất ---------------------------------------------------------------------------------
from app.models.vat_lieu_kho import GiayNguyen  # noqa: E402
from app.services.lsx_service import LsxValidationError  # noqa: E402
from tests.test_giay_vat_tu_buoc_lsx import _ptg, _tao_lenh  # noqa: E402
from tests.test_lsx_service import (  # noqa: E402,F401 — fixture dùng chung
    _don_da_chuyen_sx, _may_in, _to_san_xuat, admin, customer, db, lsx_svc, orders,
)


def _routing(lsx, vat_tus_theo_buoc: dict[int, list[dict]]):
    """Routing hiện tại của lệnh; bước có trong `vat_tus_theo_buoc` gửi đúng dòng đó, bước khác KHÔNG
    gửi khoá `vat_tus` (giữ nguyên dòng cũ)."""
    from app.schemas.lsx import LsxCongDoanIn

    ra = []
    for i, cd in enumerate(sorted(lsx.cong_doans, key=lambda c: c.thu_tu)):
        kw = dict(step_key=cd.step_key, cong_doan_id=cd.cong_doan_id, ten=cd.ten, nhom=cd.nhom,
                  loai_buoc=cd.loai_buoc, thu_tu=cd.thu_tu)
        if i in vat_tus_theo_buoc:
            kw["vat_tus"] = vat_tus_theo_buoc[i]
        ra.append(LsxCongDoanIn(**kw))
    return ra


def _ma_giay(db, lsx_svc, ma: str, loai: str) -> int:
    g = GiayNguyen(don_vi_them=["to"], ma=ma, ten=ma, gsm=300, don_gia=1, don_vi_gia="to", loai=loai)
    db.add(g)
    db.commit()
    lsx_svc._mon_cache = lsx_svc._loai_giay_cache = None   # service nhớ danh mục từ lúc tạo lệnh
    return g.id


def _lenh_co_couche(db, orders, lsx_svc, admin, customer):
    """Lệnh In → Cán, bước In mang COUCHE-150 (gắn qua routing: phiếu không còn giấy ở bước)."""
    lsx = _tao_lenh(db, orders, lsx_svc, admin, customer, _ptg(db, giay_o=None))
    cou = _ma_giay(db, lsx_svc, "COUCHE-150", "giay")
    lsx_svc.replace_routing(lsx_id=lsx.id, actor=admin, rows_in=_routing(
        lsx, {0: [{"hang_loai": "giay", "vat_tu_id": cou}]}))
    db.commit()
    return lsx, cou


def test_luu_lenh_hai_giay_bi_chan_ke_ca_buoc_khong_gui_vat_tus(db, orders, lsx_svc, admin, customer):
    lsx, _ = _lenh_co_couche(db, orders, lsx_svc, admin, customer)
    ivory = _ma_giay(db, lsx_svc, "IVORY-300", "giay")
    # Bước In (0) giữ COUCHE vì không gửi `vat_tus`; bước Cán (1) thêm IVORY ⇒ lệnh có 2 giấy.
    with pytest.raises(LsxValidationError, match="Mỗi lệnh chỉ một giấy"):
        lsx_svc.replace_routing(lsx_id=lsx.id, actor=admin, rows_in=_routing(
            lsx, {1: [{"hang_loai": "giay", "vat_tu_id": ivory}]}))


def test_luu_lenh_giay_va_song_duoc_va_dong_mang_loai(db, orders, lsx_svc, admin, customer):
    lsx, _ = _lenh_co_couche(db, orders, lsx_svc, admin, customer)
    song = _ma_giay(db, lsx_svc, "SONG-E", "song")
    lsx_svc.replace_routing(lsx_id=lsx.id, actor=admin, rows_in=_routing(
        lsx, {1: [{"hang_loai": "giay", "vat_tu_id": song}]}))
    db.commit()
    d = lsx_svc.detail_dict(lsx)
    loai = {v["vat_tu_ten"]: v["giay_loai"] for cd in d["cong_doans"] for v in cd["vat_tus"]}
    assert loai == {"COUCHE-150": "giay", "SONG-E": "song"}


# ---- Thẻ quy cách tách Giấy / Sóng -----------------------------------------------------------------
from app.services.san_xuat.snapshot import the_quy_cach  # noqa: E402


def test_the_quy_cach_giay_va_song():
    the = the_quy_cach({"giay_ten": "COUCHE 150GSM", "gsm": 150, "giays": ["COUCHE 150GSM"],
                        "songs": ["SÓNG E"]})
    assert the["giay"] == "COUCHE 150GSM" and the["song"] == "SÓNG E" and the["dinh_luong"] == 150


def test_the_quy_cach_khong_song_khong_khoa():
    the = the_quy_cach({"giay_ten": "COUCHE 150GSM", "gsm": 150, "giays": [], "songs": []})
    assert the["giay"] == "COUCHE 150GSM" and "song" not in the


def test_giay_song_cac_buoc_tach_loai(db, orders, lsx_svc, admin, customer):
    from app.repositories.lsx_repo import LsxRepository

    lsx, cou = _lenh_co_couche(db, orders, lsx_svc, admin, customer)
    song = _ma_giay(db, lsx_svc, "SONG-E", "song")
    lsx_svc.replace_routing(lsx_id=lsx.id, actor=admin, rows_in=_routing(
        lsx, {0: [{"hang_loai": "giay", "vat_tu_id": song}, {"hang_loai": "giay", "vat_tu_id": cou}]}))
    db.commit()
    assert LsxRepository(db).giay_song_cac_buoc(lsx.id) == (["COUCHE-150"], ["SONG-E"])
