// Ô "Giá bán theo ĐVT" của danh mục Hàng thương mại (chỉ In Hà Phương, 08/11/2026): mỗi ĐVT đã khai
// của mặt hàng (ĐVT chính + đơn vị thêm) một ô giá. Không quy đổi giá giữa các ĐVT. Ô để trống =
// chưa đặt giá cho ĐVT đó, người bán gõ ở dòng đơn.
import { OGoDinhDang } from "../../components/OGoDinhDang";
import type { Row } from "./types";

type GiaTheoDvt = Record<string, number>;

const chuSo = (s: string) => s.replace(/\D/g, "");
const hien = (n: number | undefined) => (n == null ? "" : n.toLocaleString("vi-VN"));

export function OGiaBanTheoDvt({ value, chinh, them, donVi, onChange }: {
  value: unknown;
  chinh: string;
  them: string[];
  donVi: Row[];
  onChange: (v: GiaTheoDvt) => void;
}) {
  const gia: GiaTheoDvt = value && typeof value === "object" && !Array.isArray(value) ? (value as GiaTheoDvt) : {};
  const dvt = [chinh, ...them].map((m) => m.trim().toLowerCase()).filter((m, i, a) => m && a.indexOf(m) === i);
  const ten = (ma: string) => String(donVi.find((d) => String(d.ma ?? "").toLowerCase() === ma)?.ten ?? ma);
  if (dvt.length === 0) {
    return <span className="rc-field__hint">Chọn đơn vị tính trước rồi đặt giá bán.</span>;
  }
  return (
    <div className="rc-gia-dvt">
      {dvt.map((ma) => (
        <label key={ma} className="rc-gia-dvt__dong">
          <span>{ten(ma)}</span>
          <OGoDinhDang
            className="rc-input rc-input--num"
            inputMode="numeric"
            aria-label={`Giá bán theo ${ten(ma)}`}
            value={hien(gia[ma])}
            onChange={(e) => {
              const so = chuSo(e.target.value);
              const moi = { ...gia };
              if (so === "") delete moi[ma];
              else moi[ma] = Number(so);
              onChange(moi);
            }}
          />
          <span className="rc-gia-dvt__dv">đ</span>
        </label>
      ))}
    </div>
  );
}
