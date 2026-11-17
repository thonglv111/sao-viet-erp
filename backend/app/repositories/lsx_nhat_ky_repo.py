"""Tra các đối tượng GẮN VỚI một lệnh sản xuất — nguồn cho tab Nhật ký của lệnh.

Nhật ký ghi audit theo ĐỐI TƯỢNG bị tác động (`tgc_don:7`, `payment_voucher:3`…), không
theo lệnh. Muốn kể đủ chuyện của một lệnh thì phải biết lệnh đó đang kéo theo những đối tượng nào —
đọc từ BẢNG, không quét chữ trong `detail` của cả bảng nhật ký.
"""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models.bai_ghep import BaiGhepThanhVien
from ..models.purchase import YeuCauMuaNguonLenh
from ..models.san_xuat import SanXuatCongViec, SanXuatNhomLsx
from ..models.stock_request import StockRequest, StockRequestLine
from ..models.stock_voucher import StockVoucher
from ..models.thue_gia_cong import (
    TgcDonDong, TgcPhieuChiNhan, TgcPhieuGiao, TgcPhieuNhan, TgcViec,
)
from ..models.xep_lich import XepLichCongDoan


class LsxNhatKyRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def _ids(self, stmt) -> list[int]:
        return sorted({i for i in self.db.execute(stmt).scalars() if i is not None})

    def cong_viec(self, lsx_id: int) -> list[SanXuatCongViec]:
        """Các công việc xưởng của lệnh, mọi gói phát hành (gói cũ đã thay vẫn là chuyện đã xảy ra)."""
        return list(self.db.execute(
            select(SanXuatCongViec).where(SanXuatCongViec.lsx_id == lsx_id).order_by(SanXuatCongViec.id)
        ).scalars())

    def thue_gia_cong(self, lsx_id: int, cong_viec_ids: list[int]) -> dict[str, list[int]]:
        """Việc thuê gia công của lệnh (neo `lsx_id`, hoặc qua `san_xuat_cong_viec.tgc_viec_id` cho
        việc của bài ghép) + đơn, dòng đơn, phiếu giao, phiếu nhận của các việc đó."""
        dk = [TgcViec.lsx_id == lsx_id]
        if cong_viec_ids:
            dk.append(TgcViec.id.in_(
                select(SanXuatCongViec.tgc_viec_id).where(SanXuatCongViec.id.in_(cong_viec_ids))))
        viec = self._ids(select(TgcViec.id).where(or_(*dk)))
        ra = {"viec": viec, "don": [], "dong": [], "phieu_giao": [], "phieu_nhan": []}
        if not viec:
            return ra
        dongs = self.db.execute(select(TgcDonDong.id, TgcDonDong.don_id)
                                .where(TgcDonDong.viec_id.in_(viec))).all()
        ra["dong"] = sorted({int(i) for i, _ in dongs})
        ra["don"] = sorted({int(d) for _, d in dongs})
        if ra["don"]:
            ra["phieu_giao"] = self._ids(select(TgcPhieuGiao.id).where(TgcPhieuGiao.don_id.in_(ra["don"])))
            ra["phieu_nhan"] = self._ids(select(TgcPhieuNhan.id).where(TgcPhieuNhan.don_id.in_(ra["don"])))
        return ra

    def phieu_chi(self, phieu_nhan_ids: list[int]) -> list[int]:
        if not phieu_nhan_ids:
            return []
        return self._ids(select(TgcPhieuChiNhan.payment_voucher_id)
                         .where(TgcPhieuChiNhan.phieu_nhan_id.in_(phieu_nhan_ids)))

    def nhom(self, lsx_id: int) -> list[int]:
        return self._ids(select(SanXuatNhomLsx.nhom_id).where(SanXuatNhomLsx.lsx_id == lsx_id))

    def goi(self, cong_viec_ids: list[int]) -> list[int]:
        if not cong_viec_ids:
            return []
        return self._ids(select(SanXuatCongViec.goi_id).where(SanXuatCongViec.id.in_(cong_viec_ids)))

    def bai_ghep(self, lsx_id: int) -> list[int]:
        return self._ids(select(BaiGhepThanhVien.bai_ghep_id).where(BaiGhepThanhVien.lsx_id == lsx_id))

    def xep_lich(self, lsx_id: int) -> list[int]:
        return self._ids(select(XepLichCongDoan.id).where(XepLichCongDoan.lsx_id == lsx_id))

    def yeu_cau_mua(self, lsx_id: int) -> list[int]:
        """Phiếu đề nghị mua của bộ phận có dòng "mua cho" lệnh này."""
        return self._ids(select(YeuCauMuaNguonLenh.department_request_id)
                         .where(YeuCauMuaNguonLenh.lsx_id == lsx_id))

    def yeu_cau_kho(self, lsx_id: int, cong_viec_ids: list[int], tgc: dict | None = None) -> list[StockRequest]:
        """Đề nghị nhập/xuất kho của lệnh: qua công việc xưởng, chứng từ thuê gia công, hoặc dòng ghi lệnh."""
        dk = [StockRequest.id.in_(select(StockRequestLine.request_id).where(StockRequestLine.lsx_id == lsx_id))]
        if cong_viec_ids:
            dk += [StockRequest.san_xuat_cong_viec_id.in_(cong_viec_ids),
                   StockRequest.vat_tu_tra_cong_viec_id.in_(cong_viec_ids)]
        tgc = tgc or {}
        if tgc.get("phieu_giao"):
            dk.append(StockRequest.tgc_phieu_giao_id.in_(tgc["phieu_giao"]))
        if tgc.get("phieu_nhan"):
            dk.append(StockRequest.tgc_phieu_nhan_id.in_(tgc["phieu_nhan"]))
        if tgc.get("dong"):
            dk.append(StockRequest.tgc_don_dong_id.in_(tgc["dong"]))
        return list(self.db.execute(select(StockRequest).where(or_(*dk))).scalars())

    def phieu_kho(self, request_ids: list[int]) -> list[StockVoucher]:
        if not request_ids:
            return []
        return list(self.db.execute(
            select(StockVoucher).where(StockVoucher.request_id.in_(request_ids))
        ).scalars())
