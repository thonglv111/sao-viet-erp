/** Tiền khách đang để trong ngăn khách: đơn phải trả lại có nút "Trả lại" gắn đúng đơn; đơn còn chờ trừ
 *  vào hoá đơn thì không có nút; không quyền thì không có nút nào. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TienDangDeBlock } from "./TienDangDeBlock";

const DS = [
  { order_id: 5, order_code: "DH005", da_nhan: 300_000, dang_de: 149_798, con_lai: 149_798, tinh_trang: "don_huy" },
  { order_id: 6, order_code: "DH006", da_nhan: 500_000, dang_de: 500_000, con_lai: 0, tinh_trang: "cho_tru" },
];

describe("TienDangDeBlock", () => {
  it("bấm Trả lại gửi đúng đơn, đơn chờ trừ không có nút", () => {
    const onTraLai = vi.fn();
    render(<TienDangDeBlock ds={DS} onTraLai={onTraLai} />);
    expect(screen.getAllByText("149.798")).toHaveLength(2);
    expect(screen.getByText("Chờ trừ vào hoá đơn")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Trả lại tiền khách đơn DH006" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Trả lại tiền khách đơn DH005" }));
    expect(onTraLai).toHaveBeenCalledWith(DS[0]);
  });

  it("không quyền lập phiếu chi: không có nút", () => {
    render(<TienDangDeBlock ds={DS} />);
    expect(screen.queryByRole("button", { name: /Trả lại/ })).toBeNull();
  });
});
