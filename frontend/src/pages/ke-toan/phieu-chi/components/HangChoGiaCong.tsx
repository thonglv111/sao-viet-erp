/** Hàng "Gia công chờ chi" (spec Thuê gia công 2026-11-13 §4.6): mỗi PHIẾU NHẬN chưa có phiếu chi còn
 *  hiệu lực là một dòng, kèm số đạt / hỏng / hụt cạnh tiền tạm tính. Tick nhiều phiếu nhận CÙNG nhà gia
 *  công để lập một phiếu chi; huỷ phiếu chi thì phiếu nhận quay lại. Khuôn lưới chung `lds-g`. */
import { useState } from "react";

import type { TgcChoTraTien } from "../../../../api/thueGiaCong";
import { CuonLuoi, rongLuoi, type CauHinhLuoi, type CotLuoi } from "../../../../components/LuoiDs";
import { ngay, tien, vietSo } from "../../shared/dinhDang";
import { congDong, motDonVi, soDv, tongTamTinh } from "../shared/giaCong";

export const COT_GIA_CONG: (CotLuoi & { w?: number; n?: boolean })[] = [
  { key: "chon", label: "Chọn", coDinh: true, w: 40 },
  { key: "nha", label: "Nhà gia công", coDinh: true, w: 220 },
  { key: "phieu", label: "Phiếu nhận", w: 110 },
  { key: "nguon", label: "Lệnh", w: 160 },
  { key: "viec", label: "Việc", w: 220 },
  { key: "dat", label: "Đạt", n: true, w: 120 },
  { key: "hong", label: "Hỏng / hụt", n: true, w: 110 },
  { key: "tam_tinh", label: "Tạm tính", n: true, w: 130 },
  { key: "nhan", label: "Nhận lúc", w: 180 },
  { key: "nut", label: "Thao tác", coDinh: true, w: 140 },
];

export function HangChoGiaCong({
  rows,
  loi,
  onLap,
  luoi,
  onMoLenh,
}: {
  rows: TgcChoTraTien[] | null;
  loi: string | null;
  /** Không có = không có quyền lập phiếu chi ⇒ không có ô tick, không nút. */
  onLap?: (rows: TgcChoTraTien[]) => void;
  luoi?: CauHinhLuoi;
  /** Mở lệnh nguồn. Không có = người xem không vào được màn lệnh. */
  onMoLenh?: (lsxId: number) => void;
}) {
  const goc = COT_GIA_CONG.filter((c) => (c.key !== "chon" && c.key !== "nut") || !!onLap);
  const cot = luoi ? luoi.rongHien(luoi.xep(goc).filter((c) => !luoi.an.has(c.key))) : goc;
  const [chon, setChon] = useState<Set<number>>(new Set());
  const daChon = (rows ?? []).filter((r) => chon.has(r.phieu_nhan_id));
  const nhaChon = daChon.length ? daChon[0].nha_cung_cap_id : null;
  const tick = (r: TgcChoTraTien) =>
    setChon((cu) => {
      const moi = new Set(cu);
      if (moi.has(r.phieu_nhan_id)) moi.delete(r.phieu_nhan_id);
      else moi.add(r.phieu_nhan_id);
      return moi;
    });

  function o(key: string, r: TgcChoTraTien) {
    switch (key) {
      case "chon": {
        const khac = nhaChon != null && r.nha_cung_cap_id !== nhaChon;
        return (
          <td key={key} className="kt-gop-tick">
            <label title={khac ? "Khác nhà gia công" : undefined}>
              <input type="checkbox" aria-label={`Chọn phiếu nhận ${r.ma}`}
                checked={chon.has(r.phieu_nhan_id)} disabled={khac} onChange={() => tick(r)} />
            </label>
          </td>
        );
      }
      case "nha":
        return <td key={key} title={r.nha_cung_cap_ten}>{r.nha_cung_cap_ten}</td>;
      case "phieu":
        return <td key={key} title={`Đơn ${r.ma_don}`}>{r.ma}</td>;
      case "nguon":
        return (
          <td key={key}>
            {r.lenh.length === 0 ? "—" : r.lenh.map((l, i) => (
              <span key={l.lsx_id}>
                {i > 0 && " "}
                {onMoLenh ? (
                  <button type="button" className="lds-lk" onClick={() => onMoLenh(l.lsx_id)}>{l.lsx_ma}</button>
                ) : <span className="lds-tag">{l.lsx_ma}</span>}
              </span>
            ))}
          </td>
        );
      case "viec":
        return (
          <td key={key} title={r.dong.map((d) => d.ten_viec).join("\n")}>
            {r.dong.map((d, i) => (
              <span key={`${d.ten_viec}-${i}`}>{i > 0 && " "}<span className="lds-tag">{d.ten_viec}</span></span>
            ))}
          </td>
        );
      case "dat": {
        const dv = motDonVi(r.dong);
        return (
          <td key={key} className="n">
            {dv === undefined
              ? r.dong.map((d, i) => <span key={i} className="lds-u">{soDv(d.dat, d.don_vi)}</span>)
              : soDv(congDong(r.dong, "dat"), dv)}
          </td>
        );
      }
      case "hong": {
        const hong = congDong(r.dong, "hong");
        const hut = r.dong.reduce((s, d) => s + (d.hut ?? 0), 0);
        return (
          <td key={key} className="n">
            {hong > 0 ? hong.toLocaleString("vi-VN") : <span className="lds-mu3">—</span>}
            {hut > 0 ? <span className="lds-u">hụt {hut.toLocaleString("vi-VN")}</span> : null}
          </td>
        );
      }
      case "tam_tinh":
        return <td key={key} className="n">{tien(r.tam_tinh)}</td>;
      case "nhan":
        return (
          <td key={key}>
            {ngay(r.nhan_luc)}
            {r.nguoi_nhan_ten ? <span className="lds-u">{r.nguoi_nhan_ten}</span> : null}
          </td>
        );
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
          Phiếu nhận hàng gia công chưa trả tiền. Tạm tính = số đạt nhân đơn giá trên đơn gia công; hỏng và hụt
          không tự trừ, sửa số tiền theo hoá đơn khi lập phiếu chi.
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
                    <span className="lds-do" role="alert">{`Không tải được hàng gia công chờ chi. ${loi}`}</span>
                  </td>
                </tr>
              ) : rows == null ? (
                <tr><td colSpan={cot.length} className="lds-trong">Đang tải…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={cot.length} className="lds-trong">Không còn phiếu nhận gia công nào chờ chi.</td></tr>
              ) : (
                rows.map((r) => <tr key={r.phieu_nhan_id} className="lds-dong">{cot.map((c) => o(c.key, r))}</tr>)
              )}
            </tbody>
          </table>
        </CuonLuoi>
      </div>
      {onLap && daChon.length > 0 && (
        <div className="kt-gop-chan" role="region" aria-label="Phiếu nhận đã chọn">
          <span>{`Đã chọn ${vietSo(daChon.length)} phiếu nhận của ${daChon[0].nha_cung_cap_ten}`}</span>
          <span className="kt-gop-chan__tong">{tien(tongTamTinh(daChon))}</span>
          <button type="button" className="kt-btn kt-btn--tron" onClick={() => setChon(new Set())}>Bỏ chọn</button>
          <button type="button" className="kt-btn kt-btn--chinh" onClick={() => onLap(daChon)}>Lập một phiếu chi</button>
        </div>
      )}
    </>
  );
}
