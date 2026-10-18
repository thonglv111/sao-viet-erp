/** Bảng Phiếu chi (khuôn lưới chung `lds-g`): mười cột, mẩu thông tin không nối bằng "·" hay dấu
 *  phẩy, dòng Cộng cuối bảng, dòng đi được bằng bàn phím, rỗng có ba câu tách bạch. */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { phieu } from "./phieuMau";
import { COT_PHIEU_CHI, VouchersTable } from "./VouchersTable";

const ROWS = [
  phieu({
    id: 1, code: "UNC-260930-W4PB", doc_no: "PC00018", supplier_name: "Máy in Hoà Phát", voucher_type: "bank_transfer",
    source_type: "purchase_request", purchase_request_code: "DMH-260920-9MKD", payment_stage: "final",
    amount: 1200, amount_vnd: 30_480_000, currency: "USD", exchange_rate: 25400, content: "Phụ tùng trục ép nhập khẩu",
  }),
  phieu({
    id: 2, code: "UNC-261003-Z8WE", supplier_name: "Mực in Đông Á", voucher_type: "bank_transfer",
    source_type: "purchase_request", purchase_request_code: "DMH-261002-K4P1", payment_stage: "advance",
    content: "Đặt cọc mực 4 màu", attachment_count: 0,
  }),
  phieu({ id: 3, code: "PC-261001-T5JC", status: "cancelled", supplier_name: "Kẽm CTP Phương Nam", attachment_count: 0 }),
];

function ve(over: Partial<Parameters<typeof VouchersTable>[0]> = {}) {
  const props = {
    cot: COT_PHIEU_CHI, rows: ROWS, loading: false, loi: null, onTaiLai: vi.fn(), dangXem: null, onMo: vi.fn(),
    coLoc: false, onBoLoc: vi.fn(), onLap: vi.fn(), trang: 1, size: 25, tong: ROWS.length, onTrang: vi.fn(),
    onSize: vi.fn(), tongTien: 31_330_000, soXong: 2, ...over,
  };
  const r = render(<VouchersTable {...props} />);
  return { ...props, container: r.container };
}

/** Mọi đoạn chữ TRẦN (text node) trong vùng — dấu nối nằm giữa các mẩu thì phải lộ ra ở đây. */
function chuTran(el: Element): string[] {
  const out: string[] = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent?.trim()) out.push(n.textContent);
  return out;
}

describe("VouchersTable", () => {
  it("phiếu gộp: Chi theo ghi số chứng từ, chữ nổi liệt kê từng dòng (mỗi dòng một hàng)", () => {
    ve({
      rows: [phieu({
        id: 9, code: "PC-261017-GOP1", source_type: "purchase_request", payment_stage: "final",
        purchase_request_id: null, purchase_request_code: "PMH-0009 +1",
        lines: [
          { purchase_request_id: 9, purchase_code: "PMH-0009", delivery_id: null, delivery_seq_no: null, invoice_number: null, amount: 500_000 },
          { purchase_request_id: 10, purchase_code: "PMH-0010", delivery_id: 31, delivery_seq_no: 1, invoice_number: "88", amount: 764_000 },
        ],
      })],
      tong: 1,
    });
    const o = screen.getByText("2 chứng từ").closest("td")!;
    expect(within(o).getByText("Đơn mua")).toHaveClass("lds-tag");
    expect(o).toHaveAttribute("title", "PMH-0009 cọc 500.000\nPMH-0010 đợt 1 764.000");
    expect(within(o).queryByRole("button")).toBeNull();
  });

  it("mười cột đúng thứ tự: Mục chi sau Lý do, Trạng thái đứng sau Số tiền, Ngày tạo cuối (cột Ghi chú gỡ 18/10/2026)", () => {
    ve();
    const tieuDe = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(tieuDe).toEqual([
      "Số phiếu", "Ngày chi", "Người nhận tiền", "Lý do chi", "Mục chi", "Chi theo", "Hình thức", "Số tiền", "Trạng thái",
      "Ngày tạo",
    ]);
    // Khuôn lưới chung: bảng `lds-g`, số tiền canh phải, hai cột ghim không có (chỉ Số phiếu cố định).
    expect(screen.getByRole("table")).toHaveClass("lds-g");
    expect(screen.getByRole("columnheader", { name: "Số tiền" })).toHaveClass("n");
  });

  it("không nối mẩu thông tin bằng · • hay dấu phẩy; nhãn Chi theo là thẻ nhỏ", () => {
    const { container } = ve();
    const bang = screen.getByRole("table");
    for (const t of chuTran(bang)) expect(t).not.toMatch(/[·•]|,\s/);
    const dong = container.querySelectorAll<HTMLElement>("tr.lds-dong");
    // Cột đầu là số in trên tờ phiếu; phiếu chưa có số thì mã hệ thống.
    expect(within(dong[0]).getByText("PC00018")).toBeInTheDocument();
    expect(within(dong[1]).getByText("UNC-261003-Z8WE")).toBeInTheDocument();
    // Ngoại tệ: số VND không kèm " đ", nguyên tệ + tỷ giá nằm ở chữ nổi khi trỏ chuột.
    const so = within(dong[0]).getByText("30.480.000");
    expect(so).toHaveAttribute("title", "USD 1.200 tỷ giá 25.400");
    expect(within(dong[0]).getByText("Đơn mua")).toHaveClass("lds-tag");
    // Phiếu cọc: nhãn riêng "Cọc đơn mua", mã đơn đứng cạnh.
    expect(within(dong[1]).getByText("Cọc đơn mua")).toHaveClass("lds-tag");
    expect(within(dong[1]).getByText("DMH-261002-K4P1")).toBeInTheDocument();
  });

  it("Trạng thái là chip; phiếu thiếu tệp không còn bị nhắc \"Thiếu chứng từ gốc\"; phiếu hủy mờ", () => {
    const { container } = ve();
    const dong = container.querySelectorAll<HTMLElement>("tr.lds-dong");
    expect(within(dong[0]).getByText("Đã chi")).toHaveClass("lds-chip", "lds-chip--la");
    expect(within(dong[0]).queryByText("Thiếu chứng từ gốc")).toBeNull();
    expect(within(dong[1]).queryByText("Thiếu chứng từ gốc")).toBeNull();
    expect(dong[2]).toHaveClass("kt-da-huy");
    expect(within(dong[2]).getByText("Đã hủy")).toHaveClass("lds-chip", "lds-chip--xam");
    expect(within(dong[2]).queryByText("Thiếu chứng từ gốc")).toBeNull();
  });

  it("cột người xem ẩn thì không vẽ, dòng Cộng vẫn thẳng cột", () => {
    const { container } = ve({ cot: COT_PHIEU_CHI.filter((c) => c.key !== "hinh_thuc") });
    expect(screen.queryByRole("columnheader", { name: "Hình thức" })).toBeNull();
    const cong = container.querySelector<HTMLElement>("tr.lds-cong")!;
    // Số phiếu … Chi theo = 6 cột trước ô tiền (có cột Mục chi).
    expect(cong.querySelector("td.lead")).toHaveAttribute("colspan", "6");
    expect(within(cong).getByText("31.330.000")).toHaveClass("n");
  });

  it("ẩn cột Số tiền: dòng Cộng vẫn còn, số phiếu và tổng tiền đứng ở nhãn", () => {
    const { container } = ve({ cot: COT_PHIEU_CHI.filter((c) => c.key !== "so_tien") });
    const cong = container.querySelector<HTMLElement>("tr.lds-cong")!;
    expect(cong).toHaveTextContent("Cộng 2 phiếu đã chi");
    expect(cong).toHaveTextContent("31.330.000");
    expect(cong.querySelector("td.lead")).toHaveAttribute("colspan", String(COT_PHIEU_CHI.length - 1));
  });

  it("mã đơn mua là nút mở đơn khi có quyền, bấm không mở ngăn", async () => {
    const onMoDonMua = vi.fn();
    const p = ve({ onMoDonMua });
    await userEvent.click(screen.getByRole("button", { name: "DMH-261002-K4P1" }));
    expect(onMoDonMua).toHaveBeenCalledWith("DMH-261002-K4P1");
    expect(p.onMo).not.toHaveBeenCalled();
  });

  it("không có quyền xem đơn mua: mã là chữ thường", () => {
    ve();
    expect(screen.queryByRole("button", { name: "DMH-261002-K4P1" })).toBeNull();
  });

  it("dòng Cộng cuối bảng: số phiếu đã chi + tổng tiền, không phải dòng mở được", () => {
    const { container } = ve();
    const cong = container.querySelector<HTMLElement>("tr.lds-cong")!;
    expect(cong).not.toHaveClass("lds-dong");
    // Dòng Cộng nằm CUỐI tbody, sau các phiếu.
    expect(cong.parentElement!.lastElementChild).toBe(cong);
    expect(cong).toHaveTextContent("Cộng 2 phiếu đã chi");
    expect(within(cong).getByText("không tính phiếu đã hủy")).toBeInTheDocument();
    expect(within(cong).getByText("31.330.000")).toHaveClass("n");
  });

  it("chưa có tổng tiền thì không vẽ dòng Cộng", () => {
    const { container } = ve({ tongTien: null });
    expect(container.querySelector("tr.lds-cong")).toBeNull();
  });

  it("dòng đang mở ngăn viền đủ cạnh (is-chon)", () => {
    const { container } = ve({ dangXem: 2 });
    const dong = container.querySelectorAll<HTMLElement>("tr.lds-dong");
    expect(dong[1]).toHaveClass("is-chon");
    expect(dong[0]).not.toHaveClass("is-chon");
  });

  it("↑ ↓ chuyển dòng, Enter mở phiếu", async () => {
    const { container, onMo } = ve();
    const dong = container.querySelectorAll<HTMLElement>("tr.lds-dong");
    dong[0].focus();
    fireEvent.keyDown(dong[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(dong[1]);
    fireEvent.keyDown(dong[1], { key: "Enter" });
    expect(onMo).toHaveBeenCalledWith(2);
    fireEvent.keyDown(dong[1], { key: "ArrowUp" });
    expect(document.activeElement).toBe(dong[0]);
    await userEvent.click(within(dong[2]).getByText("Kẽm CTP Phương Nam"));
    expect(onMo).toHaveBeenLastCalledWith(3);
  });

  it("ba câu rỗng: chưa có, lọc không ra, tải lỗi", async () => {
    const a = ve({ rows: [], tong: 0 });
    expect(screen.getByText(/Chưa có phiếu chi nào trong kỳ này/)).toBeInTheDocument();
    // Nút mời lập trong dòng rỗng là liên kết phụ — nút chính chỉ ở đầu trang.
    expect(screen.getByRole("button", { name: "Lập phiếu chi" })).toHaveClass("lds-lk");
    await userEvent.click(screen.getByRole("button", { name: "Lập phiếu chi" }));
    expect(a.onLap).toHaveBeenCalled();
  });

  it("lọc không ra thì mời Xoá bộ lọc", async () => {
    const p = ve({ rows: [], tong: 0, coLoc: true });
    expect(screen.getByText(/Không có phiếu nào khớp điều kiện đang lọc/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Xoá bộ lọc" }));
    expect(p.onBoLoc).toHaveBeenCalled();
  });

  it("tải lỗi không nói 'chưa có'", async () => {
    const p = ve({ rows: [], tong: 0, loi: "Mất kết nối" });
    expect(screen.getByText(/Không tải được danh sách phiếu chi/)).toBeInTheDocument();
    expect(screen.queryByText(/Chưa có phiếu chi nào trong kỳ này/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(p.onTaiLai).toHaveBeenCalled();
  });
});
