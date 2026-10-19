import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type SxLichSuViec } from "../../api/client";
import { ThsxTabLichSu } from "./ThsxTabLichSu";

vi.mock("../../auth/useAuth", () => ({ useAuth: () => ({ token: "t" }) }));

const BA_DONG: SxLichSuViec = {
  items: [
    { luc: "2026-10-09T11:58:00", nhom: "san_luong", cau: "Ghi sản lượng 80 tờ in tốt", ct: [], ly_do: null, mau: "g", nguoi: "Đào Văn Hoan" },
    { luc: "2026-10-09T10:01:00", nhom: "nguoi_khuon", cau: "Rút thợ Phạm Văn Long", ct: [], nguoi: "Trần Tổ Trưởng",
      ly_do: "Chuyển sang máy Kyodo cho kịp lệnh 0003", mau: "" },
    { luc: "2026-10-09T09:57:00", nhom: "nguoi_khuon", cau: "Tổ nhận lệnh", ct: ["Gói phát hành 1"], ly_do: null, mau: "" },
  ],
  dem: { chay_may: 0, nguoi_khuon: 2, san_luong: 1, ban_giao: 0, vat_tu: 0, kcs: 0, khac: 0 },
};

describe("Tab Lịch sử", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("đếm số việc, lọc theo chip nhóm, lý do thành thẻ, người lên dòng phụ", async () => {
    vi.spyOn(api.sanXuat, "lichSuViec").mockResolvedValue(BA_DONG);
    render(<ThsxTabLichSu congViecId={5} />);
    expect(await screen.findByText("3 việc")).toBeInTheDocument();
    expect(screen.getByText("Lý do: Chuyển sang máy Kyodo cho kịp lệnh 0003")).toBeInTheDocument();
    expect(screen.getByText("Trần Tổ Trưởng lúc 09/10/2026 10:01")).toBeInTheDocument();
    expect(screen.getByText("Gói phát hành 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bàn giao" }).className).toContain("is-rong");

    fireEvent.click(screen.getByRole("button", { name: "Sản lượng" }));
    expect(screen.getByText("Ghi sản lượng 80 tờ in tốt")).toBeInTheDocument();
    expect(screen.queryByText("Tổ nhận lệnh")).toBeNull();
    expect(screen.getByRole("button", { name: "Sản lượng" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Tất cả" }));
    expect(screen.getByText("Tổ nhận lệnh")).toBeInTheDocument();
  });

  it("chưa có gì thì ra câu rỗng", async () => {
    vi.spyOn(api.sanXuat, "lichSuViec").mockResolvedValue({ items: [], dem: {} });
    render(<ThsxTabLichSu congViecId={5} />);
    expect(await screen.findByText("Chưa có việc gì được ghi lại.")).toBeInTheDocument();
  });

  it("lỗi nạp thì có nút Thử lại", async () => {
    const goi = vi.spyOn(api.sanXuat, "lichSuViec").mockRejectedValueOnce(new Error("x")).mockResolvedValue(BA_DONG);
    render(<ThsxTabLichSu congViecId={5} />);
    fireEvent.click(await screen.findByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("3 việc")).toBeInTheDocument();
    expect(goi).toHaveBeenCalledTimes(2);
  });

  it("tick đổi thì nạp lại", async () => {
    const goi = vi.spyOn(api.sanXuat, "lichSuViec").mockResolvedValue(BA_DONG);
    const { rerender } = render(<ThsxTabLichSu congViecId={5} tick={1} />);
    await screen.findByText("3 việc");
    rerender(<ThsxTabLichSu congViecId={5} tick={2} />);
    await vi.waitFor(() => expect(goi).toHaveBeenCalledTimes(2));
  });
});
