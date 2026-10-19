// Hằng dùng chung của màn Phiếu chi (tách từ pages/PaymentVoucherDialog.tsx).
import type { PaymentStage } from "../../../../api/client";

// `HOM_NAY` ĐÃ GỠ (đặc tả A.14): hằng tính MỘT lần lúc nạp trang và theo giờ UTC — từ 0h tới 7h
// sáng ngày mặc định là HÔM QUA, không chọn được hôm nay. Trần ngày nay gọi `homNayVN()` (utils/ky)
// ngay lúc vẽ ô.

export const STAGE_LABELS: Record<PaymentStage, string> = {
  advance: "Tạm ứng / đặt cọc",
  partial: "Thanh toán một phần",
  final: "Thanh toán tiền hàng",
  other: "Khác",
};
