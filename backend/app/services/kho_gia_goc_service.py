"""Kho — SỬA GIÁ GỐC thành phẩm sau khi ghi sổ (design nhập kho thành phẩm §5).

Phần mềm không tính được giá gốc (chi phí thật làm ra sản phẩm), nên lô thành phẩm từ KCS vào kho với
giá gốc 0 đ. Kế toán kho biết giá lúc nào thì gõ lúc đó, MỘT lần trên lô gốc:
  · ghi dòng phiếu nhập (`don_gia`, báo cáo Nhập–Xuất–Tồn đọc ở đây) + lô (`don_gia_nhap` quy về đơn
    vị gốc như lúc ghi sổ, phiếu xuất đọc giá lô trực tiếp) của lô gốc VÀ mọi lô sinh ra từ nó qua
    điều chuyển — một giao dịch, lệch một ô là báo cáo và phiếu xuất ra hai số;
  · một lô trong họ nằm ở kỳ đã khoá sổ của kho nó (theo ngày nhập lô) ⇒ chặn cả lần sửa;
  · chỉ lô thành phẩm nhập từ KCS; giấy, vật tư vẫn giữ luật "kho không sửa giá";
  · ghi vết ai sửa, giá cũ → giá mới.

Quyền: `kho:view_cost` (router gác) — người không thấy giá thì cũng không sửa giá.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from ..repositories.audit_repo import AuditLogRepository
from ..repositories.don_vi_do_repo import DonViDoRepository, nhan_don_vi
from ..repositories.kho_gia_goc_repo import KhoGiaGocRepository
from ..repositories.kho_hang_repo import KhoHangRepository
from ..repositories.kho_khoa_so_repo import KhoKhoaSoRepository
from ..repositories.stock_lot_repo import StockLotRepository, goc_cua

ACTION_SUA_GIA_GOC = "kho_sua_gia_goc"


class GiaGocError(ValueError):
    """Lỗi nghiệp vụ — router dịch 400."""


class GiaGocKhongThay(GiaGocError):
    """Không có lô — router dịch 404."""


def _gia_ve_goc(don_gia: float, so_luong: float, sl_goc: float) -> int:
    """Đơn giá theo đơn vị dòng phiếu → đơn giá theo đơn vị gốc của lô (cùng công thức lúc ghi sổ)."""
    return round(float(don_gia) * float(so_luong) / float(sl_goc)) if sl_goc else int(don_gia)


def sua_gia_goc(db: Session, *, user, lot_id: int, don_gia: int) -> dict:
    """`don_gia` theo đơn vị dòng phiếu nhập của lô gốc (đ/hộp). `lot_id` là lô gốc hay lô con đều
    được — hệ quy về lô gốc. Tự commit."""
    if don_gia is None or int(don_gia) < 0:
        raise GiaGocError("Giá gốc phải là số không âm.")
    don_gia = int(don_gia)
    lots = StockLotRepository(db)
    lot = lots.get(lot_id)
    if lot is None:
        raise GiaGocKhongThay("Không tìm thấy lô.")
    goc_id = goc_cua(lot)
    if not lots.nguon_lo([goc_id]).get(goc_id, {}).get("tu_kcs"):
        raise GiaGocError(
            "Chỉ sửa giá gốc cho thành phẩm nhập từ KCS — giấy, vật tư giữ giá lúc nhập kho."
        )

    repo = KhoGiaGocRepository(db)
    ho = repo.ho_lo(goc_id)
    goc = ho[0]
    khoa = KhoKhoaSoRepository(db)
    kho_repo = KhoHangRepository(db)
    for l in ho:
        if l.ngay_nhap is not None and khoa.is_locked(l.kho_id, l.ngay_nhap):
            ten_kho = getattr(kho_repo.get(l.kho_id), "ten", None) or f"kho #{l.kho_id}"
            raise GiaGocError(
                f"Lô {l.ma_lo} ở {ten_kho} nhập ngày {l.ngay_nhap:%d/%m/%Y}, thuộc kỳ đã khoá sổ — "
                "mở kỳ rồi mới sửa được giá gốc."
            )

    dong = repo.dong_nhap_cua_lo([l.id for l in ho])
    ln_goc = dong.get(goc.id)
    if ln_goc is None:
        raise GiaGocError("Lô gốc không còn dòng phiếu nhập — không sửa được giá.")
    cu = int(ln_goc.don_gia or 0)
    # Giá lô giữ số lẻ (mg 0452) — cùng công thức lúc ghi sổ, không làm tròn.
    sl_goc = float(ln_goc.sl_goc)
    gia_lo = float(don_gia) * float(ln_goc.so_luong) / sl_goc if sl_goc else float(don_gia)

    ln_goc.don_gia = don_gia
    goc.don_gia_nhap = gia_lo
    for l in ho[1:]:
        l.don_gia_nhap = gia_lo
        ln = dong.get(l.id)
        if ln is not None:
            # Dòng nhập điều chuyển ghi theo đơn vị gốc (hệ số 1); vẫn quy theo chính dòng cho chắc.
            ln.don_gia = _gia_ve_goc(gia_lo, float(ln.sl_goc), float(ln.so_luong))

    dvt = repo.dvt_dong_yeu_cau(ln_goc.request_line_id)
    dv_ten = nhan_don_vi(DonViDoRepository(db).ten_theo_ma(), dvt) if dvt else ""
    AuditLogRepository(db).create(
        actor_user_id=user.id, action=ACTION_SUA_GIA_GOC, target=f"stock_lot:{goc.id}",
        detail=f"{goc.ma_lo}: giá gốc {cu:,} → {don_gia:,} đ/{dv_ten} · {len(ho)} lô".replace(",", "."),
        commit=False,
    )
    db.commit()
    return {
        "lot_id": goc.id, "ma_lo": goc.ma_lo, "don_gia_cu": cu, "don_gia": don_gia,
        "don_gia_nhap": gia_lo, "so_lo": len(ho),
    }


def chan_chot_khi_chua_gia(db: Session, *, tu_ngay: date, den_ngay: date,
                           kho_ids: list[int] | None = None, viec: str = "chốt kỳ") -> None:
    """Còn thành phẩm chưa có giá gốc (giá 0) thì KHÔNG khoá sổ / tính giá kỳ (chủ chốt 12/10/2026).

    Giá gốc thường gõ sau khi hàng đã xuất, và giá vốn phiếu xuất đọc thẳng giá lô — chốt kỳ lúc còn
    lô 0 đ là số đã chốt (tồn cuối, giá vốn xuất) lệch với số sau khi kế toán gõ giá. Xét lô nhập tới
    hết kỳ; lô nhập TRƯỚC kỳ mà nằm trong kỳ đã khoá thì bỏ qua (dữ liệu cũ, muốn gõ giá phải mở kỳ
    đó — chặn ở đây là kẹt luôn kỳ này)."""
    khoa = KhoKhoaSoRepository(db)
    con = [
        (lot, ten) for lot, ten in KhoGiaGocRepository(db).lo_chua_gia_goc_toi(
            den_ngay=den_ngay, kho_ids=kho_ids)
        if lot.ngay_nhap is None or lot.ngay_nhap >= tu_ngay
        or not khoa.is_locked(lot.kho_id, lot.ngay_nhap)
    ]
    if not con:
        return
    vd = ", ".join(f"{lot.ma_lo} ({ten or 'thành phẩm'})" for lot, ten in con[:3])
    them = f" và {len(con) - 3} lô khác" if len(con) > 3 else ""
    raise GiaGocError(
        f"Còn {len(con)} lô thành phẩm chưa có giá gốc: {vd}{them}. Kế toán gõ giá ở Báo cáo kho, "
        f"mục Giá gốc thành phẩm, rồi mới {viec} được."
    )


def _ds_id(v) -> list[int]:
    """Một id, nhiều id hoặc không gì ⇒ danh sách id (ô lọc chọn nhiều)."""
    if v is None:
        return []
    return [int(x) for x in (v if isinstance(v, (list, tuple, set)) else [v])]


def ds_chua_gia_goc(db: Session, *, q: str | None, chi_chua_gia: bool = True, page: int, size: int,
                    tu_ngay: date | None = None, den_ngay: date | None = None,
                    kho_id: int | list[int] | None = None, khach_hang_id: int | list[int] | None = None,
                    hang_id: int | list[int] | None = None, gia: str | None = None) -> dict:
    """Danh sách "Thành phẩm chưa có giá gốc" — lô GỐC nhập từ KCS, gom mọi kho (số kho đổi theo danh
    mục; bắt kế toán đi từng kho là sót). Phân trang + lọc ở máy chủ. Kèm `cac_kho`/`cac_khach`/
    `cac_hang` cho nút Lọc — chỉ kho/khách/hàng có lô, bất kể bộ lọc đang áp.

    `gia` (`chua` | `co` | `tat_ca`) thắng `chi_chua_gia`; vắng `gia` thì `chi_chua_gia` quyết."""
    if tu_ngay is not None and den_ngay is not None and den_ngay < tu_ngay:
        raise GiaGocError("Ngày nhập 'đến' phải từ ngày 'từ' trở đi.")
    page, size = max(1, int(page)), min(max(1, int(size)), 200)
    if gia is None:
        gia = "chua" if chi_chua_gia else None
    elif gia == "tat_ca":
        gia = None
    repo = KhoGiaGocRepository(db)
    rows, total = repo.ds_lo_goc_tu_kcs(
        q=q, gia=gia, offset=(page - 1) * size, limit=size,
        tu_ngay=tu_ngay, den_ngay=den_ngay, kho_ids=_ds_id(kho_id),
        khach_hang_ids=_ds_id(khach_hang_id), hang_ids=_ds_id(hang_id))
    cac_kho, cac_khach, cac_hang = repo.lua_chon_loc()
    ton = repo.ton_theo_goc([r[0].id for r in rows])
    dv = DonViDoRepository(db).ten_theo_ma()
    items = []
    for lot, ln, rl, kho_ten, hang, lsx_ma, order_ma, khach in rows:
        sl_con, so_lo = ton.get(lot.id, (float(lot.sl_con_lai or 0), 1))
        items.append({
            "lot_id": lot.id,
            "ma_lo": lot.ma_lo,
            "ngay_nhap": lot.ngay_nhap,
            "kho_id": lot.kho_id,
            "kho_ten": kho_ten,
            "hang_id": lot.hang_id,
            "ma_hang": getattr(hang, "ma", None),
            "ten_hang": getattr(hang, "ten", None),
            "dvt": rl.dvt,
            "dvt_ten": nhan_don_vi(dv, rl.dvt) if rl.dvt else None,
            "so_luong_nhap": float(ln.so_luong or 0),
            "don_gia": int(ln.don_gia or 0),
            "don_gia_ban": int(rl.don_gia_ban) if rl.don_gia_ban is not None else None,
            "lsx_ma": lsx_ma,
            "order_ma": order_ma,
            "khach_hang": khach,
            "sl_con_lai": sl_con,
            "don_vi_goc_ten": nhan_don_vi(dv, getattr(hang, "don_vi_gia", None)) if hang else None,
            "so_lo": so_lo,
        })
    return {
        "items": items, "total": total, "page": page, "size": size,
        "cac_kho": [{"id": i, "ten": t} for i, t in cac_kho],
        "cac_khach": [{"id": i, "ten": t} for i, t in cac_khach],
        "cac_hang": [{"id": i, "ten": t} for i, t in cac_hang],
    }
