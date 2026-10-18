// Ô nhập có HAI TAB: "%" gõ phần trăm, "Số" gõ số tiền (Markup, Chiết khấu ở bảng báo giá).
// Hai tab cùng một giá trị, chỉ khác cách gõ: tab nào đang chọn thì ô hiện số theo tab đó, gõ xong máy
// tự suy ra số của tab kia. Tab chọn là trạng thái riêng của ô (không lưu), mặc định "%".
import { useState } from "react";

import { ONhapSo } from "./ONhapSo";

export type Kieu = "pct" | "so";

export function OHaiTab({
  pct,
  so,
  disabled,
  ariaLabel,
  titlePct,
  titleSo,
  onNhap,
  onChot,
  onHuy,
  buoc = 0.5,
}: {
  /** Giá trị hiện tại theo %, đã làm tròn để hiển thị. */
  pct: number;
  /** Giá trị hiện tại theo số tiền (đ). */
  so: number;
  disabled?: boolean;
  ariaLabel: string;
  titlePct?: string;
  titleSo?: string;
  /** Mỗi lần gõ — bảng tính lại ngay (nháp, chưa lưu). */
  onNhap?: (kieu: Kieu, v: number) => void;
  /** Rời ô / Enter — lưu. */
  onChot: (kieu: Kieu, v: number) => void;
  /** Esc / không đổi — bỏ nháp. */
  onHuy?: () => void;
  buoc?: number;
}) {
  const [kieu, setKieu] = useState<Kieu>("pct");
  return (
    <div className="o2tab">
      <div className="o2tab__tab" role="tablist" aria-label={`${ariaLabel} — cách nhập`}>
        {(["pct", "so"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kieu === k}
            className={kieu === k ? "is-on" : undefined}
            disabled={disabled}
            onClick={() => { if (k !== kieu) { onHuy?.(); setKieu(k); } }}
          >
            {k === "pct" ? "%" : "Số"}
          </button>
        ))}
      </div>
      <ONhapSo
        className={kieu === "pct" ? "pct" : "money"}
        giaTri={kieu === "pct" ? pct : Math.round(so)}
        donVi={kieu === "pct" ? "%" : "đ"}
        soLe={kieu === "pct" ? 1 : 0}
        buoc={kieu === "pct" ? buoc : undefined}
        disabled={disabled}
        ariaLabel={`${ariaLabel} (${kieu === "pct" ? "%" : "số tiền"})`}
        title={kieu === "pct" ? titlePct : titleSo}
        onNhap={(v) => onNhap?.(kieu, v)}
        onHuy={onHuy}
        onChot={(v) => onChot(kieu, v)}
      />
    </div>
  );
}
