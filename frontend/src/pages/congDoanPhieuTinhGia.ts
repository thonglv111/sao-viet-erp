/** Công đoạn được CHỌN vào chuỗi một sản phẩm của phiếu tính giá: chỉ In + sau in (spec
 * 2026-10-24-chuan-bi-giay §2). Bước trước in — Cắt tờ, CTP và khâu chuẩn bị giấy hệ thống (Cắt giấy
 * cuộn, Tề giấy in, Tề sóng) — do lệnh tự dựng theo nguồn giấy; khai ở phiếu thì lệnh coi là tuyến
 * tự khai và bỏ chọn nguồn. Bước đã lưu ở phiếu cũ vẫn hiện tên bình thường, chỉ không mời chọn thêm. */
export function chonDuocTrongPhieu(cd: Record<string, unknown>): boolean {
  return cd.active !== false && String(cd.nhom) !== "prepress";
}
