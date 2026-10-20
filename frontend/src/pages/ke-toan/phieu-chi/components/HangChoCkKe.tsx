/** Hàng "Chờ chi CK / kê" (20/10/2026): hóa đơn bán đã thu đủ mà chiết khấu hoặc kê của nó chưa chi lại
 *  khách. Mỗi (hóa đơn, loại) một dòng. Tick nhiều dòng CÙNG khách CÙNG loại để lập một phiếu chi; chi đủ
 *  thì dòng rời hàng, huỷ phiếu chi thì quay lại. */
import { useState } from "react";

import type { CkKeChoChi } from "../../../../api/client";
import { CuonLuoi, rongLuoi, type CauHinhLuoi, type CotLuoi } from "../../../../components/LuoiDs";
import { ngay, tien, vietSo } from "../../shared/dinhDang";

export const TEN_LOAI_CK_KE: Record<CkKeChoChi["loai"], string> = { chiet_khau: "Chiết khấu", ke_gia: "Kê" };

export const COT_CK_KE: (CotLuoi & { w?: number; n?: boolean })[] = [
  { key: "chon", label: "Chọn", coDinh: true, w: 40 },
  { key: "khach", label: "Khách hàng", coDinh: true, w: 220 },
  { key: "loai", label: "Khoản chi", w: 110 },
  { key: "hoa_don", label: "Hóa đơn", w: 130 },
  { key: "ngay", label: "Ngày hóa đơn", w: 120 },
  { key: "don", label: "Đơn hàng", w: 140 },
  { key: "tien", label: "Tiền CK / kê", n: true, w: 140 },
  { key: "thue", label: "Thuế TNDN trên kê", n: true, w: 150 },
  { key: "da_chi", label: "Đã chi", n: true, w: 130 },
  { key: "con", label: "Còn phải chi", n: true, w: 140 },
  { key: "nut", label: "Thao tác", coDinh: true, w: 140 },
];

const khoa = (r: CkKeChoChi) => `${r.sales_invoice_id}:${r.loai}`;
const nhom = (r: CkKeChoChi) => `${r.customer_id ?? r.customer_name}:${r.loai}`;

export function HangChoCkKe({
  rows,
  loi,
  onLap,
  onMoDon,
  luoi,
}: {
  rows: CkKeChoChi[] | null;
  loi: string | null;
  /** Không có = không có quyền lập phiếu chi ⇒ không có ô tick, không nút. */
  onLap?: (dong: CkKeChoChi[]) => void;
  onMoDon?: (orderId: number) => void;
  luoi?: CauHinhLuoi;
}) {
  const goc = COT_CK_KE.filter((c) => (c.key !== "chon" && c.key !== "nut") || !!onLap);
  const cot = luoi ? luoi.rongHien(luoi.xep(goc).filter((c) => !luoi.an.has(c.key))) : goc;
  // Dòng đã tick — chỉ giữ dòng còn trong hàng (chi đủ / nạp lại thì tự rơi khỏi lựa chọn).
  const [chon, setChon] = useState<Set<string>>(new Set());
  const daChon = (rows ?? []).filter((r) => chon.has(khoa(r)));
  const nhomChon = daChon.length ? nhom(daChon[0]) : null;
  const tongChon = daChon.reduce((s, r) => s + r.con, 0);
  const tick = (r: CkKeChoChi) =>
    setChon((cu) => {
      const moi = new Set(cu);
      if (moi.has(khoa(r))) moi.delete(khoa(r));
      else moi.add(khoa(r));
      return moi;
    });

  function o(key: string, r: CkKeChoChi) {
    switch (key) {
      case "chon": {
        const khac = nhomChon != null && nhom(r) !== nhomChon;
        return (
          <td key={key} className="kt-gop-tick">
            <label title={khac ? "Khác khách hoặc khác khoản chi" : undefined}>
              <input type="checkbox" aria-label={`Chọn ${TEN_LOAI_CK_KE[r.loai]} hóa đơn ${r.invoice_number}`}
                checked={chon.has(khoa(r))} disabled={khac} onChange={() => tick(r)} />
            </label>
          </td>
        );
      }
      case "khach":
        return <td key={key} title={r.customer_name}>{r.customer_name}</td>;
      case "loai":
        return <td key={key}><span className="lds-tag">{TEN_LOAI_CK_KE[r.loai]}</span></td>;
      case "hoa_don":
        return <td key={key}>{r.invoice_number}</td>;
      case "ngay":
        return <td key={key}>{ngay(r.invoice_date)}</td>;
      case "don":
        return (
          <td key={key}>
            {onMoDon ? (
              <button type="button" className="lds-lk" onClick={() => onMoDon(r.order_id)}>{r.order_code}</button>
            ) : r.order_code}
          </td>
        );
      case "tien":
        return <td key={key} className="n">{tien(r.tien)}</td>;
      case "thue":
        return <td key={key} className="n">{r.thue_tndn > 0 ? tien(r.thue_tndn) : ""}</td>;
      case "da_chi":
        return <td key={key} className="n">{r.da_chi > 0 ? tien(r.da_chi) : ""}</td>;
      case "con":
        return <td key={key} className="n">{tien(r.con)}</td>;
      case "nut":
        return (
          <td key={key} className="lds-nut">
            {onLap && (
              <button type="button" className="kt-btn kt-btn--nho" onClick={() => onLap([r])}>Lập phiếu chi</button>
            )}
          </td>
        );
      default:
        return <td key={key} />;
    }
  }

  // Dải chân nằm NGOÀI `lds-sheet`: khung đó `overflow:hidden` làm `position:sticky` mất tác dụng.
  return (
    <>
      <div className="lds-sheet">
        <p className="kt-gc-ghi">
          Hóa đơn đã thu đủ còn chiết khấu hoặc kê chưa chi lại khách. Số chi tính trước VAT; kê đã trừ thuế TNDN.
          Chi đủ thì dòng rời khỏi danh sách này.
        </p>
        <CuonLuoi ghim={luoi?.soGhim(cot)}>
          <table className="lds-g" style={{ minWidth: rongLuoi(cot) }}>
            <colgroup>
              {cot.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
            </colgroup>
            <thead>
              <tr>
                {cot.map((c) => (
                  <th key={c.key} className={c.n ? "n" : undefined}
                    aria-label={c.key === "nut" ? "Thao tác" : c.key === "chon" ? "Chọn" : undefined}>
                    {c.key === "nut" || c.key === "chon" ? null : c.label}
                    {luoi?.keo(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loi ? (
                <tr>
                  <td colSpan={cot.length} className="lds-trong">
                    <span className="lds-do" role="alert">{`Không tải được hàng chờ chi chiết khấu / kê. ${loi}`}</span>
                  </td>
                </tr>
              ) : rows == null ? (
                <tr><td colSpan={cot.length} className="lds-trong">Đang tải…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={cot.length} className="lds-trong">Không còn khoản chiết khấu / kê nào chờ chi.</td></tr>
              ) : (
                rows.map((r) => <tr key={khoa(r)} className="lds-dong">{cot.map((c) => o(c.key, r))}</tr>)
              )}
            </tbody>
          </table>
        </CuonLuoi>
      </div>
      {onLap && daChon.length > 0 && (
        <div className="kt-gop-chan" role="region" aria-label="Khoản đã chọn">
          <span>{`Đã chọn ${vietSo(daChon.length)} khoản ${TEN_LOAI_CK_KE[daChon[0].loai].toLowerCase()} của ${daChon[0].customer_name}`}</span>
          <span className="kt-gop-chan__tong">{tien(tongChon)}</span>
          <button type="button" className="kt-btn kt-btn--tron" onClick={() => setChon(new Set())}>Bỏ chọn</button>
          <button type="button" className="kt-btn kt-btn--chinh" onClick={() => onLap(daChon)}>Lập một phiếu chi</button>
        </div>
      )}
    </>
  );
}
