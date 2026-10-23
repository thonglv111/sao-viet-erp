// Bong bóng rê chuột nhiều dòng + định dạng % dùng chung cho màn Khoán theo tổ và ngăn soi khoán SP.
import type { ReactNode } from "react";
import { HoverTip } from "../../../../components/HoverTip";
import "../tabs/khoan-theo-to.css";

/** Phần trăm kiểu Việt, một chữ số lẻ: 36.42 → "36,4%". */
export function pt(x: number): string {
  return `${(Math.round(x * 10) / 10).toLocaleString("vi-VN")}%`;
}

/** Bong bóng nhiều dòng "nhãn viên thuốc — nội dung". */
export function Hov({ neo, rows, tieuDe, rong = 440 }: { neo: ReactNode; rows: [string, ReactNode][]; tieuDe?: string; rong?: number }) {
  return (
    <HoverTip tieuDe={tieuDe} rong={rong} lopNeo="ktt-neo" neo={neo}>
      <dl className="hover-tip__dong">
        {rows.map(([k, v]) => (
          <div className="hover-tip__hang" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </HoverTip>
  );
}
