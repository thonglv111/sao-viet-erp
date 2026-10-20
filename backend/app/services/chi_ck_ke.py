"""Chiết khấu và kê của đơn bán đi theo HÓA ĐƠN, chi lại khi hóa đơn thu đủ (20/10/2026).

Spec: docs/superpowers/specs/2026-10-19-ke-gia-va-chi-chiet-khau-design.md.

- Mỗi hóa đơn chụp phần CK / kê của hàng trong lượt giao nó gắn (cộng dồn theo dòng như
  `hoa_don_theo_giao`, lấy hiệu), co theo số tiền hóa đơn so với giá trị lượt. Hóa đơn ghi đủ đơn
  nhận phần còn lại ⇒ tổng các hóa đơn khớp đúng tổng CK / kê của đơn.
- Tiền chi lại tính TRƯỚC VAT: CK trả khách 100%; kê trả khách sau khi trừ thuế TNDN trên kê.
- Hàng chờ = hóa đơn còn hiệu lực đã thu đủ (`remaining_amount == 0`, kể cả cọc cấn trọn) mà còn
  khoản chưa chi. Phiếu chi huỷ ⇒ khoản quay lại hàng chờ (đã chi lọc theo trạng thái phiếu).
"""
from __future__ import annotations

from fractions import Fraction

from ..models.accounting import LOAI_CK, LOAI_KE

TEN_LOAI = {LOAI_CK: "Chiết khấu", LOAI_KE: "Kê"}


def _cong_don(dong: dict, da_nhan: dict[int, int], truong: str) -> int:
    tong = Fraction(0)
    for lid, sl in da_nhan.items():
        ln = dong.get(lid)
        dat = int(ln.qty or 0) if ln is not None else 0
        if dat <= 0:
            continue
        tong += Fraction(int(getattr(ln, truong) or 0) * min(int(sl), dat), dat)
    return int(tong)


def ck_ke_luot(order, trips) -> dict[int, tuple[int, int]]:
    """{trip_id: (CK, kê)} của hàng từng lượt, theo thứ tự `trips` (đã xếp theo lúc giao xong)."""
    dong = {ln.id: ln for ln in order.lines}
    da_nhan: dict[int, int] = {}
    truoc = (0, 0)
    ra: dict[int, tuple[int, int]] = {}
    for t in trips:
        for tl in t.lines or []:
            da_nhan[tl.order_line_id] = da_nhan.get(tl.order_line_id, 0) + int(tl.qty_giao or 0)
        sau = (_cong_don(dong, da_nhan, "chiet_khau"), _cong_don(dong, da_nhan, "ke_gia"))
        ra[t.id] = (sau[0] - truoc[0], sau[1] - truoc[1])
        truoc = sau
    return ra


def tong_ck_ke(order) -> tuple[int, int]:
    return (sum(int(ln.chiet_khau or 0) for ln in order.lines),
            sum(int(ln.ke_gia or 0) for ln in order.lines))


def chia_ck_ke(
    order, trips, *, trip_id: int, amount: int, gia_tri_luot: int, tong_don: int,
    da_ghi: tuple[int, int], ghi_du: bool,
) -> tuple[int, int]:
    """(CK, kê) cho hóa đơn `amount` (gồm VAT) gắn lượt `trip_id`. `da_ghi` = Σ CK / kê của các
    hóa đơn còn hiệu lực khác của đơn; `ghi_du` = hóa đơn này làm đơn ghi đủ ⇒ nhận phần còn lại."""
    tong = tong_ck_ke(order)
    con = (max(0, tong[0] - da_ghi[0]), max(0, tong[1] - da_ghi[1]))
    if ghi_du:
        return con
    if gia_tri_luot > 0:
        luot = ck_ke_luot(order, trips).get(trip_id, (0, 0))
        phan = [Fraction(x * amount, gia_tri_luot) for x in luot]
    elif tong_don > 0:
        phan = [Fraction(x * amount, tong_don) for x in tong]
    else:
        phan = [Fraction(0), Fraction(0)]
    return (min(con[0], max(0, round(phan[0]))), min(con[1], max(0, round(phan[1]))))


def thue_tndn(ke: int, pct: float | None) -> int:
    return int(round(int(ke or 0) * float(pct or 0) / 100))


def phai_chi(inv) -> dict[str, int]:
    """Số phải chi lại khách của hóa đơn — trước VAT."""
    return {
        LOAI_CK: int(inv.chiet_khau or 0),
        LOAI_KE: max(0, int(inv.ke_gia or 0) - int(inv.ke_thue_tndn or 0)),
    }


def ck_ke_cho_chi(repo, *, order_ids: list[int] | None = None,
                  customer_id: int | None = None) -> list[dict]:
    """Hàng "Chờ chi chiết khấu / kê": mỗi dòng một (hóa đơn, loại) còn phải chi."""
    from .accounting_service import receivable_rows

    hoa_don = repo.hoa_don_cua_don_co_ck_ke(order_ids=order_ids, customer_id=customer_id)
    if not hoa_don:
        return []
    # Nạp ĐỦ hóa đơn của đơn (kể cả hóa đơn không CK/kê): cọc cấn FIFO trong đơn, thiếu hóa đơn
    # nào là cọc dồn sai chỗ.
    du = {r["invoice_id"] for r in receivable_rows(repo, invoices=hoa_don, hoan=False)
          if r["remaining_amount"] == 0}
    co = [i for i in hoa_don if i.id in du and (int(i.chiet_khau or 0) > 0 or int(i.ke_gia or 0) > 0)]
    da_chi = repo.da_chi_ck_ke([i.id for i in co])
    ra: list[dict] = []
    for inv in co:
        for loai, phai in phai_chi(inv).items():
            da = da_chi.get((inv.id, loai), 0)
            if phai - da <= 0:
                continue
            ra.append({
                "sales_invoice_id": inv.id,
                "invoice_symbol": inv.invoice_symbol,
                "invoice_number": inv.invoice_number,
                "invoice_date": inv.invoice_date,
                "order_id": inv.order_id,
                "order_code": inv.order.order_no,
                "customer_id": inv.customer_id,
                "customer_name": inv.customer_name_snapshot,
                "loai": loai,
                "tien": int(inv.chiet_khau or 0) if loai == LOAI_CK else int(inv.ke_gia or 0),
                "thue_tndn": 0 if loai == LOAI_CK else int(inv.ke_thue_tndn or 0),
                "phai_chi": phai,
                "da_chi": da,
                "con": phai - da,
            })
    ra.sort(key=lambda r: (r["invoice_date"], r["sales_invoice_id"], r["loai"]))
    return ra


def ck_ke_theo_don(repo, order_ids: list[int]) -> dict[int, dict[str, int]]:
    """Cột chiết khấu / kê của Báo cáo kinh doanh theo đơn: thuế TNDN trên kê của các hóa đơn còn
    hiệu lực; "phải chi" chỉ cộng hóa đơn đã thu đủ; "đã chi" qua phiếu chi chưa huỷ."""
    from .accounting_service import receivable_rows

    hoa_don = repo.hoa_don_cua_don_co_ck_ke(order_ids=order_ids)
    if not hoa_don:
        return {}
    du = {r["invoice_id"] for r in receivable_rows(repo, invoices=hoa_don, hoan=False)
          if r["remaining_amount"] == 0}
    da_chi = repo.da_chi_ck_ke([i.id for i in hoa_don])
    ra: dict[int, dict[str, int]] = {}
    for inv in hoa_don:
        d = ra.setdefault(inv.order_id, {"ck_phai_chi": 0, "ck_da_chi": 0, "ke_thue_tndn": 0,
                                         "ke_phai_chi": 0, "ke_da_chi": 0})
        d["ke_thue_tndn"] += int(inv.ke_thue_tndn or 0)
        d["ck_da_chi"] += da_chi.get((inv.id, LOAI_CK), 0)
        d["ke_da_chi"] += da_chi.get((inv.id, LOAI_KE), 0)
        if inv.id in du:
            phai = phai_chi(inv)
            d["ck_phai_chi"] += phai[LOAI_CK]
            d["ke_phai_chi"] += phai[LOAI_KE]
    return ra


def bao_ck_ke(db, repo, *, actor_id: int | None, order_ids: list[int]) -> None:
    """Chấm đỏ Phiếu chi + toast khi hóa đơn của các đơn vừa vào hàng chờ chi CK / kê. Gọi SAU khi
    nghiệp vụ đã commit. Mỗi hóa đơn báo một lần."""
    from .thong_bao_man import bao

    ids = [i for i in order_ids if i]
    if not ids:
        return
    for so in sorted({r["invoice_number"] for r in ck_ke_cho_chi(repo, order_ids=ids)}):
        bao(db, kenh="phieu_chi", loai="ck_ke_cho_chi", actor_id=actor_id, quyen="create",
            ma=so, chi_mot_lan=True)
