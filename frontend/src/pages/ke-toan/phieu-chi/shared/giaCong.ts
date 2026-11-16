/** Cách đọc một phiếu nhận gia công chờ trả tiền — dùng chung cho hàng chờ ("Gia công chờ chi") và
 *  form lập phiếu chi gia công, để hai chỗ không tự viết hai kiểu. */
import type { TgcChoTraTien, TgcChoTraTienDong } from "../../../../api/thueGiaCong";
import { nhanChang } from "../../../lsxBuoc";

/** "1.200 tờ in" — số kèm đơn vị đọc được. Đơn vị dòng đơn có thể là mã CHẶNG (`to`, `tay`…) như mọi
 *  cột kế thừa `don_vi_vao/ra`, nên dịch bằng `nhanChang` (rơi về danh mục đơn vị khi không phải chặng). */
export function soDv(so: number, donVi: string | null): string {
  return `${so.toLocaleString("vi-VN", { maximumFractionDigits: 3 })}${donVi ? ` ${nhanChang(donVi)}` : ""}`;
}

/** Cộng số đạt / hỏng / hụt của các dòng một phiếu nhận (cùng đơn vị theo từng dòng nên chỉ cộng khi
 *  mọi dòng chung một đơn vị; khác đơn vị thì trả null để ô hiện từng dòng). */
export function congDong(dong: TgcChoTraTienDong[], k: "dat" | "hong"): number {
  return dong.reduce((s, d) => s + (d[k] || 0), 0);
}

export function motDonVi(dong: TgcChoTraTienDong[]): string | null | undefined {
  const ds = new Set(dong.map((d) => d.don_vi ?? ""));
  return ds.size === 1 ? (dong[0]?.don_vi ?? null) : undefined;
}

/** Mã các lệnh của phiếu nhận, không trùng. */
export function maLenh(r: Pick<TgcChoTraTien, "lenh">): string[] {
  return [...new Set(r.lenh.map((l) => l.lsx_ma).filter(Boolean))];
}

/** Lý do chi điền sẵn: "Trả tiền thuê gia công GN-0015, GN-0016". */
export function lyDoChiGiaCong(rows: Pick<TgcChoTraTien, "ma">[]): string {
  return `Trả tiền thuê gia công ${rows.map((r) => r.ma).join(", ")}`;
}

export const tongTamTinh = (rows: Pick<TgcChoTraTien, "tam_tinh">[]) =>
  rows.reduce((s, r) => s + Math.round(r.tam_tinh), 0);
