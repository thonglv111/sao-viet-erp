// Ngăn soi tiền khoán sản lượng của một dòng lương (21/10/2026, làm lại 23/10/2026 theo màn Khoán theo
// tổ): tiền mỗi lần ghi là số SAU khi trích tổ trưởng, % là phần trên tổng tiền lần ghi, rê chuột ra
// thế số. Tăng ca khoán tách khúc riêng vì không đem so hai lương.
import { useEffect, useState, type ReactNode } from "react";
import {
  api,
  type KhoanKyChiTiet,
  type KhoanKyDong,
  type PayrollLine,
  type PayrollPeriod,
} from "../../../../api/client";
import { money } from "../shared/helpers";
import { EmptyState } from "../../../../components/EmptyState";
import { ChipTT } from "../../../../components/LuoiDs";
import { Hov, pt } from "./HovDong";

// "2026-10-21" → "21/10" (toLocaleDateString cho ra "21-10" trên Chrome).
const ngayVn = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "cả tháng");

/** Phần của người này trên TỔNG tiền dòng (%, sau khi trích tổ trưởng) + bong bóng thế số. */
function Phan({ d }: { d: KhoanKyDong }) {
  if (d.ty_le == null) return null;
  const cach = d.ty_le * 100;
  if (d.loai === "to_truong") return <>{pt(cach)}</>;
  if (d.loai === "tang_ca_khoan") {
    return <Hov neo={pt(cach)} rong={420} rows={[
      ["Cách chia", "theo phần sản lượng của người này trong ngày"],
      ["Tiền", `${money(d.tien_lan_ghi ?? 0)} × ${pt(cach)} = ${money(d.tien)}`],
    ]} />;
  }
  const tt = d.to_truong ?? [];
  const conLai = tt.reduce((x, t) => x * (1 - t / 100), 1) * 100;
  const phan = (conLai * cach) / 100;
  const rows: [string, ReactNode][] = [];
  if (tt.length) rows.push(["Còn lại", `100% − ${tt.map(pt).join(" − ")} tổ trưởng chia = ${pt(conLai)}`]);
  rows.push(["Cách chia", d.luong_bu_lo != null && d.tong_luong_bu_lo != null
    ? `lương bù lỗ ${money(d.luong_bu_lo)} ÷ tổng ${money(d.tong_luong_bu_lo)} của ${d.so_nguoi ?? "?"} người = ${pt(cach)}`
    : pt(cach)]);
  if (tt.length) rows.push(["Phần người này", `${pt(conLai)} × ${pt(cach)} = ${pt(phan)}`]);
  // Lần ghi có ghi chú = ngày ×2 / ngày tổ in ra 0: tiền không còn bằng gốc × %, khỏi bày phép nhân.
  if (!(d.loai === "lan_ghi" && d.ghi_chu)) {
    const goc = d.loai === "dung_may" ? d.tien_ngay : d.tien_lan_ghi;
    rows.push(["Tiền", `${money(goc ?? 0)} × ${pt(phan)} = ${money(d.tien)}`]);
  }
  return <span className="ktt-pt"><Hov neo={pt(phan)} rong={460} rows={rows} /></span>;
}

function Viec({ d }: { d: KhoanKyDong }) {
  const ten =
    d.loai === "dung_may" ? "Dừng máy" :
    d.loai === "to_truong" ? `Tổ trưởng ${d.ghi_chu ?? ""}` :
    d.loai === "tang_ca_khoan" ? "Tăng ca khoán" : d.cong_doan;
  return (
    <>
      <div>{ten}</div>
      <div className="ktt-sub">{d.to}</div>
      {(d.tuy_chon?.length || d.sua_chua || d.ly_do) ? (
        <div className="lg-soikm__the">
          {d.ly_do && <span>{d.ly_do}</span>}
          {d.sua_chua && <ChipTT mau="vang" vuong>{d.sua_chua}</ChipTT>}
          {d.tuy_chon?.map((t) => <ChipTT key={t} mau="cyan" vuong>{t}</ChipTT>)}
        </div>
      ) : null}
      {d.ghi_chu && d.loai !== "to_truong" && <div className="ktt-sub">{d.ghi_chu}</div>}
      {(d.chua_tinh ?? []).map((x) => <div key={x}><ChipTT mau="cam">{x}</ChipTT></div>)}
    </>
  );
}

function Dong({ d }: { d: KhoanKyDong }) {
  const goc = d.loai === "dung_may" ? d.tien_ngay : d.tien_lan_ghi;
  return (
    <tr>
      <td>{ngayVn(d.ngay)}</td>
      <td><Viec d={d} /></td>
      <td className="lg-num">{d.so_luong != null ? d.so_luong.toLocaleString("vi-VN") : ""}</td>
      <td className="lg-num">{goc != null ? money(goc) : ""}</td>
      <td className="lg-num"><Phan d={d} /></td>
      <td className="lg-num">{money(d.tien)}</td>
    </tr>
  );
}

/** Từng lần ghi sản lượng, ngày dừng máy, phần tổ trưởng và tăng ca khoán làm nên tiền khoán. CHỈ
 *  XEM: sai số thì sửa ở lần ghi (bàn tổ) hoặc giá ở Danh mục → Công đoạn → tab Khoán, rồi Tính lại. */
export function SoiKhoanKy({
  token,
  line,
  period,
  onClose,
}: {
  token: string;
  line: PayrollLine;
  period: PayrollPeriod;
  onClose: () => void;
}) {
  const [data, setData] = useState<KhoanKyChiTiet | null>(null);
  const [loi, setLoi] = useState<string | null>(null);

  useEffect(() => {
    let huy = false;
    api.luong
      .chiTietKhoanKy(token, line.id)
      .then((r) => !huy && setData(r))
      .catch((e: unknown) =>
        !huy && setLoi(e instanceof Error ? e.message : "Không tải được chi tiết"),
      );
    return () => {
      huy = true;
    };
  }, [token, line.id]);

  // Tăng ca khoán KHÔNG vào phép so (chủ chốt 22/10/2026) — cộng sau, ăn bên nào cũng có.
  const buLo = line.bu_lo_theo_cong ?? line.ve_thoi_gian ?? null;
  const veKhoan = (line.khoan ?? 0) + (line.khoan_km ?? 0);
  const tangCaKhoan = data?.tong_tang_ca_khoan ?? line.tang_ca_khoan ?? 0;
  const chinh = (data?.items ?? []).filter((d) => d.loai !== "tang_ca_khoan");
  const tangCa = (data?.items ?? []).filter((d) => d.loai === "tang_ca_khoan");

  return (
    <div className="ns-modal" role="dialog" aria-modal="true">
      <div className="ns-modal__box ns-modal__box--wide">
        <header className="ns-modal__head">
          <h2>
            Lương khoán — {line.employee_name}
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
          {buLo != null && (
            <dl className="lg-soiky__so">
              <div className={line.lay_bu_lo ? "" : "ktt-thang"}>
                <dt>Lương khoán</dt>
                <dd>{money(veKhoan)}</dd>
              </div>
              <div className={line.lay_bu_lo ? "ktt-thang" : ""}>
                <dt>Phân bổ lương bù lỗ</dt>
                <dd>{money(buLo)}</dd>
              </div>
              {tangCaKhoan !== 0 && (
                <div>
                  <dt>Tăng ca khoán cộng thêm</dt>
                  <dd>{money(tangCaKhoan)}</dd>
                </div>
              )}
            </dl>
          )}
          {data == null && !loi && (
            <EmptyState trangThai="dang-tai" inline nhanTai="Đang tải chi tiết…" />
          )}
          {data != null && data.items.length === 0 && (
            <p className="cc-note">Kỳ này không có lần ghi sản lượng nào ra tiền khoán cho người này.</p>
          )}
          {data != null && data.items.length > 0 && (
            <div className="ns__tablewrap">
              <table className="ns__table lg-soikm">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Việc</th>
                    <th className="lg-num">Số lượng</th>
                    <th className="lg-num">Tiền cả tổ</th>
                    <th className="lg-num">Phần</th>
                    <th className="lg-num">Tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {chinh.map((d, i) => <Dong key={i} d={d} />)}
                  <tr className="lg-foot">
                    <td colSpan={5}>Lương khoán</td>
                    <td className="lg-num">{money(data.tong_khoan)}</td>
                  </tr>
                  {tangCa.map((d, i) => <Dong key={`tc${i}`} d={d} />)}
                  {tangCa.length > 0 && (
                    <tr className="lg-foot">
                      <td colSpan={5}>Tăng ca khoán</td>
                      <td className="lg-num">{money(data.tong_tang_ca_khoan)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="cc-note">
            Sai số lượng thì sửa ở bàn tổ, sai giá thì sửa ở Danh mục → Công đoạn → tab Khoán, rồi bấm
            Tính lại.
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
