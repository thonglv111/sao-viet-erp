// Permission matrix — modules × (Xem / Chỉnh sửa / Phạm vi) + quyền chi tiết. Presentational +
// controlled: the parent owns the rows and gets toggle/scope callbacks. Shared by the Roles
// screen and the per-department "Vai trò & Quyền" panel so both edit permissions identically.
//
// Trình bày (redesign): gom module theo PHÂN HỆ (accordion thu gọn được); mỗi module là một
// hàng với công tắc Xem / Chỉnh sửa / pill Phạm vi; module có quyền chi tiết hiện chip "N/M chi
// tiết" → bấm BUNG INLINE ngay dưới hàng (không popover portal). Data contract KHÔNG đổi.
import { useEffect, useRef, useState } from "react";
import type { ModuleDef, PermissionRow, Scope } from "../api/client";
import { BAI_GHEP_ENABLED } from "../constants/features";
import { Icon } from "./Icons";
import { HoverTip } from "./HoverTip";
import "./permission-matrix.css";

export const ACTIONS = [
  { key: "can_read", label: "Xem" },
  { key: "can_create", label: "Thêm" },
  { key: "can_update", label: "Sửa" },
  { key: "can_delete", label: "Xóa" },
] as const;

export type ActionKey =
  | "can_read"
  | "can_create"
  | "can_update"
  | "can_delete"
  // Quyền chi tiết (Cách B).
  | "can_reassign"
  | "can_export"
  | "can_view_debt"
  | "can_view_discount"
  | "can_approve"
  | "can_manage_status"
  | "can_reset_password"
  | "can_lock"
  | "can_revoke_sessions"
  | "can_assign_role"
  | "can_transfer"
  | "can_set_head"
  | "can_requote"
  | "can_manage_price"
  | "can_cancel"
  | "can_manage_permissions"
  | "can_clone"
  | "can_toggle_active"
  | "can_reparent"
  | "can_view_salary"
  | "can_edit_salary"
  | "can_adjust"
  | "can_approve_exception"
  | "can_set_credit_terms"
  | "can_assign_work"
  | "can_record_output"
  | "can_handover"
  | "can_request"
  | "can_view_stock"
  | "can_view_cost"
  | "can_view_log"
  | "can_set_threshold"
  | "can_post"
  | "can_close_book"
  // cham_cong (mg 0194) — một ô = một tab.
  | "can_view_timesheet"
  | "can_approve_late_early"
  | "can_manage_locations"
  | "can_manage_shifts"
  | "can_manage_calendar"
  | "can_view_payroll_table"
  | "can_manage_salary_profiles"
  | "can_manage_piece_rates"
  | "can_manage_leave_types"
  | "can_plan"
  | "can_view_drivers"
  // Dòng quyền theo tổ (mg 0302) — ba quyền chi tiết của Bàn tổ.
  | "can_run_order"
  | "can_confirm_output"
  | "can_warehouse"
  // Chỉ dòng tổ có cờ KCS (mg 0382, 08/10/2026).
  | "can_close_short";

//: Dòng có ô Xem cố định bật, không tắt được (kể cả "Tắt hết" của dòng / nhóm). Máy chủ ép bật lúc
//: lưu — `rbac_repo.O_LUON_BAT`, mg 0410 / 0412 (Nội quy riêng một luật cũ).
const XEM_CO_DINH = new Set(["noi_quy", "self_service", "cham_cong", "nghi_phep", "tang_ca", "luong"]);
//: Dòng có ô Thao tác cố định bật (15/10/2026, mg 0412): tự chấm công, gửi đơn nghỉ, gửi phiếu tăng
//: ca là việc của mọi người. Lương KHÔNG ở đây — Thao tác Lương gồm sửa mức lương, cấu hình lương.
const THAO_TAC_CO_DINH = new Set(["cham_cong", "nghi_phep", "tang_ca"]);

// UI gộp Thêm/Sửa/Xóa thành một công tắc "quyền chỉnh sửa": tick là bật cả ba.
// Dữ liệu vẫn lưu tách (can_create/can_update/can_delete) nên backend không đổi.
const WRITE_ACTIONS: ActionKey[] = ["can_create", "can_update", "can_delete"];

// Quyền CHI TIẾT khai báo theo từng module (Cách B). Module không có tên ở đây → không hiện
// cột chi tiết. Thêm module/hành động mới chỉ cần bổ sung vào bảng này + cột ở backend.
// `keys` (tuỳ chọn): 1 công tắc bật/tắt NHIỀU cột cùng lúc (gộp quyền). `key` = cột đại diện để
// đếm/định danh; `keys` = toàn bộ cột được set. Không có `keys` → công tắc 1 cột như thường.
// `mod` (tuỳ chọn, 13/10/2026): ô SOI — đọc/ghi cột của DÒNG KHÁC (`mod`), không phải dòng đang
// đứng. Cùng một quyền hiện ở hai chỗ, bật/tắt bên nào bên kia đổi theo vì chỉ có một giá trị.
// `chung`: chữ hiện ra mặt cạnh nhãn để người cấp quyền thấy ngay ô này là ô của màn nào.
type FineAction = {
  key: ActionKey;
  keys?: ActionKey[];
  label: string;
  hint?: string;
  mod?: string;
  chung?: string;
  /** Ô soi kèm PHẠM VI (14/10/2026): bật = các cột `keys`/`key` bật VÀ dòng nguồn ở phạm vi này;
   *  tắt = chỉ hạ phạm vi dòng nguồn về "Của tôi" (giữ nguyên Xem). */
  phamVi?: Scope;
};

//: Ô chi tiết "Xem giá thành" — MỖI module kho một ô RIÊNG, cột `can_view_cost` của chính dòng đó
//: (chủ chốt 05/10/2026: *"giá thành kho phải nằm trong chi tiết của mỗi module"*; *"kho giấy tôi
//: bật giá thành thì xem được giá thành trong kho giấy, mấy kho kia không bật thì không"*). Máy chủ
//: hỏi đúng ô của màn đang xem (`services/quyen_kho.gia_lo_theo_man`, `kho_baocao._thay_gia`).
const xemGiaKho = (hint: string): FineAction => ({ key: "can_view_cost", label: "Xem giá thành", hint });

const NHAN_BAN_HINT =
  "Cho phép tạo mục mới bằng cách chép toàn bộ thông tin của một mục có sẵn. Lưu ý: bản chép mang tên “… (bản sao)” và mã mới; soát lại trước khi dùng.";

const FINE_ACTIONS: Record<string, FineAction[]> = {
  // Nhật ký (25/09/2026): XEM và TẢI VỀ là hai việc khác nhau. Trước đó ai mở được màn là bấm
  // "Xuất CSV" mang toàn bộ nhật ký ra ngoài được, và bản thân việc mang đi KHÔNG để lại vết.
  activity_log: [
    {
      key: "can_export",
      label: "Xuất CSV nhật ký",
      hint: "Cho phép tải nhật ký ra file CSV. Mỗi lần tải đều được ghi lại.",
    },
  ],
  khach_hang: [
    {
      key: "can_reassign",
      label: "Điều chuyển",
      hint: "Cho phép chuyển khách sang sale khác phụ trách. Không bật thì không đổi người phụ trách được.",
    },
    // "Xuất file" (can_export) + "Xem công nợ" (can_view_debt) đã gỡ khỏi ma trận 24/08/2026:
    // chốt là 2 tính năng này MẶC ĐỊNH BẬT cho mọi vai có Xem khách — không còn công tắc riêng.
    // Cột DB + ActionKey giữ nguyên (đảo được: thêm lại entry ở đây là bật lại toggle).
    {
      key: "can_set_credit_terms",
      label: "Thiết lập chính sách tài chính",
      hint: "Cho phép sửa: hạn mức công nợ; số ngày nợ tối đa; mức chiết khấu / markup của khách. Lưu ý: không bật thì chỉ xem.",
    },
  ],
  // Tính giá: ô DUY NHẤT gác "ruột giá" — bảng Chi tiết dòng giá vốn + thẻ sản phẩm (chỗ khai
  // giấy/khổ/số con/công đoạn). Thiếu ô này vẫn mở được phiếu, vẫn thấy giá vốn tổng + đơn giá
  // bình quân (đủ đi chào khách), chỉ không thấy VÌ SAO ra con số đó. Dùng lại cột `can_view_cost`
  // của Kho — cùng nghĩa "xem giá vốn", không đẻ cột mới.
  tinh_gia_thanh: [
    {
      key: "can_view_cost",
      label: "Xem chi tiết giá vốn",
      hint: "Cho phép xem chi tiết từng dòng giá vốn và mở thẻ sản phẩm. Không bật thì chỉ thấy giá vốn tổng. Có quyền Thao tác thì ô này tự bật.",
    },
  ],
  // Báo giá: thao tác vòng đời THƯỜNG (gửi khách · ghi nhận Khách đồng ý/từ chối · hủy · tạo bản mới
  // · tải PDF) KHÔNG tách quyền chi tiết — ai có "Sửa" báo giá đều làm được (chủ đầu tư chốt P8).
  // PDF về lại ô Thao tác 05/10/2026 — trước đó máy chủ gác `export` mà ma trận không bày ô đó,
  // nên ngoài admin không ai tải được. Quyền chi tiết DUY NHẤT
  // còn lại = DUYỆT BÁO GIÁ ĐẶC THÙ (biên thấp / giá trị cao): chỉ vai bật cờ này mới duyệt được đơn trình lên.
  bao_gia: [
    {
      key: "can_approve_exception",
      label: "Duyệt báo giá đặc thù",
      hint: "Cho phép duyệt, từ chối báo giá đặc thù: từ 1 tỷ trở lên (trước VAT); bán dưới giá vốn; chiết khấu / markup ngoài mức của khách. Lưu ý: không bật thì không duyệt được các báo giá này.",
    },
    // Ô SOI (13/10/2026): nút "Tạo đơn hàng" trên báo giá khách đã đồng ý hỏi Đơn hàng bán → Thêm —
    // bày ngay ở đây để người cấp quyền báo giá thấy, không phải đoán sang dòng khác.
    {
      key: "can_create",
      keys: WRITE_ACTIONS,
      mod: "don_hang_ban",
      chung: "chung ô Đơn hàng bán",
      label: "Tạo đơn hàng",
      hint: "Cho phép tạo đơn hàng từ báo giá khách đã đồng ý. Lưu ý: bật ô này là bật luôn Chỉnh sửa ở Đơn hàng bán, tắt cũng vậy.",
    },
  ],
  // Đơn hàng bán: mọi việc dính TIỀN trên ngăn đơn đi theo quyền của màn kế toán (13/10/2026) — ở đây
  // chỉ SOI các ô đó lên (`mod`), không có cột riêng. "Ghi phiếu thu cọc" (`can_record_deposit`) đã gỡ
  // (mg 0407): thu cọc được mà không lập được phiếu thu là lệch.
  don_hang_ban: [
    // "Duyệt đơn đặc thù · hủy đơn đã chốt" (can_approve_exception) đã gỡ khỏi ma trận 24/08/2026:
    // luồng duyệt đơn đặc thù vốn đã bỏ, nay chốt hủy-đơn-đã-chốt MẶC ĐỊNH BẬT cho vai có Sửa đơn.
    // Cột DB + ActionKey giữ nguyên (đảo được: thêm lại entry ở đây là bật lại toggle).
    {
      key: "can_create",
      keys: WRITE_ACTIONS,
      mod: "phieu_thu",
      chung: "chung ô Phiếu thu",
      label: "Thu cọc và ghi hoá đơn",
      hint: "Cho phép thu cọc và ghi hoá đơn ngay trên đơn. Lưu ý: bật ô này là bật luôn Chỉnh sửa ở Phiếu thu, tắt cũng vậy.",
    },
    {
      key: "can_cancel",
      mod: "phieu_thu",
      chung: "chung ô Phiếu thu",
      label: "Huỷ hoá đơn",
      hint: "Cho phép huỷ hoá đơn đã ghi trên đơn. Lưu ý: bật ô này là bật luôn Hủy phiếu thu ở Phiếu thu, tắt cũng vậy.",
    },
    {
      key: "can_create",
      keys: WRITE_ACTIONS,
      mod: "phieu_chi",
      chung: "chung ô Phiếu chi",
      label: "Trả lại cọc",
      hint: "Cho phép trả lại cọc cho khách khi đơn đã huỷ. Lưu ý: bật ô này là bật luôn Chỉnh sửa ở Phiếu chi, tắt cũng vậy.",
    },
  ],
  // "Gán việc" · "Ghi sản lượng" · "Bàn giao / nhận" ĐÃ GỠ 14/09/2026: Bàn tổ thôi hỏi ô "Kế hoạch
  // sản xuất", mọi thao tác tại tổ nay nằm ở nhóm "Tổ sản xuất" (một dòng một tổ, `FINE_TO` dưới).
  // "Xuất Excel báo cáo KCS" (san_xuat:can_export) ĐÃ GỠ 05/10/2026: nút xuất nằm ở màn KCS, màn đó
  // chỉ mở cho người thuộc phòng ban tổ KCS ⇒ quyền xuất đi theo tư cách tổ KCS, không theo vai.
  // ⚠️ THÊM 17/08/2026 cùng lúc tách khoá. Hai bit này CÓ THẬT ở máy chủ từ lâu (router xếp lịch
  // gác endpoint phát hành bằng `approve` + duyệt ngoại lệ bằng `approve_exception`) nhưng hồi đó
  // chúng treo trên khoá `san_xuat`, mà ma trận KHÔNG bày ô nào để cấp ⇒ ngoài admin không ai phát
  // hành được lịch. Cùng bệnh `nghi_phep:approve` hồi 11/08/2026.
  // Khoá đi qua `xep_lich_2` → `xep_lich_3` rồi về đúng `xep_lich` (18/09/2026, mg `0314`) — đây
  // là màn Xếp lịch DUY NHẤT, lý do tách hai bit vẫn nguyên: người kéo-thả thử nghiệm không đương
  // nhiên là người chốt lịch cho xưởng chạy.
  // "Báo máy hỏng" dời từ khoá `yeu_cau_sua_chua` (gỡ 24/09/2026, mg `0332`) — chủ chốt: *"bên
  // thanh bên có 2 module sao ở quyền lại có 3"*. Nó là TAB của chính màn Sửa chữa máy.
  // Kế hoạch vật tư (14/10/2026): nút "Đề nghị mua" trên dòng thiếu + "Huỷ phiếu" trùng trong ngăn hỏi
  // Yêu cầu mua hàng → Thao tác (create mở form, update huỷ). Soi lên đây để người cấp quyền thấy
  // ngay, khỏi đoán sang dòng khác — thiếu ô này thì ô tick trên bảng khoá mà không nói vì sao.
  ke_hoach_vat_tu: [
    {
      key: "can_create",
      keys: WRITE_ACTIONS,
      mod: "yeu_cau_mua_hang",
      chung: "chung ô Yêu cầu mua hàng",
      label: "Đề nghị mua",
      hint: "Cho phép tick dòng thiếu để lập yêu cầu mua, và huỷ phiếu mua trùng ngay trên bảng. Lưu ý: bật ô này là bật luôn Thao tác ở Yêu cầu mua hàng, tắt cũng vậy.",
    },
  ],
  ky_thuat_may: [
    {
      key: "can_request",
      label: "Báo máy hỏng",
      hint: "Cho phép báo máy hỏng và sửa lời báo của mình khi chưa ai nhận. Không cho nhận hay đóng phiếu sửa.",
    },
  ],
  // KCS (09/10/2026, thay cờ phòng ban "Tổ KCS đích danh"). Xem = màn KCS + báo cáo mọi tổ + Xuất
  // Excel; Thao tác (`can_create`) = ghi lần kiểm, gửi nhập kho, đóng lệnh đủ.
  kcs: [
    {
      key: "can_close_short",
      label: "Đóng lệnh thiếu",
      hint: "Cho phép: đóng lệnh khi còn hàng chưa kiểm, chưa gửi kho, thiếu số so với đơn hoặc còn việc đang làm; mở lại lệnh đã đóng. Lưu ý: phải bật kèm Thao tác. Đóng khi đã đủ hết thì chỉ cần Thao tác.",
    },
  ],
  xep_lich: [
    {
      key: "can_approve",
      label: "Phát hành lịch",
      hint: "Cho phép phát hành lệnh xuống xưởng, thu hồi lệnh đã phát hành, và phát hành cập nhật khi lịch đổi. Lưu ý: đặt hoặc dời giờ trên lịch là ô Thao tác, phải bật kèm.",
    },
    // "Duyệt ngoại lệ khi phát hành" (can_approve_exception) ĐÃ GỠ 05/10/2026: di sản bàn xếp lịch
    // theo công đoạn (xoá 18/09/2026), không endpoint nào của `xep_lich` còn hỏi tới.
  ],
  phong_ban: [
    { key: "can_set_head", label: "Đặt trưởng phòng", hint: "Cho phép chọn hoặc đổi trưởng phòng của một phòng / tổ. Lưu ý: phải bật kèm Thao tác." },
    { key: "can_reparent", label: "Đổi cấp trên (cây tổ chức)", hint: "Cho phép chuyển một phòng / tổ sang trực thuộc phòng khác trên cây tổ chức. Lưu ý: phải bật kèm Thao tác. Lúc tạo phòng mới thì chọn cấp trên không cần ô này." },
    // Ô của khoá `vai_tro` cũ, dời về đây 24/09/2026 (mg `0330`) — chủ chốt: *"bản chất của sửa
    // ma trận quyền nó phải là một cái chi tiết trong phòng ban chứ"*. Tách khỏi Thao tác (thêm ·
    // đổi tên · xoá vai trò) để chống leo thang quyền: HCNS dựng được chỗ ngồi, chỉ người có ô
    // này mới cấp được quyền cho chỗ ngồi đó.
    {
      key: "can_manage_permissions",
      label: "Sửa ma trận phân quyền",
      hint: "Cho phép: sửa và lưu bảng phân quyền; nhân bản vai trò (cần kèm Thao tác); gộp nhóm dùng chung. Lưu ý: không bật thì chỉ xem.",
    },
  ],
  // Kho ("Yêu cầu nhập xuất") — chủ chốt 05/10/2026: cột Thao tác là việc của BÊN XIN (tạo yêu
  // cầu, cột `can_request`, xem `COT_THAO_TAC`); việc của BÊN KHO là ô chi tiết "Tiếp nhận yêu cầu,
  // lập phiếu" (ba cột create/update/delete — đúng ba cột cột Thao tác bật trước đó, nên quyền đã
  // cấp giữ nguyên). Máy chủ không đổi: `create` vẫn là quyền lập phiếu của kho.
  // "Xem giá thành" là ô chi tiết RIÊNG (`xemGiaKho`) của màn này, không gộp vào ô của kho.
  // Ô "Xem tồn kho" và "Báo cáo kho + khóa kỳ" đã thành dòng riêng từ 24/09/2026; cột
  // `kho.can_view_stock` / `kho.can_close_book` giữ trong DB, chỉ thôi bày ra đây.
  // KHÔNG có Duyệt: ĐÃ BỎ BƯỚC DUYỆT yêu cầu kho (chủ 06/08/2026).
  kho: [
    {
      key: "can_create",
      keys: ["can_create", "can_update", "can_delete"],
      label: "Tiếp nhận yêu cầu, lập phiếu",
      hint: "Cho phép: tiếp nhận yêu cầu; lập, ghi sổ, huỷ phiếu nhập / xuất; từ chối yêu cầu có lý do; điều chỉnh phiếu xuất; điều chuyển kho; sửa vị trí lô. Lưu ý: đây là việc của thủ kho; người kho nên để phạm vi “Tất cả” để thấy mọi yêu cầu gửi tới.",
    },
    xemGiaKho(
      "Cho phép: xem đơn giá, thành tiền trên yêu cầu và phiếu nhập / xuất; giá lô lúc lập phiếu xuất. Lưu ý: chỉ ở màn này — từng kho và Báo cáo kho có ô xem giá riêng; thường chỉ kế toán kho bật.",
    ),
  ],
  // Tồn kho: mỗi kho một dòng `ton_kho_<id>` (05/10/2026), Thao tác = khai ngưỡng tồn của kho đó,
  // chi tiết chỉ có Xem giá thành (`FINE_KHO`).
  // Báo cáo kho: Xem = vào màn + sổ + NXT + export MISA. Chi tiết: Xem giá thành + việc GHI của màn.
  bao_cao_kho: [
    xemGiaKho(
      "Cho phép: xem đơn giá, thành tiền trong sổ kho, Nhập-Xuất-Tồn, chuyển kho; mở tab Giá gốc thành phẩm; nhập, sửa giá gốc lô thành phẩm. Lưu ý: chỉ ở màn này; không bật thì vẫn xem số lượng.",
    ),
    {
      key: "can_close_book",
      label: "Khóa kỳ (chốt sổ) + tính giá kỳ",
      hint: "Cho phép: chốt sổ kho theo kỳ; mở lại kỳ đã chốt; tính giá kỳ. Lưu ý: không bật thì chỉ xem sổ.",
    },
  ],
  // DANH MỤC: đa số KHÔNG có quyền chi tiết — mỗi màn chỉ Xem + Thao tác.
  // (Trước đây bày 5 ô `manage_price` / `clone` / `toggle_active` nhưng KHÔNG endpoint nào kiểm
  //  → tick vào không đổi gì, mà người cấp quyền lại tưởng đã siết được việc sửa giá.)
  // `can_clone` nối THẬT 26/08/2026 (`POST /{id}/clone`, xem `routers/catalog_base.py`) cho 5 màn
  // Giấy · Vật tư khác · Máy thiết bị · Công đoạn — nên RIÊNG 4 khoá này bày ô
  // "Nhân bản". Không gộp vào `can_create`: vai được TẠO MỚI (gõ tay) chưa chắc nên NHÂN BẢN hàng
  // cũ (nhân đôi cả giá/công thức đang chạy mà không soát lại từng ô).
  dm_giay: [{ key: "can_clone", label: "Nhân bản", hint: NHAN_BAN_HINT }],
  dm_vat_tu: [{ key: "can_clone", label: "Nhân bản", hint: NHAN_BAN_HINT }],
  dm_thiet_bi: [{ key: "can_clone", label: "Nhân bản", hint: NHAN_BAN_HINT }],
  dm_cong_doan: [{ key: "can_clone", label: "Nhân bản", hint: NHAN_BAN_HINT }],
  nhan_su: [
    {
      key: "can_view_salary",
      label: "Xem lương & BHXH (dữ liệu nhạy cảm)",
      hint: "Cho phép xem lương, bảo hiểm, thuế trên hồ sơ nhân viên. Không bật thì các ô này bị ẩn.",
    },
    {
      key: "can_edit_salary",
      label: "Sửa lương & BHXH",
      hint: "Cho phép nhập, sửa lương, bảo hiểm, thuế trên hồ sơ. Phải bật kèm quyền xem lương.",
    },
    {
      key: "can_manage_status",
      label: "Đổi trạng thái nhân viên",
      hint: "Cho phép: xác nhận lên chính thức; cho tạm nghỉ, đi làm lại; đình chỉ, gỡ đình chỉ; cho nghỉ việc, nhận lại. Lưu ý: chuyển phòng, đổi chức danh là quyền riêng.",
    },
    {
      key: "can_transfer",
      label: "Điều chuyển & đổi chức danh",
      hint: "Cho phép chuyển nhân viên sang phòng / tổ khác và đổi chức danh.",
    },
    {
      key: "can_approve",
      label: "Duyệt yêu cầu cập nhật",
      hint: "Cho phép duyệt, từ chối đề nghị sửa thông tin mà nhân viên gửi từ “Hồ sơ của tôi”.",
    },
    { key: "can_export", label: "Xuất Excel danh sách", hint: "Cho phép tải toàn bộ hồ sơ nhân viên trong phạm vi ra file Excel. Lưu ý: cột lương chỉ có khi được xem lương." },
    // BỐN Ô DƯỚI ĐÂY dời từ khoá `nguoi_dung` (gỡ 24/09/2026, mg `0331`) — chủ chốt: *"gộp luôn
    // người dùng vào hồ sơ nhân sự đi"*. Chúng gác tab "Tài khoản & Quyền" CỦA CHÍNH màn này, tên
    // cột trong DB giữ nguyên nên vai cũ không mất gì.
    {
      key: "can_reset_password",
      label: "Đặt lại mật khẩu",
      hint: "Cho phép đặt lại mật khẩu cho nhân viên.",
    },
    {
      key: "can_lock",
      label: "Khóa / Mở tài khoản",
      hint: "Cho phép khoá hoặc mở tài khoản. Người bị khoá không đăng nhập được, hồ sơ vẫn giữ.",
    },
    {
      key: "can_revoke_sessions",
      label: "Thu hồi phiên",
      hint: "Cho phép đăng xuất tài khoản khỏi mọi thiết bị, dùng khi mất máy hoặc lộ mật khẩu.",
    },
    {
      key: "can_assign_role",
      label: "Gán vai trò",
      hint: "Cho phép gán, đổi vai trò cho tài khoản. Có ô này là cấp được quyền cho người khác.",
    },
  ],
  // Màn CHẤM CÔNG tách khoá riêng 10/08/2026. Cột Xem = Bảng công tháng + Nhật ký chấm công;
  // cột Chỉnh sửa = ô "Cấu hình chấm công" (Điểm chấm công · Khai ca · Lịch & Ngày lễ). Ba ô
  // dưới đây là các việc phải tách hẳn ra.
  // MỘT Ô = MỘT TAB (chủ chốt 15/08/2026). Cột Xem = mở màn + BA TAB CỦA TÔI (bấm giờ · lịch công
  // của mình · tự xin đi muộn) — đó là việc của chính người đó, không phải quyền được ban.
  // Mỗi ô dưới đây mở đúng MỘT tab, và tab đó luôn dính tới NGƯỜI KHÁC hoặc DÙNG CHUNG.
  cham_cong: [
    {
      key: "can_view_timesheet",
      label: "Bảng công tháng",
      hint: "Cho phép xem bảng công của cả phạm vi. Không bật thì mỗi người chỉ thấy công của mình.",
    },
    {
      key: "can_approve_late_early",
      label: "Duyệt phiếu đi muộn / về sớm / nghỉ nửa buổi",
      hint: "Cho phép duyệt, từ chối phiếu đi muộn / về sớm của người khác và khai hộ. Tự xin cho mình thì không cần.",
    },
    {
      key: "can_manage_locations",
      label: "Điểm chấm công",
      hint: "Cho phép mở tab Điểm chấm công (vị trí, bán kính). Lưu ý: muốn thêm, sửa phải chọn phạm vi “Tất cả”.",
    },
    { key: "can_manage_shifts", label: "Khai ca",
      hint: "Cho phép mở tab Khai ca (giờ vào / ra, ca đêm, phụ cấp). Lưu ý: muốn thêm, sửa phải chọn phạm vi “Tất cả”." },
    { key: "can_manage_calendar", label: "Lịch & Ngày lễ",
      hint: "Cho phép mở tab Lịch & Ngày lễ. Lưu ý: muốn sửa phải chọn phạm vi “Tất cả”; đổi ở đây là đổi công chuẩn của tháng." },
    {
      key: "can_view_log",
      label: "Xem Nhật ký chấm công",
      hint: "Cho phép xem từng lượt chấm công của mỗi người (giờ, vị trí).",
    },
    {
      // THÊM 05/10/2026: máy chủ gác tab "Yêu cầu chỉnh công" bằng `cham_cong:approve`
      // (`attendance.py` /adjust-requests) và màn hiện tab theo nó, nhưng ma trận không bày ô ⇒
      // nhân viên gửi yêu cầu xong không ai ngoài admin duyệt được.
      key: "can_approve",
      label: "Duyệt yêu cầu chỉnh công",
      hint: "Cho phép: mở tab Yêu cầu chỉnh công; duyệt, từ chối yêu cầu sửa giờ chấm của người khác trong phạm vi. Lưu ý: tự gửi yêu cầu cho mình chỉ cần Thao tác.",
    },
    {
      key: "can_adjust",
      label: "Chấm bù / sửa công",
      hint: "Cho phép: chấm bù; xoá lượt chấm tay; xác nhận tăng ca theo phiếu. Lưu ý: duyệt yêu cầu chỉnh công là ô riêng.",
    },
    {
      key: "can_lock",
      label: "Chốt kỳ công / Mở lại kỳ",
      hint: "Cho phép chốt hoặc mở lại kỳ công của cả công ty. Cần phạm vi “Tất cả”.",
    },
  ],
  // ⚠️ THÊM 11/08/2026 — trước đó phân hệ Nghỉ phép KHÔNG có mục nào ở đây, nên:
  //   • `can_approve` KHÔNG AI BẬT ĐƯỢC ⇒ tab "Duyệt đơn" và "Lịch nghỉ" không bao giờ hiện với
  //     bất kỳ ai ngoài admin. Chủ chốt báo đúng: "không thấy tab duyệt nghỉ phép ở đâu luôn".
  //   • Quản danh mục LOẠI NGHỈ núp dưới cột "Thao tác" trần — bật nó là mở danh mục của cả công
  //     ty mà người cấp quyền không có cách nào biết.
  nghi_phep: [
    {
      key: "can_approve",
      label: "Duyệt đơn nghỉ phép",
      hint: "Cho phép duyệt, từ chối đơn nghỉ của người khác. Phạm vi “Cả phòng” là trong tổ mình, “Tất cả” là cả công ty. Lưu ý: có ô này thì cũng huỷ hộ được đơn của người khác.",
    },
    {
      // THÊM 05/10/2026: máy chủ đòi `nghi_phep:cancel` (hoặc ô Duyệt) cho huỷ / xin huỷ / rút lại
      // (`leaves.py` `SelfOrApprover`), nhưng ma trận không bày ô ⇒ nhân viên thường bấm "Hủy đơn"
      // là ăn 403. Màn nay ẩn ba nút đó theo ô này.
      key: "can_cancel",
      label: "Huỷ đơn nghỉ của mình",
      hint: "Cho phép: huỷ đơn nghỉ của mình khi chưa duyệt; xin huỷ đơn đã duyệt (người duyệt quyết); rút lại lời xin huỷ. Lưu ý: nên bật cho mọi nhân viên.",
    },
    {
      // CỘT RIÊNG từ 15/08/2026 (mg 0197). Trước đó ô này mượn `can_update` — mà `can_update` là
      // một trong ba cột nút "Thao tác" bật cùng lúc, nên bật Thao tác là ô này TỰ SÁNG THEO.
      key: "can_manage_leave_types",
      label: "Quản danh mục loại nghỉ",
      hint: "Cho phép thêm, sửa, xoá các loại nghỉ (phép năm, ốm, không lương…).",
    },
  ],
  // Giao hàng (19/08/2026) — MỘT Ô = MỘT TAB, cùng luật với Chấm công và Lương.
  giao_hang: [
    {
      key: "can_plan",
      label: "Lên đơn giao hàng",
      hint: "Cho phép: xếp chuyến (chọn tài xế, giờ lấy, giờ giao); gửi đề nghị xuất hàng sang kho.",
    },
    {
      key: "can_cancel",
      label: "Huỷ yêu cầu / huỷ chuyến",
      hint: "Cho phép huỷ yêu cầu giao hoặc huỷ chuyến đã xếp (phải ghi lý do).",
    },
    {
      key: "can_view_drivers",
      label: "Nhân viên giao hàng",
      hint: "Cho phép xem lịch, chuyến và số km của các tài xế khác.",
    },
  ],
  // Tách khỏi ô "Chấm bù" của màn Chấm công ngày 11/08/2026.
  tang_ca: [
    {
      key: "can_approve",
      label: "Duyệt phiếu tăng ca",
      hint: "Cho phép duyệt, từ chối phiếu tăng ca của người khác và tạo hộ. Phạm vi “Cả phòng” là trong tổ mình, “Tất cả” là cả công ty.",
    },
  ],
  // "Lương khoán" (`can_manage_piece_rates`) ĐÃ GỠ 05/10/2026: ô chết — không route nào, không màn
  // nào hỏi tới; đơn giá khoán nay nằm ở danh mục Công đoạn. Cột DB giữ nguyên.
  luong: [
    { key: "can_manage_salary_profiles", label: "Lương nhân viên",
      hint: "Cho phép mở tab Lương nhân viên, xem mức lương từng người. Lưu ý: muốn khai, sửa mức lương phải bật kèm Thao tác." },
    {
      key: "can_view_payroll_table",
      label: "Bảng lương tháng",
      hint: "Cho phép xem bảng lương của cả phạm vi. Không cần để xem phiếu lương của mình.",
    },
    {
      key: "can_lock",
      label: "Chốt bảng lương / Mở lại kỳ",
      hint: "Cho phép: chốt, mở lại kỳ lương; công bố, thu hồi phiếu lương. Lưu ý: cần phạm vi “Tất cả” và ô Bảng lương tháng (nút nằm ở tab đó).",
    },
    {
      key: "can_manage_status",
      label: "Đánh dấu đã chi lương",
      hint: "Cho phép đánh dấu kỳ lương đã chi (kỳ khoá lại) hoặc bỏ đánh dấu. Lưu ý: cần phạm vi “Tất cả” và ô Bảng lương tháng (nút nằm ở tab đó).",
    },
    {
      key: "can_view_salary",
      label: "Xem cấu hình lương",
      hint: "Cho phép xem: cơ chế lương theo bộ phận; các khoản thu nhập; bảo hiểm và thuế.",
    },
    {
      key: "can_approve",
      label: "Duyệt tạm ứng",
      hint: "Cho phép: mở tab Tạm ứng; duyệt, từ chối, huỷ đề nghị tạm ứng và lương đợt 1 của người khác.",
    },
    {
      key: "can_export",
      label: "Xuất bảng lương / file chuyển khoản",
      hint: "Cho phép tải ra Excel: bảng lương; file chuyển khoản ngân hàng; danh sách tạm ứng, lương đợt 1. Lưu ý: nút xuất bảng lương nằm ở tab Bảng lương tháng.",
    },
  ],
  thu_mua: [
    // Tab "Yêu cầu chờ xử lý" của màn Mua hàng đọc yêu cầu theo PHẠM VI của dòng Yêu cầu mua hàng
    // (`purchase_service._sees_all_department_requests`). Soi lên đây (14/10/2026) để người cấp
    // quyền Mua hàng thấy ngay: thiếu ô này thì thu mua mở tab ra trống, không biết vì sao.
    {
      key: "can_read",
      mod: "yeu_cau_mua_hang",
      phamVi: "all",
      chung: "chung ô Yêu cầu mua hàng",
      label: "Thấy yêu cầu mua của mọi phòng",
      hint: "Cho phép thấy yêu cầu mua của mọi phòng ở tab Yêu cầu chờ xử lý để lập đơn. Lưu ý: bật ô này là bật Xem và chọn phạm vi Tất cả ở Yêu cầu mua hàng; tắt thì phạm vi về Của tôi.",
    },
    // ĐÃ BỎ 12/08/2026 (chủ chốt test rồi quyết) — hai ô này không đáng tồn tại:
    //   • "Sửa / đảo trạng thái đơn sau khi nhận hàng" (`can_manage_status`): ba việc nó gác
    //     (sửa số nhận · mở lại đơn · đóng đơn) là việc thường ngày của chính người lập phiếu,
    //     nay gộp vào ô "Thao tác". Migration `0191` đổ quyền cũ về `can_update`.
    //   • "Hủy PMH" (`can_cancel`): CHƯA BAO GIỜ được đọc. `purchase_service.cancel` gác bằng
    //     `ke_toan:approve` (hoặc chính người lập, khi phiếu còn nháp) — ô này bật hay tắt đều
    //     không đổi gì. Đã khai vào `deps.O_CHET_DA_XAC_MINH`.
  ],
  // Ô của màn Đơn mua hàng (Kế toán) — dời từ phân hệ Mua hàng xuống 11/08/2026: nút Duyệt /
  // Từ chối chỉ có ở màn này, để ô trên kia thì nhìn ma trận không đoán ra nó tác dụng ở đâu.
  ke_toan: [
    {
      key: "can_approve",
      label: "Duyệt đơn mua hàng",
      hint: "Cho phép: duyệt hoặc từ chối đơn mua hàng đang chờ duyệt; huỷ đơn đã gửi duyệt. Lưu ý: duyệt được cả đơn do chính mình lập.",
    },
  ],
  // Phân hệ Kế toán tách mỗi màn một khoá (10/08/2026). Ô "Lập phiếu" nay là cột **Thêm** của
  // chính màn đó, không còn núp dưới tên `can_approve` — nên ở đây chỉ còn các quyền phụ.
  phieu_chi: [
    { key: "can_cancel", label: "Hủy phiếu chi", hint: "Cho phép huỷ phiếu chi đã lập." },
    { key: "can_export", label: "In phiếu chi", hint: "Cho phép in phiếu chi / UNC và in bảng kê tạm ứng." },
  ],
  // Ô "Xác nhận đã thu tiền" (`can_manage_status`) ĐÃ GỠ 27/08/2026: phiếu thu nay lập ra là ĐÃ
  // THU, không còn trạng thái chờ nên không còn gì để xác nhận. Khoá quyền vẫn tồn tại ở server
  // (`mark-received`) cho phiếu CŨ lỡ nằm lại ở trạng thái chờ, nhưng không bày thành ô bật/tắt
  // nữa — bày một ô cho cái nút không bao giờ hiện chỉ tổ làm người cấp quyền đoán mò.
  phieu_thu: [
    { key: "can_cancel", label: "Hủy phiếu thu / hoá đơn bán", hint: "Cho phép huỷ phiếu thu và hoá đơn bán. Lưu ý: bật ô này là bật luôn Huỷ hoá đơn ở Đơn hàng bán, tắt cũng vậy." },
    { key: "can_export", label: "In phiếu thu", hint: "Cho phép in phiếu thu." },
  ],
};

// Giải thích NGẮN cho từng module: bật "Xem" / "Chỉnh sửa" thì người dùng làm được gì. Hiện qua
// dấu ⓘ cạnh tên module (cùng khuôn tooltip với quyền chi tiết). Module không khai ở đây thì
// không hiện ⓘ — thà thiếu còn hơn mô tả sai.
const MODULE_HINTS: Record<string, string> = {
  self_service:
    "Xem: hiện mục “Hồ sơ của tôi” (hồ sơ, số công, quỹ phép, phiếu lương của chính mình). Lưu ý: luôn bật cho mọi nhân viên, không tắt được.",
  giao_hang:
    "Xem: đơn giao hàng. Thao tác: gửi yêu cầu giao, báo đã lấy hàng, nhập kết quả và số km; đính chứng từ giao hàng (biên bản khách ký, kể cả đơn nhà gia công giao thẳng). Lưu ý: phạm vi ở màn này tính khác — Của tôi là yêu cầu mình lập hoặc chuyến mình chở; Cả phòng chỉ đúng phòng mình, không gồm phòng con. Kế toán cần đính biên bản cho mọi đơn thì chọn Tất cả.",
  nhan_su:
    "Xem: hồ sơ nhân viên. Thao tác: thêm, sửa hồ sơ; gán ca; đính kèm giấy tờ; tạo tài khoản đăng nhập; nhập Excel. Lưu ý: không có xoá hồ sơ.",
  cham_cong:
    "Xem: mở màn, xem công của mình. Thao tác: tự bấm giờ; xin đi muộn / về sớm; gửi yêu cầu chỉnh công. Lưu ý: Xem và Thao tác luôn bật cho mọi nhân viên; xem công người khác cần ô Bảng công tháng; duyệt yêu cầu chỉnh công cần ô Duyệt yêu cầu chỉnh công.",
  noi_quy:
    "Xem: đọc nội quy. Thao tác: thêm, xoá tài liệu.",
  nghi_phep:
    "Xem: mở màn, xem đơn nghỉ của mình. Thao tác: gửi đơn nghỉ. Lưu ý: Xem và Thao tác luôn bật cho mọi nhân viên; huỷ đơn của mình cần ô Huỷ đơn nghỉ của mình; duyệt đơn người khác cần ô Duyệt đơn nghỉ phép.",
  tang_ca:
    "Xem: mở màn, xem phiếu tăng ca của mình. Thao tác: gửi phiếu tăng ca. Lưu ý: Xem và Thao tác luôn bật cho mọi nhân viên; duyệt phiếu người khác cần ô Duyệt phiếu tăng ca.",
  luong:
    "Xem: mở màn Lương, thấy phiếu lương và tạm ứng của mình. Thao tác: gửi đề nghị tạm ứng; lập tạm ứng hộ; sửa mức lương; tính lại, sửa dòng bảng lương; thêm, xoá khoản thu nhập; sửa cấu hình lương. Lưu ý: Xem luôn bật cho mọi nhân viên; Thao tác gồm cả sửa lương của mọi người trong phạm vi đang chọn.",
  thu_mua:
    "Xem: phiếu mua hàng. Thao tác: lập, sửa, gửi duyệt, đánh dấu đã mua / đã nhận. Lưu ý: ai có màn này đều thấy mọi phiếu mua của công ty.",
  // Hai chú giải dưới bổ sung 21/08/2026: trước đó hai màn này KHÔNG có dòng nào, người cấp quyền
  // phải tự đoán "Xem cái này thì thấy gì" (xem docs/RBAC_QUYEN_THEO_MODULE.md §5).
  yeu_cau_mua_hang:
    "Xem: yêu cầu mua hàng. Thao tác: lập, sửa yêu cầu; huỷ yêu cầu, bỏ món — của mình và của người khác trong phạm vi. Lưu ý: phạm vi Của tôi là yêu cầu mình lập (chỉ huỷ được của mình); Cả phòng chỉ đúng phòng mình, không gồm phòng con. Bật Thao tác là bật luôn Đề nghị mua ở Kế hoạch vật tư, tắt cũng vậy.",
  nha_cung_cap:
    "Xem: nhà cung cấp và mặt hàng họ bán. Thao tác: thêm, sửa, ngừng dùng, nhập từ Excel.",
  khach_hang:
    "Xem: danh sách khách và lịch sử giao dịch. Thao tác: thêm, sửa khách; nhập Excel; người liên hệ, địa chỉ, ghi chú, nhãn, tệp, lịch hẹn. Lưu ý: không có xoá khách.",
  bao_gia:
    "Xem: báo giá. Thao tác: tạo, sửa, gửi khách, ghi kết quả, huỷ báo giá; tải PDF gửi khách.",
  don_hang_ban:
    "Xem: đơn hàng bán. Chỉnh sửa: tạo, sửa, chốt, huỷ đơn; chuyển đơn xuống sản xuất. Lưu ý: bật Chỉnh sửa là bật luôn Tạo đơn hàng ở Báo giá, tắt cũng vậy.",
  // 6 dòng dưới đây gác 6 MÀN RIÊNG (tách 17/08/2026). Trước đó `san_xuat` mở 4 màn và
  // `ky_thuat_may` mở 2 — nhãn cũ chỉ kể một màn nên người cấp quyền không đoán ra mình vừa mở gì.
  san_xuat:
    "Xem: hàng chờ và lệnh sản xuất. Thao tác: tạo, sửa, xoá lệnh; sửa công đoạn, đánh dấu sẵn sàng; giao gia công ngoài (mang đi, chốt, trọn gói). Lưu ý: phạm vi tính theo sale phụ trách đơn.",
  ke_hoach_vat_tu:
    "Xem: bảng cân đối vật tư (không có giá). Thao tác: giữ chỗ, nhả giữ chỗ vật tư cho lệnh. Lưu ý: lập yêu cầu mua từ dòng thiếu là ô chi tiết Đề nghị mua.",
  // Khoá vẫn mang hậu tố `_2` (đổi khoá trong DB không đáng), nhưng đây là màn Bài ghép DUY NHẤT
  // từ 18/08/2026 — bản cũ đã gỡ, mg 0216 chép quyền sang.
  bai_ghep_2:
    "Xem: bài ghép. Thao tác: tạo, sửa bài ghép.",
  xep_lich:
    "Xem: lịch xưởng. Thao tác: xếp, dời, bỏ lịch.",
  ky_thuat_may:
    "Xem: phiếu sửa chữa và máy được báo hỏng. Thao tác: nhận phiếu, ghi đã sửa, tải ảnh, xác nhận xong.",
  phieu_bao_tri:
    "Xem: phiếu bảo trì và lịch đến hạn. Thao tác: tạo phiếu, đánh dấu hạng mục, dời lịch, xác nhận xong, huỷ phiếu.",
  phong_ban:
    "Xem: cây phòng ban, nhân sự và vai trò. Thao tác: thêm, sửa, xoá phòng ban và vai trò.",
  ke_toan:
    "Xem: mở màn, thấy mọi đơn mua hàng đã gửi duyệt (chờ duyệt, đã duyệt, đang chi…). Lưu ý: duyệt, từ chối đơn cần ô Duyệt đơn mua hàng.",
  phieu_chi:
    "Xem: phiếu chi. Chỉnh sửa: lập phiếu chi. Lưu ý: bật Chỉnh sửa là bật luôn Trả lại cọc ở Đơn hàng bán, tắt cũng vậy.",
  phieu_thu:
    "Xem: phiếu thu. Chỉnh sửa: lập, sửa phiếu thu. Lưu ý: bật Chỉnh sửa là bật luôn Thu cọc và ghi hoá đơn ở Đơn hàng bán, tắt cũng vậy.",
  cong_no_phai_tra:
    "Xem: số còn nợ từng nhà cung cấp.",
  cong_no_phai_thu:
    "Xem: số khách còn nợ.",
  bao_cao_cong_no:
    "Xem: báo cáo công nợ, xuất Excel. Thao tác: khoá / mở kỳ công nợ.",
  bao_cao_kinh_doanh:
    "Xem: báo cáo đơn đã chốt theo khách và xuất Excel. Lưu ý: phạm vi tính như khối Kinh doanh — theo người phụ trách khách, Của tôi gồm cả nhóm dùng chung.",
  tk_ngan_hang:
    "Xem: tài khoản ngân hàng. Thao tác: thêm, sửa, ngừng dùng.",
  quy_trinh_kinh_doanh:
    "Xem: sơ đồ quy trình kinh doanh.",
  tinh_gia_thanh:
    "Xem: phiếu tính giá. Thao tác: lập, sửa, nhân bản phiếu.",
  lenh_san_xuat:
    "Xem: hồ sơ các lệnh sản xuất. Lưu ý: phạm vi tính theo sale phụ trách đơn.",
  theo_doi_san_xuat:
    "Xem: tiến độ sản xuất của các lệnh. Lưu ý: phạm vi tính theo sale phụ trách đơn.",
  tai_san:
    "Xem: tài sản và công cụ dụng cụ, khấu hao từng tháng. Thao tác: thêm (cả nhập Excel tài sản đang dùng), sửa, chuyển bộ phận, sửa chữa lớn, thôi dùng, xoá cái nhập nhầm; xuất Excel khấu hao tháng.",
  kho:
    "Xem: yêu cầu và phiếu nhập / xuất kho. Thao tác: tạo, sửa, gửi, huỷ yêu cầu nhập / xuất của mình. Lưu ý: việc của thủ kho (tiếp nhận yêu cầu, lập phiếu) là ô chi tiết riêng; phiếu đã lập không sửa được, sai thì huỷ.",
  bao_cao_kho:
    "Xem: sổ kho, Nhập-Xuất-Tồn và xuất Excel.",
  dm_thiet_bi:
    "Xem: danh mục thiết bị, máy móc, xuất Excel. Thao tác: thêm, sửa, xoá, ngừng / dùng lại, nhập Excel.",
  dm_cong_doan:
    "Xem: danh mục công đoạn, xuất Excel. Thao tác: thêm, sửa, xoá, ngừng / dùng lại, nhập Excel. Lưu ý: sửa công đoạn là sửa cả đơn giá khoán, tức đụng tới tiền lương.",
  dm_don_vi:
    "Xem: đơn vị và quy đổi, xuất Excel. Thao tác: thêm, sửa, xoá, nhập Excel.",
  dm_giay:
    "Xem: danh mục giấy, xuất Excel. Thao tác: thêm, sửa, xoá, ngừng / dùng lại, nhập Excel.",
  dm_vat_tu:
    "Xem: danh mục vật tư khác, xuất Excel. Thao tác: thêm, sửa, xoá, ngừng / dùng lại, nhập Excel.",
  dm_thanh_pham:
    "Xem: danh mục thành phẩm, xuất Excel. Thao tác: thêm, sửa, xoá, ngừng / dùng lại, nhập Excel.",
  khuon_be:
    "Xem: danh mục khuôn, xuất Excel. Thao tác: thêm, sửa, xoá, ngừng / dùng lại, nhập Excel.",
  dm_kho_hang:
    "Xem: các kho đã khai báo, xuất Excel. Thao tác: thêm, sửa, xoá, ngừng / dùng lại kho, nhập Excel.",
  dm_kcs_tieu_chi:
    "Xem: tiêu chí KCS. Thao tác: thêm, sửa, xoá, ngừng / dùng lại.",
  dm_xe:
    "Xem: danh mục xe giao hàng, xuất Excel. Thao tác: thêm, sửa, xoá, ngừng / dùng lại, nhập Excel.",
  dm_muc_thu_chi:
    "Xem: danh mục mục thu chi. Thao tác: thêm, sửa, xoá, ngừng / dùng lại. Lưu ý: người lập phiếu thu, phiếu chi vẫn chọn được mục dù không có ô này.",
  bao_cao_thu_chi:
    "Xem: báo cáo thu chi theo mục và tháng, xuất Excel. Thao tác: chuyển phiếu sang mục khác.",
  activity_log:
    "Xem: nhật ký thao tác. Lưu ý: chỉ thấy dòng của những màn mình được vào.",
};

// Nghĩa CHUNG của 3 cột — luôn đúng với mọi module, hiện ở dòng tiêu đề.
//: Khối Kinh doanh (Tính giá · Báo giá · Đơn hàng · Khách hàng) lọc theo NGƯỜI PHỤ TRÁCH KHÁCH và "Của tôi"
//: nới ra cả nhóm dùng chung (`org_scope.nhom_dung_chung_user_ids`) — khác các khối còn lại.
const HINT_PHAM_VI_KD =
  "Thấy khách, phiếu tính giá, báo giá, đơn của ai, tính theo sale phụ trách khách. Của tôi: của mình và nhóm dùng chung. Cả phòng: cả phòng mình. Tất cả: toàn công ty.";

const COL_HINTS = {
  read: "Cho phép mở màn và xem dữ liệu. Tắt Xem thì Thao tác cũng tắt theo.",
  write: "Cho phép thêm, sửa, xoá. Bật Thao tác thì Xem tự bật theo. Lưu ý: vài màn có việc riêng (Yêu cầu nhập xuất là tạo yêu cầu, mỗi kho là khai ngưỡng tồn); xem dấu hỏi cạnh tên màn.",
  scope: "Người này thấy được dữ liệu của ai. Của tôi: chỉ cái mình lập hoặc mình phụ trách. Cả phòng: của cả phòng mình, gồm cả tổ con. Tất cả: cả công ty. Lưu ý: vài màn tính hơi khác, xem dấu hỏi cạnh tên màn.",
};

export const SCOPES: { value: Scope; label: string }[] = [
  { value: "own", label: "Của tôi" },
  { value: "department", label: "Cả phòng" },
  { value: "all", label: "Tất cả" },
];

// Gom module theo PHÂN HỆ để ma trận quyền đọc được (thu gọn từng nhóm). Module không nằm trong
// nhóm nào rơi vào "Khác" (fallback an toàn khi backend thêm module mới chưa map).
// Khoá CŨ đã gộp về nơi khác — ẨN khỏi ma trận, KHÔNG xoá dữ liệu (ĐẢO ĐƯỢC: xoá set này là chúng
// hiện lại y cũ). Đã soi đủ BA nơi (cổng router · `authz.can` ở service · `can(...)` ở giao diện)
// + đếm dữ liệu thật ngày 26/08/2026 — không dòng code nào còn đọc chúng:
//   · `self_service`       — ĐÃ QUAY LẠI 24/09/2026, xem chú thích trong set. Ẩn nó ngày
//                            26/08/2026 là đúng lúc đó (không ai đọc ô này ở máy chủ), nhưng từ
//                            khi mục menu "Hồ sơ của tôi" thôi ăn ké khoá `dashboard` thì chính
//                            ô này quyết định mục đó có hiện không — ẩn đi là màn không cấp được.
//   · `yeu_cau_chinh_cong` — gộp về `cham_cong.approve`. Số khớp: 2 vai ↔ 2 vai.
//   · `di_muon`            — gộp về `cham_cong.approve_late_early`. Số khớp: 3 vai ↔ 3 vai. Việc
//                            CUỐI CÙNG của nó (badge phiếu chờ duyệt + kênh SSE) đã chuyển sang
//                            `cham_cong` cùng ngày; đã đếm: mọi vai có `di_muon` đều đã có
//                            `cham_cong` nên không ai mất badge.
// Xoá HẲN (dòng `role_permissions` + khoá ở `seed.py`/`deps.py` + hằng chết) để LƯỢT SAU — việc đó
// không đảo được nên cần migration + chủ gật.
const MODULE_DA_NGUNG = new Set([
  // `self_service` ĐÃ BỎ khỏi danh sách này (24/09/2026): "Hồ sơ của tôi" là một MỤC MENU thật,
  // nên nó phải có dòng riêng trong ma trận như mọi mục khác — khối "Tổng quan" của thanh bên có
  // hai mục thì nhóm "Tổng quan" ở đây cũng phải có hai dòng. Ô này được `rbac_repo.O_MAC_DINH`
  // cấp sẵn cho vai MỚI, nhưng cấp sẵn ≠ không được xem: quản trị vẫn cần thấy vai nào đang có.
  "di_muon", "yeu_cau_chinh_cong",
  // `dashboard` (Trang chủ) — 05/10/2026 chủ bỏ hẳn mục menu; mở app vào thẳng "Hồ sơ của tôi".
  "dashboard",
  // `bai_ghep_2` KHÔNG chết — chỉ ĐANG ẨN theo cờ `BAI_GHEP_ENABLED` (10/09/2026). Ẩn nốt ở đây
  // vì màn đã rút khỏi menu: để ô lại thì quản trị tick xong vẫn không ai thấy màn nào mở ra.
  // Dòng `role_permissions` đã cấp GIỮ NGUYÊN trong DB, bật cờ lại là ô hiện y như cũ.
  ...(BAI_GHEP_ENABLED ? [] : ["bai_ghep_2"]),
]);

const MODULE_GROUPS: {
  key: string;
  label: string;
  modules: string[];
  /** Nhóm KHÔNG có cột Phạm vi: dữ liệu dùng chung toàn công ty, không có "của tôi \ cả phòng".
   *  Danh mục là nhóm duy nhất như vậy — `scope` của nó không service nào đọc, để dropdown ở đó
   *  chỉ khiến người cấp quyền tưởng mình vừa giới hạn được cái gì. Backend ép `all` khi lưu. */
  noScope?: boolean;
  /** Nhóm KHÔNG có cột Thao tác (Tổ sản xuất — ba quyền chi tiết thay nó). */
  noWrite?: boolean;
}[] = [
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // MỘT NHÓM Ở ĐÂY = MỘT KHỐI CỦA THANH BÊN. MỘT DÒNG = MỘT MỤC MENU.
  //
  // Chủ dự án chốt 24/09/2026: *"một module thì nó là một cái bên sidebar, một phân hệ sẽ bao
  // gồm nhiều module"*. Vì vậy `label` ở đây lấy ĐÚNG chữ của `NAV[].label` bên `Sidebar.tsx`
  // (kể cả "Kho hàng", "Cấu hình danh mục", "Nhân sự & Lương", "Quản lý hệ thống" — trước đây
  // rút gọn thành "Kho"/"Danh mục"/"Nhân sự"/"Hệ thống", đọc hai bên thành hai bộ tên khác
  // nhau), và thứ tự module trong nhóm bám đúng thứ tự mục menu của khối đó.
  //
  // Thiếu một khoá ở đây thì nó rơi vào nhóm "Khác" ở CUỐI ma trận — nhóm đó mặc định THU GỌN
  // khi chưa cấp gì (`open = granted > 0`), nên module mới coi như tàng hình: không ai cấp ⇒
  // menu không hiện ⇒ tưởng module chưa dựng. `bai_ghep_2` dính bẫy đó 18/08/2026; bốn khoá
  // `lenh_san_xuat` · `theo_doi_san_xuat` · `tai_san` · `dm_xe` nằm lại trong đó tới 24/09/2026.
  // Guard `test_ma_tran_quyen_khop_thanh_ben.py` nay canh cả hai chiều — thêm màn mà quên khai
  // vào đây là test đỏ ngay, không đợi ai mở dialog ra mới thấy.
  // ─────────────────────────────────────────────────────────────────────────────────────────
  {
    key: "tong_quan",
    label: "Tổng quan",
    // Khối "Tổng quan" của thanh bên có HAI mục — ma trận cũng phải có hai dòng, cùng tên, cùng
    // thứ tự: Trang chủ (`dashboard`) rồi Hồ sơ của tôi (`self_service`). `dashboard` trước nằm ở
    // nhóm "Hệ thống" (ma trận xếp Trang chủ chung với Nhật ký hệ thống, trong khi thanh bên để
    // nó ở khối đầu tiên) và `self_service` thì bị ẩn hẳn — 24/09/2026 dời cả hai về đây.
    modules: ["self_service"],
  },
  {
    key: "kinh_doanh",
    label: "Kinh doanh",
    // Thứ tự = thứ tự menu: Quy trình → Tính giá → Báo giá → Đơn hàng → Giao hàng → Khách hàng
    // → Báo cáo kinh doanh. Người cấp quyền dò theo màn hình chứ không theo tên kỹ thuật.
    // `quy_trinh_kinh_doanh` là khoá RIÊNG từ 24/09/2026 (mg `0329`) — trước đó mục menu đó ăn
    // ké bốn khoá còn lại nên ma trận không có dòng nào mang tên nó; `bao_cao_kinh_doanh` tách
    // cùng ngày ở nhánh kia (báo cáo theo khách — xem + xuất Excel).
    modules: [
      "quy_trinh_kinh_doanh",
      "tinh_gia_thanh",
      "bao_gia",
      "don_hang_ban",
      "giao_hang",
      "khach_hang",
    ],
  },
  // MỘT MÀN = MỘT DÒNG, xếp đúng thứ tự menu "Sản xuất" để người cấp quyền dò theo màn hình.
  // Trước 17/08/2026 cả khối treo trên đúng 2 khoá; bật đủ 2/2 vẫn không siết được màn nào.
  {
    key: "san_xuat",
    label: "Sản xuất",
    // `lenh_san_xuat` + `theo_doi_san_xuat` ĐƯA VỀ ĐÂY 24/09/2026: chúng là mục 2 và 3 của khối
    // Sản xuất trong thanh bên, nhưng ma trận bỏ quên nên rơi xuống "Khác" suốt từ 31/08/2026.
    // `yeu_cau_sua_chua` ("Báo máy hỏng") GỠ HẲN 24/09/2026 (mg `0332`) — chủ chốt: *"bên thanh
    // bên có 2 module sao ở quyền lại có 3"*. Nó không có mục menu riêng vì là KHUNG THỨ HAI của
    // chính màn "Sửa chữa máy" (xem đầu `SuaChuaMayPage.tsx`) ⇒ thành ô chi tiết "Báo máy hỏng"
    // của `ky_thuat_may`, không còn là một dòng.
    modules: [
      "san_xuat",
      "lenh_san_xuat",
      "theo_doi_san_xuat",
      "ke_hoach_vat_tu",
      "bai_ghep_2",
      "xep_lich",
      "kcs",
    ],
  },
  // (Nhóm "Tổ sản xuất" chèn ở ĐÂY lúc chạy — nó dựng từ các dòng `to_sx_<id>` máy chủ trả về,
  //  xem `iSanXuat` phía dưới. Thanh bên cũng có khối cùng tên ngay sau khối "Sản xuất".)
  // KHỐI RIÊNG 24/09/2026 (chủ chốt: *"module sửa chữa máy với phiếu bảo trì thì tách ra làm phân
  // hệ sửa chữa & bảo dưỡng"*). Hai màn này là việc của tổ kỹ thuật, không thuộc chuỗi lập lệnh ·
  // xếp lịch · chạy hàng.
  {
    key: "sua_chua_bao_duong",
    label: "Sửa chữa & bảo dưỡng",
    modules: ["ky_thuat_may", "phieu_bao_tri"],
  },
  {
    key: "thu_mua",
    label: "Thu mua",
    // Tách khỏi nhóm Kho (10/08/2026): mỗi MÀN một ô quyền + phạm vi riêng.
    modules: ["yeu_cau_mua_hang", "thu_mua", "nha_cung_cap"],
  },
  {
    key: "ke_toan",
    label: "Kế toán",
    // Thứ tự = menu: Đơn mua hàng → Phiếu chi → Công nợ phải trả → Phiếu thu → Công nợ phải thu
    // → Báo cáo → Tài khoản ngân hàng → Tài sản & CCDC. `tai_san` ĐƯA VỀ ĐÂY 24/09/2026 (trước
    // rơi vào "Khác" từ lúc dựng màn).
    modules: [
      "ke_toan",
      "phieu_chi",
      "cong_no_phai_tra",
      "phieu_thu",
      "cong_no_phai_thu",
      "tk_ngan_hang",
      "tai_san",
    ],
  },
  {
    key: "kho_hang",
    label: "Kho hàng",
    // Khớp đúng khối "Kho hàng" của thanh bên:
    //   • `kho` — màn "Yêu cầu nhập xuất" (hai tab: bên đi xin · hộp việc của kho);
    //   • MỖI KHO đã khai báo một dòng `ton_kho_<id>` mang tên kho (Kho giấy, Kho thành phẩm…) —
    //     dòng ĐỘNG, máy chủ tự sinh theo Khai báo kho, nối vào cuối nhóm này lúc dựng ma trận
    //     (`dongKho`). Chủ chốt 05/10/2026: *"làm kho giống tổ đi, mỗi kho một dòng"* — trước đó
    //     MỘT dòng "Tồn kho" mở cùng lúc mọi kho, mà thanh bên không có mục nào tên "Tồn kho".
    // "Báo cáo kho" nằm ở khối Báo cáo, đúng như thanh bên.
    modules: ["kho"],
  },
  {
    key: "bao_cao",
    label: "Báo cáo",
    // PHÂN HỆ "Báo cáo" (01/10/2026) — ba màn trước nằm rải ở Kinh doanh · Kế toán · Kho hàng, nay
    // gom về một khối, đúng thứ tự mục menu. Khoá quyền KHÔNG đổi, chỉ đổi nhóm hiển thị.
    modules: ["bao_cao_kinh_doanh", "bao_cao_kho", "bao_cao_cong_no", "bao_cao_thu_chi"],
  },
  {
    key: "cau_hinh_danh_muc",
    label: "Cấu hình danh mục",
    // MỘT MÀN = MỘT DÒNG, đúng thứ tự menu "Cấu hình danh mục". 11 mục menu → 11 dòng.
    // (Màn "Lý do & lỗi SX" + ô `dm_ly_do_san_xuat` ĐÃ GỠ HẲN — mg 0288. Màn "Bù hao" +
    // `dm_bu_hao` GỠ 22/09/2026 — mg 0327: bậc bù hao nay khai trong chính Công đoạn. Màn
    // "Loại sản phẩm" + "Chủng loại giấy" GỠ 27/09/2026 — mg 0342.)
    // `dm_xe` ĐƯA VỀ ĐÂY 24/09/2026 — trước rơi vào "Khác" kể từ khi dựng màn (12/09/2026).
    modules: [
      "dm_thiet_bi",
      "dm_cong_doan",
      "dm_don_vi",
      "dm_giay",
      "dm_vat_tu",
      "dm_thanh_pham",
      "khuon_be",
      "dm_kho_hang",
      "dm_kcs_tieu_chi",
      "dm_xe",
      "dm_muc_thu_chi",
    ],
    noScope: true,
  },
  {
    key: "nhan_su_luong",
    label: "Nhân sự & Lương",
    // ĐÃ GỠ 15/08/2026: "Đi muộn / về sớm" và "Yêu cầu chỉnh công" — hai TAB của màn Chấm công,
    // không phải hai màn; quyền của chúng nay là ô chi tiết của chính Chấm công (mg 0194).
    // Phòng ban ĐỨNG TRƯỚC Hồ sơ nhân sự (chủ chốt 11/08/2026): cây tổ chức là cái khung chứa
    // hồ sơ, đọc từ trên xuống mới thuận — và thanh bên cũng xếp đúng thứ tự đó.
    //
    // HAI KHOÁ GỠ HẲN 24/09/2026 vì không khoá nào có mục thanh bên của riêng nó:
    //   • `vai_tro` (mg `0330`, chủ chốt: *"làm gì có module vai trò đâu; bản chất của sửa ma
    //     trận quyền nó phải là một cái chi tiết trong phòng ban chứ"*) — vai trò là TAB của màn
    //     Phòng ban nên đi theo ô `phong_ban`, việc cấp quyền thành ô chi tiết "Sửa ma trận phân
    //     quyền" của chính ô đó.
    //   • `nguoi_dung` (mg `0331`, chủ chốt: *"gộp luôn người dùng vào hồ sơ nhân sự đi"*) — màn
    //     "Người dùng" riêng đã bỏ, tài khoản đăng nhập là TAB "Tài khoản & Quyền" của màn Hồ sơ
    //     nhân sự, nên bốn ô quản trị tài khoản thành quyền chi tiết của `nhan_su`.
    modules: [
      "phong_ban",
      "nhan_su",
      "cham_cong",
      "nghi_phep",
      "tang_ca",
      "luong",
      "noi_quy",
    ],
  },
  {
    key: "quan_ly_he_thong",
    label: "Quản lý hệ thống",
    // Khối này của thanh bên chỉ có MỘT mục ("Nhật ký") ⇒ ma trận cũng đúng MỘT dòng.
    modules: ["activity_log"],
  },
];

// Nhóm "Tổ sản xuất" (mg 0302, chốt 14/09/2026): MỖI NÚT của khối sản xuất trong Phòng ban là một
// dòng `to_sx_<id>`, máy chủ tự sinh / đổi tên / gỡ theo cây. Dòng không có cột Thao tác — ba quyền
// chi tiết dưới đây thay nó, và cùng Xem đi theo Phạm vi của dòng. Không có ô "KCS" (gỡ mg 0306):
// KCS là dòng `kcs` riêng ở nhóm Sản xuất (09/10/2026), kiểm được mọi tổ — không cấp theo từng tổ.
const KHOA_TO_TIEN_TO = "to_sx_";
const laDongTo = (moduleKey: string) => moduleKey.startsWith(KHOA_TO_TIEN_TO);

/** Cây dòng tổ (`modules` về theo thứ tự cây kèm `cap`): `cha` của từng dòng, và với mỗi dòng là
 *  NHÓM (dòng ngay sau sâu hơn) thì danh sách khoá các tổ LÁ bên trong. Dòng lá không có trong
 *  `laCuaNhom`. */
export function cayDongTo(dong: { key: string; cap?: number }[]): {
  cha: Map<string, string>;
  laCuaNhom: Map<string, string[]>;
} {
  const cha = new Map<string, string>();
  const laCuaNhom = new Map<string, string[]>();
  const chong: { key: string; cap: number }[] = [];
  dong.forEach((d, i) => {
    const cap = d.cap ?? 0;
    while (chong.length && chong[chong.length - 1].cap >= cap) chong.pop();
    if (chong.length) cha.set(d.key, chong[chong.length - 1].key);
    if ((dong[i + 1]?.cap ?? -1) > cap) laCuaNhom.set(d.key, []);
    else for (const c of chong) laCuaNhom.get(c.key)?.push(d.key);
    chong.push({ key: d.key, cap });
  });
  return { cha, laCuaNhom };
}

/** Chỉ tổ LÁ nhận việc và mang quyền (10/10/2026); tổ cha là NHÓM y như thanh bên — tiêu đề gập/mở,
 *  không cấp quyền riêng (máy chủ lưu dòng nhóm trắng, mg 0387 đã chép quyền cũ xuống tổ lá). */
const hintDongTo = (ten: string, soLa: number | undefined) =>
  soLa != null
    ? `${ten} là nhóm: không nhận việc, không cấp quyền riêng. Bấm tên để gập, mở các tổ bên trong. Ô tích bên trái bật hoặc tắt hết quyền của cả ${soLa} tổ bên trong. Lưu ý: tổ mới thêm vào nhóm sau này chưa có quyền, phải bật ở dòng của tổ đó.`
    : `Xem: mục ${ten} dưới Tổ sản xuất trên thanh bên; mở Bàn tổ của tổ này. Phạm vi “Của tôi”: chỉ thấy việc mình được giao. “Cả phòng”: người ngồi ở tổ này hoặc ở nhóm trên nó. Ba quyền chi tiết là việc làm được trên bàn này.`;

const FINE_TO: { key: ActionKey; label: string; hint: string }[] = [
  {
    key: "can_run_order",
    label: "Thực hiện lệnh",
    hint: "Cho phép: giao hoặc rút người khỏi việc; bắt đầu, tạm dừng, đổi máy, kết thúc việc; báo sự cố; nhận và trả khuôn; ghi sản lượng; chốt giấy.",
  },
  {
    key: "can_confirm_output",
    label: "Xác nhận sản lượng",
    hint: "Cho phép: sửa số sản lượng đã ghi; đề xuất bàn giao sang tổ sau; xác nhận nhận bàn giao; đánh dấu đã xem lỗi KCS báo về.",
  },
  {
    key: "can_warehouse",
    label: "Kho",
    hint: "Cho phép: đề nghị lĩnh vật tư; xác nhận đã nhận vật tư; nhập lại vật tư thừa.",
  },
];

// Dòng quyền THEO KHO (05/10/2026): MỖI KHO đã khai báo là một dòng `ton_kho_<id>` mang tên kho,
// máy chủ tự sinh / đổi tên theo Khai báo kho. Xem = mục kho đó hiện trên thanh bên + số tồn, lô
// của kho; Thao tác = khai ngưỡng tồn (cột `can_set_threshold`, xem `COT_THAO_TAC` — chủ chốt
// *"Khai ngưỡng tồn gộp luôn vào thao tác"*); không có ô chi tiết; phạm vi khoá "Tất cả".
const laDongKho = (moduleKey: string) => /^ton_kho_\d+$/.test(moduleKey);

const hintDongKho = (tenKho: string) =>
  `Xem: mục ${tenKho} dưới Kho hàng; mở ra xem tồn, lô của kho này; thấy số tồn khả dụng trên yêu cầu gửi tới kho này. Thao tác: đặt mức tồn tối thiểu / tối đa từng mặt hàng của kho này (quyết định đèn cảnh báo). Lưu ý: kho mới khai ở Khai báo kho tự có dòng riêng, chưa ai có quyền cho tới khi được bật.`;

//: Cột Thao tác bật/tắt những cột nào. Mặc định là thêm + sửa + xoá; vài dòng có việc GHI riêng.
//:   · Nội quy: thêm + xoá (không có "sửa" — đăng bản mới thay bản cũ).
//:   · Yêu cầu nhập xuất: tạo yêu cầu — việc của bên xin (việc của kho là ô chi tiết).
//:   · Mỗi dòng kho: khai ngưỡng tồn — việc ghi duy nhất của màn tồn.
const cotThaoTac = (moduleKey: string): ActionKey[] =>
  moduleKey === "noi_quy"
    ? ["can_create", "can_delete"]
    : moduleKey === "kho"
      ? ["can_request"]
      : moduleKey === "kcs"
        ? ["can_create"]
        : laDongKho(moduleKey)
          ? ["can_set_threshold"]
          : WRITE_ACTIONS;

const NHAN_THAO_TAC: Record<string, string> = {
  noi_quy: "Thao tác (thêm, xóa)",
  kho: "Thao tác (tạo yêu cầu)",
  kcs: "Thao tác (kiểm, gửi nhập kho, đóng lệnh)",
};
const nhanThaoTac = (moduleKey: string) =>
  NHAN_THAO_TAC[moduleKey] ??
  (laDongKho(moduleKey) ? "Thao tác (khai ngưỡng tồn)" : "Chỉnh sửa (thêm, sửa, xóa)");

// Khối Sản xuất (14/10/2026): ba màn Kế hoạch SX · Hồ sơ lệnh · Theo dõi SX lọc theo CHỦ ĐƠN của
// lệnh (`services/lenh_sx/pham_vi.py`), cùng cách tính với khối Kinh doanh; các màn còn lại khoá Tất cả.
const HINT_PHAM_VI_SX =
  "Thấy đơn và lệnh của ai, tính theo sale phụ trách đơn. Của tôi: của mình và nhóm dùng chung. Cả phòng: cả phòng mình. Tất cả: toàn công ty. Người xưởng chọn Tất cả.";

const HINT_PHAM_VI_TO =
  "Người này được thấy việc của ai trong tổ ở dòng này (tính cả các tổ con của nó). Của tôi: chỉ việc của chính mình. Cả phòng: việc của tổ mình đang ở và các tổ con của nó. Tất cả: việc của cả tổ ở dòng này và mọi tổ con.";

//: Ô chi tiết của mỗi dòng kho: chỉ Xem giá thành của KHO ĐÓ (khai ngưỡng tồn đã là cột Thao tác).
const FINE_KHO: FineAction[] = [
  xemGiaKho(
    "Cho phép: xem giá trị tồn, đơn giá nhập, giá bán của lô trong kho này; bảng so sánh giá nhà cung cấp. Lưu ý: chỉ kho này — kho khác có ô riêng; giá trên phiếu nhập / xuất theo ô của Yêu cầu nhập xuất.",
  ),
];

const fineCua = (moduleKey: string): FineAction[] | undefined =>
  FINE_ACTIONS[moduleKey]?.length
    ? FINE_ACTIONS[moduleKey]
    : laDongTo(moduleKey)
      ? FINE_TO
      : laDongKho(moduleKey)
        ? FINE_KHO
        : undefined;

/** A fresh all-off matrix (scope "own") for every module — used when creating a new role. */
export function defaultMatrix(modules: ModuleDef[]): PermissionRow[] {
  return modules.map((m) => ({
    module_key: m.key,
    can_read: false,
    can_create: false,
    can_update: false,
    can_delete: false,
    scope: "own",
    can_reassign: false,
    can_export: false,
    can_view_debt: false,
    can_view_discount: false,
    can_approve: false,
    can_manage_status: false,
    can_reset_password: false,
    can_lock: false,
    can_revoke_sessions: false,
    can_assign_role: false,
    can_transfer: false,
    can_set_head: false,
    can_requote: false,
    can_manage_price: false,
    can_cancel: false,
    can_manage_permissions: false,
    can_clone: false,
    can_toggle_active: false,
    can_reparent: false,
    can_view_salary: false,
    can_edit_salary: false,
    can_adjust: false,
    can_approve_exception: false,
    can_set_credit_terms: false,
    can_assign_work: false,
    can_record_output: false,
    can_handover: false,
    can_request: false,
    can_view_stock: false,
    can_view_cost: false,
    can_view_log: false,
    can_set_threshold: false,
    can_post: false,
    can_close_book: false,
    can_run_order: false,
    can_confirm_output: false,
    can_warehouse: false,
    can_close_short: false,
  }));
}

/** Một module có "quyền" nào không (để đếm N/M ở đầu nhóm + quyết định nhóm nào mở sẵn). */
function rowHasAny(row: PermissionRow): boolean {
  // Dòng có ô LUÔN BẬT là có quyền — kể cả ở form "Thêm vai trò", nơi giá trị chưa nạp từ máy chủ
  // (máy chủ tự bật lúc tạo vai) mà công tắc đã hiện bật. Không tính thì đầu nhóm ghi "0/7".
  if (XEM_CO_DINH.has(row.module_key)) return true;
  if (row.can_read || cotThaoTac(row.module_key).some((k) => row[k])) return true;
  // Ô soi (`mod`) là quyền của dòng khác — không tính dòng này "có quyền".
  const fine = fineCua(row.module_key);
  return fine ? fine.some((a) => !a.mod && row[a.key]) : false;
}

interface PermissionMatrixProps {
  modules: ModuleDef[];
  matrix: PermissionRow[];
  onToggle: (moduleKey: string, action: ActionKey, value: boolean) => void;
  onScope: (moduleKey: string, scope: Scope) => void;
  /** Chế độ chỉ xem: mọi công tắc + phạm vi bị khóa (người dùng thiếu quyền sửa vai trò). */
  readOnly?: boolean;
}

//: Phạm vi nào có nghĩa ở màn nào. Màn không khai ở đây thì cho chọn cả ba như cũ.
//
//  Vì sao khoá: bày ra một lựa chọn không có tác dụng là nói dối người cấp quyền. "Nhà cung cấp"
//  là danh mục dùng chung — không có khái niệm NCC "của tôi"; "Đơn mua hàng (Kế toán)" là hộp thư
//  của cả công ty; "Tự phục vụ" thì đúng nghĩa chỉ của mình.
//
//  ⚠️ Lương CỐ Ý chưa khai ở đây — khoá nó về "Tất cả" là MỞ RỘNG dữ liệu lương ra toàn công ty,
//  chờ chủ chốt chốt (xem PRD vòng 2 §2.6).
const PHAM_VI_CHO_PHEP: Record<string, Scope[]> = {
  nha_cung_cap: ["all"],
  // Mua hàng khoá "Tất cả" (14/10/2026) — máy chủ ép lúc lưu (`role_service`), mg 0411.
  thu_mua: ["all"],
  ke_toan: ["all"],
  cong_no_phai_tra: ["all"],
  cong_no_phai_thu: ["all"],
  bao_cao_cong_no: ["all"],
  bao_cao_thu_chi: ["all"],
  nhan_su: ["department", "all"],
  // Bốn màn sổ sách kế toán / tài sản (05/10/2026): máy chủ KHÔNG đọc phạm vi của các khoá này
  // (`routers/accounting.py`, `routers/tai_san.py`) — chọn gì cũng thấy toàn bộ. Nay vào
  // `SCOPELESS_MODULES` (ép `all` lúc lưu), giao diện khoá cho khớp.
  phieu_chi: ["all"],
  phieu_thu: ["all"],
  tk_ngan_hang: ["all"],
  tai_san: ["all"],
  // Kỹ thuật máy nằm trong `SCOPELESS_MODULES` của máy chủ (ép `all` lúc lưu) NHƯNG ở nhóm Sản
  // xuất — nhóm này có cột Phạm vi thật (`san_xuat` dùng), nên không bỏ ô đi được như nhóm Danh
  // mục. Khoá về một lựa chọn để ô hiện mờ thay vì bày ba lựa chọn mà chọn gì cũng ra `all`.
  ky_thuat_may: ["all"],
  // Bốn màn tách khỏi khối Sản xuất 17/08/2026 cũng nằm trong `SCOPELESS_MODULES` của máy chủ
  // (ép `all` lúc lưu) nhưng ở nhóm Sản xuất — nhóm này có cột Phạm vi thật vì `san_xuat` dùng
  // (`lsx.py` lọc lệnh theo scope), nên không bỏ cột đi được. Khoá về một lựa chọn để ô hiện mờ.
  ke_hoach_vat_tu: ["all"],
  bai_ghep_2: ["all"],
  xep_lich: ["all"],
  // KCS (09/10/2026): kiểm cả chuỗi mọi tổ — máy chủ ép `all` (`SCOPELESS_MODULES`).
  kcs: ["all"],
  phieu_bao_tri: ["all"],
  // Hai khoá tách ra 24/09/2026 (mg `0329`) cũng nằm trong `SCOPELESS_MODULES` của máy chủ nhưng
  // ở nhóm CÓ cột Phạm vi (Kinh doanh · Kho hàng), nên khoá về một lựa chọn để ô hiện mờ thay vì
  // bày ba lựa chọn mà chọn gì cũng ra `all`.
  // Bản đồ luồng: một bức tranh chung, không có "quy trình của tôi".
  quy_trinh_kinh_doanh: ["all"],
  // Nhật ký (25/09/2026) vào `SCOPELESS_MODULES` của máy chủ. Trước đó ô này bày đủ ba lựa chọn
  // mà endpoint không đọc scope lần nào — chọn gì cũng thấy toàn bộ. Cái thật sự giới hạn tầm
  // nhìn là quyền trên TỪNG MÀN: dòng của màn người xem không mở được thì máy chủ che đi.
  activity_log: ["all"],
  // Sổ kho là sổ của CẢ KHO — không có "báo cáo của tôi".
  bao_cao_kho: ["all"],
  // Nội quy lao động là tài liệu CHUNG toàn công ty — không có "nội quy của tôi" hay "nội quy
  // của phòng tôi". Ô Xem đã khoá bật sẵn cho mọi vai; 24/09/2026 khoá nốt ô phạm vi (chủ chốt:
  // *"nội quy công ty mặc định tất cả và không cho chỉnh sửa"*), máy chủ ép `all` lúc lưu.
  noi_quy: ["all"],
  // "Hồ sơ của tôi" chỉ có MỘT phạm vi đúng nghĩa: của chính mình. Mọi đường `/me` tự lọc theo hồ
  // sơ gắn với tài khoản nên không router nào đọc scope của khoá này — bày ba lựa chọn ở đây chỉ
  // khiến người cấp quyền tưởng mình vừa mở cho ai đó xem hồ sơ người khác.
  self_service: ["own"],
};

//: Ô CHỈ BẬT ĐƯỢC khi phạm vi là "Tất cả" (chủ chốt 15/08/2026).
//: Ba tab cấu hình dưới đây ghi vào dữ liệu DÙNG CHUNG cả nhà máy — đổi lịch lễ hay khai ca là
//: đổi CÔNG của toàn bộ nhân viên, không phải của một tổ. Máy chủ cũng chặn (403), nên không khai
//: ở đây thì người cấp quyền tick được mà người dùng bấm vào ăn lỗi.
//: Khai theo CẶP `khoá:cột` từ 24/09/2026 — trước đó chỉ khai tên cột, mà tên cột dùng chung giữa
//: các màn: `can_lock` của Chấm công là "Chốt kỳ công" (đúng là phải toàn công ty) còn `can_lock`
//: của Hồ sơ nhân sự là "Khoá / Mở tài khoản". Khai trần tên cột thì ô thứ hai bị làm mờ oan.
//: ⚠️ (rà soát 05/10/2026) Bốn ô tài khoản của Hồ sơ nhân sự hiện KHÔNG bị máy chủ giới hạn theo
//: phạm vi (`routers/rbac.py`, `user_admin_service.py`) — "Cả phòng" vẫn đụng được mọi tài khoản.
//: Lỗ hổng chờ vá ở máy chủ, đừng dựa vào phạm vi ở đây.
const O_DOI_PHAM_VI_TOAN_CTY: ReadonlySet<string> = new Set([
  "cham_cong:can_manage_locations",
  "cham_cong:can_manage_shifts",
  "cham_cong:can_manage_calendar",
  // Chốt kỳ công / Mở lại kỳ: máy chủ ĐÃ đòi phạm vi "Tất cả" từ đợt trước, nhưng ma trận không
  // nói ra ⇒ tick được rồi bấm mới ăn 403. Một cú bấm đóng băng bảng công của TOÀN CÔNG TY; chốt
  // nửa nhà máy thì bảng lương không biết nửa nào là nửa nào.
  "cham_cong:can_lock",
]);

//: Ô này có đòi phạm vi "Tất cả" không? (khoá màn + tên cột)
const doiPhamViToanCty = (khoa: string, cot: string) =>
  O_DOI_PHAM_VI_TOAN_CTY.has(`${khoa}:${cot}`);

const CANH_BAO_PHAM_VI =
  "Ô này áp cho cả công ty nên cần phạm vi “Tất cả”.";

//: Ô chi tiết BẮT BUỘC bật khi module có quyền CHỈNH SỬA — bật kèm, khoá không cho tắt.
//: `tinh_gia_thanh:can_view_cost`: lập hay sửa phiếu tính giá CHÍNH LÀ mở thẻ sản phẩm ra khai
//: giấy/khổ/công đoạn, nên "được sửa mà không được xem chi tiết" là trạng thái không tồn tại. Máy
//: chủ cũng đòi cả hai (`routers/phieu_tinh_gia.py` → `RuotGia`), nên để tắt được ô này chỉ tạo ra
//: vai bấm Lưu phiếu là ăn 403.
const FINE_THEO_WRITE: Record<string, ActionKey> = {
  tinh_gia_thanh: "can_view_cost",
};

const CANH_BAO_FINE_THEO_WRITE =
  "Có quyền Thao tác ở Tính giá thì ô này luôn bật. Tắt Thao tác thì mới tắt được ô này.";

const CANH_BAO_O_CHET =
  "Ô này chưa dùng vào việc gì.";

//: Ô tích "bật hết quyền" — tích đủ khi mọi công tắc đang bật, gạch ngang khi mới bật một phần.
function TickTatCa({
  o,
  nhan,
  onClick,
}: {
  o: { on: boolean }[];
  nhan: string;
  onClick: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const soBat = o.filter((x) => x.on).length;
  const du = soBat === o.length;
  const motPhan = soBat > 0 && !du;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = motPhan;
  }, [motPhan]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="rdx-perm__tick"
      checked={du}
      onChange={onClick}
      title={du ? "Tắt hết" : "Bật hết"}
      aria-label={`${du ? "Tắt hết" : "Bật hết"} quyền — ${nhan}`}
    />
  );
}

export function PermissionMatrix({
  modules,
  matrix,
  onToggle,
  onScope,
  readOnly = false,
}: PermissionMatrixProps) {
  const moduleLabel = new Map(modules.map((m) => [m.key, m.label]));
  const moduleDef = new Map(modules.map((m) => [m.key, m]));
  // Máy chủ khai những ô ĐÃ XÁC MINH là chết (`/api/rbac/modules` → `viec_chet`). Chỉ tắt + khoá
  // đúng mấy ô đó.
  //
  // ⚠️ ĐỪNG đảo lại thành "cái gì máy chủ không gác thì chết". Bản đầu (11/08/2026) làm vậy và
  // khoá nhầm hàng loạt ô đang dùng được — In/xuất phiếu chi · phiếu thu · Đặt trưởng phòng · Đổi
  // cấp trên · Xem lương & BHXH · Sửa lương & BHXH · Thao tác vòng đời · Điều chuyển & đổi chức danh.
  // Lý do: rất nhiều ô chỉ thi hành ở GIAO DIỆN (ẩn/hiện nút), máy chủ không hề biết.
  const viecChet = new Map(
    modules.filter((m) => m.viec_chet).map((m) => [m.key, new Set(m.viec_chet!)]),
  );
  /** Mặc định CÒN SỐNG — thà để thừa một ô vô hại còn hơn khoá nhầm một ô đang dùng. */
  const oSong = (moduleKey: string, viec: string): boolean =>
    !viecChet.get(moduleKey)?.has(viec);
  const matrixHienThi = matrix.filter((r) => !MODULE_DA_NGUNG.has(r.module_key));
  const byKey = new Map(matrixHienThi.map((r) => [r.module_key, r]));
  // Nhóm mở/đóng: mặc định mở khi nhóm CÓ quyền; override khi người dùng bấm.
  const [groupOverride, setGroupOverride] = useState<Map<string, boolean>>(new Map());
  // Panel quyền chi tiết bung inline theo module.
  const [openFine, setOpenFine] = useState<Set<string>>(new Set());

  // Dựng danh sách nhóm hiển thị: nhóm đã map + nhóm "Khác" cho module chưa map.
  const mapped = new Set(MODULE_GROUPS.flatMap((g) => g.modules));
  const orphans = matrixHienThi
    .map((r) => r.module_key)
    .filter((k) => !mapped.has(k) && !laDongTo(k) && !laDongKho(k));
  // Dòng tổ theo ĐÚNG thứ tự cây máy chủ trả (`modules` đã xếp duyệt sâu) — thứ tự của ma trận đã
  // lưu thì không có nghĩa gì với cây.
  const dongTo = modules
    .filter((m) => laDongTo(m.key))
    .map((m) => byKey.get(m.key))
    .filter((r): r is PermissionRow => !!r);
  const cayTo = cayDongTo(modules.filter((m) => laDongTo(m.key)));
  // Nhóm tổ đang GẬP trên ma trận (giống thanh bên).
  const [toGap, setToGap] = useState<Set<string>>(new Set());
  const anVaoNhomGap = (key: string): boolean => {
    for (let c = cayTo.cha.get(key); c; c = cayTo.cha.get(c)) if (toGap.has(c)) return true;
    return false;
  };
  // Dòng kho theo thứ tự máy chủ trả (mã kho; chỉ kho ĐANG DÙNG — kho ngừng dùng giữ quyền nhưng
  // không bày, đúng như thanh bên).
  const dongKho = modules
    .filter((m) => laDongKho(m.key))
    .map((m) => byKey.get(m.key))
    .filter((r): r is PermissionRow => !!r);
  const iSanXuat = MODULE_GROUPS.findIndex((g) => g.key === "san_xuat");
  const nhomTinh = MODULE_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    noScope: g.noScope === true,
    noWrite: g.noWrite === true,
    rows: [
      ...g.modules.map((k) => byKey.get(k)).filter((r): r is PermissionRow => !!r),
      ...(g.key === "kho_hang" ? dongKho : []),
    ],
  }));
  const groups = [
    ...nhomTinh.slice(0, iSanXuat + 1),
    // Đứng ngay sau nhóm Sản xuất — khớp thanh bên: khối "Tổ sản xuất" cũng nằm ngay đó
    // (24/09/2026 nó là khối riêng, trước đó là mấy node động nấp trong khối "Sản xuất").
    { key: "to_san_xuat", label: "Tổ sản xuất", noScope: false, noWrite: true, rows: dongTo },
    ...nhomTinh.slice(iSanXuat + 1),
    ...(orphans.length
      ? [
          {
            key: "khac",
            label: "Khác",
            noScope: false,
            noWrite: false,
            rows: orphans.map((k) => byKey.get(k)!).filter(Boolean),
          },
        ]
      : []),
  ].filter((g) => g.rows.length > 0);

  const toggleFine = (moduleKey: string) =>
    setOpenFine((cur) => {
      const next = new Set(cur);
      if (next.has(moduleKey)) next.delete(moduleKey);
      else next.add(moduleKey);
      return next;
    });

  // Khối "Điền theo vai mẫu" đã gỡ (05/10/2026) — cấp quyền từng ô trực tiếp.

  //: Mọi công tắc BẤM ĐƯỢC của một dòng (Xem · Thao tác · quyền chi tiết) — nguồn cho nút "Bật hết /
  //: Tắt hết" của dòng và của cả nhóm. Bỏ qua đúng những ô mà người dùng cũng không bấm được bằng tay:
  //: ô chết, Xem cố định của Nội quy, và ô đòi phạm vi "Tất cả" khi dòng chưa ở "Tất cả".
  const oCuaDong = (row: PermissionRow, noWrite: boolean) => {
    const out: { khoa: string; key: ActionKey; on: boolean }[] = [];
    const khoa = row.module_key;
    if (!XEM_CO_DINH.has(khoa) && oSong(khoa, "read")) {
      out.push({ khoa, key: "can_read", on: row.can_read });
    }
    if (!noWrite && !THAO_TAC_CO_DINH.has(khoa)) {
      const ks = cotThaoTac(khoa);
      if (ks.some((k) => oSong(khoa, k.replace("can_", "")))) {
        ks.forEach((k) => out.push({ khoa, key: k, on: !!row[k] }));
      }
    }
    for (const a of fineCua(khoa) ?? []) {
      // Ô soi KHÔNG vào "Bật hết" của dòng / nhóm: tích hết Đơn hàng bán mà mở luôn quyền thu chi ở
      // màn kế toán là quá tay. Muốn cấp thì bấm đúng ô đó.
      if (a.mod) continue;
      if (!oSong(khoa, a.key.replace("can_", ""))) continue;
      if (doiPhamViToanCty(khoa, a.key) && row.scope !== "all") continue;
      (a.keys ?? [a.key]).forEach((k) => out.push({ khoa, key: k, on: !!row[k] }));
    }
    return out;
  };
  //: Đang bật hết thì tắt hết, còn thiếu ô nào thì bật hết. Bật Xem/Thao tác TRƯỚC rồi mới tới ô chi
  //: tiết; khi tắt thì ngược lại — `applyPermissionDependency` của màn cha tự kéo theo phần còn lại.
  const batTat = (o: { khoa: string; key: ActionKey; on: boolean }[]) => {
    if (o.length === 0) return;
    const bat = !o.every((x) => x.on);
    (bat ? o : [...o].reverse()).forEach((x) => {
      if (x.on !== bat) onToggle(x.khoa, x.key, bat);
    });
  };

  return (
    <div className="rdx-perm">
      {groups.map((g) => {
        // Khối Tổ sản xuất: dòng NHÓM chỉ là tiêu đề — đếm và "tích hết" chỉ tính dòng tổ lá.
        const rowsCoQuyen = g.key === "to_san_xuat"
          ? g.rows.filter((r) => !cayTo.laCuaNhom.has(r.module_key))
          : g.rows;
        const granted = rowsCoQuyen.filter(rowHasAny).length;
        const open = groupOverride.has(g.key) ? groupOverride.get(g.key)! : granted > 0;
        const oNhom = rowsCoQuyen.flatMap((r) => oCuaDong(r, g.noWrite));
        return (
          <section key={g.key} className={`rdx-perm__group${open ? " is-open" : ""}`}>
            <button
              type="button"
              className="rdx-perm__ghead"
              aria-expanded={open}
              onClick={() =>
                setGroupOverride((m) => new Map(m).set(g.key, !open))
              }
            >
              <Icon name="chevron" size={15} className="rdx-perm__gcaret" />
              <span className="rdx-perm__gname">{g.label}</span>
              <span
                className={`rdx-perm__gcount${granted > 0 ? " is-on" : ""}`}
              >
                {granted}/{rowsCoQuyen.length} có quyền
              </span>
            </button>

            {open && (
              <div
                className={`rdx-perm__rows${g.noScope ? " rdx-perm__rows--noscope" : ""}${g.noWrite ? " rdx-perm__rows--to" : ""}`}
                role="group"
                aria-label={g.label}
              >
                <div className="rdx-perm__colhead">
                  <span className="rdx-perm__c-mod">
                    {!readOnly && oNhom.length > 0 && (
                      <TickTatCa
                        o={oNhom}
                        nhan={`cả nhóm ${g.label}`}
                        onClick={() => batTat(oNhom)}
                      />
                    )}
                    {g.noWrite ? "Đơn vị" : "Module"}
                  </span>
                  <span className="rdx-perm__c-act">
                    Xem
                    <HoverTip tieuDe="Xem" text={COL_HINTS.read} />
                  </span>
                  {!g.noWrite && (
                    <span className="rdx-perm__c-act">
                      Thao tác
                      <HoverTip tieuDe="Thao tác" text={COL_HINTS.write} />
                    </span>
                  )}
                  {!g.noScope && (
                    <span className="rdx-perm__c-scope">
                      Phạm vi
                      <HoverTip tieuDe="Phạm vi" text={g.noWrite ? HINT_PHAM_VI_TO : g.key === "kinh_doanh" ? HINT_PHAM_VI_KD : g.key === "san_xuat" ? HINT_PHAM_VI_SX : COL_HINTS.scope} />
                    </span>
                  )}
                </div>
                {g.rows.map((row) => {
                  const label = moduleLabel.get(row.module_key) ?? row.module_key;
                  if (laDongTo(row.module_key) && anVaoNhomGap(row.module_key)) return null;
                  const laTrongNhom = laDongTo(row.module_key) ? cayTo.laCuaNhom.get(row.module_key) : undefined;
                  if (laTrongNhom) {
                    const oLa = laTrongNhom
                      .map((k) => byKey.get(k))
                      .filter((r): r is PermissionRow => !!r)
                      .flatMap((r) => oCuaDong(r, true));
                    const gap = toGap.has(row.module_key);
                    const capNhom = moduleDef.get(row.module_key)?.cap;
                    return (
                      <div key={row.module_key} className="rdx-perm__row rdx-perm__row--nhom">
                        <div
                          className="rdx-perm__cell rdx-perm__cell--mod"
                          style={capNhom ? { paddingLeft: `${capNhom * 18}px` } : undefined}
                        >
                          {!readOnly && (oLa.length > 0 ? (
                            <TickTatCa o={oLa} nhan={`các tổ trong ${label}`} onClick={() => batTat(oLa)} />
                          ) : (
                            <span className="rdx-perm__tick-cho" aria-hidden="true" />
                          ))}
                          <button
                            type="button"
                            className="rdx-perm__nhom"
                            aria-expanded={!gap}
                            title={`${label}: nhóm tổ, bấm để ${gap ? "mở" : "thu gọn"} các tổ bên trong`}
                            onClick={() =>
                              setToGap((cur) => {
                                const next = new Set(cur);
                                if (next.has(row.module_key)) next.delete(row.module_key);
                                else next.add(row.module_key);
                                return next;
                              })
                            }
                          >
                            <span className="rdx-perm__mod">{label}</span>
                            <Icon
                              name="chevron"
                              size={14}
                              className={`rdx-perm__nhom-caret${gap ? " is-collapsed" : ""}`}
                            />
                          </button>
                          <HoverTip tieuDe={label} text={hintDongTo(label, laTrongNhom.length)} />
                        </div>
                      </div>
                    );
                  }
                  // Xem cố định bật cho mọi nhân viên: Nội quy, và Hồ sơ của tôi (14/10/2026, máy chủ
                  // ép bật lúc lưu — `role_service.KHOA_LUON_XEM`, mg 0410).
                  const xemCoDinh = XEM_CO_DINH.has(row.module_key);
                  const actionKeys = cotThaoTac(row.module_key);
                  const canWrite = actionKeys.every((k) => row[k]);
                  // Khoá ô chi tiết bắt buộc bám "CÓ ĐƯỜNG GHI NÀO KHÔNG", KHÔNG bám `canWrite`.
                  // `canWrite` đòi đủ cả thêm+sửa+xóa nên vai thêm+sửa (không xóa) vẫn lọt: quản
                  // trị tắt được ô, rồi người đó bấm Lưu phiếu là ăn 403 từ máy chủ.
                  const coDuongGhi = row.can_create || row.can_update;
                  const xemSong = oSong(row.module_key, "read");
                  // Cột "Thao tác" bật nhiều cột một lúc — coi là còn sống nếu CÓ ÍT NHẤT MỘT
                  // trong số đó được máy chủ gác. Đòi tất cả thì gần như màn nào cũng bị khoá oan.
                  const ghiSong = actionKeys.some((k) =>
                    oSong(row.module_key, k.replace("can_", "")),
                  );
                  const phamViChoPhep =
                    PHAM_VI_CHO_PHEP[row.module_key] ?? (laDongKho(row.module_key) ? ["all"] : undefined);
                  const def = moduleDef.get(row.module_key);
                  // Ô soi (`mod`) mà dòng nguồn không có trong ma trận (màn ngừng dùng) thì không bày.
                  const fineActs = fineCua(row.module_key)?.filter((a) => !a.mod || byKey.has(a.mod));
                  /** Dòng mà ô đọc / ghi: dòng đang đứng, hoặc dòng nguồn của ô soi. */
                  const dongCua = (a: FineAction): PermissionRow => (a.mod ? byKey.get(a.mod)! : row);
                  const khoaCua = (a: FineAction) => a.mod ?? row.module_key;
                  // Công tắc gộp (`keys`): bật = TẤT CẢ cột bật.
                  const fineOn = (a: FineAction) => {
                    const r = dongCua(a);
                    const cot = a.keys ? a.keys.every((k) => r[k]) : !!r[a.key];
                    return cot && (!a.phamVi || r.scope === a.phamVi);
                  };
                  const fineGranted = fineActs ? fineActs.filter(fineOn).length : 0;
                  const fineIsOpen = openFine.has(row.module_key);
                  const oDong = oCuaDong(row, g.noWrite);
                  // Chỉ một công tắc (Xem) thì ô "tích hết" chẳng khác gì bấm công tắc đó — chừa chỗ
                  // trống cùng bề rộng để tên module các dòng vẫn thẳng cột.
                  const coNutDong = !readOnly && (!g.noWrite || !!fineActs) && oDong.length > 1;
                  return (
                    <div key={row.module_key} className="rdx-perm__row">
                      <div
                        className="rdx-perm__cell rdx-perm__cell--mod"
                        // Dòng tổ thụt lề theo cấp trong cây khối sản xuất.
                        style={def?.cap ? { paddingLeft: `${def.cap * 18}px` } : undefined}
                      >
                        {coNutDong ? (
                          <TickTatCa o={oDong} nhan={label} onClick={() => batTat(oDong)} />
                        ) : (
                          !readOnly && <span className="rdx-perm__tick-cho" aria-hidden="true" />
                        )}
                        <span className="rdx-perm__mod">
                          {label}
                          {(MODULE_HINTS[row.module_key] || laDongKho(row.module_key) || laDongTo(row.module_key)) && (
                            <HoverTip
                              tieuDe={label}
                              text={MODULE_HINTS[row.module_key]
                                ?? (laDongTo(row.module_key)
                                  ? hintDongTo(label, undefined)
                                  : hintDongKho(label))}
                            />
                          )}
                        </span>
                        {fineActs && (
                          <button
                            type="button"
                            className={`rdx-perm__finechip${fineGranted > 0 ? " is-on" : ""}${fineIsOpen ? " is-open" : ""}`}
                            aria-expanded={fineIsOpen}
                            onClick={() => toggleFine(row.module_key)}
                          >
                            {fineGranted}/{fineActs.length} chi tiết
                            <Icon name="chevron" size={12} className="rdx-perm__finecaret" />
                          </button>
                        )}
                      </div>
                      <div className="rdx-perm__cell rdx-perm__cell--act">
                        {xemCoDinh ? (
                          <div className="rdx-perm__fixed-read" title="Mọi nhân viên luôn được xem, không tắt được">
                            <input
                              type="checkbox"
                              className="switch"
                              checked
                              disabled
                              aria-label={`Xem — ${label} — mọi nhân viên`}
                            />
                          </div>
                        ) : (
                          <input
                            type="checkbox"
                            className="switch"
                            checked={row.can_read && xemSong}
                            disabled={readOnly || !xemSong}
                            title={xemSong ? undefined : CANH_BAO_O_CHET}
                            aria-label={`Xem — ${label}`}
                            onChange={(e) =>
                              onToggle(row.module_key, "can_read", e.target.checked)
                            }
                          />
                        )}
                      </div>
                      {!g.noWrite && (
                      <div className="rdx-perm__cell rdx-perm__cell--act">
                        {THAO_TAC_CO_DINH.has(row.module_key) ? (
                          <input
                            type="checkbox"
                            className="switch"
                            checked
                            disabled
                            aria-label={`${nhanThaoTac(row.module_key)} — ${label} — mọi nhân viên`}
                          />
                        ) : (
                        <input
                          type="checkbox"
                          className="switch"
                          checked={canWrite && ghiSong}
                          disabled={readOnly || !ghiSong}
                          title={ghiSong ? undefined : CANH_BAO_O_CHET}
                          aria-label={`${nhanThaoTac(row.module_key)} — ${label}`}
                          onChange={(e) => {
                            actionKeys.forEach((k) =>
                              onToggle(row.module_key, k, e.target.checked),
                            );
                            // Bật Chỉnh sửa ⇒ bật kèm ô chi tiết bắt buộc (xem FINE_THEO_WRITE).
                            // Tắt thì KHÔNG tắt theo: vai chỉ-đọc vẫn được phép giữ ô đó.
                            const kem = FINE_THEO_WRITE[row.module_key];
                            if (kem && e.target.checked) onToggle(row.module_key, kem, true);
                          }}
                        />
                        )}
                      </div>
                      )}
                      {/* Nhóm `noScope` (Danh mục) KHÔNG dựng ô này. Trước 17/08/2026 chỉ tiêu đề
                          cột bị ẩn còn ô chọn vẫn render → lưới 3 cột đẩy nó rớt xuống dòng dưới,
                          nằm ngay dưới tên module. Người cấp quyền thấy một ô "Tất cả" tưởng chọn
                          được, trong khi `role_service.SCOPELESS_MODULES` ép `all` lúc lưu. */}
                      {!g.noScope && (
                        <div className="rdx-perm__cell rdx-perm__cell--scope">
                          <select
                            className="rdx-perm__scope"
                            value={row.scope}
                            // Chỉ còn ĐÚNG MỘT lựa chọn ⇒ khoá luôn: bày một ô chọn không chọn được
                            // gì khác chỉ làm người ta bấm thử rồi tưởng hỏng.
                            disabled={readOnly || phamViChoPhep?.length === 1}
                            title={
                              phamViChoPhep?.length === 1
                                ? "Màn này chỉ có một phạm vi hợp lý — không cần chọn."
                                : undefined
                            }
                            aria-label={`Phạm vi — ${label}`}
                            onChange={(e) => {
                              const moi = e.target.value as Scope;
                              // Hạ phạm vi khỏi "Tất cả" thì TỰ TẮT những ô đòi phạm vi toàn công
                              // ty (chủ chốt 15/08/2026). Để nguyên thì ô vẫn hiện là ĐANG BẬT
                              // nhưng bị làm mờ — nhìn như đã cấp, mà bấm vào ăn 403 vì máy chủ
                              // chặn. Tắt hẳn để cái nhìn thấy đúng bằng cái có thật.
                              if (moi !== "all") {
                                O_DOI_PHAM_VI_TOAN_CTY.forEach((cap) => {
                                  const [khoa, k] = cap.split(":");
                                  if (khoa !== row.module_key) return;
                                  if ((row as unknown as Record<string, boolean | undefined>)[k]) {
                                    onToggle(row.module_key, k as ActionKey, false);
                                  }
                                });
                              }
                              onScope(row.module_key, moi);
                            }}
                          >
                            {SCOPES.filter(
                              (s) => !phamViChoPhep || phamViChoPhep.includes(s.value),
                            ).map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {fineActs && fineIsOpen && (
                        <div className="rdx-perm__fine" role="group" aria-label={`Quyền chi tiết — ${label}`}>
                          {fineActs.map((a) => {
                            const khoaO = khoaCua(a);
                            const dongO = dongCua(a);
                            const song = oSong(khoaO, a.key.replace("can_", ""));
                            const canhPhamVi = doiPhamViToanCty(khoaO, a.key) && dongO.scope !== "all";
                            // Ô bắt buộc theo Chỉnh sửa chỉ xét cho ô của CHÍNH dòng này.
                            const theoGhi = !a.mod && FINE_THEO_WRITE[row.module_key] === a.key && coDuongGhi;
                            return (
                            <label key={`${a.mod ?? ""}:${a.key}`} className="rdx-perm__fine-item">
                              <input
                                type="checkbox"
                                className="switch"
                                checked={fineOn(a) && song}
                                disabled={readOnly || !song || canhPhamVi || theoGhi}
                                title={
                                  theoGhi
                                    ? CANH_BAO_FINE_THEO_WRITE
                                    : canhPhamVi
                                      ? CANH_BAO_PHAM_VI
                                      : song
                                        ? a.hint
                                        : CANH_BAO_O_CHET
                                }
                                aria-label={`${a.label} — ${label}`}
                                onChange={(e) => {
                                  // Ô kèm phạm vi: tắt = hạ phạm vi dòng nguồn về "Của tôi", giữ Xem.
                                  if (a.phamVi && !e.target.checked) {
                                    onScope(khoaO, "own");
                                    return;
                                  }
                                  // Công tắc gộp → set TẤT CẢ cột trong `keys`; thường → 1 cột. Ô soi
                                  // ghi vào dòng nguồn (`mod`).
                                  (a.keys ?? [a.key]).forEach((k) =>
                                    onToggle(khoaO, k, e.target.checked),
                                  );
                                  if (a.phamVi) onScope(khoaO, a.phamVi);
                                }}
                              />
                              <span className="rdx-perm__fine-text">
                                {a.label}
                                {a.chung && <span className="rdx-perm__fine-chung">{a.chung}</span>}
                                {/* Nói RA MẶT lý do không bật được — nằm trong tooltip thì người
                                    cấp quyền phải rê chuột mới biết, mà họ có biết đâu mà rê. */}
                                {doiPhamViToanCty(row.module_key, a.key)
                                  && row.scope !== "all" && (
                                  <span className="rdx-perm__fine-warn" title={CANH_BAO_PHAM_VI}>
                                    cần Phạm vi “Tất cả”
                                  </span>
                                )}
                                {a.hint && (
                                  <HoverTip tieuDe={a.label} text={a.hint} />
                                )}
                              </span>
                            </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
