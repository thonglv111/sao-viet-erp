import { describe, expect, it } from "vitest";
import { chuCanhBaoMay } from "./xlCanhBaoMay";

// Lỗi #50/#27 bấm thử 18/10/2026: thanh lệnh im khi máy đè lịch khoá hoặc đang dừng chờ sửa.
describe("chuCanhBaoMay", () => {
  it("không có cảnh báo thì không có chữ", () => {
    expect(chuCanhBaoMay([])).toBeNull();
    expect(chuCanhBaoMay(undefined)).toBeNull();
  });
  it("một câu máy dừng thì nói máy dừng", () => {
    expect(chuCanhBaoMay(["Máy in 4 màu đang dừng chờ sửa (SC-0013)."])).toBe("máy dừng chờ sửa");
  });
  it("một câu đè lịch khoá thì nói đè lịch khoá", () => {
    expect(chuCanhBaoMay(["Máy in 4 màu có lịch bảo trì 11/09 07:00–11/09 12:00, đè lên giờ chạy."]))
      .toBe("đè lịch khoá máy");
  });
  it("nhiều câu thì đếm", () => {
    expect(chuCanhBaoMay(["a đang dừng chờ sửa (X).", "b có lịch nghỉ …"])).toBe("2 cảnh báo máy");
  });
});
