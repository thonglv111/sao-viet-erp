import { describe, expect, it } from "vitest";
import { nvlTheoLoai } from "./PhieuTinhGiaDetailView";
import type { PhieuTinhGiaGroupOut } from "../api/client";

const dong = (loai: string, ten: string, thanh_tien: number) => ({ loai, ten, thanh_tien, cong_thuc: "", cong_thuc_goc: "" });

describe("nvlTheoLoai", () => {
  it("tách dòng sóng riêng để panel giá vốn liệt kê đủ (spec chuẩn bị giấy §4)", () => {
    const groups = [{ idx: "nvl", rows: [
      dong("giay", "Hộp · Duplex 350", 2_641_275),
      dong("song", "Hộp · Sóng E", 1_509_300),
      dong("vat_tu", "Hộp · In · Màng", 10),
    ] }] as unknown as PhieuTinhGiaGroupOut[];

    const ra = nvlTheoLoai(groups);

    expect(ra.giay.map((d) => d.tien)).toEqual([2_641_275]);
    expect(ra.song.map((d) => d.tien)).toEqual([1_509_300]);
    expect(ra.vatTu.map((d) => d.tien)).toEqual([10]);
  });
});
