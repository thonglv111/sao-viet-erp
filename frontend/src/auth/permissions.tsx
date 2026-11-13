// Permission context (spec-09): exposes `can(module, action)` so any screen can hide/disable
// write actions the current user's role doesn't grant. Backend remains the real gate (403);
// this only improves UX. AppShell loads the matrix once and provides it here.
import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { ModuleCapability, Scope } from "../api/client";

export type PermAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  // Quyền chi tiết (Cách B).
  | "reassign"
  | "export"
  | "view_debt"
  | "view_discount"
  | "approve"
  | "manage_status"
  | "reset_password"
  | "lock"
  | "revoke_sessions"
  | "assign_role"
  | "transfer"
  | "set_head"
  | "requote"
  | "manage_price"
  | "cancel"
  | "manage_permissions"
  | "clone"
  | "toggle_active"
  | "reparent"
  | "view_salary"
  | "edit_salary"
  | "adjust"
  | "approve_exception"
  | "set_credit_terms"
  // san_xuat (Thực hiện SX tại tổ) — giao/rút người + bắt đầu/tạm dừng/kết thúc phiên chạy.
  | "assign_work"
  // Kho (spec-kho-de-nghi §9.1) — quyền chi tiết của module `kho` + ghi sổ (SoD).
  | "request"
  | "view_stock"
  | "view_cost"
  // cham_cong: xem tab "Nhật ký chấm công" (tách khỏi "read" 11/08/2026).
  | "view_log"
  | "set_threshold"
  | "post"
  // Kho — kế toán: khóa kỳ (chốt sổ) + xem Báo cáo kho + export MISA.
  | "close_book"
  // cham_cong (mg 0194) — MỘT Ô = MỘT TAB. Tên động từ gọi đúng tên tab.
  | "view_timesheet"        // tab Bảng công tháng (lưới cả xưởng + nút Chốt kỳ)
  | "approve_late_early"    // tab con Duyệt phiếu đi muộn / về sớm / nghỉ nửa buổi
  | "manage_locations"      // tab Điểm chấm công
  | "manage_shifts"         // tab Khai ca
  | "manage_calendar"       // tab Lịch & Ngày lễ
  // luong (mg 0195) — tab Bảng lương tháng, tách khỏi cột Xem.
  | "view_payroll_table"
  | "manage_salary_profiles"   // luong — tab Lương nhân viên
  | "manage_piece_rates"       // luong — tab Lương khoán
  | "manage_leave_types"       // nghi_phep — danh mục loại nghỉ
  | "plan"                     // giao_hang — tab Yêu cầu chờ lên kế hoạch + phân công
  | "view_drivers"             // giao_hang — tab Nhân viên giao hàng
  | "close_short";             // kcs — Đóng lệnh thiếu + mở lại nhóm đã đóng

export type Capabilities = Map<string, ModuleCapability>;

interface PermissionsCtx {
  can: (moduleKey: string, action: PermAction) => boolean;
  /** The caller's data scope on a module (own|department|all), or null if no permission. */
  scopeOf: (moduleKey: string) => Scope | null;
  /** Hỏi lại máy chủ bộ quyền của CHÍNH người đang đăng nhập (menu + `can`). */
  reload: () => void;
  /** Phân hệ TẮT theo bản cài (`PHAN_HE_TAT` ở máy chủ, docs/prd-tat-phan-he-theo-ban-cai.md). */
  phanHeTat: ReadonlySet<PhanHe>;
}

/** Phân hệ tắt được theo bản cài — khớp `app/phan_he.py`. */
// `thuong_mai`, `giao_hang_hp`: chỉ In Hà Phương có, máy chủ coi là TẮT khi bản cài không khai `PHAN_HE_BAT`.
export type PhanHe = "luong" | "khoan" | "hoa_hong" | "giao_hang" | "tai_san" | "cham_cong" | "sua_chua" | "ke_gia"
  | "thuong_mai" | "giao_hang_hp" | "duyet_don_mua";
const KHONG_TAT: ReadonlySet<PhanHe> = new Set();

const PermissionsContext = createContext<PermissionsCtx>({
  can: () => false,
  scopeOf: () => null,
  reload: () => {},
  phanHeTat: KHONG_TAT,
});

export function buildCapabilities(rows: ModuleCapability[]): Capabilities {
  return new Map(rows.map((r) => [r.module_key, r]));
}

export function PermissionsProvider({
  caps,
  onReload,
  phanHeTat = KHONG_TAT,
  children,
}: {
  caps: Capabilities;
  onReload?: () => void;
  phanHeTat?: ReadonlySet<PhanHe>;
  children: ReactNode;
}) {
  function can(moduleKey: string, action: PermAction): boolean {
    // TRA THẲNG theo tên cờ, KHÔNG liệt kê từng động từ nữa (15/08/2026).
    //
    // Trước đây đây là một chuỗi `if` dài 38 dòng, mỗi động từ một dòng. Thêm ô quyền mới mà quên
    // thêm dòng ở đây thì: cột có trong DB ✓, ma trận tick được ✓, máy chủ gác đúng ✓, bộ quyền
    // gửi xuống đủ ✓ — nhưng `can()` rơi xuống `return false`, và **tab/nút không bao giờ hiện,
    // không một lời báo lỗi**. Đã cắn đúng như vậy với 5 ô mới của màn Chấm công.
    //
    // Tên động từ ↔ tên cột là quy ước bất di bất dịch của hệ (`approve` ↔ `can_approve`), nên tra
    // theo quy ước là đúng bản chất hơn chép tay 40 dòng. `PermAction` vẫn chặn gõ sai ở nơi gọi.
    const row = caps.get(moduleKey);
    if (!row) return false;
    return Boolean((row as unknown as Record<string, boolean | undefined>)[`can_${action}`]);
  }
  function scopeOf(moduleKey: string): Scope | null {
    return caps.get(moduleKey)?.scope ?? null;
  }
  return (
    <PermissionsContext.Provider value={{ can, scopeOf, reload: onReload ?? (() => {}), phanHeTat }}>
      {children}
    </PermissionsContext.Provider>
  );
}

/** Có ô TỰ PHỤC VỤ hay không — việc người lao động làm với hồ sơ của CHÍNH MÌNH: tự chấm công,
 *  xem công / phiếu lương của mình, tự gửi đơn nghỉ · phiếu tăng ca · xin tạm ứng.
 *
 *  Từ 10/08/2026 đây là ô quyền THẬT (`self_service`), bật sẵn cho mọi vai mới nhưng quản trị tắt
 *  được. Màn nào có nút tự phục vụ thì phải hỏi hàm này — không thì tắt ô xong nút vẫn bày ra, bấm
 *  mới ăn 403 (đợt 5). */
export function useSelfService(): boolean {
  // BỎ Ô `self_service` (chủ chốt 15/08/2026). Dữ liệu của CHÍNH MÌNH là quyền đương nhiên của mọi
  // tài khoản đăng nhập — xem công của mình, phiếu lương của mình, đơn của mình; gửi/sửa/huỷ đơn
  // của mình. Đó không phải quyền được ban: chặn nó là chặn người ta đi làm.
  //
  // Cái quyết định NHÌN THẤY MÀN NÀO vẫn là ô của chính màn đó — "phải cấp quyền mới hiển thị".
  // Giữ hàm (thay vì xoá 20 chỗ gọi) để chỗ gọi vẫn đọc được ý: đây là phần "của tôi".
  return true;
}

/** Có ô THAO TÁC của Tự phục vụ không — được GHI với hồ sơ của chính mình: chấm công, gửi · sửa ·
 *  huỷ đơn nghỉ · phiếu tăng ca · xin đi muộn · xin tạm ứng, sửa thông tin liên hệ của mình.
 *
 *  Tách khỏi `useSelfService()` ngày 11/08/2026: trước đó `self_service` chỉ dùng động từ `read`
 *  nên cột "Thao tác" của nó là ô chết — gỡ tick đi thì thợ vẫn chấm công, vẫn gửi phiếu. Chủ chốt
 *  báo đúng chỗ này ở ba màn khác nhau (Tự phục vụ · Tăng ca · Nghỉ phép), cùng một gốc. */
export function useSelfServiceWrite(): boolean {
  return true;   // xem `useSelfService` — ghi vào hồ sơ của chính mình cũng là quyền đương nhiên
}

/** Returns `can(module, action)`. Defaults to deny until the provider is mounted. */
export function useCan(): (moduleKey: string, action: PermAction) => boolean {
  return useContext(PermissionsContext).can;
}

/** Tải lại quyền của người đang đăng nhập. AppShell chỉ hỏi quyền MỘT lần lúc vào phiên, nên màn
 *  nào vừa ghi thứ có thể đổi quyền của chính mình (lưu ma trận vai trò) phải gọi hàm này — không
 *  thì menu và nút giữ quyền cũ tới khi bấm F5, người lưu tưởng lưu chưa ăn. */
export function useReloadPermissions(): () => void {
  return useContext(PermissionsContext).reload;
}

/** `tat("khoan")` — phân hệ đó có bị tắt ở bản cài này không. Module của phân hệ tắt (Lương, Giao
 *  hàng, Xe) máy chủ đã rút khỏi bộ quyền nên menu tự ẩn; hook này cho phần nằm TRONG màn khác
 *  (tab Khoán của Công đoạn, cột tiền khoán, ô hoa hồng…). */
export function useTat(): (ten: PhanHe) => boolean {
  const ds = useContext(PermissionsContext).phanHeTat;
  return useCallback((ten: PhanHe) => ds.has(ten), [ds]);
}

/** Tên nhóm "Nhân sự & Lương" (thanh bên, ma trận quyền, chữ nhỏ đầu màn) — tắt lương thì bỏ chữ Lương. */
export function useTenNhomNhanSu(): string {
  return useTat()("luong") ? "Nhân sự" : "Nhân sự & Lương";
}

/** Returns `scopeOf(module)` → own|department|all|null. */
export function useScopeOf(): (moduleKey: string) => Scope | null {
  return useContext(PermissionsContext).scopeOf;
}
