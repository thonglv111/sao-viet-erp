/** Ngăn phiếu chi kiểu 3 (phương án A): cột thuộc tính bên phải, bảng đối chiếu đợt giao, dòng
 *  "Yêu cầu mua" (mã yêu cầu mua nguồn của đơn) — lối liên thông về màn Yêu cầu mua hàng; không có
 *  quyền xem màn đó thì chỉ hiện mã, không thành link. */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { phieu } from "./phieuMau";

const P = phieu({
  id: 7, doc_no: "PC00018", code: "UNC-261007-MD21", source_type: "purchase_request", purchase_request_id: 3,
  purchase_request_code: "DMH-261002-K4P1", payment_stage: "advance", source_request_codes: ["YC-2609-01", "YC-2609-07"],
});

const DOT = phieu({
  id: 8, doc_no: "PC00019", code: "UNC-261007-AB12", source_type: "purchase_request", purchase_request_id: 3,
  purchase_request_code: "DMH-261002-K4P1", payment_stage: "partial", delivery_id: 41, delivery_seq_no: 1,
  voucher_type: "bank_transfer", supplier_name: "Công ty TNHH Thương mại Giấy An Phát",
  beneficiary_account_holder: "CONG TY TNHH TM GIAY AN PHAT", beneficiary_bank_name: "Techcombank",
  beneficiary_account_number: "19028765432019", beneficiary_bank_branch: "CN Tân Bình",
  amount: 31_817_000, amount_vnd: 31_817_000, attachment_count: 0, truoc_do: 0, con_no_sau: 74_239_000,
});

/** Chuyển khoản mà thiếu hết thông tin tài khoản (phiếu cũ). */
const TRONG = { ...DOT, id: 9, beneficiary_bank_name: null, beneficiary_account_number: null, beneficiary_bank_branch: null };

const traPhieu = async (_t: string, id: number) => [DOT, TRONG].find((x) => x.id === id) ?? P;
const voucher = vi.fn(traPhieu);
afterEach(() => voucher.mockImplementation(traPhieu));

vi.mock("../../../../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));
vi.mock("../../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../../api/client")>()),
  api: {
    accounting: {
      voucher: (t: string, id: number) => voucher(t, id),
      voucherAttachments: vi.fn(async () => ({ items: [] })),
    },
    purchaseRequests: { get: vi.fn(() => new Promise(() => {})) },
  },
}));

import { VouchersDrawer } from "./VouchersDrawer";

const QUYEN = { lap: true, huy: true, in: true, xemDonMua: false };

/** Phiếu gộp: cọc đơn 9 + đợt 1 đơn 10, đầu phiếu không đơn/đợt. */
const GOP = phieu({
  id: 11, doc_no: "PC00020", code: "PC-261017-GOP1", source_type: "purchase_request", purchase_request_id: null,
  purchase_request_code: "PMH-0009 +1", payment_stage: "final", delivery_id: null, delivery_seq_no: null,
  amount: 1_264_000, amount_vnd: 1_264_000,
  lines: [
    { purchase_request_id: 9, purchase_code: "PMH-0009", delivery_id: null, delivery_seq_no: null, invoice_number: null, amount: 500_000 },
    { purchase_request_id: 10, purchase_code: "PMH-0010", delivery_id: 31, delivery_seq_no: 1, invoice_number: "88", amount: 764_000 },
  ],
  doi_chieu: [{ purchase_code: "PMH-0010", delivery_seq_no: 1, truoc_do: 100_000, con_no_sau: 36_000 }],
});

describe("VouchersDrawer — kiểu 3", () => {
  it("phiếu gộp: khối Các khoản trong phiếu từng dòng, Còn nợ của đợt từ đối chiếu; cột thuộc tính liệt kê từng đơn", async () => {
    voucher.mockImplementation(async () => GOP);
    const moDon = vi.fn();
    render(<VouchersDrawer dau={GOP} eventTick={0} quyen={{ ...QUYEN, xemDonMua: true }} onDong={() => {}} onDoi={() => {}}
      onMoPhieuThu={() => {}} onMoDonMua={moDon} />);
    expect(screen.getByText("Các khoản trong phiếu")).toBeInTheDocument();
    expect(screen.queryByText("Đơn không theo dõi theo đợt giao.")).toBeNull();
    const bang = screen.getByRole("table", { name: "Các khoản trong phiếu" });
    expect(within(bang).getAllByRole("columnheader").map((th) => th.textContent))
      .toEqual(["Đơn mua", "Khoản", "Số hoá đơn", "Trả trước đó", "Phiếu này", "Còn nợ"]);
    const dong = within(bang).getAllByRole("row");
    expect([...dong[1].querySelectorAll("td")].map((c) => c.textContent)).toEqual(["PMH-0009", "Cọc", "–", "–", "500.000", "–"]);
    await waitFor(() =>
      expect([...dong[2].querySelectorAll("td")].map((c) => c.textContent))
        .toEqual(["PMH-0010", "Đợt 1", "88", "100.000", "764.000", "36.000"]));
    expect(within(dong[3]).getByText("1.264.000")).toBeInTheDocument();
    const cot = screen.getByRole("complementary", { name: "Thuộc tính" });
    expect(within(cot).queryByText("PMH-0009 +1")).toBeNull();
    await userEvent.click(within(cot).getByRole("button", { name: "PMH-0010" }));
    expect(moDon).toHaveBeenCalledWith("PMH-0010");
  });

  it("cột thuộc tính bên phải có Người nhận tiền và Mã hệ thống; số tiền làm tiêu đề", async () => {
    render(<VouchersDrawer dau={DOT} eventTick={0} quyen={QUYEN} onDong={() => {}} onDoi={() => {}}
      onMoPhieuThu={() => {}} />);
    const cot = screen.getByRole("complementary", { name: "Thuộc tính" });
    expect(within(cot).getByText("Người nhận tiền")).toBeInTheDocument();
    expect(within(cot).getByText("Công ty TNHH Thương mại Giấy An Phát")).toBeInTheDocument();
    expect(within(cot).getByText("Chủ tài khoản nhận")).toBeInTheDocument();
    expect(within(cot).getByText("Mã hệ thống")).toBeInTheDocument();
    expect(within(cot).getByText("UNC-261007-AB12")).toBeInTheDocument();
    expect(within(cot).getByText("CN Tân Bình")).toHaveClass("kt-the");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("31.817.000");
    // Phiếu đã chi chưa có tệp: tab nói "chưa có" thay con số.
    expect(screen.getByRole("tab", { name: /Chứng từ gốc/ })).toHaveTextContent("chưa có");
  });

  it("bảng đợt giao có Trả trước đó và Còn nợ từ máy chủ; số 0 là gạch mờ", async () => {
    render(<VouchersDrawer dau={DOT} eventTick={0} quyen={QUYEN} onDong={() => {}} onDoi={() => {}}
      onMoPhieuThu={() => {}} />);
    expect(screen.getByText("Trả cho đợt giao")).toBeInTheDocument();
    // Hai bảng: đợt (ngày nhận hàng tách khỏi ngày hoá đơn, ký hiệu cạnh số) và tiền của đợt.
    expect(within(screen.getByRole("table", { name: "Đợt giao" })).getAllByRole("columnheader").map((th) => th.textContent))
      .toEqual(["Đợt", "Ngày nhận hàng", "Số hoá đơn", "Ký hiệu", "Ngày hoá đơn", "Hàng"]);
    const bang = screen.getByRole("table", { name: "Tiền của đợt" });
    const tieuDe = within(bang).getAllByRole("columnheader").map((th) => th.textContent);
    expect(tieuDe).toEqual(["Giá trị đợt", "Trừ cọc", "Trả trước đó", "Phiếu này", "Còn nợ"]);
    await waitFor(() => expect(within(bang).getByText("74.239.000")).toBeInTheDocument());
    expect(within(bang).getByText("31.817.000")).toBeInTheDocument();
    const dong = within(bang).getAllByRole("row")[1];
    expect(within(dong).getAllByText("–").every((o) => o.classList.contains("lds-mu3"))).toBe(true);
  });

  it("chuyển khoản thiếu hết thông tin tài khoản: không hiện nhãn Từ/Tới tài khoản trơ", async () => {
    render(<VouchersDrawer dau={TRONG} eventTick={0} quyen={QUYEN} onDong={() => {}} onDoi={() => {}}
      onMoPhieuThu={() => {}} />);
    await waitFor(() => expect(voucher).toHaveBeenCalledWith("token-test", TRONG.id));
    await screen.findByText("Chủ tài khoản nhận");
    const cot = screen.getByRole("complementary", { name: "Thuộc tính" });
    expect(within(cot).queryByText("Từ tài khoản")).toBeNull();
    expect(within(cot).queryByText("Tới tài khoản")).toBeNull();
  });

  it("phiếu cọc: không bảng đợt, một câu giải thích", () => {
    render(<VouchersDrawer dau={P} eventTick={0} quyen={QUYEN} onDong={() => {}} onDoi={() => {}}
      onMoPhieuThu={() => {}} />);
    expect(screen.getByText("Đặt cọc cho đơn mua")).toBeInTheDocument();
    expect(screen.getByText("Phiếu đặt cọc không gắn đợt giao. Cọc trừ dần vào công nợ của cả đơn.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("mỗi mã yêu cầu mua là một link mở màn Yêu cầu mua hàng", async () => {
    const onMoYeuCau = vi.fn();
    render(<VouchersDrawer dau={P} eventTick={0} quyen={QUYEN} onDong={() => {}} onDoi={() => {}}
      onMoPhieuThu={() => {}} onMoYeuCau={onMoYeuCau} />);
    expect(screen.getByText("Yêu cầu mua")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "YC-2609-07" }));
    expect(onMoYeuCau).toHaveBeenCalledWith("YC-2609-07");
  });

  it("không có quyền xem Yêu cầu mua hàng: hiện mã, không có link", () => {
    render(<VouchersDrawer dau={P} eventTick={0} quyen={QUYEN} onDong={() => {}} onDoi={() => {}}
      onMoPhieuThu={() => {}} />);
    expect(screen.getByText("YC-2609-01")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "YC-2609-01" })).toBeNull();
  });
});
