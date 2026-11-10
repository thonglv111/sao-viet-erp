// Ô Đơn giá ở bảng dòng báo giá (08/11/2026): đơn giá = giá bán ÷ SL, gõ đơn giá thì giá bán = đơn giá
// × SL làm tròn tới đồng và lưu như gõ tay giá bán.
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { get, update } = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ token: "t" }) }));
vi.mock("../auth/permissions", () => ({ useCan: () => () => true, useTat: () => () => false }));
vi.mock("../api/client", async (goc) => ({
  ...(await goc<typeof import("../api/client")>()),
  api: {
    quotations: {
      get: (...a: unknown[]) => get(...a),
      update: (...a: unknown[]) => update(...a),
      activity: () => Promise.resolve({ items: [] }),
    },
  },
}));

import { QuotationDetailView } from "./BaoGiaPage";

const dong = {
  id: 21, line_no: 1, product_type: "hop", product_name: "Hộp mỹ phẩm", product_spec_text: null,
  dien_giai: null, nhom: null, anh_minh_hoa: null, quantity: 6000, unit: "hộp", dvt_nhom: null,
  total_cost_snapshot: 18_241_635, margin_percent: 20, selling_price: 21_889_962, gia_go_tay: false,
  unit_price: 3648.327, discount_amount: 0, discount_percent: 0, ke_gia: 0,
  gia_sau_ke: 21_889_962, vat_percent: 0, vat_amount: 0, final_amount: 21_889_962, note: null,
  accepted: false,
};
const chiTiet = {
  id: 8, code: "BG26-0005", version: 1, customer_id: null, customer: null,
  phieu_tinh_gia_id: null, phieu_tinh_gia_ma: null, valid_until: null, status: "draft",
  cancel_reason: null, terms_text: null, delivery_address: null, contact_name_snapshot: null,
  contact_phone_snapshot: null, contact_title_snapshot: null, contact_email_snapshot: null,
  customer_note: null, internal_note: null, total_cost: 18_241_635, subtotal_amount: 21_889_962,
  discount_amount: 0, vat_amount: 0, total: 21_889_962, allowed_transitions: [],
  versions: [{ version: 1, status: "draft", created_at: "2026-11-08T00:00:00Z" }],
  items: [dong], exception_required: false, exception_status: "none", exception_cleared: false,
  exceptions: [], exception_note: null, markup_pct: 20,
};

describe("Ô Đơn giá của dòng báo giá", () => {
  it("hiện giá bán ÷ SL, gõ đơn giá ⇒ lưu giá bán = đơn giá × SL", async () => {
    get.mockResolvedValue(chiTiet);
    update.mockResolvedValue({});
    const user = userEvent.setup();
    render(<QuotationDetailView quotationId={8} statuses={[]} onClose={() => {}} onChanged={() => {}}
      eventTick={0} />);
    const dg = (await screen.findByLabelText("Đơn giá Hộp mỹ phẩm")) as HTMLInputElement;
    // 21.889.962 ÷ 6.000 = 3.648,327 → hiện 2 số lẻ.
    expect(dg.value).toBe("3.648,33");
    await user.clear(dg);
    await user.type(dg, "3650");
    // Xem trước: ô Giá bán chạy theo 3.650 × 6.000 = 21.900.000.
    expect((screen.getByLabelText("Giá bán Hộp mỹ phẩm") as HTMLInputElement).value).toBe("21.900.000");
    fireEvent.keyDown(dg, { key: "Enter" });
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][2].items[0]).toMatchObject({ id: 21, manual_selling_price: 21_900_000 });
  });
});
