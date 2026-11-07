/** Hàng đang tới đâu trên tuyến công đoạn của lệnh (09/10/2026) — luật thuần, dùng chung cho dải
 *  tuyến nhỏ ở lưới bàn tổ và tuyến lớn trong ngăn chi tiết.
 *
 *  Cùng luật `vi_tri_hang` ở `backend/app/services/san_xuat/loc_ban_to.py` (bộ lọc "Hàng đang tới
 *  đâu" chạy ở máy chủ): bước hàng đang ở = bước XA NHẤT đang chạy/tạm dừng; không bước nào đang
 *  làm thì bước đầu chưa xong; xong hết thì bước cuối. Hai bên lệch nhau là lọc ra một đằng, dải
 *  vẽ một nẻo. */
import type { SxDaiDuoi, SxLenhNhom, SxRoutingBuoc, SxWorkItem } from "../api/client";

export type ViTriHang = { k: "toi" | "sap" | "qua"; c: number; m: number; tong: number };

const DANG_LAM = new Set(["running", "paused"]);

/** Ô của việc trên dải: khớp `cong_viec_id` (phân đoạn đầu) hoặc `step_key` (các phân đoạn sau của
 *  cùng bước — ô dải chỉ ghi id phân đoạn đầu). Trả số thứ tự 1-based, 0 = không thấy. */
function oCuaViec(dai: SxRoutingBuoc[], congViecId: number, stepKey?: string | null): number {
  const i = dai.findIndex((o) => o.cong_viec_id === congViecId || (!!stepKey && o.step_key === stepKey));
  return i + 1;
}

/** Bước hàng đang ở (1-based). */
export function buocHangDangO(dai: SxRoutingBuoc[]): number {
  let c = 0;
  dai.forEach((o, i) => { if (DANG_LAM.has(o.trang_thai)) c = i + 1; });
  if (c === 0) {
    const i = dai.findIndex((o) => o.trang_thai !== "completed");
    c = i < 0 ? dai.length : i + 1;
  }
  return c;
}

export function viTriHang(dai: SxRoutingBuoc[], congViecId: number, stepKey?: string | null): ViTriHang | null {
  if (dai.length === 0) return null;
  const m = oCuaViec(dai, congViecId, stepKey);
  if (m === 0) return null;
  const c = buocHangDangO(dai);
  return { k: c > m ? "qua" : c === m ? "toi" : "sap", c, m, tong: dai.length };
}

/** Câu nói vị trí. `ngan` cho ô lưới, bản dài cho ngăn chi tiết. */
export function cauViTri(v: ViTriHang, dai: SxRoutingBuoc[], ngan: boolean): string {
  // Mọi bước đã xong: hàng đã rời dải. Nói "đang ở" bước cuối thì lưới và ngăn kể hai chuyện khác
  // nhau về cùng một lệnh (lưới "đang ở Cân hàng", ngăn "Lệnh đã xong cả 7 bước", 05/11/2026).
  if (dai.length > 0 && dai.every((o) => o.trang_thai === "completed")) {
    return ngan ? `Xong cả ${dai.length} bước` : `Lệnh đã xong cả ${dai.length} bước, hàng đã đi tiếp`;
  }
  if (v.k === "qua") {
    const ten = dai[v.c - 1]?.ten_cong_doan ?? "";
    return ngan ? `Đã qua, đang ở ${ten}` : `Đã qua tổ mình, hàng đang ở ${ten}`;
  }
  if (v.k === "toi") return ngan ? "Hàng ở tổ mình" : "Hàng đã tới tổ mình";
  const d = v.m - v.c;
  return ngan ? `Còn ${d} bước tới mình` : `Còn ${d} bước nữa mới tới tổ mình`;
}

/** Ô đuôi của dải (11/10/2026): tên chỗ hàng đi tới + các mẩu số, mỗi mẩu một thẻ riêng (không nối
 *  bằng dấu phẩy). `dv` dịch mã đơn vị, `gio` định dạng mốc giờ — truyền vào để hàm thuần. */
export function cauDuoi(
  d: SxDaiDuoi,
  dv: (ma: string | null | undefined) => string,
  gio: (v: string | null | undefined) => string,
): { ten: string; so: string[] } {
  const voiDv = (n: number) => `${n.toLocaleString("vi-VN")}${d.don_vi ? ` ${dv(d.don_vi)}` : ""}`;
  switch (d.loai) {
    case "cho_mang_di":
      return { ten: `Chờ mang đi ${d.noi ?? "nhà gia công"}`,
        so: [d.so ? `${voiDv(d.so)} chờ mang đi` : "chưa có hàng giao sang"] };
    case "o_ngoai":
      return { ten: `Đang ở ${d.noi ?? "nhà gia công"}`,
        so: [d.so ? `mang đi ${voiDv(d.so)}` : "đã mang đi", ...(d.luc ? [`lúc ${gio(d.luc)}`] : [])] };
    case "ve_buoc": {
      const so = [
        ...(d.so ? [`đã nhận ${voiDv(d.so)}`] : []),
        ...(d.cho_nhan ? [`${voiDv(d.cho_nhan)} chờ tổ nhận`] : []),
      ];
      return { ten: `Về ${d.noi ?? "bước sau"}${d.lsx_ma ? ` (${d.lsx_ma})` : ""}`, so: so.length ? so : ["chưa giao sang"] };
    }
    case "giao_khach":
      return { ten: "Nhà gia công giao thẳng khách", so: d.so ? [`khách nhận ${voiDv(d.so)}`] : [] };
    default:
      return { ten: "Nhập kho thành phẩm", so: [d.so ? `đã gửi kho ${voiDv(d.so)}` : "chưa gửi kho"] };
  }
}

/** Dải của một việc. Lệnh MỘT bước máy chủ không dựng dải (`routing` rỗng) nhưng hàng chỉ có thể
 *  ở tổ mình — dựng một ô từ chính việc để dòng vẫn nói được "Hàng ở tổ mình" (cùng luật máy chủ).
 *  Bài ghép chưa có dải ⇒ rỗng. */
export function daiCuaViec(l: SxLenhNhom, w: SxWorkItem): SxRoutingBuoc[] {
  if (l.routing && l.routing.length > 0) return l.routing;
  if (l.nguon_loai !== "lsx") return [];
  return [{
    thu_tu: 1, step_key: w.step_key ?? null, ten_cong_doan: w.ten_cong_doan, to_id: w.department_id, to_ten: null,
    la_cua_toi: true, la_kcs_cuoi: w.la_kcs_cuoi, thue_ngoai: w.loai_buoc === "thue_ngoai",
    trang_thai: w.trang_thai, phan_doan_tong: 1, chay_chung: false, ke_hoach: w.so_luong_ra,
    thuc_te: w.da_lam ?? 0, don_vi: w.don_vi_ra, da_giao_sang_toi: null, da_nhan: null, cong_viec_id: w.id,
  }];
}
