// Đơn thương mại — chỉ In Hà Phương (phân hệ `thuong_mai`, docs/design-hang-thuong-mai-ha-phuong.md §6).
// Hai mảnh gắn vào màn Đơn hàng bán: hộp Tạo / Sửa đơn thương mại, và thẻ Xuất hàng trong ngăn đơn.
// Đơn thương mại không báo giá, không PO, không ngày giao, không sản xuất.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError, type CustomerRow, type OrderDetail } from "../../api/client";
import {
  thuongMaiApi, type DongThuongMaiInput, type HangThuongMai, type XuatHangState,
} from "../../api/thuongMai";
import { useAuth } from "../../auth/useAuth";
import { useTat } from "../../auth/permissions";
import {
  boCachGiao, CACH_GIAO_TRONG, ChonCachGiao, loiCachGiao, type CachGiao,
} from "../giao-hang-hp/ChonCachGiao";
import { OGoDinhDang } from "../../components/OGoDinhDang";
import { ChipTT, soVN, type MauTT } from "../../components/LuoiDs";
import { ChanKhung, TomTat } from "../giao-hang/tien-do-don";
import { fmtDateTime } from "../../utils/format";
import "./don-thuong-mai.css";

export const loi = (e: unknown, macDinh: string) => (e instanceof ApiError ? e.message : macDinh);
export const chuSo = (s: string) => s.replace(/\D/g, "").replace(/^0+(?=\d)/, "");

export type Dong = {
  khoa: number;
  hang: HangThuongMai | null;
  dvt: string;
  qty: string;
  /** Chuỗi chữ số; "" = lấy giá bán khai ở danh mục. */
  gia: string;
  vat: string;
};

let dem = 0;
export const dongMoi = (): Dong => ({ khoa: ++dem, hang: null, dvt: "", qty: "1", gia: "", vat: "0" });
export const dvtCua = (h: HangThuongMai) =>
  [h.don_vi_gia, ...(h.don_vi_them ?? [])].map((m) => (m ?? "").trim().toLowerCase())
    .filter((m, i, a) => m && a.indexOf(m) === i);
export const giaKhai = (d: Dong) => (d.hang && d.dvt ? d.hang.gia_ban_theo_dvt?.[d.dvt] : undefined);

/** Mã ĐVT → tên ("cai" → "Cái"), theo danh mục Đơn vị & quy đổi. */
export function useTenDvt(): (ma: string) => string {
  const { token } = useAuth();
  const [bang, setBang] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!token) return;
    thuongMaiApi.donVi(token).then((r) => setBang(Object.fromEntries(r.items.map((d) => [String(d.ma).toLowerCase(), d.ten]))))
      .catch(() => undefined);
  }, [token]);
  return useCallback((ma: string) => bang[ma] ?? ma, [bang]);
}

/** Ô tìm chọn khách hàng (tên / mã / SĐT). Khách mua lẻ không lấy tên thì chọn khách "Khách lẻ" do
 *  cửa hàng tự khai — hệ không tự tạo khách. */
export type KhachChon = { id: number; name: string; code?: string | null; phone?: string | null };

export function ChonKhach({ value, onChange }: { value: KhachChon | null; onChange: (k: KhachChon | null) => void }) {
  const { token } = useAuth();
  const [q, setQ] = useState("");
  const [ds, setDs] = useState<CustomerRow[]>([]);
  const [mo, setMo] = useState(false);
  useEffect(() => {
    if (!token || !mo) return;
    const t = window.setTimeout(() => {
      api.customers.list(token, { q: q.trim() || undefined, size: 20 }).then((r) => setDs(r.items)).catch(() => setDs([]));
    }, 200);
    return () => window.clearTimeout(t);
  }, [token, q, mo]);
  if (value) {
    return (
      <div className="dtm__chon">
        <span>{value.name}</span>
        <button type="button" className="btn btn--ghost" onClick={() => onChange(null)}>Đổi khách</button>
      </div>
    );
  }
  return (
    <div className="dtm__tim">
      <input className="dhb__input" placeholder="Gõ tên, mã hoặc số điện thoại khách" value={q} aria-label="Tìm khách hàng"
        onFocus={() => setMo(true)} onChange={(e) => { setQ(e.target.value); setMo(true); }} />
      {mo && ds.length > 0 && (
        <ul className="dtm__goi-y" role="listbox">
          {ds.map((k) => (
            <li key={k.id}>
              <button type="button" onClick={() => { onChange({ id: k.id, name: k.name, code: k.code, phone: k.phone }); setMo(false); }}>
                <span title={k.name}>{k.name}</span>
                <small><span>{k.code}</span>{k.phone && <span>{k.phone}</span>}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Ô tìm chọn mặt hàng thương mại (mã / tên). Truyền `tonKho` thì danh sách gợi ý kèm tồn ở kho đó
 *  (`khoId` null = cộng mọi kho), tính theo ĐVT bán chính của mặt hàng. */
export function ChonHang({ value, onChange, tonKho, goiY = "Gõ mã hoặc tên hàng" }: {
  value: HangThuongMai | null;
  onChange: (h: HangThuongMai) => void;
  tonKho?: { khoId: number | null };
  goiY?: string;
}) {
  const { token } = useAuth();
  const tenDvt = useTenDvt();
  const [q, setQ] = useState("");
  const [ds, setDs] = useState<HangThuongMai[]>([]);
  const [ton, setTon] = useState<Record<number, number>>({});
  const [mo, setMo] = useState(false);
  const [chiSo, setChiSo] = useState(0);
  const coTon = tonKho !== undefined;
  const khoId = tonKho?.khoId ?? null;
  useEffect(() => {
    if (!token || !mo) return;
    let bo = false;
    const t = window.setTimeout(() => {
      thuongMaiApi.hang(token, q).then((r) => {
        if (bo) return;
        setDs(r.items);
        setChiSo(0);
        if (!coTon || r.items.length === 0) { setTon({}); return; }
        thuongMaiApi.ton(token, khoId, r.items.map((h) => ({ hang_id: h.id, dvt: h.don_vi_gia, qty: 1 })))
          .then((x) => { if (!bo) setTon(Object.fromEntries(x.map((y) => [y.hang_id, y.ton]))); })
          .catch(() => { if (!bo) setTon({}); });
      }).catch(() => { if (!bo) setDs([]); });
    }, 200);
    return () => { bo = true; window.clearTimeout(t); };
  }, [token, q, mo, coTon, khoId]);
  const chon = (h: HangThuongMai) => { onChange(h); setMo(false); };
  return (
    // `data-khong-goi-y`: ô bảng chứa danh sách nổi bị bong bóng chung của bảng coi là "cắt chữ" và
    // bung cả danh sách thành chữ; tên đã chọn bị cắt thì xem bằng `title` của ô gõ.
    <div className="dtm__tim" data-khong-goi-y="">
      <input className="dhb__input" aria-label="Mặt hàng" placeholder={goiY}
        value={mo ? q : value ? value.ten : q}
        title={value && !mo ? `${value.ten} (${value.ma})` : undefined}
        onFocus={() => { setMo(true); setQ(""); }}
        onBlur={() => window.setTimeout(() => setMo(false), 150)}
        onKeyDown={(e) => {
          if (!mo || ds.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setChiSo((i) => Math.min(ds.length - 1, i + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setChiSo((i) => Math.max(0, i - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); chon(ds[chiSo]); }
          else if (e.key === "Escape") setMo(false);
        }}
        onClick={() => setMo(true)}
        onChange={(e) => { setQ(e.target.value); setMo(true); }} />
      {mo && (
        <div className="dtm__goi-y" role="listbox" aria-label="Mặt hàng tìm được">
          {ds.length === 0 ? (
            <p className="dtm__goi-y-trong">{q.trim() ? "Không có mặt hàng khớp." : "Chưa có mặt hàng thương mại nào."}</p>
          ) : (
            <>
              <div className="dtm__goi-y-dau" aria-hidden="true">
                <span>Mặt hàng</span>
                {coTon && <span>Tồn</span>}
                <span>Giá bán</span>
              </div>
              {ds.map((h, i) => {
                const t = ton[h.id];
                const gia = h.gia_ban_theo_dvt?.[h.don_vi_gia];
                return (
                  <button key={h.id} type="button" role="option" aria-selected={i === chiSo}
                    className={`dtm__goi-y-dong${i === chiSo ? " is-chon" : ""}${coTon ? " co-ton" : ""}`}
                    onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setChiSo(i)} onClick={() => chon(h)}>
                    <span className="dtm__goi-y-ten">
                      <span>{h.ten}</span>
                      <small>{h.ma}</small>
                    </span>
                    {coTon && (
                      <span className={`dtm__goi-y-so${t != null && t <= 0 ? " is-het" : ""}`}>
                        {t == null ? "—" : t <= 0 ? "Hết" : `${Number(t.toFixed(3)).toLocaleString("vi-VN")} ${tenDvt(h.don_vi_gia)}`}
                      </span>
                    )}
                    <span className="dtm__goi-y-so">
                      {gia == null ? "—" : `${soVN(gia)}/${tenDvt(h.don_vi_gia)}`}
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Hộp Tạo đơn thương mại (không truyền `order`) hoặc Sửa hàng của đơn nháp (truyền `order`). */
export function FormDonThuongMai({ order, onClose, onSaved }: {
  order?: OrderDetail;
  onClose: () => void;
  onSaved: (d: OrderDetail) => void;
}) {
  const { token } = useAuth();
  const tenDvt = useTenDvt();
  const [khach, setKhach] = useState<{ id: number; name: string } | null>(
    order?.customer_id ? { id: order.customer_id, name: order.customer_name ?? "" } : null);
  const [dong, setDong] = useState<Dong[]>([dongMoi()]);
  const [coc, setCoc] = useState("");
  const [ghiChu, setGhiChu] = useState("");
  const [luu, setLuu] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Sửa đơn: nạp lại mặt hàng của từng dòng từ danh mục (cần ĐVT + giá khai).
  useEffect(() => {
    if (!token || !order) return;
    thuongMaiApi.hang(token, "").then((r) => {
      const theoId = new Map(r.items.map((h) => [h.id, h]));
      setDong(order.lines.map((l) => {
        const h = l.hang_thuong_mai_id != null ? theoId.get(l.hang_thuong_mai_id) ?? null : null;
        const ten = (l.don_vi_tinh ?? "").toLowerCase();
        const dvt = h ? (dvtCua(h).find((m) => m === ten || tenDvt(m).toLowerCase() === ten) ?? h.don_vi_gia) : "";
        return { khoa: ++dem, hang: h, dvt, qty: String(l.qty), gia: l.unit_price_snapshot != null ? String(l.unit_price_snapshot) : "",
          vat: String(l.vat_pct_estimate ?? 0) };
      }));
    }).catch(() => undefined);
  }, [token, order, tenDvt]);

  const sua = (k: number, p: Partial<Dong>) => setDong((ds) => ds.map((d) => (d.khoa === k ? { ...d, ...p } : d)));
  const giaDong = (d: Dong) => (d.gia !== "" ? Number(d.gia) : giaKhai(d));
  const tong = useMemo(() => dong.reduce((t, d) => {
    const g = giaDong(d);
    const sl = Number(d.qty) || 0;
    return g == null ? t : t + Math.floor((g * sl * (100 + (Number(d.vat) || 0))) / 100);
  }, 0), [dong]);

  async function luuDon() {
    if (!token || luu) return;
    if (!khach) { setErr("Chọn khách hàng cho đơn."); return; }
    const lines: DongThuongMaiInput[] = [];
    for (const d of dong) {
      if (!d.hang) { setErr("Còn dòng chưa chọn mặt hàng."); return; }
      const sl = Number(d.qty);
      if (!Number.isInteger(sl) || sl <= 0) { setErr(`Số lượng của «${d.hang.ten}» phải là số nguyên lớn hơn 0.`); return; }
      if (giaDong(d) == null) { setErr(`«${d.hang.ten}» chưa có giá bán theo đơn vị này, gõ đơn giá.`); return; }
      lines.push({ hang_id: d.hang.id, dvt: d.dvt, qty: sl, don_gia: d.gia !== "" ? Number(d.gia) : null, vat_pct: Number(d.vat) || 0 });
    }
    setLuu(true);
    setErr(null);
    try {
      onSaved(order
        ? await thuongMaiApi.suaDong(token, order.id, lines)
        : await thuongMaiApi.taoDon(token, { customer_id: khach.id, lines, deposit_amount: coc ? Number(coc) : null, ghi_chu: ghiChu.trim() || null }));
    } catch (e) {
      setErr(loi(e, "Không lưu được đơn."));
    } finally {
      setLuu(false);
    }
  }

  return createPortal(
    <div className="dhb__modal-overlay" style={{ zIndex: 80 }} onClick={() => { if (!luu) onClose(); }}>
      <div className="dhb__modal-content dtm__form" role="dialog" aria-label={order ? "Sửa hàng của đơn thương mại" : "Tạo đơn thương mại"}
        onClick={(e) => e.stopPropagation()}>
        <h3 className="dhb__modal-title">{order ? `Sửa hàng đơn ${order.order_no}` : "Tạo đơn thương mại"}</h3>
        <p className="dtm__lead">Bán hàng có sẵn, không qua sản xuất. Chốt đơn xong thì xuất hàng từ kho.</p>
        {!order && (
          <label className="dtm__o">
            <span>Khách hàng <b>*</b></span>
            <ChonKhach value={khach} onChange={setKhach} />
          </label>
        )}
        <table className="dhb__g dtm__bang">
          <thead>
            <tr>
              <th>Mặt hàng</th>
              <th>Đơn vị</th>
              <th className="dhb__text-right">Số lượng</th>
              <th className="dhb__text-right">Đơn giá</th>
              <th className="dhb__text-right">VAT %</th>
              <th className="dhb__text-right">Thành tiền</th>
              <th aria-label="Xoá dòng" />
            </tr>
          </thead>
          <tbody>
            {dong.map((d) => {
              const g = giaDong(d);
              const sl = Number(d.qty) || 0;
              return (
                <tr key={d.khoa}>
                  <td className="dtm__c-hang" data-khong-goi-y="">
                    <ChonHang value={d.hang} onChange={(h) => sua(d.khoa, { hang: h, dvt: h.don_vi_gia, gia: "" })} />
                  </td>
                  <td>
                    <select className="dhb__input" aria-label="Đơn vị" value={d.dvt} disabled={!d.hang}
                      onChange={(e) => sua(d.khoa, { dvt: e.target.value, gia: "" })}>
                      {(d.hang ? dvtCua(d.hang) : []).map((m) => <option key={m} value={m}>{tenDvt(m)}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className="dhb__input dhb__text-right" inputMode="numeric" aria-label="Số lượng" value={d.qty}
                      onChange={(e) => sua(d.khoa, { qty: chuSo(e.target.value) })} />
                  </td>
                  <td>
                    <OGoDinhDang className="dhb__input dhb__text-right" inputMode="numeric" aria-label="Đơn giá"
                      placeholder={giaKhai(d) != null ? soVN(giaKhai(d)!) : "Gõ giá"}
                      value={d.gia ? Number(d.gia).toLocaleString("vi-VN") : ""}
                      onChange={(e) => sua(d.khoa, { gia: chuSo(e.target.value) })} />
                  </td>
                  <td>
                    <input className="dhb__input dhb__text-right" inputMode="numeric" aria-label="VAT" value={d.vat}
                      onChange={(e) => sua(d.khoa, { vat: chuSo(e.target.value).slice(0, 3) })} />
                  </td>
                  <td className="dhb__mono dhb__text-right">{g == null ? "—" : soVN(g * sl)}</td>
                  <td>
                    {dong.length > 1 && (
                      <button type="button" className="btn btn--ghost" aria-label="Xoá dòng"
                        onClick={() => setDong((ds) => ds.filter((x) => x.khoa !== d.khoa))}>×</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button type="button" className="btn btn--secondary dtm__them" onClick={() => setDong((ds) => [...ds, dongMoi()])}>Thêm mặt hàng</button>
        {!order && (
          <div className="dtm__hai">
            <label className="dtm__o">
              <span>Tiền cọc</span>
              <OGoDinhDang className="dhb__input" inputMode="numeric" aria-label="Tiền cọc" placeholder="Không cọc"
                value={coc ? Number(coc).toLocaleString("vi-VN") : ""} onChange={(e) => setCoc(chuSo(e.target.value))} />
            </label>
            <label className="dtm__o">
              <span>Ghi chú</span>
              <input className="dhb__input" maxLength={1000} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} />
            </label>
          </div>
        )}
        <TomTat d={[{ nhan: "Tổng gồm VAT", so: soVN(tong), tong: true }]} />
        {err && <div className="banner banner--error" role="alert">{err}</div>}
        <div className="dhb__invoice-form-actions">
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={luu}>Hủy</button>
          <button type="button" className="btn btn--primary" onClick={luuDon} disabled={luu}>{luu ? "Đang lưu…" : order ? "Lưu" : "Tạo đơn"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const NHAN_LUOT: Record<string, [string, MauTT]> = {
  cho_xuat: ["Chờ kho xuất", "cam"], da_xuat: ["Đã xuất", "la"], huy: ["Đã huỷ", "slate"],
};

/** Lượt xuất + phần còn xuất được của đơn thương mại; nạp lại khi `tick` đổi (SSE đơn bán / kho). */
export function useXuatHangTM(order: OrderDetail, tick?: number) {
  const { token } = useAuth();
  const [st, setSt] = useState<XuatHangState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const bat = order.source_type === "thuong_mai" && order.status !== "draft";
  const taiLai = useCallback(() => {
    if (!token || !bat) { setSt(null); return; }
    thuongMaiApi.xemXuat(token, order.id).then((s) => { setSt(s); setErr(null); })
      .catch((e) => setErr(loi(e, "Không tải được lượt xuất.")));
  }, [token, order.id, bat]);
  useEffect(() => { taiLai(); }, [taiLai, tick]);
  const conTong = st ? Object.values(st.con_lai).reduce((a, b) => a + b, 0) : null;
  // Xuất xong = không còn gì chưa xuất VÀ không còn lượt nào chờ kho.
  const xong = st != null && conTong === 0 && st.luot.every((l) => l.trang_thai !== "cho_xuat");
  return { st, err, taiLai, setSt, conTong, xong };
}

/** Thẻ Xuất hàng của đơn thương mại: các lượt đã gửi kho + nút Xuất hàng. */
export function TheXuatHang({ order, canUpdate, xh }: {
  order: OrderDetail;
  canUpdate: boolean;
  xh: ReturnType<typeof useXuatHangTM>;
}) {
  const [mo, setMo] = useState(false);
  const daChot = order.status === "ordered";
  const { st, err } = xh;

  if (order.status === "draft") return <ChanKhung chu="Chốt đơn xong mới xuất hàng được." />;
  if (err) return <div className="banner banner--error" role="alert">{err}</div>;
  if (!st) return <p className="dhb__td-note">Đang tải…</p>;
  const conTong = xh.conTong ?? 0;
  return (
    <>
      {st.luot.length === 0 ? (
        <p className="dhb__td-note">Chưa xuất lần nào.</p>
      ) : (
        <div className="dhb__the-bang">
          <table className="dhb__g">
            <thead>
              <tr>
                <th>Lần xuất</th>
                <th>Kho</th>
                <th>Mặt hàng</th>
                <th className="dhb__text-right">Số lượng</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {st.luot.flatMap((l) => l.dong.map((d, i) => (
                <tr key={`${l.id}-${d.order_line_id}`}>
                  {i === 0 && (
                    <td rowSpan={l.dong.length}>
                      {l.ma}
                      <small className="dtm__phu">{fmtDateTime(l.xuat_luc ?? l.created_at)}</small>
                    </td>
                  )}
                  {i === 0 && <td rowSpan={l.dong.length}>{l.kho_ten ?? "—"}</td>}
                  <td>{d.ten}</td>
                  <td className="dhb__mono dhb__text-right">
                    {soVN(l.trang_thai === "da_xuat" ? d.qty_thuc ?? 0 : d.qty)} {d.don_vi_tinh ?? ""}
                  </td>
                  {i === 0 && (
                    <td rowSpan={l.dong.length}>
                      <ChipTT mau={NHAN_LUOT[l.trang_thai][1]}>{NHAN_LUOT[l.trang_thai][0]}</ChipTT>
                      {l.stock_request_ma && <small className="dtm__phu">{l.stock_request_ma}</small>}
                    </td>
                  )}
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
      <ChanKhung chu={!daChot ? "Đơn đã huỷ." : conTong > 0 ? `Còn ${soVN(conTong)} chưa xuất.` : "Đã xuất hết hàng của đơn."}>
        {daChot && canUpdate && conTong > 0 && (
          <button type="button" className="btn btn--primary" onClick={() => setMo(true)}>Xuất hàng</button>
        )}
      </ChanKhung>
      {mo && (
        <FormXuatHang order={order} st={st} onClose={() => setMo(false)}
          onDone={(moi) => { xh.setSt(moi); setMo(false); }} />
      )}
    </>
  );
}

function FormXuatHang({ order, st, onClose, onDone }: {
  order: OrderDetail;
  st: XuatHangState;
  onClose: () => void;
  onDone: (s: XuatHangState) => void;
}) {
  const { token } = useAuth();
  const [khoId, setKhoId] = useState<number | null>(st.kho[0]?.id ?? null);
  const kho = st.kho.find((k) => k.id === khoId) ?? null;
  const [ghiSo, setGhiSo] = useState(true);
  const [sl, setSl] = useState<Record<number, string>>(() =>
    Object.fromEntries(order.lines.map((l) => [l.id, String(st.con_lai[String(l.id)] ?? 0)])));
  const [luu, setLuu] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Giao hàng kiểu Hà Phương: mỗi lần xuất chọn một cách giao.
  const coCachGiao = !useTat()("giao_hang_hp");
  const [cach, setCach] = useState<CachGiao>(CACH_GIAO_TRONG);
  const thieuCach = coCachGiao ? loiCachGiao(cach) : null;

  async function xuat() {
    if (!token || !khoId || luu || thieuCach) return;
    const lines = order.lines.map((l) => ({ order_line_id: l.id, qty: Number(sl[l.id] || 0) })).filter((x) => x.qty > 0);
    if (lines.length === 0) { setErr("Nhập số lượng xuất cho ít nhất một mặt hàng."); return; }
    setLuu(true);
    setErr(null);
    try {
      onDone(await thuongMaiApi.xuatHang(token, order.id, { kho_id: khoId, ghi_so: !!kho?.ghi_so_duoc && ghiSo, lines,
        ...(coCachGiao ? { phuong_thuc: boCachGiao(cach) } : {}) }));
    } catch (e) {
      setErr(loi(e, "Không xuất được hàng."));
      // Yêu cầu có thể đã gửi kho dù chưa ghi sổ được — nạp lại để thấy lượt mới.
      if (token) thuongMaiApi.xemXuat(token, order.id).then((s) => { if (s.luot.length > st.luot.length) onDone(s); }).catch(() => undefined);
    } finally {
      setLuu(false);
    }
  }

  return createPortal(
    <div className="dhb__modal-overlay" style={{ zIndex: 80 }} onClick={() => { if (!luu) onClose(); }}>
      <div className="dhb__modal-content dtm__form" role="dialog" aria-label="Xuất hàng" onClick={(e) => e.stopPropagation()}>
        <h3 className="dhb__modal-title">Xuất hàng đơn {order.order_no}</h3>
        <label className="dtm__o">
          <span>Kho xuất <b>*</b></span>
          <select className="dhb__input" value={khoId ?? ""} onChange={(e) => setKhoId(Number(e.target.value) || null)}>
            {st.kho.map((k) => <option key={k.id} value={k.id}>{k.ten}</option>)}
          </select>
        </label>
        <table className="dhb__g dtm__bang">
          <thead>
            <tr>
              <th>Mặt hàng</th>
              <th className="dhb__text-right">Còn chưa xuất</th>
              <th className="dhb__text-right">Xuất lần này</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => {
              const con = st.con_lai[String(l.id)] ?? 0;
              return (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="dhb__mono dhb__text-right">{soVN(con)} {l.don_vi_tinh ?? ""}</td>
                  <td>
                    <input className="dhb__input dhb__text-right" inputMode="numeric" aria-label={`Số xuất ${l.description}`}
                      disabled={con <= 0} value={sl[l.id] ?? ""} onChange={(e) => setSl({ ...sl, [l.id]: chuSo(e.target.value) })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {kho?.ghi_so_duoc ? (
          <label className="dtm__check">
            <input type="checkbox" checked={ghiSo} onChange={(e) => setGhiSo(e.target.checked)} />
            <span>Ghi sổ kho luôn (hàng trừ tồn ngay, khỏi qua màn Kho)</span>
          </label>
        ) : (
          <p className="dtm__lead">Yêu cầu xuất sẽ gửi tới người giữ kho {kho?.ten ?? ""}. Kho ghi sổ xong thì lần xuất tự chuyển Đã xuất.</p>
        )}
        {coCachGiao && <ChonCachGiao value={cach} onChange={setCach} oInput="dhb__input" />}
        {err && <div className="banner banner--error" role="alert">{err}</div>}
        <div className="dhb__invoice-form-actions">
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={luu}>Hủy</button>
          {thieuCach && <span className="dtm__lead" style={{ marginRight: "auto" }}>{thieuCach}</span>}
          <button type="button" className="btn btn--primary" onClick={xuat} disabled={luu || !khoId || !!thieuCach}>{luu ? "Đang xuất…" : "Xuất hàng"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
