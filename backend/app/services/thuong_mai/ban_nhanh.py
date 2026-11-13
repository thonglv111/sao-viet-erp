"""Trang Tạo đơn thương mại kiểu quầy (docs/design-hang-thuong-mai-ha-phuong.md §6, phương án C).

Một lần bấm làm đủ: tạo đơn → chốt → xuất hết hàng (ghi sổ luôn nếu được) → lập phiếu thu theo đơn. Mỗi
bước gọi lại đúng service đang có, không chép luật. Các service đó tự commit, nên mọi điều kiện kiểm
được đều kiểm TRƯỚC khi ghi dòng đầu tiên (khách, dòng, kho, quyền, cách giao, tồn, số tiền thu). Bước
sau mà vẫn hỏng thì đơn giữ nguyên chỗ đã tới và lỗi nói rõ đơn nào, bước nào chưa xong.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from ...models.accounting import PAYMENT_VOUCHER_TYPES, VOUCHER_BANK_TRANSFER
from ...models.kho_hang import KhoHang
from ...repositories.don_vi_do_repo import DonViDoRepository, nhan_don_vi
from ...repositories.vat_lieu_kho_repo import VatLieuKhoRepository
from .don_thuong_mai import DonThuongMaiError, chuan_dong


@dataclass
class ThuNgay:
    receipt_method: str
    amount: int
    company_bank_account_id: int | None = None
    bank_reference: str | None = None


def tong_gom_vat(dong: list[dict]) -> int:
    """Cùng công thức `DonThuongMaiService.tao` dùng để chặn cọc vượt đơn."""
    return sum(d["line_total"] * (100 + d["vat_pct_estimate"]) // 100 for d in dong)


def kiem_thu(thu: ThuNgay, tong: int) -> None:
    if thu.receipt_method not in PAYMENT_VOUCHER_TYPES:
        raise DonThuongMaiError("Hình thức thu không hợp lệ.")
    if int(thu.amount or 0) <= 0:
        raise DonThuongMaiError("Số tiền thu phải lớn hơn 0.")
    if int(thu.amount) > tong:
        raise DonThuongMaiError("Số tiền thu không được vượt tổng đơn gồm VAT.")
    if thu.receipt_method == VOUCHER_BANK_TRANSFER:
        if not thu.company_bank_account_id:
            raise DonThuongMaiError("Chọn tài khoản nhận tiền.")
        if not (thu.bank_reference or "").strip():
            raise DonThuongMaiError("Nhập mã giao dịch chuyển khoản.")


def kiem_kho(db: Session, kho_id: int | None) -> KhoHang:
    from .luot_xuat import kho_xuat_thuong_mai

    return kho_xuat_thuong_mai(db, kho_id)


def bang_ten_dvt(db: Session) -> dict[str, str]:
    return DonViDoRepository(db).ten_theo_ma()


def kiem_ton(hang_svc, voucher_svc, kho_id: int, dong: list[dict], dvt_ma: list[str],
             ten_dvt: dict[str, str] | None = None) -> None:
    """Đủ hàng ở kho để ghi sổ luôn không, tính như `LuotXuatService.ghi_so_ngay` (quy về đơn vị gốc,
    lô gợi ý FEFO → FIFO). Gộp các dòng cùng mặt hàng cùng gốc trước khi so. `ten_dvt` là bảng mã →
    tên của `DonViDoRepository.ten_theo_ma()` để câu báo thiếu nói "cuộn" chứ không nói mã."""
    ten_dvt = ten_dvt or {}
    can: dict[tuple[int, str], tuple[float, str]] = {}
    for d, dvt in zip(dong, dvt_ma):
        try:
            qd = hang_svc.quy_ve_goc("vat_tu", d["hang_thuong_mai_id"], dvt, float(d["qty"]))
        except Exception as e:  # mặt hàng chưa khai đường quy đổi ⇒ báo đúng lý do của kho
            raise DonThuongMaiError(f"«{d['description']}»: {e}") from None
        goc = qd.get("don_vi_goc") or ""
        k = (int(d["hang_thuong_mai_id"]), goc)
        cu = can.get(k, (0.0, d["description"]))
        can[k] = (cu[0] + float(qd["sl_goc"]), d["description"])
    for (hang_id, goc), (sl, ten) in can.items():
        _phan, thieu = voucher_svc.suggest_allocation(("vat_tu", hang_id), kho_id, sl, goc=(goc or None))
        if thieu > 0:
            dv = nhan_don_vi(ten_dvt, goc)
            raise DonThuongMaiError(f"Kho không đủ hàng cho «{ten}», còn thiếu {thieu:g} {dv}. "
                                    "Sửa số lượng hoặc chọn Xuất sau.")


def ton_theo_dvt(db: Session, hang_svc, kho_id: int | None, hang_id: int, dvt: str) -> float | None:
    """Tồn của một mặt hàng tính theo ĐVT của dòng đơn (ở một kho, hoặc cộng mọi kho khi `kho_id`
    trống). Lô đơn vị gốc nào không quy ra được ĐVT này thì bỏ qua. Không có lô nào ⇒ 0."""
    tong = 0.0
    for k_id, _ma, _ten, goc, sl in VatLieuKhoRepository(db).ton_theo_kho("vat_tu", hang_id):
        if kho_id and k_id != kho_id:
            continue
        try:
            mot = float(hang_svc.quy_ve_goc("vat_tu", hang_id, dvt, 1, goc=(goc or None))["sl_goc"])
        except Exception:
            continue
        if mot > 0:
            tong += sl / mot
    return round(tong, 3)


__all__ = ["ThuNgay", "bang_ten_dvt", "chuan_dong", "kiem_kho", "kiem_thu", "kiem_ton", "ton_theo_dvt", "tong_gom_vat"]
