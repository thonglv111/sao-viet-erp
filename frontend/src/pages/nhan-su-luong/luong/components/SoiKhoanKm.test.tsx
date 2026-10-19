// Hộp đối chiếu khoán km phải nói dòng nào là CHẶNG VỀ KHO (lỗi #38 bấm thử 18/10/2026).
//
// Chặng về kho của lượt xe là một dòng riêng mang cùng mã chuyến (chuyến ở điểm cuối), cùng ngày,
// thường cùng km. Không ghi gì thì HCNS thấy mỗi chuyến hai dòng giống hệt, tưởng máy tính đôi.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { KhoanKmChiTiet, PayrollLine, PayrollPeriod } from "../../../../api/client";

const chiTiet = {
  tong: 268_800,
  items: [
    { trip_id: 15, ma_chuyen: "YCGH-261012-0001", ngay: "2026-10-12T03:00:00Z", km: 20, don_gia_km: 11_200, vai_tro: "tai_xe",
      pct: 60, thanh_tien: 134_400, ghi_chu: null },
    { trip_id: 15, ma_chuyen: "YCGH-261012-0001", ngay: "2026-10-12T05:00:00Z", km: 20, don_gia_km: 11_200, vai_tro: "tai_xe",
      pct: 60, thanh_tien: 134_400, ghi_chu: "Về kho của lượt LX-261012-O1EQ" },
  ],
} as unknown as KhoanKmChiTiet;

vi.mock("../../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../../api/client")>()),
  api: { luong: { chiTietKhoanKm: () => Promise.resolve(chiTiet) } },
}));

import { SoiKhoanKm } from "./SoiKhoanKm";

const KY = { id: 3, year: 2026, month: 10 } as PayrollPeriod;
const DONG = { id: 1, employee_name: "Trần Hùng Tín", khoan_km: 268_800 } as PayrollLine;

describe("Khoán km — chặng về kho (#38)", () => {
  it("dòng chặng về kho ghi rõ 'Về kho', dòng giao khách thì không", async () => {
    render(<SoiKhoanKm token="t" line={DONG} period={KY} onClose={() => {}} />);
    const ghiChu = await screen.findByText("Về kho của lượt LX-261012-O1EQ");
    const hang = screen.getAllByRole("row").filter((r) => within(r).queryByText("YCGH-261012-0001"));
    expect(hang).toHaveLength(2);
    expect(hang[1]).toContainElement(ghiChu);
    expect(within(hang[0]).queryByText(/Về kho/)).toBeNull();
  });
});
