// PHƯƠNG ÁN C cho ô công thức (22/10/2026 — mockup `docs/mockups/o-cong-thuc-de-doc-3-phuong-an.html`).
//
// Như `congThucBacThang`: mọi hàm chỉ ĐỌC dãy token phẳng để quyết định cách VẼ — chuỗi lưu không đổi,
// con trỏ vẫn là một chỉ số trên mảng phẳng. Riêng `apPhanChung` trả dãy token mới (sửa phần chung
// là sửa mọi bậc một lượt).
import { khopNgoac, type Dong } from "./congThucBacThang";
import { TOAN_TU } from "./formulaTokens";

type Doan = { start: number; end: number };

/** Một mục của dòng KHUNG "Kết quả = ( A + B ) × C": token thật (ngoặc, dấu nối các phần) hoặc chữ
 *  đại diện cho phần thứ `phan`. */
export type MucKhung = { tok: number } | { phan: number };
export type TachPhan = { khung: MucKhung[]; phan: Doan[] };

/** Công thức ngắn hơn ngần này token thì vẽ một dòng như cũ — cắt phần chỉ thêm dài. */
export const TACH_PHAN_TU = 15;

/** `+`/`-` tại `i` là phép NHỊ PHÂN — không phải dấu âm đơn (`-x`, `( -x`, `, -x`, `* -x`). */
function laNhiPhan(toks: string[], i: number, from: number): boolean {
  if (i === from) return false;
  const tr = toks[i - 1];
  return tr === ")" || !(TOAN_TU as readonly string[]).includes(tr);
}

/** Vị trí các dấu `ds` nằm ở tầng ngoài cùng của đoạn [from, to) (bỏ qua mọi cặp ngoặc). */
function dauTangNgoai(toks: string[], khop: number[], from: number, to: number, ds: string[]): number[] {
  const ra: number[] = [];
  for (let j = from; j < to; j++) {
    if (toks[j] === "(" && khop[j] > j) { j = khop[j]; continue; }
    if (!ds.includes(toks[j])) continue;
    if ((toks[j] === "+" || toks[j] === "-") && !laNhiPhan(toks, j, from)) continue;
    ra.push(j);
  }
  return ra;
}

const CONG = ["+", "-"];
const NHAN = ["*", "/"];

/** Thừa số `( tổng )` ngắn hơn ngần này token bên trong thì để nguyên trong phần — `( 1 - chay_tiep )`
 *  mà cũng mở ra thì phần nào cũng vụn thành ba bốn mẩu. */
const MO_NGOAC_TU = 8;

/** Cắt công thức ở các phép + − × ÷ NGOÀI CÙNG thành các phần A, B, C…:
 *  - có phép +/− ở tầng ngoài ⇒ mỗi số hạng một phần;
 *  - không có, nhưng có ×/÷ ⇒ mỗi thừa số một phần;
 *  - thừa số là `( tổng )` đủ dài (ở tầng ngoài, hay trong một số hạng) ⇒ mở ngoặc ra cắt tiếp tổng
 *    bên trong: `( A + B ) × C`, thêm "+ D" vẫn ra `( A + B ) × C + D` chứ không gộp lại thành A + B;
 *  - cả công thức nằm trong một cặp ngoặc ⇒ mở ra cắt bên trong.
 *  Phần CUỐI được rỗng khi công thức đang dừng ở một dấu nối (vừa bấm "Thêm phần", chưa gõ gì).
 *  Ít hơn 2 phần, công thức ngắn, hay ngoặc lệch ⇒ `null` (vẽ như cũ). */
export function tachPhan(toks: string[], toiThieu = TACH_PHAN_TU): TachPhan | null {
  if (toks.length < toiThieu) return null;
  const khop = khopNgoac(toks);
  if (toks.some((t, i) => (t === "(" || t === ")") && khop[i] < 0)) return null;
  const khung: MucKhung[] = [];
  const phan: Doan[] = [];
  const themPhan = (start: number, end: number) => {
    khung.push({ phan: phan.length });
    phan.push({ start, end });
  };
  const boc = (s: number, e: number) => e - s >= 2 && toks[s] === "(" && khop[s] === e - 1;
  const moDuoc = (a: number, b: number) =>
    boc(a, b) && b - a - 2 >= MO_NGOAC_TU && dauTangNgoai(toks, khop, a + 1, b - 1, CONG).length > 0;

  /** Các thừa số [a, b) của tích [s, e) cắt tại `nhan`. */
  const thuaSo = (s: number, e: number, nhan: number[]) =>
    [...nhan, e].map((p, x) => ({ a: x ? nhan[x - 1] + 1 : s, b: p }));
  const tich = (s: number, e: number, nhan: number[]) => {
    thuaSo(s, e, nhan).forEach(({ a, b }, x) => {
      if (x) khung.push({ tok: nhan[x - 1] });
      if (moDuoc(a, b)) {
        khung.push({ tok: a });
        cat(a + 1, b - 1);
        khung.push({ tok: b - 1 });
      } else themPhan(a, b);
    });
  };
  const cat = (s: number, e: number) => {
    const cong = dauTangNgoai(toks, khop, s, e, CONG);
    if (cong.length) {
      [...cong, e].forEach((p, x) => {
        const a = x ? cong[x - 1] + 1 : s;
        if (x) khung.push({ tok: cong[x - 1] });
        const nhan = dauTangNgoai(toks, khop, a, p, NHAN);
        if (nhan.length && thuaSo(a, p, nhan).some(({ a: u, b: v }) => moDuoc(u, v))) tich(a, p, nhan);
        else themPhan(a, p);
      });
      return;
    }
    const nhan = dauTangNgoai(toks, khop, s, e, NHAN);
    if (nhan.length) { tich(s, e, nhan); return; }
    if (boc(s, e)) {
      khung.push({ tok: s });
      cat(s + 1, e - 1);
      khung.push({ tok: e - 1 });
      return;
    }
    themPhan(s, e);
  };

  cat(0, toks.length);
  const n = toks.length;
  if (phan.length < 2
    || phan.some((p, k) => p.end <= p.start && !(k === phan.length - 1 && p.start === n))) return null;
  return { khung, phan };
}

/** Chữ đại diện phần thứ k: A, B, … Z, rồi A2, B2… (công thức thật hiếm khi quá 26 phần). */
export function chuPhan(k: number): string {
  return String.fromCharCode(65 + (k % 26)) + (k >= 26 ? String(Math.floor(k / 26) + 1) : "");
}

// ---- PHẦN CHUNG CỦA CÁC BẬC ----

/** Một SỐ HẠNG có dấu của một vế: `op` = vị trí dấu +/− đứng trước (null = số hạng đầu). */
export type SoHang = { op: number | null; start: number; end: number };

export function soHang(toks: string[], khop: number[], v: Doan): SoHang[] {
  const ra: SoHang[] = [];
  let op: number | null = null;
  let d = v.start;
  for (const p of dauTangNgoai(toks, khop, v.start, v.end, CONG)) {
    ra.push({ op, start: d, end: p });
    op = p;
    d = p + 1;
  }
  ra.push({ op, start: d, end: v.end });
  return ra;
}

/** Khoá so khớp số hạng: dấu + các thừa số xếp lại, để `150000 * so_kem` ≡ `so_kem * 150000`. Số
 *  hạng có phép chia ở tầng ngoài thì không đảo (a / b ≠ b / a). */
function khoaSoHang(toks: string[], khop: number[], h: SoHang): string {
  const dau = h.op != null && toks[h.op] === "-" ? "-" : "+";
  const nhan = dauTangNgoai(toks, khop, h.start, h.end, NHAN);
  if (nhan.some((p) => toks[p] === "/")) return dau + toks.slice(h.start, h.end).join(" ");
  const thua: string[] = [];
  let d = h.start;
  for (const p of nhan) { thua.push(toks.slice(d, p).join(" ")); d = p + 1; }
  thua.push(toks.slice(d, h.end).join(" "));
  return dau + thua.sort().join(" * ");
}

export type PhanChung = {
  /** Token của P, lấy theo cách viết ở bậc đầu — chỉ để HIỆN. */
  mau: string[];
  /** Theo từng vế: token thuộc phần chung (gồm cả dấu nối của nó) — thu về chip "P". */
  an: Set<number>[];
  /** Theo từng vế: số hạng RIÊNG của vế đó, đúng thứ tự gốc. */
  rieng: SoHang[][];
};

/** Số hạng nào có mặt ở MỌI vế (đếm cả lặp) thì gom thành phần chung P. Không có gì chung, hoặc mọi
 *  vế giống hệt nhau ⇒ `null`. */
export function phanChung(toks: string[], veLay: Doan[]): PhanChung | null {
  if (veLay.length < 2) return null;
  const khop = khopNgoac(toks);
  const hang = veLay.map((v) => soHang(toks, khop, v));
  const khoa = hang.map((ds) => ds.map((h) => khoaSoHang(toks, khop, h)));
  const dem = (ds: string[]) => ds.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());
  const chung = dem(khoa[0]);
  for (const ds of khoa.slice(1)) {
    const m = dem(ds);
    for (const [k, n] of chung) chung.set(k, Math.min(n, m.get(k) ?? 0));
  }
  const tong = [...chung.values()].reduce((a, b) => a + b, 0);
  if (!tong || hang.every((ds) => ds.length === tong)) return null;

  const an: Set<number>[] = [];
  const rieng: SoHang[][] = [];
  const mau: string[] = [];
  hang.forEach((ds, v) => {
    const con = new Map(chung);
    const s = new Set<number>();
    const r: SoHang[] = [];
    ds.forEach((h, x) => {
      const k = khoa[v][x];
      if ((con.get(k) ?? 0) > 0) {
        con.set(k, con.get(k)! - 1);
        if (h.op != null) s.add(h.op);
        for (let i = h.start; i < h.end; i++) s.add(i);
        if (v === 0) {
          if (k.startsWith("-")) mau.push("-");
          else if (mau.length) mau.push("+");
          mau.push(...toks.slice(h.start, h.end));
        }
      } else r.push(h);
    });
    an.push(s);
    rieng.push(r);
  });
  return { mau, an, rieng };
}

/** Sửa phần chung = viết lại MỌI vế thành `P mới + các số hạng riêng` (thứ tự số hạng về P trước,
 *  riêng sau — tổng không đổi). P mới rỗng mà có vế không còn số hạng riêng ⇒ trả lỗi. */
export function apPhanChung(
  toks: string[], veLay: Doan[], pc: PhanChung, moi: string[],
): { toks: string[] } | { loi: string } {
  const t = [...toks];
  for (let v = veLay.length - 1; v >= 0; v--) {
    const ve: string[] = [...moi];
    for (const h of pc.rieng[v]) {
      const tru = h.op != null && toks[h.op] === "-";
      if (tru) ve.push("-");
      else if (ve.length) ve.push("+");
      ve.push(...toks.slice(h.start, h.end));
    }
    if (!ve.length) return { loi: "Phần chung không được để trống — có bậc chỉ gồm phần chung" };
    t.splice(veLay[v].start, veLay[v].end - veLay[v].start, ...ve);
  }
  return { toks: t };
}

// ---- GOM DÒNG THÀNH BẢNG KHI | LẤY ----

export type BacBang = { khi: Dong[]; lay: NhomDong[] };
export type NhomDong =
  | { loai: "dong"; dong: Dong }
  | { loai: "bang"; chuoi: number; cap: number; bac: BacBang[]; conLai: NhomDong[]; dong: Dong | null };

const vaiCua = (d: Dong, chuoi: number) => d.vai?.find((v) => v.chuoi === chuoi);

/** Gom dãy dòng của `tinhDongDoan` thành cây: dòng thường đứng yên, mỗi chuỗi if có `vai` thành một
 *  bảng — ô Khi, ô Lấy (tự gom tiếp, vì vế lấy có thể chứa chuỗi if khác), hàng Còn lại, dòng `) )`. */
export function nhomDong(dong: Dong[]): NhomDong[] {
  const ra: NhomDong[] = [];
  let i = 0;
  while (i < dong.length) {
    const d = dong[i];
    const mo = d.vai?.find((v) => v.vai === "khi" && v.bac === 0);
    if (!mo) { ra.push({ loai: "dong", dong: d }); i++; continue; }
    const bang = { loai: "bang" as const, chuoi: mo.chuoi, cap: d.cap, bac: [] as BacBang[], conLai: [] as NhomDong[], dong: null as Dong | null };
    let khi: Dong[] = [];
    let gom: Dong[] = [];
    let che: "khi" | "lay" | "con_lai" = "khi";
    const chot = () => {
      if (che === "lay") bang.bac.push({ khi, lay: nhomDong(gom) });
      else if (che === "con_lai") bang.conLai = nhomDong(gom);
      gom = [];
    };
    for (; i < dong.length; i++) {
      const r = dong[i];
      const v = vaiCua(r, mo.chuoi);
      if (v?.vai === "khi") { chot(); khi = [r]; che = "khi"; continue; }
      if (v?.vai === "lay") { gom = [r]; che = "lay"; continue; }
      if (v?.vai === "con_lai") { chot(); gom = [r]; che = "con_lai"; continue; }
      if (v?.vai === "dong") { chot(); bang.dong = r; i++; break; }
      if (che === "khi") khi.push(r);
      else gom.push(r);
    }
    if (!bang.dong) chot();
    ra.push(bang);
  }
  return ra;
}

/** Token KHUNG của mọi bảng Khi | Lấy (chữ `if`, ngoặc của nó, dấu phẩy ngăn vế): cột Khi / Lấy đã
 *  nói thay chúng nên không vẽ ra. Vẫn là token thật trong chuỗi — con trỏ đi qua chúng thì nhảy luôn,
 *  Backspace / Delete không xoá chúng (sửa khung bằng nút bậc, hoặc ở Dạng chữ). */
export function khungBang(nhoms: NhomDong[][]): Set<number> {
  const ra = new Set<number>();
  const di = (ds: NhomDong[]) => ds.forEach((g) => {
    if (g.loai !== "bang") return;
    for (const b of g.bac) {
      const k = b.khi[0].bac!;
      [k.ifIdx, k.open, k.phay1, k.phay2, k.close].forEach((i) => ra.add(i));
      di(b.lay);
    }
    di(g.conLai);
  });
  nhoms.forEach(di);
  return ra;
}
