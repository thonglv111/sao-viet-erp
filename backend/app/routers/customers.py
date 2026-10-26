"""Khách hàng (CRM) routes — spec-06-khach-hang.

Thin HTTP shell over CustomerService. Every route is guarded by
`require_permission('khach_hang', <action>)`; list/detail additionally narrow to the
caller's data scope (own/department/all) resolved from their role. The read-only Công
nợ card is fed by SEAM-16 — when Công nợ is not built the port raises and we return an
explicit "unavailable" card (never a fabricated 0 balance).
"""
from __future__ import annotations

import csv
import io
from datetime import date, datetime
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import (
    get_audit_repository,
    get_authorization_service,
    get_customer_analytics_service,
    get_customer_service,
    get_so_lieu_khach_service,
    get_department_repository,
    get_role_repository,
    get_user_repository,
    require_any_permission,
    require_permission,
)
from ..models.customer import Customer
from ..models.user import User
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.loc_danh_sach import trong_khoang_ngay
from ..repositories.org_scope import dept_subtree_ids, nhom_dung_chung_user_ids
from ..repositories.rbac_repo import DepartmentRepository, RoleRepository
from ..repositories.user_repo import UserRepository
from ..schemas.customer import (
    AddressIn,
    AddressOut,
    AddressesOut,
    CareEventIn,
    CareEventOut,
    CareEventsOut,
    CareTaskIn,
    CareTaskOut,
    CareTaskStatusIn,
    CareTasksOut,
    CareCalendarOut,
    CareOccurrenceOut,
    OccurrenceActionIn,
    ContactIn,
    ContactOut,
    ContactsOut,
    LichHenDong,
    LichHenOut,
    CustomerAttachmentOut,
    CustomerAttachmentsOut,
    CustomerAuditOut,
    CustomerAuditRowOut,
    DongBaoGiaOut,
    DongDonOut,
    ThongKeKhachOut,
    TrangBaoGiaOut,
    TrangDonOut,
    CustomerCreate,
    CustomerCreateOut,
    CustomerDetailOut,
    CustomerFinancialIn,
    CustomerKpis,
    CustomerListOut,
    CustomerReassignIn,
    CustomerReassignOut,
    CustomerRow,
    CustomerUpdate,
    DuplicateRef,
    DuplicateWarn,
    NhapExcelCanhBao,
    NhapExcelLoi,
    NhapExcelOut,
    NhapExcelThayDoi,
    NoteIn,
    NoteOut,
    NotesOut,
    NoteUpdateIn,
    ReceivableCard,
    SaleOption,
    KhoNhanOut,
    KhoNhanRow,
    KhoNhanXoaOut,
    TagIn,
    TagOut,
    TagsOut,
)
from ..services import customer_excel
from ..services.catalog_excel import ExcelSaiMan
from ..services.customer_analytics import CustomerAnalyticsService, CustomerStat
from ..services.khach_hang_so_lieu import (
    BUOC,
    TRAN_KHOANG_NGAY,
    SoLieuKhachService,
    hom_nay_vn,
)
from ..services.customer_service import (
    CustomerForbidden,
    CustomerNotFound,
    CustomerService,
    CustomerValidationError,
    ReassignForbidden,
    nguoi_du_tu_cach_nhan_khach,
    ReceivableUnavailable,
)
from ..services.rbac_service import AuthorizationService
from ..storage import get_storage, make_key, url_from_key
from ..tai_len import TRAN_EXCEL, TRAN_TAI_LIEU, doc_gioi_han

router = APIRouter(prefix="/api/customers", tags=["customers"])

MODULE = "khach_hang"

# Tài liệu KH đi qua kho file dùng chung; đọc lại qua /api/files, cần quyền `khach_hang`.
_CRM_SUBDIR = "crm"

Service = Annotated[CustomerService, Depends(get_customer_service)]
Analytics = Annotated[CustomerAnalyticsService, Depends(get_customer_analytics_service)]
SoLieu = Annotated[SoLieuKhachService, Depends(get_so_lieu_khach_service)]
Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]
Users = Annotated[UserRepository, Depends(get_user_repository)]
Audit = Annotated[AuditLogRepository, Depends(get_audit_repository)]
Depts = Annotated[DepartmentRepository, Depends(get_department_repository)]
Roles = Annotated[RoleRepository, Depends(get_role_repository)]


def _scope_for(authz: AuthorizationService, user: User) -> str:
    """The caller's data scope on khach_hang (own/department/all). Defaults to `own`
    if somehow missing, so a read-permitted user never sees more than their own."""
    return authz.scope_for(user, MODULE) or "own"


def _row(
    customer: Customer,
    sale_names: dict[int, str],
    stat: CustomerStat | None = None,
    *,
    tags: list[str] | None = None,
) -> CustomerRow:
    # customer_kind + rào chiết khấu/markup + điều khoản tự nạp từ ORM (from_attributes).
    # Redesign spec-06 v2: mọi số tài chính AI CŨNG XEM (không ẩn); bỏ tier.
    row = CustomerRow.model_validate(customer)
    row.tags = tags or []
    if customer.sale_user_id is not None:
        row.sale_name = sale_names.get(customer.sale_user_id)
    # Công nợ chỉ-đọc: chưa build → None + no_ar_module=True (KHÔNG số 0 giả).
    row.receivable = None
    row.no_ar_module = True
    # Derived-from-real-orders fields (default honest zeros when no history).
    if stat is not None:
        row.revenue_12m = stat.revenue_12m
        row.orders_12m = stat.orders_12m
        row.orders_total = stat.orders_total
        row.last_order_at = stat.last_order_at
    return row


def _sale_names(users: UserRepository, ids: set[int]) -> dict[int, str]:
    # Một truy vấn IN cho cả trang (trước là get_by_id từng người).
    return {uid: (u.name or u.username) for uid, u in users.map_by_ids(ids).items()}


def _sort_key(sort: str):
    """Resolve a sort key over the scoped set. Derived columns (revenue/orders/last_order)
    are sorted in-Python from the analytics roll-up; identity columns fall back to the row."""
    desc = sort.startswith("-")
    key = sort[1:] if desc else sort
    return key, desc


@router.get("", response_model=CustomerListOut)
def list_customers(
    svc: Service,
    analytics: Analytics,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    q: str | None = Query(default=None),
    sale: int | None = Query(default=None),
    # "Chưa gán ai" — khách chưa có NV phụ trách. Chỉ người phạm vi `all` mới có khách loại này
    # trong tầm nhìn (phạm vi own/department lọc theo chủ sổ nên khách vô chủ tự rơi ra ngoài).
    chua_gan: bool = Query(default=False),
    tag: str | None = Query(default=None),
    # Thanh lọc chung (06/10/2026): kỳ theo Ngày tạo + loại khách + trạng thái mua hàng.
    tu_ngay: date | None = Query(default=None),
    den_ngay: date | None = Query(default=None),
    moc: str = Query(default="tao", pattern="^tao$"),
    loai: str | None = Query(default=None, pattern="^(ca_nhan|cong_ty)$"),
    # Trạng thái mua hàng — suy từ ĐƠN ĐÃ CHỐT, đúng như cột "Mua hàng 12 tháng" của bảng:
    # `dang_mua` có đơn trong 12 tháng · `ngung` từng có đơn nhưng 12 tháng nay không · `chua_don`.
    mua: str | None = Query(default=None, pattern="^(dang_mua|ngung|chua_don)$"),
    sort: str = Query(default="code"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=200),
) -> CustomerListOut:
    """Danh bạ + KPI header. Số dẫn xuất (doanh số/#đơn) + KPI tính từ ĐƠN HÀNG THẬT.
    Redesign spec-06 v2: bỏ lọc theo tier/trạng thái; lọc theo THẺ gán tay. Tab "Cần theo dõi" gỡ
    05/10/2026 — trùng việc với nút "Lịch hẹn" (`GET /lich-hen`)."""
    scope = _scope_for(authz, user)
    book = svc.list_scoped_all(scope=scope, actor=user)
    stats = analytics.list_stats(book)

    # Text search (name / MST / phone) — mirror the repo's q semantics.
    needle = (q or "").strip().lower()
    filtered = book
    if needle:
        filtered = [
            c
            for c in filtered
            if needle in c.name.lower()
            or needle in (c.tax_code or "").lower()
            or needle in (c.phone or "").lower()
        ]
    if chua_gan:
        filtered = [c for c in filtered if c.sale_user_id is None]
    elif sale is not None:
        filtered = [c for c in filtered if c.sale_user_id == sale]
    if tag and tag.strip():
        # Lọc theo nhãn thủ công (#7) — case-insensitive.
        tagged_ids = svc.customers.ids_with_label(tag)
        filtered = [c for c in filtered if c.id in tagged_ids]
    if tu_ngay is not None or den_ngay is not None:
        filtered = [c for c in filtered if trong_khoang_ngay(c.created_at, tu_ngay, den_ngay)]
    if loai:
        filtered = [c for c in filtered if c.customer_kind == loai]
    def _tinh_trang(c: Customer) -> str:
        st = stats.per_customer.get(c.id)
        if st is None or st.orders_total == 0:
            return "chua_don"
        return "dang_mua" if st.orders_12m > 0 else "ngung"

    dem_mua = {"dang_mua": 0, "ngung": 0, "chua_don": 0}
    for c in filtered:
        dem_mua[_tinh_trang(c)] += 1
    if mua:
        filtered = [c for c in filtered if _tinh_trang(c) == mua]

    key, is_desc = _sort_key(sort or "code")
    derived = {"revenue": "revenue_12m", "orders": "orders_total"}
    if key == "last_order":
        filtered.sort(
            key=lambda c: (stats.per_customer[c.id].last_order_at is not None,
                           stats.per_customer[c.id].last_order_at or _min_date()),
            reverse=is_desc,
        )
    elif key in derived:
        attr = derived[key]
        filtered.sort(key=lambda c: getattr(stats.per_customer[c.id], attr), reverse=is_desc)
    elif key == "name":
        filtered.sort(key=lambda c: c.name.lower(), reverse=is_desc)
    elif key == "created":
        filtered.sort(key=lambda c: (c.created_at is not None, c.created_at or datetime.min), reverse=is_desc)
    elif key == "credit_limit":
        filtered.sort(key=lambda c: c.credit_limit, reverse=is_desc)
    else:  # code (default) — stable, sequential
        filtered.sort(key=lambda c: c.code, reverse=is_desc)

    total = len(filtered)
    tong_mua_12m = sum(
        st.revenue_12m for c in filtered if (st := stats.per_customer.get(c.id)) is not None
    )
    start = (page - 1) * size
    page_rows = filtered[start : start + size]

    sale_ids = {c.sale_user_id for c in page_rows if c.sale_user_id is not None}
    names = _sale_names(users, sale_ids)
    tag_map = svc.customers.tags_for([c.id for c in page_rows])
    return CustomerListOut(
        items=[
            _row(c, names, stats.per_customer.get(c.id), tags=tag_map.get(c.id))
            for c in page_rows
        ],
        total=total,
        page=page,
        size=size,
        kpis=CustomerKpis(
            total_customers=stats.total_customers,
            new_this_month=stats.new_this_month,
            avg_order_value=stats.avg_order_value,
            total_revenue=stats.total_revenue,
        ),
        dem_mua=dem_mua,
        tong_mua_12m=tong_mua_12m,
    )


def _min_date():
    from datetime import date

    return date.min


@router.get("/sales", response_model=list[SaleOption])
def list_sale_options(
    svc: Service,
    authz: Authz,
    users: Users,
    depts: Depts,
    roles: Roles,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> list[SaleOption]:
    """Danh sách NGƯỜI dùng cho hộp lọc "NV phụ trách" và ô gán chủ khách hàng.

    Hai tập hợp, cố ý khác nhau (`co_the_gan` phân biệt):

    · **ĐỦ TƯ CÁCH NHẬN KHÁCH** — người thuộc khối Kinh doanh (`departments.la_kinh_doanh`), hoặc
      nếu chưa khai khối nào thì người có quyền đọc module `khach_hang`. Ô gán khi tạo/sửa chỉ
      lấy tập này: không để lỡ tay gán khách cho Thủ kho.
    · **ĐANG GIỮ KHÁCH** trong tầm nhìn của người xem — kể cả người ngoài khối (khách cũ gán cho
      Admin, sale vừa chuyển sang phòng khác). Hộp LỌC phải có họ, nếu không sẽ có dòng hiện trong
      bảng mà không cách nào lọc ra.

    Cả hai đều cắt theo PHẠM VI dữ liệu của người xem (own/department/all) — cùng luật cây con với
    `CustomerRepository._scope_condition`, để hộp chọn không bao giờ lệch với bảng bên dưới."""
    scope = _scope_for(authz, user)

    # 1) Phạm vi: những user-id mà người xem được thấy sổ khách của họ. None = không giới hạn.
    trong_pham_vi: set[int] | None
    if scope == "all":
        trong_pham_vi = None
    elif scope == "department":
        dept_ids = dept_subtree_ids(svc.customers.db, user.department_id)
        trong_pham_vi = (
            {u.id for d in dept_ids for u in users.list_by_department(d)}
            if dept_ids
            else {user.id}
        )
    else:
        # "Của tôi" = mình + người cùng nhóm dùng chung — đúng như bảng khách (`_scope_condition`).
        trong_pham_vi = nhom_dung_chung_user_ids(svc.customers.db, user.id)

    # 2) Ai đang thực sự giữ khách trong tầm nhìn (kèm số khách — hộp Điều chuyển cần con số này).
    book = svc.list_scoped_all(scope=scope, actor=user)
    so_kh: dict[int, int] = {}
    for c in book:
        if c.sale_user_id is not None:
            so_kh[c.sale_user_id] = so_kh.get(c.sale_user_id, 0) + 1

    # 3) Ai đủ tư cách nhận khách — luật DÙNG CHUNG với cột "Sale phụ trách" của file nhập Excel
    #    (`services/customer_service.nguoi_du_tu_cach_nhan_khach`). Trước 11/09/2026 luật nằm ngay
    #    trong hàm này, và bộ nhập Excel đã kịp lệch một nhịp vì tự khai lại.
    du_tu_cach_ids = nguoi_du_tu_cach_nhan_khach(svc.customers.db)

    ung_vien: dict[int, User] = {}
    gan_duoc: dict[int, bool] = {}
    for u in users.list_all():
        if trong_pham_vi is not None and u.id not in trong_pham_vi:
            continue
        # Người cùng nhóm chỉ để LỌC: sale "Của tôi" không gán khách sang người khác (chủ chốt
        # 26/10/2026) — gán chủ khách đi đường Điều chuyển của trưởng phòng.
        gan_duoc[u.id] = u.id in du_tu_cach_ids and (scope != "own" or u.id == user.id)
        if gan_duoc[u.id] or u.id in so_kh:
            ung_vien[u.id] = u
    # Người xem luôn có mặt: sale scope `own` phải chọn được chính mình dù chưa có khách nào.
    if user.id not in ung_vien:
        ung_vien[user.id] = user
        gan_duoc.setdefault(user.id, user.id in du_tu_cach_ids)

    ten_phong = {d.id: d.name for d in depts.list_all()}
    out: list[SaleOption] = []
    for u in ung_vien.values():
        vai_tro = None
        if u.role_id is not None:
            role = roles.get_by_id(u.role_id)
            vai_tro = role.name if role is not None else None
        out.append(
            SaleOption(
                id=u.id,
                name=u.name or u.username,
                vai_tro=vai_tro,
                phong_ban=ten_phong.get(u.department_id) if u.department_id else None,
                co_the_gan=gan_duoc.get(u.id, False),
                so_kh=so_kh.get(u.id, 0),
            )
        )
    # Người trong khối lên trước (đó là danh sách người ta chọn hằng ngày), rồi tới người chỉ còn
    # giữ khách cũ; trong mỗi nhóm xếp theo tên.
    out.sort(key=lambda o: (not o.co_the_gan, o.name.lower()))
    return out


@router.post("/reassign", response_model=CustomerReassignOut)
def reassign_customers(
    payload: CustomerReassignIn,
    svc: Service,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "reassign"))],
) -> CustomerReassignOut:
    """Điều chuyển toàn bộ khách của một Sale sang Sale khác. Dành cho trưởng phòng KD
    (scope `department`) hoặc quản lý (scope `all`); Sale thường (scope `own`) bị 403.
    Ở scope `department`, cả Sale nguồn và đích phải cùng phòng với người thực hiện."""
    scope = _scope_for(authz, user)
    if scope == "own":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền điều chuyển khách hàng.",
        )
    to_u = users.get_by_id(payload.to_sale_user_id)
    if to_u is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy nhân viên đích."
        )
    # Ở scope `department`, nhân viên đích phải thuộc phòng của người thực hiện HOẶC phòng con —
    # cùng luật cây con với danh sách khách và hộp NV phụ trách.
    cay_phong = set(dept_subtree_ids(svc.customers.db, user.department_id)) if scope == "department" else set()
    if scope == "department" and to_u.department_id not in cay_phong:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nhân viên đích phải thuộc phòng của bạn hoặc phòng con.",
        )

    try:
        if payload.customer_ids:
            moved, skipped = svc.reassign_selected(
                customer_ids=payload.customer_ids,
                to_sale_user_id=payload.to_sale_user_id,
                scope=scope,
                actor=user,
            )
            return CustomerReassignOut(moved=moved, skipped=skipped)
        if payload.from_sale_user_id is not None:
            from_u = users.get_by_id(payload.from_sale_user_id)
            if from_u is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Không tìm thấy nhân viên nguồn.",
                )
            if scope == "department" and from_u.department_id not in cay_phong:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Nhân viên nguồn phải thuộc phòng của bạn hoặc phòng con.",
                )
            moved = svc.reassign_customers(
                from_sale_user_id=payload.from_sale_user_id,
                to_sale_user_id=payload.to_sale_user_id,
                scope=scope,
                actor=user,
            )
            return CustomerReassignOut(moved=moved)
    except CustomerValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
        ) from None
    except CustomerForbidden as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from None

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="Cần chọn khách hàng hoặc nhân viên nguồn để điều chuyển.",
    )


# --- check trùng tức thời (#8: cảnh báo ngay trên form, trước khi chào hàng) --


@router.get("/check-duplicate", response_model=list[DuplicateWarn])
def check_duplicate(
    svc: Service,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    tax_code: str | None = Query(default=None),
    name: str | None = Query(default=None),
    email: str | None = Query(default=None),
    exclude_id: int | None = Query(default=None),
) -> list[DuplicateWarn]:
    """Soft check theo MST + tên cty + email (#15). Cảnh báo, KHÔNG chặn — form gọi
    khi người dùng rời ô nhập để hiện link tới khách đã có."""
    return _dup_warns(
        svc.customers.find_duplicates(
            tax_code=(tax_code or "").strip() or None,
            name=name,
            email=email,
            exclude_id=exclude_id,
        )
    )


# --- nhãn thủ công (#7: sales gán tay) -------------------------------------------


@router.get("/tags", response_model=list[str])
def list_tag_labels(
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> list[str]:
    """Mọi nhãn đã dùng trên các khách trong scope — gợi ý khi gõ + option lọc."""
    return svc.customers.distinct_labels(scope=_scope_for(authz, user), actor=user)


# --- kho nhãn dùng chung (thêm / xoá nhãn) ---------------------------------------
# ⚠️ Ba route dưới phải đứng TRƯỚC `/{customer_id}`: đường một đoạn, để sau thì "tag-kho" bị nuốt
# thành customer_id rồi 422. Cùng lý do `/tags` ở trên đứng chỗ này.


@router.get("/tag-kho", response_model=KhoNhanOut)
def list_kho_nhan(
    svc: Service,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> KhoNhanOut:
    """Kho nhãn có thể gán + số khách đang mang từng nhãn."""
    return KhoNhanOut(items=[KhoNhanRow(**r) for r in svc.list_kho_nhan()])


@router.post("/tag-kho", response_model=KhoNhanRow, status_code=201)
def them_nhan_kho(
    payload: TagIn,
    svc: Service,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> KhoNhanRow:
    try:
        row = svc.them_nhan_kho(label=payload.label, actor=user)
    except CustomerValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    return KhoNhanRow(id=row.id, label=row.label, so_khach=0)


@router.delete("/tag-kho/{nhan_id}", response_model=KhoNhanXoaOut)
def xoa_nhan_kho(
    nhan_id: int,
    svc: Service,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> KhoNhanXoaOut:
    """Xoá nhãn khỏi kho + gỡ khỏi mọi khách đang mang. Không chặn — xem `xoa_nhan_kho`."""
    try:
        so = svc.xoa_nhan_kho(nhan_id=nhan_id, actor=user)
    except CustomerNotFound:
        raise _not_found() from None
    return KhoNhanXoaOut(so_khach_da_go=so)


@router.get("/{customer_id}/tags", response_model=TagsOut)
def list_customer_tags(
    customer_id: int,
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> TagsOut:
    try:
        items = svc.list_tags(
            customer_id=customer_id, scope=_scope_for(authz, user), actor=user
        )
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    return TagsOut(items=[TagOut.model_validate(t) for t in items])


@router.post("/{customer_id}/tags", response_model=TagOut, status_code=201)
def add_customer_tag(
    customer_id: int,
    payload: TagIn,
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> TagOut:
    try:
        tag = svc.add_tag(
            customer_id=customer_id, scope=_scope_for(authz, user), actor=user,
            label=payload.label,
        )
    except CustomerValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    return TagOut.model_validate(tag)


@router.delete("/{customer_id}/tags/{tag_id}", status_code=204)
def delete_customer_tag(
    customer_id: int,
    tag_id: int,
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
):
    try:
        svc.remove_tag(
            customer_id=customer_id, tag_id=tag_id,
            scope=_scope_for(authz, user), actor=user,
        )
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None


# --- nút "Lịch hẹn" trên danh bạ (lịch hẹn chăm sóc kiểu Google Calendar, 05/10/2026) ----------


@router.get("/lich-hen", response_model=LichHenOut)
def lich_hen(
    svc: Service,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    pham_vi: str = Query(default="toi", pattern="^(toi|nhom)$"),
    den: date | None = Query(default=None),
) -> LichHenOut:
    """Hẹn trễ + hẹn từ hôm nay tới `den` (mặc định 30 ngày) của nhiều khách, dạng lịch biểu.

    `pham_vi=toi`: hẹn giao cho người gọi, dù khách thuộc NV nào — số đỏ trên nút chỉ đếm phần
    này, nên giám đốc không bị đếm việc của cả công ty. `pham_vi=nhom`: mọi hẹn trên những khách
    người gọi được xem, đúng phạm vi đang áp cho danh bạ. Khai TRƯỚC các route `/{customer_id}`."""
    scope = _scope_for(authz, user)
    rows, so = svc.lich_hen(scope=scope, actor=user, chi_cua_toi=(pham_vi == "toi"), den_ngay=den)
    names = _sale_names(users, {o["assignee_user_id"] for o, _ in rows if o["assignee_user_id"]})
    return LichHenOut(
        items=[
            LichHenDong(
                **o, assignee_name=names.get(o["assignee_user_id"]),
                customer_code=c.code, customer_name=c.name,
            )
            for o, c in rows
        ],
        so=so,
        co_nhom=svc.thay_hen_nguoi_khac(scope=scope, actor=user),
    )


# --- xuất / nhập danh bạ (#23) -----------------------------------------------
#
# CẢ HAI CHIỀU đều là .xlsx từ 11/09/2026 — trước đó xuất CSV, nhập CSV.
#
# Đường CSV cũ (`/export.csv`, `/import-template.csv`, `POST /import`,
# `CustomerService.import_rows`) ĐÃ GỠ. Nhập CSV chỉ nạp 7 cột định danh, không có Sale phụ trách,
# không có chính sách tài chính, ghi từng dòng nên gãy giữa chừng là để lại một nửa, và bản xem
# trước kiểm nhẹ hơn lúc ghi thật. Hai cửa nhập cho cùng một việc là sớm muộn lệch nhau, nên thay
# chứ không để song song. Toàn bộ luật đọc/ghi nằm ở `services/customer_excel.py`.


@router.get("/xuat-excel")
def xuat_excel(
    db: Annotated[Session, Depends(get_db)],
    svc: Service,
    authz: Authz,
    # Xuất file MẶC ĐỊNH BẬT: chỉ cần quyền Xem khách (gỡ quyền chi tiết `export` 24/08/2026).
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> Response:
    """Xuất danh bạ trong scope của người gọi ra .xlsx — định danh + chính sách tài chính.

    Sửa trong Excel rồi nhập LẠI được (bản 2, 17/09/2026): dòng có `Mã KH` là sửa khách đó, dòng
    thêm vào để trống mã là khách mới — xem `customer_excel.nhap`.
    """
    book = svc.list_scoped_all(scope=_scope_for(authz, user), actor=user)
    book.sort(key=lambda c: c.code)
    return Response(
        content=customer_excel.xuat(db, book),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="danh-ba-khach-hang.xlsx"'},
    )


@router.get("/mau-excel")
def mau_excel(
    db: Annotated[Session, Depends(get_db)],
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> Response:
    """File mẫu .xlsx — RỖNG, chỉ dòng tiêu đề (chốt 11/09/2026).

    Không kèm khách đang có: mẫu này để THÊM MỚI. Mã khách là mã hệ tự cấp nên file cũng không có
    cột Mã — muốn sửa hàng loạt thì dùng `GET /xuat-excel`, sửa, rồi nhập lại chính file đó.

    Sáu cột chính sách tài chính CHỈ xuất cho người có `set_credit_terms`: đưa ra một cột họ không
    được ghi chỉ tổ mời họ điền vào chỗ sẽ bị bỏ qua.
    """
    return Response(
        content=customer_excel.tao_mau(
            db, co_tai_chinh=authz.can(user, MODULE, "set_credit_terms")
        ),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="mau-nhap-khach-hang.xlsx"'},
    )


@router.post("/import-excel", response_model=NhapExcelOut)
def import_excel(
    db: Annotated[Session, Depends(get_db)],
    svc: Service,
    authz: Authz,
    # `create` HOẶC `update` — mỗi dòng tự kiểm quyền của nó (thêm cần `create`, sửa cần `update`).
    # Không bắt cả hai như danh mục: người chỉ có `create` vẫn đang nhập khách mới được.
    user: Annotated[
        User, Depends(require_any_permission((MODULE, "create"), (MODULE, "update")))
    ],
    file: UploadFile = File(...),
    mode: str = Query(default="preview", pattern="^(preview|commit)$"),
) -> NhapExcelOut:
    """Nhập danh bạ từ .xlsx — dòng Mã KH trống là khách MỚI, dòng có Mã KH là SỬA khách đó (bản
    2, 17/09/2026). CẢ FILE là một giao dịch.

    `mode=preview` chạy y hệt `commit` rồi rollback, nên con số xem trước là con số THẬT (kể cả lỗi
    chỉ lộ ra lúc service validate). Cố ý không làm một bản kiểm "sơ bộ" nhẹ hơn — nếu xem trước dễ
    dãi hơn lúc ghi thì người dùng bấm Xác nhận xong mới ăn lỗi, đúng thứ nút xem trước sinh ra để
    tránh (đây là điểm yếu của đường nhập CSV cũ đã gỡ).
    """
    try:
        kq = customer_excel.nhap(
            # Tệp rỗng để `nhap` báo "không đọc được file" như cũ.
            db, svc, doc_gioi_han(file, TRAN_EXCEL, cho_rong=True),
            actor=user, scope=_scope_for(authz, user),
            co_tai_chinh=authz.can(user, MODULE, "set_credit_terms"),
            co_quyen_tao=authz.can(user, MODULE, "create"),
            co_quyen_sua=authz.can(user, MODULE, "update"),
            co_quyen_dieu_chuyen=authz.can(user, MODULE, "reassign"),
            ghi=(mode == "commit"),
        )
    except ExcelSaiMan as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from None
    return NhapExcelOut(
        hop_le=kq.hop_le, tong_dong=kq.tong_dong, tao_moi=kq.tao_moi,
        cap_nhat=kq.cap_nhat, khong_doi=kq.khong_doi, da_ghi=kq.da_ghi,
        bo_qua_tai_chinh=kq.bo_qua_tai_chinh,
        loi=[NhapExcelLoi(dong=x.dong, cot=x.cot, ly_do=x.ly_do) for x in kq.loi],
        canh_bao=[NhapExcelCanhBao(dong=x.dong, ly_do=x.ly_do) for x in kq.canh_bao],
        thay_doi=[
            NhapExcelThayDoi(dong=x.dong, ma=x.ma, ten=x.ten, cot=x.cot, cu=x.cu, moi=x.moi)
            for x in kq.thay_doi
        ],
    )


@router.post("", response_model=CustomerCreateOut, status_code=status.HTTP_201_CREATED)
def create_customer(
    payload: CustomerCreate,
    svc: Service,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "create"))],
) -> CustomerCreateOut:
    try:
        customer, duplicates = svc.create_customer(
            name=payload.name,
            customer_kind=payload.customer_kind,
            tax_code=payload.tax_code,
            phone=payload.phone,
            email=payload.email,
            address=payload.address,
            contact_name=payload.contact_name,
            sale_user_id=payload.sale_user_id,
            actor=user,
        )
    except CustomerValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
        ) from None
    names = _sale_names(
        users, {customer.sale_user_id} if customer.sale_user_id else set()
    )
    return CustomerCreateOut(
        customer=_row(customer, names),
        duplicate=_first_dup(duplicates),
        duplicates=_dup_warns(duplicates),
    )


@router.get("/{customer_id}", response_model=CustomerDetailOut)
def get_customer(
    customer_id: int,
    svc: Service,
    analytics: Analytics,
    so_lieu: SoLieu,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> CustomerDetailOut:
    scope = _scope_for(authz, user)
    customer = _load_scoped(svc, customer_id, scope, user)
    names = _sale_names(
        users, {customer.sale_user_id} if customer.sale_user_id else set()
    )
    stat = analytics.list_stats([customer]).per_customer.get(customer.id)
    tag_map = svc.customers.tags_for([customer.id])
    so_don, so_bao_gia = so_lieu.dem_tab(customer.id)
    return CustomerDetailOut(
        customer=_row(customer, names, stat, tags=tag_map.get(customer.id)),
        receivable=_receivable_card(
            svc, customer, can_view=True  # Xem công nợ MẶC ĐỊNH BẬT (gỡ quyền `view_debt` 24/08/2026)
        ),
        so_don=so_don,
        so_bao_gia=so_bao_gia,
    )


# --- CRM-360 Object-page: Dashboard + history + Excel (computed from real data) ---


def _ky(tu: date | None, den: date | None) -> tuple[date, date]:
    """Khoảng ngày của kỳ đang xem. Mặc định: đầu năm nay → hôm nay (giờ VN)."""
    hn = hom_nay_vn()
    tu = tu or date(hn.year, 1, 1)
    den = den or hn
    if tu > den:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Ngày bắt đầu phải trước ngày kết thúc.")
    if (den - tu).days > TRAN_KHOANG_NGAY:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Khoảng ngày tối đa 10 năm.")
    return tu, den


@router.get("/{customer_id}/thong-ke", response_model=ThongKeKhachOut)
def customer_thong_ke(
    customer_id: int,
    svc: Service,
    so_lieu: SoLieu,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    tu: date | None = Query(default=None),
    den: date | None = Query(default=None),
    buoc: str = Query(default="thang"),
) -> ThongKeKhachOut:
    """Tab Tổng quan: số theo KỲ + cùng kỳ năm trước, biểu đồ theo tuần/tháng/quý, sản phẩm,
    nhịp đặt hàng, báo giá đang chờ. Mọi số tính từ đơn/báo giá THẬT."""
    _load_scoped(svc, customer_id, _scope_for(authz, user), user)
    if buoc not in BUOC:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Bước biểu đồ không hợp lệ.")
    tu, den = _ky(tu, den)
    t = so_lieu.thong_ke(customer_id, tu, den, buoc)
    return ThongKeKhachOut.model_validate(t, from_attributes=True)


@router.get("/{customer_id}/orders", response_model=TrangDonOut)
def customer_order_history(
    customer_id: int,
    svc: Service,
    so_lieu: SoLieu,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    tu: date | None = Query(default=None),
    den: date | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    nhom: str | None = Query(default=None),
    sap_xep: str = Query(default="-ngay"),
    trang: int = Query(default=1, ge=1),
    co: int = Query(default=50, ge=1, le=200),
) -> TrangDonOut:
    """Lịch sử mua hàng — lọc kỳ / tìm / nhóm trạng thái / sắp xếp / phân trang ở MÁY CHỦ."""
    _load_scoped(svc, customer_id, _scope_for(authz, user), user)
    tu, den = _ky(tu, den)
    r = so_lieu.lich_su_don(customer_id, tu=tu, den=den, q=q, nhom=nhom, sap_xep=sap_xep,
                            trang=trang, co=co)
    return TrangDonOut(
        items=[DongDonOut.model_validate(d, from_attributes=True) for d in r.items],
        tong_so=r.tong_so, dem=r.dem, tien_chot=r.tien_chot, tien_huy=r.tien_huy,
        trang=trang, co=co,
    )


@router.get("/{customer_id}/quotations", response_model=TrangBaoGiaOut)
def customer_quote_history(
    customer_id: int,
    svc: Service,
    so_lieu: SoLieu,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    tu: date | None = Query(default=None),
    den: date | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    nhom: str | None = Query(default=None),
    trang: int = Query(default=1, ge=1),
    co: int = Query(default=50, ge=1, le=200),
) -> TrangBaoGiaOut:
    """Lịch sử báo giá — lọc kỳ / tìm / nhóm kết quả / phân trang ở MÁY CHỦ, kèm đơn sinh ra."""
    _load_scoped(svc, customer_id, _scope_for(authz, user), user)
    tu, den = _ky(tu, den)
    r = so_lieu.lich_su_bao_gia(customer_id, tu=tu, den=den, q=q, nhom=nhom, trang=trang, co=co)
    return TrangBaoGiaOut(
        items=[DongBaoGiaOut.model_validate(d, from_attributes=True) for d in r.items],
        tong_so=r.tong_so, dem=r.dem, trang=trang, co=co,
    )


_ORDER_STATUS_LABELS = {
    "draft": "Nháp",
    "ordered": "Đã chốt",
    "on_hold": "Tạm giữ",
    "change_order": "Đã đổi",
    "cancelled": "Đã hủy",
}
_ORDER_KIND_LABELS = {"moi": "Đơn mới", "bo_sung": "Đơn bổ sung"}
_QUOTE_STATUS_LABELS = {
    "draft": "Nháp",
    "sent": "Đã gửi",
    "approved": "Đã duyệt",
    "rejected": "Từ chối",
    "expired": "Hết hạn",
    "cancelled": "Đã hủy",
    "on_hold": "Tạm giữ",
    "change_order": "Re-quote",
}
_PROFILE_ACTION_LABELS = {
    "create_customer": "Tạo hồ sơ khách hàng",
    "update_customer": "Cập nhật hồ sơ",
    "reassign_customer": "Điều chuyển phụ trách",
}
_CARE_KIND_LABELS = {
    "goi_dien": "Gọi điện",
    "nhan_tin": "Nhắn tin",
    "email": "Email",
    "gap_truc_tiep": "Gặp trực tiếp",
    "khac": "Chăm sóc khác",
}


@router.get("/{customer_id}/audit", response_model=CustomerAuditOut)
def customer_audit(
    customer_id: int,
    svc: Service,
    analytics: Analytics,
    authz: Authz,
    users: Users,
    audit: Audit,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> CustomerAuditOut:
    """Nhật ký khách hàng — a single, time-ordered timeline that merges profile edits
    (from the audit log) with REAL document events (đơn hàng / báo giá). Every row is an
    actual event; nothing is fabricated. Document rows carry ref_type/ref_id so the UI can
    drill through to the source document."""
    scope = _scope_for(authz, user)
    _load_scoped(svc, customer_id, scope, user)  # scope guard (404 if out of scope)

    items: list[CustomerAuditRowOut] = []

    audit_rows = audit.list_by_target(f"customer:{customer_id}")
    care_rows = svc.list_care_events(customer_id=customer_id, scope=scope, actor=user)
    # Tên người thao tác: MỘT truy vấn cho cả nhật ký (trước là get_by_id từng dòng — N+1).
    nguoi = users.map_by_ids(
        [a.actor_user_id for a in audit_rows] + [ev.created_by for ev in care_rows]
    )

    # 1) Profile edits from the audit log (target == customer:<id>).
    for a in audit_rows:
        actor = nguoi.get(a.actor_user_id) if a.actor_user_id is not None else None
        items.append(
            CustomerAuditRowOut(
                at=a.created_at,
                kind="profile",
                action=a.action,
                title=_PROFILE_ACTION_LABELS.get(a.action, a.action),
                detail=a.detail,
                actor_name=(actor.name or actor.username) if actor else None,
            )
        )

    # 2) Real order events.
    for o in analytics.order_history(customer_id):
        items.append(
            CustomerAuditRowOut(
                at=o.created_at,
                kind="order",
                action="order_placed",
                title=f"Đơn hàng {o.order_no}",
                detail=(
                    f"{_ORDER_KIND_LABELS.get(o.order_kind, o.order_kind)} · "
                    f"{_ORDER_STATUS_LABELS.get(o.status, o.status)}"
                    + (f" · {o.summary}" if o.summary and o.summary != '—' else "")
                ),
                ref_type="order",
                ref_id=o.id,
            )
        )

    # 3) Care events (#20) — hoạt động chăm sóc gộp vào cùng dòng thời gian.
    for ev in care_rows:
        actor_u = nguoi.get(ev.created_by) if ev.created_by is not None else None
        items.append(
            CustomerAuditRowOut(
                at=ev.happened_at,
                kind="care",
                action="care_event",
                title=_CARE_KIND_LABELS.get(ev.kind, ev.kind),
                detail=ev.note,
                actor_name=(actor_u.name or actor_u.username) if actor_u else None,
            )
        )

    # 4) Real quotation events.
    for qh in analytics.quote_history(customer_id):
        items.append(
            CustomerAuditRowOut(
                at=qh.created_at,
                kind="quote",
                action="quote_issued",
                title=f"Báo giá {qh.code} v{qh.version}",
                detail=_QUOTE_STATUS_LABELS.get(qh.status, qh.status),
                ref_type="quotation",
                ref_id=qh.id,
            )
        )

    items.sort(key=lambda r: r.at, reverse=True)
    return CustomerAuditOut(items=items)


@router.get("/{customer_id}/orders.csv")
def customer_order_history_csv(
    customer_id: int,
    svc: Service,
    so_lieu: SoLieu,
    authz: Authz,
    # Xuất file MẶC ĐỊNH BẬT: chỉ cần quyền Xem khách (gỡ quyền chi tiết `export` 24/08/2026).
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
    tu: date | None = Query(default=None),
    den: date | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    nhom: str | None = Query(default=None),
) -> Response:
    """Xuất Excel (CSV UTF-8 BOM) — ĐÚNG kỳ và bộ lọc đang xem trên tab Lịch sử mua hàng."""
    scope = _scope_for(authz, user)
    customer = _load_scoped(svc, customer_id, scope, user)
    tu, den = _ky(tu, den)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Mã đơn", "Ngày", "Loại đơn", "Sản phẩm", "Từ báo giá", "Trạng thái",
                "Thành tiền (VND)"])
    trang = 1
    while True:  # theo trang 200 dòng — không dựng một câu không giới hạn
        r = so_lieu.lich_su_don(customer_id, tu=tu, den=den, q=q, nhom=nhom, trang=trang, co=200)
        for d in r.items:
            w.writerow([
                d.order_no,
                d.created_at.date().isoformat(),
                _ORDER_KIND_LABELS.get(d.order_kind, d.order_kind),
                ", ".join(d.san_pham),
                d.bao_gia_ma or "",
                _ORDER_STATUS_LABELS.get(d.status, d.status),
                d.tong if d.tong is not None else "",
            ])
        if trang * 200 >= r.tong_so:
            break
        trang += 1
    # UTF-8 BOM so Excel opens Vietnamese correctly.
    data = b"\xef\xbb\xbf" + buf.getvalue().encode("utf-8")
    filename = f"lich-su-mua-hang-{customer.code}.csv"
    return Response(
        content=data,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.put("/{customer_id}", response_model=CustomerCreateOut)
def update_customer(
    customer_id: int,
    payload: CustomerUpdate,
    svc: Service,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> CustomerCreateOut:
    scope = _scope_for(authz, user)
    try:
        customer, duplicates = svc.update_customer(
            customer_id=customer_id,
            scope=scope,
            actor=user,
            name=payload.name,
            customer_kind=payload.customer_kind,
            tax_code=payload.tax_code,
            phone=payload.phone,
            email=payload.email,
            address=payload.address,
            contact_name=payload.contact_name,
            sale_user_id=payload.sale_user_id,
            allow_reassign=authz.can(user, MODULE, "reassign"),
        )
    except ReassignForbidden as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from None
    except CustomerValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
        ) from None
    except (CustomerNotFound, CustomerForbidden):
        # Do not leak existence of out-of-scope customers.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy khách hàng."
        ) from None
    names = _sale_names(
        users, {customer.sale_user_id} if customer.sale_user_id else set()
    )
    return CustomerCreateOut(
        customer=_row(customer, names),
        duplicate=_first_dup(duplicates),
        duplicates=_dup_warns(duplicates),
    )


@router.put("/{customer_id}/financial", response_model=CustomerDetailOut)
def update_customer_financial(
    customer_id: int,
    payload: CustomerFinancialIn,
    svc: Service,
    analytics: Analytics,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> CustomerDetailOut:
    """Sửa CHÍNH SÁCH TÀI CHÍNH khách (hạn mức + số ngày công nợ tối đa + rào chiết khấu/markup)
    — endpoint RIÊNG (redesign spec-06 v2), gate quyền chi tiết `set_credit_terms`. Ai cũng
    XEM qua GET detail; chỉ quyền này mới SỬA (thiếu → 403, KHÔNG đụng field định danh)."""
    if not authz.can(user, MODULE, "set_credit_terms"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền thiết lập chính sách tài chính khách hàng.",
        )
    scope = _scope_for(authz, user)
    try:
        customer = svc.update_financial(
            customer_id=customer_id,
            scope=scope,
            actor=user,
            credit_limit=payload.credit_limit,
            payment_term_days=payload.payment_term_days,
            discount_min_pct=payload.discount_min_pct,
            discount_max_pct=payload.discount_max_pct,
            markup_min_pct=payload.markup_min_pct,
            markup_max_pct=payload.markup_max_pct,
            ke_thue_tndn_pct=payload.ke_thue_tndn_pct,
            ke_min_pct=payload.ke_min_pct,
            ke_max_pct=payload.ke_max_pct,
        )
    except CustomerValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
        ) from None
    except (CustomerNotFound, CustomerForbidden):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy khách hàng."
        ) from None
    names = _sale_names(
        users, {customer.sale_user_id} if customer.sale_user_id else set()
    )
    stat = analytics.list_stats([customer]).per_customer.get(customer.id)
    tag_map = svc.customers.tags_for([customer.id])
    return CustomerDetailOut(
        customer=_row(customer, names, stat, tags=tag_map.get(customer.id)),
        receivable=_receivable_card(
            svc, customer, can_view=True  # Xem công nợ MẶC ĐỊNH BẬT (gỡ quyền `view_debt` 24/08/2026)
        ),
    )


# --- người liên hệ (#10–#11) --------------------------------------------------


@router.get("/{customer_id}/contacts", response_model=ContactsOut)
def list_contacts(
    customer_id: int,
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> ContactsOut:
    try:
        items = svc.list_contacts(
            customer_id=customer_id, scope=_scope_for(authz, user), actor=user
        )
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    return ContactsOut(items=[ContactOut.model_validate(c) for c in items])


@router.post("/{customer_id}/contacts", response_model=ContactOut, status_code=201)
def add_contact(
    customer_id: int,
    payload: ContactIn,
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> ContactOut:
    try:
        contact = svc.add_contact(
            customer_id=customer_id, scope=_scope_for(authz, user), actor=user,
            name=payload.name, title=payload.title, duty=payload.duty,
            phone=payload.phone, email=payload.email, is_primary=payload.is_primary,
        )
    except CustomerValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    return ContactOut.model_validate(contact)


@router.put("/{customer_id}/contacts/{contact_id}", response_model=ContactOut)
def update_contact(
    customer_id: int,
    contact_id: int,
    payload: ContactIn,
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> ContactOut:
    try:
        contact = svc.update_contact(
            customer_id=customer_id, contact_id=contact_id,
            scope=_scope_for(authz, user), actor=user,
            name=payload.name, title=payload.title, duty=payload.duty,
            phone=payload.phone, email=payload.email, is_primary=payload.is_primary,
        )
    except CustomerValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    return ContactOut.model_validate(contact)


@router.delete("/{customer_id}/contacts/{contact_id}", status_code=204)
def delete_contact(
    customer_id: int,
    contact_id: int,
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
):
    try:
        svc.delete_contact(
            customer_id=customer_id, contact_id=contact_id,
            scope=_scope_for(authz, user), actor=user,
        )
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None


# --- địa chỉ giao hàng (#9) -----------------------------------------------------


@router.get("/{customer_id}/addresses", response_model=AddressesOut)
def list_addresses(
    customer_id: int,
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> AddressesOut:
    try:
        items = svc.list_addresses(
            customer_id=customer_id, scope=_scope_for(authz, user), actor=user
        )
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    return AddressesOut(items=[AddressOut.model_validate(a) for a in items])


@router.post("/{customer_id}/addresses", response_model=AddressOut, status_code=201)
def add_address(
    customer_id: int,
    payload: AddressIn,
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> AddressOut:
    try:
        row = svc.add_address(
            customer_id=customer_id, scope=_scope_for(authz, user), actor=user,
            label=payload.label, address=payload.address, phone=payload.phone,
            note=payload.note, is_default=payload.is_default,
        )
    except CustomerValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    return AddressOut.model_validate(row)


@router.put("/{customer_id}/addresses/{address_id}", response_model=AddressOut)
def update_address(
    customer_id: int,
    address_id: int,
    payload: AddressIn,
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> AddressOut:
    try:
        row = svc.update_address(
            customer_id=customer_id, address_id=address_id,
            scope=_scope_for(authz, user), actor=user,
            label=payload.label, address=payload.address, phone=payload.phone,
            note=payload.note, is_default=payload.is_default,
        )
    except CustomerValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    return AddressOut.model_validate(row)


@router.delete("/{customer_id}/addresses/{address_id}", status_code=204)
def delete_address(
    customer_id: int,
    address_id: int,
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
):
    try:
        svc.delete_address(
            customer_id=customer_id, address_id=address_id,
            scope=_scope_for(authz, user), actor=user,
        )
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None


# --- chăm sóc: nhật ký + lịch hẹn (#20/#27/#28) --------------------------------


def _care_event_out(ev, names: dict[int, str]) -> CareEventOut:
    out = CareEventOut.model_validate(ev)
    if ev.created_by is not None:
        out.actor_name = names.get(ev.created_by)
    return out


def _care_task_out(svc: CustomerService, t, names: dict[int, str]) -> CareTaskOut:
    out = CareTaskOut.model_validate(t)
    if t.assignee_user_id is not None:
        out.assignee_name = names.get(t.assignee_user_id)
    out.tre = svc.la_tre(t.status, t.due_date)
    return out


@router.get("/{customer_id}/care", response_model=CareEventsOut)
def list_care_events(
    customer_id: int,
    svc: Service,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> CareEventsOut:
    try:
        items = svc.list_care_events(
            customer_id=customer_id, scope=_scope_for(authz, user), actor=user
        )
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    names = _sale_names(users, {e.created_by for e in items if e.created_by})
    return CareEventsOut(items=[_care_event_out(e, names) for e in items])


@router.post("/{customer_id}/care", response_model=CareEventOut, status_code=201)
def add_care_event(
    customer_id: int,
    payload: CareEventIn,
    svc: Service,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> CareEventOut:
    try:
        ev = svc.add_care_event(
            customer_id=customer_id, scope=_scope_for(authz, user), actor=user,
            kind=payload.kind, note=payload.note, happened_at=payload.happened_at,
        )
    except CustomerValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    names = _sale_names(users, {ev.created_by} if ev.created_by else set())
    return _care_event_out(ev, names)


@router.get("/{customer_id}/care-tasks", response_model=CareTasksOut)
def list_care_tasks(
    customer_id: int,
    svc: Service,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> CareTasksOut:
    try:
        items = svc.list_care_tasks(
            customer_id=customer_id, scope=_scope_for(authz, user), actor=user
        )
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    names = _sale_names(users, {t.assignee_user_id for t in items if t.assignee_user_id})
    on_time, late, overdue_open = svc.care_stats(items)
    return CareTasksOut(
        items=[_care_task_out(svc, t, names) for t in items],
        done_on_time=on_time,
        done_late=late,
        overdue_open=overdue_open,
    )


@router.post("/{customer_id}/care-tasks", response_model=CareTaskOut, status_code=201)
def add_care_task(
    customer_id: int,
    payload: CareTaskIn,
    svc: Service,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> CareTaskOut:
    try:
        task = svc.add_care_task(
            customer_id=customer_id, scope=_scope_for(authz, user), actor=user,
            note=payload.note, due_date=payload.due_date,
            assignee_user_id=payload.assignee_user_id,
            repeat_freq=payload.repeat_freq, repeat_interval=payload.repeat_interval,
            repeat_until=payload.repeat_until,
        )
    except CustomerValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    names = _sale_names(
        users, {task.assignee_user_id} if task.assignee_user_id else set()
    )
    return _care_task_out(svc, task, names)


@router.put("/{customer_id}/care-tasks/{task_id}/status", response_model=CareTaskOut)
def set_care_task_status(
    customer_id: int,
    task_id: int,
    payload: CareTaskStatusIn,
    svc: Service,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> CareTaskOut:
    try:
        task = svc.set_care_task_status(
            customer_id=customer_id, task_id=task_id,
            scope=_scope_for(authz, user), actor=user,
            status=payload.status, log_kind=payload.log_kind, log_note=payload.log_note,
        )
    except CustomerValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    names = _sale_names(
        users, {task.assignee_user_id} if task.assignee_user_id else set()
    )
    return _care_task_out(svc, task, names)


def _occ_out(users, occs: list[dict]) -> CareCalendarOut:
    names = _sale_names(users, {o["assignee_user_id"] for o in occs if o["assignee_user_id"]})
    items = []
    for o in occs:
        item = CareOccurrenceOut(**o)
        item.assignee_name = names.get(o["assignee_user_id"])
        items.append(item)
    return CareCalendarOut(items=items)


@router.get("/{customer_id}/care-calendar", response_model=CareCalendarOut)
def care_calendar(
    customer_id: int,
    from_: Annotated[datetime, Query(alias="from")],
    to: datetime,
    svc: Service,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> CareCalendarOut:
    """Lịch hẹn chăm sóc trong [from,to] cho 1 khách — bung cả lần lặp tương lai."""
    try:
        occs = svc.expand_occurrences(
            customer_id=customer_id, from_dt=from_, to_dt=to,
            scope=_scope_for(authz, user), actor=user,
        )
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    return _occ_out(users, occs)


@router.post("/{customer_id}/care-tasks/{head_id}/occurrence", response_model=CareCalendarOut)
def act_on_occurrence(
    customer_id: int,
    head_id: int,
    payload: OccurrenceActionIn,
    from_: Annotated[datetime, Query(alias="from")],
    to: datetime,
    svc: Service,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> CareCalendarOut:
    """Thao tác 1 lần hẹn (complete/cancel/reschedule/ghi) rồi TRẢ LẠI lịch [from,to] đã cập nhật."""
    try:
        svc.act_on_occurrence(
            customer_id=customer_id, head_id=head_id, action=payload.action,
            occurrence_date=payload.occurrence_date, new_due=payload.new_due,
            log_kind=payload.log_kind, log_note=payload.log_note, ket_qua=payload.ket_qua,
            scope=_scope_for(authz, user), actor=user,
        )
        occs = svc.expand_occurrences(
            customer_id=customer_id, from_dt=from_, to_dt=to,
            scope=_scope_for(authz, user), actor=user,
        )
    except CustomerValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    return _occ_out(users, occs)


# --- tài liệu đính kèm (#21) ------------------------------------------------------


@router.get("/{customer_id}/attachments", response_model=CustomerAttachmentsOut)
def list_attachments(
    customer_id: int,
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> CustomerAttachmentsOut:
    try:
        items = svc.list_attachments(
            customer_id=customer_id, scope=_scope_for(authz, user), actor=user
        )
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    return CustomerAttachmentsOut(
        items=[CustomerAttachmentOut.model_validate(a) for a in items]
    )


@router.post("/{customer_id}/attachments", response_model=CustomerAttachmentOut, status_code=201)
def upload_attachment(
    customer_id: int,
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
    file: UploadFile = File(...),
    doc_kind: str = Form(default="khac"),
) -> CustomerAttachmentOut:
    scope = _scope_for(authz, user)
    # Access check first so we don't write a file for an inaccessible customer.
    _load_scoped(svc, customer_id, scope, user)
    # Đọc có trần TRƯỚC khi ghi kho tệp (trước đây không giới hạn cỡ).
    data = doc_gioi_han(file, TRAN_TAI_LIEU)

    key, safe_name = make_key(_CRM_SUBDIR, customer_id, file.filename)
    get_storage().save(key, data, file.content_type)
    file_url = url_from_key(key)

    try:
        att = svc.add_attachment(
            customer_id=customer_id, scope=scope, actor=user, doc_kind=doc_kind,
            file_name=safe_name, file_url=file_url, file_type=file.content_type,
        )
    except (CustomerNotFound, CustomerForbidden):
        get_storage().delete(key)  # ghi tệp rồi mới lỗi ⇒ dọn, đừng để tệp mồ côi
        raise _not_found() from None
    return CustomerAttachmentOut.model_validate(att)


@router.delete("/{customer_id}/attachments/{attachment_id}", status_code=204)
def delete_attachment(
    customer_id: int,
    attachment_id: int,
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
):
    try:
        svc.delete_attachment(
            customer_id=customer_id, attachment_id=attachment_id,
            scope=_scope_for(authz, user), actor=user,
        )
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None


# --- ghi chú tự do (tab Ghi chú — lưu ý team về khách) --------------------------


def _note_out(n, names: dict[int, str]) -> NoteOut:
    out = NoteOut.model_validate(n)
    out.edited = n.updated_at is not None
    if n.created_by is not None:
        out.author_name = names.get(n.created_by)
    return out


@router.get("/{customer_id}/notes", response_model=NotesOut)
def list_notes(
    customer_id: int,
    svc: Service,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "read"))],
) -> NotesOut:
    """Ghi chú của khách — ghim lên đầu, còn lại mới-nhất-trước. Ai xem được hồ sơ đều xem."""
    try:
        items = svc.list_notes(
            customer_id=customer_id, scope=_scope_for(authz, user), actor=user
        )
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    names = _sale_names(users, {n.created_by for n in items if n.created_by})
    return NotesOut(items=[_note_out(n, names) for n in items])


@router.post("/{customer_id}/notes", response_model=NoteOut, status_code=201)
def add_note(
    customer_id: int,
    payload: NoteIn,
    svc: Service,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> NoteOut:
    try:
        note = svc.add_note(
            customer_id=customer_id, scope=_scope_for(authz, user), actor=user,
            body=payload.body,
        )
    except CustomerValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    names = _sale_names(users, {note.created_by} if note.created_by else set())
    return _note_out(note, names)


@router.put("/{customer_id}/notes/{note_id}", response_model=NoteOut)
def update_note(
    customer_id: int,
    note_id: int,
    payload: NoteUpdateIn,
    svc: Service,
    authz: Authz,
    users: Users,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
) -> NoteOut:
    """Sửa nội dung và/hoặc bật-tắt ghim (PUT lo cả hai; ghim không tính là 'đã sửa')."""
    try:
        note = svc.update_note(
            customer_id=customer_id, note_id=note_id,
            scope=_scope_for(authz, user), actor=user,
            body=payload.body, pinned=payload.pinned,
        )
    except CustomerValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None
    names = _sale_names(users, {note.created_by} if note.created_by else set())
    return _note_out(note, names)


@router.delete("/{customer_id}/notes/{note_id}", status_code=204)
def delete_note(
    customer_id: int,
    note_id: int,
    svc: Service,
    authz: Authz,
    user: Annotated[User, Depends(require_permission(MODULE, "update"))],
):
    try:
        svc.delete_note(
            customer_id=customer_id, note_id=note_id,
            scope=_scope_for(authz, user), actor=user,
        )
    except (CustomerNotFound, CustomerForbidden):
        raise _not_found() from None


# --- helpers ---------------------------------------------------------------


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy khách hàng."
    )


def _load_scoped(
    svc: CustomerService, customer_id: int, scope: str, user: User
) -> Customer:
    try:
        return svc.get_customer(customer_id=customer_id, scope=scope, actor=user)
    except (CustomerNotFound, CustomerForbidden):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy khách hàng."
        ) from None


def _dup_warns(duplicates: list[tuple[str, Customer]]) -> list[DuplicateWarn]:
    return [
        DuplicateWarn(field=f, id=c.id, code=c.code, name=c.name) for f, c in duplicates
    ]


def _first_dup(duplicates: list[tuple[str, Customer]]) -> DuplicateRef | None:
    """Back-compat: cảnh báo MST đầu tiên (shape cũ) — None nếu không trùng MST."""
    for f, c in duplicates:
        if f == "tax_code":
            return DuplicateRef(id=c.id, code=c.code, name=c.name)
    return None


def _receivable_card(
    svc: CustomerService, customer: Customer, *, can_view: bool = True
) -> ReceivableCard:
    """Build the read-only Công nợ card. On SEAM-16 (Công nợ chưa build) return an
    explicit unavailable card — NEVER a fabricated 0 (§34 L885 / spec KH-04).
    `can_view=False` (quyền chi tiết `view_debt` tắt) → ẩn số liệu công nợ."""
    if not can_view:
        return ReceivableCard(
            available=False,
            credit_limit=customer.credit_limit,
            message="Bạn không có quyền xem công nợ",
        )
    try:
        balance = svc.receivable_balance(customer.id)
    except ReceivableUnavailable:
        return ReceivableCard(
            available=False,
            credit_limit=customer.credit_limit,
            message="Chưa có phân hệ Công nợ",
        )
    limit = customer.credit_limit
    usage_pct = int(round(balance / limit * 100)) if limit > 0 else None
    return ReceivableCard(
        available=True,
        credit_limit=limit,
        balance=balance,
        usage_pct=usage_pct,
        # Vượt hạn mức = CẢNH BÁO, không chặn (§34 L885).
        over_limit=(limit > 0 and balance > limit),
    )
