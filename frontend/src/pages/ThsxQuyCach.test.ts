// Thẻ quy cách ở bàn tổ — lệnh nhiều giấy (hộp bồi couche lên sóng, 19/10/2026).
import { describe, expect, it } from "vitest";
import { dongQuyCach } from "./ThsxQuyCach";

describe("dongQuyCach", () => {
  it("lệnh hai giấy: ô Giấy kể cả hai, mỗi giấy một dòng", () => {
    const dong = dongQuyCach({ giay: ["COUCHE 150GSM", "GIẤY SÓNG E 300GSM"], kho_in: "790 × 545" });
    expect(dong.find(([k]) => k === "giay")?.[2]).toBe("COUCHE 150GSM\nGIẤY SÓNG E 300GSM");
  });

  it("lệnh một giấy giữ nguyên chữ", () => {
    const dong = dongQuyCach({ giay: "COUCHE 150GSM", dinh_luong: 150, kho_in: "790 × 545" });
    expect(dong.find(([k]) => k === "giay")?.[2]).toBe("COUCHE 150GSM");
  });
});
