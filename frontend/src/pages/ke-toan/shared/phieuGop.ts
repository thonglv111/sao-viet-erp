/** Phiếu chi/thu GỘP nhiều chứng từ (17/10/2026: "một phiếu cho cả lượt"): một số phiếu, bên trong là
 *  bảng phân bổ `lines`. Phiếu lẻ có đúng một dòng (hoặc chưa trả `lines`) — mọi màn đọc như cũ. */
import type { PaymentReceiptLineRow, PaymentVoucherLineRow, PaymentVoucherRow } from "../../../api/client";

export const laGop = (row: { lines?: unknown[] | null }) => (row.lines?.length ?? 0) > 1;

/** "PMH-0009 cọc" / "PMH-0010 đợt 2" — tên một dòng của phiếu chi gộp. */
export const tenDongChi = (l: PaymentVoucherLineRow) =>
  `${l.purchase_code ?? ""} ${l.delivery_seq_no != null ? `đợt ${l.delivery_seq_no}` : "cọc"}`.trim();

/** "HĐ 0000123 đơn DH-0018" / "Cọc đơn DH-0021" — tên một dòng của phiếu thu gộp. */
export const tenDongThu = (l: PaymentReceiptLineRow) =>
  `${l.invoice_number ? `HĐ ${l.invoice_number}` : "Cọc"} đơn ${l.order_code ?? ""}`.trim();

/** Một phiếu chi nhìn từ MỘT đơn mua: phiếu lẻ là chính nó; phiếu gộp tách thành từng dòng của đơn
 *  đó (đầu phiếu gộp không có đợt — xếp theo `delivery_id` của phiếu thì nó rơi nhầm vào cọc). */
export type KhoanPhieuChi = { v: PaymentVoucherRow; deliveryId: number | null; amount: number; gop: boolean };

export function khoanPhieuChiCuaDon(donId: number, ds: PaymentVoucherRow[]): KhoanPhieuChi[] {
  return ds.flatMap((v): KhoanPhieuChi[] =>
    laGop(v)
      ? v.lines!.filter((l) => l.purchase_request_id === donId)
          .map((l) => ({ v, deliveryId: l.delivery_id, amount: l.amount, gop: true }))
      : [{ v, deliveryId: v.delivery_id, amount: v.amount_vnd, gop: false }],
  );
}
