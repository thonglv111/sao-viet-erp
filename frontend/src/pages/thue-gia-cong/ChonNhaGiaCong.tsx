// Ô chọn Nhà gia công của hộp Lập đơn gia công (16/11/2026). Danh sách riêng, không dính nhà cung cấp:
// thêm, bỏ ngay trong ô như ô Đơn vị vận chuyển (ChonDonViVc), không có hãng gợi ý. Gõ tên chưa có thì
// hiện dòng "Thêm «tên»". Bỏ nhà đã có đơn thì máy chủ chỉ ẩn khỏi danh sách, đơn cũ vẫn giữ tên.
// Danh sách treo ở `document.body` + `position: fixed` (như PopoverO): thân hộp Lập đơn tự cuộn nên
// ô bật lên nằm trong đó bị cắt mất dòng cuối. Hết chỗ phía dưới thì lật lên trên ô; cuộn thì đóng.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { tgcApi, type TgcNhaGiaCong } from "../../api/thueGiaCong";
import { KyHieu } from "../giao-hang-hp/ChonDonViVc";
import "../../components/o-chon-gon.css";
import "../giao-hang-hp/chon-don-vi-vc.css";

const boDau = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d")
  .replace(/Đ/g, "D").toLowerCase().trim();

export function ChonNhaGiaCong({ token, value, onChange, disabled, tenCu }: {
  token: string | null;
  value: number | null;
  onChange: (id: number | null) => void;
  disabled?: boolean;
  /** Tên chụp trên đơn đang mở — hiện khi nhà của đơn đã bị bỏ khỏi danh sách. */
  tenCu?: string | null;
}) {
  const [ds, setDs] = useState<TgcNhaGiaCong[] | null>(null);
  const [mo, setMo] = useState(false);
  const [tim, setTim] = useState("");
  const [dangGhi, setDangGhi] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const goc = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [viTri, setViTri] = useState<CSSProperties | null>(null);
  const oTim = useRef<HTMLInputElement>(null);

  const tai = () => {
    if (!token) return Promise.resolve();
    return tgcApi.nhaGiaCong(token).then(setDs)
      .catch((e: unknown) => { setDs([]); setLoi(e instanceof Error ? e.message : "Không tải được danh sách"); });
  };
  useEffect(() => { void tai(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!mo) { setViTri(null); return; }
    const r = goc.current?.getBoundingClientRect();
    if (!r) return;
    const duoi = window.innerHeight - r.bottom - 14;
    const tren = r.top - 14;
    const lat = duoi < 260 && tren > duoi;
    const cao = Math.min(380, lat ? tren : duoi);
    setViTri({
      position: "fixed", zIndex: 450, left: r.left, width: r.width, right: "auto", maxHeight: cao,
      ...(lat ? { top: "auto", bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
    });
  }, [mo]);

  // Ô tìm chỉ có sau khi đo xong vị trí (danh sách vẽ ở lần kế).
  useEffect(() => { if (viTri) oTim.current?.focus(); }, [viTri]);

  useEffect(() => {
    if (!mo) return;
    const trong = (t: Node) => !!(goc.current?.contains(t) || pop.current?.contains(t));
    const ngoai = (e: MouseEvent) => { if (!trong(e.target as Node)) setMo(false); };
    // Esc chỉ đóng danh sách, không lan tới hộp Lập đơn (hộp cũng đóng bằng Esc).
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setMo(false); } };
    const cuon = (e: Event) => { if (!trong(e.target as Node)) setMo(false); };
    document.addEventListener("mousedown", ngoai);
    document.addEventListener("keydown", esc, true);
    window.addEventListener("scroll", cuon, true);
    window.addEventListener("resize", cuon);
    return () => {
      document.removeEventListener("mousedown", ngoai);
      document.removeEventListener("keydown", esc, true);
      window.removeEventListener("scroll", cuon, true);
      window.removeEventListener("resize", cuon);
    };
  }, [mo]);

  const chon = ds?.find((d) => d.id === value) ?? null;
  const tenHien = chon?.ten ?? (value != null && tenCu ? tenCu : null);
  const k = boDau(tim);
  const dsLoc = useMemo(() => (ds ?? []).filter((d) => !k || boDau(d.ten).includes(k)), [ds, k]);
  const trungTen = !!k && (ds ?? []).some((d) => boDau(d.ten) === k);
  const coThan = dsLoc.length > 0 || (ds != null && ds.length === 0 && !k);

  const dong = () => { setMo(false); setTim(""); };

  const them = async (ten: string) => {
    if (!token || dangGhi) return;
    setDangGhi(true); setLoi(null);
    try {
      const n = await tgcApi.themNhaGiaCong(token, ten.trim());
      await tai();
      onChange(n.id);
      dong();
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Không thêm được");
    } finally { setDangGhi(false); }
  };

  const bo = async (n: TgcNhaGiaCong) => {
    if (!token || dangGhi) return;
    setDangGhi(true); setLoi(null);
    try {
      await tgcApi.boNhaGiaCong(token, n.id);
      if (n.id === value) onChange(null);
      await tai();
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Không bỏ được");
    } finally { setDangGhi(false); }
  };

  return (
    <div className="ocg cdv" ref={goc}>
      <button type="button" className={`ocg__o${mo ? " is-open" : ""}`} aria-label="Nhà gia công"
        aria-expanded={mo} disabled={ds == null || disabled} onClick={() => setMo((v) => !v)}>
        {tenHien && <KyHieu ten={tenHien} nho />}
        <span className={`ocg__ten${tenHien ? "" : " cdv__cho"}`}>
          {tenHien ?? (ds == null ? "Đang tải…" : "Chọn hoặc thêm nhà gia công")}
        </span>
        <ChevronDown size={14} className="ocg__chev" aria-hidden="true" />
      </button>
      {mo && viTri && createPortal(
        <div className="cdv__pop" ref={pop} style={viTri}>
          <label className="cdv__tim">
            <Search size={15} aria-hidden="true" />
            <input ref={oTim} placeholder="Tìm, hoặc gõ tên nhà mới" aria-label="Tìm nhà gia công"
              value={tim} maxLength={255} onChange={(e) => setTim(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (dsLoc.length === 1) { onChange(dsLoc[0].id); dong(); }
                else if (k && !trungTen) void them(tim);
              }} />
          </label>

          {coThan && <div className="cdv__than">
            <p className="cdv__nhom">Nhà đã dùng</p>
            {ds && ds.length === 0 && !k && <p className="cdv__trong">Chưa có. Gõ tên ở ô trên để thêm.</p>}
            <div role="listbox" aria-label="Nhà gia công">
              {dsLoc.map((n) => {
                const sel = n.id === value;
                return (
                  <div key={n.id} className={`cdv__dong${sel ? " is-sel" : ""}`}>
                    <button type="button" role="option" aria-selected={sel} className="cdv__chon"
                      onClick={() => { dong(); onChange(n.id); }}>
                      <KyHieu ten={n.ten} />
                      <span className="cdv__ten">{n.ten}</span>
                      {sel && <Check size={15} className="cdv__ck" aria-hidden="true" />}
                    </button>
                    <button type="button" className="cdv__xoa" aria-label={`Bỏ ${n.ten} khỏi danh sách`}
                      title="Bỏ khỏi danh sách" disabled={dangGhi} onClick={() => void bo(n)}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>}

          {k && !trungTen && (
            <button type="button" className="cdv__them" disabled={dangGhi} onClick={() => void them(tim)}>
              <span className="cdv__them-dau"><Plus size={15} aria-hidden="true" /></span>
              <span className="cdv__ten">Thêm <span className="cdv__them-ten">{tim.trim()}</span></span>
              <kbd>Enter</kbd>
            </button>
          )}
          {loi && <p className="cdv__trong is-loi">{loi}</p>}
        </div>,
        document.body,
      )}
    </div>
  );
}
