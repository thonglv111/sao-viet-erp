// Hạn mức và tiền đang nợ NCC của MỘT đơn mua, cho ngăn chi tiết đơn (15/10/2026).
import { useEffect, useState } from "react";
import { api, type PurchaseRequestRow, type SupplierCredit } from "../../../../api/client";

/** Hỏi lại khi những trường làm đổi tiền nợ NCC của đơn đổi, không chỉ khi đổi đơn (lỗi #22): ghi
 *  đợt giao xong danh sách thay dòng bằng bản mới cùng id, mà "Đang nợ nhà cung cấp" vừa đổi theo.
 *  Không theo tham chiếu cả bản ghi: danh sách nạp lại (SSE) đẻ bản mới y hệt là lại gọi API thừa
 *  (rà cuối 19/10/2026). Hỏng thì nuốt — đây là cảnh báo phụ. */
export function useHanMucNcc(token: string | null | undefined, don: PurchaseRequestRow) {
  const [credit, setCredit] = useState<SupplierCredit | null>(null);
  useEffect(() => {
    if (!token || don.supplier_id == null) {
      setCredit(null);
      return;
    }
    let bo = false;
    api.purchaseRequests
      .supplierCredit(token, don.id)
      .then((data) => { if (!bo) setCredit(data); })
      .catch(() => { if (!bo) setCredit(null); });
    return () => { bo = true; };
  }, [token, don.id, don.supplier_id, don.status, don.updated_at, don.gia_tri_da_giao, don.paid_amount,
      don.outstanding_amount]);
  return credit;
}
