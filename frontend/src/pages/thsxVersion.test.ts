import { describe, expect, it } from "vitest";

import { verMoiNhat, verTuKetQua } from "./thsxVersion";

describe("verMoiNhat (#43 rút hai người liên tiếp)", () => {
  it("chi tiết chưa nạp về sau lần rút đầu thì dùng version trong phản hồi", () => {
    const tam = verTuKetQua({ cong_viec_id: 9, department_id: 1, trang_thai: "dang_lam", version: 8 });
    expect(verMoiNhat({ id: 9, version: 7 }, tam)).toBe(8);
  });

  it("chi tiết đã về bản mới hơn thì theo chi tiết", () => {
    expect(verMoiNhat({ id: 9, version: 10 }, { id: 9, version: 8 })).toBe(10);
  });

  it("phản hồi của việc khác không đè việc đang mở", () => {
    expect(verMoiNhat({ id: 9, version: 7 }, { id: 4, version: 99 })).toBe(7);
  });

  it("phản hồi không mang version thì bỏ qua", () => {
    expect(verTuKetQua({ ok: true })).toBeNull();
  });
});
