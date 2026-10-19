/** Cách đọc một lần gia công ngoài chờ chi — dùng chung cho hàng chờ (thẻ "Gia công chờ chi") và
 *  form lập phiếu chi gia công (PC-5), để hai chỗ không tự viết hai kiểu. */
import type { GiaCongChoChi } from "../../../../api/client";
import { nhanChang } from "../../../lsxBuoc";

/** Tên việc của một lần là các công đoạn nối bằng " + " — tách ra thành từng thẻ nhỏ. */
export function cacViec(tenViec: string): string[] {
  return tenViec.split(" + ").map((v) => v.trim()).filter(Boolean);
}

/** "1.200 tờ in" — số chốt kèm đơn vị đọc được. Phiếu gia công MỘT PHẦN lưu `don_vi` là mã CHẶNG của
 *  bước (`to`, `tay`…) như mọi cột kế thừa `don_vi_vao/ra`, nên dịch bằng `nhanChang` (chặng trước, rơi
 *  về danh mục đơn vị khi không phải mã chặng) — dịch thẳng bằng danh mục ra "790 to" (E2E #42). */
export function soChot(r: Pick<GiaCongChoChi, "sl_cuoi" | "don_vi">): string {
  return `${r.sl_cuoi.toLocaleString("vi-VN")}${r.don_vi ? ` ${nhanChang(r.don_vi)}` : ""}`;
}
