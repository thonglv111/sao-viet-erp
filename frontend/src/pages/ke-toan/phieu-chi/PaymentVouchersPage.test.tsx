/** Nối dây màn Phiếu chi: URL ↔ lọc + kỳ (A.18), một lời gọi mỗi lượt tải, đường dẫn sâu mở kỳ Tất cả. */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { khoangSo } from "../shared/kyKeToan";

const vouchers = vi.fn();
const choChi = vi.fn();
const traLai = vi.fn();
const ckKe = vi.fn();
const muaHangChoChi = vi.fn();

vi.mock("../../../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));
vi.mock("../../../auth/permissions", async (goc) => ({
  ...(await goc<typeof import("../../../auth/permissions")>()),
  useCan: () => () => true,
}));
vi.mock("../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../api/client")>()),
  api: {
    mucThuChi: { list: vi.fn().mockResolvedValue({ items: [] }) },
    accounting: {
      vouchers: (...a: unknown[]) => vouchers(...a),
      companyAccounts: vi.fn().mockResolvedValue([]),
      traLaiKhachChoChi: (...a: unknown[]) => traLai(...a),
      ckKeChoChi: (...a: unknown[]) => ckKe(...a),
      muaHangChoChi: (...a: unknown[]) => muaHangChoChi(...a),
    },
    giaCongNgoai: { choChi: (...a: unknown[]) => choChi(...a) },
  },
}));

import { PaymentVouchersPage } from "./PaymentVouchersPage";

const THE = { tat_ca: 7, xong: 5, xong_tien: 12_000_000, da_huy: 1, cho: 0 };
const traVe = (the_loc = THE) => ({ items: [], total: 0, the_loc });

beforeEach(() => {
  vouchers.mockReset();
  choChi.mockReset();
  choChi.mockResolvedValue([]);
  traLai.mockReset();
  traLai.mockResolvedValue([]);
  ckKe.mockReset();
  ckKe.mockResolvedValue([]);
  muaHangChoChi.mockReset();
  muaHangChoChi.mockResolvedValue([]);
  vouchers.mockImplementation(async () => traVe());
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("PaymentVouchersPage — nối dây", () => {
  it("mở từ link có lọc + kỳ: lời gọi chính mang đúng tham số (kỳ theo Ngày tạo mặc định); chung_tu cũ bị bỏ", async () => {
    window.history.replaceState(
      null, "",
      "/?man=ke-toan-phieu-chi&ky=nam&the=xong&chung_tu=thieu&q=UNC&muc=5&tien_tu=5000000",
    );
    render(<PaymentVouchersPage navigate={() => {}} />);
    await waitFor(() => expect(vouchers).toHaveBeenCalled());
    const p = vouchers.mock.calls[0][1];
    const nam = khoangSo({ loai: "nam", moc: "tao" });
    expect(p).toMatchObject({
      status: "paid", q: "UNC", muc: [5],
      tien_tu: 5_000_000, tu_ngay: nam.tu, den_ngay: nam.den, moc: "tao", page: 1,
    });
    expect(p.nhan).toBeUndefined();
    expect("chung_tu" in p).toBe(false);
    expect(screen.getByRole("textbox", { name: "Tìm phiếu chi" })).toHaveValue("UNC");
  });

  it("kỳ Tất cả: một lời gọi, không gửi ngày lẫn mốc", async () => {
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-chi&ky=tat_ca");
    render(<PaymentVouchersPage navigate={() => {}} />);
    await waitFor(() => expect(vouchers).toHaveBeenCalled());
    expect(vouchers).toHaveBeenCalledTimes(1);
    expect(vouchers.mock.calls[0][1].tu_ngay).toBeUndefined();
    expect(vouchers.mock.calls[0][1].moc).toBeUndefined();
  });

  it("kỳ có khoảng: vẫn MỘT lời gọi (không còn lời cùng kỳ năm trước); dải tab lấy số từ nó; URL ghi man + kỳ", async () => {
    // Bộ nhớ kỳ là biến cấp module (sống qua các test) — đặt kỳ bằng URL cho test này độc lập.
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-chi&ky=thang");
    render(<PaymentVouchersPage navigate={() => {}} />);
    // Số nằm trong dải tab cạnh tiêu đề (phương án A).
    const dai = screen.getByRole("group", { name: "Lọc theo trạng thái" });
    await waitFor(() => expect(within(dai).getByRole("button", { name: /Tất cả/ })).toHaveTextContent("7"));
    expect(vouchers).toHaveBeenCalledTimes(1);
    expect(vouchers.mock.calls[0][1].size).not.toBe(1);
    // Thẻ "Thiếu chứng từ gốc" đã gỡ (17/10/2026).
    expect(within(dai).queryByRole("button", { name: /Thiếu chứng từ gốc/ })).toBeNull();
    const u = new URLSearchParams(window.location.search);
    expect(u.get("man")).toBe("ke-toan-phieu-chi");
    expect(u.get("ky")).toBe("thang");
    expect(u.has("the")).toBe(false);
  });

  it("không có việc gia công chờ chi thì dải tab không có mục đó", async () => {
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-chi&ky=tat_ca");
    render(<PaymentVouchersPage navigate={() => {}} />);
    const dai = screen.getByRole("group", { name: "Lọc theo trạng thái" });
    await waitFor(() => expect(within(dai).getByRole("button", { name: /Tất cả/ })).toHaveTextContent("7"));
    // API gia công ĐÃ trả về (mảng rỗng) — không phải ẩn vì còn đang tải.
    await waitFor(() => expect(choChi).toHaveBeenCalled());
    expect(within(dai).queryByRole("button", { name: /Gia công chờ chi/ })).toBeNull();
    expect(within(dai).getByRole("button", { name: /Đã chi/ })).toBeInTheDocument();
  });

  it("có việc gia công chờ chi thì dải tab có mục đó kèm số việc", async () => {
    choChi.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-chi&ky=tat_ca");
    render(<PaymentVouchersPage navigate={() => {}} />);
    const dai = screen.getByRole("group", { name: "Lọc theo trạng thái" });
    await waitFor(() => expect(within(dai).getByRole("button", { name: /Gia công chờ chi/ })).toHaveTextContent("2"));
  });

  it("tải việc gia công lỗi: mục vẫn hiện (không số) để bấm vào thấy lỗi", async () => {
    choChi.mockRejectedValue(new Error("mất mạng"));
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-chi&ky=tat_ca");
    render(<PaymentVouchersPage navigate={() => {}} />);
    const dai = screen.getByRole("group", { name: "Lọc theo trạng thái" });
    await waitFor(() => expect(within(dai).getByRole("button", { name: /Gia công chờ chi/ })).toBeInTheDocument());
  });

  it("đường dẫn sâu tìm đúng mã trên kỳ Tất cả (kỳ hiện trên thanh lọc khớp lời gọi)", async () => {
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-chi&ky=thang");
    render(<PaymentVouchersPage navigate={() => {}} focusQuery="PC-2610-01" />);
    await waitFor(() =>
      expect(vouchers.mock.calls.some((c) => c[1].q === "PC-2610-01" && c[1].tu_ngay === undefined)).toBe(true),
    );
    // Tất cả là kỳ mặc định của màn ⇒ URL bỏ khoá `ky`.
    await waitFor(() => expect(new URLSearchParams(window.location.search).has("ky")).toBe(false));
  });

  it("có tiền chờ trả lại khách thì dải tab có mục đó; bấm vào thấy đơn, lý do, số còn phải trả", async () => {
    traLai.mockResolvedValue([{
      order_id: 9, order_code: "DH009", don_huy: true, customer_id: 3, customer_name: "Công ty An Phát",
      hoa_don_huy: ["12"], da_tra_lai: 0, con_lai: 1_000_000,
    }]);
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-chi&ky=tat_ca");
    render(<PaymentVouchersPage navigate={vi.fn()} />);
    const dai = screen.getByRole("group", { name: "Lọc theo trạng thái" });
    const tab = await within(dai).findByRole("button", { name: /Chờ trả lại khách/ });
    await waitFor(() => expect(tab).toHaveTextContent("1"));
    act(() => tab.click());
    expect(await screen.findByRole("button", { name: "DH009" })).toBeInTheDocument();
    expect(screen.getByText("Đơn đã hủy. Hóa đơn 12 đã hủy")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Lập phiếu chi" })).toHaveLength(2);
  });

  it("hóa đơn thu đủ còn CK / kê thì có tab Chờ chi CK / kê; tick khác khách bị khoá", async () => {
    const dong = (id: number, loai: "chiet_khau" | "ke_gia", khach: number) => ({
      sales_invoice_id: id, invoice_symbol: "1C26T", invoice_number: `000${id}`, invoice_date: "2026-10-20",
      order_id: id, order_code: `DH0${id}`, customer_id: khach, customer_name: `Khách ${khach}`, loai,
      tien: 5_000_000, thue_tndn: loai === "ke_gia" ? 1_000_000 : 0, phai_chi: 4_000_000, da_chi: 0, con: 4_000_000,
    });
    ckKe.mockResolvedValue([dong(1, "ke_gia", 3), dong(2, "ke_gia", 4)]);
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-chi&ky=tat_ca");
    render(<PaymentVouchersPage navigate={vi.fn()} />);
    const dai = screen.getByRole("group", { name: "Lọc theo trạng thái" });
    const tab = await within(dai).findByRole("button", { name: /Chờ chi CK \/ kê/ });
    await waitFor(() => expect(tab).toHaveTextContent("2"));
    act(() => tab.click());
    const o1 = await screen.findByRole("checkbox", { name: "Chọn Kê hóa đơn 0001" });
    act(() => o1.click());
    expect(screen.getByRole("checkbox", { name: "Chọn Kê hóa đơn 0002" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Khoản đã chọn" })).toHaveTextContent("Đã chọn 1 khoản kê của Khách 3");
  });

  it("tab Mua hàng chờ chi: mỗi khoản một dòng (cọc, từng đợt còn nợ) kèm nút lập phiếu; bấm dòng mở chi tiết khoản", async () => {
    const u = userEvent.setup();
    const dongDot = {
      id: 31, purchase_request_line_id: 41, item_name: "Giấy Duplex", unit: "tờ", quantity: 400, quantity_du: 0,
      kho_rong: 790, kho_dai: 1090, don_gia: 2_000, thanh_tien: 864_000,
    };
    const dotNo = {
      id: 21, seq_no: 1, con_no: 864_000, amount: 864_000, paid_amount: 0, coc_bu: 0,
      delivery_date: "2026-10-01", due_date: "2026-10-31", invoice_symbol: "1C26TAA", invoice_number: "0000777",
      invoice_date: "2026-10-01", lines: [dongDot],
      phieu_chi: [{ voucher_id: 5, code: "PC-261002-AB12", doc_no: "PC00031", amount: 64_000, voucher_date: "2026-10-02", gop: true }],
    };
    const daTra = { id: 22, seq_no: 2, con_no: 0, delivery_date: "2026-10-05", due_date: "2026-11-04", lines: [] };
    muaHangChoChi.mockResolvedValue([
      {
        don: {
          id: 9, code: "PMH26-0009", supplier_name: "Giấy Tân Mai", deposit_expected: 500_000, coc_da_chi: 100_000,
          tran_dat_coc: 400_000, deliveries: [dotNo, daTra], total_estimate: 2_200_000, gia_tri_da_giao: 864_000,
          net_paid: 100_000,
          coc_da_lap: [{ code: "PC-260930-CC01", doc_no: "PC00030", amount: 100_000, voucher_date: "2026-09-30" }],
          lines: [{ id: 41, item_name: "Giấy Duplex", unit: "tờ", quantity: 1000, kho_rong: 790, kho_dai: 1090,
            expected_unit_price: 2_000, discount_percent: 0, vat_percent: 8, line_total: 2_160_000 }],
        },
        coc_can_chi: 400_000, so_dot_no: 1, no_dot: 864_000, tong_can_chi: 1_264_000,
        han_gan_nhat: "2026-10-31", qua_han: false,
      },
    ]);
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-chi&ky=tat_ca");
    render(<PaymentVouchersPage navigate={() => {}} />);
    const dai = screen.getByRole("group", { name: "Lọc theo trạng thái" });
    const muc = await within(dai).findByRole("button", { name: /Mua hàng chờ chi/ });
    // Số đếm = số khoản: cọc + đúng một đợt còn nợ (đợt đã trả đủ không tính).
    await waitFor(() => expect(muc).toHaveTextContent("2"));

    await u.click(muc);
    const coc = await screen.findByRole("row", { name: /Cọc/ });
    expect([...coc.querySelectorAll("td")].map((c) => c.textContent)).toEqual(
      ["", "Giấy Tân Mai", "Cọc", "PMH26-0009", "", "500.000 đ", "100.000 đ", "400.000 đ", "Lập phiếu chi"]);
    const dot = screen.getByRole("row", { name: /Đợt 1/ });
    expect([...dot.querySelectorAll("td")].map((c) => c.textContent)).toEqual(
      ["", "Giấy Tân Mai", "Đợt 1", "HĐ 0000777 đơn PMH26-0009", "31/10/2026", "864.000 đ", "", "864.000 đ", "Lập phiếu chi"]);
    // Ký hiệu + ngày hoá đơn ở title của ô Nguồn (như bên Phiếu thu chỉ ghi số hoá đơn).
    expect(dot.querySelectorAll("td")[3]).toHaveAttribute("title", "Hóa đơn 1C26TAA 0000777 ngày 01/10/2026 đợt 1 đơn PMH26-0009");
    expect(screen.queryByRole("row", { name: /Đợt 2/ })).toBeNull();
    // Không đợt nào được cọc bù ⇒ không mọc cột Cọc trừ.
    expect(screen.queryByRole("columnheader", { name: "Cọc trừ" })).toBeNull();
    expect(dot.textContent).not.toMatch(/[·•]/);

    // Bấm dòng (ngoài nút) ⇒ popup kiểu B (17/10/2026): trái bảng hàng + lịch sử, phải Còn phải chi + nút
    // và Thông tin. Có cột VAT thì SL × đơn giá khác thành tiền mới đọc ra được; không có CK thì không cột CK.
    await u.click(within(dot).getByText("31/10/2026"));
    const popup = screen.getByRole("dialog", { name: "Đợt 1 đơn PMH26-0009" });
    const ls = within(popup).getByRole("list", { name: "Lịch sử" });
    expect(within(ls).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "01/10/2026Nhận hàng đợt 1864.000 đ",
      "02/10/2026Phiếu chi PC00031 phiếu gộp−64.000 đ",
    ]);
    const con = within(popup).getByRole("region", { name: "Còn phải chi" });
    expect(con).toHaveTextContent("864.000 đ");
    expect(within(popup).getByText("Hạn chi").nextElementSibling).toHaveTextContent("31/10/2026");
    const hang = within(popup).getByRole("row", { name: /Giấy Duplex/ });
    expect(hang).toHaveTextContent("790×1090");
    expect(hang).toHaveTextContent("400");
    expect(hang).toHaveTextContent("8%");
    expect(hang).toHaveTextContent("864.000");
    expect(within(popup).getByRole("columnheader", { name: "VAT" })).toBeInTheDocument();
    expect(within(popup).queryByRole("columnheader", { name: "CK" })).toBeNull();
    expect(within(con).getByRole("button", { name: "Lập phiếu chi" })).toBeInTheDocument();
    expect(popup.textContent).not.toMatch(/[·•]/);
    await u.keyboard("{Escape}");

    // Cọc kể hàng đã đặt của cả đơn; lịch sử là các phiếu cọc đã chi.
    await u.click(within(coc).getByText("Giấy Tân Mai"));
    const popupCoc = screen.getByRole("dialog", { name: "Cọc đơn PMH26-0009" });
    expect(within(popupCoc).getByRole("row", { name: /Giấy Duplex/ })).toHaveTextContent("2.160.000");
    expect(within(within(popupCoc).getByRole("list", { name: "Lịch sử" })).getByRole("listitem"))
      .toHaveTextContent("30/09/2026Phiếu chi cọc PC00030−100.000 đ");
    expect(within(popupCoc).getByRole("region", { name: "Cọc còn phải chi" })).toHaveTextContent("400.000 đ");
    expect(within(popupCoc).getByRole("button", { name: "Lập phiếu chi cọc" })).toBeInTheDocument();
  });

  it("tick nhiều khoản cùng NCC: khoản NCC khác bị khoá; dải chân đếm khoản và mở form một phiếu chi", async () => {
    const u = userEvent.setup();
    const don = (id: number, code: string, supplier_id: number, supplier_name: string, coc: number, dot?: object) => ({
      don: { id, code, supplier_id, supplier_name, deposit_expected: coc, coc_da_chi: 0, tran_dat_coc: coc,
        deliveries: dot ? [dot] : [], lines: [], total_estimate: 2_000_000, gia_tri_da_giao: 0, net_paid: 0 },
      coc_can_chi: coc, so_dot_no: dot ? 1 : 0, no_dot: 0, tong_can_chi: coc, han_gan_nhat: null, qua_han: false,
    });
    muaHangChoChi.mockResolvedValue([
      don(9, "PMH26-0009", 1, "Giấy Tân Mai", 400_000),
      don(10, "PMH26-0010", 1, "Giấy Tân Mai", 0, {
        id: 21, seq_no: 1, con_no: 864_000, amount: 864_000, paid_amount: 0, coc_bu: 0,
        delivery_date: "2026-10-01", due_date: "2026-10-31", invoice_number: null, invoice_date: null, lines: [],
      }),
      don(11, "PMH26-0011", 2, "Mực Sakata", 300_000),
    ]);
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-chi&ky=tat_ca&the=mh");
    render(<PaymentVouchersPage navigate={() => {}} />);
    const tick = await screen.findByRole("checkbox", { name: "Chọn Cọc của PMH26-0009" });
    await u.click(tick);
    const khac = screen.getByRole("checkbox", { name: "Chọn Cọc của PMH26-0011" });
    expect(khac).toBeDisabled();
    expect(khac.closest("label") ?? khac).toHaveAttribute("title", "Khác nhà cung cấp");
    await u.click(screen.getByRole("checkbox", { name: "Chọn Đợt 1 của PMH26-0010" }));
    const chan = screen.getByRole("region", { name: "Khoản đã chọn" });
    expect(chan).toHaveTextContent("Đã chọn 2 khoản của Giấy Tân Mai");
    expect(chan).toHaveTextContent("1.264.000 đ");
    await u.click(within(chan).getByRole("button", { name: "Lập một phiếu chi" }));
    const form = await screen.findByRole("dialog", { name: "Lập phiếu chi 2 khoản" });
    const bang = within(form).getByRole("table", { name: "Các khoản trong phiếu" });
    expect(within(bang).getAllByRole("row")).toHaveLength(3);
    // Bỏ chọn ⇒ dải chân biến mất, khoản NCC khác mở lại.
    await u.keyboard("{Escape}");
    await u.click(within(screen.getByRole("region", { name: "Khoản đã chọn" })).getByRole("button", { name: "Bỏ chọn" }));
    expect(screen.queryByRole("region", { name: "Khoản đã chọn" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Chọn Cọc của PMH26-0011" })).toBeEnabled();
  });

  it("mở từ link của ngăn Đơn mua hàng: đứng ở tab Mua hàng chờ chi, ô tìm lọc sẵn đơn đó", async () => {
    muaHangChoChi.mockResolvedValue([
      {
        don: { id: 9, code: "PMH26-0009", supplier_name: "Giấy Tân Mai", deposit_expected: 500_000, coc_da_chi: 0,
          tran_dat_coc: 500_000, deliveries: [], lines: [], total_estimate: 500_000, gia_tri_da_giao: 0, net_paid: 0 },
        coc_can_chi: 500_000, so_dot_no: 0, no_dot: 0, tong_can_chi: 500_000, han_gan_nhat: null, qua_han: false,
      },
    ]);
    window.history.replaceState(null, "", "/?man=ke-toan-phieu-chi&ky=tat_ca");
    render(<PaymentVouchersPage navigate={() => {}} focusChoChi="PMH26-0009" />);
    // Ô tìm điền sẵn mã đơn ⇒ chỉ còn các khoản của đơn đó.
    expect(await screen.findByRole("row", { name: /Cọc/ })).toHaveTextContent("PMH26-0009");
    expect(screen.getByRole("textbox", { name: "Tìm đơn mua chờ chi" })).toHaveValue("PMH26-0009");
  });
});
