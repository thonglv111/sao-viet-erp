import { describe, expect, it } from "vitest";
import { kenhCuaNav, loiNhacCua, navCuaKenh } from "./thongBaoMan";

describe("thongBaoMan", () => {
  it("đổi kênh ↔ mục thanh bên", () => {
    expect(navCuaKenh("luong")).toBe("luong");
    expect(navCuaKenh("san_xuat")).toBe("ke-hoach-sx");
    expect(navCuaKenh("to_sx_12")).toBe("thuc-hien-sx:12");
    expect(navCuaKenh("khong_co")).toBeNull();
    expect(kenhCuaNav("ke-hoach-sx")).toBe("san_xuat");
    expect(kenhCuaNav("thuc-hien-sx:12")).toBe("to_sx_12");
    expect(kenhCuaNav("dashboard")).toBeNull();
  });
  it("lời nhắc tiếng Việt, loại đã có toast riêng thì im", () => {
    expect(loiNhacCua("nghi_phep_moi", null)).toBe("🔔 Có đơn nghỉ phép mới chờ duyệt");
    expect(loiNhacCua("bao_gia_cho_duyet", "BG26-0001")).toBe("🔔 Báo giá BG26-0001 chờ bạn duyệt");
    expect(loiNhacCua("bao_gia_quyet_dinh", "BG26-0001")).toBeNull();
    expect(loiNhacCua("khong_biet", null)).toBeNull();
    expect(loiNhacCua("kho_yeu_cau_phat_hanh", "LSX26-0007: 3 yêu cầu xuất mới"))
      .toBe("🔔 LSX26-0007: 3 yêu cầu xuất mới chờ lập phiếu");
  });
});
