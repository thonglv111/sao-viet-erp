"""Repository Lệnh sản xuất (LSX) — mọi truy vấn DB của module Kế hoạch SX nằm ở đây.

Hàng chờ = đơn đã CHỐT + Sale đã bấm "Chuyển xuống sản xuất" (`orders.san_xuat_released_at`) và
còn dòng chưa lên lệnh. Không có cột trạng thái "đã tiếp nhận" — đơn tự rời hàng chờ khi mọi dòng
đã có LSX.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, aliased, selectinload

from ..db import nho_trong_luot_doc
from ..models.customer import Customer
from ..models.lsx import LOAI_MOI, Lsx, LsxCongDoan, LsxCongDoanPhuThuoc, LsxCongDoanVatTu
from ..models.order import STATUS_ORDERED, Order, OrderLine
from ..models.vat_lieu_kho import LOAI_SONG, GiayNguyen
from .catalog_base import SIZE_TRAN
from .loc_danh_sach import dk_khoang_ngay
from .org_scope import chu_theo_khach

# Mốc ngày của dải kỳ trên bảng lệnh (06/10/2026): (cột, là cột Date). `han_sx` (hạn SX nội bộ đã
# gỡ 08/11/2026) còn nhận cho link cũ và hiểu như hạn giao.
MOC_LENH = {
    "tao": (Lsx.created_at, False),
    "han_giao": (Lsx.han_giao_khach, True),
    "han_sx": (Lsx.han_giao_khach, True),
}
def dk_don_trong_pham_vi(owner_ids: set[int]):
    """Đơn thuộc phạm vi (14/10/2026): CHỦ ĐƠN — sale phụ trách khách, thiếu thì sale ghi trên đơn —
    nằm trong `owner_ids`. Đúng biểu thức của Đơn hàng bán (`services/lenh_sx/pham_vi.chu_don`)."""
    return chu_theo_khach(Order.customer_id, Order.sale_user_id).in_(owner_ids)


def dk_lenh_trong_pham_vi(phu_trach_ids: set[int]):
    """Lệnh thuộc phạm vi (08/11/2026) = NGƯỜI PHỤ TRÁCH lệnh nằm trong `phu_trach_ids` (Của tôi = mình,
    Cả phòng = người trong phòng mình và phòng con). Lệnh cũ chưa ghi người phụ trách thì tính người tạo.
    Trước đó (14/10/2026) tính theo chủ đơn."""
    return func.coalesce(Lsx.nguoi_phu_trach_id, Lsx.created_by).in_(phu_trach_ids)


# Trạng thái của đơn ở hai bảng hàng chờ (08/11/2026): chỉ Chưa giao / Đã giao. Đã tạo bao nhiêu
# lệnh là cột riêng ("Đã tạo x/y lệnh"), không thành trạng thái thứ ba (chủ dự án chốt 08/11/2026).
TRANG_THAI_CHO = ("chua_giao", "da_giao")


def dk_trang_thai_cho(tt: str):
    if tt == "chua_giao":
        return Order.nguoi_lam_lenh_id.is_(None)
    return Order.nguoi_lam_lenh_id.is_not(None)


# Mốc ngày của dải kỳ trên hàng chờ: ngày tạo đơn / lúc Sale chuyển xuống sản xuất.
MOC_HANG_CHO = {
    "tao": (Order.created_at, False),
    "chuyen": (Order.san_xuat_released_at, False),
}


_COT_BUOC_MRP = tuple(getattr(LsxCongDoan, c) for c in (
    "id", "lsx_id", "step_key", "ten", "thu_tu", "nhom", "don_vi_vao", "don_vi_ra", "cong_doan_id", "so_luong_ra",
))


class LsxRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    # --- reads ---------------------------------------------------------------

    def co_vat_tu_buoc(self, lsx_ids: list[int], trang_thais: tuple[str, ...]) -> set[int]:
        """Lệnh (trong `lsx_ids`, đang ở một trong `trang_thais`) có ít nhất một dòng vật tư khai ở
        bước — MỘT câu cho cả trang."""
        if not lsx_ids:
            return set()
        return set(self.db.execute(
            select(LsxCongDoan.lsx_id).distinct()
            .join(LsxCongDoanVatTu, LsxCongDoanVatTu.lsx_cong_doan_id == LsxCongDoan.id)
            .join(Lsx, Lsx.id == LsxCongDoan.lsx_id)
            .where(LsxCongDoan.lsx_id.in_(lsx_ids), Lsx.trang_thai.in_(trang_thais))
        ).scalars())

    def giay_song_cac_buoc(self, lsx_id: int) -> tuple[list[str], list[str]]:
        """`(tên Giấy, tên Sóng)` khai ở các bước của lệnh, theo thứ tự bước rồi thứ tự khai, không
        lặp. Hộp bồi couche lên sóng có hai mã ở bước Cắt tờ — `giay_ten` của quy cách chỉ biết giấy
        chính. Loại tra `giay_nguyen` theo `vat_tu_id` (mg 0426); mã đã xoá cứng coi là Giấy."""
        rows = self.db.execute(
            select(LsxCongDoanVatTu.vat_tu_ten_snapshot, GiayNguyen.loai)
            .join(LsxCongDoan, LsxCongDoan.id == LsxCongDoanVatTu.lsx_cong_doan_id)
            .outerjoin(GiayNguyen, GiayNguyen.id == LsxCongDoanVatTu.vat_tu_id)
            .where(LsxCongDoan.lsx_id == lsx_id, LsxCongDoanVatTu.hang_loai == "giay")
            .order_by(LsxCongDoan.thu_tu, LsxCongDoanVatTu.thu_tu, LsxCongDoanVatTu.id)
        ).all()
        giays: list[str] = []
        songs: list[str] = []
        for ten, loai in rows:
            t = (ten or "").strip()
            ds = songs if loai == LOAI_SONG else giays
            if t and t not in ds:
                ds.append(t)
        return giays, songs

    def vat_tu_cac_buoc(self, lsx_id: int) -> dict[int, list[tuple[str, float, str]]]:
        """`{id bước: [(tên hàng, số lượng, mã đơn vị), …]}` — vật tư KHAI ở từng bước của lệnh, theo
        thứ tự khai. Phiếu công nghệ in dòng "Lấy …" dưới mỗi bước từ đây (04/11/2026). Số lượng là
        định mức đã chép vào lệnh, không qua cân đối kho."""
        rows = self.db.execute(
            select(LsxCongDoanVatTu.lsx_cong_doan_id, LsxCongDoanVatTu.vat_tu_ten_snapshot,
                   LsxCongDoanVatTu.so_luong, LsxCongDoanVatTu.don_vi_snapshot)
            .join(LsxCongDoan, LsxCongDoan.id == LsxCongDoanVatTu.lsx_cong_doan_id)
            .where(LsxCongDoan.lsx_id == lsx_id)
            .order_by(LsxCongDoanVatTu.lsx_cong_doan_id, LsxCongDoanVatTu.thu_tu, LsxCongDoanVatTu.id)
        ).all()
        ra: dict[int, list[tuple[str, float, str]]] = {}
        for buoc_id, ten, sl, dv in rows:
            if (ten or "").strip():
                ra.setdefault(buoc_id, []).append((ten.strip(), float(sl or 0), (dv or "").strip()))
        return ra

    def get(self, lsx_id: int) -> Lsx | None:
        return self.db.execute(
            select(Lsx).where(Lsx.id == lsx_id).options(
                selectinload(Lsx.cong_doans).selectinload(LsxCongDoan.vat_tus),
                selectinload(Lsx.cong_doans).selectinload(LsxCongDoan.phu_thuoc),
            )
        ).scalar_one_or_none()

    def _dieu_kien(
        self,
        *,
        order_id: int | None = None,
        customer_id: int | None = None,
        trang_thai: str | None = None,
        q: str | None = None,
        owner_ids: set[int] | None = None,   # 08/11/2026: tập NGƯỜI PHỤ TRÁCH (`dk_lenh_trong_pham_vi`)
        gia_cong: str | None = None,
        tu_ngay: date | None = None,
        den_ngay: date | None = None,
        moc: str = "tao",
        phu_trach_id: int | None = None,
    ) -> list:
        """Bộ lọc dùng CHUNG cho `list` và `dem_theo_trang_thai`, để số dòng trong bảng và số
        trên tab không bao giờ nói hai chuyện khác nhau (cùng lý do như `catalog_base._loc_q`)."""
        conds = []
        if order_id is not None:
            conds.append(Lsx.order_id == order_id)
        if customer_id is not None:
            # Khách nằm ở ĐƠN, không có trên lệnh — lọc bằng subquery thay vì join, để `list` và
            # `dem_theo_trang_thai` (một cái select Lsx, một cái group_by) dùng chung đúng một
            # điều kiện mà không ai phải tự nhớ thêm join.
            conds.append(
                Lsx.order_id.in_(select(Order.id).where(Order.customer_id == customer_id))
            )
        if trang_thai:
            # Nhận NHIỀU trạng thái ngăn bằng dấu phẩy: tab "Nháp" của màn kế hoạch gửi
            # `nhap,cho_bo_sung` (hai cái nay chung một mặt), gửi một mã lẻ vẫn chạy như cũ.
            ma_tt = [t.strip() for t in trang_thai.split(",") if t.strip()]
            conds.append(Lsx.trang_thai.in_(ma_tt))
        if q:
            like = f"%{q.strip()}%"
            # Gõ "DH017" phải ra lệnh của đơn đó: mã đơn là thứ người điều độ cầm trên tay, còn
            # mã lệnh thì họ đang đi tìm. Subquery vì `order_no` nằm ở bảng đơn.
            conds.append(or_(
                Lsx.ma.ilike(like),
                Lsx.ten.ilike(like),
                Lsx.order_id.in_(select(Order.id).where(Order.order_no.ilike(like))),
            ))
        if owner_ids is not None:
            conds.append(dk_lenh_trong_pham_vi(owner_ids))
        if phu_trach_id is not None:
            # Chip "Của tôi" (08/11/2026): lệnh mình phụ trách — vẫn trong phạm vi ở trên.
            conds.append(Lsx.nguoi_phu_trach_id == phu_trach_id)
        if gia_cong:
            # Ô lọc "Gia công ngoài" (spec gia công ngoài §7) — chờ mang đi / đang ở ngoài / trọn gói.
            from .gia_cong_ngoai_repo import lsx_ids_loc_gia_cong

            conds.append(Lsx.id.in_(lsx_ids_loc_gia_cong(gia_cong)))
        cot, la_ngay = MOC_LENH.get(moc, MOC_LENH["tao"])
        conds += dk_khoang_ngay(cot, tu_ngay, den_ngay, cot_ngay=la_ngay)
        return conds

    def list(self, *, page: int = 1, size: int = 50, **kw) -> tuple[list[Lsx], int]:
        """`(dòng của TRANG này, TỔNG số dòng khớp lọc)` — cùng khuôn `catalog_base.list`.

        LIMIT ở đây là bắt buộc chứ không phải tối ưu cho vui: `selectinload(cong_doans)` nhân
        theo số dòng trả về, nên không cắt trang thì 100.000 lệnh kéo theo ~400.000 dòng bước —
        đo ngày 18/08/2026 thấy endpoint không trả nổi kết quả trong 300 giây.
        """
        conds = self._dieu_kien(**kw)
        base = select(Lsx).options(selectinload(Lsx.cong_doans))
        dem = select(func.count()).select_from(Lsx)
        for c in conds:
            base = base.where(c)
            dem = dem.where(c)
        total = self.db.execute(dem).scalar_one()
        page, size = max(1, page), max(1, min(size, SIZE_TRAN))
        # `id` là chốt phụ: lệnh sinh cùng một lượt có `created_at` bằng nhau, thiếu chốt phụ thì
        # thứ tự đổi giữa hai lượt gọi ⇒ dòng nhảy qua lại giữa các trang.
        base = base.order_by(Lsx.created_at.desc(), Lsx.id.desc())
        return list(self.db.execute(base.offset((page - 1) * size).limit(size)).scalars()), total

    def nguon_bo_loc(self, **kw) -> list[tuple[int, str, int | None]]:
        """`(order_id, order_no, customer_id)` của MỌI đơn đang có lệnh — nguồn cho hai ô lọc.

        Bỏ `order_id`/`customer_id` ra khỏi bộ lọc là cố ý: đang lọc đơn A mà danh sách chỉ còn
        đơn A thì không đổi sang đơn B được nữa. Các lọc còn lại (`q`, `trang_thai`, scope) vẫn
        giữ, để ô chọn không chào những đơn mà bấm vào là bảng trống.
        """
        conds = self._dieu_kien(**{**kw, "order_id": None, "customer_id": None})
        stmt = (
            select(Order.id, Order.order_no, Order.customer_id)
            .where(Order.id.in_(select(Lsx.order_id).where(*conds)))
            .order_by(Order.order_no.desc())
        )
        return [(i, no, cid) for i, no, cid in self.db.execute(stmt).all()]

    def khach_loc(self, *, owner_ids: set[int] | None) -> list[tuple[int, str, int]]:
        """`(id, tên, số lệnh)` của khách đang có lệnh TRONG phạm vi — ô "Khách hàng" của thanh lọc."""
        stmt = (
            select(Customer.id, Customer.name, func.count(Lsx.id))
            .join(Order, Order.customer_id == Customer.id)
            .join(Lsx, Lsx.order_id == Order.id)
            .where(*self._dieu_kien(owner_ids=owner_ids))
            .group_by(Customer.id, Customer.name)
            .order_by(Customer.name)
        )
        return [(int(i), t, int(n)) for i, t, n in self.db.execute(stmt).all()]

    def don_loc(self, *, owner_ids: set[int] | None) -> list[tuple[int, str, int]]:
        """`(id, mã đơn, số lệnh)` của đơn đang có lệnh TRONG phạm vi — ô "Đơn hàng", mới nhất trước."""
        stmt = (
            select(Order.id, Order.order_no, func.count(Lsx.id))
            .join(Lsx, Lsx.order_id == Order.id)
            .where(*self._dieu_kien(owner_ids=owner_ids))
            .group_by(Order.id, Order.order_no)
            .order_by(Order.order_no.desc())
        )
        return [(int(i), t, int(n)) for i, t, n in self.db.execute(stmt).all()]

    def dem_theo_trang_thai(self, **kw) -> dict[str, int]:
        """Số lệnh của TỪNG trạng thái, cùng bộ lọc nhưng BỎ `trang_thai`.

        Bỏ chính bộ lọc trạng thái là cố ý: tab đang không được chọn vẫn phải khoe số của nó
        (đúng ghi chú `facets` ở `routers/catalog_base`). Khoá `all` = tổng mọi trạng thái.
        """
        conds = self._dieu_kien(**{**kw, "trang_thai": None})
        stmt = select(Lsx.trang_thai, func.count()).group_by(Lsx.trang_thai)
        for c in conds:
            stmt = stmt.where(c)
        out = {tt: n for tt, n in self.db.execute(stmt).all()}
        out["all"] = sum(out.values())
        return out

    def cho_mrp(self, *, trang_thai: tuple[str, ...], include_ids: set[int]) -> list[Lsx]:
        """Mọi lệnh mà kế hoạch vật tư phải tính — KHÔNG cắt trang, và đó là cố ý.

        MRP cân giấy cho cả kho: cắt trang ở đây là âm thầm tính THIẾU vật tư, nên hàm này đứng
        riêng thay vì mượn `list()` (trần `SIZE_TRAN` của `list` sẽ chặt mất phần đuôi mà không
        ai hay). Cái đẩy được xuống SQL thì vẫn đẩy: lọc trạng thái chạy ở DB chứ không kéo cả
        bảng về rồi vứt bằng Python.
        """
        dk = Lsx.trang_thai.in_(trang_thai)
        if include_ids:
            # Lệnh được gọi đích danh (đang mở trên màn) phải có mặt dù trạng thái nào.
            dk = or_(dk, Lsx.id.in_(include_ids))
        return list(
            self.db.execute(
                select(Lsx)
                .options(selectinload(Lsx.cong_doans).load_only(*_COT_BUOC_MRP))
                .where(dk)
                .order_by(Lsx.created_at.desc(), Lsx.id.desc())
            ).scalars()
        )

    def theo_ids(self, ids: set[int]) -> list[Lsx]:
        """Đúng những lệnh được gọi tên — KHÔNG kèm bộ lọc trạng thái.

        `cho_mrp` luôn OR thêm `trang_thai IN TRANG_THAI_TINH` (đúng cho MRP toàn xưởng) nên nó
        KHÔNG dùng được cho đường "nhu cầu của MỘT công việc": mỗi lần mở form đề nghị cấp vật tư
        sẽ kéo về mọi lệnh còn sống. Đây là đường hẹp cho đúng ca đó.
        """
        ids = {int(i) for i in (ids or set()) if i}
        if not ids:
            return []
        # Chi tiết một việc hỏi lại cùng lệnh ở nhiều nhánh (vật tư cấp, giấy nhận từ): nhớ trong lượt GET.
        return list(nho_trong_luot_doc(self.db, ("lsx_theo_ids", frozenset(ids)), lambda: tuple(
            self.db.execute(
                select(Lsx)
                .options(selectinload(Lsx.cong_doans))
                .where(Lsx.id.in_(ids))
                .order_by(Lsx.created_at.desc(), Lsx.id.desc())
            ).scalars()
        )))

    def by_order_lines(self, order_line_ids: list[int]) -> dict[int, Lsx]:
        """order_line_id → LSX 'sản xuất mới' đã tạo (nguồn của guard chống sinh trùng)."""
        if not order_line_ids:
            return {}
        rows = self.db.execute(
            select(Lsx).where(
                Lsx.order_line_id.in_(order_line_ids), Lsx.loai == LOAI_MOI
            )
        ).scalars()
        return {r.order_line_id: r for r in rows}

    def _dk_hang_cho(self, owner_ids: set[int] | None = None, *, che_do: str = "giao",
                     phu_trach_ids: set[int] | None = None) -> tuple:
        """Điều kiện NỀN của hai bảng hàng chờ (chưa kể thanh lọc) — dùng chung cho bảng và ô lọc.

        `che_do="giao"` = tab Hàng chờ tiếp nhận của người giao: mọi đơn còn nợ lệnh, `owner_ids` là
        phạm vi theo chủ đơn (None = mọi đơn). `che_do="tao"` = tab Tạo lệnh (08/11/2026): chỉ đơn ĐÃ
        GIAO, người phụ trách nằm trong `phu_trach_ids` (None = mọi người phụ trách)."""
        # Viết bằng MỘT TẬP ID (union) chứ không phải `or_(EXISTS…, NOT EXISTS…)` ngay trong WHERE:
        # dạng OR làm Postgres ước lượng chi phí ~1.000.000, vượt `jit_above_cost` nên nó bật JIT
        # và đốt 470 ms biên dịch cho một câu chỉ chạy 80 ms (đo 18/08/2026 trên 20.000 đơn).
        # Cùng một tập id dùng cho CẢ đếm lẫn lấy trang — hai câu không thể nói hai chuyện khác nhau.
        don_khac = aliased(Order)
        con_no = (
            select(OrderLine.order_id)
            .where(
                ~select(Lsx.id)
                .where(Lsx.order_line_id == OrderLine.id, Lsx.loai == LOAI_MOI)
                .exists()
            )
            .union(
                # Đơn KHÔNG có dòng nào vẫn nằm lại hàng chờ — đúng hành vi của bộ lọc Python cũ
                # (`if so_dong and so_co >= so_dong`). Bỏ vế này là âm thầm giấu mất loại đơn ấy.
                select(don_khac.id).where(
                    ~select(OrderLine.id).where(OrderLine.order_id == don_khac.id).exists()
                )
            )
            .subquery()
        )
        dk = (
            Order.status == STATUS_ORDERED,
            Order.san_xuat_released_at.is_not(None),
            Order.id.in_(select(con_no.c.order_id)),
        )
        if che_do == "tao":
            dk = (*dk, Order.nguoi_lam_lenh_id.is_not(None))
            return dk if phu_trach_ids is None else (*dk, Order.nguoi_lam_lenh_id.in_(phu_trach_ids))
        return dk if owner_ids is None else (*dk, dk_don_trong_pham_vi(owner_ids))

    def khach_hang_cho(self, **nen) -> list[tuple[int, str, int]]:
        """`(id, tên, số đơn)` của khách đang có đơn nằm hàng chờ — ô "Khách hàng" của hàng chờ."""
        stmt = (
            select(Customer.id, Customer.name, func.count(Order.id))
            .join(Order, Order.customer_id == Customer.id)
            .where(*self._dk_hang_cho(**nen))
            .group_by(Customer.id, Customer.name)
            .order_by(Customer.name)
        )
        return [(int(i), t, int(n)) for i, t, n in self.db.execute(stmt).all()]

    def phu_trach_hang_cho(self, **nen) -> list[tuple[int, str, int]]:
        """`(id, tên, số đơn)` của người phụ trách đang có đơn trong hàng chờ — ô "Người phụ trách"."""
        from ..models.user import User

        ten = func.coalesce(User.name, User.username)
        stmt = (
            select(User.id, ten, func.count(Order.id))
            .join(Order, Order.nguoi_lam_lenh_id == User.id)
            .where(*self._dk_hang_cho(**nen))
            .group_by(User.id, User.name, User.username)
            .order_by(ten)
        )
        return [(int(i), t, int(n)) for i, t, n in self.db.execute(stmt).all()]

    def _dk_loc_hang_cho(
        self, *, customer_id: int | None = None, tu_ngay: date | None = None,
        den_ngay: date | None = None, moc: str = "tao", nguoi_phu_trach_id: int | None = None,
        **nen,
    ) -> list:
        """Điều kiện nền + thanh lọc (khách, người phụ trách, kỳ) — CHƯA kể chip trạng thái. Chung
        cho bảng và số trên chip."""
        conds = list(self._dk_hang_cho(**nen))
        if customer_id is not None:
            conds.append(Order.customer_id == customer_id)
        if nguoi_phu_trach_id is not None:
            conds.append(Order.nguoi_lam_lenh_id == nguoi_phu_trach_id)
        cot, la_ngay = MOC_HANG_CHO.get(moc, MOC_HANG_CHO["tao"])
        conds += dk_khoang_ngay(cot, tu_ngay, den_ngay, cot_ngay=la_ngay)
        return conds

    def dem_trang_thai_hang_cho(self, **loc) -> dict[str, int]:
        """Số trên chip Tất cả / Chưa giao / Đã giao — MỘT câu, cùng thanh lọc với bảng."""
        conds = self._dk_loc_hang_cho(**loc)
        hang = self.db.execute(
            select(func.count(), *[
                func.coalesce(func.sum(case((dk_trang_thai_cho(tt), 1), else_=0)), 0)
                for tt in TRANG_THAI_CHO
            ]).select_from(Order).where(*conds)
        ).one()
        return {"tat_ca": int(hang[0]), **{tt: int(n) for tt, n in zip(TRANG_THAI_CHO, hang[1:])}}

    def co_cham_hang_cho(self, *, nguoi_xem_id: int, che_do: str,
                         owner_ids: set[int] | None = None) -> bool:
        """Chấm của tab — KHÔNG theo thanh lọc. Hàng chờ tiếp nhận: còn đơn Chưa giao trong phạm vi.
        Tạo lệnh: có đơn giao cho chính người xem mà họ chưa mở."""
        if che_do == "giao":
            conds = [*self._dk_hang_cho(owner_ids), Order.nguoi_lam_lenh_id.is_(None)]
        else:
            conds = [*self._dk_hang_cho(che_do="tao", phu_trach_ids={nguoi_xem_id}),
                     Order.nguoi_lam_lenh_mo_at.is_(None)]
        return self.db.execute(select(Order.id).where(*conds).limit(1)).first() is not None

    def orders_ban_giao(
        self, *, page: int = 1, size: int = 50, chi_dem: bool = False,
        trang_thai: str | None = None, **loc,
    ) -> tuple[list[Order], int]:
        """Đơn đã chốt + đã chuyển xuống SX mà CÒN nợ lệnh (kèm dòng đơn), mới nhất trước.

        Điều kiện "còn dòng chưa lên lệnh" nằm trong SQL chứ không lọc bằng Python sau khi kéo
        toàn bộ lịch sử đơn hàng về kèm mọi dòng đơn — cách cũ làm endpoint không trả nổi kết
        quả ở quy mô thật. `trang_thai` = chip Chưa giao / Đã giao.
        """
        conds = self._dk_loc_hang_cho(**loc)
        if trang_thai in TRANG_THAI_CHO:
            conds.append(dk_trang_thai_cho(trang_thai))
        total = self.db.execute(select(func.count()).select_from(Order).where(*conds)).scalar_one()
        if chi_dem:
            # Badge chỉ cần TỔNG — khỏi nạp trang đơn + dòng đơn.
            return [], total
        page, size = max(1, page), max(1, min(size, SIZE_TRAN))
        # `lines` chỉ nạp cho các đơn CỦA TRANG (≤ size đơn), đủ để đếm dòng-đã-lên-lệnh mà không
        # kéo theo cả bảng dòng đơn.
        rows = self.db.execute(
            select(Order)
            .where(*conds)
            .options(selectinload(Order.lines))
            .order_by(Order.san_xuat_released_at.desc(), Order.id.desc())
            .offset((page - 1) * size)
            .limit(size)
        ).scalars()
        return list(rows), total

    def count_by_order(self, order_ids: list[int]) -> dict[int, int]:
        """order_id → số LSX đã tạo (để biết đơn còn nợ lệnh hay không)."""
        if not order_ids:
            return {}
        rows = self.db.execute(
            select(Lsx.order_id, func.count())
            .where(Lsx.order_id.in_(order_ids))
            .group_by(Lsx.order_id)
        ).all()
        return {oid: n for oid, n in rows}

    def order_with_lines(self, order_id: int) -> Order | None:
        return self.db.execute(
            select(Order).where(Order.id == order_id).options(selectinload(Order.lines))
        ).scalar_one_or_none()

    def orders_hang_cho_theo_id(self, order_ids: list[int], *,
                                owner_ids: set[int] | None) -> list[Order]:
        """Các đơn trong `order_ids` CÒN nằm hàng chờ và trong phạm vi — đầu vào của Giao đơn."""
        if not order_ids:
            return []
        return list(self.db.execute(
            select(Order).where(*self._dk_hang_cho(owner_ids), Order.id.in_(set(order_ids)))
            .order_by(Order.id)
        ).scalars())

    def nguoi_lam_lenh_chon_duoc(self, *, phong_ids: list[int], ban_than_id: int) -> list[tuple]:
        """`(id, tên, tên phòng)` của người đang hoạt động có Thao tác ở Lệnh sản xuất, thuộc
        `phong_ids` — cộng chính người giao (nếu họ có Thao tác) dù không có phòng."""
        from ..models.department import Department
        from ..models.role import RolePermission
        from ..models.user import User

        stmt = (
            select(User.id, User.name, User.username, Department.name)
            .join(RolePermission, (RolePermission.role_id == User.role_id)
                  & (RolePermission.module_key == "san_xuat"))
            .outerjoin(Department, Department.id == User.department_id)
            .where(User.is_active.is_(True), RolePermission.can_create.is_(True),
                   or_(User.department_id.in_(phong_ids or [-1]), User.id == ban_than_id))
            .order_by(User.name, User.id)
        )
        return [(int(i), (n or u), p) for i, n, u, p in self.db.execute(stmt).all()]

    def order_lines(self, order_id: int) -> list[OrderLine]:
        return list(
            self.db.execute(
                select(OrderLine).where(OrderLine.order_id == order_id).order_by(OrderLine.id)
            ).scalars()
        )

    # --- writes --------------------------------------------------------------

    def add(self, lsx: Lsx) -> Lsx:
        self.db.add(lsx)
        self.db.flush()
        return lsx

    def delete(self, lsx: Lsx) -> None:
        self.db.delete(lsx)
        self.db.flush()

    def sync_cong_doans(self, lsx: Lsx, rows: list[LsxCongDoan]) -> None:
        """Đồng bộ tại chỗ để giữ PK bước cho dòng lịch và cạnh phụ thuộc."""
        keep = {r.id for r in rows if r.id is not None}
        for old in list(lsx.cong_doans):
            if old.id not in keep:
                lsx.cong_doans.remove(old)
        for i, row in enumerate(rows):
            row.thu_tu = i
            if row not in lsx.cong_doans:
                lsx.cong_doans.append(row)
        self.db.flush()

    def buoc_da_bat_dau(self, step_ids: set[int]) -> set[int]:
        """Bước lệnh có công việc ĐÃ BẮT ĐẦU ở bàn tổ (đang chạy / tạm dừng / xong)."""
        from ..models.san_xuat import CV_DANG_CHAY, CV_HOAN_THANH, CV_TAM_DUNG, SanXuatCongViec

        if not step_ids:
            return set()
        return {int(i) for i in self.db.execute(
            select(SanXuatCongViec.lsx_cong_doan_id).where(
                SanXuatCongViec.lsx_cong_doan_id.in_(step_ids),
                SanXuatCongViec.trang_thai.in_((CV_DANG_CHAY, CV_TAM_DUNG, CV_HOAN_THANH)),
            )).scalars()}

    def phu_thuoc_toi_buoc(self, step_ids: set[int]) -> list[LsxCongDoanPhuThuoc]:
        if not step_ids:
            return []
        return list(self.db.execute(
            select(LsxCongDoanPhuThuoc).where(LsxCongDoanPhuThuoc.buoc_truoc_id.in_(step_ids))
        ).scalars())

    def commit(self) -> None:
        self.db.commit()
