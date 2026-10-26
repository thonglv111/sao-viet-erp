// Ô "Điều chỉnh lương" (24/10/2026): kế toán gõ khoản lệch (±) cho người không có tổ khoán — tài xế
// chạy xe khác bảng giá, phụ xe đi với người ngoài bảng lương. Engine đã cộng ô này, chỉ thiếu chỗ nhập.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { updateLine } = vi.hoisted(() => ({ updateLine: vi.fn() }));
vi.mock("../../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../../api/client")>()),
  api: {
    luong: {
      updateLine: (...a: unknown[]) => updateLine(...a),
      lineComponents: () => Promise.resolve({ items: [] }),
      components: { list: () => Promise.resolve({ items: [] }) },
    },
  },
}));

import { LineEditModal } from "./LineEditModal";
import type { PayrollLine } from "../../../../api/client";

const DONG = {
  id: 7, employee_name: "Trần Hùng Tín", vi_pham: 0, note: null, di_tre: 0, dt_vuot_troi: 0,
  phat_bien_ban: 0, phat_5s_dong_phuc: 0, di_tre_manual: false, dieu_chinh_luong: 0,
  luong_cong: 0, chuyen_can: 0, allowance: 0, pit_taxable: 0, pit: 0, standard_cong: 26,
} as unknown as PayrollLine;

describe("LineEditModal — điều chỉnh lương", () => {
  it("gõ số âm hoặc dương rồi Lưu thì gửi dieu_chinh_luong", async () => {
    updateLine.mockResolvedValue({});
    render(<LineEditModal token="t" line={DONG} readOnly={false} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Điều chỉnh lương/), { target: { value: "310552" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await vi.waitFor(() => expect(updateLine).toHaveBeenCalled());
    expect(updateLine.mock.calls[0][2]).toMatchObject({ dieu_chinh_luong: 310552 });
  });

  it("xoá trắng ghi chú thì gửi chuỗi rỗng — null máy chủ hiểu là giữ nguyên", async () => {
    updateLine.mockReset().mockResolvedValue({});
    render(<LineEditModal token="t" line={{ ...DONG, note: "Sổ T08" }} readOnly={false}
      onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByDisplayValue("Sổ T08"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await vi.waitFor(() => expect(updateLine).toHaveBeenCalled());
    expect(updateLine.mock.calls[0][2]).toMatchObject({ note: "" });
  });
  it("gõ dấu trừ trước rồi mới gõ số: ô giữ \"-\", gửi số âm (L-SX-35)", async () => {
    updateLine.mockReset().mockResolvedValue({});
    render(<LineEditModal token="t" line={DONG} readOnly={false} onClose={() => {}} onSaved={() => {}} />);
    const o = screen.getByLabelText(/Điều chỉnh lương/) as HTMLInputElement;
    fireEvent.change(o, { target: { value: "-" } });
    expect(o.value).toBe("-");
    fireEvent.change(o, { target: { value: "-310552" } });
    expect(o.value).toBe("-310.552");
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await vi.waitFor(() => expect(updateLine).toHaveBeenCalled());
    expect(updateLine.mock.calls[0][2]).toMatchObject({ dieu_chinh_luong: -310552 });
  });

  it("xoá trắng ô số thì ô để trống, không tự điền 0 (L-SX-35)", () => {
    render(<LineEditModal token="t" line={{ ...DONG, vi_pham: 5000 }} readOnly={false}
      onClose={() => {}} onSaved={() => {}} />);
    const o = screen.getByDisplayValue("5.000") as HTMLInputElement;
    fireEvent.change(o, { target: { value: "" } });
    expect(o.value).toBe("");
  });
});
