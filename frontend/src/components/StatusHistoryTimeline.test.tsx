import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { StatusHistoryRow } from "../api/client";
import { StatusHistoryTimeline } from "./StatusHistoryTimeline";

const dong = (o: Partial<StatusHistoryRow>): StatusHistoryRow => ({
  id: 1, from_status: "open", to_status: "open", source: "nguoi", changed_by_name: "Admin",
  reason: null, created_at: "2026-10-18T03:00:00Z", ...o,
});

describe("StatusHistoryTimeline (#19)", () => {
  it("bỏ một món hiện nhãn Huỷ một phần kèm lý do, không in mã thô", () => {
    render(<StatusHistoryTimeline items={[dong({ to_status: "huy_mot_phan", reason: "Keo — khách đổi" })]} />);
    expect(screen.getByText(/Huỷ một phần/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("huy_mot_phan");
    expect(document.body.textContent).toContain("Keo — khách đổi");
  });

  it("câu trống không đổ cho phiếu lập trước 07/08/2026", () => {
    render(<StatusHistoryTimeline items={[]} />);
    expect(document.body.textContent).not.toContain("07/08/2026");
  });
});
