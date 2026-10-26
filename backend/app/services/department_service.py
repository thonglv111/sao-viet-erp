"""Department-management business logic (the Phòng ban admin screen).

Framework-agnostic: raises domain errors the router maps to HTTP. Owns department
create / rename / set-head / delete with name dedup, a head-must-belong-to-the-department
rule, and a block on deleting a department that still has roles or users.
"""
from __future__ import annotations

from datetime import date, timedelta, timezone

from ..models.department import Department
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.delivery_repo import DeliveryRepository
from ..repositories.employee_repo import EmployeeRepository
from ..repositories.rbac_repo import DepartmentRepository, RoleRepository, UnitLevelRepository
from ..repositories.user_repo import UserRepository

# Sentinel: "caller did not send this field" — distinct from an explicit None (which means
# "clear the parent / make it a root"). Lets a partial update keep the current parent.
_KEEP = object()

# Giờ Việt Nam — ranh ngày của bộ lọc Ngày tạo.
_VN_TZ = timezone(timedelta(hours=7))


class DepartmentError(Exception):
    """Base for department-management domain errors."""


class DepartmentNameTaken(DepartmentError):
    """Another department already uses that name."""


class DepartmentNotFound(DepartmentError):
    """No department with that id."""


class InvalidHead(DepartmentError):
    """The chosen head is not a user of this department."""


class SetHeadForbidden(DepartmentError):
    """Đổi trưởng phòng cần quyền chi tiết `set_head` (tách khỏi sửa phòng ban)."""


class ReparentForbidden(DepartmentError):
    """Đổi cấp trên (cây tổ chức) cần quyền chi tiết `reparent` (tách khỏi sửa phòng ban)."""


class DepartmentCycle(DepartmentError):
    """Re-parenting would create a cycle (parent is the unit itself or a descendant)."""


class InvalidLevelOrder(DepartmentError):
    """A child unit's level must rank BELOW its parent's level (spec-06 / PBI-4007)."""


class GiaoHangConChuyenChay(DepartmentError):
    """Tắt cờ Giao hàng khi tài xế của phòng còn chuyến CHƯA ghi kết quả (chủ chốt 14/09/2026).

    Đơn giá khoán km chụp lúc GHI KẾT QUẢ và tra theo phòng của tài xế — tắt cờ trước lúc đó là
    chuyến đóng xong với `don_gia_km = NULL`: tài xế mất trắng tiền chuyến đó, không lỗi, không
    cảnh báo (đã đo thực nghiệm, PRD khoán km §12.1).
    """


class GiaoHangKemKhoanSanLuong(DepartmentError):
    """Một tổ KHÔNG được vừa có cờ Giao hàng vừa bật Lương khoán / sản lượng (chủ chốt 16/09/2026).

    Hai cờ là hai NGUỒN TIỀN đem so với lương bù lỗ: cờ Giao hàng lấy tiền km của chuyến giao, công
    tắc Lương khoán lấy tiền sản lượng của phiếu phân bổ sản xuất. Bật cả hai thì engine cộng hai
    khoản thành MỘT vế rồi mới so — tài xế được gán nhầm một phiếu sản lượng là vế khoán vọt lên,
    tháng đó mất trắng tiền tăng ca và phần bù lỗ mà không ai thấy. Chặn ở cửa khai cho hết đường.
    """


class KhoanKmInvalid(DepartmentError):
    """Ba ô khoán km sai luật — hai tỷ lệ không cộng đủ 100, hoặc đơn giá âm (mg 0231)."""


class DepartmentBranchHasUsers(DepartmentError):
    """A department branch still has personnel — deletion is blocked (spec-05 / PBI-4005)
    until the people are moved out. `offenders` is a list of (Department, user_count)."""

    def __init__(self, offenders: list[tuple[Department, int]]) -> None:
        self.offenders = offenders
        listed = ", ".join(f"{d.name} ({c} người)" for d, c in offenders)
        super().__init__(
            "Không thể xóa: còn nhân sự trong " + listed + ". Hãy chuyển người đi trước."
        )


def _dong_bo_quyen_to(db) -> None:
    from .quyen_to import dong_bo_dong_quyen_to

    dong_bo_dong_quyen_to(db)


class DepartmentService:
    def __init__(
        self,
        departments: DepartmentRepository,
        roles: RoleRepository,
        users: UserRepository,
        audit: AuditLogRepository,
        levels: UnitLevelRepository,
        employees: EmployeeRepository,
        deliveries: DeliveryRepository | None = None,
    ) -> None:
        self.departments = departments
        self.roles = roles
        self.users = users
        self.audit = audit
        self.levels = levels
        self.employees = employees
        # Chỉ để đếm chuyến đang chạy khi TẮT cờ Giao hàng. Tuỳ chọn để test dựng service gọn vẫn
        # chạy; `deps.get_department_service` luôn truyền.
        self.deliveries = deliveries

    def _level_rank(self, level_id: int | None) -> int | None:
        if level_id is None:
            return None
        level = self.levels.get_by_id(level_id)
        return level.rank if level is not None else None

    def _validate_hierarchy(
        self, *, dept_id: int | None, parent_id: int | None, level_id: int | None
    ) -> None:
        """Guard the org tree (spec-06 / PBI-4007): no parent cycle, and a child unit's level
        must rank strictly BELOW its parent's (rank number higher = lower tier). `dept_id` is
        None on create (the unit has no descendants/children yet)."""
        # Cycle: the chosen parent may not be the unit itself or any of its descendants.
        if parent_id is not None and dept_id is not None:
            if any(d.id == parent_id for d in self.departments.subtree(dept_id)):
                raise DepartmentCycle(
                    "Không thể chọn chính đơn vị hoặc đơn vị con/cháu làm đơn vị cha"
                )
        my_rank = self._level_rank(level_id)
        # This unit's level vs its parent's: child must be a lower tier (bigger rank).
        if parent_id is not None and my_rank is not None:
            parent = self.departments.get_by_id(parent_id)
            parent_rank = self._level_rank(parent.level_id) if parent is not None else None
            if parent_rank is not None and my_rank <= parent_rank:
                raise InvalidLevelOrder(
                    "Cấp của đơn vị con phải thấp hơn cấp của đơn vị cha"
                )
        # This unit's level vs its existing direct children (update only): each child must
        # stay a lower tier than this unit.
        if my_rank is not None and dept_id is not None:
            for child in self.departments.children_of(dept_id):
                child_rank = self._level_rank(child.level_id)
                if child_rank is not None and child_rank <= my_rank:
                    raise InvalidLevelOrder(
                        "Cấp của đơn vị phải cao hơn cấp của các đơn vị con"
                    )

    def _dem_theo_phong(self) -> tuple[dict[int, int], dict[int, int], dict[int, int]]:
        """Số vai / tài khoản / hồ sơ của MỌI phòng — ba truy vấn `GROUP BY`, không phụ thuộc số
        phòng. Bản cũ đếm 3 câu cho TỪNG phòng (39 phòng ⇒ ~120 truy vấn, ~0,7s mỗi lần mở màn)."""
        return (
            self.roles.counts_by_department(),
            self.users.counts_by_department(),
            # Đ2: "số nhân sự" đếm theo HỒ SƠ (employees), tách khỏi "số tài khoản" (users).
            self.employees.counts_by_department(),
        )

    def _dong_tom_tat(
        self, dept: Department, *, dem: tuple[int, int, int], tong: tuple[int, int, int],
        heads: dict, levels: dict,
    ) -> dict:
        """Một dòng danh sách phòng. `heads`/`levels` là map đã nạp SẴN một lượt cho cả danh
        sách — dựng dòng không được tự đi hỏi DB (đó là chỗ N+1 cũ)."""
        head = heads.get(dept.head_user_id) if dept.head_user_id is not None else None
        level = levels.get(dept.level_id) if dept.level_id is not None else None
        return {
            "id": dept.id,
            "name": dept.name,
            "code": dept.code,
            "description": dept.description,
            "parent_id": dept.parent_id,
            "head_user_id": dept.head_user_id,
            "head_name": head.name if head is not None else None,
            # Ảnh đại diện của trưởng phòng phải trả từ SERVER: FE chỉ có ảnh của người đang đăng
            # nhập, thiếu field này thì ai mở màn cũng chỉ thấy đúng ảnh của chính mình.
            "head_avatar_url": head.avatar_url if head is not None else None,
            "level_id": dept.level_id,
            # Chức danh trưởng lấy theo cấp của đơn vị (spec-06 / PBI-4004).
            "head_title": (level.head_title or None) if level is not None else None,
            "la_san_xuat": dept.la_san_xuat,
            "la_kinh_doanh": dept.la_kinh_doanh,
            "la_giao_hang": dept.la_giao_hang,
            "la_to_in": dept.la_to_in,
            "don_gia_km": float(dept.don_gia_km or 0),
            "pct_tai_xe": float(dept.pct_tai_xe if dept.pct_tai_xe is not None else 60),
            "pct_phu_xe": float(dept.pct_phu_xe if dept.pct_phu_xe is not None else 40),
            "role_count": dem[0],
            "user_count": dem[1],
            "employee_count": dem[2],
            "total_role_count": tong[0],
            "total_user_count": tong[1],
            "total_employee_count": tong[2],
            "has_piece_work": dept.has_piece_work,
            "created_at": dept.created_at,
        }

    def _nap_head_level(self, depts: list[Department]) -> tuple[dict, dict]:
        heads = self.users.get_many(d.head_user_id for d in depts)
        levels = {lv.id: lv for lv in self.levels.list_all()}
        return heads, levels

    def list_summaries(self) -> list[dict]:
        """All departments with own + branch-rolled-up role/user counts (PBI-4001).

        Counts each department's own roles/users once, then sums every descendant's counts
        into each ancestor via a memoized walk over the parent→children map — so a parent
        unit's `total_*` aggregates its whole sub-tree. Số truy vấn CỐ ĐỊNH (guard
        `test_phong_ban_khong_n_cong_1`), không tăng theo số phòng.
        """
        depts = self.departments.list_all()
        own_roles, own_users, own_emps = self._dem_theo_phong()
        heads, levels = self._nap_head_level(depts)

        children: dict[int, list[int]] = {}
        for d in depts:
            if d.parent_id is not None:
                children.setdefault(d.parent_id, []).append(d.id)

        role_total: dict[int, int] = {}
        user_total: dict[int, int] = {}
        emp_total: dict[int, int] = {}

        def totals(dept_id: int, visiting: frozenset[int]) -> tuple[int, int, int]:
            if dept_id in role_total:
                return role_total[dept_id], user_total[dept_id], emp_total[dept_id]
            r, u, e = own_roles.get(dept_id, 0), own_users.get(dept_id, 0), own_emps.get(dept_id, 0)
            for child_id in children.get(dept_id, []):
                if child_id in visiting:  # defensive: never recurse a cycle
                    continue
                cr, cu, ce = totals(child_id, visiting | {dept_id})
                r += cr
                u += cu
                e += ce
            role_total[dept_id], user_total[dept_id], emp_total[dept_id] = r, u, e
            return r, u, e

        return [
            self._dong_tom_tat(
                dept,
                dem=(own_roles.get(dept.id, 0), own_users.get(dept.id, 0), own_emps.get(dept.id, 0)),
                tong=totals(dept.id, frozenset()),
                heads=heads, levels=levels,
            )
            for dept in depts
        ]

    def loc_summaries(
        self, *, q: str | None = None, khoi: list[str] | None = None,
        tinh_trang: list[str] | None = None, tu_ngay: date | None = None,
        den_ngay: date | None = None,
    ) -> list[dict]:
        """Danh sách phòng theo thanh lọc của màn Phòng ban (06/10/2026) — lọc ở MÁY CHỦ.

        Trả phòng KHỚP (`khop=True`) cùng mọi TỔ TIÊN của nó (`khop=False`) để màn vẽ được cây/sơ
        đồ có đường nối từ gốc xuống. Không có điều kiện nào ⇒ trả trọn cây, mọi dòng `khop=True`.

        - `khoi`: tập con `san_xuat` / `ngoai_sx` / `kinh_doanh` / `giao_hang` / `kcs` — khớp một
          là đủ. Sản xuất, Kinh doanh KẾ THỪA cây (tổ tiên bật cờ là thuộc khối, cùng luật
          `rbac_repo._khoi_theo_co`); Giao hàng, KCS đọc cờ riêng của phòng.
        - `tinh_trang`: `co_truong` / `thieu_truong` (có người cả nhánh mà chưa gán trưởng) /
          `chua_co_nguoi` (chưa gán trưởng và cả nhánh chưa có ai) — xét trưởng TRƯỚC.
        - `tu_ngay` / `den_ngay`: Ngày tạo theo giờ VN.

        Số phòng cỡ vài chục và cờ khối phải đi ngược cây ⇒ lọc trên các dòng đã dựng (cùng
        `list_summaries`, số truy vấn cố định), không dịch sang SQL.
        """
        rows = self.list_summaries()
        khoi = [k for k in (khoi or []) if k]
        tinh_trang = [t for t in (tinh_trang or []) if t]
        go = (q or "").strip().lower()
        if not (go or khoi or tinh_trang or tu_ngay or den_ngay):
            return [{**r, "khop": True} for r in rows]

        by_id = {r["id"]: r for r in rows}

        def to_tien(r: dict):
            seen: set[int] = set()
            cur = r
            while cur is not None and cur["id"] not in seen:
                seen.add(cur["id"])
                yield cur
                cur = by_id.get(cur["parent_id"]) if cur["parent_id"] is not None else None

        def thuoc_khoi(r: dict, k: str) -> bool:
            if k == "san_xuat":
                return any(x["la_san_xuat"] for x in to_tien(r))
            if k == "ngoai_sx":
                return not any(x["la_san_xuat"] for x in to_tien(r))
            if k == "kinh_doanh":
                return any(x["la_kinh_doanh"] for x in to_tien(r))
            if k == "giao_hang":
                return bool(r["la_giao_hang"])
            return False

        def tinh_trang_cua(r: dict) -> str:
            if r["head_user_id"] is not None:
                return "co_truong"
            return "chua_co_nguoi" if not r["total_employee_count"] else "thieu_truong"

        def ngay_tao(r: dict) -> date | None:
            t = r.get("created_at")
            if t is None:
                return None
            if t.tzinfo is None:  # SQLite (bộ test) cất mốc UTC không múi
                t = t.replace(tzinfo=timezone.utc)
            return t.astimezone(_VN_TZ).date()

        def khop(r: dict) -> bool:
            if go and go not in f"{r['code'] or ''} {r['name']} {r['head_name'] or ''}".lower():
                return False
            if khoi and not any(thuoc_khoi(r, k) for k in khoi):
                return False
            if tinh_trang and tinh_trang_cua(r) not in tinh_trang:
                return False
            if tu_ngay or den_ngay:
                d = ngay_tao(r)
                if d is None or (tu_ngay and d < tu_ngay) or (den_ngay and d > den_ngay):
                    return False
            return True

        khop_ids = {r["id"] for r in rows if khop(r)}
        hien: set[int] = set()
        for i in khop_ids:
            hien.update(x["id"] for x in to_tien(by_id[i]))
        return [{**r, "khop": r["id"] in khop_ids} for r in rows if r["id"] in hien]

    def summary_of(self, dept: Department) -> dict:
        """Build the list-row shape for a single department (after create/update), including
        the branch-rolled-up counts (PBI-4001)."""
        branch = self.departments.subtree(dept.id)
        own_roles, own_users, own_emps = self._dem_theo_phong()
        heads, levels = self._nap_head_level([dept])
        return self._dong_tom_tat(
            dept,
            dem=(own_roles.get(dept.id, 0), own_users.get(dept.id, 0), own_emps.get(dept.id, 0)),
            tong=(
                sum(own_roles.get(d.id, 0) for d in branch),
                sum(own_users.get(d.id, 0) for d in branch),
                sum(own_emps.get(d.id, 0) for d in branch),
            ),
            heads=heads, levels=levels,
        )

    def members_of_department(self, department_id: int) -> list[dict]:
        """NHÂN SỰ của một phòng — liệt kê theo HỒ SƠ, không phải theo tài khoản (Đ2:
        "ai thuộc phòng nào" bám hồ sơ). Kèm thông tin tài khoản nếu có: mọi tài khoản đều
        thuộc một hồ sơ, nhưng hồ sơ thì CÓ THỂ chưa có tài khoản (công nhân xưởng không
        cần đăng nhập) — những người đó trước đây bị màn Phòng ban bỏ sót."""
        dept = self.departments.get_by_id(department_id)
        head_id = dept.head_user_id if dept is not None else None
        emps = self.employees.list_by_department(department_id)
        # Tài khoản + tên vai nạp MỘT lượt cho cả phòng (bản cũ hỏi 2 câu cho từng người).
        users = self.users.get_many(e.user_id for e in emps)
        ten_vai = self.roles.names_by_ids(u.role_id for u in users.values())
        members: list[dict] = []
        for emp in emps:
            user = users.get(emp.user_id) if emp.user_id is not None else None
            role_name = ten_vai.get(user.role_id) if user is not None and user.role_id is not None else None
            members.append(
                {
                    "employee_id": emp.id,
                    "code": emp.code,
                    "name": emp.full_name,
                    "position": emp.position,
                    "status": emp.status,
                    "user_id": user.id if user is not None else None,
                    "username": user.username if user is not None else None,
                    "role_name": role_name,
                    "is_active": user.is_active if user is not None else None,
                    "is_head": user is not None and user.id == head_id,
                    # Ảnh nằm trên TÀI KHOẢN (`users.avatar_url`), không nằm trên hồ sơ nhân sự —
                    # nên người chưa có tài khoản (công nhân xưởng không cần đăng nhập) thì null,
                    # và FE hiện chữ viết tắt. Phải trả ở đây: FE chỉ biết ảnh của chính người đang
                    # đăng nhập, thiếu field này là cả danh sách ra chữ viết tắt trừ đúng một dòng.
                    "avatar_url": user.avatar_url if user is not None else None,
                }
            )
        return members

    def head_candidates(self, dept_id: int) -> list:
        """People eligible to head a unit (spec-06 / PBI-4004): everyone in the unit and its
        sub-units (subtree). Returns User rows; empty if the department does not exist."""
        # Một truy vấn cho cả nhánh; giữ thứ tự cũ: theo thứ tự cây (gốc trước), trong phòng theo id.
        thu_tu = {d.id: i for i, d in enumerate(self.departments.subtree(dept_id))}
        users = self.users.list_by_departments(thu_tu)
        return sorted(users, key=lambda u: (thu_tu[u.department_id], u.id))

    def create(
        self,
        *,
        name: str,
        description: str | None = None,
        parent_id: int | None = None,
        level_id: int | None = None,
        has_piece_work: bool = False,
        la_san_xuat: bool = False,
        la_kinh_doanh: bool = False,
        la_giao_hang: bool = False,
        la_to_in: bool = False,
        don_gia_km: float = 0.0,
        pct_tai_xe: float = 60.0,
        pct_phu_xe: float = 40.0,
        actor_id: int | None,
    ) -> Department:
        name = name.strip()
        if self.departments.get_by_name(name) is not None:
            raise DepartmentNameTaken("Tên phòng ban đã tồn tại")
        if parent_id is not None and self.departments.get_by_id(parent_id) is None:
            raise DepartmentNotFound("Không tìm thấy phòng cha")
        if level_id is not None and self.levels.get_by_id(level_id) is None:
            raise DepartmentNotFound("Không tìm thấy cấp đơn vị")
        # New unit has no descendants yet — only the parent/level ordering rule applies.
        self._validate_hierarchy(dept_id=None, parent_id=parent_id, level_id=level_id)
        desc = (description or "").strip() or None
        dept = self.departments.create(
            name=name,
            description=desc,
            parent_id=parent_id,
            has_piece_work=has_piece_work,
        )
        if level_id is not None:
            self.departments.set_level(dept, level_id)
        if la_san_xuat:
            self.departments.set_la_san_xuat(dept, True)
        if la_kinh_doanh:
            self.departments.set_la_kinh_doanh(dept, True)
        if la_giao_hang:
            self.departments.set_la_giao_hang(dept, True)
        if la_to_in:
            self.departments.set_la_to_in(dept, True)
        self._dat_khoan_km(dept, don_gia_km, pct_tai_xe, pct_phu_xe)
        _dong_bo_quyen_to(self.departments.db)
        self.audit.create(
            actor_user_id=actor_id,
            action="create_department",
            target=f"dept:{dept.id}",
            detail=f"{dept.code} {name}",
        )
        return dept

    def update(
        self,
        *,
        dept_id: int,
        name: str,
        description: str | None = None,
        head_user_id: int | None,
        level_id: int | None = None,
        parent_id: int | None | object = _KEEP,
        has_piece_work: bool | None = None,
        actor_id: int | None,
        allow_set_head: bool = True,
        allow_reparent: bool = True,
        la_san_xuat: bool = False,
        la_kinh_doanh: object = _KEEP,
        la_giao_hang: object = _KEEP,
        la_to_in: object = _KEEP,
        don_gia_km: object = _KEEP,
        pct_tai_xe: object = _KEEP,
        pct_phu_xe: object = _KEEP,
    ) -> Department:
        dept = self.departments.get_by_id(dept_id)
        if dept is None:
            raise DepartmentNotFound("Không tìm thấy phòng ban")
        # Đổi trưởng phòng là quyền chi tiết riêng; giữ nguyên head thì không cần.
        if head_user_id != dept.head_user_id and not allow_set_head:
            raise SetHeadForbidden("Bạn không có quyền đặt trưởng phòng.")
        # Absent parent_id → keep the current parent (partial update, e.g. a plain rename).
        if parent_id is _KEEP:
            parent_id = dept.parent_id
        # Đổi cấp trên (tái cấu trúc cây) là quyền chi tiết riêng; giữ nguyên thì không cần.
        if parent_id != dept.parent_id and not allow_reparent:
            raise ReparentForbidden("Bạn không có quyền đổi cấp trên của phòng ban.")
        name = name.strip()
        clash = self.departments.get_by_name(name)
        if clash is not None and clash.id != dept_id:
            raise DepartmentNameTaken("Tên phòng ban đã tồn tại")
        if head_user_id is not None and not self._can_head(dept_id, head_user_id):
            raise InvalidHead("Người đứng đầu phải thuộc phòng này hoặc đơn vị con")
        if level_id is not None and self.levels.get_by_id(level_id) is None:
            raise DepartmentNotFound("Không tìm thấy cấp đơn vị")
        if parent_id is not None and self.departments.get_by_id(parent_id) is None:
            raise DepartmentNotFound("Không tìm thấy phòng cha")
        # No cycle (parent ∉ this unit's subtree) + child level ranks below parent (PBI-4007).
        self._validate_hierarchy(dept_id=dept_id, parent_id=parent_id, level_id=level_id)
        # Luật "Giao hàng ⟷ Lương khoán loại trừ nhau" (16/09/2026) GỠ 26/10/2026 (L-SX-42): cờ
        # `has_piece_work` không còn ảnh hưởng tiền từ khi gỡ công tắc lương khoán theo tổ (20/10) —
        # vế khoán của tổ giao hàng là tiền km (`_tinh_hai_luong`), chặn theo cờ chết chỉ khoá tổ cũ.
        # Tắt cờ Giao hàng: kiểm TRƯỚC mọi thao tác ghi, chặn là chặn cả lượt sửa.
        if (la_giao_hang is not _KEEP and not bool(la_giao_hang) and dept.la_giao_hang
                and self.deliveries is not None):
            n = self.deliveries.dem_chuyen_chua_ket_qua_cua_phong(dept_id)
            if n:
                raise GiaoHangConChuyenChay(
                    f"Còn {n} chuyến đang chạy của tài xế phòng này — đóng hoặc huỷ hết rồi mới "
                    "tắt được cờ Giao hàng."
                )
        # Cờ trước khi sửa — để nhật ký ghi "Tổ in: tắt → bật" (L-SX-38).
        co_cu = {"Tổ in": bool(dept.la_to_in), "Giao hàng": bool(dept.la_giao_hang)}
        o_cu = (dept.name, dept.head_user_id, dept.level_id, dept.parent_id)
        # The code is system-owned and never edited here (spec-05).
        self.departments.rename(dept, name)
        self.departments.set_description(dept, (description or "").strip() or None)
        self.departments.set_head(dept, head_user_id)
        self.departments.set_level(dept, level_id)
        self.departments.set_parent(dept, parent_id)
        # Cờ có lương khoán: chỉ đụng khi client gửi (giữ nguyên nếu bỏ trống).
        self.departments.set_has_piece_work(
            dept, has_piece_work if has_piece_work is not None else dept.has_piece_work,
        )
        self.departments.set_la_san_xuat(dept, la_san_xuat)
        # Cờ khối Kinh doanh: KHÔNG gửi = giữ nguyên (khác `la_san_xuat` vốn luôn ghi đè). Màn
        # Phòng ban có nhiều luồng sửa chỉ đụng tên/trưởng phòng; ghi đè mặc định False ở đó là
        # âm thầm gỡ khối Kinh doanh của phòng, và danh sách NV phụ trách đổi theo mà không ai báo.
        if la_kinh_doanh is not _KEEP:
            self.departments.set_la_kinh_doanh(dept, bool(la_kinh_doanh))
        # Cờ KCS: cùng luật "KHÔNG gửi = giữ nguyên" như khối Kinh doanh.
        # Cùng luật "KHÔNG gửi = giữ nguyên" như cờ Kinh doanh ngay trên: màn Phòng ban có nhiều
        # luồng sửa chỉ đụng tên/trưởng phòng, ghi đè mặc định False ở đó là âm thầm gỡ bộ phận
        # giao hàng, và tab Nhân viên giao hàng trống trơn mà không ai báo.
        if la_giao_hang is not _KEEP:
            self.departments.set_la_giao_hang(dept, bool(la_giao_hang))
        # Cờ Tổ in: cùng luật "KHÔNG gửi = giữ nguyên" như cờ Giao hàng ngay trên — tắt nhầm là
        # ngày CN / lễ của thợ in đổi tiền mà không ai báo.
        if la_to_in is not _KEEP:
            self.departments.set_la_to_in(dept, bool(la_to_in))
        if don_gia_km is not _KEEP or pct_tai_xe is not _KEEP or pct_phu_xe is not _KEEP:
            self._dat_khoan_km(
                dept,
                dept.don_gia_km if don_gia_km is _KEEP else don_gia_km,
                dept.pct_tai_xe if pct_tai_xe is _KEEP else pct_tai_xe,
                dept.pct_phu_xe if pct_phu_xe is _KEEP else pct_phu_xe,
            )
        # Đổi tên / cờ khối / cấp trên đều có thể đổi dòng quyền theo tổ (nhãn, thêm, gỡ).
        _dong_bo_quyen_to(self.departments.db)
        self.audit.create(
            actor_user_id=actor_id,
            action="update_department",
            target=f"dept:{dept_id}",
            detail=self._chu_sua(o_cu, (name, head_user_id, level_id, parent_id)) + "".join(
                f". {nhan}: {'bật' if cu else 'tắt'} → {'bật' if moi else 'tắt'}"
                for (nhan, cu), moi in zip(co_cu.items(), (bool(dept.la_to_in), bool(dept.la_giao_hang)))
                if cu != moi),
        )
        return dept

    def _chu_sua(self, cu: tuple, moi: tuple) -> str:
        """Câu nhật ký sửa phòng: tên phòng rồi các ô ĐÃ đổi, bằng tên chứ không bằng mã số
        (L-SX-38: trước ghi `(head=None, level=None, parent=28)` cho mọi lần sửa)."""
        def ten_nguoi(i):
            u = self.users.get_by_id(i) if i is not None else None
            return (u.name or u.username) if u is not None else "không có"

        def ten_cap(i):
            lv = self.levels.get_by_id(i) if i is not None else None
            return lv.name if lv is not None else "không có"

        def ten_phong(i):
            d = self.departments.get_by_id(i) if i is not None else None
            return d.name if d is not None else "không có (phòng gốc)"

        doi = [f"{nhan} {f(a)} → {f(b)}" for nhan, f, a, b in (
            ("tên", str, cu[0], moi[0]),
            ("trưởng phòng", ten_nguoi, cu[1], moi[1]),
            ("cấp đơn vị", ten_cap, cu[2], moi[2]),
            ("cấp trên", ten_phong, cu[3], moi[3]),
        ) if a != b]
        return f"Sửa phòng {moi[0]}" + (f": {', '.join(doi)}" if doi else "")

    def _dat_khoan_km(self, dept, don_gia_km, pct_tai_xe, pct_phu_xe) -> None:
        """Ghi ba ô khoán km, sau khi kiểm hai tỷ lệ cộng đúng 100 (mg 0231).

        ⭐ Vì sao bắt đúng 100: tiền một chuyến = km × đơn giá, chia cho kíp theo hai tỷ lệ này.
        Cộng ra 90 thì công ty giữ lại 10% mà không ai khai điều đó ở đâu; cộng ra 110 thì chuyến
        có phụ xe đắt hơn chuyến đi một mình 10% — cả hai đều là số không giải thích được khi kế
        toán đối chiếu. Chặn ở đây, một chỗ, cho cả tạo lẫn sửa.

        Dung sai 0,01 vì hai ô là `Numeric(5,2)`: gõ 33,33 / 66,67 phải nhận, không thì không chia
        được ba phần.
        """
        tx, px = float(pct_tai_xe), float(pct_phu_xe)
        if abs(tx + px - 100.0) > 0.01:
            raise KhoanKmInvalid(
                f"% tài xế + % phụ xe phải bằng 100 (đang là {tx:g} + {px:g} = {tx + px:g})."
            )
        if float(don_gia_km) < 0:
            raise KhoanKmInvalid("Đơn giá km không được âm.")
        dept.don_gia_km = float(don_gia_km)
        dept.pct_tai_xe = tx
        dept.pct_phu_xe = px

    def _can_head(self, dept_id: int, user_id: int) -> bool:
        """A valid head belongs to the unit OR any unit in its subtree (spec-06 / PBI-4004)."""
        user = self.users.get_by_id(user_id)
        if user is None or user.department_id is None:
            return False
        return any(d.id == user.department_id for d in self.departments.subtree(dept_id))

    def branch(self, dept_id: int) -> list[Department]:
        """The department + its whole subtree (spec-05) — the units a delete would remove.
        Empty if the department does not exist."""
        return self.departments.subtree(dept_id)

    def delete(self, *, dept_id: int, actor_id: int | None) -> None:
        """Delete a department AND its entire subtree (PBI-4005). Blocked if ANY unit in the
        branch still has personnel; roles of the deleted units are removed with them. Writes
        one AuditLog row per deleted unit."""
        dept = self.departments.get_by_id(dept_id)
        if dept is None:
            raise DepartmentNotFound("Không tìm thấy phòng ban")
        branch = self.departments.subtree(dept_id)  # root first (breadth-first)
        # Đ2: chặn nếu nhánh còn HỒ SƠ nhân sự (không để employees.department_id mồ côi) HOẶC
        # còn TÀI KHOẢN (users.department_id là FK cứng — xóa sẽ vỡ). Chặn theo hồ-sơ ∪ tài-khoản.
        offenders: list[tuple[Department, int]] = []
        _, dem_tk, dem_hs = self._dem_theo_phong()
        for d in branch:
            u = dem_tk.get(d.id, 0)
            e = dem_hs.get(d.id, 0)
            if u > 0 or e > 0:
                offenders.append((d, max(u, e)))
        if offenders:
            raise DepartmentBranchHasUsers(offenders)
        # Delete leaves first (reverse of the breadth-first order) so a parent's self-FK is
        # never left dangling. Each unit's roles go with it (no one holds them — branch has
        # no users).
        for d in reversed(branch):
            for role in self.roles.list_by_department(d.id):
                self.roles.delete(role)
            self.departments.delete(d)
            self.audit.create(
                actor_user_id=actor_id,
                action="delete_department",
                target=f"dept:{d.id}",
                detail=f"{d.code} {d.name}",
            )
        # Dòng quyền `to_sx_<id>` của các phòng vừa xoá đi theo (cùng các ô đã cấp trên nó).
        _dong_bo_quyen_to(self.departments.db)
