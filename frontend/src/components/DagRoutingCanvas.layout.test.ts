import { describe, expect, it } from "vitest";
import { computeAutoLayout } from "./DagRoutingCanvas";
import type { EditRow } from "../pages/lsxBuoc";

const buoc = (key: string, truoc: string[] = []) => ({ key, phu_thuoc_step_keys: truoc }) as unknown as EditRow;

describe("computeAutoLayout", () => {
  it("hàng chính là chuỗi dài nhất, Tề sóng xuống hàng dưới sát trước bước bồi (e2e chuẩn bị giấy 24/10)", () => {
    // Thứ tự lưu: Tề sóng đứng đầu, nhưng nó chỉ nối vào Bồi — chạy song song cả nhánh giấy.
    const rows = [
      buoc("ts"),
      buoc("cgc"),
      buoc("tgi", ["cgc"]),
      buoc("in", ["tgi"]),
      buoc("can", ["in"]),
      buoc("boi", ["can", "ts"]),
      buoc("be", ["boi"]),
    ];

    const p = computeAutoLayout(rows);

    const chinh = p.cgc.y;
    for (const k of ["tgi", "in", "can", "boi", "be"]) expect(p[k].y).toBe(chinh);
    expect(p.ts.y).toBeGreaterThan(chinh);
    expect(p.ts.x).toBe(p.can.x);
  });

  it("chuỗi thẳng giữ nguyên một hàng, mỗi bước một cột", () => {
    const p = computeAutoLayout([buoc("a"), buoc("b", ["a"]), buoc("c", ["b"])]);
    expect(new Set([p.a.y, p.b.y, p.c.y]).size).toBe(1);
    expect(p.a.x).toBeLessThan(p.b.x);
    expect(p.b.x).toBeLessThan(p.c.x);
  });
});
