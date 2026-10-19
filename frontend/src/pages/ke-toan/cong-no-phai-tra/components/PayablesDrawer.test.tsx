/** Ngăn nhà cung cấp — kiểu 3 (07/10/2026: nội dung trái, cột thuộc tính phải) + ngăn chồng "Trả nhiều
 *  đợt" (NPT-3).
 *
 *  Khoá chặt: ba tab Còn nợ | Sao kê | Lịch sử; số trên tab Còn nợ = số đợt CÒN nợ (lỗi 7); cột thuộc
 *  tính có còn nợ, quá hạn, hạn sớm nhất, hạn mức (đã dùng %), cho nợ, người liên hệ, tài khoản nhận;
 *  không còn dải tuổi nợ bấm lọc ở đầu ngăn; một lưới nhóm theo đơn mua, ô chọn cả đơn ở dòng nhóm;
 *  "Hạn trả" bỏ dòng nhóm, xếp theo hạn; sao kê TK 331 đọc ngược chiều (nhận hàng tăng, trả tiền giảm);
 *  tích đợt ⇒ chân tối có tổng + "Lập phiếu chi trả"; Esc ở ngăn chồng chỉ đóng ngăn chồng (lỗi 6); sự
 *  kiện đẩy nạp lại ngăn (lỗi 8); payload lập phiếu GIỮ Y NGUYÊN như bản cũ (tiền thật); không nối mẩu
 *  thông tin bằng "·" / "•".
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgingBucket, PayablesDetail, PurchaseRequestStatus, SoChiTietCongNo } from "../../../../api/client";
import { homNayVN } from "../../../../utils/ky";

const payablesDetail = vi.fn();
const saoKeDoiTac = vi.fn();
const companyAccounts = vi.fn();
const createVoucherGop = vi.fn();
const uploadVoucherAttachment = vi.fn();

vi.mock("../../../../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));
vi.mock("../../../tenDonVi", () => ({ useNapTenDonVi: () => 0, tenDonVi: (u: string) => (u === "to" ? "tờ" : u) }));
vi.mock("../../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../../api/client")>()),
  api: {
    accounting: {
      payablesDetail: (...a: unknown[]) => payablesDetail(...a),
      saoKeDoiTac: (...a: unknown[]) => saoKeDoiTac(...a),
      companyAccounts: (...a: unknown[]) => companyAccounts(...a),
      createVoucherGop: (...a: unknown[]) => createVoucherGop(...a),
      uploadVoucherAttachment: (...a: unknown[]) => uploadVoucherAttachment(...a),
    },
  },
}));

import { PayablesDrawer } from "./PayablesDrawer";

const ST = "purchased" as PurchaseRequestStatus;
const dot = {
  status: ST, lines: [], invoice_number: null, invoice_date: null, hoa_don_files: [], paid: 0, coc_bu: 0,
  chua_dat_han: false, overdue_days: 0, aging_bucket: null, da_tat_toan: false,
};

const AGING: AgingBucket[] = [
  { key: "chua_toi_han", label: "Chưa tới hạn", amount: 70_000_000, count: 2 },
  { key: "d1_7", label: "Trễ 1–7 ngày", amount: 0, count: 0 },
  { key: "d8_15", label: "Trễ 8–15 ngày", amount: 0, count: 0 },
  { key: "d16_30", label: "Trễ 16–30 ngày", amount: 0, count: 0 },
  { key: "d31_60", label: "Trễ 31–60 ngày", amount: 26_500_000, count: 1 },
  { key: "d60_plus", label: "Trễ > 60 ngày", amount: 0, count: 0 },
];

/** Sổ TK 331: đợt giao ghi CÓ (mình nợ thêm), phiếu chi ghi NỢ. Đầu kỳ mình nợ 50 tr. */
function soCai(p: Partial<SoChiTietCongNo> = {}): SoChiTietCongNo {
  return {
    tk: "331", tieu_de: "Sổ chi tiết", doi_tuong_id: 7, ma: "NCC007", ten: "Giấy Bình Minh",
    tu_ngay: "2026-10-01", den_ngay: "2026-10-31", dau_no: 0, dau_co: 50_000_000, hoan: 0,
    dong: [
      { ngay: "2026-10-02", luc: null, loai: "phieu_chi", so_ct: "PC-0090", dien_giai: "Chi trả nhà cung cấp",
        no: 30_000_000, co: 0, luy_ke_no: 0, luy_ke_co: 20_000_000 },
      { ngay: "2026-10-04", luc: null, loai: "dot_giao", so_ct: "PMH-0015 đợt 1", dien_giai: "Hàng đã nhận",
        so_hoa_don: "0000811", ky_hieu: "1C26TAA", ngay_hoa_don: "2026-10-05", don_ma: "PMH-0015",
        no: 0, co: 68_400_000, luy_ke_no: 0, luy_ke_co: 88_400_000 },
    ],
    ps_no: 30_000_000, ps_co: 68_400_000, cuoi_no: 0, cuoi_co: 88_400_000, so_dong: 2,
    ...p,
  };
}

function chiTiet(p: Partial<PayablesDetail> = {}): PayablesDetail {
  return {
    supplier_id: 7, supplier_name: "Giấy Bình Minh", credit_limit: 80_000_000, credit_days: 30,
    vuot_han_muc: true, vuot_bao_nhieu: 16_500_000,
    items: [
      { ...dot, purchase_request_id: 12, code: "PMH-0012", delivery_id: 101, seq_no: 1, delivery_date: "2026-07-01",
        due_date: "2026-07-31", amount: 20_000_000, coc_bu: 20_000_000, con_no: 0, da_tat_toan: true },
      { ...dot, purchase_request_id: 12, code: "PMH-0012", delivery_id: 102, seq_no: 2, delivery_date: "2026-07-19",
        due_date: "2026-08-18", overdue_days: 48, aging_bucket: "d31_60", invoice_symbol: "1C26TBM", invoice_number: "0001234",
        invoice_date: "2026-07-21", amount: 36_500_000, coc_bu: 10_000_000, con_no: 26_500_000,
        lines: [{ item_name: "Giấy Couche 150", unit: "to", quantity: 5000, unit_price: 5300, thanh_tien: 26_500_000, du: 200 }] },
      { ...dot, purchase_request_id: 15, code: "PMH-0015", delivery_id: 103, seq_no: 1, delivery_date: "2026-09-20",
        due_date: "2026-10-20", amount: 68_400_000, con_no: 68_400_000 },
      { ...dot, purchase_request_id: 9, code: "PMH-0009", delivery_id: null, seq_no: null, delivery_date: null,
        due_date: null, chua_dat_han: true, amount: 1_600_000, con_no: 1_600_000 },
    ],
    coc_chung: [{ purchase_request_id: 12, code: "PMH-0012", status: ST, amount: 30_000_000, da_dung: 30_000_000, con_du: 0 }],
    coc_chung_amount: 30_000_000,
    paid: [
      { voucher_id: 90, code: "PC-0090", doc_no: null, voucher_type: "cash", payment_stage: "advance", delivery_id: null,
        delivery_seq_no: null, purchase_request_id: 12, purchase_code: "PMH-0012", amount: 30_000_000,
        invoice_number: null, invoice_date: null, has_attachment: false, paid_date: "2026-06-20",
        created_by_user_id: 3, created_by_name: "Nguyễn Thu Hà" },
    ],
    period_months: 3, all_history: false, total_due: 96_500_000, overdue_amount: 26_500_000, aging: AGING,
    paid_in_period: 30_000_000, as_of: "2026-10-05",
    lien_he_ten: "Trần Văn Minh", lien_he_sdt: "0903123456", tk_nhan: "Techcombank 19028765432019",
    ...p,
  };
}

const KY = { tu: "2026-10-01", den: "2026-10-31" };
const navigate = vi.fn();
const onChanged = vi.fn();
const onClose = vi.fn();

function ve(eventTick = 0, bucket: "all" | "overdue" | "paid" = "all", tuoi: { khoa: string; nhan: string } | null = null) {
  return (
    <PayablesDrawer supplierId={7} supplierName="Giấy Bình Minh" ma="NCC007" bucket={bucket} tuoi={tuoi} ky={KY} eventTick={eventTick}
      quyen={{ lap: true, xemDonMua: true, xemNcc: true, xemPhieuChi: true }}
      navigate={navigate} onClose={onClose} onChanged={onChanged} />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  payablesDetail.mockImplementation(async () => chiTiet());
  saoKeDoiTac.mockImplementation(async (_t, _ben, _id, ky: { tuNgay: string; denNgay: string }) =>
    soCai({ tu_ngay: ky.tuNgay, den_ngay: ky.denNgay }));
  companyAccounts.mockResolvedValue([
    { id: 4, bank_name: "Vietcombank", account_number: "0281000456789", currency: "VND", is_active: true },
  ]);
  createVoucherGop.mockResolvedValue({ id: 501, code: "PC-0101", voucher_date: homNayVN(), amount: 94_900_000 });
});

async function moTabNo(bucket: "all" | "overdue" = "all", tuoi: { khoa: string; nhan: string } | null = null) {
  render(ve(0, bucket, tuoi));
  await screen.findByRole("tab", { name: /Còn nợ/ });
  await userEvent.click(screen.getByRole("tab", { name: /Còn nợ/ }));
}

describe("PayablesDrawer — NPT-2", () => {
  it("đầu ngăn: thẻ mã, không còn dải số; cột thuộc tính đủ mục; ba tab, Còn nợ đếm đợt CÒN nợ (lỗi 7)", async () => {
    await moTabNo();
    expect(screen.getByRole("heading", { name: "Giấy Bình Minh" })).toBeInTheDocument();
    expect(screen.getByText("NCC007")).toHaveClass("kt-the");
    expect(document.querySelector(".kt-ndt")).toBeNull();
    expect(screen.queryByRole("group", { name: "Lọc theo tuổi nợ" })).toBeNull();
    const cot = screen.getByRole("complementary", { name: "Thuộc tính" });
    const muc = (nhan: string) => within(cot).getByText(nhan).nextElementSibling as HTMLElement;
    expect(muc("Còn nợ tới 05/10/2026")).toHaveTextContent("96.500.000 đ");
    expect(within(muc("Quá hạn")).getByText("26.500.000 đ")).toHaveClass("kt-do");
    // Hạn sớm nhất tính ở máy khách: hạn nhỏ nhất của các đợt CÒN nợ (đợt 1 PMH-0012 đã trả xong).
    expect(muc("Hạn sớm nhất")).toHaveTextContent("18/08/2026trễ 48 ngày");
    expect(within(muc("Hạn sớm nhất")).getByText("trễ 48 ngày")).toHaveClass("kt-do");
    // Vượt hạn mức: phần trăm đỏ, câu giải thích ở tooltip — không thẻ / dải cảnh báo nào khác.
    expect(muc("Hạn mức")).toHaveTextContent("80.000.000 đđã dùng 121%");
    const pt = within(muc("Hạn mức")).getByText("đã dùng 121%");
    expect(pt).toHaveClass("kt-do");
    expect(pt).toHaveAttribute("title", "Chỉ là cảnh báo, vẫn đặt mua được.");
    expect(document.querySelector(".kt-canh")).toBeNull();
    expect(muc("Cho nợ")).toHaveTextContent("30 ngày sau mỗi đợt giao");
    expect(muc("Người liên hệ")).toHaveTextContent("Trần Văn Minh0903 123 456");
    expect(muc("Tài khoản nhận tiền")).toHaveTextContent("Techcombank 19028765432019");
    // Số còn nợ nói MỘT lần: không lặp ở thân tab.
    expect(screen.getAllByText("96.500.000 đ")).toHaveLength(1);
    // 4 dòng nhưng 1 đợt đã trả xong (mờ, để dò cọc) ⇒ còn nợ 3.
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Còn nợ3", "Sao kê", "Lịch sử"]);
    await userEvent.click(screen.getByRole("button", { name: "Hồ sơ nhà cung cấp" }));
    expect(navigate).toHaveBeenCalledWith("nha-cung-cap", { openSupplierId: 7 });
  });

  it("một lưới nhóm theo đơn: dòng nhóm có ô chọn cả đơn, mã đơn, số đợt, 4 ô tổng; cọc còn dư là chữ mờ", async () => {
    payablesDetail.mockImplementation(async () =>
      chiTiet({ coc_chung: [{ purchase_request_id: 12, code: "PMH-0012", status: ST, amount: 40_000_000, da_dung: 30_000_000, con_du: 10_000_000 }] }));
    await moTabNo();
    const bang = screen.getByRole("table", { name: "Các đợt còn nợ" });
    expect(document.querySelectorAll(".kt-ngan__chinh table.lds-g")).toHaveLength(1);
    expect(within(bang).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(
      ["", "Đợt", "Ngày nhận hàng", "Số hoá đơn", "Ký hiệu", "Ngày hoá đơn", "Hạn trả", "Giá trị", "Trừ cọc", "Đã trả", "Còn nợ"]);
    // Ngày nhận hàng và ngày hoá đơn là hai cột riêng; ký hiệu đứng cạnh số hoá đơn.
    const dot2 = within(bang).getByText("0001234").closest("tr")!;
    expect([...dot2.querySelectorAll("td")].slice(1, 6).map((c) => c.textContent)).toEqual(
      ["Đợt 2", "19/07/2026", "0001234", "1C26TBM", "21/07/2026"]);
    const nhom = within(bang).getByRole("button", { name: "PMH-0012" }).closest("tr")!;
    expect(nhom).toHaveClass("lds-nhom");
    const o = nhom.querySelectorAll("td");
    expect(o[1]).toHaveTextContent("PMH-00122 đợtcọc còn 10.000.000");
    expect(within(nhom).getByText("cọc còn 10.000.000")).toHaveClass("lds-mu");
    expect([...o].slice(2).map((c) => c.textContent)).toEqual(["56.500.000", "30.000.000", "–", "26.500.000"]);
    // Ô chọn cả đơn nằm ở dòng nhóm, không ở ô đầu cột.
    expect(within(nhom).getByRole("checkbox", { name: "Chọn mọi đợt còn nợ của PMH-0012" })).toBeInTheDocument();
    expect(bang.querySelector("th input")).toBeNull();
    expect(within(bang).getByText("trễ 48")).toHaveClass("lds-do");
    const cong = within(bang).getByText("Cộng 4 đợt").closest("tr")!;
    expect([...cong.querySelectorAll("td")].slice(2).map((c) => c.textContent)).toEqual(
      ["126.500.000", "30.000.000", "–", "96.500.000"]);
    const ngan = screen.getByRole("dialog", { name: "Giấy Bình Minh" });
    expect(ngan.textContent).not.toMatch(/[·•]/);
    expect(ngan.textContent).not.toMatch(/\d, đã trừ|, còn dư/);
    await userEvent.click(within(nhom).getByRole("button", { name: "PMH-0012" }));
    expect(navigate).toHaveBeenCalledWith("ke-toan-don-mua-hang", { focusRequestCode: "PMH-0012" });
  });

  it("tick dòng nhóm chọn cả đơn (chọn một phần thì ô nhóm gạch ngang); bỏ tick nhóm bỏ cả đơn", async () => {
    const goc = chiTiet();
    payablesDetail.mockImplementation(async () => ({
      ...goc,
      items: [...goc.items, { ...dot, purchase_request_id: 15, code: "PMH-0015", delivery_id: 104, seq_no: 2,
        delivery_date: "2026-09-28", due_date: "2026-10-28", amount: 10_000_000, con_no: 10_000_000 }],
    }));
    await moTabNo();
    const oNhom = screen.getByRole("checkbox", { name: "Chọn mọi đợt còn nợ của PMH-0015" }) as HTMLInputElement;
    await userEvent.click(screen.getByRole("checkbox", { name: "Chọn Đợt 1 của PMH-0015" }));
    expect(oNhom.checked).toBe(false);
    expect(oNhom.indeterminate).toBe(true);
    await userEvent.click(screen.getByRole("checkbox", { name: "Chọn Đợt 1 của PMH-0015" }));
    await userEvent.click(oNhom);
    expect(oNhom.checked).toBe(true);
    expect(oNhom.indeterminate).toBe(false);
    const chan = document.querySelector(".kt-ngan__chan--toi") as HTMLElement;
    expect(within(chan).getByText(/Đã chọn 2 đợt/)).toBeInTheDocument();
    expect(within(chan).getByText("78.400.000 đ")).toBeInTheDocument();
    expect(within(chan).getByRole("button", { name: "Lập phiếu chi trả" })).toBeInTheDocument();
    await userEvent.click(oNhom);
    expect(document.querySelector(".kt-ngan__chan--toi")).toBeNull();
  });

  it("Hạn trả: bỏ dòng nhóm, xếp đợt theo hạn tăng dần, chưa có hạn sau, đã trả xong cuối; ô đợt mang mã đơn", async () => {
    await moTabNo();
    const xep = screen.getByRole("group", { name: "Xếp theo" });
    await userEvent.click(within(xep).getByRole("button", { name: "Hạn trả" }));
    const bang = screen.getByRole("table", { name: "Các đợt còn nợ" });
    expect(bang.querySelector(".lds-nhom")).toBeNull();
    expect(within(bang).getByRole("columnheader", { name: "Đơn mua và đợt" })).toBeInTheDocument();
    const dong = [...bang.querySelectorAll("tbody tr:not(.lds-cong)")].map((r) => r.querySelectorAll("td")[1].textContent);
    expect(dong).toEqual(["PMH-0012đợt 2", "PMH-0015đợt 1", "PMH-0009cả đơn", "PMH-0012đợt 1"]);
    // Ô hạn có chữ đủ ở title.
    expect(within(bang).getByText("trễ 48").closest("td")).toHaveAttribute("title", "18/08/2026 trễ 48 ngày");
    await userEvent.click(within(xep).getByRole("button", { name: "Đơn mua" }));
    expect(bang.querySelectorAll(".lds-nhom")).toHaveLength(3);
  });

  it("tích đợt ⇒ chân tối 'Đã chọn n đợt' + tổng; đợt Cả đơn không tích được; Bỏ chọn", async () => {
    await moTabNo();
    expect(screen.getByRole("checkbox", { name: "Chọn Cả đơn của PMH-0009" })).toBeDisabled();
    // #56: màn Đơn mua hàng không có nút lập phiếu chi — câu nhắc nói đúng lý do, không chỉ sai chỗ.
    const cu = screen.getByRole("checkbox", { name: "Chọn Cả đơn của PMH-0009" });
    expect(cu.getAttribute("title")).not.toMatch(/màn Đơn mua hàng/);
    expect(cu.getAttribute("title")).toMatch(/phải gắn đợt giao/);
    expect(screen.queryByRole("checkbox", { name: "Chọn Đợt 1 của PMH-0012" })).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Chọn Đợt 2 của PMH-0012" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Chọn Đợt 1 của PMH-0015" }));
    const chan = document.querySelector(".kt-ngan__chan--toi") as HTMLElement;
    expect(chan).not.toBeNull();
    expect(within(chan).getByText(/Đã chọn 2 đợt/)).toBeInTheDocument();
    expect(within(chan).getByText("94.900.000 đ").tagName).toBe("B");
    expect(within(chan).getByRole("button", { name: "Lập phiếu chi trả" })).toBeInTheDocument();
    await userEvent.click(within(chan).getByRole("button", { name: "Bỏ chọn" }));
    expect(document.querySelector(".kt-ngan__chan--toi")).toBeNull();
  });

  it("bấm dòng mở khối Hàng của đợt GẤP ngay dưới, bấm lại thì gấp", async () => {
    await moTabNo();
    const dong = screen.getByText("Đợt 2").closest("tr")!;
    await userEvent.click(dong);
    const hang = screen.getByRole("table", { name: "Hàng của đợt" });
    expect(within(hang).getByRole("columnheader", { name: "Thành tiền" })).toHaveClass("n");
    expect(screen.getByText("Giấy Couche 150")).toBeInTheDocument();
    expect(screen.getByText("5.000 tờ")).toBeInTheDocument();
    expect(screen.getByText("Dư 200 tờ")).toHaveClass("kt-the");
    expect(dong).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(dong);
    expect(screen.queryByText("Giấy Couche 150")).toBeNull();
  });

  it("Esc trên dòng đang mở khối hàng thì gấp khối, ngăn vẫn mở; Esc lần nữa mới đóng ngăn", async () => {
    await moTabNo();
    const dong = screen.getByText("Đợt 2").closest("tr")!;
    await userEvent.click(dong);
    expect(dong).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText("Giấy Couche 150")).toBeNull();
    expect(dong).toHaveAttribute("aria-expanded", "false");
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("sự kiện đẩy nạp lại ngăn (lỗi 8)", async () => {
    const { rerender } = render(ve(0));
    await waitFor(() => expect(payablesDetail).toHaveBeenCalledTimes(1));
    expect(payablesDetail).toHaveBeenLastCalledWith("token-test", 7, false, { tu_ngay: KY.tu, den_ngay: KY.den },
      { paid_page: 1, paid_size: 10 });
    rerender(ve(1));
    await waitFor(() => expect(payablesDetail).toHaveBeenCalledTimes(2));
  });

  it("mở từ danh sách đang lọc mốc tuổi: chỉ còn đợt CÒN nợ của mốc đó; Bỏ lọc hiện lại đủ và xoá lựa chọn", async () => {
    await moTabNo("all", { khoa: "d31_60", nhan: "Trễ 31–60 ngày" });
    expect(screen.getByText("Trễ 31–60 ngày", { selector: ".kt-chip--loc" })).toHaveTextContent("Trễ 31–60 ngày1");
    expect(screen.queryByRole("button", { name: "PMH-0015" })).toBeNull();
    expect(screen.queryByText("Đợt 1")).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Chọn Đợt 2 của PMH-0012" }));
    await userEvent.click(screen.getByRole("button", { name: "Bỏ lọc" }));
    expect(document.querySelector(".kt-ngan__chan--toi")).toBeNull();
    expect(screen.getByRole("button", { name: "PMH-0015" })).toBeInTheDocument();
  });

  it("bấm số Quá hạn ngoài bảng: thẻ lọc Quá hạn, chỉ đợt đang trễ", async () => {
    await moTabNo("overdue");
    expect(screen.getByText("Quá hạn", { selector: ".kt-chip--loc" })).toHaveTextContent("Quá hạn1");
    expect(screen.getByText("Cộng 1 đợt")).toBeInTheDocument();
  });

  it("hạn trả chưa tới: ngày + 'còn N' (lưới gọn) so với ngày máy chủ tính nợ", async () => {
    await moTabNo();
    const o = screen.getByText("20/10/2026").closest("td")!;
    expect(o).toHaveTextContent("20/10/2026còn 15");
    expect(o).toHaveAttribute("title", "20/10/2026 còn 15 ngày");
    expect(within(o).getByText("còn 15")).toHaveClass("lds-mu");
  });

  it("thiếu cả hạn mức và cho nợ: một mục 'Hạn mức và cho nợ' chưa đặt + Đặt trong hồ sơ (như nút Hồ sơ)", async () => {
    payablesDetail.mockImplementation(async () => chiTiet({ credit_limit: 0, credit_days: null, vuot_han_muc: false }));
    await moTabNo();
    const cot = screen.getByRole("complementary", { name: "Thuộc tính" });
    expect(within(cot).queryByText("Hạn mức")).toBeNull();
    expect(within(cot).queryByText("Cho nợ")).toBeNull();
    expect(within(cot).getByText("Hạn mức và cho nợ").nextElementSibling).toHaveTextContent("chưa đặtĐặt trong hồ sơ");
    await userEvent.click(within(cot).getByRole("button", { name: "Đặt trong hồ sơ" }));
    expect(onClose).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("nha-cung-cap", { openSupplierId: 7 });
  });

  it("bấm số Đã trả ngoài bảng mở Sao kê: nhận hàng là cột tăng, trả tiền là cột giảm, số dư = mình còn nợ", async () => {
    render(ve(0, "paid"));
    const bang = await screen.findByRole("table");
    expect(saoKeDoiTac).toHaveBeenCalledWith("token-test", "payables", 7, { tuNgay: KY.tu, denNgay: KY.den });
    expect(within(bang).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(
      ["Ngày", "Chứng từ", "Số hoá đơn", "Ký hiệu", "Ngày hoá đơn", "Diễn giải", "Nhận hàng", "Đã trả", "Số dư"]);
    const dong = within(bang).getAllByRole("row").slice(1).map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent));
    expect(dong).toEqual([
      ["01/10/2026", "", "Số dư đầu kỳ", "", "", "50.000.000"],
      ["02/10/2026", "PC-0090", "", "", "", "Chi trả nhà cung cấp", "", "30.000.000", "20.000.000"],
      ["04/10/2026", "PMH-0015 đợt 1", "0000811", "1C26TAA", "05/10/2026", "Hàng đã nhận", "68.400.000", "", "88.400.000"],
      ["31/10/2026", "", "Số dư cuối kỳ", "68.400.000", "30.000.000", "88.400.000"],
    ]);
    // Dòng đầu/cuối kỳ: ô trống gộp đủ 4 cột (Chứng từ tới Ngày hoá đơn) ⇒ tổng cột khớp tiêu đề.
    for (const r of within(bang).getAllByRole("row").slice(1)) {
      const tong = [...r.querySelectorAll("td")].reduce((s, c) => s + (Number(c.getAttribute("colspan")) || 1), 0);
      expect(tong).toBe(9);
    }
    await userEvent.click(screen.getByRole("button", { name: "PMH-0015 đợt 1" }));
    expect(navigate).toHaveBeenCalledWith("ke-toan-don-mua-hang", { focusRequestCode: "PMH-0015" });
    expect(screen.getByText("Số dư = mình còn nợ nhà cung cấp")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "PC-0090" }));
    expect(navigate).toHaveBeenCalledWith("ke-toan-phieu-chi", { focusVoucherQuery: "PC-0090" });
  });

  it("Lịch sử: mới nhất trên cùng, có việc đợt trễ hạn", async () => {
    await moTabNo();
    await userEvent.click(screen.getByRole("tab", { name: "Lịch sử" }));
    await waitFor(() => expect(document.querySelectorAll(".kt-ls__muc").length).toBe(3));
    const viec = [...document.querySelectorAll(".kt-ls__muc")].map((m) => [
      m.querySelector("b")!.textContent, m.querySelector(".kt-ls__gio")!.textContent]);
    expect(viec).toEqual([
      ["Nhận hàng PMH-0015 đợt 1", "04/10/2026"],
      ["Trả 30.000.000 đ", "02/10/2026"],
      ["PMH-0012 đợt 2 quá hạn chưa trả đủ", "19/08/2026"],
    ]);
  });
});

describe("Phiếu chi gộp từ ngăn công nợ — NPT-3", () => {
  const TEN = "Lập phiếu chi 2 khoản";
  async function moTra() {
    await moTabNo();
    await userEvent.click(screen.getByRole("checkbox", { name: "Chọn Đợt 2 của PMH-0012" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Chọn Đợt 1 của PMH-0015" }));
    await userEvent.click(screen.getByRole("button", { name: "Lập phiếu chi trả" }));
    return screen.findByRole("dialog", { name: TEN });
  }
  const DONG = [
    { purchase_request_id: 12, delivery_id: 102, amount: 26_500_000 },
    { purchase_request_id: 15, delivery_id: 103, amount: 68_400_000 },
  ];

  it("ngăn chồng giữ ẢNH CHỤP các đợt lúc mở: ngăn dưới nạp lại hỏng vẫn không mất form", async () => {
    const { rerender } = render(ve(0));
    await screen.findByRole("tab", { name: /Còn nợ/ });
    await userEvent.click(screen.getByRole("tab", { name: /Còn nợ/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Chọn Đợt 2 của PMH-0012" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Chọn Đợt 1 của PMH-0015" }));
    await userEvent.click(screen.getByRole("button", { name: "Lập phiếu chi trả" }));
    await screen.findByRole("dialog", { name: TEN });
    payablesDetail.mockRejectedValue(new Error("mất mạng"));
    rerender(ve(1));
    await waitFor(() => expect(payablesDetail).toHaveBeenCalledTimes(2));
    await screen.findByText("Không tải được chi tiết công nợ.");
    const ngan = screen.getByRole("dialog", { name: TEN });
    expect(within(ngan).getAllByRole("textbox", { name: /^Chi lần này/ })).toHaveLength(2);
    expect(within(ngan).getByRole("button", { name: "Lập phiếu chi" })).toBeEnabled();
  });

  it("Esc chỉ đóng ngăn chồng, ngăn nhà cung cấp vẫn mở (lỗi 6)", async () => {
    await moTra();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: TEN })).toBeNull());
    expect(screen.getByRole("dialog", { name: "Giấy Bình Minh" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("tiền mặt: MỘT phiếu, lines đúng Còn từng đợt; lập xong báo 'Đã lập PC-0101' và nạp lại", async () => {
    const ngan = await moTra();
    expect(within(ngan).getByText("Tổng phiếu").nextElementSibling).toHaveTextContent("94.900.000 đ");
    expect(within(ngan).getByRole("textbox", { name: /Người nhận tiền/ })).toHaveValue("Giấy Bình Minh");
    const goiTruoc = payablesDetail.mock.calls.length;
    await userEvent.click(within(ngan).getByRole("button", { name: "Lập phiếu chi" }));
    await waitFor(() => expect(createVoucherGop).toHaveBeenCalledTimes(1));
    expect(createVoucherGop.mock.calls[0][1]).toMatchObject({
      lines: DONG,
      voucher_type: "cash",
      voucher_date: homNayVN(),
      company_bank_account_id: null,
      cash_recipient_name: "Giấy Bình Minh",
      beneficiary_account_number: null,
      bank_fee_bearer: "payer",
    });
    expect(await screen.findByText("Đã lập PC-0101")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: TEN })).toBeNull();
    await waitFor(() => expect(payablesDetail.mock.calls.length).toBeGreaterThan(goiTruoc));
    expect(onChanged).toHaveBeenCalled();
    // "Xem phiếu" đưa sang tab Lịch sử (phiếu vừa lập đứng đầu).
    await userEvent.click(screen.getByRole("button", { name: "Xem phiếu" }));
    expect(screen.getByRole("tab", { name: "Lịch sử" })).toHaveAttribute("aria-selected", "true");
  });

  it("chuyển khoản: thiếu ô thì lỗi tại ô, không gọi; đủ thì payload đúng trường ngân hàng", async () => {
    const ngan = await moTra();
    await userEvent.click(within(ngan).getByRole("radio", { name: "Chuyển khoản" }));
    await userEvent.click(within(ngan).getByRole("button", { name: "Lập phiếu chi" }));
    expect(createVoucherGop).not.toHaveBeenCalled();
    expect(within(ngan).getByText("Chọn tài khoản công ty dùng để chi.")).toBeInTheDocument();
    expect(within(ngan).getByText("Ghi số tài khoản người nhận.")).toBeInTheDocument();

    await userEvent.selectOptions(within(ngan).getByRole("combobox", { name: /Trả từ tài khoản/ }), "4");
    await userEvent.type(within(ngan).getByRole("textbox", { name: /Số tài khoản/ }), "0011223344");
    await userEvent.type(within(ngan).getByRole("textbox", { name: /^Ngân hàng/ }), "ACB");
    await userEvent.click(within(ngan).getByRole("button", { name: "Lập phiếu chi" }));
    await waitFor(() => expect(createVoucherGop).toHaveBeenCalledTimes(1));
    expect(createVoucherGop.mock.calls[0][1]).toMatchObject({
      lines: DONG,
      voucher_type: "bank_transfer",
      company_bank_account_id: 4,
      cash_recipient_name: null,
      beneficiary_account_holder: "Giấy Bình Minh",
      beneficiary_account_number: "0011223344",
      beneficiary_bank_name: "ACB",
    });
  });

  it("chứng từ gắn MỘT lần vào phiếu vừa lập; tải hỏng thì ở lại, nêu mã phiếu", async () => {
    uploadVoucherAttachment.mockRejectedValue(new Error("mất mạng"));
    const ngan = await moTra();
    const o = ngan.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(o, { target: { files: [new File(["x"], "unc.pdf", { type: "application/pdf" })] } });
    });
    await userEvent.click(within(ngan).getByRole("button", { name: "Lập phiếu chi" }));
    await waitFor(() => expect(uploadVoucherAttachment).toHaveBeenCalledTimes(1));
    expect(uploadVoucherAttachment.mock.calls[0][1]).toBe(501);
    expect(await within(ngan).findByText(/PC-0101/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: TEN })).toBeInTheDocument();
    await userEvent.click(within(ngan).getByRole("button", { name: "Xong" }));
    expect(await screen.findByText("Đã lập PC-0101")).toBeInTheDocument();
  });
});
