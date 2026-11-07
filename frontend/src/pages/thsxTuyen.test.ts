import { describe, expect, it } from "vitest";

import type { SxLenhNhom, SxRoutingBuoc, SxWorkItem } from "../api/client";
import { cauDuoi, cauViTri, daiCuaViec, viTriHang } from "./thsxTuyen";

const TEN = ["Cắt tờ", "In offset", "Cán màng", "Bế", "Dán hộp"];

/** Cùng bộ ca với `backend/tests/test_loc_ban_to_thuoc_tinh.py`: việc 99 nằm ở bước `toiO`. */
function dai(tt: string[], toiO = 1): SxRoutingBuoc[] {
  return tt.map((t, i) => ({
    thu_tu: i + 1, step_key: `b${i + 1}`, ten_cong_doan: TEN[i] ?? `Bước ${i + 1}`, to_id: null, to_ten: null,
    la_cua_toi: i + 1 === toiO, la_kcs_cuoi: false, trang_thai: t, phan_doan_tong: 1, chay_chung: false,
    ke_hoach: null, thuc_te: 0, don_vi: null, da_giao_sang_toi: null, da_nhan: null,
    cong_viec_id: i + 1 === toiO ? 99 : null,
  }));
}
const k = (d: SxRoutingBuoc[], id = 99, sk?: string) => viTriHang(d, id, sk)?.k;
const dKhoang = (d: SxRoutingBuoc[]) => { const v = viTriHang(d, 99)!; return v.m - v.c; };

describe("vị trí hàng trên tuyến", () => {
  it("tới khi bước của tổ đang chạy", () => {
    expect(k(dai(["running", "released", "released"], 1))).toBe("toi");
  });
  it("còn 2 đến 3 bước", () => {
    const d = dai(["completed", "running", "released", "released", "released"], 4);
    expect(k(d)).toBe("sap");
    expect(dKhoang(d)).toBe(2);
  });
  it("còn 1 bước", () => {
    expect(dKhoang(dai(["running", "released"], 2))).toBe(1);
  });
  it("còn 4 bước", () => {
    expect(dKhoang(dai(["running", "released", "released", "released", "released"], 5))).toBe(4);
  });
  it("qua khi hàng đã ở bước sau", () => {
    expect(k(dai(["completed", "running", "released"], 1))).toBe("qua");
  });
  it("chưa ai chạy thì lấy bước đầu chưa xong", () => {
    expect(dKhoang(dai(["completed", "released", "released"], 3))).toBe(1);
  });
  it("xong hết là bước cuối", () => {
    expect(k(dai(["completed", "completed"], 1))).toBe("qua");
  });
  it("tạm dừng tính như đang làm", () => {
    expect(k(dai(["completed", "paused", "released"], 2))).toBe("toi");
  });
  it("không có dải, không thấy bước", () => {
    expect(viTriHang([], 99)).toBeNull();
    expect(viTriHang(dai(["running", "released"], 1), 12345)).toBeNull();
  });
  it("phân đoạn sau tìm ô qua step_key", () => {
    expect(k(dai(["running", "released"], 2), 8, "b2")).toBe("sap");
  });
});

describe("câu vị trí", () => {
  it("ngắn và dài", () => {
    const qua = dai(["completed", "completed", "running"], 1);
    expect(cauViTri(viTriHang(qua, 99)!, qua, true)).toBe("Đã qua, đang ở Cán màng");
    expect(cauViTri(viTriHang(qua, 99)!, qua, false)).toBe("Đã qua tổ mình, hàng đang ở Cán màng");
    const toi = dai(["running", "released"], 1);
    expect(cauViTri(viTriHang(toi, 99)!, toi, true)).toBe("Hàng ở tổ mình");
    expect(cauViTri(viTriHang(toi, 99)!, toi, false)).toBe("Hàng đã tới tổ mình");
    const sap = dai(["running", "released", "released"], 3);
    expect(cauViTri(viTriHang(sap, 99)!, sap, true)).toBe("Còn 2 bước tới mình");
    expect(cauViTri(viTriHang(sap, 99)!, sap, false)).toBe("Còn 2 bước nữa mới tới tổ mình");
  });

  it("mọi bước đã xong: không nói 'đang ở' bước cuối, lưới và ngăn cùng một câu", () => {
    const xong = dai(["completed", "completed", "completed"], 1);
    expect(cauViTri(viTriHang(xong, 99)!, xong, true)).toBe("Xong cả 3 bước");
    expect(cauViTri(viTriHang(xong, 99)!, xong, false)).toBe("Lệnh đã xong cả 3 bước, hàng đã đi tiếp");
  });
});

describe("dải của một việc", () => {
  const w = { id: 5, ten_cong_doan: "Cắt tờ", trang_thai: "released", department_id: 3, la_kcs_cuoi: false,
    loai_buoc: "may", so_luong_ra: 100, da_lam: 0, don_vi_ra: "to" } as SxWorkItem;
  const l = (nguon_loai: string, routing?: SxRoutingBuoc[]) => ({ nguon_loai, routing }) as SxLenhNhom;
  it("lệnh một bước dựng một ô ⇒ hàng ở tổ mình; bài ghép không có dải", () => {
    const d = daiCuaViec(l("lsx", []), w);
    expect(viTriHang(d, 5)?.k).toBe("toi");
    expect(daiCuaViec(l("bai_ghep"), w)).toEqual([]);
  });
  it("có dải thì dùng dải của lệnh", () => {
    const d = dai(["running", "released"], 2);
    expect(daiCuaViec(l("lsx", d), w)).toBe(d);
  });
});

describe("cauDuoi — ô đuôi: làm xong bước cuối thì hàng đi đâu", () => {
  const dv = (m: string | null | undefined) => (m === "to" ? "tờ" : m ?? "");
  const gio = () => "09:25";
  it("thuê ngoài chưa mang đi / đang ở ngoài", () => {
    expect(cauDuoi({ loai: "cho_mang_di", noi: "Thành Công", so: 330, don_vi: "to" }, dv, gio))
      .toEqual({ ten: "Chờ mang đi Thành Công", so: ["330 tờ chờ mang đi"] });
    expect(cauDuoi({ loai: "o_ngoai", noi: "Thành Công", so: 330, don_vi: "to", luc: "x" }, dv, gio))
      .toEqual({ ten: "Đang ở Thành Công", so: ["mang đi 330 tờ", "lúc 09:25"] });
  });
  it("về bước của lệnh khác: tách đã nhận với chờ nhận", () => {
    expect(cauDuoi({ loai: "ve_buoc", noi: "Xén 3 mặt", lsx_ma: "LSX26-0003", cho_nhan: 1320, don_vi: "con" }, dv, gio))
      .toEqual({ ten: "Về Xén 3 mặt (LSX26-0003)", so: ["1.320 con chờ tổ nhận"] });
  });
  it("nhập kho chưa gửi gì", () => {
    expect(cauDuoi({ loai: "ve_kho" }, dv, gio)).toEqual({ ten: "Nhập kho thành phẩm", so: ["chưa gửi kho"] });
  });
});
