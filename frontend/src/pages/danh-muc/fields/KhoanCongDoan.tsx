import { useState, type ReactNode } from "react";

import { useBienCongThuc, type BienCongThuc } from "../bienCongThuc";
import { TrashIcon } from "../icons";
import type { BacGiaRow, GiaTheoToRow, KhoanCongDoanValue, Row, TuyChonKhoanRow, ViecPhatSinhRow } from "../types";
import { FormulaField } from "./FormulaField";
import { FormulaPopover } from "./FormulaPopover";
import { RefSearchField } from "./RefFields";
import { RowEditor, type CotThem } from "./RowEditor";
import { maTuTenChip } from "./VatTuChips";
import { ViecPhatSinhField } from "./ViecPhatSinh";

/** Một tổ phụ trách của công đoạn — để vẽ bảng giá theo tổ. */
export interface ToPhuTrach { id: number; ten: string }

const so = (s: string): number | null => (s === "" ? null : Number(s));
const hienSo = (v: number | null | undefined) => (v === undefined || v === null ? "" : String(v));

/** Ghi một ô của bảng giá theo tổ. Dòng không còn số nào thì bỏ; bảng rỗng ⇒ `null` (= mọi tổ dùng
 *  giá chung). */
function datGia<T extends { department_id: number }>(
  bang: T[] | null | undefined, dep: number, patch: Partial<T>, rong: (r: T) => boolean,
): T[] | null {
  const cu = bang ?? [];
  const co = cu.find((r) => r.department_id === dep);
  const moi = co ? { ...co, ...patch } : ({ department_id: dep, ...patch } as T);
  const ra = (co ? cu.map((r) => (r.department_id === dep ? moi : r)) : [...cu, moi])
    .filter((r) => !rong(r));
  return ra.length ? ra : null;
}

/** Tuỳ chọn khi ghi → chip của ô Công thức khoán (chưa lưu vẫn bấm được). */
export function tuyChonThanhBien(tc: TuyChonKhoanRow[]): BienCongThuc[] {
  return tc.filter((t) => t.ten.trim() !== "" && t.ma.trim() !== "").map((t) => ({
    ma: t.ma.trim(),
    nhan: t.ten.trim(),
    mo_ta: "Tuỳ chọn khi ghi",
    don_vi: t.kieu === "so" ? "" : "0/1",
    nguon: "thợ chọn ở lần ghi",
    loai: ["khoan"],
  }));
}

// Mã không được trùng — cùng bộ cấm với server `_kiem_tuy_chon` (tên hàm + từ khoá Python + chip hệ
// thống); chip hệ thống lấy từ từ điển biến lúc chạy.
const MA_CAM = new Set([
  "if", "if_", "ceil", "floor", "round", "max", "min", "abs",
  "and", "or", "not", "in", "is", "for", "while", "def", "class", "return", "lambda", "none", "true",
  "false", "import", "from", "as", "with", "try", "except", "finally", "raise", "pass", "break",
  "continue", "global", "nonlocal", "del", "elif", "else", "yield", "assert", "async", "await",
]);

/** Mã của tuỳ chọn sinh từ tên (người khai không thấy mã). Trùng thì thêm hậu tố `_2`, `_3`… */
export function maTuyChon(ten: string, dangDung: Set<string>): string {
  if (!ten.trim()) return "";
  const goc = maTuTenChip(ten);
  let ma = goc;
  for (let n = 2; MA_CAM.has(ma) || dangDung.has(ma); n++) ma = `${goc}_${n}`;
  return ma;
}

/** Mã tuỳ chọn đổi (tuỳ chọn chưa lưu, sửa tên) ⇒ đổi theo trong công thức để chip không gãy. */
export function doiMaTrongCongThuc(
  ct: string | null | undefined, cu: TuyChonKhoanRow[], moi: TuyChonKhoanRow[],
): string | null | undefined {
  if (!ct || cu.length !== moi.length) return ct;
  return cu.reduce((s, r, i) => (r.ma && moi[i].ma && r.ma !== moi[i].ma
    ? s.replace(new RegExp(`\\b${r.ma}\\b`, "g"), moi[i].ma) : s), ct);
}

/** Khối "Tuỳ chọn khi ghi". Mã TỰ SINH từ tên: tuỳ chọn mới thì mã chạy theo tên tới lúc lưu; tuỳ
 *  chọn đã lưu giữ nguyên mã dù đổi tên (công thức và các lần ghi cũ đang trỏ vào mã). */
function TuyChonKhiGhi({ value, onChange }: {
  value: TuyChonKhoanRow[];
  onChange: (v: TuyChonKhoanRow[]) => void;
}) {
  const heThong = useBienCongThuc();
  const [maDaLuu] = useState(() => new Set(value.map((r) => r.ma).filter(Boolean)));
  const sua = (i: number, patch: Partial<TuyChonKhoanRow>) =>
    onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const doiTen = (i: number, ten: string) => {
    if (maDaLuu.has(value[i].ma)) return sua(i, { ten });
    const dangDung = new Set([...heThong.map((b) => b.ma), ...value.filter((_, j) => j !== i).map((r) => r.ma)]);
    sua(i, { ten, ma: maTuyChon(ten, dangDung) });
  };
  return (
    <RowEditor
      khoa="rc-bands--tuy-chon"
      rows={value}
      cot={["Tên hiện cho thợ", "Thợ nhập bằng", "Gợi ý cho thợ"]}
      trong="Chưa có tuỳ chọn"
      themNhan="＋ Thêm tuỳ chọn"
      onThem={() => onChange([...value, { ma: "", ten: "", kieu: "co_khong", goi_y: null }])}
      onXoa={(i) => onChange(value.filter((_, j) => j !== i))}
      xoaTitle="Bỏ tuỳ chọn này"
      veHang={(r, i) => (
        <>
          <td>
            <input className="rc-input" aria-label={`Tên tuỳ chọn ${i + 1}`} value={r.ten}
              placeholder="vd: Trùng khuôn" onChange={(e) => doiTen(i, e.target.value)} />
          </td>
          <td className="rc-khoan__kieu">
            {/* Hai nấc hiện cả hai — bấm một lần, khỏi xổ menu; chữ nói thợ làm gì ở hộp ghi. */}
            <div className="rc-bands__unit-toggle" role="radiogroup" aria-label={`Kiểu tuỳ chọn ${i + 1}`}>
              {([["co_khong", "Tick ô"], ["so", "Gõ số"]] as const).map(([k, nhan]) => (
                <button key={k} type="button" role="radio" aria-checked={r.kieu === k}
                  className={`rc-bands__unit-btn${r.kieu === k ? " is-active" : ""}`}
                  onClick={() => sua(i, { kieu: k })}>{nhan}</button>
              ))}
            </div>
          </td>
          <td>
            <input className="rc-input" aria-label={`Gợi ý tuỳ chọn ${i + 1}`} value={r.goi_y ?? ""}
              onChange={(e) => sua(i, { goi_y: e.target.value || null })} />
          </td>
        </>
      )}
    />
  );
}

/** Mã bậc mới: `b1`, `b2`… không trùng bậc đang có (người khai không thấy mã). */
export function maBacMoi(bac: BacGiaRow[]): string {
  const dung = new Set(bac.map((b) => b.ma));
  let n = bac.length + 1;
  while (dung.has(`b${n}`)) n++;
  return `b${n}`;
}

/** Tuỳ chọn đổi mã (chưa lưu, sửa tên) hoặc bị xoá ⇒ bậc đang xét tuỳ chọn đó đổi theo / bỏ điều kiện. */
export function doiTuyChonTrongBac(
  bac: BacGiaRow[] | null | undefined, cu: TuyChonKhoanRow[], moi: TuyChonKhoanRow[],
): BacGiaRow[] | null | undefined {
  if (!bac?.length) return bac;
  const doi = new Map(cu.length === moi.length ? cu.map((r, i) => [r.ma, moi[i].ma] as const) : []);
  const con = new Set(moi.filter((t) => t.kieu === "co_khong").map((t) => t.ma));
  return bac.map((b) => {
    if (!b.tuy_chon_ma) return b;
    const ma = doi.get(b.tuy_chon_ma) ?? b.tuy_chon_ma;
    return con.has(ma) ? { ...b, tuy_chon_ma: ma } : { ...b, tuy_chon_ma: null, tuy_chon_co: null };
  });
}

/** Bậc "kén" hơn (đòi tick, đòi màu pha) phải đứng trên bậc thường cùng số màu. */
const doKen = (b: BacGiaRow) => (b.tuy_chon_ma ? 2 : 0) + (b.pha === "co" ? 1 : 0);

/** Bậc giá khai GỌN (22/10/2026): người khai chỉ nói bậc NHẬN gì — Từ/Đến màu, Chỉ khi có pha, Chỉ
 *  khi tick. Máy chủ KHÔNG đổi: vẫn lấy bậc khớp đầu tiên theo khoảng màu / pha / tick
 *  (`viec_khoan.anh_bac`). Màn sắp lại để thứ tự hiện ra đúng thứ tự máy dò:
 *  - xếp theo Đến màu tăng dần, cùng Đến màu thì bậc kén hơn lên trên (bằng nhau giữ thứ tự cũ);
 *  - Từ màu giữ nguyên số người khai (chủ đòi trả lại cột, 22/10);
 *  - bỏ điều kiện "không pha" / "không tick" — bậc kén hơn ở trên đã lấy các lệnh đó trước;
 *  - Giá đã gồm UV = bậc đòi tick: giá riêng của bậc đã tính tuỳ chọn đó, công thức thôi nhân. */
export function chuanHoaBac(bac: BacGiaRow[]): BacGiaRow[] {
  const gon = bac.map((b) => ({
    ...b,
    pha: b.pha === "co" ? ("co" as const) : null,
    tuy_chon_ma: b.tuy_chon_co === "khong" ? null : b.tuy_chon_ma ?? null,
    tuy_chon_co: b.tuy_chon_ma && b.tuy_chon_co !== "khong" ? ("co" as const) : null,
  }));
  const den = (b: BacGiaRow) => (b.mau_den == null ? Infinity : b.mau_den);
  return gon.map((b, i) => ({ b, i }))
    .sort((x, y) => den(x.b) - den(y.b) || doKen(y.b) - doKen(x.b) || x.i - y.i)
    .map(({ b }) => ({ ...b, gom_uv: !!b.tuy_chon_ma }));
}

/** Khối "Bậc giá theo số màu" (Bài in, 22/10/2026), khai gọn — xem `chuanHoaBac`.
 *  Giá từng tổ nằm ngay trên dòng bậc (`cotThem` / `veThem`) — tên bậc chỉ khai một chỗ. */
function BacGia({ value, tuyChon, cotThem, veThem, onThem, onXoa, onChange }: {
  value: BacGiaRow[];
  tuyChon: TuyChonKhoanRow[];
  cotThem: CotThem[];
  veThem: (b: BacGiaRow, i: number) => ReactNode;
  onThem: () => void;
  onXoa: (i: number) => void;
  onChange: (v: BacGiaRow[]) => void;
}) {
  const sua = (i: number, patch: Partial<BacGiaRow>) =>
    onChange(chuanHoaBac(value.map((r, j) => (j === i ? { ...r, ...patch } : r))));
  const coKhong = tuyChon.filter((t) => t.kieu === "co_khong" && t.ma && t.ten.trim());
  return (
    <RowEditor
      khoa="rc-bands--bac-gia"
      rows={value}
      khoaHang={(r) => r.ma}
      cot={["Tên bậc", "Từ màu", "Đến màu", "Chỉ khi có pha", "Chỉ khi tick"]}
      cotThem={cotThem}
      trong="Không chia bậc. Thêm bậc khi giá đổi theo số màu in."
      themNhan="＋ Thêm bậc"
      onThem={onThem}
      onXoa={onXoa}
      xoaTitle="Bỏ bậc này"
      veHang={(r, i) => (
        <>
          <td>
            <input className="rc-input" aria-label={`Tên bậc ${i + 1}`} value={r.ten}
              placeholder="vd: 3–4 màu thường" onChange={(e) => sua(i, { ten: e.target.value })} />
          </td>
          <td>
            <input className="rc-input rc-input--num" aria-label={`Từ màu bậc ${i + 1}`} type="number"
              min={1} step={1} value={hienSo(r.mau_tu)} onChange={(e) => sua(i, { mau_tu: so(e.target.value) })} />
          </td>
          <td>
            <input className="rc-input rc-input--num" aria-label={`Đến màu bậc ${i + 1}`} type="number"
              min={1} step={1} value={hienSo(r.mau_den)} onChange={(e) => sua(i, { mau_den: so(e.target.value) })} />
          </td>
          <td className="rc-khoan__chon">
            <input type="checkbox" aria-label={`Bậc ${i + 1} chỉ khi có pha`} checked={r.pha === "co"}
              onChange={(e) => sua(i, { pha: e.target.checked ? "co" : null })} />
          </td>
          <td>
            <select className="rc-input" aria-label={`Bậc ${i + 1} chỉ khi tick`} value={r.tuy_chon_ma ?? ""}
              onChange={(e) => sua(i, {
                tuy_chon_ma: e.target.value || null, tuy_chon_co: e.target.value ? "co" : null,
              })}>
              <option value="">Không cần</option>
              {coKhong.map((t) => <option key={t.ma} value={t.ma}>{t.ten}</option>)}
            </select>
          </td>
          {veThem(r, i)}
        </>
      )}
    />
  );
}

/** Có chip lượng mà không gọi Đơn giá khoán ⇒ kết quả công thức là tiền nên lượng bị cộng như tiền
 *  đồng. Cùng luật cảnh báo trước chốt (`khoan_ky._luong_thanh_dong`). */
export function luongThanhDong(ct: string | null | undefined): boolean {
  const s = ct ?? "";
  return /\b(sl_ghi|sl_vao|sl_ra|so_luot_chay)\b/.test(s) && !/\bdon_gia_khoan\b/.test(s);
}

/** Đầu khối kiểu lưới: tên + một dòng giải thích cùng hàng. */
function DauKhoi({ ten, goi }: { ten: string; goi: string }) {
  return (
    <div className="rc-khoan__dau">
      <span className="rc-khoan__ten">{ten}</span>
      <span className="rc-khoan__goi">{goi}</span>
    </div>
  );
}

/** Ô số tiền trong lưới: ô nhập không viền + "đ" trong ô. */
function OTien({ nhan, value, placeholder, onChange }: {
  nhan: string; value: number | null | undefined; placeholder?: string; onChange: (v: number | null) => void;
}) {
  return (
    <div className="rc-input-wrapper">
      <input className="rc-input rc-input--num" aria-label={nhan} type="number" min={0} step="any"
        inputMode="decimal" placeholder={placeholder} value={hienSo(value)}
        onChange={(e) => onChange(so(e.target.value))} />
      <span className="rc-input-suffix">đ</span>
    </div>
  );
}

export function KhoanCongDoanField({ value, donViOptions, toPhuTrach = [], tatCaTo = [], onChange }: {
  value: KhoanCongDoanValue | null;
  donViOptions: Row[];
  /** Tổ đang chọn ở ô "Phòng ban / Tổ phụ trách" của chính công đoạn (21/10/2026). */
  toPhuTrach?: ToPhuTrach[];
  /** Mọi phòng ban/tổ — chỉ để gọi đúng tên dòng tổ có giá mà không còn phụ trách. */
  tatCaTo?: ToPhuTrach[];
  onChange: (value: KhoanCongDoanValue) => void;
}) {
  const v = value ?? {};
  const set = (patch: Partial<KhoanCongDoanValue>) => onChange({ ...v, ...patch });
  const ps = v.viec_phat_sinh ?? [];
  // Popup "Cách tính giá" của việc phát sinh đang mở: dòng + ô vừa bấm + công thức lúc mở (cho Huỷ).
  const [moPs, setMoPs] = useState<{ i: number; neo: HTMLElement; banDau: string | null } | null>(null);
  const datCtPs = (i: number, cong_thuc: string | null) =>
    set({ viec_phat_sinh: ps.map((r, j) => (j === i ? { ...r, cong_thuc } : r)) });
  const gtt = v.gia_theo_to ?? [];
  const tc = v.tuy_chon ?? [];
  // Luôn làm việc trên bản ĐÃ chuẩn hoá — thứ tự hiện ra cũng là thứ tự máy dò (xem `chuanHoaBac`).
  const bac = chuanHoaBac(v.bac_gia ?? []);
  const coBac = bac.length > 0;
  // Tổ phụ trách + tổ đã có giá mà nay không còn phụ trách (để người khai thấy và tự xoá).
  const toIds = [...new Set([
    ...toPhuTrach.map((t) => t.id),
    ...gtt.map((g) => g.department_id),
    ...ps.flatMap((r) => (r.gia_theo_to ?? []).map((g) => g.department_id)),
  ])];
  const tenTo = (id: number) => toPhuTrach.find((t) => t.id === id)?.ten;
  const giaTo = (id: number) => gtt.find((g) => g.department_id === id);
  const giaPs = (r: ViecPhatSinhRow, id: number) =>
    (r.gia_theo_to ?? []).find((g) => g.department_id === id)?.don_gia;
  const datGiaTo = (id: number, patch: Partial<GiaTheoToRow>) =>
    set({ gia_theo_to: datGia(gtt, id, patch, (r) => r.gia_co_dinh == null && r.don_gia == null) });
  const datGiaPs = (i: number, id: number, don_gia: number | null) =>
    set({
      viec_phat_sinh: ps.map((r, j) => (j !== i ? r : {
        ...r, gia_theo_to: datGia(r.gia_theo_to, id, { don_gia }, (x) => x.don_gia == null),
      })),
    });
  // Bậc giá: giá là ô (tổ, bậc). Thêm bậc ĐẦU TIÊN thì giá theo tổ đang có thành giá của bậc đó; bỏ
  // bậc CUỐI CÙNG thì giá của nó quay về giá theo tổ thường — khỏi gõ lại.
  const giaBac = (id: number, ma: string) => gtt.find((g) => g.department_id === id && g.bac === ma);
  const datGiaBac = (id: number, ma: string, patch: Partial<GiaTheoToRow>) => {
    const co = giaBac(id, ma);
    const moi = { ...(co ?? { department_id: id, bac: ma }), ...patch };
    const ra = (co ? gtt.map((g) => (g === co ? moi : g)) : [...gtt, moi])
      .filter((g) => g.gia_co_dinh != null || g.don_gia != null);
    set({ gia_theo_to: ra.length ? ra : null });
  };
  const themBac = () => {
    const ma = maBacMoi(bac);
    set({
      bac_gia: chuanHoaBac([...bac, { ma, ten: "", mau_tu: null, mau_den: null, pha: null, tuy_chon_ma: null, tuy_chon_co: null, gom_uv: false }]),
      ...(coBac ? {} : {
        gia_theo_to: gtt.length ? gtt.map((g) => ({ ...g, bac: ma })) : null,
        // Có bậc thì giá chung không dùng — máy chủ vẫn đòi ô đơn giá chung nên điền 0 nếu đang trống.
        unit_price: v.unit_price ?? 0,
      }),
    });
  };
  const xoaBac = (i: number) => {
    const ma = bac[i].ma;
    const con = bac.filter((_, j) => j !== i);
    const gia = con.length
      ? gtt.filter((g) => g.bac !== ma)
      : gtt.filter((g) => g.bac === ma).map(({ bac: _b, ...g }) => g);
    set({ bac_gia: con.length ? con : null, gia_theo_to: gia.length ? gia : null });
  };
  const xoaTo = (id: number) =>
    set({
      gia_theo_to: gtt.filter((g) => g.department_id !== id).length
        ? gtt.filter((g) => g.department_id !== id) : null,
      viec_phat_sinh: ps.map((r) => {
        const con = (r.gia_theo_to ?? []).filter((g) => g.department_id !== id);
        return { ...r, gia_theo_to: con.length ? con : null };
      }),
    });

  const tenHien = (id: number) => tenTo(id) ?? tatCaTo.find((t) => t.id === id)?.ten ?? `Tổ #${id}`;
  // Tổ không còn phụ trách: ở bảng mang nút xoá giá của tổ (bảng bậc khi chia bậc, bảng Giá theo tổ
  // khi không) gọi đủ câu + nút; ở bảng Việc phát sinh chỉ in nghiêng tên — nói một lần là đủ.
  const dauTo = (id: number, coNutXoa: boolean) => {
    const ten = tenTo(id);
    if (ten !== undefined) return ten;
    if (!coNutXoa) return <span className="rc-khoan__mat" title="Không còn phụ trách">{tenHien(id)}</span>;
    return (
      <span className="rc-khoan__mat">
        {tenHien(id)} — không còn phụ trách
        <button type="button" className="rc-bands__del" title="Bỏ giá của tổ này"
          onClick={() => xoaTo(id)}><TrashIcon /></button>
      </span>
    );
  };
  const cotToBac: CotThem[] = toIds.map((id) => ({
    khoa: id, nhan: dauTo(id, true), lop: "rc-khoan__dau-to", con: ["Cố định", "Đơn giá"],
  }));
  const cotToPs: CotThem[] = [
    { khoa: "cach-tinh", nhan: "Cách tính giá", lop: "rc-khoan__cot-ct" },
    ...toIds.map((id) => ({ khoa: id, nhan: dauTo(id, false), lop: "so rc-khoan__cot-to" })),
  ];

  return (
    <div className="rc-khoan">
      {/* Bốn khối khai giá dạng LƯỚI ô liền (phương án C, 22/10/2026); Công thức khoán ở cuối giữ
          khuôn thẻ cũ. Mỗi giá nằm trên đúng dòng của nó (22/10/2026): giá bậc trên dòng bậc, giá
          việc phát sinh trên dòng việc — không còn bảng tổ × bậc / tổ × việc lặp lại tên. */}
      <section className="rc-card-section rc-khoan__section rc-khoan__luoi">
        <DauKhoi ten="Đơn giá" goi={coBac
          ? "Công đoạn chia bậc nên giá khai theo từng bậc ở bảng dưới, không có giá chung."
          : "Giá chung cho mọi tổ, trừ tổ có giá riêng."} />
        <table className="rc-bands__table">
          <thead>
            <tr>
              <th>Đơn vị tính khoán *</th>
              {!coBac && <><th className="so">Giá cố định chung</th><th className="so">Đơn giá chung *</th></>}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="rc-khoan__o-3">
                <RefSearchField
                  value={v.unit || null}
                  options={donViOptions}
                  placeholder="Gõ để tìm đơn vị…"
                  byMa
                  onChange={(unit) => set({ unit: unit == null ? "" : String(unit) })}
                />
              </td>
              {!coBac && (
                <>
                  <td className="rc-khoan__o-3">
                    <OTien nhan="Giá cố định chung" value={v.gia_co_dinh}
                      onChange={(gia_co_dinh) => set({ gia_co_dinh })} />
                  </td>
                  <td className="rc-khoan__o-3">
                    <OTien nhan="Đơn giá khoán" value={v.unit_price}
                      onChange={(unit_price) => set({ unit_price })} />
                  </td>
                </>
              )}
            </tr>
          </tbody>
        </table>
      </section>

      <section className="rc-card-section rc-khoan__section rc-khoan__luoi">
        <DauKhoi ten="Bậc giá theo số màu"
          goi={coBac && toIds.length === 0
            ? "Chọn tổ phụ trách ở tab Thông tin để khai giá từng bậc."
            : "Lúc ghi sản lượng, máy dò từ trên xuống, lệnh hợp dòng nào trước thì ăn giá dòng đó. Bậc tự xếp theo Đến màu, cùng số màu thì dòng đòi tick hay đòi màu pha nằm trên. Số màu là số kẽm của lệnh, như bên Tính giá. Ô giá trống là tổ không chạy bậc này."} />
        <BacGia value={bac} tuyChon={tc} onThem={themBac} onXoa={xoaBac}
          cotThem={coBac ? cotToBac : []}
          veThem={(b, i) => {
            const tenBac = b.ten.trim() || `Bậc ${i + 1}`;
            return toIds.flatMap((id) => {
              const g = giaBac(id, b.ma);
              return [
                <td key={`${id}-cd`}>
                  <OTien nhan={`Giá cố định ${tenHien(id)} bậc ${tenBac}`} value={g?.gia_co_dinh}
                    onChange={(gia_co_dinh) => datGiaBac(id, b.ma, { gia_co_dinh })} />
                </td>,
                <td key={`${id}-dg`}>
                  <OTien nhan={`Đơn giá ${tenHien(id)} bậc ${tenBac}`} value={g?.don_gia}
                    onChange={(don_gia) => datGiaBac(id, b.ma, { don_gia })} />
                </td>,
              ];
            });
          }}
          onChange={(bac_gia) => set({ bac_gia })} />
      </section>

      {!coBac && (
        <section className="rc-card-section rc-khoan__section rc-khoan__luoi">
          <DauKhoi ten="Giá theo tổ" goi={toIds.length === 0
            ? "Chọn tổ phụ trách ở tab Thông tin trước."
            : "Để trống hết thì mọi tổ lấy giá chung. Đã điền cho một tổ thì tổ còn trống là thiếu giá."} />
          {toIds.length > 0 && (
            <div className="rc-bands rc-bands--gia-to">
              <table className="rc-bands__table">
                <thead>
                  <tr>
                    <th>Tổ</th>
                    <th className="so">Giá cố định</th>
                    <th className="so">Đơn giá</th>
                    <th className="rc-khoan__xoa" />
                  </tr>
                </thead>
                <tbody>
                  {toIds.map((id) => {
                    const g = giaTo(id);
                    const mat = tenTo(id) === undefined;
                    return (
                      <tr key={id}>
                        <td className="rc-khoan__to">
                          {mat ? <span className="rc-khoan__mat">{tenHien(id)} — không còn phụ trách</span> : tenTo(id)}
                        </td>
                        <td>
                          <OTien nhan={`Giá cố định ${tenHien(id)}`} value={g?.gia_co_dinh}
                            onChange={(gia_co_dinh) => datGiaTo(id, { gia_co_dinh })} />
                        </td>
                        <td>
                          <OTien nhan={`Đơn giá ${tenHien(id)}`} value={g?.don_gia}
                            onChange={(don_gia) => datGiaTo(id, { don_gia })} />
                        </td>
                        <td className="rc-khoan__xoa">
                          {mat && (
                            <button type="button" className="rc-bands__del" title="Bỏ giá của tổ này"
                              onClick={() => xoaTo(id)}><TrashIcon /></button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="rc-card-section rc-khoan__section rc-khoan__luoi">
        <DauKhoi ten="Tuỳ chọn khi ghi"
          goi="Thợ chọn mỗi lần ghi. Tick ô thì tick là 1, không tick là 0. Gõ số thì bỏ trống là 0." />
        <TuyChonKhiGhi
          value={tc}
          onChange={(tuy_chon) => set({
            tuy_chon, cong_thuc_khoan: doiMaTrongCongThuc(v.cong_thuc_khoan, tc, tuy_chon),
            bac_gia: v.bac_gia ? chuanHoaBac(doiTuyChonTrongBac(v.bac_gia, tc, tuy_chon) ?? []) : v.bac_gia,
          })}
        />
      </section>

      <section className="rc-card-section rc-khoan__section rc-khoan__luoi">
        <DauKhoi ten="Việc phát sinh" goi={toIds.length === 0
          ? "Không cộng vào sản lượng."
          : "Không cộng vào sản lượng. Cột tổ để trống hết thì mọi tổ lấy Đơn giá, đã điền cho một tổ thì tổ còn trống là thiếu giá."} />
        <ViecPhatSinhField
          value={ps}
          donViOptions={donViOptions}
          cotThem={cotToPs}
          veThem={(r, i) => [
            <td key="cach-tinh" className="rc-ct-td">
              {/* Có công thức thì đơn giá ra từ chính lần ghi (vd xuống bài = 50% giá cố định). */}
              <button type="button" title="Sửa cách tính giá của việc phát sinh này"
                className={`rc-ct-cell ${moPs?.i === i ? "is-open" : ""} ${r.cong_thuc ? "" : "is-empty"}`}
                onClick={(e) => setMoPs(moPs?.i === i ? null
                  : { i, neo: e.currentTarget, banDau: r.cong_thuc ?? null })}>{r.cong_thuc || "—"}</button>
            </td>,
            ...toIds.map((id) => (
              <td key={id}>
                <OTien nhan={`${r.ten || `Việc phát sinh ${i + 1}`} ${tenHien(id)}`} value={giaPs(r, id)}
                  onChange={(don_gia) => datGiaPs(i, id, don_gia)} />
              </td>
            )),
          ]}
          onChange={(viec_phat_sinh) => { setMoPs(null); set({ viec_phat_sinh }); }}
        />
        {moPs && ps[moPs.i] && <FormulaPopover neo={moPs.neo} nhan="Cách tính giá"
          onClose={() => setMoPs(null)}
          onHuy={() => { datCtPs(moPs.i, moPs.banDau); setMoPs(null); }}>
          <FormulaField
            id={`ct-ps-${moPs.i}`} configPrefix="/api/cong-doan" loaiO="khoan"
            hien={["don_gia_khoan"]} bienThem={tuyChonThanhBien(tc)}
            nhanO={`Cách tính giá — ${ps[moPs.i].ten || `Việc phát sinh ${moPs.i + 1}`}`}
            goY="Ra ĐƠN GIÁ của việc phát sinh trên lần ghi. Bỏ trống = dùng Đơn giá. vd xuống bài 50% bài in: 0.5 * gia_co_dinh"
            value={ps[moPs.i].cong_thuc ?? ""}
            onChange={(ct) => datCtPs(moPs.i, ct.trim() ? ct : null)} />
        </FormulaPopover>}
      </section>

      <section className="rc-card-section rc-khoan__section">
        <div className="rc-card-section__title">Công thức khoán</div>
        <p className="rc-khoan__note">
          Tính trên TỪNG lần ghi sản lượng, giá lấy theo tổ của lần ghi. Kết quả công thức là tiền
          của lần ghi, máy không nhân thêm gì. Bỏ trống thì lần ghi không có tiền (0 đ).
        </p>
        <FormulaField
          value={v.cong_thuc_khoan ?? ""}
          onChange={(cong_thuc_khoan) => set({ cong_thuc_khoan })}
          configPrefix="/api/cong-doan"
          loaiO="khoan"
          hien={["don_gia_khoan"]}
          bienThem={tuyChonThanhBien(tc)}
          id="formula-cong-thuc-khoan"
          nhanO="Công thức khoán"
          goY="vd: gia_co_dinh + max(0, sl_ghi - 3000) * don_gia_khoan"
        />
        {luongThanhDong(v.cong_thuc_khoan) && (
          <p className="rc-khoan__note rc-khoan__note--nhac" role="status">
            Công thức có sản lượng mà không nhân Đơn giá khoán — sản lượng đang cộng như tiền đồng
            (1 tờ = 1 đ). Nhân sản lượng với chip Đơn giá khoán nếu cần.
          </p>
        )}
      </section>
    </div>
  );
}
