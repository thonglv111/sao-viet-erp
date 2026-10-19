// In PHIẾU THU theo mẫu 01-TT (tách từ pages/PaymentReceiptsPage.tsx).
import type { PaymentReceiptRow } from "../../../api/client";
import { printTT200 } from "../../../utils/printTT200";
import { vietSo } from "../shared/dinhDang";
import { laGop, tenDongThu } from "../shared/phieuGop";
import { methodText, sourceCode, sourceLabel } from "./shared/helpers";

export function printReceipt(row: PaymentReceiptRow): boolean {
  const linkedSourceCode = sourceCode(row);
  return printTT200({
    kind: "thu",
    docNo: row.doc_no,
    docDate: row.receipt_date,
    debitAccount: row.debit_account,
    creditAccount: row.credit_account,
    personName: row.payer_name,
    personAddress: row.payer_address,
    reason: row.content,
    extraLines: [
      { label: "Hình thức", value: methodText(row) },
      ...(row.receipt_method === "bank_transfer"
        ? [
            {
              label: "Tài khoản nhận",
              value: `${row.company_account_number ?? "—"} tại ${row.company_bank_name ?? "—"}`,
            },
          ]
        : []),
      // Mục thu (11/10/2026) thay dòng "Nguồn thu: Khác". Phiếu chưa phân loại chỉ in nguồn khi nguồn
      // nói được điều gì (hoá đơn, cọc, thu lại tiền chi).
      ...(row.muc_thu_chi_ten
        ? [{ label: "Mục thu", value: row.muc_thu_chi_ten }]
        : row.source_type !== "other"
          ? [{ label: "Nguồn thu", value: sourceLabel(row) }]
          : []),
      ...(linkedSourceCode && !laGop(row) ? [{ label: "Mã nguồn", value: linkedSourceCode }] : []),
      // Phiếu gộp (17/10/2026): mỗi khoản một dòng in — hoá đơn/cọc, đơn, số tiền của khoản.
      ...(laGop(row)
        ? row.lines!.map((l, i) => ({ label: `Khoản ${i + 1}`, value: `${tenDongThu(l)} số tiền ${vietSo(l.amount)} đ` }))
        : []),
      ...(row.bank_reference ? [{ label: "Mã giao dịch", value: row.bank_reference }] : []),
    ],
    amount: row.amount,
    amountVnd: row.amount_vnd,
    currency: row.currency,
    exchangeRate: row.exchange_rate,
    attachmentCount: row.attachment_count,
    cancelled: row.status === "cancelled",
  });
}
