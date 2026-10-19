import { describe, expect, it } from "vitest";

import { cauMuaKhacQuyCach } from "./muaKhacQuyCach";

describe("cauMuaKhacQuyCach (#23)", () => {
  it("gọi tên đơn, số, đơn vị và khổ — không nối bằng dấu chấm giữa", () => {
    const [c] = cauMuaKhacQuyCach([
      { ma: "DMH-261018-FK51", so_luong: 47, don_vi: "kg", kho_rong: 650, kho_dai: 860 },
    ]);
    expect(c).toBe("Đã mua khác quy cách: DMH-261018-FK51 47 kg 650 × 860 mm");
    expect(c).not.toContain("·");
  });

  it("không có thì rỗng", () => {
    expect(cauMuaKhacQuyCach(undefined)).toEqual([]);
  });
});
