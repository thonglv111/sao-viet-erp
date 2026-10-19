"""Repository — Báo cáo thu chi: nạp phiếu đã chi / đã thu trong kỳ, đổi mục hàng loạt."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import and_, or_, select, update
from sqlalchemy.orm import Session, selectinload

from ..models.accounting import (
    PAYMENT_RECEIPT_RECEIVED,
    PAYMENT_VOUCHER_PAID,
    PaymentReceipt,
    PaymentVoucher,
)
from ..models.muc_thu_chi import NGUON_CO_DINH_CHI, NGUON_CO_DINH_THU


class BaoCaoThuChiRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def phieu_chi(self, tu_ngay: date, den_ngay: date) -> list[PaymentVoucher]:
        """Phiếu ĐÃ CHI có thể rơi vào kỳ. Ngày thật là `ngay_chi` (`paid_at` lùi `voucher_date`)
        nên SQL chỉ chặn thô — `paid_at` không bao giờ trước ngày chứng từ — rồi service lọc đúng
        bằng `bao_cao_cong_no.ngay_chi`, để báo cáo này và hai màn công nợ chọn cùng một ngày."""
        moc = datetime.combine(tu_ngay - timedelta(days=1), time(0, 0), tzinfo=timezone.utc)
        stmt = (
            select(PaymentVoucher)
            .options(selectinload(PaymentVoucher.muc_thu_chi))
            .where(
                PaymentVoucher.status == PAYMENT_VOUCHER_PAID,
                PaymentVoucher.voucher_date <= den_ngay,
                or_(PaymentVoucher.paid_at >= moc,
                    and_(PaymentVoucher.paid_at.is_(None), PaymentVoucher.voucher_date >= tu_ngay)),
            )
        )
        return list(self.db.execute(stmt).scalars().all())

    def phieu_thu(self, tu_ngay: date, den_ngay: date) -> list[PaymentReceipt]:
        stmt = (
            select(PaymentReceipt)
            .options(selectinload(PaymentReceipt.muc_thu_chi), selectinload(PaymentReceipt.lines))
            .where(
                PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED,
                PaymentReceipt.receipt_date >= tu_ngay,
                PaymentReceipt.receipt_date <= den_ngay,
            )
        )
        return list(self.db.execute(stmt).scalars().all())

    def doi_muc(self, *, phieu_chi_ids: list[int], phieu_thu_ids: list[int], muc_id: int) -> int:
        """Gán `muc_id` cho các phiếu — chỉ phiếu chưa huỷ (huỷ rồi thì không còn trong báo cáo).
        Phiếu chi rời mục cần khách thì bỏ luôn khách, kẻo vẫn bị cộng vào Công nợ phải thu.
        Phiếu sinh từ nghiệp vụ (mục cố định theo nguồn) KHÔNG đổi được — lọc bỏ ngay ở câu UPDATE."""
        n = 0
        if phieu_chi_ids:
            n += int(self.db.execute(
                update(PaymentVoucher)
                .where(PaymentVoucher.id.in_(phieu_chi_ids),
                       PaymentVoucher.status == PAYMENT_VOUCHER_PAID,
                       PaymentVoucher.source_type.not_in(NGUON_CO_DINH_CHI))
                .values(muc_thu_chi_id=muc_id, customer_id=None)).rowcount or 0)
        if phieu_thu_ids:
            n += int(self.db.execute(
                update(PaymentReceipt)
                .where(PaymentReceipt.id.in_(phieu_thu_ids),
                       PaymentReceipt.status == PAYMENT_RECEIPT_RECEIVED,
                       PaymentReceipt.source_type.not_in(NGUON_CO_DINH_THU))
                .values(muc_thu_chi_id=muc_id)).rowcount or 0)
        return n

    def chot(self) -> None:
        self.db.commit()
