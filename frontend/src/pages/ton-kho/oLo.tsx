// Mẩu hiển thị dùng chung cho lô kho: bảng tồn và các tab của ngăn mặt hàng.
import type { StockLot } from "../../api/client";

/** Lô thành phẩm KCS mà kế toán chưa gõ giá gốc — `don_gia_nhap` 0 là "chưa biết", không phải miễn phí. */
export function loChuaGiaGoc(lot: StockLot | undefined): boolean {
  return !!lot?.tu_kcs && !lot.don_gia_nhap;
}

export function NhanChuaGiaGoc() {
  return (
    <span className="badge-sem badge-sem--amber" title="Kế toán kho gõ ở Báo cáo kho › Giá gốc thành phẩm">
      Chưa có giá gốc
    </span>
  );
}
