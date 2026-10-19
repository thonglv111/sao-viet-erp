/** Thanh lọc của màn Kế hoạch sản xuất (06/10/2026) — HAI bảng trên cùng một màn: tab "Lệnh sản xuất"
 *  và tab "Hàng chờ tiếp nhận". Lọc + đếm ở máy chủ; thanh lọc chung lo giao diện.
 *
 *  Một màn chỉ có MỘT dấu `?man=` trên URL, nên hai bảng chung một trạng thái: khoá của hàng chờ mang
 *  tiền tố `c_` (`c_ky`, `c_khach`…) để không đè khoá của bảng lệnh. */
import { useEffect, useMemo, useState } from "react";
import { Factory, FileText, Users } from "lucide-react";

import { api, type LuaChonLoc, type ThamSoLoc } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import type { GiaTriUrl } from "../ke-toan/shared/urlMan";
import { kyLenUrl, kyTuUrl, soLenUrl, soTuUrl, type KyDS } from "../thanh-loc/ky-danh-sach";
import { chuThanhId, idThanhChu } from "../thanh-loc/lua-chon";
import type { DieuKien, GiaTriDK } from "../thanh-loc/thanh-loc";

// --- Bảng lệnh -------------------------------------------------------------------------------
export const MOC_LENH_KHSX: [string, string][] = [
  ["tao", "Ngày tạo"],
  ["han_sx", "Hạn sản xuất"],
  ["han_giao", "Hạn giao khách"],
];

export type LocLenhKhsx = {
  khach?: number;
  don?: number;
  /** Mã đơn đang lọc (DH012), ghi kèm `don`. Danh sách đơn của ô lọc chỉ có đơn CÒN lệnh, nên đơn vừa
   *  hết lệnh (xoá lệnh cuối) không còn trong đó và thẻ lọc chỉ biết id nội bộ ("Đơn hàng là 40").
   *  Nhãn nhớ ở đây để thẻ vẫn ghi đúng mã đơn. Chọn đơn khác từ menu thì nhãn tự bỏ. */
  nhan?: string;
  gia_cong?: "cho_mang_di" | "dang_o_ngoai" | "tron_goi";
};

export const LOC_LENH_KHSX_TRONG: LocLenhKhsx = {};

const GIA_CONG: GiaTriDK[] = [
  { value: "cho_mang_di", nhan: "Chờ mang đi" },
  { value: "dang_o_ngoai", nhan: "Đang ở nhà gia công" },
  { value: "tron_goi", nhan: "Đang gia công trọn gói" },
];

export function thamSoLocLenhKhsx(loc: LocLenhKhsx): ThamSoLoc {
  return { customer_id: loc.khach, order_id: loc.don, gia_cong: loc.gia_cong };
}

function giaCongTuUrl(v: string | null): LocLenhKhsx["gia_cong"] {
  return GIA_CONG.some((g) => g.value === v) ? (v as LocLenhKhsx["gia_cong"]) : undefined;
}

// --- Hàng chờ --------------------------------------------------------------------------------
export const MOC_HANG_CHO: [string, string][] = [
  ["tao", "Ngày tạo đơn"],
  ["chuyen", "Lúc chuyển xuống sản xuất"],
];

export type LocHangCho = { khach?: number };

export const LOC_HANG_CHO_TRONG: LocHangCho = {};

export function thamSoLocHangCho(loc: LocHangCho): ThamSoLoc {
  return { customer_id: loc.khach };
}

// --- Trạng thái chung của màn + URL ---------------------------------------------------------
export type LocKhsx = {
  lenh: { ky: KyDS; loc: LocLenhKhsx };
  cho: { ky: KyDS; loc: LocHangCho };
};

export const LOC_KHSX_TRONG: LocKhsx = {
  lenh: { ky: { loai: "tat_ca", moc: "tao" }, loc: LOC_LENH_KHSX_TRONG },
  cho: { ky: { loai: "tat_ca", moc: "tao" }, loc: LOC_HANG_CHO_TRONG },
};

/** Bộ lọc sau khi tạo lệnh cho một đơn: sang bảng lệnh, lọc đúng đơn đó; kỳ về "Tất cả" (giữ mốc) để
 *  kỳ cũ không giấu lệnh mới. Ghi kèm MÃ đơn để thẻ lọc không phải đoán nhãn từ danh sách đơn. */
export function locKhsxSauKhiTao(cu: LocKhsx, orderId: number, orderNo?: string): LocKhsx {
  return {
    ...cu,
    lenh: { ky: { loai: "tat_ca", moc: cu.lenh.ky.moc }, loc: { don: orderId, nhan: orderNo || undefined } },
  };
}

const TIEN_TO_CHO = "c_";

/** Khoá có tiền tố `c_` của hàng chờ → bộ khoá trần để dùng lại `kyTuUrl`. */
function boTienTo(p: URLSearchParams): URLSearchParams {
  const ra = new URLSearchParams();
  p.forEach((v, k) => {
    if (k.startsWith(TIEN_TO_CHO)) ra.set(k.slice(TIEN_TO_CHO.length), v);
  });
  return ra;
}

function themTienTo(g: GiaTriUrl): GiaTriUrl {
  return Object.fromEntries(Object.entries(g).map(([k, v]) => [`${TIEN_TO_CHO}${k}`, v]));
}

export function locKhsxTuUrl(p: URLSearchParams): LocKhsx {
  const c = boTienTo(p);
  return {
    lenh: {
      ky: kyTuUrl(p, MOC_LENH_KHSX.map(([m]) => m), "tao"),
      loc: {
        khach: soTuUrl(p.get("khach")),
        don: soTuUrl(p.get("don")),
        nhan: soTuUrl(p.get("don")) != null ? p.get("dn") || undefined : undefined,
        gia_cong: giaCongTuUrl(p.get("gc")),
      },
    },
    cho: {
      ky: kyTuUrl(c, MOC_HANG_CHO.map(([m]) => m), "tao"),
      loc: { khach: soTuUrl(c.get("khach")) },
    },
  };
}

export function locKhsxLenUrl(t: LocKhsx): GiaTriUrl {
  return {
    ...kyLenUrl(t.lenh.ky, "tao"),
    khach: soLenUrl(t.lenh.loc.khach),
    don: soLenUrl(t.lenh.loc.don),
    dn: t.lenh.loc.don != null ? t.lenh.loc.nhan : undefined,
    gc: t.lenh.loc.gia_cong,
    ...themTienTo({ ...kyLenUrl(t.cho.ky, "tao"), khach: soLenUrl(t.cho.loc.khach) }),
  };
}

/** Như `useLuaChonLoc` nhưng nạp lại khi `tick` đổi: tạo lệnh xong là có ĐƠN mới để chọn (màn tự
 *  lọc theo đơn vừa tạo — thiếu đơn đó trong danh sách thì thẻ lọc hiện mã số trần). */
function useLuaChonTick(nap: (token: string) => Promise<LuaChonLoc[]>, tick: number): GiaTriDK[] {
  const { token } = useAuth();
  const [ds, setDs] = useState<GiaTriDK[]>([]);
  useEffect(() => {
    if (!token) return;
    let song = true;
    nap(token)
      .then((r) => {
        if (song) setDs(r.map((o) => ({ value: String(o.id), nhan: o.ten, so: o.so })));
      })
      .catch(() => {
        if (song) setDs([]);
      });
    return () => {
      song = false;
    };
    // `nap` là hàm của module api — ổn định.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tick]);
  return ds;
}

export function useDieuKienLenhKhsx(tick: number, locDangAp?: LocLenhKhsx): DieuKien<LocLenhKhsx>[] {
  const khach = useLuaChonTick(api.lsx.khachLoc, tick);
  const donMayChu = useLuaChonTick(api.lsx.donLoc, tick);
  // Đơn đang lọc mà máy chủ không còn liệt kê (hết lệnh) thì bổ sung bằng nhãn đã nhớ.
  const don = useMemo<GiaTriDK[]>(() => {
    const id = locDangAp?.don;
    const nhan = locDangAp?.nhan;
    if (id == null || !nhan || donMayChu.some((g) => g.value === String(id))) return donMayChu;
    return [...donMayChu, { value: String(id), nhan }];
  }, [donMayChu, locDangAp?.don, locDangAp?.nhan]);
  return [
    {
      khoa: "khach", nhan: "Khách hàng", icon: Users, kieu: "mot", tim: true, giaTri: khach,
      doc: (l) => idThanhChu(l.khach),
      ghi: (l, v) => ({ ...l, khach: chuThanhId(v) }),
    },
    {
      khoa: "don", nhan: "Đơn hàng", icon: FileText, kieu: "mot", tim: true, giaTri: don,
      doc: (l) => idThanhChu(l.don),
      ghi: (l, v) => ({ ...l, don: chuThanhId(v), nhan: undefined }),
    },
    {
      khoa: "gia_cong", nhan: "Gia công ngoài", icon: Factory, kieu: "mot", giaTri: GIA_CONG,
      doc: (l) => l.gia_cong,
      ghi: (l, v) => ({ ...l, gia_cong: giaCongTuUrl(v ?? null) }),
    },
  ];
}

export function useDieuKienHangCho(tick: number): DieuKien<LocHangCho>[] {
  const khach = useLuaChonTick(api.lsx.hangChoKhachLoc, tick);
  return [
    {
      khoa: "khach", nhan: "Khách hàng", icon: Users, kieu: "mot", tim: true, giaTri: khach,
      doc: (l) => idThanhChu(l.khach),
      ghi: (l, v) => ({ ...l, khach: chuThanhId(v) }),
    },
  ];
}
