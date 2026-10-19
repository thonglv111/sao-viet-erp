// Nút "Đặt điểm chấm công tại đây" đi theo ô Điểm chấm công (lỗi #37 bấm thử 18/10/2026).
//
// Nút gọi API tạo điểm chấm công — máy chủ đòi `cham_cong.manage_locations`. Màn lại gác nút bằng
// ô Thao tác chung (`update`): người có Thao tác mà không có ô Điểm chấm công thấy nút, bấm là 403.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AttendanceStatus } from "../../../api/client";

let quyen: Record<string, boolean> = {};
let phamVi: string | null = "all";

vi.mock("../../../auth/useAuth", () => ({ useAuth: () => ({ token: "t" }) }));
vi.mock("../../../auth/permissions", () => ({
  useCan: () => (m: string, a: string) => !!quyen[`${m}.${a}`],
  useSelfService: () => true,
  useScopeOf: () => () => phamVi,
}));

const trangThai: AttendanceStatus = {
  has_employee: true,
  employee_name: "Nhân viên A",
  next_action: "in",
  can_check: true,
  check_block_reason: null,
  last_check: null,
  locations_configured: false,
  shift: null,
  today: null,
};

vi.mock("../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../api/client")>()),
  api: {
    attendance: {
      myStatus: () => Promise.resolve(trangThai),
      myLogs: () => Promise.resolve({ items: [] }),
    },
  },
}));

import { ChamCongPage } from "./ChamCongPage";

describe("Chấm công của tôi — nút đặt điểm (#37)", () => {
  beforeEach(() => {
    quyen = { "cham_cong.read": true, "cham_cong.create": true };
    phamVi = "all";
  });

  it("có ô Thao tác mà KHÔNG có ô Điểm chấm công ⇒ không bày nút", async () => {
    quyen["cham_cong.update"] = true;
    render(<ChamCongPage />);
    await screen.findByText(/Chưa cấu hình điểm chấm công nào/);
    expect(screen.queryByRole("button", { name: /Đặt điểm chấm công tại đây/ })).toBeNull();
  });

  it("có ô Điểm chấm công ⇒ nút hiện khi chưa khai điểm nào", async () => {
    quyen["cham_cong.manage_locations"] = true;
    render(<ChamCongPage />);
    expect(await screen.findByRole("button", { name: /Đặt điểm chấm công tại đây/ })).toBeTruthy();
  });

  // Máy chủ (`_ghi_cau_hinh_chung`) đòi đủ ba: ô Thêm, ô Điểm chấm công và phạm vi Toàn công ty.
  it("có ô Điểm chấm công mà phạm vi không phải toàn công ty ⇒ không bày nút", async () => {
    quyen["cham_cong.manage_locations"] = true;
    phamVi = "department";
    render(<ChamCongPage />);
    await screen.findByText(/Chưa cấu hình điểm chấm công nào/);
    expect(screen.queryByRole("button", { name: /Đặt điểm chấm công tại đây/ })).toBeNull();
  });

  it("có ô Điểm chấm công mà không có ô Thêm ⇒ không bày nút", async () => {
    quyen["cham_cong.manage_locations"] = true;
    delete quyen["cham_cong.create"];
    render(<ChamCongPage />);
    await screen.findByText(/Chưa cấu hình điểm chấm công nào/);
    expect(screen.queryByRole("button", { name: /Đặt điểm chấm công tại đây/ })).toBeNull();
  });
});
