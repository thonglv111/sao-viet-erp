import { describe, expect, it } from "vitest";

import { cauBaoPhatHanh } from "./cauBaoPhatHanh";

describe("cauBaoPhatHanh", () => {
  it("nói số yêu cầu xuất đã gửi kho", () => {
    expect(cauBaoPhatHanh(1, { so_yeu_cau: 3, bo_qua: [] })).toEqual({
      chu: "Đã phát hành xuống xưởng. Đã gửi kho 3 yêu cầu xuất.",
    });
  });

  it("không có yêu cầu nào thì chỉ nói đã phát hành", () => {
    expect(cauBaoPhatHanh(2, { so_yeu_cau: 0, bo_qua: [] }).chu).toBe("Đã phát hành 2 lệnh xuống xưởng.");
  });

  it("món chưa tự lập được: câu nói số món, rê chuột thấy món nào và vì sao", () => {
    const r = cauBaoPhatHanh(1, {
      so_yeu_cau: 1,
      bo_qua: [{ cong_viec_id: 9, ten_cong_doan: "In", ten_hang: "Keo dán", ly_do: "chưa có đơn vị tính" }],
    });
    expect(r.chu).toBe("Đã phát hành xuống xưởng. Đã gửi kho 1 yêu cầu xuất. 1 món chưa tự lập được, tổ xin tay.");
    expect(r.giai).toBe("In: Keo dán — chưa có đơn vị tính");
  });
});
