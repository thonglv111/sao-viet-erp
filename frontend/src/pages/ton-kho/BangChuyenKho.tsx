// Lịch sử CHUYỂN KHO (03/11/2026): một dòng một lần chuyển × một mặt hàng × một vị trí lấy. Dùng chung
// cho tab "Lịch sử chuyển kho" của ngăn mặt hàng (không cột Mặt hàng) và tab Điều chuyển của trang kho.
// Không số phiếu, không mở phiếu: người xem cần từ kho nào, lấy ở đâu, sang kho nào, cất ở đâu, bao
// nhiêu, giá trị, ai chuyển.
import type { ChuyenKhoRow, LichSuSuaRow } from "../../api/client";
import { fmtDateTime, money } from "../../utils/format";
import { fmtQty } from "../khoShared";
import { tenDonVi } from "../tenDonVi";
import "./bang-chuyen-kho.css";

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

/** Chip màu của cột Việc — mỗi việc một sắc (bộ `--tt-*`). */
const LOP_VIEC: Record<string, string> = {
  "Sửa tồn": "lss-chip--lam",
  "Thêm hàng": "lss-chip--xanh",
  "Đặt mức tồn": "lss-chip--cam",
  "Sửa giá gốc": "lss-chip--tim",
  "Bổ sung khổ": "lss-chip--tim",
};

function Chenh({ v, dv }: { v: number | null; dv: string }) {
  if (v == null || Math.abs(v) < 1e-9) return null;
  return (
    <span className={v > 0 ? "lss-tang" : "lss-giam"}>
      {`${v > 0 ? "+" : "−"}${fmtQty(Math.abs(v))} ${dv}`.trim()}
    </span>
  );
}

/** Tab "Lịch sử sửa" của ngăn mặt hàng (phương án B, 03/11/2026): lưới kiểu Excel, mỗi thông tin đổi
 *  một dòng Trước / Sau / Chênh; ngày giờ, người, việc, ở đâu gộp ô theo lần sửa. */
export function BangLichSuSua({ rows }: { rows: LichSuSuaRow[] }) {
  return (
    <table className="kho-lines lss">
      <colgroup>
        <col style={{ width: 140 }} />
        <col style={{ width: 120 }} />
        <col style={{ width: 120 }} />
        <col style={{ width: 120 }} />
        <col style={{ width: 120 }} />
        <col style={{ width: 120 }} />
        <col style={{ width: 110 }} />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th>Ngày giờ</th>
          <th>Người sửa</th>
          <th>Việc</th>
          <th>Thông tin</th>
          <th className="kho-num">Trước</th>
          <th className="kho-num">Sau</th>
          <th className="kho-num">Chênh</th>
          <th>Ở đâu, ghi chú</th>
        </tr>
      </thead>
      <tbody>
        {rows.flatMap((r) => {
          const dong = r.dong.length ? r.dong : [null];
          const n = dong.length;
          return dong.map((d, i) => (
            <tr key={`${r.id}-${i}`} className={i === n - 1 ? "lss-cuoi" : undefined}>
              {i === 0 && (
                <>
                  <td rowSpan={n} className="lss-gio">{fmtDateTime(r.luc)}</td>
                  <td rowSpan={n}>{r.nguoi || tru}</td>
                  <td rowSpan={n}><span className={`lss-chip ${LOP_VIEC[r.viec] ?? ""}`}>{r.viec}</span></td>
                </>
              )}
              <td>{d?.thong_tin ?? tru}</td>
              <td className="kho-num lss-truoc">{d?.truoc ?? ""}</td>
              <td className="kho-num">{d?.sau ?? ""}</td>
              <td className="kho-num">{d && <Chenh v={d.chenh} dv={d.don_vi} />}</td>
              {i === 0 && (
                <td rowSpan={n} className="lss-ghi">
                  {r.o_dau && <div>{r.o_dau}</div>}
                  {r.ghi_chu.map((g, k) => <div key={k} className="lss-mo">{g}</div>)}
                  {!r.o_dau && r.ghi_chu.length === 0 && tru}
                </td>
              )}
            </tr>
          ));
        })}
      </tbody>
    </table>
  );
}
