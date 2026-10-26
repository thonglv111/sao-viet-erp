import { useEffect, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";

import { OGoDinhDang } from "./OGoDinhDang";

/** Viết số (có thể có phần lẻ) theo kiểu Việt Nam: "1.234,5"; 0 ⇒ ô trống. */
export function vietSoLe(n: number): string {
  return n ? n.toLocaleString("vi-VN", { maximumFractionDigits: 6 }) : "";
}

/** Đọc chữ đang gõ kiểu Việt Nam: dấu chấm là phân cách nghìn, dấu PHẨY là dấu thập phân.
 *  `am` = nhận dấu "-" (hoặc "−") ở ĐẦU — ô "Điều chỉnh lương" gõ âm để trừ; chỉ mới gõ "-" thì chữ
 *  giữ "-", số là 0. */
export function docSoLe(chu: string, toiDaLe = 6, am = false): { chu: string; so: number } {
  const tru = am && /^\s*[-−]/.test(chu);
  const sach = chu.replace(/[^\d.,]/g, "");
  const phay = sach.indexOf(",");
  const nguyen = (phay < 0 ? sach : sach.slice(0, phay)).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const le = phay < 0 ? null : sach.slice(phay + 1).replace(/\D/g, "").slice(0, toiDaLe);
  const nguyenSo = nguyen ? Number(nguyen) : 0;
  const hien = nguyen ? nguyenSo.toLocaleString("vi-VN") : le != null ? "0" : "";
  const so = Number(`${nguyenSo}.${le || 0}`);
  return {
    chu: (tru ? "-" : "") + (le != null ? `${hien},${le}` : hien),
    so: tru && so ? -so : so,
  };
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  onChange: (v: number) => void;
  /** Nhận số âm (dấu "-" ở đầu). */
  am?: boolean;
  /** Số chữ số lẻ tối đa sau dấu phẩy; 0 = chỉ số nguyên. */
  toiDaLe?: number;
  /** Số 0 từ ngoài vào thì hiện chữ "0" thay vì ô trống (dòng kế hoạch: 0 = "không cần cấp"). */
  hienSo0?: boolean;
};

/** Ô số giữ nguyên CHỮ đang gõ ("1," / "-" / "1.234," chưa xong vẫn hiện), chỉ bắn `onChange(số)`.
 *  Không dựng lại chữ từ số mỗi phím — dựng lại là nuốt dấu phẩy / dấu trừ đang gõ dở (L-SX-06, 35).
 *  Giá trị đổi từ NGOÀI (điền sẵn, bấm "Về 0") thì viết lại; giá trị do chính ô gửi thì giữ chữ. */
export function OSoLe({ value, onChange, am = false, toiDaLe = 6, hienSo0 = false, inputMode, ...rest }: Props) {
  const viet = (n: number) => (hienSo0 && n === 0 ? "0" : vietSoLe(n));
  const [chu, setChu] = useState(() => viet(value));
  const daGui = useRef(value);
  useEffect(() => {
    if (value !== daGui.current) {
      daGui.current = value;
      setChu(viet(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ viết lại khi GIÁ TRỊ đổi từ ngoài
  }, [value]);
  return (
    <OGoDinhDang
      {...rest}
      type="text"
      inputMode={inputMode ?? (toiDaLe > 0 ? "decimal" : "numeric")}
      value={chu}
      onChange={(e) => {
        const d = docSoLe(e.target.value, toiDaLe, am);
        daGui.current = d.so;
        setChu(d.chu);
        onChange(d.so);
      }}
    />
  );
}
