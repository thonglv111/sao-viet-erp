/** Hàng "Cước chờ chi" (08/11/2026, chỉ bản cài bật `giao_hang_hp`, docs/design-giao-hang-ha-phuong.md):
 *  lần xuất hàng thuê đơn vị vận chuyển có tiền cước chưa chi. Mỗi lần xuất một dòng, xếp theo đơn vị
 *  vận chuyển. Tick nhiều dòng CÙNG đơn vị để lập một phiếu chi; chi đủ thì dòng rời hàng, huỷ phiếu chi
 *  thì quay lại. Cùng khuôn với hàng "Chờ chi CK / kê". */
import { useState } from "react";

import type { CuocChoChi } from "../../../../api/giaoHangHp";
import { CuonLuoi, rongLuoi, type CauHinhLuoi, type CotLuoi } from "../../../../components/LuoiDs";
import { ngay, tien, vietSo } from "../../shared/dinhDang";

export const COT_CUOC_GIAO: (CotLuoi & { w?: number; n?: boolean })[] = [
  { key: "chon", label: "Chọn", coDinh: true, w: 40 },
  { key: "dvvc", label: "Đơn vị vận chuyển", coDinh: true, w: 220 },
  { key: "lan", label: "Lần xuất", w: 150 },
  { key: "ngay", label: "Ngày xuất", w: 110 },
  { key: "don", label: "Đơn hàng", w: 140 },
  { key: "khach", label: "Khách hàng", w: 200 },
  { key: "van_don", label: "Mã vận đơn", w: 130 },
  { key: "cuoc", label: "Tiền cước", n: true, w: 120 },
  { key: "da_chi", label: "Đã chi", n: true, w: 110 },
  { key: "con", label: "Còn phải chi", n: true, w: 130 },
  { key: "nut", label: "Thao tác", coDinh: true, w: 140 },
];

const khoa = (r: CuocChoChi) => r.phuong_thuc_giao_hp_id;

export function HangChoCuocGiao({
  rows,
  loi,
  onLap,
  onMoDon,
  luoi,
}: {
  rows: CuocChoChi[] | null;
  loi: string | null;
  /** Không có = không có quyền lập phiếu chi ⇒ không có ô tick, không nút. */
  onLap?: (dong: CuocChoChi[]) => void;
  onMoDon?: (orderId: number) => void;
  luoi?: CauHinhLuoi;
}) {
  const goc = COT_CUOC_GIAO.filter((c) => (c.key !== "chon" && c.key !== "nut") || !!onLap);
  const cot = luoi ? luoi.rongHien(luoi.xep(goc).filter((c) => !luoi.an.has(c.key))) : goc;
  const [chon, setChon] = useState<Set<number>>(new Set());
  const daChon = (rows ?? []).filter((r) => chon.has(khoa(r)));
  const dvvcChon = daChon.length ? daChon[0].don_vi_vc_id : null;
  const tongChon = daChon.reduce((s, r) => s + r.con, 0);
  const tick = (r: CuocChoChi) =>
    setChon((cu) => {
      const moi = new Set(cu);
      if (moi.has(khoa(r))) moi.delete(khoa(r));
      else moi.add(khoa(r));
      return moi;
    });

  function o(key: string, r: CuocChoChi) {
    switch (key) {
      case "chon": {
        const khac = dvvcChon != null && r.don_vi_vc_id !== dvvcChon;
        return (
          <td key={key} className="kt-gop-tick">
            <label title={khac ? "Khác đơn vị vận chuyển" : undefined}>
              <input type="checkbox" aria-label={`Chọn cước lần xuất ${r.ma_lan_xuat ?? r.phuong_thuc_giao_hp_id}`}
                checked={chon.has(khoa(r))} disabled={khac} onChange={() => tick(r)} />
            </label>
          </td>
        );
      }
      case "dvvc":
        return <td key={key} title={r.don_vi_vc_ten ?? undefined}>{r.don_vi_vc_ten ?? ""}</td>;
      case "lan":
        return <td key={key}>{r.ma_lan_xuat ?? ""}</td>;
      case "ngay":
        return <td key={key}>{ngay(r.created_at)}</td>;
      case "don":
        return (
          <td key={key}>
            {onMoDon ? (
              <button type="button" className="lds-lk" onClick={() => onMoDon(r.order_id)}>{r.order_no}</button>
            ) : r.order_no}
          </td>
        );
      case "khach":
        return <td key={key} title={r.customer_name ?? undefined}>{r.customer_name ?? ""}</td>;
      case "van_don":
        return <td key={key}>{r.ma_van_don ?? ""}</td>;
      case "cuoc":
        return <td key={key} className="n">{tien(r.tien_cuoc)}</td>;
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
          Lần xuất hàng thuê đơn vị vận chuyển còn tiền cước chưa chi. Chi đủ thì dòng rời khỏi danh sách này.
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
                    <span className="lds-do" role="alert">{`Không tải được hàng cước chờ chi. ${loi}`}</span>
                  </td>
                </tr>
              ) : rows == null ? (
                <tr><td colSpan={cot.length} className="lds-trong">Đang tải…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={cot.length} className="lds-trong">Không còn tiền cước nào chờ chi.</td></tr>
              ) : (
                rows.map((r) => <tr key={khoa(r)} className="lds-dong">{cot.map((c) => o(c.key, r))}</tr>)
              )}
            </tbody>
          </table>
        </CuonLuoi>
      </div>
      {onLap && daChon.length > 0 && (
        <div className="kt-gop-chan" role="region" aria-label="Khoản đã chọn">
          <span>{`Đã chọn ${vietSo(daChon.length)} lần giao của ${daChon[0].don_vi_vc_ten ?? ""}`}</span>
          <span className="kt-gop-chan__tong">{tien(tongChon)}</span>
          <button type="button" className="kt-btn kt-btn--tron" onClick={() => setChon(new Set())}>Bỏ chọn</button>
          <button type="button" className="kt-btn kt-btn--chinh" onClick={() => onLap(daChon)}>Lập một phiếu chi</button>
        </div>
      )}
    </>
  );
}
