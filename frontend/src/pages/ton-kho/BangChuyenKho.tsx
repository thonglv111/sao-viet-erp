// Mẩu ô dùng chung của tab Lịch sử sửa (ngăn mặt hàng, `NganLichSu.tsx`): chip Việc, số Chênh, ô
// Ghi chú sửa tại chỗ. Bảng chuyển kho của trang kho và của ngăn đều vẽ ở `NganLichSu.tsx` (04/11/2026).
import { useState } from "react";
import type { LichSuSuaRow } from "../../api/client";
import { ApiError } from "../../api/client";
import { fmtQty } from "../khoShared";
import "./bang-chuyen-kho.css";

const tru = <span className="lds-mu3">–</span>;

/** Chip màu của cột Việc — mỗi việc một sắc (bộ `--tt-*`). */
export const LOP_VIEC: Record<string, string> = {
  "Sửa tồn": "lss-chip--lam",
  "Thêm hàng": "lss-chip--xanh",
  "Đặt mức tồn": "lss-chip--cam",
  "Sửa giá gốc": "lss-chip--tim",
  "Bổ sung khổ": "lss-chip--tim",
};

export function Chenh({ v, dv }: { v: number | null; dv: string }) {
  if (v == null || Math.abs(v) < 1e-9) return null;
  return (
    <span className={v > 0 ? "lss-tang" : "lss-giam"}>
      {`${v > 0 ? "+" : "−"}${fmtQty(Math.abs(v))} ${dv}`.trim()}
    </span>
  );
}

/** Ô Ghi chú của một lần sửa: chữ người dùng gõ, bấm vào là sửa tại chỗ (Enter lưu, Esc thôi,
 *  Shift+Enter xuống dòng). Không có quyền thì chỉ đọc. */
export function OGhiChu({ r, suaDuoc, onLuu }: {
  r: LichSuSuaRow;
  suaDuoc: boolean;
  onLuu: (id: number, ghiChu: string) => Promise<void>;
}) {
  const [nhap, setNhap] = useState<string | null>(null);
  const [dangLuu, setDangLuu] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const luu = async () => {
    if (nhap == null || dangLuu) return;
    if (nhap.trim() === r.ghi_chu) { setNhap(null); return; }
    setDangLuu(true);
    try {
      await onLuu(r.id, nhap.trim());
      setNhap(null);
      setLoi(null);
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : "Không lưu được ghi chú.");
    } finally {
      setDangLuu(false);
    }
  };
  if (nhap != null) {
    return (
      <>
        <textarea
          className="lss-o-nhap"
          autoFocus
          rows={2}
          maxLength={1000}
          value={nhap}
          disabled={dangLuu}
          placeholder="Vì sao sửa, đếm lại ở đâu…"
          onChange={(e) => setNhap(e.target.value)}
          onBlur={() => void luu()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void luu(); }
            if (e.key === "Escape") { e.preventDefault(); setNhap(null); setLoi(null); }
          }}
        />
        {loi && <div className="lss-loi">{loi}</div>}
      </>
    );
  }
  if (!suaDuoc) return r.ghi_chu ? <span className="lss-chu">{r.ghi_chu}</span> : tru;
  return (
    <button
      type="button"
      className="lss-o-sua"
      title={r.ghi_chu_nguoi ? `${r.ghi_chu_nguoi} sửa ghi chú lần cuối` : "Bấm để ghi chú"}
      onClick={() => setNhap(r.ghi_chu)}
    >
      {r.ghi_chu ? <span className="lss-chu">{r.ghi_chu}</span> : <span className="lss-goi-y">Thêm ghi chú</span>}
    </button>
  );
}
