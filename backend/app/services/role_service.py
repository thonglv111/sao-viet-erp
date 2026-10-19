"""Role-management business logic (the Vai trò admin screen).

Framework-agnostic: raises domain errors the router maps to HTTP. Owns role
creation (with per-department name dedup) and reading/saving a role's permission
matrix (CRUD + scope per module), writing an audit row on every change.
"""
from __future__ import annotations

from ..catalog_registry import MODULE_KEYS
from ..models.role import Role
from ..quyen_notify import bao_quyen_doi
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.rbac_repo import O_LUON_BAT, DepartmentRepository, ModuleRepository, RoleRepository
from ..repositories.user_repo import UserRepository


class RoleError(Exception):
    """Base for role-management domain errors."""


class RoleNameTaken(RoleError):
    """A role with that name already exists in the department."""


class RoleNotFound(RoleError):
    """No role with that id."""


class DepartmentNotFound(RoleError):
    """No department with that id."""


class RoleInUse(RoleError):
    """A role still assigned to users cannot be deleted."""

    def __init__(self, count: int) -> None:
        self.count = count
        super().__init__(
            f"Không thể xóa: còn {count} người dùng đang giữ vai trò này. "
            "Hãy chuyển họ sang vai trò khác trước."
        )


# Module DANH MỤC — dữ liệu dùng chung toàn công ty, KHÔNG có phạm vi own/department. UI đã bỏ
# dropdown Phạm vi ở nhóm này; ép `all` khi lưu để vai mới (mặc định `own`) không bị bó âm thầm
# nếu sau này có ai bật lọc theo scope.
#
# Các khoá danh mục lấy từ `catalog_registry` (thêm màn danh mục là tự có mặt ở đây, không phải
# nhớ chép sang). Ngoài danh mục thì liệt kê tay bên dưới — registry chỉ nói về danh mục.
SCOPELESS_MODULES = frozenset(MODULE_KEYS) | {
    # Kỹ thuật máy (12/08/2026): phiếu sửa chữa / bảo trì là việc chung của xưởng — không có khái
    # niệm "phiếu của tôi", nên bày dropdown Phạm vi chỉ khiến người cấp quyền tưởng mình vừa giới
    # hạn được cái gì.
    "ky_thuat_may",
    # Ba màn tách khỏi `san_xuat` ngày 17/08/2026. Đã soi: KHÔNG router nào của chúng đọc scope
    # (`bai_ghep_2.py` · `xep_lich.py` · `ke_hoach_vat_tu.py` đều 0 lần) — bài ghép và lịch xưởng
    # là bức tranh chung, không có "bài ghép của tôi". Riêng `san_xuat` KHÔNG vào đây: `lsx.py` đọc
    # scope thật (`_owner_ids_for_scope`) — từ 14/10/2026 theo CHỦ ĐƠN, như Đơn hàng bán.
    # Khoá `bai_ghep` gỡ 18/08/2026 (mg 0216) — quyền đã chép sang `bai_ghep_2`.
    "ke_hoach_vat_tu",
    "bai_ghep_2",
    # Xếp lịch — bàn cấp LỆNH SẢN XUẤT: `routers/xep_lich.py` 0 lần đọc scope, vì đây là bức
    # tranh chung của cả xưởng, không có "lịch của tôi". Hai khoá cũ `xep_lich_2`/`xep_lich_3`
    # xoá ở mg `0314`.
    "xep_lich",
    # Phiếu bảo trì tách khỏi `ky_thuat_may` cùng ngày, thừa hưởng đúng lý do của khoá mẹ.
    "phieu_bao_tri",
    # Mua hàng (14/10/2026, chủ chốt *"để tất cả và không chuyển đổi được"*): bỏ chốt 04/08/2026
    # "nhân viên chỉ thấy đơn của tôi" — ai có màn Mua hàng thấy mọi phiếu mua. mg 0411 đổ dòng cũ.
    "thu_mua",
    # Quy trình kinh doanh (24/09/2026): bản đồ luồng tĩnh, không đọc dữ liệu của ai nên không có
    # "quy trình của tôi".
    "quy_trinh_kinh_doanh",
    # Nhật ký (25/09/2026): `routers/rbac.py` chưa bao giờ đọc scope của khoá này — bật Xem là
    # thấy toàn bộ, chọn "Của tôi" hay "Tất cả" đều như nhau, tức ô phạm vi đang NÓI DỐI người đi
    # cấp quyền. Nhật ký cũng không có nghĩa "của tôi": xem nhật ký của chính mình thì vô dụng cho
    # việc truy. Cái thật sự giới hạn tầm nhìn là QUYỀN TRÊN TỪNG MÀN — dòng của màn nào người xem
    # không mở được thì `ActivityService` che đi (và nói rõ có bao nhiêu dòng bị che).
    "activity_log",
    # Báo cáo kho (24/09/2026): sổ của CẢ KHO. `routers/kho_baocao.py` không đọc scope quyền —
    # `_scope_kho_ids` là lọc theo kho người dùng chọn, không phải phạm vi của vai.
    "bao_cao_kho",
    # Nội quy công ty (24/09/2026, chủ chốt: *"nội quy công ty mặc định tất cả và không cho chỉnh
    # sửa"*): nội quy lao động là tài liệu CHUNG — không có "nội quy của tôi" hay "nội quy của
    # phòng tôi". Ô Xem đã khoá bật sẵn cho mọi vai (`rbac_repo.O_MAC_DINH`), nay phạm vi cũng ép
    # `all` ở máy chủ và giao diện khoá luôn ô chọn.
    "noi_quy",
    # Tồn kho: từ 05/10/2026 là dòng ĐỘNG `ton_kho_<id>` mỗi kho một dòng — scopeless theo TIỀN TỐ
    # (`_la_scopeless` dưới), không liệt kê được ở đây.
    # Bốn màn sổ sách kế toán / tài sản (05/10/2026): `routers/accounting.py` và `routers/tai_san.py`
    # không đọc phạm vi của các khoá này lần nào — bật Xem là thấy toàn bộ, nên ô Phạm vi đang nói
    # dối người cấp quyền. Ép `all` lúc lưu, giao diện khoá cho khớp.
    "phieu_chi",
    "phieu_thu",
    "tk_ngan_hang",
    "tai_san",
    # KCS (09/10/2026): kiểm cả chuỗi của MỌI tổ — không có "lần kiểm của tôi". Phạm vi theo tổ là
    # việc của dòng `to_sx_<id>`, không phải dòng này.
    "kcs",
    # Báo cáo thu chi (11/10/2026): sổ thu chi của CẢ CÔNG TY, router không đọc phạm vi.
    "bao_cao_thu_chi",
}


def _la_scopeless(module_key: str) -> bool:
    """Khoá tĩnh trong `SCOPELESS_MODULES`, cộng mọi dòng quyền theo kho (`ton_kho_<id>`): người
    này thấy được kho nào là do CHÍNH DÒNG của kho đó quyết định, không phải phạm vi của vai."""
    from .quyen_kho import la_khoa_kho

    return module_key in SCOPELESS_MODULES or la_khoa_kho(module_key)


READ_IMPLYING_KEYS = (
    "can_create",
    "can_update",
    "can_delete",
    "can_reassign",
    "can_export",
    "can_view_debt",
    "can_view_discount",
    "can_approve",
    "can_manage_status",
    "can_reset_password",
    "can_lock",
    "can_revoke_sessions",
    "can_assign_role",
    "can_transfer",
    "can_set_head",
    "can_requote",
    "can_manage_price",
    "can_cancel",
    "can_manage_permissions",
    "can_clone",
    "can_toggle_active",
    "can_reparent",
    "can_view_salary",
    "can_edit_salary",
    "can_adjust",
    "can_view_log",
    "can_view_timesheet",
    "can_approve_late_early",
    "can_manage_locations",
    "can_manage_shifts",
    "can_manage_calendar",
    "can_view_payroll_table",
    "can_manage_salary_profiles",
    "can_manage_piece_rates",
    "can_manage_leave_types",
    "can_plan",
    "can_view_drivers",
    "can_approve_exception",
    "can_set_credit_terms",
    "can_assign_work",
    "can_record_output",
    "can_handover",
    "can_request",
    "can_view_stock",
    "can_view_cost",
    "can_set_threshold",
    "can_post",
    "can_close_book",
    "can_run_order",
    "can_confirm_output",
    "can_warehouse",
    "can_close_short",
)


class RoleService:
    def __init__(
        self,
        roles: RoleRepository,
        modules: ModuleRepository,
        departments: DepartmentRepository,
        audit: AuditLogRepository,
        users: UserRepository,
    ) -> None:
        self.roles = roles
        self.modules = modules
        self.departments = departments
        self.audit = audit
        self.users = users

    def list_departments(self):
        return self.departments.list_all()

    def list_roles(self, department_id: int) -> list[Role]:
        return self.roles.list_by_department(department_id)

    def create_role(self, *, name: str, department_id: int, actor_id: int | None) -> Role:
        dept = self.departments.get_by_id(department_id)
        if dept is None:
            raise DepartmentNotFound("Không tìm thấy phòng ban")
        name = name.strip()
        if self.roles.get_by_name_and_department(name, department_id) is not None:
            raise RoleNameTaken("Tên vai trò đã tồn tại trong phòng này")
        role = self.roles.create(name=name, department_id=department_id)
        self.audit.create(
            actor_user_id=actor_id,
            action="create_role",
            target=f"role:{role.id}",
            detail=f"{dept.name} / {name}",
        )
        return role

    def duplicate_role(
        self,
        *,
        role_id: int,
        name: str | None,
        department_id: int | None,
        actor_id: int | None,
    ) -> Role:
        """Nhân bản một vai trò: vai MỚI, ma trận quyền chép y nguyên.

        Phòng đích bỏ trống = cùng phòng với vai gốc. Tên bỏ trống = "«tên gốc» (bản sao)", tự
        đánh số khi trùng — nhân bản là thao tác một cú, đừng bắt người cấp quyền nghĩ tên.

        Vai mới đẻ ra đã có sẵn hai ô mặc định (`self_service`, `noi_quy`); `copy_permissions`
        THAY SẠCH chúng bằng đúng bộ quyền của vai gốc — bản sao phải giống hệt bản gốc, kể cả
        khi vai gốc đã bị gỡ hai ô đó.
        """
        goc = self.roles.get_by_id(role_id)
        if goc is None:
            raise RoleNotFound("Không tìm thấy vai trò")
        dich_id = department_id if department_id is not None else goc.department_id
        dept = self.departments.get_by_id(dich_id)
        if dept is None:
            raise DepartmentNotFound("Không tìm thấy phòng ban")
        ten = (name or "").strip() or self._ten_ban_sao(goc.name, dich_id)
        if self.roles.get_by_name_and_department(ten, dich_id) is not None:
            raise RoleNameTaken("Tên vai trò đã tồn tại trong phòng này")
        moi = self.roles.create(name=ten, department_id=dich_id)
        so_dong = self.roles.copy_permissions(
            tu_role_id=goc.id,
            sang_role_id=moi.id,
            doi_to=(goc.department_id, dich_id),
        )
        self.audit.create(
            actor_user_id=actor_id,
            action="duplicate_role",
            target=f"role:{moi.id}",
            detail=f"Nhân bản “{goc.name}” → {dept.name} / {ten} ({so_dong} dòng quyền)",
        )
        return moi

    def _ten_ban_sao(self, ten_goc: str, department_id: int) -> str:
        """"X (bản sao)", rồi "X (bản sao 2)"… cho tới khi không trùng trong phòng đích."""
        goc = ten_goc.strip()[:230]
        for i in range(1, 100):
            ten = f"{goc} (bản sao)" if i == 1 else f"{goc} (bản sao {i})"
            if self.roles.get_by_name_and_department(ten, department_id) is None:
                return ten
        raise RoleNameTaken("Tên vai trò đã tồn tại trong phòng này")

    def rename_role(self, *, role_id: int, name: str, actor_id: int | None) -> Role:
        role = self.roles.get_by_id(role_id)
        if role is None:
            raise RoleNotFound("Không tìm thấy vai trò")
        name = name.strip()
        clash = self.roles.get_by_name_and_department(name, role.department_id)
        if clash is not None and clash.id != role_id:
            raise RoleNameTaken("Tên vai trò đã tồn tại trong phòng này")
        old = role.name
        self.roles.update_name(role, name)
        self.audit.create(
            actor_user_id=actor_id,
            action="rename_role",
            target=f"role:{role_id}",
            detail=f"{old} → {name}",
        )
        return role

    def delete_role(self, *, role_id: int, actor_id: int | None, force: bool = False) -> None:
        """Xoá vai trò. Còn người giữ thì chặn (`RoleInUse`) — trừ khi `force` (15/10/2026, chủ chốt
        *"cưỡng chế xóa vai trò"*): gỡ vai khỏi họ (về "chưa có vai", chỉ còn quyền đương nhiên
        của tài khoản) rồi xoá. Họ được báo đổi quyền ngay để menu tự rút."""
        role = self.roles.get_by_id(role_id)
        if role is None:
            raise RoleNotFound("Không tìm thấy vai trò")
        nguoi = self.users.list_ids_by_role(role_id)
        if nguoi and not force:
            raise RoleInUse(len(nguoi))
        name = role.name
        for uid in nguoi:
            u = self.users.get_by_id(uid)
            self.users.set_assignment(u, department_id=u.department_id, role_id=None,
                                      is_active=u.is_active, commit=False)
        self.roles.delete(role)
        self.audit.create(
            actor_user_id=actor_id,
            action="delete_role",
            target=f"role:{role_id}",
            detail=f"{name} (gỡ khỏi {len(nguoi)} người)" if nguoi else name,
        )
        if nguoi:
            bao_quyen_doi(nguoi)

    def list_modules(self) -> list[dict]:
        """Danh mục module, kèm những "việc" ĐÃ XÁC MINH là chết ở màn đó.

        Ma trận tắt + khoá + hover cảnh báo đúng mấy ô này. KHÔNG suy ngược từ "cái gì máy chủ
        không gác thì chết" — bản đầu làm vậy và khoá nhầm hàng loạt ô chỉ thi hành ở giao diện
        (In/xuất phiếu · Đặt trưởng phòng · Xem lương…). Xem `deps.O_CHET_DA_XAC_MINH`.
        """
        from ..deps import O_CHET_DA_XAC_MINH
        from ..repositories.quyen_kho_repo import QuyenKhoRepository
        from .quyen_kho import khoa_kho, la_khoa_kho
        from .quyen_to import doc_cay, khoa_to

        # Dòng quyền theo KHO (`ton_kho_<id>`, 05/10/2026): chỉ bày kho ĐANG DÙNG (đúng như thanh
        # bên), theo thứ tự mã kho, kèm `kho_id` để ma trận xếp vào khối "Kho hàng". Ba việc
        # create/update/delete chết sẵn — tồn kho không gõ tay, lô sinh từ phiếu nhập.
        kho = QuyenKhoRepository(self.departments.db).danh_sach_kho()
        thu_tu_kho = {khoa_kho(kid): (i, kid) for i, (kid, _ma, _ten, dung) in enumerate(kho) if dung}
        dong_kho = []

        # Dòng quyền theo tổ (`to_sx_<id>`) đứng CUỐI, theo thứ tự cây + kèm cấp để ma trận thụt
        # lề; module tĩnh giữ thứ tự cũ.
        cay = doc_cay(self.departments.db)
        thu_tu_to = {khoa_to(d): (i, d, cap) for i, (d, cap) in enumerate(cay.thu_tu())}
        tinh, dong_to = [], []
        for m in self.modules.list_all():
            if la_khoa_kho(m.key):
                if m.key in thu_tu_kho:
                    i, kho_id = thu_tu_kho[m.key]
                    dong_kho.append((i, {
                        "key": m.key, "label": m.label,
                        "viec_chet": ["create", "delete", "update"], "kho_id": kho_id,
                    }))
                continue  # kho ngừng dùng / dòng mồ côi — không bày ra
            vi_tri = thu_tu_to.get(m.key)
            if vi_tri is None:
                if m.key.startswith("to_sx_"):
                    continue  # dòng mồ côi (cây vừa đổi, chưa đồng bộ) — không bày ra
                tinh.append({
                    "key": m.key,
                    "label": m.label,
                    "viec_chet": sorted(a for (k, a) in O_CHET_DA_XAC_MINH if k == m.key),
                })
            else:
                i, dept_id, cap = vi_tri
                dong_to.append((i, {
                    "key": m.key, "label": m.label, "viec_chet": [],
                    "department_id": dept_id, "cap": cap,
                }))
        return (tinh + [d for _, d in sorted(dong_kho, key=lambda x: x[0])]
                + [d for _, d in sorted(dong_to, key=lambda x: x[0])])

    def get_matrix(self, role_id: int) -> list[dict]:
        """Full matrix for a role: one row per module, merged with stored permissions
        (modules with no stored row default to all-false / own scope)."""
        role = self.roles.get_by_id(role_id)
        if role is None:
            raise RoleNotFound("Không tìm thấy vai trò")
        stored = {p.module_key: p for p in self.roles.permissions_for(role_id)}
        rows: list[dict] = []
        for module in self.modules.list_all():
            p = stored.get(module.key)
            rows.append(
                {
                    "module_key": module.key,
                    "can_read": bool(p.can_read) if p else False,
                    "can_create": bool(p.can_create) if p else False,
                    "can_update": bool(p.can_update) if p else False,
                    "can_delete": bool(p.can_delete) if p else False,
                    "scope": p.scope if p else "own",
                    "can_reassign": bool(p.can_reassign) if p else False,
                    "can_export": bool(p.can_export) if p else False,
                    "can_view_debt": bool(p.can_view_debt) if p else False,
                    "can_view_discount": bool(p.can_view_discount) if p else False,
                    "can_approve": bool(p.can_approve) if p else False,
                    "can_manage_status": bool(p.can_manage_status) if p else False,
                    "can_view_log": bool(p.can_view_log) if p else False,
                    "can_view_timesheet": bool(p.can_view_timesheet) if p else False,
                    "can_approve_late_early": bool(p.can_approve_late_early) if p else False,
                    "can_manage_locations": bool(p.can_manage_locations) if p else False,
                    "can_manage_shifts": bool(p.can_manage_shifts) if p else False,
                    "can_manage_calendar": bool(p.can_manage_calendar) if p else False,
                    "can_view_payroll_table": bool(p.can_view_payroll_table) if p else False,
                    "can_manage_salary_profiles": bool(p.can_manage_salary_profiles) if p else False,
                    "can_manage_piece_rates": bool(p.can_manage_piece_rates) if p else False,
                    "can_manage_leave_types": bool(p.can_manage_leave_types) if p else False,
                    "can_plan": bool(p.can_plan) if p else False,
                    "can_view_drivers": bool(p.can_view_drivers) if p else False,
                    # ⚠️ BA CỘT NÀY TỪNG BỊ SÓT Ở ĐÂY (vá 11/08/2026). `save_matrix` lưu đúng,
                    # máy chủ gác đúng, chỉ đường ĐỌC không trả về ⇒ công tắc trên ma trận luôn
                    # hiện TẮT dù quản trị đã bật và đã Lưu. Người cấp quyền tick đi tick lại,
                    # tưởng hệ thống không nhận. Guard `test_moi_cot_quyen_deu_di_het_duong_ong`
                    # nay soi RIÊNG hàm này nên bỏ sót lần nữa là test đỏ.
                    "can_view_salary": bool(p.can_view_salary) if p else False,
                    "can_edit_salary": bool(p.can_edit_salary) if p else False,
                    "can_adjust": bool(p.can_adjust) if p else False,
                    "can_reset_password": bool(p.can_reset_password) if p else False,
                    "can_lock": bool(p.can_lock) if p else False,
                    "can_revoke_sessions": bool(p.can_revoke_sessions) if p else False,
                    "can_assign_role": bool(p.can_assign_role) if p else False,
                    "can_transfer": bool(p.can_transfer) if p else False,
                    "can_set_head": bool(p.can_set_head) if p else False,
                    "can_requote": bool(p.can_requote) if p else False,
                    "can_manage_price": bool(p.can_manage_price) if p else False,
                    "can_cancel": bool(p.can_cancel) if p else False,
                    "can_manage_permissions": bool(p.can_manage_permissions) if p else False,
                    "can_clone": bool(p.can_clone) if p else False,
                    "can_toggle_active": bool(p.can_toggle_active) if p else False,
                    "can_reparent": bool(p.can_reparent) if p else False,
                    # A2 — quyền duyệt "đơn đặc thù" (chỉ GĐ). (view_salary/edit_salary/adjust vẫn
                    # do save_matrix xử lý riêng, giữ nguyên hành vi cũ — không mở rộng ở đây.)
                    "can_approve_exception": bool(p.can_approve_exception) if p else False,
                    "can_set_credit_terms": bool(p.can_set_credit_terms) if p else False,
                    "can_assign_work": bool(p.can_assign_work) if p else False,
                    "can_record_output": bool(p.can_record_output) if p else False,
                    "can_handover": bool(p.can_handover) if p else False,
                    # kho — quyền chi tiết (spec-kho-de-nghi §9.1) + ghi sổ (SoD).
                    "can_request": bool(p.can_request) if p else False,
                    "can_view_stock": bool(p.can_view_stock) if p else False,
                    "can_view_cost": bool(p.can_view_cost) if p else False,
                    "can_set_threshold": bool(p.can_set_threshold) if p else False,
                    "can_post": bool(p.can_post) if p else False,
                    "can_close_book": bool(p.can_close_book) if p else False,
                    # Dòng quyền theo tổ (mg 0302).
                    "can_run_order": bool(p.can_run_order) if p else False,
                    "can_confirm_output": bool(p.can_confirm_output) if p else False,
                    "can_warehouse": bool(p.can_warehouse) if p else False,
                    "can_close_short": bool(p.can_close_short) if p else False,
                }
            )
        return rows

    def save_matrix(self, *, role_id: int, rows: list[dict], actor_id: int | None) -> list[dict]:
        role = self.roles.get_by_id(role_id)
        if role is None:
            raise RoleNotFound("Không tìm thấy vai trò")
        valid_keys = {m.key for m in self.modules.list_all()}
        # Cả ma trận (~80 dòng) đi trong MỘT giao dịch: nạp sẵn dòng cũ một truy vấn, mỗi dòng chỉ
        # gán giá trị (commit=False), chốt một lần ở dòng nhật ký cuối hàm. Bản cũ SELECT + COMMIT +
        # đọc lại cho TỪNG dòng (~180 truy vấn, ~80 lần commit mỗi lần bấm Lưu) — vừa chậm vừa
        # để lại ma trận nửa cũ nửa mới nếu gãy giữa chừng.
        co_san = {p.module_key: p for p in self.roles.permissions_for(role_id)}
        # Tổ cha là NHÓM (10/10/2026): chỉ tổ lá nhận việc nên quyền cấp ở dòng tổ lá; dòng tổ cha
        # trên ma trận chỉ là tiêu đề gập/mở, lưu luôn TRẮNG — không để quyền vô hình nằm ở đó.
        from .quyen_to import doc_cay, khoa_to

        cay = doc_cay(self.roles.db)
        dong_nhom = {khoa_to(d) for d in cay.ten if not cay.la(d)}
        for row in rows:
            if row["module_key"] not in valid_keys:
                continue  # ignore unknown modules rather than create dangling rows
            if row["module_key"] in dong_nhom:
                row = {"module_key": row["module_key"], "scope": "own"}
            normalized = dict(row)
            can_read = bool(normalized.get("can_read", False))
            if not can_read:
                for key in READ_IMPLYING_KEYS:
                    if normalized.get(key, False):
                        can_read = True
                        break
            # Ô LUÔN BẬT (mg 0410, 0412) — việc của chính mình là quyền của mọi người lao động;
            # client gửi tắt cũng không tắt được. Danh sách ở `rbac_repo.O_LUON_BAT`.
            for key in O_LUON_BAT.get(normalized["module_key"], ()):
                normalized[key] = True
            can_read = can_read or bool(normalized.get("can_read"))
            normalized["can_read"] = can_read
            if _la_scopeless(normalized["module_key"]):
                normalized["scope"] = "all"
            can_approve = normalized.get("can_approve", False)
            self.roles.set_permission(
                role_id=role_id,
                module_key=normalized["module_key"],
                can_read=can_read,
                can_create=normalized.get("can_create", False),
                can_update=normalized.get("can_update", False),
                can_delete=normalized.get("can_delete", False),
                scope=normalized.get("scope", "own"),
                can_reassign=normalized.get("can_reassign", False),
                can_export=normalized.get("can_export", False),
                can_view_debt=normalized.get("can_view_debt", False),
                can_view_discount=normalized.get("can_view_discount", False),
                can_approve=can_approve,
                can_manage_status=normalized.get("can_manage_status", False),
                can_reset_password=normalized.get("can_reset_password", False),
                can_lock=normalized.get("can_lock", False),
                can_revoke_sessions=normalized.get("can_revoke_sessions", False),
                can_assign_role=normalized.get("can_assign_role", False),
                can_transfer=normalized.get("can_transfer", False),
                can_set_head=normalized.get("can_set_head", False),
                can_requote=normalized.get("can_requote", False),
                can_manage_price=normalized.get("can_manage_price", False),
                can_cancel=normalized.get("can_cancel", False),
                can_manage_permissions=normalized.get("can_manage_permissions", False),
                can_clone=normalized.get("can_clone", False),
                can_toggle_active=normalized.get("can_toggle_active", False),
                can_reparent=normalized.get("can_reparent", False),
                can_view_salary=normalized.get("can_view_salary", False),
                can_edit_salary=normalized.get("can_edit_salary", False),
                can_adjust=normalized.get("can_adjust", False),
                can_view_log=normalized.get("can_view_log", False),
                can_view_timesheet=normalized.get("can_view_timesheet", False),
                can_approve_late_early=normalized.get("can_approve_late_early", False),
                can_manage_locations=normalized.get("can_manage_locations", False),
                can_manage_shifts=normalized.get("can_manage_shifts", False),
                can_manage_calendar=normalized.get("can_manage_calendar", False),
                can_view_payroll_table=normalized.get("can_view_payroll_table", False),
                can_manage_salary_profiles=normalized.get("can_manage_salary_profiles", False),
                can_manage_piece_rates=normalized.get("can_manage_piece_rates", False),
                can_manage_leave_types=normalized.get("can_manage_leave_types", False),
                can_plan=normalized.get("can_plan", False),
                can_view_drivers=normalized.get("can_view_drivers", False),
                can_approve_exception=normalized.get("can_approve_exception", False),
                can_set_credit_terms=normalized.get("can_set_credit_terms", False),
                can_assign_work=normalized.get("can_assign_work", False),
                can_record_output=normalized.get("can_record_output", False),
                can_handover=normalized.get("can_handover", False),
                can_request=normalized.get("can_request", False),
                can_view_stock=normalized.get("can_view_stock", False),
                can_view_cost=normalized.get("can_view_cost", False),
                can_set_threshold=normalized.get("can_set_threshold", False),
                can_post=normalized.get("can_post", False),
                can_close_book=normalized.get("can_close_book", False),
                can_run_order=normalized.get("can_run_order", False),
                can_confirm_output=normalized.get("can_confirm_output", False),
                can_warehouse=normalized.get("can_warehouse", False),
                can_close_short=normalized.get("can_close_short", False),
                commit=False,
                co_san=co_san,
            )
        # `audit.create` mặc định commit ⇒ chốt luôn cả ma trận ở trên, cùng sống cùng chết.
        self.audit.create(
            actor_user_id=actor_id,
            action="update_role_permissions",
            target=f"role:{role_id}",
            detail=role.name,
        )
        # Mọi người đang giữ vai này (kể cả người vừa bấm Lưu) tự hỏi lại quyền — menu đổi ngay.
        bao_quyen_doi(self.users.list_ids_by_role(role_id))
        return self.get_matrix(role_id)
