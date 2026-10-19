/** Ngăn phiếu thu kiểu 3 (phương án A): số tiền làm tiêu đề, cột thuộc tính bên phải, bảng "Áp vào
 *  hoá đơn" có Thu trước đó / Còn nợ từ máy chủ; menu Hủy nói hệ quả lên hoá đơn / đơn bán; phiếu cọc
 *  đã thu hủy được ngay tại ngăn (06/10/2026); phiếu cũ chờ thu có khung "Xác nhận đã thu" tại chỗ. */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PaymentReceiptRow } from "../../../../api/client";
import { phieuThu } from "./phieuMau";

const HD = {
  id: 7, order_id: 40, order_code: "DH-0412", customer_id: 12, customer_name: "Thực phẩm An Phát",
  invoice_symbol: "1C26TSV", invoice_number: "0001234", invoice_date: "2026-09-22", amount_vnd: 96_000_000,
  payment_term_days_snapshot: 30, due_date: "2026-10-22", status: "issued", direct_received_amount: 32_000_000,
  deposit_offset_amount: 20_000_000, received_amount: 52_000_000, remaining_amount: 44_000_000,
  created_by_user_id: 1, created_by_name: "Phạm Thu Trang", created_at: "2026-09-22T02:00:00Z",
  cancelled_by_user_id: null, cancelled_by_name: null, cancelled_at: null, cancel_reason: null,
};

const goi = vi.hoisted(() => ({
  receipt: vi.fn(),
  salesInvoices: vi.fn(),
  receiptAttachments: vi.fn(),
  markReceiptReceived: vi.fn(),
  cancelReceipt: vi.fn(),
}));

vi.mock("../../../../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));
vi.mock("../../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../../api/client")>()),
  api: { accounting: goi },
}));

import { ReceiptsDrawer } from "./ReceiptsDrawer";

const QUYEN = { lap: true, huy: true, xacNhan: true, in: true, sua: true };

/** `moi` = bản máy chủ trả ở route đọc MỘT phiếu (có `truoc_do` / `con_no_sau`). */
function ve(dau: PaymentReceiptRow, over: Partial<Parameters<typeof ReceiptsDrawer>[0]> = {}, moi?: Partial<PaymentReceiptRow>) {
  goi.receipt.mockResolvedValue({ ...dau, ...moi });
  const props = { dau, eventTick: 0, quyen: QUYEN, onDong: vi.fn(), onDoi: vi.fn(), onSua: vi.fn(), ...over };
  render(<ReceiptsDrawer {...props} />);
  return props;
}

const PHIEU_HD = phieuThu({
  id: 1, code: "PT-261005-K2M9", doc_no: "PT00013", payer_name: "Thực phẩm An Phát", source_type: "sales_invoice",
  sales_invoice_id: 7, sales_invoice_number: "0001234", order_id: 40, order_code: "DH-0412",
  customer_name: "Thực phẩm An Phát", amount: 32_000_000, amount_vnd: 32_000_000, receipt_method: "bank_transfer",
  company_bank_name: "BIDV", company_account_number: "65010001234568", company_bank_branch: "CN Bình Dương",
  bank_reference: "FT2628000002", attachment_count: 0,
});

beforeEach(() => {
  goi.receipt.mockReset();
  goi.salesInvoices.mockResolvedValue({ items: [HD] });
  goi.receiptAttachments.mockResolvedValue({ items: [] });
});

describe("ReceiptsDrawer — kiểu 3", () => {
  it("phiếu gộp: khối Các khoản trong phiếu từng dòng, Còn nợ của hoá đơn từ đối chiếu; Đơn bán liệt kê từng đơn", async () => {
    const GOP = phieuThu({
      id: 21, code: "PT-261017-GOP1", doc_no: "PT00030", source_type: "sales_invoice", sales_invoice_id: null,
      sales_invoice_number: null, order_id: null, order_code: "DH-0021 +1", customer_id: 3, amount: 8_000_000,
      amount_vnd: 8_000_000,
      lines: [
        { order_id: 21, order_code: "DH-0021", sales_invoice_id: null, invoice_number: null, amount: 3_000_000 },
        { order_id: 18, order_code: "DH-0018", sales_invoice_id: 77, invoice_number: "0000123", amount: 5_000_000 },
      ],
    });
    const moDon = vi.fn();
    ve(GOP, { onMoDonBan: moDon }, {
      doi_chieu: [{ order_code: "DH-0018", invoice_number: "0000123", truoc_do: 1_000_000, con_no_sau: 6_000_000 }],
    });
    expect(screen.queryByText("Áp vào hoá đơn")).toBeNull();
    const bang = await screen.findByRole("table", { name: "Các khoản trong phiếu" });
    expect(within(bang).getAllByRole("columnheader").map((th) => th.textContent))
      .toEqual(["Đơn bán", "Khoản", "Thu trước đó", "Phiếu này", "Còn nợ"]);
    const dong = within(bang).getAllByRole("row");
    expect([...dong[1].querySelectorAll("td")].map((c) => c.textContent)).toEqual(["DH-0021", "Cọc", "–", "3.000.000", "–"]);
    await waitFor(() =>
      expect([...dong[2].querySelectorAll("td")].map((c) => c.textContent))
        .toEqual(["DH-0018", "HĐ 0000123", "1.000.000", "5.000.000", "6.000.000"]));
    const cot = screen.getByRole("complementary", { name: "Thuộc tính" });
    expect(within(cot).queryByText("DH-0021 +1")).toBeNull();
    await userEvent.click(within(cot).getByRole("button", { name: "DH-0018" }));
    expect(moDon).toHaveBeenCalledWith(18);
  });

  it("số tiền làm tiêu đề; cột Thuộc tính có người nộp, tài khoản nhận, mã giao dịch, đơn bán, mã hệ thống", async () => {
    ve(PHIEU_HD);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("32.000.000");
    const cot = screen.getByRole("complementary", { name: "Thuộc tính" });
    expect(within(cot).getByText("Người nộp tiền")).toBeInTheDocument();
    expect(within(cot).getByText("Thực phẩm An Phát")).toBeInTheDocument();
    expect(within(cot).getByText("Vào tài khoản")).toBeInTheDocument();
    expect(within(cot).getByText("BIDV 65010001234568")).toBeInTheDocument();
    expect(within(cot).getByText("CN Bình Dương")).toHaveClass("kt-the");
    expect(within(cot).getByText("FT2628000002")).toBeInTheDocument();
    expect(within(cot).getByText("DH-0412")).toBeInTheDocument();
    expect(within(cot).getByText("Mã hệ thống")).toBeInTheDocument();
    expect(within(cot).getByText("PT-261005-K2M9")).toBeInTheDocument();
    // Cùng người lập, xác nhận cùng lúc lập ⇒ không nói lại "Xác nhận đã thu".
    expect(within(cot).queryByText("Xác nhận đã thu")).toBeNull();
    // Phiếu đã thu chưa có tệp: tab nói "chưa có" thay con số.
    expect(screen.getByRole("tab", { name: /Chứng từ gốc/ })).toHaveTextContent("chưa có");
    await waitFor(() => expect(goi.receipt).toHaveBeenCalledWith("token-test", 1));
  });

  it("phiếu cũ được người khác xác nhận sau: cột Thuộc tính có Xác nhận đã thu", async () => {
    ve(phieuThu({
      id: 9, created_at: "2026-08-20T02:00:00Z", received_at: "2026-08-21T03:00:00Z",
      received_by_name: "Nguyễn Thị Luyến",
    }));
    const cot = screen.getByRole("complementary", { name: "Thuộc tính" });
    expect(within(cot).getByText("Xác nhận đã thu")).toBeInTheDocument();
    expect(within(cot).getByText("Nguyễn Thị Luyến")).toBeInTheDocument();
  });

  it("phiếu thu hoá đơn: bảng Áp vào hoá đơn có Thu trước đó và Còn nợ từ máy chủ; Hủy nói hoá đơn quay lại còn nợ", async () => {
    const onMoCongNo = vi.fn();
    ve(PHIEU_HD, { onMoCongNo }, { truoc_do: 0, con_no_sau: 44_000_000 });
    expect(screen.getByText("Áp vào hoá đơn")).toBeInTheDocument();
    const bang = await screen.findByRole("table");
    expect(within(bang).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Hoá đơn", "Ngày", "Giá trị", "Trừ cọc", "Thu trước đó", "Phiếu này", "Còn nợ",
    ]);
    const dong = within(bang).getAllByRole("row")[1];
    expect(within(dong).getByText("1C26TSV 0001234")).toBeInTheDocument();
    expect(within(dong).getByText("22/09/2026")).toBeInTheDocument();
    expect(within(dong).getByText("96.000.000")).toBeInTheDocument();
    expect(within(dong).getByText("20.000.000")).toBeInTheDocument();
    expect(within(dong).getByText("32.000.000")).toBeInTheDocument();
    await waitFor(() => expect(within(dong).getByText("44.000.000")).toBeInTheDocument());
    // Thu trước đó = 0 ⇒ gạch mờ.
    expect(within(dong).getAllByText("–").every((o) => o.classList.contains("lds-mu3"))).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /Mở công nợ khách này/ }));
    expect(onMoCongNo).toHaveBeenCalledWith({ id: 12, name: "Thực phẩm An Phát" });

    await userEvent.click(screen.getByRole("button", { name: "Thao tác khác" }));
    const muc = screen.getByRole("menuitem", { name: /Hủy phiếu/ });
    expect(muc).toBeEnabled();
    expect(muc).toHaveTextContent("Hoá đơn 0001234 sẽ quay lại còn nợ 76.000.000 đ");
  });

  it("máy chủ không trả Thu trước đó / Còn nợ (null): hai ô là gạch mờ, không phải số 0", async () => {
    ve(PHIEU_HD, {}, { truoc_do: null, con_no_sau: null });
    const bang = await screen.findByRole("table");
    await waitFor(() => expect(goi.receipt).toHaveBeenCalled());
    const o = within(within(bang).getAllByRole("row")[1]).getAllByRole("cell");
    // Hoá đơn | Ngày | Giá trị | Trừ cọc | Thu trước đó | Phiếu này | Còn nợ
    for (const i of [4, 6]) {
      expect(o[i]).toHaveTextContent(/^–$/);
      expect(within(o[i]).getByText("–")).toHaveClass("lds-mu3");
    }
    expect(o[5]).toHaveTextContent("32.000.000");
    expect(within(bang).queryByText("0")).toBeNull();
  });

  it("route đọc một phiếu lỗi: ngăn vẫn vẽ từ dòng của bảng, không vỡ, Còn nợ là gạch mờ", async () => {
    goi.receipt.mockReset();
    goi.receipt.mockRejectedValue(new Error("500"));
    render(<ReceiptsDrawer dau={PHIEU_HD} eventTick={0} quyen={QUYEN} onDong={vi.fn()} onDoi={vi.fn()} onSua={vi.fn()} />);
    await waitFor(() => expect(goi.receipt).toHaveBeenCalledWith("token-test", 1));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("32.000.000");
    const cot = screen.getByRole("complementary", { name: "Thuộc tính" });
    expect(within(cot).getByText("Thực phẩm An Phát")).toBeInTheDocument();
    const bang = await screen.findByRole("table");
    const o = within(within(bang).getAllByRole("row")[1]).getAllByRole("cell");
    expect(o[2]).toHaveTextContent("96.000.000");
    expect(within(o[6]).getByText("–")).toHaveClass("lds-mu3");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("phiếu cọc đã thu: Hủy phiếu nói đơn bớt số đã cọc, mở khung và gửi lý do", async () => {
    const p = phieuThu({ id: 2, code: "PT-261004-R7VN", source_type: "order_deposit", order_id: 41, order_code: "DH-0415" });
    goi.cancelReceipt.mockResolvedValue({ ...p, status: "cancelled", cancel_reason: "Ghi nhầm số tiền" });
    ve(p);
    expect(screen.queryByText("Áp vào hoá đơn")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Thao tác khác" }));
    const muc = screen.getByRole("menuitem", { name: /Hủy phiếu/ });
    expect(muc).toBeEnabled();
    expect(muc).toHaveTextContent("Đơn DH-0415 sẽ bớt 2.350.000 đ đã cọc");
    await userEvent.click(muc);
    const khung = screen.getByRole("region", { name: "Hủy phiếu PT-261004-R7VN" });
    await userEvent.type(within(khung).getByLabelText(/Lý do hủy/), "Ghi nhầm số tiền");
    await userEvent.click(within(khung).getByRole("button", { name: "Hủy phiếu" }));
    await waitFor(() => expect(goi.cancelReceipt).toHaveBeenCalledWith("token-test", 2, "Ghi nhầm số tiền"));
  });

  it("hoá đơn đã hủy: không hứa 'quay lại còn nợ', dùng câu chung", async () => {
    goi.salesInvoices.mockResolvedValue({ items: [{ ...HD, status: "cancelled", remaining_amount: 0 }] });
    ve(phieuThu({
      id: 1, source_type: "sales_invoice", sales_invoice_id: 7, sales_invoice_number: "0001234", order_id: 40,
      order_code: "DH-0412",
    }));
    const bang = await screen.findByRole("table");
    expect(within(bang).getByText("Đã hủy")).toHaveClass("kt-the");
    await userEvent.click(screen.getByRole("button", { name: "Thao tác khác" }));
    const muc = screen.getByRole("menuitem", { name: /Hủy phiếu/ });
    expect(muc).toHaveTextContent("Phiếu còn trong sổ với dấu Đã hủy");
    expect(muc).not.toHaveTextContent("quay lại còn nợ");
  });

  it("phiếu thu hoá đơn thiếu mã hoá đơn: báo không đọc được, không treo 'Đang tải'", async () => {
    ve(phieuThu({ id: 3, source_type: "sales_invoice", sales_invoice_id: null, order_id: 40 }));
    expect(await screen.findByText("Không đọc được số của hoá đơn này.")).toBeInTheDocument();
    expect(screen.queryByText("Đang tải hoá đơn…")).toBeNull();
  });

  it("phiếu cũ chờ thu chuyển khoản: Xác nhận đã thu mở khung tại chỗ, thiếu mã giao dịch thì lỗi trong khung", async () => {
    const dau = phieuThu({
      id: 5, code: "PT-260820-OLD1", status: "waiting_receipt", receipt_method: "bank_transfer",
      source_type: "purchase_refund", payment_voucher_id: 9, payment_voucher_code: "UNC-260810-AB12",
      received_at: null, received_by_name: null, received_by_user_id: null,
    });
    goi.markReceiptReceived.mockResolvedValue({ ...dau, status: "received", bank_reference: "FT2608" });
    const p = ve(dau);
    // Phiếu thu lại tiền chi: cột Thuộc tính có Phiếu chi gốc.
    const cot = screen.getByRole("complementary", { name: "Thuộc tính" });
    expect(within(cot).getByText("Phiếu chi gốc")).toBeInTheDocument();
    expect(within(cot).getByText("UNC-260810-AB12")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Xác nhận đã thu" }));
    const khung = screen.getByRole("region", { name: "Xác nhận đã thu PT-260820-OLD1" });
    await userEvent.click(within(khung).getByRole("button", { name: "Xác nhận đã thu" }));
    expect(within(khung).getByRole("alert")).toHaveTextContent("Thu qua ngân hàng phải có mã giao dịch hoặc số báo có.");
    expect(goi.markReceiptReceived).not.toHaveBeenCalled();

    await userEvent.type(within(khung).getByLabelText(/Mã giao dịch ngân hàng/), " FT2608 ");
    await userEvent.click(within(khung).getByRole("button", { name: "Xác nhận đã thu" }));
    expect(goi.markReceiptReceived).toHaveBeenCalledWith("token-test", 5, "FT2608");
    await waitFor(() => expect(p.onDoi).toHaveBeenCalled());

    expect(screen.queryByRole("region", { name: /Xác nhận đã thu/ })).toBeNull();
  });

  it("phiếu cũ chờ thu TIỀN MẶT có mã giao dịch sót lại: xác nhận gửi null như bản cũ", async () => {
    const dau = phieuThu({
      id: 8, code: "PT-260820-OLD2", status: "waiting_receipt", receipt_method: "cash", bank_reference: "FT-SOT",
      source_type: "purchase_refund", payment_voucher_id: 9, received_at: null,
    });
    goi.markReceiptReceived.mockReset();
    goi.markReceiptReceived.mockResolvedValue({ ...dau, status: "received" });
    ve(dau);
    await userEvent.click(screen.getByRole("button", { name: "Xác nhận đã thu" }));
    const khung = screen.getByRole("region", { name: "Xác nhận đã thu PT-260820-OLD2" });
    expect(within(khung).queryByLabelText(/Mã giao dịch ngân hàng/)).toBeNull();
    await userEvent.click(within(khung).getByRole("button", { name: "Xác nhận đã thu" }));
    expect(goi.markReceiptReceived).toHaveBeenCalledWith("token-test", 8, null);
  });

  it("Sửa hiện cho phiếu cũ chờ thu từ phiếu chi; phiếu đã thu thì không", async () => {
    const dau = phieuThu({ id: 5, status: "waiting_receipt", source_type: "purchase_refund", payment_voucher_id: 9 });
    const p = ve(dau);
    await userEvent.click(screen.getByRole("button", { name: "Sửa" }));
    expect(p.onSua).toHaveBeenCalledWith(dau);
  });

  it("Lịch sử: Lập, Xác nhận đã thu (phiếu cũ, xác nhận sau khi lập) và Hủy có người + lý do", async () => {
    ve(phieuThu({
      id: 6, status: "cancelled", source_type: "other", created_at: "2026-08-20T02:00:00Z",
      received_at: "2026-08-21T03:00:00Z", received_by_name: "Nguyễn Thị Luyến",
      cancelled_at: "2026-10-01T04:00:00Z", cancelled_by_name: "Phạm Thu Trang", cancel_reason: "Thu nhầm nên lập lại",
    }));
    await userEvent.click(screen.getByRole("tab", { name: /Lịch sử/ }));
    // Cột Thuộc tính cũng có "Xác nhận đã thu" (khác người lập) ⇒ chỉ soi phần nội dung bên trái.
    const ls = document.querySelector<HTMLElement>(".kt-ngan__chinh")!;
    expect(within(ls).getByText("Lập phiếu thu")).toBeInTheDocument();
    expect(within(ls).getByText("Xác nhận đã thu")).toBeInTheDocument();
    expect(within(ls).getByText("Nguyễn Thị Luyến")).toBeInTheDocument();
    expect(within(ls).getByText("Hủy phiếu")).toBeInTheDocument();
    expect(within(ls).getAllByText("Thu nhầm nên lập lại").length).toBeGreaterThan(0);
  });
});
