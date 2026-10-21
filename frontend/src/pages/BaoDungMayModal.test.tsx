// Hộp Báo dừng máy ở bàn tổ (Đợt 2 công thức khoán, 21/10/2026).
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SxDungMayListOut } from "../api/client";
import { BaoDungMayModal, type DungMayExec } from "./BaoDungMayModal";

const DS: SxDungMayListOut = {
  ds: [{
    id: 4, department_id: 7, ngay: "2026-10-15", ly_do: "may_hu", ly_do_ten: "Máy hư",
    sua_chua_id: 7, sua_chua_ma: "SC-0014", ghi_chu: null,
    nguoi: [{ employee_id: 1, ho_ten: "An" }],
  }],
  nguoi: [{ employee_id: 1, ho_ten: "An" }, { employee_id: 2, ho_ten: "Bình" }],
  phieu_sua: [{ id: 7, ma: "SC-0014", may_ten: "Máy 4 màu", bo_phan_hong: null }],
};

function mo() {
  const exec: DungMayExec = {
    ds: vi.fn().mockResolvedValue(DS),
    bao: vi.fn().mockResolvedValue(DS.ds[0]),
    xoa: vi.fn().mockResolvedValue(undefined),
    sua: vi.fn().mockResolvedValue(DS.ds[0]),
  };
  const onBao = vi.fn();
  render(<BaoDungMayModal tenTo="Tổ in 4 màu" homNay="2026-10-21" exec={exec} onDong={vi.fn()} onBao={onBao} />);
  return { exec, onBao };
}

describe("Báo dừng máy", () => {
  it("Hết hàng, bỏ tick một người, Lưu ⇒ gửi đúng người còn lại", async () => {
    const user = userEvent.setup();
    const { exec, onBao } = mo();
    await screen.findByLabelText("Bình");
    expect(exec.ds).toHaveBeenCalledWith(2026, 10);
    await user.click(screen.getByRole("button", { name: "Hết hàng" }));
    await user.click(screen.getByLabelText("Bình"));
    await user.click(screen.getByRole("button", { name: "Lưu" }));
    expect(exec.bao).toHaveBeenCalledTimes(1);
    expect(exec.bao).toHaveBeenCalledWith({
      ngay: "2026-10-21", ly_do: "het_hang", sua_chua_id: null, ghi_chu: null, nguoi_ids: [1],
    });
    expect(onBao).toHaveBeenCalledWith("Đã báo dừng máy ngày 21/10.");
    expect(exec.ds).toHaveBeenCalledTimes(2);
  });

  it("chỉ Máy hư mới có ô Phiếu sửa máy", async () => {
    const user = userEvent.setup();
    mo();
    await screen.findByLabelText("Bình");
    expect(screen.queryByLabelText("Phiếu sửa máy")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Máy hư" }));
    await user.selectOptions(screen.getByLabelText("Phiếu sửa máy"), "7");
    await user.click(screen.getByRole("button", { name: "Hết hàng" }));
    expect(screen.queryByLabelText("Phiếu sửa máy")).toBeNull();
  });

  it("chưa chọn lý do thì chưa Lưu được", async () => {
    mo();
    await screen.findByLabelText("Bình");
    expect(screen.getByRole("button", { name: "Lưu" })).toBeDisabled();
  });

  it("ngày đã báo trong tháng có nút xoá; máy chủ trả lỗi thì hiện câu lỗi", async () => {
    const user = userEvent.setup();
    const { exec } = mo();
    expect(await screen.findByText("15/10")).toBeInTheDocument();
    expect(screen.getByText("SC-0014")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Xoá ngày 15/10" }));
    expect(exec.xoa).toHaveBeenCalledWith(4);

    (exec.bao as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Tổ đã báo dừng máy ngày 21/10."));
    await user.click(screen.getByRole("button", { name: "Máy hư" }));
    await user.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByText("Tổ đã báo dừng máy ngày 21/10.")).toBeInTheDocument();
  });

  it("Sửa ngày đã báo: mở sẵn giá trị cũ, đổi người hưởng, Lưu gọi sửa không đổi ngày", async () => {
    const user = userEvent.setup();
    const { exec, onBao } = mo();
    await user.click(await screen.findByRole("button", { name: "Sửa ngày 15/10" }));
    expect(screen.getByRole("button", { name: "Máy hư" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Phiếu sửa máy")).toHaveValue("7");
    expect(screen.getByLabelText("An")).toBeChecked();
    expect(screen.getByLabelText("Bình")).not.toBeChecked();
    expect(screen.queryByLabelText("Ngày dừng máy")).toBeNull();
    await user.click(screen.getByLabelText("Bình"));
    await user.click(screen.getByRole("button", { name: "Lưu" }));
    expect(exec.sua).toHaveBeenCalledWith(4, {
      ly_do: "may_hu", sua_chua_id: 7, ghi_chu: null, nguoi_ids: [1, 2],
    });
    expect(exec.bao).not.toHaveBeenCalled();
    expect(onBao).toHaveBeenCalledWith("Đã sửa ngày dừng máy 15/10.");
  });
});
