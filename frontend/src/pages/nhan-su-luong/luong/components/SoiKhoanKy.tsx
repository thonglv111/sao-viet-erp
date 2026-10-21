// Bảng đối chiếu tiền khoán sản lượng của một dòng lương (21/10/2026) — cùng khuôn `SoiKhoanKm`.
import { useEffect, useState } from "react";
import {
  api,
  type KhoanKyChiTiet,
  type KhoanKyDong,
  type PayrollLine,
  type PayrollPeriod,
} from "../../../../api/client";
import { money } from "../shared/helpers";
import { EmptyState } from "../../../../components/EmptyState";

const NHAN: Record<KhoanKyDong["loai"], string> = {
  lan_ghi: "Lần ghi",
  tang_ca_khoan: "Tăng ca khoán",
  to_truong: "Tổ trưởng",
  to_truong_tru: "Trích cho tổ trưởng",
};

// "2026-10-21" → "21/10" (toLocaleDateString cho ra "21-10" trên Chrome).
const ngayVn = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");

/** Từng lần ghi sản lượng, tăng ca khoán và phần tổ trưởng làm nên cột "Khoán SP". CHỈ XEM: sai số
 *  thì sửa ở lần ghi (bàn tổ) hoặc giá ở Danh mục → Công đoạn → tab Khoán, rồi Tính lại. */
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

  const veThoiGian = line.ve_thoi_gian ?? null;
  const veKhoan = (line.khoan ?? 0) + (line.khoan_km ?? 0) + (data?.tong_tang_ca_khoan ?? line.tang_ca_khoan ?? 0);

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
          {veThoiGian != null && (
            <div className="banner banner--info" role="status">
              So 2 lương: lương khoán {money(veKhoan)} (sản lượng + tăng ca khoán) — lương thời gian{" "}
              {money(veThoiGian)} (theo công + tăng ca theo giờ) ⇒{" "}
              <b>{line.lay_bu_lo ? "ăn lương thời gian" : "ăn lương khoán"}</b>.
            </div>
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
                    <th>Khoản</th>
                    <th>Công đoạn / tổ</th>
                    <th className="lg-num">Số lượng</th>
                    <th className="lg-num">Tiền lần ghi</th>
                    <th className="lg-num">Số người</th>
                    <th className="lg-num">Phần hưởng</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((d, i) => (
                    <tr key={i}>
                      <td>{ngayVn(d.ngay)}</td>
                      <td>{NHAN[d.loai]}</td>
                      <td>
                        {[d.cong_doan, d.to].filter(Boolean).join(" — ")}
                        {d.ghi_chu && <div className="cc-note">{d.ghi_chu}</div>}
                      </td>
                      <td className="lg-num">{d.so_luong != null ? d.so_luong.toLocaleString("vi-VN") : ""}</td>
                      <td className="lg-num">{d.tien_lan_ghi != null ? money(d.tien_lan_ghi) : ""}</td>
                      <td className="lg-num">{d.so_nguoi ?? ""}</td>
                      <td className="lg-num">{money(d.tien)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="lg-foot">
                    <td colSpan={6}>Lương khoán sản lượng</td>
                    <td className="lg-num">{money(data.tong_khoan)}</td>
                  </tr>
                  {data.tong_tang_ca_khoan !== 0 && (
                    <tr className="lg-foot">
                      <td colSpan={6}>Tăng ca khoán</td>
                      <td className="lg-num">{money(data.tong_tang_ca_khoan)}</td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          )}
          <p className="cc-note">
            Số này <b>máy tự tính</b> từ các lần ghi sản lượng, giá lấy theo tổ của lần ghi. Sai số
            lượng thì sửa ở bàn tổ; sai giá thì sửa ở <b>Danh mục → Công đoạn → tab Khoán</b> rồi bấm{" "}
            <b>Tính lại</b>.
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
