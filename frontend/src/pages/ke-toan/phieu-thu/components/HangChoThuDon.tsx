/** Hàng "Đơn hàng chờ thu" (17/10/2026), cùng khuôn "Gia công chờ chi" bên Phiếu chi: cọc của đơn đã
 *  chốt chưa thu đủ + hoá đơn khách chưa trả hết. Thu đủ thì dòng rời danh sách; huỷ phiếu thu thì
 *  dòng quay lại. Số còn nợ của hoá đơn cùng số màn Công nợ phải thu. Cột "Trả lại ngoài đơn" chỉ hiện
 *  khi có hoá đơn được cộng nợ lại tiền đã trả khách ngoài đơn: Phải thu + Trả lại ngoài đơn − Đã thu =
 *  Còn phải thu, Đã thu là số thật của phiếu.
 *
 *  Tick nhiều khoản của CÙNG một khách (17/10/2026: "một phiếu cho cả lượt") ⇒ dải chân "Đã chọn n
 *  khoản của …" + "Lập một phiếu thu": một phiếu, bảng phân bổ từng khoản. Tick khoản đầu thì khoản của
 *  khách khác khoá ô tick. */
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { api, type ChiTietKhoanThu, type CocChoThu, type HoaDonChoThu } from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import { CuonLuoi, rongLuoi, type CauHinhLuoi, type CotLuoi } from "../../../../components/LuoiDs";
import { ChiTietKhoan, type DongLichSu } from "../../shared/ChiTietKhoan";
import { ngay, tien, vietSo } from "../../shared/dinhDang";
import type { KhoanThuGop } from "./LapPhieuThuGop";

export type DongChoThu = { loai: "coc"; r: CocChoThu } | { loai: "hoa_don"; r: HoaDonChoThu };

// Bề rộng chung với "Mua hàng chờ chi": 8 cột vừa khung 1146px của màn 1440 (tiền 124 đủ "999.999.999 đ").
export const COT_CHO_THU: (CotLuoi & { w?: number; n?: boolean })[] = [
  { key: "chon", label: "Chọn", coDinh: true, w: 40 },
  { key: "khach", label: "Khách hàng", coDinh: true, w: 220 },
  { key: "khoan", label: "Khoản thu", w: 96 },
  { key: "nguon", label: "Nguồn", w: 220 },
  { key: "han", label: "Hạn thu", w: 104 },
  { key: "phai_thu", label: "Phải thu", n: true, w: 124 },
  { key: "tra_ngoai", label: "Trả lại ngoài đơn", n: true, w: 140 },
  { key: "da_thu", label: "Đã thu", n: true, w: 124 },
  { key: "con", label: "Còn phải thu", n: true, w: 124 },
  { key: "nut", label: "Thao tác", coDinh: true, w: 130 },
];

/** Cọc trước (việc cần làm sớm để đơn chạy), rồi hoá đơn theo hạn thu — thứ tự máy chủ đã xếp. */
export function gopDongChoThu(coc: CocChoThu[], hoaDon: HoaDonChoThu[]): DongChoThu[] {
  return [
    ...coc.map((r) => ({ loai: "coc" as const, r })),
    ...hoaDon.map((r) => ({ loai: "hoa_don" as const, r })),
  ];
}

const khoaDong = (d: DongChoThu) => (d.loai === "coc" ? `coc-${d.r.order_id}` : `hd-${d.r.invoice_id}`);
const nhanKhoan = (d: DongChoThu) => (d.loai === "coc" ? "Cọc" : `HĐ ${d.r.invoice_number}`);

/** Ảnh chụp một khoản cho form phiếu thu gộp. */
export function khoanThuGop(d: DongChoThu): KhoanThuGop {
  return d.loai === "coc"
    ? { sales_invoice_id: null, order_id: d.r.order_id, ma_don: d.r.order_code, nhan: "Cọc", han: null, con: d.r.con_thieu }
    : {
        sales_invoice_id: d.r.invoice_id,
        order_id: d.r.order_id,
        ma_don: d.r.order_code,
        nhan: nhanKhoan(d),
        han: d.r.due_date,
        con: d.r.con_no,
        ngay_hd: d.r.invoice_date,
      };
}

export function HangChoThuDon({
  rows,
  loi,
  onLap,
  onLapGop,
  onMoDon,
  luoi,
}: {
  rows: DongChoThu[] | null;
  loi: string | null;
  /** Không có = không có quyền lập phiếu thu ⇒ không hiện nút. */
  onLap?: (dong: DongChoThu) => void;
  /** Lập MỘT phiếu thu cho các khoản đã tick (cùng khách). Không có = không có ô tick. */
  onLapGop?: (khach: { id: number; ten: string }, khoan: KhoanThuGop[]) => void;
  /** Không có = không có quyền xem Đơn hàng bán ⇒ mã đơn là chữ thường. */
  onMoDon?: (orderId: number) => void;
  luoi?: CauHinhLuoi;
}) {
  const coHoan = rows?.some((d) => d.loai === "hoa_don" && (d.r.hoan_khong_don ?? 0) > 0) ?? false;
  const goc = COT_CHO_THU.filter((c) => (c.key !== "tra_ngoai" || coHoan) && (c.key !== "chon" || !!onLapGop));
  const cot = luoi ? luoi.rongHien(luoi.xep(goc).filter((c) => !luoi.an.has(c.key))) : goc;

  // Khoản đã tick — chỉ giữ khoản còn trong hàng (thu đủ / nạp lại thì tự rơi khỏi lựa chọn).
  const [chon, setChon] = useState<Set<string>>(new Set());
  // Dòng đang mở popup chi tiết (theo khoá — nạp lại hàng mà khoản đã rời thì popup tự đóng).
  const [xem, setXem] = useState<string | null>(null);
  const dangXem = rows?.find((d) => khoaDong(d) === xem) ?? null;
  const daChon = (rows ?? []).filter((d) => chon.has(khoaDong(d)));
  const khachChon = daChon.length ? daChon[0].r.customer_id : null;
  const tongChon = daChon.reduce((s, d) => s + (d.loai === "coc" ? d.r.con_thieu : d.r.con_no), 0);
  const tick = (d: DongChoThu) =>
    setChon((cu) => {
      const moi = new Set(cu);
      if (moi.has(khoaDong(d))) moi.delete(khoaDong(d));
      else moi.add(khoaDong(d));
      return moi;
    });
  const oChon = (d: DongChoThu) => {
    const khac = khachChon != null && d.r.customer_id !== khachChon;
    return (
      <td key="chon" className="kt-gop-tick" onClick={(e) => e.stopPropagation()}>
        {d.r.customer_id != null && (
          <label title={khac ? "Khác khách hàng" : undefined}>
            <input type="checkbox" aria-label={`Chọn ${nhanKhoan(d)} của ${d.r.order_code}`}
              checked={chon.has(khoaDong(d))} disabled={khac} onChange={() => tick(d)} />
          </label>
        )}
      </td>
    );
  };
  // Dải chân + popup nằm NGOÀI `lds-sheet`: khung đó `overflow:hidden` làm `position:sticky` mất tác dụng.
  return (
    <>
    <div className="lds-sheet">
      <p className="kt-gc-ghi">
        Cọc của đơn đã chốt chưa thu đủ và hóa đơn khách chưa trả hết. Thu đủ thì khoản đó rời khỏi danh sách này.
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
                  <span className="lds-do" role="alert">{`Không tải được danh sách đơn hàng chờ thu. ${loi}`}</span>
                </td>
              </tr>
            ) : rows == null ? (
              <tr><td colSpan={cot.length} className="lds-trong">Đang tải…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={cot.length} className="lds-trong">Không còn khoản nào chờ thu.</td></tr>
            ) : (
              rows.map((d) => (
                <tr
                  key={khoaDong(d)}
                  className={`lds-dong${xem === khoaDong(d) ? " is-chon" : ""}`}
                  tabIndex={0}
                  aria-haspopup="dialog"
                  onClick={() => setXem(khoaDong(d))}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      setXem(khoaDong(d));
                    }
                  }}
                >
                  {cot.map((c) => (c.key === "chon" ? oChon(d) : oChoThu(c.key, d, onLap, onMoDon)))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CuonLuoi>
    </div>
      {onLapGop && daChon.length > 0 && khachChon != null && (
        <div className="kt-gop-chan" role="region" aria-label="Khoản đã chọn">
          <span>{`Đã chọn ${vietSo(daChon.length)} khoản của ${daChon[0].r.customer_name ?? "khách hàng"}`}</span>
          <span className="kt-gop-chan__tong">{tien(tongChon)}</span>
          <button type="button" className="kt-btn kt-btn--tron" onClick={() => setChon(new Set())}>Bỏ chọn</button>
          <button type="button" className="kt-btn kt-btn--chinh"
            onClick={() => onLapGop({ id: khachChon, ten: daChon[0].r.customer_name ?? "" }, daChon.map(khoanThuGop))}>
            Lập một phiếu thu
          </button>
        </div>
      )}
      {dangXem && (
        <PopupKhoanThu d={dangXem} onClose={() => setXem(null)}
          onMoDon={onMoDon ? (id) => { setXem(null); onMoDon(id); } : undefined}
          onLap={onLap && dangXem.r.customer_id != null ? () => { setXem(null); onLap(dangXem); } : undefined} />
      )}
    </>
  );
}

/** Popup một khoản chờ thu kiểu B (`ChiTietKhoan`). Hoá đơn: hàng của hoá đơn (theo lượt giao nếu hoá
 *  đơn gắn lượt) + ghi hoá đơn, cọc trừ, trả lại ngoài đơn, các phiếu thu (phiếu gộp: số là phần của hoá
 *  đơn). Cọc: hàng của cả đơn + các phiếu thu cọc. */
function PopupKhoanThu({
  d,
  onClose,
  onMoDon,
  onLap,
}: {
  d: DongChoThu;
  onClose: () => void;
  onMoDon?: (orderId: number) => void;
  onLap?: () => void;
}) {
  const { token } = useAuth();
  const [ct, setCt] = useState<ChiTietKhoanThu | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const khoa = khoaDong(d);
  useEffect(() => {
    if (!token) return;
    let bo = false;
    setCt(null);
    setLoi(null);
    api.accounting
      .chiTietKhoanThu(token, d.loai === "coc" ? { order_id: d.r.order_id } : { invoice_id: d.r.invoice_id })
      .then((x) => { if (!bo) setCt(x); })
      .catch((e: unknown) => { if (!bo) setLoi(e instanceof Error ? e.message : String(e)); });
    return () => { bo = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, khoa]);

  const r = d.r;
  const hang = (ct?.hang ?? []).map((h, i) => ({
    khoa: i, ten: h.ten ?? "", tenDu: h.ten ?? undefined, sl: vietSo(h.so_luong), dvt: h.dvt ?? "",
    donGia: h.don_gia, vat: h.vat, thanhTien: h.thanh_tien,
  }));
  const tienHang = hang.reduce((s, h) => s + h.thanhTien, 0);
  const vat = hang.reduce((s, h) => s + Math.round((h.thanhTien * (h.vat ?? 0)) / 100), 0);
  const phieu: DongLichSu[] = (ct?.phieu ?? []).map((p) => ({
    khoa: `pt-${p.receipt_id}`,
    ngay: p.ngay,
    noiDung: `Phiếu thu ${p.doc_no || p.code}${p.gop ? " phiếu gộp" : ""}`,
    tien: -p.amount,
  }));
  const maDon = onMoDon ? (
    <button type="button" className="kt-lk" onClick={() => onMoDon(r.order_id)}>
      {r.order_code} <ExternalLink size={12} aria-hidden="true" />
    </button>
  ) : r.order_code;
  const chung = {
    phuDe: r.customer_name,
    hang,
    dangTaiHang: ct == null && loi == null,
    loiHang: loi ? `Không tải được chi tiết khoản. ${loi}` : undefined,
    onClose,
  };

  if (d.loai === "coc") {
    const c = d.r;
    return (
      <ChiTietKhoan
        {...chung}
        tieuDe={`Cọc đơn ${c.order_code}`}
        nhanHang="Hàng của đơn"
        slNhan="SL đặt"
        tong={ct ? [
          { nhan: "Cộng tiền hàng", tien: tienHang },
          ...(vat > 0 ? [{ nhan: "VAT", tien: vat }] : []),
          { nhan: "Giá trị đơn", tien: tienHang + vat, cuoi: true },
        ] : []}
        lichSu={phieu}
        con={{ nhan: "Cọc còn phải thu", tien: c.con_thieu }}
        nut={onLap && <button type="button" className="kt-btn kt-btn--chinh" onClick={onLap}>Lập phiếu thu cọc</button>}
        thongTin={[
          { nhan: "Tỷ lệ cọc", giaTri: `${vietSo(c.deposit_pct)}%` },
          { nhan: "Cọc phải thu", giaTri: tien(c.can_thu) },
          { nhan: "Đã thu cọc", giaTri: tien(c.da_thu) },
          { nhan: "Đơn bán", giaTri: maDon },
        ]}
      />
    );
  }

  const h = d.r;
  const hoan = h.hoan_khong_don ?? 0;
  const soHd = `${h.invoice_symbol ? `${h.invoice_symbol} ` : ""}${h.invoice_number}`;
  return (
    <ChiTietKhoan
      {...chung}
      tieuDe={`Hoá đơn ${h.invoice_number} đơn ${h.order_code}`}
      nhanHang="Hàng trên hoá đơn"
      tong={ct ? [
        { nhan: "Cộng tiền hàng", tien: tienHang },
        ...(vat > 0 ? [{ nhan: "VAT", tien: vat }] : []),
        { nhan: "Giá trị hoá đơn", tien: h.amount, cuoi: true },
      ] : []}
      lichSu={[
        { khoa: "hd", ngay: h.invoice_date, noiDung: `Ghi hoá đơn ${soHd}`, tien: h.amount },
        ...(h.deposit_offset_amount > 0
          ? [{ khoa: "coc", ngay: null, ngayChu: "cọc", noiDung: "Cọc của đơn trừ vào hoá đơn", tien: -h.deposit_offset_amount }]
          : []),
        ...(hoan > 0
          ? [{ khoa: "hoan", ngay: null, ngayChu: "ngoài đơn", noiDung: "Trả lại khách ngoài đơn, cộng nợ lại vào hoá đơn này", tien: hoan }]
          : []),
        ...phieu,
      ]}
      con={{ nhan: "Còn phải thu", tien: h.con_no }}
      nut={onLap && <button type="button" className="kt-btn kt-btn--chinh" onClick={onLap}>Lập phiếu thu</button>}
      thongTin={[
        { nhan: "Hạn thu", giaTri: h.due_date ? ngay(h.due_date) : <span className="lds-mu">chưa đặt hạn</span> },
        { nhan: "Hoá đơn", giaTri: <>{soHd}<br /><span className="lds-mu">{`ngày ${ngay(h.invoice_date)}`}</span></> },
        { nhan: "Đơn bán", giaTri: maDon },
      ]}
    />
  );
}

function oChoThu(
  key: string,
  d: DongChoThu,
  onLap?: (dong: DongChoThu) => void,
  onMoDon?: (orderId: number) => void,
) {
  const r = d.r;
  const maDon = onMoDon ? (
    <button type="button" className="lds-lk" onClick={(e) => { e.stopPropagation(); onMoDon(r.order_id); }}>{r.order_code}</button>
  ) : r.order_code;
  switch (key) {
    case "khach":
      return <td key={key} title={r.customer_name ?? undefined}>{r.customer_name ?? "—"}</td>;
    case "khoan":
      return <td key={key}><span className="lds-tag">{d.loai === "coc" ? "Cọc" : "Hóa đơn"}</span></td>;
    case "nguon":
      return d.loai === "coc" ? (
        <td key={key}>{maDon}</td>
      ) : (
        <td key={key} title={`Hóa đơn ${d.r.invoice_number} đơn ${r.order_code}`}>
          {`HĐ ${d.r.invoice_number}`} <span className="lds-mu">đơn</span> {maDon}
        </td>
      );
    case "han":
      return <td key={key}>{d.loai === "hoa_don" && d.r.due_date ? ngay(d.r.due_date) : ""}</td>;
    case "phai_thu":
      return <td key={key} className="n">{tien(d.loai === "coc" ? d.r.can_thu : d.r.amount)}</td>;
    case "tra_ngoai": {
      const hoan = d.loai === "hoa_don" ? d.r.hoan_khong_don ?? 0 : 0;
      return <td key={key} className="n" title={hoan > 0 ? "Đã trả lại khách ngoài đơn, cộng nợ lại vào hoá đơn này" : undefined}>
        {hoan > 0 ? tien(hoan) : ""}
      </td>;
    }
    case "da_thu": {
      const da = d.r.da_thu;
      return <td key={key} className="n">{da > 0 ? tien(da) : ""}</td>;
    }
    case "con":
      return <td key={key} className="n">{tien(d.loai === "coc" ? d.r.con_thieu : d.r.con_no)}</td>;
    case "nut":
      return (
        <td key={key} className="lds-nut">
          {onLap && r.customer_id != null && (
            <button type="button" className="kt-btn kt-btn--nho" onClick={(e) => { e.stopPropagation(); onLap(d); }}>Lập phiếu thu</button>
          )}
        </td>
      );
    default:
      return <td key={key} />;
  }
}
