/** Hàng "Chờ trả lại khách" (17/10/2026), cùng khuôn "Mua hàng chờ chi": đơn đã hết chỗ ghi hoá đơn
 *  (ghi đủ, hoặc đơn đã huỷ) mà tiền khách đã đưa vẫn còn dư. Mỗi đơn một dòng, cột "Khoản chi", bấm vào
 *  dòng mở popup chi tiết `ChiTietKhoan`. Lập phiếu chi trả lại đủ thì dòng rời danh sách; huỷ phiếu chi
 *  thì quay lại. */
import { ExternalLink } from "lucide-react";
import { useState } from "react";

import type { TraLaiKhachChoChi } from "../../../../api/client";
import { CuonLuoi, rongLuoi, type CauHinhLuoi, type CotLuoi } from "../../../../components/LuoiDs";
import { ChiTietKhoan } from "../../shared/ChiTietKhoan";
import { tien } from "../../shared/dinhDang";

export const COT_TRA_LAI: (CotLuoi & { w?: number; n?: boolean })[] = [
  { key: "khach", label: "Khách hàng", coDinh: true, w: 220 },
  { key: "khoan", label: "Khoản chi", w: 96 },
  { key: "don", label: "Đơn hàng", w: 220 },
  { key: "ly_do", label: "Lý do", w: 240 },
  { key: "da_tra", label: "Đã trả lại", n: true, w: 140 },
  { key: "con_lai", label: "Còn phải trả", n: true, w: 150 },
  { key: "nut", label: "Thao tác", coDinh: true, w: 140 },
];

export function HangChoTraLai({
  rows,
  loi,
  onLap,
  onMoDon,
  luoi,
}: {
  rows: TraLaiKhachChoChi[] | null;
  loi: string | null;
  /** Không có = không có quyền lập phiếu chi ⇒ không hiện nút. */
  onLap?: (row: TraLaiKhachChoChi) => void;
  /** Không có = không có quyền xem Đơn hàng bán ⇒ mã đơn là chữ thường. */
  onMoDon?: (orderId: number) => void;
  luoi?: CauHinhLuoi;
}) {
  const cot = luoi ? luoi.rongHien(luoi.xep(COT_TRA_LAI).filter((c) => !luoi.an.has(c.key))) : COT_TRA_LAI;
  // Dòng đang mở popup chi tiết (theo đơn — trả lại đủ thì dòng rời hàng, popup tự đóng).
  const [xem, setXem] = useState<number | null>(null);
  const dangXem = rows?.find((r) => r.order_id === xem) ?? null;
  return (
    <>
      <div className="lds-sheet">
        <p className="kt-gc-ghi">
          Đơn đã hết chỗ ghi hóa đơn mà tiền khách đưa còn dư. Lập phiếu chi trả lại xong thì đơn rời khỏi danh sách này.
        </p>
        <CuonLuoi ghim={luoi?.soGhim(cot)}>
          <table className="lds-g" style={{ minWidth: rongLuoi(cot) }}>
            <colgroup>
              {cot.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
            </colgroup>
            <thead>
              <tr>
                {cot.map((c) => (
                  <th key={c.key} className={c.n ? "n" : undefined} aria-label={c.key === "nut" ? "Thao tác" : undefined}>
                    {c.key === "nut" ? null : c.label}
                    {luoi?.keo(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loi ? (
                <tr>
                  <td colSpan={cot.length} className="lds-trong">
                    <span className="lds-do" role="alert">{`Không tải được danh sách chờ trả lại khách. ${loi}`}</span>
                  </td>
                </tr>
              ) : rows == null ? (
                <tr><td colSpan={cot.length} className="lds-trong">Đang tải…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={cot.length} className="lds-trong">Không còn khoản nào chờ trả lại khách.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.order_id}
                    className={`lds-dong${xem === r.order_id ? " is-chon" : ""}`}
                    tabIndex={0}
                    aria-haspopup="dialog"
                    onClick={() => setXem(r.order_id)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        setXem(r.order_id);
                      }
                    }}
                  >
                    {cot.map((c) => oTraLai(c.key, r, onLap, onMoDon))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CuonLuoi>
      </div>
      {dangXem && (
        <PopupTraLai r={dangXem} onClose={() => setXem(null)}
          onMoDon={onMoDon ? (id) => { setXem(null); onMoDon(id); } : undefined}
          onLap={onLap && dangXem.customer_id != null ? () => { setXem(null); onLap(dangXem); } : undefined} />
      )}
    </>
  );
}

/** "Hóa đơn 12 đã hủy" / "Đơn đã hủy" — vì sao khoản tiền này phải trả lại. */
function lyDo(r: TraLaiKhachChoChi): string {
  const hd = r.hoa_don_huy.length
    ? `Hóa đơn ${r.hoa_don_huy.join(" và ")} đã hủy`
    : "";
  if (r.don_huy) return hd ? `Đơn đã hủy. ${hd}` : "Đơn đã hủy";
  if (hd) return hd;
  return r.tinh_trang === "coc_vuot" ? "Cọc thu vượt tổng đơn" : "Đã ghi đủ hóa đơn";
}

/** Popup một khoản chờ trả lại khách (`ChiTietKhoan`, không có thẻ Hàng): tiền dư = đã trả lại + còn phải
 *  trả. */
function PopupTraLai({
  r,
  onClose,
  onMoDon,
  onLap,
}: {
  r: TraLaiKhachChoChi;
  onClose: () => void;
  onMoDon?: (orderId: number) => void;
  onLap?: () => void;
}) {
  const maDon = onMoDon ? (
    <button type="button" className="kt-lk" onClick={() => onMoDon(r.order_id)}>
      {r.order_code} <ExternalLink size={12} aria-hidden="true" />
    </button>
  ) : r.order_code;
  return (
    <ChiTietKhoan
      tieuDe={`Trả lại khách đơn ${r.order_code}`}
      phuDe={r.customer_name}
      lichSu={[
        { khoa: "du", ngay: null, ngayChu: "tiền dư", noiDung: lyDo(r), tien: r.da_tra_lai + r.con_lai },
        ...(r.da_tra_lai > 0
          ? [{ khoa: "da", ngay: null, ngayChu: "đã trả", noiDung: "Đã chi trả lại khách", tien: -r.da_tra_lai }]
          : []),
      ]}
      con={{ nhan: "Còn phải trả", tien: r.con_lai }}
      nut={onLap && <button type="button" className="kt-btn kt-btn--chinh" onClick={onLap}>Lập phiếu chi</button>}
      thongTin={[
        { nhan: "Lý do", giaTri: lyDo(r) },
        { nhan: "Đã trả lại", giaTri: r.da_tra_lai > 0 ? tien(r.da_tra_lai) : null },
        { nhan: "Đơn bán", giaTri: maDon },
      ]}
      onClose={onClose}
    />
  );
}

function oTraLai(
  key: string,
  r: TraLaiKhachChoChi,
  onLap?: (row: TraLaiKhachChoChi) => void,
  onMoDon?: (orderId: number) => void,
) {
  switch (key) {
    case "khach":
      return <td key={key} title={r.customer_name ?? undefined}>{r.customer_name ?? "—"}</td>;
    case "khoan":
      return <td key={key}><span className="lds-tag">Trả lại</span></td>;
    case "don":
      return (
        <td key={key}>
          {onMoDon ? (
            <button type="button" className="lds-lk" onClick={(e) => { e.stopPropagation(); onMoDon(r.order_id); }}>
              {r.order_code}
            </button>
          ) : r.order_code}
        </td>
      );
    case "ly_do":
      return <td key={key} title={lyDo(r)}>{lyDo(r)}</td>;
    case "da_tra":
      return <td key={key} className="n">{r.da_tra_lai > 0 ? tien(r.da_tra_lai) : ""}</td>;
    case "con_lai":
      return <td key={key} className="n">{tien(r.con_lai)}</td>;
    case "nut":
      return (
        <td key={key} className="lds-nut">
          {onLap && r.customer_id != null && (
            <button type="button" className="kt-btn kt-btn--nho" onClick={(e) => { e.stopPropagation(); onLap(r); }}>
              Lập phiếu chi
            </button>
          )}
        </td>
      );
    default:
      return <td key={key} />;
  }
}
