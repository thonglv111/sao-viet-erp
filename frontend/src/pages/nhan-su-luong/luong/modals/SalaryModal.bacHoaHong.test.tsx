// Mở hồ sơ lương (bấm thử 23/10/2026): lúc lịch sử lương chưa về, ô biểu hoa hồng chớp "Không hưởng hoa
// hồng" rồi mới hiện biểu thật — người xem tưởng người này mất hoa hồng.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { salaries } = vi.hoisted(() => ({ salaries: vi.fn() }));
vi.mock("../../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../../api/client")>()),
  api: {
    luong: {
      salaryPreview: () => Promise.resolve(null),
      salaries: (...a: unknown[]) => salaries(...a),
      getParams: () => new Promise(() => {}),
      components: {
        employeeValues: () => Promise.resolve({ items: [] }),
        list: () => Promise.resolve({ items: [] }),
      },
    },
  },
}));

import { SalaryModal } from "./SalaryModal";
import type { EmployeeRow } from "../../../../api/client";

const NV = { id: 5, full_name: "Kim Dung", code: "NV05" } as unknown as EmployeeRow;

describe("SalaryModal — biểu hoa hồng", () => {
  it("chưa tải xong lịch sử lương thì không báo 'Không hưởng hoa hồng'", async () => {
    salaries.mockReturnValue(new Promise(() => {}));
    render(<SalaryModal token="t" emp={NV} onClose={() => {}} />);
    expect(await screen.findByText("Đang tải biểu hoa hồng…")).toBeInTheDocument();
    expect(screen.queryByText(/Không hưởng hoa hồng/)).toBeNull();
  });

  it("tải xong mà chưa khai biểu thì mới báo không hưởng", async () => {
    salaries.mockResolvedValue({ items: [] });
    render(<SalaryModal token="t" emp={NV} onClose={() => {}} />);
    expect(await screen.findByText(/Không hưởng hoa hồng/)).toBeInTheDocument();
  });
});
