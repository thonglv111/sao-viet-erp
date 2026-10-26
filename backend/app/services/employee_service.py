"""Employee (Hồ sơ nhân sự / `nhan_su`) business logic — lát #1.

Framework-agnostic: raises domain errors the router maps to HTTP. Enforces:
  - full_name required (non-blank);
  - CCCD / số sổ BHXH duplicates are SOFT warnings — the employee is STILL saved;
  - status / gender / event_type must be a known enum value;
  - every stage change (status / department / position) goes through a TRANSITION that
    writes an `employee_events` row (Quá trình công tác) — never a bare column edit;
  - a resigned employee's hồ sơ is read-only (edit blocked; only `reinstate` reopens it);
  - `user_id` link is 1–1 (one login ↔ at most one employee);
  - every create/update/transition writes an AuditLog (target `employee:<id>`).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from ..storage import get_storage, key_from_url
from ..models.role import SCOPE_ALL
from ..models.employee import (
    ATTACHMENT_DOC_KINDS,
    DOC_KHAC,
    EMPLOYEE_STATUSES,
    EVENT_CONFIRMED,
    EVENT_HIRED,
    EVENT_LEAVE_END,
    EVENT_LEAVE_START,
    EVENT_PROBATION_ENDED,
    EVENT_PROBATION_RESTARTED,
    EVENT_PROMOTED,
    EVENT_REINSTATED,
    EVENT_RESIGNED,
    EVENT_SUSPENDED,
    EVENT_TRANSFERRED,
    EVENT_UNSUSPENDED,
    EVENT_UNSUSPENDED,
    GENDERS,
    SHIFT_LOG_ACTION_REMOVE,
    SHIFT_LOG_ACTION_SET,
    SHIFT_LOG_KIND_BASE,
    SHIFT_LOG_ORIGIN_BASE_BULK,
    SHIFT_LOG_ORIGIN_BASE_PANEL,
    SHIFT_LOG_ORIGIN_BASE_REMOVE,
    SHIFT_LOG_ORIGIN_PROFILE,
    STATUS_ACTIVE,
    STATUS_ON_LEAVE,
    STATUS_PROBATION,
    STATUS_PROBATION_ENDED,
    STATUS_RESIGNED,
    STATUS_SUSPENDED,
    Employee,
)
from ..models.profile_request import REQ_CANCELLED, REQ_PENDING
from ..config import settings
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.employee_repo import EmployeeRepository
from ..repositories.rbac_repo import DepartmentRepository
from ..repositories.user_repo import UserRepository
from ..quyen_notify import bao_quyen_doi
from ..security import hash_password
from ..shift_notify import push_shift_changes
from .leave_service import hom_nay_vn
from .ky_luong_guard import ly_do_ky_luong_da_khoa

# Mốc bật "tự đánh dấu HẾT THỬ VIỆC" (chủ chốt 22/08/2026). Hồ sơ có NGÀY HẾT THỬ VIỆC TRƯỚC
# mốc này là dữ liệu tồn từ thời chưa có tính năng — máy KHÔNG đụng, để HCNS tự xử. Đụng vào là
# tự ý đổi trạng thái hàng loạt người mà mình không biết đầu đuôi (đạt hay không đạt, có định cho
# nghỉ hay không).
MOC_TU_DANH_DAU_HET_THU_VIEC = date(2026, 8, 22)

# "Sắp hết thử việc" = đang thử việc và ngày hết thử việc rơi trong N ngày tới (kể cả hôm nay).
# MỘT luật cho cả ô KPI lẫn bộ lọc danh sách/xuất Excel — hai nơi tự tính là hai con số lệch nhau.
SAP_HET_THU_VIEC_NGAY = 30


def khoang_sap_het_thu_viec(hom_nay: date | None = None) -> tuple[date, date]:
    tu = hom_nay or date.today()
    return tu, tu + timedelta(days=SAP_HET_THU_VIEC_NGAY)

# Status transitions: kind → (allowed from-statuses, resulting status, event_type).
# `probation_end` là đường DUY NHẤT máy tự đi (xem `tu_danh_dau_het_thu_viec`); mọi kind còn lại
# vẫn phải có người bấm.
_STATUS_TRANSITIONS: dict[str, tuple[set[str], str, str]] = {
    "probation_end": ({STATUS_PROBATION}, STATUS_PROBATION_ENDED, EVENT_PROBATION_ENDED),
    # Vẫn cho xác nhận SỚM (đang thử việc, chưa tới hạn) — HCNS quyết thì khỏi chờ hết hạn.
    "confirm": ({STATUS_PROBATION, STATUS_PROBATION_ENDED}, STATUS_ACTIVE, EVENT_CONFIRMED),
    "leave_start": ({STATUS_ACTIVE}, STATUS_ON_LEAVE, EVENT_LEAVE_START),
    "leave_end": ({STATUS_ON_LEAVE}, STATUS_ACTIVE, EVENT_LEAVE_END),
    "suspend": ({STATUS_PROBATION, STATUS_PROBATION_ENDED, STATUS_ACTIVE, STATUS_ON_LEAVE},
                STATUS_SUSPENDED, EVENT_SUSPENDED),
    "resign": ({STATUS_PROBATION, STATUS_PROBATION_ENDED, STATUS_ACTIVE, STATUS_ON_LEAVE,
                STATUS_SUSPENDED}, STATUS_RESIGNED, EVENT_RESIGNED),
    "reinstate": ({STATUS_RESIGNED}, STATUS_ACTIVE, EVENT_REINSTATED),
    # Gỡ đình chỉ (test luồng 08/09/2026: đình chỉ xong không có đường quay lại). Trạng thái đích ở
    # đây chỉ là MẶC ĐỊNH — `_apply_status` thay bằng trạng thái TRƯỚC khi đình chỉ (thử việc vẫn
    # là thử việc: tiền 85%, chưa BHXH), xem `_trang_thai_truoc_dinh_chi`.
    "unsuspend": ({STATUS_SUSPENDED}, STATUS_ACTIVE, EVENT_UNSUSPENDED),
    # Chuyển về thử việc (24/10/2026): khai nhầm "Đang làm việc" lúc vào làm, hoặc cho thử việc lại.
    # Trước đây không có đường nào về Thử việc. Bắt khai Ngày hết thử việc mới như lúc tạo hồ sơ.
    "probation_restart": ({STATUS_ACTIVE, STATUS_PROBATION_ENDED}, STATUS_PROBATION,
                          EVENT_PROBATION_RESTARTED),
}
# Nhãn trạng thái cho dòng nhật ký — khớp chữ trên màn Nhân sự.
_NHAN_TRANG_THAI = {
    STATUS_PROBATION: "Thử việc", STATUS_PROBATION_ENDED: "Hết thử việc",
    STATUS_ACTIVE: "Đang làm việc", STATUS_ON_LEAVE: "Nghỉ dài hạn",
    STATUS_SUSPENDED: "Đình chỉ", STATUS_RESIGNED: "Đã nghỉ việc",
}
# Fields the plain edit (PUT) may set — deliberately EXCLUDES status/department_id
# and resign_*, which only a transition may change.
EDITABLE_FIELDS = (
    "full_name", "position", "probation_end_date", "date_of_birth", "gender",
    # `hire_date` sửa được (bản rà liên thông A11, 08/09/2026): nhập sai ngày vào là mọi luật biên
    # chế / mốc ca nền dựa số sai mà chỉ còn cách sửa DB tay. Bắt buộc có giá trị (xem update).
    "hire_date",
    "national_id", "national_id_date", "national_id_place", "phone", "email",
    "permanent_address", "current_address", "emergency_contact_name",
    "emergency_contact_phone", "social_insurance_no", "pit_tax_code",
    "dependents_count", "bank_account", "bank_name", "default_shift_id",
    "photo_url", "note",
    # Cách tính thuế TNCN (luy_tien / khau_tru_10 / cam_ket_08) — chủ 2026-07-27.
    "pit_mode",
)

# Nhân viên tự sửa ("Hồ sơ của tôi") — CHỈ các field liên lạc, không đụng định danh/pháp
# lý/tiền. Backend là cổng thật: whitelist cứng, không tin FE.
SELF_EDITABLE_FIELDS = (
    "phone", "email", "current_address", "emergency_contact_name", "emergency_contact_phone",
)

# NV chỉ được ĐỀ NGHỊ đổi (HCNS duyệt mới áp) — các field định danh/pháp lý/ngân hàng.
REQUESTABLE_FIELDS = (
    "full_name", "date_of_birth", "national_id", "national_id_date", "national_id_place",
    "permanent_address", "bank_account", "bank_name", "dependents_count",
)

# Field lương/BHXH nhạy cảm — chỉ GHI được nếu actor có quyền `nhan_su:edit_salary` (N5).
# Dùng CHUNG với router (che khi đọc `_mask_salary`) để đọc/ghi đối xứng, không lệch danh sách.
SENSITIVE_FIELDS = (
    "social_insurance_no", "pit_tax_code", "bank_account", "bank_name",
    # `pit_mode` quyết định TIỀN THUẾ của người đó ⇒ chỉ người có quyền sửa lương mới được đổi.
    "pit_mode",
)


class EmployeeError(Exception):
    """Base for employee domain errors."""


class EmployeeValidationError(EmployeeError):
    """A field failed validation, or an illegal state transition was requested."""


class EmployeeNotFound(EmployeeError):
    """No employee with that id (or not visible under the caller's scope)."""


class EmployeeForbidden(EmployeeError):
    """The employee exists but is outside the caller's data scope."""


# Nhãn tiếng Việt của cột hồ sơ — CHỈ để ghép câu báo lỗi cho người đang gõ ("Số tài khoản tối
# đa 30 ký tự"), không phải nguồn hiển thị của FE (FE có bảng nhãn riêng).
FIELD_LABELS: dict[str, str] = {
    "full_name": "Họ tên", "position": "Chức danh", "national_id": "CCCD",
    "national_id_place": "Nơi cấp CCCD", "phone": "Điện thoại", "email": "Email",
    "permanent_address": "Hộ khẩu", "current_address": "Chỗ ở hiện tại",
    "emergency_contact_name": "Người liên hệ khẩn", "emergency_contact_phone": "SĐT người liên hệ",
    "social_insurance_no": "Số sổ BHXH", "pit_tax_code": "MST cá nhân",
    "bank_account": "Số tài khoản", "bank_name": "Ngân hàng",
    "note": "Ghi chú",
}


def _max_len(field: str) -> int | None:
    """Số ký tự tối đa của một cột hồ sơ, ĐỌC THẲNG TỪ MODEL (`String(n)`) chứ không chép tay —
    đổi độ dài cột thì chỗ này theo ngay, không có bảng số thứ hai để lệch."""
    col = Employee.__table__.columns.get(field)
    return getattr(getattr(col, "type", None), "length", None)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


class EmployeeService:
    def __init__(
        self,
        employees: EmployeeRepository,
        audit: AuditLogRepository,
        users: UserRepository,
        departments: DepartmentRepository,
    ) -> None:
        self.employees = employees
        self.audit = audit
        self.users = users
        self.departments = departments

    # --- validation helpers -------------------------------------------------

    @staticmethod
    def _validate_name(name: str | None) -> str:
        name = (name or "").strip()
        if not name:
            raise EmployeeValidationError("Họ tên là bắt buộc.")
        return name

    @staticmethod
    def _validate_gender(gender: str | None) -> str | None:
        gender = _clean(gender)
        if gender is not None and gender not in GENDERS:
            raise EmployeeValidationError("Giới tính không hợp lệ.")
        return gender

    @staticmethod
    def _validate_status(status: str | None) -> str:
        status = (status or STATUS_PROBATION).strip()
        if status not in EMPLOYEE_STATUSES:
            raise EmployeeValidationError("Trạng thái không hợp lệ.")
        return status

    @staticmethod
    def _bat_buoc_ngay_het_thu_viec(status: str | None, probation_end_date) -> None:
        """Hồ sơ ở trạng thái Thử việc BẮT BUỘC khai Ngày hết thử việc (chủ chốt 22/08/2026).

        Không phải thủ tục giấy tờ: đó là mốc DUY NHẤT máy dựa vào để tự đánh dấu hết thử việc.
        Bỏ trống thì người đó nằm lại Thử việc vô thời hạn và ăn hệ số thử việc mãi — đúng cái lỗ
        mà tính năng này sinh ra để bịt. Chặn ở NGUỒN rẻ hơn đi dò sau."""
        if status == STATUS_PROBATION and probation_end_date is None:
            raise EmployeeValidationError(
                "Hồ sơ thử việc phải khai 'Ngày hết thử việc' — hệ thống dựa vào ngày này để "
                "tự đánh dấu hết thử việc khi tới hạn."
            )

    def _validate_code(self, code: str | None) -> str | None:
        """Mã NV do người khai đưa vào (chỉ đường Nhập Excel). Chuẩn hoá HOA + bỏ khoảng
        trắng để 'nv007' và 'NV007 ' là MỘT mã, rồi chặn trùng."""
        code = (code or "").strip().upper()
        if not code:
            return None
        if len(code) > 20:
            raise EmployeeValidationError("Mã nhân viên tối đa 20 ký tự.")
        if self.employees.find_by_code(code) is not None:
            raise EmployeeValidationError(f"Mã {code} đã có người khác dùng.")
        return code

    @staticmethod
    def _validate_dependents(n: int | None) -> int:
        if n is None:
            return 0
        if not isinstance(n, int) or isinstance(n, bool) or n < 0:
            raise EmployeeValidationError("Số người phụ thuộc phải là số nguyên ≥ 0.")
        return n

    @staticmethod
    def _check_len(field: str, value: str | None) -> str | None:
        """Chặn chuỗi DÀI HƠN CỘT ngay tại cửa vào.

        Vì sao phải đo ở đây: `profile_update_requests.changes` là JSON — NV gõ dài bao nhiêu
        cũng LƯU ĐƯỢC lúc gửi đề nghị, nhưng mãi tới lúc HCNS bấm Duyệt mới đem ghi vào cột
        thật (`bank_account` chỉ 30 ký tự) ⇒ Postgres nổ `value too long`, người DUYỆT lãnh
        lỗi 500 thay cho người GÕ. Đo tại đây thì người gõ nhận câu tiếng Việt ngay lúc gửi,
        và đề nghị cũ lỡ quá dài cũng ra 400 có chữ chứ không phải 500 trắng."""
        limit = _max_len(field)
        if value is not None and limit is not None and len(value) > limit:
            raise EmployeeValidationError(
                f"{FIELD_LABELS.get(field, field)} tối đa {limit} ký tự (đang nhập {len(value)})."
            )
        return value

    def _clean_fields(self, fields: dict) -> dict:
        """Trim string inputs; validate the constrained ones. Returns a cleaned copy
        containing only recognised employee columns."""
        out: dict = {}
        for key, value in fields.items():
            if key == "full_name":
                out[key] = self._check_len(key, self._validate_name(value))
            elif key == "gender":
                out[key] = self._validate_gender(value)
            elif key == "dependents_count":
                out[key] = self._validate_dependents(value)
            elif isinstance(value, str):
                out[key] = self._check_len(key, _clean(value))
            else:
                out[key] = value
        return out

    def _sync_user_from_employee(self, employee, *, commit: bool = True) -> None:
        """Đồng bộ danh tính hồ sơ → tài khoản đã gắn (Đ1: hồ sơ là nguồn). No-op nếu chưa
        gắn tài khoản. Ảnh chỉ ghi khi hồ sơ có ảnh (repo tự lo)."""
        if employee.user_id is None:
            return
        user = self.users.get_by_id(employee.user_id)
        if user is not None:
            self.users.sync_from_employee(
                user, name=employee.full_name,
                department_id=employee.department_id, avatar_url=employee.photo_url,
                commit=commit,
            )

    # --- reads --------------------------------------------------------------

    def list_employees(self, *, ending_soon: bool = False, **kwargs) -> tuple[list[Employee], int]:
        return self.employees.list(
            probation_end_range=khoang_sap_het_thu_viec() if ending_soon else None, **kwargs
        )

    def list_scoped_all(self, *, scope: str, actor) -> list[Employee]:
        return self.employees.list_scoped_all(scope=scope, actor=actor)

    def employee_kpis(self, *, scope: str, actor) -> dict[str, int]:
        """Dải KPI màn Nhân sự trên TOÀN phạm vi quyền (không theo bộ lọc hay trang đang xem)."""
        by_status, sap_het = self.employees.count_by_status(
            scope=scope, actor=actor, probation_end_range=khoang_sap_het_thu_viec(),
        )
        return {
            "total": sum(by_status.values()),
            "active": by_status.get(STATUS_ACTIVE, 0),
            "probation": by_status.get(STATUS_PROBATION, 0),
            "probation_ended": by_status.get(STATUS_PROBATION_ENDED, 0),
            "on_leave": by_status.get(STATUS_ON_LEAVE, 0),
            "resigned": by_status.get(STATUS_RESIGNED, 0),
            "probation_ending_soon": sap_het,
        }

    def current_shift(self, employee: Employee) -> tuple[int | None, str | None]:
        """(id, tên) CA NỀN đang hiệu lực hôm nay — cùng luật `base_shift_id_on` với Chấm công.

        `default_shift_id` là mốc MỚI NHẤT kể cả mốc tương lai nên không dùng thẳng được. Trước đây
        tab Thông tin tự tải cả lịch sử mốc + cả danh mục ca để tự suy — hai lời gọi thừa mỗi lần mở
        hồ sơ, và danh mục ca đòi quyền Khai ca nên HCNS không có quyền đó thấy "chưa gán" oan."""
        shift_id = self.employees.base_shift_id_on(employee, date.today())
        if shift_id is None:
            return None, None
        return shift_id, self.employees.shift_name(shift_id)

    def current_shift_hours(self, shift_id: int | None) -> str | None:
        """Giờ vào–ra của ca ("08:00–17:00") — màn "Hồ sơ của tôi" không gọi được danh mục ca
        (`/attendance/shifts` đòi quyền Khai ca) nên máy chủ đưa sẵn kèm tên ca."""
        if shift_id is None:
            return None
        s = self.employees.get_shift(shift_id)
        if s is None:
            return None
        hhmm = lambda m: f"{m // 60:02d}:{m % 60:02d}"  # noqa: E731
        return f"{hhmm(s.start_minute)}–{hhmm(s.end_minute)}"

    def today_shift_override(self, employee: Employee, on: date | None = None) -> dict | None:
        """Lưới phân ca có khai RIÊNG cho hôm nay và khác ca nền ⇒ {"off", "name", "hours"}.

        Ô "Ca làm việc" của "Hồ sơ của tôi" hiện CA NỀN; hôm nay bị xếp ca khác (hoặc nghỉ theo
        lịch) mà không nói thì nhân viên đi làm sai giờ. Ngày thường (không có ô lưới, hoặc ô
        trùng ca nền) trả None — màn không thêm dòng nào. Cùng luật ưu tiên với `shift_id_on`."""
        on = on or hom_nay_vn()
        day = self.employees.shift_day_on(employee.id, on)
        if day is None:
            return None
        if day.shift_id is not None:
            if day.shift_id == self.employees.base_shift_id_on(employee, on):
                return None
            return {"off": False, "name": self.employees.shift_name(day.shift_id),
                    "hours": self.current_shift_hours(day.shift_id)}
        if day.is_off:
            return {"off": True, "name": None, "hours": None}
        return None

    def direct_manager(self, employee: Employee) -> dict | None:
        """Quản lý trực tiếp = người đứng đầu GẦN NHẤT tính từ phòng của nhân viên trở lên.

        Phòng chưa chỉ định người đứng đầu (hoặc người đứng đầu chính là nhân viên này, hoặc
        tài khoản đó đã khoá) thì lần lên phòng cha, tới gốc cây mà vẫn không có thì trả None.
        `inherited` = người tìm được đứng đầu một phòng CẤP TRÊN chứ không phải phòng mình."""
        dept_id = employee.department_id
        seen: set[int] = set()
        while dept_id is not None and dept_id not in seen:
            seen.add(dept_id)
            d = self.departments.get_by_id(dept_id)
            if d is None:
                return None
            head_id = d.head_user_id
            if head_id is not None and head_id != employee.user_id:
                u = self.users.get_by_id(head_id)
                if u is not None and u.is_active:
                    return {
                        "name": u.name or u.username,
                        "avatar_url": u.avatar_url,
                        "dept_name": d.name,
                        "inherited": d.id != employee.department_id,
                    }
            dept_id = d.parent_id
        return None

    def get_employee(self, *, employee_id: int, scope: str, actor) -> Employee:
        employee = self.employees.get_by_id(employee_id)
        if employee is None:
            raise EmployeeNotFound("Không tìm thấy nhân viên.")
        if not self.employees.can_access(employee=employee, scope=scope, actor=actor):
            raise EmployeeForbidden("Bạn không có quyền xem nhân viên này.")
        return employee

    def find_duplicates(
        self, *, national_id: str | None, social_insurance_no: str | None, exclude_id: int | None = None
    ) -> tuple[Employee | None, Employee | None]:
        """(dup_by_CCCD, dup_by_BHXH) — soft warnings; either may be None. A row matching
        `exclude_id` (itself, on edit) is not a duplicate."""
        dup_nid = self.employees.find_by_national_id(_clean(national_id))
        dup_si = self.employees.find_by_social_insurance_no(_clean(social_insurance_no))
        if dup_nid is not None and dup_nid.id == exclude_id:
            dup_nid = None
        if dup_si is not None and dup_si.id == exclude_id:
            dup_si = None
        return dup_nid, dup_si

    def list_events(self, *, employee_id: int, scope: str, actor):
        self.get_employee(employee_id=employee_id, scope=scope, actor=actor)
        return self.employees.list_events(employee_id)

    def list_attachments(self, *, employee_id: int, scope: str, actor):
        self.get_employee(employee_id=employee_id, scope=scope, actor=actor)
        return self.employees.list_attachments(employee_id)

    # --- create -------------------------------------------------------------

    def create_employee(
        self,
        *,
        actor,
        department_id: int | None,
        status: str | None,
        hire_date: date | None,
        fields: dict,
        can_edit_salary: bool = True,
        code: str | None = None,
    ) -> tuple[Employee, Employee | None, Employee | None]:
        """Create an employee, record the first 'hired' event, return
        (employee, dup_by_CCCD, dup_by_BHXH). A duplicate does NOT block creation.

        `code` bỏ trống ⇒ máy tự cấp NV001, NV002… Chỉ lượt NHẬP EXCEL truyền mã vào, để file
        xuất từ máy này nạp sang máy khác mà mã NV không lệch (xem `services/employee_excel.py`).
        Mã trùng thì CHẶN — trùng mã là hai người cùng một khoá nghiệp vụ."""
        status = self._validate_status(status)
        code = self._validate_code(code)
        # N5: thiếu quyền edit_salary → bỏ field lương/BHXH ngay khi tạo (không lưu lén).
        if not can_edit_salary:
            fields = {k: v for k, v in fields.items() if k not in SENSITIVE_FIELDS}
        clean = self._clean_fields(fields)
        clean["full_name"] = self._validate_name(clean.get("full_name"))
        self._bat_buoc_ngay_het_thu_viec(status, clean.get("probation_end_date"))

        dup_nid, dup_si = self.find_duplicates(
            national_id=clean.get("national_id"),
            social_insurance_no=clean.get("social_insurance_no"),
        )

        # Hồ sơ + mốc ca + mốc "Vào làm" + nhật ký là MỘT giao dịch, chốt một lần ở `audit.create`
        # (bản cũ chốt 3–4 lần; gãy giữa chừng là hồ sơ có mà thiếu mốc Quá trình công tác).
        employee = self.employees.create(
            code=code,
            department_id=department_id,
            status=status,
            hire_date=hire_date,
            commit=False,
            **clean,
        )
        if employee.default_shift_id is not None:
            self.employees.set_shift_assignment(
                employee=employee,
                shift_id=employee.default_shift_id,
                effective_from=hire_date or date.today(),
                created_by=actor.id,
                commit=False,
            )
        # First stage on the Quá trình công tác timeline (effective = ngày vào).
        self.employees.add_event(
            employee_id=employee.id,
            event_type=EVENT_HIRED,
            effective_date=hire_date,
            field="status",
            from_value=None,
            to_value=status,
            note="Vào làm",
            actor_user_id=actor.id,
            commit=False,
        )
        self.audit.create(
            actor_user_id=actor.id,
            action="create_employee",
            target=f"employee:{employee.id}",
            detail=f"{employee.code} {employee.full_name}",
        )
        return employee, dup_nid, dup_si

    # --- edit (no stage change) --------------------------------------------

    def update_employee(
        self, *, employee_id: int, scope: str, actor, fields: dict,
        can_edit_salary: bool = True,
    ) -> tuple[Employee, Employee | None, Employee | None]:
        """Edit hồ sơ (personal / BHXH / contacts). Does NOT touch status /
        department (those are transitions). Blocked once resigned."""
        employee = self.get_employee(employee_id=employee_id, scope=scope, actor=actor)
        if employee.status == STATUS_RESIGNED:
            raise EmployeeValidationError(
                "Hồ sơ đã nghỉ việc (khóa sửa). Dùng 'Tuyển lại' nếu cần mở lại."
            )
        clean = {k: v for k, v in fields.items() if k in EDITABLE_FIELDS}
        # N5: thiếu quyền edit_salary → bỏ field lương/BHXH khỏi bản ghi (không chặn cả request).
        if not can_edit_salary:
            clean = {k: v for k, v in clean.items() if k not in SENSITIVE_FIELDS}
        clean = self._clean_fields(clean)
        if "full_name" in clean:
            clean["full_name"] = self._validate_name(clean["full_name"])
        if "hire_date" in clean:
            if clean["hire_date"] is None:
                raise EmployeeValidationError("Ngày vào làm không được để trống.")
            if employee.resign_date is not None and clean["hire_date"] >= employee.resign_date:
                raise EmployeeValidationError("Ngày vào làm phải trước ngày nghỉ việc.")
        # `status` KHÔNG nằm trong EDITABLE_FIELDS nên đây luôn là trạng thái hiện hành. Hồ sơ cũ
        # đang thử việc mà bỏ trống ngày sẽ bị chặn cho tới khi khai bù — cách duy nhất dọn hết
        # tồn mà không phải sửa dữ liệu bằng tay.
        # Chỉ chặn ĐƯỜNG HCNS SỬA HỒ SƠ. NV tự sửa liên lạc (`update_my_contact`) và HCNS duyệt
        # yêu cầu sửa (`decide_update_request`) đi đường khác, không vướng chốt này — người lao
        # động không khai được ngày hết thử việc nên chặn họ là chặn oan.
        self._bat_buoc_ngay_het_thu_viec(
            employee.status, clean.get("probation_end_date", employee.probation_end_date))

        dup_nid, dup_si = self.find_duplicates(
            national_id=clean.get("national_id", employee.national_id),
            social_insurance_no=clean.get("social_insurance_no", employee.social_insurance_no),
            exclude_id=employee.id,
        )
        shift_marker = clean.pop("default_shift_id", ...)
        # Cả lần sửa (hồ sơ + mốc ca + tài khoản + nhật ký) chốt MỘT lần ở `audit.create`.
        self.employees.update(employee, commit=False, **clean)
        logs = []
        if shift_marker is not ... and shift_marker != employee.default_shift_id:
            today = date.today()
            log = self._log_base_shift(
                employee=employee, origin=SHIFT_LOG_ORIGIN_PROFILE,
                effective_from=today, shift_id_after=shift_marker, actor=actor)
            if log is not None:
                logs.append(log)
            self.employees.set_shift_assignment(
                employee=employee,
                shift_id=shift_marker,
                effective_from=today,
                created_by=actor.id,
                commit=False,
            )
        # Đ1: đồng bộ tên/ảnh/phòng xuống tài khoản
        self._sync_user_from_employee(employee, commit=False)
        self.audit.create(
            actor_user_id=actor.id,
            action="update_employee",
            target=f"employee:{employee.id}",
            detail=f"{employee.code} sửa hồ sơ",
        )
        push_shift_changes(logs, db=self.employees.db)  # SAU commit
        return employee, dup_nid, dup_si

    def _log_base_shift(self, *, employee, origin: str, effective_from: date,
                        shift_id_after: int | None, actor, action: str = SHIFT_LOG_ACTION_SET,
                        shift_id_before: int | None = ...):
        """Ghi lịch sử cho một lần đổi CA NỀN. KHÔNG commit — đi cùng transaction của caller.

        ⚠️ Gọi TRƯỚC `set_shift_assignment` (nếu không thì `shift_id_before` đọc ra chính giá
        trị vừa ghi). `shift_id_before=...` = tự đọc ca nền đang hiệu lực tại `effective_from`.

        Trả dòng log (hoặc None khi trước == sau) để caller gom lại đẩy thông báo SAU commit."""
        if shift_id_before is ...:
            shift_id_before = self.employees.base_shift_id_on(employee, effective_from)
        return self.employees.log_shift_change(
            employee_id=employee.id, kind=SHIFT_LOG_KIND_BASE, origin=origin, action=action,
            apply_date=effective_from, shift_id_before=shift_id_before,
            shift_id_after=shift_id_after, actor_user_id=getattr(actor, "id", None),
            notified_user_id=getattr(employee, "user_id", None),
        )

    def set_default_shift(
        self, *, employee_id: int, scope: str, actor, shift_id: int | None,
        effective_from: date,
    ):
        """Gán ca làm việc mặc định cho NV — AN TOÀN: chỉ đụng default_shift_id (không clobber
        field khác như PUT hồ sơ đầy đủ). Dùng cho panel 'Gán ca' ở Chấm công (kể cả hàng loạt)."""
        employee = self.get_employee(employee_id=employee_id, scope=scope, actor=actor)
        if employee.hire_date is not None and effective_from < employee.hire_date:
            raise EmployeeValidationError("Ngày áp dụng ca không được trước ngày vào làm.")
        log = self._log_base_shift(
            employee=employee, origin=SHIFT_LOG_ORIGIN_BASE_PANEL,
            effective_from=effective_from, shift_id_after=shift_id, actor=actor)
        assignment = self.employees.set_shift_assignment(
            employee=employee,
            shift_id=shift_id,
            effective_from=effective_from,
            created_by=actor.id,
            commit=False,  # chốt cùng dòng nhật ký ở `audit.create` — một commit
        )
        self.audit.create(
            actor_user_id=actor.id, action="assign_default_shift",
            target=f"employee:{employee.id}",
            detail=(f"{employee.code} → ca #{shift_id} từ {effective_from.isoformat()}"
                    if shift_id else f"{employee.code} → bỏ ca từ {effective_from.isoformat()}"),
        )
        push_shift_changes([log] if log is not None else [], db=self.employees.db)
        return employee, assignment

    def set_default_shift_bulk(
        self, *, employee_ids: list[int], scope: str, actor, shift_id: int | None,
        effective_from: date,
    ) -> dict:
        """Gán ca nền cho NHIỀU NV trong MỘT request + MỘT transaction.

        Ca nền là lớp áp dụng "từ ngày hiệu lực trở về sau, cho mọi tháng" — khác
        với tô ca trên lưới (chỉ đúng ngày đã tô). Đây là đường duy nhất để đặt ca
        nền sau khi gộp thao tác vào màn Phân ca tháng.

        Ai VÀO LÀM SAU ngày được chọn thì tự lùi mốc về đúng ngày vào làm của họ
        (`adjusted`) thay vì bị loại — người khai ca không có cách nào biết ngày vào
        làm của từng người, mà loại họ ra thì cả lô hỏng vì một người mới. Ca vẫn
        không bao giờ có hiệu lực trước khi người ta vào làm.

        NV thực sự không hợp lệ (ngoài phạm vi, không tồn tại…) đi vào `failed` KÈM
        LÝ DO — không bỏ qua im lặng; các NV còn lại vẫn được ghi.
        """
        updated = 0
        adjusted = 0
        failed: list[dict] = []
        logs: list = []
        for eid in employee_ids:
            try:
                employee = self.get_employee(employee_id=eid, scope=scope, actor=actor)
                eff = effective_from
                if employee.hire_date is not None and eff < employee.hire_date:
                    eff = employee.hire_date
                    adjusted += 1
                # Log đi CÙNG transaction của cả lô (commit=False ở dưới) — không commit riêng
                # từng dòng, nếu không lỗi giữa chừng để lại lịch sử ghi một nửa.
                log = self._log_base_shift(
                    employee=employee, origin=SHIFT_LOG_ORIGIN_BASE_BULK,
                    effective_from=eff, shift_id_after=shift_id, actor=actor)
                if log is not None:
                    logs.append(log)
                self.employees.set_shift_assignment(
                    employee=employee, shift_id=shift_id,
                    effective_from=eff, created_by=actor.id, commit=False,
                )
                updated += 1
            except EmployeeError as exc:
                failed.append({"employee_id": eid, "reason": str(exc)})
        # `audit.create` chốt cả lô lẫn dòng nhật ký trong MỘT commit.
        self.audit.create(
            actor_user_id=actor.id, action="assign_default_shift_bulk",
            target=f"employee_shift_bulk:{effective_from.isoformat()}",
            detail=(f"{updated} NV → ca #{shift_id} từ {effective_from.isoformat()}"
                    if shift_id else f"{updated} NV → bỏ ca từ {effective_from.isoformat()}")
                   + (f" · {adjusted} NV lùi về ngày vào làm" if adjusted else "")
                   + (f" · {len(failed)} NV bị bỏ qua" if failed else ""),
        )
        notified, not_notified = push_shift_changes(logs, db=self.employees.db)
        return {"updated": updated, "adjusted": adjusted, "failed": failed,
                "changed": len(logs), "notified": notified, "not_notified": not_notified}

    def delete_shift_assignment(self, *, employee_id: int, assignment_id: int, scope: str, actor):
        """Gỡ một mốc ca nền gán nhầm. Không có đường này thì mọi lần gán nhầm đều
        VĨNH VIỄN — chỉ đè được bằng mốc khác đúng ngày hiệu lực của nó, mà người dùng
        không có cách nào đoán ra ngày đó."""
        employee = self.get_employee(employee_id=employee_id, scope=scope, actor=actor)
        # Đọc mốc TRƯỚC khi xoá — sau đó không còn gì để biết nó vốn là ca gì, ngày nào.
        goc = next((a for a in self.employees.list_shift_assignments(employee.id)
                    if a.id == assignment_id), None)
        # Gỡ mốc là công của mọi tháng từ ngày hiệu lực tính lại theo mốc liền trước (bản rà liên
        # thông A3, 08/09/2026). Tháng CHƯA chốt công thì đó chính là sửa sai (lỡ tay "bỏ gán ca" làm
        # NV mất ca — chủ 24/08); tháng ĐÃ chốt công thì ảnh chụp giữ ca cũ mà Bảng công sống đổi —
        # hai màn hai số, không guard nào biết ⇒ chặn, chỉ đường mở lại kỳ.
        if goc is not None and self.employees.co_ky_cong_da_chot_tu(goc.effective_from):
            raise EmployeeValidationError(
                f"Mốc ca nền hiệu lực từ {goc.effective_from:%d/%m/%Y} chạm kỳ công ĐÃ CHỐT — gỡ là "
                "Bảng công lệch ảnh chụp. Mở lại kỳ công đó trước, hoặc đặt mốc mới từ hôm nay.")
        # Xoá mốc + dòng lịch sử ca + nhật ký: MỘT commit ở `audit.create`.
        if not self.employees.delete_shift_assignment(employee, assignment_id, commit=False):
            raise EmployeeNotFound("Không tìm thấy mốc ca này của nhân viên.")
        log = None
        if goc is not None:
            # Gỡ mốc ⇒ ca rơi về mốc CÒN LẠI đang hiệu lực (đọc SAU khi xoá mới ra đúng — repo đã
            # flush lệnh xoá nên câu đọc này thấy được).
            log = self._log_base_shift(
                employee=employee, origin=SHIFT_LOG_ORIGIN_BASE_REMOVE,
                action=SHIFT_LOG_ACTION_REMOVE, effective_from=goc.effective_from,
                shift_id_before=goc.shift_id,
                shift_id_after=self.employees.base_shift_id_on(employee, goc.effective_from),
                actor=actor)
        self.audit.create(
            actor_user_id=actor.id, action="delete_shift_assignment",
            target=f"employee:{employee.id}", detail=f"{employee.code} → xóa mốc #{assignment_id}",
        )
        push_shift_changes([log] if log is not None else [], db=self.employees.db)
        return employee

    def list_shift_assignments(self, *, employee_id: int, scope: str, actor):
        self.get_employee(employee_id=employee_id, scope=scope, actor=actor)
        return self.employees.list_shift_assignments(employee_id)

    # --- self-service "Hồ sơ của tôi" (nhân viên thường) --------------------

    def my_employee(self, *, user) -> Employee | None:
        """Hồ sơ gắn với tài khoản đang đăng nhập (qua employees.user_id), hoặc None."""
        return self.employees.get_by_user_id(user.id)

    def my_events(self, *, user):
        emp = self.employees.get_by_user_id(user.id)
        return self.employees.list_events(emp.id) if emp is not None else []

    def my_attachments(self, *, user):
        emp = self.employees.get_by_user_id(user.id)
        return self.employees.list_attachments(emp.id) if emp is not None else []

    def update_my_contact(self, *, user, fields: dict) -> Employee:
        """NV tự cập nhật liên lạc của CHÍNH MÌNH — whitelist SELF_EDITABLE_FIELDS."""
        emp = self.employees.get_by_user_id(user.id)
        if emp is None:
            raise EmployeeValidationError("Tài khoản chưa gắn hồ sơ nhân viên.")
        clean = self._clean_fields({k: v for k, v in fields.items() if k in SELF_EDITABLE_FIELDS})
        self.employees.update(emp, commit=False, **clean)  # chốt cùng nhật ký — một commit
        self.audit.create(
            actor_user_id=user.id, action="update_my_contact",
            target=f"employee:{emp.id}", detail=f"{emp.code} tự cập nhật liên lạc",
        )
        return emp

    # --- yêu cầu cập nhật hồ sơ (NV đề nghị → HCNS duyệt) -------------------

    def create_update_request(self, *, user, changes: dict, reason=None):
        emp = self.employees.get_by_user_id(user.id)
        if emp is None:
            raise EmployeeValidationError("Tài khoản chưa gắn hồ sơ nhân viên.")
        clean = self._clean_fields({k: v for k, v in (changes or {}).items() if k in REQUESTABLE_FIELDS})
        if not clean:
            raise EmployeeValidationError("Không có thay đổi hợp lệ để đề nghị.")
        # date/int về dạng chuỗi để JSON lưu gọn.
        payload = {k: (v.isoformat() if isinstance(v, date) else v) for k, v in clean.items()}
        return self.employees.create_update_request(
            employee_id=emp.id, changes=payload, reason=_clean(reason),
        )

    def my_update_requests(self, *, user, statuses: list[str] | None = None,
                           tu_ngay=None, den_ngay=None, page: int = 1, size: int = 10):
        """Một trang đề nghị của chính NV + tổng dòng + số đếm theo trạng thái (toàn hồ sơ) + số
        đếm theo trạng thái trong kỳ đang xem.

        Tài khoản chưa gắn hồ sơ (admin thuần) không phải lỗi — trả trang rỗng để màn "Hồ sơ của
        tôi" hiện trạng thái rỗng bình thường."""
        emp = self.employees.get_by_user_id(user.id)
        if emp is None:
            return [], 0, {}, {}
        rows, total = self.employees.list_update_requests_by_employee(
            emp.id, statuses=statuses, tu_ngay=tu_ngay, den_ngay=den_ngay, page=page, size=size,
        )
        return (
            rows, total,
            self.employees.dem_update_requests_by_employee(emp.id),
            self.employees.dem_update_requests_by_employee(emp.id, tu_ngay=tu_ngay, den_ngay=den_ngay),
        )

    def cancel_my_update_request(self, *, user, request_id: int):
        """NV tự RÚT LẠI đề nghị của chính mình khi HCNS chưa xử lý.

        Ba cửa phải qua: có hồ sơ · đúng đề nghị của mình (không rút hộ người khác) · còn
        `pending`. Rút = đổi trạng thái, KHÔNG xoá dòng — HCNS vẫn tra được là đã từng có đề nghị
        này và ai rút lúc nào."""
        emp = self.employees.get_by_user_id(user.id)
        if emp is None:
            raise EmployeeValidationError("Tài khoản chưa gắn hồ sơ nhân viên.")
        req = self.employees.get_update_request(request_id)
        if req is None or req.employee_id != emp.id:
            raise EmployeeNotFound("Không tìm thấy đề nghị cập nhật.")
        if req.status != REQ_PENDING:
            raise EmployeeValidationError("Đề nghị đã được xử lý, không rút lại được.")
        req = self.employees.update_update_request(
            req, status=REQ_CANCELLED, decided_by=user.id,
            decided_at=datetime.now(timezone.utc), commit=False,
        )
        self.audit.create(
            actor_user_id=user.id, action="cancel_profile_request",
            target=f"employee:{emp.id}", detail=f"{emp.code} rút đề nghị #{req.id}",
        )
        return req

    def list_update_requests(self, *, status=None, scope=None, actor=None):
        rows = self.employees.list_update_requests(status=status)
        if scope is None or scope == "all":
            return rows
        # PHẠM VI (07/09/2026, bản rà C5): danh sách này kèm "giá trị hiện tại" của CCCD / số tài
        # khoản / người phụ thuộc — không lọc là ai có `nhan_su:read` cũng đọc được của cả công ty.
        duoc_xem = self.employees.ids_accessible(
            {r.employee_id for r in rows}, scope=scope, actor=actor,
        )
        return [r for r in rows if r.employee_id in duoc_xem]

    def decide_update_request(self, *, request_id: int, actor, approve: bool, scope: str,
                              note=None, can_edit_salary: bool = True):
        """Duyệt / từ chối yêu cầu NV xin sửa hồ sơ.

        Chủ chốt 29/07/2026: **YC cập nhật hồ sơ do bên NHÂN SỰ duyệt**. Hiện chỉ HCNS có
        `nhan_su.can_approve` (scope `all`) nên chốt phạm vi dưới đây không đổi hành vi hôm nay —
        nó là lớp khoá dự phòng, để mai kia cấp quyền duyệt cho một vai scope `department` thì
        người đó cũng chỉ duyệt được hồ sơ trong tổ mình."""
        req = self.employees.get_update_request(request_id)
        if req is None:
            raise EmployeeNotFound("Không tìm thấy yêu cầu cập nhật.")
        nv = self.employees.get_by_id(req.employee_id)
        if nv is not None and not self.employees.can_access(employee=nv, scope=scope, actor=actor):
            raise EmployeeForbidden("Nhân viên này ngoài phạm vi quản lý của bạn.")
        # Không TỰ duyệt yêu cầu sửa hồ sơ của chính mình khi phạm vi chỉ là tổ (bản rà liên thông
        # E3, 08/09/2026): đổi số tài khoản nhận lương rồi tự ký là hết một cửa kiểm.
        if scope is not None and scope != SCOPE_ALL:
            me = self.employees.get_by_user_id(actor.id)
            if me is not None and me.id == req.employee_id:
                raise EmployeeForbidden("Không tự duyệt yêu cầu sửa hồ sơ của chính mình — nhờ cấp trên duyệt.")
        if req.status != "pending":
            raise EmployeeValidationError("Yêu cầu đã được xử lý.")
        if approve:
            emp = self.employees.get_by_id(req.employee_id)
            if emp is None:
                raise EmployeeNotFound("Không tìm thấy nhân viên.")
            allowed = {k: v for k, v in req.changes.items() if k in REQUESTABLE_FIELDS}
            # N5: người duyệt thiếu quyền edit_salary → bỏ field nhạy cảm (bank...) khi áp.
            if not can_edit_salary:
                allowed = {k: v for k, v in allowed.items() if k not in SENSITIVE_FIELDS}
            clean = self._clean_fields(allowed)
            # Áp thay đổi + đồng bộ tài khoản + nhật ký + trạng thái đề nghị: MỘT commit ở dưới
            # (bản cũ 4 commit — gãy giữa chừng là hồ sơ đã đổi mà đề nghị vẫn "chờ duyệt").
            self.employees.update(emp, commit=False, **clean)
            self._sync_user_from_employee(emp, commit=False)  # Đ1: duyệt đổi tên → đồng bộ tài khoản
            self.audit.create(
                actor_user_id=actor.id, action="approve_profile_request",
                target=f"employee:{emp.id}", detail=f"{emp.code} duyệt yêu cầu #{req.id}",
                commit=False,
            )
        req = self.employees.update_update_request(
            req, status="approved" if approve else "rejected",
            decided_by=actor.id, decided_at=datetime.now(timezone.utc), decision_note=_clean(note),
        )
        if approve:
            self.audit.bao_co_dong_moi()
        return req

    # --- transitions (stage changes) ---------------------------------------

    def _is_system_account(self, user_id: int | None) -> bool:
        """Hồ sơ này có đang gắn tài khoản QUẢN TRỊ HỆ THỐNG (`settings.seed_admin_username`) không?"""
        if user_id is None:
            return False
        account = self.users.get_by_id(user_id)
        return account is not None and account.username == settings.seed_admin_username

    def apply_transition(
        self,
        *,
        employee_id: int,
        scope: str,
        actor,
        kind: str,
        effective_date: date | None = None,
        note: str | None = None,
        new_department_id: int | None = None,
        new_position: str | None = None,
        resign_reason: str | None = None,
        probation_end_date: date | None = None,
    ) -> Employee:
        employee = self.get_employee(employee_id=employee_id, scope=scope, actor=actor)
        note = _clean(note)
        effective_date = effective_date or date.today()
        # Ngày hiệu lực TƯƠNG LAI bị chặn (bản rà liên thông A1/A6, 08/09/2026): máy đổi trạng thái,
        # phòng ban và khoá tài khoản NGAY lúc bấm — "cho nghỉ việc từ 27/09" bấm hôm 07/09 là 20
        # ngày không bấm giờ được, điều chuyển tương lai là tổ trưởng cũ mất quyền ngay. Tới ngày đó
        # hãy bấm. (`probation_end` là đường máy tự đi với ngày quá khứ, không qua đây.)
        if effective_date > date.today():
            raise EmployeeValidationError(
                f"Ngày hiệu lực không được sau hôm nay ({date.today():%d/%m/%Y}) — máy áp thay đổi "
                "ngay lúc bấm, tới ngày đó hãy bấm.")
        # Bấm thử 25/10/2026 (L-SX-28): mốc trước ngày vào làm làm biên chế theo ngày đọc sai.
        if employee.hire_date and effective_date < employee.hire_date:
            raise EmployeeValidationError(
                f"Ngày hiệu lực không được trước ngày vào làm ({employee.hire_date:%d/%m/%Y}).")
        # Kỳ lương đã chốt / đã chi (L-SX-44): các thao tác đổi tiền của kỳ thì chặn. Nghỉ việc vẫn
        # cho lùi ngày — giấy nghỉ ngoài đời hay về muộn (chủ duyệt theo kế hoạch vá 25/10/2026).
        if kind in ("probation_restart", "reinstate", "transfer", "promote"):
            loi = ly_do_ky_luong_da_khoa(self.employees.db, effective_date,
                                          viec="đổi trạng thái hồ sơ có hiệu lực")
            if loi:
                raise EmployeeValidationError(loi)

        if kind in _STATUS_TRANSITIONS:
            return self._apply_status(employee, actor, kind, effective_date, note, resign_reason,
                                      probation_end_date=probation_end_date)
        if kind == "transfer":
            return self._apply_transfer(employee, actor, effective_date, note, new_department_id)
        if kind == "promote":
            return self._apply_promote(employee, actor, effective_date, note, new_position)
        raise EmployeeValidationError(f"Loại thao tác không hợp lệ: {kind!r}")

    def _apply_status(self, employee, actor, kind, effective_date, note, resign_reason,
                      *, commit: bool = True, probation_end_date: date | None = None) -> Employee:
        """Mọi bước ghi đi `commit=False`; chốt MỘT lần ở `audit.create` (bản cũ 3–5 commit).
        `commit=False` (lượt máy quét cả lô): dòng nhật ký cũng chỉ flush, người gọi tự chốt."""
        allowed_from, to_status, event_type = _STATUS_TRANSITIONS[kind]
        # Cùng khuôn `CannotLockSelf` (L-VAI-20): nghỉ việc / đình chỉ khoá đăng nhập của chính
        # người bấm. `actor=None` là máy tự quét, không đụng.
        if (kind in ("resign", "suspend") and actor is not None and employee.user_id is not None
                and employee.user_id == getattr(actor, "id", None)):
            raise EmployeeValidationError(
                "Không thể tự cho mình nghỉ việc / đình chỉ — nhờ người khác thao tác.")
        if employee.status not in allowed_from:
            raise EmployeeValidationError(
                f"Không thể '{kind}' từ trạng thái hiện tại ({employee.status})."
            )
        if kind == "resign" and self._is_system_account(employee.user_id):
            # Admin CÓ hồ sơ (seed backfill) ⇒ "nghỉ việc ⇒ chặn login" sẽ khóa cứng đường vào hệ
            # thống, mà luật là KHÔNG có cửa hậu admin ⇒ chỉ còn nước sửa DB tay. Chặn ở NGUỒN
            # thay vì đẻ ngoại lệ trong xác thực (auth_service giữ nguyên 1 luật cho mọi người).
            raise EmployeeValidationError(
                "Hồ sơ này đang gắn tài khoản quản trị hệ thống — không cho nghỉ việc "
                "(sẽ khóa cứng đường đăng nhập). Gỡ liên kết tài khoản trước nếu thật sự cần."
            )
        old_status = employee.status
        if kind == "unsuspend":
            to_status = self._trang_thai_truoc_dinh_chi(employee)
        updates: dict = {"status": to_status}
        if kind == "resign":
            resign_reason = _clean(resign_reason)
            if not resign_reason:
                raise EmployeeValidationError("Cần nhập lý do nghỉ việc.")
            updates["resign_date"] = effective_date
            updates["resign_reason"] = resign_reason
        elif kind == "probation_restart":
            self._bat_buoc_ngay_het_thu_viec(to_status, probation_end_date)
            if probation_end_date < effective_date:
                raise EmployeeValidationError(
                    "Ngày hết thử việc không được trước ngày hiệu lực chuyển về thử việc.")
            updates["probation_end_date"] = probation_end_date
        elif kind == "reinstate":
            # Reopening: clear the resignation stamp.
            updates["resign_date"] = None
            updates["resign_reason"] = None
        self.employees.update(employee, commit=False, **updates)
        if kind == "resign" and employee.user_id is not None:
            # Login đã tự chặn theo trạng thái hồ sơ, nhưng token đã phát thì vẫn còn hạn —
            # bump token_version để cắt luôn phiên đang sống của người vừa nghỉ.
            account = self.users.get_by_id(employee.user_id)
            if account is not None:
                self.users.bump_token_version(account, commit=False)
                # Bump chỉ giết access token; `/api/auth/refresh` chỉ hỏi `is_active` rồi cấp token
                # MỚI theo token_version mới ⇒ người vừa nghỉ còn tab mở là vào tiếp (bản rà C7,
                # 07/09/2026). Khoá tài khoản luôn — tuyển lại thì mở (nhánh `reinstate`).
                self.users.set_active(account, False, commit=False)
        if kind == "reinstate" and employee.user_id is not None:
            account = self.users.get_by_id(employee.user_id)
            if account is not None and not account.is_active:
                # Khoá do nghỉ việc không ghi `lock_user`; dòng `lock_user` mới nhất nghĩa là có
                # người khoá TAY — tuyển lại không được mở hộ (L-VAI-22).
                vet = self.audit.list_by_targets(
                    [f"user:{account.id}"], actions=["lock_user", "unlock_user"])[f"user:{account.id}"]
                if vet and vet[0].action == "lock_user":
                    giu_khoa = "Tài khoản đang bị khoá tay — mở ở tab Tài khoản."
                    note = f"{note} ({giu_khoa})" if note else giu_khoa
                else:
                    self.users.set_active(account, True, commit=False)
        self.employees.add_event(
            employee_id=employee.id,
            event_type=event_type,
            effective_date=effective_date,
            field="status",
            from_value=old_status,
            to_value=to_status,
            note=note or resign_reason,
            # `actor=None` = MÁY tự bấm (xem `tu_danh_dau_het_thu_viec`). Cột cho phép rỗng, và
            # để rỗng là trung thực hơn gán bừa người đang mở màn hình — người đó không quyết
            # định gì cả. Ghi chú của sự kiện là chỗ nói rõ vì sao trạng thái đổi.
            actor_user_id=getattr(actor, "id", None),
            commit=False,
        )
        self.audit.create(
            actor_user_id=getattr(actor, "id", None),
            action=f"employee_{event_type}",
            target=f"employee:{employee.id}",
            detail=(f"{employee.code}: {_NHAN_TRANG_THAI.get(old_status, old_status)} → "
                    f"{_NHAN_TRANG_THAI.get(to_status, to_status)}, hiệu lực {effective_date:%d/%m/%Y}"
                    + (f", hết thử việc {probation_end_date:%d/%m/%Y}"
                       if kind == "probation_restart" else "")),
            commit=commit,
        )
        if kind == "resign" and employee.user_id is not None and commit:
            # Sau commit: kênh SSE đang mở của người vừa nghỉ xét lại và tự cắt (L-VAI-23).
            bao_quyen_doi([employee.user_id])
        return employee

    def _trang_thai_truoc_dinh_chi(self, employee) -> str:
        """Trạng thái để trả về khi GỠ đình chỉ = `from_value` của mốc đình chỉ gần nhất. Đang thử
        việc mà bị đình chỉ thì gỡ xong vẫn thử việc (không được "lên chính thức chui"); đang nghỉ
        dài hạn mà bị đình chỉ thì gỡ xong là đi làm lại (active) — muốn nghỉ tiếp thì bấm Cho nghỉ
        dài hạn. Không tìm thấy mốc (dữ liệu tồn) ⇒ active."""
        for ev in self.employees.list_events(employee.id):      # mới nhất trước
            if ev.event_type == EVENT_SUSPENDED and ev.field == "status":
                truoc = ev.from_value
                if truoc in (STATUS_PROBATION, STATUS_PROBATION_ENDED, STATUS_ACTIVE):
                    return truoc
                return STATUS_ACTIVE
        return STATUS_ACTIVE

    def tu_danh_dau_het_thu_viec(self, *, moc: date | None = None) -> int:
        """Máy tự đổi Thử việc → **Hết thử việc** cho ai đã qua Ngày hết thử việc. Trả số hồ sơ
        đã đổi.

        KHÔNG chuyển thẳng lên "Đang làm việc": chủ chốt 22/08/2026 là **chỉ HCNS bấm mới thành
        chính thức**. Máy chỉ nói "thời gian thử việc đã hết", không tự quyết đạt hay không đạt.

        TIỀN KHÔNG ĐỔI ở bước này — engine lương coi trạng thái mới y hệt thử việc (vẫn 80%, vẫn
        không đóng BHXH). Chỉ khi HCNS bấm "Chuyển chính thức" mới lên nguyên mức.

        Không có bộ hẹn giờ trong hệ thống nên hàm này được gọi LÚC ĐỌC — mở danh sách Nhân sự và
        lúc chạy Tính lương. Chạy lại nhiều lần vô hại: đổi xong thì hồ sơ hết là `probation` nên
        lần quét sau không bắt lại nữa.

        Ngày hiệu lực = ngày hết thử việc + 1 (ngày đầu tiên KHÔNG còn thử việc), nên nếu về sau
        HCNS bấm chuyển chính thức thì mốc trên Quá trình công tác vẫn đọc được đúng thứ tự.

        `moc` chỉ để TEST đặt mốc riêng; chạy thật luôn dùng `MOC_TU_DANH_DAU_HET_THU_VIEC`."""
        hom_nay = date.today()
        doi = 0
        for e in self.employees.list_probation_qua_han(
                moc=moc or MOC_TU_DANH_DAU_HET_THU_VIEC, den_ngay=hom_nay):
            try:
                # Cả lô chốt MỘT lần ở cuối. Bản cũ 3 commit cho MỖI người — mà đây là request
                # ĐỌC: mở danh sách Nhân sự hôm có 30 người hết hạn là 90 commit trước khi ra bảng.
                self._apply_status(
                    e, None, "probation_end", e.probation_end_date + timedelta(days=1),
                    "Tự động: đã qua ngày hết thử việc, chờ HCNS xác nhận chính thức", None,
                    commit=False)
            except EmployeeValidationError:
                # ĐUA: hàm này chạy trong request ĐỌC (mở danh sách Nhân sự / chạy Tính lương),
                # nên hai người mở cùng lúc là hai lượt quét cùng nhắm một hồ sơ. Người thua thấy
                # trạng thái đã đổi rồi và `_apply_status` chặn — đúng, nhưng KHÔNG được để lỗi đó
                # nổ ra giữa một request chỉ đi xem danh sách. Bỏ qua và đi tiếp: việc đã có người
                # làm xong rồi.
                continue
            doi += 1
        if doi:
            self.employees.commit()
            self.audit.bao_co_dong_moi()
        return doi

    def _apply_transfer(self, employee, actor, effective_date, note, new_department_id,
                        lo: dict | None = None) -> Employee:
        """Điều chuyển MỘT người. `lo` (điều chuyển hàng loạt): không commit ở đây — dòng nhật ký
        gom vào `lo["nhat_ky"]`, tài khoản cần hỏi lại quyền gom vào `lo["bao"]`; người gọi chốt cả
        lô trong MỘT giao dịch. Bản cũ chốt 5–6 lần cho mỗi người.

        Điều chuyển lẻ (`lo=None`) cũng chỉ MỘT commit — ở `audit.create` cuối hàm; báo "quyền
        đổi" đẩy SAU commit."""
        bao: list[int] = []
        if employee.status == STATUS_RESIGNED:
            raise EmployeeValidationError("Nhân viên đã nghỉ việc — không điều chuyển được.")
        if new_department_id is None:
            raise EmployeeValidationError("Cần chọn phòng/tổ mới.")
        old = employee.department_id
        if old == new_department_id:
            raise EmployeeValidationError("Phòng/tổ mới trùng phòng hiện tại.")
        self.employees.update(employee, department_id=new_department_id, commit=False)
        # Đ1/Đ2: chuyển phòng → tài khoản đổi phòng (scope)
        self._sync_user_from_employee(employee, commit=False)
        # Đ2: NV đang là trưởng phòng CŨ → gỡ chức (không để head phòng cũ treo người đã đi).
        if old is not None and employee.user_id is not None:
            old_dept = self.departments.get_by_id(old)
            if old_dept is not None and old_dept.head_user_id == employee.user_id:
                self.departments.set_head(old_dept, None, commit=False)
        # Vai trò thuộc ĐÚNG 1 phòng → chuyển phòng phải GỠ vai trò cũ, về mức tối thiểu tới khi
        # trưởng phòng mới gán lại (khớp bulk transfer_users). Không gỡ thì tài khoản giữ vai trò
        # của phòng khác — trạng thái mà chính API gán-vai-trò từ chối (400).
        if employee.user_id is not None:
            account = self.users.get_by_id(employee.user_id)
            if account is not None and account.role_id is not None:
                self.users.set_assignment(
                    account, department_id=new_department_id, role_id=None,
                    is_active=account.is_active, commit=False,
                )
                (bao if lo is None else lo["bao"]).append(account.id)
        self.employees.add_event(
            employee_id=employee.id,
            event_type=EVENT_TRANSFERRED,
            effective_date=effective_date,
            field="department",
            from_value=str(old) if old is not None else None,
            to_value=str(new_department_id),
            note=note,
            actor_user_id=actor.id,
            commit=False,
        )
        dong = {
            "actor_user_id": actor.id,
            "action": "employee_transferred",
            "target": f"employee:{employee.id}",
            "detail": f"{employee.code} phòng {old}→{new_department_id}",
        }
        if lo is None:
            self.audit.create(**dong)
            bao_quyen_doi(bao)
        else:
            lo["nhat_ky"].append(dong)
        return employee

    def transfer_many(
        self, *, employee_ids: list[int], target_department_id: int, scope: str, actor,
        note: str | None = None,
    ) -> int:
        """Bulk điều chuyển theo HỒ SƠ (màn Phòng ban) — kể cả người CHƯA có tài khoản.

        Kiểm tra TOÀN BỘ trước rồi mới ghi, để một id hỏng không làm chuyển dở dang. Mỗi
        người đi qua đúng luồng điều chuyển đơn `_apply_transfer` nên được: đồng bộ phòng
        xuống tài khoản, gỡ vai trò cũ, gỡ chức trưởng phòng cũ, ghi Quá trình công tác +
        nhật ký. (Bản cũ chuyển theo TÀI KHOẢN nên bỏ sót người không có tài khoản và
        không ghi Quá trình công tác.)

        Cả lô là MỘT giao dịch: hồ sơ nạp một truy vấn, tài khoản nạp một truy vấn, chốt một lần ở
        cuối (bản cũ ~6 lần commit mỗi người). Gãy giữa chừng thì không ai bị chuyển.
        """
        if self.departments.get_by_id(target_department_id) is None:
            raise EmployeeNotFound("Không tìm thấy phòng đích.")
        theo_id = self.employees.get_many(employee_ids)
        employees = []
        for eid in employee_ids:
            emp = theo_id.get(eid)
            if emp is None:
                raise EmployeeNotFound("Không tìm thấy nhân viên.")
            if not self.employees.can_access(employee=emp, scope=scope, actor=actor):
                raise EmployeeForbidden("Bạn không có quyền xem nhân viên này.")
            if emp.status == STATUS_RESIGNED:
                raise EmployeeValidationError(
                    f"{emp.code} đã nghỉ việc — không điều chuyển được."
                )
            if emp.department_id == target_department_id:
                raise EmployeeValidationError(f"{emp.code} đã thuộc phòng đích.")
            employees.append(emp)
        # Nạp sẵn tài khoản cả lô vào phiên — `_apply_transfer` hỏi `get_by_id` là trúng bộ nhớ.
        self.users.get_many(e.user_id for e in employees)
        lo: dict = {"nhat_ky": [], "bao": []}
        # Gãy giữa chừng thì chưa commit gì — phiên của request đóng lại là huỷ cả lô.
        for emp in employees:
            self._apply_transfer(emp, actor, date.today(), note, target_department_id, lo=lo)
        self.audit.create_many(lo["nhat_ky"])
        self.employees.commit()
        self.audit.bao_co_dong_moi()
        bao_quyen_doi(lo["bao"])
        return len(employees)

    def _apply_promote(self, employee, actor, effective_date, note, new_position) -> Employee:
        """Đổi chức danh — ghi một mốc Quá trình công tác."""
        if employee.status == STATUS_RESIGNED:
            raise EmployeeValidationError("Nhân viên đã nghỉ việc — không đổi chức danh được.")
        new_position = self._check_len("position", _clean(new_position))
        if new_position is None:
            raise EmployeeValidationError("Cần nhập chức danh mới.")
        old_position = employee.position
        if new_position == old_position:
            raise EmployeeValidationError("Chức danh mới trùng chức danh hiện tại.")
        # Hồ sơ + mốc Quá trình công tác + nhật ký: MỘT commit ở `audit.create`.
        self.employees.update(employee, position=new_position, commit=False)
        self.employees.add_event(
            employee_id=employee.id,
            event_type=EVENT_PROMOTED,
            effective_date=effective_date,
            field="position",
            from_value=old_position,
            to_value=new_position,
            note=note,
            actor_user_id=actor.id,
            commit=False,
        )
        self.audit.create(
            actor_user_id=actor.id,
            action="employee_promoted",
            target=f"employee:{employee.id}",
            detail=f"{employee.code} chức danh {old_position}→{new_position}",
        )
        return employee

    # --- account link (nguoi_dung) -----------------------------------------

    def link_account(self, *, employee_id: int, scope: str, actor, user_id: int) -> Employee:
        employee = self.get_employee(employee_id=employee_id, scope=scope, actor=actor)
        user = self.users.get_by_id(user_id)
        if user is None:
            raise EmployeeValidationError("Không tìm thấy tài khoản.")
        other = self.employees.get_by_user_id(user_id)
        if other is not None and other.id != employee.id:
            raise EmployeeValidationError(f"Tài khoản này đã gắn với nhân viên {other.code}.")
        self.employees.update(employee, user_id=user_id, commit=False)
        # Đ1: nối tài khoản → đồng bộ danh tính theo hồ sơ. Chốt cùng nhật ký — một commit.
        self._sync_user_from_employee(employee, commit=False)
        self.audit.create(
            actor_user_id=actor.id,
            action="employee_link_account",
            target=f"employee:{employee.id}",
            detail=f"{employee.code} ↔ user:{user_id}",
        )
        return employee

    def kiem_tai_khoan_moi(self, *, username: str, password: str) -> str:
        """Kiểm tên đăng nhập / mật khẩu của tài khoản SẮP tạo; trả tên đã cắt khoảng trắng.

        Tách riêng để màn "Thêm nhân viên" gọi TRƯỚC khi lưu hồ sơ: hồ sơ lưu xong mới báo trùng
        tên thì màn không có id, bấm Lưu lại là đẻ thêm một hồ sơ trùng người (bắt được 23/09/2026).
        """
        username = (username or "").strip()
        if not username:
            raise EmployeeValidationError("Tên đăng nhập là bắt buộc.")
        if len(password or "") < 6:
            raise EmployeeValidationError("Mật khẩu tối thiểu 6 ký tự.")
        if self.users.username_da_dung(username):
            raise EmployeeValidationError(
                f"Tên đăng nhập “{username}” đã có người dùng (không phân biệt hoa/thường).")
        return username

    def create_account(
        self,
        *,
        employee_id: int,
        scope: str,
        actor,
        username: str,
        password: str,
        name: str | None = None,
        role_id: int | None = None,
    ) -> tuple[Employee, object]:
        employee = self.get_employee(employee_id=employee_id, scope=scope, actor=actor)
        if employee.user_id is not None:
            raise EmployeeValidationError("Nhân viên đã có tài khoản.")
        username = self.kiem_tai_khoan_moi(username=username, password=password)
        # Tạo tài khoản + gán phòng/vai + nối hồ sơ + nhật ký: MỘT commit ở `audit.create` (bản cũ
        # 5 commit — gãy giữa chừng là tài khoản mồ côi chiếm mất tên đăng nhập).
        user = self.users.create(
            username=username,
            name=(name or employee.full_name),
            password_hash=hash_password(password),
            commit=False,
        )
        # Default the account's department to the employee's; role/head assigned elsewhere.
        self.users.set_assignment(
            user, department_id=employee.department_id, role_id=role_id, is_active=True,
            commit=False,
        )
        self.employees.update(employee, user_id=user.id, commit=False)
        # Đ1: đồng bộ danh tính hồ sơ xuống tài khoản mới
        self._sync_user_from_employee(employee, commit=False)
        self.audit.create(
            actor_user_id=actor.id,
            action="employee_create_account",
            target=f"employee:{employee.id}",
            detail=f"{employee.code} → tạo user {username}",
        )
        return employee, user

    # `unlink_account` ĐÃ GỠ: mọi tài khoản phải thuộc một hồ sơ (gỡ liên kết = đẻ tài khoản
    # mồ côi). Chặn một người = KHÓA tài khoản; nghỉ việc = login tự chặn theo trạng thái hồ sơ.

    # --- attachments (router does the disk IO; service records metadata) ---

    def add_attachment(
        self, *, employee_id: int, scope: str, actor, doc_kind: str,
        file_name: str, file_url: str, file_type: str | None,
    ):
        employee = self.get_employee(employee_id=employee_id, scope=scope, actor=actor)
        if doc_kind not in ATTACHMENT_DOC_KINDS:
            doc_kind = DOC_KHAC
        att = self.employees.add_attachment(
            employee_id=employee.id,
            doc_kind=doc_kind,
            file_name=file_name,
            file_url=file_url,
            file_type=file_type,
            uploaded_by=actor.id,
            commit=False,  # chốt cùng nhật ký — một commit
        )
        self.audit.create(
            actor_user_id=actor.id,
            action="employee_add_attachment",
            target=f"employee:{employee.id}",
            detail=f"{employee.code} + {doc_kind}: {file_name}",
        )
        return att

    def delete_attachment(self, *, employee_id: int, scope: str, actor, attachment_id: int) -> None:
        employee = self.get_employee(employee_id=employee_id, scope=scope, actor=actor)
        att = self.employees.get_attachment(attachment_id)
        if att is None or att.employee_id != employee.id:
            raise EmployeeNotFound("Không tìm thấy tệp đính kèm.")
        file_url, file_name = att.file_url, att.file_name
        self.employees.delete_attachment(att, commit=False)  # chốt cùng nhật ký — một commit
        self.audit.create(
            actor_user_id=actor.id,
            action="employee_delete_attachment",
            target=f"employee:{employee.id}",
            detail=f"{employee.code} xóa tệp {file_name}",
        )
        # Xoá luôn object trong kho tệp, SAU commit (xoá trước mà commit gãy thì dòng còn đó trỏ
        # vào tệp đã mất). Trước đây chỉ xoá dòng DB: bản scan CCCD / hợp đồng vẫn nằm trong kho
        # và vẫn tải được qua URL cũ. `delete` là best-effort, không raise.
        key = key_from_url(file_url)
        if key:
            get_storage().delete(key)
