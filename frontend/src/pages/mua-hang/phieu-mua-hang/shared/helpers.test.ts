import { describe, expect, it } from "vitest";

import type { DonViDungDuoc, SupplierItemRow, SupplierRow } from "../../../../api/client";
import { chaoGiaChoMatHang, khoNhanThieuCanh, khoNhapTuDongMua, nhanKhoMua, supplierItemForLine } from "./helpers";

describe("nhanKhoMua", () => {
  it("giấy có khổ mua ⇒ ghi khổ, chỉ rộng ⇒ một cạnh", () => {
    expect(nhanKhoMua({ hang_loai: "giay", kho_rong: 800, kho_dai: 1090 })).toBe("Khổ 800 × 1090 mm");
    expect(nhanKhoMua({ hang_loai: "giay", kho_rong: 1000, kho_dai: 0 })).toBe("Khổ 1000 mm");
  });
  it("giấy không khổ hoặc hàng khác ⇒ rỗng", () => {
    expect(nhanKhoMua({ hang_loai: "giay", kho_rong: 0, kho_dai: 0 })).toBe("");
    expect(nhanKhoMua({ hang_loai: "vat_tu", kho_rong: 0, kho_dai: 0 })).toBe("");
  });
});

/** Đợt giao: khổ nhận chỉ bị chặn "thiếu cạnh" khi đơn đặt giấy TỜ (hai cạnh) mà nhận thiếu một
 *  cạnh, hoặc có dài mà không có rộng. Cuộn đặt theo rộng thì nhận chỉ rộng là đúng (e2e MH3 25/10). */
describe("khoNhanThieuCanh", () => {
  it("cuộn đặt theo rộng, nhận chỉ rộng ⇒ không thiếu", () => {
    expect(khoNhanThieuCanh({ kho_rong: 860, kho_dai: 0 }, { rong: 860, dai: 0 })).toBe(false);
    expect(khoNhanThieuCanh({ kho_rong: 860, kho_dai: 0 }, { rong: 870, dai: 0 })).toBe(false);
  });
  it("tờ đặt hai cạnh, nhận thiếu một cạnh ⇒ thiếu", () => {
    expect(khoNhanThieuCanh({ kho_rong: 650, kho_dai: 860 }, { rong: 650, dai: 0 })).toBe(true);
    expect(khoNhanThieuCanh({ kho_rong: 650, kho_dai: 860 }, { rong: 640, dai: 860 })).toBe(false);
  });
  it("có dài mà không rộng ⇒ thiếu, đơn chưa ghi khổ nhận chỉ rộng ⇒ không thiếu", () => {
    expect(khoNhanThieuCanh({ kho_rong: 0, kho_dai: 0 }, { rong: 0, dai: 860 })).toBe(true);
    expect(khoNhanThieuCanh({ kho_rong: 0, kho_dai: 0 }, { rong: 900, dai: 0 })).toBe(false);
  });
});

/** Nhập kho từ đợt giao: dòng yêu cầu nhập (form khoá) phải mang đúng khổ MUA của dòng đơn, vì tồn
 *  giấy tách theo khổ — nhập sai khổ là giữ chỗ/kiểm xuất đếm nhầm lô. Không còn dạng cuộn/tờ. */
describe("khoNhapTuDongMua", () => {
  it("giấy giữ nguyên khổ, hai cạnh hay chỉ rộng", () => {
    expect(khoNhapTuDongMua({ hang_loai: "giay", kho_rong: 1090, kho_dai: 800 })).toEqual({ kho_rong: 800, kho_dai: 1090 });
    expect(khoNhapTuDongMua({ hang_loai: "giay", kho_rong: 1000, kho_dai: 0 })).toEqual({ kho_rong: 1000, kho_dai: 0 });
  });

  it("vật tư mang khổ tuỳ chọn như giấy; hàng khác hoặc không khớp được dòng đơn ⇒ 0 · 0", () => {
    const rong = { kho_rong: 0, kho_dai: 0 };
    expect(khoNhapTuDongMua({ hang_loai: "vat_tu", kho_rong: 700, kho_dai: 500 })).toEqual({ kho_rong: 500, kho_dai: 700 });
    expect(khoNhapTuDongMua({ hang_loai: "thanh_pham", kho_rong: 5, kho_dai: 5 })).toEqual(rong);
    expect(khoNhapTuDongMua(undefined)).toEqual(rong);
  });
});

/** Chọn NCC cho dòng giấy (10/10/2026, bỏ dạng cuộn/tờ): chỉ dòng giá CÙNG khổ; xếp hạng chỉ trong
 *  cùng họ đơn vị với ĐVT dòng; NCC bán khác họ đứng nhóm sau, kèm giá của họ. */
describe("chaoGiaChoMatHang theo khổ + họ đơn vị", () => {
  const item = (o: Partial<SupplierItemRow>): SupplierItemRow =>
    ({
      id: 1, hang_loai: "giay", hang_id: 7, item_name: "COUCHE 150", unit: "to",
      unit_price: 1000, vat_percent: 8, is_active: true, gia_quy_doi: null,
      kho_rong: 790, kho_dai: 1090, ...o,
      don_vi_goc: o.don_vi_goc ?? ({ to: "to", ram: "to", kg: "kg", tan: "kg" } as Record<string, string>)[o.unit ?? "to"] ?? "",
    }) as SupplierItemRow;
  const ncc = (id: number, items: SupplierItemRow[]): SupplierRow =>
    ({ id, name: `Công ty TNHH NCC ${id}`, status: "active", items }) as unknown as SupplierRow;
  // Danh sách đơn vị GỘP của mã giấy: họ tờ (tờ, ram = 500 tờ) + họ kg (kg, tấn = 1000 kg).
  const dv = (ma: string, goc: string, he: number): DonViDungDuoc =>
    ({ ma, ten: ma, he_so: he, he_so_ve_goc: he, la_goc: he === 1, dien_giai: "", goc, goc_ten: goc });
  const dsDv = [dv("to", "to", 1), dv("ram", "to", 500), dv("kg", "kg", 1), dv("tan", "kg", 1000)];
  const ds = [
    ncc(1, [item({ id: 11, unit_price: 1200, gia_quy_doi: 1200 })]),
    ncc(2, [item({ id: 21, unit: "ram", unit_price: 550_000, gia_quy_doi: 1100 })]),
    ncc(3, [item({ id: 31, kho_rong: 650, kho_dai: 860, gia_quy_doi: 900 })]),
    ncc(4, [item({ id: 41, unit: "kg", unit_price: 24_500, gia_quy_doi: 24_500 })]),
    ncc(5, [item({ id: 51, kho_rong: 790, kho_dai: 0, gia_quy_doi: 800 })]),
  ];
  const dong = { item_name: "COUCHE 150", hang_loai: "giay" as const, hang_id: 7, unit: "to" };

  it("cùng khổ cùng họ: xếp theo giá quy đổi, giá điền theo ĐVT dòng; khác khổ và chỉ-rộng bị loại", () => {
    const out = chaoGiaChoMatHang({ ...dong, kho_rong: 1090, kho_dai: 790 }, ds, dsDv);
    const chinh = out.filter((c) => c.cung_ho);
    expect(chinh.map((c) => c.supplier_id)).toEqual([2, 1]);
    // NCC 2 báo 550.000đ/ram ⇒ dòng tính tờ: 1.100đ/tờ.
    expect(chinh[0].gia_dong).toBe(1100);
    expect(out.some((c) => c.supplier_id === 3 || c.supplier_id === 5)).toBe(false);
  });

  it("khác họ (kg) đứng nhóm sau với giá + đơn vị của NCC", () => {
    const out = chaoGiaChoMatHang({ ...dong, kho_rong: 790, kho_dai: 1090 }, ds, dsDv);
    const khac = out.filter((c) => !c.cung_ho);
    expect(khac.map((c) => [c.supplier_id, c.unit, c.gia_dong])).toEqual([[4, "kg", 24_500]]);
    expect(out[out.length - 1].supplier_id).toBe(4);
  });

  it("dòng tính ram: giá cùng họ quy về ram", () => {
    const out = chaoGiaChoMatHang({ ...dong, unit: "ram", kho_rong: 790, kho_dai: 1090 }, ds, dsDv);
    expect(out.find((c) => c.supplier_id === 1)?.gia_dong).toBe(600_000);
    expect(out.find((c) => c.supplier_id === 2)?.gia_dong).toBe(550_000);
  });

  it("khổ chỉ-rộng chỉ khớp dòng giá chỉ-rộng", () => {
    const out = chaoGiaChoMatHang({ ...dong, kho_rong: 790, kho_dai: 0 }, ds, dsDv);
    expect(out.map((c) => c.supplier_id)).toEqual([5]);
  });

  it("chưa nạp danh sách đơn vị: họ lấy theo don_vi_goc máy chủ ghi trên dòng giá", () => {
    const out = chaoGiaChoMatHang({ ...dong, kho_rong: 790, kho_dai: 1090 }, ds);
    expect(out.filter((c) => c.cung_ho).map((c) => c.supplier_id)).toEqual([2, 1]);
    // Dòng tính tờ = đơn vị gốc của họ ⇒ giá/đơn-vị-gốc là giá dòng.
    expect(out[0].gia_dong).toBe(1100);
    // Dòng giá không quy đổi được (don_vi_goc rỗng) khác mã ĐVT ⇒ khác họ.
    const la = [ncc(8, [item({ id: 81, unit: "thung", don_vi_goc: "" })])];
    expect(chaoGiaChoMatHang({ ...dong, kho_rong: 790, kho_dai: 1090 }, la).map((c) => c.cung_ho)).toEqual([false]);
  });

  it("dòng giá khổ 0 · 0 bán mọi khổ: khớp mọi khổ, xếp sau dòng đúng khổ cùng họ dù rẻ hơn", () => {
    const co = [...ds, ncc(7, [item({ id: 71, kho_rong: 0, kho_dai: 0, unit_price: 900, gia_quy_doi: 900 })])];
    const out = chaoGiaChoMatHang({ ...dong, kho_rong: 790, kho_dai: 1090 }, co, dsDv);
    expect(out.filter((c) => c.cung_ho).map((c) => [c.supplier_id, c.dung_kho])).toEqual([[2, true], [1, true], [7, false]]);
    const chiRong = chaoGiaChoMatHang({ ...dong, kho_rong: 790, kho_dai: 0 }, co, dsDv);
    expect(chiRong.map((c) => c.supplier_id)).toEqual([5, 7]);
  });

  it("hàng khác giấy khớp theo mã, một nhóm", () => {
    const vt = [ncc(6, [item({ hang_loai: "vat_tu", hang_id: 9, kho_rong: 0, kho_dai: 0, unit: "cai" })])];
    const out = chaoGiaChoMatHang({ item_name: "x", hang_loai: "vat_tu", hang_id: 9, unit: "cai" }, vt);
    expect(out.map((c) => [c.supplier_id, c.cung_ho, c.gia_dong])).toEqual([[6, true, 1000]]);
  });

  it("vật tư khác khai hai đơn vị (kg + thùng): NCC bán thùng là nhóm khác, không áp giá vào dòng kg", () => {
    const vt = (o: Partial<SupplierItemRow>) =>
      item({ hang_loai: "vat_tu", hang_id: 9, item_name: "Keo", kho_rong: 0, kho_dai: 0, ...o });
    const co = [
      ncc(1, [vt({ id: 91, unit: "kg", unit_price: 50_000, gia_quy_doi: 50_000, don_vi_goc: "kg" })]),
      ncc(2, [vt({ id: 92, unit: "thung", unit_price: 900_000, gia_quy_doi: 900_000, don_vi_goc: "thung" })]),
    ];
    const dongKeo = { item_name: "Keo", hang_loai: "vat_tu" as const, hang_id: 9, unit: "kg" };
    const out = chaoGiaChoMatHang(dongKeo, co);
    expect(out.map((c) => [c.supplier_id, c.cung_ho])).toEqual([[1, true], [2, false]]);
    const base = { ...dongKeo, quantity: 1, expected_unit_price: 0, discount_percent: 0, vat_percent: 0 };
    expect(supplierItemForLine(co[0], base)?.id).toBe(91);
    expect(supplierItemForLine(co[1], base)).toBeNull();
  });

  it("áp giá NCC đầu phiếu: giấy chỉ khớp đúng khổ + đúng ĐVT", () => {
    const ncc1 = ds[0];
    const base = { item_name: "COUCHE 150", hang_loai: "giay" as const, hang_id: 7, quantity: 1,
      expected_unit_price: 0, discount_percent: 0, vat_percent: 0 };
    expect(supplierItemForLine(ncc1, { ...base, unit: "to", kho_rong: 1090, kho_dai: 790 })?.id).toBe(11);
    expect(supplierItemForLine(ncc1, { ...base, unit: "kg", kho_rong: 790, kho_dai: 1090 })).toBeNull();
    expect(supplierItemForLine(ncc1, { ...base, unit: "to", kho_rong: 650, kho_dai: 860 })).toBeNull();
  });
});
