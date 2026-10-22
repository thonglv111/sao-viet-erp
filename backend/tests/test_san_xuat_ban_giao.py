"""Thực hiện sản xuất — Giai đoạn 3 mặt GHI: BÀN GIAO công đoạn (§11.2 · §11.3).

Soi tầng service `services/san_xuat/ban_giao.py` (nơi chứa LUẬT), không qua HTTP:
  · cùng tổ + cùng LSX → tự `confirmed`; khác tổ/LSX → `proposed` rồi bên NHẬN xác nhận;
  · số lượng giao = tổng tốt của MẺ chọn (không gõ tay); sửa MẺ chỉ khi còn `proposed`;
  · xác nhận là quyền Xác nhận sản lượng ở tổ ĐÍCH (dòng quyền theo tổ, mg 0302) — báo tin đẩy cho
    người giữ quyền đó trọn tổ bên kia, trừ người vừa bấm;
  · không còn điều chỉnh trên lần giao (10/10/2026): sửa số MẺ thì lần giao đổi theo, khác tổ thì
    bên nhận xác nhận lại.

`cung_to`/`lsx_id`/`department_id` là các cột SNAPSHOT của công việc — set thẳng trong test để soi
từng nhánh luật, không phụ thuộc số công đoạn mà fixture routing sinh ra. Riêng ĐÍCH bàn giao phải
là chặng sau theo routing (14/09/2026), nên `_hai_cv` khai cạnh phụ thuộc bước nguồn → bước đích.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.models.department import Department
from app.models.lsx import LsxCongDoan, LsxCongDoanPhuThuoc
from app.models.role import SCOPE_OWN
from app.models.san_xuat import CV_DANG_CHAY, CV_PHAT_HANH, SanXuatCongViec
from app.models.san_xuat_san_luong import (
    BG_DE_XUAT,
    BG_XAC_NHAN,
    SanXuatBanGiao,
    SanXuatBanGiaoBatch,
    SanXuatBatch,
)
from app.models.user import User
from app.repositories.rbac_repo import RoleRepository
from app.repositories.san_xuat_san_luong_repo import SanXuatSanLuongRepository
from app.services.rbac_service import AuthorizationService
from app.services.san_xuat import ban_giao, board, lich_su_viec, san_luong
from tests.lenh_sx_fixtures import _da_nhan_tu
from tests.san_xuat_me_fixtures import tao_me
from tests.quyen_to_fixtures import cap_quyen_to

from tests.test_san_xuat_thuc_thi import (  # noqa: F401
    _cvs,
    _phat_hanh_vao_to,
    _to_khoan,
    admin,
    customer,
    db,
    lsx_svc,
    orders,
)

_T0 = datetime(2026, 8, 19, 8, 0, tzinfo=timezone.utc)


def _hai_cv(db, orders, lsx_svc, admin, customer, ma="TO-BG"):
    """Hai công việc cùng một tổ khoán, cùng ĐANG CHẠY, bước của `cv_dich` là CHẶNG SAU của bước
    `cv_nguon` theo routing (khai cạnh nếu chưa có). Trả (to, cv_nguon, cv_dich, lsx_id)."""
    to = _to_khoan(db, admin, ma=ma)
    a, _b, _goi = _phat_hanh_vao_to(db, orders, lsx_svc, admin, customer, to.id)
    cv1, cv2 = _cvs(db, to)[:2]
    for cv in (cv1, cv2):
        cv.trang_thai = CV_DANG_CHAY
        cv.don_vi_ra = "tờ"
        cv.don_vi_vao = "tờ"
    if not db.query(LsxCongDoanPhuThuoc).filter_by(
        buoc_truoc_id=cv1.lsx_cong_doan_id, buoc_sau_id=cv2.lsx_cong_doan_id
    ).first():
        db.add(LsxCongDoanPhuThuoc(
            buoc_truoc_id=cv1.lsx_cong_doan_id, buoc_sau_id=cv2.lsx_cong_doan_id
        ))
    db.commit()
    return to, cv1, cv2, a.id


def _to_dich(db, ma="TO-BG-DICH") -> tuple[Department, User]:
    u = User(username=f"head_{ma.lower()}", name="Tổ trưởng đích", password_hash="x")
    db.add(u)
    db.flush()
    d = Department(name="Tổ Đích", code=ma, la_san_xuat=True, has_piece_work=True)
    db.add(d)
    db.flush()
    cap_quyen_to(db, u, d)
    return d, u


def _batch(db, admin, cv, *, tot=100, lot_vao=None, t0=_T0):
    return tao_me(
        db, user=admin, cong_viec_id=cv.id,
        bat_dau=t0, ket_thuc=t0 + timedelta(hours=1),
        tong=tot, tot=tot, lot_vao=lot_vao,
    )["batch_id"]


# --- Đề xuất / tự xác nhận (§11.2) ----------------------------------------------------------
def test_de_xuat_khac_to_cho_xac_nhan(db, orders, lsx_svc, admin, customer):
    to, cv1, cv2, _lsx = _hai_cv(db, orders, lsx_svc, admin, customer)
    to_b, ub = _to_dich(db)
    cv2.department_id = to_b.id                          # khác tổ → phải chờ xác nhận
    for ten, kw in (("tho_chay_dich", dict(viec=("run_order",))),
                    ("tho_own_dich", dict(viec=("confirm_output",), scope=SCOPE_OWN))):
        u = User(username=ten, name=ten, password_hash="x", department_id=to_b.id)
        db.add(u)
        db.flush()
        cap_quyen_to(db, u, to_b, **kw)
    db.commit()
    b = _batch(db, admin, cv1, tot=100)

    res = ban_giao.de_xuat(
        db, user=admin, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=cv2.id,
        batch_ids=[b],
    )
    assert res["trang_thai_ban_giao"] == BG_DE_XUAT
    assert res["so_luong"] == 100                       # = tốt của mẻ, không gõ tay
    # Đẩy cho người giữ Xác nhận sản lượng TRỌN tổ ĐÍCH — người chỉ có Thực hiện lệnh, hay chỉ có
    # Xác nhận ở phạm vi "Của tôi", không phải người xác nhận bàn giao nên không bị báo.
    assert res["notify_user_ids"] == [ub.id]


def test_hop_cho_xac_nhan_cua_to_dich_va_badge(db, orders, lsx_svc, admin, customer):
    """Bàn giao khác tổ chờ nhận hiện ở hộp "Chờ tổ bạn xác nhận" của bàn tổ ĐÍCH và cộng vào badge
    menu — tổ đích không phải đoán mở đúng công đoạn nào. Xác nhận xong thì rời hộp. SSE mang nhãn
    công đoạn để toast của người nhận nói được giao gì."""
    to, cv1, cv2, _lsx = _hai_cv(db, orders, lsx_svc, admin, customer)
    to_b, ub = _to_dich(db)
    cv2.department_id = to_b.id
    db.commit()
    b = _batch(db, admin, cv1, tot=100)
    res = ban_giao.de_xuat(
        db, user=admin, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=cv2.id, batch_ids=[b],
    )
    assert res["su_kien"] == "de_xuat"
    assert res["nguon_ten"] == cv1.ten_cong_doan and res["dich_ten"] == cv2.ten_cong_doan

    hop = board.cho_xac_nhan(db, ub, team_id=to_b.id)
    assert [(x["id"], x["dich_cong_viec_id"], x["so_luong"]) for x in hop["ban_giao"]] == [
        (res["ban_giao_id"], cv2.id, 100)
    ]
    # Công đoạn đích nằm trên bàn tổ đích ⇒ chấm đỏ trên dòng đó, không liệt kê riêng.
    assert hop["ban_giao"][0]["tren_ban"] is True
    assert {t["id"]: t["so_cho_xac_nhan"] for t in board.teams(db, ub, None)}[to_b.id] == 1
    assert board.cho_xac_nhan(db, admin, team_id=to.id)["ban_giao"] == []   # tổ nguồn không phải bấm
    # Ô "chờ xác nhận" của bàn đích: chỉ còn lệnh có công đoạn chờ nhận.
    az = AuthorizationService(RoleRepository(db))
    loc = board.work_items(db, ub, az, team_id=to_b.id, cho_xac_nhan=True)
    assert [[w["id"] for w in l["cong_viec"]] for l in loc["lenh"]] == [[cv2.id]]
    assert [w["id"] for w in board.work_items(
        db, ub, az, team_id=to_b.id, nhom="phang", cho_xac_nhan=True)["cong_viec"]] == [cv2.id]

    ban_giao.xac_nhan(db, user=ub, ban_giao_id=res["ban_giao_id"])
    assert board.cho_xac_nhan(db, ub, team_id=to_b.id)["ban_giao"] == []
    assert {t["id"]: t["so_cho_xac_nhan"] for t in board.teams(db, ub, None)}[to_b.id] == 0
    assert board.work_items(db, ub, az, team_id=to_b.id, cho_xac_nhan=True)["lenh"] == []
    assert board.work_items(db, ub, az, team_id=to_b.id)["trang"]["tong"] == 1


def test_cung_to_cung_lsx_tu_xac_nhan(db, orders, lsx_svc, admin, customer):
    to, cv1, cv2, lsx = _hai_cv(db, orders, lsx_svc, admin, customer)
    cv1.lsx_id = cv2.lsx_id = lsx                        # cùng tổ + cùng LSX → tự confirmed
    db.commit()
    b = _batch(db, admin, cv1, tot=100)

    res = ban_giao.de_xuat(
        db, user=admin, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=cv2.id,
        batch_ids=[b],
    )
    assert res["trang_thai_ban_giao"] == BG_XAC_NHAN
    assert res["notify_user_ids"] == []                 # không ai phải đợi


def test_so_theo_me_khong_vuot_phan_con_lai(db, orders, lsx_svc, admin, customer):
    """Bàn giao CŨ (trước giao-theo-mẻ) không gắn mẻ: mẻ vẫn hiện chưa giao nhưng số bị chặn ở phần
    còn lại, không giao trùng."""
    to, cv1, cv2, lsx = _hai_cv(db, orders, lsx_svc, admin, customer)
    cv1.lsx_id = cv2.lsx_id = lsx
    b = _batch(db, admin, cv1, tot=50)
    db.add(SanXuatBanGiao(
        nguon_cong_viec_id=cv1.id, dich_cong_viec_id=cv2.id, cung_to=True, so_luong=30,
        don_vi="tờ", trang_thai=BG_XAC_NHAN,
    ))
    db.commit()

    res = ban_giao.de_xuat(db, user=admin, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=cv2.id,
                           batch_ids=[b])
    assert res["so_luong"] == 20


def test_sua_me_chi_khi_proposed(db, orders, lsx_svc, admin, customer):
    to, cv1, cv2, _lsx = _hai_cv(db, orders, lsx_svc, admin, customer)
    to_b, ub = _to_dich(db)
    cv2.department_id = to_b.id
    db.commit()
    b1 = _batch(db, admin, cv1, tot=100)
    b2 = _batch(db, admin, cv1, tot=40, t0=_T0 + timedelta(hours=2))
    chung = dict(db=db, user=admin, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=cv2.id)
    repo = SanXuatSanLuongRepository(db)
    r = ban_giao.de_xuat(**chung, batch_ids=[b1, b2])
    assert r["so_luong"] == 140

    # Tick nhầm b1 → gỡ ra: số tính lại, b1 thành chưa giao.
    r2 = ban_giao.sua_de_xuat(db, user=admin, ban_giao_id=r["ban_giao_id"], batch_ids=[b2])
    assert r2["so_luong"] == 40 and r2["version"] == r["version"] + 1
    assert repo.batch_da_giao_ids(cv1.id) == {b2}

    # b1 giờ đi theo lần giao khác ⇒ lần giao đầu không lấy lại được; bỏ trống mẻ cũng không được.
    ban_giao.de_xuat(**chung, batch_ids=[b1])
    with pytest.raises(ValueError, match="đã giao rồi"):
        ban_giao.sua_de_xuat(db, user=admin, ban_giao_id=r["ban_giao_id"], batch_ids=[b1, b2])
    with pytest.raises(ValueError, match="Chọn sản lượng"):
        ban_giao.sua_de_xuat(db, user=admin, ban_giao_id=r["ban_giao_id"], batch_ids=[])

    ban_giao.xac_nhan(db, user=ub, ban_giao_id=r["ban_giao_id"])
    with pytest.raises(ValueError, match="chưa xác nhận"):  # đã xác nhận → chỉ còn điều chỉnh số
        ban_giao.sua_de_xuat(db, user=admin, ban_giao_id=r["ban_giao_id"], batch_ids=[b2])


def test_xac_nhan_la_quyen_to_dich(db, orders, lsx_svc, admin, customer):
    to, cv1, cv2, _lsx = _hai_cv(db, orders, lsx_svc, admin, customer)
    to_b, ub = _to_dich(db)
    cv2.department_id = to_b.id
    db.commit()
    b = _batch(db, admin, cv1, tot=100)
    r = ban_giao.de_xuat(
        db, user=admin, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=cv2.id,
        batch_ids=[b],
    )

    with pytest.raises(PermissionError, match="Xác nhận sản lượng"):  # tổ NGUỒN không tự xác nhận
        ban_giao.xac_nhan(db, user=admin, ban_giao_id=r["ban_giao_id"])
    # Ở tổ ĐÍCH mà chỉ có Thực hiện lệnh thì cũng không xác nhận được.
    chi_chay = User(username="chi_chay_dich", name="Chỉ chạy", password_hash="x",
                    department_id=to_b.id)
    db.add(chi_chay)
    db.flush()
    cap_quyen_to(db, chi_chay, to_b, viec=("run_order",))
    db.commit()
    with pytest.raises(PermissionError, match="Xác nhận sản lượng"):
        ban_giao.xac_nhan(db, user=chi_chay, ban_giao_id=r["ban_giao_id"])

    res = ban_giao.xac_nhan(db, user=ub, ban_giao_id=r["ban_giao_id"])
    assert res["trang_thai_ban_giao"] == BG_XAC_NHAN
    assert res["notify_user_ids"] == [admin.id]          # báo ngược người xác nhận ở tổ nguồn


# --- Sửa số mẻ thay điều chỉnh bàn giao (10/10/2026) ----------------------------------------
def test_sua_so_me_chua_giao_trong_tran_va_ghi_lich_su(db, orders, lsx_svc, admin, customer):
    """Mẻ chưa giao: sửa tự do trong trần ghi mẻ; quyền là Xác nhận sản lượng (Thực hiện lệnh không
    đủ); mỗi lần sửa có dòng Lịch sử cũ → mới kèm lý do."""
    to, cv1, cv2, lsx = _hai_cv(db, orders, lsx_svc, admin, customer, ma="TO-SM")
    cv1.lsx_id = cv2.lsx_id = lsx
    cv2.he_so_quy_doi = 1                               # trần cv2 = sản lượng cv1 (cùng tổ)
    db.commit()
    _batch(db, admin, cv1, tot=100)
    b2 = _batch(db, admin, cv2, tot=60, t0=_T0 + timedelta(hours=2))

    chi_chay = User(username="chi_chay_sm", name="Chỉ chạy", password_hash="x", department_id=to.id)
    db.add(chi_chay)
    db.flush()
    cap_quyen_to(db, chi_chay, to, viec=("run_order",))
    db.commit()
    with pytest.raises(PermissionError, match="Xác nhận sản lượng"):
        san_luong.sua_so_me(db, user=chi_chay, batch_id=b2, tot=70)

    with pytest.raises(ValueError, match="lần này ghi tối đa 100"):
        san_luong.sua_so_me(db, user=admin, batch_id=b2, tot=120)
    with pytest.raises(ValueError, match="trùng"):
        san_luong.sua_so_me(db, user=admin, batch_id=b2, tot=60)
    res = san_luong.sua_so_me(db, user=admin, batch_id=b2, tot=100, ly_do="Đếm lại")
    assert res["ban_giao"] is None
    me = db.get(SanXuatBatch, b2)
    assert (float(me.tot), float(me.tong)) == (100, 100)

    dong = [x for x in lich_su_viec.cac_dong(db, cv2) if x["nhom"] == "san_luong"]
    assert dong[0]["cau"] == "Sửa số sản lượng từ 60 thành 100 tờ" and dong[0]["ly_do"] == "Đếm lại"
    assert dong[1]["cau"] == "Ghi sản lượng 60 tờ tốt"          # số LÚC GHI, không phải số sống


def test_sua_so_me_da_giao_khac_to_ben_nhan_xac_nhan_lai(db, orders, lsx_svc, admin, customer):
    """Mẻ đã giao khác tổ: số lần giao đổi theo NGAY, bên nhận thấy lại ở hộp chờ cho tới khi xác
    nhận lại. Bên nhận không sửa được mẻ của bên giao."""
    to, cv1, cv2, _lsx = _hai_cv(db, orders, lsx_svc, admin, customer, ma="TO-DC1")
    to_b, ub = _to_dich(db, ma="TO-DC1-DICH")
    cv2.department_id = to_b.id
    db.commit()
    b = _batch(db, admin, cv1, tot=100)
    r = ban_giao.de_xuat(db, user=admin, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=cv2.id,
                         batch_ids=[b])
    ban_giao.xac_nhan(db, user=ub, ban_giao_id=r["ban_giao_id"])

    with pytest.raises(PermissionError):
        san_luong.sua_so_me(db, user=ub, batch_id=b, tot=90)
    with pytest.raises(ValueError, match="không sửa về 0"):
        san_luong.sua_so_me(db, user=admin, batch_id=b, tot=0)

    res = san_luong.sua_so_me(db, user=admin, batch_id=b, tot=90, ly_do="Đếm lại thiếu 10")
    assert res["ban_giao"]["so_luong"] == 90 and res["ban_giao"]["su_kien"] == "sua_me"
    assert ub.id in res["ban_giao"]["notify_user_ids"]
    bg = db.get(SanXuatBanGiao, r["ban_giao_id"])
    assert bg.trang_thai == BG_XAC_NHAN and bg.xac_nhan_luc is None
    assert ban_giao.cho_xac_nhan_lai(bg)
    assert [x["id"] for x in board.cho_xac_nhan(db, ub, team_id=to_b.id)["ban_giao"]] == [bg.id]
    assert {t["id"]: t["so_cho_xac_nhan"] for t in board.teams(db, ub, None)}[to_b.id] == 1

    ban_giao.xac_nhan(db, user=ub, ban_giao_id=bg.id)
    db.refresh(bg)
    assert bg.trang_thai == BG_XAC_NHAN and bg.xac_nhan_luc is not None
    assert float(bg.so_luong) == 90
    assert board.cho_xac_nhan(db, ub, team_id=to_b.id)["ban_giao"] == []
    with pytest.raises(ValueError, match="không ở trạng thái chờ xác nhận"):
        ban_giao.xac_nhan(db, user=ub, ban_giao_id=bg.id)

    # Lịch sử: bên giao một dòng "Sửa số mẻ", bên nhận một dòng kể lần giao đổi theo.
    giao = [x["cau"] for x in lich_su_viec.cac_dong(db, cv1) if "sửa số sản lượng" in x["cau"].lower()]
    assert giao == ["Sửa số sản lượng từ 100 thành 90 tờ"]
    nhan = [x for x in lich_su_viec.cac_dong(db, cv2) if "sửa số sản lượng" in x["cau"]]
    assert [x["cau"] for x in nhan] == [
        f"Bước {cv1.ten_cong_doan} sửa số sản lượng, lần giao từ 100 thành 90 tờ"]
    assert nhan[0]["ly_do"] == "Đếm lại thiếu 10" and "cần xác nhận lại" in nhan[0]["ct"]


def test_sua_so_me_cua_de_xuat_chua_nhan_doi_so_va_bao_ben_nhan(db, orders, lsx_svc, admin, customer):
    to, cv1, cv2, _lsx = _hai_cv(db, orders, lsx_svc, admin, customer, ma="TO-DX")
    to_b, ub = _to_dich(db, ma="TO-DX-DICH")
    cv2.department_id = to_b.id
    db.commit()
    b = _batch(db, admin, cv1, tot=100)
    r = ban_giao.de_xuat(db, user=admin, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=cv2.id,
                         batch_ids=[b])
    res = san_luong.sua_so_me(db, user=admin, batch_id=b, tot=110)
    assert res["ban_giao"]["su_kien"] == "sua" and res["ban_giao"]["notify_user_ids"] == [ub.id]
    bg = db.get(SanXuatBanGiao, r["ban_giao_id"])
    assert (bg.trang_thai, float(bg.so_luong)) == (BG_DE_XUAT, 110)


def test_ngan_chi_tiet_ghi_ai_giao_ai_nhan(db, orders, lsx_svc, admin, customer):
    """Cả tổ giao lẫn tổ nhận đều đọc được ai đề xuất, ai xác nhận, lúc nào. Tên lấy từ tài khoản
    đã thao tác, không gõ tay."""
    from app.schemas.san_xuat import WorkItemChiTietOut

    to, cv1, cv2, _lsx = _hai_cv(db, orders, lsx_svc, admin, customer)
    to_b, ub = _to_dich(db)
    cv2.department_id = to_b.id
    db.commit()
    b = _batch(db, admin, cv1, tot=100)
    r = ban_giao.de_xuat(db, user=admin, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=cv2.id,
                         batch_ids=[b])
    az = AuthorizationService(RoleRepository(db))

    def dong(cv, user, khoa):
        ct = board.chi_tiet_cong_viec(db, user, az, cong_viec_id=cv.id)
        return WorkItemChiTietOut.model_validate(ct).model_dump()[khoa][0]

    cho = dong(cv2, ub, "ban_giao_den")
    assert cho["nguoi_de_xuat"] == admin.name and cho["de_xuat_luc"] is not None
    assert (cho["nguoi_xac_nhan"], cho["xac_nhan_luc"]) == (None, None)
    assert "dieu_chinh" not in cho and "khong_nhat_quan" not in cho

    ban_giao.xac_nhan(db, user=ub, ban_giao_id=r["ban_giao_id"])
    for cv, user, khoa in ((cv1, admin, "ban_giao_di"), (cv2, ub, "ban_giao_den")):
        g = dong(cv, user, khoa)
        assert (g["nguoi_de_xuat"], g["nguoi_xac_nhan"]) == (admin.name, "Tổ trưởng đích")
        assert g["xac_nhan_luc"] is not None
        # Hai đầu: công đoạn + tổ — cả tổ giao lẫn tổ nhận đọc như nhau.
        assert (g["nguon_cong_doan"], g["nguon_to"]) == (cv1.ten_cong_doan, to.name)
        assert (g["dich_cong_doan"], g["dich_to"]) == (cv2.ten_cong_doan, to_b.name)


# --- Đích = chặng sau theo routing (14/09/2026) ---------------------------------------------
def test_dich_phai_la_chang_sau_theo_routing(db, orders, lsx_svc, admin, customer):
    to, cv1, cv2, lsx = _hai_cv(db, orders, lsx_svc, admin, customer)
    b = _batch(db, admin, cv1, tot=100)
    # Chính nó không phải chặng sau của nó.
    with pytest.raises(ValueError, match="không phải chặng sau"):
        ban_giao.de_xuat(
            db, user=admin, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=cv1.id,
            batch_ids=[b],
        )
    # Còn chặng sau thì không được giao ra ngoài.
    with pytest.raises(ValueError, match="phải giao cho chặng sau"):
        ban_giao.de_xuat(
            db, user=admin, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=None,
            batch_ids=[b],
        )


def test_buoc_cuoi_lenh_khong_ban_giao(db, orders, lsx_svc, admin, customer):
    """Bước cuối của lệnh không có chặng sau ⇒ không bàn giao (giao ra kho đã gỡ 17/09/2026);
    thành phẩm vào kho qua KCS đề nghị nhập kho."""
    to, cv1, _cv2, _lsx = _hai_cv(db, orders, lsx_svc, admin, customer)
    repo = SanXuatSanLuongRepository(db)
    cuoi = next(c for c in _cvs(db, to) if not repo.cong_viec_chang_sau(c))
    cuoi.trang_thai = CV_DANG_CHAY
    cuoi.don_vi_ra = cuoi.don_vi_vao = "tờ"
    # Ghi mẻ phải có hàng đã nhận từ công đoạn trước (`dau_vao`, 19/09/2026).
    for truoc in repo.cong_viec_chang_truoc(cuoi):
        truoc.don_vi_ra = "tờ"
        _da_nhan_tu(db, truoc, cuoi, 100)
    db.commit()
    b = _batch(db, admin, cuoi, tot=100)
    for dich in (None, cv1.id):
        with pytest.raises(ValueError, match="Bước cuối của lệnh không bàn giao"):
            ban_giao.de_xuat(
                db, user=admin, nguon_cong_viec_id=cuoi.id, dich_cong_viec_id=dich,
                batch_ids=[b],
            )
    assert db.query(SanXuatBanGiao).filter_by(nguon_cong_viec_id=cuoi.id).count() == 0


def _buoc(db, lsx_id, thu_tu, ten):
    cd = LsxCongDoan(lsx_id=lsx_id, thu_tu=thu_tu, ten=ten, nhom="finishing")
    db.add(cd)
    db.flush()
    return cd


def _viec(db, goi_id, lsx_id, cd, so=1, tong=1):
    cv = SanXuatCongViec(
        goi_id=goi_id, lsx_id=lsx_id, lsx_cong_doan_id=cd.id, step_key=cd.step_key,
        phan_doan_so=so, phan_doan_tong=tong, ten_cong_doan=cd.ten, trang_thai=CV_PHAT_HANH,
    )
    db.add(cv)
    db.flush()
    return cv


def test_chang_sau_theo_canh_roi_theo_thu_tu(db, orders, lsx_svc, admin, customer):
    """Cạnh đi ra thắng thứ tự bảng; bước không khai cạnh lấy bước kế tiếp; bước sau tách lần chạy
    ⇒ trả MỌI lần chạy; bước cuối lệnh ⇒ rỗng."""
    to = _to_khoan(db, admin, ma="TO-CS")
    a, _b, goi = _phat_hanh_vao_to(db, orders, lsx_svc, admin, customer, to.id)
    x, y, z = (_buoc(db, a.id, 900 + i, t) for i, t in enumerate(("X", "Y", "Z")))
    cvx, cvy = _viec(db, goi.id, a.id, x), _viec(db, goi.id, a.id, y)
    z1, z2 = _viec(db, goi.id, a.id, z, 1, 2), _viec(db, goi.id, a.id, z, 2, 2)
    db.commit()
    repo = SanXuatSanLuongRepository(db)

    assert [c.id for c in repo.cong_viec_chang_sau(cvx)] == [cvy.id]       # không cạnh → thu_tu
    assert [c.id for c in repo.cong_viec_chang_sau(cvy)] == [z1.id, z2.id]  # hai lần chạy
    assert repo.cong_viec_chang_sau(z1) == []                               # bước cuối lệnh

    db.add(LsxCongDoanPhuThuoc(buoc_truoc_id=x.id, buoc_sau_id=z.id))
    db.commit()
    assert [c.id for c in repo.cong_viec_chang_sau(cvx)] == [z1.id, z2.id]  # cạnh thắng thu_tu


# --- Ghi sản lượng tự đề xuất giao (22/10/2026) ---------------------------------------------
def test_ghi_san_luong_tu_de_xuat_giao_sang_chang_sau(db, orders, lsx_svc, admin, customer):
    """Ghi xong là có đề xuất giao đúng lần ghi đó sang chặng sau, báo tổ nhận như bấm tay. Lần ghi
    số 0 (chỉ làm việc phát sinh) không đẻ lần giao."""
    to, cv1, cv2, _lsx = _hai_cv(db, orders, lsx_svc, admin, customer)
    to_b, ub = _to_dich(db)
    cv2.department_id = to_b.id
    db.commit()
    kw = dict(user=admin, cong_viec_id=cv1.id, tu_giao=True)

    r = tao_me(db, bat_dau=_T0, ket_thuc=_T0 + timedelta(hours=1), tong=80, tot=80, **kw)
    bg = r["ban_giao"]
    assert bg["trang_thai_ban_giao"] == BG_DE_XUAT and bg["so_luong"] == 80
    assert bg["dich_cong_viec_id"] == cv2.id and bg["notify_user_ids"] == [ub.id]
    assert [lk.batch_id for lk in db.query(SanXuatBanGiaoBatch).filter_by(
        ban_giao_id=bg["ban_giao_id"])] == [r["batch_id"]]

    t1 = _T0 + timedelta(hours=2)
    r0 = tao_me(db, bat_dau=t1, ket_thuc=t1 + timedelta(hours=1), tong=0, tot=0, **kw)
    assert r0["ban_giao"] is None
    assert db.query(SanXuatBanGiao).filter_by(nguon_cong_viec_id=cv1.id).count() == 1


def test_ghi_san_luong_cung_to_tu_giao_da_xac_nhan(db, orders, lsx_svc, admin, customer):
    to, cv1, cv2, lsx = _hai_cv(db, orders, lsx_svc, admin, customer)
    cv1.lsx_id = cv2.lsx_id = lsx
    db.commit()
    r = tao_me(db, user=admin, cong_viec_id=cv1.id, bat_dau=_T0, ket_thuc=_T0 + timedelta(hours=1),
               tong=50, tot=50, tu_giao=True)
    assert r["ban_giao"]["trang_thai_ban_giao"] == BG_XAC_NHAN
    assert r["ban_giao"]["notify_user_ids"] == []


# --- Giao theo mẻ (14/09/2026) --------------------------------------------------------------
def test_giao_theo_me(db, orders, lsx_svc, admin, customer):
    to, cv1, cv2, lsx = _hai_cv(db, orders, lsx_svc, admin, customer)
    cv1.lsx_id = cv2.lsx_id = lsx                        # cùng tổ + cùng lệnh: tự xác nhận
    db.commit()
    b1 = _batch(db, admin, cv1, tot=100)
    b2 = _batch(db, admin, cv1, tot=50, t0=_T0 + timedelta(hours=2))
    chung = dict(db=db, user=admin, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=cv2.id)

    with pytest.raises(ValueError, match="Chọn sản lượng"):                 # còn mẻ chưa giao
        ban_giao.de_xuat(**chung)

    r = ban_giao.de_xuat(**chung, batch_ids=[b1])
    assert r["so_luong"] == 100
    link = db.query(SanXuatBanGiaoBatch).filter_by(ban_giao_id=r["ban_giao_id"]).all()
    assert [lk.batch_id for lk in link] == [b1]
    repo = SanXuatSanLuongRepository(db)
    assert repo.batch_da_giao_ids(cv1.id) == {b1}

    with pytest.raises(ValueError, match="đã giao rồi"):               # mẻ không giao hai lần
        ban_giao.de_xuat(**chung, batch_ids=[b1])
    assert ban_giao.de_xuat(**chung, batch_ids=[b2])["so_luong"] == 50

    # Đếm thiếu 5 ⇒ sửa số mẻ, lần giao đổi theo; không đẻ phần lẻ nào để giao nốt.
    san_luong.sua_so_me(db, user=admin, batch_id=b1, tot=95)
    assert float(db.get(SanXuatBanGiao, r["ban_giao_id"]).so_luong) == 95
    with pytest.raises(ValueError, match="Không còn sản lượng tốt"):
        ban_giao.de_xuat(**chung)


# --- SSE bàn giao: MỘT gói cho cả hai tổ (16/09/2026) -----------------------------------------
@pytest.mark.parametrize(("nguon", "dich", "ky_vong"), [(7, 3, [3, 7]), (5, 5, [5])])
def test_phat_sse_ban_giao_mot_goi_cho_ca_hai_to(monkeypatch, nguon, dich, ky_vong):
    """Mỗi gói bump tick chung ở FE — mỗi tổ một gói là mọi màn đang mở nạp lại hai lượt cho một
    cú bấm. Gửi theo đối tượng: người xem sản xuất + đúng hai tổ nguồn/đích."""
    from app import realtime
    from app.doi_tuong_nhan import MAN_THEO_LENH

    goi: list[dict] = []
    dich_gui: list[dict] = []
    monkeypatch.setattr(realtime.hub, "gui",
                        lambda ev, **k: (goi.append(ev), dich_gui.append(k)))
    monkeypatch.setattr(realtime.hub, "publish", lambda *a, **k: None)
    realtime.phat_ban_giao({
        "nguon_department_id": nguon, "dich_department_id": dich,
        "ban_giao_id": 11, "trang_thai_ban_giao": "cho_xac_nhan",
    })
    assert goi == [{"type": "san_xuat_ban_giao_changed", "team_ids": ky_vong,
                    "ban_giao_id": 11, "trang_thai": "cho_xac_nhan"}]
    assert dich_gui == [{"quyen": MAN_THEO_LENH, "to": ky_vong}]


# --- Kết thúc phải giao hết (10/10/2026) -------------------------------------------------------
def test_ket_thuc_chan_khi_con_hang_chua_de_xuat_giao(db, orders, lsx_svc, admin, customer):
    """Chủ xưởng: *"lúc nhấn kết thúc thì phải đề xuất giao hết thì mới kết thúc được"*. Đề xuất
    đang chờ bên nhận tính là đã giao."""
    from app.services.san_xuat import thuc_thi

    _to, cv1, cv2, _lsx = _hai_cv(db, orders, lsx_svc, admin, customer, ma="TO-BG-KT")
    b1 = _batch(db, admin, cv1, tot=100)
    b2 = _batch(db, admin, cv1, tot=40, t0=_T0 + timedelta(hours=1))
    with pytest.raises(ValueError, match=r"Còn 140 .*chưa đề xuất giao sang .*Đề xuất giao hết"):
        thuc_thi.ket_thuc(db, user=admin, cong_viec_id=cv1.id)

    ban_giao.de_xuat(db, user=admin, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=cv2.id, batch_ids=[b1])
    with pytest.raises(ValueError, match=r"Còn 40 "):
        thuc_thi.ket_thuc(db, user=admin, cong_viec_id=cv1.id)

    ban_giao.de_xuat(db, user=admin, nguon_cong_viec_id=cv1.id, dich_cong_viec_id=cv2.id, batch_ids=[b2])
    assert thuc_thi.ket_thuc(db, user=admin, cong_viec_id=cv1.id)["trang_thai"] == "completed"


def test_ket_thuc_buoc_cuoi_khong_doi_giao(db, orders, lsx_svc, admin, customer):
    """Bước cuối lệnh không bàn giao (thành phẩm qua KCS) ⇒ Kết thúc không đòi giao."""
    from app.services.san_xuat import thuc_thi

    to, _cv1, _cv2, _lsx = _hai_cv(db, orders, lsx_svc, admin, customer, ma="TO-BG-KT2")
    repo = SanXuatSanLuongRepository(db)
    cuoi = next(c for c in _cvs(db, to) if not repo.cong_viec_chang_sau(c))
    cuoi.trang_thai = CV_DANG_CHAY
    cuoi.don_vi_ra = cuoi.don_vi_vao = "tờ"
    for truoc in repo.cong_viec_chang_truoc(cuoi):
        truoc.don_vi_ra = "tờ"
        _da_nhan_tu(db, truoc, cuoi, 100)
    db.commit()
    _batch(db, admin, cuoi, tot=100)
    assert thuc_thi.ket_thuc(db, user=admin, cong_viec_id=cuoi.id)["trang_thai"] == "completed"
