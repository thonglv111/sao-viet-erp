"""Truy vấn cho màn Kế hoạch bộ phận (07/11/2026, `docs/design-lenh-san-xuat-ke-hoach-bo-phan.md` §6)."""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.bai_ghep import BaiGhep
from ..models.bai_ghep_cong_doan import BaiGhepCongDoan
from ..models.customer import Customer
from ..models.lsx import TT_DA_PHAT_HANH, Lsx, LsxCongDoan
from ..models.may_thiet_bi import MayThietBi, MayTo
from ..models.order import Order
from ..models.san_xuat import CV_HOAN_THANH, SanXuatCongViec, SanXuatGoiPhatHanh
from ..models.san_xuat_san_luong import SanXuatBatch
from ..models.san_xuat_thuc_thi import PC_HOAT_DONG, SanXuatPhanCong


class KeHoachBoPhanRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def viec_cua_bo_phan(self, bo_phan_id: int) -> list[SanXuatCongViec]:
        """Việc Nội bộ của bộ phận còn sống: chưa xong, thuộc gói đang hiệu lực, lệnh (hoặc bài
        ghép) còn ở trạng thái đã phát hành. Thứ tự: đã xếp theo `thu_tu_xep`, rồi theo id."""
        cv = SanXuatCongViec
        q = (
            select(cv)
            .join(SanXuatGoiPhatHanh, SanXuatGoiPhatHanh.id == cv.goi_id)
            .outerjoin(Lsx, Lsx.id == cv.lsx_id)
            .where(
                cv.bo_phan_id == bo_phan_id,
                cv.trang_thai != CV_HOAN_THANH,
                cv.gia_cong_ngoai_id.is_(None),
                (cv.lsx_id.is_(None)) | (Lsx.trang_thai == TT_DA_PHAT_HANH),
            )
            .order_by(cv.thu_tu_xep.is_(None), cv.thu_tu_xep, cv.id)
        )
        return list(self.db.execute(q).scalars())

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
            select(cv.bo_phan_id).where(dk, cv.bo_phan_id.is_not(None), cv.da_giao_at.is_(None))
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

    def viec_cung_buoc(self, goi_id: int, step_keys: Iterable[str]) -> list[SanXuatCongViec]:
        keys = {k for k in step_keys if k}
        if not keys:
            return []
        return list(self.db.execute(
            select(SanXuatCongViec).where(SanXuatCongViec.goi_id == goi_id,
                                          SanXuatCongViec.step_key.in_(keys))).scalars())

    def viec_truoc(self, viec: Iterable[SanXuatCongViec]) -> dict[int, list[SanXuatCongViec]]:
        """`{id việc: [việc của khâu ngay trước]}` cho các việc này.

        Hai nguồn, vì hai nơi ghi: cạnh TRONG một lệnh nằm ở `lsx_cong_doan_phu_thuoc` (bước lệnh,
        nối sang việc qua `step_key` cùng gói); cạnh GIỮA hai lệnh (bài ghép) nằm ở
        `san_xuat_phu_thuoc`. Bước tách lần chạy: khâu trước lấy phân đoạn CUỐI (id lớn nhất)."""
        from ..models.lsx import LsxCongDoanPhuThuoc
        from ..models.san_xuat import SanXuatPhuThuoc
        from sqlalchemy.orm import aliased

        viec = [v for v in viec]
        if not viec:
            return {}
        ra: dict[int, list[SanXuatCongViec]] = {v.id: [] for v in viec}
        cv = SanXuatCongViec

        lenh = {v.lsx_id for v in viec if v.lsx_id and v.step_key}
        if lenh:
            truoc, sau = aliased(LsxCongDoan), aliased(LsxCongDoan)
            canh: dict[tuple[int, str], set[str]] = {}
            for lsx_id, k_sau, k_truoc in self.db.execute(
                select(sau.lsx_id, sau.step_key, truoc.step_key)
                .join(LsxCongDoanPhuThuoc, LsxCongDoanPhuThuoc.buoc_sau_id == sau.id)
                .join(truoc, truoc.id == LsxCongDoanPhuThuoc.buoc_truoc_id)
                .where(sau.lsx_id.in_(lenh))
            ).all():
                canh.setdefault((lsx_id, k_sau), set()).add(k_truoc)
            goi = {v.goi_id for v in viec}
            keys = {k for ks in canh.values() for k in ks}
            cuoi: dict[tuple[int, str], SanXuatCongViec] = {}
            if keys:
                for c in self.db.execute(
                    select(cv).where(cv.goi_id.in_(goi), cv.step_key.in_(keys)).order_by(cv.id)
                ).scalars():
                    cuoi[(c.goi_id, c.step_key)] = c
            for v in viec:
                for k in canh.get((v.lsx_id, v.step_key), ()):
                    c = cuoi.get((v.goi_id, k))
                    if c is not None and c.id != v.id:
                        ra[v.id].append(c)

        ids = list(ra)
        nguon = aliased(cv)
        for dich_id, c in self.db.execute(
            select(SanXuatPhuThuoc.dich_cong_viec_id, nguon)
            .join(nguon, nguon.id == SanXuatPhuThuoc.nguon_cong_viec_id)
            .where(SanXuatPhuThuoc.dich_cong_viec_id.in_(ids))
        ).all():
            if all(x.id != c.id for x in ra[dich_id]):
                ra[dich_id].append(c)
        return ra

    def da_ghi_san_luong(self, cv_id: int) -> bool:
        return self.db.execute(
            select(SanXuatBatch.id).where(SanXuatBatch.cong_viec_id == cv_id).limit(1)
        ).first() is not None

    def phan_cong_hoat_dong(self, cv_id: int) -> list[SanXuatPhanCong]:
        return list(self.db.execute(
            select(SanXuatPhanCong).where(SanXuatPhanCong.cong_viec_id == cv_id,
                                          SanXuatPhanCong.trang_thai == PC_HOAT_DONG)).scalars())
