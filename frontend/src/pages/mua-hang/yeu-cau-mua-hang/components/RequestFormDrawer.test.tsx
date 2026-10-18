/** Ngăn Tạo / Sửa yêu cầu mua hàng: bấm ra nền khi đang gõ dở phải hỏi, không đóng im lặng. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { DepartmentPurchaseRequestInput, DepartmentPurchaseRequestLineInput } from "../../../../api/client";
import { AuthContext, type AuthState } from "../../../../auth/AuthContext";
import { emptyRequest } from "../shared/helpers";
import { RequestFormDrawer } from "./RequestFormDrawer";

const AUTH: AuthState = {
  status: "authenticated", user: null, token: "t",
  login: async () => {}, logout: async () => {},
  updateUser: () => {}, notice: null, setNotice: () => {},
};

function Khung({ dau, closeForm }: { dau?: Partial<DepartmentPurchaseRequestInput>; closeForm: () => void }) {
  const [form, setForm] = useState<DepartmentPurchaseRequestInput>({ ...emptyRequest(), ...dau });
  const setLine = (i: number, patch: Partial<DepartmentPurchaseRequestLineInput>) =>
    setForm((c) => ({ ...c, lines: c.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) }));
  return (
    <AuthContext.Provider value={AUTH}>
      <RequestFormDrawer
        editing={null} departmentName="Kho" form={form} setForm={setForm} setLine={setLine}
        formError={null} minNeededDate="2026-10-01" saving={false}
        save={async () => {}} closeForm={closeForm}
      />
    </AuthContext.Provider>
  );
}

/** Bấm ra vùng nền ngoài ngăn: nhấn và nhả đều trên lớp phủ. */
function bamNen() {
  const nen = document.querySelector(".kt-man") as HTMLElement;
  act(() => {
    fireEvent.mouseDown(nen);
    fireEvent.click(nen);
  });
}

describe("RequestFormDrawer", () => {
  it("#21 bấm nền khi form đã gõ dữ liệu thì hỏi 'Bỏ phiếu đang nhập?', Nhập tiếp giữ nguyên dữ liệu", async () => {
    const dong = vi.fn();
    render(<Khung closeForm={dong} />);
    await userEvent.type(screen.getByPlaceholderText(/thiếu giấy cho lệnh/), "Thiếu giấy couché");

    bamNen();
    expect(screen.getByText("Bỏ phiếu đang nhập?")).toBeInTheDocument();
    expect(dong).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Nhập tiếp" }));
    expect(screen.queryByText("Bỏ phiếu đang nhập?")).toBeNull();
    expect(dong).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText(/thiếu giấy cho lệnh/) as HTMLInputElement).value).toBe("Thiếu giấy couché");

    bamNen();
    await userEvent.click(screen.getByRole("button", { name: "Bỏ" }));
    expect(dong).toHaveBeenCalledTimes(1);
  });

  it("#21 nút Huỷ ở chân ngăn cũng hỏi khi đang gõ dở", async () => {
    const dong = vi.fn();
    render(<Khung closeForm={dong} />);
    await userEvent.type(screen.getByPlaceholderText(/thiếu giấy cho lệnh/), "x");
    await userEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(screen.getByText("Bỏ phiếu đang nhập?")).toBeInTheDocument();
    expect(dong).not.toHaveBeenCalled();
  });

  it("#21 form còn trống thì bấm nền đóng luôn, không hỏi", () => {
    const dong = vi.fn();
    render(<Khung closeForm={dong} />);
    bamNen();
    expect(screen.queryByText("Bỏ phiếu đang nhập?")).toBeNull();
    expect(dong).toHaveBeenCalledTimes(1);
  });
});
