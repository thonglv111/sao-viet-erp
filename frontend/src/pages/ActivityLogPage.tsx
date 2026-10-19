import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Calendar,
  ShieldCheck,
  Clock,
  Search,
  Filter,
  RefreshCw,
  List,
  Building,
  User,
  ArrowRight,
  Tag,
  Copy,
  Check,
  RotateCcw,
  Eye,
  EyeOff,
  X,
  FileText,
  Download,
  Wallet,
  Package,
  ShoppingCart,
  Factory,
  BookOpen,
  MonitorSmartphone,
  ArrowUpCircle,
  Laptop,
  Smartphone,
  Tablet,
  Globe,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  ApiError,
  api,
  type AuditFacets,
  type AuditPage,
  type AuditQuery,
  type AuditRow,
} from "../api/client";
import { useAuth } from "../auth/useAuth";
import { useCan } from "../auth/permissions";
import type { NavigateFn } from "../components/AppShell";
import { PhanTrangDayDu } from "../components/PhanTrangDayDu";
import { laDienThoai } from "../utils/dienThoai";
import { ngayDeDoc } from "../utils/ky";
import {
  LOC_NK_TRONG, MOC_NK, dieuKienNhatKy, kyNhatKyMacDinh, locNKLenUrl, locNKTuUrl, maHanhDong,
  thamSoKyNK, type LocManNhatKy,
} from "./dieu-kien-nhat-ky";
import { khoangKy } from "./thanh-loc/ky-danh-sach";
import { ThanhLoc } from "./thanh-loc/ThanhLoc";
import { useLocMan } from "./thanh-loc/useLocMan";
import "./activity.css";

/* Nhãn hành động, nhóm và khoá quyền của từng mã ĐỀU do máy chủ trả về (`app/audit_registry.py`).
   Trước 25/09/2026 màn này tự khai một bảng 16 mã trong khi backend ghi gần 300 — 93% dòng hiện
   nhãn title-case tên cột ("Employee Create Account") giữa một giao diện tiếng Việt, và bốn chip
   nhóm đều đếm 0 vì mã lạ rơi vào nhóm "khác" mà màn không render tab nào cho nó.
   Ở đây chỉ còn phần TRÌNH BÀY: mỗi nhóm một icon + một màu. */
const ICON_NHOM: Record<string, { icon: typeof Activity; badge: string }> = {
  kinh_doanh: { icon: ShoppingCart, badge: "badge--blue" },
  san_xuat: { icon: Factory, badge: "badge--purple" },
  kho: { icon: Package, badge: "badge--amber" },
  mua_hang: { icon: ShoppingCart, badge: "badge--teal" },
  ke_toan: { icon: Wallet, badge: "badge--green" },
  nhan_su: { icon: User, badge: "badge--indigo" },
  luong: { icon: Wallet, badge: "badge--rose" },
  danh_muc: { icon: BookOpen, badge: "badge--slate" },
  he_thong: { icon: ShieldCheck, badge: "badge--red" },
  khac: { icon: Tag, badge: "badge--slate" },
};

function trinhBay(nhom: string) {
  return ICON_NHOM[nhom] ?? ICON_NHOM.khac;
}

/* --- Ngày giờ ------------------------------------------------------------------------------ */

function ngayISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function formatExactTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const now = new Date();
  const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);

  if (diffSec < 45) return "Vừa xong";
  if (diffMin < 60) return `${diffMin} phút trước`;
  if (diffHours < 24 && now.getDate() === d.getDate()) {
    return `Hôm nay ${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (yesterday.getDate() === d.getDate() && yesterday.getMonth() === d.getMonth()) {
    return `Hôm qua ${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
  }

  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

function getDateGroupLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Khác";

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const weekStart = todayStart - 6 * 86400000;

  const time = d.getTime();
  if (time >= todayStart) return "Hôm nay";
  if (time >= yesterdayStart) return "Hôm qua";
  if (time >= weekStart) return "7 ngày qua";

  return d.toLocaleDateString("vi-VN", { month: "long", year: "numeric" });
}

function getUserInitials(name: string | null): string {
  if (!name || name.trim() === "") return "HT";
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface ParsedUA {
  browser: string;
  browserVer?: string;
  os: string;
  deviceType: "desktop" | "mobile" | "tablet";
  raw: string;
}

export function parseUserAgent(ua: string | null): ParsedUA | null {
  if (!ua) return null;

  let browser = "Trình duyệt khác";
  let browserVer = "";
  let os = "Hệ điều hành khác";
  let deviceType: "desktop" | "mobile" | "tablet" = "desktop";

  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) {
    deviceType = "tablet";
  } else if (/Mobile|iPhone|Android/i.test(ua)) {
    deviceType = "mobile";
  }

  if (/Windows NT 10/i.test(ua)) os = "Windows 10/11";
  else if (/Windows NT 6\.3/i.test(ua)) os = "Windows 8.1";
  else if (/Windows NT 6\.1/i.test(ua)) os = "Windows 7";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X/i.test(ua)) {
    const macMatch = ua.match(/Mac OS X ([\d_]+)/);
    os = macMatch ? `macOS ${macMatch[1].replace(/_/g, ".")}` : "macOS";
  } else if (/Android/i.test(ua)) {
    const andMatch = ua.match(/Android ([\d.]+)/);
    os = andMatch ? `Android ${andMatch[1]}` : "Android";
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    const iosMatch = ua.match(/OS ([\d_]+)/);
    os = iosMatch ? `iOS ${iosMatch[1].replace(/_/g, ".")}` : "iOS";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  }

  const edgMatch = ua.match(/Edg\/([\d.]+)/);
  const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
  const firefoxMatch = ua.match(/Firefox\/([\d.]+)/);
  const safariMatch = ua.match(/Version\/([\d.]+).*Safari/);

  if (edgMatch) {
    browser = "Edge";
    browserVer = edgMatch[1].split(".")[0];
  } else if (chromeMatch) {
    browser = "Chrome";
    browserVer = chromeMatch[1].split(".")[0];
  } else if (firefoxMatch) {
    browser = "Firefox";
    browserVer = firefoxMatch[1].split(".")[0];
  } else if (safariMatch) {
    browser = "Safari";
    browserVer = safariMatch[1].split(".")[0];
  }

  return { browser, browserVer, os, deviceType, raw: ua };
}

/* --- Nội dung dòng ------------------------------------------------------------------------- */

function FormattedDetail({ detail }: { detail: string | null }) {
  const [copiedText, setCopiedText] = useState<string | null>(null);

  if (!detail) return <span className="act-muted">—</span>;

  const handleCopy = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 1800);
  };

  if (detail.includes("→")) {
    const parts = detail.split("→");
    return (
      <span className="act-detail__highlighted">
        <span className="act-detail__text">{parts[0].trim()}</span>
        <ArrowRight size={12} className="act-detail__arrow" />
        <span className="act-detail__status-tag">{parts.slice(1).join("→").trim()}</span>
      </span>
    );
  }

  const lsxMatch = detail.match(/LSX\d+[-\w]*/i);
  if (lsxMatch) {
    const code = lsxMatch[0];
    const parts = detail.split(code);
    return (
      <span className="act-detail__inline-flex">
        {parts[0]}
        <span
          className="act-detail__code-tag"
          onClick={(e) => handleCopy(code, e)}
          title="Click để copy mã LSX"
        >
          {code}
          {copiedText === code ? (
            <Check size={10} className="act-copy-icon act-copy-icon--success" />
          ) : (
            <Copy size={10} className="act-copy-icon" />
          )}
        </span>
        {parts.slice(1).join(code)}
      </span>
    );
  }

  return <span className="act-detail__text">{detail}</span>;
}

/* --- Bộ lọc --------------------------------------------------------------------------------- */

const locMacDinh = (): LocManNhatKy => ({ ky: kyNhatKyMacDinh(), loc: LOC_NK_TRONG });

export function ActivityLogPage({
  navigate,
  eventTick = 0,
}: {
  navigate?: NavigateFn;
  /** Tăng khi kênh SSE báo có dòng nhật ký mới (AppShell). */
  eventTick?: number;
}) {
  const { token } = useAuth();

  // Kỳ + điều kiện lọc ghi lên URL theo dấu `?man=nhat-ky` (06/10/2026, khuôn chung mọi danh
  // sách): khoá chỉ đọc khi đúng màn này và tự dọn khi rời màn — khác kiểu `?nk_*` cũ từng nằm lại
  // URL rồi tự bật lọc lúc quay về.
  const [locMan, setLocMan] = useLocMan("nhat-ky", locMacDinh(), locNKTuUrl, locNKLenUrl);
  const [q, setQ] = useState("");
  const [qGo, setQGo] = useState(q); // ô tìm kiếm gõ tới đâu (chưa gửi đi)
  const [trang, setTrang] = useState<AuditPage | null>(null);
  const [facets, setFacets] = useState<AuditFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  // Mặc định BẢNG: màn này để TRA — so ngày/người/hành động theo cột nhanh hơn đọc dòng thời
  // gian, và một màn hình chứa được nhiều dòng hơn. Timeline vẫn còn ở nút chuyển.
  // Điện thoại mở Timeline: bảng 6 cột thành thẻ thì giờ ghi đứng giữa, mỗi thẻ thừa một khoảng trống;
  // timeline vốn đã một cột (người · việc · đối tượng · giờ) — đọc liền hơn.
  const [viewMode, setViewMode] = useState<"timeline" | "table">(() => (laDienThoai() ? "timeline" : "table"));
  const [limit, setLimit] = useState(25);
  const [soTrang, setSoTrang] = useState(1);
  /** Mốc ảnh chụp do máy chủ trả ở trang 1; các trang sau gửi lại nguyên si để xấp trang không
   *  trượt khi có dòng mới ghi vào giữa lúc đang đọc. `ref` chứ không `state`: nó không vẽ ra gì. */
  const neoRef = useRef<string | null>(null);

  const [selectedRow, setSelectedRow] = useState<AuditRow | null>(null);
  const [showRawUa, setShowRawUa] = useState(false);
  const [copiedIp, setCopiedIp] = useState(false);
  const [copiedUa, setCopiedUa] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [dangXuat, setDangXuat] = useState(false);
  /** Có dòng mới trong lúc đang đọc — hiện băng, KHÔNG tự chèn vào danh sách đang xem. */
  const [coDongMoi, setCoDongMoi] = useState(false);
  const tickDaXem = useRef(eventTick);

  // Xuất CSV là ô quyền RIÊNG (`activity_log.can_export`): người chỉ được ĐỌC nhật ký thì không
  // được mang cả bảng — kèm số tiền — ra khỏi hệ thống. Máy chủ vẫn là cổng thật (403), đây chỉ
  // là chuyện không chìa ra một cái nút bấm vào là hỏng.
  const coTheXuat = useCan()("activity_log", "export");

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2200);
  };

  /* Kỳ + điều kiện → tham số máy chủ, gói thành MỘT chuỗi khoá: đổi gì trong đó là về trang 1.
     "Nhóm" dịch thành danh sách mã hành động bằng chính facets máy chủ vừa trả (`maHanhDong`) —
     nên facets về muộn thì khoá đổi và trang được nạp lại đúng. */
  const kyThamSo = JSON.stringify(thamSoKyNK(locMan.ky));
  const khoaLoc = JSON.stringify({
    q: q || undefined,
    ...thamSoKyNK(locMan.ky),
    action: maHanhDong(locMan.loc, facets),
    actor_id: locMan.loc.nguoi.length ? locMan.loc.nguoi.map(Number) : undefined,
    loai: locMan.loc.loai.length ? locMan.loc.loai : undefined,
  });

  const truyVan = useCallback(
    (so: number, neo: string | null): AuditQuery => ({
      ...(JSON.parse(khoaLoc) as AuditQuery),
      limit,
      trang: so,
      neo,
    }),
    [khoaLoc, limit],
  );

  const napTrang = useCallback(
    (so: number) => {
      if (!token) return;
      // Về trang 1 là chụp lại ảnh mới: bỏ neo cũ đi để thấy những dòng vừa ghi.
      const neo = so <= 1 ? null : neoRef.current;
      setLoading(true);
      setError(null);
      setSoTrang(so);
      api.rbac
        .activityLog(token, truyVan(so, neo))
        .then((p) => {
          // Số dòng bị che chỉ có ở trang ĐẦU — giữ lại khi lật sang trang sau.
          setTrang((cu) => (so === 1 ? p : { ...p, so_dong_bi_an: cu?.so_dong_bi_an ?? null }));
          neoRef.current = p.neo;
          setCoDongMoi(false);
          tickDaXem.current = eventTick;
        })
        .catch((err) => {
          if (err instanceof ApiError && err.status === 403) setForbidden(true);
          else setError("Không tải được nhật ký hoạt động.");
        })
        .finally(() => setLoading(false));
    },
    [token, truyVan, eventTick],
  );

  const napFacets = useCallback(() => {
    if (!token) return;
    api.rbac
      .activityFacets(token, { q: q || undefined, ...(JSON.parse(kyThamSo) as AuditQuery) })
      .then(setFacets)
      .catch(() => {});
  }, [token, q, kyThamSo]);

  // Đổi bộ lọc → về trang đầu. Gộp một effect để không bắn hai lượt gọi chồng nhau.
  useEffect(() => {
    napTrang(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [khoaLoc, limit]);

  useEffect(() => {
    napFacets();
  }, [napFacets]);

  // Dòng mới tới trong lúc đang đọc: chỉ bật băng. Tự chèn vào danh sách là làm nhảy chỗ người ta
  // đang đọc dở — với một màn dùng để TRA thì đó là phá, không phải tiện.
  useEffect(() => {
    if (eventTick !== tickDaXem.current) setCoDongMoi(true);
  }, [eventTick]);

  // Gõ tìm kiếm: chờ người ta ngừng gõ rồi mới hỏi máy chủ.
  useEffect(() => {
    if (qGo === q) return;
    const t = setTimeout(() => setQ(qGo), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qGo]);

  // Esc đóng cửa sổ chi tiết — trước đây chỉ bấm được vào nút X hoặc nền.
  useEffect(() => {
    if (!selectedRow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedRow(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedRow]);

  const rows = trang?.items ?? [];

  const groupedTimeline = useMemo(() => {
    const groups: { label: string; items: AuditRow[] }[] = [];
    let currentLabel = "";
    let currentItems: AuditRow[] = [];
    rows.forEach((r) => {
      const groupLabel = getDateGroupLabel(r.created_at);
      if (groupLabel !== currentLabel) {
        if (currentItems.length > 0) groups.push({ label: currentLabel, items: currentItems });
        currentLabel = groupLabel;
        currentItems = [r];
      } else {
        currentItems.push(r);
      }
    });
    if (currentItems.length > 0) groups.push({ label: currentLabel, items: currentItems });
    return groups;
  }, [rows]);

  const nhanLoai = useMemo(() => {
    const m: Record<string, { nhan: string; path: string }> = {};
    (facets?.loai ?? []).forEach((l) => (m[l.loai] = { nhan: l.nhan, path: l.path }));
    return m;
  }, [facets]);

  /** `giay:12` → "Giấy #12". Loại ngoài khối danh mục lấy tên máy chủ đặt (`target_nhan`, #70);
   *  máy chủ chưa khai thì giữ nguyên mã — thà thô còn hơn đoán sai. */
  const moTaTarget = (target: string, nhan?: string | null): string => {
    if (!target) return "";
    const [loai, id] = target.split(":");
    const d = nhanLoai[loai];
    return d ? `${d.nhan}${id ? ` #${id}` : ""}` : nhan ?? target;
  };

  const moBanGhi = (r: AuditRow) => {
    const d = r.target_loai ? nhanLoai[r.target_loai] : undefined;
    if (d && navigate) navigate(d.path);
  };

  const dieuKien = useMemo(() => dieuKienNhatKy(facets), [facets]);

  const datLai = () => {
    setQGo("");
    setQ("");
    setLocMan(locMacDinh());
  };

  const xuatCSV = () => {
    if (!token || dangXuat) return;
    setDangXuat(true);
    api.rbac
      .activityExport(token, { ...truyVan(1, null), limit: undefined, trang: undefined })
      .then((url) => {
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `nhat-ky-hoat-dong-${ngayISO(new Date())}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showToast("Đã xuất CSV theo đúng bộ lọc đang xem.");
      })
      .catch((err) => {
        showToast(
          err instanceof ApiError && err.status === 403
            ? "Bạn không có quyền xuất nhật ký."
            : "Không xuất được CSV.",
        );
      })
      .finally(() => setDangXuat(false));
  };

  // Kể cả kỳ: người chọn "Tháng này" rồi muốn quay lại 30 ngày gần nhất cũng cần một đường lùi.
  const coLoc = khoaLoc !== JSON.stringify({ ...thamSoKyNK(kyNhatKyMacDinh()) });
  const khoangDangXem = khoangKy(locMan.ky);

  if (forbidden) {
    return (
      <main className="act-page">
        <div className="banner banner--error" role="alert">
          Bạn không có quyền xem nhật ký hoạt động.
        </div>
      </main>
    );
  }

  const selectedNhom = selectedRow ? trinhBay(selectedRow.nhom) : null;
  const SelectedIcon = selectedNhom?.icon;

  return (
    <main className="act-page">
      {toastMsg && <div className="act-toast">{toastMsg}</div>}

      <header className="act-header">
        <div>

          <h1 className="act-title">Nhật ký hoạt động</h1>
        </div>
        <div className="act-header-actions">
          {coTheXuat && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={xuatCSV}
              disabled={dangXuat}
              title="Tải CSV toàn bộ dòng khớp bộ lọc (máy chủ xuất, không giới hạn trang đang xem)"
            >
              <Download size={14} />
              <span>{dangXuat ? "Đang xuất…" : "Xuất CSV"}</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              napTrang(soTrang);
              napFacets();
            }}
          >
            <RefreshCw size={14} />
            <span>Làm mới</span>
          </button>
        </div>
      </header>

      {coDongMoi && (
        <button
          type="button"
          className="act-bang-moi"
          onClick={() => {
            napTrang(1);
            napFacets();
          }}
        >
          <ArrowUpCircle size={14} />
          Có bản ghi mới — bấm để xem
        </button>
      )}

      <section className="act-filters">
        <div className="act-filter-main tl-thanh">
          <div className="act-search">
            <Search size={14} className="act-search-icon" />
            <input
              className="act-search-input"
              placeholder="Tìm trong nội dung / đối tượng…"
              value={qGo}
              onChange={(e) => setQGo(e.target.value)}
            />
            {qGo && (
              <button
                type="button"
                className="act-search-clear"
                onClick={() => {
                  setQGo("");
                  setQ("");
                }}
                title="Xóa từ khóa"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <ThanhLoc
            ky={locMan.ky}
            moc={MOC_NK}
            onKy={(ky) => setLocMan({ ...locMan, ky })}
            dieuKien={dieuKien}
            loc={locMan.loc}
            onLoc={(loc) => setLocMan({ ...locMan, loc })}
          />

          {coLoc && (
            <button
              type="button"
              className="act-btn-reset"
              onClick={datLai}
              title="Bỏ ô tìm và mọi điều kiện, về 30 ngày gần nhất"
            >
              <RotateCcw size={12} />
              <span>Đặt lại</span>
            </button>
          )}

          <div className="act-view-toggle">
            <button
              type="button"
              className={`act-view-btn${viewMode === "timeline" ? " is-active" : ""}`}
              onClick={() => setViewMode("timeline")}
            >
              <Clock size={13} /> Timeline
            </button>
            <button
              type="button"
              className={`act-view-btn${viewMode === "table" ? " is-active" : ""}`}
              onClick={() => setViewMode("table")}
            >
              <List size={13} /> Bảng
            </button>
          </div>
        </div>

      </section>

      {!!trang?.so_dong_bi_an && (
        <div className="act-bang-an" role="status">
          <EyeOff size={14} />
          <span>
            <strong>{trang.so_dong_bi_an}</strong> dòng khớp bộ lọc nhưng bị ẩn vì bạn không có
            quyền xem màn đã sinh ra chúng (nhật ký chứa số tiền của các màn đó).
          </span>
        </div>
      )}

      <section className="act-body">
        {loading && rows.length === 0 ? (
          <div className="act-skeleton-container">
            {[1, 2, 3, 4, 5].map((i) => (
              <div className="act-skeleton-row" key={i}>
                <div className="act-skeleton-avatar" />
                <div className="act-skeleton-body">
                  <div className="act-skeleton-line act-skeleton-line--short" />
                  <div className="act-skeleton-line act-skeleton-line--long" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="banner banner--error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => napTrang(soTrang)}
            >
              Thử lại
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="act-empty">
            <Filter size={32} className="act-empty-icon" />
            <p className="act-empty-title">Không tìm thấy nhật ký phù hợp</p>
            <p className="act-empty-desc">
              {khoangDangXem
                ? `Kỳ đang xem: ${ngayDeDoc(khoangDangXem.tu)} đến ${ngayDeDoc(khoangDangXem.den)}. Nới kỳ hoặc bỏ bớt điều kiện lọc.`
                : "Đang xem mọi ngày. Bỏ bớt điều kiện lọc hoặc ô tìm."}
            </p>
            {coLoc && (
              <button type="button" className="act-btn-ghost-sm" onClick={datLai}>
                <RotateCcw size={12} />
                Đặt lại bộ lọc
              </button>
            )}
          </div>
        ) : viewMode === "timeline" ? (
          <div className="act-timeline-container">
            {groupedTimeline.map((group) => (
              <div className="act-tl-group" key={group.label}>
                <div className="act-tl-group-header">
                  <Calendar size={13} />
                  <span>{group.label}</span>
                  <span className="act-tl-group-count">{group.items.length} bản ghi</span>
                </div>

                <div className="act-timeline">
                  {group.items.map((r) => {
                    const tb = trinhBay(r.nhom);
                    const IconComp = tb.icon;
                    const actorName = r.actor_name || "Hệ thống";
                    const coCua = !!(r.target_loai && nhanLoai[r.target_loai] && navigate);

                    return (
                      <div
                        className="act-tl-row"
                        key={r.id}
                        onClick={() => setSelectedRow(r)}
                        title="Click để xem chi tiết bản ghi nhật ký này"
                      >
                        <div className="act-tl-avatar-container">
                          <div className={`act-tl-node ${tb.badge}`}>
                            <IconComp size={12} />
                          </div>
                        </div>

                        <div className="act-tl-content">
                          <div className="act-tl-head">
                            <span className="act-avatar-xs">{getUserInitials(r.actor_name)}</span>
                            <span className="act-tl-actor">{actorName}</span>

                            <span className={`act-badge ${tb.badge}`}>
                              <IconComp size={11} />
                              {r.nhan}
                            </span>

                            {r.target && (
                              <span
                                className={`act-target-pill${coCua ? " act-target-pill--link" : ""}`}
                                onClick={(e) => {
                                  if (!coCua) return;
                                  e.stopPropagation();
                                  moBanGhi(r);
                                }}
                                title={coCua ? `Mở màn ${nhanLoai[r.target_loai!].nhan}` : r.target}
                              >
                                <Tag size={11} />
                                {moTaTarget(r.target, r.target_nhan)}
                              </span>
                            )}

                            <span className="act-tl-time" title={formatExactTime(r.created_at)}>
                              <Clock size={11} />
                              {formatRelativeTime(r.created_at)}
                            </span>
                          </div>

                          <div className="act-tl-body">
                            <FormattedDetail detail={r.detail} />
                          </div>
                        </div>

                        <div className="act-tl-meta">
                          <span className="act-tl-exact">{formatExactTime(r.created_at)}</span>
                          <span className="act-tl-id">#{r.id}</span>
                          <button
                            type="button"
                            className="act-btn-inspect"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRow(r);
                            }}
                            title="Xem chi tiết đầy đủ"
                          >
                            <Eye size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="act-table-wrap">
            <table className="act-table">
              <thead>
                <tr>
                  <th style={{ width: 170 }}>Thời gian</th>
                  <th style={{ width: 170 }}>Người thực hiện</th>
                  <th style={{ width: 210 }}>Hành động</th>
                  <th style={{ width: 170 }}>Đối tượng</th>
                  <th>Chi tiết</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const tb = trinhBay(r.nhom);
                  const IconComp = tb.icon;
                  const actorName = r.actor_name || "Hệ thống";

                  return (
                    <tr key={r.id} onClick={() => setSelectedRow(r)} className="act-table-row">
                      <td className="act-td-time">
                        <span className="act-time-rel">{formatRelativeTime(r.created_at)}</span>
                        <span className="act-time-sub">{formatExactTime(r.created_at)}</span>
                      </td>
                      <td>
                        <div className="act-actor-cell">
                          <span className="act-avatar-xs">{getUserInitials(r.actor_name)}</span>
                          <span className="act-actor-name">{actorName}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`act-badge ${tb.badge}`}>
                          <IconComp size={11} />
                          {r.nhan}
                        </span>
                      </td>
                      <td>
                        {r.target ? (
                          <span className="act-mono-pill">{moTaTarget(r.target, r.target_nhan)}</span>
                        ) : (
                          <span className="act-muted">—</span>
                        )}
                      </td>
                      <td>
                        <FormattedDetail detail={r.detail} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="act-btn-inspect"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRow(r);
                          }}
                          title="Xem chi tiết đầy đủ"
                        >
                          <Eye size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!error && rows.length > 0 && (
          <PhanTrangDayDu
            trang={soTrang}
            size={limit}
            tong={trang?.tong ?? null}
            soDong={rows.length}
            onTrang={napTrang}
            onSize={setLimit}
            loading={loading}
            hauTo="khớp bộ lọc"
            ariaLabel="Phân trang nhật ký"
          />
        )}
      </section>

      {selectedRow && (
        <div className="act-modal-overlay" onClick={() => setSelectedRow(null)}>
          <div
            className="act-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label={`Chi tiết nhật ký ${selectedRow.id}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="act-modal-header">
              <div className="act-modal-title-group">
                <FileText size={18} className="act-modal-icon" />
                <div>
                  <h3 className="act-modal-title">Chi tiết nhật ký #{selectedRow.id}</h3>
                  <span className="act-modal-sub">{formatExactTime(selectedRow.created_at)}</span>
                </div>
              </div>
              <button
                type="button"
                className="act-modal-close"
                onClick={() => setSelectedRow(null)}
                title="Đóng (Esc)"
              >
                <X size={16} />
              </button>
            </div>

            <div className="act-modal-body">
              <div className="act-modal-grid">
                <div className="act-modal-field">
                  <span className="act-modal-label">Người thực hiện</span>
                  <div className="act-actor-cell">
                    <span className="act-avatar-xs">{getUserInitials(selectedRow.actor_name)}</span>
                    <strong className="act-modal-val">
                      {selectedRow.actor_name || "Hệ thống"}
                    </strong>
                  </div>
                </div>

                <div className="act-modal-field">
                  <span className="act-modal-label">Hành động</span>
                  <div>
                    {SelectedIcon && (
                      <span className={`act-badge ${selectedNhom!.badge}`}>
                        <SelectedIcon size={12} />
                        {selectedRow.nhan}
                      </span>
                    )}
                  </div>
                </div>

                <div className="act-modal-field">
                  <span className="act-modal-label">Đối tượng tác động</span>
                  <div>
                    {selectedRow.target ? (
                      <span className="act-mono-pill">{moTaTarget(selectedRow.target, selectedRow.target_nhan)}</span>
                    ) : (
                      <span className="act-muted">— Không xác định —</span>
                    )}
                  </div>
                </div>

                <div className="act-modal-field">
                  <span className="act-modal-label">Thời gian tương đối</span>
                  <span className="act-modal-val">{formatRelativeTime(selectedRow.created_at)}</span>
                </div>

                {/* Ai, TỪ ĐÂU — IP & Thiết bị với giao diện tối ưu */}
                <div className="act-modal-field">
                  <span className="act-modal-label">Địa chỉ IP</span>
                  <div className="act-ip-box">
                    <Globe size={13} className="act-ip-icon" />
                    <span className="act-modal-val">
                      {selectedRow.ip === "::1" || selectedRow.ip === "127.0.0.1"
                        ? "Localhost (::1)"
                        : selectedRow.ip ?? <span className="act-muted">— không ghi nhận —</span>}
                    </span>
                    {selectedRow.ip && (
                      <button
                        type="button"
                        className="act-btn-icon-copy"
                        onClick={() => {
                          navigator.clipboard.writeText(selectedRow.ip!);
                          setCopiedIp(true);
                          setTimeout(() => setCopiedIp(false), 1500);
                        }}
                        title="Sao chép IP"
                      >
                        {copiedIp ? <Check size={11} className="act-copy-icon--success" /> : <Copy size={11} />}
                      </button>
                    )}
                  </div>
                </div>

                <div className="act-modal-field act-modal-field--full">
                  <div className="act-modal-label-row">
                    <span className="act-modal-label">Thiết bị &amp; Trình duyệt</span>
                    {selectedRow.user_agent && (
                      <button
                        type="button"
                        className="act-btn-ghost-xs"
                        onClick={() => setShowRawUa((v) => !v)}
                        title="Bật/tắt xem chuỗi User Agent kỹ thuật"
                      >
                        {showRawUa ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        {showRawUa ? "Ẩn UA gốc" : "Xem UA gốc"}
                      </button>
                    )}
                  </div>
                  {(() => {
                    const parsed = parseUserAgent(selectedRow.user_agent);
                    if (!parsed) return <span className="act-muted">— không ghi nhận —</span>;

                    const DeviceIcon =
                      parsed.deviceType === "mobile"
                        ? Smartphone
                        : parsed.deviceType === "tablet"
                          ? Tablet
                          : Laptop;

                    return (
                      <div className="act-ua-container">
                        <div className="act-ua-badges">
                          <span className="act-ua-badge act-ua-badge--device">
                            <DeviceIcon size={12} />
                            {parsed.deviceType === "mobile"
                              ? "Điện thoại"
                              : parsed.deviceType === "tablet"
                                ? "Máy tính bảng"
                                : "Máy tính"}
                          </span>
                          <span className="act-ua-badge act-ua-badge--browser">
                            <Globe size={12} />
                            {parsed.browser} {parsed.browserVer ? `v${parsed.browserVer}` : ""}
                          </span>
                          <span className="act-ua-badge act-ua-badge--os">
                            <MonitorSmartphone size={12} />
                            {parsed.os}
                          </span>
                        </div>

                        {showRawUa && (
                          <div className="act-raw-ua-box">
                            <code className="act-raw-ua-text">{selectedRow.user_agent}</code>
                            <button
                              type="button"
                              className="act-btn-icon-copy act-btn-icon-copy--dark"
                              onClick={() => {
                                navigator.clipboard.writeText(selectedRow.user_agent!);
                                setCopiedUa(true);
                                setTimeout(() => setCopiedUa(false), 1500);
                              }}
                              title="Sao chép chuỗi User Agent"
                            >
                              {copiedUa ? <Check size={12} className="act-copy-icon--success" /> : <Copy size={12} />}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="act-modal-section">
                <span className="act-modal-label">Nội dung chi tiết</span>
                <div className="act-modal-detail-box">
                  <FormattedDetail detail={selectedRow.detail} />
                </div>
              </div>
            </div>

            <div className="act-modal-footer">
              {selectedRow.target_loai && nhanLoai[selectedRow.target_loai] && navigate && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    moBanGhi(selectedRow);
                    setSelectedRow(null);
                  }}
                >
                  <Building size={14} />
                  Mở màn {nhanLoai[selectedRow.target_loai].nhan}
                </button>
              )}
              <button
                type="button"
                className="act-btn-compact"
                onClick={() => setSelectedRow(null)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
