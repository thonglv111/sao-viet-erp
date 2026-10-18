"""Truy vấn cho đề nghị cấp vật tư theo công đoạn."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..models.san_xuat import SanXuatCongViec
from ..models.san_xuat_vat_tu import SanXuatVatTuDeNghi


class SanXuatVatTuRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def de_nghi(self, de_nghi_id: int) -> SanXuatVatTuDeNghi | None:
        return self.db.scalars(
            select(SanXuatVatTuDeNghi)
            .options(selectinload(SanXuatVatTuDeNghi.dongs))
            .where(SanXuatVatTuDeNghi.id == de_nghi_id)
        ).first()

    def cac_de_nghi(self, cong_viec_id: int) -> list[SanXuatVatTuDeNghi]:
        return list(self.db.scalars(
            select(SanXuatVatTuDeNghi)
            .options(selectinload(SanXuatVatTuDeNghi.dongs))
            .where(SanXuatVatTuDeNghi.cong_viec_id == cong_viec_id)
            .order_by(SanXuatVatTuDeNghi.lan_so)
        ))

    def stock_request_ids_cung_lenh(self, *, lsx_id: int | None,
                                    bai_ghep_id: int | None) -> list[int]:
        """Yêu cầu kho của MỌI đề nghị cấp thuộc các công việc cùng lệnh (hoặc cùng bài ghép) — để
        lấy giá vốn phần giấy bước lấy giấy đã xuất khi bước "nhận từ" trả thừa về kho."""
        if not (lsx_id or bai_ghep_id):
            return []
        dk = (SanXuatCongViec.lsx_id == lsx_id) if lsx_id else             (SanXuatCongViec.bai_ghep_id == bai_ghep_id)
        return [i for i in self.db.scalars(
            select(SanXuatVatTuDeNghi.stock_request_id)
            .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatVatTuDeNghi.cong_viec_id)
            .where(dk, SanXuatVatTuDeNghi.stock_request_id.is_not(None))
        ) if i]

    def lan_ke_tiep(self, cong_viec_id: int) -> int:
        cao = self.db.scalar(
            select(func.max(SanXuatVatTuDeNghi.lan_so))
            .where(SanXuatVatTuDeNghi.cong_viec_id == cong_viec_id)
        )
        return int(cao or 0) + 1

    def boi_canh_san_xuat(self, request_ids: list[int]) -> dict[int, dict]:
        """`{request_id: {"can_luc", "cong_viec_id", "cong_doan_ten"}}` — MỘT truy vấn join
        `san_xuat_vat_tu_de_nghi` → `san_xuat_cong_viec` cho cả danh sách.

        Hộp yêu cầu kho hiện HÀNG TRĂM dòng một trang; hỏi từng yêu cầu là N+1 ngay trên đường mở
        màn chính của thủ kho (task-8-ruling-man-kho, Ruling 32/34). Danh sách rỗng ⇒ trả `{}` mà
        không chạm DB. Yêu cầu kho THƯỜNG (không sinh từ sản xuất) đơn giản không có dòng nào khớp
        `stock_request_id` — router đọc `.get(id)` ra `None`, tự lấy `{}` mà không phải phân nhánh.
        """
        ids = [i for i in set(request_ids) if i]
        if not ids:
            return {}
        rows = self.db.execute(
            select(SanXuatVatTuDeNghi.stock_request_id, SanXuatVatTuDeNghi.can_luc,
                   SanXuatVatTuDeNghi.cong_viec_id, SanXuatCongViec.ten_cong_doan)
            .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatVatTuDeNghi.cong_viec_id)
            .where(SanXuatVatTuDeNghi.stock_request_id.in_(ids))
        )
        # Dict comprehension lấy dòng CUỐI nếu trùng `rid` — an toàn vì KHÔNG THỂ trùng: có
        # `UniqueConstraint("stock_request_id", ...)` ở `models/san_xuat_vat_tu.py:74` chặn hai
        # `SanXuatVatTuDeNghi` cùng trỏ một `stock_request_id` ngay ở tầng DB. Ai gỡ ràng buộc đó
        # sau này phải quay lại đây: dict sẽ âm thầm mất một dòng theo thứ tự DB trả, không lỗi.
        return {
            rid: {"can_luc": can_luc, "cong_viec_id": cv_id, "cong_doan_ten": ten}
            for rid, can_luc, cv_id, ten in rows
        }

    # `co_voucher` KHÔNG ở đây: "yêu cầu này đã có phiếu chưa" là câu hỏi của phía KHO, và bản duy
    # nhất nằm ở `StockRequestRepository.co_voucher` (ruling task-4-fix-1 minor-7). Trước đây hai
    # repo tự viết CÙNG một câu SELECT; một facade uỷ quyền cũng vẫn là hai cửa để hai bên trôi
    # khỏi nhau, nên bỏ hẳn — mọi chỗ gọi thẳng repo kho.

    def yeu_cau_cua_cong_viec(self, cv_ids: list[int]) -> dict[int, list[tuple[int, int, str]]]:
        """`{cv_id: [(lan_so, stock_request_id, trang_thai kho)]}` theo `lan_so` — MỘT truy vấn cho
        cả bàn. Lần đề nghị không đẻ yêu cầu kho (mọi dòng xin 0) không có mặt."""
        from ..models.stock_request import StockRequest

        ra: dict[int, list[tuple[int, int, str]]] = {}
        if not cv_ids:
            return ra
        rows = self.db.execute(
            select(SanXuatVatTuDeNghi.cong_viec_id, SanXuatVatTuDeNghi.lan_so, StockRequest.id,
                   StockRequest.trang_thai)
            .join(StockRequest, StockRequest.id == SanXuatVatTuDeNghi.stock_request_id)
            .where(SanXuatVatTuDeNghi.cong_viec_id.in_(sorted(set(cv_ids))))
            .order_by(SanXuatVatTuDeNghi.cong_viec_id, SanXuatVatTuDeNghi.lan_so)
        )
        for cid, lan, rid, tt in rows:
            ra.setdefault(cid, []).append((lan, rid, tt))
        return ra

    def dong_yeu_cau(self, request_ids: list[int]) -> dict[int, list[dict]]:
        """`{request_id: [dòng]}` — MỘT truy vấn. Mỗi dòng: hàng, đơn vị, số xin, đã ứng, chốt
        thực xuất."""
        from ..models.stock_request import StockRequestLine

        ra: dict[int, list[dict]] = {}
        ids = sorted({i for i in request_ids if i})
        if not ids:
            return ra
        rows = self.db.execute(
            select(StockRequestLine.request_id, StockRequestLine.hang_loai, StockRequestLine.hang_id,
                   StockRequestLine.dvt, StockRequestLine.sl_de_nghi, StockRequestLine.sl_da_ung,
                   StockRequestLine.sl_chot_thuc_xuat)
            .where(StockRequestLine.request_id.in_(ids))
            .order_by(StockRequestLine.request_id, StockRequestLine.id)
        )
        for rid, loai, hid, dvt, xin, ung, chot in rows:
            ra.setdefault(rid, []).append({
                "hang_loai": loai, "hang_id": hid, "dvt": dvt, "sl_de_nghi": xin,
                "sl_da_ung": ung, "sl_chot_thuc_xuat": chot,
            })
        return ra
