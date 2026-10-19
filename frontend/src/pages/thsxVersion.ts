// Khoá lạc quan ở bàn tổ (lỗi #43): `busy` nhả ngay khi máy chủ lưu, chi tiết việc nạp lại SAU. Cú
// bấm thứ hai trong khoảng đó mà lấy `version` từ chi tiết cũ là máy chủ báo "Phiên bản không khớp".

export interface VerViec {
  id: number;
  version: number;
}

/** `version` gửi kèm lần ghi kế: số MỚI NHẤT của CHÍNH việc đang mở — lấy từ phản hồi lần ghi vừa
 *  rồi (`tam`) khi chi tiết chưa kịp nạp về, không thì từ chi tiết. */
export function verMoiNhat(chiTiet: VerViec | null | undefined, tam: VerViec | null | undefined): number | undefined {
  if (!chiTiet) return tam?.version;
  if (tam && tam.id === chiTiet.id && tam.version > chiTiet.version) return tam.version;
  return chiTiet.version;
}

/** Phản hồi ghi mang `cong_viec_id` + `version` (`SxLenhKetQua`) ⇒ nhớ lại; kiểu khác ⇒ null. */
export function verTuKetQua(r: unknown): VerViec | null {
  const x = r as { cong_viec_id?: unknown; version?: unknown } | null;
  return x && typeof x.cong_viec_id === "number" && typeof x.version === "number"
    ? { id: x.cong_viec_id, version: x.version }
    : null;
}
