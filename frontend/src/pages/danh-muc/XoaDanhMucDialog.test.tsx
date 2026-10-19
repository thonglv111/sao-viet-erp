/** Hộp "Xóa" của danh mục dùng chung: một nút, hai kết cục do số liệu quyết định. */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoi = vi.hoisted(() => ({ kiemXoa: vi.fn() }));
vi.mock("../../api/rebuildCatalog", async (g) => ({
  ...(await g<typeof import("../../api/rebuildCatalog")>()),
  kiemXoa: hoi.kiemXoa,
}));

import { XoaDanhMucDialog } from "./XoaDanhMucDialog";
import type { CatalogConfig, Row } from "./types";

const CONFIG: CatalogConfig = {
  title: "Đơn vị",
  prefix: "/api/don-vi",
  nhatKyLoai: "don_vi",
  softDelete: true,
  columns: [],
  fields: [],
};
const ROW: Row = { id: 5, ma: "TO", ten: "Tờ in" };

function mo() {
  return render(
    <XoaDanhMucDialog row={ROW} config={CONFIG} token="t" onClose={() => {}} onXong={() => {}} onLoi={() => {}} />,
  );
}

beforeEach(() => hoi.kiemXoa.mockReset());

describe("XoaDanhMucDialog", () => {
  it("#7 Ngừng dùng liệt kê từng nơi đang dùng thành danh sách, không nối bằng dấu chấm giữa", async () => {
    hoi.kiemXoa.mockResolvedValue({
      xoa_han_duoc: false,
      chan: ["3 công đoạn", "2 bảng giá giấy", "1 phiếu tính giá"],
      keo_theo: [],
    });
    mo();
    const hop = await screen.findByRole("dialog", { name: "Ngừng dùng" });
    const ds = within(hop).getAllByRole("listitem").map((li) => li.textContent);
    expect(ds).toEqual(["3 công đoạn", "2 bảng giá giấy", "1 phiếu tính giá"]);
    expect(hop.textContent).not.toContain("·");
    expect(hop.textContent).toMatch(/không xóa hẳn được/);
  });

  it("#7 xóa hẳn: thứ sẽ mất theo cũng liệt kê thành danh sách", async () => {
    hoi.kiemXoa.mockResolvedValue({ xoa_han_duoc: true, chan: [], keo_theo: ["4 dòng quy đổi", "1 vị trí"] });
    mo();
    const hop = await screen.findByRole("dialog", { name: "Xóa hẳn" });
    expect(within(hop).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["4 dòng quy đổi", "1 vị trí"]);
    expect(hop.textContent).not.toContain("·");
  });

  it("chưa ai dùng, không kéo theo gì: không có danh sách", async () => {
    hoi.kiemXoa.mockResolvedValue({ xoa_han_duoc: true, chan: [], keo_theo: [] });
    mo();
    const hop = await screen.findByRole("dialog", { name: "Xóa hẳn" });
    expect(within(hop).queryAllByRole("listitem")).toHaveLength(0);
  });
});
