import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PurchaseRequestRow } from "../../../../api/client";

const goi = vi.hoisted(() => ({ supplierCredit: vi.fn() }));
vi.mock("../../../../api/client", async (g) => ({
  ...(await g<typeof import("../../../../api/client")>()),
  api: { purchaseRequests: goi },
}));

import { useHanMucNcc } from "./useHanMucNcc";

const don = (o: Partial<PurchaseRequestRow> = {}) =>
  ({ id: 51, supplier_id: 3, ...o }) as unknown as PurchaseRequestRow;

describe("useHanMucNcc (#22)", () => {
  beforeEach(() => goi.supplierCredit.mockReset());

  it("đơn vừa lưu đợt giao (bản ghi mới cùng id) thì nạp lại Đang nợ nhà cung cấp", async () => {
    goi.supplierCredit.mockResolvedValueOnce({ dang_no: 0 }).mockResolvedValueOnce({ dang_no: 870000 });
    const { result, rerender } = renderHook(({ d }) => useHanMucNcc("tok", d), {
      initialProps: { d: don() },
    });
    await waitFor(() => expect(result.current).toEqual({ dang_no: 0 }));
    rerender({ d: don({ gia_tri_da_giao: 870000 }) });
    await waitFor(() => expect(result.current).toEqual({ dang_no: 870000 }));
    expect(goi.supplierCredit).toHaveBeenCalledTimes(2);
  });

  it("danh sách nạp lại ra bản ghi y hệt thì không hỏi lại", async () => {
    goi.supplierCredit.mockResolvedValue({ dang_no: 0 });
    const { result, rerender } = renderHook(({ d }) => useHanMucNcc("tok", d), {
      initialProps: { d: don() },
    });
    await waitFor(() => expect(result.current).toEqual({ dang_no: 0 }));
    rerender({ d: don() });
    rerender({ d: don() });
    expect(goi.supplierCredit).toHaveBeenCalledTimes(1);
  });

  it("đơn chưa có nhà cung cấp thì không hỏi", () => {
    const { result } = renderHook(() => useHanMucNcc("tok", don({ supplier_id: null })));
    expect(result.current).toBeNull();
    expect(goi.supplierCredit).not.toHaveBeenCalled();
  });
});
