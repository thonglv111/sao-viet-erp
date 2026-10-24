// Kho — mảnh dùng chung cho MÀN YÊU CẦU và MÀN HỘP YÊU CẦU (spec-kho-de-nghi §D).
// Hai màn nhìn cùng một chứng từ ở hai đầu luồng nên nhãn/màu trạng thái phải khớp tuyệt
// đối; để mỗi màn tự khai một bảng là kiểu gì cũng lệch sau vài lần sửa.
import { ChonNgay } from "../components/ChonNgay";
import { useEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import type { StockRequestKind, StockRequestStatus, StockVoucherStatus } from "../api/client";
import { useCan } from "../auth/permissions";
import { ChipTT, type MauTT } from "../components/LuoiDs";
import { tenDonVi } from "./tenDonVi";
import { homNayVN } from "../utils/ky";
import "./kho-request.css";

/** TẠM ẨN toàn bộ giao diện ĐIỀU CHUYỂN kho — CHỈ ở FE (backend/API + dữ liệu cũ giữ nguyên).
 *  Che: nút "Điều chuyển"/"Chuyển kho" ở Tồn kho · tab "Điều chuyển" ở Tồn kho · chip "Điều chuyển"
 *  ở Kho · tab con "Chuyển kho" trong Sổ kho (Báo cáo kho). Bật lại: đổi thành `false`. */
export const AN_DIEU_CHUYEN = true;

/** ẨN nút "In yêu cầu" ở màn Yêu cầu nhập/xuất kho — CHỈ giao diện (hàm in vẫn còn).
 *  Bật lại: đổi thành `false`. */
export const AN_IN_YEU_CAU = true;

/** Người đứng PHÍA KHO của màn "Yêu cầu nhập xuất" — tức tab "Phiếu từ yêu cầu", đối lại với
 *  người ĐI XIN ở tab "Yêu cầu".
 *
 *  Luật 24/09/2026, chỉ dùng hai ô của CHÍNH màn Kho:
 *    • có Thao tác (`create`) ⇒ người kho, lập phiếu được;
 *    • chỉ có Xem mà KHÔNG có ô chi tiết "Tạo yêu cầu" ⇒ người kho ở chế độ đọc — đúng hình vai
 *      **Kế toán kho** (đối chiếu sổ, không cầm hàng nên không có Thao tác).
 *
 *  Vế thứ hai trước đây là `kho:view_stock`. Ô đó đã tách sang module `ton_kho` (mg `0334`), mà
 *  hộp việc của màn Kho thì không được đi hỏi quyền của màn Tồn kho — hỏi vậy là lại ăn ké, chỉ
 *  đổi chiều. Máy chủ giữ ĐÚNG luật này ở `kho_request._la_nguoi_kho`. */
export function laNguoiKho(can: ReturnType<typeof useCan>): boolean {
  return can("kho", "create") || (can("kho", "read") && !can("kho", "request"));
}

/** Cỡ trang mặc định của mọi danh sách kho — khớp mặc định 25 của chân bảng `PhanTrangDayDu`
 *  (các mức chọn lấy từ chính component đó, không khai riêng ở đây). */
export const DEFAULT_PAGE_SIZE = 25;

// Parse chuỗi người dùng gõ (chấp nhận cả dấu "," VN lẫn ".") thành số; "" / "." / "," → null.
function parseDecimal(s: string): number | null {
  const t = s.replace(",", ".").trim();
  if (t === "" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
// Hiển thị số kiểu VN (dấu phẩy thập phân), KHÔNG chấm ngăn nghìn (chấm nghìn parse lại sẽ vỡ:
// "1.000" → 1). 0/null coi như rỗng để ô fresh trống. Ô đang sửa hiện số thô; bản chỉ-đọc mới fmtQty.
function showDecimal(n: number | null): string {
  return n == null || n === 0 ? "" : String(n).replace(".", ",");
}

/**
 * Ô nhập SỐ THẬP PHÂN cho kho. Sửa lỗi `type="number"` + `value={n || ""}` NUỐT MẤT số 0 và trạng
 * thái đang gõ ("0", "0,", "0,5") — người dùng không gõ được 0,5. Giữ CHUỖI đang gõ làm nguồn hiển
 * thị, chỉ parse ra số khi hợp lệ; nhận cả "," (VN) lẫn "."; đồng bộ lại từ prop khi KHÔNG focus.
 * `allowNull`: ô rỗng trả null (cho đơn giá) thay vì 0 (cho số lượng).
 */
export function DecimalInput({
  value,
  onChange,
  allowNull = false,
  ...rest
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  allowNull?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [text, setText] = useState(() => showDecimal(value));
  const focused = useRef(false);
  // Đồng bộ prop → ô KHI KHÔNG focus (reset form, seed lại) — không giẫm lên lúc người dùng đang gõ.
  useEffect(() => {
    if (!focused.current) setText(showDecimal(value));
  }, [value]);
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={(e) => {
        focused.current = true;
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        // Rời ô → hiện lại số CHỦ ô đang giữ: chuẩn hoá ("0" trơ, dấu lẻ…) và cả khi chủ ô chặn trần
        // (gõ 12 mà lô còn 8 thì ô về 8, không đứng "12" trong khi số thật đã là 8).
        setText(showDecimal(value));
        rest.onBlur?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        // Chỉ nhận: rỗng hoặc chuỗi số với TỐI ĐA một dấu thập phân (, hoặc .). Chặn ký tự khác.
        if (raw !== "" && !/^\d*[.,]?\d*$/.test(raw)) return;
        setText(raw);
        const n = parseDecimal(raw);
        onChange(allowNull ? n : n ?? 0);
      }}
    />
  );
}

interface Tone {
  label: string;
  tone: string;
}

export const REQUEST_STATUS: Record<StockRequestStatus, Tone> = {
  draft: { label: "Nháp", tone: "muted" },
  pending: { label: "Chờ duyệt", tone: "amber" },
  // Đã BỎ bước duyệt yêu cầu kho → tạo là "approved" ngay. Nhãn "Chờ xử lý" (chờ kho tiếp nhận/cấp),
  // KHÔNG dùng "Đã duyệt" nữa vì không còn ai duyệt.
  approved: { label: "Chờ xử lý", tone: "steel" },
  received: { label: "Kho tiếp nhận", tone: "sky" },
  preparing: { label: "Đang chuẩn bị", tone: "plum" },
  partial: { label: "Đã cấp một phần", tone: "rust" },
  done: { label: "Hoàn tất", tone: "moss" },
  rejected: { label: "Từ chối", tone: "signal" },
  cancelled: { label: "Đã hủy", tone: "gray" },
};

export const VOUCHER_STATUS: Record<StockVoucherStatus, Tone> = {
  // "draft" giữ nguyên GIÁ TRỊ ở BE (chưa ghi sổ) nhưng nhãn đổi thành "Chờ ghi sổ": tạo phiếu là
  // gửi luôn, người lập không sửa được; chỉ người có quyền Ghi sổ mới chốt sổ hoặc hủy.
  draft: { label: "Chờ ghi sổ", tone: "amber" },
  posted: { label: "Đã ghi sổ", tone: "moss" },
  cancelled: { label: "Đã hủy", tone: "gray" },
};

export function RequestStatusBadge({ status, loai }: { status: StockRequestStatus; loai?: StockRequestKind }) {
  const s = REQUEST_STATUS[status] ?? { label: status, tone: "muted" };
  // Yêu cầu NHẬP thì kho "nhập" chứ không "cấp" — cùng trạng thái, khác chữ.
  const label = status === "partial" && loai === "NHAP" ? "Đã nhập một phần" : s.label;
  return (
    <span className={`badge-sem badge-sem--${s.tone}`}>
      <span className={`status-dot status-dot--${s.tone}`} />
      {label}
    </span>
  );
}

export function VoucherStatusBadge({ status }: { status: StockVoucherStatus }) {
  const s = VOUCHER_STATUS[status] ?? { label: status, tone: "muted" };
  return (
    <span className={`badge-sem badge-sem--${s.tone}`}>
      <span className={`status-dot status-dot--${s.tone}`} />
      {s.label}
    </span>
  );
}

// ── Chip trạng thái cho LƯỚI danh sách (khuôn lds, 08/10/2026) ────────────────────
// Cùng nhãn với `REQUEST_STATUS` / `VOUCHER_STATUS`; màu theo bộ `--tt-*`, mỗi trạng thái MỘT sắc.
const MAU_TT_YEU_CAU: Record<StockRequestStatus, MauTT> = {
  draft: "slate",
  pending: "vang",
  approved: "xanh",
  received: "cyan",
  preparing: "tim",
  partial: "cam",
  done: "la",
  rejected: "do",
  cancelled: "xam",
};

export function ChipTrangThaiYeuCau({ status, loai }: { status: StockRequestStatus; loai?: StockRequestKind }) {
  // Yêu cầu NHẬP thì kho "nhập" chứ không "cấp" — cùng trạng thái, khác chữ.
  const nhan = status === "partial" && loai === "NHAP" ? "Đã nhập một phần" : (REQUEST_STATUS[status]?.label ?? status);
  return <ChipTT mau={MAU_TT_YEU_CAU[status] ?? "slate"}>{nhan}</ChipTT>;
}

/** Chip loại yêu cầu (chip khâu, góc vuông): Nhập · Xuất · Điều chuyển. */
export function ChipLoaiYeuCau({ loai, dieuChuyen }: { loai: StockRequestKind; dieuChuyen?: boolean }) {
  if (dieuChuyen) return <ChipTT mau="slate" vuong>Điều chuyển</ChipTT>;
  return loai === "NHAP" ? <ChipTT mau="ngoc" vuong>Nhập</ChipTT> : <ChipTT mau="cham" vuong>Xuất</ChipTT>;
}

const MAU_TT_PHIEU: Record<StockVoucherStatus, MauTT> = { draft: "vang", posted: "la", cancelled: "xam" };

export function ChipTrangThaiPhieu({ status }: { status: StockVoucherStatus }) {
  return <ChipTT mau={MAU_TT_PHIEU[status] ?? "slate"}>{VOUCHER_STATUS[status]?.label ?? status}</ChipTT>;
}

/** Trạng thái PHIẾU ĐIỀU CHUYỂN (mặt tiền là vế NHẬP đích): chờ kho đích ghi sổ · đã ghi sổ (hoàn
 *  tất cả tuyến) · đã hủy. Nhãn RIÊNG so với phiếu thường ("Hoàn tất" thay "Đã ghi sổ"). */
export type TransferStatus = "cho-ghi-so" | "hoan-tat" | "da-huy";

const TRANSFER_STATUS: Record<TransferStatus, Tone> = {
  "cho-ghi-so": { label: "Chờ ghi sổ", tone: "amber" },
  "hoan-tat": { label: "Hoàn tất", tone: "moss" },
  "da-huy": { label: "Đã hủy", tone: "gray" },
};

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  const s = TRANSFER_STATUS[status];
  return (
    <span className={`badge-sem badge-sem--${s.tone}`}>
      <span className={`status-dot status-dot--${s.tone}`} />
      {s.label}
    </span>
  );
}

const MAU_TT_DIEU_CHUYEN: Record<TransferStatus, MauTT> = { "cho-ghi-so": "vang", "hoan-tat": "la", "da-huy": "xam" };

export function ChipTrangThaiDieuChuyen({ status }: { status: TransferStatus }) {
  return <ChipTT mau={MAU_TT_DIEU_CHUYEN[status]}>{TRANSFER_STATUS[status].label}</ChipTT>;
}

/** Nhãn ĐIỀU CHUYỂN — dán lên yêu cầu điều chuyển (NHẬP ở đích) để phân biệt với nhập/xuất thường.
 *  Kèm tên kho nguồn khi có ("Điều chuyển từ «kho»"). Dùng chung ở Hộp yêu cầu · Yêu cầu · drawer. */
export function DieuChuyenPill({ khoNguonTen }: { khoNguonTen?: string | null }) {
  return (
    <span
      className="badge-sem badge-sem--plum"
      title={khoNguonTen ? `Điều chuyển từ ${khoNguonTen}` : "Điều chuyển nội bộ"}
    >
      <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>⇄</span> Điều chuyển{khoNguonTen ? ` · từ ${khoNguonTen}` : ""}
    </span>
  );
}

/** Ô ĐƠN GIÁ (giá gốc) của dòng nhập thành phẩm từ KCS — drawer Yêu cầu, lập phiếu, phiếu kho.
 *  Giá gốc do kế toán kho gõ SAU (Báo cáo kho › Giá gốc thành phẩm) nên chưa có thì báo thẳng
 *  "Chưa có giá gốc" thay vì "0 đ". Chỉ giá gốc — giá bán nằm CỘT RIÊNG (`GiaBanDong`), gộp chung
 *  một ô là đọc nhầm giá bán thành giá vốn. Nơi gọi phải gate cột theo `view_cost`. */
export function GiaGocKcs({ gia }: { gia: number | null }) {
  return gia != null ? (
    <>{gia.toLocaleString("vi-VN")} đ</>
  ) : (
    // Cột đã mang tên "Giá gốc" ⇒ chip chỉ cần "Chưa có" (chữ dài đẩy bảng ngăn phải cuộn ngang).
    <span className="badge-sem badge-sem--amber" title="Chưa có giá gốc — kế toán kho gõ ở Báo cáo kho › Giá gốc thành phẩm">
      Chưa có
    </span>
  );
}

/** Ô GIÁ BÁN (tham khảo) — cột riêng cạnh Thành tiền, không cộng vào tiền phiếu. `donMa` = đơn lấy
 *  giá; bỏ trống khi dòng đã hiện đơn ở chỗ khác. Server chỉ trả giá bán cho người có `view_cost`. */
export function GiaBanDong({ gia, dvt, donMa }: { gia: number | null; dvt: string; donMa?: string | null }) {
  if (gia == null) return <>—</>;
  const dv = tenDonVi(dvt) || dvt;
  return (
    <>
      {gia.toLocaleString("vi-VN")} đ{dv && <span className="kna-dv">/{dv}</span>}
      {donMa && <div className="kho-hint">{donMa}</div>}
    </>
  );
}

/** Chip LOẠI yêu cầu — cột "Loại" ở danh sách Yêu cầu / Phiếu từ yêu cầu: Nhập · Xuất · Điều chuyển.
 *  `dieuChuyen` ưu tiên (yêu cầu điều chuyển vốn là NHẬP ở đích, nhưng hiển thị là "Điều chuyển"). */
export function LoaiYeuCauChip({ loai, dieuChuyen }: { loai: StockRequestKind; dieuChuyen?: boolean }) {
  if (dieuChuyen) {
    return (
      <span className="badge-sem badge-sem--plum">
        <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>⇄</span> Điều chuyển
      </span>
    );
  }
  return loai === "NHAP" ? (
    <span className="badge-sem badge-sem--steel">
      <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>↓</span> Nhập
    </span>
  ) : (
    <span className="badge-sem badge-sem--rust">
      <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>↑</span> Xuất
    </span>
  );
}

/** Gắn `title` (tooltip trình duyệt) cho MỌI `<th>` của bảng = chính chữ tiêu đề cột → hover ra tên
 *  cột đầy đủ dù cột bị cắt (vd "Mặt hàng / Tổng"). Trả ref gắn vào `<table>`. Không đè title có sẵn
 *  (vd cột phễu ngày/số đã có mô tả riêng). Chạy sau mỗi render vì số cột có thể đổi (ẩn/hiện theo quyền). */
export function useHeaderTitles<T extends HTMLElement = HTMLTableElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    // Gắn cho MỌI `<th>` trong phạm vi ref (đặt ref ở `<table>` hoặc bọc cả `<main>` để phủ nhiều bảng).
    ref.current?.querySelectorAll<HTMLTableCellElement>("thead th").forEach((th) => {
      const t = (th.textContent || "").trim();
      if (t && !th.hasAttribute("title")) th.setAttribute("title", t);
    });
  });
  return ref;
}

/** Số lượng: bỏ đuôi .00 (phiếu giấy không ai ghi "10,00 tờ"), tối đa 3 số lẻ. */
export function fmtQty(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return value.toLocaleString("vi-VN", { maximumFractionDigits: 3 });
}

/** Số kg quy đổi: đúng 2 số lẻ (299,34) — số suy ra, không phải số đếm. */
export function fmtKg(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return value.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Chuỗi ISO của hôm nay theo giờ xưởng, không theo múi giờ máy (dùng để so hạn + mặc định ngày phiếu). */
export function todayISO(): string {
  return homNayVN();
}

/** Trạng thái đã đóng sổ — quá hạn thì cũng không còn ý nghĩa cảnh báo. */
const CLOSED: StockRequestStatus[] = ["done", "rejected", "cancelled"];

/** GIỜ cần của đề nghị sản xuất, hiện ĐÚNG con số tổ trưởng đã gõ.
 *
 *  `can_luc` naive = giờ nhà máy (wall-clock), không phải UTC — quy ước của cả phân hệ sản xuất,
 *  ghi rõ ở `xep_lich_service._naive`. `fmtDateTime` dùng chung thì gắn thêm "Z" rồi quy về
 *  `Asia/Ho_Chi_Minh`, nên tổ gõ 31/08 17:56 mà kho đọc ra "1/9 00:56": lệch 7 tiếng, sang ngày,
 *  và đá ngay với badge "Quá hạn" ngồi cạnh — `isOverdue` bên dưới dùng `new Date()` trần nên
 *  tính đúng 17:56. Một ô không được nói hai giờ. Ở đây đọc wall-clock, khớp `isOverdue`.
 */
export function fmtGioCan(canLuc: string | null | undefined): string {
  if (!canLuc) return "—";
  const d = new Date(canLuc);
  if (Number.isNaN(d.getTime())) return canLuc;
  return `${d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })} ${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
}

/** `canLuc` (giờ cần thật, từ đề nghị sản xuất) ưu tiên khi có — so THEO GIỜ, không theo ngày:
 *  cột hiển thị đã đổi nhãn "Cần lúc" và hiện giờ (task-8-ruling-man-kho), nên tín hiệu trễ phải
 *  khớp — ca sáng cần 06:00 mà tới chiều vẫn chưa "Quá hạn" thì đá ngay với chính cột vừa hiện giờ
 *  cạnh nó (task-8-review.md Important 4). Không có `canLuc` (yêu cầu kho thường) → giữ NGUYÊN
 *  hành vi cũ, so theo ngày trơn. */
export function isOverdue(
  ngayCan: string | null,
  status: StockRequestStatus,
  canLuc?: string | null,
): boolean {
  if (CLOSED.includes(status)) return false;
  if (canLuc) return new Date(canLuc).getTime() < Date.now();
  if (!ngayCan) return false;
  return ngayCan < todayISO();
}

/** Kho đang chọn nhớ theo màn (API chỉ trả `muc_ton`/lô khi biết kho). */
export function readStoredKho(key: string): number | null {
  const raw = localStorage.getItem(key);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function writeStoredKho(key: string, value: number | null): void {
  if (value == null) localStorage.removeItem(key);
  else localStorage.setItem(key, String(value));
}

/** Khoảng ngày [from,to] (yyyy-mm-dd). Rỗng cả hai = không lọc. `val` rỗng = rớt khi ĐANG lọc. */
export function inDateRange(val: string, range: { from: string; to: string }): boolean {
  if (!range.from && !range.to) return true;
  if (!val) return false;
  if (range.from && val < range.from) return false;
  if (range.to && val > range.to) return false;
  return true;
}

/** Tiêu đề cột NGÀY có bộ lọc khoảng: bấm nhãn → bung popup 2 ô Từ/Đến. Lọc RỖNG khi cả hai trống.
 *  Dùng chung cho màn Yêu cầu & Phiếu từ yêu cầu — bấm cột nào lọc đúng cột đó, có chấm báo đang lọc. */
export function DateFilterHead({
  label,
  from,
  to,
  onChange,
  className,
  style,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTableCellElement>(null);
  const active = !!(from || to);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      // Lịch nổi của ô ngày (ChonNgay) portal ra body — bấm trong đó không phải bấm ra ngoài.
      if ((e.target as Element | null)?.closest?.(".cn-hop")) return;
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <th ref={ref} style={style} className={`kho-colfil${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className={`kho-colfil__btn${active ? " is-active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Bấm để lọc theo khoảng ngày"
      >
        {label}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        {active && <span className="kho-colfil__dot" />}
      </button>
      {open && (
        <div className="kho-colfil__pop" role="dialog">
          <label className="kho-colfil__row">
            <span>Từ</span>
            <ChonNgay className="rc-input" aria-label="Từ ngày" value={from} max={to || undefined}
              onChange={(v) => onChange(v, to)} />
          </label>
          <label className="kho-colfil__row">
            <span>Đến</span>
            <ChonNgay className="rc-input" aria-label="Đến ngày" value={to} min={from || undefined}
              onChange={(v) => onChange(from, v)} />
          </label>
          {active && (
            <button type="button" className="rc__link-btn kho-colfil__clear"
              onClick={() => { onChange("", ""); setOpen(false); }}>
              Xóa lọc
            </button>
          )}
        </div>
      )}
    </th>
  );
}

/** Khoảng SỐ [from,to]. `from`/`to` là chuỗi từ ô number (rỗng = không chặn phía đó). `val` null/NaN
 *  → rớt khi ĐANG lọc. */
export function inNumRange(val: number | null | undefined, range: { from: string; to: string }): boolean {
  const lo = range.from.trim() === "" ? null : Number(range.from);
  const hi = range.to.trim() === "" ? null : Number(range.to);
  if (lo === null && hi === null) return true;
  if (val == null || !Number.isFinite(val)) return false;
  if (lo !== null && Number.isFinite(lo) && val < lo) return false;
  if (hi !== null && Number.isFinite(hi) && val > hi) return false;
  return true;
}

/** Tiêu đề cột SỐ có bộ lọc khoảng: bấm nhãn → bung popup 2 ô Từ/Đến (number). Chấm báo đang lọc.
 *  `className` (vd "kho-bc__num") giữ canh phải như cột số thường. */
export function NumFilterHead({
  label,
  from,
  to,
  onChange,
  className,
  style,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTableCellElement>(null);
  const active = !!(from || to);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <th ref={ref} style={style} className={`kho-colfil kho-colfil--num${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className={`kho-colfil__btn${active ? " is-active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Bấm để lọc theo khoảng số"
      >
        {label}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        {active && <span className="kho-colfil__dot" />}
      </button>
      {open && (
        <div className="kho-colfil__pop" role="dialog">
          <label className="kho-colfil__row">
            <span>Từ</span>
            <input type="number" className="rc-input" value={from}
              onChange={(e) => onChange(e.target.value, to)} />
          </label>
          <label className="kho-colfil__row">
            <span>Đến</span>
            <input type="number" className="rc-input" value={to}
              onChange={(e) => onChange(from, e.target.value)} />
          </label>
          {active && (
            <button type="button" className="rc__link-btn kho-colfil__clear"
              onClick={() => { onChange("", ""); setOpen(false); }}>
              Xóa lọc
            </button>
          )}
        </div>
      )}
    </th>
  );
}
