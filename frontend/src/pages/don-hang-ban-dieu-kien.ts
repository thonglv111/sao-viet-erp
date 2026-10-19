// Điều kiện hiển thị của ngăn đơn hàng bán (tách 18/10/2026 để thử được riêng — lỗi #53, #54).

/** Nút "Hủy đơn": máy chủ đòi ô SỬA đơn (`don_hang_ban.update`) cho cả đơn nháp lẫn đơn đã chốt.
 *  Trước đó đơn đã chốt đặt cứng là được ⇒ người chỉ có Xem thấy nút, điền lý do xong mới ăn 403. */
export function duocHuyDon(status: string, canUpdate: boolean): boolean {
  return canUpdate && (status === "draft" || status === "ordered");
}

/** Trạng thái chặng Sản xuất. Danh sách lệnh đọc riêng (`api.lsx.list`) đòi quyền xem lệnh; người
 *  không có quyền đó ăn 403 ⇒ danh sách rỗng ⇒ từng ghi "chờ lệnh" dù đơn đã có lệnh (#54). Tiến độ
 *  của đơn do máy chủ gộp (`co_lenh`) không đòi quyền lệnh nên lấy nó làm nguồn chính. */
export function trangThaiSanXuat(
  daChuyen: boolean,
  soLenhDocDuoc: number,
  mayChuCoLenh: boolean,
): "chua" | "cho_kh" | "chay" {
  if (!daChuyen) return "chua";
  return mayChuCoLenh || soLenhDocDuoc > 0 ? "chay" : "cho_kh";
}
