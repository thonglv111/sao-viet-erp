// Hộp Thôi dùng tài sản (lỗi E2E #44, 18/10/2026): ô ngày không cho chọn sau hôm nay. Trước đó ô cho
// chọn 15/12/2026, lưu là thẻ đổi sang "Đã thôi dùng" ngay và ngăn tính sẵn khấu hao tháng 11-12.
// "Hôm nay" theo giờ Việt Nam: 23:36 UTC ngày 17 đã là 06:36 ngày 18 ở xưởng.
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaiSanChiTiet } from "../../api/taiSan";
import { ThoiDungKhung } from "./ThaoTacDialogs";

// Thay ô ngày bằng một ô thường mang `min`/`max` ra thuộc tính: kiểm đúng phần ThoiDungKhung truyền
// xuống, không kiểm lịch bật lên của ChonNgay (đã có test riêng ở components/ChonNgay.test.ts).
vi.mock("../../components/ChonNgay", () => ({
  ChonNgay: (p: { value: string; min?: string; max?: string; "aria-label"?: string }) => (
    <input aria-label={p["aria-label"]} data-min={p.min} data-max={p.max} value={p.value} readOnly />
  ),
}));

const TS = {
  id: 14, ma: "TS-0014", ten: "May cat Polar", loai: "tscd", nguyen_gia: 120_000_000,
  ngay_su_dung: "2026-03-10", hao_mon_luy_ke: 0,
} as unknown as TaiSanChiTiet;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T23:36:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("ThoiDungKhung", () => {
  it("ô Ngày thôi dùng có max là hôm nay giờ VN, mặc định cũng là hôm nay", () => {
    render(<ThoiDungKhung token="t" taiSan={TS} lich={[]} onClose={() => {}} onDone={() => {}} />);
    const o = screen.getByLabelText("Ngày thôi dùng");
    expect(o).toHaveAttribute("data-max", "2026-10-18");
    expect(o).toHaveAttribute("data-min", "2026-03-10");
    expect(o).toHaveValue("2026-10-18");
  });
});
