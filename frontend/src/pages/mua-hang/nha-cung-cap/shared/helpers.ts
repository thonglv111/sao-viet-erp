// Hàm dùng chung của màn Nhà cung cấp (tách từ pages/SuppliersPage.tsx).
import type {
  SupplierInput,
  SupplierItemInput,
  SupplierRow,
} from "../../../../api/client";

/** Số ngày kiểu Việt: 8.5 → "8,5", 3 → "3". Dùng cho "trễ TB … ngày" ở cột Đánh giá và hồ sơ NCC.
 *  `null` (chưa trễ đơn nào) → "0" — chỗ gọi phải tự quyết có hiện hay không, đừng in "null". */
export function soNgayVi(v: number | null): string {
  return (v ?? 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
}

/** Khoá TRÙNG của một mặt hàng = tên + đơn vị, bỏ hoa/thường và khoảng trắng thừa.
 *  Phải khớp `_khoa_vat_tu` bên service — lệch nhau thì máy nói trùng mà màn hình nói không. */
export function khoaVatTu(item: {
  item_name: string;
  unit: string;
  kho_rong?: number;
  kho_dai?: number;
}): string {
  // Khổ thuộc khoá: giấy hai khổ là hai dòng giá khác nhau (10/10/2026 bỏ dạng cuộn/tờ).
  return `${item.item_name.trim().replace(/\s+/g, " ").toLowerCase()}|${item.unit
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()}|${item.kho_rong ?? 0}|${item.kho_dai ?? 0}`;
}

/** Gộp danh sách vừa đọc từ Excel VÀO danh sách đang có trong form.
 *
 *  THÊM VÀO, không thay thế (chủ chốt 07/08/2026): thay cả danh mục là một cú bấm xoá sạch bảng
 *  giá mà không ai lường trước. Trùng tên + đơn vị ⇒ cập nhật dòng đó, không đẻ dòng thứ hai —
 *  hai dòng cùng tên cùng ĐVT khác giá thì form phiếu mua không biết chọn cái nào. */
export function gopVatTu(
  dangCo: SupplierItemInput[],
  doc: SupplierItemInput[],
): { items: SupplierItemInput[]; them: number; capNhat: number } {
  // Bỏ dòng trống mà form vẫn luôn chừa sẵn — giữ lại là danh mục có một dòng rác.
  const ket = dangCo.filter((it) => it.item_name.trim() || it.unit.trim());
  const viTri = new Map(ket.map((it, i) => [khoaVatTu(it), i]));
  let them = 0;
  let capNhat = 0;
  for (const moi of doc) {
    const i = viTri.get(khoaVatTu(moi));
    if (i === undefined) {
      viTri.set(khoaVatTu(moi), ket.length);
      ket.push(moi);
      them += 1;
    } else {
      ket[i] = { ...ket[i], ...moi };
      capNhat += 1;
    }
  }
  return { items: ket.length ? ket : [emptySupplierItem()], them, capNhat };
}

export function emptySupplierItem(): SupplierItemInput {
  return {
    item_name: "",
    kho_rong: 0,
    kho_dai: 0,
    unit: "",
    unit_price: 0,
    vat_percent: 0,
    note: "",
  };
}

export function emptySupplier(): SupplierInput {
  return {
    name: "",
    tax_code: "",
    phone: "",
    email: "",
    address: "",
    contact_name: "",
    supplier_group: "",
    payment_terms: "",
    // 0 = chưa đặt hạn mức · null = chưa đặt số ngày cho nợ. Hai mặc định này KHÁC nhau về nghĩa,
    // xem hint trên form.
    credit_limit: 0,
    credit_days: null,
    debt_cutoff_day: null,
    status: "active",
    nhan_gia_cong: false,
    note: "",
    items: [emptySupplierItem()],
  };
}

export function fromSupplier(row: SupplierRow): SupplierInput {
  return {
    name: row.name,
    tax_code: row.tax_code ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    contact_name: row.contact_name ?? "",
    supplier_group: row.supplier_group ?? "",
    payment_terms: row.payment_terms ?? "",
    credit_limit: row.credit_limit ?? 0,
    credit_days: row.credit_days ?? null,
    debt_cutoff_day: row.debt_cutoff_day ?? null,
    status: row.status,
    nhan_gia_cong: row.nhan_gia_cong ?? false,
    note: row.note ?? "",
    items: row.items.length
      ? row.items.map((item) => ({
          // PHẢI mang theo cặp mặt hàng gốc: form ghi kiểu replace-all, bỏ sót là mỗi lần mở NCC
          // ra sửa số điện thoại lại XOÁ SẠCH liên kết mặt hàng của cả bảng giá — im lặng, kéo
          // theo bảng so giá trống.
          hang_loai: item.hang_loai,
          hang_id: item.hang_id,
          kho_rong: item.kho_rong ?? 0,
          kho_dai: item.kho_dai ?? 0,
          item_name: item.item_name,
          unit: item.unit,
          unit_price: item.unit_price,
          vat_percent: item.vat_percent ?? 0,
          note: item.note ?? "",
          he_so_ve_goc: item.he_so_ve_goc ?? null,
        }))
      : [emptySupplierItem()],
  };
}

export function cleanSupplierItems(
  items: SupplierItemInput[] = [],
): SupplierItemInput[] {
  return items
    .map((item) => ({
      hang_loai: item.hang_loai ?? null,
      hang_id: item.hang_id ?? null,
      // Khổ chỉ có nghĩa với giấy; chưa có rộng thì bỏ cả dài (khổ chỉ-dài vô nghĩa).
      kho_rong: item.hang_loai === "giay" ? Number(item.kho_rong || 0) : 0,
      kho_dai:
        item.hang_loai === "giay" && Number(item.kho_rong || 0) > 0 ? Number(item.kho_dai || 0) : 0,
      item_name: (item.item_name ?? "").trim(),
      unit: (item.unit ?? "").trim(),
      unit_price: Number(item.unit_price || 0),
      vat_percent: Number(item.vat_percent || 0),
      note: (item.note ?? "").trim() || null,
    }))
    .filter(
      (item) =>
        item.item_name ||
        item.unit ||
        item.unit_price > 0 ||
        item.vat_percent > 0 ||
        item.note,
    );
}

export function cleanSupplier(input: SupplierInput): SupplierInput {
  const trimOptional = (v?: string | null) => {
    const s = (v ?? "").trim();
    return s || null;
  };
  return {
    name: (input.name ?? "").trim(),
    tax_code: (input.tax_code ?? "").trim(),
    phone: (input.phone ?? "").trim(),
    email: (input.email ?? "").trim(),
    address: (input.address ?? "").trim(),
    contact_name: (input.contact_name ?? "").trim(),
    supplier_group: (input.supplier_group ?? "").trim(),
    payment_terms: trimOptional(input.payment_terms),
    credit_limit: Math.max(0, Math.round(Number(input.credit_limit) || 0)),
    // `?? null` chứ KHÔNG `|| null`: `credit_days = 0` là "trả ngay", một giá trị có thật.
    credit_days:
      input.credit_days == null
        ? null
        : Math.max(0, Math.round(Number(input.credit_days) || 0)),
    debt_cutoff_day: input.debt_cutoff_day || null,
    status: input.status ?? "active",
    nhan_gia_cong: Boolean(input.nhan_gia_cong),
    note: trimOptional(input.note),
    items: cleanSupplierItems(input.items),
  };
}

