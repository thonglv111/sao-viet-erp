// Bảng của bàn HẸN ĐẨY (mockup `docs/mockups/xep-lich-hen-day-B-day-du.html`, 08/11/2026).
// MỘT <table> cho cả lưới trái (Lệnh, Khách hàng, Vật tư) lẫn dải ngày, để hàng luôn thẳng. Dải ngày
// vẽ bằng % theo khoảng [tu, den]: chấm giờ hẹn (xanh) / lúc đẩy (lá) / kẹt (đỏ), hình thoi hạn giao,
// tam giác vàng ngày vật tư về. Mọi giờ là giờ xưởng, đọc thẳng thành phần ISO, không dịch múi.
import type { XlDongBan, XlTab } from "../api/client";
import { THU, themNgay } from "./xlShared";

const NGAY_MS = 86_400_000;
/** Còn từ ngần này ngày trở xuống tới hạn giao thì hình thoi + vạch đỏ (cùng ngưỡng máy chủ). */
export const SAT_HAN_NGAY = 2;

/** Mốc giờ xưởng `YYYY-MM-DD[THH:mm…]` → số ms theo lịch "giả UTC" — chỉ để so và chia tỉ lệ. */
function ms(s: string, gioMacDinh = 12): number {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  const h = s.length > 10 ? Number(s.slice(11, 13)) : gioMacDinh;
  const p = s.length > 10 ? Number(s.slice(14, 16)) : 0;
  return Date.UTC(y, m - 1, d, h, p);
}

export function soNgayToi(han: string, homNay: string): number {
  return Math.round((ms(han, 0) - ms(homNay, 0)) / NGAY_MS);
}

export function laSatHan(han: string | null, homNay: string): boolean {
  return !!han && soNgayToi(han, homNay) <= SAT_HAN_NGAY;
}

/** "07:30" của một mốc giờ xưởng. */
export function gioCua(s: string | null): string {
  return s && s.length >= 16 ? s.slice(11, 16) : "";
}

/** "9/11" — ngày ngắn trên chip. */
export function ngayNgan(s: string): string {
  return `${Number(s.slice(8, 10))}/${Number(s.slice(5, 7))}`;
}

/** "10/11/2026 07:30" — đủ ngày giờ cho title và ngăn. */
export function ngayGioDu(s: string | null): string {
  if (!s) return "";
  const g = gioCua(s);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}${g ? ` ${g}` : ""}`;
}

type Chip = { lop: "la" | "vang" | "do"; chu: string; giai: string };

/** Chip Vật tư: "Đủ" lá · "Về d/m" vàng (đỏ khi về sau giờ hẹn) · "Chưa đủ" vàng · "Thiếu" đỏ. */
export function chipVatTu(d: XlDongBan): Chip | null {
  const vt = d.vat_tu;
  if (!vt) return null;
  if (vt.muc === "ok") return { lop: "la", chu: "Đủ", giai: vt.chu || "Vật tư đủ" };
  if (d.vat_tu_ve) {
    const muon = !!d.hen_luc && d.vat_tu_ve > d.hen_luc.slice(0, 10);
    return {
      lop: muon ? "do" : "vang", chu: `Về ${ngayNgan(d.vat_tu_ve)}`,
      giai: `${vt.chu || "Còn thiếu vật tư"}. Hàng về ${ngayGioDu(d.vat_tu_ve)}${muon ? ", sau giờ hẹn đẩy" : ""}`,
    };
  }
  return vt.muc === "do"
    ? { lop: "do", chu: "Thiếu", giai: vt.chu || "Thiếu vật tư, chưa có đơn mua ghi ngày về" }
    : { lop: "vang", chu: "Chưa đủ", giai: vt.chu || "Vật tư chưa đủ" };
}

export function XlBan({
  dong, tab, tu, den, homNay, demNgay, coChon, chon, chonId, onChon, onChonTrang, onMo,
}: {
  dong: XlDongBan[];
  tab: XlTab;
  tu: string;
  den: string;
  homNay: string;
  demNgay: Record<string, number>;
  /** Có quyền Đẩy (xep_lich:approve) — không có thì không có ô chọn. */
  coChon: boolean;
  chon: Set<number>;
  chonId: number | null;
  onChon: (id: number) => void;
  onChonTrang: (chonHet: boolean) => void;
  onMo: (id: number) => void;
}) {
  const ngay: string[] = [];
  for (let d = tu; d <= den && ngay.length < 93; d = themNgay(d, 1)) ngay.push(d);
  const n = ngay.length || 1;
  const goc = ms(tu, 0);
  const tong = n * NGAY_MS;
  const pct = (s: string, gio = 12) => ((ms(s, gio) - goc) / tong) * 100;
  const trongKhoang = (p: number) => p >= 0 && p <= 100;
  const thu = (d: string) => new Date(ms(d, 0)).getUTCDay();
  const lopNgay = (d: string) => (d === homNay ? "nay" : thu(d) === 0 ? "nghi" : "");
  const cotNen = (
    <div className="xh-cot" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
      {ngay.map((d) => <div key={d} className={lopNgay(d)} />)}
    </div>
  );
  const chonHet = coChon && dong.length > 0 && dong.every((d) => chon.has(d.lsx_id));

  return (
    <div className="xh-khung">
      <table className="xh-bang" style={{ minWidth: 36 + 165 + 180 + 96 + n * 40 }}>
        <thead>
          <tr>
            {coChon && (
              <th className="xh-o">
                <input type="checkbox" aria-label="Chọn cả trang" checked={chonHet}
                  onChange={(e) => onChonTrang(e.target.checked)} />
              </th>
            )}
            <th className="xh-c-lenh">Lệnh</th>
            <th className="xh-c-khach">Khách hàng</th>
            <th className="xh-c-vt">Vật tư</th>
            <th className="xh-c-hen">Hẹn đẩy</th>
            <th className="xh-c-dai" data-tieu-de="">
              <div className="xh-ngay" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
                {ngay.map((d) => (
                  <div key={d} className={lopNgay(d)}>
                    {THU[thu(d)]}<b>{Number(d.slice(8, 10))}</b>
                    {demNgay[d] ? <i>{demNgay[d]} lệnh</i> : null}
                  </div>
                ))}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {dong.map((d) => {
            const vt = chipVatTu(d);
            const sat = tab !== "da_day" && laSatHan(d.han_giao_khach, homNay);
            const moc = tab === "da_day" ? d.da_day_luc : d.hen_luc;
            const lopCham = tab === "da_day" ? "cham--day" : tab === "ket" ? "cham--ket" : "cham--hen";
            const pCham = moc ? pct(moc) : null;
            const pHan = d.han_giao_khach ? pct(d.han_giao_khach) : null;
            const hanNgoai = pHan !== null && pHan > 100;
            const pVe = d.vat_tu_ve && d.vat_tu?.muc !== "ok" ? pct(d.vat_tu_ve) : null;
            // Vạch nối chấm (giờ hẹn / lúc đẩy) tới hạn giao, cắt trong khoảng đang xem — nhìn một hàng
            // thấy giờ đẩy cách hạn giao bao xa.
            let vach: { l: number; w: number } | null = null;
            if (pCham !== null && pHan !== null) {
              const a = Math.max(0, Math.min(pCham, pHan));
              const b = Math.min(100, Math.max(pCham, pHan));
              if (b > a) vach = { l: a, w: b - a };
            }
            const chuMoc = tab === "da_day" ? "Đẩy lúc" : tab === "ket" ? "Hẹn (kẹt)" : "Hẹn đẩy";
            return (
              <tr key={d.lsx_id} className={`${chon.has(d.lsx_id) ? "is-chon" : ""}${chonId === d.lsx_id ? " is-mo" : ""}`}
                onClick={() => onMo(d.lsx_id)}>
                {coChon && (
                  <td className="xh-o" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Chọn ${d.ma}`} checked={chon.has(d.lsx_id)}
                      onChange={() => onChon(d.lsx_id)} />
                  </td>
                )}
                <td>
                  <span className="xh-lenh1">
                    <button type="button" className="xh-ma" onClick={(e) => { e.stopPropagation(); onMo(d.lsx_id); }}>{d.ma}</button>
                    {d.is_rush && <span className="xh-chip xh-chip--gap">Gấp</span>}
                  </span>
                  {tab === "ket" && d.ket_ly_do
                    ? <span className="xh-lenh2 xh-do" title={d.ket_ly_do}>{d.ket_ly_do}</span>
                    : <span className="xh-lenh2" title={d.ten}>{d.ten}</span>}
                </td>
                <td className="xh-c-khach"><span className="xh-khach" title={d.customer_name ?? ""}>{d.customer_name ?? "—"}</span></td>
                <td>
                  {vt
                    ? <span className={`xh-chip xh-chip--${vt.lop}`} title={vt.giai}><span className="xh-dot" />{vt.chu}</span>
                    : <span className="xh-mo">—</span>}
                </td>
                <td className="xh-c-hen">{moc ? ngayGioDu(moc) : <span className="xh-mo">Chưa hẹn</span>}</td>
                <td className="xh-c-dai">
                  <div className="xh-dai">
                    {cotNen}
                    {vach && <div className={`xh-vach${sat ? " xh-vach--sat" : ""}`} style={{ left: `${vach.l}%`, width: `${vach.w}%` }} />}
                    {pVe !== null && trongKhoang(pVe) && (
                      <div className="xh-tamgiac" style={{ left: `${pVe}%` }} title={`Vật tư về ${ngayGioDu(d.vat_tu_ve)}`} />
                    )}
                    {pCham !== null && trongKhoang(pCham) && (
                      <>
                        <div className={`xh-cham xh-${lopCham}`} style={{ left: `${pCham}%` }} title={`${chuMoc} ${ngayGioDu(moc)}`} />
                        <span className={`xh-nhan-gio${tab === "da_day" ? " xh-nhan-gio--la" : tab === "ket" ? " xh-nhan-gio--do" : ""}`}
                          style={{ left: `calc(${pCham}% + 11px)` }}>{gioCua(moc)}</span>
                      </>
                    )}
                    {pHan !== null && trongKhoang(pHan) && (
                      <div className={`xh-thoi${sat ? " thoi--sat" : ""}`} style={{ left: `${pHan}%` }}
                        title={`Hạn giao ${ngayGioDu(d.han_giao_khach)}`} />
                    )}
                    {hanNgoai && (
                      <span className={`xh-ngoai${sat ? " xh-do" : ""}`} title={`Hạn giao ${ngayGioDu(d.han_giao_khach)}, ngoài khoảng đang xem`}>›</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
