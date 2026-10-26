// XẾP LỊCH — bàn xếp lịch cấp LỆNH SẢN XUẤT, phương án A cải tiến (08/10/2026).
// Mockup `docs/mockups/xep-lich-A-cai-tien.html` mục 1–7: đầu màn một hàng (khoảng ngày, tìm, Lọc,
// Hiển thị, khay), băng tóm tắt + lọc nhanh, lưới không cột nhãn, khay Chờ xếp lịch bên phải, băng
// Hoàn tác + Ctrl Z, ngăn chi tiết 1180px. Lọc + đếm ở MÁY CHỦ; chỉ `bat_dau_at` được ghi.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2, CalendarDays, ChevronLeft, ChevronRight, CircleDot, Clock, Inbox, RotateCcw, Search, Send,
  SlidersHorizontal, Users, X, Zap, FileText, Package, Printer, Hash, Wrench,
} from "lucide-react";

import {
  ApiError, api,
  type XlChiTiet, type XlCum, type XlDong, type XlGoiPhatHanh, type XlLien, type XlLocLich, type XlNgayDacBiet,
  type XlThe, type XlVatTu,
} from "../api/client";
import { useAuth } from "../auth/useAuth";
import { useCan } from "../auth/permissions";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useDebounced } from "../utils/useDebounced";
import { XlKhay } from "./XlKhay";
import { XlKhoangNgay } from "./XlKhoangNgay";
import { XlLuoi, type HienThi } from "./XlLuoi";
import { XlNgan } from "./XlNgan";
import { XlKhoaMay } from "./XlKhoaMay";
import { XlDanhSachDT } from "./XlDanhSachDT";
import { useLaDienThoai } from "../utils/dienThoai";
import {
  LOC_HANG_CHO_TRONG,
  MAN_XEP_LICH,
  MOC_HANG_CHO,
  locHangChoLenUrl,
  locHangChoTuUrl,
  thamSoLocHangCho,
  useDieuKienHangCho,
} from "./loc-san-xuat/dieu-kien-hang-cho";
import { ThanhLoc } from "./thanh-loc/ThanhLoc";
import type { DieuKien } from "./thanh-loc/thanh-loc";
import { thamSoKy } from "./thanh-loc/ky-danh-sach";
import { useLocMan } from "./thanh-loc/useLocMan";
import {
  dauTuan, gioChu, moc, phutChayTrongCuaSo, soNgayGiua, themNgay, thuNgayGio, ymd,
} from "./xlShared";
import { CO_NHIN, NhanKhoang, khoangTheoCo, laCoNhin, soTuan, type CoNhin } from "./xlKhoang";
import { cauBaoPhatHanh } from "./cauBaoPhatHanh";
import "./ke-toan/ke-toan.css";
import "./xep-lich-a.css";

const MOI_TRANG = 20;
const KHOA_HIEN = "xep-lich.hien-thi";
const HIEN_GOC: HienThi = {
  thoang: false, khach: true, may: true, sl: false, gioChay: true, soTo: false, hienXong: false, vatTu: true,
};

/** Lọc của LƯỚI (khác lọc khay). Trạng thái là nhóm người dùng hiểu, máy chủ nhận mã thật. */
type LocLuoi = { tt?: string[]; khach?: string; gap?: string };
const TT_NHOM: Record<string, string[]> = {
  chua: ["san_sang", "da_lap_ke_hoach"],
  phat: ["da_phat_hanh"],
  dong: ["da_dong"],
};

type Nhanh = "tre" | "muon" | "chua";
type BuocLui = { lsxId: number; ma: string; truoc: string | null };
type Bao = { chu: string; loi?: boolean; hoanTac?: boolean; giai?: string };

function docHien(): HienThi {
  try {
    const s = window.localStorage.getItem(KHOA_HIEN);
    return s ? { ...HIEN_GOC, ...JSON.parse(s) } : HIEN_GOC;
  } catch {
    return HIEN_GOC;
  }
}

function laONhap(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/** Giờ một ca (phút) — Shift + mũi tên dời đúng ngần này. */
function phutCa(ca: XlLien["cac_ca"]): number {
  const c = ca[0];
  if (!c) return 480;
  const p = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const d = p(c.den) - p(c.tu);
  return d > 0 ? d : d + 1440;
}


export function XepLichPage({
  eventTick = 0,
  onBadgeStale,
  navigate,
}: {
  eventTick?: number;
  onBadgeStale?: () => void;
  navigate?: (id: string, params?: Record<string, unknown>) => void;
}) {
  const { token } = useAuth();
  // Điện thoại: lưới Gantt → danh sách lệnh theo ngày (XlDanhSachDT); khay chờ xếp đóng sẵn.
  const laDT = useLaDienThoai();
  const can = useCan();
  const suaDuoc = can("xep_lich", "update");
  const duyetDuoc = can("xep_lich", "approve");

  // ---------------------------------------------------------------- khoảng ngày
  const [tu, setTu] = useState<string>(() => dauTuan(new Date()));
  const [den, setDen] = useState<string>(() => themNgay(dauTuan(new Date()), 13));
  const soNgay = soNgayGiua(tu, den);
  const [moKhoang, setMoKhoang] = useState(false);
  const luiTien = (huong: 1 | -1) => {
    if (laCoNhin(tu, den) === "thang") {
      const [y, m] = tu.split("-").map(Number);
      const [a, b] = khoangTheoCo("thang", ymd(new Date(y, m - 1 + huong, 1)));
      setTu(a);
      setDen(b);
      return;
    }
    setTu(themNgay(tu, huong * soNgay));
    setDen(themNgay(den, huong * soNgay));
  };
  // Ba cỡ nhìn nhanh; khoảng gõ tay ở bảng lịch thì không cỡ nào sáng.
  const coNhin: CoNhin | null = laCoNhin(tu, den);
  const chonCo = (co: CoNhin, moc: string = tu) => {
    const [a, b] = khoangTheoCo(co, moc);
    setTu(a);
    setDen(b);
  };
  const homNay = () => {
    const nay = ymd(new Date());
    if (coNhin) { chonCo(coNhin, nay); return; }
    const t2 = dauTuan(new Date());
    setTu(t2);
    setDen(themNgay(t2, soNgay - 1));
  };
  const coHomNay = ymd(new Date()) >= tu && ymd(new Date()) <= den;

  // ---------------------------------------------------------------- lọc lưới
  const [timLuoi, setTimLuoi] = useState("");
  const timLuoiCho = useDebounced(timLuoi, 300);
  const [locLuoi, setLocLuoi] = useState<LocLuoi>({});
  const [nhanh, setNhanh] = useState<Nhanh | null>(null);
  const oTimRef = useRef<HTMLInputElement>(null);

  const [hien, setHienGoc] = useState<HienThi>(docHien);
  const setHien = (h: HienThi) => {
    setHienGoc(h);
    try { window.localStorage.setItem(KHOA_HIEN, JSON.stringify(h)); } catch { /* trình duyệt chặn lưu thì thôi */ }
  };
  const [moHien, setMoHien] = useState(false);
  const hienRef = useRef<HTMLDivElement>(null);
  const nutHienRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!moHien) return;
    const ngoai = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!hienRef.current?.contains(t) && !nutHienRef.current?.contains(t)) setMoHien(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMoHien(false); };
    document.addEventListener("mousedown", ngoai);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", ngoai);
      document.removeEventListener("keydown", esc);
    };
  }, [moHien]);

  // ---------------------------------------------------------------- dữ liệu lưới
  const [dong, setDong] = useState<XlDong[]>([]);
  const [ngayNghi, setNgayNghi] = useState<string[]>([]);
  const [ngayDacBiet, setNgayDacBiet] = useState<XlNgayDacBiet[]>([]);
  const [cacCa, setCacCa] = useState<XlLien["cac_ca"]>([]);
  const [cum, setCum] = useState<XlCum[]>([]);
  const [dem, setDem] = useState<XlLien["dem"]>({ tre: 0, muon: 0, chua: 0 });
  const [khachLoc, setKhachLoc] = useState<XlLien["khach_loc"]>([]);
  const [vatTu, setVatTu] = useState<Map<number, XlVatTu>>(new Map());

  // ---------------------------------------------------------------- khay
  const [khayMo, setKhayMo] = useState(() => !window.matchMedia("(max-width: 900px)").matches);
  const [the, setThe] = useState<XlThe[]>([]);
  const [tongCho, setTongCho] = useState(0);
  const [tim, setTim] = useState("");
  const timCho = useDebounced(tim, 300);
  const [trang, setTrang] = useState(1);
  const [taiCho, setTaiCho] = useState(false);
  const [locCho, setLocCho] = useLocMan(MAN_XEP_LICH, LOC_HANG_CHO_TRONG, locHangChoTuUrl, locHangChoLenUrl);
  const dieuKienCho = useDieuKienHangCho();
  const khoaLocCho = JSON.stringify({ ...thamSoKy(locCho.ky), ...thamSoLocHangCho(locCho.loc) });
  const [keoTuKhay, setKeoTuKhay] = useState<XlThe | null>(null);

  // ---------------------------------------------------------------- ngăn
  const [chonId, setChonId] = useState<number | null>(null);
  const [ct, setCt] = useState<XlChiTiet | null>(null);
  const [taiCt, setTaiCt] = useState(false);
  // Lượt nạp chi tiết lệnh hỏng thật — ngăn chỉ nói "Không mở được lệnh" theo cờ này (L-SX-13).
  const [loiCt, setLoiCt] = useState(false);
  const [goi, setGoi] = useState<XlGoiPhatHanh | null>(null);
  const [dangGhi, setDangGhi] = useState(false);
  const [chePrompt, setChePrompt] = useState<"thu_hoi" | "cap_nhat" | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [loiLyDo, setLoiLyDo] = useState<string | null>(null);

  // ---------------------------------------------------------------- băng báo + hoàn tác
  const [bao, setBao] = useState<Bao | null>(null);
  const [lui, setLui] = useState<BuocLui[]>([]);
  const luiRef = useRef(lui);
  luiRef.current = lui;
  useEffect(() => {
    if (!bao) return;
    const h = window.setTimeout(() => setBao(null), bao.loi ? 10_000 : 8_000);
    return () => window.clearTimeout(h);
  }, [bao]);

  const [nhip, setNhip] = useState(0);
  const lamMoi = useCallback(() => setNhip((n) => n + 1), []);
  const [moKhoaMay, setMoKhoaMay] = useState(false);
  const tickRef = useRef(eventTick);
  tickRef.current = eventTick;
  const theRef = useRef(the);
  theRef.current = the;
  const dongRef = useRef(dong);
  dongRef.current = dong;

  const thamSoLuoi = useMemo<XlLocLich>(() => ({
    tim: timLuoiCho || undefined,
    trang_thai: locLuoi.tt?.flatMap((k) => TT_NHOM[k] ?? []),
    khach_id: locLuoi.khach ? Number(locLuoi.khach) : undefined,
    gap: locLuoi.gap ? true : undefined,
    nhanh: nhanh ?? undefined,
  }), [timLuoiCho, locLuoi, nhanh]);
  const khoaLuoi = JSON.stringify(thamSoLuoi);

  // ---------------------------------------------------------------- nạp
  useEffect(() => {
    if (!token) return;
    let huy = false;
    api.xepLich
      .lich(token, { tu, den, ...(JSON.parse(khoaLuoi) as XlLocLich) })
      .then((r) => {
        if (huy) return;
        setDong(r.dong);
        setNgayNghi(r.ngay_nghi ?? []);
        setNgayDacBiet(r.ngay_dac_biet ?? []);
        setCacCa(r.cac_ca ?? []);
        setCum(r.cum ?? []);
        setDem(r.dem);
        setKhachLoc(r.khach_loc ?? []);
      })
      .catch((e) => !huy && setBao({ chu: e instanceof ApiError ? e.message : "Không tải được lịch.", loi: true }));
    return () => { huy = true; };
  }, [token, tu, den, khoaLuoi, eventTick, nhip]);

  // Đèn vật tư: hỏi riêng sau khi có dòng — câu phụ, hỏng thì lưới vẫn vẽ. Gộp cả lệnh đang nằm
  // trong khay chờ vào CÙNG một lượt: bảng cân đối là phần đắt, dựng một lần cho cả hai chỗ.
  const idsVatTu = useMemo(
    () => [...new Set([
      ...dong.filter((d) => d.trang_thai !== "da_dong").map((d) => d.lsx_id),
      ...the.map((t) => t.lsx_id),
    ])].sort((a, b) => a - b).join(","),
    [dong, the],
  );
  useEffect(() => {
    if (!token || !hien.vatTu || !idsVatTu) { setVatTu(new Map()); return; }
    let huy = false;
    api.xepLich.vatTu(token, idsVatTu.split(",").map(Number))
      .then((r) => !huy && setVatTu(new Map(r.map((v) => [v.lsx_id, v]))))
      .catch(() => !huy && setVatTu(new Map()));
    return () => { huy = true; };
  }, [token, hien.vatTu, idsVatTu]);

  useEffect(() => {
    if (!token) return;
    let huy = false;
    setTaiCho(true);
    api.xepLich
      .hangCho(token, { ...JSON.parse(khoaLocCho), tim: timCho, trang, moi_trang: MOI_TRANG })
      .then((r) => {
        if (huy) return;
        setThe(r.dong);
        setTongCho(r.tong);
      })
      .catch((e) => !huy && setBao({ chu: e instanceof ApiError ? e.message : "Không tải được lệnh chờ xếp.", loi: true }))
      .finally(() => !huy && setTaiCho(false));
    return () => { huy = true; };
  }, [token, timCho, trang, khoaLocCho, eventTick, nhip]);
  useEffect(() => setTrang(1), [timCho, khoaLocCho]);

  useEffect(() => {
    if (!token || chonId === null) { setCt(null); setLoiCt(false); return; }
    let huy = false;
    setTaiCt(true);
    api.xepLich
      .chiTiet(token, chonId)
      .then((r) => { if (!huy) { setCt(r); setLoiCt(false); } })
      .catch((e) => {
        if (huy) return;
        setLoiCt(true);
        setBao({ chu: e instanceof ApiError ? e.message : "Không tải được chi tiết lệnh.", loi: true });
      })
      .finally(() => !huy && setTaiCt(false));
    return () => { huy = true; };
  }, [token, chonId, eventTick, nhip]);

  // Trạng thái gói đã thả xuống xưởng — hỏi TRƯỚC khi bày nút Thu hồi / Phát hành cập nhật.
  useEffect(() => {
    if (!token || chonId === null) { setGoi(null); return; }
    let huy = false;
    api.xepLich.goiPhatHanh(token, chonId)
      .then((r) => !huy && setGoi(r))
      .catch(() => !huy && setGoi(null));
    return () => { huy = true; };
  }, [token, chonId, eventTick, nhip]);

  // ---------------------------------------------------------------- ghi
  const sau = useCallback((lsxId: number) => {
    setChonId(lsxId);
    lamMoi();
    onBadgeStale?.();
  }, [lamMoi, onBadgeStale]);

  /** Ghi giờ bắt đầu. `ghiLui` = đẩy một bước lên chồng Hoàn tác (lần hoàn tác thì không). */
  const datMoc = useCallback(async (lsxId: number, batDauAt: string, expected: string | null, ghiLui = true) => {
    if (!token || !suaDuoc) return;
    setDangGhi(true);
    // Nhịp SSE lấy LÚC GỬI: máy chủ phát sự kiện trước khi trả phản hồi.
    const tickTruoc = tickRef.current;
    const tuKhay = theRef.current.find((t) => t.lsx_id === lsxId);
    const cu = dongRef.current.find((d) => d.lsx_id === lsxId);
    try {
      const r = await api.xepLich.datMoc(token, lsxId, batDauAt, expected);
      // VẼ NGAY bằng dòng PUT trả về — máy chủ dựng nó bằng đúng `_dong` của `/lich`.
      setDong((ds) => (ds.some((d) => d.lsx_id === lsxId) ? ds.map((d) => (d.lsx_id === lsxId ? r : d)) : [...ds, r]));
      if (tuKhay) {
        setThe((ds) => ds.filter((t) => t.lsx_id !== lsxId));
        setTongCho((n) => Math.max(0, n - 1));
      }
      if (ghiLui) {
        setLui((s) => [...s.slice(-19), { lsxId, ma: r.ma, truoc: tuKhay ? null : (cu?.bat_dau_at ?? null) }]);
      }
      const chu = ghiLui
        ? `${r.ma} ${tuKhay ? "xếp" : "dời"} sang ${thuNgayGio(r.bat_dau_at)}${r.ket_thuc ? `, xong ${thuNgayGio(r.ket_thuc)}` : ""}`
        : `Đã hoàn tác ${r.ma} về ${thuNgayGio(r.bat_dau_at)}`;
      setBao({ chu: r.thong_bao ? `${chu}. ${r.thong_bao}` : chu, hoanTac: ghiLui });
      // Lệnh trong cụm: dời một lệnh là đoạn chờ của lệnh kia đổi theo ⇒ tải lại cả lịch.
      if (r.cum_id) lamMoi();
      // KHÔNG tự tải lại: máy chủ phát `xep_lich_changed`, AppShell tăng `eventTick`. Chỉ khi SSE
      // im quá 3 giây (mất kết nối) mới tự tải, để màn không đứng số cũ.
      window.setTimeout(() => {
        if (tickRef.current !== tickTruoc) return;
        lamMoi();
        onBadgeStale?.();
      }, 3000);
    } catch (e) {
      setBao({
        chu: e instanceof ApiError && e.status === 409
          ? "Người khác vừa dời lệnh này. Màn đang tải lại bản mới nhất."
          : e instanceof ApiError ? e.message : "Không lưu được giờ bắt đầu.",
        loi: true,
      });
      lamMoi();
    } finally {
      setDangGhi(false);
      setKeoTuKhay(null);
    }
  }, [token, suaDuoc, lamMoi, onBadgeStale]);

  const hoanTac = useCallback(async () => {
    const b = luiRef.current[luiRef.current.length - 1];
    if (!b || !token) return;
    setLui((s) => s.slice(0, -1));
    if (b.truoc === null) {
      setDangGhi(true);
      try {
        await api.xepLich.xoaMoc(token, b.lsxId);
        setBao({ chu: `Đã hoàn tác: ${b.ma} quay lại khay Chờ xếp lịch` });
        lamMoi();
        onBadgeStale?.();
      } catch (e) {
        setBao({ chu: e instanceof ApiError ? e.message : "Không hoàn tác được.", loi: true });
      } finally {
        setDangGhi(false);
      }
      return;
    }
    const hienTai = dongRef.current.find((d) => d.lsx_id === b.lsxId);
    await datMoc(b.lsxId, b.truoc, hienTai?.updated_at ?? null, false);
  }, [token, datMoc, lamMoi, onBadgeStale]);

  const boLich = useCallback(async () => {
    if (!token || chonId === null) return;
    setDangGhi(true);
    try {
      await api.xepLich.xoaMoc(token, chonId);
      setBao({ chu: "Đã bỏ lịch, lệnh quay lại khay Chờ xếp lịch." });
      setLui((s) => s.filter((x) => x.lsxId !== chonId));
      sau(chonId);
    } catch (e) {
      setBao({ chu: e instanceof ApiError ? e.message : "Không bỏ được lịch.", loi: true });
    } finally {
      setDangGhi(false);
    }
  }, [token, chonId, sau]);

  const phatHanh = useCallback(async () => {
    if (!token || chonId === null) return;
    setDangGhi(true);
    const n = ct?.cum?.lsx.length ?? 1;
    try {
      const r = await api.xepLich.phatHanh(token, chonId);
      setBao(cauBaoPhatHanh(n, r.vat_tu));
      sau(chonId);
    } catch (e) {
      setBao({ chu: e instanceof ApiError ? e.message : "Không phát hành được.", loi: true });
    } finally {
      setDangGhi(false);
    }
  }, [token, chonId, ct, sau]);

  const moPrompt = (che: "thu_hoi" | "cap_nhat") => {
    setLyDo("");
    setLoiLyDo(null);
    setChePrompt(che);
  };
  const dongPrompt = () => {
    setChePrompt(null);
    setLyDo("");
    setLoiLyDo(null);
  };
  const xacNhanPrompt = async () => {
    if (!token || chonId === null || chePrompt === null) return;
    const ld = lyDo.trim();
    if (ld.length < 3) {
      setLoiLyDo(chePrompt === "thu_hoi"
        ? "Vui lòng nhập lý do thu hồi dài ít nhất 3 ký tự."
        : "Vui lòng nhập lý do cập nhật dài ít nhất 3 ký tự.");
      return;
    }
    setDangGhi(true);
    setLoiLyDo(null);
    try {
      if (chePrompt === "thu_hoi") {
        const r = await api.xepLich.thuHoi(token, chonId, ld);
        const n = r.cum_lsx?.length ?? 1;
        setBao({ chu: n > 1 ? `Đã thu hồi ${n} lệnh khỏi xưởng.` : "Đã thu hồi phát hành." });
      } else {
        const r = await api.xepLich.phatHanhCapNhat(token, chonId, ld);
        setBao({
          chu: `Đã đẩy lịch mới xuống xưởng: cập nhật ${r.so_cong_viec_cap_nhat} việc, giữ nguyên ${r.so_giu_nguyen} việc đã bắt đầu.`
            // Việc lệch lần chạy KHÔNG được cập nhật — nuốt con số này là xưởng chạy lịch cũ mà màn báo "xong".
            + (r.so_lech_phan_doan ? ` Còn ${r.so_lech_phan_doan} việc giữ nguyên lịch cũ vì lần chạy đã tách hoặc gộp lại.` : ""),
        });
      }
      dongPrompt();
      sau(chonId);
    } catch (e) {
      setLoiLyDo(e instanceof ApiError ? e.message : "Không thực hiện được.");
    } finally {
      setDangGhi(false);
    }
  };

  // ---------------------------------------------------------------- phím tắt màn
  useEffect(() => {
    const phim = (e: KeyboardEvent) => {
      if (laONhap(e.target) || document.querySelector(".cdlg-overlay")) return;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        oTimRef.current?.focus();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        if (luiRef.current.length === 0) return;
        e.preventDefault();
        void hoanTac();
      }
    };
    document.addEventListener("keydown", phim);
    return () => document.removeEventListener("keydown", phim);
  }, [hoanTac]);

  // ---------------------------------------------------------------- dẫn xuất
  const hienLuoi = useMemo<HienThi>(
    () => ({ ...hien, hienXong: hien.hienXong || !!locLuoi.tt?.includes("dong") }),
    [hien, locLuoi.tt],
  );
  const dongThay = useMemo(
    () => dong
      .filter((d) => hienLuoi.hienXong || d.trang_thai !== "da_dong")
      .sort((a, b) => (moc(a.thuc_bat_dau_lenh ?? a.bat_dau_at) ?? 0) - (moc(b.thuc_bat_dau_lenh ?? b.bat_dau_at) ?? 0)),
    [dong, hienLuoi.hienXong],
  );
  const viTri = chonId === null ? -1 : dongThay.findIndex((d) => d.lsx_id === chonId);
  // Đếm đúng các lệnh lưới đang vẽ — lệnh đã xong bị ẩn mà vẫn cộng giờ thì đầu màn ghi "máy chạy
  // 3 giờ" cạnh "0 lệnh trong khoảng".
  const phutChay = useMemo(() => phutChayTrongCuaSo(dongThay, tu, soNgay), [dongThay, tu, soNgay]);
  const caPhut = useMemo(() => phutCa(cacCa), [cacCa]);
  const caDau = useMemo(() => cacCa.map((c) => c.tu.slice(0, 5)).sort()[0] ?? "00:00", [cacCa]);
  const truocDo = useMemo(() => {
    for (let i = lui.length - 1; i >= 0; i -= 1) if (lui[i].lsxId === chonId) return lui[i].truoc;
    return null;
  }, [lui, chonId]);

  const dieuKienLuoi = useMemo<DieuKien<LocLuoi>[]>(() => [
    {
      khoa: "tt", nhan: "Trạng thái", icon: CircleDot, kieu: "nhieu",
      giaTri: [
        { value: "chua", nhan: "Chưa phát hành" },
        { value: "phat", nhan: "Đã phát hành" },
        { value: "dong", nhan: "Đã xong" },
      ],
      doc: (l) => l.tt ?? [],
      ghi: (l, v) => ({ ...l, tt: v.length ? v : undefined }),
    },
    {
      khoa: "khach", nhan: "Khách hàng", icon: Building2, kieu: "mot", tim: true,
      giaTri: khachLoc.map((k) => ({ value: String(k.id), nhan: k.ten, so: k.so })),
      doc: (l) => l.khach,
      ghi: (l, v) => ({ ...l, khach: v }),
    },
    {
      khoa: "gap", nhan: "Gấp", icon: Zap, kieu: "mot",
      giaTri: [{ value: "1", nhan: "Chỉ lệnh gấp" }],
      doc: (l) => l.gap,
      ghi: (l, v) => ({ ...l, gap: v }),
    },
  ], [khachLoc]);

  const coLoc = !!timLuoi || !!nhanh || !!locLuoi.tt || !!locLuoi.khach || !!locLuoi.gap;
  const xoaLoc = () => {
    setTimLuoi("");
    setNhanh(null);
    setLocLuoi({});
  };

  const NHANH: { k: Nhanh; nhan: string; mau: string }[] = [
    { k: "tre", nhan: "Trễ hạn", mau: "#dc2626" },
    { k: "muon", nhan: "Có thể xong muộn hơn", mau: "#d97706" },
    { k: "chua", nhan: "Chưa phát hành", mau: "#2563eb" },
  ];

  const chip = (k: keyof HienThi, nhan: string, Ic: typeof Building2) => (
    <button type="button" aria-pressed={hien[k]} onClick={() => setHien({ ...hien, [k]: !hien[k] })}>
      <Ic size={13} style={{ marginRight: 6 }} />{nhan}
    </button>
  );
  const gat = (k: keyof HienThi, nhan: string, Ic: typeof Building2) => (
    <button type="button" className="xa-hien__dong" role="switch" aria-checked={hien[k]} onClick={() => setHien({ ...hien, [k]: !hien[k] })}>
      <span className="k"><Ic size={14} />{nhan}</span>
      <span className="xa-gian" />
      <span className={`xa-gat${hien[k] ? " xa-gat--on" : ""}`} />
    </button>
  );

  const laThuHoi = chePrompt === "thu_hoi";
  const maLenh = ct?.ma ?? `lệnh số ${chonId}`;
  // Thu hồi rút CẢ CỤM đã phát hành chung một gói — hộp hỏi phải kể đủ lệnh sẽ bị rút.
  const maCum = ct?.cum && ct.cum.lsx.length > 1 ? ct.cum.lsx.map((z) => z.ma).join(" và ") : null;

  return (
    <div className="xa">
      <header className="xa-dau">
        <h1>Xếp lịch</h1>
        <div className="xa-kn">
          <button type="button" className={`xa-kn__nay${coHomNay ? " is-trong" : ""}`} onClick={homNay}
            title={coHomNay ? "Hôm nay đang nằm trong khoảng xem" : "Về khoảng có hôm nay"}>
            <i />Hôm nay
          </button>
          <div className={`xa-kn__hop${moKhoang ? " is-mo" : ""}`}>
            <button type="button" className="xa-kn__mui" aria-label="Khoảng trước" title="Lùi một khoảng" onClick={() => luiTien(-1)}><ChevronLeft size={17} /></button>
            <button type="button" className="xa-kn__giua" aria-haspopup="dialog" aria-expanded={moKhoang}
              title="Chọn khoảng ngày" onClick={() => setMoKhoang((m) => !m)}>
              <span className="xa-kn__lich"><CalendarDays size={14} /></span>
              <NhanKhoang tu={tu} den={den} />
              {coNhin === "tuan" && <span className="xa-kn__phu">tuần {soTuan(tu)}</span>}
              {!coNhin && <span className="xa-kn__phu">{soNgay} ngày</span>}
            </button>
            <button type="button" className="xa-kn__mui" aria-label="Khoảng sau" title="Tới một khoảng" onClick={() => luiTien(1)}><ChevronRight size={17} /></button>
          </div>
          <div className="xa-kn__co" role="group" aria-label="Cỡ nhìn">
            {CO_NHIN.map((c) => (
              <button key={c.id} type="button" aria-pressed={coNhin === c.id} onClick={() => chonCo(c.id)}>{c.ten}</button>
            ))}
          </div>
        </div>
        {moKhoang && (
          <XlKhoangNgay tu={tu} den={den} onDong={() => setMoKhoang(false)}
            onApDung={(a, b) => { setTu(a); setDen(b); setMoKhoang(false); }} />
        )}
        <span className="xa-ngan-dung" />
        <label className="xa-o-tim">
          <Search size={15} />
          <input ref={oTimRef} value={timLuoi} placeholder="Tìm mã, tên, khách" aria-label="Tìm lệnh trên lịch"
            onChange={(e) => setTimLuoi(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setTimLuoi(""); (e.target as HTMLInputElement).blur(); } }} />
          {timLuoi ? (
            <button type="button" className="xa-btn xa-btn--tron" style={{ height: 22, padding: 0 }} aria-label="Xoá ô tìm" onClick={() => setTimLuoi("")}><X size={13} /></button>
          ) : <kbd>/</kbd>}
        </label>
        <div className="xa-loc tl-thanh">
          <ThanhLoc dieuKien={dieuKienLuoi} loc={locLuoi} onLoc={setLocLuoi} />
        </div>
        <span className="xa-gian" />
        <button type="button" className="xa-btn" aria-haspopup="dialog" onClick={() => setMoKhoaMay(true)}>
          <Wrench size={15} />Khoá máy
        </button>
        <button ref={nutHienRef} type="button" className={`xa-btn${moHien ? " xa-btn--bat" : ""}`} aria-expanded={moHien} onClick={() => setMoHien((m) => !m)}>
          <SlidersHorizontal size={15} />Hiển thị
        </button>
        <button type="button" className={`xa-btn${khayMo ? " xa-btn--bat" : ""}`} aria-pressed={khayMo} onClick={() => setKhayMo((m) => !m)}>
          <Inbox size={15} />Chờ xếp lịch<span className="xa-dem">{tongCho}</span>
        </button>
        {moHien && (
          <div className="xa-hien" ref={hienRef} role="dialog" aria-label="Hiển thị">
            <div className="xa-hien__khoi">
              <p className="xa-hien__nhan">Độ cao dòng</p>
              <div className="xa-seg">
                <button type="button" aria-pressed={!hien.thoang} onClick={() => setHien({ ...hien, thoang: false })}>Gọn</button>
                <button type="button" aria-pressed={hien.thoang} onClick={() => setHien({ ...hien, thoang: true })}>Thoáng</button>
              </div>
            </div>
            <div className="xa-hien__khoi">
              <p className="xa-hien__nhan">Thông tin ở cột trái{hien.thoang ? "" : ", hiện khi chọn Thoáng"}</p>
              <div className="xa-tg">
                {chip("khach", "Khách hàng", Building2)}
                {chip("may", "Máy chính", Printer)}
                {chip("sl", "Sản lượng", Hash)}
                {chip("gioChay", "Giờ chạy", Clock)}
                {chip("soTo", "Số tờ in", FileText)}
              </div>
            </div>
            <div className="xa-hien__khoi">
              {gat("hienXong", "Hiện lệnh đã xong", Users)}
              {gat("vatTu", "Hiện tình trạng vật tư", Package)}
            </div>
          </div>
        )}
      </header>

      <div className="xa-tom">
        <span>Trong khoảng này máy chạy <span className="xa-tom__so">{gioChu(phutChay)}</span></span>
        {NHANH.filter((n) => dem[n.k] > 0 || nhanh === n.k).map((n) => (
          <button key={n.k} type="button" className="xa-ln" aria-pressed={nhanh === n.k} onClick={() => setNhanh(nhanh === n.k ? null : n.k)}>
            <i style={{ background: n.mau }} />{n.nhan}<span className="xa-tom__so">{dem[n.k]}</span>
          </button>
        ))}
        {coLoc && <button type="button" className="xa-lk" onClick={xoaLoc}>Xoá bộ lọc</button>}
        <span className="xa-gian" />
        {cacCa.map((c) => (
          <span key={`${c.ten}${c.tu}`} className="xa-ca"><Clock size={13} />{c.ten} {c.tu} đến {c.den}</span>
        ))}
      </div>

      <div className="xa-than">
        {laDT ? (
          <XlDanhSachDT
            dong={dong}
            vatTu={vatTu}
            hienXong={hien.hienXong}
            chonId={chonId}
            trong={coLoc ? "Không có lệnh nào khớp bộ lọc." : undefined}
            onChon={setChonId}
          />
        ) : (
        <main className="xa-luoi">
          <XlLuoi
            tu={tu}
            soNgay={soNgay}
            dong={dong}
            ngayNghi={ngayNghi}
            ngayDacBiet={ngayDacBiet}
            cum={cum}
            vatTu={vatTu}
            hien={hienLuoi}
            chonId={chonId}
            suaDuoc={suaDuoc && !dangGhi}
            keoTuKhay={keoTuKhay}
            caPhut={caPhut}
            caDau={caDau}
            trong={coLoc ? "Không có lệnh nào khớp bộ lọc." : undefined}
            onChon={setChonId}
            onDatMoc={datMoc}
            onThu={(id, gio, signal) => api.xepLich.thuMoc(token ?? "", id, gio, signal)}
          />
        </main>
        )}
        {khayMo && (
          <XlKhay
            the={the}
            vatTu={hien.vatTu ? vatTu : undefined}
            tong={tongCho}
            tim={tim}
            trang={trang}
            moiTrang={MOI_TRANG}
            dangTai={taiCho}
            keoDuoc={suaDuoc}
            keoId={keoTuKhay?.lsx_id ?? null}
            thanhLoc={(
              <ThanhLoc
                ky={locCho.ky}
                moc={MOC_HANG_CHO}
                onKy={(ky) => setLocCho({ ...locCho, ky })}
                dieuKien={dieuKienCho}
                loc={locCho.loc}
                onLoc={(loc) => setLocCho({ ...locCho, loc })}
              />
            )}
            dangLoc={khoaLocCho !== "{}"}
            onTim={setTim}
            onTrang={setTrang}
            onChon={setChonId}
            onKeo={setKeoTuKhay}
            onThu={() => setKhayMo(false)}
          />
        )}
      </div>

      <footer className="xa-chan">
        <span><i style={{ width: 22, height: 10, borderRadius: 3, background: "#eef3fe", boxShadow: "inset 0 0 0 1px #bfdbfe" }} />Chưa phát hành</span>
        <span><i style={{ width: 22, height: 10, borderRadius: 3, background: "#edf8f1", boxShadow: "inset 0 0 0 1px #bbf7d0" }} />Đã phát hành</span>
        <span><i style={{ width: 22, height: 10, borderRadius: 3, background: "#16a34a" }} />Đã chạy</span>
        <span><i style={{ width: 22, height: 10, borderRadius: 3, background: "repeating-linear-gradient(-45deg, #fecaca 0 4px, #fee2e2 4px 8px)" }} />Quá hạn</span>
        <span><i style={{ width: 22, height: 10, borderRadius: 3, boxShadow: "inset 0 0 0 1.5px #8b5cf6" }} />In chung một tờ</span>
        <span><i style={{ width: 9, height: 9, transform: "rotate(45deg)", border: "1.5px solid #475569", background: "#fff" }} />Hạn xong sản xuất</span>
        <span className="xa-gian" />
        <span className="xa-phim"><kbd>◀</kbd><kbd>▶</kbd>15 phút</span>
        <span className="xa-phim"><kbd>Shift</kbd><kbd>◀</kbd><kbd>▶</kbd>một ca</span>
        <span className="xa-phim"><kbd>Ctrl</kbd><kbd>Z</kbd>hoàn tác</span>
      </footer>

      {bao && (
        <div className={`xa-toast${bao.loi ? " xa-toast--loi" : ""}`} role={bao.loi ? "alert" : "status"}>
          <span title={bao.giai}>{bao.chu}</span>
          {bao.hoanTac && lui.length > 0 && (
            <button type="button" onClick={() => { setBao(null); void hoanTac(); }}><RotateCcw size={14} />Hoàn tác<kbd>Ctrl Z</kbd></button>
          )}
          <button type="button" className="xa-toast__x" aria-label="Đóng thông báo" onClick={() => setBao(null)}><X size={14} /></button>
        </div>
      )}

      {chonId !== null && (
        <XlNgan
          ct={ct && ct.lsx_id === chonId ? ct : null}
          dangTai={taiCt || (!(ct && ct.lsx_id === chonId) && !loiCt)}
          suaDuoc={suaDuoc}
          duyetDuoc={duyetDuoc}
          dangGhi={dangGhi}
          goi={goi}
          vatTu={vatTu.get(chonId)}
          truocDo={truocDo}
          onDoiGio={(g) => void datMoc(chonId, g, ct?.updated_at ?? null)}
          onHoanTac={() => void hoanTac()}
          onBoLich={boLich}
          onPhatHanh={phatHanh}
          onThuHoi={() => moPrompt("thu_hoi")}
          onCapNhat={() => moPrompt("cap_nhat")}
          onDong={() => setChonId(null)}
          onMoLenh={setChonId}
          onMoHoSo={(id, daPhat) => navigate?.(daPhat ? "lenh-san-xuat" : "ke-hoach-sx", daPhat ? { openHoSoLsxId: id } : { openLsxId: id })}
          onSoSanh={(a, b) => api.xepLich.soSanhPhienBan(token ?? "", chonId, a, b)}
          len={viTri > 0 ? () => setChonId(dongThay[viTri - 1].lsx_id) : undefined}
          xuong={viTri >= 0 && viTri < dongThay.length - 1 ? () => setChonId(dongThay[viTri + 1].lsx_id) : undefined}
        />
      )}

      <XlKhoaMay open={moKhoaMay} suaDuoc={suaDuoc} onDong={() => setMoKhoaMay(false)} onDoi={lamMoi} />

      <ConfirmDialog
        open={chePrompt !== null}
        title={laThuHoi ? (maCum ? `Thu hồi cả cụm, ${ct?.cum?.lsx.length} lệnh` : "Thu hồi phát hành") : "Phát hành cập nhật"}
        icon={laThuHoi ? <RotateCcw size={20} /> : <Send size={20} />}
        message={laThuHoi
          ? (maCum
            ? `Các lệnh ${maCum} xuống xưởng cùng một lần nên sẽ rút về cùng nhau. Các lệnh giữ lịch đã xếp nhưng chưa phát hành.`
            : `Rút lệnh ${maLenh} khỏi xưởng, lệnh quay về có lịch nhưng chưa phát hành.`)
          : `Đẩy lịch mới xuống xưởng cho ${goi?.so_chua_bat_dau ?? 0} việc chưa bắt đầu của lệnh ${maLenh}. ${goi?.so_da_bat_dau ?? 0} việc đã chạy giữ nguyên, tổ nhận việc cập nhật phải xác nhận lại phân công.`}
        confirmLabel={dangGhi ? "Đang xử lý" : laThuHoi ? "Thu hồi" : "Đẩy lịch mới xuống xưởng"}
        cancelLabel="Huỷ"
        danger={laThuHoi}
        busy={dangGhi}
        error={loiLyDo}
        onConfirm={() => void xacNhanPrompt()}
        onCancel={dongPrompt}
      >
        <label style={{ display: "block", fontSize: 13, marginBottom: 6 }} htmlFor="xa-ly-do">
          {laThuHoi ? "Lý do thu hồi" : "Lý do cập nhật"}
        </label>
        <textarea
          id="xa-ly-do"
          className="xa-ly-do"
          autoFocus
          value={lyDo}
          placeholder={laThuHoi ? "Ví dụ: khách đổi quy cách tờ in" : "Ví dụ: dời giờ chạy vì máy in kẹt"}
          onChange={(e) => {
            setLyDo(e.target.value);
            if (loiLyDo && e.target.value.trim().length >= 3) setLoiLyDo(null);
          }}
        />
      </ConfirmDialog>
    </div>
  );
}
