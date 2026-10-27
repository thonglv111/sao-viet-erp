import { describe, expect, it } from "vitest";

import { vtPayloadLines, vtPayloadNhapLai } from "./ThsxExecPanels";

/** Dòng kế hoạch mẫu — Ivory 350, kế hoạch 554 tờ. */
function dong(over: Partial<Parameters<typeof vtPayloadLines>[0][number]> = {}) {
  return {
    key: "vat_tu:7",
    hang_loai: "vat_tu",
    hang_id: 7,
    ten: "Ivory 350 79×109",
    don_vi_goc: "",
    kho_rong: 0,
    kho_dai: 0,
    dvt: "to",
    dvtKeHoach: "to",
    sl_ke_hoach: 554,
    sl_yeu_cau: 554,
    tuKeHoach: true,
    ...over,
  };
}

describe("vtPayloadLines — giấy mang khổ, không mang dạng", () => {
  it("dòng giấy gửi khổ đã chuẩn hoá (ngắn × dài), không gửi đơn vị gốc", () => {
    const [ln] = vtPayloadLines([dong({
      key: "giay:3", hang_loai: "giay", hang_id: 3, don_vi_goc: "to", kho_rong: 905, kho_dai: 780,
      dvt: "to_nguyen", dvtKeHoach: "to_nguyen", sl_ke_hoach: 5000, sl_yeu_cau: 5000,
    })], "lan_dau");
    expect([ln.kho_rong, ln.kho_dai]).toEqual([780, 905]);
    expect("dang_giay" in ln).toBe(false);
    expect("don_vi_goc" in ln).toBe(false);
  });

  it("giấy khổ chỉ rộng gửi dài 0", () => {
    const [ln] = vtPayloadLines([dong({
      key: "moi-1", hang_loai: "giay", hang_id: 3, don_vi_goc: "kg", kho_rong: 1000, kho_dai: 0,
      dvt: "kg", dvtKeHoach: "kg", sl_ke_hoach: 0, sl_yeu_cau: 300, tuKeHoach: false,
    })], "lan_dau");
    expect([ln.kho_rong, ln.kho_dai, ln.dvt]).toEqual([1000, 0, "kg"]);
  });

  it("vật tư khác mang khổ tuỳ chọn (trống ⇒ 0 · 0)", () => {
    const [ln] = vtPayloadLines([dong()], "lan_dau");
    expect([ln.kho_rong, ln.kho_dai]).toEqual([0, 0]);
    const [co] = vtPayloadLines([dong({ kho_rong: 320 })], "lan_dau");
    expect([co.kho_rong, co.kho_dai]).toEqual([320, 0]);
    // Bỏ hỏi lý do khi xin khác kế hoạch: dòng gửi không còn trường lý do.
    expect("ly_do_chenh_lech" in ln).toBe(false);
  });
});

describe("vtPayloadNhapLai — yêu cầu nhập lại vật tư thừa", () => {
  it("chỉ dòng dương, đổi sl_yeu_cau → so_luong", () => {
    const ds = vtPayloadNhapLai([
      dong({ tuKeHoach: false, sl_yeu_cau: 2, dvt: "kg" }),
      dong({ key: "vat_tu:8", hang_id: 8, tuKeHoach: false, sl_yeu_cau: 0, dvt: "kg" }),
    ]);
    expect(ds).toEqual([{ hang_loai: "vat_tu", hang_id: 7, dvt: "kg", so_luong: 2, kho_rong: 0, kho_dai: 0 }]);
  });

  it("giấy mang khổ (ngắn × dài)", () => {
    const [ln] = vtPayloadNhapLai([dong({
      hang_loai: "giay", hang_id: 3, tuKeHoach: false, don_vi_goc: "to",
      kho_rong: 1090, kho_dai: 790, dvt: "to_nguyen", sl_yeu_cau: 70,
    })]);
    expect(ln).toEqual({ hang_loai: "giay", hang_id: 3, dvt: "to_nguyen", so_luong: 70, kho_rong: 790, kho_dai: 1090 });
  });
});
