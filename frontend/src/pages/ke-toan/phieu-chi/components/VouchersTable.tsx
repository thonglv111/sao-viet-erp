/** Bảng danh sách phiếu chi — khuôn lưới danh sách chung `lds-*` (giống các danh sách Kinh doanh):
 *  Số phiếu — Ngày chi — Người nhận tiền — Lý do chi — Chi theo — Hình thức — Số tiền — Trạng thái —
 *  Ngày tạo — Ghi chú, cuối bảng dòng Cộng phiếu đã chi (số máy chủ cộng trên cả bộ lọc).
 *  Cột do người xem ẩn / đổi chỗ nên trang truyền vào `cot` (đã xếp + lọc); ô vẽ theo khoá cột.
 *  Mẩu thông tin đứng cạnh nhau KHÔNG nối bằng "·" hay dấu phẩy: nhãn loại là thẻ nhỏ.
 *  Dòng đi được bằng bàn phím (↑ ↓ chuyển, Enter mở).
 */
import type { PaymentVoucherRow } from "../../../../api/client";
import { EmptyRow } from "../../../../components/EmptyState";
import { CuonLuoi, ChipTT, rongLuoi, soCotGhim, type CauHinhLuoi, soVN, type CotLuoi } from "../../../../components/LuoiDs";
import { PhanTrangDayDu } from "../../../../components/PhanTrangDayDu";
import { diChuyen } from "../../shared/BangPhieu";
import { ngay, ngayGio } from "../../shared/dinhDang";
import { soPhieu } from "../../shared/LuoiGon";
import { laGop, tenDongChi } from "../../shared/phieuGop";
import { VOUCHER_METHOD_LABELS, nguonPhieu } from "../shared/list-constants";

export interface CotPhieuChi extends CotLuoi {
  w?: number;
  n?: boolean;
}

/** Cột Lý do chi rộng 220 và Số tiền 136 (đủ số tới chục tỷ); cột cuối (Ngày tạo) co giãn.
 *  Cột Ghi chú (chỉ để nhắc "Thiếu chứng từ gốc") gỡ 18/10/2026. */
export const COT_PHIEU_CHI: CotPhieuChi[] = [
  { key: "so", label: "Số phiếu", coDinh: true, w: 100 },
  { key: "ngay_chi", label: "Ngày chi", w: 104 },
  { key: "nguoi_nhan", label: "Người nhận tiền", w: 170 },
  { key: "ly_do", label: "Lý do chi", w: 220 },
  { key: "muc", label: "Mục chi", w: 160 },
  { key: "chi_theo", label: "Chi theo", w: 190 },
  { key: "hinh_thuc", label: "Hình thức", w: 112 },
  { key: "so_tien", label: "Số tiền", n: true, w: 136 },
  { key: "trang_thai", label: "Trạng thái", w: 112 },
  { key: "ngay_tao", label: "Ngày tạo" },
];

function OPhieuChi({ cot, row, onMoDonMua }: {
  cot: string;
  row: PaymentVoucherRow;
  onMoDonMua?: (code: string) => void;
}) {
  switch (cot) {
    case "so":
      return <td title={soPhieu(row)}>{soPhieu(row)}</td>;
    case "ngay_chi":
      return <td>{ngay(row.voucher_date)}</td>;
    case "nguoi_nhan":
      return <td title={row.supplier_name || undefined}>{row.supplier_name || "—"}</td>;
    case "ly_do":
      return <td title={row.content || undefined}>{row.content}</td>;
    case "muc":
      return row.muc_thu_chi_ten
        ? <td title={row.muc_thu_chi_ten}>{row.muc_thu_chi_ten}</td>
        : <td><span className="lds-mu">Chưa phân loại</span></td>;
    case "chi_theo": {
      const nguon = nguonPhieu(row);
      // Phiếu chi rời không có chứng từ nguồn — cột Mục đã nói nó là khoản gì, khỏi chữ "Khác".
      if (!nguon.ma && nguon.loai === "Khác") return <td />;
      // Phiếu gộp: không một mã nào đại diện được — ghi số chứng từ, chữ nổi liệt kê từng dòng.
      if (laGop(row)) {
        return (
          <td title={row.lines!.map((l) => `${tenDongChi(l)} ${soVN(l.amount)}`).join("\n")}>
            <span className="lds-tag">{nguon.loai}</span>{" "}
            <span className="lds-mu">{`${row.lines!.length} chứng từ`}</span>
          </td>
        );
      }
      return (
        <td title={[nguon.loai, nguon.ma].filter(Boolean).join(" ")}>
          <span className="lds-tag">{nguon.loai}</span>
          {nguon.ma && " "}
          {nguon.ma && (row.source_type === "purchase_request" && onMoDonMua ? (
            <button type="button" className="lds-lk"
              onClick={(e) => {
                e.stopPropagation();
                onMoDonMua(nguon.ma!);
              }}
              onKeyDown={(e) => e.stopPropagation()}>
              {nguon.ma}
            </button>
          ) : (
            <span className="lds-mu">{nguon.ma}</span>
          ))}
        </td>
      );
    }
    case "hinh_thuc":
      return <td>{VOUCHER_METHOD_LABELS[row.voucher_type]}</td>;
    case "so_tien": {
      const ngoaiTe = row.currency !== "VND"
        ? `${row.currency} ${soVN(row.amount)} tỷ giá ${soVN(row.exchange_rate)}`
        : undefined;
      return <td className="n"><span title={ngoaiTe}>{soVN(row.amount_vnd)}</span></td>;
    }
    case "trang_thai":
      return (
        <td>
          {row.status === "cancelled" ? <ChipTT mau="xam">Đã hủy</ChipTT> : <ChipTT mau="la">Đã chi</ChipTT>}
        </td>
      );
    case "ngay_tao":
      return <td className="lds-mu" title={ngayGio(row.created_at)}>{ngay(row.created_at)}</td>;
    default:
      return <td />;
  }
}

export function VouchersTable({
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
  onMoDonMua,
  trang,
  size,
  tong,
  onTrang,
  onSize,
  tongTien,
  soXong,
}: {
  /** Cột đang hiện, đã xếp theo thứ tự người xem chọn. */
  cot: CotPhieuChi[];
  /** Cấu hình lưới của màn cha — có thì ghim + kéo độ rộng được. */
  luoi?: CauHinhLuoi;
  rows: PaymentVoucherRow[];
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
  /** Có = người xem có ô Xem của màn Đơn mua hàng ⇒ mã đơn ở cột Chi theo thành nút mở đơn. */
  onMoDonMua?: (code: string) => void;
  trang: number;
  size: number;
  tong: number;
  onTrang: (n: number) => void;
  onSize: (n: number) => void;
  /** Tổng tiền phiếu đã chi theo kỳ + bộ lọc (mọi trang); null = chưa có ⇒ không vẽ dòng Cộng. */
  tongTien: number | null;
  /** Số phiếu đã chi khớp với `tongTien`; null = thẻ đang xem không có phiếu đã chi. */
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
                  <span className="lds-do" role="alert">{`Không tải được danh sách phiếu chi. ${loi}`}</span>{" "}
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
                      Chưa có phiếu chi nào trong kỳ này.
                      {onLap && (
                        <>
                          {" "}
                          <button type="button" className="lds-lk" onClick={onLap}>Lập phiếu chi</button>
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
                  {cot.map((c) => <OPhieuChi key={c.key} cot={c.key} row={row} onMoDonMua={onMoDonMua} />)}
                </tr>
              ))
            )}
            {/* Dòng Cộng: Σ tiền phiếu đã chi của MỌI phiếu khớp bộ lọc (máy chủ cộng), không chỉ trang đang xem. */}
            {rows.length > 0 && tongTien != null && soXong != null && (
              <tr className="lds-cong lds-nhom">
                {/* Cột Số tiền bị ẩn: dòng Cộng vẫn còn, tổng tiền đứng ngay sau nhãn (không mất số phiếu lẫn tiền). */}
                <td className="lead" colSpan={viTriTien > 0 ? viTriTien : cot.length}>
                  <span className="lds-dinh-trai">
                    {`Cộng ${soVN(soXong)} phiếu đã chi`}
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
          ariaLabel="Phân trang phiếu chi"
        />
      )}
    </div>
  );
}
