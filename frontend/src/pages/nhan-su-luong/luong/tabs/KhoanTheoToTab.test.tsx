// Màn Khoán theo tổ (22/10/2026): tên cột theo chốt của chủ, dòng tổ trưởng ở MỌI lần ghi, lương
// khoán không gồm tăng ca khoán, người tổ khác ghi tổ sau tên.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { KhoanTheoTo, KttLanGhi } from "../../../../api/client";

const lan = (batch_id: number, ngay: string, tien: number, nguoi: KttLanGhi["nguoi"], tt: number): KttLanGhi => ({
  batch_id, ngay, to_id: 1, to_ten: "Dán", nguon_loai: "lsx", nguon_id: 9, lenh_ma: "LSX26-0412",
  lenh_ten: "Thùng khay", khach: "WIPRO", quy_cach: null, cong_doan: "Dán TĐ", bac: null, tuy_chon: [],
  phat_sinh: [], so_luong: 1000, don_vi: "to", tien_chinh: tien, tien, he_so: 1, ghi_chu: null,
  cong_thuc: "Giá cố định + SL ghi × Đơn giá khoán = 0 + 1.000 × 100 = 100.000", nguoi,
  to_truong: [{ ten: "Phan Văn Quí", che_do: "chia", ty_le: 5, tien: tt }],
});
const ng = (emp_id: number, ten: string, tien: number, to_ten: string | null = null) =>
  ({ emp_id, ten, to_ten, luong_bu_lo: 10_000_000, tien });

const data: KhoanTheoTo = {
  year: 2026, month: 10, cac_to: [{ id: 1, ten: "Dán" }], to_id: 1, to_ten: "Dán", la_to_in: false,
  co_bang_luong: true,
  to_truong: { emp_id: 1, ten: "Phan Văn Quí", che_do: "chia", ty_le: 5, tien: 70_000 },
  quy: { san_luong: 1_400_000, dung_may: 0, tang_ca: 200_000, tong: 1_600_000 },
  nguoi: [
    { emp_id: 1, ten: "Phan Văn Quí", to_ten: null, la_thanh_vien: true, luong_bu_lo: 10_000_000,
      san_luong: 475_000, dung_may: 0, tang_ca: 100_000, to_truong: 70_000, o_to_khac: 0, cong_nhat: false, luong_khoan: 545_000,
      thu_viec: false, phan_bo_bu_lo: 400_000, cong: 1, chuan_cong: 26, an: "khoan", luong_chinh: 545_000 },
  ],
  doi_chieu: { quy: 1_600_000, tang_ca: 200_000, to_truong_thuong: 0, cong_nhat: 0, nguoi_to_khac: 0,
    o_to_khac: 0, luong_khoan: 545_000, bu_lo: 0, luong_chinh: 545_000 },
  so: [lan(11, "2026-10-05", 1_000_000, [ng(1, "Phan Văn Quí", 475_000), ng(2, "Mai Bảo Trang", 475_000)], 50_000),
       lan(12, "2026-10-06", 400_000, [ng(2, "Mai Bảo Trang", 380_000)], 20_000)],
  khac: [{ ...lan(13, "2026-10-06", 200_000, [ng(2, "Mai Bảo Trang", 100_000), ng(9, "Lê Văn Hùng", 100_000, "Máy 4 màu")], 0),
           to_id: 5, to_ten: "Máy 4 màu", to_truong: [] }],
  dung_may: [],
  ngay: [{ ngay: "2026-10-05", quy: 1_000_000, chi_tieu: 600_000, tang_ca: 200_000 }],
};

vi.mock("../../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../../api/client")>()),
  api: { luong: { khoanTheoTo: () => Promise.resolve(data) } },
}));

import { KhoanTheoToTab } from "./KhoanTheoToTab";

describe("Khoán theo tổ", () => {
  it("bảng chia dùng tên Phân bổ lương bù lỗ, không có chữ lương ca máy", async () => {
    const { container } = render(<KhoanTheoToTab token="t" />);
    await screen.findByText("Chia cho người");
    expect(screen.getByRole("columnheader", { name: "Phân bổ lương bù lỗ" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Tăng ca khoán" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/lương ca máy/i);
  });

  it("lương khoán không cộng tăng ca khoán", async () => {
    render(<KhoanTheoToTab token="t" />);
    const hang = (await screen.findAllByRole("row")).find((r) => within(r).queryByText("lương bù lỗ 10.000.000"))!;
    expect(within(hang).getAllByText("545.000").length).toBeGreaterThan(0);
    expect(within(hang).queryByText("645.000")).toBeNull();
  });

  it("mọi lần ghi của sổ có dòng Tổ trưởng chia, kể cả lần tổ trưởng không làm", async () => {
    render(<KhoanTheoToTab token="t" />);
    await screen.findByText("Sổ sản lượng");
    expect(screen.getAllByText("Tổ trưởng chia", { selector: "li span" })).toHaveLength(2);
    expect(screen.getByText("vượt chỉ tiêu 600.000")).toBeTruthy();
  });

  it("khối tổ khác ghi tổ sau tên người không thuộc tổ", async () => {
    render(<KhoanTheoToTab token="t" />);
    await screen.findByText("Người của tổ làm ở tổ khác");
    expect(screen.getAllByText("Máy 4 màu").length).toBeGreaterThan(0);
    expect(screen.getByText("Văn Hùng")).toBeTruthy();
  });
});
