import { describe, expect, it } from "vitest";
import { taoLuot } from "./luotMoiNhat";

// Lỗi #48 bấm thử 18/10/2026: hai lượt tải về ngược thứ tự, lượt cũ (cả tháng) đè số của kỳ.
describe("taoLuot", () => {
  it("chỉ lượt bắt đầu sau cùng còn được ghi kết quả", async () => {
    const luot = taoLuot();
    const ghi: string[] = [];
    let traCu!: (v: string) => void;
    const cu = luot.bat();
    const pCu = new Promise<string>((r) => { traCu = r; });
    const moi = luot.bat();
    await Promise.resolve("ky").then((v) => { if (moi()) ghi.push(v); });
    traCu("thang");
    await pCu.then((v) => { if (cu()) ghi.push(v); });
    expect(ghi).toEqual(["ky"]);
  });
  it("một lượt duy nhất thì luôn được ghi", () => {
    const luot = taoLuot();
    expect(luot.bat()()).toBe(true);
  });
});
