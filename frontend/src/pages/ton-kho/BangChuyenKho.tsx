// Lịch sử CHUYỂN KHO (03/11/2026): một dòng một lần chuyển × một mặt hàng × một vị trí lấy. Dùng chung
// cho tab "Lịch sử chuyển kho" của ngăn mặt hàng (không cột Mặt hàng) và tab Điều chuyển của trang kho.
// Không số phiếu, không mở phiếu: người xem cần từ kho nào, lấy ở đâu, sang kho nào, cất ở đâu, bao
// nhiêu, giá trị, ai chuyển.
import type { ChuyenKhoRow, LichSuSuaRow } from "../../api/client";
import { fmtDateTime, money } from "../../utils/format";
import { fmtQty } from "../khoShared";
import { tenDonVi } from "../tenDonVi";

const tru = <span className="lds-mu3">–</span>;

export function BangChuyenKho({ rows, coMatHang, coGia, lop }: {
  rows: ChuyenKhoRow[];
  /** Trang kho: nhiều mặt hàng ⇒ thêm cột Mặt hàng (+ khổ). Ngăn một mặt hàng thì không. */
  coMatHang: boolean;
  coGia: boolean;
  /** Lớp bảng của nơi đặt: `lds-g` (trang kho) hoặc `kho-lines` (ngăn). */
  lop: string;
}) {
  return (
    <table className={lop} style={{ minWidth: (coMatHang ? 260 : 0) + 900 }}>
      <colgroup>
        <col style={{ width: 130 }} />
        {coMatHang && <col />}
        <col style={{ width: 130 }} />
        <col style={{ width: 90 }} />
        <col style={{ width: 130 }} />
        <col style={{ width: 90 }} />
        <col style={{ width: 120 }} />
        {coGia && <col style={{ width: 130 }} />}
        <col style={{ width: 140 }} />
      </colgroup>
      <thead>
        <tr>
          <th>Ngày giờ</th>
          {coMatHang && <th>Mặt hàng</th>}
          <th>Từ kho</th>
          <th>Lấy ở</th>
          <th>Sang kho</th>
          <th>Cất ở</th>
          <th className="n kho-num">Số lượng</th>
          {coGia && <th className="n kho-num">Giá trị</th>}
          <th>Người chuyển</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{fmtDateTime(r.luc)}</td>
            {coMatHang && (
              <td title={r.hang_ma ?? undefined}>
                {r.hang_ten ?? r.hang_ma ?? "vật tư"}
                {r.kho && <span className="lds-mu3"> {r.kho}</span>}
              </td>
            )}
            <td>{r.kho_tu}</td>
            <td>{r.lay_o || tru}</td>
            <td>{r.kho_den}</td>
            <td>{r.cat_o || tru}</td>
            <td className="n kho-num">{`${fmtQty(r.so_luong)} ${tenDonVi(r.dvt) ?? r.dvt ?? ""}`.trim()}</td>
            {coGia && <td className="n kho-num">{r.gia_tri != null ? money(r.gia_tri) : ""}</td>}
            <td>{r.nguoi || tru}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Tab "Lịch sử sửa" của ngăn mặt hàng: mỗi lần lưu một dòng, mỗi thay đổi cũ → mới một dòng chữ. */
export function BangLichSuSua({ rows }: { rows: LichSuSuaRow[] }) {
  return (
    <table className="kho-lines">
      <colgroup>
        <col style={{ width: 130 }} />
        <col style={{ width: 140 }} />
        <col style={{ width: 130 }} />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th>Ngày giờ</th>
          <th>Người sửa</th>
          <th>Việc</th>
          <th>Thay đổi</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{fmtDateTime(r.luc)}</td>
            <td>{r.nguoi || tru}</td>
            <td>{r.viec}</td>
            <td className="tkh-ls-doi">
              {r.thay_doi.length ? r.thay_doi.map((d, i) => <div key={i}>{d}</div>) : tru}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
