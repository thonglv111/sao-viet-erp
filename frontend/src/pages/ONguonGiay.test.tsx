// Ô "Nguồn giấy" màn lệnh (spec 2026-10-24-chuan-bi-giay §7): người kế hoạch đổi nguồn, máy dựng lại khâu
// chuẩn bị giấy. Cuộn phải kèm rộng cuộn.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ONguonGiay } from "./ONguonGiay";

const chon = (nhan: RegExp) => {
  fireEvent.click(screen.getByRole("button", { name: "Nguồn giấy" }));
  fireEvent.mouseDown(screen.getByRole("option", { name: nhan }));
};

describe("ONguonGiay", () => {
  it("đổi nguồn gọi PUT nguon-giay rồi nạp lại routing", async () => {
    const onDoi = vi.fn().mockResolvedValue(undefined);
    render(<ONguonGiay nguon="cuon" khoa={null} onDoi={onDoi} />);
    expect(screen.getByRole("button", { name: "Nguồn giấy" }).textContent).toMatch(/Cuộn/);
    chon(/Tờ khổ nguyên/);
    expect(onDoi).toHaveBeenCalledWith({ nguon: "to_nguyen", rong_cuon: null });
  });

  it("chọn Cuộn thì hỏi rộng cuộn, chưa nhập chưa gửi", () => {
    const onDoi = vi.fn().mockResolvedValue(undefined);
    render(<ONguonGiay nguon="mua" khoa={null} onDoi={onDoi} />);
    chon(/^Cuộn/);
    expect(onDoi).not.toHaveBeenCalled();
    const ap = screen.getByRole("button", { name: "Áp dụng" }) as HTMLButtonElement;
    expect(ap.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Rộng cuộn (mm)"), { target: { value: "870" } });
    fireEvent.click(ap);
    expect(onDoi).toHaveBeenCalledWith({ nguon: "cuon", rong_cuon: 870 });
  });

  it("lệnh đang giữ chỗ thì khoá, lý do nằm ở chú thích", () => {
    render(<ONguonGiay nguon="to_in" khoa="Lệnh đang giữ chỗ vật tư" onDoi={vi.fn()} />);
    const o = screen.getByRole("button", { name: "Nguồn giấy" }) as HTMLButtonElement;
    expect(o.disabled).toBe(true);
    expect(o.closest("[title]")?.getAttribute("title")).toBe("Lệnh đang giữ chỗ vật tư");
  });
});
