"""Data-access cho KCS theo LỆNH (mg `0306`, `docs/design-kcs-theo-lenh.md`).

Giữ đúng tầng: mọi truy vấn/ghi DB của lần kiểm · lỗi · ảnh bằng chứng gom ở đây; service
`services/san_xuat/kcs.py` chỉ điều phối + kiểm luật. Số dẫn xuất (tổng đạt, lỗi chưa xem) TÍNH LÚC
ĐỌC — không cache cột.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..models.bai_ghep_cong_doan import BaiGhepCongDoanMap
from ..models.cong_doan import CongDoan
from ..models.customer import Customer
from ..models.department import Department
from ..models.gia_cong_ngoai import KIEU_TRON_GOI, GiaCongNgoai
from ..models.lsx import Lsx, LsxCongDoan
from ..models.order import Order
from ..models.san_xuat import (
    GOI_DA_THU_HOI, NHOM_DANG_SX, SanXuatCongViec, SanXuatGoiPhatHanh, SanXuatNhom, SanXuatNhomLsx,
    SanXuatPhuThuoc,
)
from ..models.san_xuat_san_luong import SanXuatBatch
from ..models.san_xuat_kcs import SanXuatKcsBatch, SanXuatKcsLoi, SanXuatKcsLoiAnh
from ..models.user import User
from .loc_danh_sach import dk_khoang_ngay


def kcs_gan_nhat_cua_lenh():
    """`max(ket_thuc)` các lần KCS của MỘT lệnh — subquery tương quan theo `Lsx.id`. Tính cả công
    việc CHUNG của bài ghép (`lsx_id IS NULL`, nối qua `bai_ghep_cong_doan_map`), đúng tập công việc
    mà `boi_canh.cong_viec_du` đưa ra màn."""
    return (
        select(func.max(SanXuatKcsBatch.ket_thuc))
        .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatKcsBatch.cong_viec_id)
        .where(or_(
            SanXuatCongViec.lsx_id == Lsx.id,
            SanXuatCongViec.bai_ghep_cong_doan_id.in_(
                select(BaiGhepCongDoanMap.bai_ghep_cong_doan_id)
                .where(BaiGhepCongDoanMap.lsx_id == Lsx.id)
            ),
        ))
        .correlate(Lsx)
        .scalar_subquery()
    )


class SanXuatKcsRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    # --- Ghi ---------------------------------------------------------------------------------
    def add(self, obj):
        self.db.add(obj)
        return obj

    def flush(self) -> None:
        self.db.flush()

    def lan_kiem_vua_ghi(self, *, cong_viec_id: int, created_by: int | None, so_loi: float,
                         so_dat: float | None, ghi_chu: str | None, tu_luc):
        """Lần kiểm Y HỆT (cùng công đoạn, người, số lỗi, số đạt nếu có, ghi chú) từ `tu_luc`."""
        dk = [
            SanXuatKcsBatch.cong_viec_id == cong_viec_id,
            SanXuatKcsBatch.created_by == created_by if created_by is not None
            else SanXuatKcsBatch.created_by.is_(None),
            SanXuatKcsBatch.so_luong_khong_dat == so_loi,
            SanXuatKcsBatch.created_at >= tu_luc,
            SanXuatKcsBatch.ghi_chu == ghi_chu if ghi_chu is not None
            else SanXuatKcsBatch.ghi_chu.is_(None),
        ]
        if so_dat is not None:
            dk.append(SanXuatKcsBatch.so_luong_dat == so_dat)
        return self.db.execute(
            select(SanXuatKcsBatch).where(*dk).order_by(SanXuatKcsBatch.id.desc()).limit(1)
        ).scalars().first()

    def loi_dau_id(self, kcs_batch_id: int) -> int | None:
        return self.db.execute(
            select(func.min(SanXuatKcsLoi.id)).where(SanXuatKcsLoi.kcs_batch_id == kcs_batch_id)
        ).scalar()

    # --- Neo lại (gate/đọc) ------------------------------------------------------------------
    def cong_viec(self, cong_viec_id: int) -> SanXuatCongViec | None:
        return self.db.get(SanXuatCongViec, cong_viec_id)

    def cong_viec_nhieu(self, ids) -> dict[int, SanXuatCongViec]:
        ids = {i for i in ids if i}
        if not ids:
            return {}
        return {cv.id: cv for cv in self.db.scalars(
            select(SanXuatCongViec).where(SanXuatCongViec.id.in_(ids))
        )}

    def cong_doan_dang_dung(self) -> list[CongDoan]:
        """Danh mục công đoạn đang dùng, theo mã — nguồn ô lọc "Công đoạn" của dashboard KCS."""
        return list(self.db.execute(
            select(CongDoan).where(CongDoan.active.is_(True)).order_by(CongDoan.ma)
        ).scalars())

    def ten_to(self, department_ids) -> dict[int, str]:
        ids = {i for i in department_ids if i}
        if not ids:
            return {}
        return {did: ten for did, ten in self.db.execute(
            select(Department.id, Department.name).where(Department.id.in_(ids))
        ).all()}

    def ten_nguoi(self, user_ids) -> dict[int, str]:
        ids = {i for i in user_ids if i}
        if not ids:
            return {}
        return {uid: ten for uid, ten in self.db.execute(
            select(User.id, User.name).where(User.id.in_(ids))
        ).all()}

    # --- Lệnh ---------------------------------------------------------------------------------
    def lsx(self, lsx_id: int | None) -> Lsx | None:
        return self.db.get(Lsx, lsx_id) if lsx_id else None

    def ma_lsx_nhieu(self, lsx_ids) -> dict[int, str]:
        ids = {i for i in lsx_ids if i}
        if not ids:
            return {}
        return {i: ma for i, ma in self.db.execute(select(Lsx.id, Lsx.ma).where(Lsx.id.in_(ids))).all()}

    def _lenh_trong_nhom(self):
        """Lệnh đã vào nhóm thành phẩm — TRỪ lệnh đang gia công trọn gói (lần chưa huỷ): đặt trọn gói
        cũng đưa lệnh vào nhóm nhưng không xuống xưởng, KCS không kiểm hàng gia công về (09/10/2026)."""
        tron_goi = (
            select(GiaCongNgoai.id)
            .where(GiaCongNgoai.lsx_id == Lsx.id, GiaCongNgoai.kieu == KIEU_TRON_GOI,
                   GiaCongNgoai.huy_luc.is_(None))
            .exists()
        )
        return (
            select(Lsx.id)
            .join(SanXuatNhomLsx, SanXuatNhomLsx.lsx_id == Lsx.id)
            .join(SanXuatNhom, SanXuatNhom.id == SanXuatNhomLsx.nhom_id)
            .outerjoin(Order, Order.id == Lsx.order_id)
            .outerjoin(Customer, Customer.id == Order.customer_id)
            .where(~tron_goi)
        )

    @staticmethod
    def _cv_cua_lenh():
        """Công việc thuộc lệnh `Lsx` (tương quan) — kể cả việc CHUNG của bài ghép, đúng tập
        `boi_canh.cong_viec_du`."""
        return or_(
            SanXuatCongViec.lsx_id == Lsx.id,
            SanXuatCongViec.bai_ghep_cong_doan_id.in_(
                select(BaiGhepCongDoanMap.bai_ghep_cong_doan_id)
                .where(BaiGhepCongDoanMap.lsx_id == Lsx.id)
                .correlate(Lsx)
            ),
        )

    @staticmethod
    def _gay():
        """Công việc GÂY của dòng lỗi — dòng cũ thiếu `cong_doan_ref_id` là của chính công đoạn kiểm."""
        return func.coalesce(SanXuatKcsLoi.cong_doan_ref_id, SanXuatKcsBatch.cong_viec_id)

    @staticmethod
    def _to_gay():
        """Tổ chịu lỗi: tổ ghi trên dòng lỗi, thiếu thì tổ của công việc gây."""
        return func.coalesce(SanXuatKcsLoi.to_chiu_id, SanXuatCongViec.department_id)

    def _co_loi_gay(self, *dk):
        """EXISTS dòng lỗi (số > 0) do một công việc của lệnh `Lsx` gây — cùng nghĩa cột "Lỗi do
        lệnh này gây" của lưới."""
        return (
            select(SanXuatKcsLoi.id)
            .join(SanXuatKcsBatch, SanXuatKcsBatch.id == SanXuatKcsLoi.kcs_batch_id)
            .join(SanXuatCongViec, SanXuatCongViec.id == self._gay())
            .where(SanXuatKcsLoi.so_luong > 0, self._cv_cua_lenh(), *dk)
            .correlate(Lsx)
            .exists()
        )

    def tinh_trang_nen(self, ids: list[int]) -> dict:
        """Số liệu TỐI THIỂU để tính tình trạng KCS của MỌI lệnh nhóm còn mở (L-VAI-13): công việc
        của lệnh (riêng + bài ghép phủ, trừ gói đã thu hồi — đúng tập `boi_canh.cong_viec_du`), nhóm,
        Σ tốt của mẻ và Σ đạt / lỗi của lần kiểm theo công việc (cộng ở SQL, không kéo từng dòng),
        thành viên nhóm + công việc KCS cuối để dò dòng nhập kho. Số câu không đổi theo số lệnh."""
        ids = list(dict.fromkeys(int(i) for i in ids))
        if not ids:
            return {"lenh": set(), "cv": {}, "nhom": {}, "tot": {}, "kiem": {}, "lsx_theo_nhom": {},
                    "cv_cuoi": []}
        con = (
            select(SanXuatCongViec)
            .join(SanXuatGoiPhatHanh, SanXuatGoiPhatHanh.id == SanXuatCongViec.goi_id)
            .where(SanXuatGoiPhatHanh.trang_thai != GOI_DA_THU_HOI)
        )
        co_lenh = set(self.db.scalars(select(Lsx.id).where(Lsx.id.in_(ids))))
        cv: dict[int, list[SanXuatCongViec]] = {i: [] for i in ids}
        for c in self.db.scalars(con.where(SanXuatCongViec.lsx_id.in_(ids))):
            cv[c.lsx_id].append(c)
        phu = list(self.db.execute(
            select(BaiGhepCongDoanMap.lsx_id, BaiGhepCongDoanMap.bai_ghep_cong_doan_id)
            .where(BaiGhepCongDoanMap.lsx_id.in_(ids))).all())
        ghep: dict[int, list[SanXuatCongViec]] = {}
        if phu:
            for c in self.db.scalars(con.where(
                    SanXuatCongViec.bai_ghep_cong_doan_id.in_({b for _l, b in phu}))):
                ghep.setdefault(c.bai_ghep_cong_doan_id, []).append(c)
        for lid, bgcd in phu:
            for c in ghep.get(bgcd, []):
                if all(x.id != c.id for x in cv[lid]):
                    cv[lid].append(c)
        cv_ids = {c.id for ds in cv.values() for c in ds}
        nhom_ids = {c.nhom_id for ds in cv.values() for c in ds if c.nhom_id is not None}
        nhom = {n.id: n for n in self.db.scalars(select(SanXuatNhom).where(SanXuatNhom.id.in_(nhom_ids)))}
        tot = {int(c): float(t or 0) for c, t in self.db.execute(
            select(SanXuatBatch.cong_viec_id, func.sum(SanXuatBatch.tot))
            .where(SanXuatBatch.cong_viec_id.in_(cv_ids)).group_by(SanXuatBatch.cong_viec_id))}
        kiem = {int(c): (float(d or 0), float(k or 0)) for c, d, k in self.db.execute(
            select(SanXuatKcsBatch.cong_viec_id, func.sum(SanXuatKcsBatch.so_luong_dat),
                   func.sum(SanXuatKcsBatch.so_luong_khong_dat))
            .where(SanXuatKcsBatch.cong_viec_id.in_(cv_ids)).group_by(SanXuatKcsBatch.cong_viec_id))}
        lsx_theo_nhom: dict[int, list[int]] = {}
        for n_id, l_id in self.db.execute(
                select(SanXuatNhomLsx.nhom_id, SanXuatNhomLsx.lsx_id).where(SanXuatNhomLsx.lsx_id.in_(ids))):
            lsx_theo_nhom.setdefault(int(n_id), []).append(int(l_id))
        cv_cuoi = [(int(a), b, c) for a, b, c in self.db.execute(
            select(SanXuatCongViec.id, SanXuatCongViec.nhom_id, SanXuatCongViec.lsx_id).where(
                SanXuatCongViec.la_kcs_cuoi.is_(True),
                or_(SanXuatCongViec.nhom_id.in_(set(lsx_theo_nhom)), SanXuatCongViec.lsx_id.in_(ids))))]
        return {"lenh": co_lenh, "cv": cv, "nhom": nhom, "tot": tot, "kiem": kiem,
                "lsx_theo_nhom": lsx_theo_nhom, "cv_cuoi": cv_cuoi}

    def trang_lenh(
        self, *, tim: str | None, gom_da_dong: bool, offset: int, limit: int | None,
        chi_da_dong: bool = False, khach_id: int | None = None,
        tu_ngay: date | None = None, den_ngay: date | None = None, moc: str = "tao",
        to_id: int | None = None, cong_doan: str | None = None, co_loi: str | None = None,
        loai: str | None = None, nguoi_kiem_id: int | None = None,
    ) -> tuple[list[int], int]:
        """Trang lệnh cho màn KCS — lệnh ĐÃ vào nhóm thành phẩm (tức đã phát hành), mặc định chỉ
        nhóm còn mở (`gom_da_dong` ⇒ mọi nhóm, `chi_da_dong` ⇒ chỉ nhóm đã đóng). Tìm theo mã/tên
        lệnh, mã nhóm, tên khách. Dải kỳ theo `moc`: `tao` ngày tạo lệnh, `kcs` lần KCS gần nhất.
        Mới nhất lên đầu. `limit=None` = mọi lệnh khớp (lọc nhanh theo tình trạng tính ở service).

        Thanh lọc (11/10/2026): `to_id` / `cong_doan` — lệnh có lỗi do tổ / công đoạn đó gây;
        `co_loi` `co|khong`; `loai` `chinh|phu` (lệnh đi kèm kiểm ở lệnh chính); `nguoi_kiem_id` —
        lệnh có lần kiểm do người đó lưu."""
        q = self._lenh_trong_nhom()
        if chi_da_dong:
            q = q.where(SanXuatNhom.trang_thai != NHOM_DANG_SX)
        elif not gom_da_dong:
            q = q.where(SanXuatNhom.trang_thai== NHOM_DANG_SX)
        if khach_id is not None:
            q = q.where(Order.customer_id == khach_id)
        if to_id is not None:
            q = q.where(self._co_loi_gay(self._to_gay() == to_id))
        if cong_doan:
            q = q.where(self._co_loi_gay(SanXuatCongViec.ten_cong_doan == cong_doan))
        if co_loi == "co":
            q = q.where(self._co_loi_gay())
        elif co_loi == "khong":
            q = q.where(~self._co_loi_gay())
        la_phu = (SanXuatNhom.than_chinh_lsx_id.is_not(None)) & (SanXuatNhom.than_chinh_lsx_id != Lsx.id)
        if loai == "phu":
            q = q.where(la_phu)
        elif loai == "chinh":
            q = q.where(~la_phu)
        if nguoi_kiem_id is not None:
            q = q.where(
                select(SanXuatKcsBatch.id)
                .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatKcsBatch.cong_viec_id)
                .where(SanXuatKcsBatch.created_by == nguoi_kiem_id, self._cv_cua_lenh())
                .correlate(Lsx)
                .exists()
            )
        cot = kcs_gan_nhat_cua_lenh() if moc == "kcs" else Lsx.created_at
        for dk in dk_khoang_ngay(cot, tu_ngay, den_ngay):
            q = q.where(dk)
        tim = (tim or "").strip()
        if tim:
            mau = f"%{tim}%"
            q = q.where(or_(
                Lsx.ma.ilike(mau), Lsx.ten.ilike(mau), SanXuatNhom.ma.ilike(mau),
                Customer.name.ilike(mau),
            ))
        tong = int(self.db.scalar(select(func.count()).select_from(q.subquery())) or 0)
        if limit == 0:
            return [], tong
        q = q.order_by(Lsx.id.desc()).offset(offset)
        ids = list(self.db.scalars(q if limit is None else q.limit(limit)))
        return ids, tong

    def khach_loc(self) -> list[tuple[int, str, int]]:
        """`(id, tên, số lệnh)` của khách có lệnh đã vào nhóm thành phẩm — ô "Khách hàng" màn KCS."""
        ids = self._lenh_trong_nhom().subquery()
        stmt = (
            select(Customer.id, Customer.name, func.count(Lsx.id))
            .join(Order, Order.customer_id == Customer.id)
            .join(Lsx, Lsx.order_id == Order.id)
            .where(Lsx.id.in_(select(ids.c.id)))
            .group_by(Customer.id, Customer.name)
            .order_by(Customer.name)
        )
        return [(int(i), t, int(n)) for i, t, n in self.db.execute(stmt).all()]

    def loi_gay_theo_lenh(self) -> list[tuple[int, int | None, str]]:
        """`(lsx_id, tổ chịu, tên công đoạn gây)` của mọi dòng lỗi do công việc của lệnh trong nhóm
        gây — nguồn ô "Tổ gây lỗi" / "Công đoạn gây lỗi" màn KCS."""
        ids = self._lenh_trong_nhom().subquery()
        return [(int(l), t, c) for l, t, c in self.db.execute(
            select(Lsx.id, self._to_gay(), SanXuatCongViec.ten_cong_doan)
            .select_from(SanXuatKcsLoi)
            .join(SanXuatKcsBatch, SanXuatKcsBatch.id == SanXuatKcsLoi.kcs_batch_id)
            .join(SanXuatCongViec, SanXuatCongViec.id == self._gay())
            .join(Lsx, self._cv_cua_lenh())
            .where(SanXuatKcsLoi.so_luong > 0, Lsx.id.in_(select(ids.c.id)))
        ).all()]

    def nguoi_kiem_theo_lenh(self) -> list[tuple[int, int]]:
        """`(lsx_id, người lưu)` của mọi lần kiểm trên công việc của lệnh trong nhóm — ô "Người kiểm"."""
        ids = self._lenh_trong_nhom().subquery()
        return [(int(l), int(u)) for l, u in self.db.execute(
            select(Lsx.id, SanXuatKcsBatch.created_by)
            .select_from(SanXuatKcsBatch)
            .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatKcsBatch.cong_viec_id)
            .join(Lsx, self._cv_cua_lenh())
            .where(SanXuatKcsBatch.created_by.is_not(None), Lsx.id.in_(select(ids.c.id)))
        ).all()]

    def thu_tu_buoc(self, lsx_ids) -> dict[int, tuple[int, int]]:
        """{lsx_cong_doan.id: (lsx_id, thu_tu)} — xếp chuỗi công đoạn theo đúng thứ tự routing."""
        ids = {i for i in lsx_ids if i}
        if not ids:
            return {}
        return {cid: (lid, tt) for cid, lid, tt in self.db.execute(
            select(LsxCongDoan.id, LsxCongDoan.lsx_id, LsxCongDoan.thu_tu)
            .where(LsxCongDoan.lsx_id.in_(ids))
        ).all()}

    # --- Lần kiểm ----------------------------------------------------------------------------
    def kcs_batch(self, kcs_batch_id: int) -> SanXuatKcsBatch | None:
        return self.db.get(SanXuatKcsBatch, kcs_batch_id)

    def kcs_batch_nhieu(self, ids) -> dict[int, SanXuatKcsBatch]:
        ids = {i for i in ids if i}
        if not ids:
            return {}
        return {b.id: b for b in self.db.scalars(
            select(SanXuatKcsBatch).where(SanXuatKcsBatch.id.in_(ids))
        )}

    def cac_kcs_batch(self, cong_viec_id: int) -> list[SanXuatKcsBatch]:
        return list(
            self.db.scalars(
                select(SanXuatKcsBatch)
                .where(SanXuatKcsBatch.cong_viec_id == cong_viec_id)
                .order_by(SanXuatKcsBatch.bat_dau, SanXuatKcsBatch.id)
            )
        )

    def khoa_kcs_cua_cong_viec(self, cong_viec_id: int) -> None:
        """Khoá MỌI lần kiểm của một công đoạn (SELECT … FOR UPDATE) trước khi đọc số gửi kho — hai
        lượt bấm "Tạo yêu cầu nhập kho" song song phải tuần tự, lượt sau đọc thấy yêu cầu lượt trước.
        SQLite bỏ qua FOR UPDATE nhưng tự khoá ghi cả DB nên vẫn tuần tự."""
        self.db.execute(
            select(SanXuatKcsBatch.id)
            .where(SanXuatKcsBatch.cong_viec_id == cong_viec_id)
            .with_for_update()
        ).all()

    def cac_kcs_batch_nhieu(self, cong_viec_ids) -> dict[int, list[SanXuatKcsBatch]]:
        """{cong_viec_id: [lần kiểm]} cho cả chuỗi công đoạn trong MỘT truy vấn."""
        ids = {i for i in cong_viec_ids if i}
        if not ids:
            return {}
        out: dict[int, list[SanXuatKcsBatch]] = {}
        for b in self.db.scalars(
            select(SanXuatKcsBatch)
            .where(SanXuatKcsBatch.cong_viec_id.in_(ids))
            .order_by(SanXuatKcsBatch.bat_dau, SanXuatKcsBatch.id)
        ):
            out.setdefault(b.cong_viec_id, []).append(b)
        return out

    def cong_viec_da_xet_tieu_chi(self, nhom_ids) -> set[int]:
        """Công việc mà tiêu chí của nó đã có KẾT QUẢ ở một lần kiểm nào đó trong các nhóm này —
        kết quả khoá theo (công việc nguồn, `thu_tu`), phần tử thiếu `cong_viec_id` là của chính
        công việc lần kiểm. Lọc JSON trong Python: cột JSON không truy vấn khoá được trên SQLite."""
        ids = {i for i in nhom_ids if i}
        if not ids:
            return set()
        out: set[int] = set()
        for cv_id, ds in self.db.execute(
            select(SanXuatKcsBatch.cong_viec_id, SanXuatKcsBatch.checklist_json)
            .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatKcsBatch.cong_viec_id)
            .where(SanXuatCongViec.nhom_id.in_(ids), SanXuatKcsBatch.checklist_json.is_not(None))
        ):
            for kq in ds or []:
                if isinstance(kq, dict):
                    out.add(int(kq.get("cong_viec_id") or cv_id))
        return out

    def tong_dat(self, cong_viec_id: int, *, tru_batch_id: int | None = None) -> float:
        """Σ đạt đã ghi cho một công việc (trừ một lần kiểm khi đang điều chỉnh chính nó)."""
        q = select(func.coalesce(func.sum(SanXuatKcsBatch.so_luong_dat), 0)).where(
            SanXuatKcsBatch.cong_viec_id == cong_viec_id
        )
        if tru_batch_id is not None:
            q = q.where(SanXuatKcsBatch.id != tru_batch_id)
        return float(self.db.scalar(q) or 0)

    def tong_loi(self, cong_viec_id: int) -> float:
        """Σ lỗi KCS BẮT TẠI một công việc (đơn vị của chính nó) — phần hàng nhận vào đã hỏng, trừ
        khỏi trần ghi mẻ (`dau_vao.tran_ghi`, 10/10/2026). Lỗi bắt ở bước sau quy ngược về đây KHÔNG
        tính: hàng đó đã rời công đoạn và đếm theo đơn vị nơi bắt."""
        return float(self.db.scalar(
            select(func.coalesce(func.sum(SanXuatKcsBatch.so_luong_khong_dat), 0))
            .where(SanXuatKcsBatch.cong_viec_id == cong_viec_id)
        ) or 0)

    def tong_kiem_nhieu(self, cong_viec_ids) -> dict[int, tuple[int, float, float]]:
        """{cong_viec_id: (số lần kiểm, Σ đạt, Σ lỗi)} — MỘT truy vấn gộp cho danh sách lệnh."""
        ids = {i for i in cong_viec_ids if i}
        if not ids:
            return {}
        rows = self.db.execute(
            select(
                SanXuatKcsBatch.cong_viec_id,
                func.count(SanXuatKcsBatch.id),
                func.coalesce(func.sum(SanXuatKcsBatch.so_luong_dat), 0),
                func.coalesce(func.sum(SanXuatKcsBatch.so_luong_khong_dat), 0),
            )
            .where(SanXuatKcsBatch.cong_viec_id.in_(ids))
            .group_by(SanXuatKcsBatch.cong_viec_id)
        ).all()
        return {cid: (int(n), float(d or 0), float(l or 0)) for cid, n, d, l in rows}

    def batch_co_loi_cua_to(self, to_ids) -> set[int]:
        """Id lần kiểm có ít nhất một dòng lỗi quy về một trong các tổ `to_ids`."""
        ids = {i for i in to_ids if i}
        if not ids:
            return set()
        return set(self.db.scalars(
            select(SanXuatKcsLoi.kcs_batch_id).where(SanXuatKcsLoi.to_chiu_id.in_(ids)).distinct()
        ))

    def loi_do_cong_doan_nhieu(self, cong_viec_ids) -> dict[int, float]:
        """{cong_viec_id: Σ số lỗi KCS quy về công đoạn đó} — lỗi tính theo nơi GÂY, bắt ở đâu cũng
        được (08/10/2026). Số theo đơn vị nơi bắt, chỉ dùng để biết có lỗi bao nhiêu dòng."""
        ids = {i for i in cong_viec_ids if i}
        if not ids:
            return {}
        rows = self.db.execute(
            select(SanXuatKcsLoi.cong_doan_ref_id, func.coalesce(func.sum(SanXuatKcsLoi.so_luong), 0))
            .where(SanXuatKcsLoi.cong_doan_ref_id.in_(ids))
            .group_by(SanXuatKcsLoi.cong_doan_ref_id)
        ).all()
        return {cid: float(l or 0) for cid, l in rows}

    # --- Lỗi ---------------------------------------------------------------------------------
    def loi(self, loi_id: int) -> SanXuatKcsLoi | None:
        return self.db.get(SanXuatKcsLoi, loi_id)

    def cac_loi_nhieu(self, kcs_batch_ids) -> dict[int, list[SanXuatKcsLoi]]:
        ids = [i for i in kcs_batch_ids if i]
        if not ids:
            return {}
        out: dict[int, list[SanXuatKcsLoi]] = {}
        for l in self.db.scalars(
            select(SanXuatKcsLoi)
            .where(SanXuatKcsLoi.kcs_batch_id.in_(ids))
            .order_by(SanXuatKcsLoi.id)
        ):
            out.setdefault(l.kcs_batch_id, []).append(l)
        return out

    def batch_quy_loi_ve(self, cong_viec_id: int) -> list[SanXuatKcsBatch]:
        """Lần kiểm của công đoạn KHÁC có lỗi quy về công đoạn này (KCS bắt ở bước sau), cũ trước."""
        return list(self.db.scalars(
            select(SanXuatKcsBatch)
            .where(
                SanXuatKcsBatch.cong_viec_id != cong_viec_id,
                SanXuatKcsBatch.id.in_(
                    select(SanXuatKcsLoi.kcs_batch_id)
                    .where(SanXuatKcsLoi.cong_doan_ref_id == cong_viec_id)
                ),
            )
            .order_by(SanXuatKcsBatch.ket_thuc, SanXuatKcsBatch.id)
        ))

    def batch_quy_loi_ve_nhieu(self, cong_viec_ids) -> list[SanXuatKcsBatch]:
        """Lần kiểm có ÍT NHẤT một lỗi quy về một trong `cong_viec_ids` — gồm cả lần kiểm ở LỆNH KHÁC
        cùng nhóm (KCS cuối của thân chính quy lỗi về bước của lệnh phụ). Cũ trước."""
        ids = {i for i in cong_viec_ids if i}
        if not ids:
            return []
        return list(self.db.scalars(
            select(SanXuatKcsBatch)
            .where(SanXuatKcsBatch.id.in_(
                select(SanXuatKcsLoi.kcs_batch_id).where(SanXuatKcsLoi.cong_doan_ref_id.in_(ids))
            ))
            .order_by(SanXuatKcsBatch.ket_thuc, SanXuatKcsBatch.id)
        ))

    # --- Nhóm thành phẩm (gộp tiêu chí ở KCS cuối, 08/10/2026) --------------------------------
    def nhom(self, nhom_id: int | None) -> SanXuatNhom | None:
        return self.db.get(SanXuatNhom, nhom_id) if nhom_id else None

    def nhom_id_cua_lsx(self, lsx_id: int | None) -> int | None:
        """Nhóm thành phẩm mà lệnh là thành viên (mỗi lệnh tối đa một nhóm)."""
        if not lsx_id:
            return None
        return self.db.scalar(
            select(SanXuatNhomLsx.nhom_id).where(SanXuatNhomLsx.lsx_id == lsx_id)
        )

    def noi_lenh_phu(self, nhom_ids) -> dict[int, int]:
        """{lệnh phụ: công việc của lệnh chính mà nó ghép vào} — cạnh phụ thuộc CHÉO lúc phát hành
        (`san_xuat_phu_thuoc`). Phát hành lại đẻ cạnh mới: giữ cạnh mới nhất."""
        ids = {i for i in nhom_ids if i}
        if not ids:
            return {}
        out: dict[int, int] = {}
        for lsx_phu, dich in self.db.execute(
            select(SanXuatCongViec.lsx_id, SanXuatPhuThuoc.dich_cong_viec_id)
            .join(SanXuatCongViec, SanXuatCongViec.id == SanXuatPhuThuoc.nguon_cong_viec_id)
            .where(SanXuatPhuThuoc.nhom_id.in_(ids))
            .order_by(SanXuatPhuThuoc.phien_ban_so, SanXuatPhuThuoc.id)
        ).all():
            if lsx_phu:
                out[lsx_phu] = dich
        return out

    def loi_gay_boi(self, cong_viec_ids) -> list[tuple[int, str | None, float]]:
        """`(công việc GÂY, đơn vị nơi bắt, số)` của mọi dòng lỗi tính cho `cong_viec_ids` — bắt ở
        đâu cũng được. Dòng cũ thiếu `cong_doan_ref_id` là lỗi của chính công đoạn lần kiểm."""
        ids = {i for i in cong_viec_ids if i}
        if not ids:
            return []
        gay = func.coalesce(SanXuatKcsLoi.cong_doan_ref_id, SanXuatKcsBatch.cong_viec_id)
        return [(int(c), dv, float(sl or 0)) for c, dv, sl in self.db.execute(
            select(gay, SanXuatKcsLoi.don_vi, SanXuatKcsLoi.so_luong)
            .join(SanXuatKcsBatch, SanXuatKcsBatch.id == SanXuatKcsLoi.kcs_batch_id)
            .where(gay.in_(ids), SanXuatKcsLoi.so_luong > 0)
        ).all()]

    def lsx_trong_nhom(self, nhom_id: int | None) -> list[int]:
        """Id các lệnh thành viên của một nhóm thành phẩm."""
        if not nhom_id:
            return []
        return list(self.db.scalars(
            select(SanXuatNhomLsx.lsx_id).where(SanXuatNhomLsx.nhom_id == nhom_id)
        ))

    def loi_chua_xem_nhieu_to(self, department_ids) -> list[SanXuatKcsLoi]:
        """Lỗi KCS gửi tới các tổ này mà tổ chưa bấm "Đã xem" — hộp "Chờ tổ bạn xác nhận"."""
        ids = {i for i in department_ids if i}
        if not ids:
            return []
        return list(
            self.db.scalars(
                select(SanXuatKcsLoi)
                .where(
                    SanXuatKcsLoi.to_chiu_id.in_(ids),
                    SanXuatKcsLoi.phan_hoi_luc.is_(None),
                    # Điều chỉnh về 0 lỗi thì lỗi thôi đòi tổ xem — không giả "đã xem" thay tổ.
                    SanXuatKcsLoi.so_luong > 0,
                )
                .order_by(SanXuatKcsLoi.id)
            )
        )

    # --- Ảnh bằng chứng ----------------------------------------------------------------------
    def anh_cua_loi_nhieu(self, loi_ids) -> dict[int, list[SanXuatKcsLoiAnh]]:
        ids = [i for i in loi_ids if i]
        if not ids:
            return {}
        out: dict[int, list[SanXuatKcsLoiAnh]] = {}
        for a in self.db.scalars(
            select(SanXuatKcsLoiAnh)
            .where(SanXuatKcsLoiAnh.loi_id.in_(ids))
            .order_by(SanXuatKcsLoiAnh.id)
        ):
            out.setdefault(a.loi_id, []).append(a)
        return out
