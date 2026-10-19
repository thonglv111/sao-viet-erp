/** Luật chặn TIỀN của form lập phiếu chi theo đơn mua (PC-4) — trần cọc, trần đợt, hết chỗ chi,
 *  bắt buộc chọn đợt. Câu chữ giữ nguyên bản cũ; lỗi nay gom theo ô thay vì dừng ở câu đầu. */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PaymentVoucherBaseInput, PurchaseRequestRow } from "../../../api/client";
import { kiemTraPhieuTheoDon } from "./shared/helpers";

const createVoucher = vi.fn();
vi.mock("../../../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));
vi.mock("../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../api/client")>()),
  api: {
    accounting: {
      companyAccounts: vi.fn().mockResolvedValue([]),
      createVoucher: (...a: unknown[]) => createVoucher(...a),
      uploadVoucherAttachment: vi.fn(),
    },
  },
}));

import { PaymentVoucherDialog } from "./PaymentVoucherDialog";

const FORM: PaymentVoucherBaseInput = {
  voucher_type: "cash",
  payment_stage: "final",
  delivery_id: 11,
  voucher_date: "2026-10-01",
  amount: 1_000_000,
  currency: "VND",
  exchange_rate: 1,
  content: "Thanh toán DMH-1",
  cash_recipient_name: "Giấy Bình Minh",
};

const dot = (id: number, seq: number, con_no: number) => ({
  id, seq_no: seq, con_no, amount: con_no, paid_amount: 0, coc_bu: 0, delivery_date: "2026-09-28",
  invoice_number: null, invoice_date: null, due_date: null, chua_dat_han: false, da_nhap_kho: false, kho: "cho_gui_kho",
  stock_request_id: null, stock_request_ma: null, note: null, created_by_name: null, created_at: null, lines: [],
});

function don(p: Partial<PurchaseRequestRow>): PurchaseRequestRow {
  return {
    id: 1, code: "DMH-1", supplier_name: "Giấy Bình Minh", deliveries: [], tran_dat_coc: 0,
    total_estimate: 4_000_000, gia_tri_da_giao: 0, net_paid: 0, outstanding_amount: 0,
    coc_da_lap: [], coc_da_chi: 0, deposit_expected: 0, content: "Giấy C150", purpose: null,
    ...p,
  } as unknown as PurchaseRequestRow;
}

describe("kiemTraPhieuTheoDon", () => {
  it("đặt cọc vượt trần: câu trần đặt cọc gắn vào ô Số tiền", () => {
    const l = kiemTraPhieuTheoDon({
      form: { ...FORM, payment_stage: "advance", delivery_id: null, amount: 1_500_000 },
      loai: "dat_coc", coDotGiao: false, maxAmountVnd: 1_000_000, amountVnd: 1_500_000,
    });
    expect(l.amount).toBe("Số tiền quy đổi không được vượt quá 1.000.000 đ (trần đặt cọc theo giá trị đơn đặt).");
  });

  it("thanh toán vượt còn nợ của đợt: câu công nợ hiện tại", () => {
    const l = kiemTraPhieuTheoDon({ form: { ...FORM, amount: 3_500_000 }, loai: "thanh_toan", coDotGiao: true,
      maxAmountVnd: 3_000_000, amountVnd: 3_500_000 });
    expect(l.amount).toBe("Số tiền quy đổi không được vượt quá 3.000.000 đ (công nợ hiện tại).");
  });

  it("hết chỗ chi (trần ≤ 0): câu riêng cho cọc và cho thanh toán", () => {
    expect(kiemTraPhieuTheoDon({ form: FORM, loai: "dat_coc", coDotGiao: false, maxAmountVnd: 0, amountVnd: 1_000_000 }).amount)
      .toBe("Đơn này đã chi đủ giá trị đặt hàng — không còn chỗ để đặt cọc thêm.");
    expect(kiemTraPhieuTheoDon({ form: FORM, loai: "thanh_toan", coDotGiao: true, maxAmountVnd: 0, amountVnd: 1_000_000 }).amount)
      .toBe("Đơn này chưa phát sinh công nợ (hàng chưa về hoặc đã trả hết). Ghi đợt giao trước, hoặc lập phiếu Đặt cọc.");
  });

  it("đơn có đợt mà phiếu thanh toán chưa chọn đợt: lỗi ở ô Đợt giao", () => {
    const l = kiemTraPhieuTheoDon({ form: { ...FORM, delivery_id: null }, loai: "thanh_toan", coDotGiao: true,
      maxAmountVnd: 5_000_000, amountVnd: 1_000_000 });
    expect(l.delivery_id).toBe("Phiếu thanh toán phải chọn đợt giao.");
    expect(l.amount).toBeUndefined();
  });

  it("số tiền hoặc tỷ giá đã sai thì không báo thêm câu trần (một lỗi một ô)", () => {
    const l = kiemTraPhieuTheoDon({ form: { ...FORM, amount: 0 }, loai: "thanh_toan", coDotGiao: true,
      maxAmountVnd: 0, amountVnd: 0 });
    expect(l.amount).toBe("Số tiền thanh toán phải lớn hơn 0.");
    const vnd = kiemTraPhieuTheoDon({ form: { ...FORM, exchange_rate: 2 }, loai: "thanh_toan", coDotGiao: true,
      maxAmountVnd: 1, amountVnd: 2_000_000 });
    expect(vnd.exchange_rate).toBe("Tỷ giá của VND phải bằng 1.");
    expect(vnd.amount).toBeUndefined();
  });

  it("hợp lệ thì không có lỗi nào", () => {
    const l = kiemTraPhieuTheoDon({ form: FORM, loai: "thanh_toan", coDotGiao: true, maxAmountVnd: 3_000_000, amountVnd: 1_000_000 });
    expect(Object.values(l).filter(Boolean)).toEqual([]);
  });
});

describe("PaymentVoucherDialog — nối trần vào form", () => {
  beforeEach(() => createVoucher.mockReset());

  it("đợt chọn sẵn còn nợ 3.000.000: gõ 3.500.000 thì báo tại ô ngay khi gõ, khoá nút, không gọi máy chủ", async () => {
    const u = userEvent.setup();
    render(<PaymentVoucherDialog purchase={don({ deliveries: [dot(11, 1, 3_000_000), dot(12, 2, 2_000_000)] as never })}
      onClose={() => {}} onSaved={() => {}} />);
    const o = screen.getByLabelText(/Số tiền/);
    expect(o).toHaveValue("3.000.000");
    await u.clear(o);
    await u.type(o, "3500000");
    // Câu của luật chặn hiện ngay khi gõ, nút lập khoá.
    expect(screen.getByText("Số tiền quy đổi không được vượt quá 3.000.000 đ (công nợ hiện tại).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lập phiếu chi" })).toBeDisabled();
    expect(createVoucher).not.toHaveBeenCalled();
  });

  it("bấm CHI CỌC trên đơn đã có đợt giao: mở sẵn loại Đặt cọc, điền cọc còn chi được (không phải nợ đợt)", () => {
    render(<PaymentVoucherDialog coc
      purchase={don({ deliveries: [dot(11, 1, 3_000_000)] as never, deposit_expected: 1_200_000, tran_dat_coc: 1_200_000 })}
      onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole("button", { name: /Đặt cọc hoặc ứng trước/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Trả tiền hàng đã giao/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText(/Số tiền/)).toHaveValue("1.200.000");
  });

  it("thẻ đợt: ngày nhận hàng tách khỏi ngày hoá đơn, ký hiệu là một thẻ riêng", () => {
    const coHd = { ...dot(11, 1, 3_000_000), invoice_number: "0000123", invoice_symbol: "1C26TAA", invoice_date: "2026-10-10" };
    render(<PaymentVoucherDialog purchase={don({ deliveries: [coHd, dot(12, 2, 2_000_000)] as never })}
      onClose={() => {}} onSaved={() => {}} />);
    const the1 = screen.getByRole("radio", { name: /Đợt 1/ });
    expect(within(the1).getByText("Nhận hàng 28/09/2026")).toBeInTheDocument();
    expect(within(the1).getByText("Số hoá đơn 0000123")).toBeInTheDocument();
    expect(within(the1).getByText("Ký hiệu 1C26TAA")).toBeInTheDocument();
    expect(within(the1).getByText("Ngày hoá đơn 10/10/2026")).toBeInTheDocument();
    expect(within(screen.getByRole("radio", { name: /Đợt 2/ })).getByText("Chưa có hoá đơn")).toBeInTheDocument();
  });
});
