/** Ngăn khách hàng — kiểu 3 (07/10/2026: nội dung trái, cột thuộc tính phải) + ngăn chồng "Thu tiền"
 *  một hoá đơn (NPTh-3).
 *
 *  Khoá chặt: thẻ mã; cột thuộc tính Còn nợ tới hôm nay | Quá hạn | Hạn sớm nhất | Hạn mức (đã dùng %)
 *  + Cho nợ (hoặc một mục "chưa đặt" kèm Đặt trong hồ sơ) | Người liên hệ | Phụ trách, KHÔNG thẻ / dải
 *  vượt hạn mức nào khác; ba tab Còn nợ | Sao kê | Lịch sử; một lưới hoá đơn nhóm theo đơn bán, Trừ cọc
 *  và Đã thu là hai cột, "Thu" từng hoá đơn; sao kê có số dư chạy và in được; lịch
 *  sử mới nhất trên cùng; tick nhiều hoá đơn ⇒ MỘT phiếu thu gộp (17/10/2026); lập phiếu xong dòng hoá đơn đổi ngay; không nối mẩu thông tin bằng "·" / "•"
 *  / dấu phẩy.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgingBucket, ReceivablesDetail, SoChiTietCongNo } from "../../../../api/client";

const receivablesDetail = vi.fn();
const saoKeDoiTac = vi.fn();
const companyAccounts = vi.fn();
const createSalesInvoiceReceipt = vi.fn();
const createReceiptGop = vi.fn();
const contacts = vi.fn();

vi.mock("../../../../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));
vi.mock("../../../../api/client", async (g) => ({
  ...(await g<typeof import("../../../../api/client")>()),
  api: {
    accounting: {
      receivablesDetail: (...a: unknown[]) => receivablesDetail(...a),
      saoKeDoiTac: (...a: unknown[]) => saoKeDoiTac(...a),
      companyAccounts: (...a: unknown[]) => companyAccounts(...a),
      createSalesInvoiceReceipt: (...a: unknown[]) => createSalesInvoiceReceipt(...a),
      createReceiptGop: (...a: unknown[]) => createReceiptGop(...a),
    },
    customers: { contacts: (...a: unknown[]) => contacts(...a) },
  },
}));

import { ReceivablesDrawer } from "./ReceivablesDrawer";

const hd = {
  customer_id: 12, customer_name: "Thực phẩm An Phát", chua_dat_han: false, direct_received_amount: 0,
  deposit_offset_amount: 0, received_amount: 0,
};

const AGING: AgingBucket[] = [
  { key: "chua_toi_han", label: "Chưa tới hạn", amount: 150_000_000, count: 2 },
  { key: "d1_7", label: "Trễ 1–7 ngày", amount: 0, count: 0 },
  { key: "d8_15", label: "Trễ 8–15 ngày", amount: 0, count: 0 },
  { key: "d16_30", label: "Trễ 16–30 ngày", amount: 0, count: 0 },
  { key: "d31_60", label: "Trễ 31–60 ngày", amount: 36_000_000, count: 1 },
  { key: "d60_plus", label: "Trễ > 60 ngày", amount: 0, count: 0 },
];

function chiTiet(p: Partial<ReceivablesDetail> = {}): ReceivablesDetail {
  return {
    customer_id: 12, customer_name: "Thực phẩm An Phát", credit_limit: 250_000_000, payment_term_days: 30,
    vuot_han_muc: false, vuot_bao_nhieu: 0,
    items: [
      { ...hd, invoice_id: 1, invoice_symbol: "1C26TSV", invoice_number: "0001198", invoice_date: "2026-07-21",
        order_id: 40, order_code: "DH-0398", due_date: "2026-08-20", overdue_days: 46, aging_bucket: "d31_60",
        amount: 36_000_000, remaining_amount: 36_000_000 },
      { ...hd, invoice_id: 2, invoice_symbol: "1C26TSV", invoice_number: "0001234", invoice_date: "2026-09-22",
        order_id: 41, order_code: "DH-0412", due_date: "2026-10-22", overdue_days: 0, aging_bucket: null,
        amount: 96_000_000, deposit_offset_amount: 20_000_000, direct_received_amount: 32_000_000,
        received_amount: 52_000_000, remaining_amount: 44_000_000 },
      { ...hd, invoice_id: 3, invoice_symbol: null, invoice_number: "0001251", invoice_date: "2026-10-01",
        order_id: 42, order_code: "DH-0420", due_date: null, chua_dat_han: true, overdue_days: 0, aging_bucket: null,
        amount: 106_000_000, remaining_amount: 106_000_000 },
    ],
    paid: [],
    paid_total: 0,
    period_months: 3, all_history: false, total_due: 186_000_000, overdue_amount: 36_000_000, aging: AGING,
    received_in_period: 2_000_000, as_of: "2026-10-05",
    lien_he_ten: "Lê Thu Trang", lien_he_sdt: "0912345678", phu_trach: "Nguyễn Thị Huyền",
    ...p,
  };
}

/** Sổ TK 131: hoá đơn ghi nợ, phiếu thu ghi có. Đầu kỳ khách nợ 36 tr. */
function soCai(p: Partial<SoChiTietCongNo> = {}): SoChiTietCongNo {
  return {
    tk: "131", tieu_de: "Sổ chi tiết", doi_tuong_id: 12, ma: "KH012", ten: "Thực phẩm An Phát",
    tu_ngay: "2026-10-01", den_ngay: "2026-10-31", dau_no: 36_000_000, dau_co: 0, hoan: 0,
    dong: [
      { ngay: "2026-10-01", luc: null, loai: "hoa_don", so_ct: "1C26TSV 0001251", ky_hieu: "1C26TSV", don_id: 40,
        dien_giai: "Hoá đơn bán hàng", no: 106_000_000, co: 0, luy_ke_no: 142_000_000, luy_ke_co: 0 },
      { ngay: "2026-10-03", luc: null, loai: "phieu_thu", so_ct: "PT-300", dien_giai: "Thu tiền hoá đơn 0001234",
        no: 0, co: 32_000_000, luy_ke_no: 110_000_000, luy_ke_co: 0 },
    ],
    ps_no: 106_000_000, ps_co: 32_000_000, cuoi_no: 110_000_000, cuoi_co: 0, so_dong: 2,
    ...p,
  };
}

const KY = { tu: "2026-10-01", den: "2026-10-31" };
const navigate = vi.fn();
const onChanged = vi.fn();
const onClose = vi.fn();
const QUYEN = { thu: true, xemPhieuThu: true, xemKhach: true, xemDonBan: true };

function ve(o: {
  eventTick?: number; bucket?: "all" | "overdue" | "paid"; tuoi?: { khoa: string; nhan: string } | null;
  len?: () => void; xuong?: () => void;
} = {}) {
  return (
    <ReceivablesDrawer customerId={12} customerName="Thực phẩm An Phát" ma="KH012" bucket={o.bucket ?? "all"}
      tuoi={o.tuoi ?? null} ky={KY} eventTick={o.eventTick ?? 0} quyen={QUYEN} navigate={navigate} onClose={onClose}
      onChanged={onChanged} len={o.len} xuong={o.xuong} />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  receivablesDetail.mockImplementation(async () => chiTiet());
  saoKeDoiTac.mockImplementation(async (_t, _ben, _id, ky: { tuNgay: string; denNgay: string }) =>
    soCai({ tu_ngay: ky.tuNgay, den_ngay: ky.denNgay }));
  contacts.mockResolvedValue({ items: [] });
  companyAccounts.mockResolvedValue([
    { id: 4, bank_name: "MB", account_number: "93313466 8", currency: "VND", is_active: true },
  ]);
});

async function moNgan(o?: Parameters<typeof ve>[0]) {
  render(ve(o));
  // Tab nhớ theo màn (bài trước có thể đã để ở Lịch sử) — đưa về Còn nợ.
  await userEvent.click(await screen.findByRole("tab", { name: /Còn nợ/ }));
}

describe("ReceivablesDrawer — đầu ngăn", () => {
  it("tên + thẻ mã; cột thuộc tính còn nợ, quá hạn, hạn sớm nhất, hạn mức, cho nợ, liên hệ, phụ trách; ba tab; hồ sơ khách", async () => {
    await moNgan();
    expect(screen.getByRole("heading", { name: "Thực phẩm An Phát" })).toBeInTheDocument();
    expect(screen.getByText("KH012")).toHaveClass("kt-the");
    expect(document.querySelector(".kt-ndt")).toBeNull();
    expect(screen.queryByRole("group", { name: "Lọc theo tuổi nợ" })).toBeNull();
    const cot = screen.getByRole("complementary", { name: "Thuộc tính" });
    const muc = (nhan: string) => within(cot).getByText(nhan).nextElementSibling as HTMLElement;
    expect(within(muc("Còn nợ tới 05/10/2026")).getByText("186.000.000 đ")).toHaveStyle({ fontSize: "18px" });
    expect(within(muc("Quá hạn")).getByText("36.000.000 đ")).toHaveClass("kt-do");
    expect(muc("Hạn sớm nhất")).toHaveTextContent("20/08/2026trễ 46 ngày");
    expect(muc("Hạn mức")).toHaveTextContent("250.000.000 đđã dùng 74%");
    expect(within(muc("Hạn mức")).getByText("đã dùng 74%")).not.toHaveClass("kt-do");
    expect(muc("Cho nợ")).toHaveTextContent("30 ngày sau mỗi hoá đơn");
    expect(muc("Người liên hệ")).toHaveTextContent("Lê Thu Trang0912 345 678");
    expect(muc("Phụ trách")).toHaveTextContent("Nguyễn Thị Huyền");
    expect(within(cot).queryByText("Tài khoản nhận tiền")).toBeNull();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Còn nợ3", "Sao kê", "Lịch sử"]);
    await userEvent.click(screen.getByRole("button", { name: "Hồ sơ khách hàng" }));
    expect(navigate).toHaveBeenCalledWith("khach-hang", { openCustomerId: 12 });
  });

  it("vượt hạn mức: chỉ nói ở mục Hạn mức (phần trăm đỏ, giải thích ở tooltip) — không thẻ cạnh tên, không dải cảnh báo", async () => {
    receivablesDetail.mockImplementation(async () =>
      chiTiet({ credit_limit: 150_000_000, vuot_han_muc: true, vuot_bao_nhieu: 36_000_000 }));
    await moNgan();
    const vuot = screen.getByText("đã dùng 124%");
    expect(vuot).toHaveClass("kt-do");
    expect(vuot).toHaveAttribute("title", "Chỉ là cảnh báo, vẫn bán và thu bình thường.");
    expect(screen.queryByText("Vượt hạn mức")).toBeNull();
    expect(document.querySelector(".kt-canh")).toBeNull();
  });

  it("có hạn mức mà chưa đặt cho nợ: hai mục riêng, Cho nợ 'chưa đặt'", async () => {
    receivablesDetail.mockImplementation(async () => chiTiet({ payment_term_days: null }));
    await moNgan();
    const cot = screen.getByRole("complementary", { name: "Thuộc tính" });
    expect(within(cot).getByText("Cho nợ").nextElementSibling).toHaveTextContent("chưa đặt");
    expect(within(cot).queryByRole("button", { name: "Đặt trong hồ sơ" })).toBeNull();
  });

  it("thiếu cả hạn mức và cho nợ: một mục chưa đặt + Đặt trong hồ sơ; cột Hạn thu chỉ gạch mờ, không lặp chữ", async () => {
    receivablesDetail.mockImplementation(async () => chiTiet({ credit_limit: 0, payment_term_days: null }));
    await moNgan();
    const cot = screen.getByRole("complementary", { name: "Thuộc tính" });
    expect(within(cot).queryByText("Hạn mức")).toBeNull();
    expect(within(cot).getByText("Hạn mức và cho nợ").nextElementSibling).toHaveTextContent("chưa đặtĐặt trong hồ sơ");
    const dong = screen.getByText("0001251").closest("tr")!;
    expect(dong.querySelectorAll("td")[3].textContent).toBe("–");
    expect(screen.queryByText(/chưa đặt hạn/)).toBeNull();
    await userEvent.click(within(cot).getByRole("button", { name: "Đặt trong hồ sơ" }));
    expect(navigate).toHaveBeenCalledWith("khach-hang", { openCustomerId: 12 });
  });
});

describe("ReceivablesDrawer — tab Còn nợ", () => {
  it("một lưới nhóm theo đơn bán: số và ký hiệu hai cột, ngày đủ năm, hạn chỉ ngày tô màu; Trừ cọc và Đã thu tách cột", async () => {
    await moNgan();
    const bang = screen.getByRole("table", { name: "Hoá đơn còn nợ" });
    expect(within(bang).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(
      ["Số hoá đơn", "Ký hiệu", "Ngày", "Hạn thu", "Giá trị", "Trừ cọc", "Đã thu", "Còn nợ", ""]);
    expect(within(bang).getByRole("columnheader", { name: "Trừ cọc" })).toBeInTheDocument();
    expect(within(bang).getByRole("columnheader", { name: "Đã thu" })).toBeInTheDocument();
    // Ô tick nằm trong ô Số hoá đơn — không thêm cột (bảng vừa khung ngăn).
    expect(within(bang).getAllByRole("checkbox")).toHaveLength(3);

    const dong = screen.getByText("0001198").closest("tr")!;
    expect([...dong.querySelectorAll("td")].map((c) => c.textContent)).toEqual(
      ["0001198", "1C26TSV", "21/07/2026", "20/08/2026", "36.000.000", "–", "–", "36.000.000", "Thu"]);
    expect(within(dong).getByText("1C26TSV")).toHaveClass("lds-mu");
    // Ô hạn chỉ ghi ngày (bảng vừa khung ngăn): trễ thì ngày đỏ.
    expect(within(dong).getByText("20/08/2026")).toHaveClass("lds-do");
    expect(dong.textContent).not.toMatch(/[·•]|, /);

    const dong2 = screen.getByText("0001234").closest("tr")!;
    expect([...dong2.querySelectorAll("td")].slice(3, 8).map((c) => c.textContent)).toEqual(
      ["22/10/2026", "96.000.000", "20.000.000", "32.000.000", "44.000.000"]);
    expect(within(dong2).getByText("22/10/2026")).not.toHaveClass("lds-do");
    // Khách CÓ đặt cho nợ mà hoá đơn chưa có hạn (hoá đơn cũ): nói rõ.
    expect(screen.getByText("0001251").closest("tr")!.querySelectorAll("td")[3]).toHaveTextContent("chưa đặt hạn");

    // Dòng nhóm: mã đơn mở Đơn hàng bán, "1 hoá đơn", 4 ô tổng; dòng Cộng cuối.
    const nhom = within(bang).getByRole("button", { name: "DH-0398" }).closest("tr")!;
    expect(nhom).toHaveClass("lds-nhom");
    expect(nhom).toHaveTextContent("DH-03981 hoá đơn");
    // Dòng nhóm và dòng Cộng phủ đúng số cột tiêu đề — tách cột Ký hiệu từng làm hai dòng này lệch trái.
    const soCot = within(bang).getAllByRole("columnheader").length;
    const tongCot = (r: Element) => [...r.querySelectorAll("td")].reduce((t, c) => t + (c as HTMLTableCellElement).colSpan, 0);
    expect(tongCot(nhom)).toBe(soCot);
    expect(tongCot(within(bang).getByText("Cộng 3 hoá đơn").closest("tr")!)).toBe(soCot);
    expect(nhom.querySelectorAll("td")[1]).toHaveTextContent("36.000.000");
    expect(within(bang).getByText("Cộng 3 hoá đơn").closest("tr")!.querySelectorAll("td")[1]).toHaveTextContent("238.000.000");

    await userEvent.click(within(nhom).getByRole("button", { name: "DH-0398" }));
    expect(navigate).toHaveBeenCalledWith("don-hang-ban", { openOrderId: 40, openOrderChang: "hoadon" });
    expect(screen.getByRole("dialog").textContent).not.toMatch(/[·•]/);
  });

  it("Hạn thu: bỏ dòng nhóm, xếp hoá đơn theo hạn tăng dần, chưa có hạn ở cuối", async () => {
    await moNgan();
    await userEvent.click(within(screen.getByRole("group", { name: "Xếp theo" })).getByRole("button", { name: "Hạn thu" }));
    const bang = screen.getByRole("table", { name: "Hoá đơn còn nợ" });
    expect(bang.querySelector(".lds-nhom")).toBeNull();
    expect(within(bang).getAllByRole("columnheader").slice(0, 3).map((c) => c.textContent))
      .toEqual(["Số hoá đơn", "Ký hiệu", "Đơn bán"]);
    const o = [...bang.querySelectorAll("tbody tr:not(.lds-cong)")]
      .map((r) => [...r.querySelectorAll("td")].slice(0, 3).map((c) => c.textContent).join(" "));
    // Không còn dòng nhóm ⇒ mã đơn bán có cột riêng.
    expect(o).toEqual(["0001198 1C26TSV DH-0398", "0001234 1C26TSV DH-0412", "0001251  DH-0420"]);
  });

  it("ô hạn hẹp: chỉ ngày, số ngày trễ ở title và cột thuộc tính", async () => {
    const goc = chiTiet();
    receivablesDetail.mockImplementation(async () => ({
      ...goc, items: [{ ...goc.items[0], due_date: "2026-06-01", overdue_days: 126, aging_bucket: "d60_plus" }],
    }));
    await moNgan();
    const o = within(screen.getByRole("table", { name: "Hoá đơn còn nợ" })).getByText("01/06/2026").closest("td")!;
    expect(o).toHaveTextContent(/^01\/06\/2026$/);
    expect(o).toHaveAttribute("title", "01/06/2026 trễ 126 ngày");
    // Cột thuộc tính rộng: nói đủ.
    expect(within(screen.getByRole("complementary", { name: "Thuộc tính" })).getByText("trễ 126 ngày")).toBeInTheDocument();
  });

  it("tiền trả lại khách ngoài đơn là dòng phụ dưới hoá đơn, không thêm cột; dòng tổng cộng cả dòng phụ", async () => {
    const goc = chiTiet();
    receivablesDetail.mockImplementation(async () => ({
      ...goc, items: [{ ...goc.items[0], hoan_khong_don: 5_000_000, remaining_amount: 41_000_000 }],
    }));
    await moNgan();
    const bang = screen.getByRole("table", { name: "Hoá đơn còn nợ" });
    expect(within(bang).getAllByRole("columnheader")).toHaveLength(9);
    const phu = within(bang).getByText("Trả lại khách ngoài đơn").closest("tr")!;
    expect(phu.previousElementSibling).toHaveTextContent("0001198");
    expect(phu.querySelectorAll("td")[1]).toHaveTextContent("+5.000.000");
    const tongCot = (r: Element) => [...r.querySelectorAll("td")].reduce((t, c) => t + (c as HTMLTableCellElement).colSpan, 0);
    expect(tongCot(phu)).toBe(9);
    // Giá trị dòng Cộng = 36.000.000 + 5.000.000 ⇒ Giá trị − Trừ cọc − Đã thu = Còn nợ.
    const cong = within(bang).getByText("Cộng 1 hoá đơn").closest("tr")!;
    expect([...cong.querySelectorAll("td")].slice(1, 5).map((c) => c.textContent))
      .toEqual(["41.000.000", "–", "–", "41.000.000"]);
  });

  it("mở từ danh sách đang lọc mốc tuổi / bấm số Quá hạn: lọc sẵn và hiện thẻ lọc; Bỏ lọc hiện lại đủ", async () => {
    await moNgan({ tuoi: { khoa: "chua_toi_han", nhan: "Chưa tới hạn" } });
    expect(screen.queryByText("0001198")).toBeNull();
    expect(screen.getByText("0001251")).toBeInTheDocument();
    expect(screen.getByText("Chưa tới hạn", { selector: ".kt-chip--loc" })).toHaveTextContent("Chưa tới hạn2");
    await userEvent.click(screen.getByRole("button", { name: "Bỏ lọc" }));
    expect(screen.getByText("0001198")).toBeInTheDocument();
  });

  it("bấm số Quá hạn ngoài bảng: thẻ lọc Quá hạn", async () => {
    await moNgan({ bucket: "overdue" });
    expect(screen.getByText("Quá hạn", { selector: ".kt-chip--loc" })).toHaveTextContent("Quá hạn1");
    expect(screen.queryByText("0001234")).toBeNull();
  });

  it("sự kiện đẩy nạp lại ngăn", async () => {
    const { rerender } = render(ve());
    await screen.findByRole("tab", { name: /Còn nợ/ });
    receivablesDetail.mockClear();
    rerender(ve({ eventTick: 1 }));
    await waitFor(() => expect(receivablesDetail).toHaveBeenCalledTimes(1));
  });
});

describe("ReceivablesDrawer — Sao kê và Lịch sử", () => {
  it("bấm số Đã thu ngoài bảng mở thẳng Sao kê: đầu kỳ, số dư chạy, cuối kỳ; số hoá đơn và ký hiệu hai cột; phiếu thu và hoá đơn mở được", async () => {
    render(ve({ bucket: "paid" }));
    const bang = await screen.findByRole("table");
    expect(saoKeDoiTac).toHaveBeenCalledWith("token-test", "receivables", 12, { tuNgay: KY.tu, denNgay: KY.den });
    const dong = within(bang).getAllByRole("row").slice(1).map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent));
    expect(dong).toEqual([
      ["01/10/2026", "", "Số dư đầu kỳ", "", "", "36.000.000"],
      ["01/10/2026", "0001251", "1C26TSV", "Hoá đơn bán hàng", "106.000.000", "", "142.000.000"],
      ["03/10/2026", "PT-300", "", "Thu tiền hoá đơn 0001234", "", "32.000.000", "110.000.000"],
      ["31/10/2026", "", "Số dư cuối kỳ", "106.000.000", "32.000.000", "110.000.000"],
    ]);
    expect(screen.getByText("Số dư = khách còn nợ mình")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "PT-300" }));
    expect(navigate).toHaveBeenCalledWith("ke-toan-phieu-thu", { focusReceiptQuery: "PT-300" });
    // Hoá đơn không có màn riêng: bấm số mở đơn bán của nó.
    await userEvent.click(within(bang).getByRole("button", { name: "0001251" }));
    expect(navigate).toHaveBeenCalledWith("don-hang-ban", { openOrderId: 40, openOrderChang: "hoadon" });
  });

  it("đổi kỳ sao kê thì tải lại đúng khoảng; Tuỳ chọn ngược thì báo, không gọi máy chủ", async () => {
    render(ve({ bucket: "paid" }));
    await screen.findByRole("table");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Kỳ sao kê" }), "namtruoc");
    await waitFor(() => expect(saoKeDoiTac).toHaveBeenLastCalledWith("token-test", "receivables", 12,
      { tuNgay: expect.stringMatching(/-01-01$/), denNgay: expect.stringMatching(/-12-31$/) }));
    saoKeDoiTac.mockClear();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Kỳ sao kê" }), "tuy");
    // Ô ngày tự vẽ (ChonNgay): gõ dd/mm/yyyy, rời ô (Tab) là chốt; max = hôm nay nên lùi "đến" trước rồi đẩy "từ" qua nó.
    const den = screen.getByLabelText("Đến ngày");
    await userEvent.clear(den);
    await userEvent.type(den, "02/10/2026");
    await userEvent.tab();
    const tu = screen.getByLabelText("Từ ngày");
    await userEvent.clear(tu);
    await userEvent.type(tu, "05/10/2026");
    await userEvent.tab();
    expect(await screen.findByText("Ngày bắt đầu phải trước ngày kết thúc.")).toBeInTheDocument();
    expect(saoKeDoiTac).not.toHaveBeenCalledWith("token-test", "receivables", 12, { tuNgay: "2026-10-05", denNgay: "2026-10-02" });
  });

  it("In sao kê: sang tab Sao kê và mở bản in có tên, mã, kỳ, bảng và chỗ ký", async () => {
    await moNgan();
    await userEvent.click(screen.getByRole("button", { name: "In sao kê" }));
    expect(screen.getByRole("tab", { name: "Sao kê" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("SAO KÊ CÔNG NỢ")).toBeInTheDocument();
    const ban = document.querySelector(".psheet") as HTMLElement;
    expect(ban).toHaveTextContent("Thực phẩm An Phát");
    expect(ban).toHaveTextContent("KH012");
    expect(ban).toHaveTextContent("01/10/2026 đến 31/10/2026");
    expect(within(ban).getByText("Xác nhận của khách hàng")).toBeInTheDocument();
    // Bản in không có link mở phiếu.
    expect(within(ban).queryByRole("button", { name: "PT-300" })).toBeNull();
    // Esc lúc đang xem bản in không đóng ngăn.
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(within(document.querySelector(".ps-dialog-actions") as HTMLElement).getByRole("button", { name: "Đóng" }));
    expect(document.querySelector(".psheet")).toBeNull();
  });

  it("Lịch sử: mọi chứng từ từ đầu tới hôm nay, mới nhất trên cùng, kèm việc hoá đơn trễ hạn", async () => {
    await moNgan();
    await userEvent.click(screen.getByRole("tab", { name: "Lịch sử" }));
    await waitFor(() => expect(saoKeDoiTac).toHaveBeenLastCalledWith("token-test", "receivables", 12,
      { tuNgay: "2000-01-01", denNgay: "2026-10-05" }));
    const viec = [...document.querySelectorAll(".kt-ls__muc")].map((m) => [
      m.querySelector("b")!.textContent, m.querySelector(".kt-ls__gio")!.textContent]);
    expect(viec).toEqual([
      ["Thu 32.000.000 đ", "03/10/2026"],
      ["Xuất hoá đơn 1C26TSV 0001251", "01/10/2026"],
      ["Hoá đơn số 0001198 quá hạn chưa thu đủ", "21/08/2026"],
    ]);
  });
});

/** Bấm "Thu" ở dòng hoá đơn ⇒ ngăn chồng (lớp thứ hai, role dialog) mang tên hoá đơn. */
async function moThu(soHd: string, o?: Parameters<typeof ve>[0]) {
  await moNgan(o);
  await userEvent.click(screen.getByRole("button", { name: `Thu tiền hoá đơn số ${soHd}` }));
  return screen.findByRole("dialog", { name: new RegExp(`Thu tiền hoá đơn ${soHd}`) });
}

describe("ReceivablesDrawer — Thu tiền (NPTh-3)", () => {
  it("mở NGĂN CHỒNG trên ngăn khách; lập xong ngăn chồng đóng, dòng đổi ngay, thông báo đáy, Xem phiếu sang Phiếu thu", async () => {
    const ngan = await moThu("0001198");
    expect(screen.getAllByRole("dialog")).toHaveLength(2);

    // Nạp lại sau khi lập chưa về: dòng vẫn phải đổi ngay.
    createSalesInvoiceReceipt.mockResolvedValue({ id: 900, code: "PT-261006-AB12", amount_vnd: 10_000_000 });
    receivablesDetail.mockImplementation(() => new Promise(() => {}));
    const o = within(ngan).getByRole("textbox", { name: /Số tiền thu/ });
    await userEvent.clear(o);
    await userEvent.type(o, "10000000");
    await userEvent.click(within(ngan).getByRole("button", { name: "Lập phiếu thu" }));

    expect(await screen.findByText("Đã lập PT-261006-AB12")).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const dongMoi = screen.getByText("0001198").closest("tr")!;
    expect(dongMoi.querySelectorAll("td")[7]).toHaveTextContent("26.000.000");
    expect(dongMoi.querySelectorAll("td")[6]).toHaveTextContent("10.000.000");
    expect(onChanged).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Xem phiếu" }));
    expect(navigate).toHaveBeenCalledWith("ke-toan-phieu-thu", { focusReceiptQuery: "PT-261006-AB12" });
  });
});

describe("ReceivablesDrawer — giữ nháp ngăn Thu tiền", () => {
  it("gõ dở rồi Esc: hỏi bằng hộp của app; Nhập tiếp thì ở lại, Bỏ thì chỉ đóng ngăn chồng, ngăn khách còn", async () => {
    const ngan = await moThu("0001198");
    await userEvent.type(within(ngan).getByRole("textbox", { name: /Người nộp tiền/ }), "x");
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByText("Bỏ phiếu đang nhập?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Nhập tiếp" }));
    expect(screen.getByRole("dialog", { name: /Thu tiền hoá đơn 0001198/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(await screen.findByRole("button", { name: "Bỏ" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Thu tiền hoá đơn/ })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /Còn nợ/ })).toBeInTheDocument();
  });

  it("chưa gõ gì: Esc đóng ngăn chồng không hỏi", async () => {
    await moThu("0001234");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Thu tiền hoá đơn/ })).toBeNull());
    expect(screen.queryByText("Bỏ phiếu đang nhập?")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("phím ↑ ↓ thuộc lớp trên cùng: ngăn chồng đang mở thì không sang khách khác", async () => {
    const len = vi.fn();
    const xuong = vi.fn();
    const ngan = await moThu("0001198", { len, xuong });
    await userEvent.click(within(ngan).getByRole("radio", { name: "Chuyển khoản" }));
    await userEvent.keyboard("{ArrowDown}");
    expect(xuong).not.toHaveBeenCalled();
  });
});

describe("ReceivablesDrawer — thu nhiều hoá đơn một phiếu (17/10/2026)", () => {
  it("tick 2 hoá đơn ⇒ chân 'Đã chọn 2 hoá đơn' + 'Lập một phiếu thu' mở form gộp; lập xong báo mã phiếu và nạp lại", async () => {
    createReceiptGop.mockResolvedValue({ id: 901, code: "PT-0401", amount_vnd: 80_000_000, amount: 80_000_000 });
    await moNgan();
    await userEvent.click(screen.getByRole("checkbox", { name: "Chọn hoá đơn số 0001198" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Chọn hoá đơn số 0001234" }));
    const chan = screen.getByText(/Đã chọn 2 hoá đơn/).closest(".kt-ngan__chan") as HTMLElement;
    expect(chan).toHaveTextContent("80.000.000 đ");
    await userEvent.click(within(chan).getByRole("button", { name: "Lập một phiếu thu" }));
    const ngan = await screen.findByRole("dialog", { name: "Lập phiếu thu 2 khoản" });
    expect(within(ngan).getByRole("textbox", { name: "Thu lần này DH-0398 HĐ 0001198" })).toHaveValue("36.000.000");
    expect(within(ngan).getByRole("textbox", { name: "Thu lần này DH-0412 HĐ 0001234" })).toHaveValue("44.000.000");
    const goiTruoc = receivablesDetail.mock.calls.length;
    await userEvent.click(within(ngan).getByRole("button", { name: "Lập phiếu thu" }));
    await waitFor(() => expect(createReceiptGop).toHaveBeenCalledTimes(1));
    expect(createReceiptGop.mock.calls[0][1].lines).toStrictEqual([
      { sales_invoice_id: 1, order_id: 40, amount: 36_000_000 },
      { sales_invoice_id: 2, order_id: 41, amount: 44_000_000 },
    ]);
    expect(await screen.findByText("Đã lập PT-0401")).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await waitFor(() => expect(receivablesDetail.mock.calls.length).toBeGreaterThan(goiTruoc));
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByText(/Đã chọn 2 hoá đơn/)).toBeNull();
  });
});
