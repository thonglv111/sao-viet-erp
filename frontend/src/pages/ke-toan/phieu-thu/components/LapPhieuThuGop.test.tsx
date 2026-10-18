/** Lập MỘT phiếu thu cho nhiều khoản cùng khách (17/10/2026: "một phiếu cho cả lượt").
 *
 *  Khoá chặt: bảng khoản (một dòng cọc + một dòng hoá đơn) có ô "Thu lần này" điền sẵn bằng Còn; sửa ô
 *  thì tổng phiếu đổi theo; ô vượt Còn thì báo lỗi tại bảng, không gọi máy chủ; bấm lập gửi `lines` đúng
 *  số từng khoản; chuyển khoản phải có tài khoản + mã giao dịch; chứng từ đính MỘT lần vào phiếu vừa lập.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { homNayVN } from "../../../../utils/ky";

const companyAccounts = vi.fn();
const createReceiptGop = vi.fn();
const uploadReceiptAttachment = vi.fn();
const contacts = vi.fn();

vi.mock("../../../../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));
vi.mock("../../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../../api/client")>()),
  api: {
    accounting: {
      companyAccounts: (...a: unknown[]) => companyAccounts(...a),
      createReceiptGop: (...a: unknown[]) => createReceiptGop(...a),
      uploadReceiptAttachment: (...a: unknown[]) => uploadReceiptAttachment(...a),
    },
    customers: { contacts: (...a: unknown[]) => contacts(...a) },
  },
}));

import { LapPhieuThuGop, type KhoanThuGop } from "./LapPhieuThuGop";

const KHOAN: KhoanThuGop[] = [
  { sales_invoice_id: null, order_id: 21, ma_don: "DH-0021", nhan: "Cọc", han: null, con: 3_000_000 },
  { sales_invoice_id: 77, order_id: 18, ma_don: "DH-0018", nhan: "HĐ 0000123", han: "2026-11-05", con: 12_000_000 },
];

beforeEach(() => {
  vi.clearAllMocks();
  companyAccounts.mockResolvedValue([
    { id: 4, bank_name: "Vietcombank", account_number: "0281000456789", currency: "VND", is_active: true },
  ]);
  contacts.mockResolvedValue({ items: [] });
  createReceiptGop.mockResolvedValue({ id: 801, code: "PT-0301", doc_no: "PT00301", amount: 15_000_000 });
});

function ve(onSaved = vi.fn()) {
  render(<LapPhieuThuGop customerId={9} customerName="In Hoa Sen" khoan={KHOAN} onClose={() => {}} onSaved={onSaved} />);
  return screen.findByRole("dialog", { name: "Lập phiếu thu 2 khoản" });
}

describe("LapPhieuThuGop", () => {
  it("điền sẵn Còn, sửa ô thì tổng đổi, bấm lập gửi lines đúng số và gọi onSaved", async () => {
    const onSaved = vi.fn();
    const ngan = await ve(onSaved);
    const bang = within(ngan).getByRole("table", { name: "Các khoản trong phiếu" });
    expect(within(bang).getAllByRole("row")).toHaveLength(3);
    expect(within(ngan).getByText("Tổng phiếu").nextElementSibling).toHaveTextContent("15.000.000 đ");

    const o = within(bang).getByRole("textbox", { name: "Thu lần này DH-0018 HĐ 0000123" });
    expect(o).toHaveValue("12.000.000");
    await userEvent.clear(o);
    await userEvent.type(o, "5000000");
    expect(within(ngan).getByText("Tổng phiếu").nextElementSibling).toHaveTextContent("8.000.000 đ");
    expect(within(ngan).getByRole("textbox", { name: /Người nộp tiền/ })).toHaveValue("In Hoa Sen");

    await userEvent.click(within(ngan).getByRole("button", { name: "Lập phiếu thu" }));
    await waitFor(() => expect(createReceiptGop).toHaveBeenCalledTimes(1));
    const gui = createReceiptGop.mock.calls[0][1];
    expect(gui.lines).toStrictEqual([
      { sales_invoice_id: null, order_id: 21, amount: 3_000_000 },
      { sales_invoice_id: 77, order_id: 18, amount: 5_000_000 },
    ]);
    expect(gui).toMatchObject({
      receipt_method: "cash",
      receipt_date: homNayVN(),
      payer_name: "In Hoa Sen",
      company_bank_account_id: null,
      bank_reference: null,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 801 })));
  });

  it("ô vượt Còn thì báo lỗi tại bảng, không gọi máy chủ", async () => {
    const ngan = await ve();
    const o = within(ngan).getByRole("textbox", { name: "Thu lần này DH-0021 Cọc" });
    await userEvent.clear(o);
    await userEvent.type(o, "4000000");
    expect(o).toHaveAttribute("aria-invalid", "true");
    await userEvent.click(within(ngan).getByRole("button", { name: "Lập phiếu thu" }));
    expect(createReceiptGop).not.toHaveBeenCalled();
    expect(within(ngan).getByRole("alert")).toHaveTextContent("DH-0021 Cọc thu quá phần còn phải thu");
  });

  it("chuyển khoản: thiếu tài khoản và mã giao dịch thì lỗi tại ô, đủ thì gửi đúng trường", async () => {
    const ngan = await ve();
    await userEvent.click(within(ngan).getByRole("radio", { name: "Chuyển khoản" }));
    await userEvent.click(within(ngan).getByRole("button", { name: "Lập phiếu thu" }));
    expect(createReceiptGop).not.toHaveBeenCalled();
    expect(within(ngan).getByText("Chọn tài khoản công ty nhận tiền.")).toBeInTheDocument();

    await userEvent.selectOptions(within(ngan).getByRole("combobox"), "4");
    await userEvent.type(within(ngan).getByRole("textbox", { name: /Mã giao dịch/ }), "FT2610170001");
    await userEvent.click(within(ngan).getByRole("button", { name: "Lập phiếu thu" }));
    await waitFor(() => expect(createReceiptGop).toHaveBeenCalledTimes(1));
    expect(createReceiptGop.mock.calls[0][1]).toMatchObject({
      receipt_method: "bank_transfer",
      company_bank_account_id: 4,
      bank_reference: "FT2610170001",
    });
  });

  it("chứng từ đính một lần vào phiếu vừa lập; tải hỏng thì ở lại và nêu mã phiếu", async () => {
    uploadReceiptAttachment.mockRejectedValue(new Error("mất mạng"));
    const onSaved = vi.fn();
    const ngan = await ve(onSaved);
    const tep = ngan.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(tep, { target: { files: [new File(["x"], "sao-ke.pdf", { type: "application/pdf" })] } });
    });
    await userEvent.click(within(ngan).getByRole("button", { name: "Lập phiếu thu" }));
    await waitFor(() => expect(uploadReceiptAttachment).toHaveBeenCalledTimes(1));
    expect(uploadReceiptAttachment.mock.calls[0][1]).toBe(801);
    expect((await within(ngan).findAllByText(/PT-0301/)).length).toBeGreaterThan(0);
    expect(onSaved).not.toHaveBeenCalled();
    await userEvent.click(within(ngan).getByRole("button", { name: "Xong" }));
    expect(onSaved).toHaveBeenCalled();
  });
});
