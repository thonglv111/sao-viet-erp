import { describe, expect, it } from "vitest";
import { hanTraDot, mocChotThang, moTaHanTra } from "./hanTra";

describe("moTaHanTra", () => {
  it("cho nợ 0 ngày, không ngày chốt: trả ngay khi có hoá đơn", () => {
    expect(moTaHanTra(0, null)).toEqual({ chinh: "Trả ngay khi có hoá đơn" });
  });

  it("cho nợ N ngày, không ngày chốt: mỗi đợt tính từ ngày hoá đơn", () => {
    expect(moTaHanTra(30, null)).toEqual({ chinh: "30 ngày sau ngày hoá đơn", phu: "mỗi đợt giao một hạn" });
  });

  it("chốt hằng tháng: câu là luật của cả đơn, không phải một ngày", () => {
    expect(moTaHanTra(30, 31).chinh).toBe("30 ngày sau chốt cuối tháng");
    expect(moTaHanTra(15, 25).chinh).toBe("15 ngày sau chốt ngày 25");
    expect(moTaHanTra(0, 25).chinh).toBe("Trả khi chốt ngày 25");
  });

  it("NCC chưa khai số ngày cho nợ: chưa rõ, dù có ngày chốt", () => {
    expect(moTaHanTra(null, 31).chuaRo).toBe(true);
  });
});

describe("hanTraDot", () => {
  it("chốt hằng tháng: hoá đơn vào kỳ chốt gần nhất, sau mốc thì sang kỳ sau", () => {
    expect(hanTraDot(30, 31, "2026-10-21", "2026-10-20").ngay).toBe("30/11/2026");
    expect(hanTraDot(30, 30, "2026-10-31", "2026-10-31").ngay).toBe("30/12/2026");
  });

  it("chốt hằng tháng, chưa có hoá đơn: lấy kỳ theo ngày nhận hàng", () => {
    expect(hanTraDot(30, 30, null, "2026-10-15").ngay).toBe("29/11/2026");
  });

  it("mốc chốt: tháng ngắn rơi về ngày cuối, tháng 12 sang năm sau", () => {
    expect(mocChotThang("2026-02-03", 31)).toBe("2026-02-28");
    expect(mocChotThang("2026-10-30", 30)).toBe("2026-10-30");
    expect(mocChotThang("2026-12-31", 30)).toBe("2027-01-30");
  });

  it("không ngày chốt: ngày hoá đơn cộng số ngày", () => {
    const h = hanTraDot(30, null, "2026-10-21", "2026-10-20");
    expect(h.ngay).toBe("20/11/2026");
    expect(h.giai).toBe("Ngày hoá đơn 21/10/2026 cộng 30 ngày cho nợ.");
  });

  it("chưa có hoá đơn: tạm tính từ ngày nhận hàng", () => {
    expect(hanTraDot(30, null, null, "2026-10-20").ngay).toBe("19/11/2026");
  });

  it("NCC chưa khai số ngày: không có hạn", () => {
    expect(hanTraDot(null, 31, "2026-10-21", "2026-10-20").ngay).toBeNull();
  });
});
