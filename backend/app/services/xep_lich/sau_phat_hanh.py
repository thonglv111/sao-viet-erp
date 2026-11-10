"""Báo SAU khi một lệnh được đẩy xuống xưởng (phát hành) — dùng chung cho router Xếp lịch và vòng
nền tự đẩy (`hen_day.quet_tu_day`).

Trước 08/11/2026 các hàm này nằm trong `routers/xep_lich.py`. Vòng nền không có request nên không
gọi được router; để ở đây thì bấm "Đẩy ngay" và tới giờ tự đẩy báo đúng cùng một tập người: bàn tổ,
Kế hoạch bộ phận, thủ kho (yêu cầu xuất tự lập) và mọi màn theo dõi lệnh.

Mọi hàm gọi SAU commit của nghiệp vụ.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...doi_tuong_nhan import MAN_KHVT, MAN_THEO_LENH, NGHE_LENH, hop
from ...models.lsx import Lsx
from ...realtime import hub
from ..thong_bao_man import bao as bao_man, kenh_to


def phat_lich_doi(lsx_id: int | None = None, **them) -> None:
    """Hẹn / đổi giờ / bỏ hẹn: nhóm `san_xuat` + `khvt` (màn theo lệnh, kể cả Xếp lịch) nhích. Kế
    hoạch bộ phận không đọc gì của Xếp lịch nên bỏ khoá giả của nó (08/11/2026)."""
    from ..quyen_ke_hoach import NGHE_KE_HOACH

    quyen = [k for k in hop(MAN_THEO_LENH, MAN_KHVT) if k != NGHE_KE_HOACH]
    hub.gui({"type": "xep_lich_changed", "lsx_id": lsx_id, **them}, quyen=quyen)


def noi_goi(db: Session, lsx_id: int) -> tuple[set[int], set[int]]:
    """Ảnh chụp (tổ, bộ phận) cầm việc của gói chứa lệnh — chụp TRƯỚC khi đổi gói, vì thu hồi
    xong thì việc cũ không còn chỉ ra tổ nào nữa."""
    from ...repositories.san_xuat_repo import SanXuatRepository

    return SanXuatRepository(db).to_cua_goi_chua_lenh({lsx_id})


def phat_goi_xuong_xuong(db: Session, lsx_id: int,
                         truoc: tuple[set[int], set[int]] | None = None) -> None:
    """Phát hành / phát hành cập nhật / thu hồi: gói việc ở xưởng đổi ⇒ bàn của ĐÚNG các tổ cầm
    việc của gói trước (`truoc`, chụp bằng `noi_goi`) hoặc sau lần đổi, và Kế hoạch của đúng các bộ
    phận đó (08/11/2026). Trước đây gửi MỌI người có Bàn tổ: một lần phát lệnh bắt cả xưởng nạp lại
    ba API cùng lúc (100 người ≈ 300 request, cỡ 40 giây CPU của một worker)."""
    from ..quyen_ke_hoach import NGHE_KE_HOACH, khoa_ke_hoach

    phat_lich_doi(lsx_id)
    to_truoc, bp_truoc = truoc or (set(), set())
    to_sau, bp_sau = noi_goi(db, lsx_id)
    quyen = ([k for k in NGHE_LENH if k != NGHE_KE_HOACH]
             + [khoa_ke_hoach(b) for b in bp_truoc | bp_sau])
    hub.gui({"type": "lsx_changed"}, quyen=quyen, to=sorted(to_truoc | to_sau))


def cham_cho_xep(db: Session, lsx_id: int, actor_id: int | None) -> None:
    """Lệnh quay lại chờ đẩy ⇒ chấm đỏ Xếp lịch."""
    lsx = db.get(Lsx, lsx_id)
    if lsx is not None:
        bao_man(db, kenh="xep_lich", loai="lenh_cho_xep", actor_id=actor_id, ma=lsx.ma)


def cham_viec_moi(db: Session, lsx_id: int, actor_id: int | None) -> None:
    """Phát hành ⇒ chấm đỏ bàn của từng tổ nhận việc (việc đã giao), và chấm Kế hoạch bộ phận cho
    từng bộ phận còn việc chờ giao (08/11/2026: kênh riêng mỗi bộ phận) kèm sự kiện để màn đang mở tự nạp."""
    from ...repositories.ke_hoach_bo_phan_repo import KeHoachBoPhanRepository
    from ...repositories.san_xuat_repo import SanXuatRepository

    for to_id in sorted(SanXuatRepository(db).to_cua_lenh([lsx_id])):
        bao_man(db, kenh=kenh_to(to_id), loai="viec_moi", actor_id=actor_id)
    from ..quyen_ke_hoach import khoa_ke_hoach

    for bp in sorted(KeHoachBoPhanRepository(db).bo_phan_cho_giao([lsx_id])):
        bao_man(db, kenh=khoa_ke_hoach(bp), loai="lenh_moi", actor_id=actor_id, phong_id=bp)
        hub.gui({"type": "ke_hoach_bo_phan_changed", "bo_phan_id": bp}, quyen=[khoa_ke_hoach(bp)])


def bao(db: Session, kq: dict, *, actor_id: int | None) -> None:
    """Trọn bộ báo sau một lần đẩy thành công. `kq` = kết quả `XepLichLenhService.phat_hanh`."""
    from ..can_doi_cache import xoa_cache_can_doi
    from ..san_xuat.vat_tu_tu_lap import bao_sau_phat_hanh

    xoa_cache_can_doi()
    phat_goi_xuong_xuong(db, kq["lsx_id"])
    cham_viec_moi(db, kq["lsx_id"], actor_id)
    bao_sau_phat_hanh(db, kq["_tu_lap"], ma_lenh=kq["ma"], actor_id=actor_id)
