import { describe, expect, it } from "vitest";
import { mucGoiY, nhanNutChinh } from "./TaoDonThuongMai";

describe("trang Tạo đơn thương mại", () => {
  it("mức gợi ý tiền khách đưa: đúng số, chục nghìn, trăm nghìn, năm trăm nghìn, bỏ trùng", () => {
    expect(mucGoiY(259_000)).toEqual([259_000, 260_000, 300_000, 500_000]);
    expect(mucGoiY(500_000)).toEqual([500_000]);
    expect(mucGoiY(0)).toEqual([]);
  });

  it("chữ nút chính đổi theo Thanh toán và Xuất hàng", () => {
    expect(nhanNutChinh(true, true)).toBe("Tạo, chốt, xuất hàng và thu tiền");
    expect(nhanNutChinh(true, false)).toBe("Tạo, chốt và thu tiền");
    expect(nhanNutChinh(false, true)).toBe("Tạo, chốt và xuất hàng");
    expect(nhanNutChinh(false, false)).toBe("Tạo và chốt đơn");
  });
});
