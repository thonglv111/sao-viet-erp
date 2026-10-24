import { describe, expect, it } from "vitest";
import { gocDongXin, khoaNguong, khoaTon, nhanDongTon, toTuKg } from "./khoGiay";

// Danh mục Đơn vị chưa nạp trong test ⇒ tên đơn vị rơi về mã trần (`to`, `kg`).
describe("nhanDongTon", () => {
  it("giấy đủ hai cạnh ghi khổ + đơn vị gốc", () => {
    expect(nhanDongTon("to", 780, 905)).toBe("780 × 905 mm (to)");
  });
  it("khổ chỉ rộng ghi 'khổ … mm'", () => {
    expect(nhanDongTon("kg", 1000, 0)).toBe("khổ 1000 mm (kg)");
  });
  it("giấy chưa có khổ vẫn ghi đơn vị", () => {
    expect(nhanDongTon("kg", 0, 0, { laGiay: true })).toBe("chưa có khổ (kg)");
  });
  it("hàng khác không nhãn", () => {
    expect(nhanDongTon("", 0, 0)).toBe("");
    expect(nhanDongTon(null, 0, 0, { laGiay: false })).toBe("");
  });
});

describe("khoaTon / khoaNguong — khớp khoá 5 phần của máy chủ", () => {
  it("giấy: mã + khổ (cạnh ngắn trước) + đơn vị gốc", () => {
    expect(khoaTon({ hang_loai: "giay", hang_id: 12, kho_rong: 905, kho_dai: 780, don_vi_goc: "to" }))
      .toBe("giay:12:780:905:to");
  });
  it("cùng khổ khác đơn vị gốc là hai khoá", () => {
    const a = khoaTon({ hang_loai: "giay", hang_id: 12, kho_rong: 1000, kho_dai: 0, don_vi_goc: "to" });
    const b = khoaTon({ hang_loai: "giay", hang_id: 12, kho_rong: 1000, kho_dai: 0, don_vi_goc: "kg" });
    expect(a).toBe("giay:12:1000:0:to");
    expect(b).toBe("giay:12:1000:0:kg");
  });
  it("vật tư khác: vat_tu:id:0:0:gốc — không khổ, tách theo đơn vị gốc", () => {
    expect(khoaTon({ hang_loai: "vat_tu", hang_id: 5, don_vi_goc: "KG" })).toBe("vat_tu:5:0:0:kg");
    expect(khoaTon({ hang_loai: "vat_tu", hang_id: 5, don_vi_goc: "thung", kho_rong: 700, kho_dai: 1000 }))
      .toBe("vat_tu:5:0:0:thung");
  });
  it("hàng khác: loai:id:0:0:", () => {
    expect(khoaTon({ hang_loai: "thanh_pham", hang_id: 5, don_vi_goc: "cai" })).toBe("thanh_pham:5:0:0:");
  });
  it("ngưỡng dùng chung khoá với dòng tồn", () => {
    expect(khoaNguong({ hang_loai: "giay", hang_id: 12, kho_rong: 780, kho_dai: 905, don_vi_goc: "to" }))
      .toBe("giay:12:780:905:to");
    expect(khoaNguong({ hang_loai: "vat_tu", hang_id: 5, kho_rong: 0, kho_dai: 0, don_vi_goc: "thung" }))
      .toBe("vat_tu:5:0:0:thung");
  });
});

// Phản chiếu `kho_giay.to_tu_kg`: tờ lẻ không có thật ⇒ làm tròn xuống; thiếu khổ/gsm ⇒ null.
describe("toTuKg", () => {
  it("làm tròn xuống theo khổ + gsm, không theo hệ số đã làm tròn", () => {
    expect(toTuKg(84, 650, 860, 300)).toBe(500);
    expect(toTuKg(50, 650, 860, 300)).toBe(298);   // 50 × (500/84) = 297,6 sẽ lệch 1 tờ
    expect(toTuKg(299.35, 650, 860, 350)).toBe(1530);
  });
  it("kg quá nhỏ ra 0 tờ", () => {
    expect(toTuKg(0.1, 650, 860, 300)).toBe(0);
  });
  it("thiếu cạnh hoặc gsm ⇒ null", () => {
    expect(toTuKg(10, 860, 0, 300)).toBeNull();
    expect(toTuKg(10, 650, 860, 0)).toBeNull();
  });
});

describe("gocDongXin — dòng xin giấy khổ hai cạnh theo kg đọc thành tờ như máy chủ", () => {
  it("kg khổ hai cạnh ⇒ tờ, làm tròn xuống", () => {
    expect(gocDongXin({ hangLoai: "giay", donViGoc: "kg", rong: 430, dai: 650, slGoc: 20, gsm: 150 }))
      .toEqual({ goc: "to", sl: 477 });
  });
  it("cuộn, tờ sẵn, hàng khác, thiếu gsm ⇒ giữ nguyên", () => {
    expect(gocDongXin({ hangLoai: "giay", donViGoc: "kg", rong: 870, dai: 0, slGoc: 20, gsm: 150 }))
      .toEqual({ goc: "kg", sl: 20 });
    expect(gocDongXin({ hangLoai: "giay", donViGoc: "to", rong: 430, dai: 650, slGoc: 20, gsm: 150 }))
      .toEqual({ goc: "to", sl: 20 });
    expect(gocDongXin({ hangLoai: "vat_tu", donViGoc: "kg", rong: 0, dai: 0, slGoc: 5, gsm: null }))
      .toEqual({ goc: "kg", sl: 5 });
    expect(gocDongXin({ hangLoai: "giay", donViGoc: "kg", rong: 430, dai: 650, slGoc: 20, gsm: null }))
      .toEqual({ goc: "to", sl: null });
  });
});
