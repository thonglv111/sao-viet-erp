"""A7 (28/09/2026) — Gantt bàn tổ thôi kéo toàn lịch sử (phần bàn Xếp lịch `lich()` gỡ 08/11/2026 cùng Gantt).

Cùng hai loại bài như `test_lenh_sx_con_song.py`: bản mới == bản cũ trên thế giới có cả việc/lệnh cũ
đã xong lẫn đang chạy, VÀ thứ cũ không còn lọt qua câu SQL. File riêng vì hai màn này dựng nền bằng
fixture `db` của `test_xep_lich_service` — trộn với `sess`/`client` là hai lượt xoá bảng đá nhau
(xem docstring `tests/lenh_sx_fixtures.py`).
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from app.models.san_xuat import CV_HOAN_THANH, SanXuatCongViec
from app.repositories.audit_repo import AuditLogRepository
from app.repositories.san_xuat_repo import SanXuatRepository
from app.repositories.xep_lich_lenh_repo import XepLichLenhRepository
from app.services.san_xuat import board
from app.services.xep_lich import XepLichLenhService
from tests.test_san_xuat_board import _authz, _phat_hanh_vao_to, _to_moi
from tests.test_xep_lich_service import (  # noqa: F401
    admin,
    customer,
    db,
    lsx_svc,
    orders,
)


def _svc(db) -> XepLichLenhService:
    return XepLichLenhService(db, XepLichLenhRepository(db), AuditLogRepository(db))


# --- Gantt bàn tổ (`work_items(nhom="phang")`) ----------------------------------------------------
def _ban_phang_cu(db, admin, monkeypatch, **kw) -> dict:
    """Bản cũ: repo trả TOÀN BỘ việc của tổ, cửa sổ lọc bằng Python."""
    goc = SanXuatRepository.cong_viec_cua_to
    with monkeypatch.context() as m:
        m.setattr(
            SanXuatRepository, "cong_viec_cua_to",
            lambda self, dept, *, cham_tu=None, cham_den=None, **k: goc(self, dept, **k),
        )
        return board.work_items(db, admin, _authz(db), nhom="phang", **kw)


def test_gantt_ban_to_cua_so_o_sql_khong_doi_ket_qua(
    db, orders, lsx_svc, admin, customer, monkeypatch,
):
    to = _to_moi(db, "Tổ Gantt A7", "TO-GANTT-A7")
    _phat_hanh_vao_to(db, orders, lsx_svc, admin, customer, to.id)
    cvs = db.query(SanXuatCongViec).filter_by(department_id=to.id).order_by(SanXuatCongViec.id).all()
    assert len(cvs) >= 2, "tiền đề: cần ít nhất hai việc trên bàn"
    # Bốn hình dạng: việc CŨ (năm ngoái, đã xong) · việc bắt đầu 23:30 NGÀY `den` (biên phải) ·
    # việc kết thúc 00:10 NGÀY `tu` (biên trái) · việc chưa xếp giờ (luôn giữ).
    cu, bien_phai = cvs[0], cvs[1]
    cu.du_kien_bat_dau = datetime(2025, 1, 2, 8, 0)
    cu.du_kien_ket_thuc = datetime(2025, 1, 2, 12, 0)
    cu.trang_thai = CV_HOAN_THANH
    bien_phai.du_kien_bat_dau = datetime(2026, 9, 12, 23, 30)
    bien_phai.du_kien_ket_thuc = datetime(2026, 9, 13, 2, 0)
    if len(cvs) >= 3:
        cvs[2].du_kien_bat_dau = datetime(2026, 9, 8, 20, 0)
        cvs[2].du_kien_ket_thuc = datetime(2026, 9, 10, 0, 10)
    if len(cvs) >= 4:
        cvs[3].du_kien_bat_dau = None
        cvs[3].du_kien_ket_thuc = None
    db.commit()

    for cua_so in (
        {"tu_ngay": date(2026, 9, 10), "den_ngay": date(2026, 9, 12)},
        {"tu_ngay": date(2026, 9, 10)},
        {"den_ngay": date(2026, 9, 12)},
        {"tu_ngay": date(2025, 1, 1), "den_ngay": date(2025, 1, 3)},
        {},
    ):
        moi = board.work_items(db, admin, _authz(db), team_id=to.id, nhom="phang", **cua_so)
        assert moi == _ban_phang_cu(db, admin, monkeypatch, team_id=to.id, **cua_so), cua_so

    ids_moi = [w["id"] for w in board.work_items(
        db, admin, _authz(db), team_id=to.id, nhom="phang",
        tu_ngay=date(2026, 9, 10), den_ngay=date(2026, 9, 12),
    )["cong_viec"]]
    assert bien_phai.id in ids_moi, "việc bắt đầu 23:30 ngày `den` phải còn trên bàn"

    # Việc cũ không còn lọt qua câu SQL (không chỉ bị Python gạt sau khi nạp).
    rows = SanXuatRepository(db).cong_viec_cua_to(
        {to.id},
        cham_tu=datetime(2026, 9, 9, tzinfo=timezone.utc),
        cham_den=datetime(2026, 9, 14, tzinfo=timezone.utc),
    )
    assert cu.id not in {r.id for r in rows}
    assert bien_phai.id in {r.id for r in rows}


def test_lich_ban_to_tra_ngay_nghi_ngay_le_va_ca(db, admin):
    """Lịch bàn tổ (10/10/2026) đọc Lịch làm việc như bàn Xếp lịch: ngày lễ tô nghỉ và ghi tên,
    chủ nhật làm bù KHÔNG phải ngày nghỉ, ca xưởng có mặt cho dòng "Ca … đến …"."""
    from app.models.work_calendar import KIND_OFF, KIND_WORK, SpecialDay

    to = _to_moi(db, "Tổ lịch làm việc", "TO-LICH-LV")
    db.add_all([
        SpecialDay(day=date(2026, 9, 15), kind=KIND_OFF, name="Nghỉ lễ thử"),
        SpecialDay(day=date(2026, 9, 20), kind=KIND_WORK, name="Làm bù chủ nhật"),
    ])
    db.commit()

    r = board.work_items(db, admin, _authz(db), team_id=to.id, nhom="phang",
                         tu_ngay=date(2026, 9, 14), den_ngay=date(2026, 9, 20))
    assert date(2026, 9, 15) in r["ngay_nghi"]
    assert date(2026, 9, 20) not in r["ngay_nghi"]
    assert date(2026, 9, 14) not in r["ngay_nghi"]
    assert {(n["ngay"], n["loai"], n["ten"]) for n in r["ngay_dac_biet"]} == {
        (date(2026, 9, 15), KIND_OFF, "Nghỉ lễ thử"),
        (date(2026, 9, 20), KIND_WORK, "Làm bù chủ nhật"),
    }
    assert isinstance(r["cac_ca"], list)

    # Thiếu một mép cửa sổ ⇒ không dò ngày, chỉ còn ca.
    r2 = board.work_items(db, admin, _authz(db), team_id=to.id, nhom="phang", tu_ngay=date(2026, 9, 14))
    assert r2["ngay_nghi"] == [] and r2["ngay_dac_biet"] == []
