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

export const thuongMaiApi = {
  taoDon(token: string, body: { customer_id: number; lines: DongThuongMaiInput[]; deposit_pct?: number | null;
    deposit_amount?: number | null; ghi_chu?: string | null }): Promise<OrderDetail> {
    return authed<OrderDetail>("/api/thuong-mai/don", token, { method: "POST", body: JSON.stringify(body) });
  },
  suaDong(token: string, orderId: number, lines: DongThuongMaiInput[]): Promise<OrderDetail> {
    return authed<OrderDetail>(`/api/thuong-mai/don/${orderId}/dong`, token, {
      method: "PUT", body: JSON.stringify({ lines }),
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
