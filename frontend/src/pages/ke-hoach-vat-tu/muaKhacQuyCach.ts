// Ô lệnh đã có yêu cầu/đơn "Mua cho" nhưng KHÁC khổ hoặc ĐVT với nhu cầu (lỗi #23).
import type { MuaKhacQuyCach } from "../../api/client";
import { nhanKho, tenGoc } from "../../lib/khoGiay";

/** "Đã mua khác quy cách: DMH-261018-FK51 47 kg 650 × 860 mm" — một câu mỗi đơn. Máy không bù số
 *  (tờ và kg không quy đổi), câu chỉ để người lập kế hoạch biết đã có người mua. */
export function cauMuaKhacQuyCach(ds: MuaKhacQuyCach[] | null | undefined): string[] {
  return (ds ?? []).map((x) => {
    const kho = x.kho_rong || x.kho_dai ? ` ${nhanKho(x.kho_rong, x.kho_dai)}` : "";
    return `Đã mua khác quy cách: ${x.ma} ${x.so_luong.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} ${tenGoc(x.don_vi)}${kho}`.trim();
  });
}
