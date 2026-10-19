// Lỗi #53 (nút Hủy đơn cho người chỉ có Xem) và #54 (ô Sản xuất "chờ lệnh" khi không xem được lệnh).
import { describe, expect, it } from "vitest";

import { duocHuyDon, trangThaiSanXuat } from "./don-hang-ban-dieu-kien";

describe("Ngăn đơn hàng bán", () => {
  it("#53 chỉ có Xem thì không thấy Hủy đơn, kể cả đơn đã chốt", () => {
    expect(duocHuyDon("ordered", false)).toBe(false);
    expect(duocHuyDon("draft", false)).toBe(false);
    expect(duocHuyDon("ordered", true)).toBe(true);
    expect(duocHuyDon("cancelled", true)).toBe(false);
  });

  it("#54 đọc lệnh bị 403 (0 lệnh) mà máy chủ báo có lệnh ⇒ không ghi chờ lệnh", () => {
    expect(trangThaiSanXuat(true, 0, true)).toBe("chay");
    expect(trangThaiSanXuat(true, 0, false)).toBe("cho_kh");
    expect(trangThaiSanXuat(false, 3, true)).toBe("chua");
  });
});
