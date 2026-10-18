import { describe, expect, it } from "vitest";

import { LOC_YCK_TRONG, locYCKLenUrl, locYCKTuUrl, thamSoLocYCK } from "./dieu-kien-yeu-cau-kho";

const url = (o: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => e[1] != null));

describe("lọc yêu cầu kho theo lệnh, tổ, vật tư", () => {
  it("đọc ghi khoá URL lenh và vt", () => {
    const loc = { ...LOC_YCK_TRONG, lenh: 42, vat_tu: ["giay:12", "vat_tu:5"] };
    const ghi = locYCKLenUrl(loc);
    expect(ghi.lenh).toBe("42");
    expect(ghi.vt).toBe("giay:12,vat_tu:5");

    const doc = locYCKTuUrl(url(ghi as Record<string, string | undefined>));
    expect(doc.lenh).toBe(42);
    expect(doc.vat_tu).toEqual(["giay:12", "vat_tu:5"]);
  });

  it("khoá vt hỏng bị bỏ, URL trống thì không có điều kiện", () => {
    expect(locYCKTuUrl(url({ vt: "giay:12,rac,:3,vat_tu:x" })).vat_tu).toEqual(["giay:12"]);
    const trong = locYCKTuUrl(new URLSearchParams());
    expect(trong.lenh).toBeUndefined();
    expect(trong.vat_tu).toEqual([]);
    expect(locYCKLenUrl(LOC_YCK_TRONG).vt).toBeUndefined();
  });

  it("gửi máy chủ đúng tên tham số lenh và vat_tu", () => {
    const ts = thamSoLocYCK({ ...LOC_YCK_TRONG, bo_phan: 7, lenh: 42, vat_tu: ["giay:12"] });
    expect(ts).toMatchObject({ bo_phan: 7, lenh: 42, vat_tu: ["giay:12"] });
  });
});
