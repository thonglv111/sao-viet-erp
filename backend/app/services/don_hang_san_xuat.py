"""Sản xuất TỪNG MẶT HÀNG của đơn bán — một lượt cho nhiều đơn (07/10/2026).

Mockup: `docs/mockups/don-hang-san-xuat-3-phuong-an.html` (danh sách: cách 3, ngăn đơn: phương án B).

Mỗi cụm bán (một sản phẩm khách mua) trả: đang ở đâu (xưởng / nhà gia công nào / chờ KCS–kho /
chưa có lệnh / đủ hàng), lệnh nào, kiểu làm, đã có bao nhiêu hàng, hàng về đâu. Từ đó suy ra đơn
đang CHỜ AI — tập bộ phận, vì một đơn ba món có thể chờ cùng lúc xưởng và hai nhà gia công.

Chỉ ĐỌC. Một lần nạp bối cảnh lệnh (`boi_canh.nap`) và một câu gia công ngoài cho CẢ TẬP lệnh;
phần kho / giao lấy từ `DeliveryService.nguon_giao_theo_cum` — cùng nguồn với tiến độ đơn, để
danh sách, ngăn đơn và bộ lọc không bao giờ nói khác nhau.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..models.lsx import TT_DA_DONG, TT_DA_XUONG_XUONG, Lsx
from ..models.order import STATUS_ORDERED
from ..models.san_xuat import CV_HOAN_THANH
from ..repositories.accounting_repo import AccountingRepository
from ..repositories.delivery_repo import DeliveryRepository
from ..repositories.employee_repo import EmployeeRepository
from ..repositories.gia_cong_ngoai_repo import GiaCongNgoaiRepository
from ..repositories.order_repo import OrderRepository
from ..repositories.xep_lich_lenh_repo import XepLichLenhRepository
from .delivery_service import DeliveryService
from .gia_cong_ngoai import TT_DANG_GIA_CONG, TT_DANG_O_NGOAI, trang_thai as tt_gia_cong

# Mặt hàng đang ở đâu — một giá trị cho mỗi cụm (lấy chỗ "chậm" nhất nếu cụm có nhiều lệnh).
O_DU_HANG = "du_hang"          # kho đã nhận đủ / nhà gia công giao thẳng đủ / tồn kho gánh đủ
O_NGOAI = "ngoai"              # có lệnh đang nằm ở nhà gia công
O_XUONG = "xuong"              # có lệnh đang chạy trong xưởng
O_CHO_KHO = "cho_kho"          # lệnh xong hết bước mà KCS / kho chưa nhận đủ
O_DONG_THIEU = "dong_thieu"    # mọi lệnh đã ĐÓNG, kho không còn gì chờ nhận mà hàng vẫn chưa đủ số đặt
O_CHUA_XUONG = "chua_xuong"    # có lệnh nhưng chưa phát hành xuống xưởng
O_CHUA_LENH = "chua_lenh"      # không có lệnh, tồn kho không đủ

# Đơn đang chờ ai — giá trị của bộ lọc "Đang chờ".
CHO_COC = "coc"
CHO_KE_HOACH = "ke_hoach"
CHO_XUONG = "xuong"
CHO_GIA_CONG = "gia_cong"
CHO_KHO = "kho"
CHO_GIAO = "giao"
CHO_HOA_DON = "hoa_don"
CHO_XONG = "xong"
CHO_TAT_CA = (CHO_COC, CHO_KE_HOACH, CHO_XUONG, CHO_GIA_CONG, CHO_KHO, CHO_GIAO, CHO_HOA_DON, CHO_XONG)
# Đơn ĐÃ HUỶ còn giữ cọc của khách (13/10/2026) — chờ kế toán lập phiếu chi trả lại. Không thuộc
# CHO_TAT_CA vì tập đó suy từ đơn đã chốt; `order_service` tính riêng từ phiếu thu − phiếu chi.
CHO_TRA_COC = "tra_coc"

_O_SANG_CHO = {O_NGOAI: CHO_GIA_CONG, O_XUONG: CHO_XUONG, O_CHO_KHO: CHO_KHO,
               O_CHUA_XUONG: CHO_KE_HOACH, O_CHUA_LENH: CHO_KE_HOACH}
# Cụm nhiều lệnh: chỗ nào đứng trước thì đại diện cho cụm.
_THU_TU_O = (O_CHUA_LENH, O_CHUA_XUONG, O_NGOAI, O_XUONG, O_CHO_KHO, O_DONG_THIEU, O_DU_HANG)


def _lenh_mot(bc, l: Lsx, gcns: list) -> dict:
    """Một lệnh: đang ở đâu + chi tiết đủ để FE viết câu (bước, %, nhà gia công, từ lúc nào)."""
    from .lenh_sx import danh_sach, tien_do

    da_xuong = l.trang_thai in TT_DA_XUONG_XUONG
    cvs = bc.cong_viec_du(l.id) if (bc is not None and da_xuong) else []
    xong = l.trang_thai == TT_DA_DONG or (bool(cvs) and all(c.trang_thai == CV_HOAN_THANH for c in cvs))
    mo = [g for g in gcns if tt_gia_cong(g) in (TT_DANG_GIA_CONG, TT_DANG_O_NGOAI)]
    gc = None
    if mo:
        g = mo[0]
        # Một phần: còn bước CỦA XƯỞNG chưa xong ngoài các bước của lần này ⇒ về xưởng làm tiếp.
        ve_xuong = g.kieu != "tron_goi" and any(
            c.trang_thai != CV_HOAN_THANH and getattr(c, "gia_cong_ngoai_id", None) != g.id for c in cvs)
        gc = {
            "kieu": g.kieu, "nha_cung_cap_id": g.nha_cung_cap_id, "nha_cung_cap_ten": g.nha_cung_cap_ten,
            "ten_viec": g.ten_viec,
            "tu_luc": g.mang_di_luc if g.kieu != "tron_goi" else g.created_at,
            "ve_xuong": ve_xuong,
        }
        o = O_NGOAI
    elif not da_xuong:
        o = O_CHUA_XUONG
    elif not xong:
        o = O_XUONG
    else:
        o = O_CHO_KHO
    buoc = pct = None
    if da_xuong and cvs and o == O_XUONG:
        cv = danh_sach.buoc_hien_tai(bc, l.id)
        buoc = cv.ten_cong_doan if cv is not None else None
        pct = round(float(tien_do.phan_tram(bc, l.id)[0]), 1)
    # Kiểu làm của lệnh: lần gia công ngoài đã có (kể cả đã xong) nói lệnh này đi đường nào.
    song = [g for g in gcns if g.huy_luc is None]
    kieu = ("tron_goi" if any(g.kieu == "tron_goi" for g in song)
            else "mot_phan" if song else "xuong")
    return {"id": l.id, "ma": l.ma, "o": o, "kieu": kieu, "buoc": buoc, "pct": pct, "gia_cong": gc}


def tom_tat_nhieu_don(db: Session, orders: list, *, nguon_san: dict[int, list] | None = None,
                      lenh_san: dict[int, Lsx] | None = None, bc_san=None) -> dict[int, dict]:
    """`{order_id: {"mon": [...], "dang_cho": [...]}}` cho các đơn ĐÃ CHỐT. Đơn khác vắng mặt.

    Tiến độ một đơn đã nạp sẵn mọi thứ dưới đây — truyền vào để khỏi nạp lần hai (trước 06/10/2026
    `tien-do` nạp bối cảnh lệnh HAI lần, ~1/3 số câu SQL của nó):
      · `nguon_san`: `nguon_giao_theo_cum` theo đơn;
      · `lenh_san`: lệnh theo id, phải phủ mọi lệnh của các cụm;
      · `bc_san`: `boi_canh.nap` của đúng tập lệnh đã xuống xưởng trong `lenh_san`."""
    from .lenh_sx import boi_canh

    orders = [o for o in orders if o is not None and o.status == STATUS_ORDERED]
    if not orders:
        return {}
    svc = DeliveryService(DeliveryRepository(db), OrderRepository(db), EmployeeRepository(db), None, None)
    san = nguon_san or {}
    # Nguồn giao của mọi đơn còn thiếu nạp GỘP một lượt — dựng từng đơn là ~16 câu SQL mỗi đơn.
    moi = svc.nguon_giao_theo_cum_nhieu(
        [o for o in orders if o.san_xuat_released_at is not None and san.get(o.id) is None])
    nguon = {o.id: (san.get(o.id) if san.get(o.id) is not None else moi[o.id])
             if o.san_xuat_released_at is not None else []
             for o in orders}
    lsx_ids = sorted({s for ns in nguon.values() for n in ns for s in n["lsx_ids"]})
    if lenh_san is not None and all(i in lenh_san for i in lsx_ids):
        lenh: dict[int, Lsx] = lenh_san
    else:
        lenh, bc_san = (XepLichLenhRepository(db).lsx_theo_ids(lsx_ids) if lsx_ids else {}), None
    chay = [i for i in lsx_ids if lenh[i].trang_thai in TT_DA_XUONG_XUONG]
    bc = bc_san if bc_san is not None else (boi_canh.nap(db, chay) if chay else None)
    gcn_theo_lenh: dict[int, list] = {}
    for lsx_id, g, _bg in GiaCongNgoaiRepository(db).cua_nhieu_lenh(lsx_ids):
        gcn_theo_lenh.setdefault(lsx_id, []).append(g)
    hd = AccountingRepository(db).issued_invoice_sums([o.id for o in orders])
    tong = OrderRepository(db).money_sums([o.id for o in orders])

    ra: dict[int, dict] = {}
    for o in orders:
        if o.san_xuat_released_at is None:
            ra[o.id] = {"mon": [], "dang_cho": [CHO_COC]}
            continue
        mons = []
        cho: set[str] = set()
        for n in nguon[o.id]:
            c = n["cum"]
            ds = [_lenh_mot(bc, lenh[i], gcn_theo_lenh.get(i, [])) for i in n["lsx_ids"]]
            giao_thang = int(n.get("giao_thang", 0))
            # Hàng ĐÃ CÓ = đã giao (kể cả giao thẳng) + đang giữ cho yêu cầu + còn giao được từ tồn
            # của mã. Từ 11/10/2026 (mg 0394) tồn của mã là hàng của khách, nên món có lệnh cũng tính
            # được hàng làm dư của đơn trước — không chỉ phần kho nhận từ lệnh của chính đơn.
            co = n["da_giao"] + n["dang_giu"] + n["giao_duoc"]
            co = max(0.0, min(float(n["dat"]), float(co)))
            # Phần đã có KHÔNG đến từ lệnh của chính đơn (tồn có sẵn của mã) — để câu chữ nói đúng
            # nguồn, đừng ghi "kho đã nhận đủ" khi kho chưa nhận gì từ lệnh (12/10/2026).
            tu_lenh = min(co, float(n.get("kho_da_nhan", 0)) + giao_thang)
            du = co >= n["dat"]
            if du:
                o_cum = O_DU_HANG
            elif not ds:
                o_cum = O_CHUA_LENH
            else:
                o_cum = min((x["o"] for x in ds), key=_THU_TU_O.index)
                if o_cum == O_DU_HANG:      # mọi lệnh "xong" mà hàng chưa đủ ⇒ chờ KCS / kho
                    o_cum = O_CHO_KHO
                # Lệnh đã ĐÓNG hết và kho không còn phiếu KCS nào chờ nhận ⇒ chẳng còn gì đang tới:
                # là đóng THIẾU, không phải "chờ KCS" (11/10/2026 — DH002 đóng lệnh ở 240/1.000 cuốn
                # mà màn vẫn báo chờ KCS gửi kho). Đơn chuyển sang giao phần đã có.
                if (o_cum == O_CHO_KHO and all(lenh[i].trang_thai == TT_DA_DONG for i in n["lsx_ids"])
                        and n["kho_de_nghi"] - n["kho_da_nhan"] <= 1e-9):
                    o_cum = O_DONG_THIEU
            if not du and not n["khach_nhan_du"] and o_cum != O_DONG_THIEU:
                # Khách đã nhận đủ thì sản xuất / kho không còn giữ đơn — sổ kho có trễ cũng vậy.
                for x in ds or [{"o": O_CHUA_LENH}]:
                    if x["o"] in _O_SANG_CHO:
                        cho.add(_O_SANG_CHO[x["o"]])
            mons.append({
                "khoa": c.khoa, "ten": c.ten, "don_vi": getattr(c.dong_dau, "don_vi_tinh", None),
                "dat": n["dat"], "co_hang": round(co, 3), "co_tu_ton": round(co - tu_lenh, 3),
                "du_hang": du, "o": o_cum,
                "co_lenh": n["co_lenh"], "tu_ton": not n["co_lenh"] and du,
                "giao_thang": giao_thang, "da_giao": n["da_giao"], "con_phai_giao": n["con_phai_giao"],
                "khach_nhan_du": n["khach_nhan_du"],
                "lenh": ds,
            })
        if not cho:
            giao_du = bool(mons) and all(m["khach_nhan_du"] for m in mons)
            if not giao_du:
                cho.add(CHO_GIAO)
            else:
                tong_vat = int(tong.get(o.id, {}).get("total_with_vat", 0) or 0)
                cho.add(CHO_HOA_DON if hd.get(o.id, 0) < tong_vat else CHO_XONG)
        ra[o.id] = {"mon": mons, "dang_cho": [c for c in CHO_TAT_CA if c in cho]}
    return ra
