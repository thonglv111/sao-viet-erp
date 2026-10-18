/** Bảng danh sách phiếu thu — khuôn lưới danh sách chung `lds-*` (giống các danh sách Kinh doanh,
 *  đối xứng bảng Phiếu chi): Số phiếu — Ngày thu — Người nộp tiền — Lý do nộp — Thu theo — Hình thức —
 *  Số tiền — Trạng thái — Ngày tạo — Ghi chú, cuối bảng dòng Cộng phiếu đã thu (số máy chủ cộng trên cả bộ lọc).
 *  Cột do người xem ẩn / đổi chỗ nên trang truyền vào `cot` (đã xếp + lọc); ô vẽ theo khoá cột.
 *  Mẩu thông tin đứng cạnh nhau KHÔNG nối bằng "·" hay dấu phẩy: nhãn loại là thẻ nhỏ.
 *  Mã nguồn là nút khi người xem mở được nơi đó (`moNguon`); bấm nút không mở ngăn phiếu.
 *  Dòng đi được bằng bàn phím (↑ ↓ chuyển, Enter mở).
 */
import type { PaymentReceiptRow } from "../../../../api/client";
import { EmptyRow } from "../../../../components/EmptyState";
import { CuonLuoi, ChipTT, rongLuoi, soCotGhim, type CauHinhLuoi, soVN, type CotLuoi } from "../../../../components/LuoiDs";
import { PhanTrangDayDu } from "../../../../components/PhanTrangDayDu";
import { diChuyen } from "../../shared/BangPhieu";
import { ngay, ngayGio } from "../../shared/dinhDang";
import { soPhieu } from "../../shared/LuoiGon";
import { laGop, tenDongThu } from "../../shared/phieuGop";
import { STATUS_META } from "../shared/constants";
import { methodText, sourceCode, sourceLabel } from "../shared/helpers";

export interface CotPhieuThu extends CotLuoi {
  w?: number;
  n?: boolean;
}

/** Cột Lý do nộp rộng 220 và Số tiền 136 (đủ số tới chục tỷ); cột cuối (Ngày tạo) co giãn.
 *  Cột Ghi chú (chỉ để nhắc "Thiếu chứng từ gốc") gỡ 18/10/2026. */
export const COT_PHIEU_THU: CotPhieuThu[] = [
  { key: "so", label: "Số phiếu", coDinh: true, w: 100 },
  { key: "ngay_thu", label: "Ngày thu", w: 104 },
  { key: "nguoi_nop", label: "Người nộp tiền", w: 170 },
  { key: "ly_do", label: "Lý do nộp", w: 220 },
  { key: "muc", label: "Mục thu", w: 160 },
  { key: "thu_theo", label: "Thu theo", w: 190 },
  { key: "hinh_thuc", label: "Hình thức", w: 112 },
  { key: "so_tien", label: "Số tiền", n: true, w: 136 },
  { key: "trang_thai", label: "Trạng thái", w: 112 },
  { key: "ngay_tao", label: "Ngày tạo" },
];

/** Màu chip của từng trạng thái (bộ `--tt-*`, mỗi trạng thái một sắc). */
const MAU_TRANG_THAI = { xanh: "la", amber: "cam", xam: "xam" } as const;

function OPhieuThu({ cot, row, moNguon }: {
  cot: string;
  row: PaymentReceiptRow;
  moNguon?: (row: PaymentReceiptRow) => (() => void) | undefined;
}) {
  switch (cot) {
    case "so":
      return <td title={soPhieu(row)}>{soPhieu(row)}</td>;
    case "ngay_thu":
      return <td>{ngay(row.receipt_date)}</td>;
    case "nguoi_nop":
      return <td title={row.payer_name || undefined}>{row.payer_name || "—"}</td>;
    case "ly_do":
      return <td title={row.content || undefined}>{row.content}</td>;
    case "muc":
      return row.muc_thu_chi_ten
        ? <td title={row.muc_thu_chi_ten}>{row.muc_thu_chi_ten}</td>
        : <td><span className="lds-mu">Chưa phân loại</span></td>;
    case "thu_theo": {
      // Phiếu thu lập tay không có chứng từ nguồn — cột Mục đã nói nó là khoản gì, khỏi chữ "Khác".
      if (row.source_type === "other") return <td />;
      // Phiếu gộp: không một mã nào đại diện được — ghi số chứng từ, chữ nổi liệt kê từng dòng.
      if (laGop(row)) {
        return (
          <td title={row.lines!.map((l) => `${tenDongThu(l)} ${soVN(l.amount)}`).join("\n")}>
            <span className="lds-tag">Đơn bán</span>{" "}
            <span className="lds-mu">{`${row.lines!.length} chứng từ`}</span>
          </td>
        );
      }
      const ma = sourceCode(row);
      const mo = ma ? moNguon?.(row) : undefined;
      // Ô hẹp: mã dài bị "…" cắt thì chữ nổi giữ đủ nhãn + mã.
      return (
        <td title={[sourceLabel(row), ma].filter(Boolean).join(" ")}>
          <span className="lds-tag">{sourceLabel(row)}</span>
          {ma && " "}
          {ma && (mo ? (
            <button type="button" className="lds-lk"
              onClick={(e) => {
                e.stopPropagation();
                mo();
              }}
              onKeyDown={(e) => e.stopPropagation()}>
              {ma}
            </button>
          ) : (
            <span className="lds-mu">{ma}</span>
          ))}
        </td>
      );
    }
    case "hinh_thuc":
      return <td>{methodText(row)}</td>;
    case "so_tien": {
      const ngoaiTe = row.currency !== "VND"
        ? `${row.currency} ${soVN(row.amount)} tỷ giá ${soVN(row.exchange_rate)}`
        : undefined;
      return <td className="n"><span title={ngoaiTe}>{soVN(row.amount_vnd)}</span></td>;
    }
    case "trang_thai": {
      const tt = STATUS_META[row.status];
      return <td><ChipTT mau={MAU_TRANG_THAI[tt.mau]}>{tt.label}</ChipTT></td>;
    }
    case "ngay_tao":
      return <td className="lds-mu" title={ngayGio(row.created_at)}>{ngay(row.created_at)}</td>;
    default:
      return <td />;
  }
}

export function ReceiptsTable({
  cot,
  luoi,
  rows,
  loading,
  loi,
  onTaiLai,
  dangXem,
  onMo,
  coLoc,
  onBoLoc,
  onLap,
  moNguon,
  trang,
  size,
  tong,
  onTrang,
  onSize,
  tongTien,
  soXong,
}: {
  /** Cột đang hiện, đã xếp theo thứ tự người xem chọn. */
  cot: CotPhieuThu[];
  /** Cấu hình lưới của màn cha — có thì ghim + kéo độ rộng được. */
  luoi?: CauHinhLuoi;
  rows: PaymentReceiptRow[];
  loading: boolean;
  /** Lỗi tải danh sách — bảng rỗng thì nói "không tải được", không nói "chưa có". */
  loi: string | null;
  onTaiLai: () => void;
  dangXem: number | null;
  onMo: (id: number) => void;
  /** Đang lọc gì ngoài kỳ ⇒ bảng rỗng mời "Bỏ lọc". */
  coLoc: boolean;
  onBoLoc: () => void;
  /** Không có = không có quyền lập phiếu ⇒ bảng rỗng không mời lập. */
  onLap?: () => void;
  /** Cách mở nơi nguồn của một phiếu; undefined = không mở được (thiếu quyền / thu khác). */
  moNguon?: (row: PaymentReceiptRow) => (() => void) | undefined;
  trang: number;
  size: number;
  tong: number;
  onTrang: (n: number) => void;
  onSize: (n: number) => void;
  /** Tổng tiền phiếu đã thu theo kỳ + bộ lọc (mọi trang); null = chưa có ⇒ không vẽ dòng Cộng. */
  tongTien: number | null;
  /** Số phiếu đã thu khớp với `tongTien`; null = thẻ đang xem không có phiếu đã thu. */
  soXong: number | null;
}) {
  const viTriTien = cot.findIndex((c) => c.key === "so_tien");
  return (
    <div className="lds-sheet" aria-busy={loading || undefined}>
      <CuonLuoi ghim={soCotGhim(cot, luoi?.ghim)}>
        <table className="lds-g" style={{ minWidth: rongLuoi(cot) }}>
          <colgroup>
            {cot.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
          </colgroup>
          <thead>
            <tr>{cot.map((c) => <th key={c.key} className={c.n ? "n" : undefined}>{c.label}{luoi?.keo(c.key)}</th>)}</tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <EmptyRow colSpan={cot.length} trangThai="dang-tai" />
            ) : loi && rows.length === 0 ? (
              <tr>
                <td colSpan={cot.length} className="lds-trong">
                  <span className="lds-do" role="alert">{`Không tải được danh sách phiếu thu. ${loi}`}</span>{" "}
                  <button type="button" className="lds-lk" onClick={onTaiLai}>Thử lại</button>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={cot.length} className="lds-trong">
                  {coLoc ? (
                    <>
                      Không có phiếu nào khớp điều kiện đang lọc.{" "}
                      <button type="button" className="lds-lk" onClick={onBoLoc}>Xoá bộ lọc</button>
                    </>
                  ) : (
                    <>
                      Chưa có phiếu thu nào trong kỳ này. Thu cọc lập ở Đơn hàng bán, thu hoá đơn lập ở Công nợ phải thu;
                      khoản thu khác lập ở đây.
                      {onLap && (
                        <>
                          {" "}
                          <button type="button" className="lds-lk" onClick={onLap}>Lập phiếu thu</button>
                        </>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}
                  className={`lds-dong${row.id === dangXem ? " is-chon" : ""}${row.status === "cancelled" ? " kt-da-huy" : ""}`}
                  tabIndex={0} onClick={() => onMo(row.id)} onKeyDown={(e) => diChuyen(e, () => onMo(row.id))}>
                  {cot.map((c) => <OPhieuThu key={c.key} cot={c.key} row={row} moNguon={moNguon} />)}
                </tr>
              ))
            )}
            {/* Dòng Cộng: Σ tiền phiếu đã thu của MỌI phiếu khớp bộ lọc (máy chủ cộng), không chỉ trang đang xem. */}
            {rows.length > 0 && tongTien != null && soXong != null && (
              <tr className="lds-cong lds-nhom">
                {/* Cột Số tiền bị ẩn: dòng Cộng vẫn còn, tổng tiền đứng ngay sau nhãn (không mất số phiếu lẫn tiền). */}
                <td className="lead" colSpan={viTriTien > 0 ? viTriTien : cot.length}>
                  <span className="lds-dinh-trai">
                    {`Cộng ${soVN(soXong)} phiếu đã thu`}
                    {viTriTien < 0 ? <span>{soVN(tongTien)}</span> : null}
                    <span className="lds-mu3">không tính phiếu đã hủy</span>
                  </span>
                </td>
                {viTriTien > 0 ? <td className="n">{soVN(tongTien)}</td> : null}
                {viTriTien > 0 && cot.length - viTriTien - 1 > 0 ? <td colSpan={cot.length - viTriTien - 1} /> : null}
              </tr>
            )}
          </tbody>
        </table>
      </CuonLuoi>
      {!loi && tong > 0 && (
        <PhanTrangDayDu
          trang={trang}
          size={size}
          tong={tong}
          soDong={rows.length}
          onTrang={onTrang}
          onSize={onSize}
          loading={loading}
          donVi="phiếu"
          ariaLabel="Phân trang phiếu thu"
        />
      )}
    </div>
  );
}
