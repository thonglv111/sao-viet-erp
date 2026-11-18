import { describe, expect, it } from "vitest";
import { chuCk, goCk, thanhTienDong, tongGomVat } from "./DonThuongMai";
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

describe("CK % dòng đơn thương mại", () => {
  it("ô CK nhận số lẻ bằng phẩy hoặc chấm, tối đa 2 số lẻ, không quá 100", () => {
    expect(goCk("2.5")).toBe("2,5");
    expect(goCk("12,345")).toBe("12,34");
    expect(goCk("150")).toBe("100");
    expect(goCk("a5%")).toBe("5");
  });

  it("thành tiền trừ CK rồi mới tính VAT, khớp máy chủ", () => {
    expect(thanhTienDong(10_000, 3, "12,5")).toBe(26_250);
    expect(tongGomVat([{ g: 10_000, sl: 3, ck: "12,5", vat: "10" }, { g: null, sl: 1, ck: "", vat: "0" }])).toBe(28_875);
    expect(chuCk(2.5)).toBe("2,5");
    expect(chuCk(null)).toBe("");
  });
});
