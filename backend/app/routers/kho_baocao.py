"""Router — BÁO CÁO KHO (kế toán): sổ nhập-xuất + khóa kỳ (chốt sổ) + export MISA.

docs/spec-bao-cao-kho.md. MODULE quyền RIÊNG `bao_cao_kho` (tách khỏi `kho` ngày 24/09/2026,
mg `0329`): Xem = vào màn + sổ nhập-xuất + NXT + export Excel; ô chi tiết `close_book` = KHOÁ KỲ
(chốt sổ) + tính giá kỳ. Đăng ký TRƯỚC `kho.router` trong main.py vì `/api/kho/khoa-so` là path 1
đoạn sẽ bị `/api/kho/{kho_id}` nuốt nếu khai sau (FastAPI khớp theo thứ tự).
"""
from __future__ import annotations

from collections import Counter
from datetime import date, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

import json

from ..db import get_db
from ..deps import get_authorization_service, require_permission
from ..models.kho_hang import KhoHang
from ..models.stock_lot import StockLot
from ..models.stock_request import StockRequest
from ..models.stock_voucher import (
    VOUCHER_NHAP,
    VOUCHER_POSTED,
    VOUCHER_XUAT,
    StockVoucher,
    StockVoucherLine,
)
from ..models.user import User
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.don_vi_do_repo import DonViDoRepository
from ..repositories.kho_hang_repo import KhoHangRepository
from ..repositories.kho_khoa_so_repo import KhoKhoaSoRepository
from ..repositories.kho_ky_ton_repo import KhoKyTonRepository
from ..repositories.nguon_phieu_kho_repo import NguonPhieu, NguonPhieuKhoRepository
from ..repositories.tim_khong_dau import bo_dau
from ..repositories.user_repo import UserRepository
from ..repositories.vat_lieu_kho_repo import VatLieuKhoRepository
from ..services.kho_gia_goc_service import GiaGocError, chan_chot_khi_chua_gia
from ..services.kho_giay import chuan_kho, co_don_vi_goc, nhan_kho
from ..services.rbac_service import AuthorizationService
from ..services.vat_lieu_kho_service import VatLieuKhoService
from ..schemas.stock import (
    BaoCaoChuyenKhoPage,
    BaoCaoChuyenKhoRow,
    BaoCaoKhoPage,
    BaoCaoKhoRow,
    BaoCaoNXTPage,
    BaoCaoNXTRow,
    KhoaSoKyRow,
    KhoExportLogRow,
    KhoKhoaSoIn,
    KhoKhoaSoRow,
    KyDaTinhRow,
    LuaChonBaoCaoKho,
    LuaChonDem,
    ThanhPhamChuaGiaGocPage,
    TinhGiaKyIn,
)
from ..services import kho_gia_goc_service

router = APIRouter(prefix="/api/kho", tags=["kho-bao-cao"])
# MÀN NÀY LÀ MỘT MODULE RIÊNG từ 24/09/2026 (mg `0329`) — trước đây gác bằng ô CHI TIẾT
# `kho:close_book`, nghĩa là một mục menu không có dòng nào mang tên nó trong ma trận phân quyền.
# Cùng lý do đã tách `bao_cao_cong_no` khỏi hai khoá công nợ (mg 0260).
MODULE = "bao_cao_kho"

Db = Annotated[Session, Depends(get_db)]
Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]
#: Xem báo cáo (sổ nhập-xuất · NXT · chuyển kho · kỳ đã tính · lịch sử export · export Excel).
XemBaoCaoUser = Annotated[User, Depends(require_permission(MODULE, "read"))]
#: KHOÁ KỲ (chốt sổ) + tính giá kỳ — hai việc GHI duy nhất của màn.
CloseBookUser = Annotated[User, Depends(require_permission(MODULE, "close_book"))]

#: Trường TIỀN của từng loại dòng báo cáo → đặt None khi người xem không được thấy giá vốn.
_O_TIEN: dict[str, tuple[str, ...]] = {
    "so": ("don_gia", "thanh_tien"),
    "chuyen": ("don_gia_von", "tien_von"),
    "nxt": ("dau_gt", "nhap_gt", "xuat_gt", "cuoi_gt", "don_gia_bq"),
}


def _thay_gia(authz: AuthorizationService, user: User) -> bool:
    """Ai thấy ĐƠN GIÁ / THÀNH TIỀN trong báo cáo kho: CHỈ người có ô "Xem giá thành" của CHÍNH màn
    này (`bao_cao_kho:view_cost`).

    Xem (`read`) mở CỬA VÀO MÀN — nó không phải giấy phép xem giá vốn: người được vào phải thấy SỐ
    LƯỢNG mà không thấy TIỀN. Trước 05/10/2026 ô xem giá là MỘT cột `kho:view_cost` chung cho mọi
    màn kho; chủ chốt mỗi màn một ô riêng (mg 0370 chép quyền cũ sang)."""
    return authz.can(user, MODULE, "view_cost")


def _an_tien(rows: list, loai: str, cho_xem: bool) -> list:
    """Xoá trắng các ô tiền của `rows` khi `cho_xem` là False. Ghi None chứ KHÔNG ghi 0 — số 0
    là một con số, người đọc sẽ tin là "kỳ này không phát sinh tiền"."""
    if cho_xem:
        return rows
    for r in rows:
        for o in _O_TIEN[loai]:
            setattr(r, o, None)
    return rows


# Ghi sổ lưu mốc UTC (`ghi_so_luc`); nhưng NGÀY HẠCH TOÁN + phân kỳ sổ phải theo NGÀY LÀM VIỆC
# giờ VN (+7). Lấy `.date()` thẳng trên UTC sẽ đẩy phiếu ghi sổ lúc 00:00–07:00 VN về hôm trước
# → lệch ngày hạch toán / rớt khỏi tháng khi lọc. Quy về VN trước khi cắt ngày.
VN_TZ = timezone(timedelta(hours=7))


def _ngay_ghi_so_vn(dt) -> date | None:
    """Ngày ghi sổ theo giờ VN. `ghi_so_luc` là UTC (naive trên SQLite, aware trên Postgres)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(VN_TZ).date()


# --- Truy vấn dòng nhập-xuất (chỉ phiếu ĐÃ GHI SỔ) -----------------------------

def _ngay_moc(v, moc: str) -> date | None:
    """Ngày của phiếu theo MỐC kỳ của thanh lọc (06/10/2026): `ct` = ngày chứng từ (ngày nhập/xuất
    kho ghi trên phiếu — ngày hạch toán, cùng mốc khóa kỳ); `ghi_so` = ngày bấm ghi sổ theo giờ VN."""
    return _ngay_ghi_so_vn(v.ghi_so_luc) if moc == "ghi_so" else v.ngay


def _khop_tim(kim: str, *vals) -> bool:
    return not kim or any(kim in bo_dau(v) for v in vals)


def _report_rows(
    db: Session, *, tu: date | None, den: date | None, kho_id: int | None,
    loai: str | None, q: str | None = None, moc: str = "ct",
) -> list[BaoCaoKhoRow]:
    # `q` = tìm số CT / mã hàng / tên hàng (khớp ô Tìm ở màn, không dấu) → "lọc gì = xuất nấy".
    ql = bo_dau(q)
    stmt = (
        select(StockVoucher, StockVoucherLine, StockRequest, KhoHang, StockLot)
        .join(StockVoucherLine, StockVoucherLine.voucher_id == StockVoucher.id)
        .join(StockRequest, StockRequest.id == StockVoucher.request_id, isouter=True)
        .join(KhoHang, KhoHang.id == StockVoucher.kho_id, isouter=True)
        .join(StockLot, StockLot.id == StockVoucherLine.lot_id, isouter=True)
        .where(
            StockVoucher.trang_thai == VOUCHER_POSTED,
            # ĐIỀU CHUYỂN có chiều "Chuyển kho" RIÊNG (/bao-cao/chuyen-kho) → KHÔNG lẫn vào Sổ
            # Nhập/Xuất (chuẩn kế toán: nội bộ, không nhập-mua/xuất-bán). 3 chiều tách bạch:
            # Nhập kho = nhập thật · Xuất kho = xuất thật · Chuyển kho = điều chuyển nội bộ.
            StockVoucher.dieu_chuyen.is_(False),
        )
    )
    if loai:
        stmt = stmt.where(StockVoucher.loai == loai)
    if kho_id:
        stmt = stmt.where(StockVoucher.kho_id == kho_id)
    stmt = stmt.order_by(StockVoucher.ngay, StockVoucher.id, StockVoucherLine.id)

    # NGÀY HẠCH TOÁN = NGÀY NHẬP/XUẤT KHO trên phiếu (`v.ngay`) — CÙNG mốc với khóa kỳ, nên
    # phiếu bị chặn ở kỳ nào thì cũng nằm đúng kỳ đó trên sổ. Kỳ theo ngày ghi sổ khi `moc`
    # = `ghi_so` (vai kiểm toán: ai bấm lúc nào). Lọc kỳ TRƯỚC rồi mới tra danh mục + nguồn phiếu.
    def trong_ky(v) -> bool:
        d = _ngay_moc(v, moc)
        return not ((tu and (d is None or d < tu)) or (den and (d is None or d > den)))

    results = [r for r in db.execute(stmt).all() if trong_ky(r[0])]
    # Mã / tên / ĐVT mặt hàng tra từ DANH MỤC GỐC theo (hang_loai, hang_id) — bảng `materials` đã bỏ.
    hang_svc = VatLieuKhoService(VatLieuKhoRepository(db), DonViDoRepository(db))
    hang_map = hang_svc.map_theo_cap(
        list({(ln.hang_loai, ln.hang_id) for _v, ln, _req, _kho, _lot in results})
    )
    # ĐVT trên báo cáo hiện TÊN có dấu (tờ · cái · bản kẽm) thay vì MÃ ascii (to · cai · kem) —
    # `mh.don_vi_gia` là MÃ đơn vị; tra danh mục `don_vi_do` để đổi sang tên hiển thị (khớp danh mục).
    dv_ten = {d.ma: d.ten for d in DonViDoRepository(db).all_active()}
    tra_khoa = _TraKyKhoa(db)
    nguon = NguonPhieuKhoRepository(db).tra(
        reqs=list({id(req): req for _v, _ln, req, _k, _l in results if req is not None}.values()),
        dong_yc_ids={ln.request_line_id for _v, ln, _req, _k, _l in results if ln.request_line_id},
        nguoi_ids={v.nguoi_lap_id for v, _ln, _req, _k, _l in results if v.nguoi_lap_id},
    )

    rows: list[BaoCaoKhoRow] = []
    for v, ln, req, kho, lot in results:
        mh = hang_map.get((ln.hang_loai, ln.hang_id))
        # SỐ LƯỢNG · ĐƠN GIÁ · THÀNH TIỀN đều theo ĐƠN VỊ GỐC — khớp tồn kho + ĐVT danh mục và
        # khớp cách tính giá vốn phiếu (`cost_of`): NHẬP quy đơn giá về ĐV gốc, XUẤT lấy giá vốn
        # lô (vốn đã theo ĐV gốc) × `sl_goc`. Nhân nhầm `so_luong` là lệch đúng bằng hệ số quy đổi.
        qty = float(ln.sl_goc or 0)
        if v.loai == VOUCHER_NHAP:
            so = float(ln.so_luong or 0)
            price = round(float(ln.don_gia) * so / qty) if (qty and ln.don_gia is not None) else None
        else:
            price = int(lot.don_gia_nhap) if (lot is not None and lot.don_gia_nhap is not None) else None
        row = BaoCaoKhoRow(
            voucher_id=v.id,
            ngay_ghi_so=_ngay_ghi_so_vn(v.ghi_so_luc),   # vai KIỂM TOÁN (ai bấm lúc nào)
            ngay_ct=v.ngay,
            so_ct=v.ma,
            loai=v.loai,
            loai_kho=req.loai_kho if req else None,
            ma_hang=getattr(mh, "ma", None),
            ten_hang=getattr(mh, "ten", None),
            # Dòng giấy / vật tư đếm theo ĐƠN VỊ GỐC của chính dòng (đơn vị đã khai); hàng khác đơn vị
            # gốc của mã.
            dvt=(dv_ten.get(ln.don_vi_goc, ln.don_vi_goc)
                 if (co_don_vi_goc(ln.hang_loai) and ln.don_vi_goc) else
                 dv_ten.get(getattr(mh, "don_vi_gia", None), getattr(mh, "don_vi_gia", None))),
            don_vi_goc=ln.don_vi_goc or "", kho_rong=int(ln.kho_rong or 0), kho_dai=int(ln.kho_dai or 0),
            so_luong=qty,
            don_gia=price,
            thanh_tien=round(price * qty) if price is not None else None,
            kho_id=v.kho_id,
            kho_ten=getattr(kho, "ten", None),
            han_su_dung=getattr(lot, "hsd", None),  # NHẬP: lô vừa tạo · XUẤT: lô bị xuất
            dieu_chuyen=bool(getattr(v, "dieu_chuyen", False)),
            hang_loai=ln.hang_loai,
            nhom_hang=_nhom_hang(ln.hang_loai, mh),
            ky_khoa=tra_khoa.ten(v.kho_id, v.ngay),
            **_nguon_dong(v, ln, req, nguon),
        )
        if not _khop_tim(ql, row.so_ct, row.ma_hang, row.ten_hang, row.lenh, row.don_hang,
                         row.khach_hang, row.nha_cung_cap):
            continue
        rows.append(row)
    return rows


# --- Nhóm hàng + nguồn phiếu (11/10/2026) ----------------------------------------------------------
#
# Thành phẩm nằm chung danh mục Vật tư khác (cờ `la_thanh_pham`), nên "Loại hàng" của báo cáo tách
# ba nhóm: Giấy · Vật tư · Thành phẩm. Lý do nhập/xuất suy từ cột NGUỒN của yêu cầu kho (đợt mua,
# công đoạn KCS, gia công ngoài, trả vật tư thừa, chuyến giao hàng, lệnh của dòng).

_NHAN_LY_DO = {
    "nhap_mua": "Nhập mua hàng",
    "nhap_thanh_pham": "Nhập thành phẩm từ sản xuất",
    "nhap_gia_cong": "Nhập hàng gia công ngoài",
    "nhap_tra_vat_tu": "Nhập lại vật tư thừa",
    "nhap_khac": "Nhập khác",
    "xuat_giao_khach": "Xuất giao khách",
    "xuat_san_xuat": "Xuất cho sản xuất",
    "xuat_gia_cong": "Xuất cho gia công ngoài",
    "xuat_khac": "Xuất khác",
}


def _nhom_hang(hang_loai: str | None, mh) -> str | None:
    if hang_loai == "vat_tu" and getattr(mh, "la_thanh_pham", False):
        return "thanh_pham"
    return hang_loai


def _ly_do(v, req, co_lenh: bool) -> str:
    nhap = v.loai == VOUCHER_NHAP
    if req is not None:
        if nhap:
            if req.purchase_delivery_id:
                return "nhap_mua"
            if req.san_xuat_cong_viec_id:
                return "nhap_thanh_pham"
            if req.gia_cong_ngoai_id:
                return "nhap_gia_cong"
            if req.vat_tu_tra_cong_viec_id:
                return "nhap_tra_vat_tu"
        else:
            if req.delivery_trip_id:
                return "xuat_giao_khach"
            if req.gia_cong_ngoai_id:
                return "xuat_gia_cong"
            if co_lenh:
                return "xuat_san_xuat"
    return "nhap_khac" if nhap else "xuat_khac"


def _nguon_dong(v, ln, req, n: NguonPhieu) -> dict:
    """Các cột nguồn của một dòng phiếu: lý do, lệnh, đơn, khách, NCC, bộ phận, người lập…"""
    gcn = n.gia_cong.get(req.gia_cong_ngoai_id) if req is not None and req.gia_cong_ngoai_id else None
    lsx_id = n.lsx_cua_dong.get(ln.request_line_id) or (gcn[1] if gcn else None)
    lsx = n.lsx.get(lsx_id) if lsx_id else None
    chuyen = n.chuyen_don.get(req.delivery_trip_id) if req is not None and req.delivery_trip_id else None
    don_id = (lsx[1] if lsx else None) or (chuyen[0] if chuyen else None)
    don = n.don.get(don_id) if don_id else None
    khach_id = (don[1] if don else None) or (chuyen[1] if chuyen else None)
    ly_do = _ly_do(v, req, lsx is not None)
    ncc = (n.ncc_dot_mua.get(req.purchase_delivery_id) if req is not None and req.purchase_delivery_id
           else None) or (gcn[0] or None if gcn else None)
    return dict(
        ly_do=ly_do,
        ly_do_ten=_NHAN_LY_DO[ly_do],
        lenh=lsx[0] if lsx else None,
        don_hang=don[0] if don else None,
        khach_hang=n.khach.get(khach_id) if khach_id else None,
        nha_cung_cap=ncc,
        bo_phan=n.bo_phan.get(req.bo_phan_id) if req is not None and req.bo_phan_id else None,
        ma_yeu_cau=req.ma if req is not None else None,
        nguoi_giao_nhan=v.nguoi_giao_nhan or None,
        nguoi_lap=n.nguoi.get(v.nguoi_lap_id) if v.nguoi_lap_id else None,
        dien_giai=v.ghi_chu or (req.ghi_chu if req is not None else None),
    )


#: Mốc kỳ của Sổ kho trên thanh lọc chung: ngày chứng từ (nhập/xuất kho) hoặc ngày ghi sổ.
_MOC_SO = "^(ct|ghi_so)$"


# --- Nút "Lọc" của các bảng báo cáo (11/10/2026): điều kiện THUỘC TÍNH, lọc + đếm ở máy chủ ----------
#
# Cùng một bộ cho Chi tiết phiếu (nhập · xuất · chuyển) và Nhập-Xuất-Tồn, để màn và file Excel lọc
# giống hệt nhau. Giá trị chọn được + số dòng (`lua_chon`) đếm TRƯỚC khi áp các điều kiện này — chọn
# "Giấy" thì menu "Mặt hàng" vẫn bày đủ hàng của kỳ, không tự co lại mất lựa chọn.

_NHAN_LOAI = {"giay": "Giấy", "vat_tu": "Vật tư", "thanh_pham": "Thành phẩm"}
_NHAN_LOAI_PHIEU = {"NHAP": "Phiếu nhập", "XUAT": "Phiếu xuất"}
#: Điều kiện chọn nhiều so thẳng với một thuộc tính chữ của dòng Chi tiết phiếu: (tên điều kiện, thuộc tính).
#: Chỉ giữ cái người ta thật sự cắt báo cáo theo (11/10/2026) — lệnh, bộ phận, người lập… là CỘT để đọc,
#: cần tìm thì gõ ô Tìm; khổ giấy, ĐVT, kỳ khóa sổ, giá gốc thành phẩm đã bỏ khỏi menu Lọc.
_LOC_THEO_COT = (("loai_phieu", "loai"), ("ly_do", "ly_do"), ("khach_hang", "khach_hang"),
                 ("nha_cung_cap", "nha_cung_cap"))
_NHAN_PHAT_SINH = {"nhap": "Có nhập trong kỳ", "xuat": "Có xuất trong kỳ", "khong": "Không phát sinh"}
_NHAN_TON = {"con": "Còn tồn cuối kỳ", "het": "Hết tồn", "am": "Tồn âm"}
_EPS = 1e-9


class LocThuocTinh:
    """Điều kiện thuộc tính chung (chọn nhiều — khớp một trong các giá trị là giữ)."""

    def __init__(
        self,
        hang_loai: list[str] | None = Query(default=None, description="giay | vat_tu | thanh_pham"),
        mat_hang: list[str] | None = Query(default=None, description="Mã hàng"),
        phat_sinh: list[str] | None = Query(default=None, description="nhap | xuat | khong (chỉ N-X-T)"),
        ton: list[str] | None = Query(default=None, description="con | het | am (chỉ N-X-T)"),
        loai_phieu: list[str] | None = Query(default=None, description="NHAP | XUAT (Chi tiết phiếu)"),
        ly_do: list[str] | None = Query(default=None),
        khach_hang: list[str] | None = Query(default=None),
        nha_cung_cap: list[str] | None = Query(default=None),
    ) -> None:
        self.hang_loai = set(hang_loai or [])
        self.mat_hang = set(mat_hang or [])
        self.phat_sinh = set(phat_sinh or [])
        self.ton = set(ton or [])
        self.theo_cot = {k: set(v) for k, v in (
            ("loai_phieu", loai_phieu), ("ly_do", ly_do), ("khach_hang", khach_hang),
            ("nha_cung_cap", nha_cung_cap)) if v}


LocTT = Annotated[LocThuocTinh, Depends()]


def _phat_sinh_cua(r) -> set[str]:
    ps = set()
    if r.nhap_sl > _EPS:
        ps.add("nhap")
    if r.xuat_sl > _EPS:
        ps.add("xuat")
    return ps or {"khong"}


def _ton_cua(r) -> str:
    return "con" if r.cuoi_sl > _EPS else "am" if r.cuoi_sl < -_EPS else "het"


def _nhom_cua(r) -> str | None:
    return getattr(r, "nhom_hang", None) or r.hang_loai


def _khop_thuoc_tinh(r, loc: LocThuocTinh) -> bool:
    if loc.hang_loai and _nhom_cua(r) not in loc.hang_loai:
        return False
    for khoa, thuoc_tinh in _LOC_THEO_COT:
        chon = loc.theo_cot.get(khoa)
        if chon and getattr(r, thuoc_tinh, None) not in chon:
            return False
    if loc.mat_hang and (r.ma_hang or "") not in loc.mat_hang:
        return False
    if loc.phat_sinh and not (_phat_sinh_cua(r) & loc.phat_sinh):
        return False
    if loc.ton and _ton_cua(r) not in loc.ton:
        return False
    return True


def _lua_chon(rows: list, *, nxt: bool = False) -> LuaChonBaoCaoKho:
    """Giá trị + số dòng cho menu Lọc, đếm trên `rows` (chưa áp điều kiện thuộc tính)."""
    dem: dict[str, Counter] = {k: Counter() for k in ("hang_loai", "mat_hang", "phat_sinh", "ton",
                                                      *(k for k, _a in _LOC_THEO_COT))}
    ten_hang: dict[str, str] = {}
    for r in rows:
        if _nhom_cua(r):
            dem["hang_loai"][_nhom_cua(r)] += 1
        for khoa, thuoc_tinh in _LOC_THEO_COT:
            if (v := getattr(r, thuoc_tinh, None)):
                dem[khoa][v] += 1
        if r.ma_hang:
            dem["mat_hang"][r.ma_hang] += 1
            ten_hang.setdefault(r.ma_hang, r.ten_hang or r.ma_hang)
        if nxt:
            for p in _phat_sinh_cua(r):
                dem["phat_sinh"][p] += 1
            dem["ton"][_ton_cua(r)] += 1

    def ds(khoa: str, nhan, *, thu_tu: list[str] | None = None) -> list[LuaChonDem]:
        c = dem[khoa]
        keys = [v for v in thu_tu if v in c] if thu_tu else sorted(c, key=lambda v: bo_dau(nhan(v)))
        return [LuaChonDem(value=v, nhan=nhan(v), so=c[v]) for v in keys]

    return LuaChonBaoCaoKho(
        hang_loai=ds("hang_loai", lambda v: _NHAN_LOAI.get(v, v), thu_tu=list(_NHAN_LOAI)),
        mat_hang=ds("mat_hang", lambda v: ten_hang.get(v, v)),
        phat_sinh=ds("phat_sinh", lambda v: _NHAN_PHAT_SINH[v], thu_tu=list(_NHAN_PHAT_SINH)),
        ton=ds("ton", lambda v: _NHAN_TON[v], thu_tu=list(_NHAN_TON)),
        # Báo cáo nhập-xuất không cho chọn chiều (đã gộp một bảng) thì dòng chuyển kho không có `loai`.
        loai_phieu=ds("loai_phieu", lambda v: _NHAN_LOAI_PHIEU.get(v, v), thu_tu=list(_NHAN_LOAI_PHIEU)),
        ly_do=ds("ly_do", lambda v: _NHAN_LY_DO.get(v, v), thu_tu=list(_NHAN_LY_DO)),
        khach_hang=ds("khach_hang", lambda v: v),
        nha_cung_cap=ds("nha_cung_cap", lambda v: v),
    )


class _TraKyKhoa:
    """Tra kỳ ĐÃ KHÓA SỔ phủ (kho, ngày) cho cả loạt dòng với MỘT lần đọc DB. Luật như `is_locked`:
    bản ghi khóa/mở MỚI NHẤT phủ ngày đó quyết định; bản ghi toàn kho (kho_id NULL) phủ mọi kho."""

    def __init__(self, db: Session) -> None:
        self.ds = KhoKhoaSoRepository(db).tat_ca()

    def ten(self, kho_id: int | None, d: date | None) -> str | None:
        if d is None:
            return None
        for l in self.ds:
            if l.tu_ngay <= d <= l.den_ngay and (l.kho_id is None or l.kho_id == kho_id):
                if l.hanh_dong != "khoa":
                    return None
                return (l.ten or "").strip() or f"{_fmt_date(l.tu_ngay)} – {_fmt_date(l.den_ngay)}"
        return None


def _loc_so_va_trang(
    rows: list, *, cho_xem: bool, price_attr: str, total_attr: str,
    sl_from, sl_to, dg_from, dg_to, tt_from, tt_to, page: int | None, size: int,
) -> tuple[list, int, int | None]:
    """Lọc khoảng số (SL · Đơn giá · Thành tiền) + cắt trang ở MÁY CHỦ (06/10/2026 — trước đó màn
    tải cả sổ rồi lọc/cắt trong trình duyệt). Trả (dòng của trang, tổng số dòng, tổng tiền mọi dòng).

    Người KHÔNG có ô xem giá: bỏ qua khoảng Đơn giá / Thành tiền — lọc theo con số họ không được
    thấy là lộ tiền qua đường vòng (cùng luật màn Phiếu kho). `page` None = trả hết (tab Tổng quan)."""
    if not cho_xem:
        dg_from = dg_to = tt_from = tt_to = None
    rows = [r for r in rows if _passes_funnel(
        r, sl_from=sl_from, sl_to=sl_to, dg_from=dg_from, dg_to=dg_to, tt_from=tt_from,
        tt_to=tt_to, price_attr=price_attr, total_attr=total_attr)]
    tong = sum(getattr(r, total_attr) or 0 for r in rows) if cho_xem else None
    if page is not None:
        return rows[(page - 1) * size: page * size], len(rows), tong
    return rows, len(rows), tong


@router.get("/bao-cao/dong", response_model=BaoCaoKhoPage)
def bao_cao_dong(
    db: Db,
    authz: Authz,
    user: XemBaoCaoUser,
    loc: LocTT,
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query("ct", pattern=_MOC_SO),
    kho_id: int | None = Query(default=None),
    loai: str | None = Query(default=None, pattern="^(NHAP|XUAT)$"),
    q: str | None = Query(default=None, max_length=100),
    sl_from: float | None = Query(default=None),
    sl_to: float | None = Query(default=None),
    dg_from: float | None = Query(default=None),
    dg_to: float | None = Query(default=None),
    tt_from: float | None = Query(default=None),
    tt_to: float | None = Query(default=None),
    page: int | None = Query(default=None, ge=1),
    size: int = Query(default=20, ge=1, le=200),
) -> BaoCaoKhoPage:
    cho_xem = _thay_gia(authz, user)
    rows = _an_tien(
        _report_rows(db, tu=tu_ngay, den=den_ngay, kho_id=kho_id, loai=loai, q=q, moc=moc),
        "so", cho_xem,
    )
    lua_chon = _lua_chon(rows)
    rows = [r for r in rows if _khop_thuoc_tinh(r, loc)]
    items, total, tong = _loc_so_va_trang(
        rows, cho_xem=cho_xem, price_attr="don_gia", total_attr="thanh_tien",
        sl_from=sl_from, sl_to=sl_to, dg_from=dg_from, dg_to=dg_to, tt_from=tt_from, tt_to=tt_to,
        page=page, size=size)
    return BaoCaoKhoPage(items=items, total=total, tong_tien=tong, lua_chon=lua_chon)


@router.get("/bao-cao/thanh-pham-chua-gia-goc", response_model=ThanhPhamChuaGiaGocPage)
def thanh_pham_chua_gia_goc(
    db: Db,
    _: Annotated[User, Depends(require_permission(MODULE, "view_cost"))],
    q: str | None = Query(default=None, max_length=100),
    gia: str = Query(default="chua", pattern="^(chua|co|tat_ca)$"),
    tu: date | None = Query(default=None),
    den: date | None = Query(default=None),
    kho_id: list[int] | None = Query(default=None),
    khach_hang_id: list[int] | None = Query(default=None),
    hang_id: list[int] | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
) -> ThanhPhamChuaGiaGocPage:
    """Lô gốc thành phẩm nhập từ KCS ở MỌI kho — mặc định chỉ lô còn giá gốc 0 đ (`gia=chua`). Nút
    Lọc: khoảng ngày nhập (`tu`/`den`), kho nhập, khách hàng, mặt hàng (chọn nhiều). Phân trang máy chủ."""
    try:
        return ThanhPhamChuaGiaGocPage(**kho_gia_goc_service.ds_chua_gia_goc(
            db, q=q, gia=gia, page=page, size=size,
            tu_ngay=tu, den_ngay=den, kho_id=kho_id, khach_hang_id=khach_hang_id, hang_id=hang_id))
    except kho_gia_goc_service.GiaGocError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None


# --- Điều chuyển kho: 1 dòng/mặt hàng (Xuất tại kho → Nhập tại kho) --------------

def _chuyen_kho_rows(
    db: Session, *, tu: date | None, den: date | None, kho_id: int | None, q: str | None = None,
    moc: str = "ct",
) -> list[BaoCaoChuyenKhoRow]:
    """Dòng điều chuyển ĐÃ GHI SỔ: mỗi dòng phiếu NHẬP đích (đại diện điều chuyển) → gộp kho nguồn
    (Xuất tại kho) + kho đích (Nhập tại kho) trên cùng 1 dòng, giá vốn chốt từ nguồn."""
    ql = bo_dau(q)
    stmt = (
        select(StockVoucher, StockVoucherLine, StockRequest, KhoHang)
        .join(StockVoucherLine, StockVoucherLine.voucher_id == StockVoucher.id)
        .join(StockRequest, StockRequest.id == StockVoucher.request_id, isouter=True)
        .join(KhoHang, KhoHang.id == StockVoucher.kho_id, isouter=True)  # kho ĐÍCH (nhập về)
        .where(
            StockVoucher.trang_thai == VOUCHER_POSTED,
            StockVoucher.dieu_chuyen.is_(True),
            StockVoucher.loai == VOUCHER_NHAP,  # vế NHẬP đích = đại diện cho cả điều chuyển
        )
        .order_by(StockVoucher.ngay, StockVoucher.id, StockVoucherLine.id)
    )
    results = db.execute(stmt).all()
    # Tên kho NGUỒN (Xuất tại kho) tra từ `stock_requests.kho_nguon_id` — 1 lượt, tránh N+1.
    kho_repo = KhoHangRepository(db)
    nguon_map = {
        kid: getattr(kho_repo.get(kid), "ten", None)
        for kid in {req.kho_nguon_id for _v, _ln, req, _k in results if req and req.kho_nguon_id}
    }
    hang_svc = VatLieuKhoService(VatLieuKhoRepository(db), DonViDoRepository(db))
    hang_map = hang_svc.map_theo_cap(
        list({(ln.hang_loai, ln.hang_id) for _v, ln, _req, _k in results})
    )
    dv_ten = {d.ma: d.ten for d in DonViDoRepository(db).all_active()}
    tra_khoa = _TraKyKhoa(db)

    rows: list[BaoCaoChuyenKhoRow] = []
    for v, ln, req, kho in results:
        mh = hang_map.get((ln.hang_loai, ln.hang_id))
        d = _ngay_moc(v, moc)   # mặc định NGÀY HẠCH TOÁN (ngày nhập/xuất kho) — cùng mốc khóa kỳ
        if tu and (d is None or d < tu):
            continue
        if den and (d is None or d > den):
            continue
        nguon_id = getattr(req, "kho_nguon_id", None) if req else None
        # Lọc theo kho: giữ điều chuyển LIÊN QUAN kho này (xuất khỏi hoặc nhập vào).
        if kho_id and kho_id not in (v.kho_id, nguon_id):
            continue
        # SL · đơn giá vốn theo ĐƠN VỊ GỐC (khớp tồn + cách tính nhập): don_gia quy về đv gốc.
        qty = float(ln.sl_goc or 0)
        so = float(ln.so_luong or 0)
        price = round(float(ln.don_gia) * so / qty) if (qty and ln.don_gia is not None) else None
        row = BaoCaoChuyenKhoRow(
            voucher_id=v.id,
            ngay_ghi_so=_ngay_ghi_so_vn(v.ghi_so_luc),   # vai KIỂM TOÁN (ai bấm lúc nào)
            ngay_ct=v.ngay,
            so_ct=v.ma,
            ma_hang=getattr(mh, "ma", None),
            ten_hang=getattr(mh, "ten", None),
            dvt=dv_ten.get(getattr(mh, "don_vi_gia", None), getattr(mh, "don_vi_gia", None)),
            so_luong=qty,
            don_gia_von=price,
            tien_von=round(price * qty) if price is not None else None,
            kho_xuat_ten=nguon_map.get(nguon_id),
            kho_nhap_ten=getattr(kho, "ten", None),
            kho_xuat_id=nguon_id,       # kho nguồn — cho FE tô kỳ đã khóa
            kho_nhap_id=v.kho_id,       # kho đích (phiếu nhập đích ghi sổ ở đây)
            dien_giai=v.ghi_chu or (req.ghi_chu if req else None),
            hang_loai=ln.hang_loai,
            nhom_hang=_nhom_hang(ln.hang_loai, mh),
            ky_khoa=tra_khoa.ten(v.kho_id, v.ngay) or tra_khoa.ten(nguon_id, v.ngay),
        )
        if not _khop_tim(ql, row.so_ct, row.ma_hang, row.ten_hang):
            continue
        rows.append(row)
    return rows


@router.get("/bao-cao/chuyen-kho", response_model=BaoCaoChuyenKhoPage)
def bao_cao_chuyen_kho(
    db: Db,
    authz: Authz,
    user: XemBaoCaoUser,
    loc: LocTT,
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query("ct", pattern=_MOC_SO),
    kho_id: int | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    sl_from: float | None = Query(default=None),
    sl_to: float | None = Query(default=None),
    dg_from: float | None = Query(default=None),
    dg_to: float | None = Query(default=None),
    tt_from: float | None = Query(default=None),
    tt_to: float | None = Query(default=None),
    page: int | None = Query(default=None, ge=1),
    size: int = Query(default=20, ge=1, le=200),
) -> BaoCaoChuyenKhoPage:
    cho_xem = _thay_gia(authz, user)
    rows = _an_tien(
        _chuyen_kho_rows(db, tu=tu_ngay, den=den_ngay, kho_id=kho_id, q=q, moc=moc),
        "chuyen", cho_xem,
    )
    lua_chon = _lua_chon(rows)
    rows = [r for r in rows if _khop_thuoc_tinh(r, loc)]
    items, total, tong = _loc_so_va_trang(
        rows, cho_xem=cho_xem, price_attr="don_gia_von", total_attr="tien_von",
        sl_from=sl_from, sl_to=sl_to, dg_from=dg_from, dg_to=dg_to, tt_from=tt_from, tt_to=tt_to,
        page=page, size=size)
    return BaoCaoChuyenKhoPage(items=items, total=total, tong_tien=tong, lua_chon=lua_chon)


# --- Nhập-Xuất-Tồn theo kỳ (bình quân gia quyền cuối kỳ) — kiểu MISA "Tính giá kỳ" ------------
#
# LỚP BÁO CÁO — KHÔNG đụng engine giá vốn (kho vẫn tính đích danh per-lô). Định giá LẠI theo BÌNH
# QUÂN GIA QUYỀN CUỐI KỲ:
#   Đơn giá BQ = (GT đầu kỳ + GT nhập) / (SL đầu kỳ + SL nhập)
#   GT xuất    = BQ × SL xuất       ·   GT cuối = GT đầu + GT nhập − GT xuất   (SL tương tự)
#
# ĐẦU KỲ = CUỐI KỲ TRƯỚC, đọc từ SNAPSHOT `kho_ky_ton` (chốt lúc bấm "Tính giá kỳ") → nối chuỗi
# CHÍNH XÁC từng kỳ. Chưa có snapshot kỳ trước (kỳ đầu tiên) → đầu kỳ dựng từ luỹ kế trước `tu`
# (định giá BQ gộp lịch sử trước — chỉ dùng cho lần bootstrap). SL khớp tồn thật (Σ nhập − Σ xuất);
# GT là bản dựng theo BQ. BAO GỒM điều chuyển (nhập/xuất thật của từng kho).

def _kho_nxt(ln) -> tuple[int, int, str]:
    """(rộng, dài, đơn vị gốc) của dòng phiếu trong N-X-T: giấy tách dòng theo khổ + đơn vị gốc, vật tư
    theo đơn vị gốc (cùng khoá tồn — tờ với kg, thùng với kg khác thang nên không bao giờ chung một
    dòng); hàng khác (0, 0, "") gom theo mã."""
    if ln.hang_loai == "giay":
        kr, kd = chuan_kho(ln.kho_rong, ln.kho_dai)
        return (kr, kd, (ln.don_vi_goc or "").strip().lower())
    if co_don_vi_goc(ln.hang_loai):
        return (0, 0, (ln.don_vi_goc or "").strip().lower())
    return (0, 0, "")


def _nxt_compute(
    db: Session, *, tu: date, den: date, kho_ids: list[int] | None,
) -> dict[tuple, dict]:
    """Tính N-X-T bình quân cho từng (kho, hàng) trong [tu, den]. Đầu kỳ đọc snapshot kỳ trước;
    fold thêm chuyển động nằm GIỮA snapshot và `tu` (nếu có 'kẽ hở' chưa chốt). Trả dict[key]→số."""
    snap_map = KhoKyTonRepository(db).latest_before_map(tu, kho_ids)

    stmt = (
        select(StockVoucher, StockVoucherLine)
        .join(StockVoucherLine, StockVoucherLine.voucher_id == StockVoucher.id)
        .where(StockVoucher.trang_thai == VOUCHER_POSTED)
    )
    if kho_ids:
        stmt = stmt.where(StockVoucher.kho_id.in_(kho_ids))
    results = db.execute(stmt).all()

    class _Acc:
        __slots__ = ("gap_nhap_sl", "gap_nhap_gt", "gap_xuat_sl",
                     "nhap_sl", "nhap_gt", "xuat_sl")

        def __init__(self):
            self.gap_nhap_sl = self.gap_nhap_gt = self.gap_xuat_sl = 0.0
            self.nhap_sl = self.nhap_gt = self.xuat_sl = 0.0

    # Mọi key cần xét = key có snapshot ĐẦU KỲ ∪ key có chuyển động.
    acc: dict[tuple, _Acc] = {k: _Acc() for k in snap_map}
    for v, ln in results:
        d = v.ngay        # NGÀY HẠCH TOÁN (ngày nhập/xuất kho) — cùng mốc với khóa kỳ
        if d is None or d > den:
            continue
        key = (v.kho_id, ln.hang_loai, ln.hang_id, *_kho_nxt(ln))
        snap = snap_map.get(key)
        # Chuyển động ĐÃ nằm trong snapshot đầu kỳ (d ≤ ngày chốt snapshot) → bỏ, khỏi đếm 2 lần.
        if snap is not None and d <= snap.den_ngay:
            continue
        a = acc.get(key)
        if a is None:
            a = acc[key] = _Acc()
        sl = float(ln.sl_goc or 0)
        gt = round(float(ln.don_gia or 0) * float(ln.so_luong or 0)) if v.loai == VOUCHER_NHAP else 0
        trong_ky = d >= tu   # d ≤ den đã lọc ở trên; d < tu → "kẽ hở" trước kỳ
        if v.loai == VOUCHER_NHAP:
            if trong_ky:
                a.nhap_sl += sl
                a.nhap_gt += gt
            else:
                a.gap_nhap_sl += sl
                a.gap_nhap_gt += gt
        else:  # XUẤT
            if trong_ky:
                a.xuat_sl += sl
            else:
                a.gap_xuat_sl += sl

    out: dict[tuple, dict] = {}
    for key, a in acc.items():
        snap = snap_map.get(key)
        carry_sl = float(snap.sl_cuoi) if snap else 0.0
        carry_gt = int(snap.gt_cuoi) if snap else 0
        # Fold "kẽ hở" (snapshot → tu) vào đầu kỳ: định giá BQ gộp rồi trừ phần xuất kẽ hở.
        if a.gap_nhap_sl or a.gap_xuat_sl or a.gap_nhap_gt:
            mau_gap = carry_sl + a.gap_nhap_sl
            bq_gap = ((carry_gt + a.gap_nhap_gt) / mau_gap) if mau_gap > 0 else 0.0
            dau_sl = carry_sl + a.gap_nhap_sl - a.gap_xuat_sl
            dau_gt = round(carry_gt + a.gap_nhap_gt - bq_gap * a.gap_xuat_sl)
        else:
            dau_sl, dau_gt = carry_sl, carry_gt
        mau = dau_sl + a.nhap_sl
        bq = ((dau_gt + a.nhap_gt) / mau) if mau > 0 else 0.0
        xuat_gt = round(bq * a.xuat_sl)
        out[key] = dict(
            dau_sl=dau_sl, dau_gt=dau_gt,
            nhap_sl=a.nhap_sl, nhap_gt=a.nhap_gt,
            xuat_sl=a.xuat_sl, xuat_gt=xuat_gt,
            cuoi_sl=dau_sl + a.nhap_sl - a.xuat_sl,
            cuoi_gt=dau_gt + a.nhap_gt - xuat_gt,
            don_gia_bq=round(bq, 4) if mau > 0 else None,
        )
    return out


def _nxt_rows(
    db: Session, *, tu: date, den: date, kho_id: int | None, q: str | None = None,
) -> list[BaoCaoNXTRow]:
    ql = bo_dau(q)
    kho_ids = [kho_id] if kho_id else None
    comp = _nxt_compute(db, tu=tu, den=den, kho_ids=kho_ids)

    hang_svc = VatLieuKhoService(VatLieuKhoRepository(db), DonViDoRepository(db))
    hang_map = hang_svc.map_theo_cap(list({(k[1], k[2]) for k in comp}))
    dv_ten = {d.ma: d.ten for d in DonViDoRepository(db).all_active()}
    kho_repo = KhoHangRepository(db)
    kho_ten = {kid: getattr(kho_repo.get(kid), "ten", None) for kid in {k[0] for k in comp}}

    rows: list[BaoCaoNXTRow] = []
    for (kid, hloai, hid, kr, kd, goc), c in comp.items():
        # Bỏ dòng RỖNG hoàn toàn (không tồn đầu, không phát sinh).
        if (abs(c["dau_sl"]) < 1e-9 and abs(c["nhap_sl"]) < 1e-9 and abs(c["xuat_sl"]) < 1e-9
                and c["dau_gt"] == 0):
            continue
        mh = hang_map.get((hloai, hid))
        nhom = _nhom_hang(hloai, mh)
        row = BaoCaoNXTRow(
            kho_id=kid, kho_ten=kho_ten.get(kid),
            hang_loai=hloai, hang_id=hid,
            ma_hang=getattr(mh, "ma", None), ten_hang=getattr(mh, "ten", None),
            hang_nhom=_NHAN_LOAI.get(nhom or "", "Vật tư"), nhom_hang=nhom,
            # Dòng giấy / vật tư đếm theo đơn vị gốc của khoá (đơn vị đã khai); hàng khác đơn vị gốc của mã.
            dvt=(dv_ten.get(goc, goc) if goc else
                 dv_ten.get(getattr(mh, "don_vi_gia", None), getattr(mh, "don_vi_gia", None))),
            kho_rong=kr, kho_dai=kd, don_vi_goc=goc,
            dau_sl=c["dau_sl"], dau_gt=c["dau_gt"],
            nhap_sl=c["nhap_sl"], nhap_gt=c["nhap_gt"],
            xuat_sl=c["xuat_sl"], xuat_gt=c["xuat_gt"],
            cuoi_sl=c["cuoi_sl"], cuoi_gt=c["cuoi_gt"],
            don_gia_bq=round(c["don_gia_bq"], 2) if c["don_gia_bq"] is not None else None,
        )
        if not _khop_tim(ql, row.ma_hang, row.ten_hang):
            continue
        rows.append(row)
    rows.sort(key=lambda r: ((r.kho_ten or "").lower(), (r.ten_hang or "").lower(),
                             r.kho_rong, r.kho_dai, r.don_vi_goc))
    return rows


def _scope_kho_ids(db: Session, kho_id: int | None, tu: date, den: date) -> list[int] | None:
    """Kho trong phạm vi 'Tính giá kỳ': 1 kho, hoặc MỌI kho (trừ kho được miễn trong khoảng — nếu
    kỳ toàn kho có kho mở riêng). None = không lọc (mọi kho)."""
    if kho_id is not None:
        return [kho_id]
    mien_tru = set(KhoKhoaSoRepository(db).exempted_khos(tu, den))
    all_ids = [r for r in db.execute(select(KhoHang.id)).scalars()]
    ids = [i for i in all_ids if i not in mien_tru]
    return ids or None


@router.get("/bao-cao/nxt", response_model=BaoCaoNXTPage)
def bao_cao_nxt(
    db: Db,
    authz: Authz,
    user: XemBaoCaoUser,
    loc: LocTT,
    tu: date = Query(...),
    den: date = Query(...),
    kho_id: int | None = Query(default=None),
    q: str | None = Query(default=None),
) -> BaoCaoNXTPage:
    """Báo cáo N-X-T theo kỳ (bình quân gia quyền cuối kỳ). Đầu kỳ = snapshot kỳ trước ("Tính giá
    kỳ"). Kỳ chưa tính → hiện TẠM TÍNH (da_tinh=false). Chỉ kế toán kho (`close_book`)."""
    rows = _an_tien(_nxt_rows(db, tu=tu, den=den, kho_id=kho_id, q=q),
                    "nxt", _thay_gia(authz, user))
    lua_chon = _lua_chon(rows, nxt=True)
    rows = [r for r in rows if _khop_thuoc_tinh(r, loc)]
    kho_ids = [kho_id] if kho_id else None
    ky_repo = KhoKyTonRepository(db)
    da_tinh = ky_repo.count_for_den(den, kho_ids) > 0
    da_khoa = KhoKhoaSoRepository(db).is_locked(kho_id, den) if kho_id else \
        KhoKhoaSoRepository(db).is_locked(None, den)
    # `den` rơi GIỮA một kỳ đã tính (chốt ở ngày khác) → vẫn cho hiện Giá trị cuối kỳ, dạng TẠM TÍNH.
    ky_bao = None if da_tinh else ky_repo.period_containing(den, kho_ids)
    return BaoCaoNXTPage(items=rows, total=len(rows), tu=tu, den=den,
                         da_tinh=da_tinh, da_khoa=da_khoa,
                         ky_da_tinh_den=ky_bao[1] if ky_bao else None,
                         ky_da_tinh_ten=ky_bao[2] if ky_bao else None,
                         lua_chon=lua_chon)


def _chot_ky(
    db: Session, *, tu: date, den: date, ten: str | None, kho_ids: list[int] | None,
    khoa_so_id: int | None,
) -> None:
    """Chốt tồn cuối kỳ vào snapshot `kho_ky_ton` (xoá kỳ cũ rồi ghi mới). KHÔNG commit — caller lo.
    Dùng chung cho 'Tính giá kỳ' (bấm tay) và 'Khóa sổ' (tự chốt)."""
    comp = _nxt_compute(db, tu=tu, den=den, kho_ids=kho_ids)
    ky_repo = KhoKyTonRepository(db)
    ky_repo.delete_for_den(den, kho_ids)
    for (kid, hloai, hid, kr, kd, goc), c in comp.items():
        # Bỏ dòng rỗng hoàn toàn (không tồn cuối, không phát sinh) — khỏi phình snapshot.
        if (abs(c["cuoi_sl"]) < 1e-9 and c["cuoi_gt"] == 0
                and abs(c["nhap_sl"]) < 1e-9 and abs(c["xuat_sl"]) < 1e-9
                and abs(c["dau_sl"]) < 1e-9):
            continue
        ky_repo.upsert(
            kho_id=kid, hang_loai=hloai, hang_id=hid, kho_rong=kr, kho_dai=kd, don_vi_goc=goc,
            tu_ngay=tu, den_ngay=den, ten_ky=ten, sl_cuoi=c["cuoi_sl"], gt_cuoi=int(c["cuoi_gt"]),
            don_gia_bq=c["don_gia_bq"], khoa_so_id=khoa_so_id,
        )


@router.post("/bao-cao/tinh-gia-ky", response_model=BaoCaoNXTPage)
def tinh_gia_ky(payload: TinhGiaKyIn, db: Db, user: CloseBookUser) -> BaoCaoNXTPage:
    """TÍNH GIÁ KỲ (bình quân) kiểu MISA: chốt tồn cuối kỳ vào snapshot `kho_ky_ton` để kỳ sau đọc
    làm đầu kỳ. Chạy lại được (đè) bao nhiêu lần cũng được. KHÔNG đụng phiếu xuất đích danh. Ghi Lịch sử.

    CHỈ tính trên khoảng ĐÃ KHÓA SỔ — mọi ngày của [tu, den] ở mọi kho trong phạm vi (luồng 29/08/2026,
    chủ chốt lại 13/10/2026: khóa trước rồi mới tính). Kỳ đã khóa thì phiếu đóng băng nên tính lại ra
    đúng số; `den` sớm hơn cuối kỳ khóa (tính giữa kỳ) vẫn được vì khoảng đó đã khóa."""
    tu, den = payload.tu, payload.den
    kho_ids = _scope_kho_ids(db, payload.kho_id, tu, den)
    try:
        chan_chot_khi_chua_gia(db, tu_ngay=tu, den_ngay=den, kho_ids=kho_ids, viec="tính giá kỳ")
    except GiaGocError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None
    if (mo := KhoKhoaSoRepository(db).ngay_chua_khoa(kho_ids, tu, den)) is not None:
        kid, ngay = mo
        noi = (getattr(KhoHangRepository(db).get(kid), "ten", None) or f"Kho #{kid}") if kid else "Toàn kho"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(f"Kỳ chưa khóa sổ: {noi} còn mở ngày {_fmt_date(ngay)}. Khóa sổ kỳ ở Kỳ kế toán "
                    f"trước rồi mới tính giá."),
        )
    _chot_ky(db, tu=tu, den=den, ten=payload.ten, kho_ids=kho_ids, khoa_so_id=None)
    db.commit()
    _log_tinh_gia(db, user, kho_id=payload.kho_id, tu=tu, den=den, ten=payload.ten)
    rows = _nxt_rows(db, tu=tu, den=den, kho_id=payload.kho_id)
    return BaoCaoNXTPage(items=rows, total=len(rows), tu=tu, den=den, da_tinh=True, da_khoa=False)


@router.get("/bao-cao/ky-da-tinh", response_model=list[KyDaTinhRow])
def get_ky_da_tinh(db: Db, _: XemBaoCaoUser) -> list[KyDaTinhRow]:
    """Danh sách các KỲ ĐÃ TÍNH GIÁ (có snapshot) — cho tab 'Kỳ đã tính'. Mới nhất trước."""
    ky_repo = KhoKyTonRepository(db)
    khoa_repo = KhoKhoaSoRepository(db)
    khos_map = ky_repo.khos_by_period()
    out: list[KyDaTinhRow] = []
    for r in ky_repo.aggregate_periods():
        khos = khos_map.get((r.tu_ngay, r.den_ngay), set())
        da_khoa = any(khoa_repo.is_locked(kid, r.den_ngay) for kid in khos)
        out.append(KyDaTinhRow(
            tu_ngay=r.tu_ngay, den_ngay=r.den_ngay, ten=r.ten,
            so_mat_hang=int(r.so_dong), so_kho=int(r.so_kho),
            tong_gt_cuoi=int(r.tong_gt), tinh_luc=r.tinh_luc, da_khoa=da_khoa,
        ))
    return out


# --- Khóa kỳ (chốt sổ) ---------------------------------------------------------

def _khoa_row(db: Session, row) -> KhoKhoaSoRow:
    kho = KhoHangRepository(db).get(row.kho_id) if row.kho_id else None
    nguoi = UserRepository(db).get_by_id(row.nguoi_khoa_id) if row.nguoi_khoa_id else None
    return KhoKhoaSoRow(
        id=row.id,
        kho_id=row.kho_id,
        kho_ten=getattr(kho, "ten", None),
        tu_ngay=row.tu_ngay,
        den_ngay=row.den_ngay,
        hanh_dong=row.hanh_dong,
        nguoi_khoa_ten=getattr(nguoi, "name", None),
        khoa_luc=row.khoa_luc,
        ten=row.ten,
    )


@router.get("/khoa-so", response_model=list[KhoKhoaSoRow])
def get_khoa_so(db: Db, _: XemBaoCaoUser) -> list[KhoKhoaSoRow]:
    """Lịch sử thao tác khóa/mở kỳ (mới nhất trước) — dùng cho tab Lịch sử + đối chiếu đang khóa."""
    return [_khoa_row(db, r) for r in KhoKhoaSoRepository(db).history()]


@router.get("/khoa-so/ky", response_model=list[KhoaSoKyRow])
def get_khoa_so_ky(db: Db, _: XemBaoCaoUser) -> list[KhoaSoKyRow]:
    """Các KỲ CÒN đang khóa (đã gộp khoảng liền mạch) — cho tab 'Kỳ đã khóa' chọn nhanh + xuất."""
    kho_repo = KhoHangRepository(db)
    repo = KhoKhoaSoRepository(db)
    out: list[KhoaSoKyRow] = []
    for kho_id, tu, den, khoa_luc, ten in repo.locked_periods():
        kho = kho_repo.get(kho_id) if kho_id else None
        # Kỳ TOÀN KHO: liệt kê các kho đã MỞ RIÊNG trong kỳ (miễn trừ) để hiển thị "trừ: …".
        mien_tru: list[str] = []
        if kho_id is None:
            for kid in repo.exempted_khos(tu, den):
                k = kho_repo.get(kid)
                mien_tru.append(getattr(k, "ten", None) or f"Kho #{kid}")
        out.append(KhoaSoKyRow(
            kho_id=kho_id, kho_ten=getattr(kho, "ten", None),
            tu_ngay=tu, den_ngay=den, khoa_luc=khoa_luc, ten=ten, mien_tru=mien_tru,
        ))
    return out


@router.post("/khoa-so", response_model=KhoKhoaSoRow, status_code=status.HTTP_201_CREATED)
def set_khoa_so(payload: KhoKhoaSoIn, db: Db, user: CloseBookUser) -> KhoKhoaSoRow:
    if payload.kho_id is not None and KhoHangRepository(db).get(payload.kho_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy kho")
    repo = KhoKhoaSoRepository(db)
    # KHÓA: không cho khóa ĐÈ lên kỳ đã khóa (kỳ mới phải bắt đầu sau ngày đã khóa gần nhất).
    if payload.hanh_dong == "khoa" and repo.overlaps_locked(
        payload.kho_id, payload.tu_ngay, payload.den_ngay
    ):
        # Kỳ RỜI NGÀY (chốt 2026-09-05 — "cách 3"): kỳ trước kết thúc HẾT ngày `den`, kỳ sau bắt
        # đầu NGÀY KẾ TIẾP. Mỗi ngày chỉ thuộc ĐÚNG MỘT kỳ → không đếm 2 lần, nhãn khớp nội dung.
        # Số dư vẫn nối liền: cuối kỳ trước = đầu kỳ sau (qua snapshot `kho_ky_ton`).
        cutoff = repo.locked_cutoff(payload.kho_id)
        goi_y = (
            f" Đã khóa tới {_fmt_date(cutoff)}; kỳ mới phải bắt đầu từ "
            f"{_fmt_date(cutoff + timedelta(days=1))} trở đi."
            if cutoff else ""
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Khoảng này chồng lấn kỳ đã khóa.{goi_y}",
        )
    # KHÓA: TÊN kỳ không được TRÙNG tên một kỳ ĐANG KHÓA khác (so không phân biệt hoa/thường) —
    # chặn nhầm lẫn khi có nhiều kỳ. Bỏ trống thì không kiểm.
    if payload.hanh_dong == "khoa" and (payload.ten or "").strip():
        ten_norm = (payload.ten or "").strip().casefold()
        dang_dung = {(t[4] or "").strip().casefold() for t in repo.locked_periods() if t[4]}
        if ten_norm in dang_dung:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Tên kỳ '{payload.ten.strip()}' đã dùng cho một kỳ đang khóa — đặt tên khác.",
            )
    # KHÓA: còn thành phẩm chưa có giá gốc (giá 0) thì chưa chốt được (chủ chốt 12/10/2026).
    if payload.hanh_dong == "khoa":
        try:
            chan_chot_khi_chua_gia(
                db, tu_ngay=payload.tu_ngay, den_ngay=payload.den_ngay,
                kho_ids=[payload.kho_id] if payload.kho_id is not None else None, viec="khoá sổ")
        except GiaGocError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from None
    # MỞ: khóa sổ TUẦN TỰ — chỉ mở được phần ĐUÔI vùng khóa, tính từ NGÀY CUỐI đang khóa (cutoff).
    # → mở được cả vùng [đầu..cutoff] hoặc một đuôi [giữa..cutoff]; KHÔNG mở phần giữa/đầu để hở
    #   kỳ mới hơn, cũng không mở vượt quá vùng khóa.
    if payload.hanh_dong == "mo":
        cutoff = repo.locked_cutoff(payload.kho_id)
        if cutoff is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Không có kỳ nào đang khóa để mở.",
            )
        if payload.den_ngay != cutoff:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Mở sổ phải tính từ NGÀY CUỐI đang khóa — đặt 'Đến ngày' = "
                    f"{cutoff.strftime('%d/%m/%Y')} (chọn 'Từ ngày' tùy ý để mở phần đuôi kỳ khóa)."
                ),
            )
        # KHÔNG cho mở VẮT QUA kẽ hở / ôm luôn kỳ cũ hơn: [tu_ngay, cutoff] phải LIỀN MẠCH đang khóa.
        # → muốn mở kỳ cũ thì phải mở kỳ mới hơn TRƯỚC (mở lần lượt từ đuôi về).
        run_start = repo.locked_run_start(payload.kho_id, cutoff)
        if payload.tu_ngay < run_start:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Khoảng mở vắt qua kỳ khác hoặc ngày chưa khóa — chỉ mở được phần ĐUÔI LIỀN MẠCH "
                    f"của kỳ đang khóa (đặt 'Từ ngày' ≥ {run_start.strftime('%d/%m/%Y')}). Muốn mở kỳ "
                    f"cũ hơn thì phải mở kỳ mới hơn ({run_start.strftime('%d/%m/%Y')}–"
                    f"{cutoff.strftime('%d/%m/%Y')}) TRƯỚC."
                ),
            )
    # Tên kỳ cho dòng nhật ký. Khoá: tên vừa đặt. Mở: body không mang tên, nên tra tên các kỳ đang
    # khoá mà khoảng mở chạm vào — phải tra TRƯỚC `repo.add` vì bản ghi 'mo' mới ghi sẽ che chúng.
    if payload.hanh_dong == "khoa":
        ten_ky_nk = (payload.ten or "").strip()
    else:
        ten_ky_nk = "; ".join(
            t[4] for t in repo.locked_periods()
            if t[0] == payload.kho_id and t[4] and t[1] <= payload.den_ngay and t[2] >= payload.tu_ngay
        )
    row = repo.add(
        kho_id=payload.kho_id, tu_ngay=payload.tu_ngay, den_ngay=payload.den_ngay,
        hanh_dong=payload.hanh_dong, nguoi_khoa_id=user.id,
        ten=((payload.ten or "").strip() or None) if payload.hanh_dong == "khoa" else None,
    )
    kho_nk = KhoHangRepository(db).get(payload.kho_id) if payload.kho_id is not None else None
    # Trước 18/10/2026 khoá / mở kỳ kho chỉ nằm ở bảng `kho_khoa_so`, không có dòng nhật ký nào
    # (lỗi E2E #49). Mở kỳ là việc nhạy cảm nhất: nó xoá số đã chốt giá của kỳ.
    _nk_khoa_so = dict(
        actor_user_id=user.id,
        action="kho_khoa_ky" if payload.hanh_dong == "khoa" else "kho_mo_ky",
        target=f"kho_khoa_so:{row.id}",
        detail=(
            ("Khoá kỳ" if payload.hanh_dong == "khoa" else "Mở kỳ")
            + (f" “{ten_ky_nk}”" if ten_ky_nk else "")
            + f" {_fmt_date(payload.tu_ngay)} – {_fmt_date(payload.den_ngay)}"
            + f", {getattr(kho_nk, 'ten', None) or 'toàn kho'}"
        ),
    )
    # KHÓA sổ CHỈ khai + đóng băng kỳ (không tự tính giá — luồng chốt 29/08/2026): tính giá là bước
    # RIÊNG, vào tab N-X-T chọn kỳ đã khóa rồi bấm "Tính giá kỳ". Tách bạch cho đỡ rối.
    # MỞ sổ → BỎ CHỐT giá: xoá snapshot của kỳ vừa mở (den_ngay trong khoảng mở) để khoá lại phải
    # tính lại, không giữ số cũ (khớp luật "phải khoá mới tính" — user 2026-08-29).
    if payload.hanh_dong == "mo":
        kho_ids = [payload.kho_id] if payload.kho_id else None
        KhoKyTonRepository(db).delete_range(payload.tu_ngay, payload.den_ngay, kho_ids)
        # Cùng giao dịch với việc xoá số đã chốt: mất số mà không có vết (hay ngược lại) là sai.
        AuditLogRepository(db).create(**_nk_khoa_so, commit=False)
        db.commit()
        AuditLogRepository.bao_co_dong_moi()
    else:
        AuditLogRepository(db).create(**_nk_khoa_so)
    return _khoa_row(db, row)


# --- Export Excel theo mẫu MISA -----------------------------------------------

_XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# Cột đúng thứ tự mẫu MISA (Copy of Nhap_kho.xls 33 cột / Copy of Xuat_kho.xls 51 cột).
_NHAP_HEADERS = [
    "Hiển thị trên sổ", "Loại nhập kho", "Ngày hạch toán (*)", "Ngày chứng từ (*)",
    "Số chứng từ (*)", "Mã đối tượng", "Tên đối tượng", "Người giao hàng", "Diễn giải",
    "Nhân viên bán hàng", "Kèm theo", "Loại tiền", "Tỷ giá", "Mã hàng (*)", "Tên hàng",
    "Kho (*)", "Hàng hóa giữ hộ/bán hộ", "TK Nợ (*)", "TK Có (*)", "ĐVT", "Số lượng",
    "Đơn giá", "Thành tiền", "Thành tiền quy đổi", "Số lô", "Hạn sử dụng", "Khoản mục CP",
    "Đơn vị", "Đối tượng THCP", "Công trình", "Đơn đặt hàng", "Hợp đồng bán", "Mã thống kê",
]
_XUAT_HEADERS = [
    "Hiển thị trên sổ", "Loại xuất kho", "Ngày hạch toán (*)", "Ngày chứng từ (*)",
    "Số chứng từ (*)", "Mẫu số HĐ", "Ký hiệu HĐ", "Mã đối tượng", "Tên đối tượng",
    "Địa chỉ/Bộ phận", "Tên người nhận/Của", "Lý do xuất/Về việc", "Nhân viên bán hàng",
    "Kèm theo", "Số lệnh điều động", "Ngày lệnh điều động", "Người vận chuyển",
    "Tên người vận chuyển", "Hợp đồng số", "Phương tiện vận chuyển", "Xuất tại kho",
    "Địa chỉ kho xuất", "Nhập tại chi nhánh", "Tên chi nhánh", "MST chi nhánh", "Nhập tại kho",
    "Địa chỉ kho nhập", "Mã hàng (*)", "Tên hàng", "Là hàng khuyến mại", "Kho (*)",
    "Hàng hóa giữ hộ/bán hộ", "TK Nợ (*)", "TK Có (*)", "ĐVT", "Số lượng", "Đơn giá bán",
    "Thành tiền", "Đơn giá vốn", "Tiền vốn", "Số lô", "Hạn sử dụng", "Đối tượng",
    "Khoản mục CP", "Đơn vị", "Đối tượng THCP", "Công trình", "Đơn đặt hàng", "Hợp đồng bán",
    "CP không hợp lý", "Mã thống kê",
]


# Cột SỐ cần format phân cách hàng nghìn (Excel hiện "." theo locale VN). Giá trị vẫn là số →
# MISA import đọc đúng; number_format chỉ đổi cách HIỂN THỊ.
_MONEY_COLS = {"Đơn giá", "Thành tiền", "Đơn giá bán", "Đơn giá vốn", "Tiền vốn", "Thành tiền quy đổi"}
_QTY_COLS = {"Số lượng"}


def _fmt_date(d: date | None) -> str | None:
    return d.strftime("%d/%m/%Y") if d else None


def _ten_kem_kho(r) -> str | None:
    """Tên hàng trên file Excel: dòng giấy có khổ thì kèm khổ (mẫu MISA không có cột Khổ — cùng mã hai
    khổ là hai dòng khác nhau, thiếu khổ thì đọc như trùng)."""
    if r.kho_rong:
        return f"{r.ten_hang or ''} ({nhan_kho(r.kho_rong, r.kho_dai)})".strip()
    return r.ten_hang


def _map_nhap(r: BaoCaoKhoRow) -> dict:
    return {
        # "Loại nhập kho" để TRỐNG — kế toán tự gõ mã 0/1/2/3 trong Excel/MISA.
        "Ngày hạch toán (*)": _fmt_date(r.ngay_ghi_so),
        "Ngày chứng từ (*)": _fmt_date(r.ngay_ct),
        "Số chứng từ (*)": r.so_ct,
        "Mã hàng (*)": r.ma_hang,
        "Tên hàng": _ten_kem_kho(r),
        "Kho (*)": r.kho_ten,
        "ĐVT": r.dvt,
        "Số lượng": r.so_luong,
        "Đơn giá": r.don_gia,
        "Thành tiền": r.thanh_tien,
        "Hạn sử dụng": _fmt_date(r.han_su_dung),
    }


def _map_xuat(r: BaoCaoKhoRow) -> dict:
    return {
        # "Loại xuất kho" để TRỐNG — kế toán tự gõ mã 0/1/2/3 trong Excel/MISA.
        "Ngày hạch toán (*)": _fmt_date(r.ngay_ghi_so),
        "Ngày chứng từ (*)": _fmt_date(r.ngay_ct),
        "Số chứng từ (*)": r.so_ct,
        "Mã hàng (*)": r.ma_hang,
        "Tên hàng": _ten_kem_kho(r),
        "Xuất tại kho": r.kho_ten,
        "Kho (*)": r.kho_ten,
        "ĐVT": r.dvt,
        "Số lượng": r.so_luong,
        "Đơn giá vốn": r.don_gia,
        "Tiền vốn": r.thanh_tien,
        "Hạn sử dụng": _fmt_date(r.han_su_dung),
    }


# Cột đúng thứ tự mẫu MISA "Chuyển kho" (Copy of Mau_chuyen_kho.xls — 36 cột).
_CHUYEN_HEADERS = [
    "Hiển thị trên sổ", "Hình thức chuyển kho", "Ngày chứng từ (*)", "Ngày hạch toán (*)",
    "Số chứng từ (*)", "Mẫu số hóa đơn", "Ký hiệu HĐ", "Hợp đồng KT số/Lệnh điều động", "Ngày",
    "Của", "Về việc/Diễn giải", "Đại lý/Đơn vị nhận", "Tên đại lý/Tên đơn vị nhận",
    "Mã số thuế đại lý/đơn vị nhận", "Người vận chuyển", "Tên người VC", "Hợp đồng số",
    "Phương tiện VC", "Mã hàng (*)", "Tên hàng", "Xuất tại kho (*)", "Địa chỉ kho xuất",
    "Nhập tại kho (*)", "Địa chỉ kho nhập", "Hàng hóa giữ hộ/bán hộ", "TK Nợ (*)", "TK Có (*)",
    "ĐVT", "Số lượng", "Đơn giá bán", "Thành tiền", "Đơn giá vốn", "Tiền vốn", "Số lô",
    "Hạn sử dụng", "Mã thống kê",
]


def _map_chuyen(r: BaoCaoChuyenKhoRow) -> dict:
    # CHỈ fill cột có sẵn dữ liệu (Xuất/Nhập tại kho, mặt hàng, SL, giá vốn); còn lại để TRỐNG cho
    # kế toán tự khai trong Excel/MISA ("Hình thức chuyển kho", đối tượng, vận chuyển, TK…).
    return {
        "Ngày chứng từ (*)": _fmt_date(r.ngay_ct),
        "Ngày hạch toán (*)": _fmt_date(r.ngay_ghi_so),
        "Số chứng từ (*)": r.so_ct,
        "Về việc/Diễn giải": r.dien_giai,
        "Mã hàng (*)": r.ma_hang,
        "Tên hàng": r.ten_hang,
        "Xuất tại kho (*)": r.kho_xuat_ten,
        "Nhập tại kho (*)": r.kho_nhap_ten,
        "ĐVT": r.dvt,
        "Số lượng": r.so_luong,
        "Đơn giá vốn": r.don_gia_von,
        "Tiền vốn": r.tien_von,
    }


# Mẫu Excel MISA (đã chuyển .xls→.xlsx, GIỮ màu cột + gợi ý (data-validation) + độ rộng + freeze).
# Header ở dòng 1; data ghi từ dòng 2. Xem backend/app/templates/kho/.
_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates" / "kho"


def _build_xlsx(rows: list[BaoCaoKhoRow], loai: str) -> bytes:
    from openpyxl import Workbook, load_workbook
    from openpyxl.styles import Font

    is_nhap = loai == VOUCHER_NHAP
    headers = _NHAP_HEADERS if is_nhap else _XUAT_HEADERS
    mapper = _map_nhap if is_nhap else _map_xuat
    template = _TEMPLATE_DIR / ("nhap_kho.xlsx" if is_nhap else "xuat_kho.xlsx")

    if template.exists():
        # Dùng mẫu MISA thật (màu + gợi ý cột + độ rộng); header ở dòng 1, data ghi từ dòng 2.
        wb = load_workbook(template)
        ws = wb.active
    else:
        # Dự phòng nếu mẫu chưa deploy: dựng header trơn để export vẫn chạy.
        wb = Workbook()
        ws = wb.active
        ws.title = "Nhập kho" if is_nhap else "Xuất kho"
        ws.append(headers)
        for cell in ws[1]:
            cell.font = Font(bold=True)
    for i, r in enumerate(rows):
        vals = mapper(r)
        for ci, h in enumerate(headers, start=1):
            v = vals.get(h)
            if v is None:
                continue
            cell = ws.cell(row=2 + i, column=ci, value=v)
            if h in _MONEY_COLS:
                cell.number_format = "#,##0"      # phân cách hàng nghìn (Excel VN hiện ".")
            elif h in _QTY_COLS:
                cell.number_format = "#,##0.###"  # SL có thể lẻ, tối đa 3 số thập phân
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


# --- Ghi NHẬT KÝ mỗi lần xuất Excel (vào audit_logs) → hiện ở tab "Lịch sử thao tác" ------------
_ACTION_EXPORT = "kho_export"
_ACTION_TINH_GIA = "kho_tinh_gia"


def _log_tinh_gia(db: Session, user: User, *, kho_id: int | None,
                  tu: date, den: date, ten: str | None) -> None:
    """Ghi 1 dòng nhật ký 'Tính giá kỳ' vào audit_logs → hiện ở tab 'Lịch sử thao tác'."""
    kho_ten = getattr(KhoHangRepository(db).get(kho_id), "ten", None) if kho_id is not None else None
    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None),
        action=_ACTION_TINH_GIA,
        target="Tính giá kỳ",
        detail=json.dumps(
            {
                "pham_vi": f"Tính giá kỳ ({kho_ten or 'tất cả kho'})",
                "khoang_ngay": f"{_fmt_date(tu)} – {_fmt_date(den)}",
                "ten_ky": ten,
            },
            ensure_ascii=False,
        ),
    )


def _log_export(db: Session, user: User, *, loai_label: str,
                kho_id: int | None, tu: date | None, den: date | None) -> None:
    """Ghi 1 dòng nhật ký 'xuất Excel' (ai · lúc nào · báo cáo gì · kho · khoảng ngày)."""
    kho_ten = None
    if kho_id is not None:
        kho_ten = getattr(KhoHangRepository(db).get(kho_id), "ten", None)
    pham_vi = f"{loai_label} · {kho_ten or 'Tất cả kho'}"
    khoang = (
        f"{_fmt_date(tu) or '…'} – {_fmt_date(den) or '…'}" if (tu or den) else None
    )
    # Tên kỳ: xuất TOÀN BỘ (không lọc ngày) → "Toàn bộ"; khoảng ngày TRÙNG ĐÚNG một kỳ đã khóa
    # (cùng phạm vi kho) → tên kỳ đó; khoảng ngày lẻ (không trùng kỳ) → để trống.
    ten_ky: str | None = None
    if tu is None and den is None:
        ten_ky = "Toàn bộ"
    elif tu is not None and den is not None:
        for k_kho, k_tu, k_den, _luc, k_ten in KhoKhoaSoRepository(db).locked_periods():
            if k_tu == tu and k_den == den and k_kho == kho_id:
                ten_ky = k_ten or None
                break
    AuditLogRepository(db).create(
        actor_user_id=getattr(user, "id", None),
        action=_ACTION_EXPORT,
        target=loai_label,
        detail=json.dumps(
            {"pham_vi": pham_vi, "khoang_ngay": khoang, "ten_ky": ten_ky},
            ensure_ascii=False,
        ),
    )


@router.get("/bao-cao/lich-su-export", response_model=list[KhoExportLogRow])
def get_lich_su_export(db: Db, _: XemBaoCaoUser) -> list[KhoExportLogRow]:
    """Lịch sử thao tác báo cáo kho: XUẤT EXCEL + TÍNH GIÁ KỲ (mới nhất trước) — cho tab 'Lịch sử'."""
    users = UserRepository(db)
    audit = AuditLogRepository(db)
    out: list[KhoExportLogRow] = []
    # (action, hành động discriminator, nhãn mặc định)
    for action, hd, nhan in (
        (_ACTION_EXPORT, "export", "Xuất Excel"),
        (_ACTION_TINH_GIA, "tinh_gia", "Tính giá kỳ"),
    ):
        for r in audit.list_by_action(action, limit=200):
            try:
                d = json.loads(r.detail or "{}")
            except (ValueError, TypeError):
                d = {}
            u = users.get_by_id(r.actor_user_id) if r.actor_user_id else None
            out.append(KhoExportLogRow(
                thoi_diem=r.created_at,
                hanh_dong=hd,
                loai=r.target or nhan,
                pham_vi=d.get("pham_vi") or r.target or "—",
                khoang_ngay=d.get("khoang_ngay"),
                ten_ky=d.get("ten_ky"),
                nguoi_ten=getattr(u, "name", None),
            ))
    out.sort(key=lambda x: x.thoi_diem, reverse=True)
    return out


def _passes_funnel(
    r, *, sl_from, sl_to, dg_from, dg_to, tt_from, tt_to, price_attr: str, total_attr: str,
) -> bool:
    """Lọc khoảng số theo CỘT (Số lượng · Đơn giá · Thành tiền): khoảng BAO GỒM hai đầu, để trống =
    không chặn, giá trị None mà đang có chặn = loại. Màn và file Excel dùng CHUNG hàm này nên 'xuất
    Excel' ĐÚNG BẰNG bảng đang xem. Ngày đã do kỳ (`tu_ngay`/`den_ngay`/`moc`) lo từ 06/10/2026."""

    def num_ok(v, lo, hi) -> bool:
        if lo is None and hi is None:
            return True
        if v is None:
            return False
        if lo is not None and v < lo:
            return False
        if hi is not None and v > hi:
            return False
        return True

    return (
        num_ok(r.so_luong, sl_from, sl_to)
        and num_ok(getattr(r, price_attr), dg_from, dg_to)
        and num_ok(getattr(r, total_attr), tt_from, tt_to)
    )


@router.get("/bao-cao/export.xlsx")
def export_bao_cao(
    db: Db,
    authz: Authz,
    user: XemBaoCaoUser,
    loc: LocTT,
    loai: str = Query(pattern="^(NHAP|XUAT)$"),
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query("ct", pattern=_MOC_SO),
    kho_id: int | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    sl_from: float | None = Query(default=None),
    sl_to: float | None = Query(default=None),
    dg_from: float | None = Query(default=None),
    dg_to: float | None = Query(default=None),
    tt_from: float | None = Query(default=None),
    tt_to: float | None = Query(default=None),
) -> Response:
    # `_report_rows` đã LOẠI điều chuyển (chuẩn kế toán: nội bộ, không nhập-mua/xuất-bán) — nên file
    # MISA nhập/xuất tự động không dính điều chuyển; điều chuyển có mẫu "Chuyển kho" riêng.
    # Ẩn tiền TRƯỚC khi lọc funnel: bộ lọc theo Đơn giá/Thành tiền phải thấy cùng một bảng với
    # người dùng, không thì file lọc ra theo con số mà họ không được nhìn.
    cho_xem = _thay_gia(authz, user)
    rows = _an_tien(
        _report_rows(db, tu=tu_ngay, den=den_ngay, kho_id=kho_id, loai=loai, q=q, moc=moc),
        "so", cho_xem,
    )
    rows = [r for r in rows if _khop_thuoc_tinh(r, loc)]
    # Áp CÙNG bộ lọc khoảng số với màn (không cắt trang) → file = đúng bảng đang xem.
    rows, _, _ = _loc_so_va_trang(
        rows, cho_xem=cho_xem, price_attr="don_gia", total_attr="thanh_tien",
        sl_from=sl_from, sl_to=sl_to, dg_from=dg_from, dg_to=dg_to, tt_from=tt_from, tt_to=tt_to,
        page=None, size=1)
    content = _build_xlsx(rows, loai)
    _log_export(db, user, loai_label="Nhập kho" if loai == VOUCHER_NHAP else "Xuất kho",
                kho_id=kho_id, tu=tu_ngay, den=den_ngay)
    fname = f"bao-cao-kho-{'nhap' if loai == VOUCHER_NHAP else 'xuat'}.xlsx"
    return Response(
        content=content,
        media_type=_XLSX_MEDIA,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


def _build_chuyen_xlsx(rows: list[BaoCaoChuyenKhoRow]) -> bytes:
    """Export điều chuyển theo mẫu MISA 'Chuyển kho' — chỉ fill cột có dữ liệu, còn lại để trống."""
    from openpyxl import Workbook, load_workbook
    from openpyxl.styles import Font

    template = _TEMPLATE_DIR / "chuyen_kho.xlsx"
    if template.exists():
        wb = load_workbook(template)
        ws = wb.active
    else:
        wb = Workbook()
        ws = wb.active
        ws.title = "Chuyển kho"
        ws.append(_CHUYEN_HEADERS)
        for cell in ws[1]:
            cell.font = Font(bold=True)
    for i, r in enumerate(rows):
        vals = _map_chuyen(r)
        for ci, h in enumerate(_CHUYEN_HEADERS, start=1):
            v = vals.get(h)
            if v is None:
                continue
            cell = ws.cell(row=2 + i, column=ci, value=v)
            if h in _MONEY_COLS:
                cell.number_format = "#,##0"
            elif h in _QTY_COLS:
                cell.number_format = "#,##0.###"
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _build_nxt_xlsx(rows: list[BaoCaoNXTRow], *, tu: date, den: date, hien_cuoi: bool) -> bytes:
    """Export Nhập-Xuất-Tồn theo mẫu MISA: header 2 tầng (Đầu kỳ · Nhập kho · Xuất kho · Cuối kỳ,
    mỗi cụm 2 cột Số lượng/Giá trị), gom NHÓM THEO KHO kèm dòng cộng kho — như file mẫu.

    `hien_cuoi=False` (kỳ chưa tính giá) → cột Giá trị CUỐI KỲ để TRỐNG, khớp đúng bảng trên màn
    hình (cuối kỳ là số chốt, chưa bấm 'Tính giá kỳ' thì chưa có)."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    wb = Workbook()
    ws = wb.active
    ws.title = "Nhap-Xuat-Ton"

    bold = Font(bold=True)
    thin = Side(style="thin", color="B0B7C3")
    box = Border(left=thin, right=thin, top=thin, bottom=thin)
    head_fill = PatternFill("solid", fgColor="DCE6F1")
    grp_fill = PatternFill("solid", fgColor="FFF2CC")
    center = Alignment(horizontal="center", vertical="center")

    ws["A1"] = "BÁO CÁO NHẬP - XUẤT - TỒN"
    ws["A1"].font = Font(bold=True, size=14)
    ws["A2"] = f"Từ ngày {_fmt_date(tu)} đến ngày {_fmt_date(den)}"
    if not hien_cuoi:
        ws["A3"] = "(Kỳ chưa tính giá — cột Giá trị cuối kỳ để trống)"
        ws["A3"].font = Font(italic=True, color="9C5700")

    r0 = 5   # dòng header tầng 1
    ws.cell(row=r0, column=1, value="Mã hàng")
    ws.cell(row=r0, column=2, value="Tên hàng")
    ws.cell(row=r0, column=3, value="ĐVT")
    for i in range(3):
        ws.merge_cells(start_row=r0, start_column=1 + i, end_row=r0 + 1, end_column=1 + i)
    for j, ten in enumerate(("Đầu kỳ", "Nhập kho", "Xuất kho", "Cuối kỳ")):
        c = 4 + j * 2
        ws.cell(row=r0, column=c, value=ten)
        ws.merge_cells(start_row=r0, start_column=c, end_row=r0, end_column=c + 1)
        ws.cell(row=r0 + 1, column=c, value="Số lượng")
        ws.cell(row=r0 + 1, column=c + 1, value="Giá trị")
    for rr in (r0, r0 + 1):
        for cc in range(1, 12):
            cell = ws.cell(row=rr, column=cc)
            cell.font = bold
            cell.fill = head_fill
            cell.border = box
            cell.alignment = center

    # Gom theo kho, GIỮ thứ tự xuất hiện (khớp bảng trên màn hình).
    groups: dict[str, list[BaoCaoNXTRow]] = {}
    for r in rows:
        groups.setdefault(r.kho_ten or "— Chưa gắn kho —", []).append(r)

    QTY, MONEY = "#,##0.##", "#,##0"
    ln = r0 + 2
    for kho_ten, grs in groups.items():
        t = [0.0, 0, 0.0, 0, 0.0, 0, 0.0, 0]      # dau_sl, dau_gt, nhap.., xuat.., cuoi..
        for r in grs:
            t[0] += r.dau_sl; t[1] += r.dau_gt
            t[2] += r.nhap_sl; t[3] += r.nhap_gt
            t[4] += r.xuat_sl; t[5] += r.xuat_gt
            t[6] += r.cuoi_sl; t[7] += r.cuoi_gt
        ws.cell(row=ln, column=1, value=f"Tên kho : {kho_ten} ({len(grs)})").font = bold
        for ci, v in enumerate(t, start=4):
            cell = ws.cell(row=ln, column=ci, value=(None if (ci == 11 and not hien_cuoi) else v))
            cell.number_format = QTY if ci % 2 == 0 else MONEY
            cell.font = bold
        for cc in range(1, 12):
            ws.cell(row=ln, column=cc).fill = grp_fill
            ws.cell(row=ln, column=cc).border = box
        ln += 1

        for r in grs:
            vals = [
                r.ma_hang or "", _ten_kem_kho(r) or "", r.dvt or "",
                r.dau_sl, r.dau_gt, r.nhap_sl, r.nhap_gt,
                r.xuat_sl, r.xuat_gt, r.cuoi_sl,
                r.cuoi_gt if hien_cuoi else None,
            ]
            for ci, v in enumerate(vals, start=1):
                cell = ws.cell(row=ln, column=ci, value=v)
                cell.border = box
                if ci >= 4:
                    cell.number_format = QTY if ci % 2 == 0 else MONEY
            ln += 1

    for col, w in zip("ABCDEFGHIJK", (18, 40, 8, 12, 16, 12, 16, 12, 16, 12, 16)):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = ws.cell(row=r0 + 2, column=1)

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


@router.get("/bao-cao/nxt/export.xlsx")
def export_nxt(
    db: Db,
    authz: Authz,
    user: XemBaoCaoUser,
    loc: LocTT,
    tu: date = Query(...),
    den: date = Query(...),
    kho_id: int | None = Query(default=None),
    q: str | None = Query(default=None),
) -> Response:
    """Xuất Excel bảng Nhập-Xuất-Tồn (mẫu MISA, gom nhóm theo kho + dòng cộng) — cùng bộ lọc màn."""
    rows = _an_tien(_nxt_rows(db, tu=tu, den=den, kho_id=kho_id, q=q),
                    "nxt", _thay_gia(authz, user))
    rows = [r for r in rows if _khop_thuoc_tinh(r, loc)]
    kho_ids = [kho_id] if kho_id else None
    ky_repo = KhoKyTonRepository(db)
    # Giống màn hình: cuối kỳ chỉ ra tiền khi đã chốt, hoặc `den` nằm trong một kỳ đã tính.
    hien_cuoi = ky_repo.count_for_den(den, kho_ids) > 0 or \
        ky_repo.period_containing(den, kho_ids) is not None
    content = _build_nxt_xlsx(rows, tu=tu, den=den, hien_cuoi=hien_cuoi)
    _log_export(db, user, loai_label="Nhập-Xuất-Tồn", kho_id=kho_id, tu=tu, den=den)
    return Response(
        content=content,
        media_type=_XLSX_MEDIA,
        headers={"Content-Disposition": 'attachment; filename="bao-cao-nhap-xuat-ton.xlsx"'},
    )


@router.get("/bao-cao/chuyen-kho/export.xlsx")
def export_chuyen_kho(
    db: Db,
    authz: Authz,
    user: XemBaoCaoUser,
    loc: LocTT,
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query("ct", pattern=_MOC_SO),
    kho_id: int | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    sl_from: float | None = Query(default=None),
    sl_to: float | None = Query(default=None),
    dg_from: float | None = Query(default=None),
    dg_to: float | None = Query(default=None),
    tt_from: float | None = Query(default=None),
    tt_to: float | None = Query(default=None),
) -> Response:
    cho_xem = _thay_gia(authz, user)
    rows = _an_tien(
        _chuyen_kho_rows(db, tu=tu_ngay, den=den_ngay, kho_id=kho_id, q=q, moc=moc),
        "chuyen", cho_xem,
    )
    rows = [r for r in rows if _khop_thuoc_tinh(r, loc)]
    # Bảng Chuyển kho lọc theo `don_gia_von`/`tien_von` (cột Đơn giá/Thành tiền) — khớp màn.
    rows, _, _ = _loc_so_va_trang(
        rows, cho_xem=cho_xem, price_attr="don_gia_von", total_attr="tien_von",
        sl_from=sl_from, sl_to=sl_to, dg_from=dg_from, dg_to=dg_to, tt_from=tt_from, tt_to=tt_to,
        page=None, size=1)
    content = _build_chuyen_xlsx(rows)
    _log_export(db, user, loai_label="Chuyển kho", kho_id=kho_id, tu=tu_ngay, den=den_ngay)
    return Response(
        content=content,
        media_type=_XLSX_MEDIA,
        headers={"Content-Disposition": 'attachment; filename="bao-cao-kho-chuyen-kho.xlsx"'},
    )
