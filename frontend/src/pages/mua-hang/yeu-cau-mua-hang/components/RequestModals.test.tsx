import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DepartmentPurchaseRequestRow } from "../../../../api/client";
import { RequestModals } from "./RequestModals";

const yc = { id: 7, code: "YCMH-1", lines: [] } as unknown as DepartmentPurchaseRequestRow;

function ve(lyDoHuy: string) {
  return render(
    <RequestModals
      selected={yc} canceling={yc} setCanceling={vi.fn()} confirmCancel={vi.fn(async () => {})}
      lyDoHuy={lyDoHuy} setLyDoHuy={vi.fn()}
      boMon={null} setBoMon={vi.fn()} confirmBoMon={vi.fn(async () => {})} actionBusy={null}
    />,
  );
}

describe("RequestModals — huỷ cả yêu cầu (#20)", () => {
  it("có ô lý do bắt buộc, trống thì nút Hủy yêu cầu khoá", () => {
    ve("");
    expect(screen.getByText("Lý do huỷ (bắt buộc)")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Hủy yêu cầu" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("có lý do thì bấm được", () => {
    ve("Khách huỷ đơn");
    expect((screen.getByRole("button", { name: "Hủy yêu cầu" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
