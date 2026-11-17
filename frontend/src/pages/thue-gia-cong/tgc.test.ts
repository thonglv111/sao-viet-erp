import { describe, expect, it } from "vitest";
import { ngayNgan, tamTinh, viTriTrongDai, type BuocDai } from "./tgc";

const b = (
  ten: string,
  loai: BuocDai["loai_buoc"],
  opts: { key?: string; phu_thuoc?: string[] } = {},
): BuocDai => ({ key: opts.key ?? ten, ten, loai_buoc: loai, phu_thuoc_step_keys: opts.phu_thuoc ?? [] });

describe("viTriTrongDai — cùng luật gom việc của máy chủ (không còn điều kiện cùng nhà)", () => {
  const rows = [b("In", "may"), b("Cán màng", "thue_ngoai"), b("Ép kim", "thue_ngoai"), b("Dán", "to")];
  it("bước không thuê ngoài thì null", () => {
    expect(viTriTrongDai(rows, 0)).toBeNull();
  });
  it("hai bước Thuê ngoài liền nhau là một việc", () => {
    expect(viTriTrongDai(rows, 1)).toEqual({ truoc: null, sau: "Ép kim", laCuoi: false });
    expect(viTriTrongDai(rows, 2)).toEqual({ truoc: "Cán màng", sau: null, laCuoi: true });
  });
  it("hai nhánh song song đứng cạnh nhau trong mảng nhưng không có cạnh nối ⇒ hai việc", () => {
    const r = [
      b("In", "may", { key: "p" }),
      b("Cán màng", "thue_ngoai", { key: "a", phu_thuoc: ["p"] }),
      b("Ép kim", "thue_ngoai", { key: "c", phu_thuoc: ["p"] }),
    ];
    expect(viTriTrongDai(r, 1)).toEqual({ truoc: null, sau: null, laCuoi: true });
    expect(viTriTrongDai(r, 2)).toEqual({ truoc: null, sau: null, laCuoi: true });
  });
});

describe("tiền và ngày", () => {
  it("tạm tính làm tròn đồng, ô trống tính 0", () => {
    expect(tamTinh(1660, 600)).toBe(996000);
    expect(tamTinh(3, 333.335)).toBe(1000);
    expect(tamTinh(null, 600)).toBe(0);
  });
  it("ngày ngắn dd/mm", () => {
    expect(ngayNgan("2026-11-13")).toBe("13/11");
    expect(ngayNgan("2026-11-13T08:00:00Z")).toBe("13/11");
    expect(ngayNgan(null)).toBe("");
  });
});
