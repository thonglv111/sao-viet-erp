import { describe, expect, it } from "vitest";
import { loiHoiNhapKho, toastKhoNhapThanhPham } from "./kcsNhan";

describe("loiHoiNhapKho", () => {
  it("không lặp chữ khi đơn vị ra là thành phẩm", () => {
    const s = loiHoiNhapKho("20.000", "thành phẩm", "LSX26-0015", "Đóng gói");
    expect(s).toBe("Đề nghị kho nhập 20.000 thành phẩm đã kiểm đạt của LSX26-0015 (Đóng gói).");
    expect(s).not.toContain("thành phẩm thành phẩm");
  });
});

describe("toastKhoNhapThanhPham", () => {
  // Bấm thử 19/10: "Tạo và ghi sổ" bắn hai lần "Kho đã nhận đủ" — lần đầu lúc mới LẬP phiếu
  // (preparing), kho chưa nhận gì. Kho huỷ yêu cầu cũng từng ra "đã nhận đủ".
  it("chỉ nói nhận đủ khi yêu cầu đã xong", () => {
    expect(toastKhoNhapThanhPham("done", "DNN00084")?.chu).toBe("📦 Kho đã nhận đủ yêu cầu nhập kho DNN00084");
    expect(toastKhoNhapThanhPham("partial", "DNN00084")?.chu).toContain("MỘT PHẦN");
  });
  it("lập phiếu chưa ghi sổ thì im", () => {
    expect(toastKhoNhapThanhPham("preparing", "DNN00084")).toBeNull();
    expect(toastKhoNhapThanhPham("received", "DNN00084")).toBeNull();
  });
  it("kho huỷ thì nói huỷ", () => {
    const t = toastKhoNhapThanhPham("cancelled", "DNN00084");
    expect(t?.chu).toContain("huỷ");
    expect(t?.kieu).toBe("warn");
  });
});
