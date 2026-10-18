/** Bộ lọc màn Phiếu thu (đặc tả PT-1, A.17, A.18): thẻ lọc + kỳ + bộ lọc nâng cao → tham số máy chủ.
 *
 *  Hàm thuần, không React. Mọi lọc chạy ở MÁY CHỦ; kỳ gửi theo quy ước chung `tu_ngay/den_ngay/moc`
 *  (mốc `tao` = ngày lập phiếu, `thu` = ngày thu trên chứng từ). Điều kiện là khuôn chung của hai sổ
 *  phiếu (`shared/locPhieu.ts`).
 */
import { thamSoKy, type KyDS } from "../../../thanh-loc/ky-danh-sach";
import {
  LOC_TRONG,
  locNangCaoLenUrl,
  locNangCaoTuUrl,
  soDieuKien,
  thamSoNangCao,
  type CauHinhLocPhieu,
  type LocNangCao,
} from "../../shared/locPhieu";
import type { ThamSoSo } from "../../shared/trangPhieu";

export { LOC_TRONG };

/** Mốc kỳ của màn — mặc định Ngày tạo. */
export const MOC_PT: [string, string][] = [["tao", "Ngày tạo"], ["thu", "Ngày thu"]];

/** Thẻ lọc đầu bảng. "cho" (Chờ thu) chỉ hiện khi còn phiếu CŨ chờ thu (`the_loc.cho > 0`). "dh" không
 *  lọc phiếu — nó đổi bảng sang hàng "Đơn hàng chờ thu" (cọc + hoá đơn, 17/10/2026). */
// Lọc theo chứng từ gốc ĐÃ GỠ hẳn: thẻ "Thiếu chứng từ gốc" 17/10/2026, điều kiện "Chứng từ" ở nút Lọc 18/10/2026.
export type TheLocPT = "tat_ca" | "xong" | "cho" | "dh" | "da_huy";

/** Bộ lọc ĐÃ ÁP. */
export type LocPT = LocNangCao;

export const CAU_HINH_LOC_PT: CauHinhLocPhieu = {
  nhanMuc: "Mục thu",
  nhanTaiKhoan: "Vào tài khoản",
};

const TRANG_THAI: Partial<Record<TheLocPT, string>> = {
  xong: "received",
  cho: "waiting_receipt",
  da_huy: "cancelled",
};

/** Tham số lọc dùng chung cho bảng và số cùng kỳ — một nguồn, không hai chỗ. */
export function thamSoLoc(the: TheLocPT, loc: LocPT, tim: string, ky: KyDS): ThamSoSo {
  return {
    q: tim.trim() || undefined,
    status: TRANG_THAI[the],
    ...(thamSoKy(ky) as Pick<ThamSoSo, "tu_ngay" | "den_ngay" | "moc">),
    ...thamSoNangCao(loc),
  };
}

/** Tham số tải MỘT TRANG bảng. Mới nhất theo NGÀY THU lên đầu (cột ngày là ngày chứng từ). */
export function thamSoTai(the: TheLocPT, loc: LocPT, tim: string, ky: KyDS, page: number, size: number) {
  return { ...thamSoLoc(the, loc, tim, ky), page, size, sort: "-receipt_date" };
}

/** Có đang lọc gì ngoài kỳ không — để bảng rỗng nói "không khớp bộ lọc" thay vì "chưa có". */
export function dangLoc(the: TheLocPT, loc: LocPT, tim: string): boolean {
  return the !== "tat_ca" || !!tim.trim() || soDieuKien(loc) > 0;
}

/* ---------- URL (đặc tả A.18) ---------- */

export type TrangThaiLocPT = { the: TheLocPT; tim: string; loc: LocPT };

const THE_HOP_LE: TheLocPT[] = ["tat_ca", "xong", "cho", "dh", "da_huy"];

/** Trạng thái lọc → khoá URL (kỳ do `useKyKeToan` tự ghi). Giá trị mặc định ⇒ undefined. */
export function locLenUrl({ the, tim, loc }: TrangThaiLocPT): Record<string, string | undefined> {
  return {
    the: the === "tat_ca" ? undefined : the,
    q: tim.trim() || undefined,
    ...locNangCaoLenUrl(loc),
  };
}

/** Khoá URL → trạng thái lọc. Giá trị rác thì bỏ qua từng khoá. */
export function locTuUrl(p: URLSearchParams | null): TrangThaiLocPT {
  if (!p) return { the: "tat_ca", tim: "", loc: LOC_TRONG };
  const the = THE_HOP_LE.find((t) => t === p.get("the")) ?? "tat_ca";
  return { the, tim: p.get("q") ?? "", loc: locNangCaoTuUrl(p) };
}
