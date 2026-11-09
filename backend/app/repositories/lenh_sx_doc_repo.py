"""Truy vấn NHẸ cho hai màn chỉ-đọc Lệnh SX / Theo dõi SX — tầng "lọc còn sống" (A7, 28/09/2026).

VÌ SAO CÓ FILE NÀY: `danh_sach.danh_sach()` và `summary()` từng đưa MỌI lệnh đã phát hành từ trước
tới nay qua `boi_canh.nap()` (21 câu, kéo công việc/phiên/batch/KCS/kho của từng lệnh) + một lượt
`can_doi()`, chỉ để rồi xếp phần lớn chúng vào tab "Hoàn thành". Vòng đời `lsx` dừng ở
`da_phat_hanh`, nên tập đó chỉ PHÌNH theo tuổi dữ liệu và màn chậm dần đều.

Ở đây là những câu RẺ (vài cột phẳng, không nạp đối tượng con) đủ để tách lệnh ĐÃ GIAO HẾT ra khỏi
lượt nạp nặng — rồi chỉ nạp nặng phần còn sống, cộng đúng những lệnh đã giao hết mà trang/KPI thật
sự cần. Định nghĩa "đã giao hết" KHÔNG viết lại ở đây: repo chỉ trả SỐ, còn phán quyết đi qua
`trang_thai.giao_du()` — đúng hàm mà `trang_thai._da_giao_het` dùng — nên hai tầng không thể lệch.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import func, or_, select, union
from sqlalchemy.orm import Session

from ..models.bai_ghep_cong_doan import BaiGhepCongDoanMap
from ..models.delivery import LAN_GIAO_CO_HANG_DEN_TAY, DeliveryTrip, DeliveryTripLine
from ..models.lsx import Lsx
from ..models.san_xuat import SanXuatCongViec
from ..models.san_xuat_kcs import SanXuatKcsBatch


@dataclass(frozen=True)
class LenhNhe:
    """Đúng những cột mà tầng danh sách cần cho một lệnh KHÔNG đi qua `boi_canh.nap()`: khoá sắp
    (`is_rush`, `han_giao_khach`, `ma` — xem `danh_sach._khoa_sap`) + hai số của phép "đã giao
    hết" (`so_luong_dat`, `da_giao`)."""

    id: int
    ma: str | None
    is_rush: bool
    han_giao_khach: date | None
    so_luong_dat: int
    da_giao: int


class LenhSxDocRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def lenh_nhe(self, lsx_ids: list[int]) -> dict[int, LenhNhe]:
        """`{lsx_id: LenhNhe}` — HAI câu phẳng cho cả tập, dù tập có vài nghìn lệnh.

        `da_giao` cộng `delivery_trip_lines.qty_giao` qua chuyến trong `LAN_GIAO_CO_HANG_DEN_TAY`,
        gom theo `order_line_id` — Y HỆT câu 11b của `boi_canh.nap()` (cùng bảng, cùng điều kiện,
        cùng khoá gom). Lệch điều kiện ở đây với câu 11b là một lệnh bị xếp "đã giao hết" ở tầng lọc
        trong khi `boi_canh` nói khác — nên sửa một bên thì PHẢI sửa bên kia. Bài canh:
        `test_lenh_sx_con_song.py`.

        HÌNH CÂU LÀ CỐ Ý (30/09/2026): câu gom chỉ lọc theo `order_line_id`, trạng thái chuyến lọc ở
        Python. Bản cũ lọc `trang_thai` trong SQL — bộ lập kế hoạch đi từ chỉ mục `trang_thai`
        (= MỌI chuyến đã giao từ trước tới nay) rồi mỗi chuyến dò lại cả danh sách dòng đơn: chuyến
        × dòng, 1 giây cho 1.500 lệnh đã giao, tăng theo BÌNH PHƯƠNG lịch sử (`trip_id IN (…)` cũng
        bị gỡ phẳng về đúng đường đó). Đừng đưa điều kiện trạng thái trở lại câu SQL.
        """
        if not lsx_ids:
            return {}
        rows = self.db.execute(
            select(
                Lsx.id, Lsx.ma, Lsx.is_rush, Lsx.han_giao_khach, Lsx.so_luong_dat,
                Lsx.order_line_id,
            ).where(Lsx.id.in_(lsx_ids))
        ).all()
        dong_ids = {r[5] for r in rows if r[5] is not None}
        tong: dict[int, int] = {}
        if dong_ids:
            for ol, qty, tt in self.db.execute(
                select(DeliveryTripLine.order_line_id, DeliveryTripLine.qty_giao, DeliveryTrip.trang_thai)
                .join(DeliveryTrip, DeliveryTrip.id == DeliveryTripLine.trip_id)
                .where(DeliveryTripLine.order_line_id.in_(dong_ids))
            ):
                if tt in LAN_GIAO_CO_HANG_DEN_TAY:
                    tong[ol] = tong.get(ol, 0) + int(qty or 0)
        return {
            r[0]: LenhNhe(
                id=r[0], ma=r[1], is_rush=bool(r[2]), han_giao_khach=r[3],
                so_luong_dat=r[4] or 0, da_giao=tong.get(r[5], 0),
            )
            for r in rows
        }

    def giao_cuoi_truoc(self, lsx_ids: list[int], moc: datetime) -> set[int]:
        """Lệnh (trong `lsx_ids`) mà lần giao CÓ HÀNG ĐẾN TAY cuối cùng kết thúc trước `moc`. MỘT câu.

        Mốc của một chuyến = `thoi_gian_ket_thuc` (đặt lúc tài xế chốt chuyến); chuyến cũ thiếu cột
        đó thì lùi về lúc lên đơn (`created_at`; giờ lấy hàng gỡ ở mg 0400). Cùng bảng + cùng điều kiện chuyến với `lenh_nhe` (câu 11b của
        `boi_canh`). Lệnh chưa có chuyến nào không bao giờ lọt — HAVING trên nhóm rỗng không ra dòng.
        """
        if not lsx_ids:
            return set()
        # Trạng thái chuyến lọc ở Python — lý do ở `lenh_nhe` (đưa vào WHERE là chuyến × dòng).
        # Gom theo (lệnh, trạng thái), so mốc ở DB như cũ; max của nhóm NULL ⇒ cờ NULL, bỏ qua —
        # y hệt MAX() của SQL bỏ NULL.
        moc_chuyen = func.coalesce(DeliveryTrip.thoi_gian_ket_thuc, DeliveryTrip.created_at)
        co: dict[int, list[bool]] = {}
        for lsx_id, tt, truoc in self.db.execute(
            select(Lsx.id, DeliveryTrip.trang_thai, func.max(moc_chuyen) < moc)
            .join(DeliveryTripLine, DeliveryTripLine.order_line_id == Lsx.order_line_id)
            .join(DeliveryTrip, DeliveryTrip.id == DeliveryTripLine.trip_id)
            .where(Lsx.id.in_(lsx_ids))
            .group_by(Lsx.id, DeliveryTrip.trang_thai)
        ):
            if tt in LAN_GIAO_CO_HANG_DEN_TAY and truoc is not None:
                co.setdefault(lsx_id, []).append(bool(truoc))
        return {i for i, cac in co.items() if all(cac)}

    def lenh_con_viec_o_trang_thai(self, lsx_ids: list[int], trang_thai: tuple[str, ...]) -> set[int]:
        """Lệnh (trong `lsx_ids`) còn công việc ở một trong `trang_thai` — neo thẳng hoặc việc CHUNG
        của bài ghép (qua `bai_ghep_cong_doan_map`), hai vế y `lenh_co_viec_tu`. MỘT câu."""
        if not lsx_ids:
            return set()
        truc_tiep = select(SanXuatCongViec.lsx_id.label("lsx_id")).where(
            SanXuatCongViec.lsx_id.in_(lsx_ids), SanXuatCongViec.trang_thai.in_(trang_thai),
        )
        qua_ghep = (
            select(BaiGhepCongDoanMap.lsx_id.label("lsx_id"))
            .join(
                SanXuatCongViec,
                SanXuatCongViec.bai_ghep_cong_doan_id == BaiGhepCongDoanMap.bai_ghep_cong_doan_id,
            )
            .where(BaiGhepCongDoanMap.lsx_id.in_(lsx_ids), SanXuatCongViec.trang_thai.in_(trang_thai))
        )
        return {r for (r,) in self.db.execute(union(truc_tiep, qua_ghep)).all() if r is not None}

    def lenh_co_viec_tu(self, lsx_ids: list[int], moc: datetime) -> set[int]:
        """Lệnh (trong `lsx_ids`) có CÔNG VIỆC đóng lúc `>= moc`, hoặc có batch KCS kết thúc
        `>= moc` trên công việc của nó. MỘT câu (UNION hai vế).

        Dùng cho `summary()`: hai KPI "công đoạn xong hôm nay" / "tỷ lệ KCS đạt hôm nay" đọc công
        việc của MỌI lệnh trong phạm vi, kể cả lệnh đã giao hết (bước đóng sau lúc giao vẫn là một
        công đoạn xong hôm nay). Lệnh đã giao hết mà không chạm câu này thì chắc chắn không góp gì
        vào hai KPI đó ⇒ khỏi nạp.

        Hai vế y như `boi_canh`: công việc NEO THẲNG (`lsx_id`) và công việc CHUNG của bài ghép (qua
        `bai_ghep_cong_doan_map`). KHÔNG lọc gói thu hồi, KHÔNG chặn mép phải — cả hai chỉ làm tập
        RỘNG hơn cái Python lọc sau, tức lọt thừa vài lệnh (vô hại) chứ không bao giờ sót.
        """
        if not lsx_ids:
            return set()
        cham = or_(
            SanXuatCongViec.hoan_thanh_luc >= moc,
            SanXuatCongViec.id.in_(
                select(SanXuatKcsBatch.cong_viec_id).where(SanXuatKcsBatch.ket_thuc >= moc)
            ),
        )
        truc_tiep = select(SanXuatCongViec.lsx_id.label("lsx_id")).where(
            SanXuatCongViec.lsx_id.in_(lsx_ids), cham,
        )
        qua_ghep = (
            select(BaiGhepCongDoanMap.lsx_id.label("lsx_id"))
            .join(
                SanXuatCongViec,
                SanXuatCongViec.bai_ghep_cong_doan_id == BaiGhepCongDoanMap.bai_ghep_cong_doan_id,
            )
            .where(BaiGhepCongDoanMap.lsx_id.in_(lsx_ids), cham)
        )
        return {r for (r,) in self.db.execute(union(truc_tiep, qua_ghep)).all() if r is not None}
