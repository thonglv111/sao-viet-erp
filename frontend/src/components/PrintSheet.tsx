// Khuôn phiếu in dùng chung — header (logo · tiêu đề · số/ngày) + overlay preview + nút In.
// Nội dung phiếu (bảng, tổng, chữ ký…) truyền vào qua children. Bám phong cách bản in Báo giá đã duyệt.
import type { ReactNode } from "react";
import svnLogoUrl from "../assets/sao-viet-nhat-logo-mark.png";
import { COMPANY } from "../constants/company";
import "./print-sheet.css";

export function PrintSheet({
  title,
  docNo,
  docDate,
  canPrint,
  onClose,
  children,
  footer,
  chonMau,
  boDauTrang,
  ngang,
}: {
  title: string;
  docNo?: string;
  docDate?: string;
  canPrint?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Ô chọn mẫu in (nằm ở đầu khung xem trước, KHÔNG ra giấy). */
  chonMau?: ReactNode;
  /** Mẫu tự dựng đầu trang (chứng từ theo mẫu MISA / Bộ Tài chính) ⇒ bỏ đầu trang logo mặc định. */
  boDauTrang?: boolean;
  /** In A4 NGANG (vùng chữ 247mm) cho bảng nhiều cột không lọt 160mm của khổ dọc. Chỉ tờ này;
   *  mọi tờ khác vẫn A4 dọc theo `@page` trong print-sheet.css. */
  ngang?: boolean;
}) {
  return (
    <div className="ps-ov" onClick={onClose}>
      {/* `@page` không gắn theo lớp của tờ được ⇒ chèn luật khổ ngang chỉ khi tờ ngang đang mở. Thẻ
          này nằm sau stylesheet trong <head> nên thắng `size: A4`; lề vẫn lấy từ luật gốc. */}
      {ngang && <style>{"@media print { @page { size: A4 landscape; } }"}</style>}
      <div className={`ps-dialog${ngang ? " ps-dialog--ngang" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="ps-dialog-head">
          <h2>Xem trước bản in</h2>
          {chonMau}
          <button onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        <div className={`psheet${ngang ? " psheet--ngang" : ""}`}>
          {!boDauTrang && <header className="ps-mh">
            <div className="ps-logo">
              <img src={svnLogoUrl} alt="SVN" />
            </div>
            <div className="ps-th">
              <h1>{title}</h1>
              <div className="ps-cty">{COMPANY.name}</div>
              <div className="ps-cty">{COMPANY.address}</div>
            </div>
            <div className="ps-meta">
              {docNo && (
                <div>
                  Số: <b>{docNo}</b>
                </div>
              )}
              {docDate && (
                <div>
                  Ngày: <b>{docDate}</b>
                </div>
              )}
            </div>
          </header>}
          {children}
          {/* Không có chân trang mặc định: tên công ty đã nằm ngay dưới tiêu đề, còn "In lúc…"
              là dấu vết hệ thống — chứng từ gửi khách không cần. Màn nào cần thì tự truyền `footer`. */}
          {footer}
        </div>
        <div className="ps-dialog-actions">
          <button className="btn btn--secondary" onClick={onClose}>
            Đóng
          </button>
          {(canPrint ?? true) && (
            <button className="btn btn--primary" onClick={() => window.print()}>
              In / Lưu PDF
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
