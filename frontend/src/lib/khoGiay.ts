/** Khổ + đơn vị gốc của giấy (và đơn vị gốc của vật tư khác) trong kho. Phản chiếu
 *  `backend/app/services/kho_giay.py` — máy chủ chuẩn hoá lại và tự SUY đơn vị gốc từ ĐVT, đây
 *  chỉ để hiện và gõ cho đúng.
 *
 *  10/10/2026: giấy BỎ dạng cuộn/tờ. Một dòng tồn giấy = mã + khổ + đơn vị gốc (`to`, `kg`…); tờ và
 *  kg không quy đổi lẫn nhau nên cùng khổ khác đơn vị gốc là hai dòng. */
import { tenDonVi } from "../pages/tenDonVi";

/** Hai cạnh mm → (cạnh ngắn, cạnh dài). Thiếu cạnh = 0; một cạnh ⇒ (cạnh, 0). */
export function chuanKho(a: unknown, b: unknown): [number, number] {
  const mm = (x: unknown) => {
    const v = Math.round(Number(x));
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const x = mm(a);
  const y = mm(b);
  if (x && y) return [Math.min(x, y), Math.max(x, y)];
  return [x || y, 0];
}

/** Số tờ từ kg, LÀM TRÒN XUỐNG — phản chiếu `kho_giay.to_tu_kg` (cùng +1e-9 chống sai số dấu
 *  phẩy động). Thiếu một cạnh khổ hoặc gsm ⇒ null. */
export function toTuKg(kg: number, rong: number, dai: number, gsm: number): number | null {
  if (!(rong > 0 && dai > 0 && gsm > 0)) return null;
  return Math.floor(kg / ((rong / 1000) * (dai / 1000) * (gsm / 1000)) + 1e-9);
}

/** Gốc + số gốc của một dòng xin: giấy KHỔ HAI CẠNH xin theo họ kg ⇒ TỜ (`toTuKg`), như máy chủ quy
 *  lúc lưu đề nghị — lô giấy hai cạnh luôn đếm tờ. `sl` null = chưa quy được (thiếu gsm). Dòng khác
 *  giữ nguyên `donViGoc` + `slGoc`. */
export function gocDongXin(x: {
  hangLoai: string | null; donViGoc: string | null; rong: unknown; dai: unknown; slGoc: number;
  gsm: number | null | undefined;
}): { goc: string | null; sl: number | null } {
  const [r, d] = chuanKho(x.rong, x.dai);
  if (x.hangLoai !== "giay" || x.donViGoc !== "kg" || !(r && d)) return { goc: x.donViGoc, sl: x.slGoc };
  return { goc: "to", sl: x.gsm ? toTuKg(x.slGoc, r, d, x.gsm) : null };
}

/** "780 × 905 mm" · chỉ rộng "khổ 1000 mm" · không có ⇒ "chưa có khổ". */
export function nhanKho(khoRong: number | null | undefined, khoDai: number | null | undefined): string {
  const r = khoRong ?? 0;
  const d = khoDai ?? 0;
  if (r && d) return `${r} × ${d} mm`;
  if (r) return `khổ ${r} mm`;
  return "chưa có khổ";
}

/** Loại hàng mang KHỔ — phản chiếu `kho_giay.CO_KHO`. Vật tư khác có khổ TUỲ CHỌN như giấy
 *  (27/10/2026): màng bóng khổ rộng 320, decal tấm 500 × 700; mực, keo để trống. */
export function coKho(hangLoai: string | null | undefined): boolean {
  return hangLoai === "giay" || hangLoai === "vat_tu";
}

/** Nhãn khổ cạnh tên của một dòng chứng từ / lô: giấy ⇒ `nhanKho` (kể cả "chưa có khổ"), vật tư ⇒
 *  khổ khi có (trống là món không khổ, không phải thiếu), hàng khác ⇒ "". */
export function nhanKhoGiay(x: {
  hang_loai: string;
  kho_rong?: number | null;
  kho_dai?: number | null;
}): string {
  if (x.hang_loai === "giay") return nhanKho(x.kho_rong, x.kho_dai);
  return coKho(x.hang_loai) && x.kho_rong ? nhanKho(x.kho_rong, x.kho_dai) : "";
}

/** Loại hàng tách dòng theo ĐƠN VỊ GỐC (mỗi đơn vị đã khai ở danh mục là một nhóm không quy đổi lẫn
 *  nhau) — phản chiếu `kho_giay.CO_DON_VI_GOC`. KHỔ xem `coKho`. */
const CO_DON_VI_GOC = new Set(["giay", "vat_tu"]);

export function coDonViGoc(hangLoai: string | null | undefined): boolean {
  return CO_DON_VI_GOC.has(hangLoai ?? "");
}

/** Khoá DÒNG TỒN dạng chuỗi — phản chiếu khoá 5 phần của máy chủ (`ton_kho_nhom_service`):
 *  giấy `giay:id:rộng:dài:gốc` (vd. "giay:12:780:905:to"), vật tư khác `vat_tu:id:rộng:dài:gốc`
 *  (vd. "vat_tu:5:320:0:kg"; trống khổ "vat_tu:5:0:0:kg"), hàng khác `loai:id:0:0:`. Chuỗi này phải KHỚP từng ký tự với
 *  `TonNhomMuc.khoa` máy chủ trả, lệch là dòng mất phán quyết. */
export function khoaTon(x: {
  hang_loai: string;
  hang_id: number;
  don_vi_goc?: string | null;
  kho_rong?: number | null;
  kho_dai?: number | null;
}): string {
  if (!coDonViGoc(x.hang_loai)) return `${x.hang_loai}:${x.hang_id}:0:0:`;
  const goc = (x.don_vi_goc ?? "").trim().toLowerCase();
  const [r, d] = chuanKho(x.kho_rong, x.kho_dai);
  return `${x.hang_loai}:${x.hang_id}:${r}:${d}:${goc}`;
}

/** Khoá dòng tồn của một NGƯỠNG — cùng khoá với `khoaTon` (ngưỡng đặt trên đúng một dòng tồn). */
export function khoaNguong(t: {
  hang_loai: string;
  hang_id: number;
  kho_rong?: number;
  kho_dai?: number;
  don_vi_goc?: string | null;
}): string {
  return khoaTon(t);
}

/** Tên đơn vị gốc để hiện ("tờ", "kg") — chưa nạp danh mục thì hiện mã trần. */
export function tenGoc(goc: string | null | undefined): string {
  const g = (goc ?? "").trim();
  return g ? tenDonVi(g) ?? g : "";
}

/** Nhãn dòng tồn giấy cạnh tên: khổ + tên đơn vị gốc, "780 × 905 mm (tờ)" / "khổ 1000 mm (kg)" /
 *  "chưa có khổ (kg)" — không nối bằng dấu chấm giữa (luật chữ của chủ). Hai dòng cùng khổ khác đơn vị gốc nhờ phần đơn vị mà phân biệt được.
 *  Hàng khác (`laGiay` false, không có gốc) ⇒ "". */
export function nhanDongTon(
  goc: string | null | undefined,
  khoRong: number,
  khoDai: number,
  opts?: { laGiay?: boolean },
): string {
  const dv = tenGoc(goc);
  if (!dv && !opts?.laGiay) return "";
  const kho = nhanKho(khoRong, khoDai);
  return dv ? `${kho} (${dv})` : kho;
}
