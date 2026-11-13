"""Tiền cước giao hàng dịch vụ (docs/design-giao-hang-ha-phuong.md §4).

Công ty chịu cước, không cộng vào đơn hay hoá đơn của khách. Mỗi lần giao dịch vụ có tiền cước vào
hàng chờ chi ở màn Phiếu chi, xếp theo đơn vị vận chuyển. Kế toán lập MỘT phiếu chi cho nhiều lần giao
của cùng một đơn vị (cùng khuôn phiếu chi chiết khấu / kê: đầu phiếu không mang đơn hay khách, tiền nằm
ở dòng `phieu_chi_cuoc_giao`). Huỷ phiếu ⇒ các lần giao tự quay lại hàng chờ.
"""
from __future__ import annotations

from sqlalchemy import select

from ...models.accounting import VOUCHER_SOURCE_CUOC_GIAO
from ...models.customer import Customer
from ...repositories.giao_hang_hp_repo import GiaoHangHpRepository


def hang_cho_chi(db) -> list[dict]:
    repo = GiaoHangHpRepository(db)
    ds = repo.dich_vu_co_cuoc()
    if not ds:
        return []
    # Lần xuất đã huỷ thì không còn gì để trả cước (phần đã chi vẫn nằm trên phiếu chi).
    huy = repo.lan_xuat_da_huy(pt for pt, _ in ds)
    ds = [(pt, o) for pt, o in ds if pt.id not in huy]
    da_chi = repo.da_chi_theo_pt([pt.id for pt, _ in ds])
    dvvc = repo.dvvc_theo_ids(pt.don_vi_vc_id for pt, _ in ds)
    kh_ids = sorted({o.customer_id for _, o in ds if o.customer_id})
    khach = {c.id: c.name for c in db.execute(
        select(Customer).where(Customer.id.in_(kh_ids))).scalars().all()} if kh_ids else {}
    ra = []
    for pt, o in ds:
        chi = da_chi.get(pt.id, 0)
        con = int(pt.tien_cuoc or 0) - chi
        if con <= 0 or o.status == "cancelled":
            continue
        n = dvvc.get(pt.don_vi_vc_id)
        ra.append({
            "phuong_thuc_giao_hp_id": pt.id, "order_id": o.id, "order_no": o.order_no,
            "customer_name": khach.get(o.customer_id), "ma_lan_xuat": pt.ma_lan_xuat,
            "don_vi_vc_id": pt.don_vi_vc_id, "don_vi_vc_ten": n.ten if n else "",
            "ma_van_don": pt.ma_van_don, "tien_cuoc": int(pt.tien_cuoc or 0), "da_chi": chi,
            "con": con, "created_at": pt.created_at,
        })
    # Xếp theo đơn vị vận chuyển rồi mới tới lần giao cũ trước.
    ra.sort(key=lambda r: (r["don_vi_vc_ten"].lower(), r["phuong_thuc_giao_hp_id"]))
    return ra


def tao_phieu_chi(svc, *, actor, dong: list[dict], shared: dict) -> dict:
    """MỘT phiếu chi trả cước nhiều lần giao của CÙNG đơn vị vận chuyển. `svc` = AccountingService.

    Mỗi dòng `{phuong_thuc_giao_hp_id, amount}`: 0 < amount ≤ phần cước còn chờ chi của lần đó.
    Thẩm định mọi dòng trước, ghi một phiếu sau. Người nhận mặc định là tên đơn vị vận chuyển."""
    from ..accounting_service import AccountingNotFound, AccountingValidationError
    from ..dinh_dang import so_vn

    db = svc.repo.db
    repo = GiaoHangHpRepository(db)
    if not dong:
        raise AccountingValidationError("Chưa chọn lần giao nào để chi.")
    if len(dong) > 50:
        raise AccountingValidationError("Một phiếu chi tối đa 50 lần giao.")
    ids = [int(d["phuong_thuc_giao_hp_id"]) for d in dong]
    if len(set(ids)) != len(ids):
        raise AccountingValidationError("Có lần giao bị chọn trùng hai lần.")
    cho = {r["phuong_thuc_giao_hp_id"]: r for r in hang_cho_chi(db)}
    pts = {i: repo.get(i) for i in ids}
    if any(v is None for v in pts.values()):
        raise AccountingNotFound("Không tìm thấy lần giao.")
    dv = {p.don_vi_vc_id for p in pts.values()}
    if len(dv) != 1:
        raise AccountingValidationError("Các lần giao phải cùng một đơn vị vận chuyển mới chi chung một phiếu được.")
    tong = 0
    for d in dong:
        r = cho.get(int(d["phuong_thuc_giao_hp_id"]))
        so = int(d.get("amount") or 0)
        if so <= 0:
            raise AccountingValidationError("Số tiền từng lần giao phải lớn hơn 0.")
        if r is None:
            raise AccountingValidationError("Có lần giao không còn cước chờ chi (đã chi hết).")
        if so > r["con"]:
            raise AccountingValidationError(
                f"Số chi vượt phần cước còn chờ chi của lần {r['ma_lan_xuat'] or r['order_no']} ({so_vn(r['con'])} đ).")
        tong += so
    dvvc = repo.get_dvvc(next(iter(dv)))
    ma = [cho[i]["ma_lan_xuat"] or cho[i]["order_no"] for i in ids]
    values = {
        **shared,
        "source_type": VOUCHER_SOURCE_CUOC_GIAO,
        "currency": "VND",
        "exchange_rate": 1,
        "amount": tong,
        "cash_recipient_name": (shared.get("cash_recipient_name") or "").strip() or (dvvc.ten if dvvc else ""),
        "content": (shared.get("content") or "").strip()
                   or f"Chi cước giao hàng {', '.join(ma)}"[:500],
    }
    prepared = svc._prepare_standalone_voucher(values)
    prepared["source_code_snapshot"] = f"Cước {', '.join(ma)}"[:32]
    prepared["customer_id"] = None
    voucher = svc._new_voucher(None, prepared, actor.id, doc_no=svc._next_voucher_doc_no())
    svc._chan_ky_khoa(voucher)
    db.add(voucher)
    for d in dong:
        repo.them_dong_chi(voucher, int(d["phuong_thuc_giao_hp_id"]), int(d["amount"]))
    saved = svc.repo.save_voucher(voucher)
    svc.audit.create(
        actor_user_id=actor.id,
        action="create_payment_voucher",
        target=f"payment_voucher:{saved.id}",
        detail=f"{saved.code} <- Cước giao hàng {', '.join(ma)}: {so_vn(tong)}đ",
    )
    return svc._voucher_out(saved)
