/** Bộ lọc màn Phiếu chi (đặc tả PC-1, A.17, A.18): thẻ lọc + kỳ + điều kiện → tham số máy chủ.
 *
 *  Hàm thuần, không React — để test được mà không dựng màn. Mọi lọc chạy ở MÁY CHỦ. Kỳ gửi theo quy
 *  ước chung `tu_ngay/den_ngay/moc` (mốc `tao` = ngày lập phiếu, `chi` = ngày chi trên chứng từ).
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

export { LOC_TRONG, soDieuKien };

/** Mốc kỳ của màn — mặc định Ngày tạo. */
export const MOC_PC: [string, string][] = [["tao", "Ngày tạo"], ["chi", "Ngày chi"]];

/** Thẻ lọc đầu bảng. "gc" / "tl" / "mh" không lọc phiếu — chúng đổi bảng sang hàng chờ gia công /
 *  hàng chờ trả lại khách / hàng đơn mua chờ chi (việc CHƯA lập phiếu). */
// Lọc theo chứng từ gốc ĐÃ GỠ hẳn: thẻ "Thiếu chứng từ gốc" 17/10/2026, điều kiện "Chứng từ" ở nút Lọc 18/10/2026.
export type TheLocPC = "tat_ca" | "xong" | "gc" | "tl" | "mh" | "da_huy";

/** Bộ lọc ĐÃ ÁP — khuôn chung của hai sổ phiếu (`shared/locPhieu.ts`). */
export type LocPC = LocNangCao;

export const CAU_HINH_LOC_PC: CauHinhLocPhieu = {
  nhanMuc: "Mục chi",
  nhanTaiKhoan: "Trả từ tài khoản",
};

/** Tham số lọc dùng chung cho bảng và số cùng kỳ — một nguồn, không hai chỗ. */
export function thamSoLoc(the: TheLocPC, loc: LocPC, tim: string, ky: KyDS): ThamSoSo {
  const status = the === "xong" ? "paid" : the === "da_huy" ? "cancelled" : undefined;
  return {
    q: tim.trim() || undefined,
    status,
    ...(thamSoKy(ky) as Pick<ThamSoSo, "tu_ngay" | "den_ngay" | "moc">),
    ...thamSoNangCao(loc),
  };
}

/** Tham số tải MỘT TRANG bảng. Mới nhất theo NGÀY CHI lên đầu (cột ngày là ngày chứng từ). */
export function thamSoTai(the: TheLocPC, loc: LocPC, tim: string, ky: KyDS, page: number, size: number) {
  return { ...thamSoLoc(the, loc, tim, ky), page, size, sort: "-voucher_date" };
}

/** Có đang lọc gì ngoài kỳ không — để bảng rỗng nói "không khớp bộ lọc" thay vì "chưa có". */
export function dangLoc(the: TheLocPC, loc: LocPC, tim: string): boolean {
  return the !== "tat_ca" || !!tim.trim() || soDieuKien(loc) > 0;
}

/* ---------- URL (đặc tả A.18) ---------- */

/** Trạng thái lọc của màn — thứ ghi lên URL cùng với kỳ (kỳ do `useKyKeToan` tự ghi). */
export type TrangThaiLocPC = { the: TheLocPC; tim: string; loc: LocPC };

const THE_HOP_LE: TheLocPC[] = ["tat_ca", "xong", "gc", "tl", "mh", "da_huy"];

/** Trạng thái lọc → khoá URL. Giá trị mặc định ⇒ undefined (khoá bị bỏ khỏi URL). */
export function locLenUrl({ the, tim, loc }: TrangThaiLocPC): Record<string, string | undefined> {
  return {
    the: the === "tat_ca" ? undefined : the,
    q: tim.trim() || undefined,
    ...locNangCaoLenUrl(loc),
  };
}

/** Khoá URL → trạng thái lọc. Giá trị rác thì bỏ qua từng khoá (không làm hỏng cả bộ lọc). */
export function locTuUrl(p: URLSearchParams | null): TrangThaiLocPC {
  if (!p) return { the: "tat_ca", tim: "", loc: LOC_TRONG };
  const the = THE_HOP_LE.find((t) => t === p.get("the")) ?? "tat_ca";
  return { the, tim: p.get("q") ?? "", loc: locNangCaoTuUrl(p) };
}
