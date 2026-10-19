// Hàm dùng chung của màn Phiếu chi (tách từ pages/PaymentVoucherDialog.tsx).
import type {
  PaymentVoucherBaseInput,
  PaymentVoucherRow,
  PurchaseRequestRow,
} from "../../../../api/client";
import { homNayVN } from "../../../../utils/ky";
import type { LoaiPhieu } from "./types";

/** Hôm nay `yyyy-mm-dd` theo giờ Việt Nam, tính LÚC GỌI (đặc tả A.14 — bản cũ lấy ngày UTC nên
 *  từ 0h tới 7h sáng ra ngày hôm qua). */
export function isoToday(): string {
  return homNayVN();
}

/** "05/10/2026 10:02" — chuyển vào kit (`shared/dinhDang.ts`), giữ tên cũ cho nơi đang gọi. */
export { ngayGio } from "../../shared/dinhDang";

export function optional(value?: string | null): string | null {
  const cleaned = (value ?? "").trim();
  return cleaned || null;
}

/** Đợt giao CÒN NỢ đầu tiên — gợi ý mặc định khi lập phiếu thanh toán.
 *
 *  Dùng `con_no` (đã trừ cả tiền trả đích danh lẫn cọc bù) chứ không tự trừ tay: đợt được cọc phủ
 *  hết thì không còn gì để trả, chọn sẵn nó là mời người dùng gõ một số rồi ăn lỗi. */
export function dotGoiY(purchase: PurchaseRequestRow): number | null {
  const con_no = purchase.deliveries.filter((d) => d.con_no > 0);
  const nguon = con_no.length ? con_no : purchase.deliveries;
  return nguon[0]?.id ?? null;
}

/** Còn nợ của một đợt — cũng chính là TRẦN lập phiếu chi thanh toán cho đợt đó. */
export function conNoDot(purchase: PurchaseRequestRow, deliveryId: number | null): number {
  if (deliveryId == null) return purchase.outstanding_amount;
  return purchase.deliveries.find((d) => d.id === deliveryId)?.con_no ?? 0;
}

/** Số tiền điền sẵn cho phiếu ĐẶT CỌC.
 *
 * Ưu tiên **cọc dự kiến** thu mua đã khai trên phiếu mua — đó là con số đã thoả thuận với NCC và
 * đã qua duyệt, kế toán không phải đi hỏi lại.
 *
 * Chưa khai (bằng 0) thì lấy **nửa giá trị đơn** (chủ chốt 06/08/2026) — mức cọc thông thường, để
 * kế toán có sẵn một số hợp lý mà sửa, thay vì đối diện ô trống hoặc bị điền nguyên giá trị đơn
 * (điền nguyên đơn là mời người ta bấm Lưu và ứng trước 100%).
 *
 * Luôn kẹp trong trần đặt cọc — gợi ý mà vượt trần thì bấm Lưu là ăn lỗi ngay. */
/** Nội dung đơn để nhét vào nội dung phiếu chi. Phiếu CŨ chưa có ô gộp ⇒ lấy `purpose`. */
export function moTaDon(purchase: PurchaseRequestRow): string {
  return (purchase.content ?? purchase.purpose ?? "").trim();
}

export function cocGoiY(purchase: PurchaseRequestRow): number {
  const mong_muon =
    purchase.deposit_expected > 0
      ? purchase.deposit_expected
      : Math.round(purchase.total_estimate / 2);
  return Math.min(mong_muon, purchase.tran_dat_coc);
}

export function initialForm(
  purchase: PurchaseRequestRow,
  voucher?: PaymentVoucherRow | null,
  /** Đợt bấm "Lập phiếu chi" ngay tại dòng đợt (ngăn đơn, tab Thanh toán) — gắn sẵn đúng đợt đó. */
  dotId?: number | null,
  /** Bấm đúng nút CHI CỌC (tab "Mua hàng chờ chi") ⇒ mở loại Đặt cọc dù đơn đã có đợt giao. Không
   *  có cờ này thì đơn có đợt mặc định "Thanh toán" — người bấm "chi cọc" phải tự đổi loại. */
  coc = false,
): PaymentVoucherBaseInput {
  if (voucher) {
    return {
      voucher_type: voucher.voucher_type,
      payment_stage: voucher.payment_stage,
      delivery_id: voucher.delivery_id,
      voucher_date: voucher.voucher_date,
      planned_payment_date: voucher.planned_payment_date,
      amount: voucher.amount,
      currency: voucher.currency,
      exchange_rate: voucher.exchange_rate,
      content: voucher.content,
      invoice_number: voucher.invoice_number,
      invoice_date: voucher.invoice_date,
      contract_number: voucher.contract_number,
      company_bank_account_id: voucher.company_bank_account_id,
      supplier_bank_account_id: voucher.supplier_bank_account_id,
      beneficiary_account_holder: voucher.beneficiary_account_holder,
      beneficiary_account_number: voucher.beneficiary_account_number,
      beneficiary_bank_name: voucher.beneficiary_bank_name,
      beneficiary_bank_branch: voucher.beneficiary_bank_branch,
      cash_recipient_name: voucher.cash_recipient_name,
      cash_recipient_address: voucher.cash_recipient_address,
      cash_recipient_identity: voucher.cash_recipient_identity,
      bank_fee_bearer: voucher.bank_fee_bearer ?? "payer",
      debit_account: voucher.debit_account,
      credit_account: voucher.credit_account,
      note: voucher.note,
    };
  }
  // Chưa có đợt giao nào ⇒ hàng chưa về ⇒ đây chỉ có thể là tiền ĐẶT CỌC (hoặc người bấm đúng nút chi
  // cọc). Có đợt rồi thì mặc định là THANH TOÁN, gắn sẵn đợt còn nợ và điền sẵn số công nợ.
  const laCoc = coc || purchase.deliveries.length === 0;
  const dot = dotId != null && purchase.deliveries.some((d) => d.id === dotId) ? dotId : dotGoiY(purchase);
  return {
    voucher_type: "cash",
    payment_stage: laCoc ? "advance" : "final",
    delivery_id: laCoc ? null : dot,
    voucher_date: isoToday(),
    // DORMANT: hạn trả đã chuyển lên đợt giao, phiếu chi không còn hạn.
    planned_payment_date: null,
    amount: laCoc
      ? cocGoiY(purchase)
      : conNoDot(purchase, dot),
    currency: "VND",
    exchange_rate: 1,
    content: `Thanh toán ${purchase.code}${
      moTaDon(purchase) ? ` - ${moTaDon(purchase)}` : ""
    }`.slice(0, 500),
    invoice_number: null,
    // Chứng từ gốc thường mang ngày hôm nay — điền sẵn, chỉ gửi đi khi có Số chứng từ.
    invoice_date: isoToday(),
    contract_number: null,
    company_bank_account_id: null,
    supplier_bank_account_id: null,
    beneficiary_account_holder: purchase.supplier_name ?? "",
    beneficiary_account_number: null,
    beneficiary_bank_name: null,
    beneficiary_bank_branch: null,
    cash_recipient_name: purchase.supplier_name ?? "",
    cash_recipient_address: null,
    cash_recipient_identity: null,
    bank_fee_bearer: "payer",
    debit_account: null,
    credit_account: null,
    note: null,
  };
}

/** Luật chặn của form lập phiếu chi THEO ĐƠN MUA (PC-4), gom THEO Ô (đặc tả A.2) thay vì dừng ở câu
 *  đầu. ⚠️ TIỀN THẬT: luật và câu chữ phần tiền (trần cọc, trần đợt, tỷ giá, đợt giao) giữ nguyên
 *  bản trước 06/10/2026; máy chủ vẫn kiểm lại tất cả. Ngày chi và khối chuyển khoản do form ghép
 *  thêm (`loiNgayChi`, `loiChuyenKhoan` — luật chung ba form).
 *
 *  Trần chỉ được xét khi Số tiền và Tỷ giá đã hợp lệ: số sai thì một ô một lỗi, form vẫn bị chặn. */
export function kiemTraPhieuTheoDon({
  form,
  loai,
  coDotGiao,
  maxAmountVnd,
  amountVnd,
}: {
  form: PaymentVoucherBaseInput;
  loai: LoaiPhieu;
  coDotGiao: boolean;
  maxAmountVnd: number;
  amountVnd: number;
}): Partial<Record<string, string>> {
  const l: Partial<Record<string, string>> = {};
  if (!form.content.trim()) l.content = "Ghi nội dung chi.";
  if (!Number.isFinite(form.amount) || form.amount <= 0) {
    l.amount = "Số tiền thanh toán phải lớn hơn 0.";
  }
  if (!Number.isFinite(form.exchange_rate) || form.exchange_rate <= 0) {
    l.exchange_rate = "Tỷ giá phải lớn hơn 0.";
  } else if (form.currency.trim().toUpperCase() === "VND" && form.exchange_rate !== 1) {
    l.exchange_rate = "Tỷ giá của VND phải bằng 1.";
  }
  if (!l.amount && !l.exchange_rate) {
    if (maxAmountVnd <= 0) {
      l.amount =
        loai === "dat_coc"
          ? "Đơn này đã chi đủ giá trị đặt hàng — không còn chỗ để đặt cọc thêm."
          : "Đơn này chưa phát sinh công nợ (hàng chưa về hoặc đã trả hết). Ghi đợt giao trước, hoặc lập phiếu Đặt cọc.";
    } else if (amountVnd > maxAmountVnd) {
      l.amount =
        `Số tiền quy đổi không được vượt quá ${maxAmountVnd.toLocaleString("vi-VN")} đ ` +
        `(${loai === "dat_coc" ? "trần đặt cọc theo giá trị đơn đặt" : "công nợ hiện tại"}).`;
    }
  }
  // Đơn CÓ đợt giao thì phiếu thanh toán bắt buộc chỉ rõ trả cho đợt nào — không có nó thì công
  // nợ biết TỔNG đã trả nhưng không biết đợt nào đã xong, và cột Quá hạn (tính theo hạn của từng
  // đợt) không quy được về đâu. Server cũng chặn; đây chỉ chặn sớm cho đỡ một vòng gọi.
  if (loai === "thanh_toan" && coDotGiao && !form.delivery_id) {
    l.delivery_id = "Phiếu thanh toán phải chọn đợt giao.";
  }
  if (form.voucher_type === "cash" && !form.cash_recipient_name?.trim()) {
    l.cash_recipient_name = "Phiếu chi phải có người nhận tiền.";
  }
  return l;
}
