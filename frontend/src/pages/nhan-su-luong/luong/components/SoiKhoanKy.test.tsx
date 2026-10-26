// Ngăn soi Khoán SP (Đợt 2): lần ghi có thẻ tuỳ chọn + tỷ lệ chia, dòng ngày dừng máy.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { KhoanKyChiTiet, PayrollLine, PayrollPeriod } from "../../../../api/client";

const chiTiet: KhoanKyChiTiet = {
  tong_khoan: 401_739,
  tong_tang_ca_khoan: 0,
  items: [
    { loai: "lan_ghi", batch_id: 9, ngay: "2026-10-21", cong_doan: "Bế", to: "Kíp bế 2", so_luong: 2000,
      tien_lan_ghi: 160_000, so_nguoi: 2, ty_le: 0.6087, luong_bu_lo: 7_000_000, tong_luong_bu_lo: 11_500_000,
      to_truong: [5], tuy_chon: ["trùng khuôn", "3 số lỗ đục"], tien: 92_522 },
    { loai: "dung_may", ngay: "2026-10-22", to: "Kíp bế 2", ly_do: "Máy hư", sua_chua: "SC-0014",
      tien_ngay: 500_000, so_nguoi: 2, ty_le: 0.6087, tuy_chon: [], tien: 304_348 },
  ],
};

vi.mock("../../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../../api/client")>()),
  api: { luong: { chiTietKhoanKy: () => Promise.resolve(chiTiet) } },
}));

import { SoiKhoanKy } from "./SoiKhoanKy";

const KY = { id: 3, year: 2026, month: 10 } as PayrollPeriod;
const DONG = { id: 1, employee_name: "Nguyễn Văn Nhất", khoan: 401_739 } as PayrollLine;

describe("Ngăn soi Khoán SP — Đợt 2", () => {
  it("lần ghi hiện thẻ tuỳ chọn và % sau trích tổ trưởng; dòng dừng máy hiện lý do + phiếu sửa", async () => {
    render(<SoiKhoanKy token="t" line={DONG} period={KY} onClose={() => {}} />);
    const the = await screen.findByText("trùng khuôn");
    const hang = screen.getAllByRole("row");
    const lanGhi = hang.find((r) => within(r).queryByText("Bế"))!;
    expect(lanGhi).toContainElement(the);
    expect(within(lanGhi).getByText("3 số lỗ đục")).toBeInTheDocument();
    // % trên TỔNG tiền lần ghi, đã trích 5% tổ trưởng: 95% × 60,9% = 57,8%.
    expect(within(lanGhi).getByText("57,8%")).toBeInTheDocument();
    expect(screen.queryByText(/Trích cho tổ trưởng/)).toBeNull();

    const dm = hang.find((r) => within(r).queryByText("Dừng máy"))!;
    expect(within(dm).getByText("Máy hư")).toBeInTheDocument();
    expect(within(dm).getByText("SC-0014")).toBeInTheDocument();
  });
});
