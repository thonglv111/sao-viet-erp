import { describe, expect, it } from "vitest";

import type { SxWorkItemsLocDem } from "../../api/client";
import {
  LOC_BAN_TO_TRONG, LOC_MAN_BAN_TO_TRONG, dieuKienBanTo, locBanToLenUrl, locBanToTuUrl, thamSoLocBanTo,
  type LocManBanTo,
} from "./dieu-kien-ban-to";

const quaUrl = (g: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(g).filter((e): e is [string, string] => e[1] != null));

const DEM: SxWorkItemsLocDem = {
  trang_thai: { released: 7, running: 2 },
  cho: { ban_giao: 1, kcs: 3 },
  toi: { toi: 4, qua: 1 },
  vuong: { chua_giao_tho: 5 },
  tre: { xong: 2 },
  nguoi: [{ id: 12, ten: "Đào Văn Hoan", so: 3 }, { id: 4, ten: "Lê Thị Mai", so: 0 }],
};

describe("thanh lọc bàn tổ", () => {
  it("mặc định không ghi khoá nào, mốc mặc định là ngày tổ nhận", () => {
    expect(Object.values(locBanToLenUrl(LOC_MAN_BAN_TO_TRONG)).filter(Boolean)).toEqual([]);
    expect(locBanToTuUrl(new URLSearchParams()).ky.moc).toBe("nhan");
    expect(thamSoLocBanTo(LOC_BAN_TO_TRONG)).toEqual({
      trang_thai: undefined, cho_loai: undefined, toi: undefined, vuong: undefined, tre: undefined, nguoi: undefined,
    });
  });

  it("đi về qua URL giữ đủ 6 điều kiện, rác thì bỏ", () => {
    const t: LocManBanTo = {
      ky: { loai: "thang", moc: "tao" },
      loc: {
        trangThai: ["running", "paused"], cho: ["ban_giao", "kcs"], toi: "con_2_3",
        vuong: ["chua_giao_tho", "chua_nhan_khuon"], tre: "xong", nguoi: [12, 4],
      },
      sapXep: "du_kien",
    };
    const url = locBanToLenUrl(t);
    expect(url).toMatchObject({ cho: "ban_giao.kcs", toi: "con_2_3", vg: "chua_giao_tho.chua_nhan_khuon", tre: "xong", ng: "12.4" });
    expect(locBanToTuUrl(quaUrl(url))).toEqual(t);
    const rac = locBanToTuUrl(new URLSearchParams("tt=chay.running&sap=la&moc=x&cho=2&toi=xa&vg=la.chua_nhan_khuon&tre=som&ng=a.7"));
    expect(rac).toEqual({
      ...LOC_MAN_BAN_TO_TRONG,
      loc: { trangThai: ["running"], cho: [], toi: undefined, vuong: ["chua_nhan_khuon"], tre: undefined, nguoi: [7] },
    });
  });

  it("URL cũ cho=1 đọc thành mọi loại việc chờ; ho_tro (gỡ mg 0389) là rác", () => {
    expect(locBanToTuUrl(new URLSearchParams("cho=1")).loc.cho).toEqual(["ban_giao", "kcs"]);
    expect(locBanToTuUrl(new URLSearchParams("cho=ho_tro.kcs")).loc.cho).toEqual(["kcs"]);
  });

  it("tham số máy chủ: mảng lặp, một giá trị đi thẳng, người gửi chuỗi số", () => {
    expect(thamSoLocBanTo({
      trangThai: ["released"], cho: ["kcs"], toi: "toi", vuong: ["chua_nhan_khuon"], tre: "bat_dau", nguoi: [12],
    })).toEqual({
      trang_thai: ["released"], cho_loai: ["kcs"], toi: "toi", vuong: ["chua_nhan_khuon"], tre: "bat_dau", nguoi: ["12"],
    });
  });

  it("số đếm máy chủ gắn đúng giá trị; Trạng thái không vẽ khối cạnh nút Lọc", () => {
    const dk = dieuKienBanTo(DEM);
    expect(dk.map((d) => d.nhan)).toEqual([
      "Trạng thái", "Lệnh gấp", "Việc chờ tổ bấm", "Hàng đang tới đâu", "Chưa bắt đầu được vì", "Trễ giờ dự kiến",
      "Người làm",
    ]);
    const so = (khoa: string, v: string) => {
      const d = dk.find((x) => x.khoa === khoa);
      return d && d.kieu !== "khoang" ? d.giaTri.find((g) => g.value === v)?.so : undefined;
    };
    expect(so("tt", "released")).toBe(7);
    expect(so("tt", "completed")).toBe(0);
    expect(so("cho", "kcs")).toBe(3);
    expect(so("toi", "toi")).toBe(4);
    expect(so("vg", "chua_giao_tho")).toBe(5);
    expect(so("tre", "xong")).toBe(2);
    expect(so("ng", "12")).toBe(3);
    expect(dk.find((d) => d.khoa === "tt")?.anKhoi).toBe(true);
    expect(dk.find((d) => d.khoa === "ng")?.tim).toBe(true);
  });

  it("Lệnh gấp: một giá trị, đi về qua URL, gửi máy chủ khoá gap, số đếm từ dem.gap", () => {
    const t: LocManBanTo = { ...LOC_MAN_BAN_TO_TRONG, loc: { ...LOC_BAN_TO_TRONG, gap: "gap" } };
    const url = locBanToLenUrl(t);
    expect(url.gap).toBe("gap");
    expect(locBanToTuUrl(quaUrl(url)).loc.gap).toBe("gap");
    expect(locBanToTuUrl(new URLSearchParams("gap=rac")).loc.gap).toBeUndefined();
    expect(thamSoLocBanTo({ ...LOC_BAN_TO_TRONG, gap: "thuong" }).gap).toBe("thuong");
    const gap = dieuKienBanTo({ ...DEM, gap: { gap: 2, thuong: 9 } }).find((d) => d.khoa === "gap");
    expect(gap?.kieu).toBe("mot");
    expect(gap && gap.kieu !== "khoang" && gap.giaTri.map((g) => [g.nhan, g.so])).toEqual([
      ["Lệnh gấp", 2], ["Lệnh thường", 9],
    ]);
  });

  it("chưa có số đếm thì giá trị không kèm số, Người làm chưa có ai", () => {
    const dk = dieuKienBanTo(null);
    const vg = dk.find((d) => d.khoa === "vg");
    expect(vg && vg.kieu !== "khoang" && vg.giaTri.every((g) => g.so == null)).toBe(true);
    const ng = dk.find((d) => d.khoa === "ng");
    expect(ng && ng.kieu !== "khoang" && ng.giaTri).toEqual([]);
  });
});
