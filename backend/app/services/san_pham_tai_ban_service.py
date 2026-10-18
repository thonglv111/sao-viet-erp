"""SẢN PHẨM TÁI BẢN — thành phẩm CỦA KHÁCH, nạp lại cấu hình kỹ thuật đã từng chốt đơn.

Từ 11/10/2026 (mg 0394) nguồn là chính mã thành phẩm (`vat_tu_in_an`, `la_thanh_pham`) của khách
đầu phiếu: `cau_hinh_tai_ban` = list cấu hình từng thành phần (ruột + bìa…) chụp lúc chốt đơn
(`thanh_pham_khai_bao.khai_cho_don` gọi `cau_hinh_tu_thanh_phan`). Chọn ở ô tái bản là chọn MÃ —
chốt đơn gắn cụm vào đúng mã đó. Bảng cũ `san_pham_tai_ban` (khoá theo tên, chung mọi khách) thôi
ghi/đọc.
"""
from __future__ import annotations

import unicodedata

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.phieu_tinh_gia import PhieuThanhPhan
from ..schemas.phieu_tinh_gia import BuocVatTuIn, ChiPhiKhacIn, ThanhPhamIn, ThanhPhanIn
from .ptg_giay_buoc import chuan_hoa_giay, nhom_cong_doan

_DAU_MAP = str.maketrans({"đ": "d", "Đ": "D"})


def chuan_hoa_ten(s: str | None) -> str:
    """Bỏ dấu tiếng Việt + lowercase + gộp khoảng trắng — khoá tìm/so trùng tên tái bản."""
    s = (s or "").translate(_DAU_MAP)
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = " ".join(s.split())
    return s.lower()


def cau_hinh_tu_thanh_phan(tp: PhieuThanhPhan) -> dict:
    """Ảnh chụp CẤU HÌNH KỸ THUẬT dạng `ThanhPhanIn` — CỐ Ý bỏ qua `so_luong` (số lượng của đơn
    cũ), `so_to_per_sp`/`so_mau_a`/`so_mau_b`/`so_mau_pha` (dẫn xuất, engine tự tính lại khi nạp),
    và `gia_von_tp` (giá vốn đã tính, không thuộc `ThanhPhanIn`)."""
    data = ThanhPhanIn(
        loai_thanh_phan=tp.loai_thanh_phan,
        ten=tp.ten,
        dai_thanh_pham=tp.dai_thanh_pham,
        rong_thanh_pham=tp.rong_thanh_pham,
        so_trang=tp.so_trang,
        trang_moi_tay=tp.trang_moi_tay,
        don_vi_tinh=tp.don_vi_tinh,
        nhom_bao_gia=tp.nhom_bao_gia,
        dvt_nhom=tp.dvt_nhom,
        giay_id=tp.giay_id,
        kho_nguyen=tp.kho_nguyen,
        kho_nguyen_dai=tp.kho_nguyen_dai,
        kho_nguyen_rong=tp.kho_nguyen_rong,
        don_gia_giay=tp.don_gia_giay,
        don_gia_don_vi=tp.don_gia_don_vi,
        nguon_giay=tp.nguon_giay,
        chua_nhip=tp.chua_nhip,
        bleed_mm=tp.bleed_mm,
        khe_cat_mm=tp.khe_cat_mm,
        co_in=tp.co_in,
        che_ban_loai=tp.che_ban_loai,
        che_ban_don_gia=tp.che_ban_don_gia,
        quy_cach_in=tp.quy_cach_in,
        kho_in_dai=tp.kho_in_dai,
        kho_in_rong=tp.kho_in_rong,
        so_con=tp.so_con,
        con_auto=tp.con_auto,
        may_id=tp.may_id,
        don_gia_cong_in=tp.don_gia_cong_in,
        muc_a=list(tp.muc_a or []),
        muc_b=list(tp.muc_b or []),
        ghi_chu_ky_thuat=tp.ghi_chu_ky_thuat,
        phi_giao_hang=tp.phi_giao_hang,
        thanh_phams=[
            ThanhPhamIn(
                cong_doan_id=cd.cong_doan_id,
                ten=cd.ten,
                don_gia=cd.don_gia,
                bu_hao=cd.bu_hao,
                so_mat=cd.so_mat,
                so_vi_tri=cd.so_vi_tri,
                dien_tich=cd.dien_tich,
                nha_cung_cap=cd.nha_cung_cap,
                ghi_chu=cd.ghi_chu,
                phi_khuon=cd.phi_khuon,
                # Đi CẶP với `phi_khuon`: thiếu nó thì thẻ nạp lại có tiền dao mà không nút nào được
                # chọn, còn ô tiền (chỉ mở khi "làm mới") thì ẩn mất.
                khuon_nguon=cd.khuon_nguon,
                vat_tus=[
                    BuocVatTuIn(hang_loai=v.hang_loai or "vat_tu", vat_tu_id=v.vat_tu_id,
                                gia_tri_chip=dict(v.gia_tri_chip or {}))
                    for v in sorted(cd.vat_tus, key=lambda x: x.thu_tu)
                ],
            )
            for cd in sorted(tp.thanh_phams, key=lambda x: x.thu_tu)
        ],
        # Chi phí khác đi theo mẫu tái bản — cùng lẽ với `phi_giao_hang`: bỏ sót thì đơn tái bản
        # tự nhiên rẻ đi mấy khoản mà không ai được báo. Tên gõ tay cũng chép nguyên, vì đó là
        # thứ DUY NHẤT nói được khoản tiền ấy là gì.
        chi_phi_khacs=[
            ChiPhiKhacIn(ten=c.ten, so_tien=c.so_tien)
            for c in sorted(tp.chi_phi_khacs, key=lambda x: x.thu_tu)
        ],
    )
    # Không mang dấu tái bản của thẻ nguồn: cấu hình là KỸ THUẬT, mã gắn là việc của thẻ nhận.
    return data.model_dump(mode="json", exclude={"tai_ban_thanh_pham_id"})


def tim_kiem(db: Session, customer_id: int, q: str = "", size: int = 20) -> list[dict]:
    """Thành phẩm CỦA KHÁCH để chọn tái bản — gồm cả mã chưa có cấu hình (khai tay / nhập Excel:
    chọn được, chỉ gắn mã). Gõ `q` thì lọc theo tên hoặc mã, bỏ dấu, không phân biệt hoa thường.
    Mã mới chốt trước, rồi tới mã chưa từng chốt."""
    from ..models.vat_lieu_kho import VatTuInAn
    from ..repositories.don_vi_do_repo import DonViDoRepository

    rows = list(db.scalars(
        select(VatTuInAn).where(VatTuInAn.la_thanh_pham.is_(True), VatTuInAn.active.is_(True),
                                VatTuInAn.customer_id == customer_id)
    ).all())
    khoa = chuan_hoa_ten(q)
    if khoa:
        rows = [r for r in rows if khoa in chuan_hoa_ten(r.ten) or khoa in chuan_hoa_ten(r.ma)]
    rows.sort(key=lambda r: (r.tai_ban_luc is None, -(r.tai_ban_luc.timestamp() if r.tai_ban_luc else 0),
                             r.ma))
    ten_dv = DonViDoRepository(db).ten_theo_ma()
    return [{
        "id": r.id, "ma": r.ma, "ten": r.ten,
        "don_vi": ten_dv.get((r.don_vi_gia or "").lower(), r.don_vi_gia) if r.don_vi_gia else None,
        "so_thanh_phan": len(r.cau_hinh_tai_ban or []),
        "tai_ban_luc": r.tai_ban_luc,
    } for r in rows[:size]]


def lay_chi_tiet(db: Session, customer_id: int, tp_id: int) -> dict | None:
    """Mã + cấu hình từng thành phần để nạp vào thẻ. None khi không phải thành phẩm của khách."""
    from ..models.vat_lieu_kho import VatTuInAn

    r = db.get(VatTuInAn, tp_id)
    if r is None or not r.la_thanh_pham or r.customer_id != customer_id:
        return None
    # Cấu hình chụp TRƯỚC 18/10/2026 còn giấy ở `giay_id` cấp sản phẩm, chưa có dòng giấy ở bước ⇒
    # chuyển thành dòng giấy ở bước In (cùng luật mg 0418), không thì nạp vào thẻ là mất giấy.
    cau_hinh = [dict(c) for c in (r.cau_hinh_tai_ban or [])]
    nhom_cua = nhom_cong_doan(db, (b.get("cong_doan_id") for c in cau_hinh
                                   for b in (c.get("thanh_phams") or [])))
    return {"id": r.id, "ma": r.ma, "ten": r.ten,
            "thanh_phans": [chuan_hoa_giay(c, nhom_cua) for c in cau_hinh]}
