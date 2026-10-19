// Báo cáo kho · tab Nhập-Xuất-Tồn (11/10/2026, phương án B): Kho và Kỳ là hai nút trên CÙNG hàng với
// Tìm / Lọc / Cột — vẫn hiện ngoài vì chúng quyết định số đầu kỳ và việc tính giá, chứ không chìm
// trong menu Lọc. Khuôn nút + hộp bật ra lấy y của nút Kỳ ở thanh lọc chung (`tl-*`).
//
// Luật kỳ giữ nguyên như trước: đã có kỳ khóa sổ thì "Từ ngày" cố định ở đầu kỳ đang chọn, chỉ "Đến
// ngày" đổi được trong kỳ (tính giá giữa kỳ); chưa khóa kỳ nào thì chọn khoảng tự do + "Tháng này".
import { CalendarDays, ChevronDown, Warehouse } from "lucide-react";
import { useRef, useState } from "react";
import { ChonNgay } from "../components/ChonNgay";
import { LopNoi, useDongKhiRaNgoai } from "./thanh-loc/ThanhLoc";

export function NutKho({ ds, khoId, onDoi }: {
  ds: { id: number; ten: string }[];
  khoId: number | null;
  onDoi: (id: number | null) => void;
}) {
  const [mo, setMo] = useState(false);
  const vung = useRef<HTMLDivElement>(null);
  useDongKhiRaNgoai(vung, mo, () => setMo(false));
  const ten = khoId == null ? "Tất cả kho" : ds.find((k) => k.id === khoId)?.ten ?? `Kho #${khoId}`;
  const muc: { id: number | null; ten: string }[] = [{ id: null, ten: "Tất cả kho" }, ...ds];

  return (
    <div className="tl-neo" ref={vung}>
      <button type="button" className={`tl-nut${mo ? " is-mo" : ""}`} aria-haspopup="dialog" aria-expanded={mo}
        aria-label={`Kho: ${ten}`} onClick={() => setMo(!mo)}>
        <Warehouse size={15} aria-hidden="true" />
        <span>{ten}</span>
        <ChevronDown size={15} aria-hidden="true" className="tl-nut__mui" />
      </button>
      {mo && (
        <LopNoi className="tl-pop--ky" onDong={() => setMo(false)}>
          <div role="dialog" aria-label="Chọn kho">
            <div className="tl-nhom">Kho</div>
            <div role="radiogroup" aria-label="Kho">
              {muc.map((k) => (
                <button key={k.id ?? "tat-ca"} type="button" role="radio" aria-checked={k.id === khoId}
                  className={`tl-dong tl-dong--radio${k.id === khoId ? " on" : ""}`}
                  onClick={() => { onDoi(k.id); setMo(false); }}>
                  <span className="tl-dong__dau" aria-hidden="true" />
                  {k.ten}
                </button>
              ))}
            </div>
          </div>
        </LopNoi>
      )}
    </div>
  );
}

export type MucKyBaoCao = { nhan: string; khoang: string; kho: string | null; tu: string; den: string };

export function NutKyBaoCao({ cacKy, kyIdx, tu, den, nhan, phu, onChonKy, onTu, onDen, onThangNay }: {
  cacKy: MucKyBaoCao[];
  kyIdx: number;
  tu: string;
  den: string;
  /** Chữ trên nút: tên kỳ đang chọn, hoặc khoảng ngày. */
  nhan: string;
  /** Chữ phụ mờ cạnh tên kỳ (khoảng ngày đang xem). */
  phu?: string;
  onChonKy: (i: number) => void;
  onTu: (v: string) => void;
  onDen: (v: string) => void;
  onThangNay: () => void;
}) {
  const [mo, setMo] = useState(false);
  const vung = useRef<HTMLDivElement>(null);
  useDongKhiRaNgoai(vung, mo, () => setMo(false));
  const coKy = cacKy.length > 0;
  const kyChon = kyIdx >= 0 ? cacKy[kyIdx] : undefined;

  return (
    <div className="tl-neo" ref={vung}>
      <button type="button" className={`tl-nut tl-nut--ky${mo ? " is-mo" : ""}`} aria-haspopup="dialog" aria-expanded={mo}
        aria-label={`Kỳ: ${nhan}${phu ? ` ${phu}` : ""}`} onClick={() => setMo(!mo)}>
        <CalendarDays size={15} aria-hidden="true" />
        <span>{nhan}</span>
        {phu && <span className="tl-nut__phu">{phu}</span>}
        <ChevronDown size={15} aria-hidden="true" className="tl-nut__mui" />
      </button>
      {mo && (
        <LopNoi className="tl-pop--ky" onDong={() => setMo(false)}>
          <div role="dialog" aria-label="Kỳ báo cáo">
            {coKy ? (
              <>
                <div className="tl-nhom">Kỳ đã khóa sổ</div>
                <div role="radiogroup" aria-label="Kỳ đã khóa sổ">
                  {cacKy.map((k, i) => (
                    <button key={`${k.tu}-${k.den}-${k.kho ?? ""}`} type="button" role="radio" aria-checked={i === kyIdx}
                      className={`tl-dong tl-dong--radio${i === kyIdx ? " on" : ""}`}
                      onClick={() => onChonKy(i)}>
                      <span className="tl-dong__dau" aria-hidden="true" />
                      {k.nhan}
                      <em>{k.kho ? `${k.khoang} ${k.kho}` : k.khoang}</em>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="tl-nhom">Chưa khóa kỳ nào</div>
                <button type="button" className="tl-dong" onClick={() => { onThangNay(); setMo(false); }}>
                  Tháng này
                </button>
              </>
            )}
            <div className="tl-khoang tl-khoang--ngay">
              <label>
                <span>Từ ngày</span>
                <ChonNgay aria-label="Từ ngày" value={tu} disabled={coKy} readOnly={coKy}
                  max={den || undefined} onChange={onTu}
                  title={coKy ? "Đầu kỳ cố định theo kỳ đã khóa — đổi bằng cách chọn kỳ khác" : undefined} />
              </label>
              <label>
                <span>Đến ngày</span>
                <ChonNgay aria-label="Đến ngày" value={den}
                  min={(kyChon?.tu ?? tu) || undefined} max={kyChon?.den}
                  onChange={onDen} />
              </label>
            </div>
            {coKy && (
              <p className="kho-bc-ky__goi-y">
                Từ ngày đi theo đầu kỳ đã khóa. Đến ngày chọn được bất kỳ ngày nào trong kỳ để xem số tạm tính giữa kỳ.
              </p>
            )}
          </div>
        </LopNoi>
      )}
    </div>
  );
}
