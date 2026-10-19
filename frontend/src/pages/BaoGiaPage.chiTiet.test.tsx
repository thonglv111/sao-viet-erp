// Chi tiết báo giá (lỗi #10, #12, #13 bấm thử 18/10/2026).
//
// #10 khối "Giá bán đề xuất" cộng số CHƯA làm tròn của từng dòng ⇒ lệch 1 đ với chính các dòng hiển
//     thị (5.581.563 + 6.401.851 = 11.983.414 mà tổng ghi 11.983.415).
// #12 màn chi tiết đang mở không tự đổi khi bên kia duyệt/từ chối — chỉ danh sách nghe `eventTick`.
// #13 khách chốt một phần mà tổng vẫn cộng cả dòng khách không lấy.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { congTongBaoGia, dongDuocCong } from "./bao-gia-tong";

describe("Tổng báo giá", () => {
  it("#10 cộng số đã làm tròn của từng dòng — khớp các dòng đang hiển thị", () => {
    const t = congTongBaoGia([
      { cost: 4_650_000.4, ck: 0, selling: 5_581_563.4, vatPct: 10 },
      { cost: 5_385_139.4, ck: 0, selling: 6_401_851.4, vatPct: 10 },
    ]);
    expect(t.selling).toBe(11_983_414);
    expect(t.cost).toBe(10_035_139);
    expect(t.vat).toBe(558_156 + 640_185);
    expect(t.grand).toBe(11_983_414 + 558_156 + 640_185);
    expect(t.profit).toBe(11_983_414 - 10_035_139);
  });

  it("#62 gồm VAT = ⌊Σ giá tròn·(100+VAT)/100⌋ — khớp lịch sử phiên bản và đơn hàng", () => {
    // BG26-0018 → DH017: 4.957.441,80 ⇒ đơn 5.453.186 (trước báo giá ghi 5.453.185).
    expect(congTongBaoGia([{ cost: 0, ck: 0, selling: 4_957_441.8, vatPct: 10 }]).grand).toBe(5_453_186);
    // BG26-0012 → DH010: cộng VAT thô ra 42.454.542, đơn ghi 42.454.541.
    const ds = [14_382_947.71, 2_956_560.52, 8_283_242.71, 7_957_476.6, 5_014_808.71]
      .map((selling) => ({ cost: 0, ck: 0, selling, vatPct: 10 }));
    expect(congTongBaoGia(ds).grand).toBe(42_454_541);
  });

  it("#10 VAT không tròn từng dòng — khớp tổng gồm VAT của lịch sử phiên bản", () => {
    // BG26-0015 v2 bấm lại 18/10: VAT từng dòng 564.031,6 + 713.606,5. Làm tròn từng dòng ra
    // 1.277.639 (tổng 14.054.020) trong khi máy chủ ghi 14.054.019.
    const t = congTongBaoGia([
      { cost: 4_700_264, ck: 0, selling: 5_640_316, vatPct: 10 },
      { cost: 5_946_721, ck: 0, selling: 7_136_065, vatPct: 10 },
    ]);
    expect(t.vat).toBe(1_277_638);
    expect(t.grand).toBe(14_054_019);
  });

  it("#13 báo giá đã chốt một phần chỉ cộng dòng khách lấy", () => {
    const ds = [{ id: 1, accepted: true }, { id: 2, accepted: false }];
    expect(dongDuocCong(ds, true).map((x) => x.id)).toEqual([1]);
    // Chưa chốt: cờ accepted còn trung tính ⇒ cộng hết.
    expect(dongDuocCong(ds, false).map((x) => x.id)).toEqual([1, 2]);
    // Báo giá cũ chốt trước khi có cờ (không dòng nào true) ⇒ cộng hết, như đơn hàng kéo hết.
    expect(dongDuocCong([{ id: 1, accepted: false }], true).map((x) => x.id)).toEqual([1]);
  });
});

const get = vi.fn();
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ token: "t" }) }));
vi.mock("../auth/permissions", () => ({ useCan: () => () => false }));
vi.mock("../api/client", async (goc) => ({
  ...(await goc<typeof import("../api/client")>()),
  api: {
    quotations: {
      get: (...a: unknown[]) => get(...a),
      activity: () => Promise.resolve({ items: [] }),
    },
  },
}));

import { QuotationDetailView } from "./BaoGiaPage";

function chiTiet(status: string) {
  return {
    id: 7, code: "BG26-0013", version: 1, customer_id: null, customer: null,
    phieu_tinh_gia_id: null, phieu_tinh_gia_ma: null, valid_until: null, status,
    cancel_reason: null, terms_text: null, delivery_address: null, contact_name_snapshot: null,
    contact_phone_snapshot: null, contact_title_snapshot: null, contact_email_snapshot: null,
    customer_note: null, internal_note: null, total_cost: 0, subtotal_amount: 0, discount_amount: 0,
    vat_amount: 0, total: 0, allowed_transitions: [],
    versions: [{ version: 1, status, created_at: "2026-10-18T00:00:00Z" }],
    items: [], exception_required: false, exception_status: "none", exception_cleared: false,
    exceptions: [], exception_note: null, markup_pct: null,
  };
}

describe("Chi tiết báo giá nghe sự kiện (#12)", () => {
  it("eventTick nhảy ⇒ hỏi lại chi tiết, không đợi mở lại", async () => {
    get.mockResolvedValueOnce(chiTiet("pending_approval")).mockResolvedValue(chiTiet("draft"));
    const p = { quotationId: 7, statuses: [], onClose: () => {}, onChanged: () => {} };
    const { rerender } = render(<QuotationDetailView {...p} eventTick={0} />);
    await screen.findAllByText(/BG26-0013/);
    expect(get).toHaveBeenCalledTimes(1);

    rerender(<QuotationDetailView {...p} eventTick={1} />);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});

describe("Chi tiết báo giá: lượt nạp về muộn không đè lượt mới (rà cuối 19/10)", () => {
  it("lượt đầu về sau lượt do sự kiện ⇒ giữ dữ liệu của lượt sau", async () => {
    get.mockReset();
    let traLuotDau: (v: unknown) => void = () => {};
    get.mockReturnValueOnce(new Promise((ok) => { traLuotDau = ok; }))
      .mockResolvedValueOnce({ ...chiTiet("pending_approval"), code: "BG26-MOI" });
    const p = { quotationId: 7, statuses: [], onClose: () => {}, onChanged: () => {} };
    const { rerender } = render(<QuotationDetailView {...p} eventTick={0} />);
    rerender(<QuotationDetailView {...p} eventTick={1} />);
    await screen.findAllByText(/BG26-MOI/);
    traLuotDau({ ...chiTiet("draft"), code: "BG26-CU" });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryAllByText(/BG26-CU/)).toHaveLength(0);
  });
});
