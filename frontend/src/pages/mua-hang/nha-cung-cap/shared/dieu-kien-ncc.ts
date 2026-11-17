/** Điều kiện lọc của danh sách Nhà cung cấp (06/10/2026). Lọc ở máy chủ; thanh lọc chung lo giao diện. */
import { Layers, Star } from "lucide-react";

import type { SupplierTongQuan, ThamSoLoc } from "../../../../api/client";
import type { GiaTriUrl } from "../../../ke-toan/shared/urlMan";
import type { DieuKien, GiaTriDK } from "../../../thanh-loc/thanh-loc";

export type LocNcc = {
  trang_thai?: "active" | "inactive";
  nhom?: string;
  /** Sao trung bình tối thiểu — NCC "Chưa đánh giá" rơi ra khỏi kết quả. */
  sao?: "4" | "3";
};

export const LOC_NCC_TRONG: LocNcc = {};

const SAO: GiaTriDK[] = [
  { value: "4", nhan: "Từ 4 sao trở lên" },
  { value: "3", nhan: "Từ 3 sao trở lên" },
];

export function thamSoLocNcc(loc: LocNcc): ThamSoLoc {
  return {
    status: loc.trang_thai,
    supplier_group: loc.nhom,
    rating_min: loc.sao ? Number(loc.sao) : undefined,
  };
}

export function locNccTuUrl(p: URLSearchParams): LocNcc {
  const tt = p.get("tt");
  const sao = p.get("sao");
  return {
    trang_thai: tt === "active" || tt === "inactive" ? tt : undefined,
    nhom: p.get("nhom") || undefined,
    sao: sao === "4" || sao === "3" ? sao : undefined,
  };
}

export function locNccLenUrl(loc: LocNcc): GiaTriUrl {
  return { tt: loc.trang_thai, nhom: loc.nhom, sao: loc.sao };
}

/** Số đếm lấy từ `/api/suppliers/tong-quan` (toàn danh mục) — màn đã nạp sẵn cho thanh đếm.
 *  Trạng thái hợp tác KHÔNG có ở đây (07/10/2026): chọn ở dải lọc nhanh của thẻ lọc, vẫn ghi vào
 *  `trang_thai` của bộ lọc này (một state, lên URL `tt`). */
export function dieuKienNcc(tq: SupplierTongQuan | null): DieuKien<LocNcc>[] {
  const nhom: GiaTriDK[] = (tq?.nhom ?? [])
    .map((n) => ({ value: n.supplier_group, nhan: n.supplier_group, so: n.so_ncc }))
    .sort((a, b) => a.nhan.localeCompare(b.nhan, "vi"));
  return [
    {
      khoa: "nhom", nhan: "Nhóm nhà cung cấp", icon: Layers, kieu: "mot", tim: true, giaTri: nhom,
      doc: (l) => l.nhom,
      ghi: (l, v) => ({ ...l, nhom: v }),
    },
    {
      khoa: "sao", nhan: "Số sao", icon: Star, kieu: "mot", giaTri: SAO,
      doc: (l) => l.sao,
      ghi: (l, v) => ({ ...l, sao: v as LocNcc["sao"] }),
    },
  ];
}
