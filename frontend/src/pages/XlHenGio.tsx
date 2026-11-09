// Hộp hẹn giờ đẩy (bàn hẹn đẩy, 08/11/2026). Một ô ngày-giờ của app (`ChonNgayGio`, không dùng ô
// ngày gốc của trình duyệt) + chặn giờ đã qua ngay ở màn — máy chủ cũng chặn, đây chỉ để khỏi đợi.
import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";

import { ChonNgayGio } from "../components/ChonNgay";
import { ConfirmDialog } from "../components/ConfirmDialog";

/** Bây giờ theo đồng hồ máy, dạng `YYYY-MM-DDTHH:mm` giờ tường — KHÔNG `toISOString()` (dịch UTC). */
export function bayGioTuong(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Giờ gợi ý: tròn giờ kế tiếp. */
function goiY(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return bayGioTuong(d);
}

export function XlHenGio({
  open, soLenh, giaTriDau, busy, loi, onHen, onHuy,
}: {
  open: boolean;
  soLenh: number;
  /** Giờ hẹn đang có (đổi giờ) — `YYYY-MM-DDTHH:mm…`. */
  giaTriDau?: string | null;
  busy: boolean;
  loi: string | null;
  onHen: (henLuc: string) => void;
  onHuy: () => void;
}) {
  const [gio, setGio] = useState("");
  const [loiMan, setLoiMan] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const cu = giaTriDau?.slice(0, 16);
    setGio(cu && cu > bayGioTuong() ? cu : goiY());
    setLoiMan(null);
  }, [open, giaTriDau]);

  const chot = () => {
    if (!gio || gio.length < 16) { setLoiMan("Chọn ngày và giờ hẹn."); return; }
    if (gio <= bayGioTuong()) { setLoiMan("Giờ hẹn phải sau bây giờ."); return; }
    setLoiMan(null);
    onHen(gio);
  };

  return (
    <ConfirmDialog
      open={open}
      title={soLenh > 1 ? `Hẹn giờ đẩy ${soLenh} lệnh` : giaTriDau ? "Đổi giờ hẹn đẩy" : "Hẹn giờ đẩy"}
      icon={<CalendarClock size={20} />}
      message="Tới giờ hẹn, phần mềm tự đẩy lệnh xuống xưởng bằng quyền của bạn. Đẩy không được thì lệnh sang tab Kẹt và bạn nhận thông báo."
      confirmLabel={busy ? "Đang lưu" : "Hẹn giờ"}
      cancelLabel="Huỷ"
      busy={busy}
      error={loiMan ?? loi}
      onConfirm={chot}
      onCancel={onHuy}
    >
      <label style={{ display: "block", fontSize: 13, marginBottom: 6 }} htmlFor="xh-gio-hen">Giờ hẹn đẩy</label>
      <ChonNgayGio id="xh-gio-hen" value={gio} min={bayGioTuong()} onChange={setGio} aria-label="Giờ hẹn đẩy"
        required gioMacDinh="07:30" />
    </ConfirmDialog>
  );
}
