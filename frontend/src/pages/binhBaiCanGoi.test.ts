import { describe, expect, it } from "vitest";
import { chonBinhBaiCanGoi, type DongBinhBai } from "./binhBaiCanGoi";

const sp = (u: string, kw: Partial<DongBinhBai> = {}): DongBinhBai => ({
  u, a: true, kd: 790, kr: 540, d: 148, r: 210, cd: 10, cr: 0, ...kw,
});

/** Mô phỏng effect: chọn rồi "gửi" — ghi chữ ký đã gửi như nơi gọi làm. */
function guiLuot(rows: DongBinhBai[], daGui: Map<string, string>): string[] {
  const ds = chonBinhBaiCanGoi(rows, daGui);
  for (const x of ds) daGui.set(x.u, JSON.stringify(x));
  return ds.map((x) => x.u);
}

describe("chonBinhBaiCanGoi", () => {
  it("lần đầu gọi cho mọi sản phẩm tự xếp đủ khổ", () => {
    const daGui = new Map<string, string>();
    expect(guiLuot([sp("a"), sp("b"), sp("c", { kd: 0 })], daGui)).toEqual(["a", "b"]);
  });

  it("sửa MỘT sản phẩm thì chỉ gọi lại sản phẩm đó", () => {
    const daGui = new Map<string, string>();
    guiLuot([sp("a"), sp("b")], daGui);
    expect(guiLuot([sp("a", { d: 150 }), sp("b")], daGui)).toEqual(["a"]);
    // Không đổi gì nữa thì không gọi.
    expect(guiLuot([sp("a", { d: 150 }), sp("b")], daGui)).toEqual([]);
  });

  it("tắt tự xếp rồi bật lại với đúng số cũ vẫn xếp lại", () => {
    const daGui = new Map<string, string>();
    guiLuot([sp("a")], daGui);
    expect(guiLuot([sp("a", { a: false })], daGui)).toEqual([]);
    expect(guiLuot([sp("a")], daGui)).toEqual(["a"]);
  });

  it("lần gửi hỏng (nơi gọi xoá chữ ký) thì lần sau thử lại", () => {
    const daGui = new Map<string, string>();
    guiLuot([sp("a")], daGui);
    daGui.delete("a");
    expect(guiLuot([sp("a")], daGui)).toEqual(["a"]);
  });
});
