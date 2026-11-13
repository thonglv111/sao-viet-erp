// Lưới danh sách nhà cung cấp — khuôn bảng tính `lds-sheet` của các danh sách Kinh doanh (07/10/2026),
// bọc `CuonLuoi` (tiêu đề bám khi cuộn trang, cột tên ghim khi cuộn ngang), cột ẩn/hiện + kéo đổi chỗ:
// dòng 34px một dòng chữ, cột kẻ mảnh, chữ dài cắt "…" (rê chuột xem đủ). Bấm dòng mở hồ sơ.
// Giữ các biểu tượng làm việc của bản cũ: thẻ "N mặt hàng" rê chuột hiện bảng giá xem nhanh, điện
// thoại bấm là gọi, mã số thuế có nút chép (hiện khi rê dòng), đánh giá = ngôi sao + điểm và thẻ
// đồng hồ "đúng hẹn x/y" tô màu theo tỷ lệ. Email, địa chỉ, điều khoản nằm trong hồ sơ.
import { useEffect, useRef, useState, type Dispatch, type MouseEvent, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Clock, Copy, Package, Phone, Star } from "lucide-react";
import type { SupplierRow } from "../../../../api/client";
import { EmptyRow } from "../../../../components/EmptyState";
import { CuonLuoi, ChipTT, rongLuoi, soCotGhim, tenKhachGon, type CauHinhLuoi, type CotLuoi } from "../../../../components/LuoiDs";
import { PhanTrangDayDu } from "../../../../components/PhanTrangDayDu";
import { soNgayVi } from "../shared/helpers";
import { ttNcc } from "../shared/trang-thai-ncc";
import { tenDonVi, useNapTenDonVi } from "../../../tenDonVi";
import type { SortNcc } from "../shared/types";

/** Mốc giờ máy chủ → Date; chuỗi không múi (SQLite) coi là UTC. */
function docMoc(iso: string): Date {
  return new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) || !iso.includes("T") ? iso : `${iso}Z`);
}
/** Cột Ngày tạo: "06/10/2026" theo giờ VN; title của ô mang đủ giờ. */
function ngayTao(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = docMoc(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });
}
function gioTao(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = docMoc(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}

const soSao = (v: number) => v.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Thẻ "N mặt hàng" + bảng giá xem nhanh khi rê chuột / Tab tới (như bản cũ). Thẻ nổi vẽ qua portal
 * với toạ độ cố định: ô lưới cắt chữ (`overflow: hidden`) nên đặt trong ô là bị xén. Gần đáy màn
 * thì lật lên. Rời chuột có 150ms để kịp đưa chuột vào thẻ bấm "Xem tất cả".
 */
function ChipMatHang({ row, moBangGia }: { row: SupplierRow; moBangGia: () => void }) {
  const nut = useRef<HTMLButtonElement | null>(null);
  const hen = useRef<number | undefined>(undefined);
  const [vt, setVt] = useState<{ x: number; y: number; len: boolean } | null>(null);
  const mo = () => {
    window.clearTimeout(hen.current);
    const r = nut.current?.getBoundingClientRect();
    if (!r) return;
    const len = window.innerHeight - r.bottom < 230;
    setVt({ x: Math.max(8, Math.min(r.left, window.innerWidth - 300)), y: len ? r.top - 6 : r.bottom + 6, len });
  };
  const dong = () => {
    window.clearTimeout(hen.current);
    hen.current = window.setTimeout(() => setVt(null), 150);
  };
  useEffect(() => () => window.clearTimeout(hen.current), []);
  // Cuộn trang thì thẻ (toạ độ cố định) sẽ lệch khỏi nút ⇒ đóng luôn.
  useEffect(() => {
    if (!vt) return;
    const tat = () => setVt(null);
    window.addEventListener("scroll", tat, true);
    return () => window.removeEventListener("scroll", tat, true);
  }, [vt]);
  return (
    <>
      <button
        ref={nut}
        type="button"
        className="ncc-mh"
        aria-label={`Xem bảng giá ${row.items.length} mặt hàng của ${row.name}`}
        onMouseEnter={mo}
        onMouseLeave={dong}
        onFocus={mo}
        onBlur={dong}
        onClick={(e) => {
          e.stopPropagation();
          moBangGia();
        }}
      >
        <Package size={13} strokeWidth={1.8} aria-hidden="true" />
        {row.items.length} mặt hàng
      </button>
      {vt &&
        createPortal(
          <div
            className={`ncc-mh-the${vt.len ? " is-len" : ""}`}
            role="tooltip"
            style={{ left: vt.x, top: vt.y }}
            onMouseEnter={() => window.clearTimeout(hen.current)}
            onMouseLeave={dong}
          >
            <div className="ncc-mh-the__dau">Bảng giá</div>
            {row.items.slice(0, 5).map((it, i) => (
              <div key={i} className="ncc-mh-the__dong">
                <span title={it.item_name}>{it.item_name}</span>
                <span>
                  {it.unit_price.toLocaleString("vi-VN")} đ<small>/{tenDonVi(it.unit) ?? it.unit}</small>
                </span>
              </div>
            ))}
            <button
              type="button"
              className="ncc-mh-the__xem"
              onClick={() => {
                setVt(null);
                moBangGia();
              }}
            >
              {row.items.length > 5 ? `Xem tất cả ${row.items.length} mặt hàng` : "Mở bảng giá"}
              <ChevronRight size={13} aria-hidden="true" />
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Nút sao chép nhỏ — hiện khi rê vào dòng. */
function NutChep({ text, nhan }: { text: string; nhan: string }) {
  const [xong, setXong] = useState(false);
  function chep(e: MouseEvent) {
    e.stopPropagation();
    void navigator.clipboard?.writeText(text);
    setXong(true);
    window.setTimeout(() => setXong(false), 1500);
  }
  return (
    <button
      type="button"
      className={`ncc-chep${xong ? " is-xong" : ""}`}
      onClick={chep}
      title={xong ? "Đã sao chép" : `Sao chép ${nhan}`}
      aria-label={`Sao chép ${nhan}`}
    >
      {xong ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
    </button>
  );
}

/** Ô đánh giá: ngôi sao + điểm, cạnh là thẻ đồng hồ "x/y đúng hẹn" tô theo tỷ lệ. */
function ODanhGia({ row }: { row: SupplierRow }) {
  if (row.rating === null) {
    return (
      <span className="ncc-sao ncc-sao--trong" title="Điểm và tỷ lệ đúng hẹn tự tính sau khi đơn mua đầu tiên hoàn tất.">
        <Star size={13} strokeWidth={1.8} aria-hidden="true" />
        Chưa có đơn
      </span>
    );
  }
  const tyLe = row.rating_count > 0 ? row.on_time_count / row.rating_count : 1;
  const mau = tyLe >= 0.8 ? "la" : tyLe >= 0.6 ? "vang" : "do";
  return (
    <span className="ncc-dg">
      <span className="ncc-sao" title={`${soSao(row.rating)} trên 5 sao, chấm trên ${row.rating_count} đơn`}>
        <Star size={13} strokeWidth={1.8} aria-hidden="true" />
        {soSao(row.rating)}
      </span>
      <span
        className={`ncc-dh ncc-dh--${mau}`}
        title={
          row.late_count > 0
            ? `Đúng hẹn ${row.on_time_count} trên ${row.rating_count} đơn, trễ trung bình ${soNgayVi(row.avg_late_days)} ngày`
            : `Đúng hẹn ${row.on_time_count} trên ${row.rating_count} đơn`
        }
      >
        <Clock size={12} strokeWidth={2} aria-hidden="true" />
        {row.on_time_count}/{row.rating_count}
      </span>
    </span>
  );
}

interface CotNcc extends CotLuoi {
  w?: number;
}
/** Thứ tự mặc định: tên (cố định) → Ngày tạo → nhóm hàng → thuế → liên hệ → điện thoại → mặt hàng →
 *  đánh giá → trạng thái. Tên là cột co giãn nên không đặt `w`. */
export const COT_NCC: CotNcc[] = [
  { key: "ten", label: "Nhà cung cấp", coDinh: true },
  { key: "ngay", label: "Ngày tạo", w: 104 },
  { key: "nhom", label: "Nhóm hàng", w: 100 },
  { key: "mst", label: "Mã số thuế", w: 132 },
  { key: "lienhe", label: "Người liên hệ", w: 128 },
  { key: "dt", label: "Điện thoại", w: 128 },
  { key: "mh", label: "Mặt hàng", w: 124 },
  { key: "dg", label: "Đánh giá", w: 120 },
  { key: "tt", label: "Trạng thái", w: 120 },
];

/** Bề rộng tối thiểu của cột tên (cột co giãn) khi tính `minWidth` của lưới. */
const RONG_TEN = 240;

function ONcc({ cot, row, moBangGia }: { cot: string; row: SupplierRow; moBangGia: () => void }) {
  switch (cot) {
    case "ten":
      return (
        <td title={row.name}>
          {/* Tên co lại (cắt "…") trước, thẻ Nhận gia công đứng yên ở cuối ô. */}
          <span className="ncc-ten">
            <span>{tenKhachGon(row.name)}</span>
            {/* Hộp Gia công trọn gói của lệnh chỉ cho chọn đúng những NCC có cờ này. */}
            {row.nhan_gia_cong && (
              <span className="lds-tag" title="Hiện trong ô chọn nơi làm của công đoạn thuê ngoài">
                Nhận gia công
              </span>
            )}
          </span>
        </td>
      );
    case "ngay":
      return <td title={gioTao(row.created_at)}>{ngayTao(row.created_at)}</td>;
    case "nhom":
      return <td title={row.supplier_group ?? undefined}>{row.supplier_group || <span className="lds-mu3">Chưa khai</span>}</td>;
    case "mst":
      return (
        <td>
          {row.tax_code ? (
            <span className="ncc-o-chep">
              {row.tax_code}
              <NutChep text={row.tax_code} nhan="mã số thuế" />
            </span>
          ) : (
            <span className="lds-mu3">Chưa có</span>
          )}
        </td>
      );
    case "lienhe":
      return <td title={row.contact_name ?? undefined}>{row.contact_name || <span className="lds-mu3">Chưa khai</span>}</td>;
    case "dt":
      return (
        <td onClick={(e) => e.stopPropagation()}>
          {row.phone ? (
            <a className="ncc-dt" href={`tel:${row.phone}`} title={`Gọi ${row.phone}`}>
              <Phone size={12} strokeWidth={1.8} aria-hidden="true" />
              {row.phone}
            </a>
          ) : (
            <span className="lds-mu3">Chưa khai</span>
          )}
        </td>
      );
    case "mh":
      return (
        <td onClick={(e) => e.stopPropagation()}>
          {row.items.length > 0 ? <ChipMatHang row={row} moBangGia={moBangGia} /> : <span className="lds-mu3">Chưa báo giá</span>}
        </td>
      );
    case "dg":
      return (
        <td>
          <ODanhGia row={row} />
        </td>
      );
    default: {
      const tt = ttNcc(row.status);
      return (
        <td>
          <ChipTT mau={tt.mau}>{tt.label}</ChipTT>
        </td>
      );
    }
  }
}

export function SuppliersTable({
  loading,
  listError,
  load,
  rows,
  openEdit,
  chonId,
  sort,
  setSort,
  coLoc,
  onXoaLoc,
  total,
  page,
  setPage,
  size,
  onSize,
  cotHien,
  luoi,
}: {
  loading: boolean;
  listError: string | null;
  load: () => void;
  rows: SupplierRow[];
  openEdit: (row: SupplierRow, tab?: "info" | "items" | "history") => void;
  /** NCC đang mở ở ngăn — dòng viền đủ bốn cạnh. */
  chonId: number | null;
  sort: SortNcc;
  setSort: Dispatch<SetStateAction<SortNcc>>;
  coLoc: boolean;
  onXoaLoc: () => void;
  total: number;
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  size: number;
  onSize: (size: number) => void;
  /** Cột đang hiện theo thứ tự người xem đã chọn (`COT_NCC` sau `xepCot` + lọc cột ẩn). */
  cotHien: CotNcc[];
  /** Cấu hình lưới của màn cha — có thì ghim + kéo độ rộng được. */
  luoi?: CauHinhLuoi;
}) {
  // Tên đơn vị cho bảng giá xem nhanh ("đ/tờ" chứ không "đ/to").
  useNapTenDonVi();
  const sortSao = sort === "rating" || sort === "-rating";
  function doiSortSao() {
    setSort(sort === "-rating" ? "rating" : sort === "rating" ? "name" : "-rating");
    setPage(1);
  }
  const soCot = cotHien.length;

  return (
    <section className="lds-sheet">
      <CuonLuoi ghim={soCotGhim(cotHien, luoi?.ghim)}>
        <table className="lds-g ncc-g" style={{ minWidth: rongLuoi(cotHien, RONG_TEN) }}>
          <colgroup>
            {cotHien.map((c) => (
              <col key={c.key} style={c.w ? { width: c.w } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {cotHien.map((c) =>
                c.key === "dg" ? (
                  <th key={c.key} aria-sort={sort === "-rating" ? "descending" : sort === "rating" ? "ascending" : "none"}>
                    <button type="button" className={`lds-sx${sortSao ? " on" : ""}`} onClick={doiSortSao} title="Xếp theo sao đánh giá">
                      {c.label}
                      {sortSao ? <span aria-hidden="true">{sort === "rating" ? "↑" : "↓"}</span> : null}
                    </button>
                    {luoi?.keo(c.key)}
                  </th>
                ) : (
                  <th key={c.key}>{c.label}{luoi?.keo(c.key)}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <EmptyRow colSpan={soCot} trangThai="dang-tai" />
            ) : listError ? (
              <EmptyRow colSpan={soCot} trangThai="loi" loi={listError} onThuLai={load} />
            ) : rows.length === 0 ? (
              <EmptyRow
                colSpan={soCot}
                icon="truck"
                title={coLoc ? "Không có nhà cung cấp nào khớp" : "Chưa có nhà cung cấp nào"}
                sub={coLoc ? "Thử bỏ bớt bộ lọc hoặc xoá từ khoá tìm kiếm." : "Khai nhà cung cấp trước, rồi mới khai bảng giá vật tư của họ."}
                action={
                  coLoc ? (
                    <button type="button" className="btn btn--ghost" onClick={onXoaLoc}>
                      Xoá bộ lọc
                    </button>
                  ) : undefined
                }
              />
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={`lds-dong${chonId === row.id ? " is-chon" : ""}`}
                  tabIndex={0}
                  onClick={() => openEdit(row, "info")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) openEdit(row, "info");
                  }}
                >
                  {cotHien.map((c) => (
                    <ONcc key={c.key} cot={c.key} row={row} moBangGia={() => openEdit(row, "items")} />
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CuonLuoi>
      {total > 0 && (
        <PhanTrangDayDu
          trang={page}
          size={size}
          tong={total}
          soDong={rows.length}
          onTrang={setPage}
          onSize={onSize}
          loading={loading}
          donVi="nhà cung cấp"
          ariaLabel="Phân trang nhà cung cấp"
        />
      )}
    </section>
  );
}
