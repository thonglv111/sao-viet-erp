// Ngăn soi hoa hồng kinh doanh của một dòng lương (23/10/2026) — khuôn `SoiKhoanKm`.
import { Fragment, useCallback, useEffect, useState } from "react";
import {
  api,
  type HoaHongChiTiet,
  type PayrollLine,
  type PayrollPeriod,
} from "../../../../api/client";
import { money } from "../shared/helpers";
import { EmptyState } from "../../../../components/EmptyState";

const ngay = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const phanTram = (p: number) => `${+(p * 100).toFixed(4)}%`;

/** Bảng đối chiếu HOA HỒNG của một dòng lương — HCNS bấm số ở cột "Hoa hồng" để mở.
 *
 * Mỗi hàng là một lần tiền về (dòng phiếu thu đã nhận trong kỳ): gốc = tiền trước VAT trừ CK + kê,
 * % tra theo số ngày từ hoá đơn tới lúc thu. Số máy tự tính nên không có ô gõ tiền. Chỗ duy nhất
 * được can tay là **% riêng của đơn** (đơn đặc biệt, hoặc 0 để loại) — chỉ người có ô Thao tác lương,
 * bắt ghi lý do, và thắng biểu cho MỌI lần thu của đơn đó.
 */
export function SoiHoaHong({
  token,
  line,
  period,
  coQuyenSua,
  dangTinh = false,
  onClose,
  onDaDoi,
}: {
  token: string;
  line: PayrollLine;
  period: PayrollPeriod;
  coQuyenSua: boolean;
  /** Bảng lương đang Tính lại (cả kỳ mất vài chục giây) — cột trên bảng chưa kịp đổi. */
  dangTinh?: boolean;
  onClose: () => void;
  /** Đã đặt/bỏ % riêng — bảng lương tính lại rồi tải lại. */
  onDaDoi: () => void;
}) {
  const [data, setData] = useState<HoaHongChiTiet | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  // Đơn đang mở ô % riêng — ô hiện NGAY DƯỚI hàng vừa bấm (`dong`), không ở cuối ngăn: một người có
  // vài trăm lần thu, để ở cuối là ô mở ra cách nút bấm cả chục nghìn điểm ảnh. Một lúc chỉ một đơn.
  // `coRieng`: đơn đang có % riêng ⇒ ô điền sẵn số + lý do đang có và mới có nút Bỏ.
  const [sua, setSua] = useState<
    { orderId: number; dong: number; pct: string; lyDo: string; coRieng: boolean } | null
  >(null);
  const [dangLuu, setDangLuu] = useState(false);

  const tai = useCallback(() => {
    let huy = false;
    api.luong
      .chiTietHoaHong(token, line.id)
      .then((r) => !huy && setData(r))
      .catch((e: unknown) =>
        !huy && setLoi(e instanceof Error ? e.message : "Không tải được chi tiết"),
      );
    return () => {
      huy = true;
    };
  }, [token, line.id]);
  useEffect(() => tai(), [tai]);

  async function luu(pct: number | null) {
    if (!sua) return;
    setDangLuu(true);
    setLoi(null);
    try {
      await api.luong.datHoaHongRieng(token, sua.orderId, {
        pct,
        ly_do: pct == null ? null : sua.lyDo.trim() || null,
      });
      setSua(null);
      onDaDoi();
      tai();
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Không lưu được % riêng");
    } finally {
      setDangLuu(false);
    }
  }

  const lech = !dangTinh && data != null && Math.abs(data.tong - (line.hoa_hong ?? 0)) > 1;
  // Kỳ đã chốt không Tính lại được — cột giữ số lúc chốt, đừng bảo người ta bấm nút không có.
  const kyChot = period.status != null && period.status !== "draft";
  const pctSo = sua ? Number(sua.pct.replace(",", ".")) : NaN;
  const pctHopLe = sua != null && sua.pct.trim() !== "" && pctSo >= 0 && pctSo <= 100;

  return (
    <div className="ns-modal" role="dialog" aria-modal="true">
      <div className="ns-modal__box ns-modal__box--wide">
        <header className="ns-modal__head">
          <h2>
            Hoa hồng — {line.employee_name}
            <span className="lg-soikm__ky">
              {" "}
              kỳ {String(period.month).padStart(2, "0")}/{period.year}
            </span>
          </h2>
          <button className="ns-modal__x" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </header>
        <div className="ns-modal__body">
          {loi && <div className="banner banner--error">{loi}</div>}
          {dangTinh && (
            <div className="banner banner--info" role="status">
              Đang tính lại bảng lương để cột Hoa hồng nhận % mới…
            </div>
          )}
          {lech && (
            <div className="banner banner--warn" role="status">
              Tổng chi tiết ({money(data!.tong)}) khác cột Hoa hồng trên bảng lương (
              {money(line.hoa_hong ?? 0)})
              {kyChot ? (
                " — kỳ đã chốt nên cột giữ số lúc chốt."
              ) : (
                <>
                  {" "}
                  — bấm <b>Tính lại</b> để đồng bộ.
                </>
              )}
            </div>
          )}
          {data == null && !loi && (
            <EmptyState trangThai="dang-tai" inline nhanTai="Đang tải chi tiết…" />
          )}
          {data != null && data.items.length === 0 && (
            <p className="cc-note">Kỳ này không có lần thu tiền nào của đơn người này phụ trách.</p>
          )}
          {data != null && data.items.length > 0 && (
            <div className="ns__tablewrap lg-soihh">
              <table className="ns__table lg-soikm">
                <thead>
                  <tr>
                    <th>Phiếu thu</th>
                    <th>Đơn</th>
                    <th>Hoá đơn</th>
                    <th>Ngày HĐ</th>
                    <th>Ngày thu</th>
                    <th className="lg-num">Số ngày</th>
                    <th className="lg-num">Tiền thu</th>
                    <th className="lg-num">Gốc</th>
                    <th className="lg-num">%</th>
                    <th className="lg-num">Hoa hồng</th>
                    {coQuyenSua && <th aria-label="Thao tác" />}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((k, i) => (
                    <Fragment key={i}>
                      <tr>
                        <td>{k.so_phieu ?? `#${k.receipt_id}`}</td>
                        <td>{k.order_no ?? `#${k.order_id}`}</td>
                        <td>
                          {k.invoice_no ?? (k.ngay_hoa_don ? "—" : "Tiền cọc")}
                          {k.hoa_don_huy && <div className="cc-note">đã huỷ</div>}
                        </td>
                        <td>{ngay(k.ngay_hoa_don)}</td>
                        <td>{ngay(k.ngay_thu)}</td>
                        <td className="lg-num">{k.so_ngay}</td>
                        <td className="lg-num">{money(k.tien_thu)}</td>
                        <td className="lg-num">{money(Math.round(k.goc))}</td>
                        <td className="lg-num">
                          {phanTram(k.pct)}
                          {k.pct_rieng && <div className="cc-note">% riêng</div>}
                        </td>
                        <td className="lg-num">{money(Math.round(k.tien))}</td>
                        {coQuyenSua && (
                          <td>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() =>
                                setSua({
                                  orderId: k.order_id,
                                  dong: i,
                                  pct: k.pct_rieng ? String(+(k.pct * 100).toFixed(4)) : "",
                                  lyDo: k.pct_rieng ? (k.ly_do_rieng ?? "") : "",
                                  coRieng: k.pct_rieng,
                                })
                              }
                            >
                              Đặt % riêng
                            </button>
                          </td>
                        )}
                      </tr>
                      {sua?.dong === i && (
                        <tr>
                          <td colSpan={11}>
                            <div className="lg-hhrieng">
                              <p className="cc-note">
                                % riêng của đơn{" "}
                                {k.order_no ?? `#${k.order_id}`}{" "}
                                thắng biểu cho mọi lần thu của đơn này. Gõ 0 để không tính hoa hồng đơn này.
                              </p>
                              <label>
                                % hoa hồng riêng
                                <input
                                  className="rc-input lg-hhrieng__pct"
                                  inputMode="decimal"
                                  value={sua.pct}
                                  onChange={(e) => setSua({ ...sua, pct: e.target.value })}
                                />
                              </label>
                              <label>
                                Lý do
                                <input
                                  className="rc-input"
                                  maxLength={255}
                                  value={sua.lyDo}
                                  onChange={(e) => setSua({ ...sua, lyDo: e.target.value })}
                                />
                              </label>
                              <button
                                type="button"
                                className="btn btn--accent btn--sm"
                                disabled={dangLuu || !pctHopLe || !sua.lyDo.trim()}
                                onClick={() => luu(pctSo / 100)}
                              >
                                Lưu % riêng
                              </button>
                              {sua.coRieng && (
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  disabled={dangLuu}
                                  onClick={() => luu(null)}
                                >
                                  Bỏ % riêng
                                </button>
                              )}
                              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSua(null)}>
                                Thôi
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="lg-foot">
                    <td colSpan={6}>Cộng {data.items.length} lần thu</td>
                    <td className="lg-num">{money(data.items.reduce((s, k) => s + k.tien_thu, 0))}</td>
                    <td colSpan={2} />
                    <td className="lg-num">{money(data.tong)}</td>
                    {coQuyenSua && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="cc-note">
            Số này <b>máy tự tính</b> theo tiền thu về trong kỳ. Sai tiền thu thì sửa ở phiếu thu bên Kế
            toán rồi bấm <b>Tính lại</b>.
          </p>
        </div>
        <footer className="ns-modal__foot">
          <button className="btn btn--ghost" onClick={onClose}>
            Đóng
          </button>
        </footer>
      </div>
    </div>
  );
}
