/** Cột "Ngày tạo" (và các cột mốc ngày khác) của các danh sách sản xuất: ô hiện `dd/MM/yyyy`,
 *  `title` đủ giờ. Theo giờ máy người xem (giờ xưởng). Rỗng/hỏng ⇒ "—" (title rỗng). */
const dd = (n: number) => String(n).padStart(2, "0");

function doc(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function ngayDayDu(v: string | null | undefined): string {
  const d = doc(v);
  return d ? `${dd(d.getDate())}/${dd(d.getMonth() + 1)}/${d.getFullYear()}` : "—";
}

export function ngayGioDayDu(v: string | null | undefined): string | undefined {
  const d = doc(v);
  return d ? `${ngayDayDu(v)} ${dd(d.getHours())}:${dd(d.getMinutes())}` : undefined;
}

/** Ngày gọn cho ô hẹp của lưới (mockup bàn tổ "Tạo 06/10 Nhận 09/10 09:57"): `dd/MM`, khác năm hiện
 *  tại mới thêm năm; `coGio` thêm `HH:mm`. Đủ ngày giờ vẫn để ở `title`. */
export function ngayNgan(v: string | null | undefined, coGio = false): string {
  const d = doc(v);
  if (!d) return "—";
  const dm = `${dd(d.getDate())}/${dd(d.getMonth() + 1)}${d.getFullYear() === new Date().getFullYear() ? "" : `/${d.getFullYear()}`}`;
  return coGio ? `${dm} ${dd(d.getHours())}:${dd(d.getMinutes())}` : dm;
}
