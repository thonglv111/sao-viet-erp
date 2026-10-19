// Hàm dùng chung của màn Giao hàng (tách từ pages/GiaoHangPage.tsx).
import type { CaLuotKetQua, DeliveryRequestLine, DeliveryTrip, LuotXeChiTiet } from "../../../../api/client";
import { api } from "../../../../api/client";
import { gomCum } from "../../gomCum";
import { NHAN_TRANG_THAI_CHUYEN } from "./constants";

/** Sắc của pill trạng thái — bộ màu chip chung `--tt-*` (tokens.css). "on"/"off"/"warn" là ba tông
 *  chung (xong lá · dừng/huỷ xám · chờ vàng) cho các pill một-hai trạng thái. */
export type GhTone =
  | "on" | "off" | "warn"
  | "xanh" | "cyan" | "cham" | "tim" | "ngoc" | "cam" | "do" | "vang" | "xam" | "la" | "slate";

/** Mỗi trạng thái chuyến một màu — liếc là biết chuyến đang ở đâu. */
const TONE_CHUYEN: Record<string, GhTone> = {
  da_len_ke_hoach: "xanh",
  dang_chuan_bi: "tim",
  da_lay_hang: "cham",
  dang_giao: "cyan",
  thanh_cong: "la",
  giao_thieu: "cam",
  hen_lai: "vang",
  that_bai: "do",
  dang_tra_hang: "ngoc",
  da_tra_hang: "slate",
  da_huy: "xam",
};

/** Màu trạng thái YÊU CẦU giao — dùng chung drawer Giao hàng. */
export const TONE_YC: Record<string, GhTone> = {
  cho_len_ke_hoach: "vang",
  dang_thuc_hien: "cyan",
  da_giao_du: "la",
  giao_thieu: "cam",
  that_bai: "do",
  chuyen_da_huy: "tim",
  da_huy: "xam",
};

/** Màu trạng thái NHÂN VIÊN giao hàng. */
export const TONE_NV: Record<string, GhTone> = {
  ranh: "la",
  co_lich: "xanh",
  dang_giao: "cyan",
  dang_tra_hang: "ngoc",
  nghi: "xam",
};

/** Nhãn trạng thái của MỘT chuyến — MỘT hàm cho MỌI chỗ render.
 *
 *  Kho lập phiếu xong ⇒ hàng đã soạn, tài xế tới lấy được, nên chữ đổi thành "Kho đã chuẩn bị
 *  xong" (chủ chốt 20/08/2026). Kho KHÔNG bấm gì trên màn này — cờ `kho_da_lap_phieu` đọc ngược
 *  từ sổ kho.
 *
 *  Viết thành hàm vì bảng chuyến render ở HAI chỗ (tab Đơn giao hàng và tab Yêu cầu giao); chép
 *  hai bản là sớm muộn hai chỗ nói hai kiểu. */
export function nhanChuyen(t: { trang_thai: string; kho_da_lap_phieu?: boolean }): string {
  if (t.trang_thai === "dang_chuan_bi" && t.kho_da_lap_phieu) return "Kho đã chuẩn bị xong";
  return NHAN_TRANG_THAI_CHUYEN[t.trang_thai] ?? t.trang_thai;
}

export function toneChuyen(tt: string): GhTone {
  return TONE_CHUYEN[tt] ?? "slate";
}

/** Chuyến CHƯA có kết quả giao. */
export const CHUA_KET_QUA = ["da_len_ke_hoach", "dang_chuan_bi", "da_lay_hang", "dang_giao"];

/** Chuyến thất bại (kể cả đang/đã trả hàng về kho, hẹn lại kiểu cũ) — khách không nhận gì. */
export const CHUYEN_THAT_BAI = ["that_bai", "dang_tra_hang", "da_tra_hang", "hen_lai"];

export const so = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("vi-VN"));

const GIO_NGAY = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
});
const NGAY = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric",
});

function ngayGio(v?: string | null): Date | null {
  if (!v) return null;
  // Máy chủ có chỗ trả ISO KHÔNG hậu tố múi giờ (SQLite) — chuỗi naive là UTC, như `fmtDateTime`.
  const coMui = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(v);
  const d = new Date(!coMui && v.includes("T") ? `${v}Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "07:30 06/10" — giờ trước, ngày sau, bỏ giây và năm: đủ để điều độ trong tuần. */
export function gioNgay(v?: string | null): string {
  const d = ngayGio(v);
  if (!d) return "—";
  const p = Object.fromEntries(GIO_NGAY.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute} ${p.day}/${p.month}`;
}

/** "06/10/2026" — ô ngày THUẦN (`date`) giữ nguyên, không đổi múi giờ. */
export function ngay(v?: string | null): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = ngayGio(v);
  return d ? NGAY.format(d) : v;
}

/** "06/10" của một ô ngày thuần — cột Điểm giao chỉ cần ngày tháng hẹn. */
export function ngayNgan(v?: string | null): string {
  const m = v ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
  return m ? `${m[3]}/${m[2]}` : "—";
}

/** Hẹn kho của chuyến (mg 0400 — thay giờ lấy hàng): "14:00 12/10" từ Cần lúc của đề nghị xuất,
 *  chỉ hẹn ngày thì "12/10". Cần lúc là GIỜ TƯỜNG nhà máy (không múi) nên đọc thẳng chữ, không qua
 *  `ngayGio` (hàm đó coi chuỗi không múi là UTC). null = chưa gửi kho. */
export function henKho(t: { yeu_cau_kho_can_luc?: string | null; yeu_cau_kho_ngay_can?: string | null }): string | null {
  const m = t.yeu_cau_kho_can_luc ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(t.yeu_cau_kho_can_luc) : null;
  if (m) return `${m[4]}:${m[5]} ${m[3]}/${m[2]}`;
  return t.yeu_cau_kho_ngay_can ? ngayNgan(t.yeu_cau_kho_ngay_can) : null;
}

/** "2026-10-04" — ngày theo giờ VN của một mốc giờ; chuỗi đã là ngày thì giữ nguyên. */
export function ngayIso(v?: string | null): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = ngayGio(v);
  return d ? d.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }) : null;
}

/** Ngày khách nhận so với ngày hẹn: "Trước hẹn 26 ngày" / "Trễ 3 ngày" / "Đúng hẹn". */
export function soVoiHen(hen?: string | null, nhan?: string | null): { text: string; tre: boolean } | null {
  const n = lechHen(hen, nhan);
  if (n == null) return null;
  if (n === 0) return { text: "Đúng hẹn", tre: false };
  return n < 0 ? { text: `Trước hẹn ${-n} ngày`, tre: false } : { text: `Trễ ${n} ngày`, tre: true };
}

/** Số ngày khách nhận lệch so với hẹn (dương = trễ). */
function lechHen(hen?: string | null, nhan?: string | null): number | null {
  const a = ngayIso(hen);
  const b = ngayIso(nhan);
  if (!a || !b) return null;
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Một MÓN giao như khách mua: cụm Ruột + Bìa là một quyển (một mã kho, một số). */
export interface MonGiao {
  /** Dòng đầu cụm — khoá React. */
  id: number;
  ten: string;
  qty: number;
  dvt: string | null;
  /** Cụm giao cùng một số ⇒ lấy dòng ít nhất cho chắc. */
  da_giao: number;
  /** Tên các dòng giá trong cụm (rỗng khi cụm một dòng) — để rê chuột xem. */
  thanhPhan: string[];
}

/** Gom dòng yêu cầu giao theo CỤM BÁN (12/10/2026). Bày thẳng `lines` thì một quyển sách hiện
 *  thành "Ruột sách +1 món" trong khi kho xuất đúng MỘT mã thành phẩm. */
export function monGiao(lines: DeliveryRequestLine[]): MonGiao[] {
  return gomCum(lines.map((l) => ({ ...l, mo_ta: l.mo_ta ?? l.hang_ten ?? null }))).map((c) => ({
    id: c.dau.id,
    ten: c.ten,
    qty: c.dau.qty,
    dvt: c.donVi ?? c.dau.dvt,
    da_giao: Math.min(...c.dong.map((d) => d.da_giao)),
    thanhPhan: c.dong.length > 1 ? c.dong.map((d) => d.mo_ta ?? "").filter(Boolean) : [],
  }));
}

/** "So với hẹn" của cả lượt: lấy điểm LỆCH NHẤT trong các điểm đã có kết quả. Lượt nhiều điểm mà
 *  có điểm trễ thì kèm "k/n điểm trễ". Mọi lần lên đơn đều ra lượt (12/10/2026) — chỉ tính chuyến
 *  lẻ thì cột này trống với mọi đơn mới. */
export function soVoiHenLuot(ds: DeliveryTrip[]): { text: string; tre: boolean; phu?: string } | null {
  const lech = ds
    .filter(coKetQua)
    .map((t) => lechHen(t.ngay_can_giao, t.thoi_gian_ket_thuc))
    .filter((n): n is number => n != null);
  if (!lech.length) return null;
  const te = Math.max(...lech);
  const kq = te === 0 ? { text: "Đúng hẹn", tre: false }
    : te < 0 ? { text: `Trước hẹn ${-te} ngày`, tre: false }
    : { text: `Trễ ${te} ngày`, tre: true };
  const soTre = lech.filter((n) => n > 0).length;
  return ds.length > 1 && soTre > 0 ? { ...kq, phu: `${soTre}/${ds.length} điểm trễ` } : kq;
}

/** Địa chỉ rút gọn cho bảng: bỏ số nhà/đường đầu và tỉnh/thành cuối, giữ khu + phường/xã — đủ để
 *  biết điểm nằm vùng nào. Địa chỉ ngắn (≤ 2 mẩu) giữ nguyên. */
export function diaChiGon(dc?: string | null): string {
  const p = (dc ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (p.length <= 2) return p.join(", ");
  return p.slice(-3, -1).join(", ");
}

export function lienKetBanDo(dc: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dc)}`;
}

/** Số điện thoại đọc theo cụm "0779 958 485". */
export function sdtDoc(s: string): string {
  const d = s.replace(/\s+/g, "");
  return /^\d{10}$/.test(d) ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : s;
}

/** Trạng thái CẢ lượt — một câu, đọc từ số đếm máy chủ trả (không tự suy từ từng dòng hai kiểu). */
export function trangThaiLuot(l: LuotXeChiTiet): { text: string; tone: GhTone } {
  if (l.ve_kho_luc) return { text: "Đã về kho", tone: "on" };
  if (l.cho_ve_kho) return { text: "Chờ về kho", tone: "warn" };
  if (l.so_dang_giao > 0) return { text: "Đang giao", tone: "cyan" };
  // Xe chưa đi: lượt theo điểm CHẬM nhất. Một điểm kho đã xuất mà nói cả lượt "Đã lấy hàng" thì
  // điều phối tưởng xe đủ hàng (lỗi thật 12/10/2026: LX-261012-WKEM lấy 1/3 mà ghi Đã lấy hàng).
  if (l.so_cho_lay_hang > 0) {
    if (l.so_cho_bat_dau > 0)
      return { text: `Kho đã xuất ${l.so_cho_bat_dau}/${l.so_cho_bat_dau + l.so_cho_lay_hang}`, tone: "tim" };
    const xong = l.diem.every((t) => t.trang_thai !== "dang_chuan_bi" || t.kho_da_lap_phieu);
    return { text: xong ? "Kho đã chuẩn bị xong" : "Chờ kho xuất", tone: xong ? "ngoc" : "tim" };
  }
  if (l.so_cho_bat_dau > 0) return { text: "Đã lấy hàng", tone: "cham" };
  // Lượt cũ trước 12/10/2026 còn chuyến chưa gửi kho — nay lên đơn là gửi luôn.
  return { text: "Đã lên đơn", tone: "slate" };
}

export const coKetQua = (t: DeliveryTrip) => !CHUA_KET_QUA.includes(t.trang_thai);

export type FormLuot = "xuat_phat" | "ve_kho";

/** Một bước CẢ LƯỢT: hoặc mở ô nhập (`form`), hoặc gọi thẳng máy chủ (`lam`). */
export type BuocLuot =
  | { nhan: string; form: FormLuot }
  | { nhan: string; lam: (token: string) => Promise<CaLuotKetQua>; bao: (r: CaLuotKetQua) => string };

/** Các bước còn làm được của lượt — cái ĐẦU là việc chính. Dòng bảng và đầu ngăn đọc CÙNG một hàm.
 *  Không có bước gửi kho / lấy hàng (12/10/2026): lên đơn là gửi kho, kho ghi sổ xuất là chuyến tự
 *  sang đã lấy hàng. Lượt lệch nhịp (một điểm kho còn soạn) vẫn bắt đầu giao được điểm đã xuất. */
export function buocLuot(l: LuotXeChiTiet, canWrite: boolean): BuocLuot[] {
  const ds: BuocLuot[] = [];
  if (canWrite && l.so_cho_bat_dau > 0) {
    const nhan = `Bắt đầu giao (${l.so_cho_bat_dau} điểm)`;
    // Chưa có số xuất phát ⇒ hỏi số trước; có rồi (xe đi dở, bốc thêm điểm) thì đi luôn.
    ds.push(l.so_dong_ho_xuat_phat == null
      ? { nhan, form: "xuat_phat" }
      : { nhan, lam: (tk) => api.giaoHang.batDauGiaoCaLuot(tk, l.id),
          bao: (r) => `Đã bắt đầu giao ${r.so_chuyen} điểm.` });
  }
  if (canWrite && l.cho_ve_kho) ds.push({ nhan: "Về kho", form: "ve_kho" });
  return ds;
}

/** "2026-10-07" → "07/10/2026" — ngày thuần, không qua Date để khỏi lệch múi. */
export function ngayThuan(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** Hạn giao nói theo hôm nay: quá hạn / hôm nay / ngày mai có pill, xa hơn chỉ ghi ngày. */
export function hanGiao(iso: string | null | undefined, homNay = new Date()):
  { text: string; tone: GhTone | null } {
  if (!iso) return { text: "—", tone: null };
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return { text: iso, tone: null };
  const han = Date.UTC(y, m - 1, d);
  const nay = Date.UTC(homNay.getFullYear(), homNay.getMonth(), homNay.getDate());
  const lech = Math.round((han - nay) / 86_400_000);
  if (lech < 0) return { text: `Quá hạn ${-lech} ngày`, tone: "do" };
  if (lech === 0) return { text: "Hôm nay", tone: "vang" };
  if (lech === 1) return { text: "Ngày mai", tone: "xanh" };
  return { text: ngayThuan(iso), tone: null };
}
