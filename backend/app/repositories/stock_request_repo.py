"""Repository — Yêu cầu kho (spec-kho-de-nghi §3–§5).

Chỉ truy vấn/ghi DB. Luật nghiệp vụ (ai được duyệt, chặn ứng vượt duyệt, chuyển trạng
thái) nằm ở `services/stock_request_service.py`.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import and_, exists, false, func, literal, not_, or_, select, union, update
from sqlalchemy.orm import Session, selectinload

from ..models.stock_request import (
    REQ_CANCELLED,
    REQ_DONE,
    REQ_DRAFT,
    REQ_NHAP,
    REQ_PREPARING,
    REQ_REJECTED,
    REQ_XUAT,
    StockRequest,
    StockRequestLine,
)
from ..models.stock_voucher import VOUCHER_POSTED, StockVoucher, StockVoucherLine
from ..services.kho_giay import chuan_kho, co_don_vi_goc
from .loc_danh_sach import dk_khoang_ngay


def khoa_vat_tu(vat_tu) -> list[tuple[str, int]]:
    """`["giay:12", "vat_tu:5"]` → `[("giay", 12), ("vat_tu", 5)]`; phần tử hỏng thì bỏ."""
    ra: list[tuple[str, int]] = []
    for k in vat_tu or []:
        loai, _, hid = str(k).partition(":")
        if loai and hid.isdigit():
            ra.append((loai, int(hid)))
    return ra


def _dk_to(to_id: int):
    """Điều kiện "Tổ / bộ phận": yêu cầu đứng tên phòng đó, HOẶC thuộc một công việc của tổ đó
    (lần đề nghị cấp vật tư, hay trả hàng thừa) — người bấm có thể ở phòng khác (spec 2026-10-18 §7)."""
    from ..models.san_xuat import SanXuatCongViec
    from ..models.san_xuat_vat_tu import SanXuatVatTuDeNghi

    return or_(
        StockRequest.bo_phan_id == to_id,
        exists(select(literal(1)).select_from(SanXuatVatTuDeNghi).join(
            SanXuatCongViec, SanXuatCongViec.id == SanXuatVatTuDeNghi.cong_viec_id,
        ).where(SanXuatVatTuDeNghi.stock_request_id == StockRequest.id,
                SanXuatCongViec.department_id == to_id)),
        exists(select(literal(1)).select_from(SanXuatCongViec).where(
            SanXuatCongViec.id == StockRequest.vat_tu_tra_cong_viec_id,
            SanXuatCongViec.department_id == to_id)),
    )


def _dk_lenh(lsx_id: int):
    """Điều kiện "Lệnh": có dòng gắn lệnh đó, HOẶC gắn bài ghép chứa lệnh đó."""
    from ..models.bai_ghep import BaiGhepThanhVien

    return exists(select(literal(1)).select_from(StockRequestLine).where(
        StockRequestLine.request_id == StockRequest.id,
        or_(StockRequestLine.lsx_id == lsx_id,
            StockRequestLine.bai_ghep_id.in_(
                select(BaiGhepThanhVien.bai_ghep_id).where(BaiGhepThanhVien.lsx_id == lsx_id))),
    ))


def _dk_vat_tu(cap: list[tuple[str, int]]):
    """Điều kiện "Vật tư": có dòng là một trong các mã hàng đã chọn."""
    return exists(select(literal(1)).select_from(StockRequestLine).where(
        StockRequestLine.request_id == StockRequest.id,
        or_(*[and_(StockRequestLine.hang_loai == l, StockRequestLine.hang_id == i) for l, i in cap]),
    ))

# Mốc gốc so "chưa xem" khi người tạo chưa từng mở yêu cầu (quyet_dinh_xem_luc NULL).
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

_HEADER_FIELDS = ("bo_phan_id", "kho_id", "ngay_can", "can_luc", "uu_tien", "ghi_chu", "loai_kho",
                  "purchase_delivery_id",
                  # NGUỒN GIAO HÀNG (mg 0201): chuyến giao sinh ra yêu cầu XUẤT này. Thiếu tên ở
                  # danh sách này thì giá trị bị NUỐT IM LẶNG — yêu cầu vẫn tạo, chỉ là không nối
                  # về đâu cả. Đúng cái bẫy đã cắn 19/08/2026.
                  "delivery_trip_id",
                  # ĐIỀU CHUYỂN KHO (mig 0203) — set từ service khi ấn điều chuyển.
                  "dieu_chuyen", "kho_nguon_id", "xuat_voucher_id",
                  # NGUỒN KCS (mg 0309): công đoạn KCS cuối gửi thành phẩm vào kho.
                  "san_xuat_cong_viec_id",
                  # NGUỒN GIA CÔNG NGOÀI (Task 8): lần chốt về kho đẻ ra đề nghị này.
                  "gia_cong_ngoai_id",
                  # NHẬP LẠI VẬT TƯ THỪA (mg 0361): công việc của tổ trả vật tư dư về kho.
                  "vat_tu_tra_cong_viec_id")


def _build_line(ln: dict, loai: str) -> StockRequestLine:
    """Dựng 1 dòng đề nghị từ dict payload. Đơn giá chỉ áp cho đề nghị NHẬP (người đề nghị biết
    giá NCC); XUẤT → null (giá vốn lấy đích danh từ lô).

    Không còn `ten_tu_do`/`don_vi_phu`/`he_so_quy_doi` (mg 0171): mặt hàng bắt buộc chọn từ danh
    mục gốc, còn quy đổi lấy từ đồ thị đơn vị dùng chung.
    """
    # GIẤY mang khổ + ĐƠN VỊ GỐC, VẬT TƯ mang ĐƠN VỊ GỐC (service đã suy từ ĐVT dòng ở
    # `_validate_lines` — không ai gõ); khổ chỉ giấy, hàng khác luôn "" · 0 · 0 dù người gọi gửi gì.
    giay = ln["hang_loai"] == "giay"
    kr, kd = chuan_kho(ln.get("kho_rong"), ln.get("kho_dai")) if giay else (0, 0)
    return StockRequestLine(
        don_vi_goc=((ln.get("don_vi_goc") or "").strip().lower()) if co_don_vi_goc(ln["hang_loai"]) else "",
        kho_rong=kr,
        kho_dai=kd,
        hang_loai=ln["hang_loai"],
        hang_id=ln["hang_id"],
        lsx_id=ln.get("lsx_id"),
        bai_ghep_id=ln.get("bai_ghep_id"),
        dvt=ln["dvt"],
        sl_de_nghi=ln["sl_de_nghi"],
        don_gia=ln.get("don_gia") if loai == "NHAP" else None,
        don_gia_ban=ln.get("don_gia_ban") if loai == "NHAP" else None,
        ghi_chu=ln.get("ghi_chu"),
        lo_goc_id=ln.get("lo_goc_id") if loai == "NHAP" else None,
    )


def _dieu_kien_pham_vi(nguoi_tao_id: int | None, bo_phan_ids: list[int] | None):
    """Phạm vi xem của người dùng (router `_scoped_filters`): yêu cầu CHÍNH MÌNH tạo luôn lọt, cộng
    thêm yêu cầu có bộ phận nằm trong `bo_phan_ids` (phạm vi `department`). Cả hai None = không lọc.

    Cần vế "của mình" vì bộ phận không phải lúc nào cũng là phòng HIỆN TẠI của người tạo: bộ phận chốt
    lúc tạo (phòng người bấm, 11/10/2026), người đổi phòng sau đó vẫn phải thấy yêu cầu của chính mình."""
    if nguoi_tao_id is None and bo_phan_ids is None:
        return None
    ve = []
    if nguoi_tao_id is not None:
        ve.append(StockRequest.nguoi_tao_id == nguoi_tao_id)
    if bo_phan_ids:
        ve.append(StockRequest.bo_phan_id.in_(bo_phan_ids))
    return or_(*ve) if ve else false()



#: Mốc ngày của kỳ trên danh sách yêu cầu kho → (cột, là cột Date).
_COT_MOC = {
    "tao": (StockRequest.created_at, False),
    "can": (StockRequest.ngay_can, True),
    "duyet": (StockRequest.duyet_luc, False),
}

#: Giá trị điều kiện "Nguồn" (12/10/2026) — cùng thứ tự ưu tiên ô Nguồn ở danh sách (`NguonA`):
#: đơn mua → điều chuyển → giao hàng → KCS → gia công ngoài → lệnh SX → không nguồn (lập tay).
NGUON_YEU_CAU = ("mua_hang", "dieu_chuyen", "giao_hang", "kcs", "gia_cong", "san_xuat", "khong")


def _dk_nguon(nguon: str):
    """Một giá trị "Nguồn" → điều kiện SQL. Các giá trị LOẠI TRỪ nhau theo thứ tự `NGUON_YEU_CAU`
    nên tổng số theo nguồn đúng bằng số yêu cầu, và mỗi yêu cầu khớp đúng nhãn ô Nguồn đang hiện."""
    rieng = [
        StockRequest.purchase_delivery_id.is_not(None),
        StockRequest.dieu_chuyen.is_(True),
        StockRequest.delivery_trip_id.is_not(None),
        and_(StockRequest.loai == REQ_NHAP, StockRequest.san_xuat_cong_viec_id.is_not(None)),
        StockRequest.gia_cong_ngoai_id.is_not(None),
    ]
    co_lenh = StockRequest.id.in_(select(StockRequestLine.request_id).where(or_(
        StockRequestLine.lsx_id.is_not(None), StockRequestLine.bai_ghep_id.is_not(None))))
    i = NGUON_YEU_CAU.index(nguon)
    if i < len(rieng):
        return and_(rieng[i], *[not_(c) for c in rieng[:i]])
    khong_rieng = [not_(c) for c in rieng]
    return and_(*khong_rieng, co_lenh if nguon == "san_xuat" else not_(co_lenh))


class StockRequestRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, request_id: int) -> StockRequest | None:
        return self.db.get(StockRequest, request_id)

    def lock_for_update(self, request_id: int) -> None:
        """Khoá DÒNG header yêu cầu (SELECT … FOR UPDATE) để chặn hai lượt đồng bộ/hủy chạy song
        song (tổ bấm hai lần, hoặc tổ sửa đúng lúc kho lập phiếu). Postgres: lượt sau CHỜ rồi đọc
        lại trạng thái mới. SQLite: FOR UPDATE là no-op nhưng SQLite tự khoá ghi cả DB nên vẫn
        tuần tự. Phải gọi TRƯỚC khi đọc trạng thái yêu cầu."""
        self.db.execute(
            select(StockRequest.id).where(StockRequest.id == request_id).with_for_update()
        ).first()

    def co_voucher(self, request_id: int | None) -> bool:
        """Yêu cầu đã có BẤT KỲ phiếu nào chưa — kể cả nháp, kể cả đã huỷ. Dùng để chặn sửa/hủy
        từ tầng sản xuất (`StockRequestService.dong_bo_tu_san_xuat`/`huy_tu_san_xuat`) khi kho đã
        bắt tay soạn phiếu — số đã đi vào đầu người soạn, sửa sau lưng họ là nguồn đẻ chênh lệch.

        `request_id` có thể `None` (đề nghị SX chưa từng đẻ yêu cầu kho) — trả `False` NGAY thay vì
        chạy truy vấn `request_id IS NULL` (dù `StockVoucher.request_id` NOT NULL nên vẫn ra đúng
        kết quả, chặn tường minh ở đây đỡ phải dựa vào ràng buộc DB để suy luận đúng)."""
        if not request_id:
            return False
        return self.db.scalar(
            select(func.count()).select_from(StockVoucher)
            .where(StockVoucher.request_id == request_id)
        ) > 0

    def lenh_ton_tai(self, lsx_id: int | None, bai_ghep_id: int | None) -> tuple[bool, bool]:
        """`(lệnh có thật, bài ghép có thật)` cho ô "cho lệnh nào" (mg 0175).

        Truy vấn nằm ở ĐÂY chứ không ở service: service từng mượn `self.requests.db` để tự
        `db.get(...)` — thò tay qua repo lấy session là phá đúng ranh giới mà lớp repo dựng ra.
        Id để trống ⇒ `True` (không gắn lệnh là hợp lệ: xin lặt vặt).
        """
        from ..models.bai_ghep import BaiGhep
        from ..models.lsx import Lsx

        co_lsx = lsx_id in (None, "") or self.db.get(Lsx, int(lsx_id)) is not None
        co_bg = bai_ghep_id in (None, "") or self.db.get(BaiGhep, int(bai_ghep_id)) is not None
        return co_lsx, co_bg

    def tim_theo_purchase_delivery(self, delivery_id: int, *, khoa: bool = False):
        """Yêu cầu nhập kho CÒN SỐNG của một ĐỢT GIAO mua hàng (bỏ qua đã huỷ / từ chối) — một đợt
        chỉ nhập kho một lần. `khoa=True`: khoá dòng đợt giao (`FOR UPDATE`, Postgres) trước khi hỏi
        để hai cú gửi song song không cùng lọt; SQLite bỏ qua mệnh đề này."""
        if khoa:
            from ..models.purchase import PurchaseDelivery

            self.db.execute(select(PurchaseDelivery.id)
                            .where(PurchaseDelivery.id == delivery_id).with_for_update())
        stmt = select(StockRequest).where(
            StockRequest.purchase_delivery_id == delivery_id,
            StockRequest.trang_thai.notin_([REQ_CANCELLED, REQ_REJECTED]),
        )
        return self.db.execute(stmt.order_by(StockRequest.id.desc())).scalars().first()

    def tim_theo_delivery_trip(self, trip_id: int, *, loai: str | None = None):
        """Yêu cầu kho CÒN SỐNG của một chuyến giao (bỏ qua đã huỷ / từ chối).

        Giao hàng đọc ngược qua đây: chuyến đã gửi yêu cầu chưa, mã bao nhiêu. Cùng khuôn
        `purchase_delivery_id` mà Mua hàng dùng để chặn nhập kho trùng một đợt.

        ⚠️ PHẢI truyền `loai`. Một chuyến nay có tới HAI yêu cầu treo cùng `delivery_trip_id`:
        `XUAT` lúc lấy hàng đi giao, và `NHAP` lúc trả hàng về (chuyến hỏng / giao thiếu). Không
        lọc thì hàm trả bản mới nhất — tức sau khi trả hàng, mọi chỗ hỏi "yêu cầu xuất của chuyến"
        đều nhận nhầm phiếu nhập.
        """
        stmt = select(StockRequest).where(
            StockRequest.delivery_trip_id == trip_id,
            StockRequest.trang_thai.notin_([REQ_CANCELLED, REQ_REJECTED]),
        )
        if loai is not None:
            stmt = stmt.where(StockRequest.loai == loai)
        return self.db.execute(stmt.order_by(StockRequest.id.desc())).scalars().first()

    def don_giao_cua_yeu_cau(self, request_id: int | None) -> dict | None:
        """Yêu cầu XUẤT do Giao hàng gửi → `{order_id, order_ma, customer_id, khach_hang}` của đơn đang
        giao (chuyến → yêu cầu giao → đơn → khách). Yêu cầu không sinh từ chuyến giao ⇒ None."""
        if not request_id:
            return None
        from ..models.customer import Customer
        from ..models.delivery import DeliveryRequest, DeliveryTrip
        from ..models.order import Order

        r = self.db.execute(
            select(Order.id, Order.order_no, Order.customer_id, Customer.name)
            .select_from(StockRequest)
            .join(DeliveryTrip, DeliveryTrip.id == StockRequest.delivery_trip_id)
            .join(DeliveryRequest, DeliveryRequest.id == DeliveryTrip.request_id)
            .join(Order, Order.id == DeliveryRequest.order_id)
            .outerjoin(Customer, Customer.id == Order.customer_id)
            .where(StockRequest.id == request_id)
        ).first()
        if r is None:
            return None
        return {"order_id": r[0], "order_ma": r[1], "customer_id": r[2], "khach_hang": r[3]}

    def get_by_ma(self, ma: str) -> StockRequest | None:
        return self.db.execute(
            select(StockRequest).where(func.upper(StockRequest.ma) == ma.strip().upper())
        ).scalars().first()

    def by_xuat_voucher_id(self, voucher_id: int) -> StockRequest | None:
        """Yêu cầu ĐIỀU CHUYỂN đích (dieu_chuyen NHẬP) có `xuat_voucher_id` = phiếu này — để từ PHIẾU
        XUẤT NGUỒN của điều chuyển truy NGƯỢC về mặt tiền phiếu điều chuyển. None nếu không có."""
        return self.db.execute(
            select(StockRequest).where(StockRequest.xuat_voucher_id == voucher_id)
        ).scalars().first()

    def get_with_lines(self, request_id: int) -> StockRequest | None:
        return self.db.execute(
            select(StockRequest)
            .options(selectinload(StockRequest.lines))
            .where(StockRequest.id == request_id)
        ).scalars().first()

    def get_line(self, line_id: int) -> StockRequestLine | None:
        return self.db.get(StockRequestLine, line_id)

    def count_by_loai(self, trang_thai: list[str], *, nguoi_tao_id: int | None = None,
                      bo_phan_id: int | None = None, pham_vi_nguoi_tao_id: int | None = None,
                      pham_vi_bo_phan_ids: list[int] | None = None) -> dict[str, int]:
        """Đếm yêu cầu chờ xử lý theo CHIỀU cho badge: `nhap` · `xuat` · `dieu_chuyen`.
        `nhap`/`xuat` KHÔNG tính điều chuyển (đã tách sang bucket riêng); vế XUẤT nguồn nội bộ luôn
        bị ẩn. LỌC THEO SCOPE (nguoi_tao_id/bo_phan_id) GIỐNG `list` để badge khớp đúng list.

        ĐIỀU CHUYỂN: phiếu nhập đích TỰ DỰNG SẴN lúc ấn điều chuyển → yêu cầu nhảy 'preparing' NGAY
        (không dừng ở 'approved' chờ lập phiếu như nhập/xuất thường). Nên bucket điều chuyển đếm CẢ
        'preparing' (= chờ kho đích ghi sổ) — nếu chỉ đếm 'approved' thì badge điều chuyển tắt ngay
        sau khi ấn, mất tín hiệu "còn phiếu chờ ghi sổ" (spec §10)."""
        dc_trang_thai = list(dict.fromkeys([*trang_thai, REQ_PREPARING]))
        thuong = and_(StockRequest.dieu_chuyen.is_(False),
                      StockRequest.trang_thai.in_(trang_thai))
        # Vế XUẤT nguồn (dieu_chuyen + loai XUAT) luôn ẩn khỏi badge — chỉ đếm vế NHẬP đích.
        dc_cond = and_(StockRequest.dieu_chuyen.is_(True), StockRequest.loai == REQ_NHAP,
                       StockRequest.trang_thai.in_(dc_trang_thai))
        conds = [or_(thuong, dc_cond)]
        if nguoi_tao_id is not None:
            conds.append(StockRequest.nguoi_tao_id == nguoi_tao_id)
        if bo_phan_id is not None:
            conds.append(StockRequest.bo_phan_id == bo_phan_id)
        pv = _dieu_kien_pham_vi(pham_vi_nguoi_tao_id, pham_vi_bo_phan_ids)
        if pv is not None:
            conds.append(pv)
        rows = self.db.execute(
            select(StockRequest.loai, StockRequest.dieu_chuyen, func.count())
            .where(*conds)
            .group_by(StockRequest.loai, StockRequest.dieu_chuyen)
        ).all()
        out = {"nhap": 0, "xuat": 0, "dieu_chuyen": 0}
        for loai, dc_flag, n in rows:
            if dc_flag:
                out["dieu_chuyen"] += int(n)   # điều chuyển (yêu cầu NHẬP đích) — bucket riêng
            elif loai == REQ_NHAP:
                out["nhap"] += int(n)
            else:
                out["xuat"] += int(n)
        return out

    # --- Badge "kho đã PHẢN HỒI yêu cầu của tôi" (hoàn tất / không thành) — seen theo TỪNG yêu cầu ---
    # "Phản hồi" = trạng thái CUỐI, KHÔNG tính yêu cầu vừa tạo (luồng bỏ duyệt → tạo là 'approved'
    # ngay, đó là hành động của chính người tạo nên không báo). Mốc so = `updated_at` (lúc kho chốt
    # kết quả) > lần người tạo MỞ XEM yêu cầu đó (`quyet_dinh_xem_luc`).
    _TERM_DONE = (REQ_DONE,)
    _TERM_FAIL = (REQ_REJECTED, REQ_CANCELLED)

    def unseen_response_counts(self, nguoi_tao_id: int) -> dict[str, int]:
        """Số phản hồi kho CHƯA XEM của `nguoi_tao_id`, tách theo bộ lọc: done=Hoàn tất, fail=Không thành."""
        from ..models.san_xuat_vat_tu import SanXuatVatTuDeNghi

        fresh = StockRequest.updated_at > func.coalesce(StockRequest.quyet_dinh_xem_luc, _EPOCH)
        # Yêu cầu TỰ LẬP lúc phát hành đứng tên người bấm phát hành, nhưng người đợi là tổ của bước
        # (chuông vào kênh tổ) — không đếm vào badge của người phát hành.
        tu_lap = exists(select(literal(1)).select_from(SanXuatVatTuDeNghi).where(
            SanXuatVatTuDeNghi.stock_request_id == StockRequest.id,
            SanXuatVatTuDeNghi.tu_lap.is_(True)))

        def cnt(statuses: tuple[str, ...]) -> int:
            stmt = select(func.count()).select_from(StockRequest).where(
                StockRequest.nguoi_tao_id == nguoi_tao_id,
                StockRequest.trang_thai.in_(statuses),
                # ẨN yêu cầu XUẤT nguồn nội bộ của điều chuyển (bút toán ẩn, KHÔNG mở xem được ở màn
                # nào) — nếu đếm thì badge "đã phản hồi" của người ấn điều chuyển kẹt +1 vĩnh viễn.
                # Cùng luật ẩn với `_base_conds`.
                or_(StockRequest.dieu_chuyen.is_(False), StockRequest.loai != REQ_XUAT),
                ~tu_lap,
                fresh,
            )
            return int(self.db.execute(stmt).scalar() or 0)

        return {"done": cnt(self._TERM_DONE), "fail": cnt(self._TERM_FAIL)}

    def mark_seen_one(self, request_id: int, nguoi_tao_id: int) -> None:
        """Người tạo MỞ XEM 1 yêu cầu CỦA MÌNH → đánh dấu đã xem (chỉ yêu cầu do chính họ tạo).

        GIỮ NGUYÊN `updated_at` (set = chính nó) để `onupdate=_utcnow` KHÔNG kích — nếu để nó nhảy
        thì `updated_at` (mốc phản hồi để so) bị đẩy lên ~now, badge sẽ không bao giờ tắt."""
        self.db.execute(
            update(StockRequest)
            .where(
                StockRequest.id == request_id,
                StockRequest.nguoi_tao_id == nguoi_tao_id,
            )
            .values(
                quyet_dinh_xem_luc=datetime.now(timezone.utc),
                updated_at=StockRequest.updated_at,
            )
        )
        self.db.commit()

    def mark_seen_all(self, nguoi_tao_id: int) -> None:
        """Người tạo MỞ màn "Yêu cầu nhập xuất" → mọi phản hồi kho của họ coi như đã xem (07/10/2026:
        thấy bản ghi trên danh sách là đủ, khỏi bấm mở từng cái). Giữ `updated_at` như `mark_seen_one`."""
        self.db.execute(
            update(StockRequest)
            .where(
                StockRequest.nguoi_tao_id == nguoi_tao_id,
                StockRequest.trang_thai.in_(self._TERM_DONE + self._TERM_FAIL),
                StockRequest.updated_at > func.coalesce(StockRequest.quyet_dinh_xem_luc, _EPOCH),
            )
            .values(
                quyet_dinh_xem_luc=datetime.now(timezone.utc),
                updated_at=StockRequest.updated_at,
            )
        )
        self.db.commit()

    def by_ids_with_lines(self, ids) -> dict[int, StockRequest]:
        """Nạp NHIỀU yêu cầu kèm dòng trong 1 (+lines) query — tránh N+1 khi serialize danh sách phiếu."""
        ids = [i for i in set(ids) if i is not None]
        if not ids:
            return {}
        rows = self.db.execute(
            select(StockRequest)
            .options(selectinload(StockRequest.lines))
            .where(StockRequest.id.in_(ids))
        ).scalars()
        return {r.id: r for r in rows}

    def _base_conds(self, *, loai=None, trang_thai=None, q=None, nguoi_tao_id=None,
                    bo_phan_id=None, kho_id=None, dieu_chuyen=None,
                    tu_ngay=None, den_ngay=None, moc="tao", nguoi_tao_ids=None, kho_loc=None,
                    nguon=None, pham_vi_nguoi_tao_id=None, pham_vi_bo_phan_ids=None,
                    to_loc=None, lenh_loc=None, vat_tu_loc=None):
        """Điều kiện lọc CHUNG cho `list` và `count_by_status` — để badge tab khớp đúng list.

        `to_loc` / `lenh_loc` / `vat_tu_loc` (18/10/2026): ba điều kiện "Tổ / bộ phận", "Lệnh",
        "Vật tư" của màn kho — viết bằng EXISTS nên không nhân dòng, AND với nhau và với phần còn
        lại. `bo_phan_id` giữ nghĩa cũ (đúng cột) cho chỗ gọi nội bộ như gợi ý số lượng.

        Kỳ (06/10/2026): `tu_ngay/den_ngay` theo mốc `moc` — `tao` Ngày yêu cầu (created_at, ranh
        ngày giờ VN), `can` Ngày cần (Date), `duyet` Ngày duyệt. `nguoi_tao_ids` = điều kiện
        "Người yêu cầu"; `kho_loc` = điều kiện "Kho": yêu cầu gắn kho đó (kho đích hoặc kho nguồn
        điều chuyển) HOẶC đã có phiếu lập ở kho đó — yêu cầu thường không gắn kho, kho quyết ở
        bước lập phiếu."""
        # ẨN vế XUẤT nguồn của điều chuyển (bút toán nội bộ): nó tự ghi sổ khi kho đích nhập, người
        # dùng không thao tác trực tiếp → không hiện. Yêu cầu NHẬP đích (kho_nguon_id ≠ null) VẪN hiện.
        conds = [or_(StockRequest.dieu_chuyen.is_(False), StockRequest.loai != REQ_XUAT)]
        if dieu_chuyen is not None:
            conds.append(StockRequest.dieu_chuyen.is_(dieu_chuyen))
        if loai:
            conds.append(StockRequest.loai == loai)
        if trang_thai:
            conds.append(StockRequest.trang_thai.in_(trang_thai))
        if nguoi_tao_id is not None:
            conds.append(StockRequest.nguoi_tao_id == nguoi_tao_id)
        if bo_phan_id is not None:
            conds.append(StockRequest.bo_phan_id == bo_phan_id)
        pv = _dieu_kien_pham_vi(pham_vi_nguoi_tao_id, pham_vi_bo_phan_ids)
        if pv is not None:
            conds.append(pv)
        if kho_id is not None:
            conds.append(StockRequest.kho_id == kho_id)
        if to_loc is not None:
            conds.append(_dk_to(to_loc))
        if lenh_loc is not None:
            conds.append(_dk_lenh(lenh_loc))
        cap_vt = khoa_vat_tu(vat_tu_loc)
        if cap_vt:
            conds.append(_dk_vat_tu(cap_vt))
        if nguoi_tao_ids:
            conds.append(StockRequest.nguoi_tao_id.in_(nguoi_tao_ids))
        if kho_loc is not None:
            conds.append(or_(
                StockRequest.kho_id == kho_loc,
                StockRequest.kho_nguon_id == kho_loc,
                StockRequest.id.in_(
                    select(StockVoucher.request_id).where(StockVoucher.kho_id == kho_loc)),
            ))
        nguon = [n for n in (nguon or []) if n in NGUON_YEU_CAU]
        if nguon:
            conds.append(or_(*[_dk_nguon(n) for n in nguon]))
        cot, la_ngay = _COT_MOC.get(moc, _COT_MOC["tao"])
        conds += dk_khoang_ngay(cot, tu_ngay, den_ngay, cot_ngay=la_ngay)
        if q:
            like = f"%{q.strip().lower()}%"
            conds.append(or_(
                func.lower(StockRequest.ma).like(like),
                func.lower(func.coalesce(StockRequest.ghi_chu, "")).like(like),
            ))
        return conds

    def list(self, *, loai: str | None = None, trang_thai: list[str] | None = None,
             q: str | None = None, nguoi_tao_id: int | None = None,
             bo_phan_id: int | None = None, kho_id: int | None = None,
             dieu_chuyen: bool | None = None,
             tu_ngay=None, den_ngay=None, moc: str = "tao", nguoi_tao_ids=None, kho_loc=None,
             nguon=None,
             pham_vi_nguoi_tao_id: int | None = None, pham_vi_bo_phan_ids: list[int] | None = None,
             to_loc: int | None = None, lenh_loc: int | None = None, vat_tu_loc=None,
             order: str = "id", page: int = 1, size: int = 50):
        """Danh sách yêu cầu (BE-paging). `nguoi_tao_id` / `bo_phan_id` áp SCOPE: người yêu cầu
        (scope `own`) chỉ thấy yêu cầu của chính mình — đó là lý do họ không nhìn thấy kho.
        `dieu_chuyen`: True = CHỈ yêu cầu điều chuyển · False = nhập/xuất thường · None = không lọc.
        `order`: 'id' = mới TẠO trước (mặc định) · 'updated' = vừa ĐỔI (duyệt/cấp/hủy) trước (Hộp yêu cầu)."""
        conds = self._base_conds(
            loai=loai, trang_thai=trang_thai, q=q, nguoi_tao_id=nguoi_tao_id,
            bo_phan_id=bo_phan_id, kho_id=kho_id, dieu_chuyen=dieu_chuyen,
            tu_ngay=tu_ngay, den_ngay=den_ngay, moc=moc, nguoi_tao_ids=nguoi_tao_ids,
            kho_loc=kho_loc, nguon=nguon, pham_vi_nguoi_tao_id=pham_vi_nguoi_tao_id,
            pham_vi_bo_phan_ids=pham_vi_bo_phan_ids, to_loc=to_loc, lenh_loc=lenh_loc,
            vat_tu_loc=vat_tu_loc,
        )
        base = select(StockRequest).options(selectinload(StockRequest.lines))
        count_stmt = select(func.count()).select_from(StockRequest)
        for c in conds:
            base = base.where(c)
            count_stmt = count_stmt.where(c)
        total = self.db.execute(count_stmt).scalar_one()
        page, size = max(1, page), max(1, min(size, 200))
        order_cols = (
            [StockRequest.updated_at.desc(), StockRequest.id.desc()]
            if order == "updated" else [StockRequest.id.desc()]
        )
        base = base.order_by(*order_cols).offset((page - 1) * size).limit(size)
        return list(self.db.execute(base).scalars()), total

    def count_by_status(self, *, loai=None, q=None, nguoi_tao_id=None, bo_phan_id=None,
                        kho_id=None, dieu_chuyen=None, base_trang_thai=None,
                        tu_ngay=None, den_ngay=None, moc="tao", nguoi_tao_ids=None,
                        kho_loc=None, nguon=None, pham_vi_nguoi_tao_id=None,
                        pham_vi_bo_phan_ids=None, to_loc=None, lenh_loc=None,
                        vat_tu_loc=None) -> dict[str, int]:
        """Đếm yêu cầu theo TỪNG TRẠNG THÁI (cùng bộ lọc như `list`, TRỪ tab) → FE cộng theo tab
        cho badge. `base_trang_thai`: giới hạn tập nền (vd Hộp yêu cầu chỉ tính trạng thái INBOX)."""
        conds = self._base_conds(
            loai=loai, trang_thai=base_trang_thai, q=q, nguoi_tao_id=nguoi_tao_id,
            bo_phan_id=bo_phan_id, kho_id=kho_id, dieu_chuyen=dieu_chuyen,
            tu_ngay=tu_ngay, den_ngay=den_ngay, moc=moc, nguoi_tao_ids=nguoi_tao_ids,
            kho_loc=kho_loc, nguon=nguon, pham_vi_nguoi_tao_id=pham_vi_nguoi_tao_id,
            pham_vi_bo_phan_ids=pham_vi_bo_phan_ids, to_loc=to_loc, lenh_loc=lenh_loc,
            vat_tu_loc=vat_tu_loc,
        )
        rows = self.db.execute(
            select(StockRequest.trang_thai, func.count()).where(*conds)
            .group_by(StockRequest.trang_thai)
        ).all()
        return {str(s): int(n) for s, n in rows}

    def dem_theo_cot(self, truong: str, **loc) -> list[tuple[int, int]]:
        """[(giá trị, số yêu cầu)] của cột `truong` (`bo_phan_id` / `nguoi_tao_id`) trong tầm
        nhìn `loc` — giá trị cho điều kiện lọc "Phòng ban yêu cầu" / "Người yêu cầu"."""
        cot = {"bo_phan_id": StockRequest.bo_phan_id, "nguoi_tao_id": StockRequest.nguoi_tao_id}[truong]
        return [(int(v), int(n)) for v, n in self.db.execute(
            select(cot, func.count()).where(*self._base_conds(**loc), cot.is_not(None)).group_by(cot)
        ).all()]

    def _dem_theo_cap(self, cap, **loc) -> list[tuple[object, int]]:
        """`cap` = select (rid, gia_tri) — đếm yêu cầu PHÂN BIỆT theo giá trị trong tầm `loc`.
        Một lượt truy vấn cho cả danh sách giá trị lọc, không hỏi từng giá trị."""
        sq = cap.subquery()
        ids = select(StockRequest.id).where(*self._base_conds(**loc))
        rows = self.db.execute(
            select(sq.c.gia_tri, func.count(func.distinct(sq.c.rid)))
            .where(sq.c.rid.in_(ids), sq.c.gia_tri.is_not(None)).group_by(sq.c.gia_tri)
        ).all()
        return [(v, int(n)) for v, n in rows]

    def dem_theo_to(self, **loc) -> list[tuple[int, int]]:
        """Giá trị điều kiện "Tổ / bộ phận": phòng đứng tên yêu cầu cộng tổ của công việc gắn
        yêu cầu — cùng luật `_dk_to`, nên số kèm theo khớp đúng danh sách khi chọn."""
        from ..models.san_xuat import SanXuatCongViec
        from ..models.san_xuat_vat_tu import SanXuatVatTuDeNghi

        cap = union(
            select(StockRequest.id.label("rid"), StockRequest.bo_phan_id.label("gia_tri")),
            select(SanXuatVatTuDeNghi.stock_request_id, SanXuatCongViec.department_id).join(
                SanXuatCongViec, SanXuatCongViec.id == SanXuatVatTuDeNghi.cong_viec_id),
            select(StockRequest.id, SanXuatCongViec.department_id).join(
                SanXuatCongViec, SanXuatCongViec.id == StockRequest.vat_tu_tra_cong_viec_id),
        )
        return [(int(v), n) for v, n in self._dem_theo_cap(cap, **loc)]

    def dem_theo_lenh(self, **loc) -> list[tuple[int, int]]:
        """Giá trị điều kiện "Lệnh": lệnh trên dòng, cộng mọi lệnh của bài ghép trên dòng."""
        from ..models.bai_ghep import BaiGhepThanhVien

        cap = union(
            select(StockRequestLine.request_id.label("rid"), StockRequestLine.lsx_id.label("gia_tri")),
            select(StockRequestLine.request_id, BaiGhepThanhVien.lsx_id).join(
                BaiGhepThanhVien, BaiGhepThanhVien.bai_ghep_id == StockRequestLine.bai_ghep_id),
        )
        return [(int(v), n) for v, n in self._dem_theo_cap(cap, **loc)]

    def dem_theo_vat_tu(self, **loc) -> list[tuple[tuple[str, int], int]]:
        """Giá trị điều kiện "Vật tư": mã hàng xuất hiện ở dòng, kèm số yêu cầu."""
        ids = select(StockRequest.id).where(*self._base_conds(**loc))
        rows = self.db.execute(
            select(StockRequestLine.hang_loai, StockRequestLine.hang_id,
                   func.count(func.distinct(StockRequestLine.request_id)))
            .where(StockRequestLine.request_id.in_(ids))
            .group_by(StockRequestLine.hang_loai, StockRequestLine.hang_id)
        ).all()
        return [((str(l), int(i)), int(n)) for l, i, n in rows]

    def dem(self, **loc) -> int:
        """Số yêu cầu khớp `loc` (cùng điều kiện với `list`)."""
        return int(self.db.execute(
            select(func.count()).select_from(StockRequest).where(*self._base_conds(**loc))
        ).scalar_one())

    def dong_xuat_theo_lenh(self) -> list[tuple[StockRequestLine, str]]:
        """Dòng đề nghị XUẤT đã gắn lệnh/bài — nguồn "đã cấp" + "đang lĩnh" của bảng cân đối vật tư.

        Trả kèm `trang_thai` của header để phía gọi khỏi lazy-load từng cái (N+1 trên màn cân đối
        là hàng trăm query). CHỈ đề nghị XUẤT: đề nghị NHẬP là hàng ĐI VÀO kho, trừ nó vào nhu cầu
        sản xuất là trừ ngược dấu.

        Bỏ đề nghị đã HỦY / BỊ TỪ CHỐI: chúng không còn sinh ra phiếu nào nên `sl_duyet` của chúng
        không phải hàng "đang lĩnh".
        """
        stmt = (
            select(StockRequestLine, StockRequest.trang_thai)
            .join(StockRequest, StockRequest.id == StockRequestLine.request_id)
            .where(
                StockRequest.loai == REQ_XUAT,
                StockRequest.trang_thai.notin_([REQ_REJECTED, REQ_CANCELLED]),
                or_(
                    StockRequestLine.lsx_id.is_not(None),
                    StockRequestLine.bai_ghep_id.is_not(None),
                ),
            )
        )
        return [(ln, tt) for ln, tt in self.db.execute(stmt)]

    def dong_xuat_cho_cua_kho(self, kho_id: int) -> list[tuple[StockRequestLine, StockRequest]]:
        """Dòng đề nghị XUẤT còn treo ở MỘT kho mà KHÔNG gắn lệnh/bài (giao hàng, gia công ngoài, xuất
        lẻ) — phần "Sắp xuất" màn Tồn kho phải cộng thêm ngoài lệnh (12/10/2026). Dòng gắn lệnh/bài đã
        nằm trong bảng cân đối (`dong_xuat_theo_lenh`), cộng nữa là trừ hai lần.

        Bỏ nháp (người tạo chưa gửi) và đề nghị đã xong / huỷ / bị từ chối.

        Đề nghị CHƯA chọn kho (Giao hàng gửi, thủ kho chọn kho lúc lập phiếu) tính cho mọi kho — bên gọi
        chỉ ghép vào mặt hàng kho đó đang có lô, nên thực tế rơi vào kho đang giữ hàng."""
        stmt = (
            select(StockRequestLine, StockRequest)
            .join(StockRequest, StockRequest.id == StockRequestLine.request_id)
            .where(
                StockRequest.loai == REQ_XUAT,
                or_(StockRequest.kho_id == kho_id, StockRequest.kho_id.is_(None)),
                StockRequest.trang_thai.notin_([REQ_DRAFT, REQ_DONE, REQ_REJECTED, REQ_CANCELLED]),
                StockRequestLine.lsx_id.is_(None),
                StockRequestLine.bai_ghep_id.is_(None),
            )
            .order_by(StockRequest.id, StockRequestLine.id)
        )
        return [(ln, req) for ln, req in self.db.execute(stmt)]

    def khoa_nguoi_tao(self, user_id: int) -> None:
        """Khoá dòng tài khoản tới hết transaction — hai lượt "Gửi yêu cầu" của CÙNG một người xếp
        hàng nhau, lượt sau mới thấy lượt trước để nhận ra là gửi lại. SQLite bỏ FOR UPDATE."""
        from ..models.user import User

        self.db.execute(select(User.id).where(User.id == user_id).with_for_update())

    def vua_tao_boi(self, *, nguoi_tao_id: int, loai: str, tu_luc: datetime) -> list[StockRequest]:
        """Yêu cầu người này tạo (cùng loại) từ `tu_luc` tới giờ, kèm dòng — để so nội dung."""
        return list(self.db.execute(
            select(StockRequest)
            .options(selectinload(StockRequest.lines))
            .where(StockRequest.nguoi_tao_id == nguoi_tao_id, StockRequest.loai == loai,
                   StockRequest.created_at >= tu_luc)
            .order_by(StockRequest.id.desc())
        ).scalars())

    def create(self, *, ma: str, loai: str, nguoi_tao_id: int, lines: list[dict],
               commit: bool = True, **header) -> StockRequest:
        """`commit=False` = chỉ `flush()`, để người gọi ở NGOÀI tự chốt giao dịch.

        Cần cho những luồng phải chạy TRỌN VẸN trong MỘT giao dịch (ví dụ
        `san_xuat/vat_tu_de_nghi.tao()`: nó khoá công đoạn bằng `SELECT … FOR UPDATE` rồi mới ghi,
        mà một `commit()` ở đây là NHẢ khoá đó ra giữa chừng). `flush()` vẫn đẩy INSERT xuống DB nên
        `refresh(obj)` bên dưới lấy được id và các default của server như thường.
        """
        obj = StockRequest(ma=ma, loai=loai, nguoi_tao_id=nguoi_tao_id)
        for k in _HEADER_FIELDS:
            if k in header:
                setattr(obj, k, header[k])
        for ln in lines:
            obj.lines.append(_build_line(ln, loai))
        self.db.add(obj)
        if commit:
            self.db.commit()
        else:
            self.db.flush()
        self.db.refresh(obj)
        return obj

    def lan_nhan_cuoi_theo_dong(self, line_ids) -> dict[int, tuple[datetime, int | None]]:
        """`{request_line_id: (lúc ghi sổ, người ghi sổ)}` của phiếu ĐÃ GHI SỔ muộn nhất ứng dòng đó —
        mốc "kho đã nhận" cho hồ sơ lệnh. Dòng chưa có phiếu ghi sổ thì vắng mặt."""
        ids = {int(i) for i in line_ids if i}
        if not ids:
            return {}
        out: dict[int, tuple[datetime, int | None]] = {}
        for line_id, luc, nguoi in self.db.execute(
            select(StockVoucherLine.request_line_id, StockVoucher.ghi_so_luc, StockVoucher.nguoi_ghi_so_id)
            .join(StockVoucher, StockVoucher.id == StockVoucherLine.voucher_id)
            .where(StockVoucherLine.request_line_id.in_(ids), StockVoucher.trang_thai == VOUCHER_POSTED,
                   StockVoucher.ghi_so_luc.is_not(None))
        ).all():
            cu = out.get(int(line_id))
            if cu is None or luc > cu[0]:
                out[int(line_id)] = (luc, nguoi)
        return out

    def dong_nhap_tu_cong_viec(self, cong_viec_ids) -> list[tuple[StockRequest, StockRequestLine]]:
        """`[(yêu cầu, dòng)]` của mọi yêu cầu NHẬP có nguồn là các công đoạn KCS cuối này (mg 0309),
        theo thứ tự tạo. Rỗng đầu vào ⇒ không đụng DB."""
        ids = {int(i) for i in cong_viec_ids if i}
        if not ids:
            return []
        return [
            (req, ln)
            for req, ln in self.db.execute(
                select(StockRequest, StockRequestLine)
                .join(StockRequestLine, StockRequestLine.request_id == StockRequest.id)
                .where(StockRequest.san_xuat_cong_viec_id.in_(ids), StockRequest.loai == "NHAP")
                .order_by(StockRequest.id, StockRequestLine.id)
            ).all()
        ]

    def replace_lines(self, obj: StockRequest, lines: list[dict]) -> None:
        """Thay toàn bộ dòng (chỉ dùng khi yêu cầu còn sửa được). Xóa-rồi-thêm thay vì
        khớp từng dòng: yêu cầu còn nháp thì chưa có phiếu nào trỏ vào dòng cũ."""
        obj.lines.clear()
        self.db.flush()
        for ln in lines:
            obj.lines.append(_build_line(ln, obj.loai))

    def update_header(self, obj: StockRequest, data: dict) -> StockRequest:
        for k in _HEADER_FIELDS:
            if k in data:
                setattr(obj, k, data[k])
        return obj

    def save(self, obj: StockRequest, *, commit: bool = True) -> StockRequest:
        """`commit=False`: chỉ `flush()` — xem docstring `create` để biết vì sao cần."""
        if commit:
            self.db.commit()
        else:
            self.db.flush()
        self.db.refresh(obj)
        return obj

    def delete(self, obj: StockRequest) -> None:
        self.db.delete(obj)
        self.db.commit()
