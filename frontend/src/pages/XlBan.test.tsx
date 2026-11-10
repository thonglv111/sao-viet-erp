import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { XlDongBan } from "../api/client";
import { XlBan, chipVatTu, laSatHan } from "./XlBan";

function dong(p: Partial<XlDongBan> = {}): XlDongBan {
  return {
    lsx_id: 1, ma: "LSX-001", ten: "Hộp giấy", customer_name: "Khách A", trang_thai: "san_sang",
    is_rush: false, so_luong_dat: 1000, don_vi_tinh: "cái", han_giao_khach: null, hen_luc: null,
    nguoi_hen: null, da_day_luc: null, ket_ly_do: null, ket_luc: null, vat_tu: null, vat_tu_ve: null,
    cum_id: null, updated_at: null, ...p,
  };
}

function ve(ds: XlDongBan[], demNgay: Record<string, number> = {}) {
  return render(
    <XlBan dong={ds} tab="da_hen" tu="2026-11-08" den="2026-11-21" homNay="2026-11-08" demNgay={demNgay}
      coChon chon={new Set()} chonId={null} onChon={vi.fn()} onChonTrang={vi.fn()} onMo={vi.fn()} />,
  );
}

describe("bảng hẹn đẩy", () => {
  it("lệnh gấp có chip Gấp", () => {
    ve([dong({ is_rush: true })]);
    expect(screen.getByText("Gấp")).toHaveClass("xh-chip--gap");
  });

  it("vật tư mức vàng chưa có ngày về hiện chip vàng Chưa đủ", () => {
    const { container } = ve([dong({ vat_tu: { muc: "vang", chu: "Thiếu 1 món" } })]);
    const chip = container.querySelector("tbody .xh-chip");
    expect(chip).toHaveClass("xh-chip--vang");
    expect(chip).toHaveTextContent("Chưa đủ");
    expect(chipVatTu(dong({ vat_tu: { muc: "do", chu: "" } }))?.chu).toBe("Thiếu");
  });

  it("còn 1 ngày tới hạn giao thì hình thoi đỏ", () => {
    const { container } = ve([dong({ hen_luc: "2026-11-08T14:00:00", han_giao_khach: "2026-11-09" })]);
    expect(laSatHan("2026-11-09", "2026-11-08")).toBe(true);
    expect(laSatHan("2026-11-12", "2026-11-08")).toBe(false);
    expect(container.querySelector(".xh-thoi")).toHaveClass("thoi--sat");
    expect(container.querySelector(".xh-vach")).toHaveClass("xh-vach--sat");
  });

  it("đầu ngày ghi số lệnh hẹn đẩy ngày đó", () => {
    ve([dong()], { "2026-11-10": 12 });
    expect(screen.getByText("12 lệnh")).toBeInTheDocument();
  });
});
