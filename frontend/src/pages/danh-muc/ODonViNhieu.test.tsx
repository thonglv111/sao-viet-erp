import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../auth/useAuth", () => ({ useAuth: () => ({ token: null }) }));

import { DON_VI_KHOA, ODonViNhieu } from "./ODonViNhieu";

const DV = [{ id: 1, ma: "kg", ten: "kg" }, { id: 2, ma: "to", ten: "tờ" }, { id: 3, ma: "thung", ten: "thùng" }];

describe("ODonViNhieu — tờ/kg bắt buộc của giấy (18/10/2026)", () => {
  it("chip tờ không có nút bỏ, đơn vị khác vẫn bỏ được", () => {
    render(<ODonViNhieu value={["to", "thung"]} chinh="kg" donVi={DV as never}
      batBuoc={DON_VI_KHOA} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Bỏ đơn vị tờ" })).toBeNull();
    expect(screen.getByRole("button", { name: "Bỏ đơn vị thùng" })).toBeTruthy();
  });

  it("thiếu nhóm bắt buộc thì nhắc máy tự thêm khi lưu", () => {
    render(<ODonViNhieu value={[]} chinh="kg" donVi={DV as never}
      batBuoc={DON_VI_KHOA} onChange={() => {}} />);
    expect(screen.getByText("Giấy luôn có tờ, máy tự thêm khi lưu.")).toBeTruthy();
  });

  it("không truyền batBuoc (Vật tư khác) thì mọi chip bỏ được", () => {
    render(<ODonViNhieu value={["to"]} chinh="kg" donVi={DV as never} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Bỏ đơn vị tờ" })).toBeTruthy();
  });
});
