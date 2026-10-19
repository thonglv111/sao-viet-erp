// XẾP LỊCH — NGĂN CHI TIẾT một lệnh. Vỏ là `NganPhai` dùng chung (rộng 1180px, kéo mép trái, Esc,
// ↑ ↓ đổi lệnh). Thân theo phương án B (`docs/mockups/xep-lich-ngan-gon-3-phuong-an.html`, 08/10/2026):
//   dải ô số một hàng (bắt đầu · xong · tổng · máy chạy · hạn) →
//   bảng bước, cột cuối là thanh thời gian của chính lệnh trên trục ngày (vùng gạch = ngoài ca) →
//   hai khối thấp: Phát hành cùng nhau · Quy cách và vật tư.
// Mục tiêu: một lần nhìn thấy hết, không phải cuộn. Tab "Lịch sử phát hành" giữ nguyên luồng so hai phiên bản.
import {
  AlertCircle, ArrowLeft, ArrowRight, Box, Building2, CalendarClock, Check, Clock, Copy, ExternalLink,
  FileText, FoldVertical, Layers, Link2, Package, PackageCheck, PlayCircle, Printer,
  RotateCcw, Scissors, Send, Sparkles, Tag, Target, Trash2, Truck, UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import type {
  XlChiTiet, XlCongDoan, XlGoiPhatHanh, XlNoi, XlSoSanh, XlVatTu,
} from "../api/client";
import { ChonNgayGio } from "../components/ChonNgay";
import { EmptyState } from "../components/EmptyState";
import { NganPhai } from "./ke-toan/shared/NganPhai";
import { IconTT } from "./XlLuoi";
import {
  congPhut, gio, gioChu, moc, quangDongHo, soNgayDu, thuNgay, thuNgayGio, type XlPhanTachNghi,
} from "./xlShared";
import "./ke-toan/ke-toan.css";
import { cauChuaTinhGio, goiDaThuHoi, soBuocChuaGio } from "./xlNganSo";

/** Bộ màu + biểu tượng theo loại bước — cùng bộ của lưới (`.xa-m-*`). */
function theBuoc(ten: string): { ic: ReactNode; mau: string } {
  const t = ten.toLowerCase();
  if (t.includes("ctp") || t.includes("bản") || t.includes("kẽm")) return { ic: <Layers size={14} />, mau: "xa-m-cham" };
  if (t.includes("cắt") || t.includes("xả") || t.includes("xén")) return { ic: <Scissors size={14} />, mau: "xa-m-cat" };
  if (t.includes("in")) return { ic: <Printer size={14} />, mau: "xa-m-in" };
  if (t.includes("cán") || t.includes("màng") || t.includes("phủ") || t.includes("uv") || t.includes("ép kim")) return { ic: <Sparkles size={14} />, mau: "xa-m-can" };
  if (t.includes("bế") || t.includes("dập")) return { ic: <Box size={14} />, mau: "xa-m-tp" };
  if (t.includes("dán") || t.includes("gấp") || t.includes("đóng cuốn") || t.includes("khâu") || t.includes("keo")) return { ic: <FoldVertical size={14} />, mau: "xa-m-xanh" };
  if (t.includes("kcs") || t.includes("đóng gói") || t.includes("giao")) return { ic: <PackageCheck size={14} />, mau: "xa-m-la" };
  return { ic: <Box size={14} />, mau: "xa-m-xam" };
}

const TT_BUOC: Record<string, string> = {
  released: "Chờ chạy", running: "Đang chạy", paused: "Tạm dừng", completed: "Xong",
};

const NGAY_MS = 86_400_000;

/** "T2 12/10 14:00 đến 18:00" — cùng ngày thì vế sau chỉ ghi giờ. */
function tuDen(a: string | null, b: string | null): string {
  if (!a || !b) return "";
  return a.slice(0, 10) === b.slice(0, 10) ? `${thuNgayGio(a)} đến ${b.slice(11, 16)}` : `${thuNgayGio(a)} đến ${thuNgayGio(b)}`;
}

function DuTre({ du }: { du: number | null }) {
  if (du === null) return null;
  return du >= 0
    ? <span className="xa-nho xa-nho--la">còn dư {du} ngày</span>
    : <span className="xa-nho xa-nho--do">trễ {-du} ngày</span>;
}

function TrangThaiLenh({ ct }: { ct: XlChiTiet }) {
  if (ct.trang_thai === "da_dong") return <span className="xa-vien xa-vien--xam">Đã đóng</span>;
  if (ct.trang_thai === "da_phat_hanh") return <span className="xa-vien xa-vien--la">Đã phát hành</span>;
  if (!ct.bat_dau_at) return <span className="xa-vien xa-vien--vang">Chưa xếp lịch</span>;
  return <span className="xa-vien xa-vien--xanh">Có lịch, chưa phát hành</span>;
}

/** Câu đầy đủ của một dải nối — để trong `title` của nhãn ngắn trên trục. */
function cauLien(l: XlNoi): string {
  if (l.loai === "cho") {
    return l.luc_khac
      ? `Chờ bước ${l.thu_tu_khac} ${l.ten_buoc_khac} của ${l.ten_lenh_khac} ${l.ma_khac} xong lúc ${thuNgayGio(l.luc_khac)}`
      : `Chờ bước ${l.thu_tu_khac} ${l.ten_buoc_khac} của ${l.ten_lenh_khac} ${l.ma_khac}. Lệnh đó chưa xếp lịch nên chưa biết lúc nào xong.`;
  }
  if (l.loai === "doi") {
    return `${l.ten_lenh_khac} ${l.ma_khac} chờ bước này xong mới vào bước ${l.thu_tu_khac} ${l.ten_buoc_khac}. Bước này xong muộn bao nhiêu, lệnh đó xong muộn bấy nhiêu.`;
  }
  return `In chung một tờ với ${l.ma_khac} ${l.ten_lenh_khac}${l.bai_ghep_ma ? `, bài ghép ${l.bai_ghep_ma}` : ""}.`
    + (l.luc_nay ? ` Một lượt máy lúc ${thuNgayGio(l.luc_nay)} cho cả hai lệnh.` : "");
}

/** Nhãn ngắn của dải nối, nằm cạnh thanh. */
function nhanLien(l: XlNoi): string {
  if (l.loai === "cho") return `chờ ${l.ma_khac} bước ${l.thu_tu_khac}`;
  if (l.loai === "doi") return `${l.ma_khac} chờ ở đây`;
  return `in chung ${l.ma_khac}`;
}

/** Lý do hai lệnh trong cụm dính nhau, nhìn từ lệnh đang mở. */
function lyDoCum(lien: XlNoi[], khacId: number): string[] {
  const ra = new Set<string>();
  for (const l of lien.filter((z) => z.lsx_id_khac === khacId)) {
    if (l.loai === "cho") ra.add(`lệnh này chờ lệnh kia ở bước ${l.thu_tu}`);
    else if (l.loai === "doi") ra.add(`lệnh kia chờ lệnh này ở bước ${l.thu_tu_khac}`);
    else ra.add(`in chung bước ${l.thu_tu}${l.bai_ghep_ma ? ` bài ${l.bai_ghep_ma}` : ""}`);
  }
  return [...ra];
}

/** Số đêm thanh vắt qua — "Ngoài ca 3 đêm". */
function soDem(a: string | null, b: string | null): number {
  const x = moc(a?.slice(0, 10) + "T00:00");
  const y = moc(b?.slice(0, 10) + "T00:00");
  return x !== null && y !== null ? Math.round((y - x) / NGAY_MS) : 0;
}

// ---------------------------------------------------------------- hình học trục thời gian

function phutTrongNgay(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : null;
}

function dauNgay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function ymd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Khung ca trong một ngày, phút tính từ 00:00, đã sắp. Ca vắt qua nửa đêm tách hai khúc. */
function khungCa(pt: XlPhanTachNghi | null): [number, number][] {
  const ds = (pt?.cac_ca?.length ? pt.cac_ca : pt?.ca_san_xuat) ?? [];
  const ra: [number, number][] = [];
  for (const c of ds) {
    const a = phutTrongNgay(c.tu);
    const b = phutTrongNgay(c.den);
    if (a == null || b == null) continue;
    if (b > a) ra.push([a, b]);
    else { ra.push([a, 1440]); if (b > 0) ra.push([0, b]); }
  }
  return ra.sort((x, y) => x[0] - y[0]);
}

interface Truc {
  tu: number;
  den: number;
  ca: [number, number][];
  /** Ngày nghỉ hẳn (nghỉ tuần, lễ) — làm bù KHÔNG nằm đây. */
  nghi: Set<string>;
}

/** Vị trí % của một mốc trên trục. */
function vt(t: Truc, ms: number): number {
  return Math.max(0, Math.min(100, ((ms - t.tu) / (t.den - t.tu)) * 100));
}

/** Những khúc của [a, b] rơi vào giờ ca của ngày làm — phần máy thật sự chạy. Chưa khai ca thì cả khúc. */
function khucTrongCa(t: Truc, a: number, b: number): [number, number][] {
  if (b <= a) return [];
  if (t.ca.length === 0) return [[a, b]];
  const ra: [number, number][] = [];
  for (let d = dauNgay(a); d < b; d += NGAY_MS) {
    if (t.nghi.has(ymd(d))) continue;
    for (const [s, e] of t.ca) {
      const x = Math.max(a, d + s * 60_000);
      const y = Math.min(b, d + e * 60_000);
      if (y > x) ra.push([x, y]);
    }
  }
  return ra;
}

/** Vùng gạch: ngoài giờ ca của ngày làm, và trọn ngày nghỉ. */
function vungNgoaiCa(t: Truc): { a: number; b: number; nghi: boolean }[] {
  if (t.ca.length === 0) return [];
  const ra: { a: number; b: number; nghi: boolean }[] = [];
  for (let d = t.tu; d < t.den; d += NGAY_MS) {
    if (t.nghi.has(ymd(d))) { ra.push({ a: d, b: d + NGAY_MS, nghi: true }); continue; }
    let con = d;
    for (const [s, e] of t.ca) {
      const x = d + s * 60_000;
      if (x > con) ra.push({ a: con, b: x, nghi: false });
      con = Math.max(con, d + e * 60_000);
    }
    if (con < d + NGAY_MS) ra.push({ a: con, b: d + NGAY_MS, nghi: false });
  }
  return ra;
}

/** Trục bao trọn lệnh: từ đầu ngày bắt đầu tới hết ngày xong (kể cả quãng chờ lệnh khác). */
function dungTruc(ct: XlChiTiet, pt: XlPhanTachNghi | null): Truc | null {
  const ds: number[] = [];
  for (const s of [ct.bat_dau_at, ct.ket_thuc]) { const m = moc(s); if (m !== null) ds.push(m); }
  for (const c of ct.cong_doans) {
    for (const s of [c.du_kien_bat_dau, c.du_kien_ket_thuc, c.cho_tu, c.thuc_bat_dau, c.thuc_ket_thuc]) {
      const m = moc(s); if (m !== null) ds.push(m);
    }
  }
  if (ds.length === 0) return null;
  const tu = dauNgay(Math.min(...ds));
  const den = dauNgay(Math.max(...ds)) + NGAY_MS;
  const nghi = new Set((pt?.ngay_nghi ?? []).filter((n) => n.loai !== "work").map((n) => n.ngay.slice(0, 10)));
  return { tu, den, ca: khungCa(pt), nghi };
}

/** Nhãn đặt cạnh mốc: nửa trái thì nằm bên phải mốc, nửa phải thì nằm bên trái để khỏi tràn mép. */
function choNhan(p: number): CSSProperties {
  return p < 62 ? { left: `calc(${p}% + 10px)` } : { right: `calc(${100 - p}% + 10px)`, textAlign: "right" };
}

export function XlNgan({
  ct, dangTai, suaDuoc, duyetDuoc, dangGhi, goi, vatTu, truocDo,
  onDoiGio, onHoanTac, onBoLich, onPhatHanh, onThuHoi, onCapNhat, onDong, onMoLenh, onMoHoSo, onSoSanh, len, xuong,
}: {
  ct: XlChiTiet | null;
  dangTai: boolean;
  suaDuoc: boolean;
  duyetDuoc: boolean;
  dangGhi: boolean;
  goi: XlGoiPhatHanh | null;
  vatTu?: XlVatTu;
  /** Mốc bắt đầu TRƯỚC lần dời gần nhất của chính lệnh này (để "từ 13:45 Hoàn tác"). */
  truocDo: string | null;
  onDoiGio(gio: string): void;
  onHoanTac(): void;
  onBoLich(): void;
  onPhatHanh(): void;
  onThuHoi(): void;
  onCapNhat(): void;
  onDong(): void;
  onMoLenh(lsxId: number): void;
  /** Lệnh đã phát hành/đã đóng ⇒ Hồ sơ lệnh sản xuất; chưa phát hành ⇒ lệnh ở Kế hoạch sản xuất. */
  onMoHoSo(lsxId: number, daPhatHanh: boolean): void;
  onSoSanh(a: number, b: number): Promise<XlSoSanh>;
  len?: () => void;
  xuong?: () => void;
}) {
  const [tab, setTab] = useState("chi-tiet");
  const [chep, setChep] = useState(false);
  const [chon, setChon] = useState<number[]>([]);
  const [soSanh, setSoSanh] = useState<XlSoSanh | null>(null);
  const [loiSoSanh, setLoiSoSanh] = useState<string | null>(null);
  const [nhapGio, setNhapGio] = useState("");
  const refSoSanh = useRef(onSoSanh);
  refSoSanh.current = onSoSanh;
  const capA = chon.length === 2 ? Math.min(chon[0], chon[1]) : null;
  const capB = chon.length === 2 ? Math.max(chon[0], chon[1]) : null;

  const lsxId = ct?.lsx_id;
  useEffect(() => { setChon([]); setSoSanh(null); setLoiSoSanh(null); }, [lsxId]);
  useEffect(() => { setNhapGio((ct?.bat_dau_at ?? "").slice(0, 16)); }, [ct?.bat_dau_at, lsxId]);
  useEffect(() => {
    if (capA == null || capB == null) { setSoSanh(null); return; }
    let huy = false;
    setSoSanh(null);
    setLoiSoSanh(null);
    refSoSanh.current(capA, capB)
      .then((r) => { if (!huy) setSoSanh(r); })
      .catch((e) => { if (!huy) setLoiSoSanh(e?.message ?? "Không so được."); });
    return () => { huy = true; };
  }, [capA, capB]);

  const phienBans = goi?.co_goi ? (goi.phien_bans ?? []) : [];
  const goiCu = goiDaThuHoi(goi);

  if (!ct) {
    return (
      <NganPhai tieuDe={dangTai ? "Đang tải lệnh" : "Không mở được lệnh"} onDong={onDong} len={len} xuong={xuong}>
        <EmptyState trangThai="dang-tai" inline nhanTai="Đang tải dữ liệu lệnh sản xuất…" />
      </NganPhai>
    );
  }

  const daXep = !!ct.bat_dau_at;
  const daPhatHanh = ct.trang_thai === "da_phat_hanh";
  const daDong = ct.trang_thai === "da_dong";
  const soDaBatDau = goi?.co_goi ? (goi.so_da_bat_dau ?? 0) : 0;
  const khoaThuHoi = !!goi?.co_goi && goi.cho_phep_thu_hoi === false;
  const capNhatDuoc = !!goi?.co_goi && goi.cho_phep_cap_nhat === true && soDaBatDau > 0;
  const daChayDo = ct.co_thuc_te && !!ct.thuc_bat_dau_lenh;
  const daXongHet = ct.co_thuc_te && ct.so_buoc > 0 && ct.so_buoc_xong >= ct.so_buoc && !!ct.ket_thuc_thuc_te;
  const ketThuc = ct.ket_thuc_thuc_te ?? ct.ket_thuc;
  const phanTach = (ct as { phan_tach_nghi?: XlPhanTachNghi | null }).phan_tach_nghi ?? null;
  const sua = suaDuoc && !daDong && !dangGhi;
  const cum = ct.cum;
  const khac = cum ? cum.lsx.filter((z) => z.lsx_id !== ct.lsx_id) : [];

  // Câu "Bước N chưa tính được giờ …" đã nằm trong title của viên giờ bước đó — ở đây chỉ giữ ghi chú cấp lệnh.
  // "Không tính thời gian gia công ngoài" cũng đã có viên "Gia công ngoài" trên dòng bước.
  const ghiChu = ct.ghi_chu.filter((g) => !/^Bước \d+ /.test(g) && !/gia công ngoài/i.test(g));
  const doi = (phut: number) => { if (ct.bat_dau_at) onDoiGio(congPhut(ct.bat_dau_at, phut)); };

  // ---------------------------------------------------------------- số tổng
  // `chay`/`cho` là phút của KẾ HOẠCH ⇒ chia phần trăm theo khung kế hoạch. Lệnh đã xong mà chia
  // cho quãng thực tế là đem hai hệ đo khác nhau ra chia (xưởng làm nhanh 12 phút ⇒ "máy chạy 1608%").
  const tongKh = daXep ? Math.max(0, ((moc(ct.ket_thuc) ?? 0) - (moc(ct.bat_dau_at) ?? 0)) / 60_000) : 0;
  const tong = daXongHet
    ? Math.max(0, ((moc(ct.ket_thuc_thuc_te) ?? 0) - (moc(ct.thuc_bat_dau_lenh) ?? 0)) / 60_000)
    : tongKh;
  const chay = ct.chay_phut || 0;
  const cho = ct.cho_phut || 0;
  const nghi = Math.max(0, tongKh - chay - cho);
  const pt = (v: number) => (tongKh > 0 ? Math.min(100, Math.round((v / tongKh) * 100)) : 0);
  const dem = soDem(ct.bat_dau_at, ct.ket_thuc);
  // Bước 0 phút vì thiếu dữ kiện ⇒ ngày xong chỉ là mốc sớm nhất, đừng tô nó như số chắc (#24).
  const cauThieuGio = daXongHet || !daXep ? null : cauChuaTinhGio(soBuocChuaGio(ct.cong_doans));

  // ---------------------------------------------------------------- dải ô số
  const oHan = (ten: string, h: string | null, ic: ReactNode) => (
    <div className="xa-b-o" key={ten}>
      <div className="xa-b-o__n">{ic}{ten}</div>
      <div className="xa-b-o__g">
        {h ? <><span>{thuNgay(h)}</span>{daXep && <DuTre du={soNgayDu(ketThuc, h)} />}</> : <span className="xa-mo">Chưa có hạn</span>}
      </div>
    </div>
  );
  const daiSo = (
    <div className={`xa-b-so${ct.han_hoan_thanh_sx ? " xa-b-so--sau" : ""}`}>
      {daXongHet ? (
        <div className="xa-b-o"><div className="xa-b-o__n"><CalendarClock size={13} />Vào việc</div>
          <div className="xa-b-o__g">{thuNgayGio(ct.thuc_bat_dau_lenh)}</div></div>
      ) : (
        <label className={`xa-b-o${sua ? " xa-b-o--nhap" : ""}`}>
          <div className="xa-b-o__n"><CalendarClock size={13} />{daChayDo ? "Bắt đầu phần còn lại" : "Bắt đầu"}</div>
          <div className="xa-b-o__g">
            {sua ? (
              <ChonNgayGio value={nhapGio} min="2000-01-01T00:00" max="2099-12-31T23:59" aria-label="Giờ bắt đầu" xoaDuoc={false}
                onChange={(v) => { setNhapGio(v); if (v && v !== (ct.bat_dau_at ?? "").slice(0, 16)) onDoiGio(`${v}:00`); }} />
            ) : (
              <span>{daXep ? thuNgayGio(ct.bat_dau_at) : "Chưa xếp lịch"}</span>
            )}
            {daXep && sua && (
              <span className="xa-nhom-nut">
                <button type="button" title="Lùi 15 phút" aria-label="Lùi 15 phút" onClick={(e) => { e.preventDefault(); doi(-15); }}><ArrowLeft size={13} />15</button>
                <button type="button" title="Tới 15 phút" aria-label="Tới 15 phút" onClick={(e) => { e.preventDefault(); doi(15); }}>15<ArrowRight size={13} /></button>
              </span>
            )}
            {daXep && sua && truocDo && (
              <button type="button" className="xa-b-hoan" onClick={(e) => { e.preventDefault(); onHoanTac(); }}
                title={`Về lại ${truocDo.slice(0, 10) === (ct.bat_dau_at ?? "").slice(0, 10) ? truocDo.slice(11, 16) : thuNgayGio(truocDo)}`}>
                <RotateCcw size={13} />Hoàn tác
              </button>
            )}
          </div>
        </label>
      )}
      <div className={`xa-b-o${cauThieuGio ? "" : " xa-b-o--xong"}`}>
        <div className="xa-b-o__n"><Target size={13} />{daXongHet ? "Xong thực tế" : cauThieuGio ? "Sớm nhất xong" : "Dự kiến xong"}</div>
        <div className="xa-b-o__g">{daXongHet ? thuNgayGio(ct.ket_thuc_thuc_te) : daXep ? thuNgayGio(ct.ket_thuc) : "—"}</div>
        {cauThieuGio && <div className="xa-vien xa-vien--vang">{cauThieuGio}</div>}
      </div>
      <div className="xa-b-o"><div className="xa-b-o__n"><Clock size={13} />Từ đầu tới xong</div>
        <div className="xa-b-o__g">{tong > 0 ? quangDongHo(tong) : "—"}</div></div>
      <div className="xa-b-o"><div className="xa-b-o__n"><PlayCircle size={13} />Máy chạy</div>
        <div className="xa-b-o__g">{chay > 0 ? gioChu(chay) : "—"}{tongKh > 0 && chay > 0 && <span className="xa-mo2 xa-b-pt">{pt(chay)}%</span>}</div></div>
      {ct.han_hoan_thanh_sx && oHan("Hạn xong sản xuất", ct.han_hoan_thanh_sx, <Target size={13} />)}
      {oHan("Hạn giao khách", ct.han_giao_khach, <Truck size={13} />)}
    </div>
  );

  const canh: ReactNode[] = [];
  if (!daXep) canh.push(<>Gõ giờ bắt đầu ở trên hoặc kéo lệnh từ khay Chờ xếp lịch thả vào lịch.</>);
  if (daChayDo && !daXongHet) {
    canh.push(<>Lệnh đã vào việc {thuNgayGio(ct.thuc_bat_dau_lenh)}, xong {ct.so_buoc_xong} trên {ct.so_buoc} bước. Giờ bắt đầu là của phần còn lại; không lùi được xuống dưới bước đã xong.</>);
  }
  // Chỉ khi xưởng đã vào việc — lệnh mới phát hành chưa làm gì thì "theo việc đã làm" là câu rỗng nghĩa.
  if (daChayDo && !daXongHet && ct.ket_thuc_thuc_te) {
    canh.push(<>Theo việc đã làm, dự kiến xong {thuNgayGio(ct.ket_thuc_thuc_te)}
      {ct.lech_ket_thuc_phut != null && Math.abs(ct.lech_ket_thuc_phut) > 15
        ? `, ${ct.lech_ket_thuc_phut > 0 ? "muộn" : "sớm"} ${quangDongHo(Math.abs(ct.lech_ket_thuc_phut))} so với kế hoạch.` : ", đúng kế hoạch."}</>);
  }
  ghiChu.forEach((g) => canh.push(<>{g}</>));

  // ---------------------------------------------------------------- bảng bước + trục
  const truc = dungTruc(ct, phanTach);
  const soNgay = truc ? Math.round((truc.den - truc.tu) / NGAY_MS) : 0;
  const buocNhan = Math.max(1, Math.ceil(soNgay / 8));
  const gach = truc ? vungNgoaiCa(truc) : [];
  const nenTruc = truc && gach.map((g, i) => (
    <span key={i} className={`xa-b-gach${g.nghi ? " xa-b-gach--nghi" : ""}`} style={{ left: `${vt(truc, g.a)}%`, width: `${vt(truc, g.b) - vt(truc, g.a)}%` }} />
  ));
  const coTo = ct.cong_doans.some((c) => c.loai_buoc === "to");
  const coDoi = ct.cong_doans.some((c) => c.lien.some((l) => l.loai === "doi"));
  const coCho = ct.cong_doans.some((c) => c.cho_tu);
  const coThuc = ct.cong_doans.some((c) => c.thuc_bat_dau);

  const dongBuoc = (c: XlCongDoan) => {
    const t = theBuoc(c.ten);
    const a = moc(c.du_kien_bat_dau);
    const b = moc(c.du_kien_ket_thuc);
    const choTu = moc(c.cho_tu);
    const choPhut = choTu !== null && a !== null ? (a - choTu) / 60_000 : 0;
    const chung = c.lien.some((l) => l.loai === "chung");
    const giao = c.la_thue_ngoai;
    const nhanGio = giao ? <span className="xa-vien xa-vien--cam">Gia công ngoài</span>
      : c.chay_phut > 0 ? <span className="xa-vien xa-vien--xanh">{gioChu(c.chay_phut)}</span>
        : <span className="xa-vien xa-vien--vang" title={c.canh_bao ?? undefined}>Chưa tính được giờ</span>;

    // Trên trục: thanh nền nhạt từ lúc vào tới lúc ra, đoạn đậm là phần nằm trong giờ ca.
    let truCot: ReactNode = null;
    if (truc) {
      const coThanh = !giao && a !== null && b !== null && b > a;
      const pa = a !== null ? vt(truc, a) : null;
      const pb = b !== null ? vt(truc, b) : null;
      const moc1 = pb ?? pa;   // chỗ cắm hình thoi "lệnh khác chờ ở đây"
      const doiL = c.lien.filter((l) => l.loai === "doi");
      const choL = c.lien.filter((l) => l.loai === "cho");
      const chungL = c.lien.filter((l) => l.loai === "chung");
      const thucA = moc(c.thuc_bat_dau);
      const thucB = moc(c.thuc_ket_thuc) ?? (c.thuc_bat_dau ? Date.now() : null);
      const ngan = coThanh && pa !== null && pb !== null && pb - pa < 14;
      truCot = (
        <>
          {nenTruc}
          {choTu !== null && a !== null && a > choTu && (
            <span className="xa-b-cho" style={{ left: `${vt(truc, choTu)}%`, width: `${vt(truc, a) - vt(truc, choTu)}%` }} />
          )}
          {coThanh && pa !== null && pb !== null && (
            <span className={`xa-b-thanh${chung ? " xa-b-thanh--chung" : ""}`} style={{ left: `${pa}%`, width: `${Math.max(0.4, pb - pa)}%` }}
              title={tuDen(c.du_kien_bat_dau, c.du_kien_ket_thuc)}>
              {khucTrongCa(truc, a!, b!).map(([x, y], i) => (
                <i key={i} className={c.loai_buoc === "to" ? "xa-b-to" : undefined}
                  style={{ left: `${((x - a!) / (b! - a!)) * 100}%`, width: `${((y - x) / (b! - a!)) * 100}%` }} />
              ))}
            </span>
          )}
          {thucA !== null && thucB !== null && thucB > thucA && (
            <span className="xa-b-thuc" style={{ left: `${vt(truc, thucA)}%`, width: `${Math.max(0.4, vt(truc, thucB) - vt(truc, thucA))}%` }}
              title={`Thực tế ${gio(c.thuc_bat_dau)} đến ${c.thuc_ket_thuc ? gio(c.thuc_ket_thuc) : "đang chạy"}`} />
          )}
          {doiL.length > 0 && moc1 !== null && <span className="xa-b-thoi" style={{ left: `${moc1}%` }} />}
          {/* Một nhãn mỗi dòng: dải nối nếu có (bấm mở lệnh kia), không thì giờ của thanh ngắn. */}
          {(() => {
            const l = choL[0] ?? doiL[0] ?? chungL[0];
            if (l) {
              const p = l.loai === "cho" && choTu !== null ? vt(truc, choTu) : l.loai === "doi" ? (moc1 ?? 0) : (pb ?? pa ?? 0);
              const st = l.loai === "cho" ? { right: `calc(${100 - p}% + 8px)`, textAlign: "right" as const } : choNhan(p);
              return (
                <button type="button" className={`xa-b-nhan xa-b-nhan--${l.loai}`} style={st} title={cauLien(l)} onClick={() => onMoLenh(l.lsx_id_khac)}>
                  {nhanLien(l)}{l.loai === "cho" && choPhut > 0 ? ` ${quangDongHo(choPhut)}` : ""}
                </button>
              );
            }
            if (ngan && pb !== null) return <span className="xa-b-nhan xa-b-nhan--gio" style={choNhan(pb)}>{tuDen(c.du_kien_bat_dau, c.du_kien_ket_thuc).replace(/^\S+ \S+ /, "")}</span>;
            return null;
          })()}
        </>
      );
    }

    const sl = c.so_luong_vao != null && c.so_luong_vao > 0 ? c.so_luong_vao.toLocaleString("vi-VN") : null;
    return (
      <div key={c.id} className={`xa-b-hang${choPhut > 0 ? " xa-b-hang--cho" : ""}`}>
        <div className="xa-b-ten">
          {/* `thu_tu` của bước lệnh đếm từ 0 — người đọc đếm từ 1 như bàn tổ ("bước 4 trên 5"). */}
          <span className="xa-b-stt">{c.thu_tu + 1}</span>
          <span className={`xa-oic xa-b-oic ${t.mau}`}>{t.ic}</span>
          <span className="xa-b-cot">
            <span className="xa-b-t" title={c.ten}>{c.ten}
              {c.song_song && <span className="xa-nho" title="Cùng lớp với bước khác nên hai bước không chặn nhau; lịch cấp lệnh vẫn xếp lần lượt.">song song</span>}
              {c.bai_ghep_ma && <span className="xa-nho xa-nho--tim">bài ghép {c.bai_ghep_ma}</span>}
              {c.trang_thai && c.trang_thai !== "released" && <span className="xa-nho">{TT_BUOC[c.trang_thai] ?? c.trang_thai}</span>}
            </span>
            <span className={`xa-b-m${!c.may_ten && !c.to_ten && !giao ? " xa-chu-vang" : ""}`} title={c.may_ke_hoach_ten ? `Xưởng đã đổi máy, kế hoạch là ${c.may_ke_hoach_ten}` : undefined}>
              {c.may_ten ?? c.to_ten ?? (giao ? "Gia công ngoài" : "Chưa gán máy")}
              {c.may_ke_hoach_ten && <span className="xa-mo2"> kế hoạch {c.may_ke_hoach_ten}</span>}
            </span>
          </span>
        </div>
        <div className="xa-b-sl">
          {sl ? <><span>{sl}</span><span className="xa-b-dv">{c.don_vi_vao_ten ?? c.don_vi_vao ?? ""}</span></> : <span className="xa-mo2" title="Chưa khai số lượng vào">—</span>}
        </div>
        <div className="xa-b-gio">{nhanGio}</div>
        <div className="xa-b-truc">{truCot}</div>
      </div>
    );
  };

  const nhanNgay = truc && Array.from({ length: soNgay }, (_, i) => {
    if (i % buocNhan) return null;
    const d = truc.tu + i * NGAY_MS;
    const s = ymd(d);
    return (
      <span key={i} className="xa-b-ngay" style={{ left: `${vt(truc, d)}%` }}>
        {buocNhan === 1 ? thuNgay(s) : `${s.slice(8, 10)}/${s.slice(5, 7)}`}
      </span>
    );
  });

  const caChu = (phanTach?.cac_ca?.length ? phanTach.cac_ca : phanTach?.ca_san_xuat ?? [])
    .map((c) => `${"ten" in c && c.ten ? `${c.ten} ` : ""}${c.tu} đến ${c.den}`);
  const leTen = (phanTach?.ngay_nghi ?? []).filter((n) => n.ten);
  const soNghiTuan = (phanTach?.ngay_nghi ?? []).filter((n) => !n.ten && n.loai !== "work").length;

  const bang = (
    <div className="xa-b-bang">
      <div className="xa-b-hang xa-b-hang--dau">
        <div>Bước <span className="xa-mo2">{ct.cong_doans.length}</span></div>
        <div className="xa-b-sl">Số lượng</div>
        <div className="xa-b-gio">Giờ</div>
        <div className="xa-b-truc">{truc ? nhanNgay : <span className="xa-b-ngay xa-mo2">Chưa xếp lịch</span>}</div>
      </div>
      {ct.cong_doans.length === 0
        ? <p className="xa-b-trong">Lệnh chưa có quy trình. Khai quy trình ở Kế hoạch sản xuất.</p>
        : ct.cong_doans.map(dongBuoc)}
      {truc && (
        <div className="xa-b-chu">
          <span><i className="xa-b-ct xa-b-ct--chay" />Máy chạy {chay > 0 ? gioChu(chay) : "0 phút"}{tongKh > 0 && <span className="xa-mo2"> {pt(chay)}%</span>}</span>
          {coTo && <span><i className="xa-b-ct xa-b-ct--to" />Tổ làm</span>}
          {(coCho || cho > 0) && <span><i className="xa-b-ct xa-b-ct--cho" />Chờ lệnh khác {quangDongHo(cho)}{tongKh > 0 && <span className="xa-mo2"> {pt(cho)}%</span>}</span>}
          {nghi > 0 && (
            <span><i className="xa-b-ct xa-b-ct--gach" />{dem > 0 && !(phanTach?.ngay_nghi_phut) ? `Ngoài ca ${dem} đêm` : "Nghỉ và ngoài ca"} {quangDongHo(nghi)}
              {tongKh > 0 && <span className="xa-mo2"> {Math.max(0, 100 - pt(chay) - pt(cho))}%</span>}</span>
          )}
          {phanTach && phanTach.nghi_giua_ca_phut > 0 && <span className="xa-mo">nghỉ giữa ca {gioChu(phanTach.nghi_giua_ca_phut)}</span>}
          {soNghiTuan > 0 && <span className="xa-mo">{soNghiTuan} ngày nghỉ tuần</span>}
          {leTen.map((n, i) => (
            <span key={i} className={`xa-cl ${n.loai === "work" ? "xa-cl--bu" : "xa-cl--le"}`} title={n.ten ?? undefined}>{thuNgay(n.ngay)} {n.ten}</span>
          ))}
          {phanTach && phanTach.gia_cong_ngoai_phut > 0 && <span className="xa-mo">gia công ngoài {gioChu(phanTach.gia_cong_ngoai_phut)}</span>}
          {coThuc && <span><i className="xa-b-ct xa-b-ct--thuc" />Thực tế</span>}
          {coDoi && <span><i className="xa-b-ct xa-b-ct--thoi" />Lệnh khác chờ</span>}
          <span className="xa-gian" />
          {caChu.length > 0 && <span className="xa-mo">{caChu.join(" và ")}</span>}
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------- đáy: cụm + quy cách
  const khoiCum = cum && khac.length > 0 && (
    <section className="xa-b-khoi">
      <h4><Link2 size={13} className="xa-chu-tim" />Phát hành cùng nhau, {cum.lsx.length} lệnh{cum.phu ? ` ${cum.phu}` : ""}</h4>
      {khac.map((z) => {
        const ly = lyDoCum(ct.lien, z.lsx_id);
        return (
          <div key={z.lsx_id} className="xa-b-dong">
            <IconTT tt={z.trang_thai} />
            <span><span className="xa-ma">{z.ma}</span> {z.ten}</span>
            {ly.map((t) => <span key={t} className="xa-nho xa-nho--vang">{t}</span>)}
            {!z.co_lich && <span className="xa-nho">chưa xếp lịch</span>}
            <button type="button" className="xa-btn xa-b-mo" onClick={() => onMoLenh(z.lsx_id)}><ExternalLink size={12} />Mở</button>
          </div>
        );
      })}
    </section>
  );

  const khoiQuyCach = (
    <section className="xa-b-khoi">
      <h4><Tag size={13} />Quy cách và vật tư</h4>
      <div className="xa-b-dong">
        <span className="xa-chip-dau"><Package size={13} />{ct.so_luong_dat.toLocaleString("vi-VN")} {ct.don_vi_tinh ?? ""}</span>
        <span className="xa-chip-dau"><FileText size={13} />{ct.so_to_ke_hoach.toLocaleString("vi-VN")} tờ in</span>
        {ct.so_con > 1 && <span className="xa-chip-dau">{ct.so_con} con một tờ</span>}
        {ct.so_kem && <span className="xa-chip-dau"><Layers size={13} />{ct.so_kem} tấm kẽm</span>}
        {/* Mỗi giấy khai ở bước một chip; lệnh cũ chưa khai giấy ở bước thì rơi về giấy của quy cách. */}
        {(ct.giays?.length ? ct.giays : ct.giay ? [ct.giay] : []).map((g) => <span key={g} className="xa-chip-dau">{g}</span>)}
        {!ct.giays?.length && !ct.giay && <span className="xa-chip-dau xa-mo">Chưa chọn giấy</span>}
        {ct.kho_in && <span className="xa-chip-dau">khổ {ct.kho_in}</span>}
        {ct.so_mau && <span className="xa-chip-dau">{ct.so_mau} màu</span>}
        {vatTu && vatTu.muc !== "ok" && <span className={`xa-nho ${vatTu.muc === "do" ? "xa-nho--do" : "xa-nho--vang"}`}>{vatTu.chu}</span>}
        {vatTu && vatTu.muc === "ok" && <span className="xa-nho xa-nho--la">đủ vật tư</span>}
        {ct.sale_name && (
          <span className="xa-chip-dau" title={`Kinh doanh ${ct.sale_name}`}><span className="xa-ng-av">{ct.sale_name.trim().charAt(0).toUpperCase()}</span>{ct.sale_name}</span>
        )}
      </div>
      {ct.luu_y_gui_xuong && <div className="xa-b-luu-y"><AlertCircle size={14} />Dặn xưởng: {ct.luu_y_gui_xuong}</div>}
    </section>
  );

  const chiTiet = (
    <div className="xa-b">
      {daiSo}
      {canh.map((n, i) => <div key={i} className="xa-b-canh"><AlertCircle size={14} /><span>{n}</span></div>)}
      {bang}
      <div className={`xa-b-day${khoiCum ? "" : " xa-b-day--mot"}`}>{khoiCum}{khoiQuyCach}</div>
    </div>
  );

  // ---------------------------------------------------------------- lịch sử phát hành
  const chonPhienBan = (so: number) => setChon((cu) => (cu.includes(so) ? cu.filter((x) => x !== so) : cu.length < 2 ? [...cu, so] : [cu[1], so]));
  const lichSu = (
    <div className="xa-ng-ls">
      {phienBans.length === 0 ? (
        <p className="xa-ng-ghi">{goiCu.length > 0 ? "Lệnh chưa phát hành lại sau lần thu hồi." : "Lệnh chưa phát hành nên chưa có phiên bản nào."}</p>
      ) : (
        <>
          <div className="xa-ng-ls__goi">
            {chon.length === 0 ? "Bấm chọn hai phiên bản để so giờ và máy từng bước."
              : chon.length === 1 ? `Đã chọn phiên bản ${chon[0]}, bấm thêm một phiên bản nữa.`
                : `Đang so phiên bản ${capA} với ${capB}.`}
            {chon.length > 0 && <button type="button" className="xa-lk" onClick={() => setChon([])}>Bỏ chọn</button>}
          </div>
          {phienBans.map((p) => (
            <button key={p.so} type="button" className={`xa-ng-ls__muc${chon.includes(p.so) ? " xa-ng-ls__muc--chon" : ""}`} onClick={() => chonPhienBan(p.so)}>
              <span className="xa-nho">Phiên bản {p.so}</span>
              <span className={`xa-nho ${p.loai === "cap_nhat" ? "xa-nho--vang" : "xa-nho--la"}`}>{p.loai === "cap_nhat" ? "cập nhật" : "phát hành"}</span>
              <span className="xa-ng-ls__ly">{p.ly_do || "Không ghi lý do"}</span>
              <span className="xa-mo">{gio(p.luc)}</span>
            </button>
          ))}
          {capA != null && capB != null && (
            <div className="xa-ng-ls__so">
              {loiSoSanh && <p className="xa-chu-do">{loiSoSanh}</p>}
              {!soSanh && !loiSoSanh && <p className="xa-mo">Đang đối chiếu…</p>}
              {soSanh && (soSanh.dong.some((d) => d.doi_gio || d.doi_may) ? soSanh.dong.filter((d) => d.doi_gio || d.doi_may).map((d) => (
                <div key={d.cong_viec_id} className="xa-ng-ls__dong">
                  <span>{d.ten}</span>
                  <span>
                    {d.doi_gio && <span style={{ display: "block" }}><span className="xa-ng-ls__cu">{gio(d.a.bat_dau)}</span> thành {gio(d.b.bat_dau)}</span>}
                    {d.doi_may && <span style={{ display: "block" }}><span className="xa-ng-ls__cu">máy {d.a.may_ten ?? "chưa gán"}</span> thành máy {d.b.may_ten ?? "chưa gán"}</span>}
                  </span>
                </div>
              )) : <p className="xa-mo">Không có bước nào đổi giờ hay đổi máy giữa hai phiên bản này. Lịch sử chi tiết chỉ lưu từ 10/09/2026.</p>)}
            </div>
          )}
        </>
      )}
      {goiCu.length > 0 && (
        <>
          <p className="xa-ng-ls__goi">Các lần phát hành đã thu hồi</p>
          {goiCu.map((g) => (
            <div key={g.goi_id} className="xa-ng-ls__cu-goi">
              <div className="xa-ng-ls__thu-hoi">
                <span className="xa-nho xa-nho--do">thu hồi</span>
                <span className="xa-ng-ls__ly">{g.thu_hoi_ly_do || "Không ghi lý do"}</span>
                <span className="xa-mo">{g.thu_hoi_luc ? gio(g.thu_hoi_luc) : ""}</span>
              </div>
              {g.phien_bans.map((p) => (
                <div key={p.so} className="xa-ng-ls__muc xa-ng-ls__muc--cu">
                  <span className="xa-nho">Phiên bản {p.so}</span>
                  <span className={`xa-nho ${p.loai === "cap_nhat" ? "xa-nho--vang" : "xa-nho--la"}`}>{p.loai === "cap_nhat" ? "cập nhật" : "phát hành"}</span>
                  <span className="xa-ng-ls__ly">{p.ly_do || "Không ghi lý do"}</span>
                  <span className="xa-mo">{gio(p.luc)}</span>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );

  // ---------------------------------------------------------------- chân
  const nPhatHanh = cum ? cum.lsx.length : 1;
  const chan = (
    <div className="xa-ng-chan">
      <button type="button" className="xa-btn" onClick={onDong}>Đóng</button>
      <span className="xa-gian" />
      {duyetDuoc && daPhatHanh && khoaThuHoi && (
        <span className="xa-goi-y"><AlertCircle size={14} />Đã có {soDaBatDau} trên {goi?.so_cong_viec ?? 0} việc dưới xưởng bắt đầu, không rút cả gói về được.</span>
      )}
      {!daPhatHanh && !daDong && khac.length > 0 && duyetDuoc && daXep && (
        <span className="xa-goi-y"><Link2 size={14} />{khac.map((z) => z.ma).join(" và ")} xuống xưởng cùng lúc</span>
      )}
      {suaDuoc && daXep && !daPhatHanh && !daDong && (
        <button type="button" className="xa-btn xa-btn--do" disabled={dangGhi} onClick={onBoLich}><Trash2 size={14} />Bỏ lịch</button>
      )}
      {duyetDuoc && daPhatHanh && (
        <button type="button" className="xa-btn xa-btn--do" disabled={dangGhi || khoaThuHoi} onClick={onThuHoi}
          title={khoaThuHoi ? "Thu hồi cả gói sẽ xoá việc thợ đã làm. Dùng Phát hành cập nhật cho phần chưa bắt đầu." : undefined}>
          <RotateCcw size={14} />{nPhatHanh > 1 ? `Thu hồi cả cụm, ${nPhatHanh} lệnh` : "Thu hồi phát hành"}
        </button>
      )}
      {duyetDuoc && daPhatHanh && capNhatDuoc && (
        <button type="button" className="xa-btn xa-btn--xanh" disabled={dangGhi} onClick={onCapNhat}
          title={`Đẩy lịch mới xuống xưởng cho ${goi?.so_chua_bat_dau ?? 0} việc chưa bắt đầu; ${soDaBatDau} việc đã chạy giữ nguyên.`}>
          <Send size={14} />Phát hành cập nhật
        </button>
      )}
      {duyetDuoc && daXep && !daPhatHanh && !daDong && (
        <button type="button" className="xa-btn xa-btn--xanh" disabled={dangGhi} onClick={onPhatHanh}>
          <Send size={14} />{nPhatHanh > 1 ? `Phát hành cả cụm, ${nPhatHanh} lệnh` : "Phát hành"}
        </button>
      )}
    </div>
  );

  const chepMa = () => {
    navigator.clipboard?.writeText(ct.ma).then(() => { setChep(true); window.setTimeout(() => setChep(false), 1500); }).catch(() => {});
  };

  return (
    <NganPhai
      duongDan="Xếp lịch"
      tieuDe={ct.ten || ct.ma}
      the={<TrangThaiLenh ct={ct} />}
      phuDe={(
        <span style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span className="xa-chip-dau">{ct.ma}
            <button type="button" className="xa-sao" title="Chép mã lệnh" aria-label="Chép mã lệnh" onClick={chepMa}>
              {chep ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </span>
          {ct.is_rush && <span className="xa-gap">Gấp</span>}
          {ct.customer_name && <span className="xa-chip-dau"><Building2 size={13} />{ct.customer_name}</span>}
          {ct.order_no && <span className="xa-chip-dau"><FileText size={13} />Đơn {ct.order_no}</span>}
          {ct.customer_po_no && <span className="xa-chip-dau"><Tag size={13} />PO {ct.customer_po_no}</span>}
          {ct.nguoi_phu_trach_ten && <span className="xa-chip-dau"><UserRound size={13} />Phụ trách {ct.nguoi_phu_trach_ten}</span>}
        </span>
      )}
      hanhDong={(
        <button type="button" className="xa-btn" onClick={() => onMoHoSo(ct.lsx_id, daPhatHanh || daDong)}>
          <ExternalLink size={14} />{daPhatHanh || daDong ? "Mở hồ sơ lệnh" : "Mở ở Kế hoạch sản xuất"}
        </button>
      )}
      tabs={[{ id: "chi-tiet", nhan: "Chi tiết" }, { id: "lich-su", nhan: "Lịch sử phát hành" }]}
      tab={tab}
      onTab={setTab}
      chan={chan}
      len={len}
      xuong={xuong}
      onDong={onDong}
    >
      <div className="xa">
        {tab === "chi-tiet" ? chiTiet : lichSu}
      </div>
    </NganPhai>
  );
}

