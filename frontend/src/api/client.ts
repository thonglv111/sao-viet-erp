// API client — the ONLY module that knows backend URLs, request/response shapes,
// and error mapping (docs/ARCHITECTURE.md). Components/hooks call these functions,
// never fetch() directly.

// Hình dạng kết quả nhập Excel là CHUNG cho mọi màn (13 danh mục + Hồ sơ nhân sự) nên khai một
// chỗ ở `rebuildCatalog`. `import type` ⇒ TS xoá lúc build, không đẻ vòng import lúc chạy.
import type { ImportExcelOut } from "./rebuildCatalog";
import { laAnhCanNen, nenNeuLaAnh } from "../lib/anhNen";
import { cauLoi422 } from "./loi422";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(
  /\/$/,
  "",
);

export interface User {
  id: number;
  username: string;
  name: string;
  avatar_url?: string | null;
}

/** Enriched profile for the account panel (spec-04): user + resolved dept/role + created. */
export interface Profile extends User {
  department_name: string | null;
  role_name: string | null;
  created_at: string;
}

/** Resolve a server-relative asset path (e.g. an avatar `/static/...`) to a full URL the
 *  browser can load from the API origin. Returns null for an empty/missing path. */
export function assetUrl(path?: string | null): string | null {
  if (!path) return null;
  // Inline ảnh (data:/blob:) — vd ảnh QC chụp tại xưởng nhúng base64 — trả nguyên, KHÔNG ghép BASE_URL.
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return `${BASE_URL}${path}`;
}

/** Ảnh THU NHỎ cho ô lưới / danh sách / avatar: máy chủ trả JPEG cạnh ngắn `w` px (~10–25 KB)
 *  thay vì ảnh gốc (~400 KB đến vài MB). Chỉ áp cho tệp trong kho tệp (`/api/files/`); còn lại
 *  (data:/blob:/URL ngoài) trả như `assetUrl`. Khung xem ảnh lớn (lightbox) giữ `assetUrl`. */
export function anhNho(path?: string | null, w: 160 | 320 = 160): string | null {
  const url = assetUrl(path);
  if (!url || !path?.startsWith("/api/files/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}w=${w}`;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

/** Normalized API error so the UI can branch on kind without parsing strings. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number, // 0 = network/unreachable
    /** `detail` THÔ đã parse từ thân lỗi (chuỗi | mảng 422 | object). Đa số màn chỉ cần `message`,
     *  nhưng vài endpoint trả detail dạng OBJECT có cấu trúc (vd Xếp lịch 2 khi CHẶN đặt lịch:
     *  `{loai:"chan_dat_lich", van_de:[...]}`) — giữ bản thô để nơi gọi bóc được danh sách vấn đề,
     *  phân biệt với 409 khoá-lạc-quan (detail là CHUỖI). */
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }

  get isAuth(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

/** Tuỳ chọn thêm của một lượt gọi, ngoài `RequestInit` chuẩn. */
export interface TuyChonGoi extends RequestInit {
  /** Thời hạn chờ (ms), ghi đè mặc định: GET 20 s · ghi 60 s · gửi tệp (FormData) 180 s. */
  timeoutMs?: number;
  /** `true` = gửi ảnh trong FormData NGUYÊN BẢN, không tự nén (vd bản quét cần giữ độ nét). */
  giuNguyenAnh?: boolean;
}

// Thời hạn chờ mặc định. Không có hạn thì một kết nối nửa-mở (điện thoại đổi Wi-Fi sang 4G, proxy
// giữ socket chết) treo màn "Đang tải…" tới khi người dùng F5 — và F5 hàng loạt lại dồn thêm tải.
const HAN_DOC_MS = 20_000;
const HAN_GHI_MS = 60_000;
const HAN_GUI_TEP_MS = 180_000;
/** GET tự thử lại tối đa ngần này lần khi mất mạng / 502 / 503 / 504 (máy chủ khởi động lại, quá tải). */
const SO_LAN_THU_LAI_GET = 2;
/** Trần thời gian chờ theo `Retry-After`: máy chủ xin chờ lâu hơn thì thà báo lỗi để người dùng tự bấm lại. */
const TRAN_RETRY_AFTER_MS = 5_000;

const LOI_HET_GIO = "Máy chủ phản hồi quá lâu, vui lòng thử lại.";
const LOI_MAT_MANG = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
const LOI_KHONG_HOP_LE = "Máy chủ trả dữ liệu không hợp lệ (có thể mạng Wi-Fi đang chặn).";

/** Câu lỗi mặc định khi máy chủ không kèm `detail` đọc được. */
function loiMacDinh(status: number): string {
  if (status === 0) return LOI_MAT_MANG;
  if (status === 413) return "Tệp quá lớn.";
  // Giữ mã trong câu: người báo lỗi đọc lại được cho người sửa (500 = lỗi code, 503 = quá tải).
  if (status >= 500) return `Máy chủ đang bận hoặc khởi động lại (mã ${status}), vui lòng thử lại.`;
  return `Yêu cầu thất bại (mã ${status}).`;
}

/** Thời gian chờ trước lượt thử lại thứ `lan` (0-based): 500 ms·2^n + ngẫu nhiên 0–300 ms để các tab
 *  không cùng nhịp đập vào máy chủ vừa dậy. Máy chủ gửi `Retry-After` (giây) thì theo nó, trần 5 s. */
function thoiGianCho(lan: number, retryAfter: string | null | undefined): number {
  const jitter = Math.random() * 300;
  const giay = retryAfter != null && retryAfter !== "" ? Number(retryAfter) : NaN;
  if (Number.isFinite(giay) && giay >= 0) return Math.min(giay * 1000, TRAN_RETRY_AFTER_MS) + jitter;
  return 500 * 2 ** lan + jitter;
}

function cho(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((ok, loi) => {
    if (signal?.aborted) {
      loi(new DOMException("Aborted", "AbortError"));
      return;
    }
    const hen = setTimeout(() => {
      signal?.removeEventListener("abort", huy);
      ok();
    }, ms);
    const huy = () => {
      clearTimeout(hen);
      loi(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", huy, { once: true });
  });
}

/** Mọi File ảnh trong FormData lớn hơn ngưỡng được thay bằng bản nén (ảnh chụp điện thoại 4–8 MB →
 *  vài trăm KB). Không có ảnh nào cần nén thì trả lại CHÍNH form cũ. Nén hỏng (HEIC trình duyệt
 *  không đọc được…) thì giữ nguyên tệp gốc — không bao giờ chặn người dùng. */
async function nenAnhTrongForm(form: FormData): Promise<FormData> {
  const muc = Array.from(form.entries());
  const canNen = muc.some(([, v]) => typeof v !== "string" && laAnhCanNen(v as File));
  if (!canNen) return form;
  const moi = new FormData();
  for (const [k, v] of muc) {
    if (typeof v === "string") {
      moi.append(k, v);
      continue;
    }
    const tep = await nenNeuLaAnh(v as File);
    moi.append(k, tep, tep.name);
  }
  return moi;
}

type KetQuaLuot<T> = { xong: true; giaTri: T } | { xong: false; choMs: number };

async function request<T>(path: string, init: TuyChonGoi = {}): Promise<T> {
  const { timeoutMs, giuNguyenAnh, ...rest } = init;
  const method = (rest.method ?? "GET").toUpperCase();
  const isForm = typeof FormData !== "undefined" && rest.body instanceof FormData;
  const body = isForm && !giuNguyenAnh ? await nenAnhTrongForm(rest.body as FormData) : rest.body;
  const han =
    timeoutMs ?? (isForm ? HAN_GUI_TEP_MS : method === "GET" || method === "HEAD" ? HAN_DOC_MS : HAN_GHI_MS);
  // CHỈ thử lại lượt ĐỌC. Lượt ghi (POST/PUT/PATCH/DELETE) có thể đã tới máy chủ và ghi xong rồi mới
  // rớt phản hồi — tự gửi lại là ghi hai lần (chấm công, mẻ sản lượng…).
  const thuLaiDuoc = method === "GET" || method === "HEAD";
  const ngoai = rest.signal ?? null;

  const motLuot = async (lan: number): Promise<KetQuaLuot<T>> => {
    const ctl = new AbortController();
    let hetGio = false;
    const hen = setTimeout(() => {
      hetGio = true;
      ctl.abort();
    }, han);
    const huyTheoNgoai = () => ctl.abort();
    if (ngoai) {
      if (ngoai.aborted) ctl.abort();
      else ngoai.addEventListener("abort", huyTheoNgoai, { once: true });
    }
    try {
      let resp: Response;
      try {
        resp = await fetch(`${BASE_URL}${path}`, {
          ...rest,
          body,
          signal: ctl.signal,
          // Send/receive the httpOnly refresh cookie (spec-03). Requires the backend to
          // allow credentials with a specific origin (never "*").
          credentials: "include",
          // Let the browser set the multipart boundary itself for FormData; force JSON otherwise.
          headers: {
            ...(isForm ? {} : { "Content-Type": "application/json" }),
            ...(rest.headers ?? {}),
          },
        });
      } catch (err) {
        if (hetGio) throw new ApiError(LOI_HET_GIO, 0);
        if (ngoai?.aborted) throw err; // nơi gọi tự huỷ — trả nguyên AbortError cho nó nhận ra
        if (thuLaiDuoc && lan < SO_LAN_THU_LAI_GET) return { xong: false, choMs: thoiGianCho(lan, null) };
        throw new ApiError(LOI_MAT_MANG, 0);
      }

      if (!resp.ok) {
        if (
          thuLaiDuoc &&
          lan < SO_LAN_THU_LAI_GET &&
          (resp.status === 502 || resp.status === 503 || resp.status === 504)
        ) {
          return { xong: false, choMs: thoiGianCho(lan, resp.headers?.get?.("Retry-After")) };
        }
        const { text, raw } = await safeDetail(resp);
        throw new ApiError(text ?? loiMacDinh(resp.status), resp.status, raw);
      }

      if (resp.status === 204) return { xong: true, giaTri: undefined as T };
      try {
        return { xong: true, giaTri: (await resp.json()) as T };
      } catch (err) {
        if (hetGio) throw new ApiError(LOI_HET_GIO, 0);
        if (ngoai?.aborted) throw err;
        // 2xx mà thân không phải JSON: thường là trang đăng nhập của Wi-Fi công cộng / proxy chặn.
        throw new ApiError(LOI_KHONG_HOP_LE, 0);
      }
    } finally {
      clearTimeout(hen);
      ngoai?.removeEventListener("abort", huyTheoNgoai);
    }
  };

  for (let lan = 0; ; lan++) {
    const kq = await motLuot(lan);
    if (kq.xong) return kq.giaTri;
    await cho(kq.choMs, ngoai);
  }
}

async function safeDetail(resp: Response): Promise<{ text: string | null; raw: unknown }> {
  try {
    const body = await resp.json();
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return { text: detail, raw: detail };
    // 422 của FastAPI trả `detail` là MẢNG `{loc, msg}`, không phải chuỗi. Trước 15/08/2026 nhánh
    // này không tồn tại ⇒ mọi lỗi kiểm dữ liệu của CẢ APP rơi về câu chung "Yêu cầu thất bại (mã 422)."
    // Không nói trường nào sai thì người dùng chỉ biết bấm lại, còn người sửa code phải dựng lại
    // thân request rồi bắn thử từng cái để đoán — đã mất hai lượt vì đúng chỗ này.
    if (Array.isArray(detail) && detail.length > 0) {
      // Dịch theo `type` pydantic + nhãn ô ở `loi422.ts` (18/10/2026).
      const ds = detail.map(cauLoi422).filter((x): x is string => x !== null);
      if (ds.length > 0) {
        // Cắt ở 3: một form sai chục ô thì banner dài hơn cả form. Ba cái đầu đủ để biết đi đâu sửa.
        const text =
          ds.slice(0, 3).join(" · ") + (ds.length > 3 ? ` (+${ds.length - 3} lỗi nữa)` : "");
        return { text, raw: detail };
      }
    }
    // Object detail có CÂU `message` (thao tác hàng loạt bị chặn: `{message, vuong_ids}`): lấy câu
    // đó làm thông báo, `raw` vẫn giữ để nơi gọi bóc danh sách dòng vướng.
    if (detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string") {
      return { text: (detail as { message: string }).message, raw: detail };
    }
    // Object detail có cấu trúc (vd `{loai, van_de}`): không dựng được câu ngắn ⇒ text = null (nơi
    // gọi tự bóc `raw`), nhưng VẪN trả `raw` để không mất dữ liệu.
    return { text: null, raw: detail };
  } catch {
    /* non-JSON error body */
  }
  return { text: null, raw: undefined };
}

// --- Token mới nhất ---------------------------------------------------------
// Access token xoay mỗi 15 phút. Trước đây mỗi lần xoay AuthContext `setToken` ⇒ ~68 effect phụ
// thuộc `[token]` chạy lại đồng loạt (kênh SSE đóng/mở, nạp lại quyền, badge, dữ liệu màn đang mở)
// — với vài trăm tab là một cơn bão request mỗi 15 phút. Nay token xoay chỉ nằm ở biến này; token
// trong React giữ nguyên danh tính (đổi khi đăng nhập / khôi phục phiên), còn mọi request đều
// mang token MỚI NHẤT qua `authHeader`.
let tokenMoiNhat: string | null = null;

/** Token truy cập mới nhất (sau lượt làm mới ngầm gần nhất). `null` = chưa đăng nhập / đã hết phiên. */
export function layTokenMoiNhat(): string | null {
  return tokenMoiNhat;
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${tokenMoiNhat ?? token}` };
}

/** Khuôn CHUNG của mọi endpoint danh sách có phân trang.
 *
 *  `total` = tổng dòng KHỚP BỘ LỌC trên toàn bảng, KHÁC `items.length` (số dòng của trang đang
 *  xem). Chân bảng phải in `total`; in `items.length` thì màn nào cũng báo "Tổng 20". */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

/** Danh sách phân trang kèm số theo trạng thái cho thanh tab (đếm sau kỳ + bộ lọc, trước khi lọc
 *  trạng thái; khoá `tat_ca` = tổng). Dùng cho các danh sách Chấm công / Nghỉ phép / Tăng ca. */
export interface PagedTab<T> extends Paged<T> {
  dem_theo_tab?: Record<string, number> | null;
}

/** Chuỗi query từ tham số lọc: bỏ ô rỗng, mảng thành nhiều khoá cùng tên. */
function qsLoc(loc?: ThamSoLoc): string {
  const sp = new URLSearchParams();
  ganThamSoLoc(sp, loc);
  const t = sp.toString();
  return t ? `?${t}` : "";
}

/** Dựng chuỗi query, BỎ QUA ô rỗng (`undefined` / `null` / chuỗi rỗng).
 *
 *  Vì sao phải bỏ: gửi `?q=` (rỗng) lên là backend nhận chuỗi rỗng chứ không phải "không lọc" —
 *  tuỳ endpoint mà ra bảng trắng. Trả về "" khi không có ô nào, để nối thẳng vào path được.
 *
 *  ⚠ Đừng đổi tên thành `qs`: trong file này `qs` đang là tên BIẾN CỤC BỘ ở hàng chục hàm
 *  (`const qs = new URLSearchParams()`), đặt trùng là người đọc sau tưởng hai thứ là một. */
function qs(params?: Record<string, string | number | boolean | undefined | null>): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    sp.set(key, String(value));
  }
  const text = sp.toString();
  return text ? `?${text}` : "";
}

export async function authed<T>(path: string, token: string, init: TuyChonGoi = {}): Promise<T> {
  try {
    return await request<T>(path, {
      ...init,
      headers: { ...authHeader(token), ...(init.headers ?? {}) },
    });
  } catch (err) {
    // Access token expired? Refresh once (silently) and retry the original request.
    if (err instanceof ApiError && err.isAuth) {
      const fresh = await refreshAccessToken();
      if (fresh) {
        return await request<T>(path, {
          ...init,
          headers: { ...authHeader(fresh), ...(init.headers ?? {}) },
        });
      }
    }
    throw err;
  }
}

// --- Silent refresh ---------------------------------------------------------
// A single shared in-flight refresh so a burst of concurrent 401s triggers at most
// ONE /refresh call (no refresh storm). Callbacks let AuthContext stay in sync.

let refreshInFlight: Promise<LoginResponse | null> | null = null;
let onAccessToken: (token: string | null) => void = () => {};
let onSessionEnded: () => void = () => {};

/** AuthContext registers how to receive a rotated access token / a dead session. */
export function registerAuthCallbacks(cb: {
  onAccessToken: (token: string | null) => void;
  onSessionEnded: () => void;
}): void {
  onAccessToken = cb.onAccessToken;
  onSessionEnded = cb.onSessionEnded;
}

/** Khoá Web Locks dùng chung mọi tab cùng origin. */
const REFRESH_LOCK = "svn-auth-refresh";
/** Hạn chờ riêng của lượt /refresh (ngắn hơn hạn ghi 60 s mặc định) — xem `refreshSession`. */
const HAN_LAM_MOI_MS = 15_000;

/** Đổi refresh cookie lấy phiên mới — ĐƯỜNG DUY NHẤT gọi `/api/auth/refresh`.
 *
 *  Máy chủ xoay token mỗi lượt và coi token cũ bị dùng lại là bị trộm ⇒ thu hồi CẢ HỌ token, người
 *  dùng văng ra màn đăng nhập. Hai lượt mang cùng một cookie bay song song là đủ dính: StrictMode
 *  chạy effect khôi phục phiên hai lần, lượt khôi phục đè lên lượt làm mới vì 401, hai tab hết hạn
 *  access token cùng lúc. DB dev ngày 14/09/2026 có 5 họ token bị giết đúng kiểu này. Nên:
 *    · trong một tab: mọi nơi gọi dùng chung một promise đang bay;
 *    · giữa các tab: xếp hàng qua Web Locks — tab sau chạy khi cookie đã là token mới.
 *  Trả `null` khi máy chủ TỪ CHỐI refresh token (đã báo `onSessionEnded`). Lỗi TẠM (xem
 *  `hetPhienThat`) thì promise REJECT với chính lỗi đó, phiên giữ nguyên để nơi gọi thử lại. */
export function refreshSession(): Promise<LoginResponse | null> {
  if (!refreshInFlight) {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    // Hạn 15 s: lượt này chạy BÊN TRONG Web Lock dùng chung mọi tab — treo không hạn là mọi tab của
    // trình duyệt đó đứng theo, không tab nào làm mới được phiên.
    const goi = () => api.refresh(HAN_LAM_MOI_MS);
    // `await` để gỡ tầng Promise lồng: kiểu của `locks.request` là Promise<T> với T = Promise<...>.
    const chay = async (): Promise<LoginResponse> =>
      locks ? await locks.request(REFRESH_LOCK, goi) : goi();
    refreshInFlight = chay()
      .then((res) => {
        tokenMoiNhat = res.access_token;
        onAccessToken(res.access_token);
        return res;
      })
      .catch((err: unknown) => {
        if (!hetPhienThat(err)) throw err;
        tokenMoiNhat = null;
        onSessionEnded();
        return null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/** Lượt /refresh hỏng vì máy chủ TRẢ LỜI từ chối (4xx: cookie thiếu/hết hạn/bị thu hồi/dùng lại)
 *  mới là hết phiên. Không tới được máy chủ (status 0 — BE đang khởi động lại, rớt mạng), 5xx,
 *  408, 429 là lỗi tạm: cookie vẫn nguyên. Trước đây bắt MỌI lỗi thành hết phiên ⇒ tải lại trang
 *  đúng lúc restart BE là văng ra màn đăng nhập dù phiên còn sống. */
function hetPhienThat(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429;
}

function refreshAccessToken(): Promise<string | null> {
  return refreshSession().then((res) => res?.access_token ?? null);
}

// --- Real-time luồng gửi duyệt (SSE) ----------------------------------------
// EventSource gốc KHÔNG set được header Authorization → dùng fetch + ReadableStream để đọc SSE có
// Bearer. Tự reconnect (kèm refresh token khi 401). Sự kiện chỉ là tín hiệu nhẹ; số chính xác lấy
// qua notifySummary(). Trả hàm đóng kết nối (gọi khi logout/unmount).

export interface QuoteNotifySummary {
  pending_approval_count: number;
  my_decided_unseen: number;
}

export interface AdvanceNotifySummary {
  pending_approval_count: number;
}

/** Badge Thu mua. Ba số đã lọc theo phạm vi người gọi ở SERVER — FE chỉ việc cộng.
 *  `dot_giao_qua_han` là số CÔNG NỢ: server trả 0 cho người không có `ke_toan:read`, nên đừng
 *  thêm luật che ở đây (hai nơi cùng giữ một luật là hai nơi lệch nhau). */
export interface PurchaseNotifySummary {
  ycmh_cho_lap_phieu: number;
  pmh_bi_tu_choi: number;
  dot_giao_qua_han: number;
}

// Kênh chấm đỏ = khoá module của màn (danh sách ở máy chủ `services/thong_bao_man.py`); tổ SX
// là `to_sx_<id>`. Tóm tắt chỉ trả kênh ĐANG có bản ghi mới kể từ lần mở màn trước.
export type ModuleNotificationChannel = string;
export interface ThongBaoMoi { id: number; loai: string; ma: string | null }
export interface ModuleNotificationSummary { kenh: Record<string, ThongBaoMoi> }

export type QuoteEvent =
  | { type: "quote_decision"; quote_id: number; code: string; decision: "approved" | "rejected" }
  | { type: "quote_pending_changed"; code?: string }
  // Nhật ký hoạt động có dòng mới. Tín hiệu TRẦN, không mang nội dung: người đang mở màn chưa
  // chắc có quyền đọc dòng vừa ghi. Máy chủ tiết chế tối đa 3 giây một lần (mọi thao tác trong hệ
  // đều ghi audit, bắn từng dòng là ngập kênh).
  | { type: "nhat_ky_moi" }
  // Danh mục nguồn của phiếu tính giá (giấy · máy · công đoạn · vật tư, kể cả bảng con) vừa đổi.
  // Màn phiếu đang mở nạp lại danh mục + hỏi lại lời nhắc "danh mục đã đổi" (nhóm `danh_muc`).
  | { type: "danh_muc_doi"; loai: string[] }
  // Có bản ghi mới ở một kênh chấm đỏ thanh bên (tín hiệu TRẦN — hỏi lại tóm tắt).
  | { type: "thong_bao_man"; kenh: string }
  // Đơn hàng bán dùng CHUNG kênh hub (bám logic SSE báo giá): quyết định duyệt/đủ cọc gửi riêng
  // người soạn; 'pending_changed' là tín hiệu danh sách chờ đổi → refetch notify-summary theo vai.
  // `order_decision` đã gỡ cùng luồng duyệt đơn đặc thù (backend không publish nữa).
  | { type: "order_deposit_ok"; code: string }
  | { type: "order_pending_changed"; code?: string }
  // Lịch hẹn chăm sóc (redesign-lich-hen-cham-soc): ticker đẩy "care_due" khi tới giờ hẹn,
  // "care_assigned" khi giao hẹn cho người khác — gửi riêng người phụ trách.
  | { type: "care_due"; customer: string; customer_id: number; note: string }
  | { type: "care_assigned"; customer: string; customer_id: number; note: string }
  // Điều chuyển khách ⇒ hẹn đang mở đi theo: `nhan` = mình là người nhận (toast), không thì mất hẹn.
  | { type: "care_moved"; so: number; nhan: boolean }
  // Phiếu bảo trì tới ngày (ticker `bao_tri_reminders.py`): gửi riêng người NHẬN việc, phiếu chưa
  // ai nhận thì gửi mọi tài khoản có quyền sửa `ky_thuat_may` (tổ sửa chữa).
  | { type: "bao_tri_due"; phieu_id: number; ma: string; may: string; goi: string; qua_han: boolean }
  // Yêu cầu báo máy hỏng (20/08/2026), đẩy HAI CHIỀU:
  //   • `_moi` → mọi tài khoản trong tổ sửa chữa: có người vừa báo máy hỏng.
  //   • `_ket_qua` → RIÊNG người đã gửi lời báo: đã lập phiếu, hay bị từ chối vì lý do gì. Nhận
  //     được sự kiện này nghĩa là mình chính là người gửi ⇒ chỗ dùng KHÔNG gác thêm quyền.
  | {
      type: "ky_thuat_yeu_cau_moi"; id: number; ma: string;
      may: string; may_ten: string | null; bo_phan_hong: string;
      muc_do: string; may_dung: boolean;
      nguoi_bao: string | null; bo_phan: string | null;
    }
  | {
      type: "ky_thuat_yeu_cau_ket_qua"; id: number; ma: string;
      ket_qua: "da_tao_phieu" | "tu_choi";
      phieu_id: number | null; phieu_ma: string | null;
      ly_do: string | null; boi: string | null;
    }
  // Tạm ứng lương: NV gửi đề nghị → 'pending_changed' (người duyệt refetch badge); kế toán
  // duyệt/từ chối → 'decision' gửi riêng nhân viên đề nghị.
  | { type: "advance_pending_changed"; code?: string }
  | { type: "advance_decision"; code?: string; decision: "approved" | "rejected" }
  // Phiếu tăng ca: NV gửi/hủy → 'ot_pending_changed' (người duyệt refetch badge); tổ trưởng
  // duyệt/từ chối → 'ot_decision' đẩy riêng cho nhân viên nộp phiếu.
  | { type: "ot_pending_changed"; code?: string }
  | {
      type: "ot_decision";
      code?: string;
      // huy_dong_y / huy_giu_nguyen = người duyệt quyết yêu cầu XIN HỦY phiếu đã duyệt (23/09/2026).
      decision: "approved" | "rejected" | "cancelled" | "huy_dong_y" | "huy_giu_nguyen";
    }
  // Nghỉ phép (23/09/2026 — trước đó không đẩy gì): gửi đơn / xin hủy / rút lại → người duyệt tải lại
  // badge; quyết định về đơn → đẩy riêng cho người đứng tên đơn.
  | { type: "leave_pending_changed"; code?: string }
  | {
      type: "leave_decision";
      code?: string;
      decision: "approved" | "rejected" | "cancelled" | "huy_dong_y" | "huy_rut_ngan" | "huy_giu_nguyen";
    }
  // Phiếu đi muộn / về sớm / nghỉ nửa buổi: cùng luồng với tăng ca (tổ trưởng duyệt), bảng riêng.
  | { type: "el_pending_changed"; code?: string }
  // Yêu cầu chỉnh công (E7, 08/09/2026): gửi/huỷ → người duyệt refetch; duyệt/từ chối → đẩy đúng NV.
  | { type: "adjust_pending_changed"; code?: string }
  | { type: "adjust_decision"; code?: string; decision: "approved" | "rejected" }
  | { type: "el_decision"; code?: string; decision: "approved" | "rejected" }
  // Quản lý đổi ca của một người → đẩy RIÊNG cho chính người đó (5 đường: lưới phân ca, panel
  // Gán ca, gán hàng loạt, sửa hồ sơ, gỡ mốc). `count` = số thay đổi trong lần lưu đó.
  | { type: "shift_changed"; count?: number }
  // Quyền của CHÍNH người nhận vừa đổi (lưu ma trận vai của họ · gán/gỡ vai · đổi phòng). Không
  // mang nội dung quyền — nhận là hỏi lại `/api/auth/permissions`.
  | { type: "quyen_doi" }
  // Hàng đợi sự kiện của CHÍNH kết nối này tràn (mạng chậm, tab ngủ) — máy chủ bỏ các sự kiện đang
  // xếp, để lại đúng tín hiệu này. Nhận là làm như lúc kênh vừa nối lại: nạp lại badge + màn đang mở.
  | { type: "dong_bo_lai" }
  // Sản xuất (Lát 1) dùng CHUNG kênh hub — tín hiệu NHẸ để hộp việc tổ refetch + "ting". Số chính
  // xác lấy qua to-badges/inbox (đã lọc scope server-side). `lenh_sx_routing` = có lệnh mới PHÁT
  // vào các tổ `to_ids`; `lenh_sx_assigned` = 1 thợ được gán (đích danh tới user).
  | { type: "lenh_sx_routing"; form_id?: number; lenh_ids?: number[]; to_ids: number[] }
  | { type: "lenh_sx_assigned"; lenh_id: number; to_id: number | null }
  | { type: "lenh_sx_phat"; form_id: number; lenh_ids: number[] }
  | { type: "lenh_sx_duyet_mau"; lenh_id: number }
  | { type: "lenh_sx_ban_giao"; lenh_id: number; ban_giao_id: number; to_nhan_id: number | null }
  | { type: "lenh_sx_qc_loi"; lenh_id: number; qc_id: number; to_bi_quy_id: number | null }
  // Handoff Đơn → bàn Kế hoạch SX: đơn chốt 'bắn xuống' hàng chờ; Sale đổi gấp/lưu ý SAU chốt →
  // bàn kế hoạch "ting" (badge nhảy). Nội dung chính xác FE refetch hàng chờ / detail.
  | { type: "order_ordered"; code?: string; order_id: number }
  | { type: "order_sx_hint_changed"; code?: string; order_id: number; is_rush: boolean }
  // Kế hoạch tạo/sửa/xoá lệnh sản xuất → hàng chờ + bước "Sản xuất" ở Đơn hàng cập nhật ngay.
  | { type: "lsx_changed"; order_id: number }
  // Thêm/xoá tệp đính kèm của một lệnh — chỉ màn chi tiết đúng lệnh đó tải lại danh sách tệp.
  | { type: "lsx_dinh_kem_changed"; lsx_id: number }
  // Bài ghép tạo/sửa/xoá → hàng chờ ghép + danh sách bài ghép cập nhật ngay (không cần refresh).
  | { type: "bai_ghep_changed" }
  // Xếp lịch (cấp LỆNH): đặt/dời/bỏ mốc · phát hành · thu hồi → bàn Xếp lịch + badge cập nhật
  // ngay. Trước 18/09/2026 đây là HAI kênh (`xep_lich_changed` của bàn theo công đoạn +
  // `xep_lich_3_changed` của bàn cấp lệnh); bàn kia xoá rồi nên gộp về một.
  | { type: "xep_lich_changed" }
  // Chốt (thông tin) → báo KẾ TOÁN "đơn chờ ghi cọc" (popup module Phiếu thu). amount = cần thu.
  | { type: "order_deposit_needed"; code?: string; order_id: number; amount: number }
  // Thu mua / Kế toán: tín hiệu NHẸ (danh sách đổi) → refetch badge Thu mua. Backend đã broadcast
  // sẵn hai event này từ mọi đường ghi (`_notify_purchase_changed` / `_notify_accounting_changed`),
  // đợt này chỉ NỐI vào — không mở kênh SSE thứ hai.
  | { type: "purchase_changed"; code?: string | null }
  | { type: "accounting_changed"; code?: string | null }
  | { type: "department_purchase_request_created"; code?: string | null; actor_user_id?: number | null }
  | { type: "sales_invoice_created"; code?: string | null; invoice_id?: number; invoice_number?: string | null }
  | { type: "sales_invoice_cancelled"; code?: string | null; invoice_id?: number; invoice_number?: string | null }
  | { type: "sales_invoice_receipt_created"; code?: string | null; invoice_id?: number; receipt_code?: string | null }
  | { type: "sales_invoice_created"; code?: string | null; invoice_id?: number; invoice_number?: string | null }
  | { type: "sales_invoice_cancelled"; code?: string | null; invoice_id?: number; invoice_number?: string | null }
  | { type: "sales_invoice_receipt_created"; code?: string | null; invoice_id?: number; receipt_code?: string | null }
  | { type: "purchase_pending_approval"; code?: string | null; actor_user_id?: number | null }
  | {
      type: "purchase_decision";
      code?: string | null;
      decision: "approved" | "rejected";
      actor_user_id?: number | null;
      recipient_user_id?: number | null;
    }
  | { type: "purchase_delivery_created"; code?: string | null; seq_no?: number | null; actor_user_id?: number | null }
  | { type: "purchase_delivery_updated"; code?: string | null; seq_no?: number | null; actor_user_id?: number | null }
  | { type: "purchase_delivery_deleted"; code?: string | null; seq_no?: number | null; actor_user_id?: number | null }
  | { type: "purchase_invoice_updated"; code?: string | null; actor_user_id?: number | null }
  | {
      type: "payment_voucher_created";
      code?: string | null;
      voucher_code?: string | null;
      actor_user_id?: number | null;
      recipient_user_id?: number | null;
    }
  | {
      type: "payment_voucher_cancelled";
      code?: string | null;
      voucher_code?: string | null;
      actor_user_id?: number | null;
      recipient_user_id?: number | null;
    }
  // Kho (spec-kho-de-nghi §10): `stock_request` = tin đích danh có sẵn câu chữ để toast;
  // `stock_request_pending_changed` = tín hiệu NHẸ (danh sách chờ đổi) → chỉ refetch badge.
  | { type: "stock_request"; code?: string; message: string; loai?: "NHAP" | "XUAT" }
  | {
      type: "stock_request_pending_changed";
      code?: string;
      loai?: "NHAP" | "XUAT";
      nguoi_tao_id?: number;
      nguoi_tao_ten?: string | null;
      bo_phan_ten?: string | null;
    }
  // Giao hàng (20/08/2026): đẩy ĐÍCH DANH cho tài xế của chuyến. Tài xế đang ở kho hoặc trên
  // đường, không ngồi canh màn hình — bắt họ F5 để biết "kho soạn xong chưa" là bắt đoán.
  | {
      type: "giao_hang_chuyen";
      /** `phan_chuyen` | `doi_gio` | `kho_xong` (kho lập phiếu) | `da_xuat_kho` (kho ghi sổ ⇒ chuyến đã lấy hàng). */
      viec: string;
      trip_id: number;
      request_code?: string | null;
      khach?: string | null;
      ma_phieu?: string | null;
      message: string;
    }
  // Phiếu lương kỳ này vừa mở cho người nhận (#39, 18/10/2026): đẩy ĐÍCH DANH người có dòng lương,
  // lúc HCNS công bố mở ngay hoặc lúc tới giờ hẹn.
  | { type: "phieu_luong_cong_bo"; year: number; month: number; message: string }
  | { type: "phieu_luong_thu_hoi"; year: number; month: number; message: string }
  // Yêu cầu / chuyến giao đổi (mọi thao tác ghi của module giao hàng) — tín hiệu NHẸ để drawer đơn
  // và màn Giao hàng đang mở tự tải lại, không toast.
  | { type: "giao_hang_changed" }
  // `notification_new` = có thông báo mới vào chuông → FE refetch list + badge chuông.
  | { type: "notification_new" }
  // Thực hiện sản xuất (module `san_xuat`): `san_xuat_cong_viec_changed` = tín hiệu bàn tổ đổi
  // (badge tổ nhảy + bàn đang mở refetch); `san_xuat_duoc_giao_viec` = đẩy đích danh tới người vừa
  // được giao (toast cá nhân, nếu có tài khoản).
  | {
      type: "san_xuat_cong_viec_changed";
      team_id?: number | null;
      cong_viec_id?: number | null;
      trang_thai?: string | null;
    }
  | { type: "san_xuat_duoc_giao_viec"; cong_viec_id?: number | null }
  // Việc GIỮA HAI TỔ (bàn giao §11): `*_changed` broadcast để bàn đang mở + badge tươi;
  // `san_xuat_ban_giao` đẩy ĐÍCH DANH tới người cần biết (trừ người bấm), mang sẵn nhãn để toast
  // nói được việc gì. `su_kien`: de_xuat | sua | sua_me | xac_nhan | huy.
  | { type: "san_xuat_ban_giao_changed"; team_ids?: number[]; ban_giao_id?: number | null; trang_thai?: string | null }
  | {
      type: "san_xuat_ban_giao";
      ban_giao_id?: number | null;
      trang_thai?: string | null;
      su_kien?: string | null;
      nguon_ten?: string | null;
      dich_ten?: string | null;
      so_luong?: number | null;
      don_vi?: string | null;
      lsx_ma?: string | null;
    }
  // Gia công ngoài (spec 2026-09-26): lần vừa CHỐT ⇒ đẩy đích danh người lập phiếu chi (toast) +
  // broadcast `_changed` để badge Phiếu chi của mọi người nhảy; `gia_cong_ngoai_changed` để khối
  // Gia công ngoài / danh sách Kế hoạch SX đang mở tự nạp (qua tick chung).
  | {
      type: "gia_cong_cho_chi";
      gia_cong_ngoai_id: number;
      lsx_ma?: string | null;
      nha_cung_cap_ten?: string | null;
      ten_viec?: string | null;
    }
  | { type: "gia_cong_cho_chi_changed" }
  | { type: "gia_cong_ngoai_changed"; lsx_id?: number | null; gia_cong_ngoai_id?: number | null;
      lsx_ids?: number[]; bai_ghep_id?: number | null }
  // KCS theo lệnh (mg 0306) · kho §14 · đóng nhóm §16/§13.3. `*_changed` = tín hiệu NHẸ broadcast
  // để panel/hộp đang mở refetch (quoteTick lo); `san_xuat_kcs_ket_qua` / `san_xuat_kho` = đẩy ĐÍCH
  // DANH tới người cần biết → toast cá nhân. `trang_thai` mang enum backend (kho: cho_kho/nhap_mot_phan/da_nhap/huy · nhóm:
  // in_production/closed). `san_xuat_lenh_dong` = KCS đóng / mở lại lệnh (cả nhóm).
  | {
      type: "san_xuat_kcs_changed";
      cong_viec_id?: number | null;
      kcs_batch_id?: number | null;
      loi_id?: number | null;
      team_id?: number | null;
      lsx_id?: number | null;
    }
  | {
      /** KCS vừa kiểm một công đoạn của tổ — đẩy tới người Xác nhận sản lượng trọn tổ đó. */
      type: "san_xuat_kcs_ket_qua";
      team_id?: number | null;
      cong_viec_id?: number | null;
      loi_id?: number | null;
      lsx_ma?: string | null;
      ten_cong_doan?: string | null;
      /** Có = lỗi của công đoạn này bị KCS bắt ở bước sau (tên bước bắt); `so_loi` là phần quy về. */
      phat_hien_o?: string | null;
      /** `false` = công đoạn giữa: KCS chỉ ghi lỗi, không có số đạt. */
      la_kcs_cuoi?: boolean | null;
      don_vi?: string | null;
      so_dat?: number | null;
      so_loi?: number | null;
      nguoi_kiem?: string | null;
    }
  // Yêu cầu NHẬP thành phẩm từ KCS đổi (KCS vừa gửi / kho ghi sổ). `trang_thai` = trạng thái yêu cầu
  // kho (`approved` | `partial` | `done` | `cancelled`…). `_changed` broadcast để màn KCS / hồ sơ lệnh
  // tải lại; `san_xuat_kho` đẩy đích danh người KCS đã gửi khi kho ghi sổ.
  | {
      type: "san_xuat_kho_changed";
      cong_viec_id?: number | null;
      request_id?: number | null;
      ma?: string | null;
      trang_thai?: string | null;
    }
  | {
      type: "san_xuat_kho";
      cong_viec_id?: number | null;
      request_id?: number | null;
      ma?: string | null;
      trang_thai?: string | null;
    }
  | {
      type: "san_xuat_lenh_dong";
      nhom_id?: number | null;
      order_id?: number | null;
      kieu?: "dong" | "mo_lai" | null;
      lenh_ma?: string[];
      da_dat?: number | null;
      muc_tieu?: number | null;
      don_vi?: string;
    }
  // Đề nghị cấp vật tư của MỘT công đoạn vừa đổi (tạo/sửa lần đề nghị — `services/san_xuat/
  // vat_tu_de_nghi.py`). Backend `hub.broadcast` gửi cho MỌI kết nối, KHÔNG theo phạm vi, nên hai
  // cổng lọc nằm hết ở FE (xem AppShell): gác quyền đọc `san_xuat` trước khi toast, và chỉ nạp
  // lại drawer khi `cong_viec_id` trùng việc đang mở. Payload đúng HAI khoá, không hơn.
  | { type: "san_xuat_vat_tu_de_nghi_changed"; cong_viec_id: number }
  // Bảng giữ chỗ vật tư (Kế hoạch vật tư) đổi — bật/tắt/nhặt thêm/chuyển kho/đối soát — gửi
  // BROADCAST (không riêng ai), chỉ để báo "tự tải lại", không mang state.
  | { type: "ke_hoach_vat_tu_thay_doi" };

// --- Trung tâm thông báo (chuông Topbar) -------------------------------------
export interface AppNotification {
  id: number;
  loai: string;
  tieu_de: string;
  noi_dung: string | null;
  /** Đích điều hướng: 'kho_inbox' (Hộp yêu cầu) · 'kho_mine' (màn Yêu cầu). NULL = không nhảy. */
  link_loai: string | null;
  link_id: number | null;
  read_at: string | null;
  da_doc: boolean;
  created_at: string;
}

export interface NotificationList {
  items: AppNotification[];
  unread: number;
}

// --- Lệnh sản xuất (LSX) — bàn Kế hoạch sản xuất ------------------------------
// Job (đơn) → Part (lệnh) → Operation (công đoạn). Mỗi DÒNG ĐƠN = 1 lệnh, ngang hàng.
export type LsxTrangThai =
  | "nhap"
  | "cho_bo_sung"
  | "san_sang"
  | "da_lap_ke_hoach"   // đã sinh dòng xếp lịch (≈ Firm Planned) — routing khóa
  | "da_phat_hanh"      // đã phát hành xuống xưởng (≈ Released)
  | "da_dong";          // KCS đã đóng lệnh — mở lại về da_phat_hanh
export type LsxDonVi = "to_nguyen" | "to" | "cai" | "kem" | "bai";
/** Loại bước = tài nguyên mà bước chiếm khi lên lịch. */
export type LsxLoaiBuoc = "may" | "to" | "thue_ngoai";



/** Nhãn + màu của loại bước. `tone` map sang class `.khsx-lb--{tone}` trong ke-hoach-sx.css. */
export const LSX_LOAI_BUOC_META: Record<LsxLoaiBuoc, { label: string; tone: string; hint: string }> = {
  may: { label: "Máy", tone: "may", hint: "Chiếm máy — có thanh trên lịch máy" },
  to: { label: "Tổ", tone: "to", hint: "Tổ lao động làm tay — chiếm nhân công, không chiếm máy" },
  thue_ngoai: { label: "Thuê ngoài", tone: "ngoai", hint: "Nhà gia công ngoài làm — chọn nhà gia công trong danh mục Nhà cung cấp; không tổ, không máy, không vật tư, không tính thời gian" },
};

/** Đơn vị bốn chặng của lệnh đang xét — xem `pages/lsxBuoc.donViChuoi`. Khai lại hình dạng tối
 *  thiểu ở đây để `client.ts` không phải import ngược từ `pages/`. */
export interface DonViNhan { to: string; tp: string; tay: string; toNguyen: string }
const DV_TRONG: DonViNhan = { to: "", tp: "", tay: "", toNguyen: "" };

/** Nhãn checklist: chuỗi cố định, hoặc HÀM khi câu cần gọi tên đơn vị của chính lệnh đó. */
type NhanMa = string | ((dv: DonViNhan) => string);

/** Mã checklist "thiếu gì" → nhãn hiển thị (server trả mã, FE dịch). CHẶN nút Sẵn sàng.
 *
 *  Bốn câu nhắc tới ĐƠN VỊ là HÀM, không phải chuỗi (12/08/2026): tên đơn vị do xưởng đặt trong
 *  danh mục, viết cứng "tờ in → con" thì lệnh khai `to_chay`/`sp_xong` đọc lên là hai chữ KHÔNG
 *  tồn tại trên màn hình — người dùng đi tìm không thấy. Không đọc được đơn vị (routing chưa khai)
 *  thì hàm tự lùi về câu chung, KHÔNG bịa tên. */
export const LSX_THIEU_LABELS: Record<string, NhanMa> = {
  khong_co_ptg: "Chưa có bài tính giá",
  thieu_giay: "Thiếu loại giấy",
  thieu_kho: "Thiếu kích thước",
  thieu_routing: "Chưa có công đoạn",
  thieu_ngay_giao: "Thiếu ngày giao",
  thieu_to_may: "Có công đoạn chưa gán tổ / máy",
  thieu_nha_gia_cong: "Có bước thuê ngoài chưa chọn nhà gia công",
  // Bước cần dụng cụ lưu kho (khuôn bế) mà chưa trỏ con dao nào. Đứng NGANG HÀNG
  // với thiếu nhà gia công — cùng một danh sách, người dùng không phải học luật mới.
  thieu_khuon: "Có công đoạn cần khuôn / khung mà chưa chọn",
  // Bước Máy/Tổ giao cho một tổ chưa khai công việc khoán nào (18/09/2026, spec §5.4): thợ mở bàn
  // tổ ra không có việc nào để ghi mẻ ⇒ cả lệnh đứng ở tổ đó. Thuê ngoài miễn.
  // Hệ số quy đổi nay do server suy, không ai khai — chỉ thiếu NGUỒN của nó mới là lỗi thật.
  // Ba cầu, ba nguồn KHÁC NHAU: đổi mức lấy Con/tờ, xả giấy lấy số mảnh xả, còn sách thì lấy
  // số trang / trang mỗi tay (KHÔNG dùng con/tờ) — nên lệnh sách thiếu ở chỗ khác lệnh tờ rời.
  thieu_con_tren_to: (dv) =>
    dv.to && dv.tp
      ? `Chưa khai Con/tờ — có công đoạn đổi ${dv.to} → ${dv.tp}`
      : "Chưa khai Con/tờ — có công đoạn đổi cách đếm",
  thieu_manh_xa: (dv) =>
    dv.toNguyen && dv.to
      ? `Chưa có số mảnh xả — có công đoạn đổi ${dv.toNguyen} → ${dv.to}`
      : "Chưa có số mảnh xả — có công đoạn xả giấy",
  thieu_trang_moi_tay: (dv) =>
    dv.tay && dv.tp
      ? `Chưa khai Số trang / Trang mỗi tay — có công đoạn đổi ${dv.tay} → ${dv.tp}`
      : "Chưa khai Số trang / Trang mỗi tay — có công đoạn gom tay thành cuốn",
};

/** Mã → câu, đã thế tên đơn vị của CHÍNH lệnh đang xét. Mã lạ ⇒ trả mã trần (thà thấy mã còn hơn
 *  nuốt mất). `dv` bỏ trống ⇒ câu lùi về bản chung, không có tên đơn vị nào. */
export function nhanMa(
  bang: Record<string, NhanMa>, ma: string, dv?: DonViNhan | null,
): string {
  const n = bang[ma];
  if (n === undefined) return ma;
  return typeof n === "function" ? n(dv || DV_TRONG) : n;
}

// --- Bài ghép (print gang) — gom công đoạn in nhiều LSX chạy chung 1 tờ --------
export type BaiGhepTrangThai = "nhap" | "san_sang";

/** Checklist CHẶN "sẵn sàng xếp lịch" (server trả mã, FE dịch). */
export const BAI_GHEP_THIEU_LABELS: Record<string, string> = {
  thieu_thanh_vien: "Cần ít nhất 2 lệnh",
  thieu_giay: "Chưa chọn giấy chạy chung",
  thieu_kho_in: "Chưa có khổ tờ in chung",
  thieu_ups: "Có thành viên chưa khai số con/tờ",
  // Chưa gộp bước nào = N lệnh rời, chưa phải bài ghép. Đây là trạng thái MẶC ĐỊNH của bài mới
  // tạo, nên thiếu nhãn là ai mở bài cũng thấy chữ mã trần.
  thieu_buoc_chung: "Chưa gộp bước nào — chọn bước cùng công đoạn ở các lệnh rồi bấm Gộp",
  thieu_ke_hoach_buoc_chung: "Lượt chạy chung chưa có tổ / máy / năng suất",
  thieu_so_to: "Chưa tính được số tờ",
  khac_giay: "Giấy của bài lệch giấy đang khai ở một thành viên",
  buoc_chung_thieu_thanh_vien: "Bước dùng chung chưa gộp đủ mọi thành viên trong bài",
  thieu_buoc_chung_tren_giay: "Chưa có bước dùng chung nào nằm trên dòng giấy (điểm toả)",
  vuot_con_toi_da: "Số con/tờ vượt khả năng khổ tờ ghép",
  vuot_dien_tich: "Diện tích thành phẩm vượt quá tờ ghép",
};

/** Cảnh báo MỀM — chỉ tô màu, không chặn. Chỉ còn tín hiệu về TRẠNG THÁI đơn/lệnh.
 *
 *  ĐÃ BỎ `khac_giay` / `khac_so_mau` / `khac_so_mat` / `bai_thua`: điều kiện gộp chỉ là cùng công
 *  đoạn, còn quy cách thì người dùng có nghiệp vụ đó — máy không phán hộ. Bảng "Kiểm tương thích"
 *  (bảng máy tự kết luận Phù hợp / Cần xác nhận) cũng đã gỡ 17/08/2026: giấy · mực · số mặt · khổ
 *  TP của từng thành viên nằm sẵn trong bảng thành viên để người tự so. */
export const BAI_GHEP_CANH_BAO_LABELS: Record<string, string> = {
  co_gap: "Có lệnh GẤP trong bài",
  lech_han: "Hạn giao các lệnh lệch nhau xa",
  thanh_vien_khong_san_sang: "Có lệnh không còn sẵn sàng",
  don_huy: "Có lệnh thuộc đơn đã huỷ",
};

export interface HangChoGhepItem {
  lsx_id: number; ma: string; ten: string | null;
  so_luong_dat: number; don_vi_tinh: string | null; so_con: number;
  han_hoan_thanh_sx: string | null; is_rush: boolean;
  order_id: number | null; customer_name: string | null;
  giay_id: number | null; giay_ten: string | null; gsm: number | null;
  so_mau_a: number | null; so_mau_b: number | null; quy_cach_in: string | null;
  /** TẬP mã mực mỗi mặt — hai lệnh cùng nhãn "4/1" vẫn có thể khác bộ bản. */
  muc_a: string[]; muc_b: string[];
  kho_tp: string | null; kho_in: string | null;
}
export interface HangChoGhepOut {
  items: HangChoGhepItem[];
  total: number;
  /** Số lệnh KHỚP MỌI BỘ LỌC nhưng bị giấu vì đang giữ chỗ vật tư.
   *
   *  Lệnh đang giữ chỗ không hiện ở hàng chờ ghép — nhưng biến mất im lặng thì người ghép đi tìm
   *  một mã cụ thể sẽ không phân biệt nổi ba lý do: chưa sẵn sàng · là ruột sách · đang giữ chỗ.
   *  Chỉ lý do thứ ba là thứ họ tự gỡ được, nên phải nói ra. */
  so_giu_cho: number;
}

export interface BaiGhepListItem {
  id: number; ma: string; trang_thai: BaiGhepTrangThai; so_lsx: number;
  giay_ten: string | null; kho_in: string | null;
  so_to_tot: number; tong_to: number; han_in_muon_nhat: string | null; so_canh_bao: number;
  /** 0 = chưa gộp bước nào ⇒ mới là N lệnh rời, chưa thành bài ghép. Server vẫn luôn trả (schema
   *  `BaiGhepListItem` có sẵn), chỉ là type này quên khai. */
  so_buoc_chung: number;
  /** Giấy phải LĨNH KHO = tờ in + hao lượt chung — khác `so_to_tot` (tờ in). */
  to_nguyen_can: number;
  hao_de_xuat: number;
}
export interface BaiGhepListOut { items: BaiGhepListItem[]; total: number }

export interface BaiGhepThanhVien {
  thanh_vien_id: number; lsx_id: number; lsx_ma: string | null; lsx_ten: string | null;
  customer_name: string | null;
  so_luong_dat: number; don_vi_tinh: string | null; is_rush: boolean; trang_thai_lsx: string | null;
  so_con_tren_to: number; san_luong_du_kien: number; du: number;
  /** Bước gộp CUỐI CÙNG của lệnh = điểm toả. null = lệnh chưa gộp bước nào. */
  toa_step_key: string | null;
  /** Số tờ lệnh THẬT SỰ cần — đã gồm hao các bước riêng, khác `ceil(SL đặt / con)`. */
  nhu_cau_to: number;
  du_to: number;
  phan_giay_to: number; ty_le_giay: number;
  /** D3: gợi ý con/tờ — tối đa theo khổ (ước lượng) + gợi ý cân sản lượng để giảm dư. 0 = không có. */
  con_toi_da: number; con_goi_y: number;
  giay_id: number | null; giay_ten: string | null;
  so_mau_a: number | null; so_mau_b: number | null; quy_cach_in: string | null;
  muc_a: string[]; muc_b: string[];
  kho_tp: string | null; han_hoan_thanh_sx: string | null;
}
/** Sơ đồ bài ghép — routing ĐẦY ĐỦ từng lệnh + các bước NGƯỜI khai là chạy chung.
 *  DẪN XUẤT ở server, không lưu cạnh: hình tụ-rồi-toả rơi ra từ phép co nút. */
export interface BaiGhepSoDoNode {
  step_key: string; ten: string; nhom: string | null; loai_buoc: LsxLoaiBuoc; thu_tu: number;
  /** Khoá điều kiện gộp: chỉ các bước CÙNG công đoạn mới gộp được với nhau. */
  cong_doan_id: number | null;
  /** Khác null = bước này đang bị một bước chung ĐÈ (thẻ chung mới là nơi hiện số/tổ/máy). */
  gop_step_key: string | null;
  to_ten: string | null; may_ten: string | null; nha_cung_cap: string | null;
  tong_phut: number; chiem_may_phut: number;
  /** Dải nhanh–chậm nhất theo tốc độ tối đa / tối thiểu của máy (= TB nếu chưa khai dải). */
  chiem_may_phut_min: number; chiem_may_phut_max: number;
  phu_thuoc_step_keys: string[];
  /** Sau điểm toả là số LƯỢT ĐI (bài chạy bấy nhiêu tờ thì bước này thật sự nhận/ra bấy nhiêu);
   *  trước đó là lượt về của chính lệnh. null ở bước ngoài dòng giấy (chế bản đếm kẽm). */
  so_luong_vao: number | null; so_luong_ra: number | null;
  don_vi_vao: string | null; don_vi_ra: string | null; hao_hut: number | null;
}
/** Một lượt chạy CHUNG — thẻ trải ngang, nhánh tụ vào trái và toả ra phải. */
export interface BaiGhepSoDoBuocChung {
  /** `id` của bai_ghep_cong_doan — dùng NEO NHÃN (TagPicker). Ổn định như `step_key`. */
  id: number;
  step_key: string; ten: string; nhom: string | null; cong_doan_id: number | null;
  loai_buoc: LsxLoaiBuoc; thu_tu: number;
  /** `false` = bước chế bản (chung BẢN/kẽm), KHÔNG trên dòng giấy → thẻ ẩn số tờ vào/ra. */
  tren_giay: boolean;
  /** Số của CẢ LƯỢT. Đơn vị lấy từ khai báo công đoạn — bước bế nhả `cai` thì `so_luong_ra` đếm con. */
  so_luong_vao: number; so_luong_ra: number;
  don_vi_vao: string | null; don_vi_ra: string | null;
  /* `san_luong_dien_giai` + `loi_quy_doi` GỠ 18/09/2026 (mg `0324`) cùng công thức sản lượng ra
     của công đoạn — bước ngoài dòng giấy không còn số ở cấp bài. */
  /** `ra` quy về ĐƠN VỊ VÀO + hệ số đã dùng — cùng bộ số `bu_hao_chi_tiet` của tính giá. Thiếu hai
   *  số này thì dòng đổi đơn vị đọc lên vô lý ("20.500 tờ → 2.050 cuốn" mà không nói 10 tờ = 1 cuốn). */
  he_so_quy_doi: number; so_luong_ra_quy: number | null;
  /** Hao đếm ĐÚNG MỘT LẦN cho cả lượt, ở ĐƠN VỊ VÀO — thứ mất trên máy là tờ, không phải con. */
  hao_hut: number; hao_hut_pct: number;
  /** Chuỗi đứt đơn vị / thiếu hệ số — phải lộ ra, đừng lặng lẽ chạy hệ số 1. */
  canh_bao_don_vi: string[];
  /** T3: cảnh báo mềm máy không hợp công đoạn (sai loại / vượt khổ-màu-gsm). */
  may_khong_hop: string[];
  /** T3: nhóm máy (loai_may) làm được công đoạn này — FE lọc dropdown máy theo đây. [] = không ràng buộc. */
  nhom_may_cho_phep: string[];
  /** Tổ phụ trách khai ở danh mục Công đoạn — ô TỔ của lượt chung chỉ mời các tổ này (tổ đang
   *  gán lệch vẫn hiện để không mất dấu). [] = công đoạn chưa khai tổ, không giới hạn. */
  to_chon_duoc: number[];
  /** Đã khai gì đó cho lượt chung chưa → tách ra là mất. Cờ THẬT của server, đừng dò chuỗi `thieu`. */
  da_lap_ke_hoach: boolean;
  /** ID + TÊN: `<select>` cần id để chọn đúng, nhãn cần tên. Chỉ có tên là form phải lấy tên làm
   *  `value` rồi so chuỗi với id — tổ đã gán vẫn hiện "— chọn tổ —". */
  department_id: number | null; to_ten: string | null;
  may_id: number | null; may_ten: string | null;
  nha_cung_cap: string | null;
  tong_phut: number; chiem_may_phut: number;
  chiem_may_phut_min: number; chiem_may_phut_max: number;
  /** SỐ GIỜ KẾ HOẠCH của lượt chung loại TỔ — ô gõ tay, mặc định 0 (mg `0319`), cùng hợp đồng
   *  với bước lệnh. Kíp chuẩn + năng suất chép từ đầu việc GỠ 18/09/2026 (mg `0320`, `0321`). */
  so_gio_ke_hoach: number;
  /** Dẫn xuất từ tốc độ máy; `setup_phut` kế thừa từ máy. Ô gõ được duy nhất là
   *  `phat_sinh_phut` ("Thời gian khác"). `cho_phut`/`di_chuyen_phut` đã bỏ. */
  chay_phut: number | null;
  setup_phut: number; phat_sinh_phut: number;
  /** Bóc tách thời lượng y như bước lệnh (thay giấy · thay kẽm · tra dầu · công thức chạy) —
   *  cùng một `thoi_luong_buoc()` sinh ra. Có nó thì drawer nói được VÌ SAO ra số phút đó. */
  thoi_luong_dien_giai: Record<string, unknown>;
  so_luot_chay: number;
  /* Đầu việc ghim ở lượt chung (`khoan_rate_id` · `khoan_ten` · `khoan_chon_duoc`) GỠ 18/09/2026
     (mg `0320`): việc khoán chọn LÚC GHI MẺ ở bàn tổ, không chọn ở kế hoạch. */
  vat_tus: { vat_tu_id: number; ma: string; ten: string; don_vi: string; so_luong: number;
             nguon_so_luong: string }[];
  /** Lượng TÍNH SẴN cho mọi vật tư theo lượt chung — cùng hợp đồng với bước lệnh. Món chưa tính
   *  ra được vẫn có mặt (`so_luong: null`) kèm `ly_do` chỉ chỗ khai công thức. */
  vat_tu_goi_y: { vat_tu_id: number; so_luong: number | null;
                  dien_giai: string | null; ly_do: string | null }[];
  /** Nhà gia công của bước chung thuê ngoài (spec 2026-09-27) — tên `nha_cung_cap` do máy chủ ghi.
   *  Mang đi / chốt số nằm ở khối Gia công ngoài của màn bài ghép, không khai dự kiến ở đây. */
  nha_cung_cap_id: number | null;
  ghi_chu: string | null; ma_bai_ghep: string | null;
  /** Lệnh nào bị đè + ghi chú kỹ thuật của lệnh đó (GOM, không đè). */
  thanh_vien: { lsx_id: number; lsx_ma: string | null; lsx_step_key: string;
                ghi_chu_ky_thuat: string | null }[];
  thieu: string[];
}
export interface BaiGhepSoDoNhanh {
  thanh_vien_id: number; lsx_id: number; lsx_ma: string | null; lsx_ten: string | null;
  customer_name: string | null; han_hoan_thanh_sx: string | null; is_rush: boolean;
  /** Chỉ số màu của nhánh — FE map sang bảng màu, để ba đơn hàng cạnh nhau không lẫn. */
  mau: number;
  so_con_tren_to: number;
  toa_step_key: string | null;
  nhu_cau_to: number; du: number; san_luong_du_kien: number;
  /** Dư TỜ ngay tại điểm toả — khác dư con ở cuối chuỗi. */
  du_to: number;
  /** Phần giấy lệnh này gánh, chia theo CON. Tờ dùng chung nên không có "tờ của lệnh nào" —
   *  chia được là CHI PHÍ giấy, theo diện tích chiếm trên tờ. */
  phan_giay_to: number; ty_le_giay: number;
  /** Routing ĐẦY ĐỦ của lệnh, theo thứ tự. Bước đã gộp mang `gop_step_key`, không biến mất. */
  buoc: BaiGhepSoDoNode[];
}
export interface BaiGhepSoDo {
  bai_ghep: {
    id: number; ma: string; trang_thai: string;
    may_id: number | null; may_ten: string | null;
    giay_id: number | null; giay_ten: string | null;
    kho_in_dai: number | null; kho_in_rong: number | null;
    hao_hut_setup: number | null; hao_hut_chay: number | null;
    so_to_tot: number; tong_to: number; fill_pct: number | null;
    /** Hao đề xuất của các lượt chung, tách setup/chạy vì hai thứ áp khác nhau. */
    hao_de_xuat: number; hao_setup_de_xuat: number; hao_chay_de_xuat: number;
    /** Giấy phải LĨNH KHO = tờ in + hao. Khác `so_to_tot` (tờ in). */
    to_nguyen_can: number;
    so_buoc_chung: number;
  };
  nhanh: BaiGhepSoDoNhanh[];
  gop: BaiGhepSoDoBuocChung[];
  /** Tiền nhiệm NGOÀI bài (vd ruột sách cùng đơn) → node bóng mờ. */
  ngoai: { step_key: string; ten: string; lsx_ma: string | null }[];
}

export interface BaiGhepSoTo {
  so_to_tot: number; tong_to: number; fill_pct: number | null; han_in_muon_nhat: string | null;
  /** Hao của các lượt chạy chung (tách setup/chạy), và giấy phải lĩnh kho (= tờ in + hao). */
  hao_de_xuat: number; hao_setup_de_xuat: number; hao_chay_de_xuat: number;
  /** T1: hao THẬT đang áp (tôn trọng khai tay/khai 0) + tỷ lệ hao/tốt (cảnh báo makeready nuốt sản lượng). */
  hao_ap_dung: number; ty_le_hao: number;
  /** T4: breakdown hao đề xuất per bước chung — để tooltip "Giấy lĩnh kho" nối tổng với thẻ. */
  hao_theo_buoc: { ten: string; hao: number }[];
  to_nguyen_can: number; so_buoc_chung: number;
  rows: { thanh_vien_id: number; lsx_id: number; can: number; con: number; co_gop: boolean;
          toa_step_key: string | null;
          nhu_cau_to: number; du_to: number; san_luong_du_kien: number; du: number }[];
}

/** Kế hoạch của lượt chạy chung. Số lượng/hao/thời lượng KHÔNG có ở đây — chúng là dẫn xuất. */
export interface BaiGhepBuocChungBody {
  department_id?: number | null; may_id?: number | null; loai_buoc?: LsxLoaiBuoc;
  /** Số giờ kế hoạch của lượt chung loại TỔ — số thập phân ≥ 0, để 0 là hợp lệ (mg `0319`). */
  so_gio_ke_hoach?: number | null;
  /** Ô DUY NHẤT còn gõ được (2026-08-04): chuẩn bị + tốc độ kế thừa SỐNG từ máy đang gán. */
  phat_sinh_phut?: number; so_luot_chay?: number;
  ghi_chu?: string | null;
  vat_tus?: { vat_tu_id: number; so_luong: number; nguon_so_luong?: string }[];
  /** Nhà gia công (NCC có tích "Nhận gia công") — chỉ khi loại bước là thuê ngoài. */
  nha_cung_cap_id?: number | null;
}
/** `step_key → gộp thêm vào được không, không thì vì sao` (kiểm TRƯỚC khi cho bấm Gộp). */
export interface BaiGhepUngVienGop {
  ung_vien: Record<string, { gop_duoc: boolean; ly_do: string | null }>;
}
export interface BaiGhepDetail {
  id: number; ma: string; trang_thai: BaiGhepTrangThai;
  giay_id: number | null; giay_ten: string | null;
  /** Quy cách CẢ TỜ GHÉP — server tính lúc đọc: định lượng + khổ tờ mua về lấy thẳng danh mục
   *  giấy, mực/kẽm là HỢP tập của mọi thành viên (chung tờ = chung một bộ bản). */
  gsm: number | null; kho_nguyen_dai: number | null; kho_nguyen_rong: number | null;
  quy_cach_in: string | null; quy_cach_in_lech: boolean;
  muc_a: string[]; muc_b: string[];
  so_mau_a: number; so_mau_b: number; so_mau_pha: number; so_kem: number;
  kho_in_dai: number | null; kho_in_rong: number | null;
  may_id: number | null; may_ten: string | null;
  /** `null` = CHƯA KHAI (bài dùng hao máy đề xuất) · `0` = khai "chạy đúng số, không bù". */
  hao_hut_setup: number | null; hao_hut_chay: number | null; ghi_chu: string | null;
  thanh_vien: BaiGhepThanhVien[];
  so_to: BaiGhepSoTo;
  thieu: string[]; canh_bao: string[];
}
export interface BaiGhepUpdateBody {
  giay_id?: number | null; kho_in_dai?: number | null; kho_in_rong?: number | null;
  /** Gửi `null` = xoá khai báo (quay về hao máy đề xuất); gửi `0` = khai "không bù hao". */
  may_id?: number | null; hao_hut_setup?: number | null; hao_hut_chay?: number | null;
  ghi_chu?: string | null;
}

/** Metadata riêng của Bài ghép 2. Các phép tính/routing vẫn dùng chung engine Bài ghép. */
export interface BaiGhep2Meta {
  ten: string;
  han_hoan_thanh_sx: string | null;
  is_rush: boolean;
  nguoi_phu_trach_id: number | null;
  nguoi_phu_trach_ten?: string | null;
}
export interface BaiGhep2ListItem extends BaiGhepListItem, BaiGhep2Meta {}
export interface BaiGhep2ListOut { items: BaiGhep2ListItem[]; total: number }
export interface BaiGhep2Detail extends BaiGhepDetail, BaiGhep2Meta {}
export interface BaiGhep2UpdateBody extends BaiGhepUpdateBody {
  ten?: string;
  han_hoan_thanh_sx?: string | null;
  is_rush?: boolean;
  nguoi_phu_trach_id?: number | null;
}
export interface BaiGhep2NguoiPhuTrachOption { id: number; ten: string }

export interface BaiGhep2VatTuDong {
  pham_vi: "bai_ghep" | "lsx";
  lsx_id: number | null;
  bai_ghep_id: number | null;
  buoc_id: number | null;
  gang_step_key?: string | null;
  ma: string;
  ten_viec: string | null;
  nhu_cau: number;
  nhu_cau_hien_thi: string;
}
export interface BaiGhep2VatTuNhom {
  loai_nhom: string;
  hang_loai: string;
  hang_id: number;
  hang_ma: string | null;
  hang_ten: string | null;
  don_vi_goc: string | null;
  tong_can: number;
  dong: BaiGhep2VatTuDong[];
}
export interface BaiGhep2VatTuHieuLuc {
  bai_ghep_id: number;
  items: BaiGhep2VatTuNhom[];
}
export interface BaiGhep2Activity {
  at: string | null;
  actor: string | null;
  action: string;
  detail: string | null;
}

// ============================ Xếp lịch (cấp LỆNH SẢN XUẤT) ============================
// Bàn xếp lịch DUY NHẤT của hệ: một dòng = một lệnh, người dùng chỉ đặt GIỜ BẮT ĐẦU, hệ trả ngày
// kết thúc. Không gán máy / gán tổ / xung đột — bàn theo công đoạn (`xep_lich_2`, `Xl2*`) làm việc
// đó, và đã xoá hẳn 18/09/2026 cùng router + màn.

/** Một đoạn máy CHẠY liền mạch — khối đậm bên trong thanh Gantt. Khoảng hở giữa hai đoạn là nghỉ
 *  giữa ca / ngoài ca / ngày nghỉ, không phải máy rảnh. */
export interface XlDoan {
  tu: string;
  den: string;
  buoc_index: number;
}

/** Một quãng lệnh THẬT SỰ chạy (theo phiên chạy của tổ), đã gộp phần các bước chồng giờ nhau. */
export interface XlDoanThucTe {
  tu: string;
  den: string;
}

/** Quãng lệnh ĐỨNG CHỜ lệnh khác trong cụm (5b) — bước đã sẵn sàng nhưng đợi lệnh kia. */
export interface XlDoanCho {
  tu: string;
  den: string;
  cong_doan_id: number;
}

/** Một bước của lệnh này dính một bước của lệnh khác — đường nối trên lưới + dải trong ngăn.
 *  `cho` = bước này đợi bước kia xong · `doi` = bước kia đợi bước này · `chung` = in chung bài ghép.
 *  `luc_nay`/`luc_khac` là hai đầu đường nối; `luc_khac = null` khi lệnh kia chưa xếp lịch. */
export interface XlNoi {
  loai: "cho" | "doi" | "chung";
  cong_doan_id: number;
  thu_tu: number;
  ten_buoc: string;
  lsx_id_khac: number;
  ma_khac: string;
  ten_lenh_khac: string;
  cong_doan_id_khac: number;
  thu_tu_khac: number;
  ten_buoc_khac: string;
  luc_nay: string | null;
  luc_khac: string | null;
  bai_ghep_ma: string | null;
  /** Giờ của chính bước BÊN NÀY — viền tím quanh bước in chung trên lưới. */
  bat_dau_nay: string | null;
  ket_thuc_nay: string | null;
}

/** Cụm lệnh PHÁT HÀNH CÙNG NHAU — hàng tiêu đề cụm trên lưới + thẻ "Phát hành cùng nhau". */
export interface XlCum {
  id: number;
  ten: string;
  /** Câu phụ, vd "cùng đơn DH015". */
  phu: string | null;
  bai_ghep_ma: string[];
  lsx: { lsx_id: number; ma: string; ten: string; trang_thai: string; co_lich: boolean; ket_thuc: string | null }[];
}

/** Ngày khai ở Lịch làm việc: `off` nghỉ lễ · `work` làm bù · `off1x` nghỉ khác. */
export interface XlNgayDacBiet {
  ngay: string;
  loai: "off" | "work" | "off1x" | string;
  ten: string | null;
}

/** Đèn vật tư của một lệnh — `muc`: `ok` · `vang` · `do`. */
export interface XlVatTu {
  lsx_id: number;
  muc: "ok" | "vang" | "do" | string;
  chu: string;
}

/** Phần LỊCH dùng chung giữa dòng Gantt và panel chi tiết. `bat_dau_at` rỗng = lệnh chưa xếp. */
export interface XlLich {
  bat_dau_at: string | null;
  ket_thuc: string | null;
  chay_phut: number;
  /** Nghỉ giữa ca + ngoài ca + ngày nghỉ. Trả lời đúng câu người dùng hỏi khi nhìn thanh:
   *  "vì sao nó dài hơn giờ chạy?". Tổng thanh = `chay_phut` + số này. */
  nghi_ngoai_ca_phut: number;
  /** Quãng đứng chờ lệnh khác trong cụm — KHÔNG nằm trong `nghi_ngoai_ca_phut`. */
  cho_phut: number;
  doan: XlDoan[];
  cho: XlDoanCho[];
  ghi_chu: string[];
  updated_at: string | null;
  /** Id cụm phát hành cùng nhau; `null` = lệnh đứng một mình. */
  cum_id: number | null;
  lien: XlNoi[];
}

/** Một dòng trên bàn Gantt = MỘT lệnh sản xuất. `da_doi`/`thong_bao` CHỈ có ở phản hồi của PUT. */
export interface XlDong extends XlLich {
  lsx_id: number;
  ma: string;
  ten: string;
  customer_name: string | null;
  trang_thai: string;
  is_rush: boolean;
  so_luong_dat: number;
  don_vi_tinh: string | null;
  so_to_ke_hoach: number;
  so_con: number;
  han_hoan_thanh_sx: string | null;
  han_giao_khach: string | null;
  may_ten: string | null;
  /** Số bước chưa tính được giờ (thiếu máy / quy đổi) — lệnh "có thể xong muộn hơn". */
  so_buoc_chua_gio: number;
  /** Bước chạy đè vùng khoá máy / máy đang dừng chờ sửa — câu máy chủ phát, chỉ nhắc không chặn. */
  canh_bao_may?: string[];
  /** Mép thanh của lệnh ĐÃ CHẠY DỞ — `null` khi lệnh chưa vào việc.
   *  Thanh vẽ từ `thuc_bat_dau_lenh ?? bat_dau_at` tới `ket_thuc_thuc_te ?? ket_thuc`; đoạn
   *  `thuc_bat_dau_lenh → bat_dau_at` là phần đã chạy, KHOÁ không kéo được. `bat_dau_at` vẫn là
   *  con số duy nhất kéo-thả ghi xuống. */
  thuc_bat_dau_lenh: string | null;
  ket_thuc_thuc_te: string | null;
  /** Các quãng lệnh THẬT SỰ chạy bên trong đoạn `thuc_bat_dau_lenh → bat_dau_at`. Cả đoạn đó là
   *  "đã vào việc rồi NẰM CHỜ": tô một tông "đã chạy" cho cả 5 ngày trong khi máy chạy 13 phút là
   *  bàn nói dối. Vẽ nền CHỜ cho cả đoạn rồi chồng các quãng này lên. */
  doan_thuc_te: XlDoanThucTe[];
  da_doi?: boolean | null;
  thong_bao?: string | null;
}

/** Lọc lưới Xếp lịch — gửi lên máy chủ. `nhanh`: nút lọc nhanh đầu màn. */
export interface XlLocLich {
  tim?: string;
  trang_thai?: string[];
  khach_id?: number;
  gap?: boolean;
  nhanh?: "tre" | "muon" | "chua";
}

export interface XlLien {
  /** Số lệnh của ba nút lọc nhanh, trên tập đã qua tìm + Lọc (chưa qua `nhanh`). */
  dem: { tre: number; muon: number; chua: number };
  /** Khách đang có lệnh trong cửa sổ — giá trị của ô lọc Khách hàng. */
  khach_loc: { id: number; ten: string; so: number }[];
  dong: XlDong[];
  tong: number;
  /** Ngày KHÔNG làm việc trong đúng cửa sổ vừa hỏi (YYYY-MM-DD): lễ, ngày làm bù, cấu hình tuần
   *  của xưởng. ĐỪNG tự suy "T7 + CN" — xưởng này khai làm thứ 7, đoán kiểu đó tô sai ngay cột
   *  đầu tiên, còn lễ với làm bù thì không có đường nào đoán. */
  ngay_nghi: string[];
  ngay_dac_biet: XlNgayDacBiet[];
  /** Ca xưởng — đầu màn ghi giờ ca. */
  cac_ca: { ten: string; tu: string; den: string; nghi_tu: string | null; nghi_den: string | null }[];
  cum: XlCum[];
}

/** Thẻ hàng chờ — lệnh đủ điều kiện xếp mà CHƯA có mốc. */
export interface XlThe {
  lsx_id: number;
  ma: string;
  ten: string;
  customer_name: string | null;
  han_hoan_thanh_sx: string | null;
  han_giao_khach: string | null;
  is_rush: boolean;
  so_to_ke_hoach: number;
  so_luong_dat: number;
  don_vi_tinh: string | null;
  chay_phut: number;
  so_buoc: number;
  /** Ngày tạo lệnh (ISO, có múi). */
  created_at: string | null;
}

export interface XlHangCho {
  dong: XlThe[];
  tong: number;
}

/** Dòng bảng công đoạn trong panel. HAI CHẾ ĐỘ, cắt bằng `trang_thai`:
 *   · `null` — lệnh CHƯA phát hành: không có mốc bước (màn cấp LỆNH, chưa có gì để so).
 *   · có giá trị — lệnh ĐÃ phát hành: `ke_hoach_*` so với `thuc_*`, chênh nằm ở `lech_phut`.
 *  `mau_index` mã hoá THỨ TỰ bước (sắc độ khối), không mã hoá loại. */
export interface XlCongDoan {
  id: number;
  thu_tu: number;
  ten: string;
  loai_buoc: string | null;
  /** Mã bài ghép đang phủ bước — có thì loại/tổ/nhà gia công là của BƯỚC CHUNG. */
  bai_ghep_ma?: string | null;
  /** Máy ĐANG GIAO CHẠY nếu lệnh đã phát hành, không thì máy kế hoạch — `may_nguon` nói rõ nguồn
   *  nào. Xưởng đổi máy thì `may_ke_hoach_ten` giữ tên máy kế hoạch để đối chiếu. Số giờ tính
   *  theo máy ĐANG CHẠY (tốc độ treo ở cặp công đoạn × máy). */
  may_id: number | null;
  may_ten: string | null;
  may_nguon: "thuc_thi" | "ke_hoach" | null;
  may_ke_hoach_ten: string | null;
  to_ten: string | null;
  /** `null` = kế hoạch CHƯA khai, KHÁC 0. Đừng in "0 tờ" cho ô chưa điền. */
  so_luong_vao: number | null;
  /** `don_vi_vao` là MÃ (`to`, `con`); in `don_vi_vao_ten` cho người đọc, đừng in mã thô. */
  don_vi_vao: string | null;
  don_vi_vao_ten: string | null;
  /** Số NGƯỜI tiêu chuẩn của bước — không phải mã kíp trực. */
  so_nguoi_chuan: number;
  chay_phut: number;
  /** `chua_quy_doi` = không tính được giờ; `canh_bao` là câu nói rõ thiếu gì (server phát). */
  phuong_phap: string | null;
  canh_bao: string | null;
  /** Lớp phụ thuộc; `song_song` = còn bước khác cùng lớp (bảng bày 1→N nhưng chúng không chặn
   *  nhau). Bàn cấp lệnh vẫn TRẢI TUẦN TỰ — chip chỉ nói thật, không đổi cách trải. */
  lop: number;
  song_song: boolean;
  la_thue_ngoai: boolean;
  mau_index: number;
  /** Trạng thái thẻ việc dưới xưởng. `null` ⇔ lệnh chưa phát hành ⇒ cả khối dưới đều `null`. */
  trang_thai: "released" | "running" | "paused" | "completed" | null;
  /** Mốc KẾ HOẠCH của bước (bản đã phát hành xuống xưởng). */
  ke_hoach_bat_dau: string | null;
  ke_hoach_ket_thuc: string | null;
  /** Mốc phiên chạy ĐẦU TIÊN; `null` = tổ chưa bấm Bắt đầu bao giờ. */
  thuc_bat_dau: string | null;
  /** Chỉ có khi bước đã ĐÓNG — đang chạy thì chưa có mốc xong để nói. */
  thuc_ket_thuc: string | null;
  /** Chênh mốc KẾT THÚC, phút. DƯƠNG = xong muộn, ÂM = xong sớm. Server tính trên mốc gốc —
   *  ĐỪNG trừ `thuc_ket_thuc - ke_hoach_ket_thuc` ở đây để dựng lại. */
  lech_phut: number | null;
  /** Giờ DẪN XUẤT của bước theo lịch kế hoạch (đã trải theo cụm). */
  du_kien_bat_dau: string | null;
  du_kien_ket_thuc: string | null;
  /** Bước sẵn sàng lúc này nhưng đợi lệnh khác tới `du_kien_bat_dau`. */
  cho_tu: string | null;
  lien: XlNoi[];
}

export interface XlChiTiet extends XlLich {
  lsx_id: number;
  ma: string;
  ten: string;
  trang_thai: string;
  is_rush: boolean;
  customer_name: string | null;
  order_no: string | null;
  customer_po_no: string | null;
  sale_name: string | null;
  so_luong_dat: number;
  don_vi_tinh: string | null;
  so_to_ke_hoach: number;
  so_to_nguyen: number;
  so_con: number;
  han_hoan_thanh_sx: string | null;
  han_giao_khach: string | null;
  nguoi_phu_trach_ten: string | null;
  luu_y_gui_xuong: string | null;
  /** Quy cách đọc từ ảnh chụp lúc tạo lệnh — khoá có thể trống. Trống thì BỎ ô, đừng in `null`. */
  giay: string | null;
  /** Mọi giấy khai ở các bước, theo thứ tự bước — hộp bồi couche + sóng là hai giấy. */
  giays?: string[];
  kho_in: string | null;
  so_mau: string | null;
  so_kem: string | null;
  // `so_nguoi_tong` GỠ 18/09/2026 (mg `0321`) cùng kíp chuẩn của bước.
  cong_doans: XlCongDoan[];
  /** Mốc xong TÍNH LẠI theo việc đã xảy ra — bước xong sớm kéo lùi, xong muộn đẩy ra. `null` ⇔
   *  `co_thuc_te=false` (lệnh chưa phát hành): khi đó panel bày MỘT số như trước.
   *  `ket_thuc` (từ `XlLich`) vẫn là mốc theo KẾ HOẠCH — hai số cố ý bày cạnh nhau. */
  ket_thuc_thuc_te: string | null;
  /** `ket_thuc_thuc_te - ket_thuc`, phút. DƯƠNG = thực tế đang kéo lệnh muộn hơn kế hoạch. */
  lech_ket_thuc_phut: number | null;
  co_thuc_te: boolean;
  /** Mốc CẢ LỆNH thật sự vào việc. KHÔNG đổi khi dời mốc — thứ dời được chỉ là PHẦN CÒN LẠI. */
  thuc_bat_dau_lenh: string | null;
  so_buoc_xong: number;
  so_buoc: number;
  cum: XlCum | null;
}

/** Một bước trong bảng so sánh hai phiên bản lịch. `a` là phiên bản NHỎ hơn (server tự sắp). */
export interface XlSoSanhDong {
  cong_viec_id: number;
  ten: string;
  phan_doan_so: number;
  phan_doan_tong: number;
  a: { may_ten: string | null; bat_dau: string | null; ket_thuc: string | null };
  b: { may_ten: string | null; bat_dau: string | null; ket_thuc: string | null };
  doi_gio: boolean;
  doi_may: boolean;
}

export interface XlSoSanh {
  lsx_id: number;
  a: number;
  b: number;
  dong: XlSoSanhDong[];
}

/** Một mốc trong lịch sử phiên bản gói phát hành (§4.3). `so`=1 là phát hành gốc; các số sau là mỗi
 *  lần Phát hành cập nhật (`loai="cap_nhat"`), kèm lý do. */
export interface XlGoiPhienBan {
  so: number;
  loai: string;
  ly_do: string | null;
  phat_hanh_by_id: number | null;
  luc: string | null;
}

/** Trạng thái gói phát hành của một LSX/bài ghép (§4.3): còn Phát hành cập nhật / Thu hồi được không +
 *  số việc đã/chưa bắt đầu + lịch sử phiên bản. `co_goi=false` ⇒ chưa phát hành (các field khác vắng). */
/** Khoảng máy nghỉ khai tay ở Xếp lịch. Mốc là GIỜ TƯỜNG của xưởng (`YYYY-MM-DDTHH:mm:ss`, không múi). */
export interface XlVungKhoa {
  id: number;
  may_id: number;
  start: string;
  finish: string;
  ly_do: string;
  note: string | null;
  kieu: string;
}

export interface XlMayGon {
  id: number;
  ma: string;
  ten: string;
}

export interface XlGoiPhatHanh {
  co_goi: boolean;
  goi_id?: number;
  ma?: string;
  trang_thai?: string;
  version_hien_tai?: number;
  so_cong_viec?: number;
  so_da_bat_dau?: number;
  so_chua_bat_dau?: number;
  cho_phep_cap_nhat?: boolean;
  cho_phep_thu_hoi?: boolean;
  phien_bans?: XlGoiPhienBan[];
  /** MỌI gói của lệnh, mới nhất trước — kể cả gói đã thu hồi kèm lý do (lỗi #25). */
  lich_su_goi?: XlGoiLichSu[];
}

export interface XlGoiLichSu {
  goi_id: number;
  ma: string;
  trang_thai: string;
  thu_hoi_ly_do: string | null;
  thu_hoi_luc: string | null;
  phien_bans: XlGoiPhienBan[];
}

/** Kết quả một lần Phát hành cập nhật (§4.3): tái chụp bao nhiêu việc, giữ nguyên bao nhiêu, huỷ bao
 *  nhiêu phân công/hỗ trợ để tổ xác nhận lại. */
/** Yêu cầu xuất vật tư hệ thống tự lập lúc phát hành (spec 2026-10-18 §4). `bo_qua` = món chưa
 *  tự lập được (tổ xin tay), kèm lý do. */
export interface XlVatTuTuLap {
  so_yeu_cau: number;
  bo_qua: { cong_viec_id: number; ten_cong_doan: string; ten_hang: string; ly_do: string }[];
}

export interface XlCapNhatOut {
  goi_id: number;
  ma: string;
  version_hien_tai: number;
  so_cong_viec_cap_nhat: number;
  so_giu_nguyen: number;
  so_huy_phan_cong: number;
  /** Số việc KHÔNG cập nhật được vì bước đã tách thêm / gộp lại sau phát hành: không còn lần chạy
   *  tương ứng để lấy giờ + máy. Chúng giữ nguyên snapshot cũ — muốn khớp lại phải thu hồi gói. */
  so_lech_phan_doan: number;
}


// --- Thực hiện sản xuất (module `san_xuat`) — bàn của TỔ ----------------------
// Mirror ĐÚNG `schemas/san_xuat.py` (Pydantic nuốt field lạ IM LẶNG — thêm/bớt field phải đi cả
// hai đầu). datetime serialize thành chuỗi ISO ⇒ dùng `string | null`. KHÔNG có mốc chạy thật trên
// WorkItem (mức bàn) — so kế-hoạch↔thực-tế nằm ở drawer (phien_chay + khoang_tham_gia).
export interface SxTeam {
  id: number;
  ten: string;
  ma: string;
  /** Độ sâu của nút trong cây khối sản xuất (0 = gốc) — menu thụt lề theo số này. */
  cap: number;
  /** Vai của NGƯỜI ĐANG XEM ở nút này, không phải thuộc tính của tổ: mức Xem của dòng quyền
   *  `to_sx_<id>` là "Của tôi" thì `true`. Máy chủ tính sẵn, đừng tự suy ở FE. */
  la_tho: boolean;
  /** Mức của người đang xem trên CHÍNH nút này theo từng việc (`read`/`run_order`/
   *  `confirm_output`/`warehouse` → "all" | "own"); thiếu khoá = không có quyền đó. */
  quyen: Partial<Record<SxViecTo, "all" | "own">>;
  so_viec_cho: number;
  /** Bàn giao đến + lỗi KCS đang chờ tổ trong vùng xác nhận (người xem giữ Xác nhận
   *  sản lượng trọn tổ) — cộng vào badge menu cùng `so_viec_cho`. */
  so_cho_xac_nhan: number;
}
/** Ba quyền chi tiết của dòng quyền theo tổ + Xem. Ô "KCS" (`qc`) GỠ ở mg 0306: KCS là dòng `kcs`
 *  riêng của ma trận vai (09/10/2026), kiểm được mọi tổ. */
export type SxViecTo = "read" | "run_order" | "confirm_output" | "warehouse";

/** Báo dừng máy (Đợt 2): một tổ một ngày một dòng; ngày đó tổ ăn chỉ tiêu ngày. */
export type SxLyDoDungMay = "may_hu" | "het_hang";
export interface SxDungMayIn {
  ngay: string;
  ly_do: SxLyDoDungMay;
  sua_chua_id?: number | null;
  ghi_chu?: string | null;
  /** Người hưởng — tổ trưởng tick. */
  nguoi_ids: number[];
}
/** Sửa ngày đã báo — mọi thứ trừ ngày. */
export type SxDungMaySuaIn = Omit<SxDungMayIn, "ngay">;
export interface SxDungMayNguoi { employee_id: number; ho_ten: string }
export interface SxDungMay {
  id: number;
  department_id: number;
  ngay: string;
  ly_do: SxLyDoDungMay;
  ly_do_ten: string;
  sua_chua_id: number | null;
  sua_chua_ma: string | null;
  ghi_chu: string | null;
  nguoi: SxDungMayNguoi[];
}
export interface SxPhieuSuaChon { id: number; ma: string; may_ten: string | null; bo_phan_hong: string | null }
export interface SxDungMayListOut {
  /** "YYYY-MM" kỳ lương đã chốt / đã chi — ngày thuộc kỳ đó không báo / sửa / xoá được. */
  ky_da_chot: string[];
  ds: SxDungMay[];
  nguoi: SxDungMayNguoi[];
  phieu_sua: SxPhieuSuaChon[];
}

export interface SxTeamsOut {
  teams: SxTeam[];
}

/** Một người có mặt trong mẻ. `to_ten` CHỈ có khi người đó không thuộc tổ chủ mẻ — nhãn
 *  "(Tổ bế)" để biết ngay ai là người nhà, ai sang giúp (spec 2026-09-18 §7.3b). */
export interface SxMeNguoi { employee_id: number; ho_ten: string; to_ten?: string | null }

/** Tab SẢN LƯỢNG của bàn tổ (spec 2026-09-14 §6, sửa 2026-09-18 §7.3b). Ngày = ngày BẮT ĐẦU mẻ
 *  theo giờ xưởng; mọi số đi theo ĐƠN VỊ, không cộng lẫn. Mẻ có MỘT chủ: tổ khác có người trong mẻ
 *  thấy mẻ ấy ở mục khách (`la_khach`) — cùng con số, KHÔNG vào dòng tổng. KHÔNG có ô tiền. */
export interface SxSlTotHong { don_vi: string | null; tot: number; hong: number }
export interface SxSlMe {
  batch_id: number;
  ngay: string | null;
  bat_dau: string | null;
  ket_thuc: string | null;
  viec_khoan_ten: string | null;
  tot: number;
  hong: number;
  don_vi: string | null;
  nguoi: SxMeNguoi[];
  /** Việc phát sinh của mẻ (ảnh chụp lúc ghi) — chỉ để bày, KHÔNG cộng vào sản lượng. */
  phat_sinh: SxSlPhatSinh[];
}
export interface SxSlPhatSinh {
  ten: string | null;
  so_luong: number;
  don_vi: string | null;
  don_vi_ten: string | null;
}
export interface SxSlCongDoan {
  cong_viec_id: number;
  ten_cong_doan: string;
  to_id: number | null;
  to_ten: string;
  /** Mẻ của TỔ KHÁC mà có người của tổ đang xem — mục "đi làm ở tổ khác", không cộng tổng. */
  la_khach: boolean;
  so_me: number;
  san_luong: SxSlTotHong[];
  me: SxSlMe[];
}
export interface SxSlKho { dai: number; rong: number }
export interface SxSlQuyCach {
  /** Lệnh nhiều giấy ⇒ danh sách tên (cùng ảnh chụp với thẻ quy cách bàn tổ). */
  giay: string | string[] | null;
  dinh_luong: number | null;
  to_nguyen: SxSlKho | null;
  to_in: SxSlKho | null;
  con: SxSlKho | null;
}
export interface SxSlLenh {
  nguon_loai: "lsx" | "bai_ghep";
  nguon_id: number | null;
  ma: string;
  ten: string;
  so_me: number;
  ngay_dau: string | null;
  ngay_cuoi: string | null;
  /** Giấy + ba khổ (mm) — cùng thẻ quy cách ở bàn tổ. */
  quy_cach: SxSlQuyCach | null;
  /** Chỉ gồm MẺ CỦA TỔ — mẻ khách không vào đây. */
  san_luong: SxSlTotHong[];
  cong_doan: SxSlCongDoan[];
}
export interface SxSanLuongTo {
  team_id: number;
  tu: string;
  den: string;
  to_id: number | null;
  trang: number;
  co_trang: number;
  tong_lenh: number;
  co_pham_vi_tron: boolean;
  co_pham_vi_rieng: boolean;
  cac_to: { id: number; ten: string; cap: number }[];
  /** Giá trị chọn được của nút "Lọc" (10/10/2026). */
  lua_chon?: { cong_doan: string[]; nguoi: { id: number; ten: string }[] };
  tong: (SxSlTotHong & { so_me: number })[];
  lenh: SxSlLenh[];
  cap_nhat_luc: string | null;
}
export interface SxSanLuongToLoc {
  team_id: number;
  tu?: string;
  den?: string;
  to_id?: number | null;
  tim?: string;
  trang?: number;
  co_trang?: number;
  /** Điều kiện nút "Lọc" (10/10/2026). */
  cong_doan?: string[];
  nguoi?: number[];
  phat_sinh?: "co" | "khong";
  loai?: "lsx" | "bai_ghep";
  gap?: "gap" | "thuong";
}

export interface SxWorkItem {
  id: number;
  /** Tổ THẬT của việc — bàn nút cha gộp việc của nhiều tổ con, thao tác theo tổ lấy id ở đây. */
  department_id: number | null;
  goi_id: number;
  phien_ban_so: number;
  nguon_loai: string;          // "lsx" | "bai_ghep" | ""
  nguon_ma: string;
  nguon_ten: string;
  /** Khách của lệnh; bài ghép = khách các lệnh thành viên nối " · ". null = lệnh không có đơn/khách. */
  khach_hang?: string | null;
  /** ĐVT thành phẩm của lệnh ("cuốn") — tên chặng "cai". null = bước chạy chung của bài ghép. */
  don_vi_tinh?: string | null;
  nhom_id: number | null;      // id nhóm thành phẩm (khoá cho panel Kho §14 + checklist đóng §16)
  nhom: string;                // nhãn nhóm thành phẩm
  ten_cong_doan: string;
  nhom_cong_doan: string | null;
  loai_buoc: string;           // "may" | "to" | "thue_ngoai"
  /** Công đoạn cuối của nhóm thành phẩm — KCS kiểm đạt ở đây mới được đề nghị nhập kho. */
  la_kcs_cuoi: boolean;
  /** Dấu KCS trên thẻ việc (mg 0306): số lần KCS đã kiểm công đoạn này + Σ đạt / Σ lỗi. */
  kcs_so_lan: number;
  kcs_dat: number;
  kcs_loi: number;
  may: string;
  may_id: number | null;       // máy HIỆN TẠI — dựng ô chọn "Đổi máy" (§7.2 mở rộng)
  du_kien_bat_dau: string | null;
  du_kien_ket_thuc: string | null;
  nhan_luc?: string | null;    // lúc việc tới tay tổ (phát hành tạo thẻ việc) — mốc để lọc/tra
  so_luong_vao: number | null;
  so_luong_ra: number | null;  // mục tiêu của bước — đã có sẵn, KHÔNG đẻ khoá `muc_tieu_ra` thứ hai
  /** Đơn vị BẢN ĐỊA của bước — cũng là đơn vị mặc định của ô Ghi mẻ. Bước ngoài dòng giấy chỉ có
   *  đơn vị khi người lập lệnh tự khai ở bước; không khai thì trống. */
  don_vi_vao: string | null;
  don_vi_ra: string | null;
  /** Bước NGOÀI dòng giấy (ghi kẽm đếm bản, đóng thùng đếm thùng): vào = ra nên cột "SL vào → ra"
   *  hiện MỘT số. Ảnh chụp lúc phát hành — FE KHÔNG suy lại được từ mã đơn vị. */
  ngoai_dong: boolean;
  // `sl_dien_giai` GỠ 18/09/2026 (mg `0324`) cùng công thức sản lượng ra của công đoạn.
  /** Phút CHẠY của thẻ (đã chia theo phần sản lượng của phân đoạn). Ba số bằng nhau ⇒ máy chưa
   *  khai dải tốc độ, UI bỏ phần trong ngoặc. null = lệnh phát hành trước 10/09/2026. */
  chay_phut: number | null;
  chay_phut_min: number | null;
  chay_phut_max: number | null;
  /** DẶN DÒ của kế hoạch (ô "Ghi chú kỹ thuật cho thợ" của bước), chụp lúc phát hành. */
  ghi_chu: string | null;
  /** THẺ QUY CÁCH rút gọn — tổ trưởng không có quyền `lsx` nên không mở nổi hồ sơ lệnh. */
  quy_cach: SxQuyCachThe | null;
  /** Lượng tổ THẬT SỰ nhận được (bàn giao đã xác nhận về bước này). null = không ai giao tới
   *  (bước đầu chuỗi lấy vật tư từ kho) — KHÁC hẳn với 0. */
  thuc_nhan: number | null;
  /** Tổng sản lượng TỐT đã ghi ở bước này. */
  da_lam: number | null;
  /** Mốc chấm THỰC — `so_luong_ra` đã rút theo tỉ lệ thực nhận; kế hoạch ở trên không bị đè. */
  muc_tieu: number | null;
  /** max(mục tiêu − đã làm, 0). null khi bước không khai mục tiêu — KHÁC hẳn với 0. */
  con_thieu: number | null;
  /** Luật ô tiến độ: nhận − tốt = lỗi. `nhan` đơn vị vào (bước đầu = số vào kế hoạch lấy từ kho),
   *  `nhan_ra` quy về đơn vị ra, `loi` chỉ có khi đã Kết thúc. null = không biết. */
  nhan?: number | null;
  nhan_ra?: number | null;
  loi?: number | null;
  trang_thai: string;          // "released" | "running" | "paused" | "completed"
  dinh_muc_vat_tu: SxVatTuDinhMuc[]; // định mức vật tư đóng băng lúc phát hành — KHÁC vật tư (phiếu xuất) ở drawer
  thuc_te: SxThucTeKhoang[];   // lớp thực-tế đè lên thanh kế hoạch (§5.1); phiên mở → ket_thuc=null
  /** Nhà gia công — ảnh chụp lúc phát hành, nuôi chip "Ngoài · <nơi làm>" ở mọi màn xưởng. */
  nha_cung_cap: string | null;
  /** Con dao/khung của bước — ảnh chụp lúc phát hành. `null` = bước không dùng dụng cụ.
   *  Có khuôn mà `khuon_da_nhan = false` ⇒ nút Bắt đầu bị BE chặn (cổng khuôn, 04/09/2026). */
  khuon: SxKhuonChip | null;
  khuon_da_nhan: boolean;
  khuon_da_tra: boolean;
  /** Người xem giữ Thực hiện lệnh trên việc này (máy chủ tính theo dòng quyền tổ, mức "Của tôi" chỉ
   *  bật trên việc đang giao cho mình) — nút chạy nhanh trên dòng bảng hiện theo cờ này. */
  chay_duoc: boolean;
  /** Họ tên người đang được giao — dòng phụ cột Trạng thái của lưới. Rỗng = chưa giao thợ; drawer
   *  không điền. */
  nguoi_lam?: string[];
  /** Bước của lệnh — tìm ô của việc trên dải routing (phân đoạn sau). */
  step_key?: string | null;
  /** Cột Vật tư của lưới — null = bước không cần vật tư. Drawer không điền. */
  trang_thai_vat_tu?: SxTrangThaiVatTu | null;
}
/** Mức vật tư của một bước — cùng hàm máy chủ với cổng Bắt đầu (spec 2026-10-18 §5.1). */
export type SxMucVatTu = "chua_yeu_cau" | "cho_kho" | "kho_dang_soan" | "cap_thieu" | "san_sang";
export interface SxTrangThaiVatTu {
  muc: SxMucVatTu;
  mon: {
    ten: string;
    dvt: string | null;
    sl_xin: number;
    sl_da_xuat: number;
    chot_thieu: boolean;
    lan_so: number | null;
    muc: string;
  }[];
}
/** Quy cách in RÚT GỌN đi theo thẻ việc (mg `0290`) — 8 dòng đủ để đứng máy, không phải bản sao
 *  của `lsx.quy_cach_json`. Khoá nào không có số thì server BỎ HẲN (không gửi `null`), nên UI chỉ
 *  vẽ những dòng thật sự có. Khổ đã ghép sẵn thành chuỗi mm ("640 × 450") ở server. */
export interface SxQuyCachThe {
  /** Tên mã loại Giấy. Lệnh cũ nhiều mã Giấy ⇒ danh sách tên, và không có `dinh_luong`. */
  giay?: string | string[];
  dinh_luong?: number;     // gsm của giấy (không bao giờ của sóng)
  /** Tên mã loại Sóng (mg 0426) — vắng khi lệnh không bồi sóng. */
  song?: string | string[];
  kho_nguyen?: string;     // khổ giấy nguyên (tờ mua về), chuỗi mm
  kho_in?: string;         // KHÔNG có = khổ tờ in 0 × 0 ⇒ in thẳng khổ giấy nguyên
  kho_tp?: string;
  /** Mã cách in của lệnh (`mot_mat` · `hai_mat` · `tu_tro` · `tro_nhip`) — nhãn qua `nhanCachIn`. */
  cach_in?: string;
  /** Mực TỪNG MẶT, đã chuẩn hoá (C/M/Y/K + mã Pantone). Bài ghép = hợp mực các lệnh thành viên. */
  muc_a?: string[];
  muc_b?: string[];
  so_mat?: number;
  so_mau?: number;
  so_kem?: number;
  so_con?: number;
  so_luong?: number;
  ghi_chu_ky_thuat?: string;
}
/** Ảnh chụp khuôn đủ để vẽ chip — KHÔNG phải bản sao của danh mục Khuôn & khung. */
export interface SxKhuonChip {
  ma: string | null;
  ten: string | null;
  so_ke: string | null;
  tinh_trang: string | null;
}
/** Một dòng định mức vật tư của bước (đóng băng lúc phát hành). */
export interface SxVatTuDinhMuc {
  vat_tu_id: number | null;
  ma: string | null;
  ten: string | null;
  don_vi: string | null;
  so_luong: number | null;
}
/** Một phiên chạy thực tế để vẽ overlay; `ket_thuc=null` = đang chạy (kéo tới "bây giờ"). */
export interface SxThucTeKhoang {
  bat_dau: string;
  ket_thuc: string | null;
}
/** MỘT lệnh SX (hoặc bài ghép) trên bàn tổ — bản ghi của bàn kể từ 11/09/2026.
 *
 *  Đơn vị VIỆC vẫn là CÔNG ĐOẠN: `cong_viec` là các bước tổ thật sự bấm Bắt đầu / Ghi sản lượng,
 *  giữ nguyên `SxWorkItem`. Lệnh chỉ là ĐẦU MỤC bọc ngoài để tổ trưởng biết công đoạn này thuộc
 *  lệnh nào. Bài ghép là MỘT dòng, không xé theo lệnh thành viên. */
/** Một BƯỚC trên dải routing của thẻ lệnh — chuỗi công đoạn đầy đủ, kể cả bước của tổ khác.
 *  `cong_viec_id` chỉ có ở bước của CHÍNH tổ mình: bước tổ khác là chỉ-đọc, không mở drawer. */
export interface SxRoutingBuoc {
  thu_tu: number;
  step_key: string | null;
  ten_cong_doan: string;
  to_id: number | null;
  to_ten: string | null;
  la_cua_toi: boolean;
  la_kcs_cuoi: boolean;
  /** Bước thuê ngoài — chấm viền cam trên dải tuyến nhỏ. Thiếu ở bản máy chủ cũ ⇒ coi như không. */
  thue_ngoai?: boolean;
  trang_thai: string;
  phan_doan_tong: number;
  chay_chung: boolean;
  ke_hoach: number | null;
  thuc_te: number;
  don_vi: string | null;
  da_giao_sang_toi: number | null;   // bước NGUỒN đã giao sang tổ đang xem
  da_nhan: number | null;            // bước CỦA TỔ đang xem đã nhận được
  cong_viec_id: number | null;
}
export interface SxLenhNhom {
  nguon_loai: string;          // "lsx" | "bai_ghep"
  nguon_ma: string;
  nguon_ten: string;
  khach_hang?: string | null;
  lsx_id: number | null;
  bai_ghep_id: number | null;
  is_rush?: boolean;           // lệnh / bài ghép gắn cờ GẤP — thẻ GẤP cạnh mã (10/10/2026)
  som_nhat: string | null;     // giờ dự kiến sớm nhất trong các bước CỦA TỔ NÀY; null = chưa xếp
  muon_nhat: string | null;
  nhan_luc?: string | null;    // lúc tổ nhận việc sớm nhất của lệnh
  tao_luc?: string | null;     // ngày tạo lệnh / bài ghép (giờ xưởng) — cột "Ngày tạo"
  so_viec: number;
  digest: { released: number; running: number; paused: number; completed: number };
  routing?: SxRoutingBuoc[];   // chuỗi công đoạn đầy đủ; rỗng khi lệnh chỉ có một bước
  cong_viec: SxWorkItem[];
}
/** Vị trí trang + tổng số LỆNH (không phải tổng số bước) — đơn vị trang của bàn tổ là LỆNH, nhờ
 *  vậy một lệnh không bao giờ bị xé đôi qua hai trang. */
export interface SxTrang {
  trang: number;
  co_trang: number;
  tong: number;
}
/** Số đếm cạnh từng giá trị của thanh lọc bàn tổ — đếm theo CÔNG VIỆC trong kỳ + ô tìm, không
 *  phụ thuộc điều kiện đang chọn. `nguoi` = thợ của tổ + người đang được giao, kèm số việc. */
export interface SxWorkItemsLocDem {
  trang_thai: Record<string, number>;
  cho: Record<string, number>;
  toi: Record<string, number>;
  vuong: Record<string, number>;
  gap?: Record<string, number>;   // "gap" lệnh gấp / "thuong" lệnh thường (10/10/2026)
  nguoi: { id: number; ten: string; so: number }[];
  /** 22/10/2026 — thay `tre` (trễ giờ dự kiến): chỉ máy / khách đang có việc trên bàn. */
  may?: LuaChonLoc[];
  khach?: LuaChonLoc[];
}

export interface SxWorkItemsOut {
  team_id: number;
  nhom: string;                // "lenh" | "phang"
  trang?: SxTrang | null;      // chỉ có ở nhom="lenh"
  lenh?: SxLenhNhom[];         // chỉ có ở nhom="lenh"
  cong_viec?: SxWorkItem[];    // chỉ có ở nhom="phang" — hình CŨ, Gantt không phải sửa
  /** Chỉ có ở nhom="phang": trục ngày Lịch bàn tổ đọc Lịch làm việc như bàn Xếp lịch. */
  ngay_nghi?: string[];
  ngay_dac_biet?: XlNgayDacBiet[];
  cac_ca?: { ten: string; tu: string; den: string; nghi_tu: string | null; nghi_den: string | null }[];
}

/** Tình trạng người ở ô chọn giao việc / thêm người tổ khác (BE `services/san_xuat/tinh_trang_nguoi`).
 *  `ly_do_nghi` ("Nghỉ dài hạn"/"Đang đình chỉ") và `nghi_phep` trùng ngày ⇒ máy chủ CHẶN;
 *  `dang_chay` ⇒ cảnh báo (chặn khi việc đích đang chạy); `viec_cho` chỉ để biết. */
export interface SxTinhTrangNguoi {
  ly_do_nghi: string | null;
  /** Đơn nghỉ phép ĐÃ DUYỆT, ngày "YYYY-MM-DD" gồm cả hai đầu. */
  nghi_phep: { tu: string; den: string }[];
  dang_chay: { cong_viec_id: number; ma: string | null; ten_cong_doan: string; to_ten: string | null } | null;
  /** Việc người đó CÓ TÊN trong tổ mà chưa chạy (`released`) / đang tạm dừng (`paused`) — tạm dừng trước. */
  viec_cho: {
    cong_viec_id: number; ma: string | null; ten_cong_doan: string; to_ten: string | null;
    trang_thai: "released" | "paused";
  }[];
}
export interface SxNhanVienChon extends SxTinhTrangNguoi {
  id: number;
  code: string | null;
  full_name: string;
  la_luong_khoan: boolean;
  co_tai_khoan: boolean;
}
export interface SxNhanVienChonListOut {
  team_id: number;
  /** Ngày XƯỞNG máy chủ xét nghỉ phép — so `nghi_phep` với ngày này, không lấy giờ trình duyệt. */
  hom_nay: string;
  nhan_vien: SxNhanVienChon[];
}

/** Thợ tổ SX khác thêm được vào lần ghi sản lượng (mg 0389) — kèm nhãn tổ gốc. */
export interface SxHoTroUngVien extends SxTinhTrangNguoi {
  id: number;
  code: string | null;
  full_name: string;
  to_id: number | null;
  to_ten: string | null;
}
export interface SxHoTroUngVienListOut {
  team_id: number;
  hom_nay: string;
  nhan_vien: SxHoTroUngVien[];
}

/** Việc chờ tổ bấm trên một bàn tổ — việc GIỮA HAI TỔ mà bên tổ mình phải bấm (chấm đỏ trên dòng
 *  công đoạn + ô "chờ xác nhận" của bàn). */
export interface SxChoXacNhanBanGiao {
  id: number;
  nguon_cong_viec_id: number;
  nguon_ten: string;
  nguon_to_ten: string | null;
  dich_cong_viec_id: number;
  dich_ten: string;
  dich_to_ten: string | null;
  lsx_ma: string | null;
  so_luong: number;
  don_vi: string;
  de_xuat_luc: string | null;
  version: number;
  /** Công đoạn nằm trên bàn đang xem ⇒ chấm đỏ trên dòng + xác nhận trong ngăn chi tiết; `false`
   *  (thường là tổ cho mượn người) ⇒ liệt kê riêng khi bật ô "chờ xác nhận". */
  tren_ban: boolean;
}
/** Một lỗi KCS báo về tổ mà tổ chưa bấm "Đã xem" (KCS theo lệnh, mg 0306). Thông báo MỘT CHIỀU:
 *  không nhận / từ chối, không chặn gì. */
export interface SxChoXacNhanKcsLoi {
  loi_id: number;
  kcs_batch_id: number;
  cong_viec_id: number | null;
  to_id: number | null;
  ten_cong_doan: string;
  /** Bước KCS bắt lỗi khi lỗi quy về công đoạn trước; null = bắt ngay tại công đoạn này. */
  phat_hien_o?: string | null;
  lsx_ma: string | null;
  mo_ta: string | null;
  so_luong: number;
  don_vi: string | null;
  nguoi_kiem: string | null;
  luc: string | null;
  so_anh: number;
  version: number;
  /** Công đoạn nằm trên bàn đang xem ⇒ chấm đỏ trên dòng + xác nhận trong ngăn chi tiết; `false`
   *  (thường là tổ cho mượn người) ⇒ liệt kê riêng khi bật ô "chờ xác nhận". */
  tren_ban: boolean;
}
export interface SxChoXacNhan {
  team_id: number;
  ban_giao: SxChoXacNhanBanGiao[];
  kcs_loi: SxChoXacNhanKcsLoi[];
}

/** Kết quả một lệnh ghi — đủ để cập nhật thanh + version lạc quan. */
export interface SxLenhKetQua {
  cong_viec_id: number;
  department_id: number | null;
  trang_thai: string;
  version: number;
}

/** Như `SxLenhKetQua` + con trỏ sang yêu cầu sửa chữa vừa gửi — để toast nói được
 *  "đã gửi YC-0042 tới tổ sửa chữa" thay vì một câu chung chung. */
export interface SxSuCoKetQua extends SxLenhKetQua {
  yeu_cau_id: number;
  yeu_cau_ma: string;
}

export interface SxPhanCongItem {
  id: number;
  employee_id: number;
  ho_ten: string;
  la_luong_khoan: boolean;
  co_tai_khoan: boolean;
  /** Ảnh tài khoản; null = chưa có tài khoản hoặc chưa đặt ảnh → vẽ chữ cái đầu. */
  avatar_url?: string | null;
  trang_thai: string;          // "active" | "removed"
}
export interface SxPhienChay {
  id: number;
  so_thu_tu: number;
  may_id: number | null;       // máy CHẠY TRONG PHIÊN NÀY — có thể khác phiên trước nếu đã đổi máy
  may_ten: string | null;
  bat_dau: string;
  ket_thuc: string | null;
  loai_dong: string | null;    // "tam_dung" | "doi_may" | "ket_thuc"
  ly_do_bat_dau_tre: string | null;
  ly_do: string | null;
}
export interface SxKhoangThamGia {
  id: number;
  phien_chay_id: number;
  employee_id: number;
  ho_ten: string;
  avatar_url?: string | null;
  bat_dau: string;
  ket_thuc: string | null;
}
// --- Giai đoạn 3: sản lượng · bàn giao · vật tư -------------------------------------------
export interface SxLotVao {
  id: number;
  nguon_batch_id: number | null;   // mẻ đầu ra của công đoạn trước
  so_luong: number;
  don_vi: string | null;
}
export interface SxBatch {
  id: number;
  bat_dau: string;
  ket_thuc: string;
  tong: number;
  tot: number;
  hong: number;
  don_vi: string | null;
  mo_ta_loi: string | null;
  ghi_chu: string | null;
  version: number;
  /** Máy ĐÃ CHẠY mẻ này — lấy từ PHIÊN chạy, không phải `may_id` hiện tại của công việc: đổi máy
   *  giữa chừng thì mỗi mẻ một máy. `null` = bước không dùng máy hoặc phiên chưa ghi máy. */
  may_ten: string | null;
  ca_ten: string | null;          // null = mẻ chạy NGOÀI mọi ca đã khai (một câu trả lời thật)
  so_nguoi: number;
  su_co: SxMeSuCo[];              // các lần dừng máy rơi vào cửa sổ mẻ
  /** Người có mặt trong mẻ — CHỈ danh sách, không số phút, không phần chia (spec 2026-09-18 §7.3:
   *  "ghi nhận thế thôi, đừng có chia bất cứ gì"). */
  nguoi_tham_gia: SxNguoiThamGiaBatch[];
  lot_vao: SxLotVao[];
  /** Mẻ đã đi theo một lần bàn giao chưa — form bàn giao chỉ liệt kê mẻ chưa giao. */
  da_ban_giao: boolean;
  /** CÔNG VIỆC KHOÁN của mẻ — ảnh chụp tên · ĐVT · đơn giá lúc ghi (§7.1). `viec_khoan_id` null =
   *  mẻ ghi trước 18/09/2026 ⇒ bày "chưa khai việc khoán", không đoán hộ. */
  viec_khoan_id: number | null;
  viec_khoan_ten: string | null;
  viec_khoan_don_vi: string | null;
  viec_khoan_don_vi_ten: string | null;
  viec_khoan_don_gia: number | null;
  /** Tuỳ chọn khi ghi đã chọn (Đợt 2); null = công đoạn không khai / lần ghi trước Đợt 2. */
  tuy_chon_khoan?: SxTuyChonLanGhi[] | null;
  /** Bậc giá chụp lúc ghi (Bài in, 22/10/2026); null = công đoạn không chia bậc / không khớp bậc. */
  bac_khoan_ten?: string | null;
  /** Việc phát sinh đã ghi — KHÔNG cộng vào sản lượng. */
  phat_sinh: SxMePhatSinh[];
  /** Băng "Danh mục đã đổi so với lúc ghi mẻ" (§7.2b) — rỗng = còn khớp. */
  danh_muc_doi: SxMeDanhMucDoi[];
}
export interface SxMePhatSinh {
  id: number;
  phat_sinh_id: number;
  so_luong: number;
  ten: string | null;
  don_vi: string | null;
  don_vi_ten: string | null;
  don_gia: number | null;
}
/** Một ô lệch của băng mẻ. `mat` = dòng đã bị xoá khỏi danh mục — mẻ GIỮ ảnh chụp. */
export interface SxMeDanhMucDoi {
  truong: string;
  nhan: string;
  cu: string | null;
  moi: string | null;
  mat: boolean;
}
/** Một công việc khoán của tổ cho form Ghi mẻ: đơn giá · ĐVT · ghi chú + việc phát sinh. KHÔNG có
 *  thành tiền — bàn tổ không nhân gì. */
export interface SxViecPhatSinhChon {
  id: number; ten: string; don_gia: number; don_vi: string; don_vi_ten: string | null;
  /** Tổ của việc vắng trong bảng giá theo tổ của việc phát sinh (21/10/2026). */
  thieu_gia?: boolean;
}
/** Một "tuỳ chọn khi ghi" công đoạn khai (Đợt 2): Có / không ⇒ ô tick, Số ⇒ ô số. */
export interface SxTuyChonKhai { ma: string; ten: string; kieu: "co_khong" | "so"; goi_y: string | null }
/** Ảnh chụp tuỳ chọn của MỘT lần ghi (giá trị thợ chọn lúc ghi / sửa số). */
export interface SxTuyChonLanGhi { ma: string; ten: string; kieu: string; gia_tri: number }
/** Giá của tổ ứng với một tổ hợp tick (`chon` = {mã tuỳ chọn: 0/1}) — công đoạn chia bậc (Bài in). */
export interface SxBacTheoChon {
  chon: Record<string, number>;
  /** Lệnh in AB: tổ hợp của mặt nào; lệnh khác null. */
  mat?: "a" | "b" | null;
  bac_ma: string | null;
  bac_ten: string | null;
  so_mau: number;
  so_mau_pha: number;
  gia_co_dinh: number;
  don_gia: number;
  thieu_gia: boolean;
}
/** Cấu hình Khoán cố định của công đoạn. Không có thao tác chọn nguồn trong lúc ghi mẻ. */
export interface SxKhoanCongDoan {
  id: number;
  ten: string;
  don_gia: number;
  don_vi: string;
  don_vi_ten: string | null;
  phat_sinh: SxViecPhatSinhChon[];
  /** Giá theo tổ (21/10/2026): `don_gia` + giá cố định là giá CỦA TỔ làm việc này. */
  gia_co_dinh?: number;
  thieu_gia?: boolean;
  tuy_chon?: SxTuyChonKhai[];
  /** Bậc giá (Bài in): giá theo từng trạng thái tick; rỗng = không chia bậc. Số màu = số kẽm như Tính giá. */
  bac_theo_chon?: SxBacTheoChon[];
  so_mau?: number | null;
  so_mau_pha?: number | null;
}
export interface SxNguoiThamGiaBatch {
  employee_id: number;
  ho_ten: string;
  /** Tên tổ GỐC — chỉ có khi người này không thuộc tổ làm lần ghi (người tổ khác sang giúp). */
  to_ten?: string | null;
  /** Người tổ khác được tổ thêm thẳng vào lần ghi (mg 0389) — sửa số bỏ được như người tổ mình. */
  la_ho_tro?: boolean;
}
/** Mã lệnh + tên công đoạn — ghi chú cạnh tên người trong hộp Ghi sản lượng. */
export interface SxViecNgan { cong_viec_id: number; ma: string | null; ten_cong_doan: string }
/** Một người tổ mình trong hộp Ghi sản lượng (10/10/2026). */
export interface SxNguoiGhi {
  employee_id: number;
  ho_ten: string;
  /** Có ⇒ nghỉ hôm nay: mờ, không tick được. */
  nghi: string | null;
  /** Việc khác đã bắt đầu, chưa kết thúc mà người này còn tên. */
  dang_o: SxViecNgan[];
  tick_san: boolean;
}
export interface SxMeSuCo {
  bat_dau: string | null;
  ket_thuc: string | null;
  ly_do: string | null;
}
export interface SxSanLuong {
  tong_tot: number;
  da_giao: number;
  batches: SxBatch[];
  /** Mốc chấm THỰC của bước — `so_luong_ra` đã rút theo tỉ lệ thực nhận; null khi bước không khai. */
  muc_tieu: number | null;
  /** Lượng bước này thật sự nhận được. null = không ai bàn giao tới — KHÁC hẳn với 0. */
  thuc_nhan: number | null;
  /** max(mục tiêu − tổng tốt, 0). null khi không có mục tiêu — KHÁC hẳn với 0. */
  con_thieu: number | null;
  nhan?: number | null;
  nhan_ra?: number | null;
  loi?: number | null;
  don_vi: string | null;
}
export interface SxBanGiao {
  id: number;
  doi_tac_cong_viec_id: number | null;
  doi_tac_ten: string;
  /** Hai đầu lần giao: công đoạn + tổ (bước thuê ngoài = nhà gia công; đích "Kho" = nhập kho). */
  nguon_cong_doan?: string | null;
  nguon_to?: string | null;
  dich_cong_doan?: string | null;
  dich_to?: string | null;
  cung_to: boolean;
  so_luong: number;
  don_vi: string;
  trang_thai: string;          // proposed | confirmed
  version: number;
  batch_ids: number[];         // các mẻ của công đoạn nguồn đi theo lần giao này
  /** Ai đề xuất / ai xác nhận, lúc nào — hai bên thấy như nhau; tên từ tài khoản đã thao tác. */
  nguoi_de_xuat: string | null;
  de_xuat_luc: string | null;
  nguoi_xac_nhan: string | null;
  xac_nhan_luc: string | null;   // null = chưa xác nhận (đã xác nhận mà bên giao sửa số mẻ ⇒ về null)
}
/** CHẶNG SAU theo routing lệnh — đích bàn giao hợp lệ duy nhất. Nhiều dòng khi bước sau tách lần
 *  chạy ("lần k/N") hoặc routing rẽ nhánh; rỗng = bước cuối lệnh — không bàn giao, thành phẩm vào kho qua KCS. */
export interface SxBanGiaoChangSau {
  cong_viec_id: number;
  ten_cong_doan: string;
  to_id: number | null;
  to_ten: string | null;
  du_kien_bat_dau: string | null;
  phan_doan_so: number;
  phan_doan_tong: number;
  loai_buoc: string;
  nha_cung_cap: string | null;
  trang_thai: string;
}
/** Một công đoạn TRƯỚC theo routing (từng lần chạy) — khối "Công đoạn trước" của tab Nhận. Kế
 *  hoạch/thực tế theo `don_vi` (đơn vị ra của nó); đã giao theo `don_vi_giao`. */
export interface SxCongDoanTruoc {
  cong_viec_id: number;
  ten_cong_doan: string;
  phan_doan_so: number;
  phan_doan_tong: number;
  to_ten: string | null;
  /** Bước trước cùng tổ + cùng lệnh: không cổng, không cần bàn giao (`dau_vao.cung_to_cung_lsx`). */
  cung_to: boolean;
  trang_thai: string;
  ke_hoach: number | null;
  don_vi: string | null;
  thuc_te: number;
  da_giao: number;
  da_xac_nhan: number;
  cho_xac_nhan: number;
  don_vi_giao: string | null;
}
/** Trần Σ số làm được = số đã nhận × hệ số quy đổi — máy chủ chặn mẻ vượt trần. */
export interface SxTranGhi {
  /** Trần đã trừ lỗi KCS bắt tại công đoạn (10/10/2026). */
  toi_da: number;
  /** Trần theo số nhận, chưa trừ lỗi KCS. */
  toi_da_nhan: number;
  loi_kcs: number;
  da_nhan: number;
  he_so: number;
  don_vi_nhan: string | null;
  /** null ở bước đầu chuỗi — số nhận lấy theo kế hoạch. */
  nguon_ten: string | null;
  /** Nguồn cùng tổ ⇒ `da_nhan` là SẢN LƯỢNG bước trước, không phải số đã bàn giao. */
  cung_to: boolean;
  dau_chuoi: boolean;
  da_ghi: number;
  con_ghi_duoc: number;
}
/** Phiếu xuất kho đã ghi sổ cho công việc — có phiếu là tổ đã có hàng, không bấm nhận (11/10/2026). */
export interface SxPhieuXuatVatTu {
  voucher_id: number;
  ma: string;
  /** Yêu cầu sinh ra phiếu — ngăn đặt phiếu cạnh đúng đề nghị của nó. */
  request_id?: number | null;
  xuat_luc: string | null;
  nguoi_xuat: string | null;
}

// --- Đề nghị cấp vật tư theo công đoạn (spec-de-nghi-cap-vat-tu-cong-doan §6) -------------
// Khối `vat_tu_cap` TÁCH HẲN với `vat_tu` ở trên: `vat_tu` là các phiếu kho ĐÃ ghi sổ chờ tổ xác
// nhận NHẬN; `vat_tu_cap` là các LẦN tổ ĐỀ NGHỊ + bản đối chiếu kế hoạch/yêu cầu/thực xuất.
/** Một dòng nhu cầu KẾ HOẠCH của công đoạn (MRP). `_goc` = thang đơn vị gốc của danh mục. */
export interface SxVatTuCapKeHoach {
  hang_loai: string;
  hang_id: number;
  ten: string;
  /** Giấy: khổ mm + đơn vị gốc (máy chủ suy từ ĐVT) — cùng mã khác khổ/đơn vị gốc là hai dòng.
   *  Hàng khác: "" · 0 · 0. */
  don_vi_goc: string;
  kho_rong: number;
  kho_dai: number;
  dvt: string;
  sl: number;
  dvt_goc: string;
  sl_goc: number;
}
/** Một dòng CỦA RIÊNG một lần đề nghị — dùng điền sẵn form "Sửa đề nghị".
 *  KHÔNG lẫn với `SxVatTuCapDoiChieu.sl_yeu_cau` (cộng dồn qua MỌI lần). */
export interface SxVatTuCapDong {
  hang_loai: string;
  hang_id: number;
  ten: string;
  /** Giấy: khổ mm + đơn vị gốc — cùng mã khác khổ/đơn vị gốc là hai dòng. Hàng khác: "" · 0 · 0. */
  don_vi_goc: string;
  kho_rong: number;
  kho_dai: number;
  dvt: string;
  dvt_goc: string;
  sl_ke_hoach: number;
  sl_ke_hoach_goc: number;
  sl_yeu_cau: number;
  sl_yeu_cau_goc: number;
}
/** Một LẦN tổ gửi đề nghị. `loai`: "lan_dau" | "bo_sung". `stock_request_*` null khi mọi dòng = 0
 *  (tổ xác nhận không cần cấp ⇒ không đẻ yêu cầu kho). */
export interface SxVatTuCapLan {
  id: number;
  lan_so: number;
  loai: string;
  /** Hệ thống tự lập lúc phát hành lệnh (không phải tổ bấm). */
  tu_lap?: boolean;
  can_luc: string;
  stock_request_id: number | null;
  stock_request_ma: string | null;
  stock_request_trang_thai: string | null;
  created_by_id: number | null;
  updated_by_id: number | null;
  /** Tên tài khoản gửi / sửa — máy chủ tra sẵn (`*_by_id` là mã tài khoản, không phải mã thợ). */
  created_by_ten?: string | null;
  updated_by_ten?: string | null;
  created_at: string;
  updated_at: string;
  dongs: SxVatTuCapDong[];
}
/** Một mặt hàng trong bản đối chiếu — số CỘNG DỒN qua mọi lần đề nghị. */
export interface SxVatTuCapDoiChieu {
  hang_loai: string;
  hang_id: number;
  ten: string;
  /** Giấy: khổ mm + đơn vị gốc — cùng mã khác khổ/đơn vị gốc là hai dòng. Hàng khác: "" · 0 · 0. */
  don_vi_goc: string;
  kho_rong: number;
  kho_dai: number;
  dvt: string;
  dvt_goc: string;
  sl_ke_hoach: number;
  sl_ke_hoach_goc: number;
  sl_yeu_cau: number;
  sl_yeu_cau_goc: number;
  sl_thuc_xuat: number;
  /** Phần tổ đã nhập lại kho (phiếu NHẬP ghi sổ), thang gốc. */
  sl_nhap_lai: number;
  /** THỰC DÙNG = kho thực xuất − nhập lại (thang gốc). `null` ở dòng THÔNG TIN của phần trả khác khổ
   *  đã xuất — phần trừ nằm ở dòng đích (`nhap_lai_vao` = nhãn dòng đó). */
  sl_thuc_dung: number | null;
  nhap_lai_vao?: string | null;
  lech_ke_hoach: number;
  lech_thuc_te: number;
  /** Giấy bước này NHẬN từ bước trước (tên bước trước) — không phải nhu cầu, không xin cấp. */
  nhan_tu?: string | null;
}
export interface SxVatTuNhapLai {
  id: number;
  ma: string;
  trang_thai: string;
  can_luc: string | null;
  created_by_ten: string | null;
  created_at: string;
  dongs: { hang_loai: string; hang_id: number; ten: string; don_vi_goc?: string | null;
    kho_rong?: number; kho_dai?: number; dvt: string; sl: number }[];
  /** Phiếu NHẬP kho đã ghi sổ của yêu cầu này. */
  cac_phieu?: { voucher_id: number; ma: string; nhap_luc: string | null; nguoi_nhap: string | null }[];
}
export interface SxVatTuCap {
  ke_hoach: SxVatTuCapKeHoach[];
  cac_de_nghi: SxVatTuCapLan[];
  doi_chieu: SxVatTuCapDoiChieu[];
  /** Yêu cầu NHẬP tổ trả hàng thừa về kho (mọi trạng thái), cũ trước mới sau — chỉ số lượng. */
  cac_nhap_lai?: SxVatTuNhapLai[];
  /** Có giá trị ⇒ hiện nút "Sửa đề nghị" trỏ đúng lần đó; null ⇒ ẩn nút Sửa. */
  de_nghi_co_the_sua_id: number | null;
  /** true ⇒ hiện nút "Gửi đề nghị bổ sung". Loại trừ nhau với `de_nghi_co_the_sua_id`. */
  co_the_tao_bo_sung: boolean;
  /** true ⇒ kế hoạch lấy theo đường lùi từ LSX (trước 31/08/2026) — UI phải nói rõ. */
  du_lieu_cu: boolean;
}
export interface SxVatTuDeNghiDongIn {
  hang_loai: string;
  hang_id: number;
  /** Giấy: khổ (đủ hai cạnh, hoặc chỉ rộng). Đơn vị gốc máy chủ tự suy từ `dvt`. Hàng khác bỏ trống. */
  kho_rong?: number;
  kho_dai?: number;
  dvt: string;
  sl_yeu_cau: number;
}
export interface SxVatTuDeNghiIn {
  /** GIỜ cần (ISO datetime), không phải ngày: kho soạn theo ca. */
  can_luc: string;
  /** Ghi chú cấp yêu cầu (ô Ghi chú của form Kho) — đi sang yêu cầu kho. */
  ghi_chu?: string | null;
  lines: SxVatTuDeNghiDongIn[];
}
/** Một dòng vật tư thừa tổ trả về kho (số + đơn vị người gõ; giấy kèm khổ). */
export interface SxVatTuNhapLaiDongIn {
  hang_loai: string;
  hang_id: number;
  dvt: string;
  so_luong: number;
  kho_rong?: number;
  kho_dai?: number;
}
export interface SxVatTuNhapLaiIn {
  /** Giờ cần nhập (giờ tường "yyyy-mm-ddTHH:mm:ss"). */
  can_luc?: string | null;
  ghi_chu?: string | null;
  lines: SxVatTuNhapLaiDongIn[];
}
export interface SxVatTuNhapLaiKetQua {
  id: number;
  ma: string;
  trang_thai: string;
}
export interface SxVatTuDeNghiKetQua {
  de_nghi_id: number;
  stock_request_id: number | null;
  lan_so?: number;
}

/** Một lần báo hỏng chưa xử lý xong của máy đang làm việc — dòng "Máy" ở cột phải ngăn bàn tổ. */
export interface SxBaoHongMay {
  /** "yeu_cau" = chờ tổ sửa chữa nhận; "phieu" = đã nhận, chờ sửa. */
  loai: "yeu_cau" | "phieu";
  id: number;
  ma: string;
  trang_thai: string;
  may_dung: boolean;
  trieu_chung: string | null;
  thoi_diem: string | null;
}

/** Ô đuôi của dải: làm xong bước cuối của lệnh thì hàng đi đâu (11/10/2026). `noi` = nhà gia công
 *  (chờ mang đi / ở ngoài) hoặc bước nhận (về bước); `cho_nhan` = phần đã giao chưa được xác nhận. */
export interface SxDaiDuoi {
  loai: "cho_mang_di" | "o_ngoai" | "ve_buoc" | "ve_kho" | "giao_khach";
  noi?: string | null;
  lsx_ma?: string | null;
  so?: number | null;
  cho_nhan?: number | null;
  don_vi?: string | null;
  luc?: string | null;
}

export interface SxWorkItemChiTiet {
  /** Dải công đoạn đầy đủ của lệnh — khối "Hàng đang tới đâu" ở cột phải ngăn. Rỗng = lệnh một
   *  bước hoặc bài ghép. */
  routing?: SxRoutingBuoc[];
  dai_duoi?: SxDaiDuoi | null;
  /** Báo hỏng còn mở của máy (máy dừng trước, mới trước). Từ chối / sửa xong là rụng khỏi đây. */
  bao_hong_may?: SxBaoHongMay[];
  cong_viec: SxWorkItem;
  trang_thai: string;
  version: number;
  /** Người đang xem làm được việc nào TRÊN CHÍNH công việc này (tổ của nó + mức own chỉ khi việc
   *  đang giao cho mình) — nút ghi trong drawer bật/tắt theo đây. */
  quyen: Partial<Record<Exclude<SxViecTo, "read">, boolean>>;
  /** Mức của từng quyền đó ở tổ của việc ("all" | "own"; thiếu khoá = không được cấp). Nút tắt vì
   *  "Của tôi" mà việc chưa giao cho mình thì drawer nói đúng lý do đó, không bảo đi xin quyền. */
  quyen_muc: Partial<Record<Exclude<SxViecTo, "read">, "all" | "own">>;
  khoan?: SxKhoanCongDoan | null;
  phan_cong: SxPhanCongItem[];
  /** Người tổ mình bày trong hộp Ghi sản lượng. */
  nguoi_ghi?: SxNguoiGhi[];
  phien_chay: SxPhienChay[];
  khoang_tham_gia: SxKhoangThamGia[];
  san_luong: SxSanLuong;
  ban_giao_di: SxBanGiao[];
  ban_giao_den: SxBanGiao[];
  /** Công đoạn trước theo routing; rỗng = công đoạn đầu lệnh. */
  cong_doan_truoc: SxCongDoanTruoc[];
  /** null = không trần (đầu lệnh, hệ số 0, hoặc nguồn giao khác đơn vị vào). */
  tran_ghi: SxTranGhi | null;
  /** Tên công đoạn trước chưa giao được gì sang — khác rỗng thì chưa bắt đầu được. */
  thieu_dau_vao: string[];
  /** Câu chặn Bắt đầu vì vật tư chưa sẵn sàng (spec 2026-10-18 §5.3); null = không chặn. */
  vat_tu_chua_san_sang?: string | null;
  ban_giao_chang_sau: SxBanGiaoChangSau[];
  vat_tu: SxPhieuXuatVatTu[];
  vat_tu_cap: SxVatTuCap;
}

// --- Kết quả các mặt GHI G3/G4 (đủ để cập nhật lạc quan; drawer refetch để lấy chi tiết) ---
export interface SxKetQuaNhanh {
  lsx_id: number;
  so_luong: number;
  don_vi: string;
  ban_giao_id: number | null;
}
export interface SxSanLuongKetQua {
  cong_viec_id: number;
  department_id: number | null;
  trang_thai: string;
  version: number;
  batch_id?: number | null;
  ket_qua_lsx?: SxKetQuaNhanh[];
}
export interface SxBanGiaoKetQua {
  ban_giao_id: number;
  trang_thai_ban_giao: string;
  so_luong: number;
  version: number;
  nguon_cong_viec_id: number;
  dich_cong_viec_id: number | null;
  nguon_department_id: number | null;
  dich_department_id: number | null;
}
// Body các mặt GHI (§7). `expected_version` = khoá lạc quan; `ly_do` của tạm-dừng BẮT BUỘC.
export interface SxPhanCongIn { employee_id: number; expected_version?: number | null }
export interface SxGoPhanCongIn { ly_do?: string | null; expected_version?: number | null }
export interface SxBatDauIn { expected_version?: number | null }
export interface SxDoiMayIn { may_id: number; ly_do?: string | null; expected_version?: number | null }
/** Một máy trong ô "Đổi máy": chỉ máy làm được công đoạn của việc, kèm tình trạng LÚC NÀY — cùng
 *  nguồn cột Trạng thái màn Thiết bị (`services/may_trang_thai.py`), nhãn dựng sẵn ở máy chủ. */
export interface SxMayDoi {
  id: number;
  ma: string;
  ten: string | null;
  loai_may: string | null;
  /** ranh | co_phieu_sua | dang_chay | bao_tri | may_dung | khoa */
  trang_thai: string;
  nhan: string;
  chi_tiet: string | null;
}
/** Nhóm của một dòng tab Lịch sử — khớp `NHOM_LS` ở `services/san_xuat/lich_su_viec.py`. */
export type SxNhomLichSu = "chay_may" | "nguoi_khuon" | "san_luong" | "ban_giao" | "vat_tu" | "kcs" | "khac";
/** Một dòng tab Lịch sử của ngăn công việc. `ct` = mẩu phụ (vẽ thẻ nhỏ, không nối chuỗi);
 *  `mau`: "g" làm ra, "b" gửi đi hay đề nghị, "r" lỗi hay sự cố, "" xám. */
export interface SxLichSuDong {
  luc: string | null;
  nhom: SxNhomLichSu | string;
  cau: string;
  ct: string[];
  ly_do: string | null;
  mau: "g" | "b" | "r" | "" | string;
  /** Người thao tác — đã tách khỏi `ct`. */
  nguoi?: string | null;
}
export interface SxLichSuViec {
  items: SxLichSuDong[];
  dem: Record<string, number>;
}
export interface SxMayDoiOut {
  items: SxMayDoi[];
  /** true = danh sách đã bị công đoạn thu hẹp; false = công đoạn chưa khai máy, đang hiện mọi máy. */
  theo_cong_doan: boolean;
}
export interface SxTamDungIn { ly_do: string; expected_version?: number | null }
export interface SxKetThucIn { expected_version?: number | null }
/** Báo sự cố tại tổ (31/08/2026) → ghi thẳng vào hộp thư "Báo máy hỏng" của tổ sửa chữa.
 *  KHÔNG có ô "máy": server lấy đúng máy của công việc đang chạy. Không hỏi bộ phận hỏng, `mo_ta`
 *  không bắt buộc (11/10/2026). `muc_do` lấy từ `NHAN_MUC_DO` của kyThuatMay. */
export interface SxSuCoIn {
  mo_ta?: string | null;
  muc_do: string;
  dung_san_xuat: boolean;
  expected_version?: number | null;
}

// Body G3/G4
export interface SxLotVaoIn {
  nguon_batch_id: number;
  so_luong: number;
  don_vi?: string | null;
}
export interface SxBatchIn {
  /** Hộp Ghi sản lượng bỏ trống cả hai (10/10/2026): máy chủ lấy lúc bấm, bắt đầu nối lần ghi trước. */
  bat_dau?: string;
  ket_thuc?: string;
  tong: number;
  tot: number;
  hong?: number;
  don_vi?: string | null;
  mo_ta_loi?: string | null;
  ghi_chu?: string | null;
  lot_vao?: SxLotVaoIn[];
  /** Việc phát sinh đã làm trong mẻ — KHÔNG cộng vào sản lượng. */
  phat_sinh?: { phat_sinh_id: number; so_luong: number }[];
  /** Người TỔ MÌNH tick làm lần này; người hỗ trợ máy chủ tự thêm. */
  nguoi_ids?: number[];
  /** Tuỳ chọn khi ghi `{ma: giá trị}` — thiếu mã là 0. */
  tuy_chon?: Record<string, number>;
  /** Lệnh in AB: mặt máy chạy lần này — bậc giá theo số màu mặt đó. */
  mat_in?: "a" | "b" | null;
}
export interface SxBanGiaoDeXuatIn {
  dich_cong_viec_id: number;           // một trong các chặng sau theo routing
  don_vi?: string | null;
  batch_ids?: number[];                // mẻ đi theo lần giao (bắt buộc khi còn mẻ chưa giao)
}                                      // số lượng máy chủ tự tính = tổng tốt của mẻ chọn
/** Sửa lần giao còn chờ xác nhận = đặt lại danh sách mẻ; số lượng tính lại theo mẻ. */
export interface SxBanGiaoSuaIn { batch_ids: number[]; expected_version?: number | null }
export interface SxBanGiaoXacNhanIn { expected_version?: number | null }
/** Sửa số làm được của một mẻ đã ghi (10/10/2026, thay điều chỉnh bàn giao). */
export interface SxSuaSoMeIn {
  tot: number; ly_do?: string | null; expected_version?: number | null;
  /** Người tổ mình làm lần đó; bỏ trống = không đổi. */
  nguoi_ids?: number[];
  /** Tuỳ chọn khi ghi; bỏ trống = không đổi. */
  tuy_chon?: Record<string, number>;
}

// ── KCS theo LỆNH (mg 0306, docs/design-kcs-theo-lenh.md) ─────────────────────
// Mirror `schemas/san_xuat.py` (Kcs*Out). MỘT kiểu kiểm duy nhất: KCS mở lệnh → bấm công đoạn →
// ghi Số đạt / Số lỗi. Không trừ số, không đổi trạng thái công việc.
export interface SxKcsAnh {
  id: number;
  file_name: string;
  file_url: string;
  file_type?: string | null;
}
export type SxKcsKetLuan = "dat" | "dat_mot_phan" | "khong_dat";
/** Trạng thái gửi kho suy từ các yêu cầu nhập kho neo vào lần kiểm — "khong_ap_dung" cho công đoạn
 *  không phải công đoạn cuối của nhóm. */
export type SxKcsTrangThaiGuiKho = "chua_gui" | "dang_cho" | "da_nhap" | "khong_ap_dung";
/** Một tiêu chí bước KCS cuối xét — gộp từ ảnh chụp `kcs_tieu_chi_json` của mọi công việc trong
 *  chuỗi, kể cả lệnh phụ cùng nhóm (08/10/2026). Khoá kết quả là cặp (`cong_viec_id`, `thu_tu`). */
export interface SxKcsChiTietTieuChi {
  cong_viec_id?: number | null;
  ten_cong_doan?: string | null;
  nhom_cong_doan?: string | null;
  tieu_chi_id?: number | null;
  ma?: string | null;
  ten?: string | null;
  thu_tu: number;
  lsx_id?: number | null;
  lsx_ma?: string | null;
  ten_lenh?: string | null;
  la_lenh_phu?: boolean;
}
/** Kết quả một tiêu chí. `cong_viec_id` bỏ trống = của chính công việc lần kiểm (dữ liệu cũ). */
export interface SxKcsChecklistKetQuaIn {
  cong_viec_id?: number | null;
  thu_tu: number;
  dat: boolean;
  ghi_chu?: string | null;
  /** Công đoạn giữa: số lỗi KCS ghi cho tiêu chí này (tick = không đạt). */
  so_luong?: number | null;
}
/** Phần LỖI của một lần kiểm. `da_xem_luc` null = tổ bị kiểm chưa bấm "Đã xem". */
export interface SxKcsLanKiemLoi {
  id: number;
  mo_ta: string | null;
  so_luong: number;
  don_vi: string | null;
  to_chiu_id: number | null;
  to_chiu_ten?: string | null;
  /** Công đoạn CHỊU lỗi — khác công đoạn của lần kiểm khi KCS quy lỗi về bước trước. */
  cong_doan_id?: number | null;
  cong_doan_ten?: string | null;
  da_xem_luc: string | null;
  nguoi_xem: string | null;
  anh: SxKcsAnh[];
}
/** Một lần kiểm đã ghi — người kiểm là tài khoản đã bấm lưu (server chốt). */
export interface SxKcsLanKiem {
  id: number;
  /** Công đoạn được kiểm — nơi KCS bắt lỗi. */
  cong_viec_id?: number | null;
  cong_doan_ten?: string | null;
  nguoi_kiem: string | null;
  luc: string | null;
  so_dat: number;
  so_loi: number;
  don_vi: string | null;
  ket_luan: SxKcsKetLuan;
  /** Kết quả tick `[{thu_tu, dat, ghi_chu}]`, khớp theo `thu_tu` với checklist của công đoạn. */
  checklist: SxKcsChecklistKetQuaIn[];
  ghi_chu: string | null;
  version: number;
  loi: SxKcsLanKiemLoi[];
}
/** Mục "Kết quả KCS" của một công đoạn (drawer bàn tổ) — lần kiểm mới nhất trước. */
export interface SxKcsCongViec {
  cong_viec_id: number;
  la_kcs_cuoi: boolean;
  /** Chỉ công đoạn cuối: số tốt tổ ghi, KCS đạt, đã đề nghị nhập kho (công đoạn giữa không có "đạt"). */
  cuoi?: { tot: number; dat: number; da_de_nghi_kho: number; don_vi: string | null } | null;
  checklist: SxKcsChiTietTieuChi[];
  lan_kiem: SxKcsLanKiem[];
  /** Lần kiểm ở bước SAU có lỗi quy về công đoạn này — mỗi lần chỉ mang lỗi của công đoạn này. */
  lan_kiem_buoc_sau?: SxKcsLanKiem[];
}
export interface SxKcsCuoiTomTat {
  /** Σ tốt tổ đã ghi ở công đoạn cuối — trần của số được đề nghị nhập kho. */
  tot: number;
  dat: number;
  da_yeu_cau: number;
  con_gui_kho: number;
  /** Tổ đã làm mà chưa lần kiểm nào bao (tốt − đạt − lỗi). */
  cho_kiem: number;
  /** Σ kế hoạch đầu ra của bước cuối; `don_vi` là MÃ chặng — dịch bằng `nhanChang`. */
  muc_tieu: number | null;
  don_vi: string | null;
}
/** Một ô nhỏ ở cột Chuỗi — gây lỗi (bắt ở đâu cũng tính) đè lên trạng thái chạy. */
export interface SxKcsChuoiNut {
  ten: string;
  trang_thai: "xong" | "chay" | "chua" | "loi";
  la_kcs_cuoi: boolean;
}
/** Tình trạng một lệnh ở danh sách KCS — đúng chữ của các nút lọc nhanh. */
export type SxKcsTinhTrang =
  | "da_dong" | "cho_kiem" | "chua_gui_kho" | "cho_dong" | "cho_to" | "dang_lam" | "da_xong";
export type SxKcsLocNhanh = "tat_ca" | "cho_kiem" | "chua_gui_kho" | "cho_dong" | "da_dong";
/** Giá trị các ô lọc lấy từ dữ liệu màn KCS (11/10/2026), mỗi giá trị kèm số lệnh. */
export interface SxKcsGiaTriLoc {
  to: LuaChonLoc[];
  cong_doan: { ten: string; so: number }[];
  nguoi_kiem: LuaChonLoc[];
}
export interface SxKcsLenhItem {
  lsx_id: number;
  ma: string;
  ten: string;
  khach: string | null;
  nhom_ma: string | null;
  nhom_trang_thai: string | null;
  /** Đơn vị tính của sản phẩm trên lệnh — chặng Thành phẩm gọi bằng chữ này (`nhanChangLenh`). */
  don_vi_tinh?: string | null;
  so_cong_doan: number;
  so_da_kiem: number;
  so_loi: number;
  cuoi: SxKcsCuoiTomTat | null;
  /** Ngày tạo lệnh + lần KCS gần nhất — hai cột ngày, cũng là hai mốc kỳ `tao` / `kcs`. */
  created_at?: string | null;
  kcs_gan_nhat?: string | null;
  la_lenh_phu: boolean;
  /** Lệnh phụ: tên công đoạn của lệnh chính mà nó ghép vào. */
  noi_vao: string | null;
  chuoi: SxKcsChuoiNut[];
  /** Lỗi do công đoạn của lệnh này gây — đơn vị là của nơi bắt. */
  loi_gay: { ten: string; don_vi: string | null; so_luong: number }[];
  tinh_trang: SxKcsTinhTrang;
}
export interface SxKcsLenhList {
  items: SxKcsLenhItem[];
  tong: number;
  trang: number;
  co_trang: number;
  /** Số trên các nút lọc nhanh — cùng các điều kiện khác đang áp. */
  dem: Record<SxKcsLocNhanh, number>;
}
export interface SxKcsLenhDau {
  id: number;
  ma: string;
  ten: string;
  khach: string | null;
  nhom_id: number | null;
  nhom_ma: string | null;
  nhom_trang_thai: string | null;
  /** Đơn vị tính của sản phẩm trên lệnh — chặng Thành phẩm gọi bằng chữ này (`nhanChangLenh`). */
  don_vi_tinh?: string | null;
}
/** Một công đoạn trong chuỗi của lệnh — tổ, trạng thái chạy, tốt/hỏng tổ đã ghi, các lần kiểm. */
export interface SxKcsCongDoan {
  cong_viec_id: number;
  ten: string;
  phan_doan_so: number;
  phan_doan_tong: number;
  to_id: number | null;
  to_ten: string;
  /** `released` | `running` | `paused` | `completed` (enum công việc). */
  trang_thai: string;
  tot: number;
  hong: number;
  don_vi: string | null;
  la_kcs_cuoi: boolean;
  /** Bước thuê ngoài — `tot` là số chốt nhà gia công trả về, không phải tổ làm. */
  gia_cong_ngoai?: boolean;
  nha_gia_cong?: string | null;
  checklist: SxKcsChiTietTieuChi[];
  /** Bộ tiêu chí chụp vào công đoạn lúc phát hành — công đoạn giữa tick tiêu chí không đạt. */
  tieu_chi?: { thu_tu: number; ma: string | null; ten: string }[];
  so_lan_kiem: number;
  tong_dat: number;
  /** Σ hàng không đạt KCS bắt ở công đoạn này (kể cả phần quy về bước khác). */
  tong_loi: number;
  /** Lỗi bắt ở đây VÀ do chính công đoạn này — cùng `loi_buoc_sau` là lỗi TÍNH cho công đoạn. */
  loi_tai_cho: number;
  /** Σ đã đề nghị nhập kho (yêu cầu còn hiệu lực), quy về đơn vị của công đoạn. */
  da_yeu_cau_kho: number;
  /** Chỉ công đoạn cuối: min(Σ đạt, Σ tốt) − đã đề nghị — > 0 thì bày nút "Tạo yêu cầu nhập kho". */
  con_gui_kho: number;
  /** Chỉ công đoạn cuối: các dòng yêu cầu NHẬP thật (DNN…) đã gửi — số theo đơn vị của món. */
  yeu_cau_kho: SxKcsYeuCauKho[];
  lan_kiem: SxKcsLanKiem[];
  /** Lỗi KCS bắt ở bước sau mà quy về công đoạn này — gộp theo bước bắt; đơn vị là của bước đó. */
  loi_buoc_sau?: { phat_hien_o: string; don_vi: string | null; so_luong: number }[];
  /** Số kế hoạch đầu ra của công đoạn (đơn vị `don_vi`). */
  so_luong_ra: number | null;
  /** Tên máy của bước (null với bước nội bộ tổ / chưa gán máy). */
  may: string | null;
  /** Dặn dò kỹ thuật kế hoạch ghi cho bước. */
  ghi_chu_ky_thuat: string | null;
  /** Ảnh chụp quy cách lúc phát hành — cùng thẻ với ngăn bàn tổ. */
  quy_cach: SxQuyCachThe | null;
  /** Mẻ tổ đã ghi, mới nhất trước. */
  me: SxKcsMe[];
  /** Chỉ bước cuối: công việc quy lỗi về được — chuỗi gộp, kể cả lệnh phụ cùng nhóm. */
  nguon_loi?: SxKcsNguonLoi[];
}
export interface SxKcsNguonLoi {
  cong_viec_id: number;
  ten: string;
  lsx_ma: string | null;
  to_ten: string;
  la_dang_kiem: boolean;
}
/** Một mẻ tổ đã ghi, bày trong form kiểm KCS — `so_luong` là số làm được. */
export interface SxKcsMe {
  id: number;
  bat_dau: string | null;
  ket_thuc: string | null;
  so_luong: number;
  don_vi: string | null;
  nguoi_ghi: string | null;
  nguoi: string[];
}
/** Một dòng yêu cầu NHẬP kho thành phẩm sinh từ công đoạn cuối. `trang_thai` là trạng thái yêu cầu
 *  kho: `approved` (chờ kho) · `preparing` · `partial` · `done` · `cancelled` · `rejected`. */
export interface SxKcsYeuCauKho {
  request_id: number;
  ma: string;
  trang_thai: string;
  sl_de_nghi: number;
  sl_da_nhan: number;
  don_vi: string | null;
  tao_luc: string | null;
}
export interface SxKcsChuoiCongDoan {
  lsx: SxKcsLenhDau;
  cong_doan: SxKcsCongDoan[];
}
/** Một làn của sơ đồ nhóm. `noi_vao_cong_viec_id` = công việc của lệnh chính mà lệnh phụ ghép vào. */
export interface SxKcsLanNhom extends SxKcsChuoiCongDoan {
  la_lenh_phu: boolean;
  noi_vao_cong_viec_id: number | null;
}
/** Sơ đồ cả nhóm thành phẩm — lệnh phụ trước, lệnh chính cuối. */
export interface SxKcsSoDoNhom {
  nhom: { id: number; ma: string; ten: string | null; trang_thai: string; khach: string | null } | null;
  lenh: SxKcsLanNhom[];
}
export interface SxKcsKiemIn {
  /** Bỏ trống = máy chủ tự suy: đạt = phần tổ đã làm mà chưa kiểm − số lỗi (form KCS chỉ gõ lỗi). */
  so_dat?: number | null;
  so_loi: number;
  checklist?: SxKcsChecklistKetQuaIn[] | null;
  ghi_chu?: string | null;
  /** Bắt buộc khi `so_loi > 0`, kèm ≥1 ảnh trong `files`. */
  loi_mo_ta?: string | null;
  files?: File[];
  /** Lỗi theo DÒNG — mỗi dòng quy về một công đoạn (null = công đoạn đang kiểm). Có thì thay
   *  `loi_mo_ta` + `files`; `so_loi` phải bằng Σ các dòng. */
  loi?: SxKcsDongLoiIn[];
  /** Lệnh KCS đang mở — máy chủ kiểm công đoạn chịu lỗi thuộc cùng lệnh, đứng trước. */
  lsx_id?: number | null;
}
export interface SxKcsDongLoiIn {
  cong_viec_id: number | null;
  /** Công đoạn giữa: tiêu chí bị tick (null = "Lỗi khác", khi đó `mo_ta` là ghi chú bắt buộc). */
  thu_tu?: number | null;
  so_luong: number;
  mo_ta: string;
  files: File[];
}
export interface SxKcsKiemKetQua {
  kcs_batch_id: number;
  loi_id: number | null;
  cong_viec_id: number;
  department_id: number | null;
  lsx_id: number | null;
  nhom_id: number | null;
  ten_cong_doan: string;
  so_dat: number;
  so_loi: number;
  ket_luan: SxKcsKetLuan;
  version: number;
  /** Phần lỗi quy về công đoạn đứng trước — đã báo tổ đó. */
  bao_loi_nguon?: { cong_viec_id: number; department_id: number | null; ten_cong_doan: string; so_loi: number }[];
}
export interface SxKcsDaXemKetQua {
  loi_id: number;
  kcs_batch_id: number;
  cong_viec_id: number | null;
  department_id: number | null;
  da_xem_luc: string | null;
  nguoi_xem: string | null;
  version: number;
}
export interface SxKcsBaoCaoTheoNgayRow {
  ngay: string;
  tong_nhan: number;
  tong_dat: number;
  tong_loi: number;
}
export interface SxKcsBaoCaoCongDoanRow {
  ten_cong_doan: string;
  tong_so_luong: number;
}
export interface SxKcsBaoCaoToRow {
  to_id: number;
  ten: string;
  tong_so_luong: number;
}
/** Một dòng bảng "Kết quả đã ghi" — MỘT lần kiểm, đã áp đúng filter+scope của báo cáo. */
export interface SxKcsBaoCaoLichSuRow {
  kcs_batch_id: number;
  cong_viec_id: number;
  thoi_diem?: string | null;
  so_luong_dat: number;
  so_luong_khong_dat: number;
  don_vi: string;
  nguon_ma: string;
  nguon_ten: string;
  ten_cong_doan: string;
  nguoi_ghi?: string | null;
  trang_thai_gui_kho: SxKcsTrangThaiGuiKho;
}
export interface SxKcsBaoCao {
  tong_luot: number;
  tong_nhan: number;
  tong_dat: number;
  tong_loi: number;
  ty_le_dat?: number | null;
  theo_ngay: SxKcsBaoCaoTheoNgayRow[];
  cong_doan: SxKcsBaoCaoCongDoanRow[];
  to: SxKcsBaoCaoToRow[];
  lich_su: SxKcsBaoCaoLichSuRow[];
  so_lan_ghi_loi: number;
  /** Tiêu chí đã xét ở các lần kiểm bước cuối — lần xét, số lần bị tick hỏng. */
  tieu_chi: {
    ten: string; cong_doan: string; lsx_ma: string | null; to_ten: string | null; lan_xet: number; hong: number;
    /** Số lỗi KCS ghi cho tiêu chí ngay ở công đoạn giữa (đơn vị `don_vi`). */
    loi_o_cong_doan?: number; don_vi?: string | null;
    /** Số lần ghi lỗi gắn tiêu chí này. */
    lan: number;
  }[];
  /** Cột ngày (hoặc tháng khi kỳ có hơn 31 ngày lỗi) của hai bảng lỗi theo ngày. */
  nhiet_cot: { khoa: string; nhan: string }[];
  nhiet_cong_doan: SxKcsNhietDong[];
  nhiet_to: SxKcsNhietDong[];
  /** Giá trị cho menu Lọc của tab (kèm số lượt kiểm trong kỳ + ô tìm). */
  loc_khach?: LuaChonLoc[];
  loc_cong_doan?: { ten: string; so: number }[];
  /** Dạng Bảng | Biểu đồ (11/10/2026). */
  so_lenh_loi: number;
  ky_truoc: SxKcsKyTruoc | null;
  /** Trục thời gian liền của kỳ (ngày, hoặc tháng khi kỳ dài) kèm nhận/đạt bước cuối. */
  truc: { khoa: string; nhan: string; nhan_cuoi: number; dat_cuoi: number }[];
  phan_tich: Record<SxKcsChieu, SxKcsNhomLoi[]>;
  /** Một trang "Các lần ghi lỗi" (đã áp bấm-lọc), `lan_loi_tong` = tổng số dòng. */
  lan_loi: SxKcsLanLoi[];
  lan_loi_tong: number;
}
/** Ba chiều bấm-lọc của tab Báo cáo lỗi. */
export type SxKcsChieu = "cong_doan" | "to" | "tieu_chi";
export interface SxKcsKyTruoc {
  tu: string;
  den: string;
  tong_luot: number;
  ty_le_dat: number | null;
  so_lan_ghi_loi: number;
  so_lenh_loi: number;
}
export interface SxKcsNhomLoi {
  ten: string;
  lan: number;
  /** Số lỗi theo MÃ chặng đơn vị. */
  so_theo_dv: Record<string, number>;
  so_lenh: number;
  tai_cho: number;
  lot: number;
  /** Số lần ghi lỗi theo khoá mốc trục. */
  ngay: Record<string, number>;
}
export interface SxKcsLanLoi {
  loi_id: number;
  kcs_batch_id: number;
  thoi_diem: string | null;
  lsx_ma: string | null;
  san_pham: string | null;
  khach: string | null;
  cong_doan: string;
  to: string | null;
  tieu_chi: string | null;
  ghi_chu: string | null;
  noi_bat: string;
  tai_cho: boolean;
  so_luong: number;
  don_vi: string | null;
  anh: { file_name: string; file_url: string; file_type: string | null }[];
  nguoi_ghi: string | null;
}
export interface SxKcsNhietDong {
  ten: string;
  lsx_ma: string | null;
  don_vi: string | null;
  o: Record<string, number>;
  tong: number;
  lan: number;
}
/** Kỳ theo quy ước chung của thanh lọc (`tu_ngay/den_ngay/moc`, mốc duy nhất `kiem` = ngày kiểm). */
export interface SxKcsBaoCaoParams {
  tu_ngay?: string | null;
  den_ngay?: string | null;
  moc?: string | null;
  lsx_id?: number | null;
  tu_khoa?: string | null;
  cong_doan_id?: number | null;
  khach_id?: number | null;
  cong_doan?: string | null;
  /** Bấm-lọc trên tab: công đoạn gây, tổ chịu, tiêu chí ("Lỗi khác"), khoá mốc trục. */
  chon_cong_doan?: string | null;
  chon_to?: string | null;
  chon_tieu_chi?: string | null;
  chon_ngay?: string | null;
  trang?: number;
  co_trang?: number;
  /** Chỉ cho Xuất Excel: cách xem của tab — sheet 2 ra đúng bảng đang xem. */
  xem?: SxKcsChieu;
}

// ── Nhập kho thành phẩm: yêu cầu NHẬP thật của kho ────────────────────────────
export interface SxNhapKhoTpDong {
  hang_id: number;
  ma_hang: string;
  ten_hang: string;
  dvt: string | null;
  sl_de_nghi: number;
  /** Giá bán lấy từ đơn (đ / đơn vị món) — null khi dòng đơn chưa có thành tiền. */
  don_gia_ban: number | null;
}
/** "Tạo yêu cầu nhập kho" trên công đoạn cuối — MỘT yêu cầu NHẬP của kho thật (mã DNN…). `so_luong`
 *  theo đơn vị ra của công đoạn (số KCS vừa gửi); `dong[].sl_de_nghi` theo đơn vị của món thành phẩm. */
export interface SxNhapKhoYcKetQua {
  request_id: number;
  ma: string;
  cong_viec_id: number;
  so_luong: number;
  don_vi: string | null;
  dong: SxNhapKhoTpDong[];
}
// ── G5: Đóng nhóm §16 + đóng thiếu §13.3 ─────────────────────────────────────
export interface SxDongLenhCanhBao {
  ma: "chua_kiem" | "chua_gui_kho" | "thieu_muc_tieu" | "viec_do";
  cau: string;
}
export interface SxDongLenhTinhTrang {
  nhom_id: number;
  order_id?: number | null;
  trang_thai: "in_production" | "closed";
  version: number;
  lenh: { id: number; ma: string }[];
  muc_tieu: number | null;
  da_dat: number;
  don_vi: string;
  canh_bao: SxDongLenhCanhBao[];
  dong_boi: string | null;
  dong_luc: string | null;
  /** Người xem đóng được khi còn cảnh báo và mở lại được (ô "Đóng lệnh thiếu"). */
  duoc_dong_thieu: boolean;
}
export interface SxDongLenhKetQua {
  nhom_id: number;
  order_id?: number | null;
  trang_thai: string;
  kieu: "dong" | "mo_lai";
  version: number;
  lenh_ma: string[];
  da_dat: number;
  muc_tieu: number | null;
  don_vi: string;
}
/* `SxThuongToTruong` GỠ 11/09/2026 (mg `0297`): bảng `san_xuat_thuong_to_truong` và chuỗi ghi
   thưởng lúc ĐÓNG NHÓM đã xoá — thưởng/phạt tổ trưởng là TIỀN, mà sản xuất thôi giữ tiền. Bảng bậc
   `piece_leader_bonus_brackets` và cột lương `thuong_to_truong` cũng GỠ 13/09/2026 (mg `0300`). */


export interface HangChoItem {
  order_id: number;
  order_no: string;
  customer_name: string | null;
  sale_name: string | null;
  delivery_committed_date: string | null;
  is_rush: boolean;
  production_note: string | null;
  san_xuat_released_at: string | null;
  /** Ngày tạo đơn — cột "Ngày tạo" + mốc kỳ `tao` của hàng chờ. */
  created_at?: string | null;
  so_dong: number;
  so_dong_co_lsx: number;
  san_pham_tom_tat?: string | null;
}
export interface HangChoOut {
  items: HangChoItem[];
  /** TỔNG đơn còn nợ lệnh trên MÁY CHỦ, không phải số dòng của trang. */
  total: number;
  page: number;
  size: number;
}

export interface LsxPreviewRouting {
  thu_tu: number; ten: string; nhom: string | null;
  /** Cùng bộ mã với `LsxCongDoan.loai_buoc` — thay cờ `thue_ngoai` cũ, để màn "lệnh dự kiến"
   *  và màn lệnh đã tạo hiển thị giống nhau. */
  loai_buoc: LsxLoaiBuoc;
  department_id: number | null; department_ten: string | null;
  nha_cung_cap: string | null;
}
export interface LsxPreviewLine {
  order_line_id: number;
  ten: string;
  so_luong_dat: number;
  don_vi_tinh: string;
  phieu_thanh_phan_id: number | null;
  ptg_ma: string | null;
  /** Nhãn nhóm — chỉ gom hiển thị; sản xuất vẫn 1 lệnh cho mỗi dòng đơn. */
  nhom: string | null;
  // null = chưa tính được (dòng chưa có bài tính giá) → hiện "—", không phải số 0 thật.
  bu_hao_to: number | null;
  so_to_ke_hoach: number | null;
  so_to_nguyen: number | null;
  so_con: number | null;
  so_kem: number | null;
  so_luot: number | null;
  /** MÃ đơn vị từng chặng dòng giấy của DÒNG NÀY. null = routing không nói tới chặng đó (vd không
   *  có bước xả giấy) ⇒ dùng nhãn mặc định. Tên lấy bằng `tenDonVi(ma)`. */
  don_vi_to: string | null;
  don_vi_to_nguyen: string | null;
  don_vi_tp: string | null;
  don_vi_tay: string | null;
  routing: LsxPreviewRouting[];
  quy_cach: Record<string, unknown> | null;
  /** SL lúc tính giá KHÁC SL đơn (cảnh báo mềm — số dùng thật là của đơn). */
  sl_ptg: number | null;
  lsx_id: number | null;
  lsx_ma: string | null;
  /** Kho đang có bao nhiêu sản phẩm bán này của khách (tồn của mã trừ phần đơn khác đang giữ).
   *  Ruột và bìa cùng cuốn mang cùng số; đơn vị là `ton_dvt` của cụm. Thiếu = khách chưa có mã. */
  ton_san?: number | null;
  ton_dvt?: string | null;
}
export interface LsxPreviewOut {
  order_id: number;
  order_no: string;
  customer_name: string | null;
  sale_name: string | null;
  delivery_committed_date: string | null;
  is_rush: boolean;
  production_note: string | null;
  lines: LsxPreviewLine[];
}

/** Gia công ngoài của BƯỚC (spec 2026-09-26) — chỉ có nghĩa khi `loai_buoc = "thue_ngoai"`.
 *  Tên nhà gia công do máy chủ ghi theo `nha_cung_cap_id`; việc mang đi / chốt số nằm ở
 *  `api.giaCongNgoai`, không ở bước. */
interface LsxThueNgoaiFields {
  nha_cung_cap_id: number | null;
  nha_cung_cap: string | null;
}

export interface LsxCongDoan extends LsxThueNgoaiFields {
  id: number; step_key: string; thu_tu: number; cong_doan_id: number | null;
  ten: string; nhom: string | null; loai_buoc: LsxLoaiBuoc; bat_buoc: boolean;
  department_id: number | null; department_ten: string | null;
  may_id: number | null; may_ten: string | null;
  /** Hai CỜ đọc từ danh mục Công đoạn — quyết định bước có hỏi khuôn không; `tooling_type` còn là
   *  chiều lọc thứ hai của ô chọn dao. Năm field `khuon_be_*` là ẢNH CHỤP server ghép sẵn để bày
   *  cho thợ (mã · tên · SỐ KỆ · tình trạng · ngày về) — màn khỏi phải tra danh mục Khuôn. */
  requires_tooling: boolean; tooling_type: string | null;
  khuon_be_id: number | null;
  khuon_be_ma: string | null;
  khuon_be_ten: string | null;
  khuon_be_so_ke: string | null;
  khuon_be_tinh_trang: string | null;
  /** Ý ĐỊNH của sale về khuôn, chép từ phiếu tính giá lúc dựng lệnh + câu nhắc khi nó LỆCH với con
   *  dao kế hoạch đã chốt (`khuon_lech = null` là không lệch). Nhắc chứ không chặn. */
  khuon_nguon: "co_san" | "lam_moi" | null;
  khuon_phi: number;
  khuon_lech: string | null;
  // Đơn vị VÀO ≠ RA là chuyện thường ở bế/xén — hệ số quy đổi nối hai đầu.
  so_luong_vao: number; so_luong_ra: number;
  don_vi_vao: string; don_vi_ra: string; he_so_quy_doi: number;
  /** Bước có nằm trên DÒNG GIẤY không (server quyết theo cờ trạm của danh mục Đơn vị — FE không
   *  tự suy từ mã được). `false` ⇒ số lượng KHÔNG tự tính và bù hao không cộng vào số giấy. */
  tren_dong_giay: boolean;
  /* `don_vi_san_luong` · `loi_quy_doi` · `san_luong_dien_giai` GỠ 18/09/2026 (mg `0324`) cùng
     công thức sản lượng ra của công đoạn — bước ngoài dòng giấy nay là số tự khai ở bước. */
  hao_hut: number; hao_hut_pct: number; ty_le_hao_hut: number; so_luot_chay: number;
  /** SỐ GIỜ KẾ HOẠCH của bước TỔ — ô gõ tay, mặc định 0 (mg `0319`). Bước máy luôn 0. Kíp chuẩn
   *  + năng suất chép từ đầu việc GỠ 18/09/2026 (mg `0320`, `0321`). */
  so_gio_ke_hoach: number;
  // `setup_phut` + `chay_phut` là số DẪN XUẤT (chuẩn bị + tốc độ kế thừa từ máy);
  // `phat_sinh_phut` = ô "Thời gian khác".
  setup_phut: number;
  chay_phut: number | null;
  phat_sinh_phut: number;
  // derived: chiếm máy theo tốc độ TB (Gantt đặt lịch) + dải nhanh/chậm nhất của máy.
  chiem_may_phut: number; chiem_may_phut_min: number; chiem_may_phut_max: number;
  tong_phut: number;
  thoi_luong_dien_giai: Record<string, unknown>;
  phu_thuoc_step_keys: string[];
  /** `tu_dong` = dòng máy bung khi chọn công việc khoán (mg 0191) ⇒ lần bung sau thay được.
   *  false = người tự thêm / đã sửa số ⇒ máy chừa ra. */
  /** `hang_loai` nói món nằm ở DANH MỤC nào: `"giay"` = NVL chính người lập lệnh tự chọn,
   *  `"vat_tu"` = mực/keo/màng. `vat_tu_id` là id TRONG danh mục đó ⇒ so sánh phải đi theo CẶP,
   *  Giấy #7 và Vật tư #7 là hai món khác nhau (08/09/2026). */
  /** `giay_loai` (mg 0426): dòng giấy là Giấy hay Sóng; vật tư khác "". */
  vat_tus: { id: number; hang_loai?: "giay" | "vat_tu"; giay_loai?: "giay" | "song" | "";
             vat_tu_id: number; vat_tu_ma: string;
             vat_tu_ten: string; don_vi: string; so_luong: number; tu_dong?: boolean; sua_tay?: boolean;
             /** Khổ dòng GIẤY (mm, ngắn × dài) — giấy đếm tờ nguyên theo khổ. Hàng khác 0 · 0. */
             kho_rong?: number; kho_dai?: number;
             /** Vật tư KHÁC giấy: số chip đã chép từ phiếu + danh sách chip của vật tư (chỉ đọc). */
             gia_tri_chip?: Record<string, number>;
             chips?: { ma: string; ten: string; don_vi?: string | null }[] }[];
  ghi_chu: string | null;
  /* Đầu việc ghim ở bước (`khoan_rate_id` · `khoan_ten` · `khoan_chon_duoc`) GỠ 18/09/2026 (mg
     `0320`): việc khoán chọn LÚC GHI MẺ ở bàn tổ, lọc theo tổ của bước. */
  /** Lượng TÍNH SẴN cho mọi vật tư theo bước này — chọn món nào ở drawer là điền số ngay.
   *  Món chưa tính ra được vẫn CÓ trong mảng với `so_luong: null` + `ly_do` chỉ chỗ khai công
   *  thức ⇒ ô để trống cho người khai (không đoán), nhưng người dùng biết vì sao nó trống. */
  vat_tu_goi_y: {
    hang_loai?: "giay" | "vat_tu";
    vat_tu_id: number;
    so_luong: number | null;
    dien_giai: string | null;
    ly_do: string | null;
    /** Giấy: khổ + đơn vị (tờ nguyên) gợi ý từ quy cách lệnh. */
    kho_rong?: number;
    kho_dai?: number;
    don_vi?: string;
  }[];
  /** Số ĐÚNG RA phải là theo danh mục HIỆN TẠI, chỉ có khi KHÁC số đã lưu. null = không lệch.
   *  Lệnh là ảnh chụp nên server không tự đè — màn gạch số cũ rồi mời bấm Lưu. */
  so_luong_vao_moi: number | null;
  so_luong_ra_moi: number | null;
}
export interface LsxCongDoanBody extends Partial<Omit<LsxThueNgoaiFields, "nha_cung_cap">> {
  step_key?: string; thu_tu?: number; cong_doan_id?: number | null; ten?: string; nhom?: string | null;
  /* `bat_buoc` GỠ 07/09/2026 — server không nhận nữa, mọi bước routing đều bắt buộc (mg 0275). */
  loai_buoc?: LsxLoaiBuoc;
  department_id?: number | null; may_id?: number | null;
  /** Con dao của bước (`khuon_be.id`). null = bỏ gán. */
  khuon_be_id?: number | null;
  so_luong_vao?: number; so_luong_ra?: number;
  don_vi_vao?: string; don_vi_ra?: string; he_so_quy_doi?: number;
  hao_hut?: number; hao_hut_pct?: number; so_luot_chay?: number;
  /** Số giờ kế hoạch của bước TỔ — số thập phân ≥ 0, để 0 là hợp lệ (mg `0319`). */
  so_gio_ke_hoach?: number;
  setup_phut?: number;
  phat_sinh_phut?: number;
  phu_thuoc_step_keys?: string[];
  /** Bỏ trống `hang_loai` là server hiểu `"vat_tu"` — giữ đúng nghĩa client cũ. */
  vat_tus?: { hang_loai?: "giay" | "vat_tu"; vat_tu_id: number; so_luong?: number | null;
              tu_dong?: boolean; sua_tay?: boolean; gia_tri_chip?: Record<string, number>;
              kho_rong?: number; kho_dai?: number }[];
  ghi_chu?: string | null;
}
export interface LsxPhuThuocOption {
  lsx_id: number; lsx_ma: string; nhom: string | null; step_key: string; ten_buoc: string; thu_tu: number;
}
/** Tổng thời gian dẫn cả lệnh — DẪN XUẤT ở server, không lưu cột. */
export interface LsxLeadTime {
  tong_phut: number;
  chiem_may_phut: number;
  chiem_may_phut_min: number; chiem_may_phut_max: number;
  so_ngay: number;              // quy ước 8h/ngày, chưa trừ nghỉ lễ
  ngay_du_kien_xong: string | null;
  ngay_con_lai: number | null;  // tới hạn giao khách; âm = đã trễ
}
/** 1 dòng GỢI Ý của phép tính ngược — chưa ghi DB. */
export interface LsxTinhNguocRow {
  id: number; thu_tu: number; ten: string;
  so_luong_vao: number; so_luong_ra: number;
  don_vi_vao: string; don_vi_ra: string;
}
export interface LsxTinhNguocOut { rows: LsxTinhNguocRow[]; so_to_ke_hoach: number }
/** Bộ mặc định khi ĐỔI bước sang công đoạn khác. KHÔNG có SL vào/ra — số đó thuộc CHUỖI
 *  (bước trước giao bao nhiêu thì bước này nhận bấy nhiêu), không thuộc công đoạn. */
export interface LsxBuocMacDinh {
  cong_doan_id: number; ten: string; nhom: string | null;
  /** Tổ MẶC ĐỊNH (tổ đầu danh sách) + cả danh sách tổ phụ trách công đoạn để ô tổ chọn trong đó. */
  department_id: number | null;
  department_ids: number[];
  don_vi_vao: string; don_vi_ra: string; he_so_quy_doi: number;
  /** Cặp đơn vị trên có nằm trên DÒNG GIẤY không — server quyết theo cờ trạm của danh mục Đơn vị.
   *  Phải áp CÙNG LÚC với hai ô đơn vị: cờ là thuộc tính của cặp đơn vị, không phải của dòng. */
  tren_dong_giay: boolean;
  /** Cờ DỤNG CỤ của công đoạn mới — ô chọn khuôn của bước lọc kho theo `tooling_type`, mà client
   *  không suy ra được nó từ tên. Áp cùng lúc, nếu không thì bước vừa đổi sang công đoạn cần
   *  khung lụa vẫn bày dao BẾ. */
  requires_tooling: boolean;
  tooling_type: string | null;
  setup_phut: number;
  /** GỢI Ý máy của công đoạn mới — chỉ có số khi công đoạn khai ĐÚNG MỘT máy còn dùng. Client chỉ
   *  áp khi dòng đang TRỐNG máy: máy người dùng đã chọn không bị đổi. */
  may_id_goi_y: number | null;
}
/** Giờ chạy của MỘT bước theo bộ số ĐANG SỬA trên drawer — server tính THỬ rồi vứt, không ghi
 *  DB. Phần tiền công gỡ 11/09/2026. */
export interface LsxXemTruocBuoc {
  step_key: string;
  may_id: number | null;
  chiem_may_phut: number;
  thoi_luong_dien_giai: Record<string, unknown>;
}
/** DÒNG CHẢY của MỘT bước NẾU đổi/chèn công đoạn — server chạy đúng đường Lưu routing rồi
 *  rollback. Khớp `step_key` client gửi lên (kể cả khoá tạm `r{n}` của bước mới chèn). */
export interface LsxXemTruocRoutingBuoc {
  step_key: string;
  so_luong_vao: number; so_luong_ra: number;
  don_vi_vao: string | null; don_vi_ra: string | null; he_so_quy_doi: number;
  hao_hut: number; hao_hut_pct: number;
  tren_dong_giay: boolean;
}
/** 1 bước trong payload xem-trước routing — chỉ trường chuỗi ngược cần, không mang vật tư/khoán. */
export interface LsxXemTruocRoutingRow {
  step_key?: string | null; thu_tu?: number | null; cong_doan_id?: number | null;
  ten?: string | null; nhom?: string | null; loai_buoc?: string | null;
  department_id?: number | null; may_id?: number | null;
}

/* `LsxDauViecOption` GỠ 18/09/2026 (mg `0320`) cùng ô "Đầu việc thợ làm" của bước và endpoint
   `dau-viec-options`. */
export interface LsxListItem {
  id: number; ma: string; loai: string; ten: string; trang_thai: LsxTrangThai;
  /** Nhãn nhóm của dòng đơn — cho biết lệnh "Bìa" thuộc "Catalogue A4 - 32 trang". */
  nhom: string | null;
  order_id: number; order_no: string | null; customer_name: string | null;
  so_luong_dat: number; don_vi_tinh: string; so_to_ke_hoach: number;
  han_giao_khach: string | null; han_hoan_thanh_sx: string | null;
  is_rush: boolean; to_dau_ten: string | null; so_cong_doan: number;
  /** Ngày tạo lệnh — cột "Ngày tạo" + mốc kỳ `tao`. */
  created_at?: string | null;
  /** MÃ đơn vị chặng TỜ IN của lệnh này (server đọc từ routing). Bảng liệt kê nhiều lệnh, mỗi lệnh
   *  có thể đếm bằng đơn vị xưởng tự đặt — nên đơn vị đi theo DÒNG, không nằm ở tiêu đề cột.
   *  Tên lấy bằng `tenDonVi(ma)`; null = lệnh chưa có bước nào trên dòng giấy. */
  don_vi_to: string | null;
  /** Gia công ngoài của lệnh (lần chưa huỷ) — null = lệnh không đi gia công. Lần ĐẠI DIỆN: đang
   *  mở trước đã xong; trọn gói / đang ở ngoài trước chờ mang đi. */
  gia_cong?: LsxListGiaCong | null;
}
export interface LsxListGiaCong {
  kieu: "mot_phan" | "tron_goi";
  trang_thai: GiaCongTrangThai;
  nha_cung_cap_ten: string;
  ten_viec: string;
  bai_ghep_ma: string | null;
  so_lan: number;
  so_lan_mo: number;
  /** Trọn gói xưởng cấp giấy chưa gửi đề nghị xuất giấy — chip "Chờ cấp giấy". */
  cho_cap_giay?: boolean;
}
export interface LsxListOut {
  items: LsxListItem[];
  /** TỔNG lệnh khớp bộ lọc trên MÁY CHỦ — không phải `items.length` (chỉ là 1 trang). */
  total: number;
  page: number;
  size: number;
  /** trạng thái → số lệnh, tính với CÙNG bộ lọc nhưng BỎ lọc trạng thái, nên tab đang không
   *  được chọn vẫn khoe đúng số của nó. Khoá `all` = tổng mọi trạng thái. */
  facets: Record<string, number>;
}
/** Nguồn hai ô lọc "Đơn hàng" / "Khách hàng" — chỉ gồm đơn ĐANG có lệnh. */
export interface LsxBoLocOut {
  orders: { id: number; order_no: string; customer_id: number | null; customer_name: string | null }[];
  customers: { id: number; name: string }[];
}
/** Một chấm trên hàng đèn tổng quan của bảng lệnh (Đợt 1 redesign 18/08/2026).
 *  `ok` = **không vẽ chấm** — 20 lệnh × 3 chấm mà đa số xanh thì mắt không bắt được cái đỏ. */
export interface LsxDenItem {
  muc: "do" | "vang" | "ok";
  chu: string;
  /** Bấm chấm là tới thẳng chỗ sửa. `null` khi `ok`. */
  nhay: { man: string; id: number } | null;
}
/** Bốn thứ bảng lệnh CHƯA nói. Hạn cố ý không có đèn: cột `Hạn` đã tô màu và cột `CĐ` đã đỏ khi
 *  lệnh chưa có công đoạn. */
export interface LsxDen {
  vat_tu: LsxDenItem;
  may_gio: LsxDenItem;
  nguoi: LsxDenItem;
  /** Lệnh còn giữ số của lần bung, danh mục Công đoạn nay đã khác. Luôn VÀNG — giữ số cũ không
   *  chặn gì cả, chỉ là số đã cũ. Sửa ngay trong màn lệnh nên không có chỗ `nhay` riêng. */
  danh_muc: LsxDenItem;
}
export interface LsxTongQuanOut {
  items: { lsx_id: number; slack_ngay: number | null; den: LsxDen }[];
}
export interface LsxDetail {
  id: number; ma: string; loai: string; lsx_goc_id: number | null; ten: string;
  /** Nhãn nhóm đọc sống từ dòng đơn — luôn đúng hiện tại, khác `quy_cach_json` là ảnh chụp. */
  nhom: string | null;
  trang_thai: LsxTrangThai;
  order_id: number; order_line_id: number; order_no: string | null;
  /** Trạng thái ĐƠN gắn với lệnh — dùng để ẩn tab Công đoạn khi đơn đã hủy. */
  order_status: string | null;
  customer_name: string | null; customer_po_no: string | null; sale_name: string | null;
  quote_version_id: number | null; quote_number: string | null; quote_version_number: number | null;
  phieu_thanh_phan_id: number | null; ptg_id: number | null; ptg_ma: string | null;
  so_luong_dat: number; don_vi_tinh: string;
  so_to_ke_hoach: number; so_to_nguyen: number; so_con: number;
  /** MÃ đơn vị bốn chặng dòng giấy — SERVER chấm (`dong_giay.don_vi_chuoi`), client chỉ tra TÊN.
   *  Đừng suy lại ở FE: bản chép tay thứ hai đã từng cùng sai với bản server ở chặng `tay`.
   *  null = routing không nói tới chặng đó ⇒ hiện mỗi con số, không bịa nhãn. */
  don_vi_to: string | null;
  don_vi_to_nguyen: string | null;
  don_vi_tp: string | null;
  don_vi_tay: string | null;
  ban_giao_at: string | null; han_giao_khach: string | null; han_hoan_thanh_sx: string | null;
  is_rush: boolean;
  quy_cach_json: Record<string, unknown> | null;
  may_id: number | null; may_ten: string | null;
  nguoi_phu_trach_id: number | null; nguoi_phu_trach_ten: string | null;
  ghi_chu: string | null; created_at: string; updated_at: string;
  /** "Lưu ý sản xuất (gửi xưởng)" đọc SỐNG từ đơn hàng — nguồn DUY NHẤT của ô lưu ý thợ thấy. */
  luu_y_gui_xuong: string | null;
  cong_doans: LsxCongDoan[];
  /** Mã CHẶN nút "Sẵn sàng lập kế hoạch" (dịch bằng `LSX_THIEU_LABELS`). Rổ cảnh báo mềm
   *  `canh_bao` đã gỡ cả hai đầu 25/08/2026 — không màn nào hiện nó. */
  thieu: string[];
  /** Mã thiếu cấp BƯỚC → id các bước dính — màn lệnh gọi đích danh bước nào chặn nút Sẵn sàng. */
  thieu_buoc?: Record<string, number[]>;
  lead_time: LsxLeadTime | null;
  /* `khoan_tien_tong` (Σ "Công thợ dự kiến" của lệnh) GỠ 11/09/2026. */
  /** Chừa tách chiều do server tính (`chua_theo_chieu`) — đừng cộng lại ở FE. */
  chua_dai: number;
  chua_rong: number;
  /** Lệnh đang ghép chung tờ với ai. `null` = in riêng. Khi có, THÔNG SỐ TỜ (máy in, giấy, khổ
   *  tờ in, số con) do BÀI quyết — sửa ở màn lệnh không có tác dụng. */
  bai_ghep: LsxBaiGhep | null;
  /** Lệnh đang GIỮ CHỖ vật tư ⇒ server chặn sửa số lượng / quy cách / routing và xoá lệnh, chặn
   *  CẢ bản xem trước. Màn lệnh phải khoá bảng routing và nói đường lùi ngay từ đầu — không thì
   *  sửa xong mới ăn 409 lúc bấm Lưu, còn xem-trước 409 im lặng làm số trên bảng đứng im. */
  giu_cho_bat: boolean;
  /** Lệnh chưa phát hành mà không giao trọn gói được (đi chung lệnh khác / bài ghép) — câu nêu đích
   *  danh lệnh đang dính. null = giao được, hoặc lệnh đã qua bước đặt trọn gói. */
  tron_goi_chan?: string | null;
  tron_goi_chan_ngan?: string | null;
  /** Danh mục Công đoạn đã đổi sau lần lệnh này lấy số. `null` = còn khớp, KHÔNG hiện băng. */
  danh_muc_doi?: DanhMucDoiOut | null;
  /** Tiêu chí KCS khai/sửa sau lúc phát hành — thẻ việc còn giữ bộ cũ. `null` = khớp. */
  tieu_chi_kcs_doi?: TieuChiKcsDoiOut | null;
}
/** Một thẻ việc có bộ tiêu chí KCS khác danh mục: bộ đang giữ, bộ danh mục nay, câu thêm / bỏ. */
export interface TieuChiKcsDoiCongDoan {
  cong_viec_id: number; ten: string; cu: string[]; moi: string[]; them: string[]; bo: string[];
  doi_thu_tu: boolean; da_bat_dau: boolean;
}
export interface TieuChiKcsDoiOut { so_cong_doan: number; cong_doans: TieuChiKcsDoiCongDoan[] }
/** Một dòng vật tư lệch. Để trống một bên tuỳ rổ: rổ THÊM chưa có số cũ, rổ BỎ không còn số mới. */
export interface DanhMucDoiVatTu {
  hang_loai?: "giay" | "vat_tu";
  vat_tu_id: number; ma: string | null; ten: string | null; don_vi: string | null;
  so_luong_cu: number | null; so_luong_moi: number | null;
}
export interface DanhMucDoiBuoc {
  buoc_id: number; step_key: string | null; thu_tu: number; ten: string;
  /* Ba khoá KHOÁN (`khoan` · `khoan_chua_chon` · `khoan_mo_coi`) GỠ 18/09/2026 (mg `0320`): bước
     thôi ghim đầu việc. Băng còn VẬT TƯ của công đoạn và MÁY bị gỡ khỏi công đoạn. */
  vat_tu_them: DanhMucDoiVatTu[];
  /** Bước đang có mà danh mục không còn bung. CHỈ BÁO — nút cập nhật không xoá dòng nào. */
  vat_tu_bo: DanhMucDoiVatTu[];
  vat_tu_lech: DanhMucDoiVatTu[];
  may_canh_bao: string | null;
}
/** Danh mục Công đoạn đã đổi sau lúc lệnh chụp ảnh. `null` khi lệnh còn khớp hết danh mục.
 *
 *  Server so NỘI DUNG (dựng lại ảnh "nếu bung bây giờ" rồi đối chiếu), KHÔNG so `updated_at` như
 *  băng cùng loại ở phiếu tính giá — công thức khoán/định mức nằm ở bảng con không có cột thời
 *  gian. `co_the_cap_nhat=false` ⇒ nút cập nhật khoá, `ly_do_khoa` là câu nói vì sao. */
export interface DanhMucDoiOut {
  so_buoc: number; co_the_cap_nhat: boolean; ly_do_khoa: string | null; buocs: DanhMucDoiBuoc[];
}
export interface LsxBaiGhep {
  id: number; ma: string; trang_thai: string;
  may_id: number | null; may_ten: string | null;
  giay_id: number | null; kho_in_dai: number | null; kho_in_rong: number | null;
  so_con_tren_to: number;
  /** `lsx_step_key → bước chung đang ĐÈ lên nó`. Màn lệnh phải nói được CẢ HAI số ("bài cấp
   *  1.480 tờ · phần lệnh này 987 tờ"), không thì người sửa máy ở đây mà không biết máy thật
   *  nằm ở bài. Không còn `buoc_in_step_key`: bài gộp cả CTP/cán/bế, không riêng bước in. */
  buoc_bi_de: Record<string, {
    gop_step_key: string; ten: string;
    to_ten: string | null; may_ten: string | null;
    so_luong_vao: number; so_luong_ra: number; hao_hut: number;
  }>;
}
export interface LsxUpdateBody {
  ten?: string; so_luong_dat?: number; don_vi_tinh?: string;
  so_to_ke_hoach?: number; so_to_nguyen?: number; so_con?: number;
  han_hoan_thanh_sx?: string | null; is_rush?: boolean;
  may_id?: number | null;
  nguoi_phu_trach_id?: number | null; ghi_chu?: string | null;
  quy_cach?: LsxQuyCachBody;
}
/** THÔNG SỐ (nguyên nhân) kế hoạch sửa được trên lệnh. HỆ QUẢ — số kẽm, số lượt, số mảnh xả,
 *  số tờ — server tính lại từ đúng bộ này; gửi lên cũng bị bỏ. */
export interface LsxQuyCachBody {
  giay_id?: number | null;
  nguon_giay?: string;
  kho_nguyen_dai?: number; kho_nguyen_rong?: number;
  kho_in_dai?: number; kho_in_rong?: number;
  dai_thanh_pham?: number; rong_thanh_pham?: number;
  quy_cach_in?: string;
  muc_a?: string[]; muc_b?: string[];
  so_trang?: number; trang_moi_tay?: number;
  bleed_mm?: number; khe_cat_mm?: number;
  con_auto?: boolean;
}
/** Các số MÁY TỰ TÍNH ứng với bộ thông số đang gõ — chưa lưu. */
export interface LsxQuyCachXemTruoc {
  doi: string[];
  so_con: number; so_kem: number; kem_moi_tay: number; so_manh_xa: number;
  so_to_per_sp: number; so_to_ke_hoach: number; so_to_nguyen: number; so_luot: number;
  so_mau_a: number; so_mau_b: number; so_mau_pha: number;
}
/** Một dòng nhật ký lệnh — câu dựng ở máy chủ, gom cả gia công ngoài, phiếu chi, xưởng, kho. */
export interface LsxActivity {
  at: string | null;
  actor_name: string | null;
  action: string;
  tieu_de: string;
  the: string[];
  /** Tên công đoạn khi dòng đến từ một công việc ở xưởng. */
  buoc: string | null;
  tone: "rust" | "moss" | "steel" | "signal" | null;
}
/** Tệp gắn vào CẢ lệnh. `nguoi_tai_ten` do máy chủ chốt từ tài khoản người tải. */
export interface LsxDinhKem {
  id: number;
  ten_tep: string;
  file_url: string;
  content_type: string | null;
  kich_thuoc: number;
  nguoi_tai_ten: string | null;
  tai_luc: string;
}

/** Tệp của MỘT lệnh nhìn từ Bàn tổ (chỉ đọc). Công việc bài ghép thì mỗi lệnh thành viên một nhóm. */
export interface SxTepLenhNhom {
  lsx_id: number;
  lsx_ma: string;
  lsx_ten: string | null;
  items: LsxDinhKem[];
}

/** Thời gian chờ trước lượt nối lại thứ `lan` (0-based): min(30 s, 1 s·2^n) + ngẫu nhiên 0–1 s.
 *  Trước đây cố định 3 s không ngẫu nhiên ⇒ sau mỗi lần deploy mọi tab nối lại CÙNG NHỊP, đập vào
 *  máy chủ đúng lúc nó vừa dậy. */
export function choNoiLaiSse(lan: number): number {
  return Math.min(30_000, 1_000 * 2 ** lan) + Math.random() * 1_000;
}

export function connectQuoteEvents(
  token: string,
  onEvent: (e: QuoteEvent) => void,
  opts: {
    /** Gọi mỗi lần NỐI LẠI thành công (không gọi lần nối đầu). Sự kiện bắn trong lúc đứt đã rơi mất
     *  — nơi gọi dùng mốc này để nạp lại số đếm / dữ liệu màn đang mở cho khỏi lệch. */
    onMo?: () => void;
  } = {},
): () => void {
  let closed = false;
  let controller: AbortController | null = null;
  let current = token;
  let henCho: ReturnType<typeof setTimeout> | undefined;
  let danhThuc: (() => void) | null = null;

  const choTruocKhiNoi = (ms: number) =>
    new Promise<void>((ok) => {
      danhThuc = ok;
      henCho = setTimeout(ok, ms);
    });

  async function loop(): Promise<void> {
    let lanLoi = 0;
    let daMoLanNao = false;
    while (!closed) {
      controller = new AbortController();
      const ctl = controller;
      // Watchdog: backend gửi event hoặc ": ping" ít nhất mỗi 20s. Im lặng > 50s = kết nối CHẾT
      // NGẦM (nửa-mở qua proxy / zombie uvicorn --reload trên Windows) mà `reader.read()` treo mãi
      // không báo lỗi → abort để rơi vào catch → reconnect. Nhờ vậy SSE TỰ LÀNH, không cần F5.
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const kick = () => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => ctl.abort(), 50_000);
      };
      try {
        kick();
        // Token MỚI NHẤT (xoay ngầm mỗi 15 phút) — kênh không phải đóng/mở lại theo React nữa.
        current = layTokenMoiNhat() ?? current;
        const resp = await fetch(`${BASE_URL}/api/quotations/events`, {
          headers: { ...authHeader(current), Accept: "text/event-stream" },
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (resp.status === 401) {
          // Làm mới rồi cũng CHỜ như mọi lượt hỏng: máy chủ vừa dậy mà trả 401 hàng loạt (token
          // lệch) thì mọi tab không được cùng lúc quay lại ngay.
          const fresh = await refreshAccessToken().catch(() => undefined);
          if (fresh === null) break; // máy chủ từ chối phiên → dừng hẳn (đã báo hết phiên)
          if (fresh) current = fresh;
          throw new Error("SSE 401");
        }
        if (!resp.ok || !resp.body) throw new Error(`SSE ${resp.status}`);
        // Nối được: reset nhịp chờ. Lần nối LẠI (không phải lần đầu) thì báo để nơi gọi bù phần
        // sự kiện đã rơi trong lúc đứt.
        lanLoi = 0;
        if (daMoLanNao) {
          try { opts.onMo?.(); } catch { /* lỗi của nơi gọi không được giết kênh */ }
        }
        daMoLanNao = true;
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          kick();  // có byte (event hoặc ping) → gia hạn watchdog: kết nối còn sống
          buf += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trim())
              .join("\n");
            if (!data) continue;  // heartbeat/comment (": ping")
            try { onEvent(JSON.parse(data) as QuoteEvent); } catch { /* bỏ frame hỏng */ }
          }
        }
      } catch {
        /* lỗi mạng/stream/abort-do-watchdog/401 → reconnect sau backoff */
      } finally {
        if (watchdog) clearTimeout(watchdog);
      }
      if (closed) break;
      await choTruocKhiNoi(choNoiLaiSse(lanLoi));
      lanLoi += 1;
    }
  }

  void loop();
  return () => {
    closed = true;
    controller?.abort();
    if (henCho) clearTimeout(henCho);
    danhThuc?.();
  };
}

// --- RBAC admin shapes ------------------------------------------------------

export type Scope = "own" | "department" | "all";

export interface ModuleDef {
  /** Những "việc" ĐÃ XÁC MINH là chết ở màn này (`["update","delete",…]`) — ma trận tắt sẵn +
   *  khoá + hover cảnh báo đúng mấy ô đó. Mặc định coi mọi ô còn sống: thà để thừa một ô vô hại
   *  còn hơn khoá nhầm một ô đang dùng. */
  viec_chet?: string[];
  key: string;
  label: string;
  /** Dòng quyền THEO TỔ (`to_sx_<id>`, mg 0302): phòng ban mà dòng gắn vào + cấp trong cây khối
   *  sản xuất (gốc = 0, để thụt lề). Module tĩnh để trống. */
  department_id?: number | null;
  cap?: number;
}

export interface Department {
  id: number;
  name: string;
  code: string;
  description?: string | null;
  parent_id?: number | null;
  head_user_id?: number | null;
  head_name?: string | null;
  /** Ảnh của trưởng phòng — phải do server trả, FE chỉ biết ảnh của chính người đang đăng nhập. */
  head_avatar_url?: string | null;
  /** This department's own role/user counts. */
  role_count?: number;
  user_count?: number;
  /** Số HỒ SƠ nhân sự của phòng (Đ2: 'số nhân sự' theo hồ sơ, tách khỏi số tài khoản). */
  employee_count?: number;
  /** Branch-rolled-up counts (department + every descendant) — PBI-4001. */
  total_role_count?: number;
  total_user_count?: number;
  total_employee_count?: number;
  /** Org tier tag + its head-title label (spec-06 / PBI-4009). Null = untagged. */
  level_id?: number | null;
  head_title?: string | null;
  /** Phòng có lương khoán theo sản lượng. */
  has_piece_work?: boolean;
  created_at?: string | null;
  /** Thanh lọc màn Phòng ban: false = dòng chỉ là TỔ TIÊN của phòng khớp (để vẽ đường cây). */
  khop?: boolean;
  /** Đánh dấu khối SẢN XUẤT (spec §13.1). Effective tính theo cây ở FE (self hoặc tổ tiên tick). */
  la_san_xuat?: boolean;
  /** Đánh dấu khối KINH DOANH (mg 0181) — cùng luật kế thừa cây con. Nền cho danh sách
   *  "NV phụ trách" ở màn Khách hàng; chưa tick phòng nào thì backend lùi về quy tắc theo quyền. */
  la_kinh_doanh?: boolean;
  la_giao_hang?: boolean;
  /** Tổ IN (mg 0304) — thợ in ăn khoán: ngày CN / lễ đi làm không có công gốc, trả hết ở phần thêm. */
  la_to_in?: boolean;
  /** Khoán km giao hàng (mg 0231) — chỉ có nghĩa khi `la_giao_hang` bật. Đơn giá là số TÀI XẾ
   *  ĐƯỢC HƯỞNG, không phải cước cả xe. Hai ô % bắt buộc cộng đúng 100 (máy chủ chặn). */
  don_gia_km?: number;
  pct_tai_xe?: number;
  pct_phu_xe?: number;
}

export interface DepartmentSalaryPolicy {
  has_piece_work?: boolean;
}

/** A tier in the org-level catalog (spec-06 / PBI-4009). */
export interface UnitLevel {
  id: number;
  name: string;
  rank: number;
  head_title: string;
}

/** A staff member of a department (PBI-4001 detail panel). */
/** Nhân sự của một phòng — một dòng = một HỒ SƠ (Đ2), kèm tài khoản nếu có.
 *  `user_id`/`username` null = chưa có tài khoản đăng nhập (công nhân xưởng): vẫn thuộc
 *  phòng và vẫn chuyển phòng được, chỉ là không gán vai trò được. */
/** Một người trong nhóm dùng chung (khối Kinh doanh). */
export interface NhomDungChungThanhVien {
  user_id: number;
  ho_ten: string;
  username: string;
}

/** Nhóm DÙNG CHUNG dữ liệu — hai người cùng nhóm thì phạm vi "Của tôi" của họ ở bốn màn
 *  Tính giá · Báo giá · Đơn hàng · Khách hàng được hiểu là "của tôi + của người cùng nhóm". */
export interface NhomDungChung {
  id: number;
  ten: string;
  thanh_viens: NhomDungChungThanhVien[];
  created_at?: string | null;
}

export interface DepartmentMember {
  employee_id: number;
  code?: string | null;
  name: string;
  position?: string | null;
  status: string;
  user_id?: number | null;
  username?: string | null;
  role_name?: string | null;
  is_active?: boolean | null;
  is_head: boolean;
  /** Ảnh lấy từ `users.avatar_url`. Null = chưa có tài khoản, hoặc có mà chưa tải ảnh. */
  avatar_url?: string | null;
}

/** A node in a department's delete-preview subtree (spec-05). */
export interface DepartmentSubtreeRow {
  id: number;
  name: string;
  code: string;
}

export interface UserBrief {
  id: number;
  name: string;
  username: string;
  avatar_url?: string | null;
}

export interface UserRow {
  id: number;
  /** System-generated employee code (NV001, NV002…); may be null on legacy rows. */
  code: string | null;
  name: string;
  username: string;
  department_id: number | null;
  department_name: string | null;
  role_id: number | null;
  role_name: string | null;
  is_active: boolean;
}

export interface AuditRow {
  id: number;
  actor_user_id: number | null;
  actor_name: string | null;
  /** Ai, từ đâu. Rỗng với dòng cũ (trước mg `0336`) và với việc của máy. */
  ip: string | null;
  user_agent: string | null;
  action: string;
  /** Nhãn tiếng Việt do MÁY CHỦ dịch (`app/audit_registry.py`) — FE không tự khai bảng nhãn nữa. */
  nhan: string;
  nhom: string;
  target: string;
  target_loai: string | null;
  /** "Tài sản #28" cho loại ngoài khối danh mục; null = máy chủ chưa khai tên loại. */
  target_nhan?: string | null;
  detail: string;
  created_at: string;
}

/** Một trang nhật ký. `so_dong_bi_an` chỉ có ở trang ĐẦU. */
export interface AuditPage {
  items: AuditRow[];
  trang: number;
  /** Mốc ảnh chụp của trang 1 — gửi lại nguyên si ở các trang sau để xấp trang không trượt. */
  neo: string | null;
  tong: number | null;
  /** Số dòng khớp bộ lọc nhưng bị che vì thiếu quyền trên màn sinh ra dòng. */
  so_dong_bi_an: number | null;
  tu: string | null;
  den: string | null;
}

export interface AuditFacets {
  hanh_dong: { ma: string; nhan: string; nhom: string; so_dong: number }[];
  nguoi: { id: number | null; ten: string | null; so_dong: number }[];
  nhom: { khoa: string; nhan: string; so_dong: number }[];
  /** Loại đối tượng của khối danh mục — để dịch `giay:12` thành "Giấy #12" và bấm sang đúng màn. */
  loai: { loai: string; nhan: string; path: string }[];
  tu: string | null;
  den: string | null;
}

/** Bộ lọc của màn Nhật ký — gửi thẳng lên máy chủ, không lọc lại ở trình duyệt. */
export interface AuditQuery {
  q?: string;
  tu_ngay?: string;
  den_ngay?: string;
  /** Mốc của kỳ — Nhật ký chỉ có `tao`. */
  moc?: string;
  /** Kỳ "Tất cả" của thanh lọc: bỏ cửa sổ 30 ngày mặc định của máy chủ. */
  tat_ca?: boolean;
  action?: string[];
  actor_id?: number[];
  loai?: string[];
  limit?: number;
  trang?: number;
  neo?: string | null;
}

function auditParams(v: AuditQuery): string {
  const p = new URLSearchParams();
  if (v.q) p.set("q", v.q);
  if (v.tu_ngay) p.set("tu_ngay", v.tu_ngay);
  if (v.den_ngay) p.set("den_ngay", v.den_ngay);
  if (v.moc) p.set("moc", v.moc);
  if (v.tat_ca) p.set("tat_ca", "true");
  (v.action ?? []).forEach((a) => p.append("action", a));
  (v.actor_id ?? []).forEach((a) => p.append("actor_id", String(a)));
  (v.loai ?? []).forEach((a) => p.append("loai", a));
  if (v.limit) p.set("limit", String(v.limit));
  if (v.trang && v.trang > 1) p.set("trang", String(v.trang));
  if (v.neo) p.set("neo", v.neo);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Current user's CRUD flags on one module (spec-09 — frontend action gating). */
export interface ModuleCapability {
  module_key: string;
  can_read: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
  scope: Scope;
  // Quyền chi tiết (Cách B).
  can_reassign: boolean;
  can_export: boolean;
  can_view_debt: boolean;
  can_view_discount: boolean;
  can_approve: boolean;
  can_manage_status: boolean;
  can_reset_password: boolean;
  can_lock: boolean;
  can_revoke_sessions: boolean;
  can_assign_role: boolean;
  can_transfer: boolean;
  can_set_head: boolean;
  can_requote: boolean;
  can_manage_price: boolean;
  can_cancel: boolean;
  can_manage_permissions: boolean;
  can_clone: boolean;
  can_toggle_active: boolean;
  can_reparent: boolean;
  can_view_salary: boolean;
  /** nhan_su — SỬA được nhóm field lương/BHXH của hồ sơ (STK · số sổ BHXH · MST · nhóm lương ·
   *  `pit_mode`). Thiếu quyền: backend LẶNG LẼ bỏ các field đó khỏi bản ghi, KHÔNG 403 ⇒ UI
   *  phải đọc lại kết quả rồi mới dám báo "đã đổi". */
  can_edit_salary: boolean;
  can_adjust: boolean;
  /** A2: don_hang_ban — GĐ duyệt "đơn đặc thù" (chỉ Giám đốc). */
  can_approve_exception: boolean;
  /** khach_hang — thiết lập điều khoản tín dụng khách (hạn mức + điều khoản thanh toán). */
  can_set_credit_terms: boolean;
  can_assign_work: boolean;
  can_record_output: boolean;
  can_handover: boolean;
  /** kho — quyền chi tiết module Kho (spec-kho-de-nghi §9.1) + ghi sổ (SoD). */
  can_request: boolean;
  can_view_stock: boolean;
  can_view_cost: boolean;
  can_view_log: boolean;
  can_set_threshold: boolean;
  can_post: boolean;
  /** kho — KHÓA KỲ (chốt sổ) + Báo cáo kho kế toán + export MISA. */
  can_close_book: boolean;
  /** Dòng quyền theo tổ (mg 0302) — ba quyền chi tiết của Bàn tổ, đi cùng phạm vi của dòng. Ô KCS
   *  (`can_qc`) GỠ ở mg 0306. */
  can_run_order?: boolean;
  can_confirm_output?: boolean;
  can_warehouse?: boolean;
  /** Chỉ dòng tổ có cờ KCS (mg 0382) — Đóng lệnh thiếu. */
  can_close_short?: boolean;
  /** cham_cong (mg 0194) — MỘT Ô = MỘT TAB. Xem `PermissionMatrix` để biết ô nào mở tab nào. */
  can_view_timesheet?: boolean;
  can_approve_late_early?: boolean;
  can_manage_locations?: boolean;
  can_manage_shifts?: boolean;
  can_manage_calendar?: boolean;
  /** luong (mg 0195) — tab Bảng lương tháng, tách khỏi cột Xem. */
  can_view_payroll_table?: boolean;
  can_manage_salary_profiles?: boolean;
  can_manage_piece_rates?: boolean;
  can_manage_leave_types?: boolean;
  /** giao_hang (mg 0199) — tab Lên kế hoạch + tab Nhân viên giao hàng. */
  can_plan?: boolean;
  can_view_drivers?: boolean;
}

/** A live login session (active refresh token) for the admin user-detail view (spec-08). */
export interface Session {
  id: number;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
}

export interface Role {
  id: number;
  name: string;
  department_id: number;
}

export interface PermissionRow {
  module_key: string;
  can_read: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
  scope: Scope;
  // Quyền chi tiết (Cách B).
  can_reassign: boolean;
  can_export: boolean;
  can_view_debt: boolean;
  can_view_discount: boolean;
  can_approve: boolean;
  can_manage_status: boolean;
  can_reset_password: boolean;
  can_lock: boolean;
  can_revoke_sessions: boolean;
  can_assign_role: boolean;
  can_transfer: boolean;
  can_set_head: boolean;
  can_requote: boolean;
  can_manage_price: boolean;
  can_cancel: boolean;
  can_manage_permissions: boolean;
  can_clone: boolean;
  can_toggle_active: boolean;
  can_reparent: boolean;
  can_view_salary: boolean;
  can_edit_salary: boolean;
  can_adjust: boolean;
  can_approve_exception: boolean;
  can_set_credit_terms: boolean;
  can_assign_work: boolean;
  can_record_output: boolean;
  can_handover: boolean;
  /** kho — quyền chi tiết module Kho (spec-kho-de-nghi §9.1) + ghi sổ (SoD). */
  can_request: boolean;
  can_view_stock: boolean;
  can_view_cost: boolean;
  can_view_log: boolean;
  can_set_threshold: boolean;
  can_post: boolean;
  /** kho — KHÓA KỲ (chốt sổ) + Báo cáo kho kế toán + export MISA. */
  can_close_book: boolean;
  /** Dòng quyền theo tổ (mg 0302) — ba quyền chi tiết của Bàn tổ, đi cùng phạm vi của dòng. Ô KCS
   *  (`can_qc`) GỠ ở mg 0306. */
  can_run_order?: boolean;
  can_confirm_output?: boolean;
  can_warehouse?: boolean;
  /** Chỉ dòng tổ có cờ KCS (mg 0382) — Đóng lệnh thiếu. */
  can_close_short?: boolean;
  /** cham_cong (mg 0194) — MỘT Ô = MỘT TAB. Xem `PermissionMatrix` để biết ô nào mở tab nào. */
  can_view_timesheet?: boolean;
  can_approve_late_early?: boolean;
  can_manage_locations?: boolean;
  can_manage_shifts?: boolean;
  can_manage_calendar?: boolean;
  /** luong (mg 0195) — tab Bảng lương tháng, tách khỏi cột Xem. */
  can_view_payroll_table?: boolean;
  can_manage_salary_profiles?: boolean;
  can_manage_piece_rates?: boolean;
  can_manage_leave_types?: boolean;
  /** giao_hang (mg 0199) — tab Lên kế hoạch + tab Nhân viên giao hàng. */
  can_plan?: boolean;
  can_view_drivers?: boolean;
}

// --- Khách hàng (CRM), spec-06 v2 -------------------------------------------

/** Loại KH (redesign spec-06 v2): cá nhân (ẩn MST) / công ty (hiện MST). */
export type CustomerKind = "ca_nhan" | "cong_ty";

export interface CustomerRow {
  id: number;
  code: string;
  name: string;
  customer_kind: CustomerKind;
  tax_code: string | null;
  phone: string | null;
  email?: string | null;
  address?: string | null;
  contact_name?: string | null;
  credit_limit: number;
  sale_user_id: number | null;
  sale_name: string | null;
  created_at?: string | null;
  /** Công nợ chỉ-đọc: null + no_ar_module=true until Công nợ (SEAM-16) is built. */
  receivable: number | null;
  no_ar_module: boolean;
  /** Derived from real orders (số THẬT; redesign spec-06 v2 bỏ tier). */
  revenue_12m: number;
  /** Số đơn đã chốt trong cùng 12 tháng với `revenue_12m`. */
  orders_12m: number;
  orders_total: number;
  last_order_at: string | null;
  /** Chính sách tài chính (ai cũng xem; sửa qua /financial, gate set_credit_terms). */
  /** Số ngày công nợ tối đa (net terms, kể từ ngày xuất HĐ). null = chưa đặt hạn ngày. */
  payment_term_days?: number | null;
  discount_min_pct?: number | null;
  discount_max_pct?: number | null;
  markup_min_pct?: number | null;
  markup_max_pct?: number | null;
  /** Rào kê (% trên giá bán) + % thuế TNDN trên kê (mặc định 20) — 20/10/2026. */
  ke_min_pct?: number | null;
  ke_max_pct?: number | null;
  ke_thue_tndn_pct?: number;
  /** Nhãn thủ công (#7) — sales gán tay. */
  tags?: string[];
}

/** List header KPI strip — rolled up over the whole scoped book from real orders. */
export interface CustomerKpis {
  total_customers: number;
  new_this_month: number;
  avg_order_value: number;
  total_revenue?: number;
}

export interface CustomerListOut {
  items: CustomerRow[];
  total: number;
  page: number;
  size: number;
  kpis: CustomerKpis;
  /** Lọc nhanh trạng thái mua: số khách theo `dang_mua` / `ngung` / `chua_don` trên tập lọc. */
  dem_mua?: Record<string, number>;
  /** Dòng Cộng: tổng mua 12 tháng của cả tập lọc. */
  tong_mua_12m?: number;
}

// --- Hồ sơ khách: số liệu THEO KỲ (04/10/2026) -------------------------------
// Mọi khối nhận khoảng ngày [tu, den] (YYYY-MM-DD, giờ VN) và trả kèm cùng kỳ năm trước (`*_cu`).
// Tiền chỉ cộng đơn ĐÃ CHỐT. Lọc / đếm / phân trang ở máy chủ.

export type BuocBieuDo = "tuan" | "thang" | "quy";
export interface KyXem {
  tu: string;
  den: string;
}
export interface TongDon {
  doanh_so: number;
  so_don: number;
  tb_don: number | null;
  so_huy: number;
  tien_huy: number;
}
export interface TongBaoGia {
  so_bg: number;
  tong_gia_tri: number;
  thang: number;
  da_chao: number;
  ti_le: number | null;
  tb_ngay_chot: number | null;
}
export interface CotBieuDo {
  tu: string;
  den: string;
  doanh_so: number;
  so_don: number;
  doanh_so_cu: number;
  so_don_cu: number;
}
export interface SanPhamKy {
  ten: string;
  doanh_so: number;
  so_lan: number;
  lan_cuoi: string | null;
  doanh_so_cu: number;
}
export interface NhipDatHang {
  tb_ngay: number;
  lan_cuoi: string;
  so_ngay_tu_lan_cuoi: number;
  nhanh_nhat: number;
  lau_nhat: number;
  so_don: number;
  du_kien: string;
}
export interface ThongKeKhach {
  tu: string;
  den: string;
  tu_cu: string;
  den_cu: string;
  buoc: BuocBieuDo;
  don: TongDon;
  don_cu: TongDon;
  bao_gia: TongBaoGia;
  bao_gia_cu: TongBaoGia;
  cot: CotBieuDo[];
  san_pham: SanPhamKy[];
  nhip: NhipDatHang | null;
  diem_don: { ngay: string; tong: number; huy: boolean }[];
  dang_cho: { so: number; tong: number; sap_het_han: number };
}
export interface DongDon {
  id: number;
  order_no: string;
  status: string;
  order_kind: string;
  tong: number | null;
  created_at: string;
  bao_gia_id: number | null;
  bao_gia_ma: string | null;
  san_pham: string[];
}
export interface TrangDon {
  items: DongDon[];
  tong_so: number;
  /** Số đơn theo nhóm chot / nhap / huy trong kỳ + ô tìm (số trên nút lọc). */
  dem: Record<string, number>;
  tien_chot: number;
  tien_huy: number;
  trang: number;
  co: number;
}
export type NhomBaoGia = "cho" | "thanh_don" | "tu_choi" | "het_han" | "chua_gui" | "huy";
export interface DongBaoGia {
  id: number;
  code: string;
  version: number;
  status: string;
  nhom: NhomBaoGia;
  total: number | null;
  valid_until: string | null;
  created_at: string;
  don_id: number | null;
  don_ma: string | null;
  don_ngay: string | null;
}
export interface TrangBaoGia {
  items: DongBaoGia[];
  tong_so: number;
  dem: Record<string, number>;
  trang: number;
  co: number;
}
export interface LocLichSu {
  q?: string;
  nhom?: string;
  sap_xep?: string;
  trang?: number;
  co?: number;
}

function _qsKy(ky: KyXem, them: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams({ tu: ky.tu, den: ky.den });
  for (const [k, v] of Object.entries(them)) {
    if (v !== undefined && v !== "") p.set(k, String(v));
  }
  return p.toString();
}

export interface CustomerAuditRow {
  at: string;
  kind: "profile" | "order" | "quote" | "care";
  action: string;
  title: string;
  detail: string;
  actor_name: string | null;
  ref_type: "order" | "quotation" | null;
  ref_id: number | null;
}

/** A customer carried across a cross-module navigation (CRM → Báo giá / Đơn hàng) so the
 *  target screen opens pre-pinned to the right customer — never an ID typed by hand. */
export interface PinnedCustomer {
  id: number;
  code: string;
  name: string;
  tax_code: string | null;
}

/** Points at an existing customer that already carries the submitted MST (soft warn). */
export interface DuplicateRef {
  id: number;
  code: string;
  name: string;
}

/** Cảnh báo trùng MỀM theo tiêu chí (#15): field ∈ tax_code | name | email. */
export interface DuplicateWarn {
  field: "tax_code" | "name" | "email";
  id: number;
  code: string;
  name: string;
}

export interface CustomerCreateOut {
  customer: CustomerRow;
  duplicate: DuplicateRef | null;
  duplicates: DuplicateWarn[];
}

// --- Người liên hệ / địa chỉ giao hàng / tài liệu (khảo sát #9–#11, #21) -----

export interface CustomerContact {
  id: number;
  name: string;
  title: string | null;
  duty: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
}

export interface CustomerContactInput {
  name: string;
  title: string | null;
  duty: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
}

export interface CustomerAddress {
  id: number;
  label: string;
  address: string;
  phone: string | null;
  note: string | null;
  is_default: boolean;
}

export interface CustomerAddressInput {
  label: string;
  address: string;
  phone: string | null;
  note: string | null;
  is_default: boolean;
}

export interface CustomerAttachment {
  id: number;
  doc_kind: string;
  file_name: string;
  file_url: string;
  file_type: string | null;
  uploaded_at: string;
}

// --- Chăm sóc khách hàng (#20/#27/#28) ---------------------------------------

export interface CareEvent {
  id: number;
  kind: string;
  note: string;
  happened_at: string;
  actor_name: string | null;
}

export interface CareTask {
  id: number;
  note: string;
  due_date: string;
  status: "open" | "done" | "cancelled";
  assignee_user_id: number | null;
  assignee_name: string | null;
  done_at: string | null;
  repeat_freq: string;        // none | day | week | month (lịch lặp)
  repeat_interval: number;    // mỗi N đơn vị
  repeat_until: string | null;
  series_id: number | null;
  ket_qua: string | null;
  /** Đang mở mà giờ hẹn đã qua. */
  tre: boolean;
}

export interface CareTasksOut {
  items: CareTask[];
  done_on_time: number;
  done_late: number;
  overdue_open: number;
}

/** 1 lần hẹn trên LỊCH (redesign-lich-hen-cham-soc); task_id=null ⇒ lần ẢO (tương lai chưa materialize). */
export interface CareOccurrence {
  task_id: number | null;
  series_id: number | null;   // id hẹn-đầu-chuỗi để thao tác
  note: string;
  due_date: string;
  status: "open" | "done" | "cancelled";
  is_virtual: boolean;
  repeat_freq: string;
  /** Đang mở mà giờ hẹn đã qua. */
  tre: boolean;
  /** Lần nào của chuỗi — gửi lại NGUYÊN VĂN khi thao tác (lần đã dời thì khác `due_date`). */
  occurrence_date: string | null;
  /** Ghi chú kết quả của lần hẹn. */
  ket_qua: string | null;
  assignee_user_id: number | null;
  assignee_name: string | null;
}

export interface CareCalendarOut {
  items: CareOccurrence[];
}

/** Một lần hẹn trên nút "Lịch hẹn" của danh bạ — như trên lịch một khách, kèm khách. */
export interface LichHenDong extends CareOccurrence {
  customer_id: number;
  customer_code: string;
  customer_name: string;
}

export interface LichHenOut {
  items: LichHenDong[];
  /** Trễ + hôm nay còn mở — số đỏ trên nút. */
  so: number;
  /** Người xem thấy hẹn của người khác không (hiện nút Của tôi / Cả nhóm). */
  co_nhom: boolean;
}

/** Một dòng KHÔNG ghi được. Còn một dòng lỗi thì CẢ FILE không ghi gì.
 *
 *  `dong` là số dòng THẬT trên sheet Excel (tính cả dòng tiêu đề) — người dùng đang nhìn file
 *  trong Excel, nói "dòng 7" thì họ bấm Ctrl+G tới đúng dòng 7. */
export interface NhapExcelLoi {
  dong: number;
  cot: string;
  ly_do: string;
}

/** Cảnh báo MỀM — VẪN ghi: trùng MST / tên / email (§34: không chặn), gỡ Sale phụ trách, đổi cùng
 *  lúc tên lẫn MST (nghi trỏ nhầm khách). */
export interface NhapExcelCanhBao {
  dong: number;
  ly_do: string;
}

/** Một ô sẽ đổi trên một khách ĐÃ CÓ (nhập lại file Xuất Excel, 17/09/2026). `cu`/`moi` đã là chữ
 *  người đọc (tên Sale, "Công ty", "5.000.000") — chuỗi rỗng là ô trống. */
export interface NhapExcelThayDoi {
  dong: number;
  ma: string;
  ten: string;
  cot: string;
  cu: string;
  moi: string;
}

/** Kết quả một lượt nhập Excel (#23; thay đường CSV cũ 11/09/2026).
 *
 *  `preview` và `commit` trả CÙNG hình dạng — khác đúng ở `da_ghi`. Xem trước chạy y hệt lượt ghi
 *  rồi rollback, nên con số ở đây là con số THẬT. Dòng có Mã KH là sửa (`cap_nhat`), không đổi gì
 *  thì không đụng tới (`khong_doi`). */
export interface NhapExcelOut {
  hop_le: boolean;
  tong_dong: number;
  tao_moi: number;
  cap_nhat: number;
  khong_doi: number;
  da_ghi: boolean;
  /** Có ô tài chính đã điền / đã sửa nhưng người nhập không có quyền ⇒ đã bỏ qua đúng mấy cột đó. */
  bo_qua_tai_chinh: boolean;
  loi: NhapExcelLoi[];
  canh_bao: NhapExcelCanhBao[];
  thay_doi: NhapExcelThayDoi[];
}

/** The read-only Công nợ card. available=false + message → "Chưa có phân hệ Công nợ". */
export interface ReceivableCard {
  available: boolean;
  credit_limit: number;
  balance: number | null;
  usage_pct: number | null;
  over_limit: boolean | null;
  message: string | null;
}

export interface CustomerDetailOut {
  customer: CustomerRow;
  receivable: ReceivableCard;
  /** Số trên nhãn tab lịch sử (mọi trạng thái, mọi thời gian). */
  so_don: number;
  so_bao_gia: number;
}

export interface SaleOption {
  id: number;
  name: string;
  /** Vai trò + phòng, để hộp chọn hiện 2 tầng: "Lê Sale Một" / "NV Sales · Kinh doanh". */
  vai_tro?: string | null;
  phong_ban?: string | null;
  /** `false` = KHÔNG đủ tư cách nhận khách mới (ngoài khối Kinh doanh / tài khoản đã khoá) nhưng
   *  vẫn đang giữ khách trong tầm nhìn ⇒ hộp LỌC hiện, ô GÁN ẩn. */
  co_the_gan?: boolean;
  /** Số khách người này đang phụ trách trong tầm nhìn của người xem. */
  so_kh?: number;
}

/** Form Thêm/Sửa — THÔNG TIN ĐỊNH DANH (redesign spec-06 v2). Không đụng tài chính. */
export interface CustomerInput {
  name: string;
  customer_kind: CustomerKind;
  tax_code: string | null;
  phone?: string | null;
  email: string | null;
  address: string | null;
  contact_name?: string | null;
  sale_user_id: number | null;
}

/** Chính sách tài chính — endpoint /financial (gate set_credit_terms). Ghi đầy đủ nhóm. */
export interface CustomerFinancialInput {
  credit_limit: number;
  /** Số ngày công nợ tối đa (net terms, kể từ ngày xuất HĐ). null = chưa đặt hạn ngày. */
  payment_term_days?: number | null;
  discount_min_pct?: number | null;
  discount_max_pct?: number | null;
  markup_min_pct?: number | null;
  markup_max_pct?: number | null;
  /** Kê giá (20/10/2026): % trên giá bán. */
  ke_min_pct?: number | null;
  ke_max_pct?: number | null;
  /** Thuế TNDN trên kê (%), mặc định 20. */
  ke_thue_tndn_pct?: number;
}

/** Một ghi chú tự do của team về khách (tab Ghi chú). */
export interface CustomerNote {
  id: number;
  body: string;
  pinned: boolean;
  created_at: string;
  updated_at?: string | null;
  /** Đã sửa nội dung (ghim không tính). */
  edited: boolean;
  author_name?: string | null;
}

export interface CustomerListParams {
  q?: string;
  sale?: number | null;
  /** Lọc "Chưa gán ai" — khách chưa có NV phụ trách. Đè lên `sale` khi bật. */
  chua_gan?: boolean;
  tag?: string | null;
  sort?: string;
  page?: number;
  size?: number;
  /** Thanh lọc chung: `tu_ngay`/`den_ngay`/`moc`, `loai`, `mua` (và `sale`/`chua_gan`/`tag`). */
  loc?: ThamSoLoc;
}

export interface EnumOption {
  value: string;
  label: string;
}

// Phiếu tính giá 4 nhóm — snake_case y hệt JSON trả về. (Nguồn cũ `estimate_to_phieu` đã xoá ở
// Đợt 5; hai type này giờ do engine đang chạy nuôi — xem PhieuTinhGiaDetailView.)
export interface PhieuTinhGiaColOut {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  // Engine mới trả "number"/"money"; giữ "num"/"formula" cho tương thích phiếu in.
  kind?: "text" | "num" | "formula" | "number" | "money";
}
export interface PhieuTinhGiaGroupOut {
  idx: string;
  name: string;
  columns: PhieuTinhGiaColOut[];
  rows: Array<Record<string, string | number | null>>;
  subtotal: number;
}
/** Số [Hiện] read-only của 1 thành phần (từ result.meta.components) — soi số cho người lập phiếu. */
export interface TinhGiaComponentMeta {
  idx: number;
  name: string;
  gia_von_tp: number;
  so_luong: number; // SL dùng cho sản phẩm này (0 = lấy SL mặc định phiếu)
  gia_von_don: number; // giá vốn / SL của sản phẩm này (đơn giá riêng)
  con: number; // ④ con/tờ engine chốt
  con_auto: boolean;
  so_manh_xa: number; // ① → ② số mảnh xả
  to_net: number; // tờ in NET
  to_gross: number; // tờ in GROSS (đã bù hao)
  to_nguyen: number; // tờ giấy nguyên
  so_kem: number;
  so_luot: number;
  to_dau_vao: number;
  to_sau_in: number;
  bu_hao_auto?: number; // Σ bù hao công đoạn — engine đi NGƯỢC từ cuối chuỗi lên
  loi_chuoi?: string[]; // chuỗi công đoạn đứt đơn vị — LỖI, máy chủ chặn lưu phiếu (#8)
  bu_hao_chi_tiet?: BuHaoBuoc[]; // phân rã: bước nào ăn bao nhiêu tờ (thứ tự xuôi)
  so_trang?: number; // số trang nội dung của 1 sản phẩm (người dùng khai)
  trang_moi_tay?: number; // số trang mỗi tay gấp
  so_to_per_sp?: number; // số bài in — DẪN XUẤT: so_trang / trang_moi_tay
  to_ra_cuoi?: number; // tờ ra khỏi bước cuối chuỗi
  so_tp_ra?: number; // thành phẩm thật sự có = to_ra_cuoi × con/tờ
  /** Σ phí khuôn của sản phẩm này — khoản MỘT LẦN, nhưng ĐÃ NẰM TRONG `gia_von_tp` (và do đó
   *  trong `gia_von_don`). Số này chỉ để BÀY RA cho người đọc biết trong giá vốn có bao nhiêu
   *  tiền dao — ĐỪNG cộng nó vào tổng lần nữa. */
  phi_khuon?: number;
  /** Phân rã theo bước: bước nào con dao nào bao nhiêu tiền. */
  phi_khuon_dong?: { ten: string; loai: string | null; thanh_tien: number }[];
  /** Phí giao hàng của sản phẩm này — khoản MỘT LẦN cho cả sản lượng. CŨNG đã nằm trong
   *  `gia_von_tp` (một dòng của nhóm kết quả `giao_hang`), nên ĐỪNG cộng lại lần nữa. */
  phi_giao_hang?: number;
  /** Σ chi phí khác của sản phẩm này — cũng ĐÃ nằm trong `gia_von_tp`, đừng cộng lại. */
  chi_phi_khac?: number;
  /** Phân rã từng khoản lẻ: tên người dùng gõ + số tiền. */
  chi_phi_khac_dong?: { ten: string; thanh_tien: number }[];
  bu_hao_tay?: number; // ô "+ Bù thêm" đã bỏ → engine luôn trả 0
  hao_tay?: number; // ô "− Hao" đã bỏ → engine luôn trả 0
}
/** 1 bước trong chuỗi ngược: số tờ vào — ra — hao của chính bước đó. */
export interface BuHaoBuoc {
  /** KHÓA ghép với dòng tiền `groups.cong_doan[].buoc_idx` — cùng là chỉ số bước trong chuỗi.
   *  Optional vì backend đời cũ (chưa restart) không gửi; thiếu thì panel chỉ mất phần tiền. */
  buoc_idx?: number;
  ten: string;
  nhom?: string | null; // prepress|print|finishing — UI neo "Tờ sau in" vào bước in
  dv_vao?: LsxDonVi | null; // đơn vị VÀO / RA của bước — khác nhau = bước đổi đơn vị
  dv_ra?: LsxDonVi | null;
  vao: number;
  ra: number;
  ra_quy?: number; // `ra` quy về ĐƠN VỊ VÀO — ra_quy + hao = vao
  he_so?: number; // hệ số quy đổi đã dùng (1 nếu bước không đổi đơn vị)
  hao: number; // đo bằng ĐƠN VỊ VÀO
}
/** Meta cấp phiếu — tổng hợp nhiều sản phẩm. */
export interface TinhGiaMeta {
  so_luong?: number; // SL mặc định phiếu
  tong_so_luong?: number; // Σ SL các SẢN PHẨM (ruột + bìa cùng nhóm báo giá tính một lần)
  so_thanh_phan?: number; // số thành phần (ruột, bìa tính riêng)
  so_san_pham?: number; // số SẢN PHẨM khách mua — cụm báo giá (cùng nhãn nhóm và cùng SL = 1)
  gia_von_don?: number; // đơn giá BÌNH QUÂN (Σ giá vốn / Σ SL sản phẩm)
  components?: TinhGiaComponentMeta[];
}
export interface TinhGiaPreviewOut {
  meta?: TinhGiaMeta;
  groups: PhieuTinhGiaGroupOut[];
  grand_total: number;
  warnings: string[];
}

/** Bình bài live (POST /api/tinh-gia/binh-bai) — mm; chua_mm = chừa gộp (cm) × 10. */
export interface BinhBaiIn {
  kho_in_dai: number;
  kho_in_rong: number;
  dai_thanh_pham: number;
  rong_thanh_pham: number;
  /** Chừa GỘP — trừ đều mỗi chiều. Dùng khi KHÔNG tách chiều (đường cũ). */
  chua_mm?: number;
  /** Chừa TÁCH CHIỀU (ưu tiên hơn `chua_mm`): dài ← nhíp giấy + đuôi; rộng ← lề hông ×2. */
  chua_dai_mm?: number;
  chua_rong_mm?: number;
  /** Hoặc gửi CHỪA THÔ — server tự tách chiều (`chua_theo_chieu`): `chua_nhip` là ô đè của phiếu,
   *  ba cái sau là thông số danh mục MÁY. Nơi gọi đừng tự cộng: cộng tay ở màn thứ hai chính là
   *  chỗ đẻ ra sơ đồ 105 con trong khi phiếu ra 99. */
  chua_nhip?: number;
  nhip_giay_mm?: number;
  le_hong_mm?: number;
  duoi_thang_mau_mm?: number;
  bleed_mm?: number;
  khe_cat_mm?: number;
}
export interface BinhBaiOut {
  con: number;
  cols: number;
  rows: number;
  rotated: boolean;
  usable_dai: number;
  usable_rong: number;
  /** Chừa engine ĐÃ trừ, theo từng chiều — FE vẽ sơ đồ theo số này, đừng tự tính lại. */
  chua_dai: number;
  chua_rong: number;
  /** Kích thước 1 con ĐÃ cộng bleed (= thành phẩm + 2×bleed). */
  piece_dai: number;
  piece_rong: number;
  kho_in_dai: number;
  kho_in_rong: number;
  dai_tp: number;
  rong_tp: number;
  hieu_suat: number;
}

// --- Phiếu tính giá (PERSISTED costing tickets) — master/detail của "Tính giá" ---
// Mô hình MỚI theo THÀNH PHẦN: 1 phiếu = nhiều "Thành phần" (mỗi cái = giấy + kỹ thuật in +
// màu + gia công sau in). List item 2 tầng (sản phẩm + số thành phần); detail lồng nested.
export interface PhieuTinhGiaListItem {
  id: number;
  ma: string;
  ten_san_pham: string;
  kho_thanh_pham: string | null;
  /** Σ SL CÁC SẢN PHẨM bên trong phiếu (BE tính lại) — không phải ô SL mặc định ở đầu phiếu.
   *  Đây là số mà `gia_von_don` đang chia, nên SL × giá vốn/đơn = tổng giá vốn. */
  so_luong: number;
  gia_von_don: number;
  tong_gia_von: number;
  ktv: string | null;
  so_thanh_phan: number;
  /** Tên các sản phẩm BÊN TRONG phiếu, đúng thứ tự khai. Cột "Sản phẩm" rơi về đây khi ô tên ở
   *  đầu phiếu bỏ trống (ô đó là chữ tự do, không ai bắt buộc gõ). */
  ten_thanh_phans: string[];
  ngay: string | null;
  /** Ghi chú nội bộ của phiếu — cột "Ghi chú" ngoài danh sách. */
  ghi_chu: string | null;
  customer_id: number | null;
  customer_name: string | null;
  /** Báo giá lập từ phiếu (một phiếu một báo giá). */
  bao_gia_id?: number | null;
  bao_gia_ma?: string | null;
}
export interface PhieuTinhGiaListOut {
  items: PhieuTinhGiaListItem[];
  total: number;
  /** Σ tổng giá vốn của mọi dòng khớp bộ lọc — dòng "Cộng" cuối bảng. */
  tong_gia_von?: number;
}
/** Đếm cho thanh tab — độc lập trang/tìm kiếm hiện tại. */
export interface PhieuTinhGiaStatsOut {
  all: number;
  draft: number;
  /** Có sản phẩm mà chưa ra giá (tổng giá vốn 0). */
  dang_tinh?: number;
  calculated: number;
}

/** Tham số lọc thêm của ba danh sách Kinh doanh (dải kỳ + bảng "Bộ lọc nâng cao"): khoá rỗng bỏ,
 *  mảng thành nhiều khoá cùng tên (`duyet=cho&duyet=duyet`). */
export type ThamSoLoc = Record<string, string | number | boolean | string[] | null | undefined>;

/** Vai người trên đơn mua: NV yêu cầu | NV mua hàng (người lập) | NV duyệt. */
export type VaiNguoiDon = "yc" | "mua" | "duyet";

/** Một lựa chọn trong ô lọc (khách hàng, người duyệt…) — máy chủ chỉ trả cái đang có trong tầm nhìn. */
export interface LuaChonLoc {
  id: number;
  ten: string;
  so: number;
}

function ganThamSoLoc(qs: URLSearchParams, loc?: ThamSoLoc): void {
  if (!loc) return;
  for (const [k, v] of Object.entries(loc)) {
    if (v == null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else qs.set(k, String(v));
  }
}

/** 1 dòng gia công sau in (finishing) thuộc 1 thành phần. */
export interface ThanhPhamOut {
  id: number;
  thanh_phan_id: number;
  thu_tu: number;
  cong_doan_id: number | null;
  ten: string;
  don_gia: number;
  so_luong: number;
  bu_hao: boolean;
  so_mat: number;
  so_vi_tri: number;
  dien_tich: number;
  nha_cung_cap: string | null;
  ghi_chu: string | null;
  /** Phí làm khuôn của CHÍNH bước này — khoản MỘT LẦN (không nhân SL), nhưng engine CÓ cộng vào
   *  `gia_von_tp`, nên khi chia ra đ/sản phẩm thì đơn nhỏ gánh nặng hơn đơn lớn. Đó là đánh đổi đã
   *  chọn 15/08/2026 để báo giá chỉ còn MỘT dòng — đừng "sửa" bằng cách rút nó ra khỏi giá vốn.
   *  0 = dùng lại dao cũ. Chỉ có nghĩa ở bước mà công đoạn nguồn cần khuôn bế. */
  phi_khuon: number;
  /** Khuôn có sẵn hay làm mới — sale trả lời ở phiếu tính giá (chốt 04/09/2026). `null` = chưa
   *  chọn (phiếu cũ), engine giữ nguyên lời nhắc. Kế hoạch đọc lại để biết ý định của sale. */
  khuon_nguon: "co_san" | "lam_moi" | null;
  /** Vật tư của BƯỚC này (01/10/2026) — số đã nhập cho chip riêng của từng vật tư. */
  vat_tus: BuocVatTuOut[];
}

/** 1 vật tư gắn vào 1 bước của phiếu — `gia_tri_chip` khoá theo mã chip của vật tư. */
/** `giay` = giấy chọn ở bước (18/10/2026, id trỏ danh mục Giấy) — cùng ô "Thêm vật tư"; vắng = `vat_tu`. */
export type HangLoaiBuoc = "vat_tu" | "giay";
export interface BuocVatTuOut {
  id: number;
  thu_tu: number;
  hang_loai?: HangLoaiBuoc;
  vat_tu_id: number;
  gia_tri_chip: Record<string, number>;
}
export interface BuocVatTuIn {
  hang_loai?: HangLoaiBuoc;
  vat_tu_id: number;
  thu_tu?: number;
  gia_tri_chip?: Record<string, number>;
}

/** 1 thành phần giấy (paper component): giấy + kỹ thuật in + màu + list gia công. */
export interface ThanhPhanOut {
  id: number;
  phieu_id: number;
  thu_tu: number;
  loai_thanh_phan: string;
  ten: string;
  dai_thanh_pham: number; // ③ khổ thành phẩm (mm)
  rong_thanh_pham: number; // ③
  /** Nhãn gộp dòng khi báo giá (ruột + bìa 1 cuốn gõ giống nhau). Không vào công thức giá. */
  nhom_bao_gia: string | null;
  /** ĐVT của CẢ NHÓM gộp khi in cho khách (chọn từ danh mục Đơn vị & quy đổi, lưu TÊN).
   *  null = dòng gộp lấy ĐVT của dòng đầu nhóm như trước. */
  dvt_nhom: string | null;
  so_to_per_sp: number; // DẪN XUẤT (server ghi) = so_trang / trang_moi_tay
  so_trang: number; // số trang nội dung của 1 sản phẩm (tờ rời = 1)
  trang_moi_tay: number; // số trang mỗi tay gấp (tờ rời = 1)
  so_luong: number; // SL đặt của sản phẩm này (0 = lấy SL mặc định phiếu)
  don_vi_tinh: string; // ĐVT sản phẩm (text tự do, mặc định "cái") → chảy sang Báo giá
  // Giấy in
  giay_id: number | null;
  kho_nguyen: string | null; // ① nhãn hiển thị
  kho_nguyen_dai: number; // ① khổ giấy nguyên dài (mm) — đè danh mục khi > 0
  kho_nguyen_rong: number; // ①
  don_gia_giay: number;
  don_gia_don_vi: string; // "to" | "tan"
  nguon_giay: string; // "cong_ty" | "khach"
  /** Đè nhíp giấy của MÁY (0 = theo danh mục máy). Lề hông · đuôi · xén · cả gáy đã bỏ khỏi
   *  phiếu — chừa tờ in khai một lần ở danh mục Máy. */
  chua_nhip: number;
  /** Tràn lề MỖI CẠNH con (0 = không tràn lề) — con để bình = thành phẩm + 2×bleed. */
  bleed_mm: number;
  /** Khe giữa 2 con kề nhau (0 = bình sát, cắt chung nhát). n con chỉ có n−1 khe. */
  khe_cat_mm: number;
  // Kỹ thuật in
  co_in: boolean;
  che_ban_loai: string | null;
  che_ban_don_gia: number;
  quy_cach_in: string; // "mot_mat" | "hai_mat" | "tu_tro"
  kho_in_dai: number; // ② khổ tờ in (mm)
  kho_in_rong: number; // ②
  so_con: number; // ④ con/tờ (override khi con_auto=false)
  con_auto: boolean; // true: engine tự bình bài
  may_id: number | null;
  don_gia_cong_in: number; // mực GỘP trong đây
  /** TẬP mã mực mỗi mặt — nguồn sự thật của số kẽm. `C`/`M`/`Y`/`K` là process, mã khác là pha.
   *  Phải là tập chứ không phải số: tự trở/trở nhíp chung một bộ bản nên kẽm = `|A ∪ B|`. */
  muc_a: string[];
  muc_b: string[];
  /** DẪN XUẤT của hai tập trên, server chốt: process mỗi mặt + số mực pha phân biệt cả hai mặt. */
  so_mau_a: number;
  so_mau_b: number;
  so_mau_pha: number;
  ghi_chu_ky_thuat: string | null; // note KỸ THUẬT/SX theo sản phẩm → drawer lệnh
  phi_giao_hang: number; // ⑤ phí giao hàng — khoản MỘT LẦN, ĐÃ nằm trong `gia_von_tp`
  gia_von_tp: number;
  thanh_phams: ThanhPhamOut[];
  /** ⑥ Chi phí khác — các khoản lẻ tự khai (làm kẽm ngoài, phí thiết kế…). Mỗi dòng MỘT LẦN cho
   *  cả sản lượng, ĐÃ nằm trong `gia_von_tp`. */
  chi_phi_khacs: ChiPhiKhacOut[];
  /** Sản phẩm tái bản đang gắn (mã thành phẩm của khách). Null = sản phẩm mới. */
  tai_ban_thanh_pham_id?: number | null;
  tai_ban_thanh_pham?: TaiBanNhan | null;
}

/** 1 dòng chi phí khác — cặp (tên tự gõ, số tiền). Không trỏ danh mục, không công thức. */
export interface ChiPhiKhacOut {
  id: number;
  thanh_phan_id: number;
  thu_tu: number;
  ten: string;
  so_tien: number;
}

/** Detail đầy đủ 1 phiếu — `result` tái dùng TinhGiaPreviewOut (engine dict 4 nhóm). */
export interface PhieuTinhGiaOut {
  id: number;
  ma: string;
  ten_san_pham: string;
  kho_thanh_pham: string | null;
  so_luong: number;
  tong_gia_von: number;
  gia_von_don: number;
  result: TinhGiaPreviewOut | null;
  warnings: string[] | null;
  /** CHỈ có ở bản RÚT GỌN (vai thiếu `tinh_gia_thanh:view_cost`): tên + tổng tiền từng rổ, không
   *  kèm dòng nào. Vai đủ quyền đọc ba rổ từ `result.groups` nên BE không trả field này. */
  nhom_tong?: { ten: string; tong: number }[];
  ktv: string | null;
  ghi_chu: string | null;
  /** Khách hàng chọn Ở PHIẾU (04/10/2026) — báo giá chép sang, không sửa được ở báo giá. */
  customer_id: number | null;
  /** Tên khách (BE tra từ danh mục Khách hàng, không lưu ở phiếu). */
  customer_name: string | null;
  /** MST + nhãn điểm giao khớp `delivery_address` — cho dải khách, khỏi gọi thêm API khách. */
  customer_tax_code?: string | null;
  delivery_label?: string | null;
  delivery_address: string | null;
  contact_name_snapshot: string | null;
  contact_phone_snapshot: string | null;
  contact_title_snapshot: string | null;
  contact_email_snapshot: string | null;
  thanh_phans: ThanhPhanOut[];
  created_at: string | null;
  updated_at: string | null;
  /** Danh mục (công đoạn · giấy · máy · vật tư · bù hao) mà phiếu đang dùng đã lệch SAU lần tính
   *  gần nhất. null = phiếu còn khớp danh mục. Chỉ để NHẮC — số trong phiếu vẫn là ảnh chụp cũ
   *  cho tới khi người lập bấm "Tính giá". Ba rổ tách riêng: `ten` đổi cấu hình · `ngung` bị
   *  ngừng dùng (không chọn lại được) · `xoa` đã xoá hẳn khỏi danh mục (phải thay bước). */
  danh_muc_doi: { luc: string; ten: string[]; ngung?: string[]; xoa?: string[] } | null;
}

/** 1 dòng nhật ký hoạt động của phiếu tính giá — ai làm gì · khi nào. */
export interface PtgActivity {
  action: string;
  actor_name: string | null;
  detail: string;
  at: string;
}

/** Input 1 dòng gia công — tất cả optional (BE tự đổ mặc định). */
export interface ThanhPhamIn {
  cong_doan_id?: number | null;
  ten?: string;
  don_gia?: number;
  so_luong?: number;
  bu_hao?: boolean;
  so_mat?: number;
  so_vi_tri?: number;
  dien_tich?: number;
  nha_cung_cap?: string | null;
  ghi_chu?: string | null;
  phi_khuon?: number;
  khuon_nguon?: "co_san" | "lam_moi" | null;
  vat_tus?: BuocVatTuIn[];
}
/** Input 1 thành phần — mọi field optional + list gia công. */
export interface ThanhPhanIn {
  loai_thanh_phan?: string;
  ten?: string;
  dai_thanh_pham?: number;
  rong_thanh_pham?: number;
  nhom_bao_gia?: string | null;
  dvt_nhom?: string | null; // ĐVT của cả nhóm gộp (null = lấy ĐVT dòng đầu nhóm)
  so_trang?: number; // số trang nội dung (số bài in do server dẫn xuất, không gửi)
  trang_moi_tay?: number;
  so_luong?: number; // SL đặt của sản phẩm này (0 = SL mặc định phiếu)
  don_vi_tinh?: string | null; // ĐVT sản phẩm (text tự do)
  giay_id?: number | null;
  kho_nguyen?: string | null;
  kho_nguyen_dai?: number;
  kho_nguyen_rong?: number;
  don_gia_giay?: number;
  don_gia_don_vi?: string;
  nguon_giay?: string;
  chua_nhip?: number;
  bleed_mm?: number;
  khe_cat_mm?: number;
  co_in?: boolean;
  che_ban_loai?: string | null;
  che_ban_don_gia?: number;
  quy_cach_in?: string;
  kho_in_dai?: number;
  kho_in_rong?: number;
  so_con?: number;
  con_auto?: boolean;
  may_id?: number | null;
  don_gia_cong_in?: number;
  muc_a?: string[];
  muc_b?: string[];
  // Ba số này server tính lại từ tập mực rồi ghi đè — gửi lên chỉ để phiếu cũ chưa khai mực
  // không mất số. Đừng dựa vào chúng để tính gì ở client.
  so_mau_a?: number;
  so_mau_b?: number;
  so_mau_pha?: number;
  ghi_chu_ky_thuat?: string | null; // note KỸ THUẬT/SX theo sản phẩm → drawer lệnh
  /** ⑤ Phí giao hàng: TỔNG tiền chở cho toàn bộ sản lượng của sản phẩm này — khoản MỘT LẦN,
   *  cộng thẳng vào giá vốn (⇒ chịu markup ở Báo giá). 0 = không thu. */
  phi_giao_hang?: number;
  thanh_phams?: ThanhPhamIn[];
  /** ⑥ Chi phí khác: khoản lẻ MỘT LẦN (làm kẽm ngoài, phí thiết kế…) — cộng thẳng vào giá vốn
   *  như `phi_giao_hang`. Dòng 0đ vẫn lưu (để gõ tiếp) nhưng server không đẻ dòng tiền. */
  chi_phi_khacs?: ChiPhiKhacIn[];
  /** Mã thành phẩm của khách đang gắn tái bản — chốt đơn sẽ dùng lại đúng mã này. */
  tai_ban_thanh_pham_id?: number | null;
}
/** Input 1 dòng chi phí khác — tên gõ tay + số tiền, cả hai optional. */
export interface ChiPhiKhacIn {
  ten?: string;
  so_tien?: number;
}
/** 1 thành phẩm CỦA KHÁCH để chọn tái bản. `so_thanh_phan = 0` = mã chưa từng chốt qua phiếu
 *  tính giá: chọn được, chỉ gắn mã, không có cấu hình để nạp. */
export interface SanPhamTaiBanGoiY {
  id: number;
  ma: string;
  ten: string;
  don_vi: string | null;
  so_thanh_phan: number;
  tai_ban_luc: string | null;
}
/** Mã tái bản + cấu hình từng thành phần (ruột + bìa…) để nạp vào phiếu. */
export interface SanPhamTaiBanChiTiet {
  id: number;
  ma: string;
  ten: string;
  thanh_phans: ThanhPhanIn[];
}
/** Nhãn mã tái bản đang gắn trên thẻ phiếu. */
export interface TaiBanNhan {
  id: number;
  ma: string;
  ten: string;
}
/** Field khởi tạo phiếu (tất cả optional — BE auto `ma`). */
export interface PhieuTinhGiaCreate {
  ten_san_pham?: string;
  kho_thanh_pham?: string | null;
  so_luong?: number;
  ghi_chu?: string | null;
  /** Chỉ POST nhận (phiếu chưa lưu đã chọn khách); phiếu đã lưu đổi khách qua `khachHang`. */
  customer_id?: number | null;
  delivery_address?: string | null;
  contact_name_snapshot?: string | null;
  contact_phone_snapshot?: string | null;
  contact_title_snapshot?: string | null;
  contact_email_snapshot?: string | null;
  thanh_phans?: ThanhPhanIn[];
}
/** PUT: REPLACE-ALL con — BE tự tính lại + snapshot. */
export type PhieuTinhGiaUpdate = PhieuTinhGiaCreate;
/** PATCH khách / điểm giao / người nhận / ghi chú — chỉ ô gửi lên mới đổi. Đổi `customer_id` mà
 *  không gửi kèm điểm giao/người nhận thì BE điền điểm giao mặc định + liên hệ chính. */
export interface PhieuTinhGiaKhachHangPatch {
  customer_id?: number | null;
  delivery_address?: string | null;
  contact_name_snapshot?: string | null;
  contact_phone_snapshot?: string | null;
  contact_title_snapshot?: string | null;
  contact_email_snapshot?: string | null;
  ghi_chu?: string | null;
}

// --- Báo giá (Quotation), spec-09 --------------------------------------------

export interface QuotationRow {
  id: number;
  code: string;
  version: number;
  customer_id: number | null;
  customer_name: string | null;
  total: number | null;
  status: string;
  valid_until: string | null;
  // Field hiển thị 2 tầng (đều có default phía backend)
  version_count?: number;
  sent_at?: string | null;
  margin_percent?: number | null;
  product_summary?: string | null;
  updated_at?: string | null;
  salesperson_name?: string | null;
  created_at?: string | null;
  /** Cột "Người duyệt": `cho` (nguoi = ai có thể duyệt, luc = lúc trình), `da_duyet` / `tu_choi`
   *  (nguoi = người quyết, luc = lúc quyết), `khong_can` (báo giá thường). null = để trống. */
  duyet?: {
    trang_thai: "cho" | "da_duyet" | "tu_choi" | "khong_can";
    nguoi: string[];
    luc: string | null;
    y_kien: string | null;
  } | null;
  /** Lưới danh sách: tên sản phẩm đầu + số sản phẩm khác (thẻ "+N"). */
  san_pham?: string | null;
  so_sp_khac?: number;
  /** Số lượng + đơn vị của dòng đầu. */
  so_luong?: number | null;
  don_vi?: string | null;
  /** Đơn hàng đã lên từ báo giá. */
  don_hang_id?: number | null;
  don_hang_ma?: string | null;
  don_hang_trang_thai?: string | null;
}

export interface QuotationListOut {
  items: QuotationRow[];
  total: number;
  /** Σ giá bán gồm VAT của mọi dòng khớp bộ lọc — dòng "Cộng" cuối bảng. */
  tong_gia_ban?: number;
  page: number;
  size: number;
}

export interface QuotationStats {
  total: number;
  draft: number;
  pending_approval: number;
  approved: number;
  sent: number;
  accepted: number;
  rejected: number;
  expired: number;
  converted_to_order: number;
  cancelled: number;
  need_action: number;
}

/** 1 dòng nhật ký tương tác của báo giá (feed Hoạt động) — ai làm gì, khi nào. */
export interface QuotationActivity {
  action: string;
  actor_name: string | null;
  detail: string;
  at: string;
}

export interface CustomerDisplay {
  customer_id: number;
  name: string;
  tax_code: string | null;
  credit_status_display: string;
}

export interface VersionRow {
  id: number;
  version: number;
  status: string;
  total: number | null;
  total_cost?: number | null;   // giá vốn khóa (so sánh phiên bản)
  subtotal?: number | null;     // giá bán chưa VAT
  discount?: number | null;     // chiết khấu
  created_at: string;
  change_reason?: string | null;
}

export interface QuoteItemDetail {
  id: number;
  line_no: number;
  product_type: string;
  product_name: string;
  product_spec_text: string | null;
  /** Diễn giải quy cách in dưới tên SP — mỗi dòng = 1 gạch đầu dòng. Bung từ tính giá, sửa được. */
  dien_giai: string | null;
  /** Nhãn nhóm gộp KHI IN: các dòng cùng nhãn (ruột + bìa 1 cuốn) in ra khách thành 1 dòng. */
  nhom: string | null;
  /** Ảnh minh họa in ở cột "Hình ảnh minh họa" của bản gửi khách. Thuộc CẢ CỤM cùng tên: mọi
   *  dòng trong cụm mang cùng URL, đặt/xóa ở dòng nào cũng ghi cho cả cụm. null = chưa có ảnh. */
  anh_minh_hoa: string | null;
  quantity: number;
  /** ĐVT THẬT của phần này ("cái" cho tấm bìa) — thứ mọi màn không gộp hiển thị. */
  unit: string;
  /** ĐVT của CỤM khi bản in gộp ruột + bìa thành 1 dòng ("cuốn"). null = không gộp / cụm chưa
   *  chọn đơn vị riêng ⇒ dòng gộp lấy ĐVT của dòng đầu cụm như cũ. */
  dvt_nhom: string | null;
  total_cost_snapshot: number;
  margin_percent: number;
  selling_price: number;
  /** Giá bán sale GÕ TAY (không theo markup) — giữ trạng thái "Gõ tay" sau khi tải lại. */
  gia_go_tay: boolean;
  unit_price: number;
  discount_amount: number;
  /** Kê giá (20/10/2026): cộng SAU giá bán; `gia_sau_ke = selling_price + ke_gia`, VAT tính trên số này. */
  ke_gia: number;
  gia_sau_ke: number;
  vat_percent: number;
  vat_amount: number;
  final_amount: number;
  note: string | null;
  /** Khách chốt một phần: true = khách ưng (kéo lên đơn), false = không lấy. Chỉ có nghĩa khi báo giá đã accepted. */
  accepted: boolean;
}

/** Kết quả đặt ảnh minh họa: URL vừa gắn + các dòng đã nhận nó (cả cụm cùng tên). */
export interface QuoteItemImage {
  anh_minh_hoa: string;
  item_ids: number[];
}

/** Tài liệu đính kèm NỘI BỘ của báo giá (file khách gửi / mẫu thiết kế / ảnh tham khảo). */
export interface QuoteAttachment {
  id: number;
  file_name: string;
  file_url: string;
  file_type: string | null;
  uploaded_at: string;
}

export interface QuotationDetail {
  id: number;
  code: string;
  version: number;
  customer_id: number | null;
  customer: CustomerDisplay | null;
  phieu_tinh_gia_id: number | null;
  phieu_tinh_gia_ma: string | null;
  /** Phiếu nguồn đã đổi SL / giá vốn / sản phẩm so với phiên bản đang xem. */
  phieu_doi?: boolean;
  valid_until: string | null;
  status: string;
  cancel_reason: string | null;
  /** Điều khoản in ra phiếu — mỗi dòng = 1 điều khoản (bản in tự đánh số). */
  terms_text: string | null;
  /** ĐC giao + người nhận: Sale chọn tay ở báo giá (dropdown danh bạ/điểm giao của khách); đơn
   *  hàng KẾ THỪA nguyên các giá trị này khi chốt đơn, không sửa lại được. */
  delivery_address: string | null;
  contact_name_snapshot: string | null;
  contact_phone_snapshot: string | null;
  contact_title_snapshot: string | null;
  contact_email_snapshot: string | null;
  customer_note: string | null;
  internal_note: string | null;
  
  // Financial snapshot totals
  total_cost: number;
  subtotal_amount: number;
  discount_amount: number;
  /** Σ kê — `subtotal_amount` đã gồm. */
  ke_gia_amount: number;
  vat_amount: number;
  total: number;
  
  allowed_transitions: string[];
  versions: VersionRow[];
  items: QuoteItemDetail[];
  // BG-2 — báo giá đặc thù (GĐ duyệt trước khi gửi khách). `markup_pct` = lợi nhuận / GIÁ VỐN —
  // ĐÚNG con số ô "Markup %" trong bảng dòng, không phải biên trên giá bán.
  exception_required: boolean;
  exception_status: "none" | "pending" | "approved" | "rejected" | "stale";
  exception_cleared: boolean;
  exceptions: { key: string; label: string }[];
  exception_note: string | null;
  markup_pct: number | null;
  // Ai SOẠN (người duyệt biết báo giá của NV nào) + ai ĐÃ DUYỆT/từ chối (NV biết ai xử lý).
  salesperson_id?: number | null;
  salesperson_name?: string | null;
  exception_decision?: "approved" | "rejected" | null;
  exception_decided_by_name?: string | null;
  exception_decided_at?: string | null;
  // Đơn hàng bán đã lập từ báo giá này (đơn hủy không tính) → FE ẩn "Tạo đơn", hiện "Xem đơn hàng".
  order_id?: number | null;
  order_no?: string | null;
}

export interface QuotationInput {
  customer_id: number | null;
  /** BG-1: 1 Phiếu tính giá (PTG) → 1 báo giá. Nguồn DUY NHẤT (đường Estimate đã gỡ ở Đợt 5). */
  phieu_tinh_gia_id?: number | null;
  /** Gói biên áp chung khi tạo (per dòng chỉnh sau). */
  margin_percent?: number | null;
  valid_until: string | null;
  /** Điều khoản in ra phiếu (mỗi dòng = 1 điều khoản); bỏ trống → backend điền bộ mặc định. */
  terms_text?: string | null;
  // Ghi chú đối ngoại/nội bộ đã BỎ khỏi UI — optional để tương thích payload cũ.
  customer_note?: string | null;
  internal_note?: string | null;
}

export interface QuoteItemUpdateInput {
  id: number;
  margin_percent: number;
  manual_selling_price?: number | null;
  manual_unit_price?: number | null;
  discount_amount?: number;
  /** Chiết khấu % trên GIÁ VỐN (số tiền `discount_amount` > 0 thì thắng). Chiết khấu CỘNG vào giá bán. */
  discount_percent?: number;
  /** Lợi nhuận gõ thẳng bằng số tiền (thắng `margin_percent`, = % trên vốn + chiết khấu). */
  profit_amount?: number | null;
  vat_percent?: number;
  rounding?: string;
  note?: string | null;
  /** Diễn giải quy cách in dưới tên SP. BE dump đủ field → không gửi = XOÁ; luôn echo giá trị cũ. */
  dien_giai?: string | null;
  /** Kê: số tiền hoặc % trên giá bán. Không gửi cả hai = máy chủ giữ số tiền kê đang có. */
  ke_gia?: number;
  ke_percent?: number;
}

export interface QuotationUpdateInput {
  valid_until: string | null;
  /** Điều khoản in ra phiếu (mỗi dòng = 1 điều khoản); bỏ trống → backend điền bộ mặc định. */
  terms_text?: string | null;
  customer_note?: string | null;
  // Khách / điểm giao / người nhận / ghi chú nội bộ KẾ THỪA từ phiếu tính giá (04/10/2026) — không
  // gửi ở đây; máy chủ trả 422 nếu gửi khác giá trị đang có. Sửa ở phiếu: `phieuTinhGia.khachHang`.
  items: QuoteItemUpdateInput[] | null;
}

export interface QuotationEnumsOut {
  statuses: EnumOption[];
}

export interface QuotationListParams {
  q?: string;
  status?: string | null;
  sort?: string;
  page?: number;
  size?: number;
  /** Hộp lọc NV phụ trách — id người; máy chủ AND với phạm vi. */
  nguoi?: number | null;
  /** Dải kỳ + bộ lọc nâng cao. */
  loc?: ThamSoLoc;
}

// --- Nhân sự · Hồ sơ nhân sự (nhan_su), lát #1 -----------------------------

/** `probation_ended` = đã qua Ngày hết thử việc, CHỜ HCNS bấm "Chuyển chính thức" (máy tự đặt).
 *  Vẫn ăn lương thử việc cho tới lúc bấm — chỉ trạng thái đổi, tiền không đổi. */
export type EmployeeStatus =
  | "probation" | "probation_ended" | "active" | "on_leave" | "suspended" | "resigned";

/** Cách tính thuế TNCN của MỘT người (chốt chủ 27/07/2026 — `employees.pit_mode`).
 *  Ba trạng thái nên dùng chuỗi, không nhồi 2 cờ Boolean (nhồi là mở chỗ để lệch). */
export type PitMode = "luy_tien" | "khau_tru_10" | "cam_ket_08";
/** Nhãn + giải thích ngắn cho dropdown "Cách tính thuế TNCN". `warn` = câu cảnh báo hiện
 *  trong ConfirmDialog TRƯỚC khi lưu (đổi nhánh là đổi TIỀN THUẾ của người đó). */
export const PIT_MODE_META: Record<PitMode, { label: string; hint: string }> = {
  luy_tien: {
    label: "Luỹ tiến từng phần",
    hint: "HĐ từ 3 tháng trở lên: tính theo bảng thuế luỹ tiến + giảm trừ gia cảnh.",
  },
  khau_tru_10: {
    label: "Khấu trừ 10% tại nguồn",
    hint: "HĐ dưới 3 tháng / thời vụ / thực tập: KHÔNG áp giảm trừ gia cảnh.",
  },
  cam_ket_08: {
    label: "Có cam kết 08/CK-TNCN",
    hint: "Cả năm chưa tới ngưỡng chịu thuế ⇒ không khấu trừ thuế TNCN.",
  },
};
export const PIT_MODE_ORDER: PitMode[] = ["luy_tien", "khau_tru_10", "cam_ket_08"];

export interface EmployeeRow {
  id: number;
  code: string;
  full_name: string;
  department_id: number | null;
  department_name: string | null;
  position: string | null;
  status: string;
  hire_date: string | null;
  probation_end_date: string | null;
  user_id: number | null;
  account_username: string | null;
  role_name: string | null;
  photo_url: string | null;
  default_shift_id: number | null;
  created_at: string | null;
}

export interface EmployeeShiftAssignment {
  id: number;
  employee_id: number;
  shift_id: number | null;
  effective_from: string;
  effective_to: string | null;
  is_current: boolean;
  created_at: string;
}

export interface EmployeeDetail extends EmployeeRow {
  date_of_birth: string | null;
  gender: string | null;
  national_id: string | null;
  national_id_date: string | null;
  national_id_place: string | null;
  phone: string | null;
  email: string | null;
  permanent_address: string | null;
  current_address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  social_insurance_no: string | null;
  pit_tax_code: string | null;
  dependents_count: number;
  /** Cách tính thuế TNCN. `null` = người xem KHÔNG có `nhan_su:view_salary` (backend che
   *  cùng nhóm field lương/BHXH) — KHÔNG phải "chưa khai", đừng gửi lại null (422). */
  pit_mode: PitMode | null;
  bank_account: string | null;
  bank_name: string | null;
  default_shift_id: number | null;
  resign_date: string | null;
  resign_reason: string | null;
  note: string | null;
  /** Thâm niên đã có TRƯỚC khi vào làm (tháng) — cộng với thời gian từ `hire_date` mới ra
   *  thâm niên tổng. Bỏ vế này là tính hụt với người chuyển từ nơi khác sang. */
  prior_seniority_months?: number;
  /** Quản lý trực tiếp = người đứng đầu gần nhất từ phòng mình trở lên. CHỈ `/api/employees/me`
   *  điền (màn HCNS để null — tránh N+1). */
  department_head_name?: string | null;
  /** Phòng mà người đó đứng đầu — khác phòng mình khi `department_head_inherited`. */
  department_head_dept_name?: string | null;
  department_head_avatar_url?: string | null;
  /** true = phòng mình chưa chỉ định người đứng đầu, đây là người của phòng CẤP TRÊN. */
  department_head_inherited?: boolean;
  /** Ca NỀN đang hiệu lực HÔM NAY (mốc tương lai chưa tính) — `GET /{id}` và `/me` điền. */
  current_shift_id?: number | null;
  current_shift_name?: string | null;
  /** Giờ vào–ra của ca hiện tại ("08:00–17:00") — chỉ `/me` điền. */
  current_shift_hours?: string | null;
  /** Lưới phân ca khai RIÊNG cho hôm nay, khác ca nền — chỉ `/me` điền; ngày thường để trống. */
  today_shift_off?: boolean;
  today_shift_name?: string | null;
  today_shift_hours?: string | null;
}

export interface EmployeeKpis {
  total: number;
  active: number;
  probation: number;
  /** Đã hết thử việc, chờ HCNS xác nhận chính thức. */
  probation_ended: number;
  on_leave: number;
  resigned: number;
  probation_ending_soon: number;
}

export interface EmployeeListOut {
  items: EmployeeRow[];
  total: number;
  page: number;
  size: number;
  kpis: EmployeeKpis;
}

export interface EmployeeDuplicate {
  id: number;
  code: string;
  full_name: string;
}

export interface EmployeeCreateOut {
  employee: EmployeeDetail;
  duplicate_national_id: EmployeeDuplicate | null;
  duplicate_social_insurance: EmployeeDuplicate | null;
  account_username: string | null;
}

export interface EmployeeUpdateOut {
  employee: EmployeeDetail;
  duplicate_national_id: EmployeeDuplicate | null;
  duplicate_social_insurance: EmployeeDuplicate | null;
}

export interface EmployeeEvent {
  id: number;
  event_type: string;
  effective_date: string | null;
  field: string | null;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  actor_user_id: number | null;
  actor_name: string | null;
  created_at: string | null;
}

export interface EmployeeAttachment {
  id: number;
  doc_kind: string;
  file_name: string;
  file_url: string;
  file_type: string | null;
  uploaded_by: number | null;
  uploaded_at: string | null;
}

export interface EmployeeActivityRow {
  action: string;
  target: string;
  detail: string;
  actor_name: string | null;
  created_at: string;
}

export interface EmployeeMeta {
  departments: { id: number; name: string }[];
  /** Vai trò để gán cho tài khoản. Role thuộc ĐÚNG 1 phòng ban → lọc theo phòng của hồ sơ. */
  roles: { id: number; name: string; department_id: number }[];
}

export interface EmployeeAccountInput {
  username: string;
  password: string;
  name?: string | null;
  role_id?: number | null;
}

export interface EmployeeInitialSalaryInput {
  effective_from?: string | null;
  /** Lương cơ bản (đóng BH) — mức đóng BHXH/BHYT/BHTN bám số này. */
  luong_vi_tri: number;
  luong_trach_nhiem?: number;
  /** MỨC ĐÓNG BHXH khai riêng của NGƯỜI NÀY (16/09/2026) — BHXH 8% + BHYT 1,5% + BHTN 1%
   *  tính trên số này; đoàn phí công đoàn vẫn theo mức nền. Bắt buộc ở cả hai form nhập. */
  insurance_base?: number;
  /** "Lương trả 1 lần" (đợt 1) — mức điền sẵn khi lập phiếu thanh toán lương đợt 1. */
  luong_dot_1?: number;
  allowance?: number;
  /** Hai ô ĐÃ NGƯNG (ca 03/08/2026 · thâm niên 07/09/2026) — nhận cho tương thích, engine không trả. */
  phu_cap_ca?: number;
  phu_cap_tham_nien?: number;
  chuyen_can?: number;
  /** BH đóng ở nơi khác → công ty chỉ đóng TNLĐ-BNN (không trừ BHXH/BHYT/BHTN của NV). */
  insurance_elsewhere?: boolean;
  /** Đoàn viên công đoàn → mới bị trừ đoàn phí công đoàn. */
  union_member?: boolean;
  /** % hoa hồng của NV kinh doanh — PHÂN SỐ (0.05 = 5%), backend chặn `le=1`. CHỈ ĐỂ KHAI:
   *  engine lương KHÔNG tự cộng số này vào bảng lương. */
  commission_pct?: number;
  note?: string | null;
}

export interface EmployeeInput {
  full_name: string;
  department_id: number | null;
  position?: string | null;
  status?: string;
  hire_date?: string | null;
  probation_end_date?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  national_id?: string | null;
  national_id_date?: string | null;
  national_id_place?: string | null;
  phone?: string | null;
  email?: string | null;
  permanent_address?: string | null;
  current_address?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  social_insurance_no?: string | null;
  pit_tax_code?: string | null;
  dependents_count?: number;
  /** Cách tính thuế TNCN — chỉ ghi được khi actor có `nhan_su:edit_salary`; thiếu quyền thì
   *  backend BỎ QUA field này (không 403). Gửi null = 422 (schema có pattern). */
  pit_mode?: PitMode;
  bank_account?: string | null;
  bank_name?: string | null;
  default_shift_id?: number | null;
  note?: string | null;
  /** Thâm niên đã có TRƯỚC khi vào làm (tháng) — chỉ gửi lúc TẠO hồ sơ. */
  prior_seniority_months?: number;
  account?: EmployeeAccountInput | null;
  initial_salary?: EmployeeInitialSalaryInput | null;
}

export interface EmployeeTransitionInput {
  kind: string;
  effective_date?: string | null;
  note?: string | null;
  new_department_id?: number | null;
  new_position?: string | null;
  resign_reason?: string | null;
}

export interface EmployeeListParams {
  q?: string;
  department_id?: number | null;
  status?: string | null;
  has_account?: boolean | null;
  /** Thử việc hết trong 30 ngày tới — lọc ở MÁY CHỦ, đếm trùng với KPI `probation_ending_soon`. */
  ending_soon?: boolean;
  sort?: string;
  page?: number;
  size?: number;
}

// --- "Hồ sơ của tôi" (self-service, nhân viên thường) ---
export interface MyProfile {
  has_employee: boolean;
  employee: EmployeeDetail | null;
}
export interface MyContactInput {
  phone?: string | null;
  email?: string | null;
  current_address?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
}

/** Số ký tự tối đa của các ô hồ sơ NV được ĐỀ NGHỊ đổi — khớp `String(n)` trong
 *  `backend/app/models/employee.py`. Chỉ để chặn sớm + cảnh báo tại chỗ; BE vẫn là cổng thật
 *  (đo lại đúng độ dài cột khi gửi VÀ khi duyệt). Thiếu bảng này thì người gõ 44 ký tự vào ô
 *  30 ký tự vẫn gửi được, và người DUYỆT mới là người lãnh lỗi. */
export const EMPLOYEE_FIELD_MAXLEN: Record<string, number> = {
  full_name: 255,
  national_id: 20,
  national_id_place: 255,
  permanent_address: 500,
  bank_account: 30,
  bank_name: 100,
};

// Yêu cầu cập nhật hồ sơ (NV đề nghị → HCNS duyệt).
export interface UpdateRequest {
  id: number;
  employee_id: number;
  employee_name: string | null;
  changes: Record<string, string | number | null>;
  /** Giá trị hồ sơ ĐANG mang của đúng các field trong `changes` — BE điền cho hàng đợi duyệt
   *  của HCNS (rỗng ở các endpoint "của tôi": màn đó đã cầm sẵn hồ sơ người xem). */
  current?: Record<string, string | number | null>;
  reason: string | null;
  /** pending | approved | rejected | cancelled (`cancelled` = NV tự rút lại). */
  status: string;
  decision_note: string | null;
  /** Lúc HCNS quyết — hoặc lúc chính NV rút lại đề nghị. */
  decided_at: string | null;
  decided_by_name: string | null;
  created_at: string;
}
export interface UpdateRequestInput {
  changes: Record<string, string | number | null>;
  reason?: string | null;
}
/** Một TRANG đề nghị của chính NV. `dem` đếm trên TOÀN BỘ hồ sơ (không phải trang đang xem) —
 *  badge "N chờ duyệt" và số trên pill lọc phải đọc `dem`, đừng đếm lại từ `items`. */
export interface MyUpdateRequestsPage {
  items: UpdateRequest[];
  total: number;
  page: number;
  size: number;
  dem: Record<string, number>;
  /** Số đề nghị theo trạng thái trong kỳ đang xem (bỏ điều kiện trạng thái) — số trên thẻ lọc. */
  dem_theo_tab?: Record<string, number>;
}

// --- Chấm công GPS (nhan_su) ------------------------------------------------

export interface WorkLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  is_active: boolean;
  note: string | null;
  created_at?: string | null;
}

export interface WorkLocationInput {
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  note?: string | null;
  is_active?: boolean;
}

export interface AttendanceLog {
  id: number;
  employee_id: number;
  employee_name?: string | null;
  work_location_id?: number | null;
  location_name?: string | null;
  check_type: string;
  checked_at: string;
  latitude?: number | null;
  longitude?: number | null;
  distance_m?: number | null;
  accuracy_m?: number | null;  // sai số trình duyệt báo lúc chấm; rỗng ở lượt cũ / chấm tay
  within_range: boolean;
  note?: string | null;
}

export interface NearestLocation {
  id: number;
  name: string;
  radius_m: number;
}

export interface CheckResult {
  success: boolean;
  within_range: boolean;
  check_type: string | null;
  ot_mode?: boolean;           // lượt vừa chấm thuộc phiên TĂNG CA
  distance_m: number | null;
  nearest_location: NearestLocation | null;
  vi_tri_gan_dung?: boolean;   // bị từ chối vì trình duyệt chỉ cho vị trí gần đúng
  message: string;
  log: AttendanceLog | null;
}

export interface AttendancePreview {
  locations_configured: boolean;
  within_range: boolean;
  distance_m: number | null;
  meters_out: number | null;   // còn cách bao nhiêu mét mới vào vùng (0 nếu đã trong)
  nearest_name: string | null;
  radius_m: number | null;
  next_action: string | null;  // "in" | "out"
  ot_mode?: boolean;           // lượt kế tiếp thuộc phiên TĂNG CA
  vi_tri_gan_dung?: boolean;   // sai số cỡ vị trí gần đúng ⇒ không đo được khoảng cách
  message: string;
}

export interface MyShift {
  id: number;
  name: string;
  start_time: string;   // "HH:MM"
  end_time: string;
  is_overnight: boolean;
}

export interface TodaySummary {
  first_in: string | null;   // "HH:MM"
  last_out: string | null;
  cong: number | null;       // công đã tính từ các lượt chấm hôm nay theo ca (0 khi chưa chấm RA ca chính)
  reason: string | null;     // lý do khi công chưa đủ (thiếu chấm RA / vào trễ / về sớm…)
  late: boolean;
  early: boolean;
  ot_minutes: number;
}

export interface AttendanceStatus {
  has_employee: boolean;
  employee_name: string | null;
  next_action: string | null;
  ot_mode?: boolean;             // lượt kế tiếp thuộc phiên TĂNG CA → đổi nhãn nút
  can_check: boolean;
  check_block_reason: string | null;
  last_check: AttendanceLog | null;
  locations_configured: boolean;
  shift: MyShift | null;         // ca mặc định của NV (nếu đã gán)
  today: TodaySummary | null;    // tóm tắt "Hôm nay của tôi"
}

export interface WorkShift {
  id: number;
  name: string;
  start_time: string;   // "HH:MM"
  end_time: string;
  is_overnight: boolean;
  /** Hệ số ca đêm (1.3 = +30%) cho giờ rơi 22h–06h trong ca — chỉ ca qua đêm. */
  night_multiplier: number;
  grace_minutes: number;
  /** Nghỉ giữa ca "HH:MM" (07/09/2026) — null cả hai = ca không khai nghỉ. Khung tính công =
   *  (ra − vào) − nghỉ; ca 7:30–16:30 nghỉ 11:30–12:30 ⇒ mẫu số 480' (nửa buổi = 0,5 công). */
  break_start_time: string | null;
  break_end_time: string | null;
  /** Phụ cấp cơm khai theo ca (đ) — Lương cộng trọn mức cho mỗi ngày làm ca đạt ngưỡng công. */
  meal_allowance: number;
  /** Phụ cấp ca khai theo ca (đ), áp ca ngày/đêm — cùng luật ngày làm ca đạt ngưỡng (tiền cục
   *  theo ca: ca đêm 77k/đêm, ca tới sáng 125k… khai ở đây). */
  shift_allowance: number;
  is_active: boolean;
  /**
   * Ca CHẠY DƯỚI XƯỞNG: Xếp lịch lấy đúng các ca này làm giờ làm của xưởng — khung giờ được phép
   * đặt việc VÀ mẫu số tính % tải máy. Ca văn phòng (Hành chính 08:00–17:00) tắt cờ: vẫn chấm công
   * bình thường, chỉ thôi tính vào lịch xưởng.
   */
  ca_san_xuat: boolean;
  note: string | null;
}

export interface WorkShiftsList {
  items: WorkShift[];
  /** Giờ công chuẩn / ngày (Cấu hình lương) — mọi ca phải làm đúng số này khi `ca_khop_gio_chuan`. */
  gio_cong_chuan?: number | null;
  ca_khop_gio_chuan?: boolean;
}

export interface WorkShiftInput {
  name: string;
  start_time: string;
  end_time: string;
  is_overnight?: boolean;
  night_multiplier?: number;
  grace_minutes?: number;
  /** Nghỉ giữa ca — cả hai hoặc không cái nào (null = bỏ nghỉ). */
  break_start_time?: string | null;
  break_end_time?: string | null;
  meal_allowance?: number;
  shift_allowance?: number;
  note?: string | null;
  is_active?: boolean;
  /** Ca chạy dưới xưởng SX — nuôi khung giờ Xếp lịch + mẫu số % tải máy. Bỏ trống = bật. */
  ca_san_xuat?: boolean;
}

export interface TimesheetDay {
  shift_id?: number | null;
  shift_name?: string | null;
  first_in: string | null;
  last_out: string | null;
  hours: number | null;
  present: boolean;
  cong: number | null;   // công theo ca (0..1)
  late: boolean;
  early: boolean;
  ot_minutes: number;
  /** Có phiếu TC đã duyệt (ngày đã qua) mà KHÔNG có cặp bấm tăng ca ⇒ chốt là 0 phút TC (07/09/2026). */
  ot_thieu_cap?: boolean;
  night: boolean;
  leave: string | null;  // tên loại nghỉ (nếu ngày nghỉ đã duyệt) HOẶC tên ngày lễ
  leave_paid: boolean;   // nghỉ có lương (P) hay không (KL)
  holiday?: boolean;     // ngày nghỉ lễ hưởng lương (cộng 1 công tự động)
  /** LOẠI NGÀY khi CÓ ĐI LÀM — ba cờ `holiday`/`restday`/`plain` loại trừ nhau (thứ tự
   *  `plain > holiday > restday`, khớp nhánh tính tiền bên Lương). Ô lịch cần chúng để nói
   *  "→ tính N công"; không có cờ thì ngày Chủ nhật đi làm hiện y hệt ngày thường. */
  restday?: boolean;     // ngày NGHỈ TUẦN (CN) có đi làm → tiền ×`he_so_ngay.nghi_tuan`
  // Lễ rơi ĐÚNG ngày nghỉ tuần có đi làm → ×`he_so_ngay.le_nghi_tuan` (cả `holiday` lẫn `restday`
  // cùng bật, vì tiền cộng cả hai chế độ).
  le_nghi_tuan?: boolean;
  plain?: boolean;       // ngày `off1x` có đi làm → 1× phẳng, KHÔNG hệ số
  planned_off?: boolean; // ngày nghỉ theo lịch phân ca (dấu kế hoạch, không sinh hệ số)
  /** Ngày LÀM VIỆC đã qua, có ca, mà KHÔNG có lượt bấm nào (quên chấm vào & ra / vắng) — 14/10/2026.
   *  Chỉ là dấu: không công. */
  khong_cham?: boolean;
}

export interface TimesheetRow {
  employee_id: number;
  employee_code: string;
  employee_name: string;
  department_id: number | null;
  department_name: string | null;
  shift_id: number | null;
  shift_name: string | null;
  days: Record<string, TimesheetDay>;
  total_days: number;
  total_leave: number;
  /** TRONG ĐÓ `total_leave`: số ngày nghỉ CÓ lương (trả theo lương vị trí) — đừng cộng thêm. */
  paid_leave_days?: number;
  /** Công THIẾU nhưng có đơn nghỉ theo giờ đã duyệt — KHÔNG nằm trong `total_cong`
   *  (tiền công vẫn trừ), chỉ để Lương giữ nguyên phụ cấp chuyên cần. */
  excused_cong?: number;
  /** Công ĐẶC BIỆT trong tháng — nguồn của cột "Công đặc biệt". `holiday_cong`/`restday_cong`
   *  là TẬP CON của `total_cong`; riêng `plain_cong` đã bị trừ ra (Lương trả riêng, 1× phẳng). */
  holiday_cong?: number;
  restday_cong?: number;
  plain_cong?: number;
  total_hours: number;
  total_cong: number | null;
}

/** Hệ số công theo LOẠI NGÀY, đọc từ Cấu hình lương — để màn hình khỏi viết cứng số.
 *  ⚠️ Lễ và Chủ nhật CỐ Ý khác nhau: lễ = 1 (tiền lễ Đ112) + hệ số làm lễ ⇒ mặc định 4×;
 *  Chủ nhật = đúng hệ số nghỉ tuần ⇒ mặc định 2×. Đừng "dọn" cho giống nhau. */
export interface HeSoNgay {
  /** Ngày lễ đi làm — TỔNG (khách chốt 15/09/2026: 300%, không còn 1 + 3 = 4×). */
  le: number;
  nghi_tuan: number;
  /** Lễ rơi ĐÚNG ngày nghỉ tuần: cộng cả hai chế độ (200% + 300% = 500%). */
  le_nghi_tuan: number;
  off1x: number;
}

// --- Lưới phân ca tháng (shift plan) ----------------------------------------
// Ô trống = KẾ THỪA ca mặc định; lưới chỉ dùng để ĐÈ ngày khác thường.
// `source` cho biết ca đến từ đâu: day = khai tay trên lưới · assign = mốc ca mặc định ·
// default = cache `default_shift_id` · none = chưa có ca.
export interface ShiftPlanCell {
  shift_id: number | null;
  source: "day" | "assign" | "default" | "none";
  is_off: boolean;
  /** Nghỉ phép ĐÃ DUYỆT — lớp phủ CHỈ ĐỂ XEM, đọc thẳng từ phiếu, không nằm trong bảng ca.
   *  Khác hẳn `is_off` (dấu kế hoạch người dùng tự tô, không ra tiền). Huỷ phiếu là dấu tự hết. */
  leave_name?: string | null;
  leave_paid?: boolean | null;
}

export interface ShiftPlanDay {
  day: number;
  date: string;                       // YYYY-MM-DD
  weekday: number;                    // Mon=0 … Sun=6
  is_working: boolean;
  special_kind: "off" | "work" | "off1x" | null;
  name: string | null;
}

export interface ShiftPlanRow {
  employee_id: number;
  employee_code: string | null;
  employee_name: string;
  department_id: number | null;
  no_default: boolean;                // cả tháng không có ca nào → UI cảnh báo
  days: Record<string, ShiftPlanCell>;
}

export interface ShiftPlanMonth {
  year: number;
  month: number;
  days_in_month: number;
  locked: boolean;                    // kỳ công đã chốt → lưới read-only
  calendar: ShiftPlanDay[];
  shifts: WorkShift[];
  rows: ShiftPlanRow[];
}

export interface ShiftPlanPatchItem {
  employee_id: number;
  work_date: string;                  // YYYY-MM-DD
  action: "set" | "off" | "inherit";  // set = gán ca · off = nghỉ · inherit = xoá ô
  shift_id?: number | null;           // bắt buộc khi action="set"
}

export interface ShiftPlanReject {
  employee_id: number | null;
  date: string;
  reason: string;
}

export interface ShiftPlanSaveOut {
  saved: number;
  cleared: number;
  rejected: ShiftPlanReject[];
  /** Số ô THỰC SỰ đổi (lưu lại y nguyên không tính) — nuôi banner sau khi Lưu. */
  changed: number;
  notified: number;
  /** NV chưa có tài khoản đăng nhập ⇒ không có chỗ nhận thông báo. Nói thẳng, đừng nuốt. */
  not_notified: number;
}

// --- Lịch sử thay đổi ca (chủ 28/07/2026) ---
/** `day` = tô đè MỘT ngày trên lưới · `base` = ca nền, áp từ ngày hiệu lực TRỞ VỀ SAU. */
export type ShiftChangeKind = "day" | "base";
/** Thao tác đến từ màn nào — dùng để hiện chip "Gỡ mốc" tách khỏi "Ca nền". */
export type ShiftChangeOrigin = "grid" | "base_panel" | "base_bulk" | "profile" | "base_remove";
export interface ShiftChange {
  id: number;
  employee_id: number;
  employee_name: string | null;
  employee_code: string | null;
  kind: ShiftChangeKind;
  origin: ShiftChangeOrigin;
  action: "set" | "off" | "inherit" | "remove";
  /** `day` → ngày công bị đổi. `base` → ngày BẮT ĐẦU HIỆU LỰC. Đừng đọc lẫn hai nghĩa này. */
  apply_date: string;
  shift_id_before: number | null;
  shift_name_before: string | null;
  shift_id_after: number | null;
  shift_name_after: string | null;
  is_off_before: boolean;
  is_off_after: boolean;
  /** `day`: trước đó ô đang KẾ THỪA ca nền (chưa ai khai tay ngày này). */
  inherited_before: boolean;
  actor_user_id: number | null;
  actor_name: string | null;
  created_at: string;
  /** false = NV không có tài khoản ⇒ chưa báo được cho ai. */
  notified: boolean;
  seen: boolean;
}
export interface AttendanceNotify {
  unseen_shift_changes: number;
}

// --- Nghỉ phép (leave) ---
export interface LeaveType {
  /** Chỉ có sau PUT đổi cờ có-lương khi còn đơn đã duyệt ở kỳ chưa chốt công (C16, 08/09/2026). */
  canh_bao?: string | null;
  id: number;
  name: string;
  is_paid: boolean;
  annual_quota: number;
  is_active: boolean;
  note: string | null;
}

export interface LeaveTypeInput {
  name: string;
  is_paid?: boolean;
  annual_quota?: number;
  note?: string | null;
  is_active?: boolean;
}

// --- Tăng ca (module `tang_ca`) ---------------------------------------------
// `from_minute`/`to_minute` = phút tính từ 00:00 của NGÀY CÔNG; > 1440 nghĩa là đã sang hôm sau
// (vd 03:00 hôm sau = 1620). Cùng trục với cách bảng công gom ca qua đêm.
export interface OvertimeRequest {
  id: number;
  employee_id: number;
  employee_name: string | null;
  work_date: string;
  from_minute: number;
  to_minute: number;
  minutes: number;
  reason: string | null;
  status: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string | null;
  /** Yêu cầu hủy MỚI NHẤT của phiếu (23/09/2026) — `trang_thai === "cho"` ⇒ "Đang xin hủy". */
  yeu_cau_huy?: YeuCauHuy | null;
}
export interface OvertimeInput {
  work_date: string;
  from_minute: number;
  to_minute: number;
  reason?: string | null;
}
export interface OvertimeForInput extends OvertimeInput {
  employee_id: number;
}
export interface MyOvertime {
  has_employee: boolean;
  employee_name: string | null;
  items: OvertimeRequest[];
  /** Tổng phiếu của tôi trên TOÀN BẢNG — không phải `items.length` (đó là số dòng của trang). */
  total: number;
  page: number;
  size: number;
  /** Số theo trạng thái cho thanh tab — cùng kỳ + bộ lọc (06/10/2026). */
  dem_theo_tab?: Record<string, number> | null;
}
export interface OvertimeSummary {
  pending_in_scope: number | null;
  my_decided_unseen: number;
}
export interface OvertimeBulkResult {
  done: number[];
  skipped: number[];
}
/** Số dư TRẦN GIỜ LÀM THÊM THÁNG (Điều 107 BLLĐ) — nuôi dải bộ đếm trên modal tạo/sửa phiếu.
 *
 *  `ap_tran = false` ⇒ công ty chưa bật trần ⇒ FE **ẩn cả khối**, đừng bày ô vô nghĩa.
 *  Đếm theo PHIẾU (chờ duyệt + đã duyệt), KHÔNG phải giờ đã bấm máy — phiếu chờ duyệt
 *  vẫn GIỮ CHỖ. Mọi số là PHÚT; UI quy ra giờ ("40h" / "8h30").
 *  KHÔNG có trần theo NĂM — chủ đã bỏ (17/08/2026). */
export interface TranThangOut {
  ap_tran: boolean;
  tran_phut: number;
  da_dung_phut: number;
  /** null khi `ap_tran = false` (không có trần thì không có "còn lại"). */
  con_lai_phut: number | null;
}

// --- Đi muộn / về sớm / nghỉ nửa buổi (module `di_muon`) ---------------------
// Phiếu CHẤM CÔNG ngoại lệ, KHÔNG phải đơn nghỉ phép: 1 phiếu/ngày, tổ trưởng duyệt, khai
// khoảng VẮNG MẶT (`from_minute`→`to_minute`, phút từ 00:00 ngày công, KHÔNG qua nửa đêm).
// `leave_type_id` khác null = người tạo tick "trừ vào phép năm" ⇒ tiêu `leave_cong` ngày phép
// (làm tròn lên 0,5) và phần vắng VẪN được trả lương. Null = mất công phần vắng, quỹ phép nguyên.
export interface LateEarlyRequest {
  id: number;
  employee_id: number;
  employee_name: string | null;
  work_date: string;
  from_minute: number;
  to_minute: number;
  minutes: number;
  leave_type_id: number | null;
  leave_type_name: string | null;
  leave_cong: number;
  reason: string | null;
  status: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string | null;
}
export interface LateEarlyInput {
  work_date: string;
  from_minute: number;
  to_minute: number;
  reason?: string | null;
  /** Tick "trừ vào phép năm" → id loại nghỉ; bỏ tick → null. */
  leave_type_id?: number | null;
}
export interface LateEarlyForInput extends LateEarlyInput {
  employee_id: number;
}
export interface MyLateEarly {
  has_employee: boolean;
  employee_name: string | null;
  items: LateEarlyRequest[];
}
export interface LateEarlySummary {
  pending_in_scope: number | null;
  my_decided_unseen: number;
}
export interface LateEarlyBulkResult {
  done: number[];
  skipped: number[];
}
/** Thợ trong tầm + danh mục ca, gác bằng `di_muon:approve`. Tồn tại vì vai "Tổ trưởng SX"
 *  KHÔNG có module `nhan_su` ⇒ `/api/employees` và `/api/attendance/shifts` đều 403 với họ. */
/** Thợ trong tầm của người duyệt tăng ca — nuôi dropdown "Tạo hộ thợ" (E8, 08/09/2026). */
export interface OvertimeRoster {
  employees: { id: number; code: string | null; full_name: string; department: string | null }[];
}

export interface LateEarlyRoster {
  employees: { id: number; code: string | null; full_name: string;
               department: string | null; default_shift_id: number | null }[];
  shifts: { id: number; name: string; start_minute: number; end_minute: number;
            is_overnight: boolean }[];
}

export interface LeaveRequest {
  id: number;
  employee_id: number;
  employee_name: string | null;
  leave_type_id: number | null;
  leave_type_name: string | null;
  is_paid: boolean | null;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: string;
  decided_by: number | null;
  /** Tên người duyệt/từ chối (hồ sơ NV của tài khoản `decided_by`). */
  decided_by_name?: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string | null;
  /** Yêu cầu hủy MỚI NHẤT của đơn (23/09/2026) — `trang_thai === "cho"` ⇒ "Đang xin hủy". */
  yeu_cau_huy?: YeuCauHuy | null;
}

/** Yêu cầu HỦY đơn nghỉ / phiếu tăng ca ĐÃ DUYỆT (chủ chốt 23/09/2026): người lao động chỉ XIN,
 *  ai có quyền duyệt thì quyết. Đơn gốc vẫn hiệu lực tới khi được đồng ý. */
export interface YeuCauHuy {
  id: number;
  loai: "nghi_phep" | "tang_ca";
  request_id: number;
  ly_do: string;
  trang_thai: "cho" | "dong_y" | "giu_nguyen" | "rut_lai";
  /** Người duyệt / HCNS hủy thẳng, không qua bước xin. */
  truc_tiep: boolean;
  /** Đơn nghỉ đang dở: hủy từ ngày này, giữ các ngày trước (`YYYY-MM-DD`). */
  huy_tu_ngay: string | null;
  /** `end_date` gốc của đơn nghỉ trước khi được rút ngắn. */
  den_ngay_cu: string | null;
  ly_do_quyet: string | null;
  created_at: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
}
export interface XinHuyChoDuyet<T> {
  yeu_cau: YeuCauHuy;
  don: T;
}

export interface LeaveRequestInput {
  leave_type_id: number;
  start_date: string;
  end_date: string;
  reason?: string | null;
}

export interface LeaveQuota {
  leave_type_id: number;
  name: string;
  annual_quota: number;
  used: number;       // ngày làm việc đã dùng + đang chờ (năm dương lịch)
  remaining: number;
  pending?: number;   // phần đang chờ duyệt nằm trong `used` (C5b, 08/09/2026)
}

export interface MyLeave {
  has_employee: boolean;
  employee_name: string | null;
  items: LeaveRequest[];
  /** Số dư phép năm — trả ĐỦ, KHÔNG bị phân trang (màn Chấm công đọc đúng ô này). */
  quotas: LeaveQuota[];
  /** Tổng đơn của tôi trên TOÀN BẢNG — không phải `items.length`. */
  total: number;
  page: number;
  size: number;
  /** Số theo trạng thái cho thanh tab — cùng kỳ + bộ lọc (06/10/2026). */
  dem_theo_tab?: Record<string, number> | null;
}

export interface LeaveSummary {
  /** Số đơn chờ duyệt trong scope; null nếu người gọi không có quyền duyệt (ẩn badge). */
  pending_in_scope: number | null;
  /** Số đơn của tôi vừa được quyết mà tôi chưa xem → chuông Topbar. */
  my_decided_unseen: number;
}

export interface LeaveCalendarDay {
  status: string; leave_type_name: string; is_paid: boolean;
  /** Đơn đã duyệt đang có yêu cầu hủy chờ quyết — vẫn là ngày nghỉ, chỉ gắn dấu (23/09/2026). */
  dang_xin_huy?: boolean;
}
export interface LeaveCalendarEmp { employee_id: number; employee_name: string; days: Record<string, LeaveCalendarDay>; }
export interface LeaveCalendar { year: number; month: number; days_in_month: number; employees: LeaveCalendarEmp[]; }

// --- Lương (module `luong`, Phase 1) ----------------------------------------
export interface PayrollParams {
  standard_cong_default: number;
  probation_ratio: number;
  bhxh_rate: number;
  bhyt_rate: number;
  bhtn_rate: number;
  /** Phía NGƯỜI SỬ DỤNG LAO ĐỘNG — KHÔNG trừ vào lương NV, chỉ để tính chi phí công ty. */
  bhxh_rate_er: number;
  bhyt_rate_er: number;
  bhtn_rate_er: number;
  cong_doan_rate: number;
  /** Tỷ lệ TNLĐ-BNN công ty chịu (mẫu 0.5%=0.005) — khi NV có BH đóng ở nơi khác. */
  tnld_bnn_rate: number;
  deduction_self: number;
  deduction_dependent: number;
  /** Nhánh `khau_tru_10`: thuế = tỷ lệ này × thu nhập chịu thuế (mẫu 0.10 = 10%), chỉ khấu
   *  trừ khi thu nhập ≥ `pit_flat_threshold`. Hai số đổi theo luật ⇒ ĐỪNG viết cứng vào UI. */
  pit_flat_rate: number;
  pit_flat_threshold: number;
  /** Trần khấu trừ kỷ luật (Điều 102 BLLĐ) — mức LUẬT, mặc định 0.30.
   *  `0` = TẮT trần: ghi phạt bao nhiêu trừ bấy nhiêu (thực nhận vẫn có sàn 0). */
  phat_cap_pct: number;
  /** SỐ NGÀY nghỉ không lương trong tháng để MIỄN đóng BHXH tháng đó — mức LUẬT (QĐ 595 Đ42.4),
   *  mặc định 14. `0` = TẮT luật: tháng nào cũng trừ BHXH. Đây là số NGÀY, không phải tỷ lệ. */
  bhxh_mien_tu_so_ngay: number;
  /** Ngưỡng CÔNG của một ngày để hưởng TRỌN cơm + phụ cấp của ca hôm đó (0,5 = nghỉ nửa buổi
   *  vẫn được hưởng). Cố ý không chia theo tỷ lệ — một suất ăn là có hoặc không. */
  phu_cap_ca_min_cong: number;
  chuyen_can_default: number;
  standard_hours_per_day: number;
  /** Ca phải khớp giờ công chuẩn: khai ca (giờ ra − giờ vào − nghỉ giữa ca) ≠ số trên thì không cho lưu. */
  ca_khop_gio_chuan?: boolean;
  ot_multiplier: number;
  ot_multiplier_restday: number;
  ot_multiplier_holiday: number;
  restday_work_multiplier: number;
  holiday_work_multiplier: number;
  night_pct: number;
  /** Cộng dồn tăng ca đêm (Đ98.3) — mặc định 0.2 = +20%. Khai được ở Cấu hình lương. */
  ot_night_extra_pct: number;
  bh_base_cap: number;
  bhtn_base_cap: number;
  /** DORMANT — trần tạm ứng đã gỡ (2026-07-24). Backend vẫn trả field; FE không còn dùng. */
  advance_max_pct: number;
  /** Số NGÀY CÔNG tối đa 1 NV được tự xin chỉnh công trong 1 tháng. 0 = không giới hạn. */
  adjust_max_per_month: number;  /** Suất cơm TĂNG CA: ngưỡng phút/ngày (chỉ áp NGÀY LÀM VIỆC) và tiền một suất.
   *  `com_tang_ca_muc = 0` ⇒ TẮT tính năng. */
  com_tang_ca_nguong_phut: number;
  com_tang_ca_muc: number;
  /** Công tính lương tối thiểu (từ ngày 1 tới ngày lập phiếu) để lập phiếu tạm ứng / lương đợt 1.
   *  0 = tắt điều kiện (25/09/2026). */
  tam_ung_cong_toi_thieu: number;
  /** TRẦN GIỜ LÀM THÊM THÁNG (Đ107) — số PHÚT tối đa MỘT người trong MỘT tháng, `0` = TẮT trần.
   *  Backend CHẶN CỨNG khi vượt: không có đường vượt, không quyền đặc biệt. Ô nhập trên UI theo
   *  GIỜ (40h = 2400) — nhớ ×60 lúc lưu, ÷60 lúc đọc. KHÔNG có trần theo NĂM. */
  ot_max_minutes_per_month: number;
  /** Độ dài tối đa của MỘT phiếu tăng ca, tính bằng PHÚT (Đ107.1, mặc định 720 = 12h). */
  ot_max_minutes_per_day: number;
}
export interface EmployeeSalary {
  id: number;
  employee_id: number;
  effective_from: string;
  effective_to?: string | null;
  is_current?: boolean;
  base_amount: number | null;
  /** Mức HỢP ĐỒNG riêng của NV — mức nền = vị trí + trách nhiệm. */
  luong_vi_tri: number;
  luong_trach_nhiem: number;
  /** Lương trả 1 lần (đợt 1) — số điền sẵn khi tạo phiếu "thanh toán lương đợt 1". */
  luong_dot_1?: number;
  /** Mức đóng BH khai riêng (dormant — engine bám luong_vi_tri). */
  insurance_base: number | null;
  /** Phụ cấp KHAI TAY — số cố định, engine cộng phẳng, KHÔNG tự tính gì. */
  allowance: number; // phụ cấp KHÁC (gộp)
  /** Hai ô ĐÃ NGƯNG (ca 03/08/2026 · thâm niên 07/09/2026): giữ số cũ để tra, engine không trả. */
  phu_cap_ca?: number;
  phu_cap_tham_nien?: number;
  chuyen_can: number;
  /** BH đóng ở nơi khác → công ty chỉ đóng TNLĐ-BNN (prefill checkbox Sửa lương). */
  insurance_elsewhere?: boolean;
  /** Đoàn viên công đoàn → mới bị trừ đoàn phí (prefill checkbox Sửa lương). */
  union_member?: boolean;
  /** Ăn công nhật ở tổ sản xuất: lương theo công + tăng ca theo giờ, không hưởng tiền sản lượng. */
  /** Cách trả lương: true = công nhật, false = lương khoán, null = theo trạng thái (thử việc = công nhật). */
  an_cong_nhat?: boolean | null;
  /** Có áp giảm trừ bản thân khi tính TNCN không. Mặc định BẬT; tắt khi người này đã đăng ký
   *  giảm trừ bản thân ở nơi làm việc khác (luật cho đăng ký ở ĐÚNG MỘT nơi). */
  apply_self_deduction?: boolean;
  /** % hoa hồng NV kinh doanh — PHÂN SỐ (0.05 = 5%). Chỉ để khai, engine không tự cộng. */
  commission_pct?: number;
  note: string | null;
  created_at: string;
  created_by?: number | null;
  /** Tên người điều chỉnh (nhật ký "ai sửa"). */
  actor_name?: string | null;
}
export interface EmployeeSalaryInput {
  effective_from: string;
  base_amount?: number | null;
  /** Gõ riêng 2 ô mức hợp đồng của chính NV — mức nền = vị trí + trách nhiệm. */
  luong_vi_tri?: number;
  luong_trach_nhiem?: number;
  /** MỨC ĐÓNG BHXH khai riêng của NGƯỜI NÀY (16/09/2026) — BHXH 8% + BHYT 1,5% + BHTN 1%
   *  tính trên số này; đoàn phí công đoàn vẫn theo mức nền. Bắt buộc ở cả hai form nhập. */
  insurance_base?: number;
  /** Lương trả 1 lần (đợt 1) — mức trả trong 1 lần, dùng để điền sẵn phiếu đợt 1. */
  luong_dot_1?: number;
  /** Phụ cấp KHÁC khai tay của riêng NV — gõ một lần, tháng nào cũng cộng đúng số này. */
  allowance?: number; // phụ cấp KHÁC (gộp)
  /** Hai ô ĐÃ NGƯNG (ca 03/08/2026 · thâm niên 07/09/2026) — FE chỉ chép lại số cũ, engine không trả. */
  phu_cap_ca?: number;
  phu_cap_tham_nien?: number;
  /** Chuyên cần của riêng NV (0 = dùng mức của tổ). */
  chuyen_can?: number;
  /** BH đóng ở nơi khác → công ty chỉ đóng TNLĐ-BNN (không trừ BHXH/BHYT/BHTN của NV). */
  insurance_elsewhere?: boolean;
  /** Đoàn viên công đoàn → mới bị trừ đoàn phí công đoàn. */
  union_member?: boolean;
  /** Ăn công nhật ở tổ sản xuất: lương theo công + tăng ca theo giờ, không hưởng tiền sản lượng. */
  /** Cách trả lương: true = công nhật, false = lương khoán, null = theo trạng thái (thử việc = công nhật). */
  an_cong_nhat?: boolean | null;
  /** Áp giảm trừ bản thân khi tính TNCN (mặc định true). Bỏ tích khi người này đã đăng ký
   *  giảm trừ bản thân ở nơi làm việc khác. */
  apply_self_deduction?: boolean;
  /** % hoa hồng NV kinh doanh — PHÂN SỐ (0.05 = 5%), backend chặn `le=1`. */
  commission_pct?: number;
  note?: string | null;
}
export interface EmployeeSalaries {
  employee_id: number;
  employee_name: string | null;
  items: EmployeeSalary[];
}
export interface SalaryPreview {
  employee_id: number;
  monthly: number;
  source: string;
  chuyen_can: number;
  allowance: number;
  /** Hai ô đã ngưng (ca · thâm niên) — số hồ sơ, không ra tiền. */
  phu_cap_ca: number;
  phu_cap_tham_nien: number;
  insurance_base: number;
  luong_vi_tri: number;
  luong_trach_nhiem: number;
  /** Tổ tính hai lương (khối SX, Giao hàng) — form hồ sơ lương mới hiện ô "Cách trả lương". */
  tinh_hai_luong?: boolean;
  /** Đang thử việc — mốc lương chưa chọn cách trả thì mặc định Công nhật. */
  thu_viec?: boolean;
}
export interface SalaryAdvance {
  id: number;
  code: string | null;
  employee_id: number;
  employee_name: string | null;
  employee_code?: string | null;
  department_id?: number | null;
  department_name: string | null;
  bank_account: string | null;
  bank_name: string | null;
  period_year: number;
  period_month: number;
  advance_date: string;
  amount: number;
  reason: string | null;
  /** tam_ung (mặc định) | luong_dot_1 (thanh toán lương đợt 1). */
  kind: string;
  status: string;
  decision_note: string | null;
  created_at: string;
  /** Phiếu chi CÒN HIỆU LỰC — máy chủ gắn sẵn trong danh sách của kỳ (25/09/2026). */
  phieu_chi_id?: number | null;
  phieu_chi_code?: string | null;
}

export interface MyAdvanceInput {
  period_year: number;
  period_month: number;
  advance_date: string;
  amount: number;
  reason?: string | null;
  /** tam_ung (mặc định) | luong_dot_1 (tự xin phiếu thanh toán lương đợt 1). */
  kind?: string;
}
export interface SalaryAdvanceInput {
  employee_id: number;
  period_year: number;
  period_month: number;
  advance_date: string;
  amount: number;
  reason?: string | null;
  /** tam_ung (mặc định) | luong_dot_1 (phiếu thanh toán lương đợt 1). */
  kind?: string;
}
export interface MyAdvances {
  has_employee: boolean;
  items: SalaryAdvance[];
  /** Mức "Lương trả 1 lần" hiện hành — điền sẵn khi NV tự xin phiếu đợt 1 (0 = chưa khai). */
  luong_dot_1: number;
  /** Tháng SỚM NHẤT còn lập phiếu được (`YYYY-MM`) = liền sau kỳ lương đã chốt/đã chi muộn nhất.
   *  NV không có quyền đọc `/periods` nên server trả kèm ở đây. FE đặt làm `min` của ô chọn kỳ
   *  ⇒ **kỳ đã chốt không chọn được nữa**. `null` (server cũ) ⇒ lùi về mốc 12 tháng mặc định. */
  ky_min_chon_duoc?: string | null;
}
export interface PayrollPeriod {
  id: number;
  year: number;
  month: number;
  status: string;
  standard_cong: number;
  locked_at: string | null;
  paid_at: string | null;
  paid_by: number | null;
  /** CỬA SỔ xem phiếu của NLĐ. `cong_bo_luc` = mốc MỞ (`null` = chưa công bố);
   *  `dong_phieu_luc` = mốc ĐÓNG (`null` = mở không thời hạn).
   *  NV thấy phiếu khi `cong_bo_luc <= bây giờ < dong_phieu_luc`. Mở lại kỳ ⇒ cả hai về `null`. */
  cong_bo_luc?: string | null;
  dong_phieu_luc?: string | null;
}
export interface PayrollLine {
  id: number;
  employee_id: number;
  employee_code: string | null;
  employee_name: string | null;
  /** Máy chủ điền — thanh lọc "Phòng / tổ" lọc theo id ở máy chủ (06/10/2026). */
  department_id?: number | null;
  department_name: string | null;
  bank_account: string | null;
  bank_name: string | null;
  is_probation: boolean;
  actual_cong: number;
  standard_cong: number;
  monthly_salary: number;
  luong_cong: number;
  /** TRONG ĐÓ `luong_cong`: phần trả cho NGÀY NGHỈ PHÉP (chỉ tính lương vị trí, không có
   *  lương trách nhiệm). TUYỆT ĐỐI KHÔNG cộng lại vào tổng thu — cùng idiom với
   *  `phu_cap_tham_nien ⊂ allowance`. Cộng nhầm là SAI TIỀN LƯƠNG. */
  luong_ngay_phep?: number;
  /** Số công phép CÓ lương đã được trả trong `luong_ngay_phep`. */
  paid_leave_cong?: number;
  /** Công ngày LỄ + NGHỈ TUẦN có đi làm (⊂ `actual_cong`) — gốc của hệ số Đ98.1.b/c. */
  special_cong?: number;
  /** Công thường thực tế */
  cong_thuong?: number;
  /** Công ngày CN & Lễ (gồm công đi làm CN/lễ + công nghỉ lễ hưởng lương trả riêng) */
  cong_cn_le?: number;
  /** Thành tiền lương công thường */
  tien_cong_thuong?: number;
  /** Tổng thành tiền ngày CN & Lễ (gốc 1x + phụ trội + lương ngày lễ) */
  tien_cn_le?: number;
  /** TRONG ĐÓ của `ot_pay`: tiền GIỜ tăng ca (tách khỏi phụ trội CN / lễ). */
  tien_gio_tang_ca?: number | null;
  /** TRONG ĐÓ của `ot_pay`: tiền ngày `off1x` (trả 1× phẳng). Đừng cộng lại vào tổng. */
  off1x_pay?: number;
  /** CHẾ ĐỘ KHOÁN (14/09/2026, chụp lúc Tính lại): tổ bật Lương khoán / sản lượng hoặc tổ Giao hàng
   *  ⇒ KHÔNG có tiền tăng ca (làm thêm giờ đã trả qua tiền khoán); vẫn có cơm tăng ca + phần thêm làm
   *  nguyên ngày CN/lễ. Màn hình dùng để nói vì sao có giờ tăng ca mà tiền tăng ca = 0. */
  che_do_khoan?: boolean;
  /** Người này thuộc tổ bật cờ **Bộ phận Giao hàng** (chụp lúc Tính lại). Từ 16/09/2026 tổ Giao hàng
   *  ăn luật RIÊNG trong chế độ khoán: CÓ tiền giờ tăng ca, và tiền đó nằm trong vế thời gian đem so
   *  với khoán km (PRD bù lỗ §00.10) — nên màn hình phải tách được họ khỏi thợ khoán sản lượng. */
  la_giao_hang?: boolean;
  /** LƯƠNG BÙ LỖ (tổ khoán sản xuất, 14/09/2026, chụp lúc Tính lại): số bù lỗ theo công đã đem so
   *  với tiền khoán — lương sản lượng = MAX(khoán, bù lỗ). `null` = dòng không thuộc luật này.
   *  Khi có số, `luong_cong` là PHẦN BÙ THÊM cho đủ bù lỗ (0 nếu khoán cao hơn) — đừng in nó là
   *  "lương theo công". */
  bu_lo_theo_cong?: number | null;
  /** Vế THỜI GIAN đã đem so (21/10/2026) = bù lỗ theo công + tăng ca theo giờ + TC đêm. */
  ve_thoi_gian?: number | null;
  /** Tăng ca khoán (21/10/2026) — 50% phần tổ vượt chỉ tiêu ngày, thuộc vế khoán. */
  tang_ca_khoan?: number;
  /** true = khoán thấp hơn bù lỗ theo công, tháng này đang trả bù lỗ. */
  lay_bu_lo?: boolean;
  /** Công ngày lễ nghỉ hưởng lương của người ăn khoán / tài xế — trả RIÊNG, ngoài khoán, CÓ trong
   *  `gross` (15/09/2026). 0 với người công nhật: lễ của họ nằm sẵn trong `luong_cong`. */
  luong_ngay_le?: number;
  /** Số công ngày lễ nghỉ hưởng lương của kỳ — để phiếu / bảng lương ghi "N ngày" cạnh tiền lễ. */
  le_nghi_cong?: number;
  /** Phụ cấp đi theo công (15/09/2026): số tháng đã khai (ô Phụ cấp khác + khoản hồ sơ) và số công
   *  hưởng — `allowance` = phu_cap_thang ÷ công chuẩn × cong_phu_cap. null = kỳ cũ (cộng phẳng). */
  phu_cap_thang?: number | null;
  cong_phu_cap?: number | null;
  /** Công thiếu nhưng có đơn nghỉ theo giờ đã duyệt (được miễn phạt, giữ chuyên cần). */
  excused_cong?: number;
  chuyen_can: number;
  /** TỔNG phụ cấp tháng — ĐÃ GỒM 3 dòng dưới. Render 3 dòng thì ĐỪNG cộng thêm số này.
   *  Phụ cấp CA (`ca_pay`/`night_pay`) là khoản RIÊNG, KHÔNG nằm trong `allowance`. */
  allowance: number;
  /** NGƯNG 07/09/2026 — kỳ mới luôn 0; chỉ kỳ cũ còn số (phiếu in dòng "(đã ngưng)"). */
  phu_cap_tham_nien?: number;
  /** Có công mà mức lương = 0 — chưa khai ở Lương nhân viên (router điền; chốt kỳ bị chặn). */
  chua_khai_luong?: boolean;
  /** Chưa khai ô "Mức đóng BHXH" ở mốc lương hiện hành (16/09/2026) — đang tạm đóng theo mức nền. */
  chua_khai_muc_bh?: boolean;
  /** Phần còn lại = allowance − thâm niên (backend tính). */
  phu_cap_khac?: number;
  khoan: number;
  /** Khoán km giao hàng (mg 0231) — CỘNG THÊM vào gross, không phải "trong đó" của khoản nào.
   *  Là CỘT chứ không phải khoản danh mục: tiền engine tự tính đứng cùng nhà với `khoan`. */
  khoan_km?: number;
  /** Hoa hồng KD — cột riêng (07/09/2026), máy tự tính theo hoá đơn, cộng thẳng vào gross, chịu thuế. */
  hoa_hong?: number;
  ot_minutes: number;
  ot_pay: number;
  night_days: number;
  /** ⚠️ NGƯNG từ 03/08/2026 — luôn 0 ở kỳ mới. Trước là phụ cấp CA khai tay per-người (cộng
   *  phẳng). `ca_pay` là alias, CÙNG một số, đừng cộng 2 lần. Kỳ CŨ đã chốt vẫn còn số ở đây. */
  night_pay: number;
  ca_pay?: number;
  /** Cơm ca = `work_shifts.meal_allowance` × số ngày THỰC LÀM ca đó (ngày đủ ngưỡng công). */
  meal_allowance_pay?: number;
  /** Cơm TĂNG CA — dòng riêng, không gộp cơm ca (hai luật khác nhau, một ngày ăn cả hai được). */
  com_tang_ca_pay?: number;
  /** Phụ cấp ca = `work_shifts.shift_allowance` × số ngày THỰC LÀM ca đó. Tách riêng khỏi cơm vì
   *  tiền ăn giữa ca có trần miễn thuế riêng. */
  shift_allowance_pay?: number;
  /** Premium CA ĐÊM theo giờ (giờ 22h–06h × hệ số + tăng ca đêm) — tự tính từ chấm công, DÒNG RIÊNG. */
  night_premium_pay?: number;
  vi_pham: number;
  /**
   * Khoản DANH MỤC của dòng lương (snapshot Tầng 3) — phiếu lương in TỪNG DÒNG từ đây.
   * ⚠️ `source: "employee"` ĐÃ nằm trong `allowance`; tách thành dòng riêng thì phải trừ khỏi
   * "Phụ cấp khác". `source: "line"` nằm NGOÀI `allowance`, cộng thẳng.
   */
  components?: LineComponent[];
  /** 6 cột dưới đây NGỪNG GHI từ 28/07/2026 (thưởng khai qua `components`). Kỳ cũ vẫn có số. */
  other_bonus: number;
  thuong_5s: number;
  thuong_doanh_so: number;
  thuong_thanh_tich: number;
  phep_nam: number;
  tra_dong_phuc: number;
  dieu_chinh_luong: number;
  di_tre: number;
  /** True = HCNS sửa tay ô "Đi trễ" (phạt tự động không đè); False = tự động từ chấm công. */
  di_tre_manual: boolean;
  dt_vuot_troi: number;
  phat_bien_ban: number;
  phat_5s_dong_phuc: number;
  gross: number;
  insurance_base: number;
  /** TỔNG bảo hiểm NV đóng (10.5%) — số đã đóng băng lúc tính lương. */
  bhxh: number;
  /** Tách 3 khoản cho phiếu lương (nhãn đã kèm tỷ lệ). Tổng 3 dòng == `bhxh`. Rỗng ở đường xuất Excel. */
  insurance_lines?: { label: string; amount: number }[];
  cong_doan: number;
  pit: number;
  pit_manual: boolean;
  /** Thu nhập TÍNH thuế của kỳ (đã trừ bảo hiểm + giảm trừ gia cảnh) — số thuế bấm trên số này.
   *  KHÔNG phải "tổng thu nhập chịu thuế"; backend không snapshot số đó (PRD §3.3). */
  pit_taxable: number;
  /** Tổng phần thu nhập ĐƯỢC MIỄN thuế của kỳ = tăng ca + ca đêm + Σ khoản danh mục
   *  `is_taxable = false`. Snapshot lúc tính lương — đổi cờ hôm nay không làm lệch kỳ cũ. */
  thu_nhap_mien_thue: number;
  advance_total: number;
  /** Tổng "thanh toán lương đợt 1" đã duyệt của kỳ — dòng RIÊNG, KHÔNG gộp vào advance_total. */
  luong_dot_1_total: number;
  /** Nợ tạm ứng dồn kỳ (07/09/2026): kỳ trước mang sang / kỳ này chưa trừ hết chuyển kỳ sau. */
  no_ung_ky_truoc?: number;
  no_ung_chuyen_ky_sau?: number;
  net_pay: number;
  note: string | null;
}
export interface PayrollLineInput {
  // ⚠️ CỐ Ý KHÔNG CÓ 6 ô thưởng cũ (`thuong_5s`, `other_bonus`…): từ 28/07/2026 thưởng khai qua
  // danh mục (`addLineComponent`) để cờ "Chịu thuế" là quy tắc chung. Backend cũng đã bỏ chúng
  // khỏi `LineUpdateIn` — thêm lại ở đây chỉ tạo field gửi đi rồi bị bỏ qua trong im lặng.
  vi_pham?: number | null;
  pit?: number | null;
  pit_manual?: boolean | null;
  /** False = đưa phạt trễ VỀ TỰ ĐỘNG (tính lại từ chấm công); None = giữ nguyên. */
  di_tre_manual?: boolean | null;
  note?: string | null;
  dieu_chinh_luong?: number | null;   // cho phép ±
  di_tre?: number | null;
  dt_vuot_troi?: number | null;
  phat_bien_ban?: number | null;
  phat_5s_dong_phuc?: number | null;
}
export interface PitBracket {
  id: number;
  seq: number;
  up_to: number | null;
  rate: number;
}
export interface PitBracketInput {
  seq: number;
  up_to?: number | null;
  rate: number;
}
// Bảng phạt đi trễ / về sớm (toàn công ty, sửa được) — mirror biểu thuế TNCN.
// `up_to_minute` null = bậc cao nhất (∞, trên 1 giờ); `amount` = tiền phạt/lần (đồng).
export interface LatePenaltyBracket {
  id: number;
  seq: number;
  up_to_minute: number | null;
  amount: number;
}
export interface LatePenaltyBracketInput {
  seq: number;
  up_to_minute?: number | null;
  amount: number;
}

// --- Cấu hình lương: thành phần lương theo BỘ PHẬN (Tab 2) ------------------
// PRD v2.1: chỉ còn 3 khoản khai theo TỔ. Phụ cấp (ca · thâm niên) đã chuyển sang KHAI TAY ở
// từng NV (`employee_salaries`), thưởng KPI xoá hẳn 29/07/2026; gửi key cũ lên BE giờ ăn 422.
export type SalaryComponentKey =
  | "chuyen_can"
  | "luong_khoan"
  | "tang_ca";
export interface DeptComponent {
  component_key: SalaryComponentKey;
  is_enabled: boolean;
  /** null = bật nhưng CHƯA khai mức → 0 đ (không còn mức mặc định công ty để rơi xuống). */
  value: number | null;
  /** Bộ phận đã khai riêng dòng này chưa. */
  is_set: boolean;
  /** LEGACY — danh mục phụ cấp cấp công ty đã gỡ, BE luôn trả mặc định. */
  company_enabled: boolean;
  company_value: number | null;
  company_unit: string | null;
}
export interface DeptComponentInput {
  component_key: SalaryComponentKey;
  is_enabled: boolean;
  value?: number | null;
}
export interface DeptComponents {
  department_id: number;
  items: DeptComponent[];
}

/** CHỈ TIÊU NGÀY của tổ lương khoán / sản lượng (16/09/2026): tiền sản lượng MỘT thợ phải làm ra
 *  trong MỘT công. Mỗi dòng là một mốc "áp dụng từ ngày". CHƯA nối vào tính lương. */
export interface ChiTieuNgay {
  id: number;
  department_id: number;
  /** `YYYY-MM-DD` */
  ap_dung_tu: string;
  /** đ/công */
  so_tien: number;
  ghi_chu: string | null;
  updated_at: string | null;
}
export interface ChiTieuNgayList {
  department_id: number;
  /** Mốc đang hiệu lực HÔM NAY; null = chưa khai, hoặc mọi mốc đều áp dụng từ ngày tương lai. */
  hien_hanh: ChiTieuNgay | null;
  /** Mới nhất đứng đầu. */
  items: ChiTieuNgay[];
}
export interface ChiTieuNgayInput {
  ap_dung_tu: string;
  so_tien: number;
  ghi_chu?: string | null;
}

/** Tổ trưởng ăn gì trên sản lượng tổ (19/09/2026): không áp dụng · ăn thưởng · ăn chia. */
export type ToTruongCheDo = "khong" | "thuong" | "chia";
/** Một MỐC chế độ tổ trưởng của tổ khoán — CHƯA nối vào tính lương. */
export interface ToTruongMoc {
  id: number;
  department_id: number;
  /** `YYYY-MM-DD` */
  ap_dung_tu: string;
  che_do: ToTruongCheDo;
  /** % trên sản lượng tổ (5 = 5%); `khong` là 0. */
  ty_le: number;
  ghi_chu: string | null;
  updated_at: string | null;
}
export interface ToTruongList {
  department_id: number;
  /** Mốc đang hiệu lực HÔM NAY; null = chưa khai, hoặc mọi mốc đều áp dụng từ ngày tương lai. */
  hien_hanh: ToTruongMoc | null;
  /** Mới nhất đứng đầu. */
  items: ToTruongMoc[];
}
export interface ToTruongInput {
  ap_dung_tu: string;
  che_do: ToTruongCheDo;
  ty_le: number;
  ghi_chu?: string | null;
}

// --- Danh mục khoản thu nhập & thu nhập chịu thuế TNCN (chốt chủ 2026-07-27) ---
// Trước đây mọi phụ cấp gộp vào MỘT ô `allowance` nên engine không biết khoản nào miễn thuế →
// thu thừa TNCN. Giờ mỗi khoản một dòng danh mục, có cờ `is_taxable` bật/tắt tại chỗ.
export type ComponentKind = "thu" | "tru";
export interface PayrollComponent {
  id: number;
  code: string;
  name: string;
  /** `thu` = cộng vào tổng lương · `tru` = khấu trừ. */
  kind: ComponentKind;
  /** Ô tích "Chịu thuế" — false = KHÔNG tính vào thu nhập chịu thuế TNCN. */
  is_taxable: boolean;
  sort_order: number;
  is_active: boolean;
  note: string | null;
  /** Số NHÂN VIÊN đang được gán khoản này (hồ sơ — Tầng 2). */
  employee_count: number;
  /** Số KỲ LƯƠNG đã có khoản này (Tầng 3). Đếm KỲ chứ không đếm dòng: 100 dòng cùng một
   *  tháng vẫn là MỘT kỳ. Một trong hai số > 0 ⇒ xoá cứng bị chặn, chỉ ngừng áp dụng được. */
  period_count: number;
}
export interface PayrollComponentInput {
  name: string;
  kind?: ComponentKind;
  is_taxable?: boolean;
  sort_order?: number;
  note?: string | null;
}
/** Sửa TỪNG PHẦN — field nào bỏ qua thì backend giữ nguyên. */
export interface PayrollComponentPatch {
  name?: string;
  kind?: ComponentKind;
  is_taxable?: boolean;
  sort_order?: number;
  is_active?: boolean;
  note?: string | null;
}
/** Kết quả DELETE — nói rõ việc VỪA XẢY RA. `deactivated` = chỉ ngừng áp dụng, KHÔNG xoá:
 *  báo "đã xoá" trong trường hợp này là nói sai việc vừa làm. */
export interface PayrollComponentDeleteResult {
  deleted: boolean;
  deactivated: boolean;
  employee_count: number;
  period_count: number;
  /** Câu backend đã viết sẵn — màn hình hiện NGUYÊN VĂN, không tự chế lại. */
  message: string;
}
/** NV còn được gán một khoản ĐÃ NGỪNG ÁP DỤNG — lương vẫn trả đủ, danh sách này chỉ để HCNS
 *  chủ động gỡ. Backend trả rỗng khi khoản còn đang bật. */
export interface ComponentHolders {
  component_id: number;
  component_name: string;
  items: { employee_id: number; code: string; full_name: string }[];
}
/** Gán MỘT khoản cho NHIỀU người trong một thao tác (chủ 28/07/2026). */
export interface BulkAssignInput {
  amount: number;
  note?: string | null;
  /** Chọn cụ thể. Bỏ trống + `all_active: true` = tất cả NV ĐANG LÀM VIỆC trong phạm vi. */
  employee_ids?: number[];
  all_active?: boolean;
  /** ⚠️ Bật = ĐÈ mức riêng đã khai cho từng người, KHÔNG hoàn tác được. Mặc định tắt. */
  overwrite?: boolean;
}
export interface BulkAssignResult {
  assigned: number;            // thêm mới
  overwritten: number;         // đã ĐÈ mức riêng — hiện riêng, đừng gộp vào `assigned`
  skipped_existing: number;    // đã có mức riêng, không đè
  skipped_out_of_scope: number;
  total: number;
}

/** Khoản ĐANG GÁN cho một NV (Tầng 2). Chỉ trả khoản CÓ TIỀN — không phải cả danh mục. */
export interface ComponentValue {
  component_id: number;
  code: string;
  name: string;
  kind: ComponentKind;
  /** Kế thừa từ danh mục gốc (Tầng 1) — CHỈ ĐỌC, không sửa được ở tầng này. */
  is_taxable: boolean;
  amount: number;
  note: string | null;
  /** false = danh mục đã NGỪNG ÁP DỤNG nhưng người này còn giữ ⇒ bật cảnh báo đỏ.
   *  Tiền VẪN được trả (chốt của chủ) — không tự cắt lương ai. */
  is_active: boolean;
}
export interface ComponentValueInput {
  component_id: number;
  /** null = GỠ khoản khỏi người này (kỳ sau không trả nữa). */
  amount: number | null;
  note?: string | null;
}

/** Tầng 3 — khoản trên MỘT dòng bảng lương. `source`: `employee` = chép từ hồ sơ (sửa ở
 *  Lương → Lương nhân viên) · `line` = thêm tay, CHỈ có ở kỳ này, không lặp sang tháng sau ·
 *  `auto` = HỆ TỰ TÍNH (hoa hồng KD, theo hoá đơn bán trong kỳ) — backend CHẶN sửa/gỡ, giao diện
 *  phải để ở dạng chỉ đọc, và số bị ghi lại mỗi lần "Tính lại". */
export interface LineComponent {
  id: number;
  component_id: number;
  code: string;
  name: string;
  kind: ComponentKind;
  is_taxable: boolean;
  amount: number;
  note: string | null;
  /** `auto` chỉ còn ở dữ liệu trước 07/09/2026 (hoa hồng nay là cột `hoa_hong`). */
  source: "employee" | "line" | "auto";
  /** HCNS đã sửa tay số tiền CHO RIÊNG KỲ NÀY. Hồ sơ nhân viên KHÔNG đổi — tháng sau tự về mức
   *  cũ. Dòng đã đè được miễn khỏi lượt ghi đè của "Tính lại". */
  da_de_tay?: boolean;
}
export interface KhoanKmChuyen {
  trip_id: number;
  /** Mã yêu cầu giao (YCGH-…) của chuyến — cột Chuyến hiện mã này, không in id (#74). */
  ma_chuyen?: string | null;
  ngay: string | null;
  km: number;
  don_gia_km: number;
  /** Vai trò trong CHUYẾN ĐÓ, không phải chức danh của người. */
  vai_tro: "tai_xe" | "phu_xe";
  /** % được hưởng của chuyến. Đi một mình = 100, không phải `pct_tai_xe`. */
  pct: number;
  thanh_tien: number;
  /** Dòng chặng về kho của lượt xe: "Về kho của lượt LX-…"; chuyến giao khách thì null. */
  ghi_chu?: string | null;
}

export interface KhoanKmChiTiet {
  items: KhoanKmChuyen[];
  tong: number;
}

/** Một dòng làm nên tiền khoán của một người (21/10/2026). */
export interface KhoanKyDong {
  loai: "lan_ghi" | "tang_ca_khoan" | "to_truong" | "to_truong_tru" | "dung_may";
  batch_id?: number | null;
  ngay?: string | null;
  cong_doan?: string | null;
  to?: string | null;
  so_luong?: number | null;
  tien_lan_ghi?: number | null;
  so_nguoi?: number | null;
  /** Phần của người này theo lương ca máy (0..1, Đợt 2). */
  ty_le?: number | null;
  /** Thẻ tuỳ chọn khác 0 của lần ghi: "trùng khuôn", "3 số lỗ đục". */
  tuy_chon?: string[];
  /** Dòng `dung_may`: tên lý do, mã phiếu sửa máy, chỉ tiêu ngày của tổ. */
  ly_do?: string | null;
  sua_chua?: string | null;
  tien_ngay?: number | null;
  tien: number;
  ghi_chu?: string | null;
}

export interface KhoanKyChiTiet {
  items: KhoanKyDong[];
  tong_khoan: number;
  tong_tang_ca_khoan: number;
}

/** Màn Lương → Khoán theo tổ (22/10/2026) — `GET /api/luong/khoan-theo-to`. Tiền là số nguyên đồng. */
export interface KttNguoiLan {
  emp_id: number;
  ten: string;
  /** Người không thuộc tổ đang xem — ghi tổ sau tên. */
  to_ten: string | null;
  luong_bu_lo: number;
  tien: number;
}
export interface KttToTruongLan { ten: string; che_do: "chia" | "thuong"; ty_le: number; tien: number }
export interface KttLanGhi {
  batch_id: number;
  ngay: string;
  to_id: number | null;
  to_ten: string | null;
  nguon_loai: "lsx" | "bai_ghep";
  nguon_id: number | null;
  lenh_ma: string;
  lenh_ten: string;
  khach: string | null;
  quy_cach: SxSlQuyCach | null;
  cong_doan: string;
  bac: string | null;
  tuy_chon: string[];
  phat_sinh: { ten: string | null; so_luong: number; don_vi: string | null; don_gia: number; tien: number }[];
  so_luong: number;
  don_vi: string | null;
  tien_chinh: number;
  /** Tiền gốc của lần ghi (trước luật ngày). */
  tien: number;
  /** 0 = tổ in ngày CN/lễ (bỏ), 2 = CN trùng lễ. */
  he_so: number;
  ghi_chu: string | null;
  /** "chữ = thế số = kết quả" của phần chính. */
  cong_thuc: string | null;
  nguoi: KttNguoiLan[];
  to_truong: KttToTruongLan[];
}
export interface KttNguoi {
  emp_id: number;
  ten: string;
  to_ten: string | null;
  la_thanh_vien: boolean;
  luong_bu_lo: number;
  san_luong: number;
  dung_may: number;
  tang_ca: number;
  to_truong: number;
  o_to_khac: number;
  /** Ăn công nhật (mốc lương chưa chọn thì thử việc = công nhật): đứng trong tỷ lệ chia, không hưởng
   *  tiền khoán / tăng ca khoán. */
  cong_nhat: boolean;
  /** null với người tổ khác — lương chính của họ tính ở tổ của họ. */
  luong_khoan: number | null;
  thu_viec: boolean;
  phan_bo_bu_lo: number | null;
  cong: number | null;
  chuan_cong: number | null;
  an: "khoan" | "bu_lo" | null;
  luong_chinh: number | null;
}
export interface KhoanTheoTo {
  year: number;
  month: number;
  cac_to: { id: number; ten: string }[];
  to_id: number | null;
  to_ten: string | null;
  la_to_in: boolean;
  co_bang_luong: boolean;
  to_truong: { emp_id: number; ten: string; che_do: "chia" | "thuong"; ty_le: number; tien: number } | null;
  quy: { san_luong: number; dung_may: number; tang_ca: number; tong: number } | null;
  nguoi: KttNguoi[];
  doi_chieu: {
    quy: number; tang_ca: number; to_truong_thuong: number; cong_nhat: number; nguoi_to_khac: number;
    o_to_khac: number; luong_khoan: number; bu_lo: number | null; luong_chinh: number | null;
  } | null;
  so: KttLanGhi[];
  khac: KttLanGhi[];
  dung_may: { ngay: string; ly_do: string | null; sua_chua: string | null; ghi_chu: string | null; tien: number; nguoi: KttNguoiLan[] }[];
  ngay: { ngay: string; quy: number; chi_tieu: number; tang_ca: number }[];
}

export interface LineComponentInput {
  component_id: number;
  amount: number;
  note?: string | null;
}
export interface LineComponentPatch {
  amount?: number;
  note?: string | null;
}

export interface PayrollTable {
  period: PayrollPeriod | null;
  lines: PayrollLine[];
  /** Vì sao CHƯA chốt được bảng lương — `null` = chốt được. Máy chủ soạn sẵn CÂU CHỮ (kỳ công
   *  chưa chốt · bảng lương cũ hơn ảnh chụp · …) và đã tính cả mốc miễn trừ. ĐỪNG tự suy lại luật
   *  ở đây: số lý do còn tăng, suy lại là nút sáng mà bấm vào ăn lỗi — hoặc tệ hơn, tắt nút của
   *  tháng thật ra chốt được. Xem `PayrollService.ly_do_chua_chot_duoc`. */
  chan_chot_ly_do?: string | null;
  /** Cảnh báo (không chặn) trước khi chốt — người thực lĩnh 0 vì trừ nợ, người còn nợ chuyển kỳ. */
  canh_bao_chot?: string | null;
  /** Menu "Phòng / tổ" của thanh lọc — số người từng tổ (sau tìm + hợp đồng). */
  phong_loc?: LuaChonLoc[];
}

/** Danh sách màn Tạm ứng — lọc, đếm tab, chia trang ở máy chủ (06/10/2026). */
export interface TamUngDanhSach {
  items: SalaryAdvance[];
  total: number;
  dem_theo_tab: Record<string, number>;
  to_loc: LuaChonLoc[];
  /** Tổng phiếu đã duyệt / đã chi của CẢ kỳ (không theo bộ lọc). */
  tong_da_duyet: number;
  /** Id mọi phiếu của tab, bỏ qua điều kiện lọc. */
  ids_tab: number[];
  /** Id mọi phiếu khớp lọc của tab, mọi trang. */
  ids_loc: number[];
}
/** Một kỳ NLĐ tra lại được. CHỈ nhãn tháng — không kèm tiền. */
export interface KyXemDuoc {
  year: number;
  month: number;
  /** null = mở không thời hạn. */
  dong_phieu_luc: string | null;
}

/** Kỳ mới nhất NLĐ CHƯA xem được, kèm lý do — để màn thôi nói "chưa có kỳ lương nào". */
export interface ChoPhat {
  year: number;
  month: number;
  tinh_trang: "chua_phat" | "hen_gio" | "da_dong";
  /** Chỉ có nghĩa khi `tinh_trang = "hen_gio"`. */
  mo_luc: string | null;
}

export interface MyPayslip {
  has_employee: boolean;
  employee_name: string | null;
  period: PayrollPeriod | null;
  line: PayrollLine | null;
  /** Các kỳ tra lại được, mới → cũ. Rỗng = không có phiếu nào đang mở. */
  ky_xem_duoc: KyXemDuoc[];
  cho_phat: ChoPhat | null;
}

/** Một TIÊU CHÍ KIỂM của MỘT công đoạn — từ mg `0381` (08/10/2026) chỉ là một câu chữ;
 *  `thu_tu` do máy chủ gán (thêm = nối cuối, kéo thả = `sapXep`). */
export interface KcsHangMuc {
  id: number;
  ma: string;
  cong_doan_id: number;
  ten: string;
  thu_tu: number;
  created_at?: string | null;
}
/** Thân ghi — KHÔNG có `ma` (server cấp `KM####`) và `thu_tu` (server gán). */
export interface KcsHangMucBody {
  cong_doan_id: number;
  ten: string;
}
export interface KcsKhaiBaoCongDoan {
  cong_doan_id: number;
  ma: string;
  ten: string;
  /** Mã giai đoạn = `cong_doan.nhom`; "" = chưa khai giai đoạn. */
  nhom: string;
  /** `[]` = công đoạn đang dùng chưa có tiêu chí. */
  hang_muc: KcsHangMuc[];
}
export interface KcsKhaiBaoGiaiDoan {
  /** Mã giai đoạn = `cong_doan.nhom`; "" = công đoạn chưa khai giai đoạn. */
  nhom: string;
  cong_doan: KcsKhaiBaoCongDoan[];
}
export interface KcsKhaiBao {
  giai_doan: KcsKhaiBaoGiaiDoan[];
}
export interface KcsChepKetQua {
  da_chep: number;
  bo_qua: number;
  theo_dich: { cong_doan_id: number; da_chep: number; bo_qua: number }[];
}

export interface CongDoanLite {
  id: number;
  ma: string;
  ten: string;
  /** GIAI ĐOẠN (`cong_doan.nhom`): prepress · print · finishing · other. Màn khai báo hạng mục
   *  kiểm KCS lọc ô chọn công đoạn theo giai đoạn người dùng vừa chọn — nhãn ở `NHOM_CONG_DOAN`
   *  (`pages/keHoachSxShared.tsx`). Rỗng = công đoạn chưa khai giai đoạn. */
  nhom?: string | null;
  khoan_ghi_theo: string;
  /** Nhóm máy (loai_may) làm được công đoạn — checkbox "Máy làm được công đoạn này" ở danh mục.
   *  Drawer routing lệnh SX lọc dropdown MÁY theo đây; null/rỗng = không giới hạn (hiện tất cả).
   *  `/api/cong-doan` (CongDoanRow) đã trả sẵn, không cần đổi backend. */
  nhom_may_cho_phep?: string[] | null;
  /** MÁY cụ thể chạy được công đoạn + công thức giờ/giá của riêng từng cặp (06/09/2026).
   *  Hàng tick `nhom_may_cho_phep` ở trên nay chỉ là BỘ LỌC cho bảng này.
   *  Hình dạng viết thẳng ở đây, không import: file này cố ý không phụ thuộc module nào —
   *  bản đặt tên là `MayCongDoanRow` trong `pages/danh-muc/types.ts`. */
  may_lam_duoc?: { may_id: number; cong_thuc_gio?: string | null;
                   cong_thuc_gia?: string | null }[] | null;
  /** Các TỔ phụ trách công đoạn (nhiều tổ, 18/09/2026, mg `0312`) — tổ đầu là tổ mặc định. Ô tổ
   *  của bước lệnh chỉ mời các tổ này. Rỗng = công đoạn chưa khai tổ, không giới hạn. */
  department_ids?: number[] | null;
}

// Phiếu sản lượng công đoạn (Pha 5b)
export interface ProductionOutput {
  id: number;
  production_order_id: number;
  cong_doan: string;
  ghi_theo: string;
  year: number;
  month: number;
  group_name: string | null;
  employee_id: number | null;
  may_id: number | null;
  piece_rate_id: number | null;
  work_name: string;
  unit: string;
  unit_price: number;
  quantity: number;
  amount: number;
  defect_qty: number;
  defect_cause: string | null;
  defect_deduction: number;
  net_amount: number;
  tinh_khoan: boolean;
  work_date: string | null;
  note: string | null;
}
export interface ProductionOutputInput {
  production_order_id: number;
  cong_doan: string;
  year: number;
  month: number;
  group_name?: string | null;
  employee_id?: number | null;
  piece_rate_id?: number | null;
  work_name?: string | null;
  unit?: string | null;
  unit_price?: number | null;
  quantity: number;
  defect_qty?: number;
  defect_cause?: string | null;
  may_id?: number | null;
  tinh_khoan?: boolean | null;
  work_date?: string | null;
  note?: string | null;
}
export interface DefectReportRow {
  scope: string;
  employee_id: number | null;
  group_name: string | null;
  quantity: number;
  defect_qty: number;
  deduction: number;
  defect_rate: number;
}

export interface Timesheet {
  year: number;
  month: number;
  days_in_month: number;
  standard_cong?: number | null;   // công chuẩn động của tháng (số ngày làm việc theo lịch)
  holidays?: HolidayMark[];        // ngày nghỉ lễ hưởng lương trong tháng
  he_so_ngay?: HeSoNgay;           // hệ số công theo loại ngày (từ Cấu hình lương)
  rows: TimesheetRow[];
}

/** Một phiếu TC đã duyệt (ngày đã qua) mà không có cặp bấm tăng ca — cảnh báo trước khi chốt. */
export interface OtThieuCap {
  employee_id: number;
  employee_name: string;
  date: string;              // "YYYY-MM-DD"
  from_time: string;
  to_time: string;
  /** MÃ tình trạng — băng cảnh báo tách "bù được 1 chạm" với "phải chấm bù ca chính trước"
   *  (10/09/2026). `thieu_cap` = nút Xác nhận TC làm được; `khong_cham` = ngày trắng lượt bấm,
   *  bù được nhưng phải xác nhận riêng; `treo` = thiếu RA ca chính, phải chấm bù trước. */
  ma?: "thieu_cap" | "khong_cham" | "treo";
  ly_do: string;
}

// --- Chốt công tháng (kỳ công) ---
export interface AttendancePeriod {
  year: number;
  month: number;
  status: "draft" | "locked";
  locked_at: string | null;
  locked_by: number | null;
  line_count: number;
  employee_count: number;
  hanging_days: number;      // ngày treo (thiếu chấm RA) — xử trước khi Chốt
  /** Lượt bấm ghi vào SAU khi kỳ đã chốt. Chấm công GPS cố ý KHÔNG bị chặn (chặn thợ bấm
   *  giờ là họ đứng ở cổng bấm mãi không xong, nhất là ca đêm qua nửa đêm) nên chỉ đánh
   *  dấu: ảnh chụp không có mấy lượt này, Bảng lương cũng không ⇒ >0 là phải chốt lại kỳ. */
  phat_sinh_sau_chot?: number;
  /** Đổi ca nền / ô lưới có hiệu lực trong tháng, ghi SAU khi kỳ đã chốt (B8, 08/09/2026): ảnh chụp
   *  tính theo ca cũ ⇒ phải mở lại kỳ, chốt lại, Tính lại. */
  doi_ca_nen_sau_chot?: number;
  pending_leaves: number;    // đơn nghỉ phép chưa duyệt của tháng
  /** Phiếu đi muộn/về sớm chưa duyệt — CHẶN chốt công y như đơn nghỉ: snapshot đóng băng lúc
   *  chốt, phiếu duyệt sau đó không vào được nữa ⇒ NLĐ vẫn ăn phạt dù đã xin phép đúng luật. */
  pending_late_early: number;
  /** Phiếu TĂNG CA chưa duyệt — chặn từ 15/08/2026. Sót nó là ngõ cụt: chốt xong thì duyệt cũng
   *  bị chặn, mà không duyệt thì không có tiền tăng ca; gỡ ra phải mở lại cả kỳ công. */
  pending_overtime?: number;
  /** Phiếu TC đã duyệt (ngày đã qua) mà KHÔNG có cặp bấm — CẢNH BÁO, không chặn chốt (07/09/2026). */
  ot_thieu_cap?: number;
  ot_thieu_cap_list?: OtThieuCap[];
  pending_adjusts: number;   // yêu cầu chỉnh công chưa duyệt
  payroll_locked: boolean;   // kỳ lương tháng này đã chốt → không mở lại kỳ công
}

// --- Lịch làm việc & Ngày lễ (calendar) ---
export interface HolidayMark {
  day: number;
  date: string;   // ISO "YYYY-MM-DD"
  name: string;
}

export interface WorkCalendarConfig {
  works_mon: boolean;
  works_tue: boolean;
  works_wed: boolean;
  works_thu: boolean;
  works_fri: boolean;
  works_sat: boolean;
  works_sun: boolean;
  updated_at: string;
}
export type WorkCalendarConfigInput = Partial<Omit<WorkCalendarConfig, "updated_at">>;

export interface SpecialDay {
  id: number;
  day: string;      // ISO date
  kind: "off" | "work" | "off1x";   // off1x = nghỉ, đi làm chỉ lương chính 1× (không hệ số)
  name: string;
  is_paid: boolean;
  note: string | null;
}
export interface SpecialDayInput {
  day: string;
  kind: "off" | "work" | "off1x";
  name: string;
  is_paid?: boolean;
  note?: string | null;
}
export interface SpecialDaysOut {
  year: number;
  items: SpecialDay[];
  paid_off_count: number;   // số ngày nghỉ lễ hưởng lương đã khai trong năm
  statutory_paid: number;   // mức luật (11) — cảnh báo nếu paid_off_count < mức này
}
export interface CalendarDayCell {
  day: number;
  date: string;
  weekday: number;   // Mon=0..Sun=6
  kind: "work" | "weekend" | "holiday" | "makeup";
  name: string | null;
  is_working: boolean;
}
export interface CalendarMonth {
  year: number;
  month: number;
  working_days: number;
  /** Công chuẩn LƯƠNG = working_days + lễ hưởng lương (B1 08/09/2026) — số Bảng lương đang chia. */
  cong_chuan_luong?: number;
  paid_holiday_count: number;
  days: CalendarDayCell[];
  holidays: { date: string; name: string | null; is_paid: boolean }[];
}

export interface DayPunch {
  id: number;
  time: string;              // "HH:MM"
  check_type: string;        // in | out
  is_manual: boolean;
  adjust_reason: string | null;
  fault_party: string | null;
  distance_m: number | null;
}

export interface DayDetail {
  employee_id: number;
  employee_name: string;
  date: string;              // "YYYY-MM-DD"
  shift_name: string | null;
  cong: number | null;
  reason: string | null;
  /** Có khi NV có phiếu TC đã duyệt (trong ngày) nhưng chưa có cặp chấm tăng ca → FE nhắc + nút 1 chạm.
   *  `kieu`: `bu_cap` (đã ra ca chính trước giờ phiếu ⇒ thêm cặp VÀO/RA TC) hay `tach_phien` (thợ chỉ
   *  bấm 2 lượt ⇒ thêm RA ca chính + VÀO TC, lượt RA thật thành RA TC). `*_next_day` = mốc sang hôm sau. */
  ot_suggestion?: {
    from_time: string;
    to_time: string;
    from_next_day?: boolean;
    to_next_day?: boolean;
    kieu?: "bu_cap" | "tach_phien";
  } | null;
  punches: DayPunch[];
}

// --- Xác nhận tăng ca theo phiếu (07/09/2026) ---
export interface OtConfirmPunch {
  time: string;
  check_type: string;
  next_day: boolean;
}
export interface OtConfirmCandidate {
  ticket_id: number;
  employee_id: number;
  employee_code: string | null;
  employee_name: string;
  department_id: number | null;
  date: string;
  from_time: string;
  to_time: string;
  from_next_day: boolean;
  to_next_day: boolean;
  /** thieu_cap (xác nhận được) | da_co | treo | khong_cham | chua_gan_ca */
  tinh_trang: "thieu_cap" | "da_co" | "treo" | "khong_cham" | "chua_gan_ca";
  /** `chi_cap_tc` = ngày trắng lượt bấm: chỉ sinh CẶP TĂNG CA theo phiếu, ngày đó không có công
   *  ca chính ⇒ phải xác nhận riêng (`cho_phep_ngay_trang`). */
  kieu: "bu_cap" | "tach_phien" | "chi_cap_tc" | null;
  punches: OtConfirmPunch[];
}
export interface OtConfirmCandidates {
  date: string;
  items: OtConfirmCandidate[];
}
export interface OtConfirmInput {
  date: string;
  employee_ids: number[];
  reason?: string | null;
  /** Giờ RA tăng ca thực tế — chỉ có nghĩa khi xác nhận MỘT người kiểu `bu_cap`. */
  to_time?: string | null;
  to_next_day?: boolean;
  /** HCNS đã xác nhận riêng cho người KHÔNG bấm lượt nào cả ngày: chỉ sinh cặp TĂNG CA theo phiếu,
   *  chấp nhận ngày đó không có công ca chính. Thiếu cờ thì những người ấy bị bỏ qua. */
  cho_phep_ngay_trang?: boolean;
}
export interface OtConfirmResult {
  done: { employee_id: number; employee_name: string; kieu: string; punches: OtConfirmPunch[] }[];
  skipped: { employee_id: number; employee_name: string | null; reason: string }[];
}

export interface AdjustInput {
  employee_id: number;
  date: string;              // "YYYY-MM-DD"
  check_type: string;        // in | out
  time: string;              // "HH:MM"
  /** Giờ rơi SANG HÔM SAU (ca đêm quên RA 06:00; tăng ca vắt nửa đêm) — 07/09/2026. */
  next_day?: boolean;
  reason: string;
  fault_party: string | null;
}

export interface TodayKpi {
  present_now: number;
  missing_out: number;
  late_today: number;
  pending_requests: number;
}

/** Hạn mức chỉnh công THÁNG HIỆN TẠI. `limit = 0` ⇒ không giới hạn (`remaining` là null).
 *  `days` = các ngày công ĐÃ tính lượt — gửi thêm đơn cho chính ngày đó KHÔNG tốn lượt mới. */
export interface AdjustQuota {
  year: number;
  month: number;
  limit: number;
  used: number;
  remaining: number | null;
  days: string[];
}
export interface MyAdjustRequests {
  items: AdjustRequest[];
  quota: AdjustQuota | null;
}

export interface AdjustRequest {
  id: number;
  employee_id: number;
  employee_name: string | null;
  work_date: string;
  check_type: string;
  suggested_time: string | null;
  suggested_next_day?: boolean;
  reason: string;
  fault_party: string | null;
  status: string;            // pending | approved | rejected | cancelled
  decided_at: string | null;
  decision_note: string | null;
  decided_by_name: string | null;
  created_at?: string | null;
}

export interface RequestAdjustInput {
  date: string;
  check_type: string;
  suggested_time: string | null;
  /** Giờ gợi ý rơi sang hôm sau (ca đêm quên bấm RA sáng). */
  suggested_next_day?: boolean;
  reason: string;
}

export interface ProductionOrderRow {
  id: number;
  code: string;
  order_id: number | null;
  contract_no: string | null;
  customer_id: number | null;
  customer_name: string | null;
  product_id: number | null;
  product_name: string | null;
  quantity: number | null;
  order_date: string | null;
  delivery_request_date: string | null;
  doc_date: string | null;
  due_date: string | null;
  status: string;
  order_kind: string;
  parent_order_id: number | null;
  parent_code: string | null;
  bu_reason: string | null;
  tech_note_print: string | null;
  tech_note_finishing: string | null;
  note: string | null;
  created_by_user_id: number | null;
  created_by_name: string | null;
  updated_by_user_id: number | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string | null;
}
export interface ProductionAttachment {
  id: number;
  file_name: string;
  file_url: string;
  file_type: string | null;
  uploaded_by: number | null;
  uploaded_at: string | null;
}
export interface ProductionOrderListOut {
  items: ProductionOrderRow[];
  total: number;
  page: number;
  size: number;
}
export interface ProductionOrderOption {
  id: number;
  code: string;
  label: string;
}
export interface ProductionOrderInput {
  order_id?: number | null;
  contract_no?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  product_id?: number | null;
  product_name?: string | null;
  quantity?: number | null;
  order_date?: string | null;
  delivery_request_date?: string | null;
  doc_date?: string | null;
  due_date?: string | null;
  order_kind?: string;
  parent_order_id?: number | null;
  bu_reason?: string | null;
  tech_note_print?: string | null;
  tech_note_finishing?: string | null;
  note?: string | null;
}
// --- Thu mua ----------------------------------------------------------------
export type SupplierStatus = "active" | "inactive";

export interface SupplierItemRow {
  id: number;
  supplier_id: number;
  /** Mặt hàng gốc dòng này bán. null = thứ ngoài danh mục vật tư (dịch vụ, gia công) —
   *  vẫn khai được, chỉ không vào bảng so giá. */
  hang_loai: HangLoai | null;
  hang_id: number | null;
  /** Khổ mm của dòng giá GIẤY (10/10/2026 bỏ dạng cuộn/tờ): đủ hai cạnh (cạnh ngắn × cạnh dài)
   *  hoặc chỉ rộng (`kho_dai` = 0); 0 · 0 = bán MỌI khổ. Khổ chỉ-rộng KHÔNG khớp khổ hai cạnh.
   *  Vật tư khác 0 · 0. */
  kho_rong: number;
  kho_dai: number;
  item_name: string;
  unit: string;
  unit_price: number;
  vat_percent: number;
  /** Mặt hàng còn bán không. Ô chọn NCC ở form phiếu mua lọc theo cờ này — ngưng bán thì không
   *  mời nữa, vì backend cũng chặn đặt mới. */
  is_active: boolean;
  /** 1 đơn vị NCC bán bằng bao nhiêu ĐƠN VỊ GỐC của mặt hàng. `null` = không quy đổi được —
   *  KHÔNG được coi là 1: hệ số 1 sai thì giá sai mà không ai thấy dòng lỗi nào. */
  he_so_ve_goc: number | null;
  /** Đơn giá quy về đ/đơn-vị-gốc = `unit_price ÷ he_so_ve_goc`. Con số DUY NHẤT so ngang được
   *  giữa các NCC báo theo đơn vị khác nhau (1.020.000đ/ram vs 24.500đ/kg).
   *  `null` = chưa quy đổi được ⇒ xếp CUỐI kèm lý do, đừng lặng lẽ dùng giá thô. */
  gia_quy_doi: number | null;
  /** Đơn vị gốc của `unit` dòng này ("to", "kg"…) — `gia_quy_doi` quy về gốc NÀY. Hai dòng cùng
   *  `don_vi_goc` là cùng họ, so ngang được. "" = không quy đổi được. */
  don_vi_goc: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierItemInput {
  hang_loai?: HangLoai | null;
  hang_id?: number | null;
  /** Khổ mm dòng giấy: đủ hai cạnh hoặc chỉ rộng (`kho_dai` = 0). */
  kho_rong?: number;
  kho_dai?: number;
  item_name: string;
  unit: string;
  unit_price: number;
  vat_percent?: number;
  note?: string | null;
  /** CHỈ HIỂN THỊ, không gửi lên (`cleanSupplierItems` bỏ đi): hệ số máy chủ đã tính cho dòng ĐÃ
   *  LƯU — cột "Quy về gốc" có số ngay lúc mở form, khỏi đợi ô ĐVT nạp danh sách đơn vị. */
  he_so_ve_goc?: number | null;
}

/** 1 NCC trong bảng SO GIÁ của một mặt hàng. */
export interface SoGiaRow {
  supplier_id: number;
  supplier_name: string;
  supplier_item_id: number;
  /** Khổ mm của dòng giá giấy (hai cạnh, hoặc chỉ rộng khi `kho_dai` = 0). */
  kho_rong: number;
  kho_dai: number;
  unit: string;
  /** Đơn vị gốc của `unit` dòng này ("to", "kg"…) — `gia_quy_doi` quy về gốc NÀY, nên hai dòng
   *  khác `don_vi_goc` không so ngang được. "" với hàng không phải giấy. */
  don_vi_goc: string;
  /** Cùng họ đơn vị với ĐVT dòng đang mua (query `don_vi`). Chỉ dòng `cung_ho` mới được xếp hạng /
   *  tự gán "rẻ nhất"; không gửi `don_vi` thì máy chủ trả true hết. */
  cung_ho: boolean;
  /** Dòng giá ĐÚNG khổ gửi lên. false = dòng giá khổ 0 · 0 (NCC bán mọi khổ) — xếp sau dòng đúng
   *  khổ cùng họ. */
  dung_kho: boolean;
  /** Tên có dấu của đơn vị NCC bán ("thùng", "cái") để hiển thị; null = trùng mã / không tra được. */
  unit_ten: string | null;
  unit_price: number;
  vat_percent: number;
  /** Giá quy về ĐƠN VỊ GỐC — cột duy nhất so được giữa các NCC. null = không quy đổi được
   *  (xem `ly_do`); dòng đó xếp cuối, đừng xếp hạng nó. */
  gia_quy_doi: number | null;
  gia_quy_doi_vat: number | null;
  dien_giai: string | null;
  ly_do: string | null;
}

export interface SoGiaOut {
  hang_loai: HangLoai;
  hang_id: number;
  hang_ma: string | null;
  hang_ten: string | null;
  don_vi_goc: string | null;
  don_vi_goc_ten: string | null;
  items: SoGiaRow[];
}

export interface SupplierRow {
  id: number;
  name: string;
  tax_code: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  contact_name: string | null;
  supplier_group: string | null;
  payment_terms: string | null;
  /** HẠN MỨC công nợ (VNĐ). `0` = KHÔNG đặt hạn mức ⇒ không bao giờ báo vượt. */
  credit_limit: number;
  /** ĐỊNH MỨC = số NGÀY cho nợ kể từ ngày giao. `0` = trả ngay · `null` = CHƯA ĐẶT hạn (đợt giao
      của NCC này không vào cột Quá hạn). Hai thứ khác nhau, đừng ép null thành 0. */
  credit_days: number | null;
  /** Cách tính hạn trả (16/10/2026, thuộc NCC): `null` = từ ngày hoá đơn · 1–31 = chốt công nợ
   *  hằng tháng ngày đó (31 = cuối tháng). Sửa chỉ áp cho đợt giao ghi từ đó. */
  debt_cutoff_day: number | null;
  status: SupplierStatus;
  /** Tích "Nhận gia công" — hiện trong ô chọn "Nhà gia công" ở Kế hoạch sản xuất. */
  nhan_gia_cong: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
  items: SupplierItemRow[];

  /** SAO ĐÁNH GIÁ — máy tự tính từ phiếu mua hàng, KHÔNG ai chấm tay.
   *
   *  Mốc hẹn là `needed_date` (Ngày cần hàng) của phiếu; giao đủ đúng/sớm hẹn = 5 sao, trễ 1–3
   *  ngày = 4, 4–7 = 3, 8–14 = 2, trên 14 = 1. Đơn chưa giao đủ mà đã quá hẹn thì tính trễ tới
   *  hôm nay. Trung bình toàn bộ lịch sử.
   *
   *  ⚠️ `null` = **Chưa đánh giá** (chưa có đơn nào đủ điều kiện), KHÔNG phải 0 sao. Giao diện
   *  phải hiện chữ "Chưa đánh giá" chứ đừng vẽ 5 ngôi sao rỗng — thang sao thấp nhất là 1, nên
   *  0 không bao giờ là một giá trị hợp lệ. Vẽ 0 là vu oan cho NCC mới. */
  rating: number | null;
  /** Số đơn ĐƯỢC TÍNH vào trung bình — không phải tổng số đơn của NCC. */
  rating_count: number;
  on_time_count: number;
  late_count: number;
  /** Trễ trung bình tính TRÊN CÁC ĐƠN TRỄ. `null` = chưa trễ đơn nào. */
  avg_late_days: number | null;
}

export interface SupplierItemCatalogRow {
  item_name: string;
  unit: string;
  supplier_count: number;
  min_unit_price: number;
}

/** Một mặt hàng ĐỌC ĐƯỢC từ file Excel — chưa vào DB, mới chỉ nạp vào form. */
export interface SupplierItemImportRow {
  item_name: string;
  kho_rong: number;
  kho_dai: number;
  unit: string;
  unit_price: number;
  vat_percent: number;
  note: string | null;
}

export interface SupplierItemImportError {
  /** Số dòng trong file EXCEL (đã tính dòng tiêu đề) — mở file là nhảy đúng chỗ. */
  row: number;
  message: string;
}

/** Dòng hỏng KHÔNG huỷ dòng lành ⇒ `items` và `errors` cùng có mặt. */
export interface SupplierItemImportOut {
  items: SupplierItemImportRow[];
  errors: SupplierItemImportError[];
  total_rows: number;
}

export interface SupplierInput {
  name: string;
  tax_code: string;
  phone: string;
  email: string;
  address: string;
  contact_name: string;
  supplier_group: string;
  payment_terms?: string | null;
  /** Hạn mức công nợ (VNĐ) — `0` = chưa đặt hạn mức. */
  credit_limit?: number;
  /** Số ngày cho nợ — `0` = trả ngay · `null` = chưa đặt hạn. */
  credit_days?: number | null;
  /** Ngày chốt công nợ hằng tháng 1–31 (31 = cuối tháng) · `null` = tính từ ngày hoá đơn. */
  debt_cutoff_day?: number | null;
  status?: SupplierStatus;
  /** Tích "Nhận gia công" — hiện trong ô chọn "Nhà gia công" ở Kế hoạch sản xuất. */
  nhan_gia_cong?: boolean;
  note?: string | null;
  items?: SupplierItemInput[];
}

/** Ô chọn Nhà gia công — NCC đang hoạt động có tích "Nhận gia công" (spec gia công ngoài §7). */
export interface NhaGiaCong { id: number; ten: string }

/** Một dòng "Gia công chờ chi" — lần đã chốt, chưa có phiếu chi còn hiệu lực. KHÔNG có đơn giá /
 *  tiền (chủ chốt 07/10/2026): kế toán gõ tiền ở phiếu chi theo hoá đơn nhà gia công. */
export interface GiaCongChoChi {
  gia_cong_ngoai_id: number;
  /** `null` với lần của bước chung bài ghép — khi đó `bai_ghep_id` có giá trị. */
  lsx_id: number | null;
  lsx_ma: string;
  bai_ghep_id?: number | null;
  /** Nhãn nguồn: mã lệnh, hoặc "BG-.. (LSX-A, LSX-B)" cho lần của bài ghép. */
  nhan_nguon?: string;
  ten_viec: string;
  nha_cung_cap_id: number | null;
  nha_cung_cap_ten: string;
  sl_cuoi: number;
  don_vi: string | null;
  chot_luc: string | null;
  chot_boi_ten: string | null;
}

/** Một dòng tab "Mua hàng chờ chi" (màn Phiếu chi, docs/prd-mua-hang-cho-chi-o-phieu-chi.md): ĐƠN đã
 *  duyệt còn cọc chưa chi hoặc còn đợt giao còn nợ. `don` là nguyên dòng đơn — form lập phiếu chi dùng
 *  thẳng; từng đợt còn nợ đọc ở `don.deliveries[].con_no`. */
export interface MuaHangChoChi {
  don: PurchaseRequestRow;
  /** Cọc khai lúc gửi duyệt còn chưa chi (không quá phần giá trị đơn còn chưa trả). */
  coc_can_chi: number;
  so_dot_no: number;
  /** Tổng nợ các đợt còn nợ (đã trừ phần cọc bù vào đợt). */
  no_dot: number;
  tong_can_chi: number;
  /** Hạn trả gần nhất trong các đợt còn nợ — `null` = chưa có đợt nào (chỉ còn cọc). */
  han_gan_nhat: string | null;
  qua_han: boolean;
}

export type GiaCongTrangThai = "cho_mang_di" | "dang_o_ngoai" | "dang_gia_cong" | "da_xong" | "da_huy";
export type GiaCongNoiVe = "xuong" | "kho" | "khach";

/** MỘT lần gia công ngoài (spec 2026-09-26). Tiền (`don_gia`, `thanh_tien`) là `null` khi người
 *  xem không có quyền xem tiền — máy chủ gác, màn ẨN hẳn đoạn tiền (không hiện "—"). */
export interface GiaCongNgoaiLan {
  id: number;
  /** Lần của LỆNH có `lsx_id`; lần của BƯỚC CHUNG bài ghép có `bai_ghep_id` (spec 2026-09-27). */
  lsx_id: number | null;
  lsx_ma: string;
  bai_ghep_id?: number | null;
  bai_ghep_ma?: string | null;
  lenh?: { id: number; ma: string; so_con: number }[];
  /** Nhãn nguồn: mã lệnh, hoặc "BG-.. (LSX-A, LSX-B)". */
  nhan_nguon?: string;
  /** Bảng chia số chốt về từng lệnh — rỗng khi lần không toả. Bước nhận nhận
   *  số chốt × `he_so_nhan` (tính bằng `don_vi`): bước ăn tờ ghép thì 1, ăn con thì = số con/tờ. */
  chia_theo_lenh?: { lsx_id: number; lsx_ma: string; so_con: number; he_so_nhan?: number | null;
                     don_vi: string | null; buoc_nhan: string | null }[];
  /** Không thao tác được ở đây: lần bài ghép trên màn lệnh, hoặc thiếu phạm vi một lệnh. */
  chi_xem?: boolean;
  kieu: "mot_phan" | "tron_goi";
  trang_thai: GiaCongTrangThai;
  nha_cung_cap_id: number;
  nha_cung_cap_ten: string;
  /** Đọc sống từ danh mục Nhà cung cấp — null = NCC chưa khai số. */
  nha_cung_cap_sdt?: string | null;
  /** Mốc giao việc: trọn gói = lúc đặt, một phần = lúc phát hành gom ra lần. */
  tao_boi_ten?: string | null;
  tao_luc?: string | null;
  ten_viec: string;
  don_vi: string | null;
  sl_dat: number | null;
  xuong_cap_giay: boolean;
  don_vi_gui: string | null;
  sl_cho_mang_di: number;
  co_buoc_truoc: boolean;
  mang_di_boi_ten: string | null;
  mang_di_luc: string | null;
  sl_gui: number | null;
  /** Số điền sẵn khi chốt, máy chủ đã quy về đơn vị của lần (vd tờ gửi đi → con nhận về). */
  sl_goi_y_chot?: number | null;
  chot_boi_ten: string | null;
  chot_luc: string | null;
  sl_cuoi: number | null;
  noi_ve: GiaCongNoiVe | null;
  noi_ve_hop_le: GiaCongNoiVe[];
  chang_sau: { id: number; ten: string }[];
  huy_boi_ten: string | null;
  huy_luc: string | null;
  ly_do_huy: string | null;
  phieu_chi: { id: number; code: string } | null;
  /** Máy chủ sẽ từ chối "Mở lại" vì lý do này — null = mở lại được. */
  ly_do_khong_mo_lai?: string | null;
  /** Máy chủ sẽ từ chối "Nhận hàng về" vì lý do này (trọn gói xưởng cấp giấy mà kho chưa xuất
   *  giấy) — null = nhận về được. */
  ly_do_khong_nhan_ve?: string | null;
  /** Đề nghị xuất giấy còn sống + khổ / số tờ của dòng giấy (ô Giấy). */
  xuat_giay: {
    id: number; ma: string; trang_thai: string;
    kho_rong?: number; kho_dai?: number; so_to?: number | null; don_vi?: string | null;
    /** Phiếu xuất kho lập theo đề nghị (bỏ phiếu huỷ) — kho xuất nhiều đợt thì nhiều phiếu. */
    phieu?: { id: number; ma: string; ngay: string; trang_thai: string }[];
  } | null;
  /** Phần "Chọn giấy" — chỉ có khi trọn gói xưởng cấp giấy chưa gửi đề nghị xuất. */
  cap_giay?: GiaCongCapGiay | null;
  lich_su: { luc: string | null; ai: string; viec: string; chi_tiet: string }[];
  version: number;
}

export interface GiaCongCapGiayKho {
  kho_rong: number;
  kho_dai: number;
  /** Tồn tờ khả dụng của khổ này (đơn vị = `GiaCongCapGiay.don_vi`). */
  ton: number;
  dung_de_xuat: boolean;
}
export interface GiaCongCapGiay {
  giay_id: number | null;
  giay_ma: string | null;
  giay_ten: string | null;
  /** Mã đơn vị tờ nguyên — in qua `nhanDonVi`. */
  don_vi: string;
  /** Khổ + số tờ đề xuất lấy từ đâu: "phiếu tính giá" | "lệnh". */
  nguon: string;
  de_xuat: { kho_rong: number; kho_dai: number; so_to: number | null } | null;
  kho: GiaCongCapGiayKho[];
  /** Không chọn được giấy (lệnh chưa chọn loại giấy…). */
  ly_do: string | null;
}

export interface SupplierListOut {
  items: SupplierRow[];
  total: number;
  page: number;
  size: number;
}

/** Đếm toàn danh mục NCC (máy chủ) — thanh số + dải lọc nhóm của màn Nhà cung cấp. */
export interface SupplierTongQuan {
  tong: number;
  dang_hop_tac: number;
  tam_ngung: number;
  nhom: { supplier_group: string; so_ncc: number }[];
}

export type PurchaseRequestStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "purchased"
  /** Có ≥1 đợt giao nhưng tổng thực nhận CHƯA đủ số đặt — trạng thái SUY RA từ đợt giao. */
  | "partially_received"
  | "received"
  | "cancelled";

export type DepartmentPurchaseRequestStatus =
  | "open"
  | "pending_approval"
  | "in_purchase"
  | "done"
  | "cancelled";

export type DepartmentPurchaseWorkflowStatus =
  | DepartmentPurchaseRequestStatus
  | "drafting"
  | "needs_correction"
  /** Có món bị bỏ nhưng CHƯA bỏ hết (mg 0233). Đè lên nhãn tiến độ; tiến độ phần còn lại nằm ở
      `progress_status`. Bỏ hết món thì `status` = `cancelled`, không phải trạng thái này. */
  | "partially_cancelled";

export type DepartmentPurchaseSourceType =
  | "kinh_doanh"
  | "kho"
  | "san_xuat"
  | "cong_nghe"
  | "gia_cong_ngoai"
  | "khac";

export interface PurchaseRequestLineInput {
  /** Mặt hàng gốc (mg 0174). Gửi lên thì server tôn trọng; bỏ trống thì nó kế thừa từ dòng YCMH. */
  hang_loai?: HangLoai | null;
  hang_id?: number | null;
  item_name: string;
  unit: string;
  quantity: number;
  expected_unit_price: number;
  discount_percent: number;
  vat_percent: number;
  note?: string | null;
  /** Dòng YCMH đẻ ra dòng này — nền cho "tình trạng từng sản phẩm" ở chi tiết yêu cầu. */
  department_request_line_id?: number | null;
  /** Khổ MUA (mm) của giấy — hai cạnh hoặc chỉ rộng. Không gửi ⇒ server chép khổ cần của dòng
   *  YCMH nguồn. */
  kho_rong?: number | null;
  kho_dai?: number | null;
}

// --- Công nợ phải trả ------------------------------------------------------
// KHÔNG có bảng công nợ dưới DB: mọi số dưới đây SUY RA từ phiếu mua + phiếu chi lúc gọi API.

export interface PayableSupplierRow {
  supplier_id: number | null;
  supplier_name: string;
  /** Số đơn CÒN NỢ. Đơn đã trả xong không đếm ở đây. */
  order_count: number;
  /** Nợ đã QUÁ HẠN trả (theo hạn của từng đợt giao) và phần chưa tới hạn. Cộng lại = `total_due`. */
  overdue_amount: number;
  no_han_amount: number;
  /** Rổ tuổi của RIÊNG NCC này (khoá rổ → tiền + số đợt) — máy chủ trả từ lâu, nay màn dùng để đếm
   *  "n khoản" dưới tên. Server cũ thiếu trường này ⇒ coi như rỗng. */
  aging?: Record<string, AgingCell>;
  /** `0` = NCC chưa đặt hạn mức ⇒ không bao giờ báo vượt. */
  credit_limit: number;
  /** `0` = trả ngay · `null` = chưa đặt hạn ⇒ đợt giao của NCC này không vào cột Quá hạn. */
  credit_days: number | null;
  /** Cảnh báo MỀM: chỉ gắn cờ, không chặn lập/duyệt phiếu ở đâu cả (Đ6). */
  vuot_han_muc: boolean;
  vuot_bao_nhieu: number;
  /** Tiền ĐÃ CHI trong kỳ. NCC trả hết vẫn giữ được dòng nhờ số này. */
  paid_in_period: number;
  /** Hàng nhận thêm trong kỳ (PS Có TK 331). Chỉ có số khi gọi CÓ kỳ; không kỳ = 0. */
  mua_trong_ky: number;
  /** Hạn trả gần nhất trong các đợt CÒN NỢ (ISO date), luôn theo hôm nay. null = không đợt nào có hạn. */
  han_gan_nhat: string | null;
  /** Còn nợ, luôn ≥ 0. Kỳ kết thúc hôm nay (hoặc không kỳ) = ảnh chụp hôm nay; kỳ đã qua = dư cuối
   *  kỳ của sổ 331 (dư âm vì ứng trước ⇒ 0). */
  total_due: number;
  /** Bảng đủ cột (06/10/2026): mã + liên hệ của NCC, lần TRẢ gần nhất (cả lịch sử). Máy chủ cũ thiếu. */
  supplier_code?: string | null;
  lien_he_ten?: string | null;
  lien_he_sdt?: string | null;
  tra_gan_nhat_ngay?: string | null;
  tra_gan_nhat_tien?: number;
}

/** Một RỔ TUỔI NỢ. Sáu rổ: chưa tới hạn · trễ 1–7 · 8–15 · 16–30 · 31–60 · >60 ngày.
 *  Mốc do server giữ (`AGING_BUCKETS`) — đừng gõ lại số ngày ở giao diện. */
export interface AgingBucket {
  key: string;
  label: string;
  amount: number;
  count: number;
}

/** Rổ tuổi của MỘT nhà cung cấp / khách hàng — dạng bảng tra theo khoá rổ. */
export interface AgingCell {
  amount: number;
  count: number;
}

/** MỘT dòng của SỔ TỔNG HỢP CÔNG NỢ theo kỳ (docs/prd-bao-cao-cong-no.md §5.1).
 *
 *  ĐỪNG nhầm với `PayablesSummary`/`ReceivablesSummary`: hai kiểu kia là ảnh chụp TẠI HÔM NAY để
 *  đi đòi nợ. Kiểu này là sổ theo kỳ — đầu kỳ · phát sinh · cuối kỳ, khoảng ngày tự chọn.
 *
 *  Số ÂM không bao giờ xuất hiện: âm thì server đã đẩy sang cột bên kia (luật sổ Nợ/Có). */
export interface CongNoDong {
  /** `null` = dòng gom các khoản KHÔNG truy được về khách/NCC nào. Không cho bấm vào. */
  doi_tuong_id: number | null;
  /** Mã khách/NCC. `null` = chưa đặt mã ⇒ không đối chiếu mã với MISA được. */
  ma: string | null;
  ten: string;
  /** `131` (phải thu) hoặc `331` (phải trả). */
  tk: string;
  dau_no: number;
  dau_co: number;
  ps_no: number;
  ps_co: number;
  /** Tiền HOÀN trong kỳ, đã nằm trong PS (131 ở PS Nợ, 331 ở PS Có). Giao diện trừ khỏi Bán ra /
   *  Nhận hàng và tính là thu âm / trả âm. */
  hoan: number;
  cuoi_no: number;
  cuoi_co: number;
  /** 6 rổ tuổi của RIÊNG đối tượng này, tính trên dư cuối kỳ TẠI `den_ngay`. */
  aging: Record<string, AgingCell>;
}

export interface CongNoTong {
  so_dong: number;
  dau_no: number;
  dau_co: number;
  ps_no: number;
  ps_co: number;
  /** Tiền HOÀN trong kỳ, đã nằm trong PS (131 ở PS Nợ, 331 ở PS Có). Giao diện trừ khỏi Bán ra /
   *  Nhận hàng và tính là thu âm / trả âm. */
  hoan: number;
  cuoi_no: number;
  cuoi_co: number;
}

export interface BaoCaoCongNo {
  tk: string;
  tieu_de: string;
  /** Nhãn hai cột đầu do SERVER nói ("Mã khách hàng" vs "Mã nhà cung cấp") — một component dùng
   *  cho cả hai báo cáo, đừng gõ lại nhãn ở giao diện. */
  nhan_ma: string;
  nhan_ten: string;
  tu_ngay: string;
  den_ngay: string;
  items: CongNoDong[];
  tong: CongNoTong;
  /** Dải rổ tuổi TOÀN MÀN, có nhãn sẵn. Tính TẠI `den_ngay` — KHÁC dải ở màn Công nợ, cái đó
   *  luôn neo vào hôm nay. Đây là lý do báo cáo kỳ cũ in lại vẫn ra đúng con số cũ. */
  aging: AgingBucket[];
  /** Số tiền từng rổ CỘNG trên mọi dòng khớp bộ lọc (mọi trang) — dòng Cộng của lưới. */
  tong_aging: Record<string, number>;
  /** Số đối tượng của từng mục lọc nhanh (`all` · `con_no` · `qua_han` · `tra_truoc`). Đếm sau ô
   *  tìm + lọc tuổi nhưng TRƯỚC chính mục lọc nhanh đang chọn. */
  dem_the: Record<CongNoThe, number>;
  total: number;
  page: number;
  /** 0 = không cắt trang (trả hết). */
  size: number;
}

/** Mục lọc nhanh của sổ tổng hợp công nợ. */
export type CongNoThe = "all" | "con_no" | "qua_han" | "tra_truoc";

/** Một khoản CÒN NỢ tại cuối kỳ — một đợt giao (331) hoặc một hoá đơn (131). Cùng vòng cấn trừ
 *  với cột tuổi nợ của sổ tổng hợp nên cộng các khoản ra đúng tổng các ô tuổi của dòng. */
export interface KhoanConNo {
  so_ct: string;
  ngay: string | null;
  han: string | null;
  con_no: number;
  /** Dương = trễ N ngày; âm = còn N ngày; `null` = không có hạn. */
  tre_ngay: number | null;
  ro: string;
}

export interface KhoanConNoList {
  den_ngay: string;
  items: KhoanConNo[];
  tong: number;
}

/** Một chứng từ trong sổ chi tiết. `no`/`co` là số của CHÍNH chứng từ đó, `luy_ke_*` là số dư
 *  SAU khi ghi nó — đúng khuôn sổ chi tiết công nợ của kế toán. */
export interface SoChiTietDong {
  ngay: string;
  /** Giờ ghi nhận (ISO). Phiếu chi/thu = lúc tiền chạy, còn lại = lúc nhập vào hệ. Ngày nghiệp vụ
   *  không có giờ, nên đây là thứ duy nhất tách được thứ tự các chứng từ cùng ngày. */
  luc: string | null;
  /** `hoa_don` · `phieu_thu` · `dot_giao` · `phieu_chi` · `hoan_tien`. */
  loai: string;
  so_ct: string;
  /** Dòng hoá đơn bán: ký hiệu (đã nằm đầu `so_ct`) và đơn bán của hoá đơn. Dòng đợt giao: ký
   *  hiệu hoá đơn NCC của đợt. */
  ky_hieu?: string | null;
  don_id?: number | null;
  /** Chỉ dòng đợt giao (phải trả): số + ngày hoá đơn NCC (ngày của dòng là ngày nhận hàng) và mã
   *  đơn mua để bấm mở. */
  so_hoa_don?: string | null;
  ngay_hoa_don?: string | null;
  don_ma?: string | null;
  dien_giai: string;
  no: number;
  co: number;
  luy_ke_no: number;
  luy_ke_co: number;
}

/** SỔ CHI TIẾT CÔNG NỢ của MỘT đối tượng (PRD §5.1) — mở khi bấm một dòng ở sổ tổng hợp.
 *
 *  `cuoi_no`/`cuoi_co` LUÔN khớp ô "Dư cuối kỳ" của chính đối tượng đó bên sổ tổng hợp: hai bên
 *  đọc chung một luồng chứng từ ở server, và có test đối chiếu canh. */
export interface SoChiTietCongNo {
  tk: string;
  tieu_de: string;
  doi_tuong_id: number | null;
  ma: string | null;
  ten: string;
  tu_ngay: string;
  den_ngay: string;
  dau_no: number;
  dau_co: number;
  dong: SoChiTietDong[];
  ps_no: number;
  ps_co: number;
  /** Tiền HOÀN trong kỳ, đã nằm trong PS (131 ở PS Nợ, 331 ở PS Có). Giao diện trừ khỏi Bán ra /
   *  Nhận hàng và tính là thu âm / trả âm. */
  hoan: number;
  cuoi_no: number;
  cuoi_co: number;
  /** Tổng số chứng từ trong kỳ — gửi `size` thì `dong` chỉ là một trang (mới nhất lên đầu). */
  so_dong: number;
}

export interface CongNoKyRow {
  tu_ngay: string;
  den_ngay: string;
  ten: string | null;
  /** Khóa TRỌN khoảng — mọi ngày trong kỳ đều đang khóa. */
  da_khoa: boolean;
  /** Khóa MỘT PHẦN. Ba trạng thái chứ không phải hai — xem `CongNoKhoaSoTrangThai`. */
  khoa_mot_phan: boolean;
  /** Kỳ đang chạy (chứa hôm nay) ⇒ `den_ngay` dừng ở hôm nay, không phải cuối tháng. */
  dang_dien_ra: boolean;
  /** Mở lại được không. CHỈ kỳ mới nhất mở được: kỳ chốt sau lấy số dư đầu kỳ từ kỳ này, mở
   *  ngược là số của kỳ sau sai theo mà không có gì báo. */
  co_the_mo: boolean;
  khoa_luc: string | null;
}

/** Trạng thái khóa của MỘT khoảng bất kỳ.
 *
 *  Trước 04/09/2026 màn báo cáo tự suy bằng cách dò `congNoKyList` rồi so BẰNG ĐÚNG hai đầu ngày;
 *  kỳ báo cáo 01/09–04/09 không đời nào khớp kỳ tháng 01/09–30/09 nên luôn ra "chưa khóa", bấm
 *  khóa xong không thấy gì đổi. Giờ hỏi thẳng server đúng kỳ đang xem. */
export interface CongNoKhoaSoTrangThai {
  tu_ngay: string;
  den_ngay: string;
  da_khoa: boolean;
  khoa_mot_phan: boolean;
}

export interface CongNoKhoaSoRow {
  id: number;
  tu_ngay: string;
  den_ngay: string;
  hanh_dong: string;
  nguoi_khoa_ten: string | null;
  khoa_luc: string;
  ten: string | null;
}

export interface TheLocCongNo {
  tat_ca: number;
  qua_han: number;
  vuot_han_muc: number;
  /** Chỉ phải thu: số khách còn giữ cọc của đơn đã huỷ. */
  tra_coc?: number;
}

/** Dòng Cộng của bảng công nợ: tổng của MỌI dòng khớp bộ lọc (trước khi cắt trang). Khác số tổng
 *  đầu màn (`total_due`, `aging`…) vốn không theo bộ lọc nâng cao. */
export interface TongLocCongNo {
  so_doi_tac: number;
  /** Phải trả: số đợt còn nợ; phải thu: số hoá đơn còn nợ. */
  so_khoan: number;
  con_no: number;
  /** Khoá như rổ tuổi: chua_toi_han, d1_7, d8_15, d16_30, d31_60, d60_plus. */
  aging: Record<string, number>;
  qua_han: number;
  /** Mua / bán trong kỳ. */
  trong_ky_1: number;
  /** Trả / thu trong kỳ. */
  trong_ky_2: number;
}

export interface PayablesSummary {
  items: PayableSupplierRow[];
  total: number;
  page: number;
  size: number;
  pages: number;
  total_due: number;
  overdue_amount: number;
  paid_in_period: number;
  mua_trong_ky: number;
  vuot_han_muc_count: number;
  /** Số dòng của từng nút đầu thanh lọc — đếm SAU tìm/kỳ/lọc nâng cao/mốc tuổi, TRƯỚC nút đang chọn. */
  the_loc?: TheLocCongNo;
  /** Dòng Cộng theo bộ lọc. null khi gọi `dem_only` / `chi_tong`. */
  tong_loc?: TongLocCongNo | null;
  /** Rổ tuổi TOÀN MÀN. Tổng 5 rổ trễ luôn đúng bằng `overdue_amount`. */
  aging: AgingBucket[];
  period_months: number;
  /** Kỳ đã dùng để tính (ISO date). Không truyền kỳ thì là [hôm nay − 3 tháng, hôm nay]. */
  tu_ngay: string | null;
  den_ngay: string | null;
  as_of: string;
}

/** Một khoản CÒN NỢ — thường là một ĐỢT GIAO chưa trả hết.
 *
 * Phiếu cũ (lập trước 06/08/2026, không theo dõi theo đợt) hiện ở mức PHIẾU: `delivery_id` null,
 * `chua_dat_han` true. Không có hạn trả nên không bao giờ vào cột Quá hạn — vì thế nó phải nổi
 * lên ĐẦU danh sách chứ không được chìm. */
/** Một mặt hàng trong đợt giao — chỉ để bày trong popup "hàng đã nhận" ở Công nợ phải trả. */
export interface PayableDeliveryLineRow {
  item_name: string;
  /** MÃ đơn vị (`cai`); tên hiển thị ("cái") tra qua `tenDonVi()`. */
  unit: string;
  quantity: number;
  /** Đơn giá đã chốt trên phiếu mua (04/09/2026). */
  unit_price: number;
  /** Thành tiền THẬT của dòng trong đợt này — sau chiết khấu/VAT, và KHÔNG tính phần rơi vào
   *  `du`. Không phải `quantity × unit_price`. */
  thanh_tien: number;
  /** Phần giao VƯỢT số đặt, tính 0đ. > 0 = NCC giao nhiều hơn đơn đặt cho dòng này. */
  du: number;
}

export interface PayableHoaDonFile {
  id: number;
  file_name: string;
  file_url: string;
  file_type: string | null;
}

export interface PayableItemRow {
  purchase_request_id: number;
  code: string;
  status: PurchaseRequestStatus;
  /** Hàng của đợt. RỖNG với dòng "cả đơn" — phiếu cũ không theo dõi theo đợt nên không có hàng
   *  nào quy về được; màn hình phải KHÔNG cho bấm mở popup ở dòng đó. */
  lines: PayableDeliveryLineRow[];
  delivery_id: number | null;
  seq_no: number | null;
  delivery_date: string | null;
  due_date: string | null;
  chua_dat_han: boolean;
  overdue_days: number;
  /** Khoá rổ tuổi (vd "d31_60") — CHỈ có khi overdue_days > 0. Server chụp sẵn bằng cùng hàm
   *  dùng cho dải phân tuổi tổng, để một đợt không hiện hai mức khẩn khác nhau ở hai màn. */
  aging_bucket: string | null;
  /** Ký hiệu hoá đơn NCC của đợt — một hoá đơn = ký hiệu + số. */
  invoice_symbol?: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  /** File hoá đơn/biên bản đã đính kèm cho đợt này (04/09/2026). RỖNG = chưa ai upload ảnh —
   *  KHÁC với `invoice_number` trống (số có thể đã ghi tay mà chưa có ảnh). Upload vẫn đi qua
   *  Thu mua lúc ghi đợt giao; ở đây chỉ đọc lại. */
  hoa_don_files: PayableHoaDonFile[];
  amount: number;
  /** CHỈ đếm tiền trả ĐÍCH DANH đợt này — cột này phải khớp sao kê NCC theo từng đợt. */
  paid: number;
  /** Phần CỌC của cả đơn chiếu xuống đợt này (giao trước bù trước). Tách khỏi `paid` vì không ai
   *  trả riêng cho đợt này số đó — nhưng `con_no` đã trừ CẢ HAI. */
  coc_bu: number;
  /** NCC hoàn tiền không gắn đơn cộng nợ lại vào đợt hạn muộn nhất (#36): con_no = amount − paid −
   *  coc_bu + hoan_ncc. */
  hoan_ncc?: number;
  con_no: number;
  /** Đợt đã trả hết — có mặt CHỈ để dò được tiền cọc đi đâu (cọc bù giao-trước-bù-trước nên hay
   *  nuốt trọn đợt sớm). Làm mờ, xếp cuối đơn, không đếm vào rổ tuổi / lời nhắc "chưa đặt hạn". */
  da_tat_toan: boolean;
}

/** Một khoản ĐẶT CỌC / ứng trước cho CẢ ĐƠN — không thuộc đợt giao nào. */
export interface PayableCocRow {
  purchase_request_id: number;
  code: string;
  status: PurchaseRequestStatus;
  amount: number;
  /** Phần cọc đã chiếu xuống các đợt của chính đơn này, và phần còn dôi ra. */
  da_dung: number;
  con_du: number;
}

/** ✅ Một LẦN CHI trong kỳ. Cộng lại đúng bằng cột "Đã trả". */
export interface PayablePaidRow {
  voucher_id: number;
  code: string;
  doc_no: string | null;
  voucher_type: string;
  payment_stage: PaymentStage | null;
  delivery_id: number | null;
  /** Số đợt (1, 2, 3…). null = phiếu đặt cọc, hoặc đơn không theo đợt. */
  delivery_seq_no: number | null;
  purchase_request_id: number;
  purchase_code: string;
  amount: number;
  invoice_number: string | null;
  invoice_date: string | null;
  has_attachment: boolean;
  paid_date: string;
  /** Người LẬP phiếu chi — "ai cho tiền ra" phải đọc được ngay tại dòng. */
  created_by_user_id: number | null;
  created_by_name: string | null;
}

export interface PayablesDetail {
  supplier_id: number;
  supplier_name: string;
  credit_limit: number;
  credit_days: number | null;
  vuot_han_muc: boolean;
  vuot_bao_nhieu: number;
  /** Liên hệ của NCC + tài khoản nhận MẶC ĐỊNH ("{ngân hàng} {số tài khoản}"). */
  lien_he_ten?: string | null;
  lien_he_sdt?: string | null;
  tk_nhan?: string | null;
  /** Từng ĐỢT GIAO còn nợ, đã sắp theo hạn trả — đợt `chua_dat_han` nằm ĐẦU danh sách. */
  items: PayableItemRow[];
  /** Cọc/ứng trước của cả đơn — hiện thành dòng riêng, KHÔNG cộng vào `paid` của đợt nào. */
  coc_chung: PayableCocRow[];
  coc_chung_amount: number;
  /** Một trang lần trả (khi gọi kèm `paid_page`/`paid_size`), mới nhất trước. */
  paid: PayablePaidRow[];
  /** Tổng số lần trả trong phạm vi — không theo trang. */
  paid_total?: number;
  period_months: number;
  /** true = rổ "đã chi" đang hiện TOÀN BỘ lịch sử, không còn cắt theo kỳ. */
  all_history: boolean;
  total_due: number;
  overdue_amount: number;
  /** Rổ tuổi của riêng NCC này, dựng từ chính `items`. */
  aging: AgingBucket[];
  paid_in_period: number;
  as_of: string;
}

// --- Công nợ phải thu ------------------------------------------------------
export interface ReceivableCustomerRow {
  customer_id: number | null;
  customer_name: string;
  invoice_count: number;
  invoiced_amount: number;
  received_amount: number;
  total_due: number;
  overdue_amount: number;
  no_han_amount: number;
  credit_limit: number;
  payment_term_days: number | null;
  vuot_han_muc: boolean;
  vuot_bao_nhieu: number;
  /** Rổ tuổi của RIÊNG khách này, tra theo khoá rổ. Khách không nợ vẫn đủ 6 khoá = 0. */
  aging: Record<string, AgingCell>;
  received_in_period: number;
  /** Hoá đơn bán thêm trong kỳ (PS Nợ TK 131). Chỉ có số khi gọi CÓ kỳ; không kỳ = 0. */
  ban_trong_ky: number;
  /** Hạn thu gần nhất trong các hoá đơn CÒN NỢ (ISO date), luôn theo hôm nay. */
  han_gan_nhat: string | null;
  /** Sale phụ trách khách. */
  sale_user_id: number | null;
  /** Bảng đủ cột (06/10/2026): mã khách, liên hệ CHÍNH, tên sale phụ trách, lần THU gần nhất (cả lịch
   *  sử). Máy chủ cũ thiếu. */
  customer_code?: string | null;
  lien_he_ten?: string | null;
  lien_he_sdt?: string | null;
  sale_user_name?: string | null;
  thu_gan_nhat_ngay?: string | null;
  thu_gan_nhat_tien?: number;
  /** Tiền khách đang để ở các đơn (17/10/2026) — không trừ vào hoá đơn đơn khác. `cho_tra_lai` =
   *  phần phải trả lại ngay (đơn huỷ, hoặc đã ghi đủ hoá đơn mà vẫn dư). */
  cho_tra_lai?: number;
  tien_dang_de?: number;
}

export interface ReceivablesSummary {
  items: ReceivableCustomerRow[];
  total: number;
  page: number;
  size: number;
  pages: number;
  total_due: number;
  overdue_amount: number;
  received_in_period: number;
  ban_trong_ky: number;
  vuot_han_muc_count: number;
  /** Số dòng của từng nút đầu thanh lọc — đếm SAU tìm/kỳ/lọc nâng cao/mốc tuổi, TRƯỚC nút đang chọn. */
  the_loc?: TheLocCongNo;
  /** Dòng Cộng theo bộ lọc. null khi gọi `dem_only` / `chi_tong`. */
  tong_loc?: TongLocCongNo | null;
  /** Rổ tuổi TOÀN MÀN. Tổng 5 rổ trễ luôn đúng bằng `overdue_amount`. */
  aging: AgingBucket[];
  period_months: number;
  tu_ngay: string | null;
  den_ngay: string | null;
  as_of: string;
}

/** Một dòng cọc chờ thu — đơn đã chốt, cọc chưa đủ (17/10/2026). */
export interface CocChoThu {
  order_id: number;
  order_code: string;
  customer_id: number | null;
  customer_name: string | null;
  /** Null khi đơn giữ cọc bằng số tiền (`deposit_amount`). */
  deposit_pct: number | null;
  deposit_amount?: number | null;
  can_thu: number;
  da_thu: number;
  con_thieu: number;
  ordered_at: string | null;
}

/** Một dòng hoá đơn chờ thu — còn nợ đã cân theo sổ 131, cùng số màn Công nợ phải thu. */
export interface HoaDonChoThu {
  invoice_id: number;
  invoice_symbol: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  order_id: number;
  order_code: string;
  customer_id: number | null;
  customer_name: string | null;
  amount: number;
  direct_received_amount: number;
  deposit_offset_amount: number;
  /** Tiền đã trả lại khách ngoài đơn, cộng nợ lại vào hoá đơn này: amount + hoan − da_thu = con_no. */
  hoan_khong_don?: number;
  da_thu: number;
  con_no: number;
}

/** Popup chi tiết một khoản chờ thu (17/10/2026, phương án B): hàng của khoản + các lần đã thu. */
export interface ChiTietKhoanThu {
  hang: { ten: string | null; so_luong: number; dvt: string | null; don_gia: number; vat: number; thanh_tien: number }[];
  /** Phiếu gộp: `amount` là phần của khoản này. */
  phieu: { receipt_id: number; code: string; doc_no: string | null; ngay: string; amount: number; gop: boolean }[];
}

export interface DonHangChoThu {
  coc: CocChoThu[];
  hoa_don: HoaDonChoThu[];
}

/** Một dòng "Chờ trả lại khách" — đơn hết chỗ ghi hoá đơn (ghi đủ / đã huỷ) mà tiền khách còn dư. */
export interface TraLaiKhachChoChi {
  order_id: number;
  order_code: string;
  don_huy: boolean;
  customer_id: number | null;
  customer_name: string | null;
  /** Số các hoá đơn đã huỷ mà khách đã trả tiền — nguồn của khoản dư. */
  hoa_don_huy: string[];
  da_tra_lai: number;
  con_lai: number;
}

/** Một dòng "Chờ chi chiết khấu / kê" (20/10/2026) — một khoản (hóa đơn, loại) đã thu đủ còn phải chi. */
export interface CkKeChoChi {
  sales_invoice_id: number;
  invoice_symbol: string | null;
  invoice_number: string;
  invoice_date: string;
  order_id: number;
  order_code: string;
  customer_id: number | null;
  customer_name: string;
  loai: "chiet_khau" | "ke_gia";
  /** Tiền CK / kê của hóa đơn (trước VAT); `thue_tndn` chỉ có ở kê. */
  tien: number;
  thue_tndn: number;
  phai_chi: number;
  da_chi: number;
  con: number;
}

/** MỘT phiếu chi trả chiết khấu HOẶC kê của nhiều hóa đơn cùng khách. CK: người nhận máy khoá theo khách. */
export interface PhieuChiCkKeInput extends PaymentVoucherAccountsInput {
  loai: "chiet_khau" | "ke_gia";
  dong: { sales_invoice_id: number; amount: number }[];
  voucher_type: PaymentVoucherType;
  voucher_date: string;
  content?: string | null;
  company_bank_account_id?: number | null;
  cash_recipient_name?: string | null;
  cash_recipient_address?: string | null;
  cash_recipient_identity?: string | null;
  beneficiary_account_holder?: string | null;
  beneficiary_account_number?: string | null;
  beneficiary_bank_name?: string | null;
  beneficiary_bank_branch?: string | null;
  bank_fee_bearer?: "payer" | "beneficiary" | "shared" | null;
  note?: string | null;
}

export interface ReceivableItemRow {
  invoice_id: number;
  invoice_symbol: string | null;
  invoice_number: string;
  invoice_date: string;
  order_id: number;
  order_code: string;
  customer_id: number | null;
  customer_name: string;
  due_date: string | null;
  chua_dat_han: boolean;
  overdue_days: number;
  /** Khoá rổ tuổi — CHỈ có khi `overdue_days > 0`. Server chụp sẵn bằng cùng hàm dùng cho dải
   *  tổng, để một hoá đơn không hiện hai mức khẩn khác nhau ở hai màn. */
  aging_bucket: string | null;
  amount: number;
  direct_received_amount: number;
  deposit_offset_amount: number;
  received_amount: number;
  remaining_amount: number;
  /** Tiền trả lại khách không gắn đơn cộng nợ lại vào hoá đơn này (17/10/2026). */
  hoan_khong_don?: number;
}

export interface ReceivableReceiptRow {
  receipt_id: number;
  code: string;
  doc_no: string | null;
  order_id: number | null;
  order_code: string | null;
  source_type: PaymentReceiptSource;
  sales_invoice_id: number | null;
  sales_invoice_number: string | null;
  applied_to: "deposit_offset" | "sales_invoice";
  receipt_method: PaymentVoucherType;
  amount: number;
  receipt_date: string;
  payer_name: string;
  bank_reference: string | null;
  created_by_name: string | null;
  /** Phiếu gộp: `amount` là phần của dòng này, `receipt_amount` là cả phiếu, `so_dong` số khoản. */
  receipt_amount?: number | null;
  so_dong?: number;
}

export interface SalesInvoiceInput {
  order_id: number;
  invoice_symbol: string;
  invoice_number: string;
  invoice_date: string;
  /** Lượt giao khách đã nhận mà hóa đơn lập cho — máy chủ bắt buộc (mg 0402). */
  delivery_trip_id: number;
  /** Bỏ trống = toàn bộ hàng đã giao của lượt chưa ghi hóa đơn. */
  amount_vnd?: number | null;
}

export interface SalesInvoiceRow {
  id: number;
  order_id: number;
  order_code: string;
  customer_id: number | null;
  customer_name: string;
  invoice_symbol: string | null;
  invoice_number: string;
  invoice_date: string;
  amount_vnd: number;
  payment_term_days_snapshot: number | null;
  due_date: string | null;
  status: "issued" | "cancelled";
  direct_received_amount: number;
  deposit_offset_amount: number;
  received_amount: number;
  remaining_amount: number;
  /** Tiền trả lại khách không gắn đơn cộng nợ lại vào hoá đơn này (17/10/2026). */
  hoan_khong_don?: number;
  created_by_user_id: number | null;
  created_by_name: string | null;
  created_at: string;
  cancelled_by_user_id: number | null;
  cancelled_by_name: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  delivery_trip_id?: number | null;
  /** Mã lượt giao của hóa đơn; null với hóa đơn ghi trước khi gắn lượt. */
  luot_giao_ma?: string | null;
  /** Chiết khấu / kê của hóa đơn (20/10/2026) — trước VAT; kê chi lại sau khi trừ thuế TNDN. */
  chiet_khau?: number;
  ke_gia?: number;
  ke_thue_tndn_pct?: number | null;
  ke_thue_tndn?: number;
  ck_da_chi?: number;
  ke_da_chi?: number;
}

/** Một lượt khách đã nhận hàng, giá trị gồm VAT — trần ghi hóa đơn của lượt. */
export interface LuotGiaoHoaDon {
  trip_id: number;
  ma: string;
  ngay_giao: string | null;
  gia_tri: number;
  da_ghi: number;
  con_ghi: number;
}

export interface SalesInvoiceListOut {
  order_id: number;
  order_code: string;
  order_total: number;
  invoiced_amount: number;
  uninvoiced_amount: number;
  deposit_received: number;
  /** Số ngày công nợ HIỆN TẠI của khách — null = khách chưa đặt, hoá đơn sẽ không có hạn trả. */
  payment_term_days?: number | null;
  /** Ký hiệu hoá đơn bán ghi gần nhất, để điền sẵn. */
  last_invoice_symbol?: string | null;
  /** Giá trị hàng khách đã nhận, gồm VAT. */
  delivered_amount?: number;
  /** Đã giao trừ đã ghi hóa đơn — trần ghi hóa đơn của cả đơn. */
  invoiceable_amount?: number;
  /** Tiền khách đưa dư còn phải trả lại — cùng số với hàng Chờ trả lại khách ở Phiếu chi. */
  cho_tra_lai?: number;
  luot_giao?: LuotGiaoHoaDon[];
  /** Phiếu thu ĐÃ THU gắn thẳng vào hoá đơn của đơn (không gồm cọc). */
  phieu_thu?: {
    id: number; code: string; doc_no: string | null; invoice_id: number; amount: number; receipt_date: string;
    /** Phiếu gộp nhiều chứng từ — `amount` là phần của hoá đơn này. */
    gop?: boolean;
  }[];
  /** Phiếu thu của hoá đơn ĐÃ HUỶ — tiền về quỹ của đơn, trừ vào hoá đơn khác như cọc (17/10/2026). */
  phieu_thu_hd_huy?: { id: number; code: string; doc_no: string | null; invoice_id: number; amount: number; receipt_date: string }[];
  items: SalesInvoiceRow[];
}

export interface ReceivablesDetail {
  customer_id: number;
  customer_name: string;
  credit_limit: number;
  payment_term_days: number | null;
  vuot_han_muc: boolean;
  vuot_bao_nhieu: number;
  /** Liên hệ chính của khách + tên sale phụ trách. */
  lien_he_ten?: string | null;
  lien_he_sdt?: string | null;
  phu_trach?: string | null;
  items: ReceivableItemRow[];
  paid: ReceivableReceiptRow[];
  /** Tổng số lần thu trong phạm vi — `paid` có thể chỉ là các trang đã tải (`paid_page`/`paid_size`). */
  paid_total?: number;
  period_months: number;
  all_history: boolean;
  total_due: number;
  overdue_amount: number;
  /** Rổ tuổi của riêng khách này, dựng từ chính `items`. */
  aging: AgingBucket[];
  received_in_period: number;
  as_of: string;
  /** Tiền khách đang để ở từng đơn — đơn còn phải trả lại có nút trả lại gắn đúng đơn. */
  tien_dang_de?: TienDangDe[];
}

export interface TienDangDe {
  order_id: number;
  order_code: string;
  /** Tiền khách đã đưa cho đơn: cọc + tiền đã thu của hoá đơn đã huỷ. */
  da_nhan: number;
  da_tra_lai?: number;
  da_tru?: number;
  /** Còn để ở đơn, chưa trừ vào hoá đơn nào. */
  dang_de: number;
  /** Phần phải trả lại ngay; 0 = còn chờ trừ vào hoá đơn ghi sau. */
  con_lai: number;
  tinh_trang: "don_huy" | "ghi_du" | "cho_tru" | string;
}

/** Dòng hàng ĐÃ GÁN nhà cung cấp — chỉ dùng cho đường tạo cả mẻ. */
export interface PurchaseRequestBatchLineInput extends PurchaseRequestLineInput {
  supplier_id: number;
}

export interface PurchaseRequestBatchInput {
  source_request_ids: number[];
  /** Ô GỘP "Nội dung / mục đích" (07/08/2026). `purpose`/`note` là đường CŨ, server còn nối lại
   *  để client chưa cập nhật không gãy — giao diện mới chỉ gửi `content`. */
  content: string;
  purpose?: string | null;
  needed_date: string;
  expected_receipt_date?: string | null;
  note?: string | null;
  lines: PurchaseRequestBatchLineInput[];
}

export interface DepartmentPurchaseRequestLineInput {
  /** MẶT HÀNG GỐC của dòng — chọn từ danh mục Giấy + Vật tư khác, KHÔNG gõ tay. Thiếu cặp này
   *  thì phiếu mua sinh ra sau đó phải ghép bằng tên, mà ghép trượt thì im lặng sai. */
  hang_loai?: HangLoai | null;
  hang_id?: number | null;
  item_name: string;
  unit: string;
  quantity: number;
  note?: string | null;
  /** Khổ CẦN (mm) của giấy tờ; vật tư khác 0 · 0 (server ép). */
  kho_rong?: number;
  kho_dai?: number;
  /** UI-only (KHÔNG gửi API): dòng lấy từ mặt hàng Kho đã có → khoá Tên + ĐVT, bỏ qua canh danh
   *  mục NCC. Payload gửi đi pick field tường minh nên cờ này không lọt lên backend. */
  locked?: boolean;
}

/** Loại mua của yêu cầu (08/10/2026). `cho_lsx` chỉ sinh từ Kế hoạch vật tư — máy chủ chốt. */
export type LoaiMua = "theo_yeu_cau" | "cho_lsx" | "mua_ton";

/** Một lệnh (LSX hoặc bài ghép) mà món / dòng đơn này mua cho. `so_luong` = số đề nghị cho lệnh
 *  đó (đơn vị gốc), null với liên kết cũ. */
export interface MuaChoLenh {
  loai: "lsx" | "bai";
  id: number;
  ma: string;
  so_luong: number | null;
}

export interface DepartmentPurchaseRequestInput {
  source_type?: DepartmentPurchaseSourceType | null;
  /** Bỏ trống = giữ loại cũ (sửa) / Theo yêu cầu (tạo). Có `nguon_lenh` thì máy chủ ép `cho_lsx`. */
  loai_mua?: LoaiMua | null;
  related_document_type?: string | null;
  related_document_code?: string | null;
  /** Ô GỘP "Nội dung / mục đích" — xem `PurchaseRequestBatchInput.content`. */
  content: string;
  purpose?: string | null;
  needed_date: string;
  note?: string | null;
  lines: DepartmentPurchaseRequestLineInput[];
  /** Chỉ lúc TẠO (từ Kế hoạch vật tư): yêu cầu này mua cho lệnh/bài nào. Server lưu lại để "Ngày
   *  cần" của lệnh đọc ngược từ `needed_date` — sửa phiếu sau đó không đụng tới. */
  nguon_lenh?: CanDoiKhoaDong[];
}

export interface PurchaseRequestInput {
  supplier_id: number | null;
  source_request_ids: number[];
  /** Ô GỘP "Nội dung / mục đích" — xem `PurchaseRequestBatchInput.content`. */
  content: string;
  purpose?: string | null;
  needed_date: string;
  expected_receipt_date?: string | null;
  note?: string | null;
  lines: PurchaseRequestLineInput[];
}

/** Khai số thực nhận cho một dòng. `null` = xoá khai báo, quay về "nhận đủ". */
export interface ReceivedLineInput {
  line_id: number;
  received_quantity: number | null;
}

export interface PurchaseRequestLineOut {
  id: number;
  item_name: string;
  unit: string;
  quantity: number;
  /** `null` = chưa khai lúc nhận hàng ⇒ hiểu là nhận đủ `quantity`. */
  received_quantity: number | null;
  expected_unit_price: number;
  discount_percent: number;
  discount_amount: number;
  vat_percent: number;
  vat_amount: number;
  line_total: number;
  note: string | null;
  /** Dòng YCMH đẻ ra dòng này (mg 0174b) — form SỬA cần đọc lại để gửi đúng liên kết. */
  department_request_line_id: number | null;
  /** Liên kết mặt hàng gốc (mg 0174) — Nhập kho từ đợt giao auto-điền vật tư. Null = chỉ tên chữ. */
  hang_loai: HangLoai | null;
  hang_id: number | null;
  hang_ma: string | null;
  hang_ten: string | null;
  /** Khổ MUA (mm) — giấy tờ; vật tư khác 0 · 0. */
  kho_rong: number;
  kho_dai: number;
  /** Loại mua + mã của yêu cầu dòng này lập từ; null = dòng không nối yêu cầu. */
  loai_mua: LoaiMua | null;
  yeu_cau_ma: string | null;
  mua_cho: MuaChoLenh[];
}

/** Một dòng yêu cầu đã vào phiếu nào, của NCC nào, tới đâu rồi. */
export interface LineFulfilment {
  purchase_request_id: number;
  purchase_code: string;
  purchase_status: PurchaseRequestStatus;
  supplier_name: string | null;
  ordered_quantity: number;
  ordered_unit: string;
  /** null = chưa khai lúc nhận hàng ⇒ hiểu là nhận đủ `ordered_quantity`. */
  received_quantity: number | null;
}

export interface DepartmentPurchaseRequestLineOut {
  id: number;
  hang_loai: HangLoai | null;
  hang_id: number | null;
  /** Khổ CẦN (mm) — giấy tờ; vật tư khác 0 · 0. */
  kho_rong: number;
  kho_dai: number;
  item_name: string;
  unit: string;
  quantity: number;
  expected_unit_price: number;
  line_total: number;
  note: string | null;
  /** null = dòng CHƯA vào phiếu nào, HOẶC phiếu lập trước 05/08/2026 (chưa có nối dòng ↔ dòng).
      Hai ca đó phải hiện khác nhau — xem `DepartmentPurchaseRequestRow.purchase_requests`. */
  fulfilment: LineFulfilment | null;
  /** Khác null = MÓN NÀY đã bị bỏ khỏi yêu cầu (mg 0233). Vẫn hiện trong danh sách, gạch ngang
      kèm lý do — xoá khỏi màn là người xem tưởng mình nhớ nhầm. */
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  cancel_reason: string | null;
  /** Luật "bỏ được không" do MÁY CHỦ chốt. false + `cancel_block_reason` ⇒ vẫn bày nút, khoá lại
      và in đúng câu đó (đừng ẩn nút — khoá và nói lý do). Chỉ nói về tình trạng MÓN; quyền của
      người đang xem thì màn hình tự AND thêm. */
  can_cancel: boolean;
  cancel_block_reason: string | null;
  mua_cho: MuaChoLenh[];
}

/** Một lần đổi trạng thái của YCMH/PMH. */
export interface StatusHistoryRow {
  id: number;
  /** null = dòng ĐẦU TIÊN (lúc phiếu sinh ra), chưa có trạng thái trước đó. */
  from_status: string | null;
  to_status: string;
  /** `may` = hệ TỰ suy ra (vd. giao đủ hàng ⇒ "đã nhận"), lúc đó không có người đứng tên. */
  source: "nguoi" | "may";
  changed_by_name: string | null;
  reason: string | null;
  created_at: string;
}

/** Một mốc trong lịch sử Đơn mua hàng: đổi trạng thái hoặc thao tác trên một đợt giao. */
export interface PurchaseActivityRow {
  id: string;
  event_type: "status" | "delivery_created" | "delivery_updated" | "delivery_deleted" | "invoice_assigned";
  title: string;
  detail: string | null;
  actor_name: string | null;
  source: "nguoi" | "may" | null;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  created_at: string;
}

export interface DepartmentRequestPurchaseRow {
  id: number;
  code: string;
  status: PurchaseRequestStatus;
  supplier_name: string | null;
}

export interface DepartmentPurchaseRequestRow {
  id: number;
  code: string;
  status: DepartmentPurchaseRequestStatus;
  workflow_status: DepartmentPurchaseWorkflowStatus;
  /** Nhãn TIẾN ĐỘ thuần, không bị "Huỷ một phần" che — in thành dòng chữ nhỏ dưới huy hiệu. */
  progress_status: DepartmentPurchaseWorkflowStatus;
  cancelled_line_count: number;
  active_line_count: number;
  source_type: DepartmentPurchaseSourceType;
  requesting_department_id: number | null;
  requesting_department_name: string | null;
  requested_by_user_id: number | null;
  requested_by_name: string | null;
  related_document_type: string | null;
  related_document_code: string | null;
  /** Ô GỘP "Nội dung / mục đích". `purpose`/`note` giữ lại cho phiếu CŨ, đừng hiện thêm. */
  content: string | null;
  purpose: string;
  needed_date: string;
  note: string | null;
  /** Lý do TỪ CHỐI / HUỶ — tách khỏi nội dung để lý do của người duyệt không đè lời người khai. */
  reject_reason: string | null;
  status_history: StatusHistoryRow[];
  created_at: string;
  updated_at: string;
  total_estimate: number;
  lines: DepartmentPurchaseRequestLineOut[];
  /** Phiếu mua sinh ra từ yêu cầu này — luôn có, kể cả khi `fulfilment` theo dòng còn rỗng. */
  purchase_requests: DepartmentRequestPurchaseRow[];
  loai_mua: LoaiMua;
  /** Gộp lệnh của mọi món còn sống. */
  mua_cho: MuaChoLenh[];
}

export interface DepartmentPurchaseRequestListOut {
  items: DepartmentPurchaseRequestRow[];
  total: number;
  page: number;
  size: number;
  /** Số yêu cầu theo trạng thái hiển thị (`workflow_status`) sau lọc, trước tab + `tat_ca`. */
  dem_theo_tab?: Record<string, number> | null;
}

export interface PurchaseRequestSourceOut {
  id: number;
  department_request_id: number;
  code: string;
  status: DepartmentPurchaseRequestStatus | null;
  source_type: DepartmentPurchaseSourceType | null;
  loai_mua: LoaiMua | null;
  /** Ô GỘP "Nội dung / mục đích" của YCMH. `purpose` là bản CẮT 500 ký tự, chỉ dùng cho phiếu cũ. */
  content: string | null;
  purpose: string | null;
  needed_date: string | null;
  requesting_department_name: string | null;
  requested_by_name: string | null;
}

/** Một dòng hàng của MỘT đợt giao. Cố ý KHÔNG có cột tiền: tiền của đợt suy từ đơn giá đã chốt
 *  trên phiếu mua, mở ô tiền ở đây là đẻ nguồn sự thật thứ hai. */
export interface PurchaseDeliveryLineRow {
  id: number;
  purchase_request_line_id: number;
  item_name: string;
  unit: string;
  /** SL THỰC NHẬN của đợt. Từ 28/08/2026 ĐƯỢC PHÉP vượt số đặt (NCC giao thêm, giá giữ nguyên). */
  quantity: number;
  /** Phần của `quantity` có sinh tiền. Server chia LUỸ KẾ theo thứ tự đợt, lấp phần tính tiền
   *  trước — xem `phan_bo_du_dot` bên backend. */
  quantity_tinh_tien: number;
  /** Phần DƯ, giá 0đ. `quantity_tinh_tien + quantity_du === quantity`.
   *  PHẢI hiện ra chứ đừng chỉ hiện tổng: hệ không biết phần dư có thật là hàng tặng hay không,
   *  nên phải để người đọc bắt được ca NCC thực ra CÓ tính tiền phần dư. */
  quantity_du: number;
  /** Đơn giá chốt trên dòng đơn (chưa CK/VAT). */
  don_gia: number;
  /** Thành tiền phần TÍNH TIỀN của dòng (đã CK/VAT) — đúng số máy chủ cộng vào `amount` của đợt. */
  thanh_tien: number;
  /** KHỔ THỰC NHẬN (giấy tờ): khổ ghi ở đợt, không ghi thì khổ đặt. 0 · 0 với hàng khác. */
  kho_rong: number;
  kho_dai: number;
  /** NCC giao khác khổ đặt — hàng vào tồn theo khổ nhận. */
  khac_kho_dat: boolean;
  note: string | null;
}

export interface PurchaseDeliveryRow {
  id: number;
  /** Đợt 1, 2, 3… trong phạm vi PHIẾU MUA — không phải dãy số toàn hệ. */
  seq_no: number;
  /** Liên thông Kho: đợt đã sinh yêu cầu NHẬP (chưa hủy) chưa → nút "Nhập kho" đổi "Đã nhập kho". */
  da_nhap_kho: boolean;
  stock_request_id: number | null;
  stock_request_ma: string | null;
  /** Kho đã lập phiếu cho yêu cầu nhập của đợt ⇒ khoá Sửa / Xoá đợt (20/10/2026). */
  kho_da_lap_phieu: boolean;
  /** Nấc kho (11/10/2026): chưa gửi / kho chưa nhập xong / yêu cầu nhập Hoàn tất. */
  kho: NacKho;
  delivery_date: string;
  due_date: string | null;
  /** true = NCC chưa khai số ngày cho nợ ⇒ đợt này KHÔNG BAO GIỜ vào cột Quá hạn. Màn hình phải
      đẩy nó lên đầu kèm badge, không để chìm — im lặng ở đây là một món nợ không ai canh. */
  chua_dat_han: boolean;
  /** Ký hiệu hoá đơn NCC. NHIỀU đợt cùng ký hiệu + số = cùng MỘT hoá đơn. */
  invoice_symbol?: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  note: string | null;
  /** Thành tiền của đợt — MÁY TÍNH từ số lượng × đơn giá/CK/VAT đã chốt trên phiếu.
   *  Không ai gõ tay (chủ chốt 07/08/2026, đảo lại quyết định 06/08). */
  amount: number;
  /** Tiền trả ĐÍCH DANH đợt này. */
  paid_amount: number;
  /** Cọc của cả đơn chiếu xuống đợt này. */
  coc_bu: number;
  /** Còn nợ của RIÊNG đợt = amount − paid_amount − coc_bu. Đây là TRẦN lập phiếu chi cho đợt. */
  con_no: number;
  /** Ai ghi đợt này, lúc nào — đợt giao đẻ ra công nợ nên phải truy được người khai. */
  created_by_name: string | null;
  created_at: string | null;
  lines: PurchaseDeliveryLineRow[];
  /** Phiếu chi trả đợt này; phiếu gộp thì `amount` là phần của đợt, `gop` = true. */
  phieu_chi?: PhieuChiCuaKhoan[];
}

export interface PhieuChiCuaKhoan {
  voucher_id?: number;
  code: string;
  doc_no: string | null;
  amount: number;
  voucher_date: string;
  gop?: boolean;
}

/** `hop_dong` = file của cả phiếu mua · các loại còn lại thường gắn vào một đợt giao. */
export type PurchaseAttachmentKind =
  | "hop_dong"
  | "hoa_don"
  | "bien_ban_giao"
  | "khac";

export interface PurchaseAttachmentRow {
  id: number;
  /** null = tài liệu của cả PHIẾU MUA (hợp đồng), khác null = của một đợt giao. */
  delivery_id: number | null;
  kind: PurchaseAttachmentKind;
  file_name: string;
  file_url: string;
  file_type: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
}

export interface PurchaseDeliveryLineInput {
  purchase_request_line_id: number;
  quantity: number;
  /** Khổ thực nhận của giấy tờ; bỏ trống (0 · 0) = đúng khổ đặt. */
  kho_rong?: number;
  kho_dai?: number;
  note?: string | null;
}

export interface PurchaseDeliveryInput {
  delivery_date: string;
  invoice_symbol?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  note?: string | null;
  /** `null`/bỏ trống khi SỬA = giữ nguyên các dòng hàng, chỉ đổi phần đầu đợt. */
  lines?: PurchaseDeliveryLineInput[] | null;
}

/** Gán MỘT hoá đơn cho NHIỀU đợt — ca NCC giao 3 đợt rồi mới xuất một hoá đơn chung. */
export interface PurchaseInvoiceAssignInput {
  delivery_ids: number[];
  invoice_symbol?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
}

export interface PurchaseContractInput {
  contract_number?: string | null;
  /** Cọc DỰ KIẾN — chỉ để đối chiếu, KHÔNG vào công thức công nợ (cọc thật là phiếu chi). */
  deposit_expected: number;
}

/** Hạn mức công nợ của NCC so với nợ hiện tại — CẢNH BÁO MỀM, không chặn gì (Đ6). */
export interface SupplierCredit {
  /** Điều khoản thanh toán (chữ tự do). `null` = NCC chưa khai. */
  payment_terms: string | null;
  /** `0` = KHÔNG đặt hạn mức ⇒ không bao giờ báo vượt. Đừng đọc thành "hạn mức 0đ". */
  credit_limit: number;
  /** `null` = chưa đặt hạn (đợt giao không vào cột Quá hạn) · `0` = TRẢ NGAY. Hai ca khác hẳn
   *  nhau, đừng gộp — xem chú thích ở form khai NCC (`SupplierInfoTab`). */
  credit_days: number | null;
  no_hien_tai: number;
  vuot_han_muc: boolean;
  vuot_bao_nhieu: number;
}

export interface PurchaseRequestRow {
  id: number;
  code: string;
  status: PurchaseRequestStatus;
  supplier_id: number | null;
  supplier_name: string | null;
  /** Các loại mua có trong đơn (đơn gom nhiều yêu cầu có thể trộn) + lệnh gộp của mọi dòng. */
  loai_mua_cac: LoaiMua[];
  mua_cho: MuaChoLenh[];
  /** Ô GỘP "Nội dung / mục đích". `purpose`/`note` giữ lại cho phiếu CŨ, đừng hiện thêm. */
  content: string | null;
  purpose: string | null;
  needed_date: string | null;
  expected_receipt_date: string | null;
  created_by_user_id: number | null;
  created_by_name: string | null;
  submitted_at: string | null;
  approved_by_user_id: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  note: string | null;
  /** Lý do TỪ CHỐI / HUỶ — tách khỏi nội dung để lý do của người duyệt không đè lời người khai. */
  reject_reason: string | null;
  status_history: StatusHistoryRow[];
  /** Lịch sử đầy đủ của đơn, gồm đổi trạng thái và các đợt giao. */
  activity_history: PurchaseActivityRow[];
  created_at: string;
  updated_at: string;
  contract_number: string | null;
  /** Điều khoản trả của NCC (16/10/2026 — đơn không có điều khoản riêng): số ngày cho nợ
   *  (`null` = NCC chưa khai) + ngày chốt hằng tháng (`null` = tính từ ngày hoá đơn). */
  supplier_credit_days: number | null;
  supplier_debt_cutoff_day: number | null;
  /** Cọc DỰ KIẾN — chỉ để nhắc, KHÔNG vào công thức công nợ. */
  deposit_expected: number;
  total_estimate: number;
  /** Giá trị hàng THỰC NHẬN. Bằng `total_estimate` chừng nào chưa ai khai thiếu. */
  received_total: number;
  /** Giá trị hàng ĐÃ VỀ (Σ các đợt giao) — số đẻ ra công nợ. Chưa giao đợt nào thì = 0. */
  gia_tri_da_giao: number;
  paid_amount: number;
  receipt_received_amount: number;
  /** Đã chi RÒNG = phiếu chi đã chi − phiếu thu đã thu. */
  net_paid: number;
  /** = CÔNG NỢ của phiếu, và cũng là trần lập phiếu chi THANH TOÁN. */
  outstanding_amount: number;
  /** Trần lập phiếu ĐẶT CỌC — theo giá trị đơn đặt, vì cọc là chi khi hàng chưa về. */
  tran_dat_coc: number;
  /** Phiếu ĐẶT CỌC đã lập cho đơn này — dùng để CẢNH BÁO khi sắp lập phiếu cọc thứ hai.
   *  Cảnh báo chứ không chặn: ứng thêm là ca có thật, và mỗi lần tiền rời két phải có chứng từ
   *  riêng (sửa phiếu cũ lên số to hơn là làm phiếu không khớp lần chi thật). */
  coc_da_lap: PhieuChiCuaKhoan[];
  coc_da_chi: number;
  /** Cọc đã chi mà CHƯA trừ vào đợt giao nào — đợt ghi tiếp theo được trừ phần này trước. */
  coc_chua_bu: number;
  payment_status: "unpaid" | "partial" | "paid";
  /** Nhóm cột Tiền (máy chủ xếp, cùng hàm với bộ lọc). `null` = chưa phát sinh nợ. */
  nhom_tien: NhomTien | null;
  payment_voucher_count: number;
  sources: PurchaseRequestSourceOut[];
  lines: PurchaseRequestLineOut[];
  deliveries: PurchaseDeliveryRow[];
  attachments: PurchaseAttachmentRow[];
}

export interface PurchaseRequestListOut {
  items: PurchaseRequestRow[];
  total: number;
  page: number;
  size: number;
  /** Số đơn theo trạng thái HÀNG sau lọc, trước lọc hai nhóm Hàng/Tiền + `tat_ca`. */
  dem_theo_tab?: Record<string, number> | null;
  /** Số đơn theo nhóm TIỀN (`NhomTien`) — cùng bộ lọc, trước lọc hai nhóm. Đơn chưa phát sinh
   *  nợ không vào nhóm nào. */
  dem_theo_tien?: Record<NhomTien, number> | null;
}

/** Nhóm lọc cột Tiền của danh sách đơn mua (phương án 3) — máy chủ xếp, loại trừ nhau. */
export type NhomTien = "chua_tra" | "mot_phan" | "qua_han" | "da_tra";
/** Ba nấc kho của đợt giao / đơn đã về đủ (11/10/2026). */
export type NacKho = "cho_gui_kho" | "kho_chua_nhap" | "da_nhap_kho";

/** Tình trạng một MÓN của yêu cầu mua hàng (chế độ xem Từng món). */
export type TinhTrangMon =
  | "cho_lap"
  | "nhap"
  | "cho_duyet"
  | "tra_lai"
  | "cho_hang"
  | "mot_phan"
  | "du"
  | "nhap_kho"
  | "huy";

export interface YeuCauMonRow {
  line_id: number;
  request_id: number;
  request_code: string;
  request_status: DepartmentPurchaseRequestStatus;
  content: string | null;
  requesting_department_name: string | null;
  requested_by_name: string | null;
  created_at: string;
  needed_date: string;
  hang_loai: HangLoai | null;
  hang_id: number | null;
  kho_rong: number;
  kho_dai: number;
  item_name: string;
  unit: string;
  quantity: number;
  note: string | null;
  purchase_request_id: number | null;
  purchase_code: string | null;
  purchase_status: PurchaseRequestStatus | null;
  supplier_name: string | null;
  ordered_quantity: number | null;
  /** null = chưa có tin hàng về (hoặc đơn cũ không nối dòng). */
  received_quantity: number | null;
  tinh_trang: TinhTrangMon;
  /** 0 → 5 nấc: có đơn, duyệt, đặt NCC, hàng về, nhập kho; 3.5 = về một phần. */
  tien_do: number;
  /** Máy chủ chốt: tick được để lập đơn (yêu cầu chờ lập đơn, món sống, chưa vào đơn sống). */
  chon_duoc: boolean;
  cancel_reason: string | null;
  loai_mua: LoaiMua;
  mua_cho: MuaChoLenh[];
}

export interface YeuCauMonListOut {
  items: YeuCauMonRow[];
  total: number;
  page: number;
  size: number;
  dem_theo_tab: Record<string, number>;
  so_yeu_cau: number;
}

export type PaymentVoucherType = "cash" | "bank_transfer";
export type PaymentStage = "advance" | "partial" | "final" | "other";
export type PaymentVoucherSource =
  | "purchase_request"
  /** Phiếu chi lập TỪ một phiếu tạm ứng lương đã duyệt (18/08/2026). Số tiền + người nhận do
   *  backend lấy thẳng từ phiếu tạm ứng, payload gửi lên bị bỏ qua. */
  | "salary_advance"
  /** Phiếu chi lập TỪ một lần gia công ngoài đã chốt (26/09/2026). KHÔNG vào công nợ 331 — ô nhà
   *  cung cấp công nợ để trống, tên nhà gia công chỉ nằm ở người nhận. */
  | "gia_cong_ngoai"
  | "internal_expense"
  | "customer_refund"
  /** Chi chiết khấu / kê trả khách theo hóa đơn đã thu đủ (20/10/2026). */
  | "chi_chiet_khau"
  | "chi_ke_gia"
  | "other";
/** BỎ HẲN `waiting_payment` từ 06/08/2026 (Đ1): lập phiếu chi = tiền ĐÃ RA, phiếu sinh ra đã là
 *  `paid`. Migration đã chuyển mọi phiếu "chờ chi" cũ thành `paid` (có dấu trong `note`). */
export type PaymentVoucherStatus = "paid" | "cancelled";

export interface BankAccountInput {
  account_holder: string;
  account_number: string;
  bank_name: string;
  bank_branch: string;
  currency: string;
  is_default: boolean;
  is_active: boolean;
  note?: string | null;
}

export interface CompanyBankAccountInput extends BankAccountInput {
  use_for_receipts: boolean;
  use_for_payments: boolean;
}

export interface CompanyBankAccountRow extends CompanyBankAccountInput {
  id: number;
  created_at: string;
  updated_at: string;
}

/** Thu/chi ĐÃ XONG của một tài khoản công ty trong kỳ; tài khoản không có phiếu thì vắng mặt. */
export interface TaiKhoanThongKe {
  tai_khoan_id: number;
  thu: number;
  chi: number;
  so_phieu: number;
}

export interface SupplierBankAccountInput extends BankAccountInput {
  supplier_id: number;
}

export interface SupplierBankAccountRow extends SupplierBankAccountInput {
  id: number;
  supplier_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentVoucherAccountsInput {
  /** Định khoản in trên mẫu ("242, 1331" / "1111") — nhập tay, không bắt buộc. */
  debit_account?: string | null;
  credit_account?: string | null;
}

export interface PaymentVoucherBaseInput extends PaymentVoucherAccountsInput {
  source_type?: PaymentVoucherSource | null;
  voucher_type: PaymentVoucherType;
  payment_stage: PaymentStage;
  /** Đợt giao mà phiếu này trả cho. BẮT BUỘC với phiếu thanh toán khi đơn CÓ đợt giao; phải để
      trống với phiếu đặt cọc (cọc là tiền chi khi hàng chưa về nên chưa có đợt nào để gắn). */
  delivery_id?: number | null;
  voucher_date: string;
  /** DORMANT từ 06/08/2026: hạn trả nay thuộc về ĐỢT GIAO, phiếu chi là tiền đã ra nên không có
      hạn. Giữ khoá để phiếu cũ không vỡ — đừng bày lại thành ô nhập. */
  planned_payment_date?: string | null;
  amount: number;
  currency: string;
  exchange_rate: number;
  content: string;
  invoice_number?: string | null;
  invoice_date?: string | null;
  contract_number?: string | null;
  company_bank_account_id?: number | null;
  supplier_bank_account_id?: number | null;
  cash_recipient_name?: string | null;
  cash_recipient_address?: string | null;
  cash_recipient_identity?: string | null;
  beneficiary_account_holder?: string | null;
  beneficiary_account_number?: string | null;
  beneficiary_bank_name?: string | null;
  beneficiary_bank_branch?: string | null;
  bank_fee_bearer?: "payer" | "beneficiary" | "shared" | null;
  note?: string | null;
  /** Mục chi (danh mục Mục thu chi). Phiếu lập tay BẮT BUỘC; phiếu sinh từ nghiệp vụ bỏ trống —
   *  mục của nó là mục cố định theo nguồn. */
  muc_thu_chi_id?: number | null;
  /** Chỉ phiếu trả lại tiền cho khách (`customer_refund`) — tiền vào Công nợ phải thu của khách. */
  customer_id?: number | null;
  /** Đơn đã huỷ mà phiếu trả lại cọc (chỉ `customer_refund`). */
  order_id?: number | null;
}

export interface PaymentVoucherInput extends PaymentVoucherBaseInput {
  purchase_request_id?: number | null;
  /** Phiếu TẠM ỨNG LƯƠNG nguồn. Truyền id này thì `source_type` tự thành `salary_advance`, còn
   *  `amount` + `cash_recipient_name` gửi lên BỊ BỎ QUA — backend lấy số tiền và tên nhân viên
   *  của chính phiếu tạm ứng, để phiếu chi không lệch số đã duyệt. */
  salary_advance_id?: number | null;
  gia_cong_ngoai_id?: number | null;
}

/** Một khoản trong phiếu chi gộp (17/10/2026): `delivery_id` trống = CỌC của đơn. */
export interface PhieuChiGopDong {
  purchase_request_id: number;
  delivery_id: number | null;
  amount: number;
}

/** MỘT phiếu chi trả NHIỀU khoản (cọc, đợt giao, nhiều đơn) của CÙNG một nhà cung cấp — chỉ VND.
 *  `content` trống thì máy đặt "Thanh toán {mã} đợt {n}, … và …". */
export interface PhieuChiGopInput extends PaymentVoucherAccountsInput {
  lines: PhieuChiGopDong[];
  voucher_type: PaymentVoucherType;
  voucher_date: string;
  content?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  contract_number?: string | null;
  company_bank_account_id?: number | null;
  supplier_bank_account_id?: number | null;
  cash_recipient_name?: string | null;
  cash_recipient_address?: string | null;
  cash_recipient_identity?: string | null;
  beneficiary_account_holder?: string | null;
  beneficiary_account_number?: string | null;
  beneficiary_bank_name?: string | null;
  beneficiary_bank_branch?: string | null;
  bank_fee_bearer?: "payer" | "beneficiary" | "shared" | null;
  note?: string | null;
}

/** Một dòng phân bổ của phiếu chi đơn mua. Phiếu lẻ có đúng một dòng; phiếu gộp có nhiều. */
export interface PaymentVoucherLineRow {
  purchase_request_id: number;
  purchase_code: string | null;
  delivery_id: number | null;
  delivery_seq_no: number | null;
  invoice_number: string | null;
  amount: number;
}

export interface VoucherBatchResult {
  vouchers: PaymentVoucherRow[];
  total_amount: number;
}

/** Bảng kê đính kèm phiếu chi tạm ứng / lương đợt 1 — một lượt (nhiều người) hay lẻ (25/09/2026). */
export interface BangKeTamUngRow {
  salary_advance_id: number;
  ma_phieu: string | null;
  kind: string;
  employee_id: number;
  ma_nv: string | null;
  ten: string | null;
  department_id: number | null;
  department_name: string | null;
  so_tien: number;
  so_tai_khoan: string | null;
  ngan_hang: string | null;
}
export interface BangKeTamUng {
  voucher_id: number;
  code: string;
  doc_no: string | null;
  voucher_type: string;
  voucher_date: string | null;
  content: string | null;
  status: string;
  so_nguoi: number;
  tong: number;
  rows: BangKeTamUngRow[];
}

/** Những ô kế toán THẬT SỰ khai khi lập phiếu chi từ một phiếu tạm ứng lương đã duyệt.
 *  Cố tình KHÔNG có `cash_recipient_name`: backend điền tên từ hồ sơ nhân viên. */
export interface SalaryAdvanceVoucherInput {
  salary_advance_id: number;
  /** Số tiền của CHÍNH phiếu tạm ứng. Vẫn phải gửi vì schema đòi `amount > 0`, nhưng backend GHI
   *  ĐÈ bằng số của phiếu tạm ứng — gửi số khác chỉ tự lừa mình, phiếu chi vẫn ra số đã duyệt. */
  amount: number;
  voucher_type: PaymentVoucherType;
  /** YYYY-MM-DD. Backend từ chối ngày ở TƯƠNG LAI (422). */
  voucher_date: string;
  content: string;
  note?: string | null;
  /** Hai ô của mẫu 02-TT tiền mặt (người nhận ký tại quỹ khai địa chỉ + CCCD). Không bắt buộc;
   *  chuyển khoản thì bỏ trống vì tài khoản thụ hưởng đã là bằng chứng nhận tiền. */
  cash_recipient_address?: string | null;
  cash_recipient_identity?: string | null;
  /** CHỈ khi `voucher_type = "bank_transfer"`. Backend bắt buộc đủ tài khoản trích nợ + tên/số
   *  tài khoản/ngân hàng thụ hưởng, thiếu một ô là 422 — tiền mặt thì bỏ trống hết. */
  company_bank_account_id?: number | null;
  beneficiary_account_holder?: string | null;
  beneficiary_account_number?: string | null;
  beneficiary_bank_name?: string | null;
  beneficiary_bank_branch?: string | null;
  bank_fee_bearer?: "payer" | "beneficiary" | "shared" | null;
}

export interface PaymentVoucherRow {
  id: number;
  code: string;
  /** Mục chi — null = "Chưa phân loại". Tuỳ chọn để fixture test dựng tay khỏi vỡ `tsc`. */
  muc_thu_chi_id?: number | null;
  muc_thu_chi_ten?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  /** Đơn đã huỷ mà phiếu trả lại cọc. */
  order_id?: number | null;
  order_code?: string | null;
  /** Số IN trên mẫu 02-TT (PC00445) — khác `code` (mã tra cứu nội bộ). */
  doc_no: string | null;
  debit_account: string | null;
  credit_account: string | null;
  source_type: PaymentVoucherSource;
  purchase_request_id: number | null;
  /** Phiếu tạm ứng lương nguồn — chỉ có giá trị khi `source_type = salary_advance`.
   *  Một phiếu tạm ứng chỉ gắn ĐÚNG MỘT phiếu chi (UNIQUE ở DB). */
  salary_advance_id: number | null;
  /** Lần gia công ngoài nguồn — chỉ có giá trị khi `source_type = gia_cong_ngoai`. Tùy chọn ở đây
   *  (dưới `salary_advance_id`) để fixture test dựng `PaymentVoucherRow` bằng tay khỏi vỡ `tsc`. */
  gia_cong_ngoai_id?: number | null;
  purchase_request_code: string;
  purchase_request_total: number | null;
  purchase_paid_amount: number | null;
  purchase_created_by_name: string | null;
  receipt_received_amount: number;
  receipt_pending_amount: number;
  attachment_count: number;
  /** null = phiếu ĐẶT CỌC, hoặc phiếu cũ lập trước khi có khái niệm đợt giao. */
  delivery_id: number | null;
  delivery_seq_no: number | null;
  source_request_codes: string[];
  supplier_id: number | null;
  supplier_name: string;
  supplier_tax_code: string | null;
  supplier_address: string | null;
  voucher_type: PaymentVoucherType;
  payment_stage: PaymentStage;
  status: PaymentVoucherStatus;
  voucher_date: string;
  planned_payment_date: string | null;
  amount: number;
  amount_vnd: number;
  currency: string;
  exchange_rate: number;
  content: string;
  invoice_number: string | null;
  invoice_date: string | null;
  contract_number: string | null;
  company_bank_account_id: number | null;
  supplier_bank_account_id: number | null;
  cash_recipient_name: string | null;
  cash_recipient_address: string | null;
  cash_recipient_identity: string | null;
  bank_fee_bearer: "payer" | "beneficiary" | "shared" | null;
  bank_reference: string | null;
  company_account_holder: string | null;
  company_account_number: string | null;
  company_bank_name: string | null;
  company_bank_branch: string | null;
  beneficiary_account_holder: string | null;
  beneficiary_account_number: string | null;
  beneficiary_bank_name: string | null;
  beneficiary_bank_branch: string | null;
  created_by_user_id: number | null;
  created_by_name: string | null;
  paid_by_user_id: number | null;
  paid_by_name: string | null;
  paid_at: string | null;
  cancelled_by_user_id: number | null;
  cancelled_by_name: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  /** Bảng đối chiếu trong ngăn: đã trả/thu TRƯỚC phiếu này và còn nợ SAU phiếu này. Chỉ route đọc
   *  MỘT phiếu mới điền; null ở danh sách hoặc loại phiếu không đối chiếu theo đợt/hoá đơn. */
  /** Bảng phân bổ (17/10/2026). > 1 dòng = phiếu gộp: đầu phiếu không đơn/đợt. */
  lines?: PaymentVoucherLineRow[];
  /** Phiếu gộp: đối chiếu theo từng dòng (chỉ khi đọc một phiếu). */
  doi_chieu?: { purchase_code: string; delivery_seq_no: number | null; truoc_do: number; con_no_sau: number }[];
  truoc_do?: number | null;
  con_no_sau?: number | null;
}

/** Số trên hàng thẻ lọc Phiếu chi / Phiếu thu. Máy chủ đếm trên bộ lọc KHÔNG gồm `status`, nên
 *  chọn một thẻ không làm các thẻ còn lại về 0. `xong` = đã chi / đã thu, `cho` = chờ (phần còn
 *  lại sau khi trừ xong và đã huỷ). */
export type TheLoc = {
  tat_ca: number;
  xong: number;
  xong_tien: number;
  da_huy: number;
  cho: number;
};

/** Bộ lọc kỳ + nâng cao dùng chung cho `accounting.vouchers` và `accounting.receipts`.
 *  `nguon` ra query lặp (`nguon=a&nguon=b`); `dem_only` chỉ lấy `total` (items rỗng). */
export type LocPhieu = {
  q?: string;
  status?: string;
  sort?: string;
  page?: number;
  size?: number;
  tu_ngay?: string;
  den_ngay?: string;
  tien_tu?: number;
  tien_den?: number;
  hinh_thuc?: "cash" | "bank_transfer";
  nguon?: string[];
  /** Lọc theo mục thu chi — id mục; `0` = phiếu chưa phân loại. Ra query lặp như `nguon`. */
  muc?: number[];
  tai_khoan_id?: number;
  nguoi_lap_id?: number;
  /** Ô tên người trong bộ lọc nâng cao, tách khỏi `q`. Phiếu chi: "Người nhận" (so tên người
   *  nhận/chủ tài khoản/nhà cung cấp). Phiếu thu: "Người nộp" (so `payer_name`). */
  nhan?: string;
  /** Kỳ tính theo mốc: `tao` = ngày lập phiếu; `chi` / `thu` = ngày chứng từ (máy chủ mặc định). */
  moc?: string;
  dem_only?: boolean;
};

/** Gắn các khoá MỚI của `LocPhieu` vào query (khoá cũ do từng hàm tự gắn). Bỏ ô rỗng; mảng ra query lặp. */
function themLocPhieuVaoQuery(qs: URLSearchParams, p: Omit<LocPhieu, "status">): void {
  if (p.tu_ngay) qs.set("tu_ngay", p.tu_ngay);
  if (p.den_ngay) qs.set("den_ngay", p.den_ngay);
  if (p.moc) qs.set("moc", p.moc);
  if (p.tien_tu != null) qs.set("tien_tu", String(p.tien_tu));
  if (p.tien_den != null) qs.set("tien_den", String(p.tien_den));
  if (p.hinh_thuc) qs.set("hinh_thuc", p.hinh_thuc);
  for (const n of p.nguon ?? []) qs.append("nguon", n);
  for (const m of p.muc ?? []) qs.append("muc", String(m));
  if (p.tai_khoan_id != null) qs.set("tai_khoan_id", String(p.tai_khoan_id));
  if (p.nguoi_lap_id != null) qs.set("nguoi_lap_id", String(p.nguoi_lap_id));
  if (p.nhan?.trim()) qs.set("nhan", p.nhan.trim());
  if (p.dem_only) qs.set("dem_only", "true");
}

/** Kỳ + bộ lọc nâng cao của màn Công nợ phải trả / phải thu (`accounting.payables`,
 *  `accounting.receivables`). `tu_ngay`/`den_ngay` phải đi CẢ HAI (thiếu một ⇒ 422); không có kỳ =
 *  hành vi cũ (ảnh chụp hôm nay, kỳ 3 tháng). `phu_trach_id` và `nhan` chỉ có nghĩa ở phải thu. */
export type LocCongNo = {
  q?: string;
  filter?: string;
  /** Khoá rổ tuổi — ra query `aging_bucket` (hai màn dùng chung một tên). */
  aging?: string | null;
  page?: number;
  size?: number;
  tu_ngay?: string;
  den_ngay?: string;
  no_tu?: number;
  no_den?: number;
  han_tra?: "qua_han" | "7_ngay" | "30_ngay";
  han_muc?: "tren_80" | "vuot" | "chua_dat";
  ca_da_tra_het?: boolean;
  /** Chỉ màn phải trả: NCC có đợt giao còn nợ mà chưa ghi số hoá đơn. */
  thieu_hoa_don?: boolean;
  dem_only?: boolean;
  /** Chỉ lấy các số TỔNG (`items` rỗng, máy chủ bỏ phần dựng dòng) — lời "cùng kỳ" của màn Công nợ. */
  chi_tong?: boolean;
  phu_trach_id?: number;
  nhan?: string;
  /** Sắp xếp ở MÁY CHỦ: cột + chiều. Không gửi = thứ tự mặc định (còn nợ giảm dần). */
  sap_xep?: CotSapXepCongNo;
  chieu?: "asc" | "desc";
};

/** Cột sắp xếp được của hai bảng công nợ. */
export type CotSapXepCongNo = "con_no" | "han" | "gan_nhat";

function locCongNoVaoQuery(p: LocCongNo): string {
  const qs = new URLSearchParams();
  if (p.q?.trim()) qs.set("q", p.q.trim());
  if (p.filter && p.filter !== "all") qs.set("filter", p.filter);
  if (p.aging) qs.set("aging_bucket", p.aging);
  if (p.page) qs.set("page", String(p.page));
  if (p.size) qs.set("size", String(p.size));
  if (p.tu_ngay) qs.set("tu_ngay", p.tu_ngay);
  if (p.den_ngay) qs.set("den_ngay", p.den_ngay);
  if (p.no_tu != null) qs.set("no_tu", String(p.no_tu));
  if (p.no_den != null) qs.set("no_den", String(p.no_den));
  if (p.han_tra) qs.set("han_tra", p.han_tra);
  if (p.han_muc) qs.set("han_muc", p.han_muc);
  if (p.ca_da_tra_het) qs.set("ca_da_tra_het", "true");
  if (p.thieu_hoa_don) qs.set("thieu_hoa_don", "true");
  if (p.dem_only) qs.set("dem_only", "true");
  if (p.chi_tong) qs.set("chi_tong", "true");
  if (p.phu_trach_id != null) qs.set("phu_trach_id", String(p.phu_trach_id));
  if (p.nhan?.trim()) qs.set("nhan", p.nhan.trim());
  if (p.sap_xep) qs.set("sap_xep", p.sap_xep);
  if (p.chieu) qs.set("chieu", p.chieu);
  return qs.toString() ? `?${qs.toString()}` : "";
}

/** Một trang của tab Đã trả / Đã thu trong ngăn chi tiết công nợ (máy chủ cắt, `paid_total` là tổng số lần). */
export type TrangDaTra = { paid_page: number; paid_size: number };

/** Query của ngăn chi tiết công nợ: `all_history` và/hoặc kỳ cho tab Đã trả / Đã thu. */
function chiTietCongNoQuery(
  allHistory: boolean,
  ky?: { tu_ngay: string; den_ngay: string },
  trang?: TrangDaTra,
): string {
  const qs = new URLSearchParams();
  if (allHistory) qs.set("all_history", "true");
  if (ky) {
    qs.set("tu_ngay", ky.tu_ngay);
    qs.set("den_ngay", ky.den_ngay);
  }
  if (trang) {
    qs.set("paid_page", String(trang.paid_page));
    qs.set("paid_size", String(trang.paid_size));
  }
  return qs.toString() ? `?${qs.toString()}` : "";
}

export interface PaymentVoucherListOut {
  items: PaymentVoucherRow[];
  total: number;
  page: number;
  size: number;
  /** Tổng tiền (VND) trên TOÀN BỘ kết quả khớp bộ lọc — mọi trang. */
  total_paid_amount: number;
  /** DORMANT từ 06/08/2026: không còn phiếu "chờ chi" nên số này luôn 0. Đừng hiện lên màn. */
  total_waiting_amount: number;
  total_receipt_received_amount: number;
  /** Số trên hàng thẻ lọc. Đếm bỏ qua `status`. */
  the_loc: TheLoc;
}

export interface PaymentVoucherAttachment {
  id: number;
  payment_voucher_id: number;
  file_name: string;
  file_url: string;
  file_type: string | null;
  uploaded_by: number | null;
  uploaded_at: string | null;
}

export type PaymentReceiptStatus = "waiting_receipt" | "received" | "cancelled";
export type PaymentReceiptSource =
  | "purchase_refund"
  | "order_deposit"
  | "sales_invoice"
  | "other";

export interface PaymentReceiptInput extends PaymentVoucherAccountsInput {
  payer_name: string;
  /** Ô "Địa chỉ" của mẫu 01-TT — không bắt buộc. */
  payer_address?: string | null;
  receipt_method: PaymentVoucherType;
  receipt_date: string;
  amount: number;
  exchange_rate?: number | null;
  content: string;
  company_bank_account_id?: number | null;
  bank_reference?: string | null;
  note?: string | null;
  /** Mục thu. Phiếu thu lập tay BẮT BUỘC; phiếu theo hoá đơn / NCC hoàn tiền bỏ trống thì máy chủ
   *  lấy mục "điền sẵn" của nguồn đó. */
  muc_thu_chi_id?: number | null;
}

export interface PaymentReceiptRow {
  id: number;
  code: string;
  /** Mục thu — null = "Chưa phân loại". */
  muc_thu_chi_id?: number | null;
  muc_thu_chi_ten?: string | null;
  /** Số IN trên mẫu 01-TT (PT00027). */
  doc_no: string | null;
  source_type: PaymentReceiptSource;
  payment_voucher_id: number | null;
  payment_voucher_code: string | null;
  purchase_request_id: number | null;
  purchase_request_code: string | null;
  /** NCC của phiếu nhà cung cấp hoàn tiền. */
  supplier_id?: number | null;
  supplier_name: string | null;
  order_id: number | null;
  order_code: string | null;
  customer_name: string | null;
  sales_invoice_id: number | null;
  sales_invoice_number: string | null;
  payer_name: string;
  payer_address: string | null;
  debit_account: string | null;
  credit_account: string | null;
  receipt_method: PaymentVoucherType;
  status: PaymentReceiptStatus;
  receipt_date: string;
  amount: number;
  amount_vnd: number;
  currency: string;
  exchange_rate: number;
  content: string;
  company_bank_account_id: number | null;
  company_account_holder: string | null;
  company_account_number: string | null;
  company_bank_name: string | null;
  company_bank_branch: string | null;
  bank_reference: string | null;
  created_by_user_id: number | null;
  created_by_name: string | null;
  received_by_user_id: number | null;
  received_by_name: string | null;
  received_at: string | null;
  cancelled_by_user_id: number | null;
  cancelled_by_name: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  note: string | null;
  attachment_count: number;
  created_at: string;
  updated_at: string;
  /** Bảng đối chiếu trong ngăn: đã trả/thu TRƯỚC phiếu này và còn nợ SAU phiếu này. Chỉ route đọc
   *  MỘT phiếu mới điền; null ở danh sách hoặc loại phiếu không đối chiếu theo đợt/hoá đơn. */
  truoc_do?: number | null;
  con_no_sau?: number | null;
  /** Khách của phiếu thu đơn bán (phiếu gộp không có đơn/hoá đơn ở đầu phiếu). */
  customer_id?: number | null;
  /** Bảng phân bổ (17/10/2026). > 1 dòng = phiếu gộp nhiều chứng từ. */
  lines?: PaymentReceiptLineRow[];
  /** Phiếu gộp: đối chiếu theo từng dòng hoá đơn (chỉ khi đọc một phiếu). */
  doi_chieu?: { order_code: string | null; invoice_number: string | null; truoc_do: number; con_no_sau: number }[] | null;
}

/** Một dòng phân bổ của phiếu thu đơn bán. `sales_invoice_id` trống = dòng cọc của đơn. */
export interface PaymentReceiptLineRow {
  order_id: number;
  order_code: string | null;
  sales_invoice_id: number | null;
  invoice_number: string | null;
  amount: number;
}

/** Một khoản trong phiếu thu gộp: có `sales_invoice_id` = thu hoá đơn; trống = thu CỌC của `order_id`. */
export interface PhieuThuGopDong {
  sales_invoice_id: number | null;
  order_id: number | null;
  amount: number;
}

/** MỘT phiếu thu cho NHIỀU khoản (cọc, hoá đơn, nhiều đơn) của CÙNG một khách — chỉ VND. */
export interface PhieuThuGopInput {
  lines: PhieuThuGopDong[];
  payer_name?: string | null;
  payer_address?: string | null;
  receipt_method: PaymentVoucherType;
  receipt_date: string;
  content?: string | null;
  company_bank_account_id?: number | null;
  bank_reference?: string | null;
  note?: string | null;
}

export interface PaymentReceiptAttachment {
  id: number;
  payment_receipt_id: number;
  file_name: string;
  file_url: string;
  file_type: string | null;
  uploaded_by: number | null;
  uploaded_at: string | null;
}

export interface PaymentReceiptListOut {
  items: PaymentReceiptRow[];
  total: number;
  page: number;
  size: number;
  /** Tổng tiền (VND) các phiếu ĐÃ THU khớp bộ lọc — mọi trang. */
  total_received_amount: number;
  /** Số trên hàng thẻ lọc; `cho` = chờ thu. Đếm bỏ qua `status`. */
  the_loc: TheLoc;
}

// --- Đơn hàng bán (redesign-don-hang-ban.md) --------------------------------
export interface OrderLineOut {
  id: number;
  description: string;
  qty: number;
  don_vi_tinh: string;   // ĐVT THẬT của phần này (kéo từ báo giá / gõ tay)
  dvt_nhom: string | null;   // ĐVT của cụm khi in gộp ("cuốn") — xem `QuoteItem.dvt_nhom`
  unit_price_snapshot: number | null;
  vat_pct_estimate: number;
  line_total: number | null;
  /** Tiền chiết khấu nằm trong `line_total` — công ty sẽ hoàn lại khách. null = đơn cũ / nhập tay. */
  chiet_khau?: number | null;
  /** Tiền kê nằm trong `line_total` (giá bán sau kê) — chi lại sau khi khách trả đủ. null = đơn cũ. */
  ke_gia?: number | null;
  cost_snapshot: number | null;
  phieu_thanh_phan_id: number | null;
  /** Nhãn nhóm gộp KHI IN xác nhận đơn — copy từ dòng báo giá, khớp bản khách đã nhận. */
  nhom: string | null;
}
export interface AttachmentOut {
  id: number;
  url: string;
  file_name: string | null;
  content_type: string | null;
  uploaded_at: string;
  /** Chỉ tệp đính kèm của đơn trả hai ô này. */
  size_bytes?: number;
  uploaded_by_name?: string | null;
}
export interface OrderDepositReceipt {
  id: number;
  code: string;
  doc_no: string | null;
  amount: number;
  receipt_method: string;   // cash | bank_transfer
  status: string;           // received (V5: lập là đã thu)
  receipt_date: string | null;
  created_at: string;
  /** Phiếu gộp nhiều chứng từ: `amount` là phần cọc của đơn này, `tong_phieu` là cả phiếu. */
  gop?: boolean;
  tong_phieu?: number | null;
}
export interface OrderDepositReceiptInput {
  receipt_method: string;   // cash | bank_transfer
  amount: number;
  receipt_date?: string | null;
  note?: string | null;
  company_bank_account_id?: number | null;
  // Cùng các ô của form Lập phiếu thu; để trống thì máy chủ lấy tên khách / "Thu cọc đơn …".
  payer_name?: string | null;
  payer_address?: string | null;
  content?: string | null;
  bank_reference?: string | null;
}
export interface OrderApprovalOut {
  id: number;
  decision: string;
  triggers_json: string[] | null;
  note: string | null;
  decided_by: number | null;
  decided_by_name: string | null;
  decided_at: string;
  order_total: number;
  order_subtotal: number;
  order_cost: number | null;
  margin_pct_snapshot: number | null;
}
/** Phiếu thu 01-TT của đơn (nguồn cọc thật, dùng chung quyển sổ PT kế toán). */
export interface OrderReceiptOut {
  id: number;
  code: string;
  doc_no: string | null;
  receipt_method: string;          // cash | bank_transfer
  amount: number;
  status: string;                  // waiting_receipt | received | cancelled
  receipt_date: string | null;
  content: string | null;
  bank_reference: string | null;
  payer_name: string | null;
  debit_account: string | null;
  credit_account: string | null;
  created_by_name: string | null;
  attachments: AttachmentOut[];
}
export interface OrderReceiptInput {
  receipt_method: string;          // cash | bank_transfer
  amount: number;
  receipt_date: string;
  content?: string | null;
  bank_reference?: string | null;
  company_bank_account_id?: number | null;
  note?: string | null;
  mark_received?: boolean;
}
export interface OrderRow {
  id: number;
  order_no: string;
  customer_id: number | null;
  customer_name: string | null;
  quotation_id: number | null;
  quotation_code: string | null;
  /** DORMANT: chỉ còn 'bao_gia' cho đơn MỚI; đơn 'nhap_tay' cũ trong DB vẫn trả ra giá trị này. */
  source_type: string;
  order_kind: string;
  status: string;
  is_rush: boolean;
  cost_basis: string;
  total: number | null;
  total_with_vat: number;
  deposit_pct: number | null;
  /** Cọc gõ bằng số tiền (20/10/2026) — có thì thắng `deposit_pct`. */
  deposit_amount?: number | null;
  deposit_required: number;
  deposit_received: number;
  deposit_ok: boolean;
  /** Đơn đã huỷ: tổng phiếu chi trả lại tiền khách còn hiệu lực của đơn. */
  deposit_refunded: number;
  /** Đơn đã huỷ: tiền khách đã đưa (cọc + tiền hoá đơn đã huỷ) và phần còn giữ chưa trả lại. */
  tien_khach_da_nhan?: number;
  tien_khach_con_giu?: number;
  delivery_committed_date: string | null;
  sale_user_id: number | null;
  sale_name: string | null;
  created_at: string;
  ordered_at: string | null;
  customer_po_no: string | null;
  san_xuat_released_at: string | null;
  first_line_desc: string | null;
  line_count: number;
  /** Từng mặt hàng đang ở đâu (đơn đã chốt) — cột Sản xuất + bảng nổi (07/10/2026). */
  san_xuat_mon: MonSanXuat[];
  /** Đơn đang chờ ai — cùng giá trị ô lọc "Đang chờ". */
  dang_cho: DangCho[];
}

/** Mặt hàng đang ở đâu — `backend/app/services/don_hang_san_xuat.py` O_*. */
/** `dong_thieu`: mọi lệnh đã đóng, kho không còn gì chờ nhận mà hàng vẫn chưa đủ số đặt. */
export type MonO = "du_hang" | "ngoai" | "xuong" | "cho_kho" | "dong_thieu" | "chua_xuong" | "chua_lenh";
/** `tra_coc`: đơn ĐÃ HUỶ còn giữ cọc của khách, chờ lập phiếu chi trả lại. */
export type DangCho = "coc" | "ke_hoach" | "xuong" | "gia_cong" | "kho" | "giao" | "hoa_don" | "xong" | "tra_coc";

/** Lần gia công ngoài ĐANG MỞ của một lệnh. */
export interface GiaCongMon {
  kieu: "tron_goi" | "mot_phan";
  nha_cung_cap_id: number;
  nha_cung_cap_ten: string;
  ten_viec: string;
  /** Một phần: lúc mang đi. Trọn gói: lúc giao việc. */
  tu_luc: string | null;
  /** Một phần còn bước của xưởng phía sau ⇒ về xưởng làm tiếp. */
  ve_xuong: boolean;
}

export interface LenhMon {
  id: number;
  ma: string;
  o: MonO;
  kieu: "xuong" | "mot_phan" | "tron_goi";
  buoc: string | null;
  pct: number | null;
  gia_cong: GiaCongMon | null;
}

export interface MonSanXuat {
  khoa: string;
  ten: string;
  don_vi: string | null;
  dat: number;
  co_hang: number;
  /** Phần của `co_hang` lấy từ tồn có sẵn của mã, không phải từ lệnh của chính đơn. */
  co_tu_ton?: number;
  du_hang: boolean;
  o: MonO;
  co_lenh: boolean;
  tu_ton: boolean;
  giao_thang: number;
  da_giao: number;
  con_phai_giao: number;
  /** Khách đã THỰC NHẬN đủ. Khác `con_phai_giao` ≤ 0 — số đó trừ cả phần yêu cầu giao đang giữ. */
  khach_nhan_du?: boolean;
  lenh: LenhMon[];
}
export interface OrderListOut {
  items: OrderRow[];
  total: number;
  page: number;
  size: number;
  /** Dòng "Cộng" cuối lưới: Σ giá trị gồm VAT + Σ cọc đã thu của mọi đơn khớp bộ lọc. */
  tong_gia_tri?: number;
  tong_coc?: number;
}
export interface OrderDetail extends OrderRow {
  quotation_version: number | null;
  quotation_effective_from: string | null;
  parent_order_id: number | null;
  parent_order_no: string | null;
  customer_po_no: string | null;
  delivery_address: string | null;
  delivery_contact_name: string | null;
  delivery_contact_phone: string | null;
  delivery_note: string | null;
  production_note: string | null;
  vat_pct_estimate: number;
  lines: OrderLineOut[];
  order_cost: number | null;
  margin_pct: number | null;
  cancel_reason: string | null;
  cancel_fault: string | null;
  deposits: OrderDepositReceipt[];   // V5: phiếu thu cọc THẬT (PaymentReceipt nguồn đơn)
  consent_attachments: AttachmentOut[];
  can_confirm: boolean;
  confirm_blockers: string[];
  quote_expired: boolean;   // Việc 4: báo giá nguồn hết hạn → bật nút "Gia hạn báo giá"
  san_xuat_released_at: string | null;  // Sale "Chuyển xuống SX" → vào hàng chờ Kế hoạch (NULL=chưa)
  /** Chỉ có trong response lập phiếu thu cọc: id phiếu vừa lập (để tải chứng từ gốc lên). */
  phieu_vua_lap_id?: number | null;
  /** Người bấm Chốt. */
  ordered_by_name?: string | null;
}
export interface OrderStatsOut {
  all: number;
  draft: number;
  ordered: number;
  cancelled: number;
  /** Nháp đã qua cổng chốt. */
  san_sang: number;
  /** Đã chốt, chưa xuống sản xuất vì chờ đủ cọc. */
  cho_coc: number;
  /** Đã chốt, khách nhận đủ và hoá đơn đã ghi đủ. */
  hoan_tat: number;
  awaiting_deposit: number;
  deposit_shortfall: number;
  ordered_value: number;
}
/** Đơn CHỈ sinh từ báo giá khách đã đồng ý — `quotation_id` bắt buộc, không còn nhánh nhập tay. */
export interface OrderCreateInput {
  quotation_id: number;
  order_kind?: string;
  parent_order_id?: number | null;
  deposit_pct?: number | null;
  customer_po_no?: string | null;
  delivery_committed_date?: string | null;
  delivery_address?: string | null;
  delivery_contact_name?: string | null;
  delivery_contact_phone?: string | null;
  delivery_note?: string | null;
  production_note?: string | null;
  is_rush?: boolean;
}
export interface OrderUpdateInput {
  deposit_pct?: number | null;
  deposit_amount?: number | null;
  customer_po_no?: string | null;
  delivery_committed_date?: string | null;
  delivery_address?: string | null;
  delivery_contact_name?: string | null;
  delivery_contact_phone?: string | null;
  delivery_note?: string | null;
  production_note?: string | null;
  is_rush?: boolean | null;
}
export interface OrderNotifySummary {
  action_count: number;
  /** Luôn 0 — luồng duyệt đã gỡ; backend vẫn trả khoá để client cũ không vỡ. */
  approval_pending: number;
  deposit_pending: number;
  ready_to_confirm: number;
}
export interface OrderEnumOption {
  value: string;
  label: string;
}
export interface OrderEnumsOut {
  statuses: OrderEnumOption[];
}
export interface OrderActivity {
  at: string;
  actor_id: number | null;
  actor_name: string | null;
  action: string;
  detail: string;
}
export interface OrderListParams {
  q?: string;
  status?: string;
  order_kind?: string;
  view_scope?: string;
  sort?: string;
  page?: number;
  size?: number;
  /** Hộp lọc NV phụ trách — id người; máy chủ AND với phạm vi. */
  nguoi?: number | null;
  /** Dải kỳ + bộ lọc nâng cao. */
  loc?: ThamSoLoc;
}

/** 1 nhãn trong KHO nhãn khách + số khách đang mang nó.
 *
 *  `so_khach` có sẵn trong danh sách để hộp thoại xoá hỏi được bằng SỐ THẬT ("3 khách đang mang
 *  nhãn này") thay vì "bạn có chắc không" — không phải gọi thêm vòng nào lúc bấm xoá. */
export interface KhoNhanRow {
  id: number;
  label: string;
  so_khach: number;
}

/** 1 nhãn đã gán cho một BƯỚC công đoạn (LSX / Bài ghép). */
export interface CongDoanTagRow {
  id: number;
  label: string;
}

/** 1 nhãn trong KHO nhãn công đoạn + số BƯỚC đang mang nó (để hỏi trước khi xoá — như `KhoNhanRow`
 *  của khách, chỉ khác `so_khach` → `so_buoc`). */
export interface KhoNhanBuocRow {
  id: number;
  label: string;
  so_buoc: number;
}

// --- Khuôn bế (danh mục dùng chung; ép kim / khung lụa đã gỡ 01/10/2026, dòng cũ còn đọc được) ---
// Tên bảng + module quyền vẫn là `khuon_be`; chỉ nhan đề màn đổi thành "Khuôn" (16/08/2026).
export interface KhuonBeRow {
  id: number;
  ma: string;
  ten: string;
  /** Khách đặt con dao — chiều lọc chính của ô chọn dao ở bước lệnh. */
  khach_hang_id: number | null;
  khach_hang_ten: string | null;
  /** `khuon_be` | `khuon_ep` | `khung_lua` — CÙNG bộ mã với `cong_doan.tooling_type` để lọc bằng
   *  phép so thẳng. */
  loai: string | null;
  so_ke: string | null;
  tinh_trang: string;
  active: boolean;
}

/** 1 con dao chọn được cho bước của một lệnh — server đã lọc theo khách của lệnh. */
export interface KhuonChonDuoc {
  id: number;
  ma: string;
  ten: string;
  /** `khuon_be` | `khuon_ep` | `khung_lua` — CÙNG bộ mã với `cong_doan.tooling_type`.
   *  null = dao khai trước mg 0205, chưa ai phân loại — VẪN hiện ở mọi bước, giấu đi là bắt
   *  người ta đi làm lại con dao đang nằm trên kệ. */
  loai: string | null;
  so_ke: string | null;
  tinh_trang: string;
}

// (`LichChayRow` — 1 lệnh trong bảng lịch chạy Máy × Ngày — đã gỡ 16/08/2026: tàn dư của lớp
//  SX-thực-thi đời cũ, khai ra mà KHÔNG nơi nào import. Bảng lịch chạy nay là `XepLichCongDoan`.)

// 1 công đoạn routing GỐC của ấn phẩm (đọc từ Tính giá) — KHÔNG có đơn giá (cô lập thương mại).
export interface RoutingGocRow {
  thu_tu: number;
  cong_doan_id: number | null;
  ten: string;
  nha_cung_cap: string | null;
  ghi_chu: string | null;
}
// 1 vật tư thêm của ấn phẩm (vecni bóng/mờ · cán màng…) — tên + ghi chú, không giá.
export interface VatTuGocRow {
  ten: string;
  ghi_chu: string | null;
}
// Chi tiết ĐẦY ĐỦ ấn phẩm cho DRAWER (mirror phiếu công đoạn) — CHỈ KỸ THUẬT (đã lọc sạch giá).
// Giá trị HIỆU LỰC = báo giá + override tại lệnh. editable = mở từ lệnh NHÁP (được sửa quy cách).
export interface AnPhamChiTiet {
  phieu_thanh_phan_id: number;
  lenh_item_id: number | null;
  editable: boolean;
  overridden: string[]; // các field đã override so với báo giá
  // nhận dạng / thành phẩm
  ten: string;
  loai_thanh_phan: string;
  dai_thanh_pham: number;
  rong_thanh_pham: number;
  so_to_per_sp: number;
  so_luong: number;
  don_vi_tinh: string;
  // giấy (đã resolve tên + chủng loại)
  giay_id: number | null;
  giay_ten: string | null;
  gsm: number | null;
  kho_nguyen: string | null;
  kho_nguyen_dai: number;
  kho_nguyen_rong: number;
  nguon_giay: string;
  // in & màu
  co_in: boolean;
  che_ban_loai: string | null;
  quy_cach_in: string;
  kho_in_dai: number;
  kho_in_rong: number;
  so_con: number;
  con_auto: boolean;
  may_id: number | null;
  so_mau_a: number;
  so_mau_b: number;
  so_kem: number;
  // số lượng (engine snapshot — null nếu phiếu chưa tính)
  so_luong_can: number | null;
  so_to_thuc_te: number | null;
  so_to_sau_in: number | null;
  so_to_nguyen: number | null;
  con_tren_to: number | null;
  bu_hao_auto: number | null;
  // note kỹ thuật theo sản phẩm + vật tư + routing
  ghi_chu_ky_thuat: string | null;
  vat_tu: VatTuGocRow[];
  routing: RoutingGocRow[];
}
// Handoff (§5.1): đơn đã chốt CHỜ lên kế hoạch — kèm ngữ cảnh để kế hoạch cấu hình.
export interface HangChoAnPham {
  phieu_thanh_phan_id: number | null;
  description: string;
  qty: number;
  don_vi_tinh: string;
  spec_tom_tat: string; // quy cách rút gọn (khổ TP · số màu · giấy) — kỹ thuật, không giá
}
export interface HangChoDon {
  order_id: number;
  order_no: string;
  khach: string | null;
  is_rush: boolean;
  delivery_committed_date: string | null;
  production_note: string | null;
  an_pham: HangChoAnPham[];
}
export interface LenhSXListParams {
  order_id?: number;
  trang_thai?: string;
  page?: number;
  size?: number;
}
/** 1 dòng xếp bài khi tạo tờ (ghép) — số con NHẬP TAY (máy chỉ ghi). */
export interface GhepPlacementInput {
  lenh_sx_id: number;
  so_con: number;
}
/** Tạo 1 TỜ IN + xếp bài. Giấy/khổ/màu là ẢNH CHỤP (người kế hoạch tự nhìn PTG rồi nhập). */
export interface GhepInput {
  giay_id?: number | null;
  giay_label?: string | null;
  kho_in_dai?: number;
  kho_in_rong?: number;
  so_mau?: number;
  may_id?: number | null;
  so_to_chay?: number;
  so_kem?: number;
  placements: GhepPlacementInput[];
}

// --- Kho: đề nghị · phiếu · lô · ngưỡng tồn (spec-kho-de-nghi) ---------------
// Mọi trường TIỀN (`don_gia`, `thanh_tien`, `gia_von`, `don_gia_nhap`) và `ton_kha_dung`
// là `null` khi người gọi thiếu quyền — backend XÓA số khỏi response chứ không chỉ ẩn cột,
// nên UI chỉ cần dò null để quyết định ẩn ô/cột.

export type StockRequestKind = "NHAP" | "XUAT";

export type StockRequestStatus =
  | "draft"
  | "pending"
  | "approved"
  | "received"
  | "preparing"
  | "partial"
  | "done"
  | "rejected"
  | "cancelled";

export type StockPriority = "binh_thuong" | "gap";

/** Đèn tín hiệu 4 mức (bỏ "sắp hết/cận tồn") — KHÔNG kèm con số nên ai cũng nhận được. */
export type StockLevel = "du_ton" | "du" | "can_mua" | "het";

export type StockVoucherStatus = "draft" | "posted" | "cancelled";

export interface StockRequestLine {
  id: number;
  /** MẶT HÀNG GỐC — cặp trỏ danh mục Giấy / Vật tư khác. Không còn hàng gõ tay (siết 2026-08-08). */
  hang_loai: HangLoai;
  hang_id: number;
  hang_ma: string | null;
  hang_ten: string | null;
  /** Ảnh minh hoạ mặt hàng (từ danh mục) — form phiếu nhập hiện + cho gắn/đổi ảnh ngay khi nhập. */
  hang_anh: string | null;
  /** Nhãn nhóm ("Giấy" / "Vật tư khác") — chip phân biệt hai nguồn khi tên gần giống. */
  hang_nhom: string | null;
  /** "Xin cho lệnh nào" (mg 0175). Cả hai null = xin lặt vặt, không thuộc lệnh nào — hợp lệ.
   *  Có giá trị thì bảng cân đối vật tư trừ phần đã cấp vào ĐÚNG dòng nhu cầu của lệnh đó. */
  lsx_id: number | null;
  bai_ghep_id: number | null;
  lsx_ma: string | null;
  bai_ghep_ma: string | null;
  /** GIẤY: khổ mm (cạnh ngắn × cạnh dài; chỉ rộng: rộng × 0). Hàng khác: 0 · 0. Đơn vị gốc ở
   *  `don_vi_goc` bên dưới. */
  kho_rong: number;
  kho_dai: number;
  /** Đơn vị NGƯỜI ĐỀ NGHỊ chọn; mọi `sl_*` của dòng theo đơn vị này. */
  dvt: string;
  /** Số quy về ĐƠN VỊ GỐC + câu diễn giải — dòng nhắc "10 ram ≈ 419,25 kg" dưới ô SL.
   *  `canh_bao_dv` khác null = không đổi được (kèm nguyên văn lý do), FE phải chặn lưu. */
  don_vi_goc: string | null;
  sl_quy_doi: number | null;
  quy_doi_dien_giai: string | null;
  canh_bao_dv: string | null;
  sl_de_nghi: number;
  sl_duyet: number;
  sl_da_ung: number;
  sl_con_lai: number;
  /** Kho đã CHỐT thực xuất bao nhiêu (điều chỉnh phiếu xuất). Null = kho CHƯA điều chỉnh lần
   *  nào — khác hẳn 0 (đã chốt là không xuất gì). Có giá trị → hiện "thực xuất N / yêu cầu M"
   *  thay vì "còn thiếu". */
  sl_chot_thuc_xuat: number | null;
  /** Đơn giá NHẬP người đề nghị khai — phiếu kế thừa (kho chỉ đọc). Null với đề nghị XUẤT.
   *  Mọi trường TIỀN của dòng (`don_gia`, `gia_goc`, `don_gia_ban`) chỉ có khi `kho:view_cost` —
   *  người tạo yêu cầu cũng không ngoại lệ; thiếu quyền → null. */
  don_gia: number | null;
  /** Dòng thành phẩm KCS gửi nhập: `don_gia` luôn 0, giá gốc thật đọc ở lô sau khi kế toán kho gõ.
   *  `gia_goc` null = "Chưa có giá gốc" (chưa nhập lô nào, hoặc còn lô 0 đ). */
  tu_kcs: boolean;
  gia_goc: number | null;
  /** Tiền gốc đã nhập = Σ giá × SL từng đợt đã ghi sổ (không phải `gia_goc` × SL — giá bình quân
   *  đã làm tròn nhân ngược lệch tổng các phiếu). Null cùng lúc với `gia_goc`. */
  tien_goc: number | null;
  /** Giá bán theo đơn hàng (chỉ để đọc, không vào sổ) + số đơn đi kèm. */
  don_gia_ban: number | null;
  don_ban_ma: string | null;
  /** Yêu cầu NHẬP từ đợt giao mua: hàng này mua cho lệnh nào / tồn kho. Rỗng với yêu cầu khác. */
  mua_cho: MuaChoLenh[];
  loai_mua_cac: LoaiMua[];
  /** Kho phản hồi: lý do kho cấp/nhập thiếu so với còn phải cấp (nếu có). */
  ly_do_thieu: string | null;
  ghi_chu: string | null;
  muc_ton: StockLevel | null;
  /** CHỈ có khi `can_view_stock`; thiếu quyền → null. */
  ton_kha_dung: number | null;
}

export interface StockRequest {
  id: number;
  ma: string;
  loai: StockRequestKind;
  nguoi_tao_id: number;
  nguoi_tao_ten: string | null;
  bo_phan_id: number | null;
  bo_phan_ten: string | null;
  kho_id: number | null;
  kho_ten: string | null;
  ngay_can: string | null;
  uu_tien: StockPriority;
  ghi_chu: string | null;
  /** Mã loại nhập/xuất kho (MISA) người tạo gõ ở yêu cầu — Báo cáo kho dùng để export. */
  loai_kho: string | null;
  trang_thai: StockRequestStatus;
  nguoi_duyet_id: number | null;
  nguoi_duyet_ten: string | null;
  duyet_luc: string | null;
  ly_do_tu_choi: string | null;
  /** Lý do KHO hủy đề nghị (hủy phiếu → đề nghị "Đã hủy"). Hiện ở mục "Đã hủy". */
  ly_do_huy: string | null;
  // Id phiếu ĐANG CHỜ GHI SỔ (nếu có) → đổi nút "Lập phiếu" thành "Xem phiếu", chống tạo trùng.
  open_voucher_id: number | null;
  /** ĐIỀU CHUYỂN KHO: yêu cầu NHẬP đích có `kho_nguon_id` ⇒ là YÊU CẦU ĐIỀU CHUYỂN
   *  (nhãn "Điều chuyển từ «kho_nguon_ten»", phiếu nhập KHOÁ đơn giá). `xuat_voucher_id` =
   *  phiếu xuất nguồn đã ghi sổ (truy cặp đi–đến). */
  dieu_chuyen: boolean;
  kho_nguon_id: number | null;
  kho_nguon_ten: string | null;
  xuat_voucher_id: number | null;
  /** Nguồn MUA HÀNG: yêu cầu nhập lập từ một đợt giao của phiếu mua ("DMH-… Đợt 2"). */
  purchase_delivery_id?: number | null;
  don_mua_id?: number | null;
  don_mua_ma?: string | null;
  dot_so?: number | null;
  /** Nguồn GIAO HÀNG: đề nghị xuất giao khách / nhập trả hàng — mã lượt xe (nếu có), mã yêu cầu
   *  giao, số đơn. */
  delivery_trip_id?: number | null;
  giao_luot_ma?: string | null;
  giao_yeu_cau_ma?: string | null;
  giao_don_ma?: string | null;
  /** Khối "Giao hàng" ở ngăn đề nghị bên kho: khách, xe, tài xế tới lấy hàng. */
  giao_khach_ten?: string | null;
  giao_xe_bien_so?: string | null;
  giao_tai_xe_ten?: string | null;
  /** Kho BẮT BUỘC của phiếu: đề nghị có thành phẩm ⇒ id Kho thành phẩm (thành phẩm chỉ vào / ra kho
   *  đó) — màn lập phiếu khoá ô kho. null = kho chọn tự do. */
  kho_bat_buoc_id?: number | null;
  /** Yêu cầu SINH TỪ đề nghị cấp vật tư công đoạn — ba trường đều null với yêu cầu kho THƯỜNG
   *  (không do sản xuất lập), khỏi phải phân nhánh ở FE. */
  /** GIỜ cần thật (từ đề nghị sản xuất). `ngay_can` chỉ có DATE nên không diễn đạt được ca chiều. */
  can_luc: string | null;
  san_xuat_cong_viec_id: number | null;
  /** Nguồn gia công ngoài (mg 0339) — ô Nguồn hiện thẻ "Gia công". */
  gia_cong_ngoai_id?: number | null;
  san_xuat_cong_doan_ten: string | null;
  /** Hệ thống tự lập lúc phát hành lệnh — ô Nguồn ghi "Tự lập khi phát hành". */
  san_xuat_tu_lap?: boolean;
  created_at: string;
  /** Lần đổi gần nhất (tạo/cấp/hoàn tất/hủy) — xếp yêu cầu vừa có phản hồi lên đầu. */
  updated_at: string;
  lines: StockRequestLine[];
}

export interface StockRequestPage {
  items: StockRequest[];
  total: number;
}

export interface StockRequestListParams {
  q?: string | null;
  loai?: StockRequestKind | null;
  trang_thai?: StockRequestStatus[];
  kho_id?: number | null;
  /** true = CHỈ yêu cầu điều chuyển (tab Điều chuyển) · false = nhập/xuất thường · bỏ = không lọc. */
  dieu_chuyen?: boolean | null;
  /** Kỳ (tu_ngay/den_ngay/moc ∈ tao, can, duyet) + điều kiện bo_phan, to, nguoi_yeu_cau, kho, lenh, vat_tu. */
  loc?: ThamSoLoc;
  /** Thứ tự: "id" = mới tạo trước (mặc định) · "updated" = vừa đổi trước (Hộp yêu cầu). */
  order?: "id" | "updated";
  page?: number;
  size?: number;
}

/** Query-string các bộ lọc yêu cầu kho — dùng chung cho `list` + `tabCounts` (KHÔNG gồm page/size). */
function stockRequestQS(params: StockRequestListParams): URLSearchParams {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.loai) qs.set("loai", params.loai);
  // `trang_thai` là list ở backend → lặp param, KHÔNG nối bằng dấu phẩy.
  for (const s of params.trang_thai ?? []) qs.append("trang_thai", s);
  if (params.kho_id != null) qs.set("kho_id", String(params.kho_id));
  if (params.dieu_chuyen != null) qs.set("dieu_chuyen", String(params.dieu_chuyen));
  ganThamSoLoc(qs, params.loc);
  return qs;
}

export interface StockRequestLineInput {
  // Mặt hàng BẮT BUỘC chọn từ danh mục gốc — không còn đường gõ tên tự do.
  hang_loai: HangLoai;
  hang_id: number;
  /** Xin CHO LỆNH NÀO (mg 0175) — bỏ trống được (xin lặt vặt). Server kiểm id có thật. */
  lsx_id?: number | null;
  bai_ghep_id?: number | null;
  /** GIẤY: khổ mm (đủ hai cạnh, hoặc chỉ rộng). Đơn vị gốc máy chủ tự suy từ `dvt`.
   *  Hàng khác: bỏ trống (máy chủ ép 0 · 0). */
  kho_rong?: number;
  kho_dai?: number;
  dvt: string;
  sl_de_nghi: number;
  /** Đơn giá NHẬP người đề nghị khai (chỉ đề nghị NHẬP), theo `dvt`. Phiếu kế thừa; kho không sửa. */
  don_gia?: number | null;
  ghi_chu?: string | null;
}

export interface StockRequestInput {
  loai: StockRequestKind;
  /** Kho KHÔNG chọn ở đề nghị nữa — quyết ở bước lập phiếu. Giữ optional cho tương thích. */
  kho_id?: number | null;
  /** Số đề nghị tự nhập; bỏ trống → hệ thống tự sinh. */
  ma?: string | null;
  ngay_can?: string | null;
  /** Giờ cần "yyyy-mm-ddTHH:mm:00" (giờ tường VN). Có thì máy chủ tự suy `ngay_can` từ đây;
   *  null = chỉ có ngày. */
  can_luc?: string | null;
  uu_tien?: StockPriority;
  ghi_chu?: string | null;
  /** Mã loại nhập/xuất kho (MISA) — người tạo gõ tay; báo cáo dùng để export. */
  loai_kho?: string | null;
  /** Nguồn đợt giao đơn mua (chỉ khi tạo từ nút "Nhập kho" ở đợt) — chặn nhập trùng. */
  purchase_delivery_id?: number | null;
  lines: StockRequestLineInput[];
}

export interface StockRequestUpdateInput {
  ngay_can?: string | null;
  can_luc?: string | null;
  uu_tien?: StockPriority;
  ghi_chu?: string | null;
  loai_kho?: string | null;
  lines?: StockRequestLineInput[];
}

/** Báo cáo kho (kế toán) — 1 dòng hàng của 1 phiếu đã ghi sổ. docs/spec-bao-cao-kho.md */
export interface BaoCaoKhoRow {
  voucher_id: number;
  ngay_ghi_so: string | null;
  ngay_ct: string | null;
  so_ct: string;
  loai: StockRequestKind;
  loai_kho: string | null;
  ma_hang: string | null;
  ten_hang: string | null;
  dvt: string | null;
  /** Giấy: khổ của dòng phiếu (cột Khổ) + đơn vị gốc. Hàng khác: "" · 0 · 0. */
  don_vi_goc: string;
  kho_rong: number;
  kho_dai: number;
  so_luong: number;
  don_gia: number | null;
  thanh_tien: number | null;
  kho_id: number | null;
  kho_ten: string | null;
  /** Hạn sử dụng của lô dòng này (ISO yyyy-mm-dd) — từ stock_lots.hsd. */
  han_su_dung: string | null;
  /** ĐIỀU CHUYỂN nội bộ: gắn nhãn "điều chuyển" + LOẠI khỏi tổng mua/bán ở Tổng quan. */
  dieu_chuyen: boolean;
  hang_loai?: string | null;
  /** Nhóm hàng của điều kiện "Loại hàng": giay | vat_tu | thanh_pham. */
  nhom_hang?: string | null;
  /** Tên (hoặc khoảng ngày) kỳ ĐÃ KHÓA SỔ phủ ngày chứng từ của dòng; null = chưa khóa. */
  ky_khoa?: string | null;
  /** Phiếu sinh ra từ đâu: mã (nhap_mua, nhap_thanh_pham, xuat_giao_khach…) + chữ hiện. */
  ly_do?: string | null;
  ly_do_ten?: string | null;
  lenh?: string | null;
  don_hang?: string | null;
  khach_hang?: string | null;
  /** NCC của đợt mua, hoặc nhà gia công ngoài. */
  nha_cung_cap?: string | null;
  bo_phan?: string | null;
  ma_yeu_cau?: string | null;
  nguoi_giao_nhan?: string | null;
  nguoi_lap?: string | null;
  dien_giai?: string | null;
}

/** Một giá trị chọn được trong nút Lọc của Báo cáo kho + số dòng mang nó (đếm trước khi áp lọc). */
export interface LuaChonDem {
  value: string;
  nhan: string;
  so: number;
}

/** Giá trị cho nút Lọc của các bảng Báo cáo kho — chỉ những giá trị có trong kỳ + kho đang xem. */
export interface LuaChonBaoCaoKho {
  hang_loai: LuaChonDem[];
  mat_hang: LuaChonDem[];
  phat_sinh: LuaChonDem[];
  ton: LuaChonDem[];
  loai_phieu?: LuaChonDem[];
  ly_do?: LuaChonDem[];
  khach_hang?: LuaChonDem[];
  nha_cung_cap?: LuaChonDem[];
}

/** Điều kiện THUỘC TÍNH của nút Lọc (chọn nhiều — khớp một trong các giá trị). Lọc ở máy chủ,
 *  cả bảng lẫn file Excel. `phat_sinh` / `ton` chỉ Nhập-Xuất-Tồn nhận; phần còn lại của Chi tiết phiếu. */
export interface LocThuocTinhKho {
  /** giay | vat_tu | thanh_pham. */
  hang_loai?: string[];
  mat_hang?: string[];
  phat_sinh?: string[];
  ton?: string[];
  /** Chi tiết phiếu: NHAP | XUAT. */
  loai_phieu?: string[];
  ly_do?: string[];
  khach_hang?: string[];
  nha_cung_cap?: string[];
}

const KHOA_LOC_NHIEU = [
  "hang_loai", "mat_hang", "phat_sinh", "ton", "loai_phieu", "ly_do", "khach_hang", "nha_cung_cap",
] as const;

/** Đắp điều kiện thuộc tính vào query (khoá lặp cho danh sách). */
function setLocThuocTinhQs(qs: URLSearchParams, l: LocThuocTinhKho | undefined): void {
  if (!l) return;
  for (const k of KHOA_LOC_NHIEU) {
    for (const v of l[k] ?? []) qs.append(k, v);
  }
}

export interface BaoCaoKhoPage {
  items: BaoCaoKhoRow[];
  total: number;
  /** Tổng thành tiền mọi dòng khớp lọc; null khi không có ô xem giá. */
  tong_tien?: number | null;
  lua_chon?: LuaChonBaoCaoKho | null;
}

/** Bộ lọc funnel theo CỘT (giống bảng đang xem) — để "xuất Excel" = đúng bảng, không kéo thừa dòng
 *  đã bị lọc cột. Khoảng BAO GỒM hai đầu; để trống = không chặn. */
export interface BaoCaoFunnel {
  sl_from?: number | null;   // Số lượng
  sl_to?: number | null;
  dg_from?: number | null;   // Đơn giá / đơn giá vốn
  dg_to?: number | null;
  tt_from?: number | null;   // Thành tiền / tiền vốn
  tt_to?: number | null;
}

export interface BaoCaoKhoParams extends BaoCaoFunnel {
  /** Kỳ của thanh lọc chung (06/10/2026): `moc` = `ct` (ngày chứng từ) | `ghi_so` (ngày ghi sổ). */
  tu_ngay?: string | null;
  den_ngay?: string | null;
  moc?: string | null;
  kho_id?: number | null;
  loai?: StockRequestKind | null;
  /** Tìm số CT / mã hàng / tên hàng — để "lọc gì = xuất nấy" (cả bảng lẫn file). */
  q?: string | null;
  /** Trang (máy chủ cắt); bỏ trống = lấy hết (tab Tổng quan). Không dùng cho file Excel. */
  page?: number | null;
  size?: number | null;
  /** Điều kiện thuộc tính của nút Lọc. */
  loc?: LocThuocTinhKho;
}

/** Kỳ + kho + tìm + trang + khoảng số của báo cáo kho vào query. */
function setBaoCaoKhoQs(qs: URLSearchParams, p: Omit<BaoCaoKhoParams, "loai">): void {
  if (p.tu_ngay) qs.set("tu_ngay", p.tu_ngay);
  if (p.den_ngay) qs.set("den_ngay", p.den_ngay);
  if (p.moc) qs.set("moc", p.moc);
  if (p.kho_id != null) qs.set("kho_id", String(p.kho_id));
  if (p.q?.trim()) qs.set("q", p.q.trim());
  if (p.page != null) qs.set("page", String(p.page));
  if (p.size != null) qs.set("size", String(p.size));
  setFunnelQs(qs, p);
  setLocThuocTinhQs(qs, p.loc);
}

/** Đắp 6 tham số khoảng số (nếu có) vào query — dùng chung cho sổ kho lẫn file Excel. */
function setFunnelQs(qs: URLSearchParams, f: BaoCaoFunnel): void {
  if (f.sl_from != null) qs.set("sl_from", String(f.sl_from));
  if (f.sl_to != null) qs.set("sl_to", String(f.sl_to));
  if (f.dg_from != null) qs.set("dg_from", String(f.dg_from));
  if (f.dg_to != null) qs.set("dg_to", String(f.dg_to));
  if (f.tt_from != null) qs.set("tt_from", String(f.tt_from));
  if (f.tt_to != null) qs.set("tt_to", String(f.tt_to));
}

/** Báo cáo kho — 1 dòng điều chuyển đã ghi sổ (Xuất tại kho → Nhập tại kho). */
export interface BaoCaoChuyenKhoRow {
  voucher_id: number;
  ngay_ghi_so: string | null;
  ngay_ct: string | null;
  so_ct: string;
  ma_hang: string | null;
  ten_hang: string | null;
  dvt: string | null;
  so_luong: number;
  don_gia_von: number | null;
  tien_von: number | null;
  kho_xuat_ten: string | null;
  kho_nhap_ten: string | null;
  /** ID kho nguồn/đích — để Sổ Chuyển kho tô màu + ổ khóa theo kỳ đã khóa (như Nhập/Xuất). */
  kho_xuat_id: number | null;
  kho_nhap_id: number | null;
  dien_giai: string | null;
  hang_loai?: string | null;
  nhom_hang?: string | null;
  ky_khoa?: string | null;
}

export interface BaoCaoChuyenKhoPage {
  items: BaoCaoChuyenKhoRow[];
  total: number;
  /** Tổng tiền vốn mọi dòng khớp lọc; null khi không có ô xem giá. */
  tong_tien?: number | null;
  lua_chon?: LuaChonBaoCaoKho | null;
}

/** Sổ chuyển kho nhận đúng bộ tham số của sổ nhập/xuất, trừ chiều. */
export type BaoCaoChuyenKhoParams = Omit<BaoCaoKhoParams, "loai">;

/** 1 dòng Nhập-Xuất-Tồn theo kỳ (bình quân gia quyền cuối kỳ) của 1 mặt hàng tại 1 kho. */
export interface BaoCaoNXTRow {
  kho_id: number | null;
  kho_ten: string | null;
  hang_loai: string;
  hang_id: number;
  ma_hang: string | null;
  ten_hang: string | null;
  hang_nhom: string | null;
  nhom_hang?: string | null;
  dvt: string | null;
  /** Khổ giấy (mm) — dòng giấy tách theo mã + khổ + đơn vị gốc. Hàng khác: 0 · 0. */
  kho_rong: number;
  kho_dai: number;
  /** Giấy: đơn vị gốc của dòng (`to`, `kg`…). Hàng khác "". */
  don_vi_goc?: string;
  dau_sl: number;
  // Bốn ô GIÁ TRỊ về null khi vai không có ô "Xem giá thành" của Kho — xem `_an_tien` bên
  // `routers/kho_baocao.py`. Số lượng vẫn đủ, chỉ tiền là trống.
  dau_gt: number | null;
  nhap_sl: number;
  nhap_gt: number | null;
  xuat_sl: number;
  xuat_gt: number | null;
  cuoi_sl: number;
  cuoi_gt: number | null;
  don_gia_bq: number | null;
}

export interface BaoCaoNXTPage {
  items: BaoCaoNXTRow[];
  total: number;
  tu: string | null;
  den: string | null;
  /** Kỳ này ĐÃ tính giá (có snapshot chốt) chưa. false = đang tạm tính live. */
  da_tinh: boolean;
  /** Kỳ này (theo ngày cuối) đã khóa sổ chưa — đã khóa thì không tính lại. */
  da_khoa: boolean;
  /** `den` rơi GIỮA một kỳ ĐÃ TÍNH (chốt ở ngày khác): mốc chốt + tên kỳ đó. Khi có, bảng vẫn
   *  hiện Giá trị cuối kỳ nhưng là số TẠM TÍNH tới `den` (khác số đã chốt). */
  ky_da_tinh_den: string | null;
  ky_da_tinh_ten: string | null;
  lua_chon?: LuaChonBaoCaoKho | null;
}

export interface BaoCaoNXTParams {
  tu: string;
  den: string;
  kho_id?: number | null;
  q?: string | null;
  loc?: LocThuocTinhKho;
}

export interface TinhGiaKyInput {
  tu: string;
  den: string;
  ten?: string | null;
  kho_id?: number | null;
}

/** Khóa/mở kỳ kế toán kho — 1 thao tác trên KHOẢNG ngày. kho_id null = toàn kho. Append-only = lịch sử. */
export interface KhoKhoaSoRow {
  id: number;
  kho_id: number | null;
  kho_ten: string | null;
  tu_ngay: string;
  den_ngay: string;
  hanh_dong: "khoa" | "mo";
  nguoi_khoa_ten: string | null;
  khoa_luc: string | null;
  ten: string | null;
}

export interface KhoKhoaSoInput {
  kho_id?: number | null;
  tu_ngay: string;
  den_ngay: string;
  hanh_dong: "khoa" | "mo";
  /** Tên kỳ — chỉ gửi khi khóa; trùng tên kỳ đang khóa khác thì backend chặn. */
  ten?: string | null;
}

/** 1 lần XUẤT EXCEL báo cáo kho — cho tab "Lịch sử thao tác". */
export interface KhoExportLog {
  thoi_diem: string;
  hanh_dong: string;            // "export" (xuất Excel) | "tinh_gia" (tính giá kỳ)
  loai: string;                 // "Nhập kho" / "Xuất kho" / "Chuyển kho" / "Tính giá kỳ"
  pham_vi: string;              // loại · kho
  khoang_ngay: string | null;
  ten_ky: string | null;        // tên kỳ nếu khoảng ngày trùng kỳ đã khóa; "Toàn bộ" nếu ko lọc ngày
  nguoi_ten: string | null;
}

/** 1 kỳ CÒN đang khóa (đã gộp khoảng liền mạch) — cho tab "Kỳ đã khóa". */
export interface KhoaSoKyRow {
  kho_id: number | null;
  kho_ten: string | null;
  tu_ngay: string;
  den_ngay: string;
  khoa_luc: string | null;
  ten: string | null;
  /** (Kỳ TOÀN KHO) tên các kho đã MỞ RIÊNG trong kỳ này → hiển thị "Toàn kho — trừ: …". */
  mien_tru?: string[];
}

/** 1 kỳ ĐÃ TÍNH GIÁ (có snapshot) — cho tab "Kỳ đã tính". */
export interface KyDaTinh {
  tu_ngay: string;
  den_ngay: string;
  ten: string | null;
  so_mat_hang: number;
  so_kho: number;
  tong_gt_cuoi: number;
  tinh_luc: string;
  da_khoa: boolean;
}

/** Ô chọn vật tư khi lập đề nghị — 4 trường tối thiểu, KHÔNG có giá. */
export interface StockMaterialOption {
  id: number;
  code: string | null;
  name: string | null;
  unit: string | null;
  don_vi_phu?: string | null;
  he_so_quy_doi?: number | null;
}

/** Loại mặt hàng gốc — hai danh mục, hai dãy id riêng nên luôn đi theo CẶP với `hang_id`. */
export type HangLoai = "giay" | "vat_tu";

// --- Kế hoạch vật tư: bảng CÂN ĐỐI -----------------------------------------
// ⚠️ KHÔNG có trường tiền nào ở đây, và đừng thêm: bảng mở cho vai Kế hoạch SX, còn giá vốn lô
// hàng thuộc quyền Kho/Kế toán (`view_cost`).

/** Màu của một dòng cân đối. `khong_ro` = KHÔNG quy đổi được đơn vị ⇒ máy chưa đánh giá được —
 *  cố ý tách khỏi `xam` ("đã cấp đủ"), vì dán nhãn đủ lên dòng chưa ai tính nổi là nói ngược.
 *  Không còn `ve_muon` (18/09/2026): hệ không suy ngày cần nên không có mốc nào để chê hàng về muộn. */
export type CanDoiMau = "xam" | "xanh" | "vang" | "do" | "khong_ro";

/** Trạng thái GIỮ CHỖ 5 mức — khác `CanDoiMau` (3 mức trung tính gộp lại): ở đây tách được "đã
 *  giữ" khỏi "có thể giữ nhưng chưa bật" khỏi "đã cấp thật". */
export type TrangThaiGiu = "khong_ro" | "thieu" | "co_the_giu" | "da_giu" | "da_cap";

export interface CanDoiDong {
  /** `vat_tu` = so tồn · `cong_cu` = khuôn bế, KHÔNG so tồn (chỉ hỏi sẵn sàng đúng lúc chưa). */
  loai: "vat_tu" | "cong_cu";
  lsx_id: number | null;
  bai_ghep_id: number | null;
  /** Bước tiêu thụ — phần thứ NĂM của khoá dòng. Một lệnh có nhiều công đoạn và mỗi công đoạn khai
   *  vật tư riêng, nên cùng một món ở hai bước là HAI dòng; thiếu nó thì hai dòng trùng khoá và
   *  yêu cầu mua ra đúng một nửa số cần. Phải gửi lại y nguyên ở `CanDoiKhoaDong`. */
  buoc_id: number | null;
  ma: string;
  /** Lệnh có cờ GẤP — CHỈ ĐỂ BÀY. Máy không xếp ưu tiên, không cướp chỗ; người lập kế hoạch nhìn
   *  rồi tự quyết. */
  is_rush: boolean;
  ten_viec: string | null;
  /** "Ngày cần hàng" người lập gõ trên yêu cầu mua đã lập cho lệnh/bài này (sớm nhất) — đọc ngược,
   *  KHÔNG suy. Chưa lập yêu cầu mua nào (vd tồn đủ) ⇒ `null`, hiện trống. */
  ngay_can: string | null;
  /** Khách của lệnh. Dòng BÀI GHÉP gom nhiều lệnh: một khách thì là tên, nhiều khách thì server
   *  trả thẳng chuỗi `"3 khách"` — FE in nguyên, không tự diễn giải. */
  khach_ten: string | null;
  /** Hạn giao KHÁCH — khác hạn nội bộ mà bảng dùng xếp thứ tự ăn tồn. */
  han_giao_khach: string | null;
  /** Mọi số theo ĐƠN VỊ GỐC của mặt hàng. null ở dòng công cụ. */
  nhu_cau: number | null;
  /** Hai đơn vị cùng lúc: "2.961 tờ ≈ 116 kg". */
  nhu_cau_hien_thi: string;
  da_cap: number | null;
  /** CHỈ LÀ NHÃN — hàng chưa ra khỏi kho thì tồn vẫn còn, không vào phép trừ nào. */
  dang_linh: number | null;
  con_phai_co: number | null;
  con_lai_sau: number | null;
  /** Phần thiếu RIÊNG của dòng (không phải luỹ kế) — tick nhiều dòng rồi cộng vẫn đúng. */
  thieu: number | null;
  trang_thai: CanDoiMau;
  /** [MỚI 30/08/2026] Giữ chỗ gộp theo (chủ thể, mặt hàng) — KHÔNG phải phần riêng của dòng khi
   *  cùng chủ thể ăn cùng món ở nhiều bước. */
  da_giu_kho: number | null;
  da_giu_dang_ve: number | null;
  co_the_giu_kho: number | null;
  co_the_giu_dang_ve: number | null;
  trang_thai_giu: TrangThaiGiu | null;
  nguon_dang_ve: { purchase_request_line_id: number; ma_pmh: string | null; so_luong: number }[] | null;
  canh_bao: string[];
  ly_do_canh_bao: string | null;
  /** Nhu cầu ra đơn vị mà mã CHƯA khai ở danh mục (nhóm gốc `don_vi_goc` của nhóm) — dòng này
   *  không lập mua được, bảng ghi "Chưa khai đơn vị «X» ở danh mục" thay ô tick. */
  don_vi_chua_khai?: boolean;
  /** Yêu cầu/đơn "Mua cho" lệnh này mà KHÁC khổ/ĐVT với nhu cầu (lỗi #23) — không bù số. */
  mua_khac_quy_cach?: MuaKhacQuyCach[];
}

/** Một yêu cầu/đơn "Mua cho" lệnh nhưng khác khổ hoặc ĐVT với nhu cầu — chỉ để gọi tên. */
export interface MuaKhacQuyCach {
  ma: string;
  so_luong: number;
  /** MÃ đơn vị trên dòng đơn — dịch bằng `tenGoc`/`nhanDonVi`. */
  don_vi: string | null;
  kho_rong: number;
  kho_dai: number;
}

/** Một phiếu ĐANG CHẠY của mặt hàng — chỉ đủ để GỌI TÊN, không mang số lượng, không mang tiền.
 *
 *  Trả lời câu *"cái nào đang yêu cầu mua"*: trước đó ba tình huống rất khác nhau (chưa ai mua ·
 *  đã đề nghị chờ duyệt · đã duyệt mà NCC chưa hẹn ngày) đều vẽ ĐỎ giống hệt, nên người dùng bấm
 *  Mua chồng lên phiếu đã có. */
/** Một lệnh (hoặc bài ghép) sắp lĩnh mặt hàng — `GET /api/kho/phieu/lo/du-bao`. */
export interface DuBaoLenhRow {
  ma: string;
  lsx_id: number | null;
  bai_ghep_id: number | null;
  ten_viec: string | null;
  khach_ten: string | null;
  /** Hạn hoàn thành SX nội bộ — thứ tự ăn tồn của bảng cân đối. */
  han_sx: string | null;
  can: number;
  da_giu: number;
  /** Có ⇒ đây là ĐỀ NGHỊ XUẤT còn treo ở kho (giao hàng, gia công ngoài, xuất lẻ), không phải lệnh:
   *  `ma` là số đề nghị, `han_sx` là ngày cần. */
  de_nghi_id?: number | null;
}

/** Tồn toàn xưởng của MỘT khoá khổ + đơn vị gốc — `GET /api/kho/phieu/lo/ton-khoa`. */
export interface TonKhoaRow {
  kho_rong: number;
  kho_dai: number;
  ton: number;
  don_vi_goc: string | null;
  don_vi_goc_ten: string | null;
}

/** Nhóm lọc của màn Tồn kho — máy chủ đếm trên tập đã lọc bởi ô tìm, kỳ Nhập và các khoảng; bỏ riêng bộ lọc nhóm (`GET /api/kho/phieu/lo/ton-nhom`). */
export type NhomTon = "all" | "can_mua" | "du_ton" | "chuakhai" | "sap_het_han";

/** Một trang màn Tồn kho: `items` = lô của các MẶT HÀNG trong trang (màn gom lại thành dòng),
 *  `total` = số mặt hàng khớp lọc, `dem` = số mặt hàng theo 5 nhóm lọc, đếm trên tập đã lọc bởi ô tìm,
 *  kỳ Nhập và các khoảng; bỏ riêng bộ lọc nhóm. */
export interface TonNhomPage {
  items: StockLot[];
  total: number;
  dem: Record<NhomTon, number>;
  co_hsd: boolean;
  /** Phán quyết + số dự báo của từng dòng tồn TRONG TRANG — máy chủ là nguồn duy nhất. */
  nhom: TonNhomMuc[];
  /** false = dự báo hỏng tạm thời: "Cần mua" lùi về mức tồn so với ngưỡng, số dự báo để trống. */
  du_bao_ok: boolean;
  /** Mọi mặt hàng của kho là thành phẩm — nhóm lọc "Cần mua" gọi là "Cần sản xuất". */
  chi_thanh_pham?: boolean;
}

/** Chip Tình trạng của dòng tồn: `het` · `can_mua` · `vuot` · `se_vuot` · `chua` · null (trong mức). */
export type TinhTrangTon = "het" | "can_mua" | "vuot" | "se_vuot" | "chua";

/** Phán quyết của MỘT dòng tồn. `khoa` = khoá dòng tồn dạng chuỗi (cùng dạng `khoaTon` của màn). */
export interface TonNhomMuc {
  /** "giay:12:780:905:to" — giấy; "vat_tu:5:0:0:" — hàng khác. */
  khoa: string;
  hang_loai: HangLoai;
  hang_id: number;
  kho_rong: number;
  kho_dai: number;
  don_vi_goc?: string;
  can_mua: boolean;
  /** Đã khai ngưỡng cho dòng này ở kho này. */
  co_nguong: boolean;
  /** Mặt hàng là thành phẩm — thiếu thì sản xuất chứ không mua (chip ghi "Cần sản xuất"). */
  la_thanh_pham?: boolean;
  tinh_trang: TinhTrangTon | null;
  can_lenh: number | null;
  dang_ve: number | null;
  du_kien: number | null;
  duoi_cuoi: boolean;
  /** Dòng dự báo đầy đủ (lệnh, đơn về) cho ngăn chi tiết; null khi dự báo hỏng. */
  du_bao: DuBaoTonRow | null;
}

export interface DuBaoTonRow {
  hang_loai: HangLoai;
  hang_id: number;
  kho_rong: number;
  kho_dai: number;
  /** Tồn mọi kho mà bảng cân đối dùng; `null` = chưa lệnh nào cần mã này. */
  ton_toan_xuong: number | null;
  can_lenh: number;
  dang_ve: number;
  lenh: DuBaoLenhRow[];
  ve: { ma: string | null; ngay_ve: string; sl: number; mua_cho?: MuaChoLenh[]; loai_mua_cac?: LoaiMua[] }[];
  phieu_mua: PhieuMuaTom[];
}

export interface PhieuMuaTom {
  /** `PMH-…` (phiếu của thu mua) hoặc `YCMH-…` (đề nghị của bộ phận). */
  ma: string;
  /** Hai chuỗi khác nhau, tra ở hai màn khác nhau, nên phải phân biệt được. */
  loai: "pmh" | "ycmh";
  /** Trạng thái THÔ (`pending_approval`, `approved`, `open`, `in_purchase`…). Dịch ở FE để đổi
   *  chữ khỏi phải đụng backend. */
  trang_thai: string;
  /** Chỉ PMH đã hẹn ngày mới có. `null` = đã có người lo nhưng chưa hứa được ngày nào. */
  ngay_ve: string | null;
}

export interface CanDoiNhom {
  loai_nhom: "vat_tu" | "cong_cu";
  hang_loai: string;
  hang_id: number;
  hang_ma: string | null;
  hang_ten: string | null;
  /** Khổ giấy tờ (mm, ngắn × dài) — nhóm giấy là (mã, khổ); vật tư khác và giấy chưa khổ 0 · 0. */
  kho_rong: number;
  kho_dai: number;
  don_vi_goc: string | null;
  ton: number | null;
  /** Cùng mã + cùng khổ, khác đơn vị gốc — chỉ để hiện cạnh `ton`, không trừ. */
  cung_kho_khac_don_vi?: CungKhoKhacDonVi[];
  tong_can: number | null;
  so_dong_do: number;
  /** Số dòng KHÔNG đánh giá được. Bộ lọc "chỉ mặt hàng đang thiếu" GIỮ LẠI nhóm có số này > 0. */
  so_dong_khong_ro: number;
  khuon_tinh_trang: string | null;
  /** Phiếu đang chạy của mặt hàng, xếp CHẮC → LỎNG (đã duyệt có ngày về đứng đầu). Treo ở NHÓM
   *  chứ không ở dòng: phiếu mua không biết lệnh nào, nó chỉ biết mua món gì. */
  phieu_mua: PhieuMuaTom[];
  dong: CanDoiDong[];
  /** Đơn vị gốc `don_vi_goc` của nhóm CHƯA khai ở danh mục mặt hàng — mọi dòng của nhóm không lập
   *  mua được (xem `CanDoiDong.don_vi_chua_khai`). */
  don_vi_chua_khai?: boolean;
}

/** `bo_qua` (lệnh/bài không cân đối được) GỠ 23/09/2026 — chưa khai vật tư thì vắng mặt, không
 *  cảnh báo; cửa chặn nằm ở xếp lịch. */
export interface CanDoiOut {
  items: CanDoiNhom[];
  /** Số lệnh giữ lâu chưa vào kế hoạch — toàn xưởng, không theo `q` (cùng nghĩa `TheoLenhOut`). */
  so_giu_lau: number;
  /** Số trên thanh tab: sau `q` + `hang_loai`, TRƯỚC `tinh_trang`; `theo_loai` trước `hang_loai`. */
  dem?: {
    so_nhom: number;
    so_dong_do: number;
    so_dong_khong_ro: number;
    so_nhom_du: number;
    theo_loai: Record<string, number>;
  } | null;
}

/** Khoá của một dòng trên bảng — đủ để server tìm lại và TỰ tính phần thiếu.
 *
 *  ⚠️ BẢY phần tử, phải khớp `_khoa_dong()` bên `services/ke_hoach_vat_tu_service.py`. Lệch một
 *  phần tử là server tra không ra dòng nào và MỌI lần bấm "Đề nghị mua" trả 400 với câu lỗi chỉ
 *  sai đường ("tải lại bảng" — tải lại vẫn lỗi). */
export interface CanDoiKhoaDong {
  hang_loai: HangLoai;
  hang_id: number;
  /** Khổ của dòng giấy (0 · 0 với vật tư khác) — cùng mã khác khổ là hai dòng khác nhau. */
  kho_rong: number;
  kho_dai: number;
  lsx_id: number | null;
  bai_ghep_id: number | null;
  buoc_id: number | null;
  /** Số đề nghị của dòng (đơn vị gốc) — xem-trước trả về, form gửi nguyên văn lúc Lưu. */
  so_luong?: number | null;
}

/** Bản NHÁP của yêu cầu mua, tính từ các dòng đã tick — server CHƯA ghi gì.
 *
 *  Dùng để mở form "Tạo yêu cầu mua hàng" đã điền sẵn: nội dung · từng dòng vật tư đã gộp theo
 *  mặt hàng · lệnh nguồn. Người dùng gõ NGÀY CẦN HÀNG rồi tự bấm Lưu — yêu cầu chỉ sinh ra lúc đó. */
export interface DeNghiMuaXemTruoc {
  related_document_type: string;
  related_document_code: string;
  /** Luôn `null` (18/09/2026): hệ không suy ngày cần — để trống cho người lập tự gõ. */
  needed_date: string | null;
  noi_dung: string;
  lines: {
    hang_loai: HangLoai;
    hang_id: number;
    item_name: string;
    unit: string;
    quantity: number;
    /** Khổ CẦN của dòng giấy (0 · 0 với vật tư khác). */
    kho_rong: number;
    kho_dai: number;
  }[];
  /** Khoá các dòng đã tick — form gửi nguyên văn vào `nguon_lenh` lúc Lưu. */
  nguon: CanDoiKhoaDong[];
}

/* ---------------- Lưới Kế hoạch vật tư (spec một ô một phiếu, 07/10/2026) ---------------- */

/** Bước của phiếu mua (mạch yêu cầu → đơn → nhập kho). */
export type BuocPhieu =
  | "moi_de_nghi"
  | "don_bi_tra"
  | "dang_lap_don"
  | "cho_duyet"
  | "da_dat_hang"
  | "da_nhap_kho";

/** Tình trạng của MỘT Ô (lệnh × mặt hàng). */
export type TinhTrangO =
  | "chua_tinh"
  | "can_mua"
  | "nen_nha"
  | "dang_mua"
  | "chua_giu"
  | "cho_ve"
  | "co_kho"
  | "da_xuat";

export interface LuoiPhieu {
  /** Mã đơn nếu đã có đơn sống, không thì mã yêu cầu. */
  ma: string;
  loai: "pmh" | "ycmh";
  buoc: BuocPhieu;
  ngay_ve: string | null;
  yc_ma: string;
  yc_id: number;
  yc_line_id: number;
  pr_id: number | null;
  co_don: boolean;
  /** Huỷ được (huỷ món trên yêu cầu) — chưa đơn sống nào nắm món. */
  co_the_huy: boolean;
  /** Chỉ có ở danh sách "phiếu nên huỷ". */
  lap_cho: string[];
  ly_do: string | null;
  /** Số phiếu đặt cho ô này — chỉ có ở phiếu của dòng lưới. */
  phan?: number | null;
}

/** Tồn/đang về cùng mã + cùng khổ nhưng khác đơn vị gốc (vd. nhóm tính theo tờ, kho còn giấy
 *  cùng khổ nhập theo kg). */
export interface CungKhoKhacDonVi {
  don_vi_goc: string;
  don_vi_goc_ten: string;
  ton: number;
  dang_ve: number;
}

export interface LuoiDong {
  khoa: string;
  chu: string;
  lsx_id: number | null;
  bai_ghep_id: number | null;
  ma: string;
  /** Lệnh đã ra khỏi kế hoạch. */
  ngoai_pham_vi?: boolean;
  hang: string;
  hang_loai: HangLoai;
  hang_id: number;
  kho_rong: number;
  kho_dai: number;
  hang_ma: string | null;
  hang_ten: string;
  dvt: string;
  /** Đơn vị gốc của dòng giấy / vật tư khác; "" với hàng khác. */
  don_vi_goc: string;
  /** Nhu cầu ra đơn vị mà mã CHƯA khai ở danh mục — dòng không lập mua được, bảng ghi "Chưa khai
   *  đơn vị «X» ở danh mục" thay ô tick. */
  don_vi_chua_khai?: boolean;
  can: number;
  da_xuat: number;
  giu_kho: number;
  giu_ve: number;
  /** Đã cấp cho xưởng + đã giữ trong kho + đã giữ trên đơn đang về (cột "Đã có"). */
  da_giu: number;
  con_thieu: number;
  /** Số sẽ đề nghị mua nếu tick — chỉ dòng "Cần mua". */
  so_de_nghi: number;
  phieu: LuoiPhieu | null;
  trung: LuoiPhieu[];
  /** Mã đơn mà ô đang giữ phần dư trên đó. */
  du_tu: string[];
  ngay_co_hang: { loai: "da_xuat" | "co_san" | "ngay_ve" | "hen" | null; ngay: string | null };
  tinh_trang: TinhTrangO;
  ghi_chu: string[];
  buoc: { buoc_id: number | null; ten_viec: string | null; can: number; da_xuat: number; thieu: number }[];
  khoa_mua: CanDoiKhoaDong[];
  /** Có ⇒ `khoa_mua` rỗng, ô tick xám (lỗi #23). */
  mua_khac_quy_cach?: MuaKhacQuyCach[];
}

export interface LuoiLichSu {
  luc: string | null;
  chu: string;
}

export interface LuoiLenh {
  chu: string;
  lsx_id: number | null;
  bai_ghep_id: number | null;
  ma: string;
  ten_sp: string | null;
  khach_ten: string | null;
  han_giao_khach: string | null;
  is_rush: boolean;
  ngoai_pham_vi: boolean;
  /** Công tắc giữ chỗ của lệnh. */
  bat: boolean;
  lich_su: LuoiLichSu[];
}

export interface LuoiDon {
  ma: string | null;
  buoc: BuocPhieu;
  ngay_ve: string | null;
  /** Đơn đã đặt: số còn đang về; đơn chưa đặt: số trên đơn. */
  so: number;
  dat_cho: { ma: string; so: number }[];
  du: number;
  giu_du: { ma: string; so: number }[];
  du_trong: number;
  da_dat: boolean;
}

export interface LuoiHang {
  hang: string;
  hang_loai: HangLoai;
  hang_id: number;
  kho_rong: number;
  kho_dai: number;
  kho: string | null;
  hang_ma: string | null;
  hang_ten: string;
  dvt: string;
  /** Đơn vị gốc của nhóm giấy / vật tư khác ("to", "kg", "thung"…); "" với hàng khác. */
  don_vi_goc: string;
  /** Đơn vị gốc của nhóm CHƯA khai ở danh mục mặt hàng (xem `LuoiDong.don_vi_chua_khai`). */
  don_vi_chua_khai?: boolean;
  ton: number;
  dang_ve: number;
  /** Tồn + đang về của CÙNG mã + CÙNG khổ nhưng KHÁC đơn vị gốc — chỉ để hiện cạnh số chính,
   *  máy KHÔNG trừ vào thiếu (tờ và kg không quy đổi). */
  cung_kho_khac_don_vi: CungKhoKhacDonVi[];
  can: number;
  da_giu: number;
  con_thieu: number;
  dat_du: number;
  don: LuoiDon[];
  nen_huy: LuoiPhieu[];
  ghi_chu: string[];
  lich_su: LuoiLichSu[];
}

export interface LuoiOut {
  items: { khoa: string; lenh: LuoiLenh | null; hang: LuoiHang | null; dong: LuoiDong[] }[];
  tong_nhom: number;
  tong_dong: number;
  page: number;
  size: number;
  dem: Record<string, number>;
}

export type LuoiThamSo = {
  xem: "lenh" | "hang";
  q?: string;
  tinh_trang?: TinhTrangO | "co_ghi_chu";
  hang_loai?: HangLoai;
  page?: number;
  size?: number;
};

/** Một MẶT HÀNG mà một lệnh/bài cần — đã gộp mọi công đoạn của lệnh đó. */
export interface TheoLenhHang {
  hang_loai: HangLoai;
  hang_id: number;
  /** Khổ giấy tờ (mm); vật tư và giấy cuộn 0 · 0. */
  kho_rong: number;
  kho_dai: number;
  hang_ma: string | null;
  hang_ten: string | null;
  don_vi_goc: string | null;
  /** Theo ĐƠN VỊ GỐC, đã trừ phần kho cấp rồi. */
  can: number;
  thieu: number;
  dang_giu: number;
  /** [MỚI 30/08/2026] Tách nguồn phần đã giữ + trạng thái giữ 6 mức — xem `TrangThaiGiu`. */
  da_giu_kho: number;
  da_giu_dang_ve: number;
  co_the_giu_kho: number;
  co_the_giu_dang_ve: number;
  trang_thai_giu: TrangThaiGiu;
  /** Mã PMH cụ thể đang góp cho `da_giu_dang_ve` — để hiện "đang bám đơn nào". */
  nguon_dang_ve: { purchase_request_line_id: number; ma_pmh: string | null; so_luong: number }[];
  /** >1 nghĩa là con số trên đã GỘP nhiều công đoạn — hiện ra để không ai tưởng đó là một bước. */
  so_buoc: number;
  /** Màu NẶNG NHẤT trong các bước. Thẻ chỉ hiện được một màu. */
  trang_thai: CanDoiMau;
  /** Ngày cần hàng trên yêu cầu mua đã lập cho lệnh này mua món này (sớm nhất). Chưa mua ⇒ `null`. */
  ngay_can: string | null;
  /** Bao nhiêu lệnh/bài KHÁC đang thiếu chính món này — câu *"nhả ra thì ai đỡ"* của hộp xác nhận.
   *  Server đếm trên TOÀN BỘ bảng, trước mọi bộ lọc. */
  so_lenh_khac_thieu: number;
  /** MỌI phiếu đang chạy của món (kể cả YCMH chưa duyệt, kể cả PMH chưa hẹn ngày), xếp CHẮC →
   *  LỎNG — "ai đang lo món này". */
  phieu_mua: PhieuMuaTom[];
  /** Khoá 7 phần của TỪNG dòng đỏ — gửi thẳng vào `deNghiMua`. Cố ý không gộp về một khoá cho
   *  mỗi mặt hàng: một lệnh ăn cùng món ở hai công đoạn là hai dòng, gộp là mua một nửa. */
  khoa_do: CanDoiKhoaDong[];
}

/** Một thẻ = MỘT lệnh (hoặc bài ghép) — cách nhìn *"lệnh này chạy được chưa"*. */
export interface TheoLenhRow {
  lsx_id: number | null;
  bai_ghep_id: number | null;
  ma: string;
  is_rush: boolean;
  /** Ngày cần hàng SỚM NHẤT trên các yêu cầu mua đã lập cho lệnh. Lệnh không phải mua ⇒ `null`. */
  ngay_can: string | null;
  /** Khách + hạn giao khách — xem `CanDoiDong.khach_ten` / `.han_giao_khach`. */
  khach_ten: string | null;
  han_giao_khach: string | null;
  /** Còn giữ chỗ nhưng ĐÃ RƠI khỏi bảng cân đối (lệnh bị kéo về nháp…). Vẫn trừ vào tồn tự do của
   *  mọi người khác, nên phải bày ra để có đường nhả. */
  ngoai_pham_vi: boolean;

  bat: boolean;
  /** Giữ đủ 100% ⇒ cửa xếp lịch mở. Đây là điều kiện DUY NHẤT của cửa đó. */
  du: boolean;
  khong_ro: boolean;
  da_xep_lich: boolean;
  giu_tu: string | null;
  so_ngay_giu: number | null;
  /** Đã bật · giữ quá ngưỡng · mà chưa hề đưa vào kế hoạch. Máy CHỈ BÀY, KHÔNG tự nhả. */
  giu_lau_chua_chay: boolean;

  so_mat_hang: number;
  so_thieu: number;
  so_khong_ro: number;
  hang: TheoLenhHang[];
}

export interface TheoLenhOut {
  items: TheoLenhRow[];
  /** Đếm trên TOÀN BỘ danh sách, không phải phần đang lọc. */
  so_giu_lau: number;
  /** Số trên thanh tab: sau `q` + `chi_can_lo`, TRƯỚC `giu`. */
  dem_theo_tab?: Partial<Record<"tat_ca" | "du" | "dang" | "tat" | "giu_lau", number>>;
}

// --- Hồ sơ lệnh sản xuất (module `lenh_san_xuat`) — màn TRA CỨU, chỉ đọc -----
// Mirror ĐÚNG `backend/app/schemas/lenh_san_xuat.py`. Bẫy Pydantic của repo: service trả `dict`,
// router khai `response_model` ⇒ trường không có trong schema bị NUỐT IM LẶNG (FE nhận
// `undefined`, không lỗi, không cảnh báo). Nên đừng khai thêm trường nào ở đây mà bên kia không
// có — và thêm thật thì phải đi hết chuỗi `danh_sach._dong()` → schema → type này.
//
// KHÔNG MỘT TRƯỜNG TIỀN NÀO (`don_gia`/`gia_von`/`thanh_tien`/`luong_khoan`/`chi_phi`) — ràng
// buộc cứng của cả module, có bài canh `test_khong_lo_tien` giữ ở máy chủ.

/** 6 trạng thái CHÍNH của một lệnh (`services/lenh_sx/trang_thai.TAB_CHINH`). Chuỗi khoá đi
 *  thẳng ra URL (`?tab=`) nên nó là HỢP ĐỒNG — đừng đổi cho "dễ đọc". */
export type LsxTheoDoiTrangThai =
  | "dang_sx" | "canh_bao" | "kcs" | "cho_nhap_kho" | "san_sang_giao" | "hoan_thanh";

export type LsxTheoDoiCanhBao =
  | "su_co" | "tam_dung" | "tre_han" | "kcs_khong_dat" | "thieu_vat_tu";

/** KHÂU của một lệnh (`trang_thai.KHAU` phía máy chủ, làm gọn 05/10/2026) — chia tab Hồ sơ lệnh
 *  và pill trạng thái. Khác `LsxTheoDoiTrangThai`: khâu KHÔNG đọc cờ cảnh báo. */
export type LenhSxKhau = "dang_sx" | "sau_sx" | "da_giao";

/** Chi tiết khi `khau = "sau_sx"`; còn lại `null`. */
export type LenhSxKhauChiTiet = "dang_kcs" | "cho_nhap_kho" | "san_sang_giao";

/** MỘT đốt trên dải công đoạn của một dòng bảng lệnh (`danh_sach.chang()` phía máy chủ).
 *  Một bước bị tách nhiều lần chạy vẫn gộp về MỘT đốt, và đúng một đốt mang `hien_tai`. */
export interface LenhSxChang {
  ten: string;
  nhom: string | null;
  /** `xong` · `chay` · `dung` · `cho` — hợp đồng với hằng `CHANG_*` của backend và với lớp
   *  `.lsc-chang__dot--*` bên CSS. Khai `string` chứ không union: giá trị lạ phải hiện ra thành
   *  đốt trung tính chứ không làm gãy cả bảng. */
  trang_thai: string;
  hien_tai: boolean;
  /** Bước thuê ngoài (viền cam) / bước có lô KCS không đạt (viền đỏ mảnh) — 12/10/2026. */
  ngoai?: boolean;
  kcs_loi?: boolean;
}

/** Bốn tab của Hồ sơ lệnh: "tất cả" + ba khâu. Khoá đi thẳng ra `?tab=` — hợp đồng. */
export type LenhSxTab = "tat_ca" | LenhSxKhau;

/** MỘT dòng bảng Hồ sơ lệnh (làm gọn 05/10/2026) — chỉ cột TĨNH. Không cờ cảnh báo, không tiến độ:
 *  việc đó của màn Theo dõi sản xuất. */
export interface LenhSxItem {
  id: number;
  ma: string;
  ten: string | null;
  so_luong_dat: number;
  don_vi_tinh: string | null;
  khach_hang: string | null;
  order_id: number | null;
  order_no: string | null;
  /** `date` (không có giờ) ⇒ format bằng `ngay()`. */
  han_hoan_thanh_sx: string | null;
  is_rush: boolean;
  khau: LenhSxKhau;
  khau_chi_tiet: LenhSxKhauChiTiet | null;
  /** KCS đã đóng lệnh (`lsx.trang_thai = da_dong`). Thẻ phụ, không phải khâu. */
  da_dong: boolean;
  /** Ngày tạo lệnh — cột "Ngày tạo" + mốc kỳ `tao`. */
  created_at?: string | null;
  /** Hạn giao khách (`date`) — cột "Hạn giao" thay Hạn SX (12/10/2026). */
  han_giao_khach?: string | null;
  /** Lệnh gia công trọn gói: `chang` rỗng, tuyến bước là MỘT chấm mang tên nhà gia công. */
  tron_goi?: boolean;
  nha_gia_cong?: string | null;
  /** Tuyến bước trong dòng — `danh_sach.chang()`. */
  chang?: LenhSxChang[];
}

export interface LenhSxListOut {
  items: LenhSxItem[];
  /** Tổng SAU cả `tab` — cho chân bảng. Con số cạnh tiêu đề là `dem_theo_tab.tat_ca`. */
  total: number;
  page: number;
  page_size: number;
  /** Đếm của tập ĐÃ LỌC, KHÔNG bị chính `tab` lọc lại. Cấm đếm lại từ `items`. */
  dem_theo_tab: Partial<Record<LenhSxTab, number>>;
}

/** MỘT ô chọn của ô Khách. `id` là SỐ (khác bộ lọc Theo dõi, nơi `id` là chuỗi). */
export interface LenhSxKhachLoc {
  id: number;
  ten: string | null;
}

/** Nguồn ô Khách — khách của chính các lệnh trong phạm vi người gọi (gác `lenh_san_xuat:read`). */
export interface LenhSxBoLocOut {
  khach_hang: LenhSxKhachLoc[];
}

export interface LenhSxDanhSachParams {
  tab?: LenhSxTab;
  q?: string;
  khach_hang_id?: number;
  order_id?: number;
  phu_trach_id?: number;
  gia_cong?: string;
  /** Khoảng ngày `YYYY-MM-DD` tính theo `moc`: `tao` ngày tạo lệnh (mặc định), `han_sx`, `han_giao`.
   *  Với mốc hạn, lệnh chưa khai hạn không nằm trong khoảng nào. */
  tu_ngay?: string;
  den_ngay?: string;
  moc?: string;
  page?: number;
  page_size?: number;
}

// --- Hồ sơ MỘT lệnh (Task 10 dựng API, Task 12 dựng màn) ---------------------
// 13 khối lồng nhau. Bẫy Pydantic ở đây nguy hơn hẳn màn danh sách: thiếu một trường trong MỘT
// khối con thì 12 khối kia vẫn ra bình thường — FE nhận `undefined` ở đúng một ô và không ai
// thấy lỗi. Mirror ĐÚNG `backend/app/schemas/lenh_san_xuat.py`, đừng thêm trường phía này.
// KHÔNG MỘT TRƯỜNG TIỀN NÀO — cùng ràng buộc cứng của cả module.

export interface LenhSxThongTin {
  id: number;
  ma: string;
  ten: string | null;
  loai: string | null;
  order_id: number | null;
  order_no: string | null;
  order_line_id: number | null;
  khach_hang: string | null;
  khach_hang_id: number | null;
  sale: string | null;
  so_luong_dat: number;
  don_vi_tinh: string | null;
  is_rush: boolean;
  /** `date` ⇒ `ngay()`. */
  han_hoan_thanh_sx: string | null;
  /** `date` ⇒ `ngay()`. */
  han_giao_khach: string | null;
  ban_giao_at: string | null;
  ghi_chu: string | null;
  tao_luc: string | null;
  /** KCS đã đóng lệnh — thẻ "Đã đóng lệnh" cạnh pill khâu. */
  da_dong: boolean;
  /** Tên nhóm thành phẩm (`nhom_lenh_giao.ten`) nếu lệnh đã vào nhóm. */
  nhom_ten: string | null;
}

export interface LenhSxTienDo {
  phan_tram: number;
  /** `true` = đo bằng THỜI LƯỢNG kế hoạch vì bước chưa khai sản lượng. Phải ra tới mặt màn. */
  uoc_tinh: boolean;
  gio_may: number;
  du_kien_xong: string | null;
  trang_thai: LsxTheoDoiTrangThai;
  canh_bao: LsxTheoDoiCanhBao[];
  buoc_hien_tai: string | null;
  buoc_hien_tai_cong_viec_id: number | null;
  nhom_cong_doan: string | null;
  may: string | null;
  nguoi: string[];
  /** Số đã giao của RIÊNG dòng đơn lệnh này — khác `giao_hang.da_giao` (cấp NHÓM). */
  da_giao: number;
  /** Khâu của lệnh — cùng hàm với cột Trạng thái ở danh sách. */
  khau: LenhSxKhau;
  khau_chi_tiet: LenhSxKhauChiTiet | null;
  /** Câu chữ đèn vật tư khi đèn ĐỎ (vd "Chưa giữ chỗ vật tư"); `null` khi không đỏ. */
  vat_tu_chu: string | null;
}

/** Ảnh chụp thông số kỹ thuật từ phiếu tính giá. Khoá thiếu (lệnh cũ) ⇒ `null` ⇒ UI hiện "—",
 *  KHÔNG đổi sang 0: 0 kẽm và "chưa khai số kẽm" là hai chuyện. */
export interface LenhSxThongSo {
  giay_ten: string | null;
  dinh_luong: number | null;
  kho_nguyen_dai: number | null;
  kho_nguyen_rong: number | null;
  kho_in_dai: number | null;
  kho_in_rong: number | null;
  dai_thanh_pham: number | null;
  rong_thanh_pham: number | null;
  quy_cach_in: string | null;
  so_mau_a: number | null;
  so_mau_b: number | null;
  muc_a: string[];
  muc_b: string[];
  so_trang: number | null;
  trang_moi_tay: number | null;
  so_kem: number | null;
  so_manh_xa: number | null;
  ghi_chu_ky_thuat: string | null;
  so_con: number;
  so_to_ke_hoach: number;
  so_to_nguyen: number;
  don_vi_tinh: string | null;
}

export interface LenhSxRoutingNode {
  id: number;
  thu_tu: number;
  /** Đường DÀI NHẤT từ bước gốc tới bước này — KHÔNG phải `thu_tu`. Hai bước cùng `lop` là hai
   *  bước chạy SONG SONG được; vẽ theo `thu_tu` là bịa ra một chuỗi tuần tự không tồn tại. */
  lop: number;
  phu_thuoc: number[];
  ten: string | null;
  nhom: string | null;
  loai_buoc: string | null;
  bat_buoc: boolean;
  nha_cung_cap: string | null;
  cong_viec_id: number | null;
  /** Bước do một ca in GHÉP đảm nhiệm: trạng thái/máy/người là của CẢ CA, không riêng lệnh này. */
  la_buoc_ghep: boolean;
  /** Mã bài ghép đang phủ bước — có thì loại/tổ/nhà gia công là của BƯỚC CHUNG. */
  bai_ghep_ma?: string | null;
  la_buoc_hien_tai: boolean;
  /** `released` | `running` | `paused` | `completed`; `null` = bước chưa có công việc. */
  trang_thai: string | null;
  may: string | null;
  to: string | null;
  nguoi: string[];
  du_kien_bat_dau: string | null;
  du_kien_ket_thuc: string | null;
  hoan_thanh_luc: string | null;
  so_luong_vao: number;
  so_luong_ra: number;
  don_vi_vao: string | null;
  don_vi_ra: string | null;
  /** Công đoạn nguồn CÓ ĐÒI khuôn/khung — khác hẳn "đã trỏ dao nào". Bật mà `khuon_be_ma` rỗng
   *  chính là thế "cần dao mà chưa chốt", thứ đang chặn ở cửa Sẵn sàng lập kế hoạch. */
  can_khuon: boolean;
  khuon_da_nhan: boolean;
  khuon_be_ma: string | null;
  khuon_be_ten: string | null;
  khuon_be_so_ke: string | null;
  khuon_be_tinh_trang: string | null;
  /** Số không đạt KCS ghi trên chính bước này (12/10/2026). */
  kcs_khong_dat?: number;
  /** Số tốt tổ đã ghi ở bước (13/10/2026) — so với `so_luong_ra`. Bước ghép: số cả ca. */
  lam_ra?: number;
  /** Tên đơn vị của `don_vi_ra` ("tờ", không phải mã). */
  don_vi_ra_ten?: string | null;
}

export interface LenhSxRouting {
  nodes: LenhSxRoutingNode[];
  /** Cặp `[bước trước, bước sau]` bằng id node. */
  canh: number[][];
}

export interface LenhSxVatTuDong {
  /** `lsx` = vật tư của chính lệnh · `bai_ghep` = giấy của cả tờ in ghép mà lệnh là thành viên.
   *  Cả hai đều là vật tư THẬT của lệnh, nhưng người đi lĩnh phải biết mình lĩnh cho ai. */
  pham_vi: string;
  ma: string | null;
  ten_viec: string | null;
  buoc_id: number | null;
  hang_loai: string | null;
  hang_id: number | null;
  hang_ma: string | null;
  hang_ten: string | null;
  don_vi_goc: string | null;
  ton: number | null;
  nhu_cau: number | null;
  nhu_cau_hien_thi: string | null;
  da_cap: number | null;
  dang_linh: number | null;
  con_phai_co: number | null;
  thieu: number | null;
  /** Cùng thang màu với bảng cân đối Kế hoạch vật tư (`CanDoiMau`). */
  trang_thai: string | null;
  ngay_can: string | null;
}

export interface LenhSxVatTuMuc {
  /** Mọi dòng của bước đang làm đều `xanh`/`xam`. Không dòng nào ⇒ `true` (không có gì để thiếu). */
  du: boolean;
  dong: LenhSxVatTuDong[];
}

/** `bo_qua` GỠ 23/09/2026 cùng lúc với `CanDoiOut.bo_qua` — ba mục dưới là toàn bộ khối vật tư. */
export interface LenhSxVatTu {
  hien_tai: LenhSxVatTuMuc;
  canh_bao_sau: LenhSxVatTuDong[];
  da_cap: LenhSxVatTuDong[];
}

export interface LenhSxNhanLucBuoc {
  cong_viec_id: number;
  buoc_id: number | null;
  ten_viec: string | null;
  to: string | null;
  may: string | null;
  nguoi: string[];
}

export interface LenhSxNhanLucSuKien {
  /** `giao_nguoi` · `rut_nguoi` · `doi_may`. */
  loai: string;
  luc: string;
  cong_viec_id: number | null;
  ten_viec: string | null;
  nguoi: string | null;
  /** Chỉ có ở `doi_may` — và đó là vết DUY NHẤT của lần đổi máy (`cong_viec.may_id` chỉ nhớ máy
   *  cuối cùng). */
  may_cu: string | null;
  may_moi: string | null;
  ly_do: string | null;
}

export interface LenhSxNhanLuc {
  hien_tai: LenhSxNhanLucBuoc[];
  /** Giữ CẢ người đã bị RÚT — hồ sơ là chỗ trả lời "ai từng làm việc này", bảng thì không. */
  lich_su: LenhSxNhanLucSuKien[];
}

export interface LenhSxSanLuongBatch {
  id: number;
  cong_viec_id: number;
  ten_viec: string | null;
  la_buoc_ghep: boolean;
  bat_dau: string | null;
  ket_thuc: string | null;
  tong: number;
  tot: number;
  hong: number;
  don_vi: string | null;
  mo_ta_loi: string | null;
}

/** Chỉ còn danh sách mẻ: ba tổng cũ cộng tờ in với thành phẩm nên đã gỡ ở máy chủ. Muốn tổng thì
 *  cộng mẻ của CÙNG một bước theo TỪNG đơn vị (`tongMeTheoDonVi`). */
export interface LenhSxSanLuong {
  batch: LenhSxSanLuongBatch[];
}

export interface LenhSxKcsBatch {
  id: number;
  cong_viec_id: number;
  ten_viec: string | null;
  la_buoc_ghep: boolean;
  la_kcs_cuoi: boolean;
  ket_thuc: string | null;
  so_luong_nhan: number;
  so_luong_dat: number;
  so_luong_khong_dat: number;
  don_vi: string | null;
  /** `dat` | `dat_mot_phan` | `khong_dat`. */
  ket_luan: string | null;
  ghi_chu: string | null;
}

export interface LenhSxKcs {
  tong_nhan: number;
  tong_dat: number;
  tong_khong_dat: number;
  /** `null` = CHƯA kiểm cái nào, khác hẳn `0` = kiểm rồi và trượt sạch. */
  ty_le_dat: number | null;
  batch: LenhSxKcsBatch[];
}

export interface LenhSxPhieuSua {
  id: number;
  ma: string;
  /** `cho_sua` | `da_sua_xong`. */
  trang_thai: string | null;
  nguyen_nhan_phuong_an: string | null;
  hoan_thanh_at: string | null;
}

export interface LenhSxSuCo {
  id: number;
  ma: string;
  cong_viec_id: number | null;
  ten_viec: string | null;
  may: string | null;
  bo_phan_hong: string | null;
  mo_ta: string | null;
  /** `nhe` | `trung_binh` | `nghiem_trong`. */
  muc_do: string | null;
  may_dung: boolean;
  nguoi_bao: string | null;
  thoi_diem: string | null;
  /** `cho_tiep_nhan` | `da_tao_phieu` | `tu_choi`. */
  trang_thai: string | null;
  ly_do_tu_choi: string | null;
  /** Phiếu sửa sinh ra từ yêu cầu này. `null` khi chưa ai tiếp nhận — KHÔNG phải lỗi. */
  phieu: LenhSxPhieuSua | null;
}

/** Một dòng yêu cầu NHẬP kho thành phẩm (kho thật). `id` = id dòng; số theo đơn vị của món. */
export interface LenhSxKhoYeuCau {
  id: number;
  request_id: number | null;
  /** Mã yêu cầu nhập (DNN…) — bấm mở ở Yêu cầu nhập xuất. */
  ma: string | null;
  hang_id: number | null;
  so_luong_yeu_cau: number;
  /** Kho đã nhận (Σ phiếu nhập đã ghi sổ). */
  so_luong_xac_nhan: number;
  con_lai: number;
  don_vi: string | null;
  /** Trạng thái yêu cầu kho: `approved` · `preparing` · `partial` · `done` · `cancelled` · `rejected`. */
  trang_thai: string | null;
  tao_luc: string | null;
  /** Lúc phiếu nhập ghi sổ muộn nhất. */
  xac_nhan_luc: string | null;
}

export interface LenhSxKho {
  /** SỐ, không phải cờ: `1` thì số của nhóm CHÍNH LÀ số của lệnh (cộng thoải mái); `3` thì cộng
   *  qua ba lệnh của một trang là nhân số thật lên gấp ba. `0` = lệnh chưa vào nhóm nào. */
  so_lenh_trong_nhom: number;
  yeu_cau: LenhSxKhoYeuCau[];
}

/** MỘT dòng điền sẵn của form giao hàng = một cặp (mặt hàng × kho), vì phiếu xuất đi từ MỘT kho. */
export interface LenhSxGiaoHangHang {
  hang_id: number;
  ma: string | null;
  ten: string | null;
  quy_cach: string | null;
  don_vi: string | null;
  kho_id: number | null;
  kho_ten: string | null;
  /** Tồn THẬT của cặp này, CHƯA trừ đã giao. Để đối chiếu với kho. */
  so_luong: number;
  /** TRẦN được phép ghi vào phiếu (đã trừ đã giao). `null` khi `khong_tinh_duoc`. */
  so_toi_da: number | null;
  /** `true` ⇒ không dựng được ánh xạ mặt hàng ⇄ dòng đơn ⇒ chưa biết trần. Ô TRỐNG CÓ LÝ DO,
   *  KHÔNG phải 0: hàng vẫn còn trong kho, chỉ là hệ chưa biết chắc đã giao bao nhiêu của riêng
   *  món này. UI phải cảnh báo, đừng tự điền `so_luong` vào chỗ trần. */
  khong_tinh_duoc: boolean;
}

export interface LenhSxGiaoHang {
  nhom_id: number | null;
  order_id: number | null;
  order_line_ids: number[];
  so_lenh_trong_nhom: number;
  hang: LenhSxGiaoHangHang[];
  /** Số CẤP NHÓM (mọi mặt hàng, mọi dòng đơn) — để đối chiếu, KHÔNG phải để lập phiếu. */
  da_nhap_kho: number;
  da_giao: number;
  co_the_giao: boolean;
  /** Nhóm có nhiều đơn vị khác nhau ⇒ con số tổng KHÔNG có nghĩa; UI phải im nó đi. */
  don_vi_lech: boolean;
}

export interface LenhSxTimeline {
  loai: string;
  luc: string;
  /** Có thể trống: vài đường ghi không lưu ai bấm (batch KCS). Bịa tên vào đó tệ hơn để trống. */
  nguoi: string | null;
  noi_dung: string;
  cong_viec_id: number | null;
  ten_viec: string | null;
}

export interface LenhSxHoSoOut {
  thong_tin: LenhSxThongTin;
  tien_do: LenhSxTienDo;
  thong_so: LenhSxThongSo;
  routing: LenhSxRouting;
  vat_tu: LenhSxVatTu;
  nhan_luc: LenhSxNhanLuc;
  san_luong: LenhSxSanLuong;
  su_co: LenhSxSuCo[];
  kcs: LenhSxKcs;
  kho: LenhSxKho;
  giao_hang: LenhSxGiaoHang;
  /** Sắp TĂNG DẦN theo mốc máy chủ. KHÔNG có sự kiện giao hàng (nguồn có, cố ý chưa nối —
   *  `ho_so._timeline`); số đã giao nằm ở khối `giao_hang`. */
  timeline: LenhSxTimeline[];
  /** Đọc từ `san_xuat_goi_phat_hanh.version_hien_tai`. `null` khi lệnh chưa có công việc nào
   *  (chưa từng được phát hành) — KHÔNG mặc định 1. */
  phien_ban: number | null;
}

/** Ngăn hồ sơ GỌN của một lệnh (12/10/2026) — `GET /api/lenh-san-xuat/{id}/ngan`. */
export interface LenhSxNganOut {
  thong_tin: LenhSxThongTin;
  tien_do: LenhSxTienDo;
  thong_so: LenhSxThongSo;
  routing: LenhSxRouting;
  kcs: LenhSxKcs;
  kho: LenhSxKho;
  phien_ban: number | null;
  /** Lệnh gia công trọn gói ⇒ ngăn bày MỘT bước mang tên nhà gia công. */
  tron_goi: { nha_cung_cap: string | null; xong: boolean } | null;
  /** KCS cuối của THÀNH PHẨM — cấp nhóm như `kho` (lệnh Bìa đọc được KCS cuối nằm ở lệnh Ruột).
   *  `so_lan = 0` ⇒ chưa kiểm. */
  kcs_cuoi: { so_lan: number; nhan: number; dat: number; khong_dat: number };
  /** 13/10/2026 (ngăn hai cột): thẻ Đang vướng + tab Lịch sử. `timeline` tăng dần, `luc` có múi. */
  su_co: LenhSxSuCo[];
  timeline: LenhSxTimeline[];
}

// --- Theo dõi sản xuất (module `theo_doi_san_xuat`) — THEO ĐƠN, 12/10/2026 ------------------------
// Bàn CHỈ ĐỌC: một dòng một đơn, ngăn mở bằng bảng mặt hàng. Mirror ĐÚNG
// `backend/app/schemas/theo_doi_san_xuat.py` (phần "Theo đơn"). KHÔNG MỘT SỐ TIỀN NÀO.

/** Chip của danh sách — hợp đồng với `theo_doi_don.CHIP` (giá trị lạ ăn 422). */
export type TdsxChip = "tat_ca" | "can_de_y" | "dang_lam" | "cho_giao" | "da_giao";
/** Chặng của đơn = chặng của mặt hàng chậm nhất. */
export type TdsxChang = "lenh" | "sx" | "kho" | "giao" | "xong";
/** Nhóm của một mặt hàng, thứ tự xếp trong ngăn. */
export type TdsxNhomMon = "vuong" | "dang" | "chua" | "kho" | "giao";

/** Mặt hàng đại diện của đơn (món chậm nhất). `o` ∈ du_hang/ngoai/xuong/cho_kho/dong_thieu/
 *  chua_xuong/chua_lenh (`don_hang_san_xuat.O_*`). */
export interface TdsxMonTomTat {
  ten: string | null;
  o: string;
  nhom: TdsxNhomMon;
  dat: number;
  don_vi: string | null;
  kho_da_nhan: number;
  da_giao: number;
  buoc: string | null;
  buoc_so: number | null;
  buoc_tong: number | null;
  pct: number | null;
  nha_gia_cong: string | null;
}

/** `ly_do` ∈ tre/su_co/tam_dung/thieu_vat_tu/kcs_khong_dat/dong_thieu/chua_lenh. */
export interface TdsxDonVuong {
  so_mon: number;
  ly_do: string;
  buoc: string | null;
}

export interface TdsxDonDong {
  order_id: number;
  order_no: string;
  khach_hang: string | null;
  phu_trach: string | null;
  so_mon: number;
  mon_dau: string | null;
  so_luong: number | null;
  don_vi: string | null;
  chang: TdsxChang;
  chang_ket: boolean;
  dai_dien: TdsxMonTomTat | null;
  so_mon_kho: number;
  so_mon_giao: number;
  /** `date` ⇒ `ngay()`. */
  han_giao: string | null;
  /** Giờ xưởng không nhãn múi. */
  du_kien_xong: string | null;
  tre_ngay: number | null;
  con_ngay: number | null;
  vuong: TdsxDonVuong | null;
  nhom: "dang_lam" | "cho_giao" | "da_giao";
  can_de_y: boolean;
}

export interface TdsxTheoDonOut {
  items: TdsxDonDong[];
  total: number;
  page: number;
  page_size: number;
  /** FACET của tập đã lọc — không bị chính chip đang chọn lọc lại. Cấm đếm lại từ `items`. */
  dem: Partial<Record<TdsxChip, number>>;
}

/** MỘT bước của routing dọc. `trang_thai` ∈ xong/chay/dung/cho. */
export interface TdsxBuoc {
  ten: string | null;
  to: string | null;
  ngoai: boolean;
  nha_cung_cap: string | null;
  trang_thai: string;
  hien_tai: boolean;
  hoan_thanh_luc: string | null;
  kcs_khong_dat: number;
  lam_ra: number;
  ke_hoach_ra: number;
  /** Tên đơn vị ra của bước. */
  don_vi_ra: string | null;
}

/** MỘT lệnh của mặt hàng. `tron_goi` ⇒ `buoc_ds` rỗng, FE bày một bước "Gia công trọn gói". */
export interface TdsxLenhCuaMon {
  id: number;
  ma: string;
  ten: string | null;
  o: string;
  xong: boolean;
  co: string[];
  da_xuong: boolean;
  tron_goi: boolean;
  nha_gia_cong: string | null;
  buoc: string | null;
  buoc_so: number | null;
  buoc_tong: number | null;
  pct: number | null;
  buoc_ds: TdsxBuoc[];
  /** Bước CUỐI routing: số tốt / kế hoạch / đơn vị. `null` = chưa xuống xưởng hoặc trọn gói. */
  lam_ra: number | null;
  ke_hoach_ra: number | null;
  don_vi_ra: string | null;
}

export interface TdsxMon {
  khoa: string;
  ten: string | null;
  dat: number;
  don_vi: string | null;
  o: string;
  nhom: TdsxNhomMon;
  co: string[];
  kho_da_nhan: number;
  da_giao: number;
  buoc: string | null;
  buoc_so: number | null;
  buoc_tong: number | null;
  pct: number | null;
  nha_gia_cong: string | null;
  lenh: TdsxLenhCuaMon[];
  /** `null` khi các lệnh ra đơn vị khác món (Ruột + Bìa). */
  lam_ra: number | null;
  /** Hàng đã có (đã giao + đang giữ + giao được từ tồn của mã); `co_tu_ton` là phần KHÔNG từ lệnh. */
  co_hang: number;
  co_tu_ton: number;
  /** Đang giữ cho yêu cầu giao. */
  dang_giu: number;
  con_phai_giao: number;
}

/** MỘT dòng nhật ký cấp đơn — `luc` có múi giờ; `lenh` = mã lệnh (null = việc của đơn). */
export interface TdsxSuKienDon {
  luc: string;
  loai: string;
  noi_dung: string;
  lenh: string | null;
}

export interface TdsxDonChiTiet {
  don: TdsxDonDong;
  /** Xếp sẵn: vướng → đang làm → chưa có lệnh → đã nhập kho → đã giao. */
  mon: TdsxMon[];
  /** Mới nhất lên đầu. */
  lich_su: TdsxSuKienDon[];
  giao_xuong_luc: string | null;
}

export interface TdsxTheoDonParams {
  q?: string;
  khach_hang_id?: number;
  phu_trach_id?: number;
  chip?: TdsxChip;
  /** Khoảng ngày `YYYY-MM-DD` theo `moc`: `chot` ngày chốt đơn (mặc định), `han_giao`. */
  tu_ngay?: string;
  den_ngay?: string;
  moc?: string;
  page?: number;
  page_size?: number;
}

/** 1 dòng trong picker mặt hàng (gộp Giấy + Vật tư khác). KHÔNG có giá. */
export interface MatHangOption {
  hang_loai: HangLoai;
  hang_id: number;
  nhom: string;
  ma: string;
  ten: string;
  don_vi_goc: string | null;
}

/** 1 đơn vị dùng được cho mặt hàng đang chọn. `he_so_ve_goc` = 1 đơn vị này bằng bao nhiêu
 *  đơn vị gốc — nhân với số người dùng gõ ra số sẽ vào tồn. */
export interface DonViDungDuoc {
  ma: string;
  ten: string;
  he_so: number;
  he_so_ve_goc: number;
  la_goc: boolean;
  dien_giai: string;
  /** Giấy / vật tư khác khai từ hai đơn vị trở lên, danh sách GỘP (không gửi `goc`): đơn vị đã
   *  khai mà nhóm của nó chứa dòng này (`to`, `kg`, `thung`…) + tên. `he_so_ve_goc` quy về CHÍNH
   *  gốc này — hai đơn vị khai riêng không quy đổi lẫn nhau. */
  goc?: string;
  goc_ten?: string;
}

export interface DonViCuaMatHang {
  hang_loai: HangLoai;
  hang_id: number;
  ma: string;
  ten: string;
  don_vi_goc: string | null;
  don_vi_goc_ten: string | null;
  ds: DonViDungDuoc[];
  /** Vì sao `ds` rỗng — UI hiện nguyên câu này thay vì im lặng khoá ô. */
  ly_do: string | null;
}

export interface StockVoucherLine {
  id: number;
  request_line_id: number;
  hang_loai: HangLoai;
  hang_id: number;
  hang_ma: string | null;
  hang_ten: string | null;
  dvt: string | null;
  /** Giấy: khổ mm của dòng phiếu (hàng khác: 0 · 0). Đơn vị gốc ở `don_vi_goc` bên dưới. */
  kho_rong: number;
  kho_dai: number;
  lot_id: number | null;
  ma_lo: string | null;
  /** SL đề nghị gốc của dòng (đọc-nối) — đối chiếu "đề nghị vs thực nhận/xuất". null = không nối được. */
  sl_de_nghi: number | null;
  so_luong: number;
  /** Số đã quy về đơn vị gốc — số THẬT SỰ chạy vào lô/tồn. */
  sl_goc: number | null;
  don_vi_goc: string | null;
  ghi_chu: string | null;
  don_gia: number | null;
  thanh_tien: number | null;
  /** Thành phẩm KCS mà lô CHƯA CÓ giá gốc ⇒ 0 ở hai số trên là "chưa biết" — ghi "Chưa có giá gốc".
   *  Luôn false khi thiếu quyền xem giá. */
  chua_gia_goc?: boolean;
  /** Nguồn hàng (lệnh / đơn / khách, đọc ở lô gốc) — dòng xuất gộp lô nhiều đơn thì nối ", ". */
  lsx_ma?: string | null;
  order_ma?: string | null;
  khach_hang?: string | null;
  /** Giá bán của đơn (đ/đvt dòng), chỉ tham khảo. null khi thiếu quyền xem giá. */
  don_gia_ban?: number | null;
  /** Hạn sử dụng của lô dòng này (ISO yyyy-mm-dd) — BE trả để hiện trên phiếu (điều chuyển). */
  hsd?: string | null;
  /** Vị trí cất lô (kệ/ô) — phiếu điều chuyển hiện/khai per-lô. null = chưa khai. */
  vi_tri?: string | null;
}

export interface StockVoucher {
  id: number;
  ma: string;
  loai: StockRequestKind;
  request_id: number;
  request_ma: string | null;
  /** Loại phiếu (tự do) người tạo gõ ở yêu cầu — hiện trên phiếu + list. */
  loai_kho: string | null;
  kho_id: number;
  kho_ten: string | null;
  ngay: string;
  nguoi_lap_id: number;
  nguoi_lap_ten: string | null;
  /** Chuỗi trách nhiệm từ đề nghị gốc: ai đề nghị · ai duyệt. */
  nguoi_de_nghi_ten: string | null;
  nguoi_duyet_ten: string | null;
  /** Người GHI SỔ (duyệt/chốt phiếu) — chỉ có sau khi đã ghi sổ. */
  nguoi_ghi_so_ten: string | null;
  nguoi_giao_nhan: string | null;
  ghi_chu: string | null;
  trang_thai: StockVoucherStatus;
  ghi_so_luc: string | null;
  created_at: string;
  /** ĐIỀU CHUYỂN: true cho cả phiếu xuất nguồn lẫn phiếu nhập đích — FE/báo cáo gắn nhãn. */
  dieu_chuyen: boolean;
  lines: StockVoucherLine[];
  /** Tổng giá vốn — chỉ có khi `can_view_cost`. */
  gia_von: number | null;
}

export interface StockVoucherPage {
  items: StockVoucher[];
  total: number;
  /** Số phiếu theo tab màn tồn từng kho — cùng bộ lọc, trừ tab. */
  dem_theo_tab?: { nhap: number; xuat: number; dc: number } | null;
}

export interface StockVoucherAttachment {
  id: number;
  stock_voucher_id: number;
  file_name: string;
  /** Đường dẫn tải (mount /static). Tải xuống = origin + file_url. */
  file_url: string;
  file_type: string | null;
  uploaded_by: number | null;
  uploaded_at: string;
}

export interface StockVoucherListParams {
  q?: string | null;
  loai?: StockRequestKind | null;
  trang_thai?: StockVoucherStatus | null;
  request_id?: number | null;
  kho_id?: number | null;
  /** Kỳ + điều kiện lọc của màn tồn từng kho (tu_ngay/den_ngay/moc, nhom, nguoi_lap, gia_tu/gia_den, man). */
  loc?: ThamSoLoc;
  page?: number;
  size?: number;
}

export interface StockVoucherLineInput {
  /** Mặt hàng KẾ THỪA từ dòng đề nghị (kho không đổi được) nên phiếu chỉ gửi `request_line_id`. */
  request_line_id: number;
  so_luong: number;
  /** Phiếu NHẬP: giá của lô sắp tạo. Phiếu XUẤT: bỏ qua (giá lấy đích danh từ lô). */
  don_gia?: number | null;
  /** Phiếu XUẤT: bắt buộc. Phiếu NHẬP: bỏ qua (lô sinh ra lúc ghi sổ). */
  lot_id?: number | null;
  /** Lý do cấp/nhập THIẾU (khi SL < còn phải cấp) — bắt buộc nếu thiếu; ghi vào đề nghị. */
  ly_do?: string | null;
  ghi_chu?: string | null;
  /** Phiếu NHẬP: vị trí cất lô (kệ/ô) — thủ kho khai; ghi sổ chép sang lô. */
  vi_tri?: string | null;
  /** Phiếu NHẬP: hạn sử dụng của lô (ISO yyyy-mm-dd, tuỳ chọn). Tách hạn = nhiều dòng; phần dư
   *  không hạn để null. */
  hsd?: string | null;
  /** Phiếu NHẬP giấy: khổ của lô sắp tạo (bỏ trống = kế thừa dòng đề nghị). */
  kho_rong?: number;
  kho_dai?: number;
}

export interface StockVoucherInput {
  request_id: number;
  kho_id: number;
  /** Số phiếu tự nhập; bỏ trống → hệ thống tự sinh. */
  ma?: string | null;
  ngay?: string | null;
  ghi_chu?: string | null;
  lines: StockVoucherLineInput[];
  /** "Tạo và ghi sổ": máy chủ xét khoá kỳ ngay lúc tạo, không để lại phiếu nháp khi bị chặn. */
  ghi_so?: boolean;
}

/** 1 mặt hàng cần điều chuyển. `so_luong` theo ĐƠN VỊ GỐC của mặt hàng. */
export interface DieuChuyenItemInput {
  hang_loai: HangLoai;
  hang_id: number;
  so_luong: number;
  /** Vị trí cất ở KHO ĐÍCH (kệ/ô) — tuỳ chọn, khai lúc ấn; áp cho mọi lô của mặt hàng. */
  vi_tri?: string | null;
  /** Giấy: nhóm lô cần chuyển — khổ (mm) + đơn vị gốc của nhóm (`so_luong` theo đơn vị này). */
  don_vi_goc?: string;
  kho_rong?: number;
  kho_dai?: number;
}

/** Ấn ĐIỀU CHUYỂN 1 hay NHIỀU mặt hàng kho nguồn → kho đích (gộp vào MỘT yêu cầu điều chuyển). */
export interface DieuChuyenInput {
  kho_nguon_id: number;
  kho_den_id: number;
  items: DieuChuyenItemInput[];
  ghi_chu?: string | null;
}

/** Kết quả ấn điều chuyển: MỘT yêu cầu điều chuyển (NHẬP đích, nhiều dòng) + phiếu xuất nguồn đã ghi sổ. */
export interface DieuChuyenResult {
  yeu_cau_id: number;
  yeu_cau_ma: string;
  phieu_xuat_id: number;
  phieu_xuat_ma: string;
  kho_nguon_id: number;
  kho_den_id: number;
  so_dong: number;
  /** Tổng giá vốn điều chuyển — null nếu thiếu `can_view_cost`. */
  gia_von: number | null;
}

/** Ba màn cùng gọi danh sách lô / lịch sử mặt hàng — mỗi màn có ô "Xem giá thành" riêng:
 *  `ton` = dòng của kho có lô · `yeu_cau` = Yêu cầu nhập xuất · `bao_cao` = Báo cáo kho. */
export type ManKho = "ton" | "yeu_cau" | "bao_cao";

/** Một dòng tồn giấy: khổ + đơn vị gốc (`to`, `kg`…) — cùng mã khác khổ/đơn vị gốc là hai dòng. */
export interface DongTonGiay {
  goc: string;
  kho_rong: number;
  kho_dai: number;
}

/** Gắn bộ lọc lô giấy (`goc` + khổ) vào query. Cạnh bằng 0 thì không gửi — dòng chưa khai khổ
 *  (hoặc khổ chỉ rộng) không được biến thành điều kiện "lô phải có cạnh dài 0". */
function datLocGiay(qs: URLSearchParams, p: { goc?: string | null; kho_rong?: number; kho_dai?: number }): void {
  if (p.goc) qs.set("goc", p.goc);
  if (p.kho_rong) qs.set("kho_rong", String(p.kho_rong));
  if (p.kho_dai) qs.set("kho_dai", String(p.kho_dai));
}

export interface StockLot {
  id: number;
  ma_lo: string;
  hang_loai: HangLoai;
  hang_id: number;
  hang_ma: string | null;
  hang_ten: string | null;
  /** Ảnh minh hoạ mặt hàng (từ danh mục). Màn Tồn kho gom theo mặt hàng nên chép sẵn vào lô. */
  hang_anh: string | null;
  /** ĐƠN VỊ GỐC — `dvt` = MÃ (to/cai…) cho logic/quy đổi; `dvt_ten` = TÊN có dấu (tờ/cái) để hiển thị. */
  dvt: string | null;
  dvt_ten: string | null;
  kho_id: number;
  vi_tri: string | null;
  /** Giấy: khổ mm + đơn vị gốc của lô (lô chưa có khổ: 0 · 0; vật tư khác: "" · 0 · 0). */
  don_vi_goc: string;
  kho_rong: number;
  kho_dai: number;
  ngay_nhap: string;
  ncc: string | null;
  sl_ban_dau: number;
  sl_con_lai: number;
  hsd: string | null;
  trang_thai: string;
  /** Phiếu NHẬP đã tạo ra lô — hiển thị lô THEO MÃ PHIẾU (link mở phiếu). Null với tồn đầu kỳ. */
  voucher_id: number | null;
  voucher_ma: string | null;
  /** Chỉ có khi `can_view_cost` — thủ kho chọn lô mà không thấy giá. */
  don_gia_nhap: number | null;
  /** SL đề nghị đã sinh ra lô (đọc-nối). Không phải tiền → luôn có. null = lô đầu kỳ / không nối được. */
  sl_de_nghi: number | null;
  /** ĐƠN VỊ của `sl_de_nghi` (đơn vị người xin) — có thể khác `dvt` gốc của lô; ghi rõ ở cột SL yêu cầu. */
  dvt_yeu_cau?: string | null;
  /** Lô sinh từ phiếu ĐIỀU CHUYỂN (nhận về) — lịch sử mặt hàng xếp vào tab "Chuyển kho" riêng. */
  dieu_chuyen?: boolean;
  /** NGUỒN LÔ đọc ở lô gốc (sống qua điều chuyển). `tu_kcs` = thành phẩm nhập từ KCS — giá gốc 0 cho
   *  tới khi kế toán kho gõ. `don_gia_ban` chỉ có khi `can_view_cost`. */
  lo_goc_id?: number | null;
  lsx_ma?: string | null;
  order_ma?: string | null;
  khach_hang?: string | null;
  don_gia_ban?: number | null;
  tu_kcs?: boolean;
}

export interface StockAllocationLine {
  lot_id: number;
  ma_lo: string;
  ngay_nhap: string;
  hsd: string | null;
  sl_con_lai: number;
  so_luong: number;
  don_vi_goc?: string;
  kho_rong?: number;
  kho_dai?: number;
  don_gia_nhap: number | null;
  /** Nguồn lô thành phẩm (đơn / khách) — trống với giấy, vật tư. */
  order_ma?: string | null;
  khach_hang?: string | null;
  /** Xuất cho Giao hàng mà lô thuộc đơn khác cùng khách: "Lô này sản xuất cho đơn DH…". */
  canh_bao?: string | null;
  /** Lô thành phẩm KCS kế toán chưa gõ giá gốc — `don_gia_nhap` 0 là "chưa biết", không phải 0 đ. */
  chua_gia_goc?: boolean;
}

/** Kết quả sửa giá gốc: hệ quy về lô GỐC, `so_lo` = số lô trong họ (gốc + lô sinh qua điều chuyển). */
export interface GiaGocKetQua {
  lot_id: number;
  ma_lo: string;
  don_gia_cu: number;
  don_gia: number;
  don_gia_nhap: number;
  so_lo: number;
}

/** Một lô GỐC thành phẩm nhập từ KCS — báo cáo "Thành phẩm chưa có giá gốc". */
export interface ThanhPhamChuaGiaGocRow {
  lot_id: number;
  ma_lo: string;
  ngay_nhap: string;
  kho_id: number;
  kho_ten: string | null;
  hang_id: number;
  ma_hang: string | null;
  ten_hang: string | null;
  dvt: string | null;
  dvt_ten: string | null;
  so_luong_nhap: number;
  /** Giá gốc hiện tại (0 = chưa có). */
  don_gia: number;
  /** Giá bán lấy từ đơn hàng (null = không lần ra đơn). */
  don_gia_ban: number | null;
  lsx_ma: string | null;
  order_ma: string | null;
  khach_hang: string | null;
  /** Còn lại cộng mọi lô trong họ (mọi kho). */
  sl_con_lai: number;
  don_vi_goc_ten: string | null;
  so_lo: number;
}

export interface ThanhPhamChuaGiaGocPage {
  items: ThanhPhamChuaGiaGocRow[];
  total: number;
  page: number;
  size: number;
  /** Lựa chọn cho ô lọc nâng cao — chỉ kho/khách có lô, bất kể bộ lọc đang áp. */
  cac_kho: { id: number; ten: string | null }[];
  cac_khach: { id: number; ten: string | null }[];
  cac_hang?: { id: number; ten: string | null }[];
}

export interface StockAllocation {
  lines: StockAllocationLine[];
  /** > 0 = kho không đủ hàng cho số cần cấp. */
  thieu: number;
}

export interface StockThreshold {
  id: number;
  hang_loai: HangLoai;
  hang_id: number;
  hang_ma: string | null;
  hang_ten: string | null;
  kho_id: number;
  /** Giấy: khổ (mm) + đơn vị gốc của dòng tồn mang ngưỡng. Hàng khác: 0 · 0 · "". */
  kho_rong: number;
  kho_dai: number;
  don_vi_goc?: string;
  nguong_ton: number;
  nguong_can_ton: number | null;
  nguong_toi_da: number | null;
  canh_bao: boolean;
}

/** 1 lần ĐIỀU CHỈNH phiếu xuất — cho "Lịch sử điều chỉnh" trong drawer phiếu. */
export interface DieuChinhLichSu {
  thoi_diem: string;
  nguoi_ten: string | null;
  bo_phan_ten: string | null;
  chi_tiet: string | null;
  ly_do: string | null;
}

/** 1 VỊ TRÍ cất (kệ/ô) đã khai của một kho — danh sách để khai lô chọn dropdown. */
export interface KhoViTriRow {
  id: number;
  kho_id: number;
  ma: string;
  ghi_chu: string | null;
  active: boolean;
}

/** 1 dòng phiếu XUẤT đã ghi sổ của mã hàng — theo dõi xuất riêng với nhập (lô). */
export interface StockMaterialXuatRow {
  ngay: string;
  voucher_id: number;
  voucher_ma: string | null;
  lot_id: number | null;
  ma_lo: string | null;
  /** SL đề nghị đã sinh ra dòng xuất (đọc-nối). Không phải tiền → luôn có. null = không nối được. */
  sl_de_nghi: number | null;
  /** ĐƠN VỊ của `sl_de_nghi` (đơn vị người xin) — có thể khác đơn vị gốc; ghi rõ ở cột SL yêu cầu. */
  dvt_yeu_cau?: string | null;
  so_luong: number;
  /** Giá vốn đích danh của lô đã xuất — chỉ có khi `can_view_cost`. */
  don_gia: number | null;
  /** Dòng xuất thuộc phiếu ĐIỀU CHUYỂN (chuyển đi) — lịch sử mặt hàng xếp vào tab "Chuyển kho". */
  dieu_chuyen?: boolean;
  /** Vị trí + HSD của LÔ đã xuất (máy chủ đọc cùng câu). */
  vi_tri?: string | null;
  hsd?: string | null;
  /** Lô thành phẩm từ KCS chưa có giá gốc. */
  chua_gia_goc?: boolean;
}

/** Một dòng tab "Chuyển kho" của ngăn mặt hàng: lô nhận về (`in`) hoặc dòng chuyển đi (`out`). */
export interface StockMaterialChuyenRow {
  key: string;
  chieu: "in" | "out";
  ngay: string;
  voucher_id: number | null;
  voucher_ma: string | null;
  so_luong: number;
  don_gia: number | null;
  chua_gia_goc: boolean;
  vi_tri: string | null;
  hsd: string | null;
}

export type TabLichSuMatHang = "lo_ton" | "nhap" | "xuat" | "chuyen";

/** MỘT trang của một tab ngăn mặt hàng — cắt ở máy chủ, kèm số dòng mọi tab. */
export interface StockMaterialHistoryPage {
  hang_loai: HangLoai;
  hang_id: number;
  hang_ma: string | null;
  hang_ten: string | null;
  dvt: string | null;
  on_hand: number;
  tab: TabLichSuMatHang;
  page: number;
  size: number;
  dem: Record<TabLichSuMatHang, number>;
  lo: StockLot[];
  xuat: StockMaterialXuatRow[];
  chuyen: StockMaterialChuyenRow[];
}

/** Lịch sử 1 mã hàng tại 1 kho: NHẬP = các lô (cả đã hết) · XUẤT = dòng phiếu xuất. */
export interface StockMaterialHistory {
  hang_loai: HangLoai;
  hang_id: number;
  hang_ma: string | null;
  hang_ten: string | null;
  dvt: string | null;
  on_hand: number;
  nhap: StockLot[];
  xuat: StockMaterialXuatRow[];
}

export interface StockThresholdInput {
  hang_loai: HangLoai;
  hang_id: number;
  kho_id: number;
  /** Giấy: khổ + đơn vị gốc của dòng tồn (khoá 5 phần). Hàng khác: bỏ trống. */
  kho_rong?: number;
  kho_dai?: number;
  don_vi_goc?: string;
  nguong_ton: number;
  /** Bỏ trống → backend tự suy ra = nguong_ton × 1.3. */
  nguong_can_ton?: number | null;
  nguong_toi_da?: number | null;
  canh_bao?: boolean;
}

// --- Nội quy công ty --------------------------------------------------------

export interface NoiQuyRecord {
  id: number;
  code: string;
  name: string;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  note: string | null;
  uploaded_by_user_id: number;
  uploaded_by_name: string;
  uploaded_at: string;
}

/** Gọi một endpoint trả nhị phân, tự làm mới token khi 401. Tách khỏi `blobUrl` để chỗ cần ĐỌC
 *  THÊM header của response (vd. `blobUrlComTen` đọc `Content-Disposition`) không phải chép lại
 *  logic retry 401 lần thứ hai. */
async function fetchNhiPhan(path: string, token: string): Promise<Response> {
  const doFetch = (bearer: string) =>
    fetch(`${BASE_URL}${path}`, {
      credentials: "include",
      cache: "no-store",
      headers: authHeader(bearer),
    });
  let resp = await doFetch(token);
  if (resp.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh) resp = await doFetch(fresh);
  }
  if (!resp.ok) throw new ApiError(`Tải tệp thất bại (mã ${resp.status}).`, resp.status);
  return resp;
}

/** Tải một file nhị phân về dạng blob URL, tự làm mới token khi 401. */
export async function blobUrl(path: string, token: string): Promise<string> {
  const resp = await fetchNhiPhan(path, token);
  return URL.createObjectURL(await resp.blob());
}

/** Tách tên file khỏi header `Content-Disposition` (`inline; filename="..."` hoặc `attachment; …`).
 *  Không có header, hoặc dạng lạ không khớp, trả `null` — nơi gọi tự lùi về tên dự phòng. Không cần
 *  lo dạng `filename*=` (UTF-8 encoded, RFC 5987): phía backend phát tên đã sanitize thuần ASCII
 *  (`_ten_file` ở `backend/app/services/lenh_sx/phieu_cong_nghe.py`), không có ký tự cần encode. */
export function tenFileTuHeader(header: string | null): string | null {
  if (!header) return null;
  const m = /filename="?([^";]+)"?/i.exec(header);
  return m ? m[1].trim() : null;
}

/** Như `blobUrl`, nhưng bọc `Blob` vào `File` (mang `.name`) trước khi tạo object URL. Tên lấy từ
 *  `Content-Disposition` của response; header thiếu/lạ thì lùi về `tenDuPhong`.
 *
 *  ⚠️ N28 (đặt tên file đúng lúc "Lưu") — ruling C109 sau lượt rà vòng 1, ĐỌC KỸ TRƯỚC KHI DÙNG
 *  Ở CHỖ MỚI: bọc `File` chỉ đổi được tên "Lưu" khi đối tượng blob được TIÊU THỤ bằng thẻ
 *  `<a download={ten}>` — đó là nơi `.name`/tham số `download` thật sự quyết định tên gợi ý.
 *  `phieuCongNghePdf()` (bên dưới) KHÔNG dùng `<a download>` — nó `window.open(url, "_blank")` mở
 *  thẳng blob URL trong trình xem PDF built-in của Chromium, và trình xem đó dựng tên "Lưu" từ
 *  CHÍNH đoạn UUID trong `blob:<origin>/<uuid>`, không đọc `File.name` — nên với đường
 *  `window.open`, hàm này KHÔNG đóng được N28 (vẫn ra tên uuid như trước khi sửa). Trước đây
 *  docstring ở đây dẫn `frontend/src/lib/anhNen.ts` làm "tiền lệ" — SAI: file đó bọc `File` để ĐI
 *  UPLOAD (tên đi vào `FormData`, một cơ chế khác hẳn). Đã gỡ câu dẫn sai đó.
 *
 *  Vẫn giữ hàm này (không revert về `blobUrl` trần) vì: (a) là chỗ SẴN SÀNG cho đường tải PDF/ảnh
 *  khác trong repo TIÊU THỤ bằng `<a download>` sau này (nếu có) — hiện tại `blobUrlComTen` có
 *  ĐÚNG MỘT người gọi (`phieuCongNghePdf` bên dưới), và mọi `<a download>` thật đang có trong repo
 *  đã tự gán `a.download = "<tên>"` nên `File.name` không có tác dụng gì thêm ở đó; (b) tự nó
 *  không làm hỏng gì so với `blobUrl` — cùng lắm là bọc dư một lớp `File` vô hại khi trình duyệt
 *  bỏ qua `.name`. */
export async function blobUrlComTen(
  path: string,
  token: string,
  tenDuPhong: string,
): Promise<string> {
  const resp = await fetchNhiPhan(path, token);
  const ten = tenFileTuHeader(resp.headers.get("Content-Disposition")) ?? tenDuPhong;
  const blob = await resp.blob();
  return URL.createObjectURL(new File([blob], ten, { type: blob.type }));
}

// --- Báo cáo kinh doanh theo khách (24/09/2026) -------------------------------------------
export interface BaoCaoKinhDoanhDong {
  ten: string;
  so_luong: number;
  dvt: string | null;
  don_gia: number | null;
  vat_pct: number;
  thanh_tien: number | null;
  /** Lũy kế khách đã thực nhận tới hết `tinh_toi`; còn phải giao = đặt − đã giao (không âm). */
  da_giao: number;
  con_giao: number;
}
export interface BaoCaoKinhDoanhTien {
  tong: number;
  tong_vat: number;
  coc_phai_thu: number;
  coc_da_nhan: number;
  coc_con_thieu: number;
  /** Phần thực hiện đơn (phương án C, 11/10/2026) — lũy kế tới hết `tinh_toi`. */
  gia_tri_giao: number;
  da_xuat_hd: number;
  da_thu: number;
  /** Trả lại khách ngoài đơn cộng nợ lại vào hoá đơn của đơn (#47) — Còn phải thu = Tổng có VAT −
   *  Đã thu + cái này. */
  hoan_khong_don: number;
  con_phai_thu: number;
  /** Chiết khấu / kê chi lại khách (20/10/2026). Phải chi chỉ tính hóa đơn đã thu đủ; kê phải chi đã
   *  trừ thuế TNDN trên kê. */
  ck_phai_chi: number;
  ck_da_chi: number;
  ke_tien: number;
  ke_thue_tndn: number;
  ke_phai_chi: number;
  ke_da_chi: number;
}
export type TinhTrangBCKD = "chua" | "mot_phan" | "du";
export interface BaoCaoKinhDoanhDon extends BaoCaoKinhDoanhTien {
  order_id: number;
  order_no: string;
  ngay_chot: string | null;
  sale: string | null;
  po_khach: string | null;
  ngay_giao: string | null;
  coc_pct: number;
  /** % mặt hàng khách ưng / mặt hàng trong báo giá; null = đơn không đi từ báo giá. */
  ty_le_bao_gia: number | null;
  giao: TinhTrangBCKD;
  thu: TinhTrangBCKD;
  dong: BaoCaoKinhDoanhDong[];
}
export interface BaoCaoKinhDoanhKhach extends BaoCaoKinhDoanhTien {
  customer_id: number | null;
  ma: string | null;
  ten: string;
  so_don: number;
  don: BaoCaoKinhDoanhDon[];
}
export interface BaoCaoKinhDoanh {
  /** null = kỳ "Tất cả" (không chặn đầu đó). */
  tu_ngay: string | null;
  den_ngay: string | null;
  /** Giao / hoá đơn / thu tính tới hết ngày này. */
  tinh_toi: string;
  /** Phạm vi dữ liệu theo ô quyền: own | department | all. */
  pham_vi: string;
  khach: BaoCaoKinhDoanhKhach[];
  tong: BaoCaoKinhDoanhTien & { so_khach: number; so_don: number };
  /** Số đơn theo tình trạng cọc / giao / thu — mỗi cái đếm trên mọi điều kiện KHÁC. */
  lua_chon?: Record<"coc" | "giao" | "thu", { value: string; nhan: string; so: number }[]>;
}

export interface UngVienTamUng {
  employee_id: number;
  code: string | null;
  name: string | null;
  department_id: number | null;
  department_name?: string | null;
  cong: number;
  du_dieu_kien: boolean;
  so_tien_goi_y: number | null;
  so_phieu_da_co: number;
}
export interface UngVienTamUngList {
  nguong: number;
  den_ngay: number;
  items: UngVienTamUng[];
}

/** Gom lời gọi `api.matHang.donVi` trong cùng một nhịp thành MỘT request lô.
 *
 *  Form nhiều dòng vật tư (bảng giá NCC, yêu cầu mua hàng) có mỗi dòng một ô ĐVT tự nạp đơn vị
 *  của mặt hàng dòng đó: bảng giá 23 dòng từng là 23 request song song, mỗi request máy chủ lại
 *  đọc cả bảng đơn vị + bảng cặp quy đổi (đo 27/09/2026). Gom ở đây thì mọi nơi dùng ô ĐVT cùng
 *  hưởng, khỏi luồn danh sách mặt hàng qua từng form. Món vắng trong kết quả ⇒ reject đúng lời
 *  gọi đó, bên gọi hiện "Không tải được" như cửa lẻ cũ trả 404. */
type ChoDonVi = {
  resolve: (r: DonViCuaMatHang) => void;
  reject: (e: unknown) => void;
};
const hangChoDonVi = new Map<string, Map<string, ChoDonVi[]>>();

function gomDonVi(token: string, hangLoai: HangLoai, hangId: number): Promise<DonViCuaMatHang> {
  return new Promise((resolve, reject) => {
    let lo = hangChoDonVi.get(token);
    if (!lo) {
      lo = new Map();
      hangChoDonVi.set(token, lo);
      // setTimeout 0 chứ không microtask: các ô ĐVT gọi trong useEffect của CÙNG một lượt
      // commit, nhưng React có thể chạy effect qua vài microtask.
      setTimeout(() => void guiLoDonVi(token), 0);
    }
    const khoa = `${hangLoai}:${hangId}`;
    const cho = lo.get(khoa) ?? [];
    cho.push({ resolve, reject });
    lo.set(khoa, cho);
  });
}

async function guiLoDonVi(token: string): Promise<void> {
  const tatCa = hangChoDonVi.get(token);
  hangChoDonVi.delete(token);
  if (!tatCa || tatCa.size === 0) return;
  // Máy chủ nhận tối đa 500 món/lượt; chia 200 cho URL gọn.
  const khoa = [...tatCa.keys()];
  const me: Map<string, ChoDonVi[]>[] = [];
  for (let i = 0; i < khoa.length; i += 200) {
    me.push(new Map(khoa.slice(i, i + 200).map((k) => [k, tatCa.get(k)!])));
  }
  await Promise.all(me.map((lo) => guiMotMeDonVi(token, lo)));
}

async function guiMotMeDonVi(token: string, lo: Map<string, ChoDonVi[]>): Promise<void> {
  try {
    const qs = new URLSearchParams({ cap: [...lo.keys()].join(",") });
    const res = await authed<{ items: DonViCuaMatHang[] }>(
      `/api/vat-lieu-kho/mat-hang/don-vi-lo?${qs.toString()}`, token,
    );
    const theoKhoa = new Map(res.items.map((r) => [`${r.hang_loai}:${r.hang_id}`, r]));
    for (const [khoa, cho] of lo) {
      const r = theoKhoa.get(khoa);
      for (const c of cho) {
        if (r) c.resolve(r);
        else c.reject(new Error("Không tìm thấy mặt hàng."));
      }
    }
  } catch (e) {
    for (const cho of lo.values()) for (const c of cho) c.reject(e);
  }
}

// ── Mục thu chi + Báo cáo thu chi (11/10/2026) ─────────────────────────────────────────────

/** Một mục của danh mục Mục thu chi (`/api/muc-thu-chi`). */
export interface MucThuChi {
  id: number;
  ma: string;
  ten: string;
  loai: "thu" | "chi";
  ghi_chu: string | null;
  active: boolean;
  /** Mục cố định theo nguồn phiếu (id âm, Trả nhà cung cấp…) — chỉ đọc, không chọn tay trên phiếu. */
  co_dinh?: boolean;
  /** Nguồn phiếu của mục cố định (`gia_cong_ngoai`…). */
  nguon?: string | null;
  /** Số phiếu đang mang mục. */
  da_dung?: number;
}

/** Cột kỳ của báo cáo: `khoa` "2026-09" (tháng) hoặc "2026-Q3" (quý). */
export interface CotKyThuChi {
  khoa: string;
  nhan: string;
}

export interface DongThuChi {
  ben: "thu" | "chi";
  /** id mục dạng chuỗi ("0" = Chưa phân loại) hoặc tên người đã hạ chữ (khi xem theo người). */
  khoa: string;
  ten: string;
  /** Dòng có phiếu chưa phân loại. */
  chua: boolean;
  muc_id: number | null;
  o: Record<string, number>;
  cong: number;
}

export interface TongNhomThuChi {
  o: Record<string, number>;
  cong: number;
  so_dong: number;
}

export type TheThuChi = "all" | "thu" | "chi" | "chua";

export interface BaoCaoThuChi {
  tu_ngay: string;
  den_ngay: string;
  theo: "muc" | "nguoi";
  cot: CotKyThuChi[];
  dong: DongThuChi[];
  nhom: { thu: TongNhomThuChi; chi: TongNhomThuChi };
  chenh_lech: { o: Record<string, number>; cong: number };
  the_loc: Record<TheThuChi, number>;
  total: number;
  page: number;
  size: number;
}

export interface PhieuThuChi {
  loai: "thu" | "chi";
  id: number;
  so: string;
  ngay: string;
  tien: number;
  nguoi: string;
  ly_do: string;
  hinh_thuc: PaymentVoucherType;
  muc_id: number | null;
  muc_ten: string | null;
}

export interface PhieuCuaDongThuChi {
  cot: CotKyThuChi[];
  o: Record<string, number>;
  cong: number;
  items: PhieuThuChi[];
  tong: number;
}

/** Tham số chung của bảng, ngăn phiếu và file Excel của Báo cáo thu chi. */
export interface LocBaoCaoThuChi {
  tuNgay: string;
  denNgay: string;
  theo?: "muc" | "nguoi";
  hinhThuc?: "cash" | "bank_transfer" | null;
  /** id mục; 0 = Chưa phân loại. */
  muc?: number[];
}

function qsBaoCaoThuChi(p: LocBaoCaoThuChi): URLSearchParams {
  const qs = new URLSearchParams({ tu_ngay: p.tuNgay, den_ngay: p.denNgay });
  if (p.theo && p.theo !== "muc") qs.set("theo", p.theo);
  if (p.hinhThuc) qs.set("hinh_thuc", p.hinhThuc);
  for (const m of p.muc ?? []) qs.append("muc", String(m));
  return qs;
}

export const api = {
  login(username: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }).then((res) => {
      tokenMoiNhat = res.access_token;
      return res;
    });
  },

  me(token: string): Promise<User> {
    return request<User>("/api/auth/me", { headers: authHeader(token) });
  },

  /** Exchange the httpOnly refresh cookie for a new access token (rotates the cookie). */
  refresh(timeoutMs?: number): Promise<LoginResponse> {
    return request<LoginResponse>("/api/auth/refresh", { method: "POST", timeoutMs });
  },

  /** Revoke the refresh token server-side and clear the cookie. */
  logout(): Promise<void> {
    // Xoá token mới nhất NGAY, không đợi máy chủ trả lời: lượt gọi đang bay sau đó mang token cũ
    // của React (cũng sắp bị bỏ) chứ không mang token của phiên vừa thoát.
    tokenMoiNhat = null;
    return request<void>("/api/auth/logout", { method: "POST" });
  },

  /** Module keys the current user can Read (for menu/route gating). */
  myPermissions(token: string): Promise<string[]> {
    return authed<{ modules: string[] }>("/api/auth/permissions", token).then(
      (r) => r.modules,
    );
  },

  /** Current user's readable modules + full CRUD matrix (spec-09 action gating). `kcs` =
   *  thành viên một phòng ban "Tổ KCS" (mg 0306) — không phải ô quyền của vai. */
  myAccess(
    token: string,
  ): Promise<{ modules: string[]; permissions: ModuleCapability[] }> {
    return authed<{ modules: string[]; permissions: ModuleCapability[] }>(
      "/api/auth/permissions",
      token,
    );
  },

  // --- Self-service profile (spec-04) ---------------------------------------

  /** Enriched current-user profile (department/role names + created_at). */
  profile(token: string): Promise<Profile> {
    return authed<Profile>("/api/auth/me", token);
  },

  /** Change the display name; returns the updated user. */
  updateName(token: string, name: string): Promise<User> {
    return authed<User>("/api/users/me", token, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  },

  /** Upload a new avatar (JPG/PNG ≤ 2 MB); returns its server path. */
  uploadAvatar(token: string, file: File): Promise<{ avatar_url: string }> {
    const form = new FormData();
    form.append("file", file);
    return authed<{ avatar_url: string }>("/api/users/me/avatar", token, {
      method: "POST",
      body: form,
    });
  },

  /** Remove the avatar → initials fallback. */
  removeAvatar(token: string): Promise<void> {
    return authed<void>("/api/users/me/avatar", token, { method: "DELETE" });
  },

  /** Change the current user's password; ends all sessions (caller returns to Login). */
  changePassword(token: string, currentPassword: string, newPassword: string): Promise<void> {
    return authed<void>("/api/auth/change-password", token, {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  },

  rbac: {
    modules(token: string): Promise<ModuleDef[]> {
      return authed<ModuleDef[]>("/api/rbac/modules", token);
    },
    /** `loc`: thanh lọc màn Phòng ban (`q`, `khoi`, `tinh_trang`, kỳ) — có lọc thì máy chủ trả
     *  phòng khớp kèm tổ tiên (`khop=false`); không gửi gì = trọn cây. */
    departments(token: string, loc?: ThamSoLoc): Promise<Department[]> {
      const qs = new URLSearchParams();
      ganThamSoLoc(qs, loc);
      const s = qs.toString();
      return authed<Department[]>(`/api/departments${s ? `?${s}` : ""}`, token);
    },
    departmentUsers(token: string, departmentId: number): Promise<DepartmentMember[]> {
      return authed<DepartmentMember[]>(`/api/departments/${departmentId}/users`, token);
    },
    createDepartment(
      token: string,
      name: string,
      description: string | null,
      parentId: number | null,
      levelId: number | null = null,
      salary: DepartmentSalaryPolicy | null = null,
    ): Promise<Department> {
      return authed<Department>("/api/departments", token, {
        method: "POST",
        body: JSON.stringify({
          name,
          description,
          parent_id: parentId,
          level_id: levelId,
          ...(salary ?? {}),
        }),
      });
    },
    updateDepartment(
      token: string,
      id: number,
      name: string,
      headUserId: number | null,
      description: string | null,
      levelId: number | null = null,
      parentId: number | null = null,
      salary: DepartmentSalaryPolicy | null = null,
      laSanXuat: boolean = false,
      /** Cờ khối Kinh doanh. `undefined` = KHÔNG gửi ⇒ backend giữ nguyên — luồng đổi trưởng
       *  phòng không được âm thầm gỡ khối Kinh doanh của phòng. */
      laKinhDoanh?: boolean,
      /** Cờ bộ phận Giao hàng. Cùng luật `undefined` = KHÔNG gửi ⇒ backend giữ nguyên. */
      laGiaoHang?: boolean,
      /** Ba ô khoán km. Cùng luật `undefined` = KHÔNG gửi ⇒ giữ nguyên: luồng chỉ sửa tên phòng
       *  mà gửi kèm 0 là âm thầm xoá đơn giá, tháng sau tài xế nhận 0 đồng km. */
      khoanKm?: { don_gia_km?: number; pct_tai_xe?: number; pct_phu_xe?: number },
      /** Cờ Tổ in (mg 0304). Cùng luật `undefined` = KHÔNG gửi ⇒ backend giữ nguyên. */
      laToIn?: boolean,
    ): Promise<Department> {
      return authed<Department>(`/api/departments/${id}`, token, {
        method: "PUT",
        body: JSON.stringify({
          name,
          head_user_id: headUserId,
          description,
          level_id: levelId,
          parent_id: parentId,
          ...(salary ?? {}),
          la_san_xuat: laSanXuat,
          ...(laKinhDoanh === undefined ? {} : { la_kinh_doanh: laKinhDoanh }),
          ...(laGiaoHang === undefined ? {} : { la_giao_hang: laGiaoHang }),
          ...(khoanKm ?? {}),
          ...(laToIn === undefined ? {} : { la_to_in: laToIn }),
        }),
      });
    },
    /** Departments that would be deleted with this one's branch (spec-05 confirm). */
    departmentSubtree(token: string, id: number): Promise<DepartmentSubtreeRow[]> {
      return authed<DepartmentSubtreeRow[]>(`/api/departments/${id}/subtree`, token);
    },
    /** People eligible to head a unit: everyone in the unit + its sub-units (PBI-4004). */
    headCandidates(token: string, id: number): Promise<UserBrief[]> {
      return authed<UserBrief[]>(`/api/departments/${id}/head-candidates`, token);
    },
    deleteDepartment(token: string, id: number): Promise<void> {
      return authed<void>(`/api/departments/${id}`, token, { method: "DELETE" });
    },
    // --- Unit-level catalog (spec-06 / PBI-4009) ---
    unitLevels(token: string): Promise<UnitLevel[]> {
      return authed<UnitLevel[]>("/api/unit-levels", token);
    },
    createUnitLevel(
      token: string,
      name: string,
      rank: number,
      headTitle: string,
    ): Promise<UnitLevel> {
      return authed<UnitLevel>("/api/unit-levels", token, {
        method: "POST",
        body: JSON.stringify({ name, rank, head_title: headTitle }),
      });
    },
    updateUnitLevel(
      token: string,
      id: number,
      name: string,
      rank: number,
      headTitle: string,
    ): Promise<UnitLevel> {
      return authed<UnitLevel>(`/api/unit-levels/${id}`, token, {
        method: "PUT",
        body: JSON.stringify({ name, rank, head_title: headTitle }),
      });
    },
    deleteUnitLevel(token: string, id: number): Promise<void> {
      return authed<void>(`/api/unit-levels/${id}`, token, { method: "DELETE" });
    },
    users(token: string): Promise<UserRow[]> {
      return authed<UserRow[]>("/api/users", token);
    },
    /** Một tài khoản (tab Tài khoản của hồ sơ) — khỏi kéo cả danh sách về rồi lọc. */
    user(token: string, userId: number): Promise<UserRow> {
      return authed<UserRow>(`/api/users/${userId}`, token);
    },
    // `createUser` ĐÃ GỠ: mọi tài khoản phải thuộc một hồ sơ nhân viên → tạo tài khoản
    // qua Hồ sơ nhân sự (`api.employees.create` kèm `account`, hoặc `api.employees.linkAccount`).
    assignUserRole(token: string, userId: number, roleId: number | null): Promise<UserRow> {
      return authed<UserRow>(`/api/users/${userId}/role`, token, {
        method: "PUT",
        body: JSON.stringify({ role_id: roleId }),
      });
    },
    setUserActive(token: string, userId: number, isActive: boolean): Promise<UserRow> {
      return authed<UserRow>(`/api/users/${userId}/active`, token, {
        method: "PUT",
        body: JSON.stringify({ is_active: isActive }),
      });
    },
    /** Edit a user's name + department (spec-08 / PBI-2003); dept change drops the old role. */
    updateUser(token: string, userId: number, name: string, departmentId: number): Promise<UserRow> {
      return authed<UserRow>(`/api/users/${userId}`, token, {
        method: "PUT",
        body: JSON.stringify({ name, department_id: departmentId }),
      });
    },
    /** Reset a user's password → returns the one-time temp password; revokes all sessions. */
    resetUserPassword(token: string, userId: number): Promise<{ temporary_password: string }> {
      return authed<{ temporary_password: string }>(`/api/users/${userId}/reset-password`, token, {
        method: "POST",
      });
    },
    /** Log a user out everywhere (spec-08 / PBI-2008). */
    revokeUserSessions(token: string, userId: number): Promise<void> {
      return authed<void>(`/api/users/${userId}/revoke-sessions`, token, { method: "POST" });
    },
    /** A user's live sessions (device + times), read-only. */
    userSessions(token: string, userId: number): Promise<Session[]> {
      return authed<Session[]>(`/api/users/${userId}/sessions`, token);
    },
    /** Recent activity targeting a user. */
    userActivity(token: string, userId: number, limit?: number): Promise<AuditRow[]> {
      const suffix = limit ? `?limit=${limit}` : "";
      return authed<AuditRow[]>(`/api/users/${userId}/activity${suffix}`, token);
    },
    /** Bulk-move people to a target department (spec-06 / PBI-4008); old roles are dropped. */
    /** Bulk điều chuyển NHÂN SỰ sang phòng khác — theo hồ sơ, nên người chưa có tài khoản
     *  cũng chuyển được; mỗi lần chuyển ghi Quá trình công tác + gỡ vai trò cũ. */
    transferStaff(
      token: string,
      employeeIds: number[],
      targetDepartmentId: number,
    ): Promise<{ transferred: number }> {
      return authed<{ transferred: number }>("/api/departments/transfer", token, {
        method: "POST",
        body: JSON.stringify({
          employee_ids: employeeIds,
          target_department_id: targetDepartmentId,
        }),
      });
    },
    /** Gán một vai trò cho nhiều người cùng lúc từ màn Phòng ban (bulk). */
    bulkAssignRole(
      token: string,
      userIds: number[],
      roleId: number,
    ): Promise<{ assigned: number }> {
      return authed<{ assigned: number }>("/api/departments/assign-role", token, {
        method: "POST",
        body: JSON.stringify({ user_ids: userIds, role_id: roleId }),
      });
    },
    /** Một TRANG nhật ký. Lọc + phân trang ở máy chủ (25/09/2026) — trước đây endpoint trả cứng
     *  100 dòng mới nhất và màn hình tự lọc/cắt trang trên đúng 100 dòng ấy. */
    activityLog(token: string, v: AuditQuery = {}): Promise<AuditPage> {
      return authed<AuditPage>(`/api/audit${auditParams(v)}`, token);
    },
    /** Danh mục hành động / người / nhóm, đếm theo khoảng ngày đang xem. */
    activityFacets(token: string, v: AuditQuery = {}): Promise<AuditFacets> {
      const p = auditParams({ q: v.q, tu_ngay: v.tu_ngay, den_ngay: v.den_ngay, moc: v.moc, tat_ca: v.tat_ca });
      return authed<AuditFacets>(`/api/audit/facets${p}`, token);
    },
    /** Tải CSV theo ĐÚNG bộ lọc đang xem — máy chủ stream, không còn giới hạn 100 dòng đã tải. */
    async activityExport(token: string, v: AuditQuery = {}): Promise<string> {
      const doFetch = (bearer: string) =>
        fetch(`${BASE_URL}/api/audit/export${auditParams(v)}`, {
          credentials: "include",
          cache: "no-store",
          headers: authHeader(bearer),
        });
      let resp = await doFetch(token);
      if (resp.status === 401) {
        const fresh = await refreshAccessToken();
        if (fresh) resp = await doFetch(fresh);
      }
      if (!resp.ok) throw new ApiError(`Xuất CSV thất bại (${resp.status}).`, resp.status);
      return URL.createObjectURL(await resp.blob());
    },
    roles(token: string, departmentId: number): Promise<Role[]> {
      return authed<Role[]>(`/api/roles?department_id=${departmentId}`, token);
    },
    createRole(token: string, name: string, departmentId: number): Promise<Role> {
      return authed<Role>("/api/roles", token, {
        method: "POST",
        body: JSON.stringify({ name, department_id: departmentId }),
      });
    },
    renameRole(token: string, roleId: number, name: string): Promise<Role> {
      return authed<Role>(`/api/roles/${roleId}`, token, {
        method: "PUT",
        body: JSON.stringify({ name }),
      });
    },
    /** `force`: còn người giữ vai thì máy chủ gỡ vai khỏi họ rồi xoá (15/10/2026). */
    deleteRole(token: string, roleId: number, force = false): Promise<void> {
      return authed<void>(`/api/roles/${roleId}${force ? "?force=true" : ""}`, token, {
        method: "DELETE",
      });
    },
    /** Nhân bản vai trò: vai MỚI với ma trận quyền chép y nguyên vai gốc.
     *  Bỏ `name` = máy chủ tự đặt "«tên gốc» (bản sao)"; bỏ `departmentId` = cùng phòng vai gốc.
     *  Gác bằng `phong_ban:create` + `phong_ban:manage_permissions` (nó bê cả bộ quyền). */
    duplicateRole(
      token: string,
      roleId: number,
      opts?: { name?: string; departmentId?: number },
    ): Promise<Role> {
      return authed<Role>(`/api/roles/${roleId}/duplicate`, token, {
        method: "POST",
        body: JSON.stringify({
          name: opts?.name ?? null,
          department_id: opts?.departmentId ?? null,
        }),
      });
    },
    permissions(token: string, roleId: number): Promise<PermissionRow[]> {
      return authed<PermissionRow[]>(`/api/roles/${roleId}/permissions`, token);
    },
    savePermissions(
      token: string,
      roleId: number,
      rows: PermissionRow[],
    ): Promise<PermissionRow[]> {
      return authed<PermissionRow[]>(`/api/roles/${roleId}/permissions`, token, {
        method: "PUT",
        body: JSON.stringify({ permissions: rows }),
      });
    },
  },

  // --- Nhóm dùng chung (khối Kinh doanh) -------------------------------------
  // Gác bằng `phong_ban:manage_permissions` — gộp nhóm là cho người này thấy dữ liệu của người
  // kia, cùng loại với cấp quyền.
  nhomDungChung: {
    list(token: string): Promise<NhomDungChung[]> {
      return authed<NhomDungChung[]>("/api/nhom-dung-chung", token);
    },
    create(token: string, ten: string, userIds: number[]): Promise<NhomDungChung> {
      return authed<NhomDungChung>("/api/nhom-dung-chung", token, {
        method: "POST",
        body: JSON.stringify({ ten, user_ids: userIds }),
      });
    },
    /** `userIds` là THAY TOÀN BỘ danh sách thành viên; bỏ qua = chỉ đổi tên. */
    update(
      token: string,
      id: number,
      data: { ten?: string; userIds?: number[] },
    ): Promise<NhomDungChung> {
      return authed<NhomDungChung>(`/api/nhom-dung-chung/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          ...(data.ten === undefined ? {} : { ten: data.ten }),
          ...(data.userIds === undefined ? {} : { user_ids: data.userIds }),
        }),
      });
    },
    remove(token: string, id: number): Promise<{ ok: boolean }> {
      return authed<{ ok: boolean }>(`/api/nhom-dung-chung/${id}`, token, {
        method: "DELETE",
      });
    },
  },

  // --- Khách hàng (CRM), spec-06 --------------------------------------------
  customers: {
    list(token: string, params: CustomerListParams = {}): Promise<CustomerListOut> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.chua_gan) qs.set("chua_gan", "true");
      else if (params.sale != null) qs.set("sale", String(params.sale));
      if (params.tag) qs.set("tag", params.tag);
      if (params.sort) qs.set("sort", params.sort);
      if (params.page) qs.set("page", String(params.page));
      if (params.size) qs.set("size", String(params.size));
      ganThamSoLoc(qs, params.loc);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<CustomerListOut>(`/api/customers${suffix}`, token);
    },
    sales(token: string): Promise<SaleOption[]> {
      return authed<SaleOption[]>("/api/customers/sales", token);
    },
    /** Điều chuyển toàn bộ khách của một Sale sang Sale khác (trưởng phòng KD). */
    reassign(
      token: string,
      fromSaleUserId: number,
      toSaleUserId: number,
    ): Promise<{ moved: number; skipped: number }> {
      return authed<{ moved: number; skipped: number }>("/api/customers/reassign", token, {
        method: "POST",
        body: JSON.stringify({
          from_sale_user_id: fromSaleUserId,
          to_sale_user_id: toSaleUserId,
        }),
      });
    },
    /** Điều chuyển các khách ĐƯỢC CHỌN (checkbox) sang một Sale. */
    reassignSelected(
      token: string,
      customerIds: number[],
      toSaleUserId: number,
    ): Promise<{ moved: number; skipped: number }> {
      return authed<{ moved: number; skipped: number }>("/api/customers/reassign", token, {
        method: "POST",
        body: JSON.stringify({
          customer_ids: customerIds,
          to_sale_user_id: toSaleUserId,
        }),
      });
    },
    get(token: string, id: number): Promise<CustomerDetailOut> {
      return authed<CustomerDetailOut>(`/api/customers/${id}`, token);
    },
    thongKe(token: string, id: number, ky: KyXem, buoc: BuocBieuDo): Promise<ThongKeKhach> {
      return authed<ThongKeKhach>(`/api/customers/${id}/thong-ke?${_qsKy(ky, { buoc })}`, token);
    },
    orderHistory(token: string, id: number, ky: KyXem, loc: LocLichSu = {}): Promise<TrangDon> {
      return authed<TrangDon>(`/api/customers/${id}/orders?${_qsKy(ky, { ...loc })}`, token);
    },
    quoteHistory(token: string, id: number, ky: KyXem, loc: LocLichSu = {}): Promise<TrangBaoGia> {
      return authed<TrangBaoGia>(`/api/customers/${id}/quotations?${_qsKy(ky, { ...loc })}`, token);
    },
    audit(token: string, id: number): Promise<{ items: CustomerAuditRow[] }> {
      return authed<{ items: CustomerAuditRow[] }>(`/api/customers/${id}/audit`, token);
    },
    /** Xuất Excel (CSV) lịch sử mua hàng — fetch as a blob (bearer + refresh-aware). */
    async orderCsvBlobUrl(token: string, id: number, ky: KyXem, loc: LocLichSu = {}): Promise<string> {
      // Xuất ĐÚNG kỳ + bộ lọc đang xem (không xuất cả lịch sử).
      const qs = _qsKy(ky, { q: loc.q, nhom: loc.nhom });
      const doFetch = (bearer: string) =>
        fetch(`${BASE_URL}/api/customers/${id}/orders.csv?${qs}`, {
          credentials: "include",
          cache: "no-store",
          headers: authHeader(bearer),
        });
      let resp = await doFetch(token);
      if (resp.status === 401) {
        const fresh = await refreshAccessToken();
        if (fresh) resp = await doFetch(fresh);
      }
      if (!resp.ok) throw new ApiError(`Xuất tệp thất bại (mã ${resp.status}).`, resp.status);
      const blob = await resp.blob();
      return URL.createObjectURL(blob);
    },
    create(token: string, input: CustomerInput): Promise<CustomerCreateOut> {
      return authed<CustomerCreateOut>("/api/customers", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    update(token: string, id: number, input: CustomerInput): Promise<CustomerCreateOut> {
      return authed<CustomerCreateOut>(`/api/customers/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    /** Sửa CHÍNH SÁCH TÀI CHÍNH (hạn mức + điều khoản + rào chiết khấu/biên) — endpoint
     *  riêng, gate `set_credit_terms`. Trả detail (customer + receivable card). */
    updateFinancial(
      token: string,
      id: number,
      input: CustomerFinancialInput,
    ): Promise<CustomerDetailOut> {
      return authed<CustomerDetailOut>(`/api/customers/${id}/financial`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    /** Check trùng tức thời trên form (#8) — soft warn, không chặn. */
    checkDuplicate(
      token: string,
      params: { tax_code?: string; name?: string; email?: string; exclude_id?: number },
    ): Promise<DuplicateWarn[]> {
      const qs = new URLSearchParams();
      if (params.tax_code) qs.set("tax_code", params.tax_code);
      if (params.name) qs.set("name", params.name);
      if (params.email) qs.set("email", params.email);
      if (params.exclude_id != null) qs.set("exclude_id", String(params.exclude_id));
      return authed<DuplicateWarn[]>(`/api/customers/check-duplicate?${qs}`, token);
    },
    // --- người liên hệ (#10–#11) ---
    contacts(token: string, id: number): Promise<{ items: CustomerContact[] }> {
      return authed<{ items: CustomerContact[] }>(`/api/customers/${id}/contacts`, token);
    },
    addContact(token: string, id: number, input: CustomerContactInput): Promise<CustomerContact> {
      return authed<CustomerContact>(`/api/customers/${id}/contacts`, token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    updateContact(
      token: string,
      id: number,
      contactId: number,
      input: CustomerContactInput,
    ): Promise<CustomerContact> {
      return authed<CustomerContact>(`/api/customers/${id}/contacts/${contactId}`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    deleteContact(token: string, id: number, contactId: number): Promise<void> {
      return authed<void>(`/api/customers/${id}/contacts/${contactId}`, token, {
        method: "DELETE",
      });
    },
    // --- địa chỉ giao hàng (#9) ---
    addresses(token: string, id: number): Promise<{ items: CustomerAddress[] }> {
      return authed<{ items: CustomerAddress[] }>(`/api/customers/${id}/addresses`, token);
    },
    addAddress(token: string, id: number, input: CustomerAddressInput): Promise<CustomerAddress> {
      return authed<CustomerAddress>(`/api/customers/${id}/addresses`, token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    updateAddress(
      token: string,
      id: number,
      addressId: number,
      input: CustomerAddressInput,
    ): Promise<CustomerAddress> {
      return authed<CustomerAddress>(`/api/customers/${id}/addresses/${addressId}`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    deleteAddress(token: string, id: number, addressId: number): Promise<void> {
      return authed<void>(`/api/customers/${id}/addresses/${addressId}`, token, {
        method: "DELETE",
      });
    },
    // --- nhãn thủ công (#7) ---
    tagLabels(token: string): Promise<string[]> {
      return authed<string[]>("/api/customers/tags", token);
    },
    tags(token: string, id: number): Promise<{ items: { id: number; label: string }[] }> {
      return authed<{ items: { id: number; label: string }[] }>(
        `/api/customers/${id}/tags`,
        token,
      );
    },
    addTag(token: string, id: number, label: string): Promise<{ id: number; label: string }> {
      return authed<{ id: number; label: string }>(`/api/customers/${id}/tags`, token, {
        method: "POST",
        body: JSON.stringify({ label }),
      });
    },
    deleteTag(token: string, id: number, tagId: number): Promise<void> {
      return authed<void>(`/api/customers/${id}/tags/${tagId}`, token, { method: "DELETE" });
    },
    // --- kho nhãn dùng chung (thêm / xoá nhãn — 16/08/2026) ---
    // ĐỪNG nhầm với `tagLabels` ngay trên: cái đó trả nhãn ĐÃ ĐƯỢC GÁN cho khách nào đó (nguồn của
    // ô lọc), còn đây là kho nhãn CÓ THỂ gán — nhãn vừa tạo, chưa ai mang, chỉ có ở đây.
    tagKho(token: string): Promise<{ items: KhoNhanRow[] }> {
      return authed<{ items: KhoNhanRow[] }>("/api/customers/tag-kho", token);
    },
    themNhanKho(token: string, label: string): Promise<KhoNhanRow> {
      return authed<KhoNhanRow>("/api/customers/tag-kho", token, {
        method: "POST",
        body: JSON.stringify({ label }),
      });
    },
    /** Xoá nhãn khỏi kho VÀ gỡ khỏi mọi khách đang mang. Trả số khách bị gỡ. */
    xoaNhanKho(token: string, nhanId: number): Promise<{ so_khach_da_go: number }> {
      return authed<{ so_khach_da_go: number }>(`/api/customers/tag-kho/${nhanId}`, token, {
        method: "DELETE",
      });
    },
    // --- chăm sóc (#20/#27/#28) ---
    careEvents(token: string, id: number): Promise<{ items: CareEvent[] }> {
      return authed<{ items: CareEvent[] }>(`/api/customers/${id}/care`, token);
    },
    addCareEvent(
      token: string,
      id: number,
      input: { kind: string; note: string; happened_at?: string | null },
    ): Promise<CareEvent> {
      return authed<CareEvent>(`/api/customers/${id}/care`, token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    careTasks(token: string, id: number): Promise<CareTasksOut> {
      return authed<CareTasksOut>(`/api/customers/${id}/care-tasks`, token);
    },
    careCalendar(token: string, id: number, from: string, to: string): Promise<CareCalendarOut> {
      return authed<CareCalendarOut>(
        `/api/customers/${id}/care-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        token,
      );
    },
    actOnOccurrence(
      token: string,
      id: number,
      headId: number,
      from: string,
      to: string,
      input: {
        action: "complete" | "cancel" | "reschedule" | "ghi";
        occurrence_date?: string | null;
        new_due?: string | null;
        log_kind?: string | null;
        log_note?: string | null;
        /** Ghi chú kết quả; bỏ trống = không đụng, chuỗi rỗng = xoá. */
        ket_qua?: string | null;
      },
    ): Promise<CareCalendarOut> {
      return authed<CareCalendarOut>(
        `/api/customers/${id}/care-tasks/${headId}/occurrence?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        token,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    addCareTask(
      token: string,
      id: number,
      input: {
        note: string;
        due_date: string;
        assignee_user_id?: number | null;
        repeat_freq?: string;
        repeat_interval?: number;
        repeat_until?: string | null;
      },
    ): Promise<CareTask> {
      return authed<CareTask>(`/api/customers/${id}/care-tasks`, token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    setCareTaskStatus(
      token: string,
      id: number,
      taskId: number,
      input: { status: string; log_kind?: string | null; log_note?: string | null },
    ): Promise<CareTask> {
      return authed<CareTask>(`/api/customers/${id}/care-tasks/${taskId}/status`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    /** Nút "Lịch hẹn" trên danh bạ: hẹn trễ + từ hôm nay tới `den` (mặc định 30 ngày).
     *  `toi` = hẹn giao cho tôi; `nhom` = mọi hẹn trên những khách tôi được xem. */
    lichHen(token: string, phamVi: "toi" | "nhom", den?: string): Promise<LichHenOut> {
      const qs = new URLSearchParams({ pham_vi: phamVi });
      if (den) qs.set("den", den);
      return authed<LichHenOut>(`/api/customers/lich-hen?${qs}`, token);
    },
    // --- tài liệu đính kèm (#21) ---
    attachments(token: string, id: number): Promise<{ items: CustomerAttachment[] }> {
      return authed<{ items: CustomerAttachment[] }>(`/api/customers/${id}/attachments`, token);
    },
    uploadAttachment(
      token: string,
      id: number,
      file: File,
      docKind: string,
    ): Promise<CustomerAttachment> {
      const form = new FormData();
      form.append("file", file);
      form.append("doc_kind", docKind);
      return authed<CustomerAttachment>(`/api/customers/${id}/attachments`, token, {
        method: "POST",
        body: form,
      });
    },
    deleteAttachment(token: string, id: number, attachmentId: number): Promise<void> {
      return authed<void>(`/api/customers/${id}/attachments/${attachmentId}`, token, {
        method: "DELETE",
      });
    },
    // --- ghi chú tự do (tab Ghi chú) ---
    notes(token: string, id: number): Promise<{ items: CustomerNote[] }> {
      return authed<{ items: CustomerNote[] }>(`/api/customers/${id}/notes`, token);
    },
    addNote(token: string, id: number, body: string): Promise<CustomerNote> {
      return authed<CustomerNote>(`/api/customers/${id}/notes`, token, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
    },
    updateNote(
      token: string,
      id: number,
      noteId: number,
      input: { body?: string; pinned?: boolean },
    ): Promise<CustomerNote> {
      return authed<CustomerNote>(`/api/customers/${id}/notes/${noteId}`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    deleteNote(token: string, id: number, noteId: number): Promise<void> {
      return authed<void>(`/api/customers/${id}/notes/${noteId}`, token, {
        method: "DELETE",
      });
    },
    // --- import / export danh bạ (#23) ---
    /** Xuất danh bạ CSV (blob URL, bearer-aware — mirror orderCsvBlobUrl). */
    async exportCsvBlobUrl(token: string): Promise<string> {
      const doFetch = (bearer: string) =>
        fetch(`${BASE_URL}/api/customers/xuat-excel`, {
          credentials: "include",
          cache: "no-store",
          headers: authHeader(bearer),
        });
      let resp = await doFetch(token);
      if (resp.status === 401) {
        const fresh = await refreshAccessToken();
        if (fresh) resp = await doFetch(fresh);
      }
      if (!resp.ok) throw new ApiError(`Xuất tệp thất bại (mã ${resp.status}).`, resp.status);
      return URL.createObjectURL(await resp.blob());
    },
    /** File mẫu .xlsx (blob URL) — RỖNG, chỉ dòng tiêu đề.
     *
     *  Mẫu do CHÍNH hệ xuất ra nên cột luôn khớp; đổi cấu hình thì tải lại mẫu là có cột mới.
     *  Sáu cột chính sách tài chính chỉ có mặt với người có quyền `set_credit_terms`. */
    async mauExcelBlobUrl(token: string): Promise<string> {
      const doFetch = (bearer: string) =>
        fetch(`${BASE_URL}/api/customers/mau-excel`, {
          credentials: "include",
          cache: "no-store",
          headers: authHeader(bearer),
        });
      let resp = await doFetch(token);
      if (resp.status === 401) {
        const fresh = await refreshAccessToken();
        if (fresh) resp = await doFetch(fresh);
      }
      if (!resp.ok) throw new ApiError(`Tải tệp thất bại (mã ${resp.status}).`, resp.status);
      return URL.createObjectURL(await resp.blob());
    },
    /** Nhập .xlsx — mỗi dòng một khách MỚI, CẢ FILE là một giao dịch.
     *
     *  `mode="preview"` chạy y hệt `commit` rồi rollback, nên con số xem trước là con số THẬT —
     *  không phải một bản kiểm sơ bộ dễ dãi hơn, thứ khiến người dùng bấm Xác nhận rồi mới ăn lỗi. */
    importExcel(token: string, file: File, mode: "preview" | "commit"): Promise<NhapExcelOut> {
      const form = new FormData();
      form.append("file", file);
      return authed<NhapExcelOut>(`/api/customers/import-excel?mode=${mode}`, token, {
        method: "POST",
        body: form,
      });
    },
  },

  // --- Nhãn công đoạn (bước LSX / Bài ghép) — LOGIC y hệt nhãn khách hàng ở trên,
  // chỉ đổi "khách" → "một bước" (cặp buoc_loai + buoc_id). Kho nhãn dùng CHUNG hai loại bước.
  congDoanTag: {
    /** Nhãn đã gán cho một bước. `buocLoai` ∈ {"lsx","bai_ghep"}. */
    list(token: string, buocLoai: string, buocId: number): Promise<{ items: CongDoanTagRow[] }> {
      return authed<{ items: CongDoanTagRow[] }>(
        `/api/cong-doan-tags/${buocLoai}/${buocId}`,
        token,
      );
    },
    add(token: string, buocLoai: string, buocId: number, label: string): Promise<CongDoanTagRow> {
      return authed<CongDoanTagRow>(`/api/cong-doan-tags/${buocLoai}/${buocId}`, token, {
        method: "POST",
        body: JSON.stringify({ label }),
      });
    },
    remove(token: string, buocLoai: string, buocId: number, tagId: number): Promise<void> {
      return authed<void>(`/api/cong-doan-tags/${buocLoai}/${buocId}/${tagId}`, token, {
        method: "DELETE",
      });
    },
    // --- kho nhãn dùng chung (giống `customers.tagKho` — nhãn CÓ THỂ gán) ---
    kho(token: string): Promise<{ items: KhoNhanBuocRow[] }> {
      return authed<{ items: KhoNhanBuocRow[] }>("/api/cong-doan-tags/kho", token);
    },
    themNhanKho(token: string, label: string): Promise<KhoNhanBuocRow> {
      return authed<KhoNhanBuocRow>("/api/cong-doan-tags/kho", token, {
        method: "POST",
        body: JSON.stringify({ label }),
      });
    },
    /** Xoá nhãn khỏi kho VÀ gỡ khỏi mọi bước đang mang. Trả số bước bị gỡ. */
    xoaNhanKho(token: string, nhanId: number): Promise<{ so_buoc_da_go: number }> {
      return authed<{ so_buoc_da_go: number }>(`/api/cong-doan-tags/kho/${nhanId}`, token, {
        method: "DELETE",
      });
    },
  },

  // --- Nhân sự · Hồ sơ nhân sự (nhan_su), lát #1 ----------------------------
  employees: {
    /** Danh sách nhân sự ra .xlsx THẬT (blob URL). Máy chủ lấy TRỌN theo phạm vi quyền + đúng
     *  bộ lọc đang chọn — không phụ thuộc trang đang xem, không cắt ở 200 người. */
    exportXlsxBlobUrl(
      token: string,
      params: Omit<EmployeeListParams, "page" | "size"> = {},
      /** Kỳ của thanh lọc (`tu_ngay`/`den_ngay`/`moc`). */
      loc?: ThamSoLoc,
    ): Promise<string> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.status) qs.set("status", params.status);
      if (params.department_id != null) qs.set("department_id", String(params.department_id));
      if (params.has_account != null) qs.set("has_account", String(params.has_account));
      if (params.ending_soon) qs.set("ending_soon", "true");
      if (params.sort) qs.set("sort", params.sort);
      ganThamSoLoc(qs, loc);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return blobUrl(`/api/employees/export.xlsx${suffix}`, token);
    },
    /** File MẪU để nạp dữ liệu ban đầu: đúng tiêu đề của file xuất, không kèm ai, cộng sheet
     *  Hướng dẫn liệt kê tên phòng/tổ · bậc · ca hợp lệ. Ai nhập được là tải được. */
    mauNhapBlobUrl(token: string): Promise<string> {
      return blobUrl("/api/employees/mau-nhap.xlsx", token);
    },
    /** Nhập hồ sơ từ .xlsx. `preview` chạy y hệt `commit` rồi rollback ⇒ con số xem trước là
     *  con số THẬT. Trả CÙNG hình dạng với nhập Excel danh mục (`ImportExcelOut`). */
    importExcel(token: string, file: File, mode: "preview" | "commit"): Promise<ImportExcelOut> {
      const form = new FormData();
      form.append("file", file);
      return authed<ImportExcelOut>(`/api/employees/import-excel?mode=${mode}`, token, {
        method: "POST",
        body: form,
      });
    },
    list(token: string, params: EmployeeListParams = {}, loc?: ThamSoLoc): Promise<EmployeeListOut> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.department_id != null) qs.set("department_id", String(params.department_id));
      if (params.status) qs.set("status", params.status);
      if (params.has_account != null) qs.set("has_account", String(params.has_account));
      if (params.ending_soon) qs.set("ending_soon", "true");
      if (params.sort) qs.set("sort", params.sort);
      if (params.page) qs.set("page", String(params.page));
      if (params.size) qs.set("size", String(params.size));
      ganThamSoLoc(qs, loc);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<EmployeeListOut>(`/api/employees${suffix}`, token);
    },
    meta(token: string): Promise<EmployeeMeta> {
      return authed<EmployeeMeta>("/api/employees/meta", token);
    },
    get(token: string, id: number): Promise<EmployeeDetail> {
      return authed<EmployeeDetail>(`/api/employees/${id}`, token);
    },
    create(token: string, input: EmployeeInput): Promise<EmployeeCreateOut> {
      return authed<EmployeeCreateOut>("/api/employees", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    update(token: string, id: number, input: EmployeeInput): Promise<EmployeeUpdateOut> {
      return authed<EmployeeUpdateOut>(`/api/employees/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    /** Gán ca mặc định (an toàn — chỉ đụng default_shift_id). Dùng cho panel Gán ca ở Chấm công. */
    setShift(token: string, id: number, shiftId: number | null, effectiveFrom: string): Promise<{ ok: boolean; employee_id: number; default_shift_id: number | null; assignment_id: number; effective_from: string }> {
      return authed(`/api/employees/${id}/shift`, token, {
        method: "PUT",
        body: JSON.stringify({ default_shift_id: shiftId, effective_from: effectiveFrom }),
      });
    },
    /** Đặt CA NỀN cho nhiều NV trong MỘT request (nút "Đặt ca nền" ở màn Phân ca tháng).
     *  Ca nền áp dụng từ `effectiveFrom` trở về sau cho MỌI tháng — khác với tô ca trên
     *  lưới (chỉ đúng ngày đã tô). */
    setShiftBulk(token: string, employeeIds: number[], shiftId: number | null, effectiveFrom: string):
      Promise<{ updated: number; adjusted: number; failed: { employee_id: number; reason: string }[] }> {
      return authed("/api/employees/shift/bulk", token, {
        method: "PUT",
        body: JSON.stringify({ employee_ids: employeeIds, default_shift_id: shiftId, effective_from: effectiveFrom }),
      });
    },
    shiftHistory(token: string, id: number): Promise<{ employee_id: number; items: EmployeeShiftAssignment[] }> {
      return authed<{ employee_id: number; items: EmployeeShiftAssignment[] }>(`/api/employees/${id}/shift-history`, token);
    },
    /** Gỡ một mốc ca nền gán nhầm — không có đường này thì mốc sai là vĩnh viễn. */
    deleteShiftAssignment(token: string, id: number, assignmentId: number): Promise<void> {
      return authed<void>(`/api/employees/${id}/shift-history/${assignmentId}`, token, { method: "DELETE" });
    },
    transition(token: string, id: number, input: EmployeeTransitionInput): Promise<EmployeeDetail> {
      return authed<EmployeeDetail>(`/api/employees/${id}/transitions`, token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    events(token: string, id: number): Promise<{ items: EmployeeEvent[] }> {
      return authed<{ items: EmployeeEvent[] }>(`/api/employees/${id}/events`, token);
    },
    activity(token: string, id: number): Promise<{ items: EmployeeActivityRow[] }> {
      return authed<{ items: EmployeeActivityRow[] }>(`/api/employees/${id}/activity`, token);
    },
    attachments(token: string, id: number): Promise<{ items: EmployeeAttachment[] }> {
      return authed<{ items: EmployeeAttachment[] }>(`/api/employees/${id}/attachments`, token);
    },
    upload(token: string, id: number, file: File, docKind: string): Promise<EmployeeAttachment> {
      const form = new FormData();
      form.append("file", file);
      form.append("doc_kind", docKind);
      return authed<EmployeeAttachment>(`/api/employees/${id}/attachments`, token, {
        method: "POST",
        body: form,
      });
    },
    deleteAttachment(token: string, id: number, attachmentId: number): Promise<void> {
      return authed<void>(`/api/employees/${id}/attachments/${attachmentId}`, token, {
        method: "DELETE",
      });
    },
    // --- "Hồ sơ của tôi" (self-service) ---
    me(token: string): Promise<MyProfile> {
      return authed<MyProfile>("/api/employees/me", token);
    },
    updateMe(token: string, input: MyContactInput): Promise<MyProfile> {
      return authed<MyProfile>("/api/employees/me", token, { method: "PUT", body: JSON.stringify(input) });
    },
    myEvents(token: string): Promise<{ items: EmployeeEvent[] }> {
      return authed<{ items: EmployeeEvent[] }>("/api/employees/me/events", token);
    },
    myAttachments(token: string): Promise<{ items: EmployeeAttachment[] }> {
      return authed<{ items: EmployeeAttachment[] }>("/api/employees/me/attachments", token);
    },
    // Yêu cầu cập nhật hồ sơ (NV đề nghị → HCNS duyệt)
    createMyRequest(token: string, input: UpdateRequestInput): Promise<UpdateRequest> {
      return authed<UpdateRequest>("/api/employees/me/update-requests", token, { method: "POST", body: JSON.stringify(input) });
    },
    /** Cắt trang Ở MÁY CHỦ (`page`/`size`) + lọc theo trạng thái. Trả kèm `dem` cho pill lọc. */
    myRequests(
      token: string,
      opts?: { status?: string | string[]; page?: number; size?: number; loc?: ThamSoLoc },
    ): Promise<MyUpdateRequestsPage> {
      const qs = new URLSearchParams();
      // `status` lặp được (thẻ lọc Trạng thái chọn nhiều); `loc` = kỳ `tu_ngay/den_ngay/moc`.
      ([] as string[]).concat(opts?.status ?? []).forEach((s) => qs.append("status", s));
      ganThamSoLoc(qs, opts?.loc);
      qs.set("page", String(opts?.page ?? 1));
      qs.set("size", String(opts?.size ?? 10));
      return authed<MyUpdateRequestsPage>(`/api/employees/me/update-requests?${qs}`, token);
    },
    /** NV tự rút lại đề nghị của mình khi HCNS chưa xử lý. Dòng vẫn còn (status `cancelled`). */
    cancelMyRequest(token: string, id: number): Promise<UpdateRequest> {
      return authed<UpdateRequest>(`/api/employees/me/update-requests/${id}/cancel`, token, { method: "POST" });
    },
    updateRequests(token: string, status?: string): Promise<{ items: UpdateRequest[] }> {
      const s = status ? `?status=${encodeURIComponent(status)}` : "";
      return authed<{ items: UpdateRequest[] }>(`/api/employees/update-requests${s}`, token);
    },
    approveRequest(token: string, id: number, note?: string): Promise<UpdateRequest> {
      return authed<UpdateRequest>(`/api/employees/update-requests/${id}/approve`, token, { method: "POST", body: JSON.stringify({ note: note ?? null }) });
    },
    rejectRequest(token: string, id: number, note?: string): Promise<UpdateRequest> {
      return authed<UpdateRequest>(`/api/employees/update-requests/${id}/reject`, token, { method: "POST", body: JSON.stringify({ note: note ?? null }) });
    },
    /** Cấp tài khoản MỚI cho hồ sơ đã có — đường chính (mọi tài khoản sinh ra từ một hồ sơ). */
    createAccount(
      token: string,
      id: number,
      input: { username: string; password: string; role_id?: number | null },
    ): Promise<EmployeeDetail> {
      return authed<EmployeeDetail>(`/api/employees/${id}/account`, token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** Liên kết một tài khoản CÓ SẴN — chỉ dùng để dọn tài khoản mồ côi cũ. */
    linkAccount(token: string, id: number, userId: number): Promise<EmployeeDetail> {
      return authed<EmployeeDetail>(`/api/employees/${id}/account`, token, {
        method: "POST",
        body: JSON.stringify({ user_id: userId }),
      });
    },
    // `unlinkAccount` ĐÃ GỠ: gỡ liên kết = đẻ ra tài khoản mồ côi (vi phạm luật "mọi tài
    // khoản thuộc một hồ sơ"). Chặn một người = KHÓA tài khoản (`api.rbac.setUserActive`).
  },

  // --- Chấm công GPS (nhan_su) ----------------------------------------------
  attendance: {
    locations(token: string): Promise<{ items: WorkLocation[] }> {
      return authed<{ items: WorkLocation[] }>("/api/attendance/locations", token);
    },
    createLocation(token: string, input: WorkLocationInput): Promise<WorkLocation> {
      return authed<WorkLocation>("/api/attendance/locations", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    updateLocation(token: string, id: number, input: WorkLocationInput): Promise<WorkLocation> {
      return authed<WorkLocation>(`/api/attendance/locations/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    deleteLocation(token: string, id: number): Promise<void> {
      return authed<void>(`/api/attendance/locations/${id}`, token, { method: "DELETE" });
    },
    myStatus(token: string): Promise<AttendanceStatus> {
      return authed<AttendanceStatus>("/api/attendance/me/status", token);
    },
    /** `accuracy` = `coords.accuracy` (mét): máy chủ từ chối khi cỡ "vị trí gần đúng" và lưu kèm lượt chấm. */
    check(token: string, latitude: number, longitude: number, accuracy?: number): Promise<CheckResult> {
      return authed<CheckResult>("/api/attendance/check", token, {
        method: "POST",
        body: JSON.stringify({ latitude, longitude, accuracy }),
      });
    },
    /** Dry-run geofence (không ghi log) cho card chấm "sống". */
    preview(token: string, latitude: number, longitude: number, accuracy?: number): Promise<AttendancePreview> {
      return authed<AttendancePreview>("/api/attendance/me/preview", token, {
        method: "POST",
        body: JSON.stringify({ latitude, longitude, accuracy }),
      });
    },
    myLogs(token: string): Promise<{ items: AttendanceLog[] }> {
      return authed<{ items: AttendanceLog[] }>("/api/attendance/me/logs", token);
    },
    /** Bảng công tháng CỦA CHÍNH NV (self-service, không cần quyền module). */
    myTimesheet(token: string, year: number, month: number): Promise<Timesheet> {
      const qs = new URLSearchParams({ year: String(year), month: String(month) });
      return authed<Timesheet>(`/api/attendance/me/timesheet?${qs.toString()}`, token);
    },
    /** "Ô biết nói": punch thật + công của 1 NV trong 1 ngày (HR, theo scope). */
    day(token: string, employeeId: number, date: string): Promise<DayDetail> {
      const qs = new URLSearchParams({ employee_id: String(employeeId), date });
      return authed<DayDetail>(`/api/attendance/day?${qs.toString()}`, token);
    },
    /** Chấm bù / sửa: thêm 1 punch điều chỉnh tay (cần quyền nhan_su.adjust). */
    adjust(token: string, input: AdjustInput): Promise<DayDetail> {
      return authed<DayDetail>("/api/attendance/adjust", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** Xóa 1 punch điều chỉnh tay (hoàn tác chấm bù). */
    deleteManualLog(token: string, logId: number, employeeId: number, date: string): Promise<DayDetail> {
      const qs = new URLSearchParams({ employee_id: String(employeeId), date });
      return authed<DayDetail>(`/api/attendance/logs/${logId}?${qs.toString()}`, token, { method: "DELETE" });
    },
    /** KPI giám sát hôm nay (HR, theo scope). */
    kpi(token: string): Promise<TodayKpi> {
      return authed<TodayKpi>("/api/attendance/kpi", token);
    },
    /** Xác nhận TC theo phiếu (07/09/2026): phiếu đã duyệt của ngày + tình trạng cặp bấm, theo scope Chấm bù. */
    otConfirmCandidates(token: string, date: string, departmentId?: number | null): Promise<OtConfirmCandidates> {
      const qs = new URLSearchParams({ date });
      if (departmentId != null) qs.set("department_id", String(departmentId));
      return authed<OtConfirmCandidates>(`/api/attendance/ot-confirm?${qs.toString()}`, token);
    },
    /** Sinh cặp bấm tay theo phiếu cho các NV thiếu cặp — ai không thiếu thì máy bỏ qua có lý do. */
    otConfirm(token: string, input: OtConfirmInput): Promise<OtConfirmResult> {
      return authed<OtConfirmResult>("/api/attendance/ot-confirm", token, {
        method: "POST", body: JSON.stringify(input),
      });
    },
    // --- Yêu cầu chỉnh công ---
    createAdjustRequest(token: string, input: RequestAdjustInput): Promise<AdjustRequest> {
      return authed<AdjustRequest>("/api/attendance/me/adjust-request", token, {
        method: "POST", body: JSON.stringify(input),
      });
    },
    myAdjustRequests(token: string): Promise<MyAdjustRequests> {
      return authed<MyAdjustRequests>("/api/attendance/me/adjust-requests", token);
    },
    cancelAdjustRequest(token: string, id: number): Promise<AdjustRequest> {
      return authed<AdjustRequest>(`/api/attendance/me/adjust-requests/${id}/cancel`, token, { method: "POST" });
    },
    /** Yêu cầu chỉnh công của HCNS — `status` (pending|approved|rejected|cancelled|all), kỳ
     *  `tu_ngay/den_ngay/moc` (tao|ngay_cong), `employee_id`, `phong`, `page`, `size`. */
    listAdjustRequests(token: string, loc: ThamSoLoc): Promise<PagedTab<AdjustRequest>> {
      return authed<PagedTab<AdjustRequest>>(`/api/attendance/adjust-requests${qsLoc(loc)}`, token);
    },
    locAdjustRequests(token: string, truong: "nhan_vien" | "phong"): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>(`/api/attendance/adjust-requests/loc/${truong}`, token);
    },
    approveAdjustRequest(token: string, id: number, input: { time?: string | null; next_day?: boolean | null; fault_party?: string | null; note?: string | null }): Promise<AdjustRequest> {
      return authed<AdjustRequest>(`/api/attendance/adjust-requests/${id}/approve`, token, {
        method: "POST", body: JSON.stringify(input),
      });
    },
    rejectAdjustRequest(token: string, id: number, note: string): Promise<AdjustRequest> {
      return authed<AdjustRequest>(`/api/attendance/adjust-requests/${id}/reject`, token, {
        method: "POST", body: JSON.stringify({ note }),
      });
    },
    /** Nhật ký chấm công — lọc + phân trang ở MÁY CHỦ (06/10/2026, bỏ trần 100 lượt): `q` tìm
     *  tên / mã NV, kỳ `tu_ngay/den_ngay/moc` (cham|tao), `employee_id`, `phong`, `diem`, `page`, `size`. */
    logs(token: string, loc: ThamSoLoc): Promise<Paged<AttendanceLog>> {
      return authed<Paged<AttendanceLog>>(`/api/attendance/logs${qsLoc(loc)}`, token);
    },
    locLogs(token: string, truong: "nhan_vien" | "phong" | "diem"): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>(`/api/attendance/logs/loc/${truong}`, token);
    },
    timesheet(token: string, year: number, month: number, departmentId?: number | null): Promise<Timesheet> {
      const qs = new URLSearchParams({ year: String(year), month: String(month) });
      if (departmentId != null) qs.set("department_id", String(departmentId));
      return authed<Timesheet>(`/api/attendance/timesheet?${qs.toString()}`, token);
    },
    /** Xuất bảng công tháng ra .xlsx — fetch as a blob (bearer + refresh-aware).
     *  Bản .csv cũ đã bỏ 09/09/2026: ô ngày không ra công/giờ in chữ "có" và tăng ca không hiện. */
    async timesheetExcelBlobUrl(token: string, year: number, month: number, departmentId?: number | null,
                                q?: string | null): Promise<string> {
      const qs = new URLSearchParams({ year: String(year), month: String(month) });
      if (departmentId != null) qs.set("department_id", String(departmentId));
      // `q` = ô tìm tên/mã trên màn: file xuất ra phải đúng thứ đang thấy, không phải cả xưởng.
      if (q && q.trim()) qs.set("q", q.trim());
      const doFetch = (bearer: string) =>
        fetch(`${BASE_URL}/api/attendance/timesheet.xlsx?${qs.toString()}`, {
          credentials: "include", cache: "no-store", headers: authHeader(bearer),
        });
      let resp = await doFetch(token);
      if (resp.status === 401) {
        const fresh = await refreshAccessToken();
        if (fresh) resp = await doFetch(fresh);
      }
      if (!resp.ok) throw new ApiError(`Xuất tệp thất bại (mã ${resp.status}).`, resp.status);
      const blob = await resp.blob();
      return URL.createObjectURL(blob);
    },
    // --- ca kíp (work shifts) ---
    /** Danh sách ca + mẫu số đang áp (Giờ công chuẩn / ngày, luật "ca phải khớp" — 07/09/2026). */
    shifts(token: string): Promise<WorkShiftsList> {
      return authed<WorkShiftsList>("/api/attendance/shifts", token);
    },
    createShift(token: string, input: WorkShiftInput): Promise<WorkShift> {
      return authed<WorkShift>("/api/attendance/shifts", token, { method: "POST", body: JSON.stringify(input) });
    },
    updateShift(token: string, id: number, input: WorkShiftInput): Promise<WorkShift> {
      return authed<WorkShift>(`/api/attendance/shifts/${id}`, token, { method: "PUT", body: JSON.stringify(input) });
    },
    deleteShift(token: string, id: number): Promise<void> {
      return authed<void>(`/api/attendance/shifts/${id}`, token, { method: "DELETE" });
    },
    // --- Lưới phân ca tháng (shift plan) ---
    shiftPlan(token: string, year: number, month: number, departmentId?: number | null): Promise<ShiftPlanMonth> {
      const qs = new URLSearchParams({ year: String(year), month: String(month) });
      if (departmentId != null) qs.set("department_id", String(departmentId));
      return authed<ShiftPlanMonth>(`/api/attendance/shift-plan?${qs.toString()}`, token);
    },
    /** Lưu hàng loạt (tối đa 2000 ô/request) — ô sai trả về trong `rejected`, KHÔNG bị nuốt. */
    saveShiftPlan(token: string, year: number, month: number, items: ShiftPlanPatchItem[]): Promise<ShiftPlanSaveOut> {
      return authed<ShiftPlanSaveOut>("/api/attendance/shift-plan", token,
        { method: "PUT", body: JSON.stringify({ year, month, cells: items }) });
    },
    // --- Lịch sử thay đổi ca + hộp thư của NV (chủ 28/07/2026) ---
    /** Lịch sử đổi ca cho HCNS — CẢ ô lưới (`kind=day`) lẫn ca nền (`kind=base`).
     *  Bỏ `kind` = xem cả hai. Lọc theo scope người gọi ở backend. */
    shiftChanges(token: string, opts: { year?: number; month?: number; employeeId?: number; kind?: ShiftChangeKind } = {}): Promise<{ items: ShiftChange[] }> {
      const qs = new URLSearchParams();
      if (opts.year) qs.set("year", String(opts.year));
      if (opts.month) qs.set("month", String(opts.month));
      if (opts.employeeId != null) qs.set("employee_id", String(opts.employeeId));
      if (opts.kind) qs.set("kind", opts.kind);
      return authed<{ items: ShiftChange[] }>(`/api/attendance/shift-changes?${qs.toString()}`, token);
    },
    /** Hộp thư "ca của tôi vừa bị đổi" — mọi NV có tài khoản đều gọi được.
     *  `unseen: true` = chỉ tin CHƯA ĐỌC (khối báo ở màn Công của tôi; lấy cả tin đã đọc thì
     *  khối đó bám đầu màn vĩnh viễn). */
    myShiftChanges(token: string, opts: { unseen?: boolean } = {}): Promise<{ items: ShiftChange[] }> {
      const qs = opts.unseen ? "?unseen=true" : "";
      return authed<{ items: ShiftChange[] }>(`/api/attendance/my-shift-changes${qs}`, token);
    },
    markShiftChangesSeen(token: string): Promise<AttendanceNotify> {
      return authed<AttendanceNotify>("/api/attendance/my-shift-changes/seen", token, { method: "POST" });
    },
    /** Số nuôi badge — SSE đẩy `shift_changed` thì gọi lại hàm này. */
    notifySummary(token: string): Promise<AttendanceNotify> {
      return authed<AttendanceNotify>("/api/attendance/notify-summary", token);
    },
    // --- Chốt công tháng (kỳ công) ---
    period(token: string, year: number, month: number): Promise<AttendancePeriod> {
      return authed<AttendancePeriod>(`/api/attendance/period?year=${year}&month=${month}`, token);
    },
    lockPeriod(token: string, year: number, month: number): Promise<AttendancePeriod> {
      return authed<AttendancePeriod>("/api/attendance/period/lock", token,
        { method: "POST", body: JSON.stringify({ year, month }) });
    },
    reopenPeriod(token: string, year: number, month: number): Promise<AttendancePeriod> {
      return authed<AttendancePeriod>("/api/attendance/period/reopen", token,
        { method: "POST", body: JSON.stringify({ year, month }) });
    },
  },

  // --- Trung tâm thông báo (chuông) -----------------------------------------
  notifications: {
    list(token: string, limit = 30): Promise<NotificationList> {
      return authed(`/api/notifications?limit=${limit}`, token);
    },
    markRead(token: string, id: number): Promise<void> {
      return authed(`/api/notifications/${id}/read`, token, { method: "POST" });
    },
    markAllRead(token: string): Promise<void> {
      return authed("/api/notifications/read-all", token, { method: "POST" });
    },
  },

  // --- Tăng ca (tang_ca) ----------------------------------------------------
  overtime: {
    /** Phiếu của tôi — `status_filter`, kỳ `tu_ngay/den_ngay/moc` (tao|ngay_cong), `page`, `size`.
     *  Mới tạo nhất lên đầu. */
    mine(token: string, params?: ThamSoLoc): Promise<MyOvertime> {
      return authed<MyOvertime>(`/api/overtime/me${qsLoc(params)}`, token);
    },
    createMine(token: string, input: OvertimeInput): Promise<OvertimeRequest> {
      return authed<OvertimeRequest>("/api/overtime/me", token,
        { method: "POST", body: JSON.stringify(input) });
    },
    updateMine(token: string, id: number, input: OvertimeInput): Promise<OvertimeRequest> {
      return authed<OvertimeRequest>(`/api/overtime/${id}`, token,
        { method: "PUT", body: JSON.stringify(input) });
    },
    createFor(token: string, input: OvertimeForInput): Promise<OvertimeRequest> {
      return authed<OvertimeRequest>("/api/overtime", token,
        { method: "POST", body: JSON.stringify(input) });
    },
    /** Tham số giữ ĐÚNG tên backend: `status_filter` (đừng đổi thành `status`), `employee_id`,
     *  `phong`, kỳ `tu_ngay/den_ngay/moc` (tao|ngay_cong), `page`, `size`. */
    list(token: string, params?: ThamSoLoc): Promise<PagedTab<OvertimeRequest>> {
      return authed<PagedTab<OvertimeRequest>>(`/api/overtime${qsLoc(params)}`, token);
    },
    loc(token: string, truong: "nhan_vien" | "phong"): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>(`/api/overtime/loc/${truong}`, token);
    },
    approve(token: string, id: number, note?: string): Promise<OvertimeRequest> {
      return authed<OvertimeRequest>(`/api/overtime/${id}/approve`, token,
        { method: "POST", body: JSON.stringify({ note: note ?? null }) });
    },
    reject(token: string, id: number, note: string): Promise<OvertimeRequest> {
      return authed<OvertimeRequest>(`/api/overtime/${id}/reject`, token,
        { method: "POST", body: JSON.stringify({ note }) });
    },
    /** Hủy THẲNG. Phiếu ĐÃ DUYỆT chỉ người duyệt hủy được và phải có `lyDo` (23/09/2026). */
    cancel(token: string, id: number, lyDo?: string): Promise<OvertimeRequest> {
      return authed<OvertimeRequest>(`/api/overtime/${id}/cancel`, token,
        { method: "POST", body: JSON.stringify({ ly_do: lyDo ?? null }) });
    },
    // --- Xin hủy phiếu ĐÃ DUYỆT (23/09/2026) ---
    xinHuy(token: string, id: number, lyDo: string): Promise<OvertimeRequest> {
      return authed<OvertimeRequest>(`/api/overtime/${id}/xin-huy`, token,
        { method: "POST", body: JSON.stringify({ ly_do: lyDo }) });
    },
    rutLaiXinHuy(token: string, ycId: number): Promise<OvertimeRequest> {
      return authed<OvertimeRequest>(`/api/overtime/xin-huy/${ycId}/rut-lai`, token, { method: "POST" });
    },
    /** `dongY=false` (giữ nguyên) phải có `ghiChu`. */
    quyetXinHuy(token: string, ycId: number, dongY: boolean, ghiChu?: string): Promise<OvertimeRequest> {
      return authed<OvertimeRequest>(`/api/overtime/xin-huy/${ycId}/quyet`, token,
        { method: "POST", body: JSON.stringify({ dong_y: dongY, ghi_chu: ghiChu ?? null }) });
    },
    xinHuyChoDuyet(token: string): Promise<{ items: XinHuyChoDuyet<OvertimeRequest>[] }> {
      return authed<{ items: XinHuyChoDuyet<OvertimeRequest>[] }>("/api/overtime/xin-huy", token);
    },
    bulkApprove(token: string, ids: number[]): Promise<OvertimeBulkResult> {
      return authed<OvertimeBulkResult>("/api/overtime/bulk-approve", token,
        { method: "POST", body: JSON.stringify({ ids }) });
    },
    bulkReject(token: string, ids: number[], note: string): Promise<OvertimeBulkResult> {
      return authed<OvertimeBulkResult>("/api/overtime/bulk-reject", token,
        { method: "POST", body: JSON.stringify({ ids, note }) });
    },
    summary(token: string): Promise<OvertimeSummary> {
      return authed<OvertimeSummary>("/api/overtime/summary", token);
    },
    /** Số dư trần giờ làm thêm THÁNG (Đ107). `employeeId` bỏ trống = của chính người gọi;
     *  `excludeId` = id phiếu ĐANG SỬA để nó không tự đếm chính nó. */
    tranThang(token: string, params: {
      year: number; month: number; employeeId?: number | null; excludeId?: number | null;
    }): Promise<TranThangOut> {
      return authed<TranThangOut>(`/api/overtime/tran-thang${qs({
        year: params.year,
        month: params.month,
        employee_id: params.employeeId,
        exclude_id: params.excludeId,
      })}`, token);
    },
    markSeen(token: string): Promise<void> {
      return authed<void>("/api/overtime/mark-seen", token, { method: "POST" });
    },
    /** Thợ trong tầm để tạo hộ — KHÔNG dùng `/api/employees` (tổ trưởng không có module nhân sự). */
    roster(token: string): Promise<OvertimeRoster> {
      return authed<OvertimeRoster>("/api/overtime/roster", token);
    },
  },

  // --- Đi muộn / về sớm / nghỉ nửa buổi (di_muon) ---------------------------
  // Cùng khuôn với `overtime` (tổ trưởng duyệt) nhưng BẢNG RIÊNG: phiếu này không bao giờ
  // lẫn vào Nghỉ phép, và không sinh tiền tăng ca.
  lateEarly: {
    mine(token: string): Promise<MyLateEarly> {
      return authed<MyLateEarly>("/api/late-early/me", token);
    },
    createMine(token: string, input: LateEarlyInput): Promise<LateEarlyRequest> {
      return authed<LateEarlyRequest>("/api/late-early/me", token,
        { method: "POST", body: JSON.stringify(input) });
    },
    updateMine(token: string, id: number, input: LateEarlyInput): Promise<LateEarlyRequest> {
      return authed<LateEarlyRequest>(`/api/late-early/${id}`, token,
        { method: "PUT", body: JSON.stringify(input) });
    },
    createFor(token: string, input: LateEarlyForInput): Promise<LateEarlyRequest> {
      return authed<LateEarlyRequest>("/api/late-early", token,
        { method: "POST", body: JSON.stringify(input) });
    },
    /** Hàng duyệt — `status_filter`, kỳ `tu_ngay/den_ngay/moc` (tao|ngay_cong), `kieu` (nhiều:
     *  late/early/half/mid, máy chủ suy theo ca), `employee_id`, `phong`, `page`, `size`. */
    list(token: string, params?: ThamSoLoc): Promise<PagedTab<LateEarlyRequest>> {
      return authed<PagedTab<LateEarlyRequest>>(`/api/late-early${qsLoc(params)}`, token);
    },
    loc(token: string, truong: "nhan_vien" | "phong"): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>(`/api/late-early/loc/${truong}`, token);
    },
    approve(token: string, id: number, note?: string): Promise<LateEarlyRequest> {
      return authed<LateEarlyRequest>(`/api/late-early/${id}/approve`, token,
        { method: "POST", body: JSON.stringify({ note: note ?? null }) });
    },
    reject(token: string, id: number, note: string): Promise<LateEarlyRequest> {
      return authed<LateEarlyRequest>(`/api/late-early/${id}/reject`, token,
        { method: "POST", body: JSON.stringify({ note }) });
    },
    cancel(token: string, id: number): Promise<LateEarlyRequest> {
      return authed<LateEarlyRequest>(`/api/late-early/${id}/cancel`, token, { method: "POST" });
    },
    bulkApprove(token: string, ids: number[]): Promise<LateEarlyBulkResult> {
      return authed<LateEarlyBulkResult>("/api/late-early/bulk-approve", token,
        { method: "POST", body: JSON.stringify({ ids }) });
    },
    bulkReject(token: string, ids: number[], note: string): Promise<LateEarlyBulkResult> {
      return authed<LateEarlyBulkResult>("/api/late-early/bulk-reject", token,
        { method: "POST", body: JSON.stringify({ ids, note }) });
    },
    roster(token: string): Promise<LateEarlyRoster> {
      return authed<LateEarlyRoster>("/api/late-early/roster", token);
    },
    summary(token: string): Promise<LateEarlySummary> {
      return authed<LateEarlySummary>("/api/late-early/summary", token);
    },
    markSeen(token: string): Promise<void> {
      return authed<void>("/api/late-early/mark-seen", token, { method: "POST" });
    },
  },

  // --- Nghỉ phép (nhan_su) --------------------------------------------------
  leaves: {
    types(token: string): Promise<{ items: LeaveType[] }> {
      return authed<{ items: LeaveType[] }>("/api/leaves/types", token);
    },
    createType(token: string, input: LeaveTypeInput): Promise<LeaveType> {
      return authed<LeaveType>("/api/leaves/types", token, { method: "POST", body: JSON.stringify(input) });
    },
    updateType(token: string, id: number, input: LeaveTypeInput): Promise<LeaveType> {
      return authed<LeaveType>(`/api/leaves/types/${id}`, token, { method: "PUT", body: JSON.stringify(input) });
    },
    deleteType(token: string, id: number): Promise<void> {
      return authed<void>(`/api/leaves/types/${id}`, token, { method: "DELETE" });
    },
    /** Không truyền `params` = trang 1, cỡ 20. Màn Chấm công gọi kiểu đó và chỉ đọc `quotas`
     *  (số dư phép năm) — `quotas` KHÔNG bị phân trang nên vẫn đúng. */
    /** `status`, kỳ `tu_ngay/den_ngay/moc` (tao|nghi — nghỉ GIAO kỳ), `loai`, `page`, `size`.
     *  Mới tạo nhất lên đầu. */
    me(token: string, params?: ThamSoLoc): Promise<MyLeave> {
      return authed<MyLeave>(`/api/leaves/me${qsLoc(params)}`, token);
    },
    create(token: string, input: LeaveRequestInput): Promise<LeaveRequest> {
      return authed<LeaveRequest>("/api/leaves", token, { method: "POST", body: JSON.stringify(input) });
    },
    /** Hủy THẲNG. Đơn ĐÃ DUYỆT chỉ người duyệt hủy được và phải có `lyDo` (23/09/2026). */
    cancel(token: string, id: number, lyDo?: string): Promise<LeaveRequest> {
      return authed<LeaveRequest>(`/api/leaves/${id}/cancel`, token,
        { method: "POST", body: JSON.stringify({ ly_do: lyDo ?? null }) });
    },
    // --- Xin hủy đơn ĐÃ DUYỆT (23/09/2026) ---
    xinHuy(token: string, id: number, lyDo: string): Promise<LeaveRequest> {
      return authed<LeaveRequest>(`/api/leaves/${id}/xin-huy`, token,
        { method: "POST", body: JSON.stringify({ ly_do: lyDo }) });
    },
    rutLaiXinHuy(token: string, ycId: number): Promise<LeaveRequest> {
      return authed<LeaveRequest>(`/api/leaves/xin-huy/${ycId}/rut-lai`, token, { method: "POST" });
    },
    /** `dongY=false` (giữ nguyên) phải có `ghiChu`. */
    quyetXinHuy(token: string, ycId: number, dongY: boolean, ghiChu?: string): Promise<LeaveRequest> {
      return authed<LeaveRequest>(`/api/leaves/xin-huy/${ycId}/quyet`, token,
        { method: "POST", body: JSON.stringify({ dong_y: dongY, ghi_chu: ghiChu ?? null }) });
    },
    xinHuyChoDuyet(token: string): Promise<{ items: XinHuyChoDuyet<LeaveRequest>[] }> {
      return authed<{ items: XinHuyChoDuyet<LeaveRequest>[] }>("/api/leaves/xin-huy", token);
    },
    /** Tab Duyệt — `status`, `employee_id` (lọc Ở MÁY CHỦ, không lọc trên mảng đã tải), `phong`,
     *  `loai`, kỳ `tu_ngay/den_ngay/moc` (tao|nghi), `page`, `size`. */
    list(token: string, params?: ThamSoLoc): Promise<PagedTab<LeaveRequest>> {
      return authed<PagedTab<LeaveRequest>>(`/api/leaves${qsLoc(params)}`, token);
    },
    loc(token: string, truong: "nhan_vien" | "phong" | "nguoi_duyet"): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>(`/api/leaves/loc/${truong}`, token);
    },
    approve(token: string, id: number, note?: string): Promise<LeaveRequest> {
      return authed<LeaveRequest>(`/api/leaves/${id}/approve`, token, { method: "POST", body: JSON.stringify({ note: note ?? null }) });
    },
    reject(token: string, id: number, note: string): Promise<LeaveRequest> {
      return authed<LeaveRequest>(`/api/leaves/${id}/reject`, token, { method: "POST", body: JSON.stringify({ note }) });
    },
    /** Số đơn chờ duyệt (nuôi badge sidebar). pending_in_scope=null nếu không có quyền duyệt. */
    summary(token: string): Promise<LeaveSummary> {
      return authed<LeaveSummary>("/api/leaves/summary", token);
    },
    bulkApprove(token: string, ids: number[]): Promise<{ done: number[]; skipped: number[] }> {
      return authed<{ done: number[]; skipped: number[] }>("/api/leaves/bulk-approve", token, { method: "POST", body: JSON.stringify({ ids }) });
    },
    bulkReject(token: string, ids: number[], note: string): Promise<{ done: number[]; skipped: number[] }> {
      return authed<{ done: number[]; skipped: number[] }>("/api/leaves/bulk-reject", token, { method: "POST", body: JSON.stringify({ ids, note }) });
    },
    calendar(token: string, year: number, month: number): Promise<LeaveCalendar> {
      return authed<LeaveCalendar>(`/api/leaves/calendar?year=${year}&month=${month}`, token);
    },
    /** NV xác nhận đã xem kết quả các đơn của mình (đóng chuông Topbar). */
    markSeen(token: string): Promise<void> {
      return authed<void>("/api/leaves/mark-seen", token, { method: "POST" });
    },
  },

  // --- Lịch làm việc & Ngày lễ (nhan_su) ------------------------------------
  calendar: {
    getConfig(token: string): Promise<WorkCalendarConfig> {
      return authed<WorkCalendarConfig>("/api/calendar/config", token);
    },
    updateConfig(token: string, input: WorkCalendarConfigInput): Promise<WorkCalendarConfig> {
      return authed<WorkCalendarConfig>("/api/calendar/config", token, { method: "PUT", body: JSON.stringify(input) });
    },
    specialDays(token: string, year: number): Promise<SpecialDaysOut> {
      return authed<SpecialDaysOut>(`/api/calendar/special-days?year=${year}`, token);
    },
    createSpecialDay(token: string, input: SpecialDayInput): Promise<SpecialDay> {
      return authed<SpecialDay>("/api/calendar/special-days", token, { method: "POST", body: JSON.stringify(input) });
    },
    updateSpecialDay(token: string, id: number, input: SpecialDayInput): Promise<SpecialDay> {
      return authed<SpecialDay>(`/api/calendar/special-days/${id}`, token, { method: "PUT", body: JSON.stringify(input) });
    },
    deleteSpecialDay(token: string, id: number): Promise<void> {
      return authed<void>(`/api/calendar/special-days/${id}`, token, { method: "DELETE" });
    },
    month(token: string, year: number, month: number): Promise<CalendarMonth> {
      return authed<CalendarMonth>(`/api/calendar/month?year=${year}&month=${month}`, token);
    },
  },

  // --- Lương (module `luong`, Phase 1) --------------------------------------
  luong: {
    getParams(token: string): Promise<PayrollParams> {
      return authed<PayrollParams>("/api/luong/params", token);
    },
    updateParams(token: string, input: Partial<PayrollParams>): Promise<PayrollParams> {
      return authed<PayrollParams>("/api/luong/params", token, { method: "PUT", body: JSON.stringify(input) });
    },
    salaries(token: string, employeeId: number): Promise<EmployeeSalaries> {
      return authed<EmployeeSalaries>(`/api/luong/salaries/${employeeId}`, token);
    },
    salaryPreview(token: string, employeeId: number): Promise<SalaryPreview> {
      return authed<SalaryPreview>(`/api/luong/salaries/${employeeId}/preview`, token);
    },
    setSalary(token: string, employeeId: number, input: EmployeeSalaryInput): Promise<EmployeeSalary> {
      return authed<EmployeeSalary>(`/api/luong/salaries/${employeeId}`, token, { method: "POST", body: JSON.stringify(input) });
    },
    deleteSalary(token: string, salaryId: number): Promise<void> {
      return authed<void>(`/api/luong/salaries/item/${salaryId}`, token, { method: "DELETE" });
    },
    advances(token: string, year: number, month: number, status?: string): Promise<{ items: SalaryAdvance[] }> {
      const s = status ? `&status=${encodeURIComponent(status)}` : "";
      return authed<{ items: SalaryAdvance[] }>(`/api/luong/advances?year=${year}&month=${month}${s}`, token);
    },
    /** Màn Tạm ứng: `loc` mang tab, q, loai, to, tien_tu/den, tu_ngay/den_ngay/moc, page, size. */
    danhSachTamUng(token: string, year: number, month: number, loc?: ThamSoLoc): Promise<TamUngDanhSach> {
      const qs = new URLSearchParams({ year: String(year), month: String(month) });
      ganThamSoLoc(qs, loc);
      return authed<TamUngDanhSach>(`/api/luong/advances?${qs.toString()}`, token);
    },
    createAdvance(token: string, input: SalaryAdvanceInput): Promise<SalaryAdvance> {
      return authed<SalaryAdvance>("/api/luong/advances", token, { method: "POST", body: JSON.stringify(input) });
    },
    /** Người trong phạm vi + công tính lương tới ngày lập phiếu, đủ điều kiện hay chưa (25/09/2026). */
    ungVienTamUng(
      token: string,
      p: { year: number; month: number; advanceDate: string; kind: "tam_ung" | "luong_dot_1" },
    ): Promise<UngVienTamUngList> {
      const qs = new URLSearchParams({
        year: String(p.year), month: String(p.month), advance_date: p.advanceDate, kind: p.kind,
      });
      return authed<UngVienTamUngList>(`/api/luong/advances/ung-vien?${qs.toString()}`, token);
    },
    /** Lập phiếu cho nhiều người một lượt — còn một người chưa đủ điều kiện là không ghi phiếu nào. */
    createAdvancesBulk(token: string, input: {
      period_year: number;
      period_month: number;
      advance_date: string;
      kind: "tam_ung" | "luong_dot_1";
      reason?: string | null;
      items: { employee_id: number; amount: number }[];
    }): Promise<{ items: SalaryAdvance[] }> {
      return authed<{ items: SalaryAdvance[] }>("/api/luong/advances/bulk", token, {
        method: "POST", body: JSON.stringify(input),
      });
    },
    approveAdvance(token: string, id: number, note?: string): Promise<SalaryAdvance> {
      return authed<SalaryAdvance>(`/api/luong/advances/${id}/approve`, token, { method: "POST", body: JSON.stringify({ note: note ?? null }) });
    },
    rejectAdvance(token: string, id: number, note?: string): Promise<SalaryAdvance> {
      return authed<SalaryAdvance>(`/api/luong/advances/${id}/reject`, token, { method: "POST", body: JSON.stringify({ note: note ?? null }) });
    },
    /** Duyệt / từ chối NHIỀU phiếu một lượt (25/09/2026). Một phiếu vướng là không phiếu nào
     *  đổi trạng thái — server báo rõ phiếu nào. */
    decideAdvancesBulk(token: string, input: {
      ids: number[];
      approve: boolean;
      note?: string | null;
    }): Promise<{ items: SalaryAdvance[] }> {
      return authed<{ items: SalaryAdvance[] }>("/api/luong/advances/bulk-decision", token, {
        method: "POST", body: JSON.stringify(input),
      });
    },
    cancelAdvance(token: string, id: number): Promise<SalaryAdvance> {
      return authed<SalaryAdvance>(`/api/luong/advances/${id}/cancel`, token, { method: "POST" });
    },
    myAdvances(token: string): Promise<MyAdvances> {
      return authed<MyAdvances>("/api/luong/advances/me", token);
    },
    /** Công tính lương của CHÍNH MÌNH từ ngày 1 của kỳ tới ngày ứng + ngưỡng (25/09/2026). */
    dieuKienTamUngCuaToi(
      token: string,
      p: { year: number; month: number; advanceDate: string },
    ): Promise<{ nguong: number; den_ngay: number; cong: number; du_dieu_kien: boolean }> {
      const qs = new URLSearchParams({
        year: String(p.year), month: String(p.month), advance_date: p.advanceDate,
      });
      return authed(`/api/luong/advances/me/dieu-kien?${qs.toString()}`, token);
    },
    createMyAdvance(token: string, input: MyAdvanceInput): Promise<SalaryAdvance> {
      return authed<SalaryAdvance>("/api/luong/advances/me", token, { method: "POST", body: JSON.stringify(input) });
    },
    advanceNotifySummary(token: string): Promise<AdvanceNotifySummary> {
      return authed<AdvanceNotifySummary>("/api/luong/advances/notify-summary", token);
    },
    periods(token: string): Promise<{ items: PayrollPeriod[] }> {
      return authed<{ items: PayrollPeriod[] }>("/api/luong/periods", token);
    },
    table(token: string, year: number, month: number, loc?: ThamSoLoc): Promise<PayrollTable> {
      const qs = new URLSearchParams({ year: String(year), month: String(month) });
      ganThamSoLoc(qs, loc);
      return authed<PayrollTable>(`/api/luong/table?${qs.toString()}`, token);
    },
    generate(token: string, year: number, month: number): Promise<PayrollTable> {
      return authed<PayrollTable>("/api/luong/generate", token, { method: "POST", body: JSON.stringify({ year, month }) });
    },
    updateLine(token: string, id: number, input: PayrollLineInput): Promise<PayrollLine> {
      return authed<PayrollLine>(`/api/luong/lines/${id}`, token, { method: "PUT", body: JSON.stringify(input) });
    },
    // --- Tầng 3: khoản PHÁT SINH trên một dòng lương (thưởng nóng) ---
    // Khoản gán ở HỒ SƠ được trả LẶP LẠI mọi tháng; khoản ở đây CHỈ có ở kỳ này. Mỗi thao tác
    // backend tính lại NGAY dòng lương đó ⇒ số tổng của dòng đổi sau mỗi lệnh.
    lineComponents(token: string, lineId: number): Promise<{ items: LineComponent[] }> {
      return authed<{ items: LineComponent[] }>(`/api/luong/lines/${lineId}/components`, token);
    },
    /** Bảng đối chiếu khoán km của một dòng lương — từng chuyến giao đã sinh ra tiền.
     *  `tong` PHẢI khớp cột "Khoán km"; lệch là một trong hai bên tính sai. */
    chiTietKhoanKm(token: string, lineId: number): Promise<KhoanKmChiTiet> {
      return authed<KhoanKmChiTiet>(`/api/luong/lines/${lineId}/khoan-km`, token);
    },
    /** Từng lần ghi sản lượng / tăng ca khoán / phần tổ trưởng làm nên tiền khoán của một dòng. */
    chiTietKhoanKy(token: string, lineId: number): Promise<KhoanKyChiTiet> {
      return authed<KhoanKyChiTiet>(`/api/luong/lines/${lineId}/khoan-ky`, token);
    },
    /** Màn Khoán theo tổ: quỹ, chia cho người, sổ sản lượng, dừng máy, tổ khác. Bỏ `toId` ⇒ tổ đầu. */
    khoanTheoTo(token: string, year: number, month: number, toId?: number | null): Promise<KhoanTheoTo> {
      const q = new URLSearchParams({ year: String(year), month: String(month) });
      if (toId) q.set("to_id", String(toId));
      return authed<KhoanTheoTo>(`/api/luong/khoan-theo-to?${q}`, token);
    },
    addLineComponent(token: string, lineId: number, input: LineComponentInput): Promise<LineComponent> {
      return authed<LineComponent>(`/api/luong/lines/${lineId}/components`, token, { method: "POST", body: JSON.stringify(input) });
    },
    /** Chỉ sửa được dòng `source: "line"` — dòng chép từ hồ sơ backend chặn (nói rõ chỗ sửa). */
    updateLineComponent(token: string, rowId: number, patch: LineComponentPatch): Promise<LineComponent> {
      return authed<LineComponent>(`/api/luong/lines/components/${rowId}`, token, { method: "PUT", body: JSON.stringify(patch) });
    },
    deleteLineComponent(token: string, rowId: number): Promise<void> {
      return authed<void>(`/api/luong/lines/components/${rowId}`, token, { method: "DELETE" });
    },
    pitBrackets(token: string): Promise<{ items: PitBracket[] }> {
      return authed<{ items: PitBracket[] }>("/api/luong/pit-brackets", token);
    },
    createPitBracket(token: string, input: PitBracketInput): Promise<PitBracket> {
      return authed<PitBracket>("/api/luong/pit-brackets", token, { method: "POST", body: JSON.stringify(input) });
    },
    updatePitBracket(token: string, id: number, input: PitBracketInput): Promise<PitBracket> {
      return authed<PitBracket>(`/api/luong/pit-brackets/${id}`, token, { method: "PUT", body: JSON.stringify(input) });
    },
    deletePitBracket(token: string, id: number): Promise<void> {
      return authed<void>(`/api/luong/pit-brackets/${id}`, token, { method: "DELETE" });
    },
    // --- Bảng phạt đi trễ / về sớm (toàn công ty) — mirror pit-brackets ---
    latePenaltyBrackets(token: string): Promise<{ items: LatePenaltyBracket[] }> {
      return authed<{ items: LatePenaltyBracket[] }>("/api/luong/late-penalty-brackets", token);
    },
    createLatePenaltyBracket(token: string, input: LatePenaltyBracketInput): Promise<LatePenaltyBracket> {
      return authed<LatePenaltyBracket>("/api/luong/late-penalty-brackets", token, { method: "POST", body: JSON.stringify(input) });
    },
    updateLatePenaltyBracket(token: string, id: number, input: LatePenaltyBracketInput): Promise<LatePenaltyBracket> {
      return authed<LatePenaltyBracket>(`/api/luong/late-penalty-brackets/${id}`, token, { method: "PUT", body: JSON.stringify(input) });
    },
    deleteLatePenaltyBracket(token: string, id: number): Promise<void> {
      return authed<void>(`/api/luong/late-penalty-brackets/${id}`, token, { method: "DELETE" });
    },
    // --- Cấu hình lương: thành phần lương theo bộ phận (Tab 2) ---
    deptComponents(token: string, deptId: number): Promise<DeptComponents> {
      return authed<DeptComponents>(`/api/luong/dept-components/${deptId}`, token);
    },
    setDeptComponents(token: string, deptId: number, items: DeptComponentInput[]): Promise<DeptComponents> {
      return authed<DeptComponents>(`/api/luong/dept-components/${deptId}`, token, { method: "PUT", body: JSON.stringify({ items }) });
    },
    // --- Cấu hình lương: chỉ tiêu ngày của tổ khoán / sản lượng (chưa nối vào tính lương) ---
    chiTieuNgay(token: string, deptId: number): Promise<ChiTieuNgayList> {
      return authed<ChiTieuNgayList>(`/api/luong/khoan/chi-tieu-ngay/${deptId}`, token);
    },
    /** Cùng tổ + CÙNG ngày áp dụng ⇒ sửa số của mốc đó (không đẻ mốc trùng ngày). */
    khaiChiTieuNgay(token: string, deptId: number, input: ChiTieuNgayInput): Promise<ChiTieuNgayList> {
      return authed<ChiTieuNgayList>(`/api/luong/khoan/chi-tieu-ngay/${deptId}`, token, { method: "PUT", body: JSON.stringify(input) });
    },
    xoaChiTieuNgay(token: string, deptId: number, mucId: number): Promise<ChiTieuNgayList> {
      return authed<ChiTieuNgayList>(`/api/luong/khoan/chi-tieu-ngay/${deptId}/${mucId}`, token, { method: "DELETE" });
    },
    // --- Tổ trưởng ăn thưởng / ăn chia theo sản lượng tổ (19/09/2026) — chưa nối vào lương ---
    toTruong(token: string, deptId: number): Promise<ToTruongList> {
      return authed<ToTruongList>(`/api/luong/khoan/to-truong/${deptId}`, token);
    },
    /** Cùng tổ + CÙNG ngày áp dụng ⇒ sửa mốc đó (không đẻ mốc trùng ngày). */
    khaiToTruong(token: string, deptId: number, input: ToTruongInput): Promise<ToTruongList> {
      return authed<ToTruongList>(`/api/luong/khoan/to-truong/${deptId}`, token, { method: "PUT", body: JSON.stringify(input) });
    },
    xoaToTruong(token: string, deptId: number, mucId: number): Promise<ToTruongList> {
      return authed<ToTruongList>(`/api/luong/khoan/to-truong/${deptId}/${mucId}`, token, { method: "DELETE" });
    },
    // --- Danh mục khoản thu nhập (Cấu hình lương, tab "Danh mục khoản thu nhập") ---
    components: {
      /** Cả khoản ĐÃ NGƯNG DÙNG cũng trả — màn cấu hình cần hiện để bật lại được. */
      list(token: string): Promise<{ items: PayrollComponent[] }> {
        return authed<{ items: PayrollComponent[] }>("/api/luong/components", token);
      },
      create(token: string, input: PayrollComponentInput): Promise<PayrollComponent> {
        return authed<PayrollComponent>("/api/luong/components", token, { method: "POST", body: JSON.stringify(input) });
      },
      update(token: string, id: number, patch: PayrollComponentPatch): Promise<PayrollComponent> {
        return authed<PayrollComponent>(`/api/luong/components/${id}`, token, { method: "PUT", body: JSON.stringify(patch) });
      },
      /** Chưa có số liệu ⇒ xoá hẳn. Đã dùng ⇒ chỉ NGỪNG ÁP DỤNG — ĐỌC `message` rồi hiện
       *  NGUYÊN VĂN, đừng tự chế câu báo. */
      remove(token: string, id: number): Promise<PayrollComponentDeleteResult> {
        return authed<PayrollComponentDeleteResult>(`/api/luong/components/${id}`, token, { method: "DELETE" });
      },
      /** NV còn giữ khoản này khi khoản ĐÃ ngừng áp dụng — nuôi cảnh báo "còn N người đang gán". */
      holders(token: string, id: number): Promise<ComponentHolders> {
        return authed<ComponentHolders>(`/api/luong/components/${id}/holders`, token);
      },
      /** Khoản ĐANG GÁN của 1 NV — CHỈ trả khoản có tiền khác 0, không phải cả danh mục.
       *  Muốn dựng dropdown "thêm khoản" thì lấy `components.list` rồi trừ đi tập này. */
      employeeValues(token: string, employeeId: number): Promise<{ items: ComponentValue[] }> {
        return authed<{ items: ComponentValue[] }>(`/api/luong/components/employee/${employeeId}`, token);
      },
      /** `amount: null` ⇒ GỠ khoản khỏi người này. Chỉ nhận `component_id` CÓ SẴN trong danh
       *  mục — không có đường đẻ khoản mới từ hồ sơ nhân viên (quy trình 2 bước). */
      setEmployeeValues(token: string, employeeId: number, items: ComponentValueInput[]): Promise<{ items: ComponentValue[] }> {
        return authed<{ items: ComponentValue[] }>(`/api/luong/components/employee/${employeeId}`, token, { method: "PUT", body: JSON.stringify({ items }) });
      },
      /** Ai đang được gán khoản này + mức bao nhiêu — cho modal gán hàng loạt XEM TRƯỚC ai bị
       *  bỏ qua / ai bị đổi từ bao nhiêu sang bao nhiêu. Khác `holders` (chỉ khoản đã tắt). */
      employeeAmounts(token: string, id: number): Promise<{ component_id: number; items: { employee_id: number; amount: number; note: string | null }[] }> {
        return authed<{ component_id: number; items: { employee_id: number; amount: number; note: string | null }[] }>(`/api/luong/components/${id}/employee-amounts`, token);
      },
      /** Rải MỘT khoản cho NHIỀU người trong một thao tác.
       *
       *  ⚠️ `overwrite` MẶC ĐỊNH FALSE và phải giữ vậy: bật lên là xoá mức riêng đã khai cho
       *  từng người, không có đường hoàn tác. Chỉ gửi `true` khi người dùng CHỦ ĐỘNG tích ô. */
      bulkAssign(token: string, id: number, input: BulkAssignInput): Promise<BulkAssignResult> {
        return authed<BulkAssignResult>(`/api/luong/components/${id}/bulk-assign`, token, { method: "POST", body: JSON.stringify(input) });
      },
      /** GỠ khoản khỏi TẤT CẢ nhân viên đang được gán (trong phạm vi người bấm) — để xoá được khoản
       *  lỡ gán cho cả trăm người (26/09/2026). `remaining` = số người ngoài phạm vi còn giữ. */
      unassignAll(token: string, id: number): Promise<{ removed: number; remaining: number }> {
        return authed<{ removed: number; remaining: number }>(`/api/luong/components/${id}/unassign-all`, token, { method: "POST" });
      },
    },
    /** Phát phiếu lương theo CỬA SỔ. `luc` trống = mở NGAY; `den` trống = mở không thời hạn. */
    congBo(token: string, year: number, month: number, luc?: string | null, den?: string | null): Promise<PayrollPeriod> {
      return authed<PayrollPeriod>("/api/luong/cong-bo", token, { method: "POST", body: JSON.stringify({ year, month, luc: luc ?? null, den: den ?? null }) });
    },
    thuHoi(token: string, year: number, month: number): Promise<PayrollPeriod> {
      return authed<PayrollPeriod>("/api/luong/thu-hoi", token, { method: "POST", body: JSON.stringify({ year, month }) });
    },
    /** Trả một khoản đã đè tay về đúng mức đang khai ở hồ sơ NV. `null` = khoản đã bị gỡ khỏi hồ sơ. */
    boDeComponent(token: string, rowId: number): Promise<LineComponent | null> {
      return authed<LineComponent | null>(`/api/luong/lines/components/${rowId}/bo-de`, token, { method: "POST" });
    },
    lock(token: string, year: number, month: number): Promise<PayrollPeriod> {
      return authed<PayrollPeriod>("/api/luong/lock", token, { method: "POST", body: JSON.stringify({ year, month }) });
    },
    reopen(token: string, year: number, month: number): Promise<PayrollPeriod> {
      return authed<PayrollPeriod>("/api/luong/reopen", token, { method: "POST", body: JSON.stringify({ year, month }) });
    },
    pay(token: string, year: number, month: number, note?: string): Promise<PayrollPeriod> {
      return authed<PayrollPeriod>("/api/luong/pay", token, { method: "POST", body: JSON.stringify({ year, month, note: note ?? null }) });
    },
    unpay(token: string, year: number, month: number, note?: string): Promise<PayrollPeriod> {
      return authed<PayrollPeriod>("/api/luong/unpay", token, { method: "POST", body: JSON.stringify({ year, month, note: note ?? null }) });
    },
    /** Xuất bảng lương / file chuyển khoản .xlsx — fetch as blob (bearer + refresh-aware). */
    async xlsxBlobUrl(token: string, kind: "table" | "bank", year: number, month: number): Promise<string> {
      const path = kind === "bank" ? "bank.xlsx" : "export.xlsx";
      const doFetch = (bearer: string) =>
        fetch(`${BASE_URL}/api/luong/${path}?year=${year}&month=${month}`, {
          credentials: "include", cache: "no-store", headers: authHeader(bearer),
        });
      let resp = await doFetch(token);
      if (resp.status === 401) {
        const fresh = await refreshAccessToken();
        if (fresh) resp = await doFetch(fresh);
      }
      if (!resp.ok) throw new ApiError(`Xuất tệp thất bại (mã ${resp.status}).`, resp.status);
      return URL.createObjectURL(await resp.blob());
    },
    /** File chuyển khoản tạm ứng / lương đợt 1 theo khuôn lô lương BIZ MBBank (25/09/2026).
     *  `ids` = chỉ những phiếu đang tick; bỏ trống = mọi phiếu đã duyệt / đã chi của kỳ. Lỗi thì
     *  ném NGUYÊN câu máy chủ (vd "Chưa có phiếu đã duyệt…") chứ không phải "Export failed (404)". */
    async advancesXlsxBlobUrl(
      token: string,
      year: number,
      month: number,
      ids?: number[],
    ): Promise<string> {
      const q = `year=${year}&month=${month}` + (ids && ids.length ? `&ids=${ids.join(",")}` : "");
      const doFetch = (bearer: string) =>
        fetch(`${BASE_URL}/api/luong/advances/export.xlsx?${q}`, {
          credentials: "include", cache: "no-store", headers: authHeader(bearer),
        });
      let resp = await doFetch(token);
      if (resp.status === 401) {
        const fresh = await refreshAccessToken();
        if (fresh) resp = await doFetch(fresh);
      }
      if (!resp.ok) {
        let msg = `Xuất file lỗi (${resp.status}).`;
        try {
          const body = (await resp.json()) as { detail?: unknown };
          if (typeof body.detail === "string") msg = body.detail;
        } catch {
          /* thân không phải JSON — giữ câu chung */
        }
        throw new ApiError(msg, resp.status);
      }
      return URL.createObjectURL(await resp.blob());
    },
    /** Bỏ trống `ky` ⇒ kỳ mới nhất đang mở (hành vi cũ). Truyền vào ⇒ tra lại tháng đó —
     *  máy chủ vẫn lọc theo cửa sổ công bố nên tháng chưa phát trả về rỗng. */
    myPayslip(token: string, ky?: { year: number; month: number }): Promise<MyPayslip> {
      const q = ky ? `?year=${ky.year}&month=${ky.month}` : "";
      return authed<MyPayslip>(`/api/luong/payslip/me${q}`, token);
    },
  },

  // --- Giao hàng (module `giao_hang`) ---------------------------------------
  // Ba nhóm đường: yêu cầu (Bán hàng) · kế hoạch + chuyến (Giao hàng) · đề nghị xuất (Kho).
  // Đường của kho gác bằng ô `kho`, KHÔNG phải ô `giao_hang` — kho không cần cấp thêm ô nào.
  giaoHang: {
    conPhaiGiao(token: string, orderId: number): Promise<ConPhaiGiao> {
      return authed<ConPhaiGiao>(`/api/giao-hang/orders/${orderId}/con-phai-giao`, token);
    },
    /** `loc`: ô tìm `q`, kỳ (`tu_ngay/den_ngay/moc` ∈ tao, can), `khach` — lọc ở máy chủ. */
    requests(token: string, opts?: { orderId?: number; choLenKeHoach?: boolean; page?: number; size?: number; loc?: ThamSoLoc }): Promise<{ items: DeliveryRequest[]; total: number; dem_han?: Record<string, number> }> {
      const q = new URLSearchParams();
      if (opts?.orderId != null) q.set("order_id", String(opts.orderId));
      if (opts?.choLenKeHoach) q.set("cho_len_ke_hoach", "true");
      if (opts?.page != null) q.set("page", String(opts.page));
      if (opts?.size != null) q.set("size", String(opts.size));
      ganThamSoLoc(q, opts?.loc);
      const s = q.toString();
      return authed<{ items: DeliveryRequest[]; total: number; dem_han?: Record<string, number> }>(`/api/giao-hang/requests${s ? `?${s}` : ""}`, token);
    },
    request(token: string, id: number): Promise<DeliveryRequestDetail> {
      return authed<DeliveryRequestDetail>(`/api/giao-hang/requests/${id}`, token);
    },
    createRequest(token: string, input: DeliveryRequestInput): Promise<DeliveryRequest> {
      return authed<DeliveryRequest>("/api/giao-hang/requests", token, { method: "POST", body: JSON.stringify(input) });
    },
    updateRequest(token: string, id: number, input: Partial<DeliveryRequestInput>): Promise<DeliveryRequest> {
      return authed<DeliveryRequest>(`/api/giao-hang/requests/${id}`, token, { method: "PUT", body: JSON.stringify(input) });
    },
    cancelRequest(token: string, id: number, lyDo: string): Promise<DeliveryRequest> {
      return authed<DeliveryRequest>(`/api/giao-hang/requests/${id}/huy`, token, { method: "POST", body: JSON.stringify({ ly_do: lyDo }) });
    },

    trips(token: string, opts?: { dangChay?: boolean; page?: number; size?: number }): Promise<{ items: DeliveryTrip[]; total: number }> {
      const q = new URLSearchParams();
      if (opts?.dangChay) q.set("dang_chay", "true");
      if (opts?.page != null) q.set("page", String(opts.page));
      if (opts?.size != null) q.set("size", String(opts.size));
      const s = q.toString();
      return authed<{ items: DeliveryTrip[]; total: number }>(`/api/giao-hang/trips${s ? `?${s}` : ""}`, token);
    },
    /** Lên đơn = gửi kho luôn (12/10/2026): `phieu` là mã đề nghị xuất kho vừa gửi kèm. */
    plan(token: string, input: PlanInput): Promise<{ trip: DeliveryTrip; canh_bao: string[]; phieu: string[] }> {
      return authed<{ trip: DeliveryTrip; canh_bao: string[]; phieu: string[] }>("/api/giao-hang/plans", token, { method: "POST", body: JSON.stringify(input) });
    },
    updatePlan(token: string, tripId: number, input: Partial<PlanInput>): Promise<{ trip: DeliveryTrip; canh_bao: string[] }> {
      return authed<{ trip: DeliveryTrip; canh_bao: string[] }>(`/api/giao-hang/plans/${tripId}`, token, { method: "PUT", body: JSON.stringify(input) });
    },
    cancelPlan(token: string, tripId: number, lyDo: string): Promise<DeliveryTrip> {
      return authed<DeliveryTrip>(`/api/giao-hang/plans/${tripId}/huy`, token, { method: "POST", body: JSON.stringify({ ly_do: lyDo }) });
    },
    /** Chuyến ĐẦU của một lượt xe phải kèm số đồng hồ lúc xe rời kho (PRD khoán km §14). Trả về
     *  `canh_bao` (vd "xe chạy ngoài sổ N km") — không chặn, chỉ để người bấm biết. */
    batDauGiao(token: string, tripId: number, input?: { so_dong_ho_xuat_phat?: number; xac_nhan_km_lon?: boolean }): Promise<DeliveryTrip> {
      return authed<DeliveryTrip>(`/api/giao-hang/trips/${tripId}/bat-dau-giao`, token, {
        method: "POST", ...(input ? { body: JSON.stringify(input) } : {}),
      });
    },
    ghiKetQua(token: string, tripId: number, input: KetQuaInput): Promise<DeliveryTrip> {
      return authed<DeliveryTrip>(`/api/giao-hang/trips/${tripId}/ket-qua`, token, { method: "POST", body: JSON.stringify(input) });
    },
    /** Lượt CHƯA về kho của một xe — ô Lượt xe lúc lên đơn giao hàng. */
    luotXeMo(token: string, vehicleId: number): Promise<{ items: LuotXeMo[] }> {
      return authed<{ items: LuotXeMo[] }>(`/api/giao-hang/luot-xe?vehicle_id=${vehicleId}`, token);
    },
    /** Tài xế ghi số đồng hồ lúc xe về tới kho ⇒ đóng lượt, máy tính km chặng về kho. */
    veKho(token: string, luotId: number, input: { so_dong_ho: number }): Promise<VeKhoKetQua> {
      return authed<VeKhoKetQua>(`/api/giao-hang/luot-xe/${luotId}/ve-kho`, token, { method: "POST", body: JSON.stringify(input) });
    },
    /** Tab "Đơn giao hàng" gom theo LƯỢT XE — mỗi lượt MỘT khối (đủ các điểm), chuyến lẻ một khối.
     *  Trang hoá theo KHỐI ở máy chủ nên một lượt không bị cắt đôi qua hai trang. */
    bangGiao(token: string, opts?: { page?: number; size?: number; loc?: ThamSoLoc }): Promise<BangGiaoPage> {
      const q = new URLSearchParams();
      if (opts?.page != null) q.set("page", String(opts.page));
      if (opts?.size != null) q.set("size", String(opts.size));
      ganThamSoLoc(q, opts?.loc);
      const s = q.toString();
      return authed<BangGiaoPage>(`/api/giao-hang/bang-giao${s ? `?${s}` : ""}`, token);
    },
    /** Giá trị ô lọc (kèm số bản ghi trong tầm nhìn) của hai tab Yêu cầu giao / Đơn giao hàng. */
    khachLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/giao-hang/requests/loc-khach", token);
    },
    donLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/giao-hang/requests/loc-don", token);
    },
    xeLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/giao-hang/bang-giao/loc-xe", token);
    },
    taiXeLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/giao-hang/bang-giao/loc-tai-xe", token);
    },
    /** Lên đơn NHIỀU yêu cầu vào MỘT lượt xe bằng một lần bấm (chủ chốt 18/09/2026). Mỗi yêu cầu
     *  vẫn một chuyến, một phiếu xuất kho; một yêu cầu hỏng là cả lô không lưu. */
    lenLuot(token: string, input: LenLuotInput): Promise<LenLuotKetQua> {
      return authed<LenLuotKetQua>("/api/giao-hang/luot-xe", token, { method: "POST", body: JSON.stringify(input) });
    },
    /** Đề nghị xuất kho của các chuyến — bước gửi kho sau Lên đơn, hoặc nút Sửa ở tab Chứng từ. */
    deNghiKho(token: string, tripIds: number[]): Promise<DeNghiKhoGiao[]> {
      const q = new URLSearchParams();
      tripIds.forEach((id) => q.append("trip_ids", String(id)));
      return authed<DeNghiKhoGiao[]>(`/api/giao-hang/de-nghi-kho?${q}`, token);
    },
    /** Hẹn kho: một Cần lúc chung + ghi chú riêng từng đề nghị. Kho lập phiếu rồi thì máy chủ chặn. */
    henKho(token: string, input: HenKhoInput): Promise<DeNghiKhoGiao[]> {
      return authed<DeNghiKhoGiao[]>("/api/giao-hang/de-nghi-kho", token, { method: "PUT", body: JSON.stringify(input) });
    },
    /** Cả lượt nhìn một chỗ — các điểm theo thứ tự chặng + số đếm để biết bày nút cả lượt nào. */
    luotXe(token: string, luotId: number): Promise<LuotXeChiTiet> {
      return authed<LuotXeChiTiet>(`/api/giao-hang/luot-xe/${luotId}`, token);
    },
    /** Xe rời kho với mọi chuyến đã lấy hàng; số đồng hồ xuất phát ghi MỘT lần cho cả lượt. */
    batDauGiaoCaLuot(token: string, luotId: number, input?: { so_dong_ho_xuat_phat?: number; xac_nhan_km_lon?: boolean }): Promise<CaLuotKetQua> {
      return authed<CaLuotKetQua>(`/api/giao-hang/luot-xe/${luotId}/bat-dau-giao`, token, {
        method: "POST", ...(input ? { body: JSON.stringify(input) } : {}),
      });
    },
    daTraHang(token: string, tripId: number): Promise<DeliveryTrip> {
      return authed<DeliveryTrip>(`/api/giao-hang/trips/${tripId}/da-tra-hang`, token, { method: "POST" });
    },

    /** File MINH CHỨNG của chuyến — ảnh/PDF. Hàng đi kèm hoá đơn: trước lúc đi đính hoá đơn cho
     *  tài xế cầm theo, giao xong chụp lại tờ khách đã ký. Đính được ở bất kỳ lúc nào. */
    dinhKemChuyen(token: string, tripId: number): Promise<{ items: DinhKemChuyen[] }> {
      return authed<{ items: DinhKemChuyen[] }>(`/api/giao-hang/trips/${tripId}/dinh-kem`, token);
    },
    themDinhKemChuyen(token: string, tripId: number, file: File): Promise<DinhKemChuyen> {
      const form = new FormData();
      form.append("file", file);
      return authed<DinhKemChuyen>(`/api/giao-hang/trips/${tripId}/dinh-kem`, token, {
        method: "POST", body: form,
      });
    },
    xoaDinhKemChuyen(token: string, tripId: number, attachmentId: number): Promise<void> {
      return authed<void>(`/api/giao-hang/trips/${tripId}/dinh-kem/${attachmentId}`, token, {
        method: "DELETE",
      });
    },

    /** Tài xế CHỌN ĐƯỢC khi phân công — gác bằng ô Lên kế hoạch, KHÔNG phải `nhan_su`. */
    taiXeChon(token: string): Promise<{ items: DeliveryDriverPick[] }> {
      return authed<{ items: DeliveryDriverPick[] }>("/api/giao-hang/tai-xe-chon", token);
    },
    /** % chia tiền một chuyến cho kíp xe. Bảng BẬC cấp phòng đã gỡ 12/09/2026 — mọi xe ăn
     *  theo MỨC; % thì giữ vì nó là luật khác: đơn giá quyết một chuyến bao nhiêu tiền, % quyết
     *  chia cho mấy người. */
    khoanKmPct(token: string, deptId: number): Promise<KhoanKmPct> {
      return authed<KhoanKmPct>(`/api/giao-hang/departments/${deptId}/khoan-km-pct`, token);
    },
    saveKhoanKmPct(token: string, deptId: number, body: KhoanKmPct): Promise<KhoanKmPct> {
      return authed<KhoanKmPct>(`/api/giao-hang/departments/${deptId}/khoan-km-pct`, token,
        { method: "PUT", body: JSON.stringify(body) });
    },
    /** Mọi MỨC khoán km + bảng bậc + số xe đang dùng mức đó. */
    mucKhoanKm(token: string): Promise<{ items: MucKm[] }> {
      return authed<{ items: MucKm[] }>("/api/giao-hang/muc-khoan-km", token);
    },
    taoMucKhoanKm(token: string, body: MucKmInput): Promise<{ items: MucKm[] }> {
      return authed<{ items: MucKm[] }>("/api/giao-hang/muc-khoan-km", token,
        { method: "POST", body: JSON.stringify(body) });
    },
    /** Chỉ gửi ô muốn đổi — ô KHÔNG gửi thì máy chủ giữ nguyên (đổi tên không làm mất ghi chú). */
    suaMucKhoanKm(token: string, id: number, body: Partial<MucKmInput>): Promise<{ items: MucKm[] }> {
      return authed<{ items: MucKm[] }>(`/api/giao-hang/muc-khoan-km/${id}`, token,
        { method: "PUT", body: JSON.stringify(body) });
    },
    /** Máy chủ CHẶN nếu còn xe đang ăn mức — lỗi mang số xe, hiện thẳng cho người dùng. */
    xoaMucKhoanKm(token: string, id: number): Promise<{ items: MucKm[] }> {
      return authed<{ items: MucKm[] }>(`/api/giao-hang/muc-khoan-km/${id}`, token,
        { method: "DELETE" });
    },
    /** Lưu bảng bậc của MỘT mức — cấu hình chung, không theo phòng ban (14/09/2026). Mảng RỖNG
     *  bị máy chủ chặn khi mức còn xe đang ăn. */
    saveKmBracketsMuc(token: string, mucId: number, items: KmBracket[]): Promise<{ items: MucKm[] }> {
      return authed<{ items: MucKm[] }>(`/api/giao-hang/muc-khoan-km/${mucId}/bac`, token,
        { method: "PUT", body: JSON.stringify({ items }) });
    },
    /** `thang` dạng `YYYY-MM` — chỉ đổi hai cột THÁNG. Cột "hôm nay" và trạng thái luôn là
     *  bây giờ, không đổi theo tháng đang xem. */
    nhanVien(token: string, opts?: { ngay?: string; thang?: string }): Promise<{ items: DeliveryDriver[] }> {
      const q = new URLSearchParams();
      if (opts?.ngay) q.set("ngay", opts.ngay);
      if (opts?.thang) q.set("thang", opts.thang);
      const s = q.toString();
      return authed<{ items: DeliveryDriver[] }>(`/api/giao-hang/nhan-vien${s ? `?${s}` : ""}`, token);
    },
  },

  // --- Tính giá thành — chỉ còn bình bài live; tính giá vốn đi qua phiếu (phieuTinhGia) ---
  tinhGia: {
    binhBai(token: string, body: BinhBaiIn): Promise<BinhBaiOut> {
      return authed<BinhBaiOut>("/api/tinh-gia/binh-bai", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    /** Xem-trước LIVE: chạy engine thật trên phiếu CHƯA lưu → result đầy đủ (không ghi DB). */
    preview(token: string, body: PhieuTinhGiaCreate): Promise<TinhGiaPreviewOut> {
      return authed<TinhGiaPreviewOut>("/api/tinh-gia/preview", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  },

  // --- Phiếu tính giá (persisted) — master/detail của "Tính giá" -------------
  phieuTinhGia: {
    list(
      token: string,
      params: { q?: string; status?: string; sort?: string; page?: number; size?: number;
        nguoi?: number | null; loc?: ThamSoLoc } = {},
    ): Promise<PhieuTinhGiaListOut> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.nguoi != null) qs.set("nguoi", String(params.nguoi));
      if (params.status) qs.set("status", params.status);
      if (params.sort) qs.set("sort", params.sort);
      if (params.page) qs.set("page", String(params.page));
      if (params.size) qs.set("size", String(params.size));
      ganThamSoLoc(qs, params.loc);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<PhieuTinhGiaListOut>(`/api/phieu-tinh-gia${suffix}`, token);
    },
    /** Số trên thanh tab — theo cùng ô tìm, người lập, dải kỳ và bộ lọc với bảng. */
    stats(token: string, nguoi?: number | null, loc?: ThamSoLoc): Promise<PhieuTinhGiaStatsOut> {
      const qs = new URLSearchParams();
      if (nguoi != null) qs.set("nguoi", String(nguoi));
      ganThamSoLoc(qs, loc);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<PhieuTinhGiaStatsOut>(`/api/phieu-tinh-gia/stats${suffix}`, token);
    },
    /** Ô "Khách hàng" của bảng lọc — khách đang có phiếu trong tầm nhìn. */
    khachLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/phieu-tinh-gia/khach-loc", token);
    },
    /** Hộp lọc người lập — chỉ người có phiếu TRONG tầm nhìn (phạm vi + nhóm dùng chung). */
    nguoiLap(token: string): Promise<SaleOption[]> {
      return authed<SaleOption[]>("/api/phieu-tinh-gia/nguoi-lap", token);
    },
    get(token: string, id: number): Promise<PhieuTinhGiaOut> {
      return authed<PhieuTinhGiaOut>(`/api/phieu-tinh-gia/${id}`, token);
    },
    /** Chỉ lời nhắc "danh mục đã đổi sau lần tính" — khỏi tải lại cả phiếu để đọc một trường. */
    danhMucDoi(token: string, id: number): Promise<{ danh_muc_doi: PhieuTinhGiaOut["danh_muc_doi"] }> {
      return authed<{ danh_muc_doi: PhieuTinhGiaOut["danh_muc_doi"] }>(
        `/api/phieu-tinh-gia/${id}/danh-muc-doi`, token);
    },
    create(token: string, body: PhieuTinhGiaCreate): Promise<PhieuTinhGiaOut> {
      return authed<PhieuTinhGiaOut>("/api/phieu-tinh-gia", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    update(token: string, id: number, body: PhieuTinhGiaUpdate): Promise<PhieuTinhGiaOut> {
      return authed<PhieuTinhGiaOut>(`/api/phieu-tinh-gia/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
    remove(token: string, id: number): Promise<void> {
      return authed<void>(`/api/phieu-tinh-gia/${id}`, token, { method: "DELETE" });
    },
    /** Khách, điểm giao, người nhận, ghi chú của phiếu (dải đầu màn phiếu). Không tính lại giá;
     *  báo giá NHÁP của phiếu theo ngay. */
    khachHang(token: string, id: number, body: PhieuTinhGiaKhachHangPatch): Promise<PhieuTinhGiaOut> {
      return authed<PhieuTinhGiaOut>(`/api/phieu-tinh-gia/${id}/khach-hang`, token, {
        method: "PATCH", body: JSON.stringify(body),
      });
    },
    /** Nhân bản phiếu: mã mới, người lập là mình, chép nguyên khách + ghi chú + sản phẩm; giá
     *  vốn tính lại theo danh mục hôm nay. Một phiếu chỉ một báo giá — đây là đường báo giá thứ hai. */
    nhanBan(token: string, id: number): Promise<PhieuTinhGiaOut> {
      return authed<PhieuTinhGiaOut>(`/api/phieu-tinh-gia/${id}/nhan-ban`, token, { method: "POST" });
    },
    /** Nhật ký hoạt động THẬT (ai làm gì · khi nào) của phiếu tính giá này. */
    activity(token: string, id: number): Promise<{ items: PtgActivity[] }> {
      return authed<{ items: PtgActivity[] }>(`/api/phieu-tinh-gia/${id}/activity`, token);
    },
    /** Thành phẩm CỦA KHÁCH để chọn tái bản (lọc theo tên hoặc mã, bỏ dấu). */
    timSanPhamTaiBan(token: string, customerId: number, q: string, size = 20): Promise<SanPhamTaiBanGoiY[]> {
      const qs = new URLSearchParams({ customer_id: String(customerId), q, size: String(size) });
      return authed<SanPhamTaiBanGoiY[]>(`/api/phieu-tinh-gia/san-pham-tai-ban?${qs.toString()}`, token);
    },
    /** Mã tái bản + cấu hình từng thành phần để nạp vào phiếu. */
    chiTietSanPhamTaiBan(token: string, customerId: number, id: number): Promise<SanPhamTaiBanChiTiet> {
      const qs = new URLSearchParams({ customer_id: String(customerId) });
      return authed<SanPhamTaiBanChiTiet>(`/api/phieu-tinh-gia/san-pham-tai-ban/${id}?${qs.toString()}`, token);
    },
  },

  // --- Lệnh sản xuất (LSX) — bàn Kế hoạch sản xuất ---------------------------
  giaCongNgoai: {
    /** Ô chọn Nhà gia công — NCC đang hoạt động có tích "Nhận gia công" (spec gia công ngoài §7). */
    nhaGiaCong(token: string): Promise<NhaGiaCong[]> {
      return authed<NhaGiaCong[]>("/api/gia-cong-ngoai/nha-gia-cong", token);
    },
    cuaLenh(token: string, lsxId: number): Promise<GiaCongNgoaiLan[]> {
      return authed<GiaCongNgoaiLan[]>(`/api/gia-cong-ngoai/lenh/${lsxId}`, token);
    },
    /** Lần gia công của bước CHUNG bài ghép — khối ở màn Bài ghép (spec 2026-09-27 §4). */
    cuaBaiGhep(token: string, baiGhepId: number): Promise<GiaCongNgoaiLan[]> {
      return authed<GiaCongNgoaiLan[]>(`/api/gia-cong-ngoai/bai-ghep/${baiGhepId}`, token);
    },
    /** "Đã mang đi" — nhận MỌI bàn giao đang chờ của bước trước. `sl_gui` chỉ khi dải đứng đầu
     *  lệnh (không có bàn giao để nhận). */
    mangDi(token: string, id: number, body: { version: number; sl_gui?: number | null }): Promise<GiaCongNgoaiLan> {
      return authed<GiaCongNgoaiLan>(`/api/gia-cong-ngoai/${id}/mang-di`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    chot(
      token: string,
      id: number,
      body: {
        version: number; sl_cuoi: number; noi_ve: GiaCongNoiVe; dich_cong_viec_id?: number | null;
        /** Giao thẳng: ngày khách nhận (yyyy-mm-dd) — trống = hôm nay. */
        ngay_khach_nhan?: string | null;
      },
    ): Promise<GiaCongNgoaiLan> {
      return authed<GiaCongNgoaiLan>(`/api/gia-cong-ngoai/${id}/chot`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    moLai(token: string, id: number, version: number): Promise<GiaCongNgoaiLan> {
      return authed<GiaCongNgoaiLan>(`/api/gia-cong-ngoai/${id}/mo-lai`, token, {
        method: "POST", body: JSON.stringify({ version }),
      });
    },
    datTronGoi(
      token: string,
      lsxId: number,
      body: { nha_cung_cap_id: number; sl_dat: number; xuong_cap_giay: boolean },
    ): Promise<GiaCongNgoaiLan> {
      return authed<GiaCongNgoaiLan>(`/api/gia-cong-ngoai/lenh/${lsxId}/tron-goi`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    huyTronGoi(token: string, id: number, body: { version: number; ly_do: string }): Promise<GiaCongNgoaiLan> {
      return authed<GiaCongNgoaiLan>(`/api/gia-cong-ngoai/${id}/huy-tron-goi`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    /** Hàng "Gia công chờ chi" đầu màn Phiếu chi (spec §5): lần đã chốt, chưa có phiếu chi. */
    choChi(token: string): Promise<GiaCongChoChi[]> {
      return authed<GiaCongChoChi[]>("/api/accounting/gia-cong-cho-chi", token);
    },
    demChoChi(token: string): Promise<{ so: number }> {
      return authed<{ so: number }>("/api/accounting/gia-cong-cho-chi/dem", token);
    },
    xuatGiay(
      token: string, id: number,
      body: { version: number; kho_rong: number; kho_dai: number; so_to: number },
    ): Promise<GiaCongNgoaiLan> {
      return authed<GiaCongNgoaiLan>(`/api/gia-cong-ngoai/${id}/xuat-giay`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
  },
  lsx: {
    /** Đơn Sale đã "Chuyển xuống sản xuất" mà còn dòng chưa lên lệnh. */
    hangCho(
      token: string,
      params: { page?: number; size?: number; chiDem?: boolean; loc?: ThamSoLoc } = {},
    ): Promise<HangChoOut> {
      const qs = new URLSearchParams();
      if (params.page) qs.set("page", String(params.page));
      if (params.size) qs.set("size", String(params.size));
      // Badge chỉ cần `total` — máy chủ bỏ qua bước dựng trang, `items` về rỗng.
      if (params.chiDem) qs.set("chi_dem", "true");
      // Thanh lọc hàng chờ (06/10/2026): `customer_id`, `tu_ngay`/`den_ngay`/`moc` (tao | chuyen).
      ganThamSoLoc(qs, params.loc);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<HangChoOut>(`/api/lsx/hang-cho${suffix}`, token);
    },
    /** Ô "Khách hàng" của thanh lọc hàng chờ — khách đang có đơn chờ lên lệnh, kèm số đơn. */
    hangChoKhachLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/lsx/hang-cho/khach-loc", token);
    },
    /** Ô "Khách hàng" / "Đơn hàng" của thanh lọc bảng lệnh — trong phạm vi, kèm số lệnh. */
    khachLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/lsx/khach-loc", token);
    },
    donLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/lsx/don-loc", token);
    },
    /** Danh sách lệnh DỰ KIẾN của 1 đơn — dẫn xuất tại chỗ, chưa ghi DB. */
    preview(token: string, orderId: number): Promise<LsxPreviewOut> {
      return authed<LsxPreviewOut>(`/api/lsx/preview/${orderId}`, token);
    },
    /** Xác nhận tạo lệnh cho các dòng đã tick. */
    tao(token: string, orderId: number, orderLineIds: number[]): Promise<LsxListOut> {
      return authed<LsxListOut>(`/api/lsx/tao/${orderId}`, token, {
        method: "POST",
        body: JSON.stringify({ order_line_ids: orderLineIds }),
      });
    },
    list(
      token: string,
      params: {
        order_id?: number; customer_id?: number; trang_thai?: string; q?: string;
        gia_cong?: string; page?: number; size?: number;
        /** Kỳ của thanh lọc: `tu_ngay`/`den_ngay`/`moc` (tao | han_sx | han_giao). */
        loc?: ThamSoLoc;
      } = {},
    ): Promise<LsxListOut> {
      const qs = new URLSearchParams();
      if (params.order_id) qs.set("order_id", String(params.order_id));
      if (params.customer_id) qs.set("customer_id", String(params.customer_id));
      if (params.trang_thai) qs.set("trang_thai", params.trang_thai);
      if (params.q) qs.set("q", params.q);
      if (params.gia_cong) qs.set("gia_cong", params.gia_cong);
      if (params.page) qs.set("page", String(params.page));
      if (params.size) qs.set("size", String(params.size));
      ganThamSoLoc(qs, params.loc);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<LsxListOut>(`/api/lsx${suffix}`, token);
    },
    /** Đơn / khách để đổ vào hai ô lọc của bảng lệnh. KHÔNG truyền `order_id`/`customer_id`:
     *  danh sách chọn phải đứng yên khi đang lọc, không thì chọn xong là hết đường đổi. */
    boLoc(
      token: string,
      params: { trang_thai?: string; q?: string; gia_cong?: string } = {},
    ): Promise<LsxBoLocOut> {
      const qs = new URLSearchParams();
      if (params.trang_thai) qs.set("trang_thai", params.trang_thai);
      if (params.q) qs.set("q", params.q);
      if (params.gia_cong) qs.set("gia_cong", params.gia_cong);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<LsxBoLocOut>(`/api/lsx/bo-loc${suffix}`, token);
    },
    /** Hàng 3 đèn cho ĐÚNG các lệnh đang hiện trên bảng. Gọi RỜI sau `list`: bên trong máy chủ
     *  chạy engine cân đối vật tư + bộ dò vấn đề cho cả bàn xếp lịch. Bảng lệnh phải hiện ngay,
     *  đèn nhảy vào sau. ĐỪNG gọi lại khi chỉ gõ ô tìm — `loadLenhs` chạy lại mỗi 250ms. */
    tongQuan(token: string, ids: number[]): Promise<LsxTongQuanOut> {
      if (!ids.length) return Promise.resolve({ items: [] });
      return authed<LsxTongQuanOut>(`/api/lsx/tong-quan?ids=${ids.join(",")}`, token);
    },
    get(token: string, id: number): Promise<LsxDetail> {
      return authed<LsxDetail>(`/api/lsx/${id}`, token);
    },
    phuThuocOptions(token: string, id: number): Promise<LsxPhuThuocOption[]> {
      return authed<LsxPhuThuocOption[]>(`/api/lsx/${id}/phu-thuoc-options`, token);
    },
    /** Dao chọn được cho lệnh này — server đã lọc theo KHÁCH của lệnh (chiều lọc đắt nhất), và
     *  gác bằng quyền `lenh_san_xuat.read` nên không cần cấp thêm quyền vào danh mục Khuôn.
     *  Lọc tiếp theo LOẠI của từng bước làm ở màn: danh sách đã rút còn vài dòng. */
    khuonChonDuoc(token: string, id: number): Promise<KhuonChonDuoc[]> {
      return authed<KhuonChonDuoc[]>(`/api/lsx/${id}/khuon-chon-duoc`, token);
    },
    /** Nhánh "làm dao mới" — KHÔNG gửi khách: server lấy từ chính lệnh, khỏi lệch. */
    taoKhuonChoLenh(
      token: string, id: number,
      body: { ten: string; loai: string | null },
    ): Promise<KhuonChonDuoc> {
      return authed<KhuonChonDuoc>(`/api/lsx/${id}/khuon-moi`, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    /** Bộ số đang sửa trên drawer thì bước chạy bao nhiêu phút? CHỈ ĐỌC.
     *
     *  Có cửa này vì SL vào phải quy đổi sang ĐƠN VỊ ĐÍCH của máy mà bảng cầu quy đổi chỉ nằm ở
     *  backend. Thiếu nó thì form phải bấm "Lưu công đoạn" mới thấy số đổi (20/08/2026).
     *
     *  Gửi mọi thứ đang sửa: máy · loại bước · số lượt · SỐ GIỜ KẾ HOẠCH (bước tổ, mg `0319`).
     *  `pieceRateId` GỠ 18/09/2026 cùng ô đầu việc của bước. */
    xemTruocBuoc(
      token: string, id: number, stepKey: string,
      dang: { mayId?: number | null; loaiBuoc?: string | null;
              soLuotChay?: number | null; soGioKeHoach?: number | null;
              soLuongVao?: number | null; soLuongRa?: number | null;
              congDoanId?: number | null; donViVao?: string | null } = {},
    ): Promise<LsxXemTruocBuoc> {
      const q = new URLSearchParams({ step_key: stepKey });
      if (dang.mayId != null) q.set("may_id", String(dang.mayId));
      if (dang.loaiBuoc) q.set("loai_buoc", dang.loaiBuoc);
      if (dang.soLuotChay != null) q.set("so_luot_chay", String(dang.soLuotChay));
      if (dang.soGioKeHoach != null) q.set("so_gio_ke_hoach", String(dang.soGioKeHoach));
      // Hai ô số lượng gửi cả khi bằng 0 — ô TRỐNG là 0 thật, không phải "không có ý kiến".
      if (dang.soLuongVao != null) q.set("so_luong_vao", String(dang.soLuongVao));
      if (dang.soLuongRa != null) q.set("so_luong_ra", String(dang.soLuongRa));
      if (dang.congDoanId != null) q.set("cong_doan_id", String(dang.congDoanId));
      if (dang.donViVao) q.set("don_vi_vao", dang.donViVao);
      return authed<LsxXemTruocBuoc>(`/api/lsx/${id}/xem-truoc-buoc?${q}`, token);
    },
    update(token: string, id: number, body: LsxUpdateBody): Promise<LsxDetail> {
      return authed<LsxDetail>(`/api/lsx/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
    /** REPLACE-ALL routing của LỆNH (không đụng phiếu tính giá, không ảnh hưởng lệnh khác).
     *  `lyDo` chỉ gửi khi routing đã lệch bài tính giá — server ghép vào nhật ký (§10). */
    saveRouting(
      token: string, id: number, congDoans: LsxCongDoanBody[], lyDo?: string,
    ): Promise<LsxDetail> {
      return authed<LsxDetail>(`/api/lsx/${id}/routing`, token, {
        method: "PUT",
        body: JSON.stringify({ cong_doans: congDoans, ly_do: lyDo || null }),
      });
    },
    /** Lấy lại số MỚI NHẤT của danh mục Công đoạn cho CẢ lệnh (khoán + định mức vật tư).
     *  Không xoá dòng vật tư nào và không đụng số nhân công đã sắp — xem `dong_bo_danh_muc`. */
    dongBoDanhMuc(token: string, id: number): Promise<LsxDetail> {
      return authed<LsxDetail>(`/api/lsx/${id}/dong-bo-danh-muc`, token, { method: "POST" });
    },
    /** Nút "Cập nhật tiêu chí" của băng "Tiêu chí KCS đã đổi": thẻ việc lấy bộ tiêu chí mới. */
    capNhatTieuChiKcs(token: string, id: number): Promise<LsxDetail> {
      return authed<LsxDetail>(`/api/lsx/${id}/cap-nhat-tieu-chi-kcs`, token, { method: "POST" });
    },
    /** Sửa thông số này thì các số máy tự tính ra bao nhiêu? CHỈ ĐỌC — server chạy đúng đường của
     *  nút Lưu rồi rollback. Có nó để màn lệnh khỏi chép công thức engine sang JS (hai bản công
     *  thức = màn hiện một số, DB lưu số khác). */
    xemTruocQuyCach(token: string, id: number, qc: LsxQuyCachBody): Promise<LsxQuyCachXemTruoc> {
      return authed<LsxQuyCachXemTruoc>(`/api/lsx/${id}/xem-truoc-quy-cach`, token, {
        method: "POST",
        body: JSON.stringify(qc),
      });
    },
    /** Gợi ý SL vào/ra cho cả chuỗi, chạy ngược từ SL thành phẩm. CHỈ ĐỌC — không ghi gì. */
    tinhNguoc(token: string, id: number): Promise<LsxTinhNguocOut> {
      return authed<LsxTinhNguocOut>(`/api/lsx/${id}/tinh-nguoc`, token);
    },
    /** Đổi/chèn công đoạn thì số VÀO–RA + đơn vị cả chuỗi ra bao nhiêu? CHỈ ĐỌC — server chạy
     *  đúng đường Lưu routing rồi rollback (giống đổi máy gọi thời lượng). Có nó để số nhảy ngay,
     *  khỏi bấm Lưu, mà không cần chép công thức chuỗi ngược sang JS. */
    xemTruocRouting(
      token: string, id: number, congDoans: LsxXemTruocRoutingRow[],
    ): Promise<{ cong_doans: LsxXemTruocRoutingBuoc[] }> {
      return authed<{ cong_doans: LsxXemTruocRoutingBuoc[] }>(
        `/api/lsx/${id}/xem-truoc-routing`, token, {
          method: "POST",
          body: JSON.stringify({ cong_doans: congDoans }),
        });
    },
    /** Dữ liệu trung tính khi ĐỔI công đoạn (tổ phụ trách · đơn vị · chuẩn bị).
     *  Loại bước và tài nguyên là quyết định riêng của KHSX. */
    macDinhBuoc(token: string, id: number, congDoanId: number): Promise<LsxBuocMacDinh> {
      return authed<LsxBuocMacDinh>(`/api/lsx/${id}/mac-dinh-buoc/${congDoanId}`, token);
    },
    setTrangThai(token: string, id: number, trangThai: LsxTrangThai): Promise<LsxDetail> {
      return authed<LsxDetail>(`/api/lsx/${id}/trang-thai`, token, {
        method: "POST",
        body: JSON.stringify({ trang_thai: trangThai }),
      });
    },
    remove(token: string, id: number): Promise<void> {
      return authed<void>(`/api/lsx/${id}`, token, { method: "DELETE" });
    },
    activity(token: string, id: number): Promise<{ items: LsxActivity[] }> {
      return authed<{ items: LsxActivity[] }>(`/api/lsx/${id}/activity`, token);
    },
    // --- Tệp đính kèm của lệnh: mỗi tệp một request để tệp lỗi không kéo cả mẻ lỗi theo ---
    dinhKem(token: string, id: number): Promise<{ items: LsxDinhKem[] }> {
      return authed<{ items: LsxDinhKem[] }>(`/api/lsx/${id}/dinh-kem`, token);
    },
    taiDinhKem(token: string, id: number, file: File): Promise<LsxDinhKem> {
      const form = new FormData();
      form.append("file", file);
      return authed<LsxDinhKem>(`/api/lsx/${id}/dinh-kem`, token, { method: "POST", body: form });
    },
    xoaDinhKem(token: string, id: number, dinhKemId: number): Promise<void> {
      return authed<void>(`/api/lsx/${id}/dinh-kem/${dinhKemId}`, token, { method: "DELETE" });
    },
  },

  // --- Bài ghép 2 — cùng tài nguyên/engine, API và quyền độc lập trong giai đoạn nghiệm thu. ---
  baiGhep2: {
    nguoiPhuTrachOptions(token: string): Promise<{ items: BaiGhep2NguoiPhuTrachOption[] }> {
      return authed<{ items: BaiGhep2NguoiPhuTrachOption[] }>("/api/bai-ghep-2/nguoi-phu-trach-options", token);
    },
    hangCho(token: string, params: { q?: string } = {}): Promise<HangChoGhepOut> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<HangChoGhepOut>(`/api/bai-ghep-2/hang-cho${suffix}`, token);
    },
    list(token: string): Promise<BaiGhep2ListOut> {
      return authed<BaiGhep2ListOut>("/api/bai-ghep-2", token);
    },
    get(token: string, id: number): Promise<BaiGhep2Detail> {
      return authed<BaiGhep2Detail>(`/api/bai-ghep-2/${id}`, token);
    },
    tao(token: string, lsxIds: number[]): Promise<BaiGhep2Detail> {
      return authed<BaiGhep2Detail>("/api/bai-ghep-2", token, {
        method: "POST", body: JSON.stringify({ lsx_ids: lsxIds }),
      });
    },
    update(token: string, id: number, body: BaiGhep2UpdateBody): Promise<BaiGhep2Detail> {
      return authed<BaiGhep2Detail>(`/api/bai-ghep-2/${id}`, token, {
        method: "PUT", body: JSON.stringify(body),
      });
    },
    themThanhVien(token: string, id: number, lsxIds: number[]): Promise<BaiGhep2Detail> {
      return authed<BaiGhep2Detail>(`/api/bai-ghep-2/${id}/thanh-vien`, token, {
        method: "POST", body: JSON.stringify({ lsx_ids: lsxIds }),
      });
    },
    suaThanhVien(token: string, id: number, tvId: number, soConTrenTo: number): Promise<BaiGhep2Detail> {
      return authed<BaiGhep2Detail>(`/api/bai-ghep-2/${id}/thanh-vien/${tvId}`, token, {
        method: "PUT", body: JSON.stringify({ so_con_tren_to: soConTrenTo }),
      });
    },
    boThanhVien(token: string, id: number, tvId: number): Promise<BaiGhep2Detail> {
      return authed<BaiGhep2Detail>(`/api/bai-ghep-2/${id}/thanh-vien/${tvId}`, token, { method: "DELETE" });
    },
    soDo(token: string, id: number): Promise<BaiGhepSoDo> {
      return authed<BaiGhepSoDo>(`/api/bai-ghep-2/${id}/so-do`, token);
    },
    gop(token: string, id: number, stepKeys: string[]): Promise<BaiGhep2Detail> {
      return authed<BaiGhep2Detail>(`/api/bai-ghep-2/${id}/gop`, token, {
        method: "POST", body: JSON.stringify({ step_keys: stepKeys }),
      });
    },
    tach(token: string, id: number, gangStepKey: string): Promise<BaiGhep2Detail> {
      return authed<BaiGhep2Detail>(
        `/api/bai-ghep-2/${id}/gop/${encodeURIComponent(gangStepKey)}`, token, { method: "DELETE" },
      );
    },
    luuBuocChung(
      token: string, id: number, gangStepKey: string, body: BaiGhepBuocChungBody,
    ): Promise<BaiGhep2Detail> {
      return authed<BaiGhep2Detail>(
        `/api/bai-ghep-2/${id}/gop/${encodeURIComponent(gangStepKey)}`, token,
        { method: "PUT", body: JSON.stringify(body) },
      );
    },
    ungVienGop(token: string, id: number, stepKeys: string[]): Promise<BaiGhepUngVienGop> {
      return authed<BaiGhepUngVienGop>(`/api/bai-ghep-2/${id}/ung-vien-gop`, token, {
        method: "POST", body: JSON.stringify({ step_keys: stepKeys }),
      });
    },
    vatTuHieuLuc(token: string, id: number): Promise<BaiGhep2VatTuHieuLuc> {
      return authed<BaiGhep2VatTuHieuLuc>(`/api/bai-ghep-2/${id}/vat-tu-hieu-luc`, token);
    },
    setTrangThai(token: string, id: number, trangThai: BaiGhepTrangThai): Promise<BaiGhep2Detail> {
      return authed<BaiGhep2Detail>(`/api/bai-ghep-2/${id}/trang-thai`, token, {
        method: "POST", body: JSON.stringify({ trang_thai: trangThai }),
      });
    },
    remove(token: string, id: number): Promise<{ ok: boolean }> {
      return authed<{ ok: boolean }>(`/api/bai-ghep-2/${id}`, token, { method: "DELETE" });
    },
    activity(token: string, id: number): Promise<{ items: BaiGhep2Activity[] }> {
      return authed<{ items: BaiGhep2Activity[] }>(`/api/bai-ghep-2/${id}/activity`, token);
    },
  },

  // --- Kế hoạch vật tư — bảng cân đối "cần · có · thiếu · bao giờ phải đặt" ---
  keHoachVatTu: {
    canDoi(
      token: string,
      params: {
        q?: string;
        chi_thieu?: boolean;
        /** Tab của cách nhìn theo mặt hàng — lọc Ở MÁY CHỦ (06/10/2026). */
        tinh_trang?: "thieu" | "khong_ro" | "du";
        hang_loai?: "giay" | "vat_tu";
      } = {},
    ): Promise<CanDoiOut> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.chi_thieu) qs.set("chi_thieu", "true");
      if (params.tinh_trang) qs.set("tinh_trang", params.tinh_trang);
      if (params.hang_loai) qs.set("hang_loai", params.hang_loai);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<CanDoiOut>(`/api/ke-hoach-vat-tu/can-doi${suffix}`, token);
    },
    /** Gộp các dòng đã tick thành MỘT yêu cầu mua bộ phận. Server tự tính lại phần thiếu —
     *  client CỐ Ý không gửi số lượng (bản chụp trên màn có thể đã cũ). */
    deNghiMua(
      token: string,
      dong: CanDoiKhoaDong[],
      ghiChu?: string | null,
      neededDate?: string | null,
    ): Promise<{ id: number; code: string }> {
      return authed<{ id: number; code: string }>("/api/ke-hoach-vat-tu/de-nghi-mua", token, {
        method: "POST",
        body: JSON.stringify({ dong, ghi_chu: ghiChu ?? null, needed_date: neededDate ?? null }),
      });
    },
    /** Tính trước yêu cầu mua từ các dòng đã tick — KHÔNG ghi gì. Trả đúng bộ dữ liệu để đổ vào
     *  form "Tạo yêu cầu mua hàng"; yêu cầu chỉ thật sự sinh ra khi người dùng bấm Lưu ở form đó. */
    xemTruocDeNghiMua(
      token: string,
      dong: CanDoiKhoaDong[],
      ghiChu?: string | null,
    ): Promise<DeNghiMuaXemTruoc> {
      return authed<DeNghiMuaXemTruoc>("/api/ke-hoach-vat-tu/de-nghi-mua/xem-truoc", token, {
        method: "POST",
        body: JSON.stringify({ dong, ghi_chu: ghiChu ?? null }),
      });
    },
    /** Lưới: mỗi dòng một ô (lệnh × mặt hàng), cắt trang theo NHÓM ở máy chủ. */
    luoi(token: string, p: LuoiThamSo): Promise<LuoiOut> {
      return authed<LuoiOut>(`/api/ke-hoach-vat-tu/luoi${qs({ ...p })}`, token);
    },
    luoiLenh(token: string, chu: { lsx_id: number | null; bai_ghep_id: number | null }): Promise<{ lenh: LuoiLenh; dong: LuoiDong[] }> {
      return authed(`/api/ke-hoach-vat-tu/luoi/lenh${qs({ lsx_id: chu.lsx_id, bai_ghep_id: chu.bai_ghep_id })}`, token);
    },
    luoiHang(
      token: string,
      /** `don_vi_goc` là phần thứ năm của khoá giấy / vật tư khác (10/10/2026): cùng khổ một bên
       *  đếm tờ một bên đếm kg là hai mặt hàng. Hàng khác gửi "". */
      h: { hang_loai: HangLoai; hang_id: number; kho_rong: number; kho_dai: number; don_vi_goc?: string },
    ): Promise<{ hang: LuoiHang; dong: LuoiDong[] }> {
      return authed(`/api/ke-hoach-vat-tu/luoi/hang${qs({ ...h })}`, token);
    },
    xuatLuoiBlobUrl(token: string, p: Omit<LuoiThamSo, "page" | "size">): Promise<string> {
      return blobUrl(`/api/ke-hoach-vat-tu/luoi/xuat.xlsx${qs({ ...p })}`, token);
    },
    /** CÙNG bảng cân đối, xoay theo LỆNH — "lệnh này chạy được chưa" thay vì "còn thiếu gì". */
    theoLenh(
      token: string,
      params: {
        q?: string;
        chi_can_lo?: boolean;
        chi_giu_lau?: boolean;
        /** Tab giữ chỗ — lọc Ở MÁY CHỦ (06/10/2026). */
        giu?: "du" | "dang" | "tat" | "giu_lau";
      } = {},
    ): Promise<TheoLenhOut> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.chi_can_lo) qs.set("chi_can_lo", "true");
      if (params.chi_giu_lau) qs.set("chi_giu_lau", "true");
      if (params.giu) qs.set("giu", params.giu);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<TheoLenhOut>(`/api/ke-hoach-vat-tu/theo-lenh${suffix}`, token);
    },
    /** Bật/tắt giữ chỗ. Trả về THẺ ĐÃ CẬP NHẬT của chính chủ thể đó — màn chỉ việc thay tại chỗ,
     *  khỏi gọi lại cả danh sách (giữa hai lời gọi người dùng sẽ nhìn thấy một thẻ nói dối). */
    giuCho(
      token: string,
      bat: boolean,
      chu: { lsx_id?: number | null; bai_ghep_id?: number | null },
    ): Promise<TheoLenhRow> {
      return authed<TheoLenhRow>(
        `/api/ke-hoach-vat-tu/giu-cho/${bat ? "bat" : "tat"}`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            lsx_id: chu.lsx_id ?? null,
            bai_ghep_id: chu.bai_ghep_id ?? null,
          }),
        },
      );
    },
    /** Bật giữ chỗ cho NHIỀU lệnh/bài một lượt — máy chủ nhặt theo hạn sản xuất, không theo thứ
     *  tự tick. Không có bản tắt-nhiều: nhả không hoàn tác được, hỏi từng lệnh. */
    giuChoNhieu(
      token: string,
      chu: { lsx_id: number | null; bai_ghep_id: number | null }[],
    ): Promise<{ items: { lsx_id: number | null; bai_ghep_id: number | null; du: boolean }[] }> {
      return authed(`/api/ke-hoach-vat-tu/giu-cho/bat-nhieu`, token, {
        method: "POST",
        body: JSON.stringify({ chu_the: chu }),
      });
    },
  },

  // --- Hồ sơ lệnh sản xuất (module `lenh_san_xuat`) — bàn TRA CỨU, không ghi -
  // Ba đường ĐỌC, không một đường ghi nào — và đừng thêm: màn này cố ý không có nút ghi (tạo/sửa
  // lệnh vẫn ở Kế hoạch sản xuất, module `san_xuat`). Phạm vi dữ liệu do MÁY CHỦ gắn từ token;
  // không có tham số nào cho client tự nới, gửi thêm cũng bị bỏ qua.
  lenhSanXuat: {
    /** Nguồn ô Khách — khách của chính các lệnh trong phạm vi người gọi.
     *
     *  KHÔNG mượn `/api/khach-hang` hay `/api/theo-doi-san-xuat/bo-loc`: hai đường đó gác ô quyền
     *  khác, vai QC đứng ở màn này không có ⇒ 403. */
    boLoc(token: string): Promise<LenhSxBoLocOut> {
      return authed<LenhSxBoLocOut>("/api/lenh-san-xuat/bo-loc", token);
    },
    /** MỘT trang bảng. Lọc + đếm tab + cắt trang đều Ở MÁY CHỦ — không `rows.filter`, không
     *  `rows.slice`, không đếm tab từ `items`. */
    danhSach(token: string, params: LenhSxDanhSachParams = {}): Promise<LenhSxListOut> {
      return authed<LenhSxListOut>(
        `/api/lenh-san-xuat${qs({
          tab: params.tab,
          q: params.q,
          khach_hang_id: params.khach_hang_id,
          order_id: params.order_id,
          phu_trach_id: params.phu_trach_id,
          gia_cong: params.gia_cong,
          tu_ngay: params.tu_ngay,
          den_ngay: params.den_ngay,
          moc: params.moc,
          page: params.page,
          page_size: params.page_size,
        })}`,
        token,
      );
    },
    /** Ô "Khách hàng" / "Đơn hàng" của thanh lọc — trong phạm vi người gọi, kèm số lệnh. */
    khachLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/lenh-san-xuat/khach-loc", token);
    },
    donLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/lenh-san-xuat/don-loc", token);
    },
    phuTrachLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/lenh-san-xuat/phu-trach-loc", token);
    },
    /** Ngăn hồ sơ GỌN một lệnh — cùng cửa 404/403 với `hoSo`. */
    ngan(token: string, lsxId: number): Promise<LenhSxNganOut> {
      return authed<LenhSxNganOut>(`/api/lenh-san-xuat/${lsxId}/ngan`, token);
    },
    /** HỒ SƠ một lệnh — 13 khối trong MỘT lượt gọi (`LenhSxHoSoOut`).
     *
     *  404 = màn này không có lệnh nào như thế (không tồn tại, hoặc chưa phát hành);
     *  403 = lệnh CÓ thật nhưng ngoài phạm vi người gọi. Hai mã vì hai câu khác nhau — mặt đọc
     *  phải nói đúng câu tương ứng, đừng gộp thành một lời "không xem được". */
    hoSo(token: string, lsxId: number): Promise<LenhSxHoSoOut> {
      return authed<LenhSxHoSoOut>(`/api/lenh-san-xuat/${lsxId}`, token);
    },

    /** PHIẾU CÔNG NGHỆ A4 — tờ giấy tổ mang xuống xưởng. Trả blob URL vì endpoint đòi Bearer:
     *  `window.open` thẳng vào đường dẫn là mở một tab KHÔNG có token và ăn 401.
     *
     *  N28 (ruling C109): dùng `blobUrlComTen` thay `blobUrl` trần — đọc kỹ docstring của nó TRƯỚC
     *  KHI tưởng chỗ này đã "sửa xong" tên file lúc Lưu. Vẫn `window.open`, KHÔNG đổi sang
     *  `<a download>`: nút này phục vụ "mở lên bấm in", đổi thành tải-về là hỏng đúng việc nút sinh
     *  ra để làm. Hệ quả: N28 **CHƯA đóng** trên đường này — Chromium vẫn gợi ý tên uuid lúc Lưu
     *  trong trình xem PDF built-in, y như trước khi có `blobUrlComTen`. Tên dự phòng ở đây chỉ có
     *  tác dụng cho những đường TIÊU THỤ blob khác qua `<a download>` sau này (nếu có).
     *
     *  Tải phiếu KHÔNG làm tăng `phien_ban` — đây là đọc, không phải phát hành lại. */
    phieuCongNghePdf(token: string, lsxId: number): Promise<string> {
      return blobUrlComTen(
        `/api/lenh-san-xuat/${lsxId}/phieu-cong-nghe.pdf`,
        token,
        `phieu-cong-nghe-${lsxId}.pdf`,
      );
    },
  },

  // --- Theo dõi sản xuất (module `theo_doi_san_xuat`) — THEO ĐƠN, chỉ đọc ------------------------
  // Phạm vi do MÁY CHỦ gắn từ token theo luật Đơn hàng bán — không tham số nào cho client tự nới.
  theoDoiSanXuat: {
    /** MỘT trang danh sách đơn. Lọc + đếm chip + cắt trang đều Ở MÁY CHỦ. */
    theoDon(token: string, params: TdsxTheoDonParams = {}): Promise<TdsxTheoDonOut> {
      return authed<TdsxTheoDonOut>(
        `/api/theo-doi-san-xuat/theo-don${qs({
          q: params.q,
          khach_hang_id: params.khach_hang_id,
          phu_trach_id: params.phu_trach_id,
          chip: params.chip,
          tu_ngay: params.tu_ngay,
          den_ngay: params.den_ngay,
          moc: params.moc,
          page: params.page,
          page_size: params.page_size,
        })}`,
        token,
      );
    },
    /** Ngăn một đơn: tóm tắt + bảng mặt hàng kèm routing từng lệnh. 404 / 403 như Hồ sơ lệnh. */
    chiTietDon(token: string, orderId: number): Promise<TdsxDonChiTiet> {
      return authed<TdsxDonChiTiet>(`/api/theo-doi-san-xuat/theo-don/${orderId}`, token);
    },
    /** Ô "Khách hàng" / "Phụ trách" của thanh lọc — trong phạm vi người gọi, kèm số đơn. */
    khachLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/theo-doi-san-xuat/khach-loc", token);
    },
    phuTrachLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/theo-doi-san-xuat/phu-trach-loc", token);
    },
  },


  // --- Xếp lịch (module `xep_lich`) — bàn cấp LỆNH SẢN XUẤT ------------------
  // Ít đường hơn màn 2 đúng một bậc: KHÔNG có "đưa vào nháp", KHÔNG có `xem-truoc` (xem trước
  // chính là thanh trên lưới), KHÔNG có `kiem-phat-hanh` (màn này không chặn gì hết).
  xepLich: {
    /** Thẻ chờ xếp, lọc + cắt trang Ở MÁY CHỦ. `tong` là SAU lọc, không phải số dòng trả về. */
    hangCho(
      token: string,
      params: { tim?: string; trang?: number; moi_trang?: number } & ThamSoLoc = {},
    ): Promise<XlHangCho> {
      const { tim, trang, moi_trang, ...loc } = params;
      const suffix = qs({
        ...(loc as Record<string, string | number | undefined>),
        tim: typeof tim === "string" ? tim.trim() || undefined : undefined,
        trang: (trang as number | undefined) ?? undefined,
        moi_trang: (moi_trang as number | undefined) ?? undefined,
      });
      return authed<XlHangCho>(`/api/xep-lich/hang-cho${suffix}`, token);
    },
    /** Ô "Khách hàng" của thanh lọc hàng chờ — khách đang có lệnh chờ xếp, kèm số lệnh. */
    hangChoKhachLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/xep-lich/hang-cho/khach-loc", token);
    },
    /** Lệnh CHẠM cửa sổ [tu, den] (YYYY-MM-DD). Hai mốc BẮT BUỘC — không có đường trải cả lịch sử. */
    lich(token: string, params: { tu: string; den: string } & XlLocLich): Promise<XlLien> {
      return authed<XlLien>(`/api/xep-lich/lich${qs({
        tu: params.tu, den: params.den,
        tim: params.tim?.trim() || undefined,
        trang_thai: params.trang_thai?.length ? params.trang_thai.join(",") : undefined,
        khach_id: params.khach_id, gap: params.gap, nhanh: params.nhanh,
      })}`, token);
    },
    /** Xem trước lúc kéo: thả ở `batDau` thì bắt đầu / xong lúc nào. Không ghi gì. */
    thuMoc(token: string, lsxId: number, batDau: string, signal?: AbortSignal) {
      return authed<{ bat_dau: string; ket_thuc: string; da_doi: boolean; cho_phut: number }>(
        `/api/xep-lich/lenh/${lsxId}/thu${qs({ bat_dau: batDau })}`, token, { signal });
    },
    /** Panel dưới: thông tin thật của một lệnh + bảng công đoạn. Lệnh chưa xếp vẫn mở được. */
    chiTiet(token: string, lsxId: number): Promise<XlChiTiet> {
      return authed<XlChiTiet>(`/api/xep-lich/lenh/${lsxId}`, token);
    },
    vatTu(token: string, lsxIds: number[]) {
      return authed<XlVatTu[]>(`/api/xep-lich/vat-tu${qs({ lsx_ids: lsxIds.join(",") })}`, token);
    },
    /** So HAI phiên bản lịch đã phát hành, từng bước một. Dữ liệu chỉ có từ 10/09/2026 — phiên
     *  bản cũ hơn đọc ra dòng sống nên bảng sẽ nói "không đổi"; đó là đúng theo dữ liệu còn lại,
     *  không dựng lại được. */
    soSanhPhienBan(token: string, lsxId: number, a: number, b: number): Promise<XlSoSanh> {
      return authed<XlSoSanh>(`/api/xep-lich/lenh/${lsxId}/so-sanh${qs({ a, b })}`, token);
    },
    /** Đặt / dời giờ bắt đầu. `expectedUpdatedAt` là chốt chống ghi đè — bỏ trống khi đặt LẦN ĐẦU
     *  (kéo từ hàng chờ), có thì lệch một giây cũng ném ApiError 409 "người khác vừa dời".
     *  Mốc rơi ngoài giờ chạy KHÔNG bị chặn: server trượt vào đầu khoảng chạy gần nhất rồi trả
     *  `da_doi=true` + `thong_bao` — băng thông báo lấy từ đó, đừng tự đoán lại. */
    datMoc(
      token: string,
      lsxId: number,
      batDauAt: string,
      expectedUpdatedAt?: string | null,
    ): Promise<XlDong> {
      return authed<XlDong>(`/api/xep-lich/lenh/${lsxId}`, token, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bat_dau_at: batDauAt, expected_updated_at: expectedUpdatedAt ?? null }),
      });
    },
    /** Bỏ lịch — thẻ quay lại hàng chờ. Không đụng trạng thái lệnh. */
    xoaMoc(token: string, lsxId: number): Promise<{ ok: boolean }> {
      return authed<{ ok: boolean }>(`/api/xep-lich/lenh/${lsxId}`, token, { method: "DELETE" });
    },
    /** Phát hành xuống xưởng — BẤM LÀ ĐI, không hộp thoại xác nhận, không cửa gác. */
    phatHanh(token: string, lsxId: number): Promise<{ ok: boolean; vat_tu?: XlVatTuTuLap }> {
      return authed<{ ok: boolean; vat_tu?: XlVatTuTuLap }>(`/api/xep-lich/phat-hanh/${lsxId}`, token, {
        method: "POST",
      });
    },
    /** Thu hồi phát hành. BẮT gõ lý do (≥3 ký tự) — thiếu thì 400, đã có việc chạy thì 409. */
    /** Thu hồi CẢ CỤM đã phát hành chung một gói; `cum_lsx` = mọi lệnh vừa lùi. */
    thuHoi(token: string, lsxId: number, lyDo: string): Promise<{ ok: boolean; cum_lsx: number[] }> {
      return authed<{ ok: boolean; cum_lsx: number[] }>(
        `/api/xep-lich/phat-hanh/${lsxId}${qs({ ly_do: lyDo })}`, token, { method: "DELETE" },
      );
    },
    /** Gói đã thả xuống xưởng còn thu hồi được không (`cho_phep_thu_hoi`), hay chỉ còn đường cập
     *  nhật (`cho_phep_cap_nhat`). Hỏi TRƯỚC khi bày nút — không thì người dùng gõ lý do xong mới
     *  ăn 409. `co_goi=false` ⇒ lệnh chưa phát hành. */
    goiPhatHanh(token: string, lsxId: number): Promise<XlGoiPhatHanh> {
      return authed<XlGoiPhatHanh>(`/api/xep-lich/phat-hanh/${lsxId}/goi`, token);
    },
    /** Đẩy lịch mới xuống xưởng cho phần CHƯA bắt đầu, giữ nguyên việc đã chạy. BẮT gõ lý do
     *  (≥3 ký tự). `so_lech_phan_doan > 0` ⇒ có việc KHÔNG được cập nhật vì lần chạy đã tách/gộp
     *  lại — phải nói ra, đừng nuốt. */
    phatHanhCapNhat(token: string, lsxId: number, lyDo: string): Promise<XlCapNhatOut> {
      return authed<XlCapNhatOut>(`/api/xep-lich/phat-hanh-cap-nhat/${lsxId}`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ly_do: lyDo }),
      });
    },
    /** Máy còn dùng cho hộp Khoá máy — gác bằng quyền Xếp lịch. */
    mayGon(token: string): Promise<XlMayGon[]> {
      return authed<XlMayGon[]>("/api/xep-lich/may", token);
    },
    vungKhoa(token: string, mayId: number): Promise<XlVungKhoa[]> {
      return authed<XlVungKhoa[]>(`/api/xep-lich/may/${mayId}/vung-khoa`, token);
    },
    /** `tu`/`den` là giờ tường `YYYY-MM-DDTHH:mm` — đừng `toISOString()`, nó dịch sang UTC. */
    taoVungKhoa(token: string, mayId: number,
      body: { tu: string; den: string; ly_do: string; note: string | null }): Promise<XlVungKhoa> {
      return authed<XlVungKhoa>(`/api/xep-lich/may/${mayId}/vung-khoa`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    xoaVungKhoa(token: string, id: number): Promise<{ ok: boolean }> {
      return authed<{ ok: boolean }>(`/api/xep-lich/vung-khoa/${id}`, token, { method: "DELETE" });
    },
  },

  // --- Thực hiện sản xuất (module `san_xuat`) — bàn của TỔ -------------------
  // Mặt ĐỌC (teams/workItems/chiTiet/nhanVienChon) + mặt GHI (phanCong/rut/batDau/tamDung/ketThuc).
  // Ghi trả `SxLenhKetQua` (version lạc quan). Lỗi: 400 = lệch version/ràng buộc → refetch + toast;
  // 403 = ngoài phạm vi tổ. `teams` một cú gọi ra cả list lẫn badge (`so_viec_cho`).
  sanXuat: {
    /** Danh sách tổ user thấy + badge số việc chờ (navbar + màn). */
    teams(token: string): Promise<SxTeamsOut> {
      return authed<SxTeamsOut>("/api/san-xuat/teams", token);
    },
    /** Nhân viên chọn được cho ô "Giao người" của MỘT tổ (gác `san_xuat:read`, KHÔNG dùng api.employees). */
    nhanVienChon(token: string, teamId: number): Promise<SxNhanVienChonListOut> {
      return authed<SxNhanVienChonListOut>(`/api/san-xuat/teams/${teamId}/nhan-vien`, token);
    },
    /** Thợ tổ khác — nguồn ô "Thêm người tổ khác" của hộp Ghi sản lượng / Sửa số. */
    hoTroUngVien(token: string, teamId: number): Promise<SxHoTroUngVienListOut> {
      return authed<SxHoTroUngVienListOut>(`/api/san-xuat/teams/${teamId}/ho-tro-ung-vien`, token);
    },
    /** Việc chờ tổ bấm: bàn giao đến + lỗi KCS chưa xem. 403 nếu
     *  ngoài phạm vi. */
    choXacNhan(token: string, teamId: number): Promise<SxChoXacNhan> {
      return authed<SxChoXacNhan>(`/api/san-xuat/teams/${teamId}/cho-xac-nhan`, token);
    },
    /** Ngày tổ đã báo dừng máy trong tháng + người của tổ + phiếu sửa trong tháng của máy tổ + kỳ đã chốt. */
    dungMayDs(token: string, teamId: number, nam: number, thang: number): Promise<SxDungMayListOut> {
      return authed<SxDungMayListOut>(`/api/san-xuat/teams/${teamId}/dung-may?nam=${nam}&thang=${thang}`, token);
    },
    baoDungMay(token: string, teamId: number, body: SxDungMayIn): Promise<SxDungMay> {
      return authed<SxDungMay>(`/api/san-xuat/teams/${teamId}/dung-may`, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    suaDungMay(token: string, id: number, body: SxDungMaySuaIn): Promise<SxDungMay> {
      return authed<SxDungMay>(`/api/san-xuat/dung-may/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
    xoaDungMay(token: string, id: number): Promise<void> {
      return authed<void>(`/api/san-xuat/dung-may/${id}`, token, { method: "DELETE" });
    },
    /** Việc đã phát hành của MỘT tổ. 403 nếu tổ ngoài phạm vi.
     *
     *  `nhom="lenh"` (mặc định của BE) trả ĐẦU MỤC LỆNH/BÀI GHÉP kèm phân trang ĐẾM THEO LỆNH —
     *  dùng cho view Thẻ và Danh sách. `nhom="phang"` giữ mảng bước phẳng cho Gantt, kèm cửa sổ
     *  `tuNgay`/`denNgay` để chỉ kéo đúng khoảng đang xem. `choXacNhan` = chỉ lệnh có công đoạn
     *  đang chờ tổ bấm (lọc trước khi cắt trang). */
    workItems(token: string, p: {
      teamId: number;
      nhom?: "lenh" | "phang";
      tim?: string;
      trang?: number;
      coTrang?: number;
      tuNgay?: string;
      denNgay?: string;
      choXacNhan?: boolean;
      /** Thanh lọc view Bảng (06/10/2026) — `trang_thai` (mảng, lặp tham số), kỳ
       *  `tu_ngay`/`den_ngay`/`moc` (nhan · tao · du_kien). Máy chủ lọc TRƯỚC khi cắt trang.
       *  09/10: thêm `cho_loai`, `vuong`, `nguoi` (mảng) và `toi` (một giá trị).
       *  10/10: thêm `gap` (`gap` lệnh gấp · `thuong` lệnh thường).
       *  22/10: gỡ `tre`, thêm `may`, `khach` (mảng id). */
      loc?: ThamSoLoc;
      sapXep?: "moi_nhan" | "cu_nhan" | "du_kien";
    }): Promise<SxWorkItemsOut> {
      const s = new URLSearchParams(qs({
        team_id: p.teamId, nhom: p.nhom, tim: p.tim,
        trang: p.trang, co_trang: p.coTrang, tu_ngay: p.tuNgay, den_ngay: p.denNgay,
        cho_xac_nhan: p.choXacNhan || undefined,
        sap_xep: p.sapXep,
      }).replace(/^\?/, ""));
      ganThamSoLoc(s, p.loc);
      return authed<SxWorkItemsOut>(`/api/san-xuat/work-items${s.toString() ? `?${s}` : ""}`, token);
    },
    /** Số đếm cho thanh lọc view Bảng: cùng tổ + kỳ + ô tìm với `workItems`, KHÔNG kèm điều kiện. */
    workItemsLocDem(token: string, p: { teamId: number; tim?: string; loc?: ThamSoLoc }): Promise<SxWorkItemsLocDem> {
      const s = new URLSearchParams(qs({ team_id: p.teamId, tim: p.tim }).replace(/^\?/, ""));
      ganThamSoLoc(s, p.loc);
      return authed<SxWorkItemsLocDem>(`/api/san-xuat/work-items/loc-dem?${s}`, token);
    },
    /** Tab Sản lượng của bàn tổ: lệnh → công đoạn → người; lọc · phân trang · tổng ở máy chủ. */
    sanLuongTo(token: string, loc: SxSanLuongToLoc): Promise<SxSanLuongTo> {
      // Hai điều kiện chọn nhiều đi dạng khoá lặp (`cong_doan=a&cong_doan=b`) — `qs` chỉ nhận một giá trị.
      const lap = [
        ...(loc.cong_doan ?? []).map((c) => `cong_doan=${encodeURIComponent(c)}`),
        ...(loc.nguoi ?? []).map((n) => `nguoi=${n}`),
      ].join("&");
      const dau = qs({
        team_id: loc.team_id, tu: loc.tu || undefined, den: loc.den || undefined,
        to_id: loc.to_id ?? undefined, tim: loc.tim?.trim() || undefined,
        trang: loc.trang, co_trang: loc.co_trang,
        phat_sinh: loc.phat_sinh, loai: loc.loai, gap: loc.gap,
      });
      return authed<SxSanLuongTo>(`/api/san-xuat/san-luong${dau}${lap ? `${dau ? "&" : "?"}${lap}` : ""}`, token);
    },
    /** Drawer một công việc: thanh kế hoạch + roster + phiên chạy + khoảng tham gia. */
    chiTiet(token: string, congViecId: number): Promise<SxWorkItemChiTiet> {
      return authed<SxWorkItemChiTiet>(`/api/san-xuat/work-items/${congViecId}`, token);
    },
    /** Tệp Kế hoạch SX đính kèm vào lệnh của công việc — tổ xem/tải, không sửa. Gói thu hồi → 404. */
    tepLenh(token: string, congViecId: number): Promise<SxTepLenhNhom[]> {
      return authed<{ nhom: SxTepLenhNhom[] }>(`/api/san-xuat/work-items/${congViecId}/tep-lenh`, token)
        .then((r) => r.nhom);
    },
    /** Giao MỘT người vào công việc. Lần giao đầu = tổ tiếp nhận. */
    phanCong(token: string, congViecId: number, body: SxPhanCongIn): Promise<SxLenhKetQua> {
      return authed<SxLenhKetQua>(`/api/san-xuat/work-items/${congViecId}/phan-cong`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    /** Rút một người khỏi công việc (đóng khoảng tham gia đang mở của họ). */
    rut(token: string, phanCongId: number, body: SxGoPhanCongIn): Promise<SxLenhKetQua> {
      return authed<SxLenhKetQua>(`/api/san-xuat/phan-cong/${phanCongId}/rut`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    /** Bắt đầu / tiếp tục chạy: mở phiên mới + khoảng tham gia. Không hỏi lý do gì (kíp chuẩn gỡ ở mg `0321`; sớm/trễ không hỏi). */
    batDau(token: string, congViecId: number, body: SxBatDauIn): Promise<SxLenhKetQua> {
      return authed<SxLenhKetQua>(`/api/san-xuat/work-items/${congViecId}/bat-dau`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    /** Tổ xác nhận đã cầm con dao trong tay — thứ DUY NHẤT mở cổng Bắt đầu cho bước cần dụng cụ.
     *  Tích một lần, không gỡ được: gỡ ra thì mốc "ai nói dao đã ở đây, lúc mấy giờ" mất nghĩa. */
    nhanKhuon(token: string, congViecId: number): Promise<SxLenhKetQua> {
      return authed<SxLenhKetQua>(`/api/san-xuat/work-items/${congViecId}/nhan-khuon`, token, {
        method: "POST",
      });
    },
    /** Trả dao về kệ — KHÔNG chặn gì, chỉ để hệ thống khỏi mất dấu con dao sau khi nó rời kệ. */
    traKhuon(token: string, congViecId: number): Promise<SxLenhKetQua> {
      return authed<SxLenhKetQua>(`/api/san-xuat/work-items/${congViecId}/tra-khuon`, token, {
        method: "POST",
      });
    },
    /** Đổi máy giữa chừng (§7.2 mở rộng 31/08/2026). CHẠY → đóng phiên máy cũ + mở phiên mới
     *  CÙNG mốc (giờ máy cũ không mất); TẠM DỪNG → chỉ đổi máy phân công, không mở phiên. */
    doiMay(token: string, congViecId: number, body: SxDoiMayIn): Promise<SxLenhKetQua> {
      return authed<SxLenhKetQua>(`/api/san-xuat/work-items/${congViecId}/doi-may`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    /** Tab Lịch sử của ngăn công việc: mọi việc đã xảy ra, mới nhất trên cùng. */
    lichSuViec(token: string, congViecId: number): Promise<SxLichSuViec> {
      return authed<SxLichSuViec>(`/api/san-xuat/work-items/${congViecId}/lich-su`, token);
    },
    /** Máy đổi sang được cho ô "Đổi máy" + tình trạng từng máy lúc gọi. Gọi mỗi lần mở ô. */
    mayDoi(token: string, congViecId: number): Promise<SxMayDoiOut> {
      return authed<SxMayDoiOut>(`/api/san-xuat/work-items/${congViecId}/may-doi`, token);
    },
    /** Tạm dừng: đóng phiên + khoảng tham gia. `ly_do` BẮT BUỘC. */
    tamDung(token: string, congViecId: number, body: SxTamDungIn): Promise<SxLenhKetQua> {
      return authed<SxLenhKetQua>(`/api/san-xuat/work-items/${congViecId}/tam-dung`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    /** Báo sự cố máy ngay tại tổ (31/08/2026): ghi vào hộp thư "Báo máy hỏng" của tổ sửa chữa,
     *  kèm neo về công việc/lệnh. `dung_san_xuat` → công việc chuyển Tạm dừng + đóng phiên máy
     *  trong CÙNG một giao dịch; "Vẫn chạy" → chỉ gửi yêu cầu, đồng hồ máy không dừng. */
    baoSuCo(token: string, congViecId: number, body: SxSuCoIn): Promise<SxSuCoKetQua> {
      return authed<SxSuCoKetQua>(`/api/san-xuat/work-items/${congViecId}/su-co`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    /** Kết thúc: đóng phiên + khoảng tham gia, đánh dấu hoàn thành. Không hỏi lý do sớm/trễ. */
    ketThuc(token: string, congViecId: number, body: SxKetThucIn): Promise<SxLenhKetQua> {
      return authed<SxLenhKetQua>(`/api/san-xuat/work-items/${congViecId}/ket-thuc`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },

    // --- Giai đoạn 3: sản lượng · bàn giao · vật tư ---------------------------------------
    /** Ghi MỘT mẻ sản lượng (tổng = tốt + hỏng; hỏng chỉ ghi kèm mô tả tự do, tuỳ chọn). */
    taoBatch(token: string, congViecId: number, body: SxBatchIn): Promise<SxSanLuongKetQua> {
      return authed<SxSanLuongKetQua>(`/api/san-xuat/work-items/${congViecId}/outputs`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    /** Băng "Danh mục đã đổi" của mẻ (§7.2b): bấm thì ảnh chụp lấy số MỚI. Không bấm = giữ số cũ. */
    capNhatDanhMucMe(token: string, batchId: number): Promise<SxSanLuongKetQua> {
      return authed<SxSanLuongKetQua>(`/api/san-xuat/outputs/${batchId}/cap-nhat-danh-muc`, token, {
        method: "POST", body: JSON.stringify({}),
      });
    },
    /** Sửa số làm được của mẻ (gác Xác nhận sản lượng). Mẻ đã giao thì lần giao đổi theo. */
    suaSoMe(token: string, batchId: number, body: SxSuaSoMeIn): Promise<SxSanLuongKetQua> {
      return authed<SxSanLuongKetQua>(`/api/san-xuat/outputs/${batchId}/sua-so`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    /** Thêm một lot đầu vào cho mẻ đã ghi (truy vết §10.3). */
    themLot(token: string, batchId: number, body: SxLotVaoIn): Promise<SxSanLuongKetQua> {
      return authed<SxSanLuongKetQua>(`/api/san-xuat/outputs/${batchId}/inputs`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    /** Đề xuất bàn giao cho chặng sau. Bước cuối lệnh không bàn giao; cùng tổ+LSX = tự xác nhận. */
    deXuatBanGiao(token: string, congViecId: number, body: SxBanGiaoDeXuatIn): Promise<SxBanGiaoKetQua> {
      return authed<SxBanGiaoKetQua>(`/api/san-xuat/work-items/${congViecId}/handovers`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    /** Sửa số lượng đề xuất (chỉ khi còn proposed, gác tổ NGUỒN). */
    suaBanGiao(token: string, banGiaoId: number, body: SxBanGiaoSuaIn): Promise<SxBanGiaoKetQua> {
      return authed<SxBanGiaoKetQua>(`/api/san-xuat/handovers/${banGiaoId}/sua`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    /** Xác nhận đã nhận (gác tổ ĐÍCH). */
    xacNhanBanGiao(token: string, banGiaoId: number, body: SxBanGiaoXacNhanIn): Promise<SxBanGiaoKetQua> {
      return authed<SxBanGiaoKetQua>(`/api/san-xuat/handovers/${banGiaoId}/xac-nhan`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    /** Tổ gửi MỘT lần đề nghị cấp vật tư cho công đoạn (lần đầu hoặc bổ sung). 400 = vi phạm
     *  nghiệp vụ (câu tiếng Việt trong `detail` — hiện NGUYÊN VĂN); 403 = không phải tổ trưởng
     *  đúng tổ; 404 = không thấy công việc. */
    deNghiVatTu(token: string, congViecId: number, body: SxVatTuDeNghiIn): Promise<SxVatTuDeNghiKetQua> {
      return authed<SxVatTuDeNghiKetQua>(`/api/san-xuat/work-items/${congViecId}/material-requests`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    /** Sửa một lần đề nghị CHƯA bị kho lập phiếu. `deNghiId` là id ĐỀ NGHỊ SẢN XUẤT (không phải
     *  id yêu cầu kho — hai không gian id khác nhau). Thân dòng THAY THẾ toàn bộ dòng của lần đó. */
    suaDeNghiVatTu(
      token: string, congViecId: number, deNghiId: number, body: SxVatTuDeNghiIn,
    ): Promise<SxVatTuDeNghiKetQua> {
      return authed<SxVatTuDeNghiKetQua>(
        `/api/san-xuat/work-items/${congViecId}/material-requests/${deNghiId}`, token,
        { method: "PUT", body: JSON.stringify(body) },
      );
    },

    /** Tổ yêu cầu NHẬP LẠI vật tư thừa vào kho (không cột kế hoạch, không lý do). 400 = câu tiếng
     *  Việt trong `detail`; 403 = không có quyền Kho ở tổ này. */
    nhapLaiVatTu(token: string, congViecId: number, body: SxVatTuNhapLaiIn): Promise<SxVatTuNhapLaiKetQua> {
      return authed<SxVatTuNhapLaiKetQua>(`/api/san-xuat/work-items/${congViecId}/material-returns`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },

    /* SÁU API PHÂN BỔ (`tinhPhanBo` · `chotPhanBo` · `moLaiPhanBo` · `buTru` · `loaiTru` ·
       `goLoaiTru`) GỠ 18/09/2026 cùng tầng chia sản lượng (mg `0322`). Sản xuất chỉ GHI NHẬN số
       lượng của mẻ; chia cho từng người là việc của kế toán về sau. */

    // --- KCS theo LỆNH (mg 0306) -----------------------------------------------------------
    /** Danh sách lệnh cho màn KCS — tìm + lọc + cắt trang ở máy chủ, kèm số trên nút lọc nhanh. */
    kcsLenh(
      token: string,
      p: { tim?: string; trang?: number; nhanh?: SxKcsLocNhanh; coTrang?: number; loc?: ThamSoLoc } = {},
    ): Promise<SxKcsLenhList> {
      const s = new URLSearchParams(qs({
        tim: p.tim?.trim() || undefined, trang: p.trang,
        nhanh: p.nhanh && p.nhanh !== "tat_ca" ? p.nhanh : undefined, co_trang: p.coTrang,
      }).replace(/^\?/, ""));
      // Thanh lọc (06/10/2026): `khach_id`, `tu_ngay`/`den_ngay`/`moc`.
      ganThamSoLoc(s, p.loc);
      return authed<SxKcsLenhList>(`/api/san-xuat/kcs/lenh${s.toString() ? `?${s}` : ""}`, token);
    },
    /** Ô "Khách hàng" của thanh lọc màn KCS — khách có lệnh đã vào nhóm thành phẩm, kèm số lệnh. */
    kcsKhachLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/san-xuat/kcs/lenh/khach-loc", token);
    },
    /** Ô Tổ gây lỗi / Công đoạn gây lỗi / Người kiểm của thanh lọc màn KCS, kèm số lệnh. */
    kcsGiaTriLoc(token: string): Promise<SxKcsGiaTriLoc> {
      return authed<SxKcsGiaTriLoc>("/api/san-xuat/kcs/lenh/gia-tri-loc", token);
    },
    /** Sơ đồ cả nhóm thành phẩm của lệnh — mỗi lệnh một làn, lệnh phụ trước. */
    kcsSoDoNhom(token: string, lsxId: number): Promise<SxKcsSoDoNhom> {
      return authed<SxKcsSoDoNhom>(`/api/san-xuat/kcs/lenh/${lsxId}/nhom`, token);
    },
    /** Tệp Kế hoạch SX của cả nhóm thành phẩm, nhìn từ màn KCS (quyền Xem KCS, chỉ đọc). */
    kcsTepNhom(token: string, lsxId: number): Promise<SxTepLenhNhom[]> {
      return authed<{ nhom: SxTepLenhNhom[] }>(`/api/san-xuat/kcs/lenh/${lsxId}/tep`, token).then((r) => r.nhom);
    },
    /** Mục "Kết quả KCS" của một công đoạn — người KCS xem mọi công đoạn, tổ xem theo phạm vi Xem. */
    kcsCongViec(token: string, congViecId: number): Promise<SxKcsCongViec> {
      return authed<SxKcsCongViec>(`/api/san-xuat/work-items/${congViecId}/kcs`, token);
    },
    /** Ghi MỘT lần kiểm công đoạn — multipart vì lỗi đi kèm ảnh. Tổ chịu = tổ của công đoạn, người
     *  kiểm = tài khoản đăng nhập (server chốt, không gửi lên). */
    kiemCongDoan(token: string, congViecId: number, body: SxKcsKiemIn): Promise<SxKcsKiemKetQua> {
      const fd = new FormData();
      if (body.so_dat != null) fd.append("so_dat", String(body.so_dat));
      fd.append("so_loi", String(body.so_loi));
      if (body.checklist?.length) fd.append("checklist_json", JSON.stringify(body.checklist));
      if (body.ghi_chu) fd.append("ghi_chu", body.ghi_chu);
      if (body.lsx_id != null) fd.append("lsx_id", String(body.lsx_id));
      if (body.loi) {
        // Ảnh của mọi dòng nối liền theo thứ tự dòng; `so_anh` cho máy chủ cắt lại đúng dòng.
        fd.append("loi_json", JSON.stringify(body.loi.map((d) => ({
          cong_viec_id: d.cong_viec_id, thu_tu: d.thu_tu ?? null, so_luong: d.so_luong, mo_ta: d.mo_ta,
          so_anh: d.files.length,
        }))));
        for (const d of body.loi) for (const f of d.files) fd.append("files", f);
      } else {
        if (body.loi_mo_ta) fd.append("loi_mo_ta", body.loi_mo_ta);
        for (const f of body.files ?? []) fd.append("files", f);
      }
      return authed<SxKcsKiemKetQua>(`/api/san-xuat/kcs/cong-viec/${congViecId}/kiem`, token, {
        method: "POST", body: fd,
      });
    },
    /** Tổ bị báo lỗi bấm "Đã xem" — gác Xác nhận sản lượng trọn tổ đó. */
    daXemLoiKcs(token: string, loiId: number): Promise<SxKcsDaXemKetQua> {
      return authed<SxKcsDaXemKetQua>(`/api/san-xuat/kcs/loi/${loiId}/da-xem`, token, {
        method: "POST",
      });
    },
    /** "Tạo yêu cầu nhập kho" trên công đoạn cuối nhóm — server tự tính phần đạt chưa gửi (trần =
     *  min(Σ đạt, Σ tốt) − đã đề nghị), không nhận số từ client; đẻ MỘT yêu cầu NHẬP thật (DNN…) chờ kho
     *  nhận ở Hộp yêu cầu. 409 nếu không còn gì để gửi. */
    taoYeuCauNhapKhoCongDoan(token: string, congViecId: number): Promise<SxNhapKhoYcKetQua> {
      return authed<SxNhapKhoYcKetQua>(`/api/san-xuat/kcs/cong-viec/${congViecId}/yeu-cau-nhap-kho`, token, {
        method: "POST",
      });
    },
    /** Báo cáo/dashboard KCS theo bộ lọc (§5.7, §6.2) — KPI + 3 biểu đồ. */
    baoCaoKcs(token: string, params: SxKcsBaoCaoParams = {}): Promise<SxKcsBaoCao> {
      return authed<SxKcsBaoCao>(`/api/san-xuat/kcs/bao-cao${qs({ ...params })}`, token);
    },
    /** Xuất Excel báo cáo KCS — CÙNG filter với `baoCaoKcs` (§9 mục 10: cùng lọc phải ra cùng tổng). */
    exportBaoCaoKcsBlobUrl(token: string, params: SxKcsBaoCaoParams = {}): Promise<string> {
      return blobUrl(`/api/san-xuat/kcs/bao-cao/export.xlsx${qs({ ...params })}`, token);
    },

    /* Hộp thư / xác nhận nhập kho thành phẩm riêng của sản xuất GỠ 17/09/2026 — kho nhận ở Hộp yêu
       cầu của module Kho (`api.kho`), như mọi yêu cầu nhập khác. */

    // --- Giai đoạn 5: Đóng nhóm §16 + đóng thiếu §13.3 ------------------------------------
    /* `thuongToTruongNhom()` GỠ 11/09/2026 cùng route `/kho/nhom/{id}/thuong-to-truong`. */
    /** Số tóm tắt + cảnh báo cho hộp "Đóng lệnh" (không có cổng). */
    tinhTrangDongLenh(token: string, nhomId: number): Promise<SxDongLenhTinhTrang> {
      return authed<SxDongLenhTinhTrang>(`/api/san-xuat/kcs/nhom/${nhomId}/dong`, token);
    },
    dongLenh(token: string, nhomId: number, body: { expected_version: number }): Promise<SxDongLenhKetQua> {
      return authed<SxDongLenhKetQua>(`/api/san-xuat/kcs/nhom/${nhomId}/dong`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    moLaiLenh(token: string, nhomId: number, body: { expected_version: number }): Promise<SxDongLenhKetQua> {
      return authed<SxDongLenhKetQua>(`/api/san-xuat/kcs/nhom/${nhomId}/mo-lai`, token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
  },

  // --- Báo giá (Quotation), spec-09 -----------------------------------------
  quotations: {
    list(token: string, params: QuotationListParams = {}): Promise<QuotationListOut> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.nguoi != null) qs.set("nguoi", String(params.nguoi));
      if (params.status) qs.set("status", params.status);
      if (params.sort) qs.set("sort", params.sort);
      if (params.page) qs.set("page", String(params.page));
      if (params.size) qs.set("size", String(params.size));
      ganThamSoLoc(qs, params.loc);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<QuotationListOut>(`/api/quotations${suffix}`, token);
    },
    enums(token: string): Promise<QuotationEnumsOut> {
      return authed<QuotationEnumsOut>("/api/quotations/enums", token);
    },
    /** Số đếm cho thanh tab list — theo cùng ô tìm, NV phụ trách, dải kỳ và bộ lọc với bảng. */
    stats(token: string, nguoi?: number | null, loc?: ThamSoLoc): Promise<QuotationStats> {
      const qs = new URLSearchParams();
      if (nguoi != null) qs.set("nguoi", String(nguoi));
      ganThamSoLoc(qs, loc);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<QuotationStats>(`/api/quotations/stats${suffix}`, token);
    },
    /** Ô "Khách hàng" của bảng lọc — khách đang có báo giá trong tầm nhìn. */
    khachLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/quotations/khach-loc", token);
    },
    /** Ô "Người duyệt" của bảng lọc — ai đã ra quyết định duyệt trên báo giá trong tầm nhìn. */
    nguoiDuyet(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/quotations/nguoi-duyet", token);
    },
    /** Hộp lọc NV phụ trách — chỉ người có báo giá TRONG tầm nhìn (phạm vi + nhóm dùng chung). */
    nguoiPhuTrach(token: string): Promise<SaleOption[]> {
      return authed<SaleOption[]>("/api/quotations/nguoi-phu-trach", token);
    },
    get(token: string, id: number): Promise<QuotationDetail> {
      return authed<QuotationDetail>(`/api/quotations/${id}`, token);
    },
    create(token: string, input: QuotationInput): Promise<QuotationDetail> {
      return authed<QuotationDetail>("/api/quotations", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    update(token: string, id: number, input: QuotationUpdateInput): Promise<QuotationDetail> {
      return authed<QuotationDetail>(`/api/quotations/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    transition(
      token: string,
      id: number,
      body: { to_status: string; cancel_reason?: string | null; row_version?: number | null; accepted_item_ids?: number[] | null },
    ): Promise<QuotationDetail> {
      return authed<QuotationDetail>(`/api/quotations/${id}/transition`, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    requote(token: string, id: number, change_reason: string): Promise<QuotationDetail> {
      return authed<QuotationDetail>(`/api/quotations/${id}/requote`, token, {
        method: "POST",
        body: JSON.stringify({ change_reason }),
      });
    },
    /** Feed Hoạt động — nhật ký tương tác THẬT (ai làm gì) của báo giá này. */
    activity(token: string, id: number): Promise<{ items: QuotationActivity[] }> {
      return authed(`/api/quotations/${id}/activity`, token);
    },
    /** BG-1: báo giá ĐANG HIỆU LỰC của 1 Phiếu tính giá (màn PTG quyết Tạo mới / Mở cái có sẵn). */
    byPhieu(token: string, phieuId: number): Promise<{ quote_id: number | null; quote_number: string | null }> {
      return authed(`/api/quotations/by-phieu/${phieuId}`, token);
    },
    /** PTG đổi số → đồng bộ sang báo giá đang hiệu lực (Phương án A). Nháp = cập nhật tại chỗ;
     *  đã chốt = tạo phiên bản mới. Trả mode để màn PTG báo cho người dùng. */
    resyncFromPhieu(
      token: string,
      phieuId: number,
    ): Promise<{ quote_id: number; quote_number: string; mode: "draft_synced" | "new_version" }> {
      return authed(`/api/quotations/resync-from-ptg/${phieuId}`, token, { method: "POST" });
    },
    /** Badge nav: số báo giá 'Chờ duyệt' trong phạm vi — chỉ ai có quyền duyệt đặc thù mới >0. */
    pendingApprovalCount(token: string): Promise<{ count: number }> {
      return authed(`/api/quotations/pending-approval-count`, token);
    },
    /** Real-time luồng gửi duyệt: số 'chờ tôi duyệt' + số quyết định (cho báo giá của tôi) chưa xem. */
    notifySummary(token: string): Promise<QuoteNotifySummary> {
      return authed(`/api/quotations/notify-summary`, token);
    },
    /** Người soạn xác nhận đã xem các quyết định duyệt/từ chối → đóng badge/toast phía Sale. */
    markDecisionsSeen(token: string): Promise<{ ok: boolean }> {
      return authed(`/api/quotations/decisions/seen`, token, { method: "POST" });
    },
    /** BG-2: GĐ DUYỆT / TỪ CHỐI báo giá đặc thù → mở khóa "gửi khách". */
    recordApproval(
      token: string,
      id: number,
      body: { decision: "approved" | "rejected"; note?: string | null },
    ): Promise<QuotationDetail> {
      return authed<QuotationDetail>(`/api/quotations/${id}/approval`, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    /** Open the đối-ngoại PDF in a new tab (auth via bearer; returns a blob URL). Refresh-
     *  aware: if the in-memory access token has expired the fetch gets a 401, so we refresh
     *  ONCE (shared in-flight promise, no storm) and retry with the rotated token — exactly
     *  like `authed()`. cache:no-store keeps a stale entry from shadowing the response. */
    async pdfBlobUrl(token: string, id: number): Promise<string> {
      const doFetch = (bearer: string) =>
        fetch(`${BASE_URL}/api/quotations/${id}/pdf`, {
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json", ...authHeader(bearer) },
        });
      let resp = await doFetch(token);
      if (resp.status === 401) {
        const fresh = await refreshAccessToken();
        if (fresh) resp = await doFetch(fresh);
      }
      if (!resp.ok) throw new ApiError(`Tải bản PDF thất bại (mã ${resp.status}).`, resp.status);
      const blob = await resp.blob();
      return URL.createObjectURL(blob);
    },
    // --- Tài liệu đính kèm nội bộ (file khách gửi / mẫu thiết kế / ảnh tham khảo) ---
    attachments(token: string, id: number): Promise<{ items: QuoteAttachment[] }> {
      return authed<{ items: QuoteAttachment[] }>(`/api/quotations/${id}/attachments`, token);
    },
    uploadAttachment(token: string, id: number, file: File): Promise<QuoteAttachment> {
      const form = new FormData();
      form.append("file", file);
      return authed<QuoteAttachment>(`/api/quotations/${id}/attachments`, token, {
        method: "POST",
        body: form,
      });
    },
    deleteAttachment(token: string, id: number, attachmentId: number): Promise<void> {
      return authed<void>(`/api/quotations/${id}/attachments/${attachmentId}`, token, {
        method: "DELETE",
      });
    },
    // --- Ảnh minh họa in cho khách (cột "Hình ảnh minh họa" của bản in) ---
    // Gắn theo CỤM: gọi với 1 dòng bất kỳ trong cụm, backend ghi cho mọi dòng cùng tên.
    uploadItemImage(token: string, id: number, itemId: number, file: File): Promise<QuoteItemImage> {
      const form = new FormData();
      form.append("file", file);
      return authed<QuoteItemImage>(`/api/quotations/${id}/items/${itemId}/anh-minh-hoa`, token, {
        method: "POST",
        body: form,
      });
    },
    deleteItemImage(token: string, id: number, itemId: number): Promise<void> {
      return authed<void>(`/api/quotations/${id}/items/${itemId}/anh-minh-hoa`, token, {
        method: "DELETE",
      });
    },
  },

  orders: {
    list(token: string, params: OrderListParams = {}): Promise<OrderListOut> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.status) qs.set("status", params.status);
      if (params.order_kind) qs.set("order_kind", params.order_kind);
      if (params.view_scope) qs.set("view_scope", params.view_scope);
      if (params.nguoi != null) qs.set("nguoi", String(params.nguoi));
      if (params.sort) qs.set("sort", params.sort);
      if (params.page) qs.set("page", String(params.page));
      if (params.size) qs.set("size", String(params.size));
      ganThamSoLoc(qs, params.loc);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<OrderListOut>(`/api/orders${suffix}`, token);
    },
    /** Ô "Khách hàng" của bảng lọc — khách đang có đơn trong tầm nhìn. */
    khachLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/orders/khach-loc", token);
    },
    /** Hộp lọc NV phụ trách — chỉ người có đơn TRONG tầm nhìn (phạm vi + nhóm dùng chung). */
    nguoiPhuTrach(token: string): Promise<SaleOption[]> {
      return authed<SaleOption[]>("/api/orders/nguoi-phu-trach", token);
    },
    /** Số đơn theo từng giá trị ô lọc "Đang chờ", trong tầm nhìn. */
    dangChoDem(token: string): Promise<Record<DangCho, number>> {
      return authed<Record<DangCho, number>>("/api/orders/dang-cho-dem", token);
    },
    /** Ô "Nhà gia công" của bảng lọc — nhà gia công có lần trên đơn trong tầm nhìn. */
    nhaGiaCongLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/orders/nha-gia-cong-loc", token);
    },
    enums(token: string): Promise<OrderEnumsOut> {
      return authed<OrderEnumsOut>("/api/orders/enums", token);
    },
    notifySummary(token: string): Promise<OrderNotifySummary> {
      return authed<OrderNotifySummary>("/api/orders/notify-summary", token);
    },
    get(token: string, id: number): Promise<OrderDetail> {
      return authed<OrderDetail>(`/api/orders/${id}`, token);
    },
    /** Tiến độ đơn cho Kinh doanh — SX → Nhập kho → Giao hàng, gộp theo cụm bán (19/09/2026). */
    tienDo(token: string, id: number): Promise<DonTienDo> {
      return authed<DonTienDo>(`/api/orders/${id}/tien-do`, token);
    },
    /** Dữ liệu in phiếu xuất kho bán hàng / 02-VT của một yêu cầu giao — chỉ có sau khi kho ghi sổ. */
    phieuXuatIn(token: string, id: number, yeuCauId: number): Promise<PhieuXuatIn> {
      return authed<PhieuXuatIn>(`/api/orders/${id}/yeu-cau-giao/${yeuCauId}/phieu-xuat`, token);
    },
    create(token: string, input: OrderCreateInput): Promise<OrderDetail> {
      return authed<OrderDetail>("/api/orders", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    update(token: string, id: number, input: OrderUpdateInput): Promise<OrderDetail> {
      return authed<OrderDetail>(`/api/orders/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    /** Sale đổi hint sản xuất (gấp / lưu ý SX) SAU khi đã chốt — đường hẹp (update() khóa nháp).
     *  Realtime → bàn Kế hoạch SX "ting". Field bỏ trống = giữ nguyên. */
    updateProductionHint(
      token: string, id: number, input: { is_rush?: boolean; production_note?: string },
    ): Promise<OrderDetail> {
      return authed<OrderDetail>(`/api/orders/${id}/production-hint`, token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** Sale "Chuyển xuống sản xuất" — đơn đã chốt (đủ cọc) → vào hàng chờ Kế hoạch. Idempotent. */
    releaseProduction(token: string, id: number): Promise<OrderDetail> {
      return authed<OrderDetail>(`/api/orders/${id}/release-production`, token, { method: "POST" });
    },
    activity(token: string, id: number): Promise<{ items: OrderActivity[] }> {
      return authed(`/api/orders/${id}/activity`, token);
    },
    /** V5: Kế toán lập phiếu thu cọc THẬT từ đơn (tạo PaymentReceipt received, gắn order_id). */
    addDepositReceipt(token: string, orderId: number, input: OrderDepositReceiptInput): Promise<OrderDetail> {
      return authed<OrderDetail>(`/api/orders/${orderId}/deposit-receipts`, token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    // `submit` / `approve` / `reject` đã XOÁ cùng luồng duyệt đơn đặc thù (3 route backend cũng gỡ).
    confirm(token: string, id: number): Promise<OrderDetail> {
      return authed<OrderDetail>(`/api/orders/${id}/confirm`, token, { method: "POST" });
    },
    /** Việc 4: gia hạn báo giá nguồn +30 ngày (gỡ blocker hết-hạn ở cổng chốt). Quyền `update`. */
    extendQuote(token: string, id: number): Promise<OrderDetail> {
      return authed<OrderDetail>(`/api/orders/${id}/extend-quote`, token, { method: "POST" });
    },
    cancel(token: string, id: number, reason: string, fault: string | null): Promise<OrderDetail> {
      return authed<OrderDetail>(`/api/orders/${id}/cancel`, token, {
        method: "POST",
        body: JSON.stringify({ reason, fault }),
      });
    },
    stats(token: string, viewScope?: string, nguoi?: number | null, loc?: ThamSoLoc): Promise<OrderStatsOut> {
      const qs = new URLSearchParams();
      if (viewScope) qs.set("view_scope", viewScope);
      if (nguoi != null) qs.set("nguoi", String(nguoi));
      ganThamSoLoc(qs, loc);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<OrderStatsOut>(`/api/orders/stats${suffix}`, token);
    },
    uploadConsent(token: string, id: number, file: File): Promise<OrderDetail> {
      const form = new FormData();
      form.append("file", file);
      return authed<OrderDetail>(`/api/orders/${id}/attachments`, token, { method: "POST", body: form });
    },
    deleteConsent(token: string, id: number, attachmentId: number): Promise<OrderDetail> {
      return authed<OrderDetail>(`/api/orders/${id}/attachments/${attachmentId}`, token, { method: "DELETE" });
    },
  },
  // --- Báo cáo kinh doanh theo khách (24/09/2026) — đơn đã chốt, lọc theo ngày chốt -------
  baoCaoKinhDoanh: {
    /** `loc` = kỳ (`tu_ngay`/`den_ngay`/`moc`) + `customer_id` + `sale_id` — lọc ở máy chủ. */
    xem(token: string, loc: ThamSoLoc = {}): Promise<BaoCaoKinhDoanh> {
      const qs = new URLSearchParams();
      ganThamSoLoc(qs, loc);
      const s = qs.toString();
      return authed<BaoCaoKinhDoanh>(`/api/bao-cao-kinh-doanh${s ? `?${s}` : ""}`, token);
    },
    khachLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/bao-cao-kinh-doanh/loc-khach", token);
    },
    saleLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/bao-cao-kinh-doanh/loc-sale", token);
    },
    /** File .xlsx — fetch kèm bearer rồi dựng blob (thẻ `<a href>` trần không mang token). */
    async xuatExcel(token: string, loc: ThamSoLoc = {}): Promise<{ url: string; ten: string }> {
      const qs = new URLSearchParams();
      ganThamSoLoc(qs, loc);
      const duong = `${BASE_URL}/api/bao-cao-kinh-doanh/export.xlsx?${qs.toString()}`;
      const doFetch = (bearer: string) =>
        fetch(duong, { credentials: "include", cache: "no-store", headers: authHeader(bearer) });
      let resp = await doFetch(token);
      if (resp.status === 401) {
        const fresh = await refreshAccessToken();
        if (fresh) resp = await doFetch(fresh);
      }
      if (!resp.ok) throw new ApiError(`Không xuất được file (${resp.status}).`, resp.status);
      const khop = /filename="([^"]+)"/.exec(resp.headers.get("content-disposition") ?? "");
      return {
        url: URL.createObjectURL(await resp.blob()),
        ten: khop ? khop[1] : "bao-cao-kinh-doanh.xlsx",
      };
    },
  },
  // --- Khuôn bế (danh mục — đọc để gán vào lệnh có bế) ----------------------
  khuonBe: {
    list(token: string, params: { q?: string; active?: boolean } = {}): Promise<{ items: KhuonBeRow[] }> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.active != null) qs.set("active", String(params.active));
      const s = qs.toString();
      return authed<{ items: KhuonBeRow[] }>(`/api/khuon-be${s ? `?${s}` : ""}`, token);
    },
  },

  // --- Thu mua --------------------------------------------------------------
  suppliers: {
    tongQuan(token: string): Promise<SupplierTongQuan> {
      return authed<SupplierTongQuan>("/api/suppliers/tong-quan", token);
    },
    list(
      token: string,
      params: {
        q?: string;
        status?: string | null;
        supplier_group?: string | null;
        /** Chỉ lấy NCC có sao trung bình ≥ mức này. NCC "Chưa đánh giá" rơi ra khỏi kết quả. */
        rating_min?: number | null;
        /** `rating` / `-rating` xếp theo sao — NCC chưa đánh giá luôn nằm CUỐI ở cả hai chiều. */
        sort?: string;
        page?: number;
        size?: number;
        /** Thanh lọc chung: `tu_ngay`/`den_ngay`/`moc`, `nhan_gia_cong` (và các ô lọc ở trên). */
        loc?: ThamSoLoc;
      } = {},
    ): Promise<SupplierListOut> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.status) qs.set("status", params.status);
      if (params.supplier_group) qs.set("supplier_group", params.supplier_group);
      if (params.rating_min != null) qs.set("rating_min", String(params.rating_min));
      if (params.sort) qs.set("sort", params.sort);
      if (params.page) qs.set("page", String(params.page));
      if (params.size) qs.set("size", String(params.size));
      ganThamSoLoc(qs, params.loc);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<SupplierListOut>(`/api/suppliers${suffix}`, token);
    },
    /** Một NCC theo mã — nút "Hồ sơ nhà cung cấp" ở màn khác mở thẳng hồ sơ. */
    get(token: string, id: number): Promise<SupplierRow> {
      return authed<SupplierRow>(`/api/suppliers/${id}`, token);
    },
    create(token: string, input: SupplierInput): Promise<SupplierRow> {
      return authed<SupplierRow>("/api/suppliers", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    update(token: string, id: number, input: SupplierInput): Promise<SupplierRow> {
      return authed<SupplierRow>(`/api/suppliers/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    toggleActive(token: string, id: number): Promise<SupplierRow> {
      return authed<SupplierRow>(`/api/suppliers/${id}/toggle-active`, token, {
        method: "PATCH",
      });
    },
    itemCatalog(token: string): Promise<{ items: SupplierItemCatalogRow[] }> {
      return authed<{ items: SupplierItemCatalogRow[] }>("/api/supplier-items/catalog", token);
    },
    /** File mẫu bảng giá vật tư (blob URL). */
    itemsTemplateBlobUrl(token: string): Promise<string> {
      return blobUrl("/api/suppliers/items/template.xlsx", token);
    },
    /** Bảng giá HIỆN CÓ của đúng NCC đang mở (blob URL). */
    itemsExportBlobUrl(token: string, id: number): Promise<string> {
      return blobUrl(`/api/suppliers/${id}/items/export.xlsx`, token);
    },
    /** ĐỌC file .xlsx → mặt hàng + lỗi từng dòng. KHÔNG ghi DB: người dùng xem rồi bấm
     *  "Lưu nhà cung cấp" mới vào sổ. */
    itemsImport(token: string, file: File): Promise<SupplierItemImportOut> {
      const form = new FormData();
      form.append("file", file);
      return authed<SupplierItemImportOut>("/api/suppliers/items/import", token, {
        method: "POST",
        body: form,
      });
    },
  },

  moduleNotifications: {
    summary(token: string): Promise<ModuleNotificationSummary> {
      return authed<ModuleNotificationSummary>("/api/module-notifications/summary", token);
    },
    markRead(token: string, channel: ModuleNotificationChannel): Promise<void> {
      return authed<void>(`/api/module-notifications/${channel}/mark-read`, token, {
        method: "POST",
      });
    },
  },

  departmentPurchaseRequests: {
    list(
      token: string,
      params: { q?: string; status?: string | null; source_type?: string | null; sort?: string; page?: number; size?: number } = {},
      /** Thanh lọc chung: `tu_ngay/den_ngay/moc` (tao | can), `phong_ban`, `nguoi_yeu_cau`, `mat_hang` (`giay:12`). */
      loc?: ThamSoLoc,
    ): Promise<DepartmentPurchaseRequestListOut> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.status) qs.set("status", params.status);
      if (params.source_type) qs.set("source_type", params.source_type);
      if (params.sort) qs.set("sort", params.sort);
      if (params.page) qs.set("page", String(params.page));
      if (params.size) qs.set("size", String(params.size));
      ganThamSoLoc(qs, loc);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<DepartmentPurchaseRequestListOut>(`/api/department-purchase-requests${suffix}`, token);
    },
    /** Chế độ xem TỪNG MÓN — cùng bộ lọc với `list`, lọc tình trạng + cắt trang ở máy chủ. */
    mon(
      token: string,
      params: { q?: string; tinh_trang?: string | null; page?: number; size?: number } = {},
      loc?: ThamSoLoc,
    ): Promise<YeuCauMonListOut> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.tinh_trang) qs.set("tinh_trang", params.tinh_trang);
      if (params.page) qs.set("page", String(params.page));
      if (params.size) qs.set("size", String(params.size));
      ganThamSoLoc(qs, loc);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<YeuCauMonListOut>(`/api/department-purchase-requests/mon${suffix}`, token);
    },
    /** Ba ô chọn của thanh lọc Yêu cầu mua hàng — giá trị đang có trong tầm nhìn + số yêu cầu. */
    locPhongBan(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/department-purchase-requests/loc-phong-ban", token);
    },
    locNguoiYeuCau(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/department-purchase-requests/loc-nguoi-yeu-cau", token);
    },
    /** Mặt hàng khoá bằng chuỗi `hang_loai:hang_id` (vd `giay:12`), không phải id số. */
    locMatHang(token: string): Promise<{ ma: string; ten: string; so: number }[]> {
      return authed<{ ma: string; ten: string; so: number }[]>("/api/department-purchase-requests/loc-mat-hang", token);
    },
    get(token: string, id: number): Promise<DepartmentPurchaseRequestRow> {
      return authed<DepartmentPurchaseRequestRow>(`/api/department-purchase-requests/${id}`, token);
    },
    canCreate(token: string): Promise<{ can_create: boolean }> {
      return authed<{ can_create: boolean }>("/api/department-purchase-requests/can-create", token);
    },
    create(token: string, input: DepartmentPurchaseRequestInput): Promise<DepartmentPurchaseRequestRow> {
      return authed<DepartmentPurchaseRequestRow>("/api/department-purchase-requests", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    update(token: string, id: number, input: DepartmentPurchaseRequestInput): Promise<DepartmentPurchaseRequestRow> {
      return authed<DepartmentPurchaseRequestRow>(`/api/department-purchase-requests/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    cancel(token: string, id: number, reason: string | null): Promise<DepartmentPurchaseRequestRow> {
      return authed<DepartmentPurchaseRequestRow>(`/api/department-purchase-requests/${id}/cancel`, token, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    },
    /** Bỏ MỘT MÓN khỏi yêu cầu, giữ nguyên các món còn lại (mg 0233). Lý do BẮT BUỘC (422 nếu
        trống). Món đang nằm ở đơn mua còn sống → 409 kèm câu chỉ đúng đơn phải xử lý trước. */
    cancelLine(
      token: string,
      id: number,
      lineId: number,
      reason: string,
    ): Promise<DepartmentPurchaseRequestRow> {
      return authed<DepartmentPurchaseRequestRow>(
        `/api/department-purchase-requests/${id}/lines/${lineId}/cancel`,
        token,
        { method: "POST", body: JSON.stringify({ reason }) },
      );
    },
  },

  purchaseRequests: {
    list(
      token: string,
      params: {
        q?: string;
        status?: string | null;
        supplier_id?: number | null;
        deposit_status?: string | null;
        /** Nhóm cột Tiền — độc lập với `status` (Hàng). */
        tien?: NhomTien | null;
        sort?: string;
        page?: number;
        size?: number;
      } = {},
      /** Thanh lọc chung: `tu_ngay/den_ngay/moc` (tao | can | nhan), `tong_tu/tong_den`. */
      loc?: ThamSoLoc,
    ): Promise<PurchaseRequestListOut> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.status) qs.set("status", params.status);
      if (params.supplier_id !== undefined && params.supplier_id !== null)
        qs.set("supplier_id", String(params.supplier_id));
      if (params.deposit_status) qs.set("deposit_status", params.deposit_status);
      if (params.tien) qs.set("tien", params.tien);
      if (params.sort) qs.set("sort", params.sort);
      if (params.page) qs.set("page", String(params.page));
      if (params.size) qs.set("size", String(params.size));
      ganThamSoLoc(qs, loc);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<PurchaseRequestListOut>(`/api/purchase-requests${suffix}`, token);
    },
    /** Ô "Nhà cung cấp" của thanh lọc Đơn mua hàng: NCC đang có đơn trong tầm nhìn + số đơn. */
    locNcc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/purchase-requests/loc-ncc", token);
    },
    /** Ô NV yêu cầu / NV mua hàng / NV duyệt của thanh lọc Đơn mua hàng + số đơn. */
    locNguoi(token: string, vai: VaiNguoiDon): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>(`/api/purchase-requests/loc-nguoi?vai=${vai}`, token);
    },
    get(token: string, id: number): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(`/api/purchase-requests/${id}`, token);
    },
    // Badge sidebar "Mua hàng". Rẻ (COUNT ở DB) nên gọi lại được sau mỗi sự kiện SSE.
    notifySummary(token: string): Promise<PurchaseNotifySummary> {
      return authed<PurchaseNotifySummary>("/api/purchase-requests/notify-summary", token);
    },
    create(token: string, input: PurchaseRequestInput): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>("/api/purchase-requests", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** Tách phiếu theo NCC: mỗi dòng mang `supplier_id`, backend nhóm lại rồi đẻ N phiếu TRONG
     *  MỘT LẦN. Đừng gọi `create` nhiều lần — phiếu đầu giữ chỗ yêu cầu nguồn, lần sau bị chặn. */
    createBatch(
      token: string,
      input: PurchaseRequestBatchInput,
    ): Promise<{ items: PurchaseRequestRow[]; total: number }> {
      return authed<{ items: PurchaseRequestRow[]; total: number }>(
        "/api/purchase-requests/batch",
        token,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    update(token: string, id: number, input: PurchaseRequestInput): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(`/api/purchase-requests/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    remove(token: string, id: number): Promise<void> {
      return authed<void>(`/api/purchase-requests/${id}`, token, { method: "DELETE" });
    },
    /** Gửi duyệt. `deposit_expected` = cọc chốt cùng lần gửi; bỏ trống = giữ cọc đang có. */
    submit(token: string, id: number, input?: { deposit_expected?: number }): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(`/api/purchase-requests/${id}/submit`, token, {
        method: "POST",
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
    },
    approve(token: string, id: number): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(`/api/purchase-requests/${id}/approve`, token, { method: "POST" });
    },
    reject(token: string, id: number, reason: string | null): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(`/api/purchase-requests/${id}/reject`, token, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    },
    markPurchased(token: string, id: number): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(`/api/purchase-requests/${id}/mark-purchased`, token, { method: "POST" });
    },
    markReceived(
      token: string,
      id: number,
      lines: ReceivedLineInput[] = [],
    ): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(`/api/purchase-requests/${id}/mark-received`, token, {
        method: "POST",
        body: JSON.stringify({ lines }),
      });
    },
    /** Sửa số thực nhận SAU khi đã nhận (NCC giao nhiều đợt). Đòi quyền duyệt ở server. */
    updateReceivedQuantities(
      token: string,
      id: number,
      lines: ReceivedLineInput[],
    ): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(`/api/purchase-requests/${id}/received-quantities`, token, {
        method: "PUT",
        body: JSON.stringify({ lines }),
      });
    },
    /** Lùi "Đã nhận hàng" về "Đã mua". Bắt buộc có lý do; server chặn nếu đã có phiếu chi ĐÃ CHI. */
    undoReceived(token: string, id: number, reason: string): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(`/api/purchase-requests/${id}/undo-received`, token, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    },
    cancel(token: string, id: number, reason: string | null): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(`/api/purchase-requests/${id}/cancel`, token, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    },

    // --- Đợt giao ---------------------------------------------------------
    // Mọi endpoint dưới đây trả về NGUYÊN phiếu mua sau khi sửa (không phải riêng đợt): trạng thái
    // phiếu, công nợ và trần lập phiếu chi đều đổi theo đợt giao, nên trả nửa vời là màn hình cầm
    // số cũ. Cứ thay cả dòng bằng kết quả.

    /** Ghi một đợt giao mới. Chỉ chạy khi phiếu ở "Đã mua" / "Giao một phần". */
    createDelivery(
      token: string,
      id: number,
      input: PurchaseDeliveryInput,
    ): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(`/api/purchase-requests/${id}/deliveries`, token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** Sửa đợt giao. Bỏ `lines` = giữ nguyên dòng hàng, chỉ đổi ngày/hạn/hoá đơn.
     *  Server CHẶN nếu đợt đã có phiếu chi gắn vào — tiền đã ra thì không đổi số hàng dưới chân. */
    updateDelivery(
      token: string,
      id: number,
      deliveryId: number,
      input: PurchaseDeliveryInput,
    ): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(
        `/api/purchase-requests/${id}/deliveries/${deliveryId}`,
        token,
        { method: "PUT", body: JSON.stringify(input) },
      );
    },
    deleteDelivery(
      token: string,
      id: number,
      deliveryId: number,
    ): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(
        `/api/purchase-requests/${id}/deliveries/${deliveryId}`,
        token,
        { method: "DELETE" },
      );
    },
    /** Gán MỘT hoá đơn cho NHIỀU đợt cùng lúc — gõ lại số ba lần là hệ hiểu thành ba hoá đơn. */
    assignInvoice(
      token: string,
      id: number,
      input: PurchaseInvoiceAssignInput,
    ): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(`/api/purchase-requests/${id}/invoice`, token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** "Đóng đơn (không giao nữa)" — chốt số thực nhận = số đã giao. Bắt lý do; server đòi
     *  `thu_mua:approve` vì nó cắt phần hàng chưa về ra khỏi công nợ. */
    close(token: string, id: number, reason: string): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(`/api/purchase-requests/${id}/close`, token, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    },
    /** Số hợp đồng + cọc dự kiến. Tách khỏi `update` vì hợp đồng thường ký SAU khi phiếu đã duyệt. */
    updateContract(
      token: string,
      id: number,
      input: PurchaseContractInput,
    ): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(`/api/purchase-requests/${id}/contract`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    supplierCredit(token: string, id: number): Promise<SupplierCredit> {
      return authed<SupplierCredit>(
        `/api/purchase-requests/${id}/supplier-credit`,
        token,
      );
    },
    /** Đính ảnh/PDF (≤10 MB). `deliveryId` bỏ trống = tài liệu của cả phiếu (hợp đồng). */
    uploadAttachment(
      token: string,
      id: number,
      file: File,
      kind: PurchaseAttachmentKind = "khac",
      deliveryId?: number | null,
    ): Promise<PurchaseRequestRow> {
      const qs = new URLSearchParams({ kind });
      if (deliveryId != null) qs.set("delivery_id", String(deliveryId));
      const form = new FormData();
      form.append("file", file);
      return authed<PurchaseRequestRow>(
        `/api/purchase-requests/${id}/attachments?${qs.toString()}`,
        token,
        { method: "POST", body: form },
      );
    },
    deleteAttachment(
      token: string,
      id: number,
      attachmentId: number,
    ): Promise<PurchaseRequestRow> {
      return authed<PurchaseRequestRow>(
        `/api/purchase-requests/${id}/attachments/${attachmentId}`,
        token,
        { method: "DELETE" },
      );
    },
  },

  // --- Kế toán: duyệt mua hàng, Phiếu chi / UNC ---------------------------
  /** Danh mục Mục thu chi — chỉ phần ĐỌC cho ô chọn mục trên phiếu (màn danh mục dùng `crud`). */
  mucThuChi: {
    /** `chiDangDung` false = cả mục đã ngừng (bộ lọc danh sách phiếu — phiếu cũ vẫn mang mục đó). */
    list(token: string, loai: "thu" | "chi", chiDangDung = true): Promise<{ items: MucThuChi[] }> {
      const active = chiDangDung ? "&active=true" : "";
      return authed<{ items: MucThuChi[] }>(`/api/muc-thu-chi?loai=${loai}${active}&size=200`, token);
    },
  },
  /** Báo cáo thu chi theo mục × tháng (`/api/bao-cao-thu-chi`). */
  baoCaoThuChi: {
    bang(
      token: string,
      p: LocBaoCaoThuChi & { q?: string | null; the?: TheThuChi; page?: number; size?: number },
    ): Promise<BaoCaoThuChi> {
      const qs = qsBaoCaoThuChi(p);
      if (p.q?.trim()) qs.set("q", p.q.trim());
      if (p.the && p.the !== "all") qs.set("the", p.the);
      if (p.page) qs.set("page", String(p.page));
      if (p.size) qs.set("size", String(p.size));
      return authed<BaoCaoThuChi>(`/api/bao-cao-thu-chi?${qs.toString()}`, token);
    },
    /** Phiếu của MỘT dòng (ngăn chi tiết). `cot` = khoá cột kỳ để lọc. */
    phieu(
      token: string,
      p: LocBaoCaoThuChi & { ben: "thu" | "chi"; khoa: string; cot?: string | null },
    ): Promise<PhieuCuaDongThuChi> {
      const qs = qsBaoCaoThuChi(p);
      qs.set("ben", p.ben);
      qs.set("khoa", p.khoa);
      if (p.cot) qs.set("cot", p.cot);
      return authed<PhieuCuaDongThuChi>(`/api/bao-cao-thu-chi/phieu?${qs.toString()}`, token);
    },
    chuyenMuc(
      token: string,
      body: { phieu_chi_ids?: number[]; phieu_thu_ids?: number[]; muc_id: number },
    ): Promise<{ so_phieu: number }> {
      return authed<{ so_phieu: number }>("/api/bao-cao-thu-chi/chuyen-muc", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    /** File .xlsx đúng bảng đang xem. Fetch kèm bearer rồi dựng blob — `<a href>` trần không mang token. */
    async xlsx(
      token: string,
      p: LocBaoCaoThuChi & { q?: string | null; the?: TheThuChi },
    ): Promise<{ url: string; ten: string }> {
      const qs = qsBaoCaoThuChi(p);
      if (p.q?.trim()) qs.set("q", p.q.trim());
      if (p.the && p.the !== "all") qs.set("the", p.the);
      const duong = `${BASE_URL}/api/bao-cao-thu-chi/export.xlsx?${qs.toString()}`;
      const doFetch = (bearer: string) =>
        fetch(duong, { credentials: "include", cache: "no-store", headers: authHeader(bearer) });
      let resp = await doFetch(token);
      if (resp.status === 401) {
        const fresh = await refreshAccessToken();
        if (fresh) resp = await doFetch(fresh);
      }
      if (!resp.ok) throw new ApiError(`Không xuất được file (${resp.status}).`, resp.status);
      const khop = /filename="([^"]+)"/.exec(resp.headers.get("content-disposition") ?? "");
      return { url: URL.createObjectURL(await resp.blob()), ten: khop ? khop[1] : "bao-cao-thu-chi.xlsx" };
    },
  },
  accounting: {
    /** Tab "Mua hàng chờ chi" của màn Phiếu chi — mỗi đơn một dòng (khoá `phieu_chi` read). */
    muaHangChoChi(token: string, params: { q?: string; supplier_id?: number | null } = {}) {
      return authed<MuaHangChoChi[]>(`/api/accounting/mua-hang-cho-chi${qs(params)}`, token);
    },
    inbox(
      token: string,
      params: {
        q?: string;
        status?: string | null;
        supplier_id?: number | null;
        /** Kỳ của thanh lọc chung — `moc`: `tao` (Ngày tạo) | `can` (Ngày cần). */
        tu_ngay?: string | null;
        den_ngay?: string | null;
        moc?: string | null;
        deposit_status?: string | null;
        tien?: NhomTien | null;
        nv_yc_id?: number | null;
        nv_mua_id?: number | null;
        nv_duyet_id?: number | null;
        sort?: string;
        page?: number;
        size?: number;
      } = {},
    ): Promise<PurchaseRequestListOut> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.status) qs.set("status", params.status);
      if (params.tien) qs.set("tien", params.tien);
      if (params.supplier_id != null) qs.set("supplier_id", String(params.supplier_id));
      if (params.tu_ngay) qs.set("tu_ngay", params.tu_ngay);
      if (params.den_ngay) qs.set("den_ngay", params.den_ngay);
      if (params.moc) qs.set("moc", params.moc);
      if (params.deposit_status) qs.set("deposit_status", params.deposit_status);
      if (params.nv_yc_id != null) qs.set("nv_yc_id", String(params.nv_yc_id));
      if (params.nv_mua_id != null) qs.set("nv_mua_id", String(params.nv_mua_id));
      if (params.nv_duyet_id != null) qs.set("nv_duyet_id", String(params.nv_duyet_id));
      if (params.sort) qs.set("sort", params.sort);
      if (params.page) qs.set("page", String(params.page));
      if (params.size) qs.set("size", String(params.size));
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<PurchaseRequestListOut>(`/api/accounting/inbox${suffix}`, token);
    },
    /** Ô "Nhà cung cấp" của thanh lọc hộp Đơn mua hàng: NCC đang có đơn trong hộp + số đơn. */
    inboxLocNcc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/accounting/inbox/loc-ncc", token);
    },
    /** Ô NV yêu cầu / NV mua hàng / NV duyệt của hộp Đơn mua hàng (không tính đơn nháp). */
    inboxLocNguoi(token: string, vai: VaiNguoiDon): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>(`/api/accounting/inbox/loc-nguoi?vai=${vai}`, token);
    },
    /** Công nợ phải trả gom theo NCC. Không phân trang — cắt trang là ra TỔNG sai.
        `q` lọc ở SERVER: NCC đã trả hết và im lặng lâu thì không có dòng nào để lọc phía màn. */
    payables(token: string, params: LocCongNo = {}): Promise<PayablesSummary> {
      return authed<PayablesSummary>(`/api/accounting/payables${locCongNoVaoQuery(params)}`, token);
    },
    /** `allHistory` bỏ mốc kỳ cho rổ "đã chi" — nút "Xem lịch sử cũ hơn". Chỉ nới cho MỘT NCC.
     *  `ky` = rổ "đã chi" theo đúng kỳ màn tổng hợp đang chọn. */
    payablesDetail(
      token: string,
      supplierId: number,
      allHistory = false,
      ky?: { tu_ngay: string; den_ngay: string },
      trang?: TrangDaTra,
    ): Promise<PayablesDetail> {
      return authed<PayablesDetail>(
        `/api/accounting/payables/${supplierId}${chiTietCongNoQuery(allHistory, ky, trang)}`,
        token,
      );
    },
    receivables(token: string, params: LocCongNo = {}): Promise<ReceivablesSummary> {
      return authed<ReceivablesSummary>(`/api/accounting/receivables${locCongNoVaoQuery(params)}`, token);
    },
    receivablesDetail(
      token: string,
      customerId: number,
      allHistory = false,
      ky?: { tu_ngay: string; den_ngay: string },
      trang?: TrangDaTra,
    ): Promise<ReceivablesDetail> {
      return authed<ReceivablesDetail>(
        `/api/accounting/receivables/${customerId}${chiTietCongNoQuery(allHistory, ky, trang)}`,
        token,
      );
    },
    /** SỔ TỔNG HỢP CÔNG NỢ theo kỳ. `ben` = "receivables" (131) | "payables" (331). */
    baoCaoCongNo(
      token: string,
      ben: "receivables" | "payables",
      params: {
        tuNgay: string; denNgay: string; roTuoi?: string | null; q?: string | null;
        the?: CongNoThe | null; page?: number; size?: number;
        /** `con_no` = còn nợ cuối kỳ giảm dần (dạng biểu đồ); bỏ trống = theo tên. */
        sapXep?: "con_no";
      },
    ): Promise<BaoCaoCongNo> {
      const qs = new URLSearchParams({
        tu_ngay: params.tuNgay,
        den_ngay: params.denNgay,
      });
      if (params.roTuoi) qs.set("aging_bucket", params.roTuoi);
      if (params.q?.trim()) qs.set("q", params.q.trim());
      if (params.the && params.the !== "all") qs.set("the", params.the);
      if (params.sapXep) qs.set("sap_xep", params.sapXep);
      if (params.size) {
        qs.set("page", String(params.page ?? 1));
        qs.set("size", String(params.size));
      }
      return authed<BaoCaoCongNo>(
        `/api/accounting/reports/${ben}?${qs.toString()}`,
        token,
      );
    },
    /** SỔ CHI TIẾT CÔNG NỢ của MỘT đối tượng — từng chứng từ + luỹ kế (PRD §5.1).
     *
     *  `doiTuongId = null` KHÔNG phải "lấy tất cả" mà là dòng gom các khoản không truy được về
     *  khách/NCC nào — đúng dòng "(Thu khác…)" / "(Chi khác…)" ở sổ tổng hợp. */
    soChiTietCongNo(
      token: string,
      ben: "receivables" | "payables",
      params: {
        doiTuongId: number | null; tuNgay: string; denNgay: string; page?: number; size?: number;
      },
    ): Promise<SoChiTietCongNo> {
      const qs = new URLSearchParams({
        tu_ngay: params.tuNgay,
        den_ngay: params.denNgay,
      });
      if (params.doiTuongId != null) qs.set("doi_tuong_id", String(params.doiTuongId));
      if (params.size) {
        qs.set("page", String(params.page ?? 1));
        qs.set("size", String(params.size));
      }
      return authed<SoChiTietCongNo>(
        `/api/accounting/reports/${ben}/so-chi-tiet?${qs.toString()}`,
        token,
      );
    },
    /** Các đợt giao (331) / hoá đơn (131) CÒN NỢ tại `denNgay` của một đối tượng — tab thứ hai của
     *  ngăn sổ chi tiết. Trễ lâu nhất lên đầu. */
    khoanConNo(
      token: string,
      ben: "receivables" | "payables",
      params: { doiTuongId: number | null; tuNgay: string; denNgay: string },
    ): Promise<KhoanConNoList> {
      const qs = new URLSearchParams({ tu_ngay: params.tuNgay, den_ngay: params.denNgay });
      if (params.doiTuongId != null) qs.set("doi_tuong_id", String(params.doiTuongId));
      return authed<KhoanConNoList>(
        `/api/accounting/reports/${ben}/khoan-con-no?${qs.toString()}`,
        token,
      );
    },
    /** SAO KÊ của MỘT khách / NCC cho ngăn công nợ — cùng số với `soChiTietCongNo` nhưng gác bằng
     *  quyền xem CHÍNH màn công nợ (không đòi quyền Báo cáo). */
    saoKeDoiTac(
      token: string,
      ben: "receivables" | "payables",
      id: number,
      params: { tuNgay: string; denNgay: string },
    ): Promise<SoChiTietCongNo> {
      const qs = new URLSearchParams({ tu_ngay: params.tuNgay, den_ngay: params.denNgay });
      return authed<SoChiTietCongNo>(`/api/accounting/${ben}/${id}/so-chi-tiet?${qs.toString()}`, token);
    },
    /** File .xlsx đúng khuôn MISA. Phải fetch kèm bearer rồi dựng blob — thẻ `<a href>` trần
     *  không mang token đi được, và cửa này có kiểm quyền. */
    async baoCaoCongNoXlsx(
      token: string,
      ben: "receivables" | "payables",
      params: { tuNgay: string; denNgay: string },
      /** `true` = SỔ CHI TIẾT mọi đối tượng (từng chứng từ + TK đối ứng), không phải sổ tổng hợp. */
      chiTiet = false,
      /** Chỉ xuất sổ chi tiết của MỘT đối tượng. `null` = dòng gom "không gắn đối tượng" —
       *  KHÔNG phải "tất cả" (bỏ trống tham số này mới là tất cả). */
      motNguoi?: { doiTuongId: number | null },
    ): Promise<{ url: string; ten: string }> {
      const qs = new URLSearchParams({
        tu_ngay: params.tuNgay,
        den_ngay: params.denNgay,
      });
      if (motNguoi) {
        if (motNguoi.doiTuongId == null) qs.set("khong_gan", "true");
        else qs.set("doi_tuong_id", String(motNguoi.doiTuongId));
      }
      const duong = `${BASE_URL}/api/accounting/reports/${ben}${chiTiet ? "-detail" : ""}.xlsx?${qs.toString()}`;
      const doFetch = (bearer: string) =>
        fetch(duong, {
          credentials: "include",
          cache: "no-store",
          headers: authHeader(bearer),
        });
      let resp = await doFetch(token);
      if (resp.status === 401) {
        const fresh = await refreshAccessToken();
        if (fresh) resp = await doFetch(fresh);
      }
      if (!resp.ok) throw new ApiError(`Không xuất được file (${resp.status}).`, resp.status);
      // Tên file do SERVER đặt (có kỳ trong tên) — đọc lại từ header thay vì tự bịa ở đây, để
      // hai nơi không đặt hai kiểu tên cho cùng một file.
      const cd = resp.headers.get("content-disposition") ?? "";
      const khop = /filename="([^"]+)"/.exec(cd);
      return {
        url: URL.createObjectURL(await resp.blob()),
        ten: khop ? khop[1] : `tong-hop-cong-no-${ben}.xlsx`,
      };
    },
    /** `phanHe` = "phai_thu" (131) | "phai_tra" (331). Hai sổ ĐỘC LẬP — chốt sổ mua hàng không
     *  được kéo theo sổ bán hàng (sửa 04/09/2026). */
    congNoKyList(token: string, phanHe: "phai_thu" | "phai_tra"): Promise<CongNoKyRow[]> {
      return authed<CongNoKyRow[]>(`/api/accounting/khoa-so/ky?phan_he=${phanHe}`, token);
    },
    /** Khoảng này đang khóa trọn / khóa một phần / chưa khóa? */
    congNoKhoaSoTrangThai(
      token: string,
      params: { tuNgay: string; denNgay: string; phanHe: "phai_thu" | "phai_tra" },
    ): Promise<CongNoKhoaSoTrangThai> {
      const qs = new URLSearchParams({
        tu_ngay: params.tuNgay,
        den_ngay: params.denNgay,
        phan_he: params.phanHe,
      });
      return authed<CongNoKhoaSoTrangThai>(
        `/api/accounting/khoa-so/trang-thai?${qs.toString()}`,
        token,
      );
    },
    congNoKhoaSoHistory(token: string): Promise<CongNoKhoaSoRow[]> {
      return authed<CongNoKhoaSoRow[]>("/api/accounting/khoa-so", token);
    },
    setCongNoKhoaSo(
      token: string,
      payload: {
        /** BẮT BUỘC. Khoá sổ 331 không được kéo theo 131. */
        phan_he: "phai_thu" | "phai_tra";
        tu_ngay: string;
        den_ngay: string;
        hanh_dong: "khoa" | "mo";
        ten?: string | null;
      },
    ): Promise<CongNoKhoaSoRow> {
      return authed<CongNoKhoaSoRow>("/api/accounting/khoa-so", token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    /** Mục "Đơn hàng chờ thu" của màn Phiếu thu (17/10/2026): cọc chưa đủ + hoá đơn chưa trả hết. */
    donHangChoThu(token: string): Promise<DonHangChoThu> {
      return authed<DonHangChoThu>("/api/accounting/don-hang-cho-thu", token);
    },
    /** Mục "Chờ trả lại khách" của màn Phiếu chi (17/10/2026). */
    traLaiKhachChoChi(token: string): Promise<TraLaiKhachChoChi[]> {
      return authed<TraLaiKhachChoChi[]>("/api/accounting/tra-lai-khach-cho-chi", token);
    },
    /** Mục "Chờ chi CK / kê" của màn Phiếu chi (20/10/2026). */
    ckKeChoChi(token: string): Promise<CkKeChoChi[]> {
      return authed<{ items: CkKeChoChi[] }>("/api/accounting/ck-ke-cho-chi", token).then((r) => r.items);
    },
    createVoucherCkKe(token: string, input: PhieuChiCkKeInput): Promise<PaymentVoucherRow> {
      return authed<PaymentVoucherRow>("/api/accounting/payment-vouchers/ck-ke", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    salesInvoices(token: string, orderId: number): Promise<SalesInvoiceListOut> {
      return authed<SalesInvoiceListOut>(
        `/api/accounting/sales-invoices?order_id=${orderId}`,
        token,
      );
    },
    createSalesInvoice(
      token: string,
      input: SalesInvoiceInput,
    ): Promise<SalesInvoiceRow> {
      return authed<SalesInvoiceRow>("/api/accounting/sales-invoices", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    cancelSalesInvoice(
      token: string,
      invoiceId: number,
      reason: string,
    ): Promise<SalesInvoiceRow> {
      return authed<SalesInvoiceRow>(
        `/api/accounting/sales-invoices/${invoiceId}/cancel`,
        token,
        { method: "POST", body: JSON.stringify({ reason }) },
      );
    },
    chiTietKhoanThu(token: string, khoan: { invoice_id: number } | { order_id: number }): Promise<ChiTietKhoanThu> {
      const q = "invoice_id" in khoan ? `invoice_id=${khoan.invoice_id}` : `order_id=${khoan.order_id}`;
      return authed<ChiTietKhoanThu>(`/api/accounting/chi-tiet-khoan-thu?${q}`, token);
    },
    /** MỘT phiếu thu cho NHIỀU khoản của CÙNG một khách (17/10/2026). Một khoản ⇒ phiếu lẻ thường. */
    createReceiptGop(token: string, input: PhieuThuGopInput): Promise<PaymentReceiptRow> {
      return authed<PaymentReceiptRow>("/api/accounting/payment-receipts/gop", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    createSalesInvoiceReceipt(
      token: string,
      invoiceId: number,
      input: PaymentReceiptInput,
    ): Promise<PaymentReceiptRow> {
      return authed<PaymentReceiptRow>(
        `/api/accounting/sales-invoices/${invoiceId}/receipts`,
        token,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    companyAccounts(
      token: string,
      activeOnly = false,
      usage?: "receive" | "pay" | null,
      /** Thanh lọc màn Tài khoản ngân hàng: tên ngân hàng + trạng thái. */
      loc: { ngan_hang?: string; trang_thai?: "dang_dung" | "ngung" } = {},
    ): Promise<CompanyBankAccountRow[]> {
      const qs = new URLSearchParams();
      qs.set("active_only", String(activeOnly));
      if (usage) qs.set("usage", usage);
      if (loc.ngan_hang) qs.set("ngan_hang", loc.ngan_hang);
      if (loc.trang_thai) qs.set("trang_thai", loc.trang_thai);
      return authed<CompanyBankAccountRow[]>(
        `/api/accounting/company-bank-accounts?${qs.toString()}`,
        token,
      );
    },
    /** Ô "Ngân hàng" của thanh lọc màn Tài khoản ngân hàng: tên ngân hàng + số tài khoản. */
    nganHangLoc(token: string): Promise<{ ten: string; so: number }[]> {
      return authed<{ ten: string; so: number }[]>("/api/accounting/company-bank-accounts/loc-ngan-hang", token);
    },
    thongKeTaiKhoan(
      token: string,
      ky: { tu_ngay: string; den_ngay: string },
    ): Promise<TaiKhoanThongKe[]> {
      const qs = new URLSearchParams({ tu_ngay: ky.tu_ngay, den_ngay: ky.den_ngay });
      return authed<TaiKhoanThongKe[]>(
        `/api/accounting/company-bank-accounts/thong-ke?${qs.toString()}`,
        token,
      );
    },
    createCompanyAccount(token: string, input: CompanyBankAccountInput): Promise<CompanyBankAccountRow> {
      return authed<CompanyBankAccountRow>("/api/accounting/company-bank-accounts", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    updateCompanyAccount(token: string, id: number, input: CompanyBankAccountInput): Promise<CompanyBankAccountRow> {
      return authed<CompanyBankAccountRow>(`/api/accounting/company-bank-accounts/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    toggleCompanyAccount(token: string, id: number): Promise<CompanyBankAccountRow> {
      return authed<CompanyBankAccountRow>(`/api/accounting/company-bank-accounts/${id}/toggle-active`, token, {
        method: "PATCH",
      });
    },
    supplierAccounts(
      token: string,
      supplierId?: number | null,
      activeOnly = false,
    ): Promise<SupplierBankAccountRow[]> {
      const qs = new URLSearchParams();
      if (supplierId != null) qs.set("supplier_id", String(supplierId));
      qs.set("active_only", String(activeOnly));
      return authed<SupplierBankAccountRow[]>(
        `/api/accounting/supplier-bank-accounts?${qs.toString()}`,
        token,
      );
    },
    createSupplierAccount(token: string, input: SupplierBankAccountInput): Promise<SupplierBankAccountRow> {
      return authed<SupplierBankAccountRow>("/api/accounting/supplier-bank-accounts", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    updateSupplierAccount(
      token: string,
      id: number,
      input: SupplierBankAccountInput,
    ): Promise<SupplierBankAccountRow> {
      return authed<SupplierBankAccountRow>(`/api/accounting/supplier-bank-accounts/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    toggleSupplierAccount(token: string, id: number): Promise<SupplierBankAccountRow> {
      return authed<SupplierBankAccountRow>(`/api/accounting/supplier-bank-accounts/${id}/toggle-active`, token, {
        method: "PATCH",
      });
    },
    vouchers(
      token: string,
      params: Omit<LocPhieu, "status"> & {
        status?: string | null;
        source_type?: PaymentVoucherSource | null;
        voucher_type?: string | null;
        supplier_id?: number | null;
        purchase_request_id?: number | null;
      } = {},
    ): Promise<PaymentVoucherListOut> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.status) qs.set("status", params.status);
      if (params.source_type) qs.set("source_type", params.source_type);
      if (params.voucher_type) qs.set("voucher_type", params.voucher_type);
      if (params.supplier_id != null) qs.set("supplier_id", String(params.supplier_id));
      if (params.purchase_request_id != null)
        qs.set("purchase_request_id", String(params.purchase_request_id));
      if (params.sort) qs.set("sort", params.sort);
      if (params.page) qs.set("page", String(params.page));
      if (params.size) qs.set("size", String(params.size));
      themLocPhieuVaoQuery(qs, params);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<PaymentVoucherListOut>(`/api/accounting/payment-vouchers${suffix}`, token);
    },
    voucher(token: string, id: number): Promise<PaymentVoucherRow> {
      return authed<PaymentVoucherRow>(`/api/accounting/payment-vouchers/${id}`, token);
    },
    // (25/09/2026) `salaryAdvanceVouchers` ĐÃ GỠ: tải 1000 phiếu chi gần nhất để dò mã PC cho màn
    // Tạm ứng — ở quy mô ~1000 người/tháng thì phiếu cũ rơi khỏi 1000 và dòng "Đã chi" mất mã. Máy
    // chủ nay trả sẵn `phieu_chi_id` / `phieu_chi_code` trong `GET /api/luong/advances`.
    createVoucher(token: string, input: PaymentVoucherInput): Promise<PaymentVoucherRow> {
      return authed<PaymentVoucherRow>("/api/accounting/payment-vouchers", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** MỘT phiếu chi cho NHIỀU khoản của CÙNG một NCC (17/10/2026). Một khoản ⇒ phiếu lẻ thường. */
    createVoucherGop(token: string, input: PhieuChiGopInput): Promise<PaymentVoucherRow> {
      return authed<PaymentVoucherRow>("/api/accounting/payment-vouchers/gop", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** Chi MỘT LƯỢT cho nhiều phiếu tạm ứng / lương đợt 1 đã duyệt ⇒ MỘT phiếu chi cho cả lô
     *  (chủ chốt 25/09/2026; `vouchers` luôn một phần tử). Số tiền = tổng lô, người nhận "Theo bảng
     *  kê đính kèm (N người)" — server tự điền; lô một người thì như lập lẻ. */
    createVouchersFromAdvances(
      token: string,
      input: {
        salary_advance_ids: number[];
        voucher_type: PaymentVoucherType;
        voucher_date: string;
        company_bank_account_id?: number | null;
        note?: string | null;
      },
    ): Promise<VoucherBatchResult> {
      return authed<VoucherBatchResult>("/api/accounting/payment-vouchers/from-advances", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** Bảng kê đính kèm phiếu chi tạm ứng (từng người · số tiền · tài khoản) — để in. */
    bangKeTamUng(token: string, voucherId: number): Promise<BangKeTamUng> {
      return authed<BangKeTamUng>(`/api/accounting/payment-vouchers/${voucherId}/bang-ke-tam-ung`, token);
    },
    /** Lập phiếu chi TỪ một phiếu tạm ứng lương ĐÃ DUYỆT (chủ chốt 18/08/2026). Dùng ở tab Tạm ứng
     *  bên màn Lương — kế toán bấm TAY, KHÔNG tự sinh lúc duyệt tạm ứng (từ 04/08/2026 hệ này
     *  tách "người đồng ý chi" khỏi "người viết phiếu chi", đừng gộp lại).
     *
     *  Cùng endpoint với phiếu chi mua hàng, chỉ khác ở `salary_advance_id`. Bốn khoá cứng dưới
     *  đây do luồng quy định, không phải ô cho người dùng chọn:
     *    • `source_type` = salary_advance   • `payment_stage` = other (không có "đợt" nào)
     *    • VND + tỷ giá 1 (lương trả nội tệ)
     *  Phiếu sinh ra là `paid` NGAY — lập phiếu chi = tiền đã ra, không có bước "chờ chi".
     *
     *  Lỗi: 409 = tạm ứng ĐÃ có phiếu chi · 422 = tạm ứng chưa duyệt / thiếu ô / ngày tương lai ·
     *  404 = không tìm thấy. `detail` là câu tiếng Việt đầy đủ — hiện NGUYÊN CÂU cho người dùng. */
    createVoucherFromAdvance(
      token: string,
      input: SalaryAdvanceVoucherInput,
    ): Promise<PaymentVoucherRow> {
      return api.accounting.createVoucher(token, {
        ...input,
        source_type: "salary_advance",
        payment_stage: "other",
        currency: "VND",
        exchange_rate: 1,
      });
    },
    // ĐÃ GỠ 07/08/2026 — `updateVoucher`. Phiếu chi phát hành ra là tiền đã rời két, không
    // sửa; endpoint PUT bên server cũng đã gỡ. Sai thì `cancelVoucher` rồi lập phiếu mới.
    // ĐÃ GỠ 06/08/2026 — `markVoucherPaid()` (`POST .../mark-paid`). Lập phiếu chi NAY LÀ hành vi
    // chi tiền, không còn khoảng "chờ chi" ở giữa để mà xác nhận (Đ1). Endpoint đã bị gỡ khỏi
    // backend; gọi lại là 404.
    cancelVoucher(token: string, id: number, reason: string): Promise<PaymentVoucherRow> {
      return authed<PaymentVoucherRow>(`/api/accounting/payment-vouchers/${id}/cancel`, token, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    },
    receipt(token: string, id: number): Promise<PaymentReceiptRow> {
      return authed<PaymentReceiptRow>(`/api/accounting/payment-receipts/${id}`, token);
    },
    receipts(
      token: string,
      params: Omit<LocPhieu, "status"> & {
        status?: string | null;
        payment_voucher_id?: number | null;
        source_type?: PaymentReceiptSource | null;
      } = {},
    ): Promise<PaymentReceiptListOut> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.status) qs.set("status", params.status);
      if (params.payment_voucher_id != null)
        qs.set("payment_voucher_id", String(params.payment_voucher_id));
      if (params.source_type) qs.set("source_type", params.source_type);
      if (params.sort) qs.set("sort", params.sort);
      if (params.page) qs.set("page", String(params.page));
      if (params.size) qs.set("size", String(params.size));
      themLocPhieuVaoQuery(qs, params);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return authed<PaymentReceiptListOut>(`/api/accounting/payment-receipts${suffix}`, token);
    },
    createReceipt(
      token: string,
      voucherId: number,
      input: PaymentReceiptInput,
    ): Promise<PaymentReceiptRow> {
      return authed<PaymentReceiptRow>(
        `/api/accounting/payment-vouchers/${voucherId}/receipts`,
        token,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    createOtherReceipt(token: string, input: PaymentReceiptInput): Promise<PaymentReceiptRow> {
      return authed<PaymentReceiptRow>(`/api/accounting/payment-receipts`, token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** Nhà cung cấp hoàn tiền — nút ở ngăn Công nợ phải trả (12/10/2026). */
    createSupplierRefundReceipt(
      token: string,
      supplierId: number,
      input: PaymentReceiptInput,
    ): Promise<PaymentReceiptRow> {
      return authed<PaymentReceiptRow>(`/api/accounting/payables/${supplierId}/refund-receipts`, token, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    updateReceipt(
      token: string,
      id: number,
      input: PaymentReceiptInput,
    ): Promise<PaymentReceiptRow> {
      return authed<PaymentReceiptRow>(`/api/accounting/payment-receipts/${id}`, token, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    markReceiptReceived(
      token: string,
      id: number,
      bankReference: string | null,
    ): Promise<PaymentReceiptRow> {
      return authed<PaymentReceiptRow>(
        `/api/accounting/payment-receipts/${id}/mark-received`,
        token,
        { method: "POST", body: JSON.stringify({ bank_reference: bankReference }) },
      );
    },
    cancelReceipt(token: string, id: number, reason: string): Promise<PaymentReceiptRow> {
      return authed<PaymentReceiptRow>(`/api/accounting/payment-receipts/${id}/cancel`, token, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    },
    receiptAttachments(
      token: string,
      receiptId: number,
    ): Promise<{ items: PaymentReceiptAttachment[] }> {
      return authed<{ items: PaymentReceiptAttachment[] }>(
        `/api/accounting/payment-receipts/${receiptId}/attachments`,
        token,
      );
    },
    uploadReceiptAttachment(
      token: string,
      receiptId: number,
      file: File,
    ): Promise<PaymentReceiptAttachment> {
      const form = new FormData();
      form.append("file", file);
      return authed<PaymentReceiptAttachment>(
        `/api/accounting/payment-receipts/${receiptId}/attachments`,
        token,
        { method: "POST", body: form },
      );
    },
    deleteReceiptAttachment(
      token: string,
      receiptId: number,
      attachmentId: number,
    ): Promise<void> {
      return authed<void>(
        `/api/accounting/payment-receipts/${receiptId}/attachments/${attachmentId}`,
        token,
        { method: "DELETE" },
      );
    },
    voucherAttachments(
      token: string,
      voucherId: number,
    ): Promise<{ items: PaymentVoucherAttachment[] }> {
      return authed<{ items: PaymentVoucherAttachment[] }>(
        `/api/accounting/payment-vouchers/${voucherId}/attachments`,
        token,
      );
    },
    uploadVoucherAttachment(
      token: string,
      voucherId: number,
      file: File,
    ): Promise<PaymentVoucherAttachment> {
      const form = new FormData();
      form.append("file", file);
      return authed<PaymentVoucherAttachment>(
        `/api/accounting/payment-vouchers/${voucherId}/attachments`,
        token,
        { method: "POST", body: form },
      );
    },
    deleteVoucherAttachment(
      token: string,
      voucherId: number,
      attachmentId: number,
    ): Promise<void> {
      return authed<void>(
        `/api/accounting/payment-vouchers/${voucherId}/attachments/${attachmentId}`,
        token,
        { method: "DELETE" },
      );
    },
  },

  // --- Sản xuất: Lệnh sản xuất (LSX) ---------------------------------------

  // --- Tiêu chí KCS (danh mục hai ô: công đoạn | tiêu chí) ----------------------------------
  // Nền CRUD chung `/api/san-xuat-kcs-tieu-chi` (POST "" · PUT /{id} · DELETE /{id}), thêm
  // `GET /khai-bao` (mọi công đoạn kèm tiêu chí), `PUT /sap-xep` (kéo thả), `POST /chep`.
  kcsHangMuc: {
    /** `q` tìm tương đối ở máy chủ: mã/tên công đoạn hoặc câu chữ tiêu chí. */
    khaiBao(token: string, q?: string): Promise<KcsKhaiBao> {
      const s = new URLSearchParams();
      if (q) s.set("q", q);
      return authed<KcsKhaiBao>(
        `/api/san-xuat-kcs-tieu-chi/khai-bao${s.toString() ? `?${s}` : ""}`, token,
      );
    },
    /** `ids` = thứ tự MỚI của TOÀN BỘ tiêu chí công đoạn (lệch tập id ⇒ 422). */
    sapXep(token: string, cong_doan_id: number, ids: number[]): Promise<{ cong_doan_id: number; hang_muc: KcsHangMuc[] }> {
      return authed("/api/san-xuat-kcs-tieu-chi/sap-xep", token, {
        method: "PUT", body: JSON.stringify({ cong_doan_id, ids }),
      });
    },
    /** Chép CÂU CHỮ (bản đã soạn trong hộp) sang nhiều công đoạn — một giao dịch, câu đã có bỏ qua. */
    chep(token: string, den_cong_doan_ids: number[], tieu_chi: string[]): Promise<KcsChepKetQua> {
      return authed<KcsChepKetQua>("/api/san-xuat-kcs-tieu-chi/chep", token, {
        method: "POST", body: JSON.stringify({ den_cong_doan_ids, tieu_chi }),
      });
    },
    tao(token: string, body: KcsHangMucBody): Promise<KcsHangMuc> {
      return authed<KcsHangMuc>("/api/san-xuat-kcs-tieu-chi", token, {
        method: "POST", body: JSON.stringify(body),
      });
    },
    sua(token: string, id: number, body: KcsHangMucBody): Promise<KcsHangMuc> {
      return authed<KcsHangMuc>(`/api/san-xuat-kcs-tieu-chi/${id}`, token, {
        method: "PUT", body: JSON.stringify(body),
      });
    },
    xoa(token: string, id: number): Promise<void> {
      return authed<void>(`/api/san-xuat-kcs-tieu-chi/${id}`, token, { method: "DELETE" });
    },
  },

  // --- Công đoạn (danh mục, lite cho dropdown) -----------------------------
  congDoan: {
    // size ≤ 200 — router chặn `le=200`, gửi 500 là 422 (đừng nâng lại).
    // `active=true` — chỉ đổ công đoạn ĐANG DÙNG vào các ô chọn (tính giá + lệnh SX). Món đã
    // "Ngừng dùng" (active=false) phải BIẾN khỏi dropdown đúng như hộp thoại ngừng-dùng hứa;
    // không truyền cờ này thì backend trả CẢ món đã ngừng (repo lọc `if active is not None`).
    // Bước lệnh SX đang lỡ dùng món đã ngừng vẫn hiện đúng: drawer tự ghim lại option đó.
    list(token: string): Promise<{ items: CongDoanLite[] }> {
      return authed<{ items: CongDoanLite[] }>("/api/cong-doan?size=200&active=true", token);
    },
  },

  // --- Kho: đề nghị · phiếu nhập/xuất · ngưỡng tồn (spec-kho-de-nghi) -------
  // Gom 3 prefix `/api/kho/de-nghi`, `/api/kho/phieu`, `/api/kho/nguong-ton` vào một
  // namespace vì chúng là MỘT luồng (đề nghị → phiếu → lô). Khai báo kho (`/api/kho`) vẫn
  // đi qua `crud()` của rebuildCatalog — đó là danh mục, không phải chứng từ.
  /** DANH MỤC GỐC — hai cửa Kho + NCC dùng chung để chọn mặt hàng và chọn đơn vị.
   *  Thay `kho.deNghi.vatTu` cũ (đọc bảng `materials` riêng của kho). */
  matHang: {
    tim(
      token: string,
      q?: string | null,
      size = 20,
      chiCoNhaCungCap = false,
    ): Promise<MatHangOption[]> {
      const qs = new URLSearchParams({ size: String(size) });
      if (q) qs.set("q", q);
      if (chiCoNhaCungCap) qs.set("chi_co_nha_cung_cap", "true");
      return authed<MatHangOption[]>(`/api/vat-lieu-kho/mat-hang?${qs.toString()}`, token);
    },
    /** Đơn vị gốc + mọi đơn vị đổi được — danh sách TỰ THÍCH NGHI theo từng mặt hàng. */
    /** Đơn vị của MỘT mặt hàng. Các lời gọi trong CÙNG một nhịp (vd. mỗi dòng của form bảng giá
     *  tự gọi khi mở) được GỘP thành một request `/mat-hang/don-vi-lo` — xem `gomDonVi`. */
    donVi(token: string, hangLoai: HangLoai, hangId: number, goc?: string | null): Promise<DonViCuaMatHang> {
      // Giấy / vật tư khác đã CHỐT đơn vị gốc (vd. dòng nhập lại theo lô "to") ⇒ chỉ nhóm đó, không
      // đi đường gộp lô. Không gửi `goc` ⇒ mã khai từ hai đơn vị trở lên nhận bản GỘP nhóm của mọi
      // đơn vị đã khai, mỗi dòng `ds` mang `goc` của nhóm nó.
      if ((hangLoai === "giay" || hangLoai === "vat_tu") && goc) {
        return authed<DonViCuaMatHang>(
          `/api/vat-lieu-kho/mat-hang/${hangLoai}/${hangId}/don-vi?goc=${encodeURIComponent(goc)}`, token,
        );
      }
      return gomDonVi(token, hangLoai, hangId);
    },
    /** Các NCC bán mặt hàng này, giá đã quy về đơn vị gốc — dòng cùng họ đơn vị đứng trước, rẻ
     *  nhất đứng đầu. */
    soGia(
      token: string, hangLoai: HangLoai, hangId: number,
      /** Giấy (10/10/2026): chỉ so dòng ĐÚNG khổ; `don_vi` = ĐVT dòng đang mua để máy chủ đánh
       *  dấu `cung_ho`. */
      theo?: { don_vi?: string | null; kho_rong?: number; kho_dai?: number },
    ): Promise<SoGiaOut> {
      const qs = new URLSearchParams({ hang_loai: hangLoai, hang_id: String(hangId) });
      if (theo) {
        if (theo.don_vi) qs.set("don_vi", theo.don_vi);
        if (theo.kho_rong) qs.set("kho_rong", String(theo.kho_rong));
        if (theo.kho_dai) qs.set("kho_dai", String(theo.kho_dai));
      }
      return authed<SoGiaOut>(`/api/supplier-items/so-gia?${qs.toString()}`, token);
    },
    /** Gắn/đổi ẢNH minh hoạ mặt hàng (chỉ vai có quyền sửa danh mục dm_giay/dm_vat_tu). */
    uploadAnh(token: string, hangLoai: HangLoai, hangId: number, file: File): Promise<{ anh_url: string | null }> {
      const form = new FormData();
      form.append("file", file);
      return authed<{ anh_url: string | null }>(
        `/api/vat-lieu-kho/${hangLoai}/${hangId}/anh`, token, { method: "POST", body: form },
      );
    },
    /** Gỡ ảnh minh hoạ mặt hàng. */
    xoaAnh(token: string, hangLoai: HangLoai, hangId: number): Promise<{ anh_url: string | null }> {
      return authed<{ anh_url: string | null }>(
        `/api/vat-lieu-kho/${hangLoai}/${hangId}/anh`, token, { method: "DELETE" },
      );
    },
  },

  kho: {
    deNghi: {
      /** Số yêu cầu ĐÃ DUYỆT chờ kho lập phiếu (badge Nhập/Xuất, việc của thủ kho) + phản hồi kho cho
       *  yêu cầu CỦA TÔI mà tôi chưa mở xem: `done_unseen` (Hoàn tất) + `fail_unseen` (Không thành).
       *  Badge người tạo = done_unseen + fail_unseen. */
      counts(
        token: string,
      ): Promise<{ nhap: number; xuat: number; dieu_chuyen: number; done_unseen: number; fail_unseen: number }> {
        return authed("/api/kho/de-nghi/counts", token);
      },
      /** NGƯỜI TẠO mở xem 1 yêu cầu của mình → đánh dấu đã xem → hạ badge/số đỏ đúng yêu cầu đó. */
      markSeen(token: string, id: number): Promise<void> {
        return authed(`/api/kho/de-nghi/${id}/seen`, token, { method: "POST" });
      },
      /** NGƯỜI TẠO đang xem danh sách yêu cầu → mọi phản hồi kho của họ thành đã xem. */
      seenAll(token: string): Promise<void> {
        return authed("/api/kho/de-nghi/seen-all", token, { method: "POST" });
      },
      list(token: string, params: StockRequestListParams = {}): Promise<StockRequestPage> {
        const qs = stockRequestQS(params);
        if (params.order) qs.set("order", params.order);
        if (params.page) qs.set("page", String(params.page));
        if (params.size) qs.set("size", String(params.size));
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        return authed<StockRequestPage>(`/api/kho/de-nghi${suffix}`, token);
      },
      /** Đếm yêu cầu theo TỪNG trạng thái (cùng bộ lọc list, trừ tab) → FE cộng theo tab cho badge.
       *  `trang_thai` ở đây là TẬP NỀN (vd Hộp yêu cầu truyền INBOX_STATUSES). */
      tabCounts(token: string, params: StockRequestListParams = {}): Promise<Record<string, number>> {
        const qs = stockRequestQS(params);
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        return authed<Record<string, number>>(`/api/kho/de-nghi/counts-by-status${suffix}`, token);
      },
      /** Giá trị điều kiện lọc Phòng ban yêu cầu / Người yêu cầu / Kho / Nguồn — trong tầm nhìn, cả Nhập lẫn Xuất. */
      locGiaTri(
        token: string, truong: "bo-phan" | "to" | "nguoi-yeu-cau" | "kho" | "nguon" | "lenh" | "vat-tu",
        dieuChuyen: boolean,
      ): Promise<(Omit<LuaChonLoc, "id"> & { id: number | string })[]> {
        // Nguồn trả `id` là mã chữ ("kcs", "giao_hang"…), Vật tư trả khoá "giay:12"; còn lại id số.
        const qs = new URLSearchParams({ dieu_chuyen: String(dieuChuyen) });
        return authed(`/api/kho/de-nghi/loc-${truong}?${qs.toString()}`, token);
      },
      get(token: string, id: number, khoId?: number | null): Promise<StockRequest> {
        const suffix = khoId != null ? `?kho_id=${khoId}` : "";
        return authed<StockRequest>(`/api/kho/de-nghi/${id}${suffix}`, token);
      },
      create(token: string, body: StockRequestInput): Promise<StockRequest> {
        return authed<StockRequest>("/api/kho/de-nghi", token, {
          method: "POST",
          body: JSON.stringify(body),
        });
      },
      update(token: string, id: number, body: StockRequestUpdateInput): Promise<StockRequest> {
        return authed<StockRequest>(`/api/kho/de-nghi/${id}`, token, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      },
      submit(token: string, id: number): Promise<StockRequest> {
        return authed<StockRequest>(`/api/kho/de-nghi/${id}/trinh-duyet`, token, { method: "POST" });
      },
      /** `approved_qty`: line_id → SL duyệt. Gửi cho MỌI dòng (0 = không duyệt dòng đó). */
      approve(token: string, id: number, approvedQty: Record<number, number>): Promise<StockRequest> {
        return authed<StockRequest>(`/api/kho/de-nghi/${id}/duyet`, token, {
          method: "POST",
          body: JSON.stringify({ approved_qty: approvedQty }),
        });
      },
      reject(token: string, id: number, lyDo: string): Promise<StockRequest> {
        return authed<StockRequest>(`/api/kho/de-nghi/${id}/tu-choi`, token, {
          method: "POST",
          body: JSON.stringify({ ly_do: lyDo }),
        });
      },
      cancel(token: string, id: number): Promise<StockRequest> {
        return authed<StockRequest>(`/api/kho/de-nghi/${id}/huy`, token, { method: "POST" });
      },
      /** Kho HỦY đề nghị (quyết định KHÔNG lập phiếu) — kèm lý do; gác `create`. */
      cancelByKho(token: string, id: number, lyDo: string): Promise<StockRequest> {
        return authed<StockRequest>(`/api/kho/de-nghi/${id}/huy-kho`, token, {
          method: "POST",
          body: JSON.stringify({ ly_do: lyDo }),
        });
      },
      /** Kho bấm "Tiếp nhận" (gác bằng `create`, không phải `approve` — kho không duyệt). */
      receive(token: string, id: number): Promise<StockRequest> {
        return authed<StockRequest>(`/api/kho/de-nghi/${id}/tiep-nhan`, token, { method: "POST" });
      },
      prepare(token: string, id: number): Promise<StockRequest> {
        return authed<StockRequest>(`/api/kho/de-nghi/${id}/chuan-bi`, token, { method: "POST" });
      },
      /** Gợi ý "Kho (xuất từ)" khi lập phiếu XUẤT: kho có nhiều hàng nhất theo thứ tự dòng yêu
       *  cầu. `kho_id === null` = không kho nào còn hàng → FE giữ nguyên kho đang chọn. */
      goiYKho(token: string, id: number): Promise<{ kho_id: number | null }> {
        return authed<{ kho_id: number | null }>(`/api/kho/de-nghi/${id}/goi-y-kho`, token);
      },
      /** Gợi ý SL từ lịch sử đề nghị của bộ phận; `so_luong === null` = chưa đủ dữ liệu. */
      goiYSoLuong(
        token: string, hangLoai: HangLoai, hangId: number,
      ): Promise<{ so_luong: number | null }> {
        const qs = new URLSearchParams({ hang_loai: hangLoai, hang_id: String(hangId) });
        return authed<{ so_luong: number | null }>(
          `/api/kho/de-nghi/goi-y/so-luong?${qs.toString()}`, token,
        );
      },
    },

    phieu: {
      list(token: string, params: StockVoucherListParams = {}): Promise<StockVoucherPage> {
        const qs = new URLSearchParams();
        if (params.q) qs.set("q", params.q);
        if (params.loai) qs.set("loai", params.loai);
        if (params.trang_thai) qs.set("trang_thai", params.trang_thai);
        if (params.request_id != null) qs.set("request_id", String(params.request_id));
        if (params.kho_id != null) qs.set("kho_id", String(params.kho_id));
        ganThamSoLoc(qs, params.loc);
        if (params.page) qs.set("page", String(params.page));
        if (params.size) qs.set("size", String(params.size));
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        return authed<StockVoucherPage>(`/api/kho/phieu${suffix}`, token);
      },
      /** Giá trị điều kiện "Người lập" của danh sách phiếu một kho (kèm số phiếu). */
      locNguoiLap(token: string, khoId: number): Promise<LuaChonLoc[]> {
        return authed<LuaChonLoc[]>(`/api/kho/phieu/loc-nguoi-lap?kho_id=${khoId}`, token);
      },
      get(token: string, id: number): Promise<StockVoucher> {
        return authed<StockVoucher>(`/api/kho/phieu/${id}`, token);
      },
      create(token: string, body: StockVoucherInput): Promise<StockVoucher> {
        return authed<StockVoucher>("/api/kho/phieu", token, {
          method: "POST",
          body: JSON.stringify(body),
        });
      },
      /** Ấn ĐIỀU CHUYỂN: server tự XUẤT nguồn (ghi sổ ngay, trừ tồn, chốt giá vốn bình quân) +
       *  tạo YÊU CẦU ĐIỀU CHUYỂN (NHẬP) ở đích. Kho đích lập phiếu nhập (đơn giá khoá) như nhập thường. */
      dieuChuyen(token: string, body: DieuChuyenInput): Promise<DieuChuyenResult> {
        return authed<DieuChuyenResult>("/api/kho/dieu-chuyen", token, {
          method: "POST",
          body: JSON.stringify(body),
        });
      },
      /** Ghi sổ — điểm DUY NHẤT tồn kho thay đổi; sau đó phiếu không sửa được nữa. */
      ghiSo(token: string, id: number): Promise<StockVoucher> {
        return authed<StockVoucher>(`/api/kho/phieu/${id}/ghi-so`, token, { method: "POST" });
      },
      /** Điều chỉnh phiếu XUẤT đã ghi sổ khi SX dùng ÍT hơn (xuất 10 → 7): trả phần dư về lô nguồn,
       *  giảm 'đã cấp' của yêu cầu. `lines` = các dòng GIẢM (line_id → số lượng mới). */
      dieuChinhXuat(
        token: string, id: number, lines: { line_id: number; so_luong_moi: number }[], lyDo: string,
      ): Promise<StockVoucher> {
        return authed<StockVoucher>(`/api/kho/phieu/${id}/dieu-chinh-xuat`, token, {
          method: "POST",
          body: JSON.stringify({ lines, ly_do: lyDo }),
        });
      },
      /** Lịch sử điều chỉnh của 1 phiếu xuất (ai · bộ phận · lúc nào · đổi gì) — mới nhất trước. */
      lichSuDieuChinh(token: string, id: number): Promise<DieuChinhLichSu[]> {
        return authed<DieuChinhLichSu[]>(`/api/kho/phieu/${id}/lich-su-dieu-chinh`, token);
      },
      /** Hủy phiếu nháp — BẮT BUỘC lý do; đề nghị chuyển "Đã hủy" kèm lý do (kết thúc). */
      huy(token: string, id: number, lyDo: string): Promise<StockVoucher> {
        return authed<StockVoucher>(`/api/kho/phieu/${id}/huy`, token, {
          method: "POST",
          body: JSON.stringify({ ly_do: lyDo }),
        });
      },
      /** Kho BỔ SUNG khổ cho lô giấy chưa có khổ (`kho_rong == 0`). Chỉ GHI KHỔ — số lượng, đơn vị
       *  và giá của lô giữ nguyên (tờ và kg không quy đổi nên không có gì để đổi). */
      boSungKhoLo(
        token: string,
        lotId: number,
        body: { kho_rong: number; kho_dai: number },
      ): Promise<{ id: number; don_vi_goc: string; kho_rong: number; kho_dai: number;
        sl_ban_dau: number; sl_con_lai: number }> {
        return authed(`/api/kho/phieu/lo/${lotId}/kho`, token, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      },
      /** Sửa VỊ TRÍ cất lô (kệ/ô) — từ drawer Lịch sử của sản phẩm. Quyền `create` (thủ kho). */
      suaViTriLo(
        token: string,
        lotId: number,
        viTri: string | null,
      ): Promise<{ id: number; vi_tri: string | null }> {
        return authed<{ id: number; vi_tri: string | null }>(
          `/api/kho/phieu/lo/${lotId}/vi-tri`,
          token,
          { method: "PATCH", body: JSON.stringify({ vi_tri: viTri }) },
        );
      },
      /** Sửa GIÁ GỐC thành phẩm từ KCS (gõ trên lô gốc hay lô con đều được — lan cả họ). `view_cost`. */
      suaGiaGoc(token: string, lotId: number, donGia: number): Promise<GiaGocKetQua> {
        return authed<GiaGocKetQua>(`/api/kho/phieu/lo/${lotId}/gia-goc`, token, {
          method: "PATCH",
          body: JSON.stringify({ don_gia: donGia }),
        });
      },
      /** Khai VỊ TRÍ cất lô cho DÒNG phiếu NHẬP còn NHÁP (điều chuyển đích) — trước khi ghi sổ. */
      suaViTriDong(
        token: string,
        voucherId: number,
        lines: { line_id: number; vi_tri: string | null }[],
      ): Promise<{ ok: boolean }> {
        return authed<{ ok: boolean }>(`/api/kho/phieu/${voucherId}/vi-tri`, token, {
          method: "PATCH",
          body: JSON.stringify({ lines }),
        });
      },
      /** Gợi ý lấy hàng từ lô nào (FEFO → FIFO). `thieu` > 0 = kho không đủ hàng. */
      goiYLo(
        token: string,
        params: {
          hang_loai: HangLoai; hang_id: number; kho_id: number; so_luong: number; request_id?: number | null;
          /** Giấy: chỉ lấy lô đúng đơn vị gốc (+ đúng khổ khi có khổ). */
          goc?: string | null; kho_rong?: number; kho_dai?: number;
        },
      ): Promise<StockAllocation> {
        // `so_luong` ở ĐƠN VỊ GỐC — lô lưu theo đơn vị đó, gửi số theo đơn vị người khai là lệch.
        const qs = new URLSearchParams({
          hang_loai: params.hang_loai,
          hang_id: String(params.hang_id),
          kho_id: String(params.kho_id),
          so_luong: String(params.so_luong),
        });
        // Yêu cầu xuất do Giao hàng gửi ⇒ máy chủ ưu tiên lô của đúng đơn, bỏ lô của khách khác.
        if (params.request_id != null) qs.set("request_id", String(params.request_id));
        datLocGiay(qs, params);
        return authed<StockAllocation>(`/api/kho/phieu/lo/goi-y?${qs.toString()}`, token);
      },
      danhSachLo(
        token: string,
        params: {
          hang_loai?: HangLoai | null; hang_id?: number | null; kho_id?: number | null; con_hang?: boolean;
          /** Giấy: chỉ liệt kê lô đúng đơn vị gốc (+ đúng khổ khi có khổ). */
          goc?: string | null; kho_rong?: number; kho_dai?: number;
          /** Màn đang gọi — máy chủ áp ô "Xem giá thành" của màn đó (mặc định: dòng của từng kho). */
          man?: ManKho;
          /** Cùng kho_id: lô còn hàng + MỘT lô gần nhất cho mặt hàng đã hết (màn Tồn kho) — thay
           *  `con_hang: false` vốn trả mọi lô từng có. */
          dai_dien_het?: boolean;
        },
      ): Promise<StockLot[]> {
        const qs = new URLSearchParams();
        if (params.man) qs.set("man", params.man);
        if (params.dai_dien_het) qs.set("dai_dien_het", "true");
        datLocGiay(qs, params);
        if (params.hang_loai && params.hang_id != null) {
          qs.set("hang_loai", params.hang_loai);
          qs.set("hang_id", String(params.hang_id));
        }
        if (params.kho_id != null) qs.set("kho_id", String(params.kho_id));
        qs.set("con_hang", String(params.con_hang ?? true));
        return authed<StockLot[]>(`/api/kho/phieu/lo/danh-sach?${qs.toString()}`, token);
      },
      /** Một trang màn Tồn kho của MỘT kho: máy chủ gom lô theo mặt hàng, lọc, đếm 5 nhóm, cắt trang. */
      tonNhom(
        token: string,
        params: {
          kho_id: number; page: number; size: number; q?: string; nhom?: NhomTon;
          ngay_tu?: string; ngay_den?: string; ton_tu?: string; ton_den?: string;
          /** Giá trị tồn — máy chủ chỉ áp khi người gọi thấy giá kho này. */
          gt_tu?: string; gt_den?: string;
          /** Chỉ các dòng của MỘT mặt hàng (nạp lại dòng đang mở nằm ngoài trang). */
          hang_loai?: HangLoai; hang_id?: number;
        },
      ): Promise<TonNhomPage> {
        const qs = new URLSearchParams({ kho_id: String(params.kho_id), page: String(params.page), size: String(params.size) });
        if (params.q?.trim()) qs.set("q", params.q.trim());
        if (params.nhom && params.nhom !== "all") qs.set("nhom", params.nhom);
        for (const k of ["ngay_tu", "ngay_den", "ton_tu", "ton_den", "gt_tu", "gt_den"] as const) {
          const v = params[k]?.trim();
          if (v) qs.set(k, v);
        }
        if (params.hang_loai && params.hang_id) {
          qs.set("hang_loai", params.hang_loai);
          qs.set("hang_id", String(params.hang_id));
        }
        return authed<TonNhomPage>(`/api/kho/phieu/lo/ton-nhom?${qs.toString()}`, token);
      },
      /** Dự báo tồn cho các dòng màn Tồn kho của MỘT kho: lệnh sắp lĩnh (thứ tự ăn tồn của bảng
       *  cân đối vật tư), hàng đang về, phiếu mua đang chạy. Số theo đơn vị GỐC; không có tiền. */
      duBao(token: string, khoId: number): Promise<DuBaoTonRow[]> {
        return authed<DuBaoTonRow[]>(`/api/kho/phieu/lo/du-bao?kho_id=${khoId}`, token);
      },
      /** Tồn TOÀN XƯỞNG của một mặt hàng tách theo khổ + đơn vị gốc — cột Tồn, gợi ý khổ ở form yêu cầu.
       *  Không có quyền xem tồn ⇒ 403, nơi gọi ẩn cột. */
      tonKhoa(token: string, hangLoai: HangLoai, hangId: number): Promise<TonKhoaRow[]> {
        const qs = new URLSearchParams({ hang_loai: hangLoai, hang_id: String(hangId) });
        return authed<TonKhoaRow[]>(`/api/kho/phieu/lo/ton-khoa?${qs.toString()}`, token);
      },
      /** Lịch sử Nhập (lô) + Xuất (dòng phiếu xuất đã ghi sổ) của 1 mã hàng tại 1 kho. */
      lichSuVatTu(
        token: string,
        hangLoai: HangLoai,
        hangId: number,
        khoId: number,
        /** Giấy: lọc đúng một dòng tồn (khổ + đơn vị gốc) — một mã có thể nhiều dòng. */
        giay?: DongTonGiay,
        /** Màn đang gọi — máy chủ áp ô "Xem giá thành" của màn đó. */
        man: ManKho = "ton",
      ): Promise<StockMaterialHistory> {
        const qs = new URLSearchParams({ kho_id: String(khoId), man });
        if (giay) {
          if (giay.goc) qs.set("goc", giay.goc);
          qs.set("kho_rong", String(giay.kho_rong));
          qs.set("kho_dai", String(giay.kho_dai));
        }
        return authed<StockMaterialHistory>(
          `/api/kho/phieu/mat-hang/${hangLoai}/${hangId}/lich-su?${qs.toString()}`,
          token,
        );
      },
      /** Một trang của một tab ngăn mặt hàng (Lô tồn / Nhập / Xuất / Chuyển kho), cắt ở máy chủ. */
      lichSuTrang(
        token: string,
        hangLoai: HangLoai,
        hangId: number,
        khoId: number,
        tab: TabLichSuMatHang,
        page: number,
        size: number,
        giay?: DongTonGiay,
      ): Promise<StockMaterialHistoryPage> {
        const qs = new URLSearchParams({ kho_id: String(khoId), tab, page: String(page), size: String(size) });
        if (giay) {
          if (giay.goc) qs.set("goc", giay.goc);
          qs.set("kho_rong", String(giay.kho_rong));
          qs.set("kho_dai", String(giay.kho_dai));
        }
        return authed<StockMaterialHistoryPage>(
          `/api/kho/phieu/mat-hang/${hangLoai}/${hangId}/lich-su-trang?${qs.toString()}`,
          token,
        );
      },
      /** Tổng xuất THƯỜNG `soNgay` ngày qua của một dòng tồn (hộp đặt ngưỡng tính bình quân). */
      tongXuat(
        token: string,
        hangLoai: HangLoai,
        hangId: number,
        khoId: number,
        soNgay: number,
        giay?: DongTonGiay,
      ): Promise<{ so_ngay: number; tong: number }> {
        const qs = new URLSearchParams({ kho_id: String(khoId), so_ngay: String(soNgay) });
        if (giay) {
          if (giay.goc) qs.set("goc", giay.goc);
          qs.set("kho_rong", String(giay.kho_rong));
          qs.set("kho_dai", String(giay.kho_dai));
        }
        return authed<{ so_ngay: number; tong: number }>(
          `/api/kho/phieu/mat-hang/${hangLoai}/${hangId}/tong-xuat?${qs.toString()}`,
          token,
        );
      },
      /** Mã QR đã ký cho tem dán kệ (in tem CẦN đăng nhập). FE nhúng vào link `#s=<token>`. */
      qrToken(
        token: string,
        khoId: number,
        hangLoai: HangLoai,
        hangId: number,
      ): Promise<{ token: string }> {
        const qs = new URLSearchParams({ kho_id: String(khoId) });
        return authed<{ token: string }>(
          `/api/kho/phieu/mat-hang/${hangLoai}/${hangId}/qr-token?${qs.toString()}`,
          token,
        );
      },
      // --- Đính kèm hóa đơn/chứng từ gốc (ảnh hoặc PDF, ≤10MB) ---
      attachments(token: string, id: number): Promise<{ items: StockVoucherAttachment[] }> {
        return authed<{ items: StockVoucherAttachment[] }>(`/api/kho/phieu/${id}/attachments`, token);
      },
      uploadAttachment(token: string, id: number, file: File): Promise<StockVoucherAttachment> {
        const form = new FormData();
        form.append("file", file);
        return authed<StockVoucherAttachment>(`/api/kho/phieu/${id}/attachments`, token, {
          method: "POST",
          body: form,
        });
      },
      deleteAttachment(token: string, id: number, attachmentId: number): Promise<void> {
        return authed<void>(`/api/kho/phieu/${id}/attachments/${attachmentId}`, token, {
          method: "DELETE",
        });
      },
      /** Xuất Excel báo cáo tồn kho chi tiết (kế toán) — fetch as blob (bearer + refresh-aware). */
      async exportXlsxBlobUrl(token: string, khoId?: number | null, conHang = true): Promise<string> {
        const qs = new URLSearchParams();
        if (khoId != null) qs.set("kho_id", String(khoId));
        qs.set("con_hang", String(conHang));
        const doFetch = (bearer: string) =>
          fetch(`${BASE_URL}/api/kho/phieu/lo/export.xlsx?${qs.toString()}`, {
            credentials: "include", cache: "no-store", headers: authHeader(bearer),
          });
        let resp = await doFetch(token);
        if (resp.status === 401) {
          const fresh = await refreshAccessToken();
          if (fresh) resp = await doFetch(fresh);
        }
        if (!resp.ok) throw new ApiError(`Xuất tệp thất bại (mã ${resp.status}).`, resp.status);
        return URL.createObjectURL(await resp.blob());
      },
    },

    /** Điều chuyển kho — thao tác trên CẢ phiếu điều chuyển (vế xuất nguồn + vế nhập đích). */
    dieuChuyen: {
      /** Hủy CẢ phiếu điều chuyển — chỉ khi chưa ghi sổ (đã ghi sổ → 400). Trả 204. */
      huy(token: string, reqId: number, lyDo: string): Promise<void> {
        return authed<void>(`/api/kho/dieu-chuyen/${reqId}/huy`, token, {
          method: "POST",
          body: JSON.stringify({ ly_do: lyDo }),
        });
      },
      /** Từ 1 phiếu điều chuyển (nhập-đích/xuất-nguồn) → id yêu cầu điều chuyển ĐÍCH, để mở mặt tiền
       *  PHIẾU ĐIỀU CHUYỂN. 404 nếu không phải phiếu điều chuyển. */
      byVoucher(token: string, voucherId: number): Promise<{ request_id: number }> {
        return authed<{ request_id: number }>(`/api/kho/dieu-chuyen/by-voucher/${voucherId}`, token);
      },
    },

    /** Vị trí cất (kệ/ô) khai cho TỪNG kho — danh sách để khai lô chọn dropdown thay vì gõ tay.
     *  ĐỌC mở cho vai chọn kho; THÊM/XÓA gác `dm_kho_hang`. */
    viTri: {
      list(token: string, khoId: number): Promise<{ items: KhoViTriRow[] }> {
        return authed<{ items: KhoViTriRow[] }>(`/api/kho/${khoId}/vi-tri`, token);
      },
      create(
        token: string, khoId: number, body: { ma: string; ghi_chu?: string | null },
      ): Promise<KhoViTriRow> {
        return authed<KhoViTriRow>(`/api/kho/${khoId}/vi-tri`, token, {
          method: "POST",
          body: JSON.stringify(body),
        });
      },
      remove(token: string, id: number): Promise<void> {
        return authed<void>(`/api/kho/vi-tri/${id}`, token, { method: "DELETE" });
      },
    },

    nguongTon: {
      /** `khoId` = chỉ ngưỡng của một kho (màn Tồn kho của kho đó). */
      list(token: string, khoId?: number): Promise<StockThreshold[]> {
        return authed<StockThreshold[]>(`/api/kho/nguong-ton${khoId != null ? `?kho_id=${khoId}` : ""}`, token);
      },
      upsert(token: string, body: StockThresholdInput): Promise<StockThreshold> {
        return authed<StockThreshold>("/api/kho/nguong-ton", token, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      },
    },

    /** Báo cáo kho (kế toán) — sổ nhập-xuất + khóa kỳ + export MISA. Cần quyền close_book. */
    baoCao: {
      dong(token: string, params: BaoCaoKhoParams = {}): Promise<BaoCaoKhoPage> {
        const qs = new URLSearchParams();
        setBaoCaoKhoQs(qs, params);
        if (params.loai) qs.set("loai", params.loai);
        const q = qs.toString();
        return authed<BaoCaoKhoPage>(`/api/kho/bao-cao/dong${q ? `?${q}` : ""}`, token);
      },
      /** Dòng ĐIỀU CHUYỂN đã ghi sổ (Xuất tại kho → Nhập tại kho) — cho tab Chuyển kho. */
      chuyenKho(token: string, params: BaoCaoChuyenKhoParams = {}): Promise<BaoCaoChuyenKhoPage> {
        const qs = new URLSearchParams();
        setBaoCaoKhoQs(qs, params);
        const q = qs.toString();
        return authed<BaoCaoChuyenKhoPage>(`/api/kho/bao-cao/chuyen-kho${q ? `?${q}` : ""}`, token);
      },
      /** Báo cáo Nhập-Xuất-Tồn theo kỳ (bình quân gia quyền cuối kỳ) — 1 dòng / mặt hàng / kho.
       *  Đầu kỳ = snapshot kỳ trước (đã "Tính giá kỳ"); kỳ chưa tính → da_tinh=false (tạm tính). */
      nxt(token: string, params: BaoCaoNXTParams): Promise<BaoCaoNXTPage> {
        const qs = new URLSearchParams({ tu: params.tu, den: params.den });
        if (params.kho_id != null) qs.set("kho_id", String(params.kho_id));
        if (params.q) qs.set("q", params.q);
        setLocThuocTinhQs(qs, params.loc);
        return authed<BaoCaoNXTPage>(`/api/kho/bao-cao/nxt?${qs.toString()}`, token);
      },
      /** Tính giá kỳ (bình quân) kiểu MISA: chốt tồn cuối kỳ vào snapshot để kỳ sau đọc làm đầu kỳ.
       *  Chạy lại được (đè) tới khi khóa sổ. Không đụng phiếu xuất đích danh. */
      tinhGiaKy(token: string, body: TinhGiaKyInput): Promise<BaoCaoNXTPage> {
        return authed<BaoCaoNXTPage>("/api/kho/bao-cao/tinh-gia-ky", token, {
          method: "POST",
          body: JSON.stringify(body),
        });
      },
      khoaSo(token: string): Promise<KhoKhoaSoRow[]> {
        return authed<KhoKhoaSoRow[]>("/api/kho/khoa-so", token);
      },
      /** Lịch sử các lần XUẤT EXCEL báo cáo kho (gộp vào tab "Lịch sử thao tác"). */
      lichSuExport(token: string): Promise<KhoExportLog[]> {
        return authed<KhoExportLog[]>("/api/kho/bao-cao/lich-su-export", token);
      },
      /** Các kỳ CÒN đang khóa (đã gộp khoảng) — cho tab "Kỳ đã khóa". */
      ky(token: string): Promise<KhoaSoKyRow[]> {
        return authed<KhoaSoKyRow[]>("/api/kho/khoa-so/ky", token);
      },
      /** Các kỳ ĐÃ TÍNH GIÁ (có snapshot) — cho tab "Kỳ đã tính". */
      kyDaTinh(token: string): Promise<KyDaTinh[]> {
        return authed<KyDaTinh[]>("/api/kho/bao-cao/ky-da-tinh", token);
      },
      /** Thành phẩm nhập từ KCS theo lô gốc — mặc định chỉ lô CHƯA có giá gốc. Lọc + trang ở máy chủ. */
      thanhPhamChuaGiaGoc(
        token: string,
        p: {
          q?: string; page?: number; size?: number;
          /** Trạng thái giá gốc: `chua` (mặc định máy chủ) | `co` | `tat_ca`. */
          gia?: "chua" | "co" | "tat_ca";
          /** Khoảng NGÀY NHẬP (YYYY-MM-DD), hai đầu đều tính. */
          tu?: string; den?: string;
          /** Chọn nhiều — khớp một trong các giá trị. */
          khoIds?: number[]; khachHangIds?: number[]; hangIds?: number[];
        } = {},
      ): Promise<ThanhPhamChuaGiaGocPage> {
        const qs = new URLSearchParams();
        if (p.q) qs.set("q", p.q);
        if (p.gia) qs.set("gia", p.gia);
        if (p.tu) qs.set("tu", p.tu);
        if (p.den) qs.set("den", p.den);
        for (const id of p.khoIds ?? []) qs.append("kho_id", String(id));
        for (const id of p.khachHangIds ?? []) qs.append("khach_hang_id", String(id));
        for (const id of p.hangIds ?? []) qs.append("hang_id", String(id));
        qs.set("page", String(p.page ?? 1));
        qs.set("size", String(p.size ?? 50));
        return authed<ThanhPhamChuaGiaGocPage>(`/api/kho/bao-cao/thanh-pham-chua-gia-goc?${qs}`, token);
      },
      setKhoaSo(token: string, body: KhoKhoaSoInput): Promise<KhoKhoaSoRow> {
        return authed<KhoKhoaSoRow>("/api/kho/khoa-so", token, {
          method: "POST",
          body: JSON.stringify(body),
        });
      },
      /** Xuất Excel báo cáo kho theo mẫu MISA (nhập/xuất) — fetch as blob (bearer + refresh-aware). */
      async exportXlsxBlobUrl(
        token: string,
        loai: StockRequestKind,
        params: Omit<BaoCaoKhoParams, "loai"> = {},
      ): Promise<string> {
        const qs = new URLSearchParams();
        qs.set("loai", loai);
        setBaoCaoKhoQs(qs, { ...params, page: null, size: null });
        const doFetch = (bearer: string) =>
          fetch(`${BASE_URL}/api/kho/bao-cao/export.xlsx?${qs.toString()}`, {
            credentials: "include", cache: "no-store", headers: authHeader(bearer),
          });
        let resp = await doFetch(token);
        if (resp.status === 401) {
          const fresh = await refreshAccessToken();
          if (fresh) resp = await doFetch(fresh);
        }
        if (!resp.ok) throw new ApiError(`Xuất tệp thất bại (mã ${resp.status}).`, resp.status);
        return URL.createObjectURL(await resp.blob());
      },
      /** Xuất Excel ĐIỀU CHUYỂN theo mẫu MISA "Chuyển kho" — fetch as blob (bearer + refresh-aware). */
      async chuyenKhoExportXlsxBlobUrl(
        token: string,
        params: BaoCaoChuyenKhoParams = {},
      ): Promise<string> {
        const qs = new URLSearchParams();
        setBaoCaoKhoQs(qs, { ...params, page: null, size: null });
        const doFetch = (bearer: string) =>
          fetch(`${BASE_URL}/api/kho/bao-cao/chuyen-kho/export.xlsx?${qs.toString()}`, {
            credentials: "include", cache: "no-store", headers: authHeader(bearer),
          });
        let resp = await doFetch(token);
        if (resp.status === 401) {
          const fresh = await refreshAccessToken();
          if (fresh) resp = await doFetch(fresh);
        }
        if (!resp.ok) throw new ApiError(`Xuất tệp thất bại (mã ${resp.status}).`, resp.status);
        return URL.createObjectURL(await resp.blob());
      },
      /** Xuất Excel bảng NHẬP-XUẤT-TỒN (mẫu MISA, gom nhóm theo kho + dòng cộng). */
      async nxtExportXlsxBlobUrl(
        token: string,
        params: { tu: string; den: string; kho_id?: number | null; q?: string; loc?: LocThuocTinhKho },
      ): Promise<string> {
        const qs = new URLSearchParams();
        qs.set("tu", params.tu);
        qs.set("den", params.den);
        if (params.kho_id != null) qs.set("kho_id", String(params.kho_id));
        if (params.q) qs.set("q", params.q);
        setLocThuocTinhQs(qs, params.loc);
        const doFetch = (bearer: string) =>
          fetch(`${BASE_URL}/api/kho/bao-cao/nxt/export.xlsx?${qs.toString()}`, {
            credentials: "include", cache: "no-store", headers: authHeader(bearer),
          });
        let resp = await doFetch(token);
        if (resp.status === 401) {
          const fresh = await refreshAccessToken();
          if (fresh) resp = await doFetch(fresh);
        }
        if (!resp.ok) throw new ApiError(`Xuất tệp thất bại (mã ${resp.status}).`, resp.status);
        return URL.createObjectURL(await resp.blob());
      },
    },
  },

  /** Endpoint CÔNG KHAI — tra kho khi quét tem QR (KHÔNG đăng nhập, KHÔNG giá vốn). */
  public: {
    khoScan(scanToken: string): Promise<PublicScan> {
      const qs = new URLSearchParams({ t: scanToken });
      return request<PublicScan>(`/api/public/kho-scan?${qs.toString()}`);
            },
    },

  // --- Danh mục tài liệu nội quy: chỉ Xem / Thêm / Xóa ----------------------
  noiQuy: {
    /** `q` tìm ở MÁY CHỦ (mã / tên / tên file / ghi chú / người upload) — trước 09/08/2026 lọc
     *  ở client trên trọn bảng, nay bảng đã phân trang nên lọc client chỉ soi được 1 trang. */
    list(token: string, params?: { q?: string; page?: number; size?: number }, loc?: ThamSoLoc):
      Promise<Paged<NoiQuyRecord>> {
      const p = new URLSearchParams(qs(params).replace(/^\?/, ""));
      ganThamSoLoc(p, loc);
      const s = p.toString();
      return authed<Paged<NoiQuyRecord>>(`/api/noi-quy${s ? `?${s}` : ""}`, token);
    },
    /** Giá trị điều kiện "Người tải lên" `[{id, ten, so}]`. */
    nguoiTaiLoc(token: string): Promise<LuaChonLoc[]> {
      return authed<LuaChonLoc[]>("/api/noi-quy/nguoi-tai-loc", token);
    },
    create(token: string, input: { name: string; note?: string; file: File }): Promise<NoiQuyRecord> {
      const form = new FormData();
      form.append("name", input.name);
      form.append("note", input.note ?? "");
      form.append("file", input.file);
      return authed<NoiQuyRecord>("/api/noi-quy", token, {
        method: "POST",
        body: form,
      });
    },
    delete(token: string, recordId: number): Promise<void> {
      return authed<void>(`/api/noi-quy/${recordId}`, token, {
        method: "DELETE",
      });
    },
  },

};

/** Dữ liệu tra kho CÔNG KHAI (quét tem QR). KHÔNG có trường tiền (giá vốn/đơn giá). */
export interface PublicScanLot {
  ma_lo: string | null;
  ngay_nhap: string;
  hsd: string | null;
  vi_tri: string | null;
  sl_con_lai: number;
}

/** 1 lần nhập/xuất gần đây (công khai — KHÔNG có tiền). */
export interface PublicScanMove {
  loai: string; // NHAP / XUAT
  ngay: string | null;
  so_ct: string;
  so_luong: number;
}

export interface PublicScan {
  material_code: string | null;
  material_name: string | null;
  dvt: string | null;
  kho_ten: string | null;
  on_hand: number;
  /** Đường ảnh CÔNG KHAI (`/api/public/vat-lieu-anh?t=…`, serve bằng token QR). null = chưa có ảnh. */
  anh_url: string | null;
  lots: PublicScanLot[];
  history: PublicScanMove[];
}

export interface PlateDieRateRow {
  id: number;
  code: string;
  name: string;
  plate_type: string;
  technology: string;
  unit: string;
  plate_kind: string | null;
  plate_width_mm: number | null;
  plate_height_mm: number | null;
  machine_ids: number[] | null;
  unit_price: number;
  setup_fee: number;
  min_charge: number;
  pricing_method: string;
  unit_price_area: number;
  unit_price_perimeter: number;
  max_charge: number | null;
  allow_manual_price: boolean;
  reusable: boolean;
  reuse_price_method: string | null;
  maintenance_fee: number;
  supplier: string | null;
  lead_time_days: number;
  transport_fee: number;
  moq: number;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  used_count: number;
  /** "Đang dùng trong": kẽm = số phiếu tính giá; khuôn = số công đoạn. Server tính khi list. */
  used_in_estimates: number;
  used_in_operations: number;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface PlateDieUsageEstimate {
  id: number;
  estimate_number: string;
  product_name: string;
  status: string;
  created_at: string;
}

export interface PlateDieUsageOperation {
  id: number;
  code: string;
  name: string;
  operation_type: string;
}

export interface PlateDieRateUsageOut {
  rate_id: number;
  code: string;
  name: string;
  kind: "kem" | "khuon";
  estimates: PlateDieUsageEstimate[];
  operations: PlateDieUsageOperation[];
}

export interface PlateDieRateInput {
  code?: string;
  name: string;
  plate_type: string;
  technology: string;
  unit: string;
  plate_kind?: string | null;
  plate_width_mm?: number | null;
  plate_height_mm?: number | null;
  machine_ids?: number[] | null;
  unit_price?: number;
  setup_fee?: number;
  min_charge?: number;
  pricing_method?: string;
  unit_price_area?: number;
  unit_price_perimeter?: number;
  max_charge?: number | null;
  allow_manual_price?: boolean;
  reusable?: boolean;
  reuse_price_method?: string | null;
  maintenance_fee?: number;
  supplier?: string | null;
  lead_time_days?: number;
  transport_fee?: number;
  moq?: number;
  is_active?: boolean;
  effective_from: string;
}

export interface PlateDieRateListOut {
  items: PlateDieRateRow[];
  total: number;
  page: number;
  size: number;
}

export type WasteGroup = "YIELD_RATE" | "SETUP_WASTE" | "RUNNING_WASTE" | "PAPER_EXTRA_WASTE";

export interface NormRow {
  id: number;
  norm_key: string;
  waste_group: WasteGroup | null;
  calculation_method: string | null;
  value: number;
  code: string | null;
  name: string | null;
  product_type: string | null;
  machine_id: number | null;
  operation_id: number | null;
  operation_key: string | null;
  applicable_product_types: string[] | null;
  applicable_machine_ids: number[] | null;
  qty_min: number | null;
  qty_max: number | null;
  context: any | null;
  context_key: string;
  setup_waste_qty: number | null;
  setup_waste_per_color: number | null;
  setup_waste_per_side: number | null;
  min_waste_qty: number | null;
  max_waste_qty: number | null;
  paper_add_to_purchase: boolean;
  priority: number;
  version: number;
  used_count: number;
  estimate_count: number;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface NormUsageEstimate {
  id: number;
  estimate_number: string;
  product_name: string;
  status: string;
  created_at: string;
}

export interface NormUsageOut {
  norm_id: number;
  code: string;
  estimate_count: number;
  estimates: NormUsageEstimate[];
}

export interface NormConflictsOut {
  // keys là norm_id (chuỗi trong JSON) → danh sách norm_id có thể xung đột.
  conflicts: Record<string, number[]>;
  labels: Record<string, string>;
}

export interface NormInput {
  norm_key?: string | null;
  waste_group?: WasteGroup | null;
  calculation_method?: string | null;
  value?: number;
  code?: string | null;
  name?: string | null;
  product_type?: string | null;
  machine_id?: number | null;
  operation_id?: number | null;
  operation_key?: string | null;
  applicable_product_types?: string[] | null;
  applicable_machine_ids?: number[] | null;
  qty_min?: number | null;
  qty_max?: number | null;
  context?: any | null;
  setup_waste_qty?: number | null;
  setup_waste_per_color?: number | null;
  setup_waste_per_side?: number | null;
  min_waste_qty?: number | null;
  max_waste_qty?: number | null;
  paper_add_to_purchase?: boolean;
  priority?: number;
  effective_from: string;
  note?: string | null;
}

export interface NormListOut {
  items: NormRow[];
  total: number;
  page: number;
  size: number;
}

export interface NormTestInput {
  quantity: number;
  pieces_per_sheet: number;
  colors: number;
  sides: number;
  forms: number;
  product_type?: string | null;
  machine_id?: number | null;
  operation_keys: string[];
}

export interface NormTestStep {
  label: string;
  detail: string;
  rule_code: string | null;
  value: number | null;
}

export interface NormTestOutput {
  theoretical_sheets: number;
  required_before_print: number;
  sheets_after_yield: number;
  makeready_sheets: number;
  running_sheets: number;
  production_sheets: number;
  paper_extra_sheets: number;
  purchase_sheets: number;
  steps: NormTestStep[];
  warnings: string[];
}

// --- Giao hàng (module `giao_hang`) -----------------------------------------
// HAI TẦNG TRẠNG THÁI: `DeliveryRequest.trang_thai` là HÀM do máy chủ tính (chỉ hai giá trị được
// lưu là `cho_len_ke_hoach`/`da_huy`); `DeliveryTrip.trang_thai` mới là máy trạng thái thật.
// Đừng suy trạng thái yêu cầu ở FE — hai nơi tính là hai nơi lệch.
export type DeliveryRequestStatus =
  | "cho_len_ke_hoach"
  | "dang_thuc_hien"
  | "da_giao_du"
  /** Mọi chuyến đã khép mà chưa giao đủ — Kinh doanh lập yêu cầu mới cho phần còn lại. */
  | "giao_thieu"
  | "that_bai"
  | "chuyen_da_huy"
  | "da_huy";

export type DeliveryTripStatus =
  | "da_len_ke_hoach"
  | "dang_chuan_bi"
  | "da_lay_hang"
  | "dang_giao"
  | "thanh_cong"
  | "giao_thieu"
  | "hen_lai"
  | "that_bai"
  | "dang_tra_hang"
  | "da_tra_hang"
  | "da_huy";

export interface DeliveryRequestLine {
  id: number;
  order_line_id: number;
  qty: number;
  mo_ta: string | null;
  don_vi_tinh: string | null;
  da_giao: number;
  /** Mặt hàng KHO của dòng — Bán hàng chọn một lần lúc lập yêu cầu. */
  hang_loai: string | null;
  hang_id: number | null;
  hang_ten: string | null;
  dvt: string | null;
  /** Cụm bán nhiều dòng (Ruột + Bìa → Kỷ yếu): cùng `cum_khoa` ⇒ giao / nhận cùng một số, form
   *  bày MỘT ô và gửi dòng đầu cụm. Trống = dòng đứng một mình. */
  cum_khoa?: string | null;
  cum_ten?: string | null;
  cum_dvt?: string | null;
}

export interface DeliveryRequest {
  id: number;
  code: string;
  order_id: number;
  order_code: string | null;
  customer_id: number | null;
  customer_name: string | null;
  department_id: number | null;
  ngay_can_giao: string;
  dia_chi: string;
  nguoi_nhan: string | null;
  sdt_nguoi_nhan: string | null;
  ghi_chu: string | null;
  trang_thai: DeliveryRequestStatus;
  ly_do_huy: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  lines: DeliveryRequestLine[];
  so_lan_giao: number;
  /** Trạng thái Lệnh sản xuất — CHỈ HIỆN cho quản lý tự nhìn, KHÔNG chặn (PRD quyết định #1). */
}

export interface DeliveryTripLine {
  order_line_id: number;
  qty_giao: number;
}

export interface DeliveryTrip {
  id: number;
  request_id: number;
  request_code: string | null;
  order_id: number | null;
  order_code: string | null;
  customer_name: string | null;
  lan_thu: number;
  employee_id: number;
  employee_name: string | null;
  /** Phụ xe — tối đa MỘT người, tuỳ chọn (mg 0231). Vai trò do Ô THẢ NGƯỜI VÀO quyết định,
   *  không phải thuộc tính của người: hôm nay lái, mai đi phụ. */
  phu_xe_employee_id?: number | null;
  phu_xe_name?: string | null;
  vehicle_id?: number | null;
  xe_bien_so?: string | null;
  xe_ten?: string | null;
  ghi_chu_phan_cong: string | null;
  trang_thai: DeliveryTripStatus;
  km: number | null;
  /** TỔNG km cả các lần giao của yêu cầu (không phải riêng chuyến này) — tab "Đơn giao hàng"
   *  đã gộp theo yêu cầu. */
  tong_km: number;
  thoi_gian_ket_thuc: string | null;
  nguoi_nhan_thuc_te: string | null;
  ly_do_that_bai: string | null;
  huong_xu_ly: string | null;
  ngay_hen_lai: string | null;
  ghi_chu_ket_qua: string | null;
  lines: DeliveryTripLine[];
  /** Mã + trạng thái YÊU CẦU XUẤT KHO của chuyến (chứng từ của kho). null = chưa gửi. */
  yeu_cau_kho_ma: string | null;
  yeu_cau_kho_trang_thai: string | null;
  /** Hẹn kho (mg 0400 — thay giờ lấy hàng của chuyến): id đề nghị, giờ tường `can_luc` (null = chỉ
   *  hẹn ngày) và `ngay_can`. */
  yeu_cau_kho_id?: number | null;
  yeu_cau_kho_can_luc?: string | null;
  yeu_cau_kho_ngay_can?: string | null;
  /** Yêu cầu NHẬP trả hàng về kho (giao thiếu / thất bại) — máy tự lập, thủ kho ghi sổ là xong. */
  tra_hang_ma?: string | null;
  tra_hang_trang_thai?: string | null;
  tra_hang_id?: number | null;
  /** Kho đã LẬP PHIẾU chưa. Suy từ `stock_vouchers`, không phải cột lưu — kho thao tác trên
   *  màn của họ nên trạng thái phải đọc ngược từ sổ kho. */
  kho_da_lap_phieu?: boolean;
  /** Lượt xe của chuyến (PRD khoán km §14). `null` = chuyến ngoài lượt: một ô km như cũ. */
  luot?: LuotXeTrongChuyen | null;
  /** Cảnh báo KHÔNG chặn của thao tác vừa làm (vd "xe chạy ngoài sổ 30 km"). */
  canh_bao?: string[];
  /** Nơi nhận + hẹn + lưu ý của YÊU CẦU giao — ngăn lượt đọc thẳng, khỏi gọi từng yêu cầu. */
  created_at?: string | null;
  dia_chi?: string | null;
  nguoi_nhan?: string | null;
  sdt_nguoi_nhan?: string | null;
  ngay_can_giao?: string | null;
  luu_y_giao?: string | null;
  customer_po_no?: string | null;
  /** Phiếu kho thật của RIÊNG chuyến này (bỏ phiếu đã huỷ). */
  phieu_xuat?: PhieuKhoCuaChuyen | null;
  phieu_tra?: PhieuKhoCuaChuyen | null;
  /** Nhà gia công giao thẳng cho khách — không xe, không tài xế, không km. */
  giao_thang?: GiaoThangCuaChuyen | null;
  /** Dòng hàng của yêu cầu (tên, số yêu cầu, đã giao) — chỉ `/bang-giao` điền, nạp gộp cả trang,
   *  để ngăn chi tiết có bảng hàng ngay lúc mở (07/10/2026). */
  hang?: DeliveryRequestLine[];
}

export interface PhieuKhoCuaChuyen {
  /** id phiếu — bấm mã ở tab Chứng từ mở ngăn phiếu của màn Kho. */
  id?: number | null;
  ma: string;
  trang_thai: string;
  luc: string | null;
  boi_ten: string | null;
}

export interface GiaoThangCuaChuyen {
  gia_cong_ngoai_id: number;
  nha_cung_cap_ten: string | null;
  nha_cung_cap_sdt: string | null;
  lsx_id: number | null;
  lsx_ma: string | null;
}

/** Lượt xe nhìn từ MỘT chuyến. Chuyến trong lượt không gõ km: tài xế ghi SỐ ĐỒNG HỒ lúc xuất
 *  phát, lúc tới từng khách, lúc về kho — máy trừ ra km từng chặng rồi tra đơn giá theo chặng. */
export interface LuotXeTrongChuyen {
  id: number;
  code: string;
  vehicle_id: number;
  ngay: string;
  so_diem: number;
  so_dong_ho_xuat_phat: number | null;
  so_dong_ho_ve_kho: number | null;
  ve_kho_luc: string | null;
  km_ve_kho: number | null;
  /** Số đồng hồ lúc TỚI điểm của chính chuyến này (null = chưa nhập kết quả). */
  so_dong_ho: number | null;
  /** Số lớn nhất đã ghi trong lượt (hoặc số xuất phát) — để nhắc khi nhập số tiếp theo. */
  so_dong_ho_gan_nhat: number | null;
  /** Số cuối đã ghi của xe ở lượt trước — tự điền lúc xuất phát. Chỉ có khi lượt chưa xuất phát. */
  goi_y_xuat_phat: number | null;
  /** Mọi điểm đã có kết quả, lượt chưa về kho ⇒ hiện nút "Về kho". */
  cho_ve_kho: boolean;
  /** Chuyến này là điểm có số đồng hồ lớn nhất — nút "Về kho" đặt ở dòng này. */
  la_diem_cuoi: boolean;
}

/** Một lượt CHƯA về kho của một xe — ô Lượt xe lúc lên đơn. */
export interface LuotXeMo {
  id: number;
  code: string;
  ngay: string;
  so_diem: number;
  tai_xe: string | null;
  da_xuat_phat: boolean;
}

export interface VeKhoKetQua {
  id: number;
  code: string;
  so_dong_ho_ve_kho: number | null;
  km_ve_kho: number | null;
  ve_kho_luc: string | null;
  canh_bao: string[];
}

export interface LenLuotInput {
  request_ids: number[];
  employee_id: number;
  phu_xe_employee_id?: number | null;
  /** Lượt là vòng chạy của MỘT chiếc xe ⇒ bắt buộc. */
  vehicle_id: number;
  ghi_chu_phan_cong?: string | null;
  /** `"moi"` = lượt mới · id = ghép vào lượt đang mở của cùng xe. */
  luot_xe_id: number | "moi";
}

export interface LenLuotKetQua {
  luot_id: number;
  code: string;
  trips: DeliveryTrip[];
  canh_bao: string[];
  /** Mã đề nghị xuất kho gửi kèm lên lượt — mỗi chuyến một phiếu. */
  phieu: string[];
}

/** Đề nghị xuất kho của một chuyến — bước "Đề nghị xuất kho" sau Lên đơn / Lên lượt (mg 0400):
 *  người lên đơn hẹn kho (Cần lúc) và dặn kho ở đây. Hàng khoá theo yêu cầu giao. */
export interface DeNghiKhoGiao {
  id: number;
  ma: string;
  trip_id: number;
  request_code: string | null;
  customer_name: string | null;
  order_code: string | null;
  ngay_can_giao: string | null;
  ngay_can: string | null;
  /** Giờ tường nhà máy "yyyy-mm-ddTHH:mm:ss" — null = chỉ hẹn ngày. */
  can_luc: string | null;
  ghi_chu: string | null;
  kho_ten: string | null;
  /** Kho chưa lập phiếu ⇒ còn hẹn lại / dặn lại được. */
  sua_duoc: boolean;
  hang: { ten: string | null; ma: string | null; so_luong: number; dvt: string | null }[];
}

export interface HenKhoInput {
  ngay_can: string;
  /** "HH:MM" hoặc null = chỉ hẹn ngày. */
  gio_can: string | null;
  /** Mỗi đề nghị một dòng — Cần lúc dùng chung, ghi chú riêng. */
  dong: { trip_id: number; ghi_chu: string | null }[];
}

export interface GoiYXuatPhatNguon {
  so: number;
  /** `toi_khach` = lượt đó chưa ghi số về kho, số cuối là số tới khách cuối. */
  loai: "ve_kho" | "toi_khach" | "xuat_phat";
  luot_code: string;
  ngay: string;
  luc: string | null;
}

export interface LuotXeChiTiet {
  id: number;
  code: string;
  ngay: string;
  vehicle_id: number;
  xe_bien_so: string | null;
  xe_ten: string | null;
  so_dong_ho_xuat_phat: number | null;
  so_dong_ho_ve_kho: number | null;
  ve_kho_luc: string | null;
  km_ve_kho: number | null;
  goi_y_xuat_phat: number | null;
  /** Lượt + lúc ghi của `goi_y_xuat_phat` — hộp Bắt đầu giao nói số lấy sẵn từ đâu ra. */
  goi_y_nguon?: GoiYXuatPhatNguon | null;
  so_dong_ho_gan_nhat: number | null;
  cho_ve_kho: boolean;
  tong_km: number;
  /** Các điểm theo THỨ TỰ CHẶNG (số đồng hồ tăng dần; chưa có số thì xếp cuối). */
  diem: DeliveryTrip[];
  /** Chuyến đang chờ kho xuất (kho ghi sổ phiếu xuất thì tự sang đã lấy hàng). */
  so_cho_lay_hang: number;
  so_cho_bat_dau: number;
  so_dang_giao: number;
  created_at?: string | null;
}

/** Một KHỐI của tab Đơn giao hàng — đúng MỘT trong hai ô có giá trị. */
export interface BangGiaoItem {
  luot: LuotXeChiTiet | null;
  trip: DeliveryTrip | null;
}

export interface BangGiaoPage {
  items: BangGiaoItem[];
  /** Tổng số KHỐI — để phân trang. */
  total: number;
  /** Tổng số ĐƠN giao (chuyến) — số đếm trên tab / đầu trang. */
  so_don: number;
  /** Số đơn giao theo nhóm tình trạng (chuan_bi/dang_giao/da_giao/giao_thieu/that_bai) — hàng lọc nhanh. */
  dem_tinh_trang?: Record<string, number>;
}

/** Kết quả một thao tác CẢ LƯỢT: số chuyến vừa đi tiếp, mã phiếu kho (nếu có), cảnh báo. */
export interface CaLuotKetQua {
  so_chuyen: number;
  phieu: string[];
  canh_bao: string[];
}

export interface DeliveryHistory {
  id: number;
  tu_trang_thai: string | null;
  den_trang_thai: string;
  nguoi_thao_tac_id: number | null;
  nguoi_thao_tac_name: string | null;
  luc: string;
  ghi_chu: string | null;
  ly_do: string | null;
}

export interface DeliveryRequestDetail {
  request: DeliveryRequest;
  trips: DeliveryTrip[];
  lich_su: DeliveryHistory[];
}

export interface DeliveryRequestInput {
  order_id: number;
  ngay_can_giao: string;
  /** Chỉ HAI ô: dòng đơn nào, bao nhiêu. Ba ô mặt hàng kho gỡ 19/08/2026 — hệ tự khai vào danh
   *  mục Thành phẩm lúc chốt đơn, người lập không chọn gì (docs/prd-thanh-pham.md). */
  lines: {
    order_line_id: number;
    qty: number;
  }[];
  /** Nơi nhận CHỌN từ sổ của khách (19/09/2026) — không có ô gõ tay. `null`/bỏ trống = nơi nhận của
   *  đơn. Lưu ý giao hàng máy chủ tự lấy của đơn. */
  dia_chi_id?: number | null;
  lien_he_id?: number | null;
}

export interface KhoanKmPct {
  pct_tai_xe: number;
  pct_phu_xe: number;
}

export interface MucKm {
  id: number;
  /** Rỗng — ô chọn dùng chung vẽ "mã · tên" nhưng tự giấu phần mã khi rỗng. Mức chỉ có TÊN. */
  ma?: string;
  /** Tên mức — thứ người dùng đọc khi gán cho xe ("Xe 2 tấn"). Không được trùng. */
  ten: string;
  ghi_chu?: string | null;
  active: boolean;
  items: KmBracket[];
  /** SỐ XE đang ăn mức này — màn phải nói trước khi người ta sửa giá: sửa một mức là đổi tiền
   *  của cả nhóm xe, khác hẳn sửa bảng giá của riêng một chiếc. */
  so_xe: number;
}

export interface MucKmInput {
  ten: string;
  ghi_chu?: string | null;
  active?: boolean;
}

export interface KmBracket {
  /** Trần km của bậc; `null` = bậc cao nhất (từ đó trở lên), chỉ một và ở CUỐI. */
  up_to_km: number | null;
  don_gia: number;
}

export interface PlanInput {
  request_id: number;
  employee_id: number;
  /** Gửi `null` khi ĐỔI kế hoạch = GỠ phụ xe; KHÔNG gửi = giữ nguyên. Máy chủ phân biệt hai
   *  trường hợp đó, nên đừng gửi `null` chỉ vì ô đang trống ở màn tạo mới. */
  phu_xe_employee_id?: number | null;
  /** Xe chạy chuyến. TUỲ CHỌN lúc lên kế hoạch, BẮT BUỘC lúc đóng chuyến (máy chủ chặn). */
  vehicle_id?: number | null;
  kho_id?: number | null;
  ghi_chu_phan_cong?: string | null;
  /** LƯỢT XE (PRD khoán km §14): `"moi"` = lượt mới · id = ghép vào lượt đang mở của CÙNG xe ·
   *  không gửi = chuyến ngoài lượt (một ô km như cũ). Chỉ có nghĩa khi đã chọn xe. */
  luot_xe_id?: number | "moi" | null;
}

export interface KetQuaInput {
  ket_qua: "thanh_cong" | "giao_thieu" | "hen_lai" | "that_bai";
  /** `>= 0`, KHÔNG phải `> 0`: xe chưa lăn bánh mà khách không nghe máy thì 0 km là số THẬT.
   *  Chỉ cho chuyến NGOÀI lượt — chuyến trong lượt gửi `so_dong_ho`, máy tự trừ ra km. */
  km?: number | null;
  /** Số đồng hồ lúc TỚI khách — chuyến trong lượt xe. */
  so_dong_ho?: number | null;
  thoi_gian_ket_thuc?: string | null;
  nguoi_nhan_thuc_te?: string | null;
  ly_do_that_bai?: string | null;
  huong_xu_ly?: "tra_ve" | "cho_giao_lai" | null;
  ngay_hen_lai?: string | null;
  ghi_chu?: string | null;
  so_thuc_nhan?: { order_line_id: number; qty: number }[] | null;
  /** Bật sau khi người dùng đã xem cảnh báo "km lớn bất thường" và khẳng định đúng. */
  xac_nhan_km_lon?: boolean;
  /** Xe đã chạy chuyến — gửi để điền/đổi ngay lúc ghi kết quả. Chuyến khối Giao hàng mà cả
   *  đây lẫn chuyến đều trống thì máy chủ chặn (đơn giá khoán km tra theo mức của xe). */
  vehicle_id?: number | null;
}

/** Một dòng SẼ gửi kho — máy suy ra từ yêu cầu giao, người dùng chỉ xem. */
export interface DinhKemChuyen {
  id: number;
  trip_id: number;
  file_name: string;
  /** Đọc lại qua `/api/files/...` — cần đăng nhập. */
  file_url: string;
  file_type: string | null;
  uploaded_by: number | null;
  uploaded_at: string;
}

export interface DeliveryDriver {
  employee_id: number;
  ho_ten: string;
  trang_thai: "ranh" | "co_lich" | "dang_giao" | "dang_tra_hang" | "nghi";
  chuyen_dang_thuc_hien: string | null;
  chuyen_ke_tiep: string | null;
  so_chuyen_xong: number;
  tong_km: number;
  /** Trong THÁNG chứa ngày đang xem — để theo dõi định kỳ (20/08/2026). */
  so_chuyen_thang?: number;
  tong_km_thang?: number;
}

export interface DeliveryDriverPick {
  id: number;
  code: string | null;
  full_name: string;
  department: string | null;
  /** Có ô Thao tác của màn Giao hàng chưa. Không có ⇒ họ thấy chuyến nhưng KHÔNG bấm được
   *  "Bắt đầu giao" / nhập kết quả, chuyến tắc ở đó. Phải báo ngay lúc chọn. */
  /** Có tài khoản đăng nhập chưa. Tách khỏi `co_thao_tac` để câu cảnh báo chỉ đúng màn cần
   *  sửa: chưa có tài khoản → màn Người dùng; có rồi mà thiếu ô → màn Vai trò. */
  co_tai_khoan?: boolean;
  co_thao_tac: boolean;
}

export interface ConPhaiGiaoLine {
  order_line_id: number;
  mo_ta: string | null;
  don_vi_tinh: string | null;
  qty_dat: number;
  da_giao: number;
  con_phai_giao: number;
  /** Cụm bán nhiều dòng (Ruột + Bìa → Kỷ yếu): cùng `cum_khoa` ⇒ giao / nhận cùng một số, form
   *  bày MỘT ô và gửi dòng đầu cụm. Trống = dòng đứng một mình. */
  cum_khoa?: string | null;
  cum_ten?: string | null;
  cum_dvt?: string | null;
}

export interface ConPhaiGiao {
  order_id: number;
  da_giao_du: boolean;
  lines: ConPhaiGiaoLine[];
}

// --- Tiến độ đơn (GET /api/orders/{id}/tien-do) ----------------------------
export interface DonTienDoLenh {
  id: number;
  ma: string;
  da_xuong_xuong: boolean;
  pct: number;
  uoc_tinh: boolean;
  xong: boolean;
  buoc_hien_tai: string | null;
  du_kien_xong: string | null;
  trang_thai: string | null;
  canh_bao: string[];
}

/** Tồn của mã thành phẩm ở một kho. Thành phẩm thuộc về khách nên mọi dòng đều là hàng của khách. */
export interface DonTienDoTonKho {
  kho_id: number;
  kho_ten: string;
  so_luong: number;
}

export interface DonTienDoCum {
  khoa: string;
  ten: string;
  don_vi: string | null;
  order_line_ids: number[];
  dat: number;
  co_lenh: boolean;
  lenh: DonTienDoLenh[];
  sx_pct: number | null;
  sx_xong: boolean;
  kho_de_nghi: number;
  kho_da_nhan: number;
  cho_kho: number;
  ton_that: number;
  /** Tồn thật của mã chia theo kho. */
  ton_kho?: DonTienDoTonKho[];
  /** Phần tồn đơn KHÁC của khách đang giữ (đã lập yêu cầu giao, kho chưa xuất). */
  giu_don_khac?: number;
  da_giao: number;
  /** Phần của `da_giao` do nhà gia công GIAO THẲNG cho khách — không qua KCS trên phần mềm, không qua kho. */
  giao_thang: number;
  /** Mặt hàng đang ở đâu + từng lệnh (kiểu làm, bước, nhà gia công) — bảng Sản xuất của ngăn đơn. */
  o: MonO | null;
  lenh_o: LenhMon[];
  dang_giu: number;
  con_phai_giao: number;
  /** Khách đã THỰC NHẬN đủ. Khác `con_phai_giao` ≤ 0 — số đó trừ cả phần yêu cầu giao đang giữ. */
  khach_nhan_du?: boolean;
  /** Số Kinh doanh còn lập yêu cầu giao được = min(còn phải giao, tồn của mã − đơn khác đang giữ). */
  giao_duoc: number;
}

export interface DonTienDoChuyen {
  id: number;
  trang_thai: DeliveryTripStatus;
  tai_xe: string | null;
  xe: string | null;
  thoi_gian_ket_thuc: string | null;
  nguoi_nhan_thuc_te: string | null;
  ly_do_that_bai: string | null;
  tra_hang_ma: string | null;
  tra_hang_xong: boolean;
  kho_da_lap_phieu?: boolean;
  /** Kho đã GHI SỔ phiếu xuất của chuyến — mở nút in phiếu xuất bán hàng / 02-VT. */
  kho_da_xuat?: boolean;
  so_anh: number;
}

/** Phần đơn chưa có để in phiếu xuất của một yêu cầu giao (`GET /api/orders/{id}/yeu-cau-giao/{yc}/phieu-xuat`). */
export interface PhieuXuatIn {
  so_phieu: string[];
  ngay: string;
  kho_ten: string | null;
  nguoi_lap: string | null;
  /** Theo dòng đơn (dòng đầu mỗi cụm): `so_luong` = số in phiếu giao (khách thực nhận khi chuyến đã có
   *  kết quả, chưa có thì bằng số xuất), `so_xuat` = số kho thực xuất (mẫu 02-VT). */
  thuc_xuat: { order_line_id: number; so_luong: number; so_xuat: number; ma_hang: string | null }[];
  /** Người ký nhận: người nhận thực tế của chuyến, chưa giao thì người nhận ghi trên yêu cầu. */
  nguoi_mua: string | null;
  khach_ma_so_thue: string | null;
  khach_dia_chi: string | null;
  khach_dien_thoai: string | null;
  tai_xe: string | null;
  phu_xe: string | null;
  xe: string | null;
}

export interface DonTienDoYeuCau {
  id: number;
  code: string;
  ngay_can_giao: string;
  trang_thai: DeliveryRequestStatus;
  ly_do_huy: string | null;
  dia_chi: string;
  nguoi_nhan: string | null;
  sdt_nguoi_nhan: string | null;
  ghi_chu: string | null;
  created_at: string;
  dong: { order_line_id: number; ten: string; qty: number; da_giao: number }[];
  chuyen: DonTienDoChuyen | null;
}

export interface DonTienDo {
  order_id: number;
  han_cam_ket: string | null;
  du_kien_xong: string | null;
  chua_du_du_lieu: boolean;
  tre_ngay: number | null;
  ly_do: string[];
  cum: DonTienDoCum[];
  yeu_cau: DonTienDoYeuCau[];
  noi_nhan: DonNoiNhan;
  /** Đơn đang chờ ai — cùng hàm với cột Sản xuất ngoài danh sách. */
  dang_cho: DangCho[];
}

/** Nơi nhận để form yêu cầu giao CHỌN: mặc định của đơn + sổ địa chỉ / người liên hệ của khách. */
export interface DonNoiNhan {
  khach_id: number | null;
  dia_chi: string | null;
  nguoi_nhan: string | null;
  sdt: string | null;
  luu_y: string | null;
  so_dia_chi: { id: number; nhan: string; dia_chi: string; sdt: string | null; mac_dinh: boolean }[];
  lien_he: { id: number; ten: string; chuc_vu: string | null; sdt: string | null; chinh: boolean }[];
}

