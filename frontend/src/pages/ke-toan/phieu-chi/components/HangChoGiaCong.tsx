/** Hàng "Gia công chờ chi" (đặc tả PC-1): bấm mục lọc nhanh "Gia công chờ chi" thì bảng phiếu đổi sang
 *  hàng này — lần gia công ngoài đã chốt số lượng, chưa có phiếu chi còn hiệu lực. Vẽ bằng khuôn lưới
 *  chung `lds-g` (08/10/2026). Cùng khuôn "Mua hàng chờ chi" (17/10/2026): mỗi việc một dòng, cột "Khoản
 *  chi", bấm vào dòng (ngoài nút) mở popup chi tiết `ChiTietKhoan`. Nút "Lập phiếu chi" là nút PHỤ (nút
 *  chính chỉ ở đầu trang). */
import { useState } from "react";

import type { GiaCongChoChi } from "../../../../api/client";
import { CuonLuoi, rongLuoi, type CauHinhLuoi, type CotLuoi } from "../../../../components/LuoiDs";
import { ChiTietKhoan } from "../../shared/ChiTietKhoan";
import { ngay } from "../../shared/dinhDang";
import { cacViec, soChot } from "../shared/giaCong";

export const COT_GIA_CONG: (CotLuoi & { w?: number; n?: boolean })[] = [
  { key: "nha", label: "Nhà gia công", coDinh: true, w: 220 },
  { key: "khoan", label: "Khoản chi", w: 96 },
  { key: "nguon", label: "Nguồn", w: 220 },
  { key: "viec", label: "Việc", w: 260 },
  { key: "so_chot", label: "Số chốt", n: true, w: 130 },
  { key: "chot_boi", label: "Chốt bởi", w: 200 },
  { key: "nut", label: "Thao tác", coDinh: true, w: 140 },
];

export function HangChoGiaCong({
  rows,
  loi,
  onLap,
  luoi,
  onMoNguon,
  coMoNguon,
}: {
  rows: GiaCongChoChi[] | null;
  loi: string | null;
  /** Không có = không có quyền lập phiếu chi ⇒ không hiện nút. */
  onLap?: (row: GiaCongChoChi) => void;
  /** Cấu hình lưới của màn cha (nút "Cột") — có thì ẩn / đổi chỗ / ghim / kéo độ rộng được. */
  luoi?: CauHinhLuoi;
  /** Mở nguồn của lần (lệnh SX / bài ghép). `coMoNguon` = dòng này mở được không (quyền + màn đích). */
  onMoNguon?: (row: GiaCongChoChi) => void;
  coMoNguon?: (row: GiaCongChoChi) => boolean;
}) {
  const cot = luoi ? luoi.rongHien(luoi.xep(COT_GIA_CONG).filter((c) => !luoi.an.has(c.key))) : COT_GIA_CONG;
  // Dòng đang mở popup chi tiết (theo id — nạp lại mà việc đã rời hàng thì popup tự đóng).
  const [xem, setXem] = useState<number | null>(null);
  const dangXem = rows?.find((r) => r.gia_cong_ngoai_id === xem) ?? null;
  const moNguon = (r: GiaCongChoChi) => (onMoNguon && coMoNguon?.(r) ? onMoNguon : undefined);
  return (
    <>
      <div className="lds-sheet">
        <p className="kt-gc-ghi">
          Việc thuê ngoài đã chốt số lượng, chưa trả tiền. Lập phiếu chi xong thì việc rời khỏi danh sách này.
        </p>
        <CuonLuoi ghim={luoi?.soGhim(cot)}>
          <table className="lds-g" style={{ minWidth: rongLuoi(cot) }}>
            <colgroup>
              {cot.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
            </colgroup>
            <thead>
              <tr>
                {cot.map((c) => (
                  <th key={c.key} className={c.n ? "n" : undefined} aria-label={c.key === "nut" ? "Thao tác" : undefined}>
                    {c.key === "nut" ? null : c.label}
                    {luoi?.keo(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loi ? (
                <tr>
                  <td colSpan={cot.length} className="lds-trong">
                    <span className="lds-do" role="alert">{`Không tải được hàng gia công chờ chi. ${loi}`}</span>
                  </td>
                </tr>
              ) : rows == null ? (
                <tr><td colSpan={cot.length} className="lds-trong">Đang tải…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={cot.length} className="lds-trong">Không còn việc gia công nào chờ chi.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.gia_cong_ngoai_id}
                    className={`lds-dong${xem === r.gia_cong_ngoai_id ? " is-chon" : ""}`}
                    tabIndex={0}
                    aria-haspopup="dialog"
                    onClick={() => setXem(r.gia_cong_ngoai_id)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        setXem(r.gia_cong_ngoai_id);
                      }
                    }}
                  >
                    {cot.map((c) => oGiaCong(c.key, r, onLap, moNguon(r)))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CuonLuoi>
      </div>
      {dangXem && (
        <PopupGiaCong r={dangXem} onClose={() => setXem(null)}
          onMoNguon={moNguon(dangXem) ? () => { setXem(null); moNguon(dangXem)?.(dangXem); } : undefined}
          onLap={onLap ? () => { setXem(null); onLap(dangXem); } : undefined} />
      )}
    </>
  );
}

/** Popup một việc gia công chờ chi (`ChiTietKhoan`). Việc chưa có số tiền — tiền nhập lúc lập phiếu chi —
 *  nên thẻ "Còn phải chi" ghi trạng thái thay cho số, và không có thẻ Hàng. */
function PopupGiaCong({
  r,
  onClose,
  onMoNguon,
  onLap,
}: {
  r: GiaCongChoChi;
  onClose: () => void;
  onMoNguon?: () => void;
  onLap?: () => void;
}) {
  const nguon = r.nhan_nguon || r.lsx_ma;
  return (
    <ChiTietKhoan
      tieuDe={`Gia công ${nguon}`}
      phuDe={r.nha_cung_cap_ten}
      lichSu={[{
        khoa: "chot",
        ngay: r.chot_luc,
        ngayChu: "đã chốt",
        noiDung: `Chốt số lượng ${soChot(r)}${r.chot_boi_ten ? ` — ${r.chot_boi_ten}` : ""}`,
        tien: null,
      }]}
      con={{ nhan: "Còn phải chi", chu: "Chờ lập phiếu" }}
      nut={onLap && <button type="button" className="kt-btn kt-btn--chinh" onClick={onLap}>Lập phiếu chi</button>}
      thongTin={[
        {
          nhan: "Việc",
          giaTri: cacViec(r.ten_viec).map((v, i) => (
            <span key={v}>{i > 0 && " "}<span className="lds-tag">{v}</span></span>
          )),
        },
        { nhan: "Số chốt", giaTri: soChot(r) },
        { nhan: "Chốt bởi", giaTri: r.chot_boi_ten },
        {
          nhan: "Nguồn",
          giaTri: onMoNguon ? <button type="button" className="kt-lk" onClick={onMoNguon}>{nguon}</button> : nguon,
        },
      ]}
      onClose={onClose}
    />
  );
}

/** Ô của một dòng theo khoá cột. Nút và link trong dòng chặn lan sự kiện để không mở popup. */
function oGiaCong(
  key: string,
  r: GiaCongChoChi,
  onLap?: (row: GiaCongChoChi) => void,
  onMoNguon?: (row: GiaCongChoChi) => void,
) {
  switch (key) {
    case "nha":
      return (
        <td key={key} title={r.nha_cung_cap_ten}>{r.nha_cung_cap_ten}</td>
      );
    case "khoan":
      return <td key={key}><span className="lds-tag">Gia công</span></td>;
    case "nguon":
      return (
        <td key={key}>
          {onMoNguon ? (
            <button type="button" className="lds-lk" onClick={(e) => { e.stopPropagation(); onMoNguon(r); }}>
              {r.nhan_nguon || r.lsx_ma}
            </button>
          ) : (
            r.nhan_nguon || r.lsx_ma
          )}
        </td>
      );
    case "viec":
      return (
        <td key={key} title={r.ten_viec}>
          {cacViec(r.ten_viec).map((v, i) => (
            <span key={v}>
              {i > 0 && " "}
              <span className="lds-tag">{v}</span>
            </span>
          ))}
        </td>
      );
    case "so_chot":
      return <td key={key} className="n">{soChot(r)}</td>;
    case "chot_boi":
      return (
        <td key={key}>
          {r.chot_boi_ten ?? "—"}
          {r.chot_luc && <>{" "}<span className="lds-mu">{ngay(r.chot_luc)}</span></>}
        </td>
      );
    case "nut":
      return (
        <td key={key} className="lds-nut">
          {onLap && (
            <button type="button" className="kt-btn kt-btn--nho" onClick={(e) => { e.stopPropagation(); onLap(r); }}>
              Lập phiếu chi
            </button>
          )}
        </td>
      );
    default:
      return <td key={key} />;
  }
}
