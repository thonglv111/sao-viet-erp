"""Truy vấn cho màn Kế hoạch bộ phận (07/11/2026, `docs/design-lenh-san-xuat-ke-hoach-bo-phan.md` §6)."""
from __future__ import annotations

from collections.abc import Iterable
from datetime import date

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from ..models.bai_ghep import BaiGhep
from ..models.bai_ghep_cong_doan import BaiGhepCongDoan
from ..models.customer import Customer
from ..models.lsx import TT_DA_PHAT_HANH, TT_DA_XUONG_XUONG, Lsx, LsxCongDoan
from ..models.may_thiet_bi import MayThietBi, MayTo
from ..models.order import Order
from ..models.san_xuat import CV_HOAN_THANH, GOI_DA_THU_HOI, SanXuatCongViec, SanXuatGoiPhatHanh
from ..models.san_xuat_san_luong import SanXuatBatch
from ..models.san_xuat_thuc_thi import PC_HOAT_DONG, SanXuatPhanCong, SanXuatPhienChay
from .loc_danh_sach import dk_khoang_ngay


def _goi_con_hieu_luc():
    """Việc thuộc gói phát hành còn hiệu lực. Thu hồi phát hành giữ việc của gói cũ (gói đánh dấu
    `da_thu_hoi`); không lọc thì phát hành lại lệnh sẽ hiện mỗi việc hai lần."""
    return SanXuatGoiPhatHanh.trang_thai != GOI_DA_THU_HOI


class KeHoachBoPhanRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def viec_cua_bo_phan(self, bo_phan_id: int, *, xong_tu=None) -> list[SanXuatCongViec]:
        """Việc Nội bộ của bộ phận: việc còn sống (lệnh hoặc bài ghép còn đã phát hành) và việc
        Hoàn thành từ mốc `xong_tu` trở đi (chip Hoàn thành của bảng việc). Việc mới tới đứng đầu.

        Không còn thứ tự chạy do kế hoạch sắp (08/11/2026): nhóm tự quyết chạy việc nào trước."""
        cv = SanXuatCongViec
        song = (cv.trang_thai != CV_HOAN_THANH) & (
            cv.lsx_id.is_(None) | (Lsx.trang_thai == TT_DA_PHAT_HANH))
        dk = song
        if xong_tu is not None:
            dk = dk | ((cv.trang_thai == CV_HOAN_THANH) & (cv.hoan_thanh_luc >= xong_tu)
                       & (cv.lsx_id.is_(None) | Lsx.trang_thai.in_(TT_DA_XUONG_XUONG)))
        q = (
            select(cv)
            .join(SanXuatGoiPhatHanh, SanXuatGoiPhatHanh.id == cv.goi_id)
            .outerjoin(Lsx, Lsx.id == cv.lsx_id)
            .where(cv.bo_phan_id == bo_phan_id, cv.gia_cong_ngoai_id.is_(None), _goi_con_hieu_luc(), dk)
            .order_by(cv.id.desc())
        )
        return list(self.db.execute(q).scalars())

    @staticmethod
    def bieu_thuc_trang_thai():
        """Năm trạng thái của bảng việc viết thành SQL — cùng luật `trang_thai_ke_hoach`."""
        from ..models.san_xuat import CV_DANG_CHAY, CV_TAM_DUNG

        cv = SanXuatCongViec
        return case(
            (and_(cv.da_giao_at.is_(None), cv.trang_thai != CV_HOAN_THANH), "chua_giao"),
            (cv.trang_thai == CV_DANG_CHAY, "dang_chay"),
            (cv.trang_thai == CV_TAM_DUNG, "tam_dung"),
            (cv.trang_thai == CV_HOAN_THANH, "hoan_thanh"),
            else_="da_giao",
        )

    def _loc_bang(self, bo_phan_id: int, *, tim: str | None, tu_ngay: date | None,
                  den_ngay: date | None, may_id: int | None, nhom_id: int | None):
        """Điều kiện chung của bảng việc (chưa tính chip): việc Nội bộ của bộ phận, việc còn sống
        cộng việc Hoàn thành mọi lúc; tìm theo lệnh, bài ghép, sản phẩm, khách, công đoạn, máy; kỳ
        theo lúc việc tới bộ phận."""
        cv = SanXuatCongViec
        song = (cv.trang_thai != CV_HOAN_THANH) & (cv.lsx_id.is_(None) | (Lsx.trang_thai == TT_DA_PHAT_HANH))
        xong = (cv.trang_thai == CV_HOAN_THANH) & (cv.lsx_id.is_(None) | Lsx.trang_thai.in_(TT_DA_XUONG_XUONG))
        dk = [cv.bo_phan_id == bo_phan_id, cv.gia_cong_ngoai_id.is_(None), _goi_con_hieu_luc(), or_(song, xong)]
        if tim:
            mau = f"%{tim.strip()}%"
            dk.append(or_(Lsx.ma.ilike(mau), Lsx.ten.ilike(mau), Customer.name.ilike(mau),
                          BaiGhep.ma.ilike(mau), cv.ten_cong_doan.ilike(mau), MayThietBi.ten.ilike(mau),
                          MayThietBi.ma.ilike(mau)))
        dk.extend(dk_khoang_ngay(cv.created_at, tu_ngay, den_ngay))
        if may_id is not None:
            dk.append(cv.may_id == may_id)
        if nhom_id is not None:
            dk.append(cv.department_id == nhom_id)
        return dk

    def _tu(self, q):
        cv = SanXuatCongViec
        return (q.select_from(cv)
                .join(SanXuatGoiPhatHanh, SanXuatGoiPhatHanh.id == cv.goi_id)
                .outerjoin(Lsx, Lsx.id == cv.lsx_id)
                .outerjoin(Order, Order.id == Lsx.order_id)
                .outerjoin(Customer, Customer.id == Order.customer_id)
                .outerjoin(BaiGhep, BaiGhep.id == cv.bai_ghep_id)
                .outerjoin(MayThietBi, MayThietBi.id == cv.may_id))

    def trang_viec(self, bo_phan_id: int, *, trang_thai: str, offset: int, limit: int,
                   **loc) -> tuple[list[SanXuatCongViec], int]:
        """Một trang bảng việc ở chip `trang_thai`, việc mới tới đứng đầu, kèm tổng khớp."""
        cv = SanXuatCongViec
        dk = self._loc_bang(bo_phan_id, **loc)
        if trang_thai != "tat_ca":
            dk.append(self.bieu_thuc_trang_thai() == trang_thai)
        tong = self.db.execute(self._tu(select(func.count(cv.id))).where(*dk)).scalar_one()
        rows = self.db.execute(
            self._tu(select(cv)).where(*dk).order_by(cv.id.desc()).offset(offset).limit(limit)
        ).scalars().all()
        return list(rows), int(tong)

    def dem_trang_thai(self, bo_phan_id: int, **loc) -> dict[str, int]:
        """Số việc khớp tìm / kỳ / lọc ở từng chip."""
        tt = self.bieu_thuc_trang_thai().label("tt")
        rows = self.db.execute(
            self._tu(select(tt, func.count(SanXuatCongViec.id))).where(*self._loc_bang(bo_phan_id, **loc))
            .group_by(tt)
        ).all()
        return {k: int(n) for k, n in rows}

    def viec_theo_may(self, bo_phan_id: int) -> tuple[set[int], dict[int, int]]:
        """Máy đang có việc chạy của bộ phận, và số việc Đã giao còn chờ chạy trên từng máy (khoá
        `None` = làm tay)."""
        from ..models.san_xuat import CV_DANG_CHAY, CV_PHAT_HANH

        cv = SanXuatCongViec
        chay: set[int] = set()
        cho: dict[int, int] = {}
        for may_id, tt, n in self.db.execute(
            select(cv.may_id, cv.trang_thai, func.count(cv.id))
            .join(SanXuatGoiPhatHanh, SanXuatGoiPhatHanh.id == cv.goi_id)
            .outerjoin(Lsx, Lsx.id == cv.lsx_id)
            .where(cv.bo_phan_id == bo_phan_id, cv.gia_cong_ngoai_id.is_(None),
                   _goi_con_hieu_luc(),
                   (cv.trang_thai == CV_DANG_CHAY)
                   | ((cv.trang_thai == CV_PHAT_HANH) & cv.da_giao_at.is_not(None)),
                   cv.lsx_id.is_(None) | (Lsx.trang_thai == TT_DA_PHAT_HANH))
            .group_by(cv.may_id, cv.trang_thai)
        ).all():
            if tt == CV_DANG_CHAY:
                if may_id is not None:
                    chay.add(may_id)
            else:
                cho[may_id] = int(n)   # khoá None = việc Đã giao làm tay
        return chay, cho

    def bo_phan_cho_giao(self, lsx_ids: Iterable[int]) -> set[int]:
        """Bộ phận còn việc CHƯA GIAO của những lệnh này (kể cả việc chung bài ghép chứa lệnh)."""
        from .san_xuat_repo import SanXuatRepository

        lsx_ids = {int(i) for i in lsx_ids}
        if not lsx_ids:
            return set()
        cv = SanXuatCongViec
        dk = cv.lsx_id.in_(lsx_ids)
        bai = SanXuatRepository(self.db).bai_ghep_ids_cua_lsx(lsx_ids)
        if bai:
            dk = dk | cv.bai_ghep_id.in_(bai)
        return set(self.db.execute(
            select(cv.bo_phan_id).join(SanXuatGoiPhatHanh, SanXuatGoiPhatHanh.id == cv.goi_id)
            .where(dk, cv.bo_phan_id.is_not(None), cv.da_giao_at.is_(None), _goi_con_hieu_luc())
            .distinct()).scalars())

    def cong_viec(self, cv_id: int) -> SanXuatCongViec | None:
        return self.db.get(SanXuatCongViec, cv_id)

    def buoc_lsx(self, ids: Iterable[int]) -> dict[int, LsxCongDoan]:
        ids = {int(i) for i in ids if i}
        if not ids:
            return {}
        return {r.id: r for r in self.db.execute(
            select(LsxCongDoan).where(LsxCongDoan.id.in_(ids))).scalars()}

    def buoc_bai(self, ids: Iterable[int]) -> dict[int, BaiGhepCongDoan]:
        ids = {int(i) for i in ids if i}
        if not ids:
            return {}
        return {r.id: r for r in self.db.execute(
            select(BaiGhepCongDoan).where(BaiGhepCongDoan.id.in_(ids))).scalars()}

    def lenh(self, ids: Iterable[int]) -> dict[int, tuple[Lsx, str | None, object]]:
        """`{lsx_id: (lệnh, tên khách, hạn giao)}` — hạn giao = hạn của lệnh, không thì hạn đơn."""
        ids = {int(i) for i in ids if i}
        if not ids:
            return {}
        rows = self.db.execute(
            select(Lsx, Customer.name, Order.delivery_committed_date)
            .join(Order, Order.id == Lsx.order_id)
            .outerjoin(Customer, Customer.id == Order.customer_id)
            .where(Lsx.id.in_(ids))
        ).all()
        return {l.id: (l, ten, l.han_giao_khach or han) for l, ten, han in rows}

    def ma_bai(self, ids: Iterable[int]) -> dict[int, str]:
        ids = {int(i) for i in ids if i}
        if not ids:
            return {}
        return dict(self.db.execute(select(BaiGhep.id, BaiGhep.ma).where(BaiGhep.id.in_(ids))).all())

    def may_cua_to(self, to_ids: Iterable[int]) -> list[MayThietBi]:
        """Máy CÒN DÙNG thuộc một trong các tổ, sắp theo mã."""
        to_ids = {int(i) for i in to_ids}
        if not to_ids:
            return []
        # Lọc bằng IN (subquery), KHÔNG join + DISTINCT: máy có cột JSON, Postgres không so bằng
        # được kiểu json nên `SELECT DISTINCT may_thiet_bi.*` nổ (SQLite của test thì cho qua).
        thuoc = select(MayTo.may_id).where(MayTo.department_id.in_(to_ids))
        return list(self.db.execute(
            select(MayThietBi)
            .where(MayThietBi.id.in_(thuoc), MayThietBi.active.is_(True))
            .order_by(MayThietBi.ma)
        ).scalars())

    def may(self, ids: Iterable[int]) -> dict[int, MayThietBi]:
        ids = {int(i) for i in ids if i}
        if not ids:
            return {}
        return {m.id: m for m in self.db.execute(
            select(MayThietBi).where(MayThietBi.id.in_(ids))).scalars()}

    def da_ghi_san_luong(self, cv_id: int) -> bool:
        return self.db.execute(
            select(SanXuatBatch.id).where(SanXuatBatch.cong_viec_id == cv_id).limit(1)
        ).first() is not None

    def phan_cong_hoat_dong(self, cv_id: int) -> list[SanXuatPhanCong]:
        return list(self.db.execute(
            select(SanXuatPhanCong).where(SanXuatPhanCong.cong_viec_id == cv_id,
                                          SanXuatPhanCong.trang_thai == PC_HOAT_DONG)).scalars())

    def ly_do_tam_dung(self, cv_ids: Iterable[int]) -> dict[int, str | None]:
        """`{id việc: lý do của lần Tạm dừng gần nhất}` — chữ phụ dưới chip Tạm dừng."""
        ids = {int(i) for i in cv_ids if i}
        if not ids:
            return {}
        ra: dict[int, str | None] = {}
        for cv_id, ly_do in self.db.execute(
            select(SanXuatPhienChay.cong_viec_id, SanXuatPhienChay.ly_do)
            .where(SanXuatPhienChay.cong_viec_id.in_(ids), SanXuatPhienChay.loai_dong == "tam_dung")
            .order_by(SanXuatPhienChay.ket_thuc, SanXuatPhienChay.id)
        ).all():
            ra[cv_id] = ly_do
        return ra
