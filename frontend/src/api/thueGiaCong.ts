// Thuê gia công (spec docs/superpowers/specs/2026-11-13-module-gia-cong-ngoai-design.md).
// Máy chủ: `backend/app/routers/thue_gia_cong.py`. Lệnh chỉ còn cờ Thuê ngoài; đặt, giao, nhận,
// trả tiền nằm ở màn Thuê gia công.
import { authed } from "./client";

/** Thông tin lệnh đi kèm mọi bản ghi gia công: mã lệnh, khách, mã đơn, mặt hàng, hạn giao. */
export interface TgcLenh {
  lsx_id: number;
  lsx_ma: string;
  khach_hang: string;
  don_hang_ma: string;
  mat_hang: string;
  han_giao: string | null;
}

/** Nhà gia công: danh sách riêng (mg 0484), thêm bỏ ngay ở ô Nhà gia công của hộp Lập đơn. */
export interface TgcNhaGiaCong { id: number; ten: string; active: boolean }

export type TgcKieu = "mot_phan" | "tron_goi";
export type TgcTinhTrangHangCho = "san_sang_giao" | "cho_buoc_truoc" | "chua_dat";

export interface TgcHangChoDong {
  viec_id: number;
  version: number;
  kieu: TgcKieu;
  ten_viec: string;
  sl_can: number | null;
  /** Đơn vị nhận về (ra của bước cuối dải; trọn gói = đơn vị lệnh). */
  don_vi: string | null;
  /** Đơn vị giao đi (vào của bước đầu dải). */
  don_vi_giao: string | null;
  xuong_cap_giay: boolean;
  lsx_id: number | null;
  bai_ghep_id: number | null;
  bai_ghep_ma: string | null;
  lenh: TgcLenh[];
  tinh_trang: TgcTinhTrangHangCho;
  /** Số tổ bước trước đã đề xuất bàn giao, đang chờ phiếu giao nhận. */
  sl_san_sang: number;
  so_buoc: number;
  vat_tu_xuong_cap: { ten: string; so_luong: number; don_vi: string | null }[];
  created_at: string | null;
}

export interface TgcHangChoOut {
  items: TgcHangChoDong[];
  total: number;
  page: number;
  size: number;
  facets: Partial<Record<TgcTinhTrangHangCho, number>>;
}

export type TgcTrangThai = "chua_dat" | "nhap" | "da_dat" | "dang_o_ngoai" | "da_ve" | "xong";

/** Trạng thái CHỈ ĐỌC của một việc thuê gia công trên màn lệnh. */
export interface TgcTrangThaiViec {
  viec_id: number;
  version: number;
  kieu: TgcKieu;
  ten_viec: string;
  sl_can: number | null;
  don_vi: string | null;
  xuong_cap_giay: boolean;
  bai_ghep_id: number | null;
  bai_ghep_ma: string | null;
  /** Bước của lệnh (hoặc bước chung bài ghép) thuộc việc này. */
  step_keys: string[];
  don_id: number | null;
  ma_don: string | null;
  nha_cung_cap_ten: string | null;
  ngay_hen_ve: string | null;
  da_giao: number;
  dat: number;
  hong: number;
  con_ngoai: number;
  sl_dat: number | null;
  hao_hut: number | null;
  trang_thai: TgcTrangThai;
  nhan: string;
}

/** Một dòng của phiếu nhận chờ trả tiền: số đạt / hỏng / hụt cạnh tiền tạm tính (Q3: không tự trừ). */
export interface TgcChoTraTienDong {
  ten_viec: string;
  dat: number;
  hong: number;
  /** Hụt khi dòng đơn đã hoàn tất (null = chưa hoàn tất). */
  hut: number | null;
  don_vi: string | null;
  don_gia: number;
  tam_tinh: number;
}

/** Phiếu nhận chưa có phiếu chi còn hiệu lực — hàng "Chờ trả tiền". */
export interface TgcChoTraTien {
  phieu_nhan_id: number;
  ma: string;
  nhan_luc: string;
  don_id: number;
  ma_don: string;
  nha_cung_cap_id: number;
  nha_cung_cap_ten: string;
  nguoi_nhan_ten: string | null;
  lenh: TgcLenh[];
  dong: TgcChoTraTienDong[];
  tam_tinh: number;
}

export type TgcTrangThaiDon = "nhap" | "da_dat" | "giao_mot_phan" | "giao_du" | "ve_mot_phan" | "hoan_tat" | "huy";

export interface TgcDonDong {
  id: number;
  viec_id: number;
  ten_viec: string;
  kieu: TgcKieu;
  xuong_cap_giay: boolean;
  sl_can: number | null;
  lenh: TgcLenh[];
  bai_ghep_id: number | null;
  bai_ghep_ma: string | null;
  sl_dat: number;
  /** Đơn vị nhận về (đơn vị của số đặt). */
  don_vi: string | null;
  don_gia: number;
  thanh_tien_dat: number;
  da_giao: number;
  don_vi_giao: string | null;
  giao_quy_doi: number;
  dat: number;
  hong: number;
  con_ngoai: number;
  tam_tinh: number;
  co_giao: boolean;
  co_nhan: boolean;
  hoan_tat_luc: string | null;
  hao_hut: number | null;
  huy_luc: string | null;
  /** Chỉ có ở chi tiết đơn đã đặt: lý do máy chủ sẽ từ chối Hoàn tất / Mở lại. */
  ly_do_khong_hoan_tat?: string | null;
  ly_do_khong_mo_lai?: string | null;
  vat_tu_ngoai?: TgcVatTuNgoai[];
}

/** Vật tư kho của một dòng đơn: ghi trên phiếu giao, kho xuất thực, đã trả, còn ở nhà gia công. */
export interface TgcVatTuNgoai {
  hang_loai: string;
  hang_id: number;
  kho_rong: number;
  kho_dai: number;
  kho: string | null;
  ten: string;
  don_vi: string | null;
  giao: number;
  xuat: number;
  tra: number;
  con_ngoai: number;
}

export type TgcNoiVe = "xuong" | "kho" | "khach";

export interface TgcPnMoiDong {
  don_dong_id: number;
  viec_id: number;
  ten_viec: string;
  kieu: TgcKieu;
  lenh: TgcLenh[];
  sl_dat: number;
  don_vi: string | null;
  don_gia: number;
  da_giao: number;
  don_vi_giao: string | null;
  giao_quy_doi: number;
  da_dat: number;
  da_hong: number;
  /** Một phần: số còn ở nhà gia công (đơn vị nhận). Trọn gói: null. */
  con_ngoai: number | null;
  canh_bao: string | null;
  noi_ve_hop_le: TgcNoiVe[];
  buoc_sau: { cong_viec_id: number; ten: string; xac_nhan_duoc: boolean }[];
  chia_theo_lenh: { lsx_id: number; lsx_ma: string; so_con: number; he_so_nhan: number; don_vi: string | null;
    buoc_nhan: string | null }[];
  ly_do_khong_nhan: string | null;
}

export interface TgcPhieuNhanMoi {
  don_id: number;
  ma_don: string;
  version: number;
  nha_cung_cap_ten: string;
  chan_tu_nhan: string | null;
  dong: TgcPnMoiDong[];
}

export interface TgcPhieuNhanIn {
  version: number;
  ghi_chu?: string | null;
  dong: { don_dong_id: number; sl_dat: number; sl_hong: number; noi_ve: TgcNoiVe;
    dich_cong_viec_id?: number | null; ngay_khach_nhan?: string | null }[];
}

export interface TgcPhieuNhan {
  id: number;
  ma: string;
  version: number;
  don_id: number;
  ma_don: string;
  nha_cung_cap_id: number | null;
  nha_cung_cap_ten: string;
  nhan_luc: string;
  nguoi_nhan_ten: string | null;
  ghi_chu: string | null;
  huy_luc: string | null;
  nguoi_huy_ten: string | null;
  ly_do_huy: string | null;
  created_at: string;
  lenh: TgcLenh[];
  de_nghi: { id: number; ma: string; trang_thai: string; da_lap_phieu: boolean }[];
  tam_tinh: number;
  phieu_chi_ma: string | null;
  ly_do_khong_huy: string | null;
  dong: {
    id: number;
    don_dong_id: number;
    ten_viec: string;
    kieu: TgcKieu | null;
    sl_dat: number;
    sl_hong: number;
    don_vi: string | null;
    don_vi_ten: string;
    don_gia: number;
    thanh_tien: number;
    noi_ve: TgcNoiVe;
    dich_ten: string | null;
    ngay_khach_nhan: string | null;
    ban_giao_trang_thai: string | null;
  }[];
  canh_bao?: string[];
}

export interface TgcPhieuNhanListOut {
  items: TgcPhieuNhan[];
  total: number;
  page: number;
  size: number;
  facets: Record<string, number>;
}

export interface TgcHangONgoai {
  nha_cung_cap_id: number | null;
  nha_cung_cap_ten: string;
  don_id: number;
  ma_don: string;
  don_dong_id: number;
  ten_viec: string;
  lenh: TgcLenh[];
  ngay_hen_ve: string | null;
  loai: "ban_thanh_pham" | "vat_tu";
  ten_hang: string;
  kho: string | null;
  giao: number;
  da_ve: number;
  con_ngoai: number;
  don_vi: string | null;
  don_vi_ten: string;
}

export interface TgcHangONgoaiListOut {
  items: TgcHangONgoai[];
  total: number;
  page: number;
  size: number;
  facets: Record<string, number>;
}

export interface TgcChungTuNgan { id: number; ma: string; luc: string; nguoi_ten: string | null; huy_luc: string | null }
export interface TgcLichSu { id: number; luc: string; nguoi_ten: string; hanh_dong: string; chi_tiet: string }

export interface TgcDon {
  id: number;
  ma: string;
  version: number;
  nha_cung_cap_id: number;
  nha_cung_cap_ten: string;
  ngay_dat: string;
  ngay_hen_ve: string | null;
  ghi_chu: string | null;
  dat_luc: string | null;
  nguoi_dat_ten: string | null;
  huy_luc: string | null;
  nguoi_huy_ten: string | null;
  ly_do_huy: string | null;
  created_at: string;
  nguoi_tao_ten: string | null;
  trang_thai: TgcTrangThaiDon;
  nhan_trang_thai: string;
  dong: TgcDonDong[];
  lenh: TgcLenh[];
  tong_tien_dat: number;
  tam_tinh_da_nhan: number;
  /** Ngăn đơn: còn bán thành phẩm, giấy xưởng cấp hay vật tư xưởng cấp phải giao không. */
  co_gi_de_giao?: boolean;
  phieu_giao: TgcChungTuNgan[];
  phieu_nhan: TgcChungTuNgan[];
  lich_su: TgcLichSu[];
}

export interface TgcDonListOut {
  items: TgcDon[];
  total: number;
  page: number;
  size: number;
  facets: Partial<Record<TgcTrangThaiDon, number>>;
}

export interface TgcDonIn {
  nha_cung_cap_id: number;
  ngay_dat: string;
  ngay_hen_ve: string | null;
  ghi_chu: string | null;
  /** `xuong_cap_giay` chỉ có nghĩa với việc trọn gói: true = xưởng cấp giấy, false = nhà gia công tự lo,
   *  bỏ trống = giữ nguyên. Đã có phiếu giao mang giấy thì máy chủ chặn đổi. */
  dong: { viec_id: number; sl_dat: number; don_gia: number; xuong_cap_giay?: boolean }[];
}

export type TgcMocDon = "dat" | "tao" | "hen";

/** Điền sẵn phiếu giao của MỘT dòng đơn. */
export interface TgcPgMoiDong {
  don_dong_id: number;
  viec_id: number;
  ten_viec: string;
  kieu: string;
  lenh: TgcLenh[];
  sl_dat: number;
  don_vi: string | null;
  da_giao: number;
  /** Null với trọn gói (nhà gia công làm cả lệnh, không có bán thành phẩm đưa sang). */
  ban_thanh_pham: {
    don_vi: string | null;
    ban_giao: { ban_giao_id: number; so_luong: number; don_vi: string | null; nguon_ten: string; luc: string | null }[];
    /** Dải đứng đầu lệnh: không có bước trước nên gõ số. */
    go_tay: boolean;
    /** Bước trước chưa bàn giao sang — chưa giao bán thành phẩm được. */
    cho_buoc_truoc: boolean;
  } | null;
  vat_tu: {
    lsx_cong_doan_vat_tu_id: number;
    hang_loai: string;
    hang_id: number;
    ten: string | null;
    ma: string | null;
    don_vi: string | null;
    kho_rong: number;
    kho_dai: number;
    dinh_muc: number;
    da_giao: number;
    goi_y: number;
    lsx_id: number | null;
    /** Tồn khả dụng gộp mọi kho, cùng đơn vị + khổ; null = không được xem số tồn. */
    ton: number | null;
  }[];
  giay: {
    giay_id: number | null;
    giay_ma: string | null;
    giay_ten: string | null;
    don_vi: string | null;
    nguon: string | null;
    de_xuat: { kho_rong: number; kho_dai: number; so_to: number | null; don_vi: string | null } | null;
    /** `ton` null = không được xem số tồn. */
    kho: { kho_rong: number; kho_dai: number; ton: number | null; don_vi: string | null; dung_de_xuat: boolean }[];
    ly_do: string | null;
  } | null;
}

export interface TgcPhieuGiaoMoi {
  don_id: number;
  ma_don: string;
  version: number;
  nha_cung_cap_ten: string;
  /** Được xem số tồn kho gộp mọi kho — không thì các ô `ton` là null. */
  xem_ton: boolean;
  dong: TgcPgMoiDong[];
}

export interface TgcPhieuGiaoIn {
  version: number;
  ghi_chu: string | null;
  dong: {
    don_dong_id: number;
    giao_ban_thanh_pham: boolean;
    sl_go: number | null;
    vat_tu: { lsx_cong_doan_vat_tu_id: number; so_luong: number }[];
    giay: { kho_rong: number; kho_dai: number; so_luong: number } | null;
  }[];
}

export interface TgcPhieuGiao {
  id: number;
  ma: string;
  version: number;
  don_id: number;
  ma_don: string;
  nha_cung_cap_id: number | null;
  nha_cung_cap_ten: string;
  giao_luc: string;
  nguoi_giao_ten: string | null;
  ghi_chu: string | null;
  huy_luc: string | null;
  nguoi_huy_ten: string | null;
  ly_do_huy: string | null;
  created_at: string;
  lenh: TgcLenh[];
  de_nghi: { id: number; ma: string; trang_thai: string; da_lap_phieu: boolean }[];
  dong: {
    id: number;
    don_dong_id: number;
    ten_viec: string;
    loai: "ban_thanh_pham" | "vat_tu";
    so_luong: number;
    don_vi: string | null;
    ten_hang: string | null;
    kho_rong: number;
    kho_dai: number;
    tu_ban_giao: boolean;
  }[];
}

export interface TgcPhieuGiaoListOut {
  items: TgcPhieuGiao[];
  total: number;
  page: number;
  size: number;
  facets: Record<string, number>;
}

function json(method: string, body: unknown) {
  return { method, body: JSON.stringify(body) };
}

function qs(p: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

export const tgcApi = {
  /** `caDaBo` kèm cả nhà đã bỏ khỏi danh sách — cho bộ lọc chứng từ cũ. */
  nhaGiaCong(token: string, caDaBo = false): Promise<TgcNhaGiaCong[]> {
    return authed<TgcNhaGiaCong[]>(`/api/thue-gia-cong/nha-gia-cong${qs({ ca_da_bo: caDaBo || undefined })}`, token);
  },
  themNhaGiaCong(token: string, ten: string): Promise<TgcNhaGiaCong> {
    return authed<TgcNhaGiaCong>("/api/thue-gia-cong/nha-gia-cong", token, json("POST", { ten }));
  },
  boNhaGiaCong(token: string, id: number): Promise<void> {
    return authed<void>(`/api/thue-gia-cong/nha-gia-cong/${id}`, token, { method: "DELETE" });
  },
  hangCho(
    token: string,
    p: { page?: number; size?: number; q?: string; tinh_trang?: TgcTinhTrangHangCho } = {},
  ): Promise<TgcHangChoOut> {
    return authed<TgcHangChoOut>(`/api/thue-gia-cong/hang-cho${qs(p)}`, token);
  },
  tachTheoBuoc(token: string, viecId: number, version: number): Promise<number[]> {
    return authed<number[]>(`/api/thue-gia-cong/viec/${viecId}/tach-theo-buoc`, token, json("POST", { version }));
  },
  cuaLenh(token: string, lsxId: number): Promise<TgcTrangThaiViec[]> {
    return authed<TgcTrangThaiViec[]>(`/api/thue-gia-cong/lenh/${lsxId}`, token);
  },
  cuaBaiGhep(token: string, baiGhepId: number): Promise<TgcTrangThaiViec[]> {
    return authed<TgcTrangThaiViec[]>(`/api/thue-gia-cong/bai-ghep/${baiGhepId}`, token);
  },
  choTraTien(token: string, p: { q?: string; nha_cung_cap_id?: number } = {}): Promise<TgcChoTraTien[]> {
    return authed<TgcChoTraTien[]>(`/api/thue-gia-cong/cho-tra-tien${qs(p)}`, token);
  },
  demChoTraTien(token: string): Promise<{ so: number }> {
    return authed<{ so: number }>("/api/thue-gia-cong/cho-tra-tien/dem", token);
  },
  dsDon(
    token: string,
    p: { page?: number; size?: number; q?: string; trang_thai?: TgcTrangThaiDon; nha_cung_cap_id?: number;
      tu_ngay?: string; den_ngay?: string; moc?: string } = {},
  ): Promise<TgcDonListOut> {
    return authed<TgcDonListOut>(`/api/thue-gia-cong/don${qs(p)}`, token);
  },
  don(token: string, id: number): Promise<TgcDon> {
    return authed<TgcDon>(`/api/thue-gia-cong/don/${id}`, token);
  },
  taoDon(token: string, body: TgcDonIn & { dat: boolean }): Promise<TgcDon> {
    return authed<TgcDon>("/api/thue-gia-cong/don", token, json("POST", body));
  },
  suaDon(token: string, id: number, body: TgcDonIn & { version: number }): Promise<TgcDon> {
    return authed<TgcDon>(`/api/thue-gia-cong/don/${id}`, token, json("PUT", body));
  },
  datDon(token: string, id: number, version: number): Promise<TgcDon> {
    return authed<TgcDon>(`/api/thue-gia-cong/don/${id}/dat`, token, json("POST", { version }));
  },
  huyDon(token: string, id: number, body: { version: number; ly_do: string }): Promise<TgcDon> {
    return authed<TgcDon>(`/api/thue-gia-cong/don/${id}/huy`, token, json("POST", body));
  },
  goiYDonGia(token: string, nhaId: number, tenViec: string, boDonId?: number): Promise<{ don_gia: number | null }> {
    return authed<{ don_gia: number | null }>(
      `/api/thue-gia-cong/goi-y-don-gia${qs({ nha_cung_cap_id: nhaId, ten_viec: tenViec, bo_don_id: boDonId })}`, token);
  },
  datTronGoi(token: string, lsxId: number, body: { sl_can?: number; xuong_cap_giay?: boolean } = {}): Promise<TgcTrangThaiViec> {
    return authed<TgcTrangThaiViec>(`/api/thue-gia-cong/lenh/${lsxId}/tron-goi`, token, json("POST", body));
  },
  huyTronGoi(token: string, viecId: number, body: { version: number; ly_do: string }): Promise<void> {
    return authed<void>(`/api/thue-gia-cong/viec/${viecId}/huy-tron-goi`, token, json("POST", body));
  },
  moiPhieuGiao(token: string, donId: number): Promise<TgcPhieuGiaoMoi> {
    return authed<TgcPhieuGiaoMoi>(`/api/thue-gia-cong/don/${donId}/phieu-giao/moi`, token);
  },
  lapPhieuGiao(token: string, donId: number, body: TgcPhieuGiaoIn): Promise<TgcPhieuGiao> {
    return authed<TgcPhieuGiao>(`/api/thue-gia-cong/don/${donId}/phieu-giao`, token, json("POST", body));
  },
  dsPhieuGiao(
    token: string,
    p: { page?: number; size?: number; q?: string; con_hieu_luc?: boolean; nha_cung_cap_id?: number;
      tu_ngay?: string; den_ngay?: string } = {},
  ): Promise<TgcPhieuGiaoListOut> {
    return authed<TgcPhieuGiaoListOut>(`/api/thue-gia-cong/phieu-giao${qs(p)}`, token);
  },
  phieuGiao(token: string, id: number): Promise<TgcPhieuGiao> {
    return authed<TgcPhieuGiao>(`/api/thue-gia-cong/phieu-giao/${id}`, token);
  },
  huyPhieuGiao(token: string, id: number, body: { version: number; ly_do: string }): Promise<TgcPhieuGiao> {
    return authed<TgcPhieuGiao>(`/api/thue-gia-cong/phieu-giao/${id}/huy`, token, json("POST", body));
  },
  moiPhieuNhan(token: string, donId: number): Promise<TgcPhieuNhanMoi> {
    return authed<TgcPhieuNhanMoi>(`/api/thue-gia-cong/don/${donId}/phieu-nhan/moi`, token);
  },
  lapPhieuNhan(token: string, donId: number, body: TgcPhieuNhanIn): Promise<TgcPhieuNhan> {
    return authed<TgcPhieuNhan>(`/api/thue-gia-cong/don/${donId}/phieu-nhan`, token, json("POST", body));
  },
  dsPhieuNhan(
    token: string,
    p: { page?: number; size?: number; q?: string; con_hieu_luc?: boolean; nha_cung_cap_id?: number;
      tu_ngay?: string; den_ngay?: string } = {},
  ): Promise<TgcPhieuNhanListOut> {
    return authed<TgcPhieuNhanListOut>(`/api/thue-gia-cong/phieu-nhan${qs(p)}`, token);
  },
  phieuNhan(token: string, id: number): Promise<TgcPhieuNhan> {
    return authed<TgcPhieuNhan>(`/api/thue-gia-cong/phieu-nhan/${id}`, token);
  },
  huyPhieuNhan(token: string, id: number, body: { version: number; ly_do: string }): Promise<TgcPhieuNhan> {
    return authed<TgcPhieuNhan>(`/api/thue-gia-cong/phieu-nhan/${id}/huy`, token, json("POST", body));
  },
  hoanTat(
    token: string, donDongId: number,
    body: { version: number; tra_ve: { hang_loai: string; hang_id: number; kho_rong: number; kho_dai: number; so_luong: number }[] },
  ): Promise<{ don_id: number; don_dong_id: number; hao_hut: number | null; de_nghi_tra: string | null }> {
    return authed(`/api/thue-gia-cong/don-dong/${donDongId}/hoan-tat`, token, json("POST", body));
  },
  moHoanTat(token: string, donDongId: number, version: number): Promise<{ don_id: number }> {
    return authed(`/api/thue-gia-cong/don-dong/${donDongId}/mo-hoan-tat`, token, json("POST", { version }));
  },
  hangONgoai(
    token: string, p: { page?: number; size?: number; q?: string; nha_cung_cap_id?: number } = {},
  ): Promise<TgcHangONgoaiListOut> {
    return authed<TgcHangONgoaiListOut>(`/api/thue-gia-cong/hang-o-ngoai${qs(p)}`, token);
  },
};
