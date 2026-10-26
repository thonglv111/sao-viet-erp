"""Tab Lịch sử của ngăn công việc (09/10/2026): gom nhật ký của mọi đối tượng gắn với công việc,
dựng câu dễ đọc ở máy chủ, mới nhất trên cùng, mốc "Tổ nhận lệnh" luôn ở cuối."""
from __future__ import annotations

import pytest

from app.models.ky_thuat_may import MUC_DO_NHE
from app.models.user import User
from app.services.san_xuat import ban_giao, lich_su_viec, su_co, thuc_thi
from tests.test_san_xuat_ban_giao import _batch, _hai_cv
from tests.test_san_xuat_su_co import _may, _mot_cong_viec
from tests.test_san_xuat_board_api import _admin_h, _to_la_sx
from tests.test_san_xuat_thuc_thi import (  # noqa: F401
    _emp,
    _mot_cv,
    admin,
    customer,
    db,
    lsx_svc,
    orders,
)


def _caus(ra) -> list[str]:
    return [d["cau"] for d in ra["items"]]


def test_chay_may_va_giao_tho_moi_nhat_tren(db, orders, lsx_svc, admin, customer):
    to, cv = _mot_cv(db, orders, lsx_svc, admin, customer)
    tho = _emp(db, to, "NV-LS-1", ten="Đào Văn Hoan")
    thuc_thi.phan_cong(db, user=admin, cong_viec_id=cv.id, employee_id=tho.id)
    thuc_thi.bat_dau(db, user=admin, cong_viec_id=cv.id)
    thuc_thi.tam_dung(db, user=admin, cong_viec_id=cv.id, ly_do="Chờ giấy từ kho")

    ra = lich_su_viec.lich_su(db, admin, cong_viec_id=cv.id)
    caus = _caus(ra)
    assert caus[:3] == ["Tạm dừng", "Bắt đầu phiên 1", "Giao thợ Đào Văn Hoan"]
    assert caus[-1] == "Tổ nhận lệnh"
    tam = ra["items"][0]
    assert tam["ly_do"] == "Chờ giấy từ kho" and tam["nhom"] == "chay_may"
    assert ra["items"][1]["mau"] == "g"
    assert ra["dem"]["chay_may"] == 2 and ra["dem"]["nguoi_khuon"] == 1
    # Không dòng nào nối mẩu dữ liệu bằng dấu — mẩu phụ đi riêng trong `ct`.
    assert all("·" not in d["cau"] and all("·" not in c for c in d["ct"]) for d in ra["items"])


def test_tam_dung_va_ket_thuc_kem_phien_chay_bao_lau(db, orders, lsx_svc, admin, customer):
    """Bảng Phiên chạy gỡ khỏi ngăn (22/10/2026) — số phút từng phiên dời sang dòng đóng phiên."""
    from datetime import timedelta

    from app.repositories.san_xuat_thuc_thi_repo import SanXuatThucThiRepository

    to, cv = _mot_cv(db, orders, lsx_svc, admin, customer)
    tho = _emp(db, to, "NV-LS-PH")
    thuc_thi.phan_cong(db, user=admin, cong_viec_id=cv.id, employee_id=tho.id)
    tt = SanXuatThucThiRepository(db)
    thuc_thi.bat_dau(db, user=admin, cong_viec_id=cv.id)
    tt.cac_phien(cv.id)[0].bat_dau -= timedelta(minutes=88)
    db.commit()
    thuc_thi.tam_dung(db, user=admin, cong_viec_id=cv.id, ly_do="Chờ giấy")
    thuc_thi.bat_dau(db, user=admin, cong_viec_id=cv.id)
    tt.cac_phien(cv.id)[1].bat_dau -= timedelta(minutes=28)
    db.commit()
    thuc_thi.ket_thuc(db, user=admin, cong_viec_id=cv.id)

    dong = {d["cau"]: d["ct"] for d in lich_su_viec.lich_su(db, admin, cong_viec_id=cv.id)["items"]}
    assert "chạy 1 giờ 28 phút" in dong["Tạm dừng"]
    assert "chạy 28 phút" in dong["Kết thúc việc"]


def test_san_luong_va_ban_giao_hai_phia(db, orders, lsx_svc, admin, customer):
    _to, cv1, cv2, _lsx = _hai_cv(db, orders, lsx_svc, admin, customer, ma="TO-LS-BG")
    b = _batch(db, admin, cv1, tot=80)
    ban_giao.de_xuat(db, user=admin, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=cv2.id, batch_ids=[b])

    nguon = lich_su_viec.lich_su(db, admin, cong_viec_id=cv1.id)
    caus = _caus(nguon)
    assert any(c == "Ghi sản lượng 80 tờ tốt" for c in caus)
    assert any(c == f"Đề xuất giao 80 tờ sang {cv2.ten_cong_doan}" for c in caus)
    assert nguon["dem"]["san_luong"] == 1 and nguon["dem"]["ban_giao"] >= 1

    dich = lich_su_viec.lich_su(db, admin, cong_viec_id=cv2.id)
    assert any(c == f"Bước {cv1.ten_cong_doan} đề xuất giao 80 tờ" for c in _caus(dich))
    # Mẻ của bước nguồn không lọt sang lịch sử bước đích.
    assert dich["dem"]["san_luong"] == 0


def test_bao_may_hong_co_dong_rieng(db, orders, lsx_svc, admin, customer):
    """Báo sự cố "vẫn chạy" không đẻ dòng Tạm dừng nào — lịch sử vẫn phải kể lại lần báo hỏng."""
    may = _may(db, "MAY-LS-SC")
    cv = _mot_cong_viec(db, orders, lsx_svc, admin, customer, ma="TO-LS-SC", may_id=may.id)
    su_co.bao_su_co(db, user=admin, cong_viec_id=cv.id,
                    mo_ta="chập chờn", muc_do=MUC_DO_NHE, dung_san_xuat=False)

    ra = lich_su_viec.lich_su(db, admin, cong_viec_id=cv.id)
    hong = next(d for d in ra["items"] if d["cau"] == "Báo máy hỏng")
    assert hong["nhom"] == "chay_may" and hong["mau"] == "r" and hong["ly_do"] == "chập chờn"
    assert "Máy MAY-LS-SC" in hong["ct"] and "máy đang dừng" not in hong["ct"]
    assert ra["items"][0] is hong  # mới nhất trên cùng
    assert "Tạm dừng" not in _caus(ra)


def test_khong_hien_tien(db, orders, lsx_svc, admin, customer):
    _to, cv1, _cv2, _lsx = _hai_cv(db, orders, lsx_svc, admin, customer, ma="TO-LS-TIEN")
    _batch(db, admin, cv1, tot=50)
    ra = lich_su_viec.lich_su(db, admin, cong_viec_id=cv1.id)
    chu = " ".join(d["cau"] + " " + " ".join(d["ct"]) for d in ra["items"])
    assert "đơn giá" not in chu.lower() and "₫" not in chu and "khoan_cong_doan" not in chu


def test_ngoai_pham_vi_thi_chan(db, orders, lsx_svc, admin, customer):
    _to, cv = _mot_cv(db, orders, lsx_svc, admin, customer)
    la = User(username="nguoi_la_ls", name="Người lạ", password_hash="x")
    db.add(la)
    db.commit()
    with pytest.raises(PermissionError):
        lich_su_viec.lich_su(db, la, cong_viec_id=cv.id)


def test_khong_co_cong_viec(db, admin):
    with pytest.raises(LookupError):
        lich_su_viec.lich_su(db, admin, cong_viec_id=999_999)


def test_api_404_khi_khong_co_cong_viec(client):
    _to_la_sx("Tổ Lịch sử", "TO-LS-API")  # có quyền ở ít nhất một tổ mới qua cổng `require_quyen_to`
    r = client.get("/api/san-xuat/work-items/999999/lich-su", headers=_admin_h(client))
    assert r.status_code == 404


def test_nhat_ky_cua_id_cu_bi_cap_lai_khong_lan_vao(db, orders, lsx_svc, admin, customer):
    """L-SX-24: id bị cấp lại sau đợt xoá dữ liệu tay — dòng audit ghi TRƯỚC khi việc hiện tại ra đời
    là của đối tượng cũ, không hiện trong lịch sử việc mới."""
    from datetime import timedelta

    from app.models.audit import AuditLog

    to, cv = _mot_cv(db, orders, lsx_svc, admin, customer, ma="TO-LS-CU")
    db.add(AuditLog(action="san_xuat_tam_dung", target=f"san_xuat_cong_viec:{cv.id}",
                    detail="ly_do=Việc cũ đã xoá", created_at=cv.created_at - timedelta(days=3)))
    db.commit()
    ra = lich_su_viec.lich_su(db, admin, cong_viec_id=cv.id)
    assert "Tạm dừng" not in _caus(ra)
    assert all("Việc cũ đã xoá" not in (d.get("ly_do") or "") for d in ra["items"])
