// Bàn tổ có HAI hình dữ liệu; chọn nhầm hình là băng KPI đếm sai.
import { describe, expect, it } from "vitest";
import { chonHinhBan, slText, slThucTe, slTot } from "./thsxShared";
import type { SxWorkItem, SxWorkItemsOut } from "../api/client";
import { nhanChang } from "./lsxBuoc";

const viec = { id: 3, trang_thai: "released" } as never;

describe("chonHinhBan", () => {
  it('nhom="phang": giữ mảng bước, KHÔNG nhận mảng lệnh rỗng máy chủ vẫn trả kèm', () => {
    // BE khai `lenh: list[...] = []` nên khoá này LUÔN có mặt, kể cả ở chế độ phẳng. Đọc theo
    // "có mảng lệnh hay không" là đếm 0 việc trong khi Gantt đang vẽ đủ việc.
    const r: SxWorkItemsOut = { team_id: 12, nhom: "phang", trang: null, lenh: [], cong_viec: [viec] };
    const h = chonHinhBan(r);
    expect(h.lenh).toBeNull();
    expect(h.cong_viec).toHaveLength(1);
    expect(h.tongLenh).toBe(0);
  });

  it('nhom="lenh": giữ trang lệnh, bỏ mảng bước', () => {
    const r: SxWorkItemsOut = {
      team_id: 12, nhom: "lenh",
      trang: { trang: 2, co_trang: 20, tong: 37 },
      lenh: [{ so_viec: 2, cong_viec: [viec] } as never],
      cong_viec: [],
    };
    const h = chonHinhBan(r);
    expect(h.cong_viec).toBeNull();
    expect(h.lenh).toHaveLength(1);
    expect(h.tongLenh).toBe(37);
  });

  it("lệnh rỗng thật vẫn là chế độ lệnh, không rơi về hình phẳng", () => {
    const h = chonHinhBan({ team_id: 12, nhom: "lenh", trang: { trang: 1, co_trang: 20, tong: 0 }, lenh: [], cong_viec: [] });
    expect(h.lenh).toEqual([]);
    expect(h.cong_viec).toBeNull();
  });
});

describe("tên chặng thành phẩm theo ĐVT lệnh", () => {
  // E2E 19/10/2026: form ghi nói "cái", đầu ngăn nói "thành phẩm", KCS và kho nói "cuốn".
  const w = {
    don_vi_vao: "tay", don_vi_ra: "cai", so_luong_vao: 4000, so_luong_ra: 1000,
    da_lam: 900, nhan: 4000, ngoai_dong: false, don_vi_tinh: "cuốn",
  } as unknown as SxWorkItem;
  it("chặng cai gọi bằng ĐVT của lệnh", () => {
    expect(slTot(w)).toBe("900 cuốn");
    expect(slText(w)).toContain("1.000 cuốn");
    expect(slThucTe(w)).toContain("Tốt 900 cuốn");
  });
  it("lệnh không có ĐVT (bài ghép) giữ tên chặng", () => {
    expect(slTot({ ...w, don_vi_tinh: null })).toBe(`900 ${nhanChang("cai")}`);
  });
});
