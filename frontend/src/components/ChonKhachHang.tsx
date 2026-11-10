// Ô chọn khách hàng dùng chung: danh sách tìm khách của dải Khách hàng ở Phiếu tính giá
// (DaiKhachHang) tách ra để màn khác dùng lại cùng cách bày. Tìm ở MÁY CHỦ, đúng phạm vi Khách hàng
// của người dùng.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Building2, Check, ChevronDown, Plus } from "lucide-react";
import { api, type CustomerRow } from "../api/client";
import { useAuth } from "../auth/useAuth";
import "./dai-khach-hang.css";

const phuMst = (k: CustomerRow) => (k.tax_code ? <span>MST {k.tax_code}</span> : null);

/** Ô tìm + danh sách khách, nằm trong khung `.dkh__pop`. */
export function DsTimKhach({
  chonId,
  onChon,
  goiY = "Gõ tên, mã hoặc mã số thuế",
  phu = phuMst,
}: {
  chonId: number | null;
  onChon: (k: CustomerRow) => void;
  goiY?: string;
  /** Mẩu phụ sau mã khách ở từng dòng; mặc định MST. */
  phu?: (k: CustomerRow) => ReactNode;
}) {
  const { token } = useAuth();
  const [tim, setTim] = useState("");
  const [khachs, setKhachs] = useState<CustomerRow[]>([]);
  const [dangTim, setDangTim] = useState(true);

  useEffect(() => {
    if (!token) return;
    setDangTim(true);
    const h = window.setTimeout(() => {
      api.customers
        .list(token, { q: tim.trim() || undefined, size: 20, sort: "name" })
        .then((r) => setKhachs(r.items))
        .catch(() => setKhachs([]))
        .finally(() => setDangTim(false));
    }, 200);
    return () => window.clearTimeout(h);
  }, [tim, token]);

  return (
    <>
      <input
        autoFocus
        className="dkh__search"
        placeholder={goiY}
        value={tim}
        onChange={(e) => setTim(e.target.value)}
        aria-label="Tìm khách hàng"
      />
      {khachs.map((k) => (
        <button
          type="button"
          key={k.id}
          className={`dkh__opt${k.id === chonId ? " is-sel" : ""}`}
          onClick={() => onChon(k)}
        >
          <span>
            <span className="dkh__opt-t">{k.name}</span>
            <span className="dkh__opt-d">
              <span className="dkh__tag">{k.code}</span>
              {phu(k)}
            </span>
          </span>
          <Check size={14} className="dkh__ck" aria-hidden="true" />
        </button>
      ))}
      {!dangTim && khachs.length === 0 && (
        <div className="dkh__none">Không tìm thấy khách trong phạm vi bạn được xem.</div>
      )}
    </>
  );
}

export type KhachDaChon = { id: number; name: string; code?: string | null; phone?: string | null };

const phuSdt = (k: CustomerRow) => (k.phone ? <span>{k.phone}</span> : null);

/** Một ô Khách hàng đứng riêng (cùng khuôn ô đầu của dải ở Phiếu tính giá): bấm mở danh sách tìm. */
export function OChonKhach({
  value,
  onChange,
  khoa,
}: {
  value: KhachDaChon | null;
  onChange: (k: KhachDaChon) => void;
  khoa?: boolean;
}) {
  const [mo, setMo] = useState(false);
  const goc = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mo) return;
    const dong = (e: MouseEvent) => {
      if (goc.current && !goc.current.contains(e.target as Node)) setMo(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMo(false);
    document.addEventListener("mousedown", dong);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", dong);
      document.removeEventListener("keydown", esc);
    };
  }, [mo]);

  return (
    <div className="dkh dkh--sua dkh--mot" ref={goc}>
      <button
        type="button"
        className={`dkh__o${mo ? " is-open" : ""}`}
        disabled={khoa}
        aria-expanded={mo}
        onClick={() => setMo((v) => !v)}
      >
        <div className="dkh__k">
          <Building2 size={13} aria-hidden="true" />
          Khách hàng
          <ChevronDown size={13} className="dkh__chev" aria-hidden="true" />
        </div>
        {value ? (
          <>
            <div className="dkh__v">{value.name}</div>
            {(value.code || value.phone) && (
              <div className="dkh__s dkh__s--manh">
                {value.code && <span>{value.code}</span>}
                {value.phone && <span>{value.phone}</span>}
              </div>
            )}
          </>
        ) : (
          <span className="dkh__empty">
            <Plus size={13} aria-hidden="true" />
            Chọn khách hàng
          </span>
        )}
      </button>
      {mo && (
        <div className="dkh__pop dkh__pop--kh" role="listbox">
          <DsTimKhach
            chonId={value?.id ?? null}
            goiY="Gõ tên, số điện thoại hoặc mã số thuế"
            phu={phuSdt}
            onChon={(k) => {
              setMo(false);
              if (k.id !== value?.id) onChange({ id: k.id, name: k.name, code: k.code, phone: k.phone });
            }}
          />
        </div>
      )}
    </div>
  );
}
