// Đơn thương mại — chỉ In Hà Phương (phân hệ `thuong_mai`, docs/design-hang-thuong-mai-ha-phuong.md).
// Máy chủ: `backend/app/routers/thuong_mai.py`. Bản cài tắt phân hệ thì mọi đường ở đây trả 404.
import { authed, type OrderDetail } from "./client";
import type { CachGiaoInput } from "./giaoHangHp";

export interface DongThuongMaiInput {
  hang_id: number;
  dvt: string;
  qty: number;
  /** Trước VAT. Bỏ trống = giá bán khai theo ĐVT ở danh mục. */
  don_gia?: number | null;
  vat_pct: number;
}

export interface HangThuongMai {
  id: number;
  ma: string;
  ten: string;
  don_vi_gia: string;
  don_vi_them?: string[] | null;
  /** Giá bán theo từng ĐVT — vắng khi người xem không có ô Xem giá. */
  gia_ban_theo_dvt?: Record<string, number> | null;
  active?: boolean;
}

export interface DongLuotXuat {
  order_line_id: number;
  ten: string;
  don_vi_tinh: string | null;
  qty: number;
  qty_thuc: number | null;
  /** Tiền: null khi không có ô Xem giá thành của Kho. */
  gia_von: number | null;
}

export interface LuotXuatThuongMai {
  id: number;
  ma: string;
  kho_id: number;
  kho_ten: string | null;
  trang_thai: "cho_xuat" | "da_xuat" | "huy";
  stock_request_id: number | null;
  stock_request_ma: string | null;
  nguoi_lap: string | null;
  created_at: string;
  xuat_luc: string | null;
  ghi_chu: string | null;
  dong: DongLuotXuat[];
}

export interface KhoXuat {
  id: number;
  ma: string;
  ten: string;
  /** Người xem có ô Lập phiếu của Kho ⇒ xuất và ghi sổ luôn trong một lần bấm. */
  ghi_so_duoc: boolean;
}

export interface XuatHangState {
  luot: LuotXuatThuongMai[];
  /** SL còn xuất được của từng dòng đơn (khoá là id dòng đơn). */
  con_lai: Record<string, number>;
  kho: KhoXuat[];
}

/** Xuất hàng + Thanh toán đã chọn của đơn thương mại còn nháp, lưu kèm "Lưu nháp" (14/11/2026). */
export interface DuKienThuongMaiInput {
  xuat_ngay: boolean;
  kho_id: number | null;
  phuong_thuc: CachGiaoInput | null;
  tra_ngay: boolean;
  cach_nhan: "cash" | "bank_transfer" | null;
  company_bank_account_id: number | null;
}
export interface DuKienThuongMai extends DuKienThuongMaiInput {
  kho_ten: string | null;
  nguoi_giao_ten: string | null;
  xe_ten: string | null;
  don_vi_vc_ten: string | null;
  tai_khoan_ten: string | null;
}
/** `GET /api/orders/{id}` của đơn thương mại nháp có thêm `tm_du_kien`. */
export const duKienCua = (o: OrderDetail): DuKienThuongMai | null =>
  (o as OrderDetail & { tm_du_kien?: DuKienThuongMai | null }).tm_du_kien ?? null;

export const thuongMaiApi = {
  taoDon(token: string, body: { customer_id: number; lines: DongThuongMaiInput[]; deposit_pct?: number | null;
    deposit_amount?: number | null; ghi_chu?: string | null; du_kien?: DuKienThuongMaiInput | null }): Promise<OrderDetail> {
    return authed<OrderDetail>("/api/thuong-mai/don", token, { method: "POST", body: JSON.stringify(body) });
  },
  suaDong(token: string, orderId: number, lines: DongThuongMaiInput[]): Promise<OrderDetail> {
    return authed<OrderDetail>(`/api/thuong-mai/don/${orderId}/dong`, token, {
      method: "PUT", body: JSON.stringify({ lines }),
    });
  },
  /** Lưu nháp ở trang Sửa đơn: sửa trọn khách, dòng, cọc, ghi chú của đơn còn nháp (14/11/2026). */
  suaDon(token: string, orderId: number, body: { customer_id: number; lines: DongThuongMaiInput[];
    deposit_amount?: number | null; ghi_chu?: string | null; du_kien?: DuKienThuongMaiInput | null }): Promise<OrderDetail> {
    return authed<OrderDetail>(`/api/thuong-mai/don/${orderId}`, token, { method: "PUT", body: JSON.stringify(body) });
  },
  /** Trang Tạo đơn: tạo + chốt, kèm xuất hết hàng (`xuat`) và/hoặc phiếu thu theo đơn (`thu`).
   *  Có `orderId` (trang Sửa đơn) = lưu trọn đơn nháp đó rồi chốt / xuất / thu trên chính nó. */
  banNhanh(token: string, body: { customer_id: number; lines: DongThuongMaiInput[]; deposit_amount?: number | null;
    ghi_chu?: string | null;
    thu?: { receipt_method: "cash" | "bank_transfer"; amount: number; company_bank_account_id?: number | null;
      bank_reference?: string | null } | null;
    xuat?: { kho_id: number; ghi_so: boolean; phuong_thuc?: CachGiaoInput } | null }, orderId?: number): Promise<OrderDetail> {
    return authed<OrderDetail>(orderId != null ? `/api/thuong-mai/don/${orderId}/ban-nhanh` : "/api/thuong-mai/ban-nhanh",
      token, { method: "POST", body: JSON.stringify(body) });
  },
  /** Kho chọn được ở khối Xuất hàng của trang Tạo đơn. */
  khoXuat(token: string): Promise<KhoXuat[]> {
    return authed<KhoXuat[]>("/api/thuong-mai/kho-xuat", token);
  },
  /** Tồn từng dòng theo ĐVT của dòng, ở kho đã chọn (hoặc mọi kho khi `kho_id` trống). */
  ton(token: string, kho_id: number | null, lines: { hang_id: number; dvt: string; qty: number }[]):
    Promise<{ hang_id: number; dvt: string; ton: number }[]> {
    return authed<{ hang_id: number; dvt: string; ton: number }[]>("/api/thuong-mai/ton", token, {
      method: "POST", body: JSON.stringify({ kho_id, lines }),
    });
  },
  xemXuat(token: string, orderId: number): Promise<XuatHangState> {
    return authed<XuatHangState>(`/api/thuong-mai/don/${orderId}/xuat`, token);
  },
  xuatHang(token: string, orderId: number, body: { kho_id: number; ghi_so: boolean; ghi_chu?: string | null;
    lines: { order_line_id: number; qty: number }[];
    /** Bắt buộc khi bản cài bật giao hàng kiểu Hà Phương (`giao_hang_hp`). */
    phuong_thuc?: CachGiaoInput }): Promise<XuatHangState> {
    return authed<XuatHangState>(`/api/thuong-mai/don/${orderId}/xuat`, token, {
      method: "POST", body: JSON.stringify(body),
    });
  },
  /** Danh mục Đơn vị & quy đổi — đổi mã ĐVT ra tên hiện cho người dùng. */
  donVi(token: string): Promise<{ items: { ma: string; ten: string }[] }> {
    return authed<{ items: { ma: string; ten: string }[] }>("/api/don-vi?size=200", token);
  },
  hang(token: string, q: string): Promise<{ items: HangThuongMai[] }> {
    const qs = new URLSearchParams({ size: "30", active: "true" });
    if (q.trim()) qs.set("q", q.trim());
    return authed<{ items: HangThuongMai[] }>(`/api/vat-lieu-kho/hang-thuong-mai?${qs}`, token);
  },
};
