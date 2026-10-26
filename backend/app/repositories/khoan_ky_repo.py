"""Truy vấn cho tiền khoán của kỳ lương (`services/khoan_ky.py`, 21/10/2026)."""
from __future__ import annotations

from datetime import date, datetime
from types import SimpleNamespace

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Bundle, Session, selectinload

from ..models.cong_doan import CongDoanKhoan
from ..models.department import Department
from ..models.employee import Employee
from ..models.lsx import Lsx, LsxCongDoan
from ..models.payroll import (
    KhoanChiTieuNgay, KhoanCongThem, KhoanDongTay, KhoanDungMay, KhoanLanGhiTay, KhoanToTruong,
)
from ..models.san_xuat import SanXuatCongViec
from ..models.san_xuat_san_luong import SanXuatBatch, SanXuatBatchNguoi, SanXuatBatchPhatSinh


class KhoanKyRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def lan_ghi_trong_khoang(self, tu: datetime, den: datetime) -> list[tuple]:
        """Lần ghi có cấu hình Khoán của công đoạn, `bat_dau` trong [tu, den) — nơi gọi tự lọc lại
        theo ngày giờ xưởng.

        Trả cặp `(lần ghi, công việc)` dạng DÒNG CỘT (đọc thuộc tính như đối tượng) chứ không phải
        đối tượng ORM: kỳ lương có hàng nghìn lần ghi, dựng đối tượng cho chúng là phần chậm nhất
        của màn Khoán theo tổ. Chỉ lấy cột `KhoanKyService.tinh` đọc — thêm cột thì thêm ở đây."""
        b = Bundle("b", SanXuatBatch.id, SanXuatBatch.bat_dau, SanXuatBatch.ket_thuc, SanXuatBatch.tong,
                   SanXuatBatch.tot, SanXuatBatch.don_vi, SanXuatBatch.khoan_cong_doan_id,
                   SanXuatBatch.ten_khoan_snapshot, SanXuatBatch.don_gia_khoan_snapshot,
                   SanXuatBatch.gia_co_dinh_khoan_snapshot, SanXuatBatch.tuy_chon_khoan,
                   SanXuatBatch.cong_thuc_khoan_snapshot, SanXuatBatch.bac_khoan_snapshot)
        cv = Bundle("cv", SanXuatCongViec.id, SanXuatCongViec.lsx_id, SanXuatCongViec.bai_ghep_id,
                    SanXuatCongViec.department_id)
        stmt = (
            select(b, cv)
            .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatBatch.cong_viec_id)
            .where(SanXuatBatch.bat_dau >= tu, SanXuatBatch.bat_dau < den,
                   SanXuatBatch.khoan_cong_doan_id.is_not(None))
            .order_by(SanXuatBatch.bat_dau, SanXuatBatch.id)
        )
        return [(r.b, r.cv) for r in self.db.execute(stmt)]

    def lan_ghi_khong_khoan(self, tu: datetime, den: datetime) -> list[tuple]:
        """Lần ghi ở công đoạn CHƯA có cấu hình Khoán (`khoan_cong_doan_id` trống), `bat_dau` trong
        [tu, den) — để sổ hiện dòng 0 đ kèm câu "chưa có cấu hình Khoán" (L-SX-27). Dòng cột như
        `lan_ghi_trong_khoang`, thêm tên công đoạn của công việc (lần ghi không có ảnh chụp tên)."""
        b = Bundle("b", SanXuatBatch.id, SanXuatBatch.bat_dau, SanXuatBatch.tot, SanXuatBatch.don_vi)
        cv = Bundle("cv", SanXuatCongViec.id, SanXuatCongViec.lsx_id, SanXuatCongViec.bai_ghep_id,
                    SanXuatCongViec.department_id, SanXuatCongViec.ten_cong_doan)
        stmt = (
            select(b, cv)
            .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatBatch.cong_viec_id)
            .where(SanXuatBatch.bat_dau >= tu, SanXuatBatch.bat_dau < den,
                   SanXuatBatch.khoan_cong_doan_id.is_(None))
            .order_by(SanXuatBatch.bat_dau, SanXuatBatch.id)
        )
        return [(r.b, r.cv) for r in self.db.execute(stmt)]

    def lan_chay(self, den: datetime, khoan_ids: set[int], *, lsx_ids: set[int], bai_ids: set[int],
                 cv_ids: set[int], gom_truoc: datetime | None = None) -> tuple[list, list]:
        """Mọi lần ghi `bat_dau < den` của các cấu hình Khoán `khoan_ids` trên CÙNG lệnh / bài ghép /
        công việc với lần ghi của kỳ — kể cả kỳ trước — để đếm `so_lan_chay`.

        Trả `(đếm sẵn, từng dòng)`, mỗi dòng có `khoan_cong_doan_id, cv_id, lsx_id, bai_ghep_id`:
        lần ghi `bat_dau < gom_truoc` ĐẾM GỘP ở máy CSDL (dòng thêm cột `so`) — nơi gọi bảo đảm mọi
        lần ghi đó đã rơi vào kỳ; phần còn lại trả từng dòng kèm `bat_dau` để nơi gọi lọc theo ngày
        giờ xưởng. Kéo từng lần ghi của mọi kỳ trước về để đếm là phần chậm của màn Khoán theo tổ."""
        if not khoan_ids:
            return [], []
        neo = [c for c in (
            SanXuatCongViec.lsx_id.in_(lsx_ids) if lsx_ids else None,
            SanXuatCongViec.bai_ghep_id.in_(bai_ids) if bai_ids else None,
            SanXuatCongViec.id.in_(cv_ids) if cv_ids else None,
        ) if c is not None]
        khoa = (SanXuatBatch.khoan_cong_doan_id, SanXuatCongViec.id.label("cv_id"),
                SanXuatCongViec.lsx_id, SanXuatCongViec.bai_ghep_id)
        dk = (SanXuatBatch.khoan_cong_doan_id.in_(khoan_ids), or_(*neo))
        gop: list = []
        if gom_truoc is not None:
            gop = list(self.db.execute(
                select(*khoa, func.count().label("so"))
                .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatBatch.cong_viec_id)
                .where(SanXuatBatch.bat_dau < gom_truoc, *dk)
                .group_by(*khoa)).all())
        tu = (SanXuatBatch.bat_dau >= gom_truoc,) if gom_truoc is not None else ()
        dong = list(self.db.execute(
            select(SanXuatBatch.bat_dau, *khoa)
            .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatBatch.cong_viec_id)
            .where(SanXuatBatch.bat_dau < den, *tu, *dk)).all())
        return gop, dong

    def nguoi_lan_chay(self, den: datetime, khoan_ids: set[int], *, lsx_ids: set[int],
                       bai_ids: set[int], cv_ids: set[int]) -> list:
        """Mọi lần ghi `bat_dau < den` cùng neo như `lan_chay`, mỗi dòng một người tick:
        `batch_id, bat_dau, employee_id, khoan_cong_doan_id, cv_id, lsx_id, bai_ghep_id` — để đếm
        `so_lan_thu_viec`. Chỉ gọi cho cấu hình có công thức dùng chip đó."""
        if not khoan_ids:
            return []
        neo = [c for c in (
            SanXuatCongViec.lsx_id.in_(lsx_ids) if lsx_ids else None,
            SanXuatCongViec.bai_ghep_id.in_(bai_ids) if bai_ids else None,
            SanXuatCongViec.id.in_(cv_ids) if cv_ids else None,
        ) if c is not None]
        return list(self.db.execute(
            select(SanXuatBatch.id.label("batch_id"), SanXuatBatch.bat_dau, SanXuatBatchNguoi.employee_id,
                   SanXuatBatch.khoan_cong_doan_id, SanXuatCongViec.id.label("cv_id"),
                   SanXuatCongViec.lsx_id, SanXuatCongViec.bai_ghep_id)
            .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatBatch.cong_viec_id)
            .join(SanXuatBatchNguoi, SanXuatBatchNguoi.batch_id == SanXuatBatch.id)
            .where(SanXuatBatch.bat_dau < den, SanXuatBatch.khoan_cong_doan_id.in_(khoan_ids), or_(*neo))
        ).all())

    def viec_lien_truoc(self, batch_ids: set[int], den: datetime) -> dict[int, tuple[int, datetime]]:
        """`{batch_id: (cong_viec_id, bat_dau) của lần ghi liền trước}` trên CÙNG máy
        (`cong_viec.may_id`); việc không gắn máy thì cùng tổ. Xếp theo `bat_dau`, cùng giờ theo id;
        mọi lần ghi (kể cả công đoạn không khoán, kể cả kỳ trước) đều là một lần trên máy. Không có
        lần trước ⇒ vắng khỏi dict."""
        if not batch_ids:
            return {}
        nhom = (SanXuatCongViec.may_id,
                case((SanXuatCongViec.may_id.is_(None), SanXuatCongViec.department_id), else_=None))
        may_ids = select(SanXuatCongViec.may_id).join(SanXuatBatch, SanXuatBatch.cong_viec_id == SanXuatCongViec.id) \
            .where(SanXuatBatch.id.in_(batch_ids), SanXuatCongViec.may_id.is_not(None))
        to_ids = select(SanXuatCongViec.department_id).join(SanXuatBatch, SanXuatBatch.cong_viec_id == SanXuatCongViec.id) \
            .where(SanXuatBatch.id.in_(batch_ids), SanXuatCongViec.may_id.is_(None))
        thu_tu = (SanXuatBatch.bat_dau, SanXuatBatch.id)
        lag = (select(SanXuatBatch.id.label("batch_id"),
                      func.lag(SanXuatBatch.cong_viec_id).over(partition_by=nhom, order_by=thu_tu).label("truoc"),
                      func.lag(SanXuatBatch.bat_dau, type_=SanXuatBatch.bat_dau.type).over(partition_by=nhom, order_by=thu_tu).label("luc"))
               .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatBatch.cong_viec_id)
               .where(SanXuatBatch.bat_dau < den,
                      or_(SanXuatCongViec.may_id.in_(may_ids),
                          and_(SanXuatCongViec.may_id.is_(None), SanXuatCongViec.department_id.in_(to_ids))))
               .subquery())
        return {int(r.batch_id): (int(r.truoc), r.luc)
                for r in self.db.execute(select(lag.c.batch_id, lag.c.truoc, lag.c.luc)
                                         .where(lag.c.batch_id.in_(batch_ids)))
                if r.truoc is not None}

    def dung_may_trong_khoang(self, tu: date, den: date) -> list[KhoanDungMay]:
        """Ngày dừng máy (Đợt 2) có `ngay` trong [tu, den] — đã là ngày xưởng, không cần lọc lại."""
        return list(self.db.scalars(select(KhoanDungMay)
                                    .where(KhoanDungMay.ngay >= tu, KhoanDungMay.ngay <= den)
                                    .order_by(KhoanDungMay.ngay, KhoanDungMay.id)))

    def ma_sua_chua(self, ids) -> dict[int, str]:
        from ..models.ky_thuat_may import SuaChuaMay

        ids = {int(i) for i in ids or () if i}
        if not ids:
            return {}
        return {int(i): m for i, m in self.db.execute(
            select(SuaChuaMay.id, SuaChuaMay.ma).where(SuaChuaMay.id.in_(ids)))}

    def ten_nhan_vien(self, ids: set[int]) -> dict[int, str]:
        if not ids:
            return {}
        return {int(i): t for i, t in self.db.execute(
            select(Employee.id, Employee.full_name).where(Employee.id.in_(ids)))}

    def nguoi_theo_lan_ghi(self, batch_ids: list[int]) -> dict[int, list]:
        """`{batch_id: [dòng (batch_id, employee_id)]}` theo thứ tự tick — chỉ hai cột, kỳ lương có
        hàng vạn lượt tick, nạp thành đối tượng ORM là phần chậm của màn Khoán theo tổ."""
        ra: dict[int, list] = {}
        if not batch_ids:
            return ra
        for r in self.db.execute(select(SanXuatBatchNguoi.batch_id, SanXuatBatchNguoi.employee_id)
                                 .where(SanXuatBatchNguoi.batch_id.in_(batch_ids))
                                 .order_by(SanXuatBatchNguoi.id)):
            ra.setdefault(int(r.batch_id), []).append(r)
        return ra

    def phat_sinh_theo_lan_ghi(self, batch_ids: list[int]) -> dict[int, list[SanXuatBatchPhatSinh]]:
        ra: dict[int, list[SanXuatBatchPhatSinh]] = {}
        if not batch_ids:
            return ra
        for r in self.db.scalars(select(SanXuatBatchPhatSinh)
                                 .where(SanXuatBatchPhatSinh.batch_id.in_(batch_ids))
                                 .order_by(SanXuatBatchPhatSinh.id)):
            ra.setdefault(int(r.batch_id), []).append(r)
        return ra

    def khoan_theo_id(self, ids: set[int]) -> dict[int, CongDoanKhoan]:
        if not ids:
            return {}
        rows = self.db.scalars(select(CongDoanKhoan)
                               .options(selectinload(CongDoanKhoan.cong_doan))
                               .where(CongDoanKhoan.id.in_(ids)))
        return {int(k.id): k for k in rows}

    def lenh_theo_id(self, ids: set[int]) -> dict[int, Lsx]:
        if not ids:
            return {}
        rows = self.db.scalars(select(Lsx).options(selectinload(Lsx.cong_doans))
                               .where(Lsx.id.in_(ids)))
        return {int(l.id): l for l in rows}

    def lenh_cho_quy_cach(self, ids: set[int]) -> dict[int, SimpleNamespace]:
        """Lệnh dạng nhẹ cho `quy_cach_bien` (đọc kiểu vịt): đúng năm cột nó đọc + các bước nhóm
        `print` (chỉ bước đó đổi `to_sau_in`). Kỳ lương nạp hàng trăm lệnh cùng mọi bước của chúng —
        dựng đối tượng ORM cho chừng ấy là phí."""
        if not ids:
            return {}
        ra = {int(r.id): SimpleNamespace(quy_cach_json=r.quy_cach_json, so_luong_dat=r.so_luong_dat,
                                         so_con=r.so_con, so_to_ke_hoach=r.so_to_ke_hoach,
                                         so_to_nguyen=r.so_to_nguyen, cong_doans=[])
              for r in self.db.execute(select(Lsx.id, Lsx.quy_cach_json, Lsx.so_luong_dat, Lsx.so_con,
                                              Lsx.so_to_ke_hoach, Lsx.so_to_nguyen).where(Lsx.id.in_(ids)))}
        for r in self.db.execute(select(LsxCongDoan.lsx_id, LsxCongDoan.thu_tu, LsxCongDoan.nhom,
                                        LsxCongDoan.so_luong_ra)
                                 .where(LsxCongDoan.lsx_id.in_(ids), LsxCongDoan.nhom == "print")
                                 .order_by(LsxCongDoan.thu_tu, LsxCongDoan.id)):
            if int(r.lsx_id) in ra:
                ra[int(r.lsx_id)].cong_doans.append(r)
        return ra

    def bai_ghep(self, bai_id: int):
        from ..models.bai_ghep import BaiGhep

        return self.db.get(BaiGhep, bai_id)

    def phong_ban(self) -> dict[int, Department]:
        return {int(d.id): d for d in self.db.scalars(select(Department))}

    def chi_tieu_ngay(self, den_ngay: date) -> dict[int, list[KhoanChiTieuNgay]]:
        """Mọi mốc chỉ tiêu ≤ `den_ngay`, theo tổ, tăng dần ngày áp dụng."""
        ra: dict[int, list[KhoanChiTieuNgay]] = {}
        for r in self.db.scalars(select(KhoanChiTieuNgay)
                                 .where(KhoanChiTieuNgay.ap_dung_tu <= den_ngay)
                                 .order_by(KhoanChiTieuNgay.ap_dung_tu)):
            ra.setdefault(int(r.department_id), []).append(r)
        return ra

    def to_truong(self, den_ngay: date) -> dict[int, KhoanToTruong]:
        """Mốc tổ trưởng HIỆU LỰC tại `den_ngay` của từng tổ."""
        ra: dict[int, KhoanToTruong] = {}
        for r in self.db.scalars(select(KhoanToTruong)
                                 .where(KhoanToTruong.ap_dung_tu <= den_ngay)
                                 .order_by(KhoanToTruong.ap_dung_tu)):
            ra[int(r.department_id)] = r
        return ra

    def nhan_vien_theo_tai_khoan(self, user_ids: set[int]) -> dict[int, int]:
        """{user_id → employee_id} — tổ trưởng khai bằng TÀI KHOẢN đứng đầu tổ."""
        if not user_ids:
            return {}
        return {int(u): int(e) for e, u in self.db.execute(
            select(Employee.id, Employee.user_id).where(Employee.user_id.in_(user_ids)))}

    # ------------------------------------------------------------------ màn Khoán theo tổ
    def nhan_vien(self, ids: set[int]) -> dict[int, tuple[str, int | None]]:
        """`{employee_id: (họ tên, tổ)}`."""
        if not ids:
            return {}
        return {int(i): (t, d) for i, t, d in self.db.execute(
            select(Employee.id, Employee.full_name, Employee.department_id).where(Employee.id.in_(ids)))}

    def nhan_vien_cua_to(self, to_id: int) -> set[int]:
        return {int(i) for (i,) in self.db.execute(select(Employee.id).where(Employee.department_id == to_id))}

    def quy_cach_cong_viec(self, cv_ids: set[int]) -> dict[int, dict]:
        """Ảnh chụp quy cách ở công việc — cái thợ thấy ở bàn tổ."""
        if not cv_ids:
            return {}
        return {int(i): qc or {} for i, qc in self.db.execute(
            select(SanXuatCongViec.id, SanXuatCongViec.quy_cach_json).where(SanXuatCongViec.id.in_(cv_ids)))}

    def khach_theo_lenh(self, lsx_ids: set[int]) -> dict[int, str]:
        from ..models.customer import Customer
        from ..models.order import Order

        if not lsx_ids:
            return {}
        return {int(i): t for i, t in self.db.execute(
            select(Lsx.id, Customer.name).join(Order, Order.id == Lsx.order_id)
            .join(Customer, Customer.id == Order.customer_id).where(Lsx.id.in_(lsx_ids)))}

    # --- Kế toán sửa tay (23/10/2026) -------------------------------------------------------------
    def lan_ghi_tay(self, batch_ids) -> dict[int, KhoanLanGhiTay]:
        ids = {int(i) for i in batch_ids or ()}
        if not ids:
            return {}
        return {int(r.batch_id): r for r in self.db.scalars(
            select(KhoanLanGhiTay).where(KhoanLanGhiTay.batch_id.in_(ids)))}

    def lan_ghi_tay_mot(self, batch_id: int) -> KhoanLanGhiTay | None:
        return self.db.scalar(select(KhoanLanGhiTay).where(KhoanLanGhiTay.batch_id == batch_id))

    def dong_tay(self, nam: int, thang: int) -> list[KhoanDongTay]:
        return list(self.db.scalars(select(KhoanDongTay)
                                    .where(KhoanDongTay.nam == nam, KhoanDongTay.thang == thang)
                                    .order_by(KhoanDongTay.ngay, KhoanDongTay.id)))

    def cong_them(self, nam: int, thang: int) -> list[KhoanCongThem]:
        return list(self.db.scalars(select(KhoanCongThem)
                                    .where(KhoanCongThem.nam == nam, KhoanCongThem.thang == thang)
                                    .order_by(KhoanCongThem.id)))

    def cong_them_mot(self, nam: int, thang: int, to_id: int, emp_id: int) -> KhoanCongThem | None:
        return self.db.scalar(select(KhoanCongThem).where(
            KhoanCongThem.nam == nam, KhoanCongThem.thang == thang,
            KhoanCongThem.department_id == to_id, KhoanCongThem.employee_id == emp_id))

    def ten_tai_khoan(self, ids) -> dict[int, str]:
        from ..models.user import User

        ids = {int(i) for i in ids or () if i}
        if not ids:
            return {}
        return {int(i): (n or u) for i, n, u in self.db.execute(
            select(User.id, User.name, User.username).where(User.id.in_(ids)))}
