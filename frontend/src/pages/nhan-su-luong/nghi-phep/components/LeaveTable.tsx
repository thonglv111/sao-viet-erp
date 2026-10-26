// Bảng đơn nghỉ dùng chung cho tab "Đơn của tôi" và "Duyệt đơn"
// (tách từ pages/NghiPhepPage.tsx).
//
// 08/10/2026: lưới kiểu bảng tính `lds-g` như mọi danh sách (dòng 34px, kẻ ô, chữ thường). Thứ tự cột
// đọc theo câu hỏi của người xem: AI → nghỉ LOẠI gì, có lương không → nghỉ NGÀY nào, mấy ngày → tới
// ĐÂU rồi (trạng thái) → vì sao (lý do + ghi chú duyệt, cột co giãn ở cuối) → ngày gửi. Ngày tạo
// xuống gần cuối vì người đọc tìm đơn theo ngày NGHỈ chứ không theo lúc bấm gửi; danh sách vẫn xếp
// mới tạo nhất lên đầu (23/09/2026). Cột có khoá để tab gắn nút "Cột" (ẩn, đổi chỗ, ghim, kéo rộng).
import type { ReactNode } from "react";
import type { LeaveRequest } from "../../../../api/client";
import { EmptyRow } from "../../../../components/EmptyState";
import { ChipTT, CuonLuoi, rongLuoi, type CauHinhLuoi, type CotLuoi, type MauTT } from "../../../../components/LuoiDs";
import { RowActionButton } from "../../../../components/RowActionButton";
// `fmtDate` DÙNG CHUNG (utils/format) — bản cục bộ cũ y hệt, chép lại chỉ tạo thêm một chỗ
// phải nhớ sửa. Đừng viết lại.
import { fmtDate, fmtDateTime } from "../../../../utils/format";
import { dangXinHuy, homNayYmd, XinHuyNhan } from "../../xin-huy/XinHuy";

/** Chip trạng thái — cùng sắc với chấm của hàng lọc nhanh (`mucLocNhanh`). */
const TT: Record<string, [string, MauTT]> = {
  pending: ["Chờ duyệt", "vang"],
  approved: ["Đã duyệt", "la"],
  rejected: ["Từ chối", "do"],
  cancelled: ["Đã hủy", "xam"],
};

/** "30/9/2026" khi nghỉ một ngày, "28/9 – 30/9/2026" khi cùng năm, đủ hai ngày khi khác năm. */
function ngayNghi(tu: string, den: string): string {
  if (tu === den) return fmtDate(tu);
  if (tu.slice(0, 4) === den.slice(0, 4)) return `${fmtDate(tu).replace(/\/\d{4}$/, "")} – ${fmtDate(den)}`;
  return `${fmtDate(tu)} – ${fmtDate(den)}`;
}

// --- Shared table -----------------------------------------------------------

export type CotDonNghi = CotLuoi & { w?: number; n?: boolean };

/** Cột của bảng đơn nghỉ — tab gọi để dựng nút "Cột" (cùng bộ cột với bảng). Ô chọn, Nhân viên và
 *  cột nút là cột cố định (không ẩn được); Nhân viên đứng đầu nên được ghim khi cuộn ngang. */
export function cotDonNghi({ selectable, showEmployee, nguoiDuyet }: {
  selectable?: boolean;
  showEmployee: boolean;
  /** Người duyệt có tới 2 nút trên một dòng (Duyệt + Từ chối), người gửi tối đa 1. */
  nguoiDuyet?: boolean;
}): CotDonNghi[] {
  return [
    ...(selectable ? [{ key: "chon", label: "Chọn", coDinh: true, w: 40 }] : []),
    ...(showEmployee ? [{ key: "nv", label: "Nhân viên", coDinh: true, w: 190 }] : []),
    { key: "loai", label: "Loại nghỉ", w: 180 },
    { key: "luong", label: "Lương", w: 112 },
    { key: "ngay", label: "Ngày nghỉ", w: 150 },
    { key: "so_ngay", label: "Số ngày", n: true, w: 84 },
    { key: "tt", label: "Trạng thái", w: 150 },
    { key: "duyet", label: "NV duyệt", w: 150 },
    { key: "ly_do", label: "Lý do" }, // co giãn
    { key: "tao", label: "Ngày tạo", w: 108 },
    { key: "nut", label: "Thao tác", coDinh: true, w: nguoiDuyet ? 76 : 48 },
  ];
}

export function LeaveTable({ items, showEmployee, onCancel, onApprove, onReject,
  onXinHuy, onRutLaiXinHuy, onHuyDaDuyet,
  selectable, selected, onToggle, onToggleAll, allPendingCount, onRowClick,
  loading, listError, onRetry, emptyTitle, emptySub, chan, luoi }: {
  items: LeaveRequest[]; showEmployee: boolean;
  /** Hủy THẲNG — chỉ đơn ĐANG CHỜ (đơn đã duyệt thì người lao động phải xin hủy, 23/09/2026). */
  onCancel?: (id: number) => void; onApprove?: (id: number) => void; onReject?: (r: LeaveRequest) => void;
  /** Người lao động XIN hủy đơn ĐÃ DUYỆT chưa qua. */
  onXinHuy?: (r: LeaveRequest) => void;
  /** Rút lại yêu cầu hủy đang chờ. */
  onRutLaiXinHuy?: (r: LeaveRequest) => void;
  /** Người duyệt hủy thẳng đơn ĐÃ DUYỆT (phải ghi lý do). */
  onHuyDaDuyet?: (r: LeaveRequest) => void;
  selectable?: boolean; selected?: Set<number>; onToggle?: (id: number) => void;
  onToggleAll?: () => void; allPendingCount?: number;
  onRowClick?: (r: LeaveRequest) => void;
  /** Ba ca rỗng phải do NƠI GỌI cấp: bảng này không tự gọi máy chủ nên không tự biết
   *  đang tải hay gọi hỏng. `listError` CHỈ nhận lỗi TẢI DANH SÁCH — đừng truyền lỗi
   *  duyệt/từ chối vào đây, không thì một lần bấm hỏng là mất cả bảng. */
  loading?: boolean; listError?: string | null; onRetry?: () => void;
  emptyTitle?: string; emptySub?: string;
  /** Chân bảng (phân trang) — nằm TRONG khung lưới như mọi danh sách. */
  chan?: ReactNode;
  /** Cấu hình lưới của tab (nút "Cột") — có thì ẩn / đổi chỗ / ghim / kéo độ rộng được. */
  luoi?: CauHinhLuoi;
}) {
  const allChecked = !!allPendingCount && selected?.size === allPendingCount;
  const homNay = homNayYmd();
  const goc = cotDonNghi({ selectable, showEmployee, nguoiDuyet: !!(onApprove || onReject) });
  const cot = luoi ? luoi.rongHien(luoi.xep(goc).filter((c) => !luoi.an.has(c.key))) : goc;
  const cols = cot.length;

  /** Ô của một đơn theo khoá cột. */
  const o = (key: string, r: LeaveRequest, tick: boolean, ten: string, nhanTT: string, mauTT: MauTT) => {
    switch (key) {
      case "chon":
        return (
          <td key={key} className="c" onClick={(e) => e.stopPropagation()}>
            {r.status === "pending" && r.duyet_duoc !== false && <input type="checkbox" checked={tick} onChange={() => onToggle?.(r.id)} aria-label={`Chọn đơn của ${ten}`} />}
          </td>
        );
      case "nv":
        return <td key={key} title={ten}>{ten}</td>;
      case "loai":
        return <td key={key} title={r.leave_type_name ?? undefined}>{r.leave_type_name ?? "—"}</td>;
      case "luong":
        return <td key={key}>{r.is_paid === false ? <ChipTT mau="xam">Không lương</ChipTT> : <ChipTT mau="la">Có lương</ChipTT>}</td>;
      case "ngay":
        return <td key={key} title={`${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}`}>{ngayNghi(r.start_date, r.end_date)}</td>;
      case "so_ngay":
        return <td key={key} className="n">{r.days} ngày</td>;
      case "tt":
        return (
          <td key={key} className="np-don__tt">
            <ChipTT mau={mauTT}>{nhanTT}</ChipTT>
            <XinHuyNhan yc={r.yeu_cau_huy} />
          </td>
        );
      case "duyet":
        // Người duyệt hoặc từ chối; đơn đang chờ thì trống. Rê chuột xem giờ quyết.
        return (
          <td key={key} title={r.decided_at ? `${r.status === "rejected" ? "Từ chối" : "Duyệt"} lúc ${fmtDateTime(r.decided_at)}` : undefined}>
            {r.decided_by_name ?? <span className="lds-mu3">—</span>}
          </td>
        );
      case "ly_do":
        // Lý do + ghi chú của người duyệt cùng một ô (ghi chú chữ mờ đứng sau), rê chuột xem đủ.
        return (
          <td key={key} title={[r.reason, r.decision_note && `Ghi chú duyệt: ${r.decision_note}`].filter(Boolean).join("\n") || undefined}>
            {r.reason || <span className="lds-mu3">—</span>}
            {r.decision_note && <span className="np-don__ghi-chu">{r.decision_note}</span>}
          </td>
        );
      case "tao":
        return <td key={key} className="lds-mu" title={fmtDateTime(r.created_at)}>{r.created_at ? fmtDate(r.created_at) : "—"}</td>;
      case "nut":
        return (
          <td key={key} className="lds-nut" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {/* GIỮ `danger` cho Từ chối / Hủy: cả hai đều là quyết định người khác nhận được
                ngay, mất tín hiệu đỏ là bấm nhầm ô bên cạnh. */}
            <div className="np-don__nut">
              {onApprove && r.status === "pending" && r.duyet_duoc !== false && (
                <RowActionButton dense label="Duyệt" icon="check" onClick={() => onApprove(r.id)} />
              )}
              {onReject && r.status === "pending" && r.duyet_duoc !== false && (
                <RowActionButton dense danger label="Từ chối" icon="ban" onClick={() => onReject(r)} />
              )}
              {onCancel && r.status === "pending" && (
                <RowActionButton dense danger label="Hủy đơn" icon="x" onClick={() => onCancel(r.id)} />
              )}
              {/* Đơn ĐÃ DUYỆT (23/09/2026): người lao động chỉ XIN hủy, và chỉ khi đơn chưa qua
                  hết; người duyệt quyết. Đang có yêu cầu chờ thì thay bằng nút Rút lại. */}
              {onXinHuy && r.status === "approved" && !dangXinHuy(r.yeu_cau_huy) && r.end_date >= homNay && (
                <RowActionButton dense danger label="Xin hủy đơn" icon="x" onClick={() => onXinHuy(r)} />
              )}
              {onRutLaiXinHuy && r.status === "approved" && dangXinHuy(r.yeu_cau_huy) && (
                <RowActionButton dense label="Rút lại yêu cầu hủy" icon="rotateCcw" onClick={() => onRutLaiXinHuy(r)} />
              )}
              {onHuyDaDuyet && r.status === "approved" && (
                <RowActionButton dense danger label="Hủy đơn đã duyệt" icon="x" onClick={() => onHuyDaDuyet(r)} />
              )}
            </div>
          </td>
        );
      default:
        return <td key={key} />;
    }
  };

  return (
    <div className="lds-sheet">
      <CuonLuoi ghim={luoi?.soGhim(cot)}>
        <table className="lds-g np-don" style={{ minWidth: rongLuoi(cot, 140) }}>
          <colgroup>
            {cot.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
          </colgroup>
          <thead>
            <tr>
              {cot.map((c) =>
                c.key === "chon" ? (
                  <th key={c.key} className="c"><input type="checkbox" checked={allChecked} onChange={onToggleAll} title="Chọn tất cả đơn chờ" aria-label="Chọn tất cả đơn chờ duyệt" /></th>
                ) : (
                  <th key={c.key} className={c.n ? "n" : undefined} aria-label={c.key === "nut" ? "Thao tác" : undefined}>
                    {c.key === "nut" ? null : c.label}
                    {luoi?.keo(c.key)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {loading && <EmptyRow colSpan={cols} trangThai="dang-tai" />}
            {!loading && listError && (
              <EmptyRow colSpan={cols} trangThai="loi" loi={listError} onThuLai={onRetry} />
            )}
            {!loading && !listError && items.map((r) => {
              const tick = selected?.has(r.id) ?? false;
              const [nhanTT, mauTT] = TT[r.status] ?? [r.status, "xam" as MauTT];
              const ten = r.employee_name ?? `NV#${r.employee_id}`;
              return (
                <tr key={r.id} className={`lds-dong${tick ? " is-tick" : ""}`} tabIndex={0}
                  onClick={() => onRowClick?.(r)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                      e.preventDefault();
                      onRowClick?.(r);
                    }
                  }}>
                  {cot.map((c) => o(c.key, r, tick, ten, nhanTT, mauTT))}
                </tr>
              );
            })}
            {!loading && !listError && items.length === 0 && (
              <EmptyRow
                colSpan={cols}
                icon="calendar"
                title={emptyTitle ?? "Chưa có đơn xin nghỉ phép nào"}
                sub={emptySub ?? "Bấm “Xin nghỉ phép” để gửi đơn đầu tiên."}
              />
            )}
          </tbody>
        </table>
      </CuonLuoi>
      {chan}
    </div>
  );
}
