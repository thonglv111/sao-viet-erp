/** Tab SAO KÊ của ngăn công nợ (phương án 2, 06/10/2026): số dư đầu kỳ → từng chứng từ theo ngày với
 *  số dư chạy → số dư cuối kỳ. Số lấy từ sổ chi tiết của máy chủ (cùng luồng chứng từ với báo cáo sổ
 *  chi tiết, có test đối chiếu) — giao diện chỉ đổi chiều cột cho dễ đọc.
 *
 *  Hai bên đọc ngược chiều nợ/có:
 *  - TK 131 (phải thu): hoá đơn ghi NỢ (khách nợ thêm), phiếu thu ghi CÓ. Số dư = nợ − có.
 *  - TK 331 (phải trả): đợt giao ghi CÓ (mình nợ thêm), phiếu chi ghi NỢ. Số dư = có − nợ.
 *  Nên ở đây chỉ còn hai cột "tăng" (Bán ra / Nhận hàng) và "giảm" (Đã thu / Đã trả), số dư dương
 *  luôn là "còn nợ" — người đọc không phải nhớ bên nào là nợ.
 *
 *  Kỳ mặc định = kỳ đang xem ở trang. "In sao kê" ở đầu ngăn mở bản in của đúng bảng đang hiện.
 */
import { ChonNgay } from "../../../components/ChonNgay";
import { useEffect, useRef, useState } from "react";

import { ApiError, api, type KyXem, type SoChiTietCongNo, type SoChiTietDong } from "../../../api/client";
import { useAuth } from "../../../auth/useAuth";
import { PrintSheet } from "../../../components/PrintSheet";
import { LOAI_KY, homNayVN, loiKhoang, tinhKy, type LoaiKy } from "../../../utils/ky";
import { ngay, vietSo } from "./dinhDang";

export type BenCongNo = "receivables" | "payables";

/** Chữ của từng bên. */
const CHU: Record<BenCongNo, { tang: string; giam: string; soDu: string; doiTac: string; loaiPhieu: string }> = {
  receivables: { tang: "Bán ra", giam: "Đã thu", soDu: "Số dư = khách còn nợ mình", doiTac: "Khách hàng", loaiPhieu: "phieu_thu" },
  payables: { tang: "Nhận hàng", giam: "Đã trả", soDu: "Số dư = mình còn nợ nhà cung cấp", doiTac: "Nhà cung cấp", loaiPhieu: "phieu_chi" },
};

/** Tiền tăng / giảm / số dư của một dòng sổ, đã quy về chiều "còn nợ". */
export function chieuCongNo(ben: BenCongNo, d: Pick<SoChiTietDong, "no" | "co" | "luy_ke_no" | "luy_ke_co">) {
  return ben === "receivables"
    ? { tang: d.no, giam: d.co, du: d.luy_ke_no - d.luy_ke_co }
    : { tang: d.co, giam: d.no, du: d.luy_ke_co - d.luy_ke_no };
}

/** Tải sổ chi tiết của một đối tác cho một khoảng ngày. Câu trả lời cũ về muộn bị bỏ; tải hỏng thì
 *  xoá số cũ (im lặng không được giả làm số đúng). `lan` đổi ⇒ tải lại (sự kiện đẩy, vừa lập phiếu). */
export function useSoCongNo(ben: BenCongNo, id: number, ky: KyXem | null, lan = 0) {
  const { token } = useAuth();
  const [so, setSo] = useState<SoChiTietCongNo | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [dangTai, setDangTai] = useState(false);
  const luot = useRef(0);
  const tu = ky?.tu;
  const den = ky?.den;

  useEffect(() => {
    if (!token || !tu || !den) return;
    const l = ++luot.current;
    setDangTai(true);
    api.accounting
      .saoKeDoiTac(token, ben, id, { tuNgay: tu, denNgay: den })
      .then((d) => {
        if (l !== luot.current) return;
        setSo(d);
        setLoi(null);
      })
      .catch((err) => {
        if (l !== luot.current) return;
        setSo(null);
        setLoi(err instanceof ApiError ? err.message : "Không tải được sao kê.");
      })
      .finally(() => {
        if (l === luot.current) setDangTai(false);
      });
  }, [token, ben, id, tu, den, lan]);

  return { so, loi, dangTai };
}

type ChonKy = "trang" | LoaiKy;

/** Chứng từ hoàn tiền: sổ ghi cùng phía hoá đơn / hàng về, sao kê hiện là thu âm / trả âm. */
const LOAI_HOAN = new Set(["hoan_tien", "hoan_tien_khach"]);
const amDuong = (n: number) => (n < 0 ? `−${vietSo(-n)}` : vietSo(n));

/** Số hoá đơn không kèm ký hiệu — ký hiệu đứng cột riêng (13/10/2026). */
const soKhongKyHieu = (d: SoChiTietDong) =>
  d.ky_hieu && d.so_ct.startsWith(`${d.ky_hieu} `) ? d.so_ct.slice(d.ky_hieu.length + 1) : d.so_ct;

function BangSaoKe({ ben, so, onMoPhieu, onMoDon, onMoDonMua, inAn }: {
  ben: BenCongNo; so: SoChiTietCongNo; onMoPhieu?: (code: string) => void; onMoDon?: (orderId: number) => void;
  onMoDonMua?: (code: string) => void; inAn?: boolean;
}) {
  const c = CHU[ben];
  // Phải thu: chứng từ là hoá đơn bán ⇒ thêm cột Ký hiệu. Phải trả (13/10/2026): chứng từ là đợt
  // nhận hàng (ngày của dòng = ngày nhận hàng) ⇒ thêm Số hoá đơn, Ký hiệu, Ngày hoá đơn của đợt.
  const coKyHieu = ben === "receivables";
  const coHdMua = ben === "payables";
  const soCot = coKyHieu ? 7 : 9;
  const cotTrong = coKyHieu ? 2 : 4;
  const dau = ben === "receivables" ? so.dau_no - so.dau_co : so.dau_co - so.dau_no;
  const cuoi = ben === "receivables" ? so.cuoi_no - so.cuoi_co : so.cuoi_co - so.cuoi_no;
  // Tiền hoàn không phải bán ra / nhận hàng: trừ khỏi cột tăng, tính là thu âm / trả âm.
  const tongTang = (ben === "receivables" ? so.ps_no : so.ps_co) - so.hoan;
  const tongGiam = (ben === "receivables" ? so.ps_co : so.ps_no) - so.hoan;
  const soTien = (n: number) => (n ? amDuong(n) : "");
  // Bản xem trên ngăn dùng lưới lds-g (lớp căn `n`, dòng mốc `lds-cong`); bản in giữ bảng `ps-tbl` cũ (lớp `r`).
  const lopSo = inAn ? "r" : "n";
  const lopMoc = inAn ? "kt-sk__moc" : "lds-cong";
  return (
    // Bề rộng tối thiểu trên ngăn = tổng cột cố định + 160 cho Diễn giải: ngăn hẹp thì khung cuộn ngang,
    // không ép Diễn giải về 0px (phải trả có thêm ba cột hoá đơn từ 13/10/2026).
    <table className={inAn ? `ps-tbl kt-sk-in${coHdMua ? " kt-sk-in--tra" : ""}` : "lds-g"}
      style={inAn ? undefined : { minWidth: (coKyHieu ? 102 + 150 + 92 : 102 + 190 + 112 + 88 + 114) + 3 * 116 + 160 }}>
      {inAn ? (
        // Bản in (vùng chữ A4 = 160mm, 10pt): Ký hiệu "1C26TSV" ~14mm + đệm — 9–11% từng làm gãy mã;
        // Chứng từ "PT-261007-FSAE" ~28mm + đệm ⇒ 20%, ở 16% số phiếu lấn sang cột bên. Diễn giải xuống dòng được.
        coKyHieu ? (
          <colgroup>
            <col style={{ width: "13%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
          </colgroup>
        ) : (
          // Phải trả 9 cột in A4 NGANG (vùng chữ 247mm, 15/10/2026): ở khổ dọc riêng phần không được
          // xuống dòng đã ~177mm. Đo ở bản xem 247mm ≈ 934px: "DMH-261007-2AKM đợt 1" cần 165px kể
          // cả đệm (17% = 158 thì lấn) ⇒ 19%; ngày 77px ⇒ 9%; số HĐ "HD9093426" 82px (8% từng chạm
          // mép) ⇒ 10%; Ký hiệu 7%; tiền 13 ký tự "1.234.567.890" ⇒ 10%. Diễn giải còn ~40mm.
          <colgroup>
            <col style={{ width: "9%" }} />
            <col style={{ width: "19%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
        )
      ) : (
        // Chứng từ rộng 190: "DMH-261007-VBF4 đợt 1" đo 189px khi xếp công nợ phải trả. Phải thu dài
        // nhất là số phiếu thu "PT-261006-MUNO" ⇒ 150, Ký hiệu "1C26TSV" 92. Diễn giải co giãn.
        <colgroup>
          <col style={{ width: 102 }} />
          <col style={{ width: coKyHieu ? 150 : 190 }} />
          {coKyHieu && <col style={{ width: 92 }} />}
          {coHdMua && (
            <>
              <col style={{ width: 112 }} />
              <col style={{ width: 88 }} />
              <col style={{ width: 114 }} />
            </>
          )}
          <col />
          <col style={{ width: 116 }} />
          <col style={{ width: 116 }} />
          <col style={{ width: 116 }} />
        </colgroup>
      )}
      <thead>
        <tr>
          <th>Ngày</th>
          <th>Chứng từ</th>
          {coKyHieu && <th>Ký hiệu</th>}
          {coHdMua && (
            <>
              <th>Số hoá đơn</th>
              <th>Ký hiệu</th>
              <th>Ngày hoá đơn</th>
            </>
          )}
          <th>Diễn giải</th>
          <th className={lopSo}>{c.tang}</th>
          <th className={lopSo}>{c.giam}</th>
          <th className={lopSo}>Số dư</th>
        </tr>
      </thead>
      <tbody>
        <tr className={lopMoc}>
          <td>{ngay(so.tu_ngay)}</td>
          <td colSpan={cotTrong} />
          <td>Số dư đầu kỳ</td>
          <td />
          <td />
          <td className={lopSo}>{vietSo(dau)}</td>
        </tr>
        {so.dong.length === 0 && (
          <tr>
            <td colSpan={soCot} className={inAn ? "kt-mo" : "lds-trong"}>Không có chứng từ nào trong kỳ.</td>
          </tr>
        )}
        {so.dong.map((d, i) => {
          const s0 = chieuCongNo(ben, d);
          const s = LOAI_HOAN.has(d.loai) ? { ...s0, tang: 0, giam: -s0.tang } : s0;
          const laPhieu = d.loai === c.loaiPhieu;
          const soCt = coKyHieu ? soKhongKyHieu(d) : d.so_ct;
          // Hoá đơn bán không có màn riêng: bấm số mở đơn bán của nó (khối Hoá đơn trong đơn).
          const donHd = d.loai === "hoa_don" && d.don_id != null ? d.don_id : null;
          // Đợt nhận hàng (phải trả): bấm "DMH-… đợt N" mở đơn mua.
          const donMua = d.loai === "dot_giao" && d.don_ma ? d.don_ma : null;
          return (
            <tr key={`${d.so_ct}-${i}`}>
              <td>{ngay(d.ngay)}</td>
              <td>
                {inAn ? soCt : laPhieu && onMoPhieu ? (
                  <button type="button" className="kt-lk" onClick={() => onMoPhieu(d.so_ct)}>{soCt}</button>
                ) : donHd != null && onMoDon ? (
                  <button type="button" className="kt-lk" title="Mở đơn bán của hoá đơn" onClick={() => onMoDon(donHd)}>{soCt}</button>
                ) : donMua != null && onMoDonMua ? (
                  <button type="button" className="kt-lk" title="Mở đơn mua" onClick={() => onMoDonMua(donMua)}>{soCt}</button>
                ) : (
                  soCt
                )}
              </td>
              {coKyHieu && <td className={inAn ? "kt-sk__kh" : "lds-mu"}>{d.ky_hieu ?? ""}</td>}
              {coHdMua && (
                <>
                  <td>{d.so_hoa_don ?? ""}</td>
                  <td className={inAn ? "kt-sk__kh" : "lds-mu"}>{d.ky_hieu ?? ""}</td>
                  <td>{d.ngay_hoa_don ? ngay(d.ngay_hoa_don) : ""}</td>
                </>
              )}
              <td className={inAn ? "kt-sk__dg" : undefined}>{d.dien_giai}</td>
              <td className={lopSo}>{soTien(s.tang)}</td>
              <td className={lopSo}>{soTien(s.giam)}</td>
              <td className={lopSo}>
                {inAn ? <b>{vietSo(s.du)}</b> : vietSo(s.du)}
              </td>
            </tr>
          );
        })}
        <tr className={inAn ? "kt-sk__moc kt-sk__moc--cuoi" : "lds-cong"}>
          <td>{ngay(so.den_ngay)}</td>
          <td colSpan={cotTrong} />
          <td>Số dư cuối kỳ</td>
          <td className={lopSo}>{vietSo(tongTang)}</td>
          <td className={lopSo}>{amDuong(tongGiam)}</td>
          <td className={lopSo}>{vietSo(cuoi)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function TabSaoKe({
  ben,
  id,
  ten,
  ma,
  kyTrang,
  lan = 0,
  dangIn,
  onDongIn,
  onMoPhieu,
  onMoDon,
  onMoDonMua,
}: {
  ben: BenCongNo;
  id: number;
  ten: string;
  ma?: string | null;
  /** Kỳ đang xem ở trang — kỳ mặc định của sao kê. */
  kyTrang: KyXem;
  /** Đổi ⇒ tải lại. */
  lan?: number;
  /** Đang mở bản in (nút "In sao kê" ở đầu ngăn). */
  dangIn: boolean;
  onDongIn: () => void;
  /** Mở phiếu thu / phiếu chi; không có = không có quyền xem phiếu ⇒ số phiếu là chữ thường. */
  onMoPhieu?: (code: string) => void;
  /** Mở đơn bán (bấm số hoá đơn ở sao kê phải thu); không có = không có quyền xem đơn. */
  onMoDon?: (orderId: number) => void;
  /** Mở đơn mua (bấm "DMH-… đợt N" ở sao kê phải trả); không có = không có quyền xem đơn mua. */
  onMoDonMua?: (code: string) => void;
}) {
  const homNay = homNayVN();
  const [chon, setChon] = useState<ChonKy>("trang");
  const [tuy, setTuy] = useState<KyXem>(kyTrang);
  const loiTuy = chon === "tuy" ? loiKhoang(tuy.tu, tuy.den) : null;
  const ky: KyXem | null = chon === "trang" ? kyTrang : chon === "tuy" ? (loiTuy ? null : tuy) : tinhKy(chon, homNay);
  const { so, loi, dangTai } = useSoCongNo(ben, id, ky, lan);
  const c = CHU[ben];

  return (
    <>
      <div className="kt-hang-loc">
        <select className="kt-sk__chon" aria-label="Kỳ sao kê" value={chon} onChange={(e) => setChon(e.target.value as ChonKy)}>
          <option value="trang">{`Kỳ đang xem ${ngay(kyTrang.tu)} đến ${ngay(kyTrang.den)}`}</option>
          {LOAI_KY.map(([l, t]) => (
            <option key={l} value={l}>
              {l === "tuy" ? "Tuỳ chọn…" : `${t} ${ngay(tinhKy(l, homNay).tu)} đến ${ngay(tinhKy(l, homNay).den)}`}
            </option>
          ))}
        </select>
        {chon === "tuy" && (
          <>
            <ChonNgay className="kt-sk__chon" aria-label="Từ ngày" min="2000-01-01" max={homNay} value={tuy.tu}
              onChange={(v) => setTuy({ ...tuy, tu: v })} />
            <ChonNgay className="kt-sk__chon" aria-label="Đến ngày" min="2000-01-01" max={homNay} value={tuy.den}
              onChange={(v) => setTuy({ ...tuy, den: v })} />
          </>
        )}
        <span className="kt-mo">{c.soDu}</span>
      </div>
      {loiTuy && <p className="kt-do" role="alert">{loiTuy}</p>}
      {loi && <p className="kt-do" role="alert">{loi}</p>}
      {!so && dangTai && <p className="kt-mo">Đang tải sao kê…</p>}
      {so && (
        <div className={`lds-bang kt-sk-khung${dangTai ? " kt-sk-khung--tai" : ""}`} aria-busy={dangTai}>
          <BangSaoKe ben={ben} so={so} onMoPhieu={onMoPhieu} onMoDon={onMoDon} onMoDonMua={onMoDonMua} />
        </div>
      )}

      {dangIn && so && (
        <PrintSheet title="SAO KÊ CÔNG NỢ" docDate={ngay(homNay)} onClose={onDongIn} ngang={ben === "payables"}>
          <div className="ps-info">
            <div className="ps-info-grid">
              <div>
                <span className="ps-lbl">{`${c.doiTac}: `}</span>
                <b>{ten}</b>
              </div>
              <div>
                <span className="ps-lbl">Kỳ: </span>
                {`${ngay(so.tu_ngay)} đến ${ngay(so.den_ngay)}`}
              </div>
              {ma && (
                <div>
                  <span className="ps-lbl">Mã: </span>
                  {ma}
                </div>
              )}
              <div>
                <span className="ps-lbl">Đơn vị: </span>
                đồng
              </div>
            </div>
          </div>
          <div className="ps-sec">Chi tiết công nợ</div>
          <BangSaoKe ben={ben} so={so} inAn />
          <div className="ps-signs">
            <div>
              <div className="ps-role">{`Xác nhận của ${c.doiTac.toLowerCase()}`}</div>
              <div className="ps-hint">(Ký, ghi rõ họ tên, đóng dấu)</div>
              <div className="ps-sp" />
            </div>
            <div>
              <div className="ps-role">Người lập</div>
              <div className="ps-hint">(Ký, ghi rõ họ tên)</div>
              <div className="ps-sp" />
            </div>
          </div>
        </PrintSheet>
      )}
    </>
  );
}
