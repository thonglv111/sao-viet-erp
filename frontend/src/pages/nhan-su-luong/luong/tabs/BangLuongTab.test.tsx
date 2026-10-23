import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BangLuongTab } from "./BangLuongTab";
import { api, type PayrollLine, type PayrollPeriod } from "../../../../api/client";

vi.mock("../../../../api/client", () => ({
  api: {
    luong: {
      getParams: vi.fn(),
      table: vi.fn(),
      generate: vi.fn(),
      xlsxBlobUrl: vi.fn(),
    },
  },
}));

const mockPeriod: PayrollPeriod = {
  id: 1,
  year: 2026,
  month: 10,
  status: "draft",
  standard_cong: 26,
  locked_at: null,
  paid_at: null,
  paid_by: null,
};

const mockLine: PayrollLine = {
  id: 101,
  employee_id: 1,
  employee_code: "NV001",
  employee_name: "Nguyễn Văn Test",
  department_name: "In Offset",
  bank_account: null,
  bank_name: null,
  is_probation: false,
  actual_cong: 26,
  standard_cong: 26,
  monthly_salary: 10_000_000,
  luong_cong: 10_000_000,
  chuyen_can: 300_000,
  allowance: 200_000,
  khoan: 0,
  ot_minutes: 0,
  ot_pay: 0,
  night_days: 0,
  night_pay: 0,
  vi_pham: 50_000,
  other_bonus: 0,
  gross: 10_500_000,
  insurance_base: 5_000_000,
  bhxh: 525_000,
  cong_doan: 50_000,
  pit: 100_000,
  pit_manual: false,
  pit_taxable: 1_000_000,
  thu_nhap_mien_thue: 0,
  advance_total: 1_000_000,
  luong_dot_1_total: 0,
  net_pay: 8_775_000,
  note: null,
} as unknown as PayrollLine;

describe("BangLuongTab — Cột Giảm trừ & Tạm ứng tách riêng BHXH, Công đoàn, Thuế TNCN", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.luong.getParams).mockResolvedValue({} as never);
  });

  it("⭐ Super Header nhóm Giảm trừ & Tạm ứng có colSpan=5 và Sub Header tách 3 cột riêng", async () => {
    vi.mocked(api.luong.table).mockResolvedValue({
      period: mockPeriod,
      lines: [mockLine],
      phong_loc: [],
    });

    render(
      <BangLuongTab
        token="test-token"
        canManage={true}
        canLockPeriod={true}
        canMarkPaid={true}
        canExportPayroll={true}
      />
    );

    // Kiểm tra Super Header có colSpan = 5
    const superHeader = await screen.findByText(/Giảm trừ & Tạm ứng/i);
    expect(superHeader).toHaveAttribute("colSpan", "5");

    // Kiểm tra 3 cột Sub Header riêng biệt
    expect(screen.getByRole("columnheader", { name: "Bảo hiểm" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Công đoàn" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Thuế TNCN" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Phạt / giảm trừ" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Đợt 1 / Tạm ứng" })).toBeInTheDocument();
  });

  it("⭐ tbody hiển thị 3 ô riêng biệt cho BHXH, Công đoàn, Thuế TNCN kèm tooltip chuẩn", async () => {
    vi.mocked(api.luong.table).mockResolvedValue({
      period: mockPeriod,
      lines: [mockLine],
      phong_loc: [],
    });

    const { container } = render(
      <BangLuongTab
        token="test-token"
        canManage={true}
        canLockPeriod={true}
        canMarkPaid={true}
        canExportPayroll={true}
      />
    );

    // Chờ render xong dòng lương
    await screen.findByText("Nguyễn Văn Test");

    const tbody = container.querySelector("tbody")!;
    // Ô Bảo hiểm (−525.000)
    const bhxhCell = within(tbody).getByTitle(/Mức đóng BHXH/);
    expect(bhxhCell).toHaveClass("lg-minus");
    expect(bhxhCell).toHaveTextContent("−525.000");

    // Ô Công đoàn (−50.000)
    const congDoanCell = within(tbody).getByTitle("Đoàn phí công đoàn");
    expect(congDoanCell).toHaveClass("lg-minus");
    expect(congDoanCell).toHaveTextContent("−50.000");

    // Ô Thuế TNCN (−100.000)
    const pitCell = within(tbody).getByTitle("Thuế TNCN");
    expect(pitCell).toHaveClass("lg-minus");
    expect(pitCell).toHaveTextContent("−100.000");
  });

  it("⭐ tfoot hiển thị tổng riêng cho BHXH, Công đoàn, Thuế TNCN", async () => {
    vi.mocked(api.luong.table).mockResolvedValue({
      period: mockPeriod,
      lines: [mockLine],
      phong_loc: [],
    });

    const { container } = render(
      <BangLuongTab
        token="test-token"
        canManage={true}
        canLockPeriod={true}
        canMarkPaid={true}
        canExportPayroll={true}
      />
    );

    await screen.findByText("Nguyễn Văn Test");

    const tfoot = container.querySelector("tfoot");
    expect(tfoot).toBeInTheDocument();

    // Footer phải chứa đúng các giá trị tổng
    expect(tfoot?.textContent).toContain("−525.000");
    expect(tfoot?.textContent).toContain("−50.000");
    expect(tfoot?.textContent).toContain("−100.000");
  });

  it("⭐ EmptyRow có colSpan=22 trong detailed mode khi kỳ chưa có dòng nào", async () => {
    vi.mocked(api.luong.table).mockResolvedValue({
      period: mockPeriod,
      lines: [],
      phong_loc: [],
    });

    const { container } = render(
      <BangLuongTab
        token="test-token"
        canManage={true}
        canLockPeriod={true}
        canMarkPaid={true}
        canExportPayroll={true}
      />
    );

    await screen.findByText("Chưa có dòng lương nào trong kỳ");
    const emptyCell = container.querySelector("tbody tr td");
    expect(emptyCell).toHaveAttribute("colSpan", "22");
  });

  it("⭐ Quy tắc tính formula bar cập nhật tooltip đúng mô tả", async () => {
    vi.mocked(api.luong.table).mockResolvedValue({
      period: mockPeriod,
      lines: [mockLine],
      phong_loc: [],
    });

    render(
      <BangLuongTab
        token="test-token"
        canManage={true}
        canLockPeriod={true}
        canMarkPaid={true}
        canExportPayroll={true}
      />
    );

    await screen.findByText("Nguyễn Văn Test");

    const deductFormulaItem = screen.getByText("Các khoản giảm trừ (−)");
    expect(deductFormulaItem).toHaveAttribute(
      "title",
      "Bao gồm: Phạt / giảm trừ + BHXH + Đoàn phí công đoàn + Thuế TNCN + Lương đợt 1 và Tạm ứng"
    );
  });
});

describe("BangLuongTab — ô Hoa hồng của người có lần thu nhưng tổng âm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.luong.getParams).mockResolvedValue({} as never);
  });

  const moTab = () =>
    render(
      <BangLuongTab token="t" canManage canLockPeriod canMarkPaid canExportPayroll />,
    );

  it("tổng kẹp về 0 nhưng có lần thu ⇒ vẫn bấm được để soi", async () => {
    vi.mocked(api.luong.table).mockResolvedValue({
      period: mockPeriod,
      lines: [{ ...mockLine, hoa_hong: 0, co_hoa_hong: true } as PayrollLine],
      phong_loc: [],
    });
    moTab();
    await screen.findByText("Nguyễn Văn Test");
    const nut = screen.getByRole("button", { name: "0" });
    expect(nut.title).toMatch(/từng lần thu/);
  });

  it("không có lần thu nào ⇒ ô vẫn là gạch, không bấm", async () => {
    vi.mocked(api.luong.table).mockResolvedValue({
      period: mockPeriod,
      lines: [{ ...mockLine, hoa_hong: 0, co_hoa_hong: false } as PayrollLine],
      phong_loc: [],
    });
    moTab();
    await screen.findByText("Nguyễn Văn Test");
    expect(screen.queryByTitle(/Bấm xem từng lần thu/)).toBeNull();
  });
});
