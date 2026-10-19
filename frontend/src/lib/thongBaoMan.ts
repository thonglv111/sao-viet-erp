/** Chấm đỏ thanh bên = "có bản ghi mới kể từ lần mở màn trước" (chủ chốt 29/09/2026).
 *  Kênh = khoá module của màn ở máy chủ (`services/thong_bao_man.py`); tổ SX là `to_sx_<id>`. */

const KENH_NAV: Record<string, string> = {
  thu_mua: "mua-hang",
  ke_toan: "ke-toan-don-mua-hang",
  luong: "luong",
  nghi_phep: "nghi-phep",
  tang_ca: "tang-ca",
  cham_cong: "cham-cong",
  bao_gia: "bao-gia",
  don_hang_ban: "don-hang-ban",
  san_xuat: "ke-hoach-sx",
  xep_lich: "xep-lich",
  kho: "kho-main",
  phieu_chi: "ke-toan-phieu-chi",
  phieu_thu: "ke-toan-phieu-thu",
  ky_thuat_may: "sua-chua-may",
  phieu_bao_tri: "phieu-bao-tri",
  khach_hang: "khach-hang",
};
const NAV_KENH: Record<string, string> = Object.fromEntries(
  Object.entries(KENH_NAV).map(([k, n]) => [n, k]),
);
const TIEN_TO_TO = "to_sx_";
const NAV_TO = "thuc-hien-sx:";

export function navCuaKenh(kenh: string): string | null {
  if (kenh.startsWith(TIEN_TO_TO)) return NAV_TO + kenh.slice(TIEN_TO_TO.length);
  return KENH_NAV[kenh] ?? null;
}

export function kenhCuaNav(navId: string): string | null {
  if (navId.startsWith(NAV_TO)) return TIEN_TO_TO + navId.slice(NAV_TO.length);
  return NAV_KENH[navId.split(":")[0]] ?? null;
}

/** Toast khi có bản ghi mới. null = loại đã có toast riêng từ sự kiện của chính nó (quyết định,
 *  bàn giao, bảo trì…) — nhắc thêm là hai toast cho một việc. */
const LOI_NHAC: Record<string, (ma: string | null) => string> = {
  tam_ung_moi: () => "🔔 Có đề nghị tạm ứng mới chờ duyệt",
  nghi_phep_moi: () => "🔔 Có đơn nghỉ phép mới chờ duyệt",
  nghi_phep_xin_huy: () => "🔔 Có yêu cầu hủy đơn nghỉ chờ duyệt",
  tang_ca_moi: () => "🔔 Có phiếu tăng ca mới chờ duyệt",
  tang_ca_xin_huy: () => "🔔 Có yêu cầu hủy phiếu tăng ca chờ duyệt",
  di_muon_moi: () => "🔔 Có phiếu đi muộn / về sớm mới chờ duyệt",
  doi_ca: () => "🔔 Ca làm việc của bạn vừa được thay đổi",
  bao_gia_cho_duyet: (ma) => `🔔 Báo giá${ma ? " " + ma : ""} chờ bạn duyệt`,
  don_cho_coc: (ma) => `🔔 Đơn hàng${ma ? " " + ma : ""} chờ ghi cọc`,
  lenh_cho_xep: (ma) => `🔔 Lệnh${ma ? " " + ma : ""} vừa vào hàng chờ xếp lịch`,
  viec_moi: () => "🔔 Tổ có việc mới",
  cho_chot_giay: () => "🔔 Có lệnh mới chờ tổ Cắt chốt giấy",
  viec_mo: () => "🔔 Tổ Cắt đã chốt giấy — việc của tổ đã mở",
  kho_yeu_cau_moi: (ma) => `🔔 Có yêu cầu kho mới${ma ? " " + ma : ""} chờ lập phiếu`,
  hoa_don_cho_thu: (ma) => `🔔 Hóa đơn${ma ? " " + ma : ""} chờ thu tiền`,
  coc_cho_thu: (ma) => `🔔 Đơn${ma ? " " + ma : ""} đã chốt, chờ thu cọc`,
  tra_lai_khach: (ma) => `🔔 Đơn${ma ? " " + ma : ""} có tiền chờ trả lại khách`,
};

export function loiNhacCua(loai: string, ma: string | null): string | null {
  const f = LOI_NHAC[loai];
  return f ? f(ma) : null;
}
