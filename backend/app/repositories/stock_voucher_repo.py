"""Repository — Phiếu nhập/xuất kho (spec-kho-de-nghi §5)."""
from __future__ import annotations

from datetime import date

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..models.stock_lot import StockLot
from ..models.stock_request import StockRequest
from ..models.stock_voucher import (
    VOUCHER_DRAFT,
    VOUCHER_NHAP,
    VOUCHER_XUAT,
    StockVoucher,
    StockVoucherAttachment,
    StockVoucherLine,
)
from ..services.kho_giay import co_don_vi_goc
from .loc_danh_sach import dk_khoang_ngay

#: Mốc ngày của kỳ trên danh sách phiếu kho → (cột, là cột Date).
_COT_MOC = {
    "tao": (StockVoucher.created_at, False),
    "ngay": (StockVoucher.ngay, True),
    "ghi_so": (StockVoucher.ghi_so_luc, False),
}


def _gia_von_phieu():
    """Giá vốn của phiếu dưới dạng biểu thức SQL — cùng công thức với `_serialize` của router:
    NHẬP = Σ đơn giá dòng × SL khai; XUẤT = Σ giá lô × SL gốc (bỏ phần làm tròn đơn giá bình quân,
    lệch tối đa vài đồng — đủ cho một khoảng lọc)."""
    L = StockVoucherLine
    tien = case(
        (StockVoucher.loai == VOUCHER_NHAP, func.coalesce(L.don_gia, 0) * L.so_luong),
        else_=func.coalesce(StockLot.don_gia_nhap, 0) * L.sl_goc,
    )
    return (
        select(func.coalesce(func.sum(tien), 0))
        .select_from(L)
        .outerjoin(StockLot, StockLot.id == L.lot_id)
        .where(L.voucher_id == StockVoucher.id)
        .correlate(StockVoucher)
        .scalar_subquery()
    )

_HEADER_FIELDS = ("kho_id", "ngay", "nguoi_giao_nhan", "ghi_chu",
                  # ĐIỀU CHUYỂN KHO (mig 0203) — bật cho cả phiếu xuất nguồn lẫn nhập đích.
                  "dieu_chuyen")


class StockVoucherRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, voucher_id: int) -> StockVoucher | None:
        return self.db.get(StockVoucher, voucher_id)

    def lock_for_update(self, voucher_id: int) -> None:
        """Khóa DÒNG header phiếu (SELECT … FOR UPDATE) để chặn GHI SỔ 2 LẦN song song
        (double-click / 2 request /post cùng lúc). Postgres: request thứ 2 CHỜ tới khi request đầu
        commit rồi mới đọc lại — thấy 'posted' và dừng ở guard. SQLite: FOR UPDATE là no-op nhưng
        SQLite tự khóa ghi cả DB nên vẫn tuần tự. Phải gọi TRƯỚC khi đọc trạng thái phiếu."""
        self.db.execute(
            select(StockVoucher.id).where(StockVoucher.id == voucher_id).with_for_update()
        ).first()

    def ma_by_ids(self, ids: list[int]) -> dict[int, str]:
        """Map voucher_id → mã phiếu — cho chỗ hiển thị lô THEO PHIẾU (nạp 1 lượt, tránh N+1)."""
        if not ids:
            return {}
        rows = self.db.execute(
            select(StockVoucher.id, StockVoucher.ma).where(StockVoucher.id.in_(ids))
        ).all()
        return {r.id: r.ma for r in rows}

    def dieu_chuyen_by_ids(self, ids: list[int]) -> set[int]:
        """Tập voucher_id là ĐIỀU CHUYỂN — để lịch sử mặt hàng tách 'chuyển kho' khỏi nhập/xuất
        thường (lô nhận về / dòng chuyển đi). Nạp 1 lượt như `ma_by_ids`."""
        if not ids:
            return set()
        rows = self.db.execute(
            select(StockVoucher.id).where(
                StockVoucher.id.in_(ids), StockVoucher.dieu_chuyen.is_(True)
            )
        ).all()
        return {r.id for r in rows}

    def get_by_ma(self, ma: str) -> StockVoucher | None:
        return self.db.execute(
            select(StockVoucher).where(func.upper(StockVoucher.ma) == ma.strip().upper())
        ).scalars().first()

    def get_with_lines(self, voucher_id: int) -> StockVoucher | None:
        return self.db.execute(
            select(StockVoucher)
            .options(selectinload(StockVoucher.lines))
            .where(StockVoucher.id == voucher_id)
        ).scalars().first()

    def _dieu_kien(self, *, loai: str | None = None, trang_thai: str | None = None,
                   request_id: int | None = None, kho_id: int | None = None,
                   q: str | None = None, hang_khop: list[tuple[str, int]] | None = None,
                   nhom: str | None = None, tu_ngay: date | None = None,
                   den_ngay: date | None = None, moc: str = "tao",
                   nguoi_lap: list[int] | None = None,
                   gia_tu: int | None = None, gia_den: int | None = None) -> list:
        """Điều kiện lọc CHUNG của `list` và `dem_theo_nhom` — số trên tab khớp đúng danh sách.

        `nhom`: nhóm của thanh tab màn tồn từng kho (`nhap` / `xuat` = phiếu thường, `dc` = điều
        chuyển cả hai ve). `moc` chọn cột ngày của kỳ (06/10/2026): `tao` Ngày tạo, `ngay` Ngày
        nhập/xuất (Date), `ghi_so` Ngày ghi sổ. `gia_tu/gia_den` lọc theo GIÁ VỐN phiếu — router chỉ
        chuyển xuống khi người xem có ô xem giá của màn đang gọi. `hang_khop` = các cặp mặt hàng
        khớp chữ tìm (router tra sẵn), để ô tìm bắt cả tên/mã vật tư trong phiếu."""
        conds = []
        # ẨN phiếu điều chuyển CÒN NHÁP khỏi danh sách phiếu thường: cả ve XUẤT nguồn (bút toán nội
        # bộ) LẪN ve NHẬP đích — ve nhập đích hiện qua "Phiếu điều chuyển" (mặt tiền riêng,
        # spec-phieu-dieu-chuyen §6), không lẫn vào list phiếu nhập. Đã ghi sổ thì HIỆN (đối chiếu).
        conds.append(or_(
            StockVoucher.dieu_chuyen.is_(False),
            StockVoucher.trang_thai != VOUCHER_DRAFT,
        ))
        if loai:
            conds.append(StockVoucher.loai == loai)
        if nhom == "dc":
            conds.append(StockVoucher.dieu_chuyen.is_(True))
        elif nhom in ("nhap", "xuat"):
            conds.append(StockVoucher.dieu_chuyen.is_(False))
            conds.append(StockVoucher.loai == (VOUCHER_NHAP if nhom == "nhap" else VOUCHER_XUAT))
        if trang_thai:
            conds.append(StockVoucher.trang_thai == trang_thai)
        if request_id is not None:
            conds.append(StockVoucher.request_id == request_id)
        if kho_id is not None:
            conds.append(StockVoucher.kho_id == kho_id)
        if nguoi_lap:
            conds.append(StockVoucher.nguoi_lap_id.in_(nguoi_lap))
        cot, la_ngay = _COT_MOC.get(moc, _COT_MOC["tao"])
        conds += dk_khoang_ngay(cot, tu_ngay, den_ngay, cot_ngay=la_ngay)
        if gia_tu is not None or gia_den is not None:
            gia = _gia_von_phieu()
            if gia_tu is not None:
                conds.append(gia >= gia_tu)
            if gia_den is not None:
                conds.append(gia <= gia_den)
        if q and q.strip():
            like = f"%{q.strip().lower()}%"
            ve = [
                func.lower(StockVoucher.ma).like(like),
                func.lower(func.coalesce(StockVoucher.ghi_chu, "")).like(like),
                StockVoucher.request_id.in_(
                    select(StockRequest.id).where(func.lower(StockRequest.ma).like(like))),
            ]
            theo_loai: dict[str, set[int]] = {}
            for hl, hid in hang_khop or []:
                theo_loai.setdefault(hl, set()).add(int(hid))
            if theo_loai:
                ve.append(StockVoucher.id.in_(
                    select(StockVoucherLine.voucher_id).where(or_(*(
                        and_(StockVoucherLine.hang_loai == hl, StockVoucherLine.hang_id.in_(sorted(ids)))
                        for hl, ids in theo_loai.items()
                    )))
                ))
            conds.append(or_(*ve))
        return conds

    def list(self, *, page: int = 1, size: int = 50, **loc):
        conds = self._dieu_kien(**loc)
        base = select(StockVoucher).options(selectinload(StockVoucher.lines))
        count_stmt = select(func.count()).select_from(StockVoucher)
        for c in conds:
            base = base.where(c)
            count_stmt = count_stmt.where(c)
        total = self.db.execute(count_stmt).scalar_one()
        page, size = max(1, page), max(1, min(size, 200))
        base = base.order_by(StockVoucher.id.desc()).offset((page - 1) * size).limit(size)
        return list(self.db.execute(base).scalars()), total

    def dem_theo_nhom(self, **loc) -> dict[str, int]:
        """Số phiếu theo nhóm tab `nhap` / `xuat` / `dc` — cùng bộ lọc với `list`, TRỪ nhóm."""
        loc.pop("nhom", None)
        rows = self.db.execute(
            select(StockVoucher.loai, StockVoucher.dieu_chuyen, func.count())
            .where(*self._dieu_kien(**loc))
            .group_by(StockVoucher.loai, StockVoucher.dieu_chuyen)
        ).all()
        dem = {"nhap": 0, "xuat": 0, "dc": 0}
        for loai, dc, n in rows:
            k = "dc" if dc else ("nhap" if loai == VOUCHER_NHAP else "xuat")
            dem[k] += int(n)
        return dem

    def nguoi_lap_loc(self, *, kho_id: int | None = None) -> list[tuple[int, int]]:
        """[(id người lập, số phiếu)] trong danh sách (cùng luật ẩn điều chuyển nháp) — giá trị
        cho điều kiện lọc "Người lập"."""
        return [(int(u), int(n)) for u, n in self.db.execute(
            select(StockVoucher.nguoi_lap_id, func.count())
            .where(*self._dieu_kien(kho_id=kho_id), StockVoucher.nguoi_lap_id.is_not(None))
            .group_by(StockVoucher.nguoi_lap_id)
        ).all()]

    def draft_ids_by_request(self, request_ids: list[int]) -> dict[int, int]:
        """Map {request_id: id phiếu ĐANG CHỜ GHI SỔ (draft) mới nhất}. Để yêu cầu biết đã có
        phiếu chờ ghi sổ chưa → đổi nút 'Lập phiếu' thành 'Xem phiếu', chống tạo trùng."""
        if not request_ids:
            return {}
        rows = self.db.execute(
            select(StockVoucher.request_id, StockVoucher.id)
            .where(
                StockVoucher.request_id.in_(request_ids),
                StockVoucher.trang_thai == VOUCHER_DRAFT,
            )
            .order_by(StockVoucher.id.desc())
        ).all()
        out: dict[int, int] = {}
        for req_id, vid in rows:
            out.setdefault(req_id, vid)  # đã sắp desc → phần tử đầu mỗi req là mới nhất
        return out

    def sum_issued_for_line(self, request_line_id: int, *, exclude_voucher_id: int | None = None) -> float:
        """Tổng số lượng đã ứng vào 1 dòng yêu cầu qua các phiếu ĐÃ GHI SỔ.

        Dùng để kiểm tra chặn "ứng vượt SL duyệt" một cách độc lập với `sl_da_ung` — hai
        con số phải khớp; lệch nghĩa là có bug ghi sổ, và cách tính lại này bắt được.
        """
        from ..models.stock_voucher import VOUCHER_POSTED

        stmt = (
            select(func.coalesce(func.sum(StockVoucherLine.so_luong), 0))
            .join(StockVoucher, StockVoucher.id == StockVoucherLine.voucher_id)
            .where(
                StockVoucherLine.request_line_id == request_line_id,
                StockVoucher.trang_thai == VOUCHER_POSTED,
            )
        )
        if exclude_voucher_id is not None:
            stmt = stmt.where(StockVoucher.id != exclude_voucher_id)
        return float(self.db.execute(stmt).scalar_one() or 0)

    def _stmt_xuat(self, cols, hang: tuple[str, int], kho_id: int, *, goc: str | None,
                   kho_rong: int, kho_dai: int, dieu_chuyen: bool | None):
        """Khung câu XUẤT của 1 mặt hàng tại 1 kho: dòng phiếu XUẤT ĐÃ GHI SỔ (nối lô + dòng yêu cầu).
        Giấy: chỉ dòng xuất từ lô đúng đơn vị gốc (+ khổ khi có khổ) — cùng luật lọc lô của tồn.
        `dieu_chuyen` None = cả hai; True/False = chỉ dòng của phiếu điều chuyển / chỉ xuất thường."""
        from ..models.stock_lot import StockLot
        from ..models.stock_request import StockRequestLine
        from ..models.stock_voucher import VOUCHER_POSTED, VOUCHER_XUAT
        from .stock_lot_repo import StockLotRepository

        stmt = (
            select(*cols)
            .select_from(StockVoucherLine)
            .join(StockVoucher, StockVoucher.id == StockVoucherLine.voucher_id)
            .join(StockLot, StockLot.id == StockVoucherLine.lot_id, isouter=True)
            .join(StockRequestLine, StockRequestLine.id == StockVoucherLine.request_line_id, isouter=True)
            .where(
                StockVoucherLine.hang_loai == hang[0],
                StockVoucherLine.hang_id == hang[1],
                StockVoucher.kho_id == kho_id,
                StockVoucher.loai == VOUCHER_XUAT,
                StockVoucher.trang_thai == VOUCHER_POSTED,
            )
        )
        if dieu_chuyen is not None:
            stmt = stmt.where(StockVoucher.dieu_chuyen.is_(dieu_chuyen))
        return StockLotRepository._loc_kho(stmt, goc, kho_rong, kho_dai)

    def xuat_history(self, hang: tuple[str, int], kho_id: int, *, goc: str | None = None,
                     kho_rong: int = 0, kho_dai: int = 0, dieu_chuyen: bool | None = None,
                     offset: int = 0, limit: int | None = None) -> list[dict]:
        """Lịch sử XUẤT của 1 mặt hàng tại 1 kho — mỗi dòng phiếu XUẤT ĐÃ GHI SỔ, đích danh lô, mới
        nhất trước. `limit` = cắt trang ở DB (ngăn mặt hàng); None = cả lịch sử (Báo cáo kho).

        Giá vốn của dòng xuất = giá của lô bị trừ (`don_gia_nhap`), không phải `line.don_gia`
        (phiếu xuất không khai giá). Router ẩn giá nếu người gọi thiếu `can_view_cost`.

        `sl_de_nghi` = SL xin trên dòng yêu cầu gốc (nối qua `request_line_id` → StockRequestLine)
        — không phải tiền, luôn hiện được; None nếu dòng phiếu không nối được yêu cầu. Vị trí + HSD
        đọc ở LÔ trong cùng câu để trang lịch sử không phải nạp mọi lô chỉ để tra hai cột.
        """
        from ..models.stock_lot import StockLot
        from ..models.stock_request import StockRequestLine

        stmt = self._stmt_xuat(
            (StockVoucher.id, StockVoucher.ma, StockVoucher.ngay, StockVoucher.dieu_chuyen,
             StockVoucherLine.lot_id, StockVoucherLine.so_luong,
             StockLot.ma_lo, StockLot.don_gia_nhap, StockLot.vi_tri, StockLot.hsd,
             StockRequestLine.sl_de_nghi.label("sl_de_nghi"),
             StockRequestLine.dvt.label("dvt_yeu_cau")),
            hang, kho_id, goc=goc, kho_rong=kho_rong, kho_dai=kho_dai, dieu_chuyen=dieu_chuyen,
        ).order_by(StockVoucher.ngay.desc(), StockVoucher.id.desc(), StockVoucherLine.id.desc())
        if limit is not None:
            stmt = stmt.offset(offset).limit(limit)
        return [
            {
                "voucher_id": r.id, "voucher_ma": r.ma, "ngay": r.ngay,
                "lot_id": r.lot_id, "ma_lo": r.ma_lo,
                "so_luong": float(r.so_luong), "don_gia": float(r.don_gia_nhap or 0),
                "sl_de_nghi": float(r.sl_de_nghi) if r.sl_de_nghi is not None else None,
                "dvt_yeu_cau": r.dvt_yeu_cau,
                "dieu_chuyen": bool(r.dieu_chuyen),
                "vi_tri": r.vi_tri, "hsd": r.hsd,
            }
            for r in self.db.execute(stmt).all()
        ]

    def dem_xuat_theo_chieu(self, hang: tuple[str, int], kho_id: int, *, goc: str | None = None,
                            kho_rong: int = 0, kho_dai: int = 0) -> dict[bool, int]:
        """`{False: số dòng xuất thường, True: số dòng chuyển đi}` trong MỘT câu."""
        stmt = self._stmt_xuat((StockVoucher.dieu_chuyen, func.count(StockVoucherLine.id)), hang, kho_id,
                               goc=goc, kho_rong=kho_rong, kho_dai=kho_dai, dieu_chuyen=None)
        out = {False: 0, True: 0}
        for dc, n in self.db.execute(stmt.group_by(StockVoucher.dieu_chuyen)).all():
            out[bool(dc)] += int(n)
        return out

    def tong_xuat(self, hang: tuple[str, int], kho_id: int, *, tu_ngay, goc: str | None = None,
                  kho_rong: int = 0, kho_dai: int = 0) -> float:
        """Tổng SL XUẤT THƯỜNG (không tính điều chuyển) từ `tu_ngay` — đơn vị gốc của lô. Bỏ phiếu giảm
        tay ở màn Tồn kho (`nhap_tay`): sửa số sau kiểm kê không phải hàng đã dùng, cộng vào thì gợi
        ý mức tồn thổi phồng nhịp xuất."""
        from ..models.stock_request import StockRequest

        stmt = self._stmt_xuat((func.coalesce(func.sum(StockVoucherLine.so_luong), 0),), hang, kho_id,
                               goc=goc, kho_rong=kho_rong, kho_dai=kho_dai, dieu_chuyen=False)
        stmt = (stmt.join(StockRequest, StockRequest.id == StockVoucher.request_id, isouter=True)
                .where(StockRequest.nhap_tay.isnot(True)))
        return float(self.db.execute(stmt.where(StockVoucher.ngay >= tu_ngay)).scalar() or 0)

    def sl_de_nghi_by_lot(self, lots) -> dict[int, tuple[float, str | None]]:
        """Map lot_id → (`sl_de_nghi`, `dvt`) của dòng yêu cầu đã sinh ra lô NHẬP.

        `dvt` = ĐƠN VỊ người xin khai trên yêu cầu — có thể KHÁC đơn vị gốc của lô (vd xin 'tờ'
        mà lô lưu 'ram'), nên lịch sử phải ghi rõ đơn vị này cho cột "SL yêu cầu", tránh nhìn
        "40.000 (tờ)" cạnh "80 (ram)" tưởng lệch.

        Lô NHẬP có `voucher_id` (phiếu tạo lô); dòng phiếu NHẬP tạo lô là dòng có
        `voucher_id == lot.voucher_id` và `lot_id == lot.id` (ghi sổ gán lot_id về dòng).
        Từ dòng đó lấy `request_line_id` → `StockRequestLine`. Lọc theo cả (voucher_id, lot_id)
        nên chỉ bắt dòng NHẬP tạo lô, không dính dòng XUẤT trừ lô.
        """
        from ..models.stock_request import StockRequestLine

        voucher_ids = list({lot.voucher_id for lot in lots if lot.voucher_id is not None})
        lot_ids = list({lot.id for lot in lots if lot.voucher_id is not None})
        if not voucher_ids or not lot_ids:
            return {}
        stmt = (
            select(StockVoucherLine.lot_id, StockRequestLine.sl_de_nghi, StockRequestLine.dvt)
            .join(
                StockRequestLine,
                StockRequestLine.id == StockVoucherLine.request_line_id,
            )
            .where(
                StockVoucherLine.voucher_id.in_(voucher_ids),
                StockVoucherLine.lot_id.in_(lot_ids),
            )
        )
        return {
            lot_id: (float(sl), dvt)
            for lot_id, sl, dvt in self.db.execute(stmt).all()
            if lot_id is not None and sl is not None
        }

    def create(self, *, ma: str, loai: str, request_id: int, nguoi_lap_id: int,
               lines: list[dict], **header) -> StockVoucher:
        obj = StockVoucher(ma=ma, loai=loai, request_id=request_id, nguoi_lap_id=nguoi_lap_id)
        for k in _HEADER_FIELDS:
            if k in header:
                setattr(obj, k, header[k])
        for ln in lines:
            obj.lines.append(StockVoucherLine(
                request_line_id=ln["request_line_id"],
                hang_loai=ln["hang_loai"],
                hang_id=ln["hang_id"],
                lot_id=ln.get("lot_id"),
                so_luong=ln["so_luong"],
                sl_goc=ln["sl_goc"],          # số đã quy về đơn vị gốc — chốt lúc lập phiếu
                don_gia=ln.get("don_gia"),
                ghi_chu=ln.get("ghi_chu"),
                vi_tri=ln.get("vi_tri"),
                hsd=ln.get("hsd"),
                lo_goc_id=ln.get("lo_goc_id"),
                don_vi_goc=(ln.get("don_vi_goc") or "") if co_don_vi_goc(ln["hang_loai"]) else "",
                kho_rong=int(ln.get("kho_rong") or 0),
                kho_dai=int(ln.get("kho_dai") or 0),
            ))
        self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def save(self, obj: StockVoucher) -> StockVoucher:
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def delete(self, obj: StockVoucher) -> None:
        self.db.delete(obj)
        self.db.commit()

    # --- Đính kèm (hóa đơn/chứng từ gốc) -----------------------------------
    def list_attachments(self, voucher_id: int) -> list[StockVoucherAttachment]:
        return list(self.db.execute(
            select(StockVoucherAttachment)
            .where(StockVoucherAttachment.stock_voucher_id == voucher_id)
            .order_by(StockVoucherAttachment.id)
        ).scalars())

    def get_attachment(self, attachment_id: int) -> StockVoucherAttachment | None:
        return self.db.get(StockVoucherAttachment, attachment_id)

    def save_attachment(self, obj: StockVoucherAttachment) -> StockVoucherAttachment:
        self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def delete_attachment(self, obj: StockVoucherAttachment) -> None:
        self.db.delete(obj)
        self.db.commit()
