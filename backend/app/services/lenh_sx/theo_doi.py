"""Màn "Theo dõi sản xuất" — Theo máy, Theo lệnh và dải bất thường (làm gọn 05/10/2026).

Cả ba đọc MỘT lượt nạp (`_nap`): tập lệnh = `_ids_trong_pham_vi` (đã phát hành, đúng phạm vi token)
→ `_bo_lenh_da_rung` (luật 28/09) → MỘT `boi_canh.nap()` →
`trang_thai.co_canh_bao(den_vat_tu=None)` cho từng lệnh → trạng thái máy cho máy còn dùng hoặc còn
việc. Không `can_doi()`: cờ thiếu vật tư không vào màn này. Số câu SQL hằng theo số lệnh.

Dải bất thường đếm trên TOÀN tập còn sống, TRƯỚC ô tìm/khách/máy và trước chính mục đang chọn — gõ
tìm xong không được làm người ta tưởng sự cố đã hết. Vì vậy lượt nạp KHÔNG lọc theo ô tìm; ô tìm,
khách, máy chạy thêm MỘT câu `select(Lsx.id)` (`bang_theo_doi._loc_ban`, cùng phép với Hồ sơ lệnh)
rồi giao với tập đã nạp.

Trạng thái máy: bốn trạng thái dẫn xuất của `may_trang_thai` (hỏng, bảo trì, chặn xếp lệnh, có
phiếu sửa) — BỎ nhánh `dang_chay` của `trang_thai_may` vì nhánh đó đọc KẾ HOẠCH Xếp lịch, không
phải máy có chạy thật. Máy có chạy hay không đọc từ công việc `running`/`paused` đã nạp.

Không một số tiền nào.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.bai_ghep import BaiGhep
from ...models.gia_cong_ngoai import GiaCongNgoai
from ...models.may_thiet_bi import MayThietBi
from ...models.san_xuat import (
    BUOC_MAY,
    BUOC_THUE_NGOAI,
    CV_DANG_CHAY,
    CV_HOAN_THANH,
    CV_PHAT_HANH,
    CV_TAM_DUNG,
    SanXuatCongViec,
)
from .. import may_trang_thai
from ..gio_xuong import lich_hien_thi, thuc_te_hien_thi
from . import boi_canh, danh_sach, tien_do, trang_thai
from .bang_theo_doi import BoLoc, _bo_lenh_da_rung, _ids_trong_pham_vi, _may_danh_muc
from .boi_canh import BoiCanh

# Sáu mục của dải bất thường — thứ tự = thứ tự trên màn; giá trị đi thẳng ra `?bat_thuong=`.
CO_LENH = (
    trang_thai.CO_TRE_HAN, trang_thai.CO_SU_CO, trang_thai.CO_TAM_DUNG,
    trang_thai.CO_KCS_KHONG_DAT,
)
BT_MAY_HONG = "may_hong"
BT_CHUA_MAY = "chua_may"
BAT_THUONG = CO_LENH + (BT_MAY_HONG, BT_CHUA_MAY)

# Góc Theo lệnh không phân trang (tập còn sống); quá ngưỡng thì cắt và FE nói rõ "Hiện 200 trên N".
GIOI_HAN_THEO_LENH = 200


@dataclass
class _Nap:
    """Kết quả MỘT lượt nạp — dùng chung cho Theo máy, Theo lệnh và dải bất thường."""

    ids: list[int]
    bc: BoiCanh
    # Ngày hôm nay theo giờ xưởng — đếm số ngày đã qua hạn giao khách.
    hom_nay: date
    co: dict[int, list[str]]
    # Công việc CHƯA xong của tập đã nạp, khử trùng theo id (một ca in ghép phục vụ nhiều lệnh).
    cv_song: dict[int, SanXuatCongViec]
    # cv.id → các lệnh nó phục vụ, sắp theo mã.
    lenh_cua_cv: dict[int, list[int]]
    may: dict[int, MayThietBi]
    # Chỉ máy CÓ chuyện: may_id → một trong may_dung / bao_tri / khoa / co_phieu_sua.
    tt_may: dict[int, str]


def _la_gia_cong(cv: SanXuatCongViec) -> bool:
    return cv.loai_buoc == BUOC_THUE_NGOAI or cv.gia_cong_ngoai_id is not None


def _chua_may(cv: SanXuatCongViec) -> bool:
    return cv.loai_buoc == BUOC_MAY and cv.may_id is None and not _la_gia_cong(cv)


def _trang_thai_may_that(db: Session, may_ids: list[int]) -> dict[int, str]:
    """Trạng thái máy KHÔNG đọc kế hoạch: bỏ nhánh `dang_chay` của `trang_thai_may`.

    `trang_thai_may` chỉ điền "có phiếu sửa" cho máy không có chuyện gì khác, nên máy nó coi là
    "đang chạy theo kế hoạch" bị bỏ qua phần phiếu sửa. Gạt nhánh đó đi thì phải điền lại phiếu sửa
    cho chính những máy ấy — thêm MỘT câu, không theo số máy."""
    tt = {
        m: v["trang_thai"]
        for m, v in may_trang_thai.trang_thai_may(db, may_ids).items()
        if v["trang_thai"] != may_trang_thai.TT_DANG_CHAY
    }
    con_lai = [m for m in may_ids if m not in tt]
    for m in may_trang_thai.phieu_sua_dang_mo(db, con_lai):
        tt[m] = may_trang_thai.TT_CO_PHIEU_SUA
    return tt


def _nap(db: Session, sale_ids: set[int] | None, bay_gio: datetime) -> _Nap:
    ids = _bo_lenh_da_rung(db, _ids_trong_pham_vi(db, sale_ids), bay_gio=bay_gio)
    bc = boi_canh.nap(db, ids)
    co = {i: trang_thai.co_canh_bao(bc, i, bay_gio) for i in ids}

    cv_song: dict[int, SanXuatCongViec] = {}
    lenh_cua_cv: dict[int, list[int]] = {}
    for i in sorted(ids, key=lambda i: (bc.lenh[i].ma or "", i)):
        for cv in bc.cong_viec_du(i):
            if cv.trang_thai == CV_HOAN_THANH:
                continue
            cv_song[cv.id] = cv
            ds = lenh_cua_cv.setdefault(cv.id, [])
            if i not in ds:
                ds.append(i)

    may = _may_danh_muc(db)
    co_viec = {cv.may_id for cv in cv_song.values() if cv.may_id is not None}
    may_xet = [m for m, mm in may.items() if mm.active or m in co_viec]
    return _Nap(
        ids=ids, bc=bc, hom_nay=tien_do._aware(bay_gio).astimezone(tien_do.BUSINESS_TZ).date(), co=co, cv_song=cv_song, lenh_cua_cv=lenh_cua_cv,
        may=may, tt_may=_trang_thai_may_that(db, may_xet),
    )


def _lenh_khop_loc(
    db: Session, sale_ids: set[int] | None, n: _Nap, *,
    q: str | None, khach_hang_id: int | None, may_id: int | None,
) -> set[int] | None:
    """Tập lệnh khớp ô tìm/khách/máy — `None` khi không ô nào được điền (không lọc)."""
    co_q = bool(q and q.strip())
    if not co_q and khach_hang_id is None and may_id is None:
        return None
    loc = BoLoc(q=q if co_q else None, khach_hang_id=khach_hang_id, may_id=may_id)
    return set(_ids_trong_pham_vi(db, sale_ids, loc=loc)) & set(n.ids)


def _lenh_bat_thuong(n: _Nap, khoa: str) -> set[int]:
    """Lệnh dính mục bất thường `khoa`. Hai mục máy quy về lệnh có BƯỚC CHƯA XONG dính máy đó."""
    if khoa in CO_LENH:
        return {i for i in n.ids if khoa in n.co[i]}
    if khoa == BT_MAY_HONG:
        hong = {m for m, tt in n.tt_may.items() if tt == may_trang_thai.TT_MAY_DUNG}
        chon = (cv for cv in n.cv_song.values() if cv.may_id in hong)
    else:
        chon = (cv for cv in n.cv_song.values() if _chua_may(cv))
    return {i for cv in chon for i in n.lenh_cua_cv[cv.id]}


def dem_bat_thuong(n: _Nap) -> dict[str, int]:
    """Số trên dải bất thường: bốn cờ đếm LỆNH, "máy hỏng" đếm MÁY, "bước chưa có máy" đếm BƯỚC."""
    dem = {k: len(_lenh_bat_thuong(n, k)) for k in CO_LENH}
    dem[BT_MAY_HONG] = sum(1 for tt in n.tt_may.values() if tt == may_trang_thai.TT_MAY_DUNG)
    dem[BT_CHUA_MAY] = sum(1 for cv in n.cv_song.values() if _chua_may(cv))
    return dem


def _khoa_sap_theo_lenh(n: _Nap, lsx_id: int) -> tuple:
    """Số cờ giảm dần → GẤP trước → hạn giao tăng (chưa có hạn xuống cuối) → mã."""
    lsx = n.bc.lenh[lsx_id]
    han = lsx.han_giao_khach
    return (
        -len(n.co[lsx_id]), 0 if lsx.is_rush else 1,
        0 if han is not None else 1, han or date.max, lsx.ma or "", lsx_id,
    )


def _dong_lenh(n: _Nap, lsx_id: int) -> dict:
    bc = n.bc
    lsx = bc.lenh[lsx_id]
    don = bc.don.get(lsx.order_id)
    khach = bc.khach.get(don.customer_id) if don is not None and don.customer_id else None
    cv = danh_sach.buoc_hien_tai(bc, lsx_id)
    khau, khau_ct = trang_thai.khau(bc, lsx_id)
    # Số ngày đã qua hạn giao khách khi lệnh chưa xong (08/11/2026: thôi đo theo "dự kiến xong").
    tre_ngay = None
    if trang_thai.CO_TRE_HAN in n.co[lsx_id] and lsx.han_giao_khach:
        tre_ngay = (n.hom_nay - lsx.han_giao_khach).days
    return {
        "lsx_id": lsx.id,
        "ma": lsx.ma,
        "ten": lsx.ten,
        "is_rush": bool(lsx.is_rush),
        "so_luong_dat": lsx.so_luong_dat,
        "don_vi_tinh": lsx.don_vi_tinh,
        "khach_hang": khach.name if khach is not None else None,
        "chang": danh_sach.chang(bc, lsx_id, cv),
        "buoc_hien_tai": cv.ten_cong_doan if cv is not None else None,
        "khau": khau,
        "khau_chi_tiet": khau_ct,
        "han_hoan_thanh_sx": lsx.han_hoan_thanh_sx,
        "created_at": lsx.created_at,
        "canh_bao": list(n.co[lsx_id]),
        "tre_ngay": tre_ngay,
    }


def theo_lenh(
    db: Session, *, sale_ids: set[int] | None,
    q: str | None = None, khach_hang_id: int | None = None, may_id: int | None = None,
    bat_thuong: str | None = None, khau: str | None = None, bay_gio: datetime | None = None,
) -> dict:
    """`{items, total, bat_thuong}` — mỗi lệnh còn sống một dòng, cắt ở `GIOI_HAN_THEO_LENH`.

    `khau` = điều kiện "Trạng thái" của nút Lọc (07/10/2026): đúng chữ cột "Đang ở" (khâu của
    `trang_thai.khau`). Như các ô lọc khác, KHÔNG đụng số của dải bất thường."""
    bay_gio = bay_gio or datetime.now(timezone.utc)
    n = _nap(db, sale_ids, bay_gio)
    ids = list(n.ids)
    khop = _lenh_khop_loc(db, sale_ids, n, q=q, khach_hang_id=khach_hang_id, may_id=may_id)
    if khop is not None:
        ids = [i for i in ids if i in khop]
    if bat_thuong:
        chon = _lenh_bat_thuong(n, bat_thuong)
        ids = [i for i in ids if i in chon]
    if khau:
        ids = [i for i in ids if trang_thai.khau(n.bc, i)[0] == khau]
    ids.sort(key=lambda i: _khoa_sap_theo_lenh(n, i))
    return {
        "items": [_dong_lenh(n, i) for i in ids[:GIOI_HAN_THEO_LENH]],
        "total": len(ids),
        "bat_thuong": dem_bat_thuong(n),
    }


# --- Góc Theo máy (đặc tả 3.3) --------------------------------------------------------------------
NHOM_CHUA_MAY = "chua_may"
NHOM_MAY = "may"
NHOM_MAY_DA_XOA = "may_da_xoa"
NHOM_GIA_CONG = "gia_cong"

TT_CHO_XEP_MAY = "cho_xep_may"
TT_VIEC_DANG_CHAY = "dang_chay"
TT_VIEC_TAM_DUNG = "tam_dung"
TT_TRONG = "trong"
TT_O_NHA_GIA_CONG = "o_nha_gia_cong"
TT_CHO_MANG_DI = "cho_mang_di"

# Nhãn dựng ở MÁY CHỦ, cùng lý do `may_trang_thai.NHAN`: hai màn tự đặt tên là sớm muộn cùng một máy
# hiện hai chữ. Bốn trạng thái dẫn xuất mượn nguyên chữ của `may_trang_thai`.
NHAN_TINH_TRANG = {
    **{
        k: may_trang_thai.NHAN[k]
        for k in (
            may_trang_thai.TT_MAY_DUNG, may_trang_thai.TT_BAO_TRI, may_trang_thai.TT_KHOA,
            may_trang_thai.TT_CO_PHIEU_SUA,
        )
    },
    TT_VIEC_DANG_CHAY: "Đang chạy",
    TT_VIEC_TAM_DUNG: "Tạm dừng",
    TT_TRONG: "Đang trống",
    TT_CHO_XEP_MAY: "Chờ xếp máy",
    TT_O_NHA_GIA_CONG: "Đang ở nhà gia công",
    TT_CHO_MANG_DI: "Chờ mang đi",
}
NHAN_NHOM = {
    NHOM_CHUA_MAY: "Chưa có máy",
    NHOM_MAY_DA_XOA: "Máy không còn trong danh mục",
    NHOM_GIA_CONG: "Gia công ngoài",
}
NHAN_MAY_DA_XOA = "Máy đã xoá"
NHAN_CHUA_CHON_NCC = "Chưa chọn nhà gia công"
KE_TIEP_TOI_DA = 3
_MOC_XA = datetime(9999, 12, 31)


def _khoa_lich(cv: SanXuatCongViec) -> tuple:
    """Theo giờ bắt đầu kế hoạch; việc chưa có giờ xuống cuối."""
    moc = lich_hien_thi(cv.du_kien_bat_dau)
    return (moc is None, moc or _MOC_XA, cv.id)


def _viec(n: _Nap, cv: SanXuatCongViec, bai_ma: dict[int, str]) -> dict:
    lenh = n.bc.lenh
    return {
        "cong_viec_id": cv.id,
        "ten_buoc": cv.ten_cong_doan,
        "trang_thai": cv.trang_thai,
        "bai_ma": (
            bai_ma.get(cv.bai_ghep_id)
            if cv.bai_ghep_cong_doan_id is not None and cv.bai_ghep_id is not None else None
        ),
        "lsx": [
            {"lsx_id": i, "ma": lenh[i].ma, "ten": lenh[i].ten, "is_rush": bool(lenh[i].is_rush)}
            for i in n.lenh_cua_cv.get(cv.id, [])
        ],
    }


def _san_luong(bc: BoiCanh, cv: SanXuatCongViec) -> dict:
    """Σ `tot` các mẻ của MỘT công việc. Mẻ khác đơn vị với `don_vi_ra` thì KHÔNG cộng: trả từng
    đơn vị (`theo_don_vi`), `tot = None` để giao diện không vẽ thanh."""
    dv = (cv.don_vi_ra or "").strip()
    theo: dict[str, float] = {}
    for b in bc.batch.get(cv.id, []):
        k = (b.don_vi or "").strip()
        theo[k] = theo.get(k, 0.0) + float(b.tot or 0)
    cung = all(k == dv for k in theo)
    return {
        "tot": sum(theo.values()) if cung else None,
        "ke_hoach": float(cv.so_luong_ra) if cv.so_luong_ra is not None else None,
        "don_vi": dv or None,
        "theo_don_vi": (
            [] if cung else [{"don_vi": k or None, "tot": v} for k, v in sorted(theo.items())]
        ),
        "ca_bai": cv.bai_ghep_cong_doan_id is not None,
    }


def _dong(
    *, khoa: str, tinh_trang: str, may_id: int | None = None, ten: str | None = None,
    ngung_dung: bool = False, dang_chay: dict | None = None, dang_chay_them: int = 0,
    san_luong: dict | None = None, ke_hoach_xong: datetime | None = None,
    ke_hoach_bat_dau: datetime | None = None, ke_tiep: list[dict] | None = None,
    ke_tiep_them: int = 0,
) -> dict:
    return {
        "khoa": khoa, "may_id": may_id, "ten": ten, "ngung_dung": ngung_dung,
        "tinh_trang": tinh_trang, "nhan_tinh_trang": NHAN_TINH_TRANG[tinh_trang],
        "dang_chay": dang_chay, "dang_chay_them": dang_chay_them, "san_luong": san_luong,
        "ke_hoach_xong": ke_hoach_xong, "ke_hoach_bat_dau": ke_hoach_bat_dau,
        "ke_tiep": ke_tiep or [], "ke_tiep_them": ke_tiep_them,
    }


def _dong_may(
    n: _Nap, may_id: int, ten: str, ngung_dung: bool, cvs: list[SanXuatCongViec],
    bai_ma: dict[int, str],
) -> dict:
    chay = sorted(
        (cv for cv in cvs if cv.trang_thai in (CV_DANG_CHAY, CV_TAM_DUNG)),
        key=lambda cv: (cv.trang_thai != CV_DANG_CHAY, *_khoa_lich(cv)),
    )
    cho = sorted((cv for cv in cvs if cv.trang_thai == CV_PHAT_HANH), key=_khoa_lich)
    tt = n.tt_may.get(may_id)
    if tt is None:
        if chay and chay[0].trang_thai == CV_DANG_CHAY:
            tt = TT_VIEC_DANG_CHAY
        elif chay:
            tt = TT_VIEC_TAM_DUNG
        else:
            tt = TT_TRONG
    dau = chay[0] if chay else None
    return _dong(
        khoa=f"may:{may_id}", may_id=may_id, ten=ten, ngung_dung=ngung_dung, tinh_trang=tt,
        dang_chay=_viec(n, dau, bai_ma) if dau is not None else None,
        dang_chay_them=max(len(chay) - 1, 0),
        san_luong=_san_luong(n.bc, dau) if dau is not None else None,
        ke_hoach_xong=lich_hien_thi(dau.du_kien_ket_thuc) if dau is not None else None,
        ke_tiep=[_viec(n, cv, bai_ma) for cv in cho[:KE_TIEP_TOI_DA]],
        ke_tiep_them=max(len(cho) - KE_TIEP_TOI_DA, 0),
    )


def _ten_nha_gia_cong(cv: SanXuatCongViec, gcn: dict[int, GiaCongNgoai]) -> str:
    g = gcn.get(cv.gia_cong_ngoai_id) if cv.gia_cong_ngoai_id is not None else None
    if g is not None and g.huy_luc is None and (g.nha_cung_cap_ten or "").strip():
        return g.nha_cung_cap_ten.strip()
    return (cv.nha_cung_cap or "").strip() or NHAN_CHUA_CHON_NCC


def _dong_gia_cong(
    n: _Nap, ten: str, cvs: list[SanXuatCongViec], gcn: dict[int, GiaCongNgoai],
    bai_ma: dict[int, str],
) -> dict:
    cvs = sorted(cvs, key=_khoa_lich)
    da_mang = any(
        (g := gcn.get(cv.gia_cong_ngoai_id)) is not None
        and g.huy_luc is None and g.mang_di_luc is not None
        for cv in cvs
    )
    dau = cvs[0]
    return _dong(
        khoa=f"ncc:{ten}", ten=ten,
        tinh_trang=TT_O_NHA_GIA_CONG if da_mang else TT_CHO_MANG_DI,
        dang_chay=_viec(n, dau, bai_ma), dang_chay_them=len(cvs) - 1,
        ke_hoach_xong=lich_hien_thi(dau.du_kien_ket_thuc),
    )


def theo_may(
    db: Session, *, sale_ids: set[int] | None,
    q: str | None = None, khach_hang_id: int | None = None, bat_thuong: str | None = None,
    bay_gio: datetime | None = None,
) -> dict:
    """`{nhom, may_trong, bat_thuong}` — mỗi máy một dòng, chia nhóm (đặc tả 3.3).

    Có ô tìm/khách hoặc một trong bốn cờ lệnh: chỉ còn dòng có công việc (đang chạy hoặc kế tiếp)
    thuộc lệnh khớp lọc, và không còn dòng "máy đang trống". `may_hong`: chỉ còn máy hỏng.
    `chua_may`: chỉ còn nhóm Chưa có máy."""
    bay_gio = bay_gio or datetime.now(timezone.utc)
    n = _nap(db, sale_ids, bay_gio)
    lenh_chon = _lenh_khop_loc(db, sale_ids, n, q=q, khach_hang_id=khach_hang_id, may_id=None)
    if bat_thuong in CO_LENH:
        co = _lenh_bat_thuong(n, bat_thuong)
        lenh_chon = co if lenh_chon is None else lenh_chon & co

    def khop(cvs: list[SanXuatCongViec]) -> bool:
        if lenh_chon is None:
            return True
        return any(i in lenh_chon for cv in cvs for i in n.lenh_cua_cv.get(cv.id, ()))

    # Hai câu cho CẢ lô, luôn chạy (kể cả tập rỗng) để số câu SQL không đổi theo dữ liệu.
    bai_ma = dict(db.execute(
        select(BaiGhep.id, BaiGhep.ma).where(BaiGhep.id.in_(
            {cv.bai_ghep_id for cv in n.cv_song.values() if cv.bai_ghep_id is not None}
        ))
    ).all())
    gcn = {
        g.id: g for g in db.execute(select(GiaCongNgoai).where(GiaCongNgoai.id.in_(
            {cv.gia_cong_ngoai_id for cv in n.cv_song.values() if cv.gia_cong_ngoai_id}
        ))).scalars()
    }

    chua_may: list[SanXuatCongViec] = []
    gia_cong: dict[str, list[SanXuatCongViec]] = {}
    tren_may: dict[int, list[SanXuatCongViec]] = {}
    for cv in sorted(n.cv_song.values(), key=_khoa_lich):
        if _la_gia_cong(cv):
            gia_cong.setdefault(_ten_nha_gia_cong(cv, gcn), []).append(cv)
        elif _chua_may(cv):
            chua_may.append(cv)
        elif cv.may_id is not None:
            tren_may.setdefault(cv.may_id, []).append(cv)
        # Bước tổ (`loai_buoc = to`) không gắn máy — không thuộc bảng máy.

    nhom: list[dict] = []
    may_trong: list[dict] = []

    if bat_thuong != BT_MAY_HONG:
        dong = [
            _dong(
                khoa=f"cv:{cv.id}", tinh_trang=TT_CHO_XEP_MAY,
                dang_chay=_viec(n, cv, bai_ma),
                ke_hoach_bat_dau=lich_hien_thi(cv.du_kien_bat_dau),
            )
            for cv in chua_may if khop([cv])
        ]
        if dong:
            nhom.append({"loai": NHOM_CHUA_MAY, "ten": NHAN_NHOM[NHOM_CHUA_MAY], "dong": dong})

    if bat_thuong != BT_CHUA_MAY:
        theo_loai: dict[str, list[dict]] = {}
        da_xoa: list[dict] = []
        may_xet = [m for m, mm in n.may.items() if mm.active or m in tren_may]
        may_xet += sorted(m for m in tren_may if m not in n.may)
        for may_id in may_xet:
            m = n.may.get(may_id)
            cvs = tren_may.get(may_id, [])
            dong = _dong_may(
                n, may_id, m.ten if m is not None else NHAN_MAY_DA_XOA,
                bool(m is not None and not m.active), cvs, bai_ma,
            )
            if bat_thuong == BT_MAY_HONG:
                if dong["tinh_trang"] != may_trang_thai.TT_MAY_DUNG or not khop(cvs):
                    continue
            elif lenh_chon is not None:
                if not cvs or not khop(cvs):
                    continue
            elif dong["dang_chay"] is None and not dong["ke_tiep"] and dong["tinh_trang"] == TT_TRONG:
                may_trong.append(dong)
                continue
            if m is None:
                da_xoa.append(dong)
            else:
                theo_loai.setdefault(m.loai_may or "", []).append(dong)
        for loai in sorted(theo_loai):
            nhom.append({"loai": NHOM_MAY, "ten": loai, "dong": theo_loai[loai]})
        if da_xoa:
            nhom.append({"loai": NHOM_MAY_DA_XOA, "ten": NHAN_NHOM[NHOM_MAY_DA_XOA], "dong": da_xoa})

    if bat_thuong not in (BT_MAY_HONG, BT_CHUA_MAY):
        dong = [
            _dong_gia_cong(n, ten, cvs, gcn, bai_ma)
            for ten, cvs in sorted(gia_cong.items()) if khop(cvs)
        ]
        if dong:
            nhom.append({"loai": NHOM_GIA_CONG, "ten": NHAN_NHOM[NHOM_GIA_CONG], "dong": dong})

    return {"nhom": nhom, "may_trong": may_trong, "bat_thuong": dem_bat_thuong(n)}
