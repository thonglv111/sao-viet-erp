// Khách hàng — CRM-360 (spec-06). Danh bạ theo lưới phương án A (07/10/2026: lọc nhanh tình trạng
// mua + thanh lọc chung + lưới một dòng, dòng Cộng) → slide-over Object-page (header + gauge uy tín,
// toolbar hành động, tabs Dashboard / Lịch sử mua hàng / Lịch sử báo giá). MỌI số liệu
// (KPI, doanh số 12T, cơ cấu SP, tần suất đặt, lịch sử) tính từ ĐƠN HÀNG / BÁO GIÁ THẬT;
// thiếu dữ liệu → empty state trung thực (không bịa số). Công nợ chỉ-đọc qua SEAM-16.
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { OGoDinhDang } from "../components/OGoDinhDang";
import {
  ApiError,
  api,
  type CustomerAddress,
  type CustomerAddressInput,
  type CustomerAttachment,
  type CustomerAuditRow,
  type CustomerContact,
  type CustomerContactInput,
  type CustomerInput,
  type CustomerFinancialInput,
  type CustomerKind,
  type CustomerNote,
  type CustomerRow,
  type DuplicateWarn,
  type NhapExcelOut,
  type KhoNhanRow,
  type SaleOption,
} from "../api/client";
import type { NavigateFn } from "../components/AppShell";
import { useAuth } from "../auth/useAuth";
import { useCan, useScopeOf } from "../auth/permissions";
import { BangLichHen, CareCalendar, useLichHen } from "./CareCalendar";
import { TabBaoGia, TabMuaHang, TabTongQuan, ThanhKy, useSoLieuKhach, type TabSoLieu } from "./khachHangThongKe";
import { Button } from "../components/Button";
import { ChonNgay } from "../components/ChonNgay";
import { docSoVN } from "../components/ONhapSo";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyRow, EmptyState } from "../components/EmptyState";
import {
  CuonLuoi,
  ChipTT,
  ChonCot,
  LocNhanhTrangThai,
  OTim,
  TieuDeSapXep,
  ngayVN,
  rongLuoi,
  soVN,
  tenKhachGon,
  useCauHinhLuoi,
  type CotLuoi,
  type MauTT,
} from "../components/LuoiDs";
import { Select } from "../components/Select";
import { PhanTrangDayDu } from "../components/PhanTrangDayDu";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Gauge,
  HeartHandshake,
  History,
  Mail,
  MapPin,
  Package,
  Paperclip,
  PencilLine,
  Phone,
  ReceiptText,
  Search,
  Tags,
  UploadCloud,
  UserPlus,
  Users,
  X,
  CalendarDays,
  CheckCircle2,
  Clock,
  Plus,
  Calendar,
  AlertTriangle,
  Trash2,
  Check,
  ShieldCheck,
  Image,
  CreditCard,
  StickyNote,
  Pin,
  Loader2,          // spinner nút "Tra cứu MST" (.kh__spin quay nó)
  ArrowLeftRight,
  ArrowRight,
  ShieldAlert,
  Copy,
  FilePlus2,
  CalendarPlus,
} from "lucide-react";

import "./khach-hang.css";
import { ThanhLoc } from "./thanh-loc/ThanhLoc";
import { kyLenUrl, kyTuUrl, thamSoKy, type KyDS } from "./thanh-loc/ky-danh-sach";
import { useLocMan } from "./thanh-loc/useLocMan";
import {
  LOC_KH_TRONG,
  dieuKienKhachHang,
  locKHLenUrl,
  locKHTuUrl,
  thamSoLocKH,
  type LocKhachHang,
} from "./dieu-kien-khach-hang";


const MST_RE = /^(\d{10}|\d{13})$/;
// Thanh lọc chung (06/10/2026): kỳ theo Ngày tạo + điều kiện (NV phụ trách, Nhãn, Trạng thái mua
// hàng, Loại khách) — lọc ở máy chủ, ghi lên URL `?man=khach-hang`.
const MOC_KH: [string, string][] = [["tao", "Ngày tạo"]];
type LocManKH = { ky: KyDS; loc: LocKhachHang };
const LOC_MAN_KH_TRONG: LocManKH = { ky: { loai: "tat_ca", moc: "tao" }, loc: LOC_KH_TRONG };
const docLocManKH = (p: URLSearchParams): LocManKH => ({
  ky: kyTuUrl(p, MOC_KH.map(([m]) => m), "tao"),
  loc: locKHTuUrl(p),
});
const ghiLocManKH = (t: LocManKH) => ({ ...kyLenUrl(t.ky, "tao"), ...locKHLenUrl(t.loc) });

/** "06/10/2026" theo giờ VN — cột Ngày tạo (title của ô mang đủ giờ). Chuỗi không múi coi là UTC. */
function ngayTaoKH(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) || !iso.includes("T") ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });
}
function gioTaoKH(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) || !iso.includes("T") ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}

/* money() đầy-đủ-đồng đã bỏ: mọi chỗ hiển thị tiền dùng moneyStat/moneyCompact theo prototype.
   (Hàm cũ chỉ còn được nhắc trong khối PaymentGauge đã comment.) */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function moneyCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) {
    return (n / 1_000_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) + " tỷ đ";
  }
  if (n >= 1_000_000) {
    return (n / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) + " Mđ";
  }
  if (n >= 1_000) {
    return (n / 1_000).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) + " Kđ";
  }
  return n.toLocaleString("vi-VN") + " ₫";
}

/** Số to + đơn vị ("22,17 Mđ") cho stat card / cột tiền — đồng màu 100%, không lệch font hay nhạt chữ. */
function moneyStat(n: number | null | undefined): ReactNode {
  if (n == null || n <= 0) return "—";
  return moneyCompact(n);
}

function getInitials(name: string): string {
  const clean = name.replace(/^(Cty|Công ty|Cafe|Cà phê|TNHH|CP)\s+/i, "").trim();
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    const p1 = parts[parts.length - 2][0];
    const p2 = parts[parts.length - 1][0];
    return (p1 + p2).toUpperCase();
  }
  return clean.substring(0, 2).toUpperCase();
}

export const TAG_TONES = [
  "indigo",
  "emerald",
  "violet",
  "cyan",
  "amber",
  "rose",
  "fuchsia",
  "teal",
] as const;

export const TAG_SEMANTIC_TONES: Record<string, string> = {
  "ưu tiên": "violet",
  "tiềm năng": "emerald",
  "tiềm năng cao": "emerald",
  "đối tác lâu năm": "indigo",
  "tái ký hđ": "teal",
  "trả đúng hạn": "emerald",
  "nhạy giá": "amber",
  "hay trễ hẹn": "rose",
  "khó tính": "rose",
  "ưa giao nhanh": "cyan",
  "cần chăm sóc": "amber",
  "chuộng mẫu đẹp": "fuchsia",
  "bao bì cao cấp": "indigo",
};

export function tagTone(label: string): string {
  const lower = label.trim().toLowerCase();
  if (TAG_SEMANTIC_TONES[lower]) return TAG_SEMANTIC_TONES[lower];
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_TONES[h % TAG_TONES.length];
}

const KH_CHU_CO_MAU = [
  "a", "b", "c", "d", "e", "g", "h", "k", "l", "m", "n", "p", "q", "s", "t", "u", "v", "x",
] as const;

/** Chữ cái quyết định MÀU của một khách — lấy từ chính CHỮ TẮT đang hiện trong vòng tròn.
 *
 *  Suy lại từ `getInitials` chứ không tự bóc tiền tố lần nữa: bản cũ tự bóc, mà chỉ bóc ĐƯỢC MỘT
 *  lần, nên "Công ty TNHH An Phát" còn lại "TNHH An Phát" → lấy chữ "T", trong khi vòng tròn ghi
 *  "AP". Màu chạy theo chữ "Công ty" chứ không theo tên khách ⇒ mọi "Công ty TNHH …" cùng một
 *  màu, mọi "Công ty CP …" cùng một màu khác. Lấy chữ đầu của chữ tắt thì màu và chữ KHÔNG THỂ
 *  lệch nhau, vì cả hai đọc từ một nguồn.
 */
function khChuMau(name: string): string {
  const ch = getInitials(name).slice(0, 1).toLowerCase();
  return (KH_CHU_CO_MAU as readonly string[]).includes(ch) ? ch : "default";
}

export function getKhAvatarClass(name: string): string {
  return `kh__avatar--${khChuMau(name)}`;
}

/** Chấm nhỏ ở góc avatar — CÙNG chữ cái với avatar, chỉ đậm tông hơn.
 *
 *  Trước 16/08/2026 chấm này tô theo "hạng khách" tự phán trong frontend (≥100 triệu = VIP,
 *  ≥3 đơn = Đối tác…). Ngưỡng không ai duyệt, không có trong DB, và chấm 7px không chú giải thì
 *  người dùng cũng không có cách nào biết cam nghĩa là gì. Nay chấm chỉ là phần của khối định
 *  danh — không giả vờ phân loại nữa. */
export function getKhDotClass(name: string): string {
  return `kh__avatar-dot--${khChuMau(name)}`;
}

// Form Thêm/Sửa — THÔNG TIN ĐỊNH DANH (redesign spec-06 v2). Tài chính sửa riêng ở detail.
interface FormState {
  name: string;
  customer_kind: CustomerKind;
  tax_code: string;
  email: string;
  address: string;
  sale_user_id: string;
}
const EMPTY_FORM: FormState = {
  name: "",
  customer_kind: "cong_ty",
  tax_code: "",
  email: "",
  address: "",
  sale_user_id: "",
};

/*
const STATUS_LABELS: Record<string, string> = {
  lead: "Tiềm năng",
  active: "Đang giao dịch",
  inactive: "Ngừng",
};
*/

const DUP_FIELD_LABELS: Record<DuplicateWarn["field"], string> = {
  tax_code: "MST",
  name: "tên công ty",
  email: "email",
};

/** Dòng phụ dưới tên người trong mọi hộp chọn NV: "NV Sales · Kinh doanh". Thiếu vế nào thì bỏ
 *  vế đó (tài khoản chưa gán vai trò / chưa gắn phòng) — không hiện dấu chấm giữa lơ lửng. */
function moTaSale(s: SaleOption): string | undefined {
  const phan = [s.vai_tro, s.phong_ban].filter((x): x is string => !!x && x.trim() !== "");
  return phan.length ? phan.join(" · ") : undefined;
}

// =============================================================================
// List-Report page
// =============================================================================

export function KhachHangPage({ navigate, onBadgeStale, eventTick = 0, openCustomerId = null }: {
  navigate: NavigateFn;
  onBadgeStale?: () => void;
  /** Nhịp sự kiện nhóm "bán hàng" (giao hẹn, tới giờ hẹn…) — nút "Lịch hẹn" nạp lại theo. */
  eventTick?: number;
  /** Liên thông (vd "Hồ sơ khách hàng" ở Công nợ phải thu): vào màn là mở sẵn hồ sơ khách này. */
  openCustomerId?: number | null;
}) {
  const { token } = useAuth();

  const [rows, setRows] = useState<CustomerRow[]>([]);
  // Lọc nhanh tình trạng mua + dòng Cộng — máy chủ đếm/cộng trên cả tập lọc.
  const [demMua, setDemMua] = useState<Record<string, number>>({});
  const [tongMua, setTongMua] = useState(0);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("code");
  const [q, setQ] = useState("");
  // Gõ tới đâu lọc tới đó (trễ 250ms cho khỏi gọi máy chủ theo từng phím).
  const [qTre, setQTre] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setQTre(q.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const luoi = useCauHinhLuoi("khach-hang");
  // Kỳ + điều kiện lọc (NV phụ trách, Nhãn, Trạng thái mua hàng, Loại khách) — ghi lên URL, nhớ
  // theo màn. Tab "Cần theo dõi" gỡ 05/10/2026 — trùng việc với nút "Lịch hẹn".
  const [locMan, setLocManGoc] = useLocMan("khach-hang", LOC_MAN_KH_TRONG, docLocManKH, ghiLocManKH);
  const setLocMan = (t: LocManKH) => {
    setLocManGoc(t);
    setPage(1);
  };
  const khoaLoc = JSON.stringify({ ...thamSoKy(locMan.ky), ...thamSoLocKH(locMan.loc) });
  const [tagLabels, setTagLabels] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(25);
  const [sales, setSales] = useState<SaleOption[]>([]);
  // id NV → "Vai trò · Phòng", để cột NV phụ trách của bảng hiện chức danh dưới tên.
  const saleMeta = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of sales) {
      const t = moTaSale(s);
      if (t) m.set(s.id, t);
    }
    return m;
  }, [sales]);

  // Điều chuyển khách hàng: gated bằng quyền chi tiết `reassign` (Cách B) — cấu hình trong
  // ma trận phân quyền, tách khỏi quyền Sửa thông thường.
  const can = useCan();
  const scopeOf = useScopeOf();
  // Option "Chưa gán" chỉ có nghĩa với người phạm vi `all`: own/department lọc theo chủ sổ nên
  // khách vô chủ tự rơi ra ngoài tầm nhìn — thêm option cho họ chỉ ra danh sách rỗng, gây bối rối.
  const canSeeUnassigned = scopeOf("khach_hang") === "all";
  const canReassign = can("khach_hang", "reassign");
  const canExport = true; // Xuất file MẶC ĐỊNH BẬT (gỡ công tắc `export` khách 24/08/2026).
  const canCreate = can("khach_hang", "create");
  // Nhập Excel: dòng Mã KH trống là thêm (`create`), dòng có Mã là sửa (`update`) — server gác cửa
  // bằng MỘT trong hai rồi kiểm từng dòng, nên nút hiện khi có một trong hai.
  const canImport = canCreate || can("khach_hang", "update");
  const dieuKien = useMemo(
    () => dieuKienKhachHang(sales, tagLabels, canSeeUnassigned),
    [sales, tagLabels, canSeeUnassigned],
  );

  // Import / export danh bạ (#23).
  const [importOpen, setImportOpen] = useState(false);
  const [exportingBook, setExportingBook] = useState(false);

  // Nút "Lịch hẹn" (lịch hẹn chăm sóc kiểu Google Calendar): số đỏ = hẹn của tôi trễ + hôm nay.
  const [lichHenMo, setLichHenMo] = useState(false);
  const lh = useLichHen(eventTick, lichHenMo);
  // Bấm một hẹn trong bảng Lịch hẹn ⇒ mở hồ sơ khách ở tab Chăm sóc.
  const [moChamSoc, setMoChamSoc] = useState(0);

  async function exportBook() {
    if (!token || exportingBook) return;
    setExportingBook(true);
    try {
      const url = await api.customers.exportCsvBlobUrl(token);
      const a = document.createElement("a");
      a.href = url;
      a.download = "danh-ba-khach-hang.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      setListError("Xuất danh bạ không thành công.");
    } finally {
      setExportingBook(false);
    }
  }
  const [reassignOpen, setReassignOpen] = useState(false);
  const [fromSale, setFromSale] = useState<number | null>(null);
  const [toSale, setToSale] = useState<number | null>(null);
  const [reassignBusy, setReassignBusy] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [reassignMsg, setReassignMsg] = useState<string | null>(null);

  // Chọn nhiều dòng (checkbox) → thanh thao tác "Chuyển hàng loạt".
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTarget, setBulkTarget] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [mode, setMode] = useState<null | "create" | "edit">(null);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [openId, setOpenId] = useState<number | null>(openCustomerId);
  useEffect(() => {
    if (openCustomerId != null) setOpenId(openCustomerId);
  }, [openCustomerId]);
  const [quickTagModalCust, setQuickTagModalCust] = useState<{ id: number; name: string } | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setListError(null);
    setSelectedIds(new Set()); // selection is per current page/filter
    api.customers
      .list(token, {
        q: qTre || undefined,
        loc: JSON.parse(khoaLoc),
        sort,
        page,
        size: pageSize,
      })
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
        setDemMua(res.dem_mua ?? {});
        setTongMua(res.tong_mua_12m ?? 0);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.isForbidden) setForbidden(true);
        else setListError("Không tải được danh bạ khách hàng.");
      })
      .finally(() => setLoading(false));
  }, [token, qTre, khoaLoc, sort, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!token) return;
    api.customers.sales(token).then(setSales).catch(() => setSales([]));
    api.customers.tagLabels(token).then(setTagLabels).catch(() => setTagLabels([]));
  }, [token]);

  function openReassign() {
    setFromSale(null);
    setToSale(null);
    setReassignError(null);
    setReassignMsg(null);
    setReassignOpen(true);
  }

  function toggleRow(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));

  function toggleAllOnPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (rows.every((r) => next.has(r.id))) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  function openBulk() {
    setBulkTarget(null);
    setBulkError(null);
    setReassignMsg(null);
    setBulkOpen(true);
  }

  async function doBulkReassign() {
    if (!token || bulkBusy) return;
    const ids = [...selectedIds];
    if (ids.length === 0) {
      setBulkError("Chưa chọn khách hàng nào.");
      return;
    }
    if (bulkTarget == null) {
      setBulkError("Chọn nhân viên đích.");
      return;
    }
    setBulkBusy(true);
    setBulkError(null);
    try {
      const res = await api.customers.reassignSelected(token, ids, bulkTarget);
      setBulkOpen(false);
      const toName = sales.find((s) => s.id === bulkTarget)?.name ?? "";
      setReassignMsg(
        `Đã chuyển ${res.moved} khách hàng sang ${toName}` +
          (res.skipped ? ` (bỏ qua ${res.skipped} khách ngoài phạm vi).` : "."),
      );
      load(); // also clears selection
      lh.nap(); // hẹn đang mở đi theo khách sang người mới
    } catch (err) {
      if (err instanceof ApiError) setBulkError(err.message);
      else setBulkError("Điều chuyển thất bại. Vui lòng thử lại.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function doReassign() {
    if (!token || reassignBusy) return;
    if (fromSale == null || toSale == null) {
      setReassignError("Chọn nhân viên nguồn và nhân viên đích.");
      return;
    }
    if (fromSale === toSale) {
      setReassignError("Nhân viên nguồn và đích phải khác nhau.");
      return;
    }
    setReassignBusy(true);
    setReassignError(null);
    try {
      const res = await api.customers.reassign(token, fromSale, toSale);
      setReassignOpen(false);
      const fromName = sales.find((s) => s.id === fromSale)?.name ?? "";
      const toName = sales.find((s) => s.id === toSale)?.name ?? "";
      setReassignMsg(`Đã điều chuyển ${res.moved} khách hàng từ ${fromName} sang ${toName}.`);
      load();
      lh.nap(); // hẹn đang mở đi theo khách sang người mới
    } catch (err) {
      if (err instanceof ApiError) setReassignError(err.message);
      else setReassignError("Điều chuyển thất bại. Vui lòng thử lại.");
    } finally {
      setReassignBusy(false);
    }
  }

  const openIndex = useMemo(
    () => rows.findIndex((r) => r.id === openId),
    [rows, openId],
  );

  function pageSibling(delta: number) {
    if (openIndex < 0) return;
    const next = rows[openIndex + delta];
    if (next) setOpenId(next.id);
  }

  if (forbidden) {
    return (
      <main className="kh">
        <div className="banner banner--error" role="alert">
          Bạn không có quyền truy cập Khách hàng (403).
        </div>
      </main>
    );
  }

  const hien = (k: string) => !luoi.an.has(k) && (k !== "chon" || canReassign);
  const cotHien = luoi.rongHien(luoi.xep(COT_KH).filter((c) => hien(c.key)));
  const viTriMua = cotHien.findIndex((c) => c.key === "mua");
  const mucMua = [
    { key: "", label: "Tất cả", count: Object.values(demMua).reduce((a, b) => a + b, 0) },
    ...MUA_NHANH.map((m) => ({ ...m, count: demMua[m.key] ?? 0 })),
  ];
  const taoMoi = () => {
    setEditing(null);
    setMode("create");
  };
  // Một chân cho CẢ hai kiểu xem (lưới / thẻ): cùng một trang dữ liệu máy chủ trả.
  const phanTrang =
    !listError && total > 0 ? (
      <PhanTrangDayDu
        trang={page}
        size={pageSize}
        tong={total}
        soDong={rows.length}
        onTrang={setPage}
        onSize={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        loading={loading}
        donVi="khách hàng"
        ariaLabel="Phân trang khách hàng"
      />
    ) : null;

  return (
    <main className="kh lds">
      <header className="lds-dau">
        <h1 className="lds-dau__ten">Khách hàng</h1>
        <div className="lds-dau__nut">
          {canExport && (
            <button type="button" className="lds-btn" onClick={exportBook} disabled={exportingBook}>
              <Download size={14} /> {exportingBook ? "Đang xuất…" : "Xuất Excel"}
            </button>
          )}
          {canImport && (
            <button type="button" className="lds-btn" onClick={() => setImportOpen(true)}>
              <UploadCloud size={14} /> Nhập Excel
            </button>
          )}
          {canReassign && (
            <button type="button" className="lds-btn" onClick={openReassign} disabled={sales.length < 2}>
              <ArrowLeftRight size={14} /> Điều chuyển
            </button>
          )}
          {canCreate && (
            <Button variant="accent" onClick={taoMoi}>
              <Plus size={15} /> Tạo khách hàng
            </Button>
          )}
        </div>
      </header>

      {reassignMsg && (
        <div className="banner banner--success" role="status">
          {reassignMsg}
        </div>
      )}

      {lichHenMo && (
        <BangLichHen
          lh={lh}
          onMoKhach={(id) => {
            setOpenId(id);
            setMoChamSoc((n) => n + 1);
          }}
        />
      )}

      <section className="lds-loc">
        <LocNhanhTrangThai
          muc={mucMua}
          dang={locMan.loc.mua ?? ""}
          onChon={(k) => setLocMan({ ...locMan, loc: { ...locMan.loc, mua: (k || undefined) as LocKhachHang["mua"] } })}
          ariaLabel="Lọc nhanh theo tình trạng mua hàng"
        />
        {/* Đang tick chọn: hàng công cụ nhường chỗ cho thao tác trên các dòng đã chọn — cùng chiều
            cao nên danh sách không bị đẩy. */}
        {canReassign && selectedIds.size > 0 ? (
          <div className="lds-loc__thanh lds-loc__chon">
            <span>Đã chọn {selectedIds.size} khách hàng</span>
            <Button variant="accent" onClick={openBulk}>
              Chuyển hàng loạt
            </Button>
            <button type="button" className="lds-btn" onClick={() => setSelectedIds(new Set())}>
              Bỏ chọn
            </button>
          </div>
        ) : (
          <div className="lds-loc__thanh tl-thanh" role="search">
            <OTim value={q} onChange={setQ} placeholder="Tìm tên, mã số thuế, điện thoại" ariaLabel="Tìm khách hàng" />
            <ThanhLoc
              ky={locMan.ky}
              moc={MOC_KH}
              onKy={(ky) => setLocMan({ ...locMan, ky })}
              dieuKien={dieuKien}
              loc={locMan.loc}
              onLoc={(loc) => setLocMan({ ...locMan, loc })}
            />
            <div className="lds-loc__phai">
              <button
                type="button"
                className={`lds-btn${lichHenMo ? " is-on" : ""}`}
                aria-expanded={lichHenMo}
                onClick={() => setLichHenMo((v) => !v)}
                title={lh.so > 0 ? `${lh.so} hẹn trễ hoặc hôm nay của tôi` : undefined}
              >
                <CalendarDays size={14} /> Lịch hẹn
                {lh.so > 0 && <span className="kh__lich-hen-so">{lh.so}</span>}
              </button>
              <ChonCot cot={COT_KH} {...luoi.chonCot} />
            </div>
          </div>
        )}
      </section>

      {listError && (
        <div className="banner banner--error" role="alert">
          <span>{listError}</span>
          <button type="button" className="lds-btn lds-btn--xs" onClick={() => load()}>
            Thử lại
          </button>
        </div>
      )}

        <div className="lds-sheet">
          <CuonLuoi ghim={luoi.soGhim(cotHien)}>
            <table className="lds-g" style={{ minWidth: rongLuoi(cotHien) }}>
              <colgroup>
                {cotHien.map((c) => (
                  <col key={c.key} style={c.w ? { width: c.w } : undefined} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {cotHien.map((c) => (
                    <th key={c.key} className={c.n ? "n" : c.key === "chon" ? "c" : undefined}>
                      {c.key === "chon" ? (
                        <input
                          type="checkbox"
                          className="lds-cb"
                          aria-label="Chọn tất cả trên trang"
                          title="Tick để chọn khách hàng — chọn xong sẽ hiện nút chuyển hàng loạt"
                          checked={allOnPageSelected}
                          onChange={toggleAllOnPage}
                        />
                      ) : c.key === "the" ? null : c.sx ? (
                        <TieuDeSapXep label={c.label} cot={c.sx} sort={sort} onSort={setSort} />
                      ) : (
                        c.label
                      )}
                      {luoi.keo(c.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 && <EmptyRow colSpan={cotHien.length} trangThai="dang-tai" />}
                {!loading && !listError && rows.length === 0 && (
                  <tr>
                    <td colSpan={cotHien.length} className="lds-trong">
                      {q || khoaLoc !== "{}" ? (
                        <>
                          Không có khách hàng nào khớp điều kiện đang lọc.{" "}
                          <button
                            type="button"
                            className="lds-lk"
                            onClick={() => {
                              setQ("");
                              setLocMan(LOC_MAN_KH_TRONG);
                            }}
                          >
                            Xoá bộ lọc
                          </button>
                        </>
                      ) : (
                        <>
                          Chưa có khách hàng nào trong sổ.{" "}
                          {canCreate && (
                            <button type="button" className="lds-lk" onClick={taoMoi}>
                              Tạo khách hàng đầu tiên
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                )}
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    className={`lds-dong${openId === c.id ? " is-chon" : ""}${selectedIds.has(c.id) ? " is-tick" : ""}`}
                    onClick={() => setOpenId(c.id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        setOpenId(c.id);
                      }
                    }}
                  >
                    {cotHien.map((cot) => (
                      <OKhach
                        key={cot.key}
                        cot={cot.key}
                        c={c}
                        chucDanh={saleMeta.get(c.sale_user_id ?? -1)}
                        chon={selectedIds.has(c.id)}
                        onChon={() => toggleRow(c.id)}
                        onGanThe={() => setQuickTagModalCust({ id: c.id, name: c.name })}
                      />
                    ))}
                  </tr>
                ))}
                {/* Dòng Cộng: Σ mua 12 tháng của MỌI khách khớp bộ lọc (máy chủ cộng). */}
                {rows.length > 0 && viTriMua > 0 ? (
                  <tr className="lds-cong lds-nhom">
                    <td className="lead" colSpan={viTriMua}>
                      <span className="lds-dinh-trai">Cộng {total.toLocaleString("vi-VN")} khách hàng</span>
                    </td>
                    {cotHien.slice(viTriMua).map((cot) =>
                      cot.key === "mua" ? (
                        <td key={cot.key} className="n">{soVN(tongMua)}</td>
                      ) : (
                        <td key={cot.key} />
                      ),
                    )}
                  </tr>
                ) : null}
              </tbody>
            </table>
          </CuonLuoi>
          {phanTrang}
        </div>

      {mode === "create" && (
        <CustomerFormDialog
          title="Tạo khách hàng"
          initial={{ ...EMPTY_FORM }}
          sales={sales}
          isEdit={false}
          onClose={() => setMode(null)}
          onSaved={() => {
            setMode(null);
            setPage(1);
            load();
          }}
        />
      )}

      {mode === "edit" && editing && (
        <CustomerFormDialog
          title={`Sửa khách hàng · ${editing.code}`}
          customerId={editing.id}
          isEdit
          sales={sales}
          initial={{
            name: editing.name,
            customer_kind: editing.customer_kind,
            tax_code: editing.tax_code ?? "",
            email: editing.email ?? "",
            address: editing.address ?? "",
            sale_user_id: editing.sale_user_id != null ? String(editing.sale_user_id) : "",
          }}
          onClose={() => setMode(null)}
          onSaved={() => {
            setMode(null);
            load();
            lh.nap(); // đổi NV phụ trách ⇒ hẹn đang mở đi theo
          }}
        />
      )}

      {importOpen && (
        <ImportDialog
          coTheTao={canCreate}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            setPage(1);
            load();
          }}
        />
      )}

      {quickTagModalCust && (
        <TagModal
          customerId={quickTagModalCust.id}
          customerName={quickTagModalCust.name}
          current={(rows.find((r) => r.id === quickTagModalCust.id)?.tags ?? []).map((label, idx) => ({ id: idx + 1, label }))}
          onClose={() => setQuickTagModalCust(null)}
          onSaved={() => {
            setQuickTagModalCust(null);
            load();
          }}
        />
      )}

      {openId != null && mode == null && (
        <CustomerObjectPage
          customerId={openId}
          moChamSoc={moChamSoc}
          eventTick={eventTick}
          onCareChanged={() => { lh.nap(); onBadgeStale?.(); }}
          onTagsDoi={(id, labels) =>
            setRows((prev) => prev.map((r) => (r.id === id ? { ...r, tags: labels } : r)))}
          canPrev={openIndex > 0}
          canNext={openIndex >= 0 && openIndex < rows.length - 1}
          onPrev={() => pageSibling(-1)}
          onNext={() => pageSibling(1)}
          onClose={() => setOpenId(null)}
          navigate={navigate}
          onEdit={(row) => {
            setEditing(row);
            setMode("edit");
          }}
        />
      )}

      <CustomerReassignModal
        open={reassignOpen}
        sales={sales}
        fromSale={fromSale}
        toSale={toSale}
        setFromSale={setFromSale}
        setToSale={setToSale}
        busy={reassignBusy}
        error={reassignError}
        onConfirm={doReassign}
        onCancel={() => !reassignBusy && setReassignOpen(false)}
      />

      <BulkReassignModal
        open={bulkOpen}
        selectedCount={selectedIds.size}
        sales={sales}
        bulkTarget={bulkTarget}
        setBulkTarget={setBulkTarget}
        busy={bulkBusy}
        error={bulkError}
        onConfirm={doBulkReassign}
        onCancel={() => !bulkBusy && setBulkOpen(false)}
      />
    </main>
  );
}

// --- KPI header strip --------------------------------------------------------

// --- Lưới danh sách (phương án A, 07/10/2026 — cùng khuôn với các màn Kinh doanh) ------------------
// Thứ tự theo nhóm nghĩa: định danh (Mã, Khách hàng kèm nhãn, MST) → mua bán (Mua 12 tháng, Số đơn,
// Đặt gần nhất, Tình trạng) → liên lạc (Liên hệ, Điện thoại) → NV phụ trách → Ngày tạo → nút gắn thẻ.
// Nhãn KHÔNG tách cột: nó là đặc điểm của khách nên đi liền sau tên.
const COT_KH: (CotLuoi & { w?: number; n?: boolean; sx?: string })[] = [
  { key: "chon", label: "Chọn", coDinh: true, w: 40 },
  { key: "ma", label: "Mã KH", coDinh: true, w: 84, sx: "code" },
  { key: "ten", label: "Khách hàng", coDinh: true, w: 360, sx: "name" },
  { key: "mst", label: "Mã số thuế", w: 120 },
  { key: "mua", label: "Mua 12 tháng", w: 124, n: true, sx: "revenue" },
  { key: "don", label: "Số đơn", w: 76, n: true },
  { key: "gan", label: "Đặt gần nhất", w: 120, sx: "last_order" },
  { key: "tt", label: "Tình trạng", w: 128 },
  { key: "lh", label: "Liên hệ chính", w: 160 },
  { key: "dt", label: "Điện thoại", w: 124 },
  { key: "nv", label: "NV phụ trách", w: 170 },
  { key: "ngay", label: "Ngày tạo", w: 110, sx: "created" },
  { key: "the", label: "Gắn thẻ", coDinh: true, w: 46 },
];

/** Lọc nhanh theo tình trạng mua — cùng luật với ô "Trạng thái mua hàng" của nút Lọc (một state). */
const MUA_NHANH: { key: string; label: string; mau: MauTT }[] = [
  { key: "dang_mua", label: "Đang mua", mau: "la" },
  { key: "ngung", label: "Ngừng đặt", mau: "cam" },
  { key: "chua_don", label: "Chưa có đơn", mau: "xam" },
];

function tinhTrangMua(c: CustomerRow): (typeof MUA_NHANH)[number] {
  if (c.orders_total === 0) return MUA_NHANH[2];
  return c.orders_12m > 0 ? MUA_NHANH[0] : MUA_NHANH[1];
}

/** "Đặt 3 ngày trước" — quá 60 ngày đếm theo tháng cho dễ hình dung. */
function datCachDay(iso: string | null): string {
  if (!iso) return "—";
  const ngay = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (ngay <= 0) return "Hôm nay";
  return ngay < 60 ? `${ngay} ngày trước` : `${Math.floor(ngay / 30)} tháng trước`;
}

function OKhach({
  cot,
  c,
  chucDanh,
  chon,
  onChon,
  onGanThe,
}: {
  cot: string;
  c: CustomerRow;
  chucDanh?: string;
  chon: boolean;
  onChon: () => void;
  onGanThe: () => void;
}) {
  const chan = (e: { stopPropagation: () => void }) => e.stopPropagation();
  switch (cot) {
    case "chon":
      return (
        <td className="c" onClick={chan}>
          <input type="checkbox" className="lds-cb" aria-label={`Chọn ${c.name}`} checked={chon} onChange={onChon} />
        </td>
      );
    case "ma":
      return <td>{c.code || `KH${String(c.id).padStart(3, "0")}`}</td>;
    case "ngay":
      return <td title={gioTaoKH(c.created_at)}>{ngayTaoKH(c.created_at)}</td>;
    case "ten": {
      const tags = c.tags ?? [];
      return (
        <td title={tags.length > 0 ? `${c.name}
Nhãn: ${tags.join(", ")}` : c.name}>
          <span className="kh-ten">
            <span className="kh-ten__chu">{tenKhachGon(c.name)}</span>
            {tags.slice(0, 2).map((t) => (
              <span key={t} className={`kh__row-badge kh__row-badge--tag-${tagTone(t)}`}>
                {t}
              </span>
            ))}
            {tags.length > 2 && <span className="lds-mu">+{tags.length - 2}</span>}
          </span>
        </td>
      );
    }
    case "mst":
      return <td>{c.tax_code || <span className="lds-mu3">—</span>}</td>;
    case "lh":
      return <td title={c.contact_name ?? undefined}>{c.contact_name || <span className="lds-mu3">—</span>}</td>;
    case "dt":
      return (
        <td>
          {c.phone ? (
            <a className="lds-lk" href={`tel:${c.phone.replace(/\s+/g, "")}`} title="Gọi" onClick={chan}>
              {sdtDeDoc(c.phone)}
            </a>
          ) : (
            <span className="lds-mu3">—</span>
          )}
        </td>
      );
    case "mua":
      return (
        <td className="n" title="Doanh số đơn đã chốt trong 12 tháng qua">
          {c.revenue_12m > 0 ? soVN(c.revenue_12m) : <span className="lds-mu3">—</span>}
        </td>
      );
    case "don":
      return (
        <td className="n" title="Số đơn đã chốt trong 12 tháng qua">
          {c.orders_12m > 0 ? c.orders_12m : <span className="lds-mu3">—</span>}
        </td>
      );
    case "tt": {
      const t = tinhTrangMua(c);
      return (
        <td>
          <ChipTT mau={t.mau}>{t.label}</ChipTT>
        </td>
      );
    }
    case "gan":
      return (
        <td title={c.last_order_at ? ngayVN(c.last_order_at) : undefined}>
          {c.last_order_at ? datCachDay(c.last_order_at) : <span className="lds-mu3">—</span>}
        </td>
      );
    case "nv":
      return (
        <td title={c.sale_name ? (chucDanh ? `${c.sale_name}\n${chucDanh}` : c.sale_name) : undefined}>
          {c.sale_name || <span className="lds-mu3">Chưa gán</span>}
        </td>
      );
    case "the":
      return (
        <td className="c lds-nut" onClick={chan}>
          <button type="button" className="lds-btn lds-btn--xs" title="Gắn thẻ" aria-label={`Gắn thẻ ${c.name}`} onClick={onGanThe}>
            <Tags size={12} />
          </button>
        </td>
      );
    default:
      return <td />;
  }
}

// =============================================================================
// Object-page slide-over
// =============================================================================

type Tab = "dashboard" | "orders" | "quotes" | "care" | "notes" | "contacts" | "addresses" | "files" | "audit";

function CustomerObjectPage({
  customerId,
  moChamSoc = 0,
  eventTick = 0,
  onCareChanged,
  onTagsDoi,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onClose,
  onEdit,
  navigate,
}: {
  customerId: number;
  /** Mỗi lần tăng ⇒ nhảy sang tab Chăm sóc (bấm một hẹn trong bảng Lịch hẹn của danh bạ). */
  moChamSoc?: number;
  /** Nhịp sự kiện nhóm "bán hàng" — tab Chăm sóc nạp lại theo (hẹn người khác giao, tới giờ hẹn). */
  eventTick?: number;
  onCareChanged?: () => void;
  /** Gắn thẻ trong hồ sơ xong thì dòng khách ngoài danh sách đổi theo ngay, khỏi tải lại. */
  onTagsDoi?: (customerId: number, labels: string[]) => void;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onEdit: (row: CustomerRow) => void;
  navigate: NavigateFn;
}) {
  const { token } = useAuth();
  const canCredit = useCan()("khach_hang", "set_credit_terms");
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  // Số trên nhãn hai tab lịch sử (mọi trạng thái, mọi thời gian) — đi kèm câu tải hồ sơ.
  const [dem, setDem] = useState<{ don: number; bg: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  // Kỳ xem + thống kê dùng chung ba tab Tổng quan / Mua hàng / Báo giá (tải MỘT lần mỗi kỳ).
  const sl = useSoLieuKhach(customerId, setTab as (t: TabSoLieu) => void);
  const panelRef = useRef<HTMLDivElement>(null);
  // Thẻ "Liên hệ chính" ở đầu hồ sơ đọc danh sách liên hệ THẬT (người is_primary, rồi người đầu).
  const [contacts, setContacts] = useState<CustomerContact[] | null>(null);
  // Nút ở đầu hồ sơ nhảy sang tab rồi mở sẵn form — mỗi lần bấm tăng một nhịp.
  const [moHenTick, setMoHenTick] = useState(0);
  const [moThemLhTick, setMoThemLhTick] = useState(0);
  useEffect(() => {
    if (moChamSoc) setTab("care");
  }, [moChamSoc, customerId]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setCustomer(null);
    setDem(null);
    setError(null);
    api.customers
      .get(token, customerId)
      .then((detail) => {
        if (cancelled) return;
        setCustomer(detail.customer);
        setDem({ don: detail.so_don, bg: detail.so_bao_gia });
      })
      .catch(() => !cancelled && setError("Không tải được hồ sơ khách hàng."));
    return () => {
      cancelled = true;
    };
  }, [token, customerId]);

  const napLienHe = useCallback(() => {
    if (!token) return;
    api.customers
      .contacts(token, customerId)
      .then((r) => setContacts(r.items))
      .catch(() => setContacts([]));
  }, [token, customerId]);
  useEffect(() => {
    setContacts(null);
    napLienHe();
  }, [napLienHe]);

  // Esc closes; focus panel on open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);


  return (
    <div className="kh__scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        className="kh__slideover"
        role="dialog"
        aria-modal="true"
        aria-label="Hồ sơ khách hàng"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="kh__so-topbar">
          <div className="kh__so-nav">
            <button type="button" className="kh__iconbtn" disabled={!canPrev} onClick={onPrev} aria-label="Khách trước">
              <ChevronUp size={14} strokeWidth={2} />
            </button>
            <button type="button" className="kh__iconbtn" disabled={!canNext} onClick={onNext} aria-label="Khách sau">
              <ChevronDown size={14} strokeWidth={2} />
            </button>
          </div>
          {/* Loại khách + trạng thái đứng chung hàng với nút điều hướng — đỡ một dòng chiều cao. */}
          {customer && dem && <KhachKick customer={customer} soDon={dem.don} />}
          <button type="button" className="kh__close" aria-label="Đóng" onClick={onClose}>
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {error ? (
          <div className="kh__so-body">
            <div className="banner banner--error" role="alert">
              {error}
            </div>
          </div>
        ) : !customer || !dem ? (
          <div className="kh__so-body">
            <div className="kh__so-headskel">
              <span className="kh__skel kh__skel--title" />
              <span className="kh__skel kh__skel--line" />
            </div>
            <div className="kh__kpis">
              {[...Array(4)].map((_, i) => (
                <div className="kh__kpi card" key={i}>
                  <span className="kh__skel kh__skel--kpi" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <ObjectHeader
              onTagsDoi={onTagsDoi}
              customer={customer}
              contacts={contacts}
              onEdit={() => onEdit(customer)}
              onTaoPhieu={() => {
                onClose();
                navigate("tinh-gia", { taoPhieuTinhGia: true });
              }}
              onHen={() => {
                setTab("care");
                setMoHenTick((n) => n + 1);
              }}
              onXemLienHe={() => {
                setMoThemLhTick(0);
                setTab("contacts");
              }}
              onThemLienHe={() => {
                setTab("contacts");
                setMoThemLhTick((n) => n + 1);
              }}
              onLienHeDoi={napLienHe}
            />
            <nav className="kh__so-tabs" aria-label="Nội dung">
              {(
                [
                  ["dashboard", "Tổng quan", <Gauge size={14} key="i" />, null],
                  ["orders", "Lịch sử mua hàng", <ReceiptText size={14} key="i" />, dem.don],
                  ["quotes", "Lịch sử báo giá", <FileText size={14} key="i" />, dem.bg],
                  ["care", "Chăm sóc", <HeartHandshake size={14} key="i" />, null],
                  ["notes", "Ghi chú", <StickyNote size={14} key="i" />, null],
                  ["contacts", "Liên hệ", <Users size={14} key="i" />, null],
                  ["addresses", "Giao hàng", <MapPin size={14} key="i" />, null],
                  ["files", "Tài liệu", <Paperclip size={14} key="i" />, null],
                  ["audit", "Nhật ký", <History size={14} key="i" />, null],
                ] as [Tab, string, JSX.Element, number | null][]
              ).map(([key, label, icon, count]) => (
                <button
                  key={key}
                  type="button"
                  className={`kh__so-tab${tab === key ? " is-active" : ""}`}
                  aria-current={tab === key ? "true" : undefined}
                  onClick={() => {
                    // Tab mount lại sẽ đọc nhịp cũ và mở form lần nữa — bấm tab thường thì xoá nhịp.
                    setMoHenTick(0);
                    setMoThemLhTick(0);
                    // Bấm thẳng nhãn tab = về kỳ chung, bỏ khoảng "đang xem riêng" mở từ biểu đồ.
                    sl.boKhoan();
                    setTab(key);
                  }}
                >
                  {icon} {label}
                  {count != null && count > 0 && (
                    <span className={`chip-count${key === "care" ? " chip-count--alert" : ""}`}>{count}</span>
                  )}
                </button>
              ))}
            </nav>
            {(tab === "dashboard" || tab === "orders" || tab === "quotes") && <ThanhKy sl={sl} />}

            <div className="kh__so-body">
              {tab === "dashboard" && (
                <TabTongQuan
                  sl={sl}
                  coDon={dem.don > 0}
                  chinhSach={
                    <FinancialPolicyCard customer={customer} canEdit={canCredit} onSaved={setCustomer} />
                  }
                />
              )}
              {tab === "orders" && <TabMuaHang sl={sl} code={customer.code} />}
              {tab === "quotes" && (
                <TabBaoGia
                  sl={sl}
                  onOpenQuote={(id) => {
                    onClose();
                    navigate("bao-gia", { openQuoteId: id });
                  }}
                />
              )}
              {tab === "care" && <CareTab customerId={customerId} onCareChanged={onCareChanged} moHenTick={moHenTick} eventTick={eventTick} />}
              {tab === "notes" && <NotesTab customerId={customerId} />}
              {tab === "contacts" && (
                <ContactsTab customerId={customerId} onChanged={napLienHe} moThemTick={moThemLhTick} />
              )}
              {tab === "addresses" && <AddressesTab customerId={customerId} />}
              {tab === "files" && <AttachmentsTab customerId={customerId} />}
              {tab === "audit" && (
                <AuditTab
                  customerId={customerId}
                  onDrill={(_refType, id) => {
                    onClose();
                    navigate("bao-gia", { openQuoteId: id });
                  }}
                />
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

/** Nhãn trạng thái cạnh chữ CÔNG TY — thay dải vàng "Khách mới…" từng nằm ở Dashboard. */
function trangThaiKhach(c: CustomerRow, soDon: number): { tone: "moi" | "deu"; text: string } | null {
  // `orders_total` / `last_order_at` chỉ đếm đơn ĐÃ CHỐT; `soDon` đếm mọi trạng thái.
  if (soDon === 0) return { tone: "moi", text: "Khách mới — chưa có đơn" };
  if (c.orders_total === 0 || !c.last_order_at) return { tone: "moi", text: "Chưa có đơn chốt" };
  const ngay = Math.floor((Date.now() - new Date(c.last_order_at).getTime()) / 86_400_000);
  return { tone: "deu", text: ngay <= 0 ? "Đặt đơn hôm nay" : `Đặt gần nhất ${ngay} ngày trước` };
}

function KhachKick({ customer, soDon }: { customer: CustomerRow; soDon: number }) {
  const tt = trangThaiKhach(customer, soDon);
  return (
    <div className="kh__hd-kick">
      <span className="kh__so-badge-tier">
        {customer.customer_kind === "ca_nhan" ? "CÁ NHÂN" : "CÔNG TY"}
      </span>
      {tt && (
        <span className={`kh__hd-tt kh__hd-tt--${tt.tone}`}>
          <i aria-hidden="true" />
          {tt.text}
        </span>
      )}
    </div>
  );
}

/** Chữ viết tắt cho ô tròn: 2 chữ đầu của HAI TỪ CUỐI (họ tên Việt — tên nằm cuối). */
function vietTat(ten: string): string {
  return ten.trim().split(/\s+/).slice(-2).map((p) => p[0] ?? "").join("").toUpperCase();
}

/** Số điện thoại hiển thị theo cụm 4-3-3 cho dễ đọc khi gọi; giữ nguyên nếu không đủ 10 số. */
function sdtDeDoc(s: string): string {
  const so = s.replace(/\D/g, "");
  return so.length === 10 ? `${so.slice(0, 4)} ${so.slice(4, 7)} ${so.slice(7)}` : s;
}

/** Chép vào clipboard. `navigator.clipboard` chỉ có trên https/localhost và có thể bị từ chối
 *  quyền — khi đó lùi về `execCommand("copy")` qua một ô tạm. Trả về chép được hay không. */
async function chepVanBan(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // rơi xuống cách cũ
  }
  const o = document.createElement("textarea");
  o.value = text;
  o.setAttribute("readonly", "");
  o.style.position = "fixed";
  o.style.opacity = "0";
  document.body.appendChild(o);
  o.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(o);
  return ok;
}

/** Nút chép: bấm xong đổi tạm sang "Đã chép" (hoặc "Không chép được") 1,5 giây — khỏi cần toast. */
function NutChep({ text, nhan, label }: { text: string; nhan?: string; label: string }) {
  const [kq, setKq] = useState<"ok" | "loi" | null>(null);
  useEffect(() => {
    if (!kq) return;
    const t = window.setTimeout(() => setKq(null), 1500);
    return () => window.clearTimeout(t);
  }, [kq]);
  const goiY = kq === "ok" ? "Đã chép" : kq === "loi" ? "Không chép được" : label;
  return (
    <button
      type="button"
      className={nhan ? "kh__hd-btn" : "kh__hd-chep"}
      aria-label={goiY}
      title={goiY}
      onClick={() => {
        void chepVanBan(text).then((ok) => setKq(ok ? "ok" : "loi"));
      }}
    >
      {kq === "ok" ? <Check size={14} /> : kq === "loi" ? <X size={14} /> : <Copy size={14} />}
      {nhan && (kq === "ok" ? "Đã chép" : kq === "loi" ? "Không chép được" : nhan)}
    </button>
  );
}

// Đầu hồ sơ — phương án C (duyệt 04/10/2026, docs/mockups/ho-so-khach-hang-dau-trang-C.html):
// trái là định danh + việc hay làm, phải là thẻ LIÊN HỆ CHÍNH để gọi/nhắn ngay. Không nối các
// thông tin bằng dấu chấm giữa — mỗi ô một nhãn nhỏ phía trên.
function ObjectHeader({
  customer,
  contacts,
  onEdit,
  onTaoPhieu,
  onHen,
  onXemLienHe,
  onThemLienHe,
  onLienHeDoi,
  onTagsDoi,
}: {
  customer: CustomerRow;
  /** null = đang nạp. */
  contacts: CustomerContact[] | null;
  onEdit: () => void;
  onTaoPhieu: () => void;
  onHen: () => void;
  onXemLienHe: () => void;
  onThemLienHe: () => void;
  onLienHeDoi: () => void;
  onTagsDoi?: (customerId: number, labels: string[]) => void;
}) {
  const { token } = useAuth();
  const can = useCan();
  const canUpdate = can("khach_hang", "update");
  const canTinhGia = can("tinh_gia_thanh", "create");

  // Bản gọn (04/10/2026, sau phản hồi "phần đen to đùng"): loại khách + trạng thái lên hàng nút
  // điều hướng; bỏ ô "Khách từ"; thẻ gắn và hai ô mã số thuế / phụ trách chung MỘT hàng.
  return (
    <header className="kh__so-head">
      <div className="kh__so-headmain">
        <h2 className="kh__hd-ten">{customer.name}</h2>

        <div className="kh__hd-hang">
          <div className="kh__so-badges">
            {/* Nhãn thủ công (#7) — sales gán/gỡ trong modal Gắn thẻ. */}
            <TagChips
              customerId={customer.id}
              customerName={customer.name}
              onDoi={(labels) => onTagsDoi?.(customer.id, labels)}
            />
          </div>
          <dl className="kh__hd-facts">
            <div>
              <dt>Mã số thuế</dt>
              <dd>
                {customer.tax_code ?? "—"}
                {customer.tax_code && <NutChep text={customer.tax_code} label="Chép mã số thuế" />}
              </dd>
            </div>
            <div>
              <dt>Phụ trách</dt>
              <dd>{customer.sale_name ?? "Chưa gán"}</dd>
            </div>
          </dl>
        </div>

        <div className="kh__hd-act">
          {canTinhGia && (
            <button type="button" className="kh__hd-btn kh__hd-btn--chinh" onClick={onTaoPhieu}>
              <FilePlus2 size={15} /> Lập phiếu tính giá
            </button>
          )}
          <button type="button" className="kh__hd-btn" onClick={onEdit}>
            <PencilLine size={15} /> Sửa thông tin
          </button>
          {canUpdate && (
            <button type="button" className="kh__hd-btn" onClick={onHen}>
              <CalendarPlus size={15} /> Hẹn chăm sóc
            </button>
          )}
        </div>
      </div>

      <TheLienHeChinh
        token={token}
        customer={customer}
        contacts={contacts}
        canUpdate={canUpdate}
        onXemLienHe={onXemLienHe}
        onThemLienHe={onThemLienHe}
        onLienHeDoi={onLienHeDoi}
      />
    </header>
  );
}

function TheLienHeChinh({
  token,
  customer,
  contacts,
  canUpdate,
  onXemLienHe,
  onThemLienHe,
  onLienHeDoi,
}: {
  token: string | null;
  customer: CustomerRow;
  contacts: CustomerContact[] | null;
  canUpdate: boolean;
  onXemLienHe: () => void;
  onThemLienHe: () => void;
  onLienHeDoi: () => void;
}) {
  const [doiMo, setDoiMo] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const doiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!doiMo) return;
    const onDown = (e: MouseEvent) => {
      if (doiRef.current && !doiRef.current.contains(e.target as Node)) setDoiMo(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [doiMo]);

  if (contacts == null) {
    return <div className="kh__hd-lh kh__hd-lh--nap" aria-busy="true" />;
  }

  // Người liên hệ chính: dòng is_primary (máy chủ đã xếp lên đầu), không có thì người đầu tiên.
  // Khách cũ chưa khai bảng liên hệ nhưng còn ô "liên hệ nhanh" trên hồ sơ thì dùng tạm ô đó.
  const chinh = contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;
  const ten = chinh?.name ?? customer.contact_name ?? null;
  const sdt = chinh ? chinh.phone : customer.phone;
  const email = chinh ? chinh.email : customer.email;
  const khac = chinh ? contacts.filter((c) => c.id !== chinh.id) : [];

  if (!ten) {
    return (
      <div className="kh__hd-lh kh__hd-lh--rong">
        <span className="kh__hd-lh-lb">Liên hệ chính</span>
        <p>Chưa có ai để gọi. Thêm người mua hàng trước, kế toán và thủ kho thêm sau.</p>
        {canUpdate && (
          <button type="button" className="kh__hd-btn" onClick={onThemLienHe}>
            <UserPlus size={15} /> Thêm người liên hệ
          </button>
        )}
      </div>
    );
  }

  async function chonChinh(c: CustomerContact) {
    if (!token) return;
    setDoiMo(false);
    setLoi(null);
    try {
      await api.customers.updateContact(token, customer.id, c.id, {
        name: c.name, title: c.title, duty: c.duty, phone: c.phone, email: c.email, is_primary: true,
      });
      onLienHeDoi();
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : "Đổi liên hệ chính không thành công.");
    }
  }

  // "Kế toán, thủ kho và 2 người khác" — nêu chức vụ của 2 người kế để biết bên trong có ai.
  const tomTatKhac = (() => {
    if (khac.length === 0) return null;
    const cv = khac.slice(0, 2).map((c) => c.title?.trim() || c.name);
    const conLai = khac.length - cv.length;
    const dau = cv.join(", ");
    return conLai > 0 ? `${dau} và ${conLai} người khác` : dau;
  })();

  return (
    <div className="kh__hd-lh" role="group" aria-label="Liên hệ chính">
      <div className="kh__hd-lh-dau">
        <div className="kh__hd-lh-nguoi">
          <div className="kh__hd-av" aria-hidden="true">{vietTat(ten)}</div>
          <div className="kh__hd-lh-ten-khoi">
            <div className="kh__hd-lh-ten" title={ten}>{ten}</div>
            <div className="kh__hd-lh-cv" title={chinh?.title ?? undefined}>
              {chinh?.title ?? "Liên hệ chính"}
            </div>
          </div>
        </div>
        {canUpdate && khac.length > 0 && (
          <div className="kh__hd-doi" ref={doiRef}>
            <button
              type="button"
              className="kh__hd-doi-btn"
              aria-expanded={doiMo}
              onClick={() => setDoiMo((v) => !v)}
            >
              Đổi
            </button>
            {doiMo && (
              <ul className="kh__hd-doi-ds" role="menu" aria-label="Chọn liên hệ chính">
                {khac.map((c) => (
                  <li key={c.id}>
                    <button type="button" role="menuitem" onClick={() => chonChinh(c)}>
                      <span className="kh__hd-doi-ten">{c.name}</span>
                      {c.title && <span className="kh__hd-doi-cv">{c.title}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Số điện thoại NẰM LUÔN trên nút gọi — khỏi một dòng số riêng lặp lại; email chỉ còn nút
          biểu tượng, địa chỉ hiện ở chú thích khi rê chuột. */}
      {(sdt || email) && (
        <div className="kh__hd-lh-nut">
          {sdt && (
            <a className="kh__hd-btn kh__hd-btn--goi" href={`tel:${sdt.replace(/\s/g, "")}`} title="Gọi">
              <Phone size={14} /> {sdtDeDoc(sdt)}
            </a>
          )}
          {sdt && <NutChep text={sdt.replace(/\s/g, "")} label="Chép số điện thoại" />}
          {email && (
            <a className="kh__hd-btn kh__hd-btn--icon" href={`mailto:${email}`} title={email} aria-label={`Gửi email ${email}`}>
              <Mail size={14} />
            </a>
          )}
        </div>
      )}

      {loi && <p className="kh__hd-lh-loi" role="alert">{loi}</p>}

      {tomTatKhac && (
        <button type="button" className="kh__hd-lh-khac" onClick={onXemLienHe}>
          {tomTatKhac} <ArrowRight size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/*
// Gauge uy tín thanh toán — arc dựa % sử dụng hạn mức (Công nợ). SEAM-16 chưa build → seam.
function PaymentGauge({
  usage,
  available,
  balance,
  limit,
}: {
  usage: number | null;
  available: boolean;
  balance: number | null;
  limit: number;
}) {
  const pct = usage != null ? Math.min(100, Math.max(0, usage)) : 0;
  const angle = (pct / 100) * 180;
  const tone = pct >= 100 ? "signal" : pct >= 80 ? "amber" : "moss";
  return (
    <div className="kh__gauge card" aria-label="Uy tín thanh toán">
      <span className="kh__kpi-label">Uy tín thanh toán</span>
      {available ? (
        <>
          <div className={`kh__gauge-arc kh__gauge-arc--${tone}`} style={{ ["--ang" as string]: `${angle}deg` }}>
            <span className="kh__gauge-num kh__mono">{usage}%</span>
          </div>
          <span className="kh__kpi-hint">
            Dư nợ {money(balance)} / HM {money(limit)}
          </span>
        </>
      ) : (
        <div className="kh__gauge-seam">
          <div className="kh__gauge-arc kh__gauge-arc--muted" style={{ ["--ang" as string]: "0deg" }}>
            <span className="kh__gauge-num kh__muted">—</span>
          </div>
          <span className="kh__seam-note">
            Chờ phân hệ Công nợ (SEAM-16) — HM {money(limit)}
          </span>
        </div>
      )}
    </div>
  );
}
*/

// --- Chính sách tài chính (inline view/edit, redesign spec-06 v2) -------------
// Điều khoản thanh toán đã BỎ theo yêu cầu — chỉ còn Hạn mức + rào Chiết khấu/Markup.

function rangeText(min?: number | null, max?: number | null): string {
  if (min == null && max == null) return "Chưa đặt";
  if (min != null && max != null) return `${min}% – ${max}%`;
  if (min != null) return `≥ ${min}%`;
  return `≤ ${max}%`;
}

/** Chữ đang gõ → chữ hiển thị kiểu Việt. Tiền/ngày: chỉ giữ chữ số, chấm nghìn ngay khi gõ
 *  ("10000000" → "10.000.000"). Phần trăm: chữ số + MỘT dấu phẩy thập phân ("12,5"). */
function chuanHoaChuSo(chu: string, thapPhan: boolean): string {
  if (!thapPhan) {
    const so = chu.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    return so ? Number(so).toLocaleString("vi-VN") : "";
  }
  const [nguyen, ...le] = chu.replace(/\./g, ",").replace(/[^\d,]/g, "").split(",");
  return le.length ? `${nguyen},${le.join("").slice(0, 2)}` : nguyen;
}

const chuTuSo = (n?: number | null, thapPhan = false): string =>
  n == null ? "" : thapPhan ? String(n).replace(".", ",") : n.toLocaleString("vi-VN");

/** Ô số của form chính sách: đơn vị nằm TRONG ô, không mũi tên tăng giảm. */
function OSoChinhSach({
  value,
  onChange,
  donVi,
  thapPhan = false,
  ariaLabel,
  placeholder,
  loi,
  rong,
}: {
  value: string;
  onChange: (v: string) => void;
  donVi: string;
  thapPhan?: boolean;
  ariaLabel: string;
  placeholder?: string;
  loi?: boolean;
  rong?: boolean;
}) {
  return (
    <span className={`kh__fin-so${rong ? " kh__fin-so--rong" : ""}${loi ? " is-loi" : ""}`}>
      <OGoDinhDang
        value={value}
        inputMode={thapPhan ? "decimal" : "numeric"}
        aria-label={ariaLabel}
        aria-invalid={loi || undefined}
        placeholder={placeholder}
        onChange={(e) => onChange(chuanHoaChuSo(e.target.value, thapPhan))}
      />
      <span className="kh__fin-so-dv" aria-hidden>{donVi}</span>
    </span>
  );
}

function FinancialPolicyCard({
  customer,
  canEdit,
  onSaved,
}: {
  customer: CustomerRow;
  canEdit: boolean;
  onSaved: (c: CustomerRow) => void;
}) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    credit_limit: "0",
    payment_term_days: "",
    discount_min_pct: "",
    discount_max_pct: "",
    markup_min_pct: "",
    markup_max_pct: "",
  });

  function openEdit() {
    setF({
      // Hạn mức 0 = chưa đặt ⇒ ô để TRỐNG cho người dùng gõ luôn, khỏi xoá số 0 trước.
      credit_limit: customer.credit_limit ? chuTuSo(customer.credit_limit) : "",
      payment_term_days: chuTuSo(customer.payment_term_days),
      discount_min_pct: chuTuSo(customer.discount_min_pct, true),
      discount_max_pct: chuTuSo(customer.discount_max_pct, true),
      markup_min_pct: chuTuSo(customer.markup_min_pct, true),
      markup_max_pct: chuTuSo(customer.markup_max_pct, true),
    });
    setErr(null);
    setEditing(true);
  }

  // Rào sai chiều (tối thiểu > tối đa) báo NGAY dưới dòng và khoá nút Lưu — khỏi đợi máy chủ trả 422.
  const ck = [docSoVN(f.discount_min_pct), docSoVN(f.discount_max_pct)];
  const mu = [docSoVN(f.markup_min_pct), docSoVN(f.markup_max_pct)];
  const nguoc = (r: (number | null)[]) => r[0] != null && r[1] != null && r[0] > r[1];
  const loiCk = nguoc(ck) ? "Chiết khấu tối thiểu đang lớn hơn tối đa." : ck.some((v) => v != null && v > 100) ? "Chiết khấu không quá 100%." : null;
  const loiMu = nguoc(mu) ? "Markup tối thiểu đang lớn hơn tối đa." : null;

  async function save() {
    if (!token || saving || loiCk || loiMu) return;
    setSaving(true);
    setErr(null);
    const days = docSoVN(f.payment_term_days);
    const input: CustomerFinancialInput = {
      credit_limit: docSoVN(f.credit_limit) ?? 0,
      payment_term_days: days == null ? null : Math.max(0, Math.floor(days)),
      discount_min_pct: ck[0],
      discount_max_pct: ck[1],
      markup_min_pct: mu[0],
      markup_max_pct: mu[1],
    };
    try {
      const res = await api.customers.updateFinancial(token, customer.id, input);
      onSaved(res.customer);
      setEditing(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setErr(e.message);
      else if (e instanceof ApiError && e.isForbidden) setErr("Bạn không có quyền sửa chính sách tài chính.");
      else setErr("Lưu không thành công. Thử lại.");
    } finally {
      setSaving(false);
    }
  }

  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  return (
    <section className="card kh__chart kh__finpolicy">
      <div className="kh__chart-head">
        <h3><CreditCard size={14} /> Chính sách tài chính</h3>
        {canEdit && !editing && (
          <button type="button" className="kh__fin-edit-btn" onClick={openEdit}>
            <PencilLine size={13} strokeWidth={2} /> Sửa
          </button>
        )}
      </div>

      {!editing ? (
        <div className="kh__finpolicy-view">
          <div className="kh__fin-row">
            <span className="kh__fin-label">Hạn mức công nợ</span>
            <strong className="kh__mono">{moneyStat(customer.credit_limit)}</strong>
          </div>
          <div className="kh__fin-row">
            <span className="kh__fin-label">Số ngày công nợ tối đa</span>
            <span>
              {customer.payment_term_days != null
                ? `${customer.payment_term_days} ngày kể từ ngày xuất HĐ`
                : "Chưa đặt"}
            </span>
          </div>
          <div className="kh__fin-row">
            <span className="kh__fin-label">Chiết khấu cho phép</span>
            <span>{rangeText(customer.discount_min_pct, customer.discount_max_pct)}</span>
          </div>
          <div className="kh__fin-row">
            <span className="kh__fin-label" title="Markup = lợi nhuận / giá vốn — đúng ô Markup% trên báo giá">Markup (trên giá vốn)</span>
            <span>{rangeText(customer.markup_min_pct, customer.markup_max_pct)}</span>
          </div>
          {!canEdit && (
            <p className="kh__lock-note">Cần quyền “Thiết lập chính sách tài chính” để sửa.</p>
          )}
        </div>
      ) : (
        <form
          className="kh__fin-form"
          onSubmit={(e) => { e.preventDefault(); void save(); }}
          onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
        >
          <fieldset className="kh__fin-nhom">
            <legend>Công nợ</legend>
            <div className="kh__fin-dong">
              <span className="kh__fin-nhan">Hạn mức công nợ</span>
              <OSoChinhSach value={f.credit_limit} onChange={(v) => set("credit_limit", v)}
                donVi="đ" rong ariaLabel="Hạn mức công nợ" placeholder="Chưa đặt" />
            </div>
            <div className="kh__fin-dong">
              <span className="kh__fin-nhan">Hạn thanh toán</span>
              <span className="kh__fin-cum">
                <OSoChinhSach value={f.payment_term_days} onChange={(v) => set("payment_term_days", v)}
                  donVi="ngày" ariaLabel="Số ngày công nợ tối đa" placeholder="—" />
                <span className="kh__fin-phu">kể từ ngày xuất hoá đơn</span>
              </span>
            </div>
          </fieldset>

          <fieldset className="kh__fin-nhom">
            <legend>Rào giá khi báo giá</legend>
            <div className="kh__fin-dong">
              <span className="kh__fin-nhan">Chiết khấu cho phép</span>
              <span className="kh__fin-cum">
                <OSoChinhSach value={f.discount_min_pct} onChange={(v) => set("discount_min_pct", v)}
                  donVi="%" thapPhan loi={!!loiCk} ariaLabel="Chiết khấu tối thiểu" placeholder="Từ" />
                <span className="kh__fin-phu">đến</span>
                <OSoChinhSach value={f.discount_max_pct} onChange={(v) => set("discount_max_pct", v)}
                  donVi="%" thapPhan loi={!!loiCk} ariaLabel="Chiết khấu tối đa" placeholder="Đến" />
              </span>
              {loiCk && <p className="kh__fin-loi" role="alert">{loiCk}</p>}
            </div>
            <div className="kh__fin-dong">
              <span className="kh__fin-nhan" title="Markup = lợi nhuận / giá vốn — đúng ô Markup% trên báo giá">
                Markup trên giá vốn
              </span>
              <span className="kh__fin-cum">
                <OSoChinhSach value={f.markup_min_pct} onChange={(v) => set("markup_min_pct", v)}
                  donVi="%" thapPhan loi={!!loiMu} ariaLabel="Markup tối thiểu" placeholder="Từ" />
                <span className="kh__fin-phu">đến</span>
                <OSoChinhSach value={f.markup_max_pct} onChange={(v) => set("markup_max_pct", v)}
                  donVi="%" thapPhan loi={!!loiMu} ariaLabel="Markup tối đa" placeholder="Đến" />
              </span>
              {loiMu && <p className="kh__fin-loi" role="alert">{loiMu}</p>}
            </div>
            <p className="kh__fin-goi-y">Để trống một đầu là không giới hạn đầu đó.</p>
          </fieldset>

          {err && <p className="kh__err" role="alert">{err}</p>}
          <div className="kh__fin-actions">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Huỷ</Button>
            <Button type="submit" variant="primary" loading={saving} disabled={!!(loiCk || loiMu)}>Lưu</Button>
          </div>
        </form>
      )}
    </section>
  );
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function fmtTimeOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderAuditDetailTags(detail: string | null) {
  if (!detail) return null;

  const trimmed = detail.trim();
  if (trimmed === "converted_to_order") {
    return (
      <div className="kh__tl-tags">
        <span className="kh__tl-badge kh__tl-badge--success">
          <CheckCircle2 size={11} /> Đã chuyển thành đơn hàng
        </span>
      </div>
    );
  }

  const parts = trimmed.split(/\s*·\s*|,\s*/).map((p) => p.trim()).filter(Boolean);

  return (
    <div className="kh__tl-tags">
      {parts.map((p, idx) => {
        let cls = "kh__tl-tag--default";
        let label = p;

        if (p === "converted_to_order") {
          label = "Đã chuyển thành đơn hàng";
          cls = "kh__tl-tag--success";
        } else if (p === "Đơn mới") {
          cls = "kh__tl-tag--brand";
        } else if (p === "Đã chốt") {
          cls = "kh__tl-tag--primary";
        } else if (p === "Nháp") {
          cls = "kh__tl-tag--muted";
        }

        return (
          <span key={idx} className={`kh__tl-tag ${cls}`}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

function groupAuditRowsByDate(rows: CustomerAuditRow[]) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

  const groupsMap = new Map<string, { dateKey: string; dateLabel: string; items: CustomerAuditRow[] }>();

  for (const r of rows) {
    const d = new Date(r.at);
    let dateKey = r.at ? r.at.substring(0, 10) : "unknown";
    let dateLabel = "";

    if (Number.isNaN(d.getTime())) {
      dateKey = "khac";
      dateLabel = "Khác";
    } else {
      const formattedDate = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
      if (dateKey === todayStr) {
        dateLabel = `Hôm nay · ${formattedDate}`;
      } else if (dateKey === yesterdayStr) {
        dateLabel = `Hôm qua · ${formattedDate}`;
      } else {
        dateLabel = formattedDate;
      }
    }

    if (!groupsMap.has(dateKey)) {
      groupsMap.set(dateKey, { dateKey, dateLabel, items: [] });
    }
    groupsMap.get(dateKey)!.items.push(r);
  }

  return Array.from(groupsMap.values());
}

const AUDIT_KIND_META: Record<CustomerAuditRow["kind"], { icon: JSX.Element; label: string; nodeCls: string }> = {
  profile: { icon: <PencilLine size={14} />, label: "Hồ sơ", nodeCls: "kh__tl-node--profile" },
  order: { icon: <Package size={14} />, label: "Đơn hàng", nodeCls: "kh__tl-node--order" },
  quote: { icon: <FileText size={14} />, label: "Báo giá", nodeCls: "kh__tl-node--quote" },
  care: { icon: <HeartHandshake size={14} />, label: "Chăm sóc", nodeCls: "kh__tl-node--care" },
};

function AuditTab({
  customerId,
  onDrill,
}: {
  customerId: number;
  onDrill: (refType: "order" | "quotation", id: number) => void;
}) {
  const { token } = useAuth();
  const [rows, setRows] = useState<CustomerAuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | CustomerAuditRow["kind"]>("all");
  const [timeRange, setTimeRange] = useState<"all" | "7d" | "30d" | "this_month" | "custom">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  
  // Trạng thái thu gọn nhóm ngày (mặc định rỗng = TẤT CẢ MẶC ĐỊNH MỞ RỘNG)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setRows(null);
    setError(null);
    api.customers
      .audit(token, customerId)
      .then((r) => !cancelled && setRows(r.items))
      .catch(() => !cancelled && setError("Không tải được nhật ký khách hàng."));
    return () => {
      cancelled = true;
    };
  }, [token, customerId]);

  const kindCounts = useMemo(() => {
    if (!rows) return { all: 0, profile: 0, order: 0, quote: 0, care: 0 };
    const counts = { all: rows.length, profile: 0, order: 0, quote: 0, care: 0 };
    for (const r of rows) {
      if (counts[r.kind] !== undefined) {
        counts[r.kind]++;
      }
    }
    return counts;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const normSearch = search
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");

    return rows.filter((r) => {
      if (kindFilter !== "all" && r.kind !== kindFilter) return false;

      // Lọc Khoảng thời gian
      if (timeRange !== "all" && r.at) {
        const d = new Date(r.at);
        if (!Number.isNaN(d.getTime())) {
          const now = Date.now();
          if (timeRange === "7d") {
            const cutoff = now - 7 * 86400 * 1000;
            if (d.getTime() < cutoff) return false;
          } else if (timeRange === "30d") {
            const cutoff = now - 30 * 86400 * 1000;
            if (d.getTime() < cutoff) return false;
          } else if (timeRange === "this_month") {
            const first = new Date();
            first.setDate(1);
            first.setHours(0, 0, 0, 0);
            if (d.getTime() < first.getTime()) return false;
          } else if (timeRange === "custom") {
            if (startDate) {
              const s = new Date(startDate);
              s.setHours(0, 0, 0, 0);
              if (d.getTime() < s.getTime()) return false;
            }
            if (endDate) {
              const e = new Date(endDate);
              e.setHours(23, 59, 59, 999);
              if (d.getTime() > e.getTime()) return false;
            }
          }
        }
      }

      if (normSearch) {
        const textToSearch = `${r.title || ""} ${r.detail || ""} ${r.action || ""} ${r.actor_name || ""} ${AUDIT_KIND_META[r.kind]?.label || ""}`
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/đ/g, "d")
          .replace(/Đ/g, "D");
        if (!textToSearch.includes(normSearch)) return false;
      }

      return true;
    });
  }, [rows, kindFilter, timeRange, startDate, endDate, search]);

  const totalItems = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, currentPage, pageSize]);

  const groupedPaginatedRows = useMemo(() => {
    return groupAuditRowsByDate(paginatedRows);
  }, [paginatedRows]);

  const areAllCollapsed = useMemo(() => {
    if (groupedPaginatedRows.length === 0) return false;
    return groupedPaginatedRows.every((g) => !!collapsedGroups[g.dateKey]);
  }, [groupedPaginatedRows, collapsedGroups]);

  function toggleGroup(dateKey: string) {
    setCollapsedGroups((prev) => ({
      ...prev,
      [dateKey]: !prev[dateKey],
    }));
  }

  function toggleAllGroups() {
    if (areAllCollapsed) {
      setCollapsedGroups({});
    } else {
      const next: Record<string, boolean> = {};
      for (const g of groupedPaginatedRows) {
        next[g.dateKey] = true;
      }
      setCollapsedGroups(next);
    }
  }

  if (error) return <div className="banner banner--error" role="alert">{error}</div>;
  if (rows == null) return <TableSkeleton cols={3} />;
  if (rows.length === 0)
    return (
      <div className="kh__empty-panel">
        <p className="kh__empty-title">Chưa có hoạt động</p>
        <p className="kh__muted">
          Nhật ký tổng hợp mọi thay đổi hồ sơ và mốc giao dịch (đơn hàng, báo giá) của khách —
          từ dữ liệu thật, không bịa. Chưa phát sinh sự kiện nào.
        </p>
      </div>
    );

  const filterOptions: Array<{ key: "all" | CustomerAuditRow["kind"]; label: string; icon?: JSX.Element }> = [
    { key: "all", label: "Tất cả" },
    { key: "order", label: "Đơn hàng", icon: <Package size={13} /> },
    { key: "quote", label: "Báo giá", icon: <FileText size={13} /> },
    { key: "profile", label: "Hồ sơ", icon: <PencilLine size={13} /> },
    { key: "care", label: "Chăm sóc", icon: <HeartHandshake size={13} /> },
  ];

  const startItemIndex = totalItems > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const endItemIndex = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="kh__tl-v2">
      {/* Sleek Toolbar: Search, Time Range & Filter Segment Bar */}
      <div className="kh__tl-toolbar">
        <div className="kh__tl-toolbar-row">
          <div className="kh__tl-search-wrap">
            <Search size={14} className="kh__tl-search-icon" aria-hidden="true" />
            <input
              type="text"
              className="kh__tl-search-input"
              placeholder="Tìm sự kiện, mã đơn/báo giá, người thực hiện..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            {search && (
              <button
                type="button"
                className="kh__tl-search-clear"
                title="Xóa tìm kiếm"
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="kh__tl-controls-right">
            <select
              className="kh__tl-range-select"
              value={timeRange}
              aria-label="Khoảng thời gian"
              onChange={(e) => {
                setTimeRange(e.target.value as any);
                setPage(1);
              }}
            >
              <option value="all">Tất cả thời gian</option>
              <option value="7d">7 ngày qua</option>
              <option value="30d">30 ngày qua</option>
              <option value="this_month">Tháng này</option>
              <option value="custom">Tùy chọn ngày...</option>
            </select>

            {timeRange === "custom" && (
              <div className="kh__tl-custom-dates">
                <ChonNgay
                  className="kh__tl-date-input"
                  value={startDate}
                  onChange={(v) => {
                    setStartDate(v);
                    setPage(1);
                  }}
                  title="Từ ngày"
                  aria-label="Từ ngày"
                />
                <span className="kh__muted" style={{ fontSize: "12px" }}>-</span>
                <ChonNgay
                  className="kh__tl-date-input"
                  value={endDate}
                  onChange={(v) => {
                    setEndDate(v);
                    setPage(1);
                  }}
                  title="Đến ngày"
                  aria-label="Đến ngày"
                />
              </div>
            )}

            {groupedPaginatedRows.length > 0 && (
              <button
                type="button"
                className="kh__tl-toggle-all-btn"
                onClick={toggleAllGroups}
                title={areAllCollapsed ? "Mở rộng toàn bộ nhóm ngày" : "Thu gọn toàn bộ nhóm ngày"}
              >
                {areAllCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                <span>{areAllCollapsed ? "Mở tất cả" : "Thu gọn tất cả"}</span>
              </button>
            )}

            <div className="kh__tl-counter-badge">
              {search || kindFilter !== "all" || timeRange !== "all" ? (
                <span>
                  <strong>{totalItems}</strong> / {rows.length}
                </span>
              ) : (
                <span>
                  <strong>{rows.length}</strong> sự kiện
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="kh__tl-toolbar-row" style={{ marginTop: "4px" }}>
          <div className="kh__tl-filters" role="tablist" aria-label="Lọc theo loại sự kiện">
            {filterOptions.map((opt) => {
              const count = kindCounts[opt.key];
              const isActive = kindFilter === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  className={`kh__tl-chip${isActive ? " is-active" : ""}`}
                  onClick={() => {
                    setKindFilter(opt.key);
                    setPage(1);
                  }}
                >
                  {opt.icon}
                  <span>{opt.label}</span>
                  {count > 0 && <span className="kh__tl-chip-count">{count}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Empty filter result */}
      {filteredRows.length === 0 ? (
        <div className="kh__empty-panel kh__tl-empty">
          <p className="kh__empty-title">Không tìm thấy sự kiện nào</p>
          <p className="kh__muted">
            Không có nhật ký nào phù hợp với điều kiện tìm kiếm hoặc bộ lọc hiện tại.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setSearch("");
              setKindFilter("all");
              setTimeRange("all");
              setStartDate("");
              setEndDate("");
              setPage(1);
            }}
          >
            Xóa tìm kiếm &amp; bộ lọc
          </Button>
        </div>
      ) : (
        <>
          {/* Scrollable Timeline Body Container */}
          <div className="kh__tl-scroll-body">
            {/* Vertical Timeline Tree */}
            <div className="kh__tl-tree">
              {groupedPaginatedRows.map((group) => {
                const isExpanded = !collapsedGroups[group.dateKey];

                return (
                  <div key={`group-${group.dateKey}`} className="kh__tl-date-group">
                    <div
                      className="kh__tl-date-header"
                      onClick={() => toggleGroup(group.dateKey)}
                      title={isExpanded ? "Bấm để thu gọn" : "Bấm để mở rộng"}
                    >
                      <Calendar size={13} />
                      <span>{group.dateLabel}</span>
                      <span className="kh__tl-date-count">({group.items.length})</span>
                      <ChevronDown size={13} className={`kh__tl-header-chevron${isExpanded ? " is-expanded" : ""}`} />
                    </div>

                    {isExpanded && (
                      <div className="kh__tl-group-items">
                        {group.items.map((r, i) => {
                          const meta = AUDIT_KIND_META[r.kind];
                          const drillable = (r.ref_type === "quotation" || r.ref_type === "order") && r.ref_id != null;
                          const initials = r.actor_name ? getInitials(r.actor_name) : null;
                          const itemTime = fmtTimeOnly(r.at);

                          return (
                            <div
                              key={`${r.kind}-${r.ref_id ?? "p"}-${i}`}
                              className={`kh__tl-item-v2${drillable ? " is-drillable" : ""}`}
                              onClick={drillable ? () => onDrill(r.ref_type as "order" | "quotation", r.ref_id!) : undefined}
                              tabIndex={drillable ? 0 : undefined}
                              onKeyDown={
                                drillable ? (e) => e.key === "Enter" && onDrill(r.ref_type as "order" | "quotation", r.ref_id!) : undefined
                              }
                              title={drillable ? `Mở chi tiết ${r.title}` : undefined}
                            >
                              <div className={`kh__tl-node-v2 ${meta.nodeCls}`} aria-hidden="true">
                                {meta.icon}
                              </div>

                              <div className="kh__tl-card-v2">
                                <div className="kh__tl-card-row">
                                  <div className="kh__tl-card-left">
                                    <h4 className="kh__tl-card-title">{r.title}</h4>
                                    {!r.title.toLowerCase().startsWith(meta.label.toLowerCase()) && (
                                      <span className="kh__tl-kind-label">{meta.label}</span>
                                    )}
                                    {renderAuditDetailTags(r.detail)}
                                  </div>

                                  <div className="kh__tl-card-right">
                                    {r.actor_name && (
                                      <div className="kh__tl-actor-chip" title={`Thực hiện bởi ${r.actor_name}`}>
                                        <div className="kh__tl-actor-avatar">{initials}</div>
                                        <span>{r.actor_name}</span>
                                      </div>
                                    )}
                                    <span className="kh__tl-card-time" title={fmtDateTime(r.at)}>
                                      <Clock size={11} /> {itemTime}
                                    </span>
                                    {drillable && (
                                      <span className="kh__tl-drill-link" title="Xem chi tiết">
                                        Xem chi tiết <ChevronRight size={13} />
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 || totalItems > 5 ? (
            <div className="kh__tl-pagination">
              <div className="kh__tl-page-info">
                <span>
                  Hiển thị <strong>{startItemIndex}–{endItemIndex}</strong> trong tổng số <strong>{totalItems}</strong> sự kiện
                </span>
              </div>
              <div className="kh__tl-page-controls">
                <div className="kh__tl-size-select">
                  <span className="kh__muted" style={{ fontSize: "12px" }}>Hiển thị:</span>
                  <select
                    className="kh__tl-select"
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                </div>

                <div className="kh__tl-nav-btns">
                  <button
                    type="button"
                    className="kh__tl-nav-btn"
                    disabled={currentPage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    title="Trang trước"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="kh__tl-page-num">
                    Trang {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="kh__tl-nav-btn"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    title="Trang sau"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// --- Nhãn thủ công (#7: sales gán tay để phân loại chăm sóc) --------------------


/** Chips nhãn trên header hồ sơ + nút mở modal Gắn thẻ (mockup: toggle preset, Lưu một lần). */
function TagChips({ customerId, customerName, onDoi }: {
  customerId: number;
  customerName?: string;
  onDoi?: (labels: string[]) => void;
}) {
  const { token } = useAuth();
  const canUpdate = useCan()("khach_hang", "update");
  const [tags, setTags] = useState<{ id: number; label: string }[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.customers
      .tags(token, customerId)
      .then((r) => !cancelled && setTags(r.items))
      .catch(() => !cancelled && setTags([]));
    return () => {
      cancelled = true;
    };
  }, [token, customerId]);

  return (
    <>
      {tags.map((t) => (
        <span key={t.id} className={`kh__tagchip kh__tagchip--${tagTone(t.label)}`}>
          {t.label}
        </span>
      ))}
      {canUpdate && (
        <button type="button" className="kh__btn-tag" onClick={() => setOpen(true)}>
          <Tags size={13} /> Gắn thẻ
        </button>
      )}
      {open && (
        <TagModal
          customerId={customerId}
          customerName={customerName}
          current={tags}
          onClose={() => setOpen(false)}
          onSaved={(next) => {
            setTags(next);
            setOpen(false);
            onDoi?.(next.map((t) => t.label));
          }}
        />
      )}
    </>
  );
}

/** Modal "Gắn thẻ" 2.0: Fluid Vibrant Tag Cloud, Omni Search & Create bar thông minh,
 *  đa sắc màu hiện đại, tối giản không gian và thao tác tức thì. */
function TagModal({
  customerId,
  customerName,
  current,
  onClose,
  onSaved,
}: {
  customerId: number;
  customerName?: string;
  current: { id: number; label: string }[];
  onClose: () => void;
  onSaved: (next: { id: number; label: string }[]) => void;
}) {
  const { token } = useAuth();
  const canUpdate = useCan()("khach_hang", "update");
  // KHO nhãn từ server (`customer_tag_catalog`) — thay cho mảng 13 chuỗi viết cứng cũ. Giữ cả
  // `so_khach` để hộp thoại xoá hỏi được bằng số thật thay vì "bạn có chắc không".
  const [kho, setKho] = useState<KhoNhanRow[]>([]);
  const [customs, setCustoms] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(current.map((t) => t.label)),
  );
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [xoaNhan, setXoaNhan] = useState<KhoNhanRow | null>(null);

  const napKho = useCallback(() => {
    if (!token) return;
    api.customers.tagKho(token).then((r) => setKho(r.items)).catch(() => setKho([]));
  }, [token]);
  useEffect(() => napKho(), [napKho]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Số khách đang mang từng nhãn — tra theo nhãn hạ chữ, để hỏi trước khi xoá. */
  const soKhachTheoNhan = useMemo(() => {
    const m = new Map<string, KhoNhanRow>();
    for (const r of kho) m.set(r.label.toLowerCase(), r);
    return m;
  }, [kho]);

  // Danh sách tất cả nhãn duy nhất (case-insensitive dedup).
  // `current` vẫn phải góp mặt: khách có thể đang mang một nhãn mà kho chưa kịp nạp xong, thiếu nó
  // thì chip đang bật biến khỏi lưới và cú Lưu kế tiếp gỡ mất nhãn của khách.
  const allLabels = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const l of [...kho.map((r) => r.label), ...current.map((t) => t.label), ...customs]) {
      const key = l.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(l);
      }
    }
    return out;
  }, [kho, current, customs]);

  // Bộ lọc thẻ theo từ khoá tìm kiếm
  const filteredLabels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allLabels;
    return allLabels.filter((l) => l.toLowerCase().includes(q));
  }, [allLabels, query]);

  const exactMatchExists = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return allLabels.some((l) => l.toLowerCase() === q);
  }, [allLabels, query]);

  function toggle(label: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      const existing = [...next].find((l) => l.toLowerCase() === label.toLowerCase());
      if (existing) next.delete(existing);
      else next.add(label);
      return next;
    });
  }

  function clearAll() {
    setSelected(new Set());
  }

  function handleCreateOrAdd() {
    const label = query.trim().replace(/\s+/g, " ");
    if (!label) return;
    if (label.length > 50) {
      setError("Nhãn tối đa 50 ký tự.");
      return;
    }
    setError(null);
    const existing = allLabels.find((l) => l.toLowerCase() === label.toLowerCase());
    if (!existing) setCustoms((prev) => [...prev, label]);
    setSelected((prev) => {
      const next = new Set(prev);
      next.add(existing ?? label);
      return next;
    });
    setQuery("");
  }

  async function save() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      // So với nhãn THẬT trên máy chủ, không tin `current`: mở từ danh sách thì `current` chỉ có
      // chữ, id là số giả — xoá theo id giả là gỡ nhầm nhãn hoặc trượt.
      const thuc = (await api.customers.tags(token, customerId)).items;
      const currentByLower = new Map(thuc.map((t) => [t.label.toLowerCase(), t]));
      const selectedLower = new Set([...selected].map((l) => l.toLowerCase()));

      for (const t of thuc) {
        if (!selectedLower.has(t.label.toLowerCase())) {
          await api.customers.deleteTag(token, customerId, t.id);
        }
      }
      for (const label of selected) {
        if (!currentByLower.has(label.toLowerCase())) {
          await api.customers.addTag(token, customerId, label);
        }
      }
      const fresh = await api.customers.tags(token, customerId);
      onSaved(fresh.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Lưu thẻ không thành công.");
      setBusy(false);
    }
  }

  const selectedCount = selected.size;
  const avatarClass = customerName ? getKhAvatarClass(customerName) : "kh__avatar--moss";
  const initials = customerName ? getInitials(customerName) : "KH";

  return (
    <div className="kh__overlay kh__overlay--blur" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="kh__dialog card kh__tagmodal-v3"
        role="dialog"
        aria-modal="true"
        aria-label="Gắn thẻ khách hàng"
      >
        {/* Header Modal với Avatar Khách hàng */}
        <div className="kh__tagmodal-head">
          <div className="kh__tagmodal-head-left">
            <div className={`kh__tagmodal-avatar ${avatarClass}`}>{initials}</div>
            <div>
              <div className="kh__tagmodal-subhead">Gắn thẻ</div>
              <h2 className="kh__tagmodal-title">{customerName || "Khách hàng"}</h2>
            </div>
          </div>
          <button type="button" className="kh__close" aria-label="Đóng" onClick={onClose}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Body Modal */}
        <div className="kh__dialog-body kh__tagmodal-body">
          {/* Thanh Tìm kiếm & Tạo thẻ Omni-Input */}
          <div className="kh__tag-omni-bar">
            <Search size={15} className="kh__tag-omni-ic" />
            <input
              className="kh__tag-omni-input"
              placeholder="Tìm thẻ hoặc gõ tên để tạo mới (Enter)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreateOrAdd();
                }
              }}
            />
            {query && (
              <button
                type="button"
                className="kh__tag-omni-clear"
                onClick={() => setQuery("")}
                title="Xóa tìm kiếm"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Tag Cloud đa sắc màu liền mạch */}
          <div className="kh__tagcloud-fluid">
            {filteredLabels.map((label) => {
              const on = [...selected].some((l) => l.toLowerCase() === label.toLowerCase());
              const tone = tagTone(label);
              // Chỉ nhãn ĐÃ Ở TRONG KHO mới xoá được. Nhãn vừa gõ ở ô trên (`customs`) chưa có id
              // — nó chỉ thành dòng thật sau khi Lưu, nên chưa có gì để xoá.
              const dongKho = soKhachTheoNhan.get(label.toLowerCase());
              return (
                <span key={label} className="kh__tagpill-wrap">
                  <button
                    type="button"
                    className={`kh__tagpill-v3${on ? " is-on" : ""} kh__tagpill--${tone}`}
                    aria-pressed={on}
                    onClick={() => toggle(label)}
                  >
                    {on ? (
                      <Check size={13} className="kh__tagpill-check" strokeWidth={2.5} />
                    ) : (
                      <span className="kh__tagpill-dot" />
                    )}
                    <span>{label}</span>
                  </button>
                  {canUpdate && dongKho && (
                    // Nút xoá NẰM NGOÀI pill, không lồng trong nó: button trong button là HTML
                    // không hợp lệ, trình duyệt tự gỡ lồng và cú bấm rơi nhầm sang nút cha.
                    <button
                      type="button"
                      className="kh__tagpill-del"
                      title={`Xoá nhãn "${label}" khỏi kho`}
                      aria-label={`Xoá nhãn ${label} khỏi kho`}
                      onClick={() => setXoaNhan(dongKho)}
                    >
                      <X size={11} strokeWidth={2.5} />
                    </button>
                  )}
                </span>
              );
            })}

            {/* Pill gợi ý tạo thẻ mới khi không khớp hoàn toàn */}
            {!exactMatchExists && query.trim() && (
              <button
                type="button"
                className="kh__tagpill-v3 kh__tagpill-create"
                onClick={handleCreateOrAdd}
              >
                <Plus size={13} strokeWidth={2.5} />
                <span>Tạo mới "<strong>{query.trim()}</strong>"</span>
              </button>
            )}
          </div>

          {error && <div className="banner banner--error" role="alert">{error}</div>}

          {/* Footer Action buttons */}
          <div className="kh__dialog-actions kh__tagmodal-actions">
            {/* Chip đang bật đã tự nói là đã chọn — không nhắc lại thành một dải chip thứ hai. */}
            {selectedCount > 0 && (
              <button type="button" className="kh__tag-clear-btn" onClick={clearAll}>
                Bỏ chọn tất cả
              </button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Huỷ
            </Button>
            <Button variant="primary" onClick={save} loading={busy}>
              {selectedCount > 0 ? `Lưu ${selectedCount} thẻ` : "Lưu thay đổi"}
            </Button>
          </div>
        </div>
      </div>

      {/* Xoá nhãn khỏi KHO — khác hẳn bỏ tick (bỏ tick chỉ gỡ nhãn khỏi riêng khách này).
          Hỏi kèm SỐ KHÁCH THẬT chứ không "bạn có chắc không": con số là thứ duy nhất giúp người
          bấm biết mình sắp làm hỏng bao nhiêu. */}
      <ConfirmDialog
        open={xoaNhan !== null}
        danger
        title={`Xoá nhãn "${xoaNhan?.label ?? ""}" khỏi kho?`}
        message={
          xoaNhan && xoaNhan.so_khach > 0
            ? `${xoaNhan.so_khach} khách đang mang nhãn này — xoá thì nhãn rơi khỏi cả ${xoaNhan.so_khach} khách đó. `
              + "Không khôi phục được."
            : "Chưa khách nào mang nhãn này, xoá là an toàn."
        }
        confirmLabel="Xoá nhãn"
        busy={busy}
        onCancel={() => setXoaNhan(null)}
        onConfirm={async () => {
          if (!token || !xoaNhan) return;
          setBusy(true);
          setError(null);
          try {
            await api.customers.xoaNhanKho(token, xoaNhan.id);
            // Gỡ khỏi ô đang chọn luôn: giữ lại thì bấm Lưu sẽ gán lại đúng nhãn vừa xoá, và nó
            // tự chui về kho qua `add_tag` — xoá xong lại mọc.
            setSelected((prev) => {
              const next = new Set(prev);
              for (const l of next) {
                if (l.toLowerCase() === xoaNhan.label.toLowerCase()) next.delete(l);
              }
              return next;
            });
            setCustoms((prev) =>
              prev.filter((l) => l.toLowerCase() !== xoaNhan.label.toLowerCase()));
            setXoaNhan(null);
            napKho();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Xoá nhãn không thành công.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

// --- Modal Điều chuyển & Bàn giao Khách hàng (Handover Hub) -------------------

/** Modal Điều chuyển & Bàn giao toàn bộ khách hàng giữa 2 nhân sự kinh doanh */
function CustomerReassignModal({
  open,
  sales,
  fromSale,
  toSale,
  setFromSale,
  setToSale,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  sales: SaleOption[];
  fromSale: number | null;
  toSale: number | null;
  setFromSale: (v: number | null) => void;
  setToSale: (v: number | null) => void;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (!open) {
      setCountdown(5);
      return;
    }
    setCountdown(5);
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const sourceSale = sales.find((s) => s.id === fromSale);
  const targetSale = sales.find((s) => s.id === toSale);
  const isConfirmDisabled = fromSale == null || toSale == null || fromSale === toSale || countdown > 0;
  const sourceCount = sourceSale?.so_kh ?? 0;
  const targetCount = targetSale?.so_kh ?? 0;

  return (
    <div className="kh__overlay kh__overlay--blur" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="kh__dialog card kh__reassign-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Điều chuyển khách hàng"
      >
        {/* Header Modal */}
        <div className="kh__reassign-head">
          <div className="kh__reassign-head-left">
            <div className="kh__reassign-head-icon">
              <ArrowLeftRight size={18} />
            </div>
            <div>
              <h2 className="kh__reassign-title">Điều chuyển &amp; Bàn giao khách hàng</h2>
              <div className="kh__reassign-subtitle">
                Bàn giao quyền phụ trách danh bạ giữa các nhân sự kinh doanh
              </div>
            </div>
          </div>
          <button type="button" className="kh__close" aria-label="Đóng" onClick={onCancel} disabled={busy}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Body Modal */}
        <div className="kh__dialog-body kh__reassign-body">
          {/* Safety Notice Card */}
          <div className="kh__reassign-notice">
            <ShieldAlert size={16} className="kh__reassign-notice-ic" />
            <div className="kh__reassign-notice-text">
              <strong>Lưu ý bàn giao:</strong> Toàn bộ khách hàng của nhân viên nguồn sẽ được chuyển giao sang nhân viên tiếp nhận. Quyền chăm sóc và lịch sử giao dịch sẽ được bàn giao đầy đủ.
            </div>
          </div>

          {/* Interactive Transfer Duo */}
          <div className="kh__transfer-duo">
            {/* Cột Nguồn */}
            <div className="kh__transfer-col kh__transfer-col--source">
              <label className="kh__transfer-label">
                <Users size={13} />
                <span>Từ nhân viên (Nguồn)</span>
              </label>
              <Select
                ariaLabel="Nhân viên nguồn"
                portal
                value={fromSale}
                placeholder="— Chọn nhân viên nguồn —"
                onChange={(v) => setFromSale(v)}
                options={sales
                  .filter((s) => (s.so_kh ?? 0) > 0)
                  .map((s) => ({
                    value: s.id,
                    label: s.name,
                    sub: moTaSale(s),
                    hint: `${s.so_kh} KH`,
                  }))}
              />

              {sourceSale ? (
                <div className="kh__transfer-card">
                  <div className="kh__avatar-wrapper">
                    <div className={`kh__avatar ${getKhAvatarClass(sourceSale.name)}`}>
                      {getInitials(sourceSale.name)}
                    </div>
                  </div>
                  <div className="kh__transfer-card-info">
                    <div className="kh__transfer-card-name">{sourceSale.name}</div>
                    <div className="kh__transfer-card-role">{moTaSale(sourceSale) || "NV Kinh doanh"}</div>
                    <div className="kh__transfer-card-meta">
                      <span className="kh__transfer-count-badge">
                        Đang giữ: <strong>{sourceCount} KH</strong>
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="kh__transfer-card-empty">Chọn nhân viên có khách cần bàn giao</div>
              )}
            </div>

            {/* Mũi tên chuyển dịch */}
            <div className="kh__transfer-arrow-hub">
              <div className="kh__transfer-arrow-pill">
                {sourceCount > 0 ? `${sourceCount} KH` : "Bàn giao"}
              </div>
              <div className="kh__transfer-arrow-ic">
                <ArrowRight size={16} />
              </div>
            </div>

            {/* Cột Đích */}
            <div className="kh__transfer-col kh__transfer-col--target">
              <label className="kh__transfer-label">
                <ShieldCheck size={13} />
                <span>Sang nhân viên (Đích)</span>
              </label>
              <Select
                ariaLabel="Nhân viên đích"
                portal
                value={toSale}
                placeholder="— Chọn nhân viên đích —"
                onChange={(v) => setToSale(v)}
                options={sales
                  .filter((s) => s.id !== fromSale && s.co_the_gan !== false)
                  .map((s) => ({
                    value: s.id,
                    label: s.name,
                    sub: moTaSale(s),
                    hint: s.so_kh != null ? `${s.so_kh} KH` : undefined,
                  }))}
              />

              {targetSale ? (
                <div className="kh__transfer-card">
                  <div className="kh__avatar-wrapper">
                    <div className={`kh__avatar ${getKhAvatarClass(targetSale.name)}`}>
                      {getInitials(targetSale.name)}
                    </div>
                  </div>
                  <div className="kh__transfer-card-info">
                    <div className="kh__transfer-card-name">{targetSale.name}</div>
                    <div className="kh__transfer-card-role">{moTaSale(targetSale) || "NV Tiếp nhận"}</div>
                    <div className="kh__transfer-card-meta">
                      <span className="kh__transfer-count-badge">
                        Hiện có: <strong>{targetCount} KH</strong>
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="kh__transfer-card-empty">Chọn nhân viên tiếp nhận danh bạ</div>
              )}
            </div>
          </div>

          {/* Impact Preview Card */}
          {sourceSale && targetSale && (
            <div className="kh__reassign-impact">
              <div className="kh__reassign-impact-title">
                <CheckCircle2 size={14} className="kh__reassign-impact-ic" />
                <span>Dự kiến biến động sau khi bàn giao:</span>
              </div>
              <div className="kh__reassign-impact-grid">
                <div className="kh__reassign-impact-box">
                  <span className="kh__reassign-impact-sub">Nguồn: <strong>{sourceSale.name}</strong></span>
                  <div className="kh__reassign-impact-val">
                    <span>{sourceCount} KH</span>
                    <ArrowRight size={12} />
                    <strong className="kh__reassign-impact-zero">0 KH</strong>
                    <span className="kh__reassign-impact-subtag">(Bàn giao hết)</span>
                  </div>
                </div>
                <div className="kh__reassign-impact-box">
                  <span className="kh__reassign-impact-sub">Đích: <strong>{targetSale.name}</strong></span>
                  <div className="kh__reassign-impact-val">
                    <span>{targetCount} KH</span>
                    <ArrowRight size={12} />
                    <strong className="kh__reassign-impact-plus">{targetCount + sourceCount} KH</strong>
                    <span className="kh__reassign-impact-plustag">(+{sourceCount} KH)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && <div className="banner banner--error" role="alert">{error}</div>}

          {/* Action buttons */}
          <div className="kh__dialog-actions kh__reassign-actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onCancel}
              disabled={busy}
            >
              Huỷ
            </button>
            <button
              type="button"
              className="kh__reassign-confirm-btn"
              onClick={onConfirm}
              disabled={busy || isConfirmDisabled}
            >
              {busy ? (
                "Đang điều chuyển…"
              ) : countdown > 0 ? (
                <>
                  <Clock size={13} />
                  <span>Xác nhận bàn giao ({countdown}s)</span>
                </>
              ) : (
                <>
                  <ArrowLeftRight size={14} />
                  <span>Xác nhận bàn giao ngay</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Modal Chuyển hàng loạt khách hàng đã chọn sang nhân viên tiếp nhận */
function BulkReassignModal({
  open,
  selectedCount,
  sales,
  bulkTarget,
  setBulkTarget,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  selectedCount: number;
  sales: SaleOption[];
  bulkTarget: number | null;
  setBulkTarget: (v: number | null) => void;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (!open) {
      setCountdown(5);
      return;
    }
    setCountdown(5);
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const targetSale = sales.find((s) => s.id === bulkTarget);
  const isConfirmDisabled = bulkTarget == null || countdown > 0;
  const targetCount = targetSale?.so_kh ?? 0;

  return (
    <div className="kh__overlay kh__overlay--blur" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="kh__dialog card kh__reassign-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Chuyển khách hàng đã chọn"
      >
        {/* Header Modal */}
        <div className="kh__reassign-head">
          <div className="kh__reassign-head-left">
            <div className="kh__reassign-head-icon">
              <Users size={18} />
            </div>
            <div>
              <h2 className="kh__reassign-title">Chuyển {selectedCount} khách hàng đã chọn</h2>
              <div className="kh__reassign-subtitle">
                Gán nhân viên phụ trách mới cho danh sách khách hàng đang chọn
              </div>
            </div>
          </div>
          <button type="button" className="kh__close" aria-label="Đóng" onClick={onCancel} disabled={busy}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Body Modal */}
        <div className="kh__dialog-body kh__reassign-body">
          {/* Safety Notice Card */}
          <div className="kh__reassign-notice">
            <ShieldAlert size={16} className="kh__reassign-notice-ic" />
            <div className="kh__reassign-notice-text">
              <strong>Lưu ý:</strong> <strong>{selectedCount} khách hàng</strong> đang chọn sẽ được cập nhật người phụ trách sang nhân sự được chỉ định bên dưới.
            </div>
          </div>

          {/* Chọn nhân viên đích */}
          <div className="kh__bulk-target-box">
            <label className="kh__transfer-label">
              <ShieldCheck size={13} />
              <span>Chỉ định nhân viên tiếp nhận (Đích)</span>
            </label>
            <Select
              ariaLabel="Nhân viên đích"
              portal
              value={bulkTarget}
              placeholder="— Chọn nhân viên tiếp nhận —"
              onChange={(v) => setBulkTarget(v)}
              options={sales
                .filter((s) => s.co_the_gan !== false)
                .map((s) => ({
                  value: s.id,
                  label: s.name,
                  sub: moTaSale(s),
                  hint: s.so_kh != null ? `${s.so_kh} KH` : undefined,
                }))}
            />

            {targetSale && (
              <div className="kh__transfer-card" style={{ marginTop: "12px" }}>
                <div className="kh__avatar-wrapper">
                  <div className={`kh__avatar ${getKhAvatarClass(targetSale.name)}`}>
                    {getInitials(targetSale.name)}
                  </div>
                </div>
                <div className="kh__transfer-card-info">
                  <div className="kh__transfer-card-name">{targetSale.name}</div>
                  <div className="kh__transfer-card-role">{moTaSale(targetSale) || "NV Tiếp nhận"}</div>
                  <div className="kh__transfer-card-meta">
                    <span className="kh__transfer-count-badge">
                      Hiện có: <strong>{targetCount} KH</strong> ➔ Sau chuyển: <strong>{targetCount + selectedCount} KH</strong> (+{selectedCount} KH)
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && <div className="banner banner--error" role="alert">{error}</div>}

          {/* Action buttons */}
          <div className="kh__dialog-actions kh__reassign-actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onCancel}
              disabled={busy}
            >
              Huỷ
            </button>
            <button
              type="button"
              className="kh__reassign-confirm-btn"
              onClick={onConfirm}
              disabled={busy || isConfirmDisabled}
            >
              {busy ? (
                "Đang điều chuyển…"
              ) : countdown > 0 ? (
                <>
                  <Clock size={13} />
                  <span>Xác nhận chuyển ({countdown}s)</span>
                </>
              ) : (
                <>
                  <Users size={14} />
                  <span>Xác nhận chuyển ngay</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotesTab({ customerId }: { customerId: number }) {
  const { token } = useAuth();
  const canUpdate = useCan()("khach_hang", "update");
  const [notes, setNotes] = useState<CustomerNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const reload = useCallback(() => {
    if (!token) return;
    api.customers
      .notes(token, customerId)
      .then((r) => setNotes(r.items))
      .catch(() => setError("Không tải được ghi chú."));
  }, [token, customerId]);

  useEffect(() => {
    setNotes(null);
    setError(null);
    reload();
  }, [reload]);

  async function add() {
    if (!token || busy || !draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.customers.addNote(token, customerId, draft.trim());
      setDraft("");
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Thêm ghi chú không thành công.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(n: CustomerNote) {
    if (!token || !editBody.trim()) return;
    try {
      await api.customers.updateNote(token, customerId, n.id, { body: editBody.trim() });
      setEditId(null);
      setEditBody("");
      reload();
    } catch {
      setError("Lưu ghi chú không thành công.");
    }
  }

  async function togglePin(n: CustomerNote) {
    if (!token) return;
    try {
      await api.customers.updateNote(token, customerId, n.id, { pinned: !n.pinned });
      reload();
    } catch {
      setError("Cập nhật ghim không thành công.");
    }
  }

  async function remove(n: CustomerNote) {
    if (!token) return;
    try {
      await api.customers.deleteNote(token, customerId, n.id);
      setConfirmDeleteId(null);
      reload();
    } catch {
      setError("Xóa ghi chú không thành công.");
    }
  }

  if (notes === null) return <EmptyState trangThai="dang-tai" inline />;

  return (
    <div className="kh__notes">
      {canUpdate && (
        <div className="kh__note-composer">
          <div className="kh__note-composer-card">
            <textarea
              className="kh__note-input"
              rows={2}
              placeholder="Thêm ghi chú về khách (vd: thích giao buổi sáng, chốt qua Zalo nhanh nhất, hay trả trễ…)"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") add();
              }}
            />
            <div className="kh__note-composer-toolbar">
              <span className="kh__note-hint">⌘/Ctrl + Enter để lưu nhanh</span>
              <Button
                type="button"
                variant="primary"
                loading={busy}
                disabled={!draft.trim()}
                onClick={add}
              >
                <Plus size={14} /> Thêm ghi chú
              </Button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="kh__err" role="alert">
          {error}
        </p>
      )}

      {notes.length === 0 ? (
        <div className="kh__note-empty-container">
          <div className="kh__note-empty-icon">
            <StickyNote size={40} strokeWidth={1.5} />
          </div>
          <h3 className="kh__note-empty-title">Chưa có ghi chú nào</h3>
          <p className="kh__note-empty-desc">
            {canUpdate
              ? "Thêm ghi chú đầu tiên ở trên để lưu trữ các thông tin liên lạc, sở thích hoặc lưu ý quan trọng về khách hàng này."
              : "Chưa có lưu ý nào được ghi nhận cho khách hàng này."}
          </p>
        </div>
      ) : (
        <ul className="kh__note-list">
          {notes.map((n) => (
            <li key={n.id} className={`kh__note${n.pinned ? " is-pinned" : ""}`}>
              {editId === n.id ? (
                <div className="kh__note-edit">
                  <textarea
                    className="input"
                    rows={3}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                  />
                  <div className="kh__note-edit-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setEditId(null);
                        setEditBody("");
                      }}
                    >
                      Huỷ
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={!editBody.trim()}
                      onClick={() => saveEdit(n)}
                    >
                      Lưu
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="kh__note-header">
                    <div className="kh__note-author-info">
                      <div className="kh__note-avatar">
                        {n.author_name ? getInitials(n.author_name) : "?"}
                      </div>
                      <span className="kh__note-author-name">{n.author_name || "—"}</span>
                      <span className="kh__note-dot">•</span>
                      <span className="kh__note-time" title={fmtDateTime(n.created_at)}>
                        {fmtDateTime(n.created_at)}
                      </span>
                      {n.edited && n.updated_at && (
                        <>
                          <span className="kh__note-dot">•</span>
                          <span className="kh__note-edited" title={`Đã sửa ${fmtDateTime(n.updated_at)}`}>
                            đã sửa
                          </span>
                        </>
                      )}
                    </div>
                    {canUpdate && confirmDeleteId !== n.id && (
                      <span className="kh__note-actions">
                        <button
                          type="button"
                          className={`kh__note-act${n.pinned ? " is-on" : ""}`}
                          title={n.pinned ? "Bỏ ghim" : "Ghim lên đầu"}
                          onClick={() => togglePin(n)}
                        >
                          <Pin size={13} />
                        </button>
                        <button
                          type="button"
                          className="kh__note-act"
                          title="Sửa"
                          onClick={() => {
                            setEditId(n.id);
                            setEditBody(n.body);
                          }}
                        >
                          <PencilLine size={13} />
                        </button>
                        <button
                          type="button"
                          className="kh__note-act kh__note-act--danger"
                          title="Xóa"
                          onClick={() => setConfirmDeleteId(n.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    )}
                  </div>
                  <div className="kh__note-body">
                    {n.pinned && <Pin size={12} className="kh__note-pin-ic" />}
                    <span>{n.body}</span>
                  </div>
                  {confirmDeleteId === n.id && (
                    <div className="kh__note-delete-confirm">
                      <span className="kh__note-delete-confirm-msg">Xác nhận xóa ghi chú này?</span>
                      <div className="kh__note-delete-confirm-actions">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Hủy
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => remove(n)}
                        >
                          Xác nhận
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Chăm sóc tab: lịch hẹn kiểu Google Calendar (05/10/2026) ---------------------
//
// Khối "Nhật ký hoạt động" riêng ĐÃ GỠ: lịch sử chính là các hẹn đã qua trong Lịch biểu ("Xem hẹn
// cũ hơn"), kết quả ghi ở ô ghi chú của từng hẹn. Còn lại dòng Đánh giá (#28) dưới lịch.

function CareTab({ customerId, onCareChanged, moHenTick, eventTick = 0 }: {
  customerId: number;
  onCareChanged?: () => void;
  moHenTick?: number;
  eventTick?: number;
}) {
  const { token } = useAuth();
  // Đánh giá chăm sóc (#28): xong đúng hạn / xong trễ / đang trễ — BE trả sẵn.
  const [danhGia, setDanhGia] = useState<{ done_on_time: number; done_late: number; overdue_open: number } | null>(null);

  const napDanhGia = useCallback(() => {
    if (!token) return;
    api.customers
      .careTasks(token, customerId)
      .then((t) => setDanhGia({ done_on_time: t.done_on_time, done_late: t.done_late, overdue_open: t.overdue_open }))
      .catch(() => setDanhGia(null));
  }, [token, customerId]);

  useEffect(() => {
    setDanhGia(null);
    napDanhGia();
  }, [napDanhGia]);
  useEffect(() => {
    if (eventTick) napDanhGia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventTick]);

  return (
    <div className="kh__care">
      <CareCalendar customerId={customerId} moHenTick={moHenTick} eventTick={eventTick} onChange={() => { napDanhGia(); onCareChanged?.(); }} />
      {danhGia && danhGia.done_on_time + danhGia.done_late + danhGia.overdue_open > 0 && (
        <div className="care-eval-line">
          <span className="stat__label">Đánh giá</span>
          <span className="care-eval-item care-eval-item--good">
            <CheckCircle2 size={12} /> {danhGia.done_on_time} xong đúng hạn
          </span>
          <span className="care-eval-item care-eval-item--mid">
            <Clock size={12} /> {danhGia.done_late} xong trễ
          </span>
          <span className="care-eval-item care-eval-item--bad">
            <AlertTriangle size={12} /> {danhGia.overdue_open} đang trễ
          </span>
        </div>
      )}
    </div>
  );
}

// --- Liên hệ tab (#10–#11: nhiều người liên hệ, chức vụ + nhiệm vụ) -----------

interface ContactFormState {
  name: string;
  title: string;
  duty: string;
  phone: string;
  email: string;
  is_primary: boolean;
}
const EMPTY_CONTACT: ContactFormState = {
  name: "",
  title: "",
  duty: "",
  phone: "",
  email: "",
  is_primary: false,
};

function ContactsTab({ customerId, onChanged, moThemTick = 0 }: {
  customerId: number;
  /** Danh sách vừa đổi (thêm/sửa/xoá) — để thẻ "Liên hệ chính" ở đầu hồ sơ nạp lại. */
  onChanged?: () => void;
  /** Nút "Thêm người liên hệ" ở đầu hồ sơ: mỗi lần tăng ⇒ mở sẵn form thêm mới. */
  moThemTick?: number;
}) {
  const { token } = useAuth();
  const canUpdate = useCan()("khach_hang", "update");
  const [items, setItems] = useState<CustomerContact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null); // -1 = thêm mới
  const [form, setForm] = useState<ContactFormState>(EMPTY_CONTACT);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!token) return;
    api.customers
      .contacts(token, customerId)
      .then((r) => setItems(r.items))
      .catch(() => setError("Không tải được danh sách liên hệ."));
  }, [token, customerId]);

  useEffect(() => {
    setItems(null);
    setError(null);
    setEditingId(null);
    reload();
  }, [reload]);

  function startAdd() {
    setForm(EMPTY_CONTACT);
    setFormError(null);
    setEditingId(-1);
  }
  // Mở form thêm khi được gọi từ đầu hồ sơ — chờ danh sách nạp xong (lượt nạp đầu đóng form).
  const daMoThem = useRef(0);
  useEffect(() => {
    if (!moThemTick || moThemTick === daMoThem.current || items == null || !canUpdate) return;
    daMoThem.current = moThemTick;
    // Khách chưa có ai thì người đầu tiên mặc định là liên hệ chính.
    setForm({ ...EMPTY_CONTACT, is_primary: items.length === 0 });
    setFormError(null);
    setEditingId(-1);
  }, [moThemTick, items, canUpdate]);
  function startEdit(c: CustomerContact) {
    setForm({
      name: c.name,
      title: c.title ?? "",
      duty: c.duty ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      is_primary: c.is_primary,
    });
    setFormError(null);
    setEditingId(c.id);
  }

  async function save() {
    if (!token || busy) return;
    if (!form.name.trim()) {
      setFormError("Tên người liên hệ là bắt buộc.");
      return;
    }
    setBusy(true);
    setFormError(null);
    const input: CustomerContactInput = {
      name: form.name.trim(),
      title: form.title.trim() || null,
      duty: form.duty.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      is_primary: form.is_primary,
    };
    try {
      if (editingId === -1) await api.customers.addContact(token, customerId, input);
      else if (editingId != null)
        await api.customers.updateContact(token, customerId, editingId, input);
      setEditingId(null);
      reload();
      onChanged?.();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Lưu không thành công.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!token) return;
    try {
      await api.customers.deleteContact(token, customerId, id);
      reload();
      onChanged?.();
    } catch {
      setError("Xóa không thành công.");
    }
  }

  if (error) return <div className="banner banner--error" role="alert">{error}</div>;
  if (items == null) return <TableSkeleton cols={4} />;

  return (
    <div className="kh__histwrap">
      {/* Dòng đếm + lời dặn đầu tab đã gỡ (04/10/2026): số thẻ nhìn là thấy. Chỉ còn nút thêm. */}
      {canUpdate && editingId == null && (
        <div className="kh__hist-toolbar" style={{ justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={startAdd} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <Plus size={14} /> Thêm liên hệ
          </Button>
        </div>
      )}

      {editingId != null && (
        <div className="card kh__subform">
          <div className="kh__form-grid--3col">
            <label className="field kh__span-2">
              <span className="field__label">Tên *</span>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </label>
            <label className="field kh__span-1">
              <span className="field__label">Chức vụ</span>
              <input
                className="input"
                value={form.title}
                placeholder="Kế toán, mua hàng, kho…"
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </label>
            <label className="field kh__span-1">
              <span className="field__label">Nhiệm vụ</span>
              <input
                className="input"
                value={form.duty}
                placeholder="Đối chiếu công nợ, nhận hàng…"
                onChange={(e) => setForm((f) => ({ ...f, duty: e.target.value }))}
              />
            </label>
            <label className="field kh__span-1">
              <span className="field__label">Điện thoại</span>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </label>
            <label className="field kh__span-1">
              <span className="field__label">Email</span>
              <input
                className="input"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </label>
            <label className="field kh__checkfield kh__span-3" style={{ marginTop: "12px" }}>
              <input
                type="checkbox"
                checked={form.is_primary}
                onChange={(e) => setForm((f) => ({ ...f, is_primary: e.target.checked }))}
              />
              <span style={{ fontSize: "13px", color: "var(--ink)" }}>Liên hệ chính (chỉ một người)</span>
            </label>
          </div>
          {formError && <div className="banner banner--error" role="alert">{formError}</div>}
          <div className="kh__dialog-actions">
            <Button variant="ghost" onClick={() => setEditingId(null)}>
              Huỷ
            </Button>
            <Button variant="primary" onClick={save} loading={busy}>
              Lưu
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 && editingId == null ? (
        <div className="kh__empty-panel">
          <Users size={36} style={{ color: "var(--ash-2)", opacity: 0.7, marginBottom: "4px" }} />
          <p className="kh__empty-title">Chưa có người liên hệ</p>
          <p className="kh__muted">
            Khách luôn có nhiều đầu mối (mua hàng, kho, kế toán, kỹ thuật…) — thêm để các bộ
            phận tự chủ liên hệ khi cần.
          </p>
          {canUpdate && (
            <Button variant="secondary" onClick={startAdd} style={{ marginTop: "8px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <Plus size={14} /> Thêm liên hệ ngay
            </Button>
          )}
        </div>
      ) : (
        items.length > 0 && (
          <div className="kh__contacts-grid">
            {items.map((c) => {
              const initials = c.name.trim().split(/\s+/).map(p => p[0]).filter(Boolean).slice(-2).join("").toUpperCase();
              return (
                <div key={c.id} className={`kh__contact-card ${c.is_primary ? "kh__contact-card--primary" : ""}`}>
                  <div className="kh__contact-header">
                    <div className="contact-avatar">{initials}</div>
                    <div className="kh__contact-info">
                      <h4 className="kh__contact-name">
                        <span className="kh__contact-name-text" title={c.name}>{c.name}</span>
                      </h4>
                      {/* Nhãn "Chính" nằm ở dòng chức vụ, không cạnh tên: dòng tên phải chừa chỗ cho
                          cụm nút sửa/xoá ở góc, thêm nhãn vào đó là tên bị cắt cụt. */}
                      {(c.title || c.is_primary) && (
                        <p className="kh__contact-title">
                          {c.is_primary && (
                            <span className="kh__badge kh__badge--moss" style={{ flex: "none", fontSize: "12px", padding: "1px 6px", display: "inline-flex", alignItems: "center", gap: "2px" }}>
                              <CheckCircle2 size={10} /> Chính
                            </span>
                          )}
                          {c.title && <span className="kh__contact-name-text" title={c.title}>{c.title}</span>}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="kh__contact-details">
                    {c.duty && (
                      <div className="kh__contact-detail-row">
                        <Users size={14} />
                        <span className="kh__contact-detail-text" title={c.duty}>Nhiệm vụ: {c.duty}</span>
                      </div>
                    )}
                    {c.phone && (
                      <div className="kh__contact-detail-row">
                        <Phone size={14} />
                        <a href={`tel:${c.phone}`} className="kh__contact-detail-text kh__link kh__mono" title={c.phone}>
                          {c.phone}
                        </a>
                      </div>
                    )}
                    {c.email && (
                      <div className="kh__contact-detail-row">
                        <Mail size={14} />
                        <a href={`mailto:${c.email}`} className="kh__contact-detail-text kh__link kh__mono" title={c.email}>
                          {c.email}
                        </a>
                      </div>
                    )}
                    {!c.duty && !c.phone && !c.email && (
                      <div className="kh__contact-detail-row kh__muted" style={{ fontSize: "12px", fontStyle: "italic" }}>
                        Chưa có thông tin liên lạc
                      </div>
                    )}
                  </div>

                  {canUpdate && (
                    <div className="kh__contact-actions">
                      <button
                        type="button"
                        className="contact-action-btn"
                        onClick={() => startEdit(c)}
                        title="Sửa thông tin"
                      >
                        <PencilLine size={14} />
                      </button>
                      <button
                        type="button"
                        className="contact-action-btn contact-action-btn--delete"
                        onClick={() => remove(c.id)}
                        title="Xoá liên hệ"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

// --- Giao hàng tab (#9: nhiều địa chỉ giao — chỗ nối phí giao hàng của Tính giá) --

interface AddressFormState {
  label: string;
  address: string;
  phone: string;
  note: string;
  is_default: boolean;
}
const EMPTY_ADDRESS: AddressFormState = {
  label: "",
  address: "",
  phone: "",
  note: "",
  is_default: false,
};

function AddressesTab({ customerId }: { customerId: number }) {
  const { token } = useAuth();
  const canUpdate = useCan()("khach_hang", "update");
  const [items, setItems] = useState<CustomerAddress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<AddressFormState>(EMPTY_ADDRESS);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!token) return;
    api.customers
      .addresses(token, customerId)
      .then((r) => setItems(r.items))
      .catch(() => setError("Không tải được danh sách địa chỉ giao hàng."));
  }, [token, customerId]);

  useEffect(() => {
    setItems(null);
    setError(null);
    setEditingId(null);
    reload();
  }, [reload]);

  function startAdd() {
    setForm(EMPTY_ADDRESS);
    setFormError(null);
    setEditingId(-1);
  }
  function startEdit(a: CustomerAddress) {
    setForm({
      label: a.label,
      address: a.address,
      phone: a.phone ?? "",
      note: a.note ?? "",
      is_default: a.is_default,
    });
    setFormError(null);
    setEditingId(a.id);
  }

  async function save() {
    if (!token || busy) return;
    if (!form.label.trim() || !form.address.trim()) {
      setFormError("Tên điểm giao và địa chỉ là bắt buộc.");
      return;
    }
    setBusy(true);
    setFormError(null);
    const input: CustomerAddressInput = {
      label: form.label.trim(),
      address: form.address.trim(),
      phone: form.phone.trim() || null,
      note: form.note.trim() || null,
      is_default: form.is_default,
    };
    try {
      if (editingId === -1) await api.customers.addAddress(token, customerId, input);
      else if (editingId != null)
        await api.customers.updateAddress(token, customerId, editingId, input);
      setEditingId(null);
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Lưu không thành công.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!token) return;
    try {
      await api.customers.deleteAddress(token, customerId, id);
      reload();
    } catch {
      setError("Xóa không thành công.");
    }
  }

  if (error) return <div className="banner banner--error" role="alert">{error}</div>;
  if (items == null) return <TableSkeleton cols={3} />;

  return (
    <div className="kh__histwrap">
      {/* Dòng đếm + lời dặn đầu tab đã gỡ (04/10/2026): số thẻ nhìn là thấy. Chỉ còn nút thêm. */}
      {canUpdate && editingId == null && (
        <div className="kh__hist-toolbar" style={{ justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={startAdd} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <Plus size={14} /> Thêm điểm giao
          </Button>
        </div>
      )}

      {editingId != null && (
        <div className="card kh__subform">
          <div className="kh__form-grid--3col">
            <label className="field kh__span-1">
              <span className="field__label">Tên điểm giao *</span>
              <input
                className="input"
                value={form.label}
                placeholder="Trụ sở / Nhà máy Bắc Ninh…"
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                autoFocus
              />
            </label>
            <label className="field kh__span-2">
              <span className="field__label">Địa chỉ *</span>
              <input
                className="input"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </label>
            <label className="field kh__span-1">
              <span className="field__label">SĐT tại điểm giao</span>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </label>
            <label className="field kh__span-2">
              <span className="field__label">Ghi chú giao nhận</span>
              <input
                className="input"
                value={form.note}
                placeholder="Giờ nhận hàng, người nhận, yêu cầu xe…"
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </label>
            <label className="field kh__checkfield kh__span-3" style={{ marginTop: "12px" }}>
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
              />
              <span style={{ fontSize: "13px", color: "var(--ink)" }}>Điểm giao mặc định</span>
            </label>
          </div>
          {formError && <div className="banner banner--error" role="alert">{formError}</div>}
          <div className="kh__dialog-actions">
            <Button variant="ghost" onClick={() => setEditingId(null)}>
              Huỷ
            </Button>
            <Button variant="primary" onClick={save} loading={busy}>
              Lưu
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 && editingId == null ? (
        <div className="kh__empty-panel">
          <MapPin size={36} style={{ color: "var(--ash-2)", opacity: 0.7, marginBottom: "4px" }} />
          <p className="kh__empty-title">Chưa có điểm giao hàng</p>
          <p className="kh__muted">
            Khách thường có nhiều vị trí giao (trụ sở, nhà máy…) — khai để báo giá ghi rõ
            giao ở đâu và sau này tính phí giao hàng theo điểm.
          </p>
          {canUpdate && (
            <Button variant="secondary" onClick={startAdd} style={{ marginTop: "8px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <Plus size={14} /> Thêm điểm giao ngay
            </Button>
          )}
        </div>
      ) : (
        items.length > 0 && (
          <div className="kh__addresses-grid">
            {items.map((a) => (
              <div key={a.id} className="kh__address-card">
                <div className="kh__address-header">
                  <h4 className="kh__address-label">
                    <MapPin size={16} />
                    {a.label}
                    {a.is_default && (
                      <span className="kh__badge kh__badge--moss" style={{ fontSize: "12px", padding: "1px 6px", display: "inline-flex", alignItems: "center", gap: "2px", marginLeft: "6px" }}>
                        <CheckCircle2 size={10} /> Mặc định
                      </span>
                    )}
                  </h4>
                </div>

                <div className="kh__address-body">
                  <p style={{ margin: 0, fontWeight: "var(--fw-medium)" }}>{a.address}</p>
                  {a.phone && (
                    <div className="kh__address-phone">
                      <Phone size={12} />
                      <span>SĐT nhận hàng: {a.phone}</span>
                    </div>
                  )}
                  {a.note && (
                    <div className="address-instructions" title="Ghi chú giao nhận">
                      {a.note}
                    </div>
                  )}
                </div>

                {canUpdate && (
                  <div className="kh__address-actions">
                    <button
                      type="button"
                      className="contact-action-btn"
                      onClick={() => startEdit(a)}
                      title="Sửa thông tin"
                    >
                      <PencilLine size={14} />
                    </button>
                    <button
                      type="button"
                      className="contact-action-btn contact-action-btn--delete"
                      onClick={() => remove(a.id)}
                      title="Xoá địa điểm"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// --- Tài liệu tab (#21: hợp đồng / GPKD / file thiết kế đính kèm hồ sơ) ---------

const DOC_KIND_LABELS: Record<string, string> = {
  hop_dong: "Hợp đồng",
  gpkd: "GPKD",
  thiet_ke: "File thiết kế",
  khac: "Khác",
};

function AttachmentsTab({ customerId }: { customerId: number }) {
  const { token } = useAuth();
  const canUpdate = useCan()("khach_hang", "update");
  const [items, setItems] = useState<CustomerAttachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docKind, setDocKind] = useState("hop_dong");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    if (!token) return;
    api.customers
      .attachments(token, customerId)
      .then((r) => setItems(r.items))
      .catch(() => setError("Không tải được danh sách tài liệu."));
  }, [token, customerId]);

  useEffect(() => {
    setItems(null);
    setError(null);
    reload();
  }, [reload]);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!token || !file) return;
    setUploading(true);
    setError(null);
    try {
      await api.customers.uploadAttachment(token, customerId, file, docKind);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload không thành công.");
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: number) {
    if (!token) return;
    try {
      await api.customers.deleteAttachment(token, customerId, id);
      reload();
    } catch {
      setError("Xóa không thành công.");
    }
  }

  if (error && items == null)
    return <div className="banner banner--error" role="alert">{error}</div>;
  if (items == null) return <TableSkeleton cols={3} />;

  return (
    <div className="kh__histwrap">
      <div className="kh__hist-toolbar">
        <span className="kh__muted">{items.length} tài liệu</span>
        {canUpdate && (
          <div className="kh__upload-row">
            <Select
              ariaLabel="Loại tài liệu"
              value={docKind}
              onChange={(v) => setDocKind(v ?? "khac")}
              options={Object.entries(DOC_KIND_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <input ref={fileRef} type="file" hidden onChange={onPick} />
            <Button
              variant="secondary"
              loading={uploading}
              onClick={() => fileRef.current?.click()}
              style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
            >
              <Plus size={14} /> Tải tài liệu lên
            </Button>
          </div>
        )}
      </div>
      {error && <div className="banner banner--error" role="alert">{error}</div>}

      {items.length === 0 ? (
        <div className="kh__empty-panel">
          <FileText size={36} style={{ color: "var(--ash-2)", opacity: 0.7, marginBottom: "4px" }} />
          <p className="kh__empty-title">Chưa có tài liệu</p>
          <p className="kh__muted">
            Đính kèm hợp đồng, GPKD, file thiết kế, biên bản… để xử lý ngay khi cần, không
            phải đi tìm nơi khác.
          </p>
          {canUpdate && (
            <Button
              variant="secondary"
              loading={uploading}
              onClick={() => fileRef.current?.click()}
              style={{ marginTop: "8px", display: "inline-flex", alignItems: "center", gap: "4px" }}
            >
              <Plus size={14} /> Tải tài liệu lên ngay
            </Button>
          )}
        </div>
      ) : (
        <div className="kh__files-grid">
          {items.map((a) => {
            const iconsMap: Record<string, ReactNode> = {
              hop_dong: <FileText size={18} />,
              gpkd: <ShieldCheck size={18} />,
              thiet_ke: <Image size={18} />,
              khac: <FileText size={18} />,
            };
            return (
              <div key={a.id} className="kh__file-card">
                <div className={`file-icon-box file-icon-box--${a.doc_kind}`} title={DOC_KIND_LABELS[a.doc_kind] ?? a.doc_kind}>
                  {iconsMap[a.doc_kind] || <FileText size={18} />}
                </div>
                <div className="kh__file-info">
                  <a
                    className="kh__file-name"
                    href={a.file_url}
                    target="_blank"
                    rel="noreferrer"
                    title={a.file_name}
                  >
                    {a.file_name}
                  </a>
                  <div className="kh__file-meta">
                    <span>
                      <Calendar size={10} /> {fmtDate(a.uploaded_at)}
                    </span>
                    <span className="kh__badge" style={{ fontSize: "12px", padding: "0 6px" }}>
                      {DOC_KIND_LABELS[a.doc_kind] ?? a.doc_kind}
                    </span>
                  </div>
                </div>
                {canUpdate && (
                  <div className="kh__file-actions">
                    <button
                      type="button"
                      className="contact-action-btn contact-action-btn--delete"
                      onClick={() => remove(a.id)}
                      title="Xoá tài liệu"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Nhập Excel (#23; thay đường CSV cũ 11/09/2026) ----------------------------
//
// Khác đường CSV đã gỡ ở ba điểm, và cả ba đều đổi cách vẽ màn:
//   · CẢ FILE là MỘT giao dịch ⇒ còn một dòng lỗi thì KHÔNG ghi gì. Nút Nhập phải KHOÁ khi còn
//     lỗi, chứ không phải "nhập N dòng hợp lệ, bỏ qua dòng hỏng" như trước.
//   · Xem trước chạy y hệt lượt ghi rồi rollback ⇒ con số ở đây là con số THẬT.
//   · Trùng MST/tên/email là CẢNH BÁO, vẫn ghi — nên tách hẳn khỏi khối lỗi.
//
// Bản 2 (17/09/2026): nhập lại file Xuất Excel — dòng có Mã KH là SỬA khách đó. Sửa là việc ghi
// đè, nên xem trước phải liệt kê từng ô "cũ → mới" trước khi cho bấm Ghi.

function ImportDialog({
  coTheTao,
  onClose,
  onImported,
}: {
  /** Có quyền `create`: mới cho tải mẫu rỗng (endpoint mẫu gác bằng `create`). */
  coTheTao: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const { token } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<NhapExcelOut | null>(null);
  const [result, setResult] = useState<NhapExcelOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function downloadTemplate() {
    if (!token) return;
    try {
      const url = await api.customers.mauExcelBlobUrl(token);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mau-nhap-khach-hang.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      setError("Không tải được file mẫu.");
    }
  }

  async function xemTruoc(f: File) {
    if (!token) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      setPreview(await api.customers.importExcel(token, f, "preview"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không đọc được file.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!token || !file || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.customers.importExcel(token, file, "commit"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nhập không thành công.");
    } finally {
      setBusy(false);
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFileSelected = (selectedFile: File | null) => {
    if (!selectedFile) return;
    setFile(selectedFile);
    setResult(null);
    void xemTruoc(selectedFile);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      handleFileSelected(dropped);
    }
  };

  const clearFile = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const shown = result ?? preview;
  const soGhi = preview ? preview.tao_moi + preview.cap_nhat : 0;

  const step1Done = Boolean(file);
  const step2Done = Boolean(file && preview);
  const step3Done = Boolean(result);

  const step1Status = step1Done ? "kh__im-step--done" : "kh__im-step--active";
  const step2Status = step2Done
    ? "kh__im-step--done"
    : file
      ? "kh__im-step--active"
      : "";
  const step3Status = step3Done
    ? "kh__im-step--done"
    : preview
      ? "kh__im-step--active"
      : "";

  return (
    <div className="kh__overlay kh__overlay--blur" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="kh__dialog kh__dialog--import card"
        role="dialog"
        aria-modal="true"
        aria-label="Nhập danh bạ khách hàng từ Excel"
      >
        {/* Header */}
        <div className="kh__im-head">
          <div className="kh__im-head-left">
            <div className="kh__im-head-icon" aria-hidden="true">
              <FileSpreadsheet size={24} strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="kh__im-title">Nhập danh bạ khách hàng</h2>
              <p className="kh__im-subtitle">
                Nhập dữ liệu khách hàng từ file bảng tính Excel (.xlsx)
              </p>
            </div>
          </div>
          <button
            type="button"
            className="kh__im-close"
            aria-label="Đóng"
            onClick={onClose}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div className="kh__im-body">
          {result != null ? (
            <div className="kh__im-success">
              <div className="kh__im-success-icon-wrap">
                <CheckCircle2 size={46} className="kh__im-success-icon" strokeWidth={2.2} />
              </div>
              <h3 className="kh__im-success-title">Nhập danh bạ thành công!</h3>
              <p className="kh__im-success-desc">
                Đã thêm <strong>{result.tao_moi} khách hàng mới</strong> và sửa{" "}
                <strong>{result.cap_nhat} khách hàng</strong> từ tệp Excel.
              </p>

              <div className="kh__im-success-stats">
                <div className="kh__im-success-stat kh__im-success-stat--highlight">
                  <span className="kh__im-success-stat-val">{result.tao_moi}</span>
                  <span className="kh__im-success-stat-lbl">Thêm mới</span>
                </div>
                <div className="kh__im-success-stat kh__im-success-stat--diff">
                  <span className="kh__im-success-stat-val">{result.cap_nhat}</span>
                  <span className="kh__im-success-stat-lbl">Đã sửa</span>
                </div>
                <div className="kh__im-success-stat">
                  <span className="kh__im-success-stat-val">{result.khong_doi}</span>
                  <span className="kh__im-success-stat-lbl">Không đổi</span>
                </div>
                {result.canh_bao.length > 0 && (
                  <div className="kh__im-success-stat kh__im-success-stat--warn">
                    <span className="kh__im-success-stat-val">{result.canh_bao.length}</span>
                    <span className="kh__im-success-stat-lbl">Cảnh báo (đã ghi)</span>
                  </div>
                )}
              </div>

              {result.bo_qua_tai_chinh && (
                <div className="kh__im-alert kh__im-alert--warn">
                  <AlertTriangle size={18} className="kh__im-alert-icon" />
                  <div>
                    <div className="kh__im-alert-title">Lưu ý phân quyền tài chính</div>
                    <div className="kh__im-alert-text">
                      Đã bỏ qua các cột chính sách tài chính do bạn không có quyền Đặt hạn mức công nợ. Phần còn lại đã được ghi thành công.
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Step indicator */}
              <div className="kh__im-steps">
                <div className={`kh__im-step ${step1Status}`}>
                  <div className="kh__im-step-bubble">
                    {step1Done ? <Check size={14} strokeWidth={2.5} /> : "1"}
                  </div>
                  <div className="kh__im-step-info">
                    <div className="kh__im-step-title">Chuẩn bị file</div>
                    <div className="kh__im-step-desc">File mẫu hoặc file Xuất Excel</div>
                  </div>
                </div>
                <div className="kh__im-step-divider" />
                <div className={`kh__im-step ${step2Status}`}>
                  <div className="kh__im-step-bubble">
                    {step2Done ? <Check size={14} strokeWidth={2.5} /> : "2"}
                  </div>
                  <div className="kh__im-step-info">
                    <div className="kh__im-step-title">Tải file lên</div>
                    <div className="kh__im-step-desc">
                      {file ? file.name : "Kéo thả hoặc chọn tệp"}
                    </div>
                  </div>
                </div>
                <div className="kh__im-step-divider" />
                <div className={`kh__im-step ${step3Status}`}>
                  <div className="kh__im-step-bubble">
                    {step3Done ? <Check size={14} strokeWidth={2.5} /> : "3"}
                  </div>
                  <div className="kh__im-step-info">
                    <div className="kh__im-step-title">Kiểm tra & Nhập</div>
                    <div className="kh__im-step-desc">
                      {preview
                        ? preview.hop_le
                          ? "Dữ liệu hợp lệ"
                          : `${preview.loi.length} dòng lỗi`
                        : "Đối soát dữ liệu"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 1 banner: hai loại file nhận được */}
              <div className="kh__im-template-banner">
                <div className="kh__im-template-left">
                  <div className="kh__im-template-title">Dùng file nào?</div>
                  <div className="kh__im-template-desc">
                    {coTheTao && (
                      <>
                        <strong>Thêm khách mới:</strong> tải file mẫu, mỗi dòng một khách mới (mã do hệ thống cấp).
                        <br />
                      </>
                    )}
                    <strong>Sửa khách đã có:</strong> bấm <strong>Xuất Excel</strong> ở màn Khách hàng, sửa trong
                    Excel rồi nhập lại file đó. Dòng có Mã KH là sửa khách đó, thêm dòng để trống Mã KH là khách mới.
                  </div>
                </div>
                {coTheTao && (
                  <button
                    type="button"
                    className="kh__im-template-btn"
                    onClick={downloadTemplate}
                  >
                    <Download size={15} strokeWidth={2} />
                    <span>Tải file mẫu Excel (.xlsx)</span>
                  </button>
                )}
              </div>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  handleFileSelected(f);
                }}
              />

              {/* Step 2: Dropzone or File Card */}
              {!file ? (
                <div
                  className={`kh__im-dropzone ${isDragging ? "kh__im-dropzone--dragging" : ""}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInputRef.current?.click()}
                >
                  <div className="kh__im-dropzone-icon">
                    <UploadCloud size={30} strokeWidth={1.8} />
                  </div>
                  <div className="kh__im-dropzone-main">
                    Kéo & thả file Excel vào đây,<span className="kh__im-dropzone-browse"> hoặc click để chọn tệp</span>
                  </div>
                  <div className="kh__im-dropzone-hint">
                    Chỉ hỗ trợ file <strong>.xlsx</strong> • Cả file là 1 giao dịch (All-or-nothing)
                  </div>
                </div>
              ) : (
                <div className="kh__im-filecard">
                  <div className="kh__im-filecard-left">
                    <div className="kh__im-filecard-icon">
                      <FileSpreadsheet size={24} strokeWidth={1.8} />
                    </div>
                    <div className="kh__im-filecard-meta">
                      <div className="kh__im-filecard-name-row">
                        <span className="kh__im-filecard-name" title={file.name}>
                          {file.name}
                        </span>
                        <span className="kh__im-filecard-ext">.XLSX</span>
                      </div>
                      <div className="kh__im-filecard-sub">
                        <span className="kh__im-filecard-size">{formatFileSize(file.size)}</span>
                        <span className="kh__im-filecard-sep">•</span>
                        {busy ? (
                          <span className="kh__im-filecard-status kh__im-filecard-status--busy">
                            <Loader2 size={13} className="kh__spin" />
                            Đang đọc & kiểm tra dữ liệu...
                          </span>
                        ) : preview ? (
                          preview.hop_le ? (
                            <span className="kh__im-filecard-status kh__im-filecard-status--ok">
                              <CheckCircle2 size={13} />
                              Sẵn sàng ghi ({preview.tong_dong} dòng)
                            </span>
                          ) : (
                            <span className="kh__im-filecard-status kh__im-filecard-status--err">
                              <AlertCircle size={13} />
                              {preview.loi.length} dòng lỗi
                            </span>
                          )
                        ) : (
                          <span className="kh__im-filecard-status">Đã nạp tệp</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="kh__im-filecard-actions">
                    <button
                      type="button"
                      className="kh__im-btn-change"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy}
                    >
                      Đổi file khác
                    </button>
                    <button
                      type="button"
                      className="kh__im-btn-remove"
                      onClick={clearFile}
                      disabled={busy}
                      title="Xoá file"
                      aria-label="Xoá file"
                    >
                      <Trash2 size={15} strokeWidth={1.8} />
                    </button>
                  </div>
                </div>
              )}

              {/* Global Error Banner */}
              {error && (
                <div className="kh__im-alert kh__im-alert--error" role="alert">
                  <AlertCircle size={18} className="kh__im-alert-icon" />
                  <div>
                    <div className="kh__im-alert-title">Lỗi xử lý file</div>
                    <div className="kh__im-alert-text">{error}</div>
                  </div>
                </div>
              )}

              {/* Step 3: Preview results & Metrics */}
              {shown && (
                <div className="kh__im-validation">
                  {/* Metric Cards Grid */}
                  <div className="kh__im-metrics">
                    <div className={`kh__im-metric-card ${shown.hop_le && shown.tao_moi > 0 ? "kh__im-metric-card--success" : ""}`}>
                      <div className="kh__im-metric-icon kh__im-metric-icon--success">
                        <UserPlus size={18} strokeWidth={2} />
                      </div>
                      <div className="kh__im-metric-body">
                        <div className="kh__im-metric-val">{shown.tao_moi}</div>
                        <div className="kh__im-metric-lbl">Thêm mới</div>
                      </div>
                    </div>

                    <div className={`kh__im-metric-card ${shown.hop_le && shown.cap_nhat > 0 ? "kh__im-metric-card--diff" : ""}`}>
                      <div className="kh__im-metric-icon kh__im-metric-icon--diff">
                        <PencilLine size={18} strokeWidth={2} />
                      </div>
                      <div className="kh__im-metric-body">
                        <div className="kh__im-metric-val">{shown.cap_nhat}</div>
                        <div className="kh__im-metric-lbl">Sửa · {shown.khong_doi} không đổi</div>
                      </div>
                    </div>

                    <div className={`kh__im-metric-card ${shown.loi.length > 0 ? "kh__im-metric-card--error" : ""}`}>
                      <div className="kh__im-metric-icon kh__im-metric-icon--error">
                        <AlertCircle size={18} strokeWidth={2} />
                      </div>
                      <div className="kh__im-metric-body">
                        <div className="kh__im-metric-val">{shown.loi.length}</div>
                        <div className="kh__im-metric-lbl">Dòng lỗi</div>
                      </div>
                    </div>

                    <div className={`kh__im-metric-card ${shown.canh_bao.length > 0 ? "kh__im-metric-card--warn" : ""}`}>
                      <div className="kh__im-metric-icon kh__im-metric-icon--warn">
                        <AlertTriangle size={18} strokeWidth={2} />
                      </div>
                      <div className="kh__im-metric-body">
                        <div className="kh__im-metric-val">{shown.canh_bao.length}</div>
                        <div className="kh__im-metric-lbl">Cảnh báo</div>
                      </div>
                    </div>
                  </div>

                  {/* Summary Alert */}
                  {shown.hop_le && shown.tao_moi + shown.cap_nhat === 0 ? (
                    <div className="kh__im-alert kh__im-alert--success" role="status">
                      <CheckCircle2 size={20} className="kh__im-alert-icon" />
                      <div>
                        <div className="kh__im-alert-title">Không có gì thay đổi</div>
                        <div className="kh__im-alert-text">
                          Đã đối soát <strong>{shown.tong_dong} dòng</strong>: file khớp y hệt dữ liệu đang có, không có khách
                          mới và không có ô nào bị sửa.
                        </div>
                      </div>
                    </div>
                  ) : shown.hop_le ? (
                    <div className="kh__im-alert kh__im-alert--success" role="status">
                      <CheckCircle2 size={20} className="kh__im-alert-icon" />
                      <div>
                        <div className="kh__im-alert-title">Toàn bộ dữ liệu hợp lệ!</div>
                        <div className="kh__im-alert-text">
                          Đã đối soát <strong>{shown.tong_dong} dòng</strong>: thêm <strong>{shown.tao_moi} khách mới</strong>,
                          sửa <strong>{shown.cap_nhat} khách</strong>, {shown.khong_doi} khách không đổi. Kiểm tra bảng thay
                          đổi bên dưới rồi nhấn <strong>"Xác nhận nhập"</strong>.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="kh__im-alert kh__im-alert--error" role="status">
                      <AlertCircle size={20} className="kh__im-alert-icon" />
                      <div>
                        <div className="kh__im-alert-title">
                          Phát hiện {shown.loi.length} dòng lỗi trong file!
                        </div>
                        <div className="kh__im-alert-text">
                          Quy tắc an toàn: <strong>Cả file là 1 giao dịch (All-or-nothing)</strong>. Toàn bộ file sẽ không
                          được ghi cho đến khi bạn sửa xong các dòng lỗi này trong Excel.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Financial Policy Note */}
                  {shown.bo_qua_tai_chinh && (
                    <div className="kh__im-alert kh__im-alert--warn" role="status">
                      <AlertTriangle size={18} className="kh__im-alert-icon" />
                      <div>
                        <div className="kh__im-alert-title">Lưu ý phân quyền tài chính</div>
                        <div className="kh__im-alert-text">
                          Đã bỏ qua các cột chính sách tài chính — bạn không có quyền Đặt hạn mức công nợ. Phần còn lại vẫn được ghi bình thường.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Change Table — sửa là ghi đè, nên phải thấy "cũ → mới" trước khi bấm Ghi */}
                  {shown.thay_doi.length > 0 && (
                    <div className="kh__im-table-card kh__im-table-card--diff">
                      <div className="kh__im-table-head">
                        <div className="kh__im-table-title">
                          <PencilLine size={15} />
                          <span>
                            Thay đổi trên khách đã có ({new Set(shown.thay_doi.map((t) => t.ma)).size} khách)
                          </span>
                        </div>
                        <span className="kh__im-table-tag kh__im-table-tag--diff">Ghi đè</span>
                      </div>
                      <div className="kh__im-table-wrap">
                        <table className="kh__im-table">
                          <thead>
                            <tr>
                              {/* Dialog rộng tối đa 760px: nhường chỗ cho cột "Cũ → Mới" (địa chỉ dài). */}
                              <th style={{ width: "70px" }}>Dòng</th>
                              <th style={{ width: "165px" }}>Khách</th>
                              <th style={{ width: "105px" }}>Cột</th>
                              <th>Cũ → Mới</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shown.thay_doi.map((t, i) => (
                              <tr key={`td-${t.dong}-${i}`}>
                                <td>
                                  <span className="kh__im-row-badge kh__im-row-badge--diff">#{t.dong}</span>
                                </td>
                                <td className="kh__im-reason">
                                  <strong>{t.ma}</strong> · {t.ten}
                                </td>
                                <td className="kh__im-col-name">{t.cot}</td>
                                <td className="kh__im-reason">
                                  <span className="kh__im-diff-old">{t.cu || "(trống)"}</span>
                                  <span className="kh__im-diff-arrow" aria-hidden="true"> → </span>
                                  <span className="kh__im-diff-new">{t.moi || "(trống)"}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Error Table */}
                  {shown.loi.length > 0 && (
                    <div className="kh__im-table-card kh__im-table-card--error">
                      <div className="kh__im-table-head">
                        <div className="kh__im-table-title">
                          <AlertCircle size={15} />
                          <span>Chi tiết các dòng bị lỗi ({shown.loi.length} dòng)</span>
                        </div>
                        <span className="kh__im-table-tag">Bắt buộc sửa</span>
                      </div>
                      <div className="kh__im-table-wrap">
                        <table className="kh__im-table">
                          <thead>
                            <tr>
                              <th style={{ width: "95px" }}>Dòng Excel</th>
                              <th style={{ width: "160px" }}>Cột</th>
                              <th>Lý do vi phạm</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shown.loi.map((r, i) => (
                              <tr key={`loi-${r.dong}-${i}`}>
                                <td>
                                  <span className="kh__im-row-badge kh__im-row-badge--err">
                                    #{r.dong}
                                  </span>
                                </td>
                                <td className="kh__im-col-name">{r.cot || "—"}</td>
                                <td className="kh__im-reason">{r.ly_do}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Duplicate Warnings Table */}
                  {shown.canh_bao.length > 0 && (
                    <div className="kh__im-table-card kh__im-table-card--warn">
                      <div className="kh__im-table-head">
                        <div className="kh__im-table-title">
                          <AlertTriangle size={15} />
                          <span>Cảnh báo ({shown.canh_bao.length} dòng)</span>
                        </div>
                        <span className="kh__im-table-tag kh__im-table-tag--soft">Vẫn cho phép nhập</span>
                      </div>
                      <div className="kh__im-table-wrap">
                        <table className="kh__im-table">
                          <thead>
                            <tr>
                              <th style={{ width: "95px" }}>Dòng Excel</th>
                              <th>Nội dung cảnh báo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shown.canh_bao.map((r, i) => (
                              <tr key={`cb-${r.dong}-${i}`}>
                                <td>
                                  <span className="kh__im-row-badge kh__im-row-badge--warn">
                                    #{r.dong}
                                  </span>
                                </td>
                                <td className="kh__im-reason">{r.ly_do}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="kh__im-foot">
          {result ? (
            <div className="kh__im-foot-success">
              <Button variant="primary" onClick={onImported} className="kh__im-btn-finish">
                <span>Hoàn tất & xem danh sách</span>
                <ArrowRight size={16} />
              </Button>
            </div>
          ) : (
            <div className="kh__im-foot-default">
              <div className="kh__im-foot-hint">
                {!file
                  ? "Vui lòng chọn hoặc kéo thả file Excel để tiếp tục."
                  : busy
                    ? "Đang phân tích và đối soát dữ liệu file..."
                    : preview && !preview.hop_le
                      ? "Vui lòng sửa hết lỗi trước khi xác nhận nhập."
                      : preview && preview.hop_le && soGhi === 0
                      ? "File không có gì thay đổi so với dữ liệu đang có."
                      : preview && preview.hop_le
                        ? "Dữ liệu hợp lệ, sẵn sàng ghi vào hệ thống."
                        : ""}
              </div>
              <div className="kh__im-foot-btns">
                <Button variant="ghost" onClick={onClose} disabled={busy}>
                  Huỷ
                </Button>
                <Button
                  variant="primary"
                  onClick={commit}
                  loading={busy}
                  /* Cả file là một giao dịch: còn lỗi thì không có gì để ghi. */
                  disabled={!file || !preview || !preview.hop_le || preview.loi.length > 0 || soGhi === 0}
                >
                  <Check size={15} />
                  <span>
                    {preview?.hop_le && soGhi > 0
                      ? `Xác nhận nhập (thêm ${preview.tao_moi} · sửa ${preview.cap_nhat})`
                      : "Xác nhận nhập"}
                  </span>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <table className="kh__table kh__table--tight">
      <tbody>
        {[...Array(4)].map((_, i) => (
          <tr key={i} className="kh__skelrow">
            {[...Array(cols)].map((__, j) => (
              <td key={j}>
                <span className="kh__skel" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// =============================================================================
// Create / edit dialog (chọn NV từ picker, validation, MST soft-dup warn)
// =============================================================================

function CustomerFormDialog({
  title,
  customerId,
  isEdit,
  initial,
  sales,
  onClose,
  onSaved,
}: {
  title: string;
  customerId?: number;
  isEdit: boolean;
  initial: FormState;
  sales: SaleOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  // Đổi NV phụ trách của KH ĐANG CÓ = quyền chi tiết `reassign` (backend cũng chặn) —
  // thiếu quyền thì khóa picker khi Sửa; khi Tạo mới vẫn chọn được (gán lần đầu).
  const can = useCan();
  const canReassign = can("khach_hang", "reassign");
  // Redesign spec-06 v2: form chỉ ĐỊNH DANH; tài chính sửa ở detail. Người phụ trách mặc định
  // chính mình — khóa picker (kể cả khi Tạo) nếu không có quyền điều chuyển (chỉ quản lý mới
  // gán cấp dưới). Đổi Loại → ẩn/hiện MST.
  const saleLocked = !canReassign;
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  // Cảnh báo trùng MỀM sau khi lưu (#15: MST + tên cty + email — không chặn).
  const [savedWarns, setSavedWarns] = useState<DuplicateWarn[] | null>(null);
  // Check trùng tức thời khi rời ô nhập (#8) — chỉ là gợi ý, không chặn Lưu.
  const [liveWarns, setLiveWarns] = useState<DuplicateWarn[]>([]);
  // Tra cứu tự động tên & địa chỉ công ty theo MST (VietQR public tax API)
  const [fetchingTax, setFetchingTax] = useState(false);
  const [taxLookupNote, setTaxLookupNote] = useState<string | null>(null);

  async function handleTaxLookup(overrideCode?: string) {
    const code = (overrideCode ?? form.tax_code).trim();
    if (!code || code.length < 10) {
      setErrors((e) => ({ ...e, tax_code: "Nhập MST 10 hoặc 13 số để tra cứu." }));
      return;
    }
    setFetchingTax(true);
    setTaxLookupNote(null);
    try {
      const res = await fetch(`https://api.vietqr.io/v2/business/${code}`);
      const json = await res.json();
      if (json.code === "00" && json.data) {
        const { name, address } = json.data;
        setForm((f) => ({
          ...f,
          name: name ? name : f.name,
          address: address ? address : f.address,
        }));
        setTaxLookupNote(`✓ Đã tra cứu thành công: ${name}`);
        setErrors((e) => ({ ...e, name: undefined, tax_code: undefined }));
        liveCheck();
      } else {
        setTaxLookupNote(json.desc || "Không tìm thấy dữ liệu doanh nghiệp từ MST này.");
      }
    } catch {
      setTaxLookupNote("Không kết nối được dịch vụ tra cứu MST. Vui lòng tự điền Tên & Địa chỉ.");
    } finally {
      setFetchingTax(false);
    }
  }

  async function liveCheck() {
    if (!token) return;
    const tax = form.tax_code.trim();
    const name = form.name.trim();
    const email = form.email.trim();
    if (!tax && !name && !email) {
      setLiveWarns([]);
      return;
    }
    try {
      const warns = await api.customers.checkDuplicate(token, {
        tax_code: tax || undefined,
        name: name || undefined,
        email: email || undefined,
        exclude_id: customerId,
      });
      setLiveWarns(warns);
    } catch {
      setLiveWarns([]); // gợi ý thôi — lỗi mạng thì im lặng
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setServerError(null);
  }

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) next.name = "Tên khách hàng là bắt buộc.";
    // MST chỉ áp cho công ty; nếu có nhập thì phải đúng định dạng (khách lẻ không cần MST).
    if (form.customer_kind === "cong_ty" && form.tax_code.trim() && !MST_RE.test(form.tax_code.trim()))
      next.tax_code = "MST phải gồm 10 hoặc 13 chữ số.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || saving) return;
    if (!validate()) return;
    setSaving(true);
    setServerError(null);
    const input: CustomerInput = {
      name: form.name.trim(),
      customer_kind: form.customer_kind,
      // Cá nhân → không gửi MST (ẩn).
      tax_code: form.customer_kind === "cong_ty" ? form.tax_code.trim() || null : null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      sale_user_id: form.sale_user_id ? Number(form.sale_user_id) : null,
    };
    try {
      const res =
        isEdit && customerId != null
          ? await api.customers.update(token, customerId, input)
          : await api.customers.create(token, input);
      if (res.duplicates.length > 0) {
        setSavedWarns(res.duplicates);
        setSaving(false);
        return;
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.isForbidden)
        setServerError("Bạn không có quyền thực hiện thao tác này.");
      else if (err instanceof ApiError && err.status === 422) setServerError(err.message);
      else setServerError("Lưu không thành công. Vui lòng thử lại.");
      setSaving(false);
    }
  }

  return (
    <div className="kh__overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="kh__dialog card kh__dialog--hero" role="dialog" aria-modal="true" aria-label={title}>
        {/* Sleek Minimalist Header */}
        <div className="kh__dialog-head kh__dialog-head--hero">
          <div className="kh__dialog-title-wrap">
            <h2 className="kh__dialog-title">{title}</h2>
            <span className="kh__dialog-kind-chip">
              {form.customer_kind === "cong_ty" ? "Doanh nghiệp" : "Cá nhân"}
            </span>
          </div>
          <button type="button" className="kh__close" aria-label="Đóng" onClick={onClose}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {savedWarns ? (
          <div className="kh__dialog-body">
            <div className="banner banner--warn" role="alert">
              <div>
                <p>Đã lưu. Lưu ý trùng thông tin (cảnh báo mềm, không chặn):</p>
                <ul className="kh__dup-list">
                  {savedWarns.map((w) => (
                    <li key={`${w.field}-${w.id}`}>
                      Trùng <strong>{DUP_FIELD_LABELS[w.field]}</strong> với khách{" "}
                      <strong>
                        {w.code} · {w.name}
                      </strong>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="kh__dialog-actions">
              <Button variant="primary" onClick={onSaved}>
                Đã hiểu, tiếp tục
              </Button>
            </div>
          </div>
        ) : (
          <form className="kh__dialog-body" onSubmit={onSubmit}>
            <div className="kh__form-grid kh__form-grid--2col">
              {/* Hàng 1: Tên khách hàng (Left) & MST + Tra cứu (Right) */}
              <label className="field">
                <span className="field__label">
                  {form.customer_kind === "cong_ty" ? "Tên công ty / Tên khách hàng *" : "Họ và tên khách hàng *"}
                </span>
                <input
                  className="input"
                  placeholder={form.customer_kind === "cong_ty" ? "VD: Công ty TNHH Bao bì An Phát" : "VD: Nguyễn Văn A"}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  onBlur={liveCheck}
                  aria-invalid={!!errors.name}
                  autoFocus
                />
                {errors.name && <span className="kh__err" role="alert">{errors.name}</span>}
              </label>

              {form.customer_kind === "cong_ty" ? (
                <label className="field">
                  <div className="kh__field-label-bar">
                    <span className="field__label">Mã số thuế (MST)</span>
                    <button
                      type="button"
                      className="kh__tax-lookup-btn"
                      disabled={fetchingTax || !form.tax_code.trim()}
                      title="Tự động tra cứu Tên công ty & Địa chỉ từ dữ liệu Thuế công khai"
                      onClick={() => handleTaxLookup()}
                    >
                      {fetchingTax && <Loader2 size={12} className="kh__spin" />}
                      <span>{fetchingTax ? "Đang tra cứu…" : "Tra cứu MST"}</span>
                    </button>
                  </div>
                  <input
                    className="input"
                    placeholder="10 hoặc 13 chữ số MST (VD: 0101234567)"
                    value={form.tax_code}
                    onChange={(e) => set("tax_code", e.target.value)}
                    onBlur={() => {
                      liveCheck();
                      if (form.tax_code.trim().length >= 10 && !form.name.trim()) {
                        handleTaxLookup();
                      }
                    }}
                    aria-invalid={!!errors.tax_code}
                  />
                  {errors.tax_code && <span className="kh__err" role="alert">{errors.tax_code}</span>}
                  {taxLookupNote && (
                    <span className={`kh__tax-note${taxLookupNote.startsWith("✓") ? " is-success" : " is-warn"}`}>
                      {taxLookupNote}
                    </span>
                  )}
                </label>
              ) : (
                <label className="field">
                  <span className="field__label">Mã số thuế (nếu có)</span>
                  <input
                    className="input"
                    placeholder="Không bắt buộc đối với khách lẻ"
                    value={form.tax_code}
                    onChange={(e) => set("tax_code", e.target.value)}
                  />
                </label>
              )}

              {/* Hàng 2: Loại khách hàng (Left) & NV phụ trách (Right) */}
              <label className="field">
                <span className="field__label">Loại khách hàng</span>
                <div className="kh__seg" role="radiogroup" aria-label="Loại khách hàng">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.customer_kind === "cong_ty"}
                    className={`kh__seg-btn${form.customer_kind === "cong_ty" ? " is-active" : ""}`}
                    onClick={() => setForm((s) => ({ ...s, customer_kind: "cong_ty" }))}
                  >
                    Công ty
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.customer_kind === "ca_nhan"}
                    className={`kh__seg-btn${form.customer_kind === "ca_nhan" ? " is-active" : ""}`}
                    onClick={() => setForm((s) => ({ ...s, customer_kind: "ca_nhan" }))}
                  >
                    Cá nhân
                  </button>
                </div>
              </label>

              <label className="field">
                <span className="field__label">NV phụ trách</span>
                <Select
                  ariaLabel="NV phụ trách"
                  portal
                  align="right"
                  disabled={saleLocked}
                  value={form.sale_user_id}
                  placeholder="— Mặc định (tôi) —"
                  onChange={(v) => set("sale_user_id", v ?? "")}
                  options={[
                    { value: "", label: "— Mặc định (tôi) —" },
                    ...sales
                      .filter((s) => s.co_the_gan !== false)
                      .map((s) => ({
                        value: String(s.id),
                        label: s.name,
                        sub: moTaSale(s),
                      })),
                  ]}
                />

              </label>

              {/* Hàng 3: Địa chỉ (Left) & Email (Right) */}
              <label className="field">
                <span className="field__label">
                  {form.customer_kind === "cong_ty" ? "Địa chỉ đăng ký thuế / xuất hóa đơn" : "Địa chỉ giao hàng / liên hệ"}
                </span>
                <input
                  className="input"
                  placeholder="Địa chỉ ghi trên hóa đơn tài chính…"
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                />
              </label>

              <label className="field">
                <span className="field__label">Email nhận hóa đơn điện tử</span>
                <input
                  className="input"
                  type="email"
                  placeholder="email@doanhnghiep.com"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  onBlur={liveCheck}
                />
              </label>
            </div>

            {liveWarns.length > 0 && (
              <div className="banner banner--warn" role="status">
                <div>
                  <p>Có thể trùng khách đã có (không chặn lưu):</p>
                  <ul className="kh__dup-list">
                    {liveWarns.map((w) => (
                      <li key={`${w.field}-${w.id}`}>
                        Trùng <strong>{DUP_FIELD_LABELS[w.field]}</strong> với{" "}
                        <strong>
                          {w.code} · {w.name}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {serverError && (
              <div className="banner banner--error" role="alert">
                {serverError}
              </div>
            )}

            <div className="kh__dialog-actions">
              <Button type="button" variant="ghost" onClick={onClose}>
                Huỷ <kbd className="kh__kbd">Esc</kbd>
              </Button>
              <Button type="submit" variant="primary" loading={saving}>
                {isEdit ? "Cập nhật khách hàng" : "Tạo khách hàng"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
