// Hằng của MÀN DANH SÁCH Phiếu chi (tách từ pages/PaymentVouchersPage.tsx).
// ⚠️ File này CỐ Ý tách khỏi ./constants.ts: cả hai đều có `STAGE_LABELS` nhưng KHÁC KIỂU —
// bản của hộp lập phiếu là `Record<PaymentStage, string>`, bản dưới đây là `as const`.
// Gộp lại là đổi kiểu của một trong hai, nên giữ hai bản đúng như bản gốc.
import type {
  PaymentVoucherRow as PaymentVoucherRowNguon,
  PaymentVoucherSource,
  PaymentVoucherStatus,
  PaymentVoucherType,
} from "../../../../api/client";

/** Cỡ trang MẶC ĐỊNH — người dùng đổi ở ô Dòng/trang dưới chân bảng. */
export const PAGE_SIZE = 25;

/** Chỉ còn HAI trạng thái từ 06/08/2026 (Đ1): lập phiếu chi = tiền đã ra. Bậc "Chờ chi" và nút
 *  "Xác nhận đã chi" đã bỏ hẳn — bên nghiệp vụ nói thẳng *"tạo phiếu chi là đã chi tiền rồi còn
 *  công nợ cái gì"*. Phiếu ghi nhận nhầm thì HUỶ (bắt lý do), không lùi về chờ. */
export const STATUS_META: Record<
  PaymentVoucherStatus,
  { label: string; tone: string }
> = {
  paid: { label: "Đã chi", tone: "paid" },
  cancelled: { label: "Đã hủy", tone: "cancelled" },
};

export const STAGE_LABELS = {
  advance: "Tạm ứng / đặt cọc",
  partial: "Thanh toán một phần",
  final: "Thanh toán tiền hàng",
  other: "Khác",
} as const;

export const SOURCE_LABELS: Record<PaymentVoucherSource, string> = {
  // Viết đủ, không viết tắt (đặc tả A.4) — "Đơn mua", "Gia công" khớp bộ lọc Nguồn chi.
  purchase_request: "Đơn mua",
  // Phiếu chi lập từ màn Tạm ứng (Lương). Mã nguồn in trên chứng từ là MÃ PHIẾU TẠM ỨNG
  // (TU-…/L1-…) nên tra ngược từ sổ quỹ về phiếu đã duyệt bằng ô tìm kiếm là ra.
  salary_advance: "Tạm ứng lương",
  gia_cong_ngoai: "Gia công",
  internal_expense: "Khác",
  customer_refund: "Trả lại tiền khách",
  other: "Khác",
};

export const VOUCHER_METHOD_LABELS: Record<PaymentVoucherType, string> = {
  cash: "Tiền mặt",
  bank_transfer: "Chuyển khoản",
};

/** Nguồn của một phiếu để HIỆN (cột "Chi theo"): nhãn loại và mã nguồn nếu có. Phiếu đặt cọc của
 *  đơn mua mang nhãn riêng "Cọc đơn mua" (phương án A, 07/10/2026). Phiếu nguồn "Khác" không có mã —
 *  máy chủ để nhãn nguồn vào chỗ mã, không hiện lại lần hai. */
export function nguonPhieu(row: Pick<PaymentVoucherRowNguon, "source_type" | "payment_stage" | "purchase_request_code">): {
  loai: string;
  ma: string | null;
} {
  const coMa = row.source_type === "purchase_request" || row.source_type === "gia_cong_ngoai"
    || row.source_type === "salary_advance";
  const coc = row.source_type === "purchase_request" && row.payment_stage === "advance";
  return {
    loai: coc ? "Cọc đơn mua" : SOURCE_LABELS[row.source_type] ?? row.source_type,
    ma: coMa && row.purchase_request_code ? row.purchase_request_code : null,
  };
}
