// Mẩu dùng chung của lưới danh sách kiểu bảng tính (phương án A, 07/10/2026) — xem luoi-ds.css.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { useLaDienThoai } from "../utils/dienThoai";
import "./hover-tip.css";
import "./luoi-ds.css";

export type MauTT = "vang" | "cam" | "xanh" | "cyan" | "cham" | "tim" | "ngoc" | "la" | "do" | "xam" | "slate";

/** Chip trạng thái (tròn) hoặc chip khâu (`vuong`, góc vuông nhỏ). */
export function ChipTT({ mau, vuong, title, children }: { mau: MauTT; vuong?: boolean; title?: string; children: ReactNode }) {
  return (
    <span className={`lds-chip lds-chip--${mau}${vuong ? " lds-chip--vuong" : ""}`} title={title}>
      {children}
    </span>
  );
}

export interface MucLocNhanh {
  key: string;
  label: string;
  count?: number;
  /** Màu chấm — vắng thì không chấm (vd "Tất cả"). */
  mau?: MauTT;
  /** Chấm đỏ "có việc mới chưa xem" (không số). */
  cham?: boolean;
}

/** Hàng lọc nhanh trạng thái: chữ + chấm màu + số mờ; mục 0 chữ nhạt nhưng vẫn bấm được. */
export function LocNhanhTrangThai({
  muc,
  dang,
  onChon,
  ariaLabel = "Lọc theo trạng thái",
}: {
  muc: MucLocNhanh[];
  dang: string;
  onChon: (key: string) => void;
  ariaLabel?: string;
}) {
  return (
    // Nút bật (aria-pressed) chứ không phải tab: đây là bộ lọc của bảng, còn tab thật của màn (vd
    // Giao hàng) vẫn là tab — trộn hai thứ cùng vai "tab" thì trình đọc màn hình đếm sai.
    <div className="lds-flt" role="group" aria-label={ariaLabel}>
      {muc.map((m) => (
        <button
          key={m.key}
          type="button"
          aria-pressed={dang === m.key}
          className={`${dang === m.key ? "on" : ""}${m.count === 0 ? " z" : ""}`}
          onClick={() => onChon(m.key)}
        >
          {m.mau ? <i className={`lds-dot lds-dot--${m.mau}`} aria-hidden="true" /> : null}
          <span className={m.cham ? "lds-flt__cham" : undefined}>{m.label}</span>
          {m.count !== undefined ? <span className="lds-flt__so">{m.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export interface CotLuoi {
  key: string;
  label: string;
  /** Cột bắt buộc (mã) — không cho ẩn. */
  coDinh?: boolean;
}

/** Đọc / ghi một danh sách khoá cột của màn trong localStorage (per-viewer — mất thì về mặc định). */
function useDsLuu(khoa: string, macDinh: string[] = []): [string[], (v: string[]) => void] {
  const [ds, setDs] = useState<string[]>(() => {
    try {
      const v = localStorage.getItem(khoa);
      return v ? (JSON.parse(v) as string[]) : macDinh;
    } catch {
      return macDinh;
    }
  });
  const dat = (v: string[]) => {
    setDs(v);
    try {
      localStorage.setItem(khoa, JSON.stringify(v));
    } catch {
      /* trình duyệt chặn lưu thì thôi */
    }
  };
  return [ds, dat];
}

/** Nhớ cột đang ẩn theo màn. `anMacDinh` = cột ẩn sẵn khi người xem chưa chỉnh lần nào (bảng nhiều
 *  cột phụ: hiện đủ thì lưới quá rộng, ai cần thì bật ở nút Cột). */
export function useCotAn(man: string, anMacDinh?: string[]): [Set<string>, (s: Set<string>) => void] {
  const [ds, dat] = useDsLuu(`lds-cot-an:${man}`, anMacDinh);
  const an = useMemo(() => new Set(ds), [ds]);
  return [an, (s) => dat([...s])];
}

/** Nhớ thứ tự cột người xem đã kéo thả theo màn (rỗng = thứ tự mặc định). */
export function useThuTuCot(man: string): [string[], (v: string[]) => void] {
  return useDsLuu(`lds-cot-thu-tu:${man}`);
}

/** Nhớ cột người xem đã ghim bên trái theo màn. */
export function useCotGhim(man: string): [string[], (v: string[]) => void] {
  return useDsLuu(`lds-cot-ghim:${man}`);
}

/** Đưa cột đã ghim lên vùng ghim: ngay sau khối cột cố định đầu lưới (Mã, ô chọn…), giữ thứ tự hiện
 *  có giữa chúng. Ghim phải dời cột vì `sticky` chỉ bám đúng khi các cột ghim liền nhau từ mép trái. */
export function apGhim<T extends CotLuoi>(cot: T[], ghim: string[]): T[] {
  if (ghim.length === 0) return cot;
  const i = cot.findIndex((c) => !c.coDinh);
  if (i < 0) return cot;
  const sau = cot.slice(i);
  return [...cot.slice(0, i), ...sau.filter((c) => ghim.includes(c.key)), ...sau.filter((c) => !ghim.includes(c.key))];
}

/** Nhớ độ rộng cột người xem đã kéo theo màn: `{khoá cột: px}` (rỗng = độ rộng mặc định). */
export function useRongCot(man: string): [Record<string, number>, (v: Record<string, number>) => void] {
  const khoa = `lds-cot-rong:${man}`;
  const [rong, setRong] = useState<Record<string, number>>(() => {
    try {
      const v = localStorage.getItem(khoa);
      return v ? (JSON.parse(v) as Record<string, number>) : {};
    } catch {
      return {};
    }
  });
  const dat = (v: Record<string, number>) => {
    setRong(v);
    try {
      if (Object.keys(v).length) localStorage.setItem(khoa, JSON.stringify(v));
      else localStorage.removeItem(khoa);
    } catch {
      /* trình duyệt chặn lưu thì thôi */
    }
  };
  return [rong, dat];
}

/** Áp độ rộng đã kéo lên bộ cột đang hiện. Lưới luôn giữ ít nhất một cột co giãn (cột cuối) để ăn
 *  phần thừa của khung: `table-layout: fixed` mà mọi cột đều có số thì trình duyệt rải phần thừa lên
 *  tất cả, kéo hẹp một cột trông như không ăn. */
export function apRong<T extends { key: string; w?: number }>(cot: T[], rong: Record<string, number>): T[] {
  if (Object.keys(rong).length === 0) return cot;
  const coGian = cot.some((c) => !c.w);
  const moi = cot.map((c) => (rong[c.key] ? { ...c, w: rong[c.key] } : c));
  if (coGian && moi.length > 0 && moi.every((c) => c.w)) moi[moi.length - 1] = { ...moi[moi.length - 1], w: undefined };
  return moi;
}

const RONG_CO_MIN = 48;
const RONG_CO_MAX = 640;

/** Thẻ `<col>` ứng với ô tiêu đề (cộng dồn colSpan các ô đứng trước). */
function colCua(th: HTMLTableCellElement): { col: HTMLTableColElement; i: number } | null {
  let i = 0;
  for (let o = th.previousElementSibling; o; o = o.previousElementSibling) i += (o as HTMLTableCellElement).colSpan || 1;
  const col = th.closest("table")?.querySelectorAll<HTMLTableColElement>("colgroup col")[i];
  return col ? { col, i } : null;
}

/** Tay kéo ở mép phải ô tiêu đề để đổi độ rộng cột (kiểu Excel); nhấp đúp = co vừa nội dung đang
 *  hiện. Trong lúc kéo chỉ sửa thẳng `<col>` (khỏi vẽ lại cả lưới theo từng nhịp chuột), thả mới ghi. */
export function TayKeoCot({ onRong }: { onRong: (w: number) => void }) {
  const batDau = (e: RPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const tay = e.currentTarget;
    const th = tay.closest("th");
    const bang = th?.closest("table");
    const vt = th ? colCua(th) : null;
    if (!th || !bang || !vt) return;
    const x0 = e.clientX;
    const w0 = Math.round(th.getBoundingClientRect().width);
    const min0 = parseFloat(bang.style.minWidth) || bang.getBoundingClientRect().width;
    let w = w0;
    tay.setPointerCapture(e.pointerId);
    document.body.classList.add("lds-dang-keo-cot");
    const di = (ev: PointerEvent) => {
      w = Math.min(RONG_CO_MAX, Math.max(RONG_CO_MIN, Math.round(w0 + ev.clientX - x0)));
      vt.col.style.width = `${w}px`;
      bang.style.minWidth = `${min0 + w - w0}px`;
    };
    const tha = () => {
      tay.removeEventListener("pointermove", di);
      tay.removeEventListener("pointerup", tha);
      tay.removeEventListener("pointercancel", tha);
      document.body.classList.remove("lds-dang-keo-cot");
      if (w !== w0) onRong(w);
    };
    tay.addEventListener("pointermove", di);
    tay.addEventListener("pointerup", tha);
    tay.addEventListener("pointercancel", tha);
  };

  const vuaNoiDung = (e: RMouseEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.closest("th");
    const bang = th?.closest("table");
    const vt = th ? colCua(th) : null;
    if (!th || !bang || !vt) return;
    // Ép cột về tối thiểu rồi đo `scrollWidth` = bề rộng nội dung cần (kể cả chữ đang bị cắt "…").
    const cu = vt.col.style.width;
    vt.col.style.width = "1px";
    let can = th.scrollWidth;
    const soCot = bang.querySelectorAll("colgroup col").length;
    for (const tb of Array.from(bang.tBodies)) {
      for (const tr of Array.from(tb.rows)) {
        // Dòng có ô gộp (dòng trống, dòng cộng) không đo được theo cột.
        if (tr.cells.length !== soCot) continue;
        can = Math.max(can, tr.cells[vt.i].scrollWidth);
      }
    }
    vt.col.style.width = cu;
    onRong(Math.min(RONG_CO_MAX, Math.max(RONG_CO_MIN, Math.ceil(can) + 2)));
  };

  return (
    <span
      className="lds-keo-cot"
      aria-hidden="true"
      title="Kéo để đổi độ rộng cột, nhấp đúp để vừa nội dung"
      onPointerDown={batDau}
      onDoubleClick={vuaNoiDung}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Cấu hình lưới của người xem theo màn — ẩn, thứ tự, độ rộng, ghim — gói một chỗ để màn chỉ nối một lần:
 *  `luoi.xep(COT)` → lọc ẩn (màn tự lọc, vì có điều kiện riêng) → `luoi.rongHien(...)` ra bộ cột vẽ;
 *  `<ChonCot cot={COT} {...luoi.chonCot} />`, `<CuonLuoi ghim={luoi.soGhim(cotHien)}>`, `{luoi.keo(c.key)}` trong `<th>`. */
export interface CauHinhLuoi {
  an: Set<string>;
  thuTu: string[];
  ghim: string[];
  xep: <T extends CotLuoi>(cot: T[]) => T[];
  rongHien: <T extends { key: string; w?: number }>(cot: T[]) => T[];
  soGhim: (cot: { key?: string; coDinh?: boolean }[]) => number;
  chonCot: {
    an: Set<string>;
    onAn: (s: Set<string>) => void;
    thuTu: string[];
    onThuTu: (v: string[]) => void;
    rong: Record<string, number>;
    onRong: (v: Record<string, number>) => void;
    ghim: string[];
    onGhim: (v: string[]) => void;
  };
  keo: (key: string) => ReactNode;
}

/** Bảng con nhận cấu hình từ màn cha (cha vẫn truyền `cotAn`/`thuTu` để xếp, lọc): áp ghim + độ rộng
 *  lên bộ cột đã xếp, lọc. Vắng `luoi` (test, chỗ dùng không có nút "Cột") thì giữ nguyên. */
export function apLuoi<T extends CotLuoi & { w?: number }>(luoi: CauHinhLuoi | undefined, cot: T[]): T[] {
  return luoi ? luoi.rongHien(apGhim(cot, luoi.ghim)) : cot;
}

export function useCauHinhLuoi(man: string, anMacDinh?: string[]): CauHinhLuoi {
  const [an, datAn] = useCotAn(man, anMacDinh);
  const [thuTu, datThuTu] = useThuTuCot(man);
  const [rong, datRong] = useRongCot(man);
  const [ghim, datGhim] = useCotGhim(man);
  return {
    an,
    thuTu,
    ghim,
    xep: (cot) => apGhim(xepCot(cot, thuTu), ghim),
    rongHien: (cot) => apRong(cot, rong),
    soGhim: (cot) => soCotGhim(cot, ghim),
    chonCot: { an, onAn: datAn, thuTu, onThuTu: datThuTu, rong, onRong: datRong, ghim, onGhim: datGhim },
    // Cột ô chọn (khoá "chon") hẹp cố định — không có gì để kéo.
    keo: (key) => (key === "chon" ? null : <TayKeoCot onRong={(w) => datRong({ ...rong, [key]: w })} />),
  };
}

/** Xếp cột theo thứ tự người xem đã kéo. Cột cố định (mã, ô chọn, nút thao tác) đứng nguyên chỗ;
 *  cột mới thêm sau này (chưa có trong thứ tự đã lưu) chen ngay sau cột đứng trước nó trong thứ tự
 *  mặc định — không dồn xuống cuối, kẻo cột quan trọng mới thêm bị đẩy ra ngoài mép phải. */
export function xepCot<T extends CotLuoi>(cot: T[], thuTu: string[]): T[] {
  if (thuTu.length === 0) return cot;
  const doi = cot.filter((c) => !c.coDinh);
  const hang = (k: string) => thuTu.indexOf(k);
  const xep = doi.filter((c) => hang(c.key) >= 0).sort((a, b) => hang(a.key) - hang(b.key));
  doi.forEach((c, k) => {
    if (hang(c.key) >= 0) return;
    const truoc = k === 0 ? -1 : xep.indexOf(doi[k - 1]);
    xep.splice(truoc + 1, 0, c);
  });
  let i = 0;
  return cot.map((c) => (c.coDinh ? c : xep[i++]));
}

/** Bề rộng tối thiểu của lưới = tổng bề rộng các cột đang hiện + phần cho cột không đặt bề rộng
 *  (cột cuối co giãn: Ghi chú, Người lập…). Đặt cứng một số thì khi tổng các cột vượt số đó,
 *  `table-layout: fixed` chia cho cột co giãn 0px — cột biến mất mà hộp "Cột" vẫn báo đang hiện. */
export function rongLuoi(cot: { w?: number }[], conLai = 150): number {
  return cot.reduce((t, c) => t + (c.w ?? conLai), 0);
}

/** Nút "Cột" mở hộp ẩn/hiện cột; có `onThuTu` thì kéo thả (hoặc phím mũi tên trên tay nắm) để đổi
 *  vị trí cột — lưới đổi theo ngay khi thả. */
export function ChonCot({
  cot,
  an,
  onAn,
  thuTu,
  onThuTu,
  rong,
  onRong,
  ghim,
  onGhim,
}: {
  cot: CotLuoi[];
  an: Set<string>;
  onAn: (s: Set<string>) => void;
  thuTu?: string[];
  onThuTu?: (v: string[]) => void;
  /** Độ rộng cột đã kéo — có thì "Về mặc định" xoá luôn. */
  rong?: Record<string, number>;
  onRong?: (v: Record<string, number>) => void;
  /** Cột đã ghim — có `onGhim` thì mỗi dòng có nút ghim. */
  ghim?: string[];
  onGhim?: (v: string[]) => void;
}) {
  const [mo, setMo] = useState(false);
  // Hộp mở về phía còn chỗ: nút nằm sát mép trái (màn hẹp) thì neo trái, kẻo hộp chui dưới thanh bên.
  const [neoTrai, setNeoTrai] = useState(false);
  // Thứ tự nháp trong lúc đang kéo — thả mới ghi (khỏi vẽ lại cả lưới theo từng nhịp rê chuột).
  const [nhap, setNhap] = useState<string[] | null>(null);
  const [keo, setKeo] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mo) return;
    const dong = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMo(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMo(false);
    document.addEventListener("mousedown", dong);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", dong);
      document.removeEventListener("keydown", esc);
    };
  }, [mo]);

  // Số cột ghim THỰC của lưới đi kèm (CuonLuoi bỏ bớt khi tổng bề rộng quá nửa khung) — đọc sau mỗi
  // lần vẽ để báo cột nào đã bấm ghim mà khung hẹp chưa ghim được.
  const [ghimThuc, setGhimThuc] = useState<number | null>(null);
  const dsGhim = ghim ?? [];
  // Theo dõi `data-ghim` chứ không đọc một lần: lưới có thể đo lại sau lượt vẽ này (đổi bề rộng cột
  // kéo theo ResizeObserver), đọc sớm là báo "chưa ghim được" thoáng qua cho cột đã ghim xong. Đăng ký
  // ở layout effect (trước khi vẽ) để lần đổi `data-ghim` ngay trong lượt này cũng kịp sửa trước khi hiện.
  useLayoutEffect(() => {
    if (!mo || !ref.current) return;
    const tu = ref.current;
    const cuon = Array.from(document.querySelectorAll<HTMLElement>(".lds-cuon")).find(
      (el) => tu.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const doc = () => setGhimThuc(cuon ? Number(cuon.dataset.ghim ?? 0) : null);
    doc();
    if (!cuon || typeof MutationObserver === "undefined") return;
    const theo = new MutationObserver(doc);
    theo.observe(cuon, { attributes: true, attributeFilter: ["data-ghim"] });
    return () => theo.disconnect();
  });

  const keoDuoc = !!onThuTu;
  const macDinh = cot.filter((c) => !c.coDinh).map((c) => c.key);
  const xepDu = apGhim(xepCot(cot, thuTu ?? []), dsGhim);
  const hienTai = xepDu.filter((c) => !c.coDinh).map((c) => c.key);
  const viTriHien = xepDu.filter((c) => !an.has(c.key)).map((c) => c.key);
  const soGhimMenu = hienTai.filter((k) => dsGhim.includes(k)).length;
  const dsKhoa = nhap ?? hienTai;
  const theoKhoa = new Map(cot.map((c) => [c.key, c]));
  const doiCho = (ds: string[], k: string, toi: number) => {
    const moi = ds.filter((x) => x !== k);
    moi.splice(toi, 0, k);
    return moi;
  };
  const xongKeo = () => {
    if (nhap) onThuTu?.(nhap);
    setNhap(null);
    setKeo(null);
  };

  return (
    <div className="lds-cot" ref={ref}>
      <button type="button" className="lds-btn" aria-expanded={mo} onClick={() => {
        const r = ref.current?.getBoundingClientRect();
        const khung = ref.current?.closest(".lds")?.getBoundingClientRect();
        setNeoTrai(!!r && r.right - 240 < (khung?.left ?? 0));
        setMo(!mo);
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M15 4v16" />
        </svg>
        Cột{an.size > 0 ? <span className="lds-flt__so">ẩn {an.size}</span> : null}
      </button>
      {mo ? (
        <div className={`lds-cot__hop${neoTrai ? " lds-cot__hop--trai" : ""}`} role="dialog" aria-label="Chọn cột hiển thị">
          {keoDuoc ? <div className="lds-cot__goi">Kéo để đổi vị trí cột</div> : null}
          {dsKhoa.map((k, i) => {
            const c = theoKhoa.get(k);
            if (!c) return null;
            const daGhim = dsGhim.includes(k);
            const hep = daGhim && !an.has(k) && ghimThuc !== null && viTriHien.indexOf(k) >= ghimThuc;
            return (
              <Fragment key={k}>
                {i === soGhimMenu && soGhimMenu > 0 ? <div className="lds-cot__ngan" /> : null}
                <div
                  className={`lds-cot__dong${keo === k ? " is-keo" : ""}`}
                  draggable={keoDuoc}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", k);
                    setKeo(k);
                    setNhap(hienTai);
                  }}
                  onDragOver={(e) => {
                    if (!keo || !nhap) return;
                    e.preventDefault();
                    if (keo !== k) setNhap(doiCho(nhap, keo, nhap.indexOf(k)));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    xongKeo();
                  }}
                  onDragEnd={xongKeo}
                >
                  {keoDuoc ? (
                    <button
                      type="button"
                      className="lds-cot__nam"
                      aria-label={`Đổi vị trí cột ${c.label}, dùng phím mũi tên lên xuống`}
                      title="Kéo để đổi vị trí"
                      onKeyDown={(e) => {
                        const toi = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : -1;
                        if (toi < 0 || toi >= dsKhoa.length) return;
                        e.preventDefault();
                        onThuTu?.(doiCho(dsKhoa, k, toi));
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="9" cy="6" r="1.6" />
                        <circle cx="15" cy="6" r="1.6" />
                        <circle cx="9" cy="12" r="1.6" />
                        <circle cx="15" cy="12" r="1.6" />
                        <circle cx="9" cy="18" r="1.6" />
                        <circle cx="15" cy="18" r="1.6" />
                      </svg>
                    </button>
                  ) : null}
                  <label>
                    <input
                      type="checkbox"
                      checked={!an.has(k)}
                      onChange={() => {
                        const s = new Set(an);
                        if (s.has(k)) s.delete(k);
                        else s.add(k);
                        onAn(s);
                      }}
                    />
                    {c.label}
                    {hep ? <span className="lds-cot__hep">khung hẹp, chưa ghim được</span> : null}
                  </label>
                  {onGhim ? (
                    <button
                      type="button"
                      className="lds-cot__ghim"
                      aria-pressed={daGhim}
                      aria-label={daGhim ? `Bỏ ghim cột ${c.label}` : `Ghim cột ${c.label} bên trái`}
                      title={daGhim ? "Bỏ ghim" : "Ghim bên trái"}
                      onClick={() => onGhim(daGhim ? dsGhim.filter((x) => x !== k) : [...dsGhim, k])}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill={daGhim ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 3h6l-1 6 4 4H6l4-4-1-6Z" />
                        <path d="M12 13v8" fill="none" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              </Fragment>
            );
          })}
          {an.size > 0 || hienTai.join() !== macDinh.join() || Object.keys(rong ?? {}).length > 0 || dsGhim.length > 0 ? (
            <div className="lds-cot__lai">
              <button
                type="button"
                className="lds-btn lds-btn--xs"
                onClick={() => {
                  onAn(new Set());
                  onThuTu?.([]);
                  onRong?.({});
                  onGhim?.([]);
                }}
              >
                Về mặc định
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Tiêu đề cột bấm được để sắp xếp. `sort` dạng "cot" (tăng) / "-cot" (giảm). */
export function TieuDeSapXep({ label, cot, sort, onSort }: { label: string; cot: string; sort: string; onSort: (s: string) => void }) {
  const dang = sort === cot || sort === `-${cot}`;
  const giam = sort === `-${cot}`;
  return (
    <button type="button" className={`lds-sx${dang ? " on" : ""}`} onClick={() => onSort(giam ? cot : dang ? `-${cot}` : `-${cot}`)}>
      {label}
      {dang ? <span aria-hidden="true">{giam ? "↓" : "↑"}</span> : null}
    </button>
  );
}

/** Ô tìm của đầu trang. */
export function OTim({
  value,
  onChange,
  placeholder,
  ariaLabel,
  maxLength = 200,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
  maxLength?: number;
  /** Cho màn có phím tắt (vd Ctrl K) đặt tiêu điểm vào ô. */
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <label className="lds-tim">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        maxLength={maxLength}
      />
      {value ? (
        <button type="button" className="lds-tim__xoa" aria-label="Xoá ô tìm" onClick={() => onChange("")}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      ) : null}
    </label>
  );
}

/** Tên khách hiện trên lưới: bỏ tiền tố loại hình công ty (tên đủ để ở title). */
export function tenKhachGon(ten: string | null | undefined): string {
  if (!ten) return "";
  return ten.replace(/^\s*(CÔNG TY|Công ty|công ty)\s+(CỔ PHẦN|Cổ phần|cổ phần|CP|TNHH|Tnhh|tnhh)\s+/u, "").trim() || ten;
}

export const soVN = (v: number | null | undefined): string =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v).toLocaleString("vi-VN") : "—";

/** Ngày dạng dd/mm/yyyy từ ISO (ngày hoặc ngày-giờ). */
export function ngayVN(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Số cột ghim tối đa (khớp số quy tắc `data-ghim` trong luoi-ds.css). */
const GHIM_TOI_DA = 6;

/** Số cột đầu được ghim khi cuộn ngang = các cột cố định đứng liền nhau từ trái (ô chọn, mã, tên…)
 *  cộng các cột người xem đã ghim (`apGhim` đã dời chúng lên liền sau). */
export function soCotGhim(cot: { key?: string; coDinh?: boolean }[], ghim: string[] = []): number {
  const i = cot.findIndex((c) => !c.coDinh && !(c.key && ghim.includes(c.key)));
  // Toàn cột ghim (người xem ẩn hết cột khác) thì không có gì để cuộn qua — khỏi ghim.
  return i < 0 ? 0 : Math.min(i, GHIM_TOI_DA);
}

/** Khung cuộn dọc gần nhất (vùng nội dung của ứng dụng) — tiêu đề lưới bám theo nó. */
function khungCuonDoc(el: HTMLElement): HTMLElement | Window {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return window;
}

/** Khung cuộn ngang của lưới, kiểu "cố định khung" của Excel: cuộn trang xuống thì hàng tiêu đề cột
 *  bám mép trên; cuộn ngang thì `ghim` cột đầu đứng yên. Khung KHÔNG trần chiều cao (cả trang cuộn),
 *  nên tiêu đề được đẩy xuống bằng `transform` theo vị trí cuộn chứ không dùng `sticky top` — `sticky`
 *  chỉ bám theo khung cuộn gần nhất, mà khung cuộn ngang này không cuộn dọc. */
export function CuonLuoi({ ghim = 0, children }: { ghim?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const tinhRef = useRef<() => void>(() => {});
  const laDT = useLaDienThoai();

  // ĐIỆN THOẠI (≤ 639px, 14/10/2026): mỗi hàng thành một THẺ. Gắn nhãn cột cho ô do bộ quan sát
  // chung của khung app lo (`useTheHoaBang` — luoiThe.ts); ở đây chỉ đánh dấu khung cuộn để CSS
  // `styles/mobile/the.css` bỏ cuộn ngang + bỏ viền "tờ". Máy lớn không chạy đoạn này.
  useEffect(() => {
    const k = ref.current;
    if (!k) return;
    if (laDT) k.dataset.the = "1";
    else delete k.dataset.the;
  }, [laDT]);

  // Vị trí trái của từng cột ghim = mép trái ô tiêu đề tương ứng (đo lại khi bộ cột đổi: ẩn/hiện, đổi chỗ
  // cột, và khi đổi cỡ cửa sổ). Chỉ ghim những cột đầu mà tổng bề rộng còn ≤ nửa khung — khung hẹp
  // (điện thoại) mà ghim cả Mã + Tên thì cột ghim chiếm hết chỗ, cuộn ngang không tới cột nào khác.
  const datGhim = useRef<() => void>(() => {});
  datGhim.current = () => {
    const k = ref.current;
    if (!k) return;
    // Cộng dồn bề rộng — `offsetLeft` của ô sticky đã cộng cả phần đang trượt nên đo sai.
    const ths = k.querySelectorAll<HTMLTableCellElement>("thead tr:first-child > th");
    // Chưa có bố cục (jsdom, khung đang ẩn) thì mọi bề rộng = 0: giữ đủ `ghim` cột, đo lại khi hiện.
    const coBoCuc = k.clientWidth > 0;
    const tran = k.clientWidth / 2;
    let trai = 0;
    let n = 0;
    for (let i = 0; i < GHIM_TOI_DA; i++) {
      const w = i < ghim && ths[i] ? ths[i].getBoundingClientRect().width : 0;
      const vua = coBoCuc ? w > 0 && trai + w <= tran : i < ghim && !!ths[i];
      if (vua && n === i) {
        k.style.setProperty(`--lds-g${i + 1}`, `${trai}px`);
        trai += w;
        n = i + 1;
      } else k.style.removeProperty(`--lds-g${i + 1}`);
    }
    if (n > 0) k.dataset.ghim = String(n);
    else delete k.dataset.ghim;
  };
  // Đo lại chỉ khi bộ cột đầu đổi (ẩn/hiện, đổi chỗ, đổi rộng). `.lds-g` là `table-layout: fixed`
  // nên dữ liệu đổi không làm đổi bề rộng cột; đổi cỡ khung đã có ResizeObserver lo. Gõ ô tìm vẽ lại
  // cả trang mà không ép trình duyệt tính lại bố cục cho mỗi phím.
  const chuKyRef = useRef("");
  useLayoutEffect(() => {
    const k = ref.current;
    const ths = k?.querySelectorAll<HTMLTableCellElement>("thead tr:first-child > th");
    let chuKy = `${ghim}|${ths?.length ?? 0}`;
    ths?.forEach((th, i) => {
      if (i <= GHIM_TOI_DA) chuKy += `|${th.colSpan}:${th.style.width}:${th.textContent}`;
    });
    k?.querySelectorAll<HTMLTableColElement>("colgroup col").forEach((c) => {
      chuKy += `|${c.style.width}`;
    });
    if (chuKy !== chuKyRef.current) {
      chuKyRef.current = chuKy;
      datGhim.current();
    }
    tinhRef.current();
  });

  useEffect(() => {
    const k = ref.current;
    if (!k) return;
    const khung = khungCuonDoc(k);
    let raf = 0;
    const tinh = () => {
      raf = 0;
      const bang = k.querySelector("table");
      const dau = k.querySelector("thead");
      if (!bang || !dau) return;
      // Không dùng `instanceof Window`: jsdom (vitest) có `Window` khác `window` nên phép thử sai.
      const tren = khung instanceof HTMLElement ? khung.getBoundingClientRect().top : 0;
      const b = bang.getBoundingClientRect();
      const cao = dau.getBoundingClientRect().height;
      // Không đẩy quá dòng cuối: hết bảng thì tiêu đề trôi đi theo bảng.
      const day = Math.max(0, Math.min(tren - b.top, b.height - cao * 2));
      k.style.setProperty("--lds-tieu-de", `${day}px`);
      k.classList.toggle("is-ghim-tren", day > 0);
    };
    const nghe = () => {
      if (!raf) raf = requestAnimationFrame(tinh);
    };
    const ngang = () => k.classList.toggle("is-cuon-ngang", k.scrollLeft > 0);
    tinhRef.current = nghe;
    khung.addEventListener("scroll", nghe, { passive: true });
    const doiCo = () => {
      datGhim.current();
      nghe();
    };
    window.addEventListener("resize", doiCo);
    // Khung đổi bề rộng mà cửa sổ không đổi (thu thanh bên, mở ngăn chi tiết) cũng phải tính lại ghim.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(doiCo);
    ro?.observe(k);
    k.addEventListener("scroll", ngang, { passive: true });
    tinh();
    ngang();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      khung.removeEventListener("scroll", nghe);
      window.removeEventListener("resize", doiCo);
      ro?.disconnect();
      k.removeEventListener("scroll", ngang);
    };
  }, []);

  return (
    // `data-ghim` do datGhim đặt (số cột ghim THỰC, có thể ít hơn `ghim` khi khung hẹp).
    <div className="lds-cuon" ref={ref}>
      {children}
    </div>
  );
}

const GOI_Y_RONG = 340;
const GOI_Y_KHOANG = 8;
const GOI_Y_LE = 12;
const GOI_Y_CHO = 250;
const GOI_Y_RA = 180;

/** Tiêu đề cột của ô — tính theo vị trí cột thật (cộng dồn colSpan), không theo chỉ số ô. */
function tieuDeCot(td: HTMLTableCellElement): string {
  const bang = td.closest("table");
  const hang = td.parentElement;
  if (!bang || !hang) return "";
  let viTri = 0;
  for (const o of Array.from(hang.children) as HTMLTableCellElement[]) {
    if (o === td) break;
    viTri += o.colSpan || 1;
  }
  let dem = 0;
  for (const th of Array.from(bang.querySelectorAll<HTMLTableCellElement>("thead tr:first-child > th"))) {
    if (dem === viTri) return (th.textContent ?? "").replace(/\s+/g, " ").trim();
    dem += th.colSpan || 1;
    if (dem > viTri) return "";
  }
  return "";
}

/** Ô (hoặc phần tử bên trong) đang bị cắt chữ bằng dấu "…". */
function biCat(td: HTMLElement): boolean {
  if (td.scrollWidth > td.clientWidth + 1) return true;
  for (const el of Array.from(td.querySelectorAll<HTMLElement>("*"))) {
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

type GoiY = { tieuDe: string; noi: string; neo: DOMRect; chuotX: number };

/** Bong bóng khi rê chuột lên ô BẤT KỲ bảng nào (danh sách, bảng trong ngăn chi tiết…) — cùng khuôn
 *  `hover-tip` của ma trận quyền (thẻ trắng, tiêu đề + nội dung); rê chuột xuống thẻ được để bôi đen
 *  sao chép. Hiện khi ô bị cắt "…" (đủ chữ) hoặc phần tử trong ô có `title=` (thay bong bóng xám chậm
 *  của trình duyệt). Tiêu đề là tên cột. Gắn MỘT lần ở AppShell; vùng nào không muốn thì đặt
 *  `data-khong-goi-y` lên khung chứa. */
export function GoiYBang() {
  const [gy, setGy] = useState<GoiY | null>(null);
  const [vt, setVt] = useState<{ top: number; left: number; tren: boolean; mui: number } | null>(null);
  const bong = useRef<HTMLDivElement | null>(null);
  // Cầu nối cho thẻ (vẽ qua portal, nằm ngoài khung): rê vào thẻ thì giữ mở để bôi đen + sao chép chữ.
  const cau = useRef({ vaoThe: () => {}, raThe: (_dangGiu: boolean) => {} });

  useEffect(() => {
    const k = document;
    let hen = 0; // chờ hiện
    let henDong = 0; // chờ đóng / chờ đổi sang ô khác — đủ thời gian đưa chuột từ ô xuống thẻ
    let hien = false;
    let dang: HTMLElement | null = null;
    // `title` gốc cất vào đây lúc rê chuột (trình duyệt thôi hiện bong bóng xám), trả lại khi rời.
    let cat: { el: HTMLElement; title: string } | null = null;
    const traTitle = () => {
      if (cat && !cat.el.hasAttribute("title")) cat.el.setAttribute("title", cat.title);
      cat = null;
    };
    const dong = () => {
      window.clearTimeout(hen);
      window.clearTimeout(henDong);
      hen = 0;
      henDong = 0;
      hien = false;
      dang = null;
      traTitle();
      setGy(null);
    };
    const hoan = (viec: () => void) => {
      window.clearTimeout(henDong);
      henDong = window.setTimeout(viec, GOI_Y_RA);
    };
    const moO = (t: Element, chuotX: number) => {
      const coTitle = t.closest<HTMLElement>("[title]");
      const o = t.closest<HTMLTableCellElement>("tbody td");
      // `title` chỉ tính khi nằm TRONG ô bảng — thẻ ngoài bảng giữ bong bóng của trình duyệt.
      const dich = coTitle && coTitle.closest("td, th") ? coTitle : o;
      if (dich === dang) return;
      dong();
      if (!dich || (o && (o.classList.contains("lds-trong") || o.classList.contains("lds-nut")))) return;
      dang = dich;
      let noi = "";
      if (coTitle && dich === coTitle) {
        noi = coTitle.getAttribute("title") ?? "";
        cat = { el: coTitle, title: noi };
        coTitle.removeAttribute("title");
      } else if (o && biCat(o)) {
        noi = (o.innerText || o.textContent || "").trim();
      }
      if (!noi.trim()) return;
      const tieuDe = o ? tieuDeCot(o) : "";
      hen = window.setTimeout(() => {
        if (dang !== dich) return;
        hien = true;
        setVt(null);
        setGy({ tieuDe: tieuDe === noi ? "" : tieuDe, noi, neo: dich.getBoundingClientRect(), chuotX });
      }, GOI_Y_CHO);
    };
    const vao = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || typeof t.closest !== "function" || !t.closest("table") || t.closest("[data-khong-goi-y]")) return;
      // Thẻ đang mở: đường từ ô xuống thẻ băng qua ô dòng dưới — chờ một nhịp, vào thẻ thì huỷ đổi.
      if (hien) hoan(() => moO(t, e.clientX));
      else moO(t, e.clientX);
    };
    const ra = (e: MouseEvent) => {
      const den = e.relatedTarget as Node | null;
      if (dang && den && dang.contains(den)) return;
      if (den instanceof Element && den.closest("table td, table th")) return; // sang ô khác: `vao` lo
      if (den && bong.current?.contains(den)) return; // xuống thẻ: thẻ tự lo
      if (hien) hoan(dong);
      else dong();
    };
    let choNha: (() => void) | null = null;
    cau.current = {
      vaoThe: () => {
        window.clearTimeout(henDong);
        henDong = 0;
      },
      raThe: (dangGiu) => {
        // Đang kéo bôi đen mà chuột trượt ra ngoài thẻ: đợi nhả chuột rồi mới tính đóng.
        if (!dangGiu) return hoan(dong);
        if (choNha) return;
        choNha = () => {
          window.removeEventListener("mouseup", choNha!);
          choNha = null;
          if (!bong.current?.matches(":hover")) hoan(dong);
        };
        window.addEventListener("mouseup", choNha);
      },
    };
    k.addEventListener("mouseover", vao);
    k.addEventListener("mouseout", ra);
    const bam = (e: MouseEvent) => {
      if (!bong.current?.contains(e.target as Node)) dong();
    };
    k.addEventListener("mousedown", bam);
    window.addEventListener("scroll", dong, true);
    window.addEventListener("resize", dong);
    return () => {
      dong();
      if (choNha) window.removeEventListener("mouseup", choNha);
      k.removeEventListener("mouseover", vao);
      k.removeEventListener("mouseout", ra);
      k.removeEventListener("mousedown", bam);
      window.removeEventListener("scroll", dong, true);
      window.removeEventListener("resize", dong);
    };
  }, []);

  useLayoutEffect(() => {
    if (!gy || !bong.current) return;
    const r = gy.neo;
    const b = bong.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Ô rộng: mũi chỉ đúng chỗ con trỏ, không chỉ giữa ô.
    const giua = Math.min(Math.max(gy.chuotX, r.left + 12), r.right - 12);
    const left = Math.min(Math.max(giua - b.width / 2, GOI_Y_LE), vw - b.width - GOI_Y_LE);
    const tren = r.bottom + GOI_Y_KHOANG + b.height > vh - GOI_Y_LE && r.top - GOI_Y_KHOANG - b.height > GOI_Y_LE;
    const top = tren ? r.top - GOI_Y_KHOANG - b.height : r.bottom + GOI_Y_KHOANG;
    setVt({ top, left, tren, mui: Math.min(Math.max(giua - left, 14), b.width - 14) });
  }, [gy]);

  if (!gy) return null;
  return createPortal(
    <div
      ref={bong}
      role="tooltip"
      className={`hover-tip lds-goi-y${vt ? " hover-tip--hien" : ""}${vt?.tren ? " hover-tip--tren" : ""}`}
      onMouseEnter={() => cau.current.vaoThe()}
      onMouseLeave={(e) => cau.current.raThe(e.buttons !== 0)}
      style={{ maxWidth: GOI_Y_RONG, top: vt?.top ?? 0, left: vt?.left ?? 0, ["--mui" as string]: `${vt?.mui ?? 14}px` }}
    >
      {gy.tieuDe && <div className="hover-tip__tieu-de">{gy.tieuDe}</div>}
      {gy.noi.split(/\n+/).map((d, i) => (
        <p key={i} className="hover-tip__dan lds-goi-y__dong">{d.trim()}</p>
      ))}
    </div>,
    document.body,
  );
}

export interface DongTheDem {
  /** Chữ bên trái (tên món). */
  ten: string;
  /** Chữ phụ bên phải, màu nhạt (đơn vị, giá…). */
  phu?: ReactNode;
}

/** Thẻ đếm "N vật tư" trong ô lưới — rê chuột / Tab tới thì nổi thẻ trắng liệt kê từng món (cùng khuôn
 *  thẻ "N mặt hàng" ở danh sách Nhà cung cấp). Thẻ nổi vẽ qua portal toạ độ cố định vì ô lưới cắt
 *  `overflow: hidden`; gần đáy màn thì lật lên; rời chuột có 150ms để kịp rê vào thẻ (bôi đen chép
 *  được). Cuộn trang thì đóng. Bong bóng chung `GoiYBang` không chen vào (`data-khong-goi-y`). */
export function TheDem({ dong, donVi, tieuDe, icon, toiDa = 8 }: {
  dong: DongTheDem[];
  /** Chữ sau số đếm: "vật tư", "máy"… */
  donVi: string;
  tieuDe: string;
  icon?: ReactNode;
  /** Quá số dòng này thì gom "và n món nữa". */
  toiDa?: number;
}) {
  const nut = useRef<HTMLSpanElement | null>(null);
  const hen = useRef<number | undefined>(undefined);
  const [vt, setVt] = useState<{ x: number; y: number; len: boolean } | null>(null);
  const mo = () => {
    window.clearTimeout(hen.current);
    const r = nut.current?.getBoundingClientRect();
    if (!r) return;
    const len = window.innerHeight - r.bottom < 60 + Math.min(dong.length, toiDa) * 26;
    setVt({ x: Math.max(8, Math.min(r.left, window.innerWidth - 308)), y: len ? r.top - 6 : r.bottom + 6, len });
  };
  const dong150 = () => {
    window.clearTimeout(hen.current);
    hen.current = window.setTimeout(() => setVt(null), 150);
  };
  useEffect(() => () => window.clearTimeout(hen.current), []);
  useEffect(() => {
    if (!vt) return;
    const tat = () => setVt(null);
    window.addEventListener("scroll", tat, true);
    return () => window.removeEventListener("scroll", tat, true);
  }, [vt]);
  const con = dong.length - toiDa;
  return (
    <>
      <span
        ref={nut}
        tabIndex={0}
        className={`lds-dem${vt ? " is-mo" : ""}`}
        data-khong-goi-y=""
        aria-label={`${dong.length} ${donVi}: ${dong.map((d) => d.ten).join(", ")}`}
        onMouseEnter={mo}
        onMouseLeave={dong150}
        onFocus={mo}
        onBlur={dong150}
      >
        {icon}
        {dong.length} {donVi}
      </span>
      {vt &&
        createPortal(
          <div
            className={`lds-dem-the${vt.len ? " is-len" : ""}`}
            role="tooltip"
            data-khong-goi-y=""
            style={{ left: vt.x, top: vt.y }}
            onMouseEnter={() => window.clearTimeout(hen.current)}
            onMouseLeave={dong150}
          >
            <div className="lds-dem-the__dau">{tieuDe}</div>
            {dong.slice(0, toiDa).map((d, i) => (
              <div key={i} className="lds-dem-the__dong">
                <span>{d.ten}</span>
                {d.phu != null && d.phu !== "" && <span>{d.phu}</span>}
              </div>
            ))}
            {con > 0 && <div className="lds-dem-the__them">và {con} món nữa — mở thẻ để xem đủ</div>}
          </div>,
          document.body,
        )}
    </>
  );
}
