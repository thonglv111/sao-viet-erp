// GUARD lớp điện thoại (14/10/2026): chủ chốt giao diện điện thoại là giao diện RIÊNG, KHÔNG được
// chạm iPad / laptop / PC. Mọi CSS điện thoại sống trong thư mục này và MỌI khối cấp ngoài cùng phải
// là đúng `@media (max-width: 639px)` — một luật lọt ra ngoài mốc là đổi giao diện máy lớn.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MOC_DIEN_THOAI } from "../../utils/dienThoai";

const THU_MUC = dirname(fileURLToPath(import.meta.url));
const MOC = `@media (max-width: ${MOC_DIEN_THOAI}px)`;

/** Các khối cấp ngoài cùng: trả phần "đầu" (selector / at-rule) của từng khối. */
function khoiNgoai(css: string): string[] {
  const sach = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const dau: string[] = [];
  let sau = 0;
  let batDau = 0;
  for (let i = 0; i < sach.length; i++) {
    const c = sach[i];
    if (c === "{") {
      if (sau === 0) dau.push(sach.slice(batDau, i).trim());
      sau++;
    } else if (c === "}") {
      sau--;
      if (sau === 0) batDau = i + 1;
    } else if (c === ";" && sau === 0) {
      // @import / @charset … cấp ngoài cùng cũng là "luật lọt mốc".
      dau.push(sach.slice(batDau, i).trim());
      batDau = i + 1;
    }
  }
  return dau;
}

describe("lớp CSS điện thoại chỉ sống trong mốc ≤ 639px", () => {
  const files = readdirSync(THU_MUC).filter((f) => f.endsWith(".css"));

  it("thư mục có file CSS điện thoại", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f}: mọi khối ngoài cùng là ${MOC}`, () => {
      const css = readFileSync(join(THU_MUC, f), "utf8");
      const sai = khoiNgoai(css).filter((d) => d !== MOC);
      expect(sai, `khối lọt ra ngoài mốc điện thoại trong ${f}`).toEqual([]);
    });
  }
});
