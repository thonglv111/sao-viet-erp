/** Điều kiện lọc của hai danh sách yêu cầu kho — "Yêu cầu nhập xuất" (người yêu cầu) và "Phiếu từ
 *  yêu cầu" (bên kho), cả tab Điều chuyển (06/10/2026). Lọc + đếm tab ở máy chủ, đúng phạm vi xem.
 *
 *  Hai màn nằm chung một mục thanh bên ("kho-main") nên chung một bộ lọc trên URL: sang tab kia vẫn
 *  giữ kỳ và điều kiện đang áp. Nhập và Xuất chung MỘT bảng (07/10/2026) — chiều là điều kiện "Loại". */
import { ArrowDownUp, Building2, ClipboardList, Package, Route, Users, Warehouse } from "lucide-react";

import { api, type StockRequestKind, type ThamSoLoc } from "../../api/client";
import type { GiaTriUrl } from "../ke-toan/shared/urlMan";
import { kyLenUrl, kyTuUrl, soLenUrl, soTuUrl, type KyDS } from "../thanh-loc/ky-danh-sach";
import { chuThanhId, idThanhChu, useLuaChonLoc } from "../thanh-loc/lua-chon";
import type { DieuKien } from "../thanh-loc/thanh-loc";

export type LocYeuCauKho = {
  /** Nhập hoặc Xuất; bỏ trống = cả hai. */
  loai?: StockRequestKind;
  bo_phan?: number;
  /** Id người yêu cầu (nhiều người). */
  nguoi: string[];
  kho?: number;
  /** Nguồn (nhiều): mua_hang | giao_hang | kcs | gia_cong | san_xuat | khong | dieu_chuyen. */
  nguon: string[];
  /** Id lệnh SX — khớp dòng gắn lệnh hoặc bài ghép chứa lệnh (18/10/2026). */
  lenh?: number;
  /** Mã hàng (nhiều), khoá `"<hang_loai>:<hang_id>"` — hai danh mục có hai dãy id riêng. */
  vat_tu: string[];
};

export const LOC_YCK_TRONG: LocYeuCauKho = { nguoi: [], nguon: [], vat_tu: [] };

const KHOA_VAT_TU = /^[a-z_]+:\d+$/;

/** Mã màn trên URL = mã mục thanh bên, để tải lại trang mở đúng màn. */
export const MAN_YEU_CAU_KHO = "kho-main";

/** Mốc kỳ: Ngày yêu cầu (mặc định) / Ngày cần / Ngày duyệt. */
export const MOC_YEU_CAU_KHO: [string, string][] = [
  ["tao", "Ngày yêu cầu"],
  ["can", "Ngày cần"],
  ["duyet", "Ngày duyệt"],
];

/** Kỳ + điều kiện của màn, đúng một khối trên URL. */
export type LocManYCK = { ky: KyDS; loc: LocYeuCauKho };
export const LOC_MAN_YCK_TRONG: LocManYCK = { ky: { loai: "tat_ca", moc: "tao" }, loc: LOC_YCK_TRONG };
export const docLocManYCK = (p: URLSearchParams): LocManYCK => ({
  ky: kyTuUrl(p, MOC_YEU_CAU_KHO.map(([m]) => m), "tao"),
  loc: locYCKTuUrl(p),
});
export const ghiLocManYCK = (t: LocManYCK): GiaTriUrl => ({ ...kyLenUrl(t.ky, "tao"), ...locYCKLenUrl(t.loc) });

/** Tab Điều chuyển không có điều kiện Nguồn — Nguồn còn nằm trên URL từ tab khác cũng không áp. */
export function thamSoLocYCK(loc: LocYeuCauKho, dieuChuyen = false): ThamSoLoc {
  return {
    loai: loc.loai, bo_phan: loc.bo_phan, nguoi_yeu_cau: loc.nguoi, kho: loc.kho,
    nguon: dieuChuyen ? undefined : loc.nguon, lenh: loc.lenh, vat_tu: loc.vat_tu,
  };
}

export function locYCKTuUrl(p: URLSearchParams): LocYeuCauKho {
  const loai = p.get("loai_yc");
  return {
    loai: loai === "NHAP" || loai === "XUAT" ? loai : undefined,
    bo_phan: soTuUrl(p.get("bp")),
    nguoi: (p.get("nyc") ?? "").split(",").filter((x) => /^\d+$/.test(x)),
    kho: soTuUrl(p.get("kho_loc")),
    nguon: (p.get("nguon") ?? "").split(",").filter((x) => /^[a-z_]+$/.test(x)),
    lenh: soTuUrl(p.get("lenh")),
    vat_tu: (p.get("vt") ?? "").split(",").filter((x) => KHOA_VAT_TU.test(x)),
  };
}

export function locYCKLenUrl(loc: LocYeuCauKho): GiaTriUrl {
  return {
    loai_yc: loc.loai,
    bp: soLenUrl(loc.bo_phan),
    nyc: loc.nguoi.length ? loc.nguoi.join(",") : undefined,
    kho_loc: soLenUrl(loc.kho),
    nguon: loc.nguon.length ? loc.nguon.join(",") : undefined,
    lenh: soLenUrl(loc.lenh),
    vt: loc.vat_tu.length ? loc.vat_tu.join(",") : undefined,
  };
}

const LOAI: { value: StockRequestKind; nhan: string }[] = [
  { value: "NHAP", nhan: "Nhập" },
  { value: "XUAT", nhan: "Xuất" },
];

export function useDieuKienYeuCauKho(dieuChuyen: boolean): DieuKien<LocYeuCauKho>[] {
  const nap = (truong: "bo-phan" | "nguoi-yeu-cau" | "kho" | "nguon" | "lenh" | "vat-tu") => (token: string) =>
    api.kho.deNghi.locGiaTri(token, truong, dieuChuyen);
  const boPhan = useLuaChonLoc(nap("bo-phan"));
  const nguoi = useLuaChonLoc(nap("nguoi-yeu-cau"));
  const kho = useLuaChonLoc(nap("kho"));
  const nguon = useLuaChonLoc(nap("nguon"));
  const lenh = useLuaChonLoc(nap("lenh"));
  const vatTu = useLuaChonLoc(nap("vat-tu"));
  return [
    {
      khoa: "loai", nhan: "Loại", icon: ArrowDownUp, kieu: "mot", giaTri: LOAI,
      doc: (l) => l.loai,
      ghi: (l, v) => ({ ...l, loai: v === "NHAP" || v === "XUAT" ? v : undefined }),
    },
    {
      // Phòng đứng tên yêu cầu HOẶC tổ của công đoạn xin vật tư — người bấm có thể ở phòng khác.
      khoa: "bo_phan", nhan: "Tổ / bộ phận", icon: Building2, kieu: "mot", tim: true, giaTri: boPhan,
      doc: (l) => idThanhChu(l.bo_phan),
      ghi: (l, v) => ({ ...l, bo_phan: chuThanhId(v) }),
    },
    {
      khoa: "nguoi", nhan: "Người yêu cầu", icon: Users, kieu: "nhieu", tim: true, giaTri: nguoi,
      doc: (l) => l.nguoi,
      ghi: (l, v) => ({ ...l, nguoi: v }),
    },
    {
      khoa: "lenh", nhan: "Lệnh", icon: ClipboardList, kieu: "mot", tim: true, giaTri: lenh,
      doc: (l) => idThanhChu(l.lenh),
      ghi: (l, v) => ({ ...l, lenh: chuThanhId(v) }),
    },
    {
      khoa: "vat_tu", nhan: "Vật tư", icon: Package, kieu: "nhieu", tim: true, giaTri: vatTu,
      doc: (l) => l.vat_tu,
      ghi: (l, v) => ({ ...l, vat_tu: v }),
    },
    {
      khoa: "kho", nhan: "Kho", icon: Warehouse, kieu: "mot", tim: true, giaTri: kho,
      doc: (l) => idThanhChu(l.kho),
      ghi: (l, v) => ({ ...l, kho: chuThanhId(v) }),
    },
    // Tab Điều chuyển: mọi yêu cầu đều nguồn "từ kho khác" — điều kiện Nguồn vô nghĩa, bỏ.
    ...(dieuChuyen ? [] : [{
      khoa: "nguon", nhan: "Nguồn", icon: Route, kieu: "nhieu", giaTri: nguon,
      doc: (l) => l.nguon,
      ghi: (l, v) => ({ ...l, nguon: v }),
    } satisfies DieuKien<LocYeuCauKho>]),
  ];
}
