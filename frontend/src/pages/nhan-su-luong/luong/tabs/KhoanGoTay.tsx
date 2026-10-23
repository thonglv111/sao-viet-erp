// Ô gõ kiểu Excel cho màn Khoán theo tổ (kế toán sửa tay 23/10/2026) — mockup đã duyệt
// `docs/mockups/ke-toan-dieu-chinh-khoan-excel.html`. Bấm ô để chọn, gõ luôn hoặc bấm đúp/Enter/F2; Enter lưu
// và xuống ô dưới cùng cột, Tab sang phải, Esc bỏ, mũi tên đi lại, Delete xoá. Lưu xong màn tải lại payload —
// số do máy chủ tính, ở đây không tự tính.
//
// Khoá ô "<dòng>|<cột>": dòng `b<batch>` (lần ghi), `t<id>` (dòng tay), `c<emp>` (cộng thêm), `moi` (dòng trống
// cuối sổ); cột tien / gc / ngay / nd / ng / cong.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

type Buoc = "xuong" | "len" | "tab" | "tablui";
export type MucMenu = { nhan: string; lam: () => void };

interface LuoiGo {
  chon: string | null;
  dangGo: { k: string; chuDau?: string } | null;
  chonO: (k: string | null) => void;
  moGo: (k: string, chuDau?: string) => void;
  luu: (k: string, chu: string, buoc?: Buoc) => void;
  boGo: () => void;
  moMenu: (k: string, x: number, y: number) => void;
}

const Ctx = createContext<LuoiGo | null>(null);

/** Cột số: chỉ nhận phím số / dấu trừ khi gõ thẳng vào ô đang chọn. */
const laCotSo = (k: string) => /\|(tien|cong)$/.test(k);

/** "45.000" / "−50 000" / "1,5" → số; "" → null; chữ lạ → undefined. */
export function docSo(s: string): number | null | undefined {
  const t = s.trim().replace(/[−–]/g, "-").replace(/[.\s]/g, "").replace(",", ".");
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? Math.round(v) : undefined;
}

/** "5", "05/10", "5/10/2026" → "2026-10-05" nếu nằm trong kỳ; sai ⇒ null. */
export function docNgay(s: string, year: number, month: number): string | null {
  const x = s.trim().match(/^(\d{1,2})(?:\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?)?$/);
  if (!x) return null;
  const d = Number(x[1]);
  if (x[2] && Number(x[2]) !== month) return null;
  if (x[3] && Number(x[3]) % 100 !== year % 100) return null;
  if (d < 1 || d > new Date(year, month, 0).getDate()) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Ô kế tiếp trong cùng bảng: cùng cột (Enter, mũi tên) hoặc theo thứ tự (Tab). */
function oKe(goc: HTMLElement | null, k: string, buoc: Buoc): string {
  const o = goc?.querySelector<HTMLElement>(`td.ktt-nhap[data-k="${CSS.escape(k)}"]`);
  const bang = o?.closest("table");
  if (!bang) return k;
  const ds = [...bang.querySelectorAll<HTMLElement>("td.ktt-nhap")].map((x) => x.dataset.k ?? "");
  if (buoc === "tab" || buoc === "tablui") {
    const i = ds.indexOf(k);
    return ds[Math.max(0, Math.min(ds.length - 1, i + (buoc === "tab" ? 1 : -1)))] ?? k;
  }
  const cot = k.split("|")[1];
  const cung = ds.filter((x) => x.split("|")[1] === cot);
  const i = cung.indexOf(k);
  return cung[Math.max(0, Math.min(cung.length - 1, i + (buoc === "len" ? -1 : 1)))] ?? k;
}

/** Vỏ lưới gõ: giữ ô đang chọn / đang gõ, bắt phím, menu chuột phải. `luu` lưu + tải lại rồi trả khoá ô
 *  mới (dòng trống vừa thành dòng tay); `xoa` cho phím Delete; `menu` cho chuột phải; `moRieng` mở ô
 *  không gõ chữ (chọn người). */
export function LuoiGoTay({ children, duoc, luu, xoa, menu, moRieng }: {
  children: ReactNode;
  duoc: boolean;
  luu: (k: string, chu: string) => Promise<string | void>;
  xoa: (k: string) => void;
  menu: (k: string) => MucMenu[] | null;
  moRieng: (k: string, o: HTMLElement) => boolean;
}) {
  const goc = useRef<HTMLDivElement>(null);
  const [chon, setChon] = useState<string | null>(null);
  const [dangGo, setDangGo] = useState<LuoiGo["dangGo"]>(null);
  const [cho, setCho] = useState<{ k: string; buoc: Buoc } | null>(null);
  const [mn, setMn] = useState<{ x: number; y: number; ds: MucMenu[] } | null>(null);

  const chonO = useCallback((k: string | null) => {
    setChon(k);
    if (k) goc.current?.focus({ preventScroll: true });
  }, []);

  const moGo = useCallback((k: string, chuDau?: string) => {
    if (!duoc) return;
    const o = goc.current?.querySelector<HTMLElement>(`td.ktt-nhap[data-k="${CSS.escape(k)}"]`);
    if (!o) return;
    if (moRieng(k, o)) return;
    setChon(k);
    setDangGo({ k, chuDau });
  }, [duoc, moRieng]);

  const luuO = useCallback((k: string, chu: string, buoc?: Buoc) => {
    setDangGo(null);
    // Rời ô bằng chuột (blur) thì ô mới đã được chọn rồi — chỉ đi tiếp khi lưu bằng phím.
    void luu(k, chu).then((k2) => {
      if (buoc) setCho({ k: k2 || k, buoc });
    });
  }, [luu]);

  // Đi tiếp SAU khi payload mới đã vẽ (dòng tay vừa thêm mới có ô).
  useLayoutEffect(() => {
    if (!cho) return;
    setChon(oKe(goc.current, cho.k, cho.buoc));
    goc.current?.focus({ preventScroll: true });
    setCho(null);
  }, [cho]);

  useEffect(() => {
    if (!mn) return;
    const dong = () => setMn(null);
    window.addEventListener("mousedown", dong);
    window.addEventListener("scroll", dong, true);
    return () => {
      window.removeEventListener("mousedown", dong);
      window.removeEventListener("scroll", dong, true);
    };
  }, [mn]);

  const moMenu = useCallback((k: string, x: number, y: number) => {
    const ds = duoc ? menu(k) : null;
    setChon(k);
    setMn(ds && ds.length ? { x, y, ds } : null);
  }, [duoc, menu]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!chon || dangGo || !duoc) return;
    const t = e.target as HTMLElement;
    if (t !== goc.current) return;   // phím trong ô chọn người / menu
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setChon(oKe(goc.current, chon, e.key === "ArrowUp" ? "len" : "xuong"));
    } else if (e.key === "Tab") {
      e.preventDefault();
      setChon(oKe(goc.current, chon, e.shiftKey ? "tablui" : "tab"));
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      moGo(chon);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      xoa(chon);
    } else if (e.key === "Escape") {
      setChon(null);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
               && !chon.endsWith("|ng") && (!laCotSo(chon) || /[0-9-]/.test(e.key))) {
      e.preventDefault();
      moGo(chon, e.key);
    }
  }

  const ctx: LuoiGo = { chon, dangGo, chonO, moGo, luu: luuO, boGo: () => setDangGo(null), moMenu };
  return (
    <Ctx.Provider value={ctx}>
      <div ref={goc} tabIndex={-1} className={`ktt-luoi${duoc ? "" : " ktt-luoi--khoa"}`} onKeyDown={onKeyDown}>
        {children}
      </div>
      {mn && (
        <div className="ktt-menu" style={{ left: mn.x, top: mn.y }} role="menu"
          onMouseDown={(e) => e.stopPropagation()}>
          {mn.ds.map((m) => (
            <button type="button" role="menuitem" key={m.nhan} onClick={() => { setMn(null); m.lam(); }}>{m.nhan}</button>
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}

/** Một ô gõ được. `giaTri` = chữ đặt sẵn vào ô khi mở gõ; `tay` = có tam giác đỏ (số kế toán gõ). Ngoài
 *  `LuoiGoTay` hoặc `duoc=false` ⇒ ô chỉ đọc thường. */
export function OGo({ k, giaTri, tay, lop = "", colSpan, children, duoc = true }: {
  k: string;
  giaTri: string;
  tay?: boolean;
  lop?: string;
  colSpan?: number;
  children?: ReactNode;
  duoc?: boolean;
}) {
  const g = useContext(Ctx);
  const ip = useRef<HTMLInputElement>(null);
  const xong = useRef(false);   // đã lưu / bỏ bằng phím ⇒ blur sau đó không lưu lần hai
  const go = g?.dangGo?.k === k;
  useLayoutEffect(() => {
    const el = ip.current;
    if (!go || !el) return;
    xong.current = false;
    el.focus();
    if (g?.dangGo?.chuDau === undefined) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, [go]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!g || !duoc) {
    return <td className={`${lop}${tay ? " ktt-tay" : ""}`} colSpan={colSpan}>{children}</td>;
  }
  const lopDu = `ktt-nhap ${lop}${tay ? " ktt-tay" : ""}${g.chon === k ? " ktt-chon-o" : ""}`;
  return (
    <td
      className={lopDu}
      data-k={k}
      colSpan={colSpan}
      onMouseDown={(e) => {
        if (e.button !== 0 || go) return;
        g.chonO(k);
        e.preventDefault();   // giữ focus ở vỏ lưới để phím đi tiếp
      }}
      onDoubleClick={() => g.moGo(k)}
      onContextMenu={(e) => {
        if (k.startsWith("moi|")) return;
        e.preventDefault();
        g.moMenu(k, e.clientX, e.clientY);
      }}
    >
      {go ? (
        <input
          ref={ip}
          aria-label="Ô đang gõ"
          defaultValue={g.dangGo?.chuDau ?? giaTri}
          onKeyDown={(e) => {
            e.stopPropagation();
            const buoc = ({ Enter: "xuong", ArrowDown: "xuong", ArrowUp: "len" } as Record<string, Buoc>)[e.key]
              ?? (e.key === "Tab" ? (e.shiftKey ? "tablui" : "tab") : undefined);
            if (buoc) {
              e.preventDefault();
              xong.current = true;
              g.luu(k, e.currentTarget.value, buoc);
            } else if (e.key === "Escape") {
              e.preventDefault();
              xong.current = true;
              g.boGo();
              g.chonO(k);
            }
          }}
          onBlur={(e) => {
            if (xong.current) return;
            xong.current = true;
            g.luu(k, e.currentTarget.value);
          }}
        />
      ) : children}
    </td>
  );
}

/** Ô chọn người tham gia dòng tay — tick bớt / thêm, lưu ngay mỗi lần tick, phải còn ít nhất một người. */
export function ChonNguoi({ x, y, tren, ds, chon, doi, dong }: {
  x: number;
  y: number;
  /** Mép trên ô — dưới không đủ chỗ thì bật lên trên mép này. */
  tren: number;
  ds: { emp_id: number; ten: string }[];
  chon: number[];
  doi: (ids: number[]) => void;
  dong: () => void;
}) {
  const vo = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(y);
  useLayoutEffect(() => {
    const h = vo.current?.offsetHeight ?? 0;
    setTop(y + h + 8 <= window.innerHeight ? y : Math.max(8, tren - h - 2));
  }, [y, tren, ds.length]);
  useEffect(() => {
    vo.current?.querySelector("input")?.focus();
    const ngoai = (e: MouseEvent) => {
      if (!vo.current?.contains(e.target as Node)) dong();
    };
    window.addEventListener("mousedown", ngoai);
    return () => window.removeEventListener("mousedown", ngoai);
  }, [dong]);
  return (
    <div ref={vo} className="ktt-dsng" style={{ left: x, top }} role="group" aria-label="Người tham gia"
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          dong();
        }
      }}>
      {ds.map((n) => (
        <label key={n.emp_id}>
          <input
            type="checkbox"
            checked={chon.includes(n.emp_id)}
            onChange={(e) => {
              const moi = e.target.checked ? [...chon, n.emp_id] : chon.filter((x) => x !== n.emp_id);
              if (moi.length) doi(moi);
            }}
          />
          {n.ten}
        </label>
      ))}
    </div>
  );
}
