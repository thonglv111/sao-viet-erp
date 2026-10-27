"""Repository — Lô kho + ngưỡng tồn (spec-kho-de-nghi §6–§7).

Nguyên tắc: **không có bảng "tồn"**. Tồn luôn được TÍNH bằng Σ `sl_con_lai` của các lô,
nên tồn không thể lệch với lịch sử nhập/xuất. Mọi câu hỏi về tồn đều đi qua đây.

Mặt hàng được nhận diện bằng CẶP `(hang_loai, hang_id)` trỏ `giay_nguyen`/`vat_tu_in_an`
(mg 0171) — dùng nguyên cặp làm khoá dict luôn, tuple hashable nên khỏi bịa chuỗi khoá.
Mọi `sl_*` ở đây đã ở ĐƠN VỊ GỐC của mặt hàng; quy đổi xảy ra ở service trước khi ghi.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import and_, case, func, or_, select, tuple_
from sqlalchemy.orm import Session

from .document_sequence_repo import DocumentSequenceRepository

from ..models.customer import Customer
from ..models.lsx import Lsx
from ..models.order import Order
from ..models.stock_lot import LOT_AVAILABLE, LOT_EMPTY, LOT_ISSUABLE, StockLot, StockThreshold
from ..models.stock_request import StockRequest, StockRequestLine
from ..models.stock_voucher import (
    VOUCHER_DRAFT, VOUCHER_NHAP, VOUCHER_XUAT, StockVoucher, StockVoucherLine,
)
from ..services.kho_giay import chuan_kho, co_don_vi_goc, kho_mo

# (hang_loai, hang_id) — một mặt hàng gốc.
Hang = tuple[str, int]


def goc_cua(lot: StockLot) -> int:
    """Id lô GỐC: lô nhập từ yêu cầu là gốc của chính nó; lô sinh ra do điều chuyển nhớ `lo_goc_id`."""
    return int(lot.lo_goc_id or lot.id)


_NGUON_TRONG = {"lsx_id": None, "lsx_ma": None, "order_id": None, "order_ma": None,
                "customer_id": None, "khach_hang": None, "don_gia_ban": None, "tu_kcs": False}


def _chon_nguon(khoa):
    """Cột nguồn (dòng yêu cầu → lệnh → đơn → khách), đứng sau cột `khoa` của câu gọi."""
    return select(
        khoa, StockRequestLine.lsx_id, StockRequestLine.don_gia_ban,
        StockRequest.san_xuat_cong_viec_id, Lsx.ma, Order.id, Order.order_no,
        Customer.id, Customer.name,
    )


def _dong_nguon(r) -> dict:
    return {
        "lsx_id": r[1], "lsx_ma": r[4], "order_id": r[5], "order_ma": r[6],
        "customer_id": r[7], "khach_hang": r[8],
        "don_gia_ban": int(r[2]) if r[2] is not None else None,
        "tu_kcs": r[3] is not None,
    }


class StockLotRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, lot_id: int) -> StockLot | None:
        return self.db.get(StockLot, lot_id)

    def get_for_update(self, lot_id: int) -> StockLot | None:
        """Đọc lô KHOÁ DÒNG — hai người cùng bổ sung dạng/khổ không đổi số lượng hai lần."""
        return self.db.execute(
            select(StockLot).where(StockLot.id == lot_id).with_for_update()
        ).scalar_one_or_none()

    def ma_phieu_xuat_nhap_tro_vao(self, lot_id: int) -> str | None:
        """Mã một phiếu XUẤT còn NHÁP có dòng trỏ vào lô (None nếu không có)."""
        return self.db.execute(
            select(StockVoucher.ma)
            .join(StockVoucherLine, StockVoucherLine.voucher_id == StockVoucher.id)
            .where(StockVoucherLine.lot_id == lot_id, StockVoucher.loai == VOUCHER_XUAT,
                   StockVoucher.trang_thai == VOUCHER_DRAFT)
            .limit(1)
        ).scalar_one_or_none()

    def set_vi_tri(self, lot_id: int, vi_tri: str | None) -> StockLot | None:
        """Sửa vị trí cất lô. Trả None nếu không có lô."""
        lot = self.get(lot_id)
        if lot is None:
            return None
        lot.vi_tri = vi_tri
        self.db.commit()
        self.db.refresh(lot)
        return lot

    def ghi_kho_goc(self, lot: StockLot, *, goc: str, kho_rong: int, kho_dai: int,
                    sl_ban_dau, sl_con_lai, don_gia_nhap: int | None = None) -> StockLot:
        """Ghi khổ + đơn vị gốc + số lượng đã đổi cho MỘT lô; KHÔNG commit (người gọi gộp với nhật ký)."""
        lot.don_vi_goc = goc
        lot.kho_rong = kho_rong
        lot.kho_dai = kho_dai
        lot.sl_ban_dau = sl_ban_dau
        lot.sl_con_lai = sl_con_lai
        if don_gia_nhap is not None:
            lot.don_gia_nhap = don_gia_nhap
        return lot

    def by_ids(self, ids) -> dict[int, StockLot]:
        """Nạp NHIỀU lô trong 1 query — tránh N+1 khi serialize danh sách phiếu xuất."""
        ids = [i for i in set(ids) if i is not None]
        if not ids:
            return {}
        rows = self.db.execute(select(StockLot).where(StockLot.id.in_(ids))).scalars()
        return {lot.id: lot for lot in rows}

    def next_ma_lo(self, ma_hang: str, ngay: date) -> str:
        """Mã lô LOT-<mã hàng>-<yymmdd>-<seq>. `seq` đếm trong NGÀY của mã hàng đó nên
        mã đọc được bằng mắt; `ma_lo` unique nên va chạm sẽ nổ ở DB chứ không âm thầm.

        `ma_hang` giờ là mã trong danh mục gốc (GY001 / VT004), không phải mã `materials` cũ.
        """
        ma = ma_hang.strip().upper()
        prefix = f"LOT-{ma}-{ngay:%y%m%d}-"
        # Bộ đếm theo (mã hàng, ngày): hai phiếu nhập cùng mặt hàng duyệt cùng lúc — hay hai dòng
        # cùng mặt hàng trong MỘT phiếu (session không autoflush nên lô thứ nhất chưa xuống DB) —
        # không còn cùng ra `-01` rồi vỡ UNIQUE.
        return DocumentSequenceRepository(self.db).cap_ma(
            f"lo:{ngay:%m%d}:{ma}", ngay.year, StockLot.ma_lo, prefix, rong=2,
        )

    def nguon_lo(self, lot_ids) -> dict[int, dict]:
        """`{lot_id: nguồn}` đọc ở LÔ GỐC: lô gốc → dòng phiếu nhập → dòng yêu cầu → lệnh → đơn → khách.

        Khoá: `lo_goc_id, lsx_id, lsx_ma, order_id, order_ma, customer_id, khach_hang, don_gia_ban,
        tu_kcs`. Lô không truy được dòng yêu cầu thì mọi khoá nguồn là None và `tu_kcs` False. Đơn /
        khách / giá bán KHÔNG chép qua mỗi lần điều chuyển — đọc một chỗ để không có hai số.
        Hai câu cho cả tập (lô → lô gốc, lô gốc → nguồn)."""
        ids = {int(i) for i in lot_ids if i}
        if not ids:
            return {}
        goc = {int(i): int(g or i) for i, g in self.db.execute(
            select(StockLot.id, StockLot.lo_goc_id).where(StockLot.id.in_(ids))).all()}
        rows = self.db.execute(
            _chon_nguon(StockVoucherLine.lot_id)
            .select_from(StockVoucherLine)
            .join(StockVoucher, StockVoucher.id == StockVoucherLine.voucher_id)
            .join(StockRequestLine, StockRequestLine.id == StockVoucherLine.request_line_id)
            .join(StockRequest, StockRequest.id == StockRequestLine.request_id)
            .outerjoin(Lsx, Lsx.id == StockRequestLine.lsx_id)
            .outerjoin(Order, Order.id == Lsx.order_id)
            .outerjoin(Customer, Customer.id == Order.customer_id)
            # Chỉ dòng phiếu NHẬP đẻ ra lô — dòng phiếu XUẤT cũng trỏ `lot_id` về lô này.
            .where(StockVoucherLine.lot_id.in_(set(goc.values())), StockVoucher.loai == VOUCHER_NHAP)
        ).all()
        theo_goc = {int(r[0]): _dong_nguon(r) for r in rows}
        return {i: {"lo_goc_id": g, **theo_goc.get(g, _NGUON_TRONG)} for i, g in goc.items()}

    def nguon_dong_yeu_cau(self, request_line_ids) -> dict[int, dict]:
        """`{request_line_id: nguồn}`, cùng khoá với `nguon_lo` trừ `lo_goc_id` — cho dòng phiếu NHẬP
        còn nháp: chưa có lô để truy nên đọc thẳng dòng yêu cầu nó ứng. Một câu cho cả tập."""
        ids = {int(i) for i in request_line_ids if i}
        if not ids:
            return {}
        rows = self.db.execute(
            _chon_nguon(StockRequestLine.id)
            .select_from(StockRequestLine)
            .join(StockRequest, StockRequest.id == StockRequestLine.request_id)
            .outerjoin(Lsx, Lsx.id == StockRequestLine.lsx_id)
            .outerjoin(Order, Order.id == Lsx.order_id)
            .outerjoin(Customer, Customer.id == Order.customer_id)
            .where(StockRequestLine.id.in_(ids))
        ).all()
        return {int(r[0]): _dong_nguon(r) for r in rows}

    def create(self, **data) -> StockLot:
        lot = StockLot(**data)
        self.db.add(lot)
        self.db.flush()
        return lot

    @staticmethod
    def _loc_kho(stmt, goc: str | None, kho_rong: int, kho_dai: int):
        """Lọc lô giấy theo ĐƠN VỊ GỐC và (khi dòng có khổ) đúng KHỔ — so bằng nhau tuyệt đối trên hai
        số đã chuẩn hoá (khổ chỉ-rộng `(r, 0)` không khớp khổ hai cạnh). Dòng chưa có khổ ⇒ không lọc
        khổ. `goc=None` ⇒ không lọc gì."""
        if goc is None:
            return stmt
        stmt = stmt.where(StockLot.don_vi_goc == (goc or "").strip().lower())
        kr, kd = chuan_kho(kho_rong, kho_dai)
        if kr:
            stmt = stmt.where(StockLot.kho_rong == kr, StockLot.kho_dai == kd)
        return stmt

    def issuable_lots(self, hang: Hang, kho_id: int, *, goc: str | None = None,
                      kho_rong: int = 0, kho_dai: int = 0) -> list[StockLot]:
        """Các lô còn hàng và được phép xuất, xếp theo gợi ý **FEFO rồi FIFO**: lô có hạn
        dùng gần nhất đi trước (tránh để quá date), hết hạn dùng thì tới lô nhập trước.

        Đây chỉ là GỢI Ý — thủ kho vẫn đổi được lô, vì BRD §3.19 chốt giá xuất là đích danh.

        Giấy: `goc` (+ khổ) lọc đúng đơn vị gốc/khổ dòng xin — lô khác đơn vị hoặc khác khổ không bao
        giờ được gợi ý.
        """
        stmt = (
            select(StockLot)
            .where(
                StockLot.hang_loai == hang[0],
                StockLot.hang_id == hang[1],
                StockLot.kho_id == kho_id,
                StockLot.sl_con_lai > 0,
                StockLot.trang_thai.in_(LOT_ISSUABLE),
            )
            # NULL hsd xuống cuối: lô không có hạn thì không việc gì phải ưu tiên xuất.
            .order_by(
                (StockLot.hsd.is_(None)).asc(),
                StockLot.hsd.asc(),
                StockLot.ngay_nhap.asc(),
                StockLot.id.asc(),
            )
        )
        return list(self.db.execute(self._loc_kho(stmt, goc, kho_rong, kho_dai)).scalars())

    def consume(self, lot: StockLot, qty: float) -> None:
        """Trừ `qty` khỏi lô. Lô hết hàng thì đánh dấu `empty` để khỏi lọt vào gợi ý xuất.

        KHÔNG kiểm tra đủ/thiếu ở đây — service đã chặn trước; repo chỉ ghi.
        """
        lot.sl_con_lai = float(lot.sl_con_lai) - qty
        # Ngưỡng epsilon thay vì `<= 0`: lô + dòng phiếu cùng scale 4dp nên xuất hết ra đúng 0, nhưng
        # phép trừ float từ Decimal có thể để lại bụi ~1e-14 → snap về 0 để lô chuyển 'empty' đúng
        # (1e-6 nhỏ hơn đơn vị nhỏ nhất 0.0001 nên không nuốt tồn thật).
        if float(lot.sl_con_lai) <= 1e-6:
            lot.sl_con_lai = 0
            lot.trang_thai = LOT_EMPTY

    def restore(self, lot: StockLot, qty: float) -> None:
        """TRẢ `qty` về lô (điều chỉnh xuất — SX dùng ít hơn số đã xuất). Ngược với `consume`.

        Lô đã xuất hết (`empty`) → CỘNG lại thì bật về `available` để xuất tiếp được; lô còn
        `available` thì chỉ cộng số. KHÔNG kiểm tra gì (service đã chặn); KHÔNG commit (service gom
        1 transaction). Chỉ bật lại từ `empty`: `hold`/`qc_wait`/`defect` là trạng thái CỐ Ý của
        người dùng, không tự đạp về `available`.
        """
        lot.sl_con_lai = float(lot.sl_con_lai) + qty
        if float(lot.sl_con_lai) > 1e-6 and lot.trang_thai == LOT_EMPTY:
            lot.trang_thai = LOT_AVAILABLE

    def on_hand(self, hang: tuple, kho_id: int | None = None) -> float:
        """**Tồn khả dụng** = Σ sl_con_lai của lô ở trạng thái xuất được, theo ĐƠN VỊ GỐC.

        Cố tình KHÔNG trả tồn thực tế: hàng chờ KCS / hàng lỗi nằm trong kho nhưng không
        dùng được, cộng vào là hứa suông với người yêu cầu (BRD §1.5).

        `hang` là cặp `(loai, id)` hoặc khoá tồn 5 phần tử — cùng luật `on_hand_map`.
        """
        return self.on_hand_map([hang], kho_id).get(tuple(hang), 0.0)

    def _tong_theo_khoa(self, keys: list[tuple], kho_id: int | None,
                        theo_kho: bool) -> dict[tuple, dict]:
        """Σ tồn khả dụng của từng khoá, chia theo kho (`theo_kho`) hoặc gom một ô `None`.

        Luật khoá: cặp 2 phần tử hoặc hàng không mang đơn vị gốc ⇒ gom mọi lô của mã; giấy / vật tư
        5 phần tử `(loai, id, rộng, dài, đơn vị gốc)` ⇒ chỉ lô đúng khổ + đúng đơn vị gốc (tờ và kg,
        thùng và kg không cộng lẫn). VẬT TƯ trống khổ (`kho_mo`) ⇒ cộng MỌI khổ cùng mã + đơn vị gốc
        (27/10/2026). Tối đa ba câu (theo mã / theo khoá 5 phần / theo mã + đơn vị gốc)."""
        def la5(k) -> bool:
            return len(k) == 5 and co_don_vi_goc(k[0])

        theo_ma = {(k[0], int(k[1])) for k in keys if not la5(k)}
        mo = {(k[0], int(k[1]), str(k[4] or "")) for k in keys if la5(k) and kho_mo(k)}
        giay = {(k[0], int(k[1]), int(k[2]), int(k[3]), str(k[4] or ""))
                for k in keys if la5(k) and not kho_mo(k)}
        base = [StockLot.trang_thai.in_(LOT_ISSUABLE)]
        if kho_id is not None:
            base.append(StockLot.kho_id == kho_id)
        if theo_kho:
            base.append(StockLot.sl_con_lai > 0)
        sl = func.coalesce(func.sum(StockLot.sl_con_lai), 0)
        cot_kho = [StockLot.kho_id] if theo_kho else []

        def gom(cot_khoa, *loc) -> dict[tuple, dict]:
            out: dict[tuple, dict] = {}
            for r in self.db.execute(select(*cot_khoa, *cot_kho, sl).where(*loc, *base)
                                     .group_by(*cot_khoa, *cot_kho)):
                n = len(cot_khoa)
                kho = r[n] if theo_kho else None
                if theo_kho and kho is None:
                    continue
                out.setdefault(tuple(r[:n]), {})[int(kho) if kho is not None else None] = float(r[-1] or 0)
            return out

        f_ma = gom([StockLot.hang_loai, StockLot.hang_id],
                   # `tuple_(...).in_(...)` lọc đúng CẶP: lọc rời hai cột quét nhầm tổ hợp không ai hỏi.
                   tuple_(StockLot.hang_loai, StockLot.hang_id).in_(sorted(theo_ma))) if theo_ma else {}
        cot_giay = [StockLot.hang_loai, StockLot.hang_id, StockLot.kho_rong, StockLot.kho_dai,
                    StockLot.don_vi_goc]
        f_giay = gom(cot_giay, tuple_(*cot_giay).in_(sorted(giay))) if giay else {}
        cot_mo = [StockLot.hang_loai, StockLot.hang_id, StockLot.don_vi_goc]
        f_mo = gom(cot_mo, tuple_(*cot_mo).in_(sorted(mo))) if mo else {}
        out: dict[tuple, dict] = {}
        for k in keys:
            if not la5(k):
                out[k] = f_ma.get((k[0], int(k[1])), {})
            elif kho_mo(k):
                out[k] = f_mo.get((k[0], int(k[1]), str(k[4] or "")), {})
            else:
                out[k] = f_giay.get((k[0], int(k[1]), int(k[2]), int(k[3]), str(k[4] or "")), {})
        return out

    def on_hand_map(self, hangs: list[tuple], kho_id: int | None = None) -> dict[tuple, float]:
        """Tồn khả dụng của NHIỀU mặt hàng trong ít query — dùng khi vẽ đèn tín hiệu cho cả
        danh sách đề nghị (tránh N+1). Khoá là cặp `(hang_loai, hang_id)` (gom mọi lô của mã, hành vi
        cũ) hoặc khoá tồn 5 phần tử `kho_giay.Khoa`; dict trả về khoá ĐÚNG như đầu vào."""
        if not hangs:
            return {}
        keys = [tuple(h) for h in hangs]
        return {k: v.get(None, 0.0) for k, v in self._tong_theo_khoa(keys, kho_id, False).items()}

    def ton_giay_theo_kho(self, giay_id: int) -> list[tuple[int, int, str, float]]:
        """Tồn khả dụng của MỘT mã giấy, chia theo khổ: `[(rộng, dài, đơn vị gốc, số lượng)]` — tờ
        đủ hai cạnh đếm tờ (`to`), cuộn `(rộng, 0)` đếm kg. Một câu GROUP BY, đi đúng chỉ mục
        `ix_stock_lots_giay_kho` — chọn khổ để cấp giấy cho nhà gia công."""
        rows = self.db.execute(
            select(StockLot.kho_rong, StockLot.kho_dai, StockLot.don_vi_goc,
                   func.sum(StockLot.sl_con_lai))
            .where(StockLot.hang_loai == "giay", StockLot.hang_id == int(giay_id),
                   StockLot.kho_rong > 0,
                   or_(and_(StockLot.don_vi_goc == "to", StockLot.kho_dai > 0),
                       and_(StockLot.don_vi_goc == "kg", StockLot.kho_dai == 0)),
                   StockLot.sl_con_lai > 0, StockLot.trang_thai.in_(LOT_ISSUABLE))
            .group_by(StockLot.kho_rong, StockLot.kho_dai, StockLot.don_vi_goc))
        return [(int(r), int(d), g, float(s or 0)) for r, d, g, s in rows]

    def on_hand_by_kho(self, hangs: list[tuple]) -> dict[tuple, dict[int, float]]:
        """Tồn khả dụng của từng khoá, TÁCH THEO KHO — để xếp hạng "kho nào có nhiều hàng
        nhất" khi gợi ý kho xuất. Khoá ngoài như `on_hand_map`, khoá trong là `kho_id`; kho không có
        lô nào của khoá thì vắng mặt (không phải 0 rải khắp)."""
        if not hangs:
            return {}
        keys = [tuple(h) for h in hangs]
        return {k: dict(v) for k, v in self._tong_theo_khoa(keys, None, True).items()}

    def list_lots(self, *, hang: Hang | None = None, kho_id: int | None = None,
                  con_hang: bool = True, goc: str | None = None,
                  kho_rong: int = 0, kho_dai: int = 0) -> list[StockLot]:
        stmt = self._loc_kho(select(StockLot), goc, kho_rong, kho_dai)
        if hang is not None:
            stmt = stmt.where(StockLot.hang_loai == hang[0], StockLot.hang_id == hang[1])
        if kho_id is not None:
            stmt = stmt.where(StockLot.kho_id == kho_id)
        if con_hang:
            stmt = stmt.where(StockLot.sl_con_lai > 0)
        return list(self.db.execute(stmt.order_by(StockLot.ngay_nhap.asc(), StockLot.id.asc())).scalars())

    def ton_theo_khoa(self, hang: Hang) -> list[tuple[str, int, int, float]]:
        """Tồn TOÀN XƯỞNG của MỘT mặt hàng tách theo khoá đơn vị gốc + khổ: `[(goc, rộng, dài, sl)]`,
        chỉ khoá còn hàng. Nguồn cột Tồn và gợi ý khổ ở form yêu cầu mua / yêu cầu nhập xuất."""
        stmt = (
            select(StockLot.don_vi_goc, StockLot.kho_rong, StockLot.kho_dai,
                   func.sum(StockLot.sl_con_lai))
            .where(StockLot.hang_loai == hang[0], StockLot.hang_id == hang[1],
                   StockLot.sl_con_lai > 0)
            .group_by(StockLot.don_vi_goc, StockLot.kho_rong, StockLot.kho_dai)
            .order_by(StockLot.don_vi_goc, StockLot.kho_rong, StockLot.kho_dai)
        )
        return [(d or "", int(r or 0), int(k or 0), float(sl or 0))
                for d, r, k, sl in self.db.execute(stmt).all()]

    def _stmt_lo_mat_hang(self, cols, hang: Hang, kho_id: int, *, tab: str, goc: str | None,
                          kho_rong: int, kho_dai: int):
        """Lô của MỘT dòng tồn tại MỘT kho, lọc theo tab ngăn mặt hàng:
        `lo_ton` = còn hàng · `nhap` = lô nhập thường (không sinh từ phiếu điều chuyển, kể cả lô đã
        hết) · `nhan_ve` = lô sinh từ phiếu điều chuyển."""
        stmt = self._loc_kho(select(*cols), goc, kho_rong, kho_dai).where(
            StockLot.hang_loai == hang[0], StockLot.hang_id == hang[1], StockLot.kho_id == kho_id)
        dc = select(StockVoucher.id).where(StockVoucher.dieu_chuyen.is_(True))
        if tab == "lo_ton":
            return stmt.where(StockLot.sl_con_lai > 0)
        if tab == "nhap":
            return stmt.where(or_(StockLot.voucher_id.is_(None), StockLot.voucher_id.not_in(dc)))
        return stmt.where(StockLot.voucher_id.in_(dc))

    def dem_lo_theo_tab(self, hang: Hang, kho_id: int, *, goc: str | None = None,
                        kho_rong: int = 0, kho_dai: int = 0) -> dict[str, int]:
        """Số lô của ba tab (`lo_ton`, `nhap`, `nhan_ve`) trong MỘT câu."""
        dc = select(StockVoucher.id).where(StockVoucher.dieu_chuyen.is_(True))
        la_dc = and_(StockLot.voucher_id.is_not(None), StockLot.voucher_id.in_(dc))
        stmt = self._loc_kho(select(
            func.coalesce(func.sum(case((StockLot.sl_con_lai > 0, 1), else_=0)), 0),
            func.coalesce(func.sum(case((la_dc, 0), else_=1)), 0),
            func.coalesce(func.sum(case((la_dc, 1), else_=0)), 0),
        ), goc, kho_rong, kho_dai).where(
            StockLot.hang_loai == hang[0], StockLot.hang_id == hang[1], StockLot.kho_id == kho_id)
        ton, nhap, nhan_ve = self.db.execute(stmt).one()
        return {"lo_ton": int(ton), "nhap": int(nhap), "nhan_ve": int(nhan_ve)}

    def trang_lo_mat_hang(self, hang: Hang, kho_id: int, *, tab: str, offset: int, limit: int,
                          goc: str | None = None, kho_rong: int = 0, kho_dai: int = 0) -> list[StockLot]:
        """Một trang lô theo tab — Lô tồn nhập trước đứng trước (FIFO, thứ tự lĩnh), lịch sử thì mới
        nhất trước để trang đầu là việc gần đây."""
        stmt = self._stmt_lo_mat_hang((StockLot,), hang, kho_id, tab=tab, goc=goc,
                                      kho_rong=kho_rong, kho_dai=kho_dai)
        thu_tu = ((StockLot.ngay_nhap.asc(), StockLot.id.asc()) if tab == "lo_ton"
                  else (StockLot.ngay_nhap.desc(), StockLot.id.desc()))
        return list(self.db.execute(stmt.order_by(*thu_tu).offset(offset).limit(limit)).scalars())

    #: Cột khoá tồn của một lô — giấy tách theo khổ + đơn vị gốc, mọi hàng khác các cột này bằng nhau.
    _COT_KHOA = (StockLot.hang_loai, StockLot.hang_id, StockLot.don_vi_goc, StockLot.kho_rong, StockLot.kho_dai)

    def list_lots_gon(self, *, kho_id: int, hangs: list[Hang] | None = None) -> list[StockLot]:
        """Lô CÒN HÀNG của kho + MỘT lô gần nhất cho mỗi khoá đã xuất hết.

        Màn Tồn kho cần lô đã hết chỉ để mặt hàng tồn 0 vẫn có dòng ("Hết"). Nạp mọi lô từng có
        (`con_hang=False`) thì danh sách phình mãi theo năm tháng trong khi phần hiển thị bỏ hết lô
        rỗng — lọc ở DB bằng cửa sổ: giữ lô > 0, hoặc lô mới nhất của khoá mà cả khoá đã về 0."""
        khoa = list(self._COT_KHOA)
        rn = func.row_number().over(partition_by=khoa,
                                    order_by=(StockLot.ngay_nhap.desc(), StockLot.id.desc())).label("rn")
        con = func.max(StockLot.sl_con_lai).over(partition_by=khoa).label("con")
        loc = select(StockLot.id.label("lot_id"), StockLot.sl_con_lai.label("sl"), rn, con).where(
            StockLot.kho_id == kho_id)
        if hangs is not None:
            # Chỉ các mặt hàng của trang đang xem (màn Tồn kho phân trang ở máy chủ).
            if not hangs:
                return []
            loc = loc.where(tuple_(StockLot.hang_loai, StockLot.hang_id).in_(sorted(set(hangs))))
        sub = loc.subquery()
        ids = select(sub.c.lot_id).where(or_(sub.c.sl > 0, and_(sub.c.rn == 1, sub.c.con <= 0)))
        stmt = select(StockLot).where(StockLot.id.in_(ids))
        return list(self.db.execute(stmt.order_by(StockLot.ngay_nhap.asc(), StockLot.id.asc())).scalars())

    def tong_hop_ton_theo_khoa(self, kho_id: int) -> list:
        """Mỗi khoá tồn thô (hàng, đơn vị gốc, khổ rộng, khổ dài) từng có lô trong kho MỘT dòng cộng sẵn:
        `tong` = Σ sl_con_lai lô khả dụng · `gia_tri` = Σ sl_con_lai × đơn giá nhập (lô khả dụng) ·
        `hsd_som` = hạn sớm nhất của lô CÒN hàng · `co_hsd` = có lô còn hàng khai hạn.

        Màn Tồn kho lọc/đếm/cắt trang trên các dòng này (vài nghìn mã) rồi mới nạp lô của đúng trang —
        không kéo mọi lô về. Người gọi gộp theo `khoa_ton_cua`."""
        kha_dung = StockLot.trang_thai == LOT_AVAILABLE
        con = StockLot.sl_con_lai > 0
        stmt = (
            select(
                *self._COT_KHOA,
                func.coalesce(func.sum(case((kha_dung, StockLot.sl_con_lai), else_=0)), 0).label("tong"),
                func.coalesce(func.sum(case(
                    (kha_dung, StockLot.sl_con_lai * func.coalesce(StockLot.don_gia_nhap, 0)),
                    else_=0)), 0).label("gia_tri"),
                func.min(case((and_(con, StockLot.hsd.is_not(None)), StockLot.hsd), else_=None)).label("hsd_som"),
            )
            .where(StockLot.kho_id == kho_id)
            .group_by(*self._COT_KHOA)
        )
        return list(self.db.execute(stmt).all())

    def khoa_co_lo_nhap_trong(self, kho_id: int, tu: date | None, den: date | None) -> set[tuple]:
        """Khoá tồn thô có ÍT NHẤT MỘT lô còn hàng nhập trong [tu, den] (bộ lọc "Nhập gần nhất")."""
        stmt = select(*self._COT_KHOA).where(StockLot.kho_id == kho_id, StockLot.sl_con_lai > 0)
        if tu is not None:
            stmt = stmt.where(StockLot.ngay_nhap >= tu)
        if den is not None:
            stmt = stmt.where(StockLot.ngay_nhap <= den)
        return {tuple(r) for r in self.db.execute(stmt.distinct()).all()}

    def khoa_trong_kho(self, kho_id: int) -> list:
        """Các bộ cột khoá tồn (DISTINCT) từng có lô trong kho — đủ cho `khoa_ton_cua`, khỏi nạp lô."""
        return list(self.db.execute(select(*self._COT_KHOA).where(StockLot.kho_id == kho_id).distinct()))


class StockThresholdRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    @staticmethod
    def _khoa5(hang: tuple) -> tuple[str, int, int, int, str]:
        """Cặp `(loai, id)` = khoá `(loai, id, 0, 0, "")` — ngưỡng của mã gom (vật tư)."""
        h = tuple(hang)
        if len(h) == 5:
            return (h[0], int(h[1]), int(h[2]), int(h[3]), str(h[4] or ""))
        return (h[0], int(h[1]), 0, 0, "")

    def get_for(self, hang: tuple, kho_id: int) -> StockThreshold | None:
        loai, hid, kr, kd, goc = self._khoa5(hang)
        return self.db.execute(
            select(StockThreshold).where(
                StockThreshold.hang_loai == loai,
                StockThreshold.hang_id == hid,
                StockThreshold.kho_rong == kr,
                StockThreshold.kho_dai == kd,
                StockThreshold.don_vi_goc == goc,
                StockThreshold.kho_id == kho_id,
            )
        ).scalars().first()

    def map_for(self, hangs: list[tuple], kho_id: int) -> dict[tuple, StockThreshold]:
        """`{khoá như đầu vào: ngưỡng}` — khoá 2 phần tử đọc ngưỡng `(…, 0, 0, "")`."""
        if not hangs:
            return {}
        theo5 = {self._khoa5(h): tuple(h) for h in hangs}
        rows = self.db.execute(
            select(StockThreshold).where(
                tuple_(StockThreshold.hang_loai, StockThreshold.hang_id,
                       StockThreshold.kho_rong, StockThreshold.kho_dai,
                       StockThreshold.don_vi_goc).in_(sorted(theo5)),
                StockThreshold.kho_id == kho_id,
            )
        ).scalars()
        out = {}
        for r in rows:
            k = theo5.get((r.hang_loai, r.hang_id, int(r.kho_rong or 0), int(r.kho_dai or 0),
                           r.don_vi_goc or ""))
            if k is not None:
                out[k] = r
        return out

    def list_active(self, kho_id: int | None = None) -> list[StockThreshold]:
        """Mọi ngưỡng đang bật cảnh báo — nguồn quét để đẩy nhắc realtime (spec §8). `kho_id` = chỉ
        ngưỡng của một kho (màn Tồn kho của kho đó)."""
        stmt = select(StockThreshold).where(StockThreshold.canh_bao.is_(True))
        if kho_id is not None:
            stmt = stmt.where(StockThreshold.kho_id == kho_id)
        return list(self.db.execute(stmt).scalars())

    def upsert(self, *, hang: tuple, kho_id: int, **data) -> StockThreshold:
        obj = self.get_for(hang, kho_id)
        if obj is None:
            loai, hid, kr, kd, goc = self._khoa5(hang)
            obj = StockThreshold(hang_loai=loai, hang_id=hid, kho_rong=kr, kho_dai=kd,
                                 don_vi_goc=goc, kho_id=kho_id, nguong_ton=0)
            self.db.add(obj)
        for k, v in data.items():
            setattr(obj, k, v)
        self.db.commit()
        self.db.refresh(obj)
        return obj
