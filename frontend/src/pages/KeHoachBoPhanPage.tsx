// Kế hoạch của MỘT bộ phận (08/11/2026, `docs/design-lenh-san-xuat-ke-hoach-bo-phan.md` §11, mockup
// `docs/mockups/ke-hoach-bo-phan-bang-3-phuong-an.html` phương án B).
//
// Mỗi bộ phận một mục "Kế hoạch" dưới khối Tổ sản xuất (quyền `ke_hoach_bp_<id>`). Phát lệnh thì mỗi
// bước Nội bộ tới bộ phận nhận, CHƯA nhóm nào thấy. Người kế hoạch bấm Giao: chọn máy (máy theo báo
// giá chọn sẵn, chạy máy khác phải ghi lý do) và nhóm trong một lần, nhóm thấy việc ngay. Việc đã giao
// mà nhóm chưa bắt đầu thì Rút lại được.
//
// Năm trạng thái ghép từ "đã giao chưa" của bộ phận và trạng thái tổ đang giữ — tổ bấm Bắt đầu / Tạm
// dừng / Kết thúc là màn đổi theo (SSE). Cách xem chính là Bảng việc; Kanban theo máy là cách xem
// thứ hai, việc chờ giao nằm ở khay riêng, chọn việc rồi bấm "Giao vào đây" (hoặc kéo thả ở máy tính).
// Không có số ước lượng nào (giờ rảnh, kịp hạn): chủ dự án cấm.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Cog, Users } from "lucide-react";

import { ApiError, api } from "../api/client";
import type { KhbpBang, KhbpChip, KhbpMay, KhbpTrangThai, KhbpTrangViec, KhbpViec, SxWorkItemChiTiet } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Icon } from "../components/Icons";
import { ChipTT, ChonCot, CuonLuoi, OTim, rongLuoi, useCauHinhLuoi, type CotLuoi, type MauTT } from "../components/LuoiDs";
import { PhanTrangDayDu } from "../components/PhanTrangDayDu";
import { useLaDienThoai } from "../utils/dienThoai";
import { useDebounced } from "../utils/useDebounced";
import { ThanhLoc } from "./thanh-loc/ThanhLoc";
import { thamSoKy, type KyDS } from "./thanh-loc/ky-danh-sach";
import { chuThanhId, idThanhChu } from "./thanh-loc/lua-chon";
import type { DieuKien } from "./thanh-loc/thanh-loc";
import { nhanDonVi } from "./lsxBuoc";
import { useNapTenDonVi } from "./tenDonVi";
import { ThsxDrawer } from "./ThsxDrawer";
import type { ThsxExec } from "./ThsxExecPanels";
import "./thuc-hien-sx.css";
import "./ke-hoach-bo-phan.css";

const TT: Record<KhbpTrangThai, { chu: string; mau: MauTT }> = {
  chua_giao: { chu: "Chưa giao", mau: "vang" },
  da_giao: { chu: "Đã giao", mau: "tim" },
  dang_chay: { chu: "Đang chạy", mau: "cyan" },
  tam_dung: { chu: "Tạm dừng", mau: "cam" },
  hoan_thanh: { chu: "Hoàn thành", mau: "la" },
};
const THU_TU_TT: KhbpTrangThai[] = ["chua_giao", "da_giao", "dang_chay", "tam_dung", "hoan_thanh"];

/** Màu tình trạng máy — cùng bộ mã `services/may_trang_thai.py`; Làm tay xám. */
const MAU_MAY: Record<string, MauTT> = {
  ranh: "la", dang_chay: "cyan", bao_tri: "cam", may_dung: "do", khoa: "slate", co_phieu_sua: "vang",
};

const XEM_KEY = "khbp.xem";
/** Kanban: bật thì máy chưa có việc vẫn đứng thành cột; tắt thì gom thành dải chip trên bảng. */
const TRONG_KEY = "khbp.trongcot";
/** Kanban: số thẻ tối đa mỗi cột, còn lại xem ở Bảng việc. */
const HIEN_TOI_DA = 6;
type Xem = "bang" | "kb";

/** Cột của Bảng việc (nút Cột ẩn / đổi chỗ / ghim / kéo rộng); Lệnh và Sản phẩm ghim trái như Việc
 *  của tổ, Thao tác đứng ngoài nút Cột và ghim mép phải. */
type CotBang = CotLuoi & { w?: number };
const COT_BANG: CotBang[] = [
  { key: "lenh", label: "Lệnh", coDinh: true, w: 130 },
  { key: "sp", label: "Sản phẩm", coDinh: true, w: 210 },
  { key: "cd", label: "Công đoạn", w: 150 },
  { key: "tt", label: "Trạng thái", w: 160 },
  { key: "may", label: "Máy", w: 190 },
  { key: "nhom", label: "Nhóm", w: 140 },
  { key: "han", label: "Hạn giao", w: 86 },
];
/** Kỳ của bảng việc tính theo lúc việc tới bộ phận — một mốc nên nút kỳ không có phần "Tính theo". */
const MOC_BANG: [string, string][] = [["toi", "Ngày tới"]];
type LocBang = { may?: number; nhom?: number };
type LocKb = { nhom?: number };
/** Cột kanban: id máy, hoặc "tay" = Làm tay. */
type Cot = number | "tay";

const so = (n: number | null | undefined) => (n ?? 0).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
const p2 = (n: number) => String(n).padStart(2, "0");

function ngayNgan(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
}
function ngayGio(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** Hạn của lệnh so với hôm nay: "tre" đã qua, "gan" còn tới một ngày. */
function lopHan(v: KhbpViec): "" | "gan" | "tre" {
  if (!v.han_giao || v.trang_thai_kh === "hoan_thanh") return "";
  const han = new Date(v.han_giao);
  if (Number.isNaN(han.getTime())) return "";
  const homNay = new Date();
  homNay.setHours(0, 0, 0, 0);
  han.setHours(0, 0, 0, 0);
  const ngay = (han.getTime() - homNay.getTime()) / 864e5;
  return ngay < 0 ? "tre" : ngay <= 1 ? "gan" : "";
}

function soLuong(v: KhbpViec): string {
  const sl = v.so_luong_ra ?? v.so_luong_vao;
  const dv = v.so_luong_ra != null ? v.don_vi_ra : v.don_vi_vao;
  return sl == null ? "" : `${so(sl)} ${nhanDonVi(dv)}`.trim();
}

/** Chữ phụ dưới chip: thông tin tổ vừa ghi (số đã làm, lý do tạm dừng, giờ xong). */
function phuTT(v: KhbpViec): string {
  if (v.trang_thai_kh === "dang_chay" && v.da_lam != null) {
    const kh = v.so_luong_ra ?? v.so_luong_vao;
    return `Đã làm ${so(v.da_lam)}${kh != null ? `/${so(kh)}` : ""} ${nhanDonVi(v.don_vi_ra ?? v.don_vi_vao)}`.trim();
  }
  if (v.trang_thai_kh === "tam_dung" && v.ly_do_tam_dung) return `Lý do: ${v.ly_do_tam_dung}`;
  if (v.trang_thai_kh === "hoan_thanh" && v.hoan_thanh_luc) return `Xong ${ngayGio(v.hoan_thanh_luc)}`;
  return "";
}

function loiChu(e: unknown): string {
  if (e instanceof ApiError) return e.isNetwork ? "Mất kết nối tới máy chủ" : e.message;
  return "Có lỗi, thử lại";
}

function docXem(): Xem {
  try { return localStorage.getItem(XEM_KEY) === "kb" ? "kb" : "bang"; } catch { return "bang"; }
}

/** Ngăn dùng lại của Việc của tổ ở chế độ chỉ xem: mọi mặt ghi của tổ là không. */
const KHONG_GHI: ThsxExec = {
  doiMay: async () => false,
  taoBatch: async () => null,
  deXuatBanGiao: async () => false,
  suaBanGiao: async () => false,
  xacNhanBanGiao: async () => false,
  suaSoMe: async () => false,
  deNghiVatTu: async () => false,
  suaDeNghiVatTu: async () => false,
  nhapLaiVatTu: async () => false,
  capNhatDanhMucMe: async () => false,
};
const khongLam = () => {};

/** Khay Giao đang mở: máy đã chọn (`undefined` = chưa chọn, `null` = Làm tay). */
interface HopGiao {
  v: KhbpViec;
  may: number | null | undefined;
  nhom: number | null;
  lyDo: string;
  /** Mở danh sách máy (bấm Đổi, hoặc chưa có máy nào chọn sẵn). */
  doi: boolean;
}

interface ThongBao { chu: string; hoanTac?: { id: number; version: number } }

export function KeHoachBoPhanPage({ boPhanId, tenBoPhan, eventTick = 0 }: {
  boPhanId: number;
  tenBoPhan?: string;
  eventTick?: number;
}) {
  const { token } = useAuth();
  const laDT = useLaDienThoai();
  useNapTenDonVi();

  const [bang, setBang] = useState<KhbpBang | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [xem, setXem] = useState<Xem>(docXem);
  useEffect(() => { try { localStorage.setItem(XEM_KEY, xem); } catch { /* riêng tư */ } }, [xem]);
  const [chip, setChip] = useState<KhbpChip>("chua_giao");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [hop, setHop] = useState<HopGiao | null>(null);
  const [hopLoi, setHopLoi] = useState<string | null>(null);
  const [tb, setTb] = useState<ThongBao | null>(null);
  // Kanban: việc đang chọn để giao, máy trống thành cột, khối máy gập (điện thoại), tấm chờ giao (điện thoại).
  const [chonId, setChonId] = useState<number | null>(null);
  const [trongCot, setTrongCot] = useState<boolean>(() => {
    try { return localStorage.getItem(TRONG_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(TRONG_KEY, trongCot ? "1" : "0"); } catch { /* riêng tư */ } }, [trongCot]);
  const kbRef = useRef<HTMLDivElement>(null);
  const cuonRef = useRef<HTMLDivElement>(null);
  const [mayGap, setMayGap] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState(false);
  const [keo, setKeo] = useState<KhbpViec | null>(null);
  const [tren, setTren] = useState<string | null>(null);
  // Ngăn chi tiết.
  const [moId, setMoId] = useState<number | null>(null);
  const [chiTiet, setChiTiet] = useState<SxWorkItemChiTiet | null>(null);
  const [ctLoi, setCtLoi] = useState(false);

  // Bảng việc: tìm, kỳ, lọc, trang — máy chủ lọc, đếm năm chip và cắt trang.
  const timCham = useDebounced(q.trim());
  const [ky, setKy] = useState<KyDS>({ loai: "tat_ca", moc: "toi" });
  const [locBang, setLocBang] = useState<LocBang>({});
  const [locKb, setLocKb] = useState<LocKb>({});
  const [trang, setTrang] = useState(1);
  const [coTrang, setCoTrang] = useState(25);
  const [tv, setTv] = useState<KhbpTrangViec | null>(null);
  const [tvLoi, setTvLoi] = useState<string | null>(null);
  const [tvDangNap, setTvDangNap] = useState(false);
  const luoi = useCauHinhLuoi("khbp-bang");
  const khoaLoc = JSON.stringify({ ...thamSoKy(ky), may_id: locBang.may, nhom_id: locBang.nhom });
  useEffect(() => { setTrang(1); }, [timCham, khoaLoc, chip, boPhanId]);

  const luot = useRef(0);
  const luotTv = useRef(0);
  const [tick, setTick] = useState(0);
  const xemRef = useRef(xem);
  xemRef.current = xem;
  /** Cả bộ phận (mọi việc còn sống) chỉ Kanban cần. Bảng việc tự đủ máy, nhóm, quyền giao trong
   *  trang của nó, nên đứng ở Bảng việc thì không kéo bảng này (nặng nhất màn) mỗi nhịp SSE. */
  const napBang = useCallback(() => {
    if (!token) return;
    const l = ++luot.current;
    api.keHoachBoPhan.bang(token, boPhanId)
      .then((b) => { if (l === luot.current) { setBang(b); setLoi(null); } })
      .catch((e) => { if (l === luot.current) setLoi(loiChu(e)); });
  }, [token, boPhanId]);
  useEffect(() => { if (xem === "kb") napBang(); }, [xem, napBang, eventTick]);
  const nap = useCallback(() => {
    setTick((t) => t + 1);
    if (xemRef.current === "kb") napBang();
  }, [napBang]);
  useEffect(() => {
    if (!token || xem !== "bang") return;
    const l = ++luotTv.current;
    setTvDangNap(true);
    api.keHoachBoPhan.viec(token, boPhanId, {
      trang_thai: chip, tim: timCham || undefined, trang, co_trang: coTrang, loc: JSON.parse(khoaLoc),
    })
      .then((r) => { if (l === luotTv.current) { setTv(r); setTvLoi(null); } })
      .catch((e) => { if (l === luotTv.current) setTvLoi(loiChu(e)); })
      .finally(() => { if (l === luotTv.current) setTvDangNap(false); });
  }, [token, boPhanId, xem, chip, timCham, trang, coTrang, khoaLoc, tick, eventTick]);

  const napNgan = useCallback(() => {
    if (!token || moId == null) return;
    setCtLoi(false);
    api.keHoachBoPhan.chiTiet(token, moId).then(setChiTiet).catch(() => setCtLoi(true));
  }, [token, moId]);
  useEffect(() => { setChiTiet(null); }, [moId]);
  useEffect(() => { napNgan(); }, [napNgan, eventTick]);

  useEffect(() => {
    if (!tb) return;
    const t = setTimeout(() => setTb(null), 6000);
    return () => clearTimeout(t);
  }, [tb]);

  // Kanban máy tính: bảng cao tới đáy cửa sổ, mỗi cột tự cuộn dọc; cuộn ngang thì mờ mép còn cột.
  const capNhatVien = useCallback(() => {
    const k = cuonRef.current;
    const c = k?.firstElementChild as HTMLElement | null;
    if (!k || !c) return;
    k.classList.toggle("co-trai", c.scrollLeft > 2);
    k.classList.toggle("co-phai", c.scrollLeft + c.clientWidth < c.scrollWidth - 2);
  }, []);
  useLayoutEffect(() => {
    const el = kbRef.current;
    if (!el) return;
    const dat = () => {
      el.style.height = `${Math.max(420, Math.round(window.innerHeight - el.getBoundingClientRect().top - 16))}px`;
      capNhatVien();
    };
    dat();
    window.addEventListener("resize", dat);
    return () => window.removeEventListener("resize", dat);
  });
  useEffect(() => {
    if (chonId == null) return;
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") setChonId(null); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [chonId]);

  const giaoDuoc = !!(bang?.bo_phan.giao_duoc ?? tv?.giao_duoc);
  const ds = bang?.viec ?? [];
  const mayCua = useMemo(() => {
    const m = new Map<number, KhbpMay>();
    for (const x of [...(bang?.may_ngoai ?? []), ...(bang?.may ?? []), ...(tv?.may ?? [])]) m.set(x.id, x);
    return m;
  }, [bang, tv]);
  const tenNhom = useMemo(() => new Map([...(bang?.nhom ?? []), ...(tv?.nhom ?? [])].map((n) => [n.id, n.ten])), [bang, tv]);
  const tenMay = (id: number | null | undefined) =>
    id == null ? "Làm tay" : (mayCua.get(id)?.ten || mayCua.get(id)?.ma || `Máy #${id}`);

  /** Kanban: tìm và lọc nhóm trên bảng của bộ phận đã nạp đủ (bảng việc lọc ở máy chủ). */
  const khop = useCallback((v: KhbpViec) => {
    if (locKb.nhom != null && v.trang_thai_kh !== "chua_giao" && v.department_id !== locKb.nhom) return false;
    const k = q.trim().toLowerCase();
    if (!k) return true;
    return [v.lsx_ma, v.bai_ghep_ma, v.lsx_ten, v.khach_hang, v.ten_cong_doan,
      v.may_id != null ? (mayCua.get(v.may_id)?.ten ?? "") : ""]
      .join(" ").toLowerCase().includes(k);
  }, [q, mayCua, locKb.nhom]);

  const nhomBp = (xem === "bang" ? tv?.nhom : bang?.nhom) ?? bang?.nhom ?? tv?.nhom ?? [];
  const mayBp = (xem === "bang" ? tv?.may.filter((m) => m.nhom_ids) : bang?.may) ?? bang?.may ?? [];
  const giaTriNhom = nhomBp.map((n) => ({ value: String(n.id), nhan: n.ten ?? "" }));
  const dkBang: DieuKien<LocBang>[] = [
    {
      khoa: "may", nhan: "Máy", icon: Cog, kieu: "mot", tim: true,
      giaTri: mayBp.map((m) => ({ value: String(m.id), nhan: m.ten || m.ma || `Máy #${m.id}` })),
      doc: (l) => idThanhChu(l.may), ghi: (l, v) => ({ ...l, may: chuThanhId(v) }),
    },
    {
      khoa: "nhom", nhan: "Nhóm", icon: Users, kieu: "mot", giaTri: giaTriNhom,
      doc: (l) => idThanhChu(l.nhom), ghi: (l, v) => ({ ...l, nhom: chuThanhId(v) }),
    },
  ];
  const dkKb: DieuKien<LocKb>[] = [
    {
      khoa: "nhom", nhan: "Nhóm", icon: Users, kieu: "mot", giaTri: giaTriNhom,
      doc: (l) => idThanhChu(l.nhom), ghi: (l, v) => ({ ...l, nhom: chuThanhId(v) }),
    },
  ];

  // ---------------- nhóm hợp lệ, giao, rút ----------------

  /** Nhóm chọn được khi chạy `may` (null = Làm tay): nhóm của máy trong số nhóm làm được công đoạn. */
  const nhomCho = useCallback((v: KhbpViec, may: number | null): number[] => {
    if (may == null) return v.nhom_chon;
    const cuaMay = mayCua.get(may)?.nhom_ids ?? [];
    const giao = v.nhom_chon.filter((n) => cuaMay.includes(n));
    return giao.length ? giao : v.nhom_chon;
  }, [mayCua]);

  const canLyDo = (v: KhbpViec, may: number | null | undefined) =>
    v.may_goi_y_id != null && may !== undefined && may !== v.may_goi_y_id;

  /** Máy và nhóm khay Giao chọn sẵn: máy đang chạy hoặc máy theo báo giá; nhóm gợi ý nếu chạy được
   *  máy đó, không thì nhóm duy nhất chạy được. Ô Máy / Nhóm của việc chưa giao hiện đúng cặp này. */
  const duKien = (v: KhbpViec, may?: number | null) => {
    const m = may !== undefined ? may : (v.may_id ?? v.may_goi_y_id ?? undefined);
    const ns = m === undefined ? [] : nhomCho(v, m);
    const nhom = v.nhom_goi_y_id != null && ns.includes(v.nhom_goi_y_id) ? v.nhom_goi_y_id
      : ns.length === 1 ? ns[0] : null;
    return { m, nhom };
  };
  const moHop = (v: KhbpViec, may?: number | null) => {
    const { m, nhom } = duKien(v, may);
    setHopLoi(null);
    setTb(null);
    setHop({ v, may: m, nhom, lyDo: "", doi: m === undefined });
  };


  /** Máy chủ đã nhận giao / rút: đổi ngay việc trong bảng đang có cho thẻ sang cột mới, khỏi chờ
   *  nạp lại cả bảng (vài giây với bộ phận nhiều việc); lần nạp sau sẽ ghi đè bằng số thật. */
  const doiTaiCho = (id: number, sua: Partial<KhbpViec>) =>
    setBang((b) => (b ? { ...b, viec: b.viec.map((x) => (x.id === id ? { ...x, ...sua } : x)) } : b));

  /** Gọi Giao. Việc đang Đã giao (kéo sang máy khác) thì rút về trước rồi giao lại. */
  const guiGiao = async (v: KhbpViec, may: number | null, nhom: number, lyDo: string): Promise<boolean> => {
    if (!token) return false;
    setBusy(true);
    try {
      let version = v.version;
      if (v.trang_thai_kh === "da_giao") version = (await api.keHoachBoPhan.rut(token, v.id, version)).version;
      const kq = await api.keHoachBoPhan.giao(token, v.id, {
        may_id: may, department_id: nhom, ly_do: lyDo.trim() || null, version,
      });
      setTb({
        chu: `Đã giao ${v.lsx_ma ?? v.bai_ghep_ma ?? ""} vào ${tenMay(may)} cho ${tenNhom.get(nhom) ?? "nhóm"}`.replace(/\s+/g, " "),
        hoanTac: { id: v.id, version: kq.version },
      });
      doiTaiCho(v.id, {
        trang_thai_kh: "da_giao", may_id: may, department_id: nhom,
        department_ten: tenNhom.get(nhom) ?? v.department_ten, version: kq.version,
      });
      setChonId(null);
      nap();
      if (moId === v.id) napNgan();
      return true;
    } catch (e) {
      setHopLoi(loiChu(e));
      setTb({ chu: loiChu(e) });
      nap();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const rut = async (id: number, version: number, chu?: string) => {
    if (!token) return;
    setBusy(true);
    try {
      const kq = await api.keHoachBoPhan.rut(token, id, version);
      doiTaiCho(id, { trang_thai_kh: "chua_giao", department_id: null, department_ten: null, version: kq.version });
      setTb({ chu: chu ?? "Đã rút việc về Chưa giao" });
      nap();
      if (moId === id) napNgan();
    } catch (e) {
      setTb({ chu: loiChu(e) });
      nap();
    } finally {
      setBusy(false);
    }
  };

  /** Chọn cột cho một việc: đủ điều kiện (đúng máy theo báo giá, một nhóm) thì giao luôn kèm Hoàn
   *  tác; cần lý do hoặc phải chọn nhóm thì mở khay Giao chọn sẵn máy. */
  const tha = (v: KhbpViec, cot: Cot | "cho") => {
    if (cot === "cho") {
      if (v.trang_thai_kh === "da_giao") void rut(v.id, v.version, `Đã rút ${v.lsx_ma ?? ""} về Chờ giao`);
      return;
    }
    const may = cot === "tay" ? null : cot;
    const ns = nhomCho(v, may);
    const nhom = v.nhom_goi_y_id != null && ns.includes(v.nhom_goi_y_id) && ns.length === 1 ? v.nhom_goi_y_id
      : ns.length === 1 ? ns[0] : null;
    if (!canLyDo(v, may) && nhom != null) {
      void guiGiao(v, may, nhom, "");
      return;
    }
    setChonId(null);
    moHop(v, may);
  };

  const rutDuoc = (v: KhbpViec) => giaoDuoc && v.trang_thai_kh === "da_giao";
  const giaoCho = (v: KhbpViec) => giaoDuoc && v.trang_thai_kh === "chua_giao";
  /** Máy nhận được việc này (máy của bộ phận chạy được công đoạn, máy theo báo giá, Làm tay). */
  const nhanDuoc = (v: KhbpViec, cot: Cot) =>
    cot === "tay" ? v.nhom_chon.length > 0 : v.may_chon.includes(cot) || cot === v.may_goi_y_id;
  const thaDuoc = (v: KhbpViec, cot: Cot | "cho") =>
    cot === "cho" ? rutDuoc(v)
      : (giaoCho(v) && nhanDuoc(v, cot)) || (rutDuoc(v) && (v.may_id ?? "tay") !== cot && nhanDuoc(v, cot));

  // ---------------- phần vẽ dùng chung ----------------

  const chipTT = (v: KhbpViec) => <ChipTT mau={TT[v.trang_thai_kh].mau}>{TT[v.trang_thai_kh].chu}</ChipTT>;
  const han = (v: KhbpViec, dongHo = false) => {
    if (!v.han_giao) return null;
    const lop = lopHan(v);
    return (
      <span className={dongHo ? `kb-han ${lop}` : lop === "tre" ? "khbp-tre" : undefined}>
        {ngayNgan(v.han_giao)}{lop === "tre" ? " trễ" : ""}
      </span>
    );
  };
  const maViec = (v: KhbpViec) => v.lsx_ma ?? v.bai_ghep_ma ?? `#${v.id}`;
  const nutDong = (v: KhbpViec, to: boolean) => {
    const lop = to ? "khbp-nut" : "khbp-nutnho";
    if (giaoCho(v)) {
      return (
        <button type="button" className={`${lop} ${lop}--chinh`} disabled={busy}
          onClick={(e) => { e.stopPropagation(); moHop(v); }}>Giao</button>
      );
    }
    if (rutDuoc(v)) {
      return (
        <button type="button" className={lop} disabled={busy}
          onClick={(e) => { e.stopPropagation(); void rut(v.id, v.version); }}>Rút lại</button>
      );
    }
    return null;
  };
  const moNgan = (v: KhbpViec) => { setHop(null); setMoId(v.id); };

  // ---------------- Bảng việc ----------------

  const dsLoc = tv?.items ?? [];
  const coLoc = !!timCham || ky.loai !== "tat_ca" || locBang.may != null || locBang.nhom != null;
  const chuTrong = coLoc ? "Không có việc nào khớp điều kiện đang lọc." : chip === "tat_ca" ? "Bộ phận chưa có việc nào." : `Không có việc nào ${TT[chip].chu.toLowerCase()}.`;
  const xoaLoc = () => { setQ(""); setKy({ loai: "tat_ca", moc: "toi" }); setLocBang({}); };
  const cotHien = luoi.rongHien(luoi.xep(COT_BANG).filter((c) => !luoi.an.has(c.key)));
  // Ô hai tầng của lưới chuẩn (khuôn Việc của tổ): dòng chính + dòng phụ xám, mỗi tầng một dòng, dài
  // thì cắt "…" và rê chuột đọc đủ.
  const o2 = (key: string, chinh: ReactNode, phu?: ReactNode, title?: string) => (
    <td key={key} title={title}>
      <span className="khbp-g2__1">{chinh}</span>
      {phu ? <span className="khbp-g2__2">{phu}</span> : null}
    </td>
  );
  const oBang = (v: KhbpViec, key: string) => {
    const phu = phuTT(v);
    switch (key) {
      case "lenh":
        return o2(key, maViec(v), v.toi_luc ? `Tới ${ngayGio(v.toi_luc)}` : null);
      case "sp":
        return o2(key, v.lsx_ten ?? "—", v.khach_hang,
          [v.lsx_ten, v.khach_hang ? `Khách hàng: ${v.khach_hang}` : ""].filter(Boolean).join("\n") || undefined);
      case "cd":
        return o2(key, v.ten_cong_doan, soLuong(v));
      case "tt":
        return o2(key, chipTT(v), phu, phu || undefined);
      case "may": {
        const lech = v.trang_thai_kh !== "chua_giao" && v.may_goi_y_id != null && v.may_id !== v.may_goi_y_id;
        // Chưa giao: tên máy dự kiến chữ nhạt, dòng dưới nói vì sao là máy này.
        if (v.trang_thai_kh === "chua_giao") {
          if (v.may_goi_y_id == null) return o2(key, <span className="khbp-mo">Chưa chọn</span>);
          const ten = tenMay(v.may_goi_y_id);
          return o2(key, <span className="khbp-mo">{ten}</span>, "theo báo giá", `${ten}\ntheo báo giá`);
        }
        return o2(key, tenMay(v.may_id), lech ? `Báo giá chạy ${tenMay(v.may_goi_y_id)}` : null);
      }
      case "nhom": {
        if (v.department_ten) return o2(key, v.department_ten);
        // Chưa giao: nhóm khay Giao sẽ chọn sẵn, chữ nhạt; nhiều nhóm chạy được thì để người chọn.
        const nhom = v.trang_thai_kh === "chua_giao" ? duKien(v).nhom : null;
        const ten = nhom != null ? (tenNhom.get(nhom) ?? undefined) : undefined;
        return o2(key, <span className="khbp-mo">{ten ?? "Chưa chọn"}</span>, null, ten);
      }
      case "han":
        return o2(key, han(v) ?? <span className="khbp-mo">—</span>);
      default:
        return <td key={key} />;
    }
  };
  const chanTrang = tv && tv.items.length > 0 && (
    <PhanTrangDayDu trang={tv.trang} size={tv.co_trang} tong={tv.tong} soDong={tv.items.length}
      onTrang={setTrang} onSize={(n) => { setCoTrang(n); setTrang(1); }}
      loading={tvDangNap} donVi="việc" ariaLabel="Phân trang bảng việc" />
  );

  // Lưới chuẩn của dự án (khuôn Việc của tổ): kéo mép tiêu đề đổi độ rộng, nút Cột ẩn / xếp / ghim,
  // Lệnh và Sản phẩm ghim trái khi cuộn ngang. Cột Thao tác đứng ngoài nút Cột, ghim mép phải.
  const W_NUT = 84;
  const soCot = cotHien.length + (giaoDuoc ? 1 : 0);
  const veBang = () => (
    <div className="lds-sheet khbp-sheet">
      <CuonLuoi ghim={luoi.soGhim(cotHien)}>
        <table className="lds-g khbp-g2" style={{ minWidth: rongLuoi(cotHien) + (giaoDuoc ? W_NUT : 0) }}>
          <colgroup>
            {cotHien.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
            {giaoDuoc && <col style={{ width: W_NUT }} />}
          </colgroup>
          <thead>
            <tr>
              {cotHien.map((c) => <th key={c.key}>{c.label}{luoi.keo(c.key)}</th>)}
              {giaoDuoc && <th className="khbp-g2__nut">Thao tác</th>}
            </tr>
          </thead>
          <tbody>
            {tvLoi ? (
              <tr><td colSpan={soCot} className="lds-trong">
                <span className="khbp-tre">{tvLoi}</span>{" "}
                <button type="button" className="khbp-nutnho" onClick={() => setTick((t) => t + 1)}>Thử lại</button>
              </td></tr>
            ) : tv == null ? (
              <tr><td colSpan={soCot} className="lds-trong">Đang tải…</td></tr>
            ) : dsLoc.length === 0 ? (
              <tr><td colSpan={soCot} className="lds-trong">
                {chuTrong}{" "}
                {coLoc && <button type="button" className="khbp-nutnho" onClick={xoaLoc}>Xoá bộ lọc</button>}
              </td></tr>
            ) : dsLoc.map((v) => {
              const chon = moId === v.id || hop?.v.id === v.id;
              return (
                <tr key={v.id} className={`lds-dong khbp-dong${chon ? " is-chon" : ""}`} tabIndex={0}
                  aria-current={chon ? "true" : undefined} onClick={() => moNgan(v)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); moNgan(v); }
                  }}>
                  {cotHien.map((c) => oBang(v, c.key))}
                  {giaoDuoc && <td className="khbp-g2__nut">{nutDong(v, false)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </CuonLuoi>
      {chanTrang}
    </div>
  );

  const veThe = () => (
    <>
    <div className="khbp-ds">
      {tvLoi && <div className="khbp-trong"><span className="khbp-tre">{tvLoi}</span></div>}
      {!tvLoi && tv == null && <div className="khbp-trong">Đang tải…</div>}
      {dsLoc.map((v) => {
        const phu = phuTT(v);
        const n = nutDong(v, true);
        return (
          <div key={v.id} className="khbp-the" onClick={() => moNgan(v)} role="button" tabIndex={0}>
            <div className="khbp-the__1">
              <span>{maViec(v)}{v.toi_luc && <span className="khbp-mo"> Tới {ngayGio(v.toi_luc)}</span>}</span>
              {chipTT(v)}
            </div>
            <div className="khbp-the__sp">{v.lsx_ten ?? "—"}</div>
            {v.khach_hang && <div className="khbp-mo">{v.khach_hang}</div>}
            <div className="khbp-the__hang">
              <span className="khbp-tag">{v.ten_cong_doan}</span>
              {soLuong(v) && <span className="khbp-tag">{soLuong(v)}</span>}
              {v.han_giao && <span className={`khbp-tag${lopHan(v) === "tre" ? " khbp-tre" : ""}`}>Hạn {ngayNgan(v.han_giao)}{lopHan(v) === "tre" ? " trễ" : ""}</span>}
            </div>
            <div className="khbp-the__hang">
              {v.trang_thai_kh !== "chua_giao" ? (
                <>
                  <span className="khbp-tag">{tenMay(v.may_id)}</span>
                  {v.department_ten && <span className="khbp-tag">{v.department_ten}</span>}
                </>
              ) : v.may_goi_y_id != null && <span className="khbp-tag khbp-mo">Báo giá chạy {tenMay(v.may_goi_y_id)}</span>}
            </div>
            {phu && <div className="khbp-mo" style={{ marginTop: 4 }}>{phu}</div>}
            {n && <div className="khbp-the__nut">{n}</div>}
          </div>
        );
      })}
      {tv != null && !tvLoi && dsLoc.length === 0 && (
        <div className="khbp-trong">
          {chuTrong}{" "}
          {coLoc && <button type="button" className="khbp-nutnho" onClick={xoaLoc}>Xoá bộ lọc</button>}
        </div>
      )}
    </div>
    {chanTrang}
    </>
  );

  // ---------------- Kanban ----------------
  // Bám mockup docs/mockups/ke-hoach-bo-phan-kanban.html: Chờ giao đứng yên bên trái, cột máy chia đều
  // bề ngang, máy chưa có việc gom thành dải chip (bật "Máy trống thành cột" để bung), mỗi cột hiện
  // tối đa HIEN_TOI_DA thẻ, còn lại xem ở Bảng việc.

  const conLam = ds.filter((v) => v.trang_thai_kh !== "hoan_thanh" && khop(v));
  const choGiao = conLam
    .filter((v) => v.trang_thai_kh === "chua_giao")
    .sort((a, b) => (a.han_giao ?? "9").localeCompare(b.han_giao ?? "9"));
  const THU_CHAY: Record<string, number> = { dang_chay: 0, tam_dung: 1, da_giao: 2 };
  const viecCot = (cot: Cot) => conLam
    .filter((v) => v.trang_thai_kh !== "chua_giao" && (v.may_id ?? "tay") === cot)
    .sort((a, b) => THU_CHAY[a.trang_thai_kh] - THU_CHAY[b.trang_thai_kh]
      || (a.han_giao ?? "9").localeCompare(b.han_giao ?? "9"));
  // Cột: máy của bộ phận, máy ngoài đang gánh việc đã giao (máy theo báo giá ở tổ khác), cuối là Làm tay.
  const cacCot: { cot: Cot; may?: KhbpMay; viec: KhbpViec[] }[] = [
    ...(bang?.may ?? []).filter((m) => locKb.nhom == null || (m.nhom_ids ?? []).includes(locKb.nhom))
      .map((m) => ({ cot: m.id as Cot, may: m })),
    ...(bang?.may_ngoai ?? []).filter((m) => conLam.some((v) => v.trang_thai_kh !== "chua_giao" && v.may_id === m.id))
      .map((m) => ({ cot: m.id as Cot, may: m })),
    { cot: "tay" as Cot },
  ].map((c) => ({ ...c, viec: viecCot(c.cot) }));
  const thanhCot = trongCot && !laDT;
  const cotCoViec = thanhCot ? cacCot : cacCot.filter((c) => c.viec.length > 0);
  const cotTrong = thanhCot ? [] : cacCot.filter((c) => c.viec.length === 0);
  const r0 = choGiao.find((v) => v.id === chonId) ?? null;
  /** Việc đang chọn hoặc đang kéo: cột nhận được sáng nút Giao, cột không nhận được mờ đi. */
  const dangDua = r0 ?? keo;
  const nhanCot = (cot: Cot) => !!dangDua && thaDuoc(dangDua, cot);
  const mauMay = (m?: KhbpMay): MauTT => (m ? MAU_MAY[m.tinh_trang?.ma ?? ""] ?? "slate" : "slate");
  const nhomMay = (m?: KhbpMay) => (m ? (m.nhom_ids ?? []) : (bang?.nhom ?? []).map((n) => n.id))
    .map((n) => tenNhom.get(n)).filter(Boolean).join(" hoặc ");
  const tenCot = (cot: Cot) => (cot === "tay" ? "Làm tay" : tenMay(cot));
  /** Tổng số lượng việc đã giao chờ chạy của một cột; khác đơn vị thì không cộng. */
  const tongCho = (viec: KhbpViec[]) => {
    const cho = viec.filter((v) => v.trang_thai_kh === "da_giao" && (v.so_luong_ra ?? v.so_luong_vao) != null);
    if (!cho.length) return null;
    const dv = (v: KhbpViec) => (v.so_luong_ra != null ? v.don_vi_ra : v.don_vi_vao);
    if (cho.some((v) => dv(v) !== dv(cho[0]))) return null;
    return `${so(cho.reduce((s, v) => s + (v.so_luong_ra ?? v.so_luong_vao ?? 0), 0))} ${nhanDonVi(dv(cho[0]))}`.trim();
  };
  const xemHet = (cot: Cot) => {
    setChonId(null);
    setChip("tat_ca");
    setLocBang(cot === "tay" ? {} : { may: cot });
    setXem("bang");
  };

  const tienDo = (v: KhbpViec) => {
    const kh = v.so_luong_ra ?? v.so_luong_vao;
    if (v.trang_thai_kh !== "dang_chay" || v.da_lam == null || !kh) return null;
    return (
      <div className="kb-tien">
        <div className="kb-thanh"><i style={{ width: `${Math.min(100, Math.round((v.da_lam / kh) * 100))}%` }} /></div>
        <span>{so(v.da_lam)}/{so(kh)}</span>
      </div>
    );
  };
  const nhanMau = (v: KhbpViec) => (
    <>
      {v.so_mau != null && <span className="kb-tag kb-tag--mau">{v.so_mau} màu</span>}
      {soLuong(v) && <span className="kb-tag">{soLuong(v)}</span>}
    </>
  );
  const goiY = (v: KhbpViec) => [v.lsx_ten ?? v.ten_cong_doan, v.khach_hang ? `Khách hàng: ${v.khach_hang}` : ""]
    .filter(Boolean).join("\n");

  const batDauKeo = (e: DragEvent, v: KhbpViec) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(v.id));
    setKeo(v);
  };
  const ketThucKeo = () => { setKeo(null); setTren(null); };
  const oTha = (cot: Cot | "cho") => ({
    onDragOver: (e: DragEvent) => {
      if (!keo || !thaDuoc(keo, cot)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (tren !== String(cot)) setTren(String(cot));
    },
    onDragLeave: () => { if (tren === String(cot)) setTren(null); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const v = keo;
      ketThucKeo();
      if (v && thaDuoc(v, cot)) tha(v, cot);
    },
  });

  const theKb = (v: KhbpViec) => {
    const keoDuoc = !laDT && rutDuoc(v);
    const lech = v.may_goi_y_id != null && v.may_id !== v.may_goi_y_id;
    return (
      <div key={v.id} className={`kb-the${keo?.id === v.id ? " dang-keo" : ""}`} role="button" tabIndex={0}
        draggable={keoDuoc} onDragStart={keoDuoc ? (e) => batDauKeo(e, v) : undefined} onDragEnd={ketThucKeo}
        onClick={() => moNgan(v)} title={goiY(v)}>
        <div className="kb-1"><span className="kb-ma">{maViec(v)}</span>{han(v, true)}</div>
        <div className="kb-sp">{v.lsx_ten ?? v.ten_cong_doan}</div>
        <div className="kb-3">{nhanMau(v)}{chipTT(v)}</div>
        {tienDo(v)}
        {v.trang_thai_kh === "tam_dung" && v.ly_do_tam_dung && <div className="kb-ly">{v.ly_do_tam_dung}</div>}
        {lech && <div className="kb-may">Báo giá chạy {tenMay(v.may_goi_y_id)}</div>}
      </div>
    );
  };

  const dongCho = (v: KhbpViec, dt: boolean) => (
    <div key={v.id} className={`kb-the cg-dong${keo?.id === v.id ? " dang-keo" : ""}`} role="button" tabIndex={0}
      aria-pressed={chonId === v.id} title={goiY(v)}
      draggable={!dt && giaoDuoc} onDragStart={!dt && giaoDuoc ? (e) => batDauKeo(e, v) : undefined}
      onDragEnd={ketThucKeo}
      onClick={() => {
        if (!giaoDuoc) { moNgan(v); return; }
        const chon = chonId === v.id ? null : v.id;
        setChonId(chon);
        setSheet(false);
        if (dt && chon && v.may_goi_y_id != null) {
          setTimeout(() => document.querySelector(`.mdt-may[data-cot="${v.may_goi_y_id}"]`)
            ?.scrollIntoView({ block: "start", behavior: "smooth" }));
        }
      }}>
      <div className="kb-1"><span className="kb-ma">{maViec(v)}</span>{han(v, true)}</div>
      <div className="kb-sp">{v.lsx_ten ?? v.ten_cong_doan}</div>
      <div className="kb-3">{nhanMau(v)}</div>
      <div className="kb-may">{v.may_goi_y_id != null ? `Báo giá: ${tenMay(v.may_goi_y_id)}` : "Chưa có máy báo giá"}</div>
    </div>
  );

  const nutGiaoVao = (cot: Cot, nho = false) => {
    if (!r0 || !thaDuoc(r0, cot)) return null;
    return (
      <button type="button" className={nho ? "kb-trong__giao" : "kb-giao"} disabled={busy}
        onClick={(e) => { e.stopPropagation(); tha(r0, cot); }}>
        Giao vào đây{r0.may_goi_y_id === cot && <span> theo báo giá</span>}
      </button>
    );
  };
  const conNua = (cot: Cot, viec: KhbpViec[], toiDa: number) => viec.length > toiDa && (
    <button type="button" className="kb-them" onClick={() => xemHet(cot)}>
      Còn {so(viec.length - toiDa)} việc, xem ở Bảng việc
    </button>
  );
  /** Dải máy chưa có việc: mỗi máy một chip, vẫn nhận việc (bấm Giao vào đây hoặc thả vào). */
  const daiTrong = (dt: boolean) => cotTrong.length > 0 && (
    <div className={`kb-trong${dt ? " kb-trong--dt" : ""}`}>
      <span className="kb-trong__nh">{cotTrong.length === 1 ? "Chưa có việc" : "Máy chưa có việc"}</span>
      {cotTrong.map(({ cot, may }) => (
        <span key={String(cot)} {...(dt ? {} : oTha(cot))}
          className={`kb-trong__may${nhanCot(cot) ? " nhan" : ""}${tren === String(cot) ? " tren" : ""}`}
          title={[tenCot(cot), may?.tinh_trang?.nhan, nhomMay(may)].filter(Boolean).join("\n")}>
          <span className="khbp-cham" style={{ background: `var(--tt-${mauMay(may)}-dot)` }} />
          <span className="kb-trong__ten">{tenCot(cot)}</span>
          {nutGiaoVao(cot, true)}
        </span>
      ))}
    </div>
  );

  const dauCot = (cot: Cot, may: KhbpMay | undefined, viec: KhbpViec[]) => {
    const mau = mauMay(may);
    const canh = !!may?.tinh_trang && !["ranh", "dang_chay"].includes(may.tinh_trang.ma);
    const tong = tongCho(viec);
    return (
      <div className="kb-dau">
        <div className="kb-dau__1">
          <span className="khbp-cham" style={{ background: `var(--tt-${mau}-dot)` }} />
          <span className="kb-dau__ten" title={tenCot(cot)}>{tenCot(cot)}</span>
          <span className="kb-so">{viec.length}</span>
        </div>
        <div className="kb-dau__2">
          {may?.tinh_trang && <span style={canh ? { color: `var(--tt-${mau}-fg)` } : undefined}>{may.tinh_trang.nhan}</span>}
          {!may && <span>Không cần máy</span>}
          {nhomMay(may) && <span title={nhomMay(may)}>{nhomMay(may)}</span>}
        </div>
        {nutGiaoVao(cot) ?? (
          <div className="kb-dau__3">
            <span>Chờ chạy <em>{viec.filter((v) => v.trang_thai_kh === "da_giao").length}</em></span>
            <span>Đang chạy <em>{viec.filter((v) => v.trang_thai_kh === "dang_chay").length}</em></span>
            {tong && <span><em>{tong}</em> chờ</span>}
          </div>
        )}
      </div>
    );
  };

  const veKanbanPc = () => (
    <>
      {daiTrong(false)}
      <div ref={kbRef} className={`khbp-kbwrap${dangDua ? " dang-dua" : ""}`}>
        <aside className={`kb-cho${tren === "cho" ? " kb-cot--tren" : ""}`} {...oTha("cho")}>
          <div className="kb-cho__dau">
            <span>Chờ giao</span><span className="kb-so kb-so--vang">{choGiao.length}</span>
            <span className="kb-cho__sx">Hạn gần trước</span>
          </div>
          <div className="kb-cho__ds">
            {keo && thaDuoc(keo, "cho") && <div className="kb-goi">Thả để rút {maViec(keo)} về Chờ giao</div>}
            {choGiao.map((v) => dongCho(v, false))}
            {choGiao.length === 0 && <div className="kb-het">Không còn việc chờ giao</div>}
          </div>
        </aside>
        <div className="kb-cuon" ref={cuonRef}>
          <div className="khbp-kb" onScroll={capNhatVien}>
            {cotCoViec.map(({ cot, may, viec }) => (
              <section key={String(cot)} {...oTha(cot)}
                className={`kb-cot${nhanCot(cot) ? " kb-cot--nhan" : ""}${tren === String(cot) ? " kb-cot--tren" : ""}`}>
                {dauCot(cot, may, viec)}
                <div className="kb-ds">
                  {keo && thaDuoc(keo, cot) && <div className="kb-goi">Thả để giao vào {tenCot(cot)}</div>}
                  {viec.slice(0, HIEN_TOI_DA).map(theKb)}
                  {conNua(cot, viec, HIEN_TOI_DA)}
                  {viec.length === 0 && <div className="kb-het">Chưa có việc</div>}
                </div>
              </section>
            ))}
            {cotCoViec.length === 0 && <div className="kb-het kb-het--rong">Chưa máy nào có việc</div>}
          </div>
        </div>
      </div>
    </>
  );

  const dongViecDt = (v: KhbpViec) => (
    <div key={v.id} className="mdt-viec" role="button" tabIndex={0} onClick={() => moNgan(v)}>
      <div className="mdt-v1"><span className="mdt-sp">{v.lsx_ten ?? v.ten_cong_doan}</span>{han(v, true)}</div>
      <div className="mdt-v2">
        <span>{maViec(v)}</span>{chipTT(v)}
        {v.so_mau != null && <span>{v.so_mau} màu</span>}
        {soLuong(v) && <span>{soLuong(v)}</span>}
      </div>
      {tienDo(v)}
      {v.trang_thai_kh === "tam_dung" && v.ly_do_tam_dung && <div className="mdt-ly">{v.ly_do_tam_dung}</div>}
      {rutDuoc(v) && (
        <div style={{ marginTop: 8 }}>
          <button type="button" className="kb-nut kb-nut--phu" disabled={busy}
            onClick={(e) => { e.stopPropagation(); void rut(v.id, v.version); }}>Rút lại</button>
        </div>
      )}
    </div>
  );

  const veKanbanDt = () => (
    <div className="mdt">
      {cotCoViec.map(({ cot, may, viec }) => {
        const k = String(cot);
        const gap = mayGap.has(k);
        const mau = mauMay(may);
        const gia = !!r0 && r0.may_goi_y_id === cot;
        const demTT: Partial<Record<KhbpTrangThai, number>> = {};
        for (const v of viec) demTT[v.trang_thai_kh] = (demTT[v.trang_thai_kh] ?? 0) + 1;
        const chips = (["dang_chay", "tam_dung", "da_giao"] as KhbpTrangThai[]).filter((t) => demTT[t]);
        return (
          <section key={k} data-cot={k} className={`mdt-may${gia ? " mdt-may--gia" : ""}${gap ? " mdt-may--gap" : ""}`}>
            <button type="button" className="mdt-dau" aria-expanded={!gap}
              onClick={() => setMayGap((cu) => { const n = new Set(cu); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>
              <span className="mdt-cham" style={{ background: `var(--tt-${mau}-dot)` }} />
              <span className="mdt-ten">
                <span>{tenCot(cot)}</span>
                <span className="mdt-phu">
                  {may?.tinh_trang && <span style={{ color: `var(--tt-${mau}-fg)` }}>{may.tinh_trang.nhan}</span>}
                  <span>{nhomMay(may)}</span>
                </span>
              </span>
              <span className="mdt-mui"><Icon name="chevron" size={16} /></span>
            </button>
            {r0 && thaDuoc(r0, cot) && (
              <div className="mdt-giao">
                <button type="button" className={`kb-nut${gia ? "" : " kb-nut--phu"}`} disabled={busy}
                  onClick={() => tha(r0, cot)}>Giao vào đây</button>
              </div>
            )}
            {gia && <div className="mdt-nhac">Máy theo báo giá</div>}
            <div className="mdt-dems">
              {chips.map((t) => (
                <span key={t} className="mdt-dem"
                  style={{ background: `var(--tt-${TT[t].mau}-bg)`, color: `var(--tt-${TT[t].mau}-fg)` }}>
                  {demTT[t]} {TT[t].chu.toLowerCase()}
                </span>
              ))}
            </div>
            {!gap && viec.length > 0 && (
              <div className="mdt-ds">
                {viec.slice(0, HIEN_TOI_DA).map(dongViecDt)}
                {conNua(cot, viec, HIEN_TOI_DA)}
              </div>
            )}
          </section>
        );
      })}
      {daiTrong(true)}
    </div>
  );

  // ---------------- Khay Giao ----------------

  const veHop = () => {
    if (!hop) return null;
    const { v } = hop;
    const coMay = hop.may !== undefined;
    const ns = coMay ? nhomCho(v, hop.may ?? null) : [];
    const ly = canLyDo(v, hop.may);
    const du = coMay && hop.nhom != null && (!ly || hop.lyDo.trim().length > 0);
    // Máy theo báo giá đứng đầu, rồi máy chạy được công đoạn, cuối là Làm tay.
    const dsMay: (number | null)[] = [
      ...(v.may_goi_y_id != null ? [v.may_goi_y_id] : []),
      ...v.may_chon.filter((m) => m !== v.may_goi_y_id),
      ...(v.nhom_chon.length ? [null] : []),
    ];
    const choTren = (m: number | null) => (m != null ? mayCua.get(m)?.so_cho : xem === "bang" ? tv?.so_cho_lam_tay : undefined)
      ?? ds.filter((x) => x.trang_thai_kh === "da_giao" && x.may_id === m).length;
    const phu = (m: number | null) => {
      const may = m != null ? mayCua.get(m) : undefined;
      const n = choTren(m);
      return (
        <>
          {may?.tinh_trang && <ChipTT mau={mauMay(may)}>{may.tinh_trang.nhan}</ChipTT>}
          {n > 0 && <span className="khbp-mo">{n} việc chờ</span>}
        </>
      );
    };
    const tagGia = (m: number | null) => (m != null && m === v.may_goi_y_id ? <span className="khbp-tag">theo báo giá</span> : null);
    const chonMay = (m: number | null) => {
      const ns2 = nhomCho(v, m);
      setHop({ ...hop, may: m, doi: false,
        nhom: hop.nhom != null && ns2.includes(hop.nhom) ? hop.nhom : ns2.length === 1 ? ns2[0] : null });
    };
    // Còn thiếu gì thì nói ngay cạnh nút Giao, khỏi đoán vì sao nút mờ.
    const thieu = !coMay ? "Chọn máy chạy" : ly && !hop.lyDo.trim() ? "Nhập lý do đổi máy"
      : hop.nhom == null ? "Chọn nhóm làm" : null;
    return (
      <>
        <div className="khbp-man" onClick={() => setHop(null)} />
        <div className="hg hg--giao" role="dialog" aria-modal="true" aria-label={`Giao ${maViec(v)}`}>
          <div className="hg__keo" aria-hidden="true" />
          <div className="hg__dau">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3>Giao {maViec(v)}</h3>
              <div className="hg__sp">{v.lsx_ten}{v.khach_hang ? <span className="khbp-mo"> {v.khach_hang}</span> : null}</div>
              <div className="hg__tags">
                <span className="khbp-tag">{v.ten_cong_doan}</span>
                {soLuong(v) && <span className="khbp-tag">{soLuong(v)}</span>}
                {v.han_giao && <span className={`khbp-tag${lopHan(v) === "tre" ? " khbp-tre" : ""}`}>Hạn {ngayNgan(v.han_giao)}{lopHan(v) === "tre" ? " trễ" : ""}</span>}
              </div>
            </div>
            <button type="button" className="hg__x" onClick={() => setHop(null)} aria-label="Đóng">×</button>
          </div>
          <div className="hg__than">
            <div className="hg__muc">
              <div className="hg__nh" id="hg-may">Máy chạy</div>
              <div className="hg__ds" role="radiogroup" aria-labelledby="hg-may">
                {dsMay.map((m) => (
                  <button key={String(m)} type="button" className="hg__may" role="radio"
                    aria-checked={hop.may === m} onClick={() => chonMay(m)}>
                    <span className="hg__o" aria-hidden="true" />
                    <span className="hg__ten">{tenMay(m)}</span>
                    <span className="hg__phu">{tagGia(m)}{phu(m)}</span>
                  </button>
                ))}
              </div>
              {ly && (
                <div className="hg__ly">
                  <label className="hg__nh" htmlFor="hg-lydo">Lý do không chạy {tenMay(v.may_goi_y_id)}</label>
                  <input id="hg-lydo" className="hg__lydo" value={hop.lyDo} maxLength={500} autoFocus
                    placeholder="Bắt buộc khi chạy máy khác báo giá"
                    onChange={(e) => setHop({ ...hop, lyDo: e.target.value })} />
                </div>
              )}
            </div>
            {coMay && (
              <div className="hg__muc">
                <div className="hg__nh" id="hg-nhom">Nhóm làm</div>
                {ns.length === 1 ? (
                  <div className="hg__mot">{tenNhom.get(ns[0]) ?? "—"}</div>
                ) : (
                  <div className="hg__seg" role="radiogroup" aria-labelledby="hg-nhom">
                    {ns.map((n) => (
                      <button key={n} type="button" role="radio" aria-checked={hop.nhom === n}
                        onClick={() => setHop({ ...hop, nhom: n })}>{tenNhom.get(n) ?? `Nhóm #${n}`}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {hopLoi && <div className="hg__loi" role="alert">{hopLoi}</div>}
          </div>
          <div className="hg__chan">
            {thieu && <span className="hg__thieu">{thieu}</span>}
            <button type="button" className="khbp-nut" onClick={() => setHop(null)}>Hủy</button>
            <button type="button" className="khbp-nut khbp-nut--chinh" disabled={!du || busy}
              onClick={async () => {
                if (!du || hop.nhom == null) return;
                if (await guiGiao(v, hop.may ?? null, hop.nhom, ly ? hop.lyDo : "")) setHop(null);
              }}>Giao</button>
          </div>
        </div>
      </>
    );
  };

  // ---------------- Ngăn ----------------

  // Bảng việc không nạp lại bảng cả bộ phận: dòng của trang đang xem mới là số mới nhất.
  const vMo = moId == null ? null : xem === "bang"
    ? (dsLoc.find((v) => v.id === moId) ?? ds.find((v) => v.id === moId) ?? null)
    : (ds.find((v) => v.id === moId) ?? dsLoc.find((v) => v.id === moId) ?? null);
  const nutDau = vMo && (giaoCho(vMo) ? (
    <Button variant="accent" disabled={busy} onClick={() => moHop(vMo)}>Giao</Button>
  ) : rutDuoc(vMo) ? (
    <Button variant="secondary" disabled={busy} onClick={() => void rut(vMo.id, vMo.version)}>Rút lại</Button>
  ) : null);
  const dongNgan = () => setMoId(null);

  // ---------------- khung màn ----------------

  const tieuDe = `Kế hoạch ${bang?.bo_phan.ten ?? tenBoPhan ?? ""}`.trim();
  return (
    <div className="khbp">
      <div className="khbp-dau">
        <h1>{tieuDe}</h1>
        <span className="khbp-dau__phu">{xem === "kb" ? "Mỗi máy một cột" : "Việc mới tới đứng đầu"}</span>
        <div className="khbp-xem" role="tablist" aria-label="Cách xem">
          <button type="button" role="tab" aria-selected={xem === "bang"} title="Bảng việc"
            onClick={() => { setXem("bang"); setChonId(null); }}>
            <Icon name="listChecks" size={15} /><span>Bảng việc</span>
          </button>
          <button type="button" role="tab" aria-selected={xem === "kb"} title="Kanban"
            onClick={() => { setXem("kb"); setSheet(false); }}>
            <Icon name="columns" size={15} /><span>Kanban</span>
          </button>
        </div>
      </div>

      {xem === "bang" ? (
        <section className="khbp-loc">
          <div className="lds-loc__thanh tl-thanh khbp-thanh" role="search">
            <OTim value={q} onChange={setQ} placeholder="Tìm mã lệnh / khách / sản phẩm / máy…" ariaLabel="Tìm việc" />
            <ThanhLoc ky={ky} moc={MOC_BANG} onKy={setKy} dieuKien={dkBang} loc={locBang} onLoc={setLocBang}
              onXoaHet={xoaLoc} />
            {!laDT && (
              <ChonCot cot={COT_BANG} an={luoi.chonCot.an} onAn={luoi.chonCot.onAn} thuTu={luoi.chonCot.thuTu}
                onThuTu={luoi.chonCot.onThuTu} rong={luoi.chonCot.rong} onRong={luoi.chonCot.onRong}
                ghim={luoi.chonCot.ghim} onGhim={luoi.chonCot.onGhim} />
            )}
          </div>
          {/* Cùng hàng chip của Việc của tổ (`ThsxDemTrangThai`): chữ nhỏ, chip chọn viền mảnh, số đậm màu chữ. */}
          <div className="thsx-dem khbp-dem" role="group" aria-label="Lọc theo trạng thái">
            <button type="button" className="thsx-dem__chip" aria-pressed={chip === "tat_ca"} onClick={() => setChip("tat_ca")}>
              Tất cả <span className="thsx-num">{tv?.dem.tat_ca ?? "—"}</span>
            </button>
            {THU_TU_TT.map((k) => (
              <button key={k} type="button" className="thsx-dem__chip" aria-pressed={chip === k} onClick={() => setChip(k)}>
                <i className="thsx-dem__cham" style={{ background: `var(--tt-${TT[k].mau}-dot)` }} aria-hidden="true" />
                {TT[k].chu} <span className="thsx-num">{tv?.dem[k] ?? "—"}</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className="lds-loc__thanh tl-thanh khbp-kbloc" role="search">
          <OTim value={q} onChange={setQ} placeholder="Tìm lệnh, khách, sản phẩm" ariaLabel="Tìm việc" />
          <ThanhLoc dieuKien={dkKb} loc={locKb} onLoc={setLocKb} />
          {!laDT && (
            <button type="button" className="khbp-gat" role="switch" aria-checked={trongCot}
              onClick={() => setTrongCot((x) => !x)}>
              <i aria-hidden="true" />Máy trống thành cột
            </button>
          )}
        </div>
      )}

      {loi && !bang && <div className="banner banner--error" role="alert" style={{ marginTop: 12 }}>{loi}</div>}
      {xem === "kb" && !bang && !loi && <div className="khbp-trong">Đang tải…</div>}
      {xem === "bang" ? (laDT ? veThe() : veBang()) : bang && (laDT ? veKanbanDt() : veKanbanPc())}

      {bang && xem === "kb" && laDT && (r0 ? (
        <div className="cgbar">
          <div><div>Chọn máy cho {maViec(r0)}</div><div className="cgbar__phu">{r0.lsx_ten}</div></div>
          <button type="button" className="cgbar__nut" onClick={() => setChonId(null)}>Hủy</button>
        </div>
      ) : (
        <button type="button" className="cgbar" onClick={() => setSheet(true)}>
          <span><span className="kb-so">{choGiao.length}</span>việc chờ giao</span>
          <span className="cgbar__nut">Xem</span>
        </button>
      ))}
      {sheet && (
        <>
          <div className="khbp-man" onClick={() => setSheet(false)} />
          <div className="hg cgsheet" role="dialog" aria-label="Việc chờ giao">
            <div className="hg__keo" aria-hidden="true" />
            <div className="hg__dau">
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3>Việc chờ giao</h3>
                <div className="khbp-mo">{giaoDuoc ? "Chọn một việc, rồi chọn máy trong danh sách máy" : "Bạn chỉ được xem, không được giao việc"}</div>
              </div>
              <button type="button" className="hg__x" onClick={() => setSheet(false)} aria-label="Đóng">×</button>
            </div>
            <div className="hg__than">
              {choGiao.map((v) => dongCho(v, true))}
              {choGiao.length === 0 && <div className="kb-het">Không còn việc chờ giao</div>}
            </div>
          </div>
        </>
      )}

      {/* Ngăn chi tiết: ngăn của Việc của tổ, chỉ xem, nút đầu ngăn là Giao / Rút lại. */}
      <aside className={`thsx-panel${moId != null ? " thsx-panel--open" : ""}`} aria-label="Chi tiết việc đang chọn">
        {moId != null && (
          <ErrorBoundary key={moId} fallback={(thuLai) => (
            <div className="thsx-panel__empty">
              Không vẽ được chi tiết việc.{" "}
              <button type="button" className="khbp-nutnho" onClick={thuLai}>Thử lại</button>{" "}
              <button type="button" className="khbp-nutnho" onClick={dongNgan}>Đóng</button>
            </div>
          )}>
            <ThsxDrawer
              chiTiet={chiTiet} loading={!chiTiet && !ctLoi} loi={ctLoi}
              candidates={[]} hoTroUngVien={[]} mayOptions={[]} exec={KHONG_GHI} busy={busy}
              onGiao={khongLam} onRut={khongLam} onBatDau={khongLam} onNhanKhuon={khongLam}
              onTraKhuon={khongLam} onTamDung={khongLam} onKetThuc={khongLam} onClose={dongNgan}
              tenTo={bang?.bo_phan.ten ?? tenBoPhan}
              boPhan={{ nutDau, napLichSu: api.keHoachBoPhan.lichSu, napTep: api.keHoachBoPhan.tep }}
            />
          </ErrorBoundary>
        )}
      </aside>
      {moId != null && <div className="thsx-scrim" onClick={dongNgan} aria-hidden="true" />}

      {veHop()}
      {tb && (
        <div className="khbp-toast" role="status">
          <span>{tb.chu}</span>
          {tb.hoanTac && (
            <button type="button" disabled={busy}
              onClick={() => { const h = tb.hoanTac!; setTb(null); void rut(h.id, h.version, "Đã hoàn tác, việc về Chưa giao"); }}>
              Hoàn tác
            </button>
          )}
        </div>
      )}
    </div>
  );
}
