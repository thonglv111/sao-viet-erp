// Chữ của màn Theo dõi sản xuất theo đơn (12/10/2026): dịch `o`, `nhom`, cờ vướng của máy chủ sang lời
// thường. Không nối mẩu dữ liệu bằng dấu chấm giữa hay dấu phẩy — trả từng mẩu để màn đặt vào span riêng.
import type { TdsxChang, TdsxDonDong, TdsxMonTomTat, TdsxNhomMon } from "../api/client";

const so = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(n).toLocaleString("vi-VN") : "0";

/** Bốn chấm chặng của dòng đơn. `xong` = đã qua cả bốn. */
export const CHANG4: { key: Exclude<TdsxChang, "xong">; ten: string }[] = [
  { key: "lenh", ten: "Lệnh" },
  { key: "sx", ten: "SX" },
  { key: "kho", ten: "Kho" },
  { key: "giao", ten: "Giao" },
];

export const NHAN_VUONG: Record<string, string> = {
  tre: "Trễ hạn giao",
  su_co: "Sự cố máy",
  tam_dung: "Tạm dừng",
  thieu_vat_tu: "Thiếu vật tư",
  kcs_khong_dat: "KCS không đạt",
  dong_thieu: "Đóng lệnh thiếu",
  chua_lenh: "Chưa có lệnh",
};

export const NHOM_MON: { key: TdsxNhomMon | "tat_ca"; ten: string }[] = [
  { key: "tat_ca", ten: "Tất cả" },
  { key: "vuong", ten: "Đang vướng" },
  { key: "dang", ten: "Đang làm" },
  { key: "chua", ten: "Chưa có lệnh" },
  { key: "kho", ten: "Đã nhập kho" },
  { key: "giao", ten: "Đã giao" },
];

/** "Đang ở" của một mặt hàng: [chữ chính, chữ phụ mờ]. */
export function dangO(m: Pick<TdsxMonTomTat, "o" | "nhom" | "buoc" | "buoc_so" | "buoc_tong" | "pct" | "nha_gia_cong" | "kho_da_nhan" | "dat">): [string, string | null] {
  if (m.nhom === "giao") return ["Đã giao đủ", null];
  switch (m.o) {
    case "du_hang":
      return ["Đã nhập kho", null];
    case "ngoai":
      return [m.nha_gia_cong ? `Ở ${m.nha_gia_cong}` : "Ở nhà gia công", "gia công ngoài"];
    case "xuong":
      return [
        m.buoc ?? "Đang sản xuất",
        m.buoc_so && m.buoc_tong ? `bước ${m.buoc_so} trên ${m.buoc_tong}` : m.pct != null ? `${m.pct}%` : null,
      ];
    case "cho_kho":
      return ["Xong sản xuất", m.kho_da_nhan > 0 ? `kho nhận ${so(m.kho_da_nhan)} trên ${so(m.dat)}` : "chờ nhập kho"];
    case "dong_thieu":
      return ["Đóng lệnh thiếu", `kho nhận ${so(m.kho_da_nhan)} trên ${so(m.dat)}`];
    case "chua_xuong":
      return ["Chưa xuống xưởng", null];
    default:
      return ["Chưa có lệnh", null];
  }
}

/** Cột "Đang làm" của dòng đơn. Đơn một món thì nói món đó ở đâu; nhiều món thì đếm theo món. */
export function dangLamDon(d: TdsxDonDong): [string, string | null] {
  if (d.nhom === "da_giao") return ["Đã giao đủ", null];
  if (d.so_mon > 1) {
    if (d.nhom === "cho_giao") return [`Đủ hàng ${d.so_mon} mặt hàng`, "chờ giao"];
    if (d.so_mon_kho > 0) return [`${d.so_mon_kho} trên ${d.so_mon} đã nhập kho`, null];
  }
  if (!d.dai_dien) return ["Chưa có lệnh", null];
  if (d.nhom === "cho_giao") return ["Đủ hàng", "chờ giao"];
  return dangO(d.dai_dien);
}

/** Cột "Đang vướng" — một câu, không lặp lại số ngày trễ (đã có ở cột Hạn giao). */
export function cauVuong(d: TdsxDonDong): string | null {
  const v = d.vuong;
  if (!v) return null;
  if (v.ly_do === "tre") return "Đã quá hạn giao";
  const nhan = NHAN_VUONG[v.ly_do] ?? v.ly_do;
  const dau = d.so_mon > 1 && v.so_mon > 0 ? `${v.so_mon} mặt hàng ${nhan.toLowerCase()}` : nhan;
  return v.buoc ? `${dau} ở ${v.buoc}` : dau;
}

/** Chip hạn giao: [chữ, màu]. Đã giao đủ thì không chip. */
export function chipHan(d: Pick<TdsxDonDong, "nhom" | "tre_ngay" | "con_ngay" | "han_giao">): [string, "do" | "cam" | "xam"] | null {
  if (d.nhom === "da_giao" || !d.han_giao) return null;
  if (d.tre_ngay) return [`trễ ${d.tre_ngay} ngày`, "do"];
  if (d.con_ngay == null) return null;
  if (d.con_ngay === 0) return ["hạn hôm nay", "cam"];
  return [`còn ${d.con_ngay} ngày`, d.con_ngay <= 3 ? "cam" : "xam"];
}
