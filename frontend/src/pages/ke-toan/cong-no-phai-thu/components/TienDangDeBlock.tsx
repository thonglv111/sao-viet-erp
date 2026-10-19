/** Tiền khách đang để ở từng đơn (17/10/2026): công nợ đi theo đơn nên tiền này không trừ vào hoá đơn
 *  của đơn khác — hiện riêng ở đây. Đơn còn phải trả lại (đơn đã huỷ, hoặc đã ghi đủ hoá đơn mà vẫn dư)
 *  có nút "Trả lại" lập phiếu chi gắn đúng đơn; trả xong đơn rụng khỏi ô lọc "Chờ trả lại tiền khách"
 *  của màn Đơn hàng và khỏi hàng "Chờ trả lại khách" của Phiếu chi. */
import type { TienDangDe } from "../../../../api/client";
import { ChipTT, soVN, type MauTT } from "../../../../components/LuoiDs";

const TINH_TRANG: Record<string, { chu: string; mau: MauTT }> = {
  don_huy: { chu: "Đơn đã huỷ", mau: "do" },
  ghi_du: { chu: "Đã ghi đủ hoá đơn", mau: "cam" },
  cho_tru: { chu: "Chờ trừ vào hoá đơn", mau: "xam" },
};

export function TienDangDeBlock({
  ds,
  onMoDon,
  onTraLai,
}: {
  ds: TienDangDe[];
  onMoDon?: (orderId: number) => void;
  /** Vắng = không có quyền lập phiếu chi. */
  onTraLai?: (d: TienDangDe) => void;
}) {
  return (
    <div className="lds-bang kt-coc-huy">
      <table className="lds-g" aria-label="Tiền khách đang để">
        <colgroup>
          <col />
          <col style={{ width: 170 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 120 }} />
          {onTraLai && <col style={{ width: 110 }} />}
        </colgroup>
        <thead>
          <tr>
            <th>Tiền khách đang để</th>
            <th>Tình trạng</th>
            <th className="n">Đang để</th>
            <th className="n">Phải trả lại</th>
            {onTraLai && <th aria-label="Trả lại" />}
          </tr>
        </thead>
        <tbody>
          {ds.map((d) => {
            const tt = TINH_TRANG[d.tinh_trang] ?? TINH_TRANG.cho_tru;
            return (
              <tr key={d.order_id}>
                <td>
                  {onMoDon ? (
                    <button type="button" className="kt-lk" onClick={() => onMoDon(d.order_id)}>{d.order_code}</button>
                  ) : d.order_code}
                </td>
                <td><ChipTT mau={tt.mau}>{tt.chu}</ChipTT></td>
                <td className="n">{soVN(d.dang_de)}</td>
                <td className={d.con_lai > 0 ? "n lds-cam" : "n"}>{d.con_lai > 0 ? soVN(d.con_lai) : ""}</td>
                {onTraLai && (
                  <td className="lds-nut">
                    {d.con_lai > 0 && (
                      <button type="button" className="kt-btn kt-btn--nho" aria-label={`Trả lại tiền khách đơn ${d.order_code}`}
                        onClick={() => onTraLai(d)}>
                        Trả lại
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
