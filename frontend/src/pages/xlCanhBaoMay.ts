// Chữ ngắn ở ô nhãn lệnh cho `canh_bao_may` (máy chủ phát nguyên câu, ô nhãn chật nên chỉ in nhãn
// gọn, câu đầy đủ để ở title). Chỉ nhắc, không chặn — cùng mức luật đè vùng khoá ở máy chủ.
export function chuCanhBaoMay(cau: string[] | undefined): string | null {
  if (!cau || cau.length === 0) return null;
  if (cau.length > 1) return `${cau.length} cảnh báo máy`;
  return cau[0].includes("dừng chờ sửa") ? "máy dừng chờ sửa" : "đè lịch khoá máy";
}
