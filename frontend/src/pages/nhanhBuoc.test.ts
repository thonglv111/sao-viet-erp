import { describe, expect, it } from "vitest";

import { lamSau, nhanhCuaBuoc } from "./nhanhBuoc";

const b = (key: string, truoc: string[], vt: number[] = []) => ({
  key, phu_thuoc_step_keys: truoc, vat_tus: vt.map((id) => ({ hang_loai: "giay", vat_tu_id: id })),
});

describe("nhanhCuaBuoc", () => {
  it("Tề giấy in → In → Bồi ← Tề sóng ra giấy, giấy, gộp, sóng", () => {
    const rows = [b("te", [], [1]), b("in", ["te"]), b("ts", [], [2]), b("boi", ["in", "ts"]), b("be", ["boi"])];
    expect(nhanhCuaBuoc(rows, 1, 2)).toEqual({ te: "giay", in: "giay", ts: "song", boi: "gop", be: "gop" });
  });

  it("sóng đúng khổ gắn thẳng vào bồi thì bồi là gộp", () => {
    const rows = [b("in", [], [1]), b("boi", ["in"], [2])];
    expect(nhanhCuaBuoc(rows, 1, 2)).toEqual({ in: "giay", boi: "gop" });
  });

  it("lệnh không sóng thì mọi bước null", () => {
    expect(nhanhCuaBuoc([b("in", [], [1]), b("can", ["in"])], 1, null)).toEqual({ in: null, can: null });
  });
});

describe("lamSau", () => {
  const rows = [b("in", []), b("ts", []), b("boi", ["in", "ts"]), b("be", ["boi"]), b("x", ["zz"])];
  const ten = (k: string) => ({ in: "In", ts: "Tề sóng", boi: "Bồi", be: "Bế" } as Record<string, string>)[k] ?? null;

  it("gốc ghi Bắt đầu, nối dòng trên để trống, gộp ghi tên", () => {
    expect(lamSau(rows, 0, ten)).toBe("Bắt đầu");
    expect(lamSau(rows, 1, ten)).toBe("Bắt đầu");
    expect(lamSau(rows, 2, ten)).toBe("In và Tề sóng");
    expect(lamSau(rows, 3, ten)).toBe("");
    expect(lamSau(rows, 4, ten)).toBe("bước lệnh khác");
  });
});
