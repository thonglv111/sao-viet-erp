import { describe, expect, it } from "vitest";
import { tenTrungLap } from "./tenTrung";

describe("tenTrungLap", () => {
  it("chỉ trả tên xuất hiện từ hai dòng trở lên", () => {
    const ds = [
      { name: "Sách A5 64 trang" },
      { name: "Tờ rơi A4" },
      { name: "Sách A5 64 trang" },
      { name: null },
    ];
    expect([...tenTrungLap(ds)]).toEqual(["Sách A5 64 trang"]);
  });

  it("không trùng thì rỗng", () => {
    expect(tenTrungLap([{ name: "A" }, { name: "B" }]).size).toBe(0);
  });
});
