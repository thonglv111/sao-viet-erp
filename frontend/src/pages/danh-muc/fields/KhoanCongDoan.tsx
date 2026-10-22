import { useState } from "react";

import { useBienCongThuc, type BienCongThuc } from "../bienCongThuc";
import { TrashIcon } from "../icons";
import type { BacGiaRow, GiaTheoToRow, KhoanCongDoanValue, Row, TuyChonKhoanRow, ViecPhatSinhRow } from "../types";
import { FormulaField } from "./FormulaField";
import { RefSearchField } from "./RefFields";
import { RowEditor } from "./RowEditor";
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
      cot={["Tên hiện cho thợ", "Kiểu", "Gợi ý cho thợ"]}
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
          <td>
            <select className="rc-input" aria-label={`Kiểu tuỳ chọn ${i + 1}`} value={r.kieu}
              onChange={(e) => sua(i, { kieu: e.target.value as TuyChonKhoanRow["kieu"] })}>
              <option value="co_khong">Có / không</option>
              <option value="so">Số</option>
            </select>
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

/** Khối "Bậc giá theo số màu" (Bài in, 22/10/2026). Ô Tuỳ chọn gộp tuỳ chọn + Có/Không làm một. */
function BacGia({ value, tuyChon, onThem, onXoa, onChange }: {
  value: BacGiaRow[];
  tuyChon: TuyChonKhoanRow[];
  onThem: () => void;
  onXoa: (i: number) => void;
  onChange: (v: BacGiaRow[]) => void;
}) {
  const sua = (i: number, patch: Partial<BacGiaRow>) =>
    onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const coKhong = tuyChon.filter((t) => t.kieu === "co_khong" && t.ma && t.ten.trim());
  return (
    <RowEditor
      khoa="rc-bands--bac-gia"
      rows={value}
      cot={["Tên bậc", "Màu từ", "Màu đến", "Màu pha", "Tuỳ chọn khi ghi", "Giá đã gồm UV"]}
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
            <input className="rc-input rc-input--num" aria-label={`Màu từ bậc ${i + 1}`} type="number"
              min={0} step={1} value={hienSo(r.mau_tu)} onChange={(e) => sua(i, { mau_tu: so(e.target.value) })} />
          </td>
          <td>
            <input className="rc-input rc-input--num" aria-label={`Màu đến bậc ${i + 1}`} type="number"
              min={0} step={1} value={hienSo(r.mau_den)} onChange={(e) => sua(i, { mau_den: so(e.target.value) })} />
          </td>
          <td>
            <select className="rc-input" aria-label={`Màu pha bậc ${i + 1}`} value={r.pha ?? ""}
              onChange={(e) => sua(i, { pha: (e.target.value || null) as BacGiaRow["pha"] })}>
              <option value="">Không xét</option>
              <option value="co">Có màu pha</option>
              <option value="khong">Không màu pha</option>
            </select>
          </td>
          <td>
            <select className="rc-input" aria-label={`Tuỳ chọn bậc ${i + 1}`}
              value={r.tuy_chon_ma ? `${r.tuy_chon_ma}:${r.tuy_chon_co ?? "co"}` : ""}
              onChange={(e) => {
                const [ma, co] = e.target.value.split(":");
                sua(i, { tuy_chon_ma: ma || null, tuy_chon_co: ma ? (co as "co" | "khong") : null });
              }}>
              <option value="">Không xét</option>
              {coKhong.flatMap((t) => [
                <option key={`${t.ma}:co`} value={`${t.ma}:co`}>{t.ten} có tick</option>,
                <option key={`${t.ma}:khong`} value={`${t.ma}:khong`}>{t.ten} không tick</option>,
              ])}
            </select>
          </td>
          <td className="rc-khoan__chon">
            <input type="checkbox" aria-label={`Giá bậc ${i + 1} đã gồm UV`} checked={!!r.gom_uv}
              onChange={(e) => sua(i, { gom_uv: e.target.checked })} />
          </td>
        </>
      )}
    />
  );
}

/** Có chip tiền (Giá cố định / Tiền giờ) + chip lượng mà không gọi Đơn giá khoán ⇒ máy thôi nhân đơn
 *  giá nên lượng bị cộng như tiền đồng. Cùng luật cảnh báo trước chốt (`khoan_ky._luong_thanh_dong`). */
export function luongThanhDong(ct: string | null | undefined): boolean {
  const s = ct ?? "";
  return /\b(gia_co_dinh|tien_gio)\b/.test(s) && /\b(sl_ghi|sl_vao|sl_ra|so_luot_chay)\b/.test(s)
    && !/\bdon_gia_khoan\b/.test(s);
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
  const gtt = v.gia_theo_to ?? [];
  const tc = v.tuy_chon ?? [];
  const bac = v.bac_gia ?? [];
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
      bac_gia: [...bac, { ma, ten: "", mau_tu: null, mau_den: null, pha: null, tuy_chon_ma: null, tuy_chon_co: null, gom_uv: false }],
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

  return (
    <div className="rc-khoan">
      {/* Bốn khối khai giá dạng LƯỚI ô liền (phương án C, 22/10/2026); Công thức khoán ở cuối giữ
          khuôn thẻ cũ. */}
      <section className="rc-card-section rc-khoan__section rc-khoan__luoi">
        <DauKhoi ten="Đơn giá" goi={coBac
          ? "Công đoạn chia bậc nên giá lấy theo bậc ở bảng Giá theo tổ, không có giá chung."
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
          goi="Số màu tính như bên Tính giá, bằng số kẽm của lệnh. Bậc đầu tiên khớp được dùng, ô Không xét thì bỏ qua điều kiện đó." />
        <BacGia value={bac} tuyChon={tc} onThem={themBac} onXoa={xoaBac}
          onChange={(bac_gia) => set({ bac_gia })} />
      </section>

      <section className="rc-card-section rc-khoan__section rc-khoan__luoi">
        <DauKhoi ten="Giá theo tổ" goi={toIds.length === 0
          ? "Chọn tổ phụ trách ở tab Thông tin trước."
          : coBac
            ? "Mỗi ô là giá cố định và đơn giá của tổ ở bậc đó. Ô trống là tổ không chạy bậc này, ghi vào là thiếu giá."
            : "Ô xám là giá chung. Đã điền cho một tổ thì tổ còn trống là thiếu giá. Mỗi cột việc phát sinh tính riêng."} />
        {toIds.length > 0 && coBac && (
          <div className="rc-bands rc-bands--gia-to rc-bands--gia-bac">
            <table className="rc-bands__table">
              <thead>
                <tr>
                  <th rowSpan={2}>Bậc</th>
                  {toIds.map((id) => {
                    const ten = tenTo(id);
                    const tenHien = ten ?? tatCaTo.find((t) => t.id === id)?.ten ?? `Tổ #${id}`;
                    return (
                      <th key={id} colSpan={2} className="rc-khoan__dau-to">
                        {ten === undefined ? (
                          <span className="rc-khoan__mat">
                            {tenHien} — không còn phụ trách
                            <button type="button" className="rc-bands__del" title="Bỏ giá của tổ này"
                              onClick={() => xoaTo(id)}><TrashIcon /></button>
                          </span>
                        ) : ten}
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  {toIds.flatMap((id) => [
                    <th key={`${id}-cd`} className="so">Cố định</th>,
                    <th key={`${id}-dg`} className="so">Đơn giá</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {bac.map((b, i) => {
                  const tenBac = b.ten.trim() || `Bậc ${i + 1}`;
                  return (
                    <tr key={b.ma}>
                      <td className="rc-khoan__to">{tenBac}</td>
                      {toIds.flatMap((id) => {
                        const g = giaBac(id, b.ma);
                        const tenTo_ = tenTo(id) ?? tatCaTo.find((t) => t.id === id)?.ten ?? `Tổ #${id}`;
                        return [
                          <td key={`${id}-cd`}>
                            <OTien nhan={`Giá cố định ${tenTo_} bậc ${tenBac}`} value={g?.gia_co_dinh}
                              onChange={(gia_co_dinh) => datGiaBac(id, b.ma, { gia_co_dinh })} />
                          </td>,
                          <td key={`${id}-dg`}>
                            <OTien nhan={`Đơn giá ${tenTo_} bậc ${tenBac}`} value={g?.don_gia}
                              onChange={(don_gia) => datGiaBac(id, b.ma, { don_gia })} />
                          </td>,
                        ];
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {toIds.length > 0 && (!coBac || ps.length > 0) && (
          <div className="rc-bands rc-bands--gia-to">
            <table className="rc-bands__table">
              <thead>
                <tr>
                  <th>Tổ</th>
                  {!coBac && <><th className="so">Giá cố định</th><th className="so">Đơn giá</th></>}
                  {ps.map((r, i) => <th key={i} className="so">{r.ten || `Việc phát sinh ${i + 1}`}</th>)}
                  <th className="rc-khoan__xoa" />
                </tr>
              </thead>
              <tbody>
                {toIds.map((id) => {
                  const g = giaTo(id);
                  const ten = tenTo(id);
                  // Dòng tổ không còn phụ trách: chỉ để xoá, không bày giá chung mờ kẻo trông như giá đã khai.
                  const mat = ten === undefined;
                  const tenHien = ten ?? tatCaTo.find((t) => t.id === id)?.ten ?? `Tổ #${id}`;
                  return (
                    <tr key={id}>
                      <td className="rc-khoan__to">
                        {mat ? <span className="rc-khoan__mat">{tenHien} — không còn phụ trách</span> : ten}
                      </td>
                      {!coBac && (
                        <>
                          <td>
                            <OTien nhan={`Giá cố định ${tenHien}`} value={g?.gia_co_dinh}
                              placeholder={mat || gtt.length ? "" : hienSo(v.gia_co_dinh)}
                              onChange={(gia_co_dinh) => datGiaTo(id, { gia_co_dinh })} />
                          </td>
                          <td>
                            <OTien nhan={`Đơn giá ${tenHien}`} value={g?.don_gia}
                              placeholder={mat || gtt.length ? "" : hienSo(v.unit_price)}
                              onChange={(don_gia) => datGiaTo(id, { don_gia })} />
                          </td>
                        </>
                      )}
                      {ps.map((r, i) => (
                        <td key={i}>
                          <OTien nhan={`${r.ten || `Việc phát sinh ${i + 1}`} ${tenHien}`} value={giaPs(r, id)}
                            placeholder={mat || r.don_gia == null || (r.gia_theo_to ?? []).length ? "" : String(r.don_gia)}
                            onChange={(don_gia) => datGiaPs(i, id, don_gia)} />
                        </td>
                      ))}
                      <td className="rc-khoan__xoa">
                        {mat && !coBac && (
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

      <section className="rc-card-section rc-khoan__section rc-khoan__luoi">
        <DauKhoi ten="Tuỳ chọn khi ghi"
          goi="Thợ tick hoặc gõ số mỗi lần ghi. Có / không là 1 hoặc 0, bỏ trống là 0." />
        <TuyChonKhiGhi
          value={tc}
          onChange={(tuy_chon) => set({
            tuy_chon, cong_thuc_khoan: doiMaTrongCongThuc(v.cong_thuc_khoan, tc, tuy_chon),
            bac_gia: doiTuyChonTrongBac(v.bac_gia, tc, tuy_chon),
          })}
        />
      </section>

      <section className="rc-card-section rc-khoan__section rc-khoan__luoi">
        <DauKhoi ten="Việc phát sinh" goi="Không cộng vào sản lượng. Mỗi việc thành một cột ở Giá theo tổ." />
        <ViecPhatSinhField
          value={ps}
          donViOptions={donViOptions}
          onChange={(viec_phat_sinh) => set({ viec_phat_sinh })}
        />
      </section>

      <section className="rc-card-section rc-khoan__section">
        <div className="rc-card-section__title">Công thức khoán</div>
        <p className="rc-khoan__note">
          Tính trên TỪNG lần ghi sản lượng, giá lấy theo tổ của lần ghi. Bỏ trống thì tiền = giá cố
          định + số lượng × đơn giá. Có chip Đơn giá khoán, Giá cố định hoặc Tiền giờ thì công thức ra
          thẳng tiền, không có thì ra lượng và máy nhân đơn giá.
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
            Công thức có chip Giá cố định hoặc Tiền giờ nên máy không tự nhân đơn giá — sản lượng đang
            cộng như tiền đồng (1 tờ = 1 đ). Nhân sản lượng với chip Đơn giá khoán nếu cần.
          </p>
        )}
      </section>
    </div>
  );
}
