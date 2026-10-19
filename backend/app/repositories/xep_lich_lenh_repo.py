"""Truy vấn bảng `xep_lich_lenh` + nạp routing THEO LÔ cho bàn Xếp lịch.

Mọi đường đọc CẮT theo cửa sổ thời gian hoặc theo tập `lsx_id` — không có đường nào trải toàn bộ
lịch sử. Routing của cả lô nạp bằng MỘT truy vấn `IN (...)`, không N+1: một lần vẽ bảng có thể
duyệt vài chục lệnh, hỏi routing từng lệnh là đúng bài N+1 đã dính một lần ở màn đơn hàng.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, aliased

from ..models.bai_ghep import BaiGhepThanhVien
from ..models.customer import Customer
from ..models.department import Department
from ..models.don_vi_do import DonViDo
from ..models.lsx import Lsx, LsxCongDoan, LsxCongDoanPhuThuoc, LsxCongDoanVatTu
from ..models.may_thiet_bi import MayThietBi
from ..models.san_xuat import (
    GOI_DANG_PHAT_HANH, SanXuatCongViec, SanXuatCongViecLichSu, SanXuatGoiPhatHanh,
)
from ..models.san_xuat_thuc_thi import SanXuatPhienChay
from ..models.order import Order, OrderLine
from ..models.xep_lich_lenh import XepLichLenh
from .loc_danh_sach import dk_khoang_ngay

#: Mốc kỳ của hàng chờ → (cột, là cột Date).
MOC_HANG_CHO = {
    "tao": (Lsx.created_at, False),
    "han_sx": (Lsx.han_hoan_thanh_sx, True),
}


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

    def truoc_moc(self, den: datetime, tu: datetime | None = None) -> list[XepLichLenh]:
        """Lệnh CHẠM cửa sổ: mốc bắt đầu trước mép phải, HOẶC đã có phiên chạy trước mép phải.

        Vế thứ hai không thừa. Từ lúc mốc của lệnh chạy dở đổi nghĩa thành "bắt đầu phần CÒN LẠI",
        người điều độ đẩy mốc ra sau cửa sổ là chuyện thường — nhưng lệnh đã chạy từ trước đó và
        thanh của nó vẫn cắt ngang cửa sổ. Lọc mỗi `bat_dau_at` thì nó biến mất khỏi bàn.

        `san_xuat_phien_chay.bat_dau` là UTC THẬT còn `den` là giờ tường dán nhãn UTC, nên vế này
        LỎNG hơn thực tế đúng một offset máy chủ. Cố ý: lọt thừa vài lệnh thì service cắt lại
        chính xác sau khi trải, còn lọt thiếu là mất dòng.

        `tu` (mép TRÁI, A7 28/09/2026) — bỏ những lệnh `_xong_tron_truoc(tu)`: không có nó, mọi lệnh
        TỪNG được xếp lịch từ ngày đầu dùng phần mềm đều đi qua trải lịch + nạp thực tế ở mỗi lượt
        vẽ bàn, rồi mới bị service vứt vì kết thúc trước cửa sổ. `None` = hành vi cũ.
        """
        da_chay = (
            select(SanXuatCongViec.lsx_id)
            .join(SanXuatPhienChay, SanXuatPhienChay.cong_viec_id == SanXuatCongViec.id)
            .where(SanXuatPhienChay.bat_dau <= den, SanXuatCongViec.lsx_id.is_not(None))
            .scalar_subquery()
        )
        stmt = select(XepLichLenh).where(
            or_(XepLichLenh.bat_dau_at <= den, XepLichLenh.lsx_id.in_(da_chay))
        )
        if tu is not None:
            stmt = stmt.where(~self._xong_tron_truoc(tu))
        return list(self.db.execute(stmt.order_by(XepLichLenh.bat_dau_at)).scalars())

    @staticmethod
    def _xong_tron_truoc(tu: datetime):
        """Vị ngữ (tương quan với `XepLichLenh.lsx_id`): lệnh mà thanh trên bàn CHẮC CHẮN kết thúc
        trước `tu` — nên bỏ ở SQL mà không đổi kết quả của `XepLichLenhService.lich()`.

        CHỈ ĐƯỢC HẸP, không được rộng: vị ngữ này ĐÚNG ⇒ service chắc chắn đã loại lệnh (mép vẽ
        `ket_thuc_thuc_te or kq.ket_thuc < d_tu`). Sai theo chiều ngược lại (bỏ sót vài lệnh đáng
        bỏ) chỉ tốn thêm chút công, còn sai theo chiều này là mất dòng khỏi bàn. Nên chỉ nhận ca mà
        mép vẽ KHÔNG còn phụ thuộc kế hoạch — tức `_du_kien_theo_thuc_te` rơi đúng nhánh "hết bước
        để trải ⇒ mốc xong = mốc thực cuối cùng" (`xong = san`), và `san` < `tu`:

          (1) lệnh CÓ routing (không routing thì `co_thuc_te=False`, mép vẽ = mốc kế hoạch — không
              chặn trên được bằng cột nào);
          (2) MỌI bước routing đều khớp một công việc của GÓI ĐANG PHÁT HÀNH — theo `lsx_cong_doan_id`,
              `step_key`, hoặc qua bảng phủ bài ghép — đúng ba khoá mà `_thuc_te_cua` tra. Bước nào
              không khớp thì nó rơi vào "phần còn lại" và được TRẢI TIẾP từ mốc lệnh ⇒ mép vẽ
              không chặn được;
          (3) MỌI công việc đó (riêng + chung bài ghép) đã `completed` VÀ có `hoan_thanh_luc` —
              bước xong mà thiếu dấu đóng thì `_san` lấy "bây giờ" làm sàn;
          (4) và mọi `hoan_thanh_luc` < `tu` − 1 ngày. `tu` là giờ tường dán nhãn UTC, cột là UTC
              thật: VN lệch +7h nên chỉ cần lùi 7 tiếng; lùi hẳn một ngày để khỏi phụ thuộc offset.

        Cùng bộ lọc gói của `thuc_te_buoc`/`thuc_te_buoc_chung` (`GOI_DANG_PHAT_HANH`) — lệch bộ lọc
        gói ở đây là một bước tra ra thực tế ở service mà SQL tưởng không có (hoặc ngược lại).
        """
        from datetime import timedelta

        from ..models.bai_ghep_cong_doan import BaiGhepCongDoanMap
        from ..models.san_xuat import CV_HOAN_THANH

        mep = tu - timedelta(days=1)
        goi_dang = select(SanXuatGoiPhatHanh.id).where(
            SanXuatGoiPhatHanh.trang_thai == GOI_DANG_PHAT_HANH
        )
        chua_xong_truoc_mep = or_(
            SanXuatCongViec.trang_thai != CV_HOAN_THANH,
            SanXuatCongViec.hoan_thanh_luc.is_(None),
            SanXuatCongViec.hoan_thanh_luc >= mep,
        )
        # (3)+(4) — công việc RIÊNG của lệnh còn dở / đóng muộn.
        rieng_con_do = (
            select(SanXuatCongViec.id)
            .where(
                SanXuatCongViec.lsx_id == XepLichLenh.lsx_id,
                SanXuatCongViec.goi_id.in_(goi_dang),
                chua_xong_truoc_mep,
            )
            .exists()
        )
        # (3)+(4) — công việc CHUNG của bài ghép phủ bước của lệnh còn dở / đóng muộn.
        chung_con_do = (
            select(SanXuatCongViec.id)
            .join(
                BaiGhepCongDoanMap,
                BaiGhepCongDoanMap.bai_ghep_cong_doan_id == SanXuatCongViec.bai_ghep_cong_doan_id,
            )
            .where(
                BaiGhepCongDoanMap.lsx_id == XepLichLenh.lsx_id,
                SanXuatCongViec.lsx_id.is_(None),
                SanXuatCongViec.goi_id.in_(goi_dang),
                chua_xong_truoc_mep,
            )
            .exists()
        )
        # (2) — bước routing có công việc tra được: riêng (id hoặc step_key) hoặc qua bảng phủ.
        buoc = LsxCongDoan.__table__.alias("buoc_xong_tron")
        co_viec_rieng = (
            select(SanXuatCongViec.id)
            .where(
                SanXuatCongViec.lsx_id == XepLichLenh.lsx_id,
                SanXuatCongViec.goi_id.in_(goi_dang),
                or_(
                    SanXuatCongViec.lsx_cong_doan_id == buoc.c.id,
                    SanXuatCongViec.step_key == buoc.c.step_key,
                ),
            )
            .exists()
        )
        co_viec_chung = (
            select(SanXuatCongViec.id)
            .join(
                BaiGhepCongDoanMap,
                BaiGhepCongDoanMap.bai_ghep_cong_doan_id == SanXuatCongViec.bai_ghep_cong_doan_id,
            )
            .where(
                BaiGhepCongDoanMap.lsx_id == XepLichLenh.lsx_id,
                BaiGhepCongDoanMap.lsx_step_key == buoc.c.step_key,
                SanXuatCongViec.lsx_id.is_(None),
                SanXuatCongViec.goi_id.in_(goi_dang),
            )
            .exists()
        )
        buoc_khong_khop = (
            select(buoc.c.id)
            .where(buoc.c.lsx_id == XepLichLenh.lsx_id, ~or_(co_viec_rieng, co_viec_chung))
            .exists()
        )
        co_routing = select(LsxCongDoan.id).where(LsxCongDoan.lsx_id == XepLichLenh.lsx_id).exists()
        return and_(co_routing, ~buoc_khong_khop, ~rieng_con_do, ~chung_con_do)

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

    def _dk_hang_cho(self, *, trang_thai: tuple[str, ...], tim: str | None = None,
                     tu_ngay: date | None = None, den_ngay: date | None = None,
                     moc: str = "tao", khach_id: int | None = None) -> list:
        """Điều kiện của hàng chờ — dùng chung cho danh sách và nguồn ô "Khách hàng"."""
        dieu_kien = [
            Lsx.trang_thai.in_(trang_thai),
            ~select(XepLichLenh.id).where(XepLichLenh.lsx_id == Lsx.id).exists(),
        ]
        if tim:
            mau = f"%{tim.strip()}%"
            dieu_kien.append(or_(Lsx.ma.ilike(mau), Lsx.ten.ilike(mau)))
        cot, la_ngay = MOC_HANG_CHO[moc]
        dieu_kien += dk_khoang_ngay(cot, tu_ngay, den_ngay, cot_ngay=la_ngay)
        if khach_id is not None:
            dieu_kien.append(Lsx.order_id.in_(
                select(Order.id).where(Order.customer_id == khach_id)))
        return dieu_kien

    def khach_hang_cho(self, *, trang_thai: tuple[str, ...], tim: str | None = None,
                       tu_ngay: date | None = None, den_ngay: date | None = None,
                       moc: str = "tao") -> list[tuple[int, str, int]]:
        """Nguồn ô "Khách hàng": khách đang có lệnh trong hàng chờ (đã qua tìm + kỳ), kèm số lệnh."""
        dk = self._dk_hang_cho(trang_thai=trang_thai, tim=tim, tu_ngay=tu_ngay,
                               den_ngay=den_ngay, moc=moc)
        rows = self.db.execute(
            select(Customer.id, Customer.name, func.count(Lsx.id))
            .select_from(Lsx)
            .join(Order, Order.id == Lsx.order_id)
            .join(Customer, Customer.id == Order.customer_id)
            .where(*dk)
            .group_by(Customer.id, Customer.name)
            .order_by(Customer.name)
        ).all()
        return [(int(i), t or f"Khách #{i}", int(n)) for i, t, n in rows]

    def hang_cho(self, *, trang_thai: tuple[str, ...], tim: str | None,
                 trang: int, cd_trang: int, tu_ngay: date | None = None,
                 den_ngay: date | None = None, moc: str = "tao",
                 khach_id: int | None = None) -> tuple[list[Lsx], int]:
        """Lệnh đủ điều kiện xếp mà CHƯA có mốc. Lọc + phân trang Ở MÁY CHỦ, luôn.

        Cắt trang trong JS sau khi kéo cả bảng về là đường đã bị bác một lần — thẻ hàng chờ có thể
        lên vài trăm khi xưởng dồn việc cuối tháng. Kỳ (`tu_ngay`/`den_ngay`/`moc`) + khách thêm
        06/10/2026 cho thanh lọc chung.
        """
        dieu_kien = self._dk_hang_cho(trang_thai=trang_thai, tim=tim, tu_ngay=tu_ngay,
                                      den_ngay=den_ngay, moc=moc, khach_id=khach_id)
        tong = self.db.execute(
            select(func.count()).select_from(Lsx).where(*dieu_kien)
        ).scalar_one()
        rows = list(self.db.execute(
            select(Lsx).where(*dieu_kien)
            # Gấp lên đầu, rồi tới hạn SX sớm nhất — đúng thứ tự người điều độ nhặt việc.
            .order_by(Lsx.is_rush.desc(), Lsx.han_hoan_thanh_sx.asc().nullslast(), Lsx.id)
            .offset(max(0, (trang - 1)) * cd_trang).limit(cd_trang)
        ).scalars())
        return rows, int(tong)

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
        """Tên mọi giấy khai ở các bước của lệnh, theo thứ tự bước rồi thứ tự dòng, không lặp — MỘT
        truy vấn (đọc `vat_tus` từng bước là mỗi bước một câu)."""
        ten: list[str] = []
        for (t,) in self.db.execute(
            select(LsxCongDoanVatTu.vat_tu_ten_snapshot)
            .join(LsxCongDoan, LsxCongDoan.id == LsxCongDoanVatTu.lsx_cong_doan_id)
            .where(LsxCongDoan.lsx_id == lsx_id, LsxCongDoanVatTu.hang_loai == "giay")
            .order_by(LsxCongDoan.thu_tu, LsxCongDoanVatTu.thu_tu, LsxCongDoanVatTu.id)
        ):
            t = (t or "").strip()
            if t and t not in ten:
                ten.append(t)
        return ten

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
