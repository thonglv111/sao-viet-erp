// XẾP LỊCH — LƯỚI theo khuôn LỊCH NGÀY của bàn Thực hiện SX (mockup
// `docs/mockups/xep-lich-khuon-lich-ngay.html`, duyệt 14/10/2026), thay lưới "nhãn nổi trên thanh"
// của phương án A.
//
// Mỗi lệnh một dòng có kẻ ngang: ô nhãn DÍNH bên trái (mã + trạng thái / tên + máy / khách / số),
// bên phải là các cột ngày. Thanh DÍNH THEO NGUYÊN NGÀY, giờ viết trong thanh — lệnh 2 tiếng trên ô
// ngày 84px theo tỉ lệ giờ chỉ còn vạch 7px. Hai làn như bàn tổ: trên là KẾ HOẠCH (phần còn lại,
// kéo được), dưới là THỰC TẾ (những ngày lệnh đã thật sự chạy).
//
// Cụm lệnh (phát hành cùng nhau) là một dòng tiêu đề, quan hệ chờ nhau nói bằng chip trên dòng đó —
// đường cong nối hai bước bỏ cùng thanh theo giờ.
//
// Kéo thanh dời NGUYÊN NGÀY và giữ giờ trong ngày; thả thẻ từ khay vào ngày nào thì bắt đầu ở đầu ca
// của ngày đó. Hai đầu bóng thanh ghi giờ bắt đầu / xong do MÁY CHỦ tính (đường `thu`), thả xong mới
// ghi. Chỉnh lẻ giờ bằng ◀ ▶ 15 phút, Shift một ca.
import {
  AlertCircle, Building2, CalendarDays, Check, Clock, Layers, Link2, Package, Play, PlayCircle, Printer, Wrench,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";

import type { XlCum, XlDong, XlNgayDacBiet, XlThe, XlVatTu } from "../api/client";
import { coThanh, oNgay, type ONgay } from "./ThsxLichNgay";
import {
  congPhut, gioChu, kieuNgay, moc, mocNgay, quangDongHo, soNgayDu, soNgayGiua, soNgayTre, THU, themNgay,
  thuNgayGio, veDen, veTu, ymd, type KieuNgay,
} from "./xlShared";
import { chuCanhBaoMay } from "./xlCanhBaoMay";

const NGAY_MS = 86_400_000;
/** Bề rộng tối thiểu một ngày theo nấc cửa sổ (cùng bộ số với bàn tổ) — hẹp hơn thì lưới cuộn
 *  ngang thay vì bóp chữ trong thanh: ô 50px cắt "14:00" thành "14…". */
const ngayMin = (soNgay: number) => (soNgay <= 9 ? 96 : soNgay <= 20 ? 64 : 40);
/** Khoảng hở hai bên thanh để hai lệnh liền ngày không dính thành một khối. */
const LE = 4;

export interface HienThi {
  thoang: boolean;
  khach: boolean;
  may: boolean;
  sl: boolean;
  gioChay: boolean;
  soTo: boolean;
  hienXong: boolean;
  vatTu: boolean;
}

export type ThuKetQua = { bat_dau: string; ket_thuc: string; da_doi: boolean; cho_phut: number };

/** Biểu tượng trạng thái cạnh mã lệnh — đúng ba hình của chân màn. */
export function IconTT({ tt }: { tt: string }) {
  if (tt === "da_phat_hanh") {
    return (
      <svg className="xa-tt" viewBox="0 0 16 16" aria-label="Đã phát hành">
        <circle cx="8" cy="8" r="7" fill="#16a34a" />
        <path d="m5 8.2 2 2 4-4.2" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tt === "da_dong") {
    return (
      <svg className="xa-tt" viewBox="0 0 16 16" aria-label="Đã đóng">
        <circle cx="8" cy="8" r="7" fill="#94a3b8" />
        <path d="m5 8.2 2 2 4-4.2" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className="xa-tt" viewBox="0 0 16 16" aria-label="Chưa phát hành">
      <circle cx="8" cy="8" r="6" fill="none" stroke="#2563eb" strokeWidth="1.5" />
      <path d="M8 2a6 6 0 0 1 0 12z" fill="#2563eb" />
    </svg>
  );
}

const lopTT = (tt: string) => (tt === "da_phat_hanh" ? "phat" : tt === "da_dong" ? "dong" : "chua");

const hm = (iso: string | null | undefined) => iso?.match(/[T ](\d{2}:\d{2})/)?.[1] ?? "";
/** Ngày của mốc KẾT THÚC: đúng 00:00 là xong cuối ngày hôm trước. */
const ngayKet = (iso: string) => (/[T ]00:00/.test(iso) ? themNgay(iso.slice(0, 10), -1) : iso.slice(0, 10));
/** "2026-10-14" → "14/10". */
const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const thuCua = (d: string) => THU[new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)).getDay()];

/** Chữ trong thanh kế hoạch: giờ khi gọn trong một ngày, "ngày → ngày" khi vắt nhiều ngày. */
function chuKeHoach(a: string, b: string, rong: number): string {
  const motNgay = a.slice(0, 10) === ngayKet(b);
  const co = coThanh(rong);
  if (co === "mini") return motNgay ? hm(a) : `→ ${dm(ngayKet(b))}`;
  if (!motNgay) return `${dm(a.slice(0, 10))} → ${dm(ngayKet(b))}`;
  return hm(a) === hm(b) ? hm(a) : `${hm(a)}–${hm(b)}`;
}

/** Các dải NGÀY lệnh đã thật sự chạy (gộp ngày liền nhau) + tổng phút đã chạy. */
function dayThucTe(d: XlDong, tu: string, soNgay: number): { dai: { dau: number; cuoi: number }[]; phut: number } {
  const co = Array.from({ length: soNgay }, () => false);
  let phut = 0;
  for (const k of d.doan_thuc_te ?? []) {
    const a = moc(k.tu);
    const b = moc(k.den);
    if (a !== null && b !== null) phut += Math.max(0, b - a) / 60_000;
    const o = oNgay(k.tu, k.den, tu, soNgay);
    if (o) for (let i = o.dau; i <= o.cuoi; i++) co[i] = true;
  }
  const dai: { dau: number; cuoi: number }[] = [];
  co.forEach((c, i) => {
    if (!c) return;
    const cuoi = dai[dai.length - 1];
    if (cuoi && cuoi.cuoi === i - 1) cuoi.cuoi = i;
    else dai.push({ dau: i, cuoi: i });
  });
  return { dai, phut };
}

type Muc =
  | { loai: "cum"; cum: XlCum; ds: XlDong[] }
  | { loai: "lane"; d: XlDong; trongCum: boolean };

type Doi = { lsxId: number; gio: string; luu: boolean };

export function XlLuoi({
  tu, soNgay, dong, ngayNghi, ngayDacBiet, cum, vatTu, hien, chonId, suaDuoc, keoTuKhay,
  onChon, onDatMoc, onThu, caPhut, caDau, trong,
}: {
  tu: string;
  soNgay: number;
  dong: XlDong[];
  ngayNghi: string[];
  ngayDacBiet: XlNgayDacBiet[];
  cum: XlCum[];
  vatTu: Map<number, XlVatTu>;
  hien: HienThi;
  chonId: number | null;
  suaDuoc: boolean;
  keoTuKhay: XlThe | null;
  onChon(lsxId: number): void;
  onDatMoc(lsxId: number, gio: string, expected: string | null): Promise<void> | void;
  onThu(lsxId: number, gio: string, signal: AbortSignal): Promise<ThuKetQua>;
  /** Một ca (phút) — Shift + mũi tên dời đúng một ca. */
  caPhut: number;
  /** Giờ vào ca sớm nhất ("HH:MM") — thả thẻ từ khay vào một ngày thì bắt đầu ở giờ này. */
  caDau: string;
  /** Câu khi lưới trống — màn đang lọc thì nói "không khớp bộ lọc" thay câu mặc định. */
  trong?: ReactNode;
}) {
  const ngoaiRef = useRef<HTMLDivElement>(null);
  const thanRef = useRef<HTMLDivElement>(null);
  const [beNgang, setBeNgang] = useState(1000);
  useLayoutEffect(() => {
    const el = ngoaiRef.current;
    if (!el) return;
    const do_ = () => setBeNgang(el.clientWidth);
    do_();
    const ro = new ResizeObserver(do_);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const nhanW = beNgang <= 640 ? 184 : 268;
  const ngayW = Math.max(ngayMin(soNgay), Math.floor((beNgang - nhanW) / soNgay));
  const W = ngayW * soNgay;
  const tongW = nhanW + W;
  const oHep = ngayW < 60;

  const ngays = useMemo(() => Array.from({ length: soNgay }, (_, i) => themNgay(tu, i)), [tu, soNgay]);
  const nghi = useMemo(() => new Set(ngayNghi), [ngayNghi]);
  const dac = useMemo(() => new Map(ngayDacBiet.map((n) => [n.ngay, n])), [ngayDacBiet]);
  const kieu = useMemo(() => ngays.map((d) => kieuNgay(d, nghi, dac)), [ngays, nghi, dac]);
  const homNay = ymd(new Date());
  const iNay = ngays.indexOf(homNay);
  const iNgay = useCallback((d: string) => soNgayGiua(tu, d) - 1, [tu]);

  // ------------------------------------------------------------ các dòng
  const muc = useMemo(() => {
    const ds = dong
      .filter((d) => hien.hienXong || d.trang_thai !== "da_dong")
      .sort((a, b) => (moc(veTu(a)) ?? 0) - (moc(veTu(b)) ?? 0));
    const cumMap = new Map(cum.map((c) => [c.id, c]));
    const ra: Muc[] = [];
    const daCum = new Set<number>();
    for (const d of ds) {
      const c = d.cum_id != null ? cumMap.get(d.cum_id) : undefined;
      if (!c) { ra.push({ loai: "lane", d, trongCum: false }); continue; }
      if (daCum.has(c.id)) continue;
      daCum.add(c.id);
      const thanh = ds.filter((z) => z.cum_id === c.id);
      ra.push({ loai: "cum", cum: c, ds: thanh });
      for (const z of thanh) ra.push({ loai: "lane", d: z, trongCum: true });
    }
    return ra;
  }, [dong, cum, hien.hienXong]);

  const oCua = useMemo(() => {
    const m = new Map<number, ONgay | null>();
    for (const x of muc) if (x.loai === "lane") m.set(x.d.lsx_id, oNgay(x.d.bat_dau_at, veDen(x.d), tu, soNgay));
    return m;
  }, [muc, tu, soNgay]);

  const demNgay = useMemo(() => {
    const dem = Array.from({ length: soNgay }, () => 0);
    for (const o of oCua.values()) if (o) for (let k = o.dau; k <= o.cuoi; k++) dem[k] += 1;
    return dem;
  }, [oCua, soNgay]);
  const soLenh = oCua.size;

  // ------------------------------------------------------------ kéo / dời bằng phím
  const [doi, setDoi] = useState<Doi | null>(null);
  const doiRef = useRef(doi);
  doiRef.current = doi;
  const keoRef = useRef<{ lsxId: number; batX: number; goc: string; diChuyen: boolean } | null>(null);
  const vuaKeo = useRef(false);
  const [thu, setThu] = useState<{ lsxId: number; gio: string; kq: ThuKetQua } | null>(null);
  const [tha, setTha] = useState<{ gio: string; cx: number; cy: number } | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [peek, setPeek] = useState<{ id: number; r: DOMRect } | null>(null);
  const ganRef = useRef<number | null>(null);
  const hengio = useRef<number | null>(null);
  const hengPeek = useRef<number | null>(null);
  const onThuRef = useRef(onThu);
  onThuRef.current = onThu;
  const dongRef = useRef(dong);
  dongRef.current = dong;

  const ghi = useCallback((lsxId: number, gio: string) => {
    const d = dongRef.current.find((r) => r.lsx_id === lsxId);
    if (!d || gio.slice(0, 16) === (d.bat_dau_at ?? "").slice(0, 16)) {
      setDoi(null);
      return;
    }
    setDoi({ lsxId, gio, luu: true });
    Promise.resolve(onDatMoc(lsxId, gio, d.updated_at)).finally(() => setDoi(null));
  }, [onDatMoc]);

  const keoDuoc = (d: XlDong) => suaDuoc && d.trang_thai !== "da_dong" && !!d.bat_dau_at;

  const batDauKeo = (e: ReactPointerEvent<HTMLDivElement>, d: XlDong) => {
    if (e.button !== 0) return;
    ganRef.current = d.lsx_id;
    if (!keoDuoc(d)) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    keoRef.current = { lsxId: d.lsx_id, batX: e.clientX, goc: d.bat_dau_at as string, diChuyen: false };
  };
  // Kéo theo NGUYÊN NGÀY: thanh vẽ theo ô ngày, nên vị trí trong ô không mang nghĩa giờ nào cả.
  const dangKeo = (e: ReactPointerEvent<HTMLDivElement>) => {
    const k = keoRef.current;
    if (!k) return;
    const dx = e.clientX - k.batX;
    if (!k.diChuyen && Math.abs(dx) < 4) return;
    k.diChuyen = true;
    setPeek(null);
    const gio = congPhut(k.goc, Math.round(dx / ngayW) * 1440);
    if (doiRef.current?.gio !== gio) setDoi({ lsxId: k.lsxId, gio, luu: false });
  };
  const thaKeo = (d: XlDong) => {
    const k = keoRef.current;
    keoRef.current = null;
    if (!k || !k.diChuyen) return;
    vuaKeo.current = true;
    window.setTimeout(() => { vuaKeo.current = false; }, 0);
    const cu = doiRef.current;
    if (cu && cu.lsxId === d.lsx_id && !cu.luu) ghi(d.lsx_id, cu.gio);
  };

  // Mũi tên trái/phải: dời lệnh đang rê (hoặc vừa bấm) 15 phút, Shift = một ca. Gom phím, ngừng
  // 0,7 giây mới ghi — bấm năm nhát là MỘT lần ghi, một bước hoàn tác.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const o = document.activeElement;
      if (o instanceof HTMLElement && (o.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(o.tagName))) return;
      if (document.querySelector(".kt-man, .cdlg-overlay, .xa-lp, .xa-hien")) return;
      const id = hoverId ?? ganRef.current;
      const d = id != null ? dongRef.current.find((r) => r.lsx_id === id) : undefined;
      if (!d || !keoDuoc(d)) return;
      e.preventDefault();
      const buoc = (e.shiftKey ? caPhut : 15) * (e.key === "ArrowLeft" ? -1 : 1);
      setPeek(null);
      const cu = doiRef.current;
      const goc = cu && cu.lsxId === d.lsx_id && !cu.luu ? cu.gio : (d.bat_dau_at as string);
      const gio = congPhut(goc, buoc);
      if (hengio.current) window.clearTimeout(hengio.current);
      hengio.current = window.setTimeout(() => ghi(d.lsx_id, gio), 700);
      doiRef.current = { lsxId: d.lsx_id, gio, luu: false };
      setDoi(doiRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverId, caPhut, ghi, suaDuoc]);

  // Xem trước: hỏi máy chủ giờ bắt đầu / xong của mốc đang kéo (có trễ, bỏ lượt cũ).
  const keoKhayId = keoTuKhay?.lsx_id ?? null;
  const hoi = doi && !doi.luu ? { lsxId: doi.lsxId, gio: doi.gio } : tha && keoKhayId ? { lsxId: keoKhayId, gio: tha.gio } : null;
  const hoiKhoa = hoi ? `${hoi.lsxId}|${hoi.gio}` : "";
  useEffect(() => {
    if (!hoi) return;
    const ac = new AbortController();
    const h = window.setTimeout(() => {
      onThuRef.current(hoi.lsxId, hoi.gio, ac.signal)
        .then((kq) => setThu({ lsxId: hoi.lsxId, gio: hoi.gio, kq }))
        .catch(() => { /* lượt bị huỷ / mạng chập: nhãn giữ "đang tính" */ });
    }, 140);
    return () => { window.clearTimeout(h); ac.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoiKhoa]);
  const kqThu = thu && hoi && thu.lsxId === hoi.lsxId && thu.gio === hoi.gio ? thu.kq : null;

  // Thả từ khay: ô ngày dưới con trỏ, giờ = đầu ca.
  const iDuoiTro = (clientX: number) => {
    const r = thanRef.current?.getBoundingClientRect();
    const xi = clientX - (r?.left ?? 0) - nhanW;
    return xi < 0 ? -1 : Math.min(soNgay - 1, Math.floor(xi / ngayW));
  };
  const thaOver = (e: DragEvent<HTMLDivElement>) => {
    if (!suaDuoc || !keoTuKhay) return;
    const i = iDuoiTro(e.clientX);
    if (i < 0) return;
    e.preventDefault();
    const gio = `${ngays[i]}T${caDau}:00`;
    setTha((cu) => (cu && cu.gio === gio ? { ...cu, cx: e.clientX, cy: e.clientY } : { gio, cx: e.clientX, cy: e.clientY }));
  };
  const thaVao = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const t = tha;
    setTha(null);
    if (!suaDuoc || !keoTuKhay || !t) return;
    onDatMoc(keoTuKhay.lsx_id, t.gio, null);
  };
  useEffect(() => { if (!keoTuKhay) setTha(null); }, [keoTuKhay]);

  // Rê chuột lên thanh: thẻ xem nhanh sau một nhịp.
  const vaoThanh = (id: number, el: HTMLElement) => {
    if (hengPeek.current) window.clearTimeout(hengPeek.current);
    hengPeek.current = window.setTimeout(() => setPeek({ id, r: el.getBoundingClientRect() }), 450);
  };
  const raThanh = () => {
    if (hengPeek.current) window.clearTimeout(hengPeek.current);
    setPeek(null);
  };

  // ------------------------------------------------------------ đầu cột ngày
  const dichNgay = doi && !doi.luu ? doi.gio.slice(0, 10) : tha ? tha.gio.slice(0, 10) : null;
  const iDich = dichNgay ? ngays.indexOf(dichNgay) : -1;
  const [ngh, setNgh] = useState<{ i: number; r: DOMRect } | null>(null);
  const tenKieu = (k: KieuNgay) => (k === "bu" ? "Làm bù" : k === "le" ? "Nghỉ lễ" : "Ngày nghỉ");

  const dau = (
    <div className="xa-lg__dau" style={{ width: tongW }}>
      <div className="xa-lg__goc" style={{ width: nhanW }}>
        <span className="xa-lg__goc-so">{soLenh}</span> lệnh trong khoảng
      </div>
      {ngays.map((d, i) => {
        const k = kieu[i];
        const dacBiet = k === "le" || k === "khac" || k === "bu";
        const lop = [
          "xa-lg__ngay",
          oHep ? "xa-lg__ngay--hep" : "",
          k === "tuan" || k === "le" || k === "khac" ? "xa-lg__ngay--nghi" : "",
          i === iNay ? "xa-lg__ngay--nay" : "",
          i === iDich ? "xa-lg__ngay--dich" : "",
        ].filter(Boolean).join(" ");
        return (
          <div key={d} className={lop} style={{ width: ngayW }}
            title={dac.get(d)?.ten ?? undefined}
            onMouseEnter={dacBiet ? (e) => setNgh({ i, r: e.currentTarget.getBoundingClientRect() }) : undefined}
            onMouseLeave={dacBiet ? () => setNgh(null) : undefined}>
            <span className="xa-lg__ngay-1">
              <span className="xa-lg__thu">{thuCua(d)}</span>
              <span className="xa-lg__so">{oHep ? Number(d.slice(8, 10)) : dm(d)}</span>
            </span>
            {dacBiet
              ? <span className={`xa-cl xa-cl--${k}`}>{oHep ? (k === "bu" ? "Bù" : "Nghỉ") : tenKieu(k)}</span>
              : <span className="xa-lg__dem">{demNgay[i] > 0 ? (oHep ? demNgay[i] : `${demNgay[i]} lệnh`) : " "}</span>}
          </div>
        );
      })}
    </div>
  );

  // Thẻ nổi của ngày đặc biệt: tên, kiểu, lệnh nào chạy qua.
  let theNgh: ReactNode = null;
  if (ngh) {
    const d0 = ngays[ngh.i];
    const k = kieu[ngh.i];
    const a = mocNgay(d0);
    const qua = dong.filter((d) => (moc(veTu(d)) ?? Infinity) < a + NGAY_MS && (moc(veDen(d)) ?? -Infinity) > a);
    theNgh = (
      <div className="xa-ngh" style={{ position: "fixed", left: Math.max(8, Math.min(ngh.r.left, window.innerWidth - 308)), top: ngh.r.bottom + 4 }}>
        <div className="xa-ngh__dau">
          <span className={`xa-cl xa-cl--${k}`}>{tenKieu(k)}</span>
          <span className="xa-mo">{thuCua(d0)} {dm(d0)}/{d0.slice(0, 4)}</span>
        </div>
        {dac.get(d0)?.ten && <p className="xa-ngh__ten">{dac.get(d0)?.ten}</p>}
        <div className="xa-ngh__dong">
          <Printer size={15} />
          <span>{k === "bu" ? "Ngày nghỉ nhưng xưởng đi làm, lịch chạy như ngày thường." : "Xưởng không chạy cả ngày, lệnh dừng lại rồi chạy tiếp ca kế tiếp."}</span>
        </div>
        {qua.length > 0 && (
          <div className="xa-ngh__dong">
            <PlayCircle size={15} />
            <span>{qua.length} lệnh chạy qua
              <span className="xa-ngh__ds">{qua.slice(0, 8).map((d) => <span key={d.lsx_id} className="xa-nho">{d.ma}</span>)}</span>
            </span>
          </div>
        )}
        <div className="xa-ngh__chan">Ngày lễ và làm bù lấy từ màn Lịch làm việc</div>
      </div>
    );
  }

  // ------------------------------------------------------------ một dòng lệnh
  const thanhStyle = (dau: number, cuoi: number, tranTrai = false, tranPhai = false): CSSProperties => {
    const trai = dau * ngayW + (tranTrai ? 0 : LE);
    return { left: trai, width: Math.max(6, (cuoi + 1) * ngayW - (tranPhai ? 0 : LE) - trai) };
  };

  const veLane = (d: XlDong, trongCum: boolean) => {
    const dangDoi = doi?.lsxId === d.lsx_id ? doi : null;
    const kq = dangDoi && !dangDoi.luu ? kqThu : null;
    const tt = lopTT(d.trang_thai);
    const vt = hien.vatTu ? vatTu.get(d.lsx_id) : undefined;
    const tre = soNgayTre(d);
    const o = oCua.get(d.lsx_id) ?? null;
    const chon = chonId === d.lsx_id;
    const coChung = d.lien.some((l) => l.loai === "chung");
    const han = d.han_hoan_thanh_sx ?? d.han_giao_khach;
    const iHan = han ? iNgay(han) : null;

    // Làn trên — KẾ HOẠCH. Trễ hạn: phần sau ngày hạn tách thành đuôi sọc đỏ.
    const thanhKh: ReactNode[] = [];
    if (o && d.bat_dau_at) {
      const chu = (rong: number) => chuKeHoach(d.bat_dau_at as string, veDen(d) ?? (d.bat_dau_at as string), rong);
      const lop = ["xa-lg__kh", `xa-lg__kh--${tt}`, keoDuoc(d) ? "" : "xa-lg__kh--khoa", chon ? "xa-lg__kh--chon" : "",
        coChung ? "xa-lg__kh--chung" : "", dangDoi ? "xa-lg__kh--mo" : ""].filter(Boolean).join(" ");
      const tach = tre > 0 && iHan !== null && iHan < o.cuoi;
      const hetTruoc = tach ? Math.min(o.cuoi, iHan as number) : o.cuoi;
      const coDau = !tach || (iHan as number) >= o.dau;
      const sk = {
        role: "button" as const,
        tabIndex: 0,
        "aria-label": `${d.ma} ${d.ten}, ${chu(200)}`,
        title: `${thuNgayGio(d.bat_dau_at)} đến ${thuNgayGio(veDen(d))}`,
        onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => batDauKeo(e, d),
        onPointerMove: dangKeo,
        onPointerUp: () => thaKeo(d),
        onPointerEnter: (e: ReactPointerEvent<HTMLDivElement>) => vaoThanh(d.lsx_id, e.currentTarget),
        onPointerLeave: raThanh,
        onClick: () => { if (!vuaKeo.current) onChon(d.lsx_id); },
        onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === "Enter") onChon(d.lsx_id); },
      };
      if (coDau) {
        const st = thanhStyle(o.dau, hetTruoc, o.tranTrai, tach ? true : o.tranPhai);
        thanhKh.push(
          <div key="kh" className={`${lop}${o.tranTrai ? " is-tran-trai" : ""}${!tach && o.tranPhai ? " is-tran-phai" : ""}${tach ? " is-cut" : ""}`} style={st} {...sk}>
            {(st.width as number) >= 40 && <span className="xa-lg__chu">{chu(st.width as number)}</span>}
          </div>,
        );
      }
      if (tach) {
        const dauTre = Math.max(o.dau, (iHan as number) + 1);
        const st = thanhStyle(dauTre, o.cuoi, coDau, o.tranPhai);
        thanhKh.push(
          <div key="tre" className={`${lop} xa-lg__kh--tre${coDau ? " is-noi" : ""}`} style={st} {...sk} aria-label={`${d.ma} trễ ${tre} ngày`}>
            {!coDau && (st.width as number) >= 40 && <span className="xa-lg__chu">{chu(st.width as number)}</span>}
          </div>,
        );
      }
    }

    // Bóng thanh lúc kéo: đúng ngày máy chủ tính, chưa có thì dời nguyên khối.
    let bong: ReactNode = null;
    if (dangDoi && d.bat_dau_at) {
      const lech = (moc(dangDoi.gio) ?? 0) - (moc(d.bat_dau_at) ?? 0);
      const den = kq ? kq.ket_thuc : congPhut(veDen(d) ?? d.bat_dau_at, lech / 60_000);
      const ob = oNgay(kq?.bat_dau ?? dangDoi.gio, den, tu, soNgay);
      if (ob) {
        const st = thanhStyle(ob.dau, ob.cuoi, ob.tranTrai, ob.tranPhai);
        const trai = st.left as number;
        const phai = trai + (st.width as number);
        const ngayTha = (kq?.bat_dau ?? dangDoi.gio).slice(0, 10);
        const kTha = kieu[ngays.indexOf(dangDoi.gio.slice(0, 10))];
        const nghiTha = kq?.da_doi && (kTha === "tuan" || kTha === "le" || kTha === "khac");
        const du = kq ? soNgayDu(kq.ket_thuc, han) : null;
        bong = (
          <>
            <div className="xa-lg__bong" style={st} />
            <div className="xa-lg__nk xa-lg__nk--trai" style={{ right: W - trai + 6 }}>
              {kq?.da_doi && <span className="xa-vt xa-vt--nghi"><AlertCircle size={12} />{nghiTha ? `${thuCua(dangDoi.gio.slice(0, 10))} nghỉ` : "ngoài ca"}, tự sang ca kế tiếp</span>}
              {thuCua(ngayTha)} {dm(ngayTha)} {hm(kq?.bat_dau ?? dangDoi.gio)}
            </div>
            <div className="xa-lg__nk" style={{ left: phai + 6 }}>
              {kq ? `xong ${thuNgayGio(kq.ket_thuc)}` : "đang tính…"}
              {kq && kq.cho_phut > 0 && <span className="xa-vt xa-vt--nghi"><Clock size={12} />chờ lệnh khác {quangDongHo(kq.cho_phut)}</span>}
              {du !== null && <span className={`xa-vt ${du >= 0 ? "xa-vt--du" : "xa-vt--tre"}`}>{du >= 0 ? `dư ${du} ngày` : `trễ ${-du} ngày`}</span>}
            </div>
          </>
        );
      }
    }

    // Làn dưới — THỰC TẾ, đúng các ngày lệnh đã chạy. Chữ trạng thái ở dải cuối.
    const { dai, phut } = dayThucTe(d, tu, soNgay);
    const xong = d.trang_thai === "da_dong";
    const thuc = dai.map((p, i) => {
      const st = thanhStyle(p.dau, p.cuoi);
      const rong = st.width as number;
      const cuoi = i === dai.length - 1;
      const kt = d.ket_thuc_thuc_te;
      const chu = xong
        ? (kt ? `${coThanh(rong) === "mini" ? "" : "Xong "}${p.cuoi > p.dau ? `${dm(ngayKet(kt))} ` : ""}${hm(kt)}` : "Đã xong")
        : coThanh(rong) === "mini" ? gioChu(phut) : `Đã chạy ${gioChu(phut)}`;
      return (
        <div key={`t${p.dau}`} className={`xa-lg__thuc xa-lg__thuc--${xong ? "xong" : "chay"}`} style={st}
          title={(d.doan_thuc_te ?? []).map((k) => `${thuNgayGio(k.tu)} đến ${thuNgayGio(k.den)}`).join("\n")}
          onClick={() => onChon(d.lsx_id)}>
          {cuoi && rong >= 40 && <>{xong ? <Check size={12} /> : <Play size={11} />}<span className="xa-lg__chu">{chu}</span></>}
        </div>
      );
    });

    // Hạn: hình thoi ở mép phải ô ngày hạn.
    const mocHanVe = ([[d.han_hoan_thanh_sx, "Hạn SX", false], [d.han_giao_khach, "Giao", true]] as const).map(([h, ten, giao], idx) => {
      if (!h) return null;
      const i = iNgay(h);
      if (i < 0 || i >= soNgay) return null;
      const hx = (i + 1) * ngayW;
      const ketCuoi = moc(kq?.ket_thuc ?? veDen(d));
      const vuot = ketCuoi !== null && ketCuoi > mocNgay(h) + NGAY_MS && (idx === 0 || !d.han_hoan_thanh_sx);
      return (
        <span key={ten}>
          <div className={`xa-lg__moc${vuot ? " xa-lg__moc--vuot" : giao ? " xa-lg__moc--giao" : ""}`} style={{ left: hx }} title={`${ten} ${dm(h)}`} />
          {hien.thoang && <div className={`xa-lg__moc-chu${vuot ? " xa-lg__moc-chu--vuot" : ""}`} style={{ left: hx }}>{ten} {dm(h)}</div>}
        </span>
      );
    });

    // Chữ cảnh báo ở ô nhãn: trễ (đỏ), chờ lệnh khác (vàng).
    const canh: ReactNode[] = [];
    if (!dangDoi && tre > 0) {
      canh.push(<span key="tre" className="xa-canh xa-chu-do"><AlertCircle size={13} />trễ {tre} ngày</span>);
    }
    if (!dangDoi && d.cho_phut > 0) {
      const lien = d.lien.find((l) => l.loai === "cho") ?? d.lien.find((l) => l.loai === "chung");
      const ai = lien ? (lien.loai === "chung" ? "in chung" : lien.ma_khac) : "lệnh khác";
      canh.push(<span key="cho" className="xa-canh xa-chu-vang"><Clock size={13} />chờ {ai} {quangDongHo(d.cho_phut)}</span>);
    }
    const chuMay = chuCanhBaoMay(d.canh_bao_may);
    if (chuMay) {
      canh.push(<span key="may" className="xa-canh xa-chu-do" title={(d.canh_bao_may ?? []).join("\n")}><Wrench size={13} />{chuMay}</span>);
    }
    const so: string[] = [];
    if (hien.sl) so.push(`${d.so_luong_dat.toLocaleString("vi-VN")} ${d.don_vi_tinh ?? ""}`.trim());
    if (hien.gioChay) so.push(`Máy chạy ${gioChu(d.chay_phut)}`);
    if (hien.soTo && d.so_to_ke_hoach > 0) so.push(`${d.so_to_ke_hoach.toLocaleString("vi-VN")} tờ in`);

    return (
      <div key={d.lsx_id}
        className={`xa-lg__hang${hien.thoang ? " xa-lg__hang--thoang" : ""}${trongCum ? " xa-lg__hang--cum" : ""}${chon ? " xa-lg__hang--chon" : ""}`}
        onPointerEnter={() => setHoverId(d.lsx_id)} onPointerLeave={() => setHoverId(null)}>
        <div className="xa-lg__nhan" style={{ width: nhanW }} onClick={() => { ganRef.current = d.lsx_id; onChon(d.lsx_id); }}>
          <div className="xa-lg__dong">
            <span className="xa-lg__ma">{d.ma}</span>
            <IconTT tt={d.trang_thai} />
            {d.is_rush && <span className="xa-gap">Gấp</span>}
            {canh}
          </div>
          <div className="xa-lg__dong">
            <span className="xa-lg__ten" title={d.ten}>{d.ten}</span>
            {hien.thoang && hien.may && d.may_ten && <span className="xa-lg__phu" title={d.may_ten}>{d.may_ten}</span>}
          </div>
          {hien.thoang && hien.khach && d.customer_name && (
            <div className="xa-lg__dong"><span className="xa-lg__phu" title={d.customer_name}>{d.customer_name}</span></div>
          )}
          {hien.thoang && so.length > 0 && (
            <div className="xa-lg__dong xa-lg__so-dong">{so.map((s) => <span key={s}>{s}</span>)}</div>
          )}
          {vt && vt.muc !== "ok" && (
            <div className="xa-lg__dong">
              <span className={`xa-vt xa-vt--${vt.muc === "do" ? "do" : "vang"}`} title={vt.chu}>
                <Package size={12} />{vt.chu || (vt.muc === "do" ? "Thiếu vật tư" : "Chưa giữ vật tư")}
              </span>
            </div>
          )}
        </div>
        <div className="xa-lg__vung" style={{ width: W }}>
          {thanhKh}
          {thuc}
          {mocHanVe}
          {bong}
        </div>
      </div>
    );
  };

  // ------------------------------------------------------------ dòng cụm
  const veCum = (c: XlCum, ds: XlDong[]) => {
    const chuaXep = c.lsx.filter((z) => !z.co_lich).length;
    const chung = ds.flatMap((d) => d.lien.filter((l) => l.loai === "chung" && l.luc_nay && l.luc_khac));
    const lech = chung.reduce((m, l) => Math.max(m, Math.abs((moc(l.luc_nay) ?? 0) - (moc(l.luc_khac) ?? 0))), 0);
    return (
      <div key={`cum${c.id}`} className="xa-lg__cum">
        <div className="xa-lg__nhan xa-lg__nhan--cum" style={{ width: nhanW }}>
          {c.bai_ghep_ma.length ? <Layers size={15} /> : <Link2 size={15} />}
          <span className="xa-lg__ten" title={c.ten}>{c.ten}</span>
        </div>
        <div className="xa-lg__cum-chip" style={{ left: nhanW }}>
          <span className="xa-nho">{c.lsx.length} lệnh{c.phu ? ` ${c.phu}` : ""}</span>
          <span className="xa-nho xa-nho--tim">phát hành cùng nhau</span>
          {chuaXep > 0 && <span className="xa-nho xa-nho--vang">{chuaXep} lệnh chưa xếp lịch</span>}
          {[...new Map(ds.flatMap((d) => d.lien.filter((l) => l.loai === "cho").map((l) => [`${d.lsx_id}-${l.thu_tu}-${l.lsx_id_khac}-${l.thu_tu_khac}`, { d, l }]))).values()].map(({ d, l }) => (
            <span key={`${d.lsx_id}-${l.cong_doan_id}-${l.cong_doan_id_khac}`} className="xa-nho xa-nho--xanh" title={`${d.ma} bước ${l.thu_tu} ${l.ten_buoc} chỉ bắt đầu khi ${l.ma_khac} xong bước ${l.thu_tu_khac} ${l.ten_buoc_khac}`}>
              <Link2 size={12} />{d.ma} bước {l.thu_tu} chờ {l.ma_khac} bước {l.thu_tu_khac}
            </span>
          ))}
          {chung.length > 0 && (lech > 60_000
            ? <span className="xa-canh xa-chu-vang"><AlertCircle size={13} />các lệnh đang in lệch nhau {quangDongHo(lech / 60_000)}</span>
            : <span className="xa-canh" style={{ color: "#6d28d9" }}><Layers size={13} />in chung một lượt {thuNgayGio(chung[0].luc_nay)}</span>)}
        </div>
      </div>
    );
  };

  // ------------------------------------------------------------ thẻ xem nhanh
  let theXem: ReactNode = null;
  const pd = peek && !doi ? dong.find((d) => d.lsx_id === peek.id) : undefined;
  if (pd && peek) {
    const vt = vatTu.get(pd.lsx_id);
    theXem = (
      <div className="xa-peek" style={{ position: "fixed", left: Math.max(8, Math.min(peek.r.left, window.innerWidth - 338)), top: Math.min(peek.r.bottom + 8, window.innerHeight - 250) }}>
        <div className="xa-peek__dau"><span className="xa-ma">{pd.ma}</span>{pd.ten}</div>
        <div className="xa-peek__dong"><Building2 size={14} /><span>{pd.customer_name ?? "Chưa gắn khách"}</span></div>
        <div className="xa-peek__dong"><Printer size={14} /><span>{pd.may_ten ?? "Chưa gán máy"}</span></div>
        <div className="xa-peek__dong"><Package size={14} />
          <span>{pd.so_luong_dat.toLocaleString("vi-VN")} {pd.don_vi_tinh ?? ""}
            {vt && vt.muc !== "ok" && <span className={`xa-vt xa-vt--${vt.muc === "do" ? "do" : "vang"}`}>{vt.chu}</span>}
          </span>
        </div>
        <div className="xa-peek__dong"><PlayCircle size={14} /><span>Máy chạy {gioChu(pd.chay_phut)}</span></div>
        {pd.ket_thuc && <div className="xa-peek__dong"><CalendarDays size={14} /><span>{thuNgayGio(pd.bat_dau_at)} đến {thuNgayGio(veDen(pd))}</span></div>}
        <div className="xa-peek__chan">Bấm để mở chi tiết<span className="xa-gian" />{keoDuoc(pd) && <><kbd>◀</kbd><kbd>▶</kbd> 15 phút</>}</div>
      </div>
    );
  }

  // Bóng thả từ khay: giờ bắt đầu + giờ xong máy chủ tính + hạn.
  let bongTha: ReactNode = null;
  if (tha && keoTuKhay) {
    const han = keoTuKhay.han_hoan_thanh_sx ?? keoTuKhay.han_giao_khach;
    const du = kqThu ? soNgayDu(kqThu.ket_thuc, han) : null;
    const kTha = kieu[ngays.indexOf(tha.gio.slice(0, 10))];
    const nghiTha = kTha === "tuan" || kTha === "le" || kTha === "khac";
    bongTha = (
      <div className="xa-bong-tha" style={{ position: "fixed", left: Math.min(tha.cx + 14, window.innerWidth - 270), top: tha.cy + 14 }}>
        <div>{keoTuKhay.ma}</div>
        {kqThu?.da_doi && nghiTha && <div className="xa-nghi-chu">{thuCua(tha.gio.slice(0, 10))} nghỉ, tự sang ca kế tiếp</div>}
        <div><span className="xa-mo">Bắt đầu</span> {thuNgayGio(kqThu?.bat_dau ?? tha.gio)}</div>
        <div><span className="xa-mo">Dự kiến xong</span> {kqThu ? thuNgayGio(kqThu.ket_thuc) : "đang tính…"}</div>
        {han && du !== null && <div><span className="xa-mo">Hạn {dm(han)}</span> {du >= 0 ? `dư ${du} ngày` : `trễ ${-du} ngày`}</div>}
      </div>
    );
  }

  return (
    <div className={`xa-lg${oHep ? " xa-lg--hep" : ""}`} ref={ngoaiRef}>
      {dau}
      {theNgh}
      <div className="xa-lg__than" ref={thanRef} style={{ width: tongW }}
        onDragOver={thaOver} onDrop={thaVao} onDragLeave={(e) => { if (e.currentTarget === e.target) setTha(null); }}>
        {/* Lớp NỀN kéo hết chiều cao: dải nhãn + vạch cột ngày + tô ngày nghỉ / hôm nay / ngày đích. */}
        <div className="xa-lg__nen" aria-hidden="true">
          <div className="xa-lg__nen-nhan" style={{ width: nhanW }} />
          {ngays.map((d, i) => {
            const k = kieu[i];
            const lop = [
              "xa-lg__nen-cot",
              k === "tuan" ? "xa-to-tuan" : k === "le" || k === "khac" ? "xa-to-le" : "",
              i === iNay ? "xa-lg__nen-cot--nay" : "",
              i === iDich ? "xa-lg__nen-cot--dich" : "",
            ].filter(Boolean).join(" ");
            return <span key={d} className={lop} style={{ left: nhanW + i * ngayW, width: ngayW }} />;
          })}
        </div>
        {muc.length === 0 && (
          <div className="xa-lg__trong" style={{ width: beNgang || undefined }}>
            {keoTuKhay ? "Thả lệnh vào ngày muốn bắt đầu." : (trong ?? "Không có lệnh nào chạy trong khoảng này.")}
          </div>
        )}
        {muc.map((m) => (m.loai === "cum" ? veCum(m.cum, m.ds) : veLane(m.d, m.trongCum)))}
      </div>
      {theXem}
      {bongTha}
    </div>
  );
}
