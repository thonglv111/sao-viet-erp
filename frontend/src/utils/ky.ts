/** Kỳ LỊCH để xem số liệu — dùng chung cho Thống kê khách hàng và 5 màn kế toán.
 *
 *  Ngày là chuỗi "YYYY-MM-DD" theo giờ Việt Nam. Ở đây chỉ có phép tính ngày: khoảng của kỳ đang
 *  chọn, lùi một năm để so cùng kỳ, kiểm khoảng tự gõ. Số liệu do máy chủ cộng.
 */
import type { KyXem } from "../api/client";

export type { KyXem };

const MS_NGAY = 86_400_000;
const GIO_VN = 7 * 3_600_000;

export type LoaiKy = "thang" | "quy" | "nam" | "12t" | "namtruoc" | "tuy";
export const LOAI_KY: [LoaiKy, string][] = [
  ["thang", "Tháng này"],
  ["quy", "Quý này"],
  ["nam", "Năm nay"],
  ["12t", "12 tháng qua"],
  ["namtruoc", "Năm trước"],
  ["tuy", "Tuỳ chọn"],
];

/** Khoảng tối đa máy chủ nhận (~10 năm, khớp `TRAN_KHOANG_NGAY` bên backend có dư). */
export const TRAN_KHOANG_NGAY = 3650;

const dd = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${dd(m)}-${dd(d)}`;
const tach = (s: string): [number, number, number] => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return [y, m, d];
};
const utc = (s: string) => {
  const [y, m, d] = tach(s);
  return Date.UTC(y, m - 1, d);
};

/** Hôm nay theo giờ Việt Nam, không phụ thuộc múi giờ của máy đang mở trang. */
export function homNayVN(now: number = Date.now()): string {
  return new Date(now + GIO_VN).toISOString().slice(0, 10);
}

/** Ngày (giờ VN) của một mốc thời gian máy chủ trả về. */
export function ngayCuaMoc(moc: string): string {
  const t = new Date(moc).getTime();
  return Number.isNaN(t) ? moc.slice(0, 10) : homNayVN(t);
}

/** Tên ngắn của `ngayCuaMoc`: ngày giờ xưởng của một mốc UTC ("2026-10-17T23:07:00Z" thành "2026-10-18").
 *  KHÔNG cắt 10 ký tự đầu của mốc: trước 7 giờ sáng giờ VN, UTC còn là ngày hôm trước. */
export function ngayVN(moc: string): string {
  return ngayCuaMoc(moc);
}

/** "dd/mm/yyyy" từ "YYYY-MM-DD" hoặc mốc thời gian đầy đủ; rỗng thì "—". */
export function ngayDeDoc(s: string | null | undefined): string {
  if (!s) return "—";
  const [y, m, d] = tach(s.length > 10 ? ngayCuaMoc(s) : s);
  return `${dd(d)}/${dd(m)}/${y}`;
}

export function congNgay(s: string, n: number): string {
  return new Date(utc(s) + n * MS_NGAY).toISOString().slice(0, 10);
}

export function soNgay(tu: string, den: string): number {
  return Math.round((utc(den) - utc(tu)) / MS_NGAY);
}

/** Lùi n năm. 29/02 sang năm không nhuận thành 28/02 — khớp `lui_nam` bên backend. */
export function luiNam(s: string, n = 1): string {
  const [y, m, d] = tach(s);
  const nam = y - n;
  const cuoiThang = new Date(Date.UTC(nam, m, 0)).getUTCDate();
  return iso(nam, m, Math.min(d, cuoiThang));
}

export function tinhKy(loai: LoaiKy, homNay: string, tuy?: KyXem | null): KyXem {
  const [y, m] = tach(homNay);
  switch (loai) {
    case "thang":
      return { tu: iso(y, m, 1), den: homNay };
    case "quy":
      return { tu: iso(y, Math.floor((m - 1) / 3) * 3 + 1, 1), den: homNay };
    case "12t":
      return { tu: congNgay(homNay, -364), den: homNay };
    case "namtruoc":
      return { tu: iso(y - 1, 1, 1), den: iso(y - 1, 12, 31) };
    case "tuy":
      if (tuy) return tuy;
      return { tu: iso(y, 1, 1), den: homNay };
    case "nam":
    default:
      return { tu: iso(y, 1, 1), den: homNay };
  }
}

/** Lỗi của khoảng tự gõ, hoặc null nếu dùng được. */
export function loiKhoang(tu: string, den: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tu) || !/^\d{4}-\d{2}-\d{2}$/.test(den)) return "Chọn đủ hai ngày.";
  if (tu > den) return "Ngày bắt đầu phải trước ngày kết thúc.";
  if (soNgay(tu, den) > TRAN_KHOANG_NGAY) return "Khoảng xem tối đa 10 năm.";
  return null;
}

/** Cùng kỳ năm trước của một kỳ: lùi cả hai đầu một năm. Kỳ chưa hết (tháng này, năm nay…) thì
 *  cùng kỳ cũng chỉ tính tới ngày tương ứng — so táo với táo. */
export function kyCungKy(ky: KyXem): KyXem {
  return { tu: luiNam(ky.tu), den: luiNam(ky.den) };
}
