import { describe, expect, it } from "vitest";

import type { SxWorkItem } from "../api/client";
import { conPhaiLam, tienDoThucTe } from "./thsxShared";

const w = (o: Partial<SxWorkItem>) =>
  ({ trang_thai: "running", da_lam: 0, so_luong_ra: null, muc_tieu: null, nhan_ra: null, ...o }) as SxWorkItem;

describe("tiến độ ngăn việc theo số cần ra (#28)", () => {
  it("ghi đủ 1.250 cần ra thì 100%, giấy nhận 1.400 (có bù hao) không làm mốc", () => {
    const v = w({ da_lam: 1250, muc_tieu: 1250, so_luong_ra: 1250, nhan_ra: 1400 });
    expect(tienDoThucTe(v)).toEqual({ pct: 100, tot: 1250, nhan: 1250 });
    expect(conPhaiLam(v)).toBe(0);
  });

  it("chưa có mục tiêu thì mới lùi về số nhận quy ra", () => {
    const v = w({ da_lam: 700, nhan_ra: 1400 });
    expect(tienDoThucTe(v)?.pct).toBe(50);
    expect(conPhaiLam(v)).toBe(700);
  });
});
