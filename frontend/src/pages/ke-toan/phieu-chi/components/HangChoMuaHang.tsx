/** Hàng "Mua hàng chờ chi" (chủ 17/10/2026): bấm mục lọc nhanh "Mua hàng chờ chi" thì bảng phiếu đổi sang
 *  hàng này — các KHOẢN còn phải chi của đơn mua đã duyệt: cọc chưa chi và từng đợt giao còn nợ.
 *  Cùng khuôn "Đơn hàng chờ thu" bên Phiếu thu (chủ chốt thống nhất 17/10): MỖI KHOẢN MỘT DÒNG, nút lập
 *  phiếu ngay trên dòng. Chi đủ thì khoản rời hàng. Bấm vào dòng (ngoài nút) mở popup chi tiết đúng
 *  khoản đó: vật tư của đợt (hoặc hàng đã đặt với cọc).
 *
 *  Tick nhiều khoản của CÙNG một nhà cung cấp (17/10/2026: "một phiếu cho cả lượt") ⇒ dải chân "Đã chọn
 *  n khoản của …" + "Lập một phiếu chi": một phiếu, bảng phân bổ từng khoản. Tick khoản đầu thì khoản
 *  của nhà cung cấp khác khoá ô tick. */
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";

import type { MuaHangChoChi, PurchaseDeliveryRow } from "../../../../api/client";
import type { KhoanGop } from "./LapPhieuChiGop";
import { CuonLuoi, rongLuoi, type CauHinhLuoi, type CotLuoi } from "../../../../components/LuoiDs";
import { ChiTietKhoan } from "../../shared/ChiTietKhoan";
import { ngay, tien, vietSo } from "../../shared/dinhDang";
import { tenDonVi, useNapTenDonVi } from "../../../tenDonVi";
import { isoToday } from "../shared/helpers";

// Bề rộng chung với "Đơn hàng chờ thu": 8 cột vừa khung 1146px của màn 1440 (tiền 124 đủ "999.999.999 đ").
export const COT_MUA_HANG: (CotLuoi & { w?: number; n?: boolean })[] = [
  { key: "chon", label: "Chọn", coDinh: true, w: 40 },
  { key: "ncc", label: "Nhà cung cấp", coDinh: true, w: 220 },
  { key: "khoan", label: "Khoản chi", w: 96 },
  { key: "nguon", label: "Nguồn", w: 220 },
  { key: "han", label: "Hạn chi", w: 104 },
  { key: "phai_chi", label: "Phải chi", n: true, w: 124 },
  { key: "coc_tru", label: "Cọc trừ", n: true, w: 124 },
  { key: "da_chi", label: "Đã chi", n: true, w: 124 },
  { key: "con", label: "Còn phải chi", n: true, w: 124 },
  { key: "nut", label: "Thao tác", coDinh: true, w: 130 },
];

/** Khoản được bấm lập phiếu: CỌC của đơn, hoặc ĐÚNG một đợt giao. */
export type KhoanChi = { coc: true } | { coc: false; dotId: number };

export type DongMuaHang =
  | { loai: "coc"; r: MuaHangChoChi }
  | { loai: "dot"; r: MuaHangChoChi; d: PurchaseDeliveryRow };

const khoaDong = (x: DongMuaHang) => (x.loai === "coc" ? `coc-${x.r.don.id}` : `dot-${x.d.id}`);
const khoanCua = (x: DongMuaHang): KhoanChi => (x.loai === "coc" ? { coc: true } : { coc: false, dotId: x.d.id });
const nhanKhoan = (x: DongMuaHang) => (x.loai === "coc" ? "Cọc" : `Đợt ${x.d.seq_no}`);
const khoaNcc = (x: DongMuaHang) => String(x.r.don.supplier_id ?? x.r.don.supplier_name ?? "");
const conCua = (x: DongMuaHang) => (x.loai === "coc" ? x.r.coc_can_chi : x.d.con_no);

/** Ảnh chụp một khoản cho form phiếu chi gộp. */
export function khoanGop(x: DongMuaHang): KhoanGop {
  return {
    purchase_request_id: x.r.don.id,
    ma_don: x.r.don.code,
    delivery_id: x.loai === "coc" ? null : x.d.id,
    nhan: nhanKhoan(x),
    han: x.loai === "coc" ? null : x.d.due_date,
    con: conCua(x),
  };
}

/** Trải đơn ra từng khoản: cọc trước (giữ thứ tự máy chủ — đơn quá hạn lên đầu), rồi các đợt còn nợ theo
 *  hạn chi tăng dần, đợt chưa có hạn ở cuối. Cũng là số đếm của mục lọc. */
export function dongMuaHang(rows: MuaHangChoChi[]): DongMuaHang[] {
  const coc = rows.filter((r) => r.coc_can_chi > 0).map((r) => ({ loai: "coc" as const, r }));
  const dot = rows
    .flatMap((r) => r.don.deliveries.filter((d) => d.con_no > 0).map((d) => ({ loai: "dot" as const, r, d })))
    .sort((a, b) =>
      a.d.due_date === b.d.due_date
        ? a.d.delivery_date.localeCompare(b.d.delivery_date) || a.d.seq_no - b.d.seq_no
        : a.d.due_date == null ? 1 : b.d.due_date == null ? -1 : a.d.due_date.localeCompare(b.d.due_date));
  return [...coc, ...dot];
}

export function HangChoMuaHang({
  rows,
  loi,
  tim = "",
  onLap,
  onLapGop,
  onMoDon,
  luoi,
}: {
  rows: MuaHangChoChi[] | null;
  loi: string | null;
  /** Ô tìm của trang — lọc ngay trên máy theo mã đơn / tên NCC (cả hàng đã nạp hết, không phân trang).
   *  Link "Phiếu chi → Mua hàng chờ chi" từ ngăn Đơn mua hàng điền sẵn mã đơn vào đây. */
  tim?: string;
  /** Không có = không có quyền lập phiếu chi ⇒ không hiện nút. */
  onLap?: (row: MuaHangChoChi, khoan: KhoanChi) => void;
  /** Lập MỘT phiếu chi cho các khoản đã tick (cùng NCC). Không có = không có ô tick. */
  onLapGop?: (ncc: { id: number | null; ten: string }, khoan: KhoanGop[]) => void;
  /** Không có = không có quyền xem màn Đơn mua hàng ⇒ mã đơn là chữ thường. */
  onMoDon?: (code: string) => void;
  luoi?: CauHinhLuoi;
}) {
  const homNay = isoToday();
  const dong = useMemo(() => {
    if (!rows) return null;
    const t = tim.trim().toLowerCase();
    const ds = t ? rows.filter((r) => `${r.don.code} ${r.don.supplier_name ?? ""}`.toLowerCase().includes(t)) : rows;
    return dongMuaHang(ds);
  }, [rows, tim]);
  // Cột Cọc trừ chỉ mọc khi có đợt được cọc bù vào.
  const coCocTru = dong?.some((x) => x.loai === "dot" && x.d.coc_bu > 0) ?? false;
  const goc = COT_MUA_HANG.filter((c) => (c.key !== "coc_tru" || coCocTru) && (c.key !== "chon" || !!onLapGop));
  const cot = luoi ? luoi.rongHien(luoi.xep(goc).filter((c) => !luoi.an.has(c.key))) : goc;

  const [xem, setXem] = useState<string | null>(null);
  // Chi đủ ⇒ khoản rời hàng ⇒ popup (nếu còn mở) tự đóng theo.
  const dangXem = xem == null ? null : (dong ?? []).find((x) => khoaDong(x) === xem) ?? null;
  const lap = onLap ? (x: DongMuaHang) => { setXem(null); onLap(x.r, khoanCua(x)); } : undefined;

  // Khoản đã tick — chỉ giữ khoản còn trong hàng (chi đủ / nạp lại thì tự rơi khỏi lựa chọn).
  const [chon, setChon] = useState<Set<string>>(new Set());
  const daChon = (dong ?? []).filter((x) => chon.has(khoaDong(x)));
  const nccChon = daChon.length ? khoaNcc(daChon[0]) : null;
  const tongChon = daChon.reduce((s, x) => s + conCua(x), 0);
  const tick = (x: DongMuaHang) =>
    setChon((cu) => {
      const moi = new Set(cu);
      if (moi.has(khoaDong(x))) moi.delete(khoaDong(x));
      else moi.add(khoaDong(x));
      return moi;
    });
  const oChon = onLapGop
    ? (x: DongMuaHang) => {
        const khac = nccChon != null && khoaNcc(x) !== nccChon;
        return (
          <td key="chon" className="kt-gop-tick" onClick={(e) => e.stopPropagation()}>
            <label title={khac ? "Khác nhà cung cấp" : undefined}>
              <input type="checkbox" aria-label={`Chọn ${nhanKhoan(x)} của ${x.r.don.code}`}
                checked={chon.has(khoaDong(x))} disabled={khac} onChange={() => tick(x)} />
            </label>
          </td>
        );
      }
    : undefined;

  // Dải chân + popup nằm NGOÀI `lds-sheet`: khung đó `overflow:hidden` làm `position:sticky` mất tác dụng.
  return (
    <>
    <div className="lds-sheet">
      <p className="kt-gc-ghi">
        Cọc của đơn mua đã duyệt chưa chi và đợt giao chưa trả hết. Chi đủ thì khoản đó rời khỏi danh sách này.
      </p>
      <CuonLuoi ghim={luoi?.soGhim(cot)}>
        <table className="lds-g" style={{ minWidth: rongLuoi(cot) }}>
          <colgroup>
            {cot.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
          </colgroup>
          <thead>
            <tr>
              {cot.map((c) => (
                <th key={c.key} className={c.n ? "n" : undefined}
                  aria-label={c.key === "nut" ? "Thao tác" : c.key === "chon" ? "Chọn" : undefined}>
                  {c.key === "nut" || c.key === "chon" ? null : c.label}
                  {luoi?.keo(c.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loi ? (
              <tr>
                <td colSpan={cot.length} className="lds-trong">
                  <span className="lds-do" role="alert">{`Không tải được hàng mua hàng chờ chi. ${loi}`}</span>
                </td>
              </tr>
            ) : dong == null ? (
              <tr><td colSpan={cot.length} className="lds-trong">Đang tải…</td></tr>
            ) : dong.length === 0 ? (
              <tr>
                <td colSpan={cot.length} className="lds-trong">
                  {tim.trim() ? "Không có khoản nào khớp ô tìm." : "Không còn khoản mua hàng nào chờ chi."}
                </td>
              </tr>
            ) : (
              dong.map((x) => (
                <tr
                  key={khoaDong(x)}
                  className={`lds-dong${xem === khoaDong(x) ? " is-chon" : ""}`}
                  tabIndex={0}
                  aria-haspopup="dialog"
                  onClick={() => setXem(khoaDong(x))}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      setXem(khoaDong(x));
                    }
                  }}
                >
                  {cot.map((c) => (c.key === "chon" && oChon ? oChon(x) : oKhoan(c.key, x, homNay, lap, onMoDon)))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CuonLuoi>
    </div>
      {onLapGop && daChon.length > 0 && (
        <div className="kt-gop-chan" role="region" aria-label="Khoản đã chọn">
          <span>{`Đã chọn ${vietSo(daChon.length)} khoản của ${daChon[0].r.don.supplier_name ?? "nhà cung cấp"}`}</span>
          <span className="kt-gop-chan__tong">{tien(tongChon)}</span>
          <button type="button" className="kt-btn kt-btn--tron" onClick={() => setChon(new Set())}>Bỏ chọn</button>
          <button type="button" className="kt-btn kt-btn--chinh"
            onClick={() => onLapGop(
              { id: daChon[0].r.don.supplier_id ?? null, ten: daChon[0].r.don.supplier_name ?? "" },
              daChon.map(khoanGop),
            )}>
            Lập một phiếu chi
          </button>
        </div>
      )}
      {dangXem && (
        <PopupKhoanMua x={dangXem} homNay={homNay} onClose={() => setXem(null)}
          onMoDon={onMoDon ? (code) => { setXem(null); onMoDon(code); } : undefined}
          onLap={lap ? () => lap(dangXem) : undefined} />
      )}
    </>
  );
}

/** Ô của một khoản theo khoá cột. Nút và link trong dòng chặn lan sự kiện để không mở popup. */
function oKhoan(
  key: string,
  x: DongMuaHang,
  homNay: string,
  lap?: (x: DongMuaHang) => void,
  onMoDon?: (code: string) => void,
) {
  const don = x.r.don;
  const maDon = onMoDon ? (
    <button type="button" className="lds-lk" onClick={(e) => { e.stopPropagation(); onMoDon(don.code); }}>{don.code}</button>
  ) : don.code;
  switch (key) {
    case "ncc":
      return <td key={key} title={don.supplier_name ?? undefined}>{don.supplier_name ?? "—"}</td>;
    case "khoan":
      return <td key={key}><span className="lds-tag">{x.loai === "coc" ? "Cọc" : `Đợt ${x.d.seq_no}`}</span></td>;
    case "nguon": {
      // Như "Đơn hàng chờ thu": cọc chỉ mã đơn; đợt ghi hoá đơn NCC của đợt rồi tới đơn. Ký hiệu + ngày
      // hoá đơn ở `title` và popup.
      if (x.loai === "coc") return <td key={key}>{maDon}</td>;
      const d = x.d;
      const hd = d.invoice_number
        ? `Hóa đơn ${d.invoice_symbol ? `${d.invoice_symbol} ` : ""}${d.invoice_number}${d.invoice_date ? ` ngày ${ngay(d.invoice_date)}` : ""}`
        : "Chưa có hóa đơn";
      return (
        <td key={key} title={`${hd} đợt ${d.seq_no} đơn ${don.code}`}>
          {d.invoice_number ? `HĐ ${d.invoice_number}` : <span className="lds-mu">chưa có HĐ</span>}
          {" "}<span className="lds-mu">đơn</span> {maDon}
        </td>
      );
    }
    case "han": {
      if (x.loai === "coc" || !x.d.due_date) return <td key={key} />;
      const tre = x.d.due_date < homNay;
      return <td key={key} className={tre ? "lds-do" : undefined} title={tre ? "Quá hạn" : undefined}>{ngay(x.d.due_date)}</td>;
    }
    case "phai_chi": {
      if (x.loai === "dot") return <td key={key} className="n">{tien(x.d.amount)}</td>;
      // Cọc còn phải chi kẹp ở phần hàng chưa về ⇒ phải chi = đã chi + còn phải chi (có thể nhỏ hơn cọc khai).
      const phai = don.coc_da_chi + x.r.coc_can_chi;
      return (
        <td key={key} className="n"
          title={phai < don.deposit_expected ? `Cọc đã khai ${tien(don.deposit_expected)}, chỉ còn treo cho phần hàng chưa về` : undefined}>
          {tien(phai)}
        </td>
      );
    }
    case "coc_tru":
      return <td key={key} className="n">{x.loai === "dot" && x.d.coc_bu > 0 ? tien(x.d.coc_bu) : ""}</td>;
    case "da_chi": {
      const da = x.loai === "coc" ? don.coc_da_chi : x.d.paid_amount;
      return <td key={key} className="n">{da > 0 ? tien(da) : ""}</td>;
    }
    case "con":
      return <td key={key} className="n">{tien(x.loai === "coc" ? x.r.coc_can_chi : x.d.con_no)}</td>;
    case "nut":
      return (
        <td key={key} className="lds-nut">
          {lap && (
            <button type="button" className="kt-btn kt-btn--nho" onClick={(e) => { e.stopPropagation(); lap(x); }}>
              Lập phiếu chi
            </button>
          )}
        </td>
      );
    default:
      return <td key={key} />;
  }
}

/** Popup một khoản kiểu B (`ChiTietKhoan`): cọc kể hàng đã đặt của cả đơn + các phiếu cọc; đợt kể hàng về
 *  của đợt + nhận hàng, cọc trừ, các phiếu chi (phiếu gộp: số là phần của đợt). */
function PopupKhoanMua({
  x,
  homNay,
  onClose,
  onMoDon,
  onLap,
}: {
  x: DongMuaHang;
  homNay: string;
  onClose: () => void;
  onMoDon?: (code: string) => void;
  onLap?: () => void;
}) {
  useNapTenDonVi();
  const don = x.r.don;
  const dongDon = new Map(don.lines.map((l) => [l.id, l]));
  const kho = (l: { kho_rong: number; kho_dai: number }) =>
    l.kho_rong > 0 && <>{" "}<span className="lds-mu">{l.kho_rong}×{l.kho_dai}</span></>;
  const maDon = onMoDon ? (
    <button type="button" className="kt-lk" onClick={() => onMoDon(don.code)}>
      {don.code} <ExternalLink size={12} aria-hidden="true" />
    </button>
  ) : don.code;
  const soPhieu = (p: { code: string; doc_no: string | null }) => p.doc_no || p.code;

  if (x.loai === "coc") {
    return (
      <ChiTietKhoan
        tieuDe={`Cọc đơn ${don.code}`}
        phuDe={don.supplier_name}
        nhanHang="Hàng đã đặt"
        slNhan="SL đặt"
        hang={don.lines.map((l) => ({
          khoa: l.id, ten: <>{l.item_name}{kho(l)}</>, tenDu: l.item_name, sl: vietSo(l.quantity),
          dvt: tenDonVi(l.unit) ?? l.unit, donGia: l.expected_unit_price, ck: l.discount_percent, vat: l.vat_percent,
          thanhTien: l.line_total,
        }))}
        tong={[
          { nhan: "Hàng đã về", tien: don.gia_tri_da_giao },
          { nhan: "Giá trị đơn", tien: don.total_estimate, cuoi: true },
        ]}
        lichSu={(don.coc_da_lap ?? []).map((p, i) => ({
          khoa: `coc-${p.voucher_id ?? i}`,
          ngay: p.voucher_date,
          noiDung: `Phiếu chi cọc ${soPhieu(p)}${p.gop ? " phiếu gộp" : ""}`,
          tien: -p.amount,
        }))}
        con={{ nhan: "Cọc còn phải chi", tien: x.r.coc_can_chi }}
        nut={onLap && <button type="button" className="kt-btn kt-btn--chinh" onClick={onLap}>Lập phiếu chi cọc</button>}
        thongTin={[
          { nhan: "Cọc đã khai", giaTri: tien(don.deposit_expected) },
          { nhan: "Đã chi cọc", giaTri: tien(don.coc_da_chi) },
          { nhan: "Đơn mua", giaTri: maDon },
        ]}
        onClose={onClose}
      />
    );
  }

  const d = x.d;
  const quaHan = d.due_date != null && d.due_date < homNay;
  return (
    <ChiTietKhoan
      tieuDe={`Đợt ${d.seq_no} đơn ${don.code}`}
      phuDe={don.supplier_name}
      nhanHang={`Hàng về đợt ${d.seq_no}`}
      slNhan="SL nhận"
      hang={d.lines.map((l) => {
        const goc = dongDon.get(l.purchase_request_line_id);
        return {
          khoa: l.id,
          ten: <>{l.item_name}{kho(l)}</>,
          tenDu: l.item_name,
          sl: (
            <>
              {vietSo(l.quantity)}
              {/* Phần dư 0đ phải lộ ra — NCC thật ra có tính tiền phần đó thì bắt được lúc đối chiếu. */}
              {l.quantity_du > 0 && <span className="lds-mu" title="Phần giao vượt số đặt, không tính tiền"> (dư {vietSo(l.quantity_du)})</span>}
            </>
          ),
          dvt: tenDonVi(l.unit) ?? l.unit,
          donGia: l.don_gia,
          ck: goc?.discount_percent,
          vat: goc?.vat_percent,
          thanhTien: l.thanh_tien,
        };
      })}
      tong={[{ nhan: "Giá trị đợt", tien: d.amount, cuoi: true }]}
      lichSu={[
        { khoa: "nhan", ngay: d.delivery_date, noiDung: `Nhận hàng đợt ${d.seq_no}`, tien: d.amount },
        ...(d.coc_bu > 0 ? [{ khoa: "coc", ngay: null, ngayChu: "cọc", noiDung: "Cọc của đơn trừ vào đợt", tien: -d.coc_bu }] : []),
        ...(d.phieu_chi ?? []).map((p, i) => ({
          khoa: `pc-${p.voucher_id ?? i}`,
          ngay: p.voucher_date,
          noiDung: `Phiếu chi ${soPhieu(p)}${p.gop ? " phiếu gộp" : ""}`,
          tien: -p.amount,
        })),
      ]}
      con={{ nhan: "Còn phải chi", tien: d.con_no }}
      nut={onLap && <button type="button" className="kt-btn kt-btn--chinh" onClick={onLap}>Lập phiếu chi</button>}
      thongTin={[
        {
          nhan: "Hạn chi",
          giaTri: d.due_date ? (
            <span className={quaHan ? "lds-do" : undefined}>{ngay(d.due_date)}{quaHan ? " quá hạn" : ""}</span>
          ) : <span className="lds-mu">chưa có</span>,
        },
        { nhan: "Ngày giao", giaTri: ngay(d.delivery_date) },
        {
          nhan: "Hoá đơn",
          giaTri: d.invoice_number ? (
            <>
              {`${d.invoice_symbol ? `${d.invoice_symbol} ` : ""}${d.invoice_number}`}
              {d.invoice_date && <><br /><span className="lds-mu">{`ngày ${ngay(d.invoice_date)}`}</span></>}
            </>
          ) : <span className="lds-mu">chưa có</span>,
        },
        { nhan: "Đơn mua", giaTri: maDon },
        { nhan: "Cả đơn", giaTri: <>{tien(don.total_estimate)}<br /><span className="lds-mu">{`đã chi ${tien(don.net_paid)}`}</span></> },
      ]}
      onClose={onClose}
    />
  );
}
