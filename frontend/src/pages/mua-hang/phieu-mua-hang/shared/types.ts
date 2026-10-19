// Kiểu dữ liệu riêng của màn Mua hàng (tách từ pages/PurchaseRequestsPage.tsx).
import type {
  DepartmentPurchaseWorkflowStatus,
  HangLoai,
  LoaiMua,
  MuaChoLenh,
  NacKho,
  PurchaseDeliveryRow,
  PurchaseRequestInput,
  PurchaseRequestLineInput,
  PurchaseRequestRow,
  PurchaseRequestStatus,
} from "../../../../api/client";

/** Nhóm lọc Hàng: trạng thái đơn, riêng "Đã về đủ" tách ba nấc kho (11/10/2026). */
export type StatusFilter = "all" | PurchaseRequestStatus | NacKho;
export type SourceStatusFilter = "all" | DepartmentPurchaseWorkflowStatus;
export type DepositFilter = "all" | "none" | "unpaid" | "partial" | "enough";

/** Hai tab con của màn Mua hàng (chốt 08/08/2026).
 *
 * Trước đó hai bảng XẾP DỌC trong cùng một màn: đo thật ở 1440×900 (vùng nhìn 843px) thì dòng đầu
 * của bảng phiếu mua bắt đầu ở y≈812 — người dùng chỉ thấy 34% một dòng, và mỗi yêu cầu mới ở
 * bảng trên lại đẩy bảng dưới xuống thêm 68px (5 yêu cầu chờ là bảng phiếu biến mất hẳn).
 * Tách tab để mỗi bảng có nguyên khung nhìn. ĐỪNG gộp lại thành một trang cuộn dọc. */
export type PurchaseTab = "yeu-cau" | "phieu";

/** Dòng hàng trong FORM — mang thêm NCC của riêng nó.
 *
 * Một phiếu mua là thoả thuận với MỘT nhà cung cấp, nhưng một yêu cầu thường chứa hàng của nhiều
 * nơi. Nên NCC gán ở DÒNG, rồi lúc gửi mới nhóm lại thành N phiếu. Ô "Nhà cung cấp" ở đầu phiếu
 * chỉ còn dùng cho chế độ SỬA (phiếu đã tồn tại thì nó vốn đã thuộc về một NCC). */
export type FormLine = PurchaseRequestLineInput & {
  supplier_id?: number | null;
  /** Dòng YCMH đẻ ra dòng này — gửi lên để chi tiết yêu cầu hiện được tình trạng từng sản phẩm. */
  department_request_line_id?: number | null;
  /** Liên kết mặt hàng gốc (mg 0174) — form SỬA phải đọc lại từ phiếu, không thì lưu đè thành rỗng. */
  hang_loai?: HangLoai | null;
  hang_id?: number | null;
  /** Lúc TẠO đơn từ yêu cầu: dòng có được đưa vào đơn này không. `false` = bỏ tick ⇒ không gửi,
   *  dòng yêu cầu vẫn mở (muốn đóng hẳn thì huỷ dòng ở phiếu yêu cầu). Vắng = có. */
  chon?: boolean;
  /** Chỉ để HIỆN trên form (không gửi): món của yêu cầu nào, mua cho lệnh nào / tồn kho. */
  yeu_cau_ma?: string | null;
  loai_mua?: LoaiMua | null;
  mua_cho?: MuaChoLenh[];
  /** Chỉ để HIỆN (không gửi): số lượng + ĐVT bộ phận đề nghị, giữ lại khi dòng đổi ĐVT vì chọn
   *  NCC bán khác họ đơn vị — số lượng bị xoá, người lập nhìn số gốc này mà quy đổi. Vắng = chưa đổi. */
  de_nghi?: { so: number; unit: string } | null;
};

/** Dòng có vào đơn đang lập không (vắng cờ = có). */
export const dongDuocChon = (line: FormLine) => line.chon !== false;

export type FormState = Omit<PurchaseRequestInput, "lines"> & { lines: FormLine[] };

export type ChaoGia = {
  supplier_id: number;
  supplier_name: string;
  /** Dòng bảng giá cụ thể — một NCC có thể đứng ở cả hai nhóm (bán theo tờ và theo kg). */
  supplier_item_id: number;
  unit_price: number;
  vat_percent: number;
  unit: string;
  /** Đơn giá quy về đ/đơn-vị-gốc của CHÍNH dòng giá. `null` = chưa quy đổi được — xếp cuối. */
  gia_quy_doi: number | null;
  /** Số điền vào ô đơn giá khi chọn: cùng họ ⇒ giá quy về ĐVT của dòng đơn; khác họ ⇒ giá NCC báo
   *  theo đơn vị của họ. `null` = không quy được — để trống cho người lập gõ, KHÔNG lấy đại giá thô. */
  gia_dong: number | null;
  /** Cùng họ đơn vị với ĐVT dòng đơn (10/10/2026). false = NCC chỉ bán cùng mã + cùng khổ theo
   *  đơn vị KHÁC họ (dòng tính tờ, NCC bán kg): không xếp hạng, không tự gán; chọn thì dòng đơn đổi
   *  sang đơn vị của NCC và xoá số lượng để người lập gõ lại. */
  cung_ho: boolean;
  /** Dòng giá đúng khổ dòng đơn. false = dòng giá khổ 0 · 0 (NCC bán mọi khổ) — xếp sau. */
  dung_kho: boolean;
};

/** Một file hoá đơn ĐANG CHỜ tải lên. `url` là `blob:` để xem trước — rỗng với PDF (thẻ `<img>`
 *  không dựng được PDF, ô đó hiện icon thay vì ảnh) nên đừng cấp URL để rồi không dùng. */
export type AnhCho = { file: File; url: string };

/** Bảng xem trước "sẽ tạo mấy phiếu" — gom dòng theo NCC (memo `phieuSeTao` ở shell). */
export type PhieuSeTao = { ten: string; soDong: number; tien: number };

// --- Kiểu của các hộp thoại mở từ shell -------------------------------------
// Shell vẫn khai `useState<null | {...}>` bằng kiểu viết thẳng (giữ nguyên chú thích tại chỗ);
// mấy tên dưới đây là CÙNG hình dạng đó, để component con khai prop mà khỏi chép lại cả khối.

export type ReasonModalState = {
  kind: "cancel";
  row: PurchaseRequestRow;
  reason: string;
  error: string | null;
};

export type ReceiveModalState = {
  row: PurchaseRequestRow;
  mode: "receive" | "edit";
};

export type DeliveryModalState = {
  row: PurchaseRequestRow;
  delivery: PurchaseDeliveryRow | null;
};

export type DeletingDeliveryState = {
  row: PurchaseRequestRow;
  delivery: PurchaseDeliveryRow;
};

export type CloseModalState = {
  row: PurchaseRequestRow;
  reason: string;
  error: string | null;
};
