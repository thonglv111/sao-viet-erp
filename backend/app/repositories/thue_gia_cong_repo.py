"""Truy vấn của module THUÊ GIA CÔNG — spec 2026-11-13. Mọi SELECT của module nằm ở đây."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models.bai_ghep import BaiGhep, BaiGhepThanhVien
from ..models.bai_ghep_cong_doan import BaiGhepCongDoanMap
from ..models.customer import Customer
from ..models.lsx import Lsx, LsxCongDoan, LsxCongDoanPhuThuoc, LsxCongDoanVatTu
from ..models.order import Order
from ..models.role import RolePermission
from ..models.san_xuat import GOI_DANG_PHAT_HANH, SanXuatCongViec, SanXuatGoiPhatHanh
from ..models.san_xuat_san_luong import BG_DE_XUAT, SanXuatBanGiao
from ..models.stock_request import REQ_CANCELLED, REQ_REJECTED, REQ_XUAT, StockRequest, StockRequestLine
from ..models.thue_gia_cong import (
    KIEU_TRON_GOI, TgcDon, TgcDonDong, TgcNhaGiaCong, TgcPhieuChiNhan, TgcPhieuGiao, TgcPhieuGiaoDong, TgcPhieuNhan,
    TgcPhieuNhanDong,
    TgcViec,
)
from ..models.user import User
from ..models.vat_lieu_kho import HANG_GIAY


LOC_LENH = ("chua_dat", "da_dat", "tron_goi")


def lsx_ids_loc_thue_gia_cong(loai: str):
    """Subquery `lsx_id` cho ô lọc "Thuê gia công" của danh sách lệnh — lọc + đếm ở máy chủ.
    `chua_dat` = có việc chưa nằm trong dòng đơn sống; `da_dat` = có việc trong dòng đơn sống chưa
    hoàn tất; `tron_goi` = có việc trọn gói chưa hoàn tất. Việc của bước chung bài ghép tính cho
    MỌI lệnh thành viên."""
    dong_song = select(TgcDonDong.viec_id).where(TgcDonDong.huy_luc.is_(None))
    if loai == "chua_dat":
        dk = [TgcViec.id.not_in(dong_song)]
    elif loai == "da_dat":
        dk = [TgcViec.id.in_(dong_song.where(TgcDonDong.hoan_tat_luc.is_(None)))]
    elif loai == "tron_goi":
        dk = [TgcViec.kieu == KIEU_TRON_GOI, TgcViec.id.not_in(
            select(TgcDonDong.viec_id).where(TgcDonDong.huy_luc.is_(None),
                                             TgcDonDong.hoan_tat_luc.is_not(None)))]
    else:
        raise ValueError(f"Bộ lọc thuê gia công không hợp lệ: {loai}")
    return select(TgcViec.lsx_id).where(TgcViec.lsx_id.is_not(None), *dk).union(
        select(BaiGhepThanhVien.lsx_id)
        .join(TgcViec, TgcViec.bai_ghep_id == BaiGhepThanhVien.bai_ghep_id)
        .where(*dk))


class ThueGiaCongRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    # --- Nhà gia công ----------------------------------------------------------------------
    def nha_gia_cong_options(self, *, ca_da_bo: bool = False) -> list[TgcNhaGiaCong]:
        """Danh sách nhà gia công (bảng riêng, 16/11/2026), theo tên. `ca_da_bo` kèm cả nhà đã bỏ — bộ
        lọc vẫn lọc được chứng từ cũ của họ."""
        q = select(TgcNhaGiaCong)
        if not ca_da_bo:
            q = q.where(TgcNhaGiaCong.active.is_(True))
        return list(self.db.scalars(q.order_by(func.lower(TgcNhaGiaCong.ten), TgcNhaGiaCong.id)))

    def nha_gia_cong(self, nha_id: int | None) -> TgcNhaGiaCong | None:
        """Nhà ĐANG DÙNG (chưa bỏ khỏi danh sách) — chỉ nhà này mới lập / đổi đơn được."""
        if not nha_id:
            return None
        n = self.db.get(TgcNhaGiaCong, int(nha_id))
        return n if n is not None and n.active else None

    def get_nha_gia_cong(self, nha_id: int) -> TgcNhaGiaCong | None:
        return self.db.get(TgcNhaGiaCong, int(nha_id))

    def tim_nha_theo_ten(self, ten: str) -> TgcNhaGiaCong | None:
        return self.db.scalars(select(TgcNhaGiaCong)
                               .where(func.lower(TgcNhaGiaCong.ten) == ten.strip().lower())
                               .order_by(TgcNhaGiaCong.active.desc(), TgcNhaGiaCong.id).limit(1)).first()

    def them_nha(self, ten: str) -> TgcNhaGiaCong:
        n = TgcNhaGiaCong(ten=ten, active=True)
        self.db.add(n)
        self.db.flush()
        return n

    def xoa_nha(self, n: TgcNhaGiaCong) -> None:
        self.db.delete(n)

    def nha_da_co_don(self, nha_id: int) -> bool:
        return self.db.scalar(select(TgcDon.id).where(TgcDon.nha_cung_cap_id == int(nha_id)).limit(1)) is not None

    # --- Việc ------------------------------------------------------------------------------
    def viec(self, viec_id: int) -> TgcViec | None:
        return self.db.get(TgcViec, viec_id)

    def khoa_viec(self, viec_id: int) -> TgcViec | None:
        """Lấy + KHOÁ dòng việc (Postgres `FOR UPDATE`; SQLite bỏ qua)."""
        return self.db.execute(
            select(TgcViec).where(TgcViec.id == viec_id).with_for_update()
        ).scalar_one_or_none()

    def viec_cua_lenh(self, lsx_id: int) -> list[TgcViec]:
        return list(self.db.scalars(
            select(TgcViec).where(TgcViec.lsx_id == lsx_id).order_by(TgcViec.id)))

    def viec_cua_bai_ghep(self, bai_ghep_id: int) -> list[TgcViec]:
        return list(self.db.scalars(
            select(TgcViec).where(TgcViec.bai_ghep_id == bai_ghep_id).order_by(TgcViec.id)))

    def viec_cua_goi(self, goi_id: int) -> list[TgcViec]:
        return list(self.db.scalars(
            select(TgcViec).where(TgcViec.id.in_(
                select(SanXuatCongViec.tgc_viec_id).where(SanXuatCongViec.goi_id == goi_id)
            )).order_by(TgcViec.id)))

    def cong_viec_cua_viec(self, viec_id: int) -> list[SanXuatCongViec]:
        """Công việc của việc, theo THỨ TỰ bước (snapshot đẻ theo thứ tự routing ⇒ id tăng)."""
        return list(self.db.scalars(
            select(SanXuatCongViec).where(SanXuatCongViec.tgc_viec_id == viec_id)
            .order_by(SanXuatCongViec.id)))

    def cong_viec_cua_nhieu_viec(self, viec_ids) -> dict[int, list[SanXuatCongViec]]:
        ids = sorted({int(i) for i in viec_ids if i})
        out: dict[int, list[SanXuatCongViec]] = {i: [] for i in ids}
        if not ids:
            return out
        for cv in self.db.scalars(
                select(SanXuatCongViec).where(SanXuatCongViec.tgc_viec_id.in_(ids))
                .order_by(SanXuatCongViec.id)):
            out[int(cv.tgc_viec_id)].append(cv)
        return out

    def dong_song_cua_viec(self, viec_ids) -> dict[int, str]:
        """`{viec_id: mã đơn}` của việc đang nằm trong một dòng đơn CÒN SỐNG (chưa huỷ)."""
        ids = sorted({int(i) for i in viec_ids if i})
        if not ids:
            return {}
        return {int(v): ma for v, ma in self.db.execute(
            select(TgcDonDong.viec_id, TgcDon.ma)
            .join(TgcDon, TgcDon.id == TgcDonDong.don_id)
            .where(TgcDonDong.viec_id.in_(ids), TgcDonDong.huy_luc.is_(None)))}

    def dong_song_chi_tiet(self, viec_ids) -> dict[int, tuple[str, str, bool]]:
        """`{viec_id: (mã đơn, tên NCC, đã hoàn tất)}` của dòng đơn CÒN SỐNG — MỘT câu."""
        ids = sorted({int(i) for i in viec_ids if i})
        if not ids:
            return {}
        return {int(v): (ma, ten or "", ht is not None) for v, ma, ten, ht in self.db.execute(
            select(TgcDonDong.viec_id, TgcDon.ma, TgcDon.nha_cung_cap_ten, TgcDonDong.hoan_tat_luc)
            .join(TgcDon, TgcDon.id == TgcDonDong.don_id)
            .where(TgcDonDong.viec_id.in_(ids), TgcDonDong.huy_luc.is_(None)))}

    def dong_dang_mo(self, viec_ids) -> dict[int, tuple[TgcDon, object, bool]]:
        """`{viec_id: (đơn, từ lúc, đã giao)}` của việc nằm trong dòng đơn sống, ĐƠN ĐÃ ĐẶT, dòng
        chưa hoàn tất — hàng đang ở (hoặc sắp tới) nhà gia công. "Từ lúc" = phiếu giao sống sớm nhất
        của đơn, chưa có thì lúc đặt; "đã giao" = đơn có phiếu giao sống. Hai câu."""
        ids = sorted({int(i) for i in viec_ids if i})
        if not ids:
            return {}
        cap = list(self.db.execute(
            select(TgcDonDong.viec_id, TgcDon)
            .join(TgcDon, TgcDon.id == TgcDonDong.don_id)
            .where(TgcDonDong.viec_id.in_(ids), TgcDonDong.huy_luc.is_(None),
                   TgcDonDong.hoan_tat_luc.is_(None), TgcDon.dat_luc.is_not(None))))
        if not cap:
            return {}
        giao = {int(d): t for d, t in self.db.execute(
            select(TgcPhieuGiao.don_id, func.min(TgcPhieuGiao.giao_luc))
            .where(TgcPhieuGiao.don_id.in_({d.id for _, d in cap}), TgcPhieuGiao.huy_luc.is_(None))
            .group_by(TgcPhieuGiao.don_id))}
        return {int(v): (d, giao.get(d.id) or d.dat_luc, d.id in giao) for v, d in cap}

    def tron_goi_cua_lenh(self, lsx_ids) -> dict[int, TgcViec]:
        """`{lsx_id: việc}` TRỌN GÓI của các lệnh — MỘT câu."""
        ids = [int(i) for i in lsx_ids if i]
        if not ids:
            return {}
        return {v.lsx_id: v for v in self.db.scalars(select(TgcViec).where(
            TgcViec.lsx_id.in_(ids), TgcViec.kieu == KIEU_TRON_GOI))}

    def tron_goi_dang_chay(self, lsx_ids) -> dict[int, bool]:
        """`{lsx_id: xuong_cap_giay}` của lệnh đang thuê gia công trọn gói."""
        return {k: bool(v.xuong_cap_giay) for k, v in self.tron_goi_cua_lenh(lsx_ids).items()}

    def viec_cua_nhieu_lenh(self, lsx_ids) -> list[tuple[int, TgcViec, str | None]]:
        """Việc của cả trang danh sách lệnh — MỘT câu. Việc của bước chung bài ghép tính cho MỌI
        lệnh thành viên. Trả `(lsx_id, việc, mã bài ghép)`."""
        ids = [int(i) for i in lsx_ids if i]
        if not ids:
            return []
        truc_tiep = select(TgcViec.lsx_id.label("lsx_id"), TgcViec.id.label("viec_id")).where(
            TgcViec.lsx_id.in_(ids))
        qua_bg = (select(BaiGhepThanhVien.lsx_id.label("lsx_id"), TgcViec.id.label("viec_id"))
                  .join(TgcViec, TgcViec.bai_ghep_id == BaiGhepThanhVien.bai_ghep_id)
                  .where(BaiGhepThanhVien.lsx_id.in_(ids)))
        cap = truc_tiep.union_all(qua_bg).subquery()
        return [(int(l), v, bg) for l, v, bg in self.db.execute(
            select(cap.c.lsx_id, TgcViec, BaiGhep.ma)
            .join(TgcViec, TgcViec.id == cap.c.viec_id)
            .outerjoin(BaiGhep, BaiGhep.id == TgcViec.bai_ghep_id)
            .order_by(TgcViec.id))]

    def viec_chua_dat(self) -> list[TgcViec]:
        """Mọi việc CHƯA nằm trong dòng đơn sống — nguồn của Hàng chờ."""
        return list(self.db.scalars(
            select(TgcViec).where(TgcViec.id.not_in(
                select(TgcDonDong.viec_id).where(TgcDonDong.huy_luc.is_(None))))
            .order_by(TgcViec.id)))

    def ban_giao_cho_nhan_nhieu(self, cv_ids) -> dict[int, list[SanXuatBanGiao]]:
        """`{cv_id: [bàn giao ĐỀ XUẤT chưa ai nhận]}` — MỘT câu cho cả trang Hàng chờ."""
        ids = sorted({int(i) for i in cv_ids if i})
        out: dict[int, list[SanXuatBanGiao]] = {}
        if not ids:
            return out
        for bg in self.db.scalars(
                select(SanXuatBanGiao).where(SanXuatBanGiao.dich_cong_viec_id.in_(ids),
                                             SanXuatBanGiao.trang_thai == BG_DE_XUAT)
                .order_by(SanXuatBanGiao.id)):
            out.setdefault(int(bg.dich_cong_viec_id), []).append(bg)
        return out

    def vat_tu_xuong_cap(self, lsx_cong_doan_ids) -> dict[int, list[LsxCongDoanVatTu]]:
        """`{lsx_cong_doan_id: [dòng vật tư XƯỞNG CẤP]}` (bỏ tick "Nhà gia công tự lo")."""
        ids = sorted({int(i) for i in lsx_cong_doan_ids if i})
        out: dict[int, list[LsxCongDoanVatTu]] = {}
        if not ids:
            return out
        for vt in self.db.scalars(
                select(LsxCongDoanVatTu).where(LsxCongDoanVatTu.lsx_cong_doan_id.in_(ids),
                                               LsxCongDoanVatTu.ncc_tu_lo.is_(False),
                                               LsxCongDoanVatTu.so_luong > 0)
                .order_by(LsxCongDoanVatTu.thu_tu, LsxCongDoanVatTu.id)):
            out.setdefault(int(vt.lsx_cong_doan_id), []).append(vt)
        return out

    def bai_ghep_buoc_dau(self, bai_ghep_cong_doan_id: int | None) -> bool:
        """Bước chung này là bước ĐẦU của bài ghép (không bước chung nào đứng trước)?"""
        from ..models.bai_ghep_cong_doan import BaiGhepCongDoan

        if not bai_ghep_cong_doan_id:
            return False
        bc = self.db.get(BaiGhepCongDoan, bai_ghep_cong_doan_id)
        if bc is None:
            return False
        return self.db.execute(select(BaiGhepCongDoan.id).where(
            BaiGhepCongDoan.bai_ghep_id == bc.bai_ghep_id,
            BaiGhepCongDoan.thu_tu < bc.thu_tu).limit(1)).first() is None

    # --- Đơn gia công ----------------------------------------------------------------------
    def don(self, don_id: int) -> TgcDon | None:
        return self.db.get(TgcDon, don_id)

    def khoa_don(self, don_id: int) -> TgcDon | None:
        return self.db.execute(
            select(TgcDon).where(TgcDon.id == don_id).with_for_update()).scalar_one_or_none()

    def dong_cua_don(self, don_id: int, *, ca_huy: bool = False) -> list[TgcDonDong]:
        stmt = select(TgcDonDong).where(TgcDonDong.don_id == don_id)
        if not ca_huy:
            stmt = stmt.where(TgcDonDong.huy_luc.is_(None))
        return list(self.db.scalars(stmt.order_by(TgcDonDong.thu_tu, TgcDonDong.id)))

    def dong_cua_nhieu_don(self, don_ids) -> dict[int, list[TgcDonDong]]:
        """`{don_id: [dòng]}` — dòng sống, hoặc mọi dòng nếu đơn đã huỷ (để còn hiện)."""
        ids = sorted({int(i) for i in don_ids if i})
        out: dict[int, list[TgcDonDong]] = {i: [] for i in ids}
        if not ids:
            return out
        for d in self.db.scalars(select(TgcDonDong).where(TgcDonDong.don_id.in_(ids))
                                 .order_by(TgcDonDong.thu_tu, TgcDonDong.id)):
            out[int(d.don_id)].append(d)
        return out

    def dong_don(self, don_dong_id: int) -> TgcDonDong | None:
        return self.db.get(TgcDonDong, don_dong_id)

    def nhieu_viec(self, viec_ids) -> dict[int, TgcViec]:
        ids = sorted({int(i) for i in viec_ids if i})
        if not ids:
            return {}
        return {v.id: v for v in self.db.scalars(select(TgcViec).where(TgcViec.id.in_(ids)))}

    def phieu_giao_cua_don(self, don_id: int) -> list[TgcPhieuGiao]:
        return list(self.db.scalars(select(TgcPhieuGiao).where(TgcPhieuGiao.don_id == don_id)
                                    .order_by(TgcPhieuGiao.giao_luc, TgcPhieuGiao.id)))

    def phieu_nhan_cua_don(self, don_id: int) -> list[TgcPhieuNhan]:
        return list(self.db.scalars(select(TgcPhieuNhan).where(TgcPhieuNhan.don_id == don_id)
                                    .order_by(TgcPhieuNhan.nhan_luc, TgcPhieuNhan.id)))

    def don_trong_ky(self, *, tu_ngay=None, den_ngay=None, moc: str = "dat", q: str | None = None,
                     nha_cung_cap_id: int | None = None) -> list[TgcDon]:
        """Đơn theo kỳ (mốc `dat` = ngày đặt, `tao` = ngày lập, `hen` = hẹn về) + ô tìm (mã đơn,
        nhà gia công, tên việc, mã lệnh) + nhà gia công. Lọc trạng thái (dẫn xuất) ở service."""
        from datetime import datetime, time

        stmt = select(TgcDon)
        if nha_cung_cap_id:
            stmt = stmt.where(TgcDon.nha_cung_cap_id == int(nha_cung_cap_id))
        if moc == "tao":
            if tu_ngay:
                stmt = stmt.where(TgcDon.created_at >= datetime.combine(tu_ngay, time.min))
            if den_ngay:
                stmt = stmt.where(TgcDon.created_at <= datetime.combine(den_ngay, time.max))
        else:
            cot = TgcDon.ngay_hen_ve if moc == "hen" else TgcDon.ngay_dat
            if tu_ngay:
                stmt = stmt.where(cot >= tu_ngay)
            if den_ngay:
                stmt = stmt.where(cot <= den_ngay)
        q = (q or "").strip()
        if q:
            mau = f"%{q}%"
            khop_dong = (select(TgcDonDong.don_id)
                         .join(TgcViec, TgcViec.id == TgcDonDong.viec_id)
                         .outerjoin(Lsx, Lsx.id == TgcViec.lsx_id)
                         .where((TgcViec.ten_viec.ilike(mau)) | (Lsx.ma.ilike(mau))))
            stmt = stmt.where(TgcDon.ma.ilike(mau) | TgcDon.nha_cung_cap_ten.ilike(mau)
                              | TgcDon.id.in_(khop_dong))
        return list(self.db.scalars(stmt.order_by(TgcDon.created_at.desc(), TgcDon.id.desc())))

    def don_gia_lan_truoc(self, nha_cung_cap_id: int, ten_viec: str,
                          bo_don_id: int | None = None) -> float | None:
        """Đơn giá dòng gần nhất cùng nhà gia công + cùng tên việc (đơn chưa huỷ), trừ đơn đang sửa."""
        if not nha_cung_cap_id or not (ten_viec or "").strip():
            return None
        gia = self.db.execute(
            select(TgcDonDong.don_gia)
            .join(TgcDon, TgcDon.id == TgcDonDong.don_id)
            .join(TgcViec, TgcViec.id == TgcDonDong.viec_id)
            .where(TgcDon.nha_cung_cap_id == int(nha_cung_cap_id), TgcDon.huy_luc.is_(None),
                   func.lower(TgcViec.ten_viec) == ten_viec.strip().lower(), TgcDonDong.don_gia > 0,
                   TgcDon.id != int(bo_don_id or 0))
            .order_by(TgcDon.ngay_dat.desc(), TgcDon.id.desc(), TgcDonDong.id.desc())
            .limit(1)).scalar_one_or_none()
        return float(gia) if gia is not None else None

    # --- Phiếu giao --------------------------------------------------------------------------
    def phieu_giao(self, phieu_id: int) -> TgcPhieuGiao | None:
        return self.db.get(TgcPhieuGiao, phieu_id)

    def khoa_phieu_giao(self, phieu_id: int) -> TgcPhieuGiao | None:
        return self.db.execute(select(TgcPhieuGiao).where(TgcPhieuGiao.id == phieu_id)
                               .with_for_update()).scalar_one_or_none()

    def dong_phieu_giao(self, phieu_ids) -> dict[int, list[TgcPhieuGiaoDong]]:
        ids = sorted({int(i) for i in phieu_ids if i})
        out: dict[int, list[TgcPhieuGiaoDong]] = {i: [] for i in ids}
        if not ids:
            return out
        for x in self.db.scalars(select(TgcPhieuGiaoDong).where(TgcPhieuGiaoDong.phieu_id.in_(ids))
                                 .order_by(TgcPhieuGiaoDong.id)):
            out[int(x.phieu_id)].append(x)
        return out

    def de_nghi_cua_phieu_giao(self, phieu_ids) -> dict[int, list[StockRequest]]:
        """`{phieu_giao_id: [đề nghị XUẤT]}` (kể cả đã huỷ — ngăn phiếu hiện đủ vết)."""
        ids = sorted({int(i) for i in phieu_ids if i})
        out: dict[int, list[StockRequest]] = {i: [] for i in ids}
        if not ids:
            return out
        for r in self.db.scalars(select(StockRequest).where(StockRequest.tgc_phieu_giao_id.in_(ids))
                                 .order_by(StockRequest.id)):
            out[int(r.tgc_phieu_giao_id)].append(r)
        return out

    def da_giao_vat_tu(self, lsx_cong_doan_vat_tu_ids) -> dict[int, float]:
        """`{lsx_cong_doan_vat_tu_id: tổng đã giao}` trên phiếu giao CÒN SỐNG. Khoá theo id dòng định
        mức an toàn: việc còn nằm trong đơn sống thì lệnh không sửa routing được (đã phát hành chặn,
        thu hồi gói cũng chặn) nên id dòng vật tư không đổi."""
        ids = sorted({int(i) for i in lsx_cong_doan_vat_tu_ids if i})
        if not ids:
            return {}
        return {int(i): float(s or 0) for i, s in self.db.execute(
            select(TgcPhieuGiaoDong.lsx_cong_doan_vat_tu_id, func.sum(TgcPhieuGiaoDong.so_luong))
            .join(TgcPhieuGiao, TgcPhieuGiao.id == TgcPhieuGiaoDong.phieu_id)
            .where(TgcPhieuGiaoDong.lsx_cong_doan_vat_tu_id.in_(ids), TgcPhieuGiao.huy_luc.is_(None))
            .group_by(TgcPhieuGiaoDong.lsx_cong_doan_vat_tu_id))}

    def vat_tu_buoc(self, vt_id: int) -> LsxCongDoanVatTu | None:
        return self.db.get(LsxCongDoanVatTu, vt_id)

    def ban_giao_theo_id(self, ids) -> dict[int, SanXuatBanGiao]:
        ids = sorted({int(i) for i in ids if i})
        if not ids:
            return {}
        return {b.id: b for b in self.db.scalars(select(SanXuatBanGiao).where(SanXuatBanGiao.id.in_(ids)))}

    def phieu_giao_trong_ky(self, *, tu_ngay=None, den_ngay=None, q: str | None = None,
                            nha_cung_cap_id: int | None = None) -> list[TgcPhieuGiao]:
        from datetime import datetime, time

        stmt = select(TgcPhieuGiao).join(TgcDon, TgcDon.id == TgcPhieuGiao.don_id)
        if nha_cung_cap_id:
            stmt = stmt.where(TgcDon.nha_cung_cap_id == int(nha_cung_cap_id))
        if tu_ngay:
            stmt = stmt.where(TgcPhieuGiao.giao_luc >= datetime.combine(tu_ngay, time.min))
        if den_ngay:
            stmt = stmt.where(TgcPhieuGiao.giao_luc <= datetime.combine(den_ngay, time.max))
        q = (q or "").strip()
        if q:
            mau = f"%{q}%"
            khop = (select(TgcDonDong.don_id).join(TgcViec, TgcViec.id == TgcDonDong.viec_id)
                    .outerjoin(Lsx, Lsx.id == TgcViec.lsx_id)
                    .where(TgcViec.ten_viec.ilike(mau) | Lsx.ma.ilike(mau)))
            stmt = stmt.where(TgcPhieuGiao.ma.ilike(mau) | TgcDon.ma.ilike(mau)
                              | TgcDon.nha_cung_cap_ten.ilike(mau) | TgcDon.id.in_(khop))
        return list(self.db.scalars(stmt.order_by(TgcPhieuGiao.giao_luc.desc(), TgcPhieuGiao.id.desc())))

    def nhieu_don(self, don_ids) -> dict[int, TgcDon]:
        ids = sorted({int(i) for i in don_ids if i})
        if not ids:
            return {}
        return {d.id: d for d in self.db.scalars(select(TgcDon).where(TgcDon.id.in_(ids)))}

    # --- Số liệu dòng đơn ------------------------------------------------------------------
    def giao_dong_song(self, don_dong_ids) -> list[TgcPhieuGiaoDong]:
        ids = sorted({int(i) for i in don_dong_ids if i})
        if not ids:
            return []
        return list(self.db.scalars(
            select(TgcPhieuGiaoDong).join(TgcPhieuGiao, TgcPhieuGiao.id == TgcPhieuGiaoDong.phieu_id)
            .where(TgcPhieuGiaoDong.don_dong_id.in_(ids), TgcPhieuGiao.huy_luc.is_(None))
            .order_by(TgcPhieuGiaoDong.id)))

    def nhan_dong_song(self, don_dong_ids) -> list[TgcPhieuNhanDong]:
        ids = sorted({int(i) for i in don_dong_ids if i})
        if not ids:
            return []
        return list(self.db.scalars(
            select(TgcPhieuNhanDong).join(TgcPhieuNhan, TgcPhieuNhan.id == TgcPhieuNhanDong.phieu_id)
            .where(TgcPhieuNhanDong.don_dong_id.in_(ids), TgcPhieuNhan.huy_luc.is_(None))
            .order_by(TgcPhieuNhanDong.id)))

    def dong_song_cua_nhieu_viec(self, viec_ids) -> dict[int, tuple[TgcDonDong, TgcDon]]:
        """`{viec_id: (dòng đơn sống, đơn)}`."""
        ids = sorted({int(i) for i in viec_ids if i})
        if not ids:
            return {}
        return {int(dd.viec_id): (dd, d) for dd, d in self.db.execute(
            select(TgcDonDong, TgcDon).join(TgcDon, TgcDon.id == TgcDonDong.don_id)
            .where(TgcDonDong.viec_id.in_(ids), TgcDonDong.huy_luc.is_(None)))}

    # --- Routing / bài ghép ----------------------------------------------------------------
    def step_keys_bi_phu(self, lsx_id: int) -> set[str]:
        """`step_key` các bước của lệnh đang bị một bước CHUNG bài ghép phủ."""
        return set(self.db.scalars(
            select(BaiGhepCongDoanMap.lsx_step_key).where(BaiGhepCongDoanMap.lsx_id == lsx_id)))

    def canh_ke_tiep(self, lsx_id: int) -> set[tuple[int, int]]:
        """Cạnh (buoc_truoc_id, buoc_sau_id) của lệnh."""
        return set(self.db.execute(
            select(LsxCongDoanPhuThuoc.buoc_truoc_id, LsxCongDoanPhuThuoc.buoc_sau_id)
            .join(LsxCongDoan, LsxCongDoan.id == LsxCongDoanPhuThuoc.buoc_sau_id)
            .where(LsxCongDoan.lsx_id == lsx_id)).all())

    def cong_viec_cua_lenh(self, lsx_id: int) -> list[SanXuatCongViec]:
        return list(self.db.scalars(
            select(SanXuatCongViec).where(SanXuatCongViec.lsx_id == lsx_id)
            .order_by(SanXuatCongViec.id)))

    def cong_viec_chung_song(self, bai_ghep_id: int) -> list[SanXuatCongViec]:
        """Công việc CHUNG của bài ghép thuộc gói đang phát hành."""
        return list(self.db.scalars(
            select(SanXuatCongViec)
            .join(SanXuatGoiPhatHanh, SanXuatGoiPhatHanh.id == SanXuatCongViec.goi_id)
            .where(SanXuatCongViec.bai_ghep_id == bai_ghep_id,
                   SanXuatCongViec.step_key.is_not(None),
                   SanXuatGoiPhatHanh.trang_thai == GOI_DANG_PHAT_HANH)
            .order_by(SanXuatCongViec.id)))

    def bai_ghep(self, bai_ghep_id: int | None) -> BaiGhep | None:
        return self.db.get(BaiGhep, bai_ghep_id) if bai_ghep_id else None

    def co_buoc_truoc(self, lsx_cong_doan_id: int | None) -> bool:
        """Bước này có bước trước (cạnh đi vào, hoặc bước có `thu_tu` nhỏ hơn cùng lệnh)?"""
        if not lsx_cong_doan_id:
            return False
        cd = self.db.get(LsxCongDoan, lsx_cong_doan_id)
        if cd is None:
            return False
        if self.db.execute(select(LsxCongDoanPhuThuoc.id).where(
                LsxCongDoanPhuThuoc.buoc_sau_id == cd.id).limit(1)).first() is not None:
            return True
        return self.db.execute(select(LsxCongDoan.id).where(
            LsxCongDoan.lsx_id == cd.lsx_id, LsxCongDoan.thu_tu < cd.thu_tu).limit(1)).first() is not None

    def ban_giao_cho_nhan(self, cv_id: int, *, khoa: bool = False) -> list[SanXuatBanGiao]:
        """Bàn giao bước trước đã ĐỀ XUẤT sang công việc đầu của việc, chưa ai nhận."""
        stmt = select(SanXuatBanGiao).where(
            SanXuatBanGiao.dich_cong_viec_id == cv_id, SanXuatBanGiao.trang_thai == BG_DE_XUAT,
        ).order_by(SanXuatBanGiao.id)
        if khoa:
            stmt = stmt.with_for_update()
        return list(self.db.scalars(stmt))

    # --- Thông tin lệnh --------------------------------------------------------------------
    def thong_tin_lenh(self, lsx_ids) -> list[tuple]:
        """`(lsx_id, mã lệnh, mặt hàng, hạn giao, mã đơn, tên khách)` — MỘT câu."""
        ids = sorted({int(i) for i in lsx_ids if i})
        if not ids:
            return []
        return list(self.db.execute(
            select(Lsx.id, Lsx.ma, Lsx.ten, Lsx.han_giao_khach, Order.order_no, Customer.name)
            .outerjoin(Order, Order.id == Lsx.order_id)
            .outerjoin(Customer, Customer.id == Order.customer_id)
            .where(Lsx.id.in_(ids))).all())

    def lenh_cua_bai_ghep(self, bai_ghep_ids) -> dict[int, list[int]]:
        ids = sorted({int(i) for i in bai_ghep_ids if i})
        out: dict[int, list[int]] = {i: [] for i in ids}
        if not ids:
            return out
        for bg, l in self.db.execute(
                select(BaiGhepThanhVien.bai_ghep_id, BaiGhepThanhVien.lsx_id)
                .where(BaiGhepThanhVien.bai_ghep_id.in_(ids)).order_by(BaiGhepThanhVien.lsx_id)):
            out[int(bg)].append(int(l))
        return out

    def ma_cua_lenh(self, lsx_ids) -> dict[int, str]:
        ids = {int(i) for i in lsx_ids if i}
        if not ids:
            return {}
        return {i: ma for i, ma in self.db.execute(select(Lsx.id, Lsx.ma).where(Lsx.id.in_(ids)))}

    def user_names(self, ids) -> dict[int, str]:
        ids = {int(i) for i in ids if i}
        if not ids:
            return {}
        return {uid: ten for uid, ten in self.db.execute(
            select(User.id, User.name).where(User.id.in_(ids)))}

    def nguoi_co(self, module_key: str, action: str) -> list[int]:
        """Tài khoản đang hoạt động có ô `module:action` — người nhận thông báo."""
        cot = getattr(RolePermission, f"can_{action}")
        return sorted({uid for (uid,) in self.db.execute(
            select(User.id).join(RolePermission, RolePermission.role_id == User.role_id)
            .where(RolePermission.module_key == module_key, cot.is_(True),
                   User.is_active.is_(True)))})

    # --- Phiếu nhận --------------------------------------------------------------------------
    def phieu_nhan(self, phieu_id: int) -> TgcPhieuNhan | None:
        return self.db.get(TgcPhieuNhan, phieu_id)

    def khoa_phieu_nhan(self, phieu_id: int) -> TgcPhieuNhan | None:
        return self.db.execute(select(TgcPhieuNhan).where(TgcPhieuNhan.id == phieu_id)
                               .with_for_update()).scalar_one_or_none()

    def dong_phieu_nhan(self, phieu_ids) -> dict[int, list[TgcPhieuNhanDong]]:
        ids = sorted({int(i) for i in phieu_ids if i})
        out: dict[int, list[TgcPhieuNhanDong]] = {i: [] for i in ids}
        if not ids:
            return out
        for x in self.db.scalars(select(TgcPhieuNhanDong).where(TgcPhieuNhanDong.phieu_id.in_(ids))
                                 .order_by(TgcPhieuNhanDong.id)):
            out[int(x.phieu_id)].append(x)
        return out

    def phieu_nhan_trong_ky(self, *, tu_ngay=None, den_ngay=None, q: str | None = None,
                            nha_cung_cap_id: int | None = None) -> list[TgcPhieuNhan]:
        from datetime import datetime, time

        stmt = select(TgcPhieuNhan).join(TgcDon, TgcDon.id == TgcPhieuNhan.don_id)
        if nha_cung_cap_id:
            stmt = stmt.where(TgcDon.nha_cung_cap_id == int(nha_cung_cap_id))
        if tu_ngay:
            stmt = stmt.where(TgcPhieuNhan.nhan_luc >= datetime.combine(tu_ngay, time.min))
        if den_ngay:
            stmt = stmt.where(TgcPhieuNhan.nhan_luc <= datetime.combine(den_ngay, time.max))
        q = (q or "").strip()
        if q:
            mau = f"%{q}%"
            khop = (select(TgcDonDong.don_id).join(TgcViec, TgcViec.id == TgcDonDong.viec_id)
                    .outerjoin(Lsx, Lsx.id == TgcViec.lsx_id)
                    .where(TgcViec.ten_viec.ilike(mau) | Lsx.ma.ilike(mau)))
            stmt = stmt.where(TgcPhieuNhan.ma.ilike(mau) | TgcDon.ma.ilike(mau)
                              | TgcDon.nha_cung_cap_ten.ilike(mau) | TgcDon.id.in_(khop))
        return list(self.db.scalars(stmt.order_by(TgcPhieuNhan.nhan_luc.desc(), TgcPhieuNhan.id.desc())))

    def phieu_nhan_cho_tra(self, *, q: str | None = None,
                           nha_cung_cap_id: int | None = None) -> list[TgcPhieuNhan]:
        """CHỜ TRẢ TIỀN (spec 2026-11-13 §4.6): phiếu nhận còn hiệu lực, chưa có phiếu chi còn hiệu
        lực. Xếp theo nhà gia công rồi phiếu nhận cũ trước — kế toán gom theo nhà."""
        from ..models.accounting import PAYMENT_VOUCHER_CANCELLED, PaymentVoucher

        da_chi = (select(TgcPhieuChiNhan.phieu_nhan_id)
                  .join(PaymentVoucher, PaymentVoucher.id == TgcPhieuChiNhan.payment_voucher_id)
                  .where(PaymentVoucher.status != PAYMENT_VOUCHER_CANCELLED))
        ds = [p for p in self.phieu_nhan_trong_ky(q=q, nha_cung_cap_id=nha_cung_cap_id)
              if p.huy_luc is None]
        if not ds:
            return []
        con = {int(i) for (i,) in self.db.execute(
            select(TgcPhieuNhan.id).where(TgcPhieuNhan.id.in_([p.id for p in ds]),
                                          TgcPhieuNhan.id.not_in(da_chi)))}
        dons = self.nhieu_don({p.don_id for p in ds})
        ds = [p for p in ds if p.id in con]
        ds.sort(key=lambda p: ((dons[p.don_id].nha_cung_cap_ten or "").lower() if p.don_id in dons else "",
                               p.nhan_luc, p.id))
        return ds

    def them_dong_chi(self, voucher, phieu_nhan_id: int, so_tien: int) -> TgcPhieuChiNhan:
        r = TgcPhieuChiNhan(voucher=voucher, phieu_nhan_id=int(phieu_nhan_id), amount_vnd=int(so_tien))
        self.db.add(r)
        return r

    def nguoi_giao_cua_don(self, don_id: int) -> set[int]:
        """Người đã lập phiếu giao CÒN SỐNG của đơn — tách vai giao / nhận (Q2)."""
        return {int(u) for (u,) in self.db.execute(
            select(TgcPhieuGiao.nguoi_giao_id).where(TgcPhieuGiao.don_id == int(don_id),
                                                     TgcPhieuGiao.huy_luc.is_(None))) if u}

    def de_nghi_cua_phieu_nhan(self, phieu_ids) -> dict[int, list[StockRequest]]:
        ids = sorted({int(i) for i in phieu_ids if i})
        out: dict[int, list[StockRequest]] = {i: [] for i in ids}
        if not ids:
            return out
        for r in self.db.scalars(select(StockRequest).where(StockRequest.tgc_phieu_nhan_id.in_(ids))
                                 .order_by(StockRequest.id)):
            out[int(r.tgc_phieu_nhan_id)].append(r)
        return out

    def chuyen_giao_thang_cua_phieu_nhan(self, phieu_id: int) -> list:
        from ..models.delivery import LG_DA_HUY, DeliveryTrip

        return list(self.db.scalars(select(DeliveryTrip).where(
            DeliveryTrip.tgc_phieu_nhan_id == int(phieu_id), DeliveryTrip.trang_thai != LG_DA_HUY)))

    def phieu_chi_song_cua_phieu_nhan(self, phieu_ids) -> dict[int, str]:
        """`{phieu_nhan_id: mã phiếu chi còn hiệu lực}`."""
        from ..models.accounting import PAYMENT_VOUCHER_CANCELLED, PaymentVoucher

        ids = sorted({int(i) for i in phieu_ids if i})
        if not ids:
            return {}
        return {int(pn): code for pn, code in self.db.execute(
            select(TgcPhieuChiNhan.phieu_nhan_id, PaymentVoucher.code)
            .join(PaymentVoucher, PaymentVoucher.id == TgcPhieuChiNhan.payment_voucher_id)
            .where(TgcPhieuChiNhan.phieu_nhan_id.in_(ids),
                   PaymentVoucher.status != PAYMENT_VOUCHER_CANCELLED))}

    def don_vi_ra_buoc_bi_phu(self, bai_ghep_cong_doan_id: int | None) -> dict[int, str | None]:
        """`{lsx_id: đơn vị ra}` của bước LỆNH mà một bước chung phủ — đơn vị phần của từng lệnh."""
        if not bai_ghep_cong_doan_id:
            return {}
        return {lsx_id: dv for lsx_id, dv in self.db.execute(
            select(LsxCongDoan.lsx_id, LsxCongDoan.don_vi_ra)
            .join(BaiGhepCongDoanMap, (BaiGhepCongDoanMap.lsx_step_key == LsxCongDoan.step_key)
                  & (BaiGhepCongDoanMap.lsx_id == LsxCongDoan.lsx_id))
            .where(BaiGhepCongDoanMap.bai_ghep_cong_doan_id == bai_ghep_cong_doan_id))}

    # --- Hoàn tất, hàng đang ở ngoài -----------------------------------------------------------
    def dong_de_nghi(self, req_ids) -> dict[int, list[StockRequestLine]]:
        ids = sorted({int(i) for i in req_ids if i})
        out: dict[int, list[StockRequestLine]] = {i: [] for i in ids}
        if not ids:
            return out
        for ln in self.db.scalars(select(StockRequestLine).where(StockRequestLine.request_id.in_(ids))
                                  .order_by(StockRequestLine.id)):
            out[int(ln.request_id)].append(ln)
        return out

    def de_nghi_tra_cua_dong(self, don_dong_ids) -> dict[int, list[StockRequest]]:
        """Đề nghị NHẬP trả vật tư dư lập lúc Hoàn tất dòng đơn (cả đã huỷ — người gọi tự lọc)."""
        ids = sorted({int(i) for i in don_dong_ids if i})
        out: dict[int, list[StockRequest]] = {i: [] for i in ids}
        if not ids:
            return out
        for r in self.db.scalars(select(StockRequest).where(StockRequest.tgc_don_dong_id.in_(ids))
                                 .order_by(StockRequest.id)):
            out[int(r.tgc_don_dong_id)].append(r)
        return out

    def khoa_dong_don(self, don_dong_id: int) -> TgcDonDong | None:
        return self.db.execute(select(TgcDonDong).where(TgcDonDong.id == don_dong_id)
                               .with_for_update()).scalar_one_or_none()

    def dong_don_dang_mo(self, *, nha_cung_cap_id: int | None = None) -> list[tuple[TgcDonDong, TgcDon]]:
        """Dòng đơn SỐNG của đơn đã đặt, chưa huỷ — nguồn sổ "Hàng đang ở ngoài"."""
        stmt = (select(TgcDonDong, TgcDon).join(TgcDon, TgcDon.id == TgcDonDong.don_id)
                .where(TgcDonDong.huy_luc.is_(None), TgcDon.huy_luc.is_(None), TgcDon.dat_luc.isnot(None)))
        if nha_cung_cap_id:
            stmt = stmt.where(TgcDon.nha_cung_cap_id == int(nha_cung_cap_id))
        return [(d, don) for d, don in self.db.execute(stmt.order_by(TgcDon.nha_cung_cap_ten, TgcDon.id,
                                                                     TgcDonDong.thu_tu, TgcDonDong.id))]

    # --- Nguồn đề nghị kho ------------------------------------------------------------------
    def nguon_yeu_cau_kho(self, reqs) -> dict[int, tuple[str, int | None]]:
        """`{request_id: (tên nhà gia công, lsx_id)}` của đề nghị kho lập theo phiếu giao / phiếu
        nhận / dòng đơn thuê gia công — nhãn "Nguồn" ở màn kho. Ba câu cho cả trang."""
        from ..models.thue_gia_cong import TgcPhieuGiao, TgcPhieuNhan

        theo_pg = {r.id: r.tgc_phieu_giao_id for r in reqs if getattr(r, "tgc_phieu_giao_id", None)}
        theo_pn = {r.id: r.tgc_phieu_nhan_id for r in reqs if getattr(r, "tgc_phieu_nhan_id", None)}
        theo_dd = {r.id: r.tgc_don_dong_id for r in reqs if getattr(r, "tgc_don_dong_id", None)}
        if not (theo_pg or theo_pn or theo_dd):
            return {}
        don_cua: dict[tuple[str, int], int] = {}
        if theo_pg:
            don_cua.update({("pg", int(i)): int(d) for i, d in self.db.execute(
                select(TgcPhieuGiao.id, TgcPhieuGiao.don_id)
                .where(TgcPhieuGiao.id.in_(set(theo_pg.values()))))})
        if theo_pn:
            don_cua.update({("pn", int(i)): int(d) for i, d in self.db.execute(
                select(TgcPhieuNhan.id, TgcPhieuNhan.don_id)
                .where(TgcPhieuNhan.id.in_(set(theo_pn.values()))))})
        if theo_dd:
            don_cua.update({("dd", int(i)): int(d) for i, d in self.db.execute(
                select(TgcDonDong.id, TgcDonDong.don_id)
                .where(TgcDonDong.id.in_(set(theo_dd.values()))))})
        don_ids = set(don_cua.values())
        ten = {int(i): t for i, t in self.db.execute(
            select(TgcDon.id, TgcDon.nha_cung_cap_ten).where(TgcDon.id.in_(don_ids)))}
        lenh: dict[int, int | None] = {}
        for d, l in self.db.execute(
                select(TgcDonDong.don_id, TgcViec.lsx_id)
                .join(TgcViec, TgcViec.id == TgcDonDong.viec_id)
                .where(TgcDonDong.don_id.in_(don_ids)).order_by(TgcDonDong.id)):
            lenh.setdefault(int(d), int(l) if l else None)
        out: dict[int, tuple[str, int | None]] = {}
        for loai, m in (("pg", theo_pg), ("pn", theo_pn), ("dd", theo_dd)):
            for req_id, ref in m.items():
                d = don_cua.get((loai, int(ref)))
                if d is not None:
                    out[req_id] = (ten.get(d) or "", lenh.get(d))
        return out

    def nguon_phieu_nhan(self, phieu_nhan_ids) -> dict[int, tuple[int, str, int | None]]:
        """`{phieu_nhan_id: (nha_cung_cap_id, tên NCC chụp, lsx_id)}` — chuyến giao thẳng hiện nhà
        gia công + lệnh. lsx_id = lệnh của dòng nhận đầu tiên (việc bài ghép không có lệnh riêng)."""
        from ..models.thue_gia_cong import TgcPhieuNhan, TgcPhieuNhanDong

        ids = sorted({int(i) for i in phieu_nhan_ids if i})
        if not ids:
            return {}
        out: dict[int, tuple[int, str, int | None]] = {}
        for pn, ncc, ten, lsx in self.db.execute(
                select(TgcPhieuNhan.id, TgcDon.nha_cung_cap_id, TgcDon.nha_cung_cap_ten, TgcViec.lsx_id)
                .join(TgcDon, TgcDon.id == TgcPhieuNhan.don_id)
                .outerjoin(TgcPhieuNhanDong, TgcPhieuNhanDong.phieu_id == TgcPhieuNhan.id)
                .outerjoin(TgcDonDong, TgcDonDong.id == TgcPhieuNhanDong.don_dong_id)
                .outerjoin(TgcViec, TgcViec.id == TgcDonDong.viec_id)
                .where(TgcPhieuNhan.id.in_(ids)).order_by(TgcPhieuNhan.id, TgcPhieuNhanDong.id)):
            out.setdefault(int(pn), (int(ncc), ten or "", int(lsx) if lsx else None))
        return out

    # --- Giấy / vật tư ---------------------------------------------------------------------
    def giay_cua_lenh(self, lsx_id: int) -> list[LsxCongDoanVatTu]:
        """Dòng GIẤY khai ở các bước của lệnh — nguồn gợi ý giấy cấp cho nhà gia công trọn gói."""
        return list(self.db.scalars(
            select(LsxCongDoanVatTu)
            .join(LsxCongDoan, LsxCongDoan.id == LsxCongDoanVatTu.lsx_cong_doan_id)
            .where(LsxCongDoan.lsx_id == lsx_id, LsxCongDoanVatTu.hang_loai == HANG_GIAY,
                   LsxCongDoanVatTu.so_luong > 0)
            .order_by(LsxCongDoan.thu_tu, LsxCongDoanVatTu.id)))

    def dong_xuat_giay_cua_lenh(self, lsx_ids) -> dict[int, list[StockRequestLine]]:
        """`{lsx_id: [dòng giấy]}` của đề nghị XUẤT còn sống lập theo phiếu giao thuê gia công —
        "đã cấp" của lệnh trọn gói trên bảng cân đối vật tư."""
        ids = [int(i) for i in lsx_ids if i]
        if not ids:
            return {}
        out: dict[int, list[StockRequestLine]] = {}
        for ln in self.db.scalars(
                select(StockRequestLine)
                .join(StockRequest, StockRequest.id == StockRequestLine.request_id)
                .where(StockRequest.tgc_phieu_giao_id.is_not(None), StockRequest.loai == REQ_XUAT,
                       StockRequest.trang_thai.not_in((REQ_CANCELLED, REQ_REJECTED)),
                       StockRequestLine.hang_loai == HANG_GIAY, StockRequestLine.lsx_id.in_(ids))
                .order_by(StockRequestLine.id)):
            out.setdefault(int(ln.lsx_id), []).append(ln)
        return out
