"""Báo người lao động khi phiếu lương của họ MỞ (#39 bấm thử 18/10/2026).

Trước đó công bố chỉ ghi nhật ký: màn "Phiếu lương của tôi" đang mở cứ đứng "Phiếu sẽ hiện ngay khi
HCNS công bố" tới khi người ta tự đổi tab. Gửi nội bộ phải tới ngay ⇒ đẩy `phieu_luong_cong_bo`
đích danh từng người có dòng lương trong kỳ: AppShell toast + màn phiếu lương tự nạp lại.

Hai lối mở: HCNS công bố mở ngay (`PayrollService.cong_bo_phieu` gọi `bao_phieu_luong_mo`), hoặc
hẹn giờ — vòng nền quét các kỳ đã tới giờ mở mà chưa có dấu `da_bao_mo_luc`, nên mỗi lần mở chỉ báo
đúng một lần. Thu hồi cũng đẩy (`phieu_luong_thu_hoi`) để màn đang mở thôi hiện phiếu cũ.
Không ghi chuông: chuông chưa có màn nào đọc, còn chấm đỏ kênh "luong" đòi ô Xem bảng lương mà
người lao động không có.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from ..db import SessionLocal
from ..locks import giu_vai_chinh
from ..realtime import hub
from ..repositories.payroll_repo import PayrollRepository

log = logging.getLogger(__name__)


#: Vòng quét chỉ báo bù trong chừng này: kỳ mở từ lâu mà chưa có dấu (dữ liệu trước migration 0423)
#: không bắn toast hàng loạt lần đầu chạy bản mới.
LUI_TOI_DA = timedelta(days=2)


def _ky(period) -> str:
    return f"{int(period.month):02d}/{int(period.year)}"


def bao_phieu_luong_mo(db, period) -> int:
    """Đẩy tin "phiếu lương kỳ này đã mở" tới từng người có dòng lương, ghi `da_bao_mo_luc` = chính
    mốc mở vừa báo để vòng quét không báo lại; công bố lại (mốc mới) thì báo lần nữa. Trả số người nhận."""
    period.da_bao_mo_luc = period.cong_bo_luc
    db.commit()
    uids = PayrollRepository(db).user_ids_cua_ky(period.id)
    if not uids:
        return 0
    hub.gui({
        "type": "phieu_luong_cong_bo",
        "year": int(period.year),
        "month": int(period.month),
        "message": f"Phiếu lương {_ky(period)} đã công bố. Mở Lương, tab Phiếu lương để xem.",
    }, nguoi=uids)
    return len(uids)


def bao_phieu_luong_thu_hoi(db, period) -> int:
    """Phiếu lương bị thu hồi (HCNS thu hồi hoặc mở lại kỳ) ⇒ báo từng người ngay (#59): màn "Phiếu
    lương của tôi" đang mở nạp lại, thôi hiện con số không còn đúng. Trả số người nhận."""
    uids = PayrollRepository(db).user_ids_cua_ky(period.id)
    if not uids:
        return 0
    hub.gui({
        "type": "phieu_luong_thu_hoi",
        "year": int(period.year),
        "month": int(period.month),
        "message": f"Phiếu lương {_ky(period)} đã được thu hồi để sửa.",
    }, nguoi=uids)
    return len(uids)


def quet_phieu_luong_mo(until: datetime) -> int:
    """Báo các kỳ đã tới giờ mở (≤ `until`) mà chưa báo. Trả số kỳ đã báo."""
    db = SessionLocal()
    try:
        n = 0
        for p in PayrollRepository(db).ky_mo_chua_bao(until - LUI_TOI_DA, until):
            if bao_phieu_luong_mo(db, p):
                n += 1
        return n
    finally:
        db.close()


async def run_phieu_luong_mo_loop(interval: int) -> None:
    """Vòng nền như `care_reminders`: chỉ worker giữ vai mới quét; nuốt lỗi để vòng sống tiếp. Dấu
    "đã báo" nằm trong DB nên máy chủ tắt đúng giờ mở, hay một lượt quét lỗi, thì lượt sau báo bù."""
    while True:
        await asyncio.sleep(interval)
        if not await asyncio.to_thread(giu_vai_chinh, "bao_phieu_luong_mo", ttl_ms=interval * 3000):
            continue
        try:
            await asyncio.to_thread(quet_phieu_luong_mo, datetime.now(timezone.utc))
        except Exception:  # noqa: BLE001 — vòng lặp nền phải sống sót mọi lỗi
            log.exception("phieu luong mo loop scan failed")
