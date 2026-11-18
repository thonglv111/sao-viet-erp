import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SxBanGiao, SxBatch, SxHoTroUngVien, SxTranGhi, SxWorkItemChiTiet } from "../api/client";
import { BanGiaoForm, SuaMeForm, SuaSoMeForm, type ThsxExec } from "./ThsxExecPanels";

const g = {
  id: 10, so_luong: 120, don_vi: "to_in", version: 3, doi_tac_ten: "Bài in 3 màu 4 màu", cung_to: false,
  dich_cong_doan: "Bài in 3 màu 4 màu", dich_to: "Nhóm thợ in máy 4 màu", batch_ids: [1],
} as unknown as SxBanGiao;

const me = [
  { id: 1, bat_dau: "2026-10-09T11:20:00", ket_thuc: "2026-10-09T11:38:00", tot: 120, da_ban_giao: true },
  { id: 2, bat_dau: "2026-10-09T11:41:00", ket_thuc: "2026-10-09T11:58:00", tot: 80, da_ban_giao: false },
] as unknown as SxBatch[];

describe("Hộp Sửa số mẻ", () => {
  const b = {
    id: 1, bat_dau: "2026-10-09T11:20:00", ket_thuc: "2026-10-09T11:38:00", tot: 120, don_vi: "to_in",
    version: 2, da_ban_giao: true,
  } as unknown as SxBatch;
  const tran = { con_ghi_duoc: 30 } as unknown as SxTranGhi;
  const khoa: SxHoTroUngVien = {
    id: 9, code: "NV9", full_name: "Trần Văn Khoa", to_id: 1, to_ten: "Cắt 1", ly_do_nghi: null, nghi_phep: [],
    dang_chay: null, viec_cho: [],
  };

  function mo(banGiao: SxBanGiao | null = g) {
    const suaSoMe = vi.fn().mockResolvedValue(true);
    render(<SuaSoMeForm b={b} tranGhi={tran} banGiao={banGiao} busy={false} onXong={vi.fn()}
      exec={{ suaSoMe } as unknown as ThsxExec} />);
    return { hop: screen.getByRole("dialog", { name: "Sửa số sản lượng" }), suaSoMe };
  }

  it("bấm −1 hai lần ra 118 và ghi bớt 2, Về số cũ trả lại 120; chưa đổi thì Lưu khoá", () => {
    const { hop } = mo();
    const o = within(hop).getByLabelText("Số lượng làm được") as HTMLInputElement;
    expect(within(hop).getByRole("button", { name: "Lưu" })).toBeDisabled();
    fireEvent.click(within(hop).getByRole("button", { name: "−1" }));
    fireEvent.click(within(hop).getByRole("button", { name: "−1" }));
    expect(o.value).toBe("118");
    expect(within(hop).getByText("bớt 2")).toBeInTheDocument();
    fireEvent.click(within(hop).getByRole("button", { name: "Về số cũ 120" }));
    expect(o.value).toBe("120");
  });

  it("vượt trần thì báo tối đa và khoá; mẻ đã giao không về 0", () => {
    const { hop } = mo();
    const o = within(hop).getByLabelText("Số lượng làm được");
    fireEvent.change(o, { target: { value: "160" } });
    expect(within(hop).getByText(/^Vượt số còn ghi được, lần này sửa tối đa 150/)).toBeInTheDocument();
    expect(within(hop).getByRole("button", { name: "Lưu" })).toBeDisabled();
    fireEvent.change(o, { target: { value: "0" } });
    expect(within(hop).getByText("Lần này đã giao, không sửa về 0 được.")).toBeInTheDocument();
  });

  it("mẻ đã giao: nói lần giao đổi thành bao nhiêu, bên nhận xác nhận lại; Ctrl + Enter lưu kèm lý do", () => {
    const { hop, suaSoMe } = mo({ ...g, trang_thai: "confirmed" } as SxBanGiao);
    fireEvent.click(within(hop).getByRole("button", { name: "Gõ nhầm" }));
    fireEvent.click(within(hop).getByRole("button", { name: "+10" }));
    expect(hop.textContent).toMatch(/Lần này đã giao sang Bài in 3 màu 4 màu\. Lần giao 120 đổi thành 130 .*Nhóm thợ in máy 4 màu sẽ phải xác nhận lại\./);
    fireEvent.keyDown(hop, { key: "Enter", ctrlKey: true });
    expect(suaSoMe).toHaveBeenCalledWith(1, { tot: 130, ly_do: "Gõ nhầm", expected_version: 2 });
  });

  it("chỉ đổi người cũng lưu được; người tổ khác bỏ được, thêm được người tổ khác mới", () => {
    const suaSoMe = vi.fn().mockResolvedValue(true);
    const coNguoi = {
      ...b, nguoi_tham_gia: [
        { employee_id: 1, ho_ten: "Đào Văn Hoan" },
        { employee_id: 8, ho_ten: "Nguyễn Hữu Bằng", to_ten: "Bế T - Bằng", la_ho_tro: true },
      ],
    } as unknown as SxBatch;
    render(<SuaSoMeForm b={coNguoi} tranGhi={tran} banGiao={null} busy={false} onXong={vi.fn()}
      nguoiGhi={[{ employee_id: 2, ho_ten: "Lê Minh Tú", nghi: null, dang_o: [], tick_san: true }]}
      toKhac={{ ds: [khoa], homNay: "2026-10-09" }}
      exec={{ suaSoMe } as unknown as ThsxExec} />);
    const hop = screen.getByRole("dialog", { name: "Sửa số sản lượng" });
    const ds = within(hop).getByRole("list", { name: "Người làm lần này" });
    const bang = within(ds).getByRole("checkbox", { name: /Nguyễn Hữu Bằng/ });
    expect(bang).toBeChecked();
    expect(bang).toBeEnabled();
    expect(within(ds).getByText("Bế T - Bằng")).toBeInTheDocument();
    expect(within(ds).getByRole("checkbox", { name: /Lê Minh Tú/ })).not.toBeChecked();
    const luu = within(hop).getByRole("button", { name: "Lưu" });
    expect(luu).toBeDisabled();
    fireEvent.click(bang);
    fireEvent.click(within(ds).getByRole("checkbox", { name: /Lê Minh Tú/ }));
    fireEvent.click(within(hop).getByRole("button", { name: /Thêm người tổ khác/ }));
    const pop = screen.getByRole("dialog", { name: "Thêm người tổ khác" });
    fireEvent.click(within(pop).getByRole("button", { name: /Cắt 1/ }));
    fireEvent.click(within(pop).getByRole("checkbox", { name: /Trần Văn Khoa/ }));
    fireEvent.click(within(pop).getByRole("button", { name: "Thêm 1 người" }));
    expect(within(ds).getByText("Cắt 1")).toBeInTheDocument();
    expect(luu).toBeEnabled();
    fireEvent.click(luu);
    expect(suaSoMe).toHaveBeenCalledWith(1, { tot: 120, ly_do: null, expected_version: 2, nguoi_ids: [1, 2, 9] });
  });

  it("mẻ chưa giao: không có câu lần giao", () => {
    const { hop } = mo(null);
    expect(within(hop).queryByText(/Lần này đã giao/)).toBeNull();
  });

  it("In Hà Phương: lần ghi cũ chưa có số từng người giữ tổng cũ, chia đủ thì lần giao giữ nguyên, không bắt xác nhận lại", async () => {
    const { PermissionsProvider, buildCapabilities } = await import("../auth/permissions");
    const suaSoMe = vi.fn().mockResolvedValue(true);
    const cu = {
      ...b, nguoi_tham_gia: [
        { employee_id: 1, ho_ten: "Đào Văn Hoan", so_luong: null },
        { employee_id: 2, ho_ten: "Lê Minh Tú", so_luong: null },
      ],
    } as unknown as SxBatch;
    render(
      <PermissionsProvider caps={buildCapabilities([])} phanHeTat={new Set()}>
        <SuaSoMeForm b={cu} tranGhi={tran} banGiao={{ ...g, trang_thai: "confirmed" } as SxBanGiao} busy={false}
          onXong={vi.fn()} exec={{ suaSoMe } as unknown as ThsxExec} />
      </PermissionsProvider>,
    );
    const hop = screen.getByRole("dialog", { name: "Sửa số sản lượng" });
    const tong = within(hop).getByLabelText("Số lượng làm được") as HTMLInputElement;
    expect(tong.value).toBe("120");
    expect(hop.textContent).toMatch(/Lần này ghi khi chưa có số từng người\. Chia 120/);
    expect(within(hop).queryByText(/^bớt/)).toBeNull();
    expect(within(hop).queryByText("Lần này đã giao, không sửa về 0 được.")).toBeNull();
    expect(within(hop).getByRole("button", { name: "Lưu" })).toBeDisabled();

    fireEvent.change(within(hop).getByLabelText("Số làm được của Đào Văn Hoan"), { target: { value: "70" } });
    fireEvent.change(within(hop).getByLabelText("Số làm được của Lê Minh Tú"), { target: { value: "50" } });
    expect(tong.value).toBe("120");
    expect(hop.textContent).toMatch(/Số không đổi nên lần giao 120 .*giữ nguyên\./);
    expect(hop.textContent).not.toMatch(/xác nhận lại/);
    fireEvent.click(within(hop).getByRole("button", { name: "Lưu" }));
    expect(suaSoMe).toHaveBeenCalledWith(1, { tot: 120, ly_do: null, expected_version: 2, so_luong_nguoi: { 1: 70, 2: 50 } });

    // Chia lệch tổng thì lần giao đổi theo và bên nhận phải xác nhận lại.
    fireEvent.change(within(hop).getByLabelText("Số làm được của Lê Minh Tú"), { target: { value: "40" } });
    expect(hop.textContent).toMatch(/Lần giao 120 đổi thành 110 .*sẽ phải xác nhận lại\./);
  });
});

describe("Hộp Sửa mẻ của lần giao", () => {
  it("chưa đổi thì Lưu khoá, đổi rồi mới sáng; mẻ ngoài lần giao ghi chưa giao", () => {
    const suaBanGiao = vi.fn().mockResolvedValue(true);
    render(<SuaMeForm g={g} me={me} conLai={80} busy={false} onXong={vi.fn()}
      exec={{ suaBanGiao } as unknown as ThsxExec} />);
    const hop = screen.getByRole("dialog", { name: "Chọn lại sản lượng của lần giao" });
    expect(within(hop).getByText(/Lần giao 120 .* sang Bài in 3 màu 4 màu/)).toBeInTheDocument();
    expect(within(hop).getByText("chưa giao")).toBeInTheDocument();
    expect(within(hop).getByText("Chọn 1 trên 2 lần")).toBeInTheDocument();
    const luu = within(hop).getByRole("button", { name: "Lưu" });
    expect(luu).toBeDisabled();
    fireEvent.click(within(hop).getAllByRole("checkbox")[1]);
    expect(within(hop).getByText("Chọn 2 trên 2 lần")).toBeInTheDocument();
    expect(luu).toBeEnabled();
    fireEvent.click(luu);
    expect(suaBanGiao).toHaveBeenCalledWith(10, { batch_ids: [1, 2], expected_version: 3 });
  });
});

describe("Hộp Đề xuất giao", () => {
  function chiTiet(changSau: number, batches: SxBatch[]) {
    return {
      cong_viec: { id: 5, ten_cong_doan: "Cắt tờ", nguon_ma: "LSX26-0004", don_vi_ra: "to_in" },
      san_luong: { batches },
      ban_giao_chang_sau: Array.from({ length: changSau }, (_, i) => ({
        cong_viec_id: 50 + i, ten_cong_doan: "Bài in 3 màu 4 màu", to_ten: "Nhóm thợ in máy 4 màu",
        du_kien_bat_dau: null, loai_buoc: "may", nha_cung_cap: null, trang_thai: "pending",
        phan_doan_so: i + 1, phan_doan_tong: changSau, to_id: 1,
      })),
    } as unknown as SxWorkItemChiTiet;
  }

  it("một bước sau thì chỉ đọc, mẻ chưa giao chọn sẵn, gửi đúng body", () => {
    const deXuatBanGiao = vi.fn().mockResolvedValue(true);
    render(<BanGiaoForm chiTiet={chiTiet(1, me)} conLai={80} busy={false} onXong={vi.fn()}
      exec={{ deXuatBanGiao } as unknown as ThsxExec} />);
    const hop = screen.getByRole("dialog", { name: "Đề xuất giao" });
    expect(within(hop).getByText("Cắt tờ của LSX26-0004")).toBeInTheDocument();
    expect(within(hop).queryByRole("radio")).toBeNull();
    expect(within(hop).getByText("Nhóm thợ in máy 4 màu")).toBeInTheDocument();
    expect(within(hop).getByText("Chọn 1 trên 1 lần")).toBeInTheDocument();
    expect(within(hop).queryByText(/·/)).toBeNull();
    fireEvent.click(within(hop).getByRole("button", { name: "Đề xuất giao" }));
    expect(deXuatBanGiao).toHaveBeenCalledWith({ dich_cong_viec_id: 50, don_vi: "to_in", batch_ids: [2] });
  });

  it("hết hàng thì báo và khoá nút", () => {
    render(<BanGiaoForm chiTiet={chiTiet(2, [])} conLai={0} busy={false} onXong={vi.fn()}
      exec={{ deXuatBanGiao: vi.fn() } as unknown as ThsxExec} />);
    const hop = screen.getByRole("dialog", { name: "Đề xuất giao" });
    expect(within(hop).getAllByRole("radio")).toHaveLength(2);
    expect(within(hop).getByText("Không còn hàng tốt để giao.")).toBeInTheDocument();
    expect(within(hop).getByRole("button", { name: "Đề xuất giao" })).toBeDisabled();
  });
});
