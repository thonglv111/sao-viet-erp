/** Nối dây màn Phiếu thu (đặc tả PT-1, A.17, A.18; phương án A): URL ↔ lọc + kỳ, một lời gọi mỗi lượt tải, tab
 *  "Chờ thu" chỉ hiện khi còn phiếu cũ chờ thu, mã hoá đơn mở Công nợ phải thu đúng khách (lỗi 11). */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { khoangSo } from "../shared/kyKeToan";
import { phieuThu } from "./components/phieuMau";

const goi = vi.hoisted(() => ({
  receipts: vi.fn(),
  companyAccounts: vi.fn(),
  salesInvoices: vi.fn(),
  receiptAttachments: vi.fn(),
  donHangChoThu: vi.fn(),
  chiTietKhoanThu: vi.fn(),
  // Form "Thu tiền hoá đơn" nạp công nợ của khách — test chỉ cần form mở ra.
  receivablesDetail: vi.fn(() => new Promise(() => {})),
}));

vi.mock("../../../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));
vi.mock("../../../auth/permissions", async (goc) => ({
  ...(await goc<typeof import("../../../auth/permissions")>()),
  useCan: () => () => true,
}));
vi.mock("../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../api/client")>()),
  api: {
    accounting: goi,
    mucThuChi: { list: vi.fn().mockResolvedValue({ items: [] }) },
    customers: { contacts: vi.fn().mockResolvedValue({ items: [] }) },
  },
}));

import { PaymentReceiptsPage } from "./PaymentReceiptsPage";

const THE = { tat_ca: 32, xong: 31, xong_tien: 245_000_000, da_huy: 1, cho: 0 };
const HD_ROW = phieuThu({
  id: 1, code: "PT-261005-K2M9", payer_name: "Thực phẩm An Phát", source_type: "sales_invoice",
  sales_invoice_id: 7, sales_invoice_number: "0001234", order_id: 40, order_code: "DH-0412",
  customer_name: "Thực phẩm An Phát",
});
const traVe = (the_loc = THE, items = [HD_ROW]) => ({ items, total: items.length, page: 1, size: 25, total_received_amount: 245_000_000, the_loc });

beforeEach(() => {
  goi.receipts.mockReset();
  goi.receipts.mockImplementation(async () => traVe());
  goi.companyAccounts.mockResolvedValue([]);
  goi.receiptAttachments.mockResolvedValue({ items: [] });
  goi.donHangChoThu.mockReset();
  goi.donHangChoThu.mockResolvedValue({ coc: [], hoa_don: [] });
  goi.salesInvoices.mockResolvedValue({ items: [{ id: 7, customer_id: 12, customer_name: "Công ty CP Thực phẩm An Phát" }] });
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("PaymentReceiptsPage — nối dây", () => {
  it("mở từ link có lọc + kỳ: lời gọi chính mang đúng tham số, sắp theo ngày thu; mốc Ngày thu đọc từ URL; chung_tu cũ bị bỏ", async () => {
    window.history.replaceState(
      null, "",
      "/?man=ke-toan-phieu-thu&ky=nam&moc=thu&the=xong&chung_tu=thieu&q=PT-26&muc=7,0&hinh_thuc=bank_transfer",
    );
    render(<PaymentReceiptsPage navigate={() => {}} />);
    await waitFor(() => expect(goi.receipts).toHaveBeenCalled());
    const nam = khoangSo({ loai: "nam", moc: "thu" });
    const p = goi.receipts.mock.calls[0][1];
    expect(p).toMatchObject({
      status: "received", q: "PT-26", muc: [7, 0],
      hinh_thuc: "bank_transfer", tu_ngay: nam.tu, den_ngay: nam.den, moc: "thu", page: 1, sort: "-receipt_date",
    });
    expect(p.nhan).toBeUndefined();
    expect("chung_tu" in p).toBe(false);
    expect(screen.getByRole("textbox", { name: "Tìm phiếu thu" })).toHaveValue("PT-26");
  });

  it("kỳ có khoảng: một lời gọi (không còn lời cùng kỳ); số nằm trong dải tab; dòng Cộng lấy tổng tiền đã thu; không có tab Chờ thu khi cho = 0", async () => {
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-thu&ky=thang");
    render(<PaymentReceiptsPage navigate={() => {}} />);
    const dai = screen.getByRole("group", { name: "Lọc theo trạng thái" });
    await waitFor(() => expect(within(dai).getByRole("button", { name: /Tất cả/ })).toHaveTextContent("32"));
    expect(goi.receipts).toHaveBeenCalledTimes(1);
    expect(within(dai).getByRole("button", { name: /Đã thu/ })).toHaveTextContent("31");
    // Thẻ "Thiếu chứng từ gốc" đã gỡ (17/10/2026).
    expect(within(dai).queryByRole("button", { name: /Thiếu chứng từ gốc/ })).toBeNull();
    expect(within(dai).queryByRole("button", { name: /Chờ thu/ })).toBeNull();
    await waitFor(() => expect(document.querySelector("tr.lds-cong")).not.toBeNull());
    const cong = document.querySelector<HTMLElement>("tr.lds-cong")!;
    expect(cong).toHaveTextContent("Cộng 31 phiếu đã thu");
    expect(cong).toHaveTextContent("245.000.000");
    expect(screen.queryByRole("button", { name: /Xuất Excel/ })).toBeNull();
    const u = new URLSearchParams(window.location.search);
    expect(u.get("man")).toBe("ke-toan-phieu-thu");
    expect(u.get("ky")).toBe("thang");
  });

  it("còn phiếu cũ chờ thu (cho > 0) thì hiện tab Chờ thu; bấm tab gửi status waiting_receipt, không có dòng Cộng", async () => {
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-thu&ky=thang");
    goi.receipts.mockImplementation(async () => traVe({ ...THE, cho: 2 }));
    render(<PaymentReceiptsPage navigate={() => {}} />);
    const dai = screen.getByRole("group", { name: "Lọc theo trạng thái" });
    const cho = await within(dai).findByRole("button", { name: /Chờ thu/ });
    expect(cho).toHaveTextContent("2");
    await userEvent.click(cho);
    await waitFor(() =>
      expect(goi.receipts.mock.calls.some((c) => c[1].status === "waiting_receipt" && !c[1].dem_only)).toBe(true),
    );
    await waitFor(() => expect(cho).toHaveAttribute("aria-pressed", "true"));
    expect(document.querySelector("tr.lds-cong")).toBeNull();
  });

  it("URL the=cho mà không còn phiếu chờ thu (cho = 0) thì về Tất cả", async () => {
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-thu&ky=thang&the=cho");
    render(<PaymentReceiptsPage navigate={() => {}} />);
    await waitFor(() =>
      expect(goi.receipts.mock.calls.some((c) => c[1].status == null && !c[1].dem_only)).toBe(true),
    );
    await waitFor(() => expect(new URLSearchParams(window.location.search).has("the")).toBe(false));
    const dai = screen.getByRole("group", { name: "Lọc theo trạng thái" });
    expect(within(dai).getByRole("button", { name: /Tất cả/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(dai).queryByRole("button", { name: /Chờ thu/ })).toBeNull();
  });

  it("mã hoá đơn ở cột Thu theo mở Công nợ phải thu, ngăn của đúng khách — không mở đơn bán (lỗi 11)", async () => {
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-thu&ky=thang");
    const navigate = vi.fn();
    render(<PaymentReceiptsPage navigate={navigate} />);
    await waitFor(() => expect(document.querySelector("tr.lds-dong")).not.toBeNull());
    const dong = document.querySelector<HTMLElement>("tr.lds-dong")!;
    expect(within(dong).getByText("Hoá đơn")).toHaveClass("lds-tag");
    await userEvent.click(within(dong).getByRole("button", { name: "0001234" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("ke-toan-cong-no-phai-thu", {
        focusReceivableCustomer: { id: 12, name: "Công ty CP Thực phẩm An Phát" },
      }),
    );
    expect(navigate).not.toHaveBeenCalledWith("don-hang-ban", expect.anything());
  });

  it("có cọc / hoá đơn chờ thu thì có mục Đơn hàng chờ thu; bấm vào thấy hai loại khoản kèm nút lập phiếu thu", async () => {
    goi.donHangChoThu.mockResolvedValue({
      coc: [{ order_id: 5, order_code: "DH005", customer_id: 3, customer_name: "Công ty An Phát", deposit_pct: 30,
        can_thu: 300_000, da_thu: 0, con_thieu: 300_000, ordered_at: null }],
      hoa_don: [{ invoice_id: 8, invoice_symbol: "1C26TSV", invoice_number: "56", invoice_date: "2026-10-13",
        due_date: "2026-11-12", order_id: 7, order_code: "DH007", customer_id: 4, customer_name: "Katinat",
        amount: 2_155_871, direct_received_amount: 0, deposit_offset_amount: 0, da_thu: 0, con_no: 2_155_871 }],
    });
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-thu&ky=tat_ca");
    render(<PaymentReceiptsPage navigate={vi.fn()} />);
    const dai = screen.getByRole("group", { name: "Lọc theo trạng thái" });
    const tab = await within(dai).findByRole("button", { name: /Đơn hàng chờ thu/ });
    expect(tab).toHaveTextContent("2");
    await userEvent.click(tab);
    expect(await screen.findByRole("button", { name: "DH005" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DH007" })).toBeInTheDocument();
    expect(screen.getByText("HĐ 56")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Lập phiếu thu" }).length).toBeGreaterThanOrEqual(2);
  });

  it("tick cọc + hoá đơn cùng khách ⇒ dải 'Đã chọn 2 khoản' + 'Lập một phiếu thu'; khách khác bị khoá ô tick", async () => {
    goi.donHangChoThu.mockResolvedValue({
      coc: [{ order_id: 5, order_code: "DH005", customer_id: 3, customer_name: "Công ty An Phát", deposit_pct: 30,
        can_thu: 300_000, da_thu: 0, con_thieu: 300_000, ordered_at: null }],
      hoa_don: [
        { invoice_id: 8, invoice_symbol: "1C26TSV", invoice_number: "56", invoice_date: "2026-10-13",
          due_date: "2026-11-12", order_id: 7, order_code: "DH007", customer_id: 3, customer_name: "Công ty An Phát",
          amount: 2_155_871, direct_received_amount: 0, deposit_offset_amount: 0, da_thu: 0, con_no: 2_155_871 },
        { invoice_id: 9, invoice_symbol: "1C26TSV", invoice_number: "57", invoice_date: "2026-10-13",
          due_date: null, order_id: 8, order_code: "DH008", customer_id: 4, customer_name: "Katinat",
          amount: 500_000, direct_received_amount: 0, deposit_offset_amount: 0, da_thu: 0, con_no: 500_000 },
      ],
    });
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-thu&ky=tat_ca&the=dh");
    render(<PaymentReceiptsPage navigate={vi.fn()} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Chọn Cọc của DH005" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Chọn HĐ 56 của DH007" }));
    const khac = screen.getByRole("checkbox", { name: "Chọn HĐ 57 của DH008" });
    expect(khac).toBeDisabled();
    expect(khac.closest("[title]")).toHaveAttribute("title", "Khác khách hàng");
    const dai = screen.getByRole("region", { name: "Khoản đã chọn" });
    expect(dai).toHaveTextContent("Đã chọn 2 khoản của Công ty An Phát");
    expect(dai).toHaveTextContent("2.455.871 đ");
    await userEvent.click(within(dai).getByRole("button", { name: "Lập một phiếu thu" }));
    const ngan = await screen.findByRole("dialog", { name: "Lập phiếu thu 2 khoản" });
    expect(within(ngan).getByRole("textbox", { name: "Thu lần này DH005 Cọc" })).toHaveValue("300.000");
    expect(within(ngan).getByRole("textbox", { name: "Thu lần này DH007 HĐ 56" })).toHaveValue("2.155.871");
  });

  it("bấm dòng hoá đơn ở hàng chờ thu ⇒ popup kiểu B: hàng, lịch sử (phiếu gộp), Còn phải thu + nút Lập phiếu thu", async () => {
    goi.donHangChoThu.mockResolvedValue({
      coc: [],
      hoa_don: [{ invoice_id: 8, invoice_symbol: "1C26TSV", invoice_number: "56", invoice_date: "2026-10-13",
        due_date: null, order_id: 7, order_code: "DH007", customer_id: 4, customer_name: "Katinat",
        amount: 2_200_000, direct_received_amount: 500_000, deposit_offset_amount: 300_000, hoan_khong_don: 100_000,
        da_thu: 800_000, con_no: 1_500_000 }],
    });
    goi.chiTietKhoanThu.mockResolvedValue({
      hang: [{ ten: "Ruột sách A5", so_luong: 1000, dvt: "cuốn", don_gia: 2_000, vat: 10, thanh_tien: 2_000_000 }],
      phieu: [{ receipt_id: 3, code: "PT-261014-AA01", doc_no: "PT00006", ngay: "2026-10-14", amount: 500_000, gop: true }],
    });
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-thu&ky=tat_ca&the=dh");
    render(<PaymentReceiptsPage navigate={vi.fn()} />);
    await userEvent.click(await screen.findByText("Katinat"));
    const popup = await screen.findByRole("dialog", { name: "Hoá đơn 56 đơn DH007" });
    expect(goi.chiTietKhoanThu).toHaveBeenCalledWith("token-test", { invoice_id: 8 });
    expect(await within(popup).findByRole("row", { name: /Ruột sách A5/ })).toHaveTextContent("2.000.000");
    expect(within(popup).getByText("Cộng tiền hàng").nextElementSibling).toHaveTextContent("2.000.000 đ");
    expect(within(popup).getByText("Cộng tiền hàng").closest("dl")).toHaveTextContent("VAT200.000 đ");
    expect(within(popup).getByText("Giá trị hoá đơn").nextElementSibling).toHaveTextContent("2.200.000 đ");
    const ls = within(popup).getByRole("list", { name: "Lịch sử" });
    expect(within(ls).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "13/10/2026Ghi hoá đơn 1C26TSV 562.200.000 đ",
      "cọcCọc của đơn trừ vào hoá đơn−300.000 đ",
      "ngoài đơnTrả lại khách ngoài đơn, cộng nợ lại vào hoá đơn này100.000 đ",
      "14/10/2026Phiếu thu PT00006 phiếu gộp−500.000 đ",
    ]);
    const con = within(popup).getByRole("region", { name: "Còn phải thu" });
    expect(con).toHaveTextContent("1.500.000 đ");
    expect(within(popup).getByText("Hạn thu").nextElementSibling).toHaveTextContent("chưa đặt hạn");
    await userEvent.click(within(con).getByRole("button", { name: "Lập phiếu thu" }));
    expect(await screen.findByRole("dialog", { name: /Thu tiền hoá đơn 56/ })).toBeInTheDocument();
  });
});
