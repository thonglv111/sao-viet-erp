// Ô chọn Đơn vị vận chuyển của hộp Cách giao (chỉ bản cài bật `giao_hang_hp`). Danh sách riêng, không
// dính nhà cung cấp: thêm, bỏ ngay trong ô. Trên cùng là đơn vị đã thêm (mỗi dòng có nút ×), dưới là
// hãng phổ biến gợi ý (máy chủ trả `goi_y`, chưa có trong danh sách). Gõ tên chưa có thì hiện dòng
// "Thêm «tên»". Bỏ đơn vị đã từng giao thì máy chủ chỉ ẩn khỏi danh sách, lịch sử vẫn giữ tên.
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { giaoHangHpApi, type DonViVc } from "../../api/giaoHangHp";
import "../../components/o-chon-gon.css";
import "./chon-don-vi-vc.css";

const boDau = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d")
  .replace(/Đ/g, "D").toLowerCase().trim();

// Hãng có viết tắt trong ngoặc (GHN, GHTK) thì dùng viết tắt; còn lại lấy chữ đầu của từ đầu và từ cuối.
function vietTat(ten: string): string | null {
  const m = ten.match(/\(([A-Z0-9&]{2,5})\)/);
  return m ? m[1] : null;
}
function chuKyHieu(ten: string): string {
  const vt = vietTat(ten);
  if (vt) return vt.slice(0, 4);
  const tu = ten.replace(/\(.*?\)/g, "").split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w));
  if (!tu.length) return "?";
  const dau = (w: string) => (w.match(/[\p{L}\d]/u)?.[0] ?? "").toUpperCase();
  return tu.length === 1 ? tu[0].slice(0, 2).toUpperCase() : dau(tu[0]) + dau(tu[tu.length - 1]);
}
/** Chữ trên nút Thêm nhanh: viết tắt nếu có, không thì bỏ phần trong ngoặc. */
const tenNgan = (ten: string) => vietTat(ten) ?? ten.replace(/\s*\(.*?\)\s*/g, " ").trim();

const SAC = ["xanh", "la", "cam", "tim", "cyan", "ngoc", "vang", "cham", "do", "slate"];
function KyHieu({ ten, nho }: { ten: string; nho?: boolean }) {
  let h = 0;
  for (const c of boDau(ten)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const sac = SAC[h % SAC.length];
  const chu = chuKyHieu(ten);
  return (
    <span className={`cdv__ky${nho ? " is-nho" : ""}${chu.length > 2 ? " is-dai" : ""}`} aria-hidden="true"
      style={{ background: `var(--tt-${sac}-bg)`, color: `var(--tt-${sac}-fg)` }}>{chu}</span>
  );
}

export function ChonDonViVc({ token, value, onChange }: {
  token: string | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const [ds, setDs] = useState<DonViVc[] | null>(null);
  const [goiY, setGoiY] = useState<string[]>([]);
  const [mo, setMo] = useState(false);
  const [tim, setTim] = useState("");
  const [dangGhi, setDangGhi] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const goc = useRef<HTMLDivElement>(null);
  const oTim = useRef<HTMLInputElement>(null);

  const tai = () => {
    if (!token) return Promise.resolve();
    return giaoHangHpApi.donViVc(token).then((r) => { setDs(r.items); setGoiY(r.goi_y); })
      .catch((e: unknown) => setLoi(e instanceof Error ? e.message : "Không tải được danh sách"));
  };
  useEffect(() => { void tai(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mo) return;
    oTim.current?.focus();
    const ngoai = (e: MouseEvent) => { if (goc.current && !goc.current.contains(e.target as Node)) setMo(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMo(false);
    document.addEventListener("mousedown", ngoai);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", ngoai); document.removeEventListener("keydown", esc); };
  }, [mo]);

  const chon = ds?.find((d) => String(d.id) === value) ?? null;
  const k = boDau(tim);
  const dsLoc = useMemo(() => (ds ?? []).filter((d) => !k || boDau(d.ten).includes(k)), [ds, k]);
  const goiYLoc = useMemo(() => goiY.filter((t) => !k || boDau(t).includes(k)), [goiY, k]);
  const trungTen = !!k && [...(ds ?? []).map((d) => d.ten), ...goiY].some((t) => boDau(t) === k);
  // Gõ tên chưa có và không khớp gì thì chỉ còn dòng "Thêm" ở chân, khỏi chừa khoảng trống.
  const coThan = dsLoc.length > 0 || goiYLoc.length > 0 || (ds != null && ds.length === 0 && !k) || trungTen;

  const them = async (ten: string) => {
    if (!token || dangGhi) return;
    setDangGhi(true); setLoi(null);
    try {
      const d = await giaoHangHpApi.themDvvc(token, ten.trim());
      await tai();
      onChange(String(d.id));
      setTim(""); setMo(false);
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Không thêm được");
    } finally { setDangGhi(false); }
  };

  const bo = async (d: DonViVc) => {
    if (!token || dangGhi) return;
    setDangGhi(true); setLoi(null);
    try {
      await giaoHangHpApi.boDvvc(token, d.id);
      if (String(d.id) === value) onChange("");
      await tai();
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Không bỏ được");
    } finally { setDangGhi(false); }
  };

  return (
    <div className="ocg cdv" ref={goc}>
      <button type="button" className={`ocg__o${mo ? " is-open" : ""}`} aria-label="Đơn vị vận chuyển"
        aria-expanded={mo} disabled={ds == null} onClick={() => setMo((v) => !v)}>
        {chon && <KyHieu ten={chon.ten} nho />}
        <span className={`ocg__ten${chon ? "" : " cdv__cho"}`}>{chon?.ten ?? "Chọn hoặc thêm đơn vị"}</span>
        <ChevronDown size={14} className="ocg__chev" aria-hidden="true" />
      </button>
      {mo && (
        <div className="cdv__pop">
          <label className="cdv__tim">
            <Search size={15} aria-hidden="true" />
            <input ref={oTim} placeholder="Tìm, hoặc gõ tên đơn vị mới" aria-label="Tìm đơn vị vận chuyển"
              value={tim} maxLength={150} onChange={(e) => setTim(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (dsLoc.length === 1 && !goiYLoc.length) { onChange(String(dsLoc[0].id)); setMo(false); setTim(""); }
                else if (k && !trungTen) void them(tim);
              }} />
          </label>

          {coThan && <div className="cdv__than">
            {(dsLoc.length > 0 || (ds && ds.length === 0 && !k)) && <p className="cdv__nhom">Đơn vị đã dùng</p>}
            {ds && ds.length === 0 && !k && (
              <p className="cdv__trong">Chưa có. Bấm một hãng bên dưới hoặc gõ tên để thêm.</p>
            )}
            <div role="listbox" aria-label="Đơn vị vận chuyển">
              {dsLoc.map((d) => {
                const sel = String(d.id) === value;
                return (
                  <div key={d.id} className={`cdv__dong${sel ? " is-sel" : ""}`}>
                    <button type="button" role="option" aria-selected={sel} className="cdv__chon"
                      onClick={() => { setMo(false); setTim(""); onChange(String(d.id)); }}>
                      <KyHieu ten={d.ten} />
                      <span className="cdv__ten">{d.ten}</span>
                      {sel && <Check size={15} className="cdv__ck" aria-hidden="true" />}
                    </button>
                    <button type="button" className="cdv__xoa" aria-label={`Bỏ ${d.ten} khỏi danh sách`}
                      title="Bỏ khỏi danh sách" disabled={dangGhi} onClick={() => void bo(d)}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>

            {goiYLoc.length > 0 && (
              <>
                <p className="cdv__nhom">Thêm nhanh</p>
                <div className="cdv__chips">
                  {goiYLoc.map((t) => (
                    <button type="button" key={t} className="cdv__chip" title={`Thêm ${t}`} disabled={dangGhi}
                      onClick={() => void them(t)}>
                      <Plus size={13} aria-hidden="true" />{tenNgan(t)}
                    </button>
                  ))}
                </div>
              </>
            )}
            {k && !dsLoc.length && !goiYLoc.length && trungTen && (
              <p className="cdv__trong">Không có đơn vị nào khớp.</p>
            )}
          </div>}

          {k && !trungTen && (
            <button type="button" className="cdv__them" disabled={dangGhi} onClick={() => void them(tim)}>
              <span className="cdv__them-dau"><Plus size={15} aria-hidden="true" /></span>
              <span className="cdv__ten">Thêm <span className="cdv__them-ten">{tim.trim()}</span></span>
              <kbd>Enter</kbd>
            </button>
          )}
          {loi && <p className="cdv__trong is-loi">{loi}</p>}
        </div>
      )}
    </div>
  );
}
