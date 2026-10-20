"""Hàng việc tiền của đơn bán (17/10/2026) — cùng khuôn "Gia công chờ chi".

Màn Phiếu thu gom "Đơn hàng chờ thu": cọc của đơn đã chốt chưa thu đủ + hoá đơn khách chưa trả hết.
Màn Phiếu chi gom "Chờ trả lại khách": đơn hết chỗ ghi hoá đơn (đã ghi đủ, hoặc đơn đã huỷ) mà quỹ
tiền khách đưa (`quy_tien_don`) vẫn còn dư. Mọi hàng đều SUY từ chứng từ đang có, không lưu trạng
thái riêng: lập phiếu là dòng tự rời, huỷ phiếu là dòng quay lại.
"""
from __future__ import annotations

from ..models.order import STATUS_CANCELLED, STATUS_ORDERED
from ..repositories.order_repo import OrderRepository


def coc_cho_thu(svc) -> list[dict]:
    """Đơn ĐÃ CHỐT có % cọc mà tiền cọc đã thu chưa đủ. Cùng công thức `OrderService._money`."""
    return _coc_cho_thu(svc.repo, svc.repo.don_chot_co_coc())


def coc_cho_thu_cua(repo, order_id: int) -> list[dict]:
    """`coc_cho_thu` thu về một đơn — để biết đơn vừa chốt có vào hàng không."""
    o = repo.don_theo_ids([order_id]).get(order_id)
    if o is None or o.status != STATUS_ORDERED or not (o.deposit_pct or 0) > 0:
        return []
    return _coc_cho_thu(repo, [o])


def _coc_cho_thu(repo, don) -> list[dict]:
    ids = [o.id for o in don]
    tong = OrderRepository(repo.db).money_sums(ids)
    thu = repo.received_deposit_sums(ids)
    khach = repo.customers_by_ids({o.customer_id for o in don if o.customer_id})
    ra = []
    for o in don:
        twv = tong.get(o.id, {}).get("total_with_vat", 0)
        can = int(round(float(o.deposit_pct) * twv / 100))
        da = thu.get(o.id, 0)
        if can <= da:
            continue
        k = khach.get(o.customer_id) if o.customer_id else None
        ra.append({
            "order_id": o.id, "order_code": o.order_no,
            "customer_id": o.customer_id, "customer_name": k.name if k else None,
            "deposit_pct": float(o.deposit_pct), "can_thu": can, "da_thu": da, "con_thieu": can - da,
            "ordered_at": o.ordered_at,
        })
    return ra


def hoa_don_cho_thu(svc) -> list[dict]:
    """Hoá đơn còn hiệu lực khách chưa trả hết — còn nợ THEO ĐƠN (tiền của chính đơn trừ vào hoá đơn
    của đơn đó), cùng số ngăn đơn hàng và cùng trần máy chủ chặn khi lập phiếu thu hoá đơn.

    Cố ý KHÔNG cân theo sổ 131 như màn Công nợ phải thu: cân sổ cấn chéo tiền đơn này sang hoá đơn
    đơn khác của cùng khách, nên thu cọc đơn mới làm hoá đơn đơn cũ biến khỏi hàng trong khi dòng cọc
    vẫn báo thiếu — một đồng bị đếm hai lần trong cùng một hàng (17/10/2026)."""
    from ..models.accounting import SALES_INVOICE_ISSUED
    from .accounting_service import receivable_rows

    rows = receivable_rows(svc.repo, invoices=svc.repo.list_sales_invoices(status=SALES_INVOICE_ISSUED))
    ra = [
        {
            "invoice_id": r["invoice_id"], "invoice_symbol": r["invoice_symbol"],
            "invoice_number": r["invoice_number"], "invoice_date": r["invoice_date"],
            "due_date": r["due_date"], "order_id": r["order_id"], "order_code": r["order_code"],
            "customer_id": r["customer_id"], "customer_name": r["customer_name"],
            "amount": r["amount"], "direct_received_amount": r["direct_received_amount"],
            "deposit_offset_amount": r["deposit_offset_amount"],
            "hoan_khong_don": r["hoan_khong_don"],
            "da_thu": r["received_amount"], "con_no": r["remaining_amount"],
        }
        for r in rows if r["remaining_amount"] > 0
    ]
    ra.sort(key=lambda r: (r["due_date"] is None, r["due_date"] or r["invoice_date"],
                           r["invoice_date"], r["invoice_id"]))
    return ra


def tien_cho_tra_lai(repo, order_ids: list[int] | None = None) -> list[dict]:
    """Đơn có tiền khách phải trả lại = quỹ còn dư sau khi cấn vào hoá đơn − phần đơn còn ghi được
    hoá đơn (đơn huỷ coi như hết chỗ ghi). `order_ids=None` = quét mọi đơn có tiền khách đưa.
    `repo` = AccountingRepository. Mọi nơi hỏi "đơn này còn giữ tiền khách không" đi qua hàm này:
    hàng Chờ trả lại khách, trần phiếu chi trả lại, cờ chờ trả lại ở danh sách đơn, khối Tiền khách
    đang để của Công nợ phải thu."""
    return [r for r in tien_cua_don(repo, order_ids) if r["con_lai"] > 0]


def tien_cua_don(repo, order_ids: list[int] | None = None) -> list[dict]:
    """Mọi đơn còn ĐANG ĐỂ tiền khách (quỹ − phần đã trừ vào hoá đơn > 0), kể cả đơn còn chờ ghi hoá
    đơn để trừ tiếp. `con_lai` = phần phải trả lại ngay (0 nếu còn chỗ ghi), `tinh_trang`:
    `don_huy` / `ghi_du` (đã ghi đủ mà vẫn dư) / `cho_tru` (sẽ trừ vào hoá đơn ghi sau)."""
    from .accounting_service import quy_tien_don, receivable_rows

    if order_ids is None:
        order_ids = sorted(repo.don_co_coc_da_thu() | set(repo.thu_hoa_don_huy_theo_don()))
    quy = quy_tien_don(repo, order_ids)
    ids = sorted(i for i, so in quy.items() if so > 0)
    if not ids:
        return []
    don = repo.don_theo_ids(ids)
    da_tru: dict[int, int] = {}
    da_ghi: dict[int, int] = {}
    for r in receivable_rows(repo, invoices=repo.hoa_don_hieu_luc_cua_don(ids), hoan=False):
        da_tru[r["order_id"]] = da_tru.get(r["order_id"], 0) + r["deposit_offset_amount"]
        da_ghi[r["order_id"]] = da_ghi.get(r["order_id"], 0) + r["amount"]
    tong = OrderRepository(repo.db).money_sums(ids)
    huy = repo.hoa_don_huy_da_thu(ids)
    tra = repo.coc_da_tra_lai_nhieu(ids)
    khach = repo.customers_by_ids({o.customer_id for o in don.values() if o.customer_id})
    ra = []
    for oid in ids:
        o = don.get(oid)
        if o is None:
            continue
        du = quy[oid] - da_tru.get(oid, 0)
        if du <= 0:
            continue
        don_huy = o.status == STATUS_CANCELLED
        con_ghi = 0 if don_huy else max(
            0, tong.get(oid, {}).get("total_with_vat", 0) - da_ghi.get(oid, 0))
        con_lai = max(0, du - con_ghi)
        k = khach.get(o.customer_id) if o.customer_id else None
        ra.append({
            "order_id": oid, "order_code": o.order_no, "don_huy": don_huy,
            "customer_id": o.customer_id, "customer_name": k.name if k else None,
            "hoa_don_huy": huy.get(oid, []), "da_tra_lai": tra.get(oid, 0), "con_lai": con_lai,
            "da_tru": da_tru.get(oid, 0), "dang_de": du,
            "tinh_trang": "don_huy" if don_huy else ("ghi_du" if con_lai > 0 else "cho_tru"),
            # Tiền khách đã đưa cho đơn (cọc + tiền hoá đơn đã huỷ), chưa trừ phần đã trả lại.
            "da_nhan": quy[oid] + tra.get(oid, 0),
        })
    return ra


def bao_hang_cho(db, repo, *, actor_id: int | None, order_id: int | None, order_code: str | None,
                 hoa_don_moi: str | None = None, coc_moi: bool = False) -> None:
    """Chấm đỏ thanh bên khi có khoản MỚI vào hàng chờ (17/10/2026). Gọi SAU khi nghiệp vụ đã commit.

    - `hoa_don_moi` (số hoá đơn vừa ghi) / `coc_moi` (đơn vừa chốt còn thiếu cọc) ⇒ Phiếu thu.
    - Đơn còn tiền khách phải trả lại sau thao tác (ghi đủ hoá đơn, huỷ hoá đơn, huỷ đơn) ⇒ Phiếu chi.
    Báo cho người có quyền LẬP phiếu ở màn đích."""
    from .thong_bao_man import bao

    if hoa_don_moi:
        bao(db, kenh="phieu_thu", loai="hoa_don_cho_thu", actor_id=actor_id, quyen="create",
            ma=hoa_don_moi)
    if coc_moi and order_id is not None and coc_cho_thu_cua(repo, order_id):
        bao(db, kenh="phieu_thu", loai="coc_cho_thu", actor_id=actor_id, quyen="create", ma=order_code)
    if order_id is not None and tien_cho_tra_lai(repo, [order_id]):
        bao(db, kenh="phieu_chi", loai="tra_lai_khach", actor_id=actor_id, quyen="create", ma=order_code)


def tien_dang_de(repo, customer_id: int | None = None) -> list[dict]:
    """Tiền khách đang để ở từng đơn (`tien_cua_don`) — khối "Tiền khách đang để" của Công nợ phải
    thu (17/10/2026). Công nợ đi theo đơn nên tiền này KHÔNG trừ vào hoá đơn của đơn khác; hiện riêng
    để kế toán thấy khách còn tiền ở đâu, đơn nào phải trả lại ngay (`con_lai` > 0)."""
    ids = None
    if customer_id is not None:
        ids = sorted(repo.don_cua_khach_co_tien(customer_id))
    ra = [
        r for r in tien_cua_don(repo, ids)
        if r["customer_id"] is not None and (customer_id is None or r["customer_id"] == customer_id)
    ]
    ra.sort(key=lambda r: (-r["con_lai"], r["order_code"]))
    return ra
