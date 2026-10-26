// Biểu hoa hồng theo SỐ NGÀY THU TIỀN (23/10/2026) — chủ dặn làm y ô bù hao của công đoạn
// (`danh-muc/fields/Bands.tsx`): người khai chỉ nhập MỐC TRÊN, cận dưới là mốc của bậc liền trước,
// nhãn tự nối "Đến 45 ngày" · "Trên 45 đến 60" · "Trên 75 ngày". Bậc cuối luôn vô hạn nên không có ô
// mốc và không xoá được khi còn bậc khác — không thì khoản thu chậm hơn mốc cuối rơi ra ngoài biểu,
// không ai biết. Còn một mình nó thì xoá được: biểu rỗng = không hưởng hoa hồng.
//
// `pct` ở đây là % HIỂN THỊ (3 = 3%). Hồ sơ lương lưu PHÂN SỐ — đổi ở modal lúc nạp/lưu.
import { RowEditor } from "../../../danh-muc/fields/RowEditor";
import "../../../rebuild-catalog.css";

export type BacHoaHong = { den_ngay: number | null; pct: number };

const voHan = (r: BacHoaHong) => r.den_ngay === null || r.den_ngay === undefined;

export function BacHoaHongField({ value, onChange }: { value: BacHoaHong[]; onChange: (v: BacHoaHong[]) => void }) {
  const rows = value ?? [];
  const setRow = (i: number, patch: Partial<BacHoaHong>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /** Mốc của bậc LIỀN TRƯỚC — cận dưới của bậc `i`. Bậc đầu bắt từ 0. */
  const canDuoi = (i: number) => {
    const truoc = rows[i - 1];
    return truoc && !voHan(truoc) ? Number(truoc.den_ngay) : 0;
  };

  // "Thêm bậc" CHÈN TRƯỚC bậc vô hạn, mốc gợi ý = cận dưới + 15 ngày (bậc của sổ cách nhau 15 ngày)
  // để hàng hiện lên đã hợp lệ. Chưa có bậc nào thì bậc đầu tiên chính là bậc vô hạn.
  const add = () => {
    const iVo = rows.findIndex(voHan);
    if (iVo < 0) {
      onChange([...rows, { den_ngay: null, pct: 0 }]);
      return;
    }
    const moi: BacHoaHong = { den_ngay: canDuoi(iVo) + 15, pct: 0 };
    onChange([...rows.slice(0, iVo), moi, ...rows.slice(iVo)]);
  };

  const num = (v: unknown) => (v === "" || v == null ? "" : String(v));
  /** Mốc phải TĂNG DẦN — hàng nào phá thứ tự thì tô đỏ ngay tại chỗ, không đợi lưu. */
  const sai = (r: BacHoaHong, i: number) => !voHan(r) && canDuoi(i) >= Number(r.den_ngay);

  return (
    <RowEditor
      rows={rows}
      cot={["Khi số ngày thu tiền", "Thì hoa hồng"]}
      khoa="rc-bands--bac"
      trong="Không hưởng hoa hồng — bấm “＋ Thêm bậc”."
      themNhan="＋ Thêm bậc"
      onThem={add}
      onXoa={(i) => onChange(rows.filter((_, j) => j !== i))}
      xoaTitle="Xóa bậc"
      khoaXoa={(r) => voHan(r) && rows.length > 1}
      lopHang={(r, i) => (sai(r, i) ? "rc-bands__row--invalid" : undefined)}
      veHang={(r, i) => {
        const lech = sai(r, i);
        const duoi = canDuoi(i);
        const nhan = voHan(r)
          ? (i === 0 ? "Mọi số ngày" : `Trên ${duoi} ngày`)
          : (i === 0 ? "Đến" : `Trên ${duoi} đến`);
        return (
          <>
            <td>
              <div className="rc-bands__range">
                <span className="rc-bands__range-lbl">{nhan}</span>
                {!voHan(r) && (
                  <>
                    <input
                      className={`rc-input rc-input--num${lech ? " rc-input--invalid" : ""}`}
                      type="number"
                      min={0}
                      title={lech ? "Mốc phải lớn hơn mốc của bậc trên nó" : "Mốc trên của bậc (ngày)"}
                      value={num(r.den_ngay)}
                      onChange={(e) =>
                        setRow(i, { den_ngay: e.target.value === "" ? 0 : Number(e.target.value) })}
                    />
                    <span className="rc-bands__range-lbl">ngày</span>
                  </>
                )}
              </div>
            </td>
            <td>
              <div className="rc-bands__hao">
                <input
                  className="rc-input rc-input--num"
                  type="number"
                  step="any"
                  min={0}
                  max={100}
                  aria-label="Hoa hồng (%)"
                  value={num(r.pct)}
                  onChange={(e) => setRow(i, { pct: e.target.value === "" ? 0 : Number(e.target.value) })}
                />
                <span className="rc-bands__range-lbl">%</span>
              </div>
            </td>
          </>
        );
      }}
    />
  );
}
