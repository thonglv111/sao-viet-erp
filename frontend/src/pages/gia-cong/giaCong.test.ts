import { describe, expect, it } from "vitest";
import type { GiaCongCapGiay, GiaCongNgoaiLan } from "../../api/client";
import {
  chonGiayBanDau, chuanSoGo, goiYChot, hienSoGo, mocCuaLan, nhanKhoCap, nutCuaLan, soNhanChia,
  thieuTo, viTriTrongDai, type BuocDai,
} from "./giaCong";

const b = (
  ten: string,
  loai: BuocDai["loai_buoc"],
  ncc: number | null = null,
  opts: { key?: string; phu_thuoc?: string[] } = {},
): BuocDai => ({
  key: opts.key ?? ten,
  ten,
  loai_buoc: loai,
  nha_cung_cap_id: ncc,
  phu_thuoc_step_keys: opts.phu_thuoc ?? [],
});

describe("viTriTrongDai — cùng luật gom lần của máy chủ", () => {
  const rows = [
    b("In", "may"), b("Cán màng", "thue_ngoai", 7), b("Ép kim", "thue_ngoai", 7),
    b("Bế", "thue_ngoai", 9), b("Dán", "to"),
  ];
  it("bước không thuê ngoài thì null", () => {
    expect(viTriTrongDai(rows, 0)).toBeNull();
  });
  it("đầu dải: ô đơn giá nằm ở bước sau", () => {
    expect(viTriTrongDai(rows, 1)).toEqual({ truoc: null, sau: "Ép kim", laCuoi: false });
  });
  it("cuối dải cùng nhà gia công", () => {
    expect(viTriTrongDai(rows, 2)).toEqual({ truoc: "Cán màng", sau: null, laCuoi: true });
  });
  it("khác nhà gia công là lần khác", () => {
    expect(viTriTrongDai(rows, 3)).toEqual({ truoc: null, sau: null, laCuoi: true });
  });
  it("chưa chọn nhà gia công thì không gom", () => {
    const r2 = [b("A", "thue_ngoai"), b("B", "thue_ngoai")];
    expect(viTriTrongDai(r2, 0)).toEqual({ truoc: null, sau: null, laCuoi: true });
  });
});

describe("viTriTrongDai — liền nhau đi theo CẠNH DAG, không phải thứ tự mảng", () => {
  it("hai nhánh song song cùng NCC đứng cạnh nhau trong mảng ⇒ KHÔNG cùng lần (không có cạnh nối)", () => {
    // "In" toả ra hai nhánh song song "Cán màng" và "Ép kim", cả hai cùng nhà gia công 7 nhưng
    // KHÔNG có cạnh nối trực tiếp giữa chúng — chỉ tình cờ đứng cạnh nhau trong `rows`.
    const rows = [
      b("In", "may", null, { key: "p" }),
      b("Cán màng", "thue_ngoai", 7, { key: "a", phu_thuoc: ["p"] }),
      b("Ép kim", "thue_ngoai", 7, { key: "c", phu_thuoc: ["p"] }),
    ];
    expect(viTriTrongDai(rows, 1)).toEqual({ truoc: null, sau: null, laCuoi: true });
    expect(viTriTrongDai(rows, 2)).toEqual({ truoc: null, sau: null, laCuoi: true });
  });

  it("routing không khai cạnh nào ⇒ lùi về so THỨ TỰ MẢNG (routing tuyến tính cũ)", () => {
    const rows = [
      b("Cán màng", "thue_ngoai", 7, { key: "a" }),
      b("Ép kim", "thue_ngoai", 7, { key: "c" }),
    ];
    expect(viTriTrongDai(rows, 0)).toEqual({ truoc: null, sau: "Ép kim", laCuoi: false });
    expect(viTriTrongDai(rows, 1)).toEqual({ truoc: "Cán màng", sau: null, laCuoi: true });
  });
});

const lan = (p: Partial<GiaCongNgoaiLan>): GiaCongNgoaiLan => ({
  id: 1, lsx_id: 9, lsx_ma: "LSX-001", kieu: "mot_phan", trang_thai: "cho_mang_di",
  nha_cung_cap_id: 7, nha_cung_cap_ten: "Cán màng Minh Long", ten_viec: "Cán màng",
  don_vi: "to", sl_dat: null, xuong_cap_giay: false,
  don_vi_gui: "to", sl_cho_mang_di: 0, co_buoc_truoc: true, mang_di_boi_ten: null,
  mang_di_luc: null, sl_gui: null, chot_boi_ten: null, chot_luc: null, sl_cuoi: null,
  noi_ve: null, noi_ve_hop_le: ["xuong"], chang_sau: [{ id: 31, ten: "Bế" }],
  huy_boi_ten: null, huy_luc: null, ly_do_huy: null, phieu_chi: null, xuat_giay: null,
  lich_su: [], version: 1, ...p,
});

describe("nutCuaLan", () => {
  it("chờ mang đi mà bước trước chưa giao thì chưa bấm được", () => {
    expect(nutCuaLan(lan({})).mangDi).toBe(false);
  });
  it("có hàng chờ thì bấm Đã mang đi", () => {
    expect(nutCuaLan(lan({ sl_cho_mang_di: 1660 })).mangDi).toBe(true);
  });
  it("dải đầu lệnh (không bước trước) thì gõ số mà mang đi", () => {
    expect(nutCuaLan(lan({ co_buoc_truoc: false })).mangDi).toBe(true);
  });
  it("đang ở ngoài thì chốt được, còn hàng mới về thì mang thêm được", () => {
    const n = nutCuaLan(lan({ trang_thai: "dang_o_ngoai", sl_gui: 1660, sl_cho_mang_di: 40 }));
    expect([n.chot, n.mangDi]).toEqual([true, true]);
  });
  it("đã xong có phiếu chi thì KHÔNG mở lại", () => {
    expect(nutCuaLan(lan({ trang_thai: "da_xong", phieu_chi: { id: 3, code: "PC-1" } })).moLai).toBe(false);
    expect(nutCuaLan(lan({ trang_thai: "da_xong" })).moLai).toBe(true);
  });
  it("trọn gói xưởng cấp giấy, máy chủ gửi phần chọn giấy ⇒ dải Chọn giấy + huỷ", () => {
    const n = nutCuaLan(lan({
      kieu: "tron_goi", trang_thai: "dang_gia_cong", xuong_cap_giay: true, cap_giay: capGiay,
    }));
    expect([n.chonGiay, n.huyTronGoi, n.chot, n.mangDi]).toEqual([true, true, true, false]);
  });
  it("đã gửi đề nghị xuất (máy chủ thôi gửi cap_giay) ⇒ không còn dải", () => {
    const n = nutCuaLan(lan({
      kieu: "tron_goi", trang_thai: "dang_gia_cong", xuong_cap_giay: true,
      xuat_giay: { id: 4, ma: "YCX-1", trang_thai: "approved" },
    }));
    expect(n.chonGiay).toBe(false);
  });
});

const capGiay: GiaCongCapGiay = {
  giay_id: 8, giay_ma: "C150", giay_ten: "COUCHE 150GSM", don_vi: "to_nguyen",
  nguon: "phiếu tính giá", de_xuat: { kho_rong: 790, kho_dai: 1090, so_to: 425, don_vi: "to" },
  kho: [
    { kho_rong: 790, kho_dai: 1090, ton: 300, don_vi: "to", dung_de_xuat: true },
    { kho_rong: 650, kho_dai: 860, ton: 1000, don_vi: "to", dung_de_xuat: false },
  ],
  ly_do: null,
};

describe("chọn giấy", () => {
  it("điền sẵn khổ + số tờ theo đề xuất", () => {
    expect(chonGiayBanDau(capGiay)).toEqual({ kho: "790x1090", so: "425" });
    expect(chonGiayBanDau({ ...capGiay, de_xuat: null })).toEqual({ kho: null, so: "" });
  });
  it("thiếu tồn thì báo số thiếu, đủ thì im", () => {
    expect(thieuTo(capGiay, "790x1090", 425)).toBe(125);
    expect(thieuTo(capGiay, "650x860", 425)).toBeNull();
    expect(thieuTo(capGiay, null, 425)).toBeNull();
  });
  it("cuộn hiện theo rộng, khổ tờ hiện hai cạnh", () => {
    expect(nhanKhoCap(870, 0)).toBe("cuộn rộng 870 mm");
    expect(nhanKhoCap(790, 1090)).toBe("khổ 790 × 1090 mm");
  });
  it("ô số kg: phẩy là dấu lẻ, chấm chia nghìn; ô tờ chỉ nhận số nguyên", () => {
    expect(chuanSoGo("395,85", true)).toBe("395.85");
    expect(chuanSoGo("395,857", true)).toBe("395.85");
    expect(chuanSoGo("1.500", true)).toBe("1500");
    expect(chuanSoGo("1.500,5", true)).toBe("1500.5");
    expect(chuanSoGo("395,", true)).toBe("395.");
    expect(hienSoGo("1500.5", true)).toBe("1.500,5");
    expect(hienSoGo("395.", true)).toBe("395,");
    expect(chuanSoGo("1.112", false)).toBe("1112");
    expect(hienSoGo("395.85", true)).toBe("395,85");
    expect(hienSoGo("1112", false)).toBe("1.112");
    expect(hienSoGo("", true)).toBe("");
  });
});

describe("goiYChot", () => {
  it("ưu tiên số máy chủ đã quy tờ → con", () => {
    expect(goiYChot(lan({ trang_thai: "dang_o_ngoai", sl_gui: 1660, sl_goi_y_chot: 3320 })).sl).toBe("3320");
  });
  it("điền sẵn số đã gửi, nơi về đầu tiên, bước sau duy nhất", () => {
    expect(goiYChot(lan({ trang_thai: "dang_o_ngoai", sl_gui: 1660 }))).toEqual({
      sl: "1660", noiVe: "xuong", dich: 31,
    });
  });
  it("trọn gói lấy số đặt", () => {
    expect(goiYChot(lan({ kieu: "tron_goi", sl_dat: 20000, noi_ve_hop_le: ["kho", "khach"], chang_sau: [] })))
      .toEqual({ sl: "20000", noiVe: "kho", dich: null });
  });
});

describe("mocCuaLan", () => {
  const dv = (m: string | null) => (m === "to" ? "tờ" : m === "cai" ? "cái" : "");
  it("trọn gói vừa giao: mốc giao việc xong, đang gia công, chờ nhận về", () => {
    const m = mocCuaLan(lan({ kieu: "tron_goi", trang_thai: "dang_gia_cong", sl_dat: 5000, don_vi: "cai",
                              tao_luc: "2026-10-06T04:11:00Z", tao_boi_ten: "Admin" }), dv);
    expect(m.map((x) => [x.nhan, x.muc])).toEqual([
      ["Giao việc", "xong"], ["Đang gia công", "dang"], ["Nhận về", "cho"],
    ]);
    expect(m[0]).toMatchObject({ ai: "Admin", so: "5.000 cái" });
  });
  it("một phần đã mang đi: mốc mang đi có người + số, đang chờ nhận về", () => {
    const m = mocCuaLan(lan({ trang_thai: "dang_o_ngoai", mang_di_luc: "x", mang_di_boi_ten: "Nguyễn A",
                              sl_gui: 1660 }), dv);
    expect(m.map((x) => x.muc)).toEqual(["xong", "xong", "dang"]);
    expect(m[1]).toMatchObject({ ai: "Nguyễn A", so: "1.660 tờ" });
  });
  it("đã chốt: cả ba mốc xong, mốc nhận về mang số chốt", () => {
    const m = mocCuaLan(lan({ trang_thai: "da_xong", mang_di_luc: "x", chot_luc: "y", sl_cuoi: 1650 }), dv);
    expect(m.map((x) => x.muc)).toEqual(["xong", "xong", "xong"]);
    expect(m[2].so).toBe("1.650 tờ");
  });
  it("huỷ trước khi mang đi: không mốc nào đang chạy", () => {
    const m = mocCuaLan(lan({ trang_thai: "da_huy" }), dv);
    expect(m.map((x) => x.muc)).toEqual(["xong", "cho", "cho"]);
  });
});

describe("soNhanChia — bảng chia về từng lệnh", () => {
  const dv = (m: string | null) => (m === "to" ? "tờ in" : m === "con" ? "con" : "");
  const dong = (x: Partial<{ so_con: number; he_so_nhan: number | null; don_vi: string | null }>) => ({
    lsx_id: 1, lsx_ma: "LSX-1", so_con: 4, he_so_nhan: null, don_vi: "to", buoc_nhan: "Cắt", ...x,
  });
  // E2E 27/09/2026: Cắt nhận "10.320 tờ" cho 2.580 tờ ghép — nhân con/tờ ở chỗ bước còn ăn tờ.
  it("bước nhận ăn tờ ghép: nhận nguyên số tờ, kèm số con sẽ ra", () => {
    expect(soNhanChia(2580, dong({ he_so_nhan: 1 }), dv)).toBe("2.580 tờ in (ra 10.320 con)");
  });
  it("bước nhận ăn con: số tờ × con/tờ", () => {
    expect(soNhanChia(2580, dong({ he_so_nhan: 4, don_vi: "con" }), dv)).toBe("10.320 con");
  });
});
