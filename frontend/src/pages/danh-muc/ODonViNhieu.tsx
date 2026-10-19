// Ô "ĐƠN VỊ THÊM" của danh mục Giấy / Vật tư khác (spec 2026-10-10-mat-hang-nhieu-don-vi-tinh §2, §6).
//
// Một mã khai một DANH SÁCH đơn vị: ĐVT chính (ô "ĐVT" ngay trên, giữ nguyên như cũ — đơn giá danh
// mục thuộc nó) + các đơn vị thêm ở đây. Mỗi đơn vị kéo theo cả NHÓM quy đổi của nó (khai kg là có
// g, tấn), nên nút "Thêm đơn vị" ẩn mọi đơn vị đã nằm trong nhóm của ĐVT chính hoặc của đơn vị đã
// thêm. Hai đơn vị khai riêng là hai nhóm không quy đổi lẫn nhau (tờ và kg).
//
// Nhóm dựng ở máy khách từ bảng CẶP quy đổi (`/api/don-vi/quy-doi`) — loang hai chiều, đúng lối
// `quy_doi_service.don_vi_dung_duoc` bên máy chủ (`cap_map` cũng hai chiều). Máy chủ vẫn là cửa chặn
// thật: đơn vị thêm cùng nhóm, hay bỏ đơn vị còn tồn/còn đơn dùng ⇒ 422 với câu tiếng Việt, drawer
// hiện nguyên câu đó.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { useAuth } from "../../auth/useAuth";
import { crud, type Row } from "../../api/rebuildCatalog";
import { tenDonVi } from "../tenDonVi";

const apiCap = crud("/api/don-vi/quy-doi");

/** Tờ + kg: đơn vị BẮT BUỘC của mọi mã giấy (18/10/2026) — chip không có nút bỏ, máy chủ tự thêm
 *  nhóm còn thiếu lúc lưu; ở màn Đơn vị & quy đổi hai dòng này bị khoá. Cùng hằng số máy chủ
 *  `kho_giay.GIAY_DON_VI_BAT_BUOC`. */
export const DON_VI_KHOA = ["to", "kg"];

const chuan = (ma: unknown) => String(ma ?? "").trim().toLowerCase();

/** Đồ thị cặp quy đổi `{mã: tập mã kề}`, cả hai chiều — khai "1 tấn = 1.000 kg" là đủ đi ngược. */
function doThi(caps: Row[]): Map<string, Set<string>> {
  const g = new Map<string, Set<string>>();
  for (const c of caps) {
    const tu = chuan(c.tu_ma);
    const den = chuan(c.den_ma);
    if (!tu || !den || tu === den) continue;
    if (!g.has(tu)) g.set(tu, new Set());
    if (!g.has(den)) g.set(den, new Set());
    g.get(tu)!.add(den);
    g.get(den)!.add(tu);
  }
  return g;
}

/** Mọi mã đổi được từ `ma` (gồm cả chính nó), theo thứ tự gần trước xa sau. */
function nhomCua(ma: string, g: Map<string, Set<string>>): string[] {
  const goc = chuan(ma);
  if (!goc) return [];
  const da = new Set([goc]);
  const hang = [goc];
  for (let i = 0; i < hang.length; i++) {
    for (const ke of g.get(hang[i]) ?? []) {
      if (da.has(ke)) continue;
      da.add(ke);
      hang.push(ke);
    }
  }
  return hang;
}

export function ODonViNhieu({ value, chinh, donVi, batBuoc, onChange }: {
  /** Mã các đơn vị thêm, theo thứ tự khai. */
  value: string[];
  /** Mã ĐVT chính (ô "ĐVT" của form) — nhóm của nó cũng bị ẩn khỏi danh sách thêm. */
  chinh: string;
  /** Danh mục Đơn vị (đã bỏ mục ngừng dùng, trừ mục đang chọn) — cùng nguồn ô ĐVT chính. */
  donVi: Row[];
  /** Mã đơn vị không bỏ được (Giấy: tờ, kg) — chip mất nút ×; nhóm nào còn thiếu thì nhắc máy tự thêm. */
  batBuoc?: string[];
  onChange: (v: string[]) => void;
}) {
  const { token } = useAuth();
  const [caps, setCaps] = useState<Row[] | null>(() => (token ? apiCap.daNho(token) ?? null : null));
  useEffect(() => {
    if (!token) return;
    let song = true;
    const { nho, moi } = apiCap.thamChieu(token);
    if (nho) setCaps(nho);
    // Không nạp được bảng cặp: vẫn thêm được (mỗi đơn vị coi như một nhóm riêng), máy chủ chặn
    // đơn vị cùng nhóm lúc lưu.
    moi.then((r) => { if (song) setCaps(r); }).catch(() => { if (song) setCaps((c) => c ?? []); });
    return () => { song = false; };
  }, [token]);

  const g = useMemo(() => doThi(caps ?? []), [caps]);
  const tenCua = useMemo(() => {
    const m = new Map(donVi.map((d) => [chuan(d.ma), String(d.ten || d.ma)]));
    return (ma: string) => m.get(chuan(ma)) ?? tenDonVi(ma) ?? ma;
  }, [donVi]);

  const ds = useMemo(() => (Array.isArray(value) ? value.map(chuan).filter(Boolean) : []), [value]);
  const maChinh = chuan(chinh);

  /** Từng đơn vị thêm + đơn vị khai TRƯỚC nó mà nhóm đã chứa nó (khai thừa — máy chủ sẽ chặn lúc
   *  lưu, báo luôn ở đây cho khỏi bấm Lưu mới biết). */
  const the = useMemo(() => {
    const truoc: string[] = maChinh ? [maChinh] : [];
    return ds.map((ma) => {
      const trung = truoc.find((u) => u === ma || nhomCua(u, g).includes(ma)) ?? null;
      truoc.push(ma);
      return { ma, trung };
    });
  }, [ds, maChinh, g]);

  // Danh sách thêm: bỏ mọi đơn vị đã nằm trong nhóm của ĐVT chính hoặc của đơn vị đã thêm.
  const conThem = useMemo(() => {
    const an = new Set<string>();
    for (const u of [maChinh, ...ds]) if (u) for (const x of nhomCua(u, g)) an.add(x);
    return donVi.filter((d) => !an.has(chuan(d.ma)));
  }, [donVi, maChinh, ds, g]);

  const [mo, setMo] = useState(false);
  const [lenTren, setLenTren] = useState(false);
  const khungRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mo) return;
    const dong = (e: MouseEvent) => {
      if (!khungRef.current?.contains(e.target as Node)) setMo(false);
    };
    const phim = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Esc chỉ đóng danh sách, không đóng cả drawer — drawer nhường phím đã `preventDefault`.
        e.preventDefault();
        setMo(false);
      }
    };
    document.addEventListener("mousedown", dong);
    document.addEventListener("keydown", phim, true);
    return () => {
      document.removeEventListener("mousedown", dong);
      document.removeEventListener("keydown", phim, true);
    };
  }, [mo]);
  // Lật danh sách lên khi dưới ô không đủ chỗ trong khung cuộn của drawer — cùng lối `RefSearchField`.
  useLayoutEffect(() => {
    const khung = khungRef.current;
    const menu = khung?.querySelector<HTMLElement>(".rc-dvn__menu");
    if (!mo || !khung || !menu) {
      setLenTren(false);
      return;
    }
    let cuon = khung.parentElement;
    while (cuon && !/(auto|scroll)/.test(getComputedStyle(cuon).overflowY)) cuon = cuon.parentElement;
    const o = khung.getBoundingClientRect();
    const mep = cuon ? cuon.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const duoi = mep.bottom - o.bottom;
    setLenTren(menu.offsetHeight + 4 > duoi && o.top - mep.top > duoi);
  }, [mo, conThem.length]);

  const loi = the.filter((t) => t.trung);
  const khoa = useMemo(() => new Set((batBuoc ?? []).map(chuan)), [batBuoc]);
  // Nhóm bắt buộc chưa có ở ĐVT chính lẫn đơn vị thêm ⇒ máy chủ thêm lúc lưu, nói trước ở đây.
  const thieu = useMemo(() => [...khoa].filter(
    (b) => ![maChinh, ...ds].some((u) => u && (u === b || nhomCua(u, g).includes(b)))), [khoa, maChinh, ds, g]);

  // MỘT ô như các ô nhập khác (nằm ngay dưới ô ĐVT): mỗi đơn vị thêm một thẻ CHỈ có tên, nút thêm
  // ở cuối ô. Nhóm quy đổi KHÔNG bày ra ô (13/10/2026: "gồm ram" trong thẻ + "kg đã gồm g tấn" dưới
  // ô đọc như chữ vỡ) — chỉ một câu ở chân danh sách thả nói vì sao đơn vị cùng nhóm không có mặt.
  return (
    <div className="rc-dvn">
      <div className="rc-dvn__khung" ref={khungRef}>
        <div className={`rc-input rc-dvn__o${maChinh ? "" : " rc-dvn__o--khoa"}${mo ? " rc-dvn__o--mo" : ""}`}
          onClick={(e) => { if (maChinh && e.target === e.currentTarget) setMo((v) => !v); }}>
          {the.map((t) => (
            <span key={t.ma} className={`rc-dvn__the${t.trung ? " rc-dvn__the--loi" : ""}`}>
              <span className="rc-dvn__ten">{tenCua(t.ma)}</span>
              {!khoa.has(t.ma) && (
                <button type="button" className="rc-dvn__bo"
                  title={`Bỏ đơn vị ${tenCua(t.ma)}`} aria-label={`Bỏ đơn vị ${tenCua(t.ma)}`}
                  onClick={() => onChange(ds.filter((x) => x !== t.ma))}>
                  <X size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
          <button type="button" className="rc-dvn__nut" disabled={!maChinh}
            aria-haspopup="listbox" aria-expanded={mo}
            onClick={() => setMo((v) => !v)}>
            <Plus size={13} strokeWidth={2} aria-hidden="true" />
            {the.length > 0 ? "Thêm" : "Thêm đơn vị"}
          </button>
        </div>
        {mo && (
          <div className={`rc-ref-search-panel rc-dvn__menu${lenTren ? " rc-ref-search-panel--len" : ""}`} role="listbox">
            {conThem.length === 0 ? (
              <div className="rc-dvn__trong">Không còn đơn vị nào ngoài các nhóm đã khai.</div>
            ) : conThem.map((d) => {
              const ma = chuan(d.ma);
              const ten = String(d.ten || d.ma);
              return (
                <button type="button" key={d.id} role="option" aria-selected={false}
                  className="rc-ref-search-item"
                  onClick={() => { onChange([...ds, ma]); setMo(false); }}>
                  <span className="rc-ref-search-item__name">{ten}</span>
                  {ma !== ten.toLowerCase() && <span className="rc-ref-search-item__code">{d.ma}</span>}
                </button>
              );
            })}
            {conThem.length > 0 && (
              <div className="rc-dvn__chu-thich">Đơn vị quy đổi được với đơn vị đã khai thì không hiện ở đây.</div>
            )}
          </div>
        )}
      </div>
      {!maChinh ? (
        <span className="rc-field__hint">Chọn ĐVT trước.</span>
      ) : loi.length > 0 ? (
        loi.map((t) => (
          <span key={t.ma} className="rc-field__hint rc-dvn__loi">
            {tenCua(t.ma)} đã nằm trong nhóm của {tenCua(t.trung!)}, bỏ thẻ này đi.
          </span>
        ))
      ) : thieu.length > 0 ? (
        <span className="rc-field__hint">
          Giấy luôn có {thieu.map(tenCua).join(" và ")}, máy tự thêm khi lưu.
        </span>
      ) : null}
    </div>
  );
}
