// Hộp bật lên NGAY DƯỚI một ô của bảng — sửa nhanh tại chỗ, khỏi mở ngăn chi tiết (bảng công đoạn
// của lệnh, phương án B 28/10/2026). Treo ở `document.body` + `position: fixed` để không bị khung
// cuộn ngang của bảng cắt mất.
//
// Đóng: bấm ra ngoài hoặc Xong = GIỮ thay đổi (sửa trên bản nháp, chưa bấm "Lưu công đoạn" thì lệnh
// chưa đổi); Esc hoặc Huỷ = trả lại như lúc mở. Cuộn trang thì đóng — hộp đứng yên trong khi ô chạy
// đi là đọc nhầm hàng.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./popover-o.css";

export function PopoverO({
  anchor,
  onDong,
  onHuy,
  width = 300,
  label,
  role = "dialog",
  children,
}: {
  /** Ô đã bấm — hộp canh theo nó, đóng xong trả tiêu điểm về nó. */
  anchor: HTMLElement;
  /** Đóng và GIỮ thay đổi. */
  onDong: () => void;
  /** Đóng và trả lại như lúc mở. Không truyền ⇒ hộp không có nút Huỷ/Xong (vd menu). */
  onHuy?: () => void;
  width?: number;
  label: string;
  role?: "dialog" | "menu";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 0;
    const duoi = r.bottom + 6;
    // Hết chỗ phía dưới ⇒ lật lên trên ô.
    const top = duoi + h > window.innerHeight - 8 && r.top - 6 - h > 8 ? r.top - 6 - h : duoi;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 16));
    setPos({ top, left });
  }, [anchor, width]);

  useEffect(() => {
    const dau = ref.current?.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    dau?.focus();
  }, []);

  useEffect(() => {
    const ngoai = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onDong();
    };
    const phim = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      (onHuy ?? onDong)();
      anchor.focus();
    };
    const cuon = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      onDong();
    };
    document.addEventListener("mousedown", ngoai);
    document.addEventListener("keydown", phim);
    window.addEventListener("scroll", cuon, true);
    return () => {
      document.removeEventListener("mousedown", ngoai);
      document.removeEventListener("keydown", phim);
      window.removeEventListener("scroll", cuon, true);
    };
  }, [anchor, onDong, onHuy]);

  return createPortal(
    <div
      ref={ref}
      className={`popo ${role === "menu" ? "popo--menu" : ""}`}
      role={role}
      aria-label={label}
      style={{ width, top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      {children}
      {onHuy && (
        <div className="popo__ft">
          <button type="button" className="popo__btn" onClick={() => { onHuy(); anchor.focus(); }}>
            Huỷ
          </button>
          <button type="button" className="popo__btn popo__btn--pri" onClick={() => { onDong(); anchor.focus(); }}>
            Xong
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
