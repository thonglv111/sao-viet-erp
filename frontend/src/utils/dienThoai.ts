// MỐC ĐIỆN THOẠI DUY NHẤT của cả hệ thống (thiết kế mobile 14/10/2026 — docs/thiet-ke-mobile.md).
//
// ≤ 639px = điện thoại: giao diện RIÊNG (thẻ thay hàng bảng, thanh dưới, hộp thoại toàn màn…).
// ≥ 640px (iPad mini dọc 744px trở lên, laptop, PC) giữ NGUYÊN — không một luật nào của lớp điện
// thoại được chạm tới. CSS điện thoại chỉ nằm trong `src/styles/mobile/*.css`, mỗi khối bọc đúng
// `@media (max-width: 639px)` (guard `mobile.test.ts` bắt lọt mốc). JS chỉ đổi CẤU TRÚC qua hook
// dưới đây — đổi màu / cỡ chữ / bố cục thuần thì để CSS lo.
import { useSyncExternalStore } from "react";

export const MOC_DIEN_THOAI = 639;
export const MQ_DIEN_THOAI = `(max-width: ${MOC_DIEN_THOAI}px)`;

function mq(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(MQ_DIEN_THOAI);
}

function dangKy(bao: () => void): () => void {
  const m = mq();
  if (!m) return () => {};
  m.addEventListener("change", bao);
  return () => m.removeEventListener("change", bao);
}

/** Đang ở màn điện thoại (≤ 639px)? Tự cập nhật khi xoay máy / đổi cỡ cửa sổ. Không có
 *  `matchMedia` (jsdom trong test, SSR) thì coi là KHÔNG phải điện thoại — giữ giao diện máy tính. */
export function laDienThoai(): boolean {
  return mq()?.matches ?? false;
}

export function useLaDienThoai(): boolean {
  return useSyncExternalStore(dangKy, laDienThoai, () => false);
}

/** Ô GÕ CHỮ (bật bàn phím ảo): ô nhập chữ/số/ngày, textarea, contenteditable. Không tính checkbox,
 *  radio, nút, thanh trượt… và `select` (mở bảng chọn của máy, không bật bàn phím). */
export function laOGo(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  if (el.tagName !== "INPUT") return false;
  // `inputmode="none"`: ô chỉ để chạm mở bộ chọn (ngày / giờ — ChonNgay) — không bật bàn phím.
  if ((el.getAttribute("inputmode") || "").toLowerCase() === "none") return false;
  const t = ((el as HTMLInputElement).type || "text").toLowerCase();
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image", "hidden"].includes(t);
}

/** Theo dõi BÀN PHÍM ẢO trên điện thoại (14/10/2026 — trình duyệt máy tính không có bàn phím ảo nên
 *  lỗi "bàn phím che mất ô đang gõ" không hiện khi thử trên máy):
 *  - `--ban-phim` (px) trên `<html>` = phần màn bàn phím đang che, đo bằng `visualViewport`. Android
 *    đã co trang theo bàn phím (`interactive-widget=resizes-content` ở index.html) nên số này ≈ 0; iPhone
 *    không co trang ⇒ số này là chiều cao bàn phím — CSS dùng nó để đẩy bảng đáy / chân hộp lên trên.
 *  - lớp `dang-go` trên `<html>` khi một ô gõ chữ đang được focus ⇒ CSS giấu thanh tab dưới (không thì
 *    nó nổi lên ngay trên bàn phím, ăn mất chỗ của ô đang gõ).
 *  Trả về hàm gỡ theo dõi. */
export function theoDoiBanPhim(goc: HTMLElement = document.documentElement): () => void {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  let truoc = -1;
  const doBanPhim = () => {
    const che = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
    goc.style.setProperty("--ban-phim", `${che}px`);
    // Bàn phím vừa bật / đổi cỡ: khung đã co lại theo `--ban-phim` ⇒ kéo ô đang gõ vào phần còn thấy.
    if (che !== truoc && che > 0 && laOGo(document.activeElement)) {
      const o = document.activeElement as HTMLElement;
      window.requestAnimationFrame(() => o.scrollIntoView?.({ block: "nearest" }));
    }
    truoc = che;
  };
  const vao = (e: FocusEvent) => {
    if (laOGo(e.target)) goc.classList.add("dang-go");
  };
  const ra = () => {
    // Chuyển từ ô này sang ô khác: focusout chạy trước focusin của ô mới — đợi một nhịp mới xét.
    window.setTimeout(() => {
      if (!laOGo(document.activeElement)) goc.classList.remove("dang-go");
    }, 0);
  };
  doBanPhim();
  vv?.addEventListener("resize", doBanPhim);
  vv?.addEventListener("scroll", doBanPhim);
  document.addEventListener("focusin", vao);
  document.addEventListener("focusout", ra);
  return () => {
    vv?.removeEventListener("resize", doBanPhim);
    vv?.removeEventListener("scroll", doBanPhim);
    document.removeEventListener("focusin", vao);
    document.removeEventListener("focusout", ra);
    goc.classList.remove("dang-go");
    goc.style.removeProperty("--ban-phim");
  };
}
