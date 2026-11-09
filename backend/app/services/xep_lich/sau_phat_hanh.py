"""Báo SAU khi một lệnh được đẩy xuống xưởng (phát hành) — dùng chung cho router Xếp lịch và vòng
nền tự đẩy (`hen_day.quet_tu_day`).

Trước 08/11/2026 các hàm này nằm trong `routers/xep_lich.py`. Vòng nền không có request nên không
gọi được router; để ở đây thì bấm "Đẩy ngay" và tới giờ tự đẩy báo đúng cùng một tập người: bàn tổ,
Kế hoạch bộ phận, thủ kho (yêu cầu xuất tự lập) và mọi màn theo dõi lệnh.

Mọi hàm gọi SAU commit của nghiệp vụ.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...doi_tuong_nhan import BAN_TO, MAN_KHVT, MAN_THEO_LENH, NGHE_LENH, hop
from ...models.lsx import Lsx
from ...realtime import hub
from ..thong_bao_man import bao as bao_man, kenh_to


def phat_lich_doi(lsx_id: int | None = None, **them) -> None:
    """Hẹn / đổi giờ / bỏ hẹn: nhóm `san_xuat` + `khvt` (màn theo lệnh, kể cả Xếp lịch) nhích."""
    hub.gui({"type": "xep_lich_changed", "lsx_id": lsx_id, **them},
            quyen=hop(MAN_THEO_LENH, MAN_KHVT))


def phat_goi_xuong_xuong(lsx_id: int) -> None:
    """Phát hành / phát hành cập nhật / thu hồi: gói việc ở xưởng đổi ⇒ thêm MỌI người có Bàn tổ
    (bàn nào có việc của lệnh thì phải tự nạp; tra tổ cần đọc lại gói, còn cửa này thưa)."""
    phat_lich_doi(lsx_id)
    hub.gui({"type": "lsx_changed"}, quyen=hop(NGHE_LENH, (BAN_TO,)))


def cham_cho_xep(db: Session, lsx_id: int, actor_id: int | None) -> None:
    """Lệnh quay lại chờ đẩy ⇒ chấm đỏ Xếp lịch."""
    lsx = db.get(Lsx, lsx_id)
    if lsx is not None:
        bao_man(db, kenh="xep_lich", loai="lenh_cho_xep", actor_id=actor_id, ma=lsx.ma)


def cham_viec_moi(db: Session, lsx_id: int, actor_id: int | None) -> None:
    """Phát hành ⇒ chấm đỏ bàn của từng tổ nhận việc (việc đã giao), và chấm Kế hoạch bộ phận cho
    từng bộ phận còn việc chờ xếp (07/11/2026) kèm sự kiện để màn đang mở tự nạp."""
    from ...repositories.ke_hoach_bo_phan_repo import KeHoachBoPhanRepository
    from ...repositories.san_xuat_repo import SanXuatRepository

    for to_id in sorted(SanXuatRepository(db).to_cua_lenh([lsx_id])):
        bao_man(db, kenh=kenh_to(to_id), loai="viec_moi", actor_id=actor_id)
    for bp in sorted(KeHoachBoPhanRepository(db).bo_phan_cho_giao([lsx_id])):
        bao_man(db, kenh="ke_hoach_bo_phan", loai="lenh_moi", actor_id=actor_id, phong_id=bp)
        hub.gui({"type": "ke_hoach_bo_phan_changed", "bo_phan_id": bp}, quyen=["ke_hoach_bo_phan"])


def bao(db: Session, kq: dict, *, actor_id: int | None) -> None:
    """Trọn bộ báo sau một lần đẩy thành công. `kq` = kết quả `XepLichLenhService.phat_hanh`."""
    from ..can_doi_cache import xoa_cache_can_doi
    from ..san_xuat.vat_tu_tu_lap import bao_sau_phat_hanh

    xoa_cache_can_doi()
    phat_goi_xuong_xuong(kq["lsx_id"])
    cham_viec_moi(db, kq["lsx_id"], actor_id)
    bao_sau_phat_hanh(db, kq["_tu_lap"], ma_lenh=kq["ma"], actor_id=actor_id)
