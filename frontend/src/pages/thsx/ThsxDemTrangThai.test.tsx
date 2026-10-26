import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThsxDemTrangThai } from "./ThsxDemTrangThai";

const DEM = { tong: 7, running: 2, paused: 0, released: 3, completed: 2 };

describe("ThsxDemTrangThai", () => {
  it("chưa có số (đang tải / máy chủ lỗi) thì in — chứ không in Tất cả 0", () => {
    render(<ThsxDemTrangThai dem={null} chon={[]} onChon={() => {}} />);
    expect(screen.getByRole("button", { name: "Tất cả —" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đang chạy —" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tất cả 0" })).toBeNull();
  });

  it("chưa lọc thì Tất cả đang chọn, mỗi chip kèm số", () => {
    render(<ThsxDemTrangThai dem={DEM} chon={[]} onChon={() => {}} />);
    expect(screen.getByRole("button", { name: "Tất cả 7" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Đang chạy 2" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Chờ làm 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tạm dừng 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hoàn thành 2" })).toBeInTheDocument();
  });

  it("bấm chip thì thêm trạng thái, bấm lại thì bỏ, Tất cả xoá lọc", () => {
    const onChon = vi.fn();
    const { rerender } = render(<ThsxDemTrangThai dem={DEM} chon={[]} onChon={onChon} />);
    fireEvent.click(screen.getByRole("button", { name: "Đang chạy 2" }));
    expect(onChon).toHaveBeenLastCalledWith(["running"]);

    rerender(<ThsxDemTrangThai dem={DEM} chon={["running"]} onChon={onChon} />);
    expect(screen.getByRole("button", { name: "Đang chạy 2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Tất cả 7" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Chờ làm 3" }));
    expect(onChon).toHaveBeenLastCalledWith(["running", "released"]);
    fireEvent.click(screen.getByRole("button", { name: "Đang chạy 2" }));
    expect(onChon).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole("button", { name: "Tất cả 7" }));
    expect(onChon).toHaveBeenLastCalledWith([]);
  });

  it("chip việc chờ tách theo loại: Hàng chờ nhận hiện khi có, bấm thì lọc đúng loại đó; hết việc và không lọc thì rụng", () => {
    const onChon = vi.fn();
    const so = { ban_giao: 2, kcs: 1 };
    const { rerender } = render(<ThsxDemTrangThai dem={DEM} chon={[]} onChon={() => {}}
      cho={{ so, chon: [], onChon }} />);
    const nut = screen.getByRole("button", { name: "Hàng chờ nhận 2" });
    expect(nut).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Lỗi KCS chờ xem 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Hỗ trợ chờ xác nhận/ })).toBeNull();
    fireEvent.click(nut);
    expect(onChon).toHaveBeenLastCalledWith(["ban_giao"]);

    rerender(<ThsxDemTrangThai dem={DEM} chon={[]} onChon={() => {}}
      cho={{ so: { ban_giao: 0, kcs: 0 }, chon: ["ban_giao"], onChon }} />);
    fireEvent.click(screen.getByRole("button", { name: "Hàng chờ nhận 0" }));
    expect(onChon).toHaveBeenLastCalledWith([]);

    rerender(<ThsxDemTrangThai dem={DEM} chon={[]} onChon={() => {}}
      cho={{ so: { ban_giao: 0, kcs: 0 }, chon: [], onChon }} />);
    expect(screen.queryByRole("button", { name: /Hàng chờ nhận/ })).toBeNull();
  });
});
