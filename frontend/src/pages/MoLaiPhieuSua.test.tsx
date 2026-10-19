import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MoLaiPhieuSua } from "./MoLaiPhieuSua";

// Lỗi #51 bấm thử 18/10/2026: phiếu "Đã sửa xong" không mở lại được trên giao diện.
vi.mock("../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));
const trangThai = vi.fn();
vi.mock("../api/kyThuatMay", async (goc) => ({
  ...(await goc<typeof import("../api/kyThuatMay")>()),
  kyThuatMay: { trangThaiSuaChua: (...a: unknown[]) => trangThai(...a) },
}));

describe("MoLaiPhieuSua", () => {
  beforeEach(() => trangThai.mockReset());

  it("bấm Mở lại hỏi lý do, chưa gõ thì không gửi được", async () => {
    render(<MoLaiPhieuSua phieuId={17} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Mở lại" }));
    const nut = await screen.findByRole("button", { name: "Mở lại phiếu" });
    expect((nut as HTMLButtonElement).disabled).toBe(true);
  });

  it("gõ lý do rồi xác nhận thì gọi đổi trạng thái về chờ sửa kèm lý do", async () => {
    const onDone = vi.fn();
    trangThai.mockResolvedValue({ id: 17, trang_thai: "cho_sua" });
    render(<MoLaiPhieuSua phieuId={17} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Mở lại" }));
    fireEvent.change(await screen.findByLabelText("Lý do mở lại"), { target: { value: "Máy kẹt lại sau 2 giờ" } });
    fireEvent.click(screen.getByRole("button", { name: "Mở lại phiếu" }));
    await waitFor(() => expect(trangThai).toHaveBeenCalledWith("token-test", 17, "cho_sua", "Máy kẹt lại sau 2 giờ"));
    expect(onDone).toHaveBeenCalledWith({ id: 17, trang_thai: "cho_sua" });
  });
});
