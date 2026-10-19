// Ô CHỌN NGÀY / NGÀY-GIỜ / GIỜ — thay ô `type="date|datetime-local|time"` của trình duyệt ở MỌI màn.
// Lịch của trình duyệt theo ngôn ngữ MÁY ("Tháng Giêng 2026 ↑ ↓", tuần bắt đầu Chủ nhật, nút Xóa/Hôm nay
// xanh lè) và lệch tông cả app; ô ở đây tự vẽ, cùng một khuôn:
//   - ô gõ được: "8/10/2026", "08102026", giờ "1430", "14h30", "9" đều nhận; gõ xong rời ô là chốt;
//   - bấm vào ô mở lịch nổi (portal ra body nên khung cuộn của hộp thoại không cắt), tuần bắt đầu thứ Hai,
//     bấm tiêu đề tháng để nhảy tháng/năm, ↑ ↓ đi 7 ngày, PageUp/PageDown đi tháng, Enter chọn, Esc đóng;
//   - `className` đặt lên KHUNG ngoài (div) nên lớp cũ của màn (`input`, `rc-input`…) vẫn giữ cỡ/viền.
// Giá trị vào/ra giữ đúng dạng của ô gốc: "YYYY-MM-DD", "YYYY-MM-DDTHH:mm", "HH:mm"; rỗng = chưa chọn.
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { laDienThoai } from "../utils/dienThoai";
import "./chon-ngay.css";

/** Điện thoại: chạm ô ngày / giờ CHỈ mở lịch / danh sách giờ, KHÔNG bật bàn phím số — bàn phím bật lên che
 *  mất cái lịch nằm ngay dưới ô (bàn phím chiếm nửa dưới màn). Máy lớn vẫn gõ tay được như cũ. */
const kieuGo = (): "none" | "numeric" => (laDienThoai() ? "none" : "numeric");

export type MauDanhDau = "la" | "xanh" | "vang" | "do" | "tim";

const THU_NGAN = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const THU_DAI = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const hai = (n: number) => String(n).padStart(2, "0");

// ---------------------------------------------------------------- đọc / ghi

export function ymdCuaNgay(d: Date): string {
  return `${d.getFullYear()}-${hai(d.getMonth() + 1)}-${hai(d.getDate())}`;
}
function docYmd(s: string | null | undefined): Date | null {
  const m = (s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
}
function cong(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
/** "2026-10-08" → "08/10/2026". */
export function hienNgay(s: string | null | undefined): string {
  const d = docYmd(s);
  return d ? `${hai(d.getDate())}/${hai(d.getMonth() + 1)}/${d.getFullYear()}` : "";
}
/** Chữ người gõ → "YYYY-MM-DD" hoặc null. Nhận 8/10/2026, 08-10-2026, 8.10.2026, 08102026; thiếu năm thì lấy năm `namMacDinh`. */
export function docNgayGo(chu: string, namMacDinh = new Date().getFullYear()): string | null {
  const t = chu.trim();
  let d: number, m: number, y: number;
  const so = t.match(/^(\d{2})(\d{2})(\d{4})$/);
  const tach = t.match(/^(\d{1,2})[/.\-\s](\d{1,2})(?:[/.\-\s](\d{2}|\d{4}))?$/);
  if (so) { d = +so[1]; m = +so[2]; y = +so[3]; }
  else if (tach) { d = +tach[1]; m = +tach[2]; y = tach[3] ? (tach[3].length === 2 ? 2000 + +tach[3] : +tach[3]) : namMacDinh; }
  else return null;
  const kq = new Date(y, m - 1, d);
  if (kq.getFullYear() !== y || kq.getMonth() !== m - 1 || kq.getDate() !== d) return null;
  return ymdCuaNgay(kq);
}
/** Chữ người gõ → "HH:mm" hoặc null. Nhận 14:30, 14h30, 1430, 930, 9, 14h. */
export function docGioGo(chu: string): string | null {
  const t = chu.trim().toLowerCase().replace(/\s+/g, "");
  let h: number, p: number;
  const tach = t.match(/^(\d{1,2})[:h.](\d{1,2})?$/);
  const so = t.match(/^(\d{1,4})$/);
  if (tach) { h = +tach[1]; p = tach[2] ? +tach[2] : 0; }
  else if (so) {
    const s = so[1];
    if (s.length <= 2) { h = +s; p = 0; } else { h = +s.slice(0, s.length - 2); p = +s.slice(-2); }
  } else return null;
  if (h > 23 || p > 59) return null;
  return `${hai(h)}:${hai(p)}`;
}
const trongKhoang = (v: string, min?: string, max?: string) => (!min || v >= min) && (!max || v <= max);

// ---------------------------------------------------------------- lịch nổi dùng chung

/** Đặt hộp nổi ngay dưới `neo` (thiếu chỗ thì lật lên), bám theo khi cuộn/đổi cỡ. */
function useViTriNoi(mo: boolean, neo: RefObject<HTMLElement>, hop: RefObject<HTMLElement>, phu: unknown) {
  const [vt, setVt] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!mo) { setVt(null); return; }
    const dat = () => {
      const r = neo.current?.getBoundingClientRect();
      if (!r) return;
      const h = hop.current?.offsetHeight ?? 360;
      const w = hop.current?.offsetWidth ?? 300;
      const duoi = r.bottom + 6 + h <= window.innerHeight - 8;
      const tren = r.top - 6 - h >= 8;
      // Dưới lẫn trên đều thiếu chỗ (điện thoại: ô nằm giữa màn, lịch ngày-giờ cao ~440px) ⇒ kéo hộp
      // lên cho đáy chạm mép màn, đè lên ô — thà che ô còn hơn mất hàng nút "Bây giờ / Xong" dưới đáy.
      setVt({
        top: duoi ? r.bottom + 6 : tren ? r.top - 6 - h : Math.max(8, window.innerHeight - 8 - h),
        left: Math.min(Math.max(8, r.left), window.innerWidth - w - 8),
      });
    };
    dat();
    window.addEventListener("resize", dat);
    window.addEventListener("scroll", dat, true);
    return () => { window.removeEventListener("resize", dat); window.removeEventListener("scroll", dat, true); };
  }, [mo, phu]); // eslint-disable-line react-hooks/exhaustive-deps
  return vt;
}

function HopNoi({ hopRef, vt, nhan, children, rong }: {
  hopRef: RefObject<HTMLDivElement>; vt: { top: number; left: number } | null; nhan: string; children: ReactNode; rong?: number;
}) {
  const st: CSSProperties = vt ? { top: vt.top, left: vt.left } : { visibility: "hidden", top: 0, left: 0 };
  if (rong) st.width = rong;
  // Hộp nổi nằm ở body, ngoài cây DOM của hộp thoại/menu chứa ô — bấm trong nó không được để lọt ra
  // `document`, kẻo mọi "bấm ra ngoài thì đóng" của lớp cha tưởng là bấm ngoài mà đóng cả form.
  // preventDefault: giữ focus ở ô gõ (không thì ô tự chốt + đóng lịch).
  useEffect(() => {
    const el = hopRef.current;
    if (!el) return;
    const chan = (e: Event) => { e.stopPropagation(); if (e.type === "mousedown") e.preventDefault(); };
    el.addEventListener("mousedown", chan);
    el.addEventListener("pointerdown", chan);
    el.addEventListener("touchstart", chan, { passive: true });
    return () => {
      el.removeEventListener("mousedown", chan);
      el.removeEventListener("pointerdown", chan);
      el.removeEventListener("touchstart", chan);
    };
  }, [hopRef]);
  return createPortal(
    <div ref={hopRef} className="cn-hop" role="dialog" aria-label={nhan} style={st}>
      {children}
    </div>,
    document.body,
  );
}

function LichThang({
  value, con, setCon, onChon, min, max, danhDau,
}: {
  value: string;
  con: Date;
  setCon(d: Date): void;
  onChon(ymd: string): void;
  min?: string;
  max?: string;
  danhDau?: Record<string, { mau: MauDanhDau; ten: string }>;
}) {
  const [cheDo, setCheDo] = useState<"ngay" | "thang">("ngay");
  const homNay = ymdCuaNgay(new Date());
  const chon = docYmd(value);
  const dauThang = new Date(con.getFullYear(), con.getMonth(), 1);
  const lui = (dauThang.getDay() + 6) % 7;
  const o = Array.from({ length: 42 }, (_, i) => cong(dauThang, i - lui));
  const doiThang = (n: number) => setCon(new Date(con.getFullYear(), con.getMonth() + n, 1));
  const tenThang = `Tháng ${con.getMonth() + 1} năm ${con.getFullYear()}`;

  return (
    <>
      <div className="cn-dau">
        <button type="button" className="cn-tieu-de" aria-label="Chọn tháng và năm"
          onClick={() => setCheDo((m) => (m === "ngay" ? "thang" : "ngay"))}>
          {cheDo === "ngay" ? tenThang : `Năm ${con.getFullYear()}`}
          <ChevronDown size={14} className={cheDo === "thang" ? "is-lat" : undefined} />
        </button>
        <span className="cn-gian" />
        <button type="button" className="cn-mui" aria-label={cheDo === "ngay" ? "Tháng trước" : "Năm trước"}
          onClick={() => doiThang(cheDo === "ngay" ? -1 : -12)}><ChevronLeft size={16} /></button>
        <button type="button" className="cn-mui" aria-label={cheDo === "ngay" ? "Tháng sau" : "Năm sau"}
          onClick={() => doiThang(cheDo === "ngay" ? 1 : 12)}><ChevronRight size={16} /></button>
      </div>
      {cheDo === "ngay" ? (
        <div className="cn-luoi" role="grid" aria-label={tenThang}>
          {THU_NGAN.map((t, i) => <span key={t} className={`cn-thu${i >= 5 ? " cn-thu--cuoi" : ""}`}>{t}</span>)}
          {o.map((d) => {
            const s = ymdCuaNgay(d);
            const dd = danhDau?.[s];
            const khoa = !trongKhoang(s, min, max);
            const cls = [
              "cn-o",
              d.getMonth() !== con.getMonth() && "cn-o--ngoai",
              (d.getDay() === 0 || d.getDay() === 6) && "cn-o--cuoi",
              s === homNay && "cn-o--nay",
              chon && s === ymdCuaNgay(chon) && "cn-o--chon",
              s === ymdCuaNgay(con) && "cn-o--con",
              khoa && "cn-o--khoa",
            ].filter(Boolean).join(" ");
            return (
              <button key={s} type="button" tabIndex={-1} className={cls} disabled={khoa}
                aria-label={`${THU_DAI[d.getDay()]} ${hienNgay(s)}${dd ? `, ${dd.ten}` : ""}`}
                title={dd ? dd.ten : s === homNay ? "Hôm nay" : undefined}
                onClick={() => onChon(s)}>
                <span>{d.getDate()}</span>
                {dd && <i className={`cn-cham cn-cham--${dd.mau}`} />}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="cn-thang">
          {Array.from({ length: 12 }, (_, i) => (
            <button key={i} type="button"
              className={`cn-th${i === con.getMonth() ? " is-con" : ""}${chon && chon.getFullYear() === con.getFullYear() && chon.getMonth() === i ? " is-chon" : ""}`}
              onClick={() => { setCon(new Date(con.getFullYear(), i, 1)); setCheDo("ngay"); }}>
              Tháng {i + 1}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Phím điều khiển lịch khi focus đang ở ô gõ. Trả true nếu đã xử lý. */
function phimLich(e: React.KeyboardEvent, con: Date, setCon: (d: Date) => void): boolean {
  const buoc: Record<string, number> = { ArrowUp: -7, ArrowDown: 7 };
  if (e.key in buoc) { setCon(cong(con, buoc[e.key])); return true; }
  if (e.key === "PageUp" || e.key === "PageDown") {
    setCon(new Date(con.getFullYear(), con.getMonth() + (e.key === "PageUp" ? -1 : 1), con.getDate()));
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- props chung

interface OChung {
  value: string;
  onChange(v: string): void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  readOnly?: boolean;
  id?: string;
  /** Đặt lên khung ngoài — lớp cũ của màn giữ cỡ, viền. */
  className?: string;
  style?: CSSProperties;
  title?: string;
  placeholder?: string;
  "aria-label"?: string;
  autoFocus?: boolean;
  onBlur?(): void;
  /** Hiện nút ✕ xoá. Mặc định: có khi không `required`. */
  xoaDuoc?: boolean;
}

/** Giá trị NGOÀI đổi (chọn ở chỗ khác, nạp lại…) ⇒ chép lại chữ trong ô. CHỈ chạy khi giá trị đổi thật,
 *  KHÔNG chạy lúc vừa gắn: effect gắn có thể tới trễ (ô hiện ra từ một promise) và đè mất chữ người vừa gõ. */
function useKhiDoi(value: string, chepLai: () => void) {
  const truoc = useRef(value);
  useEffect(() => {
    if (truoc.current === value) return;
    truoc.current = value;
    chepLai();
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
}

function useDongNgoai(mo: boolean, dong: () => void, khung: RefObject<HTMLElement>, hop: RefObject<HTMLElement>) {
  useEffect(() => {
    if (!mo) return;
    const bam = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!khung.current?.contains(t) && !hop.current?.contains(t)) dong();
    };
    document.addEventListener("mousedown", bam);
    return () => document.removeEventListener("mousedown", bam);
  }, [mo]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------------------------------------------------------------- ChonNgay

export function ChonNgay({
  value, onChange, min, max, disabled, required, readOnly, id, className, style, title, placeholder = "dd/mm/yyyy",
  "aria-label": nhan = "Chọn ngày", autoFocus, onBlur, xoaDuoc, danhDau, hienThu,
}: OChung & {
  danhDau?: Record<string, { mau: MauDanhDau; ten: string }>;
  /** Hiện thứ sau ngày ("Thứ Năm") — cho ô rộng. */
  hienThu?: boolean;
}) {
  const khoa = disabled || readOnly;
  const [mo, setMo] = useState(false);
  const [chu, setChu] = useState(hienNgay(value));
  const [con, setCon] = useState<Date>(docYmd(value) ?? new Date());
  const khungRef = useRef<HTMLDivElement>(null);
  const oRef = useRef<HTMLInputElement>(null);
  const hopRef = useRef<HTMLDivElement>(null);
  const vt = useViTriNoi(mo, khungRef, hopRef, con.getMonth());
  const xoa = (xoaDuoc ?? !required) && !!value && !khoa;

  useKhiDoi(value, () => { if (document.activeElement !== oRef.current) setChu(hienNgay(value)); });

  const moLich = () => { if (khoa || mo) return; setCon(docYmd(value) ?? new Date()); setMo(true); };
  const dong = () => setMo(false);
  useDongNgoai(mo, dong, khungRef, hopRef);

  const dat = (v: string) => {
    if (!trongKhoang(v, min, max)) return;
    onChange(v);
    setChu(hienNgay(v));
    setMo(false);
  };
  const chot = () => {
    const t = chu.trim();
    if (!t) { if (value && (xoaDuoc ?? !required)) onChange(""); setChu(""); return; }
    const v = docNgayGo(t, (docYmd(value) ?? new Date()).getFullYear());
    if (v && trongKhoang(v, min, max)) { if (v !== value) onChange(v); setChu(hienNgay(v)); }
    else setChu(hienNgay(value));
  };
  const chon = docYmd(value);
  const mauCo = [...new Set(Object.values(danhDau ?? {}).map((x) => x.mau))];

  return (
    <div ref={khungRef} className={`cn-khung${className ? ` ${className}` : ""}${mo ? " is-mo" : ""}${disabled ? " is-khoa" : ""}`}
      style={style} title={title} onMouseDown={(e) => {
        if (khoa) return;
        if (e.target !== oRef.current) { e.preventDefault(); oRef.current?.focus(); }
        if (!mo) moLich();
      }}>
      <CalendarDays size={15} className="cn-khung__ic" aria-hidden="true" />
      <input ref={oRef} id={id} className="cn-khung__go" value={chu} placeholder={placeholder} disabled={disabled} readOnly={readOnly}
        required={required} aria-label={nhan} aria-haspopup="dialog" aria-expanded={mo} autoFocus={autoFocus} inputMode={kieuGo()}
        autoComplete="off"
        onChange={(e) => {
          setChu(e.target.value);
          const v = docNgayGo(e.target.value, (docYmd(value) ?? new Date()).getFullYear());
          if (v) { const d = docYmd(v); if (d) setCon(d); }
        }}
        onFocus={moLich}
        onBlur={() => { chot(); dong(); onBlur?.(); }}
        onKeyDown={(e) => {
          if (!mo) { if (e.key === "ArrowDown") { e.preventDefault(); moLich(); } return; }
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setChu(hienNgay(value)); dong(); return; }
          if (e.key === "Enter") {
            e.preventDefault(); e.stopPropagation();
            const go = docNgayGo(chu, con.getFullYear());
            if (go && chu.trim() !== hienNgay(value)) { if (trongKhoang(go, min, max)) dat(go); }
            else dat(ymdCuaNgay(con));
            return;
          }
          if (phimLich(e, con, setCon)) e.preventDefault();
        }} />
      {hienThu && chon && <span className="cn-khung__thu">{THU_DAI[chon.getDay()]}</span>}
      {xoa && (
        <button type="button" className="cn-khung__xoa" aria-label="Xoá ngày" tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onChange(""); setChu(""); }}><X size={13} /></button>
      )}
      {mo && (
        <HopNoi hopRef={hopRef} vt={vt} nhan={nhan}>
          <LichThang value={value} con={con} setCon={setCon} onChon={dat} min={min} max={max} danhDau={danhDau} />
          <div className="cn-chan">
            <button type="button" className="cn-nho" onClick={() => dat(ymdCuaNgay(new Date()))}
              disabled={!trongKhoang(ymdCuaNgay(new Date()), min, max)}>Hôm nay</button>
            {(xoaDuoc ?? !required) && value && <button type="button" className="cn-nho cn-nho--tron" onClick={() => { onChange(""); setChu(""); dong(); }}>Xoá</button>}
            {mauCo.length > 0 && (
              <span className="cn-goi-y">{mauCo.map((m) => <i key={m} className={`cn-cham cn-cham--${m}`} />)}ngày đã khai</span>
            )}
          </div>
        </HopNoi>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- ChonGio

const MOC_GIO = Array.from({ length: 96 }, (_, i) => `${hai(Math.floor(i / 4))}:${hai((i % 4) * 15)}`);

/** Danh sách mốc giờ 15 phút để bấm; cuộn sẵn tới giờ đang chọn. */
function DsGio({ value, onChon, min, max }: { value: string; onChon(v: string): void; min?: string; max?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const gan = value || `${hai(new Date().getHours())}:00`;
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-gio="${gan.slice(0, 3)}${hai(Math.floor(+gan.slice(3, 5) / 15) * 15)}"]`);
    if (el && ref.current) ref.current.scrollTop = el.offsetTop - ref.current.clientHeight / 2 + el.offsetHeight / 2;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className="cn-gio-ds">
      {MOC_GIO.map((g) => (
        <button key={g} type="button" data-gio={g} disabled={!trongKhoang(g, min, max)}
          className={`cn-gio${g === value ? " is-chon" : ""}${+g.slice(0, 2) < 6 || +g.slice(0, 2) >= 22 ? " is-dem" : ""}`}
          onClick={() => onChon(g)}>{g}</button>
      ))}
    </div>
  );
}

export function ChonGio({
  value, onChange, min, max, disabled, required, readOnly, id, className, style, title, placeholder = "--:--",
  "aria-label": nhan = "Chọn giờ", autoFocus, onBlur, xoaDuoc,
}: OChung) {
  const khoa = disabled || readOnly;
  const [mo, setMo] = useState(false);
  const [chu, setChu] = useState(value.slice(0, 5));
  const khungRef = useRef<HTMLDivElement>(null);
  const oRef = useRef<HTMLInputElement>(null);
  const hopRef = useRef<HTMLDivElement>(null);
  const vt = useViTriNoi(mo, khungRef, hopRef, null);
  const xoa = (xoaDuoc ?? !required) && !!value && !khoa;
  useKhiDoi(value, () => { if (document.activeElement !== oRef.current) setChu(value.slice(0, 5)); });
  useDongNgoai(mo, () => setMo(false), khungRef, hopRef);

  const dat = (v: string) => { onChange(v); setChu(v); setMo(false); };
  const chot = () => {
    const t = chu.trim();
    if (!t) { if (value && (xoaDuoc ?? !required)) onChange(""); setChu(""); return; }
    const v = docGioGo(t);
    if (v && trongKhoang(v, min, max)) { if (v !== value.slice(0, 5)) onChange(v); setChu(v); }
    else setChu(value.slice(0, 5));
  };

  return (
    <div ref={khungRef} className={`cn-khung cn-khung--gio${className ? ` ${className}` : ""}${mo ? " is-mo" : ""}${disabled ? " is-khoa" : ""}`}
      style={style} title={title} onMouseDown={(e) => {
        if (khoa) return;
        if (e.target !== oRef.current) { e.preventDefault(); oRef.current?.focus(); }
        if (!mo) setMo(true);
      }}>
      <Clock size={15} className="cn-khung__ic" aria-hidden="true" />
      <input ref={oRef} id={id} className="cn-khung__go" value={chu} placeholder={placeholder} disabled={disabled} readOnly={readOnly}
        required={required} aria-label={nhan} aria-haspopup="listbox" aria-expanded={mo} autoFocus={autoFocus} inputMode={kieuGo()}
        autoComplete="off"
        onChange={(e) => setChu(e.target.value)}
        onFocus={() => { if (!khoa) setMo(true); }}
        onBlur={() => { chot(); setMo(false); onBlur?.(); }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && mo) { e.preventDefault(); e.stopPropagation(); setChu(value.slice(0, 5)); setMo(false); }
          else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); chot(); setMo(false); }
        }} />
      {xoa && (
        <button type="button" className="cn-khung__xoa" aria-label="Xoá giờ" tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onChange(""); setChu(""); }}><X size={13} /></button>
      )}
      {mo && (
        <HopNoi hopRef={hopRef} vt={vt} nhan={nhan} rong={128}>
          <DsGio value={value.slice(0, 5)} onChon={dat} min={min} max={max} />
        </HopNoi>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- ChonNgayGio

/** Ô ngày-giờ ("YYYY-MM-DDTHH:mm"): hai ô gõ trong một khung, lịch nổi có thêm cột giờ bên phải. */
export function ChonNgayGio({
  value, onChange, min, max, disabled, required, readOnly, id, className, style, title,
  "aria-label": nhan = "Chọn ngày giờ", autoFocus, onBlur, xoaDuoc, gioMacDinh = "08:00",
}: OChung & { gioMacDinh?: string }) {
  const khoa = disabled || readOnly;
  const ngay = value.slice(0, 10);
  const gioCu = value.slice(11, 16);
  const [mo, setMo] = useState(false);
  const [chuNgay, setChuNgay] = useState(hienNgay(ngay));
  const [chuGio, setChuGio] = useState(gioCu);
  const [con, setCon] = useState<Date>(docYmd(ngay) ?? new Date());
  const khungRef = useRef<HTMLDivElement>(null);
  const ngayRef = useRef<HTMLInputElement>(null);
  const gioRef = useRef<HTMLInputElement>(null);
  const hopRef = useRef<HTMLDivElement>(null);
  const vt = useViTriNoi(mo, khungRef, hopRef, con.getMonth());
  const xoaDuocThat = (xoaDuoc ?? !required) && !khoa;
  const minN = min?.slice(0, 10);
  const maxN = max?.slice(0, 10);

  useKhiDoi(value, () => {
    const a = document.activeElement;
    if (a !== ngayRef.current) setChuNgay(hienNgay(ngay));
    if (a !== gioRef.current) setChuGio(gioCu);
  });
  useDongNgoai(mo, () => setMo(false), khungRef, hopRef);

  const ghep = (n: string, g: string) => {
    const v = `${n}T${g}`;
    if (min && v < min.slice(0, 16)) return;
    if (max && v > max.slice(0, 16)) return;
    onChange(v);
  };
  const chonNgay = (n: string) => { ghep(n, gioCu || chuGioHopLe() || gioMacDinh); setChuNgay(hienNgay(n)); };
  const chuGioHopLe = () => docGioGo(chuGio) ?? "";
  const chonGio = (g: string) => { const n = ngay || ymdCuaNgay(con); ghep(n, g); setChuGio(g); setChuNgay(hienNgay(n)); };

  const roiKhung = (e: React.FocusEvent) => {
    if (khungRef.current?.contains(e.relatedTarget as Node)) return;
    setMo(false);
    onBlur?.();
  };
  const chotNgay = () => {
    const t = chuNgay.trim();
    if (!t) { if (value && xoaDuocThat) onChange(""); setChuNgay(""); setChuGio(""); return; }
    const n = docNgayGo(t, (docYmd(ngay) ?? new Date()).getFullYear());
    if (n && trongKhoang(n, minN, maxN)) { if (n !== ngay) ghep(n, gioCu || chuGioHopLe() || gioMacDinh); setChuNgay(hienNgay(n)); }
    else setChuNgay(hienNgay(ngay));
  };
  const chotGio = () => {
    const g = docGioGo(chuGio);
    if (g) { if (g !== gioCu) { const n = ngay || docNgayGo(chuNgay) || ymdCuaNgay(new Date()); ghep(n, g); setChuNgay(hienNgay(n)); } setChuGio(g); }
    else setChuGio(gioCu);
  };
  const moLich = () => { if (khoa || mo) return; setCon(docYmd(ngay) ?? new Date()); setMo(true); };

  return (
    <div ref={khungRef} className={`cn-khung cn-khung--ngay-gio${className ? ` ${className}` : ""}${mo ? " is-mo" : ""}${disabled ? " is-khoa" : ""}`}
      style={style} title={title} onMouseDown={(e) => {
        if (khoa) return;
        const t = e.target as Node;
        if (t !== ngayRef.current && t !== gioRef.current) { e.preventDefault(); ngayRef.current?.focus(); }
        moLich();
      }}>
      <CalendarDays size={15} className="cn-khung__ic" aria-hidden="true" />
      <input ref={ngayRef} id={id} className="cn-khung__go cn-khung__go--ngay" value={chuNgay} placeholder="dd/mm/yyyy" disabled={disabled}
        readOnly={readOnly} required={required} aria-label={`${nhan}, ngày`} aria-haspopup="dialog" aria-expanded={mo} autoFocus={autoFocus}
        inputMode={kieuGo()} autoComplete="off"
        onChange={(e) => {
          setChuNgay(e.target.value);
          const n = docNgayGo(e.target.value);
          if (n) { const d = docYmd(n); if (d) setCon(d); }
        }}
        onFocus={moLich}
        onBlur={(e) => { chotNgay(); roiKhung(e); }}
        onKeyDown={(e) => {
          if (!mo) { if (e.key === "ArrowDown") { e.preventDefault(); moLich(); } return; }
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setChuNgay(hienNgay(ngay)); setMo(false); return; }
          if (e.key === "Enter") {
            e.preventDefault(); e.stopPropagation();
            const go = docNgayGo(chuNgay, con.getFullYear());
            chonNgay(go && chuNgay.trim() !== hienNgay(ngay) ? go : ymdCuaNgay(con));
            gioRef.current?.focus();
            return;
          }
          if (phimLich(e, con, setCon)) e.preventDefault();
        }} />
      <input ref={gioRef} className="cn-khung__go cn-khung__go--gio" value={chuGio} placeholder="--:--" disabled={disabled} readOnly={readOnly}
        aria-label={`${nhan}, giờ`} inputMode={kieuGo()} autoComplete="off"
        onChange={(e) => setChuGio(e.target.value)}
        onFocus={moLich}
        onBlur={(e) => { chotGio(); roiKhung(e); }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && mo) { e.preventDefault(); e.stopPropagation(); setChuGio(gioCu); setMo(false); }
          else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); chotGio(); setMo(false); }
        }} />
      {xoaDuocThat && value && (
        <button type="button" className="cn-khung__xoa" aria-label="Xoá ngày giờ" tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onChange(""); setChuNgay(""); setChuGio(""); }}><X size={13} /></button>
      )}
      {mo && (
        <HopNoi hopRef={hopRef} vt={vt} nhan={nhan} rong={428}>
          <div className="cn-ngay-gio">
            <div className="cn-ngay-gio__lich">
              <LichThang value={ngay} con={con} setCon={setCon} onChon={chonNgay} min={minN} max={maxN} />
            </div>
            <div className="cn-ngay-gio__gio">
              <div className="cn-ngay-gio__nhan">Giờ</div>
              <DsGio value={gioCu} onChon={chonGio} />
            </div>
          </div>
          <div className="cn-chan">
            <button type="button" className="cn-nho" onClick={() => {
              const b = new Date();
              const v = `${ymdCuaNgay(b)}T${hai(b.getHours())}:${hai(b.getMinutes())}`;
              if (trongKhoang(v, min?.slice(0, 16), max?.slice(0, 16))) { onChange(v); setMo(false); }
            }}>Bây giờ</button>
            {xoaDuocThat && value && <button type="button" className="cn-nho cn-nho--tron" onClick={() => { onChange(""); setMo(false); }}>Xoá</button>}
            <span className="cn-gian" />
            <button type="button" className="cn-nho cn-nho--chinh" onClick={() => setMo(false)}>Xong</button>
          </div>
        </HopNoi>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- ChonThang

/** Ô chọn kỳ ("YYYY-MM"): nút ghi "Tháng 8 năm 2026", bảng nổi 12 tháng + đổi năm. */
export function ChonThang({
  value, onChange, min, max, disabled, id, className, style, title, "aria-label": nhan = "Chọn kỳ",
  nhanTrong = "Chọn kỳ", xoaDuoc = false,
}: Omit<OChung, "placeholder" | "required" | "readOnly" | "autoFocus" | "onBlur"> & { nhanTrong?: string }) {
  const [mo, setMo] = useState(false);
  const [nam, setNam] = useState(() => +(value.slice(0, 4) || new Date().getFullYear()));
  const khungRef = useRef<HTMLButtonElement>(null);
  const hopRef = useRef<HTMLDivElement>(null);
  const vt = useViTriNoi(mo, khungRef, hopRef, nam);
  useDongNgoai(mo, () => setMo(false), khungRef, hopRef);
  const [y, m] = value.split("-");
  const nay = `${new Date().getFullYear()}-${hai(new Date().getMonth() + 1)}`;
  const dat = (v: string) => { onChange(v); setMo(false); khungRef.current?.focus(); };

  return (
    <>
      <button ref={khungRef} type="button" id={id} disabled={disabled} title={title} style={style}
        className={`cn-khung cn-khung--thang${className ? ` ${className}` : ""}${mo ? " is-mo" : ""}${disabled ? " is-khoa" : ""}`}
        aria-label={`${nhan}: ${y && m ? `tháng ${+m} năm ${y}` : nhanTrong}`} aria-haspopup="dialog" aria-expanded={mo}
        onClick={() => { if (!mo) setNam(+(value.slice(0, 4) || new Date().getFullYear())); setMo((x) => !x); }}
        onKeyDown={(e) => { if (e.key === "Escape" && mo) { e.preventDefault(); e.stopPropagation(); setMo(false); } }}>
        <CalendarDays size={15} className="cn-khung__ic" aria-hidden="true" />
        <span className={`cn-khung__chu${y && m ? "" : " cn-khung__chu--trong"}`}>{y && m ? `Tháng ${+m} năm ${y}` : nhanTrong}</span>
        <ChevronDown size={14} className="cn-khung__mui" aria-hidden="true" />
      </button>
      {mo && (
        <HopNoi hopRef={hopRef} vt={vt} nhan={nhan} rong={264}>
          <div className="cn-dau">
            <span className="cn-tieu-de cn-tieu-de--tinh">Năm {nam}</span>
            <span className="cn-gian" />
            <button type="button" className="cn-mui" aria-label="Năm trước" onClick={() => setNam(nam - 1)}><ChevronLeft size={16} /></button>
            <button type="button" className="cn-mui" aria-label="Năm sau" onClick={() => setNam(nam + 1)}><ChevronRight size={16} /></button>
          </div>
          <div className="cn-thang">
            {Array.from({ length: 12 }, (_, i) => {
              const v = `${nam}-${hai(i + 1)}`;
              return (
                <button key={v} type="button" disabled={!trongKhoang(v, min, max)}
                  className={`cn-th${v === value ? " is-chon" : ""}${v === nay ? " is-nay" : ""}`} onClick={() => dat(v)}>
                  Tháng {i + 1}
                </button>
              );
            })}
          </div>
          <div className="cn-chan">
            <button type="button" className="cn-nho" disabled={!trongKhoang(nay, min, max)} onClick={() => dat(nay)}>Tháng này</button>
            {xoaDuoc && value && <button type="button" className="cn-nho cn-nho--tron" onClick={() => dat("")}>{nhanTrong}</button>}
          </div>
        </HopNoi>
      )}
    </>
  );
}
