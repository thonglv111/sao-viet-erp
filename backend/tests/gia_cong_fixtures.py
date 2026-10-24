"""Khuôn dựng dữ liệu cho các bài Gia công ngoài (spec 2026-09-26).

Dùng CHUNG các fixture `sess` / `admin` / `customer` / `orders` / `lsx_svc` của
`tests/lenh_sx_fixtures.py` — file test nào dùng thì import cả hai.
"""
from __future__ import annotations

from itertools import count

from app.models.lsx import LB_THUE_NGOAI, TT_DA_PHAT_HANH, Lsx, LsxCongDoan, LsxCongDoanPhuThuoc
from app.models.purchase import Supplier
from app.services.san_xuat import release
from tests.test_san_xuat_board import _to_moi
from tests.test_xep_lich_service import _don_da_chuyen_sx, _ptg_2_in

_dem = count(1)


def ncc(sess, ten: str = "Cán màng Minh Long", *, nhan: bool = True) -> Supplier:
    """Một nhà cung cấp; `nhan=True` = có tích "Nhận gia công"."""
    s = Supplier(name=ten, nhan_gia_cong=nhan)
    sess.add(s)
    sess.flush()
    return s


def lenh_chua_phat(sess, orders, lsx_svc, admin, customer, *, kho_nguyen=(790, 1090)) -> Lsx:
    """MỘT lệnh vừa tạo từ đơn (nháp, CHƯA giữ chỗ vật tư) — sửa routing / đặt trọn gói được.

    Không dùng `_hai_lsx_san_sang`: hàm đó bật giữ chỗ, mà lệnh đang giữ chỗ thì `replace_routing`
    chặn (`_chan_dang_giu_cho`)."""
    ptg = _ptg_2_in(sess, kho_nguyen=kho_nguyen)   # mặc định tờ nguyên ≠ tờ in: chọn giấy cấp khổ nguyên
    d = _don_da_chuyen_sx(sess, orders, admin, customer, ptg)
    ids = [l["order_line_id"] for l in lsx_svc.preview(d.id)["lines"]]
    return lsx_svc.tao(order_id=d.id, order_line_ids=ids[:1], actor=admin)[0]


def dung_lenh_gia_cong(sess, orders, lsx_svc, admin, customer, *, buoc) -> int:
    """Lệnh ĐÃ PHÁT HÀNH, routing tuyến tính do bài test mô tả. Trả `lsx_id`.

    `buoc` = list `(ten, loai_buoc, nha_cung_cap | None, so_luong_ra, don_vi_ra)`. Bước máy/tổ về
    MỘT tổ mới (admin có đủ quyền trên tổ); bước thuê ngoài không tổ."""
    i = next(_dem)
    to = _to_moi(sess, f"Tổ GC {i}", f"TO-GC-{i}")
    lsx = lenh_chua_phat(sess, orders, lsx_svc, admin, customer)
    for cd in list(lsx.cong_doans):
        sess.delete(cd)
    sess.flush()
    buocs: list[LsxCongDoan] = []
    dv_truoc = "to"
    for k, (ten, loai, s, sl_ra, dv_ra) in enumerate(buoc):
        cd = LsxCongDoan(
            lsx_id=lsx.id, thu_tu=k, ten=ten, nhom="print" if k == 0 else "finishing",
            loai_buoc=loai, department_id=None if loai == LB_THUE_NGOAI else to.id,
            nha_cung_cap_id=s.id if s else None, nha_cung_cap=s.name if s else None,
            so_luong_vao=sl_ra, so_luong_ra=sl_ra, don_vi_vao=dv_truoc, don_vi_ra=dv_ra,
        )
        sess.add(cd)
        buocs.append(cd)
        dv_truoc = dv_ra
    sess.flush()
    for a, b in zip(buocs, buocs[1:]):
        sess.add(LsxCongDoanPhuThuoc(buoc_truoc_id=a.id, buoc_sau_id=b.id))
    sess.commit()
    release.phat_hanh(sess, lsx_ids={lsx.id}, actor=admin)
    lsx.trang_thai = TT_DA_PHAT_HANH
    sess.commit()
    return lsx.id


from datetime import datetime, timedelta, timezone

from app.models.role import Role
from app.models.san_xuat import SanXuatCongViec
from app.models.san_xuat_san_luong import SanXuatBatch
from app.models.user import User
from app.services.san_xuat import ban_giao


def cv_ten(sess, lsx_id: int, ten: str) -> SanXuatCongViec:
    return sess.query(SanXuatCongViec).filter_by(lsx_id=lsx_id, ten_cong_doan=ten).one()


def ghi_me(sess, cv, sl: float) -> SanXuatBatch:
    """Mẻ TỐT `sl` cho một công việc NỘI BỘ — chèn thẳng, bỏ qua bàn tổ (bài test không soi ghi mẻ)."""
    luc = datetime.now(timezone.utc)
    b = SanXuatBatch(cong_viec_id=cv.id, bat_dau=luc - timedelta(hours=1), ket_thuc=luc,
                     tong=sl, tot=sl, hong=0, don_vi=cv.don_vi_ra or "to")
    sess.add(b)
    sess.flush()
    return b


def giao_sang(sess, admin, nguon, dich, sl: float) -> dict:
    """Tổ nguồn ghi mẻ `sl` rồi ĐỀ XUẤT bàn giao sang `dich` — đúng cửa thật `ban_giao.de_xuat`."""
    b = ghi_me(sess, nguon, sl)
    sess.commit()
    return ban_giao.de_xuat(sess, user=admin, nguon_cong_viec_id=nguon.id,
                            dich_cong_viec_id=dich.id, batch_ids=[b.id])


from app.models.department import Department
from app.models.employee import Employee
from app.repositories.employee_repo import EmployeeRepository


def nguoi_kcs(sess, ma: str = "TO-KCS-GC") -> User:
    """Một tài khoản có dòng `kcs` (Xem + Thao tác) — đọc `chuoi_cong_doan_kcs` cần đúng quyền này."""
    from tests.quyen_to_fixtures import cap_kcs

    d = Department(name="Tổ KCS gia công", code=ma)
    sess.add(d)
    sess.flush()
    u = User(username=f"kcs_{ma.lower()}", name=f"KCS {ma}", password_hash="x", department_id=d.id)
    sess.add(u)
    sess.flush()
    return cap_kcs(sess, u)


def nhan_vien_cua(sess, user) -> Employee:
    """Hồ sơ nhân viên gắn tài khoản (giao thẳng đứng tên một nhân viên). Có sẵn thì dùng lại —
    `employees.user_id` UNIQUE."""
    emp = EmployeeRepository(sess).get_by_user_id(user.id)
    if emp is None:
        emp = Employee(code=f"NV-GC{user.id}", full_name=user.name or user.username, user_id=user.id)
        sess.add(emp)
        sess.commit()
    return emp


def nguoi_ke_hoach(sess, username: str = "kehoach_gc") -> User:
    """Một tài khoản vai "Kế hoạch SX" (seed) — người nhận toast "chờ mang đi"."""
    role = sess.query(Role).filter(Role.name == "Kế hoạch SX").one()
    u = User(username=username, name="Kế hoạch A", password_hash="x", role_id=role.id,
             is_active=True)
    sess.add(u)
    sess.commit()
    return u


from app.models.lsx import LsxCongDoanVatTu
from app.models.vat_lieu_kho import GiayNguyen


def them_giay(sess, lsx, *, so_luong: float = 0.5, don_vi: str = "tan") -> LsxCongDoanVatTu:
    """Một dòng GIẤY (Ivory 350 của `_ptg_2_in`) trên bước ĐẦU của lệnh — thay mọi dòng giấy cũ.

    Khai theo đơn vị gốc của giấy ("tan") để khỏi phụ thuộc quy cách tờ ↔ tấn trong test."""
    giay = sess.query(GiayNguyen).filter(GiayNguyen.ma == "G-IV350X").one()
    buoc = sorted(lsx.cong_doans, key=lambda c: c.thu_tu)[0]
    for vt in list(buoc.vat_tus):
        if vt.hang_loai == "giay":
            sess.delete(vt)
    sess.flush()
    vt = LsxCongDoanVatTu(
        lsx_cong_doan_id=buoc.id, hang_loai="giay", vat_tu_id=giay.id,
        vat_tu_ma_snapshot=giay.ma, vat_tu_ten_snapshot=giay.ten, don_vi_snapshot=don_vi,
        so_luong=so_luong,
    )
    sess.add(vt)
    sess.commit()
    return vt


def kh_vt(sess):
    """KeHoachVatTuService dựng đúng dây của cửa phát hành (`xep_lich/release._giu_cho_service`)."""
    from app.services.xep_lich.release import _giu_cho_service

    return _giu_cho_service(sess).kh


def hang_can_cua(sess, lsx_id: int) -> set[tuple[str, int]]:
    """Mặt hàng mà bảng cân đối đang tính nhu cầu cho lệnh này."""
    bang = kh_vt(sess).can_doi(chi_lsx_ids={lsx_id})
    return {(n["hang_loai"], n["hang_id"]) for n in bang["items"]
            if n.get("loai_nhom") == "vat_tu"
            for d in n.get("dong", []) if d.get("lsx_id") == lsx_id}


# --- Bài ghép (spec 2026-09-27 — đợt 2) ------------------------------------------------------
from app.models.bai_ghep import BaiGhep, BaiGhepThanhVien
from app.models.bai_ghep_cong_doan import BaiGhepCongDoan, BaiGhepCongDoanMap


def dung_bai_ghep_gia_cong(sess, orders, lsx_svc, admin, customer, *, buoc, chung, con=(4, 2),
                           phat_hanh: bool = True):
    """HAI lệnh cùng một bài ghép, routing GIỐNG nhau do bài test mô tả. Trả `(bg, lsx_a, lsx_b)`.

    `buoc` = list `(ten, loai_buoc, nha_cung_cap | None, so_luong, don_vi_vao, don_vi_ra)`;
    `chung` = chỉ số các bước GỘP chung (mỗi chỉ số một bước chung phủ bước đó của cả hai lệnh —
    loại bước + nhà gia công lấy theo `buoc`); `con` = số con/tờ của lệnh A, B. Bước máy/tổ về MỘT
    tổ mới. Khuôn `lenh_sx_fixtures._lenh_ghep_doi`: bài ghép phải có TRƯỚC phát hành."""
    from tests.test_xep_lich_service import _hai_lsx_san_sang

    i = next(_dem)
    to = _to_moi(sess, f"Tổ BG GC {i}", f"TO-BG-GC-{i}")
    a, b = _hai_lsx_san_sang(sess, orders, lsx_svc, admin, customer)
    for l in (a, b):
        for cd in sess.query(LsxCongDoan).filter(LsxCongDoan.lsx_id == l.id).all():
            sess.delete(cd)
    sess.flush()
    buocs: dict[int, list[LsxCongDoan]] = {}
    for l in (a, b):
        ds = []
        for k, (ten, loai, s, sl, dv_vao, dv_ra) in enumerate(buoc):
            cd = LsxCongDoan(
                lsx_id=l.id, thu_tu=k, ten=ten, nhom="print" if k == 0 else "finishing",
                loai_buoc=loai, department_id=None if loai == LB_THUE_NGOAI else to.id,
                nha_cung_cap_id=s.id if s else None, nha_cung_cap=s.name if s else None,
                so_luong_vao=sl, so_luong_ra=sl, don_vi_vao=dv_vao, don_vi_ra=dv_ra,
            )
            sess.add(cd)
            ds.append(cd)
        buocs[l.id] = ds
    sess.flush()
    for ds in buocs.values():
        for x, y in zip(ds, ds[1:]):
            sess.add(LsxCongDoanPhuThuoc(buoc_truoc_id=x.id, buoc_sau_id=y.id))
    sess.commit()

    bg = BaiGhep(ma=f"GB-GC-{i}", ten="Bài ghép gia công")
    sess.add(bg)
    sess.flush()
    for l, c in zip((a, b), con):
        sess.add(BaiGhepThanhVien(bai_ghep_id=bg.id, lsx_id=l.id, so_con_tren_to=c))
    for k in chung:
        ten, loai, s, sl, dv_vao, dv_ra = buoc[k]
        cd = BaiGhepCongDoan(
            bai_ghep_id=bg.id, thu_tu=k, ten=ten, nhom="print" if k == 0 else "finishing",
            loai_buoc=loai, department_id=None if loai == LB_THUE_NGOAI else to.id,
            nha_cung_cap_id=s.id if s else None, nha_cung_cap=s.name if s else None,
            so_luong_vao=sl, so_luong_ra=sl, don_vi_vao=dv_vao, don_vi_ra=dv_ra,
        )
        sess.add(cd)
        sess.flush()
        for l in (a, b):
            sess.add(BaiGhepCongDoanMap(bai_ghep_cong_doan_id=cd.id, lsx_id=l.id,
                                        lsx_step_key=buocs[l.id][k].step_key))
    sess.commit()
    if phat_hanh:
        release.phat_hanh(sess, lsx_ids={a.id, b.id}, bai_ghep_ids={bg.id}, actor=admin)
        sess.commit()
        for l in (a, b):
            l.trang_thai = TT_DA_PHAT_HANH
        sess.commit()
    return bg, a.id, b.id


def cv_chung(sess, bg_id: int, ten: str) -> SanXuatCongViec:
    return sess.query(SanXuatCongViec).filter_by(bai_ghep_id=bg_id, ten_cong_doan=ten).one()
