"""Phiếu tăng ca routes (module `tang_ca`).

- NV tự gửi/hủy/xem phiếu của MÌNH: chỉ cần đăng nhập + có hồ sơ NV (không cần ô quyền riêng).
- Tổ trưởng duyệt: `approve` + scope `department` ⇒ chỉ đụng được người trong tổ mình + cây con.
- HCNS/Admin: `approve` + scope `all`.
Real-time: gửi/hủy → broadcast cho người duyệt; quyết định → đẩy thẳng tới NV nộp phiếu.
"""
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status

from ..deps import (
    get_current_user,
    CurrentUser,
    get_authorization_service,
    get_employee_repository,
    get_overtime_service,
    require_permission,
    require_any_permission,
)
from ..models.user import User
from ..doi_tuong_nhan import MAN_NHAN_SU
from ..realtime import hub
from ..repositories.employee_repo import EmployeeRepository
from ..repositories.loc_don_nhan_su import LocDon
from ..schemas.loc_danh_sach import LuaChonLoc
from ..schemas.overtime import (
    HuyDonIn,
    OtXinHuyChoDuyetListOut,
    OtXinHuyChoDuyetOut,
    QuyetXinHuyIn,
    XinHuyIn,
    YeuCauHuyOut,
    TranThangOut,
    MyOvertimeOut,
    OvertimeBulkIn,
    OvertimeBulkRejectIn,
    OvertimeBulkResultOut,
    OvertimeDecisionIn,
    OvertimeRejectIn,
    OvertimeRequestForIn,
    OvertimeRequestIn,
    OvertimeRequestOut,
    OvertimeRequestsOut,
    OvertimeRosterEmpOut,
    OvertimeRosterOut,
    OvertimeSummaryOut,
)
from ..services.thong_bao_man import bao
from ..services.overtime_service import (
    NoLinkedEmployee,
    OvertimeError,
    OvertimeForbidden,
    OvertimeNotFound,
    OvertimeService,
    OvertimeValidationError,
)
from ..services.rbac_service import AuthorizationService

router = APIRouter(prefix="/api/overtime", tags=["overtime"])

MODULE = "tang_ca"

# TỰ PHỤC VỤ (tách 10/08/2026) — một ô quyền cho MỌI việc người lao động làm với hồ sơ của CHÍNH
# MÌNH: tự chấm công, xem công/phiếu lương của mình, tự gửi đơn nghỉ / phiếu tăng ca / xin tạm ứng.
# Trước đây nhóm này không gác gì (chỉ cần đăng nhập) nên không có cách nào tắt cho một vai.
# Ba hàng rào cũ GIỮ NGUYÊN (phải có hồ sơ NV nối tài khoản · trong bán kính điểm chấm công · đúng
# khung giờ ca) — chúng chống lạm dụng, còn ô này chống truy cập.
# Ô `self_service` ĐÃ BỎ 15/08/2026 (chủ chốt). Dữ liệu của CHÍNH MÌNH là quyền đương nhiên của
# mọi tài khoản đăng nhập — xem công / phiếu / đơn của mình, và gửi · sửa · huỷ đơn của mình.
# Chặn nó là chặn người ta đi làm, chứ không bảo vệ được gì: mọi đường `/me` đã tự lọc theo hồ sơ
# gắn với tài khoản, không đọc sang ai được.
# Ba hàng rào thật GIỮ NGUYÊN: phải có hồ sơ NV nối tài khoản · trong bán kính điểm chấm công ·
# đúng khung giờ ca. Cái quyết định THẤY MÀN NÀO vẫn là ô của chính màn đó.
MODULE_TU_PHUC_VU = "self_service"
SelfUser = Annotated[User, Depends(get_current_user)]

# Ô THAO TÁC của Tự phục vụ (tách 11/08/2026). `SelfUser` (= `read`) chỉ cho XEM công / phiếu /
# đơn của chính mình; mọi đường GHI — chấm công, gửi · sửa · huỷ đơn nghỉ, phiếu tăng ca, xin đi
# muộn, xin tạm ứng, sửa hồ sơ của mình — đòi ô này.
# GHI LÀ GHI — phải có ô THAO TÁC của chính màn này (chủ chốt 15/08/2026: *"tôi chưa bật thao tác
# vẫn bấm gửi đơn được nè"*). Bấm giờ · gửi yêu cầu chỉnh công · xin đi muộn đều là ĐƯỜNG GHI,
# không phải "xem dữ liệu của mình".
#
# Khác với `SelfUser` (đọc phần của mình — quyền đương nhiên, xem chú thích ở trên).
SelfWriter = Annotated[User, Depends(require_permission(MODULE, "create"))]
# Sửa / huỷ phiếu: người TẠO tự làm với phiếu của mình, hoặc NGƯỜI DUYỆT làm hộ ⇒ nhận
# cả hai ô. Ai không có ô nào trong hai ô này thì không đụng được — trước đây chỉ cần
# đăng nhập là gọi được, đúng chỗ tester bắt.
SelfOrApprover = Annotated[
    # Người TẠO sửa/huỷ phiếu của mình ⇒ đòi ô THAO TÁC (`create`), không phải ô Xem. Người DUYỆT
    # làm hộ thì đi bằng ô duyệt của phân hệ. Trước 07/09/2026 chỗ này chỉ là `get_current_user`
    # (ghi chú nói một đằng, code một nẻo) ⇒ ai đăng nhập cũng gọi được PUT/cancel.
    User, Depends(require_any_permission((MODULE, "create"), (MODULE, "approve")))
]

Service = Annotated[OvertimeService, Depends(get_overtime_service)]
Employees = Annotated[EmployeeRepository, Depends(get_employee_repository)]
Authz = Annotated[AuthorizationService, Depends(get_authorization_service)]


def _scope(authz: AuthorizationService, user: User) -> str:
    """Phạm vi dữ liệu của người gọi trên module tăng ca. Mặc định `own` — hụt quyền thì siết
    chặt nhất, không mở toang."""
    return authz.scope_for(user, MODULE) or "own"


def _raise(exc: Exception) -> None:
    if isinstance(exc, OvertimeNotFound):
        raise HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, OvertimeForbidden):
        raise HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, (OvertimeValidationError, NoLinkedEmployee)):
        raise HTTPException(status_code=400, detail=str(exc))
    raise exc


def _out(r, emp_names: dict[int, str], decider_names: dict[int, str]) -> OvertimeRequestOut:
    o = OvertimeRequestOut.model_validate(r)
    o.employee_name = emp_names.get(r.employee_id)
    o.decided_by_name = decider_names.get(r.decided_by) if r.decided_by else None
    o.minutes = max(0, int(r.to_minute) - int(r.from_minute))
    return o


def _yc_out(yc, employees: EmployeeRepository,
            ten_theo_user: dict[int, str] | None = None) -> YeuCauHuyOut:
    """`ten_theo_user` có ⇒ tra tên người quyết trong đó (đã nạp gộp cho cả trang)."""
    o = YeuCauHuyOut.model_validate(yc)
    if yc.decided_by:
        if ten_theo_user is not None:
            o.decided_by_name = ten_theo_user.get(yc.decided_by)
        else:
            emp = employees.get_by_user_id(yc.decided_by)
            o.decided_by_name = emp.full_name if emp is not None else None
    return o


def _resolve(employees: EmployeeRepository, reqs: list,
             svc: OvertimeService | None = None) -> list[OvertimeRequestOut]:
    """`svc` có ⇒ kèm yêu cầu hủy mới nhất của từng phiếu (23/09/2026), một truy vấn cho cả trang.
    Tên người đứng phiếu / người duyệt / người quyết yêu cầu huỷ: nạp GỘP một lượt (26/10/2026 —
    trước đó mỗi người một câu SELECT)."""
    names = {eid: e.full_name for eid, e in employees.map_by_ids({r.employee_id for r in reqs}).items()}
    yc_map = svc.yeu_cau_huy_moi_nhat([r.id for r in reqs]) if svc is not None else {}
    # Người DUYỆT/từ chối là 1 user id → tra hồ sơ NV theo user_id (tổ trưởng/HCNS/GĐ đều có hồ sơ).
    uids = {r.decided_by for r in reqs if r.decided_by} | {yc.decided_by for yc in yc_map.values() if yc.decided_by}
    ten_theo_user = {uid: e.full_name for uid, e in employees.map_by_user_ids(uids).items()}
    decider_names = {uid: ten_theo_user[uid] for uid in {r.decided_by for r in reqs if r.decided_by}
                     if uid in ten_theo_user}
    out = [_out(r, names, decider_names) for r in reqs]
    for o in out:
        yc = yc_map.get(o.id)
        if yc is not None:
            o.yeu_cau_huy = _yc_out(yc, employees, ten_theo_user)
    return out


# --- real-time (bám hub SSE chung; event chỉ là TÍN HIỆU nhẹ, FE tự refetch số) ------------

def _notify_pending_changed() -> None:
    """Có phiếu mới/hủy → người xem màn nhân sự refetch badge (người duyệt thấy số nhảy ngay).
    Nhóm `nhan_su`: badge Tăng ca + các màn nhân sự cùng nhóm."""
    hub.gui({"type": "ot_pending_changed"}, quyen=MAN_NHAN_SU)


def _cham_cho_duyet(r, employees: EmployeeRepository, loai: str, actor_id: int) -> None:
    """Chấm đỏ Tăng ca cho người DUYỆT trong phạm vi phòng của người đứng tên phiếu."""
    emp = employees.get_by_id(r.employee_id)
    bao(employees.db, kenh="tang_ca", loai=loai, actor_id=actor_id, quyen="approve",
        phong_id=emp.department_id if emp else None, ma=str(r.id))


def _notify_decision(r, employees: EmployeeRepository, decision: str,
                     actor_id: int | None = None) -> None:
    """Duyệt/từ chối → đẩy tới ĐÚNG NV nộp phiếu; kèm broadcast để badge người duyệt hạ xuống."""
    emp = employees.get_by_id(r.employee_id)
    if emp is not None and emp.user_id is not None:
        hub.publish(emp.user_id, {"type": "ot_decision", "decision": decision,
                                  "code": emp.full_name})
        bao(employees.db, kenh="tang_ca", loai="tang_ca_quyet_dinh", actor_id=actor_id,
            nguoi_nhan=emp.user_id, ma=str(r.id))
    _notify_pending_changed()


# --- NV tự phục vụ ----------------------------------------------------------


@router.post("/me", response_model=OvertimeRequestOut, status_code=status.HTTP_201_CREATED)
def create_my_request(body: OvertimeRequestIn, svc: Service, employees: Employees,
                      user: SelfWriter):
    """TỰ PHỤC VỤ: chỉ cần đăng nhập + có hồ sơ NV — KHÔNG bắt ô quyền riêng, đúng khuôn
    `POST /api/attendance/me/adjust-request`. Mọi người lao động đều phải xin được tăng ca cho
    CHÍNH MÌNH; quyền `tang_ca:read` chỉ quyết định có thấy màn hay không, còn `approve` mới là
    thứ phân biệt người duyệt. (Không có hồ sơ NV → service trả 400.)"""
    try:
        r = svc.create_request(actor=user, work_date=body.work_date,
                               from_minute=body.from_minute, to_minute=body.to_minute,
                               reason=body.reason)
    except OvertimeError as exc:
        _raise(exc)
    _notify_pending_changed()
    _cham_cho_duyet(r, employees, "tang_ca_moi", user.id)
    return _resolve(employees, [r], svc)[0]


@router.get("/me", response_model=MyOvertimeOut)
def my_requests(svc: Service, employees: Employees, user: SelfUser,
                page: int = Query(default=1, ge=1),
                size: int = Query(default=20, ge=1, le=100),
                status_filter: str | None = None,
                # Kỳ: `tao` = ngày tạo phiếu (mặc định), `ngay_cong` = ngày làm thêm.
                tu_ngay: date | None = Query(default=None),
                den_ngay: date | None = Query(default=None),
                moc: str = Query(default="tao", pattern="^(tao|ngay_cong)$"),
                ):
    if not svc.has_employee(user=user):
        return MyOvertimeOut(has_employee=False, page=page, size=size)
    loc = LocDon(tu_ngay=tu_ngay, den_ngay=den_ngay, moc=moc)
    try:
        reqs, total, dem = svc.my_requests(user=user, loc=loc, status=status_filter,
                                           page=page, size=size)
    except OvertimeError as exc:
        _raise(exc)
    emp = employees.get_by_user_id(user.id)
    return MyOvertimeOut(has_employee=True,
                         employee_name=emp.full_name if emp is not None else None,
                         items=_resolve(employees, reqs, svc),
                         total=total, page=page, size=size, dem_theo_tab=dem)


@router.get("/summary", response_model=OvertimeSummaryOut)
def summary(svc: Service, authz: Authz, user: SelfUser):
    """Badge sidebar + chuông. `pending_in_scope` = None khi người gọi KHÔNG có quyền duyệt."""
    pending = None
    if authz.can(user, MODULE, "approve"):
        pending = svc.count_pending(scope=authz.scope_for(user, MODULE) or "own", actor=user)
    return OvertimeSummaryOut(pending_in_scope=pending,
                              my_decided_unseen=svc.my_unseen_count(user=user))


@router.get("/tran-thang", response_model=TranThangOut)
def tran_thang(svc: Service, employees: Employees, authz: Authz, user: SelfUser,
               year: int, month: int, employee_id: int | None = None,
               exclude_id: int | None = None):
    """Số dư trần giờ làm thêm tháng. Không truyền `employee_id` ⇒ của CHÍNH người gọi.

    Trần là luật của công ty, không phải dữ liệu nhạy cảm của người khác — nhưng vẫn chỉ cho xem
    người trong tầm duyệt của mình (kiểm thật từ 07/09/2026 — trước đó docstring nói vậy mà handler
    nhận mọi `employee_id`). Rẻ: 1 câu SUM."""
    if employee_id is None:
        emp = svc._employee_for_user(user)
        employee_id = emp.id
    else:
        emp = employees.get_by_id(employee_id)
        me = employees.get_by_user_id(user.id)
        la_toi = me is not None and emp is not None and me.id == emp.id
        if emp is None or not (la_toi or employees.can_access(
                employee=emp, scope=_scope(authz, user), actor=user)):
            raise HTTPException(status_code=403,
                                detail="Nhân viên này ngoài phạm vi quản lý của bạn.")
    return TranThangOut(**svc.tran_thang_info(employee_id, int(year), int(month),
                                              exclude_id=exclude_id))


@router.post("/mark-seen", status_code=204)
def mark_seen(svc: Service, user: SelfUser):
    svc.mark_seen(user=user)


@router.get("/roster", response_model=OvertimeRosterOut)
def roster(employees: Employees, authz: Authz,
           user: Annotated[User, Depends(require_permission(MODULE, "approve"))]) -> OvertimeRosterOut:
    """Thợ trong tầm của người duyệt — nuôi dropdown "Tạo hộ thợ". Đứng TRƯỚC `/{request_id}`:
    FastAPI khớp route theo thứ tự khai báo, để sau thì "roster" bị nuốt làm id và trả 422."""
    scope = _scope(authz, user)
    emps = [
        OvertimeRosterEmpOut(
            id=e.id, code=getattr(e, "code", None), full_name=e.full_name,
            department=getattr(getattr(e, "department", None), "name", None),
        )
        for e in employees.list_scoped_all(scope=scope, actor=user)
        if getattr(e, "status", None) != "resigned"
    ]
    emps.sort(key=lambda e: (e.full_name or "").lower())
    return OvertimeRosterOut(employees=emps)


# --- tổ trưởng / HCNS -------------------------------------------------------


@router.post("", response_model=OvertimeRequestOut, status_code=status.HTTP_201_CREATED)
def create_for_employee(body: OvertimeRequestForIn, svc: Service, employees: Employees, authz: Authz,
                        user: Annotated[User, Depends(require_permission(MODULE, "approve"))]):
    """Tổ trưởng tạo THẲNG cho thợ → duyệt luôn (không bắt thợ gửi rồi duyệt lại) — chỉ cho thợ
    TRONG PHẠM VI của mình (07/09/2026)."""
    try:
        r = svc.create_request(actor=user, work_date=body.work_date,
                               from_minute=body.from_minute, to_minute=body.to_minute,
                               reason=body.reason, employee_id=body.employee_id,
                               auto_approve=True, scope=_scope(authz, user))
    except OvertimeError as exc:
        _raise(exc)
    _notify_decision(r, employees, "approved", user.id)
    return _resolve(employees, [r], svc)[0]


@router.get("", response_model=OvertimeRequestsOut)
def list_requests(svc: Service, employees: Employees, authz: Authz,
                  user: Annotated[User, Depends(require_permission(MODULE, "read"))],
                  status_filter: str | None = None,
                  employee_id: int | None = Query(default=None),
                  page: int = Query(default=1, ge=1),
                  size: int = Query(default=20, ge=1, le=100),
                  tu_ngay: date | None = Query(default=None),
                  den_ngay: date | None = Query(default=None),
                  moc: str = Query(default="tao", pattern="^(tao|ngay_cong)$"),
                  phong: int | None = Query(default=None),
                  ):
    # `employee_id` / `phong` KHÔNG nới phạm vi — chỉ lọc THÊM bên trong phạm vi đã có.
    scope = authz.scope_for(user, MODULE) or "own"
    loc = LocDon(tu_ngay=tu_ngay, den_ngay=den_ngay, moc=moc, employee_id=employee_id, phong=phong)
    try:
        reqs, total, dem = svc.list_requests(scope=scope, actor=user, loc=loc, status=status_filter,
                                             page=page, size=size)
    except OvertimeError as exc:
        _raise(exc)
    return OvertimeRequestsOut(items=_resolve(employees, reqs, svc),
                               total=total, page=page, size=size, dem_theo_tab=dem)


@router.get("/loc/{truong}", response_model=list[LuaChonLoc])
def loc_lua_chon(truong: Annotated[str, Path(pattern="^(nhan_vien|phong)$")], svc: Service,
                 authz: Authz, user: Annotated[User, Depends(require_permission(MODULE, "read"))]):
    """Giá trị của điều kiện Nhân viên / Phòng ban ở tab Duyệt — chỉ người có phiếu trong phạm vi."""
    scope = authz.scope_for(user, MODULE) or "own"
    return [LuaChonLoc(**x) for x in svc.lua_chon(truong, scope=scope, actor=user)]


@router.post("/bulk-approve", response_model=OvertimeBulkResultOut)
def bulk_approve(body: OvertimeBulkIn, svc: Service, employees: Employees, authz: Authz,
                 user: Annotated[User, Depends(require_permission(MODULE, "approve"))]):
    done = svc.bulk_approve(actor=user, request_ids=body.ids, scope=_scope(authz, user))
    for r in done:
        _notify_decision(r, employees, "approved", user.id)
    ids = {r.id for r in done}
    return OvertimeBulkResultOut(done=sorted(ids),
                                 skipped=sorted(set(body.ids) - ids))


@router.post("/bulk-reject", response_model=OvertimeBulkResultOut)
def bulk_reject(body: OvertimeBulkRejectIn, svc: Service, employees: Employees, authz: Authz,
                user: Annotated[User, Depends(require_permission(MODULE, "approve"))]):
    try:
        done = svc.bulk_reject(actor=user, request_ids=body.ids, note=body.note,
                               scope=_scope(authz, user))
    except OvertimeError as exc:
        _raise(exc)
    for r in done:
        _notify_decision(r, employees, "rejected", user.id)
    ids = {r.id for r in done}
    return OvertimeBulkResultOut(done=sorted(ids),
                                 skipped=sorted(set(body.ids) - ids))


@router.post("/{request_id}/approve", response_model=OvertimeRequestOut)
def approve(request_id: int, body: OvertimeDecisionIn, svc: Service, employees: Employees,
            authz: Authz,
            user: Annotated[User, Depends(require_permission(MODULE, "approve"))]):
    try:
        r = svc.approve(actor=user, request_id=request_id, note=body.note,
                        scope=_scope(authz, user))
    except OvertimeError as exc:
        _raise(exc)
    _notify_decision(r, employees, "approved", user.id)
    return _resolve(employees, [r], svc)[0]


@router.post("/{request_id}/reject", response_model=OvertimeRequestOut)
def reject(request_id: int, body: OvertimeRejectIn, svc: Service, employees: Employees,
           authz: Authz,
           user: Annotated[User, Depends(require_permission(MODULE, "approve"))]):
    try:
        r = svc.reject(actor=user, request_id=request_id, note=body.note,
                       scope=_scope(authz, user))
    except OvertimeError as exc:
        _raise(exc)
    _notify_decision(r, employees, "rejected", user.id)
    return _resolve(employees, [r], svc)[0]


@router.put("/{request_id}", response_model=OvertimeRequestOut)
def update_my_request(request_id: int, body: OvertimeRequestIn, svc: Service, employees: Employees,
                      user: SelfOrApprover):
    """SỬA phiếu đang chờ duyệt — chỉ người tạo, chỉ khi pending (service chặn). Không cần ô quyền
    riêng (tự phục vụ, giống POST /me)."""
    try:
        r = svc.update_request(actor=user, request_id=request_id, work_date=body.work_date,
                               from_minute=body.from_minute, to_minute=body.to_minute,
                               reason=body.reason)
    except OvertimeError as exc:
        _raise(exc)
    _notify_pending_changed()
    return _resolve(employees, [r], svc)[0]


@router.post("/{request_id}/cancel", response_model=OvertimeRequestOut)
def cancel(request_id: int, svc: Service, employees: Employees, authz: Authz, user: SelfOrApprover,
           body: HuyDonIn | None = None):
    """Hủy THẲNG. Phiếu ĐÃ DUYỆT chỉ người duyệt hủy được, và phải ghi `ly_do` (23/09/2026) —
    người lao động đi đường `/xin-huy`."""
    try:
        truoc = svc.get_request(request_id)
        da_duyet = truoc is not None and truoc.status == "approved"
        r = svc.cancel(actor=user, request_id=request_id,
                       is_manager=authz.can(user, MODULE, "approve"), scope=_scope(authz, user),
                       ly_do=body.ly_do if body else None)
    except OvertimeError as exc:
        _raise(exc)
    # Huỷ hộ phiếu ĐÃ DUYỆT = thợ mất giấy phép tăng ca mà tối vẫn đi làm ⇒ 0đ; phải báo tới đúng người
    # như lúc duyệt/từ chối (bản rà liên thông D8, 08/09/2026). Tự huỷ phiếu chờ của mình chỉ hạ badge.
    if da_duyet:
        _notify_decision(r, employees, "cancelled", user.id)
    else:
        _notify_pending_changed()
    return _resolve(employees, [r], svc)[0]


# --- XIN HỦY phiếu ĐÃ DUYỆT (chủ chốt 23/09/2026 — docs/prd-xin-huy-don-da-duyet.md) -----------
# Y hệt đơn nghỉ phép: người lao động chỉ XIN; ai có quyền duyệt phiếu (trong phạm vi) thì quyết.
# Đã chấm VÀO tăng ca thì chặn xin hủy.


@router.get("/xin-huy", response_model=OtXinHuyChoDuyetListOut)
def xin_huy_cho_duyet(svc: Service, employees: Employees, authz: Authz,
                      user: Annotated[User, Depends(require_permission(MODULE, "approve"))]):
    pairs = svc.xin_huy_cho_duyet(scope=_scope(authz, user), actor=user)
    dons = _resolve(employees, [r for _, r in pairs], svc)
    return OtXinHuyChoDuyetListOut(items=[
        OtXinHuyChoDuyetOut(yeu_cau=_yc_out(yc, employees), don=don)
        for (yc, _), don in zip(pairs, dons)
    ])


@router.post("/{request_id}/xin-huy", response_model=OvertimeRequestOut)
def xin_huy(request_id: int, body: XinHuyIn, svc: Service, employees: Employees,
            user: SelfOrApprover):
    try:
        r, _ = svc.xin_huy(actor=user, request_id=request_id, ly_do=body.ly_do)
    except OvertimeError as exc:
        _raise(exc)
    _notify_pending_changed()
    _cham_cho_duyet(r, employees, "tang_ca_xin_huy", user.id)
    return _resolve(employees, [r], svc)[0]


@router.post("/xin-huy/{yc_id}/rut-lai", response_model=OvertimeRequestOut)
def rut_lai_xin_huy(yc_id: int, svc: Service, employees: Employees, user: SelfOrApprover):
    try:
        r, _ = svc.rut_lai_xin_huy(actor=user, yc_id=yc_id)
    except OvertimeError as exc:
        _raise(exc)
    _notify_pending_changed()
    return _resolve(employees, [r], svc)[0]


@router.post("/xin-huy/{yc_id}/quyet", response_model=OvertimeRequestOut)
def quyet_xin_huy(yc_id: int, body: QuyetXinHuyIn, svc: Service, employees: Employees,
                  authz: Authz,
                  user: Annotated[User, Depends(require_permission(MODULE, "approve"))]):
    try:
        r, _ = svc.quyet_xin_huy(actor=user, yc_id=yc_id, dong_y=body.dong_y,
                                 ghi_chu=body.ghi_chu, scope=_scope(authz, user))
    except OvertimeError as exc:
        _raise(exc)
    _notify_decision(r, employees, "huy_dong_y" if body.dong_y else "huy_giu_nguyen", user.id)
    return _resolve(employees, [r], svc)[0]
