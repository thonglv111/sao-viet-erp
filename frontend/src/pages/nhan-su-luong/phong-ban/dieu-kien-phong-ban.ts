/** Điều kiện lọc cây Phòng ban (06/10/2026): Khối, Tình trạng nhân sự. Máy chủ lọc và trả phòng
 *  khớp kèm tổ tiên (`khop=false`) để màn vẽ được cây và sơ đồ có đường nối từ gốc xuống. */
import { Layers, UserCheck } from "lucide-react";

import type { ThamSoLoc } from "../../../api/client";
import type { GiaTriUrl } from "../../ke-toan/shared/urlMan";
import type { DieuKien, GiaTriDK } from "../../thanh-loc/thanh-loc";

export type LocPhongBan = {
  /** Tập con `san_xuat` / `ngoai_sx` / `kinh_doanh` / `giao_hang` — khớp một là đủ. */
  khoi: string[];
  /** Tập con `co_truong` / `thieu_truong` / `chua_co_nguoi`. */
  tinh_trang: string[];
};

export const LOC_PB_TRONG: LocPhongBan = { khoi: [], tinh_trang: [] };

export const MOC_PB: [string, string][] = [["tao", "Ngày tạo"]];

/** Số phòng theo từng giá trị — tính trên trọn cây máy chủ trả (cùng luật kế thừa khối). */
export type DemPhongBan = Record<string, number>;

const KHOI: [string, string][] = [
  ["san_xuat", "Sản xuất"],
  ["ngoai_sx", "Ngoài sản xuất"],
  ["kinh_doanh", "Kinh doanh"],
  ["giao_hang", "Giao hàng"],
];
const TINH_TRANG: [string, string][] = [
  ["co_truong", "Có trưởng phòng"],
  ["thieu_truong", "Thiếu trưởng phòng"],
  ["chua_co_nguoi", "Chưa có người"],
];

const hop = (ds: [string, string][]) => (v: string) => ds.some(([k]) => k === v);
const docDs = (p: URLSearchParams, khoa: string, ds: [string, string][]) =>
  (p.get(khoa) ?? "").split(",").filter(hop(ds));

export function thamSoLocPhongBan(loc: LocPhongBan): ThamSoLoc {
  // Mảng rỗng ⇒ bỏ khoá: khoá lọc rỗng "{}" là dấu hiệu "không lọc gì" của màn.
  return {
    khoi: loc.khoi.length ? loc.khoi : undefined,
    tinh_trang: loc.tinh_trang.length ? loc.tinh_trang : undefined,
  };
}

export function locPhongBanTuUrl(p: URLSearchParams): LocPhongBan {
  return { khoi: docDs(p, "khoi", KHOI), tinh_trang: docDs(p, "tt", TINH_TRANG) };
}

export function locPhongBanLenUrl(loc: LocPhongBan): GiaTriUrl {
  return {
    khoi: loc.khoi.length ? loc.khoi.join(",") : undefined,
    tt: loc.tinh_trang.length ? loc.tinh_trang.join(",") : undefined,
  };
}

/** `anGiaoHang`: bản cài tắt giao hàng thì bỏ lựa chọn Khối "Giao hàng" (04/11/2026). */
export function dieuKienPhongBan(dem: DemPhongBan, anGiaoHang = false): DieuKien<LocPhongBan>[] {
  const giaTri = (ds: [string, string][]): GiaTriDK[] =>
    ds.map(([value, nhan]) => ({ value, nhan, so: dem[value] }));
  return [
    {
      khoa: "khoi", nhan: "Khối", icon: Layers, kieu: "nhieu", giaTri: giaTri(anGiaoHang ? KHOI.filter(([k]) => k !== "giao_hang") : KHOI),
      doc: (l) => l.khoi,
      ghi: (l, v) => ({ ...l, khoi: v }),
    },
    {
      khoa: "tinh_trang", nhan: "Tình trạng nhân sự", icon: UserCheck, kieu: "nhieu",
      giaTri: giaTri(TINH_TRANG),
      doc: (l) => l.tinh_trang,
      ghi: (l, v) => ({ ...l, tinh_trang: v }),
    },
  ];
}
