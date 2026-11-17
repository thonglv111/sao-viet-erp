"""Nhà gia công GIAO THẲNG cho khách — một dòng phiếu nhận nơi về "khách" (spec 2026-11-13 §4.4).

Một yêu cầu giao + một chuyến THÀNH CÔNG mang `tgc_phieu_nhan_id` ⇒ cộng vào "đã giao" của dòng đơn
bán (`da_giao_theo_dong`). Không kho, không xe, không phiếu xuất, không km. Huỷ phiếu nhận thì huỷ
chuyến + yêu cầu (giữ vết)."""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from ...models.delivery import LG_DA_HUY, LG_THANH_CONG, YC_CHO_LEN_KE_HOACH, YC_DA_HUY
from ...repositories.delivery_repo import DeliveryRepository
from ...repositories.don_vi_do_repo import DonViDoRepository, nhan_don_vi
from ...repositories.employee_repo import EmployeeRepository
from ...repositories.loc_danh_sach import VN_TZ
from ...repositories.order_repo import OrderRepository
from ...repositories.san_xuat_repo import SanXuatRepository
from ...repositories.thue_gia_cong_repo import ThueGiaCongRepository
from ..delivery_service import sinh_ma_chung_tu
from ..san_xuat.kho import _he_so, la_chang_thanh_pham, loi_quy_doi
from ..san_xuat.vat_tu_de_nghi import _hang_service
from ..thanh_pham_khai_bao import cum_ban, cum_cua_dong, khai_cum
from ..vat_lieu_kho_service import VatLieuKhoError


def dong_don_dung_rieng(db: Session, lsx_id: int | None) -> bool:
    """Dòng đơn của lệnh đứng RIÊNG một cụm bán (cụm chỉ có đúng dòng đó). Cụm nhiều dòng (bìa +
    ruột một cuốn) thì một lệnh không giao thẳng thay cả cụm được."""
    lsx = SanXuatRepository(db).lsx(lsx_id) if lsx_id else None
    if lsx is None or not lsx.order_line_id:
        return False
    order = OrderRepository(db).get_by_id(lsx.order_id)
    if order is None:
        return False
    for cum in cum_ban(order):
        if any(ln.id == lsx.order_line_id for ln in cum.dong):
            return len(cum.dong) == 1
    return False


def _he_so_ve_dong(db: Session, tp, tu_dv: str, dv_dong: str, cv=None) -> float:
    """1 `tu_dv` = bao nhiêu đơn vị dòng đơn — cùng đường quy đổi của món như nhập kho thành phẩm."""
    if not tu_dv:
        raise ValueError("Công đoạn cuối chưa khai đơn vị ra nên chưa quy đổi được sang đơn vị giao.")
    if la_chang_thanh_pham(tu_dv):
        # Chặng Thành phẩm = đơn vị tính của sản phẩm trên LỆNH; dòng đơn bán theo đơn vị khác thì
        # quy từ đơn vị lệnh sang — mã chặng `cai` không phải đơn vị bán.
        lsx = SanXuatRepository(db).lsx(cv.lsx_id) if getattr(cv, "lsx_id", None) else None
        if lsx is not None and (lsx.don_vi_tinh or "").strip():
            bang = DonViDoRepository(db).ten_theo_ma()
            if dv_dong and nhan_don_vi(bang, lsx.don_vi_tinh) == nhan_don_vi(bang, dv_dong):
                return 1.0
            tu_dv = lsx.don_vi_tinh.strip()
    if not dv_dong or tu_dv.lower() == dv_dong.lower():
        return 1.0
    try:
        return _he_so(_hang_service(db), tp.id, tu_dv, dv_dong)
    except VatLieuKhoError:
        if cv is not None:
            raise loi_quy_doi(db, tu_dv=tu_dv, sang_dv=dv_dong, cv=cv, tp=tp,
                              dich="dong_don") from None
        bang = DonViDoRepository(db).ten_theo_ma()
        raise ValueError(
            f"Không quy đổi được từ «{nhan_don_vi(bang, tu_dv)}» sang «{nhan_don_vi(bang, dv_dong)}» "
            f"(đơn vị dòng đơn) cho {tp.ma}."
        ) from None


def _ngay_vn(dt: datetime) -> date:
    if dt.tzinfo is None:  # SQLite (bộ test) trả mốc không múi — vốn là UTC
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(VN_TZ).date()


def luc_khach_nhan(don, ngay: date | None, luc: datetime) -> datetime:
    """Mốc "khách nhận" của chuyến giao thẳng. Kế toán ghi doanh thu + giá vốn theo NGÀY KHÁCH NHẬN
    trên biên bản, không theo giờ bấm lưu — bấm trễ qua tháng là hoá đơn nhảy sai kỳ. Trống / hôm
    nay ⇒ giờ lưu; ngày cũ hơn ⇒ 12:00 giờ VN của ngày đó (giữa ngày để đổi múi giờ không lật ngày).
    Không được trước ngày ĐẶT đơn gia công (hàng chưa giao cho nhà gia công thì chưa thể tới khách)."""
    hom_nay = _ngay_vn(luc)
    if ngay is None or ngay == hom_nay:
        return luc
    if ngay > hom_nay:
        raise ValueError("Ngày khách nhận không được sau hôm nay.")
    moc = getattr(don, "dat_luc", None) or getattr(don, "created_at", None)
    if moc is not None and ngay < _ngay_vn(moc):
        raise ValueError(f"Ngày khách nhận trước ngày giao việc cho nhà gia công "
                         f"({_ngay_vn(moc):%d/%m/%Y}).")
    return datetime(ngay.year, ngay.month, ngay.day, 12, tzinfo=VN_TZ).astimezone(timezone.utc)


def ghi_giao_thang(db: Session, *, user, don, lsx_id: int, cv, so: float, phieu_nhan_id: int,
                   ngay_khach_nhan: date | None = None):
    """Đi thẳng qua repo — cửa lập yêu cầu của Giao hàng chặn theo trần "giao được" tính từ kho, mà
    hàng này không qua kho. Không commit. Ngày hẹn của yêu cầu = HẠN TRÊN ĐƠN BÁN để màn Giao hàng
    so sớm / trễ — đơn không khai hạn thì lấy chính ngày khách nhận (cột NOT NULL)."""
    lsx = SanXuatRepository(db).lsx(lsx_id)
    order = OrderRepository(db).get_by_id(lsx.order_id) if lsx else None
    cum = cum_cua_dong(order, lsx.order_line_id) if order is not None else None
    if cum is None or len(cum.dong) != 1:
        raise ValueError("Dòng đơn của lệnh đi chung cụm với dòng khác — không giao thẳng được, "
                         "chọn về kho.")
    emp = EmployeeRepository(db).get_by_user_id(user.id)
    if emp is None:
        raise ValueError("Tài khoản của bạn chưa gắn hồ sơ nhân viên — chuyến giao phải đứng tên "
                         "một nhân viên. Nhờ Nhân sự gắn rồi nhận lại, hoặc chọn về kho.")
    tp = khai_cum(db, order, cum)
    ln = cum.dong[0]
    # "Đã giao" / "còn phải giao" của Giao hàng đếm theo ĐƠN VỊ DÒNG ĐƠN — quy số nhận (đơn vị ra
    # của công việc cuối) về đúng đơn vị đó rồi mới so.
    qty = int(round(so * _he_so_ve_dong(db, tp, (cv.don_vi_ra or "").strip(),
                                        (ln.don_vi_tinh or "").strip(), cv)))
    if qty <= 0:
        raise ValueError("Số đạt quy ra số lượng giao bằng 0.")
    repo = DeliveryRepository(db)
    con = int(ln.qty or 0) - int(repo.da_giao_theo_dong(order.id).get(ln.id, 0))
    if qty > con:
        raise ValueError(f"Dòng đơn bán chỉ còn phải giao {con} — nhập đúng số khách nhận.")

    luc = luc_khach_nhan(don, ngay_khach_nhan, datetime.now(timezone.utc))
    han = getattr(order, "delivery_committed_date", None) or _ngay_vn(luc)
    uid = getattr(user, "id", None)
    ghi = f"Nhà gia công {don.nha_cung_cap_ten} giao thẳng"
    # Nơi nhận + lưu ý giao là của ĐƠN BÁN, như mọi yêu cầu lập ở Giao hàng. Câu "nhà gia công giao
    # thẳng" nằm ở chuyến (`ghi_chu_phan_cong`).
    req = repo.create_request(
        code=sinh_ma_chung_tu("YCGH", repo.get_request_by_code), order_id=order.id,
        customer_id=getattr(order, "customer_id", None), department_id=user.department_id,
        ngay_can_giao=han, dia_chi=order.delivery_address or "",
        nguoi_nhan=order.delivery_contact_name, sdt_nguoi_nhan=order.delivery_contact_phone,
        ghi_chu=order.delivery_note, trang_thai=YC_CHO_LEN_KE_HOACH, created_by=uid,
    )
    repo.add_request_line(req.id, ln.id, qty, hang_loai="vat_tu", hang_id=tp.id, dvt=tp.don_vi_gia)
    trip = repo.create_trip(
        request_id=req.id, lan_thu=1, employee_id=emp.id,
        ghi_chu_phan_cong=f"{ghi} — không xe, không kho", trang_thai=LG_THANH_CONG,
        thoi_gian_ket_thuc=luc, ghi_chu_ket_qua=ghi, created_by=uid, tgc_phieu_nhan_id=phieu_nhan_id,
    )
    repo.add_trip_line(trip.id, ln.id, qty)
    repo.ghi_lich_su(trip_id=trip.id, tu_trang_thai=None, den_trang_thai=LG_THANH_CONG,
                     nguoi_thao_tac_id=uid, ghi_chu="Ghi từ phiếu nhận gia công")
    return trip


def huy_giao_thang(db: Session, *, user, phieu_nhan_id: int, ly_do: str) -> int:
    """Huỷ chuyến + yêu cầu của phiếu nhận (giữ vết, không xoá) ⇒ thôi cộng "đã giao"."""
    repo = DeliveryRepository(db)
    uid = getattr(user, "id", None)
    n = 0
    for trip in ThueGiaCongRepository(db).chuyen_giao_thang_cua_phieu_nhan(phieu_nhan_id):
        truoc = trip.trang_thai
        trip.trang_thai = LG_DA_HUY
        repo.ghi_lich_su(trip_id=trip.id, tu_trang_thai=truoc, den_trang_thai=LG_DA_HUY,
                         nguoi_thao_tac_id=uid, ly_do=ly_do[:500])
        req = repo.get_request(trip.request_id)
        if req is not None:
            req.trang_thai, req.ly_do_huy = YC_DA_HUY, ly_do[:500]
        n += 1
    return n
