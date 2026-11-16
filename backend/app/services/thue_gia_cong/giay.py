"""Giấy xưởng cấp cho nhà gia công TRỌN GÓI (C1, mockup tron-goi-cap-giay-C) — chọn khổ lúc lập Phiếu
giao. Đề xuất mã + khổ + số lượng theo dòng giấy của lệnh (thắng) hoặc quy cách lệnh; tồn mã đó chia
theo khổ (tờ theo khổ, cuộn theo rộng — kg)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.vat_lieu_kho import GiayNguyen
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.stock_lot_repo import StockLotRepository
from .tron_goi import de_xuat_giay


def goi_y_cap_giay(db: Session, viec, kho_ids: set[int] | None = None) -> dict | None:
    """None khi việc không phải trọn gói xưởng cấp giấy. `kho_ids` = tồn chỉ cộng các kho đó."""
    if viec is None or viec.lsx_id is None or not viec.xuong_cap_giay:
        return None
    lsx = SanXuatRepository(db).lsx(viec.lsx_id)
    if lsx is None:
        return None
    dx = de_xuat_giay(db, lsx)
    out = {"giay_id": dx["giay_id"], "giay_ma": None, "giay_ten": None, "don_vi": dx["don_vi"],
           "nguon": dx["nguon"], "de_xuat": None, "kho": [], "ly_do": None}
    if dx["giay_id"] is None:
        out["ly_do"] = "Lệnh chưa chọn loại giấy — chọn giấy ở Quy cách của lệnh rồi quay lại."
        return out
    g = db.get(GiayNguyen, dx["giay_id"])
    out["giay_ma"], out["giay_ten"] = getattr(g, "ma", None), getattr(g, "ten", None)
    khoa_dx = (dx["kho_rong"], dx["kho_dai"], dx["don_vi"])
    co_kho = bool(dx["kho_rong"] and (dx["kho_dai"] or dx["don_vi"] == "kg"))
    if co_kho:
        out["de_xuat"] = {"kho_rong": dx["kho_rong"], "kho_dai": dx["kho_dai"],
                          "so_to": dx["so_to"], "don_vi": dx["don_vi"]}
    ton = {(r, d, gc): t for r, d, gc, t in StockLotRepository(db).ton_giay_theo_kho(dx["giay_id"], kho_ids)}
    if co_kho:
        ton.setdefault(khoa_dx, 0.0)
    out["kho"] = [
        {"kho_rong": r, "kho_dai": d, "ton": t, "don_vi": gc,
         "dung_de_xuat": co_kho and (r, d, gc) == khoa_dx}
        for (r, d, gc), t in sorted(ton.items(), key=lambda x: (not (co_kho and x[0] == khoa_dx), -x[1], x[0]))
    ]
    return out
