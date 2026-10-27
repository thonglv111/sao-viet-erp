// Hàm dùng chung của màn Yêu cầu mua hàng (tách từ pages/DepartmentPurchaseRequestsPage.tsx).
import type {
  DepartmentPurchaseRequestInput,
  DepartmentPurchaseRequestLineInput,
  DepartmentPurchaseRequestLineOut,
  DepartmentPurchaseRequestRow,
  DepartmentPurchaseSourceType,
} from "../../../../api/client";
import { chuanKho, coKho } from "../../../../lib/khoGiay";
import { homNayVN } from "../../../../utils/ky";

export function emptyLine(): DepartmentPurchaseRequestLineInput {
  return {
    item_name: "",
    unit: "",
    quantity: 0,
    note: "",
  };
}

export function emptyRequest(
  sourceType: DepartmentPurchaseSourceType | null = null,
): DepartmentPurchaseRequestInput {
  return {
    source_type: sourceType,
    loai_mua: "theo_yeu_cau",
    related_document_type: null,
    related_document_code: null,
    content: "",
    needed_date: "",
    note: null,
    lines: [emptyLine()],
  };
}

/** Nội dung để HIỆN. Phiếu lập trước 07/08/2026 chưa có ô gộp ⇒ nối lại hai ô cũ. */
export function noiDungCu(purpose: string | null, note: string | null): string {
  return [purpose, note].map((x) => (x ?? "").trim()).filter(Boolean).join(" — ");
}

export function noiDung(row: DepartmentPurchaseRequestRow): string {
  return row.content?.trim() || noiDungCu(row.purpose, row.note);
}

/** Món CÒN SỐNG trong yêu cầu. Món bị bỏ vẫn được máy chủ trả về (kèm ai bỏ · lúc nào · vì sao)
 *  để còn tra lại, nên mọi chỗ đếm/xem-trước phải lọc, không thì con số phồng lên vô nghĩa. */
export function dongSong(
  row: DepartmentPurchaseRequestRow,
): DepartmentPurchaseRequestLineOut[] {
  return row.lines.filter((line) => !line.cancelled_at);
}

/** Món đang nằm trên một đơn mua CÒN CHẠY. Đơn đã huỷ hay bị trả vẫn hiện ở chi tiết món (để biết
 *  lịch sử), nhưng không tính là "đã có đơn" — thu mua còn phải lập lại. */
export function coDonSong(line: DepartmentPurchaseRequestLineOut): boolean {
  const st = line.fulfilment?.purchase_status;
  return !!st && st !== "cancelled" && st !== "rejected";
}

/** Phiếu đã có chữ người dùng gõ chưa (ngày, nội dung, hoặc món). Dòng trống mồi sẵn không đếm. Dùng để
 *  hỏi trước khi đóng ngăn Tạo yêu cầu: bấm nhầm ra nền là mất hết, không có đường quay lại. */
export function phieuCoDuLieu(f: DepartmentPurchaseRequestInput): boolean {
  if (f.content.trim() || f.needed_date) return true;
  return f.lines.some((l) =>
    !!(l.hang_loai || l.item_name.trim() || (l.note ?? "").trim() || Number(l.quantity) > 0));
}

export function todayInputValue(): string {
  return homNayVN();
}

/** Chuẩn hoá phiếu trước khi gửi máy chủ (nguyên văn từ file gốc, chỉ bỏ 2 dấu cách thụt đầu
 *  dòng do được nâng từ trong component ra ngoài module). */
export function cleanRequest(
  input: DepartmentPurchaseRequestInput,
): DepartmentPurchaseRequestInput {
  const trimOptional = (v?: string | null) => {
    const s = (v ?? "").trim();
    return s || null;
  };
  return {
    source_type: input.source_type ?? null,
    // Cho lệnh SX do máy chủ chốt từ `nguon_lenh` — gửi lại khi sửa sẽ bị chặn, nên không gửi.
    loai_mua: input.loai_mua && input.loai_mua !== "cho_lsx" ? input.loai_mua : null,
    // GIỮ vết chứng từ nguồn thay vì xoá trắng (20/08/2026). Trước đây hai ô này luôn bị nullhoá
    // vì form gõ tay không có chỗ nhập chúng — nhưng nó cũng xoá luôn vết của phiếu ĐI TỪ màn
    // khác sang (Kế hoạch vật tư gửi mã lệnh), và xoá cả lúc SỬA một phiếu vốn đã có vết. Người
    // mua mở phiếu ra không còn biết mua cho lệnh nào; `openEdit` nạp vào rồi lưu là mất.
    related_document_type: trimOptional(input.related_document_type),
    related_document_code: trimOptional(input.related_document_code),
    content: (input.content ?? "").trim(),
    needed_date: (input.needed_date ?? "").trim(),
    note: null,
    lines: input.lines.map((line) => ({
      // Cặp mặt hàng gốc đi kèm: phiếu mua sinh sau đó nối thẳng về đúng món, không ghép bằng tên.
      hang_loai: line.hang_loai ?? null,
      hang_id: line.hang_id ?? null,
      item_name: (line.item_name ?? "").trim(),
      unit: (line.unit ?? "").trim(),
      quantity: Number(line.quantity),
      note: trimOptional(line.note),
      // Khổ CẦN: giấy + vật tư (khổ tuỳ chọn, 27/10/2026); server ép 0 cho hàng khác.
      ...(() => {
        const [kho_rong, kho_dai] =
          coKho(line.hang_loai) ? chuanKho(line.kho_rong, line.kho_dai) : [0, 0];
        return { kho_rong, kho_dai };
      })(),
    })),
    // Lệnh nguồn chỉ có khi form mở từ Kế hoạch vật tư — form gõ tay / form sửa không mang theo.
    ...(input.nguon_lenh?.length ? { nguon_lenh: input.nguon_lenh } : {}),
  };
}

/** Dòng yêu cầu mua là GIẤY — có ô khổ (hai cạnh hoặc chỉ rộng) và ĐVT tự chọn (tờ, ram, kg…).
 *  10/10/2026 bỏ dạng cuộn/tờ: đơn vị gốc máy chủ suy từ ĐVT, form không đoán dạng theo khổ nữa. */
export function laGiayDong(line: Pick<DepartmentPurchaseRequestLineInput, "hang_loai">): boolean {
  return line.hang_loai === "giay";
}
