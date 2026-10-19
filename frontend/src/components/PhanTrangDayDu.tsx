import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { laDienThoai } from "../utils/dienThoai";
import "./phan-trang-day-du.css";

/** Dãy ô trang để vẽ "1 · 2 · 3 … n": luôn giữ trang ĐẦU và trang CUỐI, cộng một cửa sổ quanh
 *  trang đang xem, chỗ đứt thì chèn "…". Không đổ hết n nút ra vì lọc 30 ngày ở Nhật ký đã ra ngót
 *  trăm trang — một hàng nút dài bằng màn hình thì không ai bấm trúng. */
export function dayTrang(hienTai: number, tong: number): (number | "…")[] {
  const TOI_DA = 7;
  if (tong <= TOI_DA) return Array.from({ length: tong }, (_, i) => i + 1);
  const giu = new Set<number>([1, tong, hienTai, hienTai - 1, hienTai + 1]);
  // Ở sát hai đầu thì nới cửa sổ về phía còn lại, để số ô luôn bằng nhau — dãy không co giãn
  // giật cục mỗi lần bấm.
  if (hienTai <= 3) [2, 3, 4].forEach((n) => giu.add(n));
  if (hienTai >= tong - 2) [tong - 1, tong - 2, tong - 3].forEach((n) => giu.add(n));
  const ds = [...giu].filter((n) => n >= 1 && n <= tong).sort((a, b) => a - b);
  const ra: (number | "…")[] = [];
  ds.forEach((n, i) => {
    if (i > 0 && n - ds[i - 1] > 1) ra.push("…");
    ra.push(n);
  });
  return ra;
}

export const CO_TRANG_MAC_DINH = [15, 25, 50, 100];

/** Chân bảng phân trang ĐẦY ĐỦ — khuôn của màn Nhật ký (05/10/2026 dời ra đây, rồi phủ mọi
 *  bảng danh sách của sidebar): bên trái "Trang x/y · n dòng / tổng N", bên phải ô Dòng/trang + dãy số trang.
 *
 *  Khác `Pager` (tổng + Trước/Sau): dành cho bảng DÀI mà người dùng hay nhảy xa hoặc muốn xem
 *  nhiều dòng một lượt. Cả hai đều cắt trang Ở MÁY CHỦ — `tong` phải là tổng máy chủ trả. */
export function PhanTrangDayDu({
  trang,
  size,
  tong,
  soDong,
  onTrang,
  onSize,
  coTrang = CO_TRANG_MAC_DINH,
  loading,
  donVi = "bản ghi",
  hauTo,
  ghiChu,
  ariaLabel = "Phân trang",
}: {
  trang: number;
  size: number;
  /** Tổng máy chủ trả. `null` = chưa biết (Nhật ký khi máy chủ không đếm) — khi đó chỉ nói số dòng. */
  tong: number | null;
  /** Số dòng đang hiện ở trang này. */
  soDong: number;
  onTrang: (trang: number) => void;
  /** Vắng ⇒ không bày ô Dòng/trang. */
  onSize?: (size: number) => void;
  coTrang?: number[];
  loading?: boolean;
  donVi?: string;
  /** Chữ nối sau tổng, vd "khớp bộ lọc". */
  hauTo?: string;
  /** Câu lưu ý in sau dòng thông tin, vd "duyệt hàng loạt chỉ áp cho trang đang xem". */
  ghiChu?: ReactNode;
  ariaLabel?: string;
}) {
  const tongSoTrang = Math.max(1, Math.ceil((tong ?? soDong) / Math.max(1, size)));
  // Màn có cỡ trang riêng (KCS 30…) mà ô chọn thiếu số đó thì trình duyệt hiện số ĐẦU danh sách —
  // người dùng tưởng đang xem 15 dòng. Chen cỡ đang dùng vào cho ô luôn nói thật.
  const luaChon = coTrang.includes(size) ? coTrang : [...coTrang, size].sort((a, b) => a - b);
  // Điện thoại: chân trang nằm cuối danh sách thẻ dài — sang trang mà màn đứng yên thì thấy ngay đuôi
  // trang mới. Đưa màn về đầu.
  const sang = (p: number) => {
    onTrang(p);
    if (laDienThoai()) document.querySelector(".shell__content")?.scrollTo({ top: 0 });
  };
  return (
    <footer className="ptdd">
      <div className="ptdd__info">
        {/* Hai mẩu thông tin tách bằng khoảng trống, không nối bằng dấu "·". */}
        <span>Trang <strong>{trang}</strong>/{tongSoTrang}</span>
        <span className="ptdd__phan">
          {soDong} dòng
          {tong != null && (
            <>
              {" "}/ tổng <strong>{tong}</strong> {donVi}{hauTo ? ` ${hauTo}` : ""}
            </>
          )}
        </span>
        {ghiChu && <span className="ptdd__ghichu">{ghiChu}</span>}
      </div>

      <div className="ptdd__nav">
        {onSize && (
          <label className="ptdd__size">
            <span>Dòng/trang:</span>
            <select value={size} onChange={(e) => onSize(Number(e.target.value))}>
              {luaChon.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}

        <nav className="ptdd__btns" aria-label={ariaLabel}>
          <button type="button" className="ptdd__mui" disabled={trang <= 1 || loading}
            onClick={() => sang(trang - 1)} title="Trang trước" aria-label="Trang trước">
            <ChevronLeft size={14} />
          </button>
          {dayTrang(trang, tongSoTrang).map((o, i) =>
            o === "…" ? (
              <span className="ptdd__dots" key={`d${i}`} aria-hidden="true">…</span>
            ) : (
              <button type="button" key={o}
                className={`ptdd__so${o === trang ? " ptdd__so--active" : ""}`}
                disabled={loading}
                aria-current={o === trang ? "page" : undefined}
                onClick={() => o !== trang && sang(o)}>
                {o}
              </button>
            ),
          )}
          <button type="button" className="ptdd__mui" disabled={trang >= tongSoTrang || loading}
            onClick={() => sang(trang + 1)} title="Trang sau" aria-label="Trang sau">
            <ChevronRight size={14} />
          </button>
        </nav>
      </div>
    </footer>
  );
}
