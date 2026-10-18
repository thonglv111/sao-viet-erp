/** Thanh lọc của bàn tổ sản xuất — chế độ "Bảng" (06/10/2026). Thay "Lọc nâng cao" cũ
 *  (`ThsxLocNangCao`) và ô "chờ xác nhận" rời. Lọc + cắt trang ở máy chủ (`/work-items`).
 *
 *  09/10/2026: đủ 6 điều kiện của mockup `ban-to-ngan-A-tinh-chinh.html` — Trạng thái, Việc chờ tổ
 *  bấm (tách 3 loại), Hàng đang tới đâu, Chưa bắt đầu được vì, Trễ giờ dự kiến, Người làm. Số đếm
 *  cạnh từng giá trị do máy chủ đếm theo CÔNG VIỆC (`/work-items/loc-dem`).
 *
 *  10/10/2026: thêm điều kiện thứ 7 "Lệnh gấp" (cờ `is_rush` của lệnh / bài ghép).
 *
 *  Mốc mặc định của kỳ là `nhan` (ngày tổ nhận lệnh) — giữ hành vi của ô "Ngày tổ nhận" cũ; cách
 *  sắp không phải điều kiện lọc nên nằm riêng bên phải thanh công cụ. */
import { BellRing, CircleAlert, CircleDot, Clock, Flame, Route, Users } from "lucide-react";

import type { SxWorkItemsLocDem, ThamSoLoc } from "../../api/client";
import type { GiaTriUrl } from "../ke-toan/shared/urlMan";
import { kyLenUrl, kyTuUrl, type KyDS } from "../thanh-loc/ky-danh-sach";
import type { DieuKien, GiaTriDK } from "../thanh-loc/thanh-loc";

export const MOC_BAN_TO: [string, string][] = [
  ["nhan", "Ngày tổ nhận lệnh"],
  ["tao", "Ngày tạo lệnh"],
  ["du_kien", "Dự kiến bắt đầu"],
];
export const MOC_BAN_TO_MAC_DINH = "nhan";

export type ThsxTrangThaiLoc = "released" | "running" | "paused" | "completed";
export type ThsxSapXep = "moi_nhan" | "cu_nhan" | "du_kien";

export type ThsxChoLoai = "ban_giao" | "kcs";
export type ThsxToiLoc = "toi" | "con_1" | "con_2_3" | "con_4" | "qua";
export type ThsxVuongLoc = "chua_giao_tho" | "chua_nhan_khuon" | "chua_nhan_buoc_truoc" | "chua_san_sang_vat_tu";
export type ThsxTreLoc = "bat_dau" | "xong";
export type ThsxGapLoc = "gap" | "thuong";

export type LocBanTo = {
  trangThai: ThsxTrangThaiLoc[];
  gap?: ThsxGapLoc;
  cho: ThsxChoLoai[];
  toi?: ThsxToiLoc;
  vuong: ThsxVuongLoc[];
  tre?: ThsxTreLoc;
  nguoi: number[];
};

export const LOC_BAN_TO_TRONG: LocBanTo = { trangThai: [], cho: [], vuong: [], nguoi: [] };

/** Nút chờ của view Lịch bật = mọi loại việc chờ. */
export const CHO_MOI_LOAI: ThsxChoLoai[] = ["ban_giao", "kcs"];

const TRANG_THAI: GiaTriDK[] = [
  { value: "released", nhan: "Chờ làm" },
  { value: "running", nhan: "Đang chạy" },
  { value: "paused", nhan: "Tạm dừng" },
  { value: "completed", nhan: "Hoàn thành" },
];

const GAP: GiaTriDK[] = [
  { value: "gap", nhan: "Lệnh gấp" },
  { value: "thuong", nhan: "Lệnh thường" },
];

const CHO: GiaTriDK[] = [
  { value: "ban_giao", nhan: "Bàn giao đến chờ nhận" },
  { value: "kcs", nhan: "Lỗi KCS chưa xem" },
];

const TOI: GiaTriDK[] = [
  { value: "toi", nhan: "Đã tới tổ mình" },
  { value: "con_1", nhan: "Còn 1 bước" },
  { value: "con_2_3", nhan: "Còn 2 đến 3 bước" },
  { value: "con_4", nhan: "Còn từ 4 bước" },
  { value: "qua", nhan: "Đã qua tổ mình" },
];

const VUONG: GiaTriDK[] = [
  { value: "chua_giao_tho", nhan: "Chưa giao thợ" },
  { value: "chua_nhan_khuon", nhan: "Chưa nhận khuôn" },
  { value: "chua_nhan_buoc_truoc", nhan: "Chưa nhận hàng bước trước" },
  { value: "chua_san_sang_vat_tu", nhan: "Chưa sẵn sàng vật tư" },
];

const TRE: GiaTriDK[] = [
  { value: "bat_dau", nhan: "Quá giờ bắt đầu mà chưa chạy" },
  { value: "xong", nhan: "Quá giờ xong mà chưa xong" },
];

export const SAP_XEP_BAN_TO: [ThsxSapXep, string][] = [
  ["moi_nhan", "Mới nhận trước"],
  ["cu_nhan", "Nhận lâu nhất trước"],
  ["du_kien", "Theo giờ dự kiến"],
];

const laTrangThai = (v: string): v is ThsxTrangThaiLoc => TRANG_THAI.some((t) => t.value === v);
const laSapXep = (v: string | null): v is ThsxSapXep => SAP_XEP_BAN_TO.some(([s]) => s === v);
const trong = (ds: GiaTriDK[]) => (v: string | null | undefined): boolean => ds.some((t) => t.value === v);
const laCho = trong(CHO) as (v: string) => v is ThsxChoLoai;
const laToi = trong(TOI) as (v: string | null | undefined) => v is ThsxToiLoc;
const laVuong = trong(VUONG) as (v: string) => v is ThsxVuongLoc;
const laTre = trong(TRE) as (v: string | null | undefined) => v is ThsxTreLoc;
const laGap = trong(GAP) as (v: string | null | undefined) => v is ThsxGapLoc;
const mang = <T,>(ds: T[]) => (ds.length ? ds : undefined);

/** Tham số máy chủ của điều kiện. Mảng rỗng / không chọn thì không gửi khoá. */
export function thamSoLocBanTo(loc: LocBanTo): ThamSoLoc {
  return {
    trang_thai: mang(loc.trangThai),
    cho_loai: mang(loc.cho),
    toi: loc.toi,
    vuong: mang(loc.vuong),
    tre: loc.tre,
    nguoi: mang(loc.nguoi.map(String)),
    gap: loc.gap,
  };
}

/** Trạng thái lọc trọn màn (ghi URL `?man=thuc-hien-sx:<tổ>`). */
export type LocManBanTo = { ky: KyDS; loc: LocBanTo; sapXep: ThsxSapXep };

export const LOC_MAN_BAN_TO_TRONG: LocManBanTo = {
  ky: { loai: "tat_ca", moc: MOC_BAN_TO_MAC_DINH },
  loc: LOC_BAN_TO_TRONG,
  sapXep: "moi_nhan",
};

export function locBanToTuUrl(p: URLSearchParams): LocManBanTo {
  const sx = p.get("sap");
  return {
    ky: kyTuUrl(p, MOC_BAN_TO.map(([m]) => m), MOC_BAN_TO_MAC_DINH),
    loc: {
      trangThai: (p.get("tt") ?? "").split(".").filter(laTrangThai),
      gap: laGap(p.get("gap")) ? (p.get("gap") as ThsxGapLoc) : undefined,
      // URL cũ `cho=1` (một ô "Có việc chờ tổ bấm") = mọi loại.
      cho: p.get("cho") === "1" ? [...CHO_MOI_LOAI] : (p.get("cho") ?? "").split(".").filter(laCho),
      toi: laToi(p.get("toi")) ? (p.get("toi") as ThsxToiLoc) : undefined,
      vuong: (p.get("vg") ?? "").split(".").filter(laVuong),
      tre: laTre(p.get("tre")) ? (p.get("tre") as ThsxTreLoc) : undefined,
      nguoi: (p.get("ng") ?? "").split(".").filter((x) => /^\d+$/.test(x)).map(Number),
    },
    sapXep: laSapXep(sx) ? sx : "moi_nhan",
  };
}

export function locBanToLenUrl(t: LocManBanTo): GiaTriUrl {
  return {
    ...kyLenUrl(t.ky, MOC_BAN_TO_MAC_DINH),
    tt: t.loc.trangThai.length ? t.loc.trangThai.join(".") : undefined,
    gap: t.loc.gap,
    cho: t.loc.cho.length ? t.loc.cho.join(".") : undefined,
    toi: t.loc.toi,
    vg: t.loc.vuong.length ? t.loc.vuong.join(".") : undefined,
    tre: t.loc.tre,
    ng: t.loc.nguoi.length ? t.loc.nguoi.join(".") : undefined,
    sap: t.sapXep === "moi_nhan" ? undefined : t.sapXep,
  };
}

const kemSo = (ds: GiaTriDK[], dem?: Record<string, number>): GiaTriDK[] =>
  ds.map((g) => (dem ? { ...g, so: dem[g.value] ?? 0 } : g));

/** `dem` = số đếm máy chủ (`/work-items/loc-dem`); chưa về thì giá trị không kèm số. "Người làm"
 *  lấy giá trị từ chính `dem.nguoi` — chưa về thì chưa có ai để chọn. */
export function dieuKienBanTo(dem: SxWorkItemsLocDem | null): DieuKien<LocBanTo>[] {
  return [
    {
      // Hàng chip đếm trạng thái đã nói giá trị đang chọn ⇒ không vẽ thêm khối cạnh nút Lọc.
      khoa: "tt", nhan: "Trạng thái", icon: CircleDot, kieu: "nhieu", anKhoi: true,
      giaTri: kemSo(TRANG_THAI, dem?.trang_thai),
      doc: (l) => l.trangThai,
      ghi: (l, v) => ({ ...l, trangThai: v.filter(laTrangThai) }),
    },
    {
      khoa: "gap", nhan: "Lệnh gấp", icon: Flame, kieu: "mot",
      giaTri: kemSo(GAP, dem?.gap),
      doc: (l) => l.gap,
      ghi: (l, v) => ({ ...l, gap: laGap(v) ? v : undefined }),
    },
    {
      khoa: "cho", nhan: "Việc chờ tổ bấm", icon: BellRing, kieu: "nhieu",
      giaTri: kemSo(CHO, dem?.cho),
      doc: (l) => l.cho,
      ghi: (l, v) => ({ ...l, cho: v.filter(laCho) }),
    },
    {
      khoa: "toi", nhan: "Hàng đang tới đâu", icon: Route, kieu: "mot",
      giaTri: kemSo(TOI, dem?.toi),
      doc: (l) => l.toi,
      ghi: (l, v) => ({ ...l, toi: laToi(v) ? v : undefined }),
    },
    {
      khoa: "vg", nhan: "Chưa bắt đầu được vì", icon: CircleAlert, kieu: "nhieu",
      giaTri: kemSo(VUONG, dem?.vuong),
      doc: (l) => l.vuong,
      ghi: (l, v) => ({ ...l, vuong: v.filter(laVuong) }),
    },
    {
      khoa: "tre", nhan: "Trễ giờ dự kiến", icon: Clock, kieu: "mot",
      giaTri: kemSo(TRE, dem?.tre),
      doc: (l) => l.tre,
      ghi: (l, v) => ({ ...l, tre: laTre(v) ? v : undefined }),
    },
    {
      khoa: "ng", nhan: "Người làm", icon: Users, kieu: "nhieu", tim: true,
      giaTri: (dem?.nguoi ?? []).map((n) => ({ value: String(n.id), nhan: n.ten, so: n.so })),
      doc: (l) => l.nguoi.map(String),
      ghi: (l, v) => ({ ...l, nguoi: v.filter((x) => /^\d+$/.test(x)).map(Number) }),
    },
  ];
}
