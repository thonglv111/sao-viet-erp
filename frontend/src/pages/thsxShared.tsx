// Mảnh dùng chung của màn THỰC HIỆN SẢN XUẤT tại tổ (`san_xuat`, "một bàn làm việc").
//
// Ở đây CHỈ những thứ độc lập trình bày, để cả `ThucHienSxPage`, `ThsxLichNgay`, `ThsxDrawer`
// cùng dùng mà không vòng import:
//  1) `THSX_TT_META` + `ThsxTrangThaiPill` — pill trạng thái công việc (LUÔN icon + CHỮ, a11y).
//  2) Nhãn dẫn xuất (serial nguồn, icon nguồn) + digest đếm theo trạng thái.
//
// LƯỚI NGÀY của view Lịch **tái dùng** hình học của bàn Xếp lịch (`xlShared.tsx` khungLuoi / x) —
// KHÔNG chép lại.
import { Icon, type IconName } from "../components/Icons";
import type { SxLenhNhom, SxWorkItem, SxWorkItemsOut } from "../api/client";
import { num } from "./keHoachSxShared";
import { nhanChangLenh } from "./lsxBuoc";

// ============================ TRẠNG THÁI CÔNG VIỆC ==========================
/** 4 trạng thái enum backend (`models/san_xuat.py`): released / running / paused / completed. */
export type SxTrangThai = "released" | "running" | "paused" | "completed";

export interface ThsxTtMeta {
  label: string;
  icon: IconName;
  /** class họ màu của pill + neo vân/độ-mờ của thanh (định nghĩa trong thuc-hien-sx.css). */
  cls: string;
}

export const THSX_TT_META: Record<SxTrangThai, ThsxTtMeta> = {
  released: { label: "Chờ làm", icon: "clock", cls: "thsx-tt--released" },
  running: { label: "Đang chạy", icon: "play", cls: "thsx-tt--running" },
  paused: { label: "Tạm dừng", icon: "pause", cls: "thsx-tt--paused" },
  completed: { label: "Hoàn thành", icon: "check", cls: "thsx-tt--completed" },
};

/** Meta an toàn cho một chuỗi trạng thái bất kỳ (lùi về "released" nếu lạ). */
export function ttMeta(tt: string): ThsxTtMeta {
  return THSX_TT_META[(tt as SxTrangThai)] ?? THSX_TT_META.released;
}

/** Pill trạng thái — r99, LUÔN kèm icon + chữ (người mù màu vẫn phân biệt). */
export function ThsxTrangThaiPill({ tt, size = "sm" }: { tt: string; size?: "sm" | "xs" }) {
  const m = ttMeta(tt);
  return (
    <span className={`thsx-tt ${m.cls} thsx-tt--${size}`}>
      <Icon name={m.icon} size={size === "xs" ? 11 : 13} />
      <span>{m.label}</span>
    </span>
  );
}

// ============================ NHÃN DẪN XUẤT =================================
/** SERIAL ngắn cho nhãn thanh: bỏ tiền tố năm dùng-chung ("LSX26-0012" → "0012"). Mã đầy đủ vẫn ở
 *  tooltip/aria nên nhãn ngắn không mất thông tin tra cứu. Thiếu mã ⇒ "—". */
export function sxSerial(nguonMa: string | null | undefined): string {
  const raw = (nguonMa ?? "").trim();
  if (!raw) return "—";
  const i = raw.lastIndexOf("-");
  return i >= 0 && i < raw.length - 1 ? raw.slice(i + 1) : raw;
}

/** Icon phân biệt nguồn: lệnh sản xuất (workflow) vs bài ghép (layers); rỗng ⇒ hộp. */
export function sxNguonIcon(nguonLoai: string): IconName {
  if (nguonLoai === "bai_ghep") return "layers";
  if (nguonLoai === "lsx") return "workflow";
  return "box";
}

/** Ô khối lượng của một thẻ việc. Bước NGOÀI dòng giấy đo bằng đơn vị của CHÍNH nó (ghi kẽm đếm
 *  bản, đóng thùng đếm thùng) nên vào = ra — hiện MỘT số "4 bản kẽm", vẽ mũi tên hai đầu giống
 *  nhau chỉ là nhiễu. Cờ `ngoai_dong` là ảnh chụp của server; đừng suy lại từ mã đơn vị. */
export function slText(w: SxWorkItem): string {
  if (w.ngoai_dong) {
    const dv = nhanChangLenh(w.don_vi_ra || w.don_vi_vao, w.don_vi_tinh);
    return `${num(w.so_luong_ra)}${dv ? ` ${dv}` : ""}`;
  }
  const vao = `${num(w.so_luong_vao)}${w.don_vi_vao ? ` ${nhanChangLenh(w.don_vi_vao, w.don_vi_tinh)}` : ""}`;
  const ra = `${num(w.so_luong_ra)}${w.don_vi_ra ? ` ${nhanChangLenh(w.don_vi_ra, w.don_vi_tinh)}` : ""}`;
  return `${vao} → ${ra}`;
}

/** Ô khối lượng trên bảng / lịch của tổ — luật 27/09/2026: NHẬN bao nhiêu, TỐT bao nhiêu, bấm
 *  Kết thúc thì phần còn lại là LỖI ("Nhận 1.300 tờ in · Tốt 1.200 tờ in · Lỗi 100"). Không bày
 *  kế hoạch/mục tiêu ở đây. Số nhận do máy chủ chốt (`nhan`: bước đầu = số vào lấy từ kho). Bước
 *  ngoài dòng giấy chỉ một đơn vị ⇒ chỉ số tốt. Drawer mục "Thông tin kế hoạch" vẫn dùng `slText`. */
export function slThucTe(w: SxWorkItem): string[] {
  // Trả từng MẨU (Nhận / Tốt / Lỗi) để nơi vẽ tách bằng khoảng trống — không nối bằng dấu.
  const dvRa = nhanChangLenh(w.don_vi_ra || (w.ngoai_dong ? w.don_vi_vao : null), w.don_vi_tinh);
  const tot = `Tốt ${num(w.da_lam ?? 0)}${dvRa ? ` ${dvRa}` : ""}`;
  const loi = w.loi != null ? [`Lỗi ${num(w.loi)}`] : [];
  if (w.ngoai_dong || w.nhan == null) return [tot, ...loi];
  const dvVao = w.don_vi_vao ? ` ${nhanChangLenh(w.don_vi_vao, w.don_vi_tinh)}` : "";
  return [`Nhận ${num(w.nhan)}${dvVao}`, tot, ...loi];
}

/** Cột "Sản lượng tốt" của bảng bàn tổ: CHỈ số tốt kèm đơn vị ra ("1.200 tờ in"). */
export function slTot(w: SxWorkItem): string {
  const dv = nhanChangLenh(w.don_vi_ra || (w.ngoai_dong ? w.don_vi_vao : null), w.don_vi_tinh);
  return `${num(w.da_lam ?? 0)}${dv ? ` ${dv}` : ""}`;
}

/** Thanh tiến độ: tốt / nhận (quy về đơn vị ra). Đã Kết thúc = xong, luôn 100% — phần hụt đã
 *  thành số lỗi, không còn "thiếu" treo mãi. null = không biết số nhận ⇒ không vẽ thanh. */
export function tienDoThucTe(w: SxWorkItem): { pct: number; tot: number; nhan: number | null } | null {
  const tot = w.da_lam ?? 0;
  const nhan = w.nhan_ra ?? null;
  if (w.trang_thai === "completed") return { pct: 100, tot, nhan };
  if (nhan == null || nhan <= 0) return null;
  return { pct: Math.min(100, Math.round((tot / nhan) * 100)), tot, nhan };
}

/** "13 phút (11 – 15)" — phút CHẠY của thẻ kèm dải theo tốc độ máy (§7). Ba số bằng nhau ⇒ máy
 *  chưa khai `toc_do_min/max`, bỏ hẳn phần ngoặc thay vì in "(13 – 13)".
 *
 *  `null` ⇒ nơi gọi bỏ HẲN dòng, hai ca: lệnh phát hành trước 10/09/2026 (ảnh chụp chưa có khoá),
 *  và bước không có máy để tính giờ (bước tổ, bước ngoài dòng chưa gán máy) — "0 phút" ở đó là
 *  con số bịa, thợ đọc xong lại tưởng việc này không mất thời gian. */
export function phutChayText(w: SxWorkItem): string | null {
  if (w.chay_phut == null || w.chay_phut <= 0) return null;
  const giua = Math.round(w.chay_phut);
  const lo = w.chay_phut_min == null ? giua : Math.round(w.chay_phut_min);
  const hi = w.chay_phut_max == null ? giua : Math.round(w.chay_phut_max);
  return lo === giua && hi === giua ? `${giua} phút` : `${giua} phút (${lo} – ${hi})`;
}

/** Việc có đủ mốc kế hoạch để đặt lên trục thời gian? Thiếu ⇒ vào lane "chưa định giờ" ở cột trái. */
export function sxCoGio(w: SxWorkItem): boolean {
  return !!w.du_kien_bat_dau && !!w.du_kien_ket_thuc;
}

// ============================ DIGEST ========================================
export interface ThsxDigest {
  tong: number;
  released: number;
  running: number;
  paused: number;
  completed: number;
}

/** Đếm việc theo trạng thái cho dải digest ở subbar (§3 subbar). */
export function sxDigest(items: SxWorkItem[]): ThsxDigest {
  const d: ThsxDigest = { tong: items.length, released: 0, running: 0, paused: 0, completed: 0 };
  for (const w of items) {
    if (w.trang_thai === "running") d.running += 1;
    else if (w.trang_thai === "paused") d.paused += 1;
    else if (w.trang_thai === "completed") d.completed += 1;
    else d.released += 1;
  }
  return d;
}

// ============================ HAI HÌNH DỮ LIỆU CỦA BÀN ======================
/** Tách đáp ứng `/work-items` thành đúng MỘT hình để màn vẽ (11/09/2026).
 *
 *  Quyết theo cờ `nhom` mà máy chủ trả về, KHÔNG theo "có mảng lệnh hay không": `WorkItemsOut`
 *  khai `lenh: list[...] = []` nên khoá đó LUÔN có mặt kể cả ở chế độ phẳng — đọc theo sự hiện
 *  diện của mảng thì băng KPI cộng trên mảng rỗng và báo 0 việc trong khi Gantt đang vẽ đủ việc.
 *
 *  `cong_viec = null` nghĩa là "màn đang ở hình lệnh", khác hẳn `[]` = "hình phẳng, không có việc
 *  nào" — hai chuyện đó ra hai câu trống khác nhau nên không được gộp. */
export function chonHinhBan(r: SxWorkItemsOut): {
  cong_viec: SxWorkItem[] | null;
  lenh: SxLenhNhom[] | null;
  tongLenh: number;
} {
  if (r.nhom === "phang") {
    return { cong_viec: r.cong_viec ?? [], lenh: null, tongLenh: 0 };
  }
  return { cong_viec: null, lenh: r.lenh ?? [], tongLenh: r.trang?.tong ?? 0 };
}
