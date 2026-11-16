/** Lập phiếu chi thuê gia công từ NHIỀU phiếu nhận cùng nhà (spec 2026-11-13 §4.6): cùng giao diện với
 *  phiếu chi rời, tiền điền sẵn Σ tạm tính, sửa lệch thì bắt lý do. */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TgcChoTraTien } from "../../../../api/thueGiaCong";

const createVoucher = vi.fn();
vi.mock("../../../../auth/useAuth", () => ({ useAuth: () => ({ token: "token-test" }) }));
vi.mock("../../../../api/client", async (goc) => ({
  ...(await goc<typeof import("../../../../api/client")>()),
  api: { mucThuChi: { list: vi.fn().mockResolvedValue({ items: [{ id: -2, ma: "HT-02", ten: "Thuê gia công ngoài", loai: "chi", co_dinh: true, nguon: "gia_cong_ngoai", ghi_chu: "Phiếu chi gia công ngoài", active: true }] }) }, accounting: { companyAccounts: vi.fn().mockResolvedValue([]), createVoucher: (...a: unknown[]) => createVoucher(...a) } },
}));

import { LapPhieuChiGiaCongModal } from "./LapPhieuChiGiaCongModal";

const pn = (id: number, ma: string, tam_tinh: number): TgcChoTraTien => ({
  phieu_nhan_id: id, ma, nhan_luc: "2026-11-13T08:00:00Z", don_id: 1, ma_don: "GC-0001",
  nha_cung_cap_id: 3, nha_cung_cap_ten: "Cán màng Thành Công", nguoi_nhan_ten: null,
  lenh: [{ lsx_id: 2, lsx_ma: "LSX26-0002", khach_hang: "", don_hang_ma: "", mat_hang: "", han_giao: null }],
  dong: [{ ten_viec: "Cán màng", dat: 1000, hong: 0, hut: null, don_vi: null, don_gia: tam_tinh / 1000, tam_tinh }],
  tam_tinh,
});
const ROWS = [pn(15, "GN-0015", 600000), pn(16, "GN-0016", 390000)];

describe("Lập phiếu chi thuê gia công", () => {
  it("phiếu gia công thuộc mục cố định: không có ô Mục, tờ xem trước ghi tên mục", async () => {
    render(<LapPhieuChiGiaCongModal rows={ROWS} onClose={() => {}} onDone={() => {}} />);
    expect(screen.queryByLabelText(/Mục chi/)).toBeNull();
    await waitFor(() =>
      expect(screen.getByLabelText("Xem trước phiếu chi")).toHaveTextContent("Mục chi:Thuê gia công ngoài"));
  });

  it("điền sẵn người nhận, lý do liệt kê phiếu nhận và tiền bằng tổng tạm tính", () => {
    render(<LapPhieuChiGiaCongModal rows={ROWS} onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Lập phiếu chi" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Người nhận tiền/)).toHaveValue("Cán màng Thành Công");
    expect(screen.getByLabelText(/Lý do chi/)).toHaveValue("Trả tiền thuê gia công GN-0015, GN-0016");
    expect(screen.getByLabelText("Phiếu nhận trả tiền")).toHaveTextContent("GN-0016");
    expect(screen.queryByLabelText(/Lý do lệch tạm tính/)).toBeNull();
  });

  it("sửa số tiền lệch tạm tính thì bắt ghi lý do rồi mới gửi", async () => {
    createVoucher.mockReset();
    createVoucher.mockResolvedValue({ id: 9, code: "PC-0009" });
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<LapPhieuChiGiaCongModal rows={ROWS} onClose={() => {}} onDone={onDone} />);
    const tienO = screen.getByLabelText(/Số tiền/);
    await user.clear(tienO);
    await user.type(tienO, "980000");
    const lyDo = await screen.findByLabelText(/Lý do lệch tạm tính/);
    await user.click(screen.getByRole("button", { name: /Lập phiếu chi|Lưu/ }));
    expect(createVoucher).not.toHaveBeenCalled();
    expect(await screen.findByText(/ghi lý do/)).toBeInTheDocument();
    await user.type(lyDo, "Trừ hàng hỏng");
    await user.click(screen.getByRole("button", { name: /Lập phiếu chi|Lưu/ }));
    await waitFor(() => expect(createVoucher).toHaveBeenCalled());
    expect(createVoucher.mock.calls[0][1]).toMatchObject({
      source_type: "gia_cong_ngoai", tgc_phieu_nhan_ids: [15, 16], amount: 980000, ly_do_lech: "Trừ hàng hỏng",
    });
  });
});
