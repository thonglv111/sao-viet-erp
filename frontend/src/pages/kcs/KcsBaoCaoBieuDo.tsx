// Dạng Biểu đồ của tab "Báo cáo lỗi" KCS (11/10/2026, mockup `docs/mockups/kcs-bao-cao-loi-bang-va-bieu-do.html`).
//
// Bốn khối cùng cách xem đang chọn (công đoạn gây / tổ chịu / tiêu chí): lần ghi lỗi mỗi mốc trục tách
// màu theo 4 mục nhiều nhất + "Khác", xếp hạng các mục, bắt tại công đoạn hay lọt tới KCS cuối, tỷ lệ đạt
// ở bước cuối. Thanh và cột đếm theo SỐ LẦN ghi lỗi (tờ, tay, cái không cộng được); số theo đơn vị nằm ở
// dòng phụ và gợi ý. Số đều do máy chủ tính (`phan_tich`, `truc`) — ở đây chỉ vẽ SVG.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SxKcsBaoCao, SxKcsChieu, SxKcsNhomLoi } from "../../api/client";
import { num } from "../keHoachSxShared";
import { nhanChang } from "../lsxBuoc";

/** Bốn màu mục đã kiểm mù màu (validate_palette, nền trắng) + màu "Khác". Màu đi theo MỤC, không theo hạng. */
const MAU = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];
const MAU_KHAC = "#cbd5e1";
const MAU_TAI_CHO = "#94a3b8";
const MAU_LOT = "#334155";
const KHAC = "\u0000khac";

export const NHAN_CHIEU: Record<SxKcsChieu, string> = {
  cong_doan: "Công đoạn gây lỗi",
  to: "Tổ chịu",
  tieu_chi: "Tiêu chí",
};

export type ChonBcKcs = Partial<Record<SxKcsChieu | "ngay", string>>;

/** Số theo từng đơn vị của một mục, vd ["12 tờ", "3 tay"]. */
export function soTheoDv(m: Record<string, number>): string[] {
  return Object.entries(m).map(([dv, v]) => `${num(v)} ${nhanChang(dv) || ""}`.trim());
}

function useRong<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.floor(el.clientWidth)));
    ro.observe(el);
    setW(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Gợi ý khi rê chuột: một ô nổi đi theo con trỏ, gắn vào body để không bị khung cuộn cắt. */
type GoiY = {
  an: () => void;
  /** Ba sự kiện chuột gắn lên một phần tử: rê vào / di / rời. */
  gan: (nd: ReactNode) => {
    onMouseEnter: (e: React.MouseEvent) => void; onMouseMove: (e: React.MouseEvent) => void; onMouseLeave: () => void;
  };
};
function useGoiY(): [GoiY, ReactNode] {
  const [o, setO] = useState<{ x: number; y: number; nd: ReactNode } | null>(null);
  const gy: GoiY = {
    an: () => setO(null),
    gan: (nd) => ({
      onMouseEnter: (e) => setO({ x: e.clientX, y: e.clientY, nd }),
      onMouseMove: (e) => setO({ x: e.clientX, y: e.clientY, nd }),
      onMouseLeave: () => setO(null),
    }),
  };
  const node = o
    ? createPortal(
        <div className="kcsb-goiy" style={{ left: Math.min(o.x + 14, window.innerWidth - 300), top: o.y + 14 }}>{o.nd}</div>,
        document.body,
      )
    : null;
  return [gy, node];
}

/** Mỗi bao nhiêu mốc thì in một nhãn trục X để nhãn cách nhau ≥ 46px. */
const buocNhan = (bw: number) => Math.max(1, Math.ceil(46 / Math.max(bw, 1)));

function BieuDoMoc({ data, xem, mau, chon, onChonNgay, gy }: {
  data: SxKcsBaoCao; xem: SxKcsChieu; mau: Map<string, string>; chon: ChonBcKcs;
  onChonNgay: (khoa: string) => void; gy: GoiY;
}) {
  const [ref, W] = useRong<HTMLDivElement>();
  const truc = data.truc;
  const H = 180, T = 14, B = 22, L = 32;
  const dem = truc.map((m) => {
    const phan = new Map<string, number>();
    let tong = 0;
    for (const a of data.phan_tich[xem]) {
      const v = a.ngay[m.khoa] ?? 0;
      if (!v) continue;
      const k = mau.has(a.ten) ? a.ten : KHAC;
      phan.set(k, (phan.get(k) ?? 0) + v);
      tong += v;
    }
    return { m, phan, tong };
  });
  const maxTong = Math.max(0, ...dem.map((o) => o.tong));
  const max = Math.max(4, Math.ceil(maxTong / 2) * 2);
  // Kỳ trước tính cùng bấm-lọc (trừ mốc ngày) nên vạch trung bình so được cả khi đã chọn một mục.
  const tb = data.ky_truoc && truc.length ? data.ky_truoc.so_lan_ghi_loi / truc.length : null;
  const thu = [...mau.keys(), KHAC];
  const n = Math.max(truc.length, 1);
  const bw = W > L ? (W - L) / n : 0;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const buoc = buocNhan(bw);
  const goi = (o: (typeof dem)[number]) => (
    <>
      <div>{o.m.nhan}: {num(o.tong)} lần ghi lỗi</div>
      {thu.filter((k) => o.phan.get(k)).map((k) => (
        <div key={k}><i className="kcsb-goiy__o" style={{ background: k === KHAC ? MAU_KHAC : mau.get(k) }} />
          {k === KHAC ? "Khác" : k} {num(o.phan.get(k) ?? 0)}</div>
      ))}
      <div className="kcsb-goiy__mo">{chon.ngay === o.m.khoa ? "Bấm để bỏ chọn" : "Bấm để xem riêng mốc này"}</div>
    </>
  );
  return (
    <div ref={ref} className="kcsb-bd-khung">
      {W > L && (
        <svg className="kcsb-bd" width={W} height={H} role="img" aria-label={`Lần ghi lỗi mỗi mốc theo ${NHAN_CHIEU[xem].toLowerCase()}`}>
          {[0, max / 2, max].map((v) => (
            <g key={v}>
              <line className="kcsb-bd__luoi" x1={L} x2={W} y1={y(v)} y2={y(v)} />
              <text x={L - 6} y={y(v) + 4} textAnchor="end">{num(v)}</text>
            </g>
          ))}
          {dem.map((o, i) => {
            const gap = Math.min(6, Math.max(2, bw * 0.25));
            const x = L + i * bw + gap / 2, w = Math.max(1, bw - gap);
            const mo = chon.ngay != null && chon.ngay !== o.m.khoa;
            const ds = thu.filter((k) => o.phan.get(k));
            let acc = 0;
            return (
              <g key={o.m.khoa} className="kcsb-bd__bam" {...gy.gan(goi(o))}
                onClick={() => { gy.an(); onChonNgay(o.m.khoa); }}>
                <rect className="kcsb-bd__nen" x={L + i * bw} y={T} width={bw} height={H - T - B} />
                <g opacity={mo ? 0.3 : 1}>{ds.map((k, j) => {
                  const v = o.phan.get(k) ?? 0;
                  const y0 = y(acc) - (j ? 2 : 0), y1 = y(acc + v);
                  acc += v;
                  const fill = k === KHAC ? MAU_KHAC : mau.get(k);
                  const h = Math.max(0, y0 - y1);
                  const r = j === ds.length - 1 ? Math.min(4, w / 2, h) : 0;
                  return r > 0
                    ? <path key={k} fill={fill}
                        d={`M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`} />
                    : <rect key={k} fill={fill} x={x} y={y1} width={w} height={h} />;
                })}</g>
                {i % buoc === 0
                  ? <text x={x + w / 2} y={H - 6} textAnchor="middle">{o.m.nhan}</text> : null}
              </g>
            );
          })}
          {tb != null && tb > 0 && (
            <line className="kcsb-bd__tham-chieu" x1={L} x2={W} y1={y(Math.min(tb, max))} y2={y(Math.min(tb, max))}
              {...gy.gan(`Trung bình kỳ trước ${num(Math.round(tb * 10) / 10)} lần mỗi mốc`)} />
          )}
        </svg>
      )}
    </div>
  );
}

function BieuDoTyLe({ data, gy }: { data: SxKcsBaoCao; gy: GoiY }) {
  const [ref, W] = useRong<HTMLDivElement>();
  const truc = data.truc;
  const H = 150, T = 12, B = 22, L = 40;
  const tl = truc.map((m) => (m.nhan_cuoi > 0 ? (m.dat_cuoi / m.nhan_cuoi) * 100 : null));
  const co = tl.filter((v): v is number => v != null);
  if (co.length === 0) return <p className="kcsb-trong">Chưa có lần kiểm bước cuối nào trong kỳ.</p>;
  const lo = Math.min(94, Math.floor(Math.min(...co))), hi = 100;
  const n = Math.max(truc.length, 1);
  const bw = W > L ? (W - L) / n : 0;
  const x = (i: number) => L + i * bw + bw / 2;
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const pts = tl.map((v, i) => (v == null ? null : [x(i), y(v)] as const)).filter((p): p is readonly [number, number] => p != null);
  const buoc = buocNhan(bw);
  return (
    <div ref={ref} className="kcsb-bd-khung">
      {W > L && (
        <svg className="kcsb-bd" width={W} height={H} role="img" aria-label="Tỷ lệ đạt ở bước cuối theo mốc">
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <g key={v}>
              <line className="kcsb-bd__luoi" x1={L} x2={W} y1={y(v)} y2={y(v)} />
              <text x={L - 6} y={y(v) + 4} textAnchor="end">{num(Math.round(v))}%</text>
            </g>
          ))}
          {pts.length > 1 && <path className="kcsb-bd__duong" d={`M${pts.map((p) => p.join(",")).join(" L")}`} />}
          {tl.map((v, i) => v == null ? null : (
            <g key={truc[i].khoa}
              {...gy.gan((
                <>
                  <div>{truc[i].nhan}: tỷ lệ đạt {num(Math.round(v * 10) / 10)}%</div>
                  <div className="kcsb-goiy__mo">{num(truc[i].dat_cuoi)} đạt trên {num(truc[i].nhan_cuoi)} kiểm</div>
                </>
              ))}>
              <circle className="kcsb-bd__cham" cx={x(i)} cy={y(v)} r={pts.length > 1 ? 4 : 5} />
              <rect className="kcsb-bd__nen" x={L + i * bw} y={T} width={bw} height={H - T - B} />
            </g>
          ))}
          {truc.map((m, i) => (i % buoc === 0
            ? <text key={m.khoa} x={x(i)} y={H - 6} textAnchor="middle">{m.nhan}</text> : null))}
        </svg>
      )}
    </div>
  );
}

const TOI_DA = 8;

function XepHang({ ds, mau, chon, onChon, gy }: {
  ds: SxKcsNhomLoi[]; mau: Map<string, string>; chon: string | undefined; onChon: (ten: string) => void; gy: GoiY;
}) {
  const [ca, setCa] = useState(false);
  if (ds.length === 0) return <p className="kcsb-trong">Không có lỗi nào.</p>;
  const max = ds[0].lan;
  return (
    <>
      <div className="kcsb-xh">
        {(ca ? ds : ds.slice(0, TOI_DA)).map((a) => {
          const dv = soTheoDv(a.so_theo_dv);
          return (
            <button key={a.ten} type="button" className={`kcsb-xh__dong${chon === a.ten ? " on" : ""}`}
              aria-pressed={chon === a.ten}
              {...gy.gan((
                <>
                  <div>{a.ten}</div>
                  <div>{num(a.lan)} lần ghi lỗi</div>
                  {dv.map((s) => <div key={s}>{s}</div>)}
                  <div className="kcsb-goiy__mo">{num(a.so_lenh)} lệnh dính</div>
                </>
              ))}
              onClick={() => { gy.an(); onChon(a.ten); }}>
              <span className="kcsb-xh__ten">{a.ten}</span>
              <span className="kcsb-xh__vach">
                <i style={{
                  width: `${Math.max(3, (a.lan / max) * 100)}%`, background: mau.get(a.ten) ?? MAU_KHAC,
                  opacity: chon && chon !== a.ten ? 0.35 : 1,
                }} />
              </span>
              <span className="kcsb-xh__so">
                {num(a.lan)} lần
                {/* Hai đơn vị không cộng được (tờ in với cái) nên nói đủ cả hai; "+1 đơn vị" giấu mất
                    số thứ hai (05/11/2026). Quá hai thì đếm phần còn lại, rê chuột xem đủ. */}
                <small>{dv.slice(0, 2).join(" và ")}{dv.length > 2 ? ` và ${dv.length - 2} đơn vị khác` : ""}</small>
              </span>
            </button>
          );
        })}
      </div>
      {ds.length > TOI_DA && (
        <button type="button" className="lds-lk kcsb-xh__them" onClick={() => setCa(!ca)}>
          {ca ? "Thu gọn" : `Xem cả ${ds.length}`}
        </button>
      )}
    </>
  );
}

function BatODau({ ds, chon, onChon, gy }: {
  ds: SxKcsNhomLoi[]; chon: string | undefined; onChon: (ten: string) => void; gy: GoiY;
}) {
  if (ds.length === 0) return <p className="kcsb-trong">Không có lỗi nào.</p>;
  const max = ds[0].lan;
  return (
    <div className="kcsb-xh">
      {ds.slice(0, TOI_DA).map((a) => (
        <button key={a.ten} type="button" className={`kcsb-xh__dong${chon === a.ten ? " on" : ""}`}
          aria-pressed={chon === a.ten}
          {...gy.gan((
            <>
              <div>{a.ten}</div>
              <div>Tại công đoạn {num(a.tai_cho)} lần</div>
              <div>Lọt tới KCS cuối {num(a.lot)} lần</div>
            </>
          ))}
          onClick={() => { gy.an(); onChon(a.ten); }}>
          <span className="kcsb-xh__ten">{a.ten}</span>
          <span className="kcsb-xh__vach kcsb-xh__vach--hai" style={{ opacity: chon && chon !== a.ten ? 0.35 : 1 }}>
            {a.tai_cho > 0 && <i style={{ width: `${(a.tai_cho / max) * 100}%`, background: MAU_TAI_CHO }} />}
            {a.lot > 0 && <i style={{ width: `${(a.lot / max) * 100}%`, background: MAU_LOT }} />}
          </span>
          <span className="kcsb-xh__so">
            {a.lot ? <span className="lds-do">{num(a.lot)} lọt</span> : <span className="lds-mu3">0 lọt</span>}
            <small>{a.lan ? Math.round((a.lot / a.lan) * 100) : 0}% số lần</small>
          </span>
        </button>
      ))}
    </div>
  );
}

export function KcsBaoCaoBieuDo({ data, xem, chon, onChon }: {
  data: SxKcsBaoCao;
  xem: SxKcsChieu;
  chon: ChonBcKcs;
  onChon: (chieu: SxKcsChieu | "ngay", gt: string) => void;
}) {
  const [gy, nodeGy] = useGoiY();
  const ds = data.phan_tich[xem].filter((a) => a.lan > 0);
  // Màu theo top 4 của chính chiều đang xem (máy chủ tính trừ điều kiện chiều đó) — bấm một thanh không
  // tô lại các mục khác.
  const mau = new Map(ds.slice(0, 4).map((a, i) => [a.ten, MAU[i]] as const));
  const coKhac = data.phan_tich[xem].some((a) => !mau.has(a.ten) && Object.keys(a.ngay).length > 0);
  const nhanXem = NHAN_CHIEU[xem].toLowerCase();
  const theoThang = data.truc.length > 0 && data.truc[0].khoa.length === 7;
  return (
    <div className="kcsb-bdo">
      <section className="kcsb-khung">
        <div className="kcsb-khung__dau">
          <h4>Lần ghi lỗi mỗi {theoThang ? "tháng" : "ngày"} theo {nhanXem}</h4>
          <span className="kcsb-gian" />
          <span className="kcsb-khung__phu">Bấm một cột để xem riêng {theoThang ? "tháng" : "ngày"} đó</span>
        </div>
        <div className="kcsb-chu-giai">
          {[...mau.entries()].map(([t, m]) => <span key={t}><i style={{ background: m }} />{t}</span>)}
          {coKhac && <span><i style={{ background: MAU_KHAC }} />Khác</span>}
          {data.ky_truoc && <span><i className="kcsb-chu-giai__gach" />Trung bình kỳ trước</span>}
        </div>
        {data.truc.length === 0
          ? <p className="kcsb-trong">Kỳ đang chọn chưa có ngày nào.</p>
          : <BieuDoMoc data={data} xem={xem} mau={mau} chon={chon} onChonNgay={(k) => onChon("ngay", k)} gy={gy} />}
      </section>
      <div className="kcsb-luoi-2">
        <section className="kcsb-khung">
          <h4>{NHAN_CHIEU[xem]} nhiều lỗi nhất</h4>
          <p className="kcsb-khung__phu">Đếm số lần ghi lỗi; số lượng theo đơn vị ở dòng dưới. Bấm một thanh để lọc.</p>
          <XepHang ds={ds} mau={mau} chon={chon[xem]} onChon={(t) => onChon(xem, t)} gy={gy} />
        </section>
        <section className="kcsb-khung">
          <h4>Bắt tại công đoạn hay lọt tới KCS cuối</h4>
          <div className="kcsb-chu-giai">
            <span><i style={{ background: MAU_TAI_CHO }} />Tại công đoạn</span>
            <span><i style={{ background: MAU_LOT }} />Lọt tới KCS cuối</span>
          </div>
          <BatODau ds={ds} chon={chon[xem]} onChon={(t) => onChon(xem, t)} gy={gy} />
        </section>
      </div>
      <section className="kcsb-khung">
        <div className="kcsb-khung__dau">
          <h4>Tỷ lệ đạt ở bước cuối</h4>
          <span className="kcsb-gian" />
          <span className="kcsb-khung__phu">Chỉ tính lần kiểm bước cuối, theo thanh lọc; công đoạn giữa chỉ ghi lỗi</span>
        </div>
        <BieuDoTyLe data={data} gy={gy} />
      </section>
      {nodeGy}
    </div>
  );
}
