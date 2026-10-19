// Màn "Phiếu lương của tôi" đang mở phải tự nạp lại khi HCNS công bố (lỗi #39 bấm thử 18/10/2026).
//
// Màn ghi "Phiếu sẽ hiện ngay khi HCNS công bố" mà công bố xong vẫn đứng yên tới khi người ta đổi
// tab. Máy chủ đẩy `phieu_luong_cong_bo` (nhóm nhân sự) ⇒ `eventTick` nhảy ⇒ màn hỏi lại phiếu.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const myPayslip = vi.fn();

vi.mock("../../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../../api/client")>()),
  api: { luong: { myPayslip: (...a: unknown[]) => myPayslip(...a) } },
}));

import { PhieuLuongTab } from "./PhieuLuongTab";

describe("Phiếu lương của tôi — nạp lại theo sự kiện (#39)", () => {
  it("eventTick nhảy ⇒ hỏi lại máy chủ, phiếu vừa công bố hiện ra", async () => {
    myPayslip.mockResolvedValue({
      has_employee: true, line: null, period: null, ky_xem_duoc: [],
      cho_phat: { year: 2026, month: 10, tinh_trang: "chua_phat", mo_luc: null },
    });
    const { rerender } = render(<PhieuLuongTab token="t" eventTick={0} />);
    expect(await screen.findByText(/Phiếu sẽ hiện ngay khi HCNS công bố/)).toBeTruthy();
    expect(myPayslip).toHaveBeenCalledTimes(1);

    rerender(<PhieuLuongTab token="t" eventTick={1} />);
    await vi.waitFor(() => expect(myPayslip).toHaveBeenCalledTimes(2));
  });
});
