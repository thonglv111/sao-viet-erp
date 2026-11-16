/** Hàm THUẦN của Thuê gia công (spec docs/superpowers/specs/2026-11-13-module-gia-cong-ngoai-design.md).
 *  Không gọi API, không React — vitest soi thẳng. */
import type { LsxListGiaCong, LsxLoaiBuoc } from "../../api/client";
import type { MauTT } from "../../components/LuoiDs";
import type { TgcTinhTrangHangCho, TgcTrangThai, TgcTrangThaiDon } from "../../api/thueGiaCong";

/** Tối thiểu một bước cần có để suy dải — `EditRow` của bảng routing khớp kiểu này. */
export interface BuocDai {
  /** `step_key` — khớp `LsxCongDoanPhuThuoc.buoc_truoc_id`/`buoc_sau_id` ở server. */
  key: string;
  ten: string;
  loai_buoc: LsxLoaiBuoc;
  /** Tiền nhiệm TRỰC TIẾP của bước này (cạnh DAG `truoc → bước này`). */
  phu_thuoc_step_keys: string[];
}

export interface ViTriDai {
  /** Tên bước liền trước CÙNG việc (null = bước này mở đầu việc). */
  truoc: string | null;
  /** Tên bước liền sau CÙNG việc (null = bước này là cuối việc). */
  sau: string | null;
  laCuoi: boolean;
}

/** Lệnh có khai ÍT NHẤT một cạnh phụ thuộc không — routing tuyến tính cũ (chưa từng khai cạnh
 *  nào) thì "liền nhau" lùi về so THỨ TỰ MẢNG, đúng luật server (`quet_dai_thue_ngoai`). */
function coCanhNao(rows: BuocDai[]): boolean {
  return rows.some((r) => r.phu_thuoc_step_keys.length > 0);
}

function cungViec(rows: BuocDai[], a: BuocDai | undefined, c: BuocDai | undefined): boolean {
  if (!a || !c) return false;
  if (a.loai_buoc !== "thue_ngoai" || c.loai_buoc !== "thue_ngoai") return false;
  // "Liền nhau" theo CẠNH DAG; routing không khai cạnh nào thì so thứ tự mảng.
  return !coCanhNao(rows) || c.phu_thuoc_step_keys.includes(a.key);
}

/** Vị trí của bước `i` trong DẢI thuê gia công — cùng luật máy chủ lúc phát hành
 *  (`services/thue_gia_cong/viec.py::quet_dai_thue_ngoai`): các bước Thuê ngoài LIỀN NHAU theo
 *  cạnh DAG ⇒ MỘT việc. Lệnh không chọn nhà gia công nên không còn điều kiện cùng nhà. */
export function viTriTrongDai(rows: BuocDai[], i: number): ViTriDai | null {
  const r = rows[i];
  if (!r || r.loai_buoc !== "thue_ngoai") return null;
  const truoc = cungViec(rows, rows[i - 1], r) ? rows[i - 1].ten : null;
  const sau = cungViec(rows, r, rows[i + 1]) ? rows[i + 1].ten : null;
  return { truoc, sau, laCuoi: sau == null };
}

export const NHAN_TINH_TRANG: Record<TgcTinhTrangHangCho, string> = {
  san_sang_giao: "Sẵn sàng giao",
  cho_buoc_truoc: "Chờ bước trước",
  chua_dat: "Chưa đặt",
};

/** Nhãn NGẮN cho chip dòng bảng lệnh. */
export const NHAN_NGAN_LENH: Record<LsxListGiaCong["trang_thai"], string> = {
  chua_dat: "chưa đặt",
  da_dat: "đã đặt",
  da_xong: "xong",
};

/** Màu chip theo trạng thái việc trên lệnh (bộ `--tt-*` qua `ChipTT`). */
export const MAU_TRANG_THAI_VIEC: Record<TgcTrangThai, MauTT> = {
  chua_dat: "vang",
  nhap: "xam",
  da_dat: "cyan",
  dang_o_ngoai: "cam",
  da_ve: "tim",
  xong: "la",
};

export const MAU_TINH_TRANG: Record<TgcTinhTrangHangCho, MauTT> = {
  san_sang_giao: "la",
  cho_buoc_truoc: "xam",
  chua_dat: "vang",
};

export const so = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("vi-VN", { maximumFractionDigits: 3 });

export const tien = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(n).toLocaleString("vi-VN")}đ`;

/** Tạm tính của một dòng = số × đơn giá, làm tròn đồng. */
export function tamTinh(sl: number | null | undefined, donGia: number | null | undefined): number {
  return Math.round((Number(sl) || 0) * (Number(donGia) || 0));
}

/** dd/mm từ chuỗi ngày ISO (yyyy-mm-dd hoặc có giờ). Trống ⇒ "". */
export function ngayNgan(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}` : "";
}

export const NHAN_TRANG_THAI_DON: Record<TgcTrangThaiDon, string> = {
  nhap: "Nháp",
  da_dat: "Đã đặt",
  giao_mot_phan: "Đã giao một phần",
  giao_du: "Đã giao đủ",
  ve_mot_phan: "Đã về một phần",
  hoan_tat: "Hoàn tất",
  huy: "Đã huỷ",
};

export const MAU_TRANG_THAI_DON: Record<TgcTrangThaiDon, MauTT> = {
  nhap: "xam",
  da_dat: "cyan",
  giao_mot_phan: "cam",
  giao_du: "cam",
  ve_mot_phan: "tim",
  hoan_tat: "la",
  huy: "do",
};

/** Số gõ trong ô định dạng (chấm nghìn, phẩy thập phân) ⇒ số; trống ⇒ null. */
export function docSoVi(s: string): number | null {
  const t = s.replace(/\./g, "").replace(",", ".").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Hiện lại số đang gõ có chấm nghìn, giữ phần thập phân người đang gõ dở ("1.234,5"). */
export function vietSoGo(s: string): string {
  const sach = s.replace(/[^\d,]/g, "");
  const [nguyen, ...le] = sach.split(",");
  const n = nguyen.replace(/^0+(?=\d)/, "");
  const co = n ? Number(n).toLocaleString("vi-VN") : "";
  return le.length ? `${co || "0"},${le.join("").slice(0, 3)}` : co;
}
