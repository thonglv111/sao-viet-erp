// Chiết khấu % ở báo giá NHỚ qua lần lưu (bấm thử 23/10/2026): lưu 3% xong gõ tay giá bán thì CK phải
// là 3% của giá gõ (spec 2026-10-23-hoa-hong-theo-tien-thu), không đứng im ở số tiền của giá cũ.
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { get, update } = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ token: "t" }) }));
vi.mock("../auth/permissions", () => ({ useCan: () => () => true }));
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
  id: 11, line_no: 1, product_type: "to_roi", product_name: "Tờ rơi", product_spec_text: null,
  dien_giai: null, nhom: null, anh_minh_hoa: null, quantity: 1, unit: "cái", dvt_nhom: null,
  total_cost_snapshot: 10_000_000, margin_percent: 20, selling_price: 12_448_133, gia_go_tay: false,
  unit_price: 12_448_133, discount_amount: 373_444, discount_percent: 3, ke_gia: 0,
  gia_sau_ke: 12_448_133, vat_percent: 0, vat_amount: 0, final_amount: 12_448_133, note: null,
  accepted: false,
};
const chiTiet = {
  id: 7, code: "BG26-0004", version: 1, customer_id: null, customer: null,
  phieu_tinh_gia_id: null, phieu_tinh_gia_ma: null, valid_until: null, status: "draft",
  cancel_reason: null, terms_text: null, delivery_address: null, contact_name_snapshot: null,
  contact_phone_snapshot: null, contact_title_snapshot: null, contact_email_snapshot: null,
  customer_note: null, internal_note: null, total_cost: 10_000_000, subtotal_amount: 12_448_133,
  discount_amount: 373_444, vat_amount: 0, total: 12_448_133, allowed_transitions: [],
  versions: [{ version: 1, status: "draft", created_at: "2026-10-23T00:00:00Z" }],
  items: [dong], exception_required: false, exception_status: "none", exception_cleared: false,
  exceptions: [], exception_note: null, markup_pct: 20,
};

describe("Chiết khấu % nhớ qua lần lưu", () => {
  it("gõ tay giá bán ⇒ CK = % đã lưu × giá gõ, gửi lại % chứ không gửi số tiền cũ", async () => {
    get.mockResolvedValue(chiTiet);
    update.mockResolvedValue({});
    const user = userEvent.setup();
    render(<QuotationDetailView quotationId={7} statuses={[]} onClose={() => {}} onChanged={() => {}}
      eventTick={0} />);
    const gia = await screen.findByLabelText("Giá bán Tờ rơi");
    await user.clear(gia);
    await user.type(gia, "15000000");
    // Xem trước: CK 3% × 15.000.000 = 450.000 (không phải 373.444 của giá cũ).
    expect((await screen.findAllByText(/450\.000/)).length).toBeGreaterThan(0);
    fireEvent.keyDown(gia, { key: "Enter" });
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    const gui = update.mock.calls[0][2].items[0];
    expect(gui).toMatchObject({ id: 11, manual_selling_price: 15_000_000, discount_percent: 3, discount_amount: 0 });
  });
});
