// Bảng "Đơn vị bán và giá" của danh mục Hàng thương mại (chỉ In Hà Phương, 09/11/2026 — phương án A,
// docs/mockups/hang-thuong-mai-3-phuong-an.html). Gộp ba ô rời trước đây (ĐVT · Đơn vị thêm · Giá bán
// theo ĐVT) thành một bảng như khối đơn vị của Sapo: mỗi dòng một đơn vị kèm giá bán của nó.
//
// Dữ liệu KHÔNG đổi: dòng đầu ghi `don_vi_gia`, các dòng sau ghi `don_vi_them`, giá ghi
// `gia_ban_theo_dvt` theo mã đơn vị. Luật nhiều ĐVT giữ nguyên `ODonViNhieu`: mỗi đơn vị kéo cả nhóm
// quy đổi của nó nên nút thêm ẩn đơn vị đã nằm trong nhóm đã khai; máy chủ vẫn là cửa chặn thật (đơn vị
// cùng nhóm, bỏ đơn vị còn tồn hay còn chứng từ ⇒ 422 tiếng Việt). Giá không quy đổi giữa các đơn vị:
// ô để trống = chưa đặt giá, dòng đơn trống giá.
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { useAuth } from "../../auth/useAuth";
import { crud, type Row } from "../../api/rebuildCatalog";
import { OGoDinhDang } from "../../components/OGoDinhDang";
import { tenDonVi } from "../tenDonVi";
import { RefSearchField } from "./fields";
import { chuan, doThi, nhomCua } from "./ODonViNhieu";

const apiCap = crud("/api/don-vi/quy-doi");

type GiaTheoDvt = Record<string, number>;
export type DonViBanGia = { don_vi_gia: string; don_vi_them: string[]; gia_ban_theo_dvt: GiaTheoDvt };

const chuSo = (s: string) => s.replace(/\D/g, "");
const hien = (n: number | undefined) => (n == null ? "" : n.toLocaleString("vi-VN"));

export function ODonViBanGia({ chinh, them, gia, giaNhap, donVi, coGia, onChange }: {
  chinh: string;
  them: string[];
  gia: unknown;
  /** Danh mục Đơn vị (đã bỏ mục ngừng dùng, trừ mục đang chọn). */
  donVi: Row[];
  /** Người xem có ô Xem giá của màn: không có thì máy chủ không trả giá, cột giá ẩn hẳn. */
  coGia: boolean;
  /** Giá nhập gần nhất theo mã đơn vị (ngăn Hàng thương mại, chỉ khi sửa). Vắng = không có cột này;
   *  `null` = máy chủ che (thiếu ô Xem giá) ⇒ cũng không có cột. */
  giaNhap?: Record<string, number> | null;
  onChange: (v: DonViBanGia) => void;
}) {
  const { token } = useAuth();
  const [caps, setCaps] = useState<Row[] | null>(() => (token ? apiCap.daNho(token) ?? null : null));
  useEffect(() => {
    if (!token) return;
    let song = true;
    const { nho, moi } = apiCap.thamChieu(token);
    if (nho) setCaps(nho);
    moi.then((r) => { if (song) setCaps(r); }).catch(() => { if (song) setCaps((c) => c ?? []); });
    return () => { song = false; };
  }, [token]);
  const g = useMemo(() => doThi(caps ?? []), [caps]);

  const maChinh = chuan(chinh);
  const ds = useMemo(() => (Array.isArray(them) ? them.map(chuan).filter((m) => m && m !== maChinh) : []),
    [them, maChinh]);
  const bangGia: GiaTheoDvt = gia && typeof gia === "object" && !Array.isArray(gia) ? (gia as GiaTheoDvt) : {};
  const tenCua = useMemo(() => {
    const m = new Map(donVi.map((d) => [chuan(d.ma), String(d.ten || d.ma)]));
    return (ma: string) => m.get(chuan(ma)) ?? tenDonVi(ma) ?? ma;
  }, [donVi]);

  /** Ghi cả ba cột một lượt; giá của đơn vị đã bỏ rụng theo, khỏi treo khoá lạ trong JSON. */
  const ghi = (moiChinh: string, moiThem: string[], moiGia: GiaTheoDvt = bangGia) => {
    const giu = new Set([chuan(moiChinh), ...moiThem.map(chuan)].filter(Boolean));
    const locGia: GiaTheoDvt = {};
    for (const [ma, so] of Object.entries(moiGia)) if (giu.has(chuan(ma))) locGia[chuan(ma)] = so;
    onChange({ don_vi_gia: moiChinh, don_vi_them: moiThem, gia_ban_theo_dvt: locGia });
  };

  // Đơn vị khai thừa (đã nằm trong nhóm của đơn vị đứng trước) — máy chủ chặn lúc lưu, báo luôn ở đây.
  const trung = useMemo(() => {
    const truoc: string[] = maChinh ? [maChinh] : [];
    const ra = new Map<string, string>();
    for (const ma of ds) {
      const t = truoc.find((u) => u === ma || nhomCua(u, g).includes(ma));
      if (t) ra.set(ma, t);
      truoc.push(ma);
    }
    return ra;
  }, [ds, maChinh, g]);

  const conThem = useMemo(() => {
    const an = new Set<string>();
    for (const u of [maChinh, ...ds]) if (u) for (const x of nhomCua(u, g)) an.add(x);
    return donVi.filter((d) => !an.has(chuan(d.ma)));
  }, [donVi, maChinh, ds, g]);

  const [mo, setMo] = useState(false);
  const khungRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mo) return;
    const dong = (e: MouseEvent) => { if (!khungRef.current?.contains(e.target as Node)) setMo(false); };
    const phim = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setMo(false); }
    };
    document.addEventListener("mousedown", dong);
    document.addEventListener("keydown", phim, true);
    return () => {
      document.removeEventListener("mousedown", dong);
      document.removeEventListener("keydown", phim, true);
    };
  }, [mo]);

  const coCotNhap = coGia && giaNhap != null;
  const oNhap = (ma: string) => (
    <td className="rc-dvbg__so">
      {giaNhap?.[ma] != null ? hien(giaNhap[ma]) : <span className="rc-dvbg__mo">Chưa nhập</span>}
    </td>
  );

  const oGia = (ma: string) => (
    <OGoDinhDang
      className="rc-input rc-input--num"
      inputMode="numeric"
      aria-label={`Giá bán theo ${tenCua(ma)}`}
      placeholder="Chưa đặt giá"
      value={hien(bangGia[ma])}
      onChange={(e) => {
        const so = chuSo(e.target.value);
        const moi = { ...bangGia };
        if (so === "") delete moi[ma];
        else moi[ma] = Number(so);
        ghi(maChinh, ds, moi);
      }}
    />
  );

  return (
    <div className="rc-dvbg">
      {/* `data-khong-goi-y`: ô gợi ý của LuoiDs bắt mọi ô tràn chữ trong `<table>` và in cả danh sách đơn vị
          đang mở đè lên ô chọn. Bảng khai này không cần gợi ý. */}
      <table className="rc-dvbg__bang" data-khong-goi-y>
        <thead>
          <tr>
            <th className="rc-dvbg__c-dv">Đơn vị</th>
            {coGia && <th>Giá bán (chưa VAT)</th>}
            {coCotNhap && <th className="rc-dvbg__c-nhap">Giá nhập gần nhất</th>}
            <th className="rc-dvbg__c-bo" aria-label="Bỏ" />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <RefSearchField
                value={maChinh || null}
                options={donVi}
                byMa
                placeholder="Chọn đơn vị"
                onChange={(v) => ghi(String(v ?? ""), ds)}
              />
            </td>
            {coGia && <td>{maChinh ? oGia(maChinh) : null}</td>}
            {coCotNhap && (maChinh ? oNhap(maChinh) : <td />)}
            <td />
          </tr>
          {ds.map((ma) => (
            <tr key={ma}>
              <td>
                <span className={`rc-dvbg__ten${trung.has(ma) ? " rc-dvbg__ten--loi" : ""}`}>{tenCua(ma)}</span>
              </td>
              {coGia && <td>{oGia(ma)}</td>}
              {coCotNhap && oNhap(ma)}
              <td>
                <button type="button" className="rc-dvbg__bo"
                  title={`Bỏ đơn vị ${tenCua(ma)}`} aria-label={`Bỏ đơn vị ${tenCua(ma)}`}
                  onClick={() => ghi(maChinh, ds.filter((x) => x !== ma))}>
                  <X size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rc-dvn__khung" ref={khungRef}>
        <button type="button" className="rc-dvbg__them" disabled={!maChinh}
          aria-haspopup="listbox" aria-expanded={mo} onClick={() => setMo((v) => !v)}>
          <Plus size={14} strokeWidth={2} aria-hidden="true" />
          Thêm đơn vị
        </button>
        {mo && (
          <div className="rc-ref-search-panel rc-dvn__menu" role="listbox">
            {conThem.length === 0 ? (
              <div className="rc-dvn__trong">Không còn đơn vị nào ngoài các nhóm đã khai.</div>
            ) : conThem.map((d) => {
              const ma = chuan(d.ma);
              const ten = String(d.ten || d.ma);
              return (
                <button type="button" key={d.id} role="option" aria-selected={false}
                  className="rc-ref-search-item"
                  onClick={() => { ghi(maChinh, [...ds, ma]); setMo(false); }}>
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
        <span className="rc-field__hint">Chọn đơn vị chính trước rồi mới thêm đơn vị khác.</span>
      ) : [...trung].map(([ma, t]) => (
        <span key={ma} className="rc-field__hint rc-dvn__loi">
          {tenCua(ma)} đã nằm trong nhóm của {tenCua(t)}, bỏ dòng này đi.
        </span>
      ))}
    </div>
  );
}
