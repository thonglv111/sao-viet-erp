import type { XlGoiLichSu, XlGoiPhatHanh } from "../api/client";

// Đầu ngăn Xếp lịch: bước máy "Chưa tính được giờ" chiếm 0 phút trên lịch (lỗi #24, 18/10/2026).
// Máy chủ không bịa thời lượng cho bước thiếu dữ kiện, nên ngày xong chỉ là mốc SỚM NHẤT — đầu
// ngăn phải nói thế thay vì in nó như số chắc. Đếm cùng luật với viên "Chưa tính được giờ" ở dòng bước.

export function soBuocChuaGio(cds: { chay_phut: number; la_thue_ngoai: boolean }[]): number {
  return cds.filter((c) => !c.la_thue_ngoai && !(c.chay_phut > 0)).length;
}

export function cauChuaTinhGio(n: number): string | null {
  return n > 0 ? `Chưa tính được giờ ở ${n} bước, ngày xong có thể muộn hơn.` : null;
}

// Tab Lịch sử phát hành (lỗi #25, 18/10/2026): gói đã thu hồi vẫn phải hiện, kèm lý do thu hồi.
export function goiDaThuHoi(goi: Pick<XlGoiPhatHanh, "co_goi" | "goi_id" | "lich_su_goi"> | null): XlGoiLichSu[] {
  return (goi?.lich_su_goi ?? []).filter((g) => g.trang_thai === "da_thu_hoi" && g.goi_id !== goi?.goi_id);
}
