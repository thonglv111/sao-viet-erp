/** Điều kiện lọc của danh sách Đơn hàng bán (06/10/2026). Lọc và đếm ở máy chủ; thanh lọc chung lo giao diện.
 *  07/10/2026: thêm Đang chờ / Gia công ngoài / Nhà gia công / Giao hàng / Hoá đơn; bỏ "Sản xuất đã/chưa
 *  chuyển" (nay là Đang chờ = Đủ cọc). */
import { useEffect, useState } from "react";
import {
  Banknote, CalendarClock, Factory, FileText, Hourglass, Receipt, Truck, Users, Warehouse, Zap,
} from "lucide-react";

import { api, type DangCho, type ThamSoLoc } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import type { GiaTriUrl } from "../ke-toan/shared/urlMan";
import { soLenUrl, soTuUrl } from "../thanh-loc/ky-danh-sach";
import { chuThanhId, idThanhChu, useLuaChonLoc } from "../thanh-loc/lua-chon";
import type { DieuKien, GiaTriDK } from "../thanh-loc/thanh-loc";

export type LocDonHang = {
  khach?: number;
  loai?: "moi" | "bo_sung";
  gap?: boolean;
  gia_tu?: number;
  gia_den?: number;
  /** `qua` = ngày giao hẹn đã qua mà chưa giao đủ, `sap` = hẹn giao trong 7 ngày tới. */
  hen_giao?: "qua" | "sap";
  /** Đơn đã chốt đang chờ ai — máy chủ suy từ lệnh / gia công / kho / giao / hoá đơn. */
  dang_cho?: DangCho;
  gia_cong?: "co" | "tron_goi" | "mot_phan" | "giao_thang" | "khong";
  nha_gia_cong?: number;
  giao?: MucDo;
  hoa_don?: MucDo;
};
type MucDo = "chua" | "mot_phan" | "du";

export const LOC_DH_TRONG: LocDonHang = {};

const LOAI: GiaTriDK[] = [
  { value: "moi", nhan: "Đơn mới" },
  { value: "bo_sung", nhan: "Đơn bổ sung" },
];
const GAP: GiaTriDK[] = [
  { value: "co", nhan: "Chỉ đơn gấp" },
  { value: "khong", nhan: "Không gấp" },
];
const DANG_CHO: { value: DangCho; nhan: string }[] = [
  { value: "coc", nhan: "Đủ cọc" },
  { value: "ke_hoach", nhan: "Kế hoạch lên lệnh" },
  { value: "xuong", nhan: "Xưởng" },
  { value: "gia_cong", nhan: "Nhà gia công" },
  { value: "kho", nhan: "KCS và kho nhận hàng" },
  { value: "giao", nhan: "Giao hàng" },
  { value: "hoa_don", nhan: "Hoá đơn" },
  { value: "xong", nhan: "Không chờ gì, đã xong" },
  { value: "tra_coc", nhan: "Chờ trả lại tiền khách" },
];
const GIA_CONG: GiaTriDK[] = [
  { value: "co", nhan: "Có gia công ngoài" },
  { value: "tron_goi", nhan: "Gia công trọn gói" },
  { value: "mot_phan", nhan: "Gia công một phần" },
  { value: "giao_thang", nhan: "Nhà gia công giao thẳng" },
  { value: "khong", nhan: "Không gia công ngoài" },
];
const MUC_GIAO: GiaTriDK[] = [
  { value: "chua", nhan: "Chưa giao" },
  { value: "mot_phan", nhan: "Giao một phần" },
  { value: "du", nhan: "Đã giao đủ" },
];
const MUC_HOA_DON: GiaTriDK[] = [
  { value: "chua", nhan: "Chưa xuất" },
  { value: "mot_phan", nhan: "Xuất một phần" },
  { value: "du", nhan: "Đã xuất đủ" },
];
const HEN_GIAO: GiaTriDK[] = [
  { value: "qua", nhan: "Đã qua ngày hẹn mà chưa giao đủ" },
  { value: "sap", nhan: "Trong 7 ngày tới" },
];

export function thamSoLocDH(loc: LocDonHang): ThamSoLoc {
  return {
    khach: loc.khach,
    order_kind: loc.loai,
    gap: loc.gap,
    gia_tu: loc.gia_tu,
    gia_den: loc.gia_den,
    hen_giao: loc.hen_giao,
    dang_cho: loc.dang_cho,
    gia_cong: loc.gia_cong,
    nha_gia_cong: loc.nha_gia_cong,
    giao: loc.giao,
    hoa_don: loc.hoa_don,
  };
}

const mot = <T extends string>(v: string | null, ds: { value: string }[]) =>
  (v != null && ds.some((d) => d.value === v) ? (v as T) : undefined);

export function locDHTuUrl(p: URLSearchParams): LocDonHang {
  const loai = p.get("loai");
  const gap = p.get("gap");
  const hg = p.get("hg");
  return {
    khach: soTuUrl(p.get("khach")),
    loai: loai === "moi" || loai === "bo_sung" ? loai : undefined,
    gap: gap === "1" ? true : gap === "0" ? false : undefined,
    gia_tu: soTuUrl(p.get("gia_tu")),
    gia_den: soTuUrl(p.get("gia_den")),
    hen_giao: hg === "qua" || hg === "sap" ? hg : undefined,
    dang_cho: mot<DangCho>(p.get("cho"), DANG_CHO),
    gia_cong: mot<NonNullable<LocDonHang["gia_cong"]>>(p.get("gc"), GIA_CONG),
    nha_gia_cong: soTuUrl(p.get("ngc")),
    giao: mot<MucDo>(p.get("giao"), MUC_GIAO),
    hoa_don: mot<MucDo>(p.get("hd"), MUC_HOA_DON),
  };
}

export function locDHLenUrl(loc: LocDonHang): GiaTriUrl {
  return {
    khach: soLenUrl(loc.khach),
    loai: loc.loai,
    gap: loc.gap == null ? undefined : loc.gap ? "1" : "0",
    gia_tu: soLenUrl(loc.gia_tu),
    gia_den: soLenUrl(loc.gia_den),
    hg: loc.hen_giao,
    cho: loc.dang_cho,
    gc: loc.gia_cong,
    ngc: soLenUrl(loc.nha_gia_cong),
    giao: loc.giao,
    hd: loc.hoa_don,
  };
}

/** Giá trị ô "Đang chờ" kèm số đơn của từng giá trị (đếm ở máy chủ, trong tầm nhìn). */
function useDangCho(): GiaTriDK[] {
  const { token } = useAuth();
  const [dem, setDem] = useState<Partial<Record<DangCho, number>>>({});
  useEffect(() => {
    if (!token) return;
    api.orders.dangChoDem(token).then(setDem).catch(() => setDem({}));
  }, [token]);
  return DANG_CHO.map((d) => ({ ...d, so: dem[d.value] }));
}

export function useDieuKienDonHang(): DieuKien<LocDonHang>[] {
  const khach = useLuaChonLoc(api.orders.khachLoc);
  const nhaGiaCong = useLuaChonLoc(api.orders.nhaGiaCongLoc);
  const dangCho = useDangCho();
  return [
    {
      khoa: "khach", nhan: "Khách hàng", icon: Users, kieu: "mot", tim: true, giaTri: khach,
      doc: (l) => idThanhChu(l.khach),
      ghi: (l, v) => ({ ...l, khach: chuThanhId(v) }),
    },
    {
      khoa: "dang_cho", nhan: "Đang chờ", icon: Hourglass, kieu: "mot", giaTri: dangCho,
      doc: (l) => l.dang_cho,
      ghi: (l, v) => ({ ...l, dang_cho: v as LocDonHang["dang_cho"] }),
    },
    {
      khoa: "gia_cong", nhan: "Gia công ngoài", icon: Factory, kieu: "mot", giaTri: GIA_CONG,
      doc: (l) => l.gia_cong,
      ghi: (l, v) => ({ ...l, gia_cong: v as LocDonHang["gia_cong"] }),
    },
    {
      khoa: "nha_gia_cong", nhan: "Nhà gia công", icon: Warehouse, kieu: "mot", tim: true, giaTri: nhaGiaCong,
      doc: (l) => idThanhChu(l.nha_gia_cong),
      ghi: (l, v) => ({ ...l, nha_gia_cong: chuThanhId(v) }),
    },
    {
      khoa: "giao", nhan: "Giao hàng", icon: Truck, kieu: "mot", giaTri: MUC_GIAO,
      doc: (l) => l.giao,
      ghi: (l, v) => ({ ...l, giao: v as MucDo | undefined }),
    },
    {
      khoa: "hoa_don", nhan: "Hoá đơn", icon: Receipt, kieu: "mot", giaTri: MUC_HOA_DON,
      doc: (l) => l.hoa_don,
      ghi: (l, v) => ({ ...l, hoa_don: v as MucDo | undefined }),
    },
    {
      khoa: "hen_giao", nhan: "Hẹn giao", icon: CalendarClock, kieu: "mot", giaTri: HEN_GIAO,
      doc: (l) => l.hen_giao,
      ghi: (l, v) => ({ ...l, hen_giao: v as LocDonHang["hen_giao"] }),
    },
    {
      khoa: "loai", nhan: "Loại đơn", icon: FileText, kieu: "mot", giaTri: LOAI,
      doc: (l) => l.loai,
      ghi: (l, v) => ({ ...l, loai: v as LocDonHang["loai"] }),
    },
    {
      khoa: "gap", nhan: "Gấp", icon: Zap, kieu: "mot", giaTri: GAP,
      doc: (l) => (l.gap == null ? undefined : l.gap ? "co" : "khong"),
      ghi: (l, v) => ({ ...l, gap: v == null ? undefined : v === "co" }),
    },
    {
      khoa: "gia", nhan: "Giá trị gồm VAT", icon: Banknote, kieu: "khoang", donVi: "đ",
      doc: (l) => [l.gia_tu, l.gia_den],
      ghi: (l, tu, den) => ({ ...l, gia_tu: tu, gia_den: den }),
    },
  ];
}
