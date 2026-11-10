// Ô chọn một giá trị, danh sách tự dựng thay ô chọn gốc của trình duyệt: mỗi dòng một tên, thông tin
// phụ (biển số, mã…) là chữ xám bên phải, tách bằng khoảng trống chứ không ghép thành một chuỗi.
// Dùng ở ô Kho xuất (Tạo đơn thương mại) và ô Xe (hộp Cách giao).
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import "./o-chon-gon.css";

export type MucChon = { value: string; ten: string; phu?: string | null };

export function OChonGon({ ds, value, onChange, nhan, trong, khoa, goiY = "Chọn…", phuChiTrongDs }: {
  ds: MucChon[];
  /** "" = chưa chọn (ứng với dòng `trong` nếu có). */
  value: string;
  onChange: (v: string) => void;
  /** aria-label của ô. */
  nhan: string;
  /** Dòng đầu chọn "không có gì" (vd "Không dùng xe của công ty"); không truyền thì không có dòng này. */
  trong?: string;
  khoa?: boolean;
  /** Chữ trên ô khi chưa chọn gì (không có dòng `trong`). */
  goiY?: string;
  /** Chỉ hiện thông tin phụ trong danh sách, không hiện trên ô đã chọn (khi ô bên cạnh đã nói nó). */
  phuChiTrongDs?: boolean;
}) {
  const [mo, setMo] = useState(false);
  const goc = useRef<HTMLDivElement>(null);
  const muc: MucChon[] = trong != null ? [{ value: "", ten: trong }, ...ds] : ds;
  const chon = muc.find((m) => m.value === value) ?? null;

  useEffect(() => {
    if (!mo) return;
    const ngoai = (e: MouseEvent) => { if (goc.current && !goc.current.contains(e.target as Node)) setMo(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMo(false);
    document.addEventListener("mousedown", ngoai);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", ngoai); document.removeEventListener("keydown", esc); };
  }, [mo]);

  return (
    <div className="ocg" ref={goc}>
      <button type="button" className={`ocg__o${mo ? " is-open" : ""}`} aria-label={nhan} aria-expanded={mo}
        disabled={khoa || muc.length === 0} onClick={() => setMo((v) => !v)}>
        <span className="ocg__ten">{chon?.ten ?? (muc.length ? goiY : "Chưa có")}</span>
        {chon?.phu && !phuChiTrongDs && <span className="ocg__phu">{chon.phu}</span>}
        <ChevronDown size={14} className="ocg__chev" aria-hidden="true" />
      </button>
      {mo && (
        <div className="ocg__pop" role="listbox" aria-label={nhan}>
          {muc.map((m) => (
            <button type="button" role="option" aria-selected={m.value === value} key={m.value}
              className={`ocg__opt${m.value === value ? " is-sel" : ""}`}
              onClick={() => { setMo(false); if (m.value !== value) onChange(m.value); }}>
              <Check size={14} className="ocg__ck" aria-hidden="true" />
              <span className="ocg__ten">{m.ten}</span>
              {m.phu && <span className="ocg__phu">{m.phu}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
