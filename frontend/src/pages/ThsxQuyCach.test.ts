// Thẻ quy cách ở bàn tổ — hộp bồi couche lên sóng: ô Giấy và ô Sóng tách theo loại mã (mg 0426).
import { describe, expect, it } from "vitest";
import { dongQuyCach } from "./ThsxQuyCach";

describe("dongQuyCach", () => {
  it("giấy + sóng: Giấy, Định lượng rồi Sóng, mỗi thứ một ô", () => {
    const dong = dongQuyCach({ giay: "COUCHE 150GSM", dinh_luong: 150, song: "GIẤY SÓNG E 300GSM",
                               kho_in: "790 × 545" });
    expect(dong.slice(0, 3)).toEqual([
      ["giay", "Giấy", "COUCHE 150GSM"],
      ["dinh_luong", "Định lượng", "150 gsm"],
      ["song", "Sóng", "GIẤY SÓNG E 300GSM"],
    ]);
  });

  it("không sóng thì không có dòng Sóng", () => {
    const dong = dongQuyCach({ giay: "COUCHE 150GSM", dinh_luong: 150, kho_in: "790 × 545" });
    expect(dong.find(([k]) => k === "giay")?.[2]).toBe("COUCHE 150GSM");
    expect(dong.some(([k]) => k === "song")).toBe(false);
  });

  it("lệnh cũ nhiều giấy (ảnh chụp dạng mảng): ô Giấy kể cả hai, mỗi giấy một dòng", () => {
    const dong = dongQuyCach({ giay: ["COUCHE 150GSM", "GIẤY SÓNG E 300GSM"], kho_in: "790 × 545" });
    expect(dong.find(([k]) => k === "giay")?.[2]).toBe("COUCHE 150GSM\nGIẤY SÓNG E 300GSM");
  });
});
