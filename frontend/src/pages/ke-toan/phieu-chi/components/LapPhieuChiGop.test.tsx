/** Lập MỘT phiếu chi cho nhiều khoản cùng nhà cung cấp (17/10/2026: "một phiếu cho cả lượt").
 *
 *  Khoá chặt: bảng khoản có ô "Chi lần này" điền sẵn bằng Còn; sửa ô thì tổng phiếu đổi theo; ô vượt
 *  Còn hoặc bằng 0 thì báo lỗi tại bảng, không gọi máy chủ; bấm lập gửi `lines` đúng số từng khoản;
 *  chứng từ đính MỘT lần vào phiếu vừa lập.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { homNayVN } from "../../../../utils/ky";

const companyAccounts = vi.fn();
const createVoucherGop = vi.fn();
const uploadVoucherAttachment = vi.fn();

vi.mock("../../../../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));
vi.mock("../../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../../api/client")>()),
  api: {
    accounting: {
      companyAccounts: (...a: unknown[]) => companyAccounts(...a),
      createVoucherGop: (...a: unknown[]) => createVoucherGop(...a),
      uploadVoucherAttachment: (...a: unknown[]) => uploadVoucherAttachment(...a),
    },
  },
}));

import { LapPhieuChiGop, type KhoanGop } from "./LapPhieuChiGop";

const KHOAN: KhoanGop[] = [
  { purchase_request_id: 12, ma_don: "PMH-0012", delivery_id: null, nhan: "Cọc", han: null, con: 5_000_000 },
  { purchase_request_id: 15, ma_don: "PMH-0015", delivery_id: 103, nhan: "Đợt 1", han: "2026-10-30", con: 20_000_000 },
];

beforeEach(() => {
  vi.clearAllMocks();
  companyAccounts.mockResolvedValue([]);
  createVoucherGop.mockResolvedValue({ id: 601, code: "PC-0201", doc_no: "PC00201", amount: 15_000_000 });
});

function ve(onSaved = vi.fn()) {
  render(<LapPhieuChiGop supplierName="Giấy Bình Minh" khoan={KHOAN} onClose={() => {}} onSaved={onSaved} />);
  return screen.findByRole("dialog", { name: "Lập phiếu chi 2 khoản" });
}

describe("LapPhieuChiGop", () => {
  it("điền sẵn Còn, sửa ô thì tổng đổi, bấm lập gửi lines đúng số và gọi onSaved", async () => {
    const onSaved = vi.fn();
    const ngan = await ve(onSaved);
    const bang = within(ngan).getByRole("table", { name: "Các khoản trong phiếu" });
    expect(within(bang).getAllByRole("row")).toHaveLength(3);
    expect(within(ngan).getByText("Tổng phiếu").nextElementSibling).toHaveTextContent("25.000.000 đ");

    const o = within(bang).getByRole("textbox", { name: "Chi lần này PMH-0015 Đợt 1" });
    expect(o).toHaveValue("20.000.000");
    await userEvent.clear(o);
    await userEvent.type(o, "10000000");
    expect(within(ngan).getByText("Tổng phiếu").nextElementSibling).toHaveTextContent("15.000.000 đ");

    await userEvent.click(within(ngan).getByRole("button", { name: "Lập phiếu chi" }));
    await waitFor(() => expect(createVoucherGop).toHaveBeenCalledTimes(1));
    const gui = createVoucherGop.mock.calls[0][1];
    expect(gui.lines).toStrictEqual([
      { purchase_request_id: 12, delivery_id: null, amount: 5_000_000 },
      { purchase_request_id: 15, delivery_id: 103, amount: 10_000_000 },
    ]);
    expect(gui).toMatchObject({ voucher_type: "cash", voucher_date: homNayVN(), cash_recipient_name: "Giấy Bình Minh" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 601 })));
  });

  it("ô vượt Còn thì báo lỗi tại bảng, không gọi máy chủ", async () => {
    const ngan = await ve();
    const o = within(ngan).getByRole("textbox", { name: "Chi lần này PMH-0012 Cọc" });
    await userEvent.clear(o);
    await userEvent.type(o, "6000000");
    expect(o).toHaveAttribute("aria-invalid", "true");
    await userEvent.click(within(ngan).getByRole("button", { name: "Lập phiếu chi" }));
    expect(createVoucherGop).not.toHaveBeenCalled();
    expect(within(ngan).getByRole("alert")).toHaveTextContent("PMH-0012 Cọc chi quá phần còn phải chi");
  });

  it("chứng từ đính một lần vào phiếu vừa lập; tải hỏng thì ở lại và nêu mã phiếu", async () => {
    uploadVoucherAttachment.mockRejectedValue(new Error("mất mạng"));
    const onSaved = vi.fn();
    const ngan = await ve(onSaved);
    const tep = ngan.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(tep, { target: { files: [new File(["x"], "unc.pdf", { type: "application/pdf" })] } });
    });
    await userEvent.click(within(ngan).getByRole("button", { name: "Lập phiếu chi" }));
    await waitFor(() => expect(uploadVoucherAttachment).toHaveBeenCalledTimes(1));
    expect(uploadVoucherAttachment.mock.calls[0][1]).toBe(601);
    expect(await within(ngan).findByText(/PC-0201/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    await userEvent.click(within(ngan).getByRole("button", { name: "Xong" }));
    expect(onSaved).toHaveBeenCalled();
  });
});
