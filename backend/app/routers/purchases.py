"""Thu mua API — suppliers + purchase requests."""
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)

from ..deps import (
    CurrentUser,
    get_module_notification_repository,
    get_purchase_service,
    require_any_permission,
    require_permission,
    require_xem_kho_nao,
)
from ..models.purchase import LOAI_MUA
from ..models.user import User
from ..doi_tuong_nhan import MAN_KHVT, MAN_MUA_KE_TOAN, hop
from ..realtime import hub
from ..repositories.module_notification_repo import (
    CHANNEL_KE_TOAN,
    CHANNEL_THU_MUA,
    ModuleNotificationRepository,
)
from ..schemas.loc_danh_sach import LuaChonLoc
from ..schemas.purchase import (
    DepartmentPurchaseRequestIn,
    DepartmentPurchaseRequestListOut,
    YeuCauMonListOut,
    DepartmentPurchaseRequestOut,
    PurchaseContractIn,
    PurchaseDeliveryIn,
    PurchaseInvoiceAssignIn,
    PurchaseNotifySummaryOut,
    PurchaseRequestBatchIn,
    PurchaseRequestIn,
    LuaChonLocMa,
    PurchaseRequestListOut,
    PurchaseRequestOut,
    PurchaseSubmitIn,
    ReasonIn,
    ReceivedLinesIn,
    SupplierCreditOut,
    SupplierIn,
    SoGiaOut,
    SupplierItemCatalogOut,
    SupplierItemImportOut,
    SupplierListOut,
    SupplierTongQuanOut,
    SupplierRow,
)
from ..services.danh_gia_ncc import DanhGiaNcc
from ..services.purchase_service import (
    DEPARTMENT_REQUEST_READER_MODULES,
    MAX_PURCHASE_ATTACHMENT_BYTES,
    PurchaseConflict,
    # Bắt LỚP CHA `PurchaseError` ở mọi route: trước đây 14/18 chỗ chỉ liệt kê 3 loại lỗi và bỏ sót
    # `PurchaseForbidden`, nên mọi lỗi QUYỀN rơi ra ngoài thành **500** thay vì 403 — người dùng
    # thấy "lỗi hệ thống" trong khi thật ra là "bạn không được phép". `_map_error` vốn đã phân loại
    # đủ cả bốn, thiếu chỉ là ở chỗ `except`.
    PurchaseError,
    PurchaseForbidden,
    PurchaseNotFound,
    PurchaseService,
    PurchaseValidationError,
)
from ..tai_len import TRAN_EXCEL, doc_gioi_han

router = APIRouter(tags=["purchases"])
# TÁCH THEO MÀN (chủ chốt 10/08/2026, đường A). `MODULE` giữ nguyên khoá `thu_mua` nhưng nay chỉ
# còn nghĩa MÀN MUA HÀNG — đổi khoá là mọi hàng `role_permissions` cũ trỏ vào hư không.
# Migration 0177 sao chép quyền `thu_mua` cũ sang hai khoá mới nên không ai mất đường làm việc.
MODULE = "thu_mua"            # màn Mua hàng (phiếu mua)
MODULE_NCC = "nha_cung_cap"   # màn Nhà cung cấp
MODULE_YCMH = "yeu_cau_mua_hang"  # màn Yêu cầu mua hàng
MODULE_KE_TOAN = "ke_toan"    # màn Đơn mua hàng (Kế toán) — nơi DUYỆT / TỪ CHỐI PMH
# Cổng quyền đọc YCMH dựng từ CHÍNH danh sách mà service dùng để quyết định có co danh sách về
# phòng ban hay không — thêm/bớt một vai chỉ phải sửa một chỗ, không còn cảnh cấp quyền vào được
# màn nhưng lại bị lọc ra rỗng.
DEPARTMENT_REQUEST_READERS = tuple(
    (module, "read") for module in DEPARTMENT_REQUEST_READER_MODULES
)


NotificationRepo = Annotated[
    ModuleNotificationRepository, Depends(get_module_notification_repository)
]


def _notify_purchase_changed(
    code: str | None = None,
    *,
    event_type: str = "purchase_changed",
    notifications: ModuleNotificationRepository | None = None,
    channel: str | None = None,
    actor_user_id: int | None = None,
    recipient_user_id: int | None = None,
    **extra,
) -> None:
    """Tín hiệu nhẹ cho các màn Thu mua/Kế toán tự refetch qua SSE."""
    if notifications is not None and channel is not None:
        notifications.create(
            channel=channel,
            event_type=event_type,
            actor_user_id=actor_user_id,
            recipient_user_id=recipient_user_id,
            source_code=code,
        )
    # Nhóm `mua_ke_toan` (mọi màn Thu mua / Kế toán) + `khvt`: từ 07/10/2026 lưới Kế hoạch vật tư
    # bày BƯỚC của phiếu mua từng ô (lập yêu cầu, gửi duyệt, duyệt, đợt giao…), nên mọi sự kiện
    # mua đều làm ô đổi — và bản cache 45 giây của lưới phải bỏ ngay. Người đứng tên phiếu
    # (`recipient_user_id`) nhận đích danh kết quả duyệt / từ chối của phiếu mình.
    from ..services.can_doi_cache import xoa_cache_can_doi

    xoa_cache_can_doi()
    quyen = (MAN_MUA_KE_TOAN if event_type == "purchase_invoice_updated"
             else hop(MAN_MUA_KE_TOAN, MAN_KHVT))
    hub.gui({
        "type": event_type,
        "code": code,
        "actor_user_id": actor_user_id,
        "recipient_user_id": recipient_user_id,
        **extra,
    }, quyen=quyen, nguoi=[recipient_user_id] if recipient_user_id else None)


def _map_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PurchaseNotFound):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, PurchaseValidationError):
        return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    if isinstance(exc, PurchaseConflict):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, PurchaseForbidden):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("/api/department-purchase-requests", response_model=DepartmentPurchaseRequestListOut)
def list_department_purchase_requests(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    # CỬA HỞ ĐÃ ĐO ĐƯỢC 10/08/2026: trước đây chỉ đòi `CurrentUser` — vai TRỐNG TRƠN, không cấp một
    # ô quyền nào, vẫn đọc được toàn bộ yêu cầu mua hàng. Đây là màn DUY NHẤT của Thu mua bị hở
    # (7 endpoint còn lại đều chặn 403).
    #
    # Gác bằng `DEPARTMENT_REQUEST_READER_MODULES`: ô Xem của chính màn + `thu_mua` (màn Mua hàng
    # nạp ô chọn nguồn). Từ 28/09/2026 các phân hệ khác KHÔNG còn mượn đường đọc.
    user: Annotated[
        User,
        Depends(require_any_permission(
            *((m, "read") for m in DEPARTMENT_REQUEST_READER_MODULES)
        )),
    ],
    q: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    source_type: str | None = Query(default=None),
    # Thanh lọc chung (06/10/2026): kỳ theo `moc` = tao (Ngày tạo) | can (Ngày cần hàng) + ba điều
    # kiện Phòng ban, Người yêu cầu, Mặt hàng (`giay:12` = cặp `hang_loai:hang_id`).
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query(default="tao", pattern="^(tao|can)$"),
    phong_ban: int | None = Query(default=None),
    nguoi_yeu_cau: int | None = Query(default=None),
    mat_hang: str | None = Query(default=None, pattern=r"^[a-z_]+:\d+$"),
    # Mua cho (08/10/2026): lặp khoá, vd `?loai_mua=cho_lsx&loai_mua=mua_ton`.
    loai_mua: list[str] | None = Query(default=None),
    sort: str = Query(default="-created_at"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
) -> DepartmentPurchaseRequestListOut:
    _chan_khoang_nguoc(tu_ngay, den_ngay)
    loc = dict(
        loai_mua=_loai_mua(loai_mua),
        q=q,
        source_type=source_type,
        tu_ngay=tu_ngay,
        den_ngay=den_ngay,
        moc=moc,
        phong_ban_id=phong_ban,
        nguoi_yeu_cau_id=nguoi_yeu_cau,
        mat_hang=_cap_mat_hang(mat_hang),
    )
    rows, total = svc.list_department_requests(
        actor=user, status=status_, sort=sort, page=page, size=size, **loc
    )
    # Số trên tab trạng thái: cùng ô tìm, kỳ, điều kiện với bảng — chưa lọc trạng thái.
    dem = svc.dem_yeu_cau_theo_trang_thai(actor=user, **loc)
    return DepartmentPurchaseRequestListOut(
        items=rows, total=total, page=page, size=size, dem_theo_tab=dem
    )


@router.get("/api/department-purchase-requests/mon", response_model=YeuCauMonListOut)
def list_department_request_lines(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[
        User,
        Depends(require_any_permission(
            *((m, "read") for m in DEPARTMENT_REQUEST_READER_MODULES)
        )),
    ],
    q: str | None = Query(default=None),
    tinh_trang: str | None = Query(
        default=None,
        pattern="^(cho_lap|nhap|cho_duyet|tra_lai|cho_hang|mot_phan|du|nhap_kho|huy)$",
    ),
    source_type: str | None = Query(default=None),
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query(default="tao", pattern="^(tao|can)$"),
    phong_ban: int | None = Query(default=None),
    nguoi_yeu_cau: int | None = Query(default=None),
    mat_hang: str | None = Query(default=None, pattern=r"^[a-z_]+:\d+$"),
    loai_mua: list[str] | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
) -> YeuCauMonListOut:
    """Yêu cầu mua hàng, chế độ xem TỪNG MÓN (phương án 3, 07/10/2026): cùng bộ lọc và phạm vi nhìn
    với danh sách yêu cầu, mỗi món một dòng kèm đơn mua đang giữ nó và tiến độ."""
    _chan_khoang_nguoc(tu_ngay, den_ngay)
    return YeuCauMonListOut(
        **svc.danh_sach_mon(
            actor=user,
            q=q,
            tinh_trang=tinh_trang,
            page=page,
            size=size,
            source_type=source_type,
            tu_ngay=tu_ngay,
            den_ngay=den_ngay,
            moc=moc,
            phong_ban_id=phong_ban,
            nguoi_yeu_cau_id=nguoi_yeu_cau,
            mat_hang=_cap_mat_hang(mat_hang),
            loai_mua=_loai_mua(loai_mua),
        )
    )


def _loai_mua(raw: list[str] | None) -> list[str] | None:
    """Bộ lọc "Mua cho": bỏ trùng, chặn giá trị lạ (422) thay vì lọc ra rỗng im lặng."""
    if not raw:
        return None
    sai = [v for v in raw if v not in LOAI_MUA]
    if sai:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Loại mua không hợp lệ: " + ", ".join(sai) + ".",
        )
    return sorted(set(raw))


def _chan_khoang_nguoc(tu_ngay: date | None, den_ngay: date | None) -> None:
    if tu_ngay and den_ngay and tu_ngay > den_ngay:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Từ ngày phải trước hoặc bằng đến ngày.",
        )


def _cap_mat_hang(mat_hang: str | None) -> tuple[str, int] | None:
    """`giay:12` → ("giay", 12). Khuôn đã chặn ở Query nên tách thẳng."""
    if not mat_hang:
        return None
    loai, _, hid = mat_hang.partition(":")
    return loai, int(hid)


# Giá trị cho ba ô chọn của thanh lọc YCMH — đếm trong tầm nhìn của người xem. PHẢI khai trước
# `/{request_id}` (khớp theo thứ tự đăng ký; để sau là rơi vào route id và chết 422).
@router.get("/api/department-purchase-requests/loc-phong-ban", response_model=list[LuaChonLoc])
def loc_yeu_cau_phong_ban(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_any_permission(*DEPARTMENT_REQUEST_READERS))],
) -> list[LuaChonLoc]:
    return [
        LuaChonLoc(id=i, ten=t, so=n)
        for i, t, n in svc.lua_chon_loc_yeu_cau(actor=user, truong="phong_ban")
    ]


@router.get("/api/department-purchase-requests/loc-nguoi-yeu-cau", response_model=list[LuaChonLoc])
def loc_yeu_cau_nguoi(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_any_permission(*DEPARTMENT_REQUEST_READERS))],
) -> list[LuaChonLoc]:
    return [
        LuaChonLoc(id=i, ten=t, so=n)
        for i, t, n in svc.lua_chon_loc_yeu_cau(actor=user, truong="nguoi_yeu_cau")
    ]


@router.get("/api/department-purchase-requests/loc-mat-hang", response_model=list[LuaChonLocMa])
def loc_yeu_cau_mat_hang(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_any_permission(*DEPARTMENT_REQUEST_READERS))],
) -> list[LuaChonLocMa]:
    return [
        LuaChonLocMa(ma=f"{loai}:{hid}", ten=t, so=n)
        for loai, hid, t, n in svc.lua_chon_loc_yeu_cau(actor=user, truong="mat_hang")
    ]


@router.get("/api/department-purchase-requests/can-create")
def can_create_department_purchase_request(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: CurrentUser,
) -> dict[str, bool]:
    return {"can_create": svc.can_create_department_request(user)}


@router.get("/api/department-purchase-requests/{request_id}", response_model=DepartmentPurchaseRequestOut)
def get_department_purchase_request(
    request_id: int,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    # Cùng luật đọc với danh sách, KHÔNG phải mọi tài khoản đăng nhập.
    user: Annotated[
        User,
        Depends(require_any_permission(
            *((m, "read") for m in DEPARTMENT_REQUEST_READER_MODULES)
        )),
    ],
) -> DepartmentPurchaseRequestOut:
    try:
        return DepartmentPurchaseRequestOut(**svc.get_department_request(request_id, actor=user))
    except PurchaseError as exc:
        raise _map_error(exc) from None


@router.post(
    "/api/department-purchase-requests",
    response_model=DepartmentPurchaseRequestOut,
    status_code=status.HTTP_201_CREATED,
)
def create_department_purchase_request(
    payload: DepartmentPurchaseRequestIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    notifications: NotificationRepo,
    user: Annotated[User, Depends(require_permission(MODULE_YCMH, "create"))],
) -> DepartmentPurchaseRequestOut:
    try:
        row = svc.create_department_request(actor=user, **payload.model_dump())
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(
        row.get("code"),
        event_type="department_purchase_request_created",
        notifications=notifications,
        channel=CHANNEL_THU_MUA,
        actor_user_id=user.id,
    )
    return DepartmentPurchaseRequestOut(**row)


@router.put("/api/department-purchase-requests/{request_id}", response_model=DepartmentPurchaseRequestOut)
def update_department_purchase_request(
    request_id: int,
    payload: DepartmentPurchaseRequestIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE_YCMH, "update"))],
) -> DepartmentPurchaseRequestOut:
    try:
        row = svc.update_department_request(request_id, actor=user, **payload.model_dump())
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(row.get("code"))
    return DepartmentPurchaseRequestOut(**row)


@router.post("/api/department-purchase-requests/{request_id}/cancel", response_model=DepartmentPurchaseRequestOut)
def cancel_department_purchase_request(
    request_id: int,
    payload: ReasonIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE_YCMH, "update"))],
) -> DepartmentPurchaseRequestOut:
    try:
        row = svc.cancel_department_request(request_id, reason=payload.reason, actor=user)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(row.get("code"))
    return DepartmentPurchaseRequestOut(**row)


@router.post(
    "/api/department-purchase-requests/{request_id}/lines/{line_id}/cancel",
    response_model=DepartmentPurchaseRequestOut,
)
def cancel_department_purchase_request_line(
    request_id: int,
    line_id: int,
    payload: ReasonIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    # Cùng ô quyền với huỷ CẢ yêu cầu (`update`) — bỏ một món là phiên bản nhỏ hơn của cùng việc
    # đó, tách ô quyền riêng chỉ đẻ thêm thứ phải khai mà không đổi ai được làm gì.
    user: Annotated[User, Depends(require_permission(MODULE_YCMH, "update"))],
) -> DepartmentPurchaseRequestOut:
    try:
        row = svc.cancel_department_request_line(
            request_id, line_id, reason=payload.reason, actor=user
        )
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(row.get("code"))
    return DepartmentPurchaseRequestOut(**row)


def _dong_ncc(row, danh_gia: DanhGiaNcc, quy_doi: dict | None = None) -> SupplierRow:
    """Ghép hồ sơ NCC với SỔ ĐIỂM + QUY ĐỔI ĐƠN VỊ của họ thành một dòng trả về.

    Sao không phải cột của bảng `suppliers` (cố ý — không đẻ cột, không migration), nên phải ghép
    ở đây thay vì để pydantic tự đọc thuộc tính. Ghép một chỗ để bốn cửa (danh sách · tạo · sửa ·
    bật/tắt) không mỗi nơi trả một kiểu.

    `quy_doi` = `{supplier_item_id: {he_so_ve_goc, gia_quy_doi}}` từ `PurchaseService
    .quy_doi_bang_gia`. Bỏ trống thì hai trường đó để None — dòng vẫn hợp lệ, chỉ là màn hình
    không so giá được.
    """
    ra = SupplierRow.model_validate(row).model_copy(
        update={
            "rating": danh_gia.rating,
            "rating_count": danh_gia.rating_count,
            "on_time_count": danh_gia.on_time_count,
            "late_count": danh_gia.late_count,
            "avg_late_days": danh_gia.avg_late_days,
        }
    )
    if quy_doi:
        for it in ra.items:
            qd = quy_doi.get(it.id)
            if qd:
                it.he_so_ve_goc = qd["he_so_ve_goc"]
                it.gia_quy_doi = qd["gia_quy_doi"]
                it.don_vi_goc = qd.get("don_vi_goc") or ""
    return ra


@router.get("/api/suppliers/tong-quan", response_model=SupplierTongQuanOut)
def supplier_tong_quan(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    _: Annotated[User, Depends(require_permission(MODULE_NCC, "read"))],
) -> SupplierTongQuanOut:
    """Thanh đếm + dải lọc nhóm của màn Nhà cung cấp — đếm ở máy chủ cho TOÀN danh mục.

    Trước 27/09/2026 màn này gọi thêm hai lượt danh sách `size=500` (đang hợp tác + tạm ngừng) chỉ
    để đếm — vượt trần `size ≤ 200` nên bị 422 và lặng lẽ rơi về đếm trên trang hiện tại."""
    return SupplierTongQuanOut(**svc.tong_quan_ncc())


@router.get("/api/suppliers", response_model=SupplierListOut)
def list_suppliers(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    _: Annotated[
        User,
        # ⚠️ NGƯỜI MUA HÀNG PHẢI ĐỌC ĐƯỢC DANH SÁCH NÀY (chủ chốt 12/08/2026): xử lý một yêu cầu
        # mua hàng là phải CHỌN nhà cung cấp, mà ô chọn lấy dữ liệu từ chính endpoint này. Bắt cấp
        # thêm ô "Nhà cung cấp" chỉ để gợi ý được tên NCC là cấp thừa quyền — ô đó cho SỬA danh
        # mục, còn ở đây chỉ cần ĐỌC.
        # Cùng lối với ngoại lệ `ke_toan` đã có sẵn: kế toán cũng chỉ đọc để đối chiếu phiếu chi.
        Depends(require_any_permission((MODULE_NCC, "read"), ("ke_toan", "read"),
                                       (MODULE, "read"), ("yeu_cau_mua_hang", "read"))),
    ],
    q: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    supplier_group: str | None = Query(default=None),
    # Lọc theo SAO — chỉ lấy NCC có trung bình ≥ mức này. NCC "Chưa đánh giá" rơi ra khỏi kết quả,
    # đúng ý: hỏi "≥4 sao" là đang hỏi ai ĐÃ chứng minh được, không phải ai chưa bị chê.
    rating_min: float | None = Query(default=None, ge=1, le=5),
    # Thanh lọc chung (06/10/2026): cờ "Nhận gia công" + kỳ theo Ngày tạo (mốc duy nhất `tao`).
    nhan_gia_cong: bool | None = Query(default=None),
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query(default="tao", pattern="^tao$"),
    # Mặc định MỚI NHẤT TRƯỚC (chủ chốt 12/08/2026) — NCC vừa khai xong phải thấy ngay,
    # đừng bắt người ta đi tìm chính thứ mình vừa tạo. Đổi ở đây thôi là chưa đủ nếu giao
    # diện tự truyền `sort=name` — đã soi, màn Nhà cung cấp không truyền tham số này.
    # `sort=rating` / `-rating` xếp theo sao; NCC chưa đánh giá luôn nằm CUỐI ở cả hai chiều.
    sort: str = Query(default="-created_at"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
) -> SupplierListOut:
    rows, total = svc.list_suppliers(
        q=q,
        status=status_,
        supplier_group=supplier_group,
        rating_min=rating_min,
        nhan_gia_cong=nhan_gia_cong,
        tu_ngay=tu_ngay,
        den_ngay=den_ngay,
        sort=sort,
        page=page,
        size=size,
    )
    quy_doi = svc.quy_doi_bang_gia([row for row, _ in rows])
    return SupplierListOut(
        items=[_dong_ncc(row, danh_gia, quy_doi) for row, danh_gia in rows],
        total=total,
        page=page,
        size=size,
    )


@router.get("/api/suppliers/{supplier_id}", response_model=SupplierRow)
def get_supplier(
    supplier_id: int,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    _: Annotated[User, Depends(require_permission(MODULE_NCC, "read"))],
) -> SupplierRow:
    """Một NCC theo mã — cho nút "Hồ sơ nhà cung cấp" ở màn khác mở thẳng hồ sơ của đúng NCC đó
    (06/10/2026). Cùng ô quyền với màn Nhà cung cấp: không xem được màn thì không mở được hồ sơ."""
    try:
        row = svc.get_supplier(supplier_id)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    return _dong_ncc(row, svc.danh_gia_ncc(row.id), svc.quy_doi_bang_gia([row]))


@router.get("/api/supplier-items/catalog", response_model=SupplierItemCatalogOut)
def supplier_item_catalog(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    _: CurrentUser,
) -> SupplierItemCatalogOut:
    return SupplierItemCatalogOut(items=svc.list_supplier_item_catalog())


@router.get("/api/supplier-items/so-gia", response_model=SoGiaOut)
def so_gia_ncc(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    # Báo giá NCC là GIÁ → chỉ vai được XEM GIÁ (mua hàng · NCC · kế toán · KHO có `view_cost`) mới
    # xem. Ẩn ở SERVER, không chỉ ẩn UI: thủ kho không có `view_cost` gọi thẳng cũng bị chặn. Bảng
    # này nằm trong màn tồn của TỪNG KHO ⇒ ô "Xem giá thành" của dòng kho nào cũng mở (05/10/2026).
    _: Annotated[User, Depends(require_xem_kho_nao(
        (MODULE, "read"), (MODULE_NCC, "read"), ("ke_toan", "read"), ("kho", "view_cost"),
        viec="view_cost"))],
    hang_loai: str = Query(..., pattern="^(giay|vat_tu)$"),
    hang_id: int = Query(..., gt=0),
    # ĐVT của dòng đang mua (10/10/2026, thay `dang`) — dòng giá cùng HỌ đơn vị xếp trước
    # (`cung_ho`). Giấy có khổ ⇒ chỉ so dòng giá ĐÚNG khổ đó.
    don_vi: str | None = Query(default=None, max_length=32),
    kho_rong: int = Query(default=0, ge=0),
    kho_dai: int = Query(default=0, ge=0),
) -> SoGiaOut:
    """Các NCC bán mặt hàng này, GIÁ QUY VỀ ĐƠN VỊ GỐC để so ngang.

    "1.020.000 đ/ram" và "24.500 đ/kg" không so trực tiếp được — quy về cùng đơn vị mới biết ai
    rẻ. Dòng không quy đổi được vẫn hiện (NCC đó có bán thật) nhưng xếp cuối kèm lý do.
    """
    try:
        return SoGiaOut(**svc.so_gia_ncc(hang_loai, hang_id, don_vi=don_vi,
                                         kho_rong=kho_rong, kho_dai=kho_dai))
    except VatLieuKhoError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from None

def _xlsx_response(data: bytes, filename: str) -> Response:
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# Mẫu + xuất dùng quyền ĐỌC, nhập dùng quyền SỬA: hai file kia chỉ bày lại đúng thứ người ta đã
# nhìn thấy trên màn, còn nhập là thay bảng giá của NCC.
@router.get("/api/suppliers/items/template.xlsx")
def supplier_items_template(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    _: Annotated[User, Depends(require_permission(MODULE_NCC, "read"))],
) -> Response:
    return _xlsx_response(svc.mau_vat_tu_xlsx(), "mau-vat-tu-nha-cung-cap.xlsx")


@router.get("/api/suppliers/{supplier_id}/items/export.xlsx")
def supplier_items_export(
    supplier_id: int,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    _: Annotated[User, Depends(require_permission(MODULE_NCC, "read"))],
) -> Response:
    try:
        data, filename = svc.xuat_vat_tu_xlsx(supplier_id)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    return _xlsx_response(data, filename)


@router.post("/api/suppliers/items/import", response_model=SupplierItemImportOut)
def supplier_items_import(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    _: Annotated[User, Depends(require_permission(MODULE_NCC, "update"))],
    file: UploadFile = File(...),
) -> SupplierItemImportOut:
    """ĐỌC file .xlsx → trả danh sách mặt hàng + lỗi từng dòng. KHÔNG ghi DB.

    Không nhận `supplier_id`: bảng giá được lưu bằng cú `PUT /api/suppliers/{id}` của form, nên
    ghi ở đây là đẻ đường ghi thứ hai — và NCC chưa lưu (đang tạo mới) thì cũng chưa có id để mà
    nhập vào.

    `def` (không `async`): parse xlsx là việc CPU đồng bộ — chạy trong threadpool, đừng chặn event
    loop của cả máy chủ."""
    data = doc_gioi_han(file, TRAN_EXCEL, loi_rong="File rỗng.")
    try:
        ket_qua = svc.doc_vat_tu_xlsx(data)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    return SupplierItemImportOut(**ket_qua)

@router.post("/api/suppliers", response_model=SupplierRow, status_code=status.HTTP_201_CREATED)
def create_supplier(
    payload: SupplierIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE_NCC, "create"))],
) -> SupplierRow:
    try:
        row = svc.create_supplier(actor=user, **payload.model_dump())
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed()
    return _dong_ncc(row, svc.danh_gia_ncc(row.id), svc.quy_doi_bang_gia([row]))


@router.put("/api/suppliers/{supplier_id}", response_model=SupplierRow)
def update_supplier(
    supplier_id: int,
    payload: SupplierIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE_NCC, "update"))],
) -> SupplierRow:
    try:
        row = svc.update_supplier(supplier_id, actor=user, **payload.model_dump())
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed()
    return _dong_ncc(row, svc.danh_gia_ncc(row.id), svc.quy_doi_bang_gia([row]))


@router.patch("/api/suppliers/{supplier_id}/toggle-active", response_model=SupplierRow)
def toggle_supplier(
    supplier_id: int,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE_NCC, "update"))],
) -> SupplierRow:
    try:
        row = svc.toggle_supplier_active(supplier_id, actor=user)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed()
    return _dong_ncc(row, svc.danh_gia_ncc(row.id), svc.quy_doi_bang_gia([row]))


@router.get("/api/purchase-requests", response_model=PurchaseRequestListOut)
def list_purchase_requests(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[
        User,
        Depends(require_any_permission((MODULE, "read"), ("ke_toan", "read"))),
    ],
    q: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    supplier_id: int | None = Query(default=None),
    # Thanh lọc chung (06/10/2026) thay bộ `created_from/to`, `needed_from/to`,
    # `expected_receipt_from/to` cũ: kỳ theo `moc` = tao (Ngày tạo) | can (Ngày cần) | nhan (Ngày dự
    # kiến nhận); `tong_tu/tong_den` = khoảng Tổng dự kiến (đồng).
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query(default="tao", pattern="^(tao|can|nhan)$"),
    deposit_status: str | None = Query(default=None, pattern="^(none|unpaid|partial|enough)$"),
    # Nhóm TIỀN (phương án 3): chua_tra | mot_phan | qua_han | da_tra — độc lập với `status` (Hàng).
    tien: str | None = Query(default=None, pattern="^(chua_tra|mot_phan|qua_han|da_tra)$"),
    tong_tu: int | None = Query(default=None, ge=0),
    tong_den: int | None = Query(default=None, ge=0),
    loai_mua: list[str] | None = Query(default=None),
    # Ba vai người trên đơn (10/10/2026): NV yêu cầu / NV mua hàng (người lập) / NV duyệt.
    nv_yc_id: int | None = Query(default=None),
    nv_mua_id: int | None = Query(default=None),
    nv_duyet_id: int | None = Query(default=None),
    sort: str = Query(default="-created_at"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
) -> PurchaseRequestListOut:
    _chan_khoang_nguoc(tu_ngay, den_ngay)
    if tong_tu is not None and tong_den is not None and tong_tu > tong_den:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tổng tiền từ phải nhỏ hơn hoặc bằng tổng tiền đến.",
        )
    loc = dict(
        q=q,
        supplier_id=supplier_id,
        tu_ngay=tu_ngay,
        den_ngay=den_ngay,
        moc=moc,
        deposit_status=deposit_status,
        tong_tu=tong_tu,
        tong_den=tong_den,
        loai_mua=_loai_mua(loai_mua),
        nv_yc_id=nv_yc_id,
        nv_mua_id=nv_mua_id,
        nv_duyet_id=nv_duyet_id,
    )
    try:
        rows, total, dem, dem_tien = svc.danh_sach_don(
            status=status_, tien=tien, sort=sort, page=page, size=size, actor=user, **loc
        )
    except PurchaseValidationError as exc:
        raise _map_error(exc) from None
    return PurchaseRequestListOut(
        items=rows, total=total, page=page, size=size, dem_theo_tab=dem, dem_theo_tien=dem_tien
    )


@router.get("/api/purchase-requests/loc-ncc", response_model=list[LuaChonLoc])
def purchase_requests_loc_ncc(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> list[LuaChonLoc]:
    """Ô "Nhà cung cấp" của thanh lọc Đơn mua hàng: NCC đang có đơn trong tầm nhìn, kèm số đơn.
    ⚠️ Khai TRƯỚC `/{request_id}`."""
    return [LuaChonLoc(id=i, ten=t, so=n) for i, t, n in svc.dem_theo_ncc(actor=user)]


@router.get("/api/purchase-requests/loc-nguoi", response_model=list[LuaChonLoc])
def purchase_requests_loc_nguoi(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    vai: str = Query(pattern="^(yc|mua|duyet)$"),
) -> list[LuaChonLoc]:
    """Ô NV yêu cầu / NV mua hàng / NV duyệt của thanh lọc Đơn mua hàng: người có đơn trong tầm
    nhìn ở vai đó, kèm số đơn. ⚠️ Khai TRƯỚC `/{request_id}`."""
    return [LuaChonLoc(id=i, ten=t, so=n) for i, t, n in svc.dem_theo_nguoi(vai, actor=user)]


@router.get("/api/purchase-requests/notify-summary", response_model=PurchaseNotifySummaryOut)
def purchase_notify_summary(
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> PurchaseNotifySummaryOut:
    """Badge Thu mua trên sidebar — ba con số việc-phải-làm, đã lọc theo phạm vi người gọi.

    ⚠️ PHẢI khai TRƯỚC `/{request_id}`: FastAPI khớp route theo thứ tự đăng ký, để sau thì
    "notify-summary" rơi vào `{request_id}` và chết 422 vì không ép được về int.

    Rẻ: hai con số YCMH/PMH là COUNT ở DB. Con số công nợ chỉ chạy cho người có `ke_toan:read`
    (xem `notify_summary`)."""
    return PurchaseNotifySummaryOut(**svc.notify_summary(actor=user))


@router.get("/api/purchase-requests/{request_id}", response_model=PurchaseRequestOut)
def get_purchase_request(
    request_id: int,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[
        User,
        Depends(require_any_permission((MODULE, "read"), ("ke_toan", "read"))),
    ],
) -> PurchaseRequestOut:
    try:
        # Truyền `actor`: lọc ở danh sách mà để chi tiết mở là biết id đọc được hết.
        return PurchaseRequestOut(**svc.get_request(request_id, actor=user))
    except PurchaseError as exc:
        raise _map_error(exc) from None


@router.post("/api/purchase-requests", response_model=PurchaseRequestOut, status_code=status.HTTP_201_CREATED)
def create_purchase_request(
    payload: PurchaseRequestIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> PurchaseRequestOut:
    try:
        row = svc.create_request(actor=user, **payload.model_dump())
    except PurchaseError as exc:
        raise _map_error(exc) from None
    # Mới là NHÁP của Thu mua, chưa gửi sang Kế toán nên chỉ làm tươi màn của người lập.
    _notify_purchase_changed(row.get("code"))
    return PurchaseRequestOut(**row)


@router.post("/api/purchase-requests/batch", response_model=PurchaseRequestListOut,
             status_code=status.HTTP_201_CREATED)
def create_purchase_requests_batch(
    payload: PurchaseRequestBatchIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> PurchaseRequestListOut:
    """Yêu cầu chứa hàng của nhiều NCC → tách thành nhiều phiếu, mỗi NCC một phiếu, TRONG MỘT LẦN.

    Không để giao diện gọi endpoint tạo phiếu nhiều lần: lần đầu là yêu cầu nguồn bị giữ chỗ, lần
    sau bị chặn ngay. Và hỏng thì phải hỏng cả mẻ, không để lại phiếu mồ côi đang giữ chỗ."""
    try:
        rows = svc.create_requests_batch(actor=user, **payload.model_dump())
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed()
    return PurchaseRequestListOut(items=[PurchaseRequestOut(**row) for row in rows],
                                  total=len(rows), page=1, size=len(rows) or 1)


@router.put("/api/purchase-requests/{request_id}", response_model=PurchaseRequestOut)
def update_purchase_request(
    request_id: int,
    payload: PurchaseRequestIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> PurchaseRequestOut:
    try:
        row = svc.update_request(request_id, actor=user, **payload.model_dump())
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(row.get("code"))
    return PurchaseRequestOut(**row)


@router.delete("/api/purchase-requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_purchase_request(
    request_id: int,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "delete"))],
) -> Response:
    try:
        svc.delete_request(request_id, actor=user)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/purchase-requests/{request_id}/submit", response_model=PurchaseRequestOut)
def submit_purchase_request(
    request_id: int,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    notifications: NotificationRepo,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    payload: PurchaseSubmitIn | None = None,
) -> PurchaseRequestOut:
    try:
        row = svc.submit(
            request_id, actor=user, deposit_expected=payload.deposit_expected if payload else None
        )
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(
        row.get("code"), event_type="purchase_pending_approval", notifications=notifications,
        channel=CHANNEL_KE_TOAN, actor_user_id=user.id,
    )
    return PurchaseRequestOut(**row)


# DUYỆT / TỪ CHỐI PMH gác bằng khoá của MÀN CÓ NÚT — là màn "Đơn mua hàng" bên Kế toán
# (`ke_toan`), không phải màn Mua hàng (chủ chốt 11/08/2026). Trước đây gác `thu_mua:approve`:
# ô hiện dưới phân hệ Mua hàng mà tác dụng lại ở màn Kế toán, nhìn ma trận không đoán ra.
#
# Tách vai VẪN CÒN NGUYÊN, chỉ là nó nằm ở hai ô rõ ràng thay vì trốn trong tên khoá: LẬP PHIẾU CHI
# từ đợt 3 là `phieu_chi:create`, một ô khác hẳn. Ai được cấp `ke_toan:approve` mà không có
# `phieu_chi:create` thì duyệt xong vẫn không tự viết được phiếu chi.
@router.post("/api/purchase-requests/{request_id}/approve", response_model=PurchaseRequestOut)
def approve_purchase_request(
    request_id: int,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    notifications: NotificationRepo,
    user: Annotated[User, Depends(require_permission(MODULE_KE_TOAN, "approve"))],
) -> PurchaseRequestOut:
    try:
        row = svc.approve(request_id, actor=user)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(
        row.get("code"), event_type="purchase_decision", decision="approved",
        notifications=notifications, channel=CHANNEL_THU_MUA, actor_user_id=user.id,
        recipient_user_id=row.get("created_by_user_id"),
    )
    return PurchaseRequestOut(**row)


@router.post("/api/purchase-requests/{request_id}/reject", response_model=PurchaseRequestOut)
def reject_purchase_request(
    request_id: int,
    payload: ReasonIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    notifications: NotificationRepo,
    user: Annotated[User, Depends(require_permission(MODULE_KE_TOAN, "approve"))],
) -> PurchaseRequestOut:
    try:
        row = svc.reject(request_id, reason=payload.reason, actor=user)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(
        row.get("code"), event_type="purchase_decision", decision="rejected",
        notifications=notifications, channel=CHANNEL_THU_MUA, actor_user_id=user.id,
        recipient_user_id=row.get("created_by_user_id"),
    )
    return PurchaseRequestOut(**row)


@router.post("/api/purchase-requests/{request_id}/mark-purchased", response_model=PurchaseRequestOut)
def mark_purchase_request_purchased(
    request_id: int,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> PurchaseRequestOut:
    try:
        row = svc.mark_purchased(request_id, actor=user)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(row.get("code"))
    return PurchaseRequestOut(**row)


@router.post("/api/purchase-requests/{request_id}/mark-received", response_model=PurchaseRequestOut)
def mark_purchase_request_received(
    request_id: int,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    payload: ReceivedLinesIn | None = None,
) -> PurchaseRequestOut:
    # Body TUỲ CHỌN: gọi không kèm gì = nhận đủ như đặt, y hệt trước 05/08/2026.
    lines = [item.model_dump() for item in payload.lines] if payload is not None else None
    try:
        row = svc.mark_received(request_id, received_lines=lines, actor=user)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(row.get("code"))
    return PurchaseRequestOut(**row)


@router.put(
    "/api/purchase-requests/{request_id}/received-quantities", response_model=PurchaseRequestOut
)
def update_purchase_request_received_quantities(
    request_id: int,
    payload: ReceivedLinesIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> PurchaseRequestOut:
    # Cổng `update` để vào module; service thu về `thu_mua:approve` vì sửa số này là ĐỔI SỐ NỢ.
    try:
        row = svc.update_received_quantities(
            request_id, received_lines=[i.model_dump() for i in payload.lines], actor=user
        )
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(row.get("code"))
    return PurchaseRequestOut(**row)


@router.post("/api/purchase-requests/{request_id}/undo-received", response_model=PurchaseRequestOut)
def undo_purchase_request_received(
    request_id: int,
    payload: ReasonIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> PurchaseRequestOut:
    # Cổng ở đây chỉ là `update` (vào được module); service mới thu về `thu_mua:approve` — cùng lối
    # đã dùng cho `cancel`, để người thiếu quyền nhận đúng câu báo thay vì 403 trống.
    try:
        row = svc.undo_received(request_id, reason=payload.reason, actor=user)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(row.get("code"))
    return PurchaseRequestOut(**row)


@router.post("/api/purchase-requests/{request_id}/cancel", response_model=PurchaseRequestOut)
def cancel_purchase_request(
    request_id: int,
    payload: ReasonIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    # Ô "Hủy PMH" (`thu_mua:cancel`) ĐÃ BỎ 12/08/2026 — chủ chốt test: "vô dụng". Đúng: tick nó
    # lên cũng chẳng mở thêm gì, vì (a) KHÔNG màn nào gọi endpoint này, và (b) service còn một
    # cửa nữa — `ke_toan:approve`, hoặc chính người lập khi phiếu còn NHÁP.
    # Nay cổng router nói ĐÚNG luật đó thay vì đòi một ô thứ ba không ai cấp.
    user: Annotated[
        User,
        Depends(require_any_permission((MODULE, "update"), ("ke_toan", "approve"))),
    ],
) -> PurchaseRequestOut:
    try:
        row = svc.cancel(request_id, reason=payload.reason, actor=user)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(row.get("code"))
    return PurchaseRequestOut(**row)


# --- đợt giao ---------------------------------------------------------------
#
# Cổng ở router là `thu_mua:update` cho mọi thao tác ghi đợt giao. Riêng "Đóng đơn" service tự thu
# về `thu_mua:approve` — nó cắt phần hàng chưa về ra khỏi công nợ nên là quyết định về TIỀN, cùng
# lằn ranh đã áp cho `undo-received` và `cancel`.


@router.post("/api/purchase-requests/{request_id}/deliveries", response_model=PurchaseRequestOut)
def create_purchase_delivery(
    request_id: int,
    payload: PurchaseDeliveryIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    notifications: NotificationRepo,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> PurchaseRequestOut:
    body = payload.model_dump()
    lines = body.pop("lines") or []
    try:
        row = svc.ghi_dot_giao(request_id, lines=lines, actor=user, **body)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    seq_no = row.get("deliveries", [{}])[-1].get("seq_no") if row.get("deliveries") else None
    _notify_purchase_changed(
        row.get("code"), event_type="purchase_delivery_created", seq_no=seq_no,
        notifications=notifications, channel=CHANNEL_KE_TOAN, actor_user_id=user.id,
    )
    return PurchaseRequestOut(**row)


@router.put(
    "/api/purchase-requests/{request_id}/deliveries/{delivery_id}",
    response_model=PurchaseRequestOut,
)
def update_purchase_delivery(
    request_id: int,
    delivery_id: int,
    payload: PurchaseDeliveryIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    notifications: NotificationRepo,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> PurchaseRequestOut:
    body = payload.model_dump()
    lines = body.pop("lines")
    try:
        row = svc.sua_dot_giao(request_id, delivery_id, lines=lines, actor=user, **body)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(
        row.get("code"), event_type="purchase_delivery_updated",
        notifications=notifications, channel=CHANNEL_KE_TOAN, actor_user_id=user.id,
    )
    return PurchaseRequestOut(**row)


@router.delete(
    "/api/purchase-requests/{request_id}/deliveries/{delivery_id}",
    response_model=PurchaseRequestOut,
)
def delete_purchase_delivery(
    request_id: int,
    delivery_id: int,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    notifications: NotificationRepo,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> PurchaseRequestOut:
    try:
        row = svc.xoa_dot_giao(request_id, delivery_id, actor=user)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(
        row.get("code"), event_type="purchase_delivery_deleted",
        notifications=notifications, channel=CHANNEL_KE_TOAN, actor_user_id=user.id,
    )
    return PurchaseRequestOut(**row)


@router.post("/api/purchase-requests/{request_id}/invoice", response_model=PurchaseRequestOut)
def assign_purchase_invoice(
    request_id: int,
    payload: PurchaseInvoiceAssignIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    notifications: NotificationRepo,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> PurchaseRequestOut:
    try:
        row = svc.gan_hoa_don(
            request_id,
            delivery_ids=payload.delivery_ids,
            invoice_symbol=payload.invoice_symbol,
            invoice_number=payload.invoice_number,
            invoice_date=payload.invoice_date,
            actor=user,
        )
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(
        row.get("code"), event_type="purchase_invoice_updated",
        notifications=notifications, channel=CHANNEL_KE_TOAN, actor_user_id=user.id,
    )
    return PurchaseRequestOut(**row)


@router.post("/api/purchase-requests/{request_id}/close", response_model=PurchaseRequestOut)
def close_purchase_request(
    request_id: int,
    payload: ReasonIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> PurchaseRequestOut:
    # Cổng `update` chỉ để vào module; service thu về `thu_mua:approve` + bắt lý do.
    try:
        row = svc.dong_don(request_id, reason=payload.reason, actor=user)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(row.get("code"))
    return PurchaseRequestOut(**row)


@router.put("/api/purchase-requests/{request_id}/contract", response_model=PurchaseRequestOut)
def update_purchase_contract(
    request_id: int,
    payload: PurchaseContractIn,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> PurchaseRequestOut:
    try:
        row = svc.cap_nhat_hop_dong(
            request_id,
            contract_number=payload.contract_number,
            deposit_expected=payload.deposit_expected,
            actor=user,
        )
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(row.get("code"))
    return PurchaseRequestOut(**row)


@router.get(
    "/api/purchase-requests/{request_id}/supplier-credit", response_model=SupplierCreditOut
)
def get_purchase_supplier_credit(
    request_id: int,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    # Kế toán > Đơn mua hàng mở cùng ngăn đơn này — cảnh báo phải có đúng lúc DUYỆT.
    user: Annotated[User, Depends(require_any_permission((MODULE, "read"), (MODULE_KE_TOAN, "read")))],
) -> SupplierCreditOut:
    """Nợ hiện tại của NCC so với hạn mức — CẢNH BÁO MỀM, không chặn gì (Đ6)."""
    try:
        row = svc.get_request(request_id, actor=user)
        data = svc.han_muc_ncc(row.get("supplier_id"))
    except PurchaseError as exc:
        raise _map_error(exc) from None
    return SupplierCreditOut(**data)


@router.post(
    "/api/purchase-requests/{request_id}/attachments",
    response_model=PurchaseRequestOut,
    status_code=status.HTTP_201_CREATED,
)
def upload_purchase_attachment(
    request_id: int,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    kind: str = Query(default="khac"),
    delivery_id: int | None = Query(default=None),
    file: UploadFile = File(...),
) -> PurchaseRequestOut:
    # Tệp rỗng để service báo bằng câu của nó.
    data = doc_gioi_han(file, MAX_PURCHASE_ATTACHMENT_BYTES, cho_rong=True)
    try:
        row = svc.them_dinh_kem(
            request_id,
            delivery_id=delivery_id,
            kind=kind,
            file_name=file.filename,
            content_type=file.content_type,
            data=data,
            actor=user,
        )
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(row.get("code"))
    return PurchaseRequestOut(**row)


@router.delete(
    "/api/purchase-requests/{request_id}/attachments/{attachment_id}",
    response_model=PurchaseRequestOut,
)
def delete_purchase_attachment(
    request_id: int,
    attachment_id: int,
    svc: Annotated[PurchaseService, Depends(get_purchase_service)],
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> PurchaseRequestOut:
    try:
        row = svc.xoa_dinh_kem(request_id, attachment_id, actor=user)
    except PurchaseError as exc:
        raise _map_error(exc) from None
    _notify_purchase_changed(row.get("code"))
    return PurchaseRequestOut(**row)
