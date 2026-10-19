import { describe, expect, it } from "vitest";
import type { StockRequest } from "../api/client";
import { nguonSanXuat } from "./khoNganA";

// Lỗi #41 bấm thử 18/10/2026: hàng nhà gia công giao về bị gọi "KCS gửi thành phẩm".
const yc = (kw: Partial<StockRequest>, tu_kcs = false) =>
  ({ loai: "NHAP", gia_cong_ngoai_id: null, lines: [{ tu_kcs }], ...kw }) as unknown as StockRequest;

describe("nguonSanXuat", () => {
  it("yêu cầu mang mã gia công ngoài là gia công, kể cả khi dòng đánh dấu thành phẩm", () => {
    expect(nguonSanXuat(yc({ gia_cong_ngoai_id: 5 }, true))).toBe("gia_cong");
  });
  it("thành phẩm từ xưởng là KCS", () => {
    expect(nguonSanXuat(yc({}, true))).toBe("kcs");
  });
  it("không thuộc hai nguồn đó thì null", () => {
    expect(nguonSanXuat(yc({}))).toBeNull();
  });
});
