import { describe, expect, it } from "vitest";
import { chonDuocTrongPhieu } from "./congDoanPhieuTinhGia";

describe("chonDuocTrongPhieu", () => {
  it("bỏ công đoạn trước in, kể cả khâu chuẩn bị giấy hệ thống", () => {
    expect(chonDuocTrongPhieu({ ma: "CGC", nhom: "prepress", active: true })).toBe(false);
    expect(chonDuocTrongPhieu({ ma: "TGI", nhom: "prepress", active: true })).toBe(false);
    expect(chonDuocTrongPhieu({ ma: "CT", nhom: "prepress", active: true })).toBe(false);
  });

  it("giữ In và sau in đang dùng, bỏ công đoạn đã tắt", () => {
    expect(chonDuocTrongPhieu({ ma: "CD-IN", nhom: "print", active: true })).toBe(true);
    expect(chonDuocTrongPhieu({ ma: "BTĐ", nhom: "finishing", active: true })).toBe(true);
    expect(chonDuocTrongPhieu({ ma: "BE", nhom: "finishing", active: false })).toBe(false);
  });
});
