// Hàm thuần (không JSX, không state) của màn Mua hàng (tách từ pages/PurchaseRequestsPage.tsx).
// ⚠️ `lineTotal` / `lineDiscountAmount` / `lineVatAmount` là TÂM THUẾ của phân hệ — form nhập,
// bảng xem trước và tiền của từng đợt giao đều ăn ba hàm này. Đừng sửa một ký tự nào của phép
// tính; đổi cách làm tròn ở đây là lệch tiền thật trên phiếu mua và trên công nợ.
import type {
  DepartmentPurchaseRequestRow,
  DonViDungDuoc,
  PurchaseRequestLineInput,
  PurchaseRequestLineOut,
  PurchaseRequestRow,
  SupplierRow,
} from "../../../../api/client";
import { chuanKho, coDonViGoc } from "../../../../lib/khoGiay";
import { homNayVN } from "../../../../utils/ky";
import { SO_NCC_GOI_Y } from "./constants";
import type { ChaoGia, FormLine, FormState } from "./types";

/** Khổ giấy cho dòng yêu cầu nhập kho dựng từ một dòng đơn mua (Nhập kho từ đợt giao): đúng khổ
 *  MUA của dòng — đủ hai cạnh hoặc chỉ rộng, giữ nguyên. Hàng khác giấy ⇒ 0 · 0. Đơn vị gốc máy
 *  chủ tự suy từ ĐVT của dòng nhập (10/10/2026 bỏ dạng cuộn/tờ). */
export function khoNhapTuDongMua(
  pl: Pick<PurchaseRequestLineOut, "hang_loai" | "kho_rong" | "kho_dai"> | undefined,
): { kho_rong: number; kho_dai: number } {
  if (pl?.hang_loai !== "giay") return { kho_rong: 0, kho_dai: 0 };
  const [r, d] = chuanKho(pl.kho_rong, pl.kho_dai);
  return { kho_rong: r, kho_dai: d };
}

/** "Khổ 800 × 1090 mm" (hoặc "Khổ 1000 mm" khi chỉ có rộng) dưới tên dòng giấy của đơn mua (chi
 *  tiết + phiếu in gửi NCC) — NCC giao sai khổ là lô nhập sai khoá tồn. Giấy chưa có khổ hoặc hàng
 *  khác ⇒ chuỗi rỗng. */
export function nhanKhoMua(
  pl: Pick<PurchaseRequestLineOut, "hang_loai" | "kho_rong" | "kho_dai">,
): string {
  if (pl.hang_loai !== "giay") return "";
  const [r, d] = chuanKho(pl.kho_rong, pl.kho_dai);
  if (!r) return "";
  return d ? `Khổ ${r} × ${d} mm` : `Khổ ${r} mm`;
}

export function emptyLine(): FormLine {
  return {
    item_name: "",
    unit: "",
    quantity: 0,
    expected_unit_price: 0,
    discount_percent: 0,
    vat_percent: 0,
    note: "",
    supplier_id: null,
  };
}

export function emptyRequest(): FormState {
  return {
    supplier_id: null,
    source_request_ids: [],
    content: "",
    needed_date: "",
    expected_receipt_date: "",
    note: null,
    lines: [emptyLine()],
  };
}

/** Nội dung để HIỆN. Phiếu lập trước 07/08/2026 chưa có ô gộp ⇒ nối lại hai ô cũ. */
export function noiDung(row: { content?: string | null; purpose?: string | null; note?: string | null }): string {
  const gop = (row.content ?? "").trim();
  if (gop) return gop;
  return [row.purpose, row.note].map((x) => (x ?? "").trim()).filter(Boolean).join(" — ");
}

export function todayInputValue(): string {
  return homNayVN();
}

export function fromRequest(row: PurchaseRequestRow): FormState {
  return {
    supplier_id: row.supplier_id,
    source_request_ids: row.sources.map(
      (source) => source.department_request_id,
    ),
    content: noiDung(row),
    needed_date: row.needed_date ?? "",
    expected_receipt_date: row.expected_receipt_date ?? "",
    note: null,
    lines: row.lines.map((line) => ({
      item_name: line.item_name,
      unit: line.unit,
      quantity: line.quantity,
      expected_unit_price: line.expected_unit_price,
      discount_percent: line.discount_percent,
      vat_percent: line.vat_percent,
      note: line.note ?? "",
      // Phiếu đã tồn tại thì mọi dòng đều thuộc NCC của phiếu — không tách nữa.
      supplier_id: row.supplier_id,
      // Đọc lại liên kết YCMH + mặt hàng gốc — thiếu bước này thì lưu (kể cả chỉ để thêm ngày dự
      // kiến nhận hàng) sẽ ghi đè chúng thành rỗng, cắt đứt "hàng đang về" khỏi kế hoạch vật tư.
      department_request_line_id: line.department_request_line_id,
      hang_loai: line.hang_loai,
      hang_id: line.hang_id,
      kho_rong: line.kho_rong,
      kho_dai: line.kho_dai,
      dinh_luong: line.dinh_luong ?? null,
      yeu_cau_ma: line.yeu_cau_ma,
      loai_mua: line.loai_mua,
      mua_cho: line.mua_cho,
    })),
  };
}

export function lineTotal(line: PurchaseRequestLineInput): number {
  const base =
    (Number(line.quantity) || 0) * (Number(line.expected_unit_price) || 0);
  const discount = lineDiscountAmount(line);
  const taxable = Math.max(0, base - discount);
  return Math.round(taxable + lineVatAmount(line));
}

export function lineDiscountAmount(line: PurchaseRequestLineInput): number {
  const base =
    (Number(line.quantity) || 0) * (Number(line.expected_unit_price) || 0);
  return Math.round((base * (Number(line.discount_percent) || 0)) / 100);
}

export function lineVatAmount(line: PurchaseRequestLineInput): number {
  const base =
    (Number(line.quantity) || 0) * (Number(line.expected_unit_price) || 0);
  const taxable = Math.max(0, base - lineDiscountAmount(line));
  return Math.round((taxable * (Number(line.vat_percent) || 0)) / 100);
}

/** Tên gọn của NCC: bỏ "Công ty TNHH / CP", "Thương mại" ở đầu ("Giấy An Phát"). Dùng ở thẻ dải
 *  "Sẽ tạo" và nhãn ô chọn NCC trên dòng — ô hẹp, tên đủ thì bị cắt mất phần phân biệt. */
export const tenGon = (ten: string) =>
  ten.replace(/^(công ty|cty)\s+(tnhh|cp|cổ phần)?\s*(thương mại|tm)?\s*/i, "").trim() || ten;

export function normalizeItemName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

const maDv = (ma: string | null | undefined) => (ma ?? "").trim().toLowerCase();

/** Khổ dòng bảng giá so với khổ dòng đơn (luật khớp khổ của máy chủ, 10/10/2026): chuẩn hoá cạnh
 *  ngắn trước rồi so bằng ⇒ "dung"; dòng giá khổ 0 · 0 = NCC bán MỌI khổ ⇒ "moi" (khớp, xếp sau dòng
 *  đúng khổ); còn lại ⇒ null. Khổ chỉ-rộng (r, 0) chỉ khớp (r, 0), không khớp khổ hai cạnh. */
export function khopKho(
  item: { kho_rong?: number | null; kho_dai?: number | null },
  line: { kho_rong?: number | null; kho_dai?: number | null },
): "dung" | "moi" | null {
  const [ir, id] = chuanKho(item.kho_rong, item.kho_dai);
  const [r, d] = chuanKho(line.kho_rong, line.kho_dai);
  if (ir === r && id === d) return "dung";
  if (!ir && !id) return "moi";
  return null;
}

export function supplierItemForLine(
  supplier: SupplierRow | undefined,
  line: PurchaseRequestLineInput,
) {
  if (!supplier) return null;
  const name = normalizeItemName(line.item_name);
  // Giấy / vật tư khác: dòng giá phải đúng mã + khớp khổ (chỉ giấy có khổ) + đúng ĐVT — khác khổ là
  // hàng khác, khác ĐVT (tờ/kg, kg/thùng) thì giá không áp được vào dòng (10/10/2026). Đường đổi
  // nhóm đơn vị đi qua ô chọn NCC của dòng.
  if (coDonViGoc(line.hang_loai)) {
    const hop = supplier.items.filter((item) => {
      const cungMa = line.hang_id && item.hang_id
        ? item.hang_loai === line.hang_loai && item.hang_id === line.hang_id
        : normalizeItemName(item.item_name) === name;
      return cungMa && khopKho(item, line) != null && maDv(item.unit) === maDv(line.unit);
    });
    return hop.find((item) => khopKho(item, line) === "dung") ?? hop[0] ?? null;
  }
  return (
    supplier.items.find(
      (item) =>
        normalizeItemName(item.item_name) === name &&
        item.unit.trim().toLowerCase() === line.unit.trim().toLowerCase(),
    ) ??
    supplier.items.find((item) => normalizeItemName(item.item_name) === name) ??
    null
  );
}

/** Đơn vị gốc + hệ số về gốc của một mã ĐVT, tra trong danh sách đơn vị của mặt hàng (`donVi`).
 *  Giấy nhận danh sách GỘP hai họ, mỗi dòng mang `goc`; danh sách một họ không mang `goc` thì gốc
 *  là dòng `la_goc`. Không tra được ⇒ null. */
export function traDonVi(
  ds: DonViDungDuoc[] | undefined,
  ma: string | null | undefined,
): { goc: string; heSo: number } | null {
  const k = maDv(ma);
  if (!ds || !k) return null;
  const d = ds.find((x) => maDv(x.ma) === k);
  if (!d) return null;
  return { goc: maDv(d.goc ?? ds.find((x) => x.la_goc)?.ma), heSo: d.he_so_ve_goc };
}

type DongGia = SupplierRow["items"][number];

/** Giá của dòng bảng giá quy về ĐVT `unit` của dòng đơn (cùng họ). Cùng mã ĐVT ⇒ giá NCC báo; khác
 *  mã ⇒ giá/đơn-vị-gốc × hệ số của ĐVT dòng (NCC báo 1.020.000đ/ram, dòng tính tờ ⇒ 2.040đ/tờ).
 *  Không quy được ⇒ null — KHÔNG lấy đại giá thô. */
function giaTheoDonViDong(
  item: DongGia,
  unit: string,
  ds: DonViDungDuoc[] | undefined,
  gocDong: string,
  coGoc: boolean,
): number | null {
  if (!maDv(unit) || maDv(item.unit) === maDv(unit)) return item.unit_price;
  if (item.gia_quy_doi == null) return null;
  const d = traDonVi(ds, unit);
  if (d) return Math.round(item.gia_quy_doi * d.heSo);
  // Dòng đơn tính đúng đơn vị gốc của họ ⇒ giá/đơn-vị-gốc là giá dòng.
  if (gocDong && maDv(unit) === gocDong) return item.gia_quy_doi;
  // Hàng không tách theo đơn vị gốc chưa nạp danh sách đơn vị: dòng đơn xưa nay tính theo đơn vị gốc.
  return coGoc ? null : item.gia_quy_doi;
}

const hangGia = (i: DongGia) => [i.gia_quy_doi ?? Infinity, i.unit_price] as const;
const reHon = (a: DongGia, b: DongGia) => {
  const [x1, x2] = hangGia(a);
  const [y1, y2] = hangGia(b);
  return x1 - y1 || x2 - y2;
};

/** Những NCC ĐANG HOẠT ĐỘNG bán mặt hàng này, xếp GIÁ TĂNG DẦN, lấy tối đa `SO_NCC_GOI_Y`.
 *
 * Xếp theo đơn giá CHƯA VAT vì đó là số đi vào dòng hàng.
 *
 * Giấy (10/10/2026, bỏ dạng cuộn/tờ) — cùng luật với `so_gia_ncc` bên máy chủ:
 *   - Khớp khổ theo `khopKho`: đúng khổ, hoặc dòng giá khổ 0 · 0 (bán mọi khổ).
 *   - Xếp hạng chỉ trong dòng CÙNG HỌ đơn vị với ĐVT dòng đơn (cùng `don_vi_goc`): đúng khổ trước,
 *     dòng "mọi khổ" sau, rồi giá tăng.
 *   - NCC chỉ bán khác họ (dòng tính tờ, NCC bán kg) vẫn trả về, `cung_ho = false`, đứng sau — chọn
 *     họ thì dòng đơn đổi sang đơn vị của họ.
 * Vật tư khác khai nhiều đơn vị (keo kg + thùng) theo đúng luật họ đơn vị đó, chỉ không có khổ.
 *
 * Không cần gọi API: danh sách NCC nạp cho màn này đã kèm bảng giá mặt hàng của từng người.
 * `dsDonVi` = danh sách đơn vị của mặt hàng — để quy giá ram ↔ tờ và biết họ của ĐVT dòng; thiếu
 * thì dựa vào `don_vi_goc` máy chủ ghi trên từng dòng giá.
 */
export function chaoGiaChoMatHang(
  line: Pick<FormLine, "item_name" | "hang_loai" | "hang_id" | "kho_rong" | "kho_dai" | "unit">,
  suppliers: SupplierRow[],
  dsDonVi?: DonViDungDuoc[],
): ChaoGia[] {
  const ten = normalizeItemName(line.item_name);
  if (!ten && !line.hang_id) return [];
  // Cùng MÃ: dòng có mặt hàng gốc thì khớp theo cặp (loại, id), dòng cũ chỉ có tên thì khớp tên.
  const cungMa = (i: DongGia) =>
    line.hang_loai && line.hang_id && i.hang_id
      ? i.hang_loai === line.hang_loai && i.hang_id === line.hang_id
      : normalizeItemName(i.item_name) === ten;
  const laGiay = line.hang_loai === "giay";
  // Giấy + vật tư khác tách theo nhóm đơn vị đã khai (khổ vẫn chỉ giấy).
  const coGoc = coDonViGoc(line.hang_loai);
  const unit = line.unit ?? "";
  const gocCua = (i: DongGia) => maDv(i.don_vi_goc) || traDonVi(dsDonVi, i.unit)?.goc || "";
  // Họ của ĐVT dòng đơn: tra danh sách đơn vị; chưa có thì mượn `don_vi_goc` của một dòng giá cùng
  // mã cùng ĐVT. Không ra ⇒ "" ⇒ chỉ dòng giá đúng mã ĐVT mới tính là cùng họ.
  const gocDong = traDonVi(dsDonVi, unit)?.goc
    || suppliers.flatMap((n) => n.items)
      .filter((i) => cungMa(i) && maDv(i.unit) === maDv(unit))
      .map(gocCua)
      .find(Boolean)
    || "";
  const laCungHo = (i: DongGia) => {
    if (!maDv(unit) || maDv(i.unit) === maDv(unit)) return true;
    const g = gocCua(i);
    return !!g && g === gocDong;
  };
  const chao = (ncc: SupplierRow, item: DongGia, cungHo: boolean): ChaoGia => ({
    supplier_id: ncc.id,
    supplier_name: ncc.name,
    supplier_item_id: item.id,
    unit_price: item.unit_price,
    vat_percent: item.vat_percent ?? 0,
    unit: item.unit,
    // Giá quy về ĐƠN VỊ GỐC của chính dòng — server tính (`quy_doi_bang_gia`). null = không quy được.
    gia_quy_doi: item.gia_quy_doi ?? null,
    // Khác họ: chọn là dòng đơn đổi sang đơn vị NCC ⇒ giá đúng là giá NCC báo.
    gia_dong: cungHo ? giaTheoDonViDong(item, unit, dsDonVi, gocDong, coGoc) : item.unit_price,
    cung_ho: cungHo,
    dung_kho: !laGiay || khopKho(item, line) === "dung",
  });
  // Đúng khổ trước dòng "mọi khổ", rồi rẻ hơn.
  const uuTien = (a: DongGia, b: DongGia) =>
    (khopKho(a, line) === "dung" ? 0 : 1) - (khopKho(b, line) === "dung" ? 0 : 1) || reHon(a, b);
  const out: ChaoGia[] = [];
  const khac: ChaoGia[] = [];
  for (const ncc of suppliers) {
    if (ncc.status !== "active") continue;
    const cung = ncc.items.filter(
      (i) => cungMa(i) && i.is_active !== false && (!laGiay || khopKho(i, line) != null),
    );
    if (!cung.length) continue;
    if (!coGoc) {
      out.push(chao(ncc, cung[0], true));
      continue;
    }
    // Mỗi NCC: dòng tốt nhất cùng họ vào nhóm chính; dòng khác họ gom theo đơn vị gốc, mỗi họ một
    // dòng tốt nhất vào nhóm sau.
    const cungHo = cung.filter(laCungHo);
    if (cungHo.length) out.push(chao(ncc, [...cungHo].sort(uuTien)[0], true));
    const theoGoc = new Map<string, DongGia>();
    for (const i of cung) {
      if (cungHo.includes(i)) continue;
      const g = gocCua(i) || maDv(i.unit);
      const cu = theoGoc.get(g);
      if (!cu || uuTien(i, cu) < 0) theoGoc.set(g, i);
    }
    for (const i of theoGoc.values()) khac.push(chao(ncc, i, false));
  }
  // XẾP THEO GIÁ ĐÃ QUY ĐỔI, không theo giá thô (29/08/2026). Ông báo 1.020.000đ/ram và ông báo
  // 2.000đ/tờ mà đem so trực tiếp thì "rẻ nhất" thành vô nghĩa. Nhóm chính cùng họ nên giá/đơn-vị-
  // gốc so ngang được. Dòng chưa quy đổi được xuống CUỐI (`Infinity`) — xếp hạng một dòng chưa biết
  // giá thật là mời chọn nhầm, đúng nếp `so_gia_ncc` bên server.
  const xep = (a: ChaoGia, b: ChaoGia) =>
    Number(b.dung_kho) - Number(a.dung_kho) ||
    (a.gia_quy_doi ?? Infinity) - (b.gia_quy_doi ?? Infinity) ||
    a.unit_price - b.unit_price;
  out.sort(xep);
  khac.sort((a, b) => maDv(a.unit).localeCompare(maDv(b.unit)) || xep(a, b));
  return [...out.slice(0, SO_NCC_GOI_Y), ...khac];
}

export function applySupplierPrices(
  lines: PurchaseRequestLineInput[],
  suppliers: SupplierRow[],
  supplierId: number | null,
): PurchaseRequestLineInput[] {
  const supplier = suppliers.find((row) => row.id === supplierId);
  return lines.map((line) => {
    const item = supplierItemForLine(supplier, line);
    if (!item) return line;
    return {
      ...line,
      unit: item.unit || line.unit,
      expected_unit_price: item.unit_price,
      vat_percent: item.vat_percent,
    };
  });
}

export function supplierQuotedTotal(
  supplier: SupplierRow,
  lines: PurchaseRequestLineInput[],
): number | null {
  let total = 0;
  let matched = 0;
  for (const line of lines) {
    const item = supplierItemForLine(supplier, line);
    if (!item) continue;
    matched += 1;
    total += (Number(line.quantity) || 0) * item.unit_price;
  }
  return matched === lines.length && matched > 0 ? total : null;
}

export function bestSupplierIdForLines(
  lines: PurchaseRequestLineInput[],
  suppliers: SupplierRow[],
): number | null {
  let best: { supplierId: number; total: number } | null = null;
  for (const supplier of suppliers) {
    const total = supplierQuotedTotal(supplier, lines);
    if (total == null) continue;
    if (!best || total < best.total) best = { supplierId: supplier.id, total };
  }
  return best?.supplierId ?? null;
}

/** Σ số đã giao của MỘT dòng đặt, cộng qua các đợt — bỏ qua đợt đang sửa (`boQua`) vì số của
 *  chính nó không tính vào "phần các đợt KHÁC đã lấy". Khớp `_clean_dot_lines` bên service. */
export function daGiaoKhac(
  row: PurchaseRequestRow,
  lineId: number,
  boQua?: number | null,
): number {
  let tong = 0;
  for (const dot of row.deliveries) {
    if (boQua != null && dot.id === boQua) continue;
    for (const dl of dot.lines) {
      if (dl.purchase_request_line_id === lineId) tong += dl.quantity;
    }
  }
  return tong;
}

/** Tiền của `qty` theo đơn giá/CK/VAT đã chốt trên phiếu.
 *
 * Đây là bản XEM TRƯỚC ở giao diện; con số thật do server tính (`gia_tri_dot_giao`) — hai bên phải
 * ra cùng một kết quả. Không có ô nhập tiền ở đợt giao (chủ chốt 07/08/2026): tiền suy thẳng từ số
 * lượng thực nhận, nên đợt giao không bao giờ lệch với đơn. */
export function tienTheoSoLuong(
  line: PurchaseRequestRow["lines"][number],
  qty: number,
): number {
  return lineTotal({
    item_name: line.item_name,
    unit: line.unit,
    quantity: qty,
    expected_unit_price: line.expected_unit_price,
    discount_percent: line.discount_percent,
    vat_percent: line.vat_percent,
  });
}

export function purchaseChildSummary(row: DepartmentPurchaseRequestRow): string {
  const dem = new Map<string, number>();
  for (const phieu of row.purchase_requests) {
    const nhom =
      phieu.status === "rejected"
        ? "cần sửa"
        : phieu.status === "draft"
          ? "đang lập"
          : phieu.status === "pending_approval"
            ? "chờ duyệt"
            : phieu.status === "received"
              ? "đã nhận"
              : phieu.status === "cancelled"
                ? "đã hủy"
                : "đang mua";
    dem.set(nhom, (dem.get(nhom) ?? 0) + 1);
  }
  const thuTu = ["cần sửa", "đang lập", "chờ duyệt", "đang mua", "đã nhận", "đã hủy"];
  return thuTu
    .filter((nhom) => dem.has(nhom))
    .map((nhom) => `${dem.get(nhom)} đơn ${nhom}`)
    .join(" · ");
}
