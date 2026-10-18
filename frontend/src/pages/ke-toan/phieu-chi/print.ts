// In PHIẾU CHI / UNC theo mẫu 02-TT (tách từ pages/PaymentVouchersPage.tsx).
import type { PaymentVoucherRow } from "../../../api/client";
import { printTT200, type TT200Line } from "../../../utils/printTT200";
import { vietSo } from "../shared/dinhDang";
import { laGop, tenDongChi } from "../shared/phieuGop";
import { SOURCE_LABELS, STAGE_LABELS } from "./shared/list-constants";

/** Các dòng phụ in trên phiếu chi — chung cho bản in và bản xem trước trong form lập. */
export function dongPhuPhieuChi(
  row: Pick<
    PaymentVoucherRow,
    | "voucher_type" | "source_type" | "payment_stage" | "company_account_number" | "company_bank_name"
    | "beneficiary_account_number" | "beneficiary_bank_name" | "invoice_number" | "bank_reference"
  > & Pick<Partial<PaymentVoucherRow>, "muc_thu_chi_ten" | "delivery_seq_no" | "lines">,
): TT200Line[] {
  const isBank = row.voucher_type === "bank_transfer";
  return [
    // Mục chi (11/10/2026) thay dòng "Nguồn chi: Khác". Phiếu chưa phân loại thì chỉ in nguồn khi
    // nguồn nói được điều gì (đơn mua, tạm ứng, gia công); phiếu rời chưa có mục thì bỏ dòng.
    ...(row.muc_thu_chi_ten
      ? [{ label: "Mục chi", value: row.muc_thu_chi_ten }]
      : row.source_type !== "other"
        ? [{ label: "Nguồn chi", value: SOURCE_LABELS[row.source_type] ?? row.source_type }]
        : []),
    // Chỉ phiếu theo đơn mua mới có đợt thanh toán; phiếu rời, gia công, tạm ứng in "Khác" là thừa.
    // Phiếu trả tiền một đợt giao in số đợt: mọi phiếu trả đợt đều mang stage "final", in nhãn stage
    // thì phiếu Đợt 1 ghi "thanh toán cuối" trong khi Đợt 2 còn nợ.
    // Phiếu gộp (17/10/2026): mỗi khoản một dòng in — đơn, đợt/cọc, số hoá đơn, số tiền của khoản.
    ...(laGop(row)
      ? row.lines!.map((l, i) => ({
          label: `Khoản ${i + 1}`,
          value: `${tenDongChi(l)}${l.invoice_number ? ` hoá đơn ${l.invoice_number}` : ""} số tiền ${vietSo(l.amount)} đ`,
        }))
      : []),
    ...(row.source_type === "purchase_request" && !laGop(row)
      ? [{
          label: "Đợt thanh toán",
          value: row.payment_stage !== "advance" && row.delivery_seq_no
            ? `Đợt ${row.delivery_seq_no}`
            : STAGE_LABELS[row.payment_stage],
        }]
      : []),
    ...(isBank
      ? [
          {
            label: "Hình thức",
            value: `Chuyển khoản — trích TK ${row.company_account_number ?? "—"} tại ${row.company_bank_name ?? "—"} → TK thụ hưởng ${row.beneficiary_account_number ?? "—"} tại ${row.beneficiary_bank_name ?? "—"}`,
          },
        ]
      : []),
    ...(row.invoice_number ? [{ label: "Số chứng từ gốc", value: row.invoice_number }] : []),
    ...(row.bank_reference ? [{ label: "Mã giao dịch", value: row.bank_reference }] : []),
  ];
}

/** In Phiếu chi theo mẫu 02-TT. UNC cũng dùng mẫu này (chốt nghiệp vụ), chỉ ghi thêm
 *  dòng thông tin chuyển khoản. */
export function printVoucher(row: PaymentVoucherRow): boolean {
  const isBank = row.voucher_type === "bank_transfer";
  return printTT200({
    kind: "chi",
    docNo: row.doc_no,
    docDate: row.voucher_date,
    debitAccount: row.debit_account,
    creditAccount: row.credit_account,
    personName: isBank ? row.beneficiary_account_holder || row.supplier_name : row.cash_recipient_name,
    personAddress: isBank ? row.supplier_address : row.cash_recipient_address,
    reason: row.content,
    extraLines: dongPhuPhieuChi(row),
    amount: row.amount,
    amountVnd: row.amount_vnd,
    currency: row.currency,
    exchangeRate: row.exchange_rate,
    attachmentCount: row.attachment_count,
    cancelled: row.status === "cancelled",
  });
}
