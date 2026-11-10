// Giao hàng kiểu In Hà Phương — chỉ bản cài bật `giao_hang_hp` (docs/design-giao-hang-ha-phuong.md).
// Máy chủ: `backend/app/routers/giao_hang_hp.py`, `backend/app/routers/xe_giao_hang.py`. Bản cài tắt
// phân hệ thì mọi đường ở đây trả 404.
import { authed, type PaymentVoucherRow, type PaymentVoucherType } from "./client";

export type LoaiCachGiao = "khong_giao" | "noi_bo" | "dich_vu";

/** Cách giao gửi kèm lần Xuất hàng. */
export interface CachGiaoInput {
  loai: LoaiCachGiao;
  nguoi_giao_id?: number | null;
  xe_id?: number | null;
  don_vi_vc_id?: number | null;
  tien_cuoc?: number | null;
  ma_van_don?: string | null;
}

export interface NguoiGiao {
  id: number;
  ma: string;
  ten: string;
  bo_phan: string | null;
  /** Xe người này phụ trách — ô Xe tự điền khi chọn người. */
  xe_id: number | null;
}

export interface DonViVc {
  id: number;
  ma: string;
  ten: string;
}

export interface XeGiaoHang {
  id: number;
  ma: string;
  ten: string;
  nguoi_phu_trach_id: number | null;
  nguoi_phu_trach_ten?: string | null;
  active?: boolean;
}

export interface CachGiaoRow {
  id: number;
  order_id: number;
  stock_request_id: number | null;
  luot_xuat_tm_id: number | null;
  ma_lan_xuat: string | null;
  loai: LoaiCachGiao;
  nguoi_giao_id: number | null;
  nguoi_giao_ten: string | null;
  xe_id: number | null;
  xe_ten: string | null;
  xe_bien_so: string | null;
  don_vi_vc_id: number | null;
  don_vi_vc_ten: string | null;
  /** Tiền: null khi người xem không có ô Xem của Phiếu chi. */
  tien_cuoc: number | null;
  ma_van_don: string | null;
  nguoi_chon_ten: string | null;
  created_at: string;
}

export interface CuocChoChi {
  phuong_thuc_giao_hp_id: number;
  order_id: number;
  order_no: string | null;
  customer_name: string | null;
  ma_lan_xuat: string | null;
  don_vi_vc_id: number;
  don_vi_vc_ten: string | null;
  ma_van_don: string | null;
  tien_cuoc: number;
  da_chi: number;
  con: number;
  created_at: string;
}

export interface PhieuChiCuocInput {
  dong: { phuong_thuc_giao_hp_id: number; amount: number }[];
  voucher_type: PaymentVoucherType;
  voucher_date: string;
  muc_thu_chi_id: number;
  content?: string | null;
  cash_recipient_name?: string | null;
  cash_recipient_address?: string | null;
  note?: string | null;
  company_bank_account_id?: number | null;
  beneficiary_account_holder?: string | null;
  beneficiary_account_number?: string | null;
  beneficiary_bank_name?: string | null;
  beneficiary_bank_branch?: string | null;
  bank_fee_bearer?: string | null;
}

export const NHAN_CACH_GIAO: Record<LoaiCachGiao, string> = {
  khong_giao: "Không cần giao",
  noi_bo: "Giao nội bộ",
  dich_vu: "Thuê vận chuyển",
};

export const giaoHangHpApi = {
  nguoiGiao(token: string): Promise<{ items: NguoiGiao[] }> {
    return authed<{ items: NguoiGiao[] }>("/api/giao-hang-hp/nguoi-giao?size=200", token);
  },
  donViVc(token: string): Promise<{ items: DonViVc[] }> {
    return authed<{ items: DonViVc[] }>("/api/giao-hang-hp/don-vi-van-chuyen", token);
  },
  xe(token: string): Promise<{ items: XeGiaoHang[] }> {
    return authed<{ items: XeGiaoHang[] }>("/api/xe-giao-hang?size=200&active=true", token);
  },
  /** Xuất hàng đơn sản xuất kèm cách giao (thay `api.giaoHang.xuatHang` ở bản cài Hà Phương). */
  xuatHang(token: string, body: {
    order_id: number; ngay_can_giao: string; lines: { order_line_id: number; qty: number }[];
    ghi_chu?: string | null; dia_chi_id?: number | null; lien_he_id?: number | null; phuong_thuc: CachGiaoInput;
  }): Promise<{ request_code: string; phieu_kho: string | null; phuong_thuc_id: number }> {
    return authed("/api/giao-hang-hp/xuat-hang", token, { method: "POST", body: JSON.stringify(body) });
  },
  cuaDon(token: string, orderId: number): Promise<{ items: CachGiaoRow[] }> {
    return authed<{ items: CachGiaoRow[] }>(`/api/giao-hang-hp/don/${orderId}`, token);
  },
  /** Lần giao gần nhất của từng đơn (cột Giao hàng của danh sách). Khoá là id đơn dạng chuỗi. */
  moiNhat(token: string, orderIds: number[]): Promise<{ items: Record<string, CachGiaoRow> }> {
    return authed<{ items: Record<string, CachGiaoRow> }>(
      `/api/giao-hang-hp/moi-nhat?order_ids=${orderIds.join(",")}`, token);
  },
  cuocChoChi(token: string): Promise<{ items: CuocChoChi[] }> {
    return authed<{ items: CuocChoChi[] }>("/api/giao-hang-hp/cuoc-cho-chi", token);
  },
  lapPhieuChi(token: string, body: PhieuChiCuocInput): Promise<PaymentVoucherRow> {
    return authed<PaymentVoucherRow>("/api/giao-hang-hp/cuoc-cho-chi/phieu-chi", token, {
      method: "POST", body: JSON.stringify(body),
    });
  },
};
