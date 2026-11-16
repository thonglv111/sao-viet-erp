import { describe, expect, it, vi } from "vitest";

// Nhãn chặng dòng giấy đọc từ `/api/don-vi/tram` lúc chạy; test cho sẵn bảng nhỏ.
vi.mock("../../../tenDonVi", async (g) => ({
  ...(await g<typeof import("../../../tenDonVi")>()),
  nhanTram: (ma: string | null | undefined) =>
    ({ to: "tờ in", tay: "tay sách", con: "con" } as Record<string, string>)[(ma ?? "").toLowerCase()],
}));

import { lyDoChiGiaCong, motDonVi, soDv, tongTamTinh } from "./giaCong";

const dong = (don_vi: string | null) => ({ ten_viec: "Cán", dat: 1, hong: 0, hut: null, don_vi, don_gia: 1, tam_tinh: 1 });

describe("đọc phiếu nhận chờ trả tiền", () => {
  it("số kèm nhãn chặng 790 tờ in", () => {
    expect(soDv(790, "to")).toBe("790 tờ in");
    expect(soDv(1200, null)).toBe("1.200");
  });

  it("lý do chi điền sẵn liệt kê mã phiếu nhận", () => {
    expect(lyDoChiGiaCong([{ ma: "GN-0015" }, { ma: "GN-0016" }])).toBe("Trả tiền thuê gia công GN-0015, GN-0016");
  });

  it("tổng tạm tính làm tròn đồng từng phiếu", () => {
    expect(tongTamTinh([{ tam_tinh: 600000.4 }, { tam_tinh: 390000 }])).toBe(990000);
  });

  it("một đơn vị khi mọi dòng chung đơn vị, khác thì undefined", () => {
    expect(motDonVi([dong("to"), dong("to")])).toBe("to");
    expect(motDonVi([dong("to"), dong("con")])).toBeUndefined();
  });
});
