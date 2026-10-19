/** Bộ lọc màn CÔNG NỢ (phải trả, phải thu — đặc tả NPT-1, NPTh-1, A.17, A.18): nhóm nút, mốc tuổi
 *  nợ, ô tìm và các điều kiện trên thanh lọc chung `ThanhLoc` → tham số máy chủ và khoá URL.
 *
 *  Hàm thuần, không React. Mọi lọc chạy ở MÁY CHỦ (`LocCongNo` của `api.accounting.payables` /
 *  `receivables`); số tổng đầu màn không đổi theo lọc — máy chủ tính trên toàn bộ.
 */
import { Banknote, CalendarClock, CheckCheck, FileExclamationPoint, Gauge, Hourglass, Tag, UserRound } from "lucide-react";

import type { AgingBucket, CotSapXepCongNo, KyXem, LocCongNo, SaleOption } from "../../../api/client";
import type { DieuKien, GiaTriDK } from "../../thanh-loc/thanh-loc";
import { soDuong } from "./locPhieu";
import type { GiaTriUrl } from "./urlMan";

export type HanTra = NonNullable<LocCongNo["han_tra"]>;
export type HanMuc = NonNullable<LocCongNo["han_muc"]>;

/** Bộ lọc nâng cao ĐÃ ÁP (bản nháp trong bảng lọc cùng kiểu). */
export type LocNangCaoCongNo = {
  no_tu?: number;
  no_den?: number;
  han_tra?: HanTra;
  han_muc?: HanMuc;
  /** Kỳ đang chọn mà nhà cung cấp / khách đã về 0 thì máy chủ ẩn — bật ô này để hiện cả họ. */
  ca_da_tra_het?: boolean;
  /** Chỉ màn phải trả: có đợt giao còn nợ chưa ghi số hoá đơn. */
  thieu_hoa_don?: boolean;
  /** Chỉ màn phải thu: sale phụ trách khách. */
  phu_trach_id?: number;
  /** Chỉ màn phải thu: nhãn khách. */
  nhan?: string;
};

export const LOC_CONG_NO_TRONG: LocNangCaoCongNo = {};

/** Nhóm nút đầu thanh lọc ("Tất cả | Quá hạn | Vượt hạn mức") — giá trị là `filter` của máy chủ. */
export type TheCongNo = "all" | "overdue" | "vuot_han_muc" | "tra_coc";
export const THE_CONG_NO: [TheCongNo, string][] = [
  ["all", "Tất cả"],
  ["overdue", "Quá hạn"],
  ["vuot_han_muc", "Vượt hạn mức"],
];
/** Nút riêng của phải thu (13/10/2026): khách còn tiền ở đơn đã huỷ (cọc + tiền hoá đơn đã huỷ), chờ lập
 *  phiếu chi trả lại. */
export const THE_TRA_COC: [TheCongNo, string] = ["tra_coc", "Chờ trả lại tiền khách"];

const HAN_TRA: GiaTriDK[] = [
  { value: "qua_han", nhan: "Đã quá hạn" },
  { value: "7_ngay", nhan: "Tới hạn trong 7 ngày" },
  { value: "30_ngay", nhan: "Tới hạn trong 30 ngày" },
];
const HAN_MUC: GiaTriDK[] = [
  { value: "tren_80", nhan: "Dùng trên 80%" },
  { value: "vuot", nhan: "Đã vượt" },
  { value: "chua_dat", nhan: "Chưa đặt" },
];

/** Nhãn mốc tuổi nợ của máy chủ ("Trễ > 60 ngày") viết thành chữ ("Trễ trên 60 ngày"). Số ngày vẫn
 *  lấy từ máy chủ — giao diện không gõ lại mốc. */
export function nhanMoc(nhan: string): string {
  return nhan.replace(/>\s*/, "trên ");
}

export function soDieuKienCongNo(loc: LocNangCaoCongNo): number {
  let n = 0;
  if (loc.no_tu != null || loc.no_den != null) n++;
  if (loc.han_tra) n++;
  if (loc.han_muc) n++;
  if (loc.ca_da_tra_het) n++;
  if (loc.thieu_hoa_don) n++;
  if (loc.phu_trach_id != null) n++;
  if (loc.nhan?.trim()) n++;
  return n;
}

/* ---------- Điều kiện trên thanh lọc chung ---------- */

/** Thứ thanh lọc đọc / ghi: mốc tuổi nợ (bấm được cả trên thanh tuổi nợ của khối tổng quan) và các
 *  điều kiện còn lại. */
export type LocThanhCongNo = { tuoi: string | null; loc: LocNangCaoCongNo };

export type CauHinhDieuKienCongNo = {
  /** "Hạn trả" / "Hạn thu". */
  nhanHan: string;
  /** Nhãn điều kiện "đã về 0": "Nhà cung cấp đã trả hết" / "Khách đã thu hết". */
  nhanHet: string;
  /** Có thì thêm điều kiện "Hoá đơn" (chỉ màn phải trả). */
  coThieuHd?: boolean;
};

/** Điều kiện lọc của màn công nợ. `aging` = các mốc tuổi nợ máy chủ trả (kèm số khoản); `nguoi` /
 *  `nhanKhach` chỉ màn phải thu (null = chưa tải / không có quyền ⇒ không có điều kiện đó). */
export function dieuKienCongNo(
  ch: CauHinhDieuKienCongNo,
  aging: AgingBucket[],
  nguoi: SaleOption[] | null = null,
  nhanKhach: string[] | null = null,
): DieuKien<LocThanhCongNo>[] {
  const doi = (l: LocThanhCongNo, moi: Partial<LocNangCaoCongNo>): LocThanhCongNo => ({ ...l, loc: { ...l.loc, ...moi } });
  const ds: DieuKien<LocThanhCongNo>[] = [
    {
      khoa: "tuoi", nhan: "Tuổi nợ", icon: Hourglass, kieu: "mot",
      giaTri: aging.map((b) => ({ value: b.key, nhan: nhanMoc(b.label), so: b.count })),
      doc: (l) => l.tuoi ?? undefined,
      ghi: (l, v) => ({ ...l, tuoi: v ?? null }),
    },
    {
      khoa: "no", nhan: "Còn nợ", icon: Banknote, kieu: "khoang", donVi: "đ",
      doc: (l) => [l.loc.no_tu, l.loc.no_den],
      ghi: (l, tu, den) => doi(l, { no_tu: tu, no_den: den }),
    },
  ];
  if (nguoi) {
    ds.push({
      khoa: "phu_trach", nhan: "Người phụ trách", icon: UserRound, kieu: "mot",
      tim: true, giaTri: nguoi.map((n) => ({ value: String(n.id), nhan: n.name })),
      doc: (l) => (l.loc.phu_trach_id == null ? undefined : String(l.loc.phu_trach_id)),
      ghi: (l, v) => doi(l, { phu_trach_id: v == null ? undefined : Number(v) }),
    });
  }
  ds.push(
    {
      khoa: "han_tra", nhan: ch.nhanHan, icon: CalendarClock, kieu: "mot", giaTri: HAN_TRA,
      doc: (l) => l.loc.han_tra,
      ghi: (l, v) => doi(l, { han_tra: v as HanTra | undefined }),
    },
    {
      khoa: "han_muc", nhan: "Hạn mức", icon: Gauge, kieu: "mot", giaTri: HAN_MUC,
      doc: (l) => l.loc.han_muc,
      ghi: (l, v) => doi(l, { han_muc: v as HanMuc | undefined }),
    },
  );
  if (nhanKhach) {
    ds.push({
      khoa: "nhan", nhan: "Nhãn khách hàng", icon: Tag, kieu: "mot",
      tim: true, giaTri: nhanKhach.map((n) => ({ value: n, nhan: n })),
      doc: (l) => l.loc.nhan?.trim() || undefined,
      ghi: (l, v) => doi(l, { nhan: v }),
    });
  }
  ds.push({
    khoa: "het", nhan: ch.nhanHet, icon: CheckCheck, kieu: "mot",
    giaTri: [{ value: "hien", nhan: "Hiện cả" }],
    doc: (l) => (l.loc.ca_da_tra_het ? "hien" : undefined),
    ghi: (l, v) => doi(l, { ca_da_tra_het: v ? true : undefined }),
  });
  if (ch.coThieuHd) {
    ds.push({
      khoa: "thieu_hd", nhan: "Hoá đơn", icon: FileExclamationPoint, kieu: "mot",
      giaTri: [{ value: "thieu", nhan: "Có đợt giao chưa ghi" }],
      doc: (l) => (l.loc.thieu_hoa_don ? "thieu" : undefined),
      ghi: (l, v) => doi(l, { thieu_hoa_don: v ? true : undefined }),
    });
  }
  return ds;
}

/* ---------- Trạng thái lọc của cả màn ---------- */

/** Thứ ghi lên URL cùng với kỳ (kỳ do `useKyKeToan` tự ghi). `tuoi` = khoá mốc tuổi nợ đang lọc. */
export type TrangThaiCongNo = { the: TheCongNo; tuoi: string | null; tim: string; loc: LocNangCaoCongNo };

/** Tham số máy chủ của bảng, số cùng kỳ và các lời đếm — một nguồn, không ba chỗ. */
export function thamSoCongNo({ the, tuoi, tim, loc }: TrangThaiCongNo, ky: KyXem): LocCongNo {
  return {
    q: tim.trim() || undefined,
    filter: the,
    aging: tuoi,
    tu_ngay: ky.tu,
    den_ngay: ky.den,
    no_tu: loc.no_tu,
    no_den: loc.no_den,
    han_tra: loc.han_tra,
    han_muc: loc.han_muc,
    ca_da_tra_het: loc.ca_da_tra_het || undefined,
    thieu_hoa_don: loc.thieu_hoa_don || undefined,
    phu_trach_id: loc.phu_trach_id,
    nhan: loc.nhan?.trim() || undefined,
  };
}

/** Có đang lọc gì ngoài kỳ không — bảng rỗng nói "không khớp bộ lọc" thay vì "không còn nợ ai". */
export function dangLocCongNo(tt: TrangThaiCongNo): boolean {
  return tt.the !== "all" || tt.tuoi != null || !!tt.tim.trim() || soDieuKienCongNo(tt.loc) > 0;
}

/* ---------- URL (đặc tả A.18) ---------- */

const MA_MOC = /^[a-z0-9_]{1,32}$/;

/** Trạng thái lọc → khoá URL. Giá trị mặc định ⇒ undefined (khoá bị bỏ khỏi URL). */
export function congNoLenUrl({ the, tuoi, tim, loc }: TrangThaiCongNo): GiaTriUrl {
  return {
    the: the === "all" ? undefined : the,
    tuoi: tuoi ?? undefined,
    q: tim.trim() || undefined,
    no_tu: loc.no_tu != null ? String(loc.no_tu) : undefined,
    no_den: loc.no_den != null ? String(loc.no_den) : undefined,
    han_tra: loc.han_tra,
    han_muc: loc.han_muc,
    het: loc.ca_da_tra_het ? "1" : undefined,
    thd: loc.thieu_hoa_don ? "1" : undefined,
    pt: loc.phu_trach_id != null ? String(loc.phu_trach_id) : undefined,
    nhan: loc.nhan?.trim() || undefined,
  };
}

/* ---------- Sắp xếp (bảng đủ cột, 06/10/2026) ---------- */

/** Cột + chiều đang sắp. `null` = thứ tự mặc định của máy chủ (còn nợ giảm dần). */
export type SapXepCongNo = { cot: CotSapXepCongNo; chieu: "asc" | "desc" };

/** Chiều khi bấm một cột LẦN ĐẦU: còn nợ lớn trước, hạn sớm trước, thu / trả gần nhất cũ trước
 *  (khách im lâu nhất lên đầu) — cùng bảng `SAP_XEP_CONG_NO` của máy chủ. */
export const CHIEU_DAU: Record<CotSapXepCongNo, "asc" | "desc"> = { con_no: "desc", han: "asc", gan_nhat: "asc" };

/** Đang sắp theo gì — `null` đọc thành "còn nợ giảm dần". */
export const sapXepHienTai = (sx: SapXepCongNo | null): SapXepCongNo => sx ?? { cot: "con_no", chieu: "desc" };

/** Bấm tiêu đề cột: cùng cột thì đảo chiều, cột khác thì về chiều đầu của cột đó. */
export function doiSapXep(cu: SapXepCongNo | null, cot: CotSapXepCongNo): SapXepCongNo {
  const hien = sapXepHienTai(cu);
  return hien.cot === cot ? { cot, chieu: hien.chieu === "asc" ? "desc" : "asc" } : { cot, chieu: CHIEU_DAU[cot] };
}

/** Khoá URL `sx` ("han.asc"). Mặc định ⇒ undefined (khoá bị bỏ khỏi URL). */
export function sapXepLenUrl(sx: SapXepCongNo | null): string | undefined {
  if (!sx || (sx.cot === "con_no" && sx.chieu === "desc")) return undefined;
  return `${sx.cot}.${sx.chieu}`;
}

export function sapXepTuUrl(p: URLSearchParams | null): SapXepCongNo | null {
  const [cot, chieu] = (p?.get("sx") ?? "").split(".");
  if (!(cot in CHIEU_DAU) || (chieu !== "asc" && chieu !== "desc")) return null;
  return { cot: cot as CotSapXepCongNo, chieu };
}

/** Khoá URL → trạng thái lọc. Giá trị rác thì bỏ qua từng khoá (không làm hỏng cả bộ lọc). */
export function congNoTuUrl(p: URLSearchParams | null): TrangThaiCongNo {
  if (!p) return { the: "all", tuoi: null, tim: "", loc: LOC_CONG_NO_TRONG };
  const the = [...THE_CONG_NO, THE_TRA_COC].find(([t]) => t === p.get("the"))?.[0] ?? "all";
  const moc = p.get("tuoi");
  const loc: LocNangCaoCongNo = {};
  const noTu = soDuong(p.get("no_tu"));
  const noDen = soDuong(p.get("no_den"));
  if (noTu != null) loc.no_tu = noTu;
  if (noDen != null) loc.no_den = noDen;
  const han = HAN_TRA.find((g) => g.value === p.get("han_tra"))?.value;
  if (han) loc.han_tra = han as HanTra;
  const muc = HAN_MUC.find((g) => g.value === p.get("han_muc"))?.value;
  if (muc) loc.han_muc = muc as HanMuc;
  if (p.get("het") === "1") loc.ca_da_tra_het = true;
  if (p.get("thd") === "1") loc.thieu_hoa_don = true;
  const pt = soDuong(p.get("pt"));
  if (pt != null) loc.phu_trach_id = pt;
  const nhan = p.get("nhan")?.trim();
  if (nhan) loc.nhan = nhan.slice(0, 64);
  return { the, tuoi: moc && MA_MOC.test(moc) ? moc : null, tim: p.get("q") ?? "", loc };
}
