"""Truy vấn bảng `xep_lich_lenh` + nạp routing THEO LÔ cho bàn Xếp lịch.

Mọi đường đọc CẮT theo cửa sổ thời gian hoặc theo tập `lsx_id` — không có đường nào trải toàn bộ
lịch sử. Routing của cả lô nạp bằng MỘT truy vấn `IN (...)`, không N+1: một lần vẽ bảng có thể
duyệt vài chục lệnh, hỏi routing từng lệnh là đúng bài N+1 đã dính một lần ở màn đơn hàng.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from ..models.bai_ghep import BaiGhepThanhVien
from ..models.department import Department
from ..models.don_vi_do import DonViDo
from ..models.lsx import Lsx, LsxCongDoan, LsxCongDoanPhuThuoc
from ..models.may_thiet_bi import MayThietBi
from ..models.san_xuat import (
    GOI_DANG_PHAT_HANH, SanXuatCongViec, SanXuatCongViecLichSu, SanXuatGoiPhatHanh,
)
from ..models.san_xuat_thuc_thi import SanXuatPhienChay
from ..models.order import OrderLine
from ..models.xep_lich_lenh import XepLichLenh


class XepLichLenhRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ---------------------------------------------------------------- mốc

    def theo_lsx(self, lsx_id: int) -> XepLichLenh | None:
        return self.db.execute(
            select(XepLichLenh).where(XepLichLenh.lsx_id == lsx_id)
        ).scalar_one_or_none()

    def theo_nhieu_lsx(self, lsx_ids: list[int]) -> dict[int, XepLichLenh]:
        if not lsx_ids:
            return {}
        rows = self.db.execute(
            select(XepLichLenh).where(XepLichLenh.lsx_id.in_(lsx_ids))
        ).scalars()
        return {r.lsx_id: r for r in rows}

    def them(self, row: XepLichLenh) -> XepLichLenh:
        self.db.add(row)
        self.db.flush()
        return row

    def xoa(self, row: XepLichLenh) -> None:
        self.db.delete(row)
        self.db.flush()

    # ---------------------------------------------------------------- lệnh

    def lsx_theo_ids(self, lsx_ids: list[int]) -> dict[int, Lsx]:
        if not lsx_ids:
            return {}
        rows = self.db.execute(select(Lsx).where(Lsx.id.in_(lsx_ids))).scalars()
        return {r.id: r for r in rows}

    # ---------------------------------------------------------------- routing

    def routing_theo_lo(self, lsx_ids: list[int]) -> dict[int, list[LsxCongDoan]]:
        """MỘT truy vấn cho cả lô. Gom theo `lsx_id`, sắp theo `thu_tu`."""
        if not lsx_ids:
            return {}
        rows = list(self.db.execute(
            select(LsxCongDoan)
            .where(LsxCongDoan.lsx_id.in_(lsx_ids))
            .order_by(LsxCongDoan.lsx_id, LsxCongDoan.thu_tu)
        ).scalars())
        out: dict[int, list[LsxCongDoan]] = {}
        for r in rows:
            out.setdefault(r.lsx_id, []).append(r)
        return out

    def giay_cac_buoc(self, lsx_id: int) -> list[str]:
        """Tên mọi giấy khai ở các bước của lệnh, GIẤY trước SÓNG sau (mg 0426), trong mỗi loại theo
        thứ tự bước rồi thứ tự dòng, không lặp — MỘT truy vấn (xem `LsxRepository.giay_song_cac_buoc`)."""
        from .lsx_repo import LsxRepository

        giays, songs = LsxRepository(self.db).giay_song_cac_buoc(lsx_id)
        return [*giays, *songs]

    def cum_lien_thong(self, lsx_ids) -> list[set[int]]:
        """Chia lệnh thành CỤM liên thông, mỗi cụm một tập — cùng ba quan hệ của
        `san_xuat.component.thanh_phan_lien_thong` (bài ghép · cùng nhóm thành phẩm · phụ thuộc
        chéo), tức đúng đơn vị mà nút Phát hành thả xuống xưởng.

        Khác hàm kia ở hai chỗ: trả TỪNG cụm chứ không gộp một tập, và chỉ hỏi theo tập đang lan
        (hàm kia quét cả bảng cạnh + cả bảng lệnh có nhóm mỗi vòng — chấp nhận được cho một lần
        phát hành, không chấp nhận được cho mỗi lần vẽ bàn). Ba truy vấn mỗi vòng lan, thường một
        hai vòng là hết.
        """
        cha: dict[int, int] = {}

        def goc(x: int) -> int:
            cha.setdefault(x, x)
            while cha[x] != x:
                cha[x] = cha[cha[x]]
                x = cha[x]
            return x

        def noi(ds) -> None:
            ds = [int(i) for i in ds]
            for a in ds[1:]:
                ra, rb = goc(ds[0]), goc(a)
                if ra != rb:
                    cha[rb] = ra

        da_xet: set[int] = set()
        moi = {int(i) for i in lsx_ids if i}
        for i in moi:
            goc(i)
        while moi:
            xet = sorted(moi)
            da_xet |= moi
            # (1) bài ghép
            bg = set(self.db.execute(
                select(BaiGhepThanhVien.bai_ghep_id).where(BaiGhepThanhVien.lsx_id.in_(xet))
            ).scalars())
            if bg:
                theo_bai: dict[int, list[int]] = {}
                for bid, lid in self.db.execute(
                    select(BaiGhepThanhVien.bai_ghep_id, BaiGhepThanhVien.lsx_id)
                    .where(BaiGhepThanhVien.bai_ghep_id.in_(sorted(bg)))
                ).all():
                    theo_bai.setdefault(bid, []).append(lid)
                for ds in theo_bai.values():
                    noi(ds)
            # (2) cùng nhóm thành phẩm — dòng không có `nhom` không kéo ai
            khoa = {(oid, nhom) for oid, nhom in self.db.execute(
                select(Lsx.order_id, OrderLine.nhom)
                .join(OrderLine, Lsx.order_line_id == OrderLine.id)
                .where(Lsx.id.in_(xet), OrderLine.nhom.is_not(None))
            ).all()}
            if khoa:
                theo_nhom: dict[tuple, list[int]] = {}
                for lid, oid, nhom in self.db.execute(
                    select(Lsx.id, Lsx.order_id, OrderLine.nhom)
                    .join(OrderLine, Lsx.order_line_id == OrderLine.id)
                    .where(Lsx.order_id.in_(sorted({k[0] for k in khoa})), OrderLine.nhom.is_not(None))
                ).all():
                    if (oid, nhom) in khoa:
                        theo_nhom.setdefault((oid, nhom), []).append(lid)
                for ds in theo_nhom.values():
                    noi(ds)
            # (3) phụ thuộc chéo
            Truoc = aliased(LsxCongDoan)
            Sau = aliased(LsxCongDoan)
            for a, b in self.db.execute(
                select(Truoc.lsx_id, Sau.lsx_id)
                .select_from(LsxCongDoanPhuThuoc)
                .join(Truoc, LsxCongDoanPhuThuoc.buoc_truoc_id == Truoc.id)
                .join(Sau, LsxCongDoanPhuThuoc.buoc_sau_id == Sau.id)
                .where(or_(Truoc.lsx_id.in_(xet), Sau.lsx_id.in_(xet)), Truoc.lsx_id != Sau.lsx_id)
            ).all():
                noi([a, b])
            moi = set(cha) - da_xet
        cum: dict[int, set[int]] = {}
        for i in cha:
            cum.setdefault(goc(i), set()).add(i)
        return list(cum.values())

    def nhom_theo_lsx(self, lsx_ids) -> dict[int, tuple[int | None, str | None]]:
        """`{lsx_id: (order_id, nhãn nhóm thành phẩm)}` — tên hàng tiêu đề cụm trên bàn."""
        ids = sorted({int(i) for i in lsx_ids if i})
        if not ids:
            return {}
        return {int(lid): (oid, nhom) for lid, oid, nhom in self.db.execute(
            select(Lsx.id, Lsx.order_id, OrderLine.nhom)
            .outerjoin(OrderLine, Lsx.order_line_id == OrderLine.id)
            .where(Lsx.id.in_(ids))
        ).all()}

    def canh_cheo(self, lsx_ids) -> list[tuple[int, int]]:
        """Cạnh phụ thuộc `(bước trước, bước sau)` nối HAI lệnh khác nhau, cả hai đầu trong tập."""
        ids = sorted({int(i) for i in lsx_ids if i})
        if not ids:
            return []
        Truoc = aliased(LsxCongDoan)
        Sau = aliased(LsxCongDoan)
        return [(int(a), int(b)) for a, b in self.db.execute(
            select(LsxCongDoanPhuThuoc.buoc_truoc_id, LsxCongDoanPhuThuoc.buoc_sau_id)
            .join(Truoc, LsxCongDoanPhuThuoc.buoc_truoc_id == Truoc.id)
            .join(Sau, LsxCongDoanPhuThuoc.buoc_sau_id == Sau.id)
            .where(Truoc.lsx_id.in_(ids), Sau.lsx_id.in_(ids), Truoc.lsx_id != Sau.lsx_id)
            .order_by(LsxCongDoanPhuThuoc.buoc_truoc_id, LsxCongDoanPhuThuoc.buoc_sau_id)
        ).all()]

    def phu_thuoc_theo_lo(self, cd_ids: list[int]) -> list[tuple[int, int]]:
        """Cạnh `(bước trước, bước sau)` giữa các bước TRONG tập đã cho. MỘT truy vấn."""
        if not cd_ids:
            return []
        trong = set(cd_ids)
        return [(a, b) for a, b in self.db.execute(
            select(LsxCongDoanPhuThuoc.buoc_truoc_id, LsxCongDoanPhuThuoc.buoc_sau_id)
            .where(LsxCongDoanPhuThuoc.buoc_sau_id.in_(cd_ids))
        ).all() if a in trong]

    # ---------------------------------------------------------------- máy đang giao chạy

    def may_dang_chay(self, lsx_ids: list[int]) -> dict[int, list[tuple[int | None, str | None, int]]]:
        """`{lsx_id: [(lsx_cong_doan_id, step_key, may_id)]}` — máy trên CÔNG VIỆC THỰC THI.

        Sau khi phát hành, máy thật của một bước nằm ở `san_xuat_cong_viec.may_id`: đó là ô mà
        `thuc_thi.doi_may` ghi vào, còn `lsx_cong_doan.may_id` giữ nguyên máy KẾ HOẠCH. Bàn xếp
        lịch phải nói máy nào đang cầm việc, không thì nó vẽ tiến độ trên một máy không chạy.

        Neo công đoạn của công việc là LỎNG (`lsx_cong_doan_id` + `step_key`, không FK — sửa
        routing là replace-all nên id tái sinh) nên trả CẢ HAI khoá, service ghép id trước rồi mới
        lùi về `step_key`. Không lọc `phien_ban_so` — cùng lối với `boi_canh` câu 5; sắp giảm dần
        để dòng của phiên bản mới nhất tới trước, service lấy dòng đầu tiên gặp.

        Bước bị BÀI GHÉP phủ dùng chung một công việc mang `lsx_id IS NULL` nên không lọt vào đây:
        bước đó lùi về máy kế hoạch, đúng như trước. Nối cả đường ghép cần `boi_canh` (năm truy vấn
        nữa) trong khi module bài ghép đang tắt — chưa đáng.
        """
        if not lsx_ids:
            return {}
        rows = self.db.execute(
            select(
                SanXuatCongViec.lsx_id, SanXuatCongViec.lsx_cong_doan_id,
                SanXuatCongViec.step_key, SanXuatCongViec.may_id,
            )
            .where(
                SanXuatCongViec.lsx_id.in_(lsx_ids),
                SanXuatCongViec.may_id.isnot(None),
            )
            .order_by(
                SanXuatCongViec.lsx_id,
                SanXuatCongViec.phien_ban_so.desc(),
                SanXuatCongViec.phan_doan_so,
                SanXuatCongViec.id,
            )
        ).all()
        out: dict[int, list[tuple[int | None, str | None, int]]] = {}
        for lsx_id, cd_id, key, may_id in rows:
            out.setdefault(lsx_id, []).append((cd_id, key, may_id))
        return out

    def may_theo_ids(self, may_ids: list[int]) -> dict[int, MayThietBi]:
        """`{may_id: MayThietBi}` cho cả lô — MỘT truy vấn. Id không còn trong danh mục thì vắng mặt."""
        if not may_ids:
            return {}
        return {m.id: m for m in self.db.execute(
            select(MayThietBi).where(MayThietBi.id.in_(sorted(set(may_ids))))
        ).scalars()}

    def thuc_te_buoc(self, lsx_ids: list[int]) -> dict[int, list[tuple]]:
        """`{lsx_id: [(lsx_cong_doan_id, step_key, trang_thai, kh_bd, kh_kt, xong_luc, thuc_bd)]}`.

        Lớp THỰC TẾ của từng bước, cho panel bày cạnh lớp kế hoạch. Hai truy vấn, cắt theo tập
        `lsx_id` — cùng ranh giới hiệu năng với `may_dang_chay` (spec §4.1).

        LỌC THEO GÓI ĐANG PHÁT HÀNH, không lọc `phien_ban_so`: "Phát hành cập nhật" chỉ tái chụp
        các việc CHƯA bắt đầu, nên việc ĐÃ bắt đầu ở lại `phien_ban_so` cũ. Lọc theo phiên bản
        hiện tại là làm biến mất đúng những bước có thực tế để bày — thứ duy nhất panel này sinh
        ra để nói. Lệnh đã THU HỒI rồi phát hành lại có hai gói; chỉ gói `dang_phat_hanh` lọt.

        `thuc_bd` là mốc phiên chạy ĐẦU TIÊN (`min(bat_dau)`), UTC THẬT — khác thang với `kh_*`
        (giờ tường dán nhãn UTC). Service bọc bằng `gio_xuong` trước khi trả ra, xem
        `services/gio_xuong.py`.

        Bước bị BÀI GHÉP phủ mang `lsx_id IS NULL` nên không lọt vào đây — cùng giới hạn đã ghi ở
        `may_dang_chay`, bước đó chỉ có lớp kế hoạch.
        """
        if not lsx_ids:
            return {}
        goi_dang = (
            select(SanXuatGoiPhatHanh.id)
            .where(SanXuatGoiPhatHanh.trang_thai == GOI_DANG_PHAT_HANH)
            .scalar_subquery()
        )
        rows = self.db.execute(
            select(
                SanXuatCongViec.id, SanXuatCongViec.lsx_id, SanXuatCongViec.lsx_cong_doan_id,
                SanXuatCongViec.step_key, SanXuatCongViec.trang_thai,
                SanXuatCongViec.du_kien_bat_dau, SanXuatCongViec.du_kien_ket_thuc,
                SanXuatCongViec.hoan_thanh_luc,
            )
            .where(
                SanXuatCongViec.lsx_id.in_(lsx_ids),
                SanXuatCongViec.goi_id.in_(goi_dang),
            )
            .order_by(
                SanXuatCongViec.lsx_id,
                SanXuatCongViec.phien_ban_so.desc(),
                SanXuatCongViec.phan_doan_so,
                SanXuatCongViec.id,
            )
        ).all()
        if not rows:
            return {}
        moc = dict(self.db.execute(
            select(SanXuatPhienChay.cong_viec_id, func.min(SanXuatPhienChay.bat_dau))
            .where(SanXuatPhienChay.cong_viec_id.in_([r[0] for r in rows]))
            .group_by(SanXuatPhienChay.cong_viec_id)
        ).all())
        ra: dict[int, list[tuple]] = {}
        for cv_id, lsx_id, cd_id, key, tt, kh_bd, kh_kt, xong in rows:
            ra.setdefault(lsx_id, []).append(
                (cd_id, key, tt, kh_bd, kh_kt, xong, moc.get(cv_id))
            )
        return ra

    def thuc_te_buoc_chung(self, lsx_ids: list[int]) -> dict[int, list[tuple]]:
        """Như `thuc_te_buoc` nhưng cho bước bị BÀI GHÉP phủ: việc chung mang `lsx_id IS NULL`, neo
        `bai_ghep_cong_doan_id`; đi ngược bảng phủ ra `(lsx_id, lsx_step_key)` để popup Xếp lịch bày
        được trạng thái thực tế của lượt chung trên dòng bước của từng lệnh. Tuple cùng hình, `cd_id`
        = None (neo bằng step_key). Ba truy vấn cho cả lô."""
        from ..models.bai_ghep_cong_doan import BaiGhepCongDoanMap

        if not lsx_ids:
            return {}
        phu = self.db.execute(
            select(BaiGhepCongDoanMap.lsx_id, BaiGhepCongDoanMap.lsx_step_key,
                   BaiGhepCongDoanMap.bai_ghep_cong_doan_id)
            .where(BaiGhepCongDoanMap.lsx_id.in_(lsx_ids))
        ).all()
        if not phu:
            return {}
        goi_dang = (
            select(SanXuatGoiPhatHanh.id)
            .where(SanXuatGoiPhatHanh.trang_thai == GOI_DANG_PHAT_HANH)
            .scalar_subquery()
        )
        rows = self.db.execute(
            select(
                SanXuatCongViec.id, SanXuatCongViec.bai_ghep_cong_doan_id,
                SanXuatCongViec.trang_thai,
                SanXuatCongViec.du_kien_bat_dau, SanXuatCongViec.du_kien_ket_thuc,
                SanXuatCongViec.hoan_thanh_luc,
            )
            .where(
                SanXuatCongViec.bai_ghep_cong_doan_id.in_({r[2] for r in phu}),
                SanXuatCongViec.lsx_id.is_(None),
                SanXuatCongViec.goi_id.in_(goi_dang),
            )
            .order_by(SanXuatCongViec.phien_ban_so.desc(), SanXuatCongViec.phan_doan_so,
                      SanXuatCongViec.id)
        ).all()
        if not rows:
            return {}
        moc = dict(self.db.execute(
            select(SanXuatPhienChay.cong_viec_id, func.min(SanXuatPhienChay.bat_dau))
            .where(SanXuatPhienChay.cong_viec_id.in_([r[0] for r in rows]))
            .group_by(SanXuatPhienChay.cong_viec_id)
        ).all())
        theo_bgcd: dict[int, list[tuple]] = {}
        for cv_id, bgcd_id, tt, kh_bd, kh_kt, xong in rows:
            theo_bgcd.setdefault(bgcd_id, []).append((tt, kh_bd, kh_kt, xong, moc.get(cv_id)))
        ra: dict[int, list[tuple]] = {}
        for lsx_id, key, bgcd_id in phu:
            for tt, kh_bd, kh_kt, xong, thuc_bd in theo_bgcd.get(bgcd_id, []):
                ra.setdefault(lsx_id, []).append((None, key, tt, kh_bd, kh_kt, xong, thuc_bd))
        return ra

    def lich_su_lich(self, lsx_id: int) -> tuple[list, list]:
        """`(công việc SỐNG, dòng lịch sử)` của gói đang phát hành cho MỘT lệnh — hai truy vấn.

        Dòng sống mang trạng thái của MỌI phiên bản kể từ `cv.phien_ban_so` trở đi; dòng lịch sử
        mang trạng thái đã bị đè, khoá bằng số phiên bản CŨ. Hai tập này ghép lại mới đủ để dựng
        "bước X ở phiên bản N trông thế nào" — xem `XepLichLenhService.so_sanh_phien_ban`.

        Bước bị BÀI GHÉP phủ (`lsx_id IS NULL`) không lọt vào đây, cùng giới hạn `may_dang_chay`.
        """
        goi_dang = (
            select(SanXuatGoiPhatHanh.id)
            .where(SanXuatGoiPhatHanh.trang_thai == GOI_DANG_PHAT_HANH)
            .scalar_subquery()
        )
        cvs = list(self.db.execute(
            select(SanXuatCongViec)
            .where(
                SanXuatCongViec.lsx_id == lsx_id,
                SanXuatCongViec.goi_id.in_(goi_dang),
            )
            .order_by(SanXuatCongViec.phan_doan_so, SanXuatCongViec.id)
        ).scalars())
        if not cvs:
            return [], []
        ls = list(self.db.execute(
            select(SanXuatCongViecLichSu)
            .where(SanXuatCongViecLichSu.cong_viec_id.in_([c.id for c in cvs]))
            .order_by(SanXuatCongViecLichSu.cong_viec_id,
                      SanXuatCongViecLichSu.phien_ban_so)
        ).scalars())
        return cvs, ls

    def ten_to(self, dept_ids: list[int]) -> dict[int, str]:
        """`{department_id: tên tổ}` cho cả lô — MỘT truy vấn. Id không còn trong danh mục thì vắng mặt."""
        if not dept_ids:
            return {}
        return {i: ten for i, ten in self.db.execute(
            select(Department.id, Department.name).where(Department.id.in_(sorted(set(dept_ids))))
        )}

    # ---------------------------------------------------------------- đơn vị đo

    def ten_don_vi(self, ma: list[str]) -> dict[str, str]:
        """`{mã: tên hiển thị}`. Bảng lưu MÃ (`to`, `con`), người đọc cần chữ (`tờ in`, `con`)."""
        if not ma:
            return {}
        return {
            r.ma: r.ten for r in self.db.execute(
                select(DonViDo).where(DonViDo.ma.in_(ma))
            ).scalars()
        }
