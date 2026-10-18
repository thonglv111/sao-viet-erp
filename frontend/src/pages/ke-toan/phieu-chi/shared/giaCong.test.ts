import { describe, expect, it, vi } from "vitest";

// Nhãn chặng dòng giấy đọc từ `/api/don-vi/tram` lúc chạy; test cho sẵn bảng nhỏ.
vi.mock("../../../tenDonVi", async (g) => ({
  ...(await g<typeof import("../../../tenDonVi")>()),
  nhanTram: (ma: string | null | undefined) =>
    ({ to: "tờ in", tay: "tay sách", con: "con" } as Record<string, string>)[(ma ?? "").toLowerCase()],
}));

import { soChot } from "./giaCong";

describe("soChot", () => {
  it("Số chốt gia công in nhãn chặng 790 tờ in (phiếu một phần lưu mã chặng vào don_vi)", () => {
    expect(soChot({ sl_cuoi: 790, don_vi: "to" })).toBe("790 tờ in");
    expect(soChot({ sl_cuoi: 250, don_vi: "tay" })).toBe("250 tay sách");
  });

  it("không có đơn vị thì chỉ hiện số, có định dạng nghìn kiểu Việt", () => {
    expect(soChot({ sl_cuoi: 1200, don_vi: null })).toBe("1.200");
  });
});
