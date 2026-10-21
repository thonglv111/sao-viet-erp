import type { GiaTheoToRow, KhoanCongDoanValue, Row, ViecPhatSinhRow } from "../types";
import { FormulaField } from "./FormulaField";
import { RefSearchField } from "./RefFields";
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

export function KhoanCongDoanField({ value, donViOptions, toPhuTrach = [], onChange }: {
  value: KhoanCongDoanValue | null;
  donViOptions: Row[];
  /** Tổ đang chọn ở ô "Phòng ban / Tổ phụ trách" của chính công đoạn (21/10/2026). */
  toPhuTrach?: ToPhuTrach[];
  onChange: (value: KhoanCongDoanValue) => void;
}) {
  const v = value ?? {};
  const set = (patch: Partial<KhoanCongDoanValue>) => onChange({ ...v, ...patch });
  const ps = v.viec_phat_sinh ?? [];
  const gtt = v.gia_theo_to ?? [];
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
      <section className="rc-card-section rc-khoan__section">
        <div className="rc-card-section__title">Đơn giá</div>
        <div className="rc-grid rc-khoan__price-grid">
          <label className="rc-field">
            <span className="rc-field__label">Đơn vị tính khoán *</span>
            <RefSearchField
              value={v.unit || null}
              options={donViOptions}
              placeholder="Gõ để tìm đơn vị…"
              byMa
              onChange={(unit) => set({ unit: unit == null ? "" : String(unit) })}
            />
          </label>
          <label className="rc-field">
            <span className="rc-field__label">Đơn giá chung *</span>
            <div className="rc-input-wrapper">
              <input
                className="rc-input rc-input--num"
                aria-label="Đơn giá khoán"
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={hienSo(v.unit_price)}
                onChange={(e) => set({ unit_price: so(e.target.value) })}
              />
              <span className="rc-input-suffix">đ</span>
            </div>
          </label>
        </div>
      </section>

      <section className="rc-card-section rc-khoan__section">
        <div className="rc-card-section__title">Giá theo tổ</div>
        <p className="rc-khoan__note">
          Bỏ trống cả bảng thì mọi tổ dùng đơn giá chung (giá cố định 0). Đã điền tổ nào thì tổ
          không điền là thiếu giá — lần ghi của tổ đó chưa ra tiền khoán. Cột việc phát sinh cũng
          vậy: bỏ trống cả cột thì mọi tổ dùng đơn giá chung của việc, đã điền tổ nào thì tổ để trống
          là thiếu giá.
        </p>
        {toIds.length === 0 ? (
          <p className="rc-khoan__note">Chọn tổ phụ trách ở tab Thông tin trước.</p>
        ) : (
          <div className="rc-bands rc-bands--gia-to">
            <table className="rc-bands__table">
              <thead>
                <tr>
                  <th>Tổ</th>
                  <th>Giá cố định</th>
                  <th>Đơn giá</th>
                  {ps.map((r, i) => <th key={i}>{r.ten || `Việc phát sinh ${i + 1}`}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {toIds.map((id) => {
                  const g = giaTo(id);
                  const ten = tenTo(id);
                  return (
                    <tr key={id}>
                      <td>{ten ?? <span className="rc-khoan__mat">Tổ #{id} — không còn phụ trách</span>}</td>
                      <td>
                        <div className="rc-input-wrapper">
                          <input
                            className="rc-input rc-input--num"
                            aria-label={`Giá cố định ${ten ?? id}`}
                            type="number" min={0} step="any" inputMode="decimal"
                            value={hienSo(g?.gia_co_dinh)}
                            onChange={(e) => datGiaTo(id, { gia_co_dinh: so(e.target.value) })}
                          />
                          <span className="rc-input-suffix">đ</span>
                        </div>
                      </td>
                      <td>
                        <div className="rc-input-wrapper">
                          <input
                            className="rc-input rc-input--num"
                            aria-label={`Đơn giá ${ten ?? id}`}
                            type="number" min={0} step="any" inputMode="decimal"
                            value={hienSo(g?.don_gia)}
                            onChange={(e) => datGiaTo(id, { don_gia: so(e.target.value) })}
                          />
                          <span className="rc-input-suffix">đ</span>
                        </div>
                      </td>
                      {ps.map((r, i) => (
                        <td key={i}>
                          <div className="rc-input-wrapper">
                            <input
                              className="rc-input rc-input--num"
                              aria-label={`${r.ten || `Việc phát sinh ${i + 1}`} ${ten ?? id}`}
                              type="number" min={0} step="any" inputMode="decimal"
                              placeholder={r.don_gia == null || (r.gia_theo_to ?? []).length ? "" : String(r.don_gia)}
                              value={hienSo(giaPs(r, id))}
                              onChange={(e) => datGiaPs(i, id, so(e.target.value))}
                            />
                            <span className="rc-input-suffix">đ</span>
                          </div>
                        </td>
                      ))}
                      <td>
                        {ten === undefined && (
                          <button type="button" className="rc-bands__del" title="Bỏ giá của tổ này"
                            onClick={() => xoaTo(id)}>×</button>
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

      <section className="rc-card-section rc-khoan__section">
        <div className="rc-card-section__title">Công thức khoán</div>
        <p className="rc-khoan__note">
          Tính trên TỪNG lần ghi sản lượng, giá lấy theo tổ của lần ghi. Bỏ trống thì tiền = giá cố
          định + số tốt × đơn giá. Có chip Đơn giá khoán thì công thức ra thẳng tiền, không có thì ra
          lượng và máy nhân đơn giá.
        </p>
        <FormulaField
          value={v.cong_thuc_khoan ?? ""}
          onChange={(cong_thuc_khoan) => set({ cong_thuc_khoan })}
          configPrefix="/api/cong-doan"
          loaiO="khoan"
          hien={["don_gia_khoan"]}
          id="formula-cong-thuc-khoan"
          nhanO="Công thức khoán"
          goY="vd: gia_co_dinh + max(0, sl_ghi - 3000) * don_gia_khoan"
        />
      </section>

      <section className="rc-card-section rc-khoan__section">
        <div className="rc-card-section__title">Việc phát sinh</div>
        <ViecPhatSinhField
          value={ps}
          donViOptions={donViOptions}
          onChange={(viec_phat_sinh) => set({ viec_phat_sinh })}
        />
      </section>
    </div>
  );
}
