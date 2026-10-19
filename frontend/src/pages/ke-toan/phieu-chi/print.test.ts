import { describe, expect, it } from "vitest";
import { dongPhuPhieuChi } from "./print";

const goc = {
  voucher_type: "cash" as const,
  source_type: "purchase_request" as const,
  company_account_number: null,
  company_bank_name: null,
  beneficiary_account_number: null,
  beneficiary_bank_name: null,
  invoice_number: null,
  bank_reference: null,
};
const dot = (row: Parameters<typeof dongPhuPhieuChi>[0]) =>
  dongPhuPhieuChi(row).find((l) => l.label === "Đợt thanh toán")?.value;

describe("dongPhuPhieuChi — dòng Đợt thanh toán", () => {
  it("phiếu trả một đợt giao in số đợt, không in 'thanh toán cuối' khi đợt sau còn nợ", () => {
    expect(dot({ ...goc, payment_stage: "final", delivery_seq_no: 1 })).toBe("Đợt 1");
  });
  it("phiếu cọc vẫn in đặt cọc dù có số đợt", () => {
    expect(dot({ ...goc, payment_stage: "advance", delivery_seq_no: 1 })).toBe("Tạm ứng / đặt cọc");
  });
  it("phiếu cũ không theo đợt in nhãn tiền hàng", () => {
    expect(dot({ ...goc, payment_stage: "final", delivery_seq_no: null })).toBe("Thanh toán tiền hàng");
  });
});

describe("dongPhuPhieuChi — phiếu gộp", () => {
  it("mỗi khoản một dòng in, không in Đợt thanh toán", () => {
    const dong = dongPhuPhieuChi({
      ...goc, payment_stage: "final", delivery_seq_no: null,
      lines: [
        { purchase_request_id: 9, purchase_code: "PMH-0009", delivery_id: null, delivery_seq_no: null, invoice_number: null, amount: 500_000 },
        { purchase_request_id: 10, purchase_code: "PMH-0010", delivery_id: 31, delivery_seq_no: 1, invoice_number: "88", amount: 764_000 },
      ],
    });
    expect(dong.find((l) => l.label === "Đợt thanh toán")).toBeUndefined();
    expect(dong.filter((l) => l.label.startsWith("Khoản"))).toEqual([
      { label: "Khoản 1", value: "PMH-0009 cọc số tiền 500.000 đ" },
      { label: "Khoản 2", value: "PMH-0010 đợt 1 hoá đơn 88 số tiền 764.000 đ" },
    ]);
  });
});
