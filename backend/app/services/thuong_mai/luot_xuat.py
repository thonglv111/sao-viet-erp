"""Lượt xuất hàng của đơn thương mại (docs/design-hang-thuong-mai-ha-phuong.md §6 "Xuất hàng").

Bấm "Xuất hàng" ở đơn đã chốt ⇒ một `LuotXuatThuongMai` + một yêu cầu XUẤT kho ở kho đã chọn
(`stock_requests.luot_xuat_tm_id`). Không đi qua Giao hàng, không tạo chuyến.

Người bán có cả quyền lập phiếu kho (`kho:create`) lẫn quyền của chính kho đó (`ton_kho_<id>:read`) thì
`ghi_so=True` làm luôn hai việc trong một lần bấm: lập phiếu xuất theo lô gợi ý (FEFO → FIFO) và ghi
sổ. Không đủ tồn thì chặn như mọi phiếu xuất vượt tồn — luật kho có sẵn, không viết lại.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ...models.kho_hang import KhoHang
from ...models.order import STATUS_ORDERED, Order, OrderLine
from ...models.stock_request import REQ_CANCELLED, REQ_DONE, REQ_XUAT, StockRequest
from ...models.thuong_mai import (
    LXTM_CHO_XUAT, LXTM_DA_XUAT, LXTM_HUY, LuotXuatThuongMai, LuotXuatThuongMaiDong,
)
from ...repositories.thuong_mai_repo import ThuongMaiRepository
from .don_thuong_mai import DonThuongMaiError, DonThuongMaiNotFound, la_don_thuong_mai, ma_dvt_cua_dong


def da_dung_theo_dong(db: Session, order_id: int) -> dict[int, int]:
    return ThuongMaiRepository(db).da_dung_theo_dong(order_id)


class LuotXuatService:
    def __init__(self, db: Session, *, request_service, voucher_service=None) -> None:
        self.db = db
        self.requests = request_service
        self.vouchers = voucher_service
        self.repo = ThuongMaiRepository(db)

    def danh_sach(self, order_id: int) -> list[LuotXuatThuongMai]:
        return self.repo.luot_cua_don(order_id)

    def tao(self, *, order: Order, actor, kho_id: int, lines: list[dict], ghi_chu: str | None = None,
            ghi_so: bool = False) -> tuple[LuotXuatThuongMai, StockRequest]:
        """Lập lượt + yêu cầu xuất kho, CHƯA commit phần ghi sổ (người gọi gọi `ghi_so_ngay` sau)."""
        if not la_don_thuong_mai(order):
            raise DonThuongMaiNotFound("Không tìm thấy đơn thương mại")
        if order.status != STATUS_ORDERED:
            raise DonThuongMaiError("Chỉ xuất hàng cho đơn đã chốt.")
        kho = kho_xuat_thuong_mai(self.db, kho_id)
        dong_don = {ln.id: ln for ln in order.lines}
        da_dung = self.repo.da_dung_theo_dong(order.id)
        gom: dict[int, int] = {}
        for ln in lines or []:
            ol = dong_don.get(int(ln.get("order_line_id") or 0))
            if ol is None:
                raise DonThuongMaiError("Dòng xuất không thuộc đơn này.")
            sl = ln.get("qty")
            try:
                qty = int(sl or 0)
            except (TypeError, ValueError):
                raise DonThuongMaiError("Số lượng phải là số nguyên.") from None
            if qty == 0:
                continue
            if qty < 0 or float(sl) != qty:
                raise DonThuongMaiError(f"SL xuất của «{ol.description}» phải là số nguyên lớn hơn 0.")
            gom[ol.id] = gom.get(ol.id, 0) + qty
        if not gom:
            raise DonThuongMaiError("Nhập SL xuất cho ít nhất một dòng.")
        for ol_id, qty in gom.items():
            ol = dong_don[ol_id]
            con = int(ol.qty or 0) - da_dung.get(ol_id, 0)
            if qty > con:
                raise DonThuongMaiError(f"«{ol.description}» chỉ còn {max(con, 0)} chưa xuất.")

        so_luot = self.repo.dem_luot(order.id)
        luot = LuotXuatThuongMai(order_id=order.id, ma=f"{order.order_no}-X{so_luot + 1}",
                                 kho_id=kho.id, trang_thai=LXTM_CHO_XUAT, nguoi_lap_id=actor.id,
                                 ghi_chu=(ghi_chu or None))
        self.db.add(luot)
        self.db.flush()
        req_lines = []
        for ol_id, qty in gom.items():
            ol = dong_don[ol_id]
            dvt = ma_dvt_cua_dong(self.db, ol)
            if not dvt:
                raise DonThuongMaiError(f"«{ol.description}» thiếu đơn vị tính.")
            req_lines.append({"hang_loai": "vat_tu", "hang_id": int(ol.hang_thuong_mai_id),
                              "dvt": dvt, "sl_de_nghi": qty,
                              "ghi_chu": f"{order.order_no}: {ol.description}"})
        try:
            req = self.requests.create(
                user=actor, loai=REQ_XUAT, lines=req_lines, commit=False, kho_id=kho.id,
                ghi_chu=f"Xuất bán đơn thương mại {order.order_no} ({luot.ma})", luot_xuat_tm_id=luot.id)
        except Exception as e:  # lỗi nghiệp vụ của kho (ĐVT chưa quy đổi được…) ⇒ 400 rõ lý do
            raise DonThuongMaiError(str(e)) from None
        luot.stock_request_id = req.id
        # Dòng yêu cầu sinh đúng thứ tự `req_lines` ⇒ nối dòng lượt theo cùng thứ tự.
        rls = sorted(req.lines, key=lambda r: r.id)
        for (ol_id, qty), rl in zip(gom.items(), rls):
            self.db.add(LuotXuatThuongMaiDong(luot_id=luot.id, order_line_id=ol_id,
                                              stock_request_line_id=rl.id, qty=qty))
        self.db.flush()
        return luot, req

    def ghi_so_ngay(self, *, req: StockRequest, actor) -> None:
        """Lập phiếu xuất theo lô gợi ý rồi ghi sổ luôn (một lần bấm). Thiếu tồn ⇒ lỗi, không lập
        phiếu non. Gọi SAU khi lượt + yêu cầu đã commit."""
        if self.vouchers is None:
            raise DonThuongMaiError("Không ghi sổ được lúc này.")
        req = self.db.get(StockRequest, req.id)
        dong: list[dict] = []
        for rl in sorted(req.lines, key=lambda r: r.id):
            qd = self.vouchers.hang.quy_ve_goc(rl.hang_loai, rl.hang_id, rl.dvt, float(rl.sl_duyet))
            sl_goc = float(qd["sl_goc"])
            he_so = sl_goc / float(rl.sl_duyet) if rl.sl_duyet else 1.0
            phan, thieu = self.vouchers.suggest_allocation(
                (rl.hang_loai, rl.hang_id), req.kho_id, sl_goc, request_id=req.id,
                goc=(qd.get("don_vi_goc") or None))
            if thieu > 0:
                raise DonThuongMaiError(
                    f"Kho không đủ hàng cho «{(rl.ghi_chu or '').split(': ', 1)[-1]}», còn thiếu "
                    f"{thieu:g} {qd.get('don_vi_goc') or rl.dvt}. Yêu cầu xuất vẫn nằm ở kho chờ.")
            for p in phan:
                so = float(p["so_luong"]) / he_so if he_so else float(p["so_luong"])
                dong.append({"request_line_id": rl.id, "so_luong": round(so, 4), "lot_id": p["lot_id"]})
        v = self.vouchers.create(user=actor, request_id=req.id, kho_id=req.kho_id, lines=dong, ghi_so=True)
        self.vouchers.post(v.id, actor)


# --- Móc kho ---------------------------------------------------------------------------------

def _luot_cua_yeu_cau(db: Session, request_id: int | None):
    if not request_id:
        return None, None
    req = db.get(StockRequest, int(request_id))
    if req is None or not getattr(req, "luot_xuat_tm_id", None):
        return req, None
    return req, db.get(LuotXuatThuongMai, int(req.luot_xuat_tm_id))


def _chot_da_xuat(db: Session, req: StockRequest, luot: LuotXuatThuongMai) -> None:
    sl_ung = {rl.id: float(rl.sl_da_ung or 0) for rl in req.lines}
    repo = ThuongMaiRepository(db)
    gia = repo.gia_von_theo_dong_yeu_cau(req.id)
    for d in luot.dong:
        d.qty_thuc = int(round(sl_ung.get(d.stock_request_line_id, 0)))
        d.gia_von = gia.get(d.stock_request_line_id)
    luot.trang_thai = LXTM_DA_XUAT
    luot.xuat_luc = datetime.now(timezone.utc)
    db.flush()
    # Giá vốn dòng đơn = Σ giá vốn các lượt đã xuất của dòng đó (cộng dồn qua các lượt).
    for ol_id in {d.order_line_id for d in luot.dong}:
        ol = db.get(OrderLine, ol_id)
        if ol is not None:
            ol.cost_snapshot = repo.tong_gia_von_dong_don(ol_id)


def _bao_ban_hang(luot: LuotXuatThuongMai) -> None:
    from ...doi_tuong_nhan import MAN_BAN_HANG
    from ...realtime import hub

    hub.gui({"type": "order_pending_changed", "luot_xuat_tm_id": luot.id}, quyen=MAN_BAN_HANG)


def kho_xuat_thuong_mai(db: Session, kho_id: int | None) -> KhoHang:
    """Kho xuất của đơn thương mại: đang dùng và có cờ kho hàng thương mại (13/11/2026)."""
    kho = db.get(KhoHang, int(kho_id or 0))
    if kho is None or not getattr(kho, "active", True):
        raise DonThuongMaiError("Chọn kho xuất.")
    if not getattr(kho, "la_kho_thuong_mai", False):
        raise DonThuongMaiError(f"{kho.ten} không phải kho hàng thương mại. Chọn kho khác, hoặc đánh dấu "
                                "kho này ở danh mục Khai báo kho.")
    return kho


def kho_ghi_so_luot_xuat(db: Session, request_id: int | None) -> None:
    """Kho vừa ghi sổ phiếu xuất của yêu cầu thuộc lượt xuất thương mại: yêu cầu đã xuất đủ ⇒ lượt "đã
    xuất", ghi SL thực xuất + giá vốn. Nuốt lỗi: phiếu kho đã ghi sổ đúng, phần phụ này không được
    làm hỏng nó."""
    try:
        req, luot = _luot_cua_yeu_cau(db, request_id)
        if luot is None or luot.trang_thai != LXTM_CHO_XUAT or req.trang_thai != REQ_DONE:
            return
        _chot_da_xuat(db, req, luot)
        db.commit()
        _bao_ban_hang(luot)
    except Exception:
        db.rollback()


def kho_huy_luot_xuat(db: Session, request_id: int | None) -> None:
    """Yêu cầu xuất của lượt bị huỷ (kho huỷ, người lập huỷ, hoặc huỷ phiếu nháp cuối): chưa xuất gì
    ⇒ lượt "huỷ"; đã xuất một phần ⇒ lượt chốt "đã xuất" với đúng SL đã ra khỏi kho."""
    try:
        req, luot = _luot_cua_yeu_cau(db, request_id)
        if luot is None or luot.trang_thai != LXTM_CHO_XUAT or req.trang_thai != REQ_CANCELLED:
            return
        if any(float(rl.sl_da_ung or 0) > 0 for rl in req.lines):
            _chot_da_xuat(db, req, luot)
        else:
            luot.trang_thai = LXTM_HUY
        db.commit()
        _bao_ban_hang(luot)
    except Exception:
        db.rollback()
