/** Sản xuất TỪNG MẶT HÀNG của đơn (07/10/2026).
 *
 *  Ô Sản xuất ngoài danh sách đơn (`SanXuatO`) đã gỡ 13/10/2026 — người dùng: thừa, đã có Hồ sơ lệnh
 *  và Theo dõi sản xuất.
 *  · `BangSanXuatMon` — khối Sản xuất trong ngăn đơn (phương án B của
 *    `docs/mockups/don-hang-san-xuat-3-phuong-an.html`): mỗi mặt hàng một hàng, bấm hàng mở lệnh. */
import type { DonTienDo, DonTienDoCum } from "../../../api/client";
import { EmptyState } from "../../../components/EmptyState";
import {
  chiTietO, hangVe, kieuLam, lenhDaiDien, nhanO, type MonCoBan,
} from "./monSanXuat";
import { coHangCum, coTuTonCum, NHAN_LY_DO_TRE } from "./TienDoDon";

const so = (n: number) => n.toLocaleString("vi-VN");

function TheO({ m }: { m: MonCoBan }) {
  const { nhan, mau } = nhanO(m);
  return <span className={`sxm-the sxm-the--${mau}`}>{nhan}</span>;
}

/** "Hàng về" của bảng trong ngăn đơn: hàng về kho thì gọi tên kho đang có hàng (10/10/2026; từ
 *  11/10/2026 tồn của mã là hàng của khách nên mọi kho có tồn đều tính), chưa kho nào có thì "Kho". */
function hangVeKho(m: MonCoBan, ton: DonTienDoCum["ton_kho"]) {
  const v = hangVe(m);
  if (v !== "Kho") return v;
  const ten = [...new Set((ton ?? []).map((r) => r.kho_ten))];
  if (ten.length === 0) return v;
  return <span className="sxm-o-cot">{ten.map((t) => <span key={t}>{t}</span>)}</span>;
}

/** Khối Sản xuất trong ngăn đơn — bảng gọn mỗi mặt hàng một hàng (phương án B). */
export function BangSanXuatMon({
  td, onMoLenh,
}: {
  td: DonTienDo | null;
  onMoLenh?: (lsxId: number) => void;
}) {
  if (!td) return <EmptyState trangThai="dang-tai" gon nhanTai="Đang tải tiến độ…" />;
  if (td.cum.length === 0) return <p className="dhb__td-note">Đơn chưa có sản phẩm.</p>;
  return (
    <div className="sxm-bang-khung">
      <table className="sxm-bang">
        <thead>
          <tr>
            <th>Sản phẩm</th>
            <th>Lệnh</th>
            <th>Kiểu làm</th>
            <th>Đang ở</th>
            <th>Vướng mắc</th>
            <th>Đã có hàng</th>
            <th>Hàng về</th>
          </tr>
        </thead>
        <tbody>
          {td.cum.map((c) => {
            const m: MonCoBan = {
              ten: c.ten, don_vi: c.don_vi, dat: c.dat,
              co_hang: coHangCum(c), co_tu_ton: coTuTonCum(c),
              o: c.o ?? "chua_lenh", co_lenh: c.co_lenh, tu_ton: !c.co_lenh && c.o === "du_hang",
              giao_thang: c.giao_thang, lenh: c.lenh_o ?? [],
            };
            const l = lenhDaiDien(m);
            const mo = l && onMoLenh ? () => onMoLenh(l.id) : undefined;
            const pct = m.dat > 0 ? Math.min(100, (m.co_hang / m.dat) * 100) : 0;
            const ct = chiTietO(m);
            const tre = m.o === "du_hang" ? [] : c.lenh.flatMap((l) => l.xong ? [] : l.canh_bao)
              .filter((w, i, a) => a.indexOf(w) === i);
            return (
              <tr
                key={c.khoa}
                className={mo ? "sxm-bang__mo" : undefined}
                onClick={mo}
                title={mo ? `Mở hồ sơ lệnh ${l!.ma}` : undefined}
              >
                <td className="sxm-bang__ten">{c.ten}</td>
                <td>
                  {m.lenh.length === 0 ? <span className="sxm-mo-nhat">Không có lệnh</span> : (
                    <span className="sxm-lenhs">
                      {m.lenh.map((x) => onMoLenh ? (
                        <button
                          key={x.id}
                          type="button"
                          className="sxm-lenh"
                          onClick={(e) => { e.stopPropagation(); onMoLenh(x.id); }}
                        >
                          {x.ma} <span aria-hidden="true">↗</span>
                        </button>
                      ) : (
                        // Không vào được Kế hoạch SX thì chỉ là mã, không mũi tên dẫn ra màn 403 (#77).
                        <span key={x.id} className="sxm-lenh">{x.ma}</span>
                      ))}
                    </span>
                  )}
                </td>
                <td>{kieuLam(m)}</td>
                <td>
                  <span className="sxm-o-cot">
                    <TheO m={m} />
                    {ct && <span className="sxm-mo-nhat">{ct}</span>}
                  </span>
                </td>
                <td>
                  {tre.length === 0 ? <span className="sxm-mo-nhat">—</span> : (
                    <span className="sxm-o-cot">
                      {tre.map((w) => <span key={w} className="sxm-the sxm-the--tre">{NHAN_LY_DO_TRE[w] ?? w}</span>)}
                    </span>
                  )}
                </td>
                <td>
                  <span className="sxm-co-cot">
                    <span className="sxm-thanh"><i style={{ width: `${pct}%` }} /></span>
                    <span className="sxm-so">{so(m.co_hang)} / {so(m.dat)}{m.don_vi ? ` ${m.don_vi}` : ""}</span>
                  </span>
                </td>
                <td>{hangVeKho(m, c.ton_kho)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
