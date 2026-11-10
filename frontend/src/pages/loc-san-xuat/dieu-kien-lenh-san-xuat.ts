/** Thanh lọc của màn Hồ sơ lệnh sản xuất (06/10/2026). Lọc + đếm tab ở máy chủ. */
import { Factory, FileText, UserRound, Users } from "lucide-react";

import { api, type ThamSoLoc } from "../../api/client";
import type { GiaTriUrl } from "../ke-toan/shared/urlMan";
import { soLenUrl, soTuUrl } from "../thanh-loc/ky-danh-sach";
import { chuThanhId, idThanhChu, useLuaChonLoc } from "../thanh-loc/lua-chon";
import type { DieuKien, GiaTriDK } from "../thanh-loc/thanh-loc";

export const MOC_HO_SO_LENH: [string, string][] = [
  ["tao", "Ngày tạo"],
  ["han_giao", "Hạn giao khách"],
];

export type LocHoSoLenh = {
  khach?: number;
  phu_trach?: number;
  don?: number;
  gia_cong?: "cho_mang_di" | "dang_o_ngoai" | "tron_goi";
};

export const LOC_HO_SO_LENH_TRONG: LocHoSoLenh = {};

const GIA_CONG: GiaTriDK[] = [
  { value: "cho_mang_di", nhan: "Chờ mang đi" },
  { value: "dang_o_ngoai", nhan: "Đang ở nhà gia công" },
  { value: "tron_goi", nhan: "Đang gia công trọn gói" },
];

const giaCong = (v: string | null | undefined): LocHoSoLenh["gia_cong"] =>
  GIA_CONG.some((g) => g.value === v) ? (v as LocHoSoLenh["gia_cong"]) : undefined;

export function thamSoLocHoSoLenh(loc: LocHoSoLenh): ThamSoLoc {
  return { khach_hang_id: loc.khach, phu_trach_id: loc.phu_trach, order_id: loc.don, gia_cong: loc.gia_cong };
}

export function locHoSoLenhTuUrl(p: URLSearchParams): LocHoSoLenh {
  return {
    khach: soTuUrl(p.get("khach")),
    phu_trach: soTuUrl(p.get("pt")),
    don: soTuUrl(p.get("don")),
    gia_cong: giaCong(p.get("gc")),
  };
}

export function locHoSoLenhLenUrl(loc: LocHoSoLenh): GiaTriUrl {
  return { khach: soLenUrl(loc.khach), pt: soLenUrl(loc.phu_trach), don: soLenUrl(loc.don), gc: loc.gia_cong };
}

export function useDieuKienHoSoLenh(): DieuKien<LocHoSoLenh>[] {
  const khach = useLuaChonLoc(api.lenhSanXuat.khachLoc);
  const phuTrach = useLuaChonLoc(api.lenhSanXuat.phuTrachLoc);
  const don = useLuaChonLoc(api.lenhSanXuat.donLoc);
  return [
    {
      khoa: "khach", nhan: "Khách hàng", icon: Users, kieu: "mot", tim: true, giaTri: khach,
      doc: (l) => idThanhChu(l.khach),
      ghi: (l, v) => ({ ...l, khach: chuThanhId(v) }),
    },
    {
      khoa: "phu_trach", nhan: "Phụ trách", icon: UserRound, kieu: "mot", tim: true, giaTri: phuTrach,
      doc: (l) => idThanhChu(l.phu_trach),
      ghi: (l, v) => ({ ...l, phu_trach: chuThanhId(v) }),
    },
    {
      khoa: "don", nhan: "Đơn hàng", icon: FileText, kieu: "mot", tim: true, giaTri: don,
      doc: (l) => idThanhChu(l.don),
      ghi: (l, v) => ({ ...l, don: chuThanhId(v) }),
    },
    {
      khoa: "gia_cong", nhan: "Gia công ngoài", icon: Factory, kieu: "mot", giaTri: GIA_CONG,
      doc: (l) => l.gia_cong,
      ghi: (l, v) => ({ ...l, gia_cong: giaCong(v) }),
    },
  ];
}
