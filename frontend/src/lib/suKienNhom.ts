// Sự kiện thời gian thực chia theo NHÓM nghiệp vụ (sức chịu tải A3).
//
// Trước 28/09/2026 mọi sự kiện SSE tăng MỘT tick chung và ~45 màn nạp lại theo tick đó, bất kể sự
// kiện có liên quan không: một thợ ghi mẻ ở bàn tổ là màn Nghỉ phép, Phiếu chi, Báo giá của cả công
// ty cùng gọi lại API. Nay mỗi loại sự kiện thuộc một hay vài nhóm, mỗi màn chỉ nghe nhóm của nó.
//
// Thêm loại sự kiện mới ở máy chủ: khai vào BANG_NHOM. Quên khai thì `nhomCua` trả MỌI nhóm — thà
// nạp thừa còn hơn một màn đứng số cũ. Loại đã khai trong union `QuoteEvent` mà thiếu ở bảng thì
// `tsc` báo lỗi ngay (kiểu của BANG_NHOM bắt buộc đủ khoá).
import type { QuoteEvent } from "../api/client";

export type NhomSuKien =
  | "ban_hang"
  | "mua_ke_toan"
  | "nhan_su"
  | "san_xuat"
  | "kho"
  | "giao_hang"
  | "ky_thuat"
  | "khvt"
  | "danh_muc";

export const MOI_NHOM: readonly NhomSuKien[] = [
  "ban_hang",
  "mua_ke_toan",
  "nhan_su",
  "san_xuat",
  "kho",
  "giao_hang",
  "ky_thuat",
  "khvt",
  "danh_muc",
];

/** Loại sự kiện → nhóm. Mảng RỖNG = sự kiện có đường riêng (quyền, nhật ký, đếm theo id), không
 *  bump tick màn nào. */
const BANG_NHOM: Record<QuoteEvent["type"], readonly NhomSuKien[]> &
  Record<string, readonly NhomSuKien[]> = {
  // Có đường riêng trong AppShell — không bump tick.
  quyen_doi: [],
  // Hàng đợi tràn ⇒ AppShell tự nhích MỌI nhóm + nạp lại badge (như lúc kênh nối lại).
  dong_bo_lai: [],
  nhat_ky_moi: [],
  // Chấm đỏ thanh bên: AppShell hỏi lại tóm tắt, không màn nào phải nạp lại.
  thong_bao_man: [],
  notification_new: [],
  cay_to_doi: [],
  // Máy chủ gửi đích danh tổ của bước (`kem_ban_to`) ⇒ chỉ bàn tổ đó nạp lại cột Vật tư.
  san_xuat_vat_tu_de_nghi_changed: ["san_xuat"],
  lsx_dinh_kem_changed: [],

  // Bán hàng: báo giá · đơn · chăm sóc khách.
  quote_decision: ["ban_hang"],
  quote_pending_changed: ["ban_hang"],
  order_deposit_ok: ["ban_hang", "mua_ke_toan"],
  order_pending_changed: ["ban_hang"],
  order_deposit_needed: ["ban_hang", "mua_ke_toan"],
  care_due: ["ban_hang"],
  care_assigned: ["ban_hang"],
  care_moved: ["ban_hang"],
  // Đơn chốt xuống sản xuất: hàng chờ Kế hoạch SX + bước "Sản xuất" ở Đơn hàng.
  order_ordered: ["ban_hang", "san_xuat"],
  order_sx_hint_changed: ["ban_hang", "san_xuat"],

  // Nhân sự: nghỉ phép · tăng ca · chấm công · tạm ứng lương.
  advance_pending_changed: ["nhan_su"],
  khoan_theo_to_changed: ["nhan_su"],
  advance_decision: ["nhan_su"],
  ot_pending_changed: ["nhan_su"],
  ot_decision: ["nhan_su"],
  leave_pending_changed: ["nhan_su"],
  leave_decision: ["nhan_su"],
  profile_request_decision: ["nhan_su"],
  el_pending_changed: ["nhan_su"],
  el_decision: ["nhan_su"],
  adjust_pending_changed: ["nhan_su"],
  adjust_decision: ["nhan_su"],
  phieu_luong_cong_bo: ["nhan_su"],
  phieu_luong_thu_hoi: ["nhan_su"],
  shift_changed: ["nhan_su"],

  // Sản xuất: lệnh · bài ghép · xếp lịch · bàn tổ · KCS.
  lenh_sx_routing: ["san_xuat"],
  lenh_sx_assigned: ["san_xuat"],
  lenh_sx_phat: ["san_xuat"],
  lenh_sx_duyet_mau: ["san_xuat"],
  lenh_sx_ban_giao: ["san_xuat"],
  lenh_sx_qc_loi: ["san_xuat"],
  // Lệnh đổi ⇒ hàng chờ, bước Sản xuất của Đơn hàng, và nhu cầu vật tư đều đổi.
  lsx_changed: ["san_xuat", "ban_hang", "khvt"],
  bai_ghep_changed: ["san_xuat", "khvt"],
  xep_lich_changed: ["san_xuat", "khvt"],
  san_xuat_changed: ["san_xuat"],
  san_xuat_cong_viec_changed: ["san_xuat"],
  san_xuat_duoc_giao_viec: ["san_xuat"],
  san_xuat_may_hu_to_khac: ["san_xuat"],
  san_xuat_ban_giao_changed: ["san_xuat"],
  san_xuat_ban_giao: ["san_xuat"],
  san_xuat_kcs_changed: ["san_xuat"],
  san_xuat_kcs_ket_qua: ["san_xuat"],
  // KCS gửi thành phẩm nhập kho: màn KCS / hồ sơ lệnh + màn Kho.
  san_xuat_kho_changed: ["san_xuat", "kho"],
  san_xuat_kho: ["san_xuat", "kho"],
  san_xuat_lenh_dong: ["san_xuat", "ban_hang", "giao_hang"],
  gia_cong_ngoai_changed: ["san_xuat"],

  // Mua hàng · kế toán.
  purchase_changed: ["mua_ke_toan", "khvt"],
  accounting_changed: ["mua_ke_toan"],
  department_purchase_request_created: ["mua_ke_toan", "khvt"],
  sales_invoice_created: ["mua_ke_toan", "ban_hang"],
  sales_invoice_cancelled: ["mua_ke_toan", "ban_hang"],
  sales_invoice_receipt_created: ["mua_ke_toan", "ban_hang"],
  purchase_pending_approval: ["mua_ke_toan", "khvt"],
  purchase_decision: ["mua_ke_toan", "khvt"],
  purchase_delivery_created: ["mua_ke_toan", "khvt"],
  purchase_delivery_updated: ["mua_ke_toan", "khvt"],
  purchase_delivery_deleted: ["mua_ke_toan", "khvt"],
  purchase_invoice_updated: ["mua_ke_toan"],
  payment_voucher_created: ["mua_ke_toan"],
  payment_voucher_cancelled: ["mua_ke_toan"],
  gia_cong_cho_chi: ["mua_ke_toan"],
  gia_cong_cho_chi_changed: ["mua_ke_toan"],

  // Kho.
  stock_request: ["kho"],
  stock_request_pending_changed: ["kho"],

  // Giao hàng (drawer Đơn hàng cũng bày tiến độ giao).
  giao_hang_chuyen: ["giao_hang", "ban_hang"],
  giao_hang_changed: ["giao_hang", "ban_hang"],

  // Kỹ thuật máy.
  ky_thuat_yeu_cau_moi: ["ky_thuat"],
  ky_thuat_phieu_bao_lai: ["ky_thuat"],
  ky_thuat_yeu_cau_ket_qua: ["ky_thuat"],
  bao_tri_due: ["ky_thuat"],

  // Kế hoạch vật tư (giữ chỗ đổi ⇒ đèn vật tư ở Kế hoạch SX cũng đổi).
  ke_hoach_vat_tu_thay_doi: ["khvt", "san_xuat"],

  // Danh mục nguồn của phiếu tính giá đổi ⇒ màn phiếu đang mở nạp lại danh mục.
  danh_muc_doi: ["danh_muc"],
};

/** Nhóm của một loại sự kiện. Loại LẠ (máy chủ thêm mà bảng chưa khai) ⇒ mọi nhóm. */
export function nhomCua(type: string): readonly NhomSuKien[] {
  return Object.prototype.hasOwnProperty.call(BANG_NHOM, type) ? BANG_NHOM[type] : MOI_NHOM;
}

export type TickNhom = Record<NhomSuKien, number>;

export function tickRong(): TickNhom {
  return {
    ban_hang: 0, mua_ke_toan: 0, nhan_su: 0, san_xuat: 0, kho: 0, giao_hang: 0, ky_thuat: 0, khvt: 0,
    danh_muc: 0,
  };
}

/** Tick của một màn = tổng tick các nhóm nó nghe. Mỗi tick chỉ tăng nên tổng đổi ⇔ có nhóm nhích. */
export function tongTick(tick: TickNhom, nhom: readonly NhomSuKien[]): number {
  let n = 0;
  for (const g of nhom) n += tick[g];
  return n;
}

/** Bộ GỘP NHỊP: sự kiện chỉ đánh dấu nhóm "bẩn"; `choMs` sau sự kiện ĐẦU mới xả một lần cho mọi
 *  nhóm bẩn (cửa sổ cố định, không lùi mãi khi sự kiện dồn liên tục). Tab ĐANG ẨN thì chỉ đánh dấu,
 *  gọi `khiHien()` lúc tab hiện lại để xả một lần. */
export function taoBoGopNhip(opts: {
  choMs: number;
  dangAn: () => boolean;
  xa: (nhom: NhomSuKien[]) => void;
}) {
  const ban = new Set<NhomSuKien>();
  let hen: ReturnType<typeof setTimeout> | null = null;
  const xaHet = () => {
    if (hen) {
      clearTimeout(hen);
      hen = null;
    }
    if (ban.size === 0) return false;
    const ds = [...ban];
    ban.clear();
    opts.xa(ds);
    return true;
  };
  return {
    danhDau(nhom: readonly NhomSuKien[]): void {
      if (nhom.length === 0) return;
      for (const g of nhom) ban.add(g);
      if (opts.dangAn() || hen) return;
      hen = setTimeout(() => {
        hen = null;
        if (opts.dangAn()) return; // ẩn giữa chừng — giữ nguyên dấu bẩn chờ `khiHien`
        xaHet();
      }, opts.choMs);
    },
    /** Tab vừa hiện lại: xả ngay mọi nhóm bẩn. Trả `true` nếu có nhóm nào bẩn. */
    khiHien(): boolean {
      return xaHet();
    },
    huy(): void {
      if (hen) clearTimeout(hen);
      hen = null;
      ban.clear();
    },
  };
}

/** Hoãn-gộp theo KHOÁ: nhiều lượt gọi cùng khoá trong `ms` (tính từ lượt đầu) thành MỘT lượt chạy ở
 *  cuối cửa sổ, dùng hàm của lượt gọi CUỐI (closure mới nhất). */
export function taoHoanNap() {
  const cho = new Map<string, { fn: () => void; hen: ReturnType<typeof setTimeout> }>();
  const hoanNap = (khoa: string, fn: () => void, ms = 800): void => {
    const cu = cho.get(khoa);
    if (cu) {
      cu.fn = fn;
      return;
    }
    const muc = {
      fn,
      hen: setTimeout(() => {
        cho.delete(khoa);
        muc.fn();
      }, ms),
    };
    cho.set(khoa, muc);
  };
  const huy = () => {
    for (const m of cho.values()) clearTimeout(m.hen);
    cho.clear();
  };
  return { hoanNap, huy };
}
