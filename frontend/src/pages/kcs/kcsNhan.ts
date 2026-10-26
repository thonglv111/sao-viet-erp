// Nhãn tiếng Việt dùng chung của KCS theo lệnh — màn KCS, ngăn chi tiết bàn tổ, hộp "KCS báo lỗi".
import type { SxKcsKetLuan, SxKcsTrangThaiGuiKho } from "../../api/client";

/** Trạng thái chạy của công đoạn (enum công việc). */
export const KCS_CD_TRANG_THAI: Record<string, string> = {
  released: "Chưa bắt đầu",
  running: "Đang chạy",
  paused: "Tạm dừng",
  completed: "Đã xong",
};

// "Có lỗi" cùng màu gỉ ở mọi chỗ (dòng công đoạn, chip trên thẻ việc, từng lần kiểm); "Không đạt"
// (không cái nào đạt) nặng hơn một bậc.
export const KCS_KET_LUAN: Record<SxKcsKetLuan, { nhan: string; cls: string }> = {
  dat: { nhan: "Đạt", cls: "badge-sem--moss" },
  dat_mot_phan: { nhan: "Có lỗi", cls: "badge-sem--rust" },
  khong_dat: { nhan: "Không đạt", cls: "badge-sem--signal" },
};

export const KCS_TRANG_THAI_GUI_KHO_LABEL: Record<SxKcsTrangThaiGuiKho, string> = {
  chua_gui: "Chưa gửi kho",
  dang_cho: "Đang chờ kho nhận",
  da_nhap: "Đã nhập kho",
  khong_ap_dung: "Không áp dụng",
};

/** Trạng thái yêu cầu NHẬP kho thành phẩm — chính là trạng thái của yêu cầu ở màn Yêu cầu nhập
 *  xuất (tạo là `approved` ngay, kho ghi sổ phiếu nhập tới đâu thì `partial` / `done` tới đó). */
export const KCS_YC_KHO_TRANG_THAI: Record<string, { nhan: string; cls: string }> = {
  draft: { nhan: "Nháp", cls: "badge-sem--muted" },
  pending: { nhan: "Chờ duyệt", cls: "badge-sem--amber" },
  approved: { nhan: "Chờ kho nhận", cls: "badge-sem--steel" },
  received: { nhan: "Kho đã tiếp nhận", cls: "badge-sem--sky" },
  preparing: { nhan: "Kho đang lập phiếu", cls: "badge-sem--plum" },
  partial: { nhan: "Kho đã nhận một phần", cls: "badge-sem--rust" },
  done: { nhan: "Kho đã nhận đủ", cls: "badge-sem--moss" },
  rejected: { nhan: "Kho từ chối", cls: "badge-sem--signal" },
  cancelled: { nhan: "Đã hủy", cls: "badge-sem--gray" },
};

/** Toast cho người KCS khi kho động vào yêu cầu nhập thành phẩm của họ. Máy chủ đẩy cả lúc kho mới
 *  LẬP phiếu (chưa ghi sổ) — trạng thái khi đó chưa nói kho nhận được gì nên im. */
export function toastKhoNhapThanhPham(
  trangThai: string | null | undefined, ma: string | null | undefined,
): { chu: string; kieu: "ok" | "warn" } | null {
  const m = ma ? ` ${ma}` : "";
  if (trangThai === "done") return { chu: `📦 Kho đã nhận đủ yêu cầu nhập kho${m}`, kieu: "ok" };
  if (trangThai === "partial") {
    return { chu: `📦 Kho đã nhận MỘT PHẦN yêu cầu nhập kho${m} — phần còn lại vẫn chờ nhập`, kieu: "ok" };
  }
  if (trangThai === "cancelled") return { chu: `Kho đã huỷ yêu cầu nhập kho${m}`, kieu: "warn" };
  return null;
}

/** Máy chủ chỉ nhận lần kiểm khi công đoạn đã bắt đầu (đang chạy / tạm dừng / đã xong). */
export function kiemDuoc(trangThai: string): boolean {
  return trangThai === "running" || trangThai === "paused" || trangThai === "completed";
}

/** Trạng thái nhóm thành phẩm của lệnh. */
export const KCS_NHOM_TRANG_THAI: Record<string, { nhan: string; cls: string }> = {
  in_production: { nhan: "Đang sản xuất", cls: "badge-sem--steel" },
  closed: { nhan: "Đã đóng", cls: "badge-sem--moss" },
};

/** Tình trạng kiểm của một công đoạn: chưa kiểm · đạt · có lỗi. `loiCuaMinh` = lỗi TÍNH cho công
 *  đoạn này — do chính nó gây, bắt ở đâu cũng được (08/10/2026); lỗi nó bắt được mà quy về bước
 *  khác không làm nó "Có lỗi". Công đoạn GIỮA (`cuoi = false`) KCS chỉ ghi lỗi, không bắt buộc —
 *  không có "chưa kiểm"/"đạt": chỉ "Có lỗi" hoặc "Không lỗi" (19/09/2026). */
export function tinhTrangKiem(
  soLan: number, loiCuaMinh: number, cuoi = true,
): { nhan: string; cls: string; loai: "chua" | "dat" | "loi" } {
  if (!cuoi) {
    return loiCuaMinh > 0
      ? { nhan: "Có lỗi", cls: "badge-sem--rust", loai: "loi" }
      : { nhan: "Không lỗi", cls: "badge-sem--moss", loai: "chua" };
  }
  if (soLan <= 0) return { nhan: "Chưa kiểm", cls: "badge-sem--muted", loai: "chua" };
  if (loiCuaMinh > 0) return { nhan: `Có lỗi · ${soLan} lần`, cls: "badge-sem--rust", loai: "loi" };
  return { nhan: `Đạt · ${soLan} lần`, cls: "badge-sem--moss", loai: "dat" };
}

/** Lời hỏi lại trước khi gửi kho nhập hàng KCS đã kiểm đạt. `donVi` là NHÃN đơn vị ra của công
 *  đoạn (vd "thành phẩm", "cái") — không tự gắn thêm chữ "thành phẩm" kẻo lặp "thành phẩm thành phẩm". */
export function loiHoiNhapKho(soLuong: string, donVi: string, lsxMa: string, tenCongDoan: string): string {
  return `Đề nghị kho nhập ${soLuong} ${donVi} đã kiểm đạt của ${lsxMa} (${tenCongDoan}).`;
}
