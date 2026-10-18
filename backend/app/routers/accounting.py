"""Accounting API: purchase inbox, bank accounts, Phiếu chi and UNC."""
from __future__ import annotations

from datetime import date
from typing import Annotated

from sqlalchemy.orm import Session
from ..db import get_db
from ..services.cong_no_khoa_so_service import CongNoKhoaSoError, CongNoKhoaSoService
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status

from ..deps import (
    get_accounting_service,
    get_department_repository,
    get_authorization_service,
    get_module_notification_repository,
    get_order_service,
    get_purchase_service,
    require_any_permission,
    require_permission,
)
from ..doi_tuong_nhan import MAN_BAN_HANG, MAN_MUA_KE_TOAN, MAN_NHAN_SU, MAN_THEO_LENH, hop
from ..models.purchase import PR_DRAFT
from ..realtime import hub
from ..services.thong_bao_man import bao
from ..models.user import User
from ..repositories.gia_cong_ngoai_repo import GiaCongNgoaiRepository
from ..repositories.rbac_repo import DepartmentRepository
from ..repositories.module_notification_repo import (
    CHANNEL_THU_MUA,
    ModuleNotificationRepository,
)
from ..schemas.accounting import (
    NganHangLocOut,
    ApproveAndCreateVoucherIn,
    BaoCaoCongNoOut,
    KhoanConNoListOut,
    SoChiTietCongNoOut,
    CongNoKhoaSoIn,
    CongNoKhoaSoRow,
    CongNoKhoaSoTrangThaiOut,
    CongNoKyRow,
    GiaCongChoChiDemOut,
    GiaCongChoChiOut,
    DonHangChoThuOut,
    TraLaiKhachChoChiOut,
    CancelSalesInvoiceIn,
    DieuChinhIn,
    DieuChinhOut,
    CancelPaymentReceiptIn,
    CancelPaymentVoucherIn,
    CompanyBankAccountIn,
    CompanyBankAccountOut,
    MarkPaymentReceiptReceivedIn,
    PaymentReceiptAttachmentListOut,
    PaymentReceiptAttachmentOut,
    PaymentReceiptIn,
    PaymentReceiptListOut,
    PaymentReceiptOut,
    PaymentVoucherAttachmentListOut,
    PaymentVoucherAttachmentOut,
    PaymentVoucherIn,
    PaymentVoucherListOut,
    PaymentVoucherOut,
    PhieuChiGopIn,
    PhieuThuGopIn,
    ChiTietKhoanThuOut,
    VoucherBatchOut,
    VoucherFromAdvancesBatchIn,
    BangKeTamUngOut,
    PayablesDetailOut,
    PayablesSummaryOut,
    ReceivablesDetailOut,
    ReceivablesSummaryOut,
    SalesInvoiceIn,
    SalesInvoiceListOut,
    SalesInvoiceOut,
    SupplierBankAccountIn,
    SupplierBankAccountOut,
    TaiKhoanThongKeOut,
)
from ..schemas.loc_danh_sach import LuaChonLoc
from ..schemas.purchase import MuaHangChoChiOut, PurchaseRequestListOut
from ..services import bao_cao_cong_no, bao_cao_cong_no_excel
from ..services import ban_hang_cho_thu_chi
from ..services.gia_cong_ngoai import cho_chi as gc_cho_chi
from ..services.accounting_service import (
    AccountingBulkBlocked,
    AccountingConflict,
    AccountingNotFound,
    AccountingService,
    AccountingValidationError,
    MAX_ATTACHMENT_BYTES,
)
from ..services.purchase_service import PurchaseService
from ..tai_len import doc_gioi_han
from ..services.order_service import OrderForbidden, OrderNotFound, OrderService
from ..services.rbac_service import AuthorizationService


router = APIRouter(tags=["accounting"])
# TÁCH THEO MÀN (10/08/2026, đường A). Trước đây CẢ phân hệ treo trên một khoá `ke_toan`:
# bật `read` là mở luôn 6 màn, còn `approve` bị dùng làm cờ vạn năng cho "lập phiếu chi", "lập
# phiếu thu" và "gán chứng từ" — bật một ô là tiền ra được. Đúng bệnh tester ghi.
#
# `MODULE` giữ khoá `ke_toan` (đổi khoá là mọi hàng `role_permissions` cũ trỏ vào hư không) nhưng
# nay chỉ còn nghĩa MÀN ĐƠN MUA HÀNG. Năm màn kia có khoá riêng.
#
# ĐỘNG TỪ cũng được gọi đúng tên: LẬP phiếu nay là `create` chứ không phải `approve`.
# Migration 0178 ánh xạ `create = create OR approve` khi sao chép, nếu không kế toán đang lập
# phiếu bằng ô `approve` sẽ mất quyền ngay khi bản này lên.
MODULE = "ke_toan"                    # màn Đơn mua hàng (hộp thư kế toán)
MODULE_PC = "phieu_chi"               # màn Phiếu chi / UNC
MODULE_PT = "phieu_thu"               # màn Phiếu thu
MODULE_CN_TRA = "cong_no_phai_tra"    # màn Công nợ phải trả
MODULE_CN_THU = "cong_no_phai_thu"    # màn Công nợ phải thu
MODULE_TKNH = "tk_ngan_hang"          # màn Tài khoản ngân hàng
# Module RIÊNG cho "Báo cáo" (chủ chốt 04/09/2026: "báo cáo đó là một module riêng mà") — trước
# 10 endpoint dưới đây gác bằng MODULE_CN_TRA/MODULE_CN_THU (lệch với sidebar đã gộp báo cáo
# thành MỘT mục), migration 0260 sao chép quyền cũ sang. Xem = xem báo cáo/xuất Excel/in, Thao
# tác = khoá/mở kỳ (`POST /khoa-so`) — một động từ cho cả hai phân hệ, không lệch nữa.
MODULE_BAO_CAO = "bao_cao_cong_no"


NotificationRepo = Annotated[
    ModuleNotificationRepository, Depends(get_module_notification_repository)
]


def _notify_accounting_changed(
    code: str | None = None,
    *,
    event_type: str = "accounting_changed",
    notifications: ModuleNotificationRepository | None = None,
    channel: str | None = None,
    actor_user_id: int | None = None,
    recipient_user_id: int | None = None,
    **extra,
) -> None:
    """Tín hiệu nhẹ cho các màn Kế toán/Thu mua tự refetch qua SSE."""
    if notifications is not None and channel is not None:
        notifications.create(
            channel=channel,
            event_type=event_type,
            actor_user_id=actor_user_id,
            recipient_user_id=recipient_user_id,
            source_code=code,
        )
    # Nhóm `mua_ke_toan` (mọi màn Thu mua / Kế toán); hoá đơn bán còn nhích nhóm `ban_hang` (Công
    # nợ phải thu, Phiếu thu, Đơn hàng bán). Người đứng tên phiếu mua (`recipient_user_id`) nhận
    # đích danh — tin "kế toán đã lập / huỷ chứng từ cho đơn của bạn" là việc của chính họ.
    quyen = (hop(MAN_MUA_KE_TOAN, MAN_BAN_HANG) if event_type.startswith("sales_invoice")
             else MAN_MUA_KE_TOAN)
    hub.gui({
        "type": event_type,
        "code": code,
        "actor_user_id": actor_user_id,
        "recipient_user_id": recipient_user_id,
        **extra,
    }, quyen=quyen, nguoi=[recipient_user_id] if recipient_user_id else None)


def _phat_gia_cong_chi_doi(svc: AccountingService, gia_cong_ngoai_id: int | None) -> None:
    """Phiếu chi gia công ngoài vừa lập / huỷ ⇒ hàng "Gia công chờ chi" + badge Phiếu chi (nhóm
    `mua_ke_toan`) và khối Gia công ngoài trên lệnh / bài ghép (màn theo lệnh, nhóm `san_xuat`).
    Bàn tổ không bày tiền gia công nên không nhận."""
    hub.gui({"type": "gia_cong_cho_chi_changed"}, quyen=MAN_MUA_KE_TOAN)
    hub.gui({
        "type": "gia_cong_ngoai_changed",
        "gia_cong_ngoai_id": gia_cong_ngoai_id,
        **_khoa_gia_cong(svc, gia_cong_ngoai_id),
    }, quyen=MAN_THEO_LENH)


def _khoa_gia_cong(svc: AccountingService, gia_cong_ngoai_id: int | None) -> dict:
    """Lệnh SX (hoặc bài ghép + các lệnh thành viên) của lần gia công — để SSE
    `gia_cong_ngoai_changed` nạp lại đúng khối trên màn lệnh / màn bài ghép."""
    if gia_cong_ngoai_id is None:
        return {"lsx_id": None}
    from ..services.gia_cong_ngoai.lan import nguon_lan

    db = svc.repo.db
    gcn = GiaCongNgoaiRepository(db).get(int(gia_cong_ngoai_id))
    if gcn is None:
        return {"lsx_id": None}
    ids = [l["id"] for l in nguon_lan(db, gcn)["lenh"]] or [gcn.lsx_id]
    return {"lsx_id": ids[0], "lsx_ids": ids, "bai_ghep_id": gcn.bai_ghep_id}


def _map_error(exc: Exception) -> HTTPException:
    if isinstance(exc, AccountingNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, AccountingValidationError):
        return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    if isinstance(exc, AccountingConflict):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("/api/accounting/inbox", response_model=PurchaseRequestListOut)
def accounting_inbox(
    purchases: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    q: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    supplier_id: int | None = Query(default=None),
    # Kỳ của thanh lọc chung (06/10/2026): `moc` = tao (Ngày tạo) | can (Ngày cần hàng).
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query(default="tao", pattern="^(tao|can)$"),
    deposit_status: str | None = Query(default=None),
    tien: str | None = Query(default=None, pattern="^(chua_tra|mot_phan|qua_han|da_tra)$"),
    # Ba vai người trên đơn (10/10/2026): NV yêu cầu / NV mua hàng (người lập) / NV duyệt.
    nv_yc_id: int | None = Query(default=None),
    nv_mua_id: int | None = Query(default=None),
    nv_duyet_id: int | None = Query(default=None),
    sort: str = Query(default="-created_at"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
) -> PurchaseRequestListOut:
    # Kế toán có `ke_toan` scope `all` ⇒ `_purchase_scope` trả `all` ⇒ thấy HẾT đơn mua, đúng như
    # họ cần để lập phiếu chi. Truyền `actor` để chính lối này không thành lỗ nhìn xuyên phạm vi.
    if tu_ngay and den_ngay:
        _khoang_ngay(tu_ngay, den_ngay)
    loc = dict(
        q=q,
        supplier_id=supplier_id,
        tu_ngay=tu_ngay,
        den_ngay=den_ngay,
        moc=moc,
        deposit_status=deposit_status,
        nv_yc_id=nv_yc_id,
        nv_mua_id=nv_mua_id,
        nv_duyet_id=nv_duyet_id,
        # Đơn NHÁP là thu mua còn đang sửa, CHƯA gửi duyệt — không thuộc hộp thư kế toán (chủ
        # 04/08/2026). Chặn ở API chứ không chỉ giấu ở giao diện.
        exclude_statuses=[PR_DRAFT],
    )
    # Cùng một hàm với màn Mua hàng: hai nhóm lọc Hàng (`status`) và Tiền (`tien`), số trên mỗi
    # nhóm đếm trước khi lọc cả hai nhóm.
    rows, total, dem, dem_tien = purchases.danh_sach_don(
        status=status_, tien=tien, sort=sort, page=page, size=size, actor=user, **loc
    )
    return PurchaseRequestListOut(
        items=rows, total=total, page=page, size=size, dem_theo_tab=dem, dem_theo_tien=dem_tien
    )


@router.get("/api/accounting/inbox/loc-ncc", response_model=list[LuaChonLoc])
def accounting_inbox_loc_ncc(
    purchases: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> list[LuaChonLoc]:
    """Ô "Nhà cung cấp" của thanh lọc hộp Đơn mua hàng: NCC đang có đơn trong hộp, kèm số đơn."""
    return [
        LuaChonLoc(id=i, ten=t, so=n)
        for i, t, n in purchases.dem_theo_ncc(actor=user, exclude_statuses=[PR_DRAFT])
    ]


@router.get("/api/accounting/inbox/loc-nguoi", response_model=list[LuaChonLoc])
def accounting_inbox_loc_nguoi(
    purchases: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    vai: str = Query(pattern="^(yc|mua|duyet)$"),
) -> list[LuaChonLoc]:
    """Ô NV yêu cầu / NV mua hàng / NV duyệt của hộp Đơn mua hàng (không tính đơn nháp)."""
    return [
        LuaChonLoc(id=i, ten=t, so=n)
        for i, t, n in purchases.dem_theo_nguoi(vai, actor=user, exclude_statuses=[PR_DRAFT])
    ]


@router.get("/api/accounting/payables", response_model=PayablesSummaryOut)
def accounting_payables(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_CN_TRA, "read"))],
    q: str | None = Query(default=None),
    filter_: str = Query(default="all", alias="filter"),
    aging_bucket: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
    # KỲ (05/10/2026): có đủ hai ngày thì số tiền theo sổ 331 của kỳ; thiếu cả hai = hành vi cũ
    # (ảnh chụp hôm nay, kỳ 3 tháng) cho các nơi khác đang gọi; thiếu một = 422.
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    # Bộ lọc nâng cao — chọn DÒNG, không đổi số tổng đầu màn. Khoá lạ thì bỏ qua như `filter`.
    no_tu: int | None = Query(default=None),
    no_den: int | None = Query(default=None),
    han_tra: str | None = Query(default=None),
    han_muc: str | None = Query(default=None),
    ca_da_tra_het: bool = Query(default=False),
    # Chỉ giữ NCC còn đợt giao CÒN NỢ chưa ghi số hoá đơn (ô "Có đợt giao chưa ghi hoá đơn").
    thieu_hoa_don: bool = Query(default=False),
    dem_only: bool = Query(default=False),
    # Chỉ các số TỔNG (lời "cùng kỳ" của màn): items rỗng, máy chủ khỏi dựng dòng / lọc / cắt trang.
    chi_tong: bool = Query(default=False),
    # Sắp xếp ở MÁY CHỦ (bảng đủ cột): `con_no` | `han` | `gan_nhat`, `chieu` = asc | desc. Khoá lạ
    # thì giữ thứ tự mặc định — xem `_sap_xep_cong_no`.
    sap_xep: str | None = Query(default=None),
    chieu: str | None = Query(default=None),
) -> PayablesSummaryOut:
    # Chỉ ĐỌC — không đẻ ô quyền mới, `ke_toan:read` là đủ. Không phân trang: cắt trang là ra
    # TỔNG sai.
    #
    # `q` lọc ở SERVER chứ không lọc trên danh sách đã trả về: NCC đã trả hết và im lặng lâu thì
    # KHÔNG có dòng nào trong danh sách để mà lọc — phải để service lôi họ ra.
    #
    # `aging_bucket` = một khoá rổ tuổi (`AGING_KEYS`). Router chỉ chuyển tiếp; việc gom rổ và
    # hiểu khoá nằm ở service.
    _ky_du_hai_dau(tu_ngay, den_ngay)
    return PayablesSummaryOut(
        **svc.payables_summary(
            q=q, filter_=filter_, aging_bucket=aging_bucket, page=page, size=size,
            tu_ngay=tu_ngay, den_ngay=den_ngay, no_tu=no_tu, no_den=no_den,
            han_tra=han_tra, han_muc=han_muc, ca_da_tra_het=ca_da_tra_het,
            thieu_hoa_don=thieu_hoa_don, dem_only=dem_only, chi_tong=chi_tong,
            sap_xep=sap_xep, chieu=chieu,
        )
    )


@router.get("/api/accounting/payables/{supplier_id}", response_model=PayablesDetailOut)
def accounting_payables_detail(
    supplier_id: int,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_CN_TRA, "read"))],
    all_history: bool = Query(default=False),
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    # Trang của rổ "đã chi" (nút "Xem thêm"); không truyền `paid_size` = trả trọn như cũ.
    paid_page: int = Query(default=1, ge=1),
    paid_size: int | None = Query(default=None, ge=1, le=200),
) -> PayablesDetailOut:
    # `all_history` bỏ mốc kỳ cho riêng rổ "đã chi" — nút "Xem lịch sử cũ hơn". Chỉ nới cho MỘT
    # NCC nên vẫn nhẹ; đừng bao giờ nới cho bảng tổng hợp. `tu_ngay`/`den_ngay` = rổ "đã chi"
    # theo đúng kỳ màn tổng hợp đang chọn.
    _ky_du_hai_dau(tu_ngay, den_ngay)
    return PayablesDetailOut(
        **svc.payables_detail(
            supplier_id, all_history=all_history, tu_ngay=tu_ngay, den_ngay=den_ngay,
            paid_page=paid_page, paid_size=paid_size,
        )
    )


@router.get("/api/accounting/receivables", response_model=ReceivablesSummaryOut)
def accounting_receivables(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_CN_THU, "read"))],
    q: str | None = Query(default=None),
    filter_: str = Query(default="all", alias="filter"),
    # CÙNG TÊN với bên phải trả (`aging_bucket`), đừng đặt tên khác: hai màn song sinh mà tham
    # số lệch tên là chỗ người ta chép URL từ màn này sang màn kia rồi bộ lọc im lặng không chạy.
    aging_bucket: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
    # Cùng bộ tham số kỳ + lọc với `/payables` (cùng tên — xem ghi chú `aging_bucket`).
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    no_tu: int | None = Query(default=None),
    no_den: int | None = Query(default=None),
    han_tra: str | None = Query(default=None),
    han_muc: str | None = Query(default=None),
    ca_da_tra_het: bool = Query(default=False),
    # Riêng phải thu: sale phụ trách (`Customer.sale_user_id`) và nhãn khách (`customer_tags`).
    phu_trach_id: int | None = Query(default=None),
    nhan: str | None = Query(default=None),
    dem_only: bool = Query(default=False),
    # Chỉ các số TỔNG — cùng nghĩa với `/payables`.
    chi_tong: bool = Query(default=False),
    # Cùng tên, cùng nghĩa với `/payables`.
    sap_xep: str | None = Query(default=None),
    chieu: str | None = Query(default=None),
) -> ReceivablesSummaryOut:
    _ky_du_hai_dau(tu_ngay, den_ngay)
    return ReceivablesSummaryOut(
        **svc.receivables_summary(
            q=q, filter_=filter_, aging_bucket=aging_bucket, page=page, size=size,
            tu_ngay=tu_ngay, den_ngay=den_ngay, no_tu=no_tu, no_den=no_den,
            han_tra=han_tra, han_muc=han_muc, ca_da_tra_het=ca_da_tra_het,
            phu_trach_id=phu_trach_id, nhan=nhan, dem_only=dem_only, chi_tong=chi_tong,
            sap_xep=sap_xep, chieu=chieu,
        )
    )


@router.get("/api/accounting/receivables/{customer_id}", response_model=ReceivablesDetailOut)
def accounting_receivables_detail(
    customer_id: int,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_CN_THU, "read"))],
    all_history: bool = Query(default=False),
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    # Trang của rổ "đã thu" (nút "Xem thêm"); không truyền `paid_size` = trả trọn như cũ.
    paid_page: int = Query(default=1, ge=1),
    paid_size: int | None = Query(default=None, ge=1, le=200),
) -> ReceivablesDetailOut:
    _ky_du_hai_dau(tu_ngay, den_ngay)
    return ReceivablesDetailOut(
        **svc.receivables_detail(
            customer_id, all_history=all_history, tu_ngay=tu_ngay, den_ngay=den_ngay,
            paid_page=paid_page, paid_size=paid_size,
        )
    )


# SAO KÊ của MỘT đối tác ngay trong ngăn công nợ (06/10/2026): CÙNG ruột sổ chi tiết bên báo cáo
# (`so_chi_tiet_phai_*`) nhưng gác bằng quyền ĐỌC của chính màn công nợ — một mục thanh bên một
# module, người xem được công nợ khách này không cần thêm ô quyền Báo cáo công nợ mới xem được
# sao kê của đúng khách đó.
@router.get("/api/accounting/receivables/{customer_id}/so-chi-tiet", response_model=SoChiTietCongNoOut)
def accounting_receivables_sao_ke(
    customer_id: int,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_CN_THU, "read"))],
    tu_ngay: date = Query(...),
    den_ngay: date = Query(...),
) -> SoChiTietCongNoOut:
    _khoang_ngay(tu_ngay, den_ngay)
    return SoChiTietCongNoOut(**bao_cao_cong_no.cat_trang_so_chi_tiet(
        svc.so_chi_tiet_phai_thu(doi_tuong_id=customer_id, tu_ngay=tu_ngay, den_ngay=den_ngay),
        page=1, size=None,
    ))


@router.get("/api/accounting/payables/{supplier_id}/so-chi-tiet", response_model=SoChiTietCongNoOut)
def accounting_payables_sao_ke(
    supplier_id: int,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_CN_TRA, "read"))],
    tu_ngay: date = Query(...),
    den_ngay: date = Query(...),
) -> SoChiTietCongNoOut:
    _khoang_ngay(tu_ngay, den_ngay)
    return SoChiTietCongNoOut(**bao_cao_cong_no.cat_trang_so_chi_tiet(
        svc.so_chi_tiet_phai_tra(doi_tuong_id=supplier_id, tu_ngay=tu_ngay, den_ngay=den_ngay),
        page=1, size=None,
    ))


# --- BÁO CÁO TỔNG HỢP CÔNG NỢ THEO KỲ (docs/prd-bao-cao-cong-no.md §5.1) -------------------
#
# ⚠️ ĐỪNG nhầm với `/payables` và `/receivables` ngay trên: hai cửa kia là ảnh chụp TẠI HÔM NAY
# để đi đòi nợ (có phân trang, có phân tuổi, cứng kỳ 3 tháng). Hai cửa dưới là SỔ THEO KỲ — chọn
# khoảng ngày bất kỳ, trả về TOÀN BỘ đối tượng, không phân trang.
#
# KHÔNG phân trang có chủ ý: sổ tổng hợp phải cộng đúng dòng TỔNG CỘNG, mà cắt trang là ra tổng
# của trang chứ không phải tổng của kỳ. Bản xuất MISA cũng một mạch 202/275 dòng.
#
# Dùng lại quyền `read` của chính màn công nợ tương ứng: ai xem được công nợ thì xem được sổ của
# nó — đẻ thêm một ô quyền nữa chỉ tổ có người xem được số này mà không xem được số kia.


def _khoang_ngay(tu_ngay: date, den_ngay: date) -> None:
    """Chặn khoảng ngày ngược. Không có ô này thì báo cáo trả về bảng rỗng một cách bí ẩn: mọi
    chứng từ đều rơi vào nhánh 'ngoài kỳ' và không ai hiểu vì sao."""
    if tu_ngay > den_ngay:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Từ ngày phải trước hoặc bằng đến ngày.",
        )


def _ky_du_hai_dau(tu_ngay: date | None, den_ngay: date | None) -> None:
    """Kỳ của màn Công nợ: có đủ hai ngày (rồi chặn ngược bằng `_khoang_ngay`) hoặc không có ngày
    nào (hành vi cũ). Chỉ một ngày thì không biết kỳ là gì ⇒ 422, đừng tự đoán nửa còn lại."""
    if (tu_ngay is None) != (den_ngay is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Chọn đủ từ ngày và đến ngày.",
        )
    if tu_ngay is not None and den_ngay is not None:
        _khoang_ngay(tu_ngay, den_ngay)


def _loc_ro(bc: dict, khoa: str | None) -> dict:
    """Lọc sổ theo RỔ TUỔI. Chỉ giữ đối tượng có tiền trong rổ đó — số tiền của họ giữ NGUYÊN.

    Dòng TỔNG cũng tính lại theo phần còn hiện, nhưng DẢI RỔ thì giữ nguyên toàn màn: dải là bức
    tranh tổng, bấm vào để soi chứ không phải để đổi bức tranh (cùng nếp `AgingStrip` đang chạy).
    """
    from ..services.accounting_service import AGING_KEYS

    if khoa not in AGING_KEYS:
        return bc
    giu = [d for d in bc["items"] if (d.get("aging") or {}).get(khoa, {}).get("amount", 0) > 0]
    cot = ("dau_no", "dau_co", "ps_no", "ps_co", "cuoi_no", "cuoi_co")
    return {
        **bc,
        "items": giu,
        "tong": {"so_dong": len(giu), **{k: sum(d[k] for d in giu) for k in cot}},
    }


def _loc_tim_so(bc: dict, q: str | None) -> dict:
    """Ô tìm của sổ tổng hợp (06/10/2026 — trước đó lọc trong trình duyệt): giữ đối tượng có MÃ
    hoặc TÊN khớp tương đối (không dấu, không hoa thường). Dòng TỔNG tính lại theo phần còn hiện,
    như `_loc_ro`; số tiền từng dòng giữ nguyên."""
    from ..repositories.tim_khong_dau import bo_dau

    kim = bo_dau(q)
    if not kim:
        return bc
    giu = [d for d in bc["items"] if kim in bo_dau(d.get("ten")) or kim in bo_dau(d.get("ma"))]
    cot = ("dau_no", "dau_co", "ps_no", "ps_co", "cuoi_no", "cuoi_co")
    return {
        **bc,
        "items": giu,
        "tong": {"so_dong": len(giu), **{k: sum(d[k] for d in giu) for k in cot}},
    }


@router.get("/api/accounting/reports/receivables", response_model=BaoCaoCongNoOut)
def bao_cao_tong_hop_phai_thu(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_BAO_CAO, "read"))],
    tu_ngay: date = Query(...),
    den_ngay: date = Query(...),
    #: Khoá rổ tuổi — chỉ giữ đối tượng còn tiền trong rổ đó. Lọc chọn DÒNG, KHÔNG cắt SỐ: 9 cột
    #: tiền của họ vẫn hiện đủ. Khoá lạ thì BỎ QUA, không ném 422 vào mặt người đang xem sổ.
    aging_bucket: str | None = Query(default=None),
    #: Tìm mã / tên đối tượng (không dấu) — lọc DÒNG như `aging_bucket`.
    q: str | None = Query(default=None, max_length=100),
    #: Hàng lọc nhanh: `all` · `con_no` · `qua_han` · `tra_truoc` (khoá lạ = tất cả).
    the: str | None = Query(default=None, max_length=20),
    page: int = Query(default=1, ge=1),
    #: Bỏ trống = trả hết dòng (người gọi cũ).
    size: int | None = Query(default=None, ge=1, le=200),
    #: `con_no` = còn nợ cuối kỳ giảm dần (dạng biểu đồ); bỏ trống = theo tên.
    sap_xep: str | None = Query(default=None, pattern="^(ten|con_no)$"),
) -> BaoCaoCongNoOut:
    _khoang_ngay(tu_ngay, den_ngay)
    bc = _loc_tim_so(
        _loc_ro(svc.bao_cao_phai_thu(tu_ngay=tu_ngay, den_ngay=den_ngay), aging_bucket), q
    )
    return BaoCaoCongNoOut(
        **bao_cao_cong_no.loc_the_va_cat_trang(bc, the=the, page=page, size=size, sap_xep=sap_xep)
    )


@router.get("/api/accounting/reports/payables", response_model=BaoCaoCongNoOut)
def bao_cao_tong_hop_phai_tra(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_BAO_CAO, "read"))],
    tu_ngay: date = Query(...),
    den_ngay: date = Query(...),
    #: Khoá rổ tuổi — chỉ giữ đối tượng còn tiền trong rổ đó. Lọc chọn DÒNG, KHÔNG cắt SỐ: 9 cột
    #: tiền của họ vẫn hiện đủ. Khoá lạ thì BỎ QUA, không ném 422 vào mặt người đang xem sổ.
    aging_bucket: str | None = Query(default=None),
    #: Tìm mã / tên đối tượng (không dấu) — lọc DÒNG như `aging_bucket`.
    q: str | None = Query(default=None, max_length=100),
    #: Hàng lọc nhanh: `all` · `con_no` · `qua_han` · `tra_truoc` (khoá lạ = tất cả).
    the: str | None = Query(default=None, max_length=20),
    page: int = Query(default=1, ge=1),
    #: Bỏ trống = trả hết dòng (người gọi cũ).
    size: int | None = Query(default=None, ge=1, le=200),
    #: `con_no` = còn nợ cuối kỳ giảm dần (dạng biểu đồ); bỏ trống = theo tên.
    sap_xep: str | None = Query(default=None, pattern="^(ten|con_no)$"),
) -> BaoCaoCongNoOut:
    _khoang_ngay(tu_ngay, den_ngay)
    bc = _loc_tim_so(
        _loc_ro(svc.bao_cao_phai_tra(tu_ngay=tu_ngay, den_ngay=den_ngay), aging_bucket), q
    )
    return BaoCaoCongNoOut(
        **bao_cao_cong_no.loc_the_va_cat_trang(bc, the=the, page=page, size=size, sap_xep=sap_xep)
    )


# SỔ CHI TIẾT của MỘT đối tượng (PRD §5.1) — mở ra khi bấm một dòng ở sổ tổng hợp.
# `doi_tuong_id` BỎ TRỐNG = dòng gom "không gắn đối tượng" (§❸), không phải "lấy tất cả".
@router.get("/api/accounting/reports/receivables/so-chi-tiet", response_model=SoChiTietCongNoOut)
def so_chi_tiet_phai_thu(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_BAO_CAO, "read"))],
    tu_ngay: date = Query(...),
    den_ngay: date = Query(...),
    doi_tuong_id: int | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    #: Gửi `size` ⇒ một trang, mới nhất lên đầu (xem `cat_trang_so_chi_tiet`).
    size: int | None = Query(default=None, ge=1, le=200),
) -> SoChiTietCongNoOut:
    _khoang_ngay(tu_ngay, den_ngay)
    return SoChiTietCongNoOut(
        **bao_cao_cong_no.cat_trang_so_chi_tiet(
            svc.so_chi_tiet_phai_thu(doi_tuong_id=doi_tuong_id, tu_ngay=tu_ngay, den_ngay=den_ngay),
            page=page,
            size=size,
        )
    )


@router.get("/api/accounting/reports/receivables/khoan-con-no", response_model=KhoanConNoListOut)
def khoan_con_no_phai_thu(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_BAO_CAO, "read"))],
    tu_ngay: date = Query(...),
    den_ngay: date = Query(...),
    doi_tuong_id: int | None = Query(default=None),
) -> KhoanConNoListOut:
    """Hoá đơn bán còn nợ của một khách TẠI ngày cuối kỳ — giải thích các cột tuổi nợ của dòng."""
    _khoang_ngay(tu_ngay, den_ngay)
    return KhoanConNoListOut(
        **svc.khoan_con_no_phai_thu(doi_tuong_id=doi_tuong_id, den_ngay=den_ngay)
    )


@router.get("/api/accounting/reports/payables/khoan-con-no", response_model=KhoanConNoListOut)
def khoan_con_no_phai_tra(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_BAO_CAO, "read"))],
    tu_ngay: date = Query(...),
    den_ngay: date = Query(...),
    doi_tuong_id: int | None = Query(default=None),
) -> KhoanConNoListOut:
    """Đợt giao còn nợ của một NCC TẠI ngày cuối kỳ — giải thích các cột tuổi nợ của dòng."""
    _khoang_ngay(tu_ngay, den_ngay)
    return KhoanConNoListOut(
        **svc.khoan_con_no_phai_tra(doi_tuong_id=doi_tuong_id, den_ngay=den_ngay)
    )


@router.get("/api/accounting/reports/payables/so-chi-tiet", response_model=SoChiTietCongNoOut)
def so_chi_tiet_phai_tra(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_BAO_CAO, "read"))],
    tu_ngay: date = Query(...),
    den_ngay: date = Query(...),
    doi_tuong_id: int | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    #: Gửi `size` ⇒ một trang, mới nhất lên đầu (xem `cat_trang_so_chi_tiet`).
    size: int | None = Query(default=None, ge=1, le=200),
) -> SoChiTietCongNoOut:
    _khoang_ngay(tu_ngay, den_ngay)
    return SoChiTietCongNoOut(
        **bao_cao_cong_no.cat_trang_so_chi_tiet(
            svc.so_chi_tiet_phai_tra(doi_tuong_id=doi_tuong_id, tu_ngay=tu_ngay, den_ngay=den_ngay),
            page=page,
            size=size,
        )
    )


@router.get("/api/accounting/reports/receivables.xlsx")
def bao_cao_tong_hop_phai_thu_xlsx(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_BAO_CAO, "read"))],
    tu_ngay: date = Query(...),
    den_ngay: date = Query(...),
) -> Response:
    _khoang_ngay(tu_ngay, den_ngay)
    bc = svc.bao_cao_phai_thu(tu_ngay=tu_ngay, den_ngay=den_ngay)
    return _tra_file(bc)



@router.get("/api/accounting/khoa-so", response_model=list[CongNoKhoaSoRow])
def get_cong_no_khoa_so_history(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(MODULE_BAO_CAO, "read"))],
    phan_he: str | None = Query(default=None),
) -> list[CongNoKhoaSoRow]:
    svc = CongNoKhoaSoService(db)
    return [CongNoKhoaSoRow(**r) for r in svc.history(phan_he=phan_he)]


@router.get("/api/accounting/khoa-so/ky", response_model=list[CongNoKyRow])
def get_cong_no_ky_list(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(MODULE_BAO_CAO, "read"))],
    #: `phai_thu` (TK 131) | `phai_tra` (TK 331). Bỏ trống = gộp cả hai — chỉ dùng cho màn lịch sử.
    #: Hai sổ ĐỘC LẬP: chốt sổ mua hàng không được đụng tới sổ bán hàng (sửa 04/09/2026).
    phan_he: str | None = Query(default=None),
) -> list[CongNoKyRow]:
    svc = CongNoKhoaSoService(db)
    return [CongNoKyRow(**r) for r in svc.list_ky(phan_he=phan_he)]


@router.get("/api/accounting/khoa-so/trang-thai", response_model=CongNoKhoaSoTrangThaiOut)
def get_cong_no_khoa_so_trang_thai(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(MODULE_BAO_CAO, "read"))],
    tu_ngay: date = Query(...),
    den_ngay: date = Query(...),
    #: `phai_thu` (131) | `phai_tra` (331). Bỏ trống = xét gộp cả hai.
    phan_he: str | None = Query(default=None),
) -> CongNoKhoaSoTrangThaiOut:
    """Khoảng `[tu_ngay, den_ngay]` đang khóa trọn / khóa một phần / chưa khóa?

    Có cửa này thì màn báo cáo hỏi thẳng đúng kỳ NÓ đang xem, thay vì dò trong danh sách kỳ tháng
    rồi so bằng đúng hai đầu ngày — cách cũ không bao giờ khớp với kỳ lẻ (sửa 04/09/2026).
    """
    _khoang_ngay(tu_ngay, den_ngay)
    svc = CongNoKhoaSoService(db)
    tron, mot_phan = svc.repo.khoa_ca_khoang(tu_ngay, den_ngay, phan_he)
    return CongNoKhoaSoTrangThaiOut(
        tu_ngay=tu_ngay, den_ngay=den_ngay, da_khoa=tron, khoa_mot_phan=mot_phan
    )


@router.post("/api/accounting/khoa-so", response_model=CongNoKhoaSoRow, status_code=status.HTTP_201_CREATED)
def set_cong_no_khoa_so(
    payload: CongNoKhoaSoIn,
    db: Annotated[Session, Depends(get_db)],
    acct_svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_BAO_CAO, "update"))],
) -> CongNoKhoaSoRow:
    svc = CongNoKhoaSoService(db, acct_svc=acct_svc)
    if payload.hanh_dong == "khoa":
        try:
            log = svc.chot_ky(
                phan_he=payload.phan_he,
                tu_ngay=payload.tu_ngay,
                den_ngay=payload.den_ngay,
                ten=payload.ten,
                user_id=user.id,
            )
        except CongNoKhoaSoError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            ) from exc
    else:
        try:
            log = svc.mo_ky(
                phan_he=payload.phan_he,
                tu_ngay=payload.tu_ngay,
                den_ngay=payload.den_ngay,
                user_id=user.id,
            )
        except CongNoKhoaSoError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            ) from exc
    return CongNoKhoaSoRow(
        id=log.id,
        phan_he=log.phan_he,
        tu_ngay=log.tu_ngay,
        den_ngay=log.den_ngay,
        hanh_dong=log.hanh_dong,
        nguoi_khoa_ten=user.name,
        khoa_luc=log.khoa_luc,
        ten=log.ten,
    )


@router.get("/api/accounting/reports/payables.xlsx")
def bao_cao_tong_hop_phai_tra_xlsx(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_BAO_CAO, "read"))],
    tu_ngay: date = Query(...),
    den_ngay: date = Query(...),
) -> Response:
    _khoang_ngay(tu_ngay, den_ngay)
    bc = svc.bao_cao_phai_tra(tu_ngay=tu_ngay, den_ngay=den_ngay)
    return _tra_file(bc)


# Sổ CHI TIẾT của mọi đối tượng trong kỳ, một file (24/09/2026): mỗi người một khối — đầu kỳ,
# từng chứng từ kèm TK đối ứng (Tiền mặt / tài khoản ngân hàng của phiếu thu–chi), dòng cộng.
@router.get("/api/accounting/reports/receivables-detail.xlsx")
def bao_cao_chi_tiet_phai_thu_xlsx(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_BAO_CAO, "read"))],
    tu_ngay: date = Query(...),
    den_ngay: date = Query(...),
    doi_tuong_id: int | None = Query(default=None),
    khong_gan: bool = Query(default=False),
) -> Response:
    _khoang_ngay(tu_ngay, den_ngay)
    return _tra_file_chi_tiet(svc.so_chi_tiet_tat_ca_phai_thu(
        tu_ngay=tu_ngay, den_ngay=den_ngay, loc=_loc_doi_tuong(doi_tuong_id, khong_gan)))


@router.get("/api/accounting/reports/payables-detail.xlsx")
def bao_cao_chi_tiet_phai_tra_xlsx(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_BAO_CAO, "read"))],
    tu_ngay: date = Query(...),
    den_ngay: date = Query(...),
    doi_tuong_id: int | None = Query(default=None),
    khong_gan: bool = Query(default=False),
) -> Response:
    _khoang_ngay(tu_ngay, den_ngay)
    return _tra_file_chi_tiet(svc.so_chi_tiet_tat_ca_phai_tra(
        tu_ngay=tu_ngay, den_ngay=den_ngay, loc=_loc_doi_tuong(doi_tuong_id, khong_gan)))


def _loc_doi_tuong(doi_tuong_id: int | None, khong_gan: bool):
    """Không truyền gì = MỌI đối tượng. `doi_tuong_id` = đúng một người. `khong_gan=true` = chỉ dòng
    gom "không gắn đối tượng" (id thật của nó là None nên phải có cờ riêng)."""
    if khong_gan:
        return None
    if doi_tuong_id is not None:
        return doi_tuong_id
    return bao_cao_cong_no.TAT_CA


def _tra_file_chi_tiet(bao_cao: dict) -> Response:
    return Response(
        content=bao_cao_cong_no_excel.xuat_xlsx_chi_tiet(bao_cao),
        media_type=bao_cao_cong_no_excel.MEDIA_XLSX,
        headers={
            "Content-Disposition":
                f'attachment; filename="{bao_cao_cong_no_excel.ten_file_chi_tiet(bao_cao)}"'
        },
    )


def _tra_file(bao_cao: dict) -> Response:
    return Response(
        content=bao_cao_cong_no_excel.xuat_xlsx(bao_cao),
        media_type=bao_cao_cong_no_excel.MEDIA_XLSX,
        headers={
            "Content-Disposition":
                f'attachment; filename="{bao_cao_cong_no_excel.ten_file(bao_cao)}"'
        },
    )


@router.get("/api/accounting/sales-invoices", response_model=SalesInvoiceListOut)
def list_sales_invoices(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[
        User,
        Depends(
            require_any_permission(
                (MODULE_PT, "read"),
                (MODULE_CN_THU, "read"),
                ("don_hang_ban", "read"),
            )
        ),
    ],
    authz: Annotated[AuthorizationService, Depends(get_authorization_service)],
    orders: Annotated[OrderService, Depends(get_order_service)],
    order_id: int = Query(gt=0),
) -> SalesInvoiceListOut:
    if not (
        authz.can(user, MODULE_PT, "read")
        or authz.can(user, MODULE_CN_THU, "read")
    ):
        try:
            orders.get(
                order_id=order_id,
                actor=user,
                scope=authz.scope_for(user, "don_hang_ban") or "own",
            )
        except (OrderNotFound, OrderForbidden):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy đơn hàng bán.",
            ) from None
    try:
        return SalesInvoiceListOut(**svc.list_order_sales_invoices(order_id))
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None


@router.post(
    "/api/accounting/sales-invoices",
    response_model=SalesInvoiceOut,
    status_code=status.HTTP_201_CREATED,
)
def create_sales_invoice(
    payload: SalesInvoiceIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PT, "create"))],
) -> SalesInvoiceOut:
    try:
        row = svc.create_sales_invoice(actor=user, **payload.model_dump())
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _notify_accounting_changed(
        row.get("order_code"),
        event_type="sales_invoice_created",
        invoice_id=row.get("id"),
        invoice_number=row.get("invoice_number"),
    )
    ban_hang_cho_thu_chi.bao_hang_cho(
        svc.repo.db, svc.repo, actor_id=user.id, order_id=row.get("order_id"),
        order_code=row.get("order_code"), hoa_don_moi=row.get("invoice_number"),
    )
    return SalesInvoiceOut(**row)


@router.post(
    "/api/accounting/sales-invoices/{invoice_id}/cancel",
    response_model=SalesInvoiceOut,
)
def cancel_sales_invoice(
    invoice_id: int,
    payload: CancelSalesInvoiceIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PT, "cancel"))],
) -> SalesInvoiceOut:
    try:
        row = svc.cancel_sales_invoice(invoice_id, actor=user, reason=payload.reason)
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _notify_accounting_changed(
        row.get("order_code"),
        event_type="sales_invoice_cancelled",
        invoice_id=row.get("id"),
        invoice_number=row.get("invoice_number"),
    )
    ban_hang_cho_thu_chi.bao_hang_cho(
        svc.repo.db, svc.repo, actor_id=user.id, order_id=row.get("order_id"),
        order_code=row.get("order_code"),
    )
    return SalesInvoiceOut(**row)


@router.post(
    "/api/accounting/sales-invoices/{invoice_id}/dieu-chinh",
    response_model=DieuChinhOut,
    status_code=status.HTTP_201_CREATED,
)
def create_dieu_chinh(
    invoice_id: int,
    payload: DieuChinhIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PT, "create"))],
) -> DieuChinhOut:
    """Ghi nhận hóa đơn điều chỉnh giảm (hoàn tiền chiết khấu) — 18/10/2026."""
    try:
        row = svc.create_dieu_chinh(invoice_id, actor=user, **payload.model_dump())
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _thong_bao_dieu_chinh(svc, row, user, event_type="sales_invoice_adjusted")
    return DieuChinhOut(**row)


@router.post(
    "/api/accounting/sales-invoice-adjustments/{adj_id}/cancel",
    response_model=DieuChinhOut,
)
def cancel_dieu_chinh(
    adj_id: int,
    payload: CancelSalesInvoiceIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PT, "cancel"))],
) -> DieuChinhOut:
    try:
        row = svc.cancel_dieu_chinh(adj_id, actor=user, reason=payload.reason)
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _thong_bao_dieu_chinh(svc, row, user, event_type="sales_invoice_adjustment_cancelled")
    return DieuChinhOut(**row)


def _thong_bao_dieu_chinh(svc: AccountingService, row: dict, user: User, *, event_type: str) -> None:
    """Báo ngăn đơn + chấm đỏ Phiếu chi (nếu có tiền phải trả lại) sau khi ghi / hủy điều chỉnh."""
    order = svc.repo.get_sales_order(row["order_id"])
    ma = order.order_no if order else None
    _notify_accounting_changed(
        ma, event_type=event_type, invoice_id=row["sales_invoice_id"],
        invoice_number=f'{row["adj_symbol"]} {row["adj_number"]}',
    )
    ban_hang_cho_thu_chi.bao_hang_cho(
        svc.repo.db, svc.repo, actor_id=user.id, order_id=row["order_id"], order_code=ma,
    )


@router.get("/api/accounting/company-bank-accounts", response_model=list[CompanyBankAccountOut])
def list_company_bank_accounts(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_TKNH, "read"))],
    active_only: bool = Query(default=False),
    usage: str | None = Query(default=None),
    # Thanh lọc màn Tài khoản ngân hàng (06/10/2026): tên ngân hàng (khớp đúng) + trạng thái.
    ngan_hang: str | None = Query(default=None, max_length=200),
    trang_thai: str | None = Query(default=None, pattern="^(dang_dung|ngung)$"),
):
    try:
        return svc.list_company_accounts(
            active_only=active_only, usage=usage, ngan_hang=ngan_hang, trang_thai=trang_thai,
        )
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None


# Khai TRƯỚC mọi `/company-bank-accounts/{account_id}`.
@router.get("/api/accounting/company-bank-accounts/loc-ngan-hang", response_model=list[NganHangLocOut])
def loc_ngan_hang_tai_khoan(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_TKNH, "read"))],
):
    """Ô "Ngân hàng" của thanh lọc: các ngân hàng đang có tài khoản công ty, kèm số tài khoản."""
    return [NganHangLocOut(ten=t, so=n) for t, n in svc.dem_tai_khoan_theo_ngan_hang()]


# Khai TRƯỚC mọi `/company-bank-accounts/{account_id}` để "thong-ke" không bị nuốt làm account_id.
@router.get("/api/accounting/company-bank-accounts/thong-ke", response_model=list[TaiKhoanThongKeOut])
def thong_ke_tai_khoan(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_TKNH, "read"))],
    tu_ngay: date = Query(...),
    den_ngay: date = Query(...),
):
    _khoang_ngay(tu_ngay, den_ngay)
    return svc.thong_ke_tai_khoan(tu_ngay=tu_ngay, den_ngay=den_ngay)


@router.post(
    "/api/accounting/company-bank-accounts",
    response_model=CompanyBankAccountOut,
    status_code=status.HTTP_201_CREATED,
)
def create_company_bank_account(
    payload: CompanyBankAccountIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_TKNH, "update"))],
):
    try:
        return svc.create_company_account(actor=user, **payload.model_dump())
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None


@router.put("/api/accounting/company-bank-accounts/{account_id}", response_model=CompanyBankAccountOut)
def update_company_bank_account(
    account_id: int,
    payload: CompanyBankAccountIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_TKNH, "update"))],
):
    try:
        return svc.update_company_account(account_id, actor=user, **payload.model_dump())
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None


@router.patch("/api/accounting/company-bank-accounts/{account_id}/toggle-active", response_model=CompanyBankAccountOut)
def toggle_company_bank_account(
    account_id: int,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_TKNH, "update"))],
):
    try:
        return svc.toggle_company_account(account_id, actor=user)
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None


@router.get("/api/accounting/supplier-bank-accounts", response_model=list[SupplierBankAccountOut])
def list_supplier_bank_accounts(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[
        User,
        Depends(require_any_permission((MODULE_TKNH, "read"), ("nha_cung_cap", "read"))),
    ],
    supplier_id: int | None = Query(default=None),
    active_only: bool = Query(default=False),
):
    return svc.list_supplier_accounts(supplier_id=supplier_id, active_only=active_only)


@router.post(
    "/api/accounting/supplier-bank-accounts",
    response_model=SupplierBankAccountOut,
    status_code=status.HTTP_201_CREATED,
)
def create_supplier_bank_account(
    payload: SupplierBankAccountIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[
        User,
        Depends(require_any_permission((MODULE_TKNH, "update"), ("nha_cung_cap", "update"))),
    ],
):
    try:
        return svc.create_supplier_account(actor=user, **payload.model_dump())
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None


@router.put("/api/accounting/supplier-bank-accounts/{account_id}", response_model=SupplierBankAccountOut)
def update_supplier_bank_account(
    account_id: int,
    payload: SupplierBankAccountIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[
        User,
        Depends(require_any_permission((MODULE_TKNH, "update"), ("nha_cung_cap", "update"))),
    ],
):
    try:
        return svc.update_supplier_account(account_id, actor=user, **payload.model_dump())
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None


@router.patch("/api/accounting/supplier-bank-accounts/{account_id}/toggle-active", response_model=SupplierBankAccountOut)
def toggle_supplier_bank_account(
    account_id: int,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[
        User,
        Depends(require_any_permission((MODULE_TKNH, "update"), ("nha_cung_cap", "update"))),
    ],
):
    try:
        return svc.toggle_supplier_account(account_id, actor=user)
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None


@router.get("/api/accounting/payment-vouchers", response_model=PaymentVoucherListOut)
def list_payment_vouchers(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_PC, "read"))],
    q: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    source_type: str | None = Query(default=None),
    voucher_type: str | None = Query(default=None),
    supplier_id: int | None = Query(default=None),
    purchase_request_id: int | None = Query(default=None),
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    tien_tu: int | None = Query(default=None, ge=0),
    tien_den: int | None = Query(default=None, ge=0),
    hinh_thuc: str | None = Query(default=None, pattern="^(cash|bank_transfer)$"),
    nguon: list[str] = Query(default=[]),
    # Lọc theo mục thu chi — id mục; 0 = phiếu chưa phân loại.
    muc: list[int] = Query(default=[]),
    tai_khoan_id: int | None = Query(default=None),
    nguoi_lap_id: int | None = Query(default=None),
    # Ô "Người nhận" của bộ lọc nâng cao — tách khỏi `q` (xem `_dieu_kien_phieu_chi`).
    nhan: str | None = Query(default=None, max_length=200),
    # Kỳ `tu_ngay..den_ngay` tính theo mốc nào: `chi` = ngày chi (mặc định, các nơi gọi cũ), `tao` = ngày lập.
    moc: str = Query(default="chi", pattern="^(tao|chi)$"),
    dem_only: bool = Query(default=False),
    sort: str = Query(default="-created_at"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
):
    if tu_ngay and den_ngay:
        _khoang_ngay(tu_ngay, den_ngay)
    rows, total, totals = svc.list_vouchers(
        q=q,
        status=status_,
        source_type=source_type,
        voucher_type=voucher_type,
        supplier_id=supplier_id,
        purchase_request_id=purchase_request_id,
        tu_ngay=tu_ngay,
        den_ngay=den_ngay,
        tien_tu=tien_tu,
        tien_den=tien_den,
        hinh_thuc=hinh_thuc,
        nguon=nguon,
        muc=muc,
        tai_khoan_id=tai_khoan_id,
        nguoi_lap_id=nguoi_lap_id,
        nhan=nhan,
        moc=moc,
        dem_only=dem_only,
        sort=sort,
        page=page,
        size=size,
    )
    return PaymentVoucherListOut(items=rows, total=total, page=page, size=size, **totals)


@router.get("/api/accounting/gia-cong-cho-chi", response_model=list[GiaCongChoChiOut])
def gia_cong_cho_chi(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(MODULE_PC, "read"))],
):
    """Lần gia công ngoài đã chốt số, chưa có phiếu chi (spec gia công ngoài §5). Tiền gia
    công hiện cho mọi người xem được màn — chủ chốt 27/09/2026, KHÔNG gác `kho:view_cost`."""
    return gc_cho_chi.hang_cho_chi(db)


@router.get("/api/accounting/gia-cong-cho-chi/dem", response_model=GiaCongChoChiDemOut)
def gia_cong_cho_chi_dem(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(MODULE_PC, "read"))],
):
    return {"so": gc_cho_chi.dem_cho_chi(db)}


@router.get("/api/accounting/tra-lai-khach-cho-chi", response_model=list[TraLaiKhachChoChiOut])
def tra_lai_khach_cho_chi(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_PC, "read"))],
):
    """Đơn hết chỗ ghi hoá đơn (ghi đủ / đã huỷ) mà tiền khách đưa còn dư — việc lập phiếu chi trả
    lại khách (17/10/2026). Dòng tự rời khi phiếu chi trả lại đủ."""
    return ban_hang_cho_thu_chi.tien_cho_tra_lai(svc.repo)


@router.get("/api/accounting/don-hang-cho-thu", response_model=DonHangChoThuOut)
def don_hang_cho_thu(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_PT, "read"))],
):
    """Cọc đơn đã chốt chưa thu đủ + hoá đơn khách chưa trả hết (17/10/2026) — mục "Đơn hàng chờ
    thu" của màn Phiếu thu. Dòng tự rời khi phiếu thu đủ."""
    return {
        "coc": ban_hang_cho_thu_chi.coc_cho_thu(svc),
        "hoa_don": ban_hang_cho_thu_chi.hoa_don_cho_thu(svc),
    }


@router.get("/api/accounting/mua-hang-cho-chi", response_model=list[MuaHangChoChiOut])
def mua_hang_cho_chi(
    purchases: Annotated[PurchaseService, Depends(get_purchase_service)],
    _: Annotated[User, Depends(require_permission(MODULE_PC, "read"))],
    q: str | None = Query(default=None),
    supplier_id: int | None = Query(default=None),
):
    """Tab "Mua hàng chờ chi" của màn Phiếu chi (docs/prd-mua-hang-cho-chi-o-phieu-chi.md): đơn đã
    duyệt còn cọc chưa chi hoặc còn đợt giao còn nợ — mỗi đơn một dòng. Lập phiếu vẫn đi
    `POST /api/accounting/payment-vouchers` như cũ."""
    return purchases.hang_cho_chi(q=q, supplier_id=supplier_id)


@router.get("/api/accounting/payment-vouchers/{voucher_id}", response_model=PaymentVoucherOut)
def get_payment_voucher(
    voucher_id: int,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_PC, "read"))],
):
    try:
        return PaymentVoucherOut(**svc.get_voucher(voucher_id))
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None


@router.post(
    "/api/accounting/payment-vouchers",
    response_model=PaymentVoucherOut,
    status_code=status.HTTP_201_CREATED,
)
def create_payment_voucher(
    payload: PaymentVoucherIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    notifications: NotificationRepo,
    user: Annotated[User, Depends(require_permission(MODULE_PC, "create"))],
):
    try:
        row = svc.create_voucher(actor=user, **payload.model_dump())
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    purchase_code = row.get("purchase_request_code")
    _notify_accounting_changed(
        purchase_code or row.get("code"),
        event_type="payment_voucher_created" if purchase_code else "accounting_changed",
        voucher_code=row.get("code"),
        notifications=notifications if purchase_code else None,
        channel=CHANNEL_THU_MUA if purchase_code else None,
        actor_user_id=user.id,
        recipient_user_id=row.get("purchase_created_by_user_id"),
    )
    if row.get("source_type") == "gia_cong_ngoai":
        # Hàng "Gia công chờ chi" + badge Phiếu chi + khối Gia công ngoài trên lệnh đổi ngay.
        # `lsx_id` để FE nạp lại đúng khối trên màn lệnh (Task 13 bắt cả hai khoá).
        _phat_gia_cong_chi_doi(svc, row.get("gia_cong_ngoai_id"))
    return PaymentVoucherOut(**row)


@router.post(
    "/api/accounting/payment-vouchers/gop",
    response_model=PaymentVoucherOut,
    status_code=status.HTTP_201_CREATED,
)
def create_payment_voucher_gop(
    payload: PhieuChiGopIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    notifications: NotificationRepo,
    user: Annotated[User, Depends(require_permission(MODULE_PC, "create"))],
) -> PaymentVoucherOut:
    """MỘT phiếu chi trả NHIỀU khoản (cọc, đợt giao, nhiều đơn) của CÙNG một NCC — 17/10/2026."""
    body = payload.model_dump()
    lines = body.pop("lines")
    try:
        row = svc.create_voucher_gop(actor=user, lines=lines, shared=body)
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _bao_cac_don_cua_phieu_chi(row, "payment_voucher_created", notifications, user.id)
    return PaymentVoucherOut(**row)


def _bao_cac_don_cua_phieu_chi(row: dict, event_type: str, notifications, actor_user_id: int) -> None:
    """Phiếu chi gộp đụng nhiều đơn mua ⇒ báo từng đơn (mỗi người lập đơn một lần)."""
    da_bao: set[str] = set()
    for dong in row.get("lines") or []:
        ma = dong.get("purchase_code")
        if not ma or ma in da_bao:
            continue
        da_bao.add(ma)
        _notify_accounting_changed(
            ma,
            event_type=event_type,
            voucher_code=row.get("code"),
            notifications=notifications,
            channel=CHANNEL_THU_MUA,
            actor_user_id=actor_user_id,
            recipient_user_id=dong.get("purchase_created_by_user_id"),
        )


@router.post(
    "/api/accounting/payment-vouchers/from-advances",
    response_model=VoucherBatchOut,
    status_code=status.HTTP_201_CREATED,
)
def create_payment_vouchers_from_advances(
    payload: VoucherFromAdvancesBatchIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PC, "create"))],
) -> VoucherBatchOut:
    """Chi MỘT LƯỢT cho nhiều phiếu tạm ứng / lương đợt 1 đã duyệt ⇒ MỘT phiếu chi cho cả lô
    (chủ chốt 25/09/2026). `vouchers` luôn có đúng một phần tử."""
    body = payload.model_dump()
    ids = body.pop("salary_advance_ids")
    try:
        rows = svc.create_vouchers_from_advances_batch(actor=user, salary_advance_ids=ids, shared=body)
    except AccountingBulkBlocked as exc:
        # Kèm id phiếu tạm ứng vướng để màn hình bỏ chọn đúng chúng rồi bấm lại.
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"message": str(exc), "vuong_ids": exc.vuong_ids}) from None
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    # Kèm tín hiệu tạm ứng để màn Tạm ứng của HCNS thấy "Đã chi" ngay (real-time).
    if rows:
        _notify_accounting_changed(rows[0].get("code"), voucher_code=rows[0].get("code"),
                                   actor_user_id=user.id)
        # Tạm ứng thuộc nhóm `nhan_su` — màn Lương (tab Tạm ứng) + các màn nhân sự cùng nhóm.
        hub.gui({"type": "advance_pending_changed", "code": rows[0].get("code")}, quyen=MAN_NHAN_SU)
    return VoucherBatchOut(
        vouchers=[PaymentVoucherOut(**r) for r in rows],
        total_amount=sum(int(r.get("amount_vnd") or 0) for r in rows),
    )


@router.get("/api/accounting/payment-vouchers/{voucher_id}/bang-ke-tam-ung",
            response_model=BangKeTamUngOut)
def bang_ke_tam_ung(
    voucher_id: int,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    departments: Annotated[DepartmentRepository, Depends(get_department_repository)],
    _: Annotated[User, Depends(require_permission(MODULE_PC, "read"))],
) -> BangKeTamUngOut:
    """Bảng kê đính kèm phiếu chi tạm ứng / lương đợt 1 (một lượt hay lẻ) — từng người, số tiền, tài
    khoản; tiền mặt thì FE in thêm cột ký nhận."""
    try:
        out = BangKeTamUngOut(**svc.bang_ke_tam_ung(voucher_id))
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    ten_to = {d.id: d.name for d in departments.list_all()}
    for r in out.rows:
        r.department_name = ten_to.get(r.department_id)
    return out


# ĐÃ GỠ 07/08/2026 — `PUT /api/accounting/payment-vouchers/{id}`. Phiếu chi phát hành ra là tiền
# đã rời két, không sửa. Sai thì huỷ rồi lập lại; chỉ còn đính kèm tài liệu là sửa được.


@router.post("/api/accounting/payment-vouchers/{voucher_id}/cancel", response_model=PaymentVoucherOut)
def cancel_payment_voucher(
    voucher_id: int,
    payload: CancelPaymentVoucherIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    notifications: NotificationRepo,
    user: Annotated[User, Depends(require_permission(MODULE_PC, "cancel"))],
):
    try:
        row = svc.cancel_voucher(voucher_id, actor=user, reason=payload.reason)
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    purchase_code = row.get("purchase_request_code")
    # Phiếu gộp: đầu phiếu không gắn đơn, mã đơn ở đầu chỉ là mã ghép ("PMH-A +2") ⇒ báo theo dòng.
    if len(row.get("lines") or []) > 1:
        _bao_cac_don_cua_phieu_chi(row, "payment_voucher_cancelled", notifications, user.id)
    else:
        _notify_accounting_changed(
            purchase_code or row.get("code"),
            event_type="payment_voucher_cancelled" if purchase_code else "accounting_changed",
            voucher_code=row.get("code"),
            notifications=notifications if purchase_code else None,
            channel=CHANNEL_THU_MUA if purchase_code else None,
            actor_user_id=user.id,
            recipient_user_id=row.get("purchase_created_by_user_id"),
        )
    if row.get("source_type") == "salary_advance":
        # Huỷ phiếu chi tạm ứng ⇒ cả lô về "Chờ chi" — màn Tạm ứng của HCNS phải thấy ngay.
        hub.gui({"type": "advance_pending_changed", "code": row.get("code")}, quyen=MAN_NHAN_SU)
    if row.get("source_type") == "gia_cong_ngoai":
        # Huỷ phiếu chi gia công ngoài ⇒ lần đó về lại "Chờ chi" ngay.
        _phat_gia_cong_chi_doi(svc, row.get("gia_cong_ngoai_id"))
    return PaymentVoucherOut(**row)


@router.get(
    "/api/accounting/payment-vouchers/{voucher_id}/attachments",
    response_model=PaymentVoucherAttachmentListOut,
)
def list_payment_voucher_attachments(
    voucher_id: int,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_PC, "read"))],
):
    try:
        items = svc.list_voucher_attachments(voucher_id)
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    return PaymentVoucherAttachmentListOut(
        items=[PaymentVoucherAttachmentOut(**item) for item in items]
    )


@router.post(
    "/api/accounting/payment-vouchers/{voucher_id}/attachments",
    response_model=PaymentVoucherAttachmentOut,
    status_code=status.HTTP_201_CREATED,
)
def upload_payment_voucher_attachment(
    voucher_id: int,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PC, "create"))],
    file: UploadFile = File(...),
):
    # Tệp rỗng để service báo bằng câu của nó.
    data = doc_gioi_han(file, MAX_ATTACHMENT_BYTES, cho_rong=True)
    try:
        row = svc.add_voucher_attachment(
            voucher_id,
            actor=user,
            file_name=file.filename,
            content_type=file.content_type,
            data=data,
        )
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _notify_accounting_changed()
    return PaymentVoucherAttachmentOut(**row)


@router.delete(
    "/api/accounting/payment-vouchers/{voucher_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_payment_voucher_attachment(
    voucher_id: int,
    attachment_id: int,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PC, "create"))],
) -> Response:
    try:
        svc.delete_voucher_attachment(voucher_id, attachment_id, actor=user)
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _notify_accounting_changed()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/api/accounting/payment-receipts", response_model=PaymentReceiptListOut)
def list_payment_receipts(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_PT, "read"))],
    q: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    payment_voucher_id: int | None = Query(default=None),
    source_type: str | None = Query(default=None),
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    tien_tu: int | None = Query(default=None, ge=0),
    tien_den: int | None = Query(default=None, ge=0),
    hinh_thuc: str | None = Query(default=None, pattern="^(cash|bank_transfer)$"),
    nguon: list[str] = Query(default=[]),
    # Lọc theo mục thu chi — id mục; 0 = phiếu chưa phân loại.
    muc: list[int] = Query(default=[]),
    tai_khoan_id: int | None = Query(default=None),
    nguoi_lap_id: int | None = Query(default=None),
    # Ô "Người nộp" của bộ lọc nâng cao — chỉ so tên người nộp, đi cùng `q` là AND.
    nhan: str | None = Query(default=None, max_length=200),
    # Kỳ tính theo mốc: `thu` = ngày thu (mặc định, các nơi gọi cũ), `tao` = ngày lập phiếu.
    moc: str = Query(default="thu", pattern="^(tao|thu)$"),
    dem_only: bool = Query(default=False),
    sort: str = Query(default="-created_at"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
):
    if tu_ngay and den_ngay:
        _khoang_ngay(tu_ngay, den_ngay)
    rows, total, extra = svc.list_receipts(
        q=q,
        status=status_,
        payment_voucher_id=payment_voucher_id,
        source_type=source_type,
        tu_ngay=tu_ngay,
        den_ngay=den_ngay,
        tien_tu=tien_tu,
        tien_den=tien_den,
        hinh_thuc=hinh_thuc,
        nguon=nguon,
        muc=muc,
        tai_khoan_id=tai_khoan_id,
        nguoi_lap_id=nguoi_lap_id,
        nhan=nhan,
        moc=moc,
        dem_only=dem_only,
        sort=sort,
        page=page,
        size=size,
    )
    return PaymentReceiptListOut(items=rows, total=total, page=page, size=size, **extra)


@router.get("/api/accounting/payment-receipts/{receipt_id}", response_model=PaymentReceiptOut)
def get_payment_receipt(
    receipt_id: int,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_PT, "read"))],
):
    try:
        return PaymentReceiptOut(**svc.get_receipt(receipt_id))
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None


@router.post(
    "/api/accounting/payment-receipts",
    response_model=PaymentReceiptOut,
    status_code=status.HTTP_201_CREATED,
)
def create_other_payment_receipt(
    payload: PaymentReceiptIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PT, "create"))],
):
    try:
        row = svc.create_other_receipt(actor=user, **payload.model_dump())
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _notify_accounting_changed(row.get("code"))
    return PaymentReceiptOut(**row)


@router.post(
    "/api/accounting/payables/{supplier_id}/refund-receipts",
    response_model=PaymentReceiptOut,
    status_code=status.HTTP_201_CREATED,
)
def create_supplier_refund_receipt(
    supplier_id: int,
    payload: PaymentReceiptIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PT, "create"))],
):
    """Nhà cung cấp hoàn tiền — nút ở ngăn Công nợ phải trả (12/10/2026)."""
    try:
        row = svc.create_supplier_refund_receipt(supplier_id, actor=user, **payload.model_dump())
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _notify_accounting_changed(row.get("code"))
    return PaymentReceiptOut(**row)


@router.post(
    "/api/accounting/sales-invoices/{invoice_id}/receipts",
    response_model=PaymentReceiptOut,
    status_code=status.HTTP_201_CREATED,
)
def create_sales_invoice_receipt(
    invoice_id: int,
    payload: PaymentReceiptIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PT, "create"))],
) -> PaymentReceiptOut:
    try:
        row = svc.create_sales_invoice_receipt(
            invoice_id, actor=user, **payload.model_dump()
        )
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _notify_accounting_changed(
        row.get("order_code") or row.get("code"),
        event_type="sales_invoice_receipt_created",
        invoice_id=row.get("sales_invoice_id"),
        receipt_code=row.get("code"),
    )
    return PaymentReceiptOut(**row)


@router.post(
    "/api/accounting/payment-receipts/gop",
    response_model=PaymentReceiptOut,
    status_code=status.HTTP_201_CREATED,
)
def create_payment_receipt_gop(
    payload: PhieuThuGopIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    orders: Annotated[OrderService, Depends(get_order_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PT, "create"))],
    db: Annotated[Session, Depends(get_db)],
) -> PaymentReceiptOut:
    """MỘT phiếu thu cho NHIỀU khoản (hoá đơn, cọc, nhiều đơn) của CÙNG một khách — 17/10/2026."""
    from .orders import _bao_xuong_sx, _order_changed

    body = payload.model_dump()
    lines = body.pop("lines")
    try:
        row = svc.create_receipt_gop(actor=user, lines=lines, shared=body)
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _bao_cac_don_cua_phieu_thu(row, "sales_invoice_receipt_created")
    # Dòng cọc = thu cọc thật: đủ cọc ⇒ báo Sale + tự xuống SX, đúng như thu cọc lẻ trên đơn.
    don_coc = [d["order_id"] for d in row.get("lines") or [] if d.get("sales_invoice_id") is None]
    for d, moi in orders.sau_thu_coc_ngoai(order_ids=don_coc, actor=user):
        if d.deposit_ok and d.sale_user_id:
            hub.publish(d.sale_user_id, {"type": "order_deposit_ok", "code": d.order_no})
            bao(db, kenh="don_hang_ban", loai="don_du_coc", actor_id=user.id,
                nguoi_nhan=d.sale_user_id, ma=d.order_no)
        _order_changed(d.order_no)
        if moi:
            _bao_xuong_sx(db, d, user)
    return PaymentReceiptOut(**row)


def _bao_cac_don_cua_phieu_thu(row: dict, event_type: str) -> None:
    """Phiếu thu đụng nhiều đơn bán ⇒ báo từng đơn; có dòng cọc ⇒ màn Đơn hàng bán tải lại."""
    da_bao: set[str] = set()
    for dong in row.get("lines") or []:
        ma = dong.get("order_code")
        if ma and ma not in da_bao:
            da_bao.add(ma)
            _notify_accounting_changed(
                ma, event_type=event_type, invoice_id=dong.get("sales_invoice_id"),
                receipt_code=row.get("code"),
            )
        if dong.get("sales_invoice_id") is None:
            hub.gui({"type": "order_pending_changed", "code": ma}, quyen=MAN_BAN_HANG)
    if not da_bao:
        _notify_accounting_changed(row.get("code"))


@router.get("/api/accounting/chi-tiet-khoan-thu", response_model=ChiTietKhoanThuOut)
def chi_tiet_khoan_thu(
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_PT, "read"))],
    invoice_id: int | None = None,
    order_id: int | None = None,
) -> ChiTietKhoanThuOut:
    try:
        return ChiTietKhoanThuOut(**svc.chi_tiet_khoan_thu(invoice_id=invoice_id, order_id=order_id))
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None


@router.post(
    "/api/accounting/payment-vouchers/{voucher_id}/receipts",
    response_model=PaymentReceiptOut,
    status_code=status.HTTP_201_CREATED,
)
def create_payment_receipt(
    voucher_id: int,
    payload: PaymentReceiptIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PT, "create"))],
):
    try:
        row = svc.create_receipt(voucher_id, actor=user, **payload.model_dump())
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _notify_accounting_changed(row.get("code"))
    return PaymentReceiptOut(**row)


@router.put("/api/accounting/payment-receipts/{receipt_id}", response_model=PaymentReceiptOut)
def update_payment_receipt(
    receipt_id: int,
    payload: PaymentReceiptIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PT, "create"))],
):
    try:
        row = svc.update_receipt(receipt_id, actor=user, **payload.model_dump())
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _notify_accounting_changed(row.get("code"))
    return PaymentReceiptOut(**row)


@router.post(
    "/api/accounting/payment-receipts/{receipt_id}/mark-received",
    response_model=PaymentReceiptOut,
)
def mark_payment_receipt_received(
    receipt_id: int,
    payload: MarkPaymentReceiptReceivedIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PT, "manage_status"))],
):
    try:
        row = svc.mark_receipt_received(
            receipt_id, actor=user, bank_reference=payload.bank_reference
        )
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _notify_accounting_changed(row.get("code"))
    return PaymentReceiptOut(**row)


@router.post("/api/accounting/payment-receipts/{receipt_id}/cancel", response_model=PaymentReceiptOut)
def cancel_payment_receipt(
    receipt_id: int,
    payload: CancelPaymentReceiptIn,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PT, "cancel"))],
):
    try:
        row = svc.cancel_receipt(receipt_id, actor=user, reason=payload.reason)
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    if len(row.get("lines") or []) > 1:
        # Phiếu gộp: báo từng đơn; có dòng cọc thì màn Đơn hàng bán / hàng chờ ghi cọc tự tải lại.
        _bao_cac_don_cua_phieu_thu(row, "accounting_changed")
    else:
        _notify_accounting_changed(row.get("code"))
        if row.get("source_type") == "order_deposit":
            # Huỷ cọc làm đơn bớt số đã cọc ⇒ màn Đơn hàng bán / hàng chờ ghi cọc tự tải lại.
            hub.gui({"type": "order_pending_changed", "code": row.get("order_code")}, quyen=MAN_BAN_HANG)
    return PaymentReceiptOut(**row)


@router.get(
    "/api/accounting/payment-receipts/{receipt_id}/attachments",
    response_model=PaymentReceiptAttachmentListOut,
)
def list_payment_receipt_attachments(
    receipt_id: int,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    _: Annotated[User, Depends(require_permission(MODULE_PT, "read"))],
):
    try:
        items = svc.list_receipt_attachments(receipt_id)
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    return PaymentReceiptAttachmentListOut(
        items=[PaymentReceiptAttachmentOut(**item) for item in items]
    )


@router.post(
    "/api/accounting/payment-receipts/{receipt_id}/attachments",
    response_model=PaymentReceiptAttachmentOut,
    status_code=status.HTTP_201_CREATED,
)
def upload_payment_receipt_attachment(
    receipt_id: int,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PT, "create"))],
    file: UploadFile = File(...),
):
    data = doc_gioi_han(file, MAX_ATTACHMENT_BYTES, cho_rong=True)
    try:
        row = svc.add_receipt_attachment(
            receipt_id,
            actor=user,
            file_name=file.filename,
            content_type=file.content_type,
            data=data,
        )
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _notify_accounting_changed()
    return PaymentReceiptAttachmentOut(**row)


@router.delete(
    "/api/accounting/payment-receipts/{receipt_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_payment_receipt_attachment(
    receipt_id: int,
    attachment_id: int,
    svc: Annotated[AccountingService, Depends(get_accounting_service)],
    user: Annotated[User, Depends(require_permission(MODULE_PT, "create"))],
) -> Response:
    try:
        svc.delete_receipt_attachment(receipt_id, attachment_id, actor=user)
    except (AccountingValidationError, AccountingConflict, AccountingNotFound) as exc:
        raise _map_error(exc) from None
    _notify_accounting_changed()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
