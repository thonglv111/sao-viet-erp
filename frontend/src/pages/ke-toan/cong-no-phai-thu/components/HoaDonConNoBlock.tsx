// Tab "Còn nợ" của ngăn Công nợ phải thu — kiểu 3 (docs/mockups/ke-toan-gon-3-phuong-an.html, 07/10/2026):
// MỘT lưới `.lds-g` (khung `.lds-bang`) các hoá đơn bán CÒN nợ.
//
// Mỗi dòng giữ nút "Thu" riêng (ngăn chồng `ThuTienHoaDon`). Tick nhiều hoá đơn (17/10/2026: "một phiếu
// cho cả lượt") ⇒ chân ngăn "Lập một phiếu thu" mở form gộp. Ô tick nằm TRONG ô Số hoá đơn — thêm cột
// riêng thì bảng tràn khung ngăn 820px.
//
// Hàng đầu: "Nhóm theo đơn bán" + nhóm nút "Đơn bán | Hạn thu".
// - Đơn bán: dòng nhóm (mã đơn mở Đơn hàng bán, "N hoá đơn" mờ, 4 ô tổng) rồi các hoá đơn của đơn.
// - Hạn thu: bỏ dòng nhóm, xếp hoá đơn theo hạn thu tăng dần, hoá đơn chưa có hạn ở cuối; mã đơn bán
//   có cột riêng sau Ký hiệu.
// Cột: Số hoá đơn | Ký hiệu (tách cột 13/10/2026) | [Đơn bán khi xếp theo hạn] | Ngày | Hạn thu | Giá trị | Trừ cọc | Đã thu | Còn nợ | nút. Trừ cọc
// (`deposit_offset_amount`) và Đã thu (`direct_received_amount`) là HAI cột — cọc không phải tiền thu
// trong đợt này. Tiền đã trả khách ngoài đơn được cộng nợ lại (`hoan_khong_don`, 17/10/2026) là DÒNG PHỤ ngay
// dưới hoá đơn đó, số nằm ở cột Giá trị — không chiếm cột riêng (cột riêng làm bảng tràn khung ngăn). Dòng
// nhóm và dòng Cộng cộng cả dòng phụ vào Giá trị, nên mỗi dòng tổng vẫn Giá trị − Trừ cọc − Đã thu = Còn nợ.
// Khách chưa đặt cho nợ thì Hạn thu là gạch mờ: cột thuộc tính đã nói "chưa đặt", không lặp chữ ở từng
// dòng. Dòng Cộng cuối bảng.
//
// Bề rộng: xem `rong` trong thân (đo font thật 08/10, siết lại 17/10); Hoá đơn co giãn có chỗ tối thiểu. Khung
// cột trái của ngăn ở độ rộng mặc định là 820px; hẹp hơn tổng tối thiểu thì khung `.lds-bang` cuộn ngang.
import { Fragment, useState, type ReactNode } from "react";

import type { ReceivableItemRow } from "../../../../api/client";
import { ngay, vietSo } from "../../shared/dinhDang";
import { soNgay } from "../../../../utils/ky";
import { chuHanDu, HangXep, OTien } from "../../shared/NganCongNo";

type Xep = "don" | "han";

const CO_GIAN = 84;

type CotTien = "amount" | "hoan_khong_don" | "deposit_offset_amount" | "direct_received_amount" | "remaining_amount";

const cong = (ds: ReceivableItemRow[], k: CotTien) => ds.reduce((s, r) => s + (r[k] ?? 0), 0);
/** Giá trị của dòng tổng = giá trị hoá đơn + các dòng phụ trả lại ngoài đơn nằm trong cùng cột. */
const congGiaTri = (ds: ReceivableItemRow[]) => cong(ds, "amount") + cong(ds, "hoan_khong_don");

function OHanThu({ row, homNay, khachChuaDatHan }: { row: ReceivableItemRow; homNay: string; khachChuaDatHan: boolean }) {
  // Ô chỉ ghi ngày, màu nói tình trạng: đỏ = trễ, vàng = tới hạn hôm nay. Số ngày còn/trễ ở `title` của ô
  // (`chuHanDu`) — bỏ chữ "còn 14"/"trễ 81" khỏi ô để bảng vừa khung ngăn (17/10/2026).
  if (row.due_date && !row.chua_dat_han) {
    const d = soNgay(homNay, row.due_date);
    return <span className={d < 0 ? "lds-do" : d === 0 ? "lds-vang" : undefined}>{ngay(row.due_date)}</span>;
  }
  return <span className="lds-mu3">{khachChuaDatHan ? "–" : "chưa đặt hạn"}</span>;
}

export function HoaDonConNoBlock({
  items,
  homNay,
  khachChuaDatHan,
  dangLoc,
  coThu,
  onThu,
  onMoDon,
  chon,
  onChon,
}: {
  /** Hoá đơn đang hiện (đã lọc), giữ thứ tự máy chủ. */
  items: ReceivableItemRow[];
  /** Ngày máy chủ tính nợ — mốc của "còn N ngày". */
  homNay: string;
  /** Khách chưa đặt số ngày cho nợ (`payment_term_days` null). */
  khachChuaDatHan: boolean;
  /** Đang lọc ⇒ câu "rỗng" nói về bộ lọc. */
  dangLoc: boolean;
  /** Có quyền lập phiếu thu ⇒ có nút "Thu". */
  coThu: boolean;
  /** Bấm "Thu" ⇒ ngăn chồng thu tiền hoá đơn này. */
  onThu: (item: ReceivableItemRow) => void;
  /** Không có = không có quyền xem Đơn hàng bán ⇒ mã đơn là chữ thường. */
  onMoDon?: (orderId: number) => void;
  /** Hoá đơn đã tick (invoice_id). Không có `onChon` = không có ô tick. */
  chon?: Set<number>;
  onChon?: (chon: Set<number>) => void;
}) {
  const [xep, setXep] = useState<Xep>("don");

  if (items.length === 0) {
    return <p className="kt-mo">{dangLoc ? "Không có hoá đơn nào còn nợ ở mục này." : "Không còn hoá đơn nào nợ."}</p>;
  }

  // Đo 08/10 với đệm ô 9px: ngày 82px ⇒ 102; nút Thu 62 ⇒ 64; Hạn thu gọn ("còn 14") 152; Trừ cọc 92 (đủ
  // 99 triệu), Giá trị / Đã thu 100 (đủ trăm triệu), Còn nợ 112. Lưới lds-g đệm ô 10px ⇒ mỗi cột +2px (nút
  // Thu giữ 64: ô nút đệm 8px). Số hoá đơn co giãn; mã đơn 96.
  // Siết 17/10 cho vừa khung 820px (đo chữ thật trên ngăn): bảng này đệm ô 8px (`.kt-ncn-conno`); Hạn thu chỉ
  // còn ngày ("28/08/2026" 81 ⇒ 98, nới 102 cho "chưa đặt hạn" 84 + viền); tiêu đề "Số hoá đơn" 67 ⇒ 84; Ký hiệu
  // ("1C26TSV") 58 ⇒ 76; tiền giữ đúng sức chứa cũ (Giá trị / Đã thu / Còn nợ ~82px chữ, Trừ cọc ~74px). Tổng 808px.
  const theoHan = xep === "han";
  const rong: (number | null)[] = [null, 76, ...(theoHan ? [96] : []), 98, 102, 98, 90, 98, 98, ...(coThu ? [64] : [])];
  // Ô nhãn của dòng nhóm / dòng Cộng trải hết các cột trước Giá trị: Số, Ký hiệu, [Đơn bán], Ngày, Hạn thu.
  const cotDau = theoHan ? 5 : 4;
  const toiThieu = rong.reduce<number>((t, w) => t + (w ?? CO_GIAN), 0);

  // Xếp theo hạn thì không còn dòng nhóm: mã đơn bán có cột riêng.
  const dong = (row: ReceivableItemRow) => (
    <Fragment key={row.invoice_id}>
      <tr>
        <td title={row.invoice_number}>
          {onChon && row.remaining_amount > 0 ? (
            <label className="kt-gop-trong">
              <input type="checkbox" aria-label={`Chọn hoá đơn số ${row.invoice_number}`}
                checked={chon?.has(row.invoice_id) ?? false}
                onChange={() => {
                  const moi = new Set(chon);
                  if (moi.has(row.invoice_id)) moi.delete(row.invoice_id);
                  else moi.add(row.invoice_id);
                  onChon(moi);
                }} />
              {row.invoice_number}
            </label>
          ) : (
            row.invoice_number
          )}
        </td>
        <td className="lds-mu">{row.invoice_symbol}</td>
        {theoHan && <td>{row.order_code}</td>}
        <td>{ngay(row.invoice_date)}</td>
        <td title={row.due_date && !row.chua_dat_han ? chuHanDu(row.due_date, homNay) : undefined}>
          <OHanThu row={row} homNay={homNay} khachChuaDatHan={khachChuaDatHan} />
        </td>
        <td className="n">{vietSo(row.amount)}</td>
        <td className="n"><OTien so={row.deposit_offset_amount} /></td>
        <td className="n"><OTien so={row.direct_received_amount} /></td>
        <td className="n"><OTien so={row.remaining_amount} /></td>
        {coThu && (
          <td className="lds-nut">
            {row.remaining_amount > 0 && (
              <button type="button" className="kt-btn kt-btn--nho" aria-label={`Thu tiền hoá đơn số ${row.invoice_number}`}
                onClick={() => onThu(row)}>
                Thu
              </button>
            )}
          </td>
        )}
      </tr>
      {(row.hoan_khong_don ?? 0) > 0 && (
        <tr className="kt-ncn-phu" title="Tiền đã trả lại khách ngoài đơn, cộng nợ lại vào hoá đơn hạn muộn nhất">
          <td colSpan={cotDau} className="lds-mu">Trả lại khách ngoài đơn</td>
          <td className="n">{`+${vietSo(row.hoan_khong_don ?? 0)}`}</td>
          <td /><td /><td />
          {coThu && <td />}
        </tr>
      )}
    </Fragment>
  );

  let than: ReactNode;
  if (theoHan) {
    const ds = [...items].sort((a, b) =>
      a.due_date === b.due_date ? 0 : a.due_date == null ? 1 : b.due_date == null ? -1 : a.due_date < b.due_date ? -1 : 1);
    than = ds.map(dong);
  } else {
    // Gom theo đơn bán, giữ thứ tự máy chủ (đơn xuất hiện trước đứng trước).
    const nhom = new Map<number, { code: string; ds: ReceivableItemRow[] }>();
    for (const row of items) {
      const g = nhom.get(row.order_id) ?? { code: row.order_code, ds: [] };
      g.ds.push(row);
      nhom.set(row.order_id, g);
    }
    than = [...nhom.entries()].map(([orderId, g]) => (
      <Fragment key={orderId}>
        <tr className="lds-cong lds-nhom">
          <td colSpan={cotDau} title={`${g.code} ${vietSo(g.ds.length)} hoá đơn`}>
            <span className="lds-dinh-trai">
              {onMoDon ? (
                <button type="button" className="kt-lk" onClick={() => onMoDon(orderId)}>{g.code}</button>
              ) : (
                <span>{g.code}</span>
              )}
              <span className="lds-mu kt-ncn-ben">{`${vietSo(g.ds.length)} hoá đơn`}</span>
            </span>
          </td>
          <td className="n">{vietSo(congGiaTri(g.ds))}</td>
          <td className="n"><OTien so={cong(g.ds, "deposit_offset_amount")} /></td>
          <td className="n"><OTien so={cong(g.ds, "direct_received_amount")} /></td>
          <td className="n"><OTien so={cong(g.ds, "remaining_amount")} /></td>
          {coThu && <td />}
        </tr>
        {g.ds.map(dong)}
      </Fragment>
    ));
  }

  return (
    <>
      <HangXep<Xep>
        chu={xep === "don" ? "Nhóm theo đơn bán" : "Xếp theo hạn thu, sớm nhất trên cùng"}
        giaTri={xep}
        luaChon={[["don", "Đơn bán"], ["han", "Hạn thu"]]}
        onDoi={setXep}
      />
      <div className="lds-bang">
        <table className="lds-g kt-ncn-conno" style={{ minWidth: toiThieu }} aria-label="Hoá đơn còn nợ">
          <colgroup>
            {rong.map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}
          </colgroup>
          <thead>
            <tr>
              <th>Số hoá đơn</th>
              <th>Ký hiệu</th>
              {theoHan && <th>Đơn bán</th>}
              <th>Ngày</th>
              <th>Hạn thu</th>
              <th className="n">Giá trị</th>
              <th className="n">Trừ cọc</th>
              <th className="n">Đã thu</th>
              <th className="n">Còn nợ</th>
              {coThu && <th aria-label="Thu tiền" />}
            </tr>
          </thead>
          <tbody>
            {than}
            <tr className="lds-cong">
              <td colSpan={cotDau}>{`Cộng ${vietSo(items.length)} hoá đơn`}</td>
              <td className="n">{vietSo(congGiaTri(items))}</td>
              <td className="n"><OTien so={cong(items, "deposit_offset_amount")} /></td>
              <td className="n"><OTien so={cong(items, "direct_received_amount")} /></td>
              <td className="n"><OTien so={cong(items, "remaining_amount")} /></td>
              {coThu && <td />}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
