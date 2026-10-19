"""BÁO CÁO KINH DOANH theo khách hàng (24/09/2026).

Trả lời: *"Trong kỳ này khách X đặt những đơn nào, mỗi đơn gồm sản phẩm gì, đơn giá bao nhiêu,
cọc bao nhiêu và đã nhận cọc chưa?"* — xem trên màn và xuất Excel (một khách hoặc mọi khách).

Chủ chốt 24/09/2026:
  • Chỉ ĐƠN ĐÃ CHỐT (`ordered`). Nháp chưa phải doanh số, đơn hủy không còn là đơn.
  • Vào kỳ theo NGÀY CHỐT ĐƠN (`ordered_at`, giờ VN) — không theo ngày tạo.
  • Phạm vi theo ô quyền riêng `bao_cao_kinh_doanh`, cùng nghĩa với màn Đơn hàng bán: `own` = đơn
    do chính mình bán, `department` = cả phòng (và phòng con), `all` = toàn công ty.

Mọi con số đi qua ĐÚNG công thức của màn Đơn hàng bán (`OrderService._money`): tổng có VAT từ
`OrderRepository.money_sums`, cọc phải thu = % cọc × tổng có VAT, cọc đã nhận = Σ phiếu thu cọc
đã thu (`AccountingRepository.received_deposit_sums`). Tự viết lại công thức ở đây là hai màn hiện
hai con số cho cùng một đơn.

Phương án C (11/10/2026) thêm phần THỰC HIỆN ĐƠN, lũy kế tới HẾT `den_ngay` (in lại kỳ cũ ra đúng
số cũ — cách MISA "lấy tình hình đã thực hiện đến cuối kỳ"):
  • Đã giao = Σ khách đã thực nhận (cùng luật `delivery_repo.da_giao_theo_dong`), quy ra tiền theo
    tỷ lệ số giao / số đặt của từng dòng (giao dư không tính quá số đặt).
  • Đã xuất HĐ = Σ hoá đơn bán đã ghi; Đã thu = phiếu thu cọc + phiếu thu hoá đơn ĐÃ THU
    (`AccountingRepository.hoa_don_va_da_thu_toi_ngay`). Còn phải thu = tổng có VAT − điều chỉnh
    giảm − đã thu + tiền trả lại khách ngoài đơn cộng nợ lại vào hoá đơn của đơn (`hoan_khong_don`,
    cùng phép phân bổ của Công nợ phải thu — #47, 18/10/2026).
Không có giá vốn / lãi gộp: giá thành gốc do kế toán điền, chưa có (chốt 11/10/2026).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from ..van_ban import bo_dau

_VN = timezone(timedelta(hours=7))

#: Tình trạng cọc của một đơn — giá trị điều kiện "Cọc" của nút Lọc (11/10/2026).
NHAN_COC = {"khong": "Không cọc", "thieu": "Còn thiếu cọc", "du": "Đã nhận đủ cọc"}
NHAN_GIAO = {"chua": "Chưa giao", "mot_phan": "Giao một phần", "du": "Đã giao đủ"}
NHAN_THU = {"chua": "Chưa thu", "mot_phan": "Thu một phần", "du": "Đã thu đủ"}


def _moc_utc(ngay: date) -> datetime:
    """0 giờ sáng ngày `ngay` GIỜ VN, đổi ra UTC — mốc so với `orders.ordered_at` (timestamptz)."""
    return datetime.combine(ngay, time.min, tzinfo=_VN).astimezone(timezone.utc)


def _ngay_vn(dt: datetime | None) -> date | None:
    if dt is None:
        return None
    if dt.tzinfo is None:           # SQLite trong test trả datetime trần (đã là UTC)
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_VN).date()


def coc_cua(d: dict) -> str:
    if not d["coc_pct"] and not d["coc_da_nhan"]:
        return "khong"
    return "thieu" if d["coc_con_thieu"] > 0 else "du"


def _tinh_trang(da: int, can: int) -> str:
    """chua / mot_phan / du — dùng chung cho giao (số lượng) và thu (tiền). Không cần gì ⇒ đủ."""
    if can <= 0 or da >= can:
        return "du"
    return "chua" if da <= 0 else "mot_phan"


def _trong(v: float | int | None, tu: float | None, den: float | None) -> bool:
    if tu is None and den is None:
        return True
    if v is None:
        return False
    return (tu is None or v >= tu) and (den is None or v <= den)


def _khop_tim(go: str, khach: dict, d: dict) -> bool:
    """Ô tìm: không dấu, đủ MỌI từ — tìm trong số đơn, PO khách, mã/tên khách, sale, tên mặt hàng."""
    tu = bo_dau(go).split()
    if not tu:
        return True
    chu = bo_dau(" ".join(str(x) for x in (
        d["order_no"], d["po_khach"], khach["ma"], khach["ten"], d["sale"],
        *(ln["ten"] for ln in d["dong"]),
    ) if x))
    return all(t in chu for t in tu)


def lap_bao_cao(
    orders_repo, accounting_repo, *, tu_ngay: date | None, den_ngay: date | None, scope: str,
    actor, customer_id: int | None = None, sale_user_id: int | None = None,
    q: str | None = None, coc: list[str] | None = None,
    ty_le_tu: float | None = None, ty_le_den: float | None = None,
    gt_tu: float | None = None, gt_den: float | None = None,
    giao: list[str] | None = None, thu: list[str] | None = None,
) -> dict:
    """Báo cáo `[tu_ngay, den_ngay]` (tính cả hai đầu, giờ VN), gom theo khách → đơn → dòng.
    Đầu nào None thì không chặn đầu đó (kỳ "Tất cả" của thanh lọc, 06/10/2026).

    Nút Lọc (11/10/2026) lọc ĐƠN theo: ô tìm `q`, tình trạng cọc `coc` (chọn nhiều), khoảng tỷ lệ
    báo giá (%) và khoảng tổng đơn có VAT; phương án C thêm tình trạng giao `giao` và tình trạng thu
    `thu`. Số đếm của mỗi điều kiện chọn-nhiều (`lua_chon`) tính trên mọi điều kiện KHÁC — chọn
    "Còn thiếu" thì menu vẫn bày đủ ba giá trị kèm số."""
    don = orders_repo.chot_trong_khoang(
        tu=_moc_utc(tu_ngay) if tu_ngay else None,
        den=_moc_utc(den_ngay + timedelta(days=1)) if den_ngay else None,
        scope=scope, actor=actor, customer_id=customer_id, sale_user_id=sale_user_id,
    )
    ids = [o.id for o in don]
    tien = orders_repo.money_sums(ids)
    coc_nhan = accounting_repo.received_deposit_sums(ids)
    da_giao = orders_repo.da_giao_theo_dong_nhieu(
        ids, truoc=_moc_utc(den_ngay + timedelta(days=1)) if den_ngay else None)
    hoa_don, da_thu = accounting_repo.hoa_don_va_da_thu_toi_ngay(ids, den_ngay=den_ngay)
    giam_hd = accounting_repo.dieu_chinh_tong_theo_don(ids, den_ngay=den_ngay)
    from .accounting_service import hoan_khong_don_theo_don

    hoan_hd = hoan_khong_don_theo_don(accounting_repo, {o.customer_id for o in don},
                                      den_ngay=den_ngay)
    khach = orders_repo.khach_theo_ids({o.customer_id for o in don if o.customer_id})
    sale = orders_repo.ten_nguoi_dung({o.sale_user_id for o in don if o.sale_user_id})
    so_dong_bg = orders_repo.so_dong_bao_gia({o.quotation_id for o in don if o.quotation_id})

    theo_khach: dict[int | None, dict] = {}
    for o in don:
        k = khach.get(o.customer_id) if o.customer_id else None
        muc = theo_khach.get(o.customer_id)
        if muc is None:
            muc = theo_khach[o.customer_id] = {
                "customer_id": o.customer_id,
                "ma": k.code if k else None,
                "ten": (k.name if k else None) or "(Không gắn khách hàng)",
                "don": [],
            }
        agg = tien.get(o.id, {})
        tong = int(agg.get("total") or 0)
        tong_vat = int(agg.get("total_with_vat") or 0)
        pct = float(o.deposit_pct) if o.deposit_pct else 0.0
        # Cùng công thức `OrderService._money` — xem đầu file.
        coc_phai = int(round(pct * tong_vat / 100)) if pct else 0
        coc_da = int(coc_nhan.get(o.id, 0))
        # Tỷ lệ báo giá thành công = số mặt hàng khách ƯNG (`quote_items.accepted`) / số mặt hàng
        # trong bản báo giá hiện hành (báo 10 chốt 2 ⇒ 20%). 0 dòng ưng = báo giá chốt trước khi có
        # cờ này, đơn kéo TẤT CẢ dòng (cùng fallback của order_service) ⇒ 100%. Đơn không đi từ báo
        # giá ⇒ None (hiện "—").
        ung, mau = so_dong_bg.get(o.quotation_id, (0, 0)) if o.quotation_id else (0, 0)
        ty_le_bg = round((ung or mau) * 100 / mau) if mau else None
        dong = [
            {
                "ten": (ln.description or "").strip(),
                "so_luong": int(ln.qty or 0),
                "dvt": ln.don_vi_tinh,
                "don_gia": int(ln.unit_price_snapshot) if ln.unit_price_snapshot is not None else None,
                "vat_pct": int(ln.vat_pct_estimate or 0),
                "thanh_tien": int(ln.line_total) if ln.line_total is not None else None,
                "da_giao": da_giao.get(ln.id, 0),
                "con_giao": max(0, int(ln.qty or 0) - da_giao.get(ln.id, 0)),
            }
            for ln in o.lines
        ]
        giao_d = _tinh_trang(sum(min(x["da_giao"], x["so_luong"]) for x in dong),
                             sum(x["so_luong"] for x in dong))
        # Giá trị đã giao: tiền có VAT của từng dòng × số giao / số đặt. Giao đủ cả đơn thì lấy
        # đúng tổng có VAT (khỏi lệch đồng lẻ do làm tròn).
        if giao_d == "du":
            gt_giao = tong_vat
        else:
            gt_giao = int(round(sum(
                (x["thanh_tien"] or 0) * (100 + x["vat_pct"]) * min(x["da_giao"], x["so_luong"])
                / x["so_luong"] for x in dong if x["so_luong"]) / 100))
        thu_o = int(da_thu.get(o.id, 0))
        # Hoá đơn điều chỉnh giảm (hoàn chiết khấu) bớt phần khách phải trả; hoá đơn gốc vẫn 100%.
        giam = int(giam_hd.get(o.id, 0))
        # Trả lại khách ngoài đơn cộng nợ lại vào hoá đơn của đơn này — khách lại phải trả phần đó.
        hoan_o = int(hoan_hd.get(o.id, 0))
        phai_tra = max(0, tong_vat - giam) + hoan_o
        muc["don"].append({
            "order_id": o.id,
            "order_no": o.order_no,
            "ngay_chot": _ngay_vn(o.ordered_at),
            "sale": sale.get(o.sale_user_id) if o.sale_user_id else None,
            "po_khach": o.customer_po_no,
            "ngay_giao": o.delivery_committed_date,
            "tong": tong,
            "tong_vat": tong_vat,
            "coc_pct": pct,
            "coc_phai_thu": coc_phai,
            "coc_da_nhan": coc_da,
            "coc_con_thieu": max(0, coc_phai - coc_da),
            "ty_le_bao_gia": ty_le_bg,
            "gia_tri_giao": gt_giao,
            "da_xuat_hd": int(hoa_don.get(o.id, 0)),
            "dieu_chinh": giam,
            "da_thu": thu_o,
            "hoan_khong_don": hoan_o,
            "con_phai_thu": max(0, phai_tra - thu_o),
            "giao": giao_d,
            "thu": _tinh_trang(thu_o, phai_tra),
            "dong": dong,
        })

    # Ba điều kiện chọn-nhiều: số đếm của mỗi cái tính trên MỌI điều kiện còn lại.
    chon = {"coc": set(coc or []), "giao": set(giao or []), "thu": set(thu or [])}
    nhan = {"coc": NHAN_COC, "giao": NHAN_GIAO, "thu": NHAN_THU}
    dem = {ten: {k: 0 for k in n} for ten, n in nhan.items()}
    for muc in theo_khach.values():
        giu = []
        for d in muc["don"]:
            if not (_trong(d["ty_le_bao_gia"], ty_le_tu, ty_le_den) and _trong(d["tong_vat"], gt_tu, gt_den)
                    and (not q or _khop_tim(q, muc, d))):
                continue
            gia_tri = {"coc": coc_cua(d), "giao": d["giao"], "thu": d["thu"]}
            khop = {ten: not chon[ten] or v in chon[ten] for ten, v in gia_tri.items()}
            for ten, v in gia_tri.items():
                if all(ok for t, ok in khop.items() if t != ten):
                    dem[ten][v] += 1
            if all(khop.values()):
                giu.append(d)
        muc["don"] = giu

    _cot = ("tong", "tong_vat", "coc_phai_thu", "coc_da_nhan", "coc_con_thieu",
            "gia_tri_giao", "da_xuat_hd", "dieu_chinh", "da_thu", "hoan_khong_don", "con_phai_thu")
    ds = []
    for muc in theo_khach.values():
        if not muc["don"]:
            continue
        for c in _cot:
            muc[c] = sum(d[c] for d in muc["don"])
        muc["so_don"] = len(muc["don"])
        ds.append(muc)
    # Khách xếp theo tên; dòng "không gắn khách" xuống cuối — cùng lối sổ công nợ.
    ds.sort(key=lambda m: (m["customer_id"] is None, (m["ten"] or "").lower()))
    hom_nay = datetime.now(_VN).date()
    return {
        "tu_ngay": tu_ngay,
        "den_ngay": den_ngay,
        # Giao / hoá đơn / thu tính tới hết ngày này (kỳ chưa hết hoặc không chặn cuối = hôm nay).
        "tinh_toi": min(den_ngay, hom_nay) if den_ngay else hom_nay,
        "pham_vi": scope,
        "khach": ds,
        "tong": {
            "so_khach": len(ds),
            "so_don": sum(m["so_don"] for m in ds),
            **{c: sum(m[c] for m in ds) for c in _cot},
        },
        "lua_chon": {
            ten: [{"value": k, "nhan": nh, "so": dem[ten][k]} for k, nh in n.items()]
            for ten, n in nhan.items()
        },
    }
