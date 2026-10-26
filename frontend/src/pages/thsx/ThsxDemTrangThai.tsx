import type { ThsxChoLoai, ThsxTrangThaiLoc } from "../loc-san-xuat/dieu-kien-ban-to";

// Hàng chip trạng thái dưới thanh lọc bàn tổ (mockup ban-to-ngan-A-tinh-chinh): chính nó là bộ chọn
// "Trạng thái" — menu Lọc không vẽ khối riêng cho điều kiện này. Thứ tự + sắc `--tt-*`.
const DEM_TT = [
  ["running", "Đang chạy", "chay"],
  ["paused", "Tạm dừng", "dung"],
  ["released", "Chờ làm", "cho"],
  ["completed", "Hoàn thành", "xong"],
] as const satisfies readonly (readonly [ThsxTrangThaiLoc, string, string])[];

/** Việc chờ tổ bấm — mỗi loại một chip, một sắc riêng (10/10/2026: tách khỏi chip gộp "Chờ tổ xác
 *  nhận" để tổ thấy ngay hàng tới mà chưa nhận, và lọc riêng được từng loại). */
const CHO_LOAI = [
  ["ban_giao", "Hàng chờ nhận", "cam"],
  ["kcs", "Lỗi KCS chờ xem", "do"],
] as const satisfies readonly (readonly [ThsxChoLoai, string, string])[];

export type DemTrangThai = Record<ThsxTrangThaiLoc, number> & { tong: number };

/** `dem` đếm TRƯỚC lọc trạng thái (máy chủ `loc-dem`) nên chip chưa chọn vẫn nói còn bao nhiêu việc.
 *  Bấm chip = thêm/bớt trạng thái đó; "Tất cả" = bỏ lọc trạng thái.
 *  `cho` = chip việc chờ tổ bấm cuối hàng, mỗi loại một chip: bấm bật/tắt điều kiện "Việc chờ tổ bấm"
 *  của loại đó. Chip chỉ hiện khi loại đó còn việc chờ hoặc đang lọc theo nó — hết việc thì rụng.
 *  `dem` null = chưa có số (đang tải / máy chủ lỗi): chip in "—", không in "0" giả (L-VAI-45). */
export function ThsxDemTrangThai({ dem, chon, onChon, cho }: {
  dem: DemTrangThai | null;
  chon: ThsxTrangThaiLoc[];
  onChon: (v: ThsxTrangThaiLoc[]) => void;
  cho?: { so: Record<ThsxChoLoai, number>; chon: ThsxChoLoai[]; onChon: (v: ThsxChoLoai[]) => void };
}) {
  return (
    <div className="thsx-dem" role="group" aria-label="Lọc theo trạng thái">
      <button type="button" className="thsx-dem__chip" aria-pressed={chon.length === 0} onClick={() => onChon([])}>
        Tất cả <span className="thsx-num">{dem?.tong ?? "—"}</span>
      </button>
      {DEM_TT.map(([v, chu, mau]) => {
        const on = chon.includes(v);
        return (
          <button key={v} type="button" className="thsx-dem__chip" aria-pressed={on}
            onClick={() => onChon(on ? chon.filter((t) => t !== v) : [...chon, v])}>
            <i className={`thsx-dem__cham thsx-dem__cham--${mau}`} aria-hidden="true" />
            {chu} <span className="thsx-num">{dem?.[v] ?? "—"}</span>
          </button>
        );
      })}
      {cho && CHO_LOAI.map(([k, chu, mau]) => {
        const on = cho.chon.includes(k);
        const so = cho.so[k] ?? 0;
        if (so === 0 && !on) return null;
        return (
          <button key={k} type="button" className={`thsx-dem__chip thsx-dem__chip--${mau}`} aria-pressed={on}
            onClick={() => cho.onChon(on ? cho.chon.filter((t) => t !== k) : [...cho.chon, k])}>
            <i className={`thsx-dem__cham thsx-dem__cham--${mau}`} aria-hidden="true" />
            {chu} <span className="thsx-num">{so}</span>
          </button>
        );
      })}
    </div>
  );
}
