"""Theo dõi sản xuất THEO ĐƠN (12/10/2026) — một dòng một đơn, ngăn mở bằng bảng mặt hàng.

Mockup: `docs/mockups/theo-doi-don-san-xuat-3-phuong-an.html` (phương án A, bản 3).

Chỉ ĐỌC, không engine mới. Số theo đơn lấy đúng những hàm Đơn hàng bán đang dùng, để hai màn không
bao giờ nói khác nhau:
  · mặt hàng đang ở đâu / có bao nhiêu hàng — `don_hang_san_xuat.tom_tat_nhieu_don`;
  · nhập kho / đã giao / khách nhận đủ — `DeliveryService.nguon_giao_theo_cum`;
  · cờ của từng lệnh + dự kiến xong — `danh_sach._soi` (một lượt cho CẢ TẬP lệnh);
  · routing một lệnh — `ho_so._routing` (chỉ ở ngăn một đơn).

Phạm vi = luật Đơn hàng bán (`pham_vi.loc_don`). Trễ đo theo HẠN GIAO KHÁCH của đơn, không theo hạn
xong sản xuất của lệnh: kinh doanh hứa khách ngày giao.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import exists, or_, select
from sqlalchemy.orm import Session, selectinload

from ...models.customer import Customer
from ...models.department import Department
from ...models.lsx import TT_DA_DONG, TT_DA_XUONG_XUONG, Lsx, LsxCongDoan
from ...models.order import STATUS_ORDERED, Order, OrderLine
from ...models.san_xuat import BUOC_THUE_NGOAI, CV_DANG_CHAY, CV_HOAN_THANH, CV_TAM_DUNG
from ...models.user import User
from ...repositories.bai_ghep_repo import BaiGhepRepository
from ...repositories.delivery_repo import DeliveryRepository
from ...repositories.don_vi_do_repo import DonViDoRepository, nhan_don_vi
from ...repositories.employee_repo import EmployeeRepository
from ...repositories.gia_cong_ngoai_repo import GiaCongNgoaiRepository
from ...repositories.loc_danh_sach import dk_khoang_ngay
from ...repositories.order_repo import OrderRepository
from ...repositories.xep_lich_lenh_repo import XepLichLenhRepository
from .. import don_hang_san_xuat as dhsx
from ..delivery_service import DeliveryService
from ..gio_xuong import thuc_te_hien_thi
from ..thanh_pham_khai_bao import cum_ban
from . import danh_sach, pham_vi, tien_do, trang_thai

# Nhóm của một mặt hàng — thứ tự là thứ tự xếp trong ngăn (vướng lên đầu).
MON_VUONG = "vuong"
MON_DANG = "dang"
MON_CHUA = "chua"
MON_KHO = "kho"
MON_GIAO = "giao"
THU_TU_MON = (MON_VUONG, MON_DANG, MON_CHUA, MON_KHO, MON_GIAO)

# Chặng của đơn = chặng của mặt hàng chậm nhất.
CHANG = ("lenh", "sx", "kho", "giao", "xong")
_CHANG_CUA_O = {
    dhsx.O_CHUA_LENH: "lenh", dhsx.O_CHUA_XUONG: "lenh",
    dhsx.O_XUONG: "sx", dhsx.O_NGOAI: "sx",
    dhsx.O_CHO_KHO: "kho", dhsx.O_DONG_THIEU: "kho",
    dhsx.O_DU_HANG: "giao",
}

# Chip của danh sách. `can_de_y` cắt ngang ba chip còn lại.
CHIP_TAT_CA = "tat_ca"
CHIP_CAN_DE_Y = "can_de_y"
CHIP_DANG_LAM = "dang_lam"
CHIP_CHO_GIAO = "cho_giao"
CHIP_DA_GIAO = "da_giao"
CHIP = (CHIP_TAT_CA, CHIP_CAN_DE_Y, CHIP_DANG_LAM, CHIP_CHO_GIAO, CHIP_DA_GIAO)

# Cờ vướng của mặt hàng, thứ tự nặng → nhẹ. `tre` chỉ có ở cấp đơn (đo theo hạn giao khách);
# cờ `tre_han` của lệnh (đo theo hạn SX nội bộ) cố ý KHÔNG lên màn này.
CO_TRE = "tre"
CO_DONG_THIEU = "dong_thieu"
CO_CHUA_LENH = "chua_lenh"
THU_TU_CO = (
    CO_TRE, trang_thai.CO_SU_CO, trang_thai.CO_TAM_DUNG, trang_thai.CO_THIEU_VAT_TU,
    trang_thai.CO_KCS_KHONG_DAT, CO_DONG_THIEU, CO_CHUA_LENH,
)
_CO_LENH_LEN_MAN = (trang_thai.CO_SU_CO, trang_thai.CO_TAM_DUNG, trang_thai.CO_THIEU_VAT_TU,
                    trang_thai.CO_KCS_KHONG_DAT)

# "Còn mấy ngày" từ ngưỡng này trở xuống mà chưa đủ hàng ⇒ cần để ý (giả định ghi ở mockup).
NGAY_SAT_HAN = 3

# Mốc ngày của dải kỳ: (cột, là cột Date).
MOC = {"chot": (Order.ordered_at, False), "han_giao": (Order.delivery_committed_date, True)}
PAGE_SIZE_MAC_DINH = 25
PAGE_SIZE_TOI_DA = 200


def _ngay_xuong(dt: datetime | None) -> date | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tien_do.BUSINESS_TZ).date()


# --- tầng 1: tập đơn trong phạm vi + ô lọc (SQL) ---------------------------------------------------
def _cau_don(sale_ids: set[int] | None, *, q: str | None = None, khach_hang_id: int | None = None,
             phu_trach_id: int | None = None, tu_ngay: date | None = None,
             den_ngay: date | None = None, moc: str = "chot"):
    stmt = (select(Order).options(selectinload(Order.lines))
            .where(Order.status == STATUS_ORDERED, Order.san_xuat_released_at.is_not(None)))
    stmt = pham_vi.loc_don(stmt, sale_ids)
    if khach_hang_id is not None:
        stmt = stmt.where(Order.customer_id == khach_hang_id)
    if phu_trach_id is not None:
        stmt = stmt.where(pham_vi.chu_don() == phu_trach_id)
    cot, la_ngay = MOC.get(moc, MOC["chot"])
    for dk in dk_khoang_ngay(cot, tu_ngay, den_ngay, cot_ngay=la_ngay):
        stmt = stmt.where(dk)
    if q and q.strip():
        mau = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            Order.order_no.ilike(mau),
            exists().where(Customer.id == Order.customer_id, Customer.name.ilike(mau)),
            exists().where(OrderLine.order_id == Order.id, OrderLine.description.ilike(mau)),
            exists().where(Lsx.order_id == Order.id, Lsx.ma.ilike(mau)),
        ))
    return stmt


# --- tầng 2: tính từng đơn (một lượt cho cả tập) -------------------------------------------------
def _tinh(db: Session, orders: list[Order], bay_gio: datetime) -> tuple[dict[int, dict], dict, object]:
    """`({order_id: {"mon": [...]}}, lệnh theo id, BoiCanh|None)` — một lượt nạp cho cả tập."""
    svc = DeliveryService(DeliveryRepository(db), OrderRepository(db), EmployeeRepository(db), None, None)
    lo = svc.nguon_giao_theo_cum_nhieu(orders)
    nguon = {o.id: lo.get(o.id, []) for o in orders}
    lsx_ids = sorted({s for ns in nguon.values() for n in ns for s in n["lsx_ids"]})
    lenh = XepLichLenhRepository(db).lsx_theo_ids(lsx_ids)
    chay = [i for i in lsx_ids if lenh[i].trang_thai in TT_DA_XUONG_XUONG]
    bc, tinh = danh_sach._soi(db, chay, bay_gio) if chay else (None, {})
    tom = dhsx.tom_tat_nhieu_don(db, orders, nguon_san=nguon, lenh_san=lenh, bc_san=bc)
    ncc: dict[int, str | None] = {}
    tron_goi: set[int] = set()
    for lsx_id, g, _bg in GiaCongNgoaiRepository(db).cua_nhieu_lenh(lsx_ids):
        if g.kieu == "tron_goi":
            tron_goi.add(lsx_id)
            ncc[lsx_id] = g.nha_cung_cap_ten

    def lenh_mot(x: dict) -> dict:
        i = x["id"]
        l = lenh[i]
        cvs = bc.cong_viec_du(i) if (bc is not None and i in tinh) else []
        xong = l.trang_thai == TT_DA_DONG or (bool(cvs) and all(c.trang_thai == CV_HOAN_THANH for c in cvs))
        co = [c for c in (tinh.get(i, {}).get("canh_bao") or []) if c in _CO_LENH_LEN_MAN]
        if xong:
            # Lệnh đã xong: chỉ KCS không đạt còn là chuyện (lô lỗi nằm lại); sự cố, tạm dừng, vật
            # tư của một lệnh đã xong không còn giữ đơn.
            co = [c for c in co if c == trang_thai.CO_KCS_KHONG_DAT]
        buoc_so = buoc_tong = None
        if cvs:
            ds = danh_sach.chang(bc, i, danh_sach.buoc_hien_tai(bc, i))
            buoc_tong = len(ds)
            buoc_so = next((k + 1 for k, c in enumerate(ds) if c["hien_tai"]), None)
        return {
            "id": i, "ma": l.ma, "ten": l.ten, "o": x["o"], "xong": xong, "co": co,
            "da_xuong": i in tinh, "tron_goi": i in tron_goi or x.get("kieu") == "tron_goi",
            "nha_gia_cong": ncc.get(i) or (x.get("gia_cong") or {}).get("nha_cung_cap_ten"),
            "buoc": x.get("buoc"), "buoc_so": buoc_so, "buoc_tong": buoc_tong, "pct": x.get("pct"),
            "du_kien_xong": tinh.get(i, {}).get("xong"),
        }

    ra: dict[int, dict] = {}
    for o in orders:
        t = tom.get(o.id) or {"mon": []}
        theo_khoa = {n["cum"].khoa: n for n in nguon[o.id]}
        mons = []
        for m in t["mon"]:
            n = theo_khoa.get(m["khoa"]) or {}
            ls = [lenh_mot(x) for x in m["lenh"]]
            co = sorted({c for x in ls for c in x["co"]}, key=THU_TU_CO.index)
            if m["o"] == dhsx.O_DONG_THIEU:
                co.append(CO_DONG_THIEU)
            if m["khach_nhan_du"] or m["du_hang"]:
                # Đủ hàng thì lô lỗi hay sự cố của lệnh không còn giữ món này.
                co = []
            if m["khach_nhan_du"]:
                nhom = MON_GIAO
            elif m["du_hang"]:
                nhom = MON_KHO
            elif co:
                nhom = MON_VUONG
            elif m["o"] in (dhsx.O_CHUA_LENH, dhsx.O_CHUA_XUONG):
                nhom = MON_CHUA
            else:
                nhom = MON_DANG
            # Lệnh đại diện = lệnh chậm nhất (cùng luật chọn chỗ của cụm).
            dd = min(ls, key=lambda x: dhsx._THU_TU_O.index(x["o"])) if ls else None
            mons.append({
                "khoa": m["khoa"], "ten": m["ten"], "dat": m["dat"], "don_vi": m["don_vi"],
                "o": m["o"], "nhom": nhom, "co": co,
                "kho_da_nhan": round(float(n.get("kho_da_nhan", 0.0)), 3),
                "da_giao": int(m["da_giao"]),
                # Hàng ĐÃ CÓ tách nguồn (lệnh của đơn / tồn của mã) + phần đang giữ cho yêu cầu giao —
                # để ngăn khỏi báo "thiếu" khi tồn có sẵn đã phủ phần lệnh làm hụt (13/10/2026).
                "co_hang": float(m["co_hang"]), "co_tu_ton": float(m["co_tu_ton"]),
                "dang_giu": int(n.get("dang_giu", 0)), "con_phai_giao": int(m["con_phai_giao"]),
                "buoc": dd["buoc"] if dd else None,
                "buoc_so": dd["buoc_so"] if dd else None,
                "buoc_tong": dd["buoc_tong"] if dd else None,
                "pct": dd["pct"] if dd else None,
                "nha_gia_cong": dd["nha_gia_cong"] if dd else None,
                "lenh": ls,
            })
        dau = mons[0]["ten"] if mons else None
        mons.sort(key=lambda m: THU_TU_MON.index(m["nhom"]))
        ra[o.id] = {"mon": mons, "mon_dau": dau}
    return ra, lenh, bc


def _chang_mon(m: dict) -> str:
    return "xong" if m["nhom"] == MON_GIAO else _CHANG_CUA_O.get(m["o"], "lenh")


def _dong_don(o: Order, t: dict, *, khach: str | None, phu_trach: str | None, hom_nay: date) -> dict:
    """MỘT dòng danh sách từ các mặt hàng đã tính (`t` = phần của đơn trong `_tinh`)."""
    mons = t["mon"]
    so_mon = len(mons)
    chang = min((_chang_mon(m) for m in mons), key=CHANG.index, default="lenh")
    vuong = [m for m in mons if m["nhom"] == MON_VUONG]
    giao_xong = so_mon > 0 and all(m["nhom"] == MON_GIAO for m in mons)
    du_hang = so_mon > 0 and all(m["nhom"] in (MON_KHO, MON_GIAO) for m in mons)

    # Dự kiến xong của đơn = lệnh xong muộn nhất; một lệnh chưa ước được (hoặc chưa xuống xưởng)
    # là cả đơn chưa ước được.
    moc: list[datetime] = []
    thieu = False
    for m in mons:
        if m["nhom"] in (MON_KHO, MON_GIAO):
            continue
        if not m["lenh"]:
            thieu = True
        for x in m["lenh"]:
            if x["xong"]:
                continue
            if x["du_kien_xong"] is None:
                thieu = True
            else:
                moc.append(x["du_kien_xong"])
    du_kien = max(moc) if moc and not thieu else None

    han = o.delivery_committed_date
    tre = con = None
    if han is not None and not giao_xong:
        con = (han - hom_nay).days
        mau = _ngay_xuong(du_kien) if (du_kien is not None and not du_hang) else None
        if con < 0:
            tre = -con
        elif mau is not None and mau > han:
            tre = (mau - han).days

    co_don = sorted({c for m in mons for c in m["co"]}, key=THU_TU_CO.index)
    if tre:
        co_don.insert(0, CO_TRE)
    elif any(m["o"] == dhsx.O_CHUA_LENH and m["nhom"] != MON_KHO for m in mons):
        co_don.append(CO_CHUA_LENH)
    ly_do = co_don[0] if co_don else None
    buoc_vuong = None
    if ly_do and ly_do not in (CO_TRE, CO_CHUA_LENH, CO_DONG_THIEU):
        buoc_vuong = next((x["buoc"] for m in vuong for x in m["lenh"] if ly_do in x["co"] and x["buoc"]), None)

    nhom = CHIP_DA_GIAO if giao_xong else CHIP_CHO_GIAO if du_hang else CHIP_DANG_LAM
    can_de_y = not giao_xong and (
        bool(vuong) or bool(tre) or (con is not None and con <= NGAY_SAT_HAN and not du_hang)
    )
    dau = mons[0] if mons else None
    # Đại diện = món chậm nhất: chặng sớm nhất, rồi chỗ chậm nhất trong chặng.
    cham = min(mons, key=lambda m: (CHANG.index(_chang_mon(m)), dhsx._THU_TU_O.index(m["o"]))) if mons else None
    return {
        "order_id": o.id,
        "order_no": o.order_no,
        "khach_hang": khach,
        "phu_trach": phu_trach,
        "so_mon": so_mon,
        "mon_dau": t.get("mon_dau"),
        "so_luong": dau["dat"] if so_mon == 1 else None,
        "don_vi": dau["don_vi"] if so_mon == 1 else None,
        "chang": chang,
        "chang_ket": bool(vuong) or bool(tre),
        "dai_dien": _tom_tat_mon(cham) if cham else None,
        "so_mon_kho": sum(1 for m in mons if m["nhom"] in (MON_KHO, MON_GIAO)),
        "so_mon_giao": sum(1 for m in mons if m["nhom"] == MON_GIAO),
        "han_giao": han,
        "du_kien_xong": thuc_te_hien_thi(du_kien),
        "tre_ngay": tre,
        "con_ngay": con,
        "vuong": {"so_mon": len(vuong), "ly_do": ly_do, "buoc": buoc_vuong} if ly_do else None,
        "nhom": nhom,
        "can_de_y": can_de_y,
    }


def _giao_xong(db: Session, orders: list[Order]) -> set[int]:
    """Đơn mà khách đã thực nhận đủ MỌI dòng — MỘT câu cho cả tập. Đơn này không cần tính sản
    xuất / kho nữa (dòng của nó dựng nhẹ ở `_dong_da_giao`), nên danh sách không phình theo số đơn
    đã giao từ lâu."""
    da = DeliveryRepository(db).da_giao_theo_dong_nhieu_don([o.id for o in orders])
    return {o.id for o in orders
            if o.lines and all(da.get(ln.id, 0) >= int(ln.qty or 0) for ln in o.lines)}


def _dong_da_giao(o: Order, *, khach: str | None, phu_trach: str | None) -> dict:
    cums = cum_ban(o)
    dau = cums[0] if cums else None
    return {
        "order_id": o.id, "order_no": o.order_no, "khach_hang": khach, "phu_trach": phu_trach,
        "so_mon": len(cums), "mon_dau": dau.ten if dau else None,
        "so_luong": int(dau.so_luong) if dau and len(cums) == 1 else None,
        "don_vi": dau.dvt if dau and len(cums) == 1 else None,
        "chang": "xong", "chang_ket": False,
        "dai_dien": {
            "ten": dau.ten, "o": dhsx.O_DU_HANG, "nhom": MON_GIAO, "dat": int(dau.so_luong),
            "don_vi": dau.dvt, "kho_da_nhan": 0.0, "da_giao": int(dau.so_luong), "buoc": None,
            "buoc_so": None, "buoc_tong": None, "pct": None, "nha_gia_cong": None,
        } if dau else None,
        "so_mon_kho": len(cums), "so_mon_giao": len(cums),
        "han_giao": o.delivery_committed_date, "du_kien_xong": None, "tre_ngay": None,
        "con_ngay": None, "vuong": None, "nhom": CHIP_DA_GIAO, "can_de_y": False,
    }


def _tom_tat_mon(m: dict) -> dict:
    return {k: m[k] for k in ("ten", "o", "nhom", "dat", "don_vi", "kho_da_nhan", "da_giao",
                              "buoc", "buoc_so", "buoc_tong", "pct", "nha_gia_cong")}


def _ten_phu(db: Session, orders: list[Order]) -> tuple[dict[int, str], dict[int, str]]:
    """(tên khách theo order_id, tên chủ đơn theo order_id) — hai câu cho cả tập."""
    kh_ids = {o.customer_id for o in orders if o.customer_id}
    kh = {i: (n, s) for i, n, s in db.execute(
        select(Customer.id, Customer.name, Customer.sale_user_id).where(Customer.id.in_(kh_ids))
    ).all()} if kh_ids else {}
    chu = {o.id: ((kh.get(o.customer_id) or (None, None))[1] or o.sale_user_id) for o in orders}
    u_ids = {c for c in chu.values() if c}
    ten_u = {i: n for i, n in db.execute(
        select(User.id, User.name).where(User.id.in_(u_ids))
    ).all()} if u_ids else {}
    return ({o.id: (kh.get(o.customer_id) or (None,))[0] for o in orders},
            {o.id: ten_u.get(chu[o.id]) for o in orders})


def _khoa_sap(d: dict) -> tuple:
    """Cần để ý trước → đã giao xong xuống cuối → hạn giao gần trước (chưa có hạn xuống cuối) → mã."""
    han = d["han_giao"]
    return (0 if d["can_de_y"] else 1, 1 if d["nhom"] == CHIP_DA_GIAO else 0,
            0 if han is not None else 1, han or date.max, d["order_no"] or "")


def theo_don(
    db: Session, *, sale_ids: set[int] | None, q: str | None = None,
    khach_hang_id: int | None = None, phu_trach_id: int | None = None, chip: str | None = None,
    tu_ngay: date | None = None, den_ngay: date | None = None, moc: str = "chot",
    page: int = 1, page_size: int = PAGE_SIZE_MAC_DINH, bay_gio: datetime | None = None,
) -> dict:
    """`{items, total, page, page_size, dem}` — lọc, đếm chip và cắt trang ở MÁY CHỦ.

    `dem` là FACET của tập đã lọc, không bị chính `chip` lọc lại."""
    bay_gio = bay_gio or datetime.now(timezone.utc)
    page = max(1, page)
    page_size = max(1, min(page_size, PAGE_SIZE_TOI_DA))
    orders = list(db.execute(_cau_don(
        sale_ids, q=q, khach_hang_id=khach_hang_id, phu_trach_id=phu_trach_id,
        tu_ngay=tu_ngay, den_ngay=den_ngay, moc=moc,
    )).scalars())
    xong = _giao_xong(db, orders)
    tinh, _lenh, _bc = _tinh(db, [o for o in orders if o.id not in xong], bay_gio)
    khach, phu = _ten_phu(db, orders) if orders else ({}, {})
    hom_nay = _ngay_xuong(bay_gio)
    dong = []
    for o in orders:
        if o.id in xong:
            dong.append(_dong_da_giao(o, khach=khach.get(o.id), phu_trach=phu.get(o.id)))
        else:
            dong.append(_dong_don(o, tinh[o.id], khach=khach.get(o.id), phu_trach=phu.get(o.id),
                                  hom_nay=hom_nay))
    dem = {c: 0 for c in CHIP}
    dem[CHIP_TAT_CA] = len(dong)
    for d in dong:
        dem[d["nhom"]] += 1
        if d["can_de_y"]:
            dem[CHIP_CAN_DE_Y] += 1
    if chip == CHIP_CAN_DE_Y:
        dong = [d for d in dong if d["can_de_y"]]
    elif chip and chip != CHIP_TAT_CA:
        dong = [d for d in dong if d["nhom"] == chip]
    dong.sort(key=_khoa_sap)
    dau = (page - 1) * page_size
    return {"items": dong[dau:dau + page_size], "total": len(dong), "page": page,
            "page_size": page_size, "dem": dem}


# --- ngăn một đơn -------------------------------------------------------------------------------
_TT_BUOC = {CV_HOAN_THANH: danh_sach.CHANG_XONG, CV_DANG_CHAY: danh_sach.CHANG_CHAY,
            CV_TAM_DUNG: danh_sach.CHANG_DUNG}


def _buoc_cua_lenh(db: Session, bc, lenh_ids: list[int]) -> dict[int, list[dict]]:
    """Routing dọc của từng lệnh đã xuống xưởng: tên bước, ai làm (tổ / nhà gia công), trạng thái
    bằng chữ, ngày xong, số không đạt KCS. Dựng bằng `ho_so._routing` — cùng phần dựng với Hồ sơ lệnh."""
    from .ho_so import _routing

    if bc is None or not lenh_ids:
        return {}
    buocs: dict[int, list[LsxCongDoan]] = {i: [] for i in lenh_ids}
    for b in db.execute(select(LsxCongDoan).where(LsxCongDoan.lsx_id.in_(lenh_ids))
                        .order_by(LsxCongDoan.thu_tu, LsxCongDoan.id)).scalars():
        buocs[b.lsx_id].append(b)
    chung = BaiGhepRepository(db).buoc_chung_phu_lsx(lenh_ids)
    to_ids = {b.department_id for ds in buocs.values() for b in ds if b.department_id}
    to_ids |= {cv.department_id for i in lenh_ids for cv in bc.cong_viec_du(i) if cv.department_id}
    to_ids |= {c.department_id for c, _ in chung.values() if c.department_id}
    ten_to = {i: n for i, n in db.execute(
        select(Department.id, Department.name).where(Department.id.in_(to_ids))
    ).all()} if to_ids else {}
    dv_ten = DonViDoRepository(db).ten_theo_ma()
    ra: dict[int, list[dict]] = {}
    for i in lenh_ids:
        r = _routing(bc, i, buocs[i], ten_to, {}, set(), chung)
        ra[i] = [{
            "ten": n["ten"],
            "to": n["to"],
            "ngoai": n["loai_buoc"] == BUOC_THUE_NGOAI or bool(n["nha_cung_cap"]),
            "nha_cung_cap": n["nha_cung_cap"],
            "trang_thai": _TT_BUOC.get(n["trang_thai"], danh_sach.CHANG_CHO),
            "hien_tai": bool(n["la_buoc_hien_tai"]),
            "hoan_thanh_luc": n["hoan_thanh_luc"],
            "kcs_khong_dat": n.get("kcs_khong_dat", 0.0),
            "lam_ra": n["lam_ra"],
            "ke_hoach_ra": n["so_luong_ra"],
            "don_vi_ra": nhan_don_vi(dv_ten, n["don_vi_ra"]) if n["don_vi_ra"] else None,
        } for n in r["nodes"]]
    return ra


def chi_tiet_don(db: Session, order_id: int, *, sale_ids: set[int] | None,
                 bay_gio: datetime | None = None) -> dict:
    """Ngăn MỘT đơn: dòng tóm tắt (cùng khuôn với danh sách) + bảng mặt hàng kèm routing từng lệnh.

    CHẶN TRƯỚC, DỰNG SAU: 404 khi đơn không có / chưa giao xưởng, 403 khi ngoài phạm vi."""
    o = db.get(Order, order_id)
    pham_vi.chan_don_ngoai_pham_vi(db, o, sale_ids)
    bay_gio = bay_gio or datetime.now(timezone.utc)
    tinh, lenh, bc = _tinh(db, [o], bay_gio)
    mons = tinh[o.id]["mon"]
    khach, phu = _ten_phu(db, [o])
    don = _dong_don(o, tinh[o.id], khach=khach.get(o.id), phu_trach=phu.get(o.id),
                    hom_nay=_ngay_xuong(bay_gio))
    # Lệnh trọn gói không có công việc nào: bày MỘT bước "Gia công trọn gói" (FE dựng) thay vì
    # routing mẫu không ai ghi.
    chay = [x["id"] for m in mons for x in m["lenh"] if x["da_xuong"] and not x["tron_goi"]]
    buoc = _buoc_cua_lenh(db, bc, chay)
    for m in mons:
        for x in m["lenh"]:
            ds = buoc.get(x["id"], [])
            if x["xong"]:
                # Lệnh đã xong thì không còn "bước hàng đang nằm".
                for b in ds:
                    b["hien_tai"] = False
            x["buoc_ds"] = ds
            # Số làm ra của lệnh = số tốt ở bước CUỐI routing, theo đơn vị của bước đó.
            cuoi = ds[-1] if ds else None
            x["lam_ra"] = cuoi["lam_ra"] if cuoi else None
            x["ke_hoach_ra"] = cuoi["ke_hoach_ra"] if cuoi else None
            x["don_vi_ra"] = cuoi["don_vi_ra"] if cuoi else None
        # Làm ra của món chỉ nói khi mọi lệnh ra cùng đơn vị món (Ruột + Bìa ra "tờ" thì im).
        lr = [x for x in m["lenh"] if x.get("lam_ra") is not None]
        m["lam_ra"] = (min(x["lam_ra"] for x in lr)
                       if lr and len(lr) == len(m["lenh"]) and all(x["don_vi_ra"] == m["don_vi"] for x in lr)
                       else None)
    return {"don": don, "mon": mons, "giao_xuong_luc": o.san_xuat_released_at,
            "lich_su": _lich_su_don(db, bc, o, lenh, chay)}


def _lich_su_don(db: Session, bc, o: Order, lenh: dict, lenh_ids: list[int]) -> list[dict]:
    """Nhật ký cấp ĐƠN (13/10/2026): giao xưởng, bước xong, KCS, sự cố, kho nhận, giao hàng — mới
    nhất lên đầu. Đọc từ bối cảnh đã nạp; dòng kho của nhóm lặp ở mỗi lệnh nên gộp theo `line_id`.
    Chi tiết hơn (bắt đầu chạy, ghi sản lượng, giao người) ở tab Lịch sử của từng lệnh."""
    from ...models.delivery import (
        LAN_GIAO_CO_HANG_DEN_TAY, LG_THAT_BAI, DeliveryRequest, DeliveryStatusHistory, DeliveryTrip,
    )
    from .ho_so import _KCS_KET_LUAN_NHAN, _aware, _f

    ra: list[dict] = []

    def them(luc, loai, noi_dung, lsx_id=None):
        if luc is not None:
            ra.append({"luc": _aware(luc), "loai": loai, "noi_dung": noi_dung,
                       "lenh": lenh[lsx_id].ma if lsx_id in lenh else None})

    them(o.san_xuat_released_at, "giao_xuong", "Giao xưởng sản xuất")
    da_kho: set[int] = set()
    dv_ten = DonViDoRepository(db).ten_theo_ma() if bc is not None else {}
    for i in lenh_ids if bc is not None else []:
        for cv in bc.cong_viec_du(i):
            them(cv.hoan_thanh_luc, "xong_buoc", f"Xong {cv.ten_cong_doan}", i)
            for k in bc.kcs[cv.id]:
                them(k.ket_thuc, "kcs",
                     f"KCS {cv.ten_cong_doan}: {_f(k.so_luong_dat):g} đạt và {_f(k.so_luong_khong_dat):g} "
                     f"không đạt ({_KCS_KET_LUAN_NHAN.get(k.ket_luan or '', 'chưa rõ kết luận')})", i)
        for y in bc.su_co[i]:
            them(y.thoi_diem, "su_co", f"Báo sự cố {y.ma}" + (f": {y.bo_phan_hong}" if y.bo_phan_hong else ""), i)
        for d in bc.nhap_kho_tp[i]:
            if d.nhan_luc is None or d.line_id in da_kho:
                continue
            da_kho.add(d.line_id)
            them(d.nhan_luc, "kho_nhan",
                 f"Kho đã nhận {d.sl_da_nhan:g} {nhan_don_vi(dv_ten, d.dvt)} ({d.request_ma})", i)
    for r in db.execute(select(DeliveryRequest).where(DeliveryRequest.order_id == o.id)).scalars():
        them(r.created_at, "yeu_cau_giao", f"Tạo yêu cầu giao {r.code}")
    ket = (*LAN_GIAO_CO_HANG_DEN_TAY, LG_THAT_BAI)
    _NHAN = {"thanh_cong": "thành công", "giao_thieu": "giao thiếu", LG_THAT_BAI: "thất bại"}
    for h, ma, lan in db.execute(
        select(DeliveryStatusHistory, DeliveryRequest.code, DeliveryTrip.lan_thu)
        .join(DeliveryTrip, DeliveryTrip.id == DeliveryStatusHistory.trip_id)
        .join(DeliveryRequest, DeliveryRequest.id == DeliveryTrip.request_id)
        .where(DeliveryRequest.order_id == o.id, DeliveryStatusHistory.den_trang_thai.in_(ket))
    ).all():
        them(h.luc, "giao", f"Giao {ma} lần {lan}: {_NHAN.get(h.den_trang_thai, h.den_trang_thai)}")
    ra.sort(key=lambda e: e["luc"], reverse=True)
    return ra


def phu_trach_loc(db: Session, *, sale_ids: set[int] | None) -> list[dict]:
    """Ô "Phụ trách" của thanh lọc: chủ của các đơn đã giao xưởng trong phạm vi, kèm số đơn."""
    from sqlalchemy import func

    chu = pham_vi.chu_don().label("chu")
    sub = pham_vi.loc_don(
        select(chu).where(Order.status == STATUS_ORDERED, Order.san_xuat_released_at.is_not(None)),
        sale_ids,
    ).subquery()
    rows = db.execute(
        select(User.id, User.name, func.count()).join(sub, sub.c.chu == User.id)
        .group_by(User.id, User.name).order_by(User.name)
    ).all()
    return [{"id": i, "ten": t or f"Người dùng #{i}", "so": n} for i, t, n in rows]


def khach_loc(db: Session, *, sale_ids: set[int] | None) -> list[dict]:
    """Ô "Khách hàng": khách của các đơn đã giao xưởng trong phạm vi, kèm số đơn."""
    from sqlalchemy import func

    stmt = pham_vi.loc_don(
        select(Customer.id, Customer.name, func.count(Order.id))
        .join(Order, Order.customer_id == Customer.id)
        .where(Order.status == STATUS_ORDERED, Order.san_xuat_released_at.is_not(None)),
        sale_ids,
    ).group_by(Customer.id, Customer.name).order_by(Customer.name)
    return [{"id": i, "ten": t or f"Khách #{i}", "so": n} for i, t, n in db.execute(stmt).all()]
