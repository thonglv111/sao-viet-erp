/** Nhánh và cột "Làm sau" của bảng Các bước (12/11/2026, mockup chuan-bi-vat-lieu.html).
 *
 *  Nhánh suy từ ĐỒ THỊ: bước mang dòng giấy in là gốc nhánh Giấy, bước mang dòng sóng là gốc nhánh
 *  Sóng; bước nhận từ cả hai là Gộp. Không dò theo tên công đoạn. */

export type Nhanh = "giay" | "song" | "gop";

interface BuocNhanh {
  key: string;
  phu_thuoc_step_keys: string[];
  vat_tus: { hang_loai?: string; vat_tu_id: number }[];
}

/** Lệnh không có sóng ⇒ mọi bước `null` (bảng không vẽ cột Nhánh). */
export function nhanhCuaBuoc(
  rows: BuocNhanh[], giayId: number | null | undefined, songId: number | null | undefined,
): Record<string, Nhanh | null> {
  const out: Record<string, Nhanh | null> = {};
  if (!songId) {
    for (const r of rows) out[r.key] = null;
    return out;
  }
  const theoKey = new Map(rows.map((r) => [r.key, r]));
  const goc = new Map<string, Set<"giay" | "song">>();
  const tinh = (key: string, dang: Set<string>): Set<"giay" | "song"> => {
    const co = goc.get(key);
    if (co) return co;
    const r = theoKey.get(key);
    const s = new Set<"giay" | "song">();
    if (!r || dang.has(key)) return s;
    dang.add(key);
    for (const v of r.vat_tus) {
      if (v.hang_loai !== "giay") continue;
      if (giayId && v.vat_tu_id === giayId) s.add("giay");
      if (v.vat_tu_id === songId) s.add("song");
    }
    for (const k of r.phu_thuoc_step_keys) for (const x of tinh(k, dang)) s.add(x);
    dang.delete(key);
    goc.set(key, s);
    return s;
  };
  for (const r of rows) {
    const s = tinh(r.key, new Set());
    out[r.key] = s.size === 2 ? "gop" : s.has("song") ? "song" : s.has("giay") ? "giay" : null;
  }
  return out;
}

/** Ô "Làm sau": bước gốc ghi "Bắt đầu"; nối thẳng dòng ngay trên thì để trống; còn lại ghi tên các bước
 *  đứng trước, nối bằng "và". `tenCua(key)` trả tên hiện trên bảng, null khi bước thuộc lệnh khác. */
export function lamSau(
  rows: { key: string; phu_thuoc_step_keys: string[] }[], idx: number, tenCua: (key: string) => string | null,
): string {
  const truoc = rows[idx].phu_thuoc_step_keys;
  if (truoc.length === 0) return "Bắt đầu";
  if (truoc.length === 1 && idx > 0 && truoc[0] === rows[idx - 1].key) return "";
  const ten = truoc.map((k) => tenCua(k) ?? "bước lệnh khác");
  return ten.length > 3 ? `${ten.slice(0, 2).join(", ")} và ${ten.length - 2} bước khác` : ten.join(" và ");
}
