/** Kỳ xem dùng chung (Thống kê khách hàng và 5 màn kế toán) — sai một ngày là số kỳ này lệch số
 *  cùng kỳ mà vẫn trông hợp lý. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { gioVN, homNayVN, kyCungKy, loiKhoang, luiNam, ngayDeDoc, ngayVN, tinhKy } from "./ky";

describe("ngày giờ Việt Nam", () => {
  afterEach(() => vi.useRealTimers());

  it("05:30 sáng 18/10 giờ VN (22:30 UTC hôm trước) vẫn là ngày 18", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T22:30:00Z"));
    expect(homNayVN()).toBe("2026-10-18");
  });
  it("ngayVN đổi mốc UTC sang ngày giờ xưởng", () => {
    expect(ngayVN("2026-10-17T23:07:00Z")).toBe("2026-10-18");
    expect(ngayVN("2026-10-17T16:59:00Z")).toBe("2026-10-17");
    expect(ngayVN("2026-10-18")).toBe("2026-10-18");
  });
  it("23h giờ UTC đã là ngày hôm sau ở Việt Nam", () => {
    expect(homNayVN(Date.UTC(2026, 9, 3, 18, 0))).toBe("2026-10-04");
    expect(homNayVN(Date.UTC(2026, 9, 3, 16, 59))).toBe("2026-10-03");
  });
  it("lùi năm từ 29/02 thành 28/02", () => {
    expect(luiNam("2028-02-29")).toBe("2027-02-28");
    expect(luiNam("2026-10-04")).toBe("2025-10-04");
  });
});

describe("kỳ xem", () => {
  const hn = "2026-10-04";
  it("các kỳ có sẵn kết thúc ở hôm nay, trừ năm trước", () => {
    expect(tinhKy("thang", hn)).toEqual({ tu: "2026-10-01", den: hn });
    expect(tinhKy("quy", hn)).toEqual({ tu: "2026-10-01", den: hn });
    expect(tinhKy("quy", "2026-08-15")).toEqual({ tu: "2026-07-01", den: "2026-08-15" });
    expect(tinhKy("nam", hn)).toEqual({ tu: "2026-01-01", den: hn });
    expect(tinhKy("12t", hn)).toEqual({ tu: "2025-10-05", den: hn });
    expect(tinhKy("namtruoc", hn)).toEqual({ tu: "2025-01-01", den: "2025-12-31" });
  });
  it("tuỳ chọn trả đúng khoảng đã gõ, chưa gõ thì từ đầu năm", () => {
    expect(tinhKy("tuy", hn, { tu: "2026-03-01", den: "2026-03-31" })).toEqual({ tu: "2026-03-01", den: "2026-03-31" });
    expect(tinhKy("tuy", hn, null)).toEqual({ tu: "2026-01-01", den: hn });
  });
  it("khoảng tự chọn phải đúng chiều và không quá 10 năm", () => {
    expect(loiKhoang("2026-03-01", "2026-03-31")).toBeNull();
    expect(loiKhoang("2026-04-01", "2026-03-31")).not.toBeNull();
    expect(loiKhoang("2010-01-01", "2026-03-31")).not.toBeNull();
    expect(loiKhoang("", "2026-03-31")).not.toBeNull();
  });
});

describe("ngày để đọc", () => {
  it("dd/mm/yyyy; mốc đầy đủ lấy ngày theo giờ Việt Nam; rỗng thành gạch", () => {
    expect(ngayDeDoc("2026-10-05")).toBe("05/10/2026");
    expect(ngayDeDoc("2026-10-04T18:30:00Z")).toBe("05/10/2026");
    expect(ngayDeDoc(null)).toBe("—");
  });
});

describe("cùng kỳ năm trước", () => {
  it("kyCungKy lùi đúng một năm, 29/02 thành 28/02", () => {
    expect(kyCungKy({ tu: "2028-02-01", den: "2028-02-29" })).toEqual({ tu: "2027-02-01", den: "2027-02-28" });
  });
});

describe("gioVN", () => {
  it("giờ tường VN của một mốc UTC, làm tròn lên đầu giờ kế tiếp", () => {
    const t = Date.UTC(2026, 9, 18, 17, 25);           // 00:25 ngày 19/10 giờ VN
    expect(gioVN(t)).toBe("2026-10-19T00:25");
    expect(gioVN(t, { troiGio: true })).toBe("2026-10-19T01:00");
    expect(gioVN(t, { troiGio: true, themGio: 4 })).toBe("2026-10-19T05:00");
  });
});
