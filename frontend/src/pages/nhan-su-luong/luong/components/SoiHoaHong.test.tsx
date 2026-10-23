// Ngăn soi hoa hồng (23/10/2026): từng lần thu tiền làm nên cột "Hoa hồng" của dòng lương.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { HoaHongChiTiet, PayrollLine, PayrollPeriod } from "../../../../api/client";

const chiTiet: HoaHongChiTiet = {
  tong: 259_445,
  items: [
    { receipt_id: 7, so_phieu: "PT-0801", order_id: 41, order_no: "DH-0041", invoice_no: "0000123",
      ngay_hoa_don: "2026-07-01", ngay_thu: "2026-08-05", so_ngay: 35, tien_thu: 9_000_000,
      goc: 8_648_148, pct: 0.03, pct_rieng: false, tien: 259_444.44 },
    { receipt_id: 8, so_phieu: "PT-0802", order_id: 42, order_no: "DH-0042", invoice_no: null,
      ngay_hoa_don: null, ngay_thu: "2026-08-06", so_ngay: 0, tien_thu: 1_000_000,
      goc: 0, pct: 0, pct_rieng: true, ly_do_rieng: "Loại KARTA", tien: 0 },
    { receipt_id: 9, so_phieu: "PT-0803", order_id: 43, order_no: "DH-0043", invoice_no: "0000555",
      hoa_don_huy: true, ngay_hoa_don: "2026-07-20", ngay_thu: "2026-08-07", so_ngay: 18,
      tien_thu: 0, goc: 0, pct: 0.03, pct_rieng: false, tien: 0 },
  ],
};

const { datRieng } = vi.hoisted(() => ({
  datRieng: vi.fn(() => Promise.resolve({ order_id: 41, pct: 0.01, ly_do: "Khách quen" })),
}));
vi.mock("../../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../../api/client")>()),
  api: { luong: { chiTietHoaHong: () => Promise.resolve(chiTiet), datHoaHongRieng: datRieng } },
}));

import { SoiHoaHong } from "./SoiHoaHong";

const KY = { id: 3, year: 2026, month: 8 } as PayrollPeriod;
const dong = (hoa_hong: number) => ({ id: 1, employee_name: "Kim Dung", hoa_hong }) as PayrollLine;

describe("SoiHoaHong", () => {
  it("đủ cột từ phiếu thu tới hoa hồng", async () => {
    render(<SoiHoaHong token="t" line={dong(259_445)} period={KY} coQuyenSua={false}
      onClose={() => {}} onDaDoi={() => {}} />);
    await screen.findByText("PT-0801");
    for (const c of ["Phiếu thu", "Đơn", "Hoá đơn", "Ngày HĐ", "Ngày thu", "Số ngày", "Tiền thu",
      "Gốc", "%", "Hoa hồng"])
      expect(screen.getByRole("columnheader", { name: c })).toBeInTheDocument();
    expect(screen.getAllByText("3%").length).toBeGreaterThan(0);
    expect(screen.getByText("% riêng")).toBeInTheDocument();
    expect(screen.queryByText(/khác cột Hoa hồng/)).toBeNull();
  });

  it("tổng lệch cột trên bảng lương thì cảnh báo", async () => {
    render(<SoiHoaHong token="t" line={dong(300_000)} period={KY} coQuyenSua={false}
      onClose={() => {}} onDaDoi={() => {}} />);
    expect(await screen.findByText(/khác cột Hoa hồng trên bảng lương/)).toHaveTextContent("Tính lại");
  });

  it("đang tính lại bảng lương thì không báo lệch oan", async () => {
    render(<SoiHoaHong token="t" line={dong(300_000)} period={KY} coQuyenSua={false} dangTinh
      onClose={() => {}} onDaDoi={() => {}} />);
    expect(await screen.findByText(/Đang tính lại bảng lương/)).toBeInTheDocument();
    expect(screen.queryByText(/khác cột Hoa hồng/)).toBeNull();
  });

  it("không có quyền sửa thì không có nút đặt % riêng", async () => {
    render(<SoiHoaHong token="t" line={dong(259_445)} period={KY} coQuyenSua={false}
      onClose={() => {}} onDaDoi={() => {}} />);
    await screen.findByText("PT-0801");
    expect(screen.queryByRole("button", { name: "Đặt % riêng" })).toBeNull();
  });

  it("đặt % riêng gửi phân số kèm lý do rồi báo bảng lương", async () => {
    const user = userEvent.setup();
    const onDaDoi = vi.fn();
    render(<SoiHoaHong token="t" line={dong(259_445)} period={KY} coQuyenSua
      onClose={() => {}} onDaDoi={onDaDoi} />);
    await screen.findByText("PT-0801");
    await user.click(screen.getAllByRole("button", { name: "Đặt % riêng" })[0]);
    // Ô mở ngay DƯỚI hàng vừa bấm, không ở cuối ngăn (người có vài trăm lần thu thì cuối là rất xa).
    const hangBam = screen.getByText("PT-0801").closest("tr")!;
    expect(hangBam.nextElementSibling).toContainElement(screen.getByLabelText("% hoa hồng riêng"));
    await user.type(screen.getByLabelText("% hoa hồng riêng"), "1");
    await user.type(screen.getByLabelText("Lý do"), "Khách quen");
    await user.click(screen.getByRole("button", { name: "Lưu % riêng" }));
    expect(datRieng).toHaveBeenCalledWith("t", 41, { pct: 0.01, ly_do: "Khách quen" });
    expect(onDaDoi).toHaveBeenCalled();
  });

  it("đơn đã có % riêng: mở ô điền sẵn % và lý do, có nút Bỏ", async () => {
    const user = userEvent.setup();
    render(<SoiHoaHong token="t" line={dong(259_445)} period={KY} coQuyenSua
      onClose={() => {}} onDaDoi={() => {}} />);
    await screen.findByText("PT-0802");
    await user.click(screen.getAllByRole("button", { name: "Đặt % riêng" })[1]);
    expect(screen.getByLabelText("% hoa hồng riêng")).toHaveValue("0");
    expect(screen.getByLabelText("Lý do")).toHaveValue("Loại KARTA");
    expect(screen.getByRole("button", { name: "Bỏ % riêng" })).toBeInTheDocument();
  });

  it("đơn chưa có % riêng thì không có nút Bỏ", async () => {
    const user = userEvent.setup();
    render(<SoiHoaHong token="t" line={dong(259_445)} period={KY} coQuyenSua
      onClose={() => {}} onDaDoi={() => {}} />);
    await screen.findByText("PT-0801");
    await user.click(screen.getAllByRole("button", { name: "Đặt % riêng" })[0]);
    expect(screen.getByLabelText("% hoa hồng riêng")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Bỏ % riêng" })).toBeNull();
  });

  it("kỳ đã chốt thì cảnh báo lệch không bảo bấm Tính lại", async () => {
    render(<SoiHoaHong token="t" line={dong(300_000)} period={{ ...KY, status: "locked" }}
      coQuyenSua={false} onClose={() => {}} onDaDoi={() => {}} />);
    const bao = await screen.findByText(/khác cột Hoa hồng trên bảng lương/);
    expect(bao).not.toHaveTextContent("Tính lại");
    expect(bao).toHaveTextContent("đã chốt");
  });

  it("tiền thu trên hoá đơn đã huỷ thì ghi rõ", async () => {
    render(<SoiHoaHong token="t" line={dong(259_445)} period={KY} coQuyenSua={false}
      onClose={() => {}} onDaDoi={() => {}} />);
    expect(await screen.findByText("0000555")).toBeInTheDocument();
    expect(screen.getByText("đã huỷ")).toBeInTheDocument();
  });
});
